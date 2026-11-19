import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { montarPagos } from "./cobros-prueba";
import type { Env } from "./config";

/**
 * Lo mínimo que tiene que llegar para que una orden quede pagada: el 95 % del precio del paquete (los exchanges
 * descuentan su comisión) más el recargo del QR entero. El recargo paga la verificación y la carga, que no tienen
 * tolerancia. Con los números de la semana: el primer paquete por QR (4 más 4) queda pagado desde 7,80, no desde 7,60,
 * y el de diez con el recargo de las siguientes (10 más 0,50) desde 10, no desde 9,975. Una orden sin recargo sigue
 * igual: desde el 95 %. Todo en enteros.
 */

const cuenta = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const [ANA, BETO] = [cuenta(51), cuenta(52)] as [string, string];
const PILOTO: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "6", COMPRAS_QR_PILOTO: `${ANA},${BETO}`, RESERVA_CARGA_CREDITOS: "8400", RECARGO_QR: "4:0.50", PRECIOS: "alta:4:3:90,p10:10:10:365" };
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;

describe("el mínimo de una orden con el recargo del QR", () => {
  it("el primer paquete por QR: 7,60 no alcanza, 7,80 sí", async () => {
    const m = montarPagos(PILOTO);
    const ana = m.persona("usr_ana", ANA);
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const id = idDe(await m.orden(ana.token, "alta"));
    expect(await m.pago(ana.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "0", total: "8", minimo: "7.8" } });
    m.h.sumar({ monto: "7.6000000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "7.6", total: "8", minimo: "7.8" } });
    // Lo que administración ve de una pagada a medias dice el mismo mínimo.
    expect(m.cobros.parciales(m.hora())).toMatchObject([{ id, recibido: "7.6", total: "8", minimo: "7.8" }]);
    m.h.sumar({ monto: "0.1999999", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ estado: 200, cuerpo: { pagada: false, recibido: "7.7999999" } });
    m.h.sumar({ monto: "0.0000001", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
  });

  it("el de diez con el recargo de las siguientes: 9,975 no alcanza, 10 sí", async () => {
    const m = montarPagos(PILOTO);
    const ana = m.persona("usr_ana", ANA);
    // Primero paga el primer paquete con su recargo: desde ahí le toca el de las siguientes.
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const primera = idDe(await m.orden(ana.token, "alta"));
    m.h.sumar({ monto: "8.0000000", nota: `tk:o:${primera}` });
    expect(await m.pago(ana.token, primera)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { permiso: { recargo: "0.5", total: "10.5", primera: false } } });
    await m.cargar(ana.token, "p10");
    const id = idDe(await m.orden(ana.token, "p10"));
    m.h.sumar({ monto: "9.9750000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "9.975", total: "10.5", minimo: "10" } });
    m.h.sumar({ monto: "0.0250000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("una orden sin recargo sigue quedando pagada desde el 95 %", async () => {
    const m = montarPagos(PILOTO);
    const beto = m.persona("usr_beto", BETO);
    const id = idDe(await m.orden(beto.token, "alta"));
    expect(await m.pago(beto.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "0", total: "4", minimo: "3.8" } });
    m.h.sumar({ monto: "3.8000000", nota: `tk:o:${id}` });
    expect(await m.pago(beto.token, id)).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
  });

  it("el cálculo es en enteros: el 95 % del precio redondeado para arriba, más el recargo entero", () => {
    const m = montarPagos(PILOTO);
    // Sin recargo, el 95 % de todo, redondeado para arriba.
    expect(m.cobros.minimoDeOrden({ id: "SINORDEN", monto: 40_000_001 })).toBe(38_000_001);
    // Una orden de 1 diezmillonésima de precio con 4 de recargo: el 95 % de 1 redondeado para arriba es 1.
    m.sql.exec("INSERT INTO ordenes (id, usuario, producto, monto, sorteos, dias, creada, vence, pagada, metodo, ref) VALUES ('ABCD2345', 'usr_x', 'alta', 40000001, 3, 90, 0, 1, NULL, NULL, NULL)");
    m.sql.exec("INSERT INTO compras_qr_ordenes (orden, compra, recargo) VALUES ('ABCD2345', 1, 40000000)");
    expect(m.cobros.minimoDeOrden({ id: "ABCD2345", monto: 40_000_001 })).toBe(40_000_001);
    m.sql.exec("UPDATE ordenes SET monto = 80000000 WHERE id = 'ABCD2345'");
    expect(m.cobros.minimoDeOrden({ id: "ABCD2345", monto: 80_000_000 })).toBe(78_000_000);
    for (const n of [m.cobros.minimoDeOrden({ id: "ABCD2345", monto: 80_000_000 }), m.cobros.minimoDeOrden({ id: "OTRA", monto: 33_333_333 })]) expect(Number.isInteger(n)).toBe(true);
  });
});
