// @vitest-environment jsdom
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LecturaDePago } from "../stellar/pagos";
import type { Preparacion } from "../stellar/pagos-envio";
import { type CuentaMirada, type LecturaDeCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { type Dependencias, type PedidoDePago, billeteraActiva, pagarUnPremio, saldoDeLaCuenta } from "./pagar-premio";

/** La billetera activa de la página, que cada prueba reemplaza. */
const { activa } = vi.hoisted(() => ({ activa: { w: null as unknown } }));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => activa.w }));
/** La marca de un pago con la cuenta, como la deja la billetera: hasta cuándo (segundos Unix) puede entrar. */
const { marcas } = vi.hoisted(() => ({ marcas: new Map<string, number>() }));
vi.mock("../stellar/wallet-pollar", () => ({
  submitsItself: (w: unknown) => !!w && (w as { submitsItself?: boolean }).submitsItself === true,
  MARCA_DEL_PREMIO: "tinkazo.pago-premio.",
  leerMarcaDeLaCuenta: (clave: string) => marcas.get(clave) ?? null,
}));

/**
 * Qué billetera arma `billeteraActiva`: la cuenta de Google de la red principal paga sola solo con pagar con Google
 * prendido y con una billetera lista para pagar premios. En cualquier otro caso queda como siempre. Con billeteras de
 * mentira: nada se firma ni se manda.
 */

const ORG = Keypair.random().publicKey();
const GANA = Keypair.random().publicKey();
const ACTIVO = { code: "USDC", issuer: usdcDeLaRed("mainnet").issuer };
const HASH = "ab".repeat(32);
const XDR = "AAAAAgAAAAArmado";
const NOTA = "tk:premio:777:2";
const PEDIDO: PedidoDePago = { red: "mainnet", raffleId: "777", puesto: 2, destino: GANA, activo: ACTIVO, monto: "50", desde: 1_800_000_000 };

interface BilleteraDeMentira {
  address: string;
  submitsItself?: true;
  networkPassphrase: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  pagarPremio?: ReturnType<typeof vi.fn>;
}

function deGoogle(o: { sinPagarPremio?: boolean } = {}): BilleteraDeMentira {
  return {
    address: ORG,
    submitsItself: true,
    networkPassphrase: vi.fn(async () => null),
    signTransaction: vi.fn(async () => ({ signedTxXdr: "firmado" })),
    ...(o.sinPagarPremio ? {} : { pagarPremio: vi.fn(async () => ({ estado: "salio" as const, hash: HASH })) }),
  };
}
const propia = (): BilleteraDeMentira => ({
  address: ORG,
  networkPassphrase: vi.fn(async () => "pass"),
  signTransaction: vi.fn(async () => ({ signedTxXdr: "firmado" })),
});

const prendida = (): boolean => true;
const apagada = (): boolean => false;
const saldo100 = vi.fn(async (): Promise<bigint | null> => 1_000_000_000n);

beforeEach(() => {
  activa.w = null;
  marcas.clear();
  saldo100.mockClear();
});

