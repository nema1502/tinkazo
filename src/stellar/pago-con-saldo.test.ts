import { Account, Asset, Keypair, Memo, MuxedAccount, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { DOLAR_DIGITAL, type PagoLeido, type PagoPedido, VIDA_DEL_PAGO_S, leerElPago, montoExacto, motivoContraElPago, motivoDelRechazo } from "./pago-con-saldo";

/**
 * La regla que decide si el pago que armó el proveedor es exactamente el de la orden: una sola operación, de pago, desde
 * la cuenta de la persona, a la cuenta de la orden, por el monto de la orden, en el USDC de Circle, con la nota de la
 * orden y con vencimiento cercano. Las transacciones se arman acá con el SDK de Stellar, sin red.
 */

const RED = Networks.PUBLIC;
const cuenta = (n: number): Keypair => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n));
const PERSONA = cuenta(1).publicKey();
const COBROS = cuenta(2).publicKey();
const OTRA = cuenta(3).publicKey();
const PATROCINA = cuenta(4).publicKey();
const AHORA = 1_800_000_000;
const NOTA = "tk:o:ABCD2345";
const PEDIDO: PagoPedido = { cuenta: PERSONA, destino: COBROS, monto: "3", nota: NOTA };
const USDC = new Asset(DOLAR_DIGITAL.code, DOLAR_DIGITAL.issuer);

interface Armado {
  fuente?: string;
  ops?: ReturnType<typeof Operation.payment>[];
  memo?: Memo | null;
  vence?: number;
}

/** El pago de la orden, tal cual, o con lo que se cambie. */
function armar(o: Armado = {}): string {
  const b = new TransactionBuilder(new Account(o.fuente ?? PERSONA, "100"), { fee: "100", networkPassphrase: RED });
  for (const op of o.ops ?? [Operation.payment({ destination: COBROS, asset: USDC, amount: "3" })]) b.addOperation(op);
  const memo = o.memo === undefined ? Memo.text(NOTA) : o.memo;
  if (memo) b.addMemo(memo);
  b.setTimebounds(0, o.vence ?? AHORA + VIDA_DEL_PAGO_S);
  return b.build().toXDR();
}

/** El mismo pago, envuelto: otra cuenta paga la comisión (como lo devuelve el proveedor cuando patrocina). */
function envolver(xdr: string, paga = PATROCINA): string {
  const interior = TransactionBuilder.fromXDR(xdr, RED);
  if (!("operations" in interior) || "innerTransaction" in interior) throw new Error("no es una transacción simple");
  return TransactionBuilder.buildFeeBumpTransaction(paga, "200", interior as Parameters<typeof TransactionBuilder.buildFeeBumpTransaction>[2], RED).toXDR();
}

const leer = async (xdr: string): Promise<PagoLeido | null> => leerElPago(xdr, RED);
const antes = async (xdr: string, p: PagoPedido = PEDIDO): Promise<string | null> => motivoContraElPago(await leer(xdr), p, { ahora: AHORA, firmada: false });
const despues = async (xdr: string, p: PagoPedido = PEDIDO): Promise<string | null> => motivoContraElPago(await leer(xdr), p, { ahora: AHORA, firmada: true });

