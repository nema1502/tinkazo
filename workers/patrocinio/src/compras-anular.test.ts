import { describe, expect, it } from "vitest";
import { Administracion, atenderAdmin } from "./admin";
import { GRACIA_REEMPLAZO_MS } from "./cobros";
import { montarPagos } from "./cobros-prueba";
import { ComprasQr } from "./compras";
import { DIA_MS, type Env, leerConfig } from "./config";
import { PorIp } from "./por-ip";
import { ANULAR_COMPRA_MS, type AccionCompra, atenderAlta } from "./rutas-altas";

/**
 * Anular una compra con QR que no se pagó: la salida de una carga que nunca tuvo QR. Sin esto, si la orden de carga
 * falla después del aviso, el recargo queda atado a la persona y cada orden suya lo lleva, de cualquier producto y para
 * siempre, y su reserva de créditos sigue apartada. Por administración, con la clave de operar
 * (`POST /v1/admin/compras/cerrar`). Precios de prueba: el primer paquete a 2 USDC y el de diez a 5. Recargo, 4,25.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5" };
const montar = (env: Partial<Env> = {}) => montarPagos({ ...ABIERTA, ...env });
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

/** La reserva del primer paquete la primera vez: 380 de la carga, 3 sorteos por 40 y la activación, 30. */
const RESERVA_ALTA = 380 + 3 * 40 + 30;
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;
const compraDe = (m: M, usuario: string) => Number(m.sql.exec("SELECT id FROM compras_qr WHERE usuario = ? ORDER BY id DESC LIMIT 1", usuario).toArray()[0]?.id);
const cerrar = (m: M, cuerpo: Record<string, unknown>) => m.admin.atender("compras-cerrar", cuerpo);

