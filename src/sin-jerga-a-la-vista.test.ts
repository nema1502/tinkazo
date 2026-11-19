import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "./i18n";

/**
 * Lo que ve alguien que abre la portada, los precios, los términos o la página
 * de verificar un sorteo, sin desplegar nada, no lleva cifras de la red ni
 * palabras de la cadena (6 de noviembre de 2026: «entra un profesor y dice: no
 * entiendo nada, una estafa»). Lo que hace falta saber va en un plegado
 * («Para quien quiera el detalle») o en Cómo funciona, Seguridad y Verificar,
 * que son las páginas técnicas. Ver docs/ux.md, principio 7.
 *
 * Se mira el texto escrito en cada página (que otra prueba, en seo.test.ts,
 * obliga a ser el de T.es) y el de T.en para las mismas claves.
 */
const JERGA = /\b(XLM|USDC|stroops?|testnet|mainnet|drand|hash(es)?|SHA|BLS|Soroban|ledger|Stellar|blockchain|billetera|wallet)\b|\bcomisi[oó]n(es)? de (la )?red\b|\bnetwork fees?\b/i;

const PAGINAS = ["index.html", "precios.html", "terminos.html", "sorteo-verificable.html"];

/** El HTML sin lo que no se ve al abrir: cabecera, pie, scripts, plegados cerrados y los estados de la herramienta. */
function aLaVista(html: string, archivo: string): string {
  let s = html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<(header|footer|script|style)\b[\s\S]*?<\/\1>/g, "");
  // Un <details> cerrado muestra solo su <summary>; los anidados no se usan en estas páginas.
  s = s.replace(/<details\b(?![^>]*\sopen)[^>]*>([\s\S]*?)<\/details>/g, (_, dentro: string) => dentro.match(/<summary\b[\s\S]*?<\/summary>/)?.[0] ?? "");
  if (archivo === "index.html") {
    // La herramienta (sorteo, historial, tutorial) tiene sus estados y sus propias reglas: acá se mira la portada.
    s = s.replace(/<(\w+)\b[^>]*class="[^"]*\bapp-only\b[^"]*"[^>]*>[\s\S]*?<\/\1>/g, "");
  }
  return s;
}

/**
 * Textos legales que tienen que nombrar la marca tal como es: el aviso de marca de Stellar, al final de los términos
 * (docs/marca.md, "Marcas de otros"). No son una explicación técnica: son la nota que pide el dueño de la marca.
 */
const AVISOS_LEGALES: Record<string, string[]> = { "terminos.html": ["tmStellarMarca"] };

const clavesDe = (html: string, archivo: string): string[] =>
  [...html.matchAll(/\bdata-i(?:-html)?="([^"]+)"/g)].map((m) => m[1] as string).filter((clave) => !(AVISOS_LEGALES[archivo] ?? []).includes(clave));

describe("sin jerga a la vista (portada, precios, términos y sorteo verificable)", () => {
  it.each(PAGINAS)("%s: ni cifras de la red ni palabras de la cadena fuera de los plegados", (archivo) => {
    const claves = clavesDe(aLaVista(readFileSync(archivo, "utf8"), archivo), archivo);
    expect(claves.length).toBeGreaterThan(5);
    const hallazgos = (["es", "en"] as const).flatMap((idioma) =>
      claves
        .map((clave) => ({ idioma, clave, texto: String(T[idioma][clave] ?? "") }))
        .filter(({ texto }) => JERGA.test(texto.replace(/<[^>]+>/g, " ")))
        .map(({ idioma: i, clave, texto }) => `${i}.${clave}: ${texto.slice(0, 80)}`),
    );
    expect(hallazgos).toEqual([]);
  });

  it("la portada dice diez juegos, que es lo que hay en el selector", () => {
    const html = readFileSync("index.html", "utf8");
    const enSelector = new Set([...html.matchAll(/href="\/\?demo=([a-z]+)&amp;lead=3"/g)].map((m) => m[1])).size;
    expect(enSelector).toBe(10);
    expect(String(T.es.pjT)).toMatch(/^Diez juegos/);
    expect(String(T.en.pjT)).toMatch(/^Ten /);
  });

  it("la portada no trae el bloque de números: ni cifras sueltas ni la licencia como ficha", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).not.toMatch(/id="numeros"|class="cifras"|data-i="cif/);
  });

  it("el costo de la red no se dice en cifras ni en las preguntas de la portada ni en la tarjeta «Qué cuesta»", () => {
    for (const clave of ["faq3a", "masPreciosB"]) {
      for (const idioma of ["es", "en"] as const) expect(String(T[idioma][clave]), `${idioma}.${clave}`).not.toMatch(/\d+[,.]\d+\s*XLM|centavos|US cents|testnet/i);
    }
  });
});
