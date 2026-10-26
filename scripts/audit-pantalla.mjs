#!/usr/bin/env node
/**
 * El auditor de pantalla: cómo se ve el show en una pantalla grande, en Zoom y
 * en una pantalla compartida.
 *
 * Lo que mide, por juego, con el reloj cambiado (un cuadro de juego por cuadro
 * real, como `audit-rigor.mjs`, así que no depende de la máquina):
 *
 * - **Destellos** (WCAG 2.3.1): cuántos cambios fuertes de luminosidad caen en
 *   un segundo. Más de tres por segundo es un riesgo para quien tiene
 *   epilepsia fotosensible. Se mide la luminosidad de toda la pantalla, así que
 *   es una medida conservadora.
 * - **Texto**: el tamaño de los nombres, de las demás etiquetas y del cartel
 *   del ganador, en píxeles de pantalla. Para cada cuadro se toma el texto más
 *   chico que se ve; después se informa la mediana y el percentil 10 de esos
 *   cuadros, así un texto que aparece un instante no cuenta como el tamaño del
 *   juego. Y el contraste de cada texto contra lo que tiene detrás: tiene que
 *   pasar 4,5 a 1, o llevar un contorno oscuro.
 * - **Líneas**: el grosor de los trazos, con la misma mediana y el mismo
 *   percentil. Con menos de dos píxeles de alto en 720, Zoom los pierde.
 * - **Capturas**: la pantalla con el cartel, en cada resolución, y con
 *   `--clip` un tramo de video alrededor del golpe, comprimido como lo haría
 *   Zoom (960×540, libx264 a 1,5 Mbps), y el cuadro del golpe.
 *
 * Uso:
 *   pnpm build && pnpm preview --port 4606 --strictPort &
 *   node scripts/audit-pantalla.mjs <juego|todos> --base http://localhost:4606
 *       [--res 1280x720,1920x1080] [--temas dark,light] [--out DIR] [--clip] [--compartir] [--semilla HEX]
 *
 * `--compartir` mide con el modo para compartir prendido (ver `state.ts`).
 * `--temas` mide en esos temas (`?theme=`); sin él, en el del navegador, que
 * en Chrome sin interfaz es el claro.
 *
 * Desde el 25 de octubre de 2026 este auditor también corre como un grupo de
 * `audit-rigor.mjs` (misma corrida, mismo Chrome, mismas comprobaciones), y la
 * batería (`pnpm audit:todo`) lo pide ahí. Este archivo sigue sirviendo solo,
 * con más resoluciones, temas, `--clip` y `--compartir`.
 *
 * Sale con código 0 si ningún juego tiene más de tres destellos por segundo ni
 * un texto sin contraste ni contorno, y con 1 si los tiene.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launch } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";
import { comprobacionesDePantalla } from "./lib/pantalla-comprobaciones.mjs";
import { SELECTOR as TODOS } from "./lib/juegos.mjs";

/** Los nombres de la escena fija (`?pose=`), para reconocer los que se ven como nombres. */
const NOMBRES = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const flag = (name) => args.includes(name);
// Uno o varios juegos, separados por espacio; "todos" son los diez del selector (con El Trueque, que antes se salteaba).
const pedidos = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const juegos = pedidos.length === 0 || pedidos.includes("todos") ? TODOS : pedidos;
const base = opt("--base", "http://localhost:4606").replace(/\/$/, "");
const outDir = opt("--out", join(tmpdir(), "tinkazo-pantalla"));
const resoluciones = opt("--res", "1280x720").split(",").map((r) => r.split("x").map(Number));
const clip = flag("--clip");
const compartir = flag("--compartir");
const temas = opt("--temas", "").split(",").filter(Boolean);
const semilla = opt("--semilla", createHash("sha256").update("pantalla-1").digest("hex"));
// El motor nuevo usa la placa de video, como en el resto de los auditores.
process.env.TINKAZO_GPU = "1";

/** Un cuadro de juego: 1/64 s, exacto en binario, como en `audit-rigor.mjs`. */
const PASO = 1000 / 64;
/** Cuánto juego se mira después del golpe, en cuadros: el cartel dura unos 3,5 s. */
const COLA = 4 * 64;
/** Cuándo se miran los contrastes además del golpe: a los 10, 20 y 30 s de juego. */
const MIRAS = [640, 1280, 1920];
/** Cuántos cuadros después del golpe el cartel ya terminó de entrar (unos 0,6 + 0,9 s). */
const CARTEL_LISTO = 2 * 64;

