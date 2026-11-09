#!/usr/bin/env node
/**
 * Las miniaturas de los clips (una por juego, 270 por 480, WebP) para la lista de descargas de marca.html.
 * Salen de un cuadro de cada clip, el del cartel del ganador. Esas imágenes sí van al repositorio
 * (public/kit-clips/): son capturas de nuestros propios juegos; los videos no.
 *
 *   node scripts/marca/videos/posters.mjs --salida <carpeta del kit, con clips/>   (o KIT_VIDEOS_DIR)
 *
 * Mide cada clip con ffprobe, escribe cuántos segundos y cuántos MB pesa en la consola (para anotarlos en
 * src/marca-creadores.ts) y deja las miniaturas en public/kit-clips/<juego>.webp. Hace falta ffmpeg.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { carpetaDeSalida } from "./salida.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..", "..");
const args = process.argv.slice(2);
const CLIPS = join(carpetaDeSalida(args), "clips");
const DESTINO = join(REPO, "public", "kit-clips");
const ventanas = JSON.parse(readFileSync(join(AQUI, "ventanas.json"), "utf8")).juegos;

mkdirSync(DESTINO, { recursive: true });
let total = 0;
for (const [juego, v] of Object.entries(ventanas)) {
  const mp4 = join(CLIPS, `tinkazo-${v.archivo}-9x16.mp4`);
  const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size", "-of", "json", mp4], { encoding: "utf8" });
  if (p.status) {
    console.error(`${juego}: no pude leer ${mp4}`);
    process.exitCode = 1;
    continue;
  }
  const { duration, size } = JSON.parse(p.stdout).format;
  const seg = +duration;
  total += +size;
  // el cuadro del cartel: a los nueve décimos del clip
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", (seg * 0.88).toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale=270:480:flags=lanczos", "-c:v", "libwebp", "-quality", "82", join(DESTINO, `${juego}.webp`)]);
  if (r.status) {
    console.error(`${juego}: ffmpeg falló`);
    process.exitCode = 1;
    continue;
  }
  const kb = statSync(join(DESTINO, `${juego}.webp`)).size / 1024;
  console.log(`${juego.padEnd(11)} seg: ${seg.toFixed(1).padStart(5)}  mb: ${(size / 1048576).toFixed(2).padStart(5)}  miniatura ${kb.toFixed(0)} KB`);
}
console.log(`peso total de los clips: ${(total / 1048576).toFixed(1)} MB`);
