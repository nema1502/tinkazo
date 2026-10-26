/**
 * La medida del zoom del director de cámara, para `audit-emocion.mjs`.
 *
 * El golpe es el instante en que el show revela al ganador y la cámara se
 * acerca de golpe (`Camera.golpe`, `docs/motores.md`). Lo que importa a la sala
 * no es el 12 % del golpe solo: es cuántas veces más cerca está la cámara en
 * ese instante que en el plano general, el más ancho antes de que empiece la
 * tensión. Se mide la escala de la escena, que es la que se ve.
 *
 * El mínimo es el que propone la tarea del barrido de emoción (25 de octubre
 * de 2026) para cuando no haya inventario de momentos: 1,6×.
 */

/** Cuántas veces más cerca tiene que estar la cámara en el golpe que en el plano general. */
export const ZOOM_MINIMO = 1.6;

/**
 * Corre adentro de la página, una vez por cuadro de juego. Necesita
 * `window.__tinkazo` (`?auditar=camara`, `src/games/pixi/stage.ts`): la
 * cámara y la escena. Guarda en `window.__zoom` el plano general (la escala
 * más chica mientras no hubo golpe), la escala más alta en el medio segundo
 * del golpe, y cuándo terminó el show (el estadio se cierra).
 */
export function instalarZoom() {
  const Z = { minAntes: Infinity, enGolpe: 0, golpe: null, muestras: 0, vio: false, fin: false, cuadros: 0 };
  window.__zoom = Z;
  Z.medir = () => {
    Z.cuadros++;
    const est = document.getElementById("stadium");
    if (est && Z.cuadros % 8 === 0) {
      if (getComputedStyle(est).display === "block") Z.vio = true;
      else if (Z.vio) Z.fin = true;
    }
    const T = window.__tinkazo;
    if (!T || Z.fin) return;
    try {
      const t = T.camara.tiempo;
      const s = T.escena.scale.x;
      // Antes del primer cuadro de la cámara la escala es la de fábrica, no la del juego.
      if (!(t > 0.05) || !(s > 0)) return;
      Z.muestras++;
      const g = T.camara.golpeEn;
      if (g === null || g === undefined) {
        if (s < Z.minAntes) Z.minAntes = s;
      } else {
        if (Z.golpe === null) Z.golpe = g;
        if (t >= g && t <= g + 0.5 && s > Z.enGolpe) Z.enGolpe = s;
      }
    } catch (e) {
      /* la escena ya se destruyó */
    }
  };
}

/** Las veces que se acercó en el golpe (escala del golpe sobre el plano general), o null si no hubo golpe. */
export function razonDeZoom(z) {
  if (!z || z.golpe === null || z.golpe === undefined) return null;
  if (!(Number.isFinite(z.minAntes) && z.minAntes > 0) || !(z.enGolpe > 0)) return null;
  return z.enGolpe / z.minAntes;
}

/** El mínimo, la mediana y el máximo de las semillas que tuvieron golpe, y cuántas lo tuvieron. */
export function resumirZoom(razones) {
  const v = razones.filter((r) => r !== null && Number.isFinite(r)).sort((a, b) => a - b);
  const redondea = (x) => +x.toFixed(2);
  return {
    semillas: razones.length,
    conGolpe: v.length,
    min: v.length ? redondea(v[0]) : null,
    mediana: v.length ? redondea(v[v.length >> 1]) : null,
    max: v.length ? redondea(v[v.length - 1]) : null,
  };
}

/** Un zoom como se lee: "1,84×". */
export const veces = (x) => (x === null || x === undefined ? "—" : `${x.toFixed(2).replace(".", ",")}×`);
