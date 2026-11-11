import { network } from "./config";

/**
 * Las banderas del cobro por uso del modo Oficial (cupones y paquetes de sorteos para las cuentas de Google o de
 * correo), en un solo lugar. Todas nacen apagadas: prenderlas es una decisión de quien dirige el proyecto.
 *
 * - `VITE_ALTA=1`: el acceso por cupón (o por pago) está a la vista. Exige `VITE_PATROCINIO_URL_MAINNET`: sin la
 *   dirección del portero de la red principal no hay a quién preguntar el acceso, y la bandera no vale (el build
 *   tampoco sale, ver `alta-build.ts`).
 * - `VITE_ALTA_LIBRE=1`: la salida de emergencia. Deja activar una cuenta sin acceso confirmado por el servidor, y nada
 *   más: sellar y sortear siguen pidiendo el acceso. Existe para un solo caso (el plan B1 del diseño), sola: junto con
 *   `VITE_ALTA` no vale.
 * - `VITE_ALTA_PAGO=1`: la compra de sorteos. Solo cuenta con `VITE_ALTA`.
 * - `VITE_SORTEO_SERVIDOR=1`: el sorteo lo manda el servidor. Solo cuenta con `VITE_ALTA`.
 *
 * Fuera de la red principal (Prueba) están apagadas siempre, tengan lo que tengan las variables: ahí no hay cobro y
 * el sitio se comporta como siempre. Ante una bandera a medio poner (pago o sorteo por el servidor sin el acceso, o el
 * acceso sin portero) vale la menos abierta.
 *
 * Es un archivo mínimo a propósito, sin nada de la pantalla ni de la billetera: la red y el entorno entran como
 * argumentos, así se prueba solo.
 */

export interface BanderasDeAlta {
  alta: boolean;
  libre: boolean;
  pago: boolean;
  sorteoServidor: boolean;
}

/** Todo apagado: lo que vale fuera de la red principal y con el build de hoy. */
export const BANDERAS_APAGADAS: Readonly<BanderasDeAlta> = Object.freeze({ alta: false, libre: false, pago: false, sorteoServidor: false });

const uno = (x: unknown): boolean => x === "1";

/** Hay dirección del portero de la red principal en el entorno (lo mismo que `patrocinio-config.ts` toma por puesta). */
const hayPortero = (x: unknown): boolean => typeof x === "string" && x.trim().replace(/\/+$/, "") !== "";

/** Las banderas de esta red, según el entorno del build. Cada argumento se puede pasar a mano (las pruebas). */
export function banderasDeAlta(env: Record<string, unknown> = import.meta.env, red: string = network.name): BanderasDeAlta {
  if (red !== "mainnet") return { ...BANDERAS_APAGADAS };
  const alta = uno(env.VITE_ALTA) && hayPortero(env.VITE_PATROCINIO_URL_MAINNET);
  return {
    alta,
    // Con el acceso por cupón pedido (aunque falte el portero), el plan B1 no vale: juntas activarían sin acceso. El build
    // tampoco sale así (`alta-build.ts`); esto es por si igual llegara.
    libre: uno(env.VITE_ALTA_LIBRE) && !uno(env.VITE_ALTA),
    pago: alta && uno(env.VITE_ALTA_PAGO),
    sorteoServidor: alta && uno(env.VITE_SORTEO_SERVIDOR),
  };
}

/** El acceso por cupón o por pago está a la vista en este build y esta red. */
export const altaActiva = (): boolean => banderasDeAlta().alta;
/** Se puede activar una cuenta sin el acceso confirmado: solo el plan B1. */
export const altaLibre = (): boolean => banderasDeAlta().libre;
/** La compra de sorteos está a la vista. */
export const altaPagoActivo = (): boolean => banderasDeAlta().pago;
/** El sorteo lo manda el servidor. */
export const sorteoPorServidor = (): boolean => banderasDeAlta().sorteoServidor;
