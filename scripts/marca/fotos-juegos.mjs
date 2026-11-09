#!/usr/bin/env node
/**
 * Las fotos de los juegos para las piezas impresas (roll-up y banner de mesa): `scripts/marca/fotos/<juego>.jpg`.
 *
 * Una pieza de dos metros necesita fotos grandes: la escena fija de `?pose=<juego>&semilla=<64 hex>` se dibuja en una
 * pantalla de 1920 por 1080 con el doble de densidad (3840 por 2160), se congela en el momento de la tabla de abajo con
 * el reloj virtual de scripts/capturas-juegos.mjs y se guarda en JPEG de 2560 por 1440 con ffmpeg: en el roll-up de
 * 85 cm cada foto mide unos 36 cm, o sea 180 puntos por pulgada, y 150 en el de 100 cm, lo que piden las imprentas. El
 * generador de marca
 * (scripts/generar-marca.mjs) no abre Chrome: lee estas fotos y las mete tal cual en el PDF, así que el kit se sigue
 * armando en cualquier equipo sin navegador. Se corre solo cuando cambia un juego:
 *
 *   pnpm dev --port 5818 &
 *   node scripts/marca/fotos-juegos.mjs --base http://localhost:5818
 *
 * `--juegos race,oruro` hace solo esos; `--en 4,7,10` saca un momento por foto para elegir (a `--out`, sin pisar las
 * del kit); `--tam 960x540` las achica para mirar rápido.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "../lib/browser.mjs";

/** Qué juego, en qué motor y en qué segundo del show: un momento en que se entiende de qué se trata, antes del cartel final. */
export const FOTOS = [
  { juego: "race", motor: "3d", en: 11 },
  { juego: "oruro", motor: "2d", en: 7 },
  { juego: "guajojo", motor: "3d", en: 11 },
  { juego: "toborochi", motor: "3d", en: 8 },
  { juego: "pinata", motor: "3d", en: 8 },
  { juego: "wheel", motor: "2d", en: 7 },
];
/** La misma semilla para todas: la escena es siempre la misma y cualquiera la puede volver a dibujar. */
export const SEMILLA = "7a1c3e5b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c2e4b6d8f1a3c5e7b9d0f2a4c";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:5818").replace(/\/$/, "");
const soloJuegos = opt("--juegos", "").split(",").filter(Boolean);
const momentos = opt("--en", "").split(",").filter(Boolean).map(Number);
const motorPedido = opt("--motor", "");
const [salidaW, salidaH] = opt("--tam", "2560x1440").split("x").map(Number);
const calidadJpg = opt("--q", "4"); // escala de ffmpeg: 2 es casi sin pérdida, 31 lo peor
const originales = opt("--originales", ""); // ahí queda además la foto entera de 3840 por 2160, en PNG
const outDir = opt("--out", fileURLToPath(new URL("./fotos/", import.meta.url)));
const puerto = Number(process.env.CDP_PORT || 9818);
process.env.TINKAZO_GPU = "1";

const PRELUDIO = (hasta) => `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, v0 = -1;
  const cbs = new Map();
  window.__foto = { lista: false, hasta: ${hasta} };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    const T = window.__tinkazo; if (T && T.hud) T.hud.renderable = false;
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

async function esperar(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await page.send("Runtime.evaluate", { expression: "!!(window.__foto && window.__foto.lista)", returnByValue: true }, 4000);
      if (r.result?.value) return true;
      const e = await page.send("Runtime.evaluate", { expression: "window.__foto.cerro === true", returnByValue: true }, 4000);
      if (e.result?.value) return false;
    } catch {
      /* ocupada */
    }
    await sleep(300);
  }
  return false;
}

// Un juego que no está en la tabla también se puede fotografiar, para probar (en 2D, a los 6 s si no se pide otra cosa).
const lista = soloJuegos.length ? soloJuegos.map((j) => FOTOS.find((f) => f.juego === j) ?? { juego: j, motor: "2d", en: 6 }) : FOTOS;
const tmp = mkdtempSync(join(tmpdir(), "tinkazo-fotos-"));
mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: puerto, width: 1920, height: 1080 });
try {
  for (const f of lista) {
    const motor = motorPedido || f.motor;
    const ens = momentos.length ? momentos : [f.en];
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO(ens[0] * 1000) });
    const pose = f.juego === "race" ? "1" : f.juego;
    await page.send("Page.navigate", { url: `${base}/?pose=${pose}&semilla=${SEMILLA}&ganador=${SEMILLA}&theme=dark&calidad=alta&motor=${motor}&auditar=camara` });
    await page.waitFor("document.readyState === 'complete'", 30_000);
    await page.eval(`(() => { const e = document.createElement("style"); e.textContent = ".st-top, .commentary { visibility: hidden !important; }"; document.head.appendChild(e); })()`);
    for (const en of ens) {
      if (en !== ens[0]) await page.eval(`window.__foto.lista = false; window.__foto.hasta = ${en * 1000}`);
      if (!(await esperar(page, 180_000))) { console.log(`  ${f.juego} ${en} s: el show ya terminó`); break; }
      await sleep(400);
      const png = join(tmp, `${f.juego}-${en}.png`);
      await page.screenshot(png);
      const nombre = momentos.length ? `${f.juego}-${motor}-${String(en).replace(".", "_")}s.jpg` : `${f.juego}.jpg`;
      const out = join(outDir, nombre);
      const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale=${salidaW}:${salidaH}:flags=lanczos`, "-q:v", calidadJpg, "-pix_fmt", "yuvj444p", out]);
      if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
      // Y una media de 1280 por 720 para el banner de mesa, y una chica de 640 por 360 para las vistas de la página.
      if (!momentos.length) {
        for (const [suf, tam, q, pix] of [["media", "1280:720", "4", "yuvj444p"], ["chica", "640:360", "5", "yuvj420p"]]) {
          const c = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale=${tam}:flags=lanczos`, "-q:v", q, "-pix_fmt", pix, join(outDir, `${f.juego}-${suf}.jpg`)]);
          if (c.status !== 0) throw new Error(`ffmpeg: ${c.stderr}`);
        }
      }
      if (originales) { mkdirSync(originales, { recursive: true }); copyFileSync(png, join(originales, nombre.replace(/\.jpg$/, ".png"))); }
      console.log(`  ${out} (${Math.round(statSync(out).size / 1024)} KB)`);
    }
    try { await page.send("Page.close"); } catch { /* ya cerrada */ }
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
