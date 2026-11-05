#!/usr/bin/env node
/**
 * Los clips verticales para creadores: el mejor momento de cada juego, 1080 por 1920,
 * sin música y sin la interfaz del sitio. El show es determinista, así que se dibuja
 * cuadro por cuadro con un reloj cambiado (reloj-virtual.js) y se codifica con ffmpeg.
 *
 *   node scripts/marca/videos/grabar-clips.mjs mapa <juego> [--semilla <64 hex>]
 *       Recorre todo el show y deja una hoja de contacto (un cuadro por segundo) y la línea de
 *       tiempo (cuándo sale el cartel, qué dice el relator) para elegir la ventana.
 *   node scripts/marca/videos/grabar-clips.mjs foto <juego> --seg <segundo>
 *       Un solo cuadro (PNG) del segundo pedido, para mirar cómo cae el diseño.
 *   node scripts/marca/videos/grabar-clips.mjs clip <juego|todos>
 *       Graba la ventana de ventanas.json y deja dos mp4 en la carpeta de salida: el clip, que termina con un
 *       segundo quieto del cartel del ganador, y la versión -bucle, con el final fundido en el principio.
 *
 * Los videos NO van al repositorio: la salida es una carpeta privada (--salida <carpeta> o la variable
 * KIT_VIDEOS_DIR). Hace falta el sitio sirviéndose (pnpm preview) y ffmpeg.
 * Opciones: --base http://localhost:4173  --puerto 9819  --salida <carpeta>
 *           --css <ancho>   ancho de la pantalla del celular en px de CSS (540 por defecto; el cuadro sigue siendo 1080 x 1920)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..", "..");
const { carpetaDeSalida } = await import("./salida.mjs");
const { launch, sleep } = await import(pathToFileURL(join(REPO, "scripts/lib/browser.mjs")).href);

const args = process.argv.slice(2);
const modo = args[0];
const cual = args[1];
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const BASE = opt("base", "http://localhost:4173");
const PUERTO = Number(opt("puerto", "9819"));
const SALIDA = carpetaDeSalida(args);
const TRABAJO = join(SALIDA, "trabajo");
const FPS = 30;
const CSS = Number(opt("css", "540"));
const ANCHO = 1080;
const ALTO = 1920;
const VENTANAS = JSON.parse(readFileSync(join(AQUI, "ventanas.json"), "utf8"));
const JUEGOS = Object.keys(VENTANAS.juegos);

if (!modo || !["mapa", "clip", "foto"].includes(modo) || !cual) {
  console.error(`uso: grabar-clips.mjs mapa|clip <juego|todos>  (juegos: ${JUEGOS.join(", ")})`);
  process.exit(2);
}

/** Abre el juego con el reloj cambiado, sin red, con una semilla fija. */
async function abrir(browser, juego, semilla, motor) {
  const page = await browser.open("about:blank");
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  const scripts = `${readFileSync(join(AQUI, "reloj-virtual.js"), "utf8")}\n${readFileSync(join(AQUI, "cuadros.js"), "utf8")}`;
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: scripts });
  // 540 x 960 con densidad 2: un celular de verdad, con el lienzo en 1080 x 1920.
  await page.send("Emulation.setDeviceMetricsOverride", { width: CSS, height: Math.round((CSS * ALTO) / ANCHO), deviceScaleFactor: ANCHO / CSS, mobile: true });
  const pose = juego === "race" ? "1" : juego;
  const q = new URLSearchParams({ pose, theme: "dark", lang: "es", calidad: "alta" });
  if (semilla) {
    q.set("semilla", semilla);
    q.set("ganador", semilla);
  }
  if (motor) q.set("motor", motor);
  await page.send("Page.navigate", { url: `${BASE}/?${q}` });
  await page.waitFor("!!window.__clip && !!window.__clip.preparar", 20000);
  await sleep(1200);
  return page;
}

/** Lleva el reloj hasta que el estadio abre. */
const preparar = (page) => page.eval(`window.__clip.preparar(${ANCHO}, ${ALTO}).then(r => JSON.stringify(r))`);

