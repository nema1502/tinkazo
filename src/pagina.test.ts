// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iniciarHoverVivo } from "./estilos-atencion";

/**
 * El hover vivo de la página de juegos (`pagina.ts` + `estilos-atencion.ts`):
 * la captura de la tarjeta bajo el mouse se mueve suave dentro de su marco
 * (Ken Burns, `styles.css`) mientras el hover dura; en pantalla táctil no hay
 * hover, y no aplica. La clase la pone y la saca el JS (`hover-vivo`); el CSS
 * hace el movimiento.
 */

const h = vi.hoisted(() => ({ reduce: false, hover: true }));

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = "";
  h.reduce = false;
  h.hover = true;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? h.reduce : q.includes("(hover: hover)") ? h.hover : false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("el hover vivo de las tarjetas de juego", () => {
  it("la página de juegos conecta el hover vivo a sus tarjetas .juego", async () => {
    // Las tarjetas van antes de importar la página: el cableado se hace al arrancar.
    document.body.innerHTML = ["race", "sapo"]
      .map((g) => `<article class="juego"><picture><img src="/juegos/${g}.webp" alt="${g}" /></picture></article>`)
      .join("");
    await import("./pagina");
    const [race, sapo] = [...document.querySelectorAll(".juego")] as [HTMLElement, HTMLElement];
    race.dispatchEvent(new Event("pointerenter"));
    expect(race.classList.contains("hover-vivo")).toBe(true);
    // Solo la tarjeta hovered: la otra queda quieta.
    expect(sapo.classList.contains("hover-vivo")).toBe(false);
    race.dispatchEvent(new Event("pointerleave"));
    expect(race.classList.contains("hover-vivo")).toBe(false);
  });

  it("en pantalla táctil no hay hover, y no aplica", async () => {
    h.hover = false;
    document.body.innerHTML = `<article class="juego"><img src="/juegos/race.webp" alt="race" /></article>`;
    await import("./pagina");
    const tarjeta = document.querySelector(".juego") as HTMLElement;
    tarjeta.dispatchEvent(new Event("pointerenter"));
    expect(tarjeta.classList.contains("hover-vivo")).toBe(false);
  });

  it("el CSS del movimiento respeta el marco (la captura no se sale de su tarjeta) y movimiento reducido", () => {
    const css = readFileSync("src/styles.css", "utf8");
    // El marco recorta: la captura escalada no pisa las tarjetas vecinas.
    expect(css).toContain(".portada-juegos a.hover-vivo { overflow: clip; }");
    // Con movimiento reducido, la animación se apaga.
    expect(css).toContain("@keyframes ken-burns-atencion");
    expect(css).toContain(".portada-juegos a.hover-vivo .pj-img, .juego.hover-vivo img { animation: none; }");
    // En pantalla táctil no aplica: todo el bloque vive dentro de (hover: hover).
    expect(css).toContain("@media (hover: hover) {");
    expect(css).toContain(".portada-juegos a.hover-vivo .pj-img, .juego.hover-vivo img { animation: ken-burns-atencion");
  });
});
