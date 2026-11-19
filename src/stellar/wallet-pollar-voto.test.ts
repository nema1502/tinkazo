import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Account, Asset, Keypair, Networks, Operation, StrKey, type Transaction, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import type { CosignRequest, CosignVerification } from "@pollar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COFIRMA_DISTINTA, COFIRMA_TOPE } from "./cofirma-regla";
import { errorKey, esDeRed } from "./errores";
import { USDC_MAINNET } from "./pagos";
import { PASSPHRASE_TESTNET, almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * El voto por contenido en la billetera de Google (issue 180, `wallet-pollar.ts`): con la variable del build en la red
 * principal, el kit devuelve el pedido de co-firma sin votarlo y el navegador vota solo si la transacción del pedido es,
 * byte a byte, la que armó la página. Con el cliente de mentira (`pollar-falso.ts`) y, para `verify`, el `CosignManager`
 * de verdad del kit con la frase de la red principal. Nada sale de la prueba: ni red, ni reloj real.
 *
 * La línea del dólar digital se vota con su regla por forma: la que devuelve el kit con el voto a mano y, con el voto a
 * mano o sin él, la que abre solo el proveedor y espera en la lista, solo con el toque de la persona.
 *
 * En cada caso: nunca se llama a `approve` ni a `cancel`, y `reject` solo en los casos que lo piden y solo con el id del
 * pedido de la llamada.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, MARCAS_DE_LA_CUENTA, resultadoDeLaLinea } = await import("./wallet-pollar");
const kit = await vi.importActual<typeof import("@pollar/core")>("@pollar/core");
const kitReal = new kit.CosignManager({
  api: {} as never,
  keyManager: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  networkPassphrase: () => Networks.PUBLIC,
  onRequest: () => undefined,
});

const persona = Keypair.random();
const P = persona.publicKey();
const OTRA = Keypair.random().publicKey();
const SUB = "sub-org-de-la-cuenta";
const CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(7));
const ID = "pedido-1";
/** Límites de tiempo fijos: dos transacciones armadas igual son idénticas. */
const TIEMPO = { minTime: 0, maxTime: 1_900_000_000 };

const sellar = (): xdr.Operation => Operation.invokeContractFunction({ contract: CONTRATO, function: "seal", args: [] });

/** El sello que arma la página: una invocación del contrato oficial, de la cuenta de la sesión. */
function armar(o: { secuencia?: string; origen?: string; operaciones?: xdr.Operation[] } = {}): Transaction {
  const opciones = { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: TIEMPO };
  const b = new TransactionBuilder(new Account(o.origen ?? P, o.secuencia ?? "10"), opciones);
  for (const op of o.operaciones ?? [sellar()]) b.addOperation(op);
  return b.build();
}

const hashDe = (t: { hash(): Uint8Array }): string => Buffer.from(t.hash()).toString("hex");
const firmada = (t: Transaction): string => {
  const copia = TransactionBuilder.fromXDR(t.toXDR(), Networks.PUBLIC) as Transaction;
  copia.sign(persona);
  return copia.toXDR();
};

type Pedido = Record<string, unknown> & { id: string };

/** El pedido que devuelve el kit con el voto a mano, todavía pendiente, para la transacción `t`. */
function pedidoDe(t: Transaction | string, cambios: Partial<Pedido> = {}): Pedido {
  const xdr = typeof t === "string" ? t : t.toXDR();
  return {
    id: ID,
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "sign",
    account: P,
    signWith: P,
    refreshable: false,
    unsignedPayload: xdr,
    payloadHash: typeof t === "string" ? "" : hashDe(t),
    activityId: null,
    subOrgId: SUB,
    ...cambios,
  };
}
const aprobado = (p: Pedido, extra: Partial<Pedido> = {}): Pedido => ({ ...p, status: "APPROVED", activityId: "actividad-1", ...extra });

/** El kit con el voto a mano: la firma devuelve el pedido sin votarlo, como `_settleCosign` con `cosignManual`. */
function elKitDevuelve(pedido: Pedido): void {
  h.impl.signTx = async () => ({ status: "cosign_pending", request: structuredClone(pedido) });
  h.impl.signAndSubmitTx = async () => ({ status: "cosign_pending", request: structuredClone(pedido) });
}

/** El voto sale: `relay` contesta con el pedido aprobado y lo que diga `extra`. */
function elVotoSale(pedido: Pedido, extra: Partial<Pedido>): void {
  h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(pedido, extra) });
}

const pedidosALaRed: string[] = [];
let rechazoEsperado = false;
const llamadasDelVoto = (): string[] => h.llamadas.filter((n) => !["ready", "getCosignState", "logout", "devices", "publicKeyHex"].includes(n));
const veces = (nombre: string): number => h.llamadas.filter((n) => n === nombre).length;
const avisos = (): string => vi.mocked(console.warn).mock.calls.flat().map(String).join("\n");
const informes = (): string => vi.mocked(console.info).mock.calls.flat().map(String).join("\n");
async function falla(p: Promise<unknown>): Promise<Error> {
  const r = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(r, "tendría que haber fallado").toBeInstanceOf(Error);
  return r as Error;
}
/** Se rechaza el pedido de la llamada: el kit lo lee y lo cancela si sigue pendiente. */
const dejarRechazar = (): void => {
  rechazoEsperado = true;
  h.impl.reject = async (id: string) => ({ id, status: "REJECTED" });
};

beforeEach(() => {
  reiniciar(h);
  h.red.contractId = CONTRATO;
  pedidosALaRed.length = 0;
  rechazoEsperado = false;
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
  vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      pedidosALaRed.push(String(url));
      throw new TypeError("la prueba no le pide nada a la red");
    }),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = P;
  const recuperacion = { required: true, configured: true, subOrgId: SUB, email: { address: null, verified: false }, passkeys: [], devices: [] };
  h.impl["recovery.status"] = async () => recuperacion;
  h.impl.verify = (r: CosignRequest) => kitReal.verify(r);
});

