import { onLangChange, t } from "../i18n";
import { MAX_WINNERS } from "../protocol/select";
import { topeDeGanadores } from "../stellar/config";

/**
 * Cuántos ganan: un contador con menos y más, y atajos para lo común, a la vista junto a Sellar la lista.
 *
 * La persona nunca escribe un número. Los botones cambian de a uno y los atajos ofrecen 1, 2, 3, 5 y 10. El campo
 * escondido `#nw` sigue siendo la única fuente de verdad, como `#prize`: el sello, el resumen, las bases y el borrador
 * lo leen con `ganadoresPedidos()`. `#nw-valor` muestra esa cantidad y los botones solo la cambian mediante el campo.
 *
 * Hasta el 16 de noviembre de 2026 era un campo numérico dentro del pliegue. Salió de ahí porque varios premios de un
 * mismo evento se pueden sortear juntos, y el contador evita teclear en un celular.
 *
 * Dos topes, y no son lo mismo. El que se **ofrece** es el de la red (`topeDeGanadores`): el contrato de testnet de hoy
 * admite 32, y el sitio no ofrece lo que la red devolvería como error. El que se **acepta al leer** es el del protocolo
 * (`MAX_WINNERS`): un sorteo ya sellado con más de lo que esta compilación ofrece (se retoma desde el historial) tiene
 * que leerse tal cual, no recortado.
 *
 * Lo que decide qué número queda es una función pura aparte (`acotar`), para probarla sin pantalla.
 */

/** Los atajos, en el orden en que se ven. */
export const ATAJOS: readonly number[] = [1, 2, 3, 5, 10];

/** Los atajos que caben en un tope. */
export const atajosHasta = (tope: number): number[] => ATAJOS.filter((a) => a <= tope);

/**
 * Un entero entre 1 y `tope`, también para valores viejos o escritos por otro código: vacío, letras, un decimal (`3.7`
 * es 3), un negativo o `1e2` (100). Nunca devuelve algo que no sea un número válido.
 */
export function acotar(valor: unknown, tope: number = MAX_WINNERS): number {
  const crudo = typeof valor === "number" ? valor : Number(String(valor ?? "").trim());
  if (!Number.isFinite(crudo)) return 1;
  return Math.max(1, Math.min(Math.floor(crudo), Math.max(1, tope)));
}

const campo = (): HTMLInputElement | null => {
  const el = document.getElementById("nw");
  return el instanceof HTMLInputElement ? el : null;
};
const atajos = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>("#nw-atajos button[data-n]")];
const boton = (id: string): HTMLButtonElement | null => {
  const el = document.getElementById(id);
  return el instanceof HTMLButtonElement ? el : null;
};

/** La lista se está sellando o ya está sellada (`cerrarLista`). */
let cerrado = false;
/** El modo Orden de turnos fija la cantidad a la de la lista (`fijarGanadores`). */
let fijo = false;
/** El modo stand (`ponerContadorDelStand`): el contador se llama Cuántos salen y el tope es la lista de la ronda. */
let enElStand = false;
/** Cuántas líneas tiene la lista ahora (`lineasDeLaLista`, desde `renderNames`). Solo cuenta en el stand. */
let lineas = 0;

/**
 * Cuántos ganadores se piden, ya acotado: lo que leen el sello, el sorteo, el resumen y las bases. Sin el campo (la
 * página de verificación no lo tiene) es 1. Acota al tope del protocolo, no al de la red: ver arriba.
 */
export function ganadoresPedidos(): number {
  return acotar(campo()?.value);
}

/** Lo que se ofrece: el tope de la red y, en el stand, además las líneas de la lista de la ronda. Nunca menos de 1. */
const topeAhora = (): number => (enElStand ? Math.max(1, Math.min(lineas, topeDeGanadores())) : topeDeGanadores());

/**
 * Lo que muestra el contador. En el stand, lo pedido sin pasar de la lista: lo que va a salir en la ronda. Lo pedido
 * (`#nw`) no se toca, y si la lista vuelve a crecer, vuelve a lo pedido.
 */
const mostrado = (): number => (enElStand ? Math.min(ganadoresPedidos(), topeAhora()) : ganadoresPedidos());

/** El número visible, el atajo elegido y los botones que se pueden tocar con el tope que corresponde. */
function sincronizar(): void {
  const tope = topeAhora();
  const actual = mostrado();
  // En el stand el contador aparece cuando la ronda se puede empezar: con menos de dos nombres sería un control sin uso.
  const control = document.getElementById("ganadores-control");
  if (control && enElStand) control.hidden = lineas < 2;
  const visible = document.getElementById("nw-valor");
  if (visible) visible.textContent = String(actual);
  const bloqueado = cerrado || fijo;
  for (const b of atajos()) {
    const n = Number(b.dataset.n);
    b.hidden = n > tope;
    b.disabled = bloqueado;
    b.setAttribute("aria-pressed", String(n === actual));
  }
  const menos = boton("nw-menos");
  const mas = boton("nw-mas");
  if (menos) menos.disabled = bloqueado || actual <= 1;
  if (mas) mas.disabled = bloqueado || actual >= tope;
}

