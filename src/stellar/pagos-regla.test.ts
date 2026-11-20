import { readFileSync } from "node:fs";
import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { USDC_MAINNET, notaDelPremio } from "./pagos";
import {
  COMISION_POR_OPERACION,
  type MotivoDeLaRegla,
  NOTA_DEL_RETIRO,
  type PagoArmado,
  type PedidoDelPremio,
  type PedidoDelRetiro,
  VIDA_DEL_PAGO_S,
  VIDA_MAXIMA_DEL_PAGO_S,
  leerPagoArmado,
  motivoContraElPremio,
  motivoContraElRetiro,
  notaParecidaAUnaOrden,
} from "./pagos-regla";
import { TOPE_DEL_COSTO } from "./retiro-config";

/**
 * Las reglas de contenido de los pagos: que lo que se arma sea exactamente el pago de un premio o un retiro, y nada
 * más. Las transacciones se arman acá con el SDK de Stellar, sin red ni reloj: la hora es un número que pasa la prueba.
 * Cada ataque es un caso: cambia una sola cosa de la transacción esperada y la regla tiene que decir cuál.
 */

const RED = Networks.PUBLIC;
const cuenta = (n: number): string => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)).publicKey();
const PERSONA = cuenta(1);
const GANADORA = cuenta(2);
const COBROS = cuenta(3);
const OTRA = cuenta(4);
const PATROCINA = cuenta(5);
const AMIGA = cuenta(6);
const AHORA = 1_800_000_000;
const VENCE = AHORA + VIDA_DEL_PAGO_S;
const USDC = new Asset(USDC_MAINNET.code, USDC_MAINNET.issuer);
const NOTA_PREMIO = notaDelPremio(7, 0);

type Pago = ReturnType<typeof Operation.payment>;

/** Una operación que no es un pago: el SDK las devuelve con el mismo tipo, pero el compilador las distingue. */
const otraOperacion = (op: unknown): Pago => op as Pago;

/** Un pago en USDC de Circle, sin cuenta propia salvo que se pida. */
function pagar(destino: string, monto: string, o: { activo?: Asset; origen?: string } = {}): Pago {
  return Operation.payment({ destination: destino, asset: o.activo ?? USDC, amount: monto, ...(o.origen ? { source: o.origen } : {}) });
}

/** Una operación que abre la línea del USDC: no es un pago. */
const cambioDeLinea = (): Pago => otraOperacion(Operation.changeTrust({ asset: USDC }));

/** Un pago con conversión al mismo activo: tampoco es un pago simple. */
function conConversion(destino: string, monto: string): Pago {
  return otraOperacion(
    Operation.pathPaymentStrictSend({ sendAsset: USDC, sendAmount: monto, destination: destino, destAsset: USDC, destMin: monto }),
  );
}

/** Lo que se cambia de la transacción esperada. Lo que no se nombra queda como lo arma la página. */
interface Cambios {
  fuente?: string;
  /** La transacción desde la misma cuenta, pero escrita como dirección multiplexada. */
  multiplexada?: boolean;
  /** Las operaciones. */
  ops?: Pago[];
  /** La nota. `null` es sin nota. */
  nota?: Memo | null;
  desde?: number;
  /** El vencimiento en segundos Unix. 0 es sin vencimiento. */
  vence?: number;
  /** La comisión por operación, en stroops. */
  comision?: string;
  /** Una condición extra: se aplica sobre el armador antes de construir. */
  antes?: (b: TransactionBuilder) => TransactionBuilder;
}

/** Arma y serializa una transacción con las operaciones y la nota que se le dan. */
function armar(ops: Pago[], nota: Memo | null, c: Cambios): string {
  const fuente = new Account(c.fuente ?? PERSONA, "100");
  const b = new TransactionBuilder(c.multiplexada ? new MuxedAccount(fuente, "7") : fuente, { fee: c.comision ?? "1000", networkPassphrase: RED });
  for (const op of c.ops ?? ops) b.addOperation(op);
  const memo = c.nota === undefined ? nota : c.nota;
  if (memo) b.addMemo(memo);
  c.antes?.(b);
  b.setTimebounds(c.desde ?? 0, c.vence ?? VENCE);
  return b.build().toXDR();
}

/** El pago del premio, tal cual lo arma la página: 50 dólares digitales a quien ganó, con la nota del puesto. */
const premio = (c: Cambios = {}): string => armar([pagar(GANADORA, "50")], Memo.text(NOTA_PREMIO), c);
/** El retiro con costo: 12,5 a la persona y 0,5 a la cuenta del costo, en ese orden. */
const retiro = (c: Cambios = {}): string => armar([pagar(AMIGA, "12.5"), pagar(COBROS, "0.5")], Memo.text("hola"), c);
/** El retiro sin costo: un solo pago. */
const retiroSinCosto = (c: Cambios = {}): string => armar([pagar(AMIGA, "12.5")], Memo.text("hola"), c);

/** La misma transacción, envuelta en otra que paga la comisión. */
function envolver(armada: string, paga = PATROCINA): string {
  const interior = TransactionBuilder.fromXDR(armada, RED);
  if (interior instanceof FeeBumpTransaction) throw new Error("ya viene envuelta");
  return TransactionBuilder.buildFeeBumpTransaction(paga, "2000", interior, RED).toXDR();
}

