import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { codigo } from "./altas-prueba";
import { COBROS, IDS, PAGADOR, horizonDeCobros, montarPagos } from "./cobros-prueba";
import { AJUSTE_CURSOR, AJUSTE_VENTA_PAUSADA, Cobros, EMISOR_USDC, HORIZON_CADA_MS, LectorDeCobros, ORDEN_VIVE_MS, leerPagos, memoIdDe, minimoDe, normalizarOrden, ordenDeNota, usdcTexto } from "./cobros";
import { DIA_MS, leerConfig } from "./config";
import { Cupos } from "./cupos";
import { haciaHorizon } from "./servidores";
import { sqlDePrueba } from "./sqlite-prueba";

const ID = IDS[0] as string;
const NOTA = `tk:o:${ID}`;

/** Una persona con su orden del primer paquete (2 USDC, 3 sorteos). */
async function conOrden(m: ReturnType<typeof montarPagos>, usuario = "usr_ana") {
  const p = m.persona(usuario);
  const r = await m.orden(p.token, "alta");
  expect(r.estado).toBe(200);
  return { ...p, id: (r.cuerpo as { orden: { id: string } }).orden.id };
}

describe("la nota y los montos", () => {
  it("la nota se lee como el cupón: sin espacios, en mayúsculas, la O por 0 y la I o la L por 1; el prefijo sin distinguir mayúsculas", () => {
    expect(ordenDeNota({ tipo: "texto", valor: NOTA })).toBe(ID);
    expect(ordenDeNota({ tipo: "texto", valor: " tk:o:abcd 2345 " })).toBe(ID);
    expect(ordenDeNota({ tipo: "texto", valor: "TK:O:ABCD-2345" })).toBe(ID);
    expect(ordenDeNota({ tipo: "texto", valor: "Tk:o:k7m29qxa" })).toBe("K7M29QXA");
    expect(ordenDeNota({ tipo: "texto", valor: "tk:o:4htroPqz" })).toBe("4HTR0PQZ");
    expect(ordenDeNota({ tipo: "texto", valor: "tk:o:1234abcI".replace("I", "l") })).toBe("1234ABC1");
    for (const malo of ["ABCD2345", "tk:o:ABCD234", "tk:o:ABCD23456", "tk:o:ABCD234U", "tk:p:ABCD2345", "tk:plan:ABCD2345", ""]) expect(ordenDeNota({ tipo: "texto", valor: malo }), malo).toBeNull();
    expect(ordenDeNota(null)).toBeNull();
  });

  it("la nota numérica es el id de la orden como número de 40 bits, ida y vuelta", () => {
    const n = memoIdDe(ID);
    expect(n).toMatch(/^\d+$/);
    expect(BigInt(n) < 2n ** 40n).toBe(true);
    expect(ordenDeNota({ tipo: "id", valor: n })).toBe(ID);
    expect(ordenDeNota({ tipo: "id", valor: memoIdDe("00000000") })).toBe("00000000");
    expect(ordenDeNota({ tipo: "id", valor: String(2n ** 40n) })).toBeNull();
    expect(ordenDeNota({ tipo: "id", valor: "-1" })).toBeNull();
    expect(ordenDeNota({ tipo: "otro", valor: "hash" })).toBeNull();
  });

  it("el prefijo acepta el cero en lugar de la O, con la misma regla que el resto de la nota", () => {
    expect(ordenDeNota({ tipo: "texto", valor: "tk:0:ABCD2345" })).toBe(ID);
    expect(ordenDeNota({ tipo: "texto", valor: "TK:0:abcd-2345" })).toBe(ID);
    expect(normalizarOrden("tk:0:abcd2345")).toBe(ID);
    expect(ordenDeNota({ tipo: "texto", valor: "tk:00:ABCD2345" })).toBeNull();
  });

  it("el id que manda el sitio, con o sin prefijo", () => {
    expect(normalizarOrden(ID)).toBe(ID);
    expect(normalizarOrden("abcd-2345")).toBe(ID);
    expect(normalizarOrden(NOTA)).toBe(ID);
    for (const malo of [undefined, null, 12, "", "ABCD234", "x".repeat(200)]) expect(normalizarOrden(malo)).toBeNull();
  });

  it("el 95 % del monto y cómo se escribe un monto", () => {
    expect(minimoDe(20_000_000)).toBe(19_000_000);
    expect(minimoDe(50_000_000)).toBe(47_500_000);
    expect(minimoDe(1)).toBe(1);
    expect(usdcTexto(20_000_000)).toBe("2");
    expect(usdcTexto(19_000_000)).toBe("1.9");
    expect(usdcTexto(15_000_001)).toBe("1.5000001");
  });
});

