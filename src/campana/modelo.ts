/**
 * Modelo y validación de la configuración que entrega el servicio de campañas.
 * Este archivo no toca el DOM ni la red: valida JSON no confiable y lo transforma en datos para la pantalla previa.
 */

import { stripInvisibles } from "../invisibles";
import { network } from "../stellar/config";
import { TEXTOS_CAMPANA } from "./textos";

/** Tipos de pasos que una empresa puede pedir. */
export type TipoDePaso = "instagram" | "tiktok" | "x" | "youtube" | "facebook" | "whatsapp" | "enlace" | "texto";

/** Estados posibles de una campaña. */
export type EstadoDeCampana = "borrador" | "abierta" | "cerrada" | "sellada" | "sorteada" | "terminada";

/** Colores de acento que puede elegir una campaña. */
export type ColorDeCampana = "rojo" | "naranja" | "amarillo" | "verde" | "azul" | "morado";

/** Texto disponible en los dos idiomas de la pantalla previa. */
export interface Bilingue {
  es: string;
  en: string;
}

/** Un pedido de la empresa para la pantalla previa. */
export interface PasoDeCampana {
  tipo: TipoDePaso;
  url: string | null;
  texto: Bilingue;
}

/** Configuración validada de una campaña. */
export interface Campana {
  v: 1;
  evento: string;
  red: "mainnet" | "testnet";
  estado: EstadoDeCampana;
  empresa: { nombre: string; logo: { tipo: string; datos: string } | null; color: ColorDeCampana | null };
  lugar: Bilingue;
  zona: string;
  premios: bigint[];
  abreMs: number;
  cierraMs: number;
  sorteoMs: number;
  recibirHastaMs: number;
  entrada: "google" | "google-correo";
  pasos: PasoDeCampana[];
  bases: Bilingue;
  anotadas: number;
  contrato: string | null;
  promo: string | null;
  comprobante: string | null;
}

/** Resultado de leer una configuración, con el campo que impidió mostrarla. */
export type LecturaDeCampana =
  | { ok: true; campana: Campana }
  | { ok: false; campo: string; motivo: string };

const TIPOS: readonly TipoDePaso[] = ["instagram", "tiktok", "x", "youtube", "facebook", "whatsapp", "enlace", "texto"];
const ESTADOS: readonly EstadoDeCampana[] = ["borrador", "abierta", "cerrada", "sellada", "sorteada", "terminada"];
const COLORES: readonly ColorDeCampana[] = ["rojo", "naranja", "amarillo", "verde", "azul", "morado"];
const MAXIMO_DE_FECHA = 8_640_000_000_000_000;
const MAXIMO_DE_LOGO = 40 * 1024;
const MAXIMO_BASE64_DE_LOGO = Math.ceil(MAXIMO_DE_LOGO / 3) * 4;
const DOMINIOS: Record<Exclude<TipoDePaso, "enlace" | "texto">, readonly string[]> = {
  instagram: ["instagram.com", "www.instagram.com"],
  tiktok: ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "fb.com"],
  whatsapp: ["whatsapp.com", "www.whatsapp.com", "chat.whatsapp.com", "wa.me"],
};

const fallo = (campo: string, motivo = "inválido"): FalloDeCampana => ({ ok: false, campo, motivo });
const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const esCadena = (x: unknown): x is string => typeof x === "string";
const esEnteroPositivo = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x > 0 && x <= MAXIMO_DE_FECHA;
const esMiembro = <T extends string>(x: unknown, lista: readonly T[]): x is T =>
  typeof x === "string" && lista.includes(x as T);
type FalloDeCampana = Extract<LecturaDeCampana, { ok: false }>;
const esFallo = (x: object): x is FalloDeCampana => "ok" in x && x.ok === false;

function textoLimpio(x: string, permitirSaltos = false): boolean {
  const controles = permitirSaltos
    ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u
    : /[\u0000-\u001F\u007F-\u009F]/u;
  return stripInvisibles(x) === x && !controles.test(x);
}

function leerBilingue(
  x: unknown,
  campo: string,
  maximo: number,
  permitirSaltos = false,
): Bilingue | FalloDeCampana {
  if (!esObjeto(x) || !esCadena(x.es) || !esCadena(x.en)) return fallo(campo);
  if (x.es.length < 1 || x.es.length > maximo) return fallo(campo);
  if (x.en.length < 1 || x.en.length > maximo) return fallo(campo);
  if (!textoLimpio(x.es, permitirSaltos) || !textoLimpio(x.en, permitirSaltos)) return fallo(campo);
  return { es: x.es, en: x.en };
}

