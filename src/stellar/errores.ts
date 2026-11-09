/**
 * Qué le pasó a una transacción, dicho en una palabra: la clave del mensaje
 * que ve la persona (`errAnchor.<clave>` en `i18n.ts`).
 *
 * No usa el SDK de Stellar: la pantalla puede clasificar un error sin bajar
 * 700 KB. `contract.ts` lo reexporta como siempre.
 *
 * Hasta el 21 de octubre de 2026 se miraba solo `e.message` con una lista de
 * palabras, y con un corte de internet era muy común ver "la red rechazó tu
 * transacción". El corpus de `errores.test.ts`, armado provocando
 * cada error de verdad (en Chrome por DevTools, en la testnet con el SDK) y
 * con la documentación de lo que no se puede provocar acá (Safari, Firefox,
 * Pollar, Freighter), mostró por qué:
 *
 * - Safari dice "Load failed" cuando se corta la red, y no decía nada de red.
 * - El SDK de Stellar envuelve el corte en un `AxiosError` con el mismo texto:
 *   no es un `TypeError`, así que mirar solo el tipo tampoco alcanza.
 * - Un RPC caído o saturado contesta 5xx o 429, que el SDK cuenta como
 *   "Request failed with status code 503".
 * - Un error de JSON-RPC del RPC llega como un objeto plano `{ code, message }`,
 *   no como un `Error`: se leía "[object Object]".
 * - Un tiempo agotado dice "signal timed out" (Chrome), "The operation timed
 *   out." (Firefox, Safari) o "Request timed out after 30000ms" (Pollar): ninguno
 *   dice "timeout".
 * - El rechazo de la red por el SDK empieza con "Sending the transaction to the
 *   network failed!", así que la palabra "network" mandaba la secuencia corrida
 *   y la red ocupada a "red caída".
 * - Freighter dice que la persona canceló en la causa del error, no en el
 *   mensaje ("wallet-rejected").
 */

/** Códigos de error del contrato. Son ABI pública: nunca se renumeran. */
export const CONTRACT_ERRORS: Record<number, string> = {
  1: "notFound",
  2: "alreadyDrawn",
  3: "tooFewEntries",
  4: "badWinnerCount",
  5: "roundTooSoon",
  6: "roundTooFar",
  7: "roundNotReady",
  8: "invalidSignature",
  9: "metaTooLong",
};

/**
 * Cuántos ganadores admitían los contratos hasta el que sube el tope a 300 (el de testnet del 25 de octubre de 2026
 * todavía lo tiene). Con más pedidos, el contrato devuelve el error 4 aunque la lista alcance: no es que sobren
 * ganadores, es que esa red todavía no llega. La clave sigue siendo `badWinnerCount` (el contador de errores la cuenta
 * como lo que es, el error 4); quien muestra el mensaje (`anchorErrorText`) lo cambia si sabe cuántos se pidieron.
 */
export const TOPE_DE_LOS_CONTRATOS_VIEJOS = 32;

/**
 * La cuenta existe y no tiene con qué pagar la comisión. Cada quien lo cuenta a
 * su manera: la red dice `tx_insufficient_balance` (o `txINSUFFICIENT_BALANCE`),
 * Pollar lo guarda como `txInsufficientBalance` y le agrega "Insufficient XLM to
 * cover the network fee…", y un pago que no alcanza dice `underfunded`.
 *
 * Lo que NO entra, aunque se parezca: `tx_insufficient_fee` (ahí la cuenta puede
 * tener de sobra y es la comisión ofrecida la que quedó corta para lo que la red
 * cobra ahora), `tx_bad_seq` y el resto de los códigos de la red.
 */
