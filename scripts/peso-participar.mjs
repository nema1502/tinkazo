#!/usr/bin/env node
/**
 * La prueba de peso de la página del celular (participar.html).
 *
 * La abren 150 celulares con datos: lo que se le suma tiene tope, y se corre en cada cambio de esa página. Mide sobre
 * `dist/` el código comprimido y sale con 1 si algo pasa su tope (los números y su razón, en scripts/lib/peso-participar.mjs).
 * Lo que se baja con `import()` no cuenta: se baja solo cuando hace falta.
 *
 * Uso:
 *   node scripts/peso-participar.mjs               mide el dist/ que ya hay
 *   node scripts/peso-participar.mjs --construir   construye el sitio y después mide
 *   node scripts/peso-participar.mjs --dist carpeta
 *   pnpm check:peso-participar
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { excesos, informe, medir } from "./lib/peso-participar.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const i = args.indexOf("--dist");
const dist = resolve(raiz, i >= 0 && args[i + 1] ? args[i + 1] : "dist");

if (args.includes("--construir")) {
  const r = spawnSync("pnpm", ["exec", "vite", "build"], { cwd: raiz, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error("La construcción falló: no hay nada que medir.");
    process.exit(1);
  }
}

try {
  const medida = medir(dist);
  console.log(informe(medida));
  process.exit(excesos(medida).length > 0 ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