/** La misma transacción en el sobre de la versión vieja, que no tiene condiciones ni operaciones con cuenta propia. */
function aSobreViejo(armada: string): string {
  const sobre = xdr.TransactionEnvelope.fromXDR(armada, "base64");
  if (sobre.type !== "envelopeTypeTx") throw new Error("no es un sobre común");
  const tx = sobre.value.tx;
  if (tx.cond.type !== "precondTime") throw new Error("no tiene solo una condición de tiempo");
  const viejo = new xdr.TransactionV0({
    sourceAccountEd25519: StrKey.decodeEd25519PublicKey(PERSONA),
    fee: tx.fee,
    seqNum: tx.seqNum,
    timeBounds: tx.cond.value,
    memo: tx.memo,
    operations: tx.operations,
    ext: xdr.TransactionV0Ext.v0(),
  });
  return xdr.TransactionEnvelope.envelopeTypeTxV0(new xdr.TransactionV0Envelope({ tx: viejo, signatures: [] })).toXDR("base64");
}

const MULTIPLEXADA = (g: string): string => new MuxedAccount(new Account(g, "0"), "7").accountId();

/** La marca de orden de bytes: un carácter que no se ve y en UTF-8 ocupa tres bytes. */
const MARCA = String.fromCharCode(0xfeff);
/** Una nota de texto con la marca de orden de bytes adelante. */
const conMarca = (texto: string): Memo => Memo.text(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(texto)]));

/* ----------------------------------------------------------------------- los pedidos */

const PEDIDO_PREMIO: PedidoDelPremio = { cuenta: PERSONA, destino: GANADORA, monto: "50.0000000", nota: NOTA_PREMIO };
const LLEGA = 125_000_000n;
const COSTO = 5_000_000n;
const PEDIDO_RETIRO: PedidoDelRetiro = {
  cuenta: PERSONA,
  destino: AMIGA,
  llega: LLEGA,
  nota: { tipo: "texto", valor: "hola" },
  costo: { stroops: COSTO, destino: COBROS },
};
const PEDIDO_SIN_COSTO: PedidoDelRetiro = { ...PEDIDO_RETIRO, costo: null };

const leida = (armada: string, red: string = RED): Promise<PagoArmado | null> => leerPagoArmado(armada, red);
const contraElPremio = async (armada: string, p: PedidoDelPremio = PEDIDO_PREMIO, ahora = AHORA): Promise<MotivoDeLaRegla | null> =>
  motivoContraElPremio(await leida(armada), p, { ahora });
const contraElRetiro = async (armada: string, p: PedidoDelRetiro = PEDIDO_RETIRO, ahora = AHORA): Promise<MotivoDeLaRegla | null> =>
  motivoContraElRetiro(await leida(armada), p, { ahora });

/** Una condición que no es de tiempo, para cada tipo que sabe poner el SDK. */
const CONDICIONES_EXTRA: Array<[string, (b: TransactionBuilder) => TransactionBuilder]> = [
  ["límites de ledger", (b) => b.setLedgerbounds(0, 5)],
  ["secuencia mínima", (b) => b.setMinAccountSequence("5")],
  ["edad de la secuencia", (b) => b.setMinAccountSequenceAge(3n)],
  ["distancia de la secuencia", (b) => b.setMinAccountSequenceLedgerGap(2)],
  ["firmantes extra", (b) => b.setExtraSigners([OTRA])],
  ["la forma larga de las condiciones sin nada puesto", (b) => b.setMinAccountSequenceAge(0n)],
];

/* ------------------------------------------------------------------ leer lo armado */

