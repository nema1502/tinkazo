import { afterEach, describe, expect, it } from "vitest";
import { Gobernador, ajustesDe, aprender, densidad, nivelInicial, olvidar, type Nivel } from "./calidad";

afterEach(() => olvidar());

/** Un gobernador que anota a qué niveles bajó. */
function gob(nivel: Nivel, fijo = false): { g: Gobernador; bajadas: Nivel[] } {
  const bajadas: Nivel[] = [];
  return { g: new Gobernador(nivel, (n) => bajadas.push(n), fijo), bajadas };
}
/** Corre los cuadros (en ms) y devuelve los niveles a los que bajó. */
function correr(x: { g: Gobernador; bajadas: Nivel[] }, cuadros: number[]): Nivel[] {
  for (const ms of cuadros) x.g.cuadro(ms);
  return x.bajadas;
}
const iguales = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);

describe("ajustesDe", () => {
  it("alta dibuja el desenfoque pleno y más papel picado; media es lo de siempre; baja apaga el desenfoque", () => {
    expect(ajustesDe("alta", 1, false)).toEqual({ resolucion: 1, desenfoque: "pleno", papeles: 240 });
    expect(ajustesDe("media", 1, false)).toEqual({ resolucion: 1, desenfoque: "simple", papeles: 170 });
    expect(ajustesDe("baja", 1, false)).toEqual({ resolucion: 1, desenfoque: "no", papeles: 100 });
  });

  it("la densidad tiene tope en 2, y baja solo la achica a tres cuartos, nunca por debajo de 1", () => {
    expect(densidad(3)).toBe(2);
    expect(ajustesDe("alta", 3, false).resolucion).toBe(2);
    expect(ajustesDe("media", 2, false).resolucion).toBe(2);
    expect(ajustesDe("baja", 2, false).resolucion).toBe(1.5);
    expect(ajustesDe("baja", 1.25, false).resolucion).toBe(1);
    // Con el navegador alejado (menos de 1) baja no la sube.
    expect(ajustesDe("baja", 0.8, false).resolucion).toBe(0.8);
  });

  it("con el modo para compartir, cuatro de cada diez tiras", () => {
    expect(ajustesDe("alta", 1, true).papeles).toBe(96);
    expect(ajustesDe("media", 1, true).papeles).toBe(68);
    expect(ajustesDe("baja", 1, true).papeles).toBe(40);
  });
});

describe("nivelInicial", () => {
  it("arranca en alta, o en baja si se dibuja por software", () => {
    expect(nivelInicial(null, false)).toEqual({ nivel: "alta", fijo: false });
    expect(nivelInicial(null, true)).toEqual({ nivel: "baja", fijo: false });
  });

  it("?calidad= lo fija; un valor que no existe no cuenta", () => {
    expect(nivelInicial("media", false)).toEqual({ nivel: "media", fijo: true });
    expect(nivelInicial("alta", true)).toEqual({ nivel: "alta", fijo: true });
    expect(nivelInicial("ultra", false)).toEqual({ nivel: "alta", fijo: false });
  });

  it("el show siguiente arranca donde bajó el anterior", () => {
    aprender("media");
    expect(nivelInicial(null, false)).toEqual({ nivel: "media", fijo: false });
    expect(nivelInicial("alta", false)).toEqual({ nivel: "alta", fijo: true });
  });
});

describe("Gobernador", () => {
  it("con el reloj del auditor exigente (1/64 s por cuadro) nunca baja", () => {
    const x = gob("alta");
    expect(correr(x, iguales(3000, 1000 / 64))).toEqual([]);
    expect(x.g.nivel).toBe("alta");
  });

  it("a 60 cuadros por segundo no baja", () => {
    expect(correr(gob("alta"), iguales(2000, 16.7))).toEqual([]);
  });

  it("si la mediana pasa de 22 ms baja directo a baja, una sola vez", () => {
    const x = gob("alta");
    expect(correr(x, iguales(500, 34))).toEqual(["baja"]);
    expect(x.g.nivel).toBe("baja");
  });

  it("los primeros 30 cuadros no cuentan: el arranque paga texturas", () => {
    expect(correr(gob("alta"), [...iguales(30, 80), ...iguales(47, 16.7)])).toEqual([]);
  });

  it("tirones en algunos cuadros (los acercamientos con desenfoque) bajan de alta a media, no más", () => {
    const x = gob("alta");
    // Uno de cada seis cuadros tarda 40 ms: la mediana está bien, el 10 % más lento no.
    const cuadros = Array.from({ length: 1000 }, (_, i) => (i % 6 === 0 ? 40 : 16.7));
    expect(correr(x, cuadros)).toEqual(["media"]);
    expect(x.g.nivel).toBe("media");
  });

  it("desde media, los tirones sueltos no bajan; la mediana lenta sí", () => {
    const tirones = Array.from({ length: 1000 }, (_, i) => (i % 6 === 0 ? 40 : 16.7));
    expect(correr(gob("media"), tirones)).toEqual([]);
    expect(correr(gob("media"), iguales(500, 30))).toEqual(["baja"]);
  });

  it("un hueco de la pestaña escondida no cuenta", () => {
    const cuadros = Array.from({ length: 600 }, (_, i) => (i % 3 === 0 ? 900 : 16.7));
    expect(correr(gob("alta"), cuadros)).toEqual([]);
  });

  it("fijo, no se mueve aunque el equipo no dé abasto", () => {
    expect(correr(gob("alta", true), iguales(800, 60))).toEqual([]);
  });
});
