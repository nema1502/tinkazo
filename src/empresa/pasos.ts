/**
 * Los pasos de la campaña como tarjetas: la empresa elige en qué red está su
 * perfil, pega el enlace y el texto de cada idioma sale escrito solo. Las
 * tarjetas se ordenan con subir, bajar y quitar, todo puro y sin DOM, igual
 * que el resto de la pieza.
 */

import { stripInvisibles } from "../invisibles";
import { leerUrl, type TipoDePaso } from "../campana/modelo";
import type { Lang } from "../idioma";

export const TIPOS_EN_ORDEN = ["instagram", "tiktok", "x", "youtube", "facebook", "whatsapp", "enlace"] as const satisfies readonly TipoDePaso[];

export const MAXIMO_DE_PASOS = 8;

export interface PasoDeEmpresa {
  tipo: TipoDePaso;
  /** El enlace bien valido, o "" mientras no vale o no se pegó. */
  url: string;
  texto: { es: string; en: string };
}

/** Una tarjeta recién abierta de esa red: sin enlace y sin texto por escribir. */
export const PASO_VACIO = (tipoDePaso: TipoDePaso): PasoDeEmpresa => ({ tipo: tipoDePaso, url: "", texto: { es: "", en: "" } });

export const pasosIniciales = (): PasoDeEmpresa[] => [];

export type AccionDePasos =
  | { tipo: "agregar"; tipoDePaso: TipoDePaso }
  | { tipo: "url"; n: number; url: string }
  | { tipo: "quitar"; n: number }
  | { tipo: "subir"; n: number }
  | { tipo: "bajar"; n: number };

/** Lo que queda después de un gesto con las tarjetas. */
export function reducirPasos(
  pasos: readonly PasoDeEmpresa[],
  accion: AccionDePasos | readonly AccionDePasos[],
): PasoDeEmpresa[] {
  let lista: PasoDeEmpresa[] = [...pasos];
  for (const a of Array.isArray(accion) ? accion : [accion]) {
    lista = reducirUno(lista, a);
  }
  return lista;
}

function reducirUno(pasos: readonly PasoDeEmpresa[], a: AccionDePasos): PasoDeEmpresa[] {
  switch (a.tipo) {
    case "agregar":
      return pasos.length < MAXIMO_DE_PASOS ? [...pasos, PASO_VACIO(a.tipoDePaso)] : [...pasos];
    case "url": {
      const paso = pasos[a.n];
      if (!paso) return [...pasos];
      const valido = leerUrl(limpioPegado(a.url), paso.tipo);
      if (valido === null) return pasos.map((p, i) => (i === a.n ? { ...p, url: "", texto: { es: "", en: "" } } : p));
      return pasos.map((p, i) => (i === a.n ? { ...p, url: valido, texto: textoDelPaso(p.tipo, valido) } : p));
    }
    case "quitar":
      return pasos.filter((_, i) => i !== a.n);
    case "subir": {
      if (a.n <= 0) return [...pasos];
      const subida = [...pasos];
      const subido = subida[a.n];
      const deArriba = subida[a.n - 1];
      if (!subido || !deArriba) return [...pasos];
      subida[a.n - 1] = subido;
      subida[a.n] = deArriba;
      return subida;
    }
    case "bajar": {
      if (a.n >= pasos.length - 1) return [...pasos];
      const bajada = [...pasos];
      const bajado = bajada[a.n];
      const deAbajo = bajada[a.n + 1];
      if (!bajado || !deAbajo) return [...pasos];
      bajada[a.n + 1] = bajado;
      bajada[a.n] = deAbajo;
      return bajada;
    }
  }
}

const limpioPegado = (v: string): string => stripInvisibles(v).trim();

/** El texto que sale escrito del enlace del perfil, en los dos idiomas, con la cuenta que lo muestra. */
export function textoDelPaso(tipo: TipoDePaso, url: string): { es: string; en: string } {
  const cuenta = cuentaDeLaUrl(tipo, url);
  if (cuenta) return conCuenta(tipo, cuenta);
  return SIN_CUENTA[tipo] ?? { es: "", en: "" };
}

const conCuenta = (tipo: TipoDePaso, cuenta: string): { es: string; en: string } => {
  switch (tipo) {
    case "instagram":
      return { es: `Seguí a ${cuenta} en Instagram`, en: `Follow ${cuenta} on Instagram` };
    case "tiktok":
      return { es: `Seguí a ${cuenta} en TikTok`, en: `Follow ${cuenta} on TikTok` };
    case "x":
      return { es: `Etiquetá a ${cuenta} en X`, en: `Tag ${cuenta} on X` };
    case "youtube":
      return { es: `Mirá a ${cuenta} en YouTube`, en: `Watch ${cuenta} on YouTube` };
    default:
      return { es: "", en: "" };
  }
};

const SIN_CUENTA: Record<TipoDePaso, { es: string; en: string }> = {
  instagram: { es: "Seguí a la empresa en Instagram", en: "Follow the company on Instagram" },
  tiktok: { es: "Seguí a la empresa en TikTok", en: "Follow the company on TikTok" },
  x: { es: "Etiquetá a la empresa en X", en: "Tag the company on X" },
  youtube: { es: "Mirá el video en YouTube", en: "Watch the video on YouTube" },
  facebook: { es: "Visitá la página en Facebook", en: "Visit the Facebook page" },
  whatsapp: { es: "Entrá al grupo de WhatsApp", en: "Join the WhatsApp group" },
  enlace: { es: "Entrá a este enlace", en: "Open this link" },
  texto: { es: "", en: "" },
};

/** La cuenta que nombra el enlace: la primera parte de su camino, sin la barra. */
function cuentaDeLaUrl(tipo: TipoDePaso, url: string): string | null {
  if (tipo !== "instagram" && tipo !== "tiktok" && tipo !== "x" && tipo !== "youtube") return null;
  const camino = url.replace(/^https:\/\//u, "").split("/").slice(1).filter((p) => p !== "");
  const primero = camino[0];
  if (primero === undefined) return null;
  if (tipo === "youtube" && !primero.startsWith("@")) {
    // La dirección de un video no nombra a nadie: su texto es el de siempre.
    return null;
  }
  const cuenta = primero.startsWith("@") ? primero.slice(1) : primero;
  if (cuenta === "") return null;
  if (!/^[A-Za-z0-9._]{1,30}$/u.test(cuenta)) return null;
  return `@${cuenta}`;
}

/** Lo que sale en la campaña: el texto del idioma, o el de siempre del tipo mientras el enlace no vale. */
export function textoParaLaVista(p: PasoDeEmpresa, idioma: Lang): string {
  return p.texto[idioma];
}
