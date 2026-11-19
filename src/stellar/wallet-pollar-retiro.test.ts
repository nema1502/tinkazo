import { Account, Asset, Keypair, Memo, Networks, Operation, StrKey, type Transaction, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import type { CosignRequest } from "@pollar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "./errores";
import { USDC_MAINNET } from "./pagos";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * El retiro desde una cuenta de Google (`retirar` de `wallet-pollar.ts`): lo que armó Mandar pasa la regla del retiro con
 * el costo y la cuenta de cobros de la configuración, se firma con el voto por contenido sin el patrocinio del proveedor
 * y lo firmado va al servicio de comisiones, que paga la comisión de la red. Nunca vuelve al envío del proveedor.
 *
 * Con el cliente de mentira (`pollar-falso.ts`), el `CosignManager` de verdad del kit para `verify`, y el servicio de
 * comisiones y la red de mentira por `fetch`. Sin reloj real: la hora es fija. En cada caso: nunca se llama a `approve`,
 * `cancel` ni a firmar y mandar por el proveedor, y `reject` solo donde la prueba lo pide.
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, MARCA_DEL_RETIRO, leerMarcaDeLaCuenta } = await import("./wallet-pollar");
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
const DESTINO = Keypair.random().publicKey();
const COBROS = Keypair.random().publicKey();
const SUB = "sub-org-de-la-cuenta";
const CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(7));
const ID = "pedido-1";
const PORTERO = "https://portero.prueba";
/** La hora fija de las pruebas, en segundos: lo armado vence a los 240 segundos de esta hora. */
const AHORA = 1_800_000_000;
const D = 10_000_000n;
const usdc = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);

/** Un retiro como lo arma Mandar: sale 12,50 de la cuenta, llegan 12 al destino y 0,50 van a la cuenta de cobros. */
function armarRetiro(o: { llega?: string; costo?: string; aCobros?: string; alReves?: boolean; secuencia?: string; nota?: Memo } = {}): Transaction {
  const b = new TransactionBuilder(new Account(P, o.secuencia ?? "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC });
  const persona_ = Operation.payment({ destination: DESTINO, asset: usdc, amount: o.llega ?? "12.0000000" });
  const costo = Operation.payment({ destination: o.aCobros ?? COBROS, asset: usdc, amount: o.costo ?? "0.5000000" });
  for (const op of o.alReves ? [costo, persona_] : [persona_, costo]) b.addOperation(op);
  return b
    .addMemo(o.nota ?? Memo.text("tkz-retiro"))
    .setTimeout(240)
    .build();
}
/** Lo que pide la ventana: a quién, cuánto sale y la nota que pegó la persona. */
const PEDIDO = { destino: DESTINO, sale: 125n * (D / 10n), nota: { tipo: "ninguna" as const } };

const hashDe = (t: { hash(): Uint8Array }): string => Buffer.from(t.hash()).toString("hex");
const firmada = (t: Transaction): string => {
  const copia = TransactionBuilder.fromXDR(t.toXDR(), Networks.PUBLIC) as Transaction;
  copia.sign(persona);
  return copia.toXDR();
};

type Pedido = Record<string, unknown> & { id: string };
function pedidoDe(t: Transaction, cambios: Partial<Pedido> = {}): Pedido {
  return {
    id: ID,
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "sign",
    account: P,
    signWith: P,
    refreshable: false,
    unsignedPayload: t.toXDR(),
    payloadHash: hashDe(t),
    activityId: null,
    subOrgId: SUB,
    ...cambios,
  };
}
const aprobado = (p: Pedido, extra: Partial<Pedido> = {}): Pedido => ({ ...p, status: "APPROVED", activityId: "actividad-1", ...extra });
function elKitDevuelve(pedido: Pedido): void {
  h.impl.signTx = async () => ({ status: "cosign_pending", request: structuredClone(pedido) });
}
/** La firma sale bien: el kit devuelve el pedido, el voto sale y lo firmado es la transacción `t`. */
function laFirmaSale(t: Transaction): void {
  const pedido = pedidoDe(t);
  elKitDevuelve(pedido);
  h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(pedido, { signedXdr: firmada(t) }) });
}

