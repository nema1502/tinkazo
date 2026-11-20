import { Account, Asset, Keypair, Memo, Networks, Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_MAINNET } from "./pagos";
import { PASSPHRASE_TESTNET, almacenEnMemoria, emitirTransaccion, reiniciar } from "./pollar-falso";

/**
 * El testigo de lo que el kit de Pollar vota en la red principal. Ahí el kit vota solo la co-firma del sello, del sorteo,
 * de Mandar y de la línea del dólar digital, y vuelve a pedir la transacción a Pollar antes de votar: nadie compara lo
 * votado con lo que armó Tinkazo. El testigo solo mira y anota en la consola una línea por firma (`describirPedido` y
 * `describirLinea` de `cofirma-regla.ts`), con todos los campos que difieren, para escribir la versión que lo controla
 * sobre datos. Nunca frena nada, nunca vota y nunca cambia lo que devuelve la firma.
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
const destino = Keypair.random().publicKey();
const dolar = (): Asset => new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);
/** Límites de tiempo fijos: dos transacciones armadas igual son idénticas, sin importar cuándo se armen. */
const TIEMPO = { minTime: 0, maxTime: 1_900_000_000 };

function armar(secuencia: string, conFirmanteDeMas = false): Transaction {
  const b = new TransactionBuilder(new Account(P, secuencia), { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: TIEMPO }).addOperation(
    Operation.manageData({ name: "tinkazo", value: "sello" }),
  );
  if (conFirmanteDeMas) b.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: otra, weight: 1 } }));
  return b.build();
}

/** Lo que manda Mandar: un pago de dólares digitales con una nota de texto. */
function armarElEnvio(nota: string): Transaction {
  return new TransactionBuilder(new Account(P, "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: TIEMPO })
    .addOperation(Operation.payment({ destination: destino, asset: dolar(), amount: "0.05" }))
    .addMemo(Memo.text(nota))
    .build();
}

/** Lo que arma el proveedor para activar los dólares digitales: la paga otra cuenta, con tres operaciones. */
function armarLaLinea(): Transaction {
  return new TransactionBuilder(new Account(otra, "10"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: TIEMPO })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: P, source: otra }))
    .addOperation(Operation.changeTrust({ asset: dolar(), source: P }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: P }))
    .build();
}

const hashDe = (t: { hash(): Uint8Array }): string => Buffer.from(t.hash()).toString("hex");
const firmada = (t: Transaction): string => {
  const copia = TransactionBuilder.fromXDR(t.toXDR(), Networks.PUBLIC) as Transaction;
  copia.sign(persona);
  return copia.toXDR();
};

/** El pedido que el kit dejó resuelto, con lo que el testigo lee de él. */
const resuelto = (id: string, votada: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: "APPROVED",
  unsignedPayload: votada,
  ...extra,
});

/** El sello como lo hace el kit en la red principal: queda esperando la co-firma, la vota y la resuelve. */
function sellarConCofirma(votada: string, extra: Record<string, unknown> = {}): void {
  h.impl.signAndSubmitTx = async () => {
    emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "cofirma-1", status: "PENDING", unsignedPayload: votada } });
    h.cofirma = { pending: [], lastResolved: resuelto("cofirma-1", votada, extra) };
    emitirTransaccion(h, { step: "success", hash: "deadbeef" });
    return { status: "success", hash: "deadbeef" };
  };
}

const delTestigo = (llamadas: unknown[][]): string[] => llamadas.map((c) => c.map(String).join(" ")).filter((l) => l.includes("[tinkazo] testigo"));
const lineas = (): string[] => [...delTestigo(vi.mocked(console.info).mock.calls), ...delTestigo(vi.mocked(console.warn).mock.calls)];
const porInfo = (): string[] => delTestigo(vi.mocked(console.info).mock.calls);
const porAdvertencia = (): string[] => delTestigo(vi.mocked(console.warn).mock.calls);

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  // Fuera de los modos que cuida la puerta del premio: estas pruebas miran el testigo, no la puerta
  // (`wallet-pollar-premio.test.ts`), y así ninguna firma le pregunta nada a Horizon.
  vi.stubEnv("VITE_RAMPA", "pollar");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
});

