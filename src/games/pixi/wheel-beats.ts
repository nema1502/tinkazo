/**
 * Ruleta: tiempos del arco y agenda de la cámara. Módulo puro (sin Pixi ni DOM)
 * para poder probarlo en Node. El juego no decide nada: esto solo dice CUÁNDO
 * y CÓMO se mueve la cámara.
 *
 * Regla: la sacudida se reserva para el único momento en que el ganador REAL
 * queda confirmado (la coronación). El amague (falsa parada) y el trabado de la
 * paleta solo dan un empujón de zoom, sin sacudida, para que el espectador no
 * lea "es este" dos veces.
 */

export const T_WIND = 1.2;
export const T_SPIN = 2.6;
export const T_BRAKE = 4.2;
export const T_CREEP = 12.0;
export const T_HOLD = 14.4;
export const T_SETTLE = 15.6;
export const T_LOCK = 16.8;
/**
 * El cartel, 0,8 s de juego después de la traba (unos 1,2 s reales). Con 0,4
 * la traba sonaba en el medio segundo de antes del ganador y le robaba el
 * golpe: el auditor de mezcla lo medía más bajo que lo de antes. Es el mismo
 * respiro que hay entre la cumbre y el cartel del teleférico.
 */
export const T_CROWN = 17.6;
/** Cuánto dura la falsa parada sobre el señuelo antes de moverse. */
export const FALSA = 0.75;

export type BeatKind = "shake" | "punch" | "push" | "none";
export type BeatReason = "tease" | "lock" | "crown";

export interface CameraBeat {
  /** Segundos desde el inicio del arco. */
  at: number;
  kind: BeatKind;
  /** shake: píxeles-unidad (se multiplica por G.u); punch/push: fracción de zoom. */
  strength: number;
  reason: BeatReason;
}

/** Agenda ordenada de la cámara para un arco (`falsa` = amague sobre un señuelo). */
export function cameraBeats(falsa: boolean): CameraBeat[] {
  const beats: CameraBeat[] = [];
  if (falsa) beats.push({ at: T_HOLD + FALSA, kind: "push", strength: 0.05, reason: "tease" });
  beats.push({ at: T_LOCK, kind: "punch", strength: 0.05, reason: "lock" });
  beats.push({ at: T_CROWN, kind: "shake", strength: 12, reason: "crown" });
  return beats.sort((a, b) => a.at - b.at);
}

export function beatFor(falsa: boolean, reason: BeatReason): CameraBeat | undefined {
  return cameraBeats(falsa).find((b) => b.reason === reason);
}