/* --------------------------------------------------------- el servicio de comisiones y la red, de mentira */

interface Respuesta {
  estado: number;
  cuerpo: unknown;
}
const servicio = {
  pagos: null as Record<string, unknown> | null,
  /** Lo que contesta cada pedido del pago, en orden. Sin respuesta en la fila, un corte. */
  respuestas: [] as Respuesta[],
  /** Lo que dice la red de cada hash. */
  enLaRed: new Map<string, Respuesta>(),
};
const pedidosAlPago: Array<{ forma: unknown; xdr: unknown }> = [];
const consultasAlCupo: string[] = [];
const consultasALaRed: string[] = [];
const pagosDeSiempre = (): Record<string, unknown> => ({
  premio: true,
  retiro: true,
  altaPremio: false,
  costoRetiro: { usdc: "0.50", monto: 5_000_000 },
  enCurso: null,
});
const tomado = (t: Transaction, estado = "ok"): Respuesta => ({
  estado: 200,
  cuerpo: { hash: hashDe(t), forma: "retiro", vence: AHORA + 240, status: "PENDING", estado },
});

const marcaViva = (): boolean => (leerMarcaDeLaCuenta(MARCA_DEL_RETIRO) ?? 0) > AHORA;
const veces = (nombre: string): number => h.llamadas.filter((n) => n === nombre).length;
const avisos = (): string => vi.mocked(console.warn).mock.calls.flat().map(String).join("\n");
/**
 * Espera a `p` con el reloj de mentira: lo adelanta de a medio segundo, dejando correr lo pendiente en cada paso, hasta
 * que termina. Así una espera de la billetera vence sin reloj de verdad, aunque se pida después de empezar.
 */
async function conElReloj<T>(p: Promise<T>): Promise<T> {
  let listo = false;
  void p.then(
    () => {
      listo = true;
    },
    () => {
      listo = true;
    },
  );
  for (let i = 0; i < 400 && !listo; i++) await vi.advanceTimersByTimeAsync(500);
  return p;
}
let rechazoEsperado = false;
const dejarRechazar = (): void => {
  rechazoEsperado = true;
  h.impl.reject = async (id: string) => ({ id, status: "REJECTED" });
};

