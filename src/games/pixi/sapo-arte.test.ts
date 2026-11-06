import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El arte del sapo en 2D (S8 en paridad con la 3D, y S7 para la mesa): las
 * argollas de la bandera de Bolivia, la rana verde linda, la mano de piel y la
 * mesa rústica de madera con adornos wiphala. `sapo.ts` se monta en el
 * navegador (no se puede importar acá), así que la paleta y la estructura
 * dibujada se cuidan sobre la fuente, como en holgura-3d.test.ts y
 * sapo-zoom-final.test.ts.
 */

const aqui = new URL(".", import.meta.url);
const src = readFileSync(new URL("./sapo.ts", aqui), "utf8");
const entre = (desde: string, hasta: string): string => src.slice(src.indexOf(desde), src.indexOf(hasta));
const numero = (declaracion: string): number => Number(new RegExp(declaracion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*([\\d.]+)").exec(src)?.[1] ?? NaN);

describe("las argollas llevan los colores de la bandera de Bolivia (S8)", () => {
  it("la paleta es la de la escena 3D: rojo, amarillo y verde", () => {
    expect(src).toContain("export const BANDERA = [0xd52b1e, 0xf9e300, 0x007934] as const;");
    // El aguayo del borde usa la misma paleta que la argolla.
    expect(src).toContain("export const AGUAYO = BANDERA;");
  });

  it("la argolla se dibuja con las tres franjas, ya no con el disco amarillo de antes", () => {
    const token = entre("function drawToken", "/** El parpadeo de la rana");
    expect(token).toContain("BANDERA[0]");
    expect(token).toContain("BANDERA[1]");
    expect(token).toContain("BANDERA[2]");
    // El cuerpo de la argolla ya no es el disco amarillo; el amarillo queda
    // solo para el destello del tiro ganador, que es de la casa.
    expect(token).not.toMatch(/fill\(\{ color: YELLOW/);
    expect(token).toContain("YELLOW");
  });
});

describe("la rana verde y la mano de piel (S8)", () => {
  it("la rana usa el verde de la 3D: cuerpo, manchas oscuras y brillo claro", () => {
    expect(src).toContain("export const RANA = 0x5cb746;");
    expect(src).toContain("export const RANA_OSC = 0x3d7a24;");
    expect(src).toContain("export const RANA_CLARO = 0x9ade6b;");
    const rana = entre("function drawFrog", "/** Dónde está la mano");
    expect(rana).toContain("fill(RANA)");
    expect(rana).toContain("RANA_OSC");
    expect(rana).toContain("RANA_CLARO");
    expect(src).not.toContain("0xb98a3e");
  });

  it("la mano que tira es piel, con su sombra, no madera", () => {
    expect(src).toContain("export const PIEL = 0xdba27f;");
    expect(src).toContain("export const PIEL_OSC = 0xc08a68;");
    const mano = entre("function drawHand", "/** La argolla");
    expect(mano).toContain("PIEL_OSC");
    expect(mano).toMatch(/color: PIEL[,}]/);
    expect(src).not.toContain("0xc68a5c");
  });
});

describe("la mesa rústica de madera con colores de Bolivia (S7)", () => {
  it("el cajón es madera de verdad: tapa, frente y cajones en marrones ricos, con vetas", () => {
    expect(src).toContain("tapa: 0xc08a4d");
    expect(src).toContain("tapaNoche: 0x8a5a2c");
    expect(src).toContain("veta: 0x6b4423");
    expect(src).toContain("frente: 0x7a4a22");
    expect(src).toContain("frenteNoche: 0x5e3a1c");
    expect(src).toContain("cajon: 0x8f5a2b");
    expect(src).toContain("cajonNoche: 0x4d2e12");
    const caja = entre("function drawBox", "function drawFrog");
    expect(caja).toContain("MADERA.tapa");
    expect(caja).toContain("MADERA.frente");
    expect(caja).toContain("MADERA.cajon");
    expect(caja).toContain("veta");
  });

  it("el cajón se ve más grande en la pantalla ancha, y el dibujo y la cámara salen de la misma medida", () => {
    expect(numero("export const MESA_ANCHO")).toBeGreaterThan(2.1);
    expect(numero("export const MESA_FONDO")).toBeGreaterThan(2.05);
    const mesa = entre("const mesa = (): Caja", "/** Lo que se ve del juego");
    const caja = entre("function drawBox", "function drawFrog");
    expect(mesa).toContain("medidasMesa");
    expect(caja).toContain("medidasMesa");
    // El dibujo del cajón no toca los agujeros: los pone el plan.
    expect(caja).not.toContain("L.holes");
  });

  it("las patas asoman debajo del frente y el aguayo del borde es wiphala de Bolivia", () => {
    const caja = entre("function drawBox", "function drawFrog");
    expect(caja).toContain("pata");
    expect(caja).toContain("AGUAYO");
  });
});
