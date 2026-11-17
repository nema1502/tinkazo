import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cuadroOCierre } from "./cuadro-seguro";

/**
 * Un cuadro del show que lanza (una textura, el 3D, el código de cualquier juego) cortaba el bucle de `stage.ts`: sin el
 * próximo cuadro no llegaba el final, el estadio tapaba la pantalla sin ganador y Saltar no hacía nada. Ahora se cierra
 * el estadio, que muestra el resultado como siempre.
 */

afterEach(() => vi.restoreAllMocks());

/** El bucle de `stage.ts` en chico: cada cuadro pide el siguiente solo si terminó bien. */
function correr(juego: (n: number) => void, cerrar: () => void, maximo = 10): number {
  let cuadros = 0;
  const cola: Array<() => void> = [];
  const loop = (): void => {
    cuadros++;
    if (cuadroOCierre(juego, cuadros, cerrar)) cola.push(loop);
  };
  cola.push(loop);
  for (let i = 0; i < maximo && cola.length > 0; i++) cola.shift()?.();
  return cuadros;
}

describe("un cuadro del show que falla", () => {
  it("si el juego lanza en el tercer cuadro, el estadio se cierra una vez y no se piden más cuadros", () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cerrar = vi.fn();
    const cuadros = correr((n) => {
      if (n === 3) throw new Error("textura rota");
    }, cerrar);
    expect(cuadros).toBe(3);
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalled();
  });

  it("un show que anda no se cierra por esto", () => {
    const cerrar = vi.fn();
    expect(correr(() => undefined, cerrar, 10)).toBe(10);
    expect(cerrar).not.toHaveBeenCalled();
  });

  it("si cerrar también falla, el error no sale del cuadro", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cerrar = (): void => {
      throw new Error("otra cosa");
    };
    expect(() =>
      cuadroOCierre(
        () => {
          throw new Error("textura rota");
        },
        0,
        cerrar,
      ),
    ).not.toThrow();
  });

  it("el bucle del estadio pasa cada cuadro por cuadroOCierre y, si falla, cierra el estadio", () => {
    const fuente = readFileSync(new URL("./stage.ts", import.meta.url), "utf8");
    expect(fuente).toMatch(/cuadroOCierre\([^;]*stage\.cleanup\(\)/);
  });
});
