import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { letraMinima } from "./letra";
import { adentro, mapeoDe, planBolillas, finalistasDe, type Datos, type Pant } from "./bolillas-plan";
import { TEXTOS } from "./bolillas-textos";
import { CHIP_ALTO_FRACCION, CHIP_GENTE, escalaChipDe } from "./bolillas-arte";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego (como en los otros suites de bolillas). */
function contexto(n: number): Parameters<typeof planBolillas>[0] {
  const rng = sembrar(7);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores: [Math.min(n - 1, 3)],
    ronda: RONDA,
    rng,
    idioma: "es",
    txt: (clave) => {
      const v = (TEXTOS.es as Record<string, string>)[clave];
      return v ?? clave;
    },
    azar: (etiqueta) => azarDe(RONDA, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

/** Un plan real, como el que corre la escena. */
const datosDe = (n: number): Datos => planBolillas(contexto(n)).datos;

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

describe("bolillas: los nombres solo para los últimos 3 (S15)", () => {
  it("durante la troya no hay fichas: recién cuando quedan tres o menos adentro, y son los finalistas", () => {
    for (const n of [8, 18, 60]) {
      const d = datosDe(n);
      // Mientras juegan muchos (la presentación, la tanda y el arranque de la troya), ninguna ficha.
      expect(finalistasDe(d, 0.5), `con ${n}`).toEqual([]);
      expect(finalistasDe(d, d.tTroya), `con ${n}`).toEqual([]);
      expect(finalistasDe(d, (d.tiros[0] as { t: number }).t + 0.5), `con ${n}`).toEqual([]);
      // Cuando quedan tres o menos, las fichas son exactamente los que siguen adentro: los finalistas.
      for (const t of [d.casi.t, d.duracion - 0.01, d.duracion, d.duracion + 2]) {
        expect(finalistasDe(d, t), `finalistas con ${n} a los ${t.toFixed(1)}`).toEqual(adentro(d, t));
        expect(finalistasDe(d, t).length, `con ${n}`).toBeLessThanOrEqual(3);
      }
      // La ganadora está entre los finalistas hasta la coronación.
      expect(finalistasDe(d, d.duracion), `con ${n}`).toContain(d.ganador);
    }
  });

  it("es la regla de `adentro`, pura: mismo plan, mismos finalistas", () => {
    const d = datosDe(18);
    expect(finalistasDe(d, 10)).toEqual(finalistasDe(d, 10));
  });

  it("en la escena, la ficha se ve solo si la persona está entre los finalistas (y la coronación la retira)", () => {
    const f = codigo("bolillas.ts");
    expect(f).toMatch(/finalistasDe\(/);
    expect(f).toMatch(/final\.includes\(persona\)/);
    expect(f).toMatch(/&& !\(k\.coronado && persona === d\.ganador\)/);
  });
});

describe("bolillas: la coronación sin nombre duplicado (S12)", () => {
  it("cuando sale el cartel del kit, la ficha del ganador se retira: el nombre una sola vez", () => {
    const f = codigo("bolillas.ts");
    // S15 agregó la puerta de los finalistas delante; la coronación sigue retirando la ficha del ganador.
    expect(f).toMatch(/chip\.visible = final\.includes\(persona\) && seVe && tray\.estado !== "afuera" && !\(k\.coronado && persona === d\.ganador\)/);
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
