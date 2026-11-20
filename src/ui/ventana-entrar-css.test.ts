import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Cómo se ve la ventana de entrar: las reglas de styles.css que separan, ordenan y miden lo que se toca. */
const css = readFileSync("src/styles.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** El cuerpo de la regla cuyo selector es exactamente `selector`, o una cadena vacía si no existe. */
function regla(selector: string): string {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)\\s*${escapado}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? "";
}

describe("Practicar sin cuenta no se confunde con Otras formas de entrar", () => {
  it("va apartado, con más aire que el renglón de arriba", () => {
    expect(regla(".login-practicar")).toMatch(/margin-top: 20px;/);
  });

  it("va sin negrita, mientras Otras formas de entrar sigue en negrita", () => {
    expect(regla(".login-practicar .login-link")).toMatch(/font-weight: 400;/);
    expect(regla(".login-otras")).toMatch(/font-weight: 700;/);
  });
});

describe("al desplegar Otras formas de entrar la ventana no salta", () => {
  it("la ventana de entrar va anclada arriba, con el margen de abajo libre para crecer", () => {
    expect(regla(".modal-card.login")).toMatch(/margin: var\(--login-arriba\) auto auto;/);
  });

  it("el alto máximo descuenta el margen de arriba, para que la ventana no empuje el fondo a hacer scroll", () => {
    const cuerpo = regla(".modal-card.login");
    expect(cuerpo).toMatch(/max-height: calc\(100vh - 2 \* var\(--modal-pad\) - var\(--login-arriba\)\);/);
    expect(cuerpo).toMatch(/max-height: calc\(100dvh - 2 \* var\(--modal-pad\) - var\(--login-arriba\)\);/);
  });
});

describe("todo lo que se toca en la ventana de entrar mide 48 px de alto (docs/ux.md)", () => {
  it("Otras formas de entrar", () => {
    expect(regla(".login-otras")).toMatch(/min-height: 48px;/);
  });

  it("los enlaces chicos: Practicar sin cuenta, Copiar el enlace y Tengo un cupón", () => {
    expect(regla(".login-link")).toMatch(/min-height: 48px;/);
  });

  it("la X de cerrar", () => {
    expect(regla(".login-x")).toMatch(/width: 48px; height: 48px;/);
  });

  it("¿Quién guarda la llave? y Más formas de entrar", () => {
    expect(regla(".login-foot summary")).toMatch(/min-height: 48px;/);
    expect(regla(".login-mas > summary")).toMatch(/min-height: 48px;/);
  });
});

describe("la misma acción no aparece dos veces cuando falla el ingreso", () => {
  it("con el botón Practicar en Prueba en la ventana, el enlace Practicar sin cuenta se esconde", () => {
    expect(regla('.modal-card.login:has([data-salida="practicar"]) .login-practicar')).toMatch(/display: none;/);
  });

  it("el botón que la regla busca es el que pinta la salida de practicar", () => {
    const fuente = readFileSync("src/ui/wallet-ui.ts", "utf8");
    expect(fuente).toContain("b.dataset.salida = salida.tipo;");
    expect(fuente).toMatch(/tipo: "sin-cuenta" \| "practicar";/);
  });
});
