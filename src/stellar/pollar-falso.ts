/**
 * Un cliente de Pollar de mentira para las pruebas de la cuenta en modo Oficial (`wallet-pollar-activar.test.ts`,
 * `wallet-pollar-estado.test.ts`, `wallet-pollar-aparato.test.ts`, `wallet-pollar-testigo.test.ts`). Imita lo que esas
 * pruebas necesitan de `PollarClient` de `@pollar/core` 0.12.0: la billetera, la red del cliente, la sesión, las
 * suscripciones y `cosign` con su `recovery`. Cada método anota su nombre en `llamadas` (y sus argumentos en
 * `argumentos`), y hace lo que diga `impl[nombre]` o, si no hay, lo de abajo. `approve`, `reject` y `cancel` fallan
 * siempre: la activación nunca los usa. Solo lo usan las pruebas; nada de la página lo importa. No importa
 * `@pollar/core` ni la billetera: se carga dentro de `vi.hoisted`, antes de los `vi.mock`.
 */

type Impl = (...args: any[]) => unknown;

export interface BilleteraFalsa {
  address: string;
  provisioning?: "READY" | "CREATING" | "FAILED" | "NONE";
  existsOnStellar?: boolean;
}

export interface EstadoPollarFalso {
  /** Lo que la billetera lee de `./config` (la prueba lo pone en el `vi.mock`): se cambia la red en cada caso. */
  red: { name: "mainnet" | "testnet"; networkPassphrase: string; contractId: string | null; rpcUrl: string; explorerBase: string; friendbotUrl: string | null; maxWinners: number };
  construidos: number;
  config: Record<string, unknown> | null;
  billetera: BilleteraFalsa | null;
  redDelCliente: "mainnet" | "testnet";
  paso: string;
  llamadas: string[];
  argumentos: Record<string, unknown[][]>;
  impl: Record<string, Impl | undefined>;
  oyentes: {
    billetera: Set<(p: string) => void>;
    cofirma: Set<(s: unknown) => void>;
    transaccion: Set<(s: unknown) => void>;
  };
  /** Lo que devuelve `getCosignState()`. */
  cofirma: { pending: unknown[]; lastResolved?: unknown };
  /** El último estado de la máquina de transacciones: se repite al suscribirse, como en el kit. */
  transaccion: unknown;
}

export const PASSPHRASE_MAINNET = "Public Global Stellar Network ; September 2015";
export const PASSPHRASE_TESTNET = "Test SDF Network ; September 2015";

export function estadoPollarFalso(): EstadoPollarFalso {
  return {
    red: { name: "mainnet", networkPassphrase: PASSPHRASE_MAINNET, contractId: null, rpcUrl: "https://rpc.invalid", explorerBase: "https://explorador.invalid", friendbotUrl: null, maxWinners: 100 },
    construidos: 0,
    config: null,
    billetera: null,
    redDelCliente: "mainnet",
    paso: "authenticated",
    llamadas: [],
    argumentos: {},
    impl: {},
    oyentes: { billetera: new Set(), cofirma: new Set(), transaccion: new Set() },
    cofirma: { pending: [] },
    transaccion: null,
  };
}

/** Vuelve todo a cero entre pruebas, sin cambiar el objeto (los `vi.mock` lo tienen agarrado). */
export function reiniciar(h: EstadoPollarFalso): void {
  const nuevo = estadoPollarFalso();
  h.red.name = nuevo.red.name;
  h.red.networkPassphrase = nuevo.red.networkPassphrase;
  h.construidos = 0;
  h.config = null;
  h.billetera = null;
  h.redDelCliente = "mainnet";
  h.paso = "authenticated";
  h.llamadas = [];
  h.argumentos = {};
  h.impl = {};
  h.oyentes.billetera.clear();
  h.oyentes.cofirma.clear();
  h.oyentes.transaccion.clear();
  h.cofirma = { pending: [] };
  h.transaccion = null;
}

/** Cambia el estado de la máquina de transacciones y avisa, como `_setTransactionState` del kit. */
export function emitirTransaccion(h: EstadoPollarFalso, estado: unknown): void {
  h.transaccion = estado;
  for (const cb of h.oyentes.transaccion) cb(estado);
}

/**
 * Lo que hace el kit con cada pedido que lee (`_noteCosignRequest`): lo guarda en el estado de la co-firma y avisa a
 * todos los oyentes, aunque nada haya cambiado. Así las pruebas ven el mismo eco que el kit de verdad.
 */
export function anotarPedido(h: EstadoPollarFalso, r: unknown): void {
  const p = r as { id?: unknown; status?: unknown } | null;
  if (!p || typeof p !== "object" || typeof p.id !== "string") return;
  const pending = (h.cofirma.pending as Array<{ id?: unknown }>).filter((x) => x?.id !== p.id);
  if (p.status === "PENDING") pending.push(p);
  const lastResolved = p.status !== "PENDING" ? p : h.cofirma.lastResolved;
  h.cofirma = { pending, ...(lastResolved ? { lastResolved } : {}) };
  const foto = { ...h.cofirma, pending: [...h.cofirma.pending] };
  for (const cb of [...h.oyentes.cofirma]) cb(foto);
}