export const SIN_SALDO = /tx_?insufficient_?balance|insufficient\s+(?:xlm|balance|funds)|underfunded/i;
export const COMISION_CORTA = /tx_?insufficient_?fee/i;
/**
 * La cuenta ni siquiera existe todavía en la red: simular falla con "Account not
 * found", y al enviar la red dice `tx_no_account`. Para quien trae su cuenta de
 * afuera (Freighter) es lo mismo que no tener saldo. Para una cuenta de Pollar
 * es que todavía no la abrieron, y se espera (ver `conCuentaLista`).
 *
 * Ojo: el SDK dice "Account not found" también cuando la consulta no llegó (un
 * corte de red). `anchor.ts` lo desarma antes de que llegue acá.
 */
export const SIN_CUENTA = /account not found|tx_?no_?account/i;
/** Lo que lanza `conCuentaLista` cuando se esperó y la cuenta sigue sin existir. */
const CUENTA_NO_LISTA = /account-not-ready/;

/**
 * Pollar 0.12 (24 de octubre de 2026), tres cosas que antes no existían:
 *
 * - `SDK_WALLET_RECOVERY_REQUIRED`: la cuenta de Pollar en mainnet es de Turnkey y, hasta que tenga una forma de
 *   recuperarla (una llave de acceso, un código por correo u otro aparato), no firma nada. Se arregla en el paso
 *   "Protegé tu cuenta" (`ui/proteger-cuenta.ts`), no con otro intento.
 * - `SDK_CONFIRMATION_UNAVAILABLE` y `SDK_CONFIRMATION_DECLINED`: la firma pide confirmación y nadie la atendió, o la
 *   rechazamos nosotros (`wallet-pollar.ts` solo confirma el sello y el sorteo que la persona acaba de pedir).
 * - `SDK_CREDITS_INSUFFICIENT`, `SDK_BILLING_OVERDUE` y `FUND_XLM_FAILED`: a quien paga el servicio se le acabó con qué
 *   pagar. No es de la persona. (Pollar dice "Users see a generic message pointing to app support".)
 *
 * Van antes que `CANCELO`: el rechazo del SDK trae "the user declined the transaction" en el detalle.
 */
const RECUPERACION = /SDK_WALLET_RECOVERY_REQUIRED/;
const CONFIRMACION = /SDK_CONFIRMATION_(?:UNAVAILABLE|DECLINED)/;
/**
 * La cuenta de Turnkey (mainnet) co-firma cada operación, y la co-firma no se aprobó: `SDK_COSIGN_REJECTED` (la rechazó quien
 * aprueba, y el SDK la arma con el estado de la solicitud) o `SDK_COSIGN_VERIFICATION_FAILED` (la transacción no coincidía con
 * lo que se iba a firmar y el SDK no la aprobó). Es una respuesta, no un corte, y repetir da lo mismo: no se reintenta solo,
 * porque cada intento pediría otra aprobación. En `errorKey` se mira antes que `CANCELO`: el detalle puede decir
 * "rejected" o "declined".
 */
const COFIRMA_NO_APROBADA = /SDK_COSIGN_(?:REJECTED|VERIFICATION_FAILED)/;
const SERVICIO_SIN_FONDOS = /SDK_CREDITS_INSUFFICIENT|SDK_BILLING_OVERDUE|FUND_XLM_FAILED/;
/** La cuenta de Pollar se está abriendo: el SDK pide esperar, no reintentar en bucle. */
const CUENTA_ABRIENDOSE = /SDK_WALLET_NOT_READY/;

/**
 * La persona dijo que no. Freighter: "The user rejected this request." (código
 * -4), y antes "User declined access". La espera de la cuenta cancelada porque
 * se cerró la sesión cuenta igual.
 *
 * Ya no entra cualquier "cancel": Safari dice "cancelled" cuando el navegador
 * corta un pedido, y eso es la red, no la persona.
 */
const CANCELO = /User (?:declined|rejected|cancel+ed)|rejected (?:this|the) request|user denied|(?:denied|cancel+ed) by (?:the )?user|account-wait-cancelled/i;

/**
 * La billetera no firmó por otra cosa que no es la persona: Freighter con un
 * error interno, o sin decir por qué; Pollar sin la billetera conectada.
 */
