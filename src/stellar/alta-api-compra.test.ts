import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ErrorDeCompra, anularCompra, cargarCompra, empezarCompra, estado, memoIdDe, orden } from "./alta-api";
import { USDC_MAINNET } from "./pagos";

/**
 * El cliente de la compra con QR del portero (`POST /v1/compra/empezar`, `/v1/compra/cargar` y `/v1/compra/anular`), la
 * compra que cuenta `/v1/alta/estado` (`compraQr`) y la orden con el recargo del QR, con un servidor de mentira: sin red.
 * Las formas son las de `workers/patrocinio/src/rutas-altas.ts` y `compras.ts` (`vista`) de la rama del servidor.
 */

const URL = "https://pm.example";
const TOKEN = "eyJhbGciOiJFUzI1NiJ9.cuerpo-del-token_secreto.firma-del-token-1234567890";
const DESTINO = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const ID = "ABCD2345";
const NOTA = `tk:o:${ID}`;

const responder = (estadoHttp: number, cuerpo: unknown): Response => new Response(JSON.stringify(cuerpo), { status: estadoHttp, headers: { "Content-Type": "application/json" } });

function falso(respuesta: () => Response | Promise<Response>) {
  const llamadas: { url: string; init: RequestInit }[] = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return respuesta();
  });
  return { f: f as unknown as typeof fetch, llamadas };
}

const fallo = (r: unknown): ErrorDeCompra => {
  const e = r as ErrorDeCompra;
  expect(e.ok).toBe(false);
  return e;
};

/** El permiso como lo da el servidor (`ComprasQr.vista`). */
const permiso = (o: Partial<Record<string, unknown>> = {}) => ({ producto: "p10", desde: 1_763_000_000_000, recargo: "0.5", total: "10.5", primera: false, cargada: false, ...o });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("empezar: el permiso de la compra con QR", () => {
  it("pide con la sesión en la cabecera y el producto en el cuerpo, y trae el permiso tal cual", async () => {
    const { f, llamadas } = falso(() => responder(200, { permiso: permiso() }));
    expect(await empezarCompra(TOKEN, "p10", { url: URL, fetch: f })).toEqual({ ok: true, datos: permiso() });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.url).toBe(`${URL}/v1/compra/empezar`);
    expect(llamadas[0]?.init.method).toBe("POST");
    expect((llamadas[0]?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ producto: "p10" });
    expect(llamadas[0]?.url).not.toContain(TOKEN);
  });

  it("el primer paquete con el recargo de la primera vez, y un paquete que dejó de venderse (total null)", async () => {
    const primera = permiso({ producto: "alta", recargo: "4", total: "8", primera: true });
    const { f } = falso(() => responder(200, { permiso: primera }));
    expect(await empezarCompra(TOKEN, "alta", { url: URL, fetch: f })).toEqual({ ok: true, datos: primera });
    const { f: g } = falso(() => responder(200, { permiso: permiso({ total: null }) }));
    expect(await empezarCompra(TOKEN, "p10", { url: URL, fetch: g })).toEqual({ ok: true, datos: permiso({ total: null }) });
  });

  it("un permiso que no se entiende no se acepta: nunca un total que no vino entero del servidor", async () => {
    for (const malo of [
      permiso({ recargo: 0.5 }),
      permiso({ total: "10,5" }),
      permiso({ total: 10.5 }),
      permiso({ desde: "ayer" }),
      permiso({ primera: "no" }),
      permiso({ cargada: 1 }),
      permiso({ producto: "P10 " }),
      // El total trae el recargo: no puede ser menor.
      permiso({ recargo: "4", total: "3" }),
      null,
    ]) {
      const { f } = falso(() => responder(200, { permiso: malo }));
      expect(fallo(await empezarCompra(TOKEN, "p10", { url: URL, fetch: f })), JSON.stringify(malo)).toMatchObject({ motivo: "respuesta" });
    }
  });

  it("los motivos del servidor llegan tal cual, con el permiso de la compra en curso si lo trae", async () => {
    for (const [s, motivo] of [
      [503, "compras-cerradas"],
      [503, "fondeo-diferido"],
      [503, "fuera-del-piloto"],
      [503, "tope-del-dia"],
      [503, "sin-lugar"],
      [409, "ya-tiene-acceso"],
      [400, "producto"],
      [401, "sesion"],
    ] as const) {
      const { f } = falso(() => responder(s, { motivo }));
      expect(fallo(await empezarCompra(TOKEN, "p10", { url: URL, fetch: f })), motivo).toMatchObject({ motivo, estado: s });
    }
    const { f } = falso(() => responder(409, { motivo: "compra-en-curso", permiso: permiso({ producto: "alta", cargada: true }) }));
    expect(fallo(await empezarCompra(TOKEN, "p10", { url: URL, fetch: f }))).toMatchObject({ motivo: "compra-en-curso", estado: 409, permiso: permiso({ producto: "alta", cargada: true }) });
  });

  it("sin token, con un producto sin forma, sin portero o sin red: no se llama a nadie o es sin red", async () => {
    const { f, llamadas } = falso(() => responder(200, { permiso: permiso() }));
    expect(fallo(await empezarCompra("", "p10", { url: URL, fetch: f }))).toMatchObject({ motivo: "sin-token" });
    expect(fallo(await empezarCompra(TOKEN, "P10 o algo", { url: URL, fetch: f }))).toMatchObject({ motivo: "producto" });
    expect(fallo(await empezarCompra(TOKEN, "p10", { url: null, fetch: f }))).toMatchObject({ motivo: "sin-portero" });
    expect(llamadas).toHaveLength(0);
    const sinRed = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(fallo(await empezarCompra(TOKEN, "p10", { url: URL, fetch: sinRed }))).toMatchObject({ motivo: "sin-red", estado: 0 });
  });
});

