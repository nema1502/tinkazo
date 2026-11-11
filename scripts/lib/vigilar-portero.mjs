/**
 * La revisión del portero de mainnet: lee la respuesta de `GET /v1/patrocinio/estado` (un archivo JSON que bajó el
 * paso del workflow con la clave de operar) y mira si hay algo que mirar:
 *
 * - los créditos de Pollar por debajo del piso más 1.000 (o sin leer);
 * - la cuenta patrocinadora baja o sin leer (`alerta`);
 * - más de 10 firmas sin explicar en las últimas 24 horas (o sin la vigilancia);
 * - el patrocinio de la app en Pollar que no está todo apagado (o sin leer);
 * - y que no sea el portero de mainnet: no se da por bueno el portero equivocado.
 *
 * Sale con 1 (y GitHub manda el correo) solo cuando hay algo que avisar, no en cada corrida con un problema: cada
 * problema tiene una clave estable (sin las cifras, que se mueven) y el script recuerda las que ya avisó
 * (`--anterior` y `--guardar`; en GitHub, en la caché de Actions). Avisa cuando aparece un problema que la corrida
 * anterior no tenía, y de nuevo, como recordatorio, cuando el mismo problema sigue pasadas 23 horas del último aviso.
 * Un problema que se arregla se olvida: si vuelve, es nuevo. En las demás corridas muestra las cifras, dice que ya se
 * avisó y sale con 0. Sin archivo de antes (la primera vez) nada se avisó.
 *
 * Sin dependencias, solo Node: el workflow no instala nada. Lo que mide cada cifra está en
 * `workers/patrocinio/README.md`, «Altas y cupones».
 *
 *   node scripts/lib/vigilar-portero.mjs estado-portero-mainnet.json [--anterior N.json] [--guardar N.json]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Lo que tiene que sobrar de créditos encima del piso. */
export const MARGEN_MINIMO = 1000;
/** Más que esto sin explicar en 24 horas es para mirar (el mismo número que `FIRMAS_SIN_EXPLICAR_MAX` del portero). */
export const MAX_SIN_EXPLICAR = 10;
/**
 * Cada cuánto se repite el aviso de un problema que sigue igual. Son 23 horas y no 24: GitHub corre el cron con minutos
 * de atraso, y con 24 la hora del recordatorio se iría corriendo una hora cada vez que una corrida llegue un poco antes.
 */
export const RECORDATORIO_HORAS = 23;

const HORA_MS = 3_600_000;
const esNumero = (x) => typeof x === "number" && Number.isFinite(x);

/**
 * Los problemas de este `/estado` (vacío si está todo en orden), una clave estable para cada uno (en el mismo orden;
 * dice cuál es el problema, no cuánto: el mismo problema con otras cifras es el mismo) y una línea con las cifras.
 */
export function revisarPortero(e) {
  const problemas = [];
  const claves = [];
  const hay = (clave, texto) => {
    claves.push(clave);
    problemas.push(texto);
  };
  if (!e || typeof e !== "object") return { problemas: ["la respuesta de /estado no es un objeto"], claves: ["respuesta-invalida"], resumen: "sin datos" };
  if (e.red !== "mainnet") hay("no-es-mainnet", `no es el portero de mainnet (red: ${String(e.red)})`);
  if (e.alerta !== false) hay(`patrocinadora-baja:${String(e.motivoAlerta ?? "sin-motivo")}`, `la cuenta patrocinadora está baja o no se pudo leer (${e.motivoAlerta ?? "sin alerta en la respuesta"})`);
  if (!esNumero(e.creditos) || !esNumero(e.piso)) hay("creditos-sin-leer", "no se pudo leer el saldo de créditos de Pollar o el piso");
  else if (e.creditos < e.piso + MARGEN_MINIMO) hay("creditos-bajos", `los créditos de Pollar (${e.creditos}) están por debajo del piso más ${MARGEN_MINIMO} (${e.piso + MARGEN_MINIMO}): cargar créditos`);
  if (!esNumero(e.firmasSinExplicar)) hay("firmas-sin-comparar", "no se pudo comparar las firmas que cobró Pollar con las nuestras");
  else if (e.firmasSinExplicar > MAX_SIN_EXPLICAR) hay("firmas-sin-explicar", `${e.firmasSinExplicar} firmas de cuentas de Google sin explicar en 24 horas (más de ${MAX_SIN_EXPLICAR}): alguien firma por fuera del sitio`);
  const pat = e.patrocinioPollar;
  if (!pat || typeof pat !== "object") hay("patrocinio-sin-leer", "no se pudo leer el patrocinio de la app en Pollar");
  else if (pat.esperado !== true) {
    const prendidos = Array.isArray(pat.prendidos) ? pat.prendidos.map(String).sort() : [];
    hay(`patrocinio-prendido:${prendidos.join(",")}`, `el patrocinio de la app en Pollar no está todo apagado: ${prendidos.length ? prendidos.join(", ") : "sin detalle"}`);
  }

  const f = e.firmas && typeof e.firmas === "object" ? e.firmas : {};
  const resumen = [
    `créditos ${e.creditos ?? "?"}, piso ${e.piso ?? "?"}`,
    `patrocinadora ${e.balanceStroops ?? "?"} stroops`,
    `firmas: ${f.cobradas ?? "?"} cobradas, ${f.explicadas ?? "?"} explicadas, ${e.firmasSinExplicar ?? "?"} sin explicar${f.completo === false ? " (vinieron 200 movimientos: puede haber más)" : ""}`,
    `patrocinio ${pat?.esperado === true ? "apagado" : pat ? "prendido" : "?"}`,
  ].join(" | ");
  return { problemas, claves, resumen };
}

