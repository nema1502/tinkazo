import { nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { bytesDeBase64, cobroDeLaDecodificada, declaradoDeSobre, escritoDeMeta, eventosDeComisionDeMeta, leerCobro, medidoDeDiagnostico, recursosDeMeta, retornoDe, retornoDeMeta } from "./cobro";

/** Una unión del XDR del SDK 17 hecha a mano: el campo type, la rama con nombre y el genérico value. */
const union = (type: string, nombre: string, valor: unknown): Record<string, unknown> => ({ type, [nombre]: valor, value: valor });

const entrada = (tipo: string, interior: Record<string, unknown>, bytes: number): Record<string, unknown> => ({
  data: union(tipo, tipo, interior),
  toXDR: (f: string) => (f === "base64" ? "A".repeat(Math.ceil((bytes * 4) / 3)).slice(0, Math.ceil((bytes * 4) / 3)) : new Uint8Array(bytes)),
});

describe("cuántos bytes dice un XDR en base64", () => {
  it("descuenta el relleno", () => {
    expect(bytesDeBase64("")).toBe(0);
    expect(bytesDeBase64("AAAA")).toBe(3);
    expect(bytesDeBase64("AAA=")).toBe(2);
    expect(bytesDeBase64("AA==")).toBe(1);
  });
});

describe("lo declarado en el sobre", () => {
  it("lee los recursos y la comisión que la transacción dijo que pagaría", () => {
    const datos = {
      resources: { instructions: 1500, diskReadBytes: 300, writeBytes: 700, footprint: { readOnly: [1, 2], readWrite: [1, 2, 3] } },
      resourceFee: 123456n,
    };
    const sobre = union("envelopeTypeTx", "v1", { tx: { ext: union("sorobanData", "sorobanData", datos) } });
    expect(declaradoDeSobre(sobre)).toEqual({
      instrucciones: 1500,
      bytesLeidosDisco: 300,
      bytesEscritos: 700,
      entradasSoloLectura: 2,
      entradasLecturaEscritura: 3,
      recursoDeclarado: 123456,
    });
  });

  it("un sobre sin datos de Soroban da todo en cero y no lanza", () => {
    const sobre = union("envelopeTypeTx", "v1", { tx: { ext: union("v0", "v0", null) } });
    expect(declaradoDeSobre(sobre).instrucciones).toBe(0);
    expect(declaradoDeSobre(null).recursoDeclarado).toBe(0);
    expect(declaradoDeSobre("no es un sobre").entradasLecturaEscritura).toBe(0);
  });
});

describe("lo cobrado por recursos", () => {
  it("lee los tres componentes de la meta de Soroban", () => {
    const ext = union("v1", "v1", { totalNonRefundableResourceFeeCharged: 500n, totalRefundableResourceFeeCharged: 3000n, rentFeeCharged: 2800n });
    expect(recursosDeMeta({ ext })).toEqual({ noReembolsables: 500, reembolsables: 3000, alquiler: 2800 });
  });

  it("sin la extensión v1, todo en cero", () => {
    expect(recursosDeMeta({ ext: union("v0", "v0", null) })).toEqual({ noReembolsables: 0, reembolsables: 0, alquiler: 0 });
    expect(recursosDeMeta(null)).toEqual({ noReembolsables: 0, reembolsables: 0, alquiler: 0 });
  });
});

describe("lo que escribió la operación", () => {
  it("cuenta lo creado, lo actualizado y lo restaurado, con su tipo, su vida y sus bytes", () => {
    const cambios = [
      union("ledgerEntryState", "state", entrada("account", {}, 80)),
      union("ledgerEntryCreated", "created", entrada("contractData", { durability: union("persistent", "persistent", null) }, 400)),
      union("ledgerEntryUpdated", "updated", entrada("contractData", { durability: union("temporary", "temporary", null) }, 120)),
      union("ledgerEntryRestored", "restored", entrada("contractCode", {}, 9000)),
      union("ledgerEntryRemoved", "removed", {}),
    ];
    const escrito = escritoDeMeta([{ changes: cambios }]);
    expect(escrito.map((e) => [e.cambio, e.tipo, e.durabilidad ?? null])).toEqual([
      ["creada", "contractData", "persistent"],
      ["actualizada", "contractData", "temporary"],
      ["restaurada", "contractCode", null],
    ]);
    expect(escrito.map((e) => e.bytes)).toEqual([400, 120, 9000]);
  });

  it("sin operaciones, nada", () => {
    expect(escritoDeMeta([])).toEqual([]);
    expect(escritoDeMeta(undefined)).toEqual([]);
  });
});

describe("los eventos de comisión", () => {
  const evento = (monto: bigint): Record<string, unknown> => ({
    event: { body: union("v0", "v0", { topics: [nativeToScVal("fee", { type: "symbol" })], data: nativeToScVal(monto, { type: "i128" }) }) },
  });

  it("separa lo cobrado de lo devuelto", () => {
    expect(eventosDeComisionDeMeta([evento(5000n), evento(-1200n)])).toEqual({ cobro: 5000, reembolso: 1200, neto: 3800 });
  });

  it("sin eventos de comisión, null", () => {
    expect(eventosDeComisionDeMeta([])).toBeNull();
    expect(eventosDeComisionDeMeta(undefined)).toBeNull();
    const otro = { event: { body: union("v0", "v0", { topics: [nativeToScVal("transfer", { type: "symbol" })], data: nativeToScVal(1n, { type: "i128" }) }) } };
    expect(eventosDeComisionDeMeta([otro])).toBeNull();
  });
});

describe("lo medido por el RPC", () => {
  const metrica = (nombre: string, valor: number): Record<string, unknown> => ({
    event: {
      body: union("v0", "v0", {
        topics: [nativeToScVal("core_metrics", { type: "symbol" }), nativeToScVal(nombre, { type: "symbol" })],
        data: nativeToScVal(BigInt(valor), { type: "u64" }),
      }),
    },
  });

  it("junta los cuatro contadores", () => {
    const m = medidoDeDiagnostico([metrica("cpu_insn", 10), metrica("mem_byte", 20), metrica("read_key_byte", 30), metrica("write_data_byte", 40)]);
    expect(m).toEqual({ cpu_insn: 10, mem_byte: 20, read_key_byte: 30, write_data_byte: 40 });
  });

  it("si falta alguno, null: se dice tal cual y no se inventa", () => {
    expect(medidoDeDiagnostico([metrica("cpu_insn", 10)])).toBeNull();
    expect(medidoDeDiagnostico([])).toBeNull();
  });
});

describe("el cobro armado", () => {
  it("la inclusión es lo que sobra del total al restar los recursos", () => {
    const meta = {
      sorobanMeta: { ext: union("v1", "v1", { totalNonRefundableResourceFeeCharged: 500n, totalRefundableResourceFeeCharged: 3000n, rentFeeCharged: 2800n }) },
      operations: [],
      events: [],
      diagnosticEvents: [],
    };
    const c = cobroDeLaDecodificada({ hash: "ab", ledger: 7, estado: "SUCCESS", totalStroops: 3700, sobre: null, bytesDeLaTransaccion: 900, meta, diagnosticos: [] });
    expect(c.inclusionStroops).toBe(200);
    expect(c.alquiler).toBe(2800);
    expect(c.totalStroops).toBe(3700);
    expect(c.medido).toBeNull();
    expect(c.eventosDeComision).toBeNull();
    expect(c.bytesDeLaTransaccion).toBe(900);
  });

  it("una respuesta vacía o rota no lanza y da ceros", () => {
    const c = leerCobro({ status: "SUCCESS", hash: "cd", ledger: "12", resultXdr: "no es xdr", resultMetaXdr: "tampoco", envelopeXdr: "AAAA" });
    expect(c.ledger).toBe(12);
    expect(c.totalStroops).toBe(0);
    expect(c.escrito).toEqual([]);
    expect(c.medido).toBeNull();
    expect(c.bytesDeLaTransaccion).toBe(3);
  });

  it("el SDK 17 expone lo que la lectura necesita", () => {
    expect(typeof xdr.TransactionResult.fromXDR).toBe("function");
    expect(typeof xdr.TransactionMeta.fromXDR).toBe("function");
    expect(typeof xdr.TransactionEnvelope.fromXDR).toBe("function");
    expect(typeof xdr.DiagnosticEvent.fromXDR).toBe("function");
  });
});

describe("lo que devolvió la llamada", () => {
  it("el valor sale de la meta de Soroban", () => {
    expect(retornoDeMeta({ sorobanMeta: { returnValue: nativeToScVal(7n, { type: "u64" }) } })).toBe(7n);
  });

  it("sin meta o sin valor, undefined y sin lanzar", () => {
    expect(retornoDeMeta(null)).toBeUndefined();
    expect(retornoDeMeta({ sorobanMeta: {} })).toBeUndefined();
    expect(retornoDe({ status: "SUCCESS", resultMetaXdr: "no es xdr" })).toBeUndefined();
    expect(retornoDe({ status: "SUCCESS" })).toBeUndefined();
  });
});
