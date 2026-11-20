import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";

/**
 * El recorte del resultado y de las pantallas sueltas del 20 de noviembre de 2026 (docs/ux.md, El resultado): cuatro
 * cadenas más cortas en los dos idiomas, dos líneas que se esconden por CSS y un título que queda solo para el lector de
 * pantalla. Sin navegador: se lee la hoja de estilos y el HTML como texto. Ninguna clave sale del diccionario.
 */

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

/** El cuerpo de la última regla con ese selector exacto al comienzo de un renglón. */
const regla = (selector: string): string => {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const todas = [...css.matchAll(new RegExp(`^\\s*${escapado}\\s*\\{([^}]*)\\}`, "gm"))];
  return todas.at(-1)?.[1] ?? "";
};

/** La etiqueta de apertura de un elemento del HTML, por su id. */
const etiqueta = (id: string): string => html.match(new RegExp(`<[a-z0-9]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";

describe("las cadenas del resultado, más cortas", () => {
  it("la tarjeta de varios premios dice cuántos son y que al final se ven todos", () => {
    expect(T.es.gcPrizesNote(3)).toBe("Hay 3 premios. Al final se ven todos.");
    expect(T.en.gcPrizesNote(3)).toBe("There are 3 prizes. You'll see them all at the end.");
  });

  it("el celular de quien mira pregunta por otro premio y manda al QR nuevo", () => {
    expect(T.es.espFinSiguiente).toBe("¿Otro premio? Escaneá el QR nuevo.");
    expect(T.en.espFinSiguiente).toBe("Another prize? Scan the new QR.");
  });

  it("el título del final del ensayo conserva que quien salió no vale", () => {
    expect(T.es.ensFinT).toBe("Era un ensayo. Quien salió no vale.");
    expect(T.en.ensFinT).toBe("That was a rehearsal. Whoever came up doesn't count.");
    // En el ensayo no hay premio: nadie gana, sale.
    expect(T.es.ensFinT).not.toMatch(/gan/i);
    expect(T.en.ensFinT).not.toMatch(/win|won/i);
  });

  it("la línea del final del ensayo dice cuánto se espera en un sorteo de verdad", () => {
    expect(T.es.ensFinB).toBe("En un sorteo de verdad, se espera cerca de un minuto.");
    expect(T.en.ensFinB).toBe("In a real draw, the wait is about a minute.");
    // Sin En vivo, que no dice frente a qué, y sin nombrar el número sin presentarlo.
    expect(T.es.ensFinB).not.toMatch(/en vivo|número/i);
    expect(T.en.ensFinB).not.toMatch(/^live|number/i);
  });

  it("con varios lugares, una línea dice que ya están decididos y la otra cuál falta, sin repetirse", () => {
    expect(T.es.lugaresFijos).toBe("Todos los lugares ya están decididos.");
    expect(T.en.lugaresFijos).toBe("Every place is already decided.");
    expect(T.es.againLugar(2, 3)).toBe("Sigue el lugar 2 de 3.");
    expect(T.en.againLugar(2, 3)).toBe("Place 2 of 3 is next.");
    // Justo debajo de que todos están decididos, nada que suene a que un lugar falta decidirse.
    expect(T.es.againLugar(2, 3)).not.toMatch(/falta/i);
    // Sin las palabras de adentro: ni el número que nace ni sellar.
    for (const texto of [T.es.lugaresFijos, T.es.againLugar(2, 3)]) expect(texto).not.toMatch(/número|sell/i);
    for (const texto of [T.en.lugaresFijos, T.en.againLugar(2, 3)]) expect(texto).not.toMatch(/number|seal/i);
    expect(html).toContain(`data-i="lugaresFijos" style="display:none">${T.es.lugaresFijos}</p>`);
  });

  it("el HTML trae como respaldo el mismo español que el diccionario", () => {
    expect(html).toContain(`<h3 data-i="ensFinT">${T.es.ensFinT}</h3>`);
    expect(html).toContain(`<p data-i="ensFinB">${T.es.ensFinB}</p>`);
  });

  it("ninguna cadena nueva lleva signos de exclamación, punto y coma ni raya larga", () => {
    const nuevas = [T.es.gcPrizesNote(3), T.en.gcPrizesNote(3), T.es.espFinSiguiente, T.en.espFinSiguiente, T.es.ensFinT, T.en.ensFinT, T.es.ensFinB, T.en.ensFinB];
    for (const texto of nuevas) expect(texto).not.toMatch(/[!;—·]/);
  });
});

describe("lo que se esconde del resultado", () => {
  it("la etiqueta El resultado se esconde por CSS y sigue en el HTML y en el diccionario", () => {
    expect(regla('.winner-box > .kicker[data-i="winnerLabel"]')).toMatch(/display:\s*none/);
    expect(html).toContain('<p class="kicker" data-i="winnerLabel">El resultado</p>');
    expect(T.es.winnerLabel).toBe("El resultado");
    expect(T.en.winnerLabel).toBe("The result");
  });

  it("con el logo de la comunidad la etiqueta conserva su alto sin verse, salvo en el celular", () => {
    expect(css).toMatch(
      /@media \(min-width: 521px\) and \(min-height: 521px\) \{\s*\.winner-box:has\(\.winner-logo \.logo-pieza\) > \.kicker\[data-i="winnerLabel"\] \{ display: block; visibility: hidden; \}/,
    );
  });

  it("la línea de qué sigue para la sala se esconde, salvo la de la lista de Luma", () => {
    expect(regla('#again-sigue:not([data-i="againSigueLuma"])')).toMatch(/display:\s*none/);
    expect(etiqueta("again-sigue")).toContain('class="note again-sigue"');
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l].againSigue).toBe("string");
      expect(typeof T[l].againSigueLuma).toBe("string");
    }
  });

  it("el título de ¿Pasamos al siguiente premio? sigue en el HTML, solo para el lector de pantalla", () => {
    const titulo = etiqueta("again-t");
    expect(titulo).toMatch(/^<h3\b/);
    expect(titulo).toMatch(/class="[^"]*\bsr-only\b[^"]*"/);
    expect(titulo).toContain('data-i="againTitle"');
    // El bloque sigue nombrado por ese título: sin él, el lector de pantalla pierde el nombre de la sección.
    expect(etiqueta("again-row")).toContain('aria-labelledby="again-t"');
    expect(regla(".sr-only")).toMatch(/clip:\s*rect\(0 0 0 0\)/);
  });

  it("ninguna clave que dejó de verse salió del diccionario", () => {
    for (const l of ["es", "en"] as const) {
      for (const clave of ["winnerLabel", "againTitle", "againTitleFin", "againSigue", "againSigueLuma", "gcPrizesNote", "espFinSiguiente", "ensFinT", "ensFinB"]) {
        expect(T[l][clave], `${l}.${clave}`).toBeDefined();
      }
    }
  });
});