describe("el dólar digital es el USDC de Circle", () => {
  it("es el USDC de Circle con su emisor en la red principal, y nada más", () => {
    expect(DOLAR_DIGITAL).toEqual({ code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" });
  });
});

describe("montoExacto: el monto de la orden con siete decimales", () => {
  it("como lo escribe el servidor", () => {
    expect(montoExacto("3")).toBe("3.0000000");
    expect(montoExacto("2.85")).toBe("2.8500000");
    expect(montoExacto("0.0000001")).toBe("0.0000001");
  });
  it("lo que no es un monto positivo, no", () => {
    for (const m of ["", "0", "-1", "abc", "1.00000001", "1e3", " 3"]) expect(montoExacto(m), m).toBeNull();
  });
});

describe("antes de firmar: se aprueba el pago de la orden y solo ese", () => {
  it("el pago exacto de la orden pasa", async () => {
    expect(await antes(armar())).toBeNull();
  });

  it("con la operación a nombre de la misma cuenta, también", async () => {
    expect(await antes(armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3", source: PERSONA })] }))).toBeNull();
  });

  it("el monto se compara en unidades mínimas: 3 y 3.0000000 son lo mismo", async () => {
    expect(await antes(armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3.0000000" })] }))).toBeNull();
    expect(await antes(armar(), { ...PEDIDO, monto: "3.0000000" })).toBeNull();
  });

  const parecidos: Array<[string, () => string]> = [
    ["otro destino", () => armar({ ops: [Operation.payment({ destination: OTRA, asset: USDC, amount: "3" })] })],
    ["el destino de la orden, pero multiplexado", () => armar({ ops: [Operation.payment({ destination: new MuxedAccount(new Account(COBROS, "0"), "7").accountId(), asset: USDC, amount: "3" })] })],
    ["un monto mayor", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3.0000001" })] })],
    ["un monto menor", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "2.99" })] })],
    ["la moneda nativa de la red", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: Asset.native(), amount: "3" })] })],
    ["un USDC de otro emisor", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: new Asset("USDC", OTRA), amount: "3" })] })],
    ["otra moneda del mismo emisor", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: new Asset("EURC", DOLAR_DIGITAL.issuer), amount: "3" })] })],
    ["sin nota", () => armar({ memo: null })],
    ["otra nota", () => armar({ memo: Memo.text("tk:o:ZZZZ9999") })],
    ["la nota en minúsculas", () => armar({ memo: Memo.text(NOTA.toLowerCase()) })],
    ["una nota numérica", () => armar({ memo: Memo.id("123") })],
    ["dos pagos", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3" }), Operation.payment({ destination: COBROS, asset: USDC, amount: "3" })] })],
    ["el pago y otra operación", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3" }), Operation.changeTrust({ asset: new Asset("TK", OTRA) }) as never] })],
    ["el pago y otro pago a otra cuenta", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3" }), Operation.payment({ destination: OTRA, asset: USDC, amount: "1" })] })],
    ["una operación que no es un pago", () => armar({ ops: [Operation.changeTrust({ asset: USDC }) as never] })],
    ["un pago con conversión", () => armar({ ops: [Operation.pathPaymentStrictSend({ sendAsset: USDC, sendAmount: "3", destination: COBROS, destAsset: USDC, destMin: "3" }) as never] })],
    ["un cambio de firmantes", () => armar({ ops: [Operation.setOptions({ signer: { ed25519PublicKey: OTRA, weight: 1 } }) as never] })],
    ["la transacción desde otra cuenta", () => armar({ fuente: OTRA })],
    ["la operación desde otra cuenta", () => armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "3", source: OTRA })] })],
    ["sin vencimiento", () => armar({ vence: 0 })],
    ["un vencimiento lejano", () => armar({ vence: AHORA + 3_600 })],
    ["ya vencida", () => armar({ vence: AHORA - 1 })],
    ["envuelta antes de firmar", () => envolver(armar())],
  ];
  for (const [que, xdr] of parecidos) {
    it(`no pasa: ${que}`, async () => {
      expect(await antes(xdr())).not.toBeNull();
    });
  }

  it("el motivo es una palabra fija: nunca una cuenta, la nota ni la transacción", async () => {
    for (const [que, xdr] of parecidos) {
      const m = (await antes(xdr())) ?? "";
      expect(m, que).not.toMatch(/G[A-Z2-7]{55}|M[A-Z2-7]{60,}|tk:o:/);
      expect(m.length, que).toBeLessThan(60);
    }
  });

  it("un pedido que no tiene forma no se aprueba nunca", async () => {
    const xdr = armar();
    for (const p of [
      { ...PEDIDO, cuenta: COBROS },
      { ...PEDIDO, destino: "no es una cuenta" },
      { ...PEDIDO, cuenta: "" },
      { ...PEDIDO, monto: "0" },
      { ...PEDIDO, monto: "tres" },
      { ...PEDIDO, nota: "" },
    ])
      expect(await antes(xdr, p), JSON.stringify(p)).not.toBeNull();
  });

  it("lo que no se lee no se aprueba", async () => {
    expect(motivoContraElPago(null, PEDIDO, { ahora: AHORA, firmada: false })).not.toBeNull();
    expect(await leer("esto no es una transacción")).toBeNull();
    expect(await leer("")).toBeNull();
  });

  it("lee la nota de texto como texto, también cuando el SDK la entrega en bytes", async () => {
    expect((await leer(armar()))?.nota).toEqual({ tipo: "text", texto: NOTA });
  });
});

