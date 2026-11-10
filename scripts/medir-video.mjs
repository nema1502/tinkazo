/**
 * Medir el prototipo de video del sorteo (issue nema1502/tinkazo#31).
 *
 *   CHROME=/ruta/a/chrome node scripts/medir-video.mjs [--base http://localhost:5179] [--port 5179]
 *
 * Sin `--base`, arranca un servidor de Vite él mismo (desarrollo, para poder
 * importar `src/video/medir.ts` desde la página). Abre el sitio con
 * `?video=medir` (la bandera del prototipo, apagada por defecto, prendida solo
 * para medir), llama a `medirTodo()` por CDP y reporta:
 *
 * - cuánto tarda volver a dibujar y codificar el show de una ronda,
 * - cuánto pesa un video vertical de 20–30 s (720x1280),
 * - qué formato produjo este Chrome (MP4 vs WebM),
 * - si el sonido de la ronda entró de verdad (pico de onda decodificada).
 *
 * El show es una reencarnación 2D del show del juego hecha por el prototipo
 * (`src/video/`), no el motor real de PixiJS: el show real corre en tiempo real
 * y su lienzo no se puede pedir cuadro a cuadro fuera del juego; eso queda
 * anotado en el reporte como lo que falta para conectar el video con el motor.
 */
import { spawn } from "node:child_process";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const arg = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PORT = Number(arg("port", 5179));
const BASE = arg("base", `http://localhost:${PORT}`).replace(/\/$/, "");

/** Un servidor de Vite propio, para que el prototipo se pueda importar como módulo de la página. */
async function servir() {
  const hijo = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let salida = "";
  hijo.stdout.on("data", (d) => (salida += d));
  hijo.stderr.on("data", (d) => (salida += d));
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`${BASE}/`, { signal: AbortSignal.timeout(500) })).ok) return { hijo, salida: () => salida };
    } catch {
      /* todavía no levanta */
    }
    await sleep(200);
  }
  hijo.kill();
  throw new Error(`el servidor de Vite no levantó en ${BASE}:\n${salida}`);
}

let server = null;
try {
  if (/^https?:\/\//.test(arg("base", ""))) {
    console.log(`Sirviendo ya está: ${BASE}`);
  } else {
    server = await servir();
    console.log(`Servidor de Vite listo: ${BASE}`);
  }
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9333), width: 480, height: 960 });
  try {
    const page = await browser.open(`${BASE}/?video=medir`);
    const listo = await page.waitFor("document.readyState === 'complete'", 60_000);
    if (!listo.ok) throw new Error("la página no terminó de cargar");
    await sleep(1500);
    console.log("Midiendo: dos grabaciones de 27 s (sin audio y con la música de la ronda)…");
    const json = await page.eval(`(async () => {
      const m = await import("/src/video/medir.ts");
      return JSON.stringify(await m.medirTodo());
    })()`);
    const r = JSON.parse(json);

    const archivo = (m) => `${(m.bytes / 1_048_576).toFixed(2)} MB`;
    const seg = (ms) => `${(ms / 1000).toFixed(1)} s`;
    console.log("");
    console.log(`Navegador: ${r.navegador.cadena}`);
    console.log(`Ronda: ${r.ronda.participantes} participantes, semilla ${r.ronda.seed}, ${r.ronda.cuadros} cuadros a ${r.ronda.segundos} s, ${r.ronda.carriles} carriles`);
    console.log("");
    for (const [nombre, m] of Object.entries(r.grabaciones)) {
      console.log(`${nombre}:`);
      console.log(`  formato: ${m.formato}`);
      console.log(`  peso: ${archivo(m)}`);
      console.log(`  tiempo de grabación (pared): ${seg(m.msTotal)} para ${r.ronda.segundos} s de video`);
      console.log(`  dibujo de los ${m.cuadros} cuadros: ${seg(m.msDibujo)} en total, el peor cuadro ${m.msDibujoMaximo.toFixed(1)} ms`);
      console.log(`  audio: ${m.conAudio ? (m.picoAudio > 0 ? `entra, pico ${m.picoAudio.toFixed(3)}` : "track presente pero sin onda") : "sin track"}`);
    }
    console.log("");
    console.log("Notas:");
    for (const n of r.notas) console.log(`  - ${n}`);
    console.log("");
    console.log("Lo que quedó sin medir:");
    console.log("  - El show real del juego (PixiJS) no entra en la medición: corre en tiempo real y su lienzo");
    console.log("    no se le puede pedir cuadro a cuadro desde afuera. Para el video de verdad falta que el");
    console.log("    motor exponga el estado de la escena por cuadro (o un reloj determinista) para re-dibujarlo");
    console.log("    con el plan, o aceptar grabar en tiempo real desde `#pixi-canvas`.");
    console.log("  - La duración del archivo grabado no se lee reproductor-adentro: el WebM de MediaRecorder sale");
    console.log("    sin cabecera de duración; la equivalencia la da el ritmo en tiempo real de la grabación.");
    console.log("  - Si WhatsApp acepta el archivo se juzga por el formato (MP4 H.264/AAC es el seguro); no se");
    console.log("    subió nada a WhatsApp desde esta medición.");
    console.log("");
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await browser.close();
  }
} finally {
  if (server) {
    server.hijo.kill();
  }
}
