/**
 * Un `fetch` de mentira para las pruebas del cliente de la sala de una campaña: contesta lo que diga un guion, sin red y
 * sin reloj propio. Un paso es una respuesta, `colgado` (no contesta nunca, hasta que lo corta el tope) o `corte` (falla
 * la red). Cuando el guion se acaba, repite el último paso.
 */

export type Paso =
  | { estado: number; cuerpo?: unknown; texto?: string; cabeceras?: Record<string, string> }
  | "colgado"
  | "corte";

export interface Llamada {
  url: string;
  init: RequestInit;
  /** El último tramo de la ruta (`alta`, `yo`, `estado`...). */
  ruta: string;
  /** La hora del reloj cuando salió el pedido. */
  en: number;
}

function responder(paso: Paso | undefined, init: RequestInit | undefined): Promise<Response> {
  if (paso === "corte") return Promise.reject(new TypeError("Failed to fetch"));
  if (paso === "colgado" || paso === undefined) {
    return new Promise<Response>((_resolver, rechazar) => {
      init?.signal?.addEventListener("abort", () => rechazar(new DOMException("tiempo vencido", "AbortError")), { once: true });
    });
  }
  const texto = paso.texto ?? JSON.stringify(paso.cuerpo ?? {});
  return Promise.resolve(new Response(texto, { status: paso.estado, headers: paso.cabeceras }));
}

/** Un guion para todas las rutas, o uno por cada último tramo de la ruta. */
export function fetchFalso(guion: Paso[] | Record<string, Paso[]>): { f: typeof fetch; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const cuentas = new Map<string, number>();
  const f: typeof fetch = (url, init) => {
    const direccion = String(url);
    const ruta = new URL(direccion).pathname.split("/").pop() ?? "";
    const pasos = Array.isArray(guion) ? guion : guion[ruta] ?? [];
    const n = cuentas.get(ruta) ?? 0;
    cuentas.set(ruta, n + 1);
    llamadas.push({ url: direccion, init: init ?? {}, ruta, en: Date.now() });
    return responder(pasos[Math.min(n, pasos.length - 1)], init);
  };
  return { f, llamadas };
}
