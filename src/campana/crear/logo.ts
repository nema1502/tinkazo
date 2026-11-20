/**
 * El logo de la marca: se elige una imagen cualquiera y la página la achica sola hasta que pese lo que acepta el modelo,
 * en webp o png. El achicado va detrás de dependencias para poder probarlo sin un canvas de verdad.
 */

import type { TipoDeLogo } from "./estado";

/** El mismo número que el tope del logo del modelo. */
export const MAXIMO_DEL_LOGO = 40 * 1024;
/** Una imagen más pesada que esto no se abre: no se puede dibujar sin trabar la página. */
export const MAXIMO_DE_ENTRADA = 15 * 1024 * 1024;
const LADOS = [512, 384, 256, 192, 128, 96];
const CALIDADES = [0.9, 0.75, 0.6];
/** Un dibujo vectorial no tiene tamaño propio que respetar: se dibuja con su lado mayor en este número. */
const LADO_DEL_VECTORIAL = 512;

export interface DepsDelLogo<I> {
  abrir: (archivo: Blob) => Promise<{ imagen: I; ancho: number; alto: number } | null>;
  /** Dibuja la imagen en ese tamaño y la escribe en ese tipo. Con `blanco` rellena el fondo antes de dibujar. */
  dibujar: (imagen: I, ancho: number, alto: number, tipo: string, calidad: number, blanco: boolean) => Promise<Blob | null>;
  bytes: (blob: Blob) => Promise<Uint8Array>;
}

export interface LogoAchicado {
  tipo: "image/webp" | "image/png";
  datos: string;
}

/** Los bytes en base64, por tramos para no pasarse del largo que aguanta una sola llamada. */
export function base64DeBytes(bytes: Uint8Array): string {
  let salida = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    salida += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(salida);
}

/** Las medidas de un dibujo vectorial: las de su viewBox y, si no las tiene, las de su ancho y su alto. Null si no hay. */
export function medidasDeVectorial(texto: string): { ancho: number; alto: number } | null {
  const caja = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/iu.exec(texto);
  const [ancho, alto] = caja ? [Number(caja[1]), Number(caja[2])] : [0, 0];
  if (ancho > 0 && alto > 0) return { ancho, alto };
  const w = /\bwidth\s*=\s*["']\s*([\d.]+)/iu.exec(texto);
  const h = /\bheight\s*=\s*["']\s*([\d.]+)/iu.exec(texto);
  const [a, b] = [Number(w?.[1]), Number(h?.[1])];
  return a > 0 && b > 0 ? { ancho: a, alto: b } : null;
}

/**
 * Achica el logo hasta que pese `MAXIMO_DEL_LOGO` o menos. Prueba lados cada vez más chicos, cada uno en webp con tres
 * calidades y después en png, y se queda con el primero que entra. Nunca agranda una imagen común, y siempre la dibuja de
 * nuevo (así no viajan los datos que trae adentro una foto). Un vectorial se dibuja con su lado mayor en 512. Null si no
 * se abre, pesa de más o ninguna medida entra.
 */
export async function achicarLogo<I>(archivo: Blob, deps: DepsDelLogo<I>, opciones: { blanco?: boolean } = {}): Promise<LogoAchicado | null> {
  if (archivo.size > MAXIMO_DE_ENTRADA) return null;
  const abierta = await deps.abrir(archivo);
  if (!abierta || !(abierta.ancho > 0) || !(abierta.alto > 0)) return null;
  const vectorial = archivo.type === "image/svg+xml";
  const mayor = Math.max(abierta.ancho, abierta.alto);
  const blanco = opciones.blanco === true;
  for (const lado of LADOS) {
    const escala = vectorial ? lado / mayor : Math.min(1, lado / mayor);
    const ancho = Math.max(1, Math.round(abierta.ancho * escala));
    const alto = Math.max(1, Math.round(abierta.alto * escala));
    const intentos: Array<[string, number]> = [...CALIDADES.map((c): [string, number] => ["image/webp", c]), ["image/png", 1]];
    for (const [tipo, calidad] of intentos) {
      const blob = await deps.dibujar(abierta.imagen, ancho, alto, tipo, calidad, blanco);
      // El tipo que vale es el que escribió el navegador: uno que no sabe webp devuelve png.
      if (!blob || (blob.type !== "image/webp" && blob.type !== "image/png") || blob.size > MAXIMO_DEL_LOGO) continue;
      return { tipo: blob.type, datos: base64DeBytes(await deps.bytes(blob)) };
    }
  }
  return null;
}

/** Los bytes de un logo guardado, para volver a dibujarlo (por ejemplo sobre fondo blanco). Null si los datos están rotos. */
export function blobDeLogo(logo: { tipo: TipoDeLogo; datos: string }): Blob | null {
  try {
    const texto = atob(logo.datos);
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i += 1) bytes[i] = texto.charCodeAt(i);
    return new Blob([bytes], { type: logo.tipo });
  } catch {
    return null;
  }
}

/** Lo que usa la página: createImageBitmap con respaldo en una imagen común, y un canvas del tamaño pedido. */
export function depsDelNavegador(): DepsDelLogo<CanvasImageSource> {
  return {
    abrir: async (archivo) => {
      const vectorial = archivo.type === "image/svg+xml";
      if (!vectorial) {
        try {
          const mapa = await createImageBitmap(archivo);
          return { imagen: mapa, ancho: mapa.width, alto: mapa.height };
        } catch {
          /* algunos navegadores no abren ciertos tipos así: se prueba con una imagen común */
        }
      }
      const direccion = URL.createObjectURL(archivo);
      try {
        const imagen = new Image();
        imagen.src = direccion;
        await imagen.decode();
        const propias = imagen.naturalWidth > 0 && imagen.naturalHeight > 0;
        const medidas = propias
          ? { ancho: imagen.naturalWidth, alto: imagen.naturalHeight }
          : vectorial
            ? medidasDeVectorial(await archivo.text()) ?? { ancho: LADO_DEL_VECTORIAL, alto: LADO_DEL_VECTORIAL }
            : null;
        return medidas ? { imagen, ...medidas } : null;
      } catch {
        return null;
      } finally {
        URL.revokeObjectURL(direccion);
      }
    },
    dibujar: (imagen, ancho, alto, tipo, calidad, blanco) =>
      new Promise((resolver) => {
        const lienzo = document.createElement("canvas");
        lienzo.width = ancho;
        lienzo.height = alto;
        const contexto = lienzo.getContext("2d");
        if (!contexto) return resolver(null);
        if (blanco) {
          contexto.fillStyle = "#ffffff";
          contexto.fillRect(0, 0, ancho, alto);
        }
        contexto.drawImage(imagen, 0, 0, ancho, alto);
        lienzo.toBlob((blob) => resolver(blob), tipo, calidad);
      }),
    bytes: async (blob) => new Uint8Array(await blob.arrayBuffer()),
  };
}
