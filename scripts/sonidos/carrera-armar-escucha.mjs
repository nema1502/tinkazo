#!/usr/bin/env node
/**
 * Arma lo que se escucha para elegir: un video por candidata, con el audio de la candidata encima del video de la carrera.
 *
 * Para cada una de las seis piezas recorta el tramo que corresponde del video de la línea de base de la carrera (el
 * del proyector, 1920x1080, 18 personas, que no trae sonido), lo pone a 1280x720 y le pega encima el audio de cada
 * candidata y de "el de hoy" (renderizados con `carrera-render.mjs`). Todos los audios de una pieza se igualan en
 * volumen: si uno suena más fuerte, no es trampa de la página. Si el render trae el par del bombo y el bajo
 * (`bomboBajo/hoy.wav` y `bomboBajo/chico.wav`), arma también esa séptima tarjeta: dos clips de catorce segundos de la música
 * de la carrera, igualados en volumen, de los que se elige uno (`carrera:bomboBajo`, que aplica `carrera-aplicar.mjs`). Escribe en la carpeta que sirve la página de escucha
 * los clips y el `manifiesto.json` que esa página lee.
 *
 * Uso: node scripts/sonidos/carrera-armar-escucha.mjs [--render <carpeta>] [--salida <carpeta>] [--video <mp4>] [--solo pieza,pieza]
 *
 * Las rutas no tienen valor por defecto: cada una se pide con su opción o con la variable de entorno `TINKAZO_ESCUCHA`, una
 * carpeta de trabajo de la que salen `render/` (los WAV de `carrera-render.mjs`), `salida/` (donde se escribe) y `video-base.mp4` (el
 * video de la línea de base de la carrera). Si falta alguna, el script lo dice y sale con error.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conGanancia, escribirWav, leerWav } from "../lib/senal.mjs";
import { medirCandidata } from "./carrera-medir.mjs";
import { juzgar } from "./carrera-juicio.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const CARPETA = process.env.TINKAZO_ESCUCHA;
/** Una ruta pedida por su opción, o dentro de `TINKAZO_ESCUCHA`; si no hay ninguna, se frena con un mensaje claro. */
function ruta(opcion, sub) {
  const valor = opt(opcion, CARPETA ? join(CARPETA, sub) : "");
  if (!valor) {
    console.error(`Falta ${opcion} <ruta>: pasala o poné en TINKAZO_ESCUCHA la carpeta de trabajo de la página de escucha (usa ${sub}).`);
    process.exit(1);
  }
  return resolve(valor);
}
/** Se resuelven al correr (en `main`), para que importar `TRAMOS` o `MEZCLA` en una prueba no exija nada. */
let render, salida, video;

/**
 * Qué tramo del video acompaña a cada pieza (segundos del video de la línea de base: 64,5 s, golpe del ganador en el
 * segundo 61,3, cruce de la meta en el 60,3). Las imágenes son las de la carrera de hoy.
 */
export const TRAMOS = {
  musica: { desde: 30.3, dura: 30.5 },
  pasos: { desde: 44.0, dura: 6.3 },
  echarse: { desde: 37.0, dura: 4.8 },
  obstaculos: { desde: 46.0, dura: 6.3 },
  final: { desde: 57.3, dura: 6.3 },
  festejo: { desde: 61.3, dura: 3.2 },
};

const HOY = {
  musica: { nombre: "El de hoy", caracter: "La música de hoy: charango, zampoña y un beat electrónico, de 96 a 132 golpes por minuto según la tensión." },
  pasos: { nombre: "El de hoy", caracter: "Un tic de triángulo bajito cada medio segundo, alternando dos notas." },
  echarse: { nombre: "El de hoy", caracter: "Una nota de triángulo corta y suave." },
  obstaculos: { nombre: "El de hoy", caracter: "Un seno grave para las piedras, un toque de triángulo para la valla y el viento filtrado." },
  final: { nombre: "El de hoy", caracter: "La música sigue casi hasta el cruce, dos latidos graves, y el golpe con todo junto." },
  festejo: { nombre: "El de hoy", caracter: "El acorde, el arpegio y los veinte rasgueos de hoy, todo junto con el golpe (no se separan)." },
};
/**
 * El par del bombo y el bajo de la música: no es una de las seis piezas del show sino una elección aparte
 * (`BOMBO_Y_BAJO` en `src/sonidos/carrera-elegidas.ts`). Los dos clips son la música de hoy de la carrera, tocada con la
 * mezcla de hoy y con la de parlante chico; el video es el tramo de la recta de la línea de base.
 */
