import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { NOMBRE, REGLA, VARIOS } from "./gamecard";
import { SELECTOR } from "./recomendar";

describe("la tarjeta de cómo se juega", () => {
  it("cada nombre y cada regla existen como texto en los dos idiomas", () => {
    // Con una clave mal escrita, t() devuelve la clave cruda, y en el proyector
    // salía "gcNuevo" en letra grande durante tres segundos y medio.
    const claves = [...Object.values(NOMBRE), ...Object.values(REGLA), ...Object.values(VARIOS), "gcKicker", "gcHonest", "gcSapoQual"];
    const faltan = (["es", "en"] as const).flatMap((l) => claves.filter((k) => typeof T[l][k] !== "string").map((k) => `${l}.${k}`));
    expect(faltan).toEqual([]);
  });

  it("los textos con número existen en los dos idiomas", () => {
    for (const l of ["es", "en"] as const) {
      expect(T[l].gcPeople(18)).toMatch(/18/);
      expect(T[l].gcPrizes(3)).toMatch(/3/);
      expect(T[l].gcPrizesNote(3)).toMatch(/3/);
    }
  });

  it("cada juego del selector tiene su captura de fondo, y el archivo existe", () => {
    // Sin captura la tarjeta sale sobre el color liso: se notaba con El Trueque,
    // que entró al selector el 21 de octubre de 2026.
    const fuente = readFileSync(new URL("./gamecard.ts", import.meta.url), "utf8");
    const conCaptura = [...(/const CAPTURA = new Set<Game>\(\[([^\]]*)\]\)/.exec(fuente)?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    for (const juego of SELECTOR) {
      expect(conCaptura, juego).toContain(juego);
      expect(existsSync(new URL(`../../public/juegos/${juego}.webp`, import.meta.url)), `${juego}.webp`).toBe(true);
      expect(existsSync(new URL(`../../public/juegos/${juego}-light.webp`, import.meta.url)), `${juego}-light.webp`).toBe(true);
    }
  });
});
