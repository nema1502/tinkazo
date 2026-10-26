#!/usr/bin/env node
/**
 * El auditor de legibilidad: ¿se lee desde el fondo de la sala y en el celular?
 *
 * Nicolás, 25 de octubre de 2026: "tiene mucha letra chiquita y media fea;
 * cuando estás proyectando se ve feo, igual en celular". Esto mide el tamaño de
 * cada texto visible, en píxeles de pantalla, y falla por cada uno que queda
 * debajo de la regla (`scripts/lib/legible.mjs`):
 *
 *   proyector 1920×1080: 28 px lo secundario, 48 px lo principal
 *   celular    390×844:  16 px lo secundario, 22 px lo principal
 *   herramienta:         16 px lo secundario, 22 px lo principal
 *
 * El proyector es lo que mira la sala (el estadio y el nombre del ganador); la
 * herramienta es la página de quien organiza, en cualquiera de los dos tamaños:
 * el barrido de letra dice que "lo que mira la sala se mide con 28/48 a 1920 y
 * 16/22 a 390; la herramienta, con 16/22". Principal es lo que se lee primero
 * (títulos, el botón de la acción, el nombre del ganador, el cartel del
 * estadio). La regla se cambia con
 * `--reglas proyector=28:48,celular=16:22,herramienta=16:22`.
 *
 * Qué recorre, en los dos tamaños y los dos temas:
 *
 *  - **Los pasos del sorteo**, con el DOM: la herramienta al abrir (la lista) y
 *    un sorteo de demostración (`?demo=wheel&instant=1&lead=3`, con drand de
 *    verdad) en los pasos que se alcanzan a ver: sellada y esperando, ronda
 *    lista y resultado. Cada texto con su tamaño de CSS por la escala con que
 *    se dibuja. Los textos que comparten selector y tamaño son una sola falla
 *    (el pie son cuarenta enlaces con el mismo estilo), con la cuenta.
 *  - **El estadio de cada juego** (`?pose=<juego>`, sin red): con el reloj en
 *    turbo, cada 16 cuadros mira los textos que dibuja Pixi (por el gancho
 *    `window.__PIXI_APP_INIT__`, como `audit-pantalla.mjs`) y los del DOM del
 *    estadio (subtítulos, marcador). De cada texto del lienzo se juzga la
 *    mediana de su tamaño mientras estuvo a la vista, no el instante de entrar
 *    o salir. El cartel del ganador es lo principal; nombres, marcador y
 *    escena, lo secundario.
 *
 * Capturas recortadas en `--out`, una por falla, hasta 12 por pantalla y 6 por
 * juego: del DOM con el protocolo de DevTools, y del lienzo con un recorte que
 * saca la propia página en el momento (el lienzo conserva el cuadro).
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-legible.mjs [juego|todos] [--base URL] [--out DIR] [--json]
 *       [--temas dark,light] [--tamanos proyector,celular] [--reglas …]
 *       [--sin-dom] [--sin-estadio] [--demo wheel] [--max-grupos 25]
 *
 * Sale con código 1 si algún texto queda bajo la regla. Necesita drand para el
 * sorteo de demostración (o `--sin-dom`). Pensado para menos de 4 minutos por tema.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { SELECTOR } from "./lib/juegos.mjs";
import { FACTOR_MAYUSCULAS, archivoDe, agruparEstadio, escanearDom, estadoDelSorteo, evaluarDom, evaluarEstadio, llamar, preludioEstadio, reglasDe } from "./lib/legible.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const flag = (n) => args.includes(n);
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? SELECTOR : cual.split(",");
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas/legible");
const reglas = reglasDe(opt("--reglas", ""));
const tamanos = opt("--tamanos", "proyector,celular")
  .split(",")
  .filter(Boolean)
  .map((n) => {
    if (!reglas[n]) {
      console.error(`uso: --tamanos proyector,celular (no existe «${n}»)`);
      process.exit(2);
    }
    return reglas[n];
  });
const temas = opt("--temas", "dark,light").split(",").filter(Boolean);
const sinDom = flag("--sin-dom");
const sinEstadio = flag("--sin-estadio");
const demo = opt("--demo", "wheel");
const MAX_GRUPOS = Number(opt("--max-grupos", "25"));
const MAX_CAPTURAS = 12;
const MAX_CAPTURAS_JUEGO = 6;
process.env.TINKAZO_GPU = "1";

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

const PASOS = { esperando: "sellada y esperando", ronda: "ronda lista", resultado: "resultado" };

/** Una pestaña al tamaño pedido, con lo que haya que inyectar antes de que cargue. */
async function abrir(browser, tamano, url, preludio = "") {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: tamano.ancho, height: tamano.alto, deviceScaleFactor: 1, mobile: tamano.celular, screenWidth: tamano.ancho, screenHeight: tamano.alto });
  if (preludio) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: preludio });
  await page.send("Page.navigate", { url });
  return page;
}

