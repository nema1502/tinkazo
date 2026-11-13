import { Account, Asset, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOLAR_DIGITAL } from "./pago-con-saldo";

/**
 * Pagar un paquete con el saldo de la cuenta (`pagarOrden` de `PollarWallet`), con un cliente que se porta como el de
 * `@pollar/core` 0.12.0 en lo que se usa (`buildTx`, `signTx` con su confirmación, `submitTx`; ver index.mjs). Nunca se
 * llama al proveedor ni a la red, y no se mueve plata. Lo que se fija:
 *
 * - el proveedor arma el pago con los datos de la orden, y solo si es exactamente ese pago la puerta deja firmarlo;
 * - lo firmado se revisa otra vez y tiene que venir con la comisión a cargo de otra cuenta, o no se manda;
 * - se manda una vez, y lo que no se sabe si salió no se vuelve a armar hasta que ya no pueda entrar.
 */

const RED = Networks.PUBLIC;
const llave = (n: number): Keypair => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n));
const PERSONA = llave(1).publicKey();
const COBROS = llave(2).publicKey();
const OTRA = llave(3).publicKey();
const PATROCINA = llave(4).publicKey();
const NOTA = "tk:o:ABCD2345";
const USDC = new Asset(DOLAR_DIGITAL.code, DOLAR_DIGITAL.issuer);
const ORDEN = { destino: COBROS, monto: "3", nota: NOTA };

const h = vi.hoisted(() => {
  type Pend = { id: string; kind: string; unsignedXdr?: string; confirm: () => void; reject: () => void };
  const estado = {
    red: { name: "mainnet" as "mainnet" | "testnet", networkPassphrase: "Public Global Stellar Network ; September 2015" },
    oyentes: new Set<(p: Pend[]) => void>(),
    pendientes: new Map<string, Pend>(),
    contador: 0,
    registro: [] as string[],
    llamadas: [] as string[],
    argumentos: {} as Record<string, unknown[][]>,
    construidos: 0,
    direccion: "",
    redDelCliente: "mainnet",
    /** Lo que arma el proveedor con lo que se le pidió (por defecto, el pago exacto). */
    armar: null as null | ((params: Record<string, unknown>, opts: Record<string, unknown>) => unknown),
    /** Lo que devuelve la firma de lo armado (por defecto, envuelto: la app paga la comisión). */
    firmar: null as null | ((xdr: string) => unknown),
    /** Otras confirmaciones que aparecen mientras se firma. */
    extras: [] as Array<{ kind: string; unsignedXdr?: string }>,
    envio: null as null | (() => unknown),
  };
  const emitir = (): void => {
    const lista = [...estado.pendientes.values()];
    for (const cb of estado.oyentes) cb(lista);
  };
  const pedir = (input: { kind: string; unsignedXdr?: string }): Promise<{ ok: boolean; code?: string }> => {
    if (estado.oyentes.size === 0) return Promise.resolve({ ok: false, code: "SDK_CONFIRMATION_UNAVAILABLE" });
    const id = `c${++estado.contador}`;
    return new Promise((resolver) => {
      const resolverCon = (r: { ok: boolean; code?: string }, que: string) => () => {
        if (!estado.pendientes.delete(id)) return;
        estado.registro.push(`${que}:${input.kind}:${input.unsignedXdr === undefined ? "" : input.unsignedXdr.slice(-12)}`);
        emitir();
        resolver(r);
      };
      estado.pendientes.set(id, { ...input, id, confirm: resolverCon({ ok: true }, "confirmada"), reject: resolverCon({ ok: false, code: "SDK_CONFIRMATION_DECLINED" }, "rechazada") });
      emitir();
    });
  };
  const anotar = (nombre: string, args: unknown[]): void => {
    estado.llamadas.push(nombre);
    (estado.argumentos[nombre] ??= []).push(args);
  };
  return { estado, pedir, anotar };
});

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.estado.red }));
vi.mock("@pollar/core", () => ({
  PollarClient: class {
    constructor() {
      h.estado.construidos++;
    }
    onConfirmationRequest(cb: (p: unknown[]) => void): () => void {
      h.estado.oyentes.add(cb as never);
      cb([...h.estado.pendientes.values()]);
      return () => h.estado.oyentes.delete(cb as never);
    }
    getWallet(): { address: string } | null {
      return h.estado.direccion ? { address: h.estado.direccion } : null;
    }
    getNetwork(): string {
      return h.estado.redDelCliente;
    }
    async logout(): Promise<void> {}
    async buildTx(operation: string, params: Record<string, unknown>, opts: Record<string, unknown>): Promise<unknown> {
      h.anotar("buildTx", [operation, params, opts]);
      const r = h.estado.armar ? h.estado.armar(params, opts) : pagoDe(params, opts);
      if (typeof r !== "string") return r;
      return { status: "built", buildData: { unsignedXdr: r, networkPassphrase: "x", estimatedFee: "100", summary: { title: "", lines: [], network: "", fee: "" } } };
    }
    async signTx(xdr: string, opts?: unknown): Promise<unknown> {
      h.anotar("signTx", [xdr, opts]);
      for (const extra of h.estado.extras) void h.pedir(extra);
      const r = await h.pedir({ kind: "sign", unsignedXdr: xdr });
      if (!r.ok) return { status: "error", code: r.code };
      return h.estado.firmar ? h.estado.firmar(xdr) : { status: "signed", signedXdr: envolver(xdr), submissionToken: "tok-1", sponsored: true };
    }
    async submitTx(xdr: string, opts?: unknown): Promise<unknown> {
      h.anotar("submitTx", [xdr, opts]);
      return h.estado.envio ? h.estado.envio() : { status: "success", hash: "ab".repeat(32) };
    }
  },
}));

