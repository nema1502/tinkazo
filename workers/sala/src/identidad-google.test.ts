import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  URL_DE_LLAVES_DE_GOOGLE,
  crearMemoriaDeLlaves,
  verificarIdentidadDeGoogle,
  type OpcionesDeIdentidad,
  type RespuestaDeLlaves,
} from "./identidad-google";

/**
 * La verificación del token de identidad de Google. Cada rechazo se prueba con un token firmado acá mismo con una llave
 * RSA de prueba: nada llama a Google de verdad.
 */

const CLIENTE = "cliente-de-prueba.apps.example.org";
const AHORA = 1_800_000_000_000;
const SUB = "100000000000000000001";
const CORREO = "ana@example.org";
const FOTO = "https://fotos.example.org/a/ana=s96-c";

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
let google2: Par;
let intruso: Par;

beforeAll(async () => {
  [google, google2, intruso] = await Promise.all([nuevoPar("llave-1"), nuevoPar("llave-2"), nuevoPar("llave-1")]);
});

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const aTexto = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));

interface Pedido {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  par?: Par;
  algoritmoFirmado?: string;
}

function cuerpo(p: Pedido = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENTE,
    sub: SUB,
    email: CORREO,
    email_verified: true,
    iat: AHORA / 1000 - 10,
    exp: AHORA / 1000 + 3000,
    ...p.payload,
  };
}

