import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  altaDe,
  campanaAbierta,
  montarMundo,
  personaDePrueba,
  type MundoDeSala,
  type SalaDeCampana,
} from "../../../src/sala/mundo-sala";
import { URL_DE_LLAVES_DE_GOOGLE } from "./identidad-google";

vi.mock("cloudflare:workers", async () => await import("../../../src/sala/cloudflare-falso"));

/**
 * El perfil de quien se anota con Google, con el Worker de la sala entero en Node: dónde vive la tabla y cuándo el alta de
 * una campaña de personas guarda el correo, el nombre y la foto. El token de identidad se firma acá con una llave RSA de
 * prueba. Nada llama a Google ni al proveedor de cuentas de verdad.
 */
const AHORA = Date.UTC(2026, 10, 27, 15, 0, 0);
const CLIENTE = "cliente-de-prueba.apps.example.org";
const sub = (n: number): string => `10000000000000000000${n}`;
const correo = (n: number): string => `persona${n}@example.org`;
const nombre = (n: number): string => `Vecina${n} Deprueba${n}`;
const foto = (n: number): string => `https://fotos.example.org/a/retrato${n}=s96-c`;
const llaveDe = (n: number, celular = 1): string => `celular${n}-${celular}`.padEnd(22, "x");

const COLUMNAS = ["id", "correo", "nombre", "foto", "primera_ms", "ultima_ms", "veces"];

/** El objeto de cupos visto por lo único que le pide el alta para un perfil. */
interface CuposConPerfiles {
  guardarPerfil(perfil: { id: string; correo: string; nombre: string; foto: string }): Promise<{ nueva: boolean }>;
}

interface Par {
  kid: string;
  privada: CryptoKey;
  jwk: JsonWebKey & { kid: string };
}

let google: Par;

beforeAll(async () => {
  const par = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", par.publicKey);
  google = { kid: "llave-1", privada: par.privateKey, jwk: { ...jwk, kid: "llave-1", alg: "RS256", use: "sig" } as Par["jwk"] };
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const aTexto = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));

/**
 * Un token de identidad de Google de la persona `n`, con su nombre y su foto, firmado con la llave de prueba. `cambios` pisa
 * campos de su cuerpo, y con `undefined` los quita.
 */
