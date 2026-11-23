/**
 * La línea base del protocolo y de los parámetros de costo de la red, servida por el portero (issue 220).
 *
 * Es la MISMA línea base que compara el detector de GitHub: se importa de `scripts/vigilar-red.base.json`, el
 * archivo de siempre, así que hay una sola copia en el repositorio. El vigilante (`workers/vigilante`, cada
 * diez minutos) la pide por la ruta de lectura y la mete en su comparación; el detector queda de respaldo.
 *
 * La ruta es read-mostly, para cualquiera, sin llaves: la línea base tarda días o meses en cambiar (éste es su
 * trabajo) y su contenido es público, lo mismo que el RPC lo da. Si otro día se quisiera cerrar, el vigilante
 * tendría que pedirla con la clave de operar: hoy no hace falta.
 *
 * El enchufe de la ruta va en `index.ts` (el despachador de rutas del Worker), al lado de las demás; la línea
 * está en el README, en la sección de la línea base. `linea-base.test.ts` la comprueba en Node.
 */
import base from "../../../scripts/vigilar-red.base.json";
import { json } from "./http";

/** La ruta de lectura, dentro del servicio. El mismo texto la nombra el vigilante. */
export const RUTA_LINEA_BASE = "/v1/patrocinio/linea-base";

/** La línea base tal como la guarda el repositorio: versión, lugar y hora, y los parámetros por red. */
export function lineaBase(): typeof base {
  return base;
}

/**
 * Atiende la ruta: GET da la línea base (caché de un minuto, que solo cambia el día que se commitea una base
 * nueva) y cualquier otro método pide que se vaya por GET.
 */
export function atenderLineaBase(request: Request): Response {
  if (request.method !== "GET") return json({ motivo: "metodo" }, 405);
  return json(lineaBase(), 200, { "Cache-Control": "public, max-age=60" });
}
