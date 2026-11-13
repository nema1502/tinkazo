import { TEXTOS_ALTA } from "./alta-textos";
import { TEXTOS_COBRO } from "./alta-textos-con-cobro";
import { TEXTOS_ALTA_PAGO } from "./alta-textos-pago";
import { getLang, onLangChange, textos, type Lang } from "./idioma";
import { type RecargoQr, precios } from "./stellar/alta-api";
import { type Oferta, type ProductoALaVenta, SIN_OFERTA, montoVisible, ofertaDe, recargoQrDe, varsDelProducto } from "./stellar/alta-oferta";
import { configDelPortero } from "./stellar/patrocinio-config";

/**
 * La compra de sorteos oficiales en las páginas públicas (`precios.html` y `terminos.html`). Se baja con `import()`
 * desde `pagina.ts`, solo donde hace falta (`cobro-en-la-pagina.ts`).
 *
 * - Con la compra prendida en el build, cada `<template data-con-cobro>` se cambia por lo que tiene adentro (la lista
 *   de precios, lo que se compra en los términos), pintado en el idioma de la página.
 * - La lista de precios (`data-paquetes`) sale entera de `GET /v1/alta/precios`, leída con lo mismo que usa el panel
 *   de la compra (`precios`, `ofertaDe` y `varsDelProducto`): los mismos productos, los mismos números y la misma forma
 *   de decirlos. El sitio no tiene ningún precio escrito. Lo pausado no se muestra.
 * - Sin respuesta del servidor, o sin nada a la venta, la lista queda vacía y una sola línea lo dice. Nunca un precio
 *   que no vino del servidor.
 * - Con la compra con QR a la vista (`qr`), debajo de la lista una línea dice lo que se suma pagando con QR, la primera
 *   vez y las siguientes, con los dos montos que da el servidor (`recargoQr`). Sin ellos, la línea no está.
 *
 * El portero es el de la red principal aunque la pestaña esté en Prueba: los precios son del modo Oficial.
 */

export type EstadoDeLaLista = "vendiendo" | "nada" | "sin-respuesta";

export interface OpcionesDelCobro {
  /** La compra prendida en el build (`VITE_ALTA_PAGO`, con el acceso). */
  pago: boolean;
  /** La compra con el QR del banco a la vista (`VITE_COMPRA_QR`, por la puerta del piloto). */
  qr?: boolean;
  /** Las pruebas: el `fetch` y la dirección del portero, si no son los del entorno. */
  fetch?: typeof fetch;
  url?: string | null;
}

/** Pinta en el idioma de la página lo que trae un pedazo nuevo, igual que `setLang` con el resto. */
function pintar(raiz: ParentNode): void {
  const dict = textos(getLang());
  raiz.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const v = dict[el.dataset.i ?? ""];
    if (typeof v === "string") el.textContent = v;
  });
  raiz.querySelectorAll<HTMLElement>("[data-i-html]").forEach((el) => {
    const v = dict[el.dataset.iHtml ?? ""];
    if (typeof v === "string") el.innerHTML = v;
  });
}

const poner = (texto: string, vars: Record<string, string>): string => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), texto);

/** Una fila de la lista: para qué es, los sorteos y el precio, y por cuántos días valen. Todo con `textContent`. */
function fila(doc: Document, p: ProductoALaVenta, l: Lang): HTMLLIElement {
  const t = TEXTOS_COBRO[l];
  const li = doc.createElement("li");
  li.className = "nota";
  li.dataset.producto = p.id;
  const nombre = doc.createElement("h3");
  nombre.textContent = p.id === "alta" ? (TEXTOS_ALTA_PAGO[l].pagoTitulo as string) : (TEXTOS_ALTA[l].cupoOfSumar as string);
  const precio = doc.createElement("p");
  const fuerte = doc.createElement("strong");
  fuerte.style.color = "var(--ink)";
  fuerte.textContent = poner(t.prPaqPrecio as string, varsDelProducto(p, l));
  precio.append(fuerte);
  const dias = doc.createElement("p");
  const vale = p.dias === 1 ? (t.prPaqDia1 as string) : poner(t.prPaqDias as string, { dias: String(p.dias) });
  dias.textContent = p.id === "alta" ? `${vale} ${TEXTOS_ALTA[l].altaPrimerPaqueteNota as string}` : vale;
  li.append(nombre, precio, dias);
  return li;
}

