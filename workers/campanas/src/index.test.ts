/**
 * El servicio de campañas entero (Worker y objeto), sin Cloudflare: el módulo `cloudflare:workers`
 * se reemplaza por una clase vacía, el SQLite es el de prueba y el reloj es una fecha fija.
 * Lo que se mira es lo que une las piezas: las rutas, las tablas, la huella de las bases,
 * la invitación, el informe, el aviso a comisiones y la segunda empresa cargada solo por la API.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { huellaDeBases } from "../../../src/campana/huella-de-bases";
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
const { default: trabajador, Campanas } = await import("./index");

const T0 = Date.UTC(2026, 11, 1, 12, 0);
const ADMIN = "a".repeat(40);
const SECRETO = "s".repeat(40);
const OTRO_SECRETO = "t".repeat(40);
const CUPO = 300;

/** La configuración de una campaña que `leerCampana` acepta (la misma forma del sitio). */
const campana = (evento = "e7k2m9") => ({
  v: 1,
  evento,
  red: "testnet",
  estado: "abierta",
  empresa: { nombre: "Empresa de ejemplo", logo: null, color: "verde" },
  lugar: { es: "Feria de La Paz", en: "La Paz fair" },
  zona: "America/La_Paz",
  premios: ["400000000", "250000000"],
  abre_ms: T0 - 3_600_000,
  cierra_ms: T0 + 3_600_000,
  sorteo_ms: T0 + 7_200_000,
  recibir_hasta_ms: T0 + 86_400_000,
  entrada: "google",
  pasos: [{ tipo: "instagram", url: "https://instagram.com/tinkazo", texto: { es: "Seguinos", en: "Follow us" } }],
  bases: { es: "Bases del sorteo", en: "Contest rules" },
  anotadas: 37,
  contrato: null,
  promo: null,
  comprobante: null,
});

// ---------- el mundo de mentira ----------

function montar(extra: Record<string, unknown> = {}) {
  const sql = sqlDePrueba();
  const ctx = {
    storage: {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => sql.transaccion(fn),
    },
  };
  const env: Record<string, unknown> = {
    ADMIN_TOKEN: ADMIN,
    ...extra,
  };
  const objeto = new Campanas(ctx as never, env as never, () => T0);
  env.CAMPANAS = { idFromName: (nombre: string) => nombre, get: () => objeto };
  return { sql, objeto, env };
}
type Montaje = ReturnType<typeof montar>;

/** Los avisos a comisiones que el `fetch` de mentira vio. */
const avisos: { url: string; init?: RequestInit }[] = [];
function fetchDeMentira(url: string | URL, init?: RequestInit): Promise<Response> {
  avisos.push({ url: String(url), init });
  return Promise.resolve(new Response("{}", { status: 200 }));
}

function pedido(ruta: string, o: { metodo?: string; cuerpo?: unknown; clave?: string } = {}): Request {
  const metodo = o.metodo ?? "POST";
  const cuerpo = o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (o.clave !== undefined) headers.Authorization = `Bearer ${o.clave}`;
  return new Request(`https://campanas.tinkazo.app${ruta}`, { method: metodo, headers, ...(cuerpo !== undefined && metodo !== "GET" ? { body: cuerpo } : {}) });
}

const cuerpo = async (r: Response) => (await r.json()) as Record<string, unknown>;

/** Crea una empresa por la API y le carga su secreto al env, como haría `wrangler secret put SECRETO_<ID>`. */
async function empresaNueva(m: Montaje, secreto = SECRETO): Promise<string> {
  const r = await trabajador.fetch(pedido("/v1/empresas", { clave: ADMIN }), m.env as never);
  expect(r.status).toBe(200);
  const c = (await r.json()) as { id: string };
  m.env[`SECRETO_${c.id.toUpperCase()}`] = secreto;
  return c.id;
}