/** Lo que armaría el proveedor con lo pedido: el pago, de la cuenta de la sesión, con la nota y el vencimiento pedidos. */
function pagoDe(params: Record<string, unknown>, opts: Record<string, unknown>, cambios: { destino?: string; monto?: string; activo?: Asset; nota?: Memo | null; ops?: unknown[]; fuente?: string } = {}): string {
  const asset = params.asset as { code: string; issuer: string };
  const b = new TransactionBuilder(new Account(cambios.fuente ?? PERSONA, "100"), { fee: "100", networkPassphrase: RED });
  const ops = cambios.ops ?? [Operation.payment({ destination: cambios.destino ?? String(params.destination), asset: cambios.activo ?? new Asset(asset.code, asset.issuer), amount: cambios.monto ?? String(params.amount) })];
  for (const op of ops) b.addOperation(op as ReturnType<typeof Operation.payment>);
  const memo = cambios.nota === undefined ? Memo.text(String((opts.memo as { value: string }).value)) : cambios.nota;
  if (memo) b.addMemo(memo);
  return b.setTimeout(Number(opts.timeoutSec)).build().toXDR();
}

function envolver(xdr: string, paga = PATROCINA): string {
  const t = TransactionBuilder.fromXDR(xdr, RED);
  return TransactionBuilder.buildFeeBumpTransaction(paga, "200", t as Parameters<typeof TransactionBuilder.buildFeeBumpTransaction>[2], RED).toXDR();
}

