/**
 * Además del tope por cuenta, un tope de devoluciones por día para todo el portero. Quien provoca sellos tardíos a
 * propósito con muchas cuentas no los hace gratis sin fin: pasado el tope, el sorteo no vuelve solo y queda anotado
 * para devolverlo a mano a quien de verdad lo perdió.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { DIA_MS } from "./config";
import { escena } from "./devolucion-prueba";
import { DEVOLUCIONES_POR_DIA, DEVOLUCIONES_POR_DIA_EN_TOTAL } from "./servicio";

describe("el tope de devoluciones por día de todo el portero", () => {
  it("es más alto que el de una cuenta", () => {
    expect(DEVOLUCIONES_POR_DIA_EN_TOTAL).toBeGreaterThan(DEVOLUCIONES_POR_DIA);
  });

  it("con el tope del día lleno entre muchas cuentas, la siguiente no vuelve sola y queda anotada para devolverla a mano", async () => {
    const s = escena();
    const m = await s.portero();
    for (let i = 0; i < DEVOLUCIONES_POR_DIA_EN_TOTAL; i++) {
      const org = s.admitida(1);
      const t = s.sello(org);
      expect((await m.procesar(t.xdr)).estado).toBe(200);
      s.entroTarde(t);
    }
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.e.cupos.resumen(s.e.ahora).devueltos24h).toBe(DEVOLUCIONES_POR_DIA_EN_TOTAL);

    // Una cuenta nueva, con ninguna devolución propia: igual no vuelve sola.
    const otra = s.admitida(1);
    const t = s.sello(otra);
    await m.procesar(t.xdr);
    s.entroTarde(t);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(otra)).toBe(0);
    expect(s.e.anotado).toContainEqual({ evento: "devolucion-negada", datos: { hash: t.hash.slice(0, 8), motivo: "tope-general" } });
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: t.hash, motivo: "tope-general" }]);
    expect(s.e.cupos.resumen(s.e.ahora)).toMatchObject({ devueltos24h: DEVOLUCIONES_POR_DIA_EN_TOTAL, porDevolver24h: 1 });
  });

  it("lo devuelto hace más de un día no cuenta para el tope de hoy", async () => {
    const s = escena();
    // Las del tope, todas de ayer: cuentas distintas, cada una con su sello fallido y devuelto.
    const ayer = s.e.ahora - DIA_MS - 60_000;
    const lim = { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000 };
    for (let i = 0; i < DEVOLUCIONES_POR_DIA_EN_TOTAL; i++) {
      const hash = (i + 1).toString(16).padStart(64, "0");
      s.e.cupos.reservar({ hash, cuenta: Keypair.random().publicKey(), metodo: "seal", estimado: 100_000, vence: Math.floor(ayer / 1000) + 240, ganadores: 1 }, ayer, lim);
      s.e.cupos.cerrar(hash, "fallo", 6_000);
      expect(s.e.cupos.devolverSelloTardio(hash, ayer, { ronda: 1, faltaban: 25, tope: DEVOLUCIONES_POR_DIA, topeGeneral: DEVOLUCIONES_POR_DIA_EN_TOTAL })).toMatchObject({ que: "devuelto" });
    }
    const m = await s.portero();
    const org = s.admitida(1);
    const t = s.sello(org);
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    expect(s.quedan(org)).toBe(0);
    s.entroTarde(t);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(org)).toBe(1);
  });
});