const BILLETERA = /wallet-rejected|wallet encountered an internal error|Wallet not connected|guest-not-connected|pollar-submits-itself/i;

/**
 * Se mandó y no se sabe cómo terminó: quedó en la cola (`DUPLICATE`), la
 * espera se acabó con la transacción todavía viva, el resultado no llegó, o Pollar
 * lo dice con sus palabras (`TX_SUBMIT_UNCONFIRMED`, y `pollar-pending` cuando la
 * co-firma sigue pendiente).
 * Ver `envio.ts`: un sello nunca se vuelve a mandar sin antes saber esto.
 *
 * `envio-lento` es el tope de un envío que no contestó (`enviarYConfirmar`): el
 * pedido pudo haber llegado. No va con los cortes de red a propósito: un corte
 * de red antes de mandar nada se reintenta solo (`sello-seguro.ts`), y esto no.
 */
const SIN_CONFIRMAR = /tx-NOT_FOUND|tx-PENDING|\bDUPLICATE\b|sin-confirmar|envio-lento|pollar-pending|TX_SUBMIT_UNCONFIRMED|for transaction to complete, but it did not/;

/**
 * La red no la tomó y hay que volver a probar: ocupada (`TRY_AGAIN_LATER`, o un
 * 429 del RPC), demasiados pedidos seguidos a Pollar (`RATE_LIMITED`), la secuencia
 * corrida, la ventana vencida, o una comisión por encima del tope de quien la paga
 * (Pollar, `TX_FEE_LIMIT_EXCEEDED`, cuando la red sube las comisiones). Va antes que
 * la red caída: el rechazo del SDK
 * empieza con "Sending the transaction to the network failed!".
 */
const OCUPADA = /TRY_AGAIN_LATER|tx_?bad_?seq|TX_BAD_SEQUENCE|tx_?too_?late|tx-EXPIRED|TX_FEE_LIMIT_EXCEEDED|RATE_LIMITED|status code 429|HTTP 429/i;

/**
 * Entró a un ledger y falló sin decir por qué (el SDK no puede leer el
 * resultado): con la red lenta, casi siempre es la ronda que quedó demasiado
 * cerca. Pollar lo cuenta como `txFailed` o, desde su API, `TX_CONTRACT_FAILED`.
 */
const ENTRO_Y_FALLO = /Transaction failed!|tx-FAILED|txFailed|tx_failed|TX_CONTRACT_FAILED/;

/**
 * La red no contestó, se cortó, tardó demasiado o el servidor estaba caído. Cada
 * navegador lo dice distinto (ver el corpus en `errores.test.ts`):
 *
 * - Chrome, Edge, Samsung Internet: "Failed to fetch" (medido: sin red y con
 *   cada uno de los catorce cortes que simula Chrome). Desde 2024 a veces con el
 *   dominio entre paréntesis.
 * - Safari y todo navegador en iPhone: "Load failed"; las versiones viejas
 *   decían "The network connection was lost.", "The Internet connection appears
 *   to be offline." o "cancelled", y en un iPhone en español, "La conexión a
 *   Internet parece estar desactivada." o "Se ha perdido la conexión de red."
 * - Firefox: "NetworkError when attempting to fetch resource."
 * - Tiempo agotado: "signal timed out", "The operation timed out.", "timeout of
 *   N ms exceeded" (el cliente del SDK), "Request timed out after 30000ms"
 *   (Pollar), "request timeout" (el RPC).
 * - Cortado a mitad: "signal is aborted without reason", "The operation was
 *   aborted.", "Fetch is aborted", "Aborted" (Pollar), "canceled".
 * - El servidor: 5xx o 408 ("Request failed with status code 503").
 */
