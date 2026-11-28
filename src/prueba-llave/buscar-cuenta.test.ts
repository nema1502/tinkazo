import { sha256 } from "@noble/hashes/sha2.js";
import { Address, StrKey, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
  bytesDeLaCredencial,
  buscarNacimiento,
  buscarPorDireccion,
  creacionesDe,
  direccionDeContrato,
  direccionDeLaLlave,
  salDeLaLlave,
  type ServidorDeBusqueda,
} from "./buscar-cuenta";
import { CREACION_REAL } from "./datos-reales";
import { RED_DE_PRUEBA } from "./red";

const aBase64Url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** La misma dirección, armada con las clases del SDK del sitio: es como la arma la red. */
function direccionConClases(desplegador: string, sal: Uint8Array): string {
  const preimagen = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: sha256(new TextEncoder().encode(RED_DE_PRUEBA.passphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: Address.fromString(desplegador).toScAddress(), salt: sal })),
    }),
  );
  return StrKey.encodeContract(sha256(preimagen.toXdr()));
}

describe("la dirección de la cuenta", () => {
  it("armada a mano da la misma que armada con las clases del SDK, para varias llaves", () => {
    for (let i = 1; i <= 6; i++) {
      const credencial = new Uint8Array(16 + i * 8).fill(i * 31);
      const id = aBase64Url(credencial);
      expect(bytesDeLaCredencial(id)).toEqual(credencial);
      expect(direccionDeLaLlave(id)).toBe(direccionConClases(RED_DE_PRUEBA.desplegador, sha256(credencial)));
    }
  });

  it("la sal es el SHA-256 de los bytes de la credencial", () => {
    const credencial = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(salDeLaLlave(aBase64Url(credencial))).toEqual(sha256(credencial));
  });

  it("una sal de otro largo no se acepta", () => {
    expect(() => direccionDeContrato(RED_DE_PRUEBA.desplegador, new Uint8Array(31))).toThrow();
  });

  it("con una creación real de la red de prueba, la dirección calculada es la que la red dio", () => {
    const codigos = creacionesDe(CREACION_REAL.envelopeXdr, CREACION_REAL.contractId);
    expect(codigos).toEqual([RED_DE_PRUEBA.codigoCuenta]);
  });

  it("la creación real no cuenta para otra dirección, y un sobre ilegible se dice ilegible", () => {
    expect(creacionesDe(CREACION_REAL.envelopeXdr, direccionDeLaLlave("AAAAAAAAAAAAAAAAAAAAAA"))).toEqual([]);
    expect(creacionesDe("no es un sobre", CREACION_REAL.contractId)).toBe("ilegible");
  });
});

/* ------------------------------------------------------------------ la búsqueda con una red de mentira */

interface Mundo {
  oldest?: number;
  latest?: number;
  /** Lo que contesta getContractData: la entrada, o un error para lanzar. */
  instancia?: Array<{ lastModifiedLedgerSeq?: number; liveUntilLedgerSeq?: number } | { lanzar: unknown }>;
  /** Las páginas de Horizon, o un número de HTTP. */
  historial?: Array<unknown[] | number>;
  /** Las páginas del RPC. */
  rpc?: Array<{ transactions: unknown[]; cursor?: string } | { error: { code: number } }>;
  saludFalla?: boolean;
}

const registro = (hash: string, ledger = CREACION_REAL.ledger, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  hash,
  ledger,
  successful: true,
  envelope_xdr: CREACION_REAL.envelopeXdr,
  ...extra,
});

function montar(m: Mundo = {}): { servidor: ServidorDeBusqueda; fetchFn: typeof fetch; pedidos: Array<{ url: string; cuerpo?: Record<string, unknown> }>; esperas: number[]; dormir: (ms: number) => Promise<void> } {
  const pedidos: Array<{ url: string; cuerpo?: Record<string, unknown> }> = [];
  const esperas: number[] = [];
  let lecturas = 0;
  let paginasH = 0;
  let paginasR = 0;
  const servidor: ServidorDeBusqueda = {
    getHealth: async () => {
      if (m.saludFalla) throw new Error("caído");
      return { oldestLedger: m.oldest ?? CREACION_REAL.ledger - 1000, latestLedger: m.latest ?? CREACION_REAL.ledger + 500 };
    },
    getContractData: async () => {
      const r = (m.instancia ?? [{ lastModifiedLedgerSeq: CREACION_REAL.ledger, liveUntilLedgerSeq: CREACION_REAL.ledger + 100_000 }])[lecturas++] ?? { lanzar: { code: 404, message: "no está" } };
      if ("lanzar" in r) throw r.lanzar;
      return r;
    },
  };
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith(RED_DE_PRUEBA.horizon)) {
      pedidos.push({ url: u });
      const pagina = (m.historial ?? [[]])[paginasH++] ?? [];
      if (typeof pagina === "number") return new Response("{}", { status: pagina });
      return new Response(JSON.stringify({ _links: { next: { href: `${RED_DE_PRUEBA.horizon}/ledgers/${CREACION_REAL.ledger}/transactions?cursor=${paginasH}` } }, _embedded: { records: pagina } }), { status: 200 });
    }
    const cuerpo = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
    pedidos.push({ url: u, cuerpo: { metodo: cuerpo.method, ...cuerpo.params } });
    const pagina = (m.rpc ?? [{ transactions: [] }])[paginasR++] ?? { transactions: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, ...("error" in pagina ? pagina : { result: pagina }) }), { status: 200 });
  }) as typeof fetch;
  return { servidor, fetchFn, pedidos, esperas, dormir: async (ms) => void esperas.push(ms) };
}

