/**
 * El control del portero de mainnet: lee la respuesta de `GET /v1/patrocinio/estado` (un archivo JSON que bajó el
 * paso del workflow con la clave de operar) y mira si hay algo que mirar:
 *
 * - los créditos de Pollar cerca del piso (menos de 1.000 de margen) o por debajo del piso, que es cuando el portero
 *   deja de aceptar canjes de cupones; o sin leer;
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
 * Sin dependencias, solo Node: el workflow no instala nada. Lo que mide cada cifra está en
 * `workers/patrocinio/README.md`, «Altas y cupones».
 *
 *   node scripts/lib/vigilar-portero.mjs estado-portero-mainnet.json [--anterior N.json] [--guardar N.json]
 *     [--sin-memoria] [--resumen N.md]
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Lo que tiene que sobrar de créditos encima del piso. */
export const MARGEN_MINIMO = 1000;
/** Más que esto sin explicar en 24 horas es para mirar (el mismo número que `FIRMAS_SIN_EXPLICAR_MAX` del portero). */
export const MAX_SIN_EXPLICAR = 10;
/**
 * Los tramos gruesos de las firmas sin explicar: pasar de uno al siguiente es empeorar y avisa; moverse dentro de un
 * tramo no. Así la clave no guarda la cifra exacta.
 */
export const TRAMOS_SIN_EXPLICAR = [MAX_SIN_EXPLICAR, 50, 200];
/**
 * Cada cuánto se repite el aviso de un problema que sigue igual. Son 23 horas y no 24: GitHub corre el cron con minutos
 * de atraso, y con 24 la hora del recordatorio se iría corriendo una hora cada vez que una corrida llegue un poco antes.
 */
export const RECORDATORIO_HORAS = 23;
/** La clave de que el portero no contestó: la única que no borra lo ya avisado. */
const SIN_LECTURA = "sin-lectura";

const HORA_MS = 3_600_000;
const esNumero = (x) => typeof x === "number" && Number.isFinite(x);
/** Un entero sin signo que viene como texto o como número, o null. Los saldos en stroops pasan de lo que cabe en un `number` exacto. */
const comoEntero = (x) => (typeof x === "string" && /^\d+$/.test(x) ? BigInt(x) : Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : null);

/** Cómo se dice cada tramo de firmas, con palabras: el registro es público y no lleva cifras. */
const TEXTO_FIRMAS = new Map([
  [TRAMOS_SIN_EXPLICAR[0], "hay firmas de cuentas de Google sin explicar en el último día, por encima del tope: alguien firma por fuera del sitio"],
  [TRAMOS_SIN_EXPLICAR[1], "hay muchas firmas de cuentas de Google sin explicar en el último día, varias veces el tope: alguien firma por fuera del sitio"],
  [TRAMOS_SIN_EXPLICAR[2], "hay una cantidad enorme de firmas de cuentas de Google sin explicar en el último día: alguien firma por fuera del sitio"],
]);

/**
 * Los problemas de este `/estado` (vacío si está todo en orden) y una clave estable para cada uno (en el mismo orden;
 * dice cuál es el problema, no cuánto: el mismo problema con otras cifras es el mismo, pero uno más grave tiene otra
 * clave). Los textos no llevan cifras: el registro de la corrida es público.
 */
