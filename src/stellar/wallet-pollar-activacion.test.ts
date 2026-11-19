import { Account, Asset, Keypair, MuxedAccount, Networks, Operation, type Transaction, TransactionBuilder, type xdr } from "@stellar/stellar-sdk";
import { CosignManager, type CosignRequest, recognizedSetupRequest } from "@pollar/core";
import { describe, expect, it } from "vitest";
import { type PedidoDeCofirma, leerTransaccion, motivoContraLaActivacion, propuestaEsLaNuestra } from "./wallet-pollar";

/**
 * La regla que decide si `activarCuenta` puede votar que sí (sección 5 del diseño de «Dejá tu cuenta lista»), contra
 * transacciones de verdad armadas con el SDK de Stellar, y contra el lector del propio kit de Pollar.
 *
 * Lo que se vio en vivo el 10 de noviembre de 2026: la paga una cuenta de Pollar, comisión 300, ya trae la firma de quien
 * patrocina, y tiene tres operaciones: abrir el patrocinio de la cuenta nueva, crearla con saldo 0 y cerrar el
 * patrocinio desde la cuenta nueva. Es lo único que se aprueba.
 */

const patrocinador = Keypair.random();
const persona = Keypair.random();
const otra = Keypair.random();
const P = persona.publicKey();
const S = patrocinador.publicKey();
const SUB = "sub-org-de-ana";
const muxDe = (g: string): string => new MuxedAccount(new Account(g, "0"), "7").accountId();
const MP = muxDe(P);

const abre = (o: { sponsoredId?: string; source?: string } = {}): xdr.Operation =>
  Operation.beginSponsoringFutureReserves({ sponsoredId: o.sponsoredId ?? P, ...(o.source ? { source: o.source } : {}) });
const crea = (o: { destination?: string; startingBalance?: string; source?: string } = {}): xdr.Operation =>
  Operation.createAccount({ destination: o.destination ?? P, startingBalance: o.startingBalance ?? "0", ...(o.source ? { source: o.source } : {}) });
const cierra = (o: { source?: string | null } = {}): xdr.Operation =>
  Operation.endSponsoringFutureReserves(o.source === null ? {} : { source: o.source ?? P });

/** Una transacción como la de Pollar: la paga `fuente` (por defecto, quien patrocina) y ya trae su firma. */
function armar(ops: readonly xdr.Operation[], o: { fuente?: string | MuxedAccount } = {}): Transaction {
  const fuente = o.fuente ?? S;
  const cuenta = typeof fuente === "string" ? new Account(fuente, "1") : fuente;
  const b = new TransactionBuilder(cuenta, { fee: "300", networkPassphrase: Networks.PUBLIC });
  for (const op of ops) b.addOperation(op);
  const tx = b.setTimeout(300).build();
  tx.sign(patrocinador);
  return tx;
}
const buena = (): Transaction => armar([abre(), crea(), cierra()]);

