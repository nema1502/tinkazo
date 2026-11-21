/**
 * El estado del formulario para armar una campaña y lo que le puede pasar. Todo es puro y sin reloj: lo que necesita la hora
 * (elegir el día de hoy) la trae en la acción. Lo guardado en este navegador se lee como dato no confiable, campo por campo.
 */

import type { Lang } from "../../idioma";
import { stripInvisibles } from "../../invisibles";
import type { Bilingue, ColorDeCampana, EstadoDeCampana, TipoDePaso } from "../modelo";
import { MAXIMO_DE_LAS_BASES } from "./constantes";
import { ajustarHoras } from "./horas";
import { TIPOS_EN_ORDEN, TOPE_DE_PEDIDOS } from "./redes";

export type NumeroDePaso = 1 | 2 | 3 | 4 | 5 | 6;
export type TipoDeLogo = "image/webp" | "image/png" | "image/jpeg";

export interface LogoDelFormulario {
  tipo: TipoDeLogo;
  datos: string;
}

export interface PasoDelFormulario {
  tipo: TipoDePaso;
  url: string;
  texto: Bilingue;
  /** Si el texto de ese idioma se escribió a mano: mientras no, sigue al del otro. Solo cuenta en el pedido escrito. */
  editadoEs: boolean;
  editadoEn: boolean;
}

export interface BasesDelFormulario {
  es: string | null;
  en: string | null;
  moldeEs: string | null;
  moldeEn: string | null;
}

/** Lo que trae un archivo abierto y esta página no edita: se repite tal cual al volver a armarlo. */
export interface ConservadoDelArchivo {
  organizadora: string | null;
  contrato: string | null;
  promo: string | null;
  comprobante: string | null;
  recibirHastaMs: number | null;
  /** Cómo entra la gente, en qué estado venía, de qué red y cuántas anotadas traía: tampoco se editan acá. */
  entrada: "google" | "google-correo";
  estado: EstadoDeCampana;
  red: "mainnet" | "testnet";
  anotadas: number;
  /** El lugar en las dos lenguas tal como venía: el inglés propio se repite mientras el español no cambie. */
  lugar: { es: string; en: string } | null;
}

/** El archivo que se abrió: su texto, su firma si la trae, y los datos con los que se hizo su evento. */
export interface OrigenDelArchivo {
  texto: string;
  firma: string | null;
  evento: string;
  nombre: string;
  fecha: string;
  abre: string;
}

export interface FormularioDeCampana {
  v: 1;
  paso: NumeroDePaso;
  /** El más alto al que llegó: los anteriores se pueden tocar. */
  visitado: NumeroDePaso;
  nombre: string;
  logo: LogoDelFormulario | null;
  /** Si el logo se dibujó sobre fondo blanco. */
  blanco: boolean;
  color: ColorDeCampana | null;
  /** Dólares digitales enteros que se lleva cada persona. */
  monto: number | null;
  /** Si se ve el contador de otro monto. */
  otroMonto: boolean;
  ganan: number;
  fecha: string;
  abre: string;
  cierra: string;
  sorteo: string;
  zona: string;
  lugar: string;
  pasos: PasoDelFormulario[];
  bases: BasesDelFormulario;
  /** Cuatro letras o números que se crean una sola vez: hacen distinto el evento de dos marcas parecidas. */
  sufijo: string;
  conservado: ConservadoDelArchivo | null;
  origen: OrigenDelArchivo | null;
}

export const MONTOS = [5, 10, 20, 40, 50, 100, 200] as const;
export const OTRO_MONTO = { minimo: 5, maximo: 1000, inicial: 10 } as const;
export const MAXIMO_DE_GANAN = 10;
export const MAXIMO_DEL_NOMBRE = 40;
export const MAXIMO_DEL_LUGAR = 60;
export const MAXIMO_DEL_PEDIDO = 120;
export const CLAVE_DE_GUARDADO = "tinkazo.crear-campana.v1";
export const COLORES_EN_ORDEN: readonly ColorDeCampana[] = ["rojo", "naranja", "amarillo", "verde", "azul", "morado"];

