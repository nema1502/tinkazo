import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ErrorDeAlta, memoIdDe, orden, precios } from "./alta-api";
import { USDC_MAINNET } from "./pagos";

/**
 * La venta por unidad en el cliente del portero, con un servidor de mentira y sin red: `GET /v1/alta/precios` publica el
 * producto `sorteo` con su precio, su rango, su paso y sus días, y `POST /v1/alta/orden` lleva `{ producto, cantidad }`.
 * Lo que no se negocia: sin el producto por unidad, o mal escrito, los precios se leen como siempre.
 */

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const DESTINO = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const ID = "ABCD2345";
const NOTA = `tk:o:${ID}`;

const responder = (estadoHttp: number, cuerpo: unknown): Response =>
  new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

interface Llamada {
  url: string;
  init: RequestInit;
}
function falso(respuesta: () => Response) {
  const llamadas: Llamada[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  });
  return { f: f as unknown as typeof fetch, llamadas, espia: f };
}

const UNIDAD = { producto: "sorteo", usdc: "1", minimo: 5, maximo: 50, paso: 5, dias: 365 };
const LEIDA = { id: "sorteo", usdc: "1", minimo: 5, maximo: 50, paso: 5, dias: 365, pausado: false };
const BASE = { red: "mainnet", pago: true, alta: null, paquetes: [] as unknown[] };

const enlace = (usdc: string): string => {
  const datos = { destination: DESTINO, amount: usdc, asset_code: "USDC", asset_issuer: USDC_MAINNET.issuer };
  const q = new URLSearchParams({ ...datos, memo: NOTA, memo_type: "MEMO_TEXT" });
  return `web+stellar:pay?${q.toString()}`;
};
/** La orden de 10 sorteos a 1 dólar, como la arma el servidor con la cantidad. */
const ORDEN_10 = {
  id: ID,
  producto: "sorteo",
  usdc: "10",
  sorteos: 10,
  destino: DESTINO,
  nota: NOTA,
  memoId: memoIdDe(ID),
  enlace: enlace("10"),
  vence: 1_800_000_000_000,
};