describe("cargar: el aviso antes de crear la orden de carga", () => {
  it("manda el producto y, solo si se pide, reemplazar en true", async () => {
    const { f, llamadas } = falso(() => responder(200, { permiso: permiso({ cargada: true }) }));
    expect(await cargarCompra(TOKEN, "p10", { url: URL, fetch: f })).toEqual({ ok: true, datos: permiso({ cargada: true }) });
    expect(await cargarCompra(TOKEN, "p10", { url: URL, fetch: f, reemplazar: true })).toMatchObject({ ok: true });
    expect(llamadas.map((l) => l.url)).toEqual([`${URL}/v1/compra/cargar`, `${URL}/v1/compra/cargar`]);
    expect(llamadas.map((l) => JSON.parse(String(l.init.body)))).toEqual([{ producto: "p10" }, { producto: "p10", reemplazar: true }]);
  });

  it("un 200 sin el permiso cargado no es un sí", async () => {
    const { f } = falso(() => responder(200, { permiso: permiso({ cargada: false }) }));
    expect(fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: f }))).toMatchObject({ motivo: "respuesta" });
  });

  it("cada no, con lo que trae: la orden viva, cuándo reintentar y el permiso", async () => {
    const viva = { id: ID, producto: "p10", usdc: "10", nota: NOTA, vence: 1_800_000_000_000, recibido: "0" };
    const { f } = falso(() => responder(409, { motivo: "orden-abierta", orden: viva }));
    expect(fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: f }))).toMatchObject({ motivo: "orden-abierta", estado: 409, orden: { id: ID, producto: "p10", usdc: "10", nota: NOTA, vence: 1_800_000_000_000, recibido: "0" } });
    const { f: g } = falso(() => responder(409, { motivo: "cargando", permiso: permiso({ cargada: true }), reintentarEn: 1_800_000_180_000 }));
    expect(fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: g }))).toMatchObject({ motivo: "cargando", reintentarEn: 1_800_000_180_000, permiso: permiso({ cargada: true }) });
    const { f: v } = falso(() => responder(409, { motivo: "permiso-vencido", permiso: permiso() }));
    expect(fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: v }))).toMatchObject({ motivo: "permiso-vencido", permiso: permiso() });
    for (const [s, motivo] of [
      [404, "sin-permiso"],
      [409, "ya-tiene-acceso"],
      [409, "orden-con-pago"],
      [502, "red"],
      [503, "compras-cerradas"],
      [503, "fuera-del-piloto"],
    ] as const) {
      const { f: h } = falso(() => responder(s, { motivo }));
      expect(fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: h })), motivo).toMatchObject({ motivo, estado: s });
    }
  });

  it("lo que viene de más y no se entiende se deja de lado, el motivo queda", async () => {
    const { f } = falso(() => responder(409, { motivo: "cargando", permiso: "no", reintentarEn: "luego" }));
    const e = fallo(await cargarCompra(TOKEN, "p10", { url: URL, fetch: f }));
    expect(e.motivo).toBe("cargando");
    expect(e.permiso).toBeUndefined();
    expect(e.reintentarEn).toBeUndefined();
  });
});

describe("anular: la persona suelta la reserva de su compra cargada", () => {
  it("anulada o repetida", async () => {
    const { f, llamadas } = falso(() => responder(200, { anulada: true, repetido: false }));
    expect(await anularCompra(TOKEN, "alta", { url: URL, fetch: f })).toEqual({ ok: true, datos: { anulada: true, repetido: false } });
    expect(llamadas[0]?.url).toBe(`${URL}/v1/compra/anular`);
    expect(JSON.parse(String(llamadas[0]?.init.body))).toEqual({ producto: "alta" });
    const { f: g } = falso(() => responder(200, { anulada: true, repetido: true }));
    expect(await anularCompra(TOKEN, "alta", { url: URL, fetch: g })).toEqual({ ok: true, datos: { anulada: true, repetido: true } });
    const { f: x } = falso(() => responder(200, { anulada: "si" }));
    expect(fallo(await anularCompra(TOKEN, "alta", { url: URL, fetch: x }))).toMatchObject({ motivo: "respuesta" });
  });

  it("cada no, tal cual", async () => {
    for (const [s, motivo] of [
      [404, "sin-compra"],
      [409, "plazo-vencido"],
      [409, "compra-en-curso"],
      [409, "orden-con-pago"],
      [409, "tope-de-anulaciones"],
      [502, "red"],
      [400, "producto"],
    ] as const) {
      const { f } = falso(() => responder(s, { motivo }));
      expect(fallo(await anularCompra(TOKEN, "alta", { url: URL, fetch: f })), motivo).toMatchObject({ motivo, estado: s });
    }
  });
});