/** De cuánto en cuánto sube el contador de otro monto desde un valor: de a 5 hasta 50, de a 10 hasta 200 y de a 50 después. */
export function saltoDeSubida(monto: number): number {
  return monto < 50 ? 5 : monto < 200 ? 10 : 50;
}

/** Lo que baja el contador desde un valor: el salto del tramo de abajo. */
export function saltoDeBajada(monto: number): number {
  return monto <= 50 ? 5 : monto <= 200 ? 10 : 50;
}

/** Cuatro letras o números al azar, de la parte segura del navegador si la hay. */
export function sufijoNuevo(): string {
  const letras = "abcdefghijklmnopqrstuvwxyz0123456789";
  const valores = new Uint32Array(4);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(valores);
  else for (let i = 0; i < 4; i += 1) valores[i] = Math.floor(Math.random() * 4_294_967_296);
  return [...valores].map((v) => letras.charAt(v % letras.length)).join("");
}

export function basesVacias(): BasesDelFormulario {
  return { es: null, en: null, moldeEs: null, moldeEn: null };
}

export function formularioInicial(zona: string, sufijo: string): FormularioDeCampana {
  return {
    v: 1,
    paso: 1,
    visitado: 1,
    nombre: "",
    logo: null,
    blanco: false,
    color: null,
    monto: null,
    otroMonto: false,
    ganan: 1,
    fecha: "",
    abre: "10:00",
    cierra: "18:00",
    sorteo: "18:30",
    zona,
    lugar: "",
    pasos: [],
    bases: basesVacias(),
    sufijo,
    conservado: null,
    origen: null,
  };
}

/** La campaña de muestra de la demostración: nada de esto se guarda. */
export function formularioDeDemostracion(manana: string, zona: string): FormularioDeCampana {
  const pedido = (tipo: TipoDePaso, url: string): PasoDelFormulario => ({
    tipo,
    url,
    texto: { es: "", en: "" },
    editadoEs: false,
    editadoEn: false,
  });
  return {
    ...formularioInicial(zona, "demo"),
    visitado: 6,
    nombre: "Alcancía Andina",
    color: "verde",
    monto: 40,
    ganan: 3,
    fecha: manana,
    lugar: "Hackathon",
    pasos: [pedido("instagram", "https://www.instagram.com/alcanciaandina"), pedido("tiktok", "https://www.tiktok.com/@alcanciaandina")],
  };
}

export type Accion =
  | { t: "nombre"; valor: string }
  | { t: "logo"; valor: LogoDelFormulario | null; blanco: boolean }
  | { t: "color"; valor: ColorDeCampana }
  | { t: "monto"; valor: number }
  | { t: "otro-monto" }
  | { t: "otro-mas" }
  | { t: "otro-menos" }
  | { t: "ganan-mas" }
  | { t: "ganan-menos" }
  | { t: "fecha"; valor: string; ahora: number }
  | { t: "hora"; cual: "abre" | "cierra" | "sorteo"; valor: string }
  | { t: "lugar"; valor: string }
  | { t: "sumar-paso"; tipo: TipoDePaso }
  | { t: "paso-url"; indice: number; valor: string }
  | { t: "paso-texto"; indice: number; idioma: Lang; valor: string }
  | { t: "quitar-paso"; indice: number }
  | { t: "bases"; idioma: Lang; valor: string; automaticas: Bilingue }
  | { t: "rehacer-bases" }
  | { t: "dejar-bases"; automaticas: Bilingue }
  | { t: "ir"; paso: NumeroDePaso }
  | { t: "seguir" }
  | { t: "abrir"; estado: FormularioDeCampana };

/** Saca los caracteres que no se ven y los controles. En las bases se dejan los saltos de línea. */
export function limpiarTexto(texto: string, conSaltos = false): string {
  const sinRetorno = texto.replace(/\r\n?/gu, "\n");
  const sinInvisibles = stripInvisibles(sinRetorno);
  const controles = conSaltos ? /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu : /[\u0000-\u001F\u007F-\u009F]/gu;
  return sinInvisibles.replace(controles, "");
}

const entre = (n: number, minimo: number, maximo: number): number => Math.min(maximo, Math.max(minimo, n));

