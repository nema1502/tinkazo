import type { xdr as XdrNs } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { contratosOficiales, type ContratoDePremios } from "./oficiales";
import { aceptarSelloDePremios, leerPromocion, sobreDeLosArgumentos, type LecturaDeLaPromocion, type SobreDelSelloDePremios } from "./premios";
import horizonCC from "./fixtures/horizon-sello-de-premios-3f1055d5.json";
import horizonCD3 from "./fixtures/horizon-sello-de-premios-d2dd1bc5.json";
import horizonCD5 from "./fixtures/horizon-sello-de-premios-d18bcea4.json";
import rpcCC from "./fixtures/rpc-getLedgerEntries-premios-CCJGBEFC-promo8.json";
import rpcCD3 from "./fixtures/rpc-getLedgerEntries-premios-CD3FDTS7-promo1.json";
import rpcCD5 from "./fixtures/rpc-getLedgerEntries-premios-CD5UZXNV-promo1.json";

/**
 * El contrato de premios y el sello de una campaña (`premios.ts`), sin red.
 *
 * Los fixtures son las respuestas de verdad del RPC de testnet del 19 de noviembre de 2026 de tres
 * contratos de premios que sellaron en el sorteo oficial (CDNWNY26): una promoción de 100 cuentas y
 * 10 premios (CCJGBEFC), una de 10 cuentas y un premio (CD3FDTS7) y una del contrato anterior
 * (CD5UZXNV, otro `.wasm` y un `Config` sin las listas de activos). Con su transacción de sello, que
 * es la que cita el comprobante. La testnet se borra el 16 de diciembre: las pruebas no le piden nada.
 */

const RAFFLE = "CDNWNY26VWXM7ISXJD2OFWDUAPIOAJTR5TMAXFFHWWUHZWGCEWDKYV3A";
const CC = "CCJGBEFCZZ423RQLFSEAZNQMESBYRJCD2RLHS46RC2ILHRLI3O3ZPBSY";
const CD3 = "CD3FDTS72H5E63UIXSLAFCRBJGFEFS4C7GT6JMMP2ODZJTVO6AS44A7P";
const CD5 = "CD5UZXNVKZILVXEF2AGZSJUUVUN74AACXZPAZFY7HOPKOHFK6F6Y3PPE";
const WASM = "e8e818b2b590b7c7a09ca7e65f389307b742b22ba512f79b6242335326c1e925";
const WASM_VIEJO = "0022f1be533b6d287a786be2e18c37ed22e2c51b80b8dfb97caab37ade367ab0";

/** La tabla, con los tres contratos de verdad: en producción queda vacía hasta la designación (#167). */
const TABLA = {
  testnet: [
    { contractId: CC, wasmSha256: WASM, deployedAt: "2026-11-05" },
    { contractId: CD3, wasmSha256: WASM, deployedAt: "2026-11-05" },
    { contractId: CD5, wasmSha256: WASM_VIEJO, deployedAt: "2026-11-04" },
  ],
};

const deLaTabla = (contractId: string): ContratoDePremios => {
  const c = [CC, CD3, CD5].includes(contractId) ? contractId : "";
  return {
    red: "testnet",
    contractId: c,
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
  };
};

/**
 * Un RPC que solo conoce las entradas de `fixture`: contesta las claves que se le piden y anota los
 * pedidos. Las entradas salen tal como las devolvió el RPC de verdad (XDR incluido).
 */
function rpcFalso(fixture: { result: { latestLedger: number; entries: { key: string }[] } }, falla: "corte" | number | null = null) {
  const pedidos: string[][] = [];
  const fetchFalso = (async (_url: unknown, init?: { body?: unknown }) => {
    if (falla === "corte") throw new TypeError("fetch failed");
    if (typeof falla === "number") return new Response("", { status: falla });
    const cuerpo = JSON.parse(String(init?.body ?? "{}")) as { method?: string; params?: { keys?: string[] } };
    if (cuerpo.method !== "getLedgerEntries") throw new Error(`rpc-falso: método no previsto ${String(cuerpo.method)}`);
    const pedidas = cuerpo.params?.keys ?? [];
    pedidos.push(pedidas);
    const entries = fixture.result.entries.filter((e) => pedidas.includes(e.key));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { latestLedger: fixture.result.latestLedger, entries } }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchFalso, pedidos };
}

