import { Address, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { verifyRound } from "../protocol/drand";
import { PROOF_VERSION, type Proof } from "../protocol/proof";
import { revisarComprobante } from "../protocol/verificacion";
import { contratoOficial, type ContratoOficial } from "./oficiales";
import { RegistroDeforme, leerRegistro, leerRegistros, resultadoDe, selloDe } from "./registro";

/**
 * La lectura del registro, con respuestas de verdad del RPC de testnet, grabadas
 * el 22 de octubre de 2026 (`getLedgerEntries` con la instancia, `Raffle(id)` y
 * `Draw(id)`):
 * - el #165 del contrato de Tinkazo en testnet: la lista de ejemplo, sellada y
 *   sorteada por la QA de flujo el 4 de octubre;
 * - el "#278" del contrato ajeno de la prueba de la fase 1 (`CDIBBDOR…JUU3`):
 *   un sorteo inventado, con la misma forma que los de Tinkazo.
 */
const XDR_165 = {
  instancia:
    "AAAABgAAAAAAAAAB9SkcNN/DJ4ltDq7HGivYl0BSKEgTI2hZqXMRzpGSBggAAAAUAAAAAQAAABMAAAAAyfMif/uS7wStYpEca0eI8imZJC3a+A8OY4uk3ZfmDR4AAAABAAAAAQAAABAAAAABAAAAAQAAAA8AAAAGTmV4dElkAAAAAAAFAAAAAAAAAzI=",
  sello:
    "AAAABgAAAAAAAAAB9SkcNN/DJ4ltDq7HGivYl0BSKEgTI2hZqXMRzpGSBggAAAAQAAAAAQAAAAIAAAAPAAAABlJhZmZsZQAAAAAABQAAAAAAAAClAAAAAQAAABEAAAABAAAACgAAAA8AAAAFY291bnQAAAAAAAADAAAAEgAAAA8AAAACaWQAAAAAAAUAAAAAAAAApQAAAA8AAAAJbGlzdF9oYXNoAAAAAAAADQAAACAy4gmceo3ee2iSUj3H0+NKwGqXL9Z/FCGGxY3O1Roh7wAAAA8AAAAEbWV0YQAAAA4AAAAwU29ydGVvIGRlIGRlbW9zdHJhY2nDs24sIGNvbiBsYSBsaXN0YSBkZSBlamVtcGxvAAAADwAAAAtudW1fd2lubmVycwAAAAADAAAAAQAAAA8AAAAJb3JnYW5pemVyAAAAAAAAEgAAAAAAAAAANzJwHj+G7vsG02U47eKXyOLW8mRA15LOl1O3tBT6Sg4AAAAPAAAABXJvdW5kAAAAAAAABQAAAAAB9AbrAAAADwAAAAlzZWFsZWRfYXQAAAAAAAAFAAAAAGrCNb0AAAAPAAAADXNlYWxlZF9sZWRnZXIAAAAAAAADAEyQ0gAAAA8AAAAGc3RhdHVzAAAAAAAQAAAAAQAAAAEAAAAPAAAABURyYXduAAAA",
  resultado:
    "AAAABgAAAAAAAAAB9SkcNN/DJ4ltDq7HGivYl0BSKEgTI2hZqXMRzpGSBggAAAAQAAAAAQAAAAIAAAAPAAAABERyYXcAAAAFAAAAAAAAAKUAAAABAAAAEQAAAAEAAAAHAAAADwAAAAhkcmF3bl9hdAAAAAUAAAAAasI19AAAAA8AAAAMZHJhd25fbGVkZ2VyAAAAAwBMkN0AAAAPAAAACXJhZmZsZV9pZAAAAAAAAAUAAAAAAAAApQAAAA8AAAAKcmFuZG9tbmVzcwAAAAAADQAAACBFaeYnNiOEMM0na5LNNOh3VDDzv5V7xuujU5aqi/nBDwAAAA8AAAAFcm91bmQAAAAAAAAFAAAAAAH0BusAAAAPAAAACXNpZ25hdHVyZQAAAAAAAA0AAAAwpXgADKQv+zZ6If9E/d5eIysWOv4GQBMkLaIjgRDlUPu5DLWOt0fQ2wCiv+oycvIcAAAADwAAAAd3aW5uZXJzAAAAABAAAAABAAAAAQAAAAMAAAAE",
};
const XDR_FALSO = {
  instancia:
    "AAAABgAAAAAAAAAB0BCN0YC4oerqOQ9KpiyIb6TSrd2Cabyxd7ejeCEaWMQAAAAUAAAAAQAAABMAAAAAdmh3qJa1GOqBAS5pPZOKLzMdUsLSNsBLy6w4ELBzXtAAAAABAAAAAQAAABAAAAABAAAAAQAAAA8AAAAFQWRtaW4AAAAAAAASAAAAAAAAAAArat9axYYvuLse3GNpqoX8GW8sVMW8VYBEopwqtExIyg==",
  sello:
    "AAAABgAAAAAAAAAB0BCN0YC4oerqOQ9KpiyIb6TSrd2Cabyxd7ejeCEaWMQAAAAQAAAAAQAAAAIAAAAPAAAABlJhZmZsZQAAAAAABQAAAAAAAAEWAAAAAQAAABEAAAABAAAACgAAAA8AAAAFY291bnQAAAAAAAADAAAADAAAAA8AAAACaWQAAAAAAAUAAAAAAAABFgAAAA8AAAAJbGlzdF9oYXNoAAAAAAAADQAAACDjAqjdAJuH3vf2UwAApB3fCWwxZEVq+2ARkMseZGaj8gAAAA8AAAAEbWV0YQAAAA4AAAAMVW4gYXV0byAwIGttAAAADwAAAAtudW1fd2lubmVycwAAAAADAAAAAQAAAA8AAAAJb3JnYW5pemVyAAAAAAAAEgAAAAAAAAAAK2rfWsWGL7i7HtxjaaqF/BlvLFTFvFWARKKcKrRMSMoAAAAPAAAABXJvdW5kAAAAAAAABQAAAAAB7CwBAAAADwAAAAlzZWFsZWRfYXQAAAAAAAAFAAAAAGqqpPoAAAAPAAAADXNlYWxlZF9sZWRnZXIAAAAAAAADAAAAAQAAAA8AAAAGc3RhdHVzAAAAAAAQAAAAAQAAAAEAAAAPAAAABURyYXduAAAA",
  resultado:
    "AAAABgAAAAAAAAAB0BCN0YC4oerqOQ9KpiyIb6TSrd2Cabyxd7ejeCEaWMQAAAAQAAAAAQAAAAIAAAAPAAAABERyYXcAAAAFAAAAAAAAARYAAAABAAAAEQAAAAEAAAAHAAAADwAAAAhkcmF3bl9hdAAAAAUAAAAAaqqlLAAAAA8AAAAMZHJhd25fbGVkZ2VyAAAAAwAAAAIAAAAPAAAACXJhZmZsZV9pZAAAAAAAAAUAAAAAAAABFgAAAA8AAAAKcmFuZG9tbmVzcwAAAAAADQAAACBuBJmR1+I73FZtOt//CM2BeYxkS8VN1dqhjrCok4soKQAAAA8AAAAFcm91bmQAAAAAAAAFAAAAAAHsLAEAAAAPAAAACXNpZ25hdHVyZQAAAAAAAA0AAAAwp3ponarmh8exbm+TiNTru3s2jQnXpsM60d/XXTLkEUz73PPizFT0/uZZq/KsfvmsAAAADwAAAAd3aW5uZXJzAAAAABAAAAABAAAAAQAAAAMAAAAC",
};

// El #165 lo selló el contrato anterior (su ultimoId es 936): los fixtures son de esa dirección.
const TESTNET = contratoOficial("testnet", "CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH") as ContratoOficial;

type Parte = "instancia" | "sello" | "resultado";

/** La clave de ledger de una entrada, sacada de la entrada misma. */
function claveDe(entradaXdr: string): string {
  const d = xdr.LedgerEntryData.fromXdr(entradaXdr, "base64");
  if (d.type !== "contractData") throw new Error("no es contractData");
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({ contract: d.contractData.contract, key: d.contractData.key, durability: d.contractData.durability }),
  ).toXdr("base64");
}

