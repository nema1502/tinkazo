import { readFileSync } from "node:fs";
import { Keypair, Networks } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { QUICKNET, roundTime } from "../../../src/protocol/quicknet";
import { armar } from "./armar";
import { diagnosticoDeError, resultado, selloQueEntro } from "./cadena-prueba";
import { CODIGO_RONDA_MUY_CERCA, GENESIS_QUICKNET_S, MARGEN_DEL_CONTRATO_S, PERIODO_QUICKNET_S, horaDeLaRonda, selloQueEntroTarde } from "./sello-tarde";

const CONTRATO = deployments.testnet.contractId;
const O = { passphrase: Networks.TESTNET, contractId: CONTRATO };
const RONDA = 33_939_006;

function sello(ronda = RONDA, v: Partial<Parameters<typeof armar>[0]> = {}) {
  return armar({ contrato: CONTRATO, firmante: Keypair.random(), ronda: BigInt(ronda), ...v });
}

describe("los números son los del contrato y los de drand", () => {
  it("el génesis y el período de quicknet son los del sitio", () => {
    expect(GENESIS_QUICKNET_S).toBe(QUICKNET.genesisTime);
    expect(PERIODO_QUICKNET_S).toBe(QUICKNET.period);
    for (const r of [1, 2, 1_000_000, RONDA]) expect(horaDeLaRonda(r)).toBe(roundTime(r));
  });

  it("los 30 s y el error 5 son los del contrato", () => {
    const lib = readFileSync(new URL("../../../contracts/raffle/src/lib.rs", import.meta.url), "utf8");
    expect(lib).toContain(`pub const MIN_LEAD_SECS: u64 = ${MARGEN_DEL_CONTRATO_S};`);
    expect(lib).toContain(`RoundTooSoon = ${CODIGO_RONDA_MUY_CERCA},`);
  });
});

describe("un sello que entró tarde y el contrato rechazó", () => {
  it("la noche del 13 de noviembre: entró con 25 s por delante y se comprueba con lo que guardó la red", () => {
    const t = sello();
    const r = selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25 }), O);
    expect(r).toEqual({ ok: true, ronda: RONDA, cierreS: horaDeLaRonda(RONDA) - 25, faltaban: 25 });
  });

  it("con 29 s todavía es tarde; con 30 el contrato lo aceptaba, así que la falla fue otra", () => {
    const t = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 29 }), O)).toMatchObject({ ok: true, faltaban: 29 });
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 30 }), O)).toEqual({ ok: false, motivo: "a-tiempo" });
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 60 }), O)).toEqual({ ok: false, motivo: "a-tiempo" });
  });

  it("una ronda que ya había nacido al entrar también es tarde", () => {
    const t = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: -12 }), O)).toMatchObject({ ok: true, faltaban: -12 });
  });

  it("vale también sin fee-bump (la transacción sola, como la manda quien paga su comisión)", () => {
    const t = sello();
    const c = { status: "FAILED" as const, cierreS: horaDeLaRonda(RONDA) - 20, sobre: t.xdr, resultado: resultado("atrapada", { feeBump: false }) };
    expect(selloQueEntroTarde(t.hash, c, O)).toMatchObject({ ok: true, faltaban: 20 });
  });

  it("con eventos de diagnóstico que nombran el error 5, sigue siendo tarde", () => {
    const t = sello();
    const c = selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25, diagnosticos: [diagnosticoDeError(CODIGO_RONDA_MUY_CERCA)] });
    expect(selloQueEntroTarde(t.hash, c, O)).toMatchObject({ ok: true });
  });
});

describe("lo que no se puede comprobar no se devuelve", () => {
  it("un sello que salió bien, o que no se encontró", () => {
    const t = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25, desenlace: "bien" }), O)).toEqual({ ok: false, motivo: "no-fallo" });
    expect(selloQueEntroTarde(t.hash, { status: "NOT_FOUND" }, O)).toEqual({ ok: false, motivo: "no-fallo" });
  });

  it("sin la hora del ledger, sin el sobre o sin el resultado (un RPC que no los manda)", () => {
    const t = sello();
    const c = selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25 });
    expect(selloQueEntroTarde(t.hash, { status: "FAILED", feeCharged: 5_000 }, O)).toEqual({ ok: false, motivo: "sin-datos" });
    const { cierreS: _c, ...sinCierre } = c;
    const { sobre: _s, ...sinSobre } = c;
    const { resultado: _r, ...sinResultado } = c;
    for (const x of [sinCierre, sinSobre, sinResultado, { ...c, cierreS: 0 }, { ...c, cierreS: Number.NaN }]) expect(selloQueEntroTarde(t.hash, x, O)).toEqual({ ok: false, motivo: "sin-datos" });
  });

  it("un sobre o un resultado que no se entienden", () => {
    const t = sello();
    const c = selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25 });
    expect(selloQueEntroTarde(t.hash, { ...c, sobre: "no-es-xdr" }, O)).toEqual({ ok: false, motivo: "sin-datos" });
    expect(selloQueEntroTarde(t.hash, { ...c, resultado: "AAAA" }, O)).toEqual({ ok: false, motivo: "sin-datos" });
  });

  it("el sobre de otra transacción: la consulta no es de este hash", () => {
    const t = sello();
    const otra = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: otra.xdr, ronda: RONDA, faltaban: 25 }), O)).toEqual({ ok: false, motivo: "otro-sobre" });
  });

  it("un sorteo, otro método, otro contrato o una red con otra frase", () => {
    const k = Keypair.random();
    const sorteo = armar({ contrato: CONTRATO, firmante: k, metodo: "draw" });
    expect(selloQueEntroTarde(sorteo.hash, selloQueEntro({ xdr: sorteo.xdr, ronda: RONDA, faltaban: 25 }), O)).toEqual({ ok: false, motivo: "no-es-sello" });
    const otroContrato = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    const ajeno = armar({ contrato: otroContrato, firmante: k, ronda: BigInt(RONDA) });
    expect(selloQueEntroTarde(ajeno.hash, selloQueEntro({ xdr: ajeno.xdr, ronda: RONDA, faltaban: 25 }), O)).toEqual({ ok: false, motivo: "no-es-sello" });
    // Con la frase de otra red el hash no coincide: no es el sobre de esta transacción.
    const t = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25 }), { ...O, passphrase: Networks.PUBLIC })).toMatchObject({ ok: false });
  });

  it("una falla que no es del contrato: sin recursos, o la red la rechazó por la secuencia", () => {
    const t = sello();
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25, desenlace: "sin-recursos" }), O)).toEqual({ ok: false, motivo: "otra-falla" });
    expect(selloQueEntroTarde(t.hash, selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25, desenlace: "secuencia" }), O)).toEqual({ ok: false, motivo: "otra-falla" });
  });

  it("un evento de diagnóstico con otro error del contrato manda sobre la hora", () => {
    const t = sello();
    const c = selloQueEntro({ xdr: t.xdr, ronda: RONDA, faltaban: 25, diagnosticos: [diagnosticoDeError(3)] });
    expect(selloQueEntroTarde(t.hash, c, O)).toEqual({ ok: false, motivo: "otro-error" });
    // Un evento que no se entiende no cambia nada.
    expect(selloQueEntroTarde(t.hash, { ...c, diagnosticos: ["basura"] }, O)).toMatchObject({ ok: true });
  });
});
