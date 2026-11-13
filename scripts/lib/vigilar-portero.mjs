/**
 * El control del portero de mainnet: lee la respuesta de `GET /v1/patrocinio/estado` (un archivo JSON que bajó el
 * paso del workflow con la clave de operar) y mira si hay algo que mirar:
 *
 * - que el portero pague los sellos y los sorteos: apagado o devuelto a Pollar no paga nada (o sin leer);
 * - que el portero tenga su llave (`llave` en null): sin ella tampoco paga;
 * - los créditos de Pollar cerca del piso (menos de 1.000 de margen) o por debajo del piso, que es cuando el portero
 *   deja de aceptar canjes de cupones; o sin leer. Con compras con QR en curso, lo que reservan (`reservasCompras`) va
 *   encima del piso, y no cubrirlo es un problema propio: avisa antes de que un 402 frene a quien tiene su dinero en
 *   camino;
 * - la cuenta patrocinadora baja o sin leer (`alerta`), y un tramo más grave cuando queda menos de la mitad del nivel
 *   de alerta;
 * - las altas pausadas a mano (`altasPausadas`);
 * - firmas sin explicar en las últimas 24 horas por encima del tope, por tramos gruesos (más de 10, de 50 y de 200), o
 *   sin la vigilancia;
 * - el patrocinio de la app en Pollar que no está todo apagado (o sin leer);
 * - y que no sea el portero de mainnet: no se da por bueno el portero equivocado.
 *
 * Sale con 1 (y GitHub manda el correo) solo cuando hay algo que avisar, no en cada corrida con un problema: cada
 * problema tiene una clave estable (sin las cifras, que se mueven) y el script recuerda las que ya avisó
 * (`--anterior` y `--guardar`; en GitHub, en la caché de Actions). Avisa cuando aparece un problema que la corrida
 * anterior no tenía, y de nuevo, como recordatorio, cuando el mismo problema sigue pasadas 23 horas del último aviso.
 * Un problema que empeora cambia de clave (de créditos bajos a créditos bajo el piso, de un tramo de firmas al
 * siguiente), así que también avisa. Un problema que se arregla se olvida: si vuelve, es nuevo. Si el portero no
 * contesta, lo ya avisado se conserva: cuando vuelva con lo mismo de antes, no se avisa otra vez. Sin archivo de antes
 * (la primera vez) nada se avisó.
 *
 * Con `--sin-memoria` (una corrida a mano o una repetición) se decide como si nada se hubiera avisado: con un problema
 * falla siempre, para que quien comprueba vea que sigue y no confunda «arreglado» con «ya avisado». Lo avisado se guarda
 * igual.
 *
 * El registro de la corrida es público, así que dice QUÉ problemas hay (con palabras) o que no hay ninguno, y nunca
 * una cifra, un saldo ni una dirección: esas se miran en `estado`, con las herramientas de operación. Con `--resumen`
 * agrega lo mismo al resumen de la corrida de GitHub (`$GITHUB_STEP_SUMMARY`).
 *
 * La revisión en sí (qué problemas hay y cuándo avisar) es pura y vive en `scripts/lib/revision-portero.mjs`, que usa
 * también el Worker del vigilante (`workers/vigilante`), la vigilancia principal. Este guion y su workflow quedan de
 * respaldo: GitHub dispara solo una parte de las corridas programadas. Acá queda lo que toca archivos y la consola.
 *
 * Sin dependencias, solo Node: el workflow no instala nada. Lo que mide cada cifra está en
 * `workers/patrocinio/README.md`, «Altas y cupones».
 *
 *   node scripts/lib/vigilar-portero.mjs estado-portero-mainnet.json [--anterior N.json] [--guardar N.json]
 *     [--sin-memoria] [--resumen N.md]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  HORA_MS,
  MARGEN_MINIMO,
  MAX_SIN_EXPLICAR,
  RECORDATORIO_HORAS,
  SIN_LECTURA,
  TRAMOS_SIN_EXPLICAR,
  decidirAviso,
  escribirRecordado,
  leerRecordado,
  revisarPortero,
  sinRecordar,
} from "./revision-portero.mjs";

// Lo de la revisión se sigue pudiendo importar desde acá, como antes.
export { MARGEN_MINIMO, MAX_SIN_EXPLICAR, RECORDATORIO_HORAS, TRAMOS_SIN_EXPLICAR, decidirAviso, escribirRecordado, leerRecordado, revisarPortero, sinRecordar };

/** Las opciones que llevan un valor atrás. */
const CON_VALOR = ["--anterior", "--guardar", "--resumen"];

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
    if (e?.code !== "ENOENT") log("No se pudo leer lo avisado antes; se toma como si nada se hubiera avisado.");
    return sinRecordar();
  }
}

