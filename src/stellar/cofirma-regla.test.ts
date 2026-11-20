import {
  Account,
  Asset,
  Contract,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  SorobanDataBuilder,
  StrKey,
  type Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  COFIRMA_DISTINTA,
  COFIRMA_TOPE,
  CONSULTAS_DEL_ENVIO,
  type DepsDelDesenlace,
  ESPERA_ENTRE_CONSULTAS_MS,
  type EnvioDelKit,
  type EstadoDelEnvio,
  type IntencionDeFirma,
  TOPE_DE_DISTINTAS,
  compararConLaArmada,
  describirLaNegativa,
  describirLinea,
  describirPedido,
  desenlaceDelVoto,
  esDeEstaLlamada,
  leerLaArmada,
  leerLaLinea,
  listarLosCampos,
  motivoContraElPedido,
  motivoContraLaLinea,
  motivoContraLoPermitido,
} from "./cofirma-regla";
import type { PedidoDeCofirma } from "./wallet-pollar";

/**
 * La comparación de lo que Pollar pide votar con lo que armó la página (`cofirma-regla.ts`), campo por campo, y las
 * líneas del testigo que lo cuentan. Todo con transacciones armadas acá, con la frase de la red principal, sin reloj
 * ni red: los límites de tiempo son fijos, así dos transacciones armadas igual son idénticas.
 */

const RED = Networks.PUBLIC;
const P = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const EMISOR = Keypair.random().publicKey();
const OTRO_EMISOR = Keypair.random().publicKey();
const DESTINO = Keypair.random().publicKey();
const CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(7));
const USDC = { code: "USDC", issuer: EMISOR };
const LIMITE_MAXIMO = "922337203685.4775807";

interface Opciones {
  origen?: string | MuxedAccount;
  secuencia?: string;
  comision?: string;
  operaciones?: xdr.Operation[];
  nota?: Memo;
  condiciones?: Partial<ConstructorParameters<typeof TransactionBuilder>[1]>;
  soroban?: xdr.SorobanTransactionData;
}

const sello = (): xdr.Operation => Operation.invokeContractFunction({ contract: CONTRATO, function: "seal", args: [] });
const dato = (nombre: string, valor = "x"): xdr.Operation => Operation.manageData({ name: nombre, value: valor });
const pago = (monto: string, destino = DESTINO, emisor = EMISOR): xdr.Operation =>
  Operation.payment({ destination: destino, asset: new Asset("USDC", emisor), amount: monto });
const firmanteExtra = (): xdr.Operation => Operation.setOptions({ signer: { ed25519PublicKey: OTRA, weight: 1 } });
const recursos = (instrucciones: number): xdr.SorobanTransactionData => new SorobanDataBuilder().setResources(instrucciones, 1000, 2000).build();

/** Una transacción con todo fijo: la misma llamada da siempre los mismos bytes. */
function armar(o: Opciones = {}): Transaction {
  const origen = o.origen ?? P;
  const cuenta = typeof origen === "string" ? new Account(origen, o.secuencia ?? "10") : origen;
  const b = new TransactionBuilder(cuenta, {
    fee: o.comision ?? "1000",
    networkPassphrase: RED,
    timebounds: { minTime: 0, maxTime: 1_900_000_000 },
    ...o.condiciones,
    ...(o.nota ? { memo: o.nota } : {}),
    ...(o.soroban ? { sorobanData: o.soroban } : {}),
  });
  for (const op of o.operaciones ?? [sello()]) b.addOperation(op);
  return b.build();
}

const hashDe = (t: { hash(): Uint8Array }): string => Buffer.from(t.hash()).toString("hex");
const firmada = (t: Transaction): Transaction => {
  const copia = TransactionBuilder.fromXDR(t.toXDR(), RED) as Transaction;
  copia.sign(Keypair.random());
  return copia;
};
const envolver = (t: Transaction): string => TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "100000", t, RED).toXDR();

/** El cuerpo de una transacción armada acá, que siempre es de tipo 2. */
function cuerpoDe(t: Transaction): xdr.Transaction {
  const sobre = t.toEnvelope();
  if (sobre.type !== "envelopeTypeTx") throw new Error("la prueba esperaba un sobre de tipo 2");
  return sobre.v1.tx;
}

/** El mismo cuerpo en un sobre de tipo 0, el de antes de los sobres de hoy. */
function sobreViejo(t: Transaction): string {
  const c = cuerpoDe(t);
  const v0 = new xdr.TransactionV0({
    sourceAccountEd25519: Keypair.fromPublicKey(P).rawPublicKey(),
    fee: c.fee,
    seqNum: c.seqNum,
    timeBounds: null,
    memo: c.memo,
    operations: c.operations,
    ext: xdr.TransactionV0Ext.v0(),
  });
  return xdr.TransactionEnvelope.envelopeTypeTxV0(new xdr.TransactionV0Envelope({ tx: v0, signatures: [] })).toXdr("base64");
}

/** La misma transacción sin ninguna condición, como la línea del dólar digital que arma el proveedor. */
function sinCondiciones(t: Transaction): string {
  const c = cuerpoDe(t);
  const tx = new xdr.Transaction({
    sourceAccount: c.sourceAccount,
    fee: c.fee,
    seqNum: c.seqNum,
    cond: xdr.Preconditions.precondNone(),
    memo: c.memo,
    operations: c.operations,
    ext: c.ext,
  });
  return xdr.TransactionEnvelope.envelopeTypeTx(new xdr.TransactionV1Envelope({ tx, signatures: [] })).toXdr("base64");
}

async function distintos(armada: Transaction, pedido: string | undefined, payloadHash?: string) {
  const c = await compararConLaArmada(armada.toXDR(), pedido, RED, payloadHash);
  if (c.igual) throw new Error("la prueba esperaba una diferencia");
  return c;
}

describe("compararConLaArmada: lo que es igual", () => {
  it("la misma transacción da igual, con el hash de la armada", async () => {
    const a = armar();
    await expect(compararConLaArmada(a.toXDR(), a.toXDR(), RED)).resolves.toEqual({ igual: true, hash: hashDe(a), firmasEnElSobre: 0 });
  });

  it("la misma con una firma ajena en el sobre da igual y cuenta una firma", async () => {
    const a = armar();
    await expect(compararConLaArmada(a.toXDR(), firmada(a).toXDR(), RED)).resolves.toEqual({ igual: true, hash: hashDe(a), firmasEnElSobre: 1 });
  });

  it("con el hash que dice el pedido, el de la armada, sigue siendo igual, también en mayúsculas", async () => {
    const a = armar();
    await expect(compararConLaArmada(a.toXDR(), a.toXDR(), RED, hashDe(a).toUpperCase())).resolves.toMatchObject({ igual: true });
  });
});

