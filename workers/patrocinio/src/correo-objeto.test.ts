/**
 * El correo de bienvenida en el objeto entero, sin Cloudflare: el módulo `cloudflare:workers` se reemplaza por una clase vacía,
 * el SQLite es el de prueba, el reloj es el de la prueba y el `fetch` es uno de mentira que hace de RPC, de Horizon y del
 * proveedor de cuentas. El enlace de envío es uno de mentira que anota lo que recibe. Lo que se mira: con el correo apagado
 * todo es como antes, la respuesta de `/v1/alta/gratis` no cambia, la alarma del correo, que nunca frene ni demore lo demás,
 * y lo que falta para prenderlo.
 */
import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk/base";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AHORA_DE_PRUEBA, armarPago } from "./armar-pago";
import { EMISOR_USDC } from "./cobros";
import { leerConfig } from "./config";
import { type EnlaceDeCorreo, esCorreo } from "./correo-bienvenida";
import { ESPERA_CORREO_MS, TOPE_PERSONA_MS } from "./correo-envios";
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
const MINUTO = 60_000;
const COBROS = Keypair.random().publicKey();
/** Inventados: ni el remitente ni las direcciones existen. */
const REMITENTE = "remitente@correo.test";
const correoDe = (usuario: string) => `${usuario}@correo.test`;
const tokenDe = (usuario: string) => `tok_${usuario}_${"x".repeat(24)}`;

// ---------- el mundo de mentira ----------

/** Las personas que conoce el proveedor de cuentas: su id y su billetera. */
const personas = new Map<string, string>();
/** Cada pedido al proveedor de cuentas, por ruta. */
const pedidosPollar: string[] = [];

async function fetchDeMentira(url: string | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(url));
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  if (u.hostname === "server.api.pollar.xyz") {
    pedidosPollar.push(u.pathname);
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
      const items = cuenta ? [{ id: q, first_name: "Quinua", email: correoDe(q), wallets: [{ network: "STELLAR", public_key: cuenta }] }] : [];
      return json({ code: "SERVER_SDK_USERS_LIST", success: true, content: { items } });
    }
    if (u.pathname === "/v3/billing/credits") {
      return json({ code: "SERVER_BILLING_CREDITS", success: true, content: { available: 100_000, movements: [] } });
    }
    return json({ code: "SERVER_TREASURY_SPONSORSHIP", success: true, content: { sponsor_trustlines: false } });
  }
  if (u.hostname === "horizon.stellar.org") {
    // La cuenta que retira tiene su línea de USDC, como en las pruebas del objeto entero.
    const deudas = { buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" };
    const linea = { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: EMISOR_USDC, balance: "100.0000000", ...deudas };
    const usdc = { ...linea, limit: "922337203685.4775807", is_authorized: true };
    const nativo = { asset_type: "native", balance: "0.0000000", ...deudas };
    return /^\/accounts\//.test(u.pathname) ? json({ id: "G", balances: [nativo, usdc], data: {} }) : json({}, 404);
  }
  const pedido = JSON.parse(String(init?.body)) as { method: string };
  const respuestas: Record<string, unknown> = { getLedgerEntries: { entries: null }, sendTransaction: { status: "PENDING" } };
  const result = respuestas[pedido.method] ?? { status: "NOT_FOUND" };
  return json({ jsonrpc: "2.0", id: 1, result });
}

/** Un enlace de envío de mentira: anota a quién se le mandó y hace lo que diga la prueba. */
function enlaceDeMentira(hacer: () => Promise<unknown> = async () => ({})) {
  const mandados: Array<{ to: string; subject: string; text: string; html: string }> = [];
  const enlace: EnlaceDeCorreo = {
    send: async (m) => {
      mandados.push(m);
      return hacer();
    },
  };
  return { enlace, mandados };
}

const PRENDIDO = { CORREO_BIENVENIDA: "1", CORREO_DE: REMITENTE };