/** Lo que dice la corrida al final, según lo que se decidió. */
function cierreDe(decision, recordado) {
  switch (decision.motivo) {
    case "ya-avisado": {
      const hasta = new Date(Date.parse(recordado.avisadoEn) + RECORDATORIO_HORAS * HORA_MS).toISOString();
      return `Ya se avisó de esto el ${recordado.avisadoEn}: no se vuelve a avisar hasta pasado el ${hasta} o hasta que aparezca otro problema. Esta corrida sale bien.`;
    }
    case "recordatorio":
      return `Sigue el mismo problema pasadas ${RECORDATORIO_HORAS} horas del último aviso: se avisa de nuevo.`;
    case "nuevo":
      return "Es un problema que no se había avisado: se avisa.";
    case "sin-memoria":
      return "Corrida a mano o repetida: no cuenta lo que ya se avisó, así que con un problema esta corrida falla. Las corridas del reloj siguen sin repetir el aviso.";
    default:
      return null;
  }
}

/** Lee el archivo, muestra los problemas (nunca cifras) y devuelve el código de salida: 1 solo si hay que avisar. */
export function principal(argv, { log = console.log, ahora = new Date() } = {}) {
  const anterior = opcion(argv, "--anterior");
  const guardar = opcion(argv, "--guardar");
  const resumen = opcion(argv, "--resumen");
  const sinMemoria = argv.includes("--sin-memoria");
  const archivo = argv.find((a, i) => !a.startsWith("--") && !CON_VALOR.includes(argv[i - 1]));
  if (!archivo) {
    log("Uso: node scripts/lib/vigilar-portero.mjs <estado.json> [--anterior N.json] [--guardar N.json] [--sin-memoria] [--resumen N.md]");
    return 1;
  }
  let lectura;
  try {
    lectura = revisarPortero(JSON.parse(readFileSync(archivo, "utf8")));
  } catch {
    // Un portero que no contesta es un problema como los otros: se avisa una vez, no en cada corrida. No se copia el
    // motivo del error: puede traer un pedazo de lo que había en el archivo.
    lectura = { problemas: ["No se pudo leer la respuesta del portero: no contestó bien o lo que mandó no se entiende"], claves: [SIN_LECTURA] };
  }
  const { problemas, claves } = lectura;
  const recordado = recordadoDe(anterior, log);
  const decision = decidirAviso({ claves, recordado, ahora, usarMemoria: !sinMemoria });
  // Lo avisado se guarda aunque se avise: si no, el mismo aviso se repetiría en cada corrida.
  if (guardar) {
    mkdirSync(dirname(guardar), { recursive: true });
    writeFileSync(guardar, escribirRecordado(decision.siguiente));
  }
  const avisadoAntes = (i) => (recordado.claves.includes(claves[i]) ? "ya se había avisado" : "no se había avisado");
  const cierre = cierreDe(decision, recordado);
  if (problemas.length === 0) log("Sin problemas.");
  for (const p of problemas) log(`Problema: ${p}`);
  if (cierre) log(cierre);
  if (resumen) {
    const lineas = ["## Portero de mainnet", ""];
    if (problemas.length === 0) lineas.push("Sin problemas.");
    else lineas.push("Problemas:", "", ...problemas.map((p, i) => `- ${p} (${avisadoAntes(i)})`), "", cierre);
    appendFileSync(resumen, `${lineas.join("\n")}\n`);
  }
  return decision.avisar ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2));
}
