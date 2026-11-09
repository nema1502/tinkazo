#!/usr/bin/env node
/**
 * Avisa cuando una imagen de `public/juegos/**` es más vieja que el último
 * commit que tocó el código de su juego: ese juego cambió y su foto todavía
 * muestra lo de antes. Es un aviso: sale siempre con 0.
 *
 *   pnpm check:imagenes
 *
 * Para rehacerlas: `scripts/capturas-juegos.mjs` (ver su cabecera).
 */
import { spawnSync } from "node:child_process";
import { imagenesViejas, juegoDeImagen } from "./lib/imagenes-viejas.mjs";

const git = (...a) => spawnSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ?? "";
const ultimo = (ruta) => Number(git("log", "-1", "--format=%ct", "--", ruta).trim()) || 0;

const imagenes = git("ls-files", "public/juegos")
  .split("\n")
  .filter((r) => juegoDeImagen(r))
  .map((ruta) => ({ ruta, t: ultimo(ruta) }));

// La fecha más nueva de cada archivo de código, en una sola pasada por el historial.
const t = new Map();
let actual = 0;
for (const l of git("log", "--format=@%ct", "--name-only", "--", "src/games").split("\n")) {
  if (l.startsWith("@")) actual = Number(l.slice(1));
  else if (l && !t.has(l)) t.set(l, actual);
}
const codigos = [...t].map(([ruta, f]) => ({ ruta, t: f }));

const viejas = imagenesViejas(imagenes, codigos);
if (!viejas.length) console.log("Las imágenes de los juegos están al día con su código.");
for (const v of viejas) {
  console.log(`AVISO ${v.juego}: ${v.imagenes.length} imagen(es) más viejas que ${v.codigo}: ${v.imagenes.map((r) => r.replace("public/juegos/", "")).join(", ")}`);
}
if (viejas.length) console.log("Rehacelas con scripts/capturas-juegos.mjs.");