describe("compararConLaArmada: operaciones", () => {
  it("otra operación (un manageData en vez del sello) da operacion con su índice y los tipos del pedido", async () => {
    const c = await distintos(armar(), armar({ operaciones: [dato("tinkazo", "sello")] }).toXDR());
    expect(c).toEqual({ igual: false, campos: ["operacion"], operaciones: [0], tipos: ["manageData"] });
  });

  it.each([
    ["otro destino", pago("5"), pago("5", OTRA)],
    ["otro monto", pago("5"), pago("6")],
    ["otro emisor del USDC", pago("5"), pago("5", DESTINO, OTRO_EMISOR)],
  ])("%s en el pago da operacion", async (_caso, armada, pedido) => {
    const c = await distintos(armar({ operaciones: [armada] }), armar({ operaciones: [pedido] }).toXDR());
    expect(c.campos).toEqual(["operacion"]);
    expect(c.operaciones).toEqual([0]);
    expect(c.tipos).toEqual(["payment"]);
  });

  it("una operación de más (setOptions con otro firmante) da cantidad, sin decir cuál", async () => {
    // La comisión es por operación: se reparte para que el total sea el mismo y solo cambie la cantidad.
    const mas = armar({ operaciones: [sello(), firmanteExtra()], comision: "1000" });
    const c = await distintos(armar({ comision: "2000" }), mas.toXDR());
    expect(c).toEqual({ igual: false, campos: ["cantidad"], operaciones: [], tipos: ["invokeHostFunction", "setOptions"] });
  });

  it("una operación de menos da cantidad", async () => {
    const c = await distintos(armar({ operaciones: [sello(), dato("a")], comision: "1000" }), armar({ comision: "2000" }).toXDR());
    expect(c.campos).toEqual(["cantidad"]);
  });

  it("una operación de más suma también la comisión, que es por operación", async () => {
    const c = await distintos(armar(), armar({ operaciones: [sello(), firmanteExtra()] }).toXDR());
    expect(c.campos).toEqual(["comision", "cantidad"]);
  });

  it("las mismas operaciones en otro orden dan operacion, con los dos índices", async () => {
    const c = await distintos(armar({ operaciones: [dato("a"), dato("b")] }), armar({ operaciones: [dato("b"), dato("a")] }).toXDR());
    expect(c.campos).toEqual(["operacion"]);
    expect(c.operaciones).toEqual([0, 1]);
  });

  it("solo la segunda operación distinta da el índice 1", async () => {
    const c = await distintos(armar({ operaciones: [dato("a"), dato("b")] }), armar({ operaciones: [dato("a"), dato("c")] }).toXDR());
    expect(c.operaciones).toEqual([1]);
  });
});

describe("compararConLaArmada: cuenta, secuencia, comisión y nota", () => {
  it("la paga otra cuenta y la operación queda con la persona da cuenta", async () => {
    const armada = armar({ operaciones: [Operation.endSponsoringFutureReserves({ source: P })] });
    const pedido = armar({ origen: OTRA, operaciones: [Operation.endSponsoringFutureReserves({ source: P })] });
    const c = await distintos(armada, pedido.toXDR());
    expect(c.campos).toEqual(["cuenta"]);
  });

  it("una dirección M de la misma cuenta es otra cuenta", async () => {
    const m = new MuxedAccount(new Account(P, "10"), "5");
    const c = await distintos(armar({ operaciones: [dato("a")] }), armar({ origen: m, operaciones: [dato("a")] }).toXDR());
    expect(c.campos).toEqual(["cuenta"]);
  });

  it("otra secuencia da exactamente secuencia", async () => {
    const c = await distintos(armar({ secuencia: "10" }), armar({ secuencia: "11" }).toXDR());
    expect(c.campos).toEqual(["secuencia"]);
  });

  it("otra secuencia y otra comisión a la vez dan las dos, en ese orden", async () => {
    const c = await distintos(armar({ secuencia: "10" }), armar({ secuencia: "11", comision: "5000" }).toXDR());
    expect(c.campos).toEqual(["secuencia", "comision"]);
  });

  it("otra comisión da exactamente comision", async () => {
    const c = await distintos(armar(), armar({ comision: "2000" }).toXDR());
    expect(c.campos).toEqual(["comision"]);
  });

  it.each([
    ["otra nota de texto", Memo.text("a"), Memo.text("b")],
    ["otra nota numérica", Memo.id("1"), Memo.id("2")],
    ["la nota de texto cambiada por una numérica", Memo.text("1"), Memo.id("1")],
    ["sin nota", Memo.text("a"), undefined],
    ["con una nota de más", undefined, Memo.text("a")],
  ])("%s da nota", async (_caso, armada, pedido) => {
    const conNota = (nota: Memo | undefined): Transaction => armar({ operaciones: [dato("a")], ...(nota ? { nota } : {}) });
    const c = await distintos(conNota(armada), conNota(pedido).toXDR());
    expect(c.campos).toEqual(["nota"]);
  });

  it("la misma nota de texto da igual", async () => {
    const a = armar({ operaciones: [dato("a")], nota: Memo.text("tk:premio") });
    const pedido = armar({ operaciones: [dato("a")], nota: Memo.text("tk:premio") });
    await expect(compararConLaArmada(a.toXDR(), pedido.toXDR(), RED)).resolves.toMatchObject({ igual: true });
  });
});

describe("compararConLaArmada: condiciones y datos del contrato", () => {
  it.each([
    ["otros límites de tiempo", { timebounds: { minTime: 0, maxTime: 1_900_000_001 } }],
    ["una secuencia mínima", { minAccountSequence: "5" }],
    ["un firmante extra", { extraSigners: [OTRA] }],
    ["un límite de ledger", { ledgerbounds: { minLedger: 1, maxLedger: 2 } }],
  ])("%s da condiciones", async (_caso, condiciones) => {
    const c = await distintos(armar(), armar({ condiciones }).toXDR());
    expect(c.campos).toEqual(["condiciones"]);
  });

  it.each([
    ["otros recursos", recursos(100), recursos(200)],
    [
      "otra huella de lectura y escritura",
      new SorobanDataBuilder().setReadOnly([new Contract(CONTRATO).getFootprint()]).build(),
      new SorobanDataBuilder().setReadWrite([new Contract(CONTRATO).getFootprint()]).build(),
    ],
  ])("%s dan contrato", async (_caso, armada, pedido) => {
    const c = await distintos(armar({ soroban: armada }), armar({ soroban: pedido }).toXDR());
    expect(c.campos).toEqual(["contrato"]);
  });

  it("otra comisión de recursos da contrato, y también la comisión de la transacción, que la incluye", async () => {
    const armada = armar({ soroban: new SorobanDataBuilder().setResourceFee("1000").build() });
    const pedido = armar({ soroban: new SorobanDataBuilder().setResourceFee("90000").build() });
    const c = await distintos(armada, pedido.toXDR());
    expect(c.campos).toEqual(["comision", "contrato"]);
  });

  it("los mismos datos del contrato dan igual", async () => {
    const armada = armar({ soroban: recursos(100) });
    await expect(compararConLaArmada(armada.toXDR(), armar({ soroban: recursos(100) }).toXDR(), RED)).resolves.toMatchObject({ igual: true });
  });
});

describe("compararConLaArmada: el sobre y lo que no se lee", () => {
  it("envuelta en un fee bump, aunque adentro sea la misma, da envuelta", async () => {
    const a = armar();
    const c = await distintos(a, envolver(a));
    expect(c.campos).toEqual(["envuelta"]);
    expect(c.tipos).toEqual(["invokeHostFunction"]);
  });

  it("envuelta con otra operación adentro da envuelta y operacion: la interior se compara igual", async () => {
    const c = await distintos(armar(), envolver(armar({ operaciones: [dato("a")] })));
    expect(c.campos).toEqual(["envuelta", "operacion"]);
    expect(c.operaciones).toEqual([0]);
  });

  it("envuelta con otra secuencia adentro da envuelta y secuencia", async () => {
    const c = await distintos(armar({ secuencia: "10" }), envolver(armar({ secuencia: "11" })));
    expect(c.campos).toEqual(["envuelta", "secuencia"]);
  });

  it("un sobre de tipo 0 da sobre, con los tipos de sus operaciones", async () => {
    const c = await distintos(armar(), sobreViejo(armar()));
    expect(c).toEqual({ igual: false, campos: ["sobre"], operaciones: [], tipos: ["invokeHostFunction"] });
  });

  it("una armada que no es de tipo 2 también da sobre", async () => {
    const c = await compararConLaArmada(sobreViejo(armar()), armar().toXDR(), RED);
    expect(c).toMatchObject({ igual: false, campos: ["sobre"] });
  });

  it.each([
    ["sin pedido", undefined],
    ["un pedido vacío", ""],
    ["algo que no es XDR", "no-es-un-xdr"],
    ["un XDR que no es una transacción", "AAAAAA=="],
  ])("%s da no-se-lee", async (_caso, pedido) => {
    const esperado = { igual: false, campos: ["no-se-lee"], operaciones: [], tipos: [] };
    await expect(compararConLaArmada(armar().toXDR(), pedido, RED)).resolves.toEqual(esperado);
  });

  it("una armada que no se lee da no-se-lee", async () => {
    await expect(compararConLaArmada("no-es-un-xdr", armar().toXDR(), RED)).resolves.toMatchObject({ igual: false, campos: ["no-se-lee"] });
  });
});