beforeEach(() => {
  reiniciar(h);
  h.red.contractId = CONTRATO;
  rechazoEsperado = false;
  servicio.pagos = pagosDeSiempre();
  servicio.respuestas = [];
  servicio.enLaRed = new Map();
  pedidosAlPago.length = 0;
  consultasAlCupo.length = 0;
  consultasALaRed.length = 0;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(new Date(AHORA * 1000));
  vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
  vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
  vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", PORTERO);
  vi.stubEnv("VITE_RETIRO_COSTO", "0.50");
  vi.stubEnv("VITE_RETIRO_CUENTA", COBROS);
  vi.stubGlobal("sessionStorage", almacenEnMemoria());
  vi.stubGlobal("localStorage", almacenEnMemoria());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const json = (r: Respuesta): Response => new Response(JSON.stringify(r.cuerpo), { status: r.estado });
      if (u.startsWith(`${PORTERO}/v1/patrocinio/cupo?`)) {
        consultasAlCupo.push(u);
        return json({ estado: 200, cuerpo: { red: "mainnet", rige: "portero", ...(servicio.pagos ? { pagos: servicio.pagos } : {}) } });
      }
      if (u === `${PORTERO}/v1/patrocinio/pago`) {
        pedidosAlPago.push(JSON.parse(String(init?.body)) as { forma: unknown; xdr: unknown });
        const r = servicio.respuestas.shift();
        if (!r) throw new TypeError("el servicio no contesta");
        return json(r);
      }
      const enLaRed = /\/transactions\/([0-9a-f]{64})$/.exec(u);
      if (enLaRed) {
        consultasALaRed.push(enLaRed[1] as string);
        return json(servicio.enLaRed.get(enLaRed[1] as string) ?? { estado: 404, cuerpo: { status: 404 } });
      }
      throw new TypeError("la prueba no conoce ese pedido");
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
  expect(h.llamadas).not.toContain("signAndSubmitTx");
  expect(h.llamadas).not.toContain("submitTx");
  if (!rechazoEsperado) expect(h.llamadas).not.toContain("reject");
  await pollarWallet.disconnect();
  h.red.contractId = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("cuándo no se arma nada", () => {
  it("fuera de la red principal no arma el cliente ni le pide nada a nadie", async () => {
    h.red.name = "testnet";
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("sin el voto por contenido no arma el cliente ni le pide nada a nadie", async () => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("sin el servicio de comisiones de la red principal no arma el cliente", async () => {
    vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", "");
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
  });

  it("sin el costo configurado no hay retiro: no se pide firma ni se pregunta al servicio", async () => {
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("con un kit que no vota a mano no se pide firma", async () => {
    h.kitTomaElVotoAMano = false;
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
  });
});

describe("la regla del retiro, antes de pedir nada", () => {
  it("un costo mayor que el configurado no pasa: sin firma y sin el servicio", async () => {
    const r = await pollarWallet.retirar(armarRetiro({ llega: "11.9900000", costo: "0.5100000" }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
    expect(consultasAlCupo).toEqual([]);
  });

  it("el costo a otra cuenta no pasa", async () => {
    const r = await pollarWallet.retirar(armarRetiro({ aCobros: Keypair.random().publicKey() }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });

  it("el orden al revés no pasa", async () => {
    const r = await pollarWallet.retirar(armarRetiro({ alReves: true }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });

  it("otra nota que la pedida no pasa", async () => {
    const r = await pollarWallet.retirar(armarRetiro({ nota: Memo.text("otra") }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
  });

  it("si lo que sale no deja llegar 1 dólar digital no pasa", async () => {
    const r = await pollarWallet.retirar(armarRetiro({ llega: "0.5000000" }).toXDR(), { ...PEDIDO, sale: D });
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
  });

  it("a la propia cuenta de cobros no es un retiro", async () => {
    const r = await pollarWallet.retirar(armarRetiro().toXDR(), { ...PEDIDO, destino: COBROS });
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });
});

describe("lo que se pregunta al servicio antes de firmar", () => {
  it("si el servicio no atiende retiros, no se pide la firma", async () => {
    servicio.pagos = { ...pagosDeSiempre(), retiro: false };
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
  });

  it("si el servicio exige otro costo que el configurado, no se pide la firma", async () => {
    servicio.pagos = { ...pagosDeSiempre(), costoRetiro: { usdc: "0.60", monto: 6_000_000 } };
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
  });

  it("un servicio sin el bloque de los pagos no recibe ninguna firma", async () => {
    servicio.pagos = null;
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
  });

  it("con otro pago de la cuenta en el aire que la red no cerró, no se pide la firma", async () => {
    servicio.pagos = { ...pagosDeSiempre(), enCurso: { hash: "c".repeat(64), forma: "retiro", vence: AHORA + 100 } };
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(consultasALaRed).toEqual(["c".repeat(64)]);
    expect(veces("signTx")).toBe(0);
  });

  it("un pago en el aire que la red ya cerró no frena", async () => {
    const t = armarRetiro();
    servicio.pagos = { ...pagosDeSiempre(), enCurso: { hash: "c".repeat(64), forma: "retiro", vence: AHORA + 100 } };
    servicio.enLaRed.set("c".repeat(64), { estado: 200, cuerpo: { hash: "c".repeat(64), successful: true } });
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
  });

  it("si el servicio no contesta, no se pide la firma", async () => {
    vi.stubEnv("VITE_PATROCINIO_URL_MAINNET", "https://otro.prueba");
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "red" });
    expect(veces("signTx")).toBe(0);
  });
});

describe("la firma y el servicio de comisiones", () => {
  it("lo que pasa se firma sin el patrocinio del proveedor y lo firmado va al servicio: sale con el hash", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(h.argumentos.signTx).toEqual([[t.toXDR(), { skipSponsorship: true }]]);
    expect(pedidosAlPago).toEqual([{ forma: "retiro", xdr: firmada(t) }]);
    expect(marcaViva()).toBe(false);
  });

  it("se vota con la intención de solo firmar, en el orden de siempre", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    await pollarWallet.retirar(t.toXDR(), PEDIDO);
    const voto = h.llamadas.filter((n) => ["signTx", "recovery.status", "verify", "relay"].includes(n));
    expect(voto).toEqual(["signTx", "recovery.status", "verify", "relay"]);
  });

  it("en camino se sigue en la red por el hash, sin volver a mandar", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t, "en-camino")];
    servicio.enLaRed.set(hashDe(t), { estado: 200, cuerpo: { hash: hashDe(t), successful: true } });
    expect(await conElReloj(pollarWallet.retirar(t.toXDR(), PEDIDO))).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(pedidosAlPago).toHaveLength(1);
  });

  it("una co-firma que queda pendiente es incierta: no se manda nada y la marca queda", async () => {
    const t = armarRetiro();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("corte");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(pedidosAlPago).toEqual([]);
    expect(marcaViva()).toBe(true);
  });

  it("la marca dura lo más que la regla deja vivir un pago más un minuto, aunque lo armado venza antes", async () => {
    const t = armarRetiro();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("corte");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(leerMarcaDeLaCuenta(MARCA_DEL_RETIRO)).toBe(AHORA + 300 + 60);
  });

  it("lo que había que aprobar no es lo armado: no-coincide, sin votar, y la marca se borra", async () => {
    dejarRechazar();
    const t = armarRetiro();
    elKitDevuelve(pedidoDe(armarRetiro({ secuencia: "11" })));
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "no-coincide" });
    expect(veces("relay")).toBe(0);
    expect(pedidosAlPago).toEqual([]);
    expect(marcaViva()).toBe(false);
  });

  it("la segunda negativa de la pestaña llega al tope", async () => {
    dejarRechazar();
    elKitDevuelve(pedidoDe(armarRetiro({ secuencia: "11" })));
    await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO);
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "no-coincide-tope" });
  });

  it("un servicio sin créditos al votar, con el pedido sin actividad: ahora no, sin mandar", async () => {
    dejarRechazar();
    const t = armarRetiro();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_CREDITS_INSUFFICIENT");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(pedidosAlPago).toEqual([]);
  });

  it("después del voto, un error con el código de la negativa no dice que no se hizo nada: queda incierto", async () => {
    dejarRechazar();
    const t = armarRetiro();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarApiError("tinkazo-cofirma-distinta");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(marcaViva()).toBe(true);
  });

  it("aprobado con lo firmado de otra transacción: incierto, y no se manda nada", async () => {
    const t = armarRetiro();
    const pedido = pedidoDe(t);
    elKitDevuelve(pedido);
    h.impl.relay = async () => ({ status: 200, body: {}, request: aprobado(pedido, { signedXdr: firmada(armarRetiro({ secuencia: "12" })) }) });
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(pedidosAlPago).toEqual([]);
  });

  it("el servicio dice que no tiene la forma, con el sobre que no puede salir: regla, y la marca se borra", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [{ estado: 400, cuerpo: { motivo: "no-permitida", razon: "costo-monto", pudoSalir: false } }];
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(marcaViva()).toBe(false);
  });

  it("el servicio dice que el sobre todavía puede salir: incierto y la marca queda", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [{ estado: 502, cuerpo: { motivo: "red", detalle: "plazo", pudoSalir: true } }];
    expect(await conElReloj(pollarWallet.retirar(t.toXDR(), PEDIDO))).toEqual({ estado: "incierto" });
    expect(marcaViva()).toBe(true);
  });

  it("entró y falló: no se movió nada, ahora no, y la marca se borra", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t, "fallo")];
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(marcaViva()).toBe(false);
  });
});

