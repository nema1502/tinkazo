import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Precios: lo que nunca se cobra ni se vende (punto 2 del pulido del sitio).
 *
 * La cruz rosa se lee como "no" o como error: los renglones llevan tilde y la
 * promesa queda igual. Y el plegado "Para quien quiera el detalle" tiene que
 * parecer algo que se puede tocar (caja con borde y signo que cambia), con
 * 44 px de alto o más en el celular, igual en Precios, Cómo funciona y
 * Seguridad, que usan el mismo `details.tecnico`.
 */
describe("precios y el detalle plegado", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const precios = readFileSync(new URL("../precios.html", import.meta.url), "utf8");

  it("la lista de lo que nunca se cobra no lleva ninguna cruz", () => {
    expect(precios).not.toContain("✕");
    for (const clave of ["prNever1", "prNever2", "prNever3", "prNever4"]) {
      expect(precios, clave).toContain(`data-i="${clave}"`);
    }
    expect(precios).toContain("✓");
  });

  it("el plegado técnico es el mismo componente en las tres páginas", () => {
    for (const pagina of ["../precios.html", "../como-funciona.html", "../seguridad.html"]) {
      expect(readFileSync(new URL(pagina, import.meta.url), "utf8"), pagina).toContain('class="tecnico"');
    }
  });

  it("el resumen del plegado tiene caja de control, signo que cambia y 44 px en el celular", () => {
    const resumen = /details\.tecnico summary\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(resumen).toContain("cursor: pointer");
    expect(resumen).toContain("min-height: 44px");
    expect(resumen).toContain("border:");
    // El signo de abrir y el de cerrar no son el mismo.
    expect(css).toContain("details.tecnico summary::before");
    expect(css).toContain("details.tecnico[open] summary::before");
    const movil = /@media\s*\(\s*max-width:\s*760px\s*\)\s*\{[^}]*details\.tecnico summary[^}]*min-height:\s*44px/.test(css);
    expect(movil).toBe(true);
  });
});
