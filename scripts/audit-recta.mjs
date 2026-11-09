#!/usr/bin/env node
/**
 * El auditor de la recta de la carrera nueva (`?carrera=nueva`), a nivel del plan y sin Chrome.
 *
 * Es `audit-delatores race --nueva` con las cantidades de la batería (de 2 a 200 personas): el adivinador del camino entero (con
 * ocho carriles, 13,2 % o menos hasta el 88 % de la recta; con menos, el azar más tres errores estándar), las señales del acordeón y
 * de los sucesos, y el auditor de arco: que los arcos varíen y que ninguno diga, antes del acordeón, quién gana. Detalle en
 * `scripts/lib/delatores-bayes.mjs` y `scripts/audit-delatores.mjs`.
 *
 * Uso:
 *   node scripts/audit-recta.mjs [--semillas 600] [--n 2,3,5,8,9,18,60,200] [--bayes 60000,20000] [--json salida.json]
 *
 * Lo que se pasa pisa los valores de la batería.
 */
const dados = process.argv.slice(2);
const tiene = (f) => dados.includes(f);
const por = [["--semillas", "600"], ["--n", "2,3,5,8,9,18,60,200"], ["--bayes", "60000,20000"]].filter(([f]) => !tiene(f)).flat();
process.argv.splice(2, process.argv.length, "race", "--nueva", ...por, ...dados);
await import("./audit-delatores.mjs");
