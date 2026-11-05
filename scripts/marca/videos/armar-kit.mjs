#!/usr/bin/env node
/**
 * Junta en una sola carpeta plana, lista para `workers/musica/subir-kit.mjs`, todo lo que sale de los otros
 * guiones: los clips (grabar-clips.mjs), el logo animado (logo-animado.mjs, con los nombres del kit) y los
 * guiones, subtítulos, placas, letra y LEEME (guiones.mjs). De cada clip van las dos versiones: la que termina quieta
 * en el cartel y la -bucle. No sube nada: solo copia dentro de <salida>/kit/.
 *
 *   node scripts/marca/videos/armar-kit.mjs --salida <carpeta>   (o KIT_VIDEOS_DIR)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { carpetaDeSalida } from "./salida.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = join(AQUI, "..", "..", "..");
const RAIZ = carpetaDeSalida(process.argv.slice(2));
const { CLIPS, LOGOS_ANIMADOS, archivoBucle } = await import(pathToFileURL(join(REPO, "src/marca-creadores.ts")).href);

const DESTINO = join(RAIZ, "kit");
rmSync(DESTINO, { recursive: true, force: true });
mkdirSync(DESTINO, { recursive: true });

const faltan = [];
let total = 0;
const copiar = (origen, nombre) => {
  if (!existsSync(origen)) return faltan.push(origen);
  copyFileSync(origen, join(DESTINO, nombre));
  total += statSync(origen).size;
};
for (const c of CLIPS) for (const n of [c.archivo, archivoBucle(c)]) copiar(join(RAIZ, "clips", n), n);
// Los logos salen de logo-animado.mjs como entrada-oscuro.mp4 o salida-es-alfa.webm: en el kit llevan el prefijo y "cierre".
for (const l of LOGOS_ANIMADOS) copiar(join(RAIZ, "logo-animado", `${l.id}.${l.archivo.split(".").pop()}`), l.archivo);
const guiones = join(RAIZ, "guiones");
if (existsSync(guiones)) for (const n of readdirSync(guiones)) copiar(join(guiones, n), n);
else faltan.push(guiones);

if (faltan.length) {
  console.error(`Faltan archivos (corré antes los otros guiones):\n  ${faltan.join("\n  ")}`);
  process.exit(1);
}
console.log(`${readdirSync(DESTINO).length} archivos, ${(total / 1048576).toFixed(1)} MB, en ${DESTINO}`);
