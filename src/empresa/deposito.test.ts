import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { armarElDeposito, datosParaStellarLab, prepararElDeposito } from "./deposito";

const EMPRESA = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const TINKAZO = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const USDC = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};
const DOLAR = 10_000_000n;
const NOTA = "123456789012345";

/** Un Horizon que contesta `GET /accounts/{cuenta}` con lo que se le da, y 404 a las que no conoce. */
function horizon(cuentas: Record<string, unknown | number>): { fetch: typeof fetch } {
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    const cuenta = decodeURIComponent(u.split("/accounts/")[1] ?? "");
    const r = cuentas[cuenta];
    if (r === undefined) return new Response("{}", { status: 404 });
    if (typeof r === "number") return new Response("", { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
  return { fetch: f };
}

const cuentaCon = (usdc: string): Record<string, unknown> => ({
  sequence: "23997580010586200",
  balances: [
    { asset_type: "native", balance: "10.0000000" },
    { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC.issuer, balance: usdc, limit: "922337203685.4775807", is_authorized: true },
  ],
});

describe("armar el depósito de la campaña", () => {
  it("es un pago clásico de la cuenta de la empresa a la del servicio, con la nota del evento", async () => {
    const { xdr, nota } = await armarElDeposito({
      red: "testnet",
      origen: EMPRESA,
      destino: TINKAZO,
      monto: 51n * DOLAR,
      nota: NOTA,
    }, "1000");
    expect(nota).toBe(NOTA);
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    if ("innerTransaction" in tx) throw new Error("no debía ser un fee-bump");
    expect(tx.source).toBe(EMPRESA);
    expect(tx.fee).toBe("1000");
    const op = tx.operations[0];
    if (op?.type !== "payment") throw new Error("la operación no es un pago");
    expect(op.destination).toBe(TINKAZO);
    expect(op.asset.code).toBe("USDC");
    expect(op.asset.issuer).toBe(USDC.issuer);
    expect(op.amount).toBe("51.0000000");
    expect(new TextDecoder().decode(tx.memo.value as Uint8Array)).toBe(NOTA);
    expect(tx.timeBounds?.maxTime).not.toBe("0");
  });

  it("cuenta, monto o nota fuera de lugar no arman nada", async () => {
    await expect(
      armarElDeposito({ red: "testnet", origen: "no-es-cuenta", destino: TINKAZO, monto: DOLAR, nota: NOTA }, "1000"),
    ).rejects.toThrow();
    await expect(
      armarElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: 0n, nota: NOTA }, "1000"),
    ).rejects.toThrow();
    await expect(
      armarElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: DOLAR, nota: "una-nota-muy-larga-para-carecer-1" }, "1000"),
    ).rejects.toThrow();
  });

  it("antes de pedir la firma mira que la empresa tenga el dinero y que las dos cuentas existan", async () => {
    const { fetch } = horizon({
      [EMPRESA]: cuentaCon("60.0000000"),
      [TINKAZO]: cuentaCon("1.0000000"),
    });
    const p = await prepararElDeposito(
      { red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: 51n * DOLAR, nota: NOTA },
      { fetch },
    );
    if (!p.ok) throw new Error(`no preparó: ${p.motivo}`);
    expect(p.monto).toBe("51.0000000");
    expect(p.xdr.length).toBeGreaterThan(50);
  });

  it("sin la cuenta en la red, sin dólares digitales o sin saldo suficiente, no se firma nada", async () => {
    const { fetch } = horizon({
      [TINKAZO]: cuentaCon("1.0000000"),
      [EMPRESA]: cuentaCon("0.0000000"),
    });
    expect(
      await prepararElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: 51n * DOLAR, nota: NOTA }, { fetch }),
    ).toEqual({ ok: false, motivo: "origen-sin-saldo", saldo: "0.0000000" });

    const { fetch: otra } = horizon({
      [TINKAZO]: cuentaCon("1.0000000"),
      [EMPRESA]: { sequence: "1", balances: [{ asset_type: "native", balance: "10.0000000" }] },
    });
    expect(
      await prepararElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: DOLAR, nota: NOTA }, { fetch: otra }),
    ).toEqual({ ok: false, motivo: "origen-sin-linea" });

    const { fetch: sinEmpresa } = horizon({ [TINKAZO]: cuentaCon("1.0000000") });
    expect(
      await prepararElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: DOLAR, nota: NOTA }, { fetch: sinEmpresa }),
    ).toEqual({ ok: false, motivo: "origen-sin-cuenta" });

    const { fetch: sinNada } = horizon({});
    expect(
      await prepararElDeposito({ red: "testnet", origen: EMPRESA, destino: TINKAZO, monto: DOLAR, nota: NOTA }, { fetch: sinNada }),
    ).toEqual({ ok: false, motivo: "origen-sin-cuenta" });

    expect(
      await prepararElDeposito({ red: "testnet", origen: "mala", destino: TINKAZO, monto: DOLAR, nota: NOTA }, { fetch: horizon({}).fetch }),
    ).toEqual({ ok: false, motivo: "datos-invalidos" });
  });
});

describe("firmar el depósito", () => {
  it("sin billetera deja el código para Stellar Lab, con la dirección y la red que le tocan", async () => {
    const { datosParaStellarLab } = await import("./deposito");
    const datos = datosParaStellarLab("una-xdr-conservada", EMPRESA, "testnet");
    expect(datos.url.startsWith("https://lab.stellar.org/transaction/sign")).toBe(true);
    expect(datos.xdr).toBe("una-xdr-conservada");
  });
});
