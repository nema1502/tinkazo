import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUICKNET, fetchRound } from "./protocol/quicknet";
import { PLAZO_DEL_RELAY_MS, conPlazo } from "./pedido-con-plazo";

/**
 * Un relay de la fuente del número que acepta la conexión y no contesta dejaba el sorteo en Esperando el número hasta
 * que cortara el navegador: el bucle de `fetchRound` no rotaba al siguiente. Con un plazo por pedido, el corte cuenta
 * como un relay que falló y se pasa al otro.
 */

const RONDA = 123;
const FIRMA = "ab".repeat(48);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** El primer relay se cuelga (solo suelta si lo abortan). Los demás contestan con la firma. */
function fetchConElPrimeroColgado(): typeof fetch {
  return ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    if (url.startsWith(`${QUICKNET.relays[0]}/`)) {
      return new Promise<Response>((_, rechazar) => {
        init?.signal?.addEventListener("abort", () => rechazar(new DOMException("cortado", "AbortError")), { once: true });
      });
    }
    return Promise.resolve(new Response(JSON.stringify({ round: RONDA, signature: FIRMA }), { status: 200 }));
  }) as typeof fetch;
}

/** Las cuatro fuentes están sanas pero lentas: cada una contesta con la firma a los `ms` (si no la cortan antes). */
function fetchLento(ms: number): typeof fetch {
  return ((_entrada: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolver, rechazar) => {
      const espera = setTimeout(() => resolver(new Response(JSON.stringify({ round: RONDA, signature: FIRMA }), { status: 200 })), ms);
      init?.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(espera);
          rechazar(new DOMException("cortado", "AbortError"));
        },
        { once: true },
      );
    })) as typeof fetch;
}

describe("pedir la ronda con un plazo por pedido", () => {
  it("con el primer relay colgado, la firma sale del segundo", async () => {
    const pedido = fetchRound(RONDA, { attempts: 4, delayMs: 1000, fetchFn: conPlazo(fetchConElPrimeroColgado(), PLAZO_DEL_RELAY_MS) });
    await vi.advanceTimersByTimeAsync(PLAZO_DEL_RELAY_MS + 1000 + 10);
    await expect(pedido).resolves.toEqual({ round: RONDA, signature: FIRMA });
  });

  it("con las cuatro fuentes sanas pero lentas (5 s), el plazo crece en cada vuelta y la firma sale", async () => {
    // Antes de que creciera, cada pedido se cortaba a los 4 s: los 12 intentos fallaban y el sorteo quedaba en
    // Reintentar, cuando sin plazo habría salido a los 5 s.
    const pedido = fetchRound(RONDA, { fetchFn: conPlazo(fetchLento(5000), PLAZO_DEL_RELAY_MS) });
    const resultado = pedido.then(
      (r) => r,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await resultado).toEqual({ round: RONDA, signature: FIRMA });
  });

  it("el plazo crece por dirección: la primera vuelta corta a los 4 s y la segunda deja pasar un pedido de 5 s", async () => {
    const fetchFn = conPlazo(fetchLento(5000), PLAZO_DEL_RELAY_MS);
    const url = `${QUICKNET.relays[0]}/x`;
    const primero = fetchFn(url).then(
      () => "salió",
      () => "cortado",
    );
    await vi.advanceTimersByTimeAsync(PLAZO_DEL_RELAY_MS + 10);
    expect(await primero).toBe("cortado");
    const segundo = fetchFn(url).then(
      () => "salió",
      () => "cortado",
    );
    await vi.advanceTimersByTimeAsync(5000 + 10);
    expect(await segundo).toBe("salió");
  });

  it("el plazo tiene techo: una fuente que tarda más que la última vuelta falla y no queda esperando para siempre", async () => {
    const pedido = fetchRound(RONDA, { fetchFn: conPlazo(fetchLento(40_000), PLAZO_DEL_RELAY_MS) });
    const resultado = pedido.then(
      () => "salió",
      () => "falló",
    );
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await resultado).toBe("falló");
  });

  it("el plazo es corto, para que la sala no espere de más", () => {
    expect(PLAZO_DEL_RELAY_MS).toBeLessThanOrEqual(5000);
  });

  it("un corte de afuera sigue cortando el pedido", async () => {
    const afuera = new AbortController();
    const pedido = conPlazo(fetchConElPrimeroColgado(), PLAZO_DEL_RELAY_MS)(`${QUICKNET.relays[0]}/x`, { signal: afuera.signal });
    const cortado = expect(pedido).rejects.toThrow();
    afuera.abort();
    await cortado;
  });

  it("el sorteo y la verificación piden la ronda con el plazo", () => {
    const draw = readFileSync(new URL("./ui/draw.ts", import.meta.url), "utf8");
    expect(draw).toMatch(/fetchRound\(round, \{[^}]*fetchFn: conPlazo\(/);
    const verify = readFileSync(new URL("./verify.ts", import.meta.url), "utf8");
    expect(verify.match(/fetchRound\([^)]*fetchFn: conPlazo\(/g) ?? []).toHaveLength(2);
  });
});