const DE_RED = new RegExp(
  [
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch",
    "Network ?request failed",
    "network error",
    "network connection (?:was )?lost",
    "Internet connection appears to be offline",
    "Could not connect to the server",
    "hostname could not be found",
    "fetch failed",
    "ERR_NETWORK",
    "ERR_INTERNET_DISCONNECTED",
    "ERR_CONNECTION",
    "ERR_NAME_NOT_RESOLVED",
    "ECONN",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "timed? ?out",
    "TimeoutError",
    "AbortError",
    "abort(?:ed)?\\b",
    "\\bcancel+ed\\b(?! by)",
    "SDK_NETWORK_TIMEOUT",
    "account-check-network",
    "consulta-lenta",
    "rpc-sin-respuesta",
    "status code (?:5\\d\\d|408)",
    "HTTP (?:5\\d\\d|408)",
    "ERR_BAD_RESPONSE",
    "conexi[oó]n",
    "sin internet",
    "tiempo de espera",
  ].join("|"),
  "i",
);

/**
 * Un pedido del SDK que no llegó, por la forma y no por el texto. Un `fetch` que
 * falla por la red rechaza siempre con un `TypeError`, y el cliente HTTP del SDK
 * (feaxios) lo envuelve en un `AxiosError` sin código y sin respuesta (fuente,
 * y medido en Chrome): así se reconoce el corte aunque el navegador lo cuente
 * con palabras que este archivo no conoce. Con respuesta (un 4xx, un 5xx) ya no
 * es un corte, y lo decide el estado.
 */
function esCorteDelSdk(e: unknown): boolean {
  const x = e as { name?: unknown; code?: unknown; response?: unknown; isAxiosError?: unknown } | null;
  if (!x || typeof x !== "object" || (x.name !== "AxiosError" && x.isAxiosError !== true)) return false;
  if (x.response !== undefined && x.response !== null) return false;
  return x.code === undefined || x.code === null || x.code === "ERR_NETWORK" || x.code === "ECONNABORTED" || x.code === "ETIMEDOUT" || x.code === "ERR_CANCELED";
}

/** Un error de JSON-RPC del servidor (no de quien pide): -32603, o del -32000 al -32099. */
function esErrorDelServidorRpc(e: unknown): boolean {
  if (e instanceof Error || !e || typeof e !== "object") return false;
  const code = (e as { code?: unknown }).code;
  return typeof code === "number" && (code === -32603 || (code <= -32000 && code >= -32099));
}

/**
 * Todo lo que dice un error, venga como venga: un `Error` con su nombre, su
 * código y su causa (Freighter deja ahí si la persona canceló); un objeto plano
 * (el error de JSON-RPC del RPC, lo que devuelve Pollar); el estado HTTP de un
 * `AxiosError`; o un texto. Sin repetir, separado por " · ".
 */
export function textoDelError(e: unknown): string {
  const partes: string[] = [];
  const vistos = new Set<unknown>();
  const juntar = (x: unknown, nivel: number): void => {
    if (x === null || x === undefined || nivel > 3) return;
    if (typeof x === "string") {
      if (x) partes.push(x);
      return;
    }
    if (typeof x === "number" || typeof x === "bigint" || typeof x === "boolean") {
      partes.push(String(x));
      return;
    }
    if (typeof x !== "object" || vistos.has(x)) return;
    vistos.add(x);
    const o = x as Record<string, unknown>;
    if (typeof o.name === "string" && o.name && o.name !== "Error") partes.push(o.name);
    if (typeof o.message === "string" && o.message) partes.push(o.message);
    for (const k of ["code", "resultCode", "details", "error", "status"]) {
      const v = o[k];
      if (typeof v === "string" || typeof v === "number") partes.push(String(v));
      else if (v && typeof v === "object") juntar(v, nivel + 1);
    }
    const respuesta = o.response as { status?: unknown } | undefined;
    if (respuesta && typeof respuesta.status === "number") partes.push(`HTTP ${respuesta.status}`);
    if ("cause" in o) juntar(o.cause, nivel + 1);
  };
  juntar(e, 0);
  return [...new Set(partes)].join(" · ");
}

