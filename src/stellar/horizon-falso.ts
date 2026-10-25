import { Account, Contract, TransactionBuilder, nativeToScVal, type xdr } from "@stellar/stellar-sdk";

/**
 * Un Horizon de mentira para las pruebas del historial (`historial.test.ts`,
 * `verificacion-historial.test.ts`): arma, sin red, transacciones de Stellar
 * como las que mandaría el sitio y el JSON con que Horizon las devolvería. Solo
 * lo usan las pruebas; nada de la página lo importa.
 */

export const PASSPHRASE_TESTNET = "Test SDF Network ; September 2015";
export const PASSPHRASE_MAINNET = "Public Global Stellar Network ; September 2015";

/** Una cuenta cualquiera de testnet, la que firma las transacciones de prueba. */
export const CUENTA = "GD6P7XJV6BAJLA6UJ2BJKPTYMTVDHR4O4DIYJ4TLZUBARXYQX2W4R526";
/** Otra, que paga la comisión cuando un fee-bump envuelve la transacción. */
export const CUENTA_QUE_PAGA = "GBP746LLN2GLXETI26PEJEY6BDKBO3726DRVMZ5GXFU54LNITNQBUBOT";

/** Lo que se le manda a `seal(organizer, list_hash, count, num_winners, round, meta)`. */
export interface ArgsDelSello {
  organizer: string;
  /** Huella de la lista, en hex. */
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  meta: string;
}

/** Los seis argumentos de `seal`, con los tipos del contrato. */
export function argsDeSello(a: ArgsDelSello): xdr.ScVal[] {
  return [
    nativeToScVal(a.organizer, { type: "address" }),
    nativeToScVal(Uint8Array.from(Buffer.from(a.listHash, "hex"))),
    nativeToScVal(a.count, { type: "u32" }),
    nativeToScVal(a.numWinners, { type: "u32" }),
    nativeToScVal(BigInt(a.round), { type: "u64" }),
    nativeToScVal(a.meta, { type: "string" }),
  ];
}

export interface TxArmada {
  /** El hash de la transacción tal como la ve Horizon: el del fee-bump si lo hay. */
  hash: string;
  /** El hash de la transacción interior; el mismo de arriba si no hay fee-bump. */
  hashInterior: string;
  /** El sobre, en base64. */
  envelopeXdr: string;
}

/**
 * Una transacción de una sola operación que llama a `funcion` de `contrato`, con
 * el hash que le corresponde en `passphrase`. Con `feeBump`, la envuelve otra cuenta.
 */
export function armarTx(o: {
  contrato: string;
  funcion?: string;
  args: xdr.ScVal[];
  passphrase?: string;
  feeBump?: boolean;
  origen?: string;
}): TxArmada {
  const passphrase = o.passphrase ?? PASSPHRASE_TESTNET;
  const interior = new TransactionBuilder(new Account(o.origen ?? CUENTA, "1000"), { fee: "100", networkPassphrase: passphrase })
    .addOperation(new Contract(o.contrato).call(o.funcion ?? "seal", ...o.args))
    .setTimeout(30)
    .build();
  const hashInterior = Buffer.from(interior.hash()).toString("hex");
  if (!o.feeBump) return { hash: hashInterior, hashInterior, envelopeXdr: interior.toXDR() };
  const fb = TransactionBuilder.buildFeeBumpTransaction(CUENTA_QUE_PAGA, "200", interior, passphrase);
  return { hash: Buffer.from(fb.hash()).toString("hex"), hashInterior, envelopeXdr: fb.toXDR() };
}

/** Un `seal` armado con los argumentos del sello de un sorteo. */
export const armarSello = (contrato: string, a: ArgsDelSello, o: { feeBump?: boolean; passphrase?: string } = {}): TxArmada =>
  armarTx({ contrato, args: argsDeSello(a), ...o });

/** El JSON que devuelve Horizon en `GET /transactions/{hash}`, en lo que lee el historial. */
export function registroDeHorizon(
  tx: TxArmada,
  o: { successful?: boolean; ledger?: number; cierre?: number; hash?: string } = {},
): Record<string, unknown> {
  const hash = o.hash ?? tx.hash;
  return {
    id: hash,
    hash,
    successful: o.successful ?? true,
    ledger: o.ledger ?? 5_000_000,
    created_at: new Date((o.cierre ?? 1_790_000_000) * 1000).toISOString().replace(".000Z", "Z"),
    source_account: CUENTA,
    fee_account: CUENTA,
    envelope_xdr: tx.envelopeXdr,
    result_xdr: "AAAAAAAAAAA=",
    operation_count: 1,
  };
}

/** Lo que registra el `fetch` de mentira de cada pedido. */
export interface HorizonFalso {
  fetch: typeof fetch;
  /** Las direcciones que se pidieron, en orden. */
  pedidos: string[];
}

/**
 * Un `fetch` que contesta como Horizon: a `/transactions/{hash}` con el registro
 * que se le dio para ese hash (un objeto, que se devuelve como JSON; un texto, tal
 * cual; un número, como estado HTTP vacío), y 404 si no sabe de ese hash.
 */
export function horizonFalso(registros: Record<string, unknown>): HorizonFalso {
  const pedidos: string[] = [];
  const f = (async (entrada: string | URL | Request) => {
    const url = String(entrada);
    pedidos.push(url);
    const hash = url.split("/transactions/")[1] ?? "";
    const r = registros[hash];
    if (r === undefined) return new Response(JSON.stringify({ status: 404, title: "Resource Missing" }), { status: 404 });
    if (typeof r === "number") return new Response("", { status: r });
    return new Response(typeof r === "string" ? r : JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, pedidos };
}
