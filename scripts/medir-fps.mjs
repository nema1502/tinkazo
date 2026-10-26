/**
 * Cuántos cuadros por segundo da un juego en un celular de gama media: la CPU
 * 4 veces más lenta (`Emulation.setCPUThrottlingRate`), 32 nombres y la pantalla
 * de un celular (vertical, girado) o de una tablet.
 *
 *   CDP_PORT=9811 node scripts/medir-fps.mjs --base http://localhost:4810 \
 *     [--juegos chovena,teleferico,oruro,sapo] [--vistas celular,celular-h,tablet] [--cpu 4] [--n 32] [--seg 10]
 *
 * Abre `?demo=<juego>&n=32`, espera a que arranque el juego (ya sin la tarjeta
 * de cómo se juega), mide los cuadros de `requestAnimationFrame` durante `--seg`
 * segundos y dice el promedio, el peor 5 %, cuántos cuadros pasan de 33 ms y en
 * qué nivel de calidad quedó el juego (`data-calidad`: alto, medio o bajo; el
 * gobernador de `calidad.ts` baja solo si los cuadros tardan). Con la placa de
 * video de esta máquina, sin ella el número no vale.
 */
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const arg = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = arg("base", "http://localhost:4173").replace(/\/$/, "");
const JUEGOS = arg("juegos", "chovena,teleferico,oruro,sapo").split(",");
const VISTAS = {
  celular: { w: 390, h: 844, mobile: true, dpr: 2 },
  "celular-chico": { w: 360, h: 800, mobile: true, dpr: 2 },
  "celular-h": { w: 844, h: 390, mobile: true, dpr: 2 },
  tablet: { w: 768, h: 1024, mobile: true, dpr: 2 },
  "tablet-h": { w: 1024, h: 768, mobile: true, dpr: 2 },
};
const vistas = arg("vistas", "celular,celular-h").split(",");
const CPU = Number(arg("cpu", "4"));
const N = Number(arg("n", "32"));
const SEG = Number(arg("seg", "10"));

const MEDIR = (seg) => `new Promise((resolve) => {
  const t = []; let prev = performance.now(); const fin = prev + ${seg * 1000};
  const f = (now) => { t.push(now - prev); prev = now; if (now < fin) requestAnimationFrame(f); else resolve(JSON.stringify(t)); };
  requestAnimationFrame(f);
})`;

const browser = await launch({ port: Number(process.env.CDP_PORT || 9222), width: 1280, height: 900 });
let malos = 0;
try {
  for (const juego of JUEGOS) {
    for (const vista of vistas) {
      const v = VISTAS[vista];
      const page = await browser.open("about:blank");
      try {
        await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: v.dpr, mobile: v.mobile, screenWidth: v.w, screenHeight: v.h });
        await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
        await page.send("Emulation.setCPUThrottlingRate", { rate: CPU });
        await page.send("Page.navigate", { url: `${BASE}/?demo=${juego}&n=${N}&lead=8&theme=dark` });
        // La tarjeta de cómo se juega sale primero; el juego, cuando ya no está y hay lienzo.
        const listo = await page.waitFor("document.getElementById('stadium').style.display === 'block' && document.getElementById('pixi-canvas') && !document.querySelector('.game-card')", 90000);
        if (!listo.ok) {
          console.log(`✗ ${juego} ${vista}: el juego no arrancó`);
          malos++;
          continue;
        }
        await sleep(1500);
        const t = JSON.parse(await page.eval(MEDIR(SEG)));
        const dt = t.slice(2);
        const orden = [...dt].sort((a, b) => a - b);
        const prom = dt.reduce((a, b) => a + b, 0) / dt.length;
        const p95 = orden[Math.floor(orden.length * 0.95)] ?? 0;
        const largos = dt.filter((x) => x > 33.5).length;
        const calidad = await page.eval("document.getElementById('pixi-canvas')?.dataset.calidad || '?'");
        const fps = 1000 / prom;
        const ok = fps >= 24;
        if (!ok) malos++;
        console.log(`${ok ? "✓" : "✗"} ${juego.padEnd(10)} ${vista.padEnd(10)} ${fps.toFixed(0).padStart(3)} cuadros/s · el 5 % peor ${p95.toFixed(0)} ms · ${((largos / dt.length) * 100).toFixed(0)} % pasan de 33 ms · calidad ${calidad}`);
      } catch (e) {
        console.log(`✗ ${juego} ${vista}: ${e.message}`);
        malos++;
      } finally {
        await page.send("Page.close").catch(() => {});
      }
    }
  }
} finally {
  await browser.close();
}
process.exit(malos ? 1 : 0);
