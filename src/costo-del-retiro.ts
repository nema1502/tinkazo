import { type Lang, getLang, textos } from "./idioma";
import { costoDelRetiro, montoEnTexto } from "./stellar/retiro-config";
import { entornoDelBuild } from "./stellar/venta-piloto";

/**
 * El costo de retirar, dicho en pantalla.
 *
 * Retirar dólares digitales desde una cuenta de Google de Tinkazo cuesta un monto fijo por retiro, sea cual sea lo que
 * se retire. Recibir un premio y ingresar dólares digitales son gratis. Los textos que lo dicen (los términos, la
 * página de precios y el plegado de la ventana del saldo) llevan el marcador `{c}` donde va el monto, y este archivo lo
 * pone: el número se escribe en un solo lugar y ningún texto lo repite.
 *
 * El monto sale de la configuración del build (`VITE_RETIRO_COSTO` y `VITE_RETIRO_CUENTA`, `stellar/retiro-config.ts`).
 * Sin costo configurado no se cobra nada y no se dice nada: las páginas traen su bloque dentro de un
 * `<template data-con-retiro>`, que no se ve ni lo lee un buscador mientras nadie lo ponga en la página, y la ventana
 * del saldo queda como estaba. No mira la red: las pantallas que lo dicen solo se ven en la red principal.
 *
 * No importa el diccionario entero (`i18n.ts`): lo usan también las páginas de lectura, que traen solo sus textos.
 */

/** El monto del retiro como se escribe en un idioma: coma decimal en español y punto en inglés, como `0,50` y `0.50`. */
export function montoDelRetiro(idioma: Lang, stroops: bigint): string {
  return montoEnTexto(stroops, idioma);
}

/**
 * El costo de un retiro como se dice en pantalla (`0,50` o `0.50`), o `null` si no se cobra y entonces no se dice nada.
 *
 * Sale de la configuración del build: con el costo sin configurar, o sin la cuenta que lo recibe, devuelve `null` y los
 * lugares que lo dicen quedan como si no existiera. Sin entorno, el de este sitio.
 */
export function costoDelRetiroTexto(idioma: Lang = getLang(), env: Record<string, unknown> = entornoDelBuild()): string | null {
  const stroops = costoDelRetiro(env);
  return stroops === null ? null : montoDelRetiro(idioma, stroops);
}

/** Cambia el marcador `{c}` de un texto por el monto. */
export function conElCostoDelRetiro(texto: string, costo: string): string {
  return texto.split("{c}").join(costo);
}

/**
 * Pone en la página lo que dice el costo del retiro. Cada `<template data-con-retiro>` se cambia por lo que tiene
 * adentro, y en cada texto (`data-i`) de un bloque marcado con `data-retiro` va el del diccionario, en el idioma de la
 * página, con `{c}` cambiado por el monto. Sin costo (`null`) no hace nada: los moldes quedan sin abrir y la página
 * queda como si el costo no existiera.
 *
 * Hay que volver a llamarla después de cada cambio de idioma: `setLang` escribe de nuevo el texto del diccionario, con
 * su marcador.
 */
export function pintarElCostoDelRetiro(raiz: ParentNode, costo: string | null = costoDelRetiroTexto()): void {
  if (costo === null) return;
  for (const molde of raiz.querySelectorAll<HTMLTemplateElement>("template[data-con-retiro]")) {
    molde.replaceWith(molde.content.cloneNode(true));
  }
  const dict = textos(getLang());
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-retiro] [data-i]")) {
    const v = dict[el.dataset.i ?? ""];
    const base = typeof v === "string" ? v : (el.textContent ?? "");
    el.textContent = conElCostoDelRetiro(base, costo);
  }
}