export function revisarPortero(e) {
  const problemas = [];
  const claves = [];
  const hay = (clave, texto) => {
    claves.push(clave);
    problemas.push(texto);
  };
  if (!e || typeof e !== "object") return { problemas: ["la respuesta de /estado no es un objeto"], claves: ["respuesta-invalida"] };
  if (e.red !== "mainnet") hay("no-es-mainnet", `no es el portero de mainnet (red: ${String(e.red)})`);
  if (e.alerta !== false) {
    // Menos de la mitad del nivel de alerta: ya casi no queda. Sin el saldo o sin el nivel en la respuesta, no se inventa.
    const saldo = comoEntero(e.balanceStroops);
    const nivel = comoEntero(e.saldoAlertaStroops);
    if (saldo !== null && nivel !== null && saldo * 2n < nivel) hay("patrocinadora-casi-sin-saldo", "a la cuenta patrocinadora casi no le queda saldo: cargarla ya");
    else hay(`patrocinadora-baja:${String(e.motivoAlerta ?? "sin-motivo")}`, `la cuenta patrocinadora está baja o no se pudo leer (${e.motivoAlerta ?? "sin alerta en la respuesta"})`);
  }
  if (!esNumero(e.creditos) || !esNumero(e.piso)) hay("creditos-sin-leer", "no se pudo leer el saldo de créditos de Pollar o el piso");
  else if (e.creditos < e.piso) hay("creditos-bajo-el-piso", "los créditos de Pollar están por debajo del piso: el portero ya no acepta canjes de cupones nuevos, cargar créditos");
  else if (e.creditos < e.piso + MARGEN_MINIMO) hay("creditos-bajos", "los créditos de Pollar están bajos, cerca del piso: cargar créditos");
  if (e.altasPausadas === true) hay("altas-pausadas", "las altas de cuentas nuevas están pausadas a mano");
  if (!esNumero(e.firmasSinExplicar)) hay("firmas-sin-comparar", "no se pudo comparar las firmas que cobró Pollar con las nuestras");
  else {
    const tramo = TRAMOS_SIN_EXPLICAR.filter((t) => e.firmasSinExplicar > t).at(-1);
    if (tramo !== undefined) hay(`firmas-sin-explicar:mas-de-${tramo}`, TEXTO_FIRMAS.get(tramo));
  }
  const pat = e.patrocinioPollar;
  if (!pat || typeof pat !== "object") hay("patrocinio-sin-leer", "no se pudo leer el patrocinio de la app en Pollar");
  else if (pat.esperado !== true) {
    const prendidos = Array.isArray(pat.prendidos) ? pat.prendidos.map(String).sort() : [];
    hay(`patrocinio-prendido:${prendidos.join(",")}`, `el patrocinio de la app en Pollar no está todo apagado: ${prendidos.length ? prendidos.join(", ") : "sin detalle"}`);
  }
  return { problemas, claves };
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
 * - Hay un problema que no estaba entre los avisados: avisa (`nuevo`). Uno que empeora tiene otra clave, así que entra acá.
 * - Son los mismos (o menos, porque se arregló alguno): avisa solo si pasaron `RECORDATORIO_HORAS` desde el último
 *   aviso (`recordatorio`); si no, no (`ya-avisado`). Un problema que se arregló sale de lo recordado, sin avisar.
 * - Con `usarMemoria: false` (una corrida a mano o repetida) lo recordado no cuenta para decidir: con un problema avisa
 *   siempre (`sin-memoria`). Se guarda igual.
 * - Si lo único que hay es que el portero no contestó, no se sabe si lo avisado se arregló: se conserva, para que al
 *   volver con lo mismo de antes no se avise otra vez.
 */
export function decidirAviso({ claves, recordado = sinRecordar(), ahora, usarMemoria = true }) {
  const actuales = [...new Set(claves)].sort();
  if (actuales.length === 0) return { avisar: false, motivo: "sin-problemas", nuevos: [], siguiente: sinRecordar() };
  const soloSinLectura = actuales.length === 1 && actuales[0] === SIN_LECTURA;
  const guardadas = soloSinLectura ? [...new Set([...recordado.claves, ...actuales])].sort() : actuales;
  const avisaAhora = { claves: guardadas, avisadoEn: ahora.toISOString() };
  if (!usarMemoria) return { avisar: true, motivo: "sin-memoria", nuevos: actuales, siguiente: avisaAhora };
  const nuevos = actuales.filter((c) => !recordado.claves.includes(c));
  if (nuevos.length > 0) return { avisar: true, motivo: "nuevo", nuevos, siguiente: avisaAhora };
  // Sin fecha legible o con una del futuro (el reloj se atrasó) no se sabe cuánto pasó: se recuerda, que es lo seguro.
  const pasaron = recordado.avisadoEn ? ahora.getTime() - Date.parse(recordado.avisadoEn) : Number.NaN;
  if (Number.isNaN(pasaron) || pasaron < 0 || pasaron >= RECORDATORIO_HORAS * HORA_MS) {
    return { avisar: true, motivo: "recordatorio", nuevos: [], siguiente: avisaAhora };
  }
  return { avisar: false, motivo: "ya-avisado", nuevos: [], siguiente: { claves: guardadas, avisadoEn: recordado.avisadoEn } };
}

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
