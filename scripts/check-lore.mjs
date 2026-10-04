#!/usr/bin/env node
/**
 * Comprueba las fuentes de las tarjetas de historia.
 *
 * Cada tarjeta afirma un hecho sobre Stellar, sobre drand o sobre una palabra
 * boliviana, y siempre lleva el enlace a la fuente primaria. Esa regla es la
 * que sostiene la credibilidad del producto delante de gente que sabe del
 * tema, y **una fuente caída es un dato inventado a los seis meses**.
 *
 * Esto no puede comprobar que la fuente diga lo que la tarjeta dice: eso lo
 * comprueba una persona al escribirla. Lo que sí comprueba es que el enlace
 * siga vivo y que las dos mitades del texto existan en los dos idiomas.
 *
 * Uso:
 *   node scripts/check-lore.mjs [--offline]
 *
 * Con `--offline` solo revisa las claves, sin salir a internet.
 */

import { readFile } from "node:fs/promises";

const offline = process.argv.includes("--offline");
const fails = [];
const ok = [];
/** Lo que se dice sin trabar la integración: una fuente caída con copia, o de un juego que no se ve. */
const avisos = [];
/**
 * Los juegos que salieron del selector el 30 de septiembre de 2026 y solo se
 * abren con `?demo=`. Sus tarjetas nadie las ve en el uso normal: si su fuente
 * se cae, se avisa, pero no traba la integración.
 */
const FUERA_DEL_SELECTOR = new Set(["ledger", "rockets", "totora"]);

const lore = await readFile("src/games/lore.ts", "utf8");
const i18n = await readFile("src/i18n.ts", "utf8");

/** Las entradas de `LORE`, sacadas del archivo tal como están escritas. */
// De qué juego es cada tarjeta: la última clave `juego: [` antes de ella.
const juegos = [...lore.matchAll(/^ {2}(\w+): \[/gm)].map((m) => ({ at: m.index ?? 0, juego: m[1] }));
const juegoDe = (at) => juegos.filter((j) => j.at < at).at(-1)?.juego ?? "";
const cards = [...lore.matchAll(/q:\s*"([^"]+)",\s*\n\s*a:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",\s*\n\s*src:\s*"([^"]+)"/g)]
  .map((m) => ({ q: m[1], a: m[2], href: m[3], src: m[4], juego: juegoDe(m.index ?? 0) }));

/**
 * Si una fuente no contesta, ¿hay una copia en archive.org? Con copia, la cita
 * se puede comprobar igual, y una caída del sitio ajeno (le pasó al
 * Diccionario de americanismos el 4 de octubre de 2026) no traba nada.
 */
/**
 * Las copias ya encontradas, anotadas: la consulta a archive.org desde los
 * servidores de la integración vuelve vacía a veces, y una prueba que depende
 * de eso no es una prueba. Se anotaron el 4 de octubre de 2026.
 */
const COPIAS = {
  "https://www.asale.org/damer/tinkazo": "https://web.archive.org/web/20260609050837/https://www.asale.org/damer/tinkazo",
  "https://www.asale.org/damer/totora": "https://web.archive.org/web/20251216085301/https://www.asale.org/damer/totora",
  "https://www.asale.org/damer/trompo": "https://web.archive.org/web/20250907205745/https://www.asale.org/damer/trompo",
};

/** La copia anotada abre de verdad. */
async function abre(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "tinkazo-check-lore" }, signal: AbortSignal.timeout(30_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function copiaArchivada(url) {
  if (COPIAS[url] && (await abre(COPIAS[url]))) return COPIAS[url];
  try {
    const res = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}`, {
      signal: AbortSignal.timeout(15_000),
    });
    const j = await res.json();
    const c = j?.archived_snapshots?.closest;
    return c?.available && c.status === "200" ? c.url : null;
  } catch {
    return null;
  }
}

if (cards.length === 0) {
  console.error("No encontré ninguna tarjeta en src/games/lore.ts. ¿Cambió el formato?");
  process.exit(2);
}

// Los dos diccionarios, para poder comprobar cada idioma por separado.
const enAt = i18n.indexOf("  en: {");
if (enAt < 0) {
  console.error("No encontré el diccionario en inglés en src/i18n.ts.");
  process.exit(2);
}
const es = i18n.slice(0, enAt);
const en = i18n.slice(enAt);

console.log(`\nComprobando ${cards.length} tarjetas de historia\n`);

for (const card of cards) {
  for (const key of [card.q, card.a]) {
    const inEs = es.includes(`${key}:`);
    const inEn = en.includes(`${key}:`);
    if (!inEs) fails.push(`${key} falta en el diccionario en español`);
    if (!inEn) fails.push(`${key} falta en el diccionario en inglés`);
  }
}

/** Una fuente que no contesta: aviso si hay copia o si el juego no se ve; si no, falla. */
async function caida(card, motivo) {
  const copia = await copiaArchivada(card.href);
  if (copia) avisos.push(`${card.href} ${motivo}; hay copia en ${copia}`);
  else if (FUERA_DEL_SELECTOR.has(card.juego)) avisos.push(`${card.href} ${motivo}, sin copia; es de ${card.juego}, fuera del selector`);
  else fails.push(`${card.href} ${motivo}`);
}

if (!offline) {
  // De a uno y en serie: son doce enlaces y no hay apuro. Varios en paralelo
  // contra el mismo dominio es la forma más rápida de que te corten.
  for (const card of cards) {
    let status = "sin red";
    try {
      const res = await fetch(card.href, {
        redirect: "follow",
        headers: { "user-agent": "tinkazo-check-lore" },
        signal: AbortSignal.timeout(15_000),
      });
      status = String(res.status);
      if (res.ok) ok.push(card.href);
      else await caida(card, `respondió ${res.status}`);
    } catch (e) {
      await caida(card, `no respondió (${e instanceof Error ? e.message : e})`);
    }
    console.log(`  ${status.padStart(7)}  ${card.q.padEnd(22)} ${card.href}`);
  }
}

console.log("");
if (avisos.length) {
  console.log(`AVISOS: ${avisos.length}\n`);
  for (const a of avisos) console.log(`  · ${a}`);
  console.log("");
}
if (fails.length) {
  console.log(`FALLÓ: ${fails.length} problema(s)\n`);
  for (const f of fails) console.log(`  · ${f}`);
  console.log("");
  process.exit(1);
}
console.log(`BIEN: ${cards.length} tarjetas, textos en los dos idiomas${offline ? "" : ` y ${ok.length} fuentes vivas`}.\n`);