/**
 * El error dice que no se pudo hablar con la red: no llegó, se cortó, tardó o el
 * servidor no estaba. Lo que canceló la persona (o la sesión que se cerró) no
 * cuenta aunque diga "cancelled": eso no se reintenta.
 */
export function esDeRed(e: unknown): boolean {
  // Un sello incierto no se reintenta como un corte cualquiera: primero se averigua.
  if (esIncierto(e)) return false;
  // El portero que no llegó a la red es un corte más; sus otros no son una respuesta, no un corte.
  if (esNoDelPortero(e)) return e.motivo === "red" || e.motivo === "interno";
  const texto = textoDelError(e);
  // Lo que se mandó y no se sabe cómo terminó tampoco, aunque la causa sea un corte:
  // quien pregunta esto decide si reintentar como si no se hubiera mandado nada.
  if (CANCELO.test(texto) || SIN_CONFIRMAR.test(texto) || COFIRMA_NO_APROBADA.test(texto)) return false;
  return esErrorDelServidorRpc(e) || esCorteDelSdk(e) || DE_RED.test(texto);
}

/**
 * Un sello del que no se sabe si entró (`SelloIncierto`, `SelloSinConfirmar` en
 * `envio.ts` y `sello-seguro.ts`). Manda sobre lo que diga su causa: aunque el
 * corte haya dicho otra cosa, lo que importa es que no se sabe, y nadie puede
 * tomarlo por "sin saldo" y mandar otro sello.
 */
function esIncierto(e: unknown): boolean {
  const nombre = (e as { name?: unknown } | null)?.name;
  return nombre === "SelloIncierto" || nombre === "SelloSinConfirmar";
}