beforeEach(() => {
  avisos.length = 0;
  vi.stubGlobal("fetch", fetchDeMentira);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- las pruebas ----------

describe("POST /v1/empresas", () => {
  it("crea una empresa con un identificador opaco, sin nombres", async () => {
    const m = montar();
    const r = await trabajador.fetch(pedido("/v1/empresas", { clave: ADMIN }), m.env as never);
    expect(r.status).toBe(200);
    const c = await cuerpo(r);
    expect(c.id).toMatch(/^[0-9a-f]{32}$/u);
    expect(Object.keys(c)).toEqual(["id"]);
    const otra = await cuerpo(await trabajador.fetch(pedido("/v1/empresas", { clave: ADMIN }), m.env as never));
    expect(otra.id).not.toBe(c.id);
    const filas = m.sql.exec("select id from empresas").toArray();
    expect(filas).toHaveLength(2);
  });

  it("sin clave cargada contesta apagada y con una clave equivocada, 401", async () => {
    const m = montar({ ADMIN_TOKEN: undefined });
    expect((await trabajador.fetch(pedido("/v1/empresas", { clave: ADMIN }), m.env as never)).status).toBe(503);
    const n = montar();
    expect((await trabajador.fetch(pedido("/v1/empresas", { clave: "b".repeat(40) }), n.env as never)).status).toBe(401);
    expect((await trabajador.fetch(pedido("/v1/empresas"), n.env as never)).status).toBe(401);
  });
});

describe("el alta de una campaña", () => {
  it("guarda la campaña con sus tablas y responde con la huella de las bases", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    const cuenta = Keypair.random().publicKey();
    const r = await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: cuenta, campana: campana() } }), m.env as never);
    expect(r.status).toBe(200);
    const c = await cuerpo(r);
    expect(c.evento).toBe("e7k2m9");
    expect(typeof c.huellaBases).toBe("string");
    // Las tablas del objeto: empresa, campaña con su organizadora y su estado, pasos, premios y bases con su huella.
    expect(m.sql.exec("select id from empresas").toArray()).toHaveLength(1);
    const filas = m.sql.exec("select evento, empresa, cupo, estado, organizadora from campanas").toArray();
    expect(filas).toEqual([{ evento: "e7k2m9", empresa: id, cupo: CUPO, estado: "abierta", organizadora: cuenta }]);
    expect(m.sql.exec("select tipo, url, texto_es from pasos").toArray()).toEqual([
      { tipo: "instagram", url: "https://instagram.com/tinkazo", texto_es: "Seguinos" },
    ]);
    expect(m.sql.exec("select puesto, monto from premios order by puesto").toArray()).toEqual([
      { puesto: 1, monto: "400000000" },
      { puesto: 2, monto: "250000000" },
    ]);
    const bases = m.sql.exec("select documento, huella from bases").toArray();
    expect(bases).toHaveLength(1);
    const documento = JSON.parse(String(bases[0]!["documento"]));
    expect(bases[0]!["huella"]).toBe(c.huellaBases);
    expect(c.huellaBases).toBe(huellaDeBases(documento));
  });

  it("rechaza una configuración que no se lee y un cupo fuera de rango", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    const rota = campana() as Record<string, unknown>;
    rota["evento"] = "no vale";
    const mala = await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: rota } }), m.env as never);
    expect(mala.status).toBe(400);
    expect(await cuerpo(mala)).toMatchObject({ motivo: "campana", campo: "evento" });
    const sinCupo = await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: 0, organizadora: null, campana: campana() } }), m.env as never);
    expect(sinCupo.status).toBe(400);
    expect((await cuerpo(sinCupo))["motivo"]).toBe("cupo");
    expect(m.sql.exec("select * from campanas").toArray()).toHaveLength(0);
  });

  it("rechaza un secreto equivocado, una empresa sin secreto cargado y un evento repetido", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    const cuerpoAlta = { cupo: CUPO, organizadora: null, campana: campana() };
    expect((await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: OTRO_SECRETO, cuerpo: cuerpoAlta }), m.env as never)).status).toBe(401);
    expect((await trabajador.fetch(pedido("/v1/empresas/otra/campanas", { clave: OTRO_SECRETO, cuerpo: cuerpoAlta }), m.env as never)).status).toBe(503);
    expect((await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: cuerpoAlta }), m.env as never)).status).toBe(200);
    const repetida = await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana("e7k2m9") } }), m.env as never);
    expect(repetida.status).toBe(409);
    expect(m.sql.exec("select * from campanas").toArray()).toHaveLength(1);
  });
});

