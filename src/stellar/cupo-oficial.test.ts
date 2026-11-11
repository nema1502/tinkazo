import { describe, expect, it } from "vitest";
import { TEXTOS_ALTA } from "../alta-textos";
import { T } from "../i18n";
import { GANADORES_DE_UN_SORTEO, fechaDeVencimiento, lineaDeSiguientePremio, lineaDelCupoOficial, notaDeUsoOficial } from "./cupo-oficial";
import { GANADORES_POR_SORTEO } from "./acceso-oficial";
import type { EstadoDelPatrocinio } from "./patrocinador";

const decir = (idioma: "es" | "en") => (k: string): string => {
  const v = (T[idioma] as Record<string, unknown>)[k];
  return typeof v === "string" ? v : k;
};
const es = decir("es");
const en = decir("en");

/** 14 de enero de 2027, a las 12:00 en Bolivia. */
const ENERO_14 = Date.UTC(2027, 0, 14, 16, 0, 0);

function estado(o: { quedan?: number; vence?: { fecha: number; cuantos: number } | null; sellos?: number; max?: number; acceso?: boolean; sorteos?: boolean } = {}): EstadoDelPatrocinio {
  const quedan = o.quedan ?? 13;
  return {
    rige: "portero",
    cupo: { sellos: { usados: 0, max: o.max ?? 100, quedan: o.sellos ?? Math.min(quedan, 50) }, sorteos: { usados: 0, max: 200, quedan: 100 }, liberaEn: Date.UTC(2026, 11, 1) },
    oficial: { acceso: o.acceso ?? true, sorteos: o.sorteos === false ? null : { quedan, proximoVence: o.vence === undefined ? { fecha: ENERO_14, cuantos: 3 } : o.vence } },
  };
}

describe("la línea del cupo oficial", () => {
  it("dice cuántos quedan y el próximo vencimiento con cuántos vencen", () => {
    expect(lineaDelCupoOficial(estado(), "es", es)).toBe("Te quedan 13 sorteos oficiales. 3 vencen el 14 de enero.");
    expect(lineaDelCupoOficial(estado(), "en", en)).toBe("You have 13 Live draws left. 3 expire on January 14.");
  });

  it("con uno solo, en singular", () => {
    expect(lineaDelCupoOficial(estado({ quedan: 1, vence: { fecha: ENERO_14, cuantos: 1 } }), "es", es)).toBe("Te queda 1 sorteo oficial. Vence el 14 de enero.");
    expect(lineaDelCupoOficial(estado({ quedan: 1, vence: { fecha: ENERO_14, cuantos: 1 } }), "en", en)).toBe("You have 1 Live draw left. It expires on January 14.");
  });

  it("con uno solo que vence antes que los demás, en singular", () => {
    expect(lineaDelCupoOficial(estado({ quedan: 3, vence: { fecha: ENERO_14, cuantos: 1 } }), "es", es)).toBe("Te quedan 3 sorteos oficiales. 1 vence el 14 de enero.");
    expect(lineaDelCupoOficial(estado({ quedan: 3, vence: { fecha: ENERO_14, cuantos: 1 } }), "en", en)).toBe("You have 3 Live draws left. 1 expires on January 14.");
  });

  it("si vencen todos a la vez no repite cuántos", () => {
    expect(lineaDelCupoOficial(estado({ quedan: 3, vence: { fecha: ENERO_14, cuantos: 3 } }), "es", es)).toBe("Te quedan 3 sorteos oficiales. Vencen el 14 de enero.");
  });

  it("sin vencimiento que decir, solo cuántos quedan", () => {
    expect(lineaDelCupoOficial(estado({ vence: null }), "es", es)).toBe("Te quedan 13 sorteos oficiales.");
    expect(lineaDelCupoOficial(estado({ vence: { fecha: ENERO_14, cuantos: 0 } }), "es", es)).toBe("Te quedan 13 sorteos oficiales.");
  });

  it("el día se dice en hora de Bolivia, no en la del servidor", () => {
    // 15 de enero 02:00 UTC es todavía el 14 a las 22:00 en Bolivia.
    expect(fechaDeVencimiento(Date.UTC(2027, 0, 15, 2, 0, 0), "es")).toBe("14 de enero");
    expect(fechaDeVencimiento(Date.UTC(2027, 0, 15, 2, 0, 0), "en")).toBe("January 14");
  });

  it("«Sumá más» solo cuando hay con qué sumar: con el pago prendido y quedando pocos", () => {
    const poco = estado({ quedan: 2, vence: null });
    expect(lineaDelCupoOficial(poco, "es", es)).toBe("Te quedan 2 sorteos oficiales.");
    expect(lineaDelCupoOficial(poco, "es", es, { pago: true })).toBe(TEXTOS_ALTA.es.cupoOfPocos?.replace("{n}", "2"));
    expect(lineaDelCupoOficial(estado({ quedan: 9, vence: null }), "es", es, { pago: true })).toBe("Te quedan 9 sorteos oficiales.");
  });

  it("con cero dice que se acabaron y qué hacer", () => {
    expect(lineaDelCupoOficial(estado({ quedan: 0, vence: null }), "es", es)).toBe("Se te acabaron los sorteos oficiales. Usá otro cupón o seguí gratis en Prueba.");
  });

  it("con sorteos pero el tope de sellos del mes alcanzado, dice cuándo se libera", () => {
    const t = lineaDelCupoOficial(estado({ quedan: 5, sellos: 0, max: 100 }), "es", es);
    expect(t).toBe("Llegaste al tope de 100 sorteos oficiales de este mes. Se libera el 1 de diciembre. Si necesitás más, escribinos a hola@tinkazo.app.");
    // Sin el tope no hay número que decir: ninguna línea.
    expect(lineaDelCupoOficial(estado({ quedan: 5, sellos: 0, max: 0 }), "es", es)).toBeNull();
  });

  it("sin acceso, sin sorteos que contar, sin lo oficial o cerrado: nada", () => {
    expect(lineaDelCupoOficial(estado({ acceso: false }), "es", es)).toBeNull();
    expect(lineaDelCupoOficial(estado({ sorteos: false }), "es", es)).toBeNull();
    expect(lineaDelCupoOficial({ rige: "pollar", configurado: true }, "es", es)).toBeNull();
    expect(lineaDelCupoOficial({ rige: "cerrado", motivo: "apagado" }, "es", es)).toBeNull();
    expect(lineaDelCupoOficial(null, "es", es)).toBeNull();
  });
});

