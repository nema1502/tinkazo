#!/usr/bin/env node
/**
 * Renderiza las candidatas de sonido de la carrera a archivos WAV, con el mismo motor que suena en la página.
 *
 * Arma `src/sonidos/carrera-render.ts` (que usa `src/sound.ts` y `src/music.ts` sobre un `OfflineAudioContext`) en un
 * solo archivo, lo carga en un Chrome sin interfaz y trae las muestras en trozos por DevTools. No necesita el sitio
 * construido ni la red. Para cada pieza escribe `<salida>/<pieza>/<eleccion>.wav` (16 bits, estéreo, 44.100 Hz):
 * `hoy` (lo que suena hoy), `a`, `b`, `c`, y `base` en la música y el final (lo de hoy con el arreglo de la mezcla). Además
 * renderiza el par del bombo y el bajo (`bomboBajo/hoy.wav` y `bomboBajo/chico.wav`): la música de hoy de la carrera con la
 * mezcla de hoy y con la de parlante chico, sin tocar nada más.
 *
 * Uso: CDP_PORT=9770 node scripts/sonidos/carrera-render.mjs --salida <carpeta> [--solo pieza[:eleccion][,pieza[:eleccion]...]]
 *
 * Antes de abrir Chrome mira la RAM libre y espera si hay menos de 1 GB (hasta cinco veces, dos minutos cada una).
 */
import { createServer } from "node:http";
import { freemem } from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "../lib/browser.mjs";
import { escribirWav } from "../lib/senal.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const salida = resolve(opt("--salida", join(RAIZ, "..", "carrera-sonido-salida")));
const solo = opt("--solo", "");

export const PIEZAS = ["musica", "pasos", "echarse", "obstaculos", "final", "festejo"];
/** El par del bombo y el bajo: una elección aparte de las seis piezas (`BOMBO_Y_BAJO` en `src/sonidos/carrera-elegidas.ts`). */
export const PIEZA_MEZCLA = "bomboBajo";
export const ELECCIONES = (pieza) => (pieza === PIEZA_MEZCLA ? ["hoy", "chico"] : ["hoy", ...(pieza === "musica" || pieza === "final" ? ["base"] : []), "a", "b", "c"]);

/**
 * Espera a que haya RAM libre antes de abrir Chrome: la máquina se comparte con otros agentes. Espera en tandas de 60 s y
 * en cada una imprime la RAM libre (ningún comando pasa de 90 s sin decir algo); hasta diez tandas.
 */
export async function esperarRam(minGb = 1.0, intentos = 10) {
  for (let i = 0; i < intentos; i++) {
    const libre = freemem() / 2 ** 30;
    if (libre >= minGb) return libre;
    console.log(`RAM libre ${libre.toFixed(2)} GB (< ${minGb}): espero un minuto (${i + 1}/${intentos})`);
    await sleep(60_000);
  }
  return freemem() / 2 ** 30;
}

/** El motor de las candidatas, en un solo archivo para cargarlo en una página. */
export async function empaquetar() {
  const { build } = await import("vite");
  const r = await build({
    configFile: false,
    root: RAIZ,
    logLevel: "silent",
    build: { write: false, minify: false, target: "es2022", lib: { entry: resolve(RAIZ, "src/sonidos/carrera-render.ts"), formats: ["iife"], name: "CarreraSonido", fileName: "carrera" } },
  });
  const salidaVite = Array.isArray(r) ? r[0] : r;
  return salidaVite.output[0].code;
}

async function main() {
  const pedidos = solo.split(",").filter(Boolean).map((s) => s.split(":"));
  const lista = [...PIEZAS, PIEZA_MEZCLA]
    .flatMap((p) => ELECCIONES(p).map((e) => [p, e]))
    .filter(([p, e]) => !pedidos.length || pedidos.some(([sp, se]) => sp === p && (!se || se === e)));
  if (!lista.length) throw new Error(`nada que renderizar con --solo ${solo}`);
  const codigo = await empaquetar();

  const srv = createServer((q, r) => {
    r.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    r.end("<!doctype html><meta charset=utf-8><title>render</title>");
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const puerto = srv.address().port;

  const ram = await esperarRam();
  console.log(`RAM libre ${ram.toFixed(2)} GB: abro Chrome en el puerto ${process.env.CDP_PORT || 9770}`);
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9770), width: 800, height: 600 });
  try {
    const page = await browser.open(`http://127.0.0.1:${puerto}/`);
    await page.eval(codigo);
    if (!(await page.eval("typeof CarreraSonido === 'object' && typeof CarreraSonido.renderizar === 'function'"))) throw new Error("el motor no cargó en la página");
    const resumen = [];
    for (const [pieza, eleccion] of lista) {
      const meta = await page.eval(`CarreraSonido.renderizar(${JSON.stringify(pieza)}, ${JSON.stringify(eleccion)})`);
      const total = meta.n * 2;
      const POR_TROZO = 200_000;
      const partes = [];
      for (let desde = 0; desde < total; desde += POR_TROZO) partes.push(Buffer.from(await page.eval(`CarreraSonido.trozo(${desde}, ${POR_TROZO})`), "base64"));
      const crudo = Buffer.concat(partes);
      const pcm = new Int16Array(crudo.buffer, crudo.byteOffset, crudo.length / 2);
      const L = new Float32Array(meta.n), R = new Float32Array(meta.n);
      for (let i = 0; i < meta.n; i++) {
        L[i] = (pcm[2 * i] ?? 0) / 32767;
        R[i] = (pcm[2 * i + 1] ?? 0) / 32767;
      }
      mkdirSync(join(salida, pieza), { recursive: true });
      writeFileSync(join(salida, pieza, `${eleccion}.wav`), escribirWav(L, R, meta.sr));
      resumen.push({ pieza, eleccion, n: meta.n, sr: meta.sr, pico: meta.pico });
      console.log(`${pieza}/${eleccion}: ${(meta.n / meta.sr).toFixed(1)} s, pico ${meta.pico.toFixed(3)}`);
    }
    writeFileSync(join(salida, "render.json"), JSON.stringify(resumen, null, 2));
    if (browser.close) await browser.close();
  } finally {
    srv.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
