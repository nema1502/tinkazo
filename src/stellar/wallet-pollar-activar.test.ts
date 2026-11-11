import { Account, Asset, Keypair, Networks, Operation, type Transaction, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import type { CosignRequest } from "@pollar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";
import { errorKey } from "./errores";

/**
 * `activarCuenta`: el orden de las llamadas al kit de Pollar, con el cliente simulado (`pollar-falso.ts`) y la regla de
 * verdad (`motivoContraLaActivacion`, `recognizedSetupRequest` y `verify` del kit real). Sección 5 del diseño de «Dejá
 * tu cuenta lista»: se lee el pedido, se lo pide de nuevo una sola vez, se revisa esa versión, y lo que se estampa con
 * `relay` es la propuesta que `verify` armó sobre ese mismo objeto. Nunca `approve`, `reject` ni `cancel`.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return {
    ...real,
    PollarClient: clienteFalso(h),
    recognizedSetupRequest: (r: CosignRequest) => (h.impl.recognizedSetupRequest ? h.impl.recognizedSetupRequest(r) : real.recognizedSetupRequest(r)),
  };
});

const { pollarWallet, MARCAS_DE_LA_CUENTA } = await import("./wallet-pollar");
const kit = await vi.importActual<typeof import("@pollar/core")>("@pollar/core");
const kitReal = new kit.CosignManager({
  api: {} as never,
  keyManager: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  networkPassphrase: () => Networks.PUBLIC,
  onRequest: () => undefined,
});

const patrocinador = Keypair.random();
const persona = Keypair.random();
const P = persona.publicKey();
const OTRA = Keypair.random().publicKey();
const SUB = "sub-org-de-ana";

function armar(ops: readonly xdr.Operation[]): Transaction {
  const b = new TransactionBuilder(new Account(patrocinador.publicKey(), "1"), { fee: "300", networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(300).build();
  tx.sign(patrocinador);
  return tx;
}
const buena = (): Transaction =>
  armar([
    Operation.beginSponsoringFutureReserves({ sponsoredId: P }),
    Operation.createAccount({ destination: P, startingBalance: "0" }),
    Operation.endSponsoringFutureReserves({ source: P }),
  ]);

type Pedido = Record<string, unknown> & { id: string };
function pedidoDe(tx: Transaction, cambios: Partial<Pedido> = {}): Pedido {
  return {
    id: "pedido-1",
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "account_create",
    operation: "create_account",
    account: P,
    signWith: P,
    appPaysFee: true,
    refreshable: true,
    unsignedPayload: tx.toXDR(),
    payloadHash: Buffer.from(tx.hash()).toString("hex"),
    activityId: null,
    subOrgId: SUB,
    createdAt: "2026-11-10T23:30:00.000Z",
    expiresAt: "2026-11-11T23:30:00.000Z",
    ...cambios,
  };
}
const aprobado = (p: Pedido, extra: Partial<Pedido> = {}): Pedido => ({ ...p, status: "APPROVED", activityId: "actividad-1", submit: { hash: "abc", status: "SUCCESS" }, ...extra });

let pedido: Pedido;
/** Lo que devolvió el último `refresh`: lo que se verifica y se estampa tiene que ser este mismo objeto. */
let refrescado: Pedido | null;

const votos = (): string | null => sessionStorage.getItem(MARCAS_DE_LA_CUENTA.votos);
const llamadasDeCofirma = (): string[] => h.llamadas.filter((n) => !["ready", "getCosignState", "logout"].includes(n));
async function falla(p: Promise<unknown>): Promise<Error> {
  const r = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(r).toBeInstanceOf(Error);
  return r as Error;
}

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  h.billetera = { address: P, provisioning: "CREATING", existsOnStellar: false };
  pollarWallet.address = P;
  pedido = pedidoDe(buena());
  refrescado = null;
  h.impl.pending = async () => [structuredClone(pedido)];
  h.impl.refresh = async (id: string) => {
    refrescado = { ...structuredClone(pedido), id };
    return refrescado;
  };
  h.impl["recovery.status"] = async () => ({ required: true, configured: false, subOrgId: SUB, email: { address: null, verified: false }, passkeys: [], devices: [] });
  h.impl.verify = (r: CosignRequest) => kitReal.verify(r);
  h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido) });
  h.impl.get = async (id: string) => aprobado({ ...pedido, id });
});

