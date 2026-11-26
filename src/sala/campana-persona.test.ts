import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listHash } from "../protocol/canonical";
import { leerTextoDeCampana, listaDeLaCampana } from "../../workers/sala/src/campana";
import { URL_DE_LLAVES_DE_GOOGLE } from "../../workers/sala/src/identidad-google";
import { esLineaDePersona, lineaDePersona } from "../../workers/sala/src/linea-persona";
import { clienteDeGoogle, personasPrendido, venceDelToken } from "../../workers/sala/src/personas";
import { Keypair } from "@stellar/stellar-sdk/base";
import { HORA_DE_LA_PRUEBA, montarMundoDeActivar } from "./activar-mundo";
import {
  campanaAbierta,
  campanaDePrueba,
  firmarParaLaPrueba,
  montarMundo,
  sesionDePrueba,
  type MundoDeSala,
  type SalaDeCampana,
} from "./mundo-sala";

vi.mock("cloudflare:workers", async () => await import("./cloudflare-falso"));

/** Lo que el Worker lee del contrato: lo cambia cada prueba. */
const lectura = vi.hoisted(() => ({ valor: null as unknown }));
vi.mock("../../workers/sala/src/cadena", () => ({ leerSorteoEnLaRed: async () => lectura.valor }));

/**
 * Anotarse sin billetera: una campaña con "identidad": "persona" anota a quien entra con Google sin preguntarle nada al
 * proveedor de cuentas. La sala verifica sola el token de identidad, que acá se firma con una llave RSA de prueba, y sella una
 * línea por persona en lugar de una cuenta. Nada llama a Google ni al proveedor de verdad.
 */
