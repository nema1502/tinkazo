#!/usr/bin/env node
/**
 * Las capturas de la página de juegos, `public/juegos/<juego>.webp` y
 * `<juego>-light.webp`.
 *
 * Se hacían a mano, así que cada juego nuevo dependía de acordarse cómo. Esto
 * levanta la escena fija de `?pose=<juego>` a 1600 por 900, la lleva hasta el
 * momento que se le pide, saca la foto en los dos temas y la pasa a WebP de
 * 900 por 506 con ffmpeg.
 *
 * El reloj es virtual, como en el auditor exigente: cada cuadro avanza un
 * sesenta y cuatroavo de segundo, y al llegar al momento pedido la escena se
 * congela. Con espera de verdad, la oscura y la clara salían en instantes
 * distintos (lo vio el agente evaluador, 5 de octubre de 2026).
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/capturas-juegos.mjs teleferico --en 6.5
 *
 * `--en` son segundos de juego desde que aparece el estadio: elegí un momento
 * en que se vea de qué se trata el juego, no el cartel final. `--out <carpeta>`
 * las deja en otro lado, para probar momentos sin pisar las de la página.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
  console.error("uso: node scripts/capturas-juegos.mjs <juego> [--en segundos] [--base URL] [--out carpeta]");
  process.exit(2);
}
const en = Number(opt("--en", "6"));
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", join("public", "juegos"));
// El motor nuevo, con la placa de video; `--motor clasico` fotografía el anterior.
const motor = opt("--motor", "pixi");
if (motor !== "clasico") process.env.TINKAZO_GPU = "1";

/**
 * Se inyecta antes que cualquier script de la página: `requestAnimationFrame`
 * y `performance.now()` dejan de dar la hora real y dan un reloj que avanza de
 * a 1/64 s por cuadro. Un bombeo con el rAF de verdad despacha los cuadros
 * hasta el momento pedido, y ahí se detiene: la escena queda quieta para la foto.
 */
const PRELUDIO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, v0 = -1;
  const cbs = new Map();
  window.__foto = { lista: false };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    const st = document.getElementById('stadium');
    if (v0 < 0 && st && st.style.display === 'block') v0 = virt;
    if (v0 >= 0 && virt - v0 >= ${en * 1000}) { window.__foto.lista = true; return; }
    if (cbs.size) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      for (const cb of lote) { try { cb(virt); } catch (e) { console.error(e); } }
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

const tmp = mkdtempSync(join(tmpdir(), "tinkazo-capturas-"));
mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: Number(process.env.CDP_PORT || 9381), width: 1600, height: 900 });
try {
  for (const tema of ["dark", "light"]) {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&theme=${tema}&motor=${motor}` });
    const ok = await page.waitFor("window.__foto && window.__foto.lista", 120_000);
    if (!ok.ok) throw new Error(`la escena de ${juego} no llegó a los ${en} s`);
    // Un respiro para que el último cuadro llegue a la pantalla.
    await sleep(300);
    const png = join(tmp, `${juego}-${tema}.png`);
    await page.screenshot(png);
    const out = join(outDir, `${juego}${tema === "light" ? "-light" : ""}.webp`);
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