afterEach(async () => {
  // El testigo solo mira: nunca vota, ni rechaza, ni cancela nada.
  for (const nombre of ["approve", "reject", "cancel", "relay"]) expect(h.llamadas).not.toContain(nombre);
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el testigo del sello en la red principal", () => {
  it("la misma transacción: lo que votó el kit es lo que se armó, y sale por la consola de información", async () => {
    const armada = armar("10").toXDR();
    sellarConCofirma(armada, { intent: "sign_and_send" });
    await expect(pollarWallet.signAndSubmit(armada)).resolves.toBe("deadbeef");
    const dicho =
      "[tinkazo] testigo: misma transacción | distinto ninguno | intención sign_and_send | releíble no | firmada ninguna | envío ninguno";
    await vi.waitFor(() => expect(lineas()).toEqual([dicho]));
    expect(porInfo()).toEqual([dicho]);
  });

  it("mismas operaciones: Pollar la volvió a armar con otra secuencia, y sale como advertencia", async () => {
    const armada = armar("10").toXDR();
    sellarConCofirma(armar("11").toXDR());
    await expect(pollarWallet.signAndSubmit(armada)).resolves.toBe("deadbeef");
    const dicho = "[tinkazo] testigo: mismas operaciones | distinto secuencia | intención otra | releíble no | firmada ninguna | envío ninguno";
    await vi.waitFor(() => expect(lineas()).toEqual([dicho]));
    expect(porAdvertencia()).toEqual([dicho]);
  });

  it("distinta: con un firmante de más, dice todos los campos que difieren y los tipos de operación", async () => {
    sellarConCofirma(armar("11", true).toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    // La comisión es por operación: con una operación de más también cambia el total.
    expect(lineas()[0]).toContain("[tinkazo] testigo: distinta (manageData,setOptions) | distinto secuencia, comision, cantidad | ");
  });

  it("envuelta: otra cuenta paga por encima, y compara la de adentro igual", async () => {
    const interior = armar("11");
    const envuelta = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "2000", interior, Networks.PUBLIC);
    sellarConCofirma(envuelta.toXDR());
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas()[0]).toContain("[tinkazo] testigo: mismas operaciones | distinto envuelta, secuencia | ");
  });

  it("cuenta lo que dijo el kit: la intención, si se podía volver a pedir y cómo se ató el hash del envío", async () => {
    const armada = armar("10");
    const votado = { intent: "sign_and_send", refreshable: true, signedXdr: firmada(armada), submit: { status: "SUCCESS", hash: hashDe(armada) } };
    sellarConCofirma(armada.toXDR(), votado);
    await pollarWallet.signAndSubmit(armada.toXDR());
    await vi.waitFor(() =>
      expect(lineas()).toEqual([
        "[tinkazo] testigo: misma transacción | distinto ninguno | intención sign_and_send | releíble sí | firmada simple | envío mismo-hash",
      ]),
    );
  });

  it("si Pollar la mandó envuelta, el envío dice el hash de afuera como atado a la armada", async () => {
    const armada = armar("10");
    const sobre = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "2000", armada, Networks.PUBLIC);
    sellarConCofirma(armada.toXDR(), { intent: "sign_and_send", signedXdr: sobre.toXDR(), submit: { status: "SUCCESS", hash: hashDe(sobre) } });
    await pollarWallet.signAndSubmit(armada.toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas()[0]).toContain("| firmada envuelta | envío otro-hash-atado");
  });

  it("lo que anota no trae direcciones ni hashes", async () => {
    const armada = armar("10");
    sellarConCofirma(armar("11", true).toXDR(), { signedXdr: firmada(armada), submit: { status: "SUCCESS", hash: hashDe(armada) } });
    await pollarWallet.signAndSubmit(armada.toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas().join(" ")).not.toMatch(/[GCM][A-Z2-7]{55}/);
    expect(lineas().join(" ")).not.toMatch(/[0-9a-f]{40,}/);
  });

  it("también en la firma sin enviar (la del sorteo)", async () => {
    const votada = armar("11").toXDR();
    h.impl.signTx = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "cofirma-2", status: "PENDING", unsignedPayload: votada } });
      h.cofirma = { pending: [], lastResolved: resuelto("cofirma-2", votada, { intent: "sign" }) };
      return { status: "signed", signedXdr: "FIRMADA" };
    };
    await expect(pollarWallet.signUnsponsored(armar("10").toXDR())).resolves.toBe("FIRMADA");
    const dicho = "[tinkazo] testigo: mismas operaciones | distinto secuencia | intención sign | releíble no | firmada ninguna | envío ninguno";
    await vi.waitFor(() => expect(lineas()).toEqual([dicho]));
  });

  it("si el pedido llega sin transacción, lo dice en lugar de callarse", async () => {
    h.impl.signAndSubmitTx = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "cofirma-3", status: "PENDING" } });
      h.cofirma = { pending: [], lastResolved: { id: "cofirma-3", status: "APPROVED" } };
      return { status: "success", hash: "deadbeef" };
    };
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas()[0]).toContain("[tinkazo] testigo: no se lee | distinto no-se-lee | ");
  });

  it("un aviso del kit que la escucha no sabe leer no corta la firma: el kit no ataja lo que lanza quien escucha", async () => {
    h.impl.signAndSubmitTx = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign" });
      return { status: "success", hash: "deadbeef" };
    };
    await expect(pollarWallet.signAndSubmit(armar("10").toXDR())).resolves.toBe("deadbeef");
  });

  it("sin co-firma (la cuenta no la pidió) no anota nada", async () => {
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    await new Promise((r) => setTimeout(r, 20));
    expect(lineas()).toEqual([]);
  });

  it("una co-firma de antes, que el kit repite al suscribirse, no cuenta", async () => {
    h.transaccion = { step: "awaiting_cosign", request: { id: "vieja", status: "PENDING", unsignedPayload: armar("3", true).toXDR() } };
    h.cofirma = { pending: [], lastResolved: resuelto("vieja", armar("3", true).toXDR()) };
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

  it("el cliente se arma como siempre: el kit vota solo y la configuración no trae el voto a mano", async () => {
    await pollarWallet.signAndSubmit(armar("10").toXDR());
    expect(h.config).toMatchObject({ confirmation: "prompt", stellarNetwork: "mainnet" });
    expect(h.config).not.toHaveProperty("cosignManual");
  });
});

