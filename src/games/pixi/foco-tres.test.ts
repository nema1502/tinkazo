import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El foco del 3D (los rayos que salen de un hueco y el resplandor a 0,5) es solo de la carrera de llamas, y solo cuando su 3D
 * arrancó. Los demás juegos, en 2D o en 3D, y la carrera cuando el 3D no arranca, coronan con el foco de siempre. La prueba lee
 * el código (no corre el motor: no hay placa de video).
 */
const leer = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const stage = leer("./stage.ts");
const carrera = leer("../llamas/carrera.ts");
const crear = leer("./kit/crear.ts");

/** Todo el código de los juegos, sin las pruebas. */
const juegos = (readdirSync(new URL("..", import.meta.url), { recursive: true }) as string[])
  .map((f) => f.replace(/\\/g, "/"))
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("el foco del 3D, solo en la carrera", () => {
  it("la corona ya no lo decide con el lienzo transparente, sino con el pedido de `focoSobreTres`", () => {
    expect(stage).not.toMatch(/new FocoVista\([^)]*transparente/);
    expect(stage).toMatch(/new FocoVista\(focoTres\)/);
    expect(stage).toMatch(/let focoTres = false;/);
    // Lo único que lo prende es el pedido.
    const asignaciones = stage.match(/focoTres = [^;]+;/g) ?? [];
    expect(asignaciones).toEqual(["focoTres = false;", "focoTres = true;"]);
    expect(stage).toMatch(/focoSobreTres\(\) \{\s*focoTres = true;\s*\}/);
  });

  it("ningún juego lo pide, salvo la carrera", () => {
    const quienes = juegos.filter((f) => /focoSobreTres\(\)/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
    expect(quienes.sort()).toEqual(["llamas/carrera.ts", "pixi/stage.ts"]);
    expect(carrera.match(/S\.focoSobreTres\(\)/g)?.length).toBe(1);
  });

  it("la carrera lo pide solo con el 3D ya arrancado: después de crearlo y antes del `catch` que vuelve al 2D", () => {
    const crea = carrera.indexOf("tres = fabrica3d({");
    const pide = carrera.indexOf("S.focoSobreTres()");
    const falla = carrera.indexOf("catch (err)", crea);
    expect(crea).toBeGreaterThan(0);
    expect(pide).toBeGreaterThan(crea);
    expect(falla).toBeGreaterThan(pide);
    // Y está adentro del `if (fabrica3d)`: la carrera 2D (`carreraPixi`, sin fábrica) nunca lo pide.
    expect(carrera.lastIndexOf("if (fabrica3d) {", pide)).toBeGreaterThan(0);
    expect(carrera.lastIndexOf("if (fabrica3d) {", pide)).toBeLessThan(crea);
  });

  it("el kit arma la corona después de armar la escena: el pedido llega antes de crear el foco", () => {
    const arma = crear.indexOf("escena = def.arma(k, plan);");
    const corona = crear.indexOf("S.crown(nombres, ganadores, conFoco");
    expect(arma).toBeGreaterThan(0);
    expect(corona).toBeGreaterThan(arma);
  });
});
