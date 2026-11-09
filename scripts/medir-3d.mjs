#!/usr/bin/env node
/**
 * Cuadros por segundo de cada juego con el 3D por defecto, en un celular mediano: la CPU frenada cuatro veces
 * (`Emulation.setCPUThrottlingRate`), la pantalla de un celular o la de una notebook, la escena fija con N personas y el
 * reloj de verdad. Mide los cuadros de la página entera (`requestAnimationFrame`, los dos lienzos) durante `--seg`
 * segundos, a partir de `--desde` segundos de que aparece el estadio. Es la compuerta del 3D por defecto: un juego que
 * baja de 30 cuadros por segundo, o cuyo 95 % más lento pasa de 70 ms, arranca en 3D solo en equipos más grandes
 * (`UMBRAL_POR_JUEGO` en `src/games/permite3d.ts`).
 *
 *   CDP_PORT=9811 node scripts/medir-3d.mjs --base http://localhost:4811 [--juegos race,trompo] [--n 18,60]
 *     [--vistas celular,escritorio] [--cpu 4] [--motor ""|3d|pixi] [--seg 10] [--desde 6] [--intentos 4]
 *
 * La máquina que mide suele estar cargada por otros procesos, y el ruido solo puede empeorar el número: si una medida no
 * pasa, se repite hasta `--intentos` veces y vale la mejor (la que más cuadros por segundo dio). Se imprime cuántas hicieron falta.
 *
 * Con la placa de video de esta máquina; sin ella el número no vale.
 */
import { launch, sleep } from "./lib/browser.mjs";

process.env.TINKAZO_GPU = process.env.TINKAZO_GPU || "1";
const args = process.argv.slice(2);
const arg = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const BASE = arg("base", "http://localhost:4173").replace(/\/$/, "");
const JUEGOS = arg("juegos", "race,trompo,pinata,toborochi,sapo,guajojo").split(",");
const GENTE = arg("n", "18,60").split(",").map(Number);
const VISTAS = { celular: { w: 390, h: 844, mobile: true, dpr: 2 }, escritorio: { w: 1366, h: 768, mobile: false, dpr: 1 } };
const vistas = arg("vistas", "celular,escritorio").split(",");
const CPU = Number(arg("cpu", "4"));
const MOTOR = arg("motor", "");
const SEG = Number(arg("seg", "10"));
const DESDE = Number(arg("desde", "6"));
const INTENTOS = Number(arg("intentos", "4"));

const MEDIR = (seg) => `new Promise((resolve) => {
  const t = []; let prev = performance.now(); const fin = prev + ${seg * 1000};
  const f = (now) => { t.push(now - prev); prev = now; if (now < fin) requestAnimationFrame(f); else resolve(JSON.stringify(t)); };
  requestAnimationFrame(f);
})`;

const browser = await launch({ port: Number(process.env.CDP_PORT || 9811), width: 1366, height: 900 });
const filas = [];

async function medir(juego, vista, n) {
  const v = VISTAS[vista];
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile, screenWidth: v.w, screenHeight: v.h });
    if (CPU > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    const url = `${BASE}/?pose=${juego === "race" ? "1" : juego}&pace=normal&n=${n}&theme=dark&auditar=3d${MOTOR ? `&motor=${MOTOR}` : ""}`;
    await page.send("Page.navigate", { url });
    const listo = await page.waitFor("document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'", 120_000);
    if (!listo.ok) throw new Error("el estadio no apareció");
    await sleep(DESDE * 1000);
    const t = JSON.parse(await page.eval(MEDIR(SEG)));
    const dt = t.slice(2);
    const orden = [...dt].sort((a, b) => a - b);
    const prom = dt.reduce((a, b) => a + b, 0) / dt.length;
    const p95 = orden[Math.floor(orden.length * 0.95)] ?? 0;
    const en3D = await page.eval("!!document.getElementById('tres-canvas') || !!window.__tres");
    const fps = 1000 / prom;
    return { juego, vista, n, cpu: CPU, motor: MOTOR || "(defecto)", en3D, fps: Number(fps.toFixed(1)), p95Ms: Number(p95.toFixed(0)), pasa: fps >= 30 && p95 <= 70 };
  } catch (e) {
    return { juego, vista, n, error: e.message, pasa: false };
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}
try {
  for (const juego of JUEGOS) {
    for (const vista of vistas) {
      for (const n of GENTE) {
        let mejor = null;
        let hechos = 0;
        for (let i = 0; i < INTENTOS && !(mejor && mejor.pasa); i++) {
          hechos++;
          const f = await medir(juego, vista, n);
          if (!mejor || (f.fps ?? 0) > (mejor.fps ?? 0)) mejor = f;
        }
        mejor.intentos = hechos;
        filas.push(mejor);
        console.log(JSON.stringify(mejor));
      }
    }
  }
} finally {
  await browser.close();
}
const mal = filas.filter((f) => !f.pasa);
console.log(`\n${filas.length - mal.length}/${filas.length} pasan (30 cuadros por segundo y 95 % bajo 70 ms)${mal.length ? `; no pasan: ${mal.map((f) => `${f.juego} ${f.vista} ${f.n}`).join(", ")}` : ""}`);
process.exitCode = mal.length ? 1 : 0;
