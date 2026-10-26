#!/usr/bin/env node
/**
 * Crea un juego nuevo sobre el kit (`src/games/pixi/kit/`).
 *
 *   node scripts/nuevo-juego.mjs <id> [--nombre "El Guajojó"] [--nombre-en "The Guajojó"] [--dry-run]
 *   node scripts/nuevo-juego.mjs --encender <id> [--dry-run]
 *
 * `<id>` son de 3 a 12 letras minúsculas: es el valor de `?demo=` y la clave de
 * los auditores. Crea el plan puro con sus pruebas, la escena, los textos del
 * relator en español y en inglés y la página de diseño, y suma el juego al
 * catálogo y a los dos diccionarios. El juego nace apagado en el selector:
 * abre con `?demo=<id>&instant=1` y pasa `audit-game` sin tocar nada a mano.
 * `docs/juegos.md`, "Cómo nace un juego".
 *
 * `--raiz <carpeta>` lo corre sobre otra copia del repositorio.
 */
import { RAIZ, aplicar, encender } from "./lib/nuevo-juego.mjs";

const args = process.argv.slice(2);
const valor = (nombre) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : undefined;
};
const conValor = new Set(["--nombre", "--nombre-en", "--raiz", "--encender"]);
const sueltos = args.filter((a, i) => !a.startsWith("--") && !conValor.has(args[i - 1]));
const raiz = valor("--raiz") ?? RAIZ;
const dryRun = args.includes("--dry-run");

function uso() {
  console.error('uso: node scripts/nuevo-juego.mjs <id> [--nombre "El Guajojó"] [--nombre-en "..."] [--dry-run]');
  console.error("     node scripts/nuevo-juego.mjs --encender <id> [--dry-run]");
  process.exit(2);
}

try {
  if (args.includes("--encender")) {
    const id = valor("--encender");
    if (!id) uso();
    const r = encender({ raiz, id, dryRun });
    console.log(`${dryRun ? "(en seco) " : ""}${id}: encendido en el selector.`);
    for (const s of r.siguientes) console.log(`  - ${s}`);
  } else {
    const id = sueltos[0];
    if (!id) uso();
    const r = aplicar({ raiz, id, nombre: valor("--nombre"), nombreEn: valor("--nombre-en"), dryRun });
    console.log(`${dryRun ? "(en seco, no se escribió nada) " : ""}${id}: listo.`);
    console.log("\nArchivos nuevos:");
    for (const f of r.creados) console.log(`  + ${f}`);
    console.log("\nArchivos editados (entre las marcas kit:*):");
    for (const f of r.editados) console.log(`  ~ ${f}`);
    console.log("\nQué sigue:");
    r.siguientes.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
