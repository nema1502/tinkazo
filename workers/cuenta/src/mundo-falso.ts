import { type HorizonFalso, type OpcionesDelHorizonFalso, horizonFalso } from "./horizon-falso";
import { PorIp } from "./por-ip";
import type { Cuenta } from "./reglas";
import { type Entorno, type Libro, servir } from "./servidor";

/**
 * Todo el servicio de mentira, junto, para las pruebas del sitio: un `fetch` que contesta `cuenta.tinkazo.app` con el
 * Worker de verdad (`servir`, con un libro en memoria y un reloj que se mueve a mano) y a Horizon con el de mentira.
 * Así las pantallas se prueban contra las mismas reglas que el Worker. Solo lo usan las pruebas.
 */

export const BASE = "https://cuenta.tinkazo.app";
/** El token de quien organiza, y su huella (lo que guarda el Worker). */
export const TOKEN = "token-de-quien-organiza-0123456789";

export const sha256Hex = async (t: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))), (b) => b.toString(16).padStart(2, "0")).join("");

export class LibroEnMemoria implements Libro {
  datos = new Map<string, string>();
  async get(k: string): Promise<string | null> {
    return this.datos.get(k) ?? null;
  }
  async put(k: string, v: string): Promise<void> {
    this.datos.set(k, v);
  }
}

export interface MundoFalso {
  fetch: typeof fetch;
  libro: LibroEnMemoria;
  horizon: HorizonFalso;
  reloj: { ahora: number };
  /** Lo que el Worker tiene guardado de una cuenta. */
  guardada(cuenta: string): Cuenta | null;
  /** Le pone datos a una cuenta, como si ya los tuviera. */
  poner(cuenta: string, datos: Partial<Cuenta>): void;
}

export async function mundoFalso(o: { horizon?: OpcionesDelHorizonFalso; env?: Partial<Entorno>; ahora?: number } = {}): Promise<MundoFalso> {
  const libro = new LibroEnMemoria();
  const horizon = horizonFalso(o.horizon);
  const reloj = { ahora: o.ahora ?? 1_790_000_000_000 };
  const env: Entorno = { CUENTAS: libro, RED: "testnet", HUELLAS_ORGANIZADORES: await sha256Hex(TOKEN), ...o.env };
  const dep = { fetch: horizon.fetch, ahora: () => reloj.ahora, leer: new PorIp(), escribir: new PorIp(), canjes: new PorIp(), planes: new PorIp() };
  const router = (async (entrada: string | URL | Request, init: RequestInit = {}) => {
    const url = String(entrada);
    if (!url.startsWith(BASE)) return horizon.fetch(entrada, init);
    const h = new Headers(init.headers);
    h.set("Origin", "https://tinkazo.app");
    h.set("CF-Connecting-IP", "1.2.3.4");
    const cuerpo = typeof init.body === "string" ? init.body : undefined;
    if (cuerpo !== undefined) h.set("Content-Length", String(new TextEncoder().encode(cuerpo).length));
    return servir(new Request(url, { method: init.method ?? "GET", headers: h, ...(cuerpo !== undefined ? { body: cuerpo } : {}) }), env, dep);
  }) as typeof fetch;
  return {
    fetch: router,
    libro,
    horizon,
    reloj,
    guardada: (c) => {
      const x = libro.datos.get(`c:${c}`);
      return x ? (JSON.parse(x) as Cuenta) : null;
    },
    poner: (c, datos) =>
      void libro.datos.set(`c:${c}`, JSON.stringify({ v: 1, saldo: 0, hechos: {}, historial: [], canjes: [], ids: [], refs: [], ...datos })),
  };
}
