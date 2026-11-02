import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FUERA_DEL_SELECTOR, SELECTOR, juegosDelKit } from "./juegos.mjs";
import { ARCHIVOS_DE_JUEGO, CLAVES_DE_JUEGO, adivinarIdioma, aplicarExcepciones, buscarEn, clavesTecnicas, compilarLista, enAlcance, hallazgosDe, juegoDeArchivo, juegoDeClave, llano, reglasDe } from "./palabras.mjs";
import { leerResumen } from "./resumen.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const datos = JSON.parse(readFileSync(join(aqui, "palabras-prohibidas.json"), "utf8"));
const reglas = reglasDe(datos);
const texto = (t, extra = {}) => ({ archivo: "x.ts", clave: "k", linea: 1, idioma: "es", juego: null, tarjeta: false, tecnico: false, ensayoStand: false, ...extra, texto: t });
const reglasQueFallan = (t) => hallazgosDe([t], reglas).map((h) => h.regla);

describe("buscar palabras", () => {
  const lista = compilarLista(["apuestas?", "p[oó]ker"]);
  it("palabra entera, sin tildes ni mayúsculas", () => {
    expect(buscarEn("Nada de APUESTAS acá", lista).map((h) => h.palabra)).toEqual(["APUESTAS"]);
    expect(buscarEn("una mano de poker", lista)).toHaveLength(1);
    expect(buscarEn("una mano de PÓKER", lista)).toHaveLength(1);
  });
  it("no toma parte de otra palabra", () => {
    expect(buscarEn("apuestamos", lista)).toHaveLength(0);
  });
  it("llano conserva el largo", () => {
    expect(llano("Piñata Ñandú")).toHaveLength("Piñata Ñandú".length);
  });
});

describe("el grupo apuesta", () => {
  it("falla por casino, jackpot, plata y dados", () => {
    for (const t of ["Bienvenidos al casino", "¡Jackpot!", "ganá plata fácil", "tirá los dados"]) expect(reglasQueFallan(texto(t))).toContain("apuesta");
    for (const t of ["Place your bet", "No gambling here", "free cash", "roll the dice", "poker night"]) expect(reglasQueFallan(texto(t, { idioma: "en" }))).toContain("apuesta");
  });
  it("lo que Tinkazo usa a propósito no falla: ficha, premio, ruleta", () => {
    for (const t of ["Tu ficha con el nombre", "El premio es un libro", "La ruleta gira"]) expect(reglasQueFallan(texto(t))).toEqual([]);
  });
  it("«dice» es español y no inglés: no se confunde con dice (dados)", () => {
    expect(reglasQueFallan(texto("El enlace dice de dónde venís"))).toEqual([]);
    expect(reglasQueFallan(texto("Roll the dice", { idioma: "en" }))).toContain("apuesta");
  });
});

describe("el grupo vocabulario", () => {
  it("de pie: nada de eliminado, perdió o fuera, solo en esos juegos", () => {
    expect(reglasQueFallan(texto("Quedó eliminada", { juego: "guajojo" }))).toContain("de-pie");
    expect(reglasQueFallan(texto("Perdiste", { juego: "toborochi" }))).toContain("de-pie");
    expect(reglasQueFallan(texto("You are out", { juego: "pinata", idioma: "en" }))).toContain("de-pie");
    expect(reglasQueFallan(texto("Quedó eliminada", { juego: "trompo" }))).not.toContain("de-pie");
  });
  it("de pie: «step out» no es eliminar", () => {
    expect(reglasQueFallan(texto("The walkers step out!", { juego: "guajojo", idioma: "en" }))).toEqual([]);
  });
  it("ensayo y stand: «gana» no, «sale» sí", () => {
    expect(reglasQueFallan(texto("Gana Lupe", { ensayoStand: true }))).toContain("ensayo-stand");
    expect(reglasQueFallan(texto("Winner: Lupe", { ensayoStand: true, idioma: "en" }))).toContain("ensayo-stand");
    expect(reglasQueFallan(texto("Salió Lupe", { ensayoStand: true }))).toEqual([]);
    expect(reglasQueFallan(texto("Gana Lupe"))).toEqual([]);
  });
  it("el relator dentro de un juego tampoco dice gana", () => {
    expect(reglasQueFallan(texto("¡Gana quien llegue!", { archivo: "src/games/x.ts", juego: "race" }))).toContain("stand-relator");
    expect(reglasQueFallan(texto("Gana quien llegue", { archivo: "src/i18n.ts", clave: "jgRaceB", juego: "race" }))).toEqual([]);
  });
  it("el punto medio, en todo", () => {
    expect(reglasQueFallan(texto("Uno · dos"))).toContain("punto-medio");
  });
  it("tecnicismos en el show y las tarjetas, no en lo técnico", () => {
    expect(reglasQueFallan(texto("La firma pesa 48 bytes", { juego: "race" }))).toContain("tecnicismos");
    expect(reglasQueFallan(texto("El hash de la lista", { tarjeta: true }))).toContain("tecnicismos");
    expect(reglasQueFallan(texto("La firma pesa 48 bytes", { tarjeta: true, tecnico: true }))).toEqual([]);
    expect(reglasQueFallan(texto("El hash de la lista"))).toEqual([]);
  });
  it("un alcance desconocido es un error y no un silencio", () => {
    expect(() => enAlcance("nada", texto("x"))).toThrow();
  });
});

