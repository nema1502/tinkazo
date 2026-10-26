import { describe, expect, it } from "vitest";
import { codigoTecnico, errorKey, esDeRed, textoDelError } from "./errores";

/**
 * El corpus: los errores de verdad de cada fuente, con lo que tiene que decir la
 * pantalla. Cada fila dice de dónde salió:
 *
 * - `medido`: provocado el 21 de octubre de 2026. Los de Chrome, con Chrome 141 por
 *   DevTools (`Fetch.failRequest` con cada una de sus catorce razones,
 *   `Network.emulateNetworkConditions` sin red, `AbortSignal.timeout`, un
 *   `AbortController`, respuestas 4xx y 5xx y errores de JSON-RPC armados con
 *   `Fetch.fulfillRequest`), con el SDK de Stellar 17.1 cargado en la página. Los
 *   del RPC, contra la testnet con el mismo SDK, desde una cuenta descartable del
 *   grifo: secuencia corrida, vencida, comisión corta, sin cuenta, DUPLICATE,
 *   TRY_AGAIN_LATER, las simulaciones que fallan con cada error del contrato y una
 *   transacción que entra al ledger y falla.
 * - `fuente`: leído en el código de la versión instalada (feaxios 0.0.23, que es
 *   el cliente HTTP del SDK; `@pollar/core` 0.11.3; `@stellar/freighter-api` 6).
 * - `documentado`: lo que dicen los navegadores que no hay en esta máquina
 *   (Safari, Firefox) y las versiones viejas de iOS, en español también.
 *
 * Los mensajes largos del SDK son copias textuales de lo que devolvió la testnet.
 */

type Fila = [fuente: string, como: "medido" | "fuente" | "documentado", error: () => unknown, clave: string];

