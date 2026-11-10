import { Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import cuentaGanadora from "./fixtures/horizon-cuenta-con-linea.json";
import { armarPago, mandarPago, prepararPago, type DatosDelPago } from "./pagos-envio";

const ORG = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const GANA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const EMISOR = "GCQPYIVQSYUCGFCGTZ7KTLEZ62PML72P6XND4V2YQLRFK22QQJRPFIAE";
const ACTIVO = { code: "TKUSD", issuer: EMISOR };

const DATOS: DatosDelPago = { red: "testnet", origen: ORG, destino: GANA, activo: ACTIVO, monto: "50.0000000", raffleId: "777", puesto: 0 };

/** La cuenta de Horizon de quien paga, con TKUSD. */
const cuentaQuePaga = (saldo: string, extra: Record<string, unknown>[] = []): Record<string, unknown> => ({
  sequence: "23997580010586200",
  balances: [
    { balance: saldo, limit: "922337203685.4775807", asset_type: "credit_alphanum12", asset_code: "TKUSD", asset_issuer: EMISOR, is_authorized: true },
    { balance: "9999.9999900", asset_type: "native" },
    ...extra,
  ],
});

/** Un Horizon que contesta `GET /accounts/{cuenta}` con lo que se le da, y 404 a las que no conoce. */
function horizon(cuentas: Record<string, unknown | number>): { fetch: typeof fetch; pedidos: string[] } {
  const pedidos: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    pedidos.push(u);
    const cuenta = decodeURIComponent(u.split("/accounts/")[1] ?? "");
    const r = cuentas[cuenta];
    if (r === undefined) return new Response("{}", { status: 404 });
    if (typeof r === "number") return new Response("", { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, pedidos };
}

describe("armar el pago de un premio", () => {
  it("es un pago clásico en el activo, con siete decimales, la nota del premio y la secuencia siguiente", async () => {
    const { xdr, nota } = await armarPago(DATOS, "1000");
    expect(nota).toBe("tk:premio:777:0");
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    if ("innerTransaction" in tx) throw new Error("no debía ser un fee-bump");
    expect(tx.source).toBe(ORG);
    expect(tx.sequence).toBe("1001");
    expect(tx.fee).toBe("1000");
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    if (op?.type !== "payment") throw new Error("la operación no es un pago");
    expect(op.destination).toBe(GANA);
    expect(op.asset.code).toBe("TKUSD");
    expect(op.asset.issuer).toBe(EMISOR);
    expect(op.amount).toBe("50.0000000");
    expect(tx.memo.type).toBe("text");
    expect(new TextDecoder().decode(tx.memo.value as Uint8Array)).toBe("tk:premio:777:0");
    // Vence: no se puede mandar una hora después.
    expect(tx.timeBounds?.maxTime).not.toBe("0");
  });

  it("el monto mínimo y uno con decimales salen con sus siete decimales", async () => {
    for (const monto of ["0.0000001", "12.5000000", "922337203685.4775807"]) {
      const { xdr } = await armarPago({ ...DATOS, monto }, "1");
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      const op = "innerTransaction" in tx ? null : tx.operations[0];
      expect(op?.type === "payment" ? op.amount : null).toBe(monto);
    }
  });

  it("el puesto y el número del sorteo van en la nota", async () => {
    const { nota } = await armarPago({ ...DATOS, raffleId: 278n, puesto: 41 }, "1");
    expect(nota).toBe("tk:premio:278:41");
  });

  it("firmado con la passphrase de mainnet no vale en testnet", async () => {
    const { xdr } = await armarPago({ ...DATOS, red: "mainnet", activo: { code: "USDC", issuer: EMISOR } }, "1");
    const hash = (pass: string): string => Buffer.from(TransactionBuilder.fromXDR(xdr, pass).hash()).toString("hex");
    expect(hash(Networks.PUBLIC)).not.toBe(hash(Networks.TESTNET));
  });

  it("lanza si los datos no valen", async () => {
    await expect(armarPago({ ...DATOS, monto: "50" }, "1")).rejects.toThrow();
    await expect(armarPago({ ...DATOS, monto: "0.0000000" }, "1")).rejects.toThrow();
    await expect(armarPago({ ...DATOS, destino: "GABC" }, "1")).rejects.toThrow();
    await expect(armarPago({ ...DATOS, origen: "Ana" }, "1")).rejects.toThrow();
    await expect(armarPago({ ...DATOS, raffleId: "abc" }, "1")).rejects.toThrow();
    await expect(armarPago({ ...DATOS, puesto: -1 }, "1")).rejects.toThrow();
  });
});

describe("preparar el pago: mirar la red antes de pedir la firma", () => {
  it("arma el pago cuando las dos cuentas pueden", async () => {
    const h = horizon({ [ORG]: cuentaQuePaga("100.0000000"), [GANA]: cuentaGanadora });
    const p = await prepararPago(DATOS, { fetch: h.fetch });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.nota).toBe("tk:premio:777:0");
    expect(p.monto).toBe("50.0000000");
    const tx = TransactionBuilder.fromXDR(p.xdr, Networks.TESTNET);
    if ("innerTransaction" in tx) throw new Error("no debía ser un fee-bump");
    // La secuencia sale de la cuenta que paga.
    expect(tx.sequence).toBe("23997580010586201");
    // Solo se leyeron cuentas: nada se manda.
    expect(h.pedidos.every((u) => u.includes("/accounts/"))).toBe(true);
    expect(h.pedidos).toHaveLength(2);
  });

  it("si la cuenta ganadora no tiene el activo, lo dice antes de firmar", async () => {
    const sinLinea = { sequence: "5", balances: [{ balance: "9999.0000000", asset_type: "native" }] };
    const p = await prepararPago(DATOS, { fetch: horizon({ [ORG]: cuentaQuePaga("100.0000000"), [GANA]: sinLinea }).fetch });
    expect(p).toEqual({ ok: false, motivo: "destino-sin-linea" });
  });

  it("si la línea es de otro emisor, no es la misma moneda", async () => {
    const otra = { sequence: "5", balances: [{ balance: "10.0000000", limit: "1000.0000000", asset_type: "credit_alphanum4", asset_code: "TKUSD", asset_issuer: ORG, is_authorized: true }] };
    const p = await prepararPago(DATOS, { fetch: horizon({ [ORG]: cuentaQuePaga("100.0000000"), [GANA]: otra }).fetch });
    expect(p).toEqual({ ok: false, motivo: "destino-sin-linea" });
  });

  it("si el emisor no autorizó la línea, tampoco puede recibir", async () => {
    const sinPermiso = { sequence: "5", balances: [{ balance: "0.0000000", limit: "1000.0000000", asset_type: "credit_alphanum12", asset_code: "TKUSD", asset_issuer: EMISOR, is_authorized: false }] };
    const p = await prepararPago(DATOS, { fetch: horizon({ [ORG]: cuentaQuePaga("100.0000000"), [GANA]: sinPermiso }).fetch });
    expect(p).toEqual({ ok: false, motivo: "destino-sin-linea" });
  });

  it("si la línea de quien ganó se llena con este pago, lo dice", async () => {
    const casiLlena = { sequence: "5", balances: [{ balance: "990.0000000", limit: "1000.0000000", asset_type: "credit_alphanum12", asset_code: "TKUSD", asset_issuer: EMISOR, is_authorized: true }] };
    const p = await prepararPago(DATOS, { fetch: horizon({ [ORG]: cuentaQuePaga("100.0000000"), [GANA]: casiLlena }).fetch });
    expect(p).toEqual({ ok: false, motivo: "destino-lleno" });
  });

  it("si la cuenta ganadora todavía no existe, lo dice", async () => {
    const p = await prepararPago(DATOS, { fetch: horizon({ [ORG]: cuentaQuePaga("100.0000000") }).fetch });
    expect(p).toEqual({ ok: false, motivo: "destino-sin-cuenta" });
  });

  it("si la cuenta que paga no existe, no tiene el activo o no alcanza el saldo, lo dice con lo que tiene", async () => {
    const h = (org: unknown): typeof fetch => horizon({ ...(org === undefined ? {} : { [ORG]: org }), [GANA]: cuentaGanadora }).fetch;
    expect(await prepararPago(DATOS, { fetch: h(undefined) })).toEqual({ ok: false, motivo: "origen-sin-cuenta" });
    expect(await prepararPago(DATOS, { fetch: h({ sequence: "9", balances: [{ balance: "5.0000000", asset_type: "native" }] }) })).toEqual({ ok: false, motivo: "origen-sin-linea" });
    expect(await prepararPago(DATOS, { fetch: h(cuentaQuePaga("49.9999999")) })).toEqual({ ok: false, motivo: "origen-sin-saldo", saldo: "49.9999999" });
    // Justo el monto alcanza.
    expect((await prepararPago(DATOS, { fetch: h(cuentaQuePaga("50.0000000")) })).ok).toBe(true);
  });

  it("si Horizon no contesta, no se afirma nada de las cuentas", async () => {
    expect(await prepararPago(DATOS, { fetch: horizon({ [ORG]: 503, [GANA]: cuentaGanadora }).fetch })).toEqual({ ok: false, motivo: "sin-red" });
    const roto = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await prepararPago(DATOS, { fetch: roto })).toEqual({ ok: false, motivo: "sin-red" });
    const basura = (async () => new Response("no es json", { status: 200 })) as unknown as typeof fetch;
    expect(await prepararPago(DATOS, { fetch: basura })).toEqual({ ok: false, motivo: "sin-red" });
  });

  it("no se paga a la misma cuenta ni a algo que no es una cuenta", async () => {
    expect(await prepararPago({ ...DATOS, destino: ORG }, { fetch: horizon({}).fetch })).toEqual({ ok: false, motivo: "datos-invalidos" });
    expect(await prepararPago({ ...DATOS, destino: "Ana" }, { fetch: horizon({}).fetch })).toEqual({ ok: false, motivo: "datos-invalidos" });
  });
});

