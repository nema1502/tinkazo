#!/usr/bin/env node
/**
 * Arma la hoja de sprites de los emblemas: un solo archivo SVG con un
 * <symbol> por clave, a partir de los dibujos sueltos de src/games/emblemas/.
 *
 *   src/games/emblemas/twemoji/<clave>.svg   de Twemoji (CC BY 4.0), ver los créditos
 *   src/games/emblemas/propios/<clave>.svg   dibujados para Tinkazo (MIT)
 *   src/games/emblemas/hoja.svg              la salida: lo que importa el juego
 *
 * Para cambiar el set provisorio por el definitivo: dejar un <clave>.svg por
 * cada clave de CLAVES (src/games/emblemas.ts) en cualquiera de las dos
 * carpetas (o en una carpeta nueva, sumándola a FUENTES) y correr este script.
 * Las claves no cambian, así que ningún juego se entera.
 *
 *   node scripts/emblemas-hoja.mjs           escribe la hoja
 *   node scripts/emblemas-hoja.mjs --check   falla si la hoja no coincide con las fuentes
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLAVES } from "../src/games/emblemas.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(RAIZ, "src", "games", "emblemas");
const FUENTES = ["propios", "twemoji"];
const SALIDA = join(DIR, "hoja.svg");

const fuentes = new Map(); // clave -> { carpeta, interior }
for (const carpeta of FUENTES) {
  const ruta = join(DIR, carpeta);
  if (!existsSync(ruta)) continue;
  for (const f of readdirSync(ruta).filter((x) => x.endsWith(".svg")).sort()) {
    const clave = f.slice(0, -4);
    const texto = readFileSync(join(ruta, f), "utf8").trim();
    const m = /^<svg\b[^>]*\bviewBox="0 0 36 36"[^>]*>([\s\S]*)<\/svg>$/.exec(texto);
    if (!m) throw new Error(`${carpeta}/${f}: tiene que ser un <svg viewBox="0 0 36 36"> sin nada más afuera`);
    const interior = m[1].trim();
    if (/\bid=|<script|<style|<image|<use|<foreignObject|<text|href=|on\w+=/i.test(interior)) {
      throw new Error(`${carpeta}/${f}: sin ids, estilos, imágenes, textos ni scripts (la hoja se mezcla con otros dibujos)`);
    }
    if (fuentes.has(clave)) throw new Error(`${clave}: está en dos carpetas (${fuentes.get(clave).carpeta} y ${carpeta})`);
    fuentes.set(clave, { carpeta, interior });
  }
}

const faltan = CLAVES.filter((c) => !fuentes.has(c));
const sobran = [...fuentes.keys()].filter((c) => !CLAVES.includes(c));
if (faltan.length || sobran.length) {
  console.error(`Faltan dibujos: ${faltan.join(", ") || "ninguno"}. Sobran: ${sobran.join(", ") || "ninguno"}.`);
  process.exit(1);
}

const hoja =
  `<!-- Emblemas de los participantes. 17 dibujos de Twemoji (c) Twitter, Inc. y colaboradores, y Jason Sofonia y Justine De Caires, bajo CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ (bufeo y jaguar con otro color). El resto, de Tinkazo (MIT). Créditos completos en /emblemas/CREDITOS.txt -->\n` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">\n` +
  CLAVES.map((c) => `<symbol id="${c}" viewBox="0 0 36 36">${fuentes.get(c).interior}</symbol>`).join("\n") +
  `\n</svg>\n`;

if (process.argv.includes("--check")) {
  const actual = existsSync(SALIDA) ? readFileSync(SALIDA, "utf8").replace(/\r\n/g, "\n") : "";
  if (actual !== hoja) {
    console.error("hoja.svg no coincide con los dibujos: correr node scripts/emblemas-hoja.mjs");
    process.exit(1);
  }
  console.log(`hoja.svg al día (${CLAVES.length} emblemas)`);
} else {
  writeFileSync(SALIDA, hoja);
  const propios = [...fuentes.values()].filter((f) => f.carpeta === "propios").length;
  console.log(`hoja.svg: ${CLAVES.length} emblemas (${propios} propios, ${CLAVES.length - propios} de Twemoji), ${hoja.length} bytes`);
}
