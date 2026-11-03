import { describe, expect, it } from "vitest";
import { coincide, imagenesViejas, juegoDeImagen } from "./imagenes-viejas.mjs";

describe("juegoDeImagen", () => {
  it("reconoce las de juegos.html, la portada y el selector, claras y oscuras", () => {
    expect(juegoDeImagen("public/juegos/race.webp")).toBe("race");
    expect(juegoDeImagen("public/juegos/race-light.webp")).toBe("race");
    expect(juegoDeImagen("public/juegos/portada/wheel-light.webp")).toBe("wheel");
    expect(juegoDeImagen("public/juegos/selector/guajojo.webp")).toBe("guajojo");
  });
  it("ignora los juegos que ya no están en el selector", () => {
    expect(juegoDeImagen("public/juegos/luz.webp")).toBeNull();
    expect(juegoDeImagen("public/juegos/otro/race.webp")).toBeNull();
  });
});

describe("coincide", () => {
  it("compara por prefijo con *, exacto sin él", () => {
    expect(coincide("src/games/pixi/sapo.ts", ["src/games/pixi/sapo*"])).toBe(true);
    expect(coincide("src/games/pixi/sapo-plan.ts", ["src/games/pixi/sapo*"])).toBe(true);
    expect(coincide("src/games/race.ts", ["src/games/race.ts"])).toBe(true);
    expect(coincide("src/games/race.tsx", ["src/games/race.ts"])).toBe(false);
  });
});

describe("imagenesViejas", () => {
  const img = (ruta, t) => ({ ruta, t });
  it("avisa de las imágenes anteriores al último cambio del código del juego", () => {
    const r = imagenesViejas(
      [img("public/juegos/sapo.webp", 100), img("public/juegos/sapo-light.webp", 300), img("public/juegos/trompo.webp", 100)],
      [{ ruta: "src/games/pixi/sapo.ts", t: 200 }, { ruta: "src/games/pixi/trompo.ts", t: 50 }],
    );
    expect(r).toEqual([{ juego: "sapo", codigo: "src/games/pixi/sapo.ts", imagenes: ["public/juegos/sapo.webp"] }]);
  });
  it("las pruebas no cuentan como cambio del juego", () => {
    expect(imagenesViejas([img("public/juegos/sapo.webp", 100)], [{ ruta: "src/games/pixi/sapo-plan.test.ts", t: 900 }])).toEqual([]);
  });
  it("el kit mueve a los juegos que se arman sobre él y a los demás no", () => {
    const r = imagenesViejas(
      [img("public/juegos/guajojo.webp", 100), img("public/juegos/sapo.webp", 100)],
      [{ ruta: "src/games/pixi/kit/nombres.ts", t: 500 }],
    );
    expect(r.map((x) => x.juego)).toEqual(["guajojo"]);
  });
  it("sin imágenes viejas no devuelve nada", () => {
    expect(imagenesViejas([img("public/juegos/wheel.webp", 900)], [{ ruta: "src/games/wheel.ts", t: 10 }])).toEqual([]);
  });
});