export const MEZCLA = {
  id: "bomboBajo",
  titulo: "El bombo y el bajo",
  cuando: "Catorce segundos de la música de la carrera. Cambian solo el bombo, el kick y el bajo; lo demás es igual. Acá suenan igual de fuerte; en el sitio, el de parlante chico queda cerca de 1 LU más bajo. Probalos con \"Como en el proyector\" prendido, que corta los graves como un parlante chico.",
  segundos: 14,
  tramo: { desde: 40.0, dura: 14.5 },
  candidatas: {
    hoy: { nombre: "El bombo y el bajo de hoy", caracter: "Como suena la música en el sitio ahora: el bombo con mucho grave, el bajo redondo." },
    chico: { nombre: "El bombo y el bajo para parlante chico", caracter: "Menos grave y más golpe y armónicos, para que el bombo y el bajo se sigan oyendo en un proyector o una laptop." },
  },
};
const BASE = {
  musica: { nombre: "Ninguna, con el ritmo nuevo", caracter: "La música de hoy, pero a 100, 112 y 124 golpes por minuto y con el volumen del show en −18 LUFS. Es lo que va si ninguna convence." },
  final: { nombre: "Ninguno, con el silencio", caracter: "El bombo que crece, el clic y el silencio de antes del golpe, y después el golpe de hoy. Es lo que va si ninguno convence." },
};

/** Las candidatas (nombres, descripciones), del mismo módulo que usa la carrera: se empaqueta con Vite porque los imports de `src` no llevan extensión. */
async function cargarCandidatas() {
  const { build } = await import("vite");
  const r = await build({
    configFile: false,
    root: RAIZ,
    logLevel: "silent",
    build: { write: false, minify: false, target: "es2022", lib: { entry: resolve(RAIZ, "src/sonidos/carrera.ts"), formats: ["es"], fileName: "carrera" } },
  });
  const codigo = (Array.isArray(r) ? r[0] : r).output[0].code;
  return import(`data:text/javascript;base64,${Buffer.from(codigo).toString("base64")}`);
}

const ff = (a) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...a], { stdio: ["ignore", "inherit", "inherit"] });

/** La métrica que se iguala en cada pieza: la sonoridad con que se juzga. */
const metricaDe = (pieza, m) => (pieza === "musica" ? m.medida.I : pieza === "final" ? m.golpe : m.medida.momentanea);
const mediana = (xs) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

/**
 * Arma una tarjeta de la página: recorta el tramo del video, iguala el volumen de los audios renderizados de la pieza a su
 * mediana y pega cada audio encima del video. `def.medirComo` es la pieza con cuyas metas se mide ("musica" para el par del
 * bombo y el bajo, que es música), `def.referencias` los ids que no se juzgan (lo de hoy y el de base) y `def.metaDe(id)`
 * el nombre y la descripción de cada uno.
 */