describe("después de firmar: lo que se manda", () => {
  it("envuelto con la comisión a cargo de otra cuenta, y el pago de adentro exacto: se manda", async () => {
    expect(await despues(envolver(armar()))).toBeNull();
  });

  it("sin envolver, la comisión la pagaría la persona: no se manda", async () => {
    expect(await despues(armar())).toBe("sin-patrocinio");
  });

  it("envuelto, pero con la comisión a cargo de la misma persona: tampoco", async () => {
    expect(await despues(envolver(armar(), PERSONA))).toBe("sin-patrocinio");
  });

  it("envuelto, con el pago de adentro cambiado: no se manda", async () => {
    for (const xdr of [
      armar({ ops: [Operation.payment({ destination: OTRA, asset: USDC, amount: "3" })] }),
      armar({ ops: [Operation.payment({ destination: COBROS, asset: USDC, amount: "30" })] }),
      armar({ memo: null }),
      armar({ fuente: OTRA }),
    ]) {
      const m = await despues(envolver(xdr));
      expect(m).not.toBeNull();
      expect(m).not.toBe("sin-patrocinio");
    }
  });
});

describe("motivoDelRechazo: qué dijo la red cuando no tomó el pago", () => {
  const casos: Array<[string[], ReturnType<typeof motivoDelRechazo>]> = [
    [["txFailed", "paymentUnderfunded"], "sin-saldo"],
    [["op_underfunded"], "sin-saldo"],
    [["paymentSrcNoTrust"], "sin-linea"],
    [["op_src_no_trust"], "sin-linea"],
    [["paymentSrcNotAuthorized"], "sin-linea"],
    [["paymentNoTrust"], "destino"],
    [["op_no_destination"], "destino"],
    [["TX_LINE_FULL"], "destino"],
    [["tx_too_late"], "rechazado"],
    [["txInsufficientBalance"], "rechazado"],
    [["TX_INSUFFICIENT_BALANCE"], "rechazado"],
    [["txFailed"], "rechazado"],
    // Lo que no dice que la red lo rechazó: no se sabe si salió.
    [[], null],
    [["Failed to fetch"], null],
    [["TX_SUBMIT_FAILED"], null],
    [["SDK_NETWORK_TIMEOUT"], null],
    [["algo raro"], null],
  ];
  for (const [codigos, motivo] of casos) {
    it(`${JSON.stringify(codigos)}: ${String(motivo)}`, () => {
      expect(motivoDelRechazo(codigos)).toBe(motivo);
    });
  }

  // La secuencia corrida no dice que este pago no entró: otro envío con la misma secuencia pudo ser este mismo pago,
  // mandado dos veces. Con la compra con QR en el build no se sabe, y un pago que quizás salió no se manda de nuevo.
  // Sin ella, el sitio queda como siempre: rechazado.
  const SECUENCIA = [["txBadSeq"], ["tx_bad_seq"], ["TX_BAD_SEQUENCE"], ["txFailed", "txBadSeq"]];
  it("la secuencia corrida, con la compra con QR en el build: no se sabe si salió", () => {
    for (const codigos of SECUENCIA) expect(motivoDelRechazo(codigos, { secuenciaIncierta: true }), JSON.stringify(codigos)).toBeNull();
  });
  it("la secuencia corrida, sin la compra con QR: rechazado, como siempre", () => {
    for (const codigos of SECUENCIA) expect(motivoDelRechazo(codigos), JSON.stringify(codigos)).toBe("rechazado");
    for (const codigos of SECUENCIA) expect(motivoDelRechazo(codigos, { secuenciaIncierta: false }), JSON.stringify(codigos)).toBe("rechazado");
  });
});