describe("leerPagoArmado: lo que trae una transacción", () => {
  it("lee el premio: cuenta, comisión, vencimiento, nota y el único pago", async () => {
    expect(await leida(premio())).toEqual({
      red: RED,
      sobre: "comun",
      pagaLaComision: null,
      fuente: PERSONA,
      comision: 1000n,
      desde: 0,
      vence: VENCE,
      condicionesExtra: false,
      nota: { tipo: "texto", valor: NOTA_PREMIO },
      operaciones: [
        { tipo: "payment", origen: null, destino: GANADORA, activo: { code: USDC_MAINNET.code, issuer: USDC_MAINNET.issuer }, monto: 500_000_000n },
      ],
    });
  });

  it("lee el retiro con costo: los dos pagos en su orden y la comisión de las dos operaciones", async () => {
    const l = await leida(retiro());
    expect(l?.comision).toBe(2n * COMISION_POR_OPERACION);
    expect(l?.operaciones.map((o) => [o.destino, o.monto])).toEqual([
      [AMIGA, LLEGA],
      [COBROS, COSTO],
    ]);
  });

  it("lee la nota de texto como texto, aunque el SDK la entregue en bytes", async () => {
    expect((await leida(premio()))?.nota).toEqual({ tipo: "texto", valor: NOTA_PREMIO });
  });

  it("lee una nota numérica como número", async () => {
    expect((await leida(retiro({ nota: Memo.id("123") })))?.nota).toEqual({ tipo: "id", valor: "123" });
  });

  it("lee la falta de nota", async () => {
    expect((await leida(retiro({ nota: null })))?.nota).toEqual({ tipo: "ninguna" });
  });

  it("una nota de hash es otra cosa", async () => {
    expect((await leida(retiro({ nota: Memo.hash("ab".repeat(32)) })))?.nota).toEqual({ tipo: "otra" });
  });

  it("una nota de texto que no es texto de verdad es otra cosa", async () => {
    expect((await leida(retiro({ nota: Memo.text(Buffer.from([0xff, 0xfe])) })))?.nota).toEqual({ tipo: "otra" });
  });

  it("una nota de texto con la marca de orden de bytes adelante se lee con la marca", async () => {
    expect((await leida(premio({ nota: conMarca(NOTA_PREMIO) })))?.nota).toEqual({ tipo: "texto", valor: MARCA + NOTA_PREMIO });
  });

  it("lee un destino multiplexado tal cual, sin pasarlo a la cuenta común", async () => {
    const l = await leida(premio({ ops: [pagar(MULTIPLEXADA(GANADORA), "50")] }));
    expect(l?.operaciones[0]?.destino).toBe(MULTIPLEXADA(GANADORA));
  });

  it("lee la cuenta propia de una operación", async () => {
    expect((await leida(premio({ ops: [pagar(GANADORA, "50", { origen: OTRA })] })))?.operaciones[0]?.origen).toBe(OTRA);
  });

  it("lee la moneda nativa como nativa", async () => {
    expect((await leida(premio({ ops: [pagar(GANADORA, "50", { activo: Asset.native() })] })))?.operaciones[0]?.activo).toBe("nativo");
  });

  it("lee una operación que no es un pago sin destino ni monto", async () => {
    const l = await leida(premio({ ops: [cambioDeLinea()] }));
    expect(l?.operaciones[0]).toEqual({ tipo: "changeTrust", origen: null, destino: null, activo: null, monto: null });
  });

  it("lee una transacción sin vencimiento", async () => {
    expect((await leida(premio({ vence: 0 })))?.vence).toBeNull();
  });

  it("lee cuándo empieza a valer", async () => {
    expect((await leida(premio({ desde: AHORA })))?.desde).toBe(AHORA);
  });

  it("lee una transacción envuelta en otra y dice quién paga la comisión", async () => {
    const l = await leida(envolver(premio()));
    expect(l?.sobre).toBe("envuelto");
    expect(l?.pagaLaComision).toBe(PATROCINA);
    expect(l?.fuente).toBe(PERSONA);
  });

  it("lee el sobre de la versión vieja", async () => {
    expect((await leida(aSobreViejo(premio())))?.sobre).toBe("antiguo");
  });

  for (const [que, poner] of CONDICIONES_EXTRA) {
    it(`lee ${que} como una condición que no es de tiempo`, async () => {
      expect((await leida(premio({ antes: poner })))?.condicionesExtra).toBe(true);
    });
  }

  it("lee la red con que se le pide leer", async () => {
    expect((await leida(premio(), Networks.TESTNET))?.red).toBe(Networks.TESTNET);
  });

  const ilegibles: Array<[string, string]> = [
    ["un texto cualquiera", "esto no es una transacción"],
    ["nada", ""],
    ["unos pocos bytes", "AAAA"],
  ];
  for (const [que, armada] of ilegibles) {
    it(`lo que no se puede leer es null y no lanza: ${que}`, async () => {
      expect(await leida(armada)).toBeNull();
    });
  }
});

/* ------------------------------------------------------------------------ el premio */

