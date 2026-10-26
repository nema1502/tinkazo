import { DUR_FINAL, FIJOS, FINALISTAS, PELOTON_MAX, TARJETA, T_NOMBRES, T_VUELO } from "./carrera-base";
import { ENTRE_FINAL, durTanda, grupoDeTandas, pasanPorTanda, tandasPara } from "./carrera-tandas";
import { duracionGrupo } from "./carrera-tiempos";

/**
 * Cuánto dura la carrera, sin el plan: lo que el selector de duración necesita
 * saber antes de que se juegue (`src/duraciones.ts`, que carga la portada). Solo
 * cuentas con las medidas del show; nada del plan, de la cámara ni de Pixi, para
 * que la portada no baje cuarenta kilobytes de show que todavía no usa.
 */

export { FIJOS, FINALISTAS, TARJETA };

/** Cuántas corren en el grupo con `n` personas: todas hasta 30; con más, las que pasan las tandas. */
export function grupoDe(n: number): number {
  if (n <= FINALISTAS) return 0;
  if (n <= PELOTON_MAX) return n;
  return grupoDeTandas(n);
}

/** La salida del grupo (cuándo corre): después del vuelo y los nombres, o de las tandas si las hay. */
export const tSalidaDe = (n: number): number => (n > PELOTON_MAX ? T_VUELO + tandasPara(n) * durTanda(pasanPorTanda(n)) + ENTRE_FINAL : T_VUELO + T_NOMBRES);

/** Cuánto dura la carrera con `n` personas, sin estirar, hasta que cruza la ganadora (el promedio de los cuatro arcos). */
export function duracionNominal(n: number): number {
  const g = grupoDe(n);
  return tSalidaDe(n) + duracionGrupo(Math.max(0, g - FINALISTAS)) + DUR_FINAL * 1.014;
}

/** Lo que promete "Normal" con `n` personas, en segundos de show: lo que dura la carrera más lo que no se estira y la tarjeta. */
export const normalDe = (n: number): number => Math.round(duracionNominal(n) + FIJOS + TARJETA);