/** Recorte de una caja de la página, con aire alrededor. */
async function recortar(page, caja, archivo) {
  const pad = 14;
  const clip = { x: Math.max(0, caja.x - pad), y: Math.max(0, caja.y - pad), width: Math.max(8, caja.w + 2 * pad), height: Math.max(8, caja.h + 2 * pad), scale: 1 };
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
  await writeFile(join(outDir, archivo), Buffer.from(data, "base64"));
  return archivo;
}

/** Los textos de una pantalla del DOM contra la regla, con una captura por falla. */
async function juzgarDom(page, textos, pantalla, tamano, tema, { conCaptura = true, herramienta = true, presupuesto = { n: MAX_CAPTURAS } } = {}) {
  const { medidos, grupos } = evaluarDom(textos, tamano, herramienta ? reglas.herramienta : null);
  const donde = `${tamano.nombre} ${tema} · ${pantalla}`;
  if (!grupos.length) {
    check(`${donde}: ${medidos} textos, ninguno bajo la regla`, medidos > 0, medidos ? "" : "no se midió ningún texto");
    return;
  }
  for (const g of grupos.slice(0, MAX_GRUPOS)) {
    let captura = "";
    if (conCaptura && page && presupuesto.n > 0) {
      try {
        captura = ` · ${await recortar(page, g.caja, archivoDe("legible", tamano.nombre, tema, pantalla, g.ruta, `${Math.round(g.px)}px`))}`;
        presupuesto.n--;
      } catch {
        /* sin captura: la falla se informa igual */
      }
    }
    check(`${donde}: ${g.ruta} mide ${g.px.toFixed(1)} px y la regla pide ${g.minimo}${g.principal ? " (principal)" : ""}${g.herramienta ? " en la herramienta" : ""}${g.mayusculas ? ` (en mayúsculas vale ×${FACTOR_MAYUSCULAS})` : ""}`, false, `${g.textos.length} texto(s), p. ej. «${g.textos.slice(0, 2).join("», «")}»${captura}`);
  }
  if (grupos.length > MAX_GRUPOS) check(`${donde}: ${grupos.length - MAX_GRUPOS} grupos más bajo la regla`, false, "se corta en --max-grupos");
}

/** Los pasos del sorteo, con el DOM. */
async function pasosDom(browser, tamano, tema) {
  let page = await abrir(browser, tamano, `${base}/?theme=${tema}&lang=es`);
  await page.waitFor("document.readyState === 'complete'", 30_000);
  await sleep(900);
  await juzgarDom(page, JSON.parse(await page.eval(llamar(escanearDom, ""))), "inicio (la lista)", tamano, tema);
  await page.send("Page.close").catch(() => {});

  page = await abrir(browser, tamano, `${base}/?demo=${demo}&instant=1&lead=3&theme=${tema}&lang=es`);
  const hechos = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 90_000 && !hechos.has("resultado")) {
    const est = JSON.parse(await page.eval(llamar(estadoDelSorteo)));
    for (const paso of ["esperando", "ronda", "resultado"]) {
      if (!est[paso] || hechos.has(paso)) continue;
      await sleep(paso === "resultado" ? 800 : 250);
      hechos.add(paso);
      await juzgarDom(page, JSON.parse(await page.eval(llamar(escanearDom, ""))), PASOS[paso], tamano, tema);
    }
    await sleep(150);
  }
  if (!hechos.has("resultado")) check(`${tamano.nombre} ${tema} · el sorteo de demostración llega al resultado`, false, "no apareció el ganador en 90 s (¿sin drand?)");
  for (const paso of ["esperando", "ronda"]) if (!hechos.has(paso)) console.log(`    · el paso «${PASOS[paso]}» no se alcanzó a ver con ?instant=1`);
  await page.send("Page.close").catch(() => {});
}

