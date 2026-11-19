import { errorKey } from "../stellar/errores";
import { ingresoPlanB, ingresoPlanBPrendida } from "../stellar/ingreso-bandera";
import { codigoDeLaPersona, nombresDe } from "./ingreso-errores";

export { ingresoPlanB, ingresoPlanBPrendida };

/**
 * El plan B del ingreso, detrás de `VITE_INGRESO_PLAN_B`.
 *
 * Para sortear hay que entrar con una cuenta, y las cuentas de Google y de correo las abre un proveedor externo
 * (Pollar) con un tope de personas. Su documentación no dice qué pasa al llegar a ese tope y su paquete no trae un
 * código de error para eso. Si en un evento el ingreso empieza a fallar, la gente no puede sortear. Con la bandera
 * prendida, y solo en Prueba, un aviso de ingreso que falló por culpa del proveedor suma una acción secundaria para
 * seguir sin cuenta (`sin-cuenta.ts`): el modo libre que ya existe, sin sello en la cadena y sin quedar a nombre de nadie.
 *
 * Este archivo decide dos cosas y nada más: si la bandera vale, y de quién es la falla. No toca la página.
 */

/** Por dónde falló el ingreso: el pedido del código, su comprobación, o la entrada con Google. */
export type PasoDelIngreso = "enviar" | "verificar" | "google";

/**
 * De quién es la falla. Una falla de la persona nunca ofrece seguir sin cuenta. `plazo` es el plazo vencido sin que nada
 * contestara: no se sabe de quién es, porque pasa igual si el proveedor cuelga que si la persona deja abierta la ventana de
 * Google. La salida se ofrece, pero el aviso no culpa a nadie.
 */
export type QuienFalla = "persona" | "proveedor" | "plazo";

/** Los nombres con que el ingreso dice que venció el plazo: el del proveedor (`LOGIN_TIMEOUT`) y el de la billetera (`pollar-timeout`). */
const PLAZO_VENCIDO: readonly string[] = ["LOGIN_TIMEOUT", "pollar-timeout"];

/**
 * Lo que el ingreso con Google dice cuando la ventana no se abrió o la persona la cerró (`wallet-pollar.ts`:
 * `ENTRADA_BLOQUEADA`, `ENTRADA_CERRADA`) y la llave de acceso fallida que nombra el proveedor. Los dos primeros son los
 * mismos de `WALLET_ERRORS` en `wallet-lite.ts`, que no se importa para no traer la billetera: una prueba lo comprueba.
 */
export const PERSONA_ENTRADA: readonly string[] = ["popup-blocked", "popup-closed", "PASSKEY_FAILED"];

/** El nombre con que el proveedor dice que la sesión venció mientras la persona escribía el código. */
const SESION_VENCIDA = "SESSION_EXPIRED";

/** Si la máquina dice que está sin internet. `navigator.onLine` en falso es confiable, en verdadero no tanto. */
const sinInternetAhora = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

/**
 * De quién es la falla de un ingreso. Lo de la persona se enumera: no tener internet, un código equivocado o vencido, la
 * sesión que venció esperando el código, la ventana de Google cerrada o bloqueada, cancelar. Todo lo demás es del
 * proveedor: contestó con un error, tardó más de lo razonable, no dejó crear la cuenta o no se pudo hablar con él con
 * internet en pie. Un error que nadie reconoce también lo es, porque la persona no tiene cómo provocarlo.
 *
 * El nombre del código solo culpa a la persona al comprobarlo (`ingreso-errores.ts`): al pedir el código todavía no hay
 * ninguno que pueda estar mal.
 */
export function quienFalla(e: unknown, paso: PasoDelIngreso, enLinea: boolean = !sinInternetAhora()): QuienFalla {
  if (!enLinea) return "persona";
  const nombres = nombresDe(e);
  if (nombres.some((n) => PERSONA_ENTRADA.includes(n))) return "persona";
  if (paso === "verificar" && (codigoDeLaPersona(e) !== null || nombres.includes(SESION_VENCIDA))) return "persona";
  if (errorKey(e, { enLinea }) === "userRejected") return "persona";
  if (nombres.some((n) => PLAZO_VENCIDO.includes(n))) return "plazo";
  return "proveedor";
}

/** La clave del título del aviso: neutro si venció el plazo, y solo si el proveedor contestó con un error, el que lo señala. */
export type TituloDelAviso = "ingresoCaidoTitulo" | "ingresoPlazoTitulo";
export const tituloDelAviso = (e: unknown): TituloDelAviso => (nombresDe(e).some((n) => PLAZO_VENCIDO.includes(n)) ? "ingresoPlazoTitulo" : "ingresoCaidoTitulo");

/**
 * Cuánto se espera a que la propia página conteste antes de dar por perdida la conexión. Con una red lenta (un evento) tres
 * segundos daban por caída una conexión que andaba. La espera no retrasa nada de lo que se ve: el error se pinta primero y
 * la salida se suma cuando el pedido contesta.
 */
export const ESPERA_INTERNET_MS = 6_000;

/**
 * ¿La persona tiene internet? Se le pregunta a esta misma página con un pedido mínimo: si contesta, aunque sea con un
 * error del servidor, la conexión está. Sirve para separar un proveedor caído (con internet en pie) de una conexión que
 * se cortó, que es de la persona. `navigator.onLine` no alcanza: en una wifi sin salida dice que sí.
 */
export async function hayInternet(f: typeof fetch = fetch, ms: number = ESPERA_INTERNET_MS): Promise<boolean> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ms);
  try {
    await f("/favicon.svg", { method: "HEAD", cache: "no-store", signal: corte.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(reloj);
  }
}

export interface DependenciasDeLaSalida {
  env?: Record<string, unknown>;
  red?: string;
  hayInternet?: () => Promise<boolean>;
}

/**
 * ¿Este aviso de ingreso ofrece seguir sin cuenta? Sí si la bandera vale, la falla es del proveedor y la propia página
 * sigue contestando: sin conexión la falla es de la persona, aunque el error no lo parezca (cuando Pollar no responde, el
 * SDK dice que no pudo armar la entrada y nada más). Con la bandera apagada no se hace ni el pedido. Nunca lo decide por
 * la persona: solo dice si se ofrece.
 */
export async function ofrecerSalida(e: unknown, paso: PasoDelIngreso, dep: DependenciasDeLaSalida = {}): Promise<boolean> {
  if (!ingresoPlanB(dep.env, dep.red)) return false;
  if (quienFalla(e, paso) === "persona") return false;
  return (dep.hayInternet ?? hayInternet)();
}
