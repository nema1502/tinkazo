#!/usr/bin/env node
/**
 * El auditor del proyector lavado: ¿lo que hay que leer de la carrera se lee con la luz de la sala encendida?
 *
 * Un proyector pobre con luz en la sala sube el negro a un gris y apaga el resto (docs/motores.md, "La luz de la
 * carrera"). La página lo simula con `?lavado=1` (`contrast(0.6) brightness(1.1)` sobre el estadio: el negro puro queda
 * en 22 % de gris y el blanco en 88 %), solo para auditar. Este script lleva la carrera, con el reloj en turbo, a unos
 * momentos fijos, saca una captura de la pantalla (ya filtrada) y mide el contraste real, píxel por píxel, de:
 *
 *   - las fichas de nombre (la letra crema sobre su placa) en tres momentos de la carrera,
 *   - el cartel del ganador, a un segundo de que aparece,
 *   - la bandera a cuadros de la meta, en la cinta de arriba.
 *
 * en los dos motores (PixiJS y 3D), los dos temas, el proyector (1920x1080) y el celular (390x844), con y sin el lavado.
 *
 * Los umbrales (`UMBRALES` en `scripts/lib/contraste.mjs`, de WCAG 2.x), sin lavado / con lavado:
 *   cartel   7 / 4,5   La tinta de la marca sobre el amarillo da 11,2 a 1; pasada por el filtro, 4,9: con negro puro
 *                      no pasaría de 5,7, así que 7 a 1 no se puede pedir lavado. 4,5 es el AAA del texto grande
 *                      (el nombre mide 100 px o más en 1080).
 *   fichas   4,5 / 4,5  La letra de los nombres, AA.
 *   bandera  4,5 / 4,5  Los cuadros de tinta y blanco.
 *
 * De cada región se sacan los dos tonos (letra y fondo, por Otsu) y se compara la mediana de cada uno: la ficha es
 * translúcida sobre el piso, así que se mide lo que se ve y no lo que dice el código. Una ficha que otra capa tapa (la
 * cinta de arriba) no muestra su letra en la captura: se reconoce porque ninguno de sus dos tonos es el color de la letra,
 * no cuenta y se informa aparte. Hace falta que se vean al menos tres fichas por momento, y la bandera y el cartel tienen que aparecer: si no, falla (no se midió).
 *
 * Uso:
 *   pnpm preview &
 *   CDP_PORT=9780 node scripts/audit-lavado.mjs [--base URL] [--motor pixi,3d] [--temas dark,light]
 *       [--vistas 1920x1080,390x844] [--lavado sin,con] [--n 18] [--momentos 14,30,46] [--out DIR] [--json]
 *
 * Un solo Chrome a la vez, abierto por combinación y cerrado al terminar, y espera a que haya 1 GB de RAM libre antes de
 * abrirlo (hasta cinco veces, dos minutos cada una). Con `--out` deja una captura JPEG por momento y `contrastes.json` con todo lo medido.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { freemem } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { UMBRALES, contrasteDeRegion, decodificarPng, lavar, luminancia } from "./lib/contraste.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const lista = (n, d) => opt(n, d).split(",").filter(Boolean);
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const motores = lista("--motor", "pixi,3d");
const temas = lista("--temas", "dark,light");
const vistas = lista("--vistas", "1920x1080,390x844").map((v) => v.split("x").map(Number));
const lavados = lista("--lavado", "sin,con");
const n = Number(opt("--n", "18"));
const momentos = lista("--momentos", "14,30,46").map(Number);
const out = opt("--out", "");
// Las mismas rondas de la línea de base de la carrera (6 de noviembre de 2026): con 8, 18 y 60 personas.
const SEMILLAS = {
  8: "3c01004ec5a55f7abf222aec22b4daae70efc44620e5f0b731fc6cd8d3378d5e",
  18: "2fb8fcf9e55b371ccb26f0a270d900063ef52b7987a3381b8869279079cfe8d1",
  60: "e83b40816eb35cd58255de97abb27d18b98c012fbd3af07e4adb7c69af4d5e2a",
};
const semilla = opt("--semilla", SEMILLAS[n] ?? SEMILLAS[18]);
const TURBO = 8;
process.env.TINKAZO_GPU = "1";
if (out) mkdirSync(out, { recursive: true });

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const medidas = [];

/** Espera a que haya RAM libre antes de abrir Chrome: hasta cinco veces, dos minutos cada una. */
async function esperarRam(minimoGb = 1.0) {
  for (let i = 0; i < 5; i++) {
    const libre = freemem() / 2 ** 30;
    if (libre >= minimoGb) return;
    console.log(`  (RAM libre ${libre.toFixed(2)} GB, menos de ${minimoGb}: espero dos minutos)`);
    await sleep(120_000);
  }
}

