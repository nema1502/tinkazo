import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import type { PagoFalso } from "../../workers/cuenta/src/horizon-falso";
import { BASE, mundoFalso } from "../../workers/cuenta/src/mundo-falso";
import { activarPlan, idDeCanje, leerCuenta, pedirCanje, pedirEvento } from "./cuenta-api";
import { revisarCarga } from "./carga";

/**
 * La detección de la primera carga contra un Horizon simulado, y el cliente del Worker contra el Worker de verdad
 * (con libro y reloj de mentira): las pantallas hablan con estas funciones.
 */

const YO = Keypair.random().publicKey();
const OTRA = Keypair.random().publicKey();
const pago = (extra: Partial<PagoFalso> = {}): PagoFalso => ({ de: OTRA, a: YO, monto: "10.0000000", tx: "a".repeat(64), ...extra });

describe("la primera carga", () => {
  it("si no llegó nada, dice que no llegó y no pide monedas", async () => {
    const m = await mundoFalso({ horizon: { cuentas: [YO] } });
    const r = await revisarCarga(YO, { horizon: { red: "testnet", fetch: m.fetch }, base: BASE, fetch: m.fetch });
    expect(r).toEqual({ estado: "no-llego" });
    expect(m.guardada(YO)).toBeNull();
  });

  it("si llegó un pago de USDC de 1 o más, avisa y se acreditan las 50 monedas", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    const r = await revisarCarga(YO, { horizon: { red: "testnet", fetch: m.fetch }, base: BASE, fetch: m.fetch });
    expect(r).toEqual({ estado: "llego", monedas: 50, saldo: 50 });
    expect(m.guardada(YO)?.hechos).toEqual({ primera_carga: 1 });
  });

  it("la segunda vez avisa que llegó pero no suma otra vez", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    const o = { horizon: { red: "testnet" as const, fetch: m.fetch }, base: BASE, fetch: m.fetch };
    await revisarCarga(YO, o);
    expect(await revisarCarga(YO, o)).toEqual({ estado: "llego", monedas: 0, saldo: 50 });
  });

  it("un pago de menos de un dólar no cuenta", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago({ monto: "0.9000000" })] } } });
    expect(await revisarCarga(YO, { horizon: { red: "testnet", fetch: m.fetch }, base: BASE, fetch: m.fetch })).toEqual({ estado: "no-llego" });
  });

  it("sin monedas prendidas (sin Worker) igual avisa que llegaron los dólares", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    expect(await revisarCarga(YO, { horizon: { red: "testnet", fetch: m.fetch }, base: null })).toEqual({ estado: "llego", monedas: 0, saldo: null });
  });

  it("si el Worker no contesta, los dólares llegaron igual y las monedas quedan para la próxima", async () => {
    const m = await mundoFalso({ horizon: { pagos: { [YO]: [pago()] } } });
    const sinWorker = (async (u: string | URL | Request, i?: RequestInit) => (String(u).startsWith(BASE) ? Promise.reject(new Error("sin red")) : m.fetch(u, i))) as typeof fetch;
    expect(await revisarCarga(YO, { horizon: { red: "testnet", fetch: sinWorker }, base: BASE, fetch: sinWorker })).toEqual({ estado: "llego", monedas: 0, saldo: null });
  });

  it("con Horizon caído no afirma nada", async () => {
    const m = await mundoFalso({ horizon: { caido: true } });
    expect(await revisarCarga(YO, { horizon: { red: "testnet", fetch: m.fetch }, base: BASE, fetch: m.fetch })).toEqual({ estado: "error" });
  });
});

describe("el cliente del Worker", () => {
  it("lee el saldo y la tiendita de una cuenta", async () => {
    const m = await mundoFalso({ horizon: { cuentas: [YO] } });
    m.poner(YO, { saldo: 30 });
    const v = await leerCuenta(BASE, YO, m.fetch);
    expect(v).toMatchObject({ cuenta: YO, saldo: 30, plan: null });
    expect(v?.catalogo.map((c) => c.codigo)).toContain("chocolate");
  });

  it("sin Worker o con una respuesta rara devuelve null y no lanza", async () => {
    const roto = (async () => Promise.reject(new Error("sin red"))) as typeof fetch;
    expect(await leerCuenta(BASE, YO, roto)).toBeNull();
    expect(await pedirEvento(BASE, YO, "comprobar", undefined, roto)).toBeNull();
    expect(await activarPlan(BASE, YO, roto)).toBeNull();
    expect(await pedirCanje(BASE, YO, "token", "chocolate", idDeCanje(), roto)).toEqual({ estado: "error" });
    const basura = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
    expect(await leerCuenta(BASE, YO, basura)).toBeNull();
    expect(await pedirEvento(BASE, YO, "comprobar", undefined, basura)).toBeNull();
  });

  it("el canje con el token de quien organiza descuenta; con otro no; y repetir el id no descuenta dos veces", async () => {
    const { TOKEN } = await import("../../workers/cuenta/src/mundo-falso");
    const m = await mundoFalso({ horizon: { cuentas: [YO] } });
    m.poner(YO, { saldo: 100 });
    const id = idDeCanje();
    expect(await pedirCanje(BASE, YO, "token-que-no-es-de-nadie-1234", "chocolate", id, m.fetch)).toEqual({ estado: "token" });
    expect(await pedirCanje(BASE, YO, TOKEN, "chocolate", id, m.fetch)).toEqual({ estado: "ok", saldo: 80, repetido: false });
    expect(await pedirCanje(BASE, YO, TOKEN, "chocolate", id, m.fetch)).toEqual({ estado: "ok", saldo: 80, repetido: true });
    expect(await pedirCanje(BASE, YO, TOKEN, "nombre-en-el-cartel", idDeCanje(), m.fetch)).toEqual({ estado: "saldo", saldo: 80, falta: 120 });
  });

  it("un identificador de canje es de 20 caracteres seguros y no se repite", () => {
    const ids = new Set(Array.from({ length: 50 }, () => idDeCanje()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{20}$/);
  });
});