async function tokenDeGoogle(n: number, cambios: Record<string, unknown> = {}): Promise<string> {
  const cuerpo = {
    iss: "https://accounts.google.com",
    aud: CLIENTE,
    sub: sub(n),
    email: correo(n),
    email_verified: true,
    name: nombre(n),
    picture: foto(n),
    iat: AHORA / 1000 - 10,
    exp: AHORA / 1000 + 3000,
    ...cambios,
  };
  const entrada = `${aTexto({ alg: "RS256", typ: "JWT", kid: google.kid })}.${aTexto(cuerpo)}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", google.privada, new TextEncoder().encode(entrada)));
  return `${entrada}.${b64(firma)}`;
}

/** El Worker de la sala con las campañas de personas prendidas y un Google de mentira detrás del `fetch`. */
async function montarPersonas(extra: Record<string, string> = {}): Promise<MundoDeSala> {
  const mundo = await montarMundo({ DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, ...extra });
  const delResto = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
    if (String(url) === URL_DE_LLAVES_DE_GOOGLE) {
      return new Response(JSON.stringify({ keys: [google.jwk] }), { status: 200, headers: { "cache-control": "public, max-age=3600" } });
    }
    return delResto(url, init);
  });
  return mundo;
}

const auth = (sala: SalaDeCampana): Record<string, string> => ({ Authorization: `Bearer ${sala.token}` });
const ruta = (sala: SalaDeCampana, resto: string): string => `/v1/sala/${sala.id}${resto}`;

/** El alta de una persona con su token de Google. `cuerpo` suma campos al pedido, como el permiso del perfil. */
function altaGoogle(
  mundo: MundoDeSala,
  sala: SalaDeCampana,
  token: string,
  extra: { llave?: string; cuerpo?: Record<string, unknown> } = {},
): Promise<Response> {
  return mundo.pedir(ruta(sala, "/campana/alta"), {
    cuerpo: { google: token, d: "A".repeat(60), llave: extra.llave ?? llaveDe(1), ...extra.cuerpo },
    cabeceras: { "CF-Connecting-IP": "190.129.10.20" },
  });
}

const CON_PERMISO = { cuerpo: { perfil: true } };

interface Testigo {
  /** Con qué se llamó a `guardarPerfil` del objeto de cupos, en orden. */
  llamadas: unknown[][];
  /** Si no es null, reemplaza lo que hace `guardarPerfil`. */
  hacer: ((...a: unknown[]) => unknown) | null;
}

/** Pone delante del objeto de cupos un testigo de `guardarPerfil`: anota cada llamada y deja cambiar lo que hace. */
function testigoDePerfiles(mundo: MundoDeSala): Testigo {
  const testigo: Testigo = { llamadas: [], hacer: null };
  const espacio = mundo.env.CUPOS as { idFromName(n: string): string; get(id: string): object };
  mundo.env.CUPOS = {
    idFromName: (n: string) => espacio.idFromName(n),
    get: (id: string) =>
      new Proxy(espacio.get(id), {
        get: (t, p) => {
          const v: unknown = Reflect.get(t, p);
          if (p !== "guardarPerfil" || typeof v !== "function") return v;
          return (...a: unknown[]): unknown => {
            testigo.llamadas.push(a);
            return testigo.hacer ? testigo.hacer(...a) : (v as (...x: unknown[]) => unknown)(...a);
          };
        },
      }),
  };
  return testigo;
}

/** Anota, en orden, cada método de la sala que llama el Worker desde acá en adelante. */
function pasosDeLaSala(mundo: MundoDeSala): string[] {
  const pasos: string[] = [];
  const espacio = mundo.env.SALA as { idFromName(n: string): string; get(id: string): object };
  mundo.env.SALA = {
    idFromName: (n: string) => espacio.idFromName(n),
    get: (id: string) =>
      new Proxy(espacio.get(id), {
        get: (t, p) => {
          const v: unknown = Reflect.get(t, p);
          return typeof v === "function" ? (...a: unknown[]): unknown => (pasos.push(String(p)), (v as (...x: unknown[]) => unknown)(...a)) : v;
        },
      }),
  };
  return pasos;
}

/** Los perfiles guardados, tal como están en la tabla del objeto de cupos. */
const perfiles = (mundo: MundoDeSala): Record<string, unknown>[] => mundo.ejecutar("cupos", "SELECT * FROM perfiles ORDER BY id");

/** Todo lo que guarda un objeto, tabla por tabla y fila por fila, en un solo texto. `menos` deja afuera una tabla. */
function todoLoGuardado(mundo: MundoDeSala, objeto: string, menos = ""): string {
  const tablas = mundo
    .ejecutar(objeto, "SELECT name FROM sqlite_master WHERE type = 'table'")
    .map((t) => String(t.name))
    .filter((t) => t !== menos);
  return JSON.stringify(tablas.map((t) => [t, mundo.ejecutar(objeto, `SELECT * FROM ${t}`)]));
}

/** Todo lo que se ve de una respuesta: estado, cabeceras y cuerpo en bruto. */
async function fotoDe(r: Response): Promise<string> {
  const cabeceras = [...r.headers.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([r.status, cabeceras, await r.text()]);
}

/** Cada línea que el Worker escribió en su registro. */
const registrado = (consola: { mock: { calls: unknown[][] } }): string[] => consola.mock.calls.map((c) => String(c[0]));
const delPerfil = (lineas: string[]): string[] => lineas.filter((l) => l.includes('"perfil-'));

const GUARDADO = (nueva: boolean, conNombre = true, conFoto = true): string =>
  `{"evento":"perfil-guardado","datos":{"nueva":${nueva},"nombre":${conNombre},"foto":${conFoto}}}`;
const FALLO = (codigo: string): string => `{"evento":"perfil-error","datos":{"codigo":"${codigo}"}}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("la tabla de perfiles en el objeto de cupos", () => {
  it("nace con el objeto, vacía, con los interruptores como estén", async () => {
    const interruptores: Record<string, string>[] = [{}, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE }, { DIFERIDA: "1", GOOGLE_CLIENT_ID: CLIENTE, PERFILES: "1" }];
    for (const extra of interruptores) {
      const mundo = await montarMundo(extra);
      const columnas = mundo.ejecutar("cupos", "SELECT name FROM pragma_table_info('perfiles')").map((c) => c.name);
      expect(columnas, JSON.stringify(extra)).toEqual(COLUMNAS);
      expect(mundo.ejecutar("cupos", "SELECT COUNT(*) AS c FROM perfiles")).toEqual([{ c: 0 }]);
    }
  });

  it("el objeto guarda un perfil con la hora de su reloj y dice si la persona es nueva", async () => {
    const mundo = await montarMundo();
    const cupos = mundo.cupos() as unknown as CuposConPerfiles;
    const ana = { id: `google:${sub(1)}`, correo: correo(1), nombre: "Ana de Prueba", foto: foto(1) };
    expect(await cupos.guardarPerfil(ana)).toEqual({ nueva: true });
    vi.setSystemTime(AHORA + 60_000);
    expect(await cupos.guardarPerfil({ ...ana, nombre: "Ana" })).toEqual({ nueva: false });
    expect(mundo.ejecutar("cupos", "SELECT * FROM perfiles")).toEqual([
      { ...ana, nombre: "Ana", primera_ms: AHORA, ultima_ms: AHORA + 60_000, veces: 2 },
    ]);
  });
});