function montar(extra: Record<string, unknown> = {}, o: { enlace?: EnlaceDeCorreo | null; setAlarm?: (ms: number) => Promise<void> } = {}) {
  const sql = sqlDePrueba();
  let alarma: number | null = null;
  const puestas: number[] = [];
  const ctx = {
    storage: {
      sql: { exec: (consulta: string, ...enlaces: unknown[]) => sql.exec(consulta, ...enlaces) },
      transactionSync: <T>(fn: () => T): T => sql.transaccion(fn),
      getAlarm: async () => alarma,
      setAlarm:
        o.setAlarm ??
        (async (ms: number) => {
          alarma = ms;
          puestas.push(ms);
        }),
    },
  };
  const propio = enlaceDeMentira();
  const enlace = o.enlace === undefined ? propio.enlace : o.enlace;
  const env: Record<string, unknown> = {
    RED: "mainnet",
    ALTAS: "1",
    POLLAR_APP_ID: "app_x",
    POLLAR_SECRETO: "sec_mainnet_prueba_inventada_0000000000",
    CUENTA_PATROCINADORA: Keypair.random().publicKey(),
    CLAVE_PATROCINADOR: Keypair.random().secret(),
    CUENTA_COBROS: COBROS,
    COSTO_RETIRO: "0.50",
    RETIROS: "1",
    ADMIN_TOKEN: "o".repeat(40),
    CUPON_SECRETO: "c".repeat(32),
    ...(enlace ? { CORREO: enlace } : {}),
    ...extra,
  };
  const objeto = new Patrocinio(ctx as never, env as never);
  env.PATROCINIO = { idFromName: (nombre: string) => nombre, get: () => objeto };
  /** Una persona nueva para el proveedor de cuentas, con su billetera. */
  const persona = (usuario: string, cuenta = Keypair.random().publicKey()) => {
    personas.set(usuario, cuenta);
    return { usuario, token: tokenDe(usuario), cuenta };
  };
  const gratis = (token: string) => objeto.alta("gratis", { token, ip: "190.129.10.20", cuerpo: {} });
  /** La alarma como la corre Cloudflare: la que está puesta se consume y corre. */
  const disparar = async () => {
    alarma = null;
    await objeto.alarm();
  };
  const ajustes = () => sql.exec("SELECT clave FROM ajustes WHERE clave LIKE 'correo_%'").toArray();
  return { sql, objeto, env, persona, gratis, disparar, ajustes, mandados: propio.mandados, alarma: () => alarma, puestas };
}

/** Deja correr lo que el objeto lanzó sin esperar (la alarma que se pide al dar el regalo). */
const vaciar = () => new Promise<void>((listo) => setTimeout(listo, 0));
const estadoDe = async (m: ReturnType<typeof montar>) => (await m.objeto.administrar("estado")).cuerpo;

beforeEach(() => {
  vi.stubGlobal("fetch", fetchDeMentira);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0));
  personas.clear();
  pedidosPollar.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("con el correo apagado, todo como antes", () => {
  it("el regalo no pide alarma, el estado no suma nada, no se escribe ningún ajuste y nadie llama al enlace", async () => {
    const m = montar({ CORREO_BIENVENIDA: "0", CORREO_DE: REMITENTE });
    const p = m.persona("usr_uno");
    expect((await m.gratis(p.token)).cuerpo).toMatchObject({ regalo: "dado" });
    await vaciar();
    expect(m.alarma()).toBeNull();
    const estado = await estadoDe(m);
    expect(Object.keys(estado)).not.toContain("correoBienvenida");
    expect(estado.faltaAltas ?? []).not.toContain("correo-de");
    vi.setSystemTime(new Date(T0 + 21 * MINUTO));
    await m.disparar();
    expect(m.mandados).toHaveLength(0);
    expect(m.ajustes()).toEqual([]);
    expect(m.puestas).toEqual([]);
    // La ficha se leyó una sola vez: la del regalo, para la billetera. Ninguna más para el correo.
    expect(pedidosPollar.filter((r) => r === "/v3/users")).toHaveLength(1);
  });

  it("sin las variables del correo, igual: es el portero de antes", async () => {
    const m = montar({});
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    expect(m.alarma()).toBeNull();
    expect(Object.keys(await estadoDe(m))).not.toContain("correoBienvenida");
    expect(m.ajustes()).toEqual([]);
  });
});

describe("la respuesta de /v1/alta/gratis", () => {
  it("es idéntica con el correo prendido y apagado, en el regalo dado y en el repetido", async () => {
    const cuenta = Keypair.random().publicKey();
    const respuestas = async (extra: Record<string, unknown>) => {
      personas.clear();
      const m = montar(extra);
      const p = m.persona("usr_uno", cuenta);
      return [await m.gratis(p.token), await m.gratis(p.token)];
    };
    const apagado = await respuestas({ CORREO_BIENVENIDA: "0" });
    const prendido = await respuestas(PRENDIDO);
    expect(prendido).toEqual(apagado);
    expect(JSON.stringify(prendido)).not.toContain("correo");
  });

  it("una alarma que no se puede pedir no cambia la respuesta ni frena el regalo", async () => {
    const m = montar(PRENDIDO, { setAlarm: async () => Promise.reject(new Error("sin alarma")) });
    const p = m.persona("usr_uno");
    expect(await m.gratis(p.token)).toMatchObject({ estado: 200, cuerpo: { ok: true, regalo: "dado", sorteosSumados: 3 } });
    await vaciar();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("programar-correo"));
  });
});

