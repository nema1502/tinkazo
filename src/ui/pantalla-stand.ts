import { type Disposicion, type EstadoEnPantalla, type FilaDePantalla, deLaPagina, disposicion, filasDePantalla, regresiva } from "../equipos/pantalla-stand";
import type { Evidencias } from "../equipos/estado";
import type { Equipo, ModoEquipos } from "../equipos/modelo";

/**
 * La pantalla del stand, para el proyector (Space Apps, 14 de noviembre de 2026): el QR para anotar al equipo en
 * grande, los equipos con el punto en que está cada uno, cuántos tienen cupón y, si quien organiza fijó la hora del
 * sorteo, cuánto falta. Se abre desde el panel de equipos de quien organiza (`equipos-sala.ts`) y ocupa la pantalla
 * entera, sin scroll: los equipos que no entran pasan en páginas cada pocos segundos.
 *
 * Una sola cosa para tocar: «Volver al panel» (o Escape, o salir de la pantalla completa). Lo demás es para mirar de
 * lejos. Todo entra por `DepsDePantalla`, para probarla con un DOM de mentira.
 */

export interface DatosDePantalla {
  /** El enlace del QR: el registro de equipos. */
  enlace: string;
  modo: ModoEquipos;
  equipos: readonly Equipo[];
  evidencias: Evidencias;
  /**
   * El instante del sorteo en milisegundos, calculado una sola vez cuando quien organiza fijó la hora (así no salta al
   * pasar la medianoche), o `null` si no la fijó.
   */
  instante: number | null;
}

export interface DepsDePantalla {
  tx: (clave: string) => string;
  /** El idioma de ahora, para escribir la hora como se lee en cada uno. */
  idioma: () => "es" | "en";
  datos: () => DatosDePantalla | null;
  qr: (img: HTMLImageElement, enlace: string, lado: number) => Promise<void>;
  ahora: () => number;
  cada: (f: () => void, ms: number) => () => void;
  /** El tamaño de la ventana, para la letra que se lee desde el fondo. */
  ventana: () => { ancho: number; alto: number };
}

export interface PantallaDelStand {
  raiz: HTMLElement;
  abierta: () => boolean;
  /** `desde`: el botón que la abrió, que recibe el foco al cerrar. */
  abrir: (desde?: HTMLElement | null) => void;
  cerrar: () => void;
  /** Vuelve a pintar con lo último (un equipo nuevo, un cupón, otro idioma). */
  pintar: () => void;
}

/** Cada cuánto pasa de página cuando los equipos no entran en una. */
export const PAGINA_CADA_MS = 8_000;

const ESTADO_CLAVE: Record<EstadoEnPantalla, string> = {
  anotado: "eqStAnotado",
  aceptado: "eqStAceptado",
  sorteo: "eqStSorteo",
  cupon: "eqStCupon",
};

const LLAMA =
  '<svg viewBox="-1 -3 24 28" aria-hidden="true"><rect x="2" y="11" width="16" height="7"/><rect x="15" y="3" width="4" height="10"/><rect x="14" y="0" width="8" height="4"/><rect x="20" y="-2" width="2" height="3"/><rect x="3" y="18" width="2.5" height="6"/><rect x="8" y="18" width="2.5" height="6"/><rect x="12.5" y="18" width="2.5" height="6"/><rect x="16" y="18" width="2.5" height="6"/><rect x="0" y="9" width="3" height="4"/></svg>';

