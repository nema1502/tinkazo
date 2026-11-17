/**
 * La respuesta real de la red por el sello que entró tarde la noche del 13 de noviembre de 2026 (`sello-tarde-real.json`,
 * leída del RPC de la red principal por el hash interno, sin mandar nada). Las otras pruebas arman el sobre y el
 * resultado con el mismo conocimiento del XDR que el código: esta comprueba que el código entiende lo que de verdad
 * contesta la red, con el contrato y la frase de la red principal.
 *
 * Es la del primer RPC del portero en la red principal (`config.ts`). El segundo de la lista contestó el mismo día lo
 * mismo, campo por campo: la hora como texto, el sobre, el resultado y los eventos de diagnóstico. El RPC guarda unos 7
 * días, así que esta respuesta ya no se puede volver a pedir: por eso se guarda tal cual.
 */
import { Keypair, Networks, TransactionBuilder, type FeeBumpTransaction } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import deployments from "../../../src/stellar/deployments.json";
import { leerConfig } from "./config";
import { escena } from "./devolucion-prueba";
import { RpcRed } from "./red";
import { selloQueEntroTarde } from "./sello-tarde";
import dato from "./sello-tarde-real.json";
import { Portero, firmanteDe } from "./servicio";

const CONTRATO_PRINCIPAL = deployments.mainnet.contractId;
const PRINCIPAL = { passphrase: Networks.PUBLIC, contractId: CONTRATO_PRINCIPAL };

/** El RPC de mentira contesta, byte por byte, lo que contestó el de verdad. */
const pedirLoGuardado = (async () => new Response(JSON.stringify(dato.respuesta), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
const consultaReal = () => new RpcRed(["https://rpc.ejemplo"], pedirLoGuardado).consultar(dato.hashInterno);

describe("la respuesta real de la red por el sello de la noche del 13", () => {
  it("así contesta ese RPC: la hora como texto, el sobre, el resultado y los eventos de diagnóstico como lista de textos", () => {
    const r = dato.respuesta.result;
    expect(r.status).toBe("FAILED");
    expect(typeof r.createdAt).toBe("string");
    expect(typeof r.envelopeXdr).toBe("string");
    expect(typeof r.resultXdr).toBe("string");
    expect(Array.isArray(r.diagnosticEventsXdr)).toBe(true);
    expect(r.feeBump).toBe(true);
  });

  it("RpcRed la entiende: entró y falló, lo que cobró, la hora del ledger, el sobre, el resultado y los eventos", async () => {
    const c = await consultaReal();
    expect(c.status).toBe("FAILED");
    expect(c.feeCharged).toBe(5_478);
    expect(c.cierreS).toBe(1_794_620_357);
    expect(c.sobre).toBe(dato.respuesta.result.envelopeXdr);
    expect(c.resultado).toBe(dato.respuesta.result.resultXdr);
    expect(c.diagnosticos).toHaveLength(dato.respuesta.result.diagnosticEventsXdr.length);
  });

  it("prueba que entró tarde: su ronda, 25 s antes, por el hash interno (el que guarda el portero) y por el del fee-bump", async () => {
    const c = await consultaReal();
    for (const h of [dato.hashInterno, dato.hashFeeBump]) expect(selloQueEntroTarde(h, c, PRINCIPAL), h).toEqual({ ok: true, ronda: 33_939_006, cierreS: 1_794_620_357, faltaban: 25 });
  });

  it("con otro hash, otro contrato u otra red, no", async () => {
    const c = await consultaReal();
    expect(selloQueEntroTarde("a".repeat(64), c, PRINCIPAL)).toEqual({ ok: false, motivo: "otro-sobre" });
    expect(selloQueEntroTarde(dato.hashInterno, c, { ...PRINCIPAL, contractId: deployments.testnet.contractId })).toEqual({ ok: false, motivo: "no-es-sello" });
    expect(selloQueEntroTarde(dato.hashInterno, c, { ...PRINCIPAL, passphrase: Networks.TESTNET })).toEqual({ ok: false, motivo: "otro-sobre" });
  });

  it("con el portero de la red principal: lo que contestó la red esa noche devuelve el sorteo de esa cuenta", async () => {
    const s = escena();
    const fuente = (TransactionBuilder.fromXDR(dato.respuesta.result.envelopeXdr, Networks.PUBLIC) as FeeBumpTransaction).innerTransaction.source;
    s.e.cupos.admitir(fuente, "cupon", s.e.ahora);
    s.e.cupos.otorgar({ usuario: "u-real", cuenta: fuente, origen: "cupon", ref: "cupon:h:real", sorteos: 1, dias: 60 }, s.e.ahora);
    const lim = { maxSellos: 100, maxSorteos: 100, topeGeneral: 150_000_000, reservaSorteo: 82_000, porSorteos: true };
    expect(s.e.cupos.reservar({ hash: dato.hashInterno, cuenta: fuente, metodo: "seal", estimado: 100_000, vence: 1_794_620_367, ganadores: 1 }, s.e.ahora, lim)).toMatchObject({ ok: true });
    s.e.cupos.marcarEnviado(dato.hashInterno);
    expect(s.e.cupos.quedan({ cuenta: fuente }, s.e.ahora).quedan).toBe(0);

    const cfg = { ...leerConfig({ RED: "mainnet", ALTAS: "1", MAX_SELLOS_MES: "100" }), ...PRINCIPAL };
    const m = new Portero(cfg, s.e.cupos, s.e.red, await firmanteDe(Keypair.random().secret()), Keypair.random().publicKey(), () => s.e.ahora, () => {}, (evento, datos) => void s.e.anotado.push({ evento, ...(datos ? { datos } : {}) }));
    s.e.red.consultas.set(dato.hashInterno, await consultaReal());
    s.pasaLaEspera();
    await m.reconciliar();
    expect(s.e.cupos.quedan({ cuenta: fuente }, s.e.ahora).quedan).toBe(1);
    expect(s.e.cupos.buscar(dato.hashInterno)).toMatchObject({ estado: "fallo", real: 5_478 });
    expect(s.e.anotado).toContainEqual({ evento: "sorteo-devuelto", datos: { hash: dato.hashInterno.slice(0, 8), motivo: "ronda-cerca", faltaban: 25, sorteos: 1 } });
  });
});
