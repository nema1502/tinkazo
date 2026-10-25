import { describe, expect, it, vi } from "vitest";
import vectors from "../../docs/vectors.json";
import { verifyRound } from "./drand";
import { PROOF_VERSION, type Proof } from "./proof";
import { roundTime } from "./quicknet";
import { type Dependencias, type Registro, revisarComprobante } from "./verificacion";
import { contratoOficial, contratosOficiales } from "../stellar/oficiales";
import type { LecturaDelHistorial } from "../stellar/historial";

/**
 * Un contrato anterior al que le falta su `ultimoLedger` no se acepta por historial
 * (docs/protocolo.md §7.1): el contrato no tiene dueño, cualquiera puede seguir
 * sellando en él y la transacción de un sello no trae el número del sorteo, así que
 * sin ese tope un sello de hoy pasaría por uno de antes. Acá la lista oficial es de
 * mentira (`deployments.json`), con uno anterior sin su último ledger y otro con él.
 */
const lista = vi.hoisted(() => ({
  testnet: {
    contractId: "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A",
    wasmSha256: "c2403e081fc2d91ee86ea5faf58861e2d91d38f4846585b4f08ad215d85a546e",
    anteriores: [
      {
        contractId: "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH",
        wasmSha256: "c9f3227ffb92ef04ad62911c6b4788f22999242ddaf80f0e638ba4dd97e60d1e",
        ultimoId: 936,
      } as { contractId: string; wasmSha256: string; ultimoId: number; ultimoLedger?: unknown },
      {
        contractId: "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ",
        wasmSha256: "6008a5e42ca06079c7a12dddbe3b33629245963853df65ad81df0c3d63eabd75",
        ultimoId: 1,
        ultimoLedger: 4709441 as unknown,
      },
    ],
  },
  mainnet: null,
}));
vi.mock("../stellar/deployments.json", () => ({ default: lista }));

const { round: R, signature: FIRMA } = vectors.quicknet;
const VIGENTE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const SIN_LEDGER = "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH";
const CON_LEDGER = "CDVAI2RK6DCBP4VVMW5LP7VQ4QH7O2E5WHQQSRNVF367BDIORYDJ3LDJ";
const STX = "ab".repeat(32);

const comprobante = (contract: string, id: string): Proof => ({
  v: PROOF_VERSION,
  names: [...vectors.list],
  round: R,
  signature: FIRMA,
  net: "testnet",
  contract,
  id,
  stx: STX,
});

const lectura = (contractId: string): LecturaDelHistorial => ({
  ok: true,
  sello: {
    hash: STX,
    hashInterior: STX,
    contractId,
    organizer: "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY",
    listHash: vectors.list_hash,
    count: vectors.count,
    numWinners: 1,
    round: R,
    meta: "",
    closedAt: roundTime(R) - 60,
    ledger: 4_000_000,
  },
});

/** Un estado en el que la entrada ya se archivó, como el de cualquiera de estos contratos viejos. */
const archivado = (wasm: string): Registro => ({ wasm, siguiente: 937, sello: null, resultado: null });

function deps(wasm: string, contractId: string): Dependencias & { historias: string[] } {
  const historias: string[] = [];
  return {
    historias,
    verificarFirma: async (r, s) => verifyRound(r, s),
    traerFirma: async () => FIRMA,
    leerRegistro: async () => archivado(wasm),
    leerHistorial: async (_red, hash) => {
      historias.push(hash);
      return lectura(contractId);
    },
  };
}

describe("el tope de un contrato anterior, para verificar por historial", () => {
  it("la lista (simulada) tiene uno anterior sin ultimoLedger y otro con él", () => {
    expect(contratoOficial("testnet", SIN_LEDGER)).toMatchObject({ vigente: false, ultimoId: 936 });
    expect(contratoOficial("testnet", SIN_LEDGER)?.ultimoLedger).toBeUndefined();
    expect(contratoOficial("testnet", CON_LEDGER)).toMatchObject({ vigente: false, ultimoId: 1, ultimoLedger: 4_709_441 });
    expect(contratoOficial("testnet", VIGENTE)?.ultimoLedger).toBeUndefined();
  });

  it("un anterior sin su último ledger no se acepta por historial: ni se pregunta, y queda 'no está'", async () => {
    const o = contratoOficial("testnet", SIN_LEDGER);
    const d = deps(o?.wasmSha256 ?? "", SIN_LEDGER);
    const r = await revisarComprobante(comprobante(SIN_LEDGER, "936"), d);
    expect(r.veredicto).toBe("falta");
    expect(r.fuente).toBe("estado");
    expect(d.historias).toEqual([]);
  });

  it("uno anterior con su último ledger sí, y el vigente, que no lleva tope, también", async () => {
    const o = contratoOficial("testnet", CON_LEDGER);
    const d = deps(o?.wasmSha256 ?? "", CON_LEDGER);
    const r = await revisarComprobante(comprobante(CON_LEDGER, "1"), d);
    expect(r.veredicto).toBe("verde");
    expect(r.fuente).toBe("historial");
    expect(d.historias).toEqual([STX]);
    const v = contratoOficial("testnet", VIGENTE);
    const dv = deps(v?.wasmSha256 ?? "", VIGENTE);
    const rv = await revisarComprobante(comprobante(VIGENTE, "5"), dv);
    expect(rv.veredicto).toBe("verde");
    expect(dv.historias).toEqual([STX]);
  });

  it("el tope por número sigue valiendo antes de leer nada, con o sin ultimoLedger", async () => {
    const o = contratoOficial("testnet", CON_LEDGER);
    const d = deps(o?.wasmSha256 ?? "", CON_LEDGER);
    const r = await revisarComprobante(comprobante(CON_LEDGER, "2"), d);
    expect(r.veredicto).toBe("mal");
    expect(r.motivos).toEqual(["contrato-retirado"]);
    expect(d.historias).toEqual([]);
  });

  it("la lista oficial pasa el ultimoLedger solo si es un número entero positivo", () => {
    const el = (): unknown => contratoOficial("testnet", CON_LEDGER)?.ultimoLedger;
    expect(el()).toBe(4_709_441);
    for (const raro of [0, -5, 1.5, "4709441", null, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      lista.testnet.anteriores[1]!.ultimoLedger = raro;
      expect(el(), String(raro)).toBeUndefined();
    }
    lista.testnet.anteriores[1]!.ultimoLedger = 4_709_441;
    expect(el()).toBe(4_709_441);
    expect(contratosOficiales("testnet").map((c) => [c.contractId, c.ultimoLedger])).toEqual([
      [VIGENTE, undefined],
      [SIN_LEDGER, undefined],
      [CON_LEDGER, 4_709_441],
    ]);
  });
});