function leerNombre(x: unknown): string | FalloDeCampana {
  if (!esCadena(x) || x.trim() !== x || x.length < 1 || x.length > 40 || !textoLimpio(x)) {
    return fallo("empresa.nombre");
  }
  return x;
}

function leerLogo(x: unknown): Campana["empresa"]["logo"] | FalloDeCampana {
  if (x === null) return null;
  const tipos = ["image/webp", "image/png", "image/jpeg"];
  if (!esObjeto(x) || !esCadena(x.tipo) || !tipos.includes(x.tipo) || !esCadena(x.datos)) {
    return fallo("empresa.logo");
  }
  if (x.datos.length > MAXIMO_BASE64_DE_LOGO) return fallo("empresa.logo");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(x.datos)) {
    return fallo("empresa.logo");
  }
  const relleno = x.datos.endsWith("==") ? 2 : x.datos.endsWith("=") ? 1 : 0;
  const bytes = x.datos.length / 4 * 3 - relleno;
  return bytes <= MAXIMO_DE_LOGO ? { tipo: x.tipo, datos: x.datos } : fallo("empresa.logo");
}

/** Un centavo, en unidades de siete decimales: lo mínimo que la pantalla puede mostrar sin inflar el monto. */
const UN_CENTAVO = 100000n;

function leerPremios(x: unknown): bigint[] | FalloDeCampana {
  if (!Array.isArray(x) || x.length < 1 || x.length > 10) return fallo("premios");
  const premios: bigint[] = [];
  for (const premio of x) {
    if (!esCadena(premio) || !/^\d{1,16}$/u.test(premio) || BigInt(premio) < UN_CENTAVO) return fallo("premios");
    premios.push(BigInt(premio));
  }
  return premios;
}

function leerHoras(
  x: Record<string, unknown>,
): { abreMs: number; cierraMs: number; sorteoMs: number; recibirHastaMs: number } | FalloDeCampana {
  const abre = x.abre_ms;
  const cierra = x.cierra_ms;
  const sorteo = x.sorteo_ms;
  const recibirHasta = x.recibir_hasta_ms;
  if (!esEnteroPositivo(abre)) return fallo("abre_ms");
  if (!esEnteroPositivo(cierra)) return fallo("cierra_ms");
  if (!esEnteroPositivo(sorteo)) return fallo("sorteo_ms");
  if (!esEnteroPositivo(recibirHasta)) return fallo("recibir_hasta_ms");
  const abreMs = abre;
  const cierraMs = cierra;
  const sorteoMs = sorteo;
  const recibirHastaMs = recibirHasta;
  if (!(abreMs < cierraMs && cierraMs <= sorteoMs && sorteoMs < recibirHastaMs)) return fallo("horas");
  return { abreMs, cierraMs, sorteoMs, recibirHastaMs };
}

function leerUrl(url: unknown, tipo: TipoDePaso): string | null {
  if (!esCadena(url)) return null;
  try {
    const direccion = new URL(url);
    if (direccion.username || direccion.password) return null;
    if (direccion.protocol !== "https:" || direccion.port !== "") return null;
    if (tipo !== "enlace" && (tipo === "texto" || !DOMINIOS[tipo].includes(direccion.hostname.toLowerCase()))) {
      return null;
    }
    return direccion.href;
  } catch {
    return null;
  }
}

function textoPorTipo(tipo: TipoDePaso, idioma: "es" | "en"): string {
  const claves: Record<TipoDePaso, string> = {
    instagram: "cpPasoInstagram",
    tiktok: "cpPasoTiktok",
    x: "cpPasoX",
    youtube: "cpPasoYoutube",
    facebook: "cpPasoFacebook",
    whatsapp: "cpPasoWhatsapp",
    enlace: "cpPasoEnlace",
    texto: "cpPasoEnlace",
  };
  return TEXTOS_CAMPANA[idioma][claves[tipo]] ?? "";
}