/** El sello que viaja en el sobre de una transacción de verdad, ya decodificado (`promocionId`, entradas y ronda). */
async function sobreDe(registro: { envelope_xdr: string }): Promise<SobreDelSelloDePremios> {
  const { TransactionBuilder, scValToNative } = await import("@stellar/stellar-sdk");
  const tx = TransactionBuilder.fromXDR(registro.envelope_xdr, "Test SDF Network ; September 2015");
  const interior = "innerTransaction" in tx ? tx.innerTransaction : tx;
  const op = interior.operations[0] as unknown as { func: { invokeContract: { args: { type: string }[] } } };
  const args = op.func.invokeContract.args as unknown as Parameters<typeof scValToNative>[0][];
  const [promocionId, entradas, round] = args.map((a) => scValToNative(a)) as [bigint, string[], bigint];
  return { promocionId: promocionId.toString(), entradas, round: Number(round) };
}

describe("la promoción, leída de su contrato", () => {
  it("lee la de 100 cuentas y 10 premios: la huella de la lista y la de las bases, el depósito, el sorteo que creó y el estado de cada premio", async () => {
    const rpc = rpcFalso(rpcCC);
    const r = await leerPromocion(deLaTabla(CC), "8", { fetch: rpc.fetch, esperaMs: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // El contrato del sorteo oficial sale de `Config.raffle`, que vive en el almacenamiento de la instancia.
    expect(r.raffle).toBe(RAFFLE);
    expect(r.promocion).toMatchObject({
      id: "8",
      listHash: "91136c024fcaa190b35c2ff626097eb3017d35ce6c62687455a4fa600c8652af",
      rulesHash: "b0a55c1af779ec10c0b37f127a5a63cc139d2de4bd7f0b7d35241c0a757b49af",
      count: 100,
      round: 33_688_503,
      raffleId: "586",
      token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      inKind: false,
      status: "Settled",
      title: "Ensayo tamaño máximo: 100 cuentas, 10 premios de 10 XLM",
      fee: "30000000",
      feePaid: true,
      sponsor: "GATTU5KWCLEWEJZ7QKR2P5Y7OATXYITI4ZCXCRBJSD4KIUNS5JEUKHVZ",
      operator: "GA6HJF3WMGYVJUKRB5ZFDLZMH45IZ75C6PTST3CDXYFSARMHFF72A5Z3",
    });
    // Diez premios de 10 XLM: el depósito es la suma, en unidades mínimas del activo.
    expect(r.promocion.prizes).toEqual(Array.from({ length: 10 }, () => "100000000"));
    expect(r.promocion.deposit).toBe("1000000000");
    // Cada premio dice qué puesto de la lista ganó y a quién se le pagó (los dos pagados, leídos del contrato).
    expect(r.promocion.premios).toHaveLength(10);
    expect(r.promocion.premios[0]).toEqual({
      position: 0,
      index: 57,
      amount: "100000000",
      state: "Paid",
      winner: "GCCIWHCU5XZ4VAK2GAFJBBTJJXIWPWBPK56JOGEPS6N6LP7AYLILD7F3",
    });
    expect(r.promocion.premios.map((p) => p.index)).toEqual([57, 6, 75, 91, 90, 41, 27, 1, 97, 64]);
    expect(r.promocion.premios.every((p) => p.state === "Paid")).toBe(true);
    // Una consulta para la instancia y la promoción, y otra para los premios: las claves son las del contrato.
    expect(rpc.pedidos).toHaveLength(2);
    expect(rpc.pedidos[1]).toHaveLength(10);
  });

  it("lee la de un premio, y la devolución de un premio en especie", async () => {
    const uno = await leerPromocion(deLaTabla(CD3), "1", { fetch: rpcFalso(rpcCD3).fetch, esperaMs: 0 });
    expect(uno.ok && uno.promocion).toMatchObject({ count: 10, round: 33_688_752, raffleId: "587", deposit: "50000000", status: "Settled" });
    expect(uno.ok && uno.promocion.premios).toEqual([
      { position: 0, index: 1, amount: "50000000", state: "Paid", winner: "GA647PFT46KI2BVCRGL3DJBNJXT2KCEEPSNKCTPI4JFIWLLY4BHVIQ7C" },
    ]);
    // Un `Config` anterior, sin `tokens` ni `allow_in_kind`: se lee igual, y el premio devuelto también.
    const devuelto = await leerPromocion(deLaTabla(CD5), "1", { fetch: rpcFalso(rpcCD5).fetch, esperaMs: 0 });
    expect(devuelto.ok && devuelto.raffle).toBe(RAFFLE);
    expect(devuelto.ok && devuelto.promocion.premios).toEqual([
      { position: 0, index: 2, amount: "100000000", state: "Paid", winner: "GCTRI4TQY4OMSA4VVPCTIXWMM5Z3FREZCHUSMABJFMYCCOTRDKZHOE3C" },
    ]);
  });

  it("una promoción que el contrato no tiene no se inventa: es 'sin estado'", async () => {
    const r = await leerPromocion(deLaTabla(CC), "9", { fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    expect(r).toEqual({ ok: false, error: "sin-estado" });
  });

  it("si la instancia no corre el código que declara la tabla, no es ese contrato", async () => {
    const otro: ContratoDePremios = { ...deLaTabla(CC), wasmSha256: "0".repeat(64) };
    const r = await leerPromocion(otro, "8", { fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    expect(r).toEqual({ ok: false, error: "contrato-ajeno" });
    // Sin el campo en la tabla no se comprueba (el código de un contrato no se puede cambiar).
    const sinCodigo: ContratoDePremios = { red: "testnet", contractId: CC, rpcUrl: "https://soroban-testnet.stellar.org", passphrase: "Test SDF Network ; September 2015" };
    expect((await leerPromocion(sinCodigo, "8", { fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 })).ok).toBe(true);
  });

  it("un RPC caído o que contesta basura no dice nada de la promoción, y se reintenta", async () => {
    const corte = rpcFalso(rpcCC, "corte");
    expect(await leerPromocion(deLaTabla(CC), "8", { fetch: corte.fetch, esperaMs: 0, intentos: 2 })).toEqual({ ok: false, error: "red-caida" });
    expect(corte.pedidos).toHaveLength(0);
    for (const estado of [429, 500, 503]) {
      expect(await leerPromocion(deLaTabla(CC), "8", { fetch: rpcFalso(rpcCC, estado).fetch, esperaMs: 0, intentos: 2 })).toEqual({ ok: false, error: "red-caida" });
    }
    // Una respuesta sin `latestLedger` no se toma como "no hay nada".
    const vacia = (async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { entries: [] } }), { status: 200 })) as unknown as typeof fetch;
    expect(await leerPromocion(deLaTabla(CC), "8", { fetch: vacia, esperaMs: 0, intentos: 1 })).toEqual({ ok: false, error: "red-caida" });
    // Una promoción que no tiene la forma del contrato tampoco se lee.
    const rota = { result: { latestLedger: 1, entries: rpcCC.result.entries.map((e, i) => (i === 1 ? { ...e, xdr: "AAAA" } : e)) } };
    expect(await leerPromocion(deLaTabla(CC), "8", { fetch: rpcFalso(rota).fetch, esperaMs: 0 })).toEqual({ ok: false, error: "respuesta-invalida" });
  });
});

describe("el sello de premios: se acepta por lo que dice la promoción", () => {
  const raffles = () => contratosOficiales("testnet");
  const aceptar = (contrato: ContratoDePremios, sobre: SobreDelSelloDePremios, fixture: { result: { latestLedger: number; entries: { key: string }[] } }) =>
    aceptarSelloDePremios({ contrato, sobre, raffles: raffles(), leer: (c, id) => leerPromocion(c, id, { fetch: rpcFalso(fixture).fetch, esperaMs: 0 }) });

  it("acepta el de verdad y devuelve el sorteo oficial: la huella recalculada del sobre, la cantidad, los ganadores, la ronda y el número del sorteo", async () => {
    const sobre = await sobreDe(horizonCC);
    // La lista del sello son las cuentas, tal como las selló el contrato de premios.
    expect(sobre.promocionId).toBe("8");
    expect(sobre.entradas).toHaveLength(100);
    expect(sobre.entradas[0]).toBe("GA3P76SNNF6YWYEKNQ3ZJLHXZB3QK243TZV55QNYTULJNNHCI4MGASA5");
    expect(sobre.round).toBe(33_688_503);
    const r = await aceptar(deLaTabla(CC), sobre, rpcCC);
    expect(r).toEqual({
      ok: true,
      sello: {
        raffle: RAFFLE,
        organizer: CC,
        listHash: "91136c024fcaa190b35c2ff626097eb3017d35ce6c62687455a4fa600c8652af",
        count: 100,
        numWinners: 10,
        round: 33_688_503,
        meta: "Ensayo tamaño máximo: 100 cuentas, 10 premios de 10 XLM",
        premio: {
          contrato: CC,
          promocionId: "8",
          sorteoId: "586",
          deposito: "1000000000",
          token: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
          inKind: false,
          rulesHash: "b0a55c1af779ec10c0b37f127a5a63cc139d2de4bd7f0b7d35241c0a757b49af",
          listHash: "91136c024fcaa190b35c2ff626097eb3017d35ce6c62687455a4fa600c8652af",
          premios: expect.any(Array),
        },
      },
    });
  });

  it("también el de otro contrato de premios, con su propio número de sorteo", async () => {
    const r = await aceptar(deLaTabla(CD3), await sobreDe(horizonCD3), rpcCD3);
    expect(r.ok && r.sello).toMatchObject({ raffle: RAFFLE, organizer: CD3, count: 10, numWinners: 1, round: 33_688_752, premio: { sorteoId: "587" } });
    const viejo = await aceptar(deLaTabla(CD5), await sobreDe(horizonCD5), rpcCD5);
    expect(viejo.ok && viejo.sello).toMatchObject({ raffle: RAFFLE, organizer: CD5, count: 4, numWinners: 1, premio: { sorteoId: "571" } });
  });

  it("un sobre que no coincide con la promoción no es un sello de premios: la lista, la promoción o la ronda cambiadas", async () => {
    const bueno = await sobreDe(horizonCC);
    // La lista, cambiada en una cuenta: la huella recalculada ya no es la de la promoción.
    const conOtraCuenta = { ...bueno, entradas: [...bueno.entradas.slice(0, 99), "GA3P76SNNF6YWYEKNQ3ZJLHXZB3QK243TZV55QNYTULJNNHCI4MGASAA"] };
    expect(await aceptar(deLaTabla(CC), conOtraCuenta, rpcCC)).toEqual({ ok: false, error: "no-es-un-sello" });
    // Otra ronda, otras entradas: tampoco.
    expect(await aceptar(deLaTabla(CC), { ...bueno, round: bueno.round + 1 }, rpcCC)).toEqual({ ok: false, error: "no-es-un-sello" });
    expect(await aceptar(deLaTabla(CC), { ...bueno, entradas: bueno.entradas.slice(0, 99) }, rpcCC)).toEqual({ ok: false, error: "no-es-un-sello" });
    // Todo igual pero citando otra promoción: el contrato no la tiene.
    expect(await aceptar(deLaTabla(CC), { ...bueno, promocionId: "9" }, rpcCC)).toEqual({ ok: false, error: "red-caida" });
  });

  it("una promoción que no selló en el sorteo oficial de esa red no se acepta", async () => {
    const sobre = await sobreDe(horizonCC);
    const real = await leerPromocion(deLaTabla(CC), "8", { fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    if (!real.ok) throw new Error("el fixture tiene que leerse");
    // `Config.raffle` apuntando a un contrato anterior (o a cualquier otro): no es el sorteo oficial vigente.
    const otroRaffle = (raffle: string) => () => Promise.resolve<LecturaDeLaPromocion>({ ok: true, promocion: real.promocion, raffle });
    const anterior = await aceptarSelloDePremios({ contrato: deLaTabla(CC), sobre, raffles: raffles(), leer: otroRaffle("CD2SSHBU37BSPCLNB2XMOGRL3CLUAURIJAJSG2CZVFZRDTURSIDARENH") });
    expect(anterior).toEqual({ ok: false, error: "no-es-un-sello" });
    const ajeno = await aceptarSelloDePremios({ contrato: deLaTabla(CC), sobre, raffles: raffles(), leer: otroRaffle("CDIBBDORQC4KD2XKHEHUVJRMRBX2JUVN3WBGTPFRO632G6BBDJMMJUU3") });
    expect(ajeno).toEqual({ ok: false, error: "no-es-un-sello" });
  });

  it("una promoción sin sorteo, sin premios, cancelada o que no selló, tampoco", async () => {
    const sobre = await sobreDe(horizonCC);
    const real = await leerPromocion(deLaTabla(CC), "8", { fetch: rpcFalso(rpcCC).fetch, esperaMs: 0 });
    if (!real.ok) throw new Error("el fixture tiene que leerse");
    const con = (cambio: Partial<typeof real.promocion>) => () =>
      Promise.resolve<LecturaDeLaPromocion>({ ok: true, promocion: { ...real.promocion, ...cambio }, raffle: RAFFLE });
    for (const cambio of [{ raffleId: "0" }, { status: "Funded" as const }, { prizes: [] }, { listHash: "0".repeat(64) }, { round: 1 }]) {
      expect(await aceptarSelloDePremios({ contrato: deLaTabla(CC), sobre, raffles: raffles(), leer: con(cambio) }), JSON.stringify(cambio)).toEqual({
        ok: false,
        error: "no-es-un-sello",
      });
    }
  });
});

describe("los argumentos de un seal de premios", () => {
  it("son la promoción, las entradas y la ronda; otra forma no es un sello de premios", async () => {
    const { nativeToScVal } = await import("@stellar/stellar-sdk");
    const bien = [nativeToScVal(8, { type: "u64" }), nativeToScVal(["GA3P76SNNF6YWYEKNQ3ZJLHXZB3QK243TZV55QNYTULJNNHCI4MGASA5", "GDZWSRVKR5PHXSMC52J5TAJRFJTUD67XD6B6GRAEUN3A4LGFH5LMROFZ"]), nativeToScVal(33_688_503, { type: "u64" })];
    const { scValToNative } = await import("@stellar/stellar-sdk");
    expect(sobreDeLosArgumentos(bien, scValToNative)).toEqual({
      promocionId: "8",
      entradas: ["GA3P76SNNF6YWYEKNQ3ZJLHXZB3QK243TZV55QNYTULJNNHCI4MGASA5", "GDZWSRVKR5PHXSMC52J5TAJRFJTUD67XD6B6GRAEUN3A4LGFH5LMROFZ"],
      round: 33_688_503,
    });
    // Otra cantidad, otros tipos o una entrada que no es una dirección: no es un sello de premios.
    const [promo, entradas, ronda] = bien as [XdrNs.ScVal, XdrNs.ScVal, XdrNs.ScVal];
    const casos: XdrNs.ScVal[][] = [
      [promo, entradas],
      [promo, entradas, ronda, nativeToScVal(1, { type: "u32" })],
      [nativeToScVal(8, { type: "u32" }), entradas, ronda],
      [promo, nativeToScVal([1, 2]), ronda],
      [promo, nativeToScVal(["no-es-una-direccion"]), ronda],
      [promo, entradas, nativeToScVal(33_688_503, { type: "u32" })],
    ];
    for (const caso of casos) expect(sobreDeLosArgumentos(caso, scValToNative), JSON.stringify(caso.map((x) => x.type))).toBeNull();
  });
});