async function mapa(juego) {
  const v = VENTANAS.juegos[juego];
  const dir = join(TRABAJO, juego, "mapa");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const browser = await launch({ port: PUERTO, width: 540, height: 960 });
  try {
    const page = await abrir(browser, juego, opt("semilla", v.semilla), opt("motor", v.motor));
    await preparar(page);
    const res = JSON.parse(
      await page.eval(`(async () => {
      const C = window.__clip; const out = { subtitulos: [], miniaturas: [], cartel: null, cerro: null, lienzos: C.lienzos() };
      let ultimo = "", pasos = 0;
      while (C.visible() && pasos < 60 * 150) {
        C.paso(1); pasos++;
        const t = pasos / 60;
        if (pasos % 60 === 0) { C.componer(); out.miniaturas.push(C.jpeg(0.8, 270)); }
        const tx = C.texto(); if (tx !== ultimo) { ultimo = tx; out.subtitulos.push([+t.toFixed(2), tx]); }
        if (out.cartel === null && C.cartel()) out.cartel = +t.toFixed(2);
        if (pasos % 16 === 0) await C.suelta();
      }
      out.cerro = +(pasos / 60).toFixed(2);
      out.errores = C.errores.slice(0, 3);
      return JSON.stringify(out);
    })()`),
    );
    res.miniaturas.forEach((b64, i) => writeFileSync(join(dir, `t${String(i).padStart(3, "0")}.jpg`), Buffer.from(b64, "base64")));
    const { miniaturas, ...resto } = res;
    writeFileSync(join(dir, "mapa.json"), JSON.stringify(resto, null, 1));
    const n = miniaturas.length;
    const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-framerate", "1", "-i", join(dir, "t%03d.jpg"), "-vf", `scale=162:-1,tile=12x${Math.ceil(n / 12)}`, "-frames:v", "1", join(dir, "hoja.jpg")]);
    console.log(`${juego}: ${n} s, cartel en ${resto.cartel}, cerró en ${resto.cerro}; lienzos ${JSON.stringify(resto.lienzos)}; errores ${JSON.stringify(resto.errores)}${r.status ? " (la hoja falló)" : ""}`);
    console.log(resto.subtitulos.map(([t, s]) => `  ${t}s  ${s}`).join("\n"));
    console.log(`  hoja: ${join(dir, "hoja.jpg")}`);
    if (page.exceptions.length) console.log("  excepciones:", page.exceptions.slice(0, 2));
  } finally {
    await browser.close();
  }
}

async function foto(juego) {
  const v = VENTANAS.juegos[juego];
  const seg = Number(opt("seg", "10"));
  const browser = await launch({ port: PUERTO, width: 540, height: 960 });
  try {
    const page = await abrir(browser, juego, opt("semilla", v.semilla), opt("motor", v.motor));
    await preparar(page);
    const b64 = await page.eval(`(async () => { const C = window.__clip; const hasta = ${Math.round(seg * 60)}; let n = 0; while (n < hasta) { C.paso(1); n++; if (n % 16 === 0) await C.suelta(); } C.paso(2); C.componer(); return C.jpeg(0.95); })()`);
    mkdirSync(join(TRABAJO, juego), { recursive: true });
    const archivo = join(TRABAJO, juego, `foto-${CSS}-${seg}.jpg`);
    writeFileSync(archivo, Buffer.from(b64, "base64"));
    console.log(archivo);
  } finally {
    await browser.close();
  }
}