const AHORA = Date.UTC(2026, 10, 25, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const RONDA = 40_000_000;
const SORTEO = "123456789";
const COMPROBANTE = "/verificar.html?x=1";
const sub = (n: number): string => `10000000000000000000${n}`;
const correo = (n: number): string => `persona${n}@example.org`;
const llaveDe = (n: number, celular = 1): string => `celular${n}-${celular}`.padEnd(22, "x");

interface Par {
  kid: string;
  privada: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

async function nuevoPar(kid: string): Promise<Par> {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  return { kid, privada: par.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } as Par["jwk"] };
}

let google: Par;
let desconocida: Par;
let intrusa: Par;

beforeAll(async () => {
  [google, desconocida, intrusa] = await Promise.all([nuevoPar("llave-1"), nuevoPar("llave-2"), nuevoPar("llave-1")]);
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const aTexto = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));

interface Pedido {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  par?: Par;
}

/** Un token de identidad de Google de la persona `n`, firmado con la llave de prueba. */
async function tokenDeGoogle(n: number, p: Pedido = {}): Promise<string> {
  const par = p.par ?? google;
  const cuerpo = {
    iss: "https://accounts.google.com",
    aud: CLIENTE,
    sub: sub(n),
    email: correo(n),
    email_verified: true,
    iat: AHORA / 1000 - 10,
    exp: AHORA / 1000 + 3000,
    ...p.payload,
  };
  const entrada = `${aTexto({ alg: "RS256", typ: "JWT", kid: par.kid, ...p.header })}.${aTexto(cuerpo)}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", par.privada, new TextEncoder().encode(entrada)));
  return `${entrada}.${b64(firma)}`;
}

/** Lo que publica Google: las llaves y si contesta. */
interface GoogleFalso {
  llaves: Par[];
  caido: boolean;
  pedidos: number;
}

/** El Worker de la sala con los interruptores prendidos y un Google de mentira detrás del `fetch`. */
async function montarPersonas(extra: Record<string, string> = {}): Promise<{ mundo: MundoDeSala; google: GoogleFalso }> {
  const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, ...extra });
  const falso: GoogleFalso = { llaves: [google], caido: false, pedidos: 0 };
  const delResto = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url) === URL_DE_LLAVES_DE_GOOGLE) {
      falso.pedidos++;
      if (falso.caido) return new Response("{}", { status: 503 });
      return new Response(JSON.stringify({ keys: falso.llaves.map((l) => l.jwk) }), {
        status: 200,
        headers: { "cache-control": "public, max-age=3600" },
      });
    }
    return delResto(url, init);
  });
  return { mundo, google: falso };
}

const auth = (sala: SalaDeCampana): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
const ruta = (sala: SalaDeCampana, resto: string): string => `/v1/sala/${sala.id}${resto}`;

/** El alta de una persona con su token de Google. */
function altaGoogle(
  mundo: MundoDeSala,
  sala: SalaDeCampana,
  token: string,
  extra: { llave?: string; ip?: string; cuerpo?: Record<string, unknown> } = {},
): Promise<Response> {
  return mundo.pedir(ruta(sala, "/campana/alta"), {
    cuerpo: { google: token, d: "A".repeat(60), llave: extra.llave ?? llaveDe(1), ...extra.cuerpo },
    cabeceras: { "CF-Connecting-IP": extra.ip ?? "190.129.10.20" },
  });
}

const yoPorLlave = (mundo: MundoDeSala, sala: SalaDeCampana, llave: string): Promise<Response> =>
  mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { llave } });

/** Lo que la sala guarda de una sala: todas sus tablas, fila por fila, en un solo texto. */
function todoLoGuardado(mundo: MundoDeSala, sala: SalaDeCampana): string {
  const objeto = `sala:${sala.id}`;
  const tablas = mundo.ejecutar(objeto, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => String(t.name));
  return JSON.stringify(tablas.map((t) => [t, mundo.ejecutar(objeto, `SELECT * FROM ${t}`)]));
}

/** La sal de la campaña y la línea que le toca a la persona `n`. */
async function lineaDe(mundo: MundoDeSala, sala: SalaDeCampana, n: number): Promise<string> {
  const sal = String(mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'sal-campana'")[0]?.v);
  return lineaDePersona(sal, `google:${sub(n)}`);
}

const filas = (mundo: MundoDeSala, sala: SalaDeCampana): { n: number; cuenta: string; llave: string }[] =>
  mundo.ejecutar(`sala:${sala.id}`, "SELECT n, cuenta, llave FROM equipos ORDER BY n") as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el campo de identidad del texto firmado", () => {
  const lee = (cambios: Record<string, unknown>) => leerTextoDeCampana(JSON.stringify(campanaDePrueba(AHORA, cambios)), AHORA);

  it("ausente o cuenta es el modo de siempre y la lectura no cambia", () => {
    const sin = lee({});
    expect(sin).toEqual({
      ok: true,
      evento: "feria-del-libro",
      red: "testnet",
      cierraMs: AHORA + 3_600_000,
      sorteoMs: AHORA + 7_200_000,
      premios: 2,
      organizadora: null,
    });
    expect(lee({ identidad: "cuenta" })).toEqual(sin);
  });

  it("persona es el modo nuevo", () => {
    expect(lee({ identidad: "persona" })).toMatchObject({ ok: true, identidad: "persona" });
  });

  it("cualquier otro valor se lee como siempre: un campo que la lectura no conoce no la cambia", () => {
    const sin = lee({});
    for (const valor of ["Persona", "personas", "otra", "", " persona", null, 1, true, ["persona"], { modo: "persona" }]) {
      expect(lee({ identidad: valor }), JSON.stringify(valor)).toEqual(sin);
    }
  });
});

describe("los interruptores", () => {
  it("la variable DIFERIDA y el identificador de Google, los dos, prenden las campañas de personas", () => {
    expect(personasPrendido({})).toBe(false);
    expect(personasPrendido({ DIFERIDA: "1" })).toBe(false);
    expect(personasPrendido({ DIFERIDA: "1", GOOGLE_CLIENT_ID: "" })).toBe(false);
    expect(personasPrendido({ DIFERIDA: "1", GOOGLE_CLIENT_ID: "   " })).toBe(false);
    expect(personasPrendido({ DIFERIDA: "0", GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
    expect(personasPrendido({ DIFERIDA: "si", GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
    expect(personasPrendido({ GOOGLE_CLIENT_ID: CLIENTE })).toBe(false);
    expect(personasPrendido({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE })).toBe(true);
    expect(clienteDeGoogle({ GOOGLE_CLIENT_ID: ` ${CLIENTE} ` })).toBe(CLIENTE);
  });

  it("el archivo de la sala los trae apagados", () => {
    const toml = readFileSync(join(process.cwd(), "workers", "sala", "wrangler.toml"), "utf8");
    const lineas = toml.split(/\r?\n/);
    expect(lineas.filter((l) => /^\s*DIFERIDA\s*=/.test(l))).toEqual(['DIFERIDA = "0"']);
    expect(lineas.filter((l) => /^\s*GOOGLE_CLIENT_ID\s*=/.test(l))).toEqual(['GOOGLE_CLIENT_ID = ""']);
  });

  it("antes de un evento se puede preguntar a la sala si está prendida y con qué identificador de Google, que es público", async () => {
    const apagada = await montarMundo();
    const a = await apagada.pedir("/v1/personas/estado");
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ prendido: false, cliente: "" });
    const { mundo } = await montarPersonas();
    const p = await mundo.pedir("/v1/personas/estado");
    expect(await p.json()).toEqual({ prendido: true, cliente: CLIENTE });
    expect((await mundo.pedir("/v1/personas/estado", { metodo: "POST", cuerpo: {} })).status).toBe(404);
    expect((await mundo.pedir("/v1/personas/estado", { metodo: "OPTIONS" })).status).toBe(204);
  });

  it("el estado público de una campaña de cuentas no hace una lectura de más para decir que es de cuentas", async () => {
    const { mundo } = await montarPersonas();
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const objeto = mundo.sala(cuentas.id) as unknown as { ctx: { storage: { sql: { exec: (...a: unknown[]) => unknown } } } };
    const exec = vi.spyOn(objeto.ctx.storage.sql, "exec");
    for (let i = 0; i < 5; i++) expect((await mundo.pedir(ruta(cuentas, "/campana/estado"))).status).toBe(200);
    const lecturas = exec.mock.calls.filter((c) => String(c[0]).includes("k = 'identidad'"));
    expect(lecturas.length).toBeLessThanOrEqual(1);
  });

  it("el vencimiento de un token sale de su propio campo, y sin él no se recuerda", async () => {
    const t = await tokenDeGoogle(1);
    expect(venceDelToken(t, AHORA)).toBe(AHORA + 3_000_000);
    expect(venceDelToken(await tokenDeGoogle(1, { payload: { exp: AHORA / 1000 - 5 } }), AHORA)).toBe(AHORA);
    expect(venceDelToken("no es un token", AHORA)).toBe(AHORA);
    expect(venceDelToken("a.@@@.c", AHORA)).toBe(AHORA);
  });
});

describe("crear una campaña de personas", () => {
  const archivo = (mundo: MundoDeSala, cambios: Record<string, unknown> = {}) =>
    firmarParaLaPrueba(mundo.llavePrivada, campanaDePrueba(AHORA, cambios));

  it("con algún interruptor apagado la sala la rechaza con un motivo fijo, y no gasta el evento", async () => {
    const apagados: Record<string, string>[] = [{}, { DIFERIDA: "0", GOOGLE_CLIENT_ID: CLIENTE }, { DIFERIDA: "1" }, { DIFERIDA: "1", GOOGLE_CLIENT_ID: "  " }, { GOOGLE_CLIENT_ID: CLIENTE }];
    for (const extra of apagados) {
      const mundo = await montarMundo(extra);
      const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, { identidad: "persona" }) });
      expect(r.status, JSON.stringify(extra)).toBe(503);
      expect(await r.json()).toEqual({ error: "personas-apagadas" });
      // El mismo evento sigue libre: la campaña de siempre se crea.
      expect((await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo) })).status).toBe(201);
    }
  });

  it("con los dos prendidos la crea, y la sala guarda el modo", async () => {
    const { mundo } = await montarPersonas();
    const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, { identidad: "persona" }) });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'identidad'")).toEqual([{ v: "persona" }]);
  });

  it("una campaña de cuentas, con el campo o sin él, no deja ninguna marca de más en la sala", async () => {
    const { mundo } = await montarPersonas();
    for (const [evento, cambios] of [["feria-a", {}], ["feria-b", { identidad: "cuenta" }]] as const) {
      const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, { evento, ...cambios }) });
      expect(r.status).toBe(201);
      const { id } = (await r.json()) as { id: string };
      expect(mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'identidad'")).toEqual([]);
    }
  });

  it("un valor que no es persona crea la campaña de siempre, con los interruptores como estén", async () => {
    const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }];
    for (const extra of interruptores) {
      const mundo = await montarMundo(extra);
      let n = 0;
      for (const valor of ["otra", "", null, 1]) {
        const r = await mundo.pedir("/v1/campana", { cuerpo: archivo(mundo, { evento: `feria-${++n}`, identidad: valor }) });
        expect(r.status, `${JSON.stringify(valor)} ${JSON.stringify(extra)}`).toBe(201);
        const { id } = (await r.json()) as { id: string };
        expect(mundo.ejecutar(`sala:${id}`, "SELECT v FROM sala WHERE k = 'identidad'")).toEqual([]);
      }
    }
  });
});

describe("el alta de una persona con Google", () => {
  let mundo: MundoDeSala;
  let falso: GoogleFalso;
  let sala: SalaDeCampana;
  let consola: { mock: { calls: unknown[][] } };

  async function montar(extra: Record<string, string> = {}, cambios: Record<string, unknown> = {}): Promise<void> {
    ({ mundo, google: falso } = await montarPersonas(extra));
    sala = await campanaAbierta(mundo, AHORA, { identidad: "persona", ...cambios });
  }

  beforeEach(async () => {
    consola = vi.spyOn(console, "log");
    await montar();
  });

  it("anota la línea de la persona y contesta solo que quedó anotada", async () => {
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1));
    expect(r.status).toBe(201);
    const texto = await r.text();
    expect(JSON.parse(texto)).toEqual({ anotada: true });
    expect(texto).not.toContain("p1:");
    const linea = await lineaDe(mundo, sala, 1);
    expect(esLineaDePersona(linea)).toBe(true);
    expect(filas(mundo, sala).map((f) => f.cuenta)).toEqual([linea]);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT cuenta FROM personas")).toEqual([{ cuenta: linea }]);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'via-google'")).toEqual([{ v: "1" }]);
  });

  it("no le pregunta nada al proveedor de cuentas y nunca contesta sin billetera", async () => {
    for (let n = 1; n <= 3; n++) {
      const r = await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n) });
      expect(r.status).toBe(201);
      expect(JSON.stringify(await r.json())).not.toContain("sin-billetera");
    }
    expect(mundo.proveedor.llamadas).toEqual({});
    expect(mundo.proveedor.busquedas).toEqual([]);
    // Las llaves de Google se piden una vez y se recuerdan.
    expect(falso.pedidos).toBe(1);
  });

  it("la misma cuenta de Google no entra dos veces: ni con el mismo token ni con otro", async () => {
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1))).status).toBe(201);
    const mismo = await altaGoogle(mundo, sala, await tokenDeGoogle(1));
    expect(mismo.status).toBe(200);
    expect(await mismo.json()).toEqual({ anotada: true, ya: true });
    // Un token nuevo de la misma cuenta, otro minuto: la ficha ya no es la recordada y se verifica de nuevo.
    vi.setSystemTime(AHORA + 120_000);
    const otro = await altaGoogle(mundo, sala, await tokenDeGoogle(1, { payload: { iat: AHORA / 1000 + 100 } }));
    expect(otro.status).toBe(200);
    expect(await otro.json()).toEqual({ anotada: true, ya: true });
    expect(filas(mundo, sala)).toHaveLength(1);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM personas")).toEqual([{ c: 1 }]);
  });

  it("la misma cuenta desde otro celular tampoco entra dos veces, y el celular nuevo pasa a ser el suyo", async () => {
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1), { llave: llaveDe(1, 1) })).status).toBe(201);
    vi.setSystemTime(AHORA + 120_000);
    const otro = await altaGoogle(mundo, sala, await tokenDeGoogle(1, { payload: { iat: AHORA / 1000 + 100 } }), {
      llave: llaveDe(1, 2),
      ip: "190.129.10.99",
    });
    expect(otro.status).toBe(200);
    expect(await otro.json()).toEqual({ anotada: true, ya: true });
    expect(filas(mundo, sala)).toHaveLength(1);
    expect(await (await yoPorLlave(mundo, sala, llaveDe(1, 2))).json()).toMatchObject({ anotada: true });
    expect(await (await yoPorLlave(mundo, sala, llaveDe(1, 1))).json()).toMatchObject({ anotada: false });
  });

  it("dos personas son dos líneas, y la lista que se sella sale ordenada como texto", async () => {
    for (const n of [2, 1, 3]) expect((await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n) })).status).toBe(201);
    const lineas = await Promise.all([1, 2, 3].map((n) => lineaDe(mundo, sala, n)));
    expect(new Set(lineas).size).toBe(3);
    expect(filas(mundo, sala).map((f) => f.cuenta).sort()).toEqual([...lineas].sort());
    const estado = await (await mundo.pedir(ruta(sala, "/campana/estado"))).json();
    expect(estado).toMatchObject({ total: 3 });
  });

  it("un token malo, de cada tipo, no anota a nadie", async () => {
    const buenoSinFirma = (await tokenDeGoogle(1)).split(".").slice(0, 2).join(".");
    const [h, c] = (await tokenDeGoogle(1)).split(".") as [string, string, string];
    const casos: [string, string, number][] = [
      ["otro emisor", await tokenDeGoogle(1, { payload: { iss: "https://otro.example.org" } }), 401],
      ["correo sin verificar", await tokenDeGoogle(1, { payload: { email_verified: false } }), 401],
      ["firmado por otra llave", await tokenDeGoogle(1, { par: intrusa }), 401],
      ["con una llave que Google no publica", await tokenDeGoogle(1, { par: desconocida }), 401],
      ["algoritmo cambiado a none", await tokenDeGoogle(1, { header: { alg: "none" } }), 401],
      ["algoritmo cambiado a HS256", await tokenDeGoogle(1, { header: { alg: "HS256" } }), 401],
      ["cuerpo cambiado después de firmar", `${h}.${aTexto({ iss: "https://accounts.google.com", aud: CLIENTE, sub: sub(7), email: correo(7), email_verified: true, exp: AHORA / 1000 + 3000 })}.${(await tokenDeGoogle(1)).split(".")[2]}`, 401],
      ["con un token del proveedor de cuentas", sesionDePrueba("usuario1"), 401],
      ["sin firma", `${buenoSinFirma}.`, 400],
      ["sin las tres partes", `${h}.${c}`, 400],
      ["vencido", await tokenDeGoogle(1, { payload: { exp: AHORA / 1000 - 60 } }), 400],
      ["que no es un token", "esto-no-es-un-token-de-nadie", 401],
    ];
    for (const [nombre, token, estado] of casos) {
      const r = await altaGoogle(mundo, sala, token);
      expect(r.status, nombre).toBe(estado);
      expect(await r.json(), nombre).toEqual(estado === 401 ? { error: "sesion" } : { error: "forma" });
    }
    expect(filas(mundo, sala)).toEqual([]);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM personas")).toEqual([{ c: 0 }]);
    // Una persona de verdad todavía entra: los rechazos no la dejaron afuera.
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1))).status).toBe(201);
  });

  it("que no sea un texto el campo de Google no es un alta de personas: sigue siendo un pedido sin forma", async () => {
    const r = await mundo.pedir(ruta(sala, "/campana/alta"), { cuerpo: { google: 5, d: "A".repeat(60), llave: llaveDe(1) } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
  });

  it("los datos del pedido tienen que tener forma, como en una campaña de cuentas", async () => {
    const t = await tokenDeGoogle(1);
    const malos: Record<string, unknown>[] = [{ d: "corto" }, { llave: "corta" }, { p: "no vale!" }, { d: undefined }, { llave: undefined }];
    for (const cuerpo of malos) {
      const r = await altaGoogle(mundo, sala, t, { cuerpo });
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect(await r.json()).toEqual({ error: "forma" });
    }
    const ajeno = await mundo.pedir(ruta(sala, "/campana/alta"), {
      cuerpo: { google: t, d: "A".repeat(60), llave: llaveDe(1) },
      cabeceras: { Origin: "https://otro.example.org" },
    });
    expect(ajeno.status).toBe(403);
    expect(filas(mundo, sala)).toEqual([]);
  });

  it("Google sin contestar da un error que se repite, no un rechazo de la persona", async () => {
    falso.caido = true;
    const t = await tokenDeGoogle(1);
    const r = await altaGoogle(mundo, sala, t);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "google" });
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM campana_rechazos_ficha")).toEqual([{ c: 0 }]);
    falso.caido = false;
    vi.setSystemTime(AHORA + 4_000);
    expect((await altaGoogle(mundo, sala, t)).status).toBe(201);
  });

  it("una ficha mala repetida se frena sin volver a verificar", async () => {
    const malo = await tokenDeGoogle(1, { payload: { email_verified: false } });
    const estados: number[] = [];
    for (let i = 0; i < 7; i++) estados.push((await altaGoogle(mundo, sala, malo)).status);
    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados.slice(5)).toEqual([429, 429]);
  });

  it("el pase del QR vale igual que en una campaña de cuentas", async () => {
    await montar({ PASE: "1" });
    const t = await tokenDeGoogle(1);
    const sinPase = await altaGoogle(mundo, sala, t);
    expect(sinPase.status).toBe(409);
    expect(await sinPase.json()).toEqual({ error: "pase" });
    const equivocado = await altaGoogle(mundo, sala, t, { cuerpo: { p: "AAAAAAAAAAAA" } });
    expect(equivocado.status).toBe(409);
    const { p } = (await (await mundo.pedir(ruta(sala, "/campana/pase"), { cabeceras: auth(sala) })).json()) as { p: string };
    const bien = await altaGoogle(mundo, sala, t, { cuerpo: { p } });
    expect(bien.status).toBe(201);
    expect(filas(mundo, sala)).toHaveLength(1);
  });

  it("la fase y la hora de cierre mandan: con la lista cerrada, o pasada la hora, no entra nadie", async () => {
    expect((await mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth(sala) })).status).toBe(204);
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1));
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "cerrada" });
    await montar();
    vi.setSystemTime(AHORA + 3_600_000 + 1);
    const tarde = await altaGoogle(mundo, sala, await tokenDeGoogle(1, { payload: { exp: AHORA / 1000 + 9000 } }));
    expect(tarde.status).toBe(409);
    expect(await tarde.json()).toEqual({ error: "cerrada" });
    expect(filas(mundo, sala)).toEqual([]);
  });

  it("la sala llena no recibe a nadie más", async () => {
    for (let i = 0; i < 300; i++) {
      mundo.ejecutar(`sala:${sala.id}`, "INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, 'x', 'aceptado', ?, ?)", `p1:relleno${i}`, i + 1, `llave${i}`);
    }
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "llena" });
  });

  it("con el interruptor apagado después de crear la campaña no entra nadie nuevo, pero quien ya se anotó sigue viendo su estado", async () => {
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1))).status).toBe(201);
    mundo.env.DIFERIDA = "0";
    const alta = await altaGoogle(mundo, sala, await tokenDeGoogle(2), { llave: llaveDe(2) });
    expect(alta.status).toBe(503);
    expect(await alta.json()).toEqual({ error: "personas-apagadas" });
    // La consulta propia es de solo lectura: apagar el modo en pleno evento no deja a nadie sin saber si ganó.
    const yo = await yoPorLlave(mundo, sala, llaveDe(1));
    expect(yo.status).toBe(200);
    expect(await yo.json()).toMatchObject({ anotada: true });
    expect(filas(mundo, sala)).toHaveLength(1);
    // Lo que no es de las personas sigue como siempre: el estado público.
    expect((await mundo.pedir(ruta(sala, "/campana/estado"))).status).toBe(200);
  });

  it("el alta con el token del proveedor de cuentas no sirve en una campaña de personas, y no le pregunta nada", async () => {
    const t = sesionDePrueba("usuario1");
    mundo.proveedor.sesiones.set(t, { usuario: "usuario1", contenido: { wallet: Keypair.random().publicKey() } });
    const r = await mundo.pedir(ruta(sala, "/campana/alta"), { cuerpo: { token: t, d: "A".repeat(60), llave: llaveDe(1) } });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
    expect(mundo.proveedor.llamadas).toEqual({});
    expect(filas(mundo, sala)).toEqual([]);
  });

  it("el alta con Google no sirve en una campaña de cuentas: es un pedido sin forma, como siempre", async () => {
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const r = await altaGoogle(mundo, cuentas, await tokenDeGoogle(1));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
    expect(filas(mundo, cuentas)).toEqual([]);
    expect(falso.pedidos).toBe(0);
    // Una sala que no existe (cerrada, vencida o nunca creada) contesta lo mismo que una de cuentas: un pedido sin forma, como siempre.
    const nada = await mundo.pedir("/v1/sala/AbCdEf12/campana/alta", { cuerpo: { google: await tokenDeGoogle(1), d: "A".repeat(60), llave: llaveDe(1) } });
    expect(nada.status).toBe(400);
    expect(await nada.json()).toEqual({ error: "forma" });
  });

  it("una sala que se cerró contesta el alta de personas como cualquier sala sin ese modo: un pedido sin forma", async () => {
    const cerrada = await mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: auth(sala) });
    expect(cerrada.status).toBe(204);
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
    // El celular se entera por el estado público, que sigue diciendo que la sala no existe.
    expect((await mundo.pedir(ruta(sala, "/campana/estado"))).status).toBe(404);
  });

  it("un token de otra aplicación de Google es un error de configuración nuestro: no es un rechazo de la persona y no cuenta en ningún tope", async () => {
    const ajeno = await tokenDeGoogle(1, { payload: { aud: "otro-cliente.apps.example.org" } });
    for (let i = 0; i < 12; i++) {
      const r = await altaGoogle(mundo, sala, ajeno);
      expect(r.status).toBe(503);
      expect(await r.json()).toEqual({ error: "personas-configuracion" });
    }
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM campana_rechazos_ficha")).toEqual([{ c: 0 }]);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM campana_rechazos")).toEqual([{ c: 0 }]);
    // Queda dicho en el registro, con el motivo fijo, para quien opera.
    expect(consola.mock.calls.map((c) => String(c[0])).join("\n")).toContain('"motivo":"audiencia"');
    // Y con el identificador bien puesto la persona entra, ya sin ficha gastada.
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1))).status).toBe(201);
  });

  it("quien manda cientos de tokens malos no deja afuera a los demás de la misma conexión", async () => {
    // Todo el salón sale por una dirección. La verificación es local y no cuesta nada: los rechazos frenan a quien los manda (su ficha), nunca a otros.
    for (let n = 100; n < 410; n++) {
      const r = await altaGoogle(mundo, sala, await tokenDeGoogle(n, { payload: { email_verified: false } }), { llave: llaveDe(n) });
      expect(r.status).toBe(401);
    }
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM campana_rechazos")).toEqual([{ c: 0 }]);
    for (let n = 1; n <= 3; n++) {
      const r = await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n) });
      expect(r.status, `persona ${n}`).toBe(201);
    }
  }, 60_000);

  it("nada que identifique a la persona queda guardado, se contesta o se escribe en un registro", async () => {
    const dicho: string[] = [];
    const tokens: string[] = [];
    const pantalla = mundo.agregarSocket(sala.id, true);
    for (const n of [1, 2]) {
      const t = await tokenDeGoogle(n);
      tokens.push(t);
      dicho.push(await (await altaGoogle(mundo, sala, t, { llave: llaveDe(n) })).text());
    }
    dicho.push(await (await altaGoogle(mundo, sala, tokens[0] as string)).text());
    dicho.push(await (await altaGoogle(mundo, sala, await tokenDeGoogle(3, { payload: { aud: "otro" } }))).text());
    dicho.push(await (await yoPorLlave(mundo, sala, llaveDe(1))).text());
    dicho.push(await (await mundo.pedir(ruta(sala, "/campana/estado"), { cabeceras: auth(sala) })).text());
    dicho.push(await (await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })).text());
    await mundo.esperarSegundoPlano();
    const todo = [todoLoGuardado(mundo, sala), ...dicho, JSON.stringify(consola.mock.calls), ...pantalla.mensajes].join("\n");
    for (const n of [1, 2, 3]) {
      for (const secreto of [sub(n), correo(n), `google:${sub(n)}`, `persona${n}@`]) expect(todo, secreto).not.toContain(secreto);
    }
    for (const t of tokens) {
      expect(todo).not.toContain(t);
      for (const parte of t.split(".")) expect(todo).not.toContain(parte);
    }
    // Lo que sí circula es la línea, que quien organiza ve como ve hoy una cuenta.
    expect(pantalla.mensajes.join("")).toContain("p1:");
    expect(consola.mock.calls.map((c) => String(c[0])).join("\n")).toContain('"evento":"google-rechazado","datos":{"motivo":"audiencia"}');
  });

  it("la misma persona tiene otra línea en otra campaña: no se la puede seguir de una a otra", async () => {
    const otra = await campanaAbierta(mundo, AHORA, { identidad: "persona", evento: "otra-feria" });
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1))).status).toBe(201);
    expect((await altaGoogle(mundo, otra, await tokenDeGoogle(1))).status).toBe(201);
    const aqui = filas(mundo, sala)[0]?.cuenta;
    const alla = filas(mundo, otra)[0]?.cuenta;
    expect(esLineaDePersona(aqui) && esLineaDePersona(alla)).toBe(true);
    expect(aqui).not.toBe(alla);
  });
});

describe("la consulta propia con la llave sola", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;

  beforeEach(async () => {
    ({ mundo } = await montarPersonas());
    sala = await campanaAbierta(mundo, AHORA, { identidad: "persona" });
    for (const n of [1, 2]) expect((await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n) })).status).toBe(201);
  });

  it("quien tiene la llave de su celular ve que está anotada, sin ninguna cuenta, línea ni número", async () => {
    const r = await yoPorLlave(mundo, sala, llaveDe(1));
    expect(r.status).toBe(200);
    const cuerpo = (await r.json()) as Record<string, unknown>;
    expect(cuerpo).toEqual({ fase: "abierta", total: 2, cierraMs: AHORA + 3_600_000, anotada: true });
  });

  it("quien no tiene la llave de nadie ve solo lo público", async () => {
    const r = await yoPorLlave(mundo, sala, llaveDe(9));
    expect(await r.json()).toEqual({ fase: "abierta", total: 2, cierraMs: AHORA + 3_600_000, anotada: false });
  });

  it("sin llave o con una llave sin forma es un pedido sin forma", async () => {
    for (const cuerpo of [{}, { llave: "corta" }, { llave: 5 }, null]) {
      const r = await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo });
      expect(r.status, JSON.stringify(cuerpo)).toBe(400);
      expect(await r.json()).toEqual({ error: "forma" });
    }
  });

  it("en una campaña de cuentas la llave sola no alcanza, como siempre", async () => {
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const r = await yoPorLlave(mundo, cuentas, llaveDe(1));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "forma" });
  });

  it("en una sala que no existe o se cerró, la consulta propia contesta lo de siempre: un pedido sin forma", async () => {
    const nada = await yoPorLlave(mundo, { id: "AbCdEf12", token: "x" }, llaveDe(1));
    expect(nada.status).toBe(400);
    expect(await nada.json()).toEqual({ error: "forma" });
    const cerrada = await mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: auth(sala) });
    expect(cerrada.status).toBe(204);
    expect((await yoPorLlave(mundo, sala, llaveDe(1))).status).toBe(400);
  });

  it("con una cuenta y su llave, el camino de siempre sigue contestando", async () => {
    const r = await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { cuenta: Keypair.random().publicKey(), llave: llaveDe(1) } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ anotada: false });
  });
});

describe("quitar, cerrar, sellar, sortear y el resultado con líneas de persona", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let lineas: string[];

  const poner = (fase: string): Promise<Response> =>
    mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase }, cabeceras: auth(sala) });
  const avisar = (cuenta: unknown, cabeceras: Record<string, string> = auth(sala)): Promise<Response> =>
    mundo.pedir(ruta(sala, "/campana/avisar"), { cuerpo: { cuenta }, cabeceras });

  beforeEach(async () => {
    ({ mundo } = await montarPersonas({ CORREO_GANADORAS: "1", CORREO_DE: "sorteos@example.org" }));
    mundo.env.CORREO = { send: vi.fn(async () => ({ messageId: "m" })) };
    sala = await campanaAbierta(mundo, AHORA, { identidad: "persona" });
    for (const n of [1, 2, 3, 4]) expect((await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n) })).status).toBe(201);
    lineas = await Promise.all([1, 2, 3, 4].map((n) => lineaDe(mundo, sala, n)));
  });

  /** Quita a la persona 4 por su fila, cierra y sella con las tres que quedan. */
  async function quitarYSellar(): Promise<string[]> {
    const lista = await (await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })).json() as { n: number; cuenta: string }[];
    expect(lista.map((f) => f.cuenta).sort()).toEqual([...lineas].sort());
    const n4 = lista.find((f) => f.cuenta === lineas[3])?.n;
    const quitada = await mundo.pedir(ruta(sala, "/campana/quitar"), { cuerpo: { n: n4, motivo: "repetida" }, cabeceras: auth(sala) });
    expect(quitada.status).toBe(204);
    expect((await poner("cerrada")).status).toBe(204);
    const orden = listaDeLaCampana(lineas.slice(0, 3));
    const sello = { listHash: Buffer.from(listHash(orden)).toString("hex"), count: 3, numWinners: 2, sorteado: false, organizador: null, ronda: RONDA };
    lectura.valor = { sello, ganadores: null };
    const sellada = await mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase: "sellada", sorteo: SORTEO }, cabeceras: auth(sala) });
    expect(sellada.status).toBe(204);
    lectura.valor = { sello: { ...sello, sorteado: true }, ganadores: [2, 0] };
    return orden;
  }

  it("quitar a alguien por su fila lo saca de la lista y no lo deja volver, ni desde otro celular", async () => {
    await quitarYSellar();
    expect(filas(mundo, sala).map((f) => f.cuenta).sort()).toEqual([...lineas.slice(0, 3)].sort());
    vi.setSystemTime(AHORA + 1000);
    const vuelve = await altaGoogle(mundo, sala, await tokenDeGoogle(4, { payload: { iat: AHORA / 1000 + 1 } }), { llave: llaveDe(4, 2) });
    // La lista ya está sellada: la respuesta es que está cerrada, y la quitada sigue afuera.
    expect(vuelve.status).toBe(409);
    expect(filas(mundo, sala).map((f) => f.cuenta)).not.toContain(lineas[3]);
  });

  it("antes de cerrar, la persona quitada recibe su motivo y no puede volver a anotarse", async () => {
    const lista = (await (await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })).json()) as { n: number; cuenta: string }[];
    const n4 = lista.find((f) => f.cuenta === lineas[3])?.n;
    expect((await mundo.pedir(ruta(sala, "/campana/quitar"), { cuerpo: { n: n4, motivo: "pidio" }, cabeceras: auth(sala) })).status).toBe(204);
    expect(await (await yoPorLlave(mundo, sala, llaveDe(4))).json()).toMatchObject({ anotada: false, quitada: "pidio" });
    vi.setSystemTime(AHORA + 1000);
    const vuelve = await altaGoogle(mundo, sala, await tokenDeGoogle(4, { payload: { iat: AHORA / 1000 + 1 } }), { llave: llaveDe(4, 2) });
    expect(vuelve.status).toBe(409);
    expect(await vuelve.json()).toEqual({ error: "quitada" });
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT cuenta, motivo FROM campana_quitadas")).toEqual([{ cuenta: lineas[3], motivo: "pidio" }]);
  });

  it("la lista sellada lleva una línea por fila, ordenada como texto, y el resultado nombra a las ganadoras por su línea", async () => {
    const orden = await quitarYSellar();
    const guardada = JSON.parse(String(mundo.ejecutar(`sala:${sala.id}`, "SELECT v FROM sala WHERE k = 'lista'")[0]?.v)) as string[];
    expect(guardada).toEqual(orden);
    expect(guardada.every((l) => esLineaDePersona(l))).toBe(true);
    const guardo = await mundo.pedir(ruta(sala, "/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth(sala) });
    expect(guardo.status).toBe(204);
    const publico = await (await mundo.pedir(ruta(sala, "/campana/resultado"))).json();
    expect(publico).toEqual({ sorteo: SORTEO, ganadoras: [orden[2], orden[0]], comprobante: COMPROBANTE });
    // Cada celular sabe si ganó, con su llave sola.
    const porLinea = new Map(lineas.map((l, i): [string, number] => [l, i + 1]));
    const primera = porLinea.get(orden[2] as string) as number;
    const segunda = porLinea.get(orden[0] as string) as number;
    const perdedora = porLinea.get(orden[1] as string) as number;
    expect(await (await yoPorLlave(mundo, sala, llaveDe(primera))).json()).toMatchObject({ anotada: true, gano: true, puesto: 0, fase: "sorteada" });
    expect(await (await yoPorLlave(mundo, sala, llaveDe(segunda))).json()).toMatchObject({ gano: true, puesto: 1 });
    expect(await (await yoPorLlave(mundo, sala, llaveDe(perdedora))).json()).toMatchObject({ anotada: true, gano: false });
  });

  it("avisar a quien ganó se hace por su línea: solo en esta campaña y solo a quien ganó", async () => {
    const orden = await quitarYSellar();
    expect((await mundo.pedir(ruta(sala, "/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth(sala) })).status).toBe(204);
    expect((await avisar(orden[2])).status).toBe(204);
    expect((await avisar(orden[2])).status).toBe(204);
    const primera = (lineas.indexOf(orden[2] as string)) + 1;
    expect(await (await yoPorLlave(mundo, sala, llaveDe(primera))).json()).toMatchObject({ gano: true, avisado: true });
    const perdedora = await avisar(orden[1]);
    expect(perdedora.status).toBe(400);
    expect(await perdedora.json()).toEqual({ error: "no-gano" });
    expect((await avisar(Keypair.random().publicKey())).status).toBe(400);
    expect((await avisar("p1:corta")).status).toBe(400);
    expect((await avisar(`${orden[2]}x`)).status).toBe(400);
    expect((await avisar(orden[2], {})).status).toBe(403);
    // Una sala de cuentas no acepta una línea, y contesta como contesta hoy a algo que no es una cuenta.
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const rechazada = await mundo.pedir(ruta(cuentas, "/campana/avisar"), { cuerpo: { cuenta: orden[2] }, cabeceras: auth(cuentas) });
    expect(rechazada.status).toBe(400);
    expect(await rechazada.json()).toEqual({ error: "forma" });
  });

  it("no se avisa por correo, ni se promete: la línea no dice a quién escribirle", async () => {
    const estado = await (await mundo.pedir(ruta(sala, "/campana/estado"))).json();
    expect(estado).toMatchObject({ correo: false });
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    expect(await (await mundo.pedir(ruta(cuentas, "/campana/estado"))).json()).toMatchObject({ correo: true });
    await quitarYSellar();
    expect((await mundo.pedir(ruta(sala, "/campana/resultado"), { metodo: "PUT", cuerpo: { sorteo: SORTEO, comprobante: COMPROBANTE }, cabeceras: auth(sala) })).status).toBe(204);
    await mundo.esperarSegundoPlano();
    expect(mundo.proveedor.busquedas).toEqual([]);
    expect(mundo.proveedor.llamadas).toEqual({});
    expect((mundo.env.CORREO as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT k FROM sala WHERE k LIKE 'correo:%'")).toEqual([]);
  });
});

describe("activar una campaña de personas", () => {
  it("sin los interruptores, la sala no la activa ni la firma", async () => {
    const m = await montarMundoDeActivar();
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    m.horizon.pagos = [m.pagoCompleto("casa-andina-k7p2")];
    const r = await m.activar({ texto: JSON.stringify(m.campana({ identidad: "persona" })), sesion: m.organizadora.token });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "forma", campo: "identidad" });
  });

  it("con los interruptores, la activa y el texto firmado conserva el campo", async () => {
    const m = await montarMundoDeActivar({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE });
    vi.setSystemTime(HORA_DE_LA_PRUEBA);
    m.horizon.pagos = [m.pagoCompleto("casa-andina-k7p2")];
    const r = await m.activar({ texto: JSON.stringify(m.campana({ identidad: "persona" })), sesion: m.organizadora.token });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { texto: string }).texto).toBe(JSON.stringify(m.campana({ identidad: "persona" })));
  });

  it("un valor de identidad que no es persona se activa como la campaña de siempre, con los interruptores como estén", async () => {
    const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }];
    for (const extra of interruptores) {
      const m = await montarMundoDeActivar(extra);
      vi.setSystemTime(HORA_DE_LA_PRUEBA);
      m.horizon.pagos = [m.pagoCompleto("casa-andina-k7p2")];
      const r = await m.activar({ texto: JSON.stringify(m.campana({ identidad: "otra" })), sesion: m.organizadora.token });
      expect(r.status, JSON.stringify(extra)).toBe(200);
    }
  });
});

describe("las rutas de personas en las salas de hoy", () => {
  /** Todo lo que se ve de una respuesta: estado, cabeceras y cuerpo en bruto. */
  async function foto(r: Response): Promise<string> {
    const cabeceras = [...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return JSON.stringify([r.status, cabeceras, await r.text()]);
  }
  const LINEA = `p1:${"a".repeat(26)}`;
  const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }];

  it.each(interruptores)("una sala de cuentas y una que no existe contestan lo mismo que antes del modo, con los interruptores %j", async (extra) => {
    const { mundo } = await montarPersonas(extra);
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const token = await tokenDeGoogle(1);
    const d = "A".repeat(60);
    for (const sala of [cuentas, { id: "AbCdEf12", token: "x" }]) {
      // Lo que contestaba la sala de hoy a un pedido sin la forma de su alta, de su consulta y de su aviso: la referencia de cada ruta.
      const alta = await foto(await mundo.pedir(ruta(sala, "/campana/alta"), { cuerpo: { token: "no", d, llave: llaveDe(1) } }));
      const yo = await foto(await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { cuenta: "no", llave: llaveDe(1) } }));
      const avisar = await foto(await mundo.pedir(ruta(sala, "/campana/avisar"), { cuerpo: { cuenta: "no" }, cabeceras: auth(sala) }));
      expect(JSON.parse(alta)[0]).toBe(400);
      // Lo que traen las rutas de personas contesta exactamente eso, respuesta por respuesta, sin tocar nada.
      expect(await foto(await altaGoogle(mundo, sala, token)), "alta").toBe(alta);
      expect(await foto(await yoPorLlave(mundo, sala, llaveDe(1))), "consulta propia").toBe(yo);
      expect(await foto(await mundo.pedir(ruta(sala, "/campana/avisar"), { cuerpo: { cuenta: LINEA }, cabeceras: auth(sala) })), "aviso").toBe(avisar);
    }
  });
});
