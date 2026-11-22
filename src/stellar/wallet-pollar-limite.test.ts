import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { almacenEnMemoria, reiniciar } from "./pollar-falso";

/**
 * El límite del servicio de cuentas (un 429), visto desde la billetera: cuántos segundos dicen sus encabezados, cómo se
 * mira sin tocar, y qué pasa con el cliente del kit cuando la página del celular lo suelta después de anotarse y lo vuelve a
 * armar. Con el cliente simulado (`pollar-falso.ts`).
 */

const h = await vi.hoisted(async () => (await import("./pollar-falso")).estadoPollarFalso());

vi.mock("./config", async (orig) => ({ ...(await orig<typeof import("./config")>()), network: h.red }));
vi.mock("@pollar/core", async (orig) => {
  const real = await orig<typeof import("@pollar/core")>();
  const { clienteFalso } = await import("./pollar-falso");
  return { ...real, PollarClient: clienteFalso(h) };
});

const { pollarWallet, esperaDelLimite, mirarLimites, mirarPedidoDeIngreso, ESPERA_POR_LIMITE_MS, TOPE_DE_ESPERA_POR_LIMITE_S } = await import("./wallet-pollar");

const P = "GDVZABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRS5ZLE";
const AHORA = Date.UTC(2026, 10, 22, 15);

/** Los encabezados que lee la función: los de la lista, sin distinguir mayúsculas, y null con los demás. */
const encabezados = (lista: Record<string, string>) => (nombre: string): string | null => lista[nombre.toLowerCase()] ?? null;

describe("esperaDelLimite", () => {
  it("lee Retry-After en segundos", () => {
    expect(esperaDelLimite(encabezados({ "retry-after": "30" }), AHORA)).toBe(30);
  });

  it("lee Retry-After como una fecha", () => {
    const fecha = new Date(AHORA + 45_000).toUTCString();
    expect(esperaDelLimite(encabezados({ "retry-after": fecha }), AHORA)).toBe(45);
  });

  it("lee RateLimit-Reset y X-RateLimit-Reset, en segundos o como hora de reloj", () => {
    expect(esperaDelLimite(encabezados({ "ratelimit-reset": "17" }), AHORA)).toBe(17);
    expect(esperaDelLimite(encabezados({ "x-ratelimit-reset": String(Math.floor(AHORA / 1000) + 20) }), AHORA)).toBe(20);
  });

  it("lee la forma junta del encabezado RateLimit", () => {
    expect(esperaDelLimite(encabezados({ ratelimit: "limit=20, remaining=0, reset=42" }), AHORA)).toBe(42);
    expect(esperaDelLimite(encabezados({ ratelimit: '"default";r=0;t=17' }), AHORA)).toBe(17);
  });

  it("queda entre 1 y el tope, y un valor raro no deja a nadie afuera", () => {
    expect(esperaDelLimite(encabezados({ "retry-after": "0" }), AHORA)).toBe(1);
    expect(esperaDelLimite(encabezados({ "retry-after": "86400" }), AHORA)).toBe(TOPE_DE_ESPERA_POR_LIMITE_S);
    expect(esperaDelLimite(encabezados({ "retry-after": "pronto" }), AHORA)).toBeNull();
  });

  it("sin ningún encabezado que sirva, null", () => {
    expect(esperaDelLimite(encabezados({}), AHORA)).toBeNull();
  });
});

