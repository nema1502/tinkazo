#!/usr/bin/env node
/**
 * El Toborochi en 2D y en 3D, lado a lado: las capturas de los cuatro momentos y la medida de cuadros por segundo.
 *
 * Las capturas llevan el nombre `<motor>-<momento>-<ancho>x<alto>-<tema>.png` (motor 2d o 3d; momento arranque, desarrollo,
 * golpe o ganador), con la misma ronda en los dos motores y los mismos instantes del reloj del juego. El reloj es virtual:
 * cada cuadro avanza un sesenta y cuatroavo de segundo y la escena se congela en cada instante para sacar la foto.
 *
 *   pnpm preview --port 4801 --strictPort &
 *   CDP_PORT=9801 node scripts/capturas-toborochi-3d.mjs --base http://localhost:4801 --out <carpeta>
 *   CDP_PORT=9801 node scripts/capturas-toborochi-3d.mjs --base http://localhost:4801 --fps --tamano 390x844 --cpu 4 --n 18
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
const out = opt("--out", "capturas-toborochi");
const personas = Number(opt("--n", "18"));
const midiendo = args.includes("--fps");
const cpu = Number(opt("--cpu", "1"));
const semilla = opt("--semilla", "");
const port = Number(process.env.CDP_PORT || 9801);
// Para mirar de a poco: --motores 3d, --temas dark, --tamanos 390x844, --solo golpe,ganador
const lista = (nombre, def) => opt(nombre, def).split(",");
const soloMotores = lista("--motores", "2d,3d");
const soloTemas = lista("--temas", "dark,light");
const soloTamanos = lista("--tamanos", "1366x768,390x844");
const soloMomentos = lista("--solo", "arranque,desarrollo,golpe,ganador");

// Los cuatro momentos, en segundos del reloj del juego: `abs` desde el principio, `frac` de la duración, `rel` desde el golpe.
// `--extra nombre=abs:6.5,otro=rel:-1.2` reemplaza los cuatro momentos por los pedidos (para mirar un instante en particular).
const EXTRA = opt("--extra", "");
const MOMENTOS = EXTRA ? EXTRA.split(",").map((p) => { const [nom, v] = p.split("="); const [k, x] = v.split(":"); return [nom, { [k]: Number(x) }]; }) : [
  ["arranque", { abs: 1.5 }],
  ["desarrollo", { frac: 0.5 }],
  ["golpe", { rel: 0.3 }],
  ["ganador", { rel: 1.7 }],
].filter((m) => EXTRA || soloMomentos.includes(m[0]));

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
  `${base}/?pose=toborochi&motor=${motor === "3d" ? "3d" : "pixi"}&pace=normal&n=${personas}&theme=${tema}${semilla ? `&semilla=${semilla}&ganador=${semilla}` : ""}${extra}`;

async function capturas() {
  mkdirSync(out, { recursive: true });
  const bitacora = [];
  const browser = await launch({ port, width: 1366, height: 768 });
  try {
    for (const [w, h] of soloTamanos.map((x) => x.split("x").map(Number))) {
      for (const tema of soloTemas) {
        for (const motor of soloMotores) {
          const page = await browser.open("about:blank");
          await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO(MOMENTOS.map((m) => m[1])) });
          await page.send("Page.navigate", { url: urlDe(motor, tema, "&auditar=nino") });
          for (let i = 0; i < MOMENTOS.length; i++) {
            const ok = await page.waitFor(`window.__foto && window.__foto.lista === ${i}`, 240_000);
            if (!ok.ok) throw new Error(`${motor} ${w}x${h} ${tema}: no llegó al momento ${MOMENTOS[i][0]}`);
            await sleep(350);
            const t = Number(await page.eval("window.__nino.t()"));
            const archivo = join(out, `${motor}-${MOMENTOS[i][0]}-${w}x${h}-${tema}.png`);
            await page.screenshot(archivo);
            const canvas3d = await page.eval("!!document.getElementById('tres-canvas')");
            bitacora.push({ archivo, t: Number(t.toFixed(3)), canvas3d });
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
  writeFileSync(join(out, "momentos.json"), JSON.stringify(bitacora, null, 2));
}

async function fps() {
  const [w, h] = opt("--tamano", "1366x768").split("x").map(Number);
  const tema = opt("--tema", "dark");
  const maximo = Number(opt("--segundos", "60"));
  const browser = await launch({ port, width: w, height: h });
  try {
    const page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: opt("--dpr", "1") === "1" ? 1 : Number(opt("--dpr", "1")), mobile: w < 600 });
    if (cpu > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.send("Page.navigate", { url: urlDe(opt("--motor", "3d"), tema, "&auditar=3d") });
    const ok = await page.waitFor("window.__tres && window.__tres.cuadros > 40", 120_000);
    if (!ok.ok) throw new Error("no hay window.__tres: ¿arrancó el 3D?");
    const t0 = Date.now();
    // Se lee cada segundo: al terminar el show el motor suelta `window.__tres`, y se queda con la última lectura.
    let r = null;
    const LEER = `(() => { if (!window.__tres) return null; return JSON.stringify((() => {
      const a = window.__tres;
      const iv = a.intervalos.slice(40), cpu = a.cpu.slice(40);
      // El peor segundo: la menor cantidad de cuadros en una ventana de un segundo (la ráfaga con más flores en movimiento).
      let peor = Infinity;
      for (let i = 0, j = 0, s = 0; i < iv.length; i++) { s += iv[i]; while (s > 1000 && j < i) { s -= iv[j++]; } if (s >= 900) peor = Math.min(peor, (i - j + 1) * 1000 / s); }
      const avg = (x) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length);
      const ord = [...iv].sort((p, q) => p - q);
      const ordc = [...cpu].sort((p, q) => p - q);
      const c = document.getElementById('tres-canvas');
      return { cuadros: a.cuadros, juegoT: a.t, intervaloMs: avg(iv), fps: 1000 / avg(iv), peorSegundoFps: Number.isFinite(peor) ? peor : null, p95Ms: ord[Math.floor(ord.length * 0.95)], maxMs: ord[ord.length - 1], cpu3dMs: avg(cpu), cpu3dP95: ordc[Math.floor(ordc.length * 0.95)], llamadas: a.llamadas ?? null, triangulos: a.triangulos ?? null, maxLlamadas: a.maxLlamadas ?? null, canvas: c ? [c.width, c.height] : null, calidad: c ? c.dataset.calidad : null };
    })()); })()`;
    // Hasta que termina el show o se cumple el tiempo.
    while (Date.now() - t0 < maximo * 1000) {
      await sleep(1000);
      const lectura = await page.eval(LEER);
      if (lectura) r = JSON.parse(lectura);
      const sigue = await page.eval("(() => { const s = document.getElementById('stadium'); return !!s && s.style.display === 'block'; })()");
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
