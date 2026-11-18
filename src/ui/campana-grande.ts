import type { Lang } from "../idioma";
import { type Campana } from "../campana/modelo";
import { horaTexto, premiosTexto } from "../campana/formato";
import { regresiva } from "../equipos/pantalla-stand";

/**
 * La pantalla grande de la campaña, para el proyector. Es una capa del mismo panel y no otra pestaña: dos pantallas con
 * el mismo token se desplazan una a la otra y una de las dos se queda congelada.
 *
 * Sin nombres: mostrarlos en orden de llegada deja unir un nombre con su cuenta. Solo hay un cartel, el QR tan grande
 * como entre, cuántas personas se anotaron y cuánto falta para que cierre. Su estilo vive en `campana-sala.css`.
 */

/** Lo que la capa necesita saber en cada repintado: lo pide al panel, que es el dueño de los datos. */
export interface DatosDeLaGrande {
  campana: Campana;
  /** El enlace del QR con el pase de ahora, o `null` si todavía no hay pase. */
  enlace: string | null;
  /** `false` cuando el pase dejó de renovarse hace tanto que el QR ya no sirve: se saca y se avisa. */
  qrVigente: boolean;
  /** La sala no acepta este panel: sin QR nuevo no es un corte de conexión y reconectar no lo arregla. */
  rechazado?: boolean;
  total: number;
  cierraMs: number;
  cerrada: boolean;
}

export interface DepsDeLaGrande {
  tx: (clave: string) => string;
  idioma: () => Lang;
  datos: () => DatosDeLaGrande | null;
  qr: (img: HTMLImageElement, texto: string, ancho: number) => Promise<boolean>;
  ahora: () => number;
  /** Corre `f` dentro de `ms` y devuelve cómo cancelarlo. En las pruebas, un reloj de mentira. */
  esperar: (f: () => void, ms: number) => () => void;
  pantallaCompleta: (el: HTMLElement) => Promise<void>;
  /** El tamaño de la ventana, para dibujar el QR del tamaño en que se ve. */
  ventana: () => { ancho: number; alto: number };
}

export interface PantallaGrande {
  abierta: () => boolean;
  abrir: (desde: HTMLElement | null) => void;
  cerrar: () => void;
  pintar: () => void;
}

/** Llena los huecos `{nombre}` de un texto. */
export function rellenar(texto: string, valores: Record<string, string | number>): string {
  return texto.replace(/\{([a-z]+)\}/gu, (hueco, clave: string) => String(valores[clave] ?? hueco));
}

/** Lo que se le quita al alto de la ventana: el margen de arriba y abajo, el hueco y el renglón de debajo del QR. */
const RESTA_DE_ALTO = 110;
/** Desde este ancho (o apaisado y de 640 en adelante) la capa tiene dos columnas. Igual que la hoja de estilos. */
const ANCHO_DE_DOS_COLUMNAS = 900;
const ANCHO_APAISADO = 640;

/** Si la ventana tiene dos columnas: lo mismo que dice el `@media` de la hoja de estilos. */
export const conDosColumnas = (ancho: number, alto: number): boolean =>
  ancho >= ANCHO_DE_DOS_COLUMNAS || (ancho >= ANCHO_APAISADO && ancho >= alto);

/**
 * El lado del QR, el mismo que pide la hoja de estilos: con dos columnas, el menor entre el alto libre y el ancho de su
 * columna. Con una, el menor entre el ancho y el alto de la ventana menos el margen: apaisado no cabe si solo se mide el ancho.
 */
export function ladoDelQr(ancho: number, alto: number): number {
  if (conDosColumnas(ancho, alto)) return Math.max(160, Math.floor(Math.min(alto - RESTA_DE_ALTO, ancho / 2 - 40)));
  return Math.max(160, Math.min(ancho - 32, alto - 32));
}

/** A partir de acá la cuenta regresiva no se muestra: una hora o más de espera se lee mejor como la hora de cierre. */
const UNA_HORA_S = 3600;

