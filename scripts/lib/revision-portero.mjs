/**
 * La revisión del portero de mainnet, en su parte pura: recibe el estado que devuelve `GET /v1/patrocinio/estado` y lo
 * ya avisado, y devuelve los problemas, cuáles son nuevos o empeoraron, cuáles se arreglaron y qué recordar.
 *
 * No importa nada de Node ni toca archivos, el reloj ni la consola: la usan dos lugares con la misma lógica, sin copias.
 *
 * - El guion de GitHub (`scripts/lib/vigilar-portero.mjs`), que lee el estado de un archivo y recuerda lo avisado en
 *   la caché de Actions. Es el respaldo.
 * - El Worker del vigilante (`workers/vigilante`), que lo hace cada diez minutos y recuerda lo avisado en un KV.
 *
 * Qué revisa:
 *
 * - que el portero pague los sellos y los sorteos (`modo` en portero): apagado o devuelto a Pollar no paga nada, y un
 *   modo que falta o que no se entiende es no saber si paga;
 * - que el portero tenga su llave (`llave` en null es que no la tiene, y entonces tampoco paga). Un estado que no trae
 *   el campo no se toma como que falta;
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
 * Cada problema tiene una clave estable (sin las cifras, que se mueven). Se avisa cuando aparece un problema que no se
 * había avisado, y de nuevo, como recordatorio, cuando el mismo sigue pasadas 23 horas del último aviso. Un problema que
 * empeora cambia de clave (de créditos bajos a créditos bajo el piso, de un tramo de firmas al siguiente), así que
 * también avisa. Un problema que se arregla se olvida: si vuelve, es nuevo. Si el portero no contesta, lo ya avisado se
 * conserva: cuando vuelva con lo mismo de antes, no se avisa otra vez.
 *
 * Los textos de los problemas no llevan cifras: el registro del guion de GitHub es público. Lo que mide cada cifra está
 * en `workers/patrocinio/README.md`, «Altas y cupones».
 */
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
export const SIN_LECTURA = "sin-lectura";

/** Una hora en milisegundos. */
export const HORA_MS = 3_600_000;
const esNumero = (x) => typeof x === "number" && Number.isFinite(x);
/** Un entero sin signo que viene como texto o como número, o null. Los saldos en stroops pasan de lo que cabe en un `number` exacto. */
const comoEntero = (x) => (typeof x === "string" && /^\d+$/.test(x) ? BigInt(x) : Number.isSafeInteger(x) && x >= 0 ? BigInt(x) : null);

/**
 * Los modos en que el portero no paga, con cómo se dice cada uno. Solo estos dos y `sin-leer` llegan a la clave: lo que
 * mande el portero en `modo` no entra ni a la clave ni a lo guardado.
 */
const MODOS_QUE_NO_PAGAN = new Map([
  ["apagado", "el portero está apagado: no paga ningún sello ni sorteo"],
  ["pollar", "el portero le devolvió las comisiones a Pollar: no paga ningún sello ni sorteo"],
]);

/** Los dos motivos con los que el portero marca la alerta de la cuenta patrocinadora (`motivoAlerta` en `/estado`). */
const MOTIVOS_DE_ALERTA = new Set(["saldo-bajo", "saldo-no-leido"]);

/**
 * Un texto que llega del portero, en una sola línea corta: los caracteres de control y los espacios seguidos pasan a un
 * espacio, y se corta en `max`. Con 70 entra entera cualquier bandera de verdad de Pollar (`sponsor_` y hasta 60 más),
 * así que las claves de siempre no cambian. La usan esta revisión y los correos del vigilante: no hay otra copia.
 */
export const textoLimpio = (x, max = 70) =>
  String(x)
    .replace(/[\u0000-\u001f\u007f-\u009f\s]+/g, " ")
    .trim()
    .slice(0, max);
/** Cuántas banderas prendidas entran a la clave y al correo como mucho. */
const PRENDIDOS_MAX = 10;
/**
 * Las banderas prendidas del patrocinio de la app, como entran a la clave y al correo: limpias, ordenadas y después
 * cortadas, así la misma lista da siempre lo mismo. Lo que no es una lista queda en una lista vacía.
 */
export const prendidosLimpios = (prendidos) => (Array.isArray(prendidos) ? prendidos.map((p) => textoLimpio(p)).sort().slice(0, PRENDIDOS_MAX) : []);

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
  if (e.red !== "mainnet") hay("no-es-mainnet", `no es el portero de mainnet (red: ${textoLimpio(e.red)})`);
  if (e.modo !== "portero") {
    const modo = MODOS_QUE_NO_PAGAN.has(e.modo) ? e.modo : "sin-leer";
    hay(`modo:${modo}`, MODOS_QUE_NO_PAGAN.get(modo) ?? "no se pudo leer si el portero paga");
  }
  // Solo null es que falta: un estado sin el campo no dice nada de la llave, y no se inventa.
  if (e.llave === null) hay("portero-sin-llave", "el portero no tiene cargada su llave: no paga ningún sello ni sorteo");
  if (e.alerta !== false) {
    // Menos de la mitad del nivel de alerta: ya casi no queda. Sin el saldo o sin el nivel en la respuesta, no se inventa.
    const saldo = comoEntero(e.balanceStroops);
    const nivel = comoEntero(e.saldoAlertaStroops);
    if (saldo !== null && nivel !== null && saldo * 2n < nivel) hay("patrocinadora-casi-sin-saldo", "a la cuenta patrocinadora casi no le queda saldo: cargarla ya");
    else {
      // Solo los dos motivos que manda el portero entran a la clave y al texto: cualquier otra cosa es sin-motivo.
      const motivo = MOTIVOS_DE_ALERTA.has(e.motivoAlerta) ? e.motivoAlerta : "sin-motivo";
      hay(`patrocinadora-baja:${motivo}`, `la cuenta patrocinadora está baja o no se pudo leer (${motivo === "sin-motivo" ? "sin motivo conocido" : motivo})`);
    }
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
    const prendidos = prendidosLimpios(pat.prendidos);
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

/**
 * A qué problema pertenece una clave: las que son el mismo problema en otro tramo (créditos bajos y créditos bajo el
 * piso, un tramo de firmas y el siguiente) comparten grupo. Sirve para no dar por arreglado un problema que solo
 * cambió de gravedad.
 */
export function grupoDeClave(clave) {
  if (clave.startsWith("creditos-")) return "creditos";
  if (clave.startsWith("patrocinadora-")) return "patrocinadora";
  if (clave.startsWith("firmas-")) return "firmas";
  if (clave.startsWith("patrocinio-")) return "patrocinio";
  return clave.split(":")[0];
}

/**
 * Los problemas ya avisados que dejaron de estar: lo que se arregló. Recibe las claves recordadas y las de ahora.
 *
 * - Un problema que sigue, aunque más grave o menos grave (misma familia de claves), no se arregló.
 * - Si lo único que hay es que el portero no contestó (`sin-lectura`), no se sabe qué se arregló: nada.
 * - Con el portero de vuelta, `sin-lectura` sí se arregló.
 */
export function arreglados(recordadas, actuales) {
  const ahora = [...new Set(actuales)];
  if (ahora.length === 1 && ahora[0] === SIN_LECTURA) return [];
  const grupos = new Set(ahora.map(grupoDeClave));
  return [...new Set(recordadas)].filter((c) => !grupos.has(grupoDeClave(c)));
}
