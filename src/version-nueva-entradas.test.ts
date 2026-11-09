import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El aviso de versión nueva vale en todas las páginas con entrada propia: la
 * herramienta, verificar y las de lectura. Cada entrada del build importa el
 * módulo (`src/version-nueva.ts`), que es lo único que esas páginas suman.
 */
describe("el alcance del aviso en las entradas", () => {
  it("cada página del build importa el módulo", () => {
    const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    const paginas = [...config.matchAll(/resolve\(__dirname, "([^"]+\.html)"\)/g)].map((m) => m[1] as string);
    expect(paginas.length).toBeGreaterThan(5);
    for (const pagina of paginas) {
      const fuente = readFileSync(new URL(`../${pagina}`, import.meta.url), "utf8");
      const entradas = [...fuente.matchAll(/<script[^>]*\bsrc="\/(src\/[^"]+\.ts)"/g)].map((m) => m[1] as string);
      expect(entradas, `${pagina} no tiene entrada`).not.toEqual([]);
      for (const entrada of entradas) {
        const codigo = readFileSync(new URL(`../${entrada}`, import.meta.url), "utf8");
        expect(codigo, `${entrada} no importa el aviso de versión nueva`).toMatch(/version-nueva/);
      }
    }
  });
});

/**
 * Las cargas que el sitio hace por las dudas (el contador de visitas, la
 * precarga del SDK de Pollar) pueden fallar con un bloqueador o con el wifi
 * flojo sin que se haya publicado nada: van envueltas en `cargaOpcional`, que
 * atrapa el error y no despierta el aviso.
 */
describe("las cargas opcionales no despiertan el aviso", () => {
  const fuente = (archivo: string): string => readFileSync(new URL(`./${archivo}`, import.meta.url), "utf8");
  const casos: [string, string][] = [
    ["pagina.ts", 'import("./analytics")'],
    ["main.ts", 'import("./analytics")'],
    ["equipos-registro.ts", 'import("./stellar/wallet-pollar").then((m) => m.precargarSdk())'],
    ["stellar/wallet-pollar.ts", 'import("@pollar/core")'],
  ];
  for (const [archivo, carga] of casos) {
    it(`${archivo}: ${carga}`, () => {
      const codigo = fuente(archivo);
      expect(codigo, `${archivo} no envuelve la carga en cargaOpcional`).toContain(`cargaOpcional(${carga}`);
      expect(codigo).not.toContain(`void ${carga}`);
    });
  }
});
