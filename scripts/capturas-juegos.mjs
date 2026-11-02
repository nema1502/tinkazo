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
 * distintos (lo vio la revisión visual, 5 de octubre de 2026).
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/capturas-juegos.mjs teleferico --en 6.5
 *
 * `--en` son segundos de juego desde que aparece el estadio: elegí un momento
 * en que se vea de qué se trata el juego, no el cartel final. `--out <carpeta>`
 * las deja en otro lado, para probar momentos sin pisar las de la página.
 *
 * Para elegir el mejor momento, `--en 4,7,10,13` saca una foto en cada uno, en
 * la misma corrida (`<juego>-<segundos>s[-light].webp`), y `--temas dark` solo
 * la oscura.
 *
 * `--limpia` esconde, solo en la foto, lo que el show le pone encima: la franja
 * de arriba (la marca, la ronda, SONIDO y Saltar) y la banda del subtítulo, y el marcador de cuántos quedan. Es
 * la que va en las tarjetas de la portada. Con `--tam 640x360` cambia el
 * tamaño de la imagen; por defecto es 900x506. `--vista 960x540` cambia el
 * tamaño de la pantalla que se fotografía (por defecto 1600x900): en una más
 * chica el dibujo sale más grande dentro del cuadro, que es lo que hace falta
 * cuando la imagen se va a ver chica. `--recorte x,y,ancho,alto` se queda con
 * un pedazo de la foto (en píxeles de la pantalla fotografiada) antes de achicarla.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
const ens = opt("--en", "6").split(",").map(Number);
const varias = ens.length > 1;
const limpia = args.includes("--limpia");
const [anchoOut, altoOut] = opt("--tam", "900x506").split("x").map(Number);
const [vistaW, vistaH] = opt("--vista", "1600x900").split("x").map(Number);
const recorte = opt("--recorte", "");
const temas = opt("--temas", "dark,light").split(",");
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
  window.__foto = { lista: false, hasta: ${ens[0] * 1000} };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    // Con --limpia, la interfaz del juego (el marcador de cuántos quedan y lo que cuelga de ella) no se dibuja.
    if (${limpia}) { const T = window.__tinkazo; if (T && T.hud) T.hud.renderable = false; }
    const st = document.getElementById('stadium');
    if (v0 < 0 && st && st.style.display === 'block') v0 = virt;
    if (v0 >= 0 && st && st.style.display !== 'block') window.__foto.cerro = true;
    if (v0 >= 0 && virt - v0 >= window.__foto.hasta) { window.__foto.lista = true; RAF(bombear); return; }
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

/** Espera a que la escena llegue al momento pedido. Cada consulta tiene su plazo: si la página ya cerró el estadio, no se cuelga. */
async function esperarFoto(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await page.send("Runtime.evaluate", { expression: "!!(window.__foto && window.__foto.lista)", returnByValue: true }, 4000);
      if (r.result?.value) return { ok: true };
      // Con varios momentos, si el estadio se cerró (terminó el show) no hay más que esperar.
      const e = await page.send("Runtime.evaluate", { expression: "window.__foto.cerro === true", returnByValue: true }, 4000);
      if (e.result?.value) return { ok: false };
    } catch {
      /* la página puede estar ocupada o navegando */
    }
    await sleep(300);
  }
  return { ok: false };
}

const tmp = mkdtempSync(join(tmpdir(), "tinkazo-capturas-"));
mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: Number(process.env.CDP_PORT || 9381), width: vistaW, height: vistaH });
try {
  for (const tema of temas) {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: vistaW, height: vistaH, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&theme=${tema}&motor=${motor}${limpia ? "&auditar=camara" : ""}` });
    if (limpia) {
      await page.eval(`(() => { const e = document.createElement("style"); e.textContent = ".st-top, .commentary { visibility: hidden !important; }"; document.head.appendChild(e); })()`);
    }
    for (const en of ens) {
      if (en !== ens[0]) await page.eval(`window.__foto.lista = false; window.__foto.hasta = ${en * 1000}`);
      const ok = await esperarFoto(page, 120_000);
      if (!ok.ok) {
        // Con varios momentos, los que pasan del final del show se saltean.
        if (varias) { console.log(`  (${en} s: el show ya terminó)`); break; }
        throw new Error(`la escena de ${juego} no llegó a los ${en} s`);
      }
      // Un respiro para que el último cuadro llegue a la pantalla.
      await sleep(300);
      const png = join(tmp, `${juego}-${en}-${tema}.png`);
      await page.screenshot(png);
      const nombre = `${juego}${varias ? `-${String(en).replace(".", "_")}s` : ""}${tema === "light" ? "-light" : ""}.webp`;
      const out = join(outDir, nombre);
      mkdirSync(dirname(out), { recursive: true });
      const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `${recorte ? `crop=${recorte.split(",")[2]}:${recorte.split(",")[3]}:${recorte.split(",")[0]}:${recorte.split(",")[1]},` : ""}scale=${anchoOut}:${altoOut}:flags=lanczos`, "-c:v", "libwebp", "-quality", "80", "-compression_level", "6", out]);
      if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
      console.log(`  ✓ ${out}`);
    }
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
