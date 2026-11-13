import type { CosignRequest } from "@pollar/core";
import { Networks } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";
import { USDC_MAINNET } from "./pagos";
import type { LoQueFalta, PasoDeVerificacion, PrecioDeCarga } from "./rampa-pollar";
import { LISTA_CERRADA } from "./rampa-regla";

/**
 * Los métodos de la carga con bolivianos en la billetera de Google o de correo (`carga*` de `PollarWallet`), con el
 * cliente de Pollar simulado (`pollar-falso.ts`), la regla de verdad (`rampa-regla.ts`) y el `verify` del kit real. Nunca
 * se llama al proveedor ni a ninguna red.
 *
 * Lo que se fija: con la bandera apagada no se llama a nada; dos toques de Aprobar votan una vez; dos pestañas no crean
 * dos órdenes; dos aprobaciones falladas cortan; un `402` no cuenta como falla; y nunca se vota al abrir ni al volver.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const billetera = await import("./wallet-pollar");
const { pollarWallet, CANDADO_DE_LA_CARGA, MARCA_DE_APROBACIONES, TOPE_DE_APROBACIONES_FALLADAS, YA_PAGUE_CADA_MS, cargaPrendida, estadoDeVerificacion } = billetera;
const kit = await vi.importActual<typeof import("@pollar/core")>("@pollar/core");
const kitReal = new kit.CosignManager({
  api: {} as never,
  keyManager: {} as never,
  logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
  networkPassphrase: () => Networks.PUBLIC,
  onRequest: () => undefined,
});

/* ------------------------------------------------------------------ lo que se arma para probar */

const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTRA_CUENTA = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SUB = "sub-org-de-ana";
const PASO_DE_ANA = "0x1111111111111111111111111111111111111111";
const DE_OTRO = "0x2222222222222222222222222222222222222222";
const ORDEN = "ord_9f8e7d6c5b4a3210";
const PEDIDO = "cos-1";

type Rlp = Uint8Array | Rlp[];
const hexDe = (b: Uint8Array) => Buffer.from(b).toString("hex");
const deHex = (x: string) => Uint8Array.from(Buffer.from(x.replace(/^0x/i, ""), "hex"));
function prefijo(base: number, n: number): number[] {
  if (n <= 55) return [base + n];
  const l: number[] = [];
  for (let x = n; x > 0; x = Math.floor(x / 256)) l.unshift(x % 256);
  return [base + 55 + l.length, ...l];
}
function rlp(x: Rlp): Uint8Array {
  if (x instanceof Uint8Array) return x.length === 1 && (x[0] as number) < 0x80 ? x : Uint8Array.from([...prefijo(0x80, x.length), ...x]);
  const cuerpo = x.flatMap((e) => [...rlp(e)]);
  return Uint8Array.from([...prefijo(0xc0, cuerpo.length), ...cuerpo]);
}
const numero = (n: bigint) => (n === 0n ? new Uint8Array() : deHex(n.toString(16).padStart(Math.ceil(n.toString(16).length / 2) * 2, "0")));
/** Una transacción EIP-1559 sin firmar, como la que trae un pedido de Polygon. */
const transaccion = (to: string, data: string) => `0x02${hexDe(rlp([numero(137n), numero(7n), numero(30_000_000_000n), numero(60_000_000_000n), numero(150_000n), deHex(to), numero(0n), deHex(data), []]))}`;
const palabra = (n: bigint) => n.toString(16).padStart(64, "0");
const palabraDe = (dir: string) => dir.toLowerCase().replace(/^0x/, "").padStart(64, "0");
/** El permiso del canje: USDT0 deja usar al enrutador lo que trae el tramo. */
const permiso = (quien: string, monto: bigint) => `0x095ea7b3${palabraDe(quien)}${palabra(monto)}`;

type Pedido = Record<string, unknown> & { id: string; status: string };
function pedidoDePermiso(quien: string = LISTA_CERRADA.enrutadorUniswap, cambios: Partial<Pedido> = {}): Pedido {
  const to = LISTA_CERRADA.usdt0Polygon;
  const data = permiso(quien, 24_900_000n);
  return {
    id: PEDIDO,
    kind: "TX",
    network: "POLYGON",
    status: "PENDING",
    subOrgId: SUB,
    activityId: null,
    fingerprint: null,
    signWith: PASO_DE_ANA,
    unsignedPayload: transaccion(to, data),
    payloadHash: "00",
    refreshable: true,
    intent: "sign_and_send",
    operation: "evm_call",
    details: { to: to.toLowerCase(), data: data.toLowerCase(), value: "0" },
    expiresAt: "2099-11-17T15:00:00.000Z",
    createdAt: "2026-11-16T15:00:00.000Z",
    resolvedAt: null,
    ...cambios,
  };
}

const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" } as const;
const USDT0_POLYGON = { kind: "asset", code: "USDT0", identifier: LISTA_CERRADA.usdt0Polygon, chain: "POLYGON" } as const;
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: LISTA_CERRADA.usdcPolygon, chain: "POLYGON" } as const;
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" } as const;
const paso = (kind: string, status = "pending") => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (t: Record<string, unknown>) => ({
  status: "PENDING",
  amountInPlanned: "0",
  amountOutPlanned: "0",
  amountInActual: null,
  amountOutActual: null,
  onchainTxHash: null,
  signingMode: "COSIGNED",
  fundsLocation: null,
  failure: null,
  steps: [],
  etaSeconds: null,
  startedAt: null,
  ...t,
});

type Orden = Record<string, unknown> & { id: string };
/** Bs 300 pagados: Stereum entregó USDT0 y la orden espera la aprobación del permiso del canje. */
function ordenQueEspera(cambios: Partial<Orden> = {}): Orden {
  return {
    id: ORDEN,
    direction: "ONRAMP",
    state: "processing",
    createdAt: "2026-11-16T15:00:00.000Z",
    updatedAt: "2026-11-16T15:05:00.000Z",
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT0_POLYGON, amountInPlanned: "300", amountOutPlanned: "24.9", status: "COMPLETED", amountInActual: "300", amountOutActual: "24.9", signingMode: null }),
      tramo({ index: 1, kind: "SWAP", from: USDT0_POLYGON, to: USDC_POLYGON, amountInPlanned: "24.9", amountOutPlanned: "24.85", status: "AWAITING_ACTION", fundsLocation: { chain: "POLYGON", address: PASO_DE_ANA, asset: "USDT0", amount: "24900000" }, steps: [paso("approve", "awaiting_approval"), paso("swap")] }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "24.85", amountOutPlanned: "24.85", steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")] }),
    ],
    pendingAction: { kind: "COSIGN_APPROVAL", actionId: "act-1", legIndex: 1, cosignRequestId: PEDIDO, summary: "Approve" },
    failure: null,
    nextPollAfter: "2026-11-16T15:05:10.000Z",
    ...cambios,
  };
}
/** Recién creada: espera el pago con el QR del banco. */
function ordenEsperandoPago(cambios: Partial<Orden> = {}): Orden {
  const base = ordenQueEspera();
  return {
    ...base,
    id: "ord_nueva_0000aaaa",
    state: "awaiting_payment",
    legs: (base.legs as Record<string, unknown>[]).map((l, i) => (i === 0 ? { ...l, status: "PENDING", amountInActual: null, amountOutActual: null } : { ...l, status: "PENDING", fundsLocation: null, steps: (l.steps as Record<string, unknown>[]).map((s) => ({ ...s, status: "pending" })) })),
    pendingAction: { kind: "FIAT_PAYMENT", actionId: "act-pago", legIndex: 0, expiresAt: "2099-01-01T00:00:00.000Z", instructions: { kind: "qr", currency: "BOB", amount: "300.00", scannable: { image: { mediaType: "image/png", encoding: "base64", data: "iVBORw0KGgo=" } } } },
    ...cambios,
  };
}
/** Frenada: un tramo retenido que la persona destraba con un toque. */
const ordenFrenada = (): Orden => {
  const base = ordenQueEspera();
  const legs = (base.legs as Record<string, unknown>[]).map((l, i) => (i === 1 ? { ...l, status: "HELD" } : l));
  return { ...base, legs, pendingAction: null, nextPollAfter: null, failure: { code: "APPROVAL_EXPIRED", legIndex: 1, retryable: true, resolutionOwner: "END_USER", resolutionAction: "approve_again" } };
};

const PRECIO: PrecioDeCarga = { quoteId: "q-300", vence: "2099-01-01T00:00:00.000Z", pagas: 300, recibis: 24.5, tasa: 300 / 24.5, minutos: 9, aprobaciones: null, campos: [] };
const KYC: PasoDeVerificacion = { tipo: "KYC", estado: "por-hacer", numero: 1, total: 4, opcion: "opt-kyc", corredor: "cor-bo" };
const FORM: PasoDeVerificacion = { ...KYC, tipo: "FORM", numero: 2, opcion: "form-1" };
const SEGIP: PasoDeVerificacion = { ...KYC, tipo: "REGISTRY_CHECK", numero: 3, opcion: "opt-segip" };
const ALTA: PasoDeVerificacion = { ...KYC, tipo: "PROVIDER_REGISTRATION", numero: 4, opcion: "opt-alta" };