const buscar = (m: Mundo, fuente?: "historial" | "rpc") => {
  const mundo = montar(m);
  return buscarPorDireccion(CREACION_REAL.contractId, { servidor: mundo.servidor, fetchFn: mundo.fetchFn, dormir: mundo.dormir, ...(fuente ? { fuente } : {}) }).then((r) => ({ r, mundo }));
};

describe("buscar el nacimiento de una cuenta", () => {
  it("con el historial da el hash en minúscula, el ledger y el código, y no toca el RPC", async () => {
    const otras = [registro("aa".repeat(32), CREACION_REAL.ledger, { envelope_xdr: "AAAA" }), registro(CREACION_REAL.hash.toUpperCase())];
    const { r, mundo } = await buscar({ historial: [otras, []] });
    expect(r).toEqual({
      ok: true,
      pista: { contractId: CREACION_REAL.contractId, creationTransactionHash: CREACION_REAL.hash, creationLedger: CREACION_REAL.ledger, birthWasmHash: RED_DE_PRUEBA.codigoCuenta, fuente: "historial" },
    });
    expect(mundo.pedidos.every((p) => p.url.startsWith(RED_DE_PRUEBA.horizon))).toBe(true);
    expect(mundo.pedidos[0]?.url).toBe(`${RED_DE_PRUEBA.horizon}/ledgers/${CREACION_REAL.ledger}/transactions?limit=200`);
  });

  it("sigue las páginas del historial hasta que una viene vacía", async () => {
    const { r, mundo } = await buscar({ historial: [[registro("aa".repeat(32), CREACION_REAL.ledger, { envelope_xdr: "AAAA" })], [registro(CREACION_REAL.hash)], []] });
    expect(r.ok).toBe(true);
    expect(mundo.pedidos).toHaveLength(3);
  });

  it("si el historial todavía no tiene el ledger (404), pasa al RPC con 20 por página y corta en el primer ledger mayor", async () => {
    const envelope = CREACION_REAL.envelopeXdr;
    const { r, mundo } = await buscar({
      historial: [404],
      rpc: [
        { transactions: [{ status: "SUCCESS", ledger: CREACION_REAL.ledger, txHash: CREACION_REAL.hash, envelopeXdr: envelope }], cursor: "c1" },
        { transactions: [{ status: "SUCCESS", ledger: CREACION_REAL.ledger + 1, txHash: "bb".repeat(32), envelopeXdr: envelope }], cursor: "c2" },
        { transactions: [{ status: "SUCCESS", ledger: CREACION_REAL.ledger + 1, txHash: "cc".repeat(32), envelopeXdr: envelope }] },
      ],
    });
    expect(r).toMatchObject({ ok: true, pista: { fuente: "rpc", creationTransactionHash: CREACION_REAL.hash } });
    const delRpc = mundo.pedidos.filter((p) => p.cuerpo);
    expect(delRpc).toHaveLength(2);
    expect(delRpc[0]?.cuerpo).toMatchObject({ metodo: "getTransactions", startLedger: CREACION_REAL.ledger, pagination: { limit: 20 } });
    expect(delRpc[1]?.cuerpo).toMatchObject({ pagination: { cursor: "c1", limit: 20 } });
  });

  it("pidiendo una sola fuente, la otra no se mira", async () => {
    const solo = await buscar({ historial: [[registro(CREACION_REAL.hash)]] }, "historial");
    expect(solo.r).toMatchObject({ ok: true, pista: { fuente: "historial" } });
    const caido = await buscar({ historial: [503] }, "historial");
    expect(caido.r).toMatchObject({ ok: false, motivo: "red" });
    expect(caido.mundo.pedidos.every((p) => !p.cuerpo)).toBe(true);
    const rpc = await buscar({ rpc: [{ transactions: [{ status: "SUCCESS", ledger: CREACION_REAL.ledger, txHash: CREACION_REAL.hash, envelopeXdr: CREACION_REAL.envelopeXdr }] }] }, "rpc");
    expect(rpc.r).toMatchObject({ ok: true, pista: { fuente: "rpc" } });
    expect(rpc.mundo.pedidos.every((p) => !p.url.startsWith(RED_DE_PRUEBA.horizon))).toBe(true);
  });

  it("con el ledger más viejo que el RPC y el historial sin él, es un problema de red y no se pide al RPC", async () => {
    const { r, mundo } = await buscar({ historial: [404], oldest: CREACION_REAL.ledger + 10 });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
    expect(mundo.pedidos.some((p) => p.cuerpo)).toBe(false);
  });

  it("un error -32600 del RPC es de red", async () => {
    const { r } = await buscar({ historial: [404], rpc: [{ error: { code: -32600 } }] });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
  });

  it("una transacción que falló con la misma creación se ignora", async () => {
    const { r } = await buscar({ historial: [[registro(CREACION_REAL.hash, CREACION_REAL.ledger, { successful: false })], []] });
    expect(r).toMatchObject({ ok: false, motivo: "sin-nacimiento" });
  });

  it("dos creaciones de la misma dirección dan ambigua", async () => {
    const { r } = await buscar({ historial: [[registro(CREACION_REAL.hash), registro("dd".repeat(32))], []] });
    expect(r).toMatchObject({ ok: false, motivo: "ambigua" });
  });

  it("si leyó el ledger entero y ninguna creación es de la cuenta, da sin-nacimiento", async () => {
    const { r } = await buscar({ historial: [[registro("aa".repeat(32), CREACION_REAL.ledger, { envelope_xdr: "AAAA" })], []] });
    expect(r).toMatchObject({ ok: false, motivo: "sin-nacimiento" });
  });

  it("una página del historial que manda a otro anfitrión no se sigue", async () => {
    const mundo = montar({ historial: [[registro("aa".repeat(32), CREACION_REAL.ledger, { envelope_xdr: "AAAA" })]] });
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await mundo.fetchFn(url, init);
      if (!String(url).startsWith(RED_DE_PRUEBA.horizon)) return res;
      const cuerpo = (await res.json()) as { _links: { next: { href: string } } };
      cuerpo._links.next.href = "https://otro.example.org/ledgers";
      return new Response(JSON.stringify(cuerpo), { status: 200 });
    }) as typeof fetch;
    const r = await buscarPorDireccion(CREACION_REAL.contractId, { servidor: mundo.servidor, fetchFn, dormir: mundo.dormir });
    expect(r).toMatchObject({ ok: false, motivo: "sin-nacimiento" });
    expect(mundo.pedidos).toHaveLength(1);
  });
});

