/**
 * Lo que el vigilante lee de su entorno: a quién avisar, desde qué dirección, a qué portero mirar, cada cuánto resumir
 * y por qué canales sale el aviso. Cualquier valor raro vuelve al de siempre y nunca rompe la vuelta.
 *
 * La dirección de aviso (`AVISAR_A`) es un secreto y no está en el repositorio. La del remitente tampoco se escribe
 * entera en el repositorio: el usuario y el dominio van por separado y se juntan acá.
 */
import type { Entorno } from "./vuelta";

export type Canal = "correo" | "telegram";

/** El portero de mainnet. */
export const PORTERO_POR_DEFECTO = "https://pm.tinkazo.app";
/** Desde qué dirección sale el correo: usuario y dominio (un dominio de la cuenta con el ruteo de correo prendido). */
export const REMITENTE_USUARIO = "avisos";
export const REMITENTE_DOMINIO = "tinkazo.app";
export const REMITENTE_NOMBRE = "Vigilante de Tinkazo";
/** A cuántas direcciones como mucho se le avisa. */
export const MAX_DESTINATARIOS = 5;
/** Un resumen por día, a las 12:00 UTC (las 8 de la mañana en Bolivia). */
export const RESUMEN_HORAS_POR_DEFECTO = 24;

/** Los únicos hosts a los que viaja la clave de operar: los servicios de tinkazo.app (el portero es pm.tinkazo.app). */
const HOST_PERMITIDO = /^(?:[a-z0-9-]+\.)+tinkazo\.app$/;
const DIRECCION = /^[^\s@,;<>()[\]"']+@[^\s@,;<>()[\]"']+\.[^\s@,;<>()[\]"']{2,}$/;
const USUARIO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DOMINIO = /^(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;

/** Un secreto sin los espacios ni los saltos de línea de los extremos: uno cargado a mano suele traer un salto al final. Vacío si no hay. */
export function secreto(valor: string | undefined): string {
  return (valor ?? "").trim();
}

/** Las direcciones de `AVISAR_A`, separadas por comas, sin repetir y como mucho `MAX_DESTINATARIOS`. Lo que no es una dirección no cuenta. */
export function destinatarios(texto: string | undefined): string[] {
  if (!texto) return [];
  const vistas = new Set<string>();
  const lista: string[] = [];
  for (const parte of texto.split(",")) {
    const direccion = parte.trim();
    if (!DIRECCION.test(direccion)) continue;
    const clave = direccion.toLowerCase();
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    lista.push(direccion);
  }
  return lista.slice(0, MAX_DESTINATARIOS);
}

/** La dirección de la que sale el correo, con un nombre. Un usuario o un dominio raro vuelve al de siempre. */
export function remitente(env: Pick<Entorno, "CORREO_USUARIO" | "CORREO_DOMINIO">): { email: string; name: string } {
  const usuario = env.CORREO_USUARIO?.trim();
  const dominio = env.CORREO_DOMINIO?.trim();
  const u = usuario && USUARIO.test(usuario) ? usuario : REMITENTE_USUARIO;
  const d = dominio && DOMINIO.test(dominio) ? dominio : REMITENTE_DOMINIO;
  return { email: `${u}@${d}`, name: REMITENTE_NOMBRE };
}

/**
 * El portero al que se mira: solo https, en un host de `*.tinkazo.app`, sin puerto, sin usuario ni clave pegados y sin
 * barras al final. La clave de operar viaja en cada pedido: con cualquier otro host, vuelve al portero de siempre.
 */
export function urlDelPortero(texto: string | undefined): string {
  try {
    const u = new URL((texto ?? "").trim());
    if (u.protocol !== "https:" || u.username || u.password || u.port !== "" || !HOST_PERMITIDO.test(u.hostname)) return PORTERO_POR_DEFECTO;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return PORTERO_POR_DEFECTO;
  }
}

/** Cada cuántas horas sale el resumen: un entero de 1 a 24, y si no, uno por día. */
export function horasDeResumen(texto: string | undefined): number {
  const limpio = (texto ?? "").trim();
  if (!/^\d{1,2}$/.test(limpio)) return RESUMEN_HORAS_POR_DEFECTO;
  const n = Number(limpio);
  return n >= 1 && n <= 24 ? n : RESUMEN_HORAS_POR_DEFECTO;
}

/** Por dónde sale el aviso: el correo pide el binding y una dirección, y Telegram pide sus dos secretos. */
export function canalesActivos(env: Entorno): Canal[] {
  const canales: Canal[] = [];
  if (env.CORREO && destinatarios(env.AVISAR_A).length > 0) canales.push("correo");
  if (secreto(env.TELEGRAM_BOT_TOKEN) && secreto(env.TELEGRAM_CHAT_ID)) canales.push("telegram");
  return canales;
}

/** Los nombres (nunca los valores) de lo que falta para que el vigilante sirva. */
export function faltaConfigurar(env: Entorno): string[] {
  const falta: string[] = [];
  if (!secreto(env.PORTERO_ADMIN_TOKEN)) falta.push("PORTERO_ADMIN_TOKEN");
  if (canalesActivos(env).length === 0) {
    if (!env.CORREO) falta.push("CORREO");
    if (destinatarios(env.AVISAR_A).length === 0) falta.push("AVISAR_A");
  }
  return falta;
}
