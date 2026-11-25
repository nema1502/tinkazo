#!/usr/bin/env node
/**
 * Rehace la referencia de `src/music-referencia.json`: lo que programa la música de un commit de la rama principal.
 *
 * Uso:  node scripts/music-referencia.mjs <commit> [--salida src/music-referencia.json]
 *
 * Saca el código de ese commit a una carpeta temporal, le pone encima la traza y la prueba de esta rama, y corre la
 * prueba en modo generador (`MUSICA_REFERENCIA_SALIDA`): en vez de comparar, escribe las huellas de lo que ese código
 * programa. El JSON queda con el commit entero en `origen`. No cambia nada de esta carpeta salvo el JSON de salida.
 * Es pesado (una corrida de la prueba): se lanza detrás del turno de la máquina.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const raiz = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const commit = args.find((a) => !a.startsWith("--"));
if (!commit) {
  console.error("uso: node scripts/music-referencia.mjs <commit> [--salida <archivo>]");
  process.exit(2);
}
const iSalida = args.indexOf("--salida");
const salida = resolve(raiz, iSalida >= 0 && args[iSalida + 1] ? args[iSalida + 1] : "src/music-referencia.json");

const entero = spawnSync("git", ["-C", raiz, "rev-parse", "--verify", `${commit}^{commit}`], { encoding: "utf8" });
if (entero.status !== 0) {
  console.error(`no existe el commit ${commit}`);
  process.exit(2);
}
const origen = entero.stdout.trim();

const carpeta = mkdtempSync(join(tmpdir(), "tinkazo-referencia-"));
try {
  // El tar de Windows toma "C:" como una máquina remota: se extrae desde adentro de la carpeta, sin -C.
  const tar = spawnSync(`git -C "${raiz}" archive ${origen} src package.json tsconfig.json | tar -x`, { shell: true, stdio: "inherit", cwd: carpeta });
  if (tar.status !== 0) throw new Error("no se pudo sacar el código del commit");
  mkdirSync(join(carpeta, "src"), { recursive: true });
  for (const f of ["src/music-traza.ts", "src/music-igual-a-hoy.test.ts"]) copyFileSync(join(raiz, f), join(carpeta, f));
  symlinkSync(join(raiz, "node_modules"), join(carpeta, "node_modules"), "junction");
  const resultado = join(carpeta, "referencia.json");
  const corrida = spawnSync(process.execPath, [join(raiz, "node_modules/vitest/vitest.mjs"), "run", "src/music-igual-a-hoy.test.ts", "--maxWorkers=1"], {
    cwd: carpeta,
    stdio: "inherit",
    env: { ...process.env, MUSICA_REFERENCIA_SALIDA: resultado, MUSICA_REFERENCIA_ORIGEN: origen },
  });
  if (corrida.status !== 0) throw new Error("la corrida de la prueba falló");
  const json = readFileSync(resultado, "utf8");
  JSON.parse(json);
  copyFileSync(resultado, salida);
  console.log(`referencia escrita en ${salida} con el código de ${origen}`);
} finally {
  // El enlace a node_modules se suelta primero, para que borrar la carpeta temporal nunca toque lo instalado.
  try {
    rmdirSync(join(carpeta, "node_modules"));
  } catch {
    /* no llegó a crearse */
  }
  rmSync(carpeta, { recursive: true, force: true });
}
