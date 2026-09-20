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

const lore = await readFile("src/games/lore.ts", "utf8");
const i18n = await readFile("src/i18n.ts", "utf8");

/** Las entradas de `LORE`, sacadas del archivo tal como están escritas. */
const cards = [...lore.matchAll(/q:\s*"([^"]+)",\s*\n\s*a:\s*"([^"]+)",\s*\n\s*href:\s*"([^"]+)",\s*\n\s*src:\s*"([^"]+)"/g)]
  .map((m) => ({ q: m[1], a: m[2], href: m[3], src: m[4] }));

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
      if (!res.ok) fails.push(`${card.href} respondió ${res.status}`);
      else ok.push(card.href);
    } catch (e) {
      fails.push(`${card.href} no respondió (${e instanceof Error ? e.message : e})`);
    }
    console.log(`  ${status.padStart(7)}  ${card.q.padEnd(22)} ${card.href}`);
  }
}

console.log("");
if (fails.length) {
  console.log(`FALLÓ: ${fails.length} problema(s)\n`);
  for (const f of fails) console.log(`  · ${f}`);
  console.log("");
  process.exit(1);
}
console.log(`BIEN: ${cards.length} tarjetas, textos en los dos idiomas${offline ? "" : ` y ${ok.length} fuentes vivas`}.\n`);
