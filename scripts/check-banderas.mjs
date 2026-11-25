/**
 * Que la tabla de banderas de docs/operacion.md diga lo que de verdad tiene el sitio publicado.
 *
 * Las funciones del sitio se prenden con variables VITE_ que se leen al construir y quedan
 * escritas en su código. Un documento que dice 'apagada en producción' de una bandera que
 * está prendida hace tomar decisiones con un dato falso. Esto baja la portada, baja sus
 * archivos de código, saca el valor de cada variable que quedó escrita y lo compara con la
 * tabla de la sección 'Las banderas del sitio y su estado en producción'.
 *
 * Falla, con un mensaje por cada diferencia, si una fila no coincide con el sitio o si el
 * sitio trae una variable que la tabla no nombra. Las variables del sistema de publicación
 * (VITE_VERCEL_*) no se leen ni se muestran. El valor de una variable reservada (un monto,
 * una dirección o una llave pública) tampoco se escribe nunca: la tabla dice solo `definida`
 * y acá solo se comprueba que exista.
 *
 * Un corte del sitio no tiene que dar una falsa alarma: cada archivo que no baja se pide de
 * nuevo dos veces antes de darlo por caído, los que de todos modos no bajan se nombran en el
 * informe (nunca se saltean en silencio) y la lectura entera tiene un tope de 90 segundos, para
 * fallar con su propio mensaje antes de que la corte el tope del trabajo que la corre.
 *
 * Solo lee: no necesita cuenta ni llaves. Depende del sitio publicado, así que corre en la
 * vigilancia diaria y no en la revisión de cada pedido.
 *
 * Uso:
 *   node scripts/check-banderas.mjs                      # contra https://tinkazo.app
 *   node scripts/check-banderas.mjs --base https://otro.ejemplo
 *   node scripts/check-banderas.mjs --doc docs/operacion.md
 *   pnpm check:banderas
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitirJson } from "./lib/resumen.mjs";
import { bajarConReintentos, comparar, describirNoBajaron, leerDelSitio, leerTabla, TITULO_SECCION, TOPE_TOTAL_MS } from "./lib/banderas.mjs";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opcion = (nombre, def) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opcion("--base", "https://tinkazo.app").replace(/\/+$/, "");
const doc = resolve(RAIZ, opcion("--doc", "docs/operacion.md"));
/** Tope de archivos que se bajan: la portada nombra unos 70, y esto corta una cadena de enlaces sin fin. */
const MAX_ARCHIVOS = 250;
const limite = Date.now() + TOPE_TOTAL_MS;

// Último recurso: si algo se colgara sin que lo corte ni el tiempo de cada archivo ni el tope de la lectura,
// el guion termina igual y lo dice, antes de que lo corte el trabajo que lo corre.
setTimeout(() => {
  console.log(`\nRECHAZADO: la comprobación pasó de ${(TOPE_TOTAL_MS + 10_000) / 1000} segundos y se cortó`);
  process.exit(1);
}, TOPE_TOTAL_MS + 10_000).unref();

const registro = [];
let fallos = 0;
function check(ok, nombre, detalle = "") {
  registro.push({ name: nombre, ok, detail: detalle });
  if (!ok) fallos++;
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? `: ${detalle}` : ""}`);
}

const huella = (v) => JSON.stringify([...v.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

let tablaMd;
try {
  tablaMd = await readFile(doc, "utf8");
} catch (e) {
  console.log(`RECHAZADO: no se pudo leer ${doc}: ${e.message}`);
  process.exit(1);
}
const tabla = leerTabla(tablaMd);
check(tabla.encontrada, `la tabla de banderas está en ${opcion("--doc", "docs/operacion.md")}`, tabla.encontrada ? "" : `falta la sección '${TITULO_SECCION}'`);
if (tabla.encontrada) {
  check(tabla.problemas.length === 0, "la tabla está bien escrita", tabla.problemas.join(". "));
  if (tabla.lectura) console.log(`Fecha de lectura que dice la tabla: ${tabla.lectura}`);
}

let sitio = null;
if (tabla.encontrada && tabla.filas.length) {
  try {
    sitio = await leerDelSitio({
      base,
      maxArchivos: MAX_ARCHIVOS,
      limite,
      bajar: (url) => bajarConReintentos(url, { limite }),
    });
  } catch (e) {
    check(false, `se pudo leer el sitio ${base}`, e instanceof Error ? e.message : "sin respuesta");
  }
}
if (sitio) {
  const cortes = describirNoBajaron(sitio.noBajaron);
  const mirados = sitio.archivos + sitio.noBajaron.length;
  if (sitio.sinTiempo) {
    check(false, "la lectura del sitio terminó a tiempo", `se acabaron los ${TOPE_TOTAL_MS / 1000} segundos con ${sitio.archivos} archivos bajados. ${cortes}. Parece lentitud o un corte del sitio y no un cambio de las banderas`);
  }
  if (sitio.copias.length) {
    check(true, "el código del sitio trae el objeto de variables", `en ${mirados} archivos mirados${cortes ? `. Ojo, ${cortes}` : ""}`);
  } else if (!sitio.sinTiempo) {
    const causa = cortes ? `Ojo, ${cortes}: puede ser un corte y no un cambio del empaquetado` : "puede haber cambiado el empaquetado y habría que enseñarle a esta comprobación dónde mirar";
    check(false, "el código del sitio trae el objeto de variables", `no se encontró en ${mirados} archivos. ${causa}`);
  }
  if (sitio.copias.length) {
    const distintas = new Set(sitio.copias.map(huella));
    check(distintas.size === 1, "las copias del objeto de variables coinciden entre sí", distintas.size === 1 ? "" : "el sitio trae dos conjuntos distintos de variables");
    const r = comparar(tabla.filas, sitio.copias[0]);
    for (const f of r.filas) check(f.ok, f.variable, f.estado);
    const sueltas = r.fallas.filter((m) => m.includes("la tabla no la nombra"));
    for (const m of sueltas) check(false, "variable que la tabla no nombra", m);
    if (r.fallas.length) {
      console.log("\nDiferencias entre la tabla y el sitio publicado:");
      for (const m of r.fallas) console.log(`  - ${m}`);
    }
  }
}

console.log(fallos ? `\nRECHAZADO: ${fallos} comprobaciones` : "\nAPROBADO: la tabla de banderas dice lo que tiene el sitio");
emitirJson({ auditor: "check-banderas", objetivo: base, checks: registro });
process.exit(fallos ? 1 : 0);
