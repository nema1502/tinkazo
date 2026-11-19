import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Los dibujos de la foto del juego (`foto-fondos.ts` y `fondos/`) se bajan recién cuando se dibuja una foto con
 * `fondo`. La página de verificación, la que abre el QR de la foto, usa la foto de siempre y nunca la del juego: si
 * los dibujos colgaran de sus importaciones estáticas, cada persona que comprueba un sorteo los bajaría sin usarlos.
 * Se sigue el mismo camino que el armado: la entrada y todo lo que importa de forma estática.
 */
describe("los dibujos de la foto del juego no viajan con la página de verificación", () => {
  const resolver = (desde: string, spec: string): string | null => {
    const base = resolve(dirname(desde), spec);
    for (const f of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      if (existsSync(f) && statSync(f).isFile()) return f;
    }
    return null;
  };

  const alcanzables = (entrada: string): Set<string> => {
    const vistos = new Set<string>();
    const pendientes = [resolve(entrada)];
    while (pendientes.length) {
      const f = pendientes.pop() as string;
      if (vistos.has(f)) continue;
      vistos.add(f);
      for (const m of readFileSync(f, "utf8").matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gm)) {
        const r = resolver(f, m[1] as string);
        if (r) pendientes.push(r);
      }
    }
    return vistos;
  };

  it("verify.ts llega a la foto de siempre, pero no a los dibujos", () => {
    const desdeVerificar = alcanzables("src/verify.ts");
    expect(desdeVerificar.has(resolve("src/ui/compartir.ts"))).toBe(true);
    expect(desdeVerificar.has(resolve("src/ui/foto.ts"))).toBe(true);
    const dibujos = [...desdeVerificar].filter((f) => /[\\/]ui[\\/](foto-fondos\.ts|fondos[\\/])/.test(f));
    expect(dibujos).toEqual([]);
  });

  it("la pantalla del sorteo tampoco los trae al cargar: compartir se abre recién al tocar Compartir", () => {
    const desdeLaHerramienta = alcanzables("src/main.ts");
    const dibujos = [...desdeLaHerramienta].filter((f) => /[\\/]ui[\\/](foto-fondos\.ts|fondos[\\/])/.test(f));
    expect(dibujos).toEqual([]);
  });
});
