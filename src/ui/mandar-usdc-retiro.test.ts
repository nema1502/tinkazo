import { Account, Asset, Keypair, Memo, Networks, Operation, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { network } from "../stellar/config";
import { USDC_MAINNET } from "../stellar/pagos";
import { NOTA_DEL_RETIRO, VIDA_DEL_PAGO_S } from "../stellar/pagos-regla";
import type { CuentaMirada, LecturaDeCuenta } from "../stellar/usdc-cuenta";
import type { PedidoDeRetiro, ResultadoDelRetiro } from "../stellar/wallet-pollar";
import { type DatosDelEnvio, armarEnvio, depsDelSitio, motivoContraElEnvio, notaDelEnvio, prepararEnvio } from "./mandar-usdc";

// La billetera activa del sitio, de mentira: se mira si llega a firmar y a qué.
interface BilleteraFalsa {
  address: string;
  signTransaction: () => Promise<{ signedTxXdr: string }>;
  signAndSubmit: (xdr: string) => Promise<unknown>;
  /** Si el kit de la cuenta de Google vota a mano lo que armó la página. */
  votaPorContenido?: () => boolean;
  /** El retiro de la billetera de Google, por el servicio de comisiones. */
  retirar?: (xdr: string, pedido: PedidoDeRetiro) => Promise<ResultadoDelRetiro>;
}
const billetera = vi.hoisted(() => ({
  activa: null as null | BilleteraFalsa,
  /** ¿La billetera activa es una cuenta de Google, que firma y manda sola? */
  google: false,
}));
vi.mock("../stellar/wallet-lite", () => ({ activeWallet: () => billetera.activa }));
vi.mock("../stellar/wallet-pollar", () => ({ submitsItself: () => billetera.google }));

/**
 * Mandar con el costo del retiro, armado con el SDK de Stellar (sin jsdom: el SDK no se lleva con sus arreglos de
 * bytes). Con costo el retiro es una sola transacción con dos pagos de la misma moneda, en este orden: lo que llega al
 * destino y el costo exacto a la cuenta del costo. Sin costo, Mandar es el de siempre. La hora se fija: la regla mira cuánto
 * le queda de vida a la transacción. La ventana se prueba en mandar-usdc.test.ts.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const COBROS = Keypair.random().publicKey();
const D = 10_000_000n;
const COSTO = { stroops: D / 2n, destino: COBROS };
/** La hora fija de las pruebas: la transacción vence a los 240 segundos de esta hora. */
const AHORA = 1_800_000_000;

const mirada = (saldo: string | null, o: Partial<CuentaMirada> = {}): CuentaMirada => ({
  secuencia: "500",
  saldos:
    saldo === null
      ? []
      : [{ code: "USDC", issuer: USDC_MAINNET.issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null }],
  xlm: "2.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 1,
  patrocinando: 0,
  patrocinadas: 1,
  ...o,
});

const leer = (xdr: string): Transaction => TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;

type Pago = { type: string; destination: string; asset: { code: string; issuer: string }; amount: string };
const pagosDe = (tx: Transaction): (Pago | undefined)[] => tx.operations as unknown as Pago[];

/** Un retiro con costo: salen 12,5 de la cuenta, llegan 12 al destino y 0,5 va a la cuenta del costo. */
const retiro = (o: Partial<DatosDelEnvio> = {}): DatosDelEnvio => ({
  red: "mainnet",
  origen: YO,
  destino: OTRA,
  monto: (125n * D) / 10n,
  nota: { tipo: "ninguna" },
  costo: COSTO,
  ...o,
});

const usdc = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);
const pagoA = (destino: string, monto: string): ReturnType<typeof Operation.payment> =>
  Operation.payment({ destination: destino, asset: usdc, amount: monto });