afterEach(async () => {
  expect(h.llamadas).not.toContain("approve");
  expect(h.llamadas).not.toContain("cancel");
  if (!rechazoEsperado) expect(h.llamadas).not.toContain("reject");
  for (const [id] of h.argumentos.reject ?? []) expect(id).toBe(ID);
  await pollarWallet.disconnect();
  h.red.contractId = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el cliente con el voto a mano", () => {
  it("con la variable en la red principal nace con cosignManual y vota por contenido", async () => {
    await expect(pollarWallet.revisarPuertaDelPremio()).resolves.toBe("libre");
    expect(h.config).toMatchObject({ cosignManual: true, confirmation: "prompt", stellarNetwork: "mainnet" });
    expect(pollarWallet.votaPorContenido()).toBe(true);
    expect(informes()).toContain("[tinkazo] voto por contenido: prendido");
    expect(pedidosALaRed).toEqual([]);
  });

  it("sin la variable la configuración es la de hoy, sin ese campo, y no vota por contenido", async () => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    await pollarWallet.estadoOficial();
    expect(h.construidos).toBe(1);
    expect(h.config).not.toHaveProperty("cosignManual");
    expect(pollarWallet.votaPorContenido()).toBe(false);
    expect(informes()).not.toContain("voto por contenido");
  });

  it("sin cliente armado no vota por contenido", () => {
    expect(pollarWallet.votaPorContenido()).toBe(false);
  });

  it("con la variable y un kit que no toma el voto a mano: lo dice, no vota por contenido y la puerta lee y frena", async () => {
    h.kitTomaElVotoAMano = false;
    vi.stubEnv("VITE_RAMPA", "premios");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        pedidosALaRed.push(String(url));
        const emisor = Keypair.random().publicKey();
        const linea = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: emisor, balance: "5.0000000", limit: "10.0000000" };
        const nativo = { asset_type: "native", balance: "0.0000000", selling_liabilities: "0.0000000", buying_liabilities: "0.0000000" };
        const cuenta = { id: P, sequence: "1", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0, balances: [nativo, linea] };
        return new Response(JSON.stringify(cuenta), { status: 200 });
      }),
    );
    const e = await falla(pollarWallet.signUnsponsored(armar().toXDR()));
    expect(e.name).toBe("PremioGuardado");
    expect(avisos()).toContain("[tinkazo] voto por contenido: el kit no lo tomó");
    expect(pollarWallet.votaPorContenido()).toBe(false);
    expect(pedidosALaRed.length).toBeGreaterThan(0);
    expect(veces("signTx")).toBe(0);
  });

  it("en la red de prueba la variable no cambia el cliente ni la firma", async () => {
    h.red.name = "testnet";
    h.red.networkPassphrase = PASSPHRASE_TESTNET;
    h.redDelCliente = "testnet";
    await expect(pollarWallet.signUnsponsored("XDR-DEL-SELLO")).resolves.toBe("FIRMADA");
    expect(h.config).not.toHaveProperty("cosignManual");
    expect(pollarWallet.votaPorContenido()).toBe(false);
    expect(llamadasDelVoto()).toEqual(["signTx"]);
  });
});

describe("el sello y el sorteo con la misma transacción se votan", () => {
  it("por el portero (signUnsponsored): signTx, la organización, verify y relay, en ese orden, y devuelve lo firmado", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    elVotoSale(pedido, { signedXdr: firmada(a) });
    await expect(pollarWallet.signUnsponsored(a.toXDR())).resolves.toBe(firmada(a));
    expect(llamadasDelVoto()).toEqual(["signTx", "recovery.status", "verify", "relay"]);
    const [ruta, cuerpo, opciones] = h.argumentos.relay?.[0] ?? [];
    expect(ruta).toBe("/public/v1/submit/sign_raw_payload");
    expect((cuerpo as { parameters: { payload: unknown } }).parameters.payload).toBe(hashDe(a));
    expect(opciones).toEqual({ requestId: ID });
    expect(informes()).toContain("[tinkazo] co-firma votada: la misma transacción (intención sign, firmas en el sobre: 0)");
  });

  it("el sorteo del contrato oficial se vota igual", async () => {
    const a = armar({ operaciones: [Operation.invokeContractFunction({ contract: CONTRATO, function: "draw", args: [] })] });
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    elVotoSale(pedido, { signedXdr: firmada(a) });
    await expect(pollarWallet.signUnsponsored(a.toXDR())).resolves.toBe(firmada(a));
  });

  it("con un pedido que se puede volver a pedir, se relee una vez y se vota la releída", async () => {
    const a = armar();
    const pedido = pedidoDe(a, { refreshable: true });
    let releido: Pedido | null = null;
    h.impl.refresh = async (id: string) => {
      releido = { ...structuredClone(pedido), id };
      return releido;
    };
    elKitDevuelve(pedido);
    elVotoSale(pedido, { signedXdr: firmada(a) });
    await expect(pollarWallet.signUnsponsored(a.toXDR())).resolves.toBe(firmada(a));
    expect(llamadasDelVoto()).toEqual(["signTx", "recovery.status", "refresh", "verify", "relay"]);
    expect(h.argumentos.refresh).toEqual([[ID]]);
    expect(h.argumentos.verify?.[0]?.[0]).toBe(releido);
  });

  it("con el sello por Pollar (signAndSubmit) y el envío en SUCCESS devuelve el hash de la armada", async () => {
    const a = armar();
    const pedido = pedidoDe(a, { intent: "sign_and_send" });
    elKitDevuelve(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: hashDe(a) } });
    await expect(pollarWallet.signAndSubmit(a.toXDR())).resolves.toBe(hashDe(a));
    expect(informes()).toContain("(intención sign_and_send, firmas en el sobre: 0)");
  });

  it("nunca vota un pedido de la lista de pendientes: con uno igual y otro id, relay lleva solo el id de la llamada", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    h.cofirma = { pending: [{ ...pedido, id: "pedido-de-la-lista" }] };
    h.impl.pending = async () => [{ ...pedido, id: "pedido-de-la-lista" }];
    elKitDevuelve(pedido);
    elVotoSale(pedido, { signedXdr: firmada(a) });
    await pollarWallet.signUnsponsored(a.toXDR());
    expect(h.argumentos.relay?.map(([, , o]) => o)).toEqual([{ requestId: ID }]);
    expect(h.llamadas).not.toContain("pending");
  });
});

