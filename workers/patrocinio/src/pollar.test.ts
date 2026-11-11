import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { ESPERA_POLLAR_MS, MEMORIA_CREDITOS_MS, MEMORIA_SESION_MS, Pollar, ULTIMO_CREDITOS_MS, formaDeToken, pollarDe } from "./pollar";
import { POLLAR_SERVIDOR } from "./servidores";

const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
/** Inventados, solo para las pruebas: ni la llave ni la app existen. */
const SECRETO = "sec_mainnet_prueba_inventada_0000000000";
const APP = "app_mainnet_inventada";
const USUARIO = "usr_123";
const G = Keypair.random().publicKey();
const OTRA_G = Keypair.random().publicKey();

const b64url = (s: string) => Buffer.from(s).toString("base64url");
/** Un token con forma de JWT que vence en `exp` (segundos). */
const jwt = (exp: number | undefined) => `${b64url('{"alg":"ES256"}')}.${b64url(JSON.stringify(exp === undefined ? { sub: "x" } : { sub: "x", exp }))}.${b64url("firma-inventada")}`;
const TOKEN = jwt(Math.floor(T0 / 1000) + 3600);

interface Llamada {
  url: string;
  init: RequestInit | undefined;
}

/** Un Pollar de mentira: contesta lo que diga `responder` y anota cada pedido. */
function pollarFalso(responder: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return responder(new URL(url), init);
  };
  return { llamadas, fetch };
}

