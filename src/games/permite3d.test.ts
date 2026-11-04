import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UMBRAL_POR_JUEGO, aptoPorDefecto3D, permite3D, quiere3D, type Entorno3D, type Umbral3D } from "./permite3d";

const bueno: Entorno3D = { webgl: true, ahorroDeDatos: false, conexion: null, compartir: false };
const pesado: Record<string, Umbral3D> = { pinata: { nucleos: 4, memoriaGB: 4 } };

describe("quiere3D: la regla de tres líneas", () => {
  it("nunca lo tocó: 3D si el equipo es apto por defecto, 2D si no", () => {
    expect(quiere3D({ motor: null, guardado: null, apto: true })).toBe(true);
    expect(quiere3D({ motor: null, guardado: null, apto: false })).toBe(false);
  });

  it("lo apagó: 2D aunque el equipo sea apto. Lo prendió: 3D aunque no sea apto por defecto", () => {
    expect(quiere3D({ motor: null, guardado: false, apto: true })).toBe(false);
    expect(quiere3D({ motor: null, guardado: true, apto: false })).toBe(true);
  });

  it("?motor= manda sobre todo: 3d lo pide, cualquier otro valor es 2D", () => {
    expect(quiere3D({ motor: "3d", guardado: false, apto: false })).toBe(true);
    for (const m of ["clasico", "2d", "pixi"]) expect(quiere3D({ motor: m, guardado: true, apto: true })).toBe(false);
  });
});

describe("aptoPorDefecto3D: el umbral por juego", () => {
  it("sin umbral propio, vale lo mismo que permite3D", () => {
    expect(aptoPorDefecto3D(bueno, "trompo", pesado)).toBe(true);
    expect(aptoPorDefecto3D({ ...bueno, webgl: false }, "trompo", pesado)).toBe(false);
  });

  it("con umbral, hacen falta más de 4 núcleos y más de 4 GB; donde el navegador no lo dice, se confía", () => {
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 4, memoriaGB: 8 }, "pinata", pesado)).toBe(false);
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 8, memoriaGB: 4 }, "pinata", pesado)).toBe(false);
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 6, memoriaGB: 8 }, "pinata", pesado)).toBe(true);
    expect(aptoPorDefecto3D(bueno, "pinata", pesado)).toBe(true);
  });

  it("un equipo que ni siquiera permite el 3D tampoco lo tiene por defecto", () => {
    expect(permite3D({ ...bueno, nucleos: 2 })).toBe(false);
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 2 }, "pinata", pesado)).toBe(false);
  });
});

describe("los umbrales que se midieron", () => {
  it("la carrera arranca sola en 3D recién con más de 4 núcleos y más de 4 GB; el interruptor sigue ahí", () => {
    expect(UMBRAL_POR_JUEGO.race).toEqual({ nucleos: 4, memoriaGB: 4 });
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 4, memoriaGB: 8 }, "race")).toBe(false);
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 8, memoriaGB: 4 }, "race")).toBe(false);
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 8, memoriaGB: 8 }, "race")).toBe(true);
    // Los demás de la lista (medidos sin problema) siguen el mínimo.
    for (const j of ["trompo", "pinata", "toborochi", "sapo", "guajojo"]) expect(UMBRAL_POR_JUEGO[j]).toBeUndefined();
    expect(aptoPorDefecto3D({ ...bueno, nucleos: 4, memoriaGB: 4 }, "trompo")).toBe(true);
  });
});