describe("lo que no es la armada no se vota y se dice que no se hizo nada", () => {
  it("una con otra operación: sin relay, cofirmaDistinta, la consola dice los campos y se rechaza el pedido de la llamada", async () => {
    dejarRechazar();
    const a = armar();
    const otra = armar({ operaciones: [Operation.manageData({ name: "tinkazo", value: "otra" })] });
    elKitDevuelve(pedidoDe(otra));
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(esDeRed(e)).toBe(false);
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(avisos()).toContain("[tinkazo] co-firma no votada: hash | operacion 0 | tipos manageData");
    expect(informes()).not.toContain("co-firma votada");
    expect(avisos()).not.toMatch(/[GCM][A-Z2-7]{55}/);
    expect(avisos()).not.toMatch(/[0-9a-f]{40,}/);
  });

  it("un pedido que dice el hash de la armada y trae otra transacción no se vota: lo frena la comparación, antes de verify", async () => {
    dejarRechazar();
    const a = armar();
    const otra = armar({ operaciones: [Operation.manageData({ name: "tinkazo", value: "otra" })] });
    elKitDevuelve(pedidoDe(otra, { payloadHash: hashDe(a) }));
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(veces("verify")).toBe(0);
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(avisos()).toContain("[tinkazo] co-firma no votada: operacion 0 | tipos manageData");
  });

  it("envuelta en un fee bump, aunque adentro sea la misma, no se vota", async () => {
    dejarRechazar();
    const a = armar();
    const envuelta = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "100000", a, Networks.PUBLIC);
    elKitDevuelve(pedidoDe(envuelta.toXDR(), { payloadHash: hashDe(envuelta) }));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
  });

  it("la misma operación pagada por otra cuenta no se vota", async () => {
    dejarRechazar();
    const a = armar();
    elKitDevuelve(pedidoDe(armar({ origen: OTRA })));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
  });

  it("un pedido con el hash de la red de prueba no se vota", async () => {
    dejarRechazar();
    const a = armar();
    const deOtraRed = hashDe(TransactionBuilder.fromXDR(a.toXDR(), Networks.TESTNET));
    elKitDevuelve(pedidoDe(a, { payloadHash: deOtraRed }));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
  });

  it("reconstruida con otra secuencia no se vota", async () => {
    dejarRechazar();
    const a = armar();
    elKitDevuelve(pedidoDe(armar({ secuencia: "11" })));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(avisos()).toContain("[tinkazo] co-firma no votada: hash | secuencia");
    expect(veces("relay")).toBe(0);
  });

  it("si al releer el pedido trae otra transacción, no se vota aunque la primera coincidía", async () => {
    dejarRechazar();
    const a = armar();
    const pedido = pedidoDe(a, { refreshable: true });
    h.impl.refresh = async () => pedidoDe(armar({ secuencia: "11" }), { refreshable: true });
    elKitDevuelve(pedido);
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("si al releer el pedido trae otro id, no se vota ni se rechaza", async () => {
    const a = armar();
    h.impl.refresh = async () => pedidoDe(a, { id: "otro-pedido", refreshable: true });
    elKitDevuelve(pedidoDe(a, { refreshable: true }));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
  });

  it("un pedido con otra intención (firmar y mandar en la firma del portero) no se vota ni se rechaza", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { intent: "sign_and_send" }));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
  });
});

describe("lo que el kit va a estampar tiene que ser exactamente el hash de la armada", () => {
  /** `verify` del kit, con la propuesta cambiada como diga `cambiar`. */
  function verifyCon(cambiar: (v: Extract<CosignVerification, { ok: true }>) => void): void {
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      if (v.ok) cambiar(v);
      return v;
    };
  }
  type Aprobada = Extract<CosignVerification, { ok: true }>;
  const parametros = (v: Aprobada): Record<string, unknown> => (v.proposal.body as { parameters: Record<string, unknown> }).parameters;

  async function noSeVota(): Promise<void> {
    dejarRechazar();
    const a = armar();
    elKitDevuelve(pedidoDe(a));
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("cofirmaDistinta");
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
  }

  it("verify con otro hash no se vota", async () => {
    verifyCon((v) => void (v.localHash = "ab".repeat(32)));
    await noSeVota();
  });

  it("una propuesta con otra cuenta no se vota", async () => {
    verifyCon((v) => void (parametros(v).signWith = OTRA));
    await noSeVota();
  });

  it("una propuesta de otra organización no se vota", async () => {
    verifyCon((v) => void ((v.proposal.body as { organizationId: string }).organizationId = "otra-org"));
    await noSeVota();
  });

  it("una propuesta con otro payload no se vota", async () => {
    verifyCon((v) => void (parametros(v).payload = "cd".repeat(32)));
    await noSeVota();
  });

  it("una propuesta con una clave de más no se vota", async () => {
    verifyCon((v) => void (parametros(v).extra = "x"));
    await noSeVota();
  });
});