describe("con el correo prendido", () => {
  it("el regalo dado pide la alarma para dentro de 20 minutos, y el repetido no la mueve", async () => {
    const m = montar(PRENDIDO);
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    expect(m.alarma()).toBe(T0 + ESPERA_CORREO_MS);
    vi.setSystemTime(new Date(T0 + MINUTO));
    await m.gratis(p.token);
    await vaciar();
    expect(m.puestas).toEqual([T0 + ESPERA_CORREO_MS]);
  });

  it("sin el regalo (cerrado en caliente: regalo lleno) no pide alarma", async () => {
    const m = montar(PRENDIDO);
    expect((await m.objeto.administrar("ajustes", { clave: "bienvenida_cerrada", valor: 1 })).estado).toBe(200);
    const p = m.persona("usr_uno");
    expect((await m.gratis(p.token)).cuerpo).toMatchObject({ regalo: "lleno" });
    await vaciar();
    expect(m.alarma()).toBeNull();
  });

  it("de punta a punta: a los 21 minutos la alarma manda un correo, el estado lo cuenta y la dirección no queda en ningún lado", async () => {
    const m = montar(PRENDIDO);
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    vi.setSystemTime(new Date(T0 + 19 * MINUTO));
    await m.disparar();
    expect(m.mandados).toHaveLength(0);
    expect(m.alarma()).toBe(T0 + ESPERA_CORREO_MS);
    vi.setSystemTime(new Date(T0 + 21 * MINUTO));
    await m.disparar();
    expect(m.mandados.map((x) => x.to)).toEqual([correoDe("usr_uno")]);
    // Otra vuelta no vuelve a escribirle.
    await m.disparar();
    expect(m.mandados).toHaveLength(1);
    const estado = await estadoDe(m);
    expect(estado.correoBienvenida).toMatchObject({ prendido: true, enviados: 1, hoy: { intentados: 1, cuotaAgotada: false }, topeDia: 25 });
    const guardado = JSON.stringify((await m.objeto.administrar("exportar")).cuerpo);
    expect(guardado).not.toContain(correoDe("usr_uno"));
    expect(guardado).not.toContain("Quinua");
    const registro = JSON.stringify([...vi.mocked(console.log).mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(registro).not.toContain(correoDe("usr_uno"));
    expect(registro).not.toContain("usr_uno");
    expect(console.log).toHaveBeenCalledWith(JSON.stringify({ evento: "correo-bienvenida", codigo: "enviado" }));
  });

  it("la alarma del correo no demora a los sellos ni a los pagos: algo en el aire la adelanta a 20 segundos", async () => {
    const m = montar(PRENDIDO);
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    expect(m.alarma()).toBe(T0 + ESPERA_CORREO_MS);
    const t = armarPago({ firmante: Keypair.random(), forma: "retiro", cobros: COBROS });
    expect((await m.objeto.pagoClasico("retiro", t.xdr)).estado).toBe(200);
    await vaciar();
    expect(m.alarma()).toBe(T0 + 20_000);
  });

  it("un envío que nunca termina no frena las otras partes: los sellos corren antes y la alarma termina al pasar el tope", async () => {
    const orden: string[] = [];
    const lento = enlaceDeMentira(() => {
      orden.push("correo");
      return new Promise(() => {});
    });
    const m = montar(PRENDIDO, { enlace: lento.enlace });
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    const reconciliar = Portero.prototype.reconciliar;
    vi.spyOn(Portero.prototype, "reconciliar").mockImplementation(function (this: Portero) {
      orden.push("sellos");
      return reconciliar.call(this);
    });
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(T0 + 21 * MINUTO));
    const vuelta = m.disparar();
    await vi.advanceTimersByTimeAsync(TOPE_PERSONA_MS);
    await vuelta;
    expect(orden).toEqual(["sellos", "correo"]);
    expect((await estadoDe(m)).correoBienvenida).toMatchObject({ errores: 1, enviados: 0 });
  });

  it("el freno y el tope por día se ponen sin desplegar, con su techo, y reabrir pide la alarma enseguida", async () => {
    const m = montar(PRENDIDO);
    const ajustar = (clave: string, valor: number) => m.objeto.administrar("ajustes", { clave, valor });
    expect((await ajustar("correo_bienvenida_cerrado", 2)).estado).toBe(400);
    expect((await ajustar("correo_bienvenida_dia", 1001)).estado).toBe(400);
    expect((await ajustar("correo_bienvenida_cerrado", 1)).estado).toBe(200);
    expect((await ajustar("correo_bienvenida_dia", 1000)).estado).toBe(200);
    expect(m.alarma()).toBeNull();
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    // Cerrado: ni alarma ni correo.
    expect(m.alarma()).toBeNull();
    vi.setSystemTime(new Date(T0 + 21 * MINUTO));
    expect((await ajustar("correo_bienvenida_cerrado", 0)).estado).toBe(200);
    expect(m.alarma()).toBe(T0 + 21 * MINUTO + 20_000);
    await m.disparar();
    expect(m.mandados).toHaveLength(1);
    expect((await estadoDe(m)).correoBienvenida).toMatchObject({ topeDia: 1000, cerrado: false });
  });
});

describe("wrangler.toml: el correo nace apagado en mainnet y no existe en testnet", () => {
  const texto = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  /** Lo que queda desde la sección del portero de mainnet hasta el final, sin comentarios. */
  const mainnet = texto
    .slice(texto.indexOf("[env.mainnet]"))
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .filter((l) => l && !l.startsWith("#"));
  const arriba = texto.slice(0, texto.indexOf("[env.mainnet]"));
  const variable = (nombre: string) => mainnet.find((l) => l.startsWith(`${nombre} =`))?.split("=")[1]?.trim();

  it("la variable nace en 0, el remitente tiene forma de correo y el enlace se llama CORREO", () => {
    expect(variable("CORREO_BIENVENIDA")).toBe('"0"');
    expect(esCorreo(JSON.parse(variable("CORREO_DE") ?? '""') as string)).toBe(true);
    const enlace = mainnet.indexOf("[[env.mainnet.send_email]]");
    expect(enlace).toBeGreaterThan(-1);
    expect(mainnet[enlace + 1]).toBe('name = "CORREO"');
  });

  it("con las variables del archivo el correo está apagado y no falta nada; con la variable en 1 se prende sin que falte nada", () => {
    const vars = Object.fromEntries(
      mainnet.flatMap((l) => {
        const m = /^([A-Z_]+)\s*=\s*"([^"]*)"$/.exec(l);
        return m ? [[m[1] as string, m[2] as string]] : [];
      }),
    );
    expect(leerConfig(vars)).toMatchObject({ correoBienvenida: false, faltaAltas: [] });
    expect(leerConfig({ ...vars, CORREO_BIENVENIDA: "1" })).toMatchObject({ correoBienvenida: true, faltaAltas: [] });
  });

  it("el portero de testnet no tiene ni el enlace ni las variables del correo", () => {
    expect(arriba).not.toContain("send_email");
    expect(arriba).not.toContain("CORREO_BIENVENIDA");
  });
});