/** Se inyecta antes de la página: el reloj de la página es virtual (1/64 s por cuadro, `TURBO` cuadros por vuelta) y se detiene donde se le pide. */
const PRELUDIO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  const STEP = 1000 / 64;
  let virt = 0, id = 0, v0 = -1;
  const cbs = new Map();
  window.__app = null;
  window.__PIXI_APP_INIT__ = (app) => { window.__app = app; };
  window.__ctl = { lista: false, hasta: 0, t: 0, cerro: false, abrio: false };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    const st = document.getElementById('stadium');
    if (v0 < 0 && st && st.style.display === 'block') { v0 = virt; window.__ctl.abrio = true; }
    if (v0 >= 0 && st && st.style.display !== 'block') window.__ctl.cerro = true;
    for (let i = 0; i < ${TURBO}; i++) {
      if (v0 >= 0 && (virt - v0) >= window.__ctl.hasta) { window.__ctl.lista = true; break; }
      if (!cbs.size) break;
      const lote = [...cbs.values()];
      cbs.clear();
      virt += STEP;
      for (const cb of lote) { try { cb(virt); } catch (e) { console.error(e); } }
      if (v0 >= 0 && !window.__ctl.cerro) window.__ctl.t = (virt - v0) / 1000;
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

/** Lo que mira la página en el momento: las fichas de nombre, lo que hay en el cartel del ganador y la bandera de la meta. */
function mirar() {
  const app = window.__app;
  const salida = { t: window.__ctl.t, w: innerWidth, h: innerHeight, fichas: [], cartel: [], bandera: null, nodos: 0, tres: !!document.getElementById("tres-canvas") };
  if (!app || !app.stage) return JSON.stringify(salida);
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nombres = new Set(((window.__pose && window.__pose.names) || []).map((x) => norm(x).split(" ")[0]).filter((x) => x.length >= 3));
  const hijos = app.stage.children;
  const podio = hijos[hijos.length - 1];
  const visitar = (nodo, alfa, enPodio) => {
    if (!nodo.visible || !nodo.renderable) return;
    const a = alfa * nodo.alpha;
    if (a < 0.95) return;
    salida.nodos++;
    if (typeof nodo.text === "string" && nodo.style) {
      const s = nodo.text.trim();
      const wt = nodo.worldTransform;
      const px = (parseFloat(nodo.style.fontSize) || 0) * Math.hypot(wt.a, wt.b);
      const b = nodo.getBounds();
      const fill = typeof nodo.style.fill === "number" ? nodo.style.fill : null;
      const caja = { s: s.slice(0, 40), px: Math.round(px * 10) / 10, x: b.x, y: b.y, w: b.width, h: b.height, fill };
      const adentro = caja.x >= 0 && caja.y >= 0 && caja.x + caja.w <= innerWidth && caja.y + caja.h <= innerHeight;
      if (enPodio) {
        if (px >= 24 && adentro && s.length >= 2) salida.cartel.push(caja);
      } else if (s.length >= 3 && px >= 9 && adentro && nombres.has(norm(s).split(" ")[0])) salida.fichas.push(caja);
    }
    for (const h of nodo.children || []) visitar(h, a, enPodio);
  };
  for (const h of hijos) visitar(h, 1, h === podio);
  const cv = document.getElementById("pixi-canvas");
  if (cv && cv.dataset.bandera) {
    const [x, y, w, h] = cv.dataset.bandera.split(",").map(Number);
    salida.bandera = { x, y, w, h };
  }
  return JSON.stringify(salida);
}

/**
 * El corazón de una caja de texto: sin el borde de arriba y de abajo ni los costados. La caja de un texto de PixiJS
 * llega más allá de la ficha que lo rodea (el contorno de la letra suma aire), y ese pedazo de piso o de cielo, claro,
 * entraba como un tercer tono y bajaba el contraste medido de la letra.
 */
const nucleo = (r, fx = 0.06, fy = 0.16) => ({ x: r.x + r.w * fx, y: r.y + r.h * fy, w: r.w * (1 - 2 * fx), h: r.h * (1 - 2 * fy) });

/**
 * ¿Se ve en la captura el color de la letra de esta ficha? La región tiene dos tonos y uno es el de la letra (con el filtro del lavado
 * si está puesto), con una tolerancia de 0,12 de luminancia. Si ninguno lo es, otra capa tapa la ficha en la pantalla.
 */
function letraVisible(f, lav) {
  if (f.fill === null || f.fill === undefined || !f.dosTonos) return f.dosTonos !== false;
  const c = [(f.fill >> 16) & 255, (f.fill >> 8) & 255, f.fill & 255];
  const esperada = luminancia(...(lav === "con" ? lavar(c) : c));
  return Math.min(Math.abs(f.claro - esperada), Math.abs(f.oscuro - esperada)) <= 0.12;
}

async function irA(page, segundos, plazoMs = 240_000) {
  await page.eval(`window.__ctl.lista = false; window.__ctl.hasta = ${Math.round(segundos * 1000)}`);
  const t0 = Date.now();
  while (Date.now() - t0 < plazoMs) {
    let r = null;
    try {
      r = JSON.parse(await page.eval("JSON.stringify({l: window.__ctl.lista, c: window.__ctl.cerro, a: window.__ctl.abrio})", 8000));
    } catch {
      /* la página puede estar navegando */
    }
    if (r?.l && r.a) return true;
    if (r?.c) return false;
    await sleep(100);
  }
  return false;
}

/** La captura del momento, con la pantalla tal cual (ya filtrada si es `con`). */
async function capturar(page, archivo) {
  await sleep(160);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  const img = decodificarPng(Buffer.from(data, "base64"));
  if (out && archivo) {
    const j = await page.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    writeFileSync(join(out, `${archivo}.jpg`), Buffer.from(j.data, "base64"));
  }
  return img;
}

async function combinacion(motor, tema, [w, h], lav, ultimoIntento = true) {
  const celular = w < 600;
  const nombre = `${motor} ${tema} ${w}x${h} ${lav === "con" ? "lavado" : "sin lavado"}`;
  const clave = `${motor}-${tema}-${w}x${h}-${lav === "con" ? "lavado" : "normal"}`;
  console.log(`\n${nombre}`);
  const url = `${base}/?pose=1&n=${n}&semilla=${semilla}&ganador=${semilla}&theme=${tema}&motor=${motor}&lang=es${lav === "con" ? "&lavado=1" : ""}`;
  // Un Chrome por combinación, y cerrado al terminar: a partir de la segunda página de un mismo Chrome el 3D no
  // conseguía su contexto de WebGL y la carrera caía al 2D (lo que, además, ahorra memoria entre una y otra).
  await esperarRam();
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9780), width: w, height: h });
  let page = null;
  let repetir = false;
  const m = { combinacion: nombre, fichas: [], tapadas: [], cartel: null, bandera: null };
  try {
    page = await browser.open("about:blank");
    await page.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: celular, screenWidth: w, screenHeight: h });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO });
    await page.send("Page.navigate", { url });
    const listo = await page.waitFor("window.__ctl", 30_000);
    if (!listo.ok) throw new Error("la página no arrancó");
    const U = (que) => UMBRALES[que][lav];

    // Las fichas, bandera incluida, en cada momento de la carrera.
    for (const seg of momentos) {
      if (!(await irA(page, seg))) {
        check(`${nombre}: la carrera llega a los ${seg} s`, false, "el estadio se cerró antes");
        continue;
      }
      const vio = JSON.parse(await page.eval(`(${mirar.toString()})()`));
      // Con `--motor 3d` tiene que estar el lienzo del 3D: si el equipo no dio WebGL la carrera cae al 2D y lo medido no sería lo pedido.
      if (vio.tres !== (motor === "3d")) {
        if (!ultimoIntento) {
          repetir = true;
          return "reintentar";
        }
        check(`${nombre}: la escena es la del motor pedido`, false, motor === "3d" ? "el 3D no arrancó y la carrera cayó al 2D (¿sin WebGL?)" : "apareció el 3D con --motor pixi");
        return;
      }
      const img = await capturar(page, `${clave}-${String(seg).padStart(2, "0")}s`);
      const todas = vio.fichas.map((f) => ({ ...f, ...contrasteDeRegion(img, nucleo(f)) }));
      // Una ficha que otra capa tapa (la cinta de arriba, el relator) sigue «a la vista» para PixiJS pero en la captura no está su letra:
      // se cuenta aparte, y se mide solo la que muestra su color de letra.
      const tapadas = todas.filter((f) => !letraVisible(f, lav));
      const medidas3 = todas.filter((f) => letraVisible(f, lav));
      m.tapadas.push(...tapadas.map((f) => ({ t: vio.t, s: f.s })));
      m.fichas.push(...medidas3.map((f) => ({ t: vio.t, s: f.s, razon: f.razon, dosTonos: f.dosTonos })));
      if (vio.bandera && !m.bandera) {
        const b = contrasteDeRegion(img, vio.bandera);
        m.bandera = { razon: b.razon, dosTonos: b.dosTonos, region: vio.bandera };
      }
      if (medidas3.length < 3) check(`${nombre}: a los ${seg} s se ven al menos tres fichas de nombre`, false, `se vieron ${medidas3.length}`);
    }

    // El cartel: se avanza de medio en medio segundo hasta que aparece y se mide un segundo después.
    let visto = false;
    for (let seg = Math.max(...momentos) + 4; seg <= 110 && !visto; seg += 0.5) {
      if (!(await irA(page, seg))) break;
      const v = JSON.parse(await page.eval(`(${mirar.toString()})()`));
      if (!v.cartel.length) continue;
      visto = true;
      await irA(page, seg + 1);
      const vio = JSON.parse(await page.eval(`(${mirar.toString()})()`));
      const img = await capturar(page, `${clave}-cartel`);
      const cs = vio.cartel.map((c) => ({ ...c, ...contrasteDeRegion(img, nucleo(c)) }));
      const peor = cs.reduce((a, c) => (c.razon < a.razon ? c : a), cs[0] ?? { razon: 0, s: "" });
      m.cartel = { t: vio.t, textos: cs.map((c) => ({ s: c.s, px: c.px, razon: c.razon, dosTonos: c.dosTonos })), peor: { s: peor.s, razon: peor.razon } };
    }
    if (page.exceptions.length) check(`${nombre}: sin excepciones en la página`, false, page.exceptions[0].slice(0, 160));

    // Veredictos.
    const fichas = m.fichas.filter((f) => f.razon >= 0);
    if (fichas.length >= 3) {
      const peor = fichas.reduce((a, f) => (f.razon < a.razon ? f : a), fichas[0]);
      const sinTonos = fichas.filter((f) => !f.dosTonos).length;
      check(`${nombre}: ${fichas.length} fichas de nombre, la peor a ${peor.razon.toFixed(2)} a 1 (pide ${U("fichas")})`, peor.razon >= U("fichas"), `«${peor.s}» a los ${peor.t.toFixed(0)} s${sinTonos ? ` · ${sinTonos} sin dos tonos` : ""}${m.tapadas.length ? ` · ${m.tapadas.length} tapadas por otra capa (no cuentan): ${[...new Set(m.tapadas.map((x) => x.s))].slice(0, 4).join(", ")}` : ""}`);
    } else check(`${nombre}: se midieron fichas de nombre`, false, `solo ${fichas.length}`);
    if (m.cartel) check(`${nombre}: el cartel del ganador está a ${m.cartel.peor.razon.toFixed(2)} a 1 (pide ${U("cartel")})`, m.cartel.peor.razon >= U("cartel"), `«${m.cartel.peor.s}» a los ${m.cartel.t.toFixed(1)} s`);
    else check(`${nombre}: aparece el cartel del ganador`, false, "no se vio antes de los 110 s");
    if (m.bandera) check(`${nombre}: la bandera de la meta está a ${m.bandera.razon.toFixed(2)} a 1 (pide ${U("bandera")})`, m.bandera.dosTonos && m.bandera.razon >= U("bandera"), m.bandera.dosTonos ? "" : "no se distinguen dos tonos");
    else check(`${nombre}: se encuentra la bandera de la meta`, false, "la escena no dejó su marca (`data-bandera`)");
  } catch (e) {
    check(`${nombre}: la medición corrió sin caerse`, false, String(e.message ?? e).slice(0, 200));
  } finally {
    if (!repetir) medidas.push(m);
    await page?.send("Page.close").catch(() => {});
    await browser.close();
  }
}

