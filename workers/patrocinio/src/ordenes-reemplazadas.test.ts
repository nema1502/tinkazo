import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Cobros, GRACIA_REEMPLAZO_MS, HORIZON_CADA_MS, ORDEN_VIVE_MS } from "./cobros";
import { IDS, PAGADOR, montarPagos } from "./cobros-prueba";
import type { Env } from "./config";
import { Cupos } from "./cupos";
import { sqlDePrueba } from "./sqlite-prueba";

/**
 * Un pago que ya estaba en camino cuando se reemplazó su orden. El aviso de carga con QR reemplaza las órdenes sin el
 * recargo con lo ya leído de Horizon: un pago que el portero todavía no vio (la lectura guardada de 5 segundos, o una
 * lectura en curso) caía en los sueltos sin dar el paquete. Ahora se honra si entró a la red como mucho 2 minutos
 * después del reemplazo y llega solo al 95 %. Y el aviso pregunta antes de reemplazar una orden viva: `409 orden-abierta`,
 * salvo `reemplazar: true`. Precios de prueba: el primer paquete a 2 USDC con 3 sorteos y el de diez a 5. Recargo, 4,25.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5" };
const montar = (opciones: { cadaMs?: number } = {}) => montarPagos(ABIERTA, opciones);
type M = ReturnType<typeof montar>;

const CON_REEMPLAZO = { reemplazar: true };
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

/** Una persona del piloto con su orden del primer paquete (viva y sin el recargo) y su permiso de empezar. */
async function conOrdenYPermiso(m: M, usuario = "usr_ana") {
  const p = enPiloto(m, usuario);
  const orden = idDe(await m.orden(p.token, "alta"));
  expect((await m.empezar(p.token, "alta")).estado).toBe(200);
  return { ...p, orden };
}