/** Una transacción de la persona armada a mano: para probar que la regla frena lo que no es el retiro pedido. */
function armadaA(ops: ReturnType<typeof Operation.payment>[], vidaS = VIDA_DEL_PAGO_S): string {
  const b = new TransactionBuilder(new Account(YO, "500"), { fee: "1000", networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  return b.addMemo(Memo.text(NOTA_DEL_RETIRO)).setTimeout(vidaS).build().toXDR();
}

/** Fija el reloj en una hora conocida: el SDK arma el vencimiento con esa hora. */
function conLaHoraFija(): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AHORA * 1000));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("armar un retiro con costo", () => {
  it("sin costo, el pago es el de siempre: una operación, 600 segundos y sin nota", async () => {
    conLaHoraFija();
    const sinCampo = leer(await armarEnvio({ ...retiro(), costo: undefined }, "500"));
    const conNulo = leer(await armarEnvio(retiro({ costo: null }), "500"));
    for (const tx of [sinCampo, conNulo]) {
      expect(tx.operations).toHaveLength(1);
      expect(tx.fee).toBe("1000");
      expect(Number(tx.timeBounds?.maxTime)).toBe(AHORA + 600);
      expect(tx.memo.type).toBe("none");
    }
  });

  it("con costo son dos pagos de USDC de Circle en este orden: lo que llega al destino y después el costo exacto", async () => {
    const tx = leer(await armarEnvio(retiro(), "500"));
    const [persona, costo] = pagosDe(tx);
    expect(tx.operations).toHaveLength(2);
    expect(persona?.type).toBe("payment");
    expect(persona?.destination).toBe(OTRA);
    expect(persona?.amount).toBe("12.0000000");
    expect(costo?.type).toBe("payment");
    expect(costo?.destination).toBe(COBROS);
    expect(costo?.amount).toBe("0.5000000");
    expect({ code: persona?.asset.code, issuer: persona?.asset.issuer }).toEqual(USDC_MAINNET);
    expect({ code: costo?.asset.code, issuer: costo?.asset.issuer }).toEqual(USDC_MAINNET);
  });

  it("la comisión es de 1000 por operación y la transacción vence a los 240 segundos", async () => {
    conLaHoraFija();
    const tx = leer(await armarEnvio(retiro(), "500"));
    expect(tx.fee).toBe("2000");
    expect(Number(tx.timeBounds?.maxTime)).toBe(AHORA + VIDA_DEL_PAGO_S);
  });

  it("lo que llega es lo que sale menos el costo, exacto hasta el último stroop", async () => {
    const [persona, costo] = pagosDe(leer(await armarEnvio(retiro({ monto: 125_000_001n }), "500")));
    expect(persona?.amount).toBe("12.0000001");
    expect(costo?.amount).toBe("0.5000000");
  });

  it("sin nota pedida lleva la nota fija del retiro", async () => {
    expect(notaDelEnvio(retiro())).toEqual({ tipo: "texto", valor: NOTA_DEL_RETIRO });
    const tx = leer(await armarEnvio(retiro(), "500"));
    expect(tx.memo.type).toBe("text");
    expect(new TextDecoder().decode(tx.memo.value as Uint8Array)).toBe(NOTA_DEL_RETIRO);
  });

  it("con una nota de texto pedida lleva esa nota", async () => {
    const tx = leer(await armarEnvio(retiro({ nota: { tipo: "texto", valor: "para Ana" } }), "500"));
    expect(new TextDecoder().decode(tx.memo.value as Uint8Array)).toBe("para Ana");
  });

  it("con una nota numérica pedida lleva esa nota", async () => {
    const tx = leer(await armarEnvio(retiro({ nota: { tipo: "id", valor: "998877" } }), "500"));
    expect(tx.memo.type).toBe("id");
    expect(String(tx.memo.value)).toBe("998877");
  });

  it("sin costo, la nota queda como la pegó la persona: sin nota es sin nota", () => {
    expect(notaDelEnvio({ nota: { tipo: "ninguna" }, costo: null })).toEqual({ tipo: "ninguna" });
    expect(notaDelEnvio({ nota: { tipo: "ninguna" } })).toEqual({ tipo: "ninguna" });
  });

  it("no arma nada si lo que llega sería menos de 1 dólar", async () => {
    await expect(armarEnvio(retiro({ monto: 14_999_999n }), "500")).rejects.toThrow("mandar: datos inválidos");
  });

  it("arma el retiro si lo que llega es exactamente 1 dólar", async () => {
    const tx = leer(await armarEnvio(retiro({ monto: 15_000_000n }), "500"));
    expect(pagosDe(tx)[0]?.amount).toBe("1.0000000");
  });

  it("no arma nada si el costo va a la cuenta de quien manda", async () => {
    await expect(armarEnvio(retiro({ costo: { stroops: COSTO.stroops, destino: YO } }), "500")).rejects.toThrow("mandar: datos inválidos");
  });

  it("no arma nada si el costo va a la cuenta del destino", async () => {
    await expect(armarEnvio(retiro({ costo: { stroops: COSTO.stroops, destino: OTRA } }), "500")).rejects.toThrow("mandar: datos inválidos");
  });

  it("no arma nada si el costo es cero", async () => {
    await expect(armarEnvio(retiro({ costo: { stroops: 0n, destino: COBROS } }), "500")).rejects.toThrow("mandar: datos inválidos");
  });

  it("en el modo premios no arma ni el retiro", async () => {
    vi.stubEnv("VITE_RAMPA", "premios");
    await expect(armarEnvio(retiro(), "500")).rejects.toThrow("mandar: apagado");
  });
});

