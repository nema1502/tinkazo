import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * El cuadro donde se ponen los nombres, mirado sin navegador: el texto gris del cuadro vacío, lo que mide y cómo se pinta.
 * Lo que pasa al tocar Otro nombre está en `otro-nombre.test.ts`, con el markup de verdad.
 */

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** La apertura del cuadro de la lista en `index.html`. */
const cuadro = (): string => /<textarea id="ta"[^>]*>/.exec(html)?.[0] ?? "";

describe("el texto gris del cuadro vacío", () => {
  it("son tres nombres, uno por renglón, sin ninguna frase al lado", () => {
    for (const l of ["es", "en"] as const) {
      const renglones = String(T[l].placeholder).split("\n");
      expect(renglones, l).toHaveLength(3);
      for (const r of renglones) expect(r, l).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
    }
  });

  it("los dos idiomas usan los mismos nombres salvo el del medio", () => {
    expect(T.es.placeholder).toBe("Ana Quispe\nBeto Mamani\nCarla Flores");
    expect(T.en.placeholder).toBe("Ana Quispe\nBen Miller\nCarla Flores");
  });

  it("el markup trae los mismos tres renglones que el diccionario en español", () => {
    const ph = /\splaceholder="([^"]*)"/.exec(cuadro())?.[1] ?? "";
    expect(ph.replace(/&#10;/g, "\n")).toBe(T.es.placeholder);
  });

  it("los ejemplos se pintan en gris, más claros que un nombre escrito", () => {
    expect(css).toContain("#ta::placeholder { color: var(--muted); opacity: 1; }");
  });
});

describe("la ayuda de la lista vacía", () => {
  it("es una línea corta en los dos idiomas", () => {
    expect(T.es.pegarAyuda).toBe("Pegá tu lista o escribí un nombre.");
    expect(T.en.pegarAyuda).toBe("Paste your list or type a name.");
  });

  it("no explica el renglón: eso ya lo muestran los ejemplos del cuadro", () => {
    expect(T.es.pegarAyuda).not.toMatch(/rengl|l[ií]nea/i);
    expect(T.en.pegarAyuda).not.toMatch(/per line|each line/i);
  });

  it("el markup dice lo mismo que el diccionario en español", () => {
    expect(html).toContain('data-i="pegarAyuda" style="display:none">Pegá tu lista o escribí un nombre.</p>');
  });

  it("va debajo del cuadro, como su pie, justo después de Otro nombre (que con la lista vacía no se ve)", () => {
    // Del cierre del botón al párrafo de la ayuda no hay ningún otro elemento: solo su comentario.
    const despues = html.slice(html.indexOf("</button>", html.indexOf('id="btn-otro-nombre"')) + "</button>".length);
    const sinComentarios = despues.replace(/<!--[\s\S]*?-->/g, "").trimStart();
    expect(sinComentarios.startsWith('<p class="note pegar-ayuda" id="pegar-ayuda"')).toBe(true);
    expect(html.indexOf('id="pegar-ayuda"')).toBeGreaterThan(html.indexOf('<textarea id="ta"'));
    expect(css).toContain(".pegar-ayuda { margin: 8px 0 0; }");
  });
});

describe("las líneas de alrededor de la lista, cortas", () => {
  it("el enlace del stand dice solo Tengo un stand", () => {
    expect(T.es.standLink).toBe("Tengo un stand");
    expect(T.en.standLink).toBe("I run a booth");
    expect(html).toContain('data-i="standLink">Tengo un stand</button>');
  });

  it("el pie de la lista en grande pregunta y avisa en dos frases cortas", () => {
    expect(T.es.salaPie).toBe("¿Falta alguien o se repite? Después de sellar no cambia.");
    expect(T.en.salaPie).toBe("Someone missing or repeated? After sealing, nothing changes.");
  });

  it("la línea de gratis conserva lo que dice y el enlace a los términos", () => {
    expect(T.es.freeRule).toBe(
      'Participar es gratis, siempre. No es para entrada paga ni apuestas. Al sellar aceptás los <a href="/terminos.html">términos</a>.',
    );
    expect(T.en.freeRule).toBe('Taking part is always free. No paid entry, no gambling. Sealing means you accept the <a href="/terminos.html">terms</a>.');
    expect(html).toContain(`data-i-html="freeRule">${T.es.freeRule}</p>`);
  });

  it("ninguna lleva punto y coma, comillas angulares, raya larga, punto medio ni signos de exclamación", () => {
    const claves = ["placeholder", "otroNombre", "pegarAyuda", "standLink", "salaPie", "freeRule"];
    for (const l of ["es", "en"] as const) {
      for (const k of claves) expect(String(T[l][k]), `${l}.${k}`).not.toMatch(/[;«»—·!¡]/u);
    }
  });
});

describe("el teclado del celular", () => {
  it("pone mayúscula en cada palabra", () => {
    expect(cuadro()).toContain('autocapitalize="words"');
  });

  it("no corrige los apellidos", () => {
    expect(cuadro()).toContain('autocorrect="off"');
    expect(cuadro()).toContain('spellcheck="false"');
  });

  it("muestra la tecla de bajar de renglón", () => {
    expect(cuadro()).toContain('enterkeyhint="enter"');
  });
});

describe("lo que mide el cuadro", () => {
  it("entran por lo menos cuatro renglones de 16 px con interlineado de 1,5", () => {
    const alto = /#ta \{ min-height: calc\((\d+(?:\.\d+)?)em \+ 28px\); \}/.exec(css)?.[1];
    expect(alto).toBeDefined();
    // El relleno (12 px) y el borde (2 px) de cada lado ya van en los 28 px: lo que queda es para el texto.
    const renglones = (Number(alto) * 16) / (16 * 1.5);
    expect(renglones).toBeGreaterThanOrEqual(4);
  });

  it("el tamaño de letra del cuadro sigue en 16 px, que es lo que da la cuenta de arriba", () => {
    expect(css).toMatch(/textarea, input, select,[^{]*\{ font-size: 16px; \}/);
    expect(css).toContain("textarea { line-height: 1.5; }");
  });
});
