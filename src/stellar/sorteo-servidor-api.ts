import { formaDePortero } from "./alta-build";
import { ErrorPortero, errorDeRespuesta } from "./patrocinador";

/**
 * Cómo pide el sitio al servicio de comisiones que mande el sorteo (`POST /v1/sorteo`), y qué quiere decir cada
 * respuesta. La forma de la ruta es la del servicio (`workers/patrocinio/src/sorteadora.ts`).
 *
 * Es un archivo de lógica pura: el pedido sale por un `fetch` que entra por argumento, y nada se lee de la pantalla.
 * Lo que decide qué hacer después (esperar, seguir por el camino de siempre, mirar la red) es `sorteo-del-servicio.ts`.
 *
 * - **El resultado no sale de acá.** Nada de lo que trae el cuerpo de la respuesta se usa como ganadores ni como número
 *   al azar: el sorteo se lee de la red (`readDraw`) o del valor que devuelve la transacción ya confirmada.
 * - **Sin nada del navegador.** Sin sesión ni cabeceras de más, `credentials: "omit"`, sin `Referer`, sin caché.
 * - **Cerrado ante la duda.** Ninguna función lanza. Un corte, un tope o una respuesta que no se entiende es
 *   `incierto`: quien llama no vuelve a pedir ni cambia de camino sin antes mirar la red.
 * - **Los noes seguros.** `503 ocupado` (el servicio está con otro sorteo), `503 tarde` (sus llamadas a la red tardaron
 *   demasiado) y el `500 interno` con `detalle: "sin-mandar"` aseguran que no mandó ni va a mandar este sorteo: se sigue por
 *   el camino de siempre en el acto. Un servicio que no los conoce nunca los contesta, y lo suyo cae en las reglas de siempre.
 */

/** Qué hacer con una respuesta del servicio. */
export type RespuestaDelSorteo =
  /** El servicio mandó el sorteo y la red lo tomó (`pendiente`) o ya lo tenía en camino (`duplicado`). */
  | { accion: "mandado"; hash: string; pendiente: boolean }
  /** El servicio dice que el sorteo ya está hecho. Se comprueba en la red antes de creerlo. */
  | { accion: "ya" }
  /**
   * El servicio aseguró que no mandó nada y que conviene volver a pedir. `fijaMs`: la espera, si el servicio la dice.
   * `causa`: por qué no pudo. `ronda` (la red todavía no alcanzó la hora de la ronda) y `ocupada` (la red no tomó la
   * transacción por estar llena) son de la red y no del servicio. `lectura` es del servicio al leer o simular.
   */
  | { accion: "espera"; fijaMs?: number; causa?: "ronda" | "ocupada" | "lectura" }
  /**
   * El servicio no pudo hablar con su red (un error de su RPC). No se sabe si fue antes de mandar, así que no se da por no
   * mandado, pero pedir otra vez es seguro: el servicio no manda dos veces el mismo sello y devuelve el mismo número.
   */
  | { accion: "red-del-servicio" }
  /**
   * El servicio aseguró que no lo va a mandar: sigue el camino de siempre. `marca`: este sorteo ya no es suyo.
   * `disyuntor`: el problema es del servicio y no del sorteo, así que por un rato no se le pregunta más.
   * `olvidar`: lo que se sabía del portero ya no vale. `disyuntorCorto`: un tropiezo interno del servicio que ya devolvió lo
   * reservado: un minuto.
   */
  | { accion: "hoy"; marca: boolean; disyuntor: boolean; olvidar: boolean; disyuntorCorto?: true }
  /** Un no que se muestra tal cual, sin pasar por el camino de siempre. */
  | { accion: "error"; error: ErrorPortero }
  /** No se sabe si lo mandó. */
  | { accion: "incierto" };

/** La espera fija del 409: el servicio dice la hora de su reloj, que acá no se usa. */
export const ESPERA_RONDA_NO_LISTA_MS = 5_000;

const HASH = /^[0-9a-f]{64}$/i;
const hoy = (m: { marca?: boolean; disyuntor?: boolean; olvidar?: boolean; disyuntorCorto?: boolean } = {}): RespuestaDelSorteo => ({
  accion: "hoy",
  marca: !!m.marca,
  disyuntor: !!m.disyuntor,
  olvidar: !!m.olvidar,
  ...(m.disyuntorCorto ? { disyuntorCorto: true as const } : {}),
});
/** Un no que habla del servicio y no del sorteo: se sigue por el camino de siempre y por un rato no se le pregunta. */
const delServicio = (olvidar = false): RespuestaDelSorteo => hoy({ disyuntor: true, olvidar });