function armarPieza(def, trabajo) {
  const { id: pieza, medirComo, tramo, ids, referencias } = def;
  const dirPieza = join(render, pieza);
  const seg = join(trabajo, `${pieza}.mp4`);
  ff(["-ss", String(tramo.desde), "-t", String(tramo.dura), "-i", video, "-an", "-vf", "scale=1280:720", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-pix_fmt", "yuv420p", seg]);
  const hay = ids.filter((e) => existsSync(join(dirPieza, `${e}.wav`)));
  const lecturas = hay.map((e) => {
    const wav = leerWav(readFileSync(join(dirPieza, `${e}.wav`)));
    return { e, wav, m: medirCandidata(medirComo, wav) };
  });
  const ref = mediana(lecturas.map((l) => metricaDe(medirComo, l.m)));
  const candidatas = [];
  for (const l of lecturas) {
    // Igualar el volumen: llevar la métrica de cada una a la mediana de la pieza, sin pasar de −1 dBFS de pico de muestra.
    let ganancia = ref - metricaDe(medirComo, l.m);
    let limitada = false;
    if (l.m.medida.picoDb + ganancia > -1) {
      ganancia = -1 - l.m.medida.picoDb;
      limitada = true;
    }
    const [L, R] = conGanancia(l.wav.L, l.wav.R, ganancia);
    const wavNorm = join(trabajo, `${pieza}-${l.e}.wav`);
    writeFileSync(wavNorm, escribirWav(L, R, l.wav.sr));
    const clip = join(salida, "clips", `${pieza}-${l.e}.mp4`);
    ff(["-i", seg, "-i", wavNorm, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", clip]);
    const meta = def.metaDe(l.e);
    const j = juzgar(medirComo, l.m);
    const esReferencia = referencias.includes(l.e);
    candidatas.push({
      id: l.e,
      nombre: meta.nombre,
      caracter: meta.caracter,
      clip: `clips/${pieza}-${l.e}.mp4`,
      sonoridad: Number(metricaDe(medirComo, l.m).toFixed(1)),
      gananciaDb: Number(ganancia.toFixed(1)),
      limitada,
      picoRealDb: Number(l.m.medida.picoRealDb.toFixed(1)),
      pierde150: Number((medirComo === "musica" ? l.m.medida.pierde150 : l.m.medida.pierde150Momentanea).toFixed(1)),
      cumple: esReferencia ? null : j.ok,
      fallas: esReferencia ? [] : j.fallas,
    });
  }
  console.log(`${pieza}: ${candidatas.map((c) => `${c.id} ${c.gananciaDb >= 0 ? "+" : ""}${c.gananciaDb} dB${c.limitada ? " (limitada)" : ""}`).join(", ")}`);
  return { id: pieza, titulo: def.titulo, cuando: def.cuando, segundos: def.segundos, igualadaA: Number(ref.toFixed(1)), candidatas };
}

async function main() {
  render = ruta("--render", "render");
  salida = ruta("--salida", "salida");
  video = ruta("--video", "video-base.mp4");
  const { CANDIDATAS, DATOS_PIEZA, PIEZAS } = await cargarCandidatas();
  if (!existsSync(video)) throw new Error(`no encuentro el video de la línea de base: ${video}`);
  mkdirSync(join(salida, "clips"), { recursive: true });
  const trabajo = join(salida, "_trabajo");
  mkdirSync(trabajo, { recursive: true });
  // Las seis piezas del show y, si el render lo trae, el par del bombo y el bajo.
  const defs = PIEZAS.map((pieza) => ({
    id: pieza,
    medirComo: pieza,
    tramo: TRAMOS[pieza],
    titulo: DATOS_PIEZA[pieza].titulo,
    cuando: DATOS_PIEZA[pieza].cuando,
    segundos: DATOS_PIEZA[pieza].segundos,
    ids: ["hoy", "base", "a", "b", "c"],
    referencias: ["hoy", "base"],
    metaDe: (e) => (e === "hoy" ? HOY[pieza] : e === "base" ? BASE[pieza] : CANDIDATAS[pieza].find((c) => c.id === e)),
  }));
  if (existsSync(join(render, MEZCLA.id))) {
    defs.push({
      id: MEZCLA.id,
      medirComo: "musica",
      tramo: MEZCLA.tramo,
      titulo: MEZCLA.titulo,
      cuando: MEZCLA.cuando,
      segundos: MEZCLA.segundos,
      ids: ["hoy", "chico"],
      referencias: ["hoy", "chico"],
      metaDe: (e) => MEZCLA.candidatas[e],
    });
  }
  // Con `--solo` solo se rearman esas tarjetas y las demás quedan como están en el manifiesto.
  const solo = opt("--solo", "").split(",").filter(Boolean);
  const rutaManifiesto = join(salida, "manifiesto.json");
  const previo = solo.length && existsSync(rutaManifiesto) ? JSON.parse(readFileSync(rutaManifiesto, "utf8")) : null;
  const piezas = [];
  for (const def of defs) {
    if (solo.length && !solo.includes(def.id)) {
      const hay = previo?.piezas?.find((p) => p.id === def.id);
      if (hay) piezas.push(hay);
      continue;
    }
    piezas.push(armarPieza(def, trabajo));
  }
  writeFileSync(
    rutaManifiesto,
    JSON.stringify({ generado: new Date().toISOString(), titulo: "Carrera de llamas, 6-nov", video: "carrera-3d-proyector-1920x1080-n18.mp4 de la línea de base del 6-nov (mudo; las imágenes son las de hoy)", piezas }, null, 2),
  );
  rmSync(trabajo, { recursive: true, force: true });
  console.log(`Listo: ${rutaManifiesto}`);
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