function conPaso(f: FormularioDeCampana, indice: number, cambio: (p: PasoDelFormulario) => PasoDelFormulario): FormularioDeCampana {
  if (indice < 0 || indice >= f.pasos.length) return f;
  return { ...f, pasos: f.pasos.map((p, i) => (i === indice ? cambio(p) : p)) };
}

function conBases(f: FormularioDeCampana, idioma: Lang, valor: string, automaticas: Bilingue): FormularioDeCampana {
  const b = f.bases;
  const [actual, molde] = idioma === "es" ? [b.es, b.moldeEs] : [b.en, b.moldeEn];
  // Si lo escrito vuelve a ser igual a lo automático, queda otra vez automático.
  if (valor === automaticas[idioma]) {
    return { ...f, bases: idioma === "es" ? { ...b, es: null, moldeEs: null } : { ...b, en: null, moldeEn: null } };
  }
  const moldeNuevo = actual === null ? automaticas[idioma] : molde;
  return {
    ...f,
    bases: idioma === "es" ? { ...b, es: valor, moldeEs: moldeNuevo } : { ...b, en: valor, moldeEn: moldeNuevo },
  };
}

/** Pura: el formulario después de una acción. Los contadores no se pasan de sus topes y ir solo lleva a un paso visitado. */
export function reducir(f: FormularioDeCampana, a: Accion): FormularioDeCampana {
  switch (a.t) {
    case "nombre":
      return { ...f, nombre: limpiarTexto(a.valor).slice(0, MAXIMO_DEL_NOMBRE) };
    case "logo":
      return { ...f, logo: a.valor, blanco: a.valor === null ? false : a.blanco };
    case "color":
      return { ...f, color: a.valor };
    case "monto":
      return { ...f, monto: a.valor, otroMonto: false };
    case "otro-monto":
      return { ...f, monto: f.monto ?? OTRO_MONTO.inicial, otroMonto: true };
    case "otro-mas": {
      const actual = f.monto ?? OTRO_MONTO.inicial;
      return { ...f, monto: actual >= OTRO_MONTO.maximo ? actual : entre(actual + saltoDeSubida(actual), OTRO_MONTO.minimo, OTRO_MONTO.maximo) };
    }
    case "otro-menos": {
      const actual = f.monto ?? OTRO_MONTO.inicial;
      return { ...f, monto: entre(actual - saltoDeBajada(actual), OTRO_MONTO.minimo, OTRO_MONTO.maximo) };
    }
    case "ganan-mas":
      return { ...f, ganan: entre(f.ganan + 1, 1, MAXIMO_DE_GANAN) };
    case "ganan-menos":
      return { ...f, ganan: entre(f.ganan - 1, 1, MAXIMO_DE_GANAN) };
    case "fecha": {
      const dia = { ...f, fecha: a.valor };
      const ajustadas = ajustarHoras(dia, a.ahora);
      return ajustadas.ajustada ? { ...dia, abre: ajustadas.abre, cierra: ajustadas.cierra, sorteo: ajustadas.sorteo } : dia;
    }
    case "hora":
      return { ...f, [a.cual]: a.valor };
    case "lugar":
      return { ...f, lugar: limpiarTexto(a.valor).slice(0, MAXIMO_DEL_LUGAR) };
    case "sumar-paso":
      if (f.pasos.length >= TOPE_DE_PEDIDOS || !TIPOS_EN_ORDEN.includes(a.tipo)) return f;
      return {
        ...f,
        pasos: [...f.pasos, { tipo: a.tipo, url: "", texto: { es: "", en: "" }, editadoEs: false, editadoEn: false }],
      };
    case "paso-url":
      return conPaso(f, a.indice, (p) => ({ ...p, url: limpiarTexto(a.valor).slice(0, 2000) }));
    case "paso-texto":
      return conPaso(f, a.indice, (p) => {
        const valor = limpiarTexto(a.valor).slice(0, MAXIMO_DEL_PEDIDO);
        const otro: Lang = a.idioma === "es" ? "en" : "es";
        const otroEditado = otro === "es" ? p.editadoEs : p.editadoEn;
        // Mientras el otro idioma no se escribió a mano, sigue al que se está escribiendo: nadie escribe dos veces.
        const texto = { ...p.texto, [a.idioma]: valor, ...(otroEditado ? {} : { [otro]: valor }) };
        return a.idioma === "es" ? { ...p, texto, editadoEs: true } : { ...p, texto, editadoEn: true };
      });
    case "quitar-paso":
      return { ...f, pasos: f.pasos.filter((_, i) => i !== a.indice) };
    case "bases":
      return conBases(f, a.idioma, limpiarTexto(a.valor, true).slice(0, MAXIMO_DE_LAS_BASES + 1), a.automaticas);
    case "rehacer-bases":
      return { ...f, bases: basesVacias() };
    case "dejar-bases":
      return {
        ...f,
        bases: {
          ...f.bases,
          moldeEs: f.bases.es === null ? null : a.automaticas.es,
          moldeEn: f.bases.en === null ? null : a.automaticas.en,
        },
      };
    case "ir":
      return a.paso <= f.visitado ? { ...f, paso: a.paso } : f;
    case "seguir": {
      const siguiente = Math.min(6, f.paso + 1) as NumeroDePaso;
      return { ...f, paso: siguiente, visitado: Math.max(f.visitado, siguiente) as NumeroDePaso };
    }
    case "abrir":
      return a.estado;
  }
}

