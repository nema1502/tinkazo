#!/usr/bin/env node
/**
 * El Guajojó en 2D y en 3D, lado a lado: las capturas de los cuatro momentos y la medida de cuadros por segundo.
 *
 * Las capturas llevan el nombre `<motor>-<momento>-<ancho>x<alto>-<tema>.png` (motor 2d o 3d; momento arranque, desarrollo,
 * golpe o ganador), con la misma ronda en los dos motores y los mismos instantes del reloj del juego. El reloj es virtual:
 * cada cuadro avanza un sesenta y cuatroavo de segundo y la escena se congela en cada instante para sacar la foto.
 *
 *   pnpm preview --port 4801 --strictPort &
 *   CDP_PORT=9801 node scripts/capturas-guajojo-3d.mjs --base http://localhost:4801 --out <carpeta>
 *   CDP_PORT=9801 node scripts/capturas-guajojo-3d.mjs --base http://localhost:4801 --fps --tamano 390x844 --cpu 4 --n 18
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

process.env.TINKAZO_GPU = process.env.TINKAZO_GPU || "1";
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const out = opt("--out", "capturas-guajojo");
const personas = Number(opt("--n", "18"));
const midiendo = args.includes("--fps");
const cpu = Number(opt("--cpu", "1"));
const semilla = opt("--semilla", "");
// Para mirar de cerca: --tamanos 1366x768, --temas dark, --motores 3d, --sin2d (esconde todo menos el lienzo de three.js).
const TAMANOS = opt("--tamanos", "1366x768,390x844").split(",").map((x) => x.split("x").map(Number));
const TEMAS = opt("--temas", "dark,light").split(",");
const MOTORES = opt("--motores", "2d,3d").split(",");
const sin2d = args.includes("--sin2d");
const port = Number(process.env.CDP_PORT || 9801);

// Los cuatro momentos, en segundos del reloj del juego: `abs` desde el principio, `frac` de la duración, `rel` desde el golpe.
const MOMENTOS = [
  ["arranque", { abs: 1.2 }],
  ["desarrollo", { frac: 0.55 }],
  ["golpe", { rel: 0.3 }],
  ["ganador", { rel: 2.4 }],
];

const PRELUDIO = (objs) => `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, sig = 0;
  const objs = ${JSON.stringify(objs)};
  const cbs = new Map();
  window.__foto = { lista: -1 };
  window.__sigue = () => { window.__foto.lista = -1; sig++; };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const meta = (o) => (o.abs !== undefined ? o.abs : o.frac !== undefined ? o.frac * window.__nino.duracion : window.__nino.duracion + o.rel);
  const bombear = () => {
    const N = window.__nino;
    const ob = objs[sig];
    if (ob && N && N.duracion > 0 && window.__foto.lista < 0 && N.t() >= meta(ob)) window.__foto.lista = sig;
    if (window.__foto.lista >= 0) { RAF(bombear); return; }
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

const urlDe = (motor, tema, extra = "") =>
  `${base}/?pose=guajojo&motor=${motor === "3d" ? "3d" : "pixi"}&pace=normal&n=${personas}&theme=${tema}${semilla ? `&semilla=${semilla}&ganador=${semilla}` : ""}${extra}`;

async function capturas() {
  mkdirSync(out, { recursive: true });
  const registro = [];
  const browser = await launch({ port, width: 1366, height: 768 });
  try {
    for (const [w, h] of TAMANOS) {
      for (const tema of TEMAS) {
        for (const motor of MOTORES) {
          const page = await browser.open("about:blank");
          await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO(MOMENTOS.map((m) => m[1])) });
          await page.send("Page.navigate", { url: urlDe(motor, tema, "&auditar=nino") });
          for (let i = 0; i < MOMENTOS.length; i++) {
            const ok = await page.waitFor(`window.__foto && window.__foto.lista === ${i}`, 240_000);
            if (!ok.ok) throw new Error(`${motor} ${w}x${h} ${tema}: no llegó al momento ${MOMENTOS[i][0]}`);
            await sleep(350);
            if (sin2d) await page.eval("document.querySelectorAll('canvas').forEach((c) => { if (c.id !== 'tres-canvas') c.style.visibility = 'hidden'; })");
            const t = Number(await page.eval("window.__nino.t()"));
            const archivo = join(out, `${motor}-${MOMENTOS[i][0]}-${w}x${h}-${tema}.png`);
            await page.screenshot(archivo);
            const canvas3d = await page.eval("!!document.getElementById('tres-canvas')");
            registro.push({ archivo, t: Number(t.toFixed(3)), canvas3d });
            console.log(`  ${archivo} (t=${t.toFixed(2)} s, lienzo 3D: ${canvas3d})`);
            await page.eval("window.__sigue()");
          }
          if (page.exceptions.length) console.log("  excepciones:", page.exceptions.slice(0, 3));
          if (page.consoleErrors.length) console.log("  console.error:", page.consoleErrors.slice(0, 3));
          await page.send("Page.navigate", { url: "about:blank" });
        }
      }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, "momentos.json"), JSON.stringify(registro, null, 2));
}

async function fps() {
  const [w, h] = opt("--tamano", "1366x768").split("x").map(Number);
  const tema = opt("--tema", "dark");
  const maximo = Number(opt("--segundos", "120"));
  const browser = await launch({ port, width: w, height: h });
  try {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: opt("--dpr", "1") === "1" ? 1 : Number(opt("--dpr", "1")), mobile: w < 600 });
    if (cpu > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.send("Page.navigate", { url: urlDe(opt("--motor", "3d"), tema, "&auditar=3d") });
    const ok = await page.waitFor("window.__tres && window.__tres.cuadros > 40", 120_000);
    if (!ok.ok) throw new Error("no hay window.__tres: ¿arrancó el 3D?");
    // Hasta que termina el show o se cumple el tiempo. Al terminar, el estadio suelta `window.__tres`: se lee cada segundo y
    // se queda con la última lectura buena.
    const LEER = `JSON.stringify((() => {
      const a = window.__tres;
      if (!a || !a.intervalos) return null;
      const iv = a.intervalos.slice(40), cpu = a.cpu.slice(40);
      const avg = (x) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length);
      const ord = [...iv].sort((p, q) => p - q);
      const ordc = [...cpu].sort((p, q) => p - q);
      const c = document.getElementById('tres-canvas');
      return { cuadros: a.cuadros, juegoT: a.t, intervaloMs: avg(iv), fps: 1000 / avg(iv), p95Ms: ord[Math.floor(ord.length * 0.95)], maxMs: ord[ord.length - 1], cpu3dMs: avg(cpu), cpu3dP95: ordc[Math.floor(ordc.length * 0.95)], llamadas: a.llamadas ?? null, triangulos: a.triangulos ?? null, maxLlamadas: a.maxLlamadas ?? null, canvas: c ? [c.width, c.height] : null, calidad: c ? c.dataset.calidad : null };
    })())`;
    let r = null;
    const t0 = Date.now();
    while (Date.now() - t0 < maximo * 1000) {
      await sleep(1000);
      const sigue = await page.eval("(() => { const s = document.getElementById('stadium'); return !!s && s.style.display === 'block'; })()");
      const lectura = JSON.parse(await page.eval(LEER));
      if (lectura) r = lectura;
      if (!sigue) break;
    }
    if (!r) throw new Error("no se pudo leer window.__tres");
    console.log(JSON.stringify({ tamano: `${w}x${h}`, cpu, personas, tema, ...r }));
    if (page.exceptions.length) console.log("excepciones:", page.exceptions.slice(0, 3));
  } finally {
    await browser.close();
  }
}

if (midiendo) await fps();
else await capturas();
