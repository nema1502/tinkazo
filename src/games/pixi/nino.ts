import { params } from "../../state";
import type { Respuestas } from "./kit/respuestas";

/**
 * El gancho de la prueba del niño para los juegos que todavía no son del kit
 * (la ruleta y la carrera de hoy). Es el mismo contrato que deja `crearJuego`
 * (`kit/crear.ts`): con `?auditar=nino`, `window.__nino` trae
 *
 * - `verdad()`: las `Respuestas` del instante (quién va adelante, hacia dónde,
 *   cuánto falta y qué acaba de pasar), leídas del plan, nunca de la pantalla;
 * - `t()`: la hora del juego, en segundos, la misma que mide `verdad()`;
 * - `duracion`: la hora del golpe, el 100 %: el auditor para al 25 % y al 60 %;
 * - `sinLetras`: lo prende el auditor para la foto de los cinco años; el
 *   estadio (`stage.ts`) esconde todo texto del motor mientras esté prendido.
 *
 * Sin el parámetro no se expone nada, y el juego no cambia: esto solo lee.
 */
export interface GanchoNino {
  sinLetras: boolean;
  duracion: number;
  t(): number;
  verdad(): Respuestas;
}

export function exponerNino(gancho: Omit<GanchoNino, "sinLetras">): void {
  if (params.get("auditar") !== "nino") return;
  (window as unknown as { __nino: GanchoNino }).__nino = { sinLetras: false, ...gancho };
}