/**
 * Antes de que cargue la página: el reloj se cambia, la escena de Pixi queda a
 * mano (`window.__app`, por el gancho que PixiJS llama al arrancar) y los
 * cuadros avanzan solo cuando el auditor los pide.
 */
const PRELUDIO = `(() => {
  let virt = 0, id = 0;
  const cbs = new Map();
  window.__app = null;
  window.__errores = [];
  window.__PIXI_APP_INIT__ = (app) => { window.__app = app; };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const cuadro = () => {
    const lote = [...cbs.values()];
    cbs.clear();
    virt += ${PASO};
    for (const cb of lote) { try { cb(virt); } catch (e) { window.__errores.push(String(e && e.stack || e)); } }
  };
  // La luminosidad relativa media de la pantalla, en una malla de 64 × 36.
  const mini = document.createElement('canvas');
  mini.width = 64; mini.height = 36;
  const mc = mini.getContext('2d', { willReadFrequently: true });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luz = () => {
    const cv = document.getElementById('pixi-canvas');
    if (!cv || !cv.width) return -1;
    mc.clearRect(0, 0, 64, 36);
    mc.drawImage(cv, 0, 0, 64, 36);
    const d = mc.getImageData(0, 0, 64, 36).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return s / (d.length / 4);
  };
  // Avanza n cuadros y devuelve la luminosidad de cada uno.
  window.__avanzar = async (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      cuadro();
      out.push(luz());
      await null;
    }
    return out;
  };
})()`;

/** Lo que hay en la escena ahora: textos, trazos y el cartel del ganador. */
const MEDIR = `(() => {
  const app = window.__app;
  if (!app || !app.stage) return null;
  const NOMBRES = ${JSON.stringify(NOMBRES)};
  const esNombre = (s) => NOMBRES.some((n) => n === s || (s.endsWith('…') && n.startsWith(s.slice(0, -1))) || (/^\\S+ \\S\\.$/.test(s) && n.startsWith(s.slice(0, -2))));
  const hex = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const m = /^#?([0-9a-f]{6})$/i.exec(v.trim()); return m ? parseInt(m[1], 16) : null; }
    return null;
  };
  const textos = [], trazos = [];
  const oscuro = (c) => {
    if (c === null) return false;
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255) < 0.12;
  };
  const podio = app.stage.children[4];
  const visit = (node, enPodio, alfaPadre) => {
    if (!node.visible || !node.renderable) return;
    const a = alfaPadre * node.alpha;
    if (a < 0.05) return;
    const wt = node.worldTransform;
    const escala = Math.hypot(wt.a, wt.b) || 1;
    if (typeof node.text === 'string' && node.style) {
      const b = node.getBounds();
      const st = node.style;
      textos.push({
        s: node.text.slice(0, 40), px: (st.fontSize || 0) * escala, a,
        box: [b.x, b.y, b.width, b.height],
        fill: hex(st.fill),
        // Un contorno cuenta solo si es oscuro: luminosidad relativa por debajo de 0,12.
        contorno: !!st.stroke && (st.stroke.width || 0) * escala >= 1.5 && oscuro(hex(st.stroke.color ?? st.stroke)),
        plato: enPodio,
        nombre: esNombre(node.text),
      });
    }
    if (node.context && Array.isArray(node.context.instructions)) {
      const b = node.getBounds();
      for (const ins of node.context.instructions) {
        if (ins.action === 'stroke' && ins.data && ins.data.style) {
          trazos.push({ w: (ins.data.style.width || 1) * escala, a, box: [b.x, b.y, b.width, b.height] });
        }
      }
    }
    for (const ch of node.children || []) visit(ch, enPodio || node === podio, a);
  };
  for (const ch of app.stage.children) visit(ch, ch === podio, 1);
  const cv = document.getElementById('pixi-canvas');
  return { textos, trazos, cartel: cv ? cv.dataset.cartel || '' : '' };
})()`;