function enMemoria(): Storage {
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

const { pollarWallet } = await import("./wallet-pollar");
const e = h.estado;
const veces = (nombre: string): number => e.llamadas.filter((x) => x === nombre).length;

beforeEach(() => {
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubGlobal("localStorage", enMemoria());
  vi.stubGlobal("sessionStorage", enMemoria());
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  e.red.name = "mainnet";
  e.oyentes.clear();
  e.pendientes.clear();
  e.registro = [];
  e.llamadas = [];
  e.argumentos = {};
  e.construidos = 0;
  e.direccion = PERSONA;
  e.redDelCliente = "mainnet";
  e.armar = null;
  e.firmar = null;
  e.extras = [];
  e.envio = null;
  pollarWallet.address = PERSONA;
});
afterEach(async () => {
  await pollarWallet.disconnect();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el pago exacto de la orden", () => {
  it("lo arma el proveedor con los datos de la orden, se confirma solo ese, se firma con el patrocinio y se manda una vez", async () => {
    const r = await pollarWallet.pagarOrden(ORDEN);
    expect(r).toEqual({ estado: "salio", hash: "ab".repeat(32) });
    expect(e.argumentos.buildTx).toEqual([
      ["payment", { destination: COBROS, amount: "3.0000000", asset: { type: "credit_alphanum4", code: "USDC", issuer: DOLAR_DIGITAL.issuer } }, { memo: { type: "text", value: NOTA }, timeoutSec: 180 }],
    ]);
    const xdr = (e.argumentos.signTx?.[0] as unknown[])[0] as string;
    // Con el patrocinio: no se le pide al proveedor que lo firme sin él.
    expect((e.argumentos.signTx?.[0] as unknown[])[1]).toBeUndefined();
    expect(e.registro).toEqual([`confirmada:sign:${xdr.slice(-12)}`]);
    expect(e.argumentos.submitTx).toEqual([[envolver(xdr), { submissionToken: "tok-1" }]]);
  });

  it("dos toques a la vez son un solo pago", async () => {
    const [a, b] = await Promise.all([pollarWallet.pagarOrden(ORDEN), pollarWallet.pagarOrden(ORDEN)]);
    expect(a).toEqual(b);
    expect(veces("buildTx")).toBe(1);
    expect(veces("submitTx")).toBe(1);
  });

  it("otra firma que llega mientras se paga se rechaza, y el pago sale igual", async () => {
    e.extras = [{ kind: "sign", unsignedXdr: "OTRA-TRANSACCION" }, { kind: "build_sign_submit" }];
    expect((await pollarWallet.pagarOrden(ORDEN)).estado).toBe("salio");
    expect(e.registro.filter((x) => x.startsWith("rechazada"))).toHaveLength(2);
    expect(e.registro.filter((x) => x.startsWith("confirmada"))).toHaveLength(1);
  });

  it("después de pagar, el mismo XDR ya no se confirma solo", async () => {
    await pollarWallet.pagarOrden(ORDEN);
    const xdr = (e.argumentos.signTx?.[0] as unknown[])[0] as string;
    e.registro = [];
    void h.pedir({ kind: "sign", unsignedXdr: xdr });
    expect(e.registro).toEqual([`rechazada:sign:${xdr.slice(-12)}`]);
  });
});

describe("lo que armó el proveedor no es el pago de la orden: no se firma", () => {
  const variantes: Array<[string, (params: Record<string, unknown>, opts: Record<string, unknown>) => string]> = [
    ["otro destino", (p, o) => pagoDe(p, o, { destino: OTRA })],
    ["un monto mayor", (p, o) => pagoDe(p, o, { monto: "30" })],
    ["otro activo", (p, o) => pagoDe(p, o, { activo: new Asset("USDC", OTRA) })],
    ["la moneda de la red", (p, o) => pagoDe(p, o, { activo: Asset.native() })],
    ["sin nota", (p, o) => pagoDe(p, o, { nota: null })],
    ["otra nota", (p, o) => pagoDe(p, o, { nota: Memo.text("tk:o:ZZZZ9999") })],
    ["dos operaciones", (p, o) => pagoDe(p, o, { ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3" }), Operation.payment({ destination: OTRA, asset: USDC, amount: "3" })] })],
    ["una operación que no es un pago", (p, o) => pagoDe(p, o, { ops: [Operation.setOptions({ signer: { ed25519PublicKey: OTRA, weight: 1 } })] })],
    ["desde otra cuenta", (p, o) => pagoDe(p, o, { fuente: OTRA })],
    ["algo que no se lee", () => "esto no es una transacción"],
  ];
  for (const [que, armar] of variantes) {
    it(que, async () => {
      e.armar = armar;
      expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "regla" });
      expect(veces("signTx")).toBe(0);
      expect(veces("submitTx")).toBe(0);
      expect(e.registro).toEqual([]);
      expect(vi.mocked(console.warn).mock.calls.map((c) => String(c[0])).join(" ")).toContain("pago con saldo no aprobado");
      // Lo que se anota no lleva cuentas ni la nota.
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/G[A-Z2-7]{55}|tk:o:/);
    });
  }

  it("una orden sin forma ni se le pide al proveedor", async () => {
    for (const o of [{ ...ORDEN, destino: PERSONA }, { ...ORDEN, destino: "x" }, { ...ORDEN, monto: "0" }, { ...ORDEN, nota: "" }]) {
      expect(await pollarWallet.pagarOrden(o)).toEqual({ estado: "no-salio", motivo: "regla" });
    }
    expect(veces("buildTx")).toBe(0);
  });
});

describe("lo firmado se revisa antes de mandarlo", () => {
  it("sin envolver, la comisión la pagaría la persona: no se manda", async () => {
    e.firmar = (xdr) => ({ status: "signed", signedXdr: xdr });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-patrocinio" });
    expect(veces("submitTx")).toBe(0);
  });

  it("envuelto con la comisión a cargo de la misma persona: no se manda", async () => {
    e.firmar = (xdr) => ({ status: "signed", signedXdr: envolver(xdr, PERSONA) });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-patrocinio" });
    expect(veces("submitTx")).toBe(0);
  });

  it("si lo firmado trae otro pago adentro, no se manda", async () => {
    e.firmar = () => ({ status: "signed", signedXdr: envolver(pagoDe({ destination: OTRA, amount: "3", asset: DOLAR_DIGITAL }, { memo: { value: NOTA }, timeoutSec: 180 })) });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("submitTx")).toBe(0);
  });
});

