import { network } from "./config";
import { activeWallet } from "./wallet-lite";

/**
 * Las dos condiciones del modo Oficial con una cuenta de Google o de correo (la billetera de Pollar, que firma y manda
 * sola). Cada firma de esa cuenta le cuesta créditos a Tinkazo, aunque después la red o el portero la rechacen.
 *
 * - `redPrincipalConPollar`: la red principal con la billetera de Pollar, sin mirar ninguna bandera. Ahí «pagar con mi
 *   cuenta» (Pollar firmando sin el portero, una firma que nadie cuenta) no existe: ni en la caja de la red, ni en el
 *   sorteo, ni en `submitElsewhere`. Y el candado de `submitElsewhere` no deja firmar un sello ni un sorteo sin el acceso
 *   confirmado por el portero (`acceso-oficial.ts`). Esa combinación todavía no existe en producción, así que no cambia
 *   nada de hoy.
 * - `cobroPorUso`: lo mismo, y además el acceso por cupón o por pago pedido en el build (`VITE_ALTA=1`). Gobierna lo que
 *   se ve del acceso: la caja del cupón, las compuertas de la pantalla antes del sello y del sorteo, y la línea de los
 *   sorteos oficiales que quedan. Sin él, el chequeo de la red frena como antes a una cuenta sin acceso o sin sorteos.
 *
 * `cobroPorUso` mira la variable tal como vino en el build y no `altaActiva()` (`alta-config.ts`), que además exige la
 * dirección del portero: para cerrar vale la bandera a medio poner. Sin la dirección el build no sale (`alta-build.ts`)
 * y, si igual saliera, `elegirPatrocinador` ya se cierra en la red principal.
 *
 * Con Freighter (o cualquier billetera propia) y en Prueba no rige ninguna de las dos: todo sigue como siempre.
 */

/** Lo que se mira para decidirlo. Cada pedazo se puede pasar a mano (las pruebas). */
export interface EntornoDelCobro {
  red?: string;
  /** La billetera activa: lo que importa es si firma y manda sola (Pollar). */
  billetera?: unknown;
  env?: Record<string, unknown>;
}

/** La billetera firma y manda sola: es la de Pollar (una cuenta de Google o de correo). Sin cargar su módulo. */
export const esCuentaDePollar = (w: unknown): boolean => !!w && typeof w === "object" && (w as { submitsItself?: unknown }).submitsItself === true;

/** El build pide el acceso por cupón o por pago. */
const altaPedida = (env: Record<string, unknown>): boolean => env.VITE_ALTA === "1";

/** La red principal con una cuenta de Google o de correo, con o sin banderas: ahí no existe «pagar con mi cuenta». */
export function redPrincipalConPollar(e: EntornoDelCobro = {}): boolean {
  const red = e.red ?? network.name;
  if (red !== "mainnet") return false;
  const billetera = "billetera" in e ? e.billetera : activeWallet();
  return esCuentaDePollar(billetera);
}

/** Rige el cobro por uso: la red principal, una cuenta de Pollar y `VITE_ALTA=1`. */
export function cobroPorUso(e: EntornoDelCobro = {}): boolean {
  if (!redPrincipalConPollar(e)) return false;
  return altaPedida(e.env ?? (import.meta.env as Record<string, unknown>));
}
