import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Activar la cuenta en modo Oficial es un voto, y cada voto cuesta: sale solo de un toque de la persona en «Activar mi
 * cuenta» o «Probar de nuevo», en la pantalla del paso (`src/ui/cuenta-lista.ts`). Ningún aviso, temporizador ni
 * suscripción lo llama. Esta prueba busca `activarCuenta(` en todo `src` (sin las pruebas) y exige que aparezca solo en
 * su definición y en esa pantalla. Mientras la pantalla no exista, pasa con cero llamadas.
 */

const SRC = resolve(process.cwd(), "src");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return /\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\.(ts|tsx|js|mjs)$/.test(n) ? [ruta] : [];
  });
}

describe("activarCuenta se llama solo desde el paso «Dejá tu cuenta lista»", () => {
  it("aparece solo en su definición y en src/ui/cuenta-lista.ts", () => {
    const usos: Record<string, number> = {};
    for (const f of archivos(SRC)) {
      const n = (readFileSync(f, "utf8").match(/activarCuenta\(/g) ?? []).length;
      if (n > 0) usos[relative(SRC, f).replaceAll("\\", "/")] = n;
    }
    // La definición: una sola vez en la billetera.
    expect(usos["stellar/wallet-pollar.ts"]).toBe(1);
    const otros = Object.keys(usos).filter((f) => f !== "stellar/wallet-pollar.ts" && f !== "ui/cuenta-lista.ts");
    expect(otros).toEqual([]);
  });

  it("en la pantalla hay una sola llamada, y el nombre no aparece en ningún otro archivo (ni sin paréntesis)", () => {
    const pantalla = readFileSync(join(SRC, "ui", "cuenta-lista.ts"), "utf8");
    expect((pantalla.match(/\.activarCuenta\(/g) ?? []).length).toBe(1);
    const fuera: string[] = [];
    for (const f of archivos(SRC)) {
      const ruta = relative(SRC, f).replaceAll("\\", "/");
      if (ruta === "stellar/wallet-pollar.ts" || ruta === "ui/cuenta-lista.ts") continue;
      if (/\bactivarCuenta\b/.test(readFileSync(f, "utf8"))) fuera.push(ruta);
    }
    // Ni pasado como función (`const f = w.activarCuenta`) ni como texto en otra pieza.
    expect(fuera).toEqual([]);
  });
});