describe("compararConLaArmada: el hash que dice el pedido", () => {
  it("un hash que no es el de la armada suma hash, aunque el cuerpo sea el mismo", async () => {
    const c = await distintos(armar(), armar().toXDR(), hashDe(armar({ secuencia: "11" })));
    expect(c.campos).toEqual(["hash"]);
  });

  it("el hash de la misma transacción con la frase de la red de prueba no es el de la armada", async () => {
    const enPrueba = TransactionBuilder.fromXDR(armar().toXDR(), Networks.TESTNET) as Transaction;
    const c = await distintos(armar(), armar().toXDR(), hashDe(enPrueba));
    expect(c.campos).toEqual(["hash"]);
  });

  it("va antes que los campos del cuerpo", async () => {
    const c = await distintos(armar({ secuencia: "10" }), armar({ secuencia: "11" }).toXDR(), hashDe(armar({ secuencia: "11" })));
    expect(c.campos).toEqual(["hash", "secuencia"]);
  });
});

describe("listarLosCampos", () => {
  it("dice ninguno si es la misma", () => {
    expect(listarLosCampos({ igual: true, hash: "x", firmasEnElSobre: 0 })).toBe("ninguno");
  });

  it("separa los campos con comas y suma los índices de las operaciones", () => {
    expect(listarLosCampos({ igual: false, campos: ["secuencia", "comision"], operaciones: [], tipos: [] })).toBe("secuencia, comision");
    expect(listarLosCampos({ igual: false, campos: ["envuelta", "operacion"], operaciones: [0, 2], tipos: [] })).toBe("envuelta, operacion 0,2");
  });
});

/* ------------------------------------------------------------------- las líneas del testigo */

