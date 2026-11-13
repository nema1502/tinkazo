import { describe, expect, it, vi } from "vitest";
import { DOLAR_DIGITAL } from "./pago-con-saldo";
import { alcanza, faltaPara, leerSaldoDeDolares, saldoDelCuerpo } from "./saldo-dolares";

/** El saldo de dólares digitales de una cuenta, leído en un Horizon de mentira: nunca se llama a la red. */

const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const OTRO_EMISOR = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const linea = (o: Record<string, unknown> = {}) => ({ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: DOLAR_DIGITAL.issuer, balance: "12.5000000", limit: "922337203685.4775807", selling_liabilities: "0.0000000", buying_liabilities: "0.0000000", is_authorized: true, ...o });
const nativo = { asset_type: "native", balance: "1.5000000" };
const respuesta = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

describe("saldoDelCuerpo", () => {
  it("el saldo de la línea del dólar digital de la lista cerrada", () => {
    expect(saldoDelCuerpo({ balances: [nativo, linea()] })).toEqual({ tipo: "saldo", saldo: "12.5000000" });
  });
  it("menos lo comprometido en ofertas abiertas", () => {
    expect(saldoDelCuerpo({ balances: [linea({ selling_liabilities: "2.5000000" })] })).toEqual({ tipo: "saldo", saldo: "10.0000000" });
    expect(saldoDelCuerpo({ balances: [linea({ balance: "1.0000000", selling_liabilities: "3.0000000" })] })).toEqual({ tipo: "saldo", saldo: "0.0000000" });
  });
  it("un USDC de otro emisor no cuenta: sin línea", () => {
    expect(saldoDelCuerpo({ balances: [nativo, linea({ asset_issuer: OTRO_EMISOR })] })).toEqual({ tipo: "sin-linea" });
  });
  it("sin la línea, o con la línea sin autorizar: sin línea", () => {
    expect(saldoDelCuerpo({ balances: [nativo] })).toEqual({ tipo: "sin-linea" });
    expect(saldoDelCuerpo({ balances: [linea({ is_authorized: false })] })).toEqual({ tipo: "sin-linea" });
  });
  it("lo que no se entiende: sin red", () => {
    for (const c of [null, {}, { balances: "x" }, { balances: [linea({ balance: "mucho" })] }]) expect(saldoDelCuerpo(c), JSON.stringify(c)).toEqual({ tipo: "sin-red" });
  });
});

describe("leerSaldoDeDolares", () => {
  it("pregunta en Horizon de la red principal por esa cuenta, y nada más", async () => {
    const f = vi.fn(async () => respuesta(200, { balances: [linea()] }));
    expect(await leerSaldoDeDolares(CUENTA, { fetch: f as unknown as typeof fetch })).toEqual({ tipo: "saldo", saldo: "12.5000000" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe(`https://horizon.stellar.org/accounts/${CUENTA}`);
  });
  it("una cuenta que todavía no existe", async () => {
    expect(await leerSaldoDeDolares(CUENTA, { fetch: (async () => respuesta(404, {})) as unknown as typeof fetch })).toEqual({ tipo: "sin-cuenta" });
  });
  it("sin respuesta, un error o una espera larga: sin red, sin lanzar", async () => {
    expect(await leerSaldoDeDolares(CUENTA, { fetch: (async () => respuesta(503, {})) as unknown as typeof fetch })).toEqual({ tipo: "sin-red" });
    expect(await leerSaldoDeDolares(CUENTA, { fetch: (async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch })).toEqual({ tipo: "sin-red" });
    const lenta = ((_: string, i: RequestInit) => new Promise((_r, no) => i.signal?.addEventListener("abort", () => no(new Error("abort"))))) as unknown as typeof fetch;
    expect(await leerSaldoDeDolares(CUENTA, { fetch: lenta, tiempoMs: 20 })).toEqual({ tipo: "sin-red" });
  });
  it("lo que no es una cuenta ni se pregunta", async () => {
    const f = vi.fn();
    expect(await leerSaldoDeDolares("no es una cuenta", { fetch: f as unknown as typeof fetch })).toEqual({ tipo: "sin-red" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("alcanza y faltaPara", () => {
  it("compara en unidades mínimas", () => {
    expect(alcanza("3.0000000", "3")).toBe(true);
    expect(alcanza("2.9999999", "3")).toBe(false);
    expect(alcanza("12.5", "9")).toBe(true);
    expect(faltaPara("1.5000000", "3")).toBe("1.5000000");
    expect(faltaPara("5", "3")).toBe("0.0000000");
  });
  it("lo que no es un monto no alcanza", () => {
    expect(alcanza("x", "3")).toBe(false);
    expect(alcanza("3", "")).toBe(false);
  });
});
