#!/usr/bin/env node
/**
 * Aplica a la carrera lo que se eligió escuchando: un comando.
 *
 * Lee `elecciones.json` de la página de escucha y reescribe `src/sonidos/carrera-elegidas.ts` con una elección por pieza
 * (`hoy`, `a`, `b`, `c` o `base`). Las piezas que no eligió quedan como están. También aplica el par del bombo y el bajo
 * de la música (`carrera:bomboBajo`): `chico` escribe `BOMBO_Y_BAJO = "chico"` y la mezcla para parlante chico pasa a valer
 * también sin candidatas, en la música de los diez juegos; `hoy` (o ninguno) lo deja condicionado a las candidatas. No sube
 * nada ni toca el audio: después hay que mirar el cambio, correr `audit-sound` y `audit-mezcla` (con `--sonido` si se quiere
 * ver una por una) y commitear.
 *
 * Uso:
 *   node scripts/sonidos/carrera-aplicar.mjs [--elecciones <elecciones.json>] [--simular]
 *
 * No hay una ruta por defecto: el archivo se pide con `--elecciones <archivo>` o con la variable de entorno
 * `TINKAZO_ESCUCHA`, la carpeta de la página de escucha, de la que se lee `elecciones.json`. Si no está ninguna de las dos,
 * el script lo dice y sale con error. Con `--simular` muestra lo que cambiaría sin escribir.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { aplicarElecciones, CLAVE_MEZCLA, leerElegidas, textoDeElegidas } from "./carrera-aplicar-lib.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const carpetaEscucha = process.env.TINKAZO_ESCUCHA;
const rutaElecciones = opt("--elecciones", carpetaEscucha ? join(carpetaEscucha, "elecciones.json") : "");
if (!rutaElecciones) {
  console.error("Falta el archivo de elecciones: pasalo con --elecciones <elecciones.json> o poné en TINKAZO_ESCUCHA la carpeta de la página de escucha (de ahí se lee elecciones.json).");
  process.exit(1);
}
if (!existsSync(rutaElecciones)) {
  console.error(`No existe ${rutaElecciones}: revisá --elecciones o TINKAZO_ESCUCHA.`);
  process.exit(1);
}
const simular = args.includes("--simular");
const destino = join(RAIZ, "src", "sonidos", "carrera-elegidas.ts");

const elecciones = JSON.parse(readFileSync(rutaElecciones, "utf8"));
const actual = readFileSync(destino, "utf8").replace(/\r\n/g, "\n");
const { nuevas, cambios, faltan } = aplicarElecciones(leerElegidas(actual), elecciones);

console.log(`Elecciones de ${rutaElecciones}${elecciones.actualizado ? ` (guardadas ${elecciones.actualizado})` : ""}`);
for (const c of cambios) {
  const nota = c.pieza !== CLAVE_MEZCLA ? "" : c.a === "chico" ? " (la mezcla para parlante chico vale también sin candidatas, en los diez juegos)" : " (la mezcla para parlante chico solo suena con candidatas)";
  console.log(`  ${c.pieza.padEnd(10)} ${c.de} -> ${c.a}${c.dijo !== c.a ? ` (eligió "${c.dijo}")` : ""}${nota}`);
}
if (!cambios.length) console.log("  nada cambia");
if (faltan.length) console.log(`  sin elegir (quedan como están): ${faltan.join(", ")}`);
if (simular) {
  console.log("--simular: no escribí nada");
} else if (cambios.length) {
  const crlf = readFileSync(destino, "utf8").includes("\r\n");
  const texto = textoDeElegidas(nuevas);
  writeFileSync(destino, crlf ? texto.replace(/\n/g, "\r\n") : texto);
  console.log(`Escribí ${destino}. Falta: pnpm typecheck, audit-sound y audit-mezcla de la carrera, y el commit.`);
}
