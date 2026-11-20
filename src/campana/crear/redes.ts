/**
 * Los pedidos de redes: se aceptan las direcciones como las pega la gente desde su celular (con seguimiento, con la
 * versión móvil, o solo el @usuario) y salen con la forma que lee el modelo, sin tocar su lista de dominios.
 */

import { leerUrl, type TipoDePaso } from "../modelo";

export const TIPOS_EN_ORDEN: readonly TipoDePaso[] = ["instagram", "tiktok", "x", "youtube", "facebook", "whatsapp", "enlace", "texto"];
export const TOPE_DE_PEDIDOS = 8;
/** Lo más largo que puede ser una dirección: ocho pedidos largos no pueden hacer pasar la campaña del tope del servicio. */
export const MAXIMO_DEL_ENLACE = 300;

export type TipoDeRed = Exclude<TipoDePaso, "texto">;
export type MotivoDeEnlace = "vacio" | "otra-red" | "mal" | "corto";
export type ResultadoDeEnlace = { ok: true; url: string } | { ok: false; motivo: MotivoDeEnlace };

const REDES: readonly TipoDeRed[] = ["instagram", "tiktok", "x", "youtube", "facebook", "whatsapp"];
const USUARIO = /^@?[A-Za-z0-9._-]{1,50}$/u;
const TELEFONO = /^\+?\d{6,20}$/u;
/** Una dirección escrita sin esquema que empieza por el dominio de una red: no es un usuario aunque tenga punto. */
const DE_UNA_RED = "(?:www\\.|m\\.|web\\.|mobile\\.|mbasic\\.|vt\\.|vm\\.|api\\.|chat\\.)?";
const RED_Y_TERMINACION = "(?:instagram|tiktok|twitter|youtube|youtu|facebook|fb|whatsapp|wa|t|x)\\.(?:com|be|me|co)";
const DOMINIO_CONOCIDO = new RegExp(`^${DE_UNA_RED}${RED_Y_TERMINACION}(?:[/?#]|$)`, "iu");
/** Enlaces que solo redirigen: no dicen de qué perfil son hasta abrirlos. */
const ENLACES_CORTOS = ["vt.tiktok.com", "fb.me", "t.co"];
/** Marcas de seguimiento que se sacan de lo que se pega. */
const SEGUIMIENTO = /^(?:utm_.*|igsh|igshid|si|_t|_r|fbclid|mibextid)$/iu;
const SEGUIMIENTO_DE_X = ["s", "t"];

/** El host que sí acepta el modelo para cada alias de uso común. */
const ALIAS_DE_HOST: Record<string, string> = {
  "instagram.com": "www.instagram.com",
  "m.instagram.com": "www.instagram.com",
  "web.facebook.com": "www.facebook.com",
  "mbasic.facebook.com": "www.facebook.com",
  "mobile.facebook.com": "www.facebook.com",
  "mobile.twitter.com": "x.com",
  "mobile.x.com": "x.com",
  "m.tiktok.com": "www.tiktok.com",
};

/** Un @usuario o un número de teléfono, escrito solo, pasa a la dirección de ese perfil. */
function direccionDeUsuario(tipo: TipoDeRed, texto: string): string | null {
  if (tipo === "whatsapp") return TELEFONO.test(texto) ? `https://wa.me/${texto.replace(/\D/gu, "")}` : null;
  if (tipo === "enlace" || !USUARIO.test(texto) || DOMINIO_CONOCIDO.test(texto)) return null;
  const usuario = texto.replace(/^@/u, "");
  const por: Record<Exclude<TipoDeRed, "whatsapp" | "enlace">, string> = {
    instagram: `https://www.instagram.com/${usuario}`,
    tiktok: `https://www.tiktok.com/@${usuario}`,
    x: `https://x.com/${usuario}`,
    youtube: `https://www.youtube.com/@${usuario}`,
    facebook: `https://www.facebook.com/${usuario}`,
  };
  return por[tipo];
}

/** Le pone https y cambia http por https. Null si trae otro esquema. */
function conEsquema(texto: string): string | null {
  const esquema = /^([a-z][a-z0-9+.-]*):/iu.exec(texto);
  if (!esquema) return `https://${texto.replace(/^\/+/u, "")}`;
  if (/^https?:\/\//iu.test(texto)) return texto.replace(/^http:\/\//iu, "https://");
  return null;
}

/** Cambia los alias, saca el seguimiento y el # y devuelve la dirección limpia. */
function limpiar(direccion: URL): URL {
  const host = direccion.hostname.toLowerCase();
  if (host === "api.whatsapp.com" && direccion.pathname === "/send") {
    const telefono = (direccion.searchParams.get("phone") ?? "").replace(/\D/gu, "");
    if (telefono) return new URL(`https://wa.me/${telefono}`);
  }
  const alias = ALIAS_DE_HOST[host];
  if (alias) direccion.hostname = alias;
  const deX = /^(?:www\.)?(?:x|twitter)\.com$/u.test(direccion.hostname.toLowerCase());
  for (const clave of [...direccion.searchParams.keys()]) {
    if (SEGUIMIENTO.test(clave) || (deX && SEGUIMIENTO_DE_X.includes(clave))) direccion.searchParams.delete(clave);
  }
  direccion.hash = "";
  return direccion;
}

/**
 * Lo que dice una fila de pedido de red sobre lo pegado: la dirección lista, o por qué no sirve. Acepta la dirección
 * entera, sin https, con seguimiento o con la versión móvil, y el @usuario solo (o el teléfono en WhatsApp).
 */
export function revisarEnlace(tipo: TipoDeRed, escrito: string): ResultadoDeEnlace {
  const texto = escrito.trim();
  if (texto === "") return { ok: false, motivo: "vacio" };
  if (texto.length > 2000) return { ok: false, motivo: "mal" };
  const completa = direccionDeUsuario(tipo, texto) ?? conEsquema(texto);
  if (completa === null) return { ok: false, motivo: "mal" };
  let direccion: URL;
  try {
    direccion = limpiar(new URL(completa));
  } catch {
    return { ok: false, motivo: "mal" };
  }
  if (tipo === "enlace" && !direccion.hostname.includes(".")) return { ok: false, motivo: "mal" };
  const url = leerUrl(direccion.href, tipo);
  if (url !== null) return url.length > MAXIMO_DEL_ENLACE ? { ok: false, motivo: "mal" } : { ok: true, url };
  if (tipo !== "enlace" && ENLACES_CORTOS.includes(direccion.hostname.toLowerCase())) return { ok: false, motivo: "corto" };
  const deOtraRed = REDES.some((otra) => otra !== tipo && leerUrl(direccion.href, otra) !== null);
  if (tipo !== "enlace" && deOtraRed) return { ok: false, motivo: "otra-red" };
  return { ok: false, motivo: "mal" };
}
