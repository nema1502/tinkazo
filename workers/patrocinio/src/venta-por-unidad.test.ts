import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { AJUSTE_VENTA_PAUSADA, CONVERSION_MAXIMA, ORDEN_VIVE_MS, RESERVA_ORDEN_MS, productoPorUnidad } from "./cobros";
import { COBROS, IDS, PRECIOS_DE_PRUEBA, PRECIOS_POR_UNIDAD, montarPagos } from "./cobros-prueba";
import { DIA_MS, type Env, leerConfig, leerPrecios } from "./config";
import { preciosPublicos } from "./rutas-altas";

/**
 * La venta por unidad: 1 USDC por sorteo, de 5 a 50 por pago y de a 5, que valen un año. La orden lleva la cantidad, da
 * los sorteos de lo que llegó y lo que llega de más o dos veces se convierte en sorteos con los frenos de la venta de hoy.
 * Sin red: el Horizon y el Pollar son de mentira.
 */

const montar = (env: Partial<Env> = {}) => montarPagos({ PRECIOS: PRECIOS_POR_UNIDAD, ...env }, { porUnidad: true });
type M = ReturnType<typeof montar>;
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;
const quedan = (m: M, usuario = "usr_ana") => m.cupos.quedan({ usuario }, m.hora()).quedan;

/** Una persona con su orden por unidad de `cantidad` sorteos. */
async function conOrden(m: M, cantidad = 10, usuario = "usr_ana", cuenta?: string) {
  const p = cuenta ? m.persona(usuario, cuenta) : m.persona(usuario);
  const r = await m.ordenPorUnidad(p.token, cantidad);
  expect(r.estado).toBe(200);
  return { ...p, id: idDe(r) };
}

describe("el producto por unidad", () => {
  it("la cantidad arma el monto en el servidor: de 5 a 50, de a 5", () => {
    const unidad = leerPrecios("sorteo:1:1:365")?.[0];
    expect(unidad).toEqual({ id: "sorteo", usdc: "1", monto: 10_000_000, sorteos: 1, dias: 365 });
    const u = unidad as NonNullable<typeof unidad>;
    expect(productoPorUnidad(u, 5)).toEqual({ id: "sorteo", usdc: "5", monto: 50_000_000, sorteos: 5, dias: 365 });
    expect(productoPorUnidad(u, 50)).toEqual({ id: "sorteo", usdc: "50", monto: 500_000_000, sorteos: 50, dias: 365 });
    for (const mala of [0, 3, 4, 7, 55, 60, 10.5, -5, "10", null, undefined, Number.NaN]) expect(productoPorUnidad(u, mala), String(mala)).toBeNull();
  });

  it("un paquete fijo no se pide por cantidad", () => {
    const p10 = leerPrecios("alta:2:3:365,p10:5:10:365")?.[1];
    expect(productoPorUnidad(p10 as NonNullable<typeof p10>, 10)).toBeNull();
  });
});

describe("la orden por unidad", () => {
  it("lleva la cantidad: el total, los sorteos, la nota y el enlace con el monto que arma el servidor", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    const r = await m.ordenPorUnidad(ana.token, 10);
    const orden = { id: IDS[0], producto: "sorteo", usdc: "10", sorteos: 10, destino: COBROS, nota: `tk:o:${IDS[0]}` };
    expect(r).toMatchObject({ estado: 200, cuerpo: { orden } });
    const enlace = new URL((r.cuerpo as { orden: { enlace: string } }).orden.enlace);
    expect(enlace.searchParams.get("amount")).toBe("10");
    expect(m.cobros.orden(IDS[0] as string)).toMatchObject({ producto: "sorteo", monto: 100_000_000, sorteos: 10, dias: 365 });
  });

  it("la misma cantidad devuelve la abierta", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    expect(await m.ordenPorUnidad(ana.token, 10)).toMatchObject({ estado: 200, cuerpo: { orden: { id: ana.id, sorteos: 10 } } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
  });

  it("otra cantidad, sin nada recibido, reemplaza la abierta por una nueva", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    const r = await m.ordenPorUnidad(ana.token, 20);
    expect(r).toMatchObject({ estado: 200, cuerpo: { orden: { id: IDS[1], usdc: "20", sorteos: 20 } } });
    expect(m.cobros.orden(ana.id)).toMatchObject({ pagada: null, metodo: "reemplazada", reemplazada: m.hora() });
    expect(m.cobros.ordenAbierta("usr_ana", m.hora(), "sorteo")?.id).toBe(IDS[1]);
  });

  it("otra cantidad, con algo ya recibido, devuelve la abierta: no se cambia a mitad de un pago", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "3.0000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false, recibido: "3" } });
    expect(await m.ordenPorUnidad(ana.token, 20)).toMatchObject({ estado: 200, cuerpo: { orden: { id: ana.id, usdc: "10", sorteos: 10 } } });
    expect(m.cobros.orden(ana.id)).toMatchObject({ metodo: null });
  });

  it("una cantidad de 3, 7 o 55, o sin cantidad, es 400 forma y no crea nada", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    for (const mala of [3, 7, 55, undefined, "10", 12.5]) {
      expect(await m.ordenPorUnidad(ana.token, mala), String(mala)).toEqual({ estado: 400, cuerpo: { motivo: "forma" } });
    }
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(0);
  });

  it("sin el producto por unidad en PRECIOS, pedirlo es 400 producto, como cualquier producto que no se vende", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    expect(await m.ordenPorUnidad(ana.token, 10)).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
  });

  it("con la venta pausada no nace, y bajo el piso tampoco", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    expect(await m.ordenPorUnidad(ana.token, 10)).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "0", m.hora());
    m.pm.creditos = 0;
    m.mover(61_000);
    expect(await m.ordenPorUnidad(ana.token, 10)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
  });
});

