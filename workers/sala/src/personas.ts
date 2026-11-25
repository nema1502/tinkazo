/**
 * Las campañas de personas: quien solo se anota no necesita billetera. Su texto firmado trae `"identidad": "persona"`, la
 * persona entra con el botón de Google, la sala verifica sola su token y la lista sella una línea por persona en lugar de una
 * cuenta. Este archivo reúne lo que no depende de Cloudflare: los dos interruptores y la lectura del vencimiento de un token.
 *
 * Con los interruptores apagados, que es como nacen, la sala no crea ni usa campañas de personas y todo sigue como siempre.
 */

/** Las variables del Worker que prenden las campañas de personas. */
export interface VariablesDePersonas {
  /** Solo con "1" la sala crea y usa campañas de personas. Por defecto "0". */
  DIFERIDA?: string;
  /** El identificador de cliente de Google de Tinkazo. Es público. Vacío, no entra nadie por Google. */
  GOOGLE_CLIENT_ID?: string;
}

/** El identificador de cliente de Google configurado, sin espacios alrededor. Vacío si no hay. */
export function clienteDeGoogle(env: VariablesDePersonas): string {
  return typeof env.GOOGLE_CLIENT_ID === "string" ? env.GOOGLE_CLIENT_ID.trim() : "";
}

/**
 * Si la sala acepta campañas de personas: el interruptor en "1" y un identificador de cliente de Google. Falta una de las dos
 * cosas y no se crea ni se usa ninguna.
 */
export function personasPrendido(env: VariablesDePersonas): boolean {
  return env.DIFERIDA === "1" && clienteDeGoogle(env) !== "";
}

/**
 * Hasta cuándo vale un token de identidad, en milisegundos, según su propio `exp`. Si no se lee, `ahora`: la sala no recuerda
 * una sesión de la que no sabe cuánto dura. Se usa solo después de que el token pasó la verificación.
 */
export function venceDelToken(token: string, ahora: number): number {
  try {
    const carga = token.split(".")[1] ?? "";
    const datos: unknown = JSON.parse(atob(carga.replace(/-/g, "+").replace(/_/g, "/")));
    const exp = datos !== null && typeof datos === "object" ? (datos as { exp?: unknown }).exp : undefined;
    return typeof exp === "number" && Number.isFinite(exp) && exp * 1000 > ahora ? exp * 1000 : ahora;
  } catch {
    return ahora;
  }
}