describe("desde el relay nunca se dice que no se hizo nada", () => {
  it("un relay que se corta se lee una vez: aprobado sigue, sin otro relay y sin rechazar", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("Request timed out after 60000ms");
    };
    h.impl.get = async () => aprobado(pedido, { signedXdr: firmada(a) });
    await expect(pollarWallet.signUnsponsored(a.toXDR())).resolves.toBe(firmada(a));
    expect(veces("relay")).toBe(1);
    expect(h.argumentos.get).toEqual([[ID, { sync: true }]]);
  });

  it("un relay que se corta con el pedido todavía pendiente da pollar-pending, sin otro relay y sin rechazar", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("Request timed out after 60000ms");
    };
    h.impl.get = async () => ({ ...pedido, activityId: "actividad-1" });
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(errorKey(e)).toBe("unconfirmed");
    expect(veces("relay")).toBe(1);
    expect(avisos()).toContain("[tinkazo] co-firma incierta: sin confirmar");
  });

  it("un relay con un error del kit que no es un corte y el pedido aprobado y mandado: el sello por Pollar entra", async () => {
    const a = armar();
    const pedido = pedidoDe(a, { intent: "sign_and_send" });
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR");
    };
    h.impl.get = async () => aprobado(pedido, { submit: { status: "SUCCESS", hash: hashDe(a) } });
    await expect(pollarWallet.signAndSubmit(a.toXDR())).resolves.toBe(hashDe(a));
  });

  it("el mismo error con el pedido aprobado y firmado: el sello por el portero sigue", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR");
    };
    h.impl.get = async () => aprobado(pedido, { signedXdr: firmada(a) });
    await expect(pollarWallet.signUnsponsored(a.toXDR())).resolves.toBe(firmada(a));
  });

  it("el mismo error con el pedido pendiente y con actividad: se rechaza el estampado y es pollar-pending", async () => {
    dejarRechazar();
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR");
    };
    h.impl.get = async () => ({ ...pedido, activityId: "actividad-1" });
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(avisos()).toContain("[tinkazo] co-firma incierta: relay con error y actividad");
  });

  it("el mismo error con el pedido pendiente sin actividad y un rechazo que no sale: pollar-pending, nunca el código del kit", async () => {
    rechazoEsperado = true;
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR");
    };
    h.impl.get = async () => structuredClone(pedido);
    // Entre la lectura y el rechazo el pedido se aprobó: el kit lo lee de nuevo y ya no lo cancela.
    h.impl.reject = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_REQUEST_NOT_PENDING");
    };
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(errorKey(e)).toBe("unconfirmed");
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(avisos()).toContain("[tinkazo] co-firma incierta: relay con error y sin rechazo");
  });

  it("un relay que vuelve sin el pedido y una lectura que no lo trae: pollar-pending, sin otro relay", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a));
    h.impl.relay = async () => ({ status: 200, body: {} });
    h.impl.get = async () => undefined;
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(esDeRed(e)).toBe(false);
    expect(veces("relay")).toBe(1);
  });

  it("lo que vuelve del voto con otro id no decide: un pedido ajeno rechazado no dice que no se hizo nada", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...pedido, id: "pedido-ajeno", status: "REJECTED" } });
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(errorKey(e)).toBe("unconfirmed");
  });

  it("un navegador que la cuenta no conoce, con el pedido pendiente sin actividad: se rechaza y abre el paso de la cuenta", async () => {
    dejarRechazar();
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_DEVICE_NOT_ENROLLED");
    };
    h.impl.get = async () => structuredClone(pedido);
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(errorKey(e)).toBe("deviceNotEnrolled");
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("un servicio sin créditos, con el pedido pendiente sin actividad: se rechaza y dice lo de siempre", async () => {
    dejarRechazar();
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_CREDITS_INSUFFICIENT");
    };
    h.impl.get = async () => structuredClone(pedido);
    expect(errorKey(await falla(pollarWallet.signUnsponsored(a.toXDR())))).toBe("sponsorEmpty");
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("aprobado con lo firmado de otra transacción: pollar-pending, nunca cofirmaDistinta", async () => {
    const a = armar();
    const pedido = pedidoDe(a);
    elKitDevuelve(pedido);
    elVotoSale(pedido, { signedXdr: firmada(armar({ secuencia: "11" })) });
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(errorKey(e)).toBe("unconfirmed");
  });

  it("aprobado sin envío ni lo firmado, por Pollar: pollar-pending", async () => {
    const a = armar();
    const pedido = pedidoDe(a, { intent: "sign_and_send" });
    elKitDevuelve(pedido);
    elVotoSale(pedido, {});
    expect((await falla(pollarWallet.signAndSubmit(a.toXDR()))).message).toBe("pollar-pending");
  });

  /** Corre el reloj de mentira de a una espera del envío hasta que la firma termina. */
  async function hastaQueTermine(firma: Promise<Error>): Promise<Error> {
    let listo = false;
    void firma.finally(() => (listo = true));
    for (let i = 0; i < 40 && !listo; i++) await vi.advanceTimersByTimeAsync(2_500);
    return firma;
  }

  it("aprobado con un envío cuyo hash no cierra y que la red no confirma: pollar-pending", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const a = armar();
    const pedido = pedidoDe(a, { intent: "sign_and_send" });
    elKitDevuelve(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: "ef".repeat(32) } });
    h.impl.getTxStatus = async (hash: string) => ({ hash, status: "PENDING" });
    const e = await hastaQueTermine(falla(pollarWallet.signAndSubmit(a.toXDR())));
    expect(e.message).toBe("pollar-pending");
    expect(h.argumentos.getTxStatus?.map(([hash]) => hash)).toEqual(Array.from({ length: 16 }, () => hashDe(a)));
  });

  it("aprobado con el envío en PENDING que termina FAILED: el error de la red, que no es incierto", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const a = armar();
    const pedido = pedidoDe(a, { intent: "sign_and_send" });
    elKitDevuelve(pedido);
    elVotoSale(pedido, { submit: { status: "PENDING", hash: hashDe(a) } });
    h.impl.getTxStatus = async (hash: string) => ({ hash, status: "FAILED", resultCode: "txFailed" });
    const e = await hastaQueTermine(falla(pollarWallet.signAndSubmit(a.toXDR())));
    expect(e.message).toContain("txFailed");
    expect(errorKey(e)).toBe("busy");
  });
});

describe("lo que ya no espera nuestro voto", () => {
  it("el pedido de la llamada que ya trae una actividad: no se vota, se rechaza y es incierto", async () => {
    dejarRechazar();
    const a = armar();
    elKitDevuelve(pedidoDe(a, { activityId: "actividad-de-otro" }));
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("pollar-pending");
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("un pedido que ya se aprobó sin nuestro voto es incierto", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { status: "APPROVED" }));
    expect((await falla(pollarWallet.signUnsponsored(a.toXDR()))).message).toBe("pollar-pending");
    expect(veces("relay")).toBe(0);
  });

  it("un pedido vencido no se vota y dice su estado", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { status: "EXPIRED" }));
    expect((await falla(pollarWallet.signUnsponsored(a.toXDR()))).message).toContain("SDK_COSIGN_EXPIRED");
    expect(veces("relay")).toBe(0);
  });

  it("un pedido rechazado no se vota y dice su estado", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { status: "REJECTED" }));
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toContain("SDK_COSIGN_REJECTED");
    expect(errorKey(e)).toBe("cosignRejected");
  });

  it("si la sesión cambia entre la lectura y el voto, no se vota ni se rechaza", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a));
    h.impl.verify = async (r: CosignRequest) => {
      h.billetera = { address: OTRA, provisioning: "READY", existsOnStellar: true };
      return kitReal.verify(r);
    };
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(errorKey(e)).toBe("userRejected");
    expect(veces("relay")).toBe(0);
  });
});

