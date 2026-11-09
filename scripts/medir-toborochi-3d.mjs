#!/usr/bin/env node
/**
 * El Toborochi en 3D: ¿las dos finalistas quedan enteras en la pantalla en cada cuadro entre «quedan dos» y el golpe?
 * (la comprobación 1 de la cámara) y ¿qué tanto varía el tamaño en pantalla de las flores de la copa al terminar de florecer?
 * (la 2, con `--n 30`). Reloj real, con `?auditar=3d`: la vista deja en `window.__tres.pantallas` dónde cae cada flor.
 *
 *   CDP_PORT=9801 node scripts/medir-toborochi-3d.mjs --base http://localhost:4801 --tamano 1366x768 [--n 18] [--tema dark]
 */
import { launch, sleep } from "./lib/browser.mjs";

process.env.TINKAZO_GPU = process.env.TINKAZO_GPU || "1";
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const [w, h] = opt("--tamano", "1366x768").split("x").map(Number);
const n = Number(opt("--n", "18"));
const tema = opt("--tema", "dark");
const port = Number(process.env.CDP_PORT || 9801);

const browser = await launch({ port, width: w, height: h });
try {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 });
  await page.send("Page.navigate", { url: `${base}/?pose=toborochi&motor=3d&pace=normal&n=${n}&theme=${tema}&auditar=3d` });
  const ok = await page.waitFor("window.__tres && window.__tres.cuadros > 20", 120_000);
  if (!ok.ok) throw new Error("no hay window.__tres");
  const muestras = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 120_000) {
    const s = await page.eval("(() => { const a = window.__tres; if (!a) return null; const st = document.getElementById('stadium'); return JSON.stringify({ t: a.t, q: a.tQuedan0, pico: a.tPico, tau: a.tau, p: a.pantallas || [], vivo: !!st && st.style.display === 'block' }); })()");
    if (!s) break;
    const m = JSON.parse(s);
    muestras.push(m);
    if (!m.vivo) break;
    await sleep(60);
  }
  // Las flores que siguen en el árbol: 1 en la quinta posición.
  const margen = 4;
  let fuera = 0, cuadros = 0, peor = 0;
  for (const m of muestras) {
    if (!(m.t >= m.q) || m.t >= m.pico || m.tau >= 0) continue;
    const enArbol = m.p.filter((f) => f[4] === 1);
    if (!enArbol.length) continue;
    cuadros++;
    for (const [, x, y, alto] of enArbol) {
      const r = alto / 2, cy = y + r;
      const sale = Math.max(0, margen - (x - r), x + r - (w - margen), margen - y, cy + r - (h - margen));
      if (sale > 0) fuera++;
      peor = Math.max(peor, sale);
    }
  }
  // El tamaño de las flores de la copa en el último cuadro antes de la primera ráfaga (ya florecidas).
  let tam = null;
  const flor = muestras.find((m) => m.t > 2.8 && m.p.filter((f) => f[4] === 1).length === n);
  if (flor) {
    const a = flor.p.filter((f) => f[4] === 1).map((f) => f[3]);
    tam = { max: Math.max(...a), min: Math.min(...a), razon: Math.max(...a) / Math.min(...a), t: flor.t };
  }
  console.log(JSON.stringify({ tamano: `${w}x${h}`, n, tema, muestras: muestras.length, cuadrosConDosFinalistas: cuadros, floresFuera: fuera, peorSalidaPx: Number(peor.toFixed(1)), tamanoDeFlores: tam }));
  if (page.exceptions.length) console.log("excepciones:", page.exceptions.slice(0, 3));
} finally {
  await browser.close();
}
