import { describe, expect, it } from "vitest";
import { T0, montarAltas } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";

/**
 * Lo que `/v1/patrocinio/estado` suma para la venta: `faltaAltas` (las variables mal escritas y los secretos que faltan,
 * por su nombre fijo y sin valores) para que la vigilancia lo avise, y `margenLibre` (el margen menos lo reservado por las
 * compras con QR en curso), que es lo que de verdad queda para los canjes. Con la venta cerrada y todo bien escrito, el
 * estado es el de siempre: sin campos nuevos.
 */

describe("faltaAltas en el estado", () => {
  it("con todo bien escrito y la venta cerrada no aparece: el estado es el de antes", async () => {
    const m = montarAltas();
    expect(await m.puerta.resumen()).toEqual({ creditos: 100_000, creditosLeidos: T0, piso: 300, margen: 99_700, altasPausadas: false });
  });

  it("dice cada variable mal escrita por su nombre, también con la venta cerrada", async () => {
    const casos: Array<[Record<string, string>, string[]]> = [
      [{ COMPRAS_QR: "1", RECARGO_QR: "4,25:0,5" }, ["recargo-qr"]],
      [{ COMPRAS_QR: "1", COMPRAS_QR_PILOTO: "Todos" }, ["compras-qr-piloto"]],
      [{ PATROCINIO_PERMITIDO: "sponsor_trustlines;x" }, ["patrocinio-permitido"]],
      [{ ALTAS_PAGO: "1", PRECIOS: "alta:4" }, ["precios", "cuenta-cobros"]],
      [{ POLLAR_FONDEO: "lento" }, ["pollar-fondeo"]],
    ];
    for (const [env, falta] of casos) {
      const e = await montarAltas(env).puerta.resumen();
      expect(e.faltaAltas, JSON.stringify(env)).toEqual(falta);
    }
  });

  it("dice también los secretos que faltan, sin sus valores", async () => {
    expect((await montarAltas({}, { cuponSecreto: null }).puerta.resumen()).faltaAltas).toEqual(["cupon-secreto"]);
    expect((await montarAltas({}, { cuponSecreto: "corto" }).puerta.resumen()).faltaAltas).toEqual(["cupon-secreto"]);
    expect((await montarAltas({}, { sinPollar: true }).puerta.resumen()).faltaAltas).toEqual(["pollar-llave"]);
    const texto = JSON.stringify(await montarAltas({}, { cuponSecreto: "corto" }).puerta.resumen());
    expect(texto).not.toContain("corto");
  });

  it("sin el libro, nada: el estado de las altas no existe", async () => {
    expect(await montarAltas({ ALTAS: "0", RECARGO_QR: "x", COMPRAS_QR: "1" }).puerta.resumen()).toEqual({});
  });
});

describe("margenLibre en el estado", () => {
  const ABIERTA = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5" };

  it("con la compra con QR prendida y nada en curso, es el margen", async () => {
    const m = montarPagos(ABIERTA);
    expect(await m.puerta.resumen()).toMatchObject({ creditos: 100_000, piso: 300, margen: 99_700, reservasCompras: 0, margenLibre: 99_700 });
  });

  it("descuenta lo reservado por las compras en curso; el margen de siempre no cambia", async () => {
    const m = montarPagos(ABIERTA);
    const ana = m.persona("usr_ana");
    m.cupos.transaccion(() => m.compras.sumarPiloto(ana.cuenta as string, m.hora()));
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    const reservas = m.compras.reservas(m.hora());
    expect(reservas).toBeGreaterThan(0);
    const e = await m.puerta.resumen();
    expect(e).toMatchObject({ margen: 100_000 - (e.piso as number), reservasCompras: reservas, margenLibre: 100_000 - (e.piso as number) - reservas });
    expect(Number.isInteger(e.margenLibre)).toBe(true);
  });

  it("sin el saldo de Pollar, null, como el margen", async () => {
    const m = montarPagos(ABIERTA);
    m.pm.creditosCaido = true;
    expect(await m.puerta.resumen()).toMatchObject({ creditos: null, margen: null, margenLibre: null });
  });

  it("con la venta cerrada y nada en curso no aparece", async () => {
    const e = await montarPagos().puerta.resumen();
    expect(e).not.toHaveProperty("margenLibre");
    expect(e).not.toHaveProperty("reservasCompras");
  });
});