describe("la compra con QR que cuenta el estado", () => {
  const base = { acceso: "pago", cuenta: DESTINO, abierta: true, pedido: null, sorteos: { quedan: 2, proximoVence: null }, orden: null, fondeo: "inmediato" };

  it("sin compraQr, el estado de siempre y nada más", async () => {
    const { f } = falso(() => responder(200, base));
    const r = await estado(TOKEN, { url: URL, fetch: f });
    expect(r.ok).toBe(true);
    if (r.ok) expect("compraQr" in r.datos).toBe(false);
  });

  it("con la compra en curso, el recargo pendiente y lo mínimo en bolivianos", async () => {
    const compraQr = { puede: true, motivo: null, abierta: permiso({ cargada: true }), terminar: true, minimoBs: 50, recargoPendiente: "0.5" };
    const { f } = falso(() => responder(200, { ...base, compraQr }));
    expect(await estado(TOKEN, { url: URL, fetch: f })).toMatchObject({ ok: true, datos: { compraQr } });
  });

  it("sin compra en curso, con el motivo del no", async () => {
    const compraQr = { puede: false, motivo: "tope-del-dia", abierta: null, terminar: false, minimoBs: 0, recargoPendiente: null };
    const { f } = falso(() => responder(200, { ...base, compraQr }));
    expect(await estado(TOKEN, { url: URL, fetch: f })).toMatchObject({ ok: true, datos: { compraQr } });
  });

  it("una compraQr que no se entiende se deja de lado: no traba el acceso", async () => {
    for (const malo of [{ puede: "si" }, { puede: true, motivo: null, abierta: permiso({ total: 3 }), terminar: true, minimoBs: 50, recargoPendiente: null }, { puede: true, motivo: null, abierta: null, terminar: true, minimoBs: 50, recargoPendiente: "4,5" }, "x"]) {
      const { f } = falso(() => responder(200, { ...base, compraQr: malo }));
      const r = await estado(TOKEN, { url: URL, fetch: f });
      expect(r.ok, JSON.stringify(malo)).toBe(true);
      if (r.ok) expect("compraQr" in r.datos, JSON.stringify(malo)).toBe(false);
    }
  });
});

/** El enlace de pago como lo arma el servidor (`enlaceDePago`, `cobros.ts`). */
function enlace(o: { destino: string; usdc: string; nota: string }): string {
  const q = new URLSearchParams({ destination: o.destino, amount: o.usdc, asset_code: "USDC", asset_issuer: USDC_MAINNET.issuer, memo: o.nota, memo_type: "MEMO_TEXT" });
  return `web+stellar:pay?${q.toString()}`;
}
const ordenDe = (usdc: string, extra: Record<string, unknown> = {}) => ({ id: ID, producto: "p10", usdc, sorteos: 10, destino: DESTINO, nota: NOTA, memoId: memoIdDe(ID), enlace: enlace({ destino: DESTINO, usdc, nota: NOTA }), vence: 1_800_000_000_000, ...extra });

describe("la orden con el recargo del QR", () => {
  it("trae el precio del paquete y el recargo, que suman el total", async () => {
    const { f } = falso(() => responder(200, { orden: ordenDe("10.5", { precio: "10", recargo: "0.5" }) }));
    expect(await orden(TOKEN, "p10", { url: URL, fetch: f })).toMatchObject({ ok: true, datos: { usdc: "10.5", precio: "10", recargo: "0.5" } });
  });

  it("sin recargo, la orden de siempre, sin precio ni recargo", async () => {
    const { f } = falso(() => responder(200, { orden: ordenDe("10") }));
    const r = await orden(TOKEN, "p10", { url: URL, fetch: f });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect("precio" in r.datos).toBe(false);
      expect("recargo" in r.datos).toBe(false);
    }
  });

  it("un precio y un recargo que no suman el total, o uno solo, no se aceptan", async () => {
    for (const extra of [{ precio: "10", recargo: "1" }, { precio: "10" }, { recargo: "0.5" }, { precio: "10", recargo: 0.5 }, { precio: "9.9999999", recargo: "0.5" }]) {
      const { f } = falso(() => responder(200, { orden: ordenDe("10.5", extra) }));
      expect(fallo(await orden(TOKEN, "p10", { url: URL, fetch: f })), JSON.stringify(extra)).toMatchObject({ motivo: "respuesta" });
    }
  });
});
