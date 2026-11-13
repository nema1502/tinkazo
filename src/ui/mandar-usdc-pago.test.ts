import { Keypair, Networks, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { USDC_MAINNET } from "../stellar/pagos";
import type { CuentaMirada, LecturaDeCuenta } from "../stellar/usdc-cuenta";
import { armarEnvio, prepararEnvio } from "./mandar-usdc";

/**
 * El pago de Mandar mis dólares digitales, armado con el SDK de Stellar (sin jsdom: el SDK no se lleva con sus
 * arreglos de bytes). La ventana se prueba en mandar-usdc.test.ts.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const D = 10_000_000n;

const mirada = (saldo: string | null, o: Partial<CuentaMirada> = {}): CuentaMirada => ({
  secuencia: "500",
  saldos: saldo === null ? [] : [{ code: "USDC", issuer: USDC_MAINNET.issuer, saldo, limite: "922337203685.4775807", autorizada: true, patrocinador: null }],
  xlm: "2.0000000",
  xlmComprometido: "0.0000000",
  subentradas: 1,
  patrocinando: 0,
  patrocinadas: 1,
  ...o,
});

const leer = (xdr: string): Transaction => TransactionBuilder.fromXDR(xdr, Networks.PUBLIC) as Transaction;

describe("el pago", () => {
  it("es un pago de USDC de Circle a la cuenta pegada, por el monto elegido, con la nota pedida", async () => {
    const tx = leer(await armarEnvio({ red: "mainnet", origen: YO, destino: OTRA, monto: 125n * D / 10n, nota: { tipo: "id", valor: "998877" } }, "500"));
    expect(tx.source).toBe(YO);
    expect(tx.sequence).toBe("501");
    expect(tx.fee).toBe("1000");
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0] as unknown as { type: string; destination: string; asset: { code: string; issuer: string }; amount: string };
    expect(op.type).toBe("payment");
    expect(op.destination).toBe(OTRA);
    expect({ code: op.asset.code, issuer: op.asset.issuer }).toEqual(USDC_MAINNET);
    expect(op.amount).toBe("12.5000000");
    expect(tx.memo.type).toBe("id");
    expect(String(tx.memo.value)).toBe("998877");
  });

  it("con nota de texto, o sin nota", async () => {
    const conTexto = leer(await armarEnvio({ red: "mainnet", origen: YO, destino: OTRA, monto: D, nota: { tipo: "texto", valor: "para Ana" } }, "1"));
    expect(conTexto.memo.type).toBe("text");
    expect(new TextDecoder().decode(conTexto.memo.value as Uint8Array)).toBe("para Ana");
    const sin = leer(await armarEnvio({ red: "mainnet", origen: YO, destino: OTRA, monto: D, nota: { tipo: "ninguna" } }, "1"));
    expect(sin.memo.type).toBe("none");
  });

  it("prepararEnvio mira las dos cuentas: el destino tiene que poder recibir y el origen tener el saldo", async () => {
    const datos = { red: "mainnet" as const, origen: YO, destino: OTRA, monto: 5n * D, nota: { tipo: "ninguna" as const } };
    const con = (o: LecturaDeCuenta, dst: LecturaDeCuenta) => async (c: string): Promise<LecturaDeCuenta> => (c === YO ? o : dst);
    expect((await prepararEnvio(datos, con(mirada("12.5000000"), mirada("0.0000000")))).ok).toBe(true);
    expect(await prepararEnvio(datos, con(mirada("12.5000000"), mirada(null)))).toEqual({ ok: false, motivo: "no-recibe" });
    expect(await prepararEnvio(datos, con(mirada("12.5000000"), "no-existe"))).toEqual({ ok: false, motivo: "no-recibe" });
    const llena = mirada("0.0000000");
    (llena.saldos[0] as { limite: string }).limite = "4.0000000";
    expect(await prepararEnvio(datos, con(mirada("12.5000000"), llena))).toEqual({ ok: false, motivo: "no-recibe" });
    const sinAutorizar = mirada("0.0000000");
    (sinAutorizar.saldos[0] as { autorizada: boolean }).autorizada = false;
    expect(await prepararEnvio(datos, con(mirada("12.5000000"), sinAutorizar))).toEqual({ ok: false, motivo: "no-recibe" });
    expect(await prepararEnvio(datos, con(mirada("4.0000000"), mirada("0.0000000")))).toEqual({ ok: false, motivo: "sin-saldo" });
    expect(await prepararEnvio(datos, con(mirada("12.5000000"), "sin-red"))).toEqual({ ok: false, motivo: "sin-red" });
    expect(await prepararEnvio({ ...datos, destino: YO }, con(mirada("12.5000000"), mirada("0.0000000")))).toEqual({ ok: false, motivo: "datos" });
  });
});
