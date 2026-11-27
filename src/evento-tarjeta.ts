import type { Lang } from "./idioma";
import { esLineaDePersona } from "./campana/forma-persona";
import { contar, nombreDePersona, seCuentaPorPersona } from "./participaciones";
import { filaVisible } from "./ui/ganadores-de-la-verificacion";
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
 * Si los ganadores que dice el enlace son los que salen al rehacer el sorteo. Con nombres, el texto tiene que ser el mismo.
 * En una lista de personas el sorteo da una línea, que nunca se muestra: el enlace lleva el nombre que tenía esa pestaña o
 * el lugar en la lista, y eso no se puede recalcular. Ahí se pide que haya uno por cada ganadora y que no sea una línea.
 */
export function ganadoresDelEnlaceCoinciden(
  nombres: readonly string[],
  ganadores: readonly number[],
  delEnlace: readonly string[],
): boolean {
  if (ganadores.length === 0 || ganadores.length !== delEnlace.length) return false;
  return ganadores.every((i, k) => {
    const rehecho = nombres[i] ?? "";
    const dicho = delEnlace[k] ?? "";
    return esLineaDePersona(rehecho) ? dicho !== "" && !esLineaDePersona(dicho) : dicho === rehecho;
  });
}

/** Quienes ganaron al rehacer el sorteo, como se pueden mostrar: una línea de persona sale como su lugar en la lista. */
export function ganadoresRehechos(nombres: readonly string[], ganadores: readonly number[]): string[] {
  return ganadores.map((i) => filaVisible(nombres[i] ?? "", i));
}