/**
 * Un RPC de mentira que contesta como uno honesto: a cada clave que le piden,
 * con la entrada grabada que tiene esa clave, si la tiene. `faltan` son las
 * partes que contesta como si no existieran.
 */
function rpc(xdrs: Partial<Record<Parte, string>>, faltan: Parte[] = []): typeof fetch {
  const porClave = new Map<string, string>();
  for (const [parte, x] of Object.entries(xdrs) as [Parte, string][]) if (!faltan.includes(parte)) porClave.set(claveDe(x), x);
  return mentiroso((key) => porClave.get(key));
}

/** Un RPC que contesta a cada clave lo que diga `que` (y si no dice nada, como si no existiera). */
function mentiroso(que: (key: string) => string | undefined): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const { params } = JSON.parse(String(init?.body)) as { params: { keys: string[] } };
    const entries = params.keys
      .map((key) => ({ key, xdr: que(key) }))
      .filter((e): e is { key: string; xdr: string } => typeof e.xdr === "string")
      .map(({ key, xdr: x }) => ({ key, xdr: x, lastModifiedLedgerSeq: 1, liveUntilLedgerSeq: 2 }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries, latestLedger: 5_331_113 } }));
  }) as typeof fetch;
}

/** La instancia de un contrato en `direccion` que corre el .wasm `wasm`: lo que contestaría la red si existiera. */
function instanciaCon(direccion: string, wasm: string): string {
  const val = xdr.ScVal.scvContractInstance(
    new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasm, "hex")), storage: null }),
  );
  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: xdr.ExtensionPoint.v0(),
      contract: new Address(direccion).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val,
    }),
  ).toXdr("base64");
}

