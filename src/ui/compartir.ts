import { esc } from "../dom";
import { getLang, textos, type Lang } from "../idioma";
import { decodeProof } from "../protocol/proof";
import { eventoUrl, partirEvento, type SorteoDelEvento } from "../protocol/evento";
import { tarjetaQr, type TarjetaQr } from "./tarjeta-qr";

/**
 * Compartir un sorteo ya hecho, otra vez, y un evento: el mismo contenido que la
 * pantalla del sorteo, con el QR como imagen y el mensaje listo para pegar o
 * mandar por WhatsApp.
 *
 * Lo usan Mis sorteos (con la lista del historial) y la página de verificación
 * (con lo que ella misma rehizo). Por eso no importa `i18n.ts`: los textos salen
 * de `textos(lang)`, el diccionario de la página, y las claves que se usan acá
 * aparecen entre comillas en este archivo, para que `vite.config.ts` las incluya
 * en las páginas de lectura.
 *
 * El mensaje repite la forma de `T.es.summary` y `summaryEvento` (los del
 * resultado y los de evento), y una prueba compara las dos cosas.
 */

/** El texto de una clave en el idioma pedido. Si falta, la clave misma. */
function cad(lang: Lang, clave: string): string {
  const v = textos(lang)[clave];
  return typeof v === "string" ? v : clave;
}

/** Reemplaza las marcas {así} en una sola pasada: lo que se pone no se vuelve a mirar. */
function rellenar(plantilla: string, datos: Record<string, string | number>): string {
  return plantilla.replace(/\{(\w+)\}/g, (marca, clave: string) => (clave in datos ? String(datos[clave]) : marca));
}

/** "Ana, Beto y Carla" / "Ana, Beto and Carla". */
function lista(lang: Lang, nombres: string[]): string {
  return new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);
}

/* ------------------------------------------------------------------ mensajes */

export interface DatosSorteo {
  /** El enlace de verificación del sorteo: el comprobante, tal como quedó. */
  enlace: string;
  ganadores: string[];
  /** Cuántas personas había en la lista. */
  total: number;
  /** El premio, o "" si no hubo. */
  premio: string;
}

/** El mensaje de un sorteo: quién ganó, entre cuántos, el enlace y el pie. */
export function mensajeDeSorteo(lang: Lang, d: DatosSorteo): string {
  const varios = d.ganadores.length > 1;
  const w = lista(lang, d.ganadores);
  const cabeza = d.premio
    ? rellenar(cad(lang, varios ? "cmpCabPremioVarios" : "cmpCabPremioUno"), { premio: d.premio, w, n: d.total })
    : rellenar(cad(lang, varios ? "cmpCabVarios" : "cmpCabUno"), { w, n: d.total });
  return [
    cabeza,
    cad(lang, varios ? "cmpNadieVarios" : "cmpNadieUno"),
    rellenar(cad(lang, "cmpVerificarUno"), { enlace: d.enlace }),
    "",
    cad(lang, "cmpPie"),
  ].join("\n");
}

/** El mensaje de un evento: cuántos sorteos hay, el o los enlaces y el pie. `titulo` es el nombre, o la fecha por defecto. */
export function mensajeDeEvento(lang: Lang, d: { titulo: string; sorteos: number; enlaces: string }): string {
  return [
    rellenar(cad(lang, d.sorteos === 1 ? "cmpEvUno" : "cmpEvVarios"), { t: d.titulo, n: d.sorteos }),
    rellenar(cad(lang, "cmpVerificarEv"), { enlace: d.enlaces }),
    "",
    cad(lang, "cmpPie"),
  ].join("\n");
}

/* -------------------------------------------------------------------- diálogo */

export interface Paquete {
  titulo: string;
  mensaje: string;
  /** Una tarjeta por enlace: una sola, o una por parte del evento. */
  tarjetas: TarjetaQr[];
  /** Una nota arriba de las imágenes, por ejemplo que el evento va en varios enlaces. */
  nota?: string;
}

let abierto: HTMLDialogElement | null = null;