describe("un pago a una orden reemplazada que ya estaba en camino", () => {
  it("lectura en t, pago en t+1 s, aviso en t+3 s con la lectura guardada: la orden se reemplaza y el pago se honra al leerlo", async () => {
    const m = montar({ cadaMs: HORIZON_CADA_MS });
    const ana = await conOrdenYPermiso(m);
    // En t, una lectura (Ya pagué, por ejemplo). Todavía no pagó.
    expect(await m.pago(ana.token, ana.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: false } });
    const pedidos = m.h.estado.pedidos.length;
    m.mover(1_000);
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${ana.orden}`, ms: m.hora() });
    m.mover(2_000);
    // El aviso lee, pero la lectura de hace 3 segundos sigue guardada: no ve el pago y reemplaza la orden.
    expect((await m.cargar(ana.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    expect(m.h.estado.pedidos).toHaveLength(pedidos);
    const reemplazo = m.hora();
    expect(m.cobros.orden(ana.orden)).toMatchObject({ pagada: null, metodo: "reemplazada", reemplazada: reemplazo });
    // La lectura siguiente lo ve: entró a la red antes del reemplazo, así que da el paquete.
    m.mover(HORIZON_CADA_MS);
    expect(await m.pago(ana.token, ana.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(m.cobros.orden(ana.orden)).toMatchObject({ metodo: "usdc", reemplazada: reemplazo });
    expect(m.sueltos()).toEqual([]);
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "pago" });
    expect(m.anotado).toContainEqual(["orden-honrada", { producto: "alta" }]);
    expect(JSON.stringify(m.anotado)).not.toContain(ana.orden);
  });

  it("lo mismo con una lectura en curso que tarda: el aviso la espera, no lee otra vez y no ve el pago", async () => {
    const m = montar({ cadaMs: HORIZON_CADA_MS });
    const ana = await conOrdenYPermiso(m);
    let soltar = () => {};
    m.h.estado.retener = new Promise<void>((r) => {
      soltar = () => r();
    });
    const enCurso = m.lector.leer();
    const pedidos = m.h.estado.pedidos.length;
    m.mover(1_000);
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${ana.orden}`, ms: m.hora() });
    // El aviso llega a los 6 segundos, con la lectura todavía en camino. Si leyera otra vez vería el pago.
    m.mover(5_000);
    const aviso = m.cargar(ana.token, "alta", CON_REEMPLAZO);
    await new Promise((r) => setTimeout(r, 20));
    m.h.estado.retener = null;
    soltar();
    expect(await enCurso).toEqual({ ok: true });
    expect((await aviso).estado).toBe(200);
    expect(m.h.estado.pedidos).toHaveLength(pedidos);
    expect(m.cobros.orden(ana.orden)).toMatchObject({ metodo: "reemplazada", reemplazada: m.hora() });
    m.mover(HORIZON_CADA_MS);
    expect(await m.pago(ana.token, ana.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.sueltos()).toEqual([]);
  });

  it("a los 2 minutos justos del reemplazo todavía se honra; un milisegundo después, va a los sueltos y no da nada", async () => {
    const m = montar();
    const ana = await conOrdenYPermiso(m, "usr_ana");
    const beto = await conOrdenYPermiso(m, "usr_beto");
    expect((await m.cargar(ana.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    expect((await m.cargar(beto.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    const reemplazo = m.hora();
    m.mover(10 * 60_000);
    const [justo, tarde] = m.h.sumar(
      { monto: "2.0000000", nota: `tk:o:${ana.orden}`, ms: reemplazo + GRACIA_REEMPLAZO_MS },
      { monto: "2.0000000", nota: `tk:o:${beto.orden}`, ms: reemplazo + GRACIA_REEMPLAZO_MS + 1 },
    );
    expect(await m.pago(ana.token, ana.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(await m.pago(beto.token, beto.orden)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    expect(m.filasDePagos()).toEqual([{ operacion: justo, orden: ana.orden, monto: 20_000_000 }]);
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: tarde, monto: 20_000_000, motivo: "cerrada", orden: beto.orden, estado: "suelto" })]);
    expect(m.cobros.orden(beto.orden)).toMatchObject({ pagada: null, metodo: "reemplazada" });
    expect(m.derechosDe("usr_beto")).toEqual([]);
  });

  it("en la ventana pero sin llegar al 95 %, a los sueltos, y dos pagos chicos no se suman; el 95 % justo se honra", async () => {
    const m = montar();
    const ana = await conOrdenYPermiso(m, "usr_ana");
    const beto = await conOrdenYPermiso(m, "usr_beto");
    expect((await m.cargar(ana.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    expect((await m.cargar(beto.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    const reemplazo = m.hora();
    m.mover(60_000);
    m.h.sumar(
      { monto: "1.8999999", nota: `tk:o:${ana.orden}`, ms: reemplazo },
      { monto: "0.1000000", nota: `tk:o:${ana.orden}`, ms: reemplazo + 1_000 },
      { monto: "1.9000000", nota: `tk:o:${beto.orden}`, ms: reemplazo },
    );
    expect(await m.pago(ana.token, ana.orden)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    expect(await m.pago(beto.token, beto.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.sueltos()).toEqual([
      expect.objectContaining({ monto: 18_999_999, motivo: "cerrada", orden: ana.orden }),
      expect.objectContaining({ monto: 1_000_000, motivo: "cerrada", orden: ana.orden }),
    ]);
    expect(m.cobros.recibido(ana.orden)).toBe(0);
    expect(m.derechosDe("usr_ana")).toEqual([]);
  });

  it("/v1/alta/pago lee antes de contestar 410; con Horizon caído, 502 red para una reemplazada y 410 para una cerrada para devolver", async () => {
    const m = montar();
    // Beto, con una orden pagada a medias y cerrada para devolver.
    const beto = m.persona("usr_beto");
    const devuelta = idDe(await m.orden(beto.token, "alta"));
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${devuelta}` });
    await m.pago(beto.token, devuelta);
    expect(await m.admin.atender("ordenes-cerrar", { orden: devuelta, ref: "devolucion-0010" })).toMatchObject({ estado: 200 });
    const ana = await conOrdenYPermiso(m);
    expect((await m.cargar(ana.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    // Sin pagos nuevos: lee y recién ahí contesta que está cerrada.
    const antes = m.h.estado.pedidos.length;
    expect(await m.pago(ana.token, ana.orden)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    expect(m.h.estado.pedidos.length).toBeGreaterThan(antes);
    m.h.estado.caido = true;
    expect(await m.pago(ana.token, ana.orden)).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(await m.pago(beto.token, devuelta)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    // Vuelve Horizon con el pago que estaba en camino: la reemplazada queda pagada.
    m.h.estado.caido = false;
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${ana.orden}`, ms: m.hora() });
    expect(await m.pago(ana.token, ana.orden)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("/v1/alta/estado lee antes a quien tiene una orden reemplazada hace poco: vuelve y ya tiene su acceso", async () => {
    const m = montar();
    const ana = await conOrdenYPermiso(m);
    expect((await m.cargar(ana.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${ana.orden}`, ms: m.hora() });
    m.mover(60_000);
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ acceso: "pago", sorteos: { quedan: 3 } });
    // Pasado el tiempo que vivía la orden, ya no se lee por ella.
    const beto = await conOrdenYPermiso(m, "usr_beto");
    expect((await m.cargar(beto.token, "alta", CON_REEMPLAZO)).estado).toBe(200);
    m.mover(ORDEN_VIVE_MS + 1);
    const pedidos = m.h.estado.pedidos.length;
    await m.estado(beto.token);
    expect(m.h.estado.pedidos).toHaveLength(pedidos);
  });

  it("anular también guarda la hora: un pago con el saldo que entró a la red justo antes de anular se honra", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const conRecargo = idDe(await m.orden(ana.token, "alta"));
    m.mover(60_000);
    // Pagó con su saldo un segundo antes de anular, y Horizon todavía no lo traía cuando anular leyó. La anula
    // administración: la anulación de la persona ya no cierra órdenes (compras-recargo.test.ts).
    expect(await m.admin.atender("compras-cerrar", { usuario: "usr_ana", ref: "soporte-0001" })).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: false } });
    const anulada = m.hora();
    expect(m.cobros.orden(conRecargo)).toMatchObject({ metodo: "reemplazada", reemplazada: anulada });
    m.mover(30_000);
    m.h.sumar({ monto: "6.2500000", nota: `tk:o:${conRecargo}`, de: ana.cuenta as string, ms: anulada - 1_000 });
    expect(await m.pago(ana.token, conRecargo)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(m.compras.pagoLaPrimera("usr_ana")).toBe(true);
    expect(m.sueltos()).toEqual([]);
  });
});

describe("el aviso de carga pregunta antes de reemplazar una orden viva", () => {
  it("409 orden-abierta con la orden más nueva y sin tocar nada; con reemplazar: true reemplaza la viva y la vencida", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const vencida = idDe(await m.orden(ana.token, "alta"));
    m.mover(ORDEN_VIVE_MS + 1);
    const creada = m.hora();
    const viva = idDe(await m.orden(ana.token, "p10"));
    expect([vencida, viva]).toEqual([IDS[0], IDS[1]]);
    await m.empezar(ana.token, "alta");
    expect(await m.cargar(ana.token, "alta")).toEqual({
      estado: 409,
      cuerpo: { motivo: "orden-abierta", orden: { id: viva, producto: "p10", usdc: "5", nota: `tk:o:${viva}`, vence: creada + ORDEN_VIVE_MS, recibido: "0" } },
    });
    for (const id of [vencida, viva]) expect(m.cobros.orden(id), id).toMatchObject({ metodo: null, reemplazada: null });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    expect(m.anotado.filter(([e]) => e === "compra-cargada")).toEqual([]);
    // Solo un true de verdad cuenta.
    for (const malo of ["true", 1, "si", null]) expect(await m.cargar(ana.token, "alta", { reemplazar: malo }), String(malo)).toMatchObject({ estado: 409, cuerpo: { motivo: "orden-abierta" } });
    // Dijo que no la pagó: se reemplazan las dos, con la hora.
    expect(await m.cargar(ana.token, "alta", CON_REEMPLAZO)).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "alta", cargada: true } } });
    for (const id of [vencida, viva]) expect(m.cobros.orden(id), id).toMatchObject({ pagada: null, metodo: "reemplazada", reemplazada: m.hora() });
    // Después, la orden con el recargo no hace preguntar: avisar otra vez es lo mismo.
    const conRecargo = idDe(await m.orden(ana.token, "alta"));
    m.mover(3 * 60_000);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(m.cobros.orden(conRecargo)).toMatchObject({ pagada: null, metodo: null });
  });

  it("una orden vencida sola no pregunta: se reemplaza como antes", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const vencida = idDe(await m.orden(ana.token, "alta"));
    m.mover(ORDEN_VIVE_MS + 1);
    await m.empezar(ana.token, "alta");
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(m.cobros.orden(vencida)).toMatchObject({ metodo: "reemplazada", reemplazada: m.hora() });
  });

  it("una orden que recibió algo frena antes: 409 orden-con-pago también con reemplazar", async () => {
    const m = montar();
    const ana = await conOrdenYPermiso(m);
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${ana.orden}` });
    expect(await m.cargar(ana.token, "alta", CON_REEMPLAZO)).toEqual({ estado: 409, cuerpo: { motivo: "orden-con-pago" } });
    expect(m.cobros.orden(ana.orden)).toMatchObject({ pagada: null, metodo: null });
  });
});

describe("la hora del reemplazo sobre los datos de un portero desplegado", () => {
  const T = Date.UTC(2026, 10, 14, 12, 0, 0);
  const CREAR_ANTES =
    "CREATE TABLE ordenes (id TEXT PRIMARY KEY, usuario TEXT NOT NULL, producto TEXT NOT NULL, monto INTEGER NOT NULL, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, creada INTEGER NOT NULL, vence INTEGER NOT NULL, pagada INTEGER, metodo TEXT, ref TEXT)";
  const INSERTAR_ANTES = "INSERT INTO ordenes (id, usuario, producto, monto, sorteos, dias, creada, vence, pagada, metodo, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)";
  const REEMPLAZAR_ANTES = "UPDATE ordenes SET metodo = 'reemplazada', ref = ? WHERE id = ? AND pagada IS NULL AND metodo IS NULL";
  const [A, B, C] = IDS as [string, string, string];

  it("la columna se suma sin tocar las filas, correr dos veces no rompe, y la versión anterior sigue escribiendo y leyendo", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(CREAR_ANTES);
    db.prepare(INSERTAR_ANTES).run(A, "usr_ana", "alta", 20_000_000, 3, 365, T, T + ORDEN_VIVE_MS);
    db.prepare(INSERTAR_ANTES).run(B, "usr_beto", "alta", 20_000_000, 3, 365, T, T + ORDEN_VIVE_MS);
    db.prepare(REEMPLAZAR_ANTES).run("reemplazada:compra:1", B);
    const sql = sqlDePrueba(db);
    const cupos = new Cupos(sql);
    new Cupos(sql);
    expect(sql.exec("PRAGMA table_info(ordenes)").toArray().map((f) => String(f.name))).toEqual([
      "id",
      "usuario",
      "producto",
      "monto",
      "sorteos",
      "dias",
      "creada",
      "vence",
      "pagada",
      "metodo",
      "ref",
      "reemplazada",
    ]);
    const cobros = new Cobros(sql, cupos);
    expect(cobros.orden(A)).toMatchObject({ metodo: null, reemplazada: null });
    expect(cobros.orden(B)).toMatchObject({ metodo: "reemplazada", reemplazada: null });
    // La versión anterior, después de volver atrás: escribe nombrando sus columnas y lee con SELECT *.
    db.prepare(INSERTAR_ANTES).run(C, "usr_caro", "alta", 20_000_000, 3, 365, T, T + ORDEN_VIVE_MS);
    db.prepare(REEMPLAZAR_ANTES).run("reemplazada:compra:2", C);
    db.prepare("UPDATE ordenes SET pagada = ?, metodo = 'usdc', ref = ? WHERE id = ? AND pagada IS NULL").run(T, "usdc:1", A);
    expect(sql.exec("SELECT * FROM ordenes ORDER BY id").toArray()).toHaveLength(3);
    expect(cobros.orden(C)).toMatchObject({ metodo: "reemplazada", reemplazada: null });
    // Una reemplazada sin hora (de antes, o de la versión anterior) no se honra: el pago va a los sueltos como siempre.
    const pago = (op: string, orden: string) => ({
      operacion: op,
      pagingToken: op,
      tx: `tx${op}`,
      de: PAGADOR,
      esUsdc: true,
      activo: "USDC",
      monto: 20_000_000,
      memo: { tipo: "texto" as const, valor: `tk:o:${orden}` },
      ms: T,
    });
    cobros.registrarLectura([pago("250000000000000001", B), pago("250000000000000002", C)], "250000000000000002", T + 1);
    expect(cobros.sueltos().map((s) => [s.orden, s.motivo, s.monto])).toEqual([
      [B, "cerrada", 20_000_000],
      [C, "cerrada", 20_000_000],
    ]);
    expect(cupos.altaDe("usr_beto")).toBeNull();
  });
});
