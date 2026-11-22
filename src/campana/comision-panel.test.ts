import { describe, expect, it } from "vitest";
import { CENTAVO } from "./comision";
import { type EntradaDeComision, RECHAZOS_QUE_SE_AGUANTAN, estadoDeComision, loQueSale } from "./comision-panel";

/** Los estados del cobro, uno por rama y en el orden de prioridad. Todo con datos inventados, sin red. */
const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;

/** Todo en regla para pagar con la cuenta: 120 de premios, 2,40 de comisión y 150 de saldo. */
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

describe("el orden de prioridad", () => {
  it("pagada en la red le gana a la marca", () => {
    expect(estadoDeComision(con({ red: { tipo: "pagada", suma: d(1.9) }, marcaViva: true, pagando: true }))).toEqual({ tipo: "pagada" });
  });

  it("pagada desde esta compu le gana a la red sin consulta", () => {
    expect(estadoDeComision(con({ pagadaAca: true, red: { tipo: "sin-consulta" } }))).toEqual({ tipo: "pagada" });
  });

  it("pagando le gana a la marca", () => {
    expect(estadoDeComision(con({ pagando: true, marcaViva: true }))).toEqual({ tipo: "pagando" });
  });

  it("la marca viva le gana a todo lo demás: es duda y no ofrece pagar", () => {
    expect(estadoDeComision(con({ marcaViva: true, saldo: d(1) }))).toEqual({ tipo: "duda" });
  });

  it("sin haber mirado la red todavía, mirando", () => {
    expect(estadoDeComision(con({ red: null }))).toEqual({ tipo: "mirando" });
  });

  it("la red sin consulta es sin-mirar y nunca lista", () => {
    expect(estadoDeComision(con({ red: { tipo: "sin-consulta" } }))).toEqual({ tipo: "sin-mirar" });
  });

  it("una cuenta que no es la que pide la campaña es otra-cuenta, sin cargar ni pagar", () => {
    expect(estadoDeComision(con({ cuentaEquivocada: true }))).toEqual({ tipo: "otra-cuenta" });
  });
});

describe("pagar con la cuenta", () => {
  it("con el saldo justo de los premios más la comisión, lista", () => {
    expect(estadoDeComision(con({ saldo: d(122.4) }))).toEqual({ tipo: "lista", sale: d(2.4) });
  });

  it("un centavo menos, falta cargar con lo que falta", () => {
    expect(estadoDeComision(con({ saldo: d(122.39) }))).toEqual({
      tipo: "falta-cargar",
      cargar: d(122.4),
      saldo: d(122.39),
      falta: d(0.01),
      sale: d(2.4),
      monto: d(2.4),
    });
  });

  it("con un saldo con fracción de centavo, lo que falta sube al centavo y nunca es cero", () => {
    // 122,3950000: faltan 0,0050000, y se pide cargar 0,01 (cargar 0 no llegaría nunca).
    const e = estadoDeComision(con({ saldo: d(122.39) + 50_000n }));
    expect(e).toMatchObject({ tipo: "falta-cargar", cargar: d(122.4), falta: d(0.01) });
  });

  it("sin saldo, falta cargar el total", () => {
    const e = estadoDeComision(con({ saldo: 0n }));
    expect(e).toMatchObject({ tipo: "falta-cargar", cargar: d(122.4), falta: d(122.4) });
  });

  it("el saldo todavía sin leer es mirando", () => {
    expect(estadoDeComision(con({ saldo: null }))).toEqual({ tipo: "mirando" });
  });

  it("un saldo sin red es sin-mirar", () => {
    expect(estadoDeComision(con({ saldo: "sin-red" }))).toEqual({ tipo: "sin-mirar" });
  });

  it("el ensayo de un dólar paga el mínimo: 1,50 y se cargan 2,50", () => {
    const e = estadoDeComision(con({ premios: d(1), comision: d(1.5), umbral: d(1), saldo: d(2.5) }));
    expect(e).toEqual({ tipo: "lista", sale: d(1.5) });
    expect(estadoDeComision(con({ premios: d(1), comision: d(1.5), umbral: d(1), saldo: d(2.49) }))).toMatchObject({ cargar: d(2.5) });
  });
});

