#!/usr/bin/env node
/**
 * Fotos de los obstáculos de la carrera (piedras, valla, ráfaga) en una escena fija con la semilla que se pida, en 3D o en 2D.
 *
 * Como `capturas-3d.mjs`: el reloj es virtual (cada cuadro avanza un sesenta y cuatroavo de segundo) y la escena se congela en cada hora pedida.
 * Las horas son del plan (`--t 46.4,47.4`, las que imprime `scripts/medir-drama-carrera.mjs --obstaculos`), no del reloj de la página.
 *
 * Uso:
 *   pnpm preview --port 4801 --strictPort &
 *   CDP_PORT=9801 node scripts/capturas-carrera-drama.mjs --base http://localhost:4801 --semilla <64 hex> --t 46,46.8,47.6 --motor 3d --tamano 1366x768 --out <carpeta>
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

process.env.TINKAZO_GPU = process.env.TINKAZO_GPU || "1";
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const out = opt("--out", "capturas-3d");
const porQ = "";
const semilla = opt("--semilla", "");
const offset = Number(opt("--offset", "0"));
// `--q 0,1,2,3,4` saca la foto al 25, 50, 70, 88 y 100 % de la recta final; `--en` en segundos de show.
const momentos = porQ ? porQ.split(",").map((x) => `q${x}`) : opt("--t", "6,12,18").split(",").map(Number);
const [w, h] = opt("--tamano", "1366x768").split("x").map(Number);
const tema = opt("--tema", "dark");
const motor = opt("--motor", "3d");
const demo = opt("--demo", "pose");
const prefijo = opt("--prefijo", "");
// `--n 18`: la escena fija con esa cantidad de nombres de ejemplo (`?n=`).
const cuantos = opt("--n", "");
const midiendo = args.includes("--fps");
// `--cpu 4`: frena la CPU esa cantidad de veces (el celular de gama media). Con `--fps`, mide cuadros por segundo de la página entera
// (los dos lienzos) además de lo que dibuja three.js; con `--motor pixi` mide el 2D de siempre, para compararlos.
const cpu = Number(opt("--cpu", "1"));
mkdirSync(out, { recursive: true });

const PRELUDIO = (lista) => `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, v0 = -1, sig = 0;
  const objetivos = ${JSON.stringify(lista)};
  const cbs = new Map();
  window.__foto = { lista: -1, t: 0 };
  window.__sigue = () => { window.__foto.lista = -1; sig++; };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    const st = document.getElementById('stadium');
    if (v0 < 0 && st && st.style.display === 'block') v0 = virt;
    if (v0 >= 0) window.__foto.t = (virt - v0) / 1000;
    const ob = objetivos[sig];
    const llego = typeof ob === 'number' && window.__tres && window.__tres.horas && window.__tres.horas.length ? window.__tres.t >= ob : typeof ob === 'string'
      ? !!(window.__tres && window.__tres.horas.length && window.__tres.t >= window.__tres.horas[Number(ob.slice(1))])
      : v0 >= 0 && virt - v0 >= ob * 1000;
    if (sig < objetivos.length && llego && window.__foto.lista < 0) window.__foto.lista = sig;
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

const url = (demo === "pose" ? `${base}/?pose=1` : `${base}/?demo=${demo}`) + `&theme=${tema}&motor=${motor}&auditar=3d${cuantos ? `&n=${cuantos}` : ""}${semilla ? `&semilla=${semilla}` : ""}`;
const browser = await launch({ port: Number(process.env.CDP_PORT || 9731), width: w, height: h });
try {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  if (cpu > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (midiendo) {
    await page.send("Page.navigate", { url: url + "&lead=3" });
    await page.waitFor("document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'", 120_000);
    await sleep(25_000);
    const r = JSON.parse(await page.eval(`JSON.stringify((() => { const a = window.__tres; if (!a) return { error: 'sin __tres' }; const iv = a.intervalos.slice(30), cpu = a.cpu.slice(30); const avg = (x) => x.reduce((s, v) => s + v, 0) / Math.max(1, x.length); const ord = [...iv].sort((p, q) => p - q); return { cuadros: a.cuadros, intervaloMs: avg(iv), fps: 1000 / avg(iv), p95Ms: ord[Math.floor(ord.length * 0.95)], cpu3dMs: avg(cpu), canvas: document.getElementById('tres-canvas') ? [document.getElementById('tres-canvas').width, document.getElementById('tres-canvas').height] : null }; })())`));
    // Cuadros de la página entera: un contador de requestAnimationFrame durante diez segundos más.
    const pag = JSON.parse(await page.eval(`new Promise((ok) => { const iv = []; let a = performance.now(); const fin = a + 10000; const paso = (n) => { iv.push(n - a); a = n; if (n < fin) requestAnimationFrame(paso); else { iv.sort((p, q) => p - q); const m = iv.reduce((x, y) => x + y, 0) / iv.length; ok(JSON.stringify({ paginaFps: 1000 / m, paginaMs: m, paginaP95Ms: iv[Math.floor(iv.length * 0.95)], paginaMaxMs: iv[iv.length - 1] })); } }; requestAnimationFrame(paso); })`));
    console.log(JSON.stringify({ ...r, ...pag, cpu, motor }));
  } else {
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO(motor === "3d" ? momentos : momentos.map((x) => x + offset)) });
    await page.send("Page.navigate", { url });
    for (let i = 0; i < momentos.length; i++) {
      const ok = await page.waitFor(`window.__foto && window.__foto.lista === ${i}`, 240_000);
      if (!ok.ok) throw new Error(`no llegó al segundo ${momentos[i]}`);
      await sleep(300);
      const t = await page.eval("window.__foto.t");
      const arch = join(out, `${prefijo}${w}x${h}-${tema}-${porQ ? "q" + (["25", "50", "70", "88", "100"][Number(porQ.split(",")[i])] ?? i) : "t" + String(momentos[i]).padStart(2, "0")}.png`);
      await page.screenshot(arch);
      const fichas = JSON.parse(await page.eval("JSON.stringify(window.__fichas3d || [])"));
      const pxs = fichas.map((f) => f.px).sort((a, b) => a - b);
      const med = pxs.length ? pxs[Math.floor(pxs.length / 2)] : 0;
      console.log(`  foto ${arch} (t=${Number(t).toFixed(2)}) nombres: ${fichas.length}, letra mediana ${med.toFixed(1)} px, mínima ${(pxs[0] ?? 0).toFixed(1)} px, alto de ficha ${(fichas[0]?.alto ?? 0).toFixed(1)} px`);
      const so = await page.eval("JSON.stringify(window.__solapes3d || null)");
      console.log(`  solapes: ${so}`);
      // Donde cae el aro frente a los pies de la llama líder, y cuánto aire le queda a la llama entera hasta el borde de la pantalla.
      const li = JSON.parse(await page.eval("JSON.stringify(window.__tres && window.__tres.lider || null)"));
      if (li) {
        const dist = li.aro ? Math.hypot(li.aro.x - li.pie.x, li.aro.y - li.pie.y) : null;
        const aire = Math.min(li.caja.x0, li.w - li.caja.x1);
        console.log(`  lider: persona ${li.persona} pies (${li.pie.x.toFixed(0)}, ${li.pie.y.toFixed(0)}) aro ${li.aro ? `(${li.aro.x.toFixed(0)}, ${li.aro.y.toFixed(0)})` : "sin aro"} distancia ${dist === null ? "-" : dist.toFixed(1)} px, aire al borde ${aire.toFixed(0)} px (llama x ${li.caja.x0.toFixed(0)} a ${li.caja.x1.toFixed(0)} de ${li.w})`);
      }
      await page.eval("window.__sigue()");
    }
  }
  if (page.exceptions.length) console.log("excepciones:", page.exceptions.slice(0, 3));
  if (page.consoleErrors.length) console.log("console.error:", page.consoleErrors.slice(0, 5));
} finally {
  await browser.close();
}
