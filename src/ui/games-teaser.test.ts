// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setLang, T } from "../i18n";
import { presentarTeaser, TOPE_TARJETAS } from "./games-teaser";

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
      // Una sola imagen por tarjeta, la del tema (sin tema forzado ni matchMedia, el oscuro de siempre).
      expect([...t.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([`/juegos/selector/race.webp`]);
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

describe("un tope de tarjetas para que la espera siga entrando en la pantalla", () => {
  const ciento50 = Array.from({ length: 150 }, (_, i) => `Persona ${i + 1}`);

  it("con 150 nombres arma como mucho el tope, en el orden sellado, y dice cuántos faltan", () => {
    const c = caja();
    presentarTeaser(c, "race", ciento50);
    expect(TOPE_TARJETAS).toBeGreaterThan(0);
    expect(TOPE_TARJETAS).toBeLessThanOrEqual(8);
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(ciento50.slice(0, TOPE_TARJETAS));
    // El lugar sigue siendo el de la lista entera, no el de las que se ven.
    expect(tarjetas(c)[0]?.textContent).toContain("1 de 150");
    const mas = c.querySelector<HTMLElement>(".espera-teaser-mas");
    expect(mas?.textContent).toBe(T.es.espTeaserMas(150 - TOPE_TARJETAS));
    expect(mas?.textContent).toContain(String(150 - TOPE_TARJETAS));
    // Las imágenes también tienen tope: una por tarjeta.
    expect(c.querySelectorAll("img")).toHaveLength(TOPE_TARJETAS);
  });

  it("el aviso de cuántos faltan existe en los dos idiomas, sin punto y coma ni comillas angulares", () => {
    expect(T.es.espTeaserMas(144)).toBe("y 144 más");
    expect(T.en.espTeaserMas(144)).toBe("and 144 more");
    expect(T.es.espTeaserMas(1)).not.toMatch(/[;«»]/);
    expect(T.en.espTeaserMas(1)).not.toMatch(/[;«»]/);
    setLang("en");
    const c = caja();
    presentarTeaser(c, "race", ciento50);
    expect(c.querySelector(".espera-teaser-mas")?.textContent).toBe("and 144 more");
  });

  it("con el tope justo o menos no hay aviso y todos se presentan", () => {
    const c = caja();
    presentarTeaser(c, "race", ciento50.slice(0, TOPE_TARJETAS));
    expect(tarjetas(c)).toHaveLength(TOPE_TARJETAS);
    expect(c.querySelector(".espera-teaser-mas")).toBeNull();
  });
});

describe("una sola imagen por tarjeta, la del tema", () => {
  const srcs = (c: HTMLElement): string[] => [...c.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
  const conTema = (tema: string | null): void => {
    if (tema) document.documentElement.dataset.theme = tema;
    else delete document.documentElement.dataset.theme;
  };
  const conSistemaOscuro = (oscuro: boolean): void => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: oscuro && q.includes("dark"), media: q }));
  };
  afterEach(() => {
    conTema(null);
    vi.unstubAllGlobals();
  });

  it("con el tema claro forzado, cada tarjeta lleva solo la captura clara", () => {
    conTema("light");
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto", "Cami"]);
    expect(tarjetas(c).map((t) => t.querySelectorAll("img").length)).toEqual([1, 1, 1]);
    expect(new Set(srcs(c))).toEqual(new Set(["/juegos/selector/race-light.webp"]));
  });

  it("con el tema oscuro forzado, solo la oscura", () => {
    conTema("dark");
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto"]);
    expect(new Set(srcs(c))).toEqual(new Set(["/juegos/selector/race.webp"]));
  });

  it("sin tema forzado sigue al sistema: oscuro pide la oscura y claro la clara", () => {
    conSistemaOscuro(true);
    const oscuro = caja();
    presentarTeaser(oscuro, "race", ["Ana"]);
    expect(srcs(oscuro)).toEqual(["/juegos/selector/race.webp"]);
    conSistemaOscuro(false);
    const claro = caja();
    presentarTeaser(claro, "race", ["Ana"]);
    expect(srcs(claro)).toEqual(["/juegos/selector/race-light.webp"]);
  });
});

describe("el aspecto de la presentación vive en la hoja de estilos", () => {
  const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("las tarjetas no llevan estilos en línea y la caja tiene un alto máximo", () => {
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto"]);
    expect(c.querySelector("[style]")).toBeNull();
    expect(css).toMatch(/\.espera-teaser\s*\{[^}]*max-height:/);
    expect(css).toMatch(/\.espera-teaser\s*\{[^}]*overflow:\s*hidden/);
  });

  it("en una pantalla baja la presentación se esconde para no empujar el reloj", () => {
    expect(css).toMatch(/@media \(max-height: 560px\)\s*\{[^@]*\.espera-teaser-caja\s*\{\s*display:\s*none/);
  });
});