const fallo = (r: unknown): ErrorDeAlta => {
  const e = r as ErrorDeAlta;
  expect(e.ok).toBe(false);
  return e;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("los precios por unidad", () => {
  it("en su campo `unidad`: el producto, su precio, el rango, el paso y los días, tal cual", async () => {
    const { f } = falso(() => responder(200, { ...BASE, unidad: UNIDAD }));
    expect(await precios({ url: URL, fetch: f })).toEqual({ ok: true, datos: { ...BASE, unidad: LEIDA } });
  });

  it("dentro de `paquetes`, se lee igual y no se toma por un paquete fijo", async () => {
    const { f } = falso(() => responder(200, { ...BASE, paquetes: [UNIDAD] }));
    expect(await precios({ url: URL, fetch: f })).toEqual({ ok: true, datos: { ...BASE, unidad: LEIDA } });
  });

  it("con `id` en lugar de `producto`, se lee igual", async () => {
    const { f } = falso(() => responder(200, { ...BASE, unidad: { id: "sorteo", usdc: "1", minimo: 5, maximo: 50, paso: 5, dias: 365 } }));
    expect(await precios({ url: URL, fetch: f })).toMatchObject({ ok: true, datos: { unidad: LEIDA } });
  });

  it("junto a paquetes fijos, los fijos quedan como siempre", async () => {
    const p10 = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
    const { f } = falso(() => responder(200, { ...BASE, paquetes: [p10], unidad: UNIDAD }));
    expect(await precios({ url: URL, fetch: f })).toEqual({ ok: true, datos: { ...BASE, paquetes: [{ ...p10, pausado: false }], unidad: LEIDA } });
  });

  it("pausado se lee como en los paquetes", async () => {
    const { f } = falso(() => responder(200, { ...BASE, unidad: { ...UNIDAD, pausado: true } }));
    expect(await precios({ url: URL, fetch: f })).toMatchObject({ ok: true, datos: { unidad: { ...LEIDA, pausado: true } } });
  });

  it("mal escrito no viene, y lo demás se lee igual", async () => {
    const malos: Record<string, unknown>[] = [
      { ...UNIDAD, usdc: "0" },
      { ...UNIDAD, usdc: 1 },
      { ...UNIDAD, minimo: 0 },
      { ...UNIDAD, minimo: 60 },
      { ...UNIDAD, paso: 2.5 },
      { ...UNIDAD, maximo: 5_000 },
      { ...UNIDAD, dias: 0 },
      { ...UNIDAD, producto: "alta" },
      { ...UNIDAD, producto: "SORTEO" },
    ];
    for (const unidad of malos) {
      const { f } = falso(() => responder(200, { ...BASE, unidad }));
      const r = await precios({ url: URL, fetch: f });
      expect(r, JSON.stringify(unidad)).toEqual({ ok: true, datos: BASE });
    }
  });

  it("un producto `sorteo` sin rango no se ofrece como paquete fijo: se pediría sin cantidad", async () => {
    const { f } = falso(() => responder(200, { ...BASE, paquetes: [{ id: "sorteo", usdc: "1", sorteos: 1, dias: 365 }] }));
    expect(await precios({ url: URL, fetch: f })).toEqual({ ok: true, datos: BASE });
  });

  it("sin el producto por unidad, los precios de siempre", async () => {
    const p10 = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
    const { f } = falso(() => responder(200, { ...BASE, paquetes: [p10] }));
    const r = await precios({ url: URL, fetch: f });
    expect(r).toEqual({ ok: true, datos: { ...BASE, paquetes: [{ ...p10, pausado: false }] } });
    expect(r.ok && "unidad" in r.datos).toBe(false);
  });
});

describe("la orden por unidad", () => {
  it("lleva el producto y la cantidad en el cuerpo, y trae la orden entera", async () => {
    const { f, llamadas } = falso(() => responder(200, { orden: ORDEN_10 }));
    expect(await orden(TOKEN, "sorteo", { url: URL, fetch: f, cantidad: 10 })).toEqual({ ok: true, datos: ORDEN_10 });
    expect(llamadas[0]?.url).toBe(`${URL}/v1/alta/orden`);
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ producto: "sorteo", cantidad: 10 });
  });

  it("sin cantidad, el cuerpo de siempre", async () => {
    const { f, llamadas } = falso(() => responder(200, { orden: { ...ORDEN_10, producto: "p10" } }));
    await orden(TOKEN, "p10", { url: URL, fetch: f });
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ producto: "p10" });
  });

  it("una cantidad que no es un entero razonable ni se pide", async () => {
    for (const cantidad of [0, -5, 2.5, Number.NaN, 5_000]) {
      const { f, espia } = falso(() => responder(200, { orden: ORDEN_10 }));
      const r = await orden(TOKEN, "sorteo", { url: URL, fetch: f, cantidad });
      expect(fallo(r), String(cantidad)).toMatchObject({ clave: "altaErrServicio", motivo: "forma" });
      expect(espia).not.toHaveBeenCalled();
    }
  });

  it("una cantidad fuera del rango del servidor (`400 forma`) dice que no se pudo, no habla del cupón", async () => {
    const { f } = falso(() => responder(400, { motivo: "forma" }));
    const r = await orden(TOKEN, "sorteo", { url: URL, fetch: f, cantidad: 10 });
    expect(fallo(r)).toMatchObject({ clave: "altaErrServicio", motivo: "forma", estado: 400 });
  });

  it("la venta en pausa y el piloto se cuentan como en los paquetes", async () => {
    for (const [motivo, clave] of [
      ["venta-pausada", "pagoPausado"],
      ["fuera-del-piloto", "pagoNoALaVenta"],
      ["pago-apagado", "pagoNoALaVenta"],
    ]) {
      const { f } = falso(() => responder(503, { motivo }));
      expect(fallo(await orden(TOKEN, "sorteo", { url: URL, fetch: f, cantidad: 10 })), motivo).toMatchObject({ clave, motivo });
    }
  });
});