// A veces el 3D no consigue su contexto de WebGL (la placa de video, ocupada): se repite con otro Chrome, hasta tres veces, antes de fallar.
for (const motor of motores) for (const tema of temas) for (const vista of vistas) for (const lav of lavados) {
  for (let intento = 0; intento < 3; intento++) if ((await combinacion(motor, tema, vista, lav, intento === 2)) !== "reintentar") break;
}
if (out) {
  // Si ya había un `contrastes.json` (una corrida parcial sobre la misma carpeta), se conserva lo que esta no repitió.
  let previas = [];
  try {
    previas = JSON.parse(readFileSync(join(out, "contrastes.json"), "utf8")).medidas ?? [];
  } catch {
    /* primera corrida */
  }
  const repetidas = new Set(medidas.map((x) => x.combinacion));
  writeFileSync(join(out, "contrastes.json"), JSON.stringify({ n, semilla, momentos, umbrales: UMBRALES, medidas: [...previas.filter((x) => !repetidas.has(x.combinacion)), ...medidas] }, null, 1));
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones${out ? ` · capturas en ${out}` : ""}`);
emitirJson({ auditor: "audit-lavado", objetivo: `${motores.join("+")} ${temas.join("+")}`, checks });
process.exit(malos.length ? 1 : 0);