/** `usa3D` de punta a punta: la dirección, la preferencia guardada, el equipo y la lista de juegos. */
describe("usa3D", () => {
  const almacen = new Map<string, string>();

  async function cargar(search: string, equipo: { nucleos?: number; memoria?: number; webgl?: boolean } = {}) {
    vi.resetModules();
    vi.stubGlobal("location", { search });
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => almacen.get(k) ?? null,
      setItem: (k: string, v: string) => void almacen.set(k, v),
      removeItem: (k: string) => void almacen.delete(k),
    });
    const sesion = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sesion.get(k) ?? null,
      setItem: (k: string, v: string) => void sesion.set(k, v),
      removeItem: (k: string) => void sesion.delete(k),
    });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", { hardwareConcurrency: equipo.nucleos ?? 8, deviceMemory: equipo.memoria ?? 8 });
    const lose = { loseContext: () => undefined };
    vi.stubGlobal("document", {
      createElement: () => ({ getContext: () => (equipo.webgl === false ? null : { getExtension: () => lose }) }),
    });
    const [engine, state] = await Promise.all([import("./engine"), import("../state")]);
    return { usa3D: engine.usa3D, puede3D: engine.puede3D, state };
  }

  beforeEach(() => almacen.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("nunca lo tocó: los juegos de la lista salen en 3D sin pedir nada", async () => {
    const { usa3D } = await cargar("");
    for (const j of ["race", "trompo", "pinata", "toborochi", "sapo", "guajojo"] as const) expect(usa3D(j)).toBe(true);
  });

  it("los juegos que no están en la lista siguen en 2D", async () => {
    const { usa3D } = await cargar("");
    for (const j of ["wheel", "quien", "chovena", "oruro", "teleferico"] as const) expect(usa3D(j)).toBe(false);
  });

  it("un equipo de 4 núcleos: los juegos medidos sin problema salen en 3D, la carrera en 2D hasta que se prende a mano", async () => {
    const { usa3D, state } = await cargar("", { nucleos: 4, memoria: 4 });
    expect(usa3D("trompo")).toBe(true);
    expect(usa3D("race")).toBe(false);
    state.setVer3D(true);
    expect(usa3D("race")).toBe(true);
    // Un equipo que ni siquiera permite el 3D no lo tiene aunque lo haya prendido.
    const justo = await cargar("", { nucleos: 2 });
    justo.state.setVer3D(true);
    expect(justo.usa3D("race")).toBe(false);
  });

  it("lo apagó: queda apagado; lo volvió a prender: 3D otra vez", async () => {
    const { usa3D, state } = await cargar("");
    state.setVer3D(false);
    expect(almacen.get("tinkazo.ver3d")).toBe("0");
    expect(usa3D("trompo")).toBe(false);
    state.setVer3D(true);
    expect(usa3D("trompo")).toBe(true);
  });

  it("la preferencia vieja (1) sigue valiendo como prendido", async () => {
    almacen.set("tinkazo.ver3d", "1");
    const { usa3D } = await cargar("");
    expect(usa3D("sapo")).toBe(true);
  });

  it("equipo que no puede: 2D, sin interruptor", async () => {
    for (const equipo of [{ webgl: false }, { nucleos: 2 }, { memoria: 2 }]) {
      const { usa3D, puede3D } = await cargar("", equipo);
      expect(puede3D()).toBe(false);
      expect(usa3D("trompo")).toBe(false);
    }
    const { usa3D, state } = await cargar("?motor=3d", { webgl: false });
    state.setVer3D(true);
    expect(usa3D("trompo")).toBe(false);
  });

  it("?motor= manda: clasico, 2d y pixi dan 2D aunque lo haya prendido; 3d lo da aunque lo haya apagado o no esté en la lista", async () => {
    almacen.set("tinkazo.ver3d", "1");
    for (const m of ["clasico", "2d", "pixi"]) expect((await cargar(`?motor=${m}`)).usa3D("trompo")).toBe(false);
    almacen.set("tinkazo.ver3d", "0");
    expect((await cargar("?motor=3d")).usa3D("trompo")).toBe(true);
    expect((await cargar("?motor=3d")).usa3D("wheel")).toBe(true);
  });

  it("la demo y la escena fija siguen la misma regla: nada en la dirección, 3D; con motor=clasico, 2D", async () => {
    expect((await cargar("?demo=trompo&instant=1&lead=3")).usa3D("trompo")).toBe(true);
    expect((await cargar("?pose=pinata")).usa3D("pinata")).toBe(true);
    expect((await cargar("?demo=trompo&motor=clasico")).usa3D("trompo")).toBe(false);
  });

  it("el modo para compartir queda en 2D", async () => {
    const { usa3D } = await cargar("?compartir=1");
    expect(usa3D("trompo")).toBe(false);
  });
});
