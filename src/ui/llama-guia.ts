import "./llama-guia.css";
import { T, getLang, t } from "../i18n";
import {
  lugarEnRecorrido,
  paradas,
  posicion,
  type LugarEnRecorrido,
  type PantallaDeCarga,
  type PantallaDeCompra,
  type Recorrido,
} from "./llama-guia-estado";
import { svgDeLlama, type PoseDeLlama } from "./llama-poses";

/**
 * La llama que acompaña los recorridos largos: la ventana Tu compra (con la verificación adentro), Cargar con
 * bolivianos y, si se quiere, Dejá tu cuenta lista. La llama de la marca va por un camino con una parada por tramo hasta
 * una bandera, con un globo que lleva la línea de la pantalla.
 *
 * No agrega texto: el globo es la línea que la pantalla ya tenía. No hace chistes ni habla con voz propia, y festeja solo
 * al terminar. No tapa nada: va arriba del cuerpo de la ventana, y la acción principal sigue en el pie.
 *
 * Una llamada por pantalla, desde la ventana que la usa (y que la baja con ella, así la portada no crece):
 *
 *     acompanar(cuerpo, { ...enPantalla("compra", "CQ-ID"), linea: t("compraIdLinea") });
 *
 * La primera llamada la monta; las siguientes la llevan al lugar nuevo (camina al trote, en seis pasitos) y cambian la
 * pose y el globo, sin rehacerla. Con `null` se va. Con menos movimiento no camina, no salta y no tira papel picado.
 * Para el lector de pantalla, la llama y el camino son decorativos, el avance es una barra de progreso y el globo es un
 * párrafo que se lee en su orden. No anuncia nada sola: la ventana sigue anunciando como siempre.
 */

export type { PoseDeLlama } from "./llama-poses";
export type { PantallaDeCarga, PantallaDeCompra, Recorrido } from "./llama-guia-estado";

export interface Acompanamiento {
  pose: PoseDeLlama;
  /** La línea de la pantalla, ya traducida. La que la pantalla mostraba: el globo la reemplaza, no se suma. */
  linea: string;
  /** El tramo, de 1 a `total`. Sin paso no hay camino: solo la llama y el globo. */
  paso?: number;
  total?: number;
  /** Cuánto se avanzó dentro del tramo, de 0 a 1: la llama camina un poco en cada pantalla del tramo. */
  avance?: number;
  /** El nombre de cada tramo, ya traducido, para el lector de pantalla. */
  tramos?: readonly string[];
  /** Una falla: la llama se queda donde estaba (no avanza ni vuelve). Sin un lugar de antes, va sin camino. */
  quedarse?: boolean;
}

/** Lo que tarda en caminar de un lugar a otro (seis pasitos). */
export const CAMINAR_MS = 600;
/** Lo que dura la entrada de una pose: la pata que saluda dos veces, los dos saltos del festejo. */
export const ENTRADA_MS = 1000;
/** Lo que dura el papel picado del festejo. */
export const PAPEL_MS = 1600;

/** El papel picado: hacia dónde vuela cada papel (en px), cuánto gira, su color y cuándo sale. Siempre el mismo. */
const PAPEL: ReadonlyArray<readonly [number, number, number, string, number]> = [
  [-46, -40, 200, "yellow", 0], [-30, -62, -160, "teal", 40], [-10, -70, 240, "orange", 80], [12, -66, -200, "purple", 20],
  [32, -58, 180, "magenta", 60], [50, -36, -220, "yellow", 100], [-56, -10, 160, "purple", 120], [58, -8, -180, "teal", 140],
  [-38, 14, 220, "magenta", 160], [40, 16, -240, "orange", 180], [-20, -48, 140, "teal", 200], [22, -44, -140, "yellow", 220],
];

const BANDERA =
  '<svg class="llg-bandera" viewBox="0 0 22 34" focusable="false"><rect x="1" y="0" width="3" height="34" style="fill:var(--ink)"/>' +
  '<rect x="4" y="1.5" width="16" height="11" style="fill:var(--yellow);stroke:var(--ink);stroke-width:2"/></svg>';

interface Montada {
  el: HTMLElement;
  /** La pose que está dibujada (al caminar, la del trote). */
  dibujada: PoseDeLlama | null;
  /** La pose que pidió la pantalla. */
  pose: PoseDeLlama;
  /** El lugar en el camino, de 0 a 1, o null sin camino. */
  x: number | null;
  paso?: number;
  total?: number;
  avance: number;
  tramos?: readonly string[];
  festejo: boolean;
  caminar?: ReturnType<typeof setTimeout>;
  entrada?: ReturnType<typeof setTimeout>;
  papel?: ReturnType<typeof setTimeout>;
}

