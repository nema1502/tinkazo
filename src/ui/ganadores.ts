import { onLangChange, t } from "../i18n";
import { MAX_WINNERS } from "../protocol/select";
import { topeDeGanadores } from "../stellar/config";

/**
 * «Cuántos ganan»: un campo numérico (`#nw`) con atajos para lo común.
 *
 * Hasta el 6 de noviembre de 2026 era un desplegable con las opciones de 1 a 32 escritas a mano. Con un tope de 300 ya
 * no sirve: son trescientos renglones para bajar con el dedo. Ahora es un número que se escribe (o se sube y se baja) y, al
 * lado, los cinco valores que casi todo el mundo usa: 1, 2, 3, 5 y 10. Tocar uno es la acción; el campo está para
 * cuando hace falta otro número.
 *
 * El campo sigue siendo la única fuente de verdad, como `#prize`: el sello, el resumen, las bases y el borrador lo leen
 * de ahí con `ganadoresPedidos()`, y los atajos solo lo escriben y reflejan lo que dice.
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
 * Un entero entre 1 y `tope`, saque lo que saque el campo: vacío, letras, un decimal (`3.7` es 3), un negativo o
 * `1e2` (que el navegador acepta en un campo numérico y vale 100). Nunca devuelve algo que no sea un número válido.
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

/**
 * Cuántos ganadores se piden, ya acotado: lo que leen el sello, el sorteo, el resumen y las bases. Sin el campo (la
 * página de verificación no lo tiene) es 1. Acota al tope del protocolo, no al de la red: ver arriba.
 */
export function ganadoresPedidos(): number {
  return acotar(campo()?.value);
}

/** Qué atajo está elegido y cuáles se ven: los que pasan del tope de la red se esconden. */
function sincronizar(): void {
  const tope = topeDeGanadores();
  const actual = ganadoresPedidos();
  for (const b of atajos()) {
    const n = Number(b.dataset.n);
    b.hidden = n > tope;
    b.setAttribute("aria-pressed", String(n === actual));
  }
}

/** Escribe la cantidad en el campo (acotada) y refleja el cambio en los atajos. No avisa: lo llaman quienes ya saben qué cambió. */
export function ponerGanadores(n: number): void {
  const el = campo();
  if (!el) return;
  el.value = String(acotar(n));
  sincronizar();
}

/** Bloquea o libera el campo y los atajos juntos (la lista se está sellando o ya está sellada: `cerrarLista`). */
export function bloquearGanadores(si: boolean): void {
  const el = campo();
  if (el) el.disabled = si;
  for (const b of atajos()) b.disabled = si;
}

/** «Hasta 300 ganadores por sorteo», solo cuando se pidió de más y se bajó al tope. */
function avisarTope(si: boolean): void {
  const nota = document.getElementById("nw-nota");
  if (!nota) return;
  nota.textContent = si ? t("winnersTope").replace("{n}", String(topeDeGanadores())) : "";
  nota.hidden = !si;
}

let montado = false;

/**
 * Arma el campo y los atajos: pone sus límites (los de la red, que el HTML no puede saber), baja al tope lo que se
 * escribe de más y avisa por qué, y vuelve a decir el aviso al cambiar de idioma. Se llama una vez al cargar.
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
  // Mientras se escribe solo se baja lo que pasa del tope: un campo vacío o un cero a medias no se tocan (se está tecleando).
  el.addEventListener("input", recortar);
  // Al salir del campo, o con las flechas, queda un número válido: nada de vacío, de cero ni de decimales.
  el.addEventListener("change", () => {
    const hubo = avisado;
    el.value = String(acotar(el.value, tope));
    avisarTope(hubo);
    sincronizar();
  });
  el.addEventListener("blur", () => {
    el.value = String(acotar(el.value, tope));
    sincronizar();
  });
  document.getElementById("nw-atajos")?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-n]");
    if (!b || el.disabled) return;
    ponerGanadores(Number(b.dataset.n));
    avisarTope(false);
    // Lo escuchan el borrador, el resumen de «Sellar la lista» y el pliegue de las opciones.
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  onLangChange(() => avisarTope(avisado));
  sincronizar();
}
