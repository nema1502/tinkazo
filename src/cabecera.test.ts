import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La cabecera, igual en todas las páginas (docs/ux.md, "La cabecera").
 *
 * En escritorio (761 px o más) la fila lleva cuatro entradas: "Sortear",
 * "Mis sorteos", "Juegos" y "Cómo funciona". "Cómo se usa" va solo en "Más"
 * del celular: `src/ui/menu.ts` lo agrega en todas las páginas y `styles.css`
 * lo esconde en escritorio, en todas, no solo en la herramienta.
 */
describe("la cabecera", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const paginas = readdirSync(".").filter((f) => f.endsWith(".html"));

  it("hay páginas con cabecera para revisar", () => {
    expect(paginas.length).toBeGreaterThan(5);
  });

  it("en escritorio se esconde Cómo se usa en todas las páginas, no solo en la herramienta", () => {
    // La regla vieja llevaba `body:has(#btn-como)` y solo valía donde está ese
    // botón (la herramienta): en las demás páginas la fila mostraba cinco.
    const reglas = [...css.matchAll(/@media\s*\(\s*min-width:\s*761px\s*\)\s*\{([^}]*)\}/g)].map((m) => m[1] as string);
    const esconde = reglas.filter((r) => r.includes('a[href="/#como-se-usa"]') && r.includes("display: none"));
    expect(esconde.length).toBeGreaterThan(0);
    expect(esconde.every((r) => !r.includes("#btn-como"))).toBe(true);
  });

  it("todas las páginas traen la misma fila: Sortear, Mis sorteos y Más con Juegos y Cómo funciona", () => {
    const sinCabecera = paginas.filter((p) => !readFileSync(p, "utf8").includes('class="topnav"'));
    expect(sinCabecera).toEqual([]);
    for (const pagina of paginas) {
      const fuente = readFileSync(pagina, "utf8");
      const inicio = fuente.indexOf('<nav class="topnav"');
      const nav = fuente.slice(inicio, fuente.indexOf("</nav>", inicio));
      for (const clave of ["navSortear", "navMis", "navMas", "navJuegos", "navComo"]) {
        expect(nav, `${pagina}: ${clave}`).toContain(`data-i="${clave}"`);
      }
      // "Cómo se usa" no va en el markup: lo agrega menu.ts en todas las páginas.
      expect(nav, pagina).not.toContain('href="/#como-se-usa"');
    }
  });

  it("menu.ts agrega Cómo se usa al principio de Más, en todas las páginas", () => {
    const codigo = readFileSync(new URL("./ui/menu.ts", import.meta.url), "utf8");
    expect(codigo).toContain('a.href = "/#como-se-usa"');
    expect(codigo).toContain("lista.prepend(a)");
  });
});
