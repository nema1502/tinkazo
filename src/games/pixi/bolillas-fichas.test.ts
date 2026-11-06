import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { letraMinima } from "./letra";
import { mapeoDe, type Pant } from "./bolillas-plan";
import { CHIP_ALTO_FRACCION, CHIP_GENTE, escalaChipDe } from "./bolillas-arte";

const fuente = (f: string): string => readFileSync(new URL(`./${f}`, import.meta.url), "utf8");
/** La fuente sin comentarios: para mirar el código y no los avisos. */
const codigo = (f: string): string => fuente(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * La pantalla del celular de la denuncia (S11): 390 por 844, con la barra arriba y el relator abajo.
 * El círculo cae con el mapa del plan (`mapeoDe`), igual que en la escena.
 */
const PANTALLA: Pant = { w: 390, h: 844, k: 390 / 420, top: 90, bottom: 724 };
const ePantalla = mapeoDe(PANTALLA).e;
/** La escala que la ficha llevaba antes (la de la figura del kit): la denuncia es que tapaba todo. */
const escalaFigura = 56 / (16 * 1.6);

describe("bolillas: la escala de las fichas del nombre (S11)", () => {
  it("la ficha es una etiqueta chico junto al círculo: se lee, y su alto no pasa su parte del diámetro", () => {
    for (let n = 2; n <= 30; n++) {
      const u = PANTALLA.k;
      const s = escalaChipDe(u, ePantalla, n);
      // La letra del chip (12 * u * escala * 1.6 px) llega a la regla de la sala.
      expect(12 * u * s * 1.6, `letra con ${n} juegan`).toBeGreaterThanOrEqual(letraMinima(u) - 1e-9);
      // El alto del chip (22 * u * escala * 1.6 px) no tapa el círculo: su fracción del diámetro, y nada más.
      expect(22 * u * s * 1.6, `alto con ${n} juegan`).toBeLessThanOrEqual(2 * ePantalla * CHIP_ALTO_FRACCION + 1e-9);
      // Chica siempre: nunca la figura gigante de antes.
      expect(s, `escala con ${n} juegan`).toBeLessThan(escalaFigura);
    }
  });

  it("más gente, ficha no más grande: la escala baja (o queda en el piso) con la cantidad", () => {
    let antes = Infinity;
    for (let n = 2; n <= 30; n++) {
      const s = escalaChipDe(PANTALLA.k, ePantalla, n);
      expect(s, `baja con ${n} juegan`).toBeLessThanOrEqual(antes + 1e-12);
      antes = s;
    }
  });

  it("en pantalla ancha con poca gente puede crecer un cuarto, y nunca más", () => {
    const u = 1; // 1280 por 720: el diseño de la casa
    const e = mapeoDe({ w: 1280, h: 720, k: 1, top: 82, bottom: 614 }).e;
    const piso = 18.666666666666668 / (12 * 1.6);
    expect(escalaChipDe(u, e, 2)).toBeCloseTo(Math.min(piso * 1.25, CHIP_GENTE / 2), 9);
    expect(escalaChipDe(u, e, 4)).toBe(piso);
    expect(escalaChipDe(u, e, 30)).toBe(piso);
    // El alto tampoco pasa su parte del círculo en la pantalla ancha.
    for (let n = 2; n <= 30; n++) {
      const s = escalaChipDe(u, e, n);
      expect(22 * u * s * 1.6).toBeLessThanOrEqual(2 * e * CHIP_ALTO_FRACCION + 1e-9);
    }
  });

  it("es pura: mismo argumento, misma escala, sin azar propio", () => {
    expect(escalaChipDe(PANTALLA.k, ePantalla, 12)).toBe(escalaChipDe(PANTALLA.k, ePantalla, 12));
    // La cantidad sí cambia la ficha donde puede (con poco gente crece; con mucha queda en el piso).
    expect(escalaChipDe(PANTALLA.k, ePantalla, 2)).not.toBe(escalaChipDe(PANTALLA.k, ePantalla, 12));
  });
});

describe("bolillas: la coronación sin nombre duplicado (S12)", () => {
  it("cuando sale el cartel del kit, la ficha del ganador se retira: el nombre una sola vez", () => {
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/chip\.visible = seVe && tray\.estado !== "afuera" && !\(k\.coronado && persona === d\.ganador\)/);
    // La ficha del ganador no se agranda para la coronación: no se ve.
    expect(f).not.toMatch(/chip\.scale\.set\(1\.2\)/);
  });

  it("la ficha del juego mide con la escala del círculo, no con la figura del kit", () => {
    const f = codigo("bolillas.ts");
    expect(f).not.toMatch(/escalaDeFigura/);
    expect(f).toMatch(/escalaChipDe\(/);
    expect(f).toMatch(/S\.chip\(k\.nombres\[persona\] \?\? "", e\.escala\)/);
  });
});
