import { describe, expect, it } from "vitest";
import { minimoParaRetirar } from "../ui/mandar-usdc";
import {
  CENTAVO,
  DOLAR,
  LLEGA_MINIMO_DEL_RETIRO,
  comisionDe,
  dolaresEnTexto,
  esDeCentavosJustos,
  falta,
  loQueCobra,
  notaDeLaComision,
  porcentajeEnTexto,
  totalACargar,
  totalDePremios,
  umbralPagado,
} from "./comision";

/** Dólares enteros o con centavos, escritos como stroops. */
const d = (dolares: number): bigint => BigInt(Math.round(dolares * 100)) * CENTAVO;
const MINIMO = d(1.5);
const PB = 200n;

describe("el total de los premios", () => {
  it("suma los premios", () => {
    expect(totalDePremios([d(100), d(20)])).toBe(d(120));
  });

  it("sube al centavo con una fracción de centavo", () => {
    expect(totalDePremios([100_000_001n])).toBe(d(10.01));
  });

  it("un total exacto al centavo no sube", () => {
    expect(totalDePremios([d(1.01), d(2.02)])).toBe(d(3.03));
  });

  it("no acepta un premio negativo", () => {
    expect(() => totalDePremios([-1n])).toThrow();
  });
});

describe("la comisión", () => {
  it("120 paga 2,40 y se cargan 122,40", () => {
    expect(comisionDe([d(120)], PB, MINIMO)).toBe(d(2.4));
    expect(totalACargar([d(120)], d(2.4))).toBe(d(122.4));
  });

  it("1 paga el mínimo, 1,50, y se cargan 2,50", () => {
    expect(comisionDe([d(1)], PB, MINIMO)).toBe(d(1.5));
    expect(totalACargar([d(1)], d(1.5))).toBe(d(2.5));
  });

  it("75 paga 1,50 justo", () => {
    expect(comisionDe([d(75)], PB, MINIMO)).toBe(d(1.5));
  });

  it("75,01 paga 1,51: 1,5002 sube al centavo", () => {
    expect(comisionDe([d(75.01)], PB, MINIMO)).toBe(d(1.51));
  });

  it("100 paga 2,00", () => {
    expect(comisionDe([d(100)], PB, MINIMO)).toBe(d(2));
  });

  it("diez premios de un centavo pagan el mínimo", () => {
    expect(comisionDe(Array.from({ length: 10 }, () => CENTAVO), PB, MINIMO)).toBe(MINIMO);
  });

  it("un premio con fracción de centavo sube al centavo antes de cobrar", () => {
    expect(comisionDe([10_000_000_001n], PB, MINIMO)).toBe(d(20.01));
  });

  it("el máximo del modelo, diez premios de 16 cifras, no desborda", () => {
    const grande = 9_999_999_999_999_999n;
    const c = comisionDe(Array.from({ length: 10 }, () => grande), 1_000n, MINIMO);
    expect(c).toBe(totalDePremios(Array.from({ length: 10 }, () => grande)) / 10n);
  });

  it("1 y 1.000 puntos básicos valen", () => {
    expect(comisionDe([d(1000)], 1n, MINIMO)).toBe(MINIMO);
    expect(comisionDe([d(1000)], 1_000n, MINIMO)).toBe(d(100));
  });

  it("0 y 1.001 puntos básicos lanzan", () => {
    expect(() => comisionDe([d(1)], 0n, MINIMO)).toThrow();
    expect(() => comisionDe([d(1)], 1_001n, MINIMO)).toThrow();
  });

  it("un mínimo en cero o negativo lanza", () => {
    expect(() => comisionDe([d(1)], PB, 0n)).toThrow();
    expect(() => comisionDe([d(1)], PB, -1n)).toThrow();
  });
});

