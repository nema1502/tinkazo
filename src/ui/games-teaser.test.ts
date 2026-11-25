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

/** Simula un ancho de pantalla: responde a las consultas (max-width: Npx) y (min-width: Npx) como lo haría el navegador. */
const conAncho = (ancho: number): void => {
  vi.stubGlobal("matchMedia", (q: string) => {
    const max = /max-width:\s*(\d+)px/u.exec(q);
    const min = /min-width:\s*(\d+)px/u.exec(q);
    const cumple = (max ? ancho <= Number(max[1]) : true) && (min ? ancho >= Number(min[1]) : true);
    return { matches: cumple && (max !== null || min !== null), media: q };
  });
};

describe("la cantidad de tarjetas la decide el ancho de la pantalla", () => {
  const nombresDe = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
  afterEach(() => vi.unstubAllGlobals());

  it("el celular se corta en 480 px y presenta menos tarjetas que una pantalla ancha", () => {
    expect(ANCHO_ANGOSTO).toBe(480);
    expect(TOPE_TARJETAS_ANGOSTO).toBe(2);
    expect(TOPE_TARJETAS).toBe(6);
  });

  for (const total of [150, 300]) {
    for (const [ancho, tope] of [[320, 2], [360, 2], [390, 2], [480, 2], [481, 6], [768, 6], [1366, 6], [1920, 6]] as const) {
      it(`con ${total} personas a ${ancho} px presenta ${tope} tarjetas y la línea dice que faltan ${total - tope}`, () => {
        conAncho(ancho);
        const c = caja();
        presentarTeaser(c, "race", nombresDe(total));
        expect(tarjetas(c)).toHaveLength(tope);
        expect(tarjetas(c).map((t) => t.dataset.nombre)).toEqual(nombresDe(tope));
        const mas = c.querySelectorAll(".espera-teaser-mas");
        expect(mas).toHaveLength(1);
        expect(mas[0]?.textContent).toBe(`y ${total - tope} más`);
        // La línea es un hijo de la lista, no de una zona aparte con recorte, y viene después de las tarjetas.
        expect(mas[0]?.parentElement?.classList.contains("espera-teaser")).toBe(true);
        expect(mas[0]?.previousElementSibling?.classList.contains("espera-teaser-tarjeta")).toBe(true);
      });
    }
  }

  it("en inglés la línea también dice cuántas faltan, en pantalla angosta y en ancha", () => {
    setLang("en");
    conAncho(360);
    const a = caja();
    presentarTeaser(a, "race", nombresDe(150));
    expect(a.querySelector(".espera-teaser-mas")?.textContent).toBe("and 148 more");
    conAncho(1366);
    const b = caja();
    presentarTeaser(b, "race", nombresDe(150));
    expect(b.querySelector(".espera-teaser-mas")?.textContent).toBe("and 144 more");
  });

  it("con pocas personas en un celular, todas se presentan y no hay línea de faltantes", () => {
    conAncho(360);
    const c = caja();
    presentarTeaser(c, "race", nombresDe(TOPE_TARJETAS_ANGOSTO));
    expect(tarjetas(c)).toHaveLength(TOPE_TARJETAS_ANGOSTO);
    expect(c.querySelector(".espera-teaser-mas")).toBeNull();
    const d = caja();
    presentarTeaser(d, "race", nombresDe(TOPE_TARJETAS_ANGOSTO + 1));
    expect(d.querySelector(".espera-teaser-mas")?.textContent).toBe("y 1 más");
  });

  it("al girar el celular se vuelve a armar con la cantidad del ancho nuevo, sin repetir lo que ya está", () => {
    const lista = nombresDe(150);
    conAncho(1366);
    const c = caja();
    presentarTeaser(c, "race", lista);
    const primera = tarjetas(c)[0];
    presentarTeaser(c, "race", lista);
    expect(tarjetas(c)[0]).toBe(primera);
    conAncho(390);
    presentarTeaser(c, "race", lista);
    expect(tarjetas(c)).toHaveLength(TOPE_TARJETAS_ANGOSTO);
    expect(c.querySelector(".espera-teaser-mas")?.textContent).toBe("y 148 más");
    conAncho(1366);
    presentarTeaser(c, "race", lista);
    expect(tarjetas(c)).toHaveLength(TOPE_TARJETAS);
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
});