/** Lo que tira el SDK de Stellar cuando el pedido HTTP falla: feaxios envuelve el error del navegador en un `AxiosError`. */
const axios = (message: string, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(message), { name: "AxiosError", isAxiosError: true, ...extra });
const http = (status: number): Error =>
  axios(`Request failed with status code ${status}`, { code: status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST", response: { status } });
/** Lo que lanza `wallet-pollar.ts` con lo que devolvió `signAndSubmitTx` (ver `mensajeDeRechazo`). */
const pollar = (mensaje: string): Error => new Error(mensaje);
/** Lo que lanza `wallet-lite.ts` cuando Freighter devuelve `error`. */
const freighter = (causa?: { code: number; message: string }): Error =>
  causa ? new Error("wallet-rejected", { cause: causa }) : new Error("wallet-rejected");

/** El rechazo de la red tal como lo cuenta el SDK (copias de la testnet). */
const rechazo = (status: string, resultado?: string): Error =>
  new Error(
    `Sending the transaction to the network failed!\n${JSON.stringify(
      {
        status,
        hash: "83fdf1f69c2043a7ec5f3dcbcfbfa5aed5d3adc4ef079edadbc326442130dafa",
        latestLedger: 5316504,
        latestLedgerCloseTime: "1792606107",
        ...(resultado ? { errorResult: { fee_charged: "100", result: resultado, ext: "v0" } } : {}),
      },
      null,
      2,
    )}`,
  );
/** Una simulación que falló, tal como la cuenta el SDK (copia de la testnet, con el registro de eventos). */
const simulacion = (hostError: string): Error =>
  Object.assign(
    new Error(
      `Transaction simulation failed: "HostError: ${hostError}\n\nEvent log (newest first):\n   0: [Diagnostic Event] contract:CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH, topics:[error, ${hostError}], data:"escalating Ok(ScErrorType::Contract) frame-exit to Err"\n   1: [Diagnostic Event] topics:[fn_call, CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH, seal], data:[GC6XLXIVAUCE3OVDB5Z6NCLVGOII7EPKM7KECUL3RM3LMK7OXX7NDVHP, Bytes(0707070707070707070707070707070707070707070707070707070707070707), 5, 1, 33267590, "Premio de Ana"]\n"`,
    ),
  );

const CORPUS: Fila[] = [
  // ---------------------------------------------------------------- fetch en el navegador
  ["Chrome: fetch sin red (modo avión de DevTools)", "medido", () => new TypeError("Failed to fetch"), "rpcDown"],
  ["Chrome: fetch con el pedido cortado (las 14 razones de Fetch.failRequest)", "medido", () => new TypeError("Failed to fetch"), "rpcDown"],
  ["Chrome 2024+: fetch cortado, con el dominio", "documentado", () => new TypeError("Failed to fetch (soroban-testnet.stellar.org)"), "rpcDown"],
  ["Chrome: AbortSignal.timeout vencido", "medido", () => new DOMException("signal timed out", "TimeoutError"), "rpcDown"],
  ["Chrome: AbortController.abort() sin motivo", "medido", () => new DOMException("signal is aborted without reason", "AbortError"), "rpcDown"],
  ["Safari 15+ y todo navegador de iPhone: fetch cortado o sin red", "documentado", () => new TypeError("Load failed"), "rpcDown"],
  ["Safari: tiempo agotado", "documentado", () => new DOMException("The operation timed out.", "TimeoutError"), "rpcDown"],
  ["Safari: pedido cancelado", "documentado", () => new DOMException("Fetch is aborted", "AbortError"), "rpcDown"],
  ["Safari viejo: pedido cancelado por el navegador", "documentado", () => new TypeError("cancelled"), "rpcDown"],
  ["Safari viejo: se cortó la conexión", "documentado", () => new TypeError("The network connection was lost."), "rpcDown"],
  ["Safari viejo: sin internet", "documentado", () => new TypeError("The Internet connection appears to be offline."), "rpcDown"],
  ["Safari viejo: no encontró el servidor", "documentado", () => new TypeError("A server with the specified hostname could not be found."), "rpcDown"],
  ["Safari viejo: no pudo conectar", "documentado", () => new TypeError("Could not connect to the server."), "rpcDown"],
  ["Safari viejo: tiempo agotado", "documentado", () => new TypeError("The request timed out."), "rpcDown"],
  ["iPhone viejo en español: sin internet", "documentado", () => new TypeError("La conexión a Internet parece estar desactivada."), "rpcDown"],
  ["iPhone viejo en español: se cortó", "documentado", () => new TypeError("Se ha perdido la conexión de red."), "rpcDown"],
  ["iPhone viejo en español: tiempo agotado", "documentado", () => new TypeError("Se ha agotado el tiempo de espera de la solicitud."), "rpcDown"],
  ["Firefox: fetch cortado o sin red", "documentado", () => new TypeError("NetworkError when attempting to fetch resource."), "rpcDown"],
  ["Firefox: tiempo agotado", "documentado", () => new DOMException("The operation timed out.", "TimeoutError"), "rpcDown"],
  ["Firefox: pedido cancelado", "documentado", () => new DOMException("The operation was aborted. ", "AbortError"), "rpcDown"],
  ["Node (undici), por si corre en un script", "documentado", () => new TypeError("fetch failed"), "rpcDown"],

  // ---------------------------------------------------------------- el SDK de Stellar contra el RPC
  ["SDK: corte en Chrome (AxiosError, no TypeError)", "medido", () => axios("Failed to fetch"), "rpcDown"],
  ["SDK: corte en Safari", "fuente", () => axios("Load failed"), "rpcDown"],
  ["SDK: corte en Firefox", "fuente", () => axios("NetworkError when attempting to fetch resource."), "rpcDown"],
  ["SDK: tiempo agotado de su cliente HTTP", "fuente", () => axios("timeout of 10000 ms exceeded", { code: "ECONNABORTED" }), "rpcDown"],
  ["SDK: corte con palabras que no se conocen (se reconoce por la forma: sin código ni respuesta)", "fuente", () => axios("Ein Netzwerkfehler ist aufgetreten"), "rpcDown"],
  ["SDK: pedido cancelado", "fuente", () => Object.assign(axios("canceled", { code: "ERR_CANCELED" }), { name: "CanceledError" }), "rpcDown"],
  ["SDK: RPC con HTTP 500", "medido", () => http(500), "rpcDown"],
  ["SDK: RPC con HTTP 502", "medido", () => http(502), "rpcDown"],
  ["SDK: RPC con HTTP 503", "medido", () => http(503), "rpcDown"],
  ["SDK: RPC con HTTP 504", "medido", () => http(504), "rpcDown"],
  ["SDK: RPC con HTTP 408", "medido", () => http(408), "rpcDown"],
  ["SDK: RPC con HTTP 429 (demasiados pedidos)", "medido", () => http(429), "busy"],
  ["SDK: RPC con HTTP 400", "medido", () => http(400), "unknown"],
  ["SDK: RPC con HTTP 403", "medido", () => http(403), "unknown"],
  ["RPC: error interno de JSON-RPC (objeto plano, no Error)", "medido", () => ({ code: -32603, message: "internal error" }), "rpcDown"],
  ["RPC: tiempo agotado de JSON-RPC (objeto plano)", "medido", () => ({ code: -32001, message: "request timeout" }), "rpcDown"],
  ["RPC: hash mal formado (objeto plano, error de quien pide)", "medido", () => ({ code: -32602, message: "unexpected hash length (2)" }), "unknown"],
  ["RPC: getAccount de una cuenta que no existe", "medido", () => new Error("Account not found: GCZJUPZIUVQVS67RJXYGMRZHV7RIZD4OAWJPQ4YA2UNCQNSVUEDHZIHY"), "noFunds"],
  ["RPC: sendTransaction ERROR, la cuenta no existe", "medido", () => rechazo("ERROR", "tx_no_account"), "noFunds"],
  ["RPC: sendTransaction ERROR, sin saldo (19 de octubre)", "medido", () => rechazo("ERROR", "tx_insufficient_balance"), "noFunds"],
  ["RPC: sendTransaction ERROR, secuencia corrida", "medido", () => rechazo("ERROR", "tx_bad_seq"), "busy"],
  ["RPC: sendTransaction ERROR, vencida", "medido", () => rechazo("ERROR", "tx_too_late"), "busy"],
  ["RPC: sendTransaction ERROR, comisión corta", "medido", () => rechazo("ERROR", "tx_insufficient_fee"), "busy"],
  ["RPC: sendTransaction TRY_AGAIN_LATER (otra de la misma cuenta en cola)", "medido", () => rechazo("TRY_AGAIN_LATER"), "busy"],
  ["RPC: sendTransaction TRY_AGAIN_LATER (la misma, ya aplicada)", "medido", () => rechazo("TRY_AGAIN_LATER"), "busy"],
  ["RPC: sendTransaction DUPLICATE (la misma, todavía en cola)", "medido", () => rechazo("DUPLICATE"), "unconfirmed"],
  ["SDK: la espera del resultado se acabó con la transacción viva", "fuente", () => new Error("Waited 300 seconds for transaction to complete, but it did not. Returning anyway. Check the transaction status manually."), "unconfirmed"],
  ["SDK: sent.result de una transacción que entró y falló", "medido", () => new TypeError("Cannot read properties of undefined (reading 'type')"), "unknown"],
  ["SDK: el RPC devolvió algo que no es JSON (portal cautivo)", "medido", () => new TypeError("Cannot read properties of undefined (reading 'headerXdr')"), "unknown"],
  ["SDK: estado archivado del contrato", "fuente", () => new Error("You need to restore some contract state before you can invoke this method.\nYou can set `restore` to true in the method options in order to automatically restore the contract state when needed."), "unknown"],

  // ---------------------------------------------------------------- la simulación del contrato
  ["simulación: el sorteo no existe (#1)", "medido", () => simulacion("Error(Contract, #1)"), "notFound"],
  ["simulación: ya se sorteó (#2)", "medido", () => simulacion("Error(Contract, #2)"), "alreadyDrawn"],
  ["simulación: un solo nombre (#3)", "medido", () => simulacion("Error(Contract, #3)"), "tooFewEntries"],
  ["simulación: cero ganadores (#4)", "medido", () => simulacion("Error(Contract, #4)"), "badWinnerCount"],
  ["simulación: la ronda muy cerca (#5)", "medido", () => simulacion("Error(Contract, #5)"), "roundTooSoon"],
  ["simulación: la ronda muy lejos (#6)", "medido", () => simulacion("Error(Contract, #6)"), "roundTooFar"],
  ["simulación: la ronda todavía no nació (#7)", "fuente", () => simulacion("Error(Contract, #7)"), "roundNotReady"],
  ["simulación: la firma no verifica (#8)", "fuente", () => simulacion("Error(Contract, #8)"), "invalidSignature"],
  ["simulación: el premio muy largo (#9)", "medido", () => simulacion("Error(Contract, #9)"), "metaTooLong"],
  ["simulación: la firma ni siquiera es un punto de la curva", "medido", () => simulacion("Error(Crypto, InvalidInput)"), "invalidSignature"],
  // Los límites de recursos de la red y la autorización: la persona no puede hacer nada, y esperar
  // tampoco lo arregla. Van al mensaje genérico (que ya no dice "rechazó") y el detalle guarda el error del host.
  ["simulación: se pasó del presupuesto de CPU o memoria de la red", "documentado", () => simulacion("Error(Budget, ExceededLimit)"), "unknown"],
  ["simulación: se pasó de un límite de almacenamiento", "documentado", () => simulacion("Error(Storage, ExceededLimit)"), "unknown"],
  ["simulación: la autorización no corresponde a la cuenta", "documentado", () => simulacion("Error(Auth, InvalidAction)"), "unknown"],

  // ---------------------------------------------------------------- Pollar (lo que devuelve signAndSubmitTx con status "error")
  ["Pollar: corte en Chrome (details del TypeError)", "fuente", () => pollar("Failed to fetch"), "rpcDown"],
  ["Pollar: corte en Safari", "fuente", () => pollar("Load failed"), "rpcDown"],
  ["Pollar: corte en Firefox", "fuente", () => pollar("NetworkError when attempting to fetch resource."), "rpcDown"],
  ["Pollar: su tope de 30 s para enviar (PollarNetworkError)", "fuente", () => pollar("Request timed out after 30000ms"), "rpcDown"],
  ["Pollar: su tope de 10 s para el resto", "fuente", () => pollar("Request timed out after 10000ms"), "rpcDown"],
  ["Pollar: pedido cortado", "fuente", () => pollar("Aborted"), "rpcDown"],
  ["Pollar: la red dijo sin saldo (registros de la app)", "medido", () => pollar("txInsufficientBalance"), "noFunds"],
  ["Pollar: sin saldo, con el código de su API", "fuente", () => pollar("txInsufficientBalance · TX_SUBMIT_FAILED"), "noFunds"],
  ["Pollar: entró y falló (registro del 17 de octubre)", "medido", () => pollar("txFailed"), "busy"],
  ["Pollar: secuencia corrida", "fuente", () => pollar("txBadSeq"), "busy"],
  ["Pollar: vencida", "fuente", () => pollar("txTooLate"), "busy"],
  ["Pollar: malformada (registros de septiembre, bug viejo)", "medido", () => pollar("txMalformed"), "unknown"],
  ["Pollar: comisión por encima del tope de la app", "fuente", () => pollar("TX_FEE_LIMIT_EXCEEDED · The transaction fee is above the allowed limit. Please try again."), "busy"],
  ["Pollar: el contrato la rechazó", "fuente", () => pollar("TX_CONTRACT_FAILED · The contract rejected this operation. Check the operation is allowed right now and try again."), "busy"],
  ["Pollar: secuencia, con el código de su API", "fuente", () => pollar("TX_BAD_SEQUENCE · Something went out of sync. Please try again."), "busy"],
  ["Pollar: sin saldo, con el código de su API", "fuente", () => pollar("TX_INSUFFICIENT_BALANCE · Insufficient balance to complete this transaction."), "noFunds"],
  ["Pollar: comisión corta, con el código de su API", "fuente", () => pollar("TX_INSUFFICIENT_FEE · Not enough XLM to cover the network fee. Add more XLM to your wallet and try again."), "busy"],
  ["Pollar: rechazo sin motivo", "fuente", () => pollar("TX_SUBMIT_FAILED"), "unknown"],
  ["Pollar: devolvió error sin ningún campo", "fuente", () => pollar("pollar-submit-failed"), "unknown"],
  ["Pollar: billetera externa sin conectar", "fuente", () => pollar("Wallet not connected. Reconnect your wallet to sign."), "wallet"],

  // ---------------------------------------------------------------- Freighter
  // El -4 lo arma la extensión, no `@stellar/freighter-api` (que solo trae el -1): por eso es documentado.
  ["Freighter: la persona canceló (código -4, en la causa)", "documentado", () => freighter({ code: -4, message: "The user rejected this request." }), "userRejected"],
  ["Freighter: error interno (código -1)", "fuente", () => freighter({ code: -1, message: "The wallet encountered an internal error. Please try again or contact the wallet if the problem persists." }), "wallet"],
  ["Freighter: no dijo por qué", "fuente", () => freighter(), "wallet"],
  ["Freighter viejo: negó el acceso", "documentado", () => new Error("User declined access"), "userRejected"],

  // ---------------------------------------------------------------- lo de la app
  ["app: la cuenta de Pollar no se abrió a tiempo", "fuente", () => new Error("account-not-ready"), "accountNotReady"],
  ["app: la red no contestó mientras se esperaba la cuenta", "fuente", () => new Error("account-check-network"), "rpcDown"],
  ["app: se cerró la sesión mientras se esperaba", "fuente", () => new Error("account-wait-cancelled"), "userRejected"],
  ["app: el SDK no pudo leer el resultado de una fallida", "fuente", () => new Error("tx-FAILED"), "busy"],
  ["app: no se confirmó y la transacción seguía viva", "fuente", () => new Error("tx-NOT_FOUND"), "unconfirmed"],
  ["app: venció sin entrar", "fuente", () => new Error("tx-EXPIRED"), "busy"],
  // Lo que arma `errorDelDesenlace` (envio-sdk.ts) cuando la red no tomó la transacción al recibirla.
  ["app: rechazada al recibirla, la secuencia corrida", "fuente", () => new Error("tx-REJECTED tx_bad_seq"), "busy"],
  ["app: rechazada al recibirla, sin saldo", "fuente", () => new Error("tx-REJECTED tx_insufficient_balance"), "noFunds"],
  ["app: rechazada al recibirla, la cuenta no existe", "fuente", () => new Error("tx-REJECTED tx_no_account"), "noFunds"],
  ["app: rechazada al recibirla, vencida", "fuente", () => new Error("tx-REJECTED tx_too_late"), "busy"],
  ["app: rechazada al recibirla, comisión corta", "fuente", () => new Error("tx-REJECTED tx_insufficient_fee"), "busy"],
  ["app: rechazada al recibirla, malformada", "fuente", () => new Error("tx-REJECTED tx_malformed"), "unknown"],
  ["app: rechazada al recibirla, sin código legible", "fuente", () => new Error("tx-REJECTED ERROR"), "unknown"],
  ["app: el envío no contestó a tiempo (pudo haber llegado)", "fuente", () => new Error("envio-lento"), "unconfirmed"],
  ["app: el sorteo se mandó y no se pudo confirmar (con el corte en la causa)", "fuente", () => new Error("sin-confirmar", { cause: new TypeError("Failed to fetch") }), "unconfirmed"],
  ["app: el RPC contestó algo que no se entiende al armar", "fuente", () => new Error("rpc-sin-respuesta: Cannot read properties of undefined (reading 'headerXdr')"), "rpcDown"],
  ["app: la ronda quedó cerca antes de mandar", "fuente", () => new Error("la ronda quedó cerca antes de mandar el sello (faltan 12 s): Error(Contract, #5)"), "roundTooSoon"],
];

describe("errorKey: el corpus", () => {
  it.each(CORPUS)("%s (%s) -> %s", (_fuente, _como, error, clave) => {
    expect(errorKey(error(), { enLinea: true })).toBe(clave);
  });

  it("ningún error de red o de tiempo cae en 'unknown': todos los que esDeRed reconoce tienen su mensaje", () => {
    const deRed = CORPUS.filter(([, , error]) => esDeRed(error()));
    expect(deRed.length).toBeGreaterThan(30);
    expect(deRed.filter(([, , error]) => errorKey(error(), { enLinea: true }) === "unknown").map(([f]) => f)).toEqual([]);
  });

  it("sin internet en la máquina, los de red dicen 'estás sin internet'; los demás no cambian", () => {
    for (const [fuente, , error, clave] of CORPUS) {
      const esperada = clave === "rpcDown" ? "offline" : clave;
      expect([fuente, errorKey(error(), { enLinea: false })]).toEqual([fuente, esperada]);
    }
  });

  it("todo el corpus que se midió de verdad tiene una clave que no es 'unknown', salvo lo que de verdad no se sabe", () => {
    const desconocidos = CORPUS.filter(([, como, error]) => como === "medido" && errorKey(error(), { enLinea: true }) === "unknown").map(([f]) => f);
    expect(desconocidos).toEqual([
      "SDK: RPC con HTTP 400",
      "SDK: RPC con HTTP 403",
      "RPC: hash mal formado (objeto plano, error de quien pide)",
      // Estos dos no llegan a la pantalla: `anchor.ts` los convierte antes (tx-FAILED y rpc-sin-respuesta).
      "SDK: sent.result de una transacción que entró y falló",
      "SDK: el RPC devolvió algo que no es JSON (portal cautivo)",
      "Pollar: malformada (registros de septiembre, bug viejo)",
    ]);
  });
});

describe("cada clave tiene su mensaje: qué pasó y qué hacer, sin tecnicismos", () => {
  const claves = [...new Set([...CORPUS.map(([, , , clave]) => clave), "offline", "unconfirmed", "accountNotReady", "wallet", "unknown"])];

  it.each(claves)("errAnchor.%s", async (clave) => {
    const { T } = await import("../i18n");
    for (const l of ["es", "en"] as const) {
      const texto = T[l][`errAnchor.${clave}`];
      expect(typeof texto, `${l}: errAnchor.${clave}`).toBe("string");
      // Dos partes como mínimo: lo que pasó y lo que hay que hacer.
      expect((texto as string).split(/(?<=[.:!?])\s+/).filter(Boolean).length, `${l}: ${texto}`).toBeGreaterThanOrEqual(2);
      // La sala puede estar mirando: nada de hash, bytes, firmas, drand ni RPC; y en español, "billetera".
      expect(texto as string).not.toMatch(/\bhash|\bbytes?\b|\bfirmas?\b|\bsignatures?\b|drand|\bRPC\b|XDR|ledger/i);
      if (l === "es") expect(texto as string).not.toMatch(/\bwallet\b/i);
    }
  });

  it("ya no dice 'la red rechazó la transacción' cuando no se sabe qué pasó", async () => {
    const { T } = await import("../i18n");
    expect(T.es["errAnchor.unknown"]).not.toMatch(/rechaz/i);
    expect(T.en["errAnchor.unknown"]).not.toMatch(/reject/i);
  });
});

describe("un sello del que no se sabe si entró", () => {
  /** Como lo arma `envio.ts`: el nombre, el intento y el error de verdad en la causa. */
  const incierto = (causa: unknown): Error =>
    Object.assign(new Error("sin-confirmar", { cause: causa }), { name: "SelloIncierto", intento: { organizer: "G", round: 1 } });

  it.each([
    ["un corte", new TypeError("Load failed")],
    ["algo que parece falta de saldo", new Error("txInsufficientBalance")],
    ["algo que parece una cuenta que no existe", new Error("Account not found: GCZJUPZIUVQVS67RJXYGMRZHV7RIZD4OAWJPQ4YA2UNCQNSVUEDHZIHY")],
  ])("es 'no se pudo confirmar' aunque la causa diga %s: nadie lo toma por otra cosa ni manda otro sello", async (_nombre, causa) => {
    const { esSinSaldo, esCuentaInexistente } = await import("./errores");
    const e = incierto(causa);
    expect(errorKey(e, { enLinea: true })).toBe("unconfirmed");
    expect(errorKey(e, { enLinea: false })).toBe("unconfirmed");
    expect(esSinSaldo(e)).toBe(false);
    expect(esCuentaInexistente(e)).toBe(false);
    expect(esDeRed(e)).toBe(false);
  });

  it("y el que ya se dio por perdido (SelloSinConfirmar) también", () => {
    expect(errorKey(Object.assign(new Error("sin-confirmar"), { name: "SelloSinConfirmar" }))).toBe("unconfirmed");
  });
});

describe("textoDelError", () => {
  it("junta el mensaje, el nombre, el código y la causa", () => {
    const t = textoDelError(new Error("wallet-rejected", { cause: { code: -4, message: "The user rejected this request." } }));
    expect(t).toContain("wallet-rejected");
    expect(t).toContain("The user rejected this request.");
    expect(t).toContain("-4");
  });

  it("lee un objeto plano: ya no dice [object Object]", () => {
    expect(textoDelError({ code: -32603, message: "internal error" })).toBe("internal error · -32603");
  });

  it("lee el estado HTTP de la respuesta", () => {
    expect(textoDelError(http(503))).toContain("HTTP 503");
  });

  it("no se cuelga con una causa circular", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(textoDelError(a)).toBe("a · b");
  });

  it("con un texto, devuelve el texto", () => {
    expect(textoDelError("txFailed")).toBe("txFailed");
    expect(textoDelError(undefined)).toBe("");
  });
});

describe("esDeRed", () => {
  it("reconoce el corte aunque venga envuelto por el SDK, por Pollar o como objeto plano", () => {
    expect(esDeRed(new TypeError("Load failed"))).toBe(true);
    expect(esDeRed(axios("Failed to fetch"))).toBe(true);
    expect(esDeRed(pollar("Request timed out after 30000ms"))).toBe(true);
    expect(esDeRed({ code: -32603, message: "internal error" })).toBe(true);
  });

  it("no confunde con red lo que no es: el rechazo del SDK dice 'network' y no es un corte", () => {
    expect(esDeRed(rechazo("ERROR", "tx_bad_seq"))).toBe(false);
    expect(esDeRed(simulacion("Error(Contract, #5)"))).toBe(false);
    expect(esDeRed(freighter({ code: -4, message: "The user rejected this request." }))).toBe(false);
    expect(esDeRed(new Error("account-wait-cancelled"))).toBe(false);
  });

  it("un envío que no contestó no es un corte antes de mandar: pudo haber llegado, y no se reintenta como si nada", () => {
    expect(esDeRed(new Error("envio-lento"))).toBe(false);
    expect(esDeRed(new Error("sin-confirmar", { cause: new TypeError("Failed to fetch") }))).toBe(false);
  });
});

describe("codigoTecnico: el detalle para copiar", () => {
  it("del rechazo de la red queda el estado y el código, no el JSON", () => {
    expect(codigoTecnico(rechazo("ERROR", "tx_bad_seq"))).toBe("sendTransaction ERROR tx_bad_seq");
    expect(codigoTecnico(rechazo("TRY_AGAIN_LATER"))).toBe("sendTransaction TRY_AGAIN_LATER");
  });

  it("de la simulación queda el error del host, sin el registro de eventos: ni la cuenta, ni la lista, ni el premio", () => {
    const c = codigoTecnico(simulacion("Error(Contract, #5)"));
    expect(c).toBe("HostError: Error(Contract, #5)");
    expect(c).not.toContain("Premio");
    expect(c).not.toMatch(/G[A-Z2-7]{55}/);
    // Un límite de recursos también queda dicho, para soporte.
    expect(codigoTecnico(simulacion("Error(Budget, ExceededLimit)"))).toBe("HostError: Error(Budget, ExceededLimit)");
  });

  it("tapa las direcciones de cuenta", () => {
    const c = codigoTecnico(new Error("Account not found: GCZJUPZIUVQVS67RJXYGMRZHV7RIZD4OAWJPQ4YA2UNCQNSVUEDHZIHY"));
    expect(c).toBe("Account not found: G***");
  });

  it("tapa también las direcciones multiplexadas, de 69 caracteres (M… de cuenta y W… de contrato, CAP-84)", () => {
    const w = "WABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCD";
    const m = "MXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ2";
    expect(w).toHaveLength(69);
    expect(m).toHaveLength(69);
    expect(codigoTecnico(new Error(`Invalid contract address: ${w}`))).toBe("Invalid contract address: W***");
    expect(codigoTecnico(new Error(`Account not found: ${m}`))).toBe("Account not found: M***");
    // Y las de 56 siguen tapadas, junto a una de 69 en el mismo mensaje.
    expect(codigoTecnico(new Error(`${w} paga a GCZJUPZIUVQVS67RJXYGMRZHV7RIZD4OAWJPQ4YA2UNCQNSVUEDHZIHY`))).toBe("W*** paga a G***");
  });

  it("dice el tipo, el código y la causa", () => {
    expect(codigoTecnico(http(503))).toBe("AxiosError · Request failed with status code 503 · ERR_BAD_RESPONSE · HTTP 503");
    expect(codigoTecnico(new TypeError("Load failed"))).toBe("TypeError · Load failed");
    expect(codigoTecnico(freighter({ code: -4, message: "The user rejected this request." }))).toBe("wallet-rejected · causa: The user rejected this request. · -4");
    expect(codigoTecnico({ code: -32603, message: "internal error" })).toBe("internal error · -32603");
  });

  it("de lo que se mandó y no se sabe, el hash de la transacción (público, para el explorador); nunca la cuenta ni la huella", () => {
    const hash = "93a2c960".repeat(8);
    const organizer = "GCZJUPZIUVQVS67RJXYGMRZHV7RIZD4OAWJPQ4YA2UNCQNSVUEDHZIHY";
    const huella = "cd".repeat(32);
    const sello = Object.assign(new Error("sin-confirmar", { cause: new TypeError("Load failed") }), {
      name: "SelloSinConfirmar",
      intento: { organizer, listHash: huella, round: 33274510, hash: hash.toUpperCase() },
    });
    const c = codigoTecnico(sello);
    expect(c).toContain(`tx ${hash}`);
    expect(c).not.toContain(organizer);
    expect(c).not.toContain(huella);
    // El sorteo lo lleva en `txHash`.
    expect(codigoTecnico(Object.assign(new Error("sin-confirmar", { cause: new TypeError("Failed to fetch") }), { txHash: hash }))).toBe(
      `sin-confirmar · tx ${hash} · causa: TypeError · Failed to fetch`,
    );
    // Algo que no es un hash no entra.
    expect(codigoTecnico(Object.assign(new Error("sin-confirmar"), { txHash: "no-es-un-hash" }))).toBe("sin-confirmar");
  });

  it("nunca pasa de 240 caracteres ni lleva puntos suspensivos de un solo carácter", () => {
    const c = codigoTecnico(new Error("x".repeat(1000)));
    expect(c.length).toBeLessThanOrEqual(240);
    expect(c).not.toContain("…");
  });
});
