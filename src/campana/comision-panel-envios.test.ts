import { describe, expect, it } from "vitest";
import { CENTAVO } from "./comision";
import { type EntradaDeComision, estadoDeComision } from "./comision-panel";

/**
 * El envío de los premios en lo que se pide cargar. En una campaña de personas con premios en dólares, quien organiza le manda
 * su premio a cada persona que gana, y cada envío tiene un costo: la cuenta tiene que tener los premios, el envío de cada uno y
 * el servicio. El ejemplo es el de tres premios de 40 con el servicio en 2,40 y el envío en 0,50 por premio. Sin envío, todo es
 * lo de siempre.
 */
const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;

/** Tres premios de 40: 120 de premios, 2,40 de servicio y, cuando corresponde, 1,50 de envío. */
const BASE: EntradaDeComision = {
  red: { tipo: "no-pagada", suma: 0n },
  pagadaAca: false,
  pagando: false,
  marcaViva: false,
  billetera: "google",
  cuentaEquivocada: false,
  puedeEntrar: true,
  saldo: d(150),
  premios: d(120),
  comision: d(2.4),
  umbral: d(1.9),
  costo: d(0.5),
  portero: "atiende",
  rechazos: 0,
};
const con = (c: Partial<EntradaDeComision>): EntradaDeComision => ({ ...BASE, ...c });
const ENVIOS = d(1.5);

describe("lo que se pide cargar con el envío de los premios", () => {
  it("sin saldo pide los premios, el envío y el servicio: 123,90", () => {
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: 0n }))).toEqual({
      tipo: "falta-cargar",
      cargar: d(123.9),
      saldo: 0n,
      falta: d(123.9),
      sale: d(2.4),
      monto: d(2.4),
    });
  });

  it("con 122,40 en la cuenta, que sin envío alcanzaba, falta 1,50", () => {
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: d(122.4) }))).toEqual({
      tipo: "falta-cargar",
      cargar: d(123.9),
      saldo: d(122.4),
      falta: d(1.5),
      sale: d(2.4),
      monto: d(2.4),
    });
  });

  it("con 123,90 justos queda lista, y un centavo menos no", () => {
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: d(123.9) }))).toEqual({ tipo: "lista", sale: d(2.4), saldo: d(123.9) });
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: d(123.89) }))).toMatchObject({ tipo: "falta-cargar", cargar: d(123.9), falta: d(0.01) });
  });

  it("lo que sale con el pago sigue siendo el servicio: el envío queda en la cuenta para mandar los premios", () => {
    const e = estadoDeComision(con({ envios: ENVIOS, saldo: d(200) }));
    expect(e).toEqual({ tipo: "lista", sale: d(2.4), saldo: d(200) });
  });

  it("con una parte del servicio ya llegada, pide los premios, el envío y lo que de verdad sale", () => {
    const e = estadoDeComision(con({ envios: ENVIOS, red: { tipo: "no-pagada", suma: d(0.8) }, saldo: d(120) }));
    expect(e).toMatchObject({ tipo: "falta-cargar", cargar: d(123.1), sale: d(1.6), falta: d(3.1) });
  });

  it("lo que se le pide a otra billetera no cambia: es el servicio, sin el envío", () => {
    expect(estadoDeComision(con({ envios: ENVIOS, billetera: "otra", saldo: null, portero: null }))).toEqual({
      tipo: "otra-billetera",
      monto: d(2.4),
      entrar: true,
    });
  });

  it("lo que ya pasó le sigue ganando: pagada, pagando y la duda", () => {
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: 0n, red: { tipo: "pagada", suma: d(1.9) } }))).toEqual({ tipo: "pagada" });
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: 0n, pagando: true }))).toEqual({ tipo: "pagando" });
    expect(estadoDeComision(con({ envios: ENVIOS, saldo: 0n, marcaViva: true }))).toEqual({ tipo: "duda" });
  });
});

describe("sin envío, lo de siempre", () => {
  const SALDOS = [0n, d(1), d(120), d(122.39), d(122.39) + 50_000n, d(122.4), d(123.9), d(150)];

  it("sin la clave y con el envío en cero el estado es el mismo, saldo por saldo", () => {
    for (const saldo of SALDOS) {
      const sin = estadoDeComision(con({ saldo }));
      expect(estadoDeComision(con({ saldo, envios: 0n })), String(saldo)).toEqual(sin);
    }
  });

  it("una campaña de cuentas da los números de hoy: 122,40 y lista con el saldo justo", () => {
    expect(estadoDeComision(con({ saldo: d(122.4) }))).toEqual({ tipo: "lista", sale: d(2.4), saldo: d(122.4) });
    expect(estadoDeComision(con({ saldo: d(122.39) }))).toEqual({
      tipo: "falta-cargar",
      cargar: d(122.4),
      saldo: d(122.39),
      falta: d(0.01),
      sale: d(2.4),
      monto: d(2.4),
    });
    expect(estadoDeComision(con({ saldo: 0n }))).toMatchObject({ tipo: "falta-cargar", cargar: d(122.4), falta: d(122.4) });
  });
});
