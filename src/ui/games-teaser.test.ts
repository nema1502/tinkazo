// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setLang, T } from "../i18n";
import { ANCHO_ANGOSTO, presentarTeaser, TOPE_TARJETAS, TOPE_TARJETAS_ANGOSTO } from "./games-teaser";

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
  it("con una lista sellada de 3, cada persona se presenta en el orden sellado, con el gancho visual del juego elegido", () => {
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto", "Cami"]);
    // Las tres presentaciones, montadas mientras cuenta la espera.
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(["Ana", "Beto", "Cami"]);
    // El gancho es del juego elegido: la captura de la largada de la carrera, la misma que ya publica el selector.
    expect(c.querySelector<HTMLElement>(".espera-teaser")?.dataset.juego).toBe("race");
    for (const [i, t] of tarjetas(c).entries()) {
      // Una sola imagen por tarjeta, la del tema (sin tema forzado ni sistema oscuro, la clara).
      expect([...t.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([`/juegos/selector/race-light.webp`]);
      // El lugar de cada uno en la lista sellada, para que la sala lo lea ("1 de 3").
      expect(t.textContent).toContain(`${i + 1} de 3`);
    }
  });

  it("guard: la presentación sale de la lista que entra y de nada más, no agrega, no reordena y no habla del resultado", () => {
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

  it("con un juego sin gancho visual el show no imagina la captura: la presentación sale sin imagen y igual presenta a cada uno", () => {
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

/** Simula un ancho de pantalla: responde a las consultas (max-width: Npx) y (min-width: Npx) como lo haría el navegador. */
const conAncho = (ancho: number): void => {
  vi.stubGlobal("matchMedia", (q: string) => {
    const max = /max-width:\s*(\d+)px/u.exec(q);
    const min = /min-width:\s*(\d+)px/u.exec(q);
    const cumple = (max ? ancho <= Number(max[1]) : true) && (min ? ancho >= Number(min[1]) : true);
    return { matches: cumple && (max !== null || min !== null), media: q };
  });
};

const nombresDe = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

describe("la presentación aparece solo si entran todas las personas de la lista", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("los topes son 6 en pantalla ancha y 2 hasta 480 px", () => {
    expect(ANCHO_ANGOSTO).toBe(480);
    expect(TOPE_TARJETAS_ANGOSTO).toBe(2);
    expect(TOPE_TARJETAS).toBe(6);
  });

  for (const total of [1, 2, 3, 6]) {
    it(`en pantalla ancha con ${total} personas hay ${total} tarjetas, en el orden sellado y sin línea de más`, () => {
      conAncho(1366);
      const c = caja();
      presentarTeaser(c, "race", nombresDe(total));
      expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(nombresDe(total));
      expect(c.querySelector(".espera-teaser-mas")).toBeNull();
      expect(tarjetas(c)[0]?.textContent).toContain(`1 de ${total}`);
    });
  }

  for (const total of [7, 18, 150, 300]) {
    it(`en pantalla ancha con ${total} personas no hay presentación: la caja queda vacía`, () => {
      conAncho(1366);
      const c = caja();
      presentarTeaser(c, "race", nombresDe(total));
      expect(tarjetas(c)).toHaveLength(0);
      expect(c.querySelector(".espera-teaser")).toBeNull();
      expect(c.querySelector(".espera-teaser-t")).toBeNull();
      expect(c.querySelector(".espera-teaser-mas")).toBeNull();
      expect(c.querySelector("img")).toBeNull();
      expect(c.childElementCount).toBe(0);
    });
  }

  for (const ancho of [320, 360, 390, 480]) {
    it(`a ${ancho} px con 2 personas hay 2 tarjetas y con 3 no hay presentación`, () => {
      conAncho(ancho);
      const dos = caja();
      presentarTeaser(dos, "race", nombresDe(2));
      expect(tarjetas(dos).map((t) => t.dataset.nombre)).toEqual(["Persona 1", "Persona 2"]);
      expect(dos.querySelector(".espera-teaser-mas")).toBeNull();
      const tres = caja();
      presentarTeaser(tres, "race", nombresDe(3));
      expect(tarjetas(tres)).toHaveLength(0);
      expect(tres.childElementCount).toBe(0);
    });
  }

  it("con 3 a 6 personas en un celular no hay presentación y en una pantalla ancha sí", () => {
    for (const total of [3, 4, 5, 6]) {
      conAncho(481);
      const ancha = caja();
      presentarTeaser(ancha, "race", nombresDe(total));
      expect(tarjetas(ancha)).toHaveLength(total);
      conAncho(390);
      const angosta = caja();
      presentarTeaser(angosta, "race", nombresDe(total));
      expect(tarjetas(angosta)).toHaveLength(0);
    }
  });

  it("nunca muestra un subconjunto: o están todas las personas o no hay ninguna tarjeta", () => {
    for (const ancho of [320, 390, 480, 481, 768, 1366, 1920]) {
      conAncho(ancho);
      for (const total of [1, 2, 3, 5, 6, 7, 18, 150, 300]) {
        const c = caja();
        presentarTeaser(c, "race", nombresDe(total));
        const vistas = tarjetas(c).length;
        expect([0, total], `${total} personas a ${ancho} px`).toContain(vistas);
      }
    }
  });

  it("al girar el celular se vuelve a decidir: con 2 personas se ven siempre, con 5 aparece al ensanchar y se va al angostar", () => {
    const cinco = nombresDe(5);
    conAncho(390);
    const c = caja();
    presentarTeaser(c, "race", cinco);
    expect(tarjetas(c)).toHaveLength(0);
    conAncho(844);
    presentarTeaser(c, "race", cinco);
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(cinco);
    const primera = tarjetas(c)[0];
    presentarTeaser(c, "race", cinco);
    expect(tarjetas(c)[0]).toBe(primera);
    conAncho(390);
    presentarTeaser(c, "race", cinco);
    expect(tarjetas(c)).toHaveLength(0);
    expect(c.childElementCount).toBe(0);
    conAncho(844);
    presentarTeaser(c, "race", cinco);
    expect(tarjetas(c)).toHaveLength(5);
  });

  it("si la lista crece de 6 a 7 la presentación se va, y si vuelve a 6 vuelve", () => {
    conAncho(1366);
    const c = caja();
    presentarTeaser(c, "race", nombresDe(6));
    expect(tarjetas(c)).toHaveLength(6);
    presentarTeaser(c, "race", nombresDe(7));
    expect(c.childElementCount).toBe(0);
    presentarTeaser(c, "race", nombresDe(6));
    expect(tarjetas(c)).toHaveLength(6);
  });

  it("con otra lista o con otro idioma se vuelve a armar aunque el ancho sea el mismo", () => {
    conAncho(1366);
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto"]);
    presentarTeaser(c, "race", ["Ana", "Cami"]);
    expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(["Ana", "Cami"]);
    setLang("en");
    presentarTeaser(c, "race", ["Ana", "Cami"]);
    expect(c.querySelector(".espera-teaser-t")?.textContent).toBe("Who is taking part");
  });

  it("la línea de más ya no existe en los textos", () => {
    expect((T.es as unknown as Record<string, unknown>).espTeaserMas).toBeUndefined();
    expect((T.en as unknown as Record<string, unknown>).espTeaserMas).toBeUndefined();
  });
});

describe("el titular no promete presentar a cada persona una por una", () => {
  it("dice quienes participan en los dos idiomas", () => {
    expect(T.es.espTeaserT).toBe("Quienes participan");
    expect(T.en.espTeaserT).toBe("Who is taking part");
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

  it("las tarjetas no llevan estilos en línea", () => {
    const c = caja();
    presentarTeaser(c, "race", ["Ana", "Beto"]);
    expect(c.querySelector("[style]")).toBeNull();
  });

  it("ninguna zona de la presentación recorta: ni alto máximo ni overflow, para que ninguna tarjeta ni la línea de faltantes queden cortadas", () => {
    const reglas = [...css.matchAll(/(\.espera-teaser[\w-]*(?:\s+[^{,]+)?)\s*\{([^}]*)\}/gu)].map((m) => ({ sel: (m[1] ?? "").trim(), cuerpo: m[2] ?? "" }));
    expect(reglas.length).toBeGreaterThan(3);
    for (const r of reglas) {
      expect(r.cuerpo, r.sel).not.toMatch(/max-height:/);
      expect(r.cuerpo, r.sel).not.toMatch(/overflow(?:-y)?:\s*(?:hidden|clip|auto|scroll)/);
    }
  });

  it("en una pantalla baja la presentación se esconde para no empujar el reloj", () => {
    expect(css).toMatch(/@media \(max-height: 560px\)\s*\{[^@]*\.espera-teaser-caja\s*\{\s*display:\s*none/);
  });

  it("la caja vacía no ocupa lugar: sin presentación la espera queda como siempre", () => {
    expect(css).toMatch(/\.espera-teaser-caja:empty\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/\.espera-teaser-mas/);
  });

  it("cuando la capa decide que no hay alto para la presentación, la hoja de estilos la esconde", () => {
    expect(css).toMatch(/\.espera\[data-sin-teaser\]\s+\.espera-teaser-caja\s*\{\s*display:\s*none/);
  });
});