describe("motivoContraElPremio: el pago de un premio y solo ese", () => {
  it("el premio esperado pasa", async () => {
    expect(await contraElPremio(premio())).toBeNull();
  });

  it("el monto se compara en stroops: el pedido de 50 sin decimales pasa", async () => {
    expect(await contraElPremio(premio(), { ...PEDIDO_PREMIO, monto: "50" })).toBeNull();
  });

  it("el monto se compara en stroops: el pago armado con 50.0000000 pasa", async () => {
    expect(await contraElPremio(premio({ ops: [pagar(GANADORA, "50.0000000")] }))).toBeNull();
  });

  it("un monto con decimales pasa si coincide al stroop", async () => {
    const armada = premio({ ops: [pagar(GANADORA, "12.3456789")] });
    expect(await contraElPremio(armada, { ...PEDIDO_PREMIO, monto: "12.3456789" })).toBeNull();
  });

  it("el último segundo que se acepta pasa: vence a los 300 segundos", async () => {
    expect(await contraElPremio(premio({ vence: AHORA + VIDA_MAXIMA_DEL_PAGO_S }))).toBeNull();
  });

  it("vence un segundo después de ahora y todavía vale", async () => {
    expect(await contraElPremio(premio({ vence: AHORA + 1 }))).toBeNull();
  });

  const ataques: Array<[string, () => string, MotivoDeLaRegla]> = [
    ["otro destino", () => premio({ ops: [pagar(OTRA, "50")] }), "otro destino"],
    ["el destino de quien ganó, pero multiplexado", () => premio({ ops: [pagar(MULTIPLEXADA(GANADORA), "50")] }), "destino multiplexado"],
    ["un monto mayor, por un stroop", () => premio({ ops: [pagar(GANADORA, "50.0000001")] }), "otro monto"],
    ["un monto menor, por un stroop", () => premio({ ops: [pagar(GANADORA, "49.9999999")] }), "otro monto"],
    ["la moneda nativa de la red", () => premio({ ops: [pagar(GANADORA, "50", { activo: Asset.native() })] }), "otro activo"],
    ["un USDC de otro emisor", () => premio({ ops: [pagar(GANADORA, "50", { activo: new Asset("USDC", OTRA) })] }), "otro activo"],
    [
      "otra moneda del mismo emisor",
      () => premio({ ops: [pagar(GANADORA, "50", { activo: new Asset("EURC", USDC_MAINNET.issuer) })] }),
      "otro activo",
    ],
    ["otra nota de texto", () => premio({ nota: Memo.text(notaDelPremio(7, 1)) }), "otra nota"],
    ["la nota de otro sorteo", () => premio({ nota: Memo.text(notaDelPremio(8, 0)) }), "otra nota"],
    ["la nota en mayúsculas", () => premio({ nota: Memo.text(NOTA_PREMIO.toUpperCase()) }), "otra nota"],
    ["una nota numérica", () => premio({ nota: Memo.id("7") }), "otra nota"],
    ["una nota de hash", () => premio({ nota: Memo.hash("ab".repeat(32)) }), "otra nota"],
    ["sin nota", () => premio({ nota: null }), "otra nota"],
    ["la nota con la marca de orden de bytes adelante", () => premio({ nota: conMarca(NOTA_PREMIO) }), "otra nota"],
    ["un segundo pago a quien ganó", () => premio({ ops: [pagar(GANADORA, "50"), pagar(GANADORA, "50")] }), "operaciones de más"],
    ["un segundo pago a otra cuenta", () => premio({ ops: [pagar(GANADORA, "50"), pagar(OTRA, "1")] }), "operaciones de más"],
    [
      "un cambio de firmantes de más",
      () => premio({ ops: [pagar(GANADORA, "50"), otraOperacion(Operation.setOptions({ signer: { ed25519PublicKey: OTRA, weight: 1 } }))] }),
      "operaciones de más",
    ],
    ["un cambio de línea de más", () => premio({ ops: [pagar(GANADORA, "50"), cambioDeLinea()] }), "operaciones de más"],
    ["ninguna operación de pago: solo un cambio de línea", () => premio({ ops: [cambioDeLinea()] }), "no es un pago"],
    ["un cierre de cuenta", () => premio({ ops: [otraOperacion(Operation.accountMerge({ destination: OTRA }))] }), "no es un pago"],
    ["un pago con conversión", () => premio({ ops: [conConversion(GANADORA, "50")] }), "no es un pago"],
    ["envuelta en otra", () => envolver(premio()), "envuelta"],
    ["el sobre de la versión vieja", () => aSobreViejo(premio()), "sobre viejo"],
    ["la transacción desde otra cuenta", () => premio({ fuente: OTRA }), "otra cuenta"],
    ["la transacción desde la misma cuenta, pero multiplexada", () => premio({ multiplexada: true }), "otra cuenta"],
    ["la operación desde otra cuenta", () => premio({ ops: [pagar(GANADORA, "50", { origen: OTRA })] }), "origen en la operación"],
    ["la operación con la misma cuenta escrita", () => premio({ ops: [pagar(GANADORA, "50", { origen: PERSONA })] }), "origen en la operación"],
    ["sin vencimiento", () => premio({ vence: 0 }), "sin vencimiento"],
    ["un vencimiento a 301 segundos", () => premio({ vence: AHORA + VIDA_MAXIMA_DEL_PAGO_S + 1 }), "vence tarde"],
    ["un vencimiento a 10 minutos", () => premio({ vence: AHORA + 600 }), "vence tarde"],
    ["ya vencida", () => premio({ vence: AHORA - 1 }), "vencida"],
    ["vence justo ahora", () => premio({ vence: AHORA }), "vencida"],
    ["con un inicio de validez", () => premio({ desde: AHORA - 10 }), "con inicio"],
    ["una comisión menor", () => premio({ comision: "999" }), "comisión"],
    ["una comisión mayor", () => premio({ comision: "1001" }), "comisión"],
    ["la comisión base de la red", () => premio({ comision: "100" }), "comisión"],
  ];
  for (const [que, armada, motivo] of ataques) {
    it(`no pasa: ${que}`, async () => {
      expect(await contraElPremio(armada())).toBe(motivo);
    });
  }

  for (const [que, poner] of CONDICIONES_EXTRA) {
    it(`no pasa: con ${que}`, async () => {
      expect(await contraElPremio(premio({ antes: poner }))).toBe("condiciones de más");
    });
  }

  it("la misma transacción leída con otra red no pasa", async () => {
    expect(motivoContraElPremio(await leida(premio(), Networks.TESTNET), PEDIDO_PREMIO, { ahora: AHORA })).toBe("otra red");
  });

  it("lo que no se lee no pasa", () => {
    expect(motivoContraElPremio(null, PEDIDO_PREMIO, { ahora: AHORA })).toBe("no se lee");
  });

  const pedidosSinForma: Array<[string, Partial<PedidoDelPremio>]> = [
    ["la cuenta igual al destino", { destino: PERSONA }],
    ["un destino que no es una cuenta", { destino: "no es una cuenta" }],
    ["un destino multiplexado", { destino: MULTIPLEXADA(GANADORA) }],
    ["una cuenta vacía", { cuenta: "" }],
    ["un monto en cero", { monto: "0" }],
    ["un monto en letras", { monto: "tres" }],
    ["un monto con coma", { monto: "1,5" }],
    ["un monto con ocho decimales", { monto: "1.00000001" }],
    ["un monto negativo", { monto: "-5" }],
    ["un monto que no entra en la red", { monto: "922337203685.4775808" }],
    ["una nota vacía", { nota: "" }],
    ["la nota de una orden", { nota: "tk:o:ABCD2345" }],
    ["una nota de premio con ceros de adelante", { nota: "tk:premio:07:0" }],
    ["una nota de premio con el puesto con ceros de adelante", { nota: "tk:premio:7:00" }],
    ["una nota de premio sin sorteo", { nota: "tk:premio::0" }],
    ["una nota de premio que no entra en 28 bytes", { nota: "tk:premio:12345678901234567890:0" }],
  ];
  for (const [que, cambio] of pedidosSinForma) {
    it(`un pedido sin forma no se aprueba nunca: ${que}`, async () => {
      expect(await contraElPremio(premio(), { ...PEDIDO_PREMIO, ...cambio })).toBe("pedido");
    });
  }

  it("una hora que no es un número no deja pasar nada", async () => {
    expect(await contraElPremio(premio(), PEDIDO_PREMIO, Number.NaN)).toBe("pedido");
  });

  it("una hora en cero no deja pasar nada", async () => {
    expect(await contraElPremio(premio(), PEDIDO_PREMIO, 0)).toBe("pedido");
  });
});