describe("GET /v1/campanas: el inventario", () => {
  it("lista la campaña con lo que el comprobante y las entregas necesitan", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), m.env as never);
    const r = await trabajador.fetch(pedido("/v1/campanas", { metodo: "GET" }), m.env as never);
    expect(r.status).toBe(200);
    const c = await cuerpo(r);
    expect(c.campanas).toEqual([
      {
        evento: "e7k2m9",
        empresa: id,
        red: "testnet",
        estado: "abierta",
        lugar: { es: "Feria de La Paz", en: "La Paz fair" },
        zona: "America/La_Paz",
        cupo: CUPO,
        anotadas: 37,
        organizadora: null,
        horas: { abreMs: T0 - 3_600_000, cierraMs: T0 + 3_600_000, sorteoMs: T0 + 7_200_000, recibirHastaMs: T0 + 86_400_000 },
        premios: [
          { puesto: 1, monto: "400000000" },
          { puesto: 2, monto: "250000000" },
        ],
        contrato: null,
        promo: null,
        huellaBases: expect.any(String),
      },
    ]);
  });

  it("sin campañas lista vacía", async () => {
    const m = montar();
    const r = await trabajador.fetch(pedido("/v1/campanas", { metodo: "GET" }), m.env as never);
    expect(r.status).toBe(200);
    expect(await cuerpo(r)).toEqual({ campanas: [] });
  });
});

describe("las bases publicadas y la invitación", () => {
  it("publica las bases armadas con los datos, con su huella", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), m.env as never);
    const r = await trabajador.fetch(pedido("/v1/campanas/e7k2m9/bases", { metodo: "GET" }), m.env as never);
    expect(r.status).toBe(200);
    const c = await cuerpo(r);
    expect(c.huella).toBe(huellaDeBases(c.documento));
    expect(c.documento).toMatchObject({ v: 1, evento: "e7k2m9", red: "testnet", empresa: "Empresa de ejemplo", zona: "America/La_Paz", texto: { es: "Bases del sorteo", en: "Contest rules" } });
    expect((await cuerpo(await trabajador.fetch(pedido("/v1/campanas/otro/bases", { metodo: "GET" }), m.env as never)))["motivo"]).toBe("no-existe");
  });

  it("la invitación a quien organiza lleva un enlace con el evento", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    const cuenta = Keypair.random().publicKey();
    await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: cuenta, campana: campana() } }), m.env as never);
    const r = await trabajador.fetch(pedido("/v1/campanas/e7k2m9/invitacion", { metodo: "GET" }), m.env as never);
    expect(r.status).toBe(200);
    expect(await cuerpo(r)).toEqual({ evento: "e7k2m9", organizadora: cuenta, enlace: "https://tinkazo.app/?campana=e7k2m9" });
    expect((await trabajador.fetch(pedido("/v1/campanas/otro/invitacion", { metodo: "GET" }), m.env as never)).status).toBe(404);
  });
});

describe("el informe de cierre", () => {
  it("cuenta cantidades, ganadoras y premios, sin la lista", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), m.env as never);
    const r = await trabajador.fetch(pedido("/v1/campanas/e7k2m9/informe", { metodo: "GET" }), m.env as never);
    expect(r.status).toBe(200);
    const c = await cuerpo(r);
    expect(c).toEqual({
      evento: "e7k2m9",
      estado: "abierta",
      cantidades: { anotadas: 37, cupo: CUPO },
      ganadoras: 2,
      premios: { cuantos: 2, recibidos: 0, porRecibir: 2 },
    });
    // Sin la lista: ningún campo lleva cuentas ni nombres.
    expect(JSON.stringify(c)).not.toMatch(/G[A-Z2-7]{55}/u);
    expect((await trabajador.fetch(pedido("/v1/campanas/otro/informe", { metodo: "GET" }), m.env as never)).status).toBe(404);
  });
});

