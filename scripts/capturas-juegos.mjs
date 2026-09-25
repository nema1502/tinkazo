#!/usr/bin/env node
/**
 * Las capturas de la página de juegos, `public/juegos/<juego>.webp` y
 * `<juego>-light.webp`.
 *
 * Se hacían a mano, así que cada juego nuevo dependía de acordarse cómo. Esto
 * levanta la escena fija de `?pose=<juego>` a 1600 por 900, espera al momento
 * que se le pide, saca la foto en los dos temas y la pasa a WebP de 900 por 506
 * con ffmpeg.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/capturas-juegos.mjs teleferico --en 6.5
 *
 * `--en` son segundos reales desde que arranca la escena: elegí un momento en
 * que se vea de qué se trata el juego, no el cartel final.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const juego = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!juego) {
  console.error("uso: node scripts/capturas-juegos.mjs <juego> [--en segundos] [--base URL]");
  process.exit(2);
}
const en = Number(opt("--en", "6"));
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");

const tmp = mkdtempSync(join(tmpdir(), "tinkazo-capturas-"));
const browser = await launch({ port: Number(process.env.CDP_PORT || 9381), width: 1600, height: 900 });
try {
  for (const tema of ["dark", "light"]) {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&theme=${tema}` });
    const ok = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 20_000);
    if (!ok.ok) throw new Error(`la escena de ${juego} no arrancó`);
    await sleep(en * 1000);
    const png = join(tmp, `${juego}-${tema}.png`);
    await page.screenshot(png);
    const out = join("public", "juegos", `${juego}${tema === "light" ? "-light" : ""}.webp`);
    const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", "scale=900:506", "-c:v", "libwebp", "-quality", "80", out]);
    if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
    console.log(`  ✓ ${out}`);
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
} finally {
  browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