function pedidoDe(t: Transaction, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma {
  return { id: "pedido-1", status: "APPROVED", intent: "sign", refreshable: false, unsignedPayload: t.toXDR(), payloadHash: hashDe(t), ...cambios };
}

describe("describirPedido", () => {
  it("la misma transacción: todo en una línea, sin firmar ni mandar nada todavía", async () => {
    const a = armar();
    await expect(describirPedido(a.toXDR(), pedidoDe(a), RED)).resolves.toBe(
      "[tinkazo] testigo: misma transacción | distinto ninguno | intención sign | releíble no | firmada ninguna | envío ninguno",
    );
  });

  it("reconstruida con otra secuencia: mismas operaciones, y dice cuál campo difiere", async () => {
    const otra = armar({ secuencia: "11" });
    const linea = await describirPedido(armar().toXDR(), pedidoDe(otra, { payloadHash: undefined }), RED);
    expect(linea).toContain("[tinkazo] testigo: mismas operaciones | distinto secuencia | ");
  });

  it("con el hash que dice el pedido, también dice hash", async () => {
    const otra = armar({ secuencia: "11" });
    const linea = await describirPedido(armar().toXDR(), pedidoDe(otra), RED);
    expect(linea).toContain("| distinto hash, secuencia | ");
  });

  it("con otra operación: distinta, con los tipos de operación del pedido y sus índices", async () => {
    const otra = armar({ operaciones: [sello(), firmanteExtra()], comision: "1000" });
    const linea = await describirPedido(armar({ comision: "2000" }).toXDR(), pedidoDe(otra, { payloadHash: undefined }), RED);
    expect(linea).toContain("[tinkazo] testigo: distinta (invokeHostFunction,setOptions) | distinto cantidad | ");
    const votada = pedidoDe(armar({ operaciones: [dato("b")] }), { payloadHash: undefined });
    const otroDato = await describirPedido(armar({ operaciones: [dato("a")] }).toXDR(), votada, RED);
    expect(otroDato).toContain("[tinkazo] testigo: distinta (manageData) | distinto operacion 0 | ");
  });

  it("envuelta, con la misma adentro: mismas operaciones y firmada envuelta", async () => {
    const a = armar();
    const sobre = envolver(a);
    const linea = await describirPedido(a.toXDR(), pedidoDe(a, { unsignedPayload: sobre, payloadHash: undefined, signedXdr: sobre }), RED);
    expect(linea).toBe(
      "[tinkazo] testigo: mismas operaciones | distinto envuelta | intención sign | releíble no | firmada envuelta | envío ninguno",
    );
  });

  it("sin la transacción del pedido, no se lee", async () => {
    const linea = await describirPedido(armar().toXDR(), pedidoDe(armar(), { unsignedPayload: undefined }), RED);
    expect(linea).toBe("[tinkazo] testigo: no se lee | distinto no-se-lee | intención sign | releíble no | firmada ninguna | envío ninguno");
  });

  it("una armada que no se lee no tira un error: dice que no se lee", async () => {
    await expect(describirPedido("no-es-un-xdr", pedidoDe(armar()), RED)).resolves.toContain("[tinkazo] testigo: no se lee | distinto no-se-lee");
  });

  it.each([
    ["sign", "sign"],
    ["sign_and_send", "sign_and_send"],
    ["account_create", "otra"],
    [undefined, "otra"],
  ])("la intención %s se anota como %s", async (intent, dicho) => {
    const a = armar();
    await expect(describirPedido(a.toXDR(), pedidoDe(a, { intent }), RED)).resolves.toContain(`| intención ${dicho} | `);
  });

  it("dice si el pedido se puede volver a pedir", async () => {
    const a = armar();
    await expect(describirPedido(a.toXDR(), pedidoDe(a, { refreshable: true }), RED)).resolves.toContain("| releíble sí | ");
    await expect(describirPedido(a.toXDR(), pedidoDe(a, { refreshable: undefined }), RED)).resolves.toContain("| releíble no | ");
  });

  it("firmada simple, y el envío con el mismo hash", async () => {
    const a = armar();
    const votado = pedidoDe(a, { intent: "sign_and_send", signedXdr: firmada(a).toXDR(), submit: { status: "SUCCESS", hash: hashDe(a) } });
    await expect(describirPedido(a.toXDR(), votado, RED)).resolves.toBe(
      "[tinkazo] testigo: misma transacción | distinto ninguno | intención sign_and_send | releíble no | firmada simple | envío mismo-hash",
    );
  });

  it("firmada envuelta y el envío con el hash de afuera: otro hash, atado a la armada", async () => {
    const a = armar();
    const sobre = envolver(a);
    const hashDeAfuera = hashDe(TransactionBuilder.fromXDR(sobre, RED));
    const votado = pedidoDe(a, { intent: "sign_and_send", signedXdr: sobre, submit: { status: "SUCCESS", hash: hashDeAfuera } });
    const linea = await describirPedido(a.toXDR(), votado, RED);
    expect(linea).toContain("| firmada envuelta | envío otro-hash-atado");
  });

  it("un envío con un hash que no se puede atar es otro hash", async () => {
    const a = armar();
    const otroHash = hashDe(armar({ secuencia: "11" }));
    const votado = pedidoDe(a, { intent: "sign_and_send", signedXdr: firmada(a).toXDR(), submit: { status: "SUCCESS", hash: otroHash } });
    await expect(describirPedido(a.toXDR(), votado, RED)).resolves.toContain("| firmada simple | envío otro-hash");
  });

  it("el hash de afuera de otra transacción envuelta tampoco se ata", async () => {
    const a = armar();
    const otraEnvuelta = envolver(armar({ secuencia: "11" }));
    const hashDeAfuera = hashDe(TransactionBuilder.fromXDR(otraEnvuelta, RED));
    const votado = pedidoDe(a, { signedXdr: otraEnvuelta, submit: { hash: hashDeAfuera } });
    const linea = await describirPedido(a.toXDR(), votado, RED);
    expect(linea.endsWith("| firmada envuelta | envío otro-hash")).toBe(true);
  });

  it("lo firmado que no se lee se anota como ilegible", async () => {
    const a = armar();
    await expect(describirPedido(a.toXDR(), pedidoDe(a, { signedXdr: "no-es-un-xdr" }), RED)).resolves.toContain("| firmada ilegible | ");
  });
});

/**
 * La línea del dólar digital como la armó el proveedor el 18 de noviembre de 2026: la paga otra cuenta y no trae límites
 * de tiempo (los dos en cero, como arma el SDK una transacción sin ellos).
 */
function lineaDeCircle(cambios: { paga?: string; activo?: Asset; limite?: string; operaciones?: xdr.Operation[]; nota?: Memo } = {}): Transaction {
  const paga = cambios.paga ?? OTRA;
  return armar({
    origen: paga,
    comision: "100",
    condiciones: { timebounds: { minTime: 0, maxTime: 0 } },
    ...(cambios.nota ? { nota: cambios.nota } : {}),
    operaciones: cambios.operaciones ?? [
      Operation.beginSponsoringFutureReserves({ sponsoredId: P, source: paga }),
      Operation.changeTrust({ asset: cambios.activo ?? new Asset(USDC.code, USDC.issuer), limit: cambios.limite ?? LIMITE_MAXIMO, source: P }),
      Operation.endSponsoringFutureReserves({ source: P }),
    ],
  });
}

const OPERACIONES_REALES = "beginSponsoringFutureReserves(otra),changeTrust(propia),endSponsoringFutureReserves(propia)";
const RESTO_REAL = "paga otra | activo circle | límite máximo | nota ninguna | condiciones solo-tiempo | sobre simple";
const FORMA_REAL = `[tinkazo] testigo de la línea: ${OPERACIONES_REALES} | ${RESTO_REAL}`;

const pedidoDeLaLinea = (t: Transaction | string, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma => ({
  id: "linea-1",
  status: "APPROVED",
  intent: "sign_and_send",
  operation: "change_trust",
  refreshable: true,
  unsignedPayload: typeof t === "string" ? t : t.toXDR(),
  ...cambios,
});

describe("describirLinea", () => {
  it("la forma real, sin condiciones de tiempo: otra la paga, la cuenta es el origen de la línea y de cerrar", async () => {
    const linea = await describirLinea(pedidoDeLaLinea(sinCondiciones(lineaDeCircle())), P, RED, USDC);
    expect(linea).toBe(`${FORMA_REAL} | intención sign_and_send | releíble sí | envío ninguno`);
  });

  it("con límites de tiempo también es solo-tiempo", async () => {
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle()), P, RED, USDC)).resolves.toContain("| condiciones solo-tiempo | ");
  });

  it("un origen sin cuenta propia se anota como ninguna", async () => {
    const t = lineaDeCircle({
      operaciones: [
        Operation.beginSponsoringFutureReserves({ sponsoredId: P }),
        Operation.changeTrust({ asset: new Asset(USDC.code, USDC.issuer), source: P }),
        Operation.endSponsoringFutureReserves({ source: P }),
      ],
    });
    await expect(describirLinea(pedidoDeLaLinea(t), P, RED, USDC)).resolves.toContain("beginSponsoringFutureReserves(ninguna),changeTrust(propia),");
  });

  it("si la paga la propia cuenta, lo dice", async () => {
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle({ paga: P })), P, RED, USDC)).resolves.toContain("| paga propia | ");
  });

  it.each([
    ["otro código", new Asset("EURC", EMISOR)],
    ["otro emisor", new Asset("USDC", OTRO_EMISOR)],
  ])("%s del activo se anota como otro", async (_caso, activo) => {
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle({ activo })), P, RED, USDC)).resolves.toContain("| activo otro | ");
  });

  it.each([
    ["cero", "0", "cero"],
    ["otro", "100", "otro"],
    ["máximo", LIMITE_MAXIMO, "máximo"],
  ])("el límite %s se anota como %s", async (_caso, limite, dicho) => {
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle({ limite })), P, RED, USDC)).resolves.toContain(`| límite ${dicho} | `);
  });

  it("con nota, lo dice", async () => {
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle({ nota: Memo.text("x") })), P, RED, USDC)).resolves.toContain("| nota alguna | ");
  });

  it("con condiciones que no son de tiempo, lo dice", async () => {
    const t = armar({ origen: OTRA, condiciones: { minAccountSequence: "5" }, operaciones: [Operation.endSponsoringFutureReserves({ source: P })] });
    await expect(describirLinea(pedidoDeLaLinea(t), P, RED, USDC)).resolves.toContain("| condiciones otras | ");
  });

  it("envuelta en un fee bump, la lee por dentro y dice que vino envuelta", async () => {
    const linea = await describirLinea(pedidoDeLaLinea(envolver(lineaDeCircle())), P, RED, USDC);
    expect(linea).toContain(`${OPERACIONES_REALES} | paga otra | activo circle | `);
    expect(linea).toContain("| sobre envuelta | ");
  });

  it("sin ninguna línea de confianza, no inventa un activo ni un límite", async () => {
    const t = armar({ origen: OTRA, operaciones: [Operation.endSponsoringFutureReserves({ source: P })] });
    await expect(describirLinea(pedidoDeLaLinea(t), P, RED, USDC)).resolves.toContain("| activo ninguno | límite ninguno | ");
  });

  it("el envío se compara con la transacción del propio pedido", async () => {
    const t = lineaDeCircle();
    const mismo = pedidoDeLaLinea(t, { submit: { status: "SUCCESS", hash: hashDe(t) } });
    await expect(describirLinea(mismo, P, RED, USDC)).resolves.toMatch(/\| envío mismo-hash$/);
    const otro = pedidoDeLaLinea(t, { submit: { status: "SUCCESS", hash: hashDe(armar()) } });
    await expect(describirLinea(otro, P, RED, USDC)).resolves.toMatch(/\| envío otro-hash$/);
  });

  it("lo que no se lee da una línea que lo dice, sin tirar un error", async () => {
    const dicho = "[tinkazo] testigo de la línea: no se lee | intención sign_and_send | releíble sí | envío ninguno";
    await expect(describirLinea(pedidoDeLaLinea("no-es-un-xdr"), P, RED, USDC)).resolves.toBe(dicho);
    await expect(describirLinea(pedidoDeLaLinea(lineaDeCircle(), { unsignedPayload: undefined }), P, RED, USDC)).resolves.toBe(dicho);
    await expect(describirLinea(pedidoDeLaLinea(sobreViejo(armar())), P, RED, USDC)).resolves.toBe(dicho);
  });

  it("un envío con hash y sin transacción que comparar no se confunde con otro hash", async () => {
    const linea = await describirLinea(pedidoDeLaLinea("no-es-un-xdr", { submit: { status: "SUCCESS", hash: hashDe(armar()) } }), P, RED, USDC);
    expect(linea.endsWith("| envío sin-comparar")).toBe(true);
  });
});

describe("lo que anotan las líneas", () => {
  it("nada de lo que devuelven trae una dirección ni un hash", async () => {
    const a = armar({ operaciones: [pago("5"), dato("a")], nota: Memo.text("tk:premio:1:0") });
    const otra = armar({ origen: OTRA, secuencia: "11", comision: "3000", operaciones: [pago("6", OTRA), firmanteExtra()] });
    const distinta = await compararConLaArmada(a.toXDR(), otra.toXDR(), RED, hashDe(otra));
    const salidas = [
      JSON.stringify(distinta),
      listarLosCampos(distinta),
      await describirPedido(a.toXDR(), pedidoDe(otra, { signedXdr: envolver(otra), submit: { hash: hashDe(otra) } }), RED),
      await describirPedido("no-es-un-xdr", pedidoDe(otra), RED),
      await describirLinea(pedidoDeLaLinea(lineaDeCircle({ paga: OTRA }), { submit: { hash: hashDe(a) } }), P, RED, USDC),
      await describirLinea(pedidoDeLaLinea(envolver(lineaDeCircle())), P, RED, USDC),
      await describirLinea(pedidoDeLaLinea("no-es-un-xdr"), P, RED, USDC),
    ];
    expect(distinta).toMatchObject({ igual: false });
    for (const salida of salidas) {
      expect(salida).not.toMatch(/[GCM][A-Z2-7]{55}/);
      expect(salida).not.toMatch(/[0-9a-fA-F]{40,}/);
    }
  });
});