/** Si la máquina dice que está sin internet. `navigator.onLine` en falso es confiable; en verdadero, no tanto. */
function sinInternet(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * El portero del patrocinio (`patrocinador.ts`) no pagó. Se reconoce por el nombre y la forma, sin importar ese
 * archivo: la pantalla clasifica sin bajar nada más.
 */
interface NoDelPortero {
  motivo: string;
  que?: string;
  razon?: string;
}
export function esNoDelPortero(e: unknown): e is NoDelPortero & Error {
  const x = e as { name?: unknown; motivo?: unknown; estado?: unknown } | null;
  return !!x && typeof x === "object" && x.name === "ErrorPortero" && typeof x.motivo === "string" && typeof x.estado === "number";
}

/**
 * Los no del portero que la persona tiene que saber, con su pantalla (`errAnchor.portero*`): se acabó lo que se
 * cubre (el cupo de la cuenta, el fondo, el servicio que no contesta o está apagado) o esta cuenta no entra.
 * Los demás (la simulación dice que va a fallar, la comisión pedida quedó corta, la ventana venció, la red del
 * portero) se cuentan como cualquier error de la red: ver `errorKey`.
 */
export const MOTIVOS_QUE_BLOQUEAN = new Set(["cupo-cuenta", "cupo-ip", "fondo", "apagado", "cerrado", "no-permitida", "cuenta-ajena"]);
/** Lo que dice `razon` cuando el problema no es de la cuenta sino de la transacción o del sitio: no es "esta cuenta no puede". */
const RAZONES_QUE_NO_SON_DE_LA_CUENTA = new Set(["restaurar", "tamano", "xdr"]);
export const esNoQueBloquea = (e: unknown): boolean =>
  esNoDelPortero(e) && MOTIVOS_QUE_BLOQUEAN.has(e.motivo) && !(e.razon === "fee-alta" || e.razon === "ventana" || (e.razon !== undefined && RAZONES_QUE_NO_SON_DE_LA_CUENTA.has(e.razon)));

function claveDelPortero(e: NoDelPortero, contexto: { enLinea?: boolean }): string | null {
  switch (e.motivo) {
    case "cupo-cuenta":
      return e.que === "sorteos" ? "porteroCupoSorteos" : "porteroCupoSellos";
    case "cupo-ip":
    case "fondo":
    case "apagado":
    case "cerrado":
      return "porteroFondo";
    case "origen":
      // Abrir el sitio desde un origen que el servicio no conoce es un problema nuestro, no de la cuenta.
      return "unknown";
    case "no-permitida":
    case "cuenta-ajena":
      // Una comisión pedida de más o una ventana vencida se arreglan armando de nuevo: es "la red ocupada".
      if (e.razon === "fee-alta" || e.razon === "ventana") return "busy";
      // El estado archivado del contrato, una transacción demasiado grande o un XDR que no se lee no son de la cuenta.
      if (e.razon !== undefined && RAZONES_QUE_NO_SON_DE_LA_CUENTA.has(e.razon)) return "unknown";
      return "porteroAjena";
    case "fee-alta":
    case "rechazada":
      return "busy";
    case "red":
    case "interno":
      return (contexto.enLinea ?? !sinInternet()) ? "rpcDown" : "offline";
    default:
      // `fallaria` trae el error del contrato en el mensaje: lo lee el resto de `errorKey`.
      return null;
  }
}

/**
 * Traduce un error de una invocación a la clave de su mensaje
 * (`errAnchor.<clave>`). `contexto.enLinea` dice si hay internet; si no se
 * pasa, se le pregunta al navegador.
 */
export function errorKey(e: unknown, contexto: { enLinea?: boolean; patrocinada?: boolean } = {}): string {
  if (esIncierto(e)) return "unconfirmed";
  if (esNoDelPortero(e)) {
    const clave = claveDelPortero(e, contexto);
    if (clave) return clave;
  }
  const texto = textoDelError(e);
  if (RECUPERACION.test(texto)) return "recoveryRequired";
  if (CONFIRMACION.test(texto)) return "confirmation";
  if (COFIRMA_NO_APROBADA.test(texto)) return "cosignRejected";
  if (SERVICIO_SIN_FONDOS.test(texto)) return "sponsorEmpty";
  if (CUENTA_ABRIENDOSE.test(texto)) return "accountNotReady";
  const m = /Error\(Contract,\s*#(\d+)\)/.exec(texto);
  if (m?.[1]) {
    const named = CONTRACT_ERRORS[Number(m[1])];
    if (named) return named;
  }
  // Una firma de la ronda que ni siquiera es un punto de la curva: el host la
  // rechaza antes de que el contrato pueda devolver `InvalidSignature` (medido).
  if (/Error\(Crypto,/.test(texto)) return "invalidSignature";
  if (CUENTA_NO_LISTA.test(texto)) return "accountNotReady";
  if (COMISION_CORTA.test(texto)) return "busy";
  // Con una cuenta que no paga la comisión por sí misma (Pollar patrocina), quedarse sin saldo es del servicio, no de la
  // persona: decirle "tu cuenta no tiene saldo" la manda a cargar XLM a una cuenta que nunca los necesitó.
  if (SIN_SALDO.test(texto) && contexto.patrocinada) return "sponsorEmpty";
  if (SIN_SALDO.test(texto) || SIN_CUENTA.test(texto)) return "noFunds";
  if (CANCELO.test(texto)) return "userRejected";
  if (BILLETERA.test(texto)) return "wallet";
  if (SIN_CONFIRMAR.test(texto)) return "unconfirmed";
  if (OCUPADA.test(texto)) return "busy";
  if (ENTRO_Y_FALLO.test(texto)) return "busy";
  if (esErrorDelServidorRpc(e) || esCorteDelSdk(e) || DE_RED.test(texto)) {
    const enLinea = contexto.enLinea ?? !sinInternet();
    return enLinea ? "rpcDown" : "offline";
  }
  return "unknown";
}

/**
 * Este error es de falta de saldo, y de nada más: ni una comisión corta, ni una
 * cuenta que todavía no existe. Es lo único que dispara la ayuda de fondos.
 */
export const esSinSaldo = (e: unknown): boolean => errorKey(e) === "noFunds" && !esCuentaInexistente(e);

/** Este error dice que la cuenta no existe todavía en la red. */
export const esCuentaInexistente = (e: unknown): boolean => !esIncierto(e) && SIN_CUENTA.test(textoDelError(e));

/* ------------------------------------------------------- el detalle técnico */

/**
 * Una dirección de Stellar: de cuenta (G…) o de contrato (C…), de 56 caracteres, o
 * multiplexada (M… de cuenta, W… de contrato; CAP-84), de 69. Hoy no aparece ninguna
 * multiplexada (los organizadores son G y los contratos C), pero si un error trae una
 * también se tapa.
 */
const DIRECCION = /\b(?:[GC][A-Z2-7]{55}|[MW][A-Z2-7]{68})\b/g;

/**
 * El código técnico de un error, para "Ver detalle": una línea que alguien puede
 * copiar y mandar, sin nombres ni datos personales.
 *
 * - Del rechazo de la red por el SDK queda el estado y el código del resultado
 *   (`ERROR tx_bad_seq`), no el JSON entero.
 * - De la simulación queda el error del host (`HostError: Error(Contract, #5)`),
 *   y no el registro de eventos, que trae la cuenta, la huella de la lista y el
 *   nombre del premio.
 * - Las direcciones de cuenta se tapan. Los hashes de transacción quedan: son
 *   públicos y sirven para buscarla en el explorador.
 * - Nunca más de 240 caracteres.
 */
export function codigoTecnico(e: unknown): string {
  const partes: string[] = [];
  const add = (s: unknown): void => {
    if (typeof s === "string" && s.trim()) partes.push(s.trim());
  };
  const o = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
  if (typeof o.name === "string" && o.name !== "Error") add(o.name);
  const mensaje = typeof o.message === "string" ? o.message : typeof e === "string" ? e : "";
  const rechazo = /^Sending the transaction to the network failed!\s*([\s\S]*)$/.exec(mensaje);
  const simulacion = /HostError: (Error\([^)]*\))/.exec(mensaje);
  if (rechazo) {
    let r: { status?: string; errorResult?: { result?: unknown } } = {};
    try {
      r = JSON.parse(rechazo[1] ?? "{}") as typeof r;
    } catch {
      /* el texto no era JSON: queda el estado, si se ve */
    }
    const resultado = typeof r.errorResult?.result === "string" ? r.errorResult.result : "";
    add(`sendTransaction ${r.status ?? "?"}${resultado ? " " + resultado : ""}`);
  } else if (simulacion) {
    add(`HostError: ${simulacion[1]}`);
  } else {
    add(mensaje.split("\n")[0]);
  }
  for (const k of ["code", "resultCode", "details"]) {
    const v = o[k];
    if (typeof v === "string" || typeof v === "number") add(String(v));
  }
  const respuesta = o.response as { status?: unknown } | undefined;
  if (respuesta && typeof respuesta.status === "number") add(`HTTP ${respuesta.status}`);
  // La transacción que se mandó y no se sabe cómo terminó: con su hash se la busca en el
  // explorador. Del intento sale solo el hash, nunca la cuenta ni la huella de la lista.
  const intento = o.intento as { hash?: unknown } | undefined;
  const hashTx = typeof o.txHash === "string" ? o.txHash : intento && typeof intento.hash === "string" ? intento.hash : "";
  if (/^[0-9a-f]{64}$/i.test(hashTx)) add(`tx ${hashTx.toLowerCase()}`);
  if (o.cause !== undefined) {
    const causa = textoDelError(o.cause);
    if (causa) add(`causa: ${causa.split("\n")[0]}`);
  }
  if (!partes.length) add(textoDelError(e).split("\n")[0] || String(e));
  const linea = [...new Set(partes)].join(" · ").replace(DIRECCION, (d) => `${d[0]}***`);
  return linea.length > 240 ? linea.slice(0, 237) + "..." : linea;
}
