import { Account, Keypair, Networks, Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PASSPHRASE_TESTNET, almacenEnMemoria, emitirTransaccion, reiniciar } from "./pollar-falso";

/**
 * El testigo del sello y del sorteo en la red principal (N8 del diseño de «Dejá tu cuenta lista», sección 6). Ahí el kit
 * de Pollar vota solo la co-firma del sello y del sorteo, y vuelve a pedir la transacción a Pollar antes de votar: nadie
 * compara lo votado con lo que armó Tinkazo. El testigo solo mira y anota en la consola si fue la misma operación o
 * no, para escribir la versión que lo controla sobre datos. Nunca frena nada ni cambia lo que devuelve la firma.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet } = await import("./wallet-pollar");

const persona = Keypair.random();
const P = persona.publicKey();
const otra = Keypair.random().publicKey();

function armar(secuencia: string, conFirmanteDeMas = false): Transaction {
  const b = new TransactionBuilder(new Account(P, secuencia), { fee: "1000", networkPassphrase: Networks.PUBLIC }).addOperation(
    Operation.manageData({ name: "tinkazo", value: "sello" }),
  );
  if (conFirmanteDeMas) b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: otra, weight: 1 } }));
  return b.setTimeout(300).build();
}

/** El sello como lo hace el kit en la red principal: queda esperando la co-firma, la vota y la resuelve. */
function sellarConCofirma(votada: string): void {
  h.impl.signAndSubmitTx = async () => {
    emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "cofirma-1", status: "PENDING", unsignedPayload: votada } });
    h.cofirma = { pending: [], lastResolved: { id: "cofirma-1", status: "APPROVED", unsignedPayload: votada } };
    emitirTransaccion(h, { step: "success", hash: "deadbeef" });
    return { status: "success", hash: "deadbeef" };
  };
}

const lineas = (): string[] => [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls].map((c) => c.map(String).join(" ")).filter((l) => l.includes("co-firma del sello"));

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
});

afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el testigo del sello en la red principal", () => {
  it("la misma operación (Pollar la volvió a armar con otra secuencia)", async () => {
    const armada = armar("10").toXDR();
    sellarConCofirma(armar("11").toXDR());
    await expect(pollarWallet.signAndSubmit(armada)).resolves.toBe("deadbeef");
    await vi.waitFor(() => expect(lineas()).toEqual(["[tinkazo] co-firma del sello: misma operación"]));
  });

  it("distinta: con un firmante de más, y dice los tipos de operación", async () => {
    sellarConCofirma(armar("11", true).toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toEqual(["[tinkazo] co-firma del sello: distinta (manageData,setOptions)"]));
  });

  it("envuelta: otra cuenta paga por encima", async () => {
    const interior = armar("11");
    const envuelta = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "2000", interior, Networks.PUBLIC);
    sellarConCofirma(envuelta.toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toEqual(["[tinkazo] co-firma del sello: misma operación, envuelta"]));
  });

  it("lo que anota no trae direcciones", async () => {
    sellarConCofirma(armar("11", true).toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas().join(" ")).not.toMatch(/[GM][A-Z2-7]{55}/);
  });

  it("también en la firma sin enviar (la del sorteo)", async () => {
    const votada = armar("11").toXDR();
    h.impl.signTx = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "cofirma-2", status: "PENDING", unsignedPayload: votada } });
      h.cofirma = { pending: [], lastResolved: { id: "cofirma-2", status: "APPROVED", unsignedPayload: votada } };
      return { status: "signed", signedXdr: "FIRMADA" };
    };
    await expect(pollarWallet.signUnsponsored(armar("10").toXDR())).resolves.toBe("FIRMADA");
    await vi.waitFor(() => expect(lineas()).toEqual(["[tinkazo] co-firma del sello: misma operación"]));
  });

  it("sin co-firma (la cuenta no la pidió) no anota nada", async () => {
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await new Promise((r) => setTimeout(r, 20));
    expect(lineas()).toEqual([]);
  });

  it("una co-firma de antes, que el kit repite al suscribirse, no cuenta", async () => {
    h.transaccion = { step: "awaiting_cosign", request: { id: "vieja", status: "PENDING", unsignedPayload: armar("3", true).toXDR() } };
    h.cofirma = { pending: [], lastResolved: { id: "vieja", status: "APPROVED", unsignedPayload: armar("3", true).toXDR() } };
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await new Promise((r) => setTimeout(r, 20));
    expect(lineas()).toEqual([]);
  });

  it("un testigo que falla no cambia lo que devuelve la firma", async () => {
    sellarConCofirma(armar("11").toXDR());
    h.impl.getCosignState = () => {
      throw new Error("se rompió");
    };
    await expect(pollarWallet.signAndSubmit(armar("10").toXDR())).resolves.toBe("deadbeef");
  });

  it("un error de la firma sale igual, con el testigo puesto", async () => {
    h.impl.signAndSubmitTx = async () => ({ status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED" });
    await expect(pollarWallet.signAndSubmit(armar("10").toXDR())).rejects.toThrow("SDK_WALLET_RECOVERY_REQUIRED");
  });

  it("después de firmar se suelta la suscripción", async () => {
    sellarConCofirma(armar("11").toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    expect(h.oyentes.transaccion.size).toBe(0);
  });
});

describe("en modo Prueba no hay testigo", () => {
  it("no se suscribe ni anota nada", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
    let suscritos = -1;
    h.impl.signAndSubmitTx = async () => {
      suscritos = h.oyentes.transaccion.size;
      return { status: "success", hash: "deadbeef" };
    };
    await expect(pollarWallet.signAndSubmit("XDR-DEL-SELLO")).resolves.toBe("deadbeef");
    expect(suscritos).toBe(0);
    expect(h.llamadas).not.toContain("getCosignState");
  });
});
