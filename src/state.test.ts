import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** `state.ts` lee `location.search` al cargarse, y vitest corre en Node. */
async function load(search = "") {
  vi.resetModules();
  vi.stubGlobal("location", { search });
  return import("./state");
}

const media = (reduce: boolean) => vi.fn((q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion") }));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("motionReduced", () => {
  it("es true cuando el sistema pide menos movimiento", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.motionReduced()).toBe(true);
  });

  it("es false cuando no lo pide", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(false));
    expect(s.motionReduced()).toBe(false);
  });

  it("es false si matchMedia no existe", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", undefined);
    expect(s.motionReduced()).toBe(false);
  });
});

describe("skipMotion", () => {
  it("anima si nada lo impide", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(false));
    expect(s.skipMotion()).toBe(false);
  });

  it("salta con movimiento reducido", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.skipMotion()).toBe(true);
  });

  it("forzar el movimiento anula la preferencia del sistema", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    s.forceMotion(true);
    expect(s.skipMotion()).toBe(false);
    s.forceMotion(false);
    expect(s.skipMotion()).toBe(true);
  });

  it("?instant=1 salta siempre, aunque se fuerce el movimiento", async () => {
    const s = await load("?instant=1");
    vi.stubGlobal("matchMedia", media(false));
    s.forceMotion(true);
    expect(s.skipMotion()).toBe(true);
  });

  it("reducedSkip avisa solo cuando el motivo es la preferencia del sistema", async () => {
    const s = await load();
    vi.stubGlobal("matchMedia", media(true));
    expect(s.skippedForReducedMotion()).toBe(true);
    s.forceMotion(true);
    expect(s.skippedForReducedMotion()).toBe(false);
    const i = await load("?instant=1");
    vi.stubGlobal("matchMedia", media(true));
    expect(i.skippedForReducedMotion()).toBe(false);
  });
});

describe("playableGame", () => {
  it("keeps the existing caps working", async () => {
    const s = await load();
    expect(s.playableGame("wheel", 24)).toBe("wheel");
    // La ruleta llega a 200 con gajos que reúnen grupos; pasado eso, la tómbola.
    expect(s.playableGame("wheel", 25)).toBe("wheel");
    expect(s.playableGame("wheel", 200)).toBe("wheel");
    expect(s.playableGame("wheel", 201)).toBe("tombola");
    // El Sapo juega una clasificatoria con cualquier cantidad: solo no puede con más de 12 ganadores.
    expect(s.playableGame("sapo", 12)).toBe("sapo");
    expect(s.playableGame("sapo", 200)).toBe("sapo");
    expect(s.playableGame("sapo", 50, undefined, Array.from({ length: 13 }, (_, i) => i))).toBe("race");
    expect(s.playableGame("race", 500)).toBe("race");
    expect(s.playableGame("teleferico", 500)).toBe("teleferico");
  });


});

describe("auditaCon", () => {
  it("sin ?auditar es siempre falso: en el sorteo de verdad ningún auditor se prende", async () => {
    const s = await load("");
    for (const clave of ["marcha", "encuadre", "3d", "fisica", "choques", "nino", "camara"]) expect(s.auditaCon(clave)).toBe(false);
    const vacio = await load("?auditar=");
    expect(vacio.auditaCon("marcha")).toBe(false);
  });

  it("con un solo valor responde solo a ese", async () => {
    const s = await load("?auditar=fisica");
    expect(s.auditaCon("fisica")).toBe(true);
    expect(s.auditaCon("choques")).toBe(false);
    // Es una coincidencia exacta, no una parte del texto.
    expect(s.auditaCon("fisic")).toBe(false);
    expect(s.auditaCon("fisica2")).toBe(false);
  });

  it("con varios valores separados por coma responde a cada uno", async () => {
    const s = await load("?auditar=marcha,camara,encuadre,3d,choques,fisica");
    for (const clave of ["marcha", "camara", "encuadre", "3d", "choques", "fisica"]) expect(s.auditaCon(clave)).toBe(true);
    expect(s.auditaCon("nino")).toBe(false);
  });
});

describe("la lista de ejemplo con cantidad (?n=)", () => {
  it("sin cantidad o con una cantidad que no sirve, la demostración no cambia nada", async () => {
    const s = await load();
    for (const malo of [null, "", "abc", "1.5", "0", "1", "-4", "2001", "99999", "1e2", " 5", "5 ", "NaN", "Infinity"]) {
      expect(s.cantidadDeLaDemo(malo), String(malo)).toBeNull();
    }
  });

  it("acepta los enteros de 2 a 2000", async () => {
    const s = await load();
    for (const bueno of ["2", "6", "7", "18", "150", "300", "2000"]) expect(s.cantidadDeLaDemo(bueno)).toBe(Number(bueno));
  });

  it("arma una lista de ese largo con los nombres de ejemplo numerados, igual que la escena fija", async () => {
    const s = await load();
    expect(s.nombresDeEjemplo(2)).toEqual(s.SAMPLE.slice(0, 2));
    expect(s.nombresDeEjemplo(18)).toEqual(s.SAMPLE);
    const ciento50 = s.nombresDeEjemplo(150);
    expect(ciento50).toHaveLength(150);
    expect(ciento50[18]).toBe(`${s.SAMPLE[0]} 2`);
    expect(new Set(ciento50).size).toBe(150);
    expect(s.nombresDeEjemplo(300)).toHaveLength(300);
  });
});