/* ------------------------------------------------------------------------ el retiro */

describe("motivoContraElRetiro: el retiro y solo ese", () => {
  describe("sin costo: un solo pago", () => {
    it("pasa con nota de texto", async () => {
      expect(await contraElRetiro(retiroSinCosto(), PEDIDO_SIN_COSTO)).toBeNull();
    });

    it("pasa con nota numérica", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_SIN_COSTO, nota: { tipo: "id", valor: "123456" } };
      expect(await contraElRetiro(retiroSinCosto({ nota: Memo.id("123456") }), pedido)).toBeNull();
    });

    it("pasa sin nota", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_SIN_COSTO, nota: { tipo: "ninguna" } };
      expect(await contraElRetiro(retiroSinCosto({ nota: null }), pedido)).toBeNull();
    });

    it("pasa con la nota fija del retiro", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_SIN_COSTO, nota: { tipo: "texto", valor: NOTA_DEL_RETIRO } };
      expect(await contraElRetiro(retiroSinCosto({ nota: Memo.text(NOTA_DEL_RETIRO) }), pedido)).toBeNull();
    });

    it("una nota numérica con ceros de adelante es el mismo número", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_SIN_COSTO, nota: { tipo: "id", valor: "00123" } };
      expect(await contraElRetiro(retiroSinCosto({ nota: Memo.id("123") }), pedido)).toBeNull();
    });

    it("no pasa con dos pagos: el segundo no estaba pedido", async () => {
      expect(await contraElRetiro(retiro(), PEDIDO_SIN_COSTO)).toBe("operaciones de más");
    });
  });

  describe("con costo: el pago a la persona y después el costo exacto", () => {
    it("el retiro esperado pasa", async () => {
      expect(await contraElRetiro(retiro())).toBeNull();
    });

    it("pasa con nota numérica", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, nota: { tipo: "id", valor: "98765" } };
      expect(await contraElRetiro(retiro({ nota: Memo.id("98765") }), pedido)).toBeNull();
    });

    it("pasa sin nota", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, nota: { tipo: "ninguna" } };
      expect(await contraElRetiro(retiro({ nota: null }), pedido)).toBeNull();
    });

    it("pasa con la nota fija del retiro", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, nota: { tipo: "texto", valor: NOTA_DEL_RETIRO } };
      expect(await contraElRetiro(retiro({ nota: Memo.text(NOTA_DEL_RETIRO) }), pedido)).toBeNull();
    });

    it("pasa con un costo de un stroop si es el que se pidió", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, costo: { stroops: 1n, destino: COBROS } };
      expect(await contraElRetiro(armar([pagar(AMIGA, "12.5"), pagar(COBROS, "0.0000001")], Memo.text("hola"), {}), pedido)).toBeNull();
    });

    it("pasa con el costo más alto que acepta la configuración", async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, costo: { stroops: TOPE_DEL_COSTO, destino: COBROS } };
      expect(await contraElRetiro(armar([pagar(AMIGA, "12.5"), pagar(COBROS, "5")], Memo.text("hola"), {}), pedido)).toBeNull();
    });

    it("pasa en el último segundo que se acepta", async () => {
      expect(await contraElRetiro(retiro({ vence: AHORA + VIDA_MAXIMA_DEL_PAGO_S }))).toBeNull();
    });
  });

  const ataques: Array<[string, () => string, MotivoDeLaRegla]> = [
    ["un costo mayor: 0,51", () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.51")] }), "otro monto del costo"],
    ["un costo mayor por un stroop", () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5000001")] }), "otro monto del costo"],
    ["un costo menor: 0,49", () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.49")] }), "otro monto del costo"],
    ["el costo a otra cuenta", () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(OTRA, "0.5")] }), "otro destino del costo"],
    ["el costo a la propia cuenta", () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(PERSONA, "0.5")] }), "otro destino del costo"],
    [
      "el costo a la cuenta del costo, pero multiplexada",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(MULTIPLEXADA(COBROS), "0.5")] }),
      "destino multiplexado del costo",
    ],
    [
      "el costo en la moneda nativa",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5", { activo: Asset.native() })] }),
      "otro activo del costo",
    ],
    [
      "el costo en un USDC de otro emisor",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5", { activo: new Asset("USDC", OTRA) })] }),
      "otro activo del costo",
    ],
    [
      "el costo con una operación que no es un pago",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), cambioDeLinea()] }),
      "no es un pago del costo",
    ],
    [
      "el costo desde otra cuenta",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5", { origen: OTRA })] }),
      "origen en la operación del costo",
    ],
    [
      "el pago a la persona desde otra cuenta",
      () => retiro({ ops: [pagar(AMIGA, "12.5", { origen: OTRA }), pagar(COBROS, "0.5")] }),
      "origen en la operación",
    ],
    [
      "el pago a la persona con la misma cuenta escrita",
      () => retiro({ ops: [pagar(AMIGA, "12.5", { origen: PERSONA }), pagar(COBROS, "0.5")] }),
      "origen en la operación",
    ],
    [
      "tres operaciones: un tercer pago",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5"), pagar(OTRA, "1")] }),
      "operaciones de más",
    ],
    [
      "tres operaciones: el costo dos veces",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5"), pagar(COBROS, "0.5")] }),
      "operaciones de más",
    ],
    [
      "tres operaciones: un cambio de firmantes al final",
      () => retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5"), otraOperacion(Operation.setOptions({ masterWeight: 0 }))] }),
      "operaciones de más",
    ],
    ["una sola operación con el costo configurado", () => retiro({ ops: [pagar(AMIGA, "12.5")] }), "operaciones de menos"],
    ["el orden al revés: primero el costo", () => retiro({ ops: [pagar(COBROS, "0.5"), pagar(AMIGA, "12.5")] }), "orden al revés"],
    ["otro destino de lo que llega", () => retiro({ ops: [pagar(OTRA, "12.5"), pagar(COBROS, "0.5")] }), "otro destino"],
    ["lo que llega a la cuenta del costo", () => retiro({ ops: [pagar(COBROS, "12.5"), pagar(COBROS, "0.5")] }), "otro destino"],
    ["lo que llega, multiplexado", () => retiro({ ops: [pagar(MULTIPLEXADA(AMIGA), "12.5"), pagar(COBROS, "0.5")] }), "destino multiplexado"],
    ["más de lo que llega", () => retiro({ ops: [pagar(AMIGA, "12.5000001"), pagar(COBROS, "0.5")] }), "otro monto"],
    ["menos de lo que llega", () => retiro({ ops: [pagar(AMIGA, "12.4999999"), pagar(COBROS, "0.5")] }), "otro monto"],
    [
      "lo que llega en la moneda nativa",
      () => retiro({ ops: [pagar(AMIGA, "12.5", { activo: Asset.native() }), pagar(COBROS, "0.5")] }),
      "otro activo",
    ],
    ["lo que llega con un pago con conversión", () => retiro({ ops: [conConversion(AMIGA, "12.5"), pagar(COBROS, "0.5")] }), "no es un pago"],
    ["otra nota de texto", () => retiro({ nota: Memo.text("chau") }), "otra nota"],
    ["una nota numérica donde se pidió texto", () => retiro({ nota: Memo.id("5") }), "otra nota"],
    ["sin nota donde se pidió una", () => retiro({ nota: null }), "otra nota"],
    ["una nota de hash", () => retiro({ nota: Memo.hash("ab".repeat(32)) }), "otra nota"],
    ["la nota con la marca de orden de bytes adelante", () => retiro({ nota: conMarca("hola") }), "otra nota"],
    ["envuelta en otra", () => envolver(retiro()), "envuelta"],
    ["el sobre de la versión vieja", () => aSobreViejo(retiro()), "sobre viejo"],
    ["la transacción desde otra cuenta", () => retiro({ fuente: OTRA }), "otra cuenta"],
    ["la transacción desde la misma cuenta, pero multiplexada", () => retiro({ multiplexada: true }), "otra cuenta"],
    ["sin vencimiento", () => retiro({ vence: 0 }), "sin vencimiento"],
    ["un vencimiento a 301 segundos", () => retiro({ vence: AHORA + VIDA_MAXIMA_DEL_PAGO_S + 1 }), "vence tarde"],
    ["ya vencida", () => retiro({ vence: AHORA - 1 }), "vencida"],
    ["con un inicio de validez", () => retiro({ desde: AHORA - 10 }), "con inicio"],
    ["una comisión de la mitad", () => retiro({ comision: "500" }), "comisión"],
    ["una comisión de más", () => retiro({ comision: "1001" }), "comisión"],
  ];
  for (const [que, armada, motivo] of ataques) {
    it(`no pasa: ${que}`, async () => {
      expect(await contraElRetiro(armada())).toBe(motivo);
    });
  }

  it("la misma transacción leída con otra red no pasa", async () => {
    expect(motivoContraElRetiro(await leida(retiro(), Networks.TESTNET), PEDIDO_RETIRO, { ahora: AHORA })).toBe("otra red");
  });

  for (const [que, poner] of CONDICIONES_EXTRA) {
    it(`no pasa: con ${que}`, async () => {
      expect(await contraElRetiro(retiro({ antes: poner }))).toBe("condiciones de más");
    });
  }

  it("sin costo configurado, dos pagos no pasan aunque el segundo sea el costo", async () => {
    expect(await contraElRetiro(retiro(), PEDIDO_SIN_COSTO)).toBe("operaciones de más");
  });

  it("sin costo configurado, un pago con otro monto no pasa", async () => {
    expect(await contraElRetiro(retiroSinCosto({ ops: [pagar(AMIGA, "13")] }), PEDIDO_SIN_COSTO)).toBe("otro monto");
  });

  it("al destino igual a la cuenta del costo con dos operaciones no pasa: el pedido no tiene forma", async () => {
    const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, destino: COBROS };
    expect(await contraElRetiro(armar([pagar(COBROS, "12.5"), pagar(COBROS, "0.5")], Memo.text("hola"), {}), pedido)).toBe("pedido");
  });

  it("al destino igual a la cuenta del costo, sin costo y con un solo pago, pasa", async () => {
    const pedido: PedidoDelRetiro = { ...PEDIDO_SIN_COSTO, destino: COBROS };
    expect(await contraElRetiro(armar([pagar(COBROS, "12.5")], Memo.text("hola"), {}), pedido)).toBeNull();
  });

  it("lo que no se lee no pasa", () => {
    expect(motivoContraElRetiro(null, PEDIDO_RETIRO, { ahora: AHORA })).toBe("no se lee");
  });

  it("una hora que no es un número no deja pasar nada", async () => {
    expect(await contraElRetiro(retiro(), PEDIDO_RETIRO, Number.NaN)).toBe("pedido");
  });

  const pedidosSinForma: Array<[string, Partial<PedidoDelRetiro>]> = [
    ["la cuenta igual al destino", { destino: PERSONA }],
    ["un destino que no es una cuenta", { destino: "no es una cuenta" }],
    ["un destino multiplexado", { destino: MULTIPLEXADA(AMIGA) }],
    ["una cuenta vacía", { cuenta: "" }],
    ["nada que llegue", { llega: 0n }],
    ["una cantidad negativa que llega", { llega: -1n }],
    ["más de lo que admite la red", { llega: 9_223_372_036_854_775_808n }],
    ["un costo en cero", { costo: { stroops: 0n, destino: COBROS } }],
    ["un costo negativo", { costo: { stroops: -5_000_000n, destino: COBROS } }],
    ["un costo sobre el tope", { costo: { stroops: TOPE_DEL_COSTO + 1n, destino: COBROS } }],
    ["un costo a la propia cuenta", { costo: { stroops: COSTO, destino: PERSONA } }],
    ["un costo al mismo destino que lo que llega", { costo: { stroops: COSTO, destino: AMIGA } }],
    ["un costo a una cuenta multiplexada", { costo: { stroops: COSTO, destino: MULTIPLEXADA(COBROS) } }],
    ["un costo a algo que no es una cuenta", { costo: { stroops: COSTO, destino: "no es una cuenta" } }],
    ["una nota de texto vacía", { nota: { tipo: "texto", valor: "" } }],
    ["una nota de texto que no entra en 28 bytes", { nota: { tipo: "texto", valor: "x".repeat(29) } }],
    ["una nota numérica con letras", { nota: { tipo: "id", valor: "12ab" } }],
    ["una nota numérica que no entra en 64 bits", { nota: { tipo: "id", valor: "18446744073709551616" } }],
  ];
  for (const [que, cambio] of pedidosSinForma) {
    it(`un pedido sin forma no se aprueba nunca: ${que}`, async () => {
      expect(await contraElRetiro(retiro(), { ...PEDIDO_RETIRO, ...cambio })).toBe("pedido");
    });
  }
});