describe("el alta de una persona con Google y su perfil", () => {
  let mundo: MundoDeSala;
  let sala: SalaDeCampana;
  let testigo: Testigo;
  let consola: { mock: { calls: unknown[][] } };

  async function montar(extra: Record<string, string> = { PERFILES: "1" }): Promise<void> {
    mundo = await montarPersonas(extra);
    sala = await campanaAbierta(mundo, AHORA, { identidad: "persona" });
    testigo = testigoDePerfiles(mundo);
  }

  beforeEach(async () => {
    consola = vi.spyOn(console, "log").mockImplementation(() => {});
    await montar();
  });

  it("con el interruptor de la sala y el permiso del pedido, el alta nueva guarda una vez el perfil limpio", async () => {
    const t = await tokenDeGoogle(1, { email: `  ${correo(1)} `, name: "  Vecina1 \t  Deprueba1​ \n" });
    const r = await altaGoogle(mundo, sala, t, CON_PERMISO);
    expect(r.status).toBe(201);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.json()).toEqual({ anotada: true });
    await mundo.esperarSegundoPlano();
    const limpio = { id: `google:${sub(1)}`, correo: correo(1), nombre: nombre(1), foto: foto(1) };
    expect(testigo.llamadas).toEqual([[limpio]]);
    expect(perfiles(mundo)).toEqual([{ ...limpio, primera_ms: AHORA, ultima_ms: AHORA, veces: 1 }]);
    expect(delPerfil(registrado(consola))).toEqual([GUARDADO(true)]);
  });

  it("con el interruptor de la sala apagado no se guarda nada, aunque el pedido lo pida", async () => {
    const apagados: Record<string, string>[] = [{}, { PERFILES: "0" }, { PERFILES: "" }, { PERFILES: "true" }, { PERFILES: " 1" }, { PERFILES: "si" }];
    for (const extra of apagados) {
      await montar(extra);
      const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO);
      expect(r.status, JSON.stringify(extra)).toBe(201);
      expect(await r.json()).toEqual({ anotada: true });
      await mundo.esperarSegundoPlano();
      expect(testigo.llamadas, JSON.stringify(extra)).toEqual([]);
      expect(perfiles(mundo)).toEqual([]);
    }
    expect(delPerfil(registrado(consola))).toEqual([]);
  });

  it("sin el permiso del pedido, o con cualquier valor que no sea el booleano verdadero, el alta entra igual y no guarda", async () => {
    const valores: unknown[] = [undefined, false, "true", "1", 1, 0, null, {}, [], [true], { perfil: true }];
    let n = 0;
    for (const valor of valores) {
      n++;
      const cuerpo = valor === undefined ? {} : { perfil: valor };
      const r = await altaGoogle(mundo, sala, await tokenDeGoogle(n), { llave: llaveDe(n), cuerpo });
      expect(r.status, JSON.stringify(valor)).toBe(201);
      expect(await r.json()).toEqual({ anotada: true });
    }
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toEqual([]);
    expect(perfiles(mundo)).toEqual([]);
    expect(delPerfil(registrado(consola))).toEqual([]);
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM equipos")).toEqual([{ c: valores.length }]);
  });

  it("la respuesta del alta es la misma, byte a byte, con el perfil guardado que con todo apagado", async () => {
    /** Las respuestas del alta: nueva, repetida con la ficha reciente, repetida con otro token de la misma cuenta y un rechazo. */
    const recorrer = async (extra: Record<string, string>, cuerpo: Record<string, unknown>): Promise<string[]> => {
      vi.setSystemTime(AHORA);
      await montar(extra);
      const t = await tokenDeGoogle(1);
      const fotos = [await fotoDe(await altaGoogle(mundo, sala, t, { cuerpo })), await fotoDe(await altaGoogle(mundo, sala, t, { cuerpo }))];
      vi.setSystemTime(AHORA + 120_000);
      fotos.push(await fotoDe(await altaGoogle(mundo, sala, await tokenDeGoogle(1, { iat: AHORA / 1000 + 100 }), { cuerpo })));
      fotos.push(await fotoDe(await altaGoogle(mundo, sala, await tokenDeGoogle(2, { email_verified: false }), { llave: llaveDe(2), cuerpo })));
      await mundo.esperarSegundoPlano();
      return fotos;
    };
    const apagado = await recorrer({}, {});
    expect(perfiles(mundo)).toEqual([]);
    const prendido = await recorrer({ PERFILES: "1" }, { perfil: true });
    expect(perfiles(mundo)).toHaveLength(1);
    expect(prendido).toEqual(apagado);
    expect(apagado.map((f) => (JSON.parse(f) as [number])[0])).toEqual([201, 200, 200, 401]);
  });

  it("otro token de la misma cuenta ya anotada vuelve a guardar: actualiza el perfil y suma una vez", async () => {
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO)).status).toBe(201);
    await mundo.esperarSegundoPlano();
    vi.setSystemTime(AHORA + 120_000);
    const otro = await tokenDeGoogle(1, { iat: AHORA / 1000 + 100, email: "otra1@example.org", name: "Vecina1 Cambiada", picture: undefined });
    const r = await altaGoogle(mundo, sala, otro, { llave: llaveDe(1, 2), ...CON_PERMISO });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ anotada: true, ya: true });
    await mundo.esperarSegundoPlano();
    expect(perfiles(mundo)).toEqual([
      { id: `google:${sub(1)}`, correo: "otra1@example.org", nombre: "Vecina1 Cambiada", foto: "", primera_ms: AHORA, ultima_ms: AHORA + 120_000, veces: 2 },
    ]);
    expect(delPerfil(registrado(consola))).toEqual([GUARDADO(true), GUARDADO(false, true, false)]);
  });

  it("el reingreso con la ficha reciente no vuelve a verificar y no guarda", async () => {
    const t = await tokenDeGoogle(1);
    expect((await altaGoogle(mundo, sala, t, CON_PERMISO)).status).toBe(201);
    await mundo.esperarSegundoPlano();
    const pasos = pasosDeLaSala(mundo);
    vi.setSystemTime(AHORA + 5_000);
    const r = await altaGoogle(mundo, sala, t, CON_PERMISO);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ anotada: true, ya: true });
    await mundo.esperarSegundoPlano();
    // La sala contestó en la comprobación previa: no hubo verificación ni alta después.
    expect(pasos).toEqual(["prealtaDePersona"]);
    expect(testigo.llamadas).toHaveLength(1);
    expect(perfiles(mundo)).toMatchObject([{ ultima_ms: AHORA, veces: 1 }]);
  });

  it("si guardar el perfil falla, el alta contesta igual y queda un código fijo, sin el motivo", async () => {
    testigo.hacer = () => {
      throw new Error(`no se pudo guardar a ${correo(1)}`);
    };
    const r1 = await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO);
    expect(r1.status).toBe(201);
    expect(await r1.json()).toEqual({ anotada: true });
    testigo.hacer = () => Promise.reject(new Error(`no se pudo guardar a ${correo(2)}`));
    const r2 = await altaGoogle(mundo, sala, await tokenDeGoogle(2), { llave: llaveDe(2), ...CON_PERMISO });
    expect(r2.status).toBe(201);
    testigo.hacer = () => Promise.resolve(null);
    const r3 = await altaGoogle(mundo, sala, await tokenDeGoogle(3), { llave: llaveDe(3), ...CON_PERMISO });
    expect(r3.status).toBe(201);
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toHaveLength(3);
    expect(delPerfil(registrado(consola))).toEqual([FALLO("guardar"), FALLO("guardar"), FALLO("guardar")]);
    expect(registrado(consola).join("\n")).not.toContain("example.org");
    expect(perfiles(mundo)).toEqual([]);
    // Las tres personas quedaron anotadas igual.
    expect(mundo.ejecutar(`sala:${sala.id}`, "SELECT COUNT(*) AS c FROM equipos")).toEqual([{ c: 3 }]);
  });

  it("si guardar el perfil no termina nunca, el alta contesta igual", async () => {
    testigo.hacer = () => new Promise(() => {});
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ anotada: true });
    expect(testigo.llamadas).toHaveLength(1);
    // Y la misma persona, con la ficha reciente, sigue viendo que está anotada.
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO)).status).toBe(200);
  });

  it("con un correo que no tiene forma de correo no se guarda nada, y el alta entra igual", async () => {
    const r = await altaGoogle(mundo, sala, await tokenDeGoogle(1, { email: "sin arroba" }), CON_PERMISO);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ anotada: true });
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toEqual([]);
    expect(perfiles(mundo)).toEqual([]);
    expect(delPerfil(registrado(consola))).toEqual([FALLO("forma")]);
  });

  it("un alta que no termina bien no guarda: token que no sirve, persona quitada, lista cerrada y modo apagado", async () => {
    const malo = await altaGoogle(mundo, sala, await tokenDeGoogle(1, { email_verified: false }), CON_PERMISO);
    expect(malo.status).toBe(401);
    // Una persona que entró sin el permiso y a la que quien organiza quitó: su token es bueno, pero el alta no termina bien.
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(2), { llave: llaveDe(2) })).status).toBe(201);
    const lista = (await (await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })).json()) as { n: number }[];
    const quitada = await mundo.pedir(ruta(sala, "/campana/quitar"), { cuerpo: { n: lista[0]?.n, motivo: "pidio" }, cabeceras: auth(sala) });
    expect(quitada.status).toBe(204);
    vi.setSystemTime(AHORA + 120_000);
    const vuelve = await altaGoogle(mundo, sala, await tokenDeGoogle(2, { iat: AHORA / 1000 + 100 }), { llave: llaveDe(2, 2), ...CON_PERMISO });
    expect(vuelve.status).toBe(409);
    expect(await vuelve.json()).toEqual({ error: "quitada" });
    expect((await mundo.pedir(ruta(sala, "/campana/fase"), { metodo: "PUT", cuerpo: { fase: "cerrada" }, cabeceras: auth(sala) })).status).toBe(204);
    const cerrada = await altaGoogle(mundo, sala, await tokenDeGoogle(3, { iat: AHORA / 1000 + 100 }), { llave: llaveDe(3), ...CON_PERMISO });
    expect(cerrada.status).toBe(409);
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toEqual([]);
    expect(perfiles(mundo)).toEqual([]);
    // Otra sala, con las campañas de personas apagadas después de crearla.
    await montar();
    mundo.env.DIFERIDA = "0";
    const apagada = await altaGoogle(mundo, sala, await tokenDeGoogle(4), { llave: llaveDe(4), ...CON_PERMISO });
    expect(apagada.status).toBe(503);
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toEqual([]);
    expect(perfiles(mundo)).toEqual([]);
    expect(delPerfil(registrado(consola))).toEqual([]);
  });

  it("una campaña de cuentas nunca guarda un perfil, con los interruptores como estén", async () => {
    const cuentas = await campanaAbierta(mundo, AHORA, { evento: "feria-de-cuentas" });
    const r = await altaDe(mundo, cuentas.id, personaDePrueba(mundo, 1), { cuerpo: { perfil: true } });
    expect(r.status).toBe(201);
    // El pedido de personas en una campaña de cuentas sigue siendo un pedido sin forma, y tampoco guarda.
    const conGoogle = await altaGoogle(mundo, cuentas, await tokenDeGoogle(1), CON_PERMISO);
    expect(conGoogle.status).toBe(400);
    expect(await conGoogle.json()).toEqual({ error: "forma" });
    await mundo.esperarSegundoPlano();
    expect(testigo.llamadas).toEqual([]);
    expect(perfiles(mundo)).toEqual([]);
    expect(delPerfil(registrado(consola))).toEqual([]);
  });

  it("el perfil vive en el objeto de cupos: cerrar la sala no lo borra", async () => {
    expect((await altaGoogle(mundo, sala, await tokenDeGoogle(1), CON_PERMISO)).status).toBe(201);
    await mundo.esperarSegundoPlano();
    expect((await mundo.pedir(`/v1/sala/${sala.id}`, { metodo: "DELETE", cabeceras: auth(sala) })).status).toBe(204);
    expect((await mundo.pedir(ruta(sala, "/campana/estado"))).status).toBe(404);
    expect(perfiles(mundo)).toMatchObject([{ id: `google:${sub(1)}`, correo: correo(1), veces: 1 }]);
  });

  it("ni el correo, ni el nombre, ni la foto, ni el usuario, ni el token quedan en un registro, en una respuesta o en la sala", async () => {
    const pantalla = mundo.agregarSocket(sala.id, true);
    const dicho: string[] = [];
    const tokens: string[] = [];
    const alta = async (n: number, cambios: Record<string, unknown> = {}, celular = 1): Promise<void> => {
      const t = await tokenDeGoogle(n, cambios);
      tokens.push(t);
      dicho.push(await fotoDe(await altaGoogle(mundo, sala, t, { llave: llaveDe(n, celular), ...CON_PERMISO })));
      await mundo.esperarSegundoPlano();
    };
    await alta(1);
    await alta(2);
    // Sin nombre y sin foto en el token.
    await alta(3, { name: undefined, picture: 7 });
    // La misma persona con la ficha reciente, y después con otro token desde otro celular.
    dicho.push(await fotoDe(await altaGoogle(mundo, sala, tokens[0] as string, CON_PERMISO)));
    vi.setSystemTime(AHORA + 120_000);
    await alta(1, { iat: AHORA / 1000 + 100 }, 2);
    // Un guardado que falla con un motivo que nombra a la persona, y un correo que no sirve.
    testigo.hacer = () => Promise.reject(new Error(`falló el guardado de ${correo(4)}, ${nombre(4)}`));
    await alta(4, { iat: AHORA / 1000 + 100 });
    testigo.hacer = null;
    await alta(5, { iat: AHORA / 1000 + 100, email: "Vecina5 sin arroba" });
    // Un token que no sirve, y lo que ven el celular, cualquiera y quien organiza.
    dicho.push(await fotoDe(await altaGoogle(mundo, sala, await tokenDeGoogle(6, { aud: "otro" }), { llave: llaveDe(6), ...CON_PERMISO })));
    dicho.push(await fotoDe(await mundo.pedir(ruta(sala, "/campana/yo"), { cuerpo: { llave: llaveDe(2) } })));
    dicho.push(await fotoDe(await mundo.pedir(ruta(sala, "/campana/estado"))));
    dicho.push(await fotoDe(await mundo.pedir(ruta(sala, "/campana/estado"), { cabeceras: auth(sala) })));
    dicho.push(await fotoDe(await mundo.pedir(ruta(sala, "/equipos?desde=0"), { cabeceras: auth(sala) })));
    dicho.push(await fotoDe(await mundo.pedir("/v1/personas/estado")));
    await mundo.esperarSegundoPlano();

    const lineas = registrado(consola);
    const todo = [
      todoLoGuardado(mundo, `sala:${sala.id}`),
      todoLoGuardado(mundo, "cupos", "perfiles"),
      ...dicho,
      ...lineas,
      JSON.stringify(consola.mock.calls),
      ...pantalla.mensajes,
    ].join("\n");
    for (const n of [1, 2, 3, 4, 5, 6]) {
      for (const secreto of [sub(n), correo(n), `persona${n}@`, `Vecina${n}`, `Deprueba${n}`, foto(n), `retrato${n}`]) {
        expect(todo, secreto).not.toContain(secreto);
      }
    }
    for (const secreto of ["fotos.example.org", "sin arroba", "falló el guardado"]) expect(todo, secreto).not.toContain(secreto);
    for (const t of tokens) {
      expect(todo).not.toContain(t);
      for (const parte of t.split(".")) expect(todo).not.toContain(parte);
    }
    // Lo único que el registro dice de un perfil: si la persona es nueva y si quedó con nombre y con foto, o un código fijo.
    expect(delPerfil(lineas)).toEqual([
      GUARDADO(true),
      GUARDADO(true),
      GUARDADO(true, false, false),
      GUARDADO(false),
      FALLO("guardar"),
      FALLO("forma"),
    ]);
    // Los datos están en un solo lugar: la tabla de perfiles del objeto de cupos.
    expect(perfiles(mundo).map((p) => [p.id, p.correo, p.nombre, p.foto, p.veces])).toEqual([
      [`google:${sub(1)}`, correo(1), nombre(1), foto(1), 2],
      [`google:${sub(2)}`, correo(2), nombre(2), foto(2), 1],
      [`google:${sub(3)}`, correo(3), "", "", 1],
    ]);
    // Lo que sí circula es la línea de cada persona, que quien organiza ve como ve hoy una cuenta.
    expect(pantalla.mensajes.join("")).toContain("p1:");
  });
});
