import { esc } from "./dom";
import { type Lang, textos } from "./idioma";
import { esLineaDePersona } from "./campana/forma-persona";
import { contar, nombreDePersona, seCuentaPorPersona } from "./participaciones";
import { filaVisible, lugarDeLaLista } from "./ui/ganadores-de-la-verificacion";
import { withRepeatCounts } from "./ui/repeated-names";

/**
 * Quién salió y entre cuántos, en la tarjeta de cada sorteo de la página del evento (`evento.ts`). La cuenta y los
 * nombres se deciden con la misma lectura por persona, calculada una sola vez: la regla de todos
 * (`seCuentaPorPersona`) con los modos que valen en esa página. Por persona, la tarjeta nombra a la persona sin la
 * marca de la línea sellada y junta a quien salió más de una vez («Ana (2 veces)»); en un orden de turnos no se junta
 * a nadie. Si no, cada línea tal cual se selló. Vive aparte para probarla sin abrir la página.
 */
export function quienEnLaTarjeta(
  lang: Lang,
  s: { names: readonly string[]; ganadores: readonly string[] },
  modosALaVista: boolean,
  turnos: boolean,
): { personas: number; participaciones: number; ganadores: string[] } {
  const porPersona = seCuentaPorPersona(s.names, modosALaVista);
  const { personas, participaciones } = contar(s.names, porPersona);
  const nombres = porPersona ? s.ganadores.map(nombreDePersona) : [...s.ganadores];
  return { personas, participaciones, ganadores: porPersona && !turnos ? withRepeatCounts(lang, nombres) : nombres };
}

/**
 * Si los ganadores que dice el enlace son los que salen al rehacer el sorteo. Con nombres o cuentas, el texto tiene que ser
 * el mismo. En una lista de personas el sorteo da una línea, que nunca se muestra, y el nombre que trae el enlace no está
 * atado a nada sellado: no se compara con nada y su valor no cambia el resultado. Lo que ahí se comprueba es el lugar de cada
 * ganadora, que sale de rehacer el sorteo (`ganadorasPorLugar`), y solo se pide que el enlace diga la misma cantidad.
 */
export function ganadoresDelEnlaceCoinciden(
  nombres: readonly string[],
  ganadores: readonly number[],
  delEnlace: readonly string[],
): boolean {
  if (ganadores.length === 0 || ganadores.length !== delEnlace.length) return false;
  return ganadores.every((i, k) => {
    const rehecho = nombres[i] ?? "";
    return esLineaDePersona(rehecho) || delEnlace[k] === rehecho;
  });
}

/** Una ganadora en el renglón de quién ganó, cuando la lista sellada trae líneas de persona. */
export interface GanadoraPorLugar {
  /** Lo que sale de rehacer el sorteo: su lugar en la lista sellada, o la fila tal cual si no es una línea de persona. Vacío mientras el sorteo no se rehizo bien. */
  comprobado: string;
  /** El nombre que trae el enlace: lo escribió quien compartió y nada sellado lo respalda. Vacío si no hay nada que mostrar. */
  dicho: string;
}

/** Un texto que lleva una línea de persona adentro, aunque venga con algo más. */
const LLEVA_UNA_LINEA = /p1:[a-z2-7]{26}/;

/** Lo que se puede mostrar del texto que trae el enlace: nunca una línea de persona. */
function dichoVisible(dicho: string | undefined): string {
  const limpio = (dicho ?? "").trim();
  return LLEVA_UNA_LINEA.test(limpio) ? "" : limpio;
}

/** Si el texto del enlace es ese mismo lugar, en cualquiera de los dos idiomas y en su forma larga o corta. */
function diceEseLugar(dicho: string, indice: number): boolean {
  return (["es", "en"] as const).some((l) =>
    ["vLugarDeLaLista", "vLugar"].some((clave) => {
      const v = textos(l)[clave];
      return typeof v === "string" && v.replace("{n}", String(indice + 1)) === dicho;
    }),
  );
}

/**
 * El renglón de quién ganó cuando la lista sellada trae líneas de persona. `null` si no trae ninguna: la tarjeta queda como
 * siempre. `rehechos` son los lugares que salen de rehacer el sorteo, o `null` mientras no se rehizo bien: ahí no hay lugar
 * que mostrar y queda solo lo que dice el enlace, como dato. Quien ganó con una línea sale por su lugar, y el nombre del
 * enlace va al lado si dice otra cosa que ese lugar.
 */
export function ganadorasPorLugar(
  sellada: readonly string[],
  rehechos: readonly number[] | null,
  delEnlace: readonly string[],
): GanadoraPorLugar[] | null {
  if (!sellada.some((fila) => esLineaDePersona(fila))) return null;
  if (!rehechos) {
    return delEnlace
      .map(dichoVisible)
      .filter((dicho) => dicho !== "")
      .map((dicho) => ({ comprobado: "", dicho }));
  }
  return rehechos.map((i, k) => {
    const fila = sellada[i] ?? "";
    if (!esLineaDePersona(fila)) return { comprobado: fila, dicho: "" };
    const dicho = dichoVisible(delEnlace[k]);
    return { comprobado: lugarDeLaLista(i), dicho: diceEseLugar(dicho, i) ? "" : dicho };
  });
}

/** Cada nombre aislado: uno con caracteres que invierten la escritura no da vuelta a los demás. */
const aislado = (nombre: string): string => `<bdi>${esc(nombre)}</bdi>`;

/**
 * El renglón de quién ganó en la tarjeta. Sin `porLugar` es el de siempre: los nombres del enlace en negrita. Con `porLugar`
 * (una lista con líneas de persona) la negrita es solo para lo que salió de rehacer el sorteo, y el nombre del enlace va al
 * lado, entre paréntesis y sin negrita. Sin nada que mostrar no deja el rótulo solo.
 */
export function htmlDeQuienGano(rotulo: string, ganadores: readonly string[], porLugar: readonly GanadoraPorLugar[] | null): string {
  const quien = porLugar
    ? porLugar.map((g) => (g.comprobado ? `<b>${aislado(g.comprobado)}</b>${g.dicho ? ` (${aislado(g.dicho)})` : ""}` : aislado(g.dicho))).join(", ")
    : `<b>${ganadores.map(aislado).join(", ")}</b>`;
  if (porLugar && !quien) return "";
  return `<p class="ev-gana"><span class="kicker">${esc(rotulo)}</span> ${quien}</p>`;
}

/** Quienes ganaron al rehacer el sorteo, como se pueden mostrar: una línea de persona sale como su lugar en la lista. */
export function ganadoresRehechos(nombres: readonly string[], ganadores: readonly number[]): string[] {
  return ganadores.map((i) => filaVisible(nombres[i] ?? "", i));
}