/** El pedido de la cuenta de paso en Polygon: crear una cuenta en la billetera de la persona. No mueve dinero. */
const pedidoDeCuenta = (cambios: Partial<Pedido> = {}): Pedido => ({
  id: "cuenta-1",
  kind: "ACCOUNT",
  network: "POLYGON",
  status: "PENDING",
  subOrgId: SUB,
  activityId: null,
  fingerprint: null,
  signWith: "",
  unsignedPayload: JSON.stringify({ walletId: "billetera-1", accounts: [{ curve: "CURVE_SECP256K1", pathFormat: "PATH_FORMAT_BIP32", path: "m/44'/60'/0'/0/0", addressFormat: "ADDRESS_FORMAT_ETHEREUM" }] }),
  payloadHash: "",
  refreshable: false,
  intent: "add_accounts",
  operation: "create_wallet_accounts",
  details: {},
  createdAt: "2026-11-16T15:00:00.000Z",
  expiresAt: "2099-11-17T15:00:00.000Z",
  resolvedAt: null,
  ...cambios,
});

const errorDelKit = (code: string, body: Record<string, unknown> = {}) => Object.assign(new Error(code), { name: "PollarApiError", code, body: { success: false, code, ...body } });
const sinRed = () => Object.assign(new TypeError("Failed to fetch"), { name: "PollarNetworkError", code: "SDK_NETWORK_TIMEOUT" });

/* ------------------------------------------------------------------ el servidor de mentira */

let orden: Orden;
let pedido: Pedido;
/** Lo que devolvió el último `refresh`: lo que se revisa, se verifica y se estampa tiene que ser este mismo objeto. */
let refrescado: Pedido | null;
/** Las órdenes que tiene la persona en Pollar. */
let ordenes: Orden[];
/** Los pedidos de co-firma que esperan su voto. */
let pendientes: Pedido[];

const cuantas = (nombre: string): number => h.llamadas.filter((n) => n === nombre).length;
const votos = (): number => cuantas("relay");
const VOTA = ["refresh", "verify", "relay", "approve", "settle"] as const;
const nadaQueVote = (): void => {
  for (const n of VOTA) expect(h.llamadas, n).not.toContain(n);
};
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  reiniciar(h);
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_RAMPA", "pollar");
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  h.billetera = { address: CUENTA, provisioning: "READY", existsOnStellar: true };
  pollarWallet.address = CUENTA;
  orden = ordenQueEspera();
  pedido = pedidoDePermiso();
  refrescado = null;
  ordenes = [];
  pendientes = [];
  h.impl["recovery.status"] = async () => ({ required: true, configured: true, subOrgId: SUB, email: { address: null, verified: false }, passkeys: [], devices: [] });
  h.impl.getRampOrder = async (id: string) => {
    if (id !== orden.id) throw errorDelKit("SDK_RAMPS_TX_NOT_FOUND");
    return structuredClone(orden);
  };
  h.impl.get = async (id: string) => {
    const p = pendientes.find((x) => x.id === id) ?? (id === pedido.id ? pedido : null);
    if (!p) throw errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND");
    return structuredClone(p);
  };
  h.impl.refresh = async (id: string) => {
    refrescado = { ...structuredClone(pedido), id };
    return refrescado;
  };
  h.impl.pending = async () => structuredClone(pendientes);
  h.impl.verify = (r: CosignRequest) => kitReal.verify(r);
  // Votar que sí: Pollar firma, el pedido queda aprobado y la orden pasa al paso siguiente.
  h.impl.relay = async (_ruta: string, _cuerpo: unknown, opciones: { requestId: string }) => {
    if (opciones.requestId === pedido.id) {
      pedido = { ...pedido, status: "APPROVED", activityId: "actividad-1" };
      return { status: 200, body: {}, request: structuredClone(pedido) };
    }
    const cuenta = pendientes.find((x) => x.id === opciones.requestId);
    if (!cuenta) throw errorDelKit("SDK_COSIGN_REQUEST_NOT_FOUND");
    pendientes = pendientes.filter((x) => x.id !== cuenta.id);
    return { status: 200, body: {}, request: { ...structuredClone(cuenta), status: "APPROVED", activityId: "actividad-cuenta" } };
  };
  h.impl.listRampOrders = async () => ({ orders: structuredClone(ordenes), nextCursor: null });
  h.impl.createRampOrder = async () => {
    const nueva = ordenEsperandoPago();
    ordenes.push(nueva);
    return structuredClone(nueva);
  };
});

