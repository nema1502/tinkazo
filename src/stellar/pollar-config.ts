import { network, type NetworkName } from "./config";

/**
 * La llave publicable de Pollar, una por red.
 *
 * Cada red tiene su aplicación de Pollar y su llave. En Oficial vale solo
 * `VITE_POLLAR_PUBLISHABLE_KEY_MAINNET`: nunca cae a la de Prueba, porque una
 * cuenta abierta con la llave equivocada nace en la otra red. Sin llave de
 * Oficial, Oficial no ofrece entrar con Google. En Prueba vale
 * `VITE_POLLAR_PUBLISHABLE_KEY_TESTNET` y, si no está, la de siempre
 * (`VITE_POLLAR_PUBLISHABLE_KEY`), para que lo que ya está desplegado siga igual.
 */

export interface PollarKeyEnvironment {
  mainnetKey?: string | undefined;
  testnetKey?: string | undefined;
  legacyKey?: string | undefined;
}

const clean = (value: string | undefined): string => String(value ?? "").trim();

/** La llave de Pollar de una red, o cadena vacía si esa red no tiene. */
export function pollarKeyFor(name: NetworkName, env: PollarKeyEnvironment = {}): string {
  const mainnetKey = env.mainnetKey === undefined ? (import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY_MAINNET as string | undefined) : env.mainnetKey;
  const testnetKey = env.testnetKey === undefined ? (import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY_TESTNET as string | undefined) : env.testnetKey;
  const legacyKey = env.legacyKey === undefined ? (import.meta.env.VITE_POLLAR_PUBLISHABLE_KEY as string | undefined) : env.legacyKey;
  if (name === "mainnet") return clean(mainnetKey);
  return clean(testnetKey) || clean(legacyKey);
}

/** Si esta red puede ofrecer entrar con Google o con correo. */
export const hasPollarKey = (name: NetworkName = network.name, env?: PollarKeyEnvironment): boolean => pollarKeyFor(name, env) !== "";

/** La clave de la marca de entrada de Pollar en este navegador, por red. */
export const pollarIntentKey = (name: NetworkName): string => `tinkazo.pollar.intent.${name}`;

/** La clave vieja, sin red: solo se lee en Prueba, para no perder la sesión de quien ya entró. */
export const LEGACY_POLLAR_INTENT_KEY = "tinkazo.pollar.intent";

/**
 * La marca de entrada de Pollar de una red ("google" o "email"), o `null` si no hay. Vale la de la red; solo en
 * Prueba, y solo si esa falta, la clave vieja sin red. La leen la billetera, la herramienta y las páginas de
 * lectura: una sola regla para que no vuelvan a decir cosas distintas.
 */
export function leerMarcaPollar(almacen: Pick<Storage, "getItem">, name: NetworkName): string | null {
  const actual = almacen.getItem(pollarIntentKey(name));
  if (actual !== null || name !== "testnet") return actual;
  return almacen.getItem(LEGACY_POLLAR_INTENT_KEY);
}

/**
 * Cuánto se espera a que la sesión de Pollar quede verificada para entregar su token en la primera mirada
 * (`tokenDeSesion` de `wallet-pollar.ts`). En un stand con la red lenta, verificarla puede tardar varios segundos, y
 * alguien con un cupón válido no tiene que ver «probá de nuevo». Vive acá, sin la billetera, para que el paso «Dejá tu
 * cuenta lista» lo use sin traerla.
 */
export const TOPE_TOKEN_MS = 8_000;

/**
 * Cuánto sigue esperando el token en total cuando la primera mirada vence y el kit dice que la sesión sigue abierta,
 * pero todavía sin verificar: la ventana paciente (issue 88). Una sesión recién creada es justo la que puede tardar más
 * de los 8 segundos de la primera mirada, y entregar `null` ahí tiraba a quien ya entró a «Entrar de nuevo».
 *
 * En cada vencido se vuelve a mirar la sesión (`getAuthState`): si el kit dice que ya no existe, el token sale con
 * `null` al toque (ahí sí conviene entrar de nuevo); si sigue abierta sin verificar, se espera de nuevo con espera
 * creciente. Es de la espera de siempre (el paso de la cuenta): quien pide su propio tope (la sala de campaña con
 * `ESPERA_TOKEN_MS`, la lectura del celular) tiene exactamente el suyo. Un vencimiento nunca toca la marca de la sesión.
 */
export const VENTANA_TOKEN_MS = 20_000;

/**
 * Cuánto sigue mirando al proveedor el retomo de la cuenta después de la primera mirada: la ventana paciente (issue 89).
 * Con la red cargada de un stand, la `ready()` del kit puede contestar a los 10 o 12 segundos, y devolver
 * "no hay cuenta" al primer vencido dejaba a quien ya entró con la página sin sesión, aunque la marca siguiera.
 *
 * Espera creciente: la primera espera es `LISTO_MS`, cada vuelta repite el doble de la anterior sin pasar de lo que
 * queda de la ventana, y en cada vuelta se gana apenas el proveedor contesta (la carrera con su `ready()` se resuelve
 * sola, sin que la gane el temporizador). Mientras espera, la marca no se toca: solo el chequeo del final, con el kit ya
 * listo y sin sesión, la puede olvidar, como antes. Si el proveedor sigue afuera después de la ventana, `restore`
 * devuelve `null` con la marca en pie: la próxima recarga lo vuelve a intentar y la página queda con su salida clara.
 */
export const VENTANA_RETOMA_MS = 30_000;

/**
 * Hasta cuándo la cabecera dice "Retomando tu cuenta…" aunque la retoma todavía no haya soltado la pantalla: los 12
 * segundos de siempre, por si algo queda colgado antes de la primera mirada (el SDK del proveedor sin terminar de bajar).
 * Lo normal es que la suelte antes la propia retoma, a los 8 segundos de la primera mirada (`cuandoTarda` de `restore`).
 * La paciencia (`VENTANA_RETOMA_MS`) corre por detrás, sin tener a nadie esperando: si la sesión llega, se abre sola, y si
 * la persona ya entró de nuevo, la retoma tardía se descarta.
 */
export const FUSIBLE_DE_RETOMA_MS = 12_000;