describe("anular una compra por administración", () => {
  it("el caso de la semana: cargada sin QR, a los 8 días la orden de diez lleva el recargo; anulada, sale sin él y empezar ya no da compra-en-curso", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    m.mover(8 * DIA_MS);
    // Hoy: la orden del paquete de diez trae el recargo del primer paquete que nunca tuvo QR.
    const conRecargo = await m.orden(ana.token, "p10");
    expect(conRecargo).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "p10", usdc: "9.25", precio: "5", recargo: "4.25" } } });
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 409, cuerpo: { motivo: "compra-en-curso" } });
    const id = compraDe(m, "usr_ana");
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0001" })).toEqual({
      estado: 200,
      cuerpo: { ok: true, repetido: false, compra: id, producto: "alta", motivo: "anulada", cargada: true, reemplazadas: 1 },
    });
    // La orden con el recargo quedó cerrada: no se completa y quien pregunta por ella pide otra.
    expect(m.cobros.orden(idDe(conRecargo))).toMatchObject({ pagada: null, metodo: "reemplazada" });
    expect(await m.pago(ana.token, idDe(conRecargo))).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    const sinRecargo = await m.orden(ana.token, "p10");
    expect(sinRecargo).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "p10", usdc: "5" } } });
    expect(Object.keys((sinRecargo.cuerpo as { orden: object }).orden)).not.toContain("recargo");
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "p10", recargo: "4.25", primera: true, cargada: false } } });
    expect(m.adminAnotadoDe("admin-compra")).toEqual([["admin-compra", { accion: "anulada", producto: "alta", cargada: 1, reemplazadas: 1 }]]);
    expect(JSON.stringify(m.anotado)).not.toContain("usr_ana");
  });

  it("la reserva se suelta: las reservas ya no cuentan la anulada, cargada o sin cargar", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const beto = enPiloto(m, "usr_beto");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    await m.empezar(beto.token, "alta");
    expect(m.compras.reservas(m.hora())).toBe(2 * RESERVA_ALTA);
    expect((await cerrar(m, { compra: compraDe(m, "usr_ana"), ref: "soporte-0002" })).estado).toBe(200);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    // Un permiso sin cargar también se anula: no tiene recargo, pero su reserva queda libre antes de los 7 días.
    expect(await cerrar(m, { usuario: "usr_beto", ref: "soporte-0003" })).toMatchObject({ estado: 200, cuerpo: { repetido: false, cargada: false, reemplazadas: 0 } });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(m.compras.activa("usr_beto", m.hora())).toBeNull();
    expect((await m.puerta.resumen()).reservasCompras).toBe(0);
  });

  it("cerrar otra vez es lo mismo: repetido y sin cambiar nada; por la persona, sin compra en curso, 404", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const id = compraDe(m, "usr_ana");
    const primera = await cerrar(m, { compra: id, ref: "soporte-0004" });
    const cerrada = m.compras.porId(id);
    m.mover(60_000);
    expect(await cerrar(m, { compra: id, ref: "soporte-0004" })).toEqual({ ...primera, cuerpo: { ...(primera.cuerpo as object), repetido: true, reemplazadas: 0 } });
    expect(m.compras.porId(id)).toEqual(cerrada);
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0004" })).toEqual({ estado: 404, cuerpo: { motivo: "compra" } });
    expect(await cerrar(m, { compra: id + 1, ref: "x" })).toEqual({ estado: 404, cuerpo: { motivo: "compra" } });
    expect(m.adminAnotadoDe("admin-compra")).toHaveLength(1);
  });

  it("con una orden suya que recibió algo, 409 orden-con-pago y no cambia nada: el pago llegó y nadie lo tocó todavía", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const orden = idDe(await m.orden(ana.token, "alta"));
    // El pago entró a la red y el portero todavía no lo leyó: cerrar lo lee antes de decidir.
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${orden}` });
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0005" })).toEqual({ estado: 409, cuerpo: { motivo: "orden-con-pago" } });
    expect(m.cobros.recibido(orden)).toBe(10_000_000);
    expect(m.cobros.orden(orden)).toMatchObject({ pagada: null, metodo: null });
    expect(m.compras.pendiente("usr_ana")).not.toBeNull();
  });

  it("un pago suelto de una orden suya sin resolver también frena; devuelto, la compra se anula", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const a = idDe(await m.orden(ana.token, "alta"));
    // Pedir el de diez reemplaza la orden del primero, que sigue atada a la compra.
    const b = idDe(await m.orden(ana.token, "p10"));
    expect(m.cobros.orden(a)).toMatchObject({ metodo: "reemplazada" });
    // Entra a la red pasados los 2 minutos del reemplazo (el Horizon de mentira fecha en septiembre si no se le dice).
    const [op] = m.h.sumar({ monto: "6.2500000", nota: `tk:o:${a}`, ms: m.hora() + GRACIA_REEMPLAZO_MS + 1 });
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0006" })).toEqual({ estado: 409, cuerpo: { motivo: "orden-con-pago" } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, motivo: "cerrada", orden: a, estado: "suelto" })]);
    expect(m.cobros.orden(b)).toMatchObject({ pagada: null, metodo: null });
    m.cobros.devolver({ operacion: op as string, ref: "devolucion-0001" });
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0006" })).toMatchObject({ estado: 200, cuerpo: { repetido: false, reemplazadas: 1 } });
    expect(m.cobros.orden(b)).toMatchObject({ metodo: "reemplazada" });
  });

  it("lo que llegó a una orden cerrada para devolver no frena: esa plata ya la devuelve administración", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const a = idDe(await m.orden(ana.token, "alta"));
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${a}` });
    await m.pago(ana.token, a);
    expect(await m.admin.atender("ordenes-cerrar", { orden: a, ref: "devolucion-0002" })).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0007" })).toMatchObject({ estado: 200, cuerpo: { repetido: false, reemplazadas: 0 } });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
  });

  it("una compra ya pagada no se anula: 409 compra-pagada", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const id = compraDe(m, "usr_ana");
    const orden = idDe(await m.orden(ana.token, "alta"));
    expect(await m.admin.atender("ordenes-pagada", { orden, metodo: "a-mano", ref: "comprobante-0001" })).toMatchObject({ estado: 200 });
    expect(await cerrar(m, { compra: id, ref: "soporte-0008" })).toEqual({ estado: 409, cuerpo: { motivo: "compra-pagada" } });
    expect(m.compras.porId(id)).toMatchObject({ cerrada: null, motivo: null });
    expect(m.compras.pagoLaPrimera("usr_ana")).toBe(true);
  });

  it("con Horizon caído y órdenes sin pagar, 502 red y no anula; sin órdenes no hace falta leer", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const beto = enPiloto(m, "usr_beto");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    await m.orden(ana.token, "alta");
    await m.empezar(beto.token, "alta");
    await m.cargar(beto.token, "alta");
    m.h.estado.caido = true;
    expect(await cerrar(m, { usuario: "usr_ana", ref: "soporte-0009" })).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.compras.pendiente("usr_ana")).not.toBeNull();
    const pedidos = m.h.estado.pedidos.length;
    expect((await cerrar(m, { usuario: "usr_beto", ref: "soporte-0010" })).estado).toBe(200);
    expect(m.h.estado.pedidos).toHaveLength(pedidos);
    m.h.estado.caido = false;
    expect((await cerrar(m, { usuario: "usr_ana", ref: "soporte-0009" })).estado).toBe(200);
  });

  it("lo mal escrito da 400 cuerpo y no toca nada; con las altas apagadas no hay administración", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    const id = compraDe(m, "usr_ana");
    const malos: Array<Record<string, unknown>> = [
      {},
      { compra: id },
      { usuario: "usr_ana" },
      { compra: id, usuario: "usr_ana", ref: "x" },
      { compra: String(id), ref: "x" },
      { compra: 0, ref: "x" },
      { compra: 1.5, ref: "x" },
      { usuario: "", ref: "x" },
      { usuario: "usr ana", ref: "x" },
      { compra: id, ref: "con espacios" },
      { compra: id, ref: "" },
    ];
    for (const malo of malos) expect(await cerrar(m, malo), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    expect(m.compras.porId(id)).toMatchObject({ cerrada: null });
    expect(await montar({ ALTAS: "0" }).admin.atender("compras-cerrar", { compra: 1, ref: "x" })).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
  });

  it("anda con la venta y la compra con QR apagadas y fuera del piloto: es para soltar lo que quedó pegado", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    m.cupos.transaccion(() => m.compras.sacarPiloto(ana.cuenta as string));
    // El mismo objeto después de desplegar con todo cerrado.
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", COMPRAS_QR: "0", CARGAS: "0", ALTAS_PAGO: "0" });
    const admin = new Administracion({ cfg, cupos: m.cupos, altas: m.altas, cuponSecreto: null, red: m.red, reloj: m.hora, cobros: m.cobros, lector: m.lector, compras: new ComprasQr(m.sql, cfg) });
    expect(await admin.atender("compras-cerrar", { usuario: "usr_ana", ref: "soporte-0011" })).toMatchObject({ estado: 200, cuerpo: { motivo: "anulada", cargada: true } });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    expect(m.compras.reservas(m.hora())).toBe(0);
  });
});

