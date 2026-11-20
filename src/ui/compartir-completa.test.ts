import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import { fotoDeSorteo } from "./compartir";

/**
 * Dónde está la lista completa, para la foto del juego cuando no se ven todos los nombres (`Foto.completa`).
 *
 * El QR lleva la lista entera solo si el sorteo está anclado: sin sello (la red no dejó sellar, el modo libre, la demo y el
 * ensayo) el comprobante rehace un solo ganador. Ahí la foto no puede decir que la lista está en el QR: dice que está en el
 * mensaje, que nombra a todos. Un orden de turnos dice «orden» en lugar de «lista».
 */

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
const anclado = { enlace, ganadores: nombres(12), total: 80, premio: "Pizza", numero: "278", red: "testnet", fecha: 1_792_500_000 };

describe("la frase de dónde está la lista completa", () => {
  it("las cuatro claves existen en español y en inglés, y ninguna está vacía", () => {
    for (const clave of ["fotoListaEnQr", "fotoOrdenEnQr", "fotoListaEnMensaje", "fotoOrdenEnMensaje"]) {
      for (const lang of ["es", "en"] as const) expect(String(T[lang][clave as keyof (typeof T)["es"]] ?? ""), `${lang} ${clave}`).not.toBe("");
    }
  });

  it("un sorteo anclado: la del QR en el QR y la del mensaje en el mensaje", () => {
    const f = fotoDeSorteo("es", anclado, enlace);
    expect(f.completa).toEqual({ qr: "La lista completa está en el QR.", mensaje: "La lista completa está en el mensaje." });
    const en = fotoDeSorteo("en", anclado, enlace);
    expect(en.completa).toEqual({ qr: "The full list is in the QR code.", mensaje: "The full list is in the message." });
  });

  it("sin sello: el QR no lleva la lista, así que ni la foto lo promete", () => {
    for (const lang of ["es", "en"] as const) {
      const f = fotoDeSorteo(lang, { ...anclado, sinSello: true, numero: undefined, red: undefined }, enlace);
      expect(f.completa?.qr).toBe(f.completa?.mensaje);
      expect(f.completa?.qr).not.toMatch(/QR/);
      expect(f.completa?.qr).toMatch(lang === "es" ? /mensaje/ : /message/);
    }
  });

  it("sin número de sorteo (modo libre, demo, ensayo): tampoco promete el QR", () => {
    for (const lang of ["es", "en"] as const) {
      const f = fotoDeSorteo(lang, { enlace, ganadores: nombres(12), total: 80, premio: "Pizza" }, enlace);
      expect(f.completa?.qr).toBe(f.completa?.mensaje);
      expect(f.completa?.qr).not.toMatch(/QR/);
    }
  });

  it("un sorteo anclado con un sello que dice sin sello a la vez (dato contradictorio): gana el sin sello", () => {
    const f = fotoDeSorteo("es", { ...anclado, sinSello: true }, enlace);
    expect(f.completa?.qr).not.toMatch(/QR/);
  });

  it("un orden de turnos anclado: «orden» en lugar de «lista»", () => {
    const turnos = { ...anclado, ganadores: nombres(18), total: 18, premio: "Turnos de limpieza" };
    const f = fotoDeSorteo("es", turnos, enlace);
    expect(f.titulo).toBe("Orden de turnos");
    expect(f.completa).toEqual({ qr: "El orden completo está en el QR.", mensaje: "El orden completo está en el mensaje." });
    expect(fotoDeSorteo("en", turnos, enlace).completa).toEqual({ qr: "The full order is in the QR code.", mensaje: "The full order is in the message." });
  });

  it("un orden de turnos sin sello no tiene comprobante ni QR: dice que el orden está en el mensaje", () => {
    const turnos = { enlace, ganadores: nombres(18), total: 18, premio: "Turnos", sinSello: true };
    const f = fotoDeSorteo("es", turnos, enlace);
    expect(f.enlace).toBe("");
    expect(f.completa?.qr).toBe("El orden completo está en el mensaje.");
  });

  it("con el mismo texto en las páginas que cargan solo sus claves: las cuatro están citadas entre comillas en compartir.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const fuente = readFileSync("src/ui/compartir.ts", "utf8");
    for (const clave of ["fotoListaEnQr", "fotoOrdenEnQr", "fotoListaEnMensaje", "fotoOrdenEnMensaje"]) expect(fuente).toContain(`"${clave}"`);
  });
});