afterEach(async () => {
  // Nunca se vota con approve (vuelve a pedir la transacción por dentro), ni se rechaza o se cancela (es definitivo).
  expect(h.llamadas).not.toContain("approve");
  expect(h.llamadas).not.toContain("reject");
  expect(h.llamadas).not.toContain("cancel");
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("activarCuenta con el pedido de la prueba en vivo", () => {
  it("lee, pide de nuevo una vez, verifica ese mismo objeto y estampa la propuesta de verify", async () => {
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(llamadasDeCofirma()).toEqual(["refreshWalletState", "pending", "recovery.status", "refresh", "verify", "relay"]);
    expect(h.argumentos.refresh).toEqual([["pedido-1"]]);
    expect(h.argumentos.verify?.[0]?.[0]).toBe(refrescado);
    const verificacion = await kitReal.verify(refrescado as unknown as CosignRequest);
    if (!verificacion.ok) throw new Error(verificacion.reason);
    const [ruta, cuerpo, opciones] = h.argumentos.relay?.[0] ?? [];
    expect(ruta).toBe("/public/v1/submit/sign_raw_payload");
    expect((cuerpo as { parameters: unknown }).parameters).toEqual(verificacion.proposal.body.parameters);
    expect((cuerpo as { organizationId: unknown }).organizationId).toBe(SUB);
    expect(opciones).toEqual({ requestId: "pedido-1" });
    expect(votos()).toBeNull();
  });

  it("sin pedido pendiente no hay nada que activar", async () => {
    h.impl.pending = async () => [];
    await expect(pollarWallet.activarCuenta()).resolves.toBe("no-hay");
    expect(h.llamadas).not.toContain("refresh");
    expect(h.llamadas).not.toContain("relay");
  });

  it("un pedido que no se puede pedir de nuevo se revisa tal cual, sin refresh", async () => {
    pedido = { ...pedido, refreshable: false };
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.llamadas).not.toContain("refresh");
    expect(h.llamadas).toContain("relay");
  });

  it("con dos pedidos, el más nuevo", async () => {
    const viejo = { ...pedido, id: "viejo", createdAt: "2026-11-09T10:00:00.000Z" };
    const nuevo = { ...pedido, id: "nuevo", createdAt: "2026-11-10T23:30:00.000Z" };
    h.impl.pending = async () => [structuredClone(viejo), structuredClone(nuevo)];
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.argumentos.refresh).toEqual([["nuevo"]]);
  });

  it("un pedido pendiente de otra cosa (una línea de confianza) no se toca", async () => {
    h.impl.pending = async () => [{ ...pedido, intent: "sign", operation: "change_trust" }];
    await expect(pollarWallet.activarCuenta()).resolves.toBe("no-hay");
    expect(h.llamadas).not.toContain("refresh");
  });

  it("un pedido de crear otra cuenta no se toca", async () => {
    h.impl.pending = async () => [{ ...pedido, account: OTRA, signWith: OTRA }];
    await expect(pollarWallet.activarCuenta()).resolves.toBe("no-hay");
    expect(h.llamadas).not.toContain("refresh");
  });

  it("un pedido sin cuenta da «no-hay» y lo dice en la consola con su propio motivo", async () => {
    const sinCuenta = { ...pedido };
    delete (sinCuenta as Partial<Pedido>).account;
    h.impl.pending = async () => [sinCuenta];
    await expect(pollarWallet.activarCuenta()).resolves.toBe("no-hay");
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).toMatch(/pedido sin cuenta/);
  });

  it("con la cuenta que ya existe no se vota, aunque haya un pedido colgado", async () => {
    h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.llamadas).not.toContain("pending");
    expect(h.llamadas).not.toContain("refresh");
    expect(h.llamadas).not.toContain("relay");
  });

  it("dos toques a la vez votan una sola vez", async () => {
    const [a, b] = await Promise.all([pollarWallet.activarCuenta(), pollarWallet.activarCuenta()]);
    expect([a, b]).toEqual(["activada", "activada"]);
    expect(h.llamadas.filter((n) => n === "relay")).toHaveLength(1);
  });
});

