/**
 * La alarma de cobros en el objeto entero, sin Cloudflare: el módulo `cloudflare:workers` se reemplaza por una clase vacía, el
 * SQLite es el de prueba, el reloj es el de la prueba y el `fetch` es uno de mentira que hace de RPC, de Horizon y del proveedor
 * de cuentas. Lo que se mira: sin la venta por unidad todo es como antes, con ella crear una orden pide la alarma y la alarma
 * acredita el pago sola, y una falla de la parte de cobros no apaga los sellos ni los pagos.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_PRUEBA } from "./armar-pago";
import { VIGILAR_CADA_MS, VIGILAR_DESPUES_MS } from "./cobros";
import { horizonDeCobros } from "./cobros-prueba";
import { PorteroDePagos } from "./pagos-servicio";
import { Portero } from "./servicio";
import { sqlDePrueba } from "./sqlite-prueba";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      public ctx: unknown,
      public env: unknown,
    ) {}
  },
}));

const { Patrocinio } = await import("./index");

const T0 = AHORA_DE_PRUEBA * 1000;
const COBROS = Keypair.random().publicKey();
const tokenDe = (usuario: string) => `tok_${usuario}_${"x".repeat(24)}`;

// ---------- el mundo de mentira ----------

/** Las personas que conoce el proveedor de cuentas: su id y su billetera. */
const personas = new Map<string, string>();
/** Los pagos que llegan a la cuenta de cobros, como los da Horizon. */
let horizon = horizonDeCobros(COBROS);

async function fetchDeMentira(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  if (u.hostname === "server.api.pollar.xyz") {
    if (u.pathname === "/v3/tokens/verify") {
      const token = String((JSON.parse(String(init?.body)) as { token: string }).token);
      const usuario = [...personas.keys()].find((p) => tokenDe(p) === token);
      if (!usuario) return json({ code: "SDK_AUTH_INVALID_TOKEN", success: false }, 401);
      const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
      const content = { userId: usuario, applicationId: "app_x", expiresAt, network: "mainnet", wallet: null, authProvider: "google" };
      return json({ code: "SERVER_TOKEN_VERIFIED", success: true, content });
    }
    if (u.pathname === "/v3/users") {
      const q = u.searchParams.get("q") ?? "";
      const cuenta = personas.get(q);
      const items = cuenta ? [{ id: q, email: "x@correo.test", wallets: [{ network: "STELLAR", public_key: cuenta }] }] : [];
      return json({ code: "SERVER_SDK_USERS_LIST", success: true, content: { items } });
    }
    const creditos = { code: "SERVER_BILLING_CREDITS", success: true, content: { available: 100_000, movements: [] } };
    if (u.pathname === "/v3/billing/credits") return json(creditos);
    return json({ code: "SERVER_TREASURY_SPONSORSHIP", success: true, content: { sponsor_trustlines: false } });
  }
  if (u.hostname === "horizon.stellar.org") {
    if (/\/payments$/.test(u.pathname)) return horizon.fetch(String(url));
    return json({}, 404);
  }
  const pedido = JSON.parse(String(init?.body)) as { method: string };
  const respuestas: Record<string, unknown> = { getLedgerEntries: { entries: null }, sendTransaction: { status: "PENDING" } };
  return json({ jsonrpc: "2.0", id: 1, result: respuestas[pedido.method] ?? { status: "NOT_FOUND" } });
}

const POR_UNIDAD = { PRECIOS: "sorteo:1:1:365" };

function montar(extra: Record<string, unknown> = {}) {
  const sql = sqlDePrueba();
  let alarma: number | null = null;
  const puestas: number[] = [];
  const ctx = {
    storage: {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => sql.transaccion(fn),
      getAlarm: async () => alarma,
      setAlarm: async (ms: number) => {
        alarma = ms;
        puestas.push(ms);
      },
    },
  };
  const env: Record<string, unknown> = {
    RED: "mainnet",
    ALTAS: "1",
    ALTAS_PAGO: "1",
    POLLAR_APP_ID: "app_x",
    POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000",
    CUENTA_PATROCINADORA: Keypair.random().publicKey(),
    CLAVE_PATROCINADOR: Keypair.random().secret(),
    CUENTA_COBROS: COBROS,
    COSTO_RETIRO: "0.50",
    RETIROS: "1",
    ADMIN_TOKEN: "o".repeat(40),
    CUPON_SECRETO: "c".repeat(32),
    ...extra,
  };
  const objeto = new Patrocinio(ctx as never, env as never);
  const persona = (usuario: string) => {
    personas.set(usuario, Keypair.random().publicKey());
    return { usuario, token: tokenDe(usuario) };
  };
  const orden = (token: string, cuerpo: Record<string, unknown>) => objeto.pagoAlta("orden", { token, ip: "190.129.10.20", cuerpo });
  /** La alarma como la corre Cloudflare: la que está puesta se consume y corre. */
  const disparar = async () => {
    alarma = null;
    await objeto.alarm();
  };
  const sorteos = () => Number(sql.exec("SELECT COALESCE(SUM(sorteos), 0) AS n FROM derechos").toArray()[0]?.n ?? 0);
  return { sql, objeto, persona, orden, disparar, sorteos, alarma: () => alarma, puestas };
}

