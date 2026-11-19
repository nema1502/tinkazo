/**
 * El registro del vigilante: una línea de JSON por hecho (`wrangler tail`, Workers Logs). Los `error-…` salen como error.
 *
 * Quien anota pone solo nombres fijos, códigos y cuentas de intentos. Esto es la segunda red, por si algo se escapa (el
 * mensaje de una excepción de Cloudflare o de la red puede traer una dirección de correo o un pedazo de una cabecera):
 * antes de escribir, `limpiar` saca los campos que nombran un secreto y tapa, aunque vengan adentro de un texto,
 * correos, claves en una cabecera, llaves de Stellar, el token de un bot de Telegram y los enlaces con él.
 * Nunca va al registro una cifra del negocio ni el estado del portero.
 */

export type Datos = Record<string, string | number | boolean>;
export type Registrar = (evento: string, datos?: Datos) => void;

/** Los campos que son o nombran un secreto: no se escriben nunca, digan lo que digan. */
const CAMPOS_PROHIBIDOS = new Set(["token", "clave", "secreto", "correo", "email", "destino", "para", "chat", "bot", "autorizacion", "authorization", "texto", "asunto"]);

const TAPAS: ReadonlyArray<[RegExp, string]> = [
  // El token de un bot de Telegram (número, dos puntos y letras) y el enlace que lo lleva.
  [/\/bot[^/\s"']+\//g, "/bot[token]/"],
  [/\b\d{6,}:[A-Za-z0-9_-]{8,}/g, "[token]"],
  [/\bBearer\s+\S+/gi, "Bearer [token]"],
  [/[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[A-Za-z]{2,}/g, "[correo]"],
  [/\b[GSCM][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g, "[cuenta]"],
];

/** Lo mismo que `datos`, sin los campos prohibidos y con lo sensible tapado en cada texto. */
export function limpiar(datos: Datos = {}): Datos {
  const limpio: Datos = {};
  for (const [clave, valor] of Object.entries(datos)) {
    if (CAMPOS_PROHIBIDOS.has(clave.toLowerCase())) continue;
    if (typeof valor !== "string") {
      limpio[clave] = valor;
      continue;
    }
    let texto = valor;
    for (const [patron, tapa] of TAPAS) texto = texto.replace(patron, tapa);
    limpio[clave] = texto.slice(0, 200);
  }
  return limpio;
}

/** El registrador del Worker. `salida` es la consola; las pruebas pasan la suya. */
export function registrador(salida: { log: (linea: string) => void; error: (linea: string) => void } = { log: (l) => console.log(l), error: (l) => console.error(l) }): Registrar {
  return (evento, datos = {}) => (evento.startsWith("error-") ? salida.error : salida.log)(JSON.stringify({ evento, ...limpiar(datos) }));
}
