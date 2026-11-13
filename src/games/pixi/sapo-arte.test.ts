import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El arte del sapo en 2D, en paridad con la 3D: las argollas amarillas de
 * siempre, la rana verde linda, la mano de piel y la mesa rústica de madera
 * con adornos de los cinco acentos de la casa. `sapo.ts` se monta en el
 * navegador (no se puede importar acá), así que la paleta y la estructura
 * dibujada se cuidan sobre la fuente, como en holgura-3d.test.ts y
 * sapo-zoom-final.test.ts.
 */

const aqui = new URL(".", import.meta.url);
const src = readFileSync(new URL("./sapo.ts", aqui), "utf8");
const entre = (desde: string, hasta: string): string => src.slice(src.indexOf(desde), src.indexOf(hasta));
const numero = (declaracion: string): number => Number(new RegExp(declaracion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*([\\d.]+)").exec(src)?.[1] ?? NaN);

describe("las argollas siguen amarillas, sin los colores de la bandera", () => {
  it("la argolla se dibuja como disco amarillo con agujero, no con franjas de la bandera", () => {
    const token = entre("function drawToken", "/** El parpadeo de la rana");
    expect(token).not.toContain("BANDERA");
    expect(token).toContain("fill({ color: YELLOW");
  });

  it("la mesa tampoco los lleva: el sapo no define la bandera", () => {
    expect(src).not.toMatch(/BANDERA|AGUAYO|0xf9e300|0x007934|[Ww]iphala/);
    const caja = entre("function drawBox", "function drawFrog");
    expect(caja).not.toContain("0xd52b1e");
  });
});

describe("la rana verde y la mano de piel", () => {
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

describe("la mesa rústica de madera", () => {
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

  it("las patas asoman debajo del frente y el aguayo del borde va con los cinco acentos del tema", () => {
    const caja = entre("function drawBox", "function drawFrog");
    expect(caja).toContain("pata");
    expect(caja).toContain(".fill(S.color(i));");
    expect(caja).toContain(".fill(S.color(i + fila));");
  });
});

describe("la mano que tira hace el movimiento real y flexiona los dedos", () => {
  const senal = (): string => entre("const impulsoMano", "/** Las argollas que se ven");
  const mano = (): string => entre("function drawHand", "/** La argolla");

  it("los dedos son falanges articuladas (dos tramos), curvadas por la flexión, no círculos estáticos", () => {
    expect(mano()).toContain("flexMano()");
    expect(mano()).toContain("curva");
    // Dos tramos por dedo: de la base al nudillo y del nudillo a la punta.
    expect(mano()).toMatch(/\.lineTo\([A-Za-z]+\d*\.x, [A-Za-z]+\d*\.y\)\.lineTo\([A-Za-z]+\d*\.x, [A-Za-z]+\d*\.y\)/);
    // Los puntitos estáticos de antes ya no están: en la mano solo queda el círculo de la palma.
    const circulos = mano().match(/\.circle\(/g) ?? [];
    expect(circulos.length).toBe(1);
    // Cada falange lleva su trazo de tinta y su piel, como la casa.
    expect(mano()).toContain("join");
  });

  it("la mano se echa atrás al tomar impulso y látiga al soltar, y la moneda la sigue", () => {
    expect(src).toContain("const rotar");
    // El latigazo dura lo que ya duraba el golpe del suelte: 0,3 s. Sin cambiar el reloj del plan.
    expect(numero("const LATIGO")).toBeCloseTo(0.3);
    // drawHand ya no repite el cálculo del impulso: lo toma de la única fuente.
    expect(mano()).toContain("impulsoMano()");
    expect(mano()).toContain("gestoMano()");
    expect(mano()).not.toContain("1 - u / WINDUP");
    // La moneda en la mano viaja con el gesto, para que no se le despegue.
    const dibujo = entre("function draw(): void", "/** Dónde está el agujero de quien gana");
    expect(dibujo).toContain("gestoMano()");
  });

  it("la flexión y la fase salen del guion de tiros, sin azar nuevo", () => {
    const s = senal();
    expect(s).toContain("const flexMano");
    expect(s).toContain("const faseLanzamiento");
    expect(s).toContain("const gestoMano");
    expect(s).toContain("WINDUP");
    expect(s).not.toContain("Math.random");
    expect(s).not.toContain("rng");
  });

  it("el puente `mano` exporta flex y fase, y tipos.ts los recibe como opcionales compatibles", () => {
    const puente = entre("function frame3D", "/** Los rayos");
    expect(puente).toContain("flex: flexMano()");
    expect(puente).toContain("fase: faseLanzamiento()");
    const tipos = readFileSync(new URL("../tres/tipos.ts", aqui), "utf8");
    expect(tipos).toContain("SenalMano");
    expect(tipos).toMatch(/flex\?:/);
    expect(tipos).toMatch(/fase\?:/);
  });
});

describe("el suspenso del borde: la moneda rueda al aro", () => {
  const token = (): string => entre("const tokenAt", "el guion hablado");

  it("algunas casi-entran dan la vuelta al aro del agujero, siempre la misma decisión y nunca la ganadora", () => {
    expect(src).toContain("const ruedaEnElAro");
    // La decisión la fija el tiro, no el azar: hash del índice, del agujero del borde y del turno.
    const rueda = entre("const ruedaEnElAro", "/** Dónde está la argolla en el momento");
    expect(rueda).not.toContain("rng");
    expect(rueda).not.toContain("Math.random");
    expect(rueda).toContain("o.final");
    // La vuelta es alrededor del aro del agujero que ya decidió el plan, y una vuelta completa.
    expect(token()).toContain("ruedaEnElAro");
    expect(token()).toContain("L.holes[o.th.rimSlot]");
    expect(token()).toContain("Math.atan2");
    expect(token()).toContain("Math.PI * 2");
  });

  it("el beat es el mismo de siempre: WOBBLE manda el momento y la salida de después no se toca", () => {
    const token = entre("const tokenAt", "el guion hablado");
    expect(token).toContain("age < WOBBLE");
    expect(token).toContain("(o.th.kind === \"near\" ? WOBBLE");
    expect(token).toContain("o.th.landing.x + (o.th.exit.x - o.th.landing.x) * e");
  });
});