const montadas = new WeakMap<HTMLElement, Montada>();

const quieta = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Una frase del diccionario con números (Paso 2 de 4). */
function frase(clave: string, ...args: Array<number | string>): string {
  const v = T[getLang()][clave];
  return typeof v === "function" ? (v as (...a: Array<number | string>) => string)(...args) : t(clave);
}

function montar(contenedor: HTMLElement): Montada {
  const el = document.createElement("div");
  el.className = "llg";
  el.innerHTML =
    '<div class="llg-paso" hidden></div>' +
    '<div class="llg-camino" aria-hidden="true"><span class="llg-via"></span><span class="llg-hecho"></span>' +
    `<span class="llg-paradas"></span>${BANDERA}<span class="llg-llama"></span></div>` +
    '<p class="llg-globo"></p>';
  ponerArriba(contenedor, el);
  return { el, dibujada: null, pose: "saluda", x: null, avance: 0, festejo: false };
}

/** Arriba del cuerpo, debajo del título si el cuerpo empieza con uno. */
function ponerArriba(contenedor: HTMLElement, el: HTMLElement): void {
  const primero = contenedor.firstElementChild;
  if (primero && primero !== el && /^H[1-6]$/.test(primero.tagName)) primero.after(el);
  else contenedor.prepend(el);
}

/** Cambia el dibujo de la llama. Solo el SVG: el papel picado que esté volando sigue al lado. */
function dibujar(m: Montada, pose: PoseDeLlama): void {
  if (m.dibujada === pose) return;
  m.dibujada = pose;
  const lugar = m.el.querySelector(".llg-llama") as HTMLElement;
  lugar.querySelector(".llg-svg")?.remove();
  lugar.insertAdjacentHTML("afterbegin", svgDeLlama(pose));
}

/** La pose de la pantalla, ya en su lugar: con su entrada (saluda y festeja) y, la primera vez que festeja, el papel. */
function llegar(m: Montada, sinMovimiento: boolean): void {
  clearTimeout(m.caminar);
  m.el.classList.remove("llg-camina");
  const cambia = m.dibujada !== m.pose;
  dibujar(m, m.pose);
  m.el.dataset.pose = m.pose;
  if (sinMovimiento || !cambia) return;
  if (m.pose === "saluda" || (m.pose === "festeja" && !m.festejo)) {
    m.el.classList.add("llg-entra");
    clearTimeout(m.entrada);
    m.entrada = setTimeout(() => m.el.classList.remove("llg-entra"), ENTRADA_MS);
  }
  if (m.pose === "festeja" && !m.festejo) {
    m.festejo = true;
    tirarPapel(m);
  }
}

function tirarPapel(m: Montada): void {
  const papel = document.createElement("span");
  papel.className = "llg-papel";
  papel.innerHTML = PAPEL.map(
    ([dx, dy, giro, color, demora]) =>
      `<i style="--dx:${dx}px;--dy:${dy}px;--giro:${giro}deg;--demora:${demora}ms;background:var(--${color})"></i>`,
  ).join("");
  (m.el.querySelector(".llg-llama") as HTMLElement).appendChild(papel);
  clearTimeout(m.papel);
  m.papel = setTimeout(() => papel.remove(), PAPEL_MS);
}