/** Baja un archivo, como enlace temporal. */
function descargar(f: File): void {
  const enlace = document.createElement("a");
  enlace.href = URL.createObjectURL(f);
  enlace.download = f.name;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 30_000);
}

/**
 * En el celular, el menú de compartir del sistema con las imágenes y el mensaje
 * (WhatsApp recibe las dos cosas); en la computadora, cada imagen se baja.
 */
async function compartirImagenes(archivos: File[], mensaje: string): Promise<void> {
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: archivos })) {
    try {
      await navigator.share({ files: archivos, text: mensaje });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Si el navegador no deja compartir, se baja como en la computadora.
    }
  }
  for (const f of archivos) descargar(f);
}

/** Abre el diálogo de compartir: las imágenes con el QR, el mensaje, copiar y WhatsApp. Reemplaza al que estuviera abierto. */
export function abrirCompartir(p: Paquete, lang: Lang = getLang()): void {
  abierto?.close();
  const dlg = document.createElement("dialog");
  dlg.className = "cmp-dlg";
  dlg.setAttribute("aria-labelledby", "cmp-t");
  dlg.innerHTML =
    `<div class="cmp-cuerpo">` +
    `<div class="cmp-top"><h2 id="cmp-t">${esc(p.titulo)}</h2>` +
    `<button class="ghost" type="button" data-cerrar>${esc(cad(lang, "salaCerrar"))}</button></div>` +
    (p.nota ? `<p class="note cmp-nota">${esc(p.nota)}</p>` : "") +
    `<div class="cmp-imgs"></div>` +
    `<label class="kicker" for="cmp-txt">${esc(cad(lang, "cmpMensaje"))}</label>` +
    `<textarea id="cmp-txt" class="cmp-txt" readonly>${esc(p.mensaje)}</textarea>` +
    `<div class="cmp-acc">` +
    `<button class="primary" type="button" data-copiar>${esc(cad(lang, "copySummary"))}</button>` +
    `<a class="ghost" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(p.mensaje)}">${esc(cad(lang, "cmpWhatsapp"))}</a>` +
    `<button class="ghost" type="button" data-imagen></button>` +
    `</div></div>`;

  const imgs = dlg.querySelector<HTMLElement>(".cmp-imgs");
  const boton = dlg.querySelector<HTMLButtonElement>("[data-imagen]");
  const urls: string[] = [];

  void Promise.all(p.tarjetas.map((tj) => tarjetaQr(tj).catch(() => null))).then((pngs) => {
    // Si se cerró antes de que el QR estuviera listo, no hay nada que pintar.
    if (!dlg.isConnected || !imgs) return;
    const validos: File[] = [];
    for (const png of pngs) {
      if (!png) continue;
      const url = URL.createObjectURL(png);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.className = "cmp-png";
      imgs.appendChild(img);
      validos.push(new File([png], `tinkazo-qr-${validos.length + 1}.png`, { type: "image/png" }));
    }
    if (!validos.length) {
      imgs.innerHTML = `<p class="note">${esc(cad(lang, "cmpSinQr"))}</p>`;
      return;
    }
    // Con alguna parte sin QR, se dice: el mensaje trae todos los enlaces igual.
    if (validos.length < p.tarjetas.length) imgs.insertAdjacentHTML("beforeend", `<p class="note">${esc(cad(lang, "cmpSinQr"))}</p>`);
    if (boton) {
      const puede = matchMedia("(pointer: coarse)").matches && typeof navigator.canShare === "function";
      boton.textContent = cad(lang, puede ? "cmpImagenCompartir" : "cmpImagenBajar");
      boton.style.display = "";
      boton.addEventListener("click", () => void compartirImagenes(validos, p.mensaje));
    }
  });
  if (boton) boton.style.display = "none";

  dlg.querySelector<HTMLButtonElement>("[data-copiar]")?.addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const orig = b.textContent;
    try {
      await navigator.clipboard.writeText(p.mensaje);
      b.textContent = cad(lang, "copied");
    } catch {
      // Sin portapapeles: el mensaje queda seleccionado para copiarlo a mano.
      (dlg.querySelector("#cmp-txt") as HTMLTextAreaElement | null)?.select();
    }
    setTimeout(() => (b.textContent = orig), 1600);
  });
  dlg.querySelector<HTMLButtonElement>("[data-cerrar]")?.addEventListener("click", () => dlg.close());
  // Un clic en el fondo, fuera del cuerpo, cierra.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    dlg.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
    if (abierto === dlg) abierto = null;
  });
  document.body.appendChild(dlg);
  abierto = dlg;
  dlg.showModal();
}

