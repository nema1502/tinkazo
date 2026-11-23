// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { presentarTeaser } from "./games-teaser";

/**
 * La presentación de la lista sellada durante la cuenta (`games-teaser.ts`,
 * issue #78): el show de la espera en grande presenta a cada persona que
 * participa, con el gancho visual del juego elegido (la captura del selector,
 * la misma que ya se publica, por ejemplo la largada de Carrera de llamas).
 * Todo lo que se muestra sale de la lista sellada que entra por parámetro y
 * de su orden; nada sale del resultado, que todavía no existe cuando esta
 * presentación se ve.
 */

const caja = (): HTMLDivElement => {
  const c = document.createElement("div");
  document.body.appendChild(c);
  return c;
};

/** Las tarjetas de la presentación, en el orden en que quedaron montadas. */
const tarjetas = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(".espera-teaser-tarjeta")];

beforeEach(() => setLang("es"));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("la presentación de la lista sellada durante la cuenta", () => {
  it("S1: con una lista sellada de 3, cada persona se presenta en el orden sellado, con el gancho visual del juego elegido", () => {
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto", "Cami"]);
    // Las tres presentaciones, montadas mientras cuenta la espera.
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(["Ana", "Beto", "Cami"]);
    // El gancho es del juego elegido: la captura de la largada de la carrera, la misma que ya publica el selector.
    expect(c.querySelector<HTMLElement>(".espera-teaser")?.dataset.juego).toBe("race");
    for (const [i, t] of tarjetas(c).entries()) {
      const srcs = [...t.querySelectorAll("img")].map((img) => img.getAttribute("src"));
      expect(srcs).toContain(`/juegos/selector/race.webp`);
      expect(srcs).toContain(`/juegos/selector/race-light.webp`);
      // El lugar de cada uno en la lista sellada, para que la sala lo lea ("1 de 3").
      expect(t.textContent).toContain(`${i + 1} de 3`);
    }
  });

  it("S2 (guard): la presentación sale de la lista que entra y de nada más — no agrega, no reordena, no habla del resultado", () => {
    const c = caja();
    presentarTeaser(c, "race", ["Cami", "Ana", "Beto"]);
    // El orden es el de la lista sellada, tal cual entra.
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(["Cami", "Ana", "Beto"]);
    // Nadie más aparece: los nombres de la presentación son los de la lista, y su texto no dice quién gana.
    const texto = c.textContent ?? "";
    for (const nombre of ["Cami", "Ana", "Beto"]) expect(texto).toContain(nombre);
    expect(texto).not.toMatch(/ganador|ganado|gana|winner|win /i);
    // La fuente queda marcada: lo mostrado es lo sellado.
    expect(c.querySelector<HTMLElement>(".espera-teaser")?.dataset.fuente).toBe("sellada");
  });

  it("S1: con un juego sin gancho visual el show no imagina la captura: la presentación sale sin imagen y igual presenta a cada uno", () => {
    const c = caja();
    presentarTeaser(c, "quien", ["Ana", "Beto"]);
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(["Ana", "Beto"]);
    expect(c.querySelector("img")).toBeNull();
  });

  it("sin caja o sin lista no arma nada, y no queda temporizador colgado", () => {
    expect(() => presentarTeaser(null, "race", ["Ana"])).not.toThrow();
    const c = caja();
    presentarTeaser(c, "race", []);
    expect(c.querySelector(".espera-teaser")).toBeNull();
  });
});
