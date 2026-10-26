#!/usr/bin/env node
/**
 * El revisor de español neutral.
 *
 * Recorre los textos en español de `src/i18n.ts` y de los HTML de la raíz (sin
 * `historia.html`, donde las palabras de acá son el tema) y falla si aparece
 * alguna de las que `scripts/lib/glosario-neutral.json` manda evitar. Los
 * nombres de los juegos se borran antes de mirar. El voseo se mantiene: lo que
 * se pide neutral es el vocabulario cotidiano.
 *
 * Sin Chrome ni red. La lista es de Nicolás: se completa en el JSON. Una
 * entrada con `"estado": "avisar"` no falla; sus usos se ven con `--todo`.
 *
 * Uso:
 *   node scripts/check-glosario.mjs [--todo] [--json] [--raiz carpeta] [--glosario archivo.json]
 *   pnpm check:glosario
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buscarFaltas, compilar, literalesDe, textosDeHtml } from "./lib/glosario.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const raiz = resolve(opt("--raiz", join(aqui, "..")));
const glosario = JSON.parse(readFileSync(resolve(opt("--glosario", join(aqui, "lib", "glosario-neutral.json"))), "utf8"));
const entradas = compilar(glosario);
const exentas = new Set(glosario.paginasExentas ?? []);
const verTodo = args.includes("--todo");

/** Cada archivo con sus textos en español. */
const fuentes = [];
const i18n = join(raiz, "src", "i18n.ts");
if (existsSync(i18n)) {
  const src = readFileSync(i18n, "utf8");
  // Todo lo anterior al diccionario en inglés es español.
  const enAt = src.indexOf("  en: {");
  fuentes.push({ archivo: "src/i18n.ts", textos: literalesDe(enAt > 0 ? src.slice(0, enAt) : src) });
}
for (const nombre of readdirSync(raiz).filter((f) => f.endsWith(".html")).sort()) {
  if (exentas.has(nombre)) continue;
  fuentes.push({ archivo: nombre, textos: textosDeHtml(readFileSync(join(raiz, nombre), "utf8")) });
}

const checks = [];
let activas = 0;
let aAvisar = 0;
for (const { archivo, textos } of fuentes) {
  const faltas = buscarFaltas(textos, entradas, glosario.nombresDeJuegos ?? []);
  const falla = faltas.filter((f) => f.estado !== "avisar");
  const aviso = faltas.filter((f) => f.estado === "avisar");
  activas += falla.length;
  aAvisar += aviso.length;
  for (const f of falla) console.log(`  ✗ ${archivo}:${f.linea}  «${f.encontrada}» → ${f.alternativa}   (${f.fragmento})`);
  if (verTodo) for (const f of aviso) console.log(`  · ${archivo}:${f.linea}  «${f.encontrada}» → ${f.alternativa}   (${f.fragmento})`);
  checks.push({
    name: `${archivo}: sin palabras de la lista`,
    ok: falla.length === 0,
    detail: falla
      .slice(0, 3)
      .map((f) => `${f.linea}: «${f.encontrada}» → ${f.alternativa}`)
      .join(" | "),
  });
}

console.log("");
if (aAvisar && !verTodo) console.log(`  ${aAvisar} uso(s) de entradas "avisar" por decidir (--todo los muestra)`);
console.log(activas ? `RECHAZADO: ${activas} palabra(s) de la lista en ${checks.filter((c) => !c.ok).length} archivo(s)` : `APROBADO: ${fuentes.length} archivos sin palabras de la lista (${glosario.entradas.length} entradas)`);
emitirJson({ auditor: "check-glosario", objetivo: "textos", checks });
process.exit(activas ? 1 : 0);