describe("preparar un retiro con costo", () => {
  const mirando =
    (origen: LecturaDeCuenta, destino: LecturaDeCuenta, cobros: LecturaDeCuenta) =>
    async (cuenta: string): Promise<LecturaDeCuenta> => {
      if (cuenta === YO) return origen;
      return cuenta === COBROS ? cobros : destino;
    };
  const vacia = (): LecturaDeCuenta => mirada("0.0000000");

  it("con las tres cuentas en orden, arma el retiro y pasa por la regla", async () => {
    conLaHoraFija();
    const p = await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), vacia()));
    expect(p.ok).toBe(true);
    expect(p.ok && (await motivoContraElEnvio(p.xdr, retiro()))).toBeNull();
  });

  it("con costo mira también la cuenta del costo", async () => {
    const mirar = vi.fn(mirando(mirada("12.5000000"), vacia(), vacia()));
    await prepararEnvio(retiro(), mirar);
    expect(mirar.mock.calls.map(([c]) => c).sort()).toEqual([COBROS, OTRA, YO].sort());
  });

  it("sin costo mira solo las dos cuentas de siempre", async () => {
    const mirar = vi.fn(mirando(mirada("12.5000000"), vacia(), vacia()));
    await prepararEnvio(retiro({ costo: null }), mirar);
    expect(mirar.mock.calls.map(([c]) => c).sort()).toEqual([OTRA, YO].sort());
  });

  it("si la cuenta del costo no tiene la línea, no se arma nada: sin-retiro", async () => {
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), mirada(null)))).toEqual({ ok: false, motivo: "sin-retiro" });
  });

  it("si la cuenta del costo no existe, no se arma nada: sin-retiro", async () => {
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), "no-existe"))).toEqual({ ok: false, motivo: "sin-retiro" });
  });

  it("si la cuenta del costo no tiene lugar para el costo, no se arma nada: sin-retiro", async () => {
    const llena = mirada("0.0000000");
    (llena.saldos[0] as { limite: string }).limite = "0.4999999";
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), llena))).toEqual({ ok: false, motivo: "sin-retiro" });
  });

  it("si la cuenta del costo no tiene la línea autorizada, no se arma nada: sin-retiro", async () => {
    const sinAutorizar = mirada("0.0000000");
    (sinAutorizar.saldos[0] as { autorizada: boolean }).autorizada = false;
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), sinAutorizar))).toEqual({ ok: false, motivo: "sin-retiro" });
  });

  it("si no se puede mirar la cuenta del costo, sin-red", async () => {
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), vacia(), "sin-red"))).toEqual({ ok: false, motivo: "sin-red" });
  });

  it("sin saldo para lo que sale, sin-saldo", async () => {
    expect(await prepararEnvio(retiro(), mirando(mirada("12.4999999"), vacia(), vacia()))).toEqual({ ok: false, motivo: "sin-saldo" });
  });

  it("el destino tiene que tener lugar para lo que llega, no para lo que sale", async () => {
    conLaHoraFija();
    const justo = mirada("0.0000000");
    (justo.saldos[0] as { limite: string }).limite = "12.0000000";
    expect((await prepararEnvio(retiro(), mirando(mirada("12.5000000"), justo, vacia()))).ok).toBe(true);
  });

  it("el destino sin lugar para lo que llega, no-recibe", async () => {
    const corto = mirada("0.0000000");
    (corto.saldos[0] as { limite: string }).limite = "11.9999999";
    expect(await prepararEnvio(retiro(), mirando(mirada("12.5000000"), corto, vacia()))).toEqual({ ok: false, motivo: "no-recibe" });
  });

  it("con lo que llega menor a 1 dólar no mira ni arma nada: datos", async () => {
    const mirar = vi.fn(mirando(mirada("12.5000000"), vacia(), vacia()));
    expect(await prepararEnvio(retiro({ monto: 14_999_999n }), mirar)).toEqual({ ok: false, motivo: "datos" });
    expect(mirar).not.toHaveBeenCalled();
  });

  it("con el costo en la cuenta de quien manda no mira ni arma nada: datos", async () => {
    const mirar = vi.fn(mirando(mirada("12.5000000"), vacia(), vacia()));
    expect(await prepararEnvio(retiro({ costo: { stroops: COSTO.stroops, destino: YO } }), mirar)).toEqual({ ok: false, motivo: "datos" });
    expect(mirar).not.toHaveBeenCalled();
  });

  it("una nota que se lee como una orden de compra no pasa la regla: regla", async () => {
    conLaHoraFija();
    const orden = retiro({ nota: { tipo: "texto", valor: "tk:o:ABCD2345" } });
    expect(await prepararEnvio(orden, mirando(mirada("12.5000000"), vacia(), vacia()))).toEqual({ ok: false, motivo: "regla" });
  });
});