/** Un monto del servidor como se dice: 4 dólares, US$0.50, 1 dólar. */
function enDolares(usdc: string, l: Lang): string {
  const monto = montoVisible(usdc, l);
  return monto === "1" ? (TEXTOS_ALTA_PAGO[l].pagoUnDolar as string) : poner(TEXTOS_ALTA_PAGO[l].pagoDolares as string, { usdc: monto });
}

/** La línea de lo que se suma pagando con QR, debajo de la lista: solo vendiendo y con el recargo del servidor. */
function pintarLineaDelQr(lista: HTMLElement, estado: EstadoDeLaLista, recargo: RecargoQr | null, l: Lang): void {
  let linea = lista.parentElement?.querySelector<HTMLElement>("[data-paquetes-qr]") ?? null;
  if (!recargo || estado !== "vendiendo") {
    if (linea) linea.hidden = true;
    return;
  }
  if (!linea) {
    linea = lista.ownerDocument.createElement("p");
    linea.dataset.paquetesQr = "";
    linea.style.cssText = "max-width: 680px; color: var(--ink2); font-size: 16px; margin-top: 12px";
    lista.after(linea);
  }
  linea.textContent = poner(TEXTOS_COBRO[l].prPaqQr as string, { primera: enDolares(recargo.primera, l), siguientes: enDolares(recargo.siguientes, l) });
  linea.hidden = false;
}

/** La lista y su línea, en el idioma de la página. */
function pintarLista(lista: HTMLElement, estado: EstadoDeLaLista, oferta: Oferta, recargo: RecargoQr | null = null): void {
  const doc = lista.ownerDocument;
  const l = getLang();
  let linea = lista.parentElement?.querySelector<HTMLElement>("[data-paquetes-nota]") ?? null;
  if (!linea) {
    linea = doc.createElement("p");
    linea.dataset.paquetesNota = "";
    lista.after(linea);
  }
  const productos = [...(oferta.alta ? [oferta.alta] : []), ...oferta.paquetes];
  lista.replaceChildren(...(estado === "vendiendo" ? productos.map((p) => fila(doc, p, l)) : []));
  lista.hidden = estado !== "vendiendo";
  linea.textContent = estado === "nada" ? (TEXTOS_COBRO[l].prPaqNada as string) : estado === "sin-respuesta" ? (TEXTOS_COBRO[l].prPaqSinRespuesta as string) : "";
  linea.hidden = estado === "vendiendo";
  // Una sola línea a la vista: sin nada que comprar, la de cómo se compra sobra.
  const ayuda = lista.closest("section")?.querySelector<HTMLElement>('[data-i="prPaqAyuda"]');
  if (ayuda) ayuda.hidden = estado !== "vendiendo";
  pintarLineaDelQr(lista, estado, recargo, l);
}

/**
 * Pone lo de la compra en la página y llena la lista de precios. Devuelve cómo quedó la lista, o `null` si la página no
 * tiene lista (los términos). Nunca lanza.
 */
export async function montarCobro(o: OpcionesDelCobro): Promise<EstadoDeLaLista | null> {
  let puso = false;
  if (o.pago) {
    for (const tpl of document.querySelectorAll<HTMLTemplateElement>("template[data-con-cobro]")) {
      const contenido = tpl.content.cloneNode(true) as DocumentFragment;
      pintar(contenido);
      tpl.replaceWith(contenido);
      puso = true;
    }
  }
  // Quien llega desde un enlace a una parte que recién entró (terminos.html#compras) va ahí.
  if (puso && location.hash.length > 1) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();

  const listas = [...document.querySelectorAll<HTMLElement>("[data-paquetes]")];
  if (!listas.length) return null;
  let estado: EstadoDeLaLista = "nada";
  let oferta: Oferta = SIN_OFERTA;
  let recargo: RecargoQr | null = null;
  if (o.pago) {
    const r = await precios({ url: o.url !== undefined ? o.url : configDelPortero({ red: "mainnet" }).url, ...(o.fetch ? { fetch: o.fetch } : {}) }).catch(() => null);
    if (!r?.ok) estado = "sin-respuesta";
    else {
      oferta = ofertaDe(r);
      estado = oferta.alta || oferta.paquetes.length ? "vendiendo" : "nada";
      recargo = recargoQrDe(r, o.qr === true);
    }
  }
  const repintar = (): void => {
    for (const lista of listas) pintarLista(lista, estado, oferta, recargo);
  };
  repintar();
  onLangChange(repintar);
  return estado;
}