function pedidoDe(payload: string, hash: string, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma {
  return {
    id: "pedido-1",
    kind: "TX",
    network: "STELLAR",
    status: "PENDING",
    intent: "account_create",
    operation: "create_account",
    account: P,
    signWith: P,
    appPaysFee: true,
    refreshable: true,
    unsignedPayload: payload,
    payloadHash: hash,
    activityId: null,
    subOrgId: SUB,
    createdAt: "2026-11-10T23:30:00.000Z",
    expiresAt: "2026-11-11T23:30:00.000Z",
    ...cambios,
  };
}
const pedidoDeTx = (tx: Transaction, cambios: Partial<PedidoDeCofirma> = {}): PedidoDeCofirma => pedidoDe(tx.toXDR(), Buffer.from(tx.hash()).toString("hex"), cambios);

async function motivo(p: PedidoDeCofirma, o: { cuenta?: string; red?: string; subOrg?: string | null } = {}): Promise<string | null> {
  const tx = await leerTransaccion(p.unsignedPayload, o.red ?? Networks.PUBLIC);
  return motivoContraLaActivacion(p, o.cuenta ?? P, tx, o.subOrg === undefined ? SUB : o.subOrg);
}
const delKit = (p: PedidoDeCofirma) => recognizedSetupRequest(p as unknown as CosignRequest);

describe("la activación que se vio en vivo", () => {
  it("pasa la regla y el lector del kit", async () => {
    const p = pedidoDeTx(buena());
    expect(await motivo(p)).toBeNull();
    expect(delKit(p)).toEqual({ ok: true, kind: "account_create" });
  });

  it("leerTransaccion da quién paga, el hash con la red de la página y cada operación", async () => {
    const tx = buena();
    const leida = await leerTransaccion(tx.toXDR(), Networks.PUBLIC);
    expect(leida?.fuente).toBe(S);
    expect(leida?.hash).toBe(Buffer.from(tx.hash()).toString("hex"));
    expect(leida?.operaciones.map((o) => o.type)).toEqual(["beginSponsoringFutureReserves", "createAccount", "endSponsoringFutureReserves"]);
    expect(Number(leida?.operaciones[1]?.startingBalance)).toBe(0);
  });

  it("el hash del pedido en mayúsculas da lo mismo", async () => {
    const tx = buena();
    expect(await motivo(pedidoDeTx(tx, { payloadHash: Buffer.from(tx.hash()).toString("hex").toUpperCase() }))).toBeNull();
  });

  it("con la cuenta de quien patrocina escrita en las dos primeras operaciones, pasa igual", async () => {
    expect(await motivo(pedidoDeTx(armar([abre({ source: S }), crea({ source: S }), cierra()])))).toBeNull();
  });

  it("sin appPaysFee (no está en los tipos del kit) pasa igual: que la persona no paga lo asegura quién paga la transacción", async () => {
    const p = pedidoDeTx(buena());
    delete p.appPaysFee;
    expect(await motivo(p)).toBeNull();
  });
});

describe("transacciones que no se aprueban", () => {
  const pago = Operation.payment({ destination: S, asset: Asset.native(), amount: "1", source: P });
  const firmante = Operation.setOptions({ signer: { ed25519PublicKey: otra.publicKey(), weight: 1 }, source: P });
  const confianza = Operation.changeTrust({ asset: new Asset("USDC", otra.publicKey()), source: P });
  const casos: Array<{ que: string; tx: () => Transaction; motivo: string | RegExp; kitTambien?: boolean }> = [
    { que: "una cuarta operación: un pago desde la persona", tx: () => armar([abre(), crea(), cierra(), pago]), motivo: "operaciones: beginSponsoringFutureReserves,createAccount,endSponsoringFutureReserves,payment" },
    { que: "un setOptions desde la persona que suma un firmante", tx: () => armar([abre(), crea(), firmante, cierra()]), motivo: "operaciones: beginSponsoringFutureReserves,createAccount,setOptions,endSponsoringFutureReserves" },
    { que: "una línea de confianza en el medio", tx: () => armar([abre(), crea(), confianza, cierra()]), motivo: "operaciones: beginSponsoringFutureReserves,createAccount,changeTrust,endSponsoringFutureReserves" },
    { que: "el orden cambiado", tx: () => armar([crea(), abre(), cierra()]), motivo: "operaciones: createAccount,beginSponsoringFutureReserves,endSponsoringFutureReserves" },
    { que: "crea otra cuenta", tx: () => armar([abre(), crea({ destination: otra.publicKey() }), cierra()]), motivo: /^operaciones: /, kitTambien: true },
    { que: "patrocina otra cuenta", tx: () => armar([abre({ sponsoredId: otra.publicKey() }), crea(), cierra()]), motivo: /^operaciones: /, kitTambien: true },
    { que: "con saldo inicial 1", tx: () => armar([abre(), crea({ startingBalance: "1" }), cierra()]), motivo: /^operaciones: / },
    { que: "el cierre del patrocinio sin cuenta propia", tx: () => armar([abre(), crea(), cierra({ source: null })]), motivo: /^operaciones: / },
    { que: "la paga la persona", tx: () => armar([abre({ source: S }), crea({ source: S }), cierra()], { fuente: P }), motivo: "quién paga" },
    { que: "la paga la persona con su dirección M", tx: () => armar([abre({ source: S }), crea({ source: S }), cierra()], { fuente: new MuxedAccount(new Account(P, "1"), "7") }), motivo: "quién paga" },
    { que: "abre el patrocinio desde la persona", tx: () => armar([abre({ source: P }), crea(), cierra()]), motivo: /^operaciones: / },
    { que: "abre el patrocinio desde la M de la persona", tx: () => armar([abre({ source: MP }), crea(), cierra()]), motivo: /^operaciones: / },
    { que: "crea la cuenta desde la persona", tx: () => armar([abre(), crea({ source: P }), cierra()]), motivo: /^operaciones: / },
    { que: "crea la cuenta desde la M de la persona", tx: () => armar([abre(), crea({ source: MP }), cierra()]), motivo: /^operaciones: / },
    { que: "dos operaciones", tx: () => armar([abre(), crea()]), motivo: "operaciones: beginSponsoringFutureReserves,createAccount" },
    { que: "el cierre del patrocinio desde otra cuenta", tx: () => armar([abre(), crea(), cierra({ source: otra.publicKey() })]), motivo: /^operaciones: / },
    { que: "el cierre del patrocinio desde la M de la persona", tx: () => armar([abre(), crea(), cierra({ source: MP })]), motivo: /^operaciones: / },
  ];

  it.each(casos)("$que", async ({ tx, motivo: esperado, kitTambien }) => {
    const p = pedidoDeTx(tx());
    const m = await motivo(p);
    expect(m).not.toBeNull();
    if (typeof esperado === "string") expect(m).toBe(esperado);
    else expect(m).toMatch(esperado);
    // El motivo va a la consola: nunca lleva direcciones.
    expect(m).not.toMatch(/[GM][A-Z2-7]{55}/);
    // Lo que el kit también rechaza, los dos lectores lo rechazan.
    if (kitTambien) expect(delKit(p).ok).toBe(false);
  });

  it("una transacción envuelta (otra cuenta paga por encima) no se lee", async () => {
    const fb = TransactionBuilder.buildFeeBumpTransaction(patrocinador, "600", buena(), Networks.PUBLIC);
    fb.sign(patrocinador);
    expect(await leerTransaccion(fb.toXDR(), Networks.PUBLIC)).toBeNull();
    expect(await motivo(pedidoDe(fb.toXDR(), Buffer.from(fb.hash()).toString("hex")))).toBe("no se lee");
  });

  it("un XDR que no se lee no se aprueba, y el kit tampoco lo reconoce", async () => {
    const p = pedidoDe("esto-no-es-xdr", "ab".repeat(32));
    expect(await motivo(p)).toBe("no se lee");
    expect(delKit(p).ok).toBe(false);
  });

  it("la misma transacción leída con la frase de la red de prueba no da el hash", async () => {
    expect(await motivo(pedidoDeTx(buena()), { red: Networks.TESTNET })).toBe("hash");
  });

  it("un hash del pedido que no es el de la transacción", async () => {
    expect(await motivo(pedidoDeTx(buena(), { payloadHash: "cd".repeat(32) }))).toBe("hash");
  });
});

describe("cada campo del pedido, cambiado de a uno", () => {
  const casos: Array<{ que: string; cambios: Partial<PedidoDeCofirma>; motivo: string; kitTambien?: boolean }> = [
    { que: "P1: ya no está pendiente", cambios: { status: "APPROVED" }, motivo: "estado", kitTambien: true },
    { que: "P2: no es una transacción", cambios: { kind: "SEP10" }, motivo: "tipo", kitTambien: true },
    { que: "P3: otra cadena", cambios: { network: "POLYGON" }, motivo: "tipo", kitTambien: true },
    { que: "P4: otra intención", cambios: { intent: "sign_and_send" }, motivo: "intención" },
    { que: "P5: otra operación", cambios: { operation: "change_trust" }, motivo: "intención" },
    { que: "P6: otra cuenta", cambios: { account: otra.publicKey() }, motivo: "otra cuenta" },
    { que: "P6: firma con otra cuenta", cambios: { signWith: otra.publicKey() }, motivo: "otra cuenta" },
    { que: "P7: la app no paga", cambios: { appPaysFee: false }, motivo: "no paga la app" },
    { que: "P8: ya votado", cambios: { activityId: "actividad-1" }, motivo: "ya votado" },
    { que: "P9: sin transacción", cambios: { unsignedPayload: "" }, motivo: "sin transacción" },
    { que: "P9: sin hash", cambios: { payloadHash: "" }, motivo: "sin transacción" },
    { que: "P11: otra organización", cambios: { subOrgId: "otra-sub-org" }, motivo: "otra organización" },
  ];

  it.each(casos)("$que", async ({ cambios, motivo: esperado, kitTambien }) => {
    const p = pedidoDeTx(buena(), cambios);
    expect(await motivo(p)).toBe(esperado);
    if (kitTambien) expect(delKit(p).ok).toBe(false);
  });

  it("P6: un pedido sin cuenta tiene su propio motivo", async () => {
    const p = pedidoDeTx(buena());
    delete p.account;
    expect(await motivo(p)).toBe("pedido sin cuenta");
  });

  it("P11: si no se pudo leer la organización de esta sesión, no se vota", async () => {
    expect(await motivo(pedidoDeTx(buena()), { subOrg: null })).toBe("otra organización");
  });

  it("C1: una cuenta que no empieza con G (la M de la persona) no pasa", async () => {
    expect(await motivo(pedidoDeTx(buena(), { account: MP, signWith: MP }), { cuenta: MP })).toBe("cuenta");
  });
});

describe("lo que se va a estampar es nuestro hash, para esta cuenta y esta organización", () => {
  /** El `verify` del kit de verdad, con la red principal: arma la propuesta igual que antes de un voto. */
  const kit = new CosignManager({
    api: {} as never,
    keyManager: {} as never,
    logger: { debug() {}, info() {}, warn() {}, error() {} } as never,
    networkPassphrase: () => Networks.PUBLIC,
    onRequest: () => undefined,
  });

  async function propuestaDelKit(): Promise<{ proposal: { path: string; body: Record<string, unknown> }; hash: string }> {
    const tx = buena();
    const v = await kit.verify(pedidoDeTx(tx) as unknown as CosignRequest);
    if (!v.ok) throw new Error(v.reason);
    expect(v.localHash).toBe(Buffer.from(tx.hash()).toString("hex"));
    return { proposal: v.proposal as unknown as { path: string; body: Record<string, unknown> }, hash: v.localHash };
  }
  const conCambio = (p: { path: string; body: Record<string, unknown> }, f: (c: { path: string; body: Record<string, unknown> & { parameters: Record<string, unknown> } }) => void) => {
    const c = structuredClone(p) as { path: string; body: Record<string, unknown> & { parameters: Record<string, unknown> } };
    f(c);
    return c;
  };

  it("pasa la que arma verify del kit sobre el pedido bueno", async () => {
    const { proposal, hash } = await propuestaDelKit();
    expect(propuestaEsLaNuestra(proposal, P, hash, SUB)).toBe(true);
  });

  const cambios: Array<[string, (c: { path: string; body: Record<string, unknown> & { parameters: Record<string, unknown> } }) => void]> = [
    ["otra ruta", (c) => (c.path = "/public/v1/submit/sign_transaction")],
    ["otro tipo", (c) => (c.body.type = "ACTIVITY_TYPE_SIGN_TRANSACTION_V2")],
    ["otra organización", (c) => (c.body.organizationId = "otra-sub-org")],
    ["otra cuenta que firma", (c) => (c.body.parameters.signWith = otra.publicKey())],
    ["otro payload", (c) => (c.body.parameters.payload = "ef".repeat(32))],
    ["otra codificación", (c) => (c.body.parameters.encoding = "PAYLOAD_ENCODING_TEXT_UTF8")],
    ["otra función de hash", (c) => (c.body.parameters.hashFunction = "HASH_FUNCTION_SHA256")],
    ["una clave de más", (c) => (c.body.parameters.extra = "x")],
  ];
  it.each(cambios)("no pasa con %s", async (_que, f) => {
    const { proposal, hash } = await propuestaDelKit();
    expect(propuestaEsLaNuestra(conCambio(proposal, f), P, hash, SUB)).toBe(false);
  });

  it("no pasa sin organización de la sesión, ni con parameters vacío o ausente", async () => {
    const { proposal, hash } = await propuestaDelKit();
    expect(propuestaEsLaNuestra(proposal, P, hash, "")).toBe(false);
    expect(propuestaEsLaNuestra(conCambio(proposal, (c) => ((c.body as Record<string, unknown>).parameters = null)), P, hash, SUB)).toBe(false);
    expect(propuestaEsLaNuestra(conCambio(proposal, (c) => delete (c.body as Record<string, unknown>).parameters), P, hash, SUB)).toBe(false);
  });
});