/** Codifica una lista de cuadros (JPEG) con el filtro dado, y dice cuánto mide y pesa lo que quedó. */
function codificar(dir, filtro, archivo, crf) {
  const entrada = ["-y", "-v", "error", "-framerate", String(FPS), "-i", join(dir, "f%05d.jpg")];
  const salida = ["-filter_complex", filtro, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level", "4.2", "-crf", String(crf), "-g", "60", "-movflags", "+faststart", "-metadata", "title=Tinkazo", archivo];
  const r = spawnSync("ffmpeg", [...entrada, ...salida], { encoding: "utf8" });
  if (r.status) throw new Error(`ffmpeg: ${r.stderr.slice(-600)}`);
  const pe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames,width,height", "-show_entries", "format=duration,size", "-of", "json", archivo], { encoding: "utf8" });
  const info = JSON.parse(pe.stdout);
  return `${info.streams[0].width}x${info.streams[0].height}  ${info.streams[0].nb_read_frames} cuadros  ${(+info.format.duration).toFixed(2)} s  ${(info.format.size / 1048576).toFixed(2)} MB`;
}

/**
 * Graba la ventana de un juego y deja dos videos:
 *  - tinkazo-<juego>-9x16.mp4: la ventana y, al final, un segundo quieto con el cartel del ganador (el último cuadro,
 *    repetido). Sin fundidos: el último cuadro es siempre el ganador, para pegar el cierre o sacar la miniatura.
 *  - tinkazo-<juego>-9x16-bucle.mp4: la misma ventana con el final fundido en el principio, para repetirla sin salto.
 * Se graban `mezcla` segundos de más antes de la ventana: son los que el bucle funde con el final.
 */
async function clip(juego) {
  const v = VENTANAS.juegos[juego];
  const K = Math.round((v.mezcla ?? 0.7) * FPS); // cuadros del fundido del bucle
  const QUIETO = FPS; // un segundo de cartel quieto al final del clip
  const dir = join(TRABAJO, juego, "cuadros");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const N = Math.round((v.hasta - v.desde) * FPS);
  const inicio = v.desde - K / FPS; // segundos del show en que empieza lo que se guarda
  if (inicio < 0) throw new Error(`${juego}: la ventana arranca antes del segundo ${K / FPS}; subí "desde"`);
  const browser = await launch({ port: PUERTO, width: 540, height: 960 });
  let guardados = 0;
  try {
    const page = await abrir(browser, juego, v.semilla, v.motor);
    await preparar(page);
    const total = N + K;
    const desdePaso = Math.round(inicio * 60);
    await page.eval(`(async () => { const C = window.__clip; let n = 0; while (n < ${desdePaso}) { C.paso(1); n++; if (n % 16 === 0) await C.suelta(); } return 1; })()`);
    for (let i = 0; i < total; i++) {
      const b64 = await page.eval("(async () => { const C = window.__clip; C.paso(2); C.componer(); await C.suelta(); return C.jpeg(0.96); })()");
      writeFileSync(join(dir, `f${String(i).padStart(5, "0")}.jpg`), Buffer.from(b64, "base64"));
      guardados++;
      if (!(await page.eval("window.__clip.visible()"))) {
        console.log(`  aviso: el show cerró en el cuadro ${i}`);
        break;
      }
    }
    if (!(await page.eval("window.__clip.cartel()"))) console.log(`  aviso: ${juego} termina sin el cartel del ganador en pantalla`);
    const errores = await page.eval("JSON.stringify(window.__clip.errores.slice(0, 3))");
    if (errores !== "[]") console.log("  errores de la página:", errores);
    if (page.exceptions.length) console.log("  excepciones:", page.exceptions.slice(0, 2));
  } finally {
    await browser.close();
  }
  if (guardados < N + K) console.log(`  ${juego}: solo ${guardados} de ${N + K} cuadros: se corta ahí`);
  const carpeta = join(SALIDA, "clips");
  mkdirSync(carpeta, { recursive: true });
  const crf = v.crf ?? 21;
  // El clip: sin los cuadros de más del principio y con el último cuadro quieto un segundo.
  const archivo = join(carpeta, `tinkazo-${v.archivo}-9x16.mp4`);
  const quieto = `[0:v]trim=start_frame=${K}:end_frame=${guardados},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop=${QUIETO},fps=${FPS},format=yuv420p[v]`;
  console.log(`${juego}: ${archivo}  ${codificar(dir, quieto, archivo, crf)}`);
  // El bucle: el final se funde con los cuadros que se grabaron antes de la ventana, que son los que siguen al repetir.
  const bucle = join(carpeta, `tinkazo-${v.archivo}-9x16-bucle.mp4`);
  const fundido = `[0:v]split[a][b];[a]trim=start_frame=${K}:end_frame=${guardados},setpts=PTS-STARTPTS[B];[b]trim=end_frame=${K},setpts=PTS-STARTPTS[A];[B][A]xfade=transition=fade:duration=${(K / FPS).toFixed(4)}:offset=${((guardados - 2 * K) / FPS).toFixed(4)},fps=${FPS},format=yuv420p[v]`;
  console.log(`${juego}: ${bucle}  ${codificar(dir, fundido, bucle, crf)}`);
  rmSync(dir, { recursive: true, force: true });
}

const lista = cual === "todos" ? JUEGOS : cual.split(",");
for (const j of lista) {
  if (!VENTANAS.juegos[j]) {
    console.error(`juego desconocido: ${j}`);
    process.exit(2);
  }
  await (modo === "mapa" ? mapa(j) : modo === "foto" ? foto(j) : clip(j));
}
