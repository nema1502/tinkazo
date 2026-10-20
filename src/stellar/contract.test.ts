import { describe, expect, it } from "vitest";
import { errorKey, esCuentaInexistente, esSinSaldo } from "./contract";

/**
 * `errorKey` decide qué le dice la pantalla a quien no pudo sellar. Los textos de
 * abajo son los de verdad: el primero lo devolvió la red de pruebas al enviar
 * desde una cuenta vacía (19 de octubre de 2026), `txInsufficientBalance` es
 * como lo guarda Pollar en sus registros, y "Account not found" es lo que dice
 * la simulación cuando la cuenta todavía no existe.
 */
describe("errorKey: sin saldo", () => {
  const SIN_SALDO = [
    // La red, a través del SDK de Stellar.
    'Sending the transaction to the network failed!\n{\n  "status": "ERROR",\n  "errorResult": {\n    "fee_charged": "7494426",\n    "result": "tx_insufficient_balance",\n    "ext": "v0"\n  }\n}',
    "txINSUFFICIENT_BALANCE",
    // Pollar: el código de resultado y su texto.
    "txInsufficientBalance",
    "Insufficient XLM to cover the network fee and minimum reserve. Fund the account with more XLM.",
    // Un pago que no alcanza.
    "op_underfunded",
    "PAYMENT_UNDERFUNDED",
  ];

  it.each(SIN_SALDO)("lo reconoce en: %s", (msg) => {
    expect(errorKey(new Error(msg))).toBe("noFunds");
    expect(esSinSaldo(new Error(msg))).toBe(true);
  });

  it("también cuando llega como texto y no como Error", () => {
    expect(errorKey("txInsufficientBalance")).toBe("noFunds");
  });

  it("junto con el código de Pollar: el motivo manda aunque venga después", () => {
    // Así llega cuando el servidor cuenta el rechazo dentro de un error de API.
    expect(errorKey(new Error("txInsufficientBalance · TX_SUBMIT_FAILED"))).toBe("noFunds");
    expect(errorKey(new Error("TX_SUBMIT_FAILED · Insufficient XLM to cover the network fee"))).toBe("noFunds");
  });
});

describe("una cuenta que todavía no existe en la red", () => {
  const SIN_CUENTA = [
    // Es lo que dice la simulación (el SDK arma la transacción con la secuencia de la cuenta).
    "Account not found: GDQ4UYEUGB5TB4LDQNQXRKZJYVRMEXFD6TRAF73KIAWHY6H4B23I6PJU",
    // Y lo que dice la red al recibir una transacción de una cuenta que no existe.
    "txNoAccount",
    "tx_no_account",
    "txNO_ACCOUNT",
  ];

  it.each(SIN_CUENTA)("para quien trae su cuenta de afuera sigue siendo 'sin saldo': %s", (msg) => {
    expect(errorKey(new Error(msg))).toBe("noFunds");
  });

  it.each(SIN_CUENTA)("pero no dispara la ayuda de fondos (grifo): una cuenta de Pollar todavía no abierta no está 'sin saldo': %s", (msg) => {
    expect(esSinSaldo(new Error(msg))).toBe(false);
    expect(esCuentaInexistente(new Error(msg))).toBe(true);
  });

  it("lo que lanza la espera de la cuenta tiene su propio mensaje, y no es 'sin saldo' ni 'unknown'", () => {
    const e = new Error("account-not-ready");
    expect(errorKey(e)).toBe("accountNotReady");
    expect(esSinSaldo(e)).toBe(false);
    expect(esCuentaInexistente(e)).toBe(false);
  });

  it("un corte de red durante la espera sale como red caída", () => {
    expect(errorKey(new Error("account-check-network"))).toBe("rpcDown");
  });

  it("una espera cancelada (se cerró la sesión) sale como cancelación", () => {
    expect(errorKey(new Error("account-wait-cancelled"))).toBe("userRejected");
  });

  it("una cuenta con saldo no se confunde con una sin cuenta", () => {
    expect(esCuentaInexistente(new Error("txInsufficientBalance"))).toBe(false);
    expect(esCuentaInexistente(new Error("op_underfunded"))).toBe(false);
  });
});

describe("errorKey: lo que NO es falta de saldo", () => {
  it("una comisión corta es de la red, no de la cuenta, y no dispara la ayuda de fondos", () => {
    for (const msg of ["tx_insufficient_fee", "txInsufficientFee", "txINSUFFICIENT_FEE"]) {
      expect(errorKey(new Error(msg))).toBe("busy");
      expect(esSinSaldo(new Error(msg))).toBe(false);
    }
  });

  it("un rechazo sin motivo cae en 'unknown': sin saber por qué no se adivina", () => {
    expect(errorKey(new Error("TX_SUBMIT_FAILED"))).toBe("unknown");
    expect(esSinSaldo(new Error("TX_SUBMIT_FAILED"))).toBe(false);
  });

  it("una comisión reembolsable corta de la ejecución tampoco es saldo", () => {
    expect(errorKey(new Error("invokeHostFunctionInsufficientRefundableFee"))).toBe("unknown");
  });

  it("un error del contrato manda sobre cualquier texto de saldo", () => {
    expect(errorKey(new Error("HostError: Error(Contract, #5) tx_insufficient_balance"))).toBe("roundTooSoon");
  });

});

describe("errorKey: lo de siempre sigue igual", () => {
  const CASOS: [string, string][] = [
    ["HostError: Error(Contract, #1)", "notFound"],
    ["HostError: Error(Contract, #2)", "alreadyDrawn"],
    ["HostError: Error(Contract, #3)", "tooFewEntries"],
    ["HostError: Error(Contract, #4)", "badWinnerCount"],
    ["HostError: Error(Contract, #5)", "roundTooSoon"],
    ["HostError: Error(Contract, #6)", "roundTooFar"],
    ["HostError: Error(Contract, #7)", "roundNotReady"],
    ["HostError: Error(Contract, #8)", "invalidSignature"],
    ["HostError: Error(Contract, #9)", "metaTooLong"],
    ["User declined access", "userRejected"],
    ["The user rejected the request", "userRejected"],
    ["Failed to fetch", "rpcDown"],
    ["request timeout", "rpcDown"],
    ["TRY_AGAIN_LATER", "busy"],
    ["tx_bad_seq", "busy"],
    ["txTooLate", "busy"],
    ["Transaction failed!", "busy"],
    ["tx-FAILED", "busy"],
    // Pollar cuenta "entró y falló" como txFailed (registro real del 17 de octubre de 2026).
    ["txFailed", "busy"],
    ["txFailed · TX_SUBMIT_FAILED", "busy"],
    ["algo que nadie esperaba", "unknown"],
  ];
  it.each(CASOS)("%s -> %s", (msg, clave) => {
    expect(errorKey(new Error(msg))).toBe(clave);
  });
});
