#!/usr/bin/env node
/**
 * Smoke test del sitio con Chrome headless, sin dependencias.
 *
 * Uso:  node scripts/smoke.mjs <url> [--wait "<expresión JS>"] [--timeout 40000]
 *
 * Abre la URL, espera hasta que la expresión sea verdadera (por defecto: hay
 * una tarjeta de ganador) y luego imprime un resumen del DOM y los errores de
 * consola. Sale con código 1 si la condición no se cumple a tiempo o si hubo
 * excepciones no capturadas.
 *
 * Para revisar un juego a fondo, usá `scripts/audit-game.mjs`.
 */
import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error("uso: node scripts/smoke.mjs <url> [--wait <js>] [--timeout <ms>]");
  process.exit(2);
}
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const waitExpr = opt("--wait", "document.querySelectorAll('.winner-name').length > 0");
const timeoutMs = Number(opt("--timeout", "40000"));

const browser = await launch();
try {
  const page = await browser.open(url);
  const { ok, elapsed } = await page.waitFor(waitExpr, timeoutMs);
  const summary = JSON.parse(
    await page.eval(`JSON.stringify({
      title: document.title,
      lang: document.documentElement.lang,
      entities: document.getElementById('entities')?.textContent || '',
      proof: document.getElementById('proof')?.textContent || '',
      drawBtn: document.getElementById('btn-draw')?.textContent || '',
      winners: [...document.querySelectorAll('.winner-name')].map(e => e.textContent),
      drandLink: document.getElementById('drand-link')?.getAttribute('href') || '',
      footer: document.querySelector('[data-i="footL"]')?.textContent || '',
      whatsapp: document.getElementById('btn-whatsapp')?.getAttribute('href') || '',
      email: document.getElementById('btn-email')?.getAttribute('href') || '',
    })`),
  );
  console.log(`${ok ? "OK" : "TIMEOUT"} tras ${(elapsed / 1000).toFixed(1)} s · ${url}`);
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v).slice(0, 160)}`);
  }
  if (page.exceptions.length) console.log("  excepciones:", page.exceptions.slice(0, 3));
  if (page.consoleErrors.length) console.log("  console.error:", page.consoleErrors.slice(0, 3));
  process.exitCode = ok && page.exceptions.length === 0 ? 0 : 1;
} finally {
  browser.close();
}