describe("acreditar por unidad", () => {
  it("9 de 10 dan 9 sorteos y la orden sigue abierta con la misma nota", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "9.0000000", nota: `tk:o:${ana.id}` });
    const cuerpo = { pagada: false, recibido: "9", total: "10", minimo: "9.5", sorteosDados: 9 };
    expect(await m.pago(ana.token, ana.id)).toEqual({ estado: 200, cuerpo });
    expect(quedan(m)).toBe(9);
    expect(m.cobros.orden(ana.id)).toMatchObject({ pagada: null, metodo: null });
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "pago" });
    expect(m.anotado).toContainEqual(["orden-parte", { producto: "sorteo" }]);
    expect(await m.ordenPorUnidad(ana.token, 10)).toMatchObject({ cuerpo: { orden: { id: ana.id } } });
  });

  it("el dólar que falta completa a 10, sin dar dos veces lo ya dado", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "9.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${ana.id}` });
    const sorteos = { quedan: 10, proximoVence: { fecha: m.hora() + 365 * DIA_MS } };
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos } });
    expect(m.derechosDe("usr_ana").map((d) => d.sorteos)).toEqual([9, 1]);
    expect(m.cobros.orden(ana.id)).toMatchObject({ metodo: "usdc" });
    expect(m.sueltos()).toEqual([]);
  });

  it("9,50 de 10 dan los 10: el exchange descontó su comisión", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "9.5000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true, sorteos: { quedan: 10 } } });
    expect(m.sueltos()).toEqual([]);
  });

  it("12,40 sobre 10 dan 12 sorteos y 0,40 quedan sueltos", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    const [op] = m.h.sumar({ monto: "12.4000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(quedan(m)).toBe(12);
    expect(m.derechosDe("usr_ana")).toEqual([
      expect.objectContaining({ ref: `orden:${ana.id}:${op}`, sorteos: 10, origen: "paquete" }),
      expect.objectContaining({ ref: `conv:${op}`, sorteos: 2, origen: "paquete" }),
    ]);
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, monto: 4_000_000, motivo: "sobrante", orden: ana.id, estado: "suelto" })]);
    expect(m.anotado).toContainEqual(["orden-convertida", { producto: "sorteo" }]);
  });

  it("un pago repetido de 10 a una orden ya pagada da 10 sorteos más", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true, sorteos: { quedan: 20 } } });
    expect(m.sueltos()).toEqual([]);
  });

  it("un pago a la orden reemplazada, 20 minutos después, da sus sorteos", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    const nueva = idDe(await m.ordenPorUnidad(ana.token, 20));
    m.mover(20 * 60_000);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}`, ms: m.hora() });
    expect(await m.pago(ana.token, nueva)).toMatchObject({ cuerpo: { pagada: false, recibido: "0", sorteosDados: 0 } });
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([]);
    expect(m.cobros.orden(ana.id)).toMatchObject({ metodo: "reemplazada" });
  });

  it("con la venta pausada no convierte: lo repetido queda suelto", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    const [op] = m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, monto: 100_000_000, motivo: "repetido", orden: ana.id })]);
  });

  it("bajo el piso de créditos no convierte", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.pm.creditos = 0;
    m.mover(61_000);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "repetido", monto: 100_000_000 })]);
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso", donde: "conversion" }]);
  });

  it("sin un saldo de créditos guardado de hace menos de 10 minutos no convierte", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.pm.creditosCaido = true;
    m.mover(11 * 60_000);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "repetido" })]);
  });

  it("fuera del piloto no convierte: sin la cuenta de la lista atada, lo de más queda suelto", async () => {
    const g = Keypair.random().publicKey();
    const m = montar({ ORDEN_USDC_PILOTO: g });
    const ana = await conOrden(m, 10, "usr_ana", g);
    // El primer pago crea el alta sin cuenta: todavía no se sabe que es la de la lista.
    m.h.sumar({ monto: "15.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "sobrante", monto: 50_000_000 })]);
    // Ya con la cuenta atada (la ató la pregunta del pago), lo repetido sí se convierte.
    expect(m.cupos.altaDe("usr_ana")?.cuenta).toBe(g);
    m.h.sumar({ monto: "5.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(15);
  });

  it(`un pago de 80 a una orden pagada convierte ${CONVERSION_MAXIMA} y deja 30 sueltos`, async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    const [op] = m.h.sumar({ monto: "80.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10 + CONVERSION_MAXIMA);
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, monto: 300_000_000, motivo: "repetido" })]);
  });

  it("una orden cerrada para devolver nunca convierte", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "0.5000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(await m.admin.atender("ordenes-cerrar", { orden: ana.id, ref: "devolucion-0001" })).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    const [op] = m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    // La lista de sueltos lee antes lo nuevo: la orden cerrada ya no hace leer a quien la tenía.
    await m.admin.atender("sueltos-lista", {});
    expect(quedan(m)).toBe(0);
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, monto: 100_000_000, motivo: "cerrada", orden: ana.id })]);
  });

  it("una orden que ya dio sorteos con lo que llegó no se cierra para devolver", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "5.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    const r = await m.admin.atender("ordenes-cerrar", { orden: ana.id, ref: "devolucion-0001" });
    expect(r).toEqual({ estado: 409, cuerpo: { motivo: "con-sorteos" } });
    expect(m.cobros.orden(ana.id)).toMatchObject({ metodo: null });
  });

  it("marcada pagada a mano, da solo los sorteos que faltaban", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "6.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    const r = await m.admin.atender("ordenes-pagada", { orden: ana.id, metodo: "a-mano", ref: "constancia-0001" });
    expect(r).toEqual({ estado: 200, cuerpo: { ok: true, repetido: false } });
    expect(quedan(m)).toBe(10);
    expect(m.derechosDe("usr_ana").map((d) => d.sorteos)).toEqual([6, 4]);
  });

  it("sin la conversión armada, lo de más de una orden por unidad queda suelto como siempre", async () => {
    const m = montarPagos({ PRECIOS: PRECIOS_POR_UNIDAD });
    const ana = m.persona("usr_ana");
    const id = idDe(await m.ordenPorUnidad(ana.token, 5));
    m.h.sumar({ monto: "7.0000000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ cuerpo: { pagada: true, sorteos: { quedan: 5 } } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "sobrante", monto: 20_000_000 })]);
  });

  it("una orden de otro producto no cambia: lo de más queda suelto y la orden da todo de una vez", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    const id = idDe(await m.orden(ana.token, "p10"));
    m.h.sumar({ monto: "3.0000000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "3", total: "5", minimo: "4.75" } });
    expect(quedan(m)).toBe(0);
    m.h.sumar({ monto: "4.0000000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ cuerpo: { pagada: true, sorteos: { quedan: 10 } } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "sobrante", monto: 20_000_000 })]);
  });

  it("una orden por unidad vencida con algo recibido vuelve con la misma nota", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "4.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    m.mover(ORDEN_VIVE_MS + 1);
    expect(await m.ordenPorUnidad(ana.token, 10)).toMatchObject({ cuerpo: { orden: { id: ana.id, vence: m.hora() + ORDEN_VIVE_MS } } });
  });
});

describe("las órdenes abiertas reservan sus sorteos en el piso", () => {
  /** Lo que cuesta en créditos una orden de `n` sorteos de alguien sin alta: 40 por sorteo y 30 del alta. */
  const costoDe = (n: number) => 40 * n + 30;
  /** Créditos para abrir una orden de `n` sorteos con `margen` de sobra, sobre el piso de ahora y la reserva del evento (400). */
  const conLugarPara = (m: M, n: number, margen: number) => void (m.pm.creditos = m.puerta.piso(m.hora()) + 400 + costoDe(n) + margen);

  it("con lugar para una orden de 50, la de otra persona no nace mientras la primera sigue abierta", async () => {
    const m = montar();
    conLugarPara(m, 50, 1000);
    await conOrden(m, 50, "usr_ana");
    expect(m.cobros.sorteosEnOrdenesVivas(m.hora())).toBe(50);
    const beto = m.persona("usr_beto");
    expect(await m.ordenPorUnidad(beto.token, 50)).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso", donde: "orden" }]);
  });

  it("pasada la media hora, la orden olvidada deja de reservar y la otra persona la abre", async () => {
    const m = montar();
    conLugarPara(m, 50, 1000);
    await conOrden(m, 50, "usr_ana");
    m.mover(RESERVA_ORDEN_MS + 61_000);
    expect(m.cobros.sorteosEnOrdenesVivas(m.hora())).toBe(0);
    const beto = m.persona("usr_beto");
    expect(await m.ordenPorUnidad(beto.token, 50)).toMatchObject({ estado: 200, cuerpo: { orden: { sorteos: 50 } } });
  });

  it("la misma persona que cambia la cantidad no se frena con su propia orden", async () => {
    const m = montar();
    conLugarPara(m, 50, 1000);
    const ana = await conOrden(m, 50, "usr_ana");
    expect(m.cobros.sorteosEnOrdenesVivas(m.hora(), "usr_ana")).toBe(0);
    expect(await m.ordenPorUnidad(ana.token, 45)).toMatchObject({ estado: 200, cuerpo: { orden: { sorteos: 45 } } });
  });

  it("lo que una orden pagada a medias ya dio no se reserva dos veces, y la pagada ya no reserva", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "9.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(m.cobros.sorteosEnOrdenesVivas(m.hora())).toBe(1);
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(m.cobros.sorteosEnOrdenesVivas(m.hora())).toBe(0);
  });

  it("una orden abierta de otra persona también frena convertir lo que llegó dos veces", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    await conOrden(m, 50, "usr_beto");
    // Sin la orden de Beto, los 10 repetidos de Ana entrarían: 400 de costo con 1000 de sobra. Con ella faltan 2000.
    m.pm.creditos = m.puerta.piso(m.hora()) + 400 + 40 * 10 + 1000;
    m.mover(61_000);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    await m.pago(ana.token, ana.id);
    expect(quedan(m)).toBe(10);
    expect(m.sueltos()).toEqual([expect.objectContaining({ motivo: "repetido", monto: 100_000_000 })]);
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso", donde: "conversion" }]);
  });

  it("sin la venta por unidad la reserva es la de siempre: dos paquetes abiertos no se frenan entre sí", async () => {
    const m = montarPagos();
    m.pm.creditos = m.puerta.piso(m.hora()) + 400 + costoDe(10) + 100;
    expect((await m.orden(m.persona("usr_ana").token, "p10")).estado).toBe(200);
    expect((await m.orden(m.persona("usr_beto").token, "p10")).estado).toBe(200);
  });
});

describe("lo que publica /v1/alta/precios", () => {
  it("con el producto por unidad: el precio de un sorteo, el rango y los días", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: "sorteo:1:1:365" });
    const unidad = { producto: "sorteo", usdc: "1", minimo: 5, maximo: 50, paso: 5, dias: 365 };
    expect(preciosPublicos(cfg)).toMatchObject({ alta: null, paquetes: [], unidad });
  });

  it("sin él, lo de siempre y sin la clave nueva", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: PRECIOS_DE_PRUEBA });
    const p = preciosPublicos(cfg);
    expect(p).not.toHaveProperty("unidad");
    expect(p.paquetes).toEqual([
      { id: "p10", usdc: "5", sorteos: 10, dias: 365 },
      { id: "p50", usdc: "20", sorteos: 50, dias: 365 },
    ]);
  });

  it("con los paquetes al lado, el producto por unidad no aparece entre los paquetes", () => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: PRECIOS_POR_UNIDAD });
    const p = preciosPublicos(cfg);
    expect(p.paquetes).toEqual([{ id: "p10", usdc: "5", sorteos: 10, dias: 365 }]);
    expect(p.alta).toEqual({ usdc: "2", sorteos: 3, dias: 365 });
    expect(p.unidad).toMatchObject({ usdc: "1" });
  });
});

describe("el renglón que dice cómo prender la venta por unidad en la red principal", () => {
  const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const mainnet = texto.slice(texto.indexOf("[env.mainnet.vars]"));
  const sugerido = /^# La venta por unidad se prende[^\n]*PRECIOS = "([^"]+)"/m.exec(mainnet)?.[1];
  const hoy = /^PRECIOS = "([^"]*)"/m.exec(mainnet)?.[1];

  it("deja únicamente el producto por unidad, sin el primer paquete ni paquetes fijos", () => {
    expect(sugerido).toBe("sorteo:1:1:365");
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: sugerido ?? "" });
    const p = preciosPublicos(cfg);
    expect(p.alta).toBeNull();
    expect(p.paquetes).toEqual([]);
    expect(p.unidad).toMatchObject({ producto: "sorteo", usdc: "1", dias: 365 });
  });

  it("los precios de hoy no traen el producto sorteo: la venta por unidad sigue apagada", () => {
    expect(hoy).toBe("alta:4:3:90,p10:10:10:365");
    expect(hoy?.split(",").some((x) => x.startsWith("sorteo:"))).toBe(false);
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: hoy ?? "" });
    expect(preciosPublicos(cfg)).not.toHaveProperty("unidad");
  });
});
