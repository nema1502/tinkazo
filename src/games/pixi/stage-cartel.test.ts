import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { altoCartelDe, centroCartel, filasCorona, filasEnCartel, nombresEnCartel } from "./stage-cartel";

/**
 * La cuenta del cartel del final (`stage-cartel.ts`), probada sin placa de
 * video, como `letra.test.ts` y `ganador-altura.test.ts`. El issue 118 pide:
 * en un orden de turnos el cartel muestra muchos nombres (hasta 6 u 8) sin
 * achicar la letra y, si quedan de más, sigue con los primeros y «y N más»;
 * en un sorteo de premios queda en tres, como hoy; el alto del cartel y la
 * protección de la cámara usan ese conteo; y en un celular vertical (390 de
 * ancho) no entran ocho filas con cara (S3), así que en vertical el orden
 * muestra menos filas.
 */
describe("el tope de nombres del cartel", () => {
  it("en un sorteo de premios queda en tres, como hoy, parado o girado", () => {
    expect(nombresEnCartel(1, false, false)).toBe(1);
    expect(nombresEnCartel(2, false, false)).toBe(2);
    expect(nombresEnCartel(3, false, false)).toBe(3);
    expect(nombresEnCartel(4, false, false)).toBe(3);
    expect(nombresEnCartel(30, false, false)).toBe(3);
    expect(nombresEnCartel(300, false, true)).toBe(3);
  });

  it("en un orden de turnos lista hasta ocho nombres en horizontal sin achicar la letra", () => {
    for (let n = 1; n <= 8; n++) expect(nombresEnCartel(n, true, false), `${n} nombres`).toBe(n);
    expect(nombresEnCartel(9, true, false)).toBe(8);
    expect(nombresEnCartel(30, true, false)).toBe(8);
  });

  it("en un celular vertical (S3) el orden muestra menos filas: hasta seis nombres", () => {
    expect(nombresEnCartel(8, true, true)).toBe(6);
    expect(nombresEnCartel(30, true, true)).toBe(6);
    // Con cuatro no hay que recortar: entran como hoy.
    expect(nombresEnCartel(4, true, true)).toBe(4);
  });

  it("con nombres de más, el cartel sigue con los primeros y un renglón de «y N más»", () => {
    expect(filasEnCartel(8, true, false)).toBe(8);
    expect(filasEnCartel(9, true, false)).toBe(9);
    expect(filasEnCartel(30, true, false)).toBe(9);
    expect(filasEnCartel(7, true, true)).toBe(7);
    // Los premios no cambian: tres nombres y, con más de tres, el renglón del resto.
    expect(filasEnCartel(3, false, false)).toBe(3);
    expect(filasEnCartel(5, false, false)).toBe(4);
  });

  it("el cartel de la corona arma sus renglones con esa cuenta, no con un tres fijo", () => {
    // Guarda de fuente: el build (`stage.ts`) no vuelve al tres fijo de antes.
    const stage = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
    expect(stage).not.toMatch(/\[\.\.\.all\.slice\(0, 3\)/);
    expect(stage).toMatch(/nombresEnCartel\(all\.length/);
    expect(stage).toMatch(/filasCorona\(filasEnCartel\(/);
  });
});

describe("el alto del cartel con el conteo nuevo", () => {
  it("el renglón único es grande y los demás, iguales: las alturas de los premios no cambian", () => {
    expect(filasCorona(1, 1.5)).toEqual([90]);
    expect(filasCorona(0, 1.5)).toEqual([]);
    expect(filasCorona(4, 1)).toEqual([46 * 1.22, 38 * 1.22, 38 * 1.22, 38 * 1.22]);
    // Más renglones para el orden: mismos tamaños, sin achicar la letra.
    expect(filasCorona(9, 1)).toEqual([46 * 1.22, ...Array.from({ length: 8 }, () => 38 * 1.22)]);
  });

  it("la estimación del alto es la misma fórmula que ya usaba `placaBajo` para los premios", () => {
    const k = 1.5, principal = 1.2 * 48;
    expect(altoCartelDe(4, k, principal)).toBe(18 * k + principal + (46 + 3 * 38) * 1.22 * k + 20 * k);
  });

  it("una fila de orden (ocho nombres y el resto) cabe debajo del margen superior, y el centro baja para que así sea", () => {
    // En 1080 de alto, nueve renglones no caben centrados: el cartel baja hasta su margen y crece hacia abajo.
    const ph = altoCartelDe(9, 1.5, 1.2 * 48);
    const centro = centroCartel(ph, 1.5, 1080, false);
    expect(centro - ph / 2).toBe(12 * 1.5);
    // La protección de la cámara (`placaBajo`) parte de ese centro real.
    expect(centro + ph / 2).toBeGreaterThan(0.26 * 1080);
  });

  it("el cartel de siempre queda centrado exactamente donde estaba", () => {
    expect(centroCartel(407, 1.5, 1080, false)).toBe(0.26 * 1080);
    expect(centroCartel(246, 0.9286, 844, true)).toBe(0.24 * 844);
  });
});