export function crearPantallaGrande(deps: DepsDeLaGrande): PantallaGrande {
  const capa = document.createElement("div");
  capa.className = "campana-grande sala";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-labelledby", "cg-t");
  capa.innerHTML =
    '<div class="cg-qr">' +
    '<img class="cg-img" alt="">' +
    '<p class="cg-sinqr" hidden></p>' +
    '<p class="cg-cerro" hidden></p>' +
    '<p class="cg-apps"></p>' +
    "</div>" +
    '<div class="cg-lado">' +
    '<div class="cg-arriba"><img class="cg-logo" alt="" hidden><h2 id="cg-t"></h2></div>' +
    '<p class="cg-premio"></p>' +
    '<p class="cg-cartel"></p>' +
    '<p class="cg-cuenta"><span class="cg-numero"></span> <span class="cg-etiqueta"></span></p>' +
    '<p class="cg-cierre"></p>' +
    '<button type="button" class="primary cg-volver"></button>' +
    "</div>";
  const $ = <T extends HTMLElement>(clase: string): T => capa.querySelector<T>(`.${clase}`) as T;
  const img = $<HTMLImageElement>("cg-img");
  const sinQr = $("cg-sinqr");
  const cerro = $("cg-cerro");
  const apps = $("cg-apps");
  const logo = $<HTMLImageElement>("cg-logo");
  const titulo = $("cg-arriba").querySelector("h2") as HTMLElement;
  const premio = $("cg-premio");
  const cartel = $("cg-cartel");
  const numero = $("cg-numero");
  const etiqueta = $("cg-etiqueta");
  const cierre = $("cg-cierre");
  const volver = $<HTMLButtonElement>("cg-volver");

  let abierto = false;
  let volverA: HTMLElement | null = null;
  let pararTic: (() => void) | null = null;
  let ultimoTotal = -1;
  let ultimoQr = "";
  let estuvoEnPantalla = false;

  function pintar(): void {
    const d = deps.datos();
    if (!abierto || !d) return;
    const idioma = deps.idioma();
    const { tx } = deps;
    titulo.textContent = rellenar(tx("cpTitulo"), { empresa: d.campana.empresa.nombre });
    premio.textContent = premiosTexto(d.campana.premios, idioma);
    cartel.textContent = tx("cpoCartel");
    apps.textContent = tx("cpoNoDesdeApps");
    img.alt = tx("cpoQrAlt");
    volver.textContent = tx("cpoVolver");
    const emblema = d.campana.empresa.logo;
    logo.hidden = emblema === null;
    if (emblema) logo.src = `data:${emblema.tipo};base64,${emblema.datos}`;
    // La cuenta la dice una sola vez, con el número enorme. Al cerrar, el cartel pasa a decir que la lista cerró.
    numero.textContent = String(d.total);
    etiqueta.textContent = tx(d.total === 1 ? "cpoEnLaLista1" : "cpoEnLaListaN");
    if (d.total > ultimoTotal && ultimoTotal >= 0) saltar();
    ultimoTotal = d.total;
    cerro.hidden = !d.cerrada;
    cerro.textContent = tx("cpoCerradaT");
    cartel.hidden = d.cerrada;
    apps.hidden = d.cerrada;
    img.hidden = d.cerrada || d.enlace === null || !d.qrVigente;
    sinQr.hidden = d.cerrada || d.qrVigente;
    sinQr.textContent = tx(d.rechazado ? "cpoPaseRechazado" : "cpoSinConexionQr");
    cierre.hidden = d.cerrada;
    pintarReloj(d);
    pintarQr(d);
  }

  /** El número salta un poco al subir. Sacar y volver a poner la clase, con una lectura en el medio, reinicia la animación. */
  function saltar(): void {
    numero.classList.remove("sube");
    void numero.offsetWidth;
    numero.classList.add("sube");
  }

  /** El QR se dibuja solo si cambió el enlace o el lado: dibujarlo cada segundo gasta de más. */
  function pintarQr(d: DatosDeLaGrande): void {
    if (d.cerrada || !d.enlace || !d.qrVigente) return;
    const { ancho, alto } = deps.ventana();
    const lado = ladoDelQr(ancho, alto);
    const clave = `${lado}|${d.enlace}`;
    if (clave === ultimoQr) return;
    ultimoQr = clave;
    void deps.qr(img, d.enlace, lado);
  }

  /**
   * La hora de cierre o cuánto falta, nunca las dos juntas: dos números con forma de reloj uno al lado del otro se leen
   * desde el fondo como una sola hora. Con una hora o más, la hora. Con menos, la cuenta. Pasada la hora, solo la hora.
   */
  function pintarReloj(d: DatosDeLaGrande): void {
    const r = regresiva(d.cierraMs, deps.ahora());
    const hora = horaTexto(d.cierraMs, d.campana.zona, deps.idioma());
    cierre.textContent = !r.llego && r.segundos < UNA_HORA_S
      ? rellenar(deps.tx("cpoCierraEn"), { falta: r.texto })
      : rellenar(deps.tx("cpoCierraA"), { hora });
  }

  function tic(): void {
    pararTic = null;
    const d = deps.datos();
    if (!abierto || !d) return;
    pintarReloj(d);
    // Al segundo justo siguiente, así la cuenta no salta de a dos.
    pararTic = deps.esperar(tic, 1000 - (deps.ahora() % 1000));
  }

  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
    // Hay un solo botón: el foco no sale de la capa.
    else if (e.key === "Tab") {
      e.preventDefault();
      volver.focus({ preventScroll: true });
    }
  };
  const alCambiarTamano = (): void => {
    ultimoQr = "";
    pintar();
  };
  // En pantalla completa el navegador se queda con Escape para salir de ella: al salir, se cierra la capa.
  const alCambiarPantalla = (): void => {
    if (document.fullscreenElement) estuvoEnPantalla = true;
    else if (estuvoEnPantalla) cerrar();
  };

  function abrir(desde: HTMLElement | null): void {
    if (abierto) return;
    abierto = true;
    volverA = desde;
    ultimoTotal = -1;
    ultimoQr = "";
    document.body.append(capa);
    // Se pide con el toque todavía fresco: después el navegador la niega. Sin ella, la capa ocupa la ventana igual.
    void deps.pantallaCompleta(capa);
    estuvoEnPantalla = !!document.fullscreenElement;
    addEventListener("keydown", tecla);
    addEventListener("resize", alCambiarTamano);
    document.addEventListener("fullscreenchange", alCambiarPantalla);
    pintar();
    tic();
    // Sin preventScroll el foco desplaza la capa hasta el botón y el QR queda fuera de la vista.
    volver.focus({ preventScroll: true });
    capa.scrollTop = 0;
  }

  function cerrar(): void {
    if (!abierto) return;
    abierto = false;
    // Fuera del DOM y no escondida: `.sala` en la página frena el paso de la cuenta y el scroll.
    capa.remove();
    removeEventListener("keydown", tecla);
    removeEventListener("resize", alCambiarTamano);
    document.removeEventListener("fullscreenchange", alCambiarPantalla);
    pararTic?.();
    pararTic = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    destinoDelFoco()?.focus({ preventScroll: true });
  }

  /**
   * Adónde vuelve el foco al cerrar. El panel rehace sus botones cuando cambia lo que se puede hacer (por ejemplo, al pasar
   * la hora de cierre): el que abrió la capa puede haber salido del DOM y su `focus()` no haría nada. Entonces va al botón
   * del mismo rótulo, o a la acción principal, o al primero.
   */
  function destinoDelFoco(): HTMLElement | null {
    if (volverA?.isConnected) return volverA;
    const botones = [...document.querySelectorAll<HTMLElement>("#cpo-acciones button")];
    const rotulo = volverA?.textContent ?? "";
    return botones.find((b) => b.textContent === rotulo) ?? botones.find((b) => b.classList.contains("primary")) ?? botones[0] ?? null;
  }

  volver.addEventListener("click", cerrar);
  return { abierta: () => abierto, abrir, cerrar, pintar };
}