/* --- lo guardado en este navegador --- */

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const esCadena = (x: unknown, maximo: number): x is string => typeof x === "string" && x.length <= maximo;
const esCadenaONulo = (x: unknown, maximo: number): x is string | null => x === null || esCadena(x, maximo);
const esHora = (x: unknown): x is string => typeof x === "string" && (x === "" || /^\d{2}:\d{2}$/u.test(x));
const esFecha = (x: unknown): x is string => typeof x === "string" && (x === "" || /^\d{4}-\d{2}-\d{2}$/u.test(x));
const esPaso = (x: unknown): x is NumeroDePaso => typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 6;

/** Lo más largo que puede ser el logo en base64: el mismo tope y la misma forma que acepta el lector de la campaña. */
const MAXIMO_BASE64_DEL_LOGO = Math.ceil((40 * 1024) / 3) * 4;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const ESTADOS_DEL_ARCHIVO: readonly EstadoDeCampana[] = ["borrador", "abierta", "cerrada", "sellada", "sorteada", "terminada"];

function leerLogoGuardado(x: unknown): LogoDelFormulario | null | undefined {
  if (x === null) return null;
  if (!esObjeto(x) || !esCadena(x.datos, MAXIMO_BASE64_DEL_LOGO) || !BASE64.test(x.datos)) return undefined;
  const tipo = x.tipo;
  if (tipo !== "image/webp" && tipo !== "image/png" && tipo !== "image/jpeg") return undefined;
  return { tipo, datos: x.datos };
}

function leerBasesGuardadas(x: unknown): BasesDelFormulario | null {
  if (!esObjeto(x)) return null;
  const { es, en, moldeEs, moldeEn } = x;
  const largo = MAXIMO_DE_LAS_BASES + 1;
  if (![es, en, moldeEs, moldeEn].every((v) => esCadenaONulo(v, largo))) return null;
  return { es: es as string | null, en: en as string | null, moldeEs: moldeEs as string | null, moldeEn: moldeEn as string | null };
}

function leerPasosGuardados(x: unknown): PasoDelFormulario[] | null {
  if (!Array.isArray(x) || x.length > TOPE_DE_PEDIDOS) return null;
  const pasos: PasoDelFormulario[] = [];
  for (const p of x as unknown[]) {
    if (!esObjeto(p) || !esObjeto(p.texto)) return null;
    const tipo = TIPOS_EN_ORDEN.find((t) => t === p.tipo);
    const { es, en } = p.texto;
    if (!tipo || !esCadena(p.url, 2000) || !esCadena(es, MAXIMO_DEL_PEDIDO) || !esCadena(en, MAXIMO_DEL_PEDIDO)) return null;
    pasos.push({ tipo, url: p.url, texto: { es, en }, editadoEs: p.editadoEs === true, editadoEn: p.editadoEn === true });
  }
  return pasos;
}