describe("la regla del retiro antes de firmar", () => {
  it("lo que arma la propia página pasa", async () => {
    conLaHoraFija();
    expect(await motivoContraElEnvio(await armarEnvio(retiro(), "500"), retiro())).toBeNull();
  });

  it("sin costo no se mira nada: un pago de los de siempre no pasa por esta regla", async () => {
    conLaHoraFija();
    const comun = await armarEnvio(retiro({ costo: null }), "500");
    expect(await motivoContraElEnvio(comun, retiro({ costo: null }))).toBeNull();
  });

  it("sin costo no se mira ni lo que no es una transacción", async () => {
    expect(await motivoContraElEnvio("no es una transacción", retiro({ costo: undefined }))).toBeNull();
  });

  it("lo que no es una transacción no pasa con costo", async () => {
    conLaHoraFija();
    expect(await motivoContraElEnvio("no es una transacción", retiro())).toBe("no se lee");
  });

  it("un costo mayor que el configurado no pasa", async () => {
    conLaHoraFija();
    const mayor = armadaA([pagoA(OTRA, "12.0000000"), pagoA(COBROS, "0.5100000")]);
    expect(await motivoContraElEnvio(mayor, retiro())).toBe("otro monto del costo");
  });

  it("un costo menor que el configurado no pasa", async () => {
    conLaHoraFija();
    const menor = armadaA([pagoA(OTRA, "12.0000000"), pagoA(COBROS, "0.4900000")]);
    expect(await motivoContraElEnvio(menor, retiro())).toBe("otro monto del costo");
  });

  it("un costo a otra cuenta no pasa", async () => {
    conLaHoraFija();
    const aOtra = armadaA([pagoA(OTRA, "12.0000000"), pagoA(Keypair.random().publicKey(), "0.5000000")]);
    expect(await motivoContraElEnvio(aOtra, retiro())).toBe("otro destino del costo");
  });

  it("el orden al revés no pasa: primero la persona y después el costo", async () => {
    conLaHoraFija();
    const alReves = armadaA([pagoA(COBROS, "0.5000000"), pagoA(OTRA, "12.0000000")]);
    expect(await motivoContraElEnvio(alReves, retiro())).toBe("orden al revés");
  });

  it("una sola operación con costo configurado no pasa", async () => {
    conLaHoraFija();
    expect(await motivoContraElEnvio(armadaA([pagoA(OTRA, "12.5000000")]), retiro())).toBe("operaciones de menos");
  });

  it("lo que llega distinto de lo que sale menos el costo no pasa", async () => {
    conLaHoraFija();
    const sinDescontar = armadaA([pagoA(OTRA, "12.5000000"), pagoA(COBROS, "0.5000000")]);
    expect(await motivoContraElEnvio(sinDescontar, retiro())).toBe("otro monto");
  });

  it("una transacción que vive 600 segundos no pasa", async () => {
    conLaHoraFija();
    const larga = armadaA([pagoA(OTRA, "12.0000000"), pagoA(COBROS, "0.5000000")], 600);
    expect(await motivoContraElEnvio(larga, retiro())).toBe("vence tarde");
  });
});