describe("la nota de cuánto gasta cada premio", () => {
  it("uno por premio, y más de 50 ganadores usa dos", () => {
    expect(notaDeUsoOficial(estado(), 1, es)).toBe("Cada premio que sorteás de a uno usa un sorteo. Si son iguales, poné cuántos ganan y es uno solo.");
    expect(notaDeUsoOficial(estado(), 50, es)).toBe(es("cupoOfUnoPorPremio"));
    expect(notaDeUsoOficial(estado(), 51, es)).toBe("Con más de 50 ganadores, este sorteo usa 2.");
    expect(notaDeUsoOficial(estado(), 300, en)).toBe("With more than 50 winners, this draw uses 2.");
  });

  it("el límite es el mismo que usa la compuerta de la firma", () => {
    expect(GANADORES_DE_UN_SORTEO).toBe(GANADORES_POR_SORTEO);
  });

  it("sin sorteos o sin acceso, nada", () => {
    expect(notaDeUsoOficial(estado({ quedan: 0 }), 1, es)).toBeNull();
    expect(notaDeUsoOficial(estado({ acceso: false }), 1, es)).toBeNull();
    expect(notaDeUsoOficial(null, 1, es)).toBeNull();
  });
});

describe("la línea de «Siguiente premio»", () => {
  it("dice cuántos sorteos oficiales quedan", () => {
    expect(lineaDeSiguientePremio(estado({ quedan: 2 }), es)).toBe("Te quedan 2 sorteos oficiales.");
    expect(lineaDeSiguientePremio(estado({ quedan: 1 }), es)).toBe("Te queda 1 sorteo oficial.");
    expect(lineaDeSiguientePremio(estado({ quedan: 2 }), en)).toBe("You have 2 Live draws left.");
  });
  it("con cero lo dice, y qué hacer", () => {
    expect(lineaDeSiguientePremio(estado({ quedan: 0 }), es)).toBe(es("errAnchor.porteroSinSorteos"));
  });
  it("sin lo oficial, nada", () => {
    expect(lineaDeSiguientePremio(null, es)).toBeNull();
    const { oficial: _quitado, ...sinOficial } = estado() as Extract<EstadoDelPatrocinio, { rige: "portero" }>;
    expect(lineaDeSiguientePremio(sinOficial, es)).toBeNull();
  });
});