describe("mirarLimites", () => {
  const cliente = () => {
    const miradores: Array<{ onRequest: () => unknown; onResponse: (x: unknown) => unknown }> = [];
    return {
      miradores,
      _api: {
        use: (m: (typeof miradores)[number]) => void miradores.push(m),
        eject: (m: (typeof miradores)[number]) => void miradores.splice(miradores.indexOf(m), 1),
      },
    };
  };
  const respuesta = (status: number, cabeceras: Record<string, string> = {}) => ({ response: new Response(null, { status, headers: cabeceras }) });

  it("avisa con los segundos del encabezado cuando el servicio rechaza por límite", () => {
    const c = cliente();
    const aviso = vi.fn();
    expect(mirarLimites(c, aviso)).toBeTypeOf("function");
    c.miradores[0]?.onResponse(respuesta(429, { "retry-after": "12" }));
    expect(aviso).toHaveBeenCalledWith(12);
  });

  it("avisa con null si el rechazo no deja leer cuánto esperar", () => {
    const c = cliente();
    const aviso = vi.fn();
    mirarLimites(c, aviso);
    c.miradores[0]?.onResponse(respuesta(429));
    expect(aviso).toHaveBeenCalledWith(null);
  });

  it("no avisa con ninguna otra respuesta y no cambia ninguna", () => {
    const c = cliente();
    const aviso = vi.fn();
    mirarLimites(c, aviso);
    for (const estado of [200, 401, 404, 500]) expect(c.miradores[0]?.onResponse(respuesta(estado))).toBeUndefined();
    expect(c.miradores[0]?.onRequest()).toBeUndefined();
    expect(aviso).not.toHaveBeenCalled();
  });

  it("deja de mirar al soltarlo, y un SDK que no deja mirar no corta nada", () => {
    const c = cliente();
    const soltar = mirarLimites(c, vi.fn());
    expect(c.miradores).toHaveLength(1);
    soltar?.();
    expect(c.miradores).toHaveLength(0);
    expect(mirarLimites({}, vi.fn())).toBeNull();
    expect(mirarLimites(null, vi.fn())).toBeNull();
  });

  it("lo que haga quien escucha no corta el pedido", () => {
    const c = cliente();
    mirarLimites(c, () => {
      throw new Error("falla de quien escucha");
    });
    expect(() => c.miradores[0]?.onResponse(respuesta(429, { "retry-after": "5" }))).not.toThrow();
  });
});

describe("el mirador de la entrada también ve los límites, sin sumar otro", () => {
  const cliente = () => {
    const miradores: Array<{ onRequest: (x: unknown) => unknown; onResponse?: (x: unknown) => unknown }> = [];
    return {
      miradores,
      _api: {
        use: (m: (typeof miradores)[number]) => void miradores.push(m),
        eject: (m: (typeof miradores)[number]) => void miradores.splice(miradores.indexOf(m), 1),
      },
    };
  };

  it("con el aviso del límite, el mismo mirador de los pedidos de ingreso mira las respuestas", () => {
    const c = cliente();
    const alLimite = vi.fn();
    const ingreso = vi.fn();
    mirarPedidoDeIngreso(c, ingreso, alLimite);
    // Un solo mirador mientras se entra: la entrada cuenta con eso.
    expect(c.miradores).toHaveLength(1);
    c.miradores[0]?.onRequest({ request: { method: "POST" }, schemaPath: "/auth/login" });
    expect(ingreso).toHaveBeenCalledTimes(1);
    c.miradores[0]?.onResponse?.({ response: new Response(null, { status: 429, headers: { "retry-after": "9" } }) });
    expect(alLimite).toHaveBeenCalledWith(9);
    c.miradores[0]?.onResponse?.({ response: new Response(null, { status: 200 }) });
    expect(alLimite).toHaveBeenCalledTimes(1);
  });

  it("sin el aviso del límite no mira respuestas: como siempre", () => {
    const c = cliente();
    const soltar = mirarPedidoDeIngreso(c, vi.fn());
    expect(c.miradores[0]?.onResponse).toBeUndefined();
    soltar?.();
    expect(c.miradores).toHaveLength(0);
  });
});

describe("el límite anotado en la billetera", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin rechazos no hay límite", () => {
    expect(pollarWallet.segundosDeLimite()).toBeNull();
  });

  it("con los segundos que dijo el servicio baja hasta liberarse", () => {
    pollarWallet.anotarLimite(30);
    expect(pollarWallet.segundosDeLimite()).toBe(30);
    vi.advanceTimersByTime(12_400);
    expect(pollarWallet.segundosDeLimite()).toBe(18);
    vi.advanceTimersByTime(18_000);
    expect(pollarWallet.segundosDeLimite()).toBeNull();
  });

  it("sin los segundos usa una espera corta, y un rechazo más corto no acorta el que ya había", () => {
    pollarWallet.anotarLimite(null);
    expect(pollarWallet.segundosDeLimite()).toBe(ESPERA_POR_LIMITE_MS / 1000);
    pollarWallet.anotarLimite(5);
    expect(pollarWallet.segundosDeLimite()).toBe(ESPERA_POR_LIMITE_MS / 1000);
    vi.advanceTimersByTime(ESPERA_POR_LIMITE_MS);
    expect(pollarWallet.segundosDeLimite()).toBeNull();
  });
});