describe("los errores del kit de antes del voto salen como el kit", () => {
  it("releer con un error del kit sale con su código, se rechaza el pedido y no es cofirmaDistinta", async () => {
    dejarRechazar();
    const a = armar();
    elKitDevuelve(pedidoDe(a, { refreshable: true }));
    h.impl.refresh = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_REQUEST_NOT_FOUND");
    };
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toContain("SDK_COSIGN_REQUEST_NOT_FOUND");
    expect(errorKey(e)).not.toBe("cofirmaDistinta");
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(veces("relay")).toBe(0);
  });

  it("un corte al releer es de red, como siempre, sin rechazar ni votar", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { refreshable: true }));
    h.impl.refresh = async () => {
      throw new kit.PollarNetworkError("Request timed out after 10000ms");
    };
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(esDeRed(e)).toBe(true);
    expect(veces("relay")).toBe(0);
  });

  it("un error de la firma de antes de cualquier co-firma sale tal cual", async () => {
    h.impl.signTx = async () => ({ status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED" });
    const e = await falla(pollarWallet.signUnsponsored(armar().toXDR()));
    expect(errorKey(e)).toBe("recoveryRequired");
  });
});

describe("lo que el kit devuelve sin pedido no pasó por la regla", () => {
  it("firmado sin pedido no se usa: cofirmaDistinta con el motivo sin-pedido", async () => {
    h.impl.signTx = async () => ({ status: "signed", signedXdr: firmada(armar()) });
    const e = await falla(pollarWallet.signUnsponsored(armar().toXDR()));
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(avisos()).toContain("[tinkazo] co-firma no votada: sin-pedido");
  });

  it("mandado sin pedido es incierto: pollar-pending", async () => {
    h.impl.signAndSubmitTx = async () => ({ status: "success", hash: hashDe(armar()) });
    expect((await falla(pollarWallet.signAndSubmit(armar().toXDR()))).message).toBe("pollar-pending");
  });

  it("al pedir firmar y mandar, firmado sin pedido es incierto, porque pudo haber salido, y no cuenta para el tope", async () => {
    h.impl.signAndSubmitTx = async () => ({ status: "signed", signedXdr: firmada(armar()) });
    expect((await falla(pollarWallet.signAndSubmit(armar().toXDR()))).message).toBe("pollar-pending");
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintas)).toBeNull();
  });
});

describe("la lista de lo permitido: solo el sello y el sorteo del contrato oficial", () => {
  it("un pago no llega a pedirse: cofirmaDistinta sin llamar a la firma", async () => {
    const pago = Operation.payment({ destination: OTRA, asset: new Asset("USDC", Keypair.random().publicKey()), amount: "1" });
    const e = await falla(pollarWallet.signAndSubmit(armar({ operaciones: [pago] }).toXDR()));
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(veces("signAndSubmitTx")).toBe(0);
    expect(avisos()).toContain("[tinkazo] co-firma no votada: fuera de lo permitido (operaciones)");
  });

  it("la invocación de otro contrato no llega a pedirse", async () => {
    const ajeno = Operation.invokeContractFunction({ contract: StrKey.encodeContract(new Uint8Array(32).fill(9)), function: "seal", args: [] });
    expect(errorKey(await falla(pollarWallet.signUnsponsored(armar({ operaciones: [ajeno] }).toXDR())))).toBe("cofirmaDistinta");
    expect(veces("signTx")).toBe(0);
  });

  it("lo que no se permite no cuenta para el tope", async () => {
    const ajeno = Operation.manageData({ name: "tinkazo", value: "otra" });
    for (let i = 0; i < 3; i++) await falla(pollarWallet.signUnsponsored(armar({ operaciones: [ajeno] }).toXDR()));
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintas)).toBeNull();
  });
});

describe("el tope de negativas de la pestaña", () => {
  /** Una firma cuyo pedido trae otra transacción: la regla no la vota. */
  async function unaNegativa(): Promise<Error> {
    const a = armar();
    elKitDevuelve(pedidoDe(armar({ secuencia: "11" })));
    return falla(pollarWallet.signUnsponsored(a.toXDR()));
  }

  it("la primera negativa invita a probar de nuevo y la segunda ya es el tope", async () => {
    dejarRechazar();
    const primera = await unaNegativa();
    expect(primera.message).toBe("tinkazo-cofirma-distinta");
    const segunda = await unaNegativa();
    expect(segunda.message).toBe("tinkazo-cofirma-distinta-tope");
    expect(errorKey(segunda)).toBe("cofirmaDistinta");
  });

  it("con el tope alcanzado no se le pide nada al servidor", async () => {
    dejarRechazar();
    await unaNegativa();
    await unaNegativa();
    const tercera = await unaNegativa();
    expect(tercera.message).toBe("tinkazo-cofirma-distinta-tope");
    expect(veces("signTx")).toBe(2);
  });

  it("cerrar sesión lo borra", async () => {
    dejarRechazar();
    await unaNegativa();
    await unaNegativa();
    await pollarWallet.disconnect();
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintas)).toBeNull();
    pollarWallet.address = P;
    expect((await unaNegativa()).message).toBe("tinkazo-cofirma-distinta");
  });

  it("cambiar de cuenta lo borra", async () => {
    dejarRechazar();
    await unaNegativa();
    await unaNegativa();
    const otraPersona = Keypair.random().publicKey();
    h.billetera = { address: otraPersona, provisioning: "READY", existsOnStellar: true };
    pollarWallet.address = otraPersona;
    const a = armar({ origen: otraPersona });
    elKitDevuelve(pedidoDe(armar({ origen: otraPersona, secuencia: "11" }), { account: otraPersona, signWith: otraPersona }));
    const e = await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(e.message).toBe("tinkazo-cofirma-distinta");
    expect(veces("signTx")).toBe(3);
  });

  it("lo incierto y los errores del kit no cuentan", async () => {
    const a = armar();
    elKitDevuelve(pedidoDe(a, { status: "APPROVED" }));
    await falla(pollarWallet.signUnsponsored(a.toXDR()));
    h.impl.signTx = async () => ({ status: "error", code: "SDK_WALLET_RECOVERY_REQUIRED" });
    await falla(pollarWallet.signUnsponsored(a.toXDR()));
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintas)).toBeNull();
  });
});

