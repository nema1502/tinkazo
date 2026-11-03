/**
 * Las comprobaciones del auditor de pantalla, una por cosa que mide.
 *
 * `audit-pantalla` mira un juego en una resolución y un tema, y su resultado
 * dice dos cosas: cuántos destellos por segundo tuvo el peor tramo (más de tres
 * por segundo es lo que la guía de fotosensibilidad llama peligroso) y qué
 * textos de contraste bajo se quedaron sin contorno. Acá cada una es una
 * comprobación, para que el resumen `--json` de pantalla y el grupo de pantalla
 * dentro de `audit-rigor` cuenten lo mismo.
 *
 * Y que el borde de un texto no se coma la letra (ver `bordeSeCome`): con una
 * letra de tinta y un borde de tinta grueso, las letras se funden en una mancha.
 */

/** Más de esto por segundo, el juego destella de más. */
export const MAX_DESTELLOS = 3;

/** Un borde más ancho que esta parte del tamaño de la letra, y del mismo tono que ella, se la come. */
export const MAX_BORDE = 0.08;
/** Debajo de esta luminosidad relativa un color es oscuro; encima de `CLARO`, claro. */
export const OSCURO = 0.2;
export const CLARO = 0.5;
/** Dos colores a menos de esta distancia (RGB, de 0 a 441) también se funden. */
export const DISTANCIA_PARECIDO = 80;

const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const canales = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
/** La luminosidad relativa (WCAG) de un color 0xRRGGBB. */
export const luminosidad = (c) => {
  const [r, g, b] = canales(c);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const distancia = (a, b) => Math.hypot(...canales(a).map((v, i) => v - canales(b)[i]));

/**
 * ¿El borde de este texto se come la letra? Pasa cuando el borde es del mismo
 * tono que la letra (los dos oscuros, los dos claros, o colores muy parecidos)
 * y su ancho en pantalla pasa del 8 % del tamaño de la letra en pantalla.
 * `t` trae `{ s, px, fill, trazoColor, trazoPx }`, con `px` y `trazoPx` ya
 * multiplicados por la escala con que se dibuja. Devuelve el hallazgo o null.
 */
export function bordeSeCome(t) {
  if (!t || t.fill == null || t.trazoColor == null || !(t.px > 0) || !(t.trazoPx > 0)) return null;
  const lf = luminosidad(t.fill), lb = luminosidad(t.trazoColor);
  const mismoTono = (lf < OSCURO && lb < OSCURO) || (lf > CLARO && lb > CLARO) || distancia(t.fill, t.trazoColor) < DISTANCIA_PARECIDO;
  const parte = t.trazoPx / t.px;
  if (!mismoTono || parte <= MAX_BORDE) return null;
  return { s: t.s, px: +t.px.toFixed(1), borde: +t.trazoPx.toFixed(1), pct: Math.round(parte * 100) };
}

/** Lo que `medirJuego` devuelve, como una lista de `{ name, ok, detail }`. */
export function comprobacionesDePantalla(r) {
  const donde = `${r.juego} ${r.res}${r.tema ? ` ${r.tema}` : ""}`;
  if (!r.ok) return [{ name: `${donde}: el estadio aparece`, ok: false, detail: r.motivo ?? "" }];
  const peor = r.destellos?.peorPorSegundo ?? 0;
  const sin = r.contraste?.sinContorno ?? [];
  const come = r.bordes ?? [];
  return [
    { name: `${donde}: a lo sumo ${MAX_DESTELLOS} destellos por segundo`, ok: !(peor > MAX_DESTELLOS), detail: `${peor} por segundo` },
    { name: `${donde}: el texto de contraste bajo lleva contorno`, ok: sin.length === 0, detail: sin.length ? `${sin.length} sin contorno` : "" },
    { name: `${donde}: el borde no se come la letra`, ok: come.length === 0, detail: come.slice(0, 3).map((b) => `«${b.s}» de ${b.px} px con borde de ${b.borde} px (${b.pct} %)`).join("; ") },
  ];
}

/** ¿Hay algo que mirar en este resultado? Es el criterio de siempre de `audit-pantalla`. */
export const hayHallazgo = (r) => !r.ok || r.destellos?.peorPorSegundo > MAX_DESTELLOS || (r.contraste?.sinContorno?.length ?? 0) > 0 || (r.bordes?.length ?? 0) > 0;
