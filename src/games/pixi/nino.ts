import { params } from "../../state";
import type { Forma, Respuestas } from "./kit/respuestas";

/**
 * El gancho de la prueba del niño para los juegos que todavía no son del kit
 * (la ruleta y la carrera de hoy). Es el mismo contrato que deja `crearJuego`
 * (`kit/crear.ts`): con `?auditar=nino`, `window.__nino` trae
 *
 * - `forma`: la del juego (`carrera`, `de-pie`, `rueda` o `acumulacion`), que decide
 *   la pregunta propia de la prueba;
 * - `verdad()`: las `Respuestas` del instante (lo propio de la forma en `adelante`,
 *   adónde mirar en `adelante.lugar`, cuánto falta y qué acaba de pasar), leídas del
 *   plan, nunca de la pantalla;
 * - `t()`: la hora del juego, en segundos, la misma que mide `verdad()`;
 * - `duracion`: la hora del golpe, el 100 %: el auditor para al 25 % y al 60 %;
 * - `sinLetras`: lo prende el auditor para la foto de los cinco años; el
 *   estadio (`stage.ts`) esconde todo texto del motor mientras esté prendido.
 *
 * Sin el parámetro no se expone nada, y el juego no cambia: esto solo lee.
 */
export interface GanchoNino {
  sinLetras: boolean;
  forma: Forma;
  duracion: number;
  t(): number;
  verdad(): Respuestas;
  /**
   * Solo los juegos cuya pantalla muestra grupos y no personas (las cabinas del teleférico, las comparsas de Oruro):
   * el nombre del grupo de cada persona, por su puesto en la lista. Quien mira contesta «quiénes siguen» con el
   * nombre del grupo, y eso vale mientras siga en juego alguien de ese grupo. Presentación: no cambia el plan.
   */
  grupos?: readonly string[];
}

export function exponerNino(gancho: Omit<GanchoNino, "sinLetras">): void {
  if (params.get("auditar") !== "nino") return;
  (window as unknown as { __nino: GanchoNino }).__nino = { sinLetras: false, ...gancho };
}