/* --------------------------------------------------------------------- sorteo */

/** Compartir un sorteo con lo que ya se sabe de él (la página de verificación lo tiene). */
export function abrirSorteo(d: DatosSorteo, lang: Lang = getLang()): void {
  const varios = d.ganadores.length > 1;
  abrirCompartir(
    {
      titulo: cad(lang, "cmpSorteo"),
      mensaje: mensajeDeSorteo(lang, d),
      tarjetas: [
        {
          titulo: d.premio || cad(lang, "histDraw"),
          linea: rellenar(cad(lang, varios ? "cmpCardVarios" : "cmpCardUno"), { w: lista(lang, d.ganadores) }),
          enlace: d.enlace,
          pie: cad(lang, "pantallaQr"),
        },
      ],
    },
    lang,
  );
}

/** Desde Mis sorteos: el comprobante trae el número de personas y el premio. */
export async function compartirSorteo(enlace: string, ganadores: string[], lang: Lang = getLang()): Promise<void> {
  const comprobante = await decodeProof(enlace.slice(enlace.indexOf("#")));
  abrirSorteo({ enlace, ganadores, total: comprobante.names.length, premio: comprobante.prize ?? "" }, lang);
}

/* -------------------------------------------------------------------- evento */

/**
 * El evento como paquete: sus enlaces, uno por parte, y el mensaje que los trae.
 * Con más de una parte, cada enlace dice cuál es. Null si no hay sorteos.
 * `base` se pasa en las pruebas; en la página es el origen.
 */
export async function paqueteDeEvento(
  titulo: string,
  sorteos: SorteoDelEvento[],
  lang: Lang = getLang(),
  base?: string,
): Promise<{ partes: Array<{ titulo: string; enlace: string }>; mensaje: string } | null> {
  if (!sorteos.length) return null;
  const grupos = await partirEvento(titulo, sorteos);
  const n = grupos.length;
  const parte = (i: number): string => rellenar(cad(lang, "evParte"), { i, n });
  const partes = await Promise.all(
    grupos.map(async (g, i) => {
      const tt = n > 1 ? `${titulo} · ${parte(i + 1)}` : titulo;
      return { titulo: tt, enlace: await eventoUrl(tt, g, base) };
    }),
  );
  const enlaces = n > 1 ? partes.map((p, i) => `${parte(i + 1)}: ${p.enlace}`).join("\n") : (partes[0]?.enlace ?? "");
  return { partes, mensaje: mensajeDeEvento(lang, { titulo, sorteos: sorteos.length, enlaces }) };
}

/** Cuántos enlaces va a tener el evento: para el rótulo del botón. */
export async function partesDelEvento(titulo: string, sorteos: SorteoDelEvento[]): Promise<number> {
  return sorteos.length ? (await partirEvento(titulo, sorteos)).length : 0;
}

/** Compartir un evento: el mensaje, y un QR por cada enlace. */
export async function compartirEvento(titulo: string, sorteos: SorteoDelEvento[], lang: Lang = getLang()): Promise<void> {
  const r = await paqueteDeEvento(titulo, sorteos, lang);
  if (!r) return;
  const n = r.partes.length;
  const linea = rellenar(cad(lang, sorteos.length === 1 ? "evUnSorteo" : "evNSorteos"), { n: sorteos.length });
  abrirCompartir(
    {
      titulo: cad(lang, "histGrupoCompartir"),
      mensaje: r.mensaje,
      nota: n > 1 ? rellenar(cad(lang, "evAvisoPartes"), { n }) : undefined,
      tarjetas: r.partes.map((p) => ({ titulo: p.titulo, linea, enlace: p.enlace, pie: cad(lang, "pantallaQr") })),
    },
    lang,
  );
}
