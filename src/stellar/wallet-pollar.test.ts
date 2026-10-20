import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "./contract";
import { mensajeDeRechazo, pollarWallet, submitsItself } from "./wallet-pollar";

/**
 * Pollar no lanza cuando una transacción no sale: devuelve `{ status: "error" }`
 * y deja el motivo en `resultCode`, `details`, `code` o `message`, según el
 * camino que haya tomado su servidor. Estas formas son las del SDK 0.11.3
 * (node_modules/@pollar/core/dist/index.mjs, `signAndSubmitTx` y
 * `_awaitTxConfirmation`) y la primera es la que Pollar guardó de verdad en sus
 * registros de la app para un `seal` sin saldo (19 de octubre de 2026).
 */
const FORMAS = {
  // La red rechazó la transacción: el código de resultado, repetido en details.
  rechazoDeLaRed: { status: "error", hash: "ab12", details: "txInsufficientBalance", resultCode: "txInsufficientBalance" },
  // Lo mismo, contado al terminar de esperar la confirmación, con el texto de Pollar.
  rechazoConTexto: {
    status: "error",
    hash: "ab12",
    details: "txInsufficientBalance",
    resultCode: "txInsufficientBalance",
    message: "Insufficient XLM to cover the network fee and minimum reserve. Fund the account with more XLM.",
  },
  // El servidor contestó con un error de API: el código, su texto y el motivo en details.
  errorDeApi: { status: "error", code: "TX_SUBMIT_FAILED", message: "Stellar rejected the transaction", details: "txInsufficientBalance" },
  // Un error de API que solo trae el texto.
  errorDeApiSoloTexto: { status: "error", code: "TX_SUBMIT_FAILED", message: "Insufficient XLM to cover the network fee and minimum reserve." },
  // Peor caso: el servidor no dice por qué.
  sinMotivo: { status: "error", code: "TX_SUBMIT_FAILED" },
} as const;

describe("mensajeDeRechazo", () => {
  it("el código de resultado va primero y no se repite", () => {
    expect(mensajeDeRechazo(FORMAS.rechazoDeLaRed)).toBe("txInsufficientBalance");
  });

  it("junta el código de API, su texto y el motivo, sin perder ninguno", () => {
    expect(mensajeDeRechazo(FORMAS.errorDeApi)).toBe("txInsufficientBalance · TX_SUBMIT_FAILED · Stellar rejected the transaction");
  });

  it("sin nada que decir, deja el aviso de siempre", () => {
    expect(mensajeDeRechazo({ status: "error" })).toBe("pollar-submit-failed");
    expect(mensajeDeRechazo({})).toBe("pollar-submit-failed");
  });

  it("ignora los campos vacíos", () => {
    expect(mensajeDeRechazo({ details: "", code: "X", message: "" })).toBe("X");
  });

  it("con cualquiera de las formas informativas, errorKey ve la falta de saldo", () => {
    for (const forma of [FORMAS.rechazoDeLaRed, FORMAS.rechazoConTexto, FORMAS.errorDeApi, FORMAS.errorDeApiSoloTexto]) {
      expect(errorKey(new Error(mensajeDeRechazo(forma)))).toBe("noFunds");
    }
  });

  it("y sin motivo no adivina: queda 'unknown'", () => {
    expect(errorKey(new Error(mensajeDeRechazo(FORMAS.sinMotivo)))).toBe("unknown");
  });
});

/**
 * La cuenta de Pollar de punta a punta, con el cliente del SDK reemplazado: lo que
 * lanza `signAndSubmit` es lo que después lee `errorKey`.
 */
const { proximo } = vi.hoisted(() => ({ proximo: { valor: {} as Record<string, unknown> } }));
vi.mock("@pollar/core", () => ({
  PollarClient: class {
    async signAndSubmitTx(): Promise<unknown> {
      return proximo.valor;
    }
  },
}));

describe("PollarWallet.signAndSubmit", () => {
  beforeEach(() => vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY", "pub_testnet_prueba"));
  afterEach(() => vi.unstubAllEnvs());

  it("es una wallet que envía por su cuenta", () => {
    expect(submitsItself(pollarWallet)).toBe(true);
  });

  it("devuelve el hash cuando entró", async () => {
    proximo.valor = { status: "success", hash: "deadbeef" };
    await expect(pollarWallet.signAndSubmit("AAAA")).resolves.toBe("deadbeef");
  });

  it("también cuando la red todavía no confirma", async () => {
    proximo.valor = { status: "pending", hash: "deadbeef" };
    await expect(pollarWallet.signAndSubmit("AAAA")).resolves.toBe("deadbeef");
  });

  it.each(Object.entries(FORMAS).filter(([k]) => k !== "sinMotivo"))("%s: lanza con el motivo a la vista", async (_nombre, forma) => {
    proximo.valor = forma;
    const error = await pollarWallet.signAndSubmit("AAAA").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(errorKey(error)).toBe("noFunds");
  });

  it("sin motivo ni hash, lanza el aviso de siempre", async () => {
    proximo.valor = { status: "cosign_pending" };
    await expect(pollarWallet.signAndSubmit("AAAA")).rejects.toThrow("pollar-submit-failed");
  });
});
