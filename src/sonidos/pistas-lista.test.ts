import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JUEGOS_CON_MUSICA } from "./musica-remota";
import { leerPista, SECCIONES } from "./pistas";
import { PISTAS } from "./pistas-lista";

/**
 * La lista de las pistas: las que el sitio puede tocar son solo las que ya se escucharon dentro del juego. Las demás
 * están armadas en `src/sonidos/pistas/`, se leen con el lector del sitio y esperan a que alguien las escuche. Ningún
 * archivo de audio viaja con el repositorio.
 *
 * Sumar un juego a la lista es una decisión de oído: se cambia `APROBADAS` acá y `pistas-lista.ts` en el mismo commit.
 */
const APROBADAS = ["race"];

const CARPETA = new URL("./pistas/", import.meta.url);
const ARMADAS = readdirSync(CARPETA)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();
const armada = (juego: string): unknown => JSON.parse(readFileSync(new URL(`${juego}.json`, CARPETA), "utf8"));

describe("la lista de pistas del sitio", () => {
  it("trae solo las pistas que ya se escucharon dentro del juego", () => {
    expect(Object.keys(PISTAS).sort()).toEqual(APROBADAS);
  });

  it("la carrera está, y ningún juego sin pista aprobada: ni la chovena ni los que esperan", () => {
    expect(PISTAS.race).toBeDefined();
    for (const j of ["chovena", "wheel", "trompo", "sapo", "oruro", "pinata", "toborochi", "teleferico", "guajojo"]) expect(PISTAS[j]).toBeUndefined();
  });

  it("cada pista de la lista es el contenido de su JSON, sin retoques", () => {
    for (const j of APROBADAS) expect(PISTAS[j]).toEqual(armada(j));
  });
});

describe("las pistas armadas", () => {
  it("siguen en su carpeta las de los nueve juegos con pista, y la chovena no tiene", () => {
    expect(ARMADAS).toEqual(["guajojo", "oruro", "pinata", "race", "sapo", "teleferico", "toborochi", "trompo", "wheel"]);
    for (const j of ARMADAS) expect((JUEGOS_CON_MUSICA as readonly string[]).includes(j)).toBe(true);
    expect(ARMADAS).not.toContain("chovena");
  });

  it.each(ARMADAS)("la pista de %s se lee, es de su juego y trae cuerpo y golpe", (juego) => {
    const p = leerPista(armada(juego), juego);
    expect(p).not.toBeNull();
    expect(p?.secciones.cuerpo).toBeDefined();
    expect(p?.secciones.golpe).toBeDefined();
    // Un JSON de otro juego no se acepta como este.
    expect(leerPista(armada(juego), juego === "race" ? "sapo" : "race")).toBeNull();
  });

  it.each(ARMADAS)("los archivos de %s se llaman <juego>-<versión>-<sección>.mp3 y caben en los 32 caracteres del servicio", (juego) => {
    const p = leerPista(armada(juego), juego);
    if (!p) throw new Error("la pista no se leyó");
    for (const seccion of SECCIONES) {
      const s = p.secciones[seccion];
      if (!s) continue;
      expect(s.archivo).toBe(`${juego}-${p.version}-${seccion}.mp3`);
      expect(s.archivo.length).toBeLessThanOrEqual(32 + ".mp3".length);
    }
  });

  it("la carrera lleva las cinco secciones, y el volumen de cada pista está dentro del tope", () => {
    const p = leerPista(PISTAS.race, "race");
    expect(Object.keys(p?.secciones ?? {}).sort()).toEqual(["cuerpo", "entrada", "festejo", "golpe", "subida"]);
    for (const j of ARMADAS) {
      const q = leerPista(armada(j), j);
      for (const s of Object.values(q?.secciones ?? {})) expect((q?.ganancia ?? 0) * (s?.ganancia ?? 0)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe("el código del sitio", () => {
  it("no trae un solo archivo de audio", () => {
    const audio = readdirSync(new URL("../", import.meta.url), { recursive: true }).filter((f) => /\.(mp3|wav|ogg|m4a|aac|flac|weba)$/i.test(String(f)));
    expect(audio).toEqual([]);
  });
});