describe("cada falla con su motivo", () => {
  it("la persona no lo aprobó: cancelado, y nada se manda", async () => {
    e.firmar = () => ({ status: "error", code: "SDK_CONFIRMATION_DECLINED" });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "cancelado" });
    expect(veces("submitTx")).toBe(0);
  });

  it("el proveedor no armó el pago: no salió nada, y se puede probar de nuevo", async () => {
    e.armar = () => ({ status: "error", code: "TX_BUILD_FAILED" });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "red" });
    expect(veces("signTx")).toBe(0);
    e.armar = null;
    expect((await pollarWallet.pagarOrden(ORDEN)).estado).toBe("salio");
  });

  it("una co-firma que quedó pendiente no se manda: no salió", async () => {
    e.firmar = () => ({ status: "cosign_pending", request: { id: "x" } });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "red" });
    expect(veces("submitTx")).toBe(0);
  });

  it("la red dijo que no alcanza el saldo, o que falta la línea", async () => {
    e.envio = () => ({ status: "error", resultCode: "txFailed", details: "txFailed", code: "TX_INSUFFICIENT_BALANCE", message: "paymentUnderfunded" });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-saldo" });
    e.envio = () => ({ status: "error", resultCode: "txFailed", details: "paymentSrcNoTrust" });
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-linea" });
    // Rechazado por la red: esa transacción no entra, así que se puede volver a armar.
    expect(veces("buildTx")).toBe(2);
  });
});

