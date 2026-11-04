/**
 * La percepción de la carrera de llamas, sobre el plan y sin navegador.
 *
 *   node scripts/medir-drama-carrera.mjs [--rondas 1500] [--n 8,18,60] [--nueva] [--json archivo]
 *
 * Mide cinco cosas que `audit-delatores` no mira (ver `lib/drama-carrera.mjs`):
 * cuánto tiempo lleva la punta quien gana, desde cuándo ya no la suelta,
 * cuántos cambios de líder hay, cuántas carreras terminan en remontada y quién
 * recibe primero la ficha amarilla. Sin Chrome ni red.
 */
import { writeFileSync } from "node:fs";
import { cargarCarrera, rondaDe } from "./lib/delatores-carrera.mjs";
import { medirRonda, resumir, tabla } from "./lib/drama-carrera.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rondas = Math.max(1, Number(opt("--rondas", "1500")));
const tamanos = opt("--n", "8,18,60").split(",").map(Number).filter((x) => x >= 2);
const json = opt("--json", "");
const cuales = args.includes("--nueva") ? [true] : args.includes("--las-dos") ? [false, true] : [false];

const lib = await cargarCarrera();
const salida = {};
for (const nueva of cuales) {
  for (const n of tamanos) {
    const filas = [];
    const desde = Date.now();
    for (let i = 1; i <= rondas; i++) {
      const { ctx } = rondaDe(lib, n, i);
      filas.push(medirRonda(lib.planCarrera(ctx, { nueva })));
    }
    const titulo = `${nueva ? "carrera nueva" : "carrera de siempre"} con ${n} personas`;
    console.log(`\n== ${titulo} (${((Date.now() - desde) / 1000).toFixed(1)} s)`);
    const recta = resumir(filas, "recta");
    const total = resumir(filas, "total");
    console.log(tabla(recta, "la recta (de que se abre a la meta)"));
    if (total) console.log(tabla(total, "toda la carrera (de la salida a la meta)"));
    salida[`${nueva ? "nueva" : "siempre"}-n${n}`] = { recta, total };
  }
}
if (json) {
  writeFileSync(json, JSON.stringify(salida, null, 1));
  console.log(`detalle en ${json}`);
}
