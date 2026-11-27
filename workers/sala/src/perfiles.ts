/**
 * El perfil de quien se anota con Google en una campaña de personas: su correo, su nombre y la dirección de su foto de
 * perfil, tal como los trae el token que la sala ya verificó. Es la cuenta de Tinkazo de esa persona. Vive en la tabla
 * `perfiles` del objeto de cupos, que no se borra con las salas: por eso dura más que la sala donde se anotó.
 *
 * Nace apagado y pide dos permisos a la vez. Uno es de la sala: la variable `PERFILES` en "1", con las campañas de personas
 * prendidas. El otro viaja en cada pedido: el celular manda `perfil: true` solo si su página mostró los textos que dicen que
 * se guarda. Sin los dos no se guarda nada. Una campaña de cuentas nunca guarda un perfil. Tampoco una campaña de personas
 * cuyas bases firmadas dicen que Tinkazo no guarda el correo (`basesDicenQueNoSeGuarda`): se arman así las de antes de que
 * existiera el perfil, y lo firmado no se contradice.
 *
 * Este archivo solo decide si está prendido, lee las bases firmadas, limpia y guarda. No tiene ninguna función que lea,
 * liste, cuente ni borre perfiles, y ninguna ruta de la sala los devuelve. No depende de Cloudflare: se prueba en Node con
 * un SQLite en memoria.
 */
import { personasPrendido } from "./personas";
import type { VariablesDePersonas } from "./personas";
import type { Ejecutar } from "./registro";

/** La variable del Worker que prende guardar el perfil. */
export interface VariablesDePerfiles {
  /** Solo con "1", y con las campañas de personas prendidas, la sala guarda el perfil de quien se anota. Por defecto "0". */
  PERFILES?: string;
}

/** Si la sala guarda perfiles: la variable en "1" exacto y las campañas de personas prendidas. Falta una cosa y no guarda. */
export function perfilesPrendido(env: VariablesDePerfiles & VariablesDePersonas): boolean {
  return env.PERFILES === "1" && personasPrendido(env);
}

/**
 * La frase de las bases de antes, en español y en inglés, en minúsculas. Una campaña de personas armada antes de que
 * existiera el perfil la lleva firmada en sus bases.
 */
const FRASES_DE_ANTES = ["tinkazo no guarda tu correo", "tinkazo doesn't store your email"];

/** Un texto para comparar: en minúsculas, con el apóstrofo recto y un solo espacio entre palabras. */
const paraComparar = (texto: string): string => texto.toLowerCase().replace(/[\u2018\u2019\u02bc]/gu, "'").replace(/\s+/gu, " ");

/**
 * Si las bases firmadas de una campaña dicen, en cualquiera de sus idiomas, que Tinkazo no guarda el correo. Recibe el texto
 * firmado entero y mira cada texto que haya dentro de su campo `bases`, sin importar mayúsculas. Una campaña así no guarda
 * perfiles ni le dice al celular que se guardan: se porta como con el perfil apagado. Un texto que no se puede leer cuenta
 * como si trajera la frase, porque ante la duda no se guarda. Nunca lanza.
 */
