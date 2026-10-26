/**
 * Las comprobaciones del auditor de pantalla, una por cosa que mide.
 *
 * `audit-pantalla` mira un juego en una resolución y un tema, y su resultado
 * dice dos cosas: cuántos destellos por segundo tuvo el peor tramo (más de tres
 * por segundo es lo que la guía de fotosensibilidad llama peligroso) y qué
 * textos de contraste bajo se quedaron sin contorno. Acá cada una es una
 * comprobación, para que el resumen `--json` de pantalla y el grupo de pantalla
 * dentro de `audit-rigor` cuenten lo mismo.
 */

/** Más de esto por segundo, el juego destella de más. */
export const MAX_DESTELLOS = 3;

/** Lo que `medirJuego` devuelve, como una lista de `{ name, ok, detail }`. */
export function comprobacionesDePantalla(r) {
  const donde = `${r.juego} ${r.res}${r.tema ? ` ${r.tema}` : ""}`;
  if (!r.ok) return [{ name: `${donde}: el estadio aparece`, ok: false, detail: r.motivo ?? "" }];
  const peor = r.destellos?.peorPorSegundo ?? 0;
  const sin = r.contraste?.sinContorno ?? [];
  return [
    { name: `${donde}: a lo sumo ${MAX_DESTELLOS} destellos por segundo`, ok: !(peor > MAX_DESTELLOS), detail: `${peor} por segundo` },
    { name: `${donde}: el texto de contraste bajo lleva contorno`, ok: sin.length === 0, detail: sin.length ? `${sin.length} sin contorno` : "" },
  ];
}

/** ¿Hay algo que mirar en este resultado? Es el criterio de siempre de `audit-pantalla`. */
export const hayHallazgo = (r) => !r.ok || r.destellos?.peorPorSegundo > MAX_DESTELLOS || (r.contraste?.sinContorno?.length ?? 0) > 0;