describe("el testigo de Mandar en la red principal", () => {
  it("cuenta el envío del mismo modo y no cambia lo que devuelve", async () => {
    const envio = armarElEnvio("prueba");
    const votado = { intent: "sign_and_send", refreshable: true, signedXdr: firmada(envio), submit: { status: "SUCCESS", hash: hashDe(envio) } };
    sellarConCofirma(envio.toXDR(), votado);
    await expect(pollarWallet.signAndSubmit(envio.toXDR())).resolves.toBe("deadbeef");
    await vi.waitFor(() =>
      expect(lineas()).toEqual([
        "[tinkazo] testigo: misma transacción | distinto ninguno | intención sign_and_send | releíble sí | firmada simple | envío mismo-hash",
      ]),
    );
  });

  it("si Pollar cambió la nota, lo dice", async () => {
    sellarConCofirma(armarElEnvio("otra").toXDR(), { intent: "sign_and_send" });
    await pollarWallet.signAndSubmit(armarElEnvio("prueba").toXDR());
    await vi.waitFor(() => expect(lineas()).toHaveLength(1));
    expect(lineas()[0]).toContain("[tinkazo] testigo: mismas operaciones | distinto nota | ");
  });
});

describe("el testigo de la línea del dólar digital en la red principal", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RAMPA", "recibir");
  });

  /** La línea como la pide el kit: arma el pedido, lo vota y lo resuelve, con la transacción que armó el proveedor. */
  function pedirLaLinea(extra: Record<string, unknown> = {}): void {
    const linea = armarLaLinea();
    h.impl.setTrustline = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "linea-1", status: "PENDING", unsignedPayload: linea.toXDR() } });
      const submit = { status: "SUCCESS", hash: hashDe(linea) };
      const votada = { intent: "sign_and_send", operation: "change_trust", refreshable: true, signedXdr: firmada(linea), submit };
      h.cofirma = { pending: [], lastResolved: resuelto("linea-1", linea.toXDR(), { ...votada, ...extra }) };
      emitirTransaccion(h, { step: "success", hash: hashDe(linea) });
      return { status: "success", hash: hashDe(linea) };
    };
  }

  it("un aviso del kit que la escucha no sabe leer no cambia lo que devuelve la línea", async () => {
    h.impl.setTrustline = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign" });
      return { status: "success" };
    };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
  });

  it("anota cómo era lo que votó el kit, y la persona recibe lo mismo de siempre", async () => {
    pedirLaLinea();
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    const operaciones = "beginSponsoringFutureReserves(otra),changeTrust(propia),endSponsoringFutureReserves(propia)";
    const resto = "paga otra | activo circle | límite máximo | nota ninguna | condiciones solo-tiempo | sobre simple";
    const cola = "intención sign_and_send | releíble sí | envío mismo-hash";
    await vi.waitFor(() => expect(lineas()).toEqual([`[tinkazo] testigo de la línea: ${operaciones} | ${resto} | ${cola}`]));
  });

  it("la línea sale por la consola de información, también con otra intención", async () => {
    pedirLaLinea({ intent: "otra-cosa" });
    await pollarWallet.activarUsdc();
    await vi.waitFor(() => expect(porInfo()).toHaveLength(1));
    expect(porInfo()[0]).toContain("| intención otra | ");
    expect(porAdvertencia()).toEqual([]);
  });

  it("sin pedido de co-firma (la línea entró sin que nadie votara) no anota nada", async () => {
    h.impl.setTrustline = async () => ({ status: "success" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    await new Promise((r) => setTimeout(r, 20));
    expect(lineas()).toEqual([]);
  });

  it("un testigo que falla no cambia lo que devuelve la línea", async () => {
    pedirLaLinea();
    h.impl.getCosignState = () => {
      throw new Error("se rompió");
    };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
  });

  it("un error de la línea sale igual, con el testigo puesto", async () => {
    h.impl.setTrustline = async () => ({ status: "error", code: "SDK_CREDITS_INSUFFICIENT" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("ahora-no");
  });

  it("una línea que el kit deja esperando sigue siendo en curso y no anota nada", async () => {
    h.impl.setTrustline = async () => {
      emitirTransaccion(h, { step: "awaiting_cosign", request: { id: "linea-2", status: "PENDING", unsignedPayload: armarLaLinea().toXDR() } });
      return { status: "cosign_pending", request: { id: "linea-2" } };
    };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    await new Promise((r) => setTimeout(r, 20));
    expect(lineas()).toEqual([]);
  });

  it("después de pedir la línea se suelta la suscripción", async () => {
    pedirLaLinea();
    await pollarWallet.activarUsdc();
    expect(h.oyentes.transaccion.size).toBe(0);
  });

  it("en modo Prueba no hay testigo de la línea", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
    let suscritos = -1;
    h.impl.setTrustline = async () => {
      suscritos = h.oyentes.transaccion.size;
      return { status: "success" };
    };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(suscritos).toBe(0);
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