export function basesDicenQueNoSeGuarda(textoFirmado: string): boolean {
  try {
    const campana: unknown = JSON.parse(textoFirmado);
    if (typeof campana !== "object" || campana === null || Array.isArray(campana)) return true;
    // Las bases son un texto por idioma. Se recorren con una pila y no con llamadas, para que ninguna forma rara las frene.
    const pendientes: unknown[] = [(campana as Record<string, unknown>).bases];
    while (pendientes.length > 0) {
      const parte = pendientes.pop();
      if (typeof parte === "string") {
        const dicho = paraComparar(parte);
        if (FRASES_DE_ANTES.some((frase) => dicho.includes(frase))) return true;
      } else if (typeof parte === "object" && parte !== null) {
        for (const valor of Object.values(parte)) pendientes.push(valor);
      }
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * La tabla de perfiles: una fila por cuenta de Google. `primera_ms` es la primera vez que se guardó, `ultima_ms` la última
 * y `veces` cuántas. Se crea junto con las demás tablas del objeto de cupos.
 */
export function crearTablaDePerfiles(sql: Ejecutar): void {
  sql(
    "CREATE TABLE IF NOT EXISTS perfiles (id TEXT PRIMARY KEY, correo TEXT NOT NULL, nombre TEXT NOT NULL, foto TEXT NOT NULL, " +
      "primera_ms INTEGER NOT NULL, ultima_ms INTEGER NOT NULL, veces INTEGER NOT NULL)",
  );
}

/** Lo que se sabe de la persona cuando su token pasó la verificación (ver `identidad-google.ts`). */
export interface DatosDePerfil {
  usuario: string;
  correo: string;
  nombre: string;
  foto: string;
}

/** El perfil ya limpio: lo único que se guarda. */
export interface PerfilLimpio {
  id: string;
  correo: string;
  nombre: string;
  foto: string;
}

const PREFIJO_DE_GOOGLE = "google:";
/** El prefijo y un identificador de cuenta de Google de hasta 255 caracteres. */
const MAX_ID = 262;
const MIN_CORREO = 3;
const MAX_CORREO = 254;
/** En puntos de código, no en unidades: un emoji cuenta uno. */
const MAX_NOMBRE = 120;
const MAX_FOTO = 600;

/** Lo que no va en un correo ni en una dirección: espacios, controles, invisibles de formato y mitades sueltas de un par. */
const NO_VA = /[\s\p{Cc}\p{Cf}\p{Cs}]/u;

/** El correo sin espacios alrededor, o null si no tiene la forma mínima de un correo. */
function limpiarCorreo(correo: unknown): string | null {
  if (typeof correo !== "string") return null;
  const limpio = correo.trim();
  if (limpio.length < MIN_CORREO || limpio.length > MAX_CORREO || NO_VA.test(limpio)) return null;
  // Una sola arroba, y con algo de cada lado.
  const arroba = limpio.indexOf("@");
  if (arroba <= 0 || arroba === limpio.length - 1 || arroba !== limpio.lastIndexOf("@")) return null;
  return limpio;
}

/**
 * El nombre para mostrar: sin controles ni invisibles de formato, con un solo espacio entre palabras, sin espacios alrededor
 * y de hasta 120 puntos de código. Lo que no es un texto, o no deja nada, queda vacío.
 */
function limpiarNombre(nombre: unknown): string {
  if (typeof nombre !== "string") return "";
  const limpio = nombre
    .replace(/[\p{Cf}\p{Cs}]/gu, "")
    // Un salto de línea o una tabulación separan palabras: quedan como un espacio antes de sacar los demás controles.
    .replace(/\s+/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .replace(/ {2,}/g, " ")
    .trim();
  // El corte va por puntos de código: nunca deja la mitad de un par sustituto.
  return Array.from(limpio).slice(0, MAX_NOMBRE).join("").trimEnd();
}

/** La dirección de la foto si es https, bien formada y de hasta 600 caracteres. Si no, vacía. */
function limpiarFoto(foto: unknown): string {
  if (typeof foto !== "string" || foto.length > MAX_FOTO || !foto.startsWith("https://") || NO_VA.test(foto)) return "";
  try {
    return new URL(foto).protocol === "https:" ? foto : "";
  } catch {
    return "";
  }
}

/**
 * Lo que se guarda de una persona, o null si no hay nada que guardar. El identificador es el usuario que dio la
 * verificación (`google:` y el identificador de su cuenta). Sin un correo con forma de correo no se guarda nada. El nombre y
 * la foto pueden quedar vacíos. Nunca lanza.
 */
export function limpiarPerfil(datos: DatosDePerfil): PerfilLimpio | null {
  if (datos === null || typeof datos !== "object") return null;
  const id = datos.usuario;
  if (typeof id !== "string" || !id.startsWith(PREFIJO_DE_GOOGLE) || id.length <= PREFIJO_DE_GOOGLE.length || id.length > MAX_ID) return null;
  const correo = limpiarCorreo(datos.correo);
  if (correo === null) return null;
  return { id, correo, nombre: limpiarNombre(datos.nombre), foto: limpiarFoto(datos.foto) };
}

/**
 * Guarda el perfil con una sola sentencia y con los datos como parámetros, nunca dentro de su texto. La primera vez deja la
 * fila con `ahora` en las dos horas. Las siguientes cambian el correo, el nombre, la foto y la última hora, y suman una vez:
 * la primera hora no cambia nunca. `nueva` dice si la fila no existía.
 */
export function guardarPerfil(sql: Ejecutar, perfil: PerfilLimpio, ahora: number): { nueva: boolean } {
  const fila = sql<{ veces: number }>(
    "INSERT INTO perfiles (id, correo, nombre, foto, primera_ms, ultima_ms, veces) VALUES (?, ?, ?, ?, ?, ?, 1) " +
      "ON CONFLICT(id) DO UPDATE SET correo = excluded.correo, nombre = excluded.nombre, foto = excluded.foto, " +
      "ultima_ms = excluded.ultima_ms, veces = veces + 1 RETURNING veces",
    perfil.id,
    perfil.correo,
    perfil.nombre,
    perfil.foto,
    ahora,
    ahora,
  )[0];
  return { nueva: fila?.veces === 1 };
}
