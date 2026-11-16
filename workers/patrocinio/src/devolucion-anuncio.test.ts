/**
 * El portero que devuelve el sorteo de un sello que entró tarde lo dice en `/cupo` (`devuelve: true`). El sitio no sabe
 * qué portero tiene delante: solo con ese campo promete la devolución. Un portero de antes no lo manda. Y el portero
 * nuevo lo dice solo mientras de verdad va a devolver: con el tope del día de la cuenta, o el de todo el portero, lleno,
 * manda `devuelve: false`.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { DIA_MS } from "./config";
import { escena } from "./devolucion-prueba";
import { DEVOLUCIONES_POR_DIA, DEVOLUCIONES_POR_DIA_EN_TOTAL, type Portero } from "./servicio";

describe("/cupo anuncia que el portero devuelve los sellos que entraron tarde", () => {
  it("en la red principal con las altas, y lo que ya mandaba sigue igual: solo se suma el campo", async () => {
    const s = escena();
    const m = await s.portero();
    const org = s.admitida(1);
    const r = await m.cupoDe(org.publicKey());
    expect(r.estado).toBe(200);
    expect(r.cuerpo.devuelve).toBe(true);
    expect(Object.keys(r.cuerpo).sort()).toEqual(["devuelve", "liberaEn", "mes", "oficial", "prendido", "red", "rige", "sellos", "sorteos"]);
    expect(r.cuerpo).toMatchObject({ prendido: true, rige: "portero", red: "mainnet", oficial: { acceso: true, sorteos: { quedan: 1 } } });
  });

  it("en la red de prueba también: ahí vuelve el sello del mes", async () => {
    const s = escena();
    const m = await s.portero({ RED: "testnet", ALTAS: "0" });
    const r = await m.cupoDe(Keypair.random().publicKey());
    expect(r.estado).toBe(200);
    expect(r.cuerpo.devuelve).toBe(true);
  });

  it("una cuenta mal escrita sigue dando 400, sin nada más", async () => {
    const s = escena();
    const m = await s.portero();
    expect(await m.cupoDe("no-es-una-cuenta")).toEqual({ estado: 400, cuerpo: { motivo: "cuenta" } });
  });
});

describe("/cupo promete la devolución solo si el portero la va a hacer", () => {
  /** Un sello de cada cuenta que entra tarde y la alarma devuelve: cada una queda como estaba y suma una devolución. */
  async function devueltos(s: ReturnType<typeof escena>, m: Portero, cuentas: Keypair[]): Promise<void> {
    for (const org of cuentas) {
      const t = s.sello(org);
      expect((await m.procesar(t.xdr)).estado).toBe(200);
      s.entroTarde(t);
    }
    s.pasaLaEspera();
    await m.reconciliar();
  }
  const unoDevuelto = (s: ReturnType<typeof escena>, m: Portero, org: Keypair) => devueltos(s, m, [org]);

  it("con el tope de la cuenta lleno, el sello tardío que sigue no vuelve y /cupo no lo promete", async () => {
    const s = escena();
    const m = await s.portero();
    const org = s.admitida(1);
    for (let i = 0; i < DEVOLUCIONES_POR_DIA - 1; i++) await unoDevuelto(s, m, org);
    // Por debajo del tope, todavía se devuelve: se promete.
    expect((await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe(true);
    await unoDevuelto(s, m, org);
    expect(s.quedan(org)).toBe(1);
    expect(s.e.cupos.resumen(s.e.ahora).devueltos24h).toBe(DEVOLUCIONES_POR_DIA);
    // Con el tope lleno ya no: el sitio lo sabe antes de pedir la firma.
    expect((await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe(false);

    // Una noche mala con la cuenta en el tope: el siguiente entra tarde y falla, y el reintento pide /cupo antes de la
    // firma. /cupo lo cierra con la red, el tope lo deja para devolver a mano y la respuesta dice cero sorteos sin
    // prometer nada.
    const t = s.sello(org);
    expect((await m.procesar(t.xdr)).estado).toBe(200);
    s.entroTarde(t);
    const r = await m.cupoDe(org.publicKey());
    expect(s.e.anotado).toContainEqual({ evento: "devolucion-negada", datos: { hash: t.hash.slice(0, 8), motivo: "tope" } });
    expect(r.estado).toBe(200);
    expect(r.cuerpo).toMatchObject({ prendido: true, rige: "portero", oficial: { acceso: true, sorteos: { quedan: 0 } }, devuelve: false });
  });

  it("pasado el día, la devolución vuelve a prometerse", async () => {
    const s = escena();
    const m = await s.portero();
    const org = s.admitida(1);
    for (let i = 0; i < DEVOLUCIONES_POR_DIA; i++) await unoDevuelto(s, m, org);
    expect((await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe(false);
    s.e.ahora += DIA_MS;
    expect((await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe(true);
  });

  it("el tope de una cuenta no toca a las demás", async () => {
    const s = escena();
    const m = await s.portero();
    const org = s.admitida(1);
    for (let i = 0; i < DEVOLUCIONES_POR_DIA; i++) await unoDevuelto(s, m, org);
    expect((await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe(false);
    expect((await m.cupoDe(s.admitida(1).publicKey())).cuerpo.devuelve).toBe(true);
  });

  it("con el tope de todo el portero lleno, no se promete a ninguna cuenta, tampoco a una sin devoluciones", async () => {
    const s = escena();
    const m = await s.portero();
    // Todos los sellos juntos y una sola vuelta de la alarma: un sello vence 4 minutos después de armado.
    await devueltos(s, m, Array.from({ length: DEVOLUCIONES_POR_DIA_EN_TOTAL - 1 }, () => s.admitida(1)));
    const nueva = s.admitida(1);
    expect((await m.cupoDe(nueva.publicKey())).cuerpo.devuelve).toBe(true);
    await unoDevuelto(s, m, s.admitida(1));
    expect(s.e.cupos.resumen(s.e.ahora).devueltos24h).toBe(DEVOLUCIONES_POR_DIA_EN_TOTAL);
    const r = await m.cupoDe(nueva.publicKey());
    expect(r.cuerpo).toMatchObject({ oficial: { acceso: true, sorteos: { quedan: 1 } }, devuelve: false });
    // Y es verdad: el sello tardío de esa cuenta no vuelve solo, queda para devolverlo a mano.
    const t = s.sello(nueva);
    await m.procesar(t.xdr);
    s.entroTarde(t);
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.quedan(nueva)).toBe(0);
    expect(s.e.cupos.exportar(true).devoluciones_pendientes).toMatchObject([{ hash: t.hash, motivo: "tope-general" }]);
  });

  it("devuelve es siempre un sí o un no, nunca otra cosa", async () => {
    const s = escena();
    const m = await s.portero();
    const org = s.admitida(1);
    expect(typeof (await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe("boolean");
    for (let i = 0; i < DEVOLUCIONES_POR_DIA; i++) await unoDevuelto(s, m, org);
    expect(typeof (await m.cupoDe(org.publicKey())).cuerpo.devuelve).toBe("boolean");
  });
});