/* ------------------------------------------------ el voto por contenido */

const SUB = "sub-org-de-la-cuenta";
const OTRO_CONTRATO = StrKey.encodeContract(new Uint8Array(32).fill(9));
const sorteo = (): xdr.Operation => Operation.invokeContractFunction({ contract: CONTRATO, function: "draw", args: [] });

/** El pedido de co-firma de una llamada, todavía pendiente, como lo devuelve el kit con el voto a mano. */
function pendienteDe(t: Transaction, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma {
  return {
    id: "pedido-1",
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

describe("las constantes del voto por contenido", () => {
  it("el texto de la negativa calza también con el del tope, y el tope es de dos", () => {
    expect(COFIRMA_DISTINTA).toBe("tinkazo-cofirma-distinta");
    expect(COFIRMA_TOPE.startsWith(COFIRMA_DISTINTA)).toBe(true);
    expect(TOPE_DE_DISTINTAS).toBe(2);
  });

  it("la espera del envío es la del kit: dieciséis consultas cada dos segundos y medio", () => {
    expect(CONSULTAS_DEL_ENVIO).toBe(16);
    expect(ESPERA_ENTRE_CONSULTAS_MS).toBe(2_500);
  });
});

describe("motivoContraLoPermitido: con el voto a mano solo se firman el sello y el sorteo del contrato oficial", () => {
  it("el sello del contrato oficial, de la cuenta de la sesión, pasa", async () => {
    await expect(motivoContraLoPermitido(armar().toXDR(), P, CONTRATO, RED)).resolves.toBeNull();
  });

  it("el sorteo del contrato oficial pasa", async () => {
    await expect(motivoContraLoPermitido(armar({ operaciones: [sorteo()] }).toXDR(), P, CONTRATO, RED)).resolves.toBeNull();
  });

  it("la invocación de otro contrato no pasa", async () => {
    await expect(motivoContraLoPermitido(armar().toXDR(), P, OTRO_CONTRATO, RED)).resolves.toBe("otro contrato");
  });

  it("otra función del contrato oficial no pasa", async () => {
    const otra = Operation.invokeContractFunction({ contract: CONTRATO, function: "upgrade", args: [] });
    await expect(motivoContraLoPermitido(armar({ operaciones: [otra] }).toXDR(), P, CONTRATO, RED)).resolves.toBe("función");
  });

  it("un pago no pasa: los pagos se suman aparte", async () => {
    await expect(motivoContraLoPermitido(armar({ operaciones: [pago("5")] }).toXDR(), P, CONTRATO, RED)).resolves.toBe("operaciones");
  });

  it("el sello con una operación de más no pasa", async () => {
    await expect(motivoContraLoPermitido(armar({ operaciones: [sello(), firmanteExtra()] }).toXDR(), P, CONTRATO, RED)).resolves.toBe("operaciones");
  });

  it("el sello que paga otra cuenta no pasa", async () => {
    await expect(motivoContraLoPermitido(armar({ origen: OTRA }).toXDR(), P, CONTRATO, RED)).resolves.toBe("cuenta");
  });

  it("el sello con el origen de la operación en otra cuenta no pasa", async () => {
    const ajeno = Operation.invokeContractFunction({ contract: CONTRATO, function: "seal", args: [], source: OTRA });
    await expect(motivoContraLoPermitido(armar({ operaciones: [ajeno] }).toXDR(), P, CONTRATO, RED)).resolves.toBe("cuenta");
  });

  it("el sello envuelto en un fee bump no pasa", async () => {
    await expect(motivoContraLoPermitido(envolver(armar()), P, CONTRATO, RED)).resolves.toBe("sobre");
  });

  it("el sello en un sobre de tipo 0 no pasa", async () => {
    await expect(motivoContraLoPermitido(sobreViejo(armar()), P, CONTRATO, RED)).resolves.toBe("sobre");
  });

  it("lo que no se lee no pasa", async () => {
    await expect(motivoContraLoPermitido("no-es-un-xdr", P, CONTRATO, RED)).resolves.toBe("sobre");
  });

  it("sin contrato oficial en la red no pasa nada", async () => {
    await expect(motivoContraLoPermitido(armar().toXDR(), P, null, RED)).resolves.toBe("sin contrato");
  });
});

describe("leerLaArmada", () => {
  it("lee la cuenta que la paga y su hash", async () => {
    const a = armar();
    await expect(leerLaArmada(a.toXDR(), RED)).resolves.toEqual({ cuenta: P, hash: hashDe(a) });
  });

  it("una armada envuelta no es una armada", async () => {
    await expect(leerLaArmada(envolver(armar()), RED)).resolves.toBeNull();
  });

  it("lo que no se lee da null", async () => {
    await expect(leerLaArmada("no-es-un-xdr", RED)).resolves.toBeNull();
  });
});

describe("motivoContraElPedido: la forma del pedido de la llamada", () => {
  const a = armar();
  const esperado = { id: "pedido-1", cuenta: P, intencion: "sign" as IntencionDeFirma, subOrg: SUB, hashDeLaArmada: hashDe(a) };

  it("con la forma esperada no hay motivo", () => {
    expect(motivoContraElPedido(pendienteDe(a), esperado)).toBeNull();
  });

  it("con el hash del pedido en mayúsculas tampoco", () => {
    expect(motivoContraElPedido(pendienteDe(a, { payloadHash: hashDe(a).toUpperCase() }), esperado)).toBeNull();
  });

  const hashEnPrueba = Buffer.from(TransactionBuilder.fromXDR(a.toXDR(), Networks.TESTNET).hash()).toString("hex");
  const casos: Array<[string, Partial<PedidoDeCofirma>, string]> = [
    ["otra intención", { intent: "sign_and_send" }, "intención"],
    ["otro tipo de pedido", { kind: "ACCOUNT" }, "tipo"],
    ["otra cadena", { network: "SOLANA" }, "tipo"],
    ["un pedido que ya no está pendiente", { status: "APPROVED" }, "estado"],
    ["otra cuenta que firma", { signWith: OTRA }, "otra cuenta"],
    ["otra cuenta del pedido", { account: OTRA }, "otra cuenta"],
    ["un pedido con una actividad", { activityId: "actividad-1" }, "ya votado"],
    ["otra organización", { subOrgId: "otra-org" }, "otra organización"],
    ["un pedido de otra llamada", { id: "pedido-2" }, "otro pedido"],
    ["una línea", { operation: "change_trust" }, "operación"],
    ["una cuenta nueva", { operation: "create_account" }, "operación"],
    ["sin transacción", { unsignedPayload: undefined }, "sin transacción"],
    ["el hash con la frase de la red de prueba", { payloadHash: hashEnPrueba }, "hash"],
  ];
  it.each(casos)("%s no se vota", (_que, cambios, motivo) => {
    expect(motivoContraElPedido(pendienteDe(a, cambios), esperado)).toBe(motivo);
  });

  it("sin la organización de la sesión no se vota", () => {
    expect(motivoContraElPedido(pendienteDe(a), { ...esperado, subOrg: null })).toBe("otra organización");
  });

  it("un hash o una transacción que no son texto no se votan, y no lanza", () => {
    const hashRaro = { payloadHash: 7 as unknown as string };
    const transaccionRara = { unsignedPayload: { xdr: a.toXDR() } as unknown as string };
    expect(motivoContraElPedido(pendienteDe(a, hashRaro), esperado)).toBe("sin transacción");
    expect(motivoContraElPedido(pendienteDe(a, transaccionRara), esperado)).toBe("sin transacción");
  });
});

describe("esDeEstaLlamada: solo el pedido de la llamada se rechaza", () => {
  const a = armar();
  const llamada = { id: "pedido-1", intencion: "sign" as IntencionDeFirma, linea: false };

  it("el id de la llamada con su intención es de esta llamada", () => {
    expect(esDeEstaLlamada(pendienteDe(a), llamada)).toBe(true);
  });

  it("otro id no es de esta llamada", () => {
    expect(esDeEstaLlamada(pendienteDe(a, { id: "pedido-2" }), llamada)).toBe(false);
  });

  it("otra intención no es de esta llamada", () => {
    expect(esDeEstaLlamada(pendienteDe(a, { intent: "sign_and_send" }), llamada)).toBe(false);
  });

  it("una línea en la llamada del sello no es de esta llamada", () => {
    expect(esDeEstaLlamada(pendienteDe(a, { operation: "change_trust" }), llamada)).toBe(false);
  });

  it("un pedido que ya no está pendiente no es para rechazar", () => {
    expect(esDeEstaLlamada(pendienteDe(a, { status: "REJECTED" }), llamada)).toBe(false);
  });

  it("en la llamada de la línea, la línea sí es de esta llamada", () => {
    const linea = pendienteDe(a, { intent: "sign_and_send", operation: "change_trust" });
    expect(esDeEstaLlamada(linea, { id: "pedido-1", intencion: "sign_and_send", linea: true })).toBe(true);
  });
});

describe("describirLaNegativa", () => {
  it("dice el motivo de la forma y los campos que difieren, con los tipos si son operaciones", async () => {
    const c = await compararConLaArmada(armar().toXDR(), armar({ operaciones: [dato("a")] }).toXDR(), RED);
    expect(describirLaNegativa("hash", c)).toBe("hash | operacion 0 | tipos manageData");
  });

  it("con otra secuencia y otra comisión dice las dos", async () => {
    const c = await compararConLaArmada(armar().toXDR(), armar({ secuencia: "11", comision: "2000" }).toXDR(), RED);
    expect(describirLaNegativa(null, c)).toBe("secuencia, comision");
  });

  it("no trae direcciones ni hashes", async () => {
    const otra = armar({ origen: OTRA, operaciones: [pago("6", OTRA)] });
    const c = await compararConLaArmada(armar().toXDR(), otra.toXDR(), RED, hashDe(otra));
    const linea = describirLaNegativa("otra cuenta", c);
    expect(linea).not.toMatch(/[GCM][A-Z2-7]{55}/);
    expect(linea).not.toMatch(/[0-9a-fA-F]{40,}/);
  });
});

/** Las dependencias del desenlace, con la red de mentira: lo que contesta cada consulta, en orden, y el envío. */
function depsDe(intencion: IntencionDeFirma, hash: string, o: { estados?: EstadoDelEnvio[]; envio?: EnvioDelKit; sigue?: () => boolean } = {}) {
  const consultas: string[] = [];
  const mandadas: string[] = [];
  const esperas: number[] = [];
  const deps: DepsDelDesenlace = {
    intencion,
    hashDeLaArmada: hash,
    passphrase: RED,
    estado: async (h) => {
      consultas.push(h);
      const r = o.estados?.[consultas.length - 1];
      if (!r) throw new Error("la prueba no dijo qué contesta esta consulta");
      return r;
    },
    mandar: async (x) => {
      mandadas.push(x);
      if (!o.envio) throw new Error("la prueba no dijo qué contesta el envío");
      return o.envio;
    },
    dormir: async (ms) => void esperas.push(ms),
    sigue: o.sigue ?? (() => true),
  };
  return { deps, consultas, mandadas, esperas };
}

const aprobadoDe = (t: Transaction, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma =>
  pendienteDe(t, { status: "APPROVED", activityId: "actividad-1", ...cambios });
const pendientes = (n: number): EstadoDelEnvio[] => Array.from({ length: n }, () => ({ status: "PENDING" }));

describe("desenlaceDelVoto con sign: lo firmado tiene que ser la armada", () => {
  it("la armada firmada da firmada", async () => {
    const a = armar();
    const f = firmada(a).toXDR();
    const r = await desenlaceDelVoto(aprobadoDe(a, { signedXdr: f }), depsDe("sign", hashDe(a)).deps);
    expect(r).toEqual({ que: "firmada", signedXdr: f });
  });

  it("la armada firmada y envuelta da incierto", async () => {
    const a = armar();
    await expect(desenlaceDelVoto(aprobadoDe(a, { signedXdr: envolver(firmada(a)) }), depsDe("sign", hashDe(a)).deps)).resolves.toEqual({
      que: "incierto",
      motivo: "firmada distinta",
    });
  });

  it("otra transacción firmada da incierto", async () => {
    const a = armar();
    const otra = firmada(armar({ secuencia: "11" })).toXDR();
    await expect(desenlaceDelVoto(aprobadoDe(a, { signedXdr: otra }), depsDe("sign", hashDe(a)).deps)).resolves.toMatchObject({ que: "incierto" });
  });

  it("sin lo firmado da incierto, nunca que no se hizo nada", async () => {
    const a = armar();
    await expect(desenlaceDelVoto(aprobadoDe(a), depsDe("sign", hashDe(a)).deps)).resolves.toMatchObject({ que: "incierto" });
  });

  it("todavía pendiente después del voto da incierto", async () => {
    const a = armar();
    await expect(desenlaceDelVoto(pendienteDe(a, { activityId: "actividad-1" }), depsDe("sign", hashDe(a)).deps)).resolves.toEqual({
      que: "incierto",
      motivo: "sin confirmar",
    });
  });

  it("cerrado sin aprobar dice su estado, como el kit", async () => {
    const a = armar();
    const votado = pendienteDe(a, { status: "EXPIRED", failureReason: "venció" });
    const r = await desenlaceDelVoto(votado, depsDe("sign", hashDe(a)).deps);
    expect(r).toEqual({ que: "no-salio", code: "SDK_COSIGN_EXPIRED", details: "venció" });
  });
});

describe("desenlaceDelVoto con sign_and_send: el envío tiene que estar atado a la armada", () => {
  it("SUCCESS con el hash de la armada da entro con ese hash, sin preguntar", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a));
    const r = await desenlaceDelVoto(aprobadoDe(a, { submit: { status: "SUCCESS", hash: hashDe(a) } }), d.deps);
    expect(r).toEqual({ que: "entro", hash: hashDe(a) });
    expect(d.consultas).toEqual([]);
  });

  it("SUCCESS con otro hash que no se puede atar pregunta por la armada y entra si la red lo dice", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { estados: [{ status: "SUCCESS" }] });
    const otro = hashDe(armar({ secuencia: "11" }));
    const r = await desenlaceDelVoto(aprobadoDe(a, { submit: { status: "SUCCESS", hash: otro } }), d.deps);
    expect(r).toEqual({ que: "entro", hash: hashDe(a) });
    expect(d.consultas).toEqual([hashDe(a)]);
  });

  it("SUCCESS con otro hash que no se puede atar y dieciséis PENDING de la armada da incierto", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { estados: pendientes(16) });
    const otro = hashDe(armar({ secuencia: "11" }));
    await expect(desenlaceDelVoto(aprobadoDe(a, { submit: { status: "SUCCESS", hash: otro } }), d.deps)).resolves.toEqual({
      que: "incierto",
      motivo: "sin confirmar",
    });
    expect(d.consultas).toHaveLength(16);
    expect(d.esperas).toEqual(Array.from({ length: 16 }, () => 2_500));
  });

  it("otro hash atado por lo firmado envuelto con la armada adentro usa el estado del envío", async () => {
    const a = armar();
    const sobre = TransactionBuilder.buildFeeBumpTransaction(Keypair.random(), "100000", firmada(a), RED);
    const d = depsDe("sign_and_send", hashDe(a));
    const votado = aprobadoDe(a, { signedXdr: sobre.toXDR(), submit: { status: "SUCCESS", hash: hashDe(sobre) } });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "entro", hash: hashDe(a) });
    expect(d.consultas).toEqual([]);
  });

  it("FAILED con el hash de la armada da fallo con su código", async () => {
    const a = armar();
    const votado = aprobadoDe(a, { submit: { status: "FAILED", hash: hashDe(a), resultCode: "txFailed" } });
    const r = await desenlaceDelVoto(votado, depsDe("sign_and_send", hashDe(a)).deps);
    expect(r).toEqual({ que: "fallo", hash: hashDe(a), resultCode: "txFailed" });
  });

  it("PENDING que termina FAILED da fallo con su resultCode", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { estados: [{ status: "PENDING" }, { status: "FAILED", resultCode: "txBadSeq" }] });
    const votado = aprobadoDe(a, { submit: { status: "PENDING", hash: hashDe(a) } });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "fallo", hash: hashDe(a), resultCode: "txBadSeq" });
    expect(d.consultas).toEqual([hashDe(a), hashDe(a)]);
  });

  it("PENDING que no termina da incierto, nunca un éxito", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { estados: pendientes(16) });
    const votado = aprobadoDe(a, { submit: { status: "PENDING", hash: hashDe(a) } });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "incierto", motivo: "sin confirmar" });
  });

  it("una consulta que falla no corta la espera", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { estados: [{ status: "PENDING" }, { status: "SUCCESS" }] });
    const estado = d.deps.estado;
    let primera = true;
    d.deps.estado = async (h) => {
      if (primera) {
        primera = false;
        throw new TypeError("Failed to fetch");
      }
      return estado(h);
    };
    const votado = aprobadoDe(a, { submit: { status: "PENDING", hash: hashDe(a) } });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "entro", hash: hashDe(a) });
  });

  it("sin envío y con la armada firmada la manda una vez", async () => {
    const a = armar();
    const f = firmada(a).toXDR();
    const d = depsDe("sign_and_send", hashDe(a), { envio: { status: "success", hash: hashDe(a) } });
    await expect(desenlaceDelVoto(aprobadoDe(a, { signedXdr: f }), d.deps)).resolves.toEqual({ que: "entro", hash: hashDe(a) });
    expect(d.mandadas).toEqual([f]);
  });

  it("sin envío, con la armada firmada y otra sesión, no manda nada y da incierto", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { envio: { status: "success" }, sigue: () => false });
    const r = await desenlaceDelVoto(aprobadoDe(a, { signedXdr: firmada(a).toXDR() }), d.deps);
    expect(r).toEqual({ que: "incierto", motivo: "sesión cambiada" });
    expect(d.mandadas).toEqual([]);
  });

  it("sin envío y con la armada firmada que la red rechaza da fallo con su código", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a), { envio: { status: "error", resultCode: "txInsufficientBalance" } });
    const votado = aprobadoDe(a, { signedXdr: firmada(a).toXDR() });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "fallo", hash: hashDe(a), resultCode: "txInsufficientBalance" });
  });

  it("sin envío y con otra transacción firmada no manda nada y da incierto", async () => {
    const a = armar();
    const d = depsDe("sign_and_send", hashDe(a));
    const votado = aprobadoDe(a, { signedXdr: firmada(armar({ secuencia: "11" })).toXDR() });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "incierto", motivo: "firmada distinta" });
    expect(d.mandadas).toEqual([]);
  });

  it("sin envío ni lo firmado da incierto", async () => {
    const a = armar();
    await expect(desenlaceDelVoto(aprobadoDe(a), depsDe("sign_and_send", hashDe(a)).deps)).resolves.toEqual({ que: "incierto", motivo: "sin envío" });
  });

  it("si la sesión cambia a mitad de la espera, incierto", async () => {
    const a = armar();
    let vueltas = 0;
    const d = depsDe("sign_and_send", hashDe(a), { estados: pendientes(16), sigue: () => ++vueltas < 3 });
    const votado = aprobadoDe(a, { submit: { status: "PENDING", hash: hashDe(a) } });
    await expect(desenlaceDelVoto(votado, d.deps)).resolves.toEqual({ que: "incierto", motivo: "sesión cambiada" });
    expect(d.consultas).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ la línea del dólar digital */

const TERCERA = Keypair.random().publicKey();

/** Las tres operaciones de la línea como las arma el proveedor, con lo que diga `cambios`. */
function operacionesDeLaLinea(cambios: { patrocinada?: string; abre?: string | null; linea?: string; cierra?: string } = {}): xdr.Operation[] {
  const abre = cambios.abre === null ? {} : { source: cambios.abre ?? OTRA };
  return [
    Operation.beginSponsoringFutureReserves({ sponsoredId: cambios.patrocinada ?? P, ...abre }),
    Operation.changeTrust({ asset: new Asset(USDC.code, USDC.issuer), limit: LIMITE_MAXIMO, source: cambios.linea ?? P }),
    Operation.endSponsoringFutureReserves({ source: cambios.cierra ?? P }),
  ];
}

/** Límites de tiempo que no limitan nada: los dos en cero. */
const SIN_LIMITES = { timebounds: { minTime: 0, maxTime: 0 } };

/** La línea con las operaciones de la forma real y lo que diga `o`: sin `o`, con los límites de tiempo de `armar`. */
const lineaCon = (o: Pick<Opciones, "condiciones" | "soroban"> = {}): Transaction =>
  armar({ origen: OTRA, comision: "100", operaciones: operacionesDeLaLinea(), ...o });

/** El pedido de la línea que espera el voto, como llegó en la red principal, para la transacción `t`. */
function lineaPendiente(t: Transaction | string, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma {
  const texto = typeof t === "string" ? t : t.toXDR();
  return {
    id: "linea-1",
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "sign_and_send",
    operation: "change_trust",
    account: P,
    signWith: P,
    appPaysFee: true,
    refreshable: true,
    unsignedPayload: texto,
    payloadHash: hashDe(TransactionBuilder.fromXDR(texto, RED)),
    activityId: null,
    subOrgId: SUB,
    ...cambios,
  };
}

/** El motivo de la regla de la línea para ese pedido, con la cuenta, la organización y el activo de la prueba. */
async function contraLaLinea(p: PedidoDeCofirma, subOrg: string | null = SUB): Promise<string | null> {
  return motivoContraLaLinea(p, P, await leerLaLinea(p.unsignedPayload, RED), subOrg, USDC);
}

describe("leerLaLinea: la transacción de un pedido de la línea", () => {
  it("lee quién paga, el hash, la nota y las tres operaciones de la forma real", async () => {
    const texto = sinCondiciones(lineaDeCircle());
    const leida = await leerLaLinea(texto, RED);
    expect(leida).toEqual({
      sobre: 2,
      fuente: OTRA,
      hash: hashDe(TransactionBuilder.fromXDR(texto, RED)),
      nota: "none",
      condiciones: "ninguna",
      operaciones: [
        { tipo: "beginSponsoringFutureReserves", origen: OTRA, patrocinada: P },
        { tipo: "changeTrust", origen: P, activo: { tipo: "credit_alphanum4", codigo: "USDC", emisor: EMISOR }, limite: LIMITE_MAXIMO },
        { tipo: "endSponsoringFutureReserves", origen: P },
      ],
    });
  });

  it("con límites de tiempo de verdad dice tiempo", async () => {
    await expect(leerLaLinea(lineaCon().toXDR(), RED)).resolves.toMatchObject({ condiciones: "tiempo" });
  });

  it("con los dos límites de tiempo en cero dice ninguna: no limitan nada", async () => {
    await expect(leerLaLinea(lineaDeCircle().toXDR(), RED)).resolves.toMatchObject({ condiciones: "ninguna" });
  });

  it("con datos de contrato dice otras condiciones", async () => {
    const t = lineaCon({ condiciones: SIN_LIMITES, soroban: recursos(100) });
    await expect(leerLaLinea(t.toXDR(), RED)).resolves.toMatchObject({ condiciones: "otras" });
  });

  it("con una secuencia mínima dice otras condiciones", async () => {
    const t = armar({ origen: OTRA, comision: "100", condiciones: { minAccountSequence: "5" }, operaciones: operacionesDeLaLinea() });
    await expect(leerLaLinea(t.toXDR(), RED)).resolves.toMatchObject({ condiciones: "otras" });
  });

  it("una envuelta se lee por dentro y dice que vino envuelta", async () => {
    await expect(leerLaLinea(envolver(lineaDeCircle()), RED)).resolves.toMatchObject({ sobre: 5, fuente: OTRA });
  });

  it("lo que no se lee, o un pedido sin transacción, da null", async () => {
    await expect(leerLaLinea("no-es-un-xdr", RED)).resolves.toBeNull();
    await expect(leerLaLinea(undefined, RED)).resolves.toBeNull();
  });
});

describe("motivoContraLaLinea: solo la línea del dólar digital, con la forma que se midió", () => {
  it("la forma real, sin condiciones, pasa", async () => {
    await expect(contraLaLinea(lineaPendiente(sinCondiciones(lineaDeCircle())))).resolves.toBeNull();
  });

  it("con los dos límites de tiempo en cero también pasa: así arma el SDK una transacción sin límites", async () => {
    await expect(contraLaLinea(lineaPendiente(lineaDeCircle()))).resolves.toBeNull();
  });

  it("con límites de tiempo de verdad no se vota: la forma medida no los trae", async () => {
    await expect(contraLaLinea(lineaPendiente(lineaCon()))).resolves.toBe("condiciones");
  });

  it("con datos de contrato no se vota", async () => {
    await expect(contraLaLinea(lineaPendiente(lineaCon({ condiciones: SIN_LIMITES, soroban: recursos(100) })))).resolves.toBe("condiciones");
  });

  it("abrir el patrocinio sin origen propio también pasa: lo hace quien paga", async () => {
    await expect(contraLaLinea(lineaPendiente(lineaDeCircle({ operaciones: operacionesDeLaLinea({ abre: null }) })))).resolves.toBeNull();
  });

  it("con el hash del pedido en mayúsculas pasa", async () => {
    const t = lineaDeCircle();
    await expect(contraLaLinea(lineaPendiente(t, { payloadHash: hashDe(t).toUpperCase() }))).resolves.toBeNull();
  });

  const deMas = Operation.payment({ destination: DESTINO, asset: new Asset(USDC.code, USDC.issuer), amount: "1", source: P });
  const [abre, linea, cierra] = operacionesDeLaLinea() as [xdr.Operation, xdr.Operation, xdr.Operation];
  const conUnaDeMas = "operaciones: beginSponsoringFutureReserves,changeTrust,payment,endSponsoringFutureReserves";
  const transacciones: Array<[string, () => Transaction | string, string]> = [
    ["otro activo", () => lineaDeCircle({ activo: new Asset("EURC", EMISOR) }), "otro activo"],
    ["otro emisor", () => lineaDeCircle({ activo: new Asset("USDC", OTRO_EMISOR) }), "otro emisor"],
    ["el límite cero", () => lineaDeCircle({ limite: "0" }), "límite"],
    ["otro límite", () => lineaDeCircle({ limite: "100" }), "límite"],
    ["la línea de otra cuenta", () => lineaDeCircle({ operaciones: operacionesDeLaLinea({ linea: TERCERA }) }), "otra cuenta"],
    ["una operación de más", () => lineaDeCircle({ operaciones: [abre, linea, deMas, cierra] }), conUnaDeMas],
    ["sin abrir el patrocinio", () => lineaDeCircle({ operaciones: [linea, cierra] }), "sin patrocinio"],
    ["sin cerrar el patrocinio", () => lineaDeCircle({ operaciones: [abre, linea] }), "sin cerrar el patrocinio"],
    ["con nota", () => lineaDeCircle({ nota: Memo.text("x") }), "nota"],
    ["envuelta", () => envolver(lineaDeCircle()), "envuelta"],
    ["en un sobre de tipo 0", () => sobreViejo(lineaDeCircle()), "sobre"],
    ["pagada por la propia cuenta", () => lineaDeCircle({ paga: P }), "quién paga"],
    ["el patrocinio de otra cuenta", () => lineaDeCircle({ operaciones: operacionesDeLaLinea({ patrocinada: TERCERA }) }), "patrocina a otra cuenta"],
    ["abrir el patrocinio desde otra cuenta", () => lineaDeCircle({ operaciones: operacionesDeLaLinea({ abre: TERCERA }) }), "quién patrocina"],
    ["cerrar el patrocinio desde otra cuenta", () => lineaDeCircle({ operaciones: operacionesDeLaLinea({ cierra: OTRA }) }), "quién cierra"],
    [
      "con condiciones que no son de tiempo",
      () => armar({ origen: OTRA, comision: "100", condiciones: { minAccountSequence: "5" }, operaciones: operacionesDeLaLinea() }),
      "condiciones",
    ],
  ];
  it.each(transacciones)("%s no se vota", async (_que, transaccion, motivo) => {
    await expect(contraLaLinea(lineaPendiente(transaccion()))).resolves.toBe(motivo);
  });

  const real = lineaDeCircle();
  const hashEnPrueba = hashDe(TransactionBuilder.fromXDR(real.toXDR(), Networks.TESTNET));
  const pedidos: Array<[string, Partial<PedidoDeCofirma>, string]> = [
    ["otra intención", { intent: "sign" }, "intención"],
    ["otra operación del pedido", { operation: "payment" }, "intención"],
    ["otro tipo de pedido", { kind: "ACCOUNT" }, "tipo"],
    ["otra cadena", { network: "SOLANA" }, "tipo"],
    ["un pedido que ya no está pendiente", { status: "APPROVED" }, "estado"],
    ["otra cuenta que firma", { signWith: OTRA }, "otra cuenta"],
    ["un pedido sin cuenta", { account: undefined }, "otra cuenta"],
    ["un pedido que no paga la app", { appPaysFee: false }, "no paga la app"],
    ["un pedido con una actividad", { activityId: "actividad-1" }, "ya votado"],
    ["otra organización", { subOrgId: "otra-org" }, "otra organización"],
    ["sin transacción", { unsignedPayload: undefined }, "sin transacción"],
    ["un hash que no es texto", { payloadHash: 7 as unknown as string }, "sin transacción"],
    ["el hash con la frase de la red de prueba", { payloadHash: hashEnPrueba }, "hash"],
  ];
  it.each(pedidos)("%s no se vota", async (_que, cambios, motivo) => {
    await expect(contraLaLinea(lineaPendiente(real, cambios))).resolves.toBe(motivo);
  });

  it("sin la organización de la sesión no se vota", async () => {
    await expect(contraLaLinea(lineaPendiente(real), null)).resolves.toBe("otra organización");
  });

  it("una transacción que no se lee no se vota", () => {
    expect(motivoContraLaLinea(lineaPendiente(real), P, null, SUB, USDC)).toBe("no se lee");
  });

  it("la línea del dólar digital de otra red no es la que se pide", async () => {
    const p = lineaPendiente(real);
    const leida = await leerLaLinea(p.unsignedPayload, RED);
    expect(motivoContraLaLinea(p, P, leida, SUB, { code: "USDC", issuer: OTRO_EMISOR })).toBe("otro emisor");
  });

  it("los motivos son palabras fijas: nunca una dirección ni un hash", async () => {
    const motivos = await Promise.all(transacciones.map(([, transaccion]) => contraLaLinea(lineaPendiente(transaccion()))));
    for (const m of motivos) {
      expect(m).not.toMatch(/[GCM][A-Z2-7]{55}/);
      expect(m).not.toMatch(/[0-9a-f]{40,}/);
    }
  });
});