/** El contraste de cada texto contra el anillo de píxeles que lo rodea. */
const CONTRASTE = (textos) => `(() => {
  const cv = document.getElementById('pixi-canvas');
  if (!cv) return [];
  const c2 = document.createElement('canvas');
  c2.width = cv.width; c2.height = cv.height;
  const g = c2.getContext('2d', { willReadFrequently: true });
  g.drawImage(cv, 0, 0);
  const W = cv.width, H = cv.height;
  const d = g.getImageData(0, 0, W, H).data;
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lumPx = (i) => 0.2126 * f(d[i]) + 0.7152 * f(d[i + 1]) + 0.0722 * f(d[i + 2]);
  const lumC = (c) => 0.2126 * f((c >> 16) & 255) + 0.7152 * f((c >> 8) & 255) + 0.0722 * f(c & 255);
  return ${textos}.map((t) => {
    if (t.fill === null || t.box[2] < 2 || t.box[3] < 2) return { ...t, ratio: null };
    const x0 = Math.max(0, Math.floor(t.box[0]) - 3), y0 = Math.max(0, Math.floor(t.box[1]) - 3);
    const x1 = Math.min(W - 1, Math.ceil(t.box[0] + t.box[2]) + 3), y1 = Math.min(H - 1, Math.ceil(t.box[1] + t.box[3]) + 3);
    // La mediana del anillo: el fondo en que el texto está, sin el borde oscuro
    // de una etiqueta (que pesa en un anillo de 3 píxeles y bajaba el contraste).
    const anillo = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dentro = x >= t.box[0] && x <= t.box[0] + t.box[2] && y >= t.box[1] && y <= t.box[1] + t.box[3];
        if (dentro) continue;
        anillo.push(lumPx((y * W + x) * 4));
      }
    }
    if (!anillo.length) return { ...t, ratio: null };
    anillo.sort((a, b) => a - b);
    const fg = lumC(t.fill), bg = anillo[anillo.length >> 1];
    return { ...t, bg, ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05) };
  });
})()`;

/**
 * Los destellos de una serie de luminosidades (una por cuadro de 1/64 s).
 *
 * Se buscan los giros de la curva, con un umbral de ruido de 0,005. Un destello
 * es dos tramos seguidos, uno para arriba y otro para abajo (o al revés), de al
 * menos 0,10 de luminosidad relativa cada uno, con el nivel más oscuro por
 * debajo de 0,8. Como en WCAG 2.3.1, si el área que destella es chica esto
 * exagera: es una medida de toda la pantalla.
 */
export function destellos(serie, hz = 64) {
  const ruido = 0.005;
  const s = serie.map((v, i, a) => (a[Math.max(0, i - 1)] + v + a[Math.min(a.length - 1, i + 1)]) / 3);
  if (s.length < 3) return { destellos: 0, peorPorSegundo: 0 };
  const giros = [];
  let hi = s[0], iHi = 0, lo = s[0], iLo = 0, sube = null;
  for (let i = 1; i < s.length; i++) {
    const v = s[i];
    if (sube === null) {
      if (v > s[0] + ruido) { sube = true; hi = v; iHi = i; }
      else if (v < s[0] - ruido) { sube = false; lo = v; iLo = i; }
      continue;
    }
    if (sube) {
      if (v > hi) { hi = v; iHi = i; }
      if (v < hi - ruido) { giros.push({ i: iHi, v: hi }); sube = false; lo = v; iLo = i; }
    } else {
      if (v < lo) { lo = v; iLo = i; }
      if (v > lo + ruido) { giros.push({ i: iLo, v: lo }); sube = true; hi = v; iHi = i; }
    }
  }
  const en = [];
  for (let k = 0; k + 2 < giros.length; k++) {
    const a = giros[k], b = giros[k + 1], c = giros[k + 2];
    const t1 = Math.abs(b.v - a.v), t2 = Math.abs(c.v - b.v);
    const oscuro = Math.min(a.v, b.v, c.v);
    if (t1 >= 0.1 && t2 >= 0.1 && oscuro < 0.8) {
      en.push(b.i);
      k++;
    }
  }
  let peor = 0;
  for (const t of en) {
    const n = en.filter((u) => u >= t && u < t + hz).length;
    if (n > peor) peor = n;
  }
  return { destellos: en.length, peorPorSegundo: peor };
}

/** La mediana y el percentil 10 de una lista de medidas (null si no hay ninguna). */
const resumen = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const at = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  return { mediana: +at(0.5).toFixed(2), p10: +at(0.1).toFixed(2) };
};