afterEach(async () => {
  // Votar se hace solo con relay, después de la regla: nunca con approve (vuelve a pedir la transacción por dentro), ni
  // se rechaza o se cancela (es definitivo). Y nunca se firma un tramo con signRampLeg.
  for (const n of ["approve", "reject", "cancel", "signRampLeg"]) expect(h.llamadas, n).not.toContain(n);
  await pollarWallet.disconnect();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ la bandera */

/** Cada método de la carga, llamado con lo mínimo. */
const TODOS: ReadonlyArray<[string, () => Promise<{ estado: string }>]> = [
  ["cargaRuta", () => pollarWallet.cargaRuta()],
  ["cargaCotizar", () => pollarWallet.cargaCotizar({ fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" }, emisor: USDC_MAINNET.issuer }, 300)],
  ["cargaAbrirVerificacion", () => pollarWallet.cargaAbrirVerificacion(KYC)],
  ["cargaMirarVerificacion", () => pollarWallet.cargaMirarVerificacion(KYC)],
  ["cargaEsperarVerificacion", () => pollarWallet.cargaEsperarVerificacion(KYC, { cadaMs: 1, topeMs: 5 })],
  ["cargaLeerFormulario", () => pollarWallet.cargaLeerFormulario(FORM)],
  ["cargaGuardarFormulario", () => pollarWallet.cargaGuardarFormulario(FORM, { nombre: "Ana" })],
  ["cargaLeerSegip", () => pollarWallet.cargaLeerSegip(SEGIP)],
  ["cargaConfirmarSegip", () => pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "Rojas" })],
  ["cargaLeerAlta", () => pollarWallet.cargaLeerAlta(ALTA)],
  ["cargaDarDeAlta", () => pollarWallet.cargaDarDeAlta(ALTA)],
  ["cargaPreparar", () => pollarWallet.cargaPreparar([{ que: "linea", emisor: USDC_MAINNET.issuer }, { que: "cuenta-de-paso", red: "POLYGON" }])],
  ["cargaCrearOrden", () => pollarWallet.cargaCrearOrden(PRECIO)],
  ["cargaCrearOrdenDeCompra", () => pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, { avisar: async () => true, anular: async () => undefined })],
  ["cargaLeerOrden", () => pollarWallet.cargaLeerOrden(ORDEN)],
  ["cargaSeguir", () => pollarWallet.cargaSeguir(ORDEN)],
  ["cargaYaPague", () => pollarWallet.cargaYaPague(ORDEN)],
  ["cargaRevisarPaso", () => pollarWallet.cargaRevisarPaso(ORDEN, PEDIDO)],
  ["cargaAprobar", () => pollarWallet.cargaAprobar(ORDEN, PEDIDO)],
  ["cargaReintentar", () => pollarWallet.cargaReintentar(ORDEN)],
  ["cargaAbiertas", () => pollarWallet.cargaAbiertas()],
  ["cargaCerradas", () => pollarWallet.cargaCerradas(Date.parse("2026-11-09T00:00:00.000Z"))],
];

describe("con la bandera apagada no se llama a nada", () => {
  for (const [rampa, red] of [
    ["", "mainnet"],
    ["recibir", "mainnet"],
    ["meru", "mainnet"],
    ["pollar", "testnet"],
  ] as const) {
    it(`VITE_RAMPA=${rampa || "vacía"} en ${red}: apagada, sin armar el cliente`, async () => {
      vi.stubEnv("VITE_RAMPA", rampa);
      h.red.name = red;
      expect(cargaPrendida()).toBe(false);
      for (const [nombre, llamar] of TODOS) expect(await llamar(), nombre).toEqual({ estado: "apagada" });
      expect(h.construidos).toBe(0);
      expect(h.llamadas).toEqual([]);
    });
  }

  it("con VITE_RAMPA=pollar y en la red principal, prendida", () => {
    expect(cargaPrendida()).toBe(true);
  });

  // Con la venta abierta para todos: sin ella, la venta está en piloto y se ve solo con su marca (`venta-piloto.ts`).
  const COMPRA_QR = { VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app", VITE_COMPRA_QR: "1", VITE_VENTA_ABIERTA: "1" };

  it("con la compra con QR prendida en la red principal, prendida aunque VITE_RAMPA esté vacía", () => {
    vi.stubEnv("VITE_RAMPA", "");
    for (const [k, v] of Object.entries(COMPRA_QR)) vi.stubEnv(k, v);
    expect(cargaPrendida()).toBe(true);
    h.red.name = "testnet";
    expect(cargaPrendida()).toBe(false);
  });

  it("VITE_COMPRA_QR sin la compra prendida no prende la carga ni llama a nada", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    for (const [k, v] of Object.entries({ ...COMPRA_QR, VITE_PAGO_CON_SALDO: "" })) vi.stubEnv(k, v);
    expect(cargaPrendida()).toBe(false);
    for (const [nombre, llamar] of TODOS) expect(await llamar(), nombre).toEqual({ estado: "apagada" });
    expect(h.construidos).toBe(0);
  });

  it("sin la cuenta de la sesión (otra en el kit), ninguna llamada de la carga", async () => {
    h.billetera = { address: OTRA_CUENTA, provisioning: "READY", existsOnStellar: true };
    for (const [nombre, llamar] of TODOS) expect(await llamar(), nombre).toEqual({ estado: "sin-cuenta" });
    expect(h.llamadas.filter((n) => n !== "ready")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ la ruta y el precio */

describe("la ruta y la cotización", () => {
  const rutas = { routes: [{ fiat: BOB_QR, asset: { kind: "asset", code: "USDC", identifier: "0x2", chain: "POLYGON" }, legs: ["PROVIDER_ONRAMP"] }, { fiat: BOB_QR, asset: USDC_STELLAR, legs: ["PROVIDER_ONRAMP", "SWAP", "BRIDGE"] }] };

  it("pide las rutas de cargar y toma la de Bolivia a Stellar", async () => {
    h.impl.getRampRoutes = async () => rutas;
    const r = await pollarWallet.cargaRuta();
    expect(r).toEqual({ estado: "ruta", ruta: { fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" }, emisor: USDC_MAINNET.issuer } });
    expect(h.argumentos.getRampRoutes).toEqual([["ONRAMP"]]);
  });

  it("sin la ruta de Stellar no hay ruta, y un 402 o un corte se dicen en una palabra", async () => {
    h.impl.getRampRoutes = async () => ({ routes: [rutas.routes[0]] });
    expect(await pollarWallet.cargaRuta()).toEqual({ estado: "sin-ruta" });
    h.impl.getRampRoutes = async () => {
      throw errorDelKit("SDK_CREDITS_INSUFFICIENT");
    };
    expect(await pollarWallet.cargaRuta()).toEqual({ estado: "sin-creditos" });
    h.impl.getRampRoutes = async () => {
      throw sinRed();
    };
    expect(await pollarWallet.cargaRuta()).toEqual({ estado: "sin-red" });
  });

  it("la palabra de cada error es la misma que da el núcleo de la carga", async () => {
    const { motivoDelError } = await import("./rampa-pollar");
    const errores = [errorDelKit("SDK_CREDITS_INSUFFICIENT"), errorDelKit("SDK_BILLING_OVERDUE"), errorDelKit("SDK_WALLET_RECOVERY_REQUIRED"), sinRed(), new TypeError("Load failed"), errorDelKit("SDK_RAMPS_NO_ROUTE"), new Error("x"), null, undefined, "x"];
    for (const e of errores) {
      const m = motivoDelError(e);
      expect(billetera.fallaDeCarga(e).estado, String(e)).toBe(m === "sin-creditos" || m === "sin-red" || m === "proteger-cuenta" ? m : "no-se-pudo");
    }
  });

  it("un error del kit nunca llega a la pantalla con su texto", async () => {
    h.impl.getRampRoutes = async () => {
      throw new Error(`algo interno con ${CUENTA} y 0xdeadbeef`);
    };
    const r = await pollarWallet.cargaRuta();
    expect(r).toEqual({ estado: "no-se-pudo" });
    expect(JSON.stringify(r)).not.toContain("deadbeef");
  });

  it("cotiza los bolivianos enteros por la ruta y lee el precio", async () => {
    const ruta = { fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" }, emisor: USDC_MAINNET.issuer } as const;
    h.impl.quoteRamp = async () => ({
      quotes: [
        {
          quoteId: "q-300",
          expiresAt: "2099-01-01T00:00:00.000Z",
          amountIn: "300",
          amountOut: "24.5",
          etaSeconds: 540,
          legs: [
            { index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT0_POLYGON, amountIn: "300", amountOut: "24.9", requiredFields: [] },
            { index: 1, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountIn: "24.85", amountOut: "24.5", requiredFields: [] },
          ],
        },
      ],
      rejected: [],
    });
    const r = await pollarWallet.cargaCotizar(ruta, 300);
    expect(r).toMatchObject({ estado: "precio", precio: { quoteId: "q-300", pagas: 300, recibis: 24.5 } });
    expect(h.argumentos.quoteRamp).toEqual([[{ direction: "ONRAMP", fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" }, amount: { value: "300", denomination: "in" } }]]);
  });

  it("lo que falta en vez del precio, y un monto que no es entero ni se pregunta", async () => {
    const ruta = { fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: USDC_MAINNET.issuer, chain: "STELLAR" }, emisor: USDC_MAINNET.issuer } as const;
    h.impl.quoteRamp = async () => {
      throw errorDelKit("SDK_RAMPS_NO_ROUTE", {
        rejected: [
          {
            legs: [{ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT0_POLYGON }],
            failure: { code: "PROVIDER_VERIFICATION_REQUIRED", legIndex: 0, retryable: true, resolutionOwner: "END_USER", resolutionAction: "complete_verification" },
            requirement: { corridorId: "cor-bo", position: 1, completed: 0, total: 4, type: "KYC", optionId: "opt-kyc", status: "none" },
          },
        ],
      });
    };
    expect(await pollarWallet.cargaCotizar(ruta, 300)).toEqual({ estado: "falta", falta: [{ que: "verificacion", paso: KYC }] });
    expect(await pollarWallet.cargaCotizar(ruta, 300.5)).toEqual({ estado: "no-se-puede" });
    expect(cuantas("quoteRamp")).toBe(1);
  });
});

/* ------------------------------------------------------------------ la verificación */

describe("tu carnet y tu cara", () => {
  beforeEach(() => {
    h.impl.getKycProviders = async () => ({ providers: [{ id: "opt-kyc", name: "Didit", flow: "redirect", levels: ["intermediate"] }] });
    h.impl.resolveKyc = async () => ({ alreadyApproved: false, sessionId: "ses-1", kycUrl: "https://verify.didit.example.org/s/ses-1" });
  });

  it("abre la verificación con el nivel del proveedor, el país y la ruta, y devuelve su página", async () => {
    expect(await pollarWallet.cargaAbrirVerificacion(KYC)).toEqual({ estado: "abrir", url: "https://verify.didit.example.org/s/ses-1" });
    expect(h.argumentos.getKycProviders).toEqual([["BO", "cor-bo"]]);
    const [proveedor, nivel, pais, corredor, clave] = h.argumentos.resolveKyc?.[0] ?? [];
    expect([proveedor, nivel, pais, corredor]).toEqual(["opt-kyc", "intermediate", "BO", "cor-bo"]);
    expect(typeof clave).toBe("string");
  });

  it("un proveedor que no está en la lista del país va sin nivel ni país, como en la ventana del kit", async () => {
    h.impl.getKycProviders = async () => ({ providers: [] });
    await pollarWallet.cargaAbrirVerificacion(KYC);
    expect(h.argumentos.resolveKyc?.[0]?.slice(0, 4)).toEqual(["opt-kyc", undefined, undefined, "cor-bo"]);
  });

  it("tocar otra vez retoma la misma verificación (la misma clave); Empezar de nuevo pide otra", async () => {
    await pollarWallet.cargaAbrirVerificacion(KYC);
    await pollarWallet.cargaAbrirVerificacion(KYC);
    await pollarWallet.cargaAbrirVerificacion(KYC, { deNuevo: true });
    const claves = (h.argumentos.resolveKyc ?? []).map((a) => a[4]);
    expect(claves[0]).toBe(claves[1]);
    expect(claves[2]).not.toBe(claves[0]);
  });

  it("ya aprobada, en revisión o vencida (y la vencida no vuelve a usar su clave)", async () => {
    h.impl.resolveKyc = async () => ({ alreadyApproved: true });
    expect(await pollarWallet.cargaAbrirVerificacion(KYC)).toEqual({ estado: "lista" });
    h.impl.resolveKyc = async () => {
      throw errorDelKit("SDK_KYC_ALREADY_APPROVED");
    };
    expect(await pollarWallet.cargaAbrirVerificacion(KYC)).toEqual({ estado: "lista" });
    h.impl.resolveKyc = async () => {
      throw errorDelKit("SDK_KYC_UNDER_REVIEW");
    };
    expect(await pollarWallet.cargaAbrirVerificacion(KYC)).toEqual({ estado: "en-revision" });
    h.impl.resolveKyc = async () => {
      throw errorDelKit("SDK_KYC_SESSION_EXPIRED");
    };
    expect(await pollarWallet.cargaAbrirVerificacion(KYC)).toEqual({ estado: "vencida" });
    h.impl.resolveKyc = async () => ({ alreadyApproved: false, sessionId: "ses-2", kycUrl: "https://verify.didit.example.org/s/ses-2" });
    await pollarWallet.cargaAbrirVerificacion(KYC);
    const claves = (h.argumentos.resolveKyc ?? []).map((a) => a[4]);
    expect(claves[4]).not.toBe(claves[3]);
  });

  it("una página que no es https, o una verificación sin página, no se abre", async () => {
    for (const kycUrl of ["http://verify.example.org/s", "javascript:alert(1)", "https://ana:clave@verify.example.org/s", undefined]) {
      h.impl.resolveKyc = async () => ({ alreadyApproved: false, sessionId: "ses", ...(kycUrl === undefined ? {} : { kycUrl }) });
      expect(await pollarWallet.cargaAbrirVerificacion(KYC), String(kycUrl)).toEqual({ estado: "desconocido" });
    }
  });

  it("un paso que no es el del carnet no abre nada", async () => {
    expect(await pollarWallet.cargaAbrirVerificacion(FORM)).toEqual({ estado: "desconocido" });
    expect(h.llamadas).not.toContain("resolveKyc");
  });

  it("Ya terminé pregunta en el momento, por la ruta", async () => {
    h.impl.getKycStatus = async () => ({ status: "approved" });
    expect(await pollarWallet.cargaMirarVerificacion(KYC)).toEqual({ estado: "leida", verificacion: "aprobada" });
    expect(h.argumentos.getKycStatus).toEqual([[undefined, "cor-bo"]]);
  });

  it("cómo quedó, sin decir más de lo que se sabe", () => {
    expect(estadoDeVerificacion({ status: "approved" })).toBe("aprobada");
    expect(estadoDeVerificacion({ status: "pending", decisionStatus: "approved" })).toBe("procesando");
    expect(estadoDeVerificacion({ status: "pending", decisionStatus: "rejected" })).toBe("procesando");
    expect(estadoDeVerificacion({ status: "pending", decisionStatus: "manual_review" })).toBe("en-revision");
    expect(estadoDeVerificacion({ status: "rejected" })).toBe("rechazada");
    expect(estadoDeVerificacion({ status: "expired" })).toBe("vencida");
    expect(estadoDeVerificacion({ status: "pending", decisionStatus: "expired" })).toBe("vencida");
    for (const x of [{ status: "none" }, { status: "pending" }, { status: "pending", decisionStatus: "pending" }, null, "x", {}]) expect(estadoDeVerificacion(x)).toBe("en-curso");
  });

  it("la espera mira hasta que hay una respuesta", async () => {
    const respuestas = [{ status: "none" }, { status: "pending" }, { status: "approved" }];
    h.impl.getKycStatus = async () => respuestas.shift() ?? { status: "approved" };
    expect(await pollarWallet.cargaEsperarVerificacion(KYC, { cadaMs: 1 })).toEqual({ estado: "leida", verificacion: "aprobada" });
    expect(cuantas("getKycStatus")).toBe(3);
  });

  it("la espera se corta al cerrar la ventana, y no sigue preguntando", async () => {
    h.impl.getKycStatus = async () => ({ status: "pending" });
    const corte = new AbortController();
    const espera = pollarWallet.cargaEsperarVerificacion(KYC, { cadaMs: 5, signal: corte.signal });
    await new Promise((r) => setTimeout(r, 12));
    corte.abort();
    expect(await espera).toEqual({ estado: "cortada" });
    const preguntas = cuantas("getKycStatus");
    await new Promise((r) => setTimeout(r, 20));
    expect(cuantas("getKycStatus")).toBe(preguntas);
  });

  it("pasado el tope, dice que sigue en curso", async () => {
    h.impl.getKycStatus = async () => ({ status: "pending" });
    expect(await pollarWallet.cargaEsperarVerificacion(KYC, { cadaMs: 2, topeMs: 10 })).toEqual({ estado: "leida", verificacion: "en-curso" });
  });
});

describe("unos datos tuyos, el SEGIP y el alta con Stereum", () => {
  it("el formulario se lee y se guarda con su identificador", async () => {
    const formulario = { formId: "form-1", version: 1, name: "Datos", description: null, fields: [{ key: "nombre", type: "text", label: { en: "Name", es: "Nombre" }, required: true }], answers: {}, missing: ["nombre"] };
    h.impl.getRequirementForm = async () => formulario;
    expect(await pollarWallet.cargaLeerFormulario(FORM)).toEqual({ estado: "formulario", formulario });
    h.impl.submitRequirementForm = async () => ({ formId: "form-1" });
    expect(await pollarWallet.cargaGuardarFormulario(FORM, { nombre: "Ana" })).toEqual({ estado: "guardado" });
    expect(h.argumentos.getRequirementForm).toEqual([["form-1"]]);
    expect(h.argumentos.submitRequirementForm).toEqual([["form-1", { nombre: "Ana" }]]);
  });

  it("las respuestas que el servidor no acepta vuelven por campo", async () => {
    h.impl.submitRequirementForm = async () => {
      throw errorDelKit("KYC_FORM_INVALID_ANSWERS", { errors: [{ key: "nombre", code: "required" }, { key: 3 }, "x"] });
    };
    expect(await pollarWallet.cargaGuardarFormulario(FORM, {})).toEqual({ estado: "respuestas", errores: [{ key: "nombre", code: "required" }] });
  });

  it("el SEGIP: aprobada, en revisión, los datos para confirmar o la identidad que falta", async () => {
    const datos = { optionId: "opt-segip", status: "none", prefill: { applies: true, givenNames: "Ana", surname1: "Rojas", birthdate: "1990-01-01", dniType: "CI", documentNumber: "1234567" } };
    h.impl.getRegistryCheck = async () => datos;
    expect(await pollarWallet.cargaLeerSegip(SEGIP)).toEqual({ estado: "datos", segip: datos });
    h.impl.getRegistryCheck = async () => ({ ...datos, status: "approved" });
    expect(await pollarWallet.cargaLeerSegip(SEGIP)).toEqual({ estado: "aprobada" });
    h.impl.getRegistryCheck = async () => ({ ...datos, status: "pending" });
    expect(await pollarWallet.cargaLeerSegip(SEGIP)).toEqual({ estado: "en-revision" });
    h.impl.getRegistryCheck = async () => {
      throw errorDelKit("KYC_REGISTRY_IDENTITY_REQUIRED");
    };
    expect(await pollarWallet.cargaLeerSegip(SEGIP)).toEqual({ estado: "falta-identidad" });
  });

  it("confirmar manda los apellidos sin espacios de más y sin los campos vacíos", async () => {
    h.impl.submitRegistryCheck = async () => ({ optionId: "opt-segip", status: "approved" });
    expect(await pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "  Rojas ", surname2: "  ", complementNumber: " 1A " })).toEqual({ estado: "aprobada" });
    expect(h.argumentos.submitRegistryCheck).toEqual([["opt-segip", { surname1: "Rojas", complementNumber: "1A" }]]);
    h.impl.submitRegistryCheck = async () => ({ optionId: "opt-segip", status: "rejected", rejectedFields: ["surname2"] });
    expect(await pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "Rojas" })).toEqual({ estado: "rechazada", campos: ["surname2"] });
    h.impl.submitRegistryCheck = async () => ({ optionId: "opt-segip", status: "pending" });
    expect(await pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "Rojas" })).toEqual({ estado: "en-revision" });
    h.impl.submitRegistryCheck = async () => {
      throw errorDelKit("KYC_REGISTRY_NAME_MISMATCH");
    };
    expect(await pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "Rojas" })).toEqual({ estado: "no-coincide" });
    expect(await pollarWallet.cargaConfirmarSegip(SEGIP, { surname1: "   " })).toEqual({ estado: "desconocido" });
    expect(cuantas("submitRegistryCheck")).toBe(4);
  });

  it("el alta con Stereum: ya registrada, lo que comparte, darse de alta y los datos que faltan", async () => {
    const alta = { corridorId: "cor-bo", rampProviderId: "stereum", status: "none", ready: true, fields: ["nombre", "carnet"] };
    h.impl.getProviderRegistration = async () => alta;
    expect(await pollarWallet.cargaLeerAlta(ALTA)).toEqual({ estado: "alta", alta });
    h.impl.getProviderRegistration = async () => ({ ...alta, status: "registered" });
    expect(await pollarWallet.cargaLeerAlta(ALTA)).toEqual({ estado: "registrada" });
    h.impl.submitProviderRegistration = async () => ({ corridorId: "cor-bo", rampProviderId: "stereum", status: "registered" });
    expect(await pollarWallet.cargaDarDeAlta(ALTA)).toEqual({ estado: "registrada" });
    expect(h.argumentos.submitProviderRegistration).toEqual([["cor-bo"]]);
    h.impl.submitProviderRegistration = async () => {
      throw errorDelKit("KYC_REGISTRATION_MISSING_DATA", { missing: ["telefono", 3], invalid: ["correo"], forms: [{ formId: "form-2", keys: ["telefono"] }, { nada: 1 }] });
    };
    expect(await pollarWallet.cargaDarDeAlta(ALTA)).toEqual({ estado: "faltan-datos", faltan: ["telefono"], invalidos: ["correo"], formularios: ["form-2"] });
  });

  it("cada paso con su tipo: uno de otro tipo no llama a nada", async () => {
    expect(await pollarWallet.cargaLeerFormulario(KYC)).toEqual({ estado: "desconocido" });
    expect(await pollarWallet.cargaLeerSegip(FORM)).toEqual({ estado: "desconocido" });
    expect(await pollarWallet.cargaDarDeAlta(SEGIP)).toEqual({ estado: "desconocido" });
    expect(h.llamadas.filter((n) => n !== "ready")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ preparar para recibir */

describe("Preparar mi cuenta: la línea y la cuenta de paso, en orden y sin reintentos solos", () => {
  const LINEA: LoQueFalta = { que: "linea", emisor: USDC_MAINNET.issuer };
  const CUENTA_DE_PASO: LoQueFalta = { que: "cuenta-de-paso", red: "POLYGON" };

  beforeEach(() => {
    h.impl.setTrustline = async () => ({ status: "success", hash: "abc" });
    // La cuenta nueva de Polygon deja un pedido de crear su cuenta, que espera el voto de este navegador.
    h.impl.runRampWalletStep = async () => {
      pendientes = [pedidoDeCuenta()];
      return { recoveryRequired: false };
    };
  });

  it("abre la línea y después crea la cuenta de paso, aprobando su pedido con la regla de la cuenta de paso", async () => {
    expect(await pollarWallet.cargaPreparar([LINEA, CUENTA_DE_PASO])).toEqual({ estado: "listo" });
    const secuencia = h.llamadas.filter((n) => ["setTrustline", "runRampWalletStep", "verify", "relay"].includes(n));
    expect(secuencia).toEqual(["setTrustline", "runRampWalletStep", "verify", "relay"]);
    expect(h.argumentos.runRampWalletStep?.[0]?.[0]).toMatchObject({ action: "set_up_wallet", chain: "POLYGON" });
    const [ruta, cuerpo, opciones] = h.argumentos.relay?.[0] ?? [];
    expect(ruta).toBe("/public/v1/submit/create_wallet_accounts");
    expect((cuerpo as { organizationId: unknown }).organizationId).toBe(SUB);
    expect(opciones).toEqual({ requestId: "cuenta-1" });
  });

  it("con la compra con QR prendida y VITE_RAMPA vacía, preparar también abre la línea: no queda apagada", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    for (const [k, v] of Object.entries({ VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app", VITE_COMPRA_QR: "1", VITE_VENTA_ABIERTA: "1" })) vi.stubEnv(k, v);
    expect(cargaPrendida()).toBe(true);
    expect(await pollarWallet.cargaPreparar([LINEA, CUENTA_DE_PASO])).toEqual({ estado: "listo" });
    expect(h.llamadas.filter((n) => ["setTrustline", "runRampWalletStep"].includes(n))).toEqual(["setTrustline", "runRampWalletStep"]);
  });

  it("si la línea no sale, no sigue con la cuenta de paso", async () => {
    h.impl.setTrustline = async () => ({ status: "error", code: "SDK_CREDITS_INSUFFICIENT" });
    expect(await pollarWallet.cargaPreparar([LINEA, CUENTA_DE_PASO])).toEqual({ estado: "linea", resultado: "ahora-no" });
    expect(h.llamadas).not.toContain("runRampWalletStep");
  });

  it("una línea que ya se pidió y espera no se pide otra vez", async () => {
    pendientes = [{ ...pedidoDeCuenta(), id: "linea-1", kind: "TX", network: "STELLAR", operation: "change_trust" }];
    expect(await pollarWallet.cargaPreparar([LINEA])).toEqual({ estado: "linea", resultado: "en-curso" });
    expect(h.llamadas).not.toContain("setTrustline");
  });

  it("un pedido de cuenta que ya esperaba se vota sin crear otra cuenta", async () => {
    pendientes = [pedidoDeCuenta()];
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "listo" });
    expect(h.llamadas).not.toContain("runRampWalletStep");
    expect(votos()).toBe(1);
  });

  it("con la cuenta todavía sin crear en Pollar, vota el pedido que deja; sin pedido, espera", async () => {
    h.impl.runRampWalletStep = async () => {
      pendientes = [pedidoDeCuenta()];
      throw errorDelKit("SDK_RAMPS_WALLET_NOT_READY");
    };
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "listo" });
    expect(votos()).toBe(1);
    h.impl.runRampWalletStep = async () => {
      throw errorDelKit("SDK_RAMPS_WALLET_NOT_READY");
    };
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "cuenta-de-paso-espera" });
    expect(votos()).toBe(1);
  });

  it("un pedido de cuenta de otra organización o con otra propuesta no se vota", async () => {
    h.impl.runRampWalletStep = async () => {
      pendientes = [pedidoDeCuenta({ subOrgId: "otra-org" })];
      return { recoveryRequired: false };
    };
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "cuenta-de-paso-rara" });
    pendientes = [];
    h.impl.runRampWalletStep = async () => {
      pendientes = [pedidoDeCuenta()];
      return { recoveryRequired: false };
    };
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      if (!v.ok) return v;
      const body = v.proposal.body as unknown as { parameters: { accounts: unknown[] } };
      return { ...v, proposal: { ...v.proposal, body: { ...body, parameters: { ...body.parameters, accounts: [...body.parameters.accounts, { curve: "CURVE_ED25519", pathFormat: "PATH_FORMAT_BIP32", path: "m/0", addressFormat: "ADDRESS_FORMAT_SOLANA" }] } } } };
    };
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "cuenta-de-paso-rara" });
    expect(votos()).toBe(0);
  });

  it("la cuenta que pide protegerse va al paso de la cuenta, sin votar nada", async () => {
    h.impl.runRampWalletStep = async () => ({ recoveryRequired: true });
    expect(await pollarWallet.cargaPreparar([CUENTA_DE_PASO])).toEqual({ estado: "proteger-cuenta" });
    expect(await pollarWallet.cargaPreparar([{ que: "proteger-cuenta" }, CUENTA_DE_PASO])).toEqual({ estado: "proteger-cuenta" });
    expect(votos()).toBe(0);
    expect(cuantas("runRampWalletStep")).toBe(1);
  });

  it("dos toques preparan una sola vez", async () => {
    const [a, b] = await Promise.all([pollarWallet.cargaPreparar([LINEA, CUENTA_DE_PASO]), pollarWallet.cargaPreparar([LINEA, CUENTA_DE_PASO])]);
    expect(a).toEqual({ estado: "listo" });
    expect(b).toBe(a);
    expect(cuantas("setTrustline")).toBe(1);
    expect(cuantas("runRampWalletStep")).toBe(1);
    expect(votos()).toBe(1);
  });
});

/* ------------------------------------------------------------------ crear la orden */

describe("crear la orden: dentro del candado y releyendo las abiertas", () => {
  it("relee las abiertas dentro del candado de la carga y crea la orden con esa cotización", async () => {
    const candado = vi.spyOn(navigator.locks, "request");
    const r = await pollarWallet.cargaCrearOrden(PRECIO);
    expect(r).toMatchObject({ estado: "creada", id: "ord_nueva_0000aaaa", falloAlCrear: false });
    expect(candado.mock.calls[0]?.[0]).toBe(CANDADO_DE_LA_CARGA);
    expect(h.llamadas.filter((n) => ["listRampOrders", "createRampOrder"].includes(n))).toEqual(["listRampOrders", "createRampOrder"]);
    expect(h.argumentos.listRampOrders).toEqual([[{ open: "true" }]]);
    expect(h.argumentos.createRampOrder).toEqual([[{ quoteId: "q-300" }]]);
  });

  it("con una carga abierta no crea otra: va a esa", async () => {
    ordenes = [ordenQueEspera()];
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toEqual({ estado: "ya-hay", id: ORDEN });
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("si no se puede saber si hay una abierta, no crea nada", async () => {
    h.impl.listRampOrders = async () => ({ orders: [{ id: 3 }] });
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toEqual({ estado: "no-se-sabe" });
    h.impl.listRampOrders = async () => {
      throw sinRed();
    };
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toEqual({ estado: "sin-red" });
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("dos toques crean una sola orden", async () => {
    const [a, b] = await Promise.all([pollarWallet.cargaCrearOrden(PRECIO), pollarWallet.cargaCrearOrden(PRECIO)]);
    expect(b).toBe(a);
    expect(cuantas("createRampOrder")).toBe(1);
  });

  it("dos pestañas no crean dos órdenes: la segunda espera el candado, relee y va a la de la primera", async () => {
    vi.resetModules();
    const { pollarWallet: otraPestana } = await import("./wallet-pollar");
    otraPestana.address = CUENTA;
    let soltar!: () => void;
    const sigue = new Promise<void>((r) => {
      soltar = r;
    });
    h.impl.createRampOrder = async () => {
      await sigue;
      const nueva = ordenEsperandoPago();
      ordenes.push(nueva);
      return structuredClone(nueva);
    };
    const a = pollarWallet.cargaCrearOrden(PRECIO);
    const b = otraPestana.cargaCrearOrden(PRECIO);
    await tick();
    await tick();
    soltar();
    const r = await Promise.all([a, b]);
    expect(cuantas("createRampOrder")).toBe(1);
    expect(r.map((x) => x.estado).sort()).toEqual(["creada", "ya-hay"]);
    await otraPestana.disconnect();
  });

  it("un precio vencido o un dato que falta no crea la orden", async () => {
    expect(await pollarWallet.cargaCrearOrden({ ...PRECIO, vence: "2020-01-01T00:00:00.000Z" })).toEqual({ estado: "precio-vencido" });
    const conDatos: PrecioDeCarga = { ...PRECIO, campos: [{ key: "telefono", label: "Phone", type: "tel" }, { key: "nota", label: "Note", type: "text", optional: true }] };
    expect(await pollarWallet.cargaCrearOrden(conDatos, { telefono: "  " })).toEqual({ estado: "faltan-datos" });
    expect(h.llamadas).not.toContain("createRampOrder");
    await pollarWallet.cargaCrearOrden(conDatos, { telefono: " 70000000 ", otra: "no va" });
    expect(h.argumentos.createRampOrder).toEqual([[{ quoteId: "q-300", payee: { telefono: "70000000" } }]]);
  });

  it("lo que dice Pollar al crear: cuenta de paso, precio vencido, datos y sin créditos", async () => {
    const casos: Array<[string, string]> = [
      ["SDK_RAMPS_WALLET_NOT_READY", "cuenta-de-paso"],
      ["SDK_RAMPS_QUOTE_EXPIRED", "precio-vencido"],
      ["VALIDATION_ERROR", "faltan-datos"],
      ["SDK_CREDITS_INSUFFICIENT", "sin-creditos"],
    ];
    for (const [codigo, estado] of casos) {
      h.impl.createRampOrder = async () => {
        throw errorDelKit(codigo);
      };
      expect(await pollarWallet.cargaCrearOrden(PRECIO), codigo).toEqual({ estado });
    }
  });

  it("sin respuesta al crear, vuelve a mirar: si la orden nació, va a ella", async () => {
    h.impl.createRampOrder = async () => {
      ordenes.push(ordenEsperandoPago());
      throw sinRed();
    };
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toEqual({ estado: "ya-hay", id: "ord_nueva_0000aaaa" });
    h.impl.createRampOrder = async () => {
      throw sinRed();
    };
    ordenes = [];
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toEqual({ estado: "sin-red" });
  });

  it("el aviso de carga al servidor va dentro del candado, después de releer y antes de crear", async () => {
    const pasos: string[] = [];
    const candado = vi.spyOn(navigator.locks, "request");
    const avisar = vi.fn(async () => {
      pasos.push(`aviso con ${h.llamadas.filter((n) => n === "listRampOrders" || n === "createRampOrder").join(",")}`);
      expect(candado).toHaveBeenCalled();
      return true;
    });
    expect(await pollarWallet.cargaCrearOrden(PRECIO, {}, { avisar })).toMatchObject({ estado: "creada" });
    expect(pasos).toEqual(["aviso con listRampOrders"]);
    expect(cuantas("createRampOrder")).toBe(1);
  });

  it("sin el sí del aviso no se crea la orden, y con una abierta no se avisa", async () => {
    expect(await pollarWallet.cargaCrearOrden(PRECIO, {}, { avisar: async () => false })).toEqual({ estado: "sin-aviso" });
    expect(
      await pollarWallet.cargaCrearOrden(PRECIO, {}, {
        avisar: async () => {
          throw sinRed();
        },
      }),
    ).toEqual({ estado: "sin-red" });
    expect(h.llamadas).not.toContain("createRampOrder");
    const avisar = vi.fn(async () => true);
    expect(await pollarWallet.cargaCrearOrden({ ...PRECIO, vence: "2020-01-01T00:00:00.000Z" }, {}, { avisar })).toEqual({ estado: "precio-vencido" });
    ordenes = [ordenQueEspera()];
    expect(await pollarWallet.cargaCrearOrden(PRECIO, {}, { avisar })).toEqual({ estado: "ya-hay", id: ORDEN });
    expect(avisar).not.toHaveBeenCalled();
  });

  it("una orden que nace fallada lo dice, para que la pantalla sepa que no hubo QR", async () => {
    h.impl.createRampOrder = async () => ordenEsperandoPago({ state: "failed" });
    expect(await pollarWallet.cargaCrearOrden(PRECIO)).toMatchObject({ estado: "creada", falloAlCrear: true });
  });
});

/* ------------------------------------------------------------------ crear la orden de la compra con QR */

describe("crear la orden de la compra con QR: el aviso siempre, y anular después de una falla definitiva", () => {
  const aviso = (r: true | false | "sin-red" = true) => {
    const avisar = vi.fn(async () => r);
    const anular = vi.fn(async () => undefined);
    return { avisar, anular };
  };

  it("el aviso y la anulación son obligatorios: sin ellos no compila", () => {
    // @ts-expect-error sin el aviso de la compra
    void (() => pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}));
    // @ts-expect-error sin la anulación
    void (() => pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, { avisar: async () => true }));
    // @ts-expect-error sin el aviso
    void (() => pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, { anular: async () => undefined }));
  });

  it("con la bandera apagada no avisa ni llama a nada", async () => {
    vi.stubEnv("VITE_RAMPA", "");
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "apagada" });
    expect(a.avisar).not.toHaveBeenCalled();
    expect(h.construidos).toBe(0);
  });

  it("avisa dentro del candado, después de releer, crea la orden y no anula nada", async () => {
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toMatchObject({ estado: "creada", id: "ord_nueva_0000aaaa" });
    expect(a.avisar).toHaveBeenCalledTimes(1);
    expect(a.anular).not.toHaveBeenCalled();
    expect(cuantas("createRampOrder")).toBe(1);
  });

  it("con una carga abierta avisa una vez y la adopta solo con el sí", async () => {
    ordenes = [ordenQueEspera()];
    const si = aviso(true);
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, si)).toEqual({ estado: "ya-hay", id: ORDEN });
    expect(si.avisar).toHaveBeenCalledTimes(1);
    for (const r of [false, "sin-red"] as const) {
      const no = aviso(r);
      expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, no), String(r)).toEqual({ estado: "sin-aviso" });
      expect(no.avisar).toHaveBeenCalledTimes(1);
      // Con un QR vivo no se anula nada.
      expect(no.anular).not.toHaveBeenCalled();
    }
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("un aviso que lanza es como uno sin respuesta: no crea nada", async () => {
    const a = { avisar: vi.fn(async (): Promise<true> => Promise.reject(sinRed())), anular: vi.fn(async () => undefined) };
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "sin-aviso" });
    expect(h.llamadas).not.toContain("createRampOrder");
    // El servidor pudo marcarla igual: sin ninguna carga abierta, se anula.
    expect(a.anular).toHaveBeenCalledTimes(1);
  });

  it("el aviso sin respuesta: anula solo si al releer no hay ninguna carga abierta", async () => {
    const a = aviso("sin-red");
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "sin-aviso" });
    expect(a.anular).toHaveBeenCalledTimes(1);
    // Si releer no se puede leer, no se anula: puede haber un QR vivo.
    let lecturas = 0;
    h.impl.listRampOrders = async () => (++lecturas === 1 ? { orders: [], nextCursor: null } : { orders: [{ id: 3 }] });
    const b = aviso("sin-red");
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, b)).toEqual({ estado: "sin-aviso" });
    expect(b.anular).not.toHaveBeenCalled();
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("un no del aviso no crea ni anula", async () => {
    const a = aviso(false);
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "sin-aviso" });
    expect(a.anular).not.toHaveBeenCalled();
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("un precio vencido o un dato que falta antes del aviso: ni aviso ni anulación", async () => {
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra({ ...PRECIO, vence: "2020-01-01T00:00:00.000Z" }, {}, a)).toEqual({ estado: "precio-vencido" });
    const conDatos: PrecioDeCarga = { ...PRECIO, campos: [{ key: "telefono", label: "Phone", type: "tel" }] };
    expect(await pollarWallet.cargaCrearOrdenDeCompra(conDatos, {}, a)).toEqual({ estado: "faltan-datos" });
    expect(a.avisar).not.toHaveBeenCalled();
    expect(a.anular).not.toHaveBeenCalled();
  });

  it("una falla definitiva al crear después del sí anula una vez", async () => {
    const casos: Array<[string, string]> = [
      ["SDK_RAMPS_WALLET_NOT_READY", "cuenta-de-paso"],
      ["SDK_RAMPS_QUOTE_EXPIRED", "precio-vencido"],
      ["VALIDATION_ERROR", "faltan-datos"],
      ["SDK_CREDITS_INSUFFICIENT", "sin-creditos"],
    ];
    for (const [codigo, estado] of casos) {
      h.impl.createRampOrder = async () => {
        throw errorDelKit(codigo);
      };
      const a = aviso();
      expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a), codigo).toEqual({ estado });
      expect(a.anular, codigo).toHaveBeenCalledTimes(1);
    }
  });

  it("una orden que nace fallada también anula, y lo dice", async () => {
    h.impl.createRampOrder = async () => ordenEsperandoPago({ state: "failed" });
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toMatchObject({ estado: "creada", falloAlCrear: true });
    expect(a.anular).toHaveBeenCalledTimes(1);
  });

  it("sin respuesta al crear: si la orden nació va a ella, si no hay ninguna anula, y si no se sabe no", async () => {
    h.impl.createRampOrder = async () => {
      ordenes.push(ordenEsperandoPago());
      throw sinRed();
    };
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "ya-hay", id: "ord_nueva_0000aaaa" });
    expect(a.anular).not.toHaveBeenCalled();
    ordenes = [];
    h.impl.createRampOrder = async () => {
      throw sinRed();
    };
    const b = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, b)).toEqual({ estado: "sin-red" });
    expect(b.anular).toHaveBeenCalledTimes(1);
    let lecturas = 0;
    h.impl.listRampOrders = async () => (++lecturas === 1 ? { orders: [], nextCursor: null } : { orders: [{ id: 3 }] });
    const c = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, c)).toEqual({ estado: "sin-red" });
    expect(c.anular).not.toHaveBeenCalled();
  });

  it("una orden creada sin id no se anula: puede haber un QR vivo", async () => {
    h.impl.createRampOrder = async () => ({ state: "awaiting_payment" });
    const a = aviso();
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "no-se-sabe" });
    expect(a.anular).not.toHaveBeenCalled();
  });

  it("una anulación que lanza no cambia lo que se devuelve", async () => {
    h.impl.createRampOrder = async () => {
      throw errorDelKit("SDK_RAMPS_QUOTE_EXPIRED");
    };
    const a = { avisar: vi.fn(async () => true as const), anular: vi.fn(async () => Promise.reject(new Error("boom"))) };
    expect(await pollarWallet.cargaCrearOrdenDeCompra(PRECIO, {}, a)).toEqual({ estado: "precio-vencido" });
  });
});