const ok = (content: unknown, code: string) => new Response(JSON.stringify({ content, code, success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
const error = (status: number, code: string) => new Response(JSON.stringify({ code, success: false }), { status, headers: { "Content-Type": "application/json" } });
const verificado = (extra: Record<string, unknown> = {}) =>
  ok({ userId: USUARIO, applicationId: APP, expiresAt: new Date(T0 + 3_600_000).toISOString(), network: "mainnet", wallet: null, profile: {}, authProvider: "google", ...extra }, "SERVER_TOKEN_VERIFIED");

function montar(responder: Parameters<typeof pollarFalso>[0], extra: Partial<ConstructorParameters<typeof Pollar>[0]> = {}) {
  let ahora = T0;
  const anotado: unknown[] = [];
  const falso = pollarFalso(responder);
  const p = new Pollar({ secreto: SECRETO, appId: APP, fetch: falso.fetch, reloj: () => ahora, registrar: (e, d) => anotado.push([e, d]), ...extra });
  return { p, falso, anotado, mover: (ms: number) => (ahora += ms), hora: () => ahora };
}

describe("la forma del token, antes de llamar a nadie", () => {
  it("acepta un JWT que no venció y un token opaco", () => {
    expect(formaDeToken(TOKEN, T0)).toBe(true);
    expect(formaDeToken(jwt(undefined), T0)).toBe(true);
    expect(formaDeToken(`tok_${"a".repeat(40)}`, T0)).toBe(true);
  });

  it("rechaza lo corto, lo largo, lo raro, lo vencido y lo que no es un JWT de tres partes", () => {
    for (const t of [undefined, null, 12, "", "a".repeat(19), "a".repeat(4097), `tok ${"a".repeat(30)}`, `tok<${"a".repeat(30)}`, `${"a".repeat(30)}\n`]) expect(formaDeToken(t, T0)).toBe(false);
    expect(formaDeToken(jwt(Math.floor(T0 / 1000) - 1), T0)).toBe(false);
    expect(formaDeToken(`${"a".repeat(20)}.${"b".repeat(20)}`, T0)).toBe(false);
    expect(formaDeToken(`${"a".repeat(20)}..${"b".repeat(20)}`, T0)).toBe(false);
    expect(formaDeToken(`${b64url("{}")}.${b64url("no es json")}.${b64url("x".repeat(20))}`, T0)).toBe(false);
    expect(formaDeToken(`${b64url("{}")}.${b64url('{"exp":"mañana"}')}.${b64url("x".repeat(20))}`, T0)).toBe(false);
  });
});

describe("verificar", () => {
  it("pregunta a tokens/verify con la llave en x-pollar-api-key y devuelve quién es", async () => {
    const { p, falso } = montar(() => verificado({ wallet: { publicKey: G } }));
    expect(await p.verificar(TOKEN)).toEqual({ ok: true, usuario: USUARIO, vence: T0 + 3_600_000, cuenta: G });
    expect(falso.llamadas).toHaveLength(1);
    const [l] = falso.llamadas;
    expect(l?.url).toBe(`${POLLAR_SERVIDOR}/v3/tokens/verify`);
    expect(l?.init?.method).toBe("POST");
    expect(new Headers(l?.init?.headers).get("x-pollar-api-key")).toBe(SECRETO);
    expect(JSON.parse(String(l?.init?.body))).toEqual({ token: TOKEN });
    // El token va en el cuerpo, nunca en la dirección.
    expect(l?.url).not.toContain(TOKEN.slice(0, 20));
  });

  it("un token con forma rara no llama a Pollar", async () => {
    const { p, falso } = montar(() => verificado());
    for (const t of ["corto", `tok ${"a".repeat(30)}`, jwt(Math.floor(T0 / 1000) - 10)]) expect(await p.verificar(t)).toEqual({ ok: false, motivo: "sesion" });
    expect(falso.llamadas).toHaveLength(0);
  });

  it("401 de Pollar es la sesión; 403 SDK_TOKEN_WRONG_APPLICATION es otra app", async () => {
    expect(await montar(() => error(401, "SDK_AUTH_INVALID_TOKEN")).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect(await montar(() => error(401, "SDK_AUTH_TOKEN_EXPIRED")).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect(await montar(() => error(403, "SDK_TOKEN_WRONG_APPLICATION")).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "otra-app" });
  });

  it("verificado pero de otra app, o de la red de prueba, no pasa", async () => {
    expect(await montar(() => verificado({ applicationId: "app_de_otro" })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "otra-app" });
    expect(await montar(() => verificado({ network: "testnet" })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "otra-app" });
    expect(await montar(() => verificado({ network: "TESTNET" })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "otra-app" });
  });

  it("un token que Pollar da por vencido no pasa, con la fecha en texto o en número", async () => {
    expect(await montar(() => verificado({ expiresAt: new Date(T0 - 1000).toISOString() })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect(await montar(() => verificado({ expiresAt: T0 - 1000 })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect(await montar(() => verificado({ expiresAt: Math.floor(T0 / 1000) - 1 })).p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect((await montar(() => verificado({ expiresAt: Math.floor(T0 / 1000) + 60 })).p.verificar(TOKEN)).ok).toBe(true);
  });

  it("lo que no tiene la forma de la respuesta, un 5xx o un corte es Pollar, y queda en la bitácora", async () => {
    for (const res of [
      () => new Response("no es json", { status: 200 }),
      () => ok({ userId: USUARIO, applicationId: APP, expiresAt: "cuando sea", network: "mainnet" }, "SERVER_TOKEN_VERIFIED"),
      () => ok({ applicationId: APP, expiresAt: T0 + 60_000, network: "mainnet" }, "SERVER_TOKEN_VERIFIED"),
      () => verificado({ network: undefined }),
      () => ok({ userId: USUARIO }, "OTRO_CODIGO"),
      () => error(500, "INTERNAL"),
      () => error(403, "API_KEY_REVOKED"),
      () => {
        throw new TypeError("corte");
      },
    ]) {
      const { p, anotado } = montar(res);
      expect(await p.verificar(TOKEN)).toEqual({ ok: false, motivo: "pollar" });
      expect(anotado.some((b) => (b as [string])[0] === "error-pollar")).toBe(true);
    }
  });

  it("si Pollar no contesta en el tiempo máximo, es Pollar", async () => {
    expect(ESPERA_POLLAR_MS).toBe(8000);
    const { p } = montar(() => new Promise<Response>(() => {}), { esperaMs: 20 });
    expect(await p.verificar(TOKEN)).toEqual({ ok: false, motivo: "pollar" });
  });

  it("se recuerda 60 segundos por la huella del token, y los pedidos a la vez comparten la pregunta", async () => {
    const { p, falso, mover } = montar(() => verificado());
    const [a, b] = await Promise.all([p.verificar(TOKEN), p.verificar(TOKEN)]);
    expect(a).toEqual(b);
    expect(falso.llamadas).toHaveLength(1);
    mover(MEMORIA_SESION_MS - 1);
    await p.verificar(TOKEN);
    expect(falso.llamadas).toHaveLength(1);
    mover(2);
    await p.verificar(TOKEN);
    expect(falso.llamadas).toHaveLength(2);
    // Otro token es otra pregunta.
    await p.verificar(jwt(Math.floor(T0 / 1000) + 7200));
    expect(falso.llamadas).toHaveLength(3);
  });

  it("lo recordado no pasa del vencimiento de la sesión", async () => {
    const { p, falso, mover } = montar(() => verificado({ expiresAt: new Date(T0 + 10_000).toISOString() }));
    expect((await p.verificar(jwt(undefined))).ok).toBe(true);
    mover(10_001);
    expect(await p.verificar(jwt(undefined))).toMatchObject({ ok: false });
    expect(falso.llamadas).toHaveLength(2);
  });

  it("un corte de Pollar no se recuerda: el pedido siguiente vuelve a preguntar", async () => {
    let caido = true;
    const { p, falso } = montar(() => (caido ? error(503, "DOWN") : verificado()));
    expect((await p.verificar(TOKEN)).ok).toBe(false);
    caido = false;
    expect((await p.verificar(TOKEN)).ok).toBe(true);
    expect(falso.llamadas).toHaveLength(2);
  });

  it("la billetera del verify: una G de Stellar sí; otra cadena, la red de prueba o dos distintas, no", async () => {
    const cuenta = async (wallet: unknown) => {
      const r = await montar(() => verificado({ wallet })).p.verificar(TOKEN);
      return r.ok ? r.cuenta : "falla";
    };
    expect(await cuenta(G)).toBe(G);
    expect(await cuenta({ public_key: G, network: "mainnet" })).toBe(G);
    expect(await cuenta({ address: G, chain: "STELLAR" })).toBe(G);
    expect(await cuenta([{ chain: "SOLANA", public_key: "5UfDxxxxxxxx" }, { chain: "STELLAR", public_key: G }])).toBe(G);
    expect(await cuenta({ publicKey: G, chain: "SOLANA" })).toBeNull();
    expect(await cuenta({ publicKey: G, network: "testnet" })).toBeNull();
    expect(await cuenta([G, OTRA_G])).toBeNull();
    expect(await cuenta({ publicKey: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4" })).toBeNull();
    expect(await cuenta(null)).toBeNull();
    expect(await cuenta("0xabc")).toBeNull();
  });
});

describe("billeteraDe", () => {
  const fila = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: "x", email: "x@y.z", providers: ["google"], wallet_public_key: null, wallets: [], ...extra });
  const usuarios = (items: unknown[]) => ok({ items, total: items.length, page: 1, limit: 200, totalPages: 1, stats: {} }, "SERVER_SDK_USERS_LIST");

  const stellar = (public_key: string, network: unknown = "STELLAR") => ({ network, public_key });

  it("busca por el id con la llave y toma la fila exacta aunque otra venga primero", async () => {
    const { p, falso } = montar(() => usuarios([fila(`${USUARIO}9`, { wallet_public_key: OTRA_G, wallets: [stellar(OTRA_G)] }), fila(USUARIO, { wallet_public_key: G, wallets: [stellar(G)] })]));
    expect(await p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: G });
    const [l] = falso.llamadas;
    const u = new URL(String(l?.url));
    expect(u.origin + u.pathname).toBe(`${POLLAR_SERVIDOR}/v3/users`);
    expect(u.searchParams.get("q")).toBe(USUARIO);
    expect(new Headers(l?.init?.headers).get("x-pollar-api-key")).toBe(SECRETO);
  });

  it("sin la fila exacta, o con dos, no se elige nada", async () => {
    expect(await montar(() => usuarios([fila(`${USUARIO}9`, { wallets: [stellar(OTRA_G)] })])).p.billeteraDe(USUARIO)).toEqual({ ok: false });
    expect(await montar(() => usuarios([])).p.billeteraDe(USUARIO)).toEqual({ ok: false });
    expect(await montar(() => usuarios([fila(USUARIO, { wallets: [stellar(G)] }), fila(USUARIO, { wallets: [stellar(OTRA_G)] })])).p.billeteraDe(USUARIO)).toEqual({ ok: false });
  });

  it("la fila sin billetera de Stellar no tiene cuenta todavía", async () => {
    expect(await montar(() => usuarios([fila(USUARIO)])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: null });
    expect(await montar(() => usuarios([fila(USUARIO, { wallet_public_key: "0xabc", wallets: [{ network: "mainnet", chain: "POLYGON", public_key: "0xabc" }] })])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: null });
    expect(await montar(() => usuarios([fila(USUARIO, { wallets: [stellar(G, "testnet")] })])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: null });
  });

  it("wallet_public_key no cuenta, aunque sea una G: solo la billetera de Stellar de wallets", async () => {
    expect(await montar(() => usuarios([fila(USUARIO, { wallet_public_key: G })])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: null });
    expect(await montar(() => usuarios([fila(USUARIO, { wallet_public_key: OTRA_G, wallets: [stellar(G, "mainnet")] })])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: G });
  });

  it("con dos cadenas toma la de Stellar, aunque la principal sea la otra", async () => {
    const f = fila(USUARIO, {
      wallet_public_key: "5UfDxxxxxxxxxxxxxxxxxxxxxxxx",
      wallets: [
        { network: "SOLANA", public_key: "5UfDxxxxxxxxxxxxxxxxxxxxxxxx" },
        { network: "STELLAR", public_key: G },
      ],
    });
    expect(await montar(() => usuarios([f])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: G });
  });

  it("dos billeteras de Stellar distintas es ambiguo: no se elige ninguna", async () => {
    const f = fila(USUARIO, { wallets: [stellar(G), stellar(OTRA_G)] });
    expect(await montar(() => usuarios([f])).p.billeteraDe(USUARIO)).toEqual({ ok: false });
    // La misma dos veces no es ambigua.
    expect(await montar(() => usuarios([fila(USUARIO, { wallets: [stellar(G), stellar(G, "mainnet")] })])).p.billeteraDe(USUARIO)).toEqual({ ok: true, cuenta: G });
  });

  it("un id raro no llama; un error o una respuesta rota es una falla", async () => {
    const { p, falso } = montar(() => usuarios([]));
    expect(await p.billeteraDe("")).toEqual({ ok: false });
    expect(await p.billeteraDe("a".repeat(201))).toEqual({ ok: false });
    expect(falso.llamadas).toHaveLength(0);
    expect(await montar(() => error(500, "X")).p.billeteraDe(USUARIO)).toEqual({ ok: false });
    expect(await montar(() => ok({ nada: 1 }, "SERVER_SDK_USERS_LIST")).p.billeteraDe(USUARIO)).toEqual({ ok: false });
  });
});

describe("creditos", () => {
  const saldo = (available: unknown) => ok({ ledger: 1, billingModel: "PREPAID", available, movements: [] }, "SERVER_BILLING_CREDITS");

  it("lee available con la llave y lo recuerda 60 segundos", async () => {
    let valor: unknown = 1437;
    const { p, falso, mover } = montar(() => saldo(valor));
    expect(await p.creditos()).toEqual({ ok: true, disponibles: 1437, leido: T0, deMemoria: false });
    const u = new URL(String(falso.llamadas[0]?.url));
    // Solo hace falta el saldo: los movimientos, de a uno (la vigilancia de firmas los lee aparte).
    expect(u.origin + u.pathname).toBe(`${POLLAR_SERVIDOR}/v3/billing/credits`);
    expect(u.searchParams.get("limit")).toBe("1");
    expect(new Headers(falso.llamadas[0]?.init?.headers).get("x-pollar-api-key")).toBe(SECRETO);
    valor = "7000.5";
    mover(MEMORIA_CREDITOS_MS - 1);
    expect(await p.creditos()).toMatchObject({ disponibles: 1437, deMemoria: true });
    mover(2);
    expect(await p.creditos()).toMatchObject({ disponibles: 7000.5, deMemoria: false });
    expect(falso.llamadas).toHaveLength(2);
  });

  it("caído, usa el último valor durante 10 minutos; después, no hay valor", async () => {
    let caido = false;
    const { p, mover } = montar(() => (caido ? error(503, "DOWN") : saldo(5000)));
    expect((await p.creditos()).ok).toBe(true);
    caido = true;
    mover(MEMORIA_CREDITOS_MS + 1);
    expect(await p.creditos()).toEqual({ ok: true, disponibles: 5000, leido: T0, deMemoria: true });
    mover(ULTIMO_CREDITOS_MS - MEMORIA_CREDITOS_MS - 2);
    expect(await p.creditos()).toMatchObject({ ok: true, disponibles: 5000 });
    mover(2);
    expect(await p.creditos()).toEqual({ ok: false });
  });

  it("sin ninguna lectura buena no hay valor, y una respuesta rota no cuenta como lectura", async () => {
    expect(await montar(() => error(500, "X")).p.creditos()).toEqual({ ok: false });
    expect(await montar(() => saldo("mucho")).p.creditos()).toEqual({ ok: false });
    expect(await montar(() => saldo(null)).p.creditos()).toEqual({ ok: false });
  });

  it("el último valor puede vivir afuera del objeto (en los ajustes): sobrevive a un reinicio", async () => {
    let guardado: { valor: number; ms: number } | null = null;
    const memoria = { leer: () => guardado, guardar: (valor: number, ms: number) => void (guardado = { valor, ms }) };
    const a = montar(() => saldo(3000), { memoriaCreditos: memoria });
    await a.p.creditos();
    expect(guardado).toEqual({ valor: 3000, ms: T0 });
    const b = montar(() => error(503, "DOWN"), { memoriaCreditos: memoria });
    b.mover(5 * 60_000);
    expect(await b.p.creditos()).toMatchObject({ ok: true, disponibles: 3000 });
  });
});

describe("la llave y el token nunca salen de donde tienen que ir", () => {
  it("un registrador espía no ve el token, la llave, el usuario ni la cuenta, pase lo que pase", async () => {
    const espia: string[] = [];
    const casos = [() => verificado({ wallet: G }), () => error(500, "X"), () => error(401, "SDK_AUTH_INVALID_TOKEN"), () => new Response("roto", { status: 200 })];
    for (const c of casos) {
      const p = new Pollar({ secreto: SECRETO, appId: APP, fetch: async () => c(), reloj: () => T0, registrar: (e, d) => espia.push(JSON.stringify([e, d])) });
      await p.verificar(TOKEN);
      await p.billeteraDe(USUARIO);
      await p.creditos();
    }
    const todo = espia.join("\n");
    expect(espia.length).toBeGreaterThan(0);
    for (const prohibido of [TOKEN, TOKEN.slice(0, 24), SECRETO, USUARIO, G]) expect(todo).not.toContain(prohibido);
  });

  it("solo habla con el servidor fijo de Pollar", async () => {
    const urls: string[] = [];
    const p = new Pollar({ secreto: SECRETO, appId: APP, fetch: async (u) => (urls.push(u), error(500, "X")), reloj: () => T0 });
    await p.verificar(TOKEN);
    await p.billeteraDe("../../otro.example/x");
    await p.creditos();
    for (const u of urls) expect(new URL(u).origin).toBe(POLLAR_SERVIDOR);
  });

  it("sin llave, con una de la red de prueba o sin la app, no se arma", () => {
    const f = async () => error(500, "X");
    expect(() => new Pollar({ secreto: "", appId: APP, fetch: f })).toThrow();
    expect(() => new Pollar({ secreto: "sec_testnet_inventada_000000", appId: APP, fetch: f })).toThrow();
    expect(() => new Pollar({ secreto: SECRETO, appId: "", fetch: f })).toThrow();
    expect(pollarDe({ secreto: undefined, appId: APP, fetch: f })).toBeNull();
    expect(pollarDe({ secreto: SECRETO, appId: null, fetch: f })).toBeNull();
    expect(pollarDe({ secreto: "sec_testnet_inventada_000000", appId: APP, fetch: f })).toBeNull();
    expect(pollarDe({ secreto: SECRETO, appId: APP, fetch: f })).toBeInstanceOf(Pollar);
  });
});

describe("conocida: si Pollar ya dio este token por bueno", () => {
  it("no antes de preguntar; sí después, también pasado el minuto de memoria y hasta que vence; nunca uno rechazado o sin forma", async () => {
    let valido = true;
    const { p, falso, mover } = montar(() => (valido ? verificado() : error(401, "SDK_AUTH_INVALID_TOKEN")));
    expect(await p.conocida(TOKEN)).toBe(false);
    expect(falso.llamadas).toHaveLength(0);
    expect((await p.verificar(TOKEN)).ok).toBe(true);
    expect(await p.conocida(TOKEN)).toBe(true);
    mover(MEMORIA_SESION_MS + 1);
    expect(await p.conocida(TOKEN)).toBe(true);
    // Saber si es conocida no le pregunta nada a Pollar.
    expect(falso.llamadas).toHaveLength(1);
    // Si Pollar después dice que no vale, deja de ser conocida.
    valido = false;
    expect(await p.verificar(TOKEN)).toEqual({ ok: false, motivo: "sesion" });
    expect(await p.conocida(TOKEN)).toBe(false);
    for (const t of [null, undefined, "corto", 12]) expect(await p.conocida(t)).toBe(false);
  });

  it("deja de ser conocida cuando vence la sesión", async () => {
    const { p, mover } = montar(() => verificado({ expiresAt: new Date(T0 + 10 * 60_000).toISOString() }));
    expect((await p.verificar(TOKEN)).ok).toBe(true);
    mover(10 * 60_000 - 1);
    expect(await p.conocida(TOKEN)).toBe(true);
    mover(2);
    expect(await p.conocida(TOKEN)).toBe(false);
  });
});
