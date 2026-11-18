import { Account, Asset, Keypair, Memo, Networks, Operation, StrKey, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import type { CosignRequest } from "@pollar/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_MAINNET } from "./pagos";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * El pago del premio de un sorteo desde una cuenta de Google (`pagarPremio` de `wallet-pollar.ts`): el pago que armó la
 * página pasa la regla del premio, se firma con el voto por contenido sin el patrocinio del proveedor y lo firmado va al
 * servicio de comisiones. Un mismo premio se paga una sola vez: en esta pestaña, en otra o después de recargar.
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

const { pollarWallet, MARCA_DEL_PREMIO, leerMarcaDeLaCuenta } = await import("./wallet-pollar");
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
const GANA = Keypair.random().publicKey();
const COBROS = Keypair.random().publicKey();
const SUB = "sub-org-de-la-cuenta";
const CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(7));
const ID = "pedido-1";
const PORTERO = "https://portero.prueba";
/** La hora fija de las pruebas, en segundos: lo armado vence a los 240 segundos de esta hora. */
const AHORA = 1_800_000_000;
const NOTA = "tk:premio:77:0";
const usdc = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);

/** El pago de un premio como lo arma la página: un solo pago de 1 dólar digital a quien ganó, con la nota del premio. */
function armarPremio(o: { destino?: string; monto?: string; nota?: string; secuencia?: string } = {}): Transaction {
  return new TransactionBuilder(new Account(P, o.secuencia ?? "10"), { fee: "1000", networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.payment({ destination: o.destino ?? GANA, asset: usdc, amount: o.monto ?? "1.0000000" }))
    .addMemo(Memo.text(o.nota ?? NOTA))
    .setTimeout(240)
    .build();
}
/** Lo que la persona vio: la cuenta que paga, quien ganó según la lista sellada, el monto y la nota del premio. */
const PEDIDO = { cuenta: P, destino: GANA, monto: "1.0000000", nota: NOTA };

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
  cuerpo: { hash: hashDe(t), forma: "premio", vence: AHORA + 240, status: "PENDING", estado },
});

const marcaViva = (nota = NOTA): boolean => (leerMarcaDeLaCuenta(MARCA_DEL_PREMIO + nota) ?? 0) > AHORA;
const veces = (nombre: string): number => h.llamadas.filter((n) => n === nombre).length;
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
  vi.stubEnv("VITE_RAMPA", "premios");
  vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "1");
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
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("sin la bandera de pagar con Google no arma el cliente", async () => {
    vi.stubEnv("VITE_PAGAR_CON_GOOGLE", "");
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("sin el voto por contenido la bandera no vale y no arma el cliente", async () => {
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "");
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
  });

  it("fuera del modo premios la bandera no vale y no arma el cliente", async () => {
    vi.stubEnv("VITE_RAMPA", "recibir");
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(h.construidos).toBe(0);
  });

  it("una nota que no es la de un premio no arma el cliente", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio().toXDR(), { ...PEDIDO, nota: "tk:o:ABCDEFGH" });
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(h.construidos).toBe(0);
  });
});

describe("la regla del premio, antes de pedir nada", () => {
  it("otro monto que el que vio la persona no pasa: sin firma y sin el servicio", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio({ monto: "2.0000000" }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
    expect(consultasAlCupo).toEqual([]);
  });

  it("otro destino que el de la lista sellada no pasa", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio({ destino: Keypair.random().publicKey() }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });

  it("otra nota que la del premio no pasa", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio({ nota: "tk:premio:77:1" }).toXDR(), PEDIDO);
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
  });

  it("un pedido de otra cuenta que la de la sesión no pasa", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio().toXDR(), { ...PEDIDO, cuenta: Keypair.random().publicKey() });
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });

  it("un premio a la cuenta de cobros no pasa", async () => {
    const r = await pollarWallet.pagarPremio(armarPremio({ destino: COBROS }).toXDR(), { ...PEDIDO, destino: COBROS });
    expect(r).toEqual({ estado: "no-salio", motivo: "regla" });
    expect(veces("signTx")).toBe(0);
  });

  it("si el servicio no atiende premios, no se pide la firma", async () => {
    servicio.pagos = { ...pagosDeSiempre(), premio: false };
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(0);
  });
});