describe("el costo que pone el sitio", () => {
  const redInicial = network.name;
  const enLaRedPrincipal = (): void => {
    network.name = "mainnet";
  };

  /** La configuración del costo del build y una cuenta de Google con sesión en la red principal. */
  function conCostoConfigurado(): void {
    vi.stubEnv("VITE_RETIRO_COSTO", "0.50");
    vi.stubEnv("VITE_RETIRO_CUENTA", COBROS);
    enLaRedPrincipal();
    billetera.google = true;
    billetera.activa = { address: YO, signTransaction: vi.fn(), signAndSubmit: vi.fn() };
  }

  afterEach(() => {
    network.name = redInicial;
    billetera.activa = null;
    billetera.google = false;
  });

  it("con el costo y la cuenta configurados, una cuenta de Google en la red principal paga el costo", async () => {
    conCostoConfigurado();
    expect(await depsDelSitio().costo?.(YO)).toEqual({ stroops: 5_000_000n, destino: COBROS });
  });

  it("sin costo configurado no se cobra nada", async () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    enLaRedPrincipal();
    billetera.google = true;
    billetera.activa = { address: YO, signTransaction: vi.fn(), signAndSubmit: vi.fn() };
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });

  it("con el costo en cero no se cobra nada", async () => {
    conCostoConfigurado();
    vi.stubEnv("VITE_RETIRO_COSTO", "0");
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });

  it("con el costo y sin la cuenta que lo recibe no se cobra nada", async () => {
    conCostoConfigurado();
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });

  it("con una billetera propia nunca hay costo", async () => {
    conCostoConfigurado();
    billetera.google = false;
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });

  it("fuera de la red principal no hay costo", async () => {
    conCostoConfigurado();
    network.name = "testnet";
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });

  it("para una cuenta que no es la de la sesión no hay costo", async () => {
    conCostoConfigurado();
    expect(await depsDelSitio().costo?.(OTRA)).toBeNull();
  });

  it("sin una sesión abierta no hay costo", async () => {
    conCostoConfigurado();
    billetera.activa = null;
    expect(await depsDelSitio().costo?.(YO)).toBeNull();
  });
});