describe("la orden", () => {
  it("crea una orden con su nota, la nota numérica, el enlace SEP-7 y 72 horas; pedirla otra vez da la misma", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    const r = await m.orden(ana.token, "alta");
    expect(r).toEqual({
      estado: 200,
      cuerpo: { orden: { id: ID, producto: "alta", usdc: "2", sorteos: 3, destino: COBROS, nota: NOTA, memoId: memoIdDe(ID), enlace: expect.any(String), vence: m.hora() + ORDEN_VIVE_MS } },
    });
    const enlace = new URL((r.cuerpo as { orden: { enlace: string } }).orden.enlace);
    expect(enlace.protocol).toBe("web+stellar:");
    expect(enlace.pathname).toBe("pay");
    expect(Object.fromEntries(enlace.searchParams)).toEqual({ destination: COBROS, amount: "2", asset_code: "USDC", asset_issuer: EMISOR_USDC, memo: NOTA, memo_type: "MEMO_TEXT" });
    // Otra vez, la misma orden abierta; otro producto, otra.
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: ID } } });
    expect(await m.orden(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[1], producto: "p10", usdc: "5", sorteos: 10 } } });
    // Vencida, otra nueva.
    m.mover(ORDEN_VIVE_MS + 1);
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[2] } } });
    // El estado trae la orden abierta.
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[2], producto: "alta", usdc: "2", nota: `tk:o:${IDS[2]}` } } });
    expect(m.anotado.filter(([e]) => e === "alta-orden")).toHaveLength(3);
  });

  it("dos personas no comparten orden", async () => {
    const m = montarPagos();
    const a = await conOrden(m, "usr_ana");
    const b = await conOrden(m, "usr_beto");
    expect(a.id).not.toBe(b.id);
    expect(await m.pago(b.token, a.id)).toEqual({ estado: 404, cuerpo: { motivo: "orden" } });
    expect(await m.pago(b.token, "ZZZZ9999")).toEqual({ estado: 404, cuerpo: { motivo: "orden" } });
    expect(await m.pago(b.token, "no")).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
  });

  it("con acceso, el primer paquete da 409 ya-tiene-acceso; un paquete de 10 sí", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    m.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES ('usr_ana', 'cupon', 'cupon:x', NULL, NULL, 'autorizada', ?, ?)", m.hora(), m.hora());
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
    expect((await m.orden(ana.token, "p10")).estado).toBe(200);
  });

  it("un producto que no existe es 400; con el pago apagado, 503 pago-apagado", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    for (const malo of ["p20", "", null, 3, "ALTA"]) expect(await m.orden(ana.token, malo)).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
    const apagado = montarPagos({ ALTAS_PAGO: "0" });
    const beto = apagado.persona("usr_beto");
    expect(await apagado.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "pago-apagado" } });
    // Sin sesión, como las demás rutas.
    expect(await m.orden(null, "alta")).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
  });

  it("con la venta pausada (la red en amarillo) no hay órdenes nuevas; la que ya estaba abierta sigue", async () => {
    const m = montarPagos();
    const ana = await conOrden(m, "usr_ana");
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: ana.id } } });
    const beto = m.persona("usr_beto");
    expect(await m.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "0", m.hora());
    expect((await m.orden(beto.token, "alta")).estado).toBe(200);
  });

  it("bajo el piso de créditos, 503 altas-pausadas y no se crea la orden; lo ya pagado se respeta igual", async () => {
    const m = montarPagos();
    const ana = await conOrden(m, "usr_ana");
    m.pm.creditos = 300 + 3 * 40 + 30 - 1;
    m.mover(61_000);
    const beto = m.persona("usr_beto");
    expect(await m.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });
});