async function firmar(p: Pedido = {}): Promise<string> {
  const par = p.par ?? google;
  const entrada = `${aTexto({ alg: "RS256", typ: "JWT", kid: par.kid, ...p.header })}.${aTexto(cuerpo(p))}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", par.privada, new TextEncoder().encode(entrada)));
  return `${entrada}.${b64(firma)}`;
}

interface Banco {
  opciones: OpcionesDeIdentidad;
  pedidos: () => number;
  /** Cambia las llaves que publica Google a partir de ahora. */
  publicar: (llaves: Par[]) => void;
  reloj: { ms: number };
}

function banco(inicial: Par[] = [google], cabecera: string | null = "public, max-age=3600"): Banco {
  let llaves = inicial;
  let n = 0;
  const reloj = { ms: AHORA };
  const pedir = async (): Promise<RespuestaDeLlaves> => {
    n++;
    return {
      ok: true,
      status: 200,
      headers: { get: (nombre: string) => (nombre.toLowerCase() === "cache-control" ? cabecera : null) },
      json: async () => ({ keys: llaves.map((l) => l.jwk) }),
    };
  };
  return {
    opciones: { clienteId: CLIENTE, pedir, ahora: () => reloj.ms, memoria: crearMemoriaDeLlaves() },
    pedidos: () => n,
    publicar: (nuevas) => {
      llaves = nuevas;
    },
    reloj,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("un token de Google bueno", () => {
  it("da el usuario estable y el correo verificado", async () => {
    const b = banco();
    const r = await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    expect(r).toEqual({ ok: true, usuario: `google:${SUB}`, correo: CORREO, nombre: "", foto: "" });
  });

  it("da también el nombre y la dirección de la foto, tal como vienen en el token y sin limpiarlos", async () => {
    const b = banco();
    const t = await firmar({ payload: { name: "  Ana   de Prueba \n", picture: "http://fotos.example.org/ana.jpg " } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({
      ok: true,
      usuario: `google:${SUB}`,
      correo: CORREO,
      nombre: "  Ana   de Prueba \n",
      foto: "http://fotos.example.org/ana.jpg ",
    });
  });

  it("un token sin nombre o sin foto entra igual, con ese dato vacío", async () => {
    const b = banco();
    const sinNombre = await verificarIdentidadDeGoogle(await firmar({ payload: { picture: FOTO } }), b.opciones);
    expect(sinNombre).toEqual({ ok: true, usuario: `google:${SUB}`, correo: CORREO, nombre: "", foto: FOTO });
    const sinFoto = await verificarIdentidadDeGoogle(await firmar({ payload: { name: "Ana" } }), b.opciones);
    expect(sinFoto).toEqual({ ok: true, usuario: `google:${SUB}`, correo: CORREO, nombre: "Ana", foto: "" });
  });

  it("un nombre o una foto que no son un texto quedan vacíos y no frenan a nadie", async () => {
    const b = banco();
    for (const raro of [7, 0, null, true, false, { a: 1 }, ["Ana"], []]) {
      const r = await verificarIdentidadDeGoogle(await firmar({ payload: { name: raro, picture: raro } }), b.opciones);
      expect(r, JSON.stringify(raro)).toEqual({ ok: true, usuario: `google:${SUB}`, correo: CORREO, nombre: "", foto: "" });
    }
  });

  it("pide las llaves a la dirección pública de Google", async () => {
    const vistas: string[] = [];
    const b = banco();
    const pedir = b.opciones.pedir!;
    await verificarIdentidadDeGoogle(await firmar(), {
      ...b.opciones,
      pedir: (url, init) => {
        vistas.push(url);
        return pedir(url, init);
      },
    });
    expect(vistas).toEqual([URL_DE_LLAVES_DE_GOOGLE]);
    expect(URL_DE_LLAVES_DE_GOOGLE).toBe("https://www.googleapis.com/oauth2/v3/certs");
  });

  it("acepta el emisor sin esquema y el correo verificado escrito como texto", async () => {
    const b = banco();
    const t = await firmar({ payload: { iss: "accounts.google.com", email_verified: "true" } });
    expect((await verificarIdentidadDeGoogle(t, b.opciones)).ok).toBe(true);
  });

  it("dos cuentas distintas dan dos usuarios distintos y la misma cuenta, siempre el mismo", async () => {
    const b = banco();
    const a1 = await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    const a2 = await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    const otra = await verificarIdentidadDeGoogle(await firmar({ payload: { sub: "100000000000000000002" } }), b.opciones);
    expect(a1).toEqual(a2);
    expect(otra.ok && a1.ok && otra.usuario !== a1.usuario).toBe(true);
  });
});

describe("entra lo mismo que entraba antes de guardar perfiles", () => {
  // Guardar el perfil no cambia quién puede anotarse: la verificación mira lo mismo que miraba, con los interruptores como estén.
  const BUENO = { ok: true, usuario: `google:${SUB}`, correo: CORREO, nombre: "", foto: "" };

  it("el campo azp no se mira: con cualquier valor el token entra igual que sin él", async () => {
    const b = banco();
    expect(await verificarIdentidadDeGoogle(await firmar(), b.opciones)).toEqual(BUENO);
    for (const azp of [CLIENTE, "otro-cliente.apps.example.org", "112233445566778899001", "", 123, null, true, [CLIENTE], { a: CLIENTE }]) {
      const t = await firmar({ payload: { azp } });
      expect(await verificarIdentidadDeGoogle(t, b.opciones), JSON.stringify(azp)).toEqual(BUENO);
    }
  });

  it("el dominio del correo no se mira: un correo verificado entra termine como termine", async () => {
    const b = banco();
    const dominio = ["gserviceaccount", "com"].join(".");
    for (const email of [`robot@proyecto.iam.${dominio}`, `Robot@Proyecto.IAM.${dominio.toUpperCase()}`, `robot@developer.${dominio}`, "ana@escuela.example.org"]) {
      for (const payload of [{ email }, { email, azp: CLIENTE }, { email, azp: "112233445566778899001" }]) {
        const r = await verificarIdentidadDeGoogle(await firmar({ payload }), b.opciones);
        expect(r, JSON.stringify(payload)).toEqual({ ...BUENO, correo: email });
      }
    }
  });
});

describe("lo que se rechaza", () => {
  it("un token de otro cliente: audiencia", async () => {
    const b = banco();
    const t = await firmar({ payload: { aud: "otro-cliente.apps.example.org" } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "audiencia" });
  });

  it("una audiencia que no es texto: audiencia", async () => {
    const b = banco();
    const t = await firmar({ payload: { aud: [CLIENTE] } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "audiencia" });
  });

  it("sin identificador de cliente configurado no entra nadie", async () => {
    const b = banco();
    const t = await firmar({ payload: { aud: "" } });
    expect(await verificarIdentidadDeGoogle(t, { ...b.opciones, clienteId: "" })).toEqual({ ok: false, motivo: "audiencia" });
  });

  it("otro emisor: emisor", async () => {
    const b = banco();
    for (const iss of ["https://accounts.example.org", "https://accounts.google.com.example.org", "", "google"]) {
      const t = await firmar({ payload: { iss } });
      expect(await verificarIdentidadDeGoogle(t, b.opciones), iss).toEqual({ ok: false, motivo: "emisor" });
    }
  });

  it("una firma con bits sobrantes distintos de cero no es canónica: mal formado, y el token bueno sigue entrando", async () => {
    const b = banco();
    const t = await firmar();
    expect((await verificarIdentidadDeGoogle(t, b.opciones)).ok).toBe(true);
    // La firma de 256 bytes son 342 letras y la última lleva cuatro bits que sobran: cambiarlos no cambia los bytes.
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const ultima = t.at(-1) as string;
    for (const salto of [1, 2, 4, 8]) {
      const otra = alfabeto[alfabeto.indexOf(ultima) ^ salto] as string;
      expect(otra).not.toBe(ultima);
      const distinto = `${t.slice(0, -1)}${otra}`;
      expect(await verificarIdentidadDeGoogle(distinto, b.opciones), `salto ${salto}`).toEqual({ ok: false, motivo: "mal-formado" });
    }
  });

  it("un token vencido: vencido", async () => {
    const b = banco();
    const t = await firmar({ payload: { exp: AHORA / 1000 - 1 } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "vencido" });
  });

  it("el instante exacto de la caducidad ya no sirve", async () => {
    const b = banco();
    const t = await firmar({ payload: { exp: AHORA / 1000 } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "vencido" });
  });

  it("un token que vence mientras la sala lo tiene: vencido", async () => {
    const b = banco();
    const t = await firmar();
    expect((await verificarIdentidadDeGoogle(t, b.opciones)).ok).toBe(true);
    b.reloj.ms += 4_000_000;
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "vencido" });
  });

  it("sin caducidad escrita: mal formado", async () => {
    const b = banco();
    const t = await firmar({ payload: { exp: undefined } });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "mal-formado" });
  });

  it("correo sin verificar o sin correo: correo-sin-verificar", async () => {
    const b = banco();
    for (const payload of [{ email_verified: false }, { email_verified: "false" }, { email_verified: undefined }, { email: undefined }, { email: "" }]) {
      const t = await firmar({ payload });
      expect(await verificarIdentidadDeGoogle(t, b.opciones), JSON.stringify(payload)).toEqual({ ok: false, motivo: "correo-sin-verificar" });
    }
  });

  it("sin identificador de cuenta, o con uno que no sirve: mal formado", async () => {
    const b = banco();
    for (const sub of [undefined, "", 7, "con espacio", "x".repeat(256), "google:1"]) {
      const t = await firmar({ payload: { sub } });
      expect(await verificarIdentidadDeGoogle(t, b.opciones), String(sub)).toEqual({ ok: false, motivo: "mal-formado" });
    }
  });

  it("firmado con otra llave aunque diga la misma identificación de llave: firma", async () => {
    const b = banco();
    const t = await firmar({ par: intruso });
    expect(await verificarIdentidadDeGoogle(t, b.opciones)).toEqual({ ok: false, motivo: "firma" });
  });

  it("con el cuerpo cambiado después de firmar: firma", async () => {
    const b = banco();
    const t = await firmar();
    const [h, , f] = t.split(".");
    const otro = aTexto(cuerpo({ payload: { sub: "999999999999999999999" } }));
    expect(await verificarIdentidadDeGoogle(`${h}.${otro}.${f}`, b.opciones)).toEqual({ ok: false, motivo: "firma" });
  });

  it("con el algoritmo cambiado: firma", async () => {
    const b = banco();
    for (const alg of ["HS256", "RS384", "RS512", "ES256", "none", "None", ""]) {
      const t = await firmar({ header: { alg } });
      expect(await verificarIdentidadDeGoogle(t, b.opciones), alg).toEqual({ ok: false, motivo: "firma" });
    }
  });

  it("el ataque clásico: algoritmo HS256 firmado con la llave pública como secreto: firma", async () => {
    const b = banco();
    const entrada = `${aTexto({ alg: "HS256", typ: "JWT", kid: google.kid })}.${aTexto(cuerpo())}`;
    const secreto = new TextEncoder().encode(JSON.stringify(google.jwk));
    const clave = await crypto.subtle.importKey("raw", secreto, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(entrada)));
    expect(await verificarIdentidadDeGoogle(`${entrada}.${b64(firma)}`, b.opciones)).toEqual({ ok: false, motivo: "firma" });
  });

  it("sin firma: firma, con o sin el último punto", async () => {
    const b = banco();
    const t = await firmar({ header: { alg: "none" } });
    const sinFirma = t.split(".").slice(0, 2).join(".");
    expect(await verificarIdentidadDeGoogle(`${sinFirma}.`, b.opciones)).toEqual({ ok: false, motivo: "firma" });
    expect(await verificarIdentidadDeGoogle(sinFirma, b.opciones)).toEqual({ ok: false, motivo: "mal-formado" });
    const buena = await firmar();
    expect(await verificarIdentidadDeGoogle(`${buena.split(".").slice(0, 2).join(".")}.`, b.opciones)).toEqual({ ok: false, motivo: "firma" });
  });

  it("una firma truncada o con basura: firma", async () => {
    const b = banco();
    const t = await firmar();
    expect(await verificarIdentidadDeGoogle(t.slice(0, -10), b.opciones)).toEqual({ ok: false, motivo: "firma" });
    expect(await verificarIdentidadDeGoogle(`${t.slice(0, -4)}AAAA`, b.opciones)).toEqual({ ok: false, motivo: "firma" });
  });

  it("lo que no es un token: mal formado, sin lanzar", async () => {
    const b = banco();
    const casos: unknown[] = [
      "",
      "a",
      "a.b",
      "a.b.c.d",
      "...",
      "!!!.???.***",
      `${aTexto({ alg: "RS256", kid: "llave-1" })}.${b64(new TextEncoder().encode("no es json"))}.AAAA`,
      `${b64(new TextEncoder().encode("no es json"))}.${aTexto(cuerpo())}.AAAA`,
      `${aTexto([1, 2])}.${aTexto(cuerpo())}.AAAA`,
      `${aTexto({ alg: "RS256", kid: "llave-1" })}.${aTexto([1])}.AAAA`,
      `${aTexto({ alg: "RS256" })}.${aTexto(cuerpo())}.AAAA`,
      `${aTexto({ alg: "RS256", kid: 5 })}.${aTexto(cuerpo())}.AAAA`,
      "x".repeat(20_000),
      null,
      undefined,
      42,
      {},
    ];
    for (const c of casos) {
      const r = await verificarIdentidadDeGoogle(c as string, b.opciones);
      expect(r.ok, String(c).slice(0, 30)).toBe(false);
      expect(["mal-formado", "firma"]).toContain((r as { motivo: string }).motivo);
    }
    expect(await verificarIdentidadDeGoogle("", b.opciones)).toEqual({ ok: false, motivo: "mal-formado" });
    expect(await verificarIdentidadDeGoogle("a.b", b.opciones)).toEqual({ ok: false, motivo: "mal-formado" });
    expect(await verificarIdentidadDeGoogle(null as unknown as string, b.opciones)).toEqual({ ok: false, motivo: "mal-formado" });
  });

  it("un token mal formado no gasta un pedido a Google", async () => {
    const b = banco();
    await verificarIdentidadDeGoogle("a.b.c", b.opciones);
    await verificarIdentidadDeGoogle("", b.opciones);
    expect(b.pedidos()).toBe(0);
  });
});

describe("las llaves de Google", () => {
  it("se recuerdan según su caducidad: dos tokens, un solo pedido", async () => {
    const b = banco();
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    expect(b.pedidos()).toBe(1);
  });

  it("al vencer lo recordado se piden otra vez", async () => {
    const b = banco([google], "public, max-age=600");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 599_000;
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    expect(b.pedidos()).toBe(1);
    b.reloj.ms += 2_000;
    await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(b.pedidos()).toBe(2);
  });

  it("la edad que ya trae la respuesta se descuenta de lo que se recuerda", async () => {
    let n = 0;
    const b = banco();
    const pedir = async (): Promise<RespuestaDeLlaves> => {
      n++;
      return {
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h.toLowerCase() === "cache-control" ? "public, max-age=1000" : h.toLowerCase() === "age" ? "900" : null) },
        json: async () => ({ keys: [google.jwk] }),
      };
    };
    const o = { ...b.opciones, pedir };
    await verificarIdentidadDeGoogle(await firmar(), o);
    b.reloj.ms += 150_000;
    await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), o);
    expect(n).toBe(2);
  });

  it("sin cabecera de caducidad se recuerdan unos minutos y no para siempre", async () => {
    const b = banco([google], null);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 60_000;
    await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(b.pedidos()).toBe(1);
    b.reloj.ms += 24 * 3_600_000;
    await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(b.pedidos()).toBe(2);
  });

  it("una caducidad exagerada no deja las llaves recordadas más de un día", async () => {
    const b = banco([google], "public, max-age=99999999");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 25 * 3_600_000;
    await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(b.pedidos()).toBe(2);
  });

  it("si rotan: un token con una llave nueva las vuelve a pedir UNA vez y entra", async () => {
    const b = banco([google]);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    expect(b.pedidos()).toBe(1);
    b.publicar([google, google2]);
    b.reloj.ms += 60_000;
    const r = await verificarIdentidadDeGoogle(await firmar({ par: google2, payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(r.ok).toBe(true);
    expect(b.pedidos()).toBe(2);
  });

  it("una llave que no existe ni después de pedirlas de nuevo se rechaza con un solo pedido más", async () => {
    const b = banco([google]);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 60_000;
    const raro = await nuevoPar("llave-que-no-existe");
    const r = await verificarIdentidadDeGoogle(await firmar({ par: raro, payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones);
    expect(r).toEqual({ ok: false, motivo: "firma" });
    expect(b.pedidos()).toBe(2);
  });

  it("quien manda llaves inventadas no hace que la sala pida las de Google sin parar", async () => {
    const b = banco([google]);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    const raro = await nuevoPar("llave-que-no-existe");
    for (let i = 0; i < 20; i++) await verificarIdentidadDeGoogle(await firmar({ par: raro }), b.opciones);
    // Dentro de un mismo instante solo vale la memoria.
    expect(b.pedidos()).toBe(1);
  });

  it("varios tokens a la vez comparten un solo pedido", async () => {
    const b = banco();
    const tokens = await Promise.all([firmar(), firmar(), firmar(), firmar()]);
    const rs = await Promise.all(tokens.map((t) => verificarIdentidadDeGoogle(t, b.opciones)));
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(b.pedidos()).toBe(1);
  });
});

describe("cuando las llaves no están disponibles", () => {
  const motivo = { ok: false, motivo: "llaves-no-disponibles" };

  it("si el pedido falla: llaves-no-disponibles, sin lanzar", async () => {
    const b = banco();
    const o = { ...b.opciones, pedir: async () => { throw new Error("sin red"); } };
    expect(await verificarIdentidadDeGoogle(await firmar(), o)).toEqual(motivo);
  });

  it("si Google contesta con error o con algo que no entiende", async () => {
    const b = banco();
    const resp = (r: Partial<RespuestaDeLlaves>): OpcionesDeIdentidad => ({
      ...b.opciones,
      memoria: crearMemoriaDeLlaves(),
      pedir: async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), ...r }),
    });
    const t = await firmar();
    expect(await verificarIdentidadDeGoogle(t, resp({ ok: false, status: 500 }))).toEqual(motivo);
    expect(await verificarIdentidadDeGoogle(t, resp({ json: async () => { throw new Error("no es json"); } }))).toEqual(motivo);
    expect(await verificarIdentidadDeGoogle(t, resp({ json: async () => ({ keys: "no" }) }))).toEqual(motivo);
    expect(await verificarIdentidadDeGoogle(t, resp({ json: async () => ({ keys: [] }) }))).toEqual(motivo);
    expect(await verificarIdentidadDeGoogle(t, resp({ json: async () => null }))).toEqual(motivo);
  });

  it("si el pedido no contesta, se corta a los pocos segundos", async () => {
    const b = banco();
    const o: OpcionesDeIdentidad = { ...b.opciones, tiempoMaxMs: 30, pedir: () => new Promise<RespuestaDeLlaves>(() => {}) };
    const t0 = Date.now();
    expect(await verificarIdentidadDeGoogle(await firmar(), o)).toEqual(motivo);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("un pedido que falló no se recuerda: pasada la espera corta, el siguiente lo intenta de nuevo", async () => {
    const b = banco();
    let fallar = true;
    const pedir = async (url: string, init: { signal: AbortSignal }): Promise<RespuestaDeLlaves> => {
      if (fallar) throw new Error("sin red");
      return b.opciones.pedir!(url, init);
    };
    const o = { ...b.opciones, pedir };
    const t = await firmar();
    expect(await verificarIdentidadDeGoogle(t, o)).toEqual(motivo);
    fallar = false;
    b.reloj.ms += 5_000;
    expect((await verificarIdentidadDeGoogle(t, o)).ok).toBe(true);
  });

  it("con Google caído y sin llaves, los tokens no hacen un pedido cada uno: uno cada pocos segundos", async () => {
    const b = banco();
    let pedidos = 0;
    const o = { ...b.opciones, pedir: async (): Promise<RespuestaDeLlaves> => { pedidos++; throw new Error("sin red"); } };
    const t = await firmar();
    for (let i = 0; i < 20; i++) expect(await verificarIdentidadDeGoogle(t, o)).toEqual(motivo);
    expect(pedidos).toBe(1);
    b.reloj.ms += 5_000;
    expect(await verificarIdentidadDeGoogle(t, o)).toEqual(motivo);
    expect(pedidos).toBe(2);
  });

  it("con llaves vigentes y Google caído, las llaves inventadas no hacen un pedido cada una", async () => {
    const b = banco([google]);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 60_000;
    let pedidos = 0;
    const falla = async (): Promise<RespuestaDeLlaves> => { pedidos++; return { ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }; };
    const o = { ...b.opciones, pedir: falla };
    const raro = await nuevoPar("llave-que-no-existe");
    for (let i = 0; i < 20; i++) await verificarIdentidadDeGoogle(await firmar({ par: raro, payload: { exp: b.reloj.ms / 1000 + 100 } }), o);
    expect(pedidos).toBe(1);
    // Quien trae una llave conocida sigue entrando, sin pedir nada.
    expect((await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), o)).ok).toBe(true);
    expect(pedidos).toBe(1);
    // Pasada la espera larga se vuelve a intentar, una vez.
    b.reloj.ms += 31_000;
    for (let i = 0; i < 20; i++) await verificarIdentidadDeGoogle(await firmar({ par: raro, payload: { exp: b.reloj.ms / 1000 + 100 } }), o);
    expect(pedidos).toBe(2);
  });

  it("si Google vuelve, un fallo anterior no frena a la siguiente rotación", async () => {
    const b = banco([google]);
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 60_000;
    const caida = { ...b.opciones, pedir: async (): Promise<RespuestaDeLlaves> => { throw new Error("sin red"); } };
    const nuevo = await firmar({ par: google2, payload: { exp: b.reloj.ms / 1000 + 100 } });
    expect(await verificarIdentidadDeGoogle(nuevo, caida)).toEqual(motivo);
    b.publicar([google, google2]);
    b.reloj.ms += 31_000;
    expect((await verificarIdentidadDeGoogle(await firmar({ par: google2, payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones)).ok).toBe(true);
  });

  it("con las llaves vencidas y Google caído, las llaves viejas siguen sirviendo a quien trae una llave conocida", async () => {
    const b = banco([google], "public, max-age=60");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 120_000;
    let pedidos = 0;
    const o = { ...b.opciones, pedir: async (): Promise<RespuestaDeLlaves> => { pedidos++; throw new Error("sin red"); } };
    const nuevoToken = (): Promise<string> => firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } });
    expect((await verificarIdentidadDeGoogle(await nuevoToken(), o)).ok).toBe(true);
    // Mientras Google no contesta no se le pide en cada token.
    for (let i = 0; i < 10; i++) expect((await verificarIdentidadDeGoogle(await nuevoToken(), o)).ok).toBe(true);
    expect(pedidos).toBe(1);
  });

  it("con las llaves vencidas y Google caído, una llave desconocida no entra: llaves-no-disponibles", async () => {
    const b = banco([google], "public, max-age=60");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 120_000;
    const o = { ...b.opciones, pedir: async () => { throw new Error("sin red"); } };
    expect(await verificarIdentidadDeGoogle(await firmar({ par: google2, payload: { exp: b.reloj.ms / 1000 + 100 } }), o)).toEqual(motivo);
  });

  it("las llaves viejas sirven un tiempo limitado: pasadas seis horas del vencimiento, no se acepta nada", async () => {
    const b = banco([google], "public, max-age=60");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    const o = { ...b.opciones, pedir: async () => { throw new Error("sin red"); } };
    b.reloj.ms += 60_000 + 5 * 3_600_000;
    expect((await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), o)).ok).toBe(true);
    b.reloj.ms += 2 * 3_600_000;
    expect(await verificarIdentidadDeGoogle(await firmar({ payload: { exp: b.reloj.ms / 1000 + 100 } }), o)).toEqual(motivo);
  });

  it("si Google vuelve con las llaves vencidas, se renuevan y todo sigue igual", async () => {
    const b = banco([google], "public, max-age=60");
    await verificarIdentidadDeGoogle(await firmar(), b.opciones);
    b.reloj.ms += 120_000;
    b.publicar([google2]);
    expect((await verificarIdentidadDeGoogle(await firmar({ par: google2, payload: { exp: b.reloj.ms / 1000 + 100 } }), b.opciones)).ok).toBe(true);
    expect(b.pedidos()).toBe(2);
  });

  it("un pedido compartido que nunca contesta no deja colgado a nadie más: el segundo verificador termina", async () => {
    const b = banco();
    // El pedido de otra conexión quedó en vuelo y su reloj murió con ella: la promesa no se resuelve nunca.
    b.opciones.memoria!.enCurso = new Promise<boolean>(() => {});
    const o: OpcionesDeIdentidad = { ...b.opciones, tiempoMaxMs: 30 };
    const t0 = Date.now();
    expect(await verificarIdentidadDeGoogle(await firmar(), o)).toEqual(motivo);
    expect(Date.now() - t0).toBeLessThan(2000);
    // Y la memoria se libera: el siguiente intento, pasada la espera corta, vuelve a pedir y entra.
    expect(b.opciones.memoria!.enCurso).toBeNull();
    b.reloj.ms += 5_000;
    expect((await verificarIdentidadDeGoogle(await firmar(), o)).ok).toBe(true);
  });

  it("ignora las llaves rotas de la lista y usa las buenas", async () => {
    const b = banco();
    const o: OpcionesDeIdentidad = {
      ...b.opciones,
      pedir: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ keys: [null, 7, { kid: "x" }, { kid: "y", kty: "RSA", n: "!!", e: "AQAB" }, { kty: "EC", kid: "z" }, google.jwk] }),
      }),
    };
    expect((await verificarIdentidadDeGoogle(await firmar(), o)).ok).toBe(true);
  });
});

describe("lo que nunca se escribe", () => {
  it("ni el token, ni el correo, ni el nombre, ni la foto, ni el identificador pasan por un registro", async () => {
    const espias = (["log", "info", "warn", "error", "debug"] as const).map((n) => vi.spyOn(console, n).mockImplementation(() => {}));
    const b = banco();
    const buenos = await firmar({ payload: { name: "Ana de Prueba", picture: FOTO } });
    const malos = [await firmar({ payload: { aud: "otro" } }), await firmar({ par: intruso }), "a.b.c", buenos.slice(0, -5)];
    await verificarIdentidadDeGoogle(buenos, b.opciones);
    for (const m of malos) await verificarIdentidadDeGoogle(m, b.opciones);
    const caida = { ...b.opciones, memoria: crearMemoriaDeLlaves(), pedir: async () => { throw new Error("sin red"); } };
    await verificarIdentidadDeGoogle(buenos, caida);
    for (const e of espias) expect(e).not.toHaveBeenCalled();
  });

  it("el motivo de rechazo es un texto fijo que no repite nada del token", async () => {
    const b = banco();
    const t = await firmar({ payload: { aud: "otro-cliente-secreto", email: "beto@example.org" } });
    const r = await verificarIdentidadDeGoogle(t, b.opciones);
    expect(JSON.stringify(r)).toBe('{"ok":false,"motivo":"audiencia"}');
  });
});