describe("la activación de la cuenta no cambia con el voto a mano", () => {
  it("lee, pide de nuevo una vez, verifica y estampa como siempre, sin rechazar nada", async () => {
    const patrocinador = Keypair.random();
    const t = new TransactionBuilder(new Account(patrocinador.publicKey(), "1"), { fee: "300", networkPassphrase: Networks.PUBLIC })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: P }))
      .addOperation(Operation.createAccount({ destination: P, startingBalance: "0" }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: P }))
      .setTimeout(300)
      .build();
    t.sign(patrocinador);
    const crear = pedidoDe(t, { intent: "account_create", operation: "create_account", appPaysFee: true, refreshable: true });
    h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
    h.impl.pending = async () => [structuredClone(crear)];
    h.impl.refresh = async () => structuredClone(crear);
    h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(crear, { submit: { status: "SUCCESS", hash: hashDe(t) } }) });
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.config).toMatchObject({ cosignManual: true });
    expect(llamadasDelVoto()).toEqual(["refreshWalletState", "pending", "recovery.status", "refresh", "verify", "relay"]);
  });
});

/* ------------------------------------------------------------------ la línea del dólar digital */

const PAGA = Keypair.random().publicKey();
const LIMITE_MAXIMO = "922337203685.4775807";
/** El pedido de la línea que abre solo el proveedor y espera en la lista, sin que nadie toque Recibir un premio. */
const DEL_PROVEEDOR = "linea-del-proveedor";

/** Sin límites de tiempo, como se midió: el SDK los arma con los dos en cero. */
const SIN_LIMITES = { minTime: 0, maxTime: 0 };

/**
 * La línea como la arma el proveedor: la paga otra cuenta, sin nota, sin límites de tiempo (salvo que `o.tiempo` diga
 * otros), con tres operaciones y el dólar digital de la red.
 */
function armarLaLinea(o: { limite?: string; tiempo?: typeof TIEMPO } = {}): Transaction {
  const usdc = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);
  return new TransactionBuilder(new Account(PAGA, "20"), { fee: "100", networkPassphrase: Networks.PUBLIC, timebounds: o.tiempo ?? SIN_LIMITES })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: P, source: PAGA }))
    .addOperation(Operation.changeTrust({ asset: usdc, limit: o.limite ?? LIMITE_MAXIMO, source: P }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: P }))
    .build();
}

/** El pedido de la línea, todavía pendiente, como llegó en la red principal. */
const pedidoDeLaLinea = (t: Transaction, cambios: Partial<Pedido> = {}): Pedido =>
  pedidoDe(t, { intent: "sign_and_send", operation: "change_trust", appPaysFee: true, ...cambios });

/** El kit con el voto a mano: `setTrustline` devuelve el pedido de la llamada sin votarlo. */
function laLineaDevuelve(pedido: Pedido): void {
  h.impl.setTrustline = async () => ({ status: "cosign_pending", request: structuredClone(pedido) });
}

/** La lista de pedidos que esperan, como la lee el kit. */
function enLaLista(...pedidos: Pedido[]): void {
  h.impl.pending = async () => pedidos.map((p) => structuredClone(p));
}

