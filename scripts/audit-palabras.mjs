#!/usr/bin/env node
/**
 * El auditor de palabras: lo que Tinkazo no puede decir.
 *
 * Lee todo el texto visible del repo (el diccionario del sitio en los dos
 * idiomas, los literales de `src/games/**` y de las pantallas, las tarjetas de
 * historia y las páginas de lectura) y falla por dos grupos de
 * `scripts/lib/palabras-prohibidas.json`:
 *  - apuesta: lo que huele a casino.
 *  - vocabulario: «eliminado» en los juegos de quedar de pie, «gana» en el
 *    ensayo y el stand, el punto medio, y los tecnicismos en el show.
 *
 * Sin Chrome ni red. Las excepciones viven en el mismo JSON, con motivo y fecha;
 * las marcadas `pendiente` aprueban pero se listan.
 *
 * Uso:
 *   node scripts/audit-palabras.mjs [juego|todos|sitio|todo] [--json] [--raiz carpeta] [--datos archivo.json]
 *   pnpm audit:palabras
 *
 * `todos` son las cadenas de los juegos, `sitio` lo demás, y sin nombre (o
 * `todo`) las dos cosas.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FUERA_DEL_SELECTOR, SELECTOR, juegosDelKit } from "./lib/juegos.mjs";
import { aplicarExcepciones, hallazgosDe, recolectar, reglasDe, unidadDe } from "./lib/palabras.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const raiz = resolve(opt("--raiz", join(aqui, "..")));
const datos = JSON.parse(readFileSync(resolve(opt("--datos", join(aqui, "lib", "palabras-prohibidas.json"))), "utf8"));
const posicional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--raiz", "--datos"].includes(args[i - 1])));
const objetivo = posicional[0] ?? "todo";

const inicio = Date.now();
const juegos = [...new Set([...SELECTOR, ...FUERA_DEL_SELECTOR, ...juegosDelKit()])];
const unidadesJuegos = [...juegos, "comun"];
let unidades;
if (objetivo === "todo") unidades = [...unidadesJuegos, "sitio"];
else if (objetivo === "todos") unidades = unidadesJuegos;
else if (objetivo === "sitio") unidades = ["sitio"];
else if (unidadesJuegos.includes(objetivo)) unidades = [objetivo];
else {
  console.error(`objetivo desconocido: ${objetivo} (un juego, todos, sitio o todo)`);
  process.exit(2);
}

const textos = recolectar(raiz).filter((t) => unidades.includes(unidadDe(t)));
const reglas = reglasDe(datos);
const todos = hallazgosDe(textos, reglas);
const { fallan, cubiertos, sinUso } = aplicarExcepciones(todos, datos.excepciones ?? []);
// Una excepción sin uso solo se reclama cuando se mira todo: con un juego solo, las demás no tienen por qué cubrir nada.
const revisaTodo = objetivo === "todo";

const checks = [];
for (const u of unidades) {
  for (const grupo of ["apuesta", "vocabulario"]) {
    const malos = fallan.filter((h) => h.juego === u && h.grupo === grupo);
    const nTextos = textos.filter((t) => unidadDe(t) === u).length;
    if (!nTextos && u !== "sitio" && !juegosConTextos(u)) continue;
    checks.push({
      name: `${grupo}: ${u}`,
      ok: malos.length === 0,
      detail: malos
        .slice(0, 3)
        .map((h) => `${h.archivo}:${h.linea}${h.clave ? ` [${h.clave}]` : ""} «${h.palabra}» (${h.regla}) en «${h.fragmento}»`)
        .join(" | "),
    });
  }
}
function juegosConTextos(u) {
  return textos.some((t) => unidadDe(t) === u);
}
if (revisaTodo) {
  checks.push({
    name: "excepciones: todas siguen haciendo falta",
    ok: sinUso.length === 0,
    detail: sinUso.map((e) => `${e.archivo} «${e.palabra ?? e.contiene ?? ""}»`).join(" | "),
  });
}

for (const h of fallan) console.log(`  ✗ ${h.archivo}:${h.linea}${h.clave ? ` [${h.clave}]` : ""}  ${h.grupo}/${h.regla}  «${h.palabra}»   (${h.fragmento})`);
const pendientes = cubiertos.filter((h) => h.excepcion.pendiente);
const decididas = cubiertos.length - pendientes.length;
for (const h of pendientes) console.log(`  ~ pendiente ${h.archivo}:${h.linea}${h.clave ? ` [${h.clave}]` : ""}  ${h.regla}  «${h.palabra}»   ${h.excepcion.motivo}`);
if (revisaTodo) for (const e of sinUso) console.log(`  ✗ excepción sin uso: ${e.archivo} «${e.palabra ?? e.contiene ?? ""}»`);

console.log("");
console.log(`${textos.length} textos recorridos en ${unidades.length} unidad(es); ${decididas} uso(s) permitido(s) por excepción; ${pendientes.length} pendiente(s).`);
const malas = checks.filter((c) => !c.ok).length;
console.log(malas ? `RECHAZADO: ${fallan.length} hallazgo(s) en ${malas} comprobación(es)` : `APROBADO: ${checks.length} comprobaciones sin palabras prohibidas`);
emitirJson({
  auditor: "audit-palabras",
  objetivo,
  checks,
  segundos: Math.round((Date.now() - inicio) / 100) / 10,
  datos: { textos: textos.length, pendientes: pendientes.length, permitidas: decididas },
});
process.exit(malas ? 1 : 0);