describe("el pago", () => {
  it("con la nota justa: la orden queda pagada, la persona tiene su alta, sus 3 sorteos por 12 meses y su cuenta en el libro", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "0", total: "2", minimo: "1.9" } });
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3, proximoVence: { fecha: m.hora() + 365 * DIA_MS, cuantos: 3 } }, sigue: "activar" } });
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "pago", cuenta: ana.cuenta });
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    expect(m.derechosDe("usr_ana")).toEqual([{ ref: `orden:${ID}`, sorteos: 3, usados: 0, origen: "alta", cuenta: ana.cuenta }]);
    expect(m.cobros.orden(ID)).toMatchObject({ pagada: m.hora(), metodo: "usdc" });
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "pago", orden: null, sorteos: { quedan: 3 } } });
    // Volver a preguntar no da nada de más.
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(m.derechosDe("usr_ana")).toHaveLength(1);
  });

  it("en minúsculas, con espacios y con la O en lugar del 0, también", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", nota: ` tk:o:${ID.toLowerCase().slice(0, 4)} ${ID.slice(4)}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    // La tercera orden de esta copia es 4HTR0PQZ: la nota con la O en lugar del 0.
    const m2 = montarPagos();
    await conOrden(m2, "usr_x");
    await conOrden(m2, "usr_y");
    const beto = await conOrden(m2, "usr_beto");
    expect(beto.id).toBe("4HTR0PQZ");
    m2.h.sumar({ monto: "2.0000000", nota: "TK:O:4htrOpqz" });
    expect(await m2.pago(beto.token, beto.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("con la nota numérica (MEMO_ID)", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", memoId: memoIdDe(ana.id) });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("convertido de otra moneda vale lo que llegó", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", nota: NOTA, tipo: "path_payment_strict_send" });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    const m2 = montarPagos();
    const beto = await conOrden(m2, "usr_beto");
    m2.h.sumar({ monto: "1.5000000", nota: NOTA, tipo: "path_payment_strict_receive" });
    expect(await m2.pago(beto.token, beto.id)).toMatchObject({ estado: 200, cuerpo: { pagada: false, recibido: "1.5" } });
  });

  it("dos pagos de la misma orden suman", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "1", total: "2", minimo: "1.9" } });
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.derechosDe("usr_ana")).toHaveLength(1);
  });

  it("1,90 de 2 da pagada (el exchange descontó su comisión); 1,89 no", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.8900000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "1.89" } });
    const m2 = montarPagos();
    const beto = await conOrden(m2, "usr_beto");
    m2.h.sumar({ monto: "1.9000000", nota: NOTA });
    expect(await m2.pago(beto.token, beto.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(m2.sueltos()).toEqual([]);
  });

  it("la misma operación leída dos veces cuenta una vez", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA }, { monto: "1.0000000", nota: "otra cosa" });
    await m.pago(ana.token, ana.id);
    // Como si el cursor se hubiera perdido: se vuelve a leer todo desde el principio.
    m.sql.exec("DELETE FROM ajustes WHERE clave = ?", AJUSTE_CURSOR);
    expect(m.cobros.cursor()).toBeNull();
    await m.pago(ana.token, ana.id);
    expect(m.filasDePagos()).toHaveLength(1);
    expect(m.sueltos()).toHaveLength(1);
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "1" } });
  });

  it("dos pagos en una misma transacción son dos operaciones y cuentan dos", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA, tx: "tx-una" }, { monto: "1.0000000", nota: NOTA, tx: "tx-una" });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.filasDePagos()).toHaveLength(2);
  });

  it("otra nota, sin nota y otro emisor van a los pagos sueltos; ninguno se pierde", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const otro = Keypair.random().publicKey();
    const [a, b, c, d, e] = m.h.sumar(
      { monto: "2.0000000", nota: "tk:o:ZZZZ9999" },
      { monto: "3.0000000" },
      { monto: "2.0000000", nota: NOTA, emisor: otro },
      { monto: "10.0000000", nota: NOTA, nativo: true },
      { monto: "2.0000000", nota: "hola" },
    );
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "0" } });
    expect(m.sueltos()).toEqual([
      { operacion: a, activo: "USDC", monto: 20_000_000, nota: "tk:o:ZZZZ9999", motivo: "nota-desconocida", estado: "suelto", orden: null },
      { operacion: b, activo: "USDC", monto: 30_000_000, nota: null, motivo: "sin-nota", estado: "suelto", orden: null },
      { operacion: c, activo: `USDC:${otro}`, monto: 20_000_000, nota: NOTA, motivo: "otro-activo", estado: "suelto", orden: null },
      { operacion: d, activo: "XLM", monto: 100_000_000, nota: NOTA, motivo: "otro-activo", estado: "suelto", orden: null },
      { operacion: e, activo: "USDC", monto: 20_000_000, nota: "hola", motivo: "nota-desconocida", estado: "suelto", orden: null },
    ]);
    expect(m.anotado.filter(([ev]) => ev === "pago-suelto").map(([, x]) => x?.motivo)).toEqual(["nota-desconocida", "sin-nota", "otro-activo", "otro-activo", "nota-desconocida"]);
  });

  it("lo que sobra de una orden va a los sueltos con su orden, para devolverlo", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA }, { monto: "1.5000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(m.filasDePagos().map((f) => f.monto)).toEqual([10_000_000, 10_000_000]);
    expect(m.sueltos()).toEqual([expect.objectContaining({ activo: "USDC", monto: 5_000_000, motivo: "sobrante", orden: ID })]);
  });

  it("un pago a una orden ya pagada no da otro paquete: va entero a los sueltos como repetido, con su orden", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    // Uno entero, uno chico y uno de más: ninguno da nada.
    const [entero, chico, grande] = m.h.sumar({ monto: "2.0000000", nota: NOTA }, { monto: "0.5000000", nota: NOTA }, { monto: "5.0000000", memoId: memoIdDe(ID) });
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3, proximoVence: { fecha: m.hora() + 365 * DIA_MS, cuantos: 3 } }, sigue: "activar" } });
    expect(m.derechosDe("usr_ana").map((d) => d.ref)).toEqual([`orden:${ID}`]);
    expect(m.cupos.quedan({ cuenta: ana.cuenta as string }, m.hora()).quedan).toBe(3);
    expect(m.filasDePagos()).toHaveLength(1);
    expect(m.sueltos()).toEqual([
      { operacion: entero, activo: "USDC", monto: 20_000_000, nota: NOTA, motivo: "repetido", estado: "suelto", orden: ID },
      { operacion: chico, activo: "USDC", monto: 5_000_000, nota: NOTA, motivo: "repetido", estado: "suelto", orden: ID },
      { operacion: grande, activo: "USDC", monto: 50_000_000, nota: memoIdDe(ID), motivo: "repetido", estado: "suelto", orden: ID },
    ]);
    expect(m.anotado.filter(([e]) => e === "alta-pago").map(([, d]) => d)).toEqual([{ producto: "alta" }]);
    expect(m.anotado.filter(([e]) => e === "pago-suelto").map(([, d]) => d?.motivo)).toEqual(["repetido", "repetido", "repetido"]);
    // Leer otra vez no cambia nada.
    m.sql.exec("DELETE FROM ajustes WHERE clave = ?", AJUSTE_CURSOR);
    await m.pago(ana.token, ana.id);
    expect(m.sueltos()).toHaveLength(3);
    expect(m.derechosDe("usr_ana")).toHaveLength(1);
  });

  it("un pago repetido no da nada, con la venta pausada o abierta", async () => {
    const m = montarPagos();
    const ana = await conOrden(m, "usr_ana");
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "0", m.hora());
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    expect(m.derechosDe("usr_ana")).toHaveLength(1);
    expect(m.sueltos().map((s) => s.motivo)).toEqual(["repetido", "repetido"]);
  });

  it("una orden vencida que se paga se respeta: la plata llegó", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.mover(ORDEN_VIVE_MS + DIA_MS);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { orden: null } });
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("pagada a medias y vencida: /estado la sigue mostrando con lo recibido, y /orden devuelve la misma con la misma nota", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.5000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "1.5" } });
    // Vuelve cuatro días después.
    m.mover(4 * DIA_MS);
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "ninguno", orden: { id: ID, nota: NOTA, usdc: "2", recibido: "1.5" } } });
    const otra = await m.orden(ana.token, "alta");
    expect(otra).toMatchObject({ estado: 200, cuerpo: { orden: { id: ID, nota: NOTA, vence: m.hora() + ORDEN_VIVE_MS } } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
    // Completa lo que falta con la misma nota: queda pagada.
    m.h.sumar({ monto: "0.5000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.sueltos()).toEqual([]);
  });

  it("una orden sin nada pagado y vencida no se revive: /orden crea otra", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.mover(ORDEN_VIVE_MS + 1);
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[1] } } });
  });

  it("pagada a medias hace más de 30 días ya no se muestra: queda para administración", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    m.mover(31 * DIA_MS);
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { orden: null } });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[1] } } });
  });

  it("pagó a la hora 71 y vuelve a la 73 sin tocar «Ya pagué»: /estado lee los pagos y ya trae el acceso", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.mover(71 * 3_600_000);
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    m.mover(2 * 3_600_000);
    const pedidosAntes = m.h.estado.pedidos.length;
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "pago", orden: null, sorteos: { quedan: 3 } } });
    expect(m.h.estado.pedidos.length).toBe(pedidosAntes + 1);
    expect(m.cupos.estaEnElLibro(ana.cuenta as string)).toBe(true);
    // Y comprar el primer paquete otra vez ya no crea otra orden.
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
  });

  it("/orden también lee los pagos si la persona tiene una orden sin pagar: no le crea otra por un pago que todavía no se leyó", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.mover(ORDEN_VIVE_MS + 1);
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
  });

  it("/estado no lee Horizon a quien no tiene órdenes sin pagar, y si Horizon se cae igual contesta", async () => {
    const m = montarPagos();
    const beto = m.persona("usr_beto");
    expect((await m.estado(beto.token)).estado).toBe(200);
    expect(m.h.estado.pedidos).toHaveLength(0);
    const ana = await conOrden(m);
    m.h.estado.caido = true;
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "ninguno", orden: { id: ID } } });
    expect(m.h.estado.pedidos).toHaveLength(1);
  });

  it("con el pago apagado (ALTAS_PAGO=0), las órdenes que ya existen se siguen leyendo y pagando", async () => {
    const m = montarPagos({ ALTAS_PAGO: "0" });
    const ana = m.persona("usr_ana");
    const producto = m.cfg.precios?.find((p) => p.id === "alta");
    expect(producto).toBeDefined();
    const r = m.cobros.crearOrden({ usuario: "usr_ana", producto: producto as NonNullable<typeof producto> }, m.hora());
    expect(r).toMatchObject({ ok: true, nueva: true });
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "pago-apagado" } });
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ID)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("Horizon caído da 502 red y no marca nada; el cursor no se mueve", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    m.h.estado.caido = true;
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.filasDePagos()).toEqual([]);
    expect(m.cobros.cursor()).toBeNull();
    expect(m.anotado.some(([e]) => e === "error-horizon")).toBe(true);
    m.h.estado.caido = false;
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("lo que sale de la cuenta de cobros, lo que no llegó a ella, lo fallido y lo que no es un pago no cuentan", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar(
      { monto: "2.0000000", nota: NOTA, de: COBROS, a: PAGADOR },
      { monto: "2.0000000", nota: NOTA, a: Keypair.random().publicKey() },
      { monto: "2.0000000", nota: NOTA, exitoso: false },
      { monto: "2.0000000", nota: NOTA, tipo: "create_account" },
      { monto: "2.0000000", nota: NOTA, de: COBROS },
    );
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "0" } });
    expect(m.sueltos()).toEqual([]);
    // Pero el cursor pasó por encima de todos.
    expect(m.cobros.cursor()).toBe(m.h.pagos.at(-1)?.id);
  });
});