/** Escribe la cantidad en el campo escondido y refleja el cambio en el contador y los atajos. No avisa con un evento. */
export function ponerGanadores(n: number): void {
  const el = campo();
  if (!el) return;
  el.value = String(acotar(n));
  sincronizar();
}

function aplicarBloqueo(): void {
  const el = campo();
  if (el) el.disabled = cerrado || fijo;
  sincronizar();
}

/** Bloquea o libera el contador y los atajos juntos (la lista se está sellando o ya está sellada: `cerrarLista`). */
export function bloquearGanadores(si: boolean): void {
  cerrado = si;
  aplicarBloqueo();
}

/**
 * En el modo Orden de turnos la cantidad es la de la lista y no se toca (`src/ui/turnos.ts`): el contador y los atajos
 * quedan bloqueados aunque la lista esté abierta. Al apagar el modo vuelven, salvo que la lista esté cerrada.
 */
export function fijarGanadores(si: boolean): void {
  fijo = si;
  aplicarBloqueo();
}

/** El aviso del tope, solo cuando un valor anterior lo superaba y bajó. El stand no lo tiene: su tope es la lista. */
function avisarTope(si: boolean): void {
  const nota = document.getElementById("nw-nota");
  if (!nota) return;
  const ver = si && !enElStand;
  nota.textContent = ver ? t("winnersTope").replace("{n}", String(topeDeGanadores())) : "";
  nota.hidden = !ver;
}

/**
 * Cuántas líneas tiene la lista ahora. La llama `renderNames` cada vez que la lista cambia. En el stand mueve el tope
 * y muestra o esconde el contador. Fuera de él solo la anota.
 */
export function lineasDeLaLista(n: number): void {
  lineas = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (enElStand) sincronizar();
}

/**
 * El contador del modo stand: Cuántos salen, desde 1 y con el tope en la lista de la ronda. El stand no sortea con
 * premio ni habla de ganar: sus rondas dicen quién salió. La cantidad sigue en el mismo campo escondido (`#nw`), así
 * que el sello de la ronda, la elección del juego y el resumen la leen sin enterarse. Lo pedido se respeta en cada
 * ronda: con la lista más corta muestra y saca las que hay, y si vuelve a crecer, vuelve a lo pedido.
 *
 * Es de un solo sentido: salir del stand recarga la página, y el borrador (`participants.ts`) repone el valor y el
 * rótulo de siempre. Llamarlo otra vez no hace nada.
 */
export function ponerContadorDelStand(): void {
  if (enElStand) return;
  enElStand = true;
  const rotulo = document.getElementById("nw-etiqueta");
  if (rotulo) {
    rotulo.dataset.i = "standSalen";
    rotulo.textContent = t("standSalen");
  }
  const grupo = document.getElementById("nw-atajos");
  if (grupo) {
    grupo.dataset.iAria = "standSalenAtajos";
    grupo.setAttribute("aria-label", t("standSalenAtajos"));
  }
  avisarTope(false);
  ponerGanadores(1);
}

let montado = false;

/**
 * Arma el contador y los atajos: pone los límites de la red, cambia la cantidad solo con botones y refleja en pantalla
 * los valores que ponen el borrador, un sello retomado o el modo de turnos. Se llama una vez al cargar.
 */
export function montarGanadores(): void {
  const el = campo();
  if (!el || montado) return;
  montado = true;
  const tope = topeDeGanadores();
  el.min = "1";
  el.max = String(tope);
  el.step = "1";
  let avisado = false;
  const recortar = (): void => {
    const n = Number(el.value);
    avisado = Number.isFinite(n) && n > tope;
    if (avisado) el.value = String(tope);
    avisarTope(avisado);
    sincronizar();
  };
  // Los valores que llegan por código se acotan igual: el campo escondido no se escribe a mano.
  el.addEventListener("input", recortar);
  el.addEventListener("change", () => {
    const hubo = avisado;
    el.value = String(acotar(el.value, tope));
    avisarTope(hubo);
    sincronizar();
  });
  const elegir = (n: number): void => {
    if (el.disabled) return;
    ponerGanadores(n);
    avisado = false;
    avisarTope(false);
    // Lo escuchan el borrador y el resumen de Sellar la lista.
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // Menos y más parten de lo que se ve: en el stand, con la lista más corta que lo pedido, no de lo pedido.
  boton("nw-menos")?.addEventListener("click", () => elegir(Math.max(1, mostrado() - 1)));
  boton("nw-mas")?.addEventListener("click", () => elegir(Math.min(topeAhora(), mostrado() + 1)));
  document.getElementById("nw-atajos")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-n]");
    if (!b) return;
    elegir(Number(b.dataset.n));
  });
  onLangChange(() => avisarTope(avisado));
  sincronizar();
}