/** Lo que se recuerda entre corridas: las claves de los problemas que ya se avisaron y cuándo fue el último aviso. */
export const sinRecordar = () => ({ claves: [], avisadoEn: null });

/** Lo recordado a partir del texto del archivo; con cualquier cosa rara es como si nada se hubiera avisado. */
export function leerRecordado(texto) {
  try {
    const j = JSON.parse(texto);
    const claves = Array.isArray(j?.claves) && j.claves.every((c) => typeof c === "string") ? [...new Set(j.claves)].sort() : null;
    const cuando = typeof j?.avisadoEn === "string" ? Date.parse(j.avisadoEn) : Number.NaN;
    if (!claves || Number.isNaN(cuando)) return sinRecordar();
    return { claves, avisadoEn: new Date(cuando).toISOString() };
  } catch {
    return sinRecordar();
  }
}

/** Lo recordado como se escribe en el archivo. */
export const escribirRecordado = (recordado) => `${JSON.stringify(recordado)}\n`;

/**
 * ¿Hay que avisar (salir con 1)? Recibe las claves de los problemas de ahora, lo recordado de la corrida anterior y la
 * fecha, y devuelve si avisar, por qué y lo que hay que recordar para la próxima. Es una función pura.
 *
 * - Sin problemas: no avisa y se olvida todo, así un problema que vuelve es nuevo.
 * - Hay un problema que no estaba entre los avisados: avisa (`nuevo`).
 * - Son los mismos (o menos, porque se arregló alguno): avisa solo si pasaron `RECORDATORIO_HORAS` desde el último
 *   aviso (`recordatorio`); si no, no (`ya-avisado`). Un problema que se arregló sale de lo recordado, sin avisar.
 */
export function decidirAviso({ claves, recordado = sinRecordar(), ahora }) {
  const actuales = [...new Set(claves)].sort();
  if (actuales.length === 0) return { avisar: false, motivo: "sin-problemas", nuevos: [], siguiente: sinRecordar() };
  const nuevos = actuales.filter((c) => !recordado.claves.includes(c));
  if (nuevos.length > 0) return { avisar: true, motivo: "nuevo", nuevos, siguiente: { claves: actuales, avisadoEn: ahora.toISOString() } };
  // Sin fecha legible o con una del futuro (el reloj se atrasó) no se sabe cuánto pasó: se recuerda, que es lo seguro.
  const pasaron = recordado.avisadoEn ? ahora.getTime() - Date.parse(recordado.avisadoEn) : Number.NaN;
  if (Number.isNaN(pasaron) || pasaron < 0 || pasaron >= RECORDATORIO_HORAS * HORA_MS) {
    return { avisar: true, motivo: "recordatorio", nuevos: [], siguiente: { claves: actuales, avisadoEn: ahora.toISOString() } };
  }
  return { avisar: false, motivo: "ya-avisado", nuevos: [], siguiente: { claves: actuales, avisadoEn: recordado.avisadoEn } };
}

function opcion(argv, nombre) {
  const i = argv.indexOf(nombre);
  return i < 0 ? null : (argv[i + 1] ?? null);
}

/** Lo recordado en ese archivo; sin archivo (la primera vez, o la caché vacía) o con uno roto, nada se avisó. */
function recordadoDe(archivo, log) {
  if (!archivo) return sinRecordar();
  try {
    return leerRecordado(readFileSync(archivo, "utf8"));
  } catch (e) {
    if (e?.code !== "ENOENT") log(`No se pudo leer lo avisado antes (${e instanceof Error ? e.message : String(e)}); se toma como si nada se hubiera avisado.`);
    return sinRecordar();
  }
}

/** Lee el archivo, muestra el resumen y los problemas, y devuelve el código de salida: 1 solo si hay que avisar. */
export function principal(argv, { log = console.log, ahora = new Date() } = {}) {
  const anterior = opcion(argv, "--anterior");
  const guardar = opcion(argv, "--guardar");
  const archivo = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--anterior" && argv[i - 1] !== "--guardar");
  if (!archivo) {
    log("Uso: node scripts/lib/vigilar-portero.mjs <estado.json> [--anterior N.json] [--guardar N.json]");
    return 1;
  }
  let revision;
  try {
    revision = revisarPortero(JSON.parse(readFileSync(archivo, "utf8")));
  } catch (e) {
    // Un portero que no contesta es un problema como los otros: se avisa una vez, no en cada corrida.
    revision = { problemas: [`No se pudo leer ${archivo}: ${e instanceof Error ? e.message : String(e)}`], claves: ["sin-lectura"], resumen: "sin datos" };
  }
  const { problemas, claves, resumen } = revision;
  const recordado = recordadoDe(anterior, log);
  const decision = decidirAviso({ claves, recordado, ahora });
  // Lo avisado se guarda aunque se avise: si no, el mismo aviso se repetiría en cada corrida.
  if (guardar) {
    mkdirSync(dirname(guardar), { recursive: true });
    writeFileSync(guardar, escribirRecordado(decision.siguiente));
  }
  log(resumen);
  for (const p of problemas) log(`Problema: ${p}`);
  if (decision.motivo === "ya-avisado") {
    const hasta = new Date(Date.parse(recordado.avisadoEn) + RECORDATORIO_HORAS * HORA_MS).toISOString();
    log(`Ya se avisó de esto el ${recordado.avisadoEn}: no se vuelve a avisar hasta pasado el ${hasta} o hasta que aparezca otro problema. Esta corrida sale bien.`);
  } else if (decision.motivo === "recordatorio") {
    log(`Sigue el mismo problema pasadas ${RECORDATORIO_HORAS} horas del último aviso: se avisa de nuevo.`);
  } else if (decision.motivo === "nuevo") {
    log("Es un problema que no se había avisado: se avisa.");
  }
  return decision.avisar ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2));
}