describe("una sola vez", () => {
  it("dos toques del mismo retiro comparten un solo pago", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    const [a, b] = await Promise.all([pollarWallet.retirar(t.toXDR(), PEDIDO), pollarWallet.retirar(t.toXDR(), PEDIDO)]);
    expect(a).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(b).toEqual(a);
    expect(veces("signTx")).toBe(1);
    expect(pedidosAlPago).toHaveLength(1);
  });

  it("otra pestaña con la marca viva: incierto, sin firmar ni mandar", async () => {
    localStorage.setItem(MARCA_DEL_RETIRO, String(AHORA + 100));
    expect(await pollarWallet.retirar(armarRetiro().toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(veces("signTx")).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("en duda en esta pestaña, el toque siguiente mira la red por el hash sin firmar ni mandar", async () => {
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [{ estado: 502, cuerpo: { motivo: "red", pudoSalir: true } }];
    expect(await conElReloj(pollarWallet.retirar(t.toXDR(), PEDIDO))).toEqual({ estado: "incierto" });
    servicio.enLaRed.set(hashDe(t), { estado: 200, cuerpo: { hash: hashDe(t), successful: true } });
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(veces("signTx")).toBe(1);
    expect(pedidosAlPago).toHaveLength(1);
    expect(marcaViva()).toBe(false);
  });

  it("con la marca vencida se puede volver a retirar", async () => {
    localStorage.setItem(MARCA_DEL_RETIRO, String(AHORA - 1));
    const t = armarRetiro();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    expect(await pollarWallet.retirar(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
  });
});

describe("la lista de lo permitido con el voto a mano", () => {
  const pago = (): xdr.Operation => Operation.payment({ destination: DESTINO, asset: usdc, amount: "1" });
  const conOperacion = (op: xdr.Operation): string =>
    new TransactionBuilder(new Account(P, "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC })
      .addOperation(op)
      .setTimeout(240)
      .build()
      .toXDR();
  /** Los límites de tiempo del sello y del sorteo de las pruebas. */
  const TIEMPO_DEL_SELLO = { minTime: 0, maxTime: AHORA + 300 };
  /** Una invocación del contrato oficial, como la arma la página para sellar o sortear. */
  const delContrato = (funcion: string): Transaction =>
    new TransactionBuilder(new Account(P, "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC, timebounds: TIEMPO_DEL_SELLO })
      .addOperation(Operation.invokeContractFunction({ contract: CONTRATO, function: funcion, args: [] }))
      .build();

  it("firmar y mandar por el proveedor un pago: cofirmaDistinta, sin votar ni pedir la firma", async () => {
    const e = await pollarWallet.signAndSubmit(conOperacion(pago())).then(
      () => null,
      (x: unknown) => x,
    );
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(veces("signAndSubmitTx")).toBe(0);
  });

  it("firmar sin mandar un pago que no pasó por retirar: cofirmaDistinta, sin pedir la firma", async () => {
    const e = await pollarWallet.signUnsponsored(armarRetiro().toXDR()).then(
      () => null,
      (x: unknown) => x,
    );
    expect(errorKey(e)).toBe("cofirmaDistinta");
    expect(veces("signTx")).toBe(0);
  });

  it("una línea de confianza, un cambio de firmantes o un cierre de cuenta tampoco llegan a pedirse", async () => {
    const ops: Array<[string, xdr.Operation]> = [
      ["changeTrust", Operation.changeTrust({ asset: usdc })],
      ["setOptions", Operation.setOptions({ signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 } })],
      ["accountMerge", Operation.accountMerge({ destination: DESTINO })],
    ];
    for (const [nombre, op] of ops) {
      const e = await pollarWallet.signAndSubmit(conOperacion(op)).then(
        () => null,
        (x: unknown) => x,
      );
      expect(errorKey(e), nombre).toBe("cofirmaDistinta");
    }
    expect(veces("signAndSubmitTx")).toBe(0);
    expect(avisos()).toContain("fuera de lo permitido");
  });

  it("el sello del contrato oficial sigue pasando por el portero de siempre", async () => {
    const sello = delContrato("seal");
    laFirmaSale(sello);
    await expect(pollarWallet.signUnsponsored(sello.toXDR())).resolves.toBe(firmada(sello));
  });

  it("el sorteo del contrato oficial sigue pasando", async () => {
    const sorteo = delContrato("draw");
    laFirmaSale(sorteo);
    await expect(pollarWallet.signUnsponsored(sorteo.toXDR())).resolves.toBe(firmada(sorteo));
  });
});
