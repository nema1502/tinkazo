/**
 * Cómo se reparte el tiempo de un cuadro entre los pasos del juego.
 *
 * Cada paso sigue siendo de 50 ms como mucho, así los juegos integran igual que
 * siempre. Lo que cambió (5 de noviembre de 2026): un cuadro largo ya no se
 * recorta a un solo paso de 50 ms, se reparte en varios. En un equipo que dibuja
 * a 9 cuadros por segundo, la carrera de llamas avanzaba 15 s de juego en 41 s
 * de reloj y no terminaba dentro de los 40 s (caso público S72r). Con los pasos
 * repartidos, el juego ve la misma secuencia que en un equipo rápido.
 *
 * El cuadro entero se sigue acotando, ahora a 250 ms: volver de una pestaña en
 * segundo plano no salta media animación de golpe.
 */
export const PASO_MAX = 0.05;
export const CUADRO_MAX = 0.25;

/** Los pasos, en segundos de reloj (sin el ritmo), para un cuadro que duró `segundos`. */
export function pasosDelCuadro(segundos: number): number[] {
  if (!(segundos > 0)) return [];
  let resto = Math.min(CUADRO_MAX, segundos);
  const pasos: number[] = [];
  while (resto > 1e-9) {
    const paso = Math.min(PASO_MAX, resto);
    pasos.push(paso);
    resto -= paso;
  }
  return pasos;
}
