// @vitest-environment jsdom
/**
 * El celular de quien se anotó en una campaña de premio en mano: el premio es un texto, no un monto. Ninguna pantalla puede
 * decir dólares digitales ni cero. Una campaña de cuentas sigue diciendo el monto de siempre.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLang, setLang, texto, usarTextos } from "../idioma";
import { pintarAdentro, pintarGano } from "./adentro";
import type { DepsDelCelular, EstadoPublico } from "./celular";
import { depsDeDemostracion } from "./demostracion";
import { pintarEmpieza } from "./empieza";
import { campanaDeEjemplo } from "./ejemplo";
import type { Campana } from "./modelo";
import { pintarLaCampana } from "./previa";
import { TEXTOS_CAMPANA } from "./textos";

const html = readFileSync("participar.html", "utf8");
const main = /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? "";
const AHORA = Date.UTC(2026, 10, 25, 18, 0);
usarTextos(TEXTOS_CAMPANA);

const EN_MANO = { es: "Auriculares", en: "Headphones" };
const SIN_MONTO = /d[oó]lar|dollar|\b0\b/iu;

/** Una campaña de personas con premio en mano, para tres personas. */
const enMano = (): Campana => ({ ...campanaDeEjemplo(AHORA), identidad: "persona", premios: [0n, 0n, 0n], premioEnMano: EN_MANO });

function preparar(campana: Campana, idioma: "es" | "en"): { raiz: HTMLElement; deps: DepsDelCelular } {
  document.body.innerHTML = main;
  setLang(idioma);
  const raiz = document.querySelector<HTMLElement>(".cmp") as HTMLElement;
  const base = {
    tx: texto,
    idioma: getLang,
    enApp: false,
    ahora: () => AHORA,
    cada: () => () => undefined,
    visible: () => true,
    alVolver: () => () => undefined,
    vibrar: () => undefined,
    movimientoReducido: () => false,
  };
  return { raiz, deps: depsDeDemostracion(base, campana, null) };
}

const publico = (campana: Campana): EstadoPublico => ({ fase: "abierta", total: 37, cierraMs: campana.cierraMs, pase: "vale" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("la pantalla previa de una campaña de premio en mano", () => {
  it("dice el premio escrito, para cuántas personas, y nada de dólares", () => {
    const campana = enMano();
    const { raiz, deps } = preparar(campana, "es");
    pintarLaCampana(raiz, deps, publico(campana), () => undefined);
    expect(raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("Auriculares, para 3 personas");
    expect(raiz.querySelector(".cmp-premio")?.textContent).not.toMatch(SIN_MONTO);
  });

  it("en inglés dice el premio en inglés", () => {
    const campana = enMano();
    const { raiz, deps } = preparar(campana, "en");
    pintarLaCampana(raiz, deps, publico(campana), () => undefined);
    expect(raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("Headphones, for 3 people");
    expect(raiz.querySelector(".cmp-premio")?.textContent).not.toMatch(SIN_MONTO);
  });

  it("una campaña de cuentas sigue diciendo el monto de siempre", () => {
    const campana = campanaDeEjemplo(AHORA);
    const { raiz, deps } = preparar(campana, "es");
    pintarLaCampana(raiz, deps, publico(campana), () => undefined);
    expect(raiz.querySelector(".cmp-premio-texto")?.textContent).toBe("40 dólares digitales");
  });
});

describe("la pantalla de quien ya está adentro", () => {
  it("el rótulo de arriba dice el premio escrito y no un monto", () => {
    for (const [idioma, esperado] of [["es", "Auriculares, para 3 personas"], ["en", "Headphones, for 3 people"]] as const) {
      const campana = enMano();
      const { raiz, deps } = preparar(campana, idioma);
      pintarAdentro(raiz, deps, { total: 38, ya: false, fase: "abierta", cierraMs: campana.cierraMs });
      const rotulos = [...raiz.querySelectorAll("#cmp-adentro .cmp-rotulos p")].map((p) => p.textContent);
      expect(rotulos[1], idioma).toBe(esperado);
      expect(rotulos.join(" "), idioma).not.toMatch(SIN_MONTO);
    }
  });

  it("una campaña de cuentas dice el monto de siempre", () => {
    const campana = campanaDeEjemplo(AHORA);
    const { raiz, deps } = preparar(campana, "es");
    pintarAdentro(raiz, deps, { total: 38, ya: false, fase: "abierta", cierraMs: campana.cierraMs });
    expect(raiz.querySelector("#cmp-adentro .cmp-rotulos p:nth-child(2)")?.textContent).toBe("40 dólares digitales");
  });
});

describe("la cuenta regresiva", () => {
  const datos = (campana: Campana): Parameters<typeof pintarEmpieza>[2] => ({
    ritmo: () => ({ objetivoMs: campana.sorteoMs, desfase: 0, supoEn: AHORA - 60_000 }),
    rotulo: false,
    conTarjeta: false,
  });

  it("el rótulo de arriba dice el premio escrito y no un monto", () => {
    for (const [idioma, esperado] of [["es", "Auriculares, para 3 personas"], ["en", "Headphones, for 3 people"]] as const) {
      const campana = enMano();
      const { raiz, deps } = preparar(campana, idioma);
      const parar = pintarEmpieza(raiz, deps, datos(campana));
      const rotulos = [...raiz.querySelectorAll("#cmp-adentro .cmp-rotulos p")].map((p) => p.textContent);
      parar();
      expect(rotulos[1], idioma).toBe(esperado);
      expect(rotulos.join(" "), idioma).not.toMatch(SIN_MONTO);
    }
  });

  it("una campaña de cuentas dice el monto de siempre", () => {
    const campana = campanaDeEjemplo(AHORA);
    const { raiz, deps } = preparar(campana, "es");
    const parar = pintarEmpieza(raiz, deps, datos(campana));
    const premio = raiz.querySelector("#cmp-adentro .cmp-rotulos p:nth-child(2)")?.textContent;
    parar();
    expect(premio).toBe("40 dólares digitales");
  });
});

describe("Ganaste", () => {
  it("dice el premio escrito de quien ganó, sin el para cuántas, y nunca dólares", () => {
    for (const [idioma, esperado] of [["es", "Auriculares de Alcancía Andina"], ["en", "Headphones from Alcancía Andina"]] as const) {
      const campana = enMano();
      const { raiz, deps } = preparar(campana, idioma);
      pintarGano(raiz, deps, { avisado: false, comprobante: null });
      expect(raiz.querySelector("#cmp-estado .cmp-premio-resultado")?.textContent, idioma).toBe(esperado);
    }
  });

  it("una campaña de cuentas dice el monto de siempre", () => {
    const campana = campanaDeEjemplo(AHORA);
    const { raiz, deps } = preparar(campana, "es");
    pintarGano(raiz, deps, { avisado: false, comprobante: null });
    expect(raiz.querySelector("#cmp-estado .cmp-premio-resultado")?.textContent).toBe("40 dólares digitales de Alcancía Andina");
  });
});