/* ------------------------------------------------------------------ seguirla, Ya pagué y las abiertas */

describe("seguir la orden, Ya pagué y las abiertas", () => {
  it("sigue la orden al ritmo del servidor y avisa cada cambio", async () => {
    const vistas: unknown[] = [];
    h.impl.pollRampOrder = async (_id: string, op: { onUpdate?: (o: unknown) => void }) => {
      op.onUpdate?.({ id: ORDEN, state: "processing" });
      op.onUpdate?.({ id: ORDEN, state: "completed" });
      return { id: ORDEN, state: "completed" };
    };
    const corte = new AbortController();
    expect(await pollarWallet.cargaSeguir(ORDEN, { signal: corte.signal, alCambiar: (o) => vistas.push(o) })).toEqual({ estado: "orden", orden: { id: ORDEN, state: "completed" } });
    expect(vistas).toHaveLength(2);
    expect((h.argumentos.pollRampOrder?.[0]?.[1] as { signal?: unknown }).signal).toBe(corte.signal);
  });

  it("al cerrar la ventana se corta, y una orden que ya no existe lo dice", async () => {
    h.impl.pollRampOrder = async (_id: string, op: { signal?: AbortSignal }) =>
      new Promise((_, rechazar) => {
        op.signal?.addEventListener("abort", () => rechazar(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    const corte = new AbortController();
    const seguir = pollarWallet.cargaSeguir(ORDEN, { signal: corte.signal });
    await tick();
    corte.abort();
    expect(await seguir).toEqual({ estado: "cortada" });
    h.impl.pollRampOrder = async () => {
      throw errorDelKit("SDK_RAMPS_TX_NOT_FOUND");
    };
    expect(await pollarWallet.cargaSeguir(ORDEN)).toEqual({ estado: "no-existe" });
  });

  it("Ya pagué pregunta por el pago como mucho una vez cada 10 segundos por orden", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T15:00:00.000Z"));
    h.impl.checkRampOrder = async (id: string) => ({ id, state: "processing" });
    expect(await pollarWallet.cargaYaPague(ORDEN)).toMatchObject({ estado: "orden" });
    expect(await pollarWallet.cargaYaPague(ORDEN)).toEqual({ estado: "pronto" });
    vi.setSystemTime(new Date(Date.now() + YA_PAGUE_CADA_MS - 1));
    expect(await pollarWallet.cargaYaPague(ORDEN)).toEqual({ estado: "pronto" });
    expect(await pollarWallet.cargaYaPague("ord_otra_11112222")).toMatchObject({ estado: "orden" });
    vi.setSystemTime(new Date(Date.now() + 1));
    expect(await pollarWallet.cargaYaPague(ORDEN)).toMatchObject({ estado: "orden" });
    expect(h.argumentos.checkRampOrder).toEqual([[ORDEN], ["ord_otra_11112222"], [ORDEN]]);
  });

  it("dos toques seguidos de Ya pagué preguntan una vez", async () => {
    h.impl.checkRampOrder = async (id: string) => ({ id, state: "processing" });
    const r = await Promise.all([pollarWallet.cargaYaPague(ORDEN), pollarWallet.cargaYaPague(ORDEN)]);
    expect(r.map((x) => x.estado).sort()).toEqual(["orden", "pronto"]);
    expect(cuantas("checkRampOrder")).toBe(1);
  });

  it("las abiertas: la que no terminó, ninguna, o no se sabe", async () => {
    ordenes = [ordenQueEspera()];
    expect(await pollarWallet.cargaAbiertas()).toEqual({ estado: "abierta", id: ORDEN, orden: ordenQueEspera() });
    expect(h.argumentos.listRampOrders).toEqual([[{ open: "true" }]]);
    ordenes = [];
    expect(await pollarWallet.cargaAbiertas()).toEqual({ estado: "ninguna" });
    h.impl.listRampOrders = async () => ({ nada: true });
    expect(await pollarWallet.cargaAbiertas()).toEqual({ estado: "no-se-sabe" });
    h.impl.listRampOrders = async () => {
      throw errorDelKit("SDK_CREDITS_INSUFFICIENT");
    };
    expect(await pollarWallet.cargaAbiertas()).toEqual({ estado: "sin-creditos" });
  });

  it("las cerradas: pide al kit las cerradas desde la fecha y devuelve la última que no terminó bien", async () => {
    const desde = Date.parse("2026-11-09T00:00:00.000Z");
    const fallida = ordenEsperandoPago({ id: "ord_fallida_0000bbbb", state: "failed", createdAt: "2026-11-16T15:10:00.000Z" });
    const vieja = ordenEsperandoPago({ id: "ord_vieja_0000cccc", state: "refunded", createdAt: "2026-11-01T15:10:00.000Z" });
    ordenes = [ordenQueEspera({ state: "completed", createdAt: "2026-11-16T14:00:00.000Z" }), fallida, vieja];
    expect(await pollarWallet.cargaCerradas(desde)).toEqual({ estado: "cerrada", id: "ord_fallida_0000bbbb", orden: fallida });
    expect(h.argumentos.listRampOrders?.[0]).toEqual([{ open: "false", since: "2026-11-09T00:00:00.000Z", limit: 20 }]);
    // La última cerrada terminó bien: ninguna.
    ordenes = [fallida, ordenQueEspera({ state: "completed", createdAt: "2026-11-16T16:00:00.000Z" })];
    expect(await pollarWallet.cargaCerradas(desde)).toEqual({ estado: "ninguna" });
    // Lo que no se lee no inventa una cerrada, y un error del kit vuelve como una palabra.
    h.impl.listRampOrders = async () => ({ nada: true });
    expect(await pollarWallet.cargaCerradas(desde)).toEqual({ estado: "ninguna" });
    h.impl.listRampOrders = async () => {
      throw sinRed();
    };
    expect(await pollarWallet.cargaCerradas(desde)).toEqual({ estado: "sin-red" });
    // Solo lee.
    nadaQueVote();
    expect(h.llamadas).not.toContain("createRampOrder");
  });

  it("leer una orden: la orden, o que ya no existe", async () => {
    expect(await pollarWallet.cargaLeerOrden(ORDEN)).toEqual({ estado: "orden", orden: ordenQueEspera() });
    expect(await pollarWallet.cargaLeerOrden("ord_que_no_esta")).toEqual({ estado: "no-existe" });
  });
});

/* ------------------------------------------------------------------ aprobar un paso */

describe("Aprobar: leer, revisar esa misma versión y recién ahí votar", () => {
  it("lee la orden y el pedido, lo pide de nuevo una vez, pasa la regla y estampa la propuesta de verify", async () => {
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "aprobado", que: "permiso-cambio", dolares: 24.9 });
    expect(h.llamadas.filter((n) => ["getRampOrder", "get", "recovery.status", "refresh", "verify", "relay"].includes(n))).toEqual(["getRampOrder", "get", "recovery.status", "refresh", "verify", "relay"]);
    expect(h.argumentos.verify?.[0]?.[0]).toBe(refrescado);
    const verificacion = await kitReal.verify(refrescado as unknown as CosignRequest);
    if (!verificacion.ok) throw new Error(verificacion.reason);
    const [ruta, cuerpo, opciones] = h.argumentos.relay?.[0] ?? [];
    expect(ruta).toBe("/public/v1/submit/sign_transaction");
    expect((cuerpo as { parameters: unknown }).parameters).toEqual(verificacion.proposal.body.parameters);
    expect(opciones).toEqual({ requestId: PEDIDO });
  });

  it("usa el candado de la carga", async () => {
    const candado = vi.spyOn(navigator.locks, "request");
    await pollarWallet.cargaAprobar(ORDEN, PEDIDO);
    expect(candado.mock.calls.map((c) => c[0])).toContain(CANDADO_DE_LA_CARGA);
  });

  it("dos toques de Aprobar votan una vez", async () => {
    const [a, b] = await Promise.all([pollarWallet.cargaAprobar(ORDEN, PEDIDO), pollarWallet.cargaAprobar(ORDEN, PEDIDO)]);
    expect(b).toBe(a);
    expect(votos()).toBe(1);
    // Y el toque que llega después lee el pedido ya votado: no vota otra vez.
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toMatchObject({ estado: "cambio" });
    expect(votos()).toBe(1);
  });

  it("dos pestañas votan una vez: la segunda espera el candado y lee el pedido ya votado", async () => {
    vi.resetModules();
    const { pollarWallet: otraPestana } = await import("./wallet-pollar");
    otraPestana.address = CUENTA;
    const r = await Promise.all([pollarWallet.cargaAprobar(ORDEN, PEDIDO), otraPestana.cargaAprobar(ORDEN, PEDIDO)]);
    expect(votos()).toBe(1);
    expect(r.map((x) => x.estado).sort()).toEqual(["aprobado", "cambio"]);
    await otraPestana.disconnect();
  });

  it("un toque viejo no aprueba el paso siguiente: si la orden espera otro pedido, no vota", async () => {
    orden = ordenQueEspera({ pendingAction: { kind: "COSIGN_APPROVAL", actionId: "act-2", legIndex: 1, cosignRequestId: "cos-2", summary: "Approve" } });
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toMatchObject({ estado: "cambio" });
    expect(h.llamadas).not.toContain("get");
    nadaQueVote();
  });

  it("una orden que no espera una aprobación no se vota", async () => {
    orden = ordenEsperandoPago({ id: ORDEN });
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toMatchObject({ estado: "cambio" });
    nadaQueVote();
  });

  it("un pedido ya votado no se vota otra vez", async () => {
    pedido = { ...pedido, activityId: "actividad-de-otro-toque" };
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toMatchObject({ estado: "cambio" });
    nadaQueVote();
  });

  it("la regla no reconoce el paso: no vota, y el motivo no lleva cuentas", async () => {
    pedido = pedidoDePermiso(DE_OTRO);
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "raro", motivo: "fuera de la lista" });
    expect(h.llamadas).not.toContain("verify");
    expect(votos()).toBe(0);
    const avisos = JSON.stringify(vi.mocked(console.warn).mock.calls);
    for (const x of [CUENTA, PASO_DE_ANA, DE_OTRO]) expect(avisos).not.toContain(x);
  });

  it("una propuesta que no es la transacción revisada no se estampa", async () => {
    h.impl.verify = async (r: CosignRequest) => {
      const v = await kitReal.verify(r);
      if (!v.ok) return v;
      const body = v.proposal.body as { parameters: Record<string, unknown> };
      return { ...v, proposal: { ...v.proposal, body: { ...body, parameters: { ...body.parameters, unsignedTransaction: "02ff" } } } };
    };
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "raro", motivo: "otra transacción" });
    expect(votos()).toBe(0);
  });

  it("si la cuenta de la sesión cambió mientras se revisaba, no vota", async () => {
    h.impl.verify = async (r: CosignRequest) => {
      pollarWallet.address = OTRA_CUENTA;
      return kitReal.verify(r);
    };
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "sin-cuenta" });
    expect(votos()).toBe(0);
  });

  it("dos aprobaciones falladas cortan: la tercera no llama a nada", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...structuredClone(refrescado ?? pedido), status: "REJECTED", activityId: "act" } });
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "no-salio" });
    h.impl.relay = async () => {
      throw new Error("upstream");
    };
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "no-salio" });
    const antes = h.llamadas.length;
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "tope" });
    expect(h.llamadas.slice(antes).filter((n) => n !== "ready")).toEqual([]);
    expect(TOPE_DE_APROBACIONES_FALLADAS).toBe(2);
  });

  it("el tope es de la pestaña: sobrevive a recargar la página y se borra al cerrar sesión", async () => {
    h.impl.relay = async () => {
      throw new Error("upstream");
    };
    await pollarWallet.cargaAprobar(ORDEN, PEDIDO);
    await pollarWallet.cargaAprobar(ORDEN, PEDIDO);
    expect(sessionStorage.getItem(MARCA_DE_APROBACIONES)).not.toBeNull();
    vi.resetModules();
    const { pollarWallet: recargada } = await import("./wallet-pollar");
    recargada.address = CUENTA;
    expect(await recargada.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "tope" });
    await recargada.disconnect();
    expect(sessionStorage.getItem(MARCA_DE_APROBACIONES)).toBeNull();
  });

  it("un 402 no cuenta como falla: sin créditos, se puede volver a aprobar", async () => {
    h.impl.relay = async () => {
      throw errorDelKit("SDK_CREDITS_INSUFFICIENT");
    };
    for (let i = 0; i < 3; i++) expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "sin-creditos" });
    h.impl.get = async () => {
      throw errorDelKit("SDK_CREDITS_INSUFFICIENT");
    };
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "sin-creditos" });
    expect(votos()).toBe(3);
    expect(sessionStorage.getItem(MARCA_DE_APROBACIONES)).toBeNull();
  });

  it("si el voto salió y todavía no se cerró, queda enviado", async () => {
    h.impl.relay = async () => ({ status: 200, body: {}, request: { ...structuredClone(refrescado ?? pedido), activityId: "act" } });
    h.impl.settle = async (r: unknown) => r;
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "enviado" });
  });

  it("un voto que llega cuando el pedido ya no espera se lee, no se vuelve a mandar", async () => {
    h.impl.relay = async () => {
      throw errorDelKit("SDK_COSIGN_REQUEST_NOT_PENDING");
    };
    h.impl.get = async (_id: string, op?: { sync?: boolean }) => (op?.sync ? { ...structuredClone(pedido), status: "APPROVED", activityId: "act" } : structuredClone(pedido));
    expect(await pollarWallet.cargaAprobar(ORDEN, PEDIDO)).toEqual({ estado: "aprobado", que: "permiso-cambio", dolares: 24.9 });
    expect(votos()).toBe(1);
  });
});