describe("mandar el pago firmado", () => {
  const FIRMADO = "AAAAAgAAAAA=";
  const respuesta = (estado: number, cuerpo: unknown): { fetch: typeof fetch; pedidos: Array<{ url: string; init: RequestInit | undefined }> } => {
    const pedidos: Array<{ url: string; init: RequestInit | undefined }> = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      pedidos.push({ url: String(url), init });
      return new Response(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo), { status: estado });
    }) as typeof fetch;
    return { fetch: f, pedidos };
  };

  it("lo manda a Horizon como formulario y devuelve el hash", async () => {
    const h = "b".repeat(64);
    const r = respuesta(200, { hash: h, successful: true });
    expect(await mandarPago("testnet", FIRMADO, { fetch: r.fetch })).toEqual({ ok: true, hash: h });
    expect(r.pedidos).toHaveLength(1);
    expect(r.pedidos[0]?.url).toBe("https://horizon-testnet.stellar.org/transactions");
    expect(r.pedidos[0]?.init?.method).toBe("POST");
    expect(String(r.pedidos[0]?.init?.body)).toBe(`tx=${encodeURIComponent(FIRMADO)}`);
  });

  it("en mainnet va al Horizon de mainnet", async () => {
    const r = respuesta(200, { hash: "c".repeat(64) });
    await mandarPago("mainnet", FIRMADO, { fetch: r.fetch });
    expect(r.pedidos[0]?.url).toBe("https://horizon.stellar.org/transactions");
  });

  const rechazo = (transaction: string, operations: string[]): unknown => ({ status: 400, extras: { result_codes: { transaction, operations } } });

  it("dice por qué la red no la aceptó", async () => {
    const casos: Array<[string, string[], string]> = [
      ["tx_failed", ["op_underfunded"], "sin-saldo"],
      ["tx_insufficient_balance", [], "sin-saldo"],
      ["tx_failed", ["op_no_trust"], "sin-linea"],
      ["tx_failed", ["op_not_authorized"], "sin-linea"],
      ["tx_failed", ["op_no_destination"], "sin-cuenta"],
      ["tx_failed", ["op_line_full"], "lleno"],
      ["tx_bad_seq", [], "secuencia"],
      ["tx_too_late", [], "vencido"],
      ["tx_bad_auth", [], "firma"],
      ["tx_failed", ["op_malformed"], "otro"],
    ];
    for (const [tx, ops, esperado] of casos) {
      const r = await mandarPago("testnet", FIRMADO, { fetch: respuesta(400, rechazo(tx, ops)).fetch });
      expect(r, `${tx} ${ops}`).toEqual({ ok: false, rechazo: esperado, codigos: [tx, ...ops] });
    }
  });

  it("si Horizon no esperó el resultado o no contesta, no se sabe si entró, y no se dice que falló", async () => {
    for (const estado of [504, 503, 429, 500]) {
      expect(await mandarPago("testnet", FIRMADO, { fetch: respuesta(estado, "").fetch }), String(estado)).toEqual({ ok: false, rechazo: "sin-respuesta", codigos: [] });
    }
    const corte = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await mandarPago("testnet", FIRMADO, { fetch: corte })).toEqual({ ok: false, rechazo: "sin-respuesta", codigos: [] });
  });

  it("un 200 sin hash de verdad no es un pago", async () => {
    const r = await mandarPago("testnet", FIRMADO, { fetch: respuesta(200, { hash: "no" }).fetch });
    expect(r.ok).toBe(false);
  });
});