/** Deja correr lo que el objeto lanzó sin esperar (la alarma que se pide al crear la orden). */
const vaciar = () => new Promise<void>((listo) => setTimeout(listo, 0));
const lecturasDeHorizon = () => horizon.estado.pedidos.length;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchDeMentira);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  personas.clear();
  horizon = horizonDeCobros(COBROS);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sin la venta por unidad, todo como antes", () => {
  it("crear una orden no pide alarma, la alarma no lee los pagos y el estado no suma el bloque de cobros", async () => {
    const m = montar({ PRECIOS: "alta:2:3:365,p10:5:10:365" });
    const p = m.persona("usr_uno");
    expect((await m.orden(p.token, { producto: "alta" })).estado).toBe(200);
    await vaciar();
    expect(m.alarma()).toBeNull();
    await m.disparar();
    expect(lecturasDeHorizon()).toBe(0);
    expect(m.puestas).toEqual([]);
    expect(Object.keys((await m.objeto.administrar("estado")).cuerpo)).not.toContain("cobros");
  });
});

describe("con la venta por unidad", () => {
  it("crear una orden pide la alarma, y la alarma acredita el pago sin que la persona pregunte", async () => {
    const m = montar(POR_UNIDAD);
    const p = m.persona("usr_uno");
    const r = await m.orden(p.token, { producto: "sorteo", cantidad: 10 });
    expect(r.estado).toBe(200);
    await vaciar();
    expect(m.alarma()).toBe(T0 + VIGILAR_CADA_MS);
    const id = (r.cuerpo as { orden: { id: string } }).orden.id;
    horizon.sumar({ monto: "10.0000000", nota: `tk:o:${id}`, ms: T0 + 5_000 });
    vi.setSystemTime(new Date(T0 + VIGILAR_CADA_MS));
    await m.disparar();
    expect(m.sorteos()).toBe(10);
    expect((await m.objeto.administrar("estado")).cuerpo.cobros).toMatchObject({ ordenesVivas: 0, pagosChicosHoy: 0, atrasado: false });
    // Sin órdenes vivas, la vuelta siguiente no lee y no pide otra.
    const lecturas = lecturasDeHorizon();
    vi.setSystemTime(new Date(T0 + 2 * VIGILAR_CADA_MS));
    await m.disparar();
    expect(lecturasDeHorizon()).toBe(lecturas);
    expect(m.alarma()).toBeNull();
  });

  it("al arrancar con una orden viva, el objeto vuelve a pedir su alarma", async () => {
    const m = montar(POR_UNIDAD);
    const p = m.persona("usr_uno");
    await m.orden(p.token, { producto: "sorteo", cantidad: 5 });
    await vaciar();
    // El mismo SQLite, como después de un reinicio: otra copia del objeto que lo lee, sin ninguna alarma puesta.
    const puestas: number[] = [];
    const storage = {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => m.sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => m.sql.transaccion(fn),
      getAlarm: async () => null,
      setAlarm: async (ms: number) => void puestas.push(ms),
    };
    const env = { RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", POLLAR_APP_ID: "app_x", CUENTA_COBROS: COBROS, ...POR_UNIDAD };
    await new Patrocinio({ storage } as never, env as never).administrar("estado");
    expect(puestas).toEqual([T0 + 20_000]);
  });

  it("una falla de la parte de cobros no apaga los sellos ni los pagos: corren igual y la alarma vuelve en 5 minutos", async () => {
    const m = montar(POR_UNIDAD);
    const p = m.persona("usr_uno");
    await m.orden(p.token, { producto: "sorteo", cantidad: 10 });
    await vaciar();
    const sellos = vi.spyOn(Portero.prototype, "reconciliar");
    const pagos = vi.spyOn(PorteroDePagos.prototype, "reconciliar");
    // Sin la tabla de las órdenes, la parte de cobros lanza.
    m.sql.exec("ALTER TABLE ordenes RENAME TO ordenes_rotas");
    await m.disparar();
    expect(sellos).toHaveBeenCalledTimes(1);
    expect(pagos).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("alarma-cobros"));
    expect(m.alarma()).toBe(T0 + VIGILAR_DESPUES_MS);
  });
});