/* ------------------------------------------------------------------ nunca se vota al abrir ni al volver */

describe("nunca se vota al abrir ni al volver", () => {
  it("leer lo que se aprueba dice qué y cuánto, sin pedir de nuevo ni votar", async () => {
    expect(await pollarWallet.cargaRevisarPaso(ORDEN, PEDIDO)).toEqual({ estado: "revisado", que: "permiso-cambio", dolares: 24.9 });
    pedido = pedidoDePermiso(DE_OTRO);
    expect(await pollarWallet.cargaRevisarPaso(ORDEN, PEDIDO)).toEqual({ estado: "raro", motivo: "fuera de la lista" });
    expect(await pollarWallet.cargaRevisarPaso(ORDEN, "cos-otro")).toMatchObject({ estado: "cambio" });
    nadaQueVote();
  });

  it("abrir la ventana, retomar la carga, seguirla, Ya pagué y volver a la pestaña, con un paso esperando", async () => {
    ordenes = [ordenQueEspera()];
    h.impl.pollRampOrder = async () => ordenQueEspera();
    h.impl.checkRampOrder = async () => ordenQueEspera();
    await pollarWallet.cargaAbiertas();
    await pollarWallet.cargaLeerOrden(ORDEN);
    await pollarWallet.cargaSeguir(ORDEN);
    await pollarWallet.cargaYaPague(ORDEN);
    await pollarWallet.cargaRevisarPaso(ORDEN, PEDIDO);
    // Volver: otra pestaña avisa que la cuenta cambió, y el kit avisa la billetera y la co-firma.
    let avisos = 0;
    const soltar = pollarWallet.alCambiarLaCuenta(() => {
      avisos++;
    });
    await tick();
    billetera.avisarCambioDeLaCuenta();
    for (const cb of h.oyentes.billetera) cb("READY");
    await new Promise((r) => setTimeout(r, 20));
    soltar();
    expect(avisos).toBeGreaterThan(0);
    nadaQueVote();
  });

  it("reintentar una carga frenada no aprueba nada", async () => {
    orden = ordenFrenada();
    h.impl.retryRampOrder = async () => ordenQueEspera();
    expect(await pollarWallet.cargaReintentar(ORDEN)).toEqual({ estado: "orden", orden: ordenQueEspera() });
    nadaQueVote();
  });
});