/** El estadio de un juego: lo que dibuja Pixi y lo que le pone encima el DOM. */
async function estadio(browser, juego, tamano, tema) {
  const donde = `${tamano.nombre} ${tema} · ${juego}`;
  const page = await abrir(browser, tamano, `${base}/?pose=${juego}&motor=pixi&theme=${tema}&lang=es`, preludioEstadio({ principal: tamano.principal, secundario: tamano.secundario }));
  try {
    const listo = await page.waitFor("window.__app && getComputedStyle(document.getElementById('stadium')).display === 'block'", 60_000);
    if (!listo.ok) {
      check(`${donde}: el estadio aparece`, false, "no apareció en 60 s");
      return;
    }
    // El DOM del estadio mientras corre el show; las capturas, en el momento.
    const encima = [];
    const t0 = Date.now();
    let fin = false;
    while (!fin && Date.now() - t0 < 120_000) {
      encima.push(...JSON.parse(await page.eval(llamar(escanearDom, "#stadium"))));
      // El show terminó cuando el estadio, que se vio abierto, se cierra.
      fin = await page.eval("!!(window.__legible && window.__legible.vio && getComputedStyle(document.getElementById('stadium')).display !== 'block')");
      if (!fin) await sleep(300);
    }
    const r = JSON.parse(await page.eval("JSON.stringify({ textos: window.__legible.resumen(), muestras: window.__legible.muestras, errores: window.__legible.errores.slice(0, 3) })"));
    const lienzo = evaluarEstadio(r.textos, tamano);
    if (!lienzo.medidos) {
      check(`${donde}: se midió algún texto del lienzo`, false, `${r.muestras} muestras${r.errores.length ? ` · ${r.errores.join(" | ")}` : " (¿el juego no usa el motor nuevo?)"}`);
    } else if (!lienzo.malos.length) {
      check(`${donde}: ${lienzo.medidos} textos del lienzo, ninguno bajo la regla`, true);
    } else {
      let capturas = 0;
      for (const g of agruparEstadio(lienzo.malos).slice(0, MAX_GRUPOS)) {
        let captura = "";
        if (g.recorte && capturas < MAX_CAPTURAS_JUEGO) {
          const archivo = archivoDe("legible", tamano.nombre, tema, juego, g.capa, `${Math.round(g.mediana)}px`);
          await writeFile(join(outDir, archivo), Buffer.from(g.recorte.split(",")[1], "base64"));
          captura = ` · ${archivo}`;
          capturas++;
        }
        check(`${donde}: ${g.textos.length} texto(s) de la capa ${g.capa} miden ${g.mediana.toFixed(1)} px y la regla pide ${g.minimo}`, false, `p. ej. «${g.textos.slice(0, 2).join("», «")}», hasta ${g.max.toFixed(1)} px${captura}`);
      }
    }
    // Los subtítulos y el marcador son para la sala: la regla del tamaño, no la de la herramienta.
    await juzgarDom(null, encima, `${juego} · subtítulos y marcador`, tamano, tema, { conCaptura: false, herramienta: false });
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}

await mkdir(outDir, { recursive: true });
const browser = await launch({ port: Number(process.env.CDP_PORT || 9501), width: 1920, height: 1080 });
try {
  for (const tema of temas) {
    for (const tamano of tamanos) {
      console.log(`\n${tamano.nombre} ${tamano.ancho}×${tamano.alto} · ${tema}`);
      if (!sinDom) {
        await pasosDom(browser, tamano, tema).catch((e) => check(`${tamano.nombre} ${tema} · los pasos del sorteo corrieron sin caerse`, false, String(e.message ?? e).slice(0, 200)));
      }
      if (!sinEstadio) {
        for (const juego of juegos) {
          await estadio(browser, juego, tamano, tema).catch((e) => check(`${tamano.nombre} ${tema} · ${juego}: la medición corrió sin caerse`, false, String(e.message ?? e).slice(0, 200)));
        }
      }
    }
  }
} finally {
  await browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones · capturas en ${outDir}`);
emitirJson({ auditor: "audit-legible", objetivo: cual, checks });
process.exit(malos.length ? 1 : 0);