describe("la lectura de Horizon", () => {
  it("lee solo de Horizon de la red principal, la cuenta de cobros, en orden ascendente y desde el cursor", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const [primero] = m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    expect(m.h.estado.pedidos).toHaveLength(2);
    for (const p of m.h.estado.pedidos) expect(p.startsWith(`https://horizon.stellar.org/accounts/${COBROS}/payments?order=asc&limit=200&include_failed=false&join=transactions`)).toBe(true);
    expect(new URL(m.h.estado.pedidos[0] as string).searchParams.get("cursor")).toBeNull();
    expect(new URL(m.h.estado.pedidos[1] as string).searchParams.get("cursor")).toBe(primero);
  });

  it("un fetch que apunte a otro servidor no se usa: la ruta va siempre sobre el Horizon fijo", async () => {
    const vistos: string[] = [];
    const f = async (u: string) => (vistos.push(u), new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 }));
    const r = await leerPagos(haciaHorizon(f), COBROS, null);
    expect(r).toEqual({ ok: true, pagos: [], cursor: null, completo: true });
    expect(vistos.every((u) => u.startsWith("https://horizon.stellar.org/"))).toBe(true);
    // Una cuenta con forma rara no arma una ruta hacia otro lado.
    expect(await leerPagos(haciaHorizon(f), "//otro.example/x", null)).toEqual({ ok: false });
  });

  it("varias páginas: sigue con el cursor hasta cinco de 200, y el resto en la vuelta siguiente", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    for (let i = 0; i < 1100; i++) m.h.sumar({ monto: "0.0000001", nota: "spam" });
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false } });
    expect(m.h.estado.pedidos).toHaveLength(5);
    expect(m.sueltos()).toHaveLength(1000);
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(m.sueltos()).toHaveLength(1100);
  });

  it("si se corta en la tercera página, guarda lo de las dos primeras con su cursor y contesta 502 si la orden no está paga", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    for (let i = 0; i < 500; i++) m.h.sumar({ monto: "0.0000001", nota: "spam" });
    m.h.estado.fallar = (n) => n === 3;
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.sueltos()).toHaveLength(400);
    expect(m.cobros.cursor()).toBe(m.h.pagos[399]?.id);
  });

  it("el cursor avanza y nunca retrocede", () => {
    const sql = sqlDePrueba();
    const cobros = new Cobros(sql, new Cupos(sql));
    cobros.registrarLectura([], "250000000000000500", 0);
    expect(cobros.cursor()).toBe("250000000000000500");
    cobros.registrarLectura([], "250000000000000499", 0);
    expect(cobros.cursor()).toBe("250000000000000500");
    // Más largo es más grande, aunque como texto vaya antes.
    cobros.registrarLectura([], "1250000000000000000", 0);
    expect(cobros.cursor()).toBe("1250000000000000000");
    cobros.registrarLectura([], null, 0);
    expect(cobros.cursor()).toBe("1250000000000000000");
  });

  it("el cursor y los pagos de una vuelta se escriben en la misma transacción: si falla el cursor, no queda ningún pago", () => {
    const base = sqlDePrueba();
    let romper = false;
    const sql = { ...base, exec: (q: string, ...b: unknown[]) => (romper && /INTO ajustes/.test(q) ? (() => { throw new Error("disco"); })() : base.exec(q, ...b)) };
    const cupos = new Cupos(sql);
    const cobros = new Cobros(sql, cupos, { idAlAzar: () => ID });
    const producto = leerConfig({ RED: "mainnet" }).precios?.[0];
    cobros.crearOrden({ usuario: "usr_ana", producto: producto as NonNullable<typeof producto> }, 0);
    romper = true;
    const pago = { operacion: "250000000000000001", pagingToken: "250000000000000001", tx: "tx", de: PAGADOR, esUsdc: true, activo: "USDC", monto: 20_000_000, memo: { tipo: "texto" as const, valor: NOTA }, ms: 0 };
    expect(() => cobros.registrarLectura([pago], "250000000000000001", 1)).toThrow();
    romper = false;
    expect(base.exec("SELECT COUNT(*) AS n FROM pagos").toArray()[0]?.n).toBe(0);
    expect(base.exec("SELECT COUNT(*) AS n FROM derechos").toArray()[0]?.n).toBe(0);
    expect(cobros.orden(ID)?.pagada).toBeNull();
    expect(cobros.cursor()).toBeNull();
  });

  it(`Horizon se lee como mucho una vez cada ${HORIZON_CADA_MS / 1000} segundos para todo el objeto; en el medio, lo último leído`, async () => {
    const m = montarPagos({}, { cadaMs: HORIZON_CADA_MS });
    const ana = await conOrden(m, "usr_ana");
    const beto = await conOrden(m, "usr_beto");
    await Promise.all([m.pago(ana.token, ana.id), m.pago(beto.token, beto.id), m.pago(ana.token, ana.id)]);
    expect(m.h.estado.pedidos).toHaveLength(1);
    m.mover(HORIZON_CADA_MS - 1);
    await m.pago(ana.token, ana.id);
    expect(m.h.estado.pedidos).toHaveLength(1);
    m.mover(1);
    await m.pago(ana.token, ana.id);
    expect(m.h.estado.pedidos).toHaveLength(2);
  });

  it("una cuenta de cobros que todavía no existe en la red no tiene pagos", async () => {
    const h = horizonDeCobros(Keypair.random().publicKey());
    expect(await leerPagos(haciaHorizon(h.fetch), COBROS, null)).toEqual({ ok: true, pagos: [], cursor: null, completo: true });
  });

  it("el lector sin pagos nuevos no escribe nada más que el cursor", async () => {
    const sql = sqlDePrueba();
    const cobros = new Cobros(sql, new Cupos(sql));
    const h = horizonDeCobros(COBROS);
    const lector = new LectorDeCobros({ cobros, cuenta: COBROS, fetch: h.fetch, cadaMs: 0 });
    expect(await lector.leer()).toEqual({ ok: true });
    expect(cobros.cursor()).toBeNull();
  });
});

describe("la bitácora de los pagos", () => {
  it("no lleva el id de la persona, su cuenta, la de cobros, quien pagó, la nota ni el id de la orden", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    await m.cupon(ana.token, codigo(1));
    m.h.sumar({ monto: "1.0000000", nota: NOTA }, { monto: "1.5000000", nota: NOTA }, { monto: "1.0000000", nota: "otra" });
    await m.pago(ana.token, ana.id);
    m.h.estado.caido = true;
    m.mover(10_000);
    await m.pago(ana.token, ana.id);
    const todo = JSON.stringify(m.anotado);
    expect(m.anotado.map(([e]) => e)).toEqual(expect.arrayContaining(["alta-orden", "alta-pago", "pago-suelto", "error-horizon"]));
    for (const prohibido of ["usr_ana", ana.cuenta as string, COBROS, PAGADOR, ID, ana.token]) expect(todo).not.toContain(prohibido);
  });
});