describe("la persona anula su compra cargada: POST /v1/compra/anular", () => {
  it("dentro de los 30 minutos y sin pagos: suelta la reserva y no el recargo, su orden sigue y otra vez da repetido", async () => {
    // Cambia a propósito: la anulación de la persona ya no suelta el recargo (compras-recargo.test.ts).
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const conRecargo = idDe(await m.orden(ana.token, "alta"));
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    m.mover(10 * 60_000);
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: false } });
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ cerrada: null, reserva: 0 });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(m.cobros.orden(conRecargo)).toMatchObject({ pagada: null, metodo: null });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "6.25" } } });
    expect(m.anotado).toContainEqual(["compra-soltada", { producto: "alta" }]);
    // Pedirlo otra vez (la respuesta se perdió) es lo mismo, sin anotar otra vez.
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: true } });
    expect(m.anotado.filter(([e]) => e === "compra-soltada")).toHaveLength(1);
    expect(JSON.stringify(m.anotado)).not.toContain("usr_ana");
    // La próxima vez renueva la misma compra, con su recargo.
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { permiso: { recargo: "4.25", cargada: true } } });
  });

  it("a los 30 minutos justos todavía; un milisegundo después, 409 plazo-vencido y la compra sigue", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const beto = enPiloto(m, "usr_beto");
    for (const p of [ana, beto]) {
      await m.empezar(p.token, "alta");
      await m.cargar(p.token, "alta");
    }
    m.mover(ANULAR_COMPRA_MS);
    expect((await m.anular(ana.token, "alta")).estado).toBe(200);
    m.mover(1);
    expect(await m.anular(beto.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "plazo-vencido" } });
    expect(m.compras.pendiente("usr_beto")).not.toBeNull();
    // Administración sí la puede anular.
    expect((await cerrar(m, { usuario: "usr_beto", ref: "soporte-0013" })).estado).toBe(200);
  });

  it("sin compra cargada 404 sin-compra y no toca el permiso; su compra es de otro producto, 409 compra-en-curso; lo mal escrito, 400", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 404, cuerpo: { motivo: "sin-compra" } });
    await m.empezar(ana.token, "alta");
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 404, cuerpo: { motivo: "sin-compra" } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    await m.cargar(ana.token, "alta");
    expect(await m.anular(ana.token, "p10")).toMatchObject({ estado: 409, cuerpo: { motivo: "compra-en-curso", permiso: { producto: "alta", cargada: true } } });
    for (const malo of ["p20", "", 3, null, undefined]) expect(await m.anular(ana.token, malo)).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
    expect(await m.anular(null, "alta")).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    // Beto no puede anular la compra de Ana: cada uno ve solo la suya.
    const beto = m.persona("usr_beto");
    expect(await m.anular(beto.token, "alta")).toEqual({ estado: 404, cuerpo: { motivo: "sin-compra" } });
    expect(m.compras.pendiente("usr_ana")).not.toBeNull();
  });

  it("una orden con recargo que recibió algo frena: 409 orden-con-pago; con Horizon caído, 502 red sin anular", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const orden = idDe(await m.orden(ana.token, "alta"));
    m.h.estado.caido = true;
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.compras.pendiente("usr_ana")).not.toBeNull();
    m.h.estado.caido = false;
    // Pagó con su saldo y el portero todavía no lo vio: anular lo lee antes.
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${orden}` });
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "orden-con-pago" } });
    expect(m.cobros.orden(orden)).toMatchObject({ pagada: null, metodo: null });
    expect(m.cobros.recibido(orden)).toBe(20_000_000);
  });

  it("sin órdenes no hace falta Horizon; anda con la compra con QR apagada y fuera del piloto", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "p10");
    await m.cargar(ana.token, "p10");
    m.cupos.transaccion(() => m.compras.sacarPiloto(ana.cuenta as string));
    m.h.estado.caido = true;
    const pedidos = m.h.estado.pedidos.length;
    expect(await m.conVariables({ COMPRAS_QR: "0", CARGAS: "0" }).anular(ana.token, "p10")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: false } });
    expect(m.h.estado.pedidos).toHaveLength(pedidos);
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ reserva: 0 });
  });

  it("la puerta del Worker la pasa al objeto con el token y el cuerpo", async () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
    const vistos: Array<[string, unknown]> = [];
    const llamarCompra = async (accion: AccionCompra, p: { token: string | null; cuerpo: unknown }) => (vistos.push([accion, { token: p.token, cuerpo: p.cuerpo }]), { estado: 200, cuerpo: { visto: accion } });
    const nada = async () => ({ estado: 500, cuerpo: {} });
    const pedido = new Request("https://pm.tinkazo.app/v1/compra/anular", {
      method: "POST",
      headers: { Origin: "https://tinkazo.app", "CF-Connecting-IP": "190.129.10.20", Authorization: "Bearer tok_abc", "Content-Type": "application/json" },
      body: JSON.stringify({ producto: "alta" }),
    });
    const r = (await atenderAlta(pedido, cfg, nada, new PorIp(), nada, llamarCompra)) as Response;
    expect([r.status, await r.json()]).toEqual([200, { visto: "anular" }]);
    expect(vistos).toEqual([["anular", { token: "tok_abc", cuerpo: { producto: "alta" } }]]);
  });
});

describe("la ruta de administración en la puerta del Worker", () => {
  const CUPONES = "c".repeat(40);
  const OPERAR = "o".repeat(40);
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const env = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
  const pedido = (clave: string, init: RequestInit = {}) =>
    new Request("https://pm.tinkazo.app/v1/admin/compras/cerrar", { method: init.method ?? "POST", headers: { Authorization: `Bearer ${clave}` }, body: init.body });

  it("POST /v1/admin/compras/cerrar va con la clave de operar; con la de cupones, 401; otro método, 405", async () => {
    const vistos: Array<[string, unknown]> = [];
    const llamar = async (accion: string, datos: unknown) => (vistos.push([accion, datos]), { estado: 200, cuerpo: { ok: true } });
    expect((await atenderAdmin(pedido(OPERAR, { body: JSON.stringify({ compra: 7, ref: "soporte-0012" }) }), env, cfg, llamar))?.status).toBe(200);
    expect(vistos).toEqual([["compras-cerrar", { compra: 7, ref: "soporte-0012" }]]);
    expect((await atenderAdmin(pedido(CUPONES, { body: "{}" }), env, cfg, llamar))?.status).toBe(401);
    expect((await atenderAdmin(pedido(OPERAR, { method: "GET" }), env, cfg, llamar))?.status).toBe(405);
    // Sin la clave de operar cargada, la ruta no existe.
    expect((await atenderAdmin(pedido(OPERAR, { body: "{}" }), { CUPONES_TOKEN: CUPONES }, cfg, llamar))?.status).toBe(404);
    expect(vistos).toHaveLength(1);
  });
});
