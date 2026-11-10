// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { planCarrera } from "../../llamas/carrera-show";
import { ctxDe } from "../../llamas/carrera-prueba";
import { anfitrionTinkazo } from "./anfitrion";

/**
 * Con `sinAnuncio` y un solo premio, la caja del relator queda vacía desde la meta, también en el golpe. Los lectores de pantalla
 * igual oyen quién gana en el golpe, como antes: el anuncio va a una región solo para ellos. La prueba lee el código del kit y del
 * estadio (no corre el motor: no hay placa de video) y arma el anuncio con el plan de la carrera.
 */
const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const html = leer("../../../../index.html");
const stage = leer("../stage.ts");
const crear = leer("./crear.ts");

describe("el ganador, anunciado a los lectores de pantalla en el golpe", () => {
  it("el estadio tiene una región viva solo para lectores de pantalla, aparte de la caja del relator", () => {
    const estadio = html.slice(html.indexOf('id="stadium"'));
    const region = estadio.match(/<p [^>]*id="commentary-sr"[^>]*>/)?.[0] ?? "";
    expect(region).toMatch(/class="sr-only"/);
    expect(region).toMatch(/role="status"/);
    expect(region).toMatch(/aria-live="polite"/);
    // Adentro del estadio, antes de que se cierre su `div`.
    expect(estadio.indexOf('id="commentary-sr"')).toBeLessThan(estadio.indexOf("</div>\n\n<svg"));
  });

  it("el estadio la vacía al montar y escribe en ella con `anunciarLector`", () => {
    expect(stage).toMatch(/const lectorEl = \$\("commentary-sr"\);\s*lectorEl\.textContent = "";/);
    expect(stage).toMatch(/anunciarLector\(msg\) \{\s*lectorEl\.textContent = msg;\s*\}/);
  });

  it("en el golpe, si la caja calla, el anuncio va a los lectores de pantalla", () => {
    const desde = crear.indexOf("const corona = (): void => {");
    expect(desde).toBeGreaterThan(0);
    const corona = crear.slice(desde, crear.indexOf("saltarFn = (): void => {", desde));
    expect(corona).toMatch(/S\.say\(callaAlCoronar \? "" : anf\.anuncio\(nombres, ganadores\), 1\);/);
    expect(corona).toMatch(/if \(callaAlCoronar\) S\.anunciarLector\(anf\.anuncio\(nombres, ganadores\)\);/);
    // Saltar también lleva al golpe.
    expect(crear).toMatch(/saltarFn = \(\): void => \{[\s\S]*?corona\(\);/);
  });

  for (const nueva of [false, true]) {
    for (const n of [8, 20, 40]) {
      it(`la carrera ${nueva ? "nueva" : "de siempre"} con ${n} y un premio: la caja calla y el anuncio nombra a quien gana`, () => {
        const ctx = ctxDe(n, 3);
        const plan = planCarrera(ctx, { nueva });
        const ganadores = ctx.ganadores.slice(0, 1);
        // La misma condición que `callaAlCoronar` en `crear.ts`.
        expect(!!plan.alCoronar?.sinAnuncio && ganadores.length === 1).toBe(true);
        const nombre = ctx.nombres[ganadores[0]!]!;
        const anuncio = anfitrionTinkazo.anuncio(ctx.nombres, ganadores);
        expect(anuncio.length).toBeGreaterThan(nombre.length);
        expect(anuncio).toContain(nombre);
      });
    }
  }
});