describe("la firma y el servicio de comisiones", () => {
  it("lo que pasa se firma sin el patrocinio del proveedor y va al servicio como premio: sale con el hash", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(h.argumentos.signTx).toEqual([[t.toXDR(), { skipSponsorship: true }]]);
    expect(pedidosAlPago).toEqual([{ forma: "premio", xdr: firmada(t) }]);
    expect(marcaViva()).toBe(false);
  });

  it("una co-firma que queda pendiente es incierta, sin mandar nada", async () => {
    const t = armarPremio();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarNetworkError("corte");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(pedidosAlPago).toEqual([]);
    expect(marcaViva()).toBe(true);
  });

  it("lo que había que aprobar no es lo armado: no-coincide, también con el tope", async () => {
    dejarRechazar();
    elKitDevuelve(pedidoDe(armarPremio({ secuencia: "11" })));
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "no-coincide" });
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "no-coincide" });
    expect(veces("relay")).toBe(0);
    expect(marcaViva()).toBe(false);
  });

  it("un servicio sin créditos al votar: ahora no, sin mandar", async () => {
    dejarRechazar();
    const t = armarPremio();
    elKitDevuelve(pedidoDe(t));
    h.impl.relay = async () => {
      throw new kit.PollarApiError("SDK_CREDITS_INSUFFICIENT");
    };
    h.impl.get = async () => pedidoDe(t);
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(pedidosAlPago).toEqual([]);
  });

  it("la persona corta la confirmación antes del voto: cancelado", async () => {
    h.impl.signTx = async () => ({ status: "error", code: "SDK_CONFIRMATION_DECLINED" });
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "cancelado" });
    expect(marcaViva()).toBe(false);
  });

  it("el puesto ya tiene un pago por esta ruta que entró: salió, con el hash de ese pago y sin armar otro", async () => {
    const t = armarPremio();
    const otro = "d".repeat(64);
    laFirmaSale(t);
    servicio.respuestas = [{ estado: 409, cuerpo: { motivo: "puesto-usado", hash: otro, estado: "ok", pudoSalir: false } }];
    servicio.enLaRed.set(otro, { estado: 200, cuerpo: { hash: otro, successful: true } });
    expect(await conElReloj(pollarWallet.pagarPremio(t.toXDR(), PEDIDO))).toEqual({ estado: "salio", hash: otro });
    expect(pedidosAlPago).toHaveLength(1);
  });

  it("un no de la puerta en el primer envío dice que no salió y la marca se borra", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [{ estado: 404, cuerpo: { motivo: "no-existe" } }];
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(marcaViva()).toBe(false);
  });

  it("sin respuesta del servicio se reenvía el mismo sobre, nunca otro", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [];
    const p = pollarWallet.pagarPremio(t.toXDR(), PEDIDO);
    setTimeout(() => servicio.respuestas.push(tomado(t)), 2_000);
    expect(await conElReloj(p)).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(pedidosAlPago.length).toBeGreaterThan(1);
    for (const pedido of pedidosAlPago) expect(pedido).toEqual({ forma: "premio", xdr: firmada(t) });
    expect(veces("signTx")).toBe(1);
  });
});

describe("un mismo premio se paga una sola vez", () => {
  it("dos toques del mismo premio comparten un solo pago", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    const [a, b] = await Promise.all([pollarWallet.pagarPremio(t.toXDR(), PEDIDO), pollarWallet.pagarPremio(t.toXDR(), PEDIDO)]);
    expect(a).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(b).toEqual(a);
    expect(veces("signTx")).toBe(1);
    expect(pedidosAlPago).toHaveLength(1);
  });

  it("otro premio mientras uno está en curso no se arma", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    const otro = armarPremio({ nota: "tk:premio:77:1" });
    const [a, b] = await Promise.all([
      pollarWallet.pagarPremio(t.toXDR(), PEDIDO),
      pollarWallet.pagarPremio(otro.toXDR(), { ...PEDIDO, nota: "tk:premio:77:1" }),
    ]);
    expect(a).toEqual({ estado: "salio", hash: hashDe(t) });
    expect(b).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(veces("signTx")).toBe(1);
  });

  it("otra pestaña con la marca viva de ese premio: incierto, sin firmar ni mandar", async () => {
    localStorage.setItem(MARCA_DEL_PREMIO + NOTA, String(AHORA + 100));
    expect(await pollarWallet.pagarPremio(armarPremio().toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(veces("signTx")).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("la marca de otro premio no frena este", async () => {
    localStorage.setItem(`${MARCA_DEL_PREMIO}tk:premio:77:1`, String(AHORA + 100));
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t)];
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "salio", hash: hashDe(t) });
  });

  it("en duda, el toque siguiente mira la red por el hash sin firmar ni mandar, y sigue en duda si no aparece", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t, "en-camino")];
    expect(await conElReloj(pollarWallet.pagarPremio(t.toXDR(), PEDIDO))).toEqual({ estado: "incierto" });
    const antes = consultasALaRed.length;
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "incierto" });
    expect(consultasALaRed.length).toBe(antes + 1);
    expect(veces("signTx")).toBe(1);
    expect(pedidosAlPago).toHaveLength(1);
    expect(marcaViva()).toBe(true);
  });

  it("entró y falló: no se movió nada y el premio se puede volver a pagar", async () => {
    const t = armarPremio();
    laFirmaSale(t);
    servicio.respuestas = [tomado(t, "fallo")];
    expect(await pollarWallet.pagarPremio(t.toXDR(), PEDIDO)).toEqual({ estado: "no-salio", motivo: "ahora-no" });
    expect(marcaViva()).toBe(false);
  });
});
