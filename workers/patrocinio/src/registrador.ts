/**
 * La bitácora del portero: una línea de JSON por hecho clave (`wrangler tail`, Workers Logs). Los eventos `error-…`
 * salen como error.
 *
 * Quien anota pone solo nombres fijos, cifras y el comienzo de un hash. Esto es la segunda red, por si algo se escapa
 * (el mensaje de una excepción, un detalle de la red): antes de escribir, `limpiar` saca los campos que nombran a una
 * persona y tapa, aunque vengan adentro de un texto, cuentas y llaves de Stellar, correos, tokens, llaves de Pollar,
 * códigos de cupón e identificadores con forma de UUID. Nunca va a la bitácora un `userId`, un token, un correo, un
 * código ni una cuenta completa.
 */

export type Datos = Record<string, string | number>;
export type Registrar = (evento: string, datos?: Datos) => void;

/** Los campos que nombran a una persona o a su sesión: no se escriben nunca, digan lo que digan. */
const CAMPOS_PROHIBIDOS = new Set(["usuario", "userid", "user", "token", "correo", "email", "cuenta", "cupon", "codigocupon", "secreto", "llave", "clave"]);

const CUPON = "[0-9A-HJKMNP-TV-Z]";
const TAPAS: ReadonlyArray<[RegExp, string | ((m: string) => string)]> = [
  // Cuentas (G), llaves secretas (S), contratos (C) y cuentas compuestas (M) de Stellar.
  [/\b[GSCM][A-Z2-7]{55}(?:[A-Z2-7]{13})?\b/g, "[cuenta]"],
  [/[^\s@"'<>()[\]]+@[^\s@"'<>()[\]]+\.[A-Za-z]{2,}/g, "[correo]"],
  [/\beyJ[\w-]+\.[\w-]+(?:\.[\w-]*)?/g, "[token]"],
  [/\bBearer\s+\S+/gi, "Bearer [token]"],
  [/\b(?:sec|pub)_[A-Za-z0-9_]{6,}/g, "[llave]"],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]"],
  // Un código de cupón, con o sin guiones. Solo números no es un código (un saldo en stroops).
  [new RegExp(`\\b${CUPON}{4}[-\\s]?${CUPON}{4}[-\\s]?${CUPON}{4}\\b`, "g"), (m) => (/[A-Z]/.test(m) ? "[cupon]" : m)],
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
    for (const [patron, tapa] of TAPAS) texto = typeof tapa === "string" ? texto.replace(patron, tapa) : texto.replace(patron, tapa);
    limpio[clave] = texto;
  }
  return limpio;
}

/** El registrador del Worker. `salida` es la consola; las pruebas pasan la suya. */
export function registrador(salida: { log: (linea: string) => void; error: (linea: string) => void } = { log: (l) => console.log(l), error: (l) => console.error(l) }): Registrar {
  return (evento, datos = {}) => (evento.startsWith("error-") ? salida.error : salida.log)(JSON.stringify({ evento, ...limpiar(datos) }));
}
