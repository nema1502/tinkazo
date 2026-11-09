#!/usr/bin/env node
/**
 * Calibra el volumen de cada candidata de la carrera con lo que se midió.
 *
 * Lee `medidas.json` (lo que escribe `carrera-medir.mjs` al lado de los WAV renderizados) y reescribe
 * `src/sonidos/carrera-niveles.ts` acercando cada candidata a su meta (música a −18 LUFS, golpe de 6 a 10 LU sobre la
 * recta, efectos dentro de su banda). Se repite: renderizar, medir, calibrar, hasta que todas cumplan.
 *
 * Uso: node scripts/sonidos/carrera-calibrar.mjs --carpeta <render> [--simular]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leerNiveles, nuevosNiveles, textoDeNiveles } from "./carrera-calibrar-lib.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const carpeta = resolve(opt("--carpeta", ""));
if (!opt("--carpeta", "")) throw new Error("falta --carpeta <carpeta del render>");
const destino = join(RAIZ, "src", "sonidos", "carrera-niveles.ts");
const medidas = JSON.parse(readFileSync(join(carpeta, "medidas.json"), "utf8"));
const crudo = readFileSync(destino, "utf8");
const { nuevos, cambios } = nuevosNiveles(leerNiveles(crudo), medidas);
for (const c of cambios) console.log(`${c.clave.padEnd(14)} ${c.correccionDb >= 0 ? "+" : ""}${c.correccionDb.toFixed(1)} dB  ${JSON.stringify(c.antes)} -> ${JSON.stringify(c.despues)}`);
if (args.includes("--simular")) console.log("--simular: no escribí nada");
else {
  const texto = textoDeNiveles(nuevos);
  writeFileSync(destino, crudo.includes("\r\n") ? texto.replace(/\n/g, "\r\n") : texto);
  console.log(`Escribí ${destino}`);
}
