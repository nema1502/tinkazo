import type { Game, Pace } from "../state";

/**
 * El juego y el ritmo de un sorteo que ya se mira en celulares.
 *
 * El enlace del QR del espectador (`espectador-enlace.ts`) lleva el juego y el ritmo del momento en que se armó, y el
 * celular juega con esos. Si después la sala cambiaba el juego o la duración, quien ya había escaneado veía otro juego
 * con otro largo: de Rápido a Normal, el celular coronaba unos 18 s antes que la sala, y de la ruleta a la carrera con
 * mucha gente, casi un minuto antes. Por eso, desde que el QR se ve, el juego y el ritmo de ese sorteo quedan como
 * están hasta que sale el resultado, y el selector lo dice (`freeze.ts`, `main.ts`). Otro sorteo (otra ronda) los
 * suelta, y una página recargada también: lo fijo vive en la memoria de la página.
 */

interface Fijo {
  round: number;
  juego: Game;
  ritmo: Pace;
}

let fijo: Fijo | null = null;

/** El QR del espectador se ve: el juego y el ritmo de la lista sellada en la ronda `round` quedan. */
export function fijarParaEspectadores(round: number, juego: Game, ritmo: Pace): void {
  fijo = { round, juego, ritmo };
  // El selector de la página, detrás de la espera, lo dice (`main.ts`).
  document.dispatchEvent(new CustomEvent("tinkazo:espectadores"));
}

/** El juego y el ritmo fijos de la lista sellada `f`, o null si nadie la mira desde el QR o ya salió su resultado. */
export function fijoPara(f: { round: number } | null | undefined, conResultado: boolean): { juego: Game; ritmo: Pace } | null {
  if (!fijo || !f || conResultado || f.round !== fijo.round) return null;
  return { juego: fijo.juego, ritmo: fijo.ritmo };
}