const WASM_AJENO = "766877a896b518ea81012e693d938a2f331d52c2d236c04bcbac3810b0735ed0";

const EJEMPLO = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];
const COMPROBANTE_165: Proof = {
  v: PROOF_VERSION,
  names: EJEMPLO,
  round: 32_769_771,
  sealedAt: 1_791_112_632,
  prize: "Sorteo de demostración, con la lista de ejemplo",
  signature: "a578000ca42ffb367a21ff44fdde5e232b163afe064013242da2238110e550fbb90cb58eb747d0db00a2bfea3272f21c",
  net: "testnet",
  contract: TESTNET.contractId,
  id: "165",
};

const sinFaro = async (): Promise<string> => {
  throw new Error("no hace falta");
};

describe("el registro, leído de la cadena", () => {
  it("lee el #165 tal como lo guardó el contrato", async () => {
    const r = await leerRegistro(TESTNET, "165", rpc(XDR_165));
    expect(r.wasm).toBe(TESTNET.wasmSha256);
    expect(r.siguiente).toBe(818);
    expect(r.sello).toMatchObject({
      id: "165",
      organizer: "GA3TE4A6H6DO56YG2NSTR3PCS7EOFVXSMRANPEWOS5J3PNAU7JFA4CIM",
      listHash: "32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef",
      count: 18,
      numWinners: 1,
      round: 32_769_771,
      sealedAt: 1_791_112_637,
      // El ledger del sello: con él se cruza el estado con el historial de la transacción.
      sealedLedger: 5_017_810,
      meta: "Sorteo de demostración, con la lista de ejemplo",
      drawn: true,
    });
    expect(r.resultado).toMatchObject({
      raffleId: "165",
      round: 32_769_771,
      signature: COMPROBANTE_165.signature,
      randomness: "4569e62736238430cd276b92cd34e8775430f3bf957bc6eba35396aa8bf9c10f",
      winners: [4],
    });
  });

  it("con eso, el comprobante de verdad da verde", async () => {
    const r = await revisarComprobante(COMPROBANTE_165, {
      verificarFirma: async (round, s) => verifyRound(round, s),
      traerFirma: sinFaro,
      leerRegistro: (c, id) => leerRegistro(c, id, rpc(XDR_165)),
    });
    expect(r.veredicto).toBe("verde");
    expect(r.nombres[r.ganadores[0] as number]).toBe("Ana Vargas");
  });

  it("si la dirección oficial corriera otro código, no se lee nada de lo que guarda", async () => {
    const ajena = rpc({ ...XDR_165, instancia: instanciaCon(TESTNET.contractId, WASM_AJENO) });
    const r = await leerRegistro(TESTNET, "165", ajena);
    expect(r.wasm).toBe(WASM_AJENO);
    expect(r.sello).toBeNull();
    expect(r.resultado).toBeNull();
    const rev = await revisarComprobante(COMPROBANTE_165, {
      verificarFirma: async (round, s) => verifyRound(round, s),
      traerFirma: sinFaro,
      leerRegistro: (c, id) => leerRegistro(c, id, ajena),
    });
    expect(rev.veredicto).toBe("mal");
    expect(rev.motivos[0]).toBe("codigo-ajeno");
  });

  it("un RPC que contesta con la entrada de otro contrato bajo nuestra clave no pasa", async () => {
    // Lo del contrato ajeno, servido bajo las claves del oficial: la entrada dice de qué contrato es.
    const cruzado = mentiroso((key) => (key.length ? XDR_FALSO.instancia : undefined));
    await expect(leerRegistro(TESTNET, "278", cruzado, 0)).rejects.toThrow(RegistroDeforme);
    const rev = await revisarComprobante(
      { ...COMPROBANTE_165, id: "278" },
      { verificarFirma: async (round, s) => verifyRound(round, s), traerFirma: sinFaro, leerRegistro: (c, id) => leerRegistro(c, id, cruzado, 0) },
    );
    expect(rev.veredicto).toBe("sin-red");
  });

  it("lo que guarda el contrato ajeno tiene la forma de un sorteo: por eso no alcanza con leerlo", async () => {
    // Leído como si fuera de Tinkazo (un contrato "oficial" que dijera correr su .wasm), pasa el parser.
    const comoSiFuera: ContratoOficial = { ...TESTNET, contractId: "CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3", wasmSha256: WASM_AJENO };
    const r = await leerRegistro(comoSiFuera, "278", rpc(XDR_FALSO));
    expect(r.sello?.meta).toBe("Un auto 0 km");
    expect(r.resultado?.winners).toEqual([2]);
  });

  it("un sorteo que no está vuelve sin sello, y sin instancia no hay código", async () => {
    const sinSorteo = await leerRegistro(TESTNET, "165", rpc(XDR_165, ["sello", "resultado"]));
    expect(sinSorteo.wasm).toBe(TESTNET.wasmSha256);
    expect(sinSorteo.sello).toBeNull();
    const sinNada = await leerRegistro(TESTNET, "165", rpc(XDR_165, ["instancia", "sello", "resultado"]));
    expect(sinNada.wasm).toBeNull();
    expect(sinNada.sello).toBeNull();
  });

  it("varios sorteos del mismo contrato van en una sola consulta", async () => {
    let consultas = 0;
    const contar: typeof fetch = async (u, i) => {
      consultas++;
      return rpc(XDR_165)(u, i);
    };
    const m = await leerRegistros(TESTNET, ["165", "166", "165"], contar);
    expect(consultas).toBe(1);
    expect([...m.keys()]).toEqual(["165", "166"]);
  });

  it("una respuesta del RPC sin ledger, con error o caída no se toma como 'no hay nada'", async () => {
    const sinLedger: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries: [] } }));
    await expect(leerRegistro(TESTNET, "165", sinLedger, 0)).rejects.toThrow();
    const conError: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "boom" } }));
    await expect(leerRegistro(TESTNET, "165", conError, 0)).rejects.toThrow();
    const caido: typeof fetch = async () => new Response("", { status: 503 });
    await expect(leerRegistro(TESTNET, "165", caido, 0)).rejects.toThrow();
  });

  it("si el RPC corta una vez, se vuelve a preguntar antes de decir que no se pudo leer", async () => {
    let veces = 0;
    const unaFalla: typeof fetch = async (u, i) => {
      veces++;
      if (veces === 1) return new Response("", { status: 429 });
      return rpc(XDR_165)(u, i);
    };
    const r = await leerRegistro(TESTNET, "165", unaFalla, 0);
    expect(veces).toBe(2);
    expect(r.sello?.id).toBe("165");
  });

  it("los parsers rechazan lo que no tiene la forma del contrato", () => {
    const sello = {
      id: 165n, organizer: "G…", list_hash: new Uint8Array(32), count: 18, num_winners: 1,
      round: 32_769_771n, sealed_at: 1_791_112_637n, sealed_ledger: 1, meta: "x", status: ["Drawn"],
    };
    expect(selloDe(sello).drawn).toBe(true);
    expect(selloDe(sello).sealedLedger).toBe(1);
    // Un contrato que no guardara el ledger sigue leyéndose: ese dato solo sirve para el cruce con el historial.
    const { sealed_ledger: _l, ...sinLedger } = sello;
    expect("sealedLedger" in selloDe(sinLedger)).toBe(false);
    for (const roto of [
      { ...sello, sealed_ledger: -1 },
      { ...sello, sealed_ledger: "5" },
      { ...sello, list_hash: new Uint8Array(31) },
      { ...sello, status: ["Otro"] },
      { ...sello, count: -1 },
      { ...sello, round: 2n ** 60n },
      { ...sello, organizer: 5 },
      null,
    ]) {
      expect(() => selloDe(roto)).toThrow(RegistroDeforme);
    }
    const resultado = {
      raffle_id: 165n, round: 32_769_771n, signature: new Uint8Array(48), randomness: new Uint8Array(32),
      winners: [4], drawn_at: 1n, drawn_ledger: 1,
    };
    expect(resultadoDe(resultado).winners).toEqual([4]);
    for (const roto of [{ ...resultado, signature: new Uint8Array(96) }, { ...resultado, winners: [1.5] }, { ...resultado, winners: "4" }]) {
      expect(() => resultadoDe(roto)).toThrow(RegistroDeforme);
    }
  });
});