/* --------------------------------------------------------------- las notas de orden */

describe("el retiro no lleva una nota que se pueda leer como una orden", () => {
  const parecidas = [
    "tk:o:ABCD2345",
    "TK:O:abcd2345",
    "tk:0:ABCD2345",
    "tk:premio:7:0",
    " t k : o : ABCD2345",
    "t-k:o:ABCD2345",
    "tk–:o:ABCD2345",
    "t−k:o:ABCD2345",
    "\ttk:o:ABCD2345",
    "tk:",
  ];
  for (const nota of parecidas) {
    it(`notaParecidaAUnaOrden dice que sí: ${JSON.stringify(nota)}`, () => {
      expect(notaParecidaAUnaOrden(nota)).toBe(true);
    });
    it(`el retiro con la nota ${JSON.stringify(nota)} no pasa, sea cual sea la transacción`, async () => {
      const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, nota: { tipo: "texto", valor: nota } };
      const armada = retiro({ nota: Memo.text(nota) });
      expect(await contraElRetiro(armada, pedido)).toBe("nota de orden");
    });
  }

  const distintas = [NOTA_DEL_RETIRO, "hola", "tk", "tkz:o:ABCD2345", "otk:o:ABCD2345", "pago tk:o:ABCD2345", "0:tk:", "t:k:"];
  for (const nota of distintas) {
    it(`notaParecidaAUnaOrden dice que no: ${JSON.stringify(nota)}`, () => {
      expect(notaParecidaAUnaOrden(nota)).toBe(false);
    });
  }

  it("una nota numérica se acepta aunque sea el número de una orden: el costo no se lee por la nota", async () => {
    const pedido: PedidoDelRetiro = { ...PEDIDO_RETIRO, nota: { tipo: "id", valor: "1099511627775" } };
    expect(await contraElRetiro(retiro({ nota: Memo.id("1099511627775") }), pedido)).toBeNull();
  });
});

