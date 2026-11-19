// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * La vuelta de la verificación de identidad (`public/verificado.html`). La página de la verificación vuelve acá cuando
 * la persona termina, en otra pestaña: es estática a propósito, sin ningún script de Pollar ni del sitio, así nunca hay
 * dos copias del sitio con la misma sesión. Dice que esa parte terminó y qué falta (volver a Tinkazo y tocar Ya terminé), en
 * el idioma del navegador. No dice Listo: la verificación puede quedar en revisión.
 */

const RUTA = resolve(__dirname, "../public/verificado.html");
const html = readFileSync(RUTA, "utf8");

/**
 * La página como la abre el navegador: con la dirección y los idiomas que se piden. Su único script, que va en la página
 * misma, corre una vez sobre ella.
 */
function abrir(consulta = "", idiomas: readonly string[] = ["es-BO"]): Document {
  const leida = new DOMParser().parseFromString(html, "text/html");
  document.replaceChild(document.importNode(leida.documentElement, true), document.documentElement);
  history.replaceState(null, "", `/verificado.html${consulta}`);
  Object.defineProperty(navigator, "languages", { value: idiomas, configurable: true });
  Object.defineProperty(navigator, "language", { value: idiomas[0], configurable: true });
  const scripts = [...document.querySelectorAll("script")];
  expect(scripts).toHaveLength(1);
  new Function(scripts[0]?.textContent ?? "")();
  return document;
}

/** Lo que se lee en la página: el cuerpo sin el script. */
function visible(d: Document): string {
  const cuerpo = d.body.cloneNode(true) as HTMLElement;
  for (const s of cuerpo.querySelectorAll("script, style")) s.remove();
  return (cuerpo.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("la página de vuelta de la verificación", () => {
  it("no carga ningún script de afuera: ni de Pollar, ni del sitio, ni de ningún lado", () => {
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/type=["']module["']/i);
    expect(html).not.toMatch(/\/src\//);
    expect(html.toLowerCase()).not.toContain("pollar");
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet/i);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });

  it("en español: terminó esta parte, qué falta en la página de Tinkazo, y un botón grande para volver", () => {
    const d = abrir("", ["es-BO", "es"]);
    expect(d.documentElement.lang).toBe("es");
    // No dice Listo: la verificación puede quedar en revisión, y la compra sigue en la otra página.
    expect(d.querySelector("h1")?.textContent).toBe("Terminaste esta parte");
    expect(visible(d)).toContain("Volvé a la página de Tinkazo y tocá Ya terminé.");
    expect(d.querySelector("#texto strong")?.textContent).toBe("Ya terminé");
    expect(visible(d)).not.toMatch(/pestaña/i);
    const volver = d.querySelector<HTMLAnchorElement>("#volver");
    expect(volver?.textContent).toBe("Volver a Tinkazo");
    expect(volver?.getAttribute("href")).toBe("/");
    expect(d.title).toBe("Terminaste esta parte | Tinkazo");
    expect(d.body.dataset.listo).toBe("1");
  });

  it("en inglés si el navegador está en inglés, o si lo pide la dirección", () => {
    for (const [consulta, idiomas] of [["", ["en-US"]], ["?lang=en", ["es-BO"]]] as const) {
      const d = abrir(consulta, idiomas);
      expect(d.documentElement.lang).toBe("en");
      expect(d.querySelector("h1")?.textContent).toBe("You finished this part");
      expect(visible(d)).toContain("Go back to the Tinkazo page and tap I'm done.");
      expect(d.querySelector("#texto strong")?.textContent).toBe("I'm done");
      expect(d.querySelector("#volver")?.textContent).toBe("Back to Tinkazo");
      expect(visible(d)).not.toContain("Terminaste");
    }
    expect(abrir("?lang=es", ["en-US"]).querySelector("h1")?.textContent).toBe("Terminaste esta parte");
  });

  it("toma el tema que pide la dirección, y sin pedirlo sigue al del aparato", () => {
    expect(abrir("?theme=dark").documentElement.dataset.theme).toBe("dark");
    expect(abrir("?theme=light").documentElement.dataset.theme).toBe("light");
    expect(abrir("?theme=rojo").documentElement.dataset.theme).toBeUndefined();
    expect(html).toMatch(/prefers-color-scheme:\s*dark/);
  });

  it("Volver a Tinkazo intenta cerrar esta página, y si el navegador no la deja cerrar, va a la portada", () => {
    vi.useFakeTimers();
    try {
      const d = abrir();
      const cerrar = vi.spyOn(window, "close").mockImplementation(() => undefined);
      const volver = d.querySelector<HTMLAnchorElement>("#volver") as HTMLAnchorElement;
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
      volver.dispatchEvent(ev);
      expect(cerrar).toHaveBeenCalledTimes(1);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("el pie lleva a los términos y la privacidad, sin salir de las páginas que existen", () => {
    const d = abrir();
    const enlaces = [...d.querySelectorAll<HTMLAnchorElement>(".pies a")].map((a) => a.getAttribute("href"));
    expect(enlaces).toEqual(["/terminos.html"]);
  });

  it("lo que se lee, sin comillas angulares, punto y coma, punto medio, rayas, flechas ni tecnicismos, en las dos lenguas", () => {
    for (const idiomas of [["es-BO"], ["en-US"]]) {
      const texto = visible(abrir("", idiomas));
      expect(texto).not.toMatch(/[«»;·—–→←]/);
      expect(texto.toLowerCase()).not.toMatch(/\b(token|hash|transacci|wallet|billetera|kyc|stellar|pollar|didit)\b/);
    }
  });
});
