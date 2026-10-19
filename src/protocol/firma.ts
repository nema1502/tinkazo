/**
 * Verificar la firma de una ronda sin congelar la página (docs/protocolo.md §6).
 *
 * Un emparejamiento BLS es cálculo puro: unos 100 ms en una computadora y más
 * de un segundo en un celular de gama media (medición del 17 de octubre de
 * 2026, CPU x4). En el hilo de la página eso es la pantalla de verificación
 * que no responde, y en el sorteo, la cortina que se traba justo cuando la
 * sala mira. Acá se hace en un worker, con la misma `verifyRound` de
 * `drand.ts`. Si el navegador no tiene workers, o el del sitio no carga, se
 * hace en el hilo de la página como antes: el resultado no cambia, solo dónde
 * se calcula.
 */

interface Respuesta {
  id: number;
  ok: boolean;
}

/** `undefined`: todavía no se intentó. `null`: no hay worker, se calcula acá. */
let worker: Worker | null | undefined;
let siguiente = 0;
const pendientes = new Map<number, { resolve: (ok: boolean) => void; reject: (e: unknown) => void }>();

function soltar(e: unknown): void {
  worker?.terminate();
  worker = null;
  for (const p of pendientes.values()) p.reject(e);
  pendientes.clear();
}

function hilo(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker !== "function") return null;
  try {
    const w = new Worker(new URL("./bls.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<Respuesta>) => {
      const p = pendientes.get(e.data.id);
      pendientes.delete(e.data.id);
      p?.resolve(e.data.ok);
    };
    // No cargó (sin red, una versión nueva publicada con la pestaña abierta) o
    // se cayó: lo pendiente y lo que venga se calcula en la página.
    w.onerror = (e) => soltar(e);
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Levanta el worker antes de que haga falta, para que la curva ya esté
 * cargada cuando llegue la ronda o el comprobante. No hace nada si ya está.
 */
export function prepararFirma(): void {
  hilo();
}

/** Igual que `verifyRound`, sin trabar la página. Nunca lanza. */
export async function verifyRoundAsync(round: number, signatureHex: string): Promise<boolean> {
  const w = hilo();
  if (w) {
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const id = ++siguiente;
        // Un worker que no contesta no puede dejar el sorteo esperando: a los
        // veinte segundos se calcula en la página.
        const tope = setTimeout(() => {
          pendientes.delete(id);
          reject(new Error("bls-worker-timeout"));
        }, 20_000);
        pendientes.set(id, {
          resolve: (ok) => {
            clearTimeout(tope);
            resolve(ok);
          },
          reject: (e) => {
            clearTimeout(tope);
            reject(e);
          },
        });
        w.postMessage({ id, round, signature: signatureHex });
      });
    } catch {
      /* se calcula acá abajo */
    }
  }
  const { verifyRound } = await import("./drand");
  return verifyRound(round, signatureHex);
}