function pintarCamino(m: Montada): void {
  const barra = m.el.querySelector(".llg-paso") as HTMLElement;
  const conCamino = m.x !== null && m.paso !== undefined && m.total !== undefined;
  m.el.classList.toggle("sin-camino", !conCamino);
  if (!conCamino) {
    barra.hidden = true;
    for (const a of ["role", "aria-label", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"]) barra.removeAttribute(a);
    barra.textContent = "";
    (m.el.querySelector(".llg-paradas") as HTMLElement).innerHTML = "";
    m.el.style.removeProperty("--x");
    m.el.removeAttribute("data-fin");
    return;
  }
  const paso = m.paso as number;
  const total = m.total as number;
  const texto = frase("llamaPaso", paso, total);
  const tramo = m.tramos?.[paso - 1];
  barra.hidden = false;
  barra.setAttribute("role", "progressbar");
  barra.setAttribute("aria-label", t("llamaAvance"));
  barra.setAttribute("aria-valuemin", "1");
  barra.setAttribute("aria-valuemax", String(total));
  barra.setAttribute("aria-valuenow", String(paso));
  barra.setAttribute("aria-valuetext", tramo ? frase("llamaPasoAria", paso, total, tramo) : texto);
  barra.textContent = tramo ? frase("llamaPasoAria", paso, total, tramo) : texto;
  const lista = m.el.querySelector(".llg-paradas") as HTMLElement;
  const xs = paradas(total);
  if (lista.children.length !== xs.length) lista.innerHTML = xs.map(() => '<span class="llg-parada"></span>').join("");
  [...lista.children].forEach((p, i) => {
    (p as HTMLElement).style.setProperty("--x", String((xs[i] as number) / 100));
    p.classList.toggle("hecha", i + 1 <= paso);
  });
  m.el.style.setProperty("--x", String(m.x));
  m.el.toggleAttribute("data-fin", (m.x as number) >= 1);
}

/**
 * Pone la llama en el contenedor, o la actualiza si ya está. Con null la quita. Una llamada por pantalla.
 *
 * Va arriba del contenedor (debajo del título, si empieza con uno). Si la ventana rehace su cuerpo, la próxima llamada
 * vuelve a poner la misma llama arriba, sin armarla de nuevo.
 */
export function acompanar(contenedor: HTMLElement, a: Acompanamiento | null): void {
  let m = montadas.get(contenedor);
  if (!a) {
    if (m) {
      clearTimeout(m.caminar);
      clearTimeout(m.entrada);
      clearTimeout(m.papel);
      m.el.remove();
      montadas.delete(contenedor);
    }
    return;
  }
  const sinMovimiento = quieta();
  const nueva = !m;
  if (!m) {
    m = montar(contenedor);
    montadas.set(contenedor, m);
  } else if (m.el.parentNode !== contenedor) {
    // La ventana rehízo su cuerpo: la misma llama vuelve arriba, en su lugar de antes, y desde ahí camina.
    ponerArriba(contenedor, m.el);
    void m.el.getBoundingClientRect();
  }
  m.el.toggleAttribute("data-quieta", sinMovimiento);

  // El lugar: el de la pantalla o, en una falla, el de antes.
  let paso = a.paso;
  let total = a.total;
  let avance = a.avance ?? 0;
  let tramos = a.tramos;
  if (a.quedarse) {
    paso = m.paso;
    total = m.total;
    avance = m.avance;
    tramos = a.tramos ?? m.tramos;
  }
  const valido = paso !== undefined && total !== undefined && total >= 1;
  const antes = m.x;
  m.paso = valido ? Math.min(Math.max(1, Math.round(paso as number)), total as number) : undefined;
  m.total = valido ? Math.round(total as number) : undefined;
  m.avance = valido ? avance : 0;
  m.tramos = valido ? tramos : undefined;
  m.x = valido ? posicion(m.paso as number, m.total as number, avance) / 100 : null;
  m.pose = a.pose;

  (m.el.querySelector(".llg-globo") as HTMLElement).textContent = a.linea;
  pintarCamino(m);

  const camina = !nueva && !sinMovimiento && antes !== null && m.x !== null && antes !== m.x;
  if (!camina) {
    llegar(m, sinMovimiento);
    return;
  }
  // Camina al trote hasta el lugar nuevo, y al llegar toma la pose de la pantalla.
  const montada = m;
  clearTimeout(montada.caminar);
  montada.el.classList.remove("llg-entra");
  montada.el.classList.add("llg-camina");
  dibujar(montada, "anima");
  montada.el.dataset.pose = "anima";
  montada.caminar = setTimeout(() => llegar(montada, quieta()), CAMINAR_MS);
}

/**
 * La pose y el lugar de una pantalla de la compra o de la carga, con los nombres de los tramos ya traducidos: todo lo
 * que `acompanar` necesita salvo la línea. `avance` pisa el de la tabla en las pantallas que avanzan por etapa.
 */
export function enPantalla(recorrido: "compra" | "compraSiguiente", pantalla: PantallaDeCompra, opciones?: { avance?: number }): Omit<Acompanamiento, "linea">;
export function enPantalla(recorrido: "carga" | "cargaVerificada", pantalla: PantallaDeCarga, opciones?: { avance?: number }): Omit<Acompanamiento, "linea">;
export function enPantalla(recorrido: Recorrido, pantalla: string, opciones?: { avance?: number }): Omit<Acompanamiento, "linea"> {
  const l = (lugarEnRecorrido as (r: Recorrido, p: string, o?: { avance?: number }) => LugarEnRecorrido)(recorrido, pantalla, opciones);
  const { tramos, ...resto } = l;
  return tramos ? { ...resto, tramos: tramos.map((k) => t(k)) } : { ...resto };
}