describe("la línea del dólar digital con el voto a mano", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RAMPA", "recibir");
  });

  it("con la forma esperada se vota por relay y da hecho, sin testigo", async () => {
    const t = armarLaLinea();
    const pedido = pedidoDeLaLinea(t);
    laLineaDevuelve(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: hashDe(t) } });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(llamadasDelVoto()).toEqual(["pending", "setTrustline", "recovery.status", "verify", "relay"]);
    const [, cuerpo, opciones] = h.argumentos.relay?.[0] ?? [];
    expect((cuerpo as { parameters: { payload: unknown } }).parameters.payload).toBe(hashDe(t));
    expect(opciones).toEqual({ requestId: ID });
    expect(informes()).toContain("[tinkazo] línea votada");
    expect(informes()).not.toContain("testigo");
  });

  it("con un pedido que se puede volver a pedir, se relee una vez y se vota la releída", async () => {
    const t = armarLaLinea();
    const pedido = pedidoDeLaLinea(t, { refreshable: true });
    let releido: Pedido | null = null;
    h.impl.refresh = async () => {
      releido = structuredClone(pedido);
      return releido;
    };
    laLineaDevuelve(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: hashDe(t) } });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(h.argumentos.refresh).toEqual([[ID]]);
    expect(h.argumentos.verify?.[0]?.[0]).toBe(releido);
  });

  it("con otra forma no se vota: no-coincide sin relay, se rechaza el pedido de la llamada y la consola dice el motivo", async () => {
    dejarRechazar();
    laLineaDevuelve(pedidoDeLaLinea(armarLaLinea({ limite: "0" })));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
    expect(avisos()).toContain("[tinkazo] línea no votada: límite");
    expect(avisos()).not.toMatch(/[GCM][A-Z2-7]{55}/);
  });

  it("un pedido que la regla no votó no deja la ventana en Se está activando, aunque el rechazo falle", async () => {
    rechazoEsperado = true;
    h.impl.reject = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR");
    };
    const pedido = pedidoDeLaLinea(armarLaLinea({ limite: "0" }));
    laLineaDevuelve(pedido);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(avisos()).toContain("[tinkazo] co-firma no rechazada");
    // Sigue esperando y alguien lo votó desde otro lado: igual no cuenta, porque esta pestaña no lo votó.
    h.cofirma = { pending: [] };
    enLaLista({ ...pedido, activityId: "actividad-de-otro-lado" });
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(false);
  });

  it("otro pedido de la línea con un voto en curso sí deja la ventana en Se está activando", async () => {
    enLaLista(pedidoDeLaLinea(armarLaLinea(), { id: "otra-linea", activityId: "actividad-1" }));
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(true);
  });

  it("con el tope de la pestaña alcanzado da no-coincide-tope sin llamar a setTrustline", async () => {
    dejarRechazar();
    laLineaDevuelve(pedidoDeLaLinea(armarLaLinea({ limite: "0" })));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide-tope");
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide-tope");
    expect(veces("setTrustline")).toBe(2);
    expect(veces("pending")).toBe(2);
  });

  it("las negativas de la línea no cuentan para el tope del sello", async () => {
    dejarRechazar();
    laLineaDevuelve(pedidoDeLaLinea(armarLaLinea({ limite: "0" })));
    await pollarWallet.activarUsdc();
    await pollarWallet.activarUsdc();
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintasLinea)).toBe("2");
    expect(sessionStorage.getItem(MARCAS_DE_LA_CUENTA.distintas)).toBeNull();
  });

  it("un servicio sin créditos al votar, con el pedido pendiente sin actividad: se rechaza y dice ahora no", async () => {
    dejarRechazar();
    const pedido = pedidoDeLaLinea(armarLaLinea());
    laLineaDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_CREDITS_INSUFFICIENT");
    };
    h.impl.get = async () => structuredClone(pedido);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("ahora-no");
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("un relay que se corta con el pedido todavía pendiente sigue en curso, sin otro relay ni rechazo", async () => {
    const pedido = pedidoDeLaLinea(armarLaLinea());
    laLineaDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("Request timed out after 60000ms");
    };
    h.impl.get = async () => ({ ...pedido, activityId: "actividad-1" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    expect(veces("relay")).toBe(1);
  });

  it("el pedido de la llamada que ya trae una actividad: no se vota, se rechaza y sigue en curso", async () => {
    dejarRechazar();
    laLineaDevuelve(pedidoDeLaLinea(armarLaLinea(), { activityId: "actividad-de-otro" }));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    expect(veces("relay")).toBe(0);
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("lo que el kit devuelve sin pedido no pasó por la regla: sigue en curso", async () => {
    h.impl.setTrustline = async () => ({ status: "success" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    expect(avisos()).toContain("[tinkazo] co-firma incierta: sin pedido");
  });

  it("un error del kit al pedir la línea sale como siempre", async () => {
    h.impl.setTrustline = async () => ({ status: "error", code: "SDK_WALLET_NOT_READY" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("cuenta-creandose");
    expect(veces("relay")).toBe(0);
  });

  it("la negativa de la regla da no-coincide y el tope no-coincide-tope, antes que los códigos del kit", () => {
    expect(resultadoDeLaLinea({ status: "error", code: COFIRMA_DISTINTA })).toBe("no-coincide");
    expect(resultadoDeLaLinea({ status: "error", code: COFIRMA_TOPE })).toBe("no-coincide-tope");
    expect(resultadoDeLaLinea({ status: "error", code: COFIRMA_DISTINTA, details: "SDK_CREDITS_INSUFFICIENT" })).toBe("no-coincide");
  });

  it("las palabras de la negativa en el detalle que escribe el servidor no son la negativa", () => {
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_COSIGN_REJECTED", details: COFIRMA_DISTINTA })).toBe("no-salio");
    expect(resultadoDeLaLinea({ status: "error", code: "SDK_COSIGN_REJECTED", details: COFIRMA_TOPE })).toBe("no-salio");
  });

  it("después del voto, un cierre del servidor con las palabras de la negativa no dice que no se hizo nada", async () => {
    const t = armarLaLinea();
    const pedido = pedidoDeLaLinea(t);
    laLineaDevuelve(pedido);
    elVotoSale(pedido, { status: "REJECTED", failureReason: COFIRMA_DISTINTA });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(veces("relay")).toBe(1);
  });

  it("después del voto, un error del servidor con el código de la negativa no dice que no se hizo nada", async () => {
    dejarRechazar();
    const pedido = pedidoDeLaLinea(armarLaLinea());
    laLineaDevuelve(pedido);
    h.impl.relay = async () => {
      throw new kit.PollarApiError(COFIRMA_DISTINTA);
    };
    h.impl.get = async () => structuredClone(pedido);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(h.argumentos.reject).toEqual([[ID]]);
  });

  it("con límites de tiempo de verdad no se vota: la forma medida no los trae", async () => {
    dejarRechazar();
    laLineaDevuelve(pedidoDeLaLinea(armarLaLinea({ tiempo: TIEMPO })));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("relay")).toBe(0);
    expect(avisos()).toContain("[tinkazo] línea no votada: condiciones");
  });
});

describe("el pedido de la línea que abre solo el proveedor: el toque de la persona vota ese", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_RAMPA", "premios");
    // La mirada del modo premios: la cuenta todavía no tiene la línea del dólar digital.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        pedidosALaRed.push(String(url));
        const nativo = { asset_type: "native", balance: "0.0000000", selling_liabilities: "0.0000000", buying_liabilities: "0.0000000" };
        const cuenta = { id: P, sequence: "1", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0, balances: [nativo] };
        return new Response(JSON.stringify(cuenta), { status: 200 });
      }),
    );
  });

  /** El pedido del proveedor, que se puede volver a pedir, como se midió en la red principal. */
  const delProveedor = (t: Transaction, cambios: Partial<Pedido> = {}): Pedido =>
    pedidoDeLaLinea(t, { id: DEL_PROVEEDOR, refreshable: true, ...cambios });

  it("sin voto, no deja la ventana en Se está activando", async () => {
    enLaLista(delProveedor(armarLaLinea()));
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(false);
  });

  it("con el toque se vota ese pedido con la regla, releído, y no se pide otro", async () => {
    const t = armarLaLinea();
    const pedido = delProveedor(t);
    enLaLista(pedido);
    h.impl.refresh = async () => structuredClone(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: hashDe(t) } });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(veces("setTrustline")).toBe(0);
    expect(llamadasDelVoto()).toEqual(["pending", "recovery.status", "refresh", "verify", "relay"]);
    expect(h.argumentos.relay?.map(([, , o]) => o)).toEqual([{ requestId: DEL_PROVEEDOR }]);
    expect(informes()).toContain("[tinkazo] línea votada");
  });

  it("con otra forma no se vota ni se rechaza, y no se pide otro", async () => {
    const pedido = delProveedor(armarLaLinea({ limite: "0" }));
    enLaLista(pedido);
    h.impl.refresh = async () => structuredClone(pedido);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("relay")).toBe(0);
    expect(veces("setTrustline")).toBe(0);
    expect(avisos()).toContain("[tinkazo] línea no votada: límite");
  });

  it("releído con otra forma no se vota, aunque el de la lista la tenía", async () => {
    const pedido = delProveedor(armarLaLinea());
    enLaLista(pedido);
    h.impl.refresh = async () => delProveedor(armarLaLinea({ limite: "0" }));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("relay")).toBe(0);
    expect(veces("setTrustline")).toBe(0);
    expect(avisos()).toContain("[tinkazo] línea no votada: límite");
  });

  it("releído con otro id no se vota ni se rechaza", async () => {
    const pedido = delProveedor(armarLaLinea());
    enLaLista(pedido);
    h.impl.refresh = async () => delProveedor(armarLaLinea(), { id: "otro-pedido" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("relay")).toBe(0);
    expect(veces("verify")).toBe(0);
  });

  it("el toque siguiente no lo vuelve a mirar ni pide otro: ya no invita a probar de nuevo", async () => {
    const pedido = delProveedor(armarLaLinea({ limite: "0" }));
    enLaLista(pedido);
    h.impl.refresh = async () => structuredClone(pedido);
    await pollarWallet.activarUsdc();
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide-tope");
    expect(veces("refresh")).toBe(1);
    expect(veces("verify")).toBe(0);
    expect(veces("setTrustline")).toBe(0);
  });

  it("con un voto en curso sigue en Se está activando y el toque no hace nada", async () => {
    enLaLista(delProveedor(armarLaLinea(), { activityId: "actividad-1" }));
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(true);
    await expect(pollarWallet.activarUsdc()).resolves.toBe("en-curso");
    expect(veces("setTrustline")).toBe(0);
    expect(veces("relay")).toBe(0);
  });

  it("si la lista no se puede leer, no se pide nada", async () => {
    h.impl.pending = async () => {
      throw new kit.PollarNetworkError("Request timed out after 10000ms");
    };
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(veces("setTrustline")).toBe(0);
  });
});

