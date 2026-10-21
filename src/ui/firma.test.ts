import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El paso de firmar se dice según quién firma (buscador de detalles, D05).
 *
 * Con la cuenta de prueba la pantalla decía "Aprobá la operación en tu
 * billetera…" y "Comisión de la red: hasta 0,81 XLM" durante unos doce
 * segundos, sin ninguna ventana que aprobar. Lo mismo con Pollar, que firma y
 * manda desde su servidor. Con Freighter sí hay una ventana, y la comisión la
 * paga quien aprueba.
 */
const h = vi.hoisted(() => ({ wallet: null as null | Record<string, unknown> }));

vi.mock("../stellar/wallet-lite", async (orig) => {
  const real = await orig<typeof import("../stellar/wallet-lite")>();
  return { ...real, activeWallet: () => h.wallet };
});

const DIR = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const freighter = { kind: "external", label: "Freighter", address: DIR };
const deprueba = { kind: "guest", label: "Cuenta de prueba", address: DIR };
const pollar = { kind: "external", label: "Google", address: DIR, submitsItself: true };

/** Lo que muestra la línea de estado en el paso de firmar, con el costo que trae. */
async function lineaAlFirmar(): Promise<string> {
  const host = { style: { display: "" }, className: "", textContent: "" };
  vi.stubGlobal("document", { getElementById: () => host });
  const { showTxStatus } = await import("./anchor");
  showTxStatus("seal-status", "signing", "0,81 XLM");
  return host.textContent;
}

beforeEach(() => {
  vi.resetModules();
  h.wallet = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el paso de firmar", () => {
  it("con Freighter pide aprobar en la billetera y muestra la comisión", async () => {
    h.wallet = freighter;
    const { quienFirma, stepLabel } = await import("./anchor");
    await quienFirma();
    expect(stepLabel("signing")).toBe("Aprobá la operación en tu billetera…");
    expect(await lineaAlFirmar()).toBe("Aprobá la operación en tu billetera… Comisión de la red: hasta 0,81 XLM");
  });

  it("con la cuenta de prueba no hay nada que aprobar: dice que se manda, sin la comisión", async () => {
    h.wallet = deprueba;
    const { quienFirma, stepLabel } = await import("./anchor");
    await quienFirma();
    expect(stepLabel("signing")).toBe("Mandando a la red…");
    const linea = await lineaAlFirmar();
    expect(linea).toBe("Mandando a la red…");
    expect(linea).not.toContain("XLM");
  });

  it("con Pollar tampoco: firma y manda desde su servidor", async () => {
    h.wallet = pollar;
    const { quienFirma, stepLabel } = await import("./anchor");
    await quienFirma();
    expect(stepLabel("signing")).toBe("Mandando a la red…");
  });

  it("sin saber quién firma, se supone una billetera con ventana", async () => {
    const { quienFirma, stepLabel } = await import("./anchor");
    await quienFirma();
    expect(stepLabel("signing")).toBe("Aprobá la operación en tu billetera…");
  });

  it("los demás pasos no cambian con la cuenta", async () => {
    h.wallet = deprueba;
    const { quienFirma, stepLabel } = await import("./anchor");
    await quienFirma();
    expect(stepLabel("simulating")).toBe("Armando la transacción…");
    expect(stepLabel("sending")).toBe("Mandando a la red…");
  });
});