describe("no se sabe si salió: no se manda de nuevo", () => {
  it("la red no contestó a tiempo: incierto, y la misma orden no se vuelve a armar hasta que el pago ya no pueda entrar", async () => {
    e.envio = () => ({ status: "pending", hash: "cd".repeat(32) });
    const r = await pollarWallet.pagarOrden(ORDEN);
    expect(r.estado).toBe("incierto");
    const vence = (r as { vence: number }).vence;
    const ahora = Math.floor(Date.now() / 1000);
    expect(vence).toBeGreaterThan(ahora);
    expect(vence).toBeLessThanOrEqual(ahora + 600 + 60);
    // Otro toque, o la otra pestaña: no arma nada.
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "incierto", vence });
    expect(veces("buildTx")).toBe(1);
    // Pasado el vencimiento (y su margen), recién ahí se puede armar otro.
    vi.spyOn(Date, "now").mockReturnValue((vence + 1) * 1000);
    e.envio = null;
    expect((await pollarWallet.pagarOrden(ORDEN)).estado).toBe("salio");
    expect(veces("buildTx")).toBe(2);
  });

  it("se cortó al mandar, o el error no dice que la red lo rechazó: incierto", async () => {
    e.envio = () => Promise.reject(new TypeError("Failed to fetch"));
    expect((await pollarWallet.pagarOrden(ORDEN)).estado).toBe("incierto");
    localStorage.clear();
    e.envio = () => ({ status: "error", details: "Failed to fetch" });
    expect((await pollarWallet.pagarOrden({ ...ORDEN, nota: "tk:o:WXYZ6789" })).estado).toBe("incierto");
    expect(veces("submitTx")).toBe(2);
  });

  /** La compra con QR en el build y a la vista: la compra, el pago con el saldo y su bandera, con el portero de la red principal y la venta abierta. */
  const conLaCompraQr = (): void => {
    for (const [k, v] of Object.entries({ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.example.org", VITE_ALTA_PAGO: "1", VITE_PAGO_CON_SALDO: "1", VITE_COMPRA_QR: "1", VITE_VENTA_ABIERTA: "1" })) vi.stubEnv(k, v);
  };
  const SECUENCIA = [
    { status: "error", resultCode: "txBadSeq", details: "txBadSeq" },
    { status: "error", code: "TX_BAD_SEQUENCE", message: "Something went out of sync. Please try again." },
    { status: "error", resultCode: "tx_bad_seq" },
  ];

  it("la secuencia corrida, sin la compra con QR en el build: no salió, como siempre", async () => {
    for (const [i, codigos] of SECUENCIA.entries()) {
      localStorage.clear();
      e.envio = () => codigos;
      expect(await pollarWallet.pagarOrden({ ...ORDEN, nota: `tk:o:SEQ${i}WXYZ` })).toEqual({ estado: "no-salio", motivo: "rechazado" });
    }
  });

  it("la secuencia corrida no dice que no entró: incierto, y un segundo pago con la misma nota no se arma", async () => {
    conLaCompraQr();
    for (const [i, codigos] of [
      { status: "error", resultCode: "txBadSeq", details: "txBadSeq" },
      { status: "error", code: "TX_BAD_SEQUENCE", message: "Something went out of sync. Please try again." },
      { status: "error", resultCode: "tx_bad_seq" },
    ].entries()) {
      localStorage.clear();
      const orden = { ...ORDEN, nota: `tk:o:SEQ${i}ABCD` };
      e.envio = () => codigos;
      expect((await pollarWallet.pagarOrden(orden)).estado).toBe("incierto");
      const armados = veces("buildTx");
      expect((await pollarWallet.pagarOrden(orden)).estado).toBe("incierto");
      expect(veces("buildTx")).toBe(armados);
    }
  });

  it("otra orden no queda frenada por la marca de esta", async () => {
    e.envio = () => ({ status: "pending", hash: "cd".repeat(32) });
    await pollarWallet.pagarOrden(ORDEN);
    e.envio = null;
    expect((await pollarWallet.pagarOrden({ ...ORDEN, nota: "tk:o:WXYZ6789" })).estado).toBe("salio");
  });
});

describe("sin la cuenta de la sesión en la red principal, nada", () => {
  it("fuera de la red principal no arma el cliente", async () => {
    e.red.name = "testnet";
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-cuenta" });
    expect(e.construidos).toBe(0);
  });

  it("si el kit tiene otra cuenta, o el cliente es de otra red, no se arma nada", async () => {
    e.direccion = OTRA;
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-cuenta" });
    e.direccion = PERSONA;
    e.redDelCliente = "testnet";
    expect(await pollarWallet.pagarOrden(ORDEN)).toEqual({ estado: "no-salio", motivo: "sin-cuenta" });
    expect(veces("buildTx")).toBe(0);
  });
});