describe("mandar a firmar un retiro con costo", () => {
  const redInicial = network.name;
  const firmar = vi.fn(async (): Promise<{ signedTxXdr: string }> => ({ signedTxXdr: "firmado" }));
  const mandarSola = vi.fn(async (_xdr: string): Promise<unknown> => ({}));
  const conGoogle = (): void => {
    billetera.google = true;
    billetera.activa = { address: YO, signTransaction: firmar, signAndSubmit: mandarSola };
  };
  /** El costo del retiro configurado en el build, en la red principal: es el que manda, no el de la ventana. */
  const conCostoConfigurado = (): void => {
    vi.stubEnv("VITE_RETIRO_COSTO", "0.50");
    vi.stubEnv("VITE_RETIRO_CUENTA", COBROS);
    network.name = "mainnet";
  };
  /** Las variables del costo apagadas, en la red principal: Mandar es el de siempre. */
  const sinCostoConfigurado = (): void => {
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    network.name = "mainnet";
  };

  afterEach(() => {
    network.name = redInicial;
    billetera.activa = null;
    billetera.google = false;
    firmar.mockClear();
    mandarSola.mockClear();
  });

  it("un retiro con costo de una cuenta de Google que no vota a mano no va por el proveedor: no se pide nada", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
    expect(firmar).not.toHaveBeenCalled();
  });

  it("con el costo configurado, unos datos sin costo no se mandan a firmar", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const xdr = await armarEnvio(retiro({ costo: null }), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro({ costo: null }))).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("con el costo configurado, sin los datos del envío no se manda a firmar", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO)).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("unos datos con otro costo que el configurado no se mandan a firmar, aunque lo armado sea ese otro retiro", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const otro = retiro({ costo: { stroops: 4_000_000n, destino: COBROS } });
    expect(await depsDelSitio().enviar(await armarEnvio(otro, "500"), YO, otro)).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("unos datos con costo sin el costo configurado no se mandan a firmar", async () => {
    sinCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO, retiro())).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("con el costo configurado, pagar a la propia cuenta del costo se manda como siempre: un solo pago", async () => {
    conCostoConfigurado();
    conGoogle();
    const aCobros = retiro({ destino: COBROS, costo: null });
    expect(await depsDelSitio().enviar("XDR", YO, aCobros)).toBe("listo");
    expect(mandarSola).toHaveBeenCalledExactlyOnceWith("XDR");
  });

  it("una transacción con otro costo no se manda a firmar", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const otroCosto = armadaA([pagoA(OTRA, "12.0000000"), pagoA(COBROS, "0.5100000")]);
    expect(await depsDelSitio().enviar(otroCosto, YO, retiro())).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("una transacción que ya venció no se manda a firmar", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    vi.setSystemTime(new Date((AHORA + VIDA_DEL_PAGO_S + 1) * 1000));
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("con costo, una billetera propia no firma nada", async () => {
    conCostoConfigurado();
    billetera.activa = { address: YO, signTransaction: firmar, signAndSubmit: mandarSola };
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-salio");
    expect(firmar).not.toHaveBeenCalled();
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("con datos de otra cuenta que la que firma, no se manda a firmar", async () => {
    conCostoConfigurado();
    conGoogle();
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro({ origen: OTRA }))).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("sin costo configurado, enviar firma como siempre sin mirar la regla", async () => {
    sinCostoConfigurado();
    conGoogle();
    expect(await depsDelSitio().enviar("XDR", YO, retiro({ costo: null }))).toBe("listo");
    expect(mandarSola).toHaveBeenCalledExactlyOnceWith("XDR");
  });

  it("sin costo configurado y sin los datos del envío, enviar firma como siempre", async () => {
    sinCostoConfigurado();
    conGoogle();
    expect(await depsDelSitio().enviar("XDR", YO)).toBe("listo");
    expect(mandarSola).toHaveBeenCalledExactlyOnceWith("XDR");
  });
});

describe("mandar con el voto por contenido: el retiro de la billetera", () => {
  const redInicial = network.name;
  const firmar = vi.fn(async (): Promise<{ signedTxXdr: string }> => ({ signedTxXdr: "firmado" }));
  const mandarSola = vi.fn(async (_xdr: string): Promise<unknown> => ({}));
  const retirar = vi.fn(async (): Promise<ResultadoDelRetiro> => ({ estado: "salio", hash: "a".repeat(64) }));
  /** Una cuenta de Google cuyo kit vota a mano (`aMano`) o no. */
  const conGoogle = (aMano: boolean): void => {
    billetera.google = true;
    billetera.activa = { address: YO, signTransaction: firmar, signAndSubmit: mandarSola, votaPorContenido: () => aMano, retirar };
  };
  const conCostoConfigurado = (): void => {
    vi.stubEnv("VITE_RETIRO_COSTO", "0.50");
    vi.stubEnv("VITE_RETIRO_CUENTA", COBROS);
    network.name = "mainnet";
  };

  afterEach(() => {
    network.name = redInicial;
    billetera.activa = null;
    billetera.google = false;
    firmar.mockClear();
    mandarSola.mockClear();
    retirar.mockClear();
    retirar.mockImplementation(async () => ({ estado: "salio", hash: "a".repeat(64) }));
  });

  it("con el voto a mano, enviar llama a retirar con lo elegido y nunca a firmar y mandar por el proveedor", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    const xdr = await armarEnvio(retiro({ nota: { tipo: "id", valor: "4455" } }), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro({ nota: { tipo: "id", valor: "4455" } }))).toBe("listo");
    expect(retirar).toHaveBeenCalledExactlyOnceWith(xdr, { destino: OTRA, sale: (125n * D) / 10n, nota: { tipo: "id", valor: "4455" } });
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("un retiro incierto queda en curso: no se manda de nuevo", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    retirar.mockImplementation(async () => ({ estado: "incierto" }));
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO, retiro())).toBe("en-curso");
  });

  it("la negativa de la regla es no-coincide, y con el tope no-coincide-tope", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    retirar.mockImplementation(async () => ({ estado: "no-salio", motivo: "no-coincide" }));
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-coincide");
    retirar.mockImplementation(async () => ({ estado: "no-salio", motivo: "no-coincide-tope" }));
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-coincide-tope");
  });

  it("cortado por la persona es no aprobado, y lo demás que no salió es no salió", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    retirar.mockImplementation(async () => ({ estado: "no-salio", motivo: "cancelado" }));
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-aprobado");
    for (const motivo of ["regla", "ahora-no", "red"] as const) {
      retirar.mockImplementation(async () => ({ estado: "no-salio", motivo }));
      expect(await depsDelSitio().enviar(xdr, YO, retiro()), motivo).toBe("no-salio");
    }
  });

  it("un retiro que lanza igual queda en curso: no se dice que no salió", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    retirar.mockImplementation(async () => {
      throw new Error("inesperado");
    });
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO, retiro())).toBe("en-curso");
  });

  it("sin los datos del envío no se pide el retiro", async () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    network.name = "mainnet";
    conGoogle(true);
    expect(await depsDelSitio().enviar("XDR", YO)).toBe("no-salio");
    expect(retirar).not.toHaveBeenCalled();
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("con el voto a mano, unos datos con otro costo que el configurado no llegan a la billetera", async () => {
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    const otro = retiro({ costo: { stroops: 4_000_000n, destino: COBROS } });
    expect(await depsDelSitio().enviar(await armarEnvio(otro, "500"), YO, otro)).toBe("no-salio");
    expect(retirar).not.toHaveBeenCalled();
  });

  it("en el modo premios con la variable del voto y un kit que no vota a mano, no se pide nada", async () => {
    vi.stubEnv("VITE_RAMPA", "premios");
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    conCostoConfigurado();
    conGoogle(false);
    conLaHoraFija();
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO, retiro())).toBe("no-salio");
    expect(retirar).not.toHaveBeenCalled();
    expect(mandarSola).not.toHaveBeenCalled();
  });

  it("en el modo premios con el voto a mano se retira por la billetera", async () => {
    vi.stubEnv("VITE_RAMPA", "premios");
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    conCostoConfigurado();
    conGoogle(true);
    conLaHoraFija();
    expect(await depsDelSitio().enviar(await armarEnvio(retiro(), "500"), YO, retiro())).toBe("listo");
    expect(retirar).toHaveBeenCalledOnce();
  });

  it("sin el voto a mano y fuera del modo premios, un retiro con costo no va por el proveedor ni por la billetera", async () => {
    conCostoConfigurado();
    conGoogle(false);
    conLaHoraFija();
    const xdr = await armarEnvio(retiro(), "500");
    expect(await depsDelSitio().enviar(xdr, YO, retiro())).toBe("no-salio");
    expect(mandarSola).not.toHaveBeenCalled();
    expect(retirar).not.toHaveBeenCalled();
  });

  it("sin el voto a mano, fuera del modo premios y sin costo, firma y manda como siempre", async () => {
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    network.name = "mainnet";
    conGoogle(false);
    expect(await depsDelSitio().enviar("XDR", YO, retiro({ costo: null }))).toBe("listo");
    expect(mandarSola).toHaveBeenCalledExactlyOnceWith("XDR");
    expect(retirar).not.toHaveBeenCalled();
  });

  it("una billetera propia no retira por la billetera de Google aunque el modo vote", async () => {
    vi.stubEnv("VITE_RAMPA", "premios");
    vi.stubEnv("VITE_VOTO_POR_CONTENIDO", "1");
    vi.stubEnv("VITE_RETIRO_COSTO", "");
    vi.stubEnv("VITE_RETIRO_CUENTA", "");
    network.name = "mainnet";
    const firmarNo = vi.fn(async (): Promise<{ signedTxXdr: string }> => {
      throw new Error("sin aprobar");
    });
    billetera.activa = { address: YO, signTransaction: firmarNo, signAndSubmit: mandarSola, retirar };
    expect(await depsDelSitio().enviar("XDR", YO)).toBe("no-aprobado");
    expect(firmarNo).toHaveBeenCalledOnce();
    expect(retirar).not.toHaveBeenCalled();
  });
});