describe("el servicio de comisiones", () => {
  it("si no atiende, ahora-no con el pago desde otra billetera", () => {
    expect(estadoDeComision(con({ portero: "no" }))).toEqual({ tipo: "ahora-no", monto: d(2.4) });
  });

  it("sin respuesta del servicio, sin-mirar", () => {
    expect(estadoDeComision(con({ portero: "sin-respuesta" }))).toEqual({ tipo: "sin-mirar" });
  });

  it("sin preguntar todavía, mirando", () => {
    expect(estadoDeComision(con({ portero: null }))).toEqual({ tipo: "mirando" });
  });

  it("después de dos intentos que no salieron, ahora-no", () => {
    expect(estadoDeComision(con({ rechazos: RECHAZOS_QUE_SE_AGUANTAN }))).toEqual({ tipo: "ahora-no", monto: d(2.4) });
    expect(estadoDeComision(con({ rechazos: RECHAZOS_QUE_SE_AGUANTAN - 1 })).tipo).toBe("lista");
  });
});

describe("otra billetera", () => {
  it("con otra billetera pide la comisión entera y no pide saldo", () => {
    expect(estadoDeComision(con({ billetera: "otra", saldo: null, portero: null }))).toEqual({ tipo: "otra-billetera", monto: d(2.4), entrar: true });
  });

  it("sin forma de entrar, el principal no es entrar", () => {
    expect(estadoDeComision(con({ billetera: "otra", puedeEntrar: false }))).toMatchObject({ tipo: "otra-billetera", entrar: false });
  });
});

describe("una cuenta que entró con correo", () => {
  it("con un borrador no llega a cargar ni a pagar, aunque tenga saldo y el servicio atienda", () => {
    expect(estadoDeComision(con({ billetera: "correo", soloGoogle: true }))).toEqual({ tipo: "solo-google" });
    expect(estadoDeComision(con({ billetera: "correo", soloGoogle: true, saldo: 0n }))).toEqual({ tipo: "solo-google" });
  });

  it("con un archivo firmado paga con un toque como antes: ahí no hay sala que pida Google", () => {
    expect(estadoDeComision(con({ billetera: "correo" }))).toEqual({ tipo: "lista", sale: d(2.4) });
    expect(estadoDeComision(con({ billetera: "correo", soloGoogle: false, saldo: 0n }))).toMatchObject({ tipo: "falta-cargar" });
  });

  it("lo que ya pasó le sigue ganando: pagada, pagando y la duda", () => {
    const correo: Partial<EntradaDeComision> = { billetera: "correo", soloGoogle: true };
    expect(estadoDeComision(con({ ...correo, red: { tipo: "pagada", suma: d(1.9) } }))).toEqual({ tipo: "pagada" });
    expect(estadoDeComision(con({ ...correo, marcaViva: true }))).toEqual({ tipo: "duda" });
  });

  it("la de Google con un borrador sigue pudiendo pagar", () => {
    expect(estadoDeComision(con({ soloGoogle: true }))).toEqual({ tipo: "lista", sale: d(2.4) });
  });

  it("sin poder mirar la red, a la de Google no se le dice que su cuenta no sirve", () => {
    expect(estadoDeComision(con({ soloGoogle: true, red: { tipo: "sin-consulta" } }))).toEqual({ tipo: "sin-mirar" });
    expect(estadoDeComision(con({ soloGoogle: true, portero: "sin-respuesta" }))).toEqual({ tipo: "sin-mirar" });
  });
});

describe("el pago a medias", () => {
  it("con nada llegado, paga la comisión entera", () => {
    expect(loQueSale(BASE, 0n)).toBe(d(2.4));
  });

  it("con una parte llegada y un resto de un dólar o más, paga el resto más el costo", () => {
    expect(loQueSale(BASE, d(0.8))).toBe(d(1.1) + d(0.5));
    const e = estadoDeComision(con({ red: { tipo: "no-pagada", suma: d(0.8) }, saldo: d(500) }));
    expect(e).toEqual({ tipo: "lista", sale: d(1.6) });
  });

  it("con un resto de menos de un dólar solo queda el pago desde otra billetera, con ese resto", () => {
    expect(loQueSale(BASE, d(1.0))).toBeNull();
    const e = estadoDeComision(con({ red: { tipo: "no-pagada", suma: d(1.0) } }));
    expect(e).toEqual({ tipo: "otra-billetera", monto: d(1.4), entrar: false });
  });

  it("el botón pide premios más lo que de verdad sale", () => {
    const e = estadoDeComision(con({ red: { tipo: "no-pagada", suma: d(0.8) }, saldo: d(120) }));
    expect(e).toMatchObject({ tipo: "falta-cargar", cargar: d(121.6), sale: d(1.6) });
  });
});