/** Abre la página de un juego a un tamaño, con el reloj cambiado y el estadio listo. */
async function abrir(browser, juego, [W, H], tema = "") {
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false, screenWidth: W, screenHeight: H });
  const previo = compartir ? "try { sessionStorage.setItem('tinkazo.compartir', '1'); } catch (e) {}" : "";
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO + ";" + previo });
  await page.send("Page.navigate", { url: `${base}/?pose=${juego}&semilla=${semilla}&motor=pixi${tema ? `&theme=${tema}` : ""}` });
  const listo = await page.waitFor("window.__app && getComputedStyle(document.getElementById('stadium')).display === 'block'", 60_000);
  return listo.ok ? page : null;
}

/** Lo que ve la sala, cuarto de segundo a cuarto de segundo, hasta que cierra el juego. */
async function recorrer(page, alCartel = null) {
  const serie = [];
  const nombres = [], etiquetas = [], platos = [], lineas = [];
  const trazo = new Map();
  const contrastes = [];
  const mirasHechas = new Set();
  let cuadros = 0;
  let golpe = -1;
  let llamado = false;
  let hecho = false;
  const mirar = async () => {
    const m = JSON.parse((await page.eval(`JSON.stringify(${MEDIR})`)) || "null");
    if (!m) return null;
    const cartelListo = golpe >= 0 && cuadros - golpe >= CARTEL_LISTO;
    let nMin = Infinity, eMin = Infinity, pMin = Infinity, lMin = Infinity;
    for (const t of m.textos) {
      if (t.a < 0.5 || t.s.trim().length < 2) continue;
      if (t.plato) {
        if (cartelListo && t.px < pMin) pMin = t.px;
      } else if (t.nombre) {
        if (t.px < nMin) nMin = t.px;
      } else if (t.px < eMin) {
        eMin = t.px;
      }
    }
    for (const t of m.trazos) {
      if (t.a < 0.5) continue;
      if (t.w < lMin) lMin = t.w;
      if (t.w < 2) {
        const k = t.w.toFixed(2);
        const previo = trazo.get(k);
        trazo.set(k, previo ? { n: previo.n + 1, box: previo.box } : { n: 1, box: t.box.map((v) => Math.round(v)) });
      }
    }
    if (Number.isFinite(nMin)) nombres.push(nMin);
    if (Number.isFinite(eMin)) etiquetas.push(eMin);
    if (Number.isFinite(pMin)) platos.push(pMin);
    if (Number.isFinite(lMin)) lineas.push(lMin);
    return m;
  };
  const contrasteDe = async (m) => {
    const con = JSON.parse(await page.eval(`JSON.stringify(${CONTRASTE(JSON.stringify(m.textos.filter((t) => t.a >= 0.5)))})`));
    for (const t of con) if (t.ratio !== null && t.ratio !== undefined) contrastes.push({ s: t.s, ratio: +t.ratio.toFixed(2), contorno: t.contorno, px: +t.px.toFixed(1) });
  };
  for (let tramo = 0; tramo < 90 * 4 && !hecho; tramo++) {
    serie.push(...(await page.eval("window.__avanzar(16)")));
    cuadros += 16;
    const m = await mirar();
    if (m && golpe < 0 && m.cartel) {
      golpe = cuadros;
      await contrasteDe(m);
    }
    if (m) {
      for (const f of MIRAS) {
        if (cuadros >= f && !mirasHechas.has(f)) {
          mirasHechas.add(f);
          await contrasteDe(m);
        }
      }
    }
    if (golpe >= 0 && !llamado && cuadros >= golpe + 64 && alCartel) {
      llamado = true;
      await alCartel(page);
    }
    const visible = await page.eval("getComputedStyle(document.getElementById('stadium')).display === 'block'");
    if (!visible) hecho = true;
    if (golpe >= 0 && cuadros - golpe > COLA) hecho = true;
  }
  return {
    serie: serie.filter((v) => v >= 0),
    texto: { nombres: resumen(nombres), etiquetas: resumen(etiquetas), plato: resumen(platos) },
    trazo: { minimo: resumen(lineas), bajos: Object.fromEntries([...trazo].map(([k, v]) => [k, v.n])) },
    contrastes,
    golpe,
    cuadros,
  };
}

