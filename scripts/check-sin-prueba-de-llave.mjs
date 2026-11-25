#!/usr/bin/env node
/**
 * Revisa que una carpeta construida no traiga la prueba de la llave (issue 301), o con `--presente`, que la traiga entera.
 *
 *   node scripts/check-sin-prueba-de-llave.mjs dist
 *   node scripts/check-sin-prueba-de-llave.mjs dist-llave --presente
 *
 * Sale con 0 si la carpeta es lo que se espera y con 1 si no. Sin Chrome ni red.
 */
import { resolve } from "node:path";
import { revisarCarpeta } from "./lib/sin-prueba-de-llave.mjs";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("Falta la carpeta construida: node scripts/check-sin-prueba-de-llave.mjs <carpeta> [--presente]");
  process.exit(2);
}
const presente = args.includes("--presente");
const r = revisarCarpeta(resolve(dir), { presente });
if (r.ok) {
  console.log(presente ? `La prueba de la llave está entera en ${dir}.` : `${dir} no trae nada de la prueba de la llave.`);
  process.exit(0);
}
console.error(presente ? `La carpeta ${dir} no trae la prueba entera:` : `La carpeta ${dir} trae algo de la prueba de la llave:`);
for (const p of r.problemas) console.error(`- ${p}`);
process.exit(1);
