import { describe, expect, it } from "vitest";
import { USDC_TESTNET } from "../stellar/pagos";
import { leAlcanza, saldoDeLaCuenta } from "./stand-campana-saldo";

const CUENTA = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";

/** Un Horizon que contesta `GET /accounts/{cuenta}` con lo que se le da: objeto (JSON), número (estado) o piedra. */
function horizon(respuesta: unknown): { fetch: typeof fetch; pedidos: string[] } {
  const pedidos: string[] = [];
  const f = (async (url: string | URL | Request) => {
    pedidos.push(String(url));
    if (respuesta === "cuelga") return new Promise<Response>(() => undefined);
    if (typeof respuesta === "number") return new Response(JSON.stringify({}), { status: respuesta });
    return new Response(JSON.stringify(respuesta), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, pedidos };
}

const linea = (saldo: string): Record<string, unknown> => ({
  balance: saldo,
  limit: "922337203685.4775807",
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: USDC_TESTNET.issuer,
  is_authorized: true,
  selling_liabilities: "0.0000000",
});

const cuentaDeHorizon = (balances: unknown[]): Record<string, unknown> => ({
  id: CUENTA,
  sequence: "23997580010586200",
  subentry_count: 0,
  num_sponsoring: 0,
  num_sponsored: 0,
  balances,
});

describe("el saldo de la cuenta que tiene el premio", () => {
  it("lee el USDC de Circle de la cuenta y lo trae en stroops", async () => {
    const h = horizon(cuentaDeHorizon([linea("12.5000000")]));
    const r = await saldoDeLaCuenta("testnet", CUENTA, { fetch: h.fetch });
    expect(r).toEqual({ tipo: "ok", saldo: 125000000n });
    expect(h.pedidos.join("\n")).toContain(`/accounts/${CUENTA}`);
  });

  it("con una cuenta que todavía no existe en la red, lo dice y no lanza", async () => {
    const h = horizon(404);
    expect(await saldoDeLaCuenta("testnet", CUENTA, { fetch: h.fetch })).toEqual({ tipo: "sin-cuenta" });
  });

  it("sin la línea del USDC de Circle, lo dice", async () => {
    const h = horizon(cuentaDeHorizon([{ balance: "9.5000000", asset_type: "native", selling_liabilities: "0.0000000" }]));
    expect(await saldoDeLaCuenta("testnet", CUENTA, { fetch: h.fetch })).toEqual({ tipo: "sin-linea" });
  });

  it("con la red caída o con una respuesta que no se lee, es un estado, nunca un lanzamiento", async () => {
    const colgado = horizon("cuelga");
    expect(await saldoDeLaCuenta("testnet", CUENTA, { fetch: colgado.fetch, tiempoMs: 1 })).toEqual({ tipo: "sin-red" });
    const basura = horizon({ balance: 12 });
    expect(await saldoDeLaCuenta("testnet", CUENTA, { fetch: basura.fetch })).toEqual({ tipo: "sin-red" });
  });
});

describe("si el saldo le alcanza al premio", () => {
  it("con el saldo justo a favor: le alcanza", () => {
    expect(leAlcanza(600000000n, 600000000n)).toEqual({ tipo: "alcanza" });
  });
  it("con menos, dice cuánto falta", () => {
    expect(leAlcanza(30000000n, 600000000n)).toEqual({ tipo: "falta", falta: 570000000n });
  });
});