describe("la billetera de la cuenta de Google", () => {
  it("con pagar con Google y en la red principal, paga sola: lee su saldo y pasa el pago a su billetera", async () => {
    const w = deGoogle();
    activa.w = w;
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    expect(b?.direccion).toBe(ORG);
    expect(b?.firmaAdentro).toBe(true);
    expect(b?.mandaSola).toBeDefined();
    expect(await b?.mandaSola?.saldo()).toBe(1_000_000_000n);
    expect(saldo100).toHaveBeenCalledWith("mainnet", ORG);
    const pedido = { cuenta: ORG, destino: GANA, monto: "50.0000000", nota: NOTA };
    expect(await b?.mandaSola?.pagar(XDR, pedido)).toEqual({ estado: "salio", hash: HASH });
    expect(w.pagarPremio).toHaveBeenCalledWith(XDR, pedido);
  });

  it("lo que contesta la billetera llega tal cual: incierto, y no salió con su motivo", async () => {
    const w = deGoogle();
    activa.w = w;
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    const pedido = { cuenta: ORG, destino: GANA, monto: "50.0000000", nota: NOTA };
    w.pagarPremio?.mockResolvedValueOnce({ estado: "incierto" });
    expect(await b?.mandaSola?.pagar(XDR, pedido)).toEqual({ estado: "incierto" });
    w.pagarPremio?.mockResolvedValueOnce({ estado: "no-salio", motivo: "no-coincide" });
    expect(await b?.mandaSola?.pagar(XDR, pedido)).toEqual({ estado: "no-salio", motivo: "no-coincide" });
  });

  it("nunca firma un pago desde el formulario por otro camino: firmar lanza y no toca su billetera", async () => {
    const w = deGoogle();
    activa.w = w;
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    await expect(b?.firmar(XDR, "pass", ORG)).rejects.toThrow();
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("dice que un pago de ese premio está en camino solo mientras su marca sigue viva", async () => {
    activa.w = deGoogle();
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    const ahora = Math.floor(Date.now() / 1000);
    expect(b?.mandaSola?.enCamino?.(NOTA)).toBe(false);
    marcas.set(`tinkazo.pago-premio.${NOTA}`, ahora + 600);
    expect(b?.mandaSola?.enCamino?.(NOTA)).toBe(true);
    expect(b?.mandaSola?.enCamino?.("tk:premio:777:3")).toBe(false);
    marcas.set(`tinkazo.pago-premio.${NOTA}`, ahora - 600);
    expect(b?.mandaSola?.enCamino?.(NOTA)).toBe(false);
  });

  it("sin pagar con Google queda como siempre: no firma adentro, no paga sola y no pregunta por el saldo", async () => {
    const w = deGoogle();
    activa.w = w;
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: apagada, saldo: saldo100 });
    expect(b?.firmaAdentro).toBe(false);
    expect(b?.mandaSola).toBeUndefined();
    expect(saldo100).not.toHaveBeenCalled();
    expect(w.pagarPremio).not.toHaveBeenCalled();
  });

  it("fuera de la red principal no paga sola, aunque la bandera esté prendida", async () => {
    activa.w = deGoogle();
    const b = await billeteraActiva({ red: "testnet", pagarConGoogle: prendida, saldo: saldo100 });
    expect(b?.firmaAdentro).toBe(false);
    expect(b?.mandaSola).toBeUndefined();
  });

  it("si la billetera no sabe pagar premios, no paga sola", async () => {
    activa.w = deGoogle({ sinPagarPremio: true });
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    expect(b?.firmaAdentro).toBe(false);
    expect(b?.mandaSola).toBeUndefined();
  });

  it("sin cuenta abierta no hay billetera", async () => {
    activa.w = null;
    expect(await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 })).toBeNull();
    activa.w = { ...deGoogle(), address: "" };
    expect(await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 })).toBeNull();
  });
});

describe("una billetera propia", () => {
  it("firma adentro con su billetera, nunca paga sola, aunque la bandera esté prendida", async () => {
    const w = propia();
    activa.w = w;
    const b = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    expect(b?.firmaAdentro).toBe(true);
    expect(b?.mandaSola).toBeUndefined();
    expect(await b?.firmar(XDR, "pass", ORG)).toBe("firmado");
    expect(w.signTransaction).toHaveBeenCalledWith(XDR, { networkPassphrase: "pass", address: ORG });
    expect(await b?.red()).toBe("pass");
  });
});