/* ------------------------------------------------------------------ reintentar */

describe("Probar de nuevo una carga frenada", () => {
  it("solo la que destraba la persona: una que no está frenada no se reintenta", async () => {
    h.impl.retryRampOrder = async () => ordenQueEspera();
    expect(await pollarWallet.cargaReintentar(ORDEN)).toMatchObject({ estado: "cambio" });
    const deOtro = ordenFrenada();
    orden = { ...deOtro, failure: { ...(deOtro.failure as object), resolutionOwner: "POLLAR" } };
    expect(await pollarWallet.cargaReintentar(ORDEN)).toMatchObject({ estado: "cambio" });
    expect(h.llamadas).not.toContain("retryRampOrder");
  });

  it("dos toques reintentan una vez, y un 402 es de Tinkazo", async () => {
    orden = ordenFrenada();
    h.impl.retryRampOrder = async () => ordenQueEspera();
    const [a, b] = await Promise.all([pollarWallet.cargaReintentar(ORDEN), pollarWallet.cargaReintentar(ORDEN)]);
    expect(b).toBe(a);
    expect(cuantas("retryRampOrder")).toBe(1);
    h.impl.retryRampOrder = async () => {
      throw errorDelKit("SDK_CREDITS_INSUFFICIENT");
    };
    expect(await pollarWallet.cargaReintentar(ORDEN)).toEqual({ estado: "sin-creditos" });
  });
});
