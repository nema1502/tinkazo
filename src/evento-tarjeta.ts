import type { Lang } from "./idioma";
import { contar, nombreDePersona, seCuentaPorPersona } from "./participaciones";
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