describe("el enlace de servicio hacia comisiones", () => {
  it("avisa solo el cupo, las horas y el estado que decide el alta", async () => {
    const m = montar({ COMISIONES_URL: "https://pm.tinkazo.app/v1/campanas/alta", COMISIONES_SECRETO: "c".repeat(40) });
    const id = await empresaNueva(m);
    const r = await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), m.env as never);
    expect(r.status).toBe(200);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.url).toBe("https://pm.tinkazo.app/v1/campanas/alta");
    expect((avisos[0]!.init!.headers as Record<string, string>)["Authorization"]).toBe(`Bearer ${"c".repeat(40)}`);
    const mandado = JSON.parse(String(avisos[0]!.init!.body));
    // Solo lo que decide el alta: nada de la configuración, los premios ni los pasos.
    expect(mandado).toEqual({
      evento: "e7k2m9",
      empresa: id,
      cupo: CUPO,
      horas: { abreMs: T0 - 3_600_000, cierraMs: T0 + 3_600_000, sorteoMs: T0 + 7_200_000, recibirHastaMs: T0 + 86_400_000 },
      estado: "abierta",
    });
    expect(Object.keys(mandado)).toEqual(["evento", "empresa", "cupo", "horas", "estado"]);
  });

  it("sin enlace configurado no llama a nadie, y un aviso que falla no tumba el alta", async () => {
    const m = montar();
    const id = await empresaNueva(m);
    expect((await trabajador.fetch(pedido(`/v1/empresas/${id}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), m.env as never)).status).toBe(200);
    expect(avisos).toHaveLength(0);
    const roto = montar({ COMISIONES_URL: "https://pm.tinkazo.app/v1/campanas/alta" });
    const idRoto = await empresaNueva(roto);
    vi.stubGlobal("fetch", () => Promise.reject(new Error("red")));
    expect((await trabajador.fetch(pedido(`/v1/empresas/${idRoto}/campanas`, { clave: SECRETO, cuerpo: { cupo: CUPO, organizadora: null, campana: campana() } }), roto.env as never)).status).toBe(200);
    expect(roto.sql.exec("select * from campanas").toArray()).toHaveLength(1);
    vi.stubGlobal("fetch", fetchDeMentira);
  });
});

describe("la segunda empresa, cargada sin tocar código", () => {
  it("otra empresa y su campaña entran por la misma API, y un secreto no abre la puerta ajena", async () => {
    const m = montar();
    const idA = await empresaNueva(m, SECRETO);
    const idB = await empresaNueva(m, OTRO_SECRETO);
    const altaA = { cupo: 100, organizadora: null, campana: campana("evento-a") };
    const altaB = { cupo: 200, organizadora: null, campana: campana("evento-b") };
    expect((await trabajador.fetch(pedido(`/v1/empresas/${idA}/campanas`, { clave: SECRETO, cuerpo: altaA }), m.env as never)).status).toBe(200);
    // El secreto de A no carga la campaña de B: cada empresa abre solo la suya.
    expect((await trabajador.fetch(pedido(`/v1/empresas/${idB}/campanas`, { clave: SECRETO, cuerpo: altaB }), m.env as never)).status).toBe(401);
    expect((await trabajador.fetch(pedido(`/v1/empresas/${idB}/campanas`, { clave: OTRO_SECRETO, cuerpo: altaB }), m.env as never)).status).toBe(200);
    const inventario = await cuerpo(await trabajador.fetch(pedido("/v1/campanas", { metodo: "GET" }), m.env as never));
    expect((inventario.campanas as Array<Record<string, unknown>>).map((c) => c.evento)).toEqual(["evento-a", "evento-b"]);
    expect((inventario.campanas as Array<Record<string, unknown>>).map((c) => c.empresa)).toEqual([idA, idB]);
  });
});

describe("las rutas que no existen", () => {
  it("un camino desconocido da 404 y un método equivocado, 405", async () => {
    const m = montar();
    expect((await trabajador.fetch(pedido("/v1/otra/cosa"), m.env as never)).status).toBe(404);
    expect((await trabajador.fetch(pedido("/v1/campanas", { metodo: "DELETE" }), m.env as never)).status).toBe(405);
  });
});