describe("lo que alcanza en la red y lo que falta cargar", () => {
  it("el umbral es la comisión menos el costo del retiro", () => {
    expect(umbralPagado(d(2.4), d(0.5))).toBe(d(1.9));
  });

  it("falta es lo que le queda a un saldo para llegar al total, o cero", () => {
    expect(falta(d(120), d(122.4))).toBe(d(2.4));
    expect(falta(d(130), d(122.4))).toBe(0n);
  });

  it("los centavos justos se reconocen", () => {
    expect(esDeCentavosJustos(d(1.01))).toBe(true);
    expect(esDeCentavosJustos(100_000_001n)).toBe(false);
  });

  it("el piso del retiro de Mandar es el que usa el cobro", () => {
    expect(LLEGA_MINIMO_DEL_RETIRO).toBe(minimoParaRetirar(d(0.5)) - d(0.5));
    expect(LLEGA_MINIMO_DEL_RETIRO).toBe(DOLAR);
  });
});

describe("la nota del evento", () => {
  it("es estable para el mismo evento", () => {
    expect(notaDeLaComision("evento-uno")).toBe(notaDeLaComision("evento-uno"));
  });

  it("es distinta para dos eventos", () => {
    expect(notaDeLaComision("evento-uno")).not.toBe(notaDeLaComision("evento-dos"));
  });

  it("está entre 2^40 y 10^15, sin ceros adelante", () => {
    for (const evento of ["evento-uno", "evento-dos", "a1", "una-campana-con-un-nombre-largo"]) {
      const n = notaDeLaComision(evento);
      expect(n).toMatch(/^[1-9]\d{12,14}$/);
      expect(BigInt(n)).toBeGreaterThanOrEqual(1n << 40n);
      expect(BigInt(n)).toBeLessThan(10n ** 15n);
    }
  });

  it("el evento de ejemplo da siempre este número, para que el panel y el guion no se separen", () => {
    expect(notaDeLaComision("evento-uno")).toBe("710126854477769");
  });
});

describe("lo que el guion lee del archivo", () => {
  const base = { evento: "evento-uno", premios: ["1000000000"], abreMs: 1_700_000_000_000 };

  it("un archivo con la forma del modelo da el evento, los premios y la apertura", () => {
    expect(loQueCobra(base)).toEqual({ evento: "evento-uno", premios: [1_000_000_000n], abreMs: 1_700_000_000_000, organizadora: null });
  });

  it("una campaña sin evento de buena forma da null", () => {
    expect(loQueCobra({ ...base, evento: "EVENTO UNO" })).toBeNull();
  });

  it("premios que no son cifras dan null", () => {
    expect(loQueCobra({ ...base, premios: ["12,5"] })).toBeNull();
  });

  it("un premio de menos de un centavo da null", () => {
    expect(loQueCobra({ ...base, premios: ["99999"] })).toBeNull();
  });

  it("sin premios, o con más de diez, da null", () => {
    expect(loQueCobra({ ...base, premios: [] })).toBeNull();
    expect(loQueCobra({ ...base, premios: Array.from({ length: 11 }, () => "1000000") })).toBeNull();
  });

  it("algo que no es un objeto da null", () => {
    expect(loQueCobra("hola")).toBeNull();
    expect(loQueCobra(null)).toBeNull();
  });

  it("lleva la cuenta organizadora si la trae", () => {
    expect(loQueCobra({ ...base, organizadora: "GABC" })?.organizadora).toBe("GABC");
  });
});

describe("los números escritos", () => {
  it("el porcentaje, con coma en español y punto en inglés", () => {
    expect(porcentajeEnTexto(200n, "es")).toBe("2 %");
    expect(porcentajeEnTexto(200n, "en")).toBe("2%");
    expect(porcentajeEnTexto(250n, "es")).toBe("2,5 %");
    expect(porcentajeEnTexto(250n, "en")).toBe("2.5%");
  });

  it("los dólares llevan dos decimales como mínimo", () => {
    expect(dolaresEnTexto(d(1.5), "es")).toBe("1,50");
    expect(dolaresEnTexto(d(122.4), "en")).toBe("122.40");
    expect(dolaresEnTexto(d(100), "es")).toBe("100,00");
  });
});
