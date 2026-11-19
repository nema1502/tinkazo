import { DOLAR, comisionDe, dolaresEnTexto, porcentajeEnTexto, totalACargar } from "./campana/comision";
import { type Lang, getLang, textos } from "./idioma";
import { comisionDelBuild } from "./stellar/comision-config";
import { entornoDelBuild } from "./stellar/venta-piloto";

/**
 * Lo que Tinkazo cobra a una campaña de empresa, dicho en pantalla.
 *
 * Una empresa que sortea premios en dólares digitales paga un porcentaje del total de los premios, con un mínimo, antes de abrir
 * la inscripción. Los textos que lo dicen (la página de precios, los términos y la respuesta de la portada) llevan marcadores
 * donde van los números y este archivo los pone: el porcentaje, el mínimo y el ejemplo se escriben en un solo lugar, la
 * configuración del build (`stellar/comision-config.ts`), y ningún texto los repite.
 *
 * - `{p}`: el porcentaje (`2 %` o `2%`).
 * - `{m}`: el mínimo, con dos decimales (`1,50` o `1.50`).
 * - `{e}`: lo que carga una empresa que reparte 120 dólares digitales (`122,40` o `122.40`): el ejemplo del texto.
 *
 * Con la misma forma que el costo del retiro (`costo-del-retiro.ts`): sin la comisión configurada no se dice nada. Las páginas
 * traen su bloque dentro de un `<template data-con-comision>`, que no se ve ni lo lee un buscador mientras nadie lo ponga en
 * la página. No importa el diccionario entero (`i18n.ts`): lo usan también las páginas de lectura.
 */

/** Lo que se reparte en el ejemplo de los textos: 120 dólares digitales. */
const EJEMPLO = 120n * DOLAR;

export interface TextoDeLaComision {
  p: string;
  m: string;
  e: string;
}

/** Los tres números como se escriben en un idioma, o `null` si la comisión no está configurada. Sin entorno, el de este sitio. */
export function comisionTexto(idioma: Lang = getLang(), env: Record<string, unknown> = entornoDelBuild()): TextoDeLaComision | null {
  const c = comisionDelBuild(env);
  if (c === null) return null;
  const comision = comisionDe([EJEMPLO], c.pb, c.minimo);
  return {
    p: porcentajeEnTexto(c.pb, idioma),
    m: dolaresEnTexto(c.minimo, idioma),
    e: dolaresEnTexto(totalACargar([EJEMPLO], comision), idioma),
  };
}

/** Cambia los marcadores de un texto por los números. */
export function conLaComision(texto: string, c: TextoDeLaComision): string {
  return texto.split("{p}").join(c.p).split("{m}").join(c.m).split("{e}").join(c.e);
}

/**
 * Pone en la página lo que dice la comisión. Cada `<template data-con-comision>` se cambia por lo que tiene adentro; en cada
 * texto (`data-i`) de un bloque marcado con `data-comision` va el del diccionario con sus marcadores cambiados; y un elemento
 * con `data-i-con-comision` pasa a usar esa otra clave (la respuesta de la página cambia cuando hay comisión). Sin comisión
 * (`null`) no hace nada y la página queda como si no existiera.
 *
 * Hay que volver a llamarla después de cada cambio de idioma: `setLang` escribe de nuevo el texto del diccionario, con sus
 * marcadores.
 */
export function pintarLaComision(raiz: ParentNode, c: TextoDeLaComision | null = comisionTexto()): void {
  if (c === null) return;
  for (const molde of raiz.querySelectorAll<HTMLTemplateElement>("template[data-con-comision]")) {
    molde.replaceWith(molde.content.cloneNode(true));
  }
  const dict = textos(getLang());
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-i-con-comision]")) {
    const clave = el.dataset.iConComision ?? "";
    if (typeof dict[clave] === "string") el.dataset.i = clave;
  }
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-comision] [data-i], [data-comision][data-i], [data-i-con-comision]")) {
    const v = dict[el.dataset.i ?? ""];
    const base = typeof v === "string" ? v : (el.textContent ?? "");
    el.textContent = conLaComision(base, c);
  }
}