describe("lo que falta para prenderlo", () => {
  it("sin el enlace de envío no se llama a nadie y el estado dice qué falta", async () => {
    const m = montar(PRENDIDO, { enlace: null });
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    expect(m.alarma()).toBeNull();
    expect((await estadoDe(m)).correoBienvenida).toEqual({ prendido: false, falta: ["correo-enlace"] });
    expect(m.ajustes()).toEqual([]);
  });

  it("sin un remitente con forma de correo no sale y queda anotado en lo que falta de las altas", async () => {
    const m = montar({ CORREO_BIENVENIDA: "1", CORREO_DE: "no es un correo" });
    const p = m.persona("usr_uno");
    await m.gratis(p.token);
    await vaciar();
    expect(m.alarma()).toBeNull();
    const estado = await estadoDe(m);
    expect(estado.faltaAltas).toContain("correo-de");
    expect(Object.keys(estado)).not.toContain("correoBienvenida");
  });

  it("sin la llave del proveedor de cuentas no se arma y no se llama a nadie", async () => {
    const m = montar({ ...PRENDIDO, POLLAR_SECRETO: "" });
    expect((await estadoDe(m)).correoBienvenida).toEqual({ prendido: false, falta: ["pollar-llave"] });
    vi.setSystemTime(new Date(T0 + 21 * MINUTO));
    await m.disparar();
    expect(m.mandados).toHaveLength(0);
    expect(pedidosPollar).toEqual([]);
  });

  it("en la red de prueba no existe, aunque las variables digan que sí", async () => {
    const m = montar({ ...PRENDIDO, RED: "testnet" });
    expect(Object.keys(await estadoDe(m))).not.toContain("correoBienvenida");
    await m.disparar();
    expect(m.mandados).toHaveLength(0);
    expect(m.ajustes()).toEqual([]);
  });
});