/** Una corrida de un juego en una resolución: medidas y la captura del cartel. */
export async function medirJuego(browser, juego, [W, H], tema = "") {
  const carpeta = join(outDir, `${juego}-${W}x${H}${tema ? `-${tema}` : ""}`);
  await mkdir(carpeta, { recursive: true });
  const page = await abrir(browser, juego, [W, H], tema);
  if (!page) return { juego, res: `${W}x${H}`, ...(tema ? { tema } : {}), ok: false, motivo: "el estadio no apareció" };
  const r = await recorrer(page, async (p) => {
    const { data } = await p.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(carpeta, "cartel.png"), Buffer.from(data, "base64"));
  });
  const errores = await page.eval("window.__errores.slice(0, 3)");
  await page.send("Page.close").catch(() => {});
  const dest = destellos(r.serie);
  const sinContorno = r.contrastes.filter((c) => c.ratio < 4.5 && !c.contorno);
  const peor = r.contrastes.reduce((a, c) => (c.ratio < a.ratio ? c : a), { ratio: Infinity, s: "" });
  if (clip && r.golpe >= 0) await clipCaptura(browser, juego, r.golpe, carpeta, tema);
  return {
    juego,
    res: `${W}x${H}`,
    ...(tema ? { tema } : {}),
    ok: true,
    cuadros: r.cuadros,
    golpeEnCuadro: r.golpe,
    destellos: dest,
    texto: r.texto,
    contraste: { peor: peor.ratio === Infinity ? null : peor, sinContorno: sinContorno.slice(0, 8), medidos: r.contrastes.length },
    trazo: r.trazo,
    errores,
  };
}

/**
 * El tramo de video del golpe. Es la misma corrida, reproducida: la escena es
 * reproducible, así que los cuadros caen igual. Se toma desde 1,5 s antes del
 * golpe hasta 2 s después, un cuadro de cada dos (31 por segundo).
 */
async function clipCaptura(browser, juego, detectado, carpeta, tema = "") {
  const fr = join(carpeta, "clip-cuadros");
  await rm(fr, { recursive: true, force: true });
  await mkdir(fr, { recursive: true });
  const page = await abrir(browser, juego, [1280, 720], tema);
  if (!page) return;
  // El cartel se anota 0,6 s después del golpe (ver `at` en stage.ts).
  const golpe = Math.max(0, detectado - 38);
  const desde = Math.max(0, golpe - 96);
  const hasta = golpe + 128;
  await page.eval(`window.__avanzar(${desde})`);
  let n = 0;
  for (let c = desde; c < hasta; c += 2) {
    await page.eval("window.__avanzar(2)");
    const { data } = await page.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(fr, `f${String(n).padStart(4, "0")}.png`), Buffer.from(data, "base64"));
    n++;
  }
  await page.send("Page.close").catch(() => {});
  const mp4 = join(carpeta, "zoom-clip.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "31.25", "-i", join(fr, "f%04d.png"), "-vf", "scale=960:540:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-b:v", "1500k", "-maxrate", "1500k", "-bufsize", "3000k", "-pix_fmt", "yuv420p", mp4]);
  const idx = Math.round((golpe - desde) / 2);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", `select=eq(n\\,${idx})`, "-frames:v", "1", join(carpeta, "zoom-golpe.png")]);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9946), width: 1280, height: 720 });
  const resultados = [];
  try {
    for (const juego of juegos) {
      for (const tema of temas.length ? temas : [""]) {
        for (const res of resoluciones) {
          const r = await medirJuego(browser, juego, res, tema);
          resultados.push(r);
          console.log(JSON.stringify(r));
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(outDir, "resumen.json"), JSON.stringify(resultados, null, 2));
  const malos = resultados.filter((r) => !r.ok || r.destellos?.peorPorSegundo > 3 || (r.contraste?.sinContorno?.length ?? 0) > 0);
  console.log(`\n${malos.length ? "CON HALLAZGOS" : "SIN HALLAZGOS"}: ${resultados.length - malos.length}/${resultados.length} sin problemas`);
  emitirJson({ auditor: "audit-pantalla", objetivo: pedidos.length === 0 || pedidos.includes("todos") ? "todos" : juegos.join(","), checks: resultados.flatMap(comprobacionesDePantalla) });
  process.exit(malos.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