const DETALLES_DE_LECTURA = new Set(["lectura-sorteo", "simulacion", "secuencia"]);
/** Los errores de su RPC: `rpc-corte`, `rpc-503`, `rpc-error`, `rpc-respuesta`, `rpc-vacio`, `rpc-cortado` y `sin-rpc`. */
const ERROR_DE_RPC = /^(rpc-[a-z0-9]+|sin-rpc)$/;

const texto = (x: unknown): string => (typeof x === "string" ? x : "");

/** Traduce el estado y el cuerpo de la respuesta del servicio a lo que hay que hacer. Pura. */
export function leerRespuestaDelSorteo(estado: number, cuerpo: unknown): RespuestaDelSorteo {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const motivo = texto(c.motivo);
  const detalle = texto(c.detalle);

  if (estado === 200) {
    if (c.ya === true) return { accion: "ya" };
    const hash = texto(c.hash);
    if (HASH.test(hash) && (c.status === "PENDING" || c.status === "DUPLICATE")) return { accion: "mandado", hash: hash.toLowerCase(), pendiente: c.status === "PENDING" };
    return { accion: "incierto" };
  }
  if (estado === 409) return motivo === "ronda-no-lista" ? { accion: "espera", fijaMs: ESPERA_RONDA_NO_LISTA_MS, causa: "ronda" } : delServicio();
  if (estado === 502) {
    if (motivo === "red" && detalle === "ocupada") return { accion: "espera", causa: "ocupada" };
    if (motivo === "red" && DETALLES_DE_LECTURA.has(detalle)) return { accion: "espera", causa: "lectura" };
    // Un error del RPC del servicio puede venir de antes de mandar (la lectura, la simulación, la secuencia) o de la
    // etapa de envío: no se sabe si salió, pero pedir otra vez es seguro.
    if (motivo === "red" && ERROR_DE_RPC.test(detalle)) return { accion: "red-del-servicio" };
    return { accion: "incierto" };
  }
  if (estado === 429) return motivo === "cupo-cuenta" ? { accion: "error", error: errorDeRespuesta(429, cuerpo) } : delServicio();
  if (estado === 400) {
    // La comisión alta la decide el camino de siempre con su propia simulación.
    if (motivo === "fee-alta") return hoy();
    // La simulación del navegador da el mismo error del contrato antes de cualquier firma.
    if (motivo === "fallaria") return hoy({ marca: true });
    return delServicio();
  }
  if (estado === 403) return motivo === "no-es-nuestro" ? hoy({ marca: true }) : delServicio();
  if (estado === 503) {
    if (motivo === "apagado" || motivo === "fondo") return delServicio(true);
    // El servicio está con otro sorteo: no mandó ni va a mandar este. Anda bien, así que no se lo deja de lado.
    if (motivo === "ocupado") return hoy();
    // Su red anduvo tan lenta que no empezó a mandar: tampoco lo va a mandar, y el siguiente sorteo pagaría la misma espera.
    if (motivo === "tarde") return delServicio();
    return { accion: "incierto" };
  }
  // Falló al envolver, antes de mandar, y ya devolvió lo reservado. Cualquier otro 500 puede haber mandado.
  if (estado === 500 && motivo === "interno" && detalle === "sin-mandar") return hoy({ disyuntorCorto: true });
  if (estado === 404 || estado === 405) return delServicio();
  if (estado >= 400 && estado < 500) return delServicio();
  return { accion: "incierto" };
}

export interface PedidoDelSorteo {
  /** La dirección del servicio. Sin forma de portero de la red principal, no se pide nada. */
  url: string | null | undefined;
  raffleId: bigint;
  /** La firma de la ronda, sin comprimir: los 96 bytes que pide `draw`. */
  firma96: Uint8Array;
  fetch?: typeof fetch;
  /** Para abandonar el pedido: lo que se abortó puede seguir en el servicio. */
  signal?: AbortSignal;
}

const hex = (b: Uint8Array): string => Array.from(b, (n) => n.toString(16).padStart(2, "0")).join("");

/** Pide al servicio que mande el sorteo. No lanza nunca. */
export async function pedirElSorteo(p: PedidoDelSorteo): Promise<RespuestaDelSorteo> {
  const base = String(p.url ?? "").trim().replace(/\/+$/, "");
  if (!formaDePortero(base)) return hoy();
  const f: typeof fetch = p.fetch ?? ((...a) => fetch(...a));
  let r: Response;
  try {
    r = await f(`${base}/v1/sorteo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sorteo: String(p.raffleId), firma: hex(p.firma96) }),
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      ...(p.signal ? { signal: p.signal } : {}),
    });
  } catch {
    return { accion: "incierto" };
  }
  let cuerpo: unknown = null;
  try {
    cuerpo = await r.json();
  } catch {
    /* sin cuerpo que se entienda: la respuesta se juzga por su estado */
  }
  return leerRespuestaDelSorteo(r.status, cuerpo);
}