describe("pagar un premio con la billetera de la cuenta de Google", () => {
  it("arma el pago, se lo pasa a la billetera con lo que se vio y no firma ni manda por otro lado", async () => {
    const w = deGoogle();
    activa.w = w;
    const billetera = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    const preparar = vi.fn(async (): Promise<Preparacion> => ({ ok: true, xdr: XDR, nota: NOTA, monto: "50.0000000" }));
    const mandar = vi.fn();
    const deps: Dependencias = { buscar: async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }), preparar, mandar, billetera };
    const r = await pagarUnPremio(deps, { ...PEDIDO, desde: 1_800_000_000 });
    expect(r).toEqual({ tipo: "listo", hash: HASH, origen: ORG });
    expect(w.pagarPremio).toHaveBeenCalledWith(XDR, { cuenta: ORG, destino: GANA, monto: "50.0000000", nota: NOTA });
    expect(mandar).not.toHaveBeenCalled();
    expect(w.signTransaction).not.toHaveBeenCalled();
  });

  it("Pagar desde otra billetera arma el pago para aprobarlo afuera y no usa la billetera de Google", async () => {
    const w = deGoogle();
    activa.w = w;
    const billetera = await billeteraActiva({ red: "mainnet", pagarConGoogle: prendida, saldo: saldo100 });
    const otra = Keypair.random().publicKey();
    const preparar = vi.fn(async (): Promise<Preparacion> => ({ ok: true, xdr: XDR, nota: NOTA, monto: "50.0000000" }));
    const deps: Dependencias = { buscar: async (): Promise<LecturaDePago> => ({ tipo: "no-hay" }), preparar, mandar: vi.fn(), billetera };
    const r = await pagarUnPremio(deps, { ...PEDIDO, desde: 1, afuera: true, cuentaQuePaga: otra });
    expect(r).toEqual({ tipo: "afuera", xdr: XDR, nota: NOTA, origen: otra });
    expect(w.pagarPremio).not.toHaveBeenCalled();
  });
});

describe("el saldo de la cuenta que paga", () => {
  const conLinea = (saldo: string, o: Partial<CuentaMirada> = {}): CuentaMirada => ({
    secuencia: "1",
    saldos: [{ code: ACTIVO.code, issuer: ACTIVO.issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null }],
    xlm: "10.0000000",
    xlmComprometido: "0.0000000",
    subentradas: 0,
    patrocinando: 0,
    patrocinadas: 0,
    ...o,
  });
  const lee = (l: LecturaDeCuenta): typeof import("../stellar/usdc-cuenta").mirarCuenta => async () => l;

  it("lo que tiene la línea del dólar digital, en stroops", async () => {
    expect(await saldoDeLaCuenta("mainnet", ORG, lee(conLinea("12.5000000")))).toBe(125_000_000n);
  });

  it("sin la línea o con la cuenta sin crear, cero", async () => {
    expect(await saldoDeLaCuenta("mainnet", ORG, lee({ ...conLinea("1.0000000"), saldos: [] }))).toBe(0n);
    expect(await saldoDeLaCuenta("mainnet", ORG, lee("no-existe"))).toBe(0n);
  });

  it("si no se pudo saber, nulo: sin red, saldo que no se lee o una lectura que lanza", async () => {
    expect(await saldoDeLaCuenta("mainnet", ORG, lee("sin-red"))).toBeNull();
    expect(await saldoDeLaCuenta("mainnet", ORG, lee(conLinea("no-es-un-numero")))).toBeNull();
    const lanza = (async () => {
      throw new Error("cortado");
    }) as unknown as typeof import("../stellar/usdc-cuenta").mirarCuenta;
    expect(await saldoDeLaCuenta("mainnet", ORG, lanza)).toBeNull();
  });

  it("no cuenta el dólar digital de otro emisor", async () => {
    const ajeno = { code: "USDC", issuer: Keypair.random().publicKey(), saldo: "99.0000000", limite: "1", autorizada: true, patrocinador: null };
    const otro: CuentaMirada = { ...conLinea("99.0000000"), saldos: [ajeno] };
    expect(await saldoDeLaCuenta("mainnet", ORG, lee(otro))).toBe(0n);
  });
});