describe("lo que no se aprueba no llega a relay", () => {
  const casos: Array<[string, () => void]> = [
    [
      "la regla: una operación de más",
      () => {
        pedido = pedidoDe(
          armar([
            Operation.beginSponsoringFutureReserves({ sponsoredId: P }),
            Operation.createAccount({ destination: P, startingBalance: "0" }),
            Operation.changeTrust({ asset: new Asset("USDC", OTRA), source: P }),
            Operation.endSponsoringFutureReserves({ source: P }),
          ]),
        );
      },
    ],
    ["el lector del kit no lo reconoce", () => (h.impl.recognizedSetupRequest = () => ({ ok: false, reason: "no" }))],
    ["verify no da", () => (h.impl.verify = async () => ({ ok: false, reason: "the transaction does not hash to what Pollar asks to sign" }))],
    [
      "verify da otro hash",
      () =>
        (h.impl.verify = async (r: CosignRequest) => {
          const v = await kitReal.verify(r);
          return v.ok ? { ...v, localHash: "ab".repeat(32) } : v;
        }),
    ],
    ...(
      [
        ["otro payload", (b: Record<string, unknown> & { parameters: Record<string, unknown> }) => (b.parameters.payload = "ef".repeat(32))],
        ["otra cuenta que firma", (b: Record<string, unknown> & { parameters: Record<string, unknown> }) => (b.parameters.signWith = OTRA)],
        ["otra organización", (b: Record<string, unknown> & { parameters: Record<string, unknown> }) => (b.organizationId = "otra-sub-org")],
      ] as const
    ).map(
      ([que, f]) =>
        [
          `la propuesta trae ${que}`,
          () =>
            (h.impl.verify = async (r: CosignRequest) => {
              const v = await kitReal.verify(r);
              if (!v.ok) return v;
              const proposal = structuredClone(v.proposal) as unknown as { body: Record<string, unknown> & { parameters: Record<string, unknown> } };
              f(proposal.body);
              return { ...v, proposal };
            }),
        ] as [string, () => void],
    ),
    [
      "la propuesta trae otra ruta",
      () =>
        (h.impl.verify = async (r: CosignRequest) => {
          const v = await kitReal.verify(r);
          return v.ok ? { ...v, proposal: { ...v.proposal, path: "/public/v1/submit/sign_transaction" } } : v;
        }),
    ],
    [
      "refresh devuelve otro pedido",
      () =>
        (h.impl.refresh = async () => {
          refrescado = { ...structuredClone(pedido), id: "otro-pedido" };
          return refrescado;
        }),
    ],
    ["la organización de esta sesión es otra", () => (h.impl["recovery.status"] = async () => ({ required: true, configured: false, subOrgId: "otra-sub-org", email: { address: null, verified: false }, passkeys: [], devices: [] }))],
  ];

  it.each(casos)("%s: pollar-activacion-rara, sin relay", async (_que, preparar) => {
    preparar();
    const e = await falla(pollarWallet.activarCuenta());
    expect(e.message).toBe("pollar-activacion-rara");
    expect(h.llamadas).not.toContain("relay");
    // El motivo va a la consola, sin direcciones ni la transacción.
    const consola = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(consola).toMatch(/\[tinkazo\] activación no aprobada: /);
    expect(consola).not.toContain(P);
    expect(consola).not.toContain(String(pedido.unsignedPayload));
    expect(votos()).toBeNull();
  });

  it("la dirección de la sesión no es la del kit: pollar-sin-cuenta, sin llamar a nada", async () => {
    pollarWallet.address = OTRA;
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-sin-cuenta");
    expect(llamadasDeCofirma()).toEqual([]);
  });

  it("el cliente dice que está en la red de prueba: pollar-sin-cuenta, sin llamar a nada", async () => {
    h.redDelCliente = "testnet";
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-sin-cuenta");
    expect(llamadasDeCofirma()).toEqual([]);
  });

  it("la cuenta cambia entre verify y relay: no se estampa", async () => {
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      h.billetera = { address: OTRA, provisioning: "CREATING" };
      return v;
    };
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-sin-cuenta");
    expect(h.llamadas).not.toContain("relay");
  });
});