describe("las excepciones", () => {
  const h = { archivo: "src/i18n.ts", clave: "tmQ1B", grupo: "apuesta", regla: "apuesta", palabra: "apuestas", juego: "sitio", texto: "no es para apuestas" };
  it("dejan pasar lo que cubren y devuelven las que no se usaron", () => {
    const r = aplicarExcepciones([h], [{ archivo: "src/i18n.ts", clave: "tmQ1B", regla: "apuesta", motivo: "m", fecha: "f" }, { archivo: "otro.ts", motivo: "m", fecha: "f" }]);
    expect(r.fallan).toEqual([]);
    expect(r.cubiertos).toHaveLength(1);
    expect(r.sinUso).toHaveLength(1);
  });
  it("el archivo admite * al final, y la palabra y el juego acotan", () => {
    expect(aplicarExcepciones([h], [{ archivo: "src/*", palabra: "apuestas", juego: "sitio" }]).fallan).toEqual([]);
    expect(aplicarExcepciones([h], [{ archivo: "src/*", palabra: "otra" }]).fallan).toHaveLength(1);
    expect(aplicarExcepciones([h], [{ archivo: "src/*", juego: "ledger" }]).fallan).toHaveLength(1);
  });
  it("todas llevan motivo y fecha", () => {
    for (const e of datos.excepciones) {
      expect(e.motivo, JSON.stringify(e)).toBeTruthy();
      expect(e.fecha, JSON.stringify(e)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe("el reparto por juego", () => {
  it("todo juego del kit y del selector tiene su regla de archivo o de clave", () => {
    for (const id of new Set([...SELECTOR, ...juegosDelKit()])) {
      expect(ARCHIVOS_DE_JUEGO[id] ?? CLAVES_DE_JUEGO[id], id).toBeTruthy();
    }
    expect(FUERA_DEL_SELECTOR.length).toBeGreaterThan(0);
  });
  it("asigna archivos y claves", () => {
    expect(juegoDeArchivo("src/games/pixi/guajojo-textos.ts")).toBe("guajojo");
    expect(juegoDeArchivo("src/games/llamas/carrera-textos.ts")).toBe("race");
    expect(juegoDeArchivo("src/games/pixi/stage.ts")).toBeNull();
    expect(juegoDeClave("jgToborochiB")).toBe("toborochi");
    expect(juegoDeClave("trCambio")).toBe("trueque");
    expect(juegoDeClave("standBanda")).toBeNull();
  });
  it("las tarjetas técnicas salen de lore.ts", () => {
    const fuente = 'export const LORE = {\n  any: [\n    {\n      q: "aQ",\n      a: "aA",\n      href: "x",\n    },\n    {\n      q: "bQ",\n      a: "bA",\n      tecnica: true,\n    },\n  ],\n};';
    expect([...clavesTecnicas(fuente)].sort()).toEqual(["bA", "bQ"]);
  });
  it("adivina el idioma", () => {
    expect(adivinarIdioma("¡Busquen su nombre!")).toBe("es");
    expect(adivinarIdioma("Find your name!")).toBe("en");
  });
});

describe("el auditor entero", () => {
  const script = resolve(aqui, "..", "audit-palabras.mjs");
  it("aprueba el repo y deja la línea JSON", () => {
    const r = spawnSync(process.execPath, [script, "todo", "--json"], { encoding: "utf8" });
    expect(r.status, r.stdout).toBe(0);
    const res = leerResumen(r.stdout);
    expect(res.auditor).toBe("audit-palabras");
    expect(res.fallas).toEqual([]);
    expect(res.total).toBeGreaterThan(20);
  });
  it("un objetivo desconocido sale con 2", () => {
    expect(spawnSync(process.execPath, [script, "nadie"], { encoding: "utf8" }).status).toBe(2);
  });
});
