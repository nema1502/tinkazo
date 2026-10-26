/**
 * El inventario de la letra pequeña: recorre el flujo del organizador en el
 * modo libre (sin cuenta ni Stellar, con `?lead=` segundos hasta la ronda) y, en
 * cada paso, lista los textos visibles por debajo del umbral (docs/ux.md, "La
 * letra grande"), con su tamaño calculado, dónde están y qué dicen.
 *
 *   CDP_PORT=9811 node scripts/medir-texto.mjs --base http://localhost:4810 \
 *     [--vistas celular,escritorio,proyector] [--min 16] [--out carpeta]
 *
 * Pasos: portada, herramienta con la lista vacía, lista cargada, sellada y
 * esperando, número listo, resultado (con "Siguiente premio") y el estadio.
 * No sella nada en ninguna cadena. Deja `inventario-<vista>.json` en `--out`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { UMBRALES, sondaTexto } from "./lib/texto-minimo.mjs";

const args = process.argv.slice(2);
const arg = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = arg("base", "http://localhost:4173").replace(/\/$/, "");
const OUT = arg("out", "docs/capturas/letra");
const MIN = Number(arg("min", String(UMBRALES.flujo)));
const vistasArg = arg("vistas", "celular,escritorio,proyector");
mkdirSync(OUT, { recursive: true });

const VISTAS = {
  celular: { w: 390, h: 844, mobile: true },
  "celular-chico": { w: 360, h: 800, mobile: true },
  "celular-h": { w: 844, h: 390, mobile: true },
  tablet: { w: 768, h: 1024, mobile: true },
  "tablet-h": { w: 1024, h: 768, mobile: true },
  escritorio: { w: 1280, h: 720, mobile: false },
  laptop: { w: 1366, h: 768, mobile: false },
  proyector: { w: 1920, h: 1080, mobile: false },
};

const NOMBRES = ["Ana Quispe", "Beto Mamani", "Carla Choque", "Diego Rojas", "Elena Condori", "Fabián Torrez", "Gabriela Flores", "Hugo Vargas", "Inés Gutiérrez", "Jorge Mamani", "Karen López", "Luis Apaza"].join("\n");

async function pagina(browser, vista, url) {
  const page = await browser.open("about:blank");
  const v = VISTAS[vista];
  await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile, screenWidth: v.w, screenHeight: v.h });
  if (v.mobile) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] }).catch(() => {});
  await page.send("Page.navigate", { url });
  return page;
}

const clic = (page, sel) => page.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);

async function medir(page, paso, resultado, opts = {}) {
  const r = JSON.parse(await page.eval(sondaTexto({ min: MIN, ...opts })));
  resultado.push({ paso, ...r });
  const n = r.chicos ? r.chicos.length : 0;
  console.log(`  ${paso}: ${r.total ?? "?"} textos, ${n} por debajo de ${MIN} px`);
  for (const c of r.chicos || []) console.log(`     ${String(c.px).padStart(5)} px  ×${String(c.veces).padEnd(2)} ${c.donde}  «${c.texto}»`);
}

const browser = await launch({ port: Number(process.env.CDP_PORT || 9222), width: 1280, height: 900 });
try {
  for (const vista of vistasArg.split(",")) {
    console.log(`\n== ${vista} (${VISTAS[vista].w}x${VISTAS[vista].h})`);
    const resultado = [];
    // El flujo, con el show saltado: lo que se ve en la página.
    let page = await pagina(browser, vista, `${BASE}/?lead=6&instant=1`);
    try {
      await page.waitFor("document.readyState === 'complete' && document.querySelector('.hero')", 30000);
      await sleep(1500);
      await medir(page, "portada", resultado);
      await clic(page, ".topnav .nav-app");
      await sleep(1500);
      await medir(page, "herramienta vacía", resultado, { solo: "main" });
      await page.eval(`(() => { const ta = document.getElementById('ta'); ta.value = ${JSON.stringify(NOMBRES)}; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await sleep(700);
      await page.eval(`(() => { const b = [...document.querySelectorAll('#prize-chips button')][0]; if (b) b.click(); return true; })()`);
      await sleep(500);
      await medir(page, "lista cargada", resultado, { solo: "main" });
      await page.eval("document.getElementById('btn-freeze').removeAttribute('aria-disabled'); true");
      await clic(page, "#btn-freeze");
      await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", 30000);
      await sleep(1200);
      await medir(page, "sellada, esperando", resultado, { solo: "main" });
      await page.waitFor("!document.getElementById('btn-draw').disabled", 90000);
      await sleep(600);
      await medir(page, "número listo", resultado, { solo: "main" });
      await clic(page, "#btn-draw");
      await page.waitFor("document.getElementById('again-row') && getComputedStyle(document.getElementById('again-row')).display !== 'none'", 120000);
      await sleep(1500);
      await medir(page, "resultado y siguiente premio", resultado, { solo: "main" });
      await clic(page, "#btn-espera");
      await page.send("Page.captureScreenshot", { format: "png" }).then(({ data }) => writeFileSync(join(OUT, `resultado-${vista}.png`), Buffer.from(data, "base64"))).catch(() => {});
    } catch (e) {
      console.log(`  (se cortó: ${e.message})`);
    }
    await page.send("Page.close").catch(() => {});
    // El estadio: la demo con la ruleta, el show de verdad.
    page = await pagina(browser, vista, `${BASE}/?demo=wheel&lead=6&theme=dark`);
    try {
      await page.waitFor("document.getElementById('stadium').style.display === 'block'", 60000);
      await sleep(3000);
      const dom = JSON.parse(
        await page.eval(`JSON.stringify([...document.querySelectorAll('#stadium .st-top *, #stadium .commentary')].filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => ({ donde: e.id ? '#' + e.id : e.className, px: parseFloat(getComputedStyle(e).fontSize), texto: e.textContent.trim().slice(0, 40), alto: innerHeight, vis: getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.05 })))`),
      );
      console.log("  estadio (DOM):");
      for (const d of dom) console.log(`     ${String(d.px).padStart(5)} px (${((d.px / d.alto) * 100).toFixed(1)} % del alto) vis=${d.vis} ${d.donde} «${d.texto}»`);
      resultado.push({ paso: "estadio (DOM)", dom });
      await page.send("Page.captureScreenshot", { format: "png" }).then(({ data }) => writeFileSync(join(OUT, `estadio-${vista}.png`), Buffer.from(data, "base64"))).catch(() => {});
    } catch (e) {
      console.log(`  (el estadio no arrancó: ${e.message})`);
    }
    await page.send("Page.close").catch(() => {});
    writeFileSync(join(OUT, `inventario-${vista}.json`), JSON.stringify(resultado, null, 1));
  }
} finally {
  await browser.close();
}
