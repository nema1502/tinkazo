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
 * **Solo vale lo que dibujó el motor pedido.** El 3D cae al 2D sin avisar cuando no arranca (sin WebGL, una conexión que el
 * navegador estima de 3G o menos, una placa de video que no da contexto), y el 2D anda al doble de cuadros: hasta el 6 de
 * noviembre de 2026 la fila decía `en3D: false`, "pasa", y nadie lo leía. La causa de esas filas: Chrome estima la conexión
 * (`navigator.connection.effectiveType`) de lo que tardan los pedidos; con la página ocupada pasa de "4g" a "3g" desde la
 * segunda página del mismo Chrome (se midieron 300 a 1.100 ms de RTT contra localhost) y `permite3d.ts` no arranca el 3D con
 * 3g o menos. `lib/browser.mjs` ahora le fija 4G al Chrome de los auditores (`TINKAZO_CONEXION` lo cambia). Ahora, con el 3D pedido (sin `--motor`, o `3d`),
 * la página tiene que tener su lienzo 3D al abrir el estadio y al terminar de medir; si no, esa corrida se descarta con su
 * motivo (la conexión estimada, los avisos `[3d]` de la consola), se repite en un Chrome nuevo y, si ninguna fue 3D, la
 * fila no pasa y el programa sale con error: nunca mide el 2D creyendo que es el 3D. Con `--motor pixi`, al revés.
 *
 * Con la placa de video de esta máquina; sin ella el número no vale.
 */
import { launch, sleep } from "./lib/browser.mjs";
import { diagnosticoDeArranque, filaDelCaso, motorDeLaFila, pide3D } from "./lib/medir-3d-motor.mjs";

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

/** Lo que anota la página desde el primer cuadro: la conexión que estima el navegador, cada vez que cambia. */
const ANOTAR_CONEXION = `(() => {
  window.__conexion = [];
  const c = navigator.connection;
  if (!c) return;
  const anota = () => window.__conexion.push(c.effectiveType + '/' + c.rtt + '/' + c.downlink);
  anota();
  c.addEventListener('change', anota);
})()`;

/** ¿Hay lienzo 3D? Lo deja el 3D de la carrera (`carrera-3d.ts`) y el de los demás juegos (`tres/motor.ts`) con este id. */
const HAY_3D = "!!document.getElementById('tres-canvas') || !!window.__tres";

let browser = await abrirChrome();
const filas = [];

function abrirChrome() {
  return launch({ port: Number(process.env.CDP_PORT || 9811), width: 1366, height: 900 });
}

async function medir(juego, vista, n) {
  const v = VISTAS[vista];
  const page = await browser.open("about:blank");
  const avisos = [];
  page.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "warning" || m.params.type === "error")) avisos.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  });
  const base = { juego, vista, n, cpu: CPU, motor: MOTOR || "(defecto)" };
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile, screenWidth: v.w, screenHeight: v.h });
    if (CPU > 1) await page.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: ANOTAR_CONEXION });
    const url = `${BASE}/?pose=${juego === "race" ? "1" : juego}&pace=normal&n=${n}&theme=dark&auditar=3d${MOTOR ? `&motor=${MOTOR}` : ""}`;
    await page.send("Page.navigate", { url });
    const listo = await page.waitFor("document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'", 120_000);
    if (!listo.ok) throw new Error("el estadio no apareció");
    // El lienzo 3D se monta con el estadio; un momento después se confirma que sigue ahí.
    await sleep(500);
    const inicio3D = !!(await page.eval(HAY_3D));
    await sleep(Math.max(0, DESDE * 1000 - 500));
    const t = JSON.parse(await page.eval(MEDIR(SEG)));
    const dt = t.slice(2);
    const orden = [...dt].sort((a, b) => a - b);
    const prom = dt.reduce((a, b) => a + b, 0) / dt.length;
    const p95 = orden[Math.floor(orden.length * 0.95)] ?? 0;
    const fin3D = !!(await page.eval(HAY_3D));
    const fps = 1000 / prom;
    const fila = { ...base, en3D: fin3D, fps: Number(fps.toFixed(1)), p95Ms: Number(p95.toFixed(0)), pasa: fps >= 30 && p95 <= 70 };
    const motor = motorDeLaFila({ motor: MOTOR, inicio3D, fin3D });
    if (motor.ok) return { fila, valida: true, motivo: "" };
    const lienzos = await page.eval("[...document.querySelectorAll('canvas')].map((c) => c.id || 'sin-id')");
    const conexiones = await page.eval("window.__conexion || []");
    const diag = diagnosticoDeArranque({ conexiones, avisos: avisos.filter((a) => /3d|webgl|context|arranc/i.test(a)), lienzos });
    return { fila, valida: false, motivo: `${motor.motivo} (${diag})` };
  } catch (e) {
    return { fila: { ...base, error: e.message, pasa: false }, valida: false, motivo: e.message };
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}
try {
  for (const juego of JUEGOS) {
    for (const vista of vistas) {
      for (const n of GENTE) {
        const corridas = [];
        for (let i = 0; i < INTENTOS; i++) {
          const c = await medir(juego, vista, n);
          corridas.push(c);
          // Con el motor equivocado no se repite en el mismo Chrome: lo que lo hizo caer al 2D puede quedar pegado a la sesión.
          if (!c.valida) {
            console.error(`  intento ${i + 1}/${INTENTOS} descartado (${juego} ${vista} ${n}): ${c.motivo}`);
            await browser.close();
            browser = await abrirChrome();
          }
          if (c.valida && c.fila.pasa) break;
        }
        const fila = filaDelCaso(corridas);
        filas.push(fila);
        console.log(JSON.stringify(fila));
      }
    }
  }
} finally {
  await browser.close();
}
const mal = filas.filter((f) => !f.pasa);
const sinMotor = filas.filter((f) => f.error);
console.log(`\n${filas.length - mal.length}/${filas.length} pasan (30 cuadros por segundo y 95 % bajo 70 ms, con el motor ${pide3D(MOTOR) ? "3D" : "2D"} pedido)${mal.length ? `; no pasan: ${mal.map((f) => `${f.juego} ${f.vista} ${f.n}`).join(", ")}` : ""}`);
if (sinMotor.length) console.log(`SIN MEDIR (el motor pedido no arrancó, no se midió el otro): ${sinMotor.map((f) => `${f.juego} ${f.vista} ${f.n}`).join(", ")}`);
process.exitCode = mal.length ? 1 : 0;