function leerConservado(x: unknown): ConservadoDelArchivo | null | undefined {
  if (x === null) return null;
  if (!esObjeto(x)) return undefined;
  const { organizadora, contrato, promo, comprobante, recibirHastaMs } = x;
  if (![organizadora, contrato, promo, comprobante].every((v) => esCadenaONulo(v, 400))) return undefined;
  if (recibirHastaMs !== null && !(typeof recibirHastaMs === "number" && Number.isSafeInteger(recibirHastaMs))) return undefined;
  // Lo que se guardó antes de que se conservara esto no lo trae: se asume lo que armaba la página hasta entonces.
  const lugar = esObjeto(x.lugar) && esCadena(x.lugar.es, 400) && esCadena(x.lugar.en, 400) ? { es: x.lugar.es, en: x.lugar.en } : null;
  return {
    organizadora: organizadora as string | null,
    contrato: contrato as string | null,
    promo: promo as string | null,
    comprobante: comprobante as string | null,
    recibirHastaMs: recibirHastaMs as number | null,
    entrada: x.entrada === "google-correo" ? "google-correo" : "google",
    estado: ESTADOS_DEL_ARCHIVO.find((e) => e === x.estado) ?? "abierta",
    red: x.red === "testnet" ? "testnet" : "mainnet",
    anotadas: typeof x.anotadas === "number" && Number.isSafeInteger(x.anotadas) && x.anotadas >= 0 ? x.anotadas : 0,
    lugar,
  };
}

function leerOrigen(x: unknown): OrigenDelArchivo | null | undefined {
  if (x === null) return null;
  if (!esObjeto(x)) return undefined;
  const { texto, firma, evento, nombre, fecha, abre } = x;
  if (!esCadena(texto, 90_000) || !esCadenaONulo(firma, 400) || !esCadena(evento, 40) || !esCadena(nombre, 80)) return undefined;
  if (!esFecha(fecha) || !esHora(abre)) return undefined;
  return { texto, firma, evento, nombre, fecha, abre };
}

function zonaValida(x: unknown): x is string {
  if (typeof x !== "string" || x.length < 1 || x.length > 64) return false;
  try {
    new Intl.DateTimeFormat("es", { timeZone: x }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** El formulario guardado en este navegador, o null si no hay o no tiene la forma. Se lee como dato no confiable. */
export function leerGuardado(texto: string | null): FormularioDeCampana | null {
  if (!texto || texto.length > 400_000) return null;
  let x: unknown;
  try {
    x = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!esObjeto(x) || x.v !== 1 || !esPaso(x.paso) || !esPaso(x.visitado) || x.paso > x.visitado) return null;
  const logo = leerLogoGuardado(x.logo);
  const bases = leerBasesGuardadas(x.bases);
  const pasos = leerPasosGuardados(x.pasos);
  const conservado = leerConservado(x.conservado);
  const origen = leerOrigen(x.origen);
  if (logo === undefined || !bases || !pasos || conservado === undefined || origen === undefined) return null;
  const color = COLORES_EN_ORDEN.find((c) => c === x.color) ?? null;
  const monto = typeof x.monto === "number" && Number.isInteger(x.monto) && x.monto >= 1 && x.monto <= 100_000 ? x.monto : null;
  const ganan = typeof x.ganan === "number" && Number.isInteger(x.ganan) ? entre(x.ganan, 1, MAXIMO_DE_GANAN) : null;
  if (!esCadena(x.nombre, MAXIMO_DEL_NOMBRE) || !esCadena(x.lugar, MAXIMO_DEL_LUGAR) || ganan === null) return null;
  if (!esFecha(x.fecha) || !esHora(x.abre) || !esHora(x.cierra) || !esHora(x.sorteo) || !zonaValida(x.zona)) return null;
  if (typeof x.sufijo !== "string" || !/^[a-z0-9]{4}$/u.test(x.sufijo)) return null;
  return {
    v: 1,
    paso: x.paso,
    visitado: x.visitado,
    nombre: x.nombre,
    logo,
    blanco: x.blanco === true,
    color,
    monto,
    otroMonto: x.otroMonto === true,
    ganan,
    fecha: x.fecha,
    abre: x.abre,
    cierra: x.cierra,
    sorteo: x.sorteo,
    zona: x.zona,
    lugar: x.lugar,
    pasos,
    bases,
    sufijo: x.sufijo,
    conservado,
    origen,
  };
}
