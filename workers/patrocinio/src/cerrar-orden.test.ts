import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { type AccionAdmin, atenderAdmin } from "./admin";
import { COBROS, IDS, PAGADOR, montarPagos } from "./cobros-prueba";
import { DIA_MS, leerConfig } from "./config";

/**
 * Devolver un pago a medias: primero se cierra la orden en el servidor y después se devuelve a mano lo que llegó. Una
 * orden cerrada no se completa nunca: lo que llegue después con su nota va a los sueltos, para devolverlo también.
 */

const ID = IDS[0] as string;
const NOTA = `tk:o:${ID}`;

async function conOrden(m: ReturnType<typeof montarPagos>, usuario = "usr_ana", producto = "alta") {
  const p = m.persona(usuario);
  const r = await m.orden(p.token, producto);
  expect(r.estado).toBe(200);
  return { ...p, id: (r.cuerpo as { orden: { id: string } }).orden.id };
}

describe("cerrar una orden pagada a medias (POST /v1/admin/ordenes/cerrar)", () => {
  it("cierra la orden y dice qué devolver y a quién; lo que llega después con su nota no la completa: va a los sueltos", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const otro = Keypair.random().publicKey();
    const [uno, dos] = m.h.sumar({ monto: "1.0000000", nota: NOTA }, { monto: "0.5000000", nota: NOTA, de: otro });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "1.5" } });

    const r = await m.admin.atender("ordenes-cerrar", { orden: ID.toLowerCase(), ref: "devolucion-0003" });
    expect(r).toEqual({
      estado: 200,
      cuerpo: {
        ok: true,
        repetido: false,
        recibido: "1.5",
        devolver: [
          { operacion: uno, de: PAGADOR, cantidad: "1", tx: `tx${uno}` },
          { operacion: dos, de: otro, cantidad: "0.5", tx: `tx${dos}` },
        ],
      },
    });
    expect(m.cobros.orden(ID)).toMatchObject({ pagada: null, metodo: "devuelta", ref: "devuelta:devolucion-0003" });
    expect(m.adminAnotadoDe("admin-cerrada")).toEqual([["admin-cerrada", { producto: "alta" }]]);
    // Otra vez, lo mismo, sin anotar de nuevo.
    expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "devolucion-0003" })).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: true, recibido: "1.5" } });
    expect(m.adminAnotadoDe("admin-cerrada")).toHaveLength(1);

    // La persona completa sin saber: no queda pagada, no recibe nada y el pago queda para devolver.
    const [tarde] = m.h.sumar({ monto: "1.0000000", nota: NOTA });
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    await m.admin.atender("sueltos-lista", {});
    expect(m.cobros.orden(ID)?.pagada).toBeNull();
    expect(m.derechosDe("usr_ana")).toEqual([]);
    expect(m.sueltos()).toEqual([{ operacion: tarde, activo: "USDC", monto: 10_000_000, nota: NOTA, motivo: "cerrada", estado: "suelto", orden: ID }]);
    // Ya no figura entre las pagadas a medias ni como su orden abierta; puede pedir otra, con otra nota.
    expect((await m.admin.atender("sueltos-lista", {})).cuerpo).not.toHaveProperty("parciales");
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "ninguno", orden: null } });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[1], nota: `tk:o:${IDS[1]}` } } });
  });

  it("lee antes los pagos nuevos: si ya se completó, no se cierra (409 orden-pagada) y no hay nada que devolver", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    // Completa y nadie tocó «Ya pagué»: el cierre lo lee primero.
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "devolucion-0004" })).toEqual({ estado: 409, cuerpo: { motivo: "orden-pagada" } });
    expect(m.cobros.orden(ID)).toMatchObject({ metodo: "usdc" });
    expect(m.derechosDe("usr_ana")).toHaveLength(1);
  });

  it("con Horizon caído no se cierra: 502 red, sin tocar la orden", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    m.mover(10_000);
    m.h.estado.caido = true;
    expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "devolucion-0005" })).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.cobros.orden(ID)).toMatchObject({ pagada: null, metodo: null });
  });

  it("sin nada recibido, 409 sin-pagos; una orden que no existe, 404; un cuerpo raro, 400", async () => {
    const m = montarPagos();
    await conOrden(m);
    expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "x" })).toEqual({ estado: 409, cuerpo: { motivo: "sin-pagos" } });
    expect(await m.admin.atender("ordenes-cerrar", { orden: "ZZZZ9999", ref: "x" })).toEqual({ estado: 404, cuerpo: { motivo: "orden" } });
    for (const malo of [{ orden: "no" }, { ref: "" }, { ref: "con espacio" }, { ref: 3 }]) {
      expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "x", ...malo }), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(m.cobros.orden(ID)?.metodo).toBeNull();
  });

  it("una orden cerrada no se marca pagada a mano ni recibe un suelto asignado; ese suelto se devuelve", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    expect((await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "devolucion-0006" })).estado).toBe(200);
    expect(await m.admin.atender("ordenes-pagada", { orden: ID, metodo: "qr-bs", ref: "comprobante-0003" })).toEqual({ estado: 409, cuerpo: { motivo: "orden-cerrada" } });
    const [sinNota] = m.h.sumar({ monto: "2.0000000" });
    await m.admin.atender("sueltos-lista", {});
    expect(await m.admin.atender("sueltos-asignar", { operacion: sinNota, orden: ID })).toEqual({ estado: 409, cuerpo: { motivo: "orden-cerrada" } });
    expect(await m.admin.atender("sueltos-asignar", { operacion: sinNota, devuelto: true, ref: "devolucion-0007" })).toEqual({ estado: 200, cuerpo: { ok: true, repetido: false } });
    expect(m.derechosDe("usr_ana")).toEqual([]);
  });

  it("un pago de una orden cerrada se puede asignar a la orden nueva de la misma persona", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "1.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "devolucion-0008" });
    const [tarde] = m.h.sumar({ monto: "2.0000000", nota: NOTA });
    await m.admin.atender("sueltos-lista", {});
    const nueva = await conOrden(m);
    expect(nueva.id).toBe(IDS[1]);
    expect(await m.admin.atender("sueltos-asignar", { operacion: tarde, orden: nueva.id })).toEqual({ estado: 200, cuerpo: { ok: true, pagada: true, sobrante: "0" } });
    expect(await m.pago(ana.token, nueva.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
  });

  it("una orden ya pagada no se cierra", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000", nota: NOTA });
    await m.pago(ana.token, ana.id);
    m.mover(DIA_MS);
    expect(await m.admin.atender("ordenes-cerrar", { orden: ID, ref: "x" })).toEqual({ estado: 409, cuerpo: { motivo: "orden-pagada" } });
  });

  it("la ruta va con la clave de cupones; la de operar no cierra órdenes", async () => {
    const OPERAR = "o".repeat(40);
    const CUPONES = "k".repeat(40);
    const conf = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", CUENTA_COBROS: COBROS });
    const vistos: AccionAdmin[] = [];
    const llamar = async (accion: AccionAdmin) => (vistos.push(accion), { estado: 200, cuerpo: {} });
    const pedido = (clave: string, metodo = "POST") =>
      new Request("https://pm.tinkazo.app/v1/admin/ordenes/cerrar", { method: metodo, headers: { Authorization: `Bearer ${clave}` }, ...(metodo === "GET" ? {} : { body: JSON.stringify({ orden: ID, ref: "x" }) }) });
    const entorno = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
    expect((await atenderAdmin(pedido(OPERAR), entorno, conf, llamar))?.status).toBe(401);
    expect((await atenderAdmin(pedido(CUPONES, "GET"), entorno, conf, llamar))?.status).toBe(405);
    expect((await atenderAdmin(pedido(CUPONES), entorno, conf, llamar))?.status).toBe(200);
    expect(vistos).toEqual(["ordenes-cerrar"]);
  });
});