describe("soltar el cliente después de anotarse y volver a armarlo", () => {
  beforeEach(async () => {
    // Solo la fecha: una hora lejos de los límites que anotaron las pruebas de arriba, que viven en la billetera de la prueba.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AHORA + 3_600_000);
    reiniciar(h);
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_MAINNET", "pub_mainnet_prueba");
    vi.stubEnv("VITE_POLLAR_PUBLISHABLE_KEY_TESTNET", "pub_testnet_prueba");
    vi.stubGlobal("sessionStorage", almacenEnMemoria());
    vi.stubGlobal("localStorage", almacenEnMemoria());
    h.billetera = { address: P, provisioning: "READY", existsOnStellar: true };
    h.verificada = true;
    h.token = "eyJ0b2tlbi1kZS1wcnVlYmE.parte-dos.parte-tres";
    // La marca de que este navegador entró con Google: sin ella no hay sesión que retomar.
    localStorage.setItem("tinkazo.pollar.intent.mainnet", "google");
  });

  afterEach(async () => {
    await pollarWallet.disconnect();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("suelta el cliente sin cerrar la sesión: se llama a destroy y nunca a logout", async () => {
    await pollarWallet.asegurarLaSesion();
    expect(h.construidos).toBe(1);
    expect(pollarWallet.soltarElCliente()).toBe(true);
    expect(h.llamadas).toContain("destroy");
    expect(h.llamadas).not.toContain("logout");
    // La marca de la sesión queda: volver a armar la retoma.
    expect(localStorage.getItem("tinkazo.pollar.intent.mainnet")).toBe("google");
  });

  it("soltarlo dos veces, o sin cliente, no hace nada", async () => {
    expect(pollarWallet.soltarElCliente()).toBe(false);
    await pollarWallet.asegurarLaSesion();
    expect(pollarWallet.soltarElCliente()).toBe(true);
    expect(pollarWallet.soltarElCliente()).toBe(false);
    expect(h.llamadas.filter((l) => l === "destroy")).toHaveLength(1);
  });

  it("con el cliente soltado no hay token, y asegurarLaSesion lo arma de nuevo y retoma la cuenta", async () => {
    await pollarWallet.asegurarLaSesion();
    expect(await pollarWallet.tokenDeSesion(10)).toBe(h.token);
    pollarWallet.soltarElCliente();
    expect(await pollarWallet.tokenDeSesion(10)).toBeNull();
    expect(await pollarWallet.asegurarLaSesion()).toBe(P);
    expect(h.construidos).toBe(2);
    expect(await pollarWallet.tokenDeSesion(10)).toBe(h.token);
  });

  it("con el cliente armado, asegurarLaSesion no arma otro ni pide nada", async () => {
    await pollarWallet.asegurarLaSesion();
    await pollarWallet.asegurarLaSesion();
    await pollarWallet.asegurarLaSesion();
    expect(h.construidos).toBe(1);
    expect(h.llamadas.filter((l) => l === "ready")).toHaveLength(1);
  });

  it("sin la marca de una sesión no hay nada que retomar y no se arma ningún cliente", async () => {
    localStorage.removeItem("tinkazo.pollar.intent.mainnet");
    expect(await pollarWallet.asegurarLaSesion()).toBeNull();
    expect(h.construidos).toBe(0);
  });

  it("al retomar la sesión mira los rechazos por límite y los anota, y al soltar el cliente deja de mirar", async () => {
    await pollarWallet.asegurarLaSesion();
    expect(h.miradores).toHaveLength(1);
    // Retomar otra vez, con el cliente armado, no suma otro mirador.
    await pollarWallet.restore();
    expect(h.miradores).toHaveLength(1);
    expect(pollarWallet.segundosDeLimite()).toBeNull();
    h.miradores[0]?.onResponse?.({ response: new Response(null, { status: 429, headers: { "retry-after": "7" } }) });
    expect(pollarWallet.segundosDeLimite()).toBe(7);
    pollarWallet.soltarElCliente();
    expect(h.miradores).toHaveLength(0);
  });

  it("oír los cambios de la cuenta sin armar no retoma la sesión", () => {
    const aviso = vi.fn();
    const soltar = pollarWallet.alCambiarLaCuenta(aviso, { armar: false });
    expect(h.construidos).toBe(0);
    soltar();
  });
});
