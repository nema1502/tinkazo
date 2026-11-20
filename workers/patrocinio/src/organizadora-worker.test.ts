/**
 * `POST /v1/alta/organizadora` por el Worker y el objeto enteros, sin Cloudflare: el módulo `cloudflare:workers` se reemplaza por una
 * clase vacía, el SQLite es el de prueba y el `fetch` es uno de mentira que hace de Pollar (los créditos) y del RPC (ninguna cuenta
 * existe). Se mira lo que une las piezas: la puerta, el objeto, el libro y que, sin el secreto de la sala, todo lo demás siga igual.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sqlDePrueba } from "./sqlite-prueba";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));

// Lo que se importa después del mock: el Worker y su objeto.
const { default: trabajador, Patrocinio } = await import("./index");

const T0 = Date.UTC(2026, 10, 19, 12, 0, 0);
const SALA_SECRETO = "s".repeat(40);
const EVENTO = "mi-campana-ab12";
const DIA_MS = 86_400_000;

async function fetchDeMentira(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  if (u.pathname === "/v3/billing/credits") {
    return json({ code: "SERVER_BILLING_CREDITS", success: true, content: { billingModel: "PREPAID", available: 100_000, movements: [] } });
  }
  const pedido = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
  return json({ jsonrpc: "2.0", id: 1, result: pedido.method === "getLedgerEntries" ? { entries: null } : {} });
}

function montar(extra: Record<string, unknown> = {}) {
  const sql = sqlDePrueba();
  const ctx = {
    storage: {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => sql.transaccion(fn),
      getAlarm: async () => null,
      setAlarm: async () => {},
    },
  };
  const env: Record<string, unknown> = {
    RED: "mainnet",
    ALTAS: "1",
    POLLAR_APP_ID: "app_x",
    POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000",
    CUENTA_PATROCINADORA: Keypair.random().publicKey(),
    ADMIN_TOKEN: "o".repeat(40),
    CUPON_SECRETO: "c".repeat(32),
    SALA_SECRETO,
    ...extra,
  };
  const objeto = new Patrocinio(ctx as never, env as never);
  env.PATROCINIO = { idFromName: (nombre: string) => nombre, get: () => objeto };
  return { sql, env };
}
type Montaje = ReturnType<typeof montar>;

function pedido(o: { metodo?: string; secreto?: string | null; cuerpo?: unknown; ruta?: string } = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json", Origin: "https://tinkazo.app" };
  if (o.secreto !== null) headers["x-sala-secreto"] = o.secreto ?? SALA_SECRETO;
  const metodo = o.metodo ?? "POST";
  const cuerpo = JSON.stringify(o.cuerpo === undefined ? { cuenta: Keypair.random().publicKey(), evento: EVENTO } : o.cuerpo);
  const url = `https://pm.tinkazo.app${o.ruta ?? "/v1/alta/organizadora"}`;
  return new Request(url, { method: metodo, headers, ...(metodo === "GET" ? {} : { body: cuerpo }) });
}

const correr = async (m: Montaje, req: Request) => {
  const r = await trabajador.fetch(req, m.env as never);
  return { estado: r.status, cuerpo: (await r.json().catch(() => null)) as Record<string, unknown> | null };
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchDeMentira);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la ruta de quien organiza, por el Worker", () => {
  it("con el secreto de la sala admite la cuenta: 200, y queda en el libro con 3 sorteos por 7 días", async () => {
    const m = montar();
    const cuenta = Keypair.random().publicKey();
    expect(await correr(m, pedido({ cuerpo: { cuenta, evento: EVENTO } }))).toEqual({ estado: 200, cuerpo: { ok: true, ya: false } });
    expect(m.sql.exec("SELECT cuenta, permanente FROM cuenta_app").toArray()).toEqual([{ cuenta, permanente: 1 }]);
    expect(m.sql.exec("SELECT cuenta, sorteos, usados, vence, ref FROM derechos").toArray()).toEqual([
      { cuenta, sorteos: 3, usados: 0, vence: T0 + 7 * DIA_MS, ref: `campana:${EVENTO}` },
    ]);
  });

  it("repetir el mismo pedido es inofensivo: 200 con ya true y un solo derecho", async () => {
    const m = montar();
    const cuerpo = { cuenta: Keypair.random().publicKey(), evento: EVENTO };
    await correr(m, pedido({ cuerpo }));
    expect(await correr(m, pedido({ cuerpo }))).toEqual({ estado: 200, cuerpo: { ok: true, ya: true } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM derechos").toArray()).toEqual([{ n: 1 }]);
  });

  it("con un secreto malo da 401 y no escribe nada", async () => {
    const m = montar();
    expect(await correr(m, pedido({ secreto: "x".repeat(40) }))).toEqual({ estado: 401, cuerpo: { motivo: "secreto" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM cuenta_app").toArray()).toEqual([{ n: 0 }]);
  });

  it("sin SALA_SECRETO puesto contesta 503 apagada", async () => {
    const m = montar({ SALA_SECRETO: undefined });
    expect(await correr(m, pedido())).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
  });

  it("con el tope diario lleno da 429 cupo", async () => {
    const m = montar({ ORGANIZADORAS_DIA: "1" });
    await correr(m, pedido());
    const r = await correr(m, pedido({ cuerpo: { cuenta: Keypair.random().publicKey(), evento: "otra-campana-cd34" } }));
    expect(r).toEqual({ estado: 429, cuerpo: { motivo: "cupo", liberaEn: T0 + DIA_MS } });
  });

  it("sin la llave de Pollar el objeto contesta 503 apagada y no escribe", async () => {
    const m = montar({ POLLAR_SECRETO: undefined });
    expect(await correr(m, pedido())).toEqual({ estado: 503, cuerpo: { motivo: "apagada" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM derechos").toArray()).toEqual([{ n: 0 }]);
  });

  it("en la red de prueba la ruta no existe", async () => {
    const m = montar({ RED: "testnet" });
    expect((await correr(m, pedido())).estado).toBe(404);
  });
});

describe("con todo lo demás apagado el portero contesta igual que hoy", () => {
  it("sin SALA_SECRETO la ruta nueva no cambia lo que contestan las otras rutas", async () => {
    const m = montar({ SALA_SECRETO: undefined });
    expect((await correr(m, pedido({ ruta: "/v1/alta/estado", metodo: "POST", secreto: null, cuerpo: {} }))).cuerpo).toEqual({ motivo: "sesion" });
    expect((await correr(m, pedido({ ruta: "/v1/alta/precios", metodo: "GET", secreto: null }))).estado).toBe(200);
    expect(await correr(m, pedido({ ruta: "/", metodo: "GET", secreto: null }))).toEqual({ estado: 200, cuerpo: { servicio: "tinkazo-patrocinio" } });
    const ninguna = pedido({ ruta: "/v1/no-existe", metodo: "GET", secreto: null });
    expect(await correr(m, ninguna)).toEqual({ estado: 404, cuerpo: { motivo: "no-existe" } });
  });
});
