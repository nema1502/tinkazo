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
 * Cuánto se espera a que la sesión de Pollar quede verificada para entregar su token (`tokenDeSesion` de
 * `wallet-pollar.ts`). En un stand con la red lenta, verificarla puede tardar varios segundos, y alguien con un cupón
 * válido no tiene que ver «probá de nuevo». Vive acá, sin la billetera, para que el paso «Dejá tu cuenta lista» lo use
 * sin traerla.
 */
export const TOPE_TOKEN_MS = 8_000;