export function crearPantallaDelStand(deps: DepsDePantalla): PantallaDelStand {
  const tx = deps.tx;
  const raiz = document.createElement("div");
  raiz.className = "stp";
  raiz.id = "pantalla-stand";
  raiz.hidden = true;
  raiz.setAttribute("role", "dialog");
  raiz.setAttribute("aria-modal", "true");
  raiz.setAttribute("aria-labelledby", "stp-t");
  raiz.innerHTML =
    `<div class="stripe stp-franja" aria-hidden="true"></div>` +
    `<div class="stp-qr">` +
    `<h2 class="stp-t" id="stp-t" data-st="eqTitQr"></h2>` +
    `<img class="stp-img" alt="" />` +
    `<p class="stp-ayuda" data-st="eqStAyuda"></p>` +
    `</div>` +
    `<div class="stp-lado">` +
    `<div class="stp-arriba"><span class="stp-marca">${LLAMA}<span>Tinka<b>zo</b></span></span>` +
    `<button class="ghost stp-cerrar" type="button" data-st="eqStCerrar"></button></div>` +
    `<div class="stp-datos">` +
    `<p class="stp-dato stp-cupones" aria-live="polite"><b class="stp-num" id="stp-cupones-n"></b><span id="stp-cupones-t"></span></p>` +
    `<p class="stp-dato stp-reloj" id="stp-reloj" hidden><span class="stp-reloj-t" id="stp-reloj-t"></span><b class="stp-num" id="stp-reloj-n"></b></p>` +
    `</div>` +
    `<ol class="stp-equipos" id="stp-equipos"></ol>` +
    `<p class="stp-vacia" id="stp-vacia" data-st="eqStVacia" hidden></p>` +
    `<p class="stp-pagina" id="stp-pagina" hidden></p>` +
    `</div>`;

  const q = <T extends HTMLElement>(sel: string): T => raiz.querySelector<T>(sel) as T;
  const cerrarBtn = q<HTMLButtonElement>(".stp-cerrar");
  const img = q<HTMLImageElement>(".stp-img");

  let abierta = false;
  let volverA: HTMLElement | null = null;
  let pagina = 0;
  let qrDe = "";
  let pararReloj: (() => void) | null = null;
  let pararPaginas: (() => void) | null = null;
  let estuvoEnPantalla = false;
  let disp: Disposicion | null = null;

  const fmt = (clave: string, vars: Record<string, string | number>): string =>
    Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), tx(clave));

  /** La letra de los nombres: la de la sala (3,4 % del alto) como mínimo, y hasta el 5 %. En un celular, la de siempre. */
  function letras(): { min: number; max: number } {
    const { ancho, alto } = deps.ventana();
    if (ancho < 700) return { min: 16, max: 26 };
    return { min: Math.max(16, alto * 0.034), max: Math.max(22, alto * 0.05) };
  }

  /** Lo que mide el lugar de los equipos. En un DOM de mentira no mide nada: se usa la ventana. */
  function lugar(): { ancho: number; alto: number } {
    const ol = q<HTMLOListElement>("#stp-equipos");
    const v = deps.ventana();
    const ancho = ol.clientWidth || v.ancho * 0.5;
    const alto = ol.clientHeight || v.alto * 0.5;
    return { ancho, alto };
  }

  function relojTexto(d: DatosDePantalla): void {
    const caja = q("#stp-reloj");
    const objetivo = d.instante;
    caja.hidden = objetivo === null;
    if (objetivo === null) return;
    // En castellano, como se dice en un evento de acá: «18:30». En inglés, «6:30 PM».
    const en = deps.idioma() === "en";
    const hora = new Date(objetivo).toLocaleTimeString(en ? "en-US" : "es-BO", en ? { hour: "numeric", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    q("#stp-reloj-t").textContent = fmt("eqStRelojT", { h: hora });
    const r = regresiva(objetivo, deps.ahora());
    q("#stp-reloj-n").textContent = r.llego ? tx("eqStLlego") : fmt("eqStFaltan", { t: r.texto });
    caja.dataset.llego = r.llego ? "1" : "";
  }

  function tarjeta(f: FilaDePantalla): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "stp-equipo";
    li.dataset.estado = f.estado;
    const nombre = document.createElement("span");
    nombre.className = "stp-nombre";
    nombre.textContent = f.nombre;
    const chip = document.createElement("span");
    chip.className = "stp-chip";
    chip.textContent = tx(ESTADO_CLAVE[f.estado]);
    li.append(nombre, chip);
    return li;
  }

  function pintar(): void {
    for (const el of raiz.querySelectorAll<HTMLElement>("[data-st]")) el.textContent = tx(el.dataset.st ?? "");
    q<HTMLImageElement>(".stp-img").setAttribute("aria-label", tx("eqQrAlt"));
    if (!abierta) return;
    const d = deps.datos();
    if (!d) return cerrar();
    if (qrDe !== d.enlace) {
      qrDe = d.enlace;
      // Se dibuja grande y la hoja de estilos lo acomoda: así se ve nítido en el proyector.
      void deps.qr(img, d.enlace, 720);
    }
    const { filas, conCupon, total } = filasDePantalla(d.modo, d.equipos, d.evidencias);
    q("#stp-cupones-n").textContent = fmt("eqStCuponesN", { c: conCupon, n: total });
    q("#stp-cupones-t").textContent = tx(total === 1 ? "eqStCuponesT1" : "eqStCuponesT");
    relojTexto(d);

    const ol = q<HTMLOListElement>("#stp-equipos");
    q("#stp-vacia").hidden = filas.length > 0;
    ol.hidden = filas.length === 0;
    const { min, max } = letras();
    acomodar(filas, min, max, lugar());
  }

  /**
   * Pone la página de ahora con la letra más grande que deja `disposicion` y, si igual no entra (un nombre largo ocupa
   * dos renglones), prueba con una letra más chica y, ya en la mínima, con una fila menos por página. Se mide con las
   * tarjetas de todos los equipos, no con las de esta página ni con los nombres de más caracteres (un nombre con
   * muchas palabras cortas ocupa más renglones que uno largo de una sola palabra): así todas las páginas tienen los
   * mismos lugares, ninguna se pasa y al dar la vuelta no se saltea a nadie.
   */
  function acomodar(filas: FilaDePantalla[], min: number, max: number, sitio: { ancho: number; alto: number }): void {
    const ol = q<HTMLOListElement>("#stp-equipos");
    let tope = max;
    let menos = 0;
    ol.style.gridAutoRows = "";
    for (let intento = 0; intento < 16; intento++) {
      const base = disposicion(filas.length, sitio.ancho, sitio.alto, min, tope);
      const filasPorPagina = Math.max(1, Math.floor(base.porPagina / base.columnas) - menos);
      const porPagina = filasPorPagina * base.columnas;
      disp = { ...base, porPagina, filas: Math.min(filasPorPagina, base.filas), paginas: Math.max(1, Math.ceil(filas.length / porPagina)) };
      ol.style.setProperty("--stp-letra", `${disp.letra}px`);
      ol.style.setProperty("--stp-chip", `${Math.max(Math.round(min), Math.round(disp.letra * 0.62))}px`);
      ol.style.gridTemplateColumns = `repeat(${disp.columnas}, minmax(0, 1fr))`;
      ol.replaceChildren(...filas.map(tarjeta));
      // Entra si las filas, todas del alto de la tarjeta más alta de todas, caben en el lugar.
      const alto = Math.max(0, ...[...ol.children].map((li) => li.getBoundingClientRect().height));
      const hueco = parseFloat(getComputedStyle(ol).rowGap) || 0;
      const filasDeVerdad = Math.min(filasPorPagina, Math.ceil(filas.length / disp.columnas));
      const entra = alto === 0 || filasDeVerdad * alto + (filasDeVerdad - 1) * hueco <= ol.clientHeight + 1;
      if (entra || filasPorPagina === 1) break;
      if (disp.letra > min + 1) tope = disp.letra - 2;
      else menos++;
    }
    // Todas las tarjetas del alto de la más alta (la que ocupa más renglones): parejas en todas las páginas, sin estirarse.
    const alto = Math.max(0, ...[...ol.children].map((li) => li.getBoundingClientRect().height));
    ol.style.gridAutoRows = alto > 0 ? `${Math.ceil(alto)}px` : "";
    ol.replaceChildren(...deLaPagina(filas, disp?.porPagina ?? Math.max(1, filas.length), pagina).map(tarjeta));
    const p = q("#stp-pagina");
    const paginas = disp?.paginas ?? 1;
    p.hidden = paginas <= 1;
    p.textContent = paginas > 1 ? fmt("eqStPagina", { p: (pagina % paginas) + 1, t: paginas }) : "";
  }

  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && abierta) cerrar();
  };
  const alCambiarPantalla = (): void => {
    if (document.fullscreenElement) estuvoEnPantalla = true;
    else if (estuvoEnPantalla && abierta) cerrar();
  };
  const alCambiarTamano = (): void => {
    if (abierta) pintar();
  };

  function abrir(desde: HTMLElement | null = null): void {
    if (abierta) return;
    if (!raiz.isConnected) document.body.append(raiz);
    abierta = true;
    volverA = desde;
    pagina = 0;
    raiz.hidden = false;
    document.documentElement.classList.add("con-pantalla-stand");
    addEventListener("keydown", tecla);
    addEventListener("resize", alCambiarTamano);
    document.addEventListener("fullscreenchange", alCambiarPantalla);
    estuvoEnPantalla = !!document.fullscreenElement;
    // Se pide con el clic todavía fresco: después el navegador la niega. Si no la da, la capa ocupa la ventana igual.
    if (!document.fullscreenElement) {
      try {
        void Promise.resolve(document.documentElement.requestFullscreen?.({ navigationUI: "hide" })).catch(() => undefined);
      } catch {
        /* sin pantalla completa: la capa alcanza */
      }
    }
    pararReloj = deps.cada(() => {
      const d = deps.datos();
      if (d && abierta) relojTexto(d);
    }, 1000);
    pararPaginas = deps.cada(() => {
      if (!abierta || (disp?.paginas ?? 1) <= 1) return;
      pagina++;
      pintar();
    }, PAGINA_CADA_MS);
    pintar();
    cerrarBtn.focus();
  }

  function cerrar(): void {
    if (!abierta) return;
    abierta = false;
    raiz.hidden = true;
    document.documentElement.classList.remove("con-pantalla-stand");
    removeEventListener("keydown", tecla);
    removeEventListener("resize", alCambiarTamano);
    document.removeEventListener("fullscreenchange", alCambiarPantalla);
    pararReloj?.();
    pararPaginas?.();
    pararReloj = pararPaginas = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    volverA?.focus({ preventScroll: true });
  }

  cerrarBtn.addEventListener("click", cerrar);
  // Con el foco adentro: Tab no se va a la página de atrás, que está tapada (hay un solo botón).
  raiz.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      cerrarBtn.focus();
    }
  });
  pintar();

  return { raiz, abierta: () => abierta, abrir, cerrar, pintar };
}