const nuncaSeLlama = (nombre: string) => (): never => {
  throw new Error(`la prueba no admite ${nombre}`);
};

export function clienteFalso(h: EstadoPollarFalso): new (config: Record<string, unknown>) => unknown {
  const llamar = (nombre: string, porDefecto: Impl, args: unknown[]): unknown => {
    h.llamadas.push(nombre);
    (h.argumentos[nombre] ??= []).push(args);
    const f = h.impl[nombre];
    return f ? f(...args) : porDefecto(...args);
  };
  const asincrono =
    (nombre: string, porDefecto: Impl) =>
    async (...args: unknown[]): Promise<unknown> =>
      llamar(nombre, porDefecto, args);
  /** Como `asincrono`, y además pasa lo leído por `anotarPedido`, como el kit con `pending`, `get` y `refresh`. */
  const leePedidos =
    (nombre: string, porDefecto: Impl) =>
    async (...args: unknown[]): Promise<unknown> => {
      const r = await llamar(nombre, porDefecto, args);
      for (const p of Array.isArray(r) ? r : [r]) anotarPedido(h, p);
      return r;
    };

  return class ClienteDePollarFalso {
    apiKeyHash = "huella";
    constructor(config: Record<string, unknown>) {
      h.construidos++;
      h.config = config;
    }
    getWallet(): BilleteraFalsa | null {
      return h.billetera ? { ...h.billetera } : null;
    }
    getNetwork(): string {
      return h.redDelCliente;
    }
    getAuthState(): { step: string } {
      return { step: h.paso };
    }
    ready = asincrono("ready", () => undefined);
    refreshWalletState = asincrono("refreshWalletState", () => h.billetera?.provisioning ?? null);
    onConfirmationRequest(): () => void {
      return () => undefined;
    }
    onAuthStateChange(): () => void {
      return () => undefined;
    }
    onWalletStateChange(cb: (p: string) => void): () => void {
      h.oyentes.billetera.add(cb);
      if (h.billetera?.provisioning) cb(h.billetera.provisioning);
      return () => h.oyentes.billetera.delete(cb);
    }
    onCosignStateChange(cb: (s: unknown) => void): () => void {
      h.oyentes.cofirma.add(cb);
      cb(h.cofirma);
      return () => h.oyentes.cofirma.delete(cb);
    }
    onTransactionStateChange(cb: (s: unknown) => void): () => void {
      h.oyentes.transaccion.add(cb);
      if (h.transaccion) cb(h.transaccion);
      return () => h.oyentes.transaccion.delete(cb);
    }
    getCosignState(): unknown {
      return llamar("getCosignState", () => h.cofirma, []);
    }
    getUserProfile(): unknown {
      return null;
    }
    logout = asincrono("logout", () => undefined);
    signAndSubmitTx = asincrono("signAndSubmitTx", () => ({ status: "success", hash: "deadbeef" }));
    signTx = asincrono("signTx", () => ({ status: "signed", signedXdr: "FIRMADA" }));
    cosign = {
      pending: leePedidos("pending", () => []),
      get: leePedidos("get", () => {
        throw new Error("SDK_COSIGN_REQUEST_NOT_FOUND");
      }),
      refresh: leePedidos("refresh", () => {
        throw new Error("SDK_COSIGN_REQUEST_NOT_FOUND");
      }),
      verify: asincrono("verify", () => ({ ok: false, reason: "sin verify en la prueba" })),
      relay: asincrono("relay", () => {
        throw new Error("SDK_COSIGN_UPSTREAM_ERROR");
      }),
      settle: asincrono("settle", (r: unknown) => r),
      approve: asincrono("approve", nuncaSeLlama("approve")),
      reject: asincrono("reject", nuncaSeLlama("reject")),
      cancel: asincrono("cancel", nuncaSeLlama("cancel")),
      publicKeyHex: asincrono("publicKeyHex", () => "02llave-de-este-navegador"),
      devices: asincrono("devices", () => ({ devices: [] })),
      revokeDevice: asincrono("revokeDevice", () => ({ devices: [] })),
      recovery: {
        status: asincrono("recovery.status", () => ({ required: true, configured: false, subOrgId: null, email: { address: null, verified: false }, passkeys: [], devices: [] })),
        addPasskey: asincrono("recovery.addPasskey", () => ({ required: true, configured: true })),
        startEmail: asincrono("recovery.startEmail", () => undefined),
        confirmEmail: asincrono("recovery.confirmEmail", () => ({ required: true, configured: true })),
        startEmailRecovery: asincrono("recovery.startEmailRecovery", () => undefined),
        recoverWithEmailCode: asincrono("recovery.recoverWithEmailCode", () => ({ required: true, configured: true, devices: [] })),
        recoverWithPasskey: asincrono("recovery.recoverWithPasskey", () => ({ required: true, configured: true, devices: [] })),
      },
    };
  };
}

/** Un `Storage` en memoria, para `sessionStorage` y `localStorage` en las pruebas sin navegador. */
export function almacenEnMemoria(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  };
}