function leerTextoDePaso(x: unknown, tipo: TipoDePaso): Bilingue | FalloDeCampana {
  if (!esObjeto(x) || !esCadena(x.es) || !esCadena(x.en)) return fallo("pasos.texto");
  if (x.es.length > 120 || x.en.length > 120) return fallo("pasos.texto");
  if (tipo === "texto" && (x.es.length < 1 || x.en.length < 1)) return fallo("pasos.texto");
  if (!textoLimpio(x.es) || !textoLimpio(x.en)) return fallo("pasos.texto");
  return {
    es: x.es || textoPorTipo(tipo, "es"),
    en: x.en || textoPorTipo(tipo, "en"),
  };
}

function leerPasos(x: unknown): PasoDeCampana[] | FalloDeCampana {
  if (!Array.isArray(x) || x.length > 8) return fallo("pasos");
  const pasos: PasoDeCampana[] = [];
  for (const paso of x) {
    if (!esObjeto(paso) || !esMiembro(paso.tipo, TIPOS)) return fallo("pasos");
    const texto = leerTextoDePaso(paso.texto, paso.tipo);
    if (esFallo(texto)) return texto;
    const url = paso.url;
    if (paso.tipo === "texto" && url !== null) return fallo("pasos.url");
    const direccion = paso.tipo === "texto" ? null : leerUrl(url, paso.tipo);
    if (paso.tipo !== "texto" && direccion === null) return fallo("pasos.url");
    pasos.push({ tipo: paso.tipo, url: direccion, texto });
  }
  return pasos;
}

function leerCampoOpcional(x: unknown, expresion: RegExp, campo: string): string | null | FalloDeCampana {
  if (x === null) return null;
  return esCadena(x) && expresion.test(x) ? x : fallo(campo);
}

/** Lee, valida y normaliza la configuración JSON de una campaña. */
export function leerCampana(x: unknown): LecturaDeCampana {
  if (!esObjeto(x)) return fallo("campana");
  if (x.v !== 1) return fallo("v");
  if (!esCadena(x.evento) || !/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u.test(x.evento)) return fallo("evento");
  if (!esMiembro(x.red, ["mainnet", "testnet"] as const)) return fallo("red");
  if (x.red !== network.name) return fallo("red", "otra-red");
  if (!esMiembro(x.estado, ESTADOS)) return fallo("estado");
  if (!esObjeto(x.empresa)) return fallo("empresa");
  const nombre = leerNombre(x.empresa.nombre);
  if (typeof nombre !== "string") return nombre;
  const logo = leerLogo(x.empresa.logo);
  if (logo !== null && esFallo(logo)) return logo;
  const color = esMiembro(x.empresa.color, COLORES) ? x.empresa.color : null;
  const lugar = leerBilingue(x.lugar, "lugar", 60);
  if (esFallo(lugar)) return lugar;
  if (!esCadena(x.zona)) return fallo("zona");
  try {
    new Intl.DateTimeFormat("es", { timeZone: x.zona }).format(0);
  } catch {
    return fallo("zona");
  }
  const premios = leerPremios(x.premios);
  if (!Array.isArray(premios)) return premios;
  const horas = leerHoras(x);
  if (esFallo(horas)) return horas;
  if (!esMiembro(x.entrada, ["google", "google-correo"] as const)) return fallo("entrada");
  const pasos = leerPasos(x.pasos);
  if (!Array.isArray(pasos)) return pasos;
  const bases = leerBilingue(x.bases, "bases", 6000, true);
  if (esFallo(bases)) return bases;
  if (typeof x.anotadas !== "number" || !Number.isSafeInteger(x.anotadas) || x.anotadas < 0) {
    return fallo("anotadas");
  }
  const contrato = leerCampoOpcional(x.contrato, /^C[A-Z2-7]{55}$/u, "contrato");
  if (typeof contrato !== "string" && contrato !== null) return contrato;
  const promo = leerCampoOpcional(x.promo, /^\d+$/u, "promo");
  if (typeof promo !== "string" && promo !== null) return promo;
  const comprobante = leerCampoOpcional(x.comprobante, /^\/verificar\.html(?:[?#].*)?$/u, "comprobante");
  if (typeof comprobante !== "string" && comprobante !== null) return comprobante;
  return {
    ok: true,
    campana: {
      v: 1,
      evento: x.evento,
      red: x.red,
      estado: x.estado,
      empresa: { nombre, logo, color },
      lugar,
      zona: x.zona,
      premios,
      ...horas,
      entrada: x.entrada,
      pasos,
      bases,
      anotadas: x.anotadas,
      contrato,
      promo,
      comprobante,
    },
  };
}
