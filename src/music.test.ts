// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPAS_SHOW,
  IDENTIDADES,
  MOVIMIENTO_DEL_SHOW,
  SEGUNDO_DEL_GOLPE,
  SEMILLA_DE_LA_ESCUCHA,
  nivelDelShow,
  perfilDeIdentidad,
  IDENTIDADES_DEL_SELECTOR,
  type IdentidadDelJuego,
} from "./music";
import { ACORDES, type AcordeId } from "./sonidos/carrera";

/**
 * Las capas del show por juego: la identidad de cada juego es un mapa puro de datos que la página de
 * escucha (`src/ui/escucha.ts`) toca con el secuenciador de siempre, y nada más. En producción no prende nada
 * nuevo: eso lo decide el dueño escuchando. Y el núcleo del freno: el tick de la música mide cuánto
 * tardó el tick y baja con gracia a algo más simple, sin cortar nunca.
 */

/** Los juegos del show, leídos de `src/state.ts` (la unión de `Game` sin el `JuegoKit`). */
function juegosDelState(): string[] {
  const src = readFileSync(resolve(process.cwd(), "src/state.ts"), "utf8");
  const m = src.match(/export type Game = ((?:"[a-z]+" \| )+"[a-z]+") \| JuegoKit;/);
  const union = (m?.[1] ?? "").split(/ \| /).map((s) => s.replace(/"/g, ""));
  if (union.length === 0) throw new Error("no se pudo leer la unión de Game en state.ts");
  return union;
}

/**
 * Los juegos que hoy se pueden elegir en el selector, en el orden del selector: los botones `g-<id>` de `index.html`
 * que no están ocultos. Los dos que salieron (De pie y El Trueque) llevan `hidden` y no cuentan.
 */
function juegosDelSelector(): string[] {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const bloque = html.slice(html.indexOf('id="gamepick"'), html.indexOf('id="wheel-cap"'));
  return [...bloque.matchAll(/<button id="g-([a-z]+)"([^>]*)>/g)].filter((m) => !/\bhidden\b/.test(m[2] ?? "")).map((m) => m[1] as string);
}

/** Lo que se reconoce como ritmo de Bolivia: etiquetas de intención, solo texto, no síntesis. */
const RITMOS = new Set(["huayño", "huayno", "caporal", "taquirari", "cueca", "chovena", "saya", "morenada", "kullawada"]);
/** Los instrumentos con cuerpo: también solo etiquetas. */
const INSTRUMENTOS = new Set(["charango", "zampoña", "quena", "bombo", "guitarra"]);

const IDENTIDADES_EN_ORDEN = Object.values(IDENTIDADES);

describe("la identidad musical de cada juego, en datos", () => {
  it("los diez juegos del selector de hoy tienen su identidad, con sus ids reales, y van primero y en su orden", () => {
    const selector = juegosDelSelector();
    expect(selector).toHaveLength(10);
    expect(selector).toEqual(expect.arrayContaining(["guajojo", "toborochi"]));
    for (const juego of selector) expect(IDENTIDADES[juego], juego).toBeTruthy();
    expect(IDENTIDADES_DEL_SELECTOR).toEqual(selector);
    expect(Object.keys(IDENTIDADES).slice(0, 10)).toEqual(selector);
  });

  it("cada juego del show tiene su identidad", () => {
    // Los diez del selector y los que salieron de él pero siguen abriendo con ?demo=.
    expect(IDENTIDADES_EN_ORDEN).toHaveLength(19);
    for (const juego of juegosDelState()) expect(IDENTIDADES[juego], juego).toBeTruthy();
  });

  for (const i of IDENTIDADES_EN_ORDEN as IdentidadDelJuego[]) {
    it(`${i.juego}: el tempo crece con el show y las capas tienen cuerda`, () => {
      // El tempo va de menos a más: largada, grupo y recta (o su equivalente en cada juego).
      expect(i.bpm[0]).toBeGreaterThan(0);
      expect(i.bpm[0]).toBeLessThan(i.bpm[1]);
      expect(i.bpm[1]).toBeLessThan(i.bpm[2]);
      expect(i.bpm[2]).toBeLessThanOrEqual(140);
      // Los umbrales de tensión en los que cambia el ritmo, dentro de uno.
      expect(i.umbrales[0]).toBeGreaterThan(0);
      expect(i.umbrales[0]).toBeLessThan(i.umbrales[1]);
      expect(i.umbrales[1]).toBeLessThan(1);
      // Cuánto suena cada capa, de 0 a 1,5 como en el perfil de la carrera.
      for (const v of Object.values(i.capas)) expect(v).toBeGreaterThanOrEqual(0);
      for (const v of Object.values(i.capas)) expect(v).toBeLessThanOrEqual(1.5);
      expect(i.zamponaDesde).toBeGreaterThanOrEqual(0);
      expect(i.zamponaDesde).toBeLessThan(1);
      // Vueltas de acordes de la pentatónica, las mismas del secuenciador.
      expect(i.vueltas.length).toBeGreaterThan(0);
      for (const vuelta of i.vueltas) {
        expect(vuelta.length).toBeGreaterThan(0);
        for (const id of vuelta) expect(Object.keys(ACORDES)).toContain(id as AcordeId);
      }
    });

    it(`${i.juego}: los ritmos y los instrumentos son etiquetas de la familia boliviana, solo texto`, () => {
      expect(i.ritmos.length).toBeGreaterThan(0);
      for (const r of i.ritmos) expect(RITMOS.has(r), r).toBe(true);
      expect(i.instrumentos.length).toBeGreaterThan(0);
      for (const d of i.instrumentos) expect(INSTRUMENTOS.has(d), d).toBe(true);
    });
  }
});

describe("la curva del show: espera, tensión, ganador, festejo", () => {
  it("las cuatro capas del show, cada una con sus segundos", () => {
    expect(CAPAS_SHOW).toEqual(["espera", "tension", "remate", "festejo"]);
    expect(MOVIMIENTO_DEL_SHOW.espera).toBeGreaterThan(0);
    expect(MOVIMIENTO_DEL_SHOW.tension).toBeGreaterThan(MOVIMIENTO_DEL_SHOW.espera);
    expect(MOVIMIENTO_DEL_SHOW.remate).toBeGreaterThan(0);
    expect(MOVIMIENTO_DEL_SHOW.festejo).toBeGreaterThan(0);
    expect(SEGUNDO_DEL_GOLPE).toBe(MOVIMIENTO_DEL_SHOW.espera + MOVIMIENTO_DEL_SHOW.tension + MOVIMIENTO_DEL_SHOW.remate);
  });

  it("la tensión crece sin delatar el resultado, y después del golpe la música deja lugar al remate", () => {
    expect(nivelDelShow(0)).toBeGreaterThan(0);
    expect(nivelDelShow(MOVIMIENTO_DEL_SHOW.espera / 2)).toBeLessThan(0.2);
    // La tensión sube a lo largo de su capa.
    const meio = MOVIMIENTO_DEL_SHOW.espera + MOVIMIENTO_DEL_SHOW.tension / 2;
    expect(nivelDelShow(meio)).toBeGreaterThan(nivelDelShow(MOVIMIENTO_DEL_SHOW.espera + 0.5));
    // En el ganador va a lo alto, pero sin tocar el 1 hasta que el show lo dice.
    expect(nivelDelShow(SEGUNDO_DEL_GOLPE - 0.01)).toBeLessThanOrEqual(0.85);
    // Después del golpe, el remate y el festejo son de otra pieza: silencio.
    expect(nivelDelShow(SEGUNDO_DEL_GOLPE + 0.01)).toBe(0);
    expect(nivelDelShow(0.5)).toBeLessThan(nivelDelShow(MOVIMIENTO_DEL_SHOW.espera + 1));
  });

  it("la candidata de escucha se toca con el secuenciador de siempre, sin arreglo legado", () => {
    for (const i of IDENTIDADES_EN_ORDEN as IdentidadDelJuego[]) {
      const p = perfilDeIdentidad(i);
      expect(p.bpm).toEqual(i.bpm);
      expect(p.legado).toBeUndefined();
      expect(p.trim).toBeGreaterThan(0);
      expect(p.capas).toEqual(i.capas);
    }
  });

  it("la semilla de la escucha es fija: la misma candidata suena igual cada vez", () => {
    expect(SEMILLA_DE_LA_ESCUCHA).toBeTypeOf("number");
    expect(SEMILLA_DE_LA_ESCUCHA).toBeGreaterThan(0);
  });
});

describe("el tick baja con gracia cuando el procesador frenó, sin cortar nunca", () => {
  it("el tick mide el intervalo, sigue el margen, mide el freno y programa hasta el horizonte de gracia", async () => {
    const src = readFileSync(resolve(process.cwd(), "src/music.ts"), "utf8");
    expect(src).toMatch(/const intervalo = ahora - s\.ultimoTick;/);
    expect(src).toMatch(/s\.margen = escondida \? MARGEN_BASE : margenMusica\(s\.margen, intervalo, s\.adelgazar\);/);
    expect(src).toMatch(/s\.gracia = s\.adelgazar && !escondida \? nivelDeGracia\(s\.gracia, intervalo\) : 0;/);
    expect(src).toMatch(/horizonteDeMusica\(s\.margen, intervalo\)/);
  });

  it("con gracia las capas caras se caen primero, y el remate y el ganador suenan enteros", async () => {
    const src = readFileSync(resolve(process.cwd(), "src/music.ts"), "utf8");
    // La subida de ruido y la octava de arriba de la zampoña son lo primero que cae.
    expect(src).toMatch(/L > 0\.8 && s\.gracia === 0/);
    expect(src).toMatch(/s\.gracia < 0\.5/);
    // El ganador (el remate ya programado) no se degrada: la gracia solo alcanza mientras el show corre.
    expect(src).toMatch(/s\.gracia = 0;/);
  });
});

describe("los comentarios de la música dicen cosas con sentido", () => {
  it("el cambio de nombre de ganador a remate no dejó frases que se repiten", () => {
    const src = readFileSync(resolve(process.cwd(), "src/music.ts"), "utf8");
    expect(src).not.toMatch(/remate: remate/i);
    expect(src).not.toMatch(/remate del remate/i);
    expect(src).not.toMatch(/es el remate: /);
  });

  it("ningún comentario cita una especificación que no está en el repositorio", () => {
    for (const archivo of ["src/music.ts", "src/sound.ts", "src/music-margen.ts", "src/ui/escucha.ts", "src/ui/escucha-textos.ts"]) {
      const src = readFileSync(resolve(process.cwd(), archivo), "utf8");
      expect(src, archivo).not.toMatch(/\((?:[ST]\d)(?:, [ST]\d| a [ST]\d)*\)/);
    }
  });
});
