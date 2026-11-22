import { describe, expect, it } from "vitest";
import type { LecturaDeCuenta } from "../stellar/usdc-cuenta";

const cuentaJson = (saldos: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    sequence: "1234567890",
    balances: [{ asset_type: "native", balance: "10.0000000" }, ...saldos],
    ...extra,
  });

const lineaUsdc = (saldo: string): unknown => ({
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  balance: saldo,
  limit: "922337203685.4775807",
  is_authorized: true,
});

const fetchDe = (status: number, cuerpo?: unknown) =>
  async (url: string | URL | Request): Promise<Response> =>
    new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo ?? {}), { status });

const CTA = "GA5XIGA5C7QTPTWXQHY6MCJSMTRP3KMLT6TIPR4ZE2EIB4AFYLLPJIJ6";
const DOLAR = 10_000_000n;

describe("el saldo de la empresa", () => {
  it("lee los dólares digitales de la línea de la red y entiende si le alcanza", async () => {
    const { saldoDeLaEmpresa } = await import("./saldo");
    const { leAlcanza } = await import("./saldo");
    const saldo = await saldoDeLaEmpresa("testnet", CTA, { fetch: fetchDe(200, cuentaJson([lineaUsdc("52.5000000")])) });
    expect(saldo).toEqual({ tipo: "ok", saldo: 525000000n });
    expect(leAlcanza(525000000n, 51n * DOLAR)).toEqual({ tipo: "alcanza" });
    expect(leAlcanza(525000000n, 53n * DOLAR)).toEqual({ tipo: "falta", falta: 5000000n });
    expect(leAlcanza(51n * DOLAR, 51n * DOLAR)).toEqual({ tipo: "alcanza" });
  });

  it("una cuenta sin la línea de dólares digitales no confunde el saldo con cero", async () => {
    const { saldoDeLaEmpresa } = await import("./saldo");
    const saldo = await saldoDeLaEmpresa("testnet", CTA, { fetch: fetchDe(200, cuentaJson([])) });
    expect(saldo).toEqual({ tipo: "sin-linea" });
  });

  it("sin cuenta en la red, sin respuesta de la red o con un cuerpo que no se lee, lo dice", async () => {
    const { saldoDeLaEmpresa } = await import("./saldo");
    expect(await saldoDeLaEmpresa("testnet", CTA, { fetch: fetchDe(404) })).toEqual({ tipo: "sin-cuenta" });
    expect(await saldoDeLaEmpresa("testnet", CTA, { fetch: fetchDe(500) })).toEqual({ tipo: "sin-red" });
    expect(await saldoDeLaEmpresa("testnet", CTA, { fetch: fetchDe(200, "{}") })).toEqual({ tipo: "sin-red" });
    expect(await saldoDeLaEmpresa("testnet", "", { fetch: fetchDe(200, "no-json") })).toEqual({ tipo: "sin-red" });
  });

  it("cuando la red no contesta sigue mirando y no lanza", async () => {
    const { saldoDeLaEmpresa } = await import("./saldo");
    const fallo = async (): Promise<Response> => {
      throw new Error("corta");
    };
    expect(await saldoDeLaEmpresa("testnet", CTA, { fetch: fallo, tiempoMs: 100 })).toEqual({ tipo: "sin-red" });
  });
});