describe("las tres clases de falla al mirar la instancia", () => {
  it("con 404 las dos veces es sin-cuenta, y entre las dos espera 2 s", async () => {
    const { r, mundo } = await buscar({ instancia: [{ lanzar: { code: 404 } }, { lanzar: { code: 404 } }] });
    expect(r).toMatchObject({ ok: false, motivo: "sin-cuenta" });
    expect(mundo.esperas).toEqual([2_000]);
  });

  it("con 404 y después la entrada, sigue", async () => {
    const { r } = await buscar({ instancia: [{ lanzar: { code: 404 } }, { lastModifiedLedgerSeq: CREACION_REAL.ledger, liveUntilLedgerSeq: CREACION_REAL.ledger + 5_000 }], historial: [[registro(CREACION_REAL.hash)], []] });
    expect(r.ok).toBe(true);
  });

  it("con otro error es de red", async () => {
    const { r } = await buscar({ instancia: [{ lanzar: new Error("se cortó") }] });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
  });

  it("con la vida de la entrada menor que el ledger de ahora, está vencida", async () => {
    const { r } = await buscar({ latest: 6_000_000, instancia: [{ lastModifiedLedgerSeq: CREACION_REAL.ledger, liveUntilLedgerSeq: 5_999_999 }] });
    expect(r).toMatchObject({ ok: false, motivo: "vencida" });
  });

  it("si la salud de la red no contesta, es de red", async () => {
    const { r } = await buscar({ saludFalla: true });
    expect(r).toMatchObject({ ok: false, motivo: "red" });
  });

  it("una credencial que no se puede leer no tiene cuenta", async () => {
    const r = await buscarNacimiento("***");
    expect(r).toMatchObject({ ok: false, motivo: "sin-cuenta" });
  });
});