/* ------------------------------------------------------------------- los motivos */

describe("los motivos", () => {
  /** Lo que dice la regla de una muestra de ataques, uno por cada tipo de transacción que se le tira. `null` si alguno pasó. */
  async function todosLosMotivos(): Promise<Array<MotivoDeLaRegla | null>> {
    const motivos: Array<MotivoDeLaRegla | null> = [];
    const premios = [
      premio({ ops: [pagar(OTRA, "50")] }),
      premio({ ops: [pagar(MULTIPLEXADA(GANADORA), "50")] }),
      premio({ ops: [pagar(GANADORA, "51")] }),
      premio({ nota: null }),
      premio({ fuente: OTRA }),
      premio({ ops: [pagar(GANADORA, "50", { origen: OTRA })] }),
      envolver(premio()),
      aSobreViejo(premio()),
      premio({ vence: 0 }),
      premio({ vence: AHORA + 900 }),
      premio({ comision: "1" }),
    ];
    for (const armada of premios) motivos.push(await contraElPremio(armada));
    const retiros = [
      retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.51")] }),
      retiro({ ops: [pagar(AMIGA, "12.5"), pagar(OTRA, "0.5")] }),
      retiro({ ops: [pagar(COBROS, "0.5"), pagar(AMIGA, "12.5")] }),
      retiro({ ops: [pagar(AMIGA, "12.5"), pagar(COBROS, "0.5"), pagar(OTRA, "1")] }),
      retiro({ ops: [pagar(AMIGA, "12.5")] }),
      retiro({ nota: Memo.text("chau") }),
    ];
    for (const armada of retiros) motivos.push(await contraElRetiro(armada));
    motivos.push(motivoContraElPremio(null, PEDIDO_PREMIO, { ahora: AHORA }));
    return motivos;
  }

  it("todos los casos de la muestra dan un motivo", async () => {
    expect(await todosLosMotivos()).not.toContain(null);
  });

  it("ningún motivo trae una dirección de cuenta, una nota ni un monto", async () => {
    const motivos = (await todosLosMotivos()).filter((m): m is MotivoDeLaRegla => m !== null);
    expect(motivos.length).toBeGreaterThan(10);
    for (const m of motivos) {
      expect(m).not.toMatch(/[GCM][A-Z2-7]{55}/);
      expect(m).not.toMatch(/tk:|\d/);
      expect(m.length).toBeLessThan(40);
    }
  });

  it("ninguna dirección de cuenta está escrita en el código de las reglas", () => {
    const fuente = readFileSync(new URL("./pagos-regla.ts", import.meta.url), "utf8");
    expect(fuente).not.toMatch(/[GCM][A-Z2-7]{55}/);
  });
});

describe("las constantes de los pagos", () => {
  it("el pago vive 4 minutos y las reglas aceptan hasta 5, lo que acepta el portero", () => {
    expect(VIDA_DEL_PAGO_S).toBe(240);
    expect(VIDA_MAXIMA_DEL_PAGO_S).toBe(300);
    expect(VIDA_DEL_PAGO_S).toBeLessThan(VIDA_MAXIMA_DEL_PAGO_S);
  });

  it("la comisión es 1000 stroops por operación", () => {
    expect(COMISION_POR_OPERACION).toBe(1000n);
  });

  it("la nota fija del retiro no se puede leer como una orden", () => {
    expect(notaParecidaAUnaOrden(NOTA_DEL_RETIRO)).toBe(false);
  });
});