describe("sin la variable del voto, la línea del proveedor tampoco traba la ventana", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    vi.stubEnv("VITE_RAMPA", "recibir");
  });

  it("sin pedidos de la línea esperando, se pide como siempre y el cliente nace como hoy", async () => {
    h.impl.setTrustline = async () => ({ status: "success" });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(llamadasDelVoto()).toEqual(["pending", "setTrustline"]);
    expect(h.config).not.toHaveProperty("cosignManual");
    expect(pollarWallet.votaPorContenido()).toBe(false);
  });

  it("un pedido del proveedor sin voto no deja la ventana en Se está activando", async () => {
    enLaLista(pedidoDeLaLinea(armarLaLinea(), { id: DEL_PROVEEDOR }));
    await expect(pollarWallet.pendienteDeActivacion()).resolves.toBe(false);
  });

  it("con la forma exacta, el toque lo vota con la regla, nunca por el camino del kit, y no pide otro", async () => {
    const t = armarLaLinea();
    const pedido = pedidoDeLaLinea(t, { id: DEL_PROVEEDOR });
    enLaLista(pedido);
    elVotoSale(pedido, { submit: { status: "SUCCESS", hash: hashDe(t) } });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("hecho");
    expect(veces("setTrustline")).toBe(0);
    expect(h.argumentos.relay?.map(([, , o]) => o)).toEqual([{ requestId: DEL_PROVEEDOR }]);
  });

  it("con otra forma no se vota y no se pide otra, así el kit no puede votarlo solo", async () => {
    enLaLista(pedidoDeLaLinea(armarLaLinea({ limite: "0" }), { id: DEL_PROVEEDOR }));
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-coincide");
    expect(veces("setTrustline")).toBe(0);
    expect(veces("relay")).toBe(0);
  });

  it("una lista de pedidos que no se lee no deja pedir otra: el kit podría votar solo la que espera", async () => {
    h.impl.pending = async () => ({ requests: [] });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
    expect(veces("setTrustline")).toBe(0);
  });

  it("un error del kit con el código de la negativa sale como antes, sin decir que no se hizo nada", async () => {
    h.impl.setTrustline = async () => ({ status: "error", code: COFIRMA_DISTINTA });
    await expect(pollarWallet.activarUsdc()).resolves.toBe("no-salio");
  });
});

describe("las fuentes: quién vota, quién rechaza y qué no se llama nunca", () => {
  const fuente = readFileSync(resolve(process.cwd(), "src/stellar/wallet-pollar.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  /** El método de la clase donde cae una posición del archivo: el último que empieza antes. */
  const metodoEn = (i: number): string => {
    const metodos = [...fuente.matchAll(/^ {2}(?:async )?(#?[A-Za-z]+)(?:<[^>]*>)?\(/gm)].filter((m) => (m.index ?? 0) < i);
    return metodos.at(-1)?.[1] ?? "";
  };
  const donde = (llamada: string): string[] => {
    const patron = new RegExp(llamada.replace(/[.(]/g, "\\$&"), "g");
    return [...fuente.matchAll(patron)].map((m) => metodoEn(m.index ?? 0));
  };
  const PROHIBIDAS = ["cosign.approve(", "cosign.cancel(", "approveDevice(", "switchCustody(", "exportWallet(", "migrateWallet(", "migrateWallets("];

  it("no llama a approve ni a cancel de la co-firma, ni a los caminos del kit que estampan sin una transacción", () => {
    for (const nombre of PROHIBIDAS) expect(fuente.includes(nombre), nombre).toBe(false);
  });

  it("rechaza solo desde #rechazarElNuestro", () => {
    expect(donde("cosign.reject(")).toEqual(["#rechazarElNuestro"]);
  });

  it("estampa solo desde #votar, #activar y #estampar", () => {
    expect([...new Set(donde("cosign.relay("))].sort()).toEqual(["#activar", "#estampar", "#votar"]);
  });
});