describe("cómo termina", () => {
  it("refresh dice APPROVED sin el envío terminado y la cuenta sin crear: pendiente, sin votar", async () => {
    h.impl.refresh = async (id: string) => ({ ...pedido, id, status: "APPROVED" });
    await expect(pollarWallet.activarCuenta()).resolves.toBe("pendiente");
    expect(h.llamadas).not.toContain("relay");
  });

  it("refresh dice APPROVED y la cuenta ya quedó lista: activada", async () => {
    h.impl.refresh = async (id: string) => ({ ...pedido, id, status: "APPROVED" });
    h.impl.refreshWalletState = async () => {
      if (h.llamadas.filter((n) => n === "refreshWalletState").length > 1) h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
      return h.billetera?.provisioning ?? null;
    };
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
  });

  it("refresh dice que ya falló: pollar-activacion-fallo, sin votar ni contar", async () => {
    h.impl.refresh = async (id: string) => ({ ...pedido, id, status: "EXPIRED" });
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-activacion-fallo");
    expect(h.llamadas).not.toContain("relay");
    expect(votos()).toBeNull();
  });

  it("un pedido ya votado (con activityId) se lee y se espera, sin votar otra vez", async () => {
    h.impl.refresh = async (id: string) => ({ ...pedido, id, activityId: "actividad-0" });
    h.impl.get = async (id: string) => ({ ...pedido, id, activityId: "actividad-0" });
    h.impl.settle = async (r: Pedido) => aprobado(r);
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.llamadas).toContain("get");
    expect(h.argumentos.get?.[0]).toEqual(["pedido-1", { sync: true }]);
    expect(h.llamadas).toContain("settle");
    expect(h.llamadas).not.toContain("relay");
  });

  it("relay dice que ya no estaba pendiente: se lee con get", async () => {
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_REQUEST_NOT_PENDING", { status: "APPROVED" });
    };
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
    expect(h.argumentos.get?.[0]).toEqual(["pedido-1", { sync: true }]);
    expect(votos()).toBeNull();
  });

  it("después del voto sigue pendiente: settle, y si sigue, pendiente", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...refrescado, activityId: "actividad-1" } });
    h.impl.settle = async (r: Pedido) => r;
    await expect(pollarWallet.activarCuenta()).resolves.toBe("pendiente");
    expect(h.llamadas).toContain("settle");
  });

  it("después del voto, settle lo termina: activada", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...refrescado, activityId: "actividad-1" } });
    h.impl.settle = async (r: Pedido) => aprobado(r);
    await expect(pollarWallet.activarCuenta()).resolves.toBe("activada");
  });

  it.each(["FAILED", "REJECTED", "EXPIRED"])("el voto termina %s: pollar-activacion-fallo y el contador sube", async (estado) => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...refrescado, status: estado, activityId: "actividad-1" } });
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-activacion-fallo");
    expect(votos()).toBe("1");
  });

  it("el envío del voto falla: pollar-activacion-fallo y el contador sube", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(refrescado ?? pedido, { submit: { hash: "abc", status: "FAILED" } }) });
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-activacion-fallo");
    expect(votos()).toBe("1");
  });

  it("con dos votos fallados en esta pestaña: pollar-activacion-tope, sin tocar la co-firma", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...refrescado, status: "FAILED", activityId: "actividad-1" } });
    await falla(pollarWallet.activarCuenta());
    await falla(pollarWallet.activarCuenta());
    expect(votos()).toBe("2");
    h.llamadas = [];
    expect((await falla(pollarWallet.activarCuenta())).message).toBe("pollar-activacion-tope");
    expect(h.llamadas.filter((n) => n !== "refreshWalletState")).toEqual([]);
  });
});

describe("los errores del kit no salen con su cuerpo", () => {
  it("un error del kit con el pedido adentro se vuelve nuestro código, sin la transacción ni la dirección", async () => {
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_COSIGN_UPSTREAM_ERROR", { request: pedido, details: `no se pudo votar por ${P}` });
    };
    const e = await falla(pollarWallet.activarCuenta());
    expect(e.message).toBe("pollar-activacion-fallo");
    const todo = JSON.stringify({ m: e.message, c: (e as { cause?: unknown }).cause ?? null, b: (e as { body?: unknown }).body ?? null });
    expect(todo).not.toContain(String(pedido.unsignedPayload));
    expect(todo).not.toContain(P);
    // No se sabe si el voto salió: cuenta como uno fallado.
    expect(votos()).toBe("1");
  });

  it("un corte de red al votar sale con un código de red y cuenta como voto fallado", async () => {
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("Request timed out");
    };
    const e = await falla(pollarWallet.activarCuenta());
    expect(e.message).toBe("SDK_NETWORK_TIMEOUT");
    expect(["rpcDown", "offline"]).toContain(errorKey(e));
    expect(votos()).toBe("1");
  });

  it("sin créditos al leer los pedidos: el código de créditos, sin contar un voto", async () => {
    h.impl.pending = async () => {
      throw new kit.PollarApiError("SDK_CREDITS_INSUFFICIENT", { request: pedido });
    };
    const e = await falla(pollarWallet.activarCuenta());
    expect(e.message).toBe("SDK_CREDITS_INSUFFICIENT");
    expect(errorKey(e)).toBe("sponsorEmpty");
    expect(votos()).toBeNull();
  });
});
