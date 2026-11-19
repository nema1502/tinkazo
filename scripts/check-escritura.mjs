#!/usr/bin/env node
/**
 * El control de escritura.
 *
 * En lo que lee la persona no van comillas angulares ni punto y coma, en
 * español ni en inglés (docs/marca.md, "Cómo se escribe"). Este control
 * recorre el diccionario del sitio y las demás cadenas de `src/`, el texto
 * visible de las páginas HTML, el manifiesto y los textos descargables de
 * `public/marca`, y lista cada aparición con su archivo y su línea.
 *
 * No mira comentarios de código, pruebas, CSS, `docs/`, README, `scripts/` ni
 * los textos de licencias de terceros. Las cadenas sueltas de código cuentan
 * solo si parecen una oración (ver `scripts/lib/escritura.mjs`). Lo que se
 * excluye a mano vive en `scripts/lib/escritura-exclusiones.json`, cada
 * exclusión con su porqué.
 *
 * Sin Chrome ni red.
 *
 * Uso:
 *   node scripts/check-escritura.mjs               sale con 1 si encuentra algo
 *   node scripts/check-escritura.mjs --informe     todo, agrupado por archivo; sale con 0
 *   node scripts/check-escritura.mjs --json        lo mismo para máquinas; sale con 0
 *   opciones: --excluidas (muestra también lo excluido), --raiz carpeta, --exclusiones archivo.json
 *   pnpm check:escritura
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { agruparPorArchivo, revisarRaiz } from "./lib/escritura.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const raiz = resolve(opt("--raiz", join(aqui, "..")));
const archivoExclusiones = resolve(opt("--exclusiones", join(aqui, "lib", "escritura-exclusiones.json")));
const informe = args.includes("--informe");
const json = args.includes("--json");
const verExcluidas = args.includes("--excluidas");

const exclusiones = existsSync(archivoExclusiones) ? (JSON.parse(readFileSync(archivoExclusiones, "utf8")).exclusiones ?? []) : [];
const rev = revisarRaiz(raiz, { exclusiones });
const grupos = agruparPorArchivo(rev.hallazgos);
const comillas = grupos.reduce((s, g) => s + g.comillas, 0);
const puntoYComa = grupos.reduce((s, g) => s + g.puntoYComa, 0);
const total = comillas + puntoYComa;
const nombreDelTipo = (t) => (t === "comillas" ? "comillas angulares" : "punto y coma");

if (json) {
  const salida = {
    total,
    comillas,
    puntoYComa,
    archivosRevisados: rev.archivos,
    archivos: grupos.map((g) => ({
      archivo: g.archivo,
      comillas: g.comillas,
      puntoYComa: g.puntoYComa,
      hallazgos: g.hallazgos.map((h) => ({ linea: h.linea, tipo: h.tipo, origen: h.origen, fragmento: h.fragmento })),
    })),
    excluidos: rev.excluidos.map((h) => ({ archivo: h.archivo, linea: h.linea, tipo: h.tipo, fragmento: h.fragmento, porque: h.porque })),
    exclusionesSinUso: rev.sinUso,
    cadenasSinCerrar: rev.sinCerrar,
    cadenasDeConsolaOmitidas: rev.consola,
  };
  console.log(JSON.stringify(salida, null, 2));
  process.exit(0);
}

const avisos = () => {
  for (const s of rev.sinCerrar) console.log(`  aviso: ${s.archivo}:${s.linea} tiene una cadena que no cierra, así que el lector pudo perderse en ese archivo`);
  for (const e of rev.sinUso) console.log(`  aviso: la exclusión de ${e.archivo}${e.contiene ? ` (${e.contiene})` : ""} ya no cubre nada, se puede borrar`);
  if (verExcluidas) {
    for (const h of rev.excluidos) console.log(`  excluida ${h.archivo}:${h.linea}  ${nombreDelTipo(h.tipo)}  ${h.fragmento}  (${h.porque})`);
  }
};

if (informe) {
  for (const g of grupos) {
    console.log(`\n${g.archivo}  (${g.comillas} comillas angulares, ${g.puntoYComa} punto y coma)`);
    for (const h of g.hallazgos) console.log(`  ${String(h.linea).padStart(5)}  ${(h.tipo === "comillas" ? `comilla ${h.encontrado}` : "punto y coma").padEnd(12)}  ${h.fragmento}`);
  }
  console.log("\nTotales por archivo (de más a menos):");
  const porTotal = [...grupos].sort((a, b) => b.comillas + b.puntoYComa - (a.comillas + a.puntoYComa) || a.archivo.localeCompare(b.archivo));
  for (const g of porTotal) console.log(`  ${String(g.comillas + g.puntoYComa).padStart(4)}  ${String(g.comillas).padStart(4)} comillas  ${String(g.puntoYComa).padStart(4)} punto y coma  ${g.archivo}`);
  avisos();
  console.log(`\nTotal: ${total} apariciones (${comillas} comillas angulares, ${puntoYComa} punto y coma) en ${grupos.length} archivos de ${rev.archivos} revisados.`);
  if (rev.excluidos.length) console.log(`Excluidas a mano: ${rev.excluidos.length}.`);
  process.exit(0);
}

for (const g of grupos) for (const h of g.hallazgos) console.log(`  x ${g.archivo}:${h.linea}  ${nombreDelTipo(h.tipo)}  ${h.fragmento}`);
avisos();
console.log("");
console.log(
  total
    ? `RECHAZADO: ${total} apariciones (${comillas} comillas angulares, ${puntoYComa} punto y coma) en ${grupos.length} archivo(s). Cada una se arregla reescribiendo la frase (docs/marca.md). La lista agrupada sale con --informe.`
    : `APROBADO: ${rev.archivos} archivos sin comillas angulares ni punto y coma en lo que lee la persona`,
);
process.exit(total ? 1 : 0);
