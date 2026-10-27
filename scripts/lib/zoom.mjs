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
 * Lo que el golpe no puede cortar: quien gana y el cartel. Se mira desde el golpe hasta `VENTANA_CUADRO` segundos
 * después (el empuje llega en una décima, se sostiene y vuelve), y se mide:
 *
 * - `ganadorFuera`: la parte de la caja de quien gana (su cuerpo o su agujero y, donde lo lleva, su nombre) que queda
 *   afuera de lo que se ve del juego, entre la barra de arriba y el relator. Hasta 0,1: un borde que asoma no corta a nadie.
 * - `ganadorTapado`: la parte de esa caja que el cartel tapa, desde que el cartel casi llegó a su tamaño
 *   (`DESDE_CARTEL` segundos después del golpe: antes entra desde cero). Hasta 0,15.
 * - `cartelFuera`: cuántos píxeles se sale el cartel de la pantalla por los costados en su rebote. Hasta 1.
 *
 * Un juego que no dice dónde está quien gana (`sinGanador`) no se puede medir, y eso es una falla.
 */
export const VENTANA_CUADRO = 1.2;
export const DESDE_CARTEL = 0.35;
export const MAX_GANADOR_FUERA = 0.1;
export const MAX_GANADOR_TAPADO = 0.15;
export const MAX_CARTEL_FUERA = 1;

/** Lo peor de varias semillas: los cuadros y los que no tenían ganador se suman; lo demás, el máximo. */
export function juntarCuadros(cuadros) {
  const v = cuadros.filter(Boolean);
  const peor = (k) => v.reduce((m, c) => Math.max(m, c[k] ?? 0), 0);
  return {
    n: v.reduce((a, c) => a + (c.n ?? 0), 0),
    sinGanador: v.reduce((a, c) => a + (c.sinGanador ?? 0), 0),
    ganadorFuera: peor("ganadorFuera"),
    ganadorTapado: peor("ganadorTapado"),
    cartelFuera: peor("cartelFuera"),
  };
}

/** Qué dice de un `cuadro` medido: las fallas, en palabras, o una lista vacía. */
export function fallasDeCuadro(cuadro) {
  if (!cuadro || !cuadro.n) return ["no hubo ningún cuadro del golpe para mirar"];
  const f = [];
  if (cuadro.sinGanador > 0 && cuadro.sinGanador === cuadro.n) f.push("el juego no dice dónde está quien gana");
  else {
    if (cuadro.ganadorFuera > MAX_GANADOR_FUERA) f.push(`el golpe deja ${Math.round(cuadro.ganadorFuera * 100)} % de quien gana fuera de lo que se ve`);
    if (cuadro.ganadorTapado > MAX_GANADOR_TAPADO) f.push(`el cartel tapa ${Math.round(cuadro.ganadorTapado * 100)} % de quien gana`);
  }
  if (cuadro.cartelFuera > MAX_CARTEL_FUERA) f.push(`el cartel se sale ${Math.round(cuadro.cartelFuera)} px de la pantalla`);
  return f;
}

/**
 * Corre adentro de la página, una vez por cuadro de juego. Necesita
 * `window.__tinkazo` (`?auditar=camara`, `src/games/pixi/stage.ts`): la
 * cámara y la escena. Guarda en `window.__zoom` el plano general (la escala
 * más chica mientras no hubo golpe), la escala más alta en el medio segundo
 * del golpe, y cuándo terminó el show (el estadio se cierra).
 */
export function instalarZoom() {
  const Z = { minAntes: Infinity, enGolpe: 0, golpe: null, muestras: 0, vio: false, fin: false, cuadros: 0 };
  // Lo mismo que `VENTANA_CUADRO` y `DESDE_CARTEL`, a mano: esto corre adentro de la página.
  Z.cuadro = { n: 0, sinGanador: 0, ganadorFuera: 0, ganadorTapado: 0, cartelFuera: 0 };
  Z.enCuadro = (T, dt) => {
    const P = T.pantalla ? T.pantalla() : { w: window.innerWidth, h: window.innerHeight, top: 0, bottom: 0 };
    const c = Z.cuadro;
    c.n++;
    const b = T.ganador ? T.ganador() : null;
    const pl = T.cartel ? T.cartel() : null;
    if (pl) c.cartelFuera = Math.max(c.cartelFuera, -pl.x, pl.x + pl.w - P.w);
    if (!b || !(b.w > 0) || !(b.h > 0)) {
      c.sinGanador++;
      return;
    }
    const dw = Math.max(0, Math.min(b.x + b.w, P.w) - Math.max(b.x, 0));
    const dh = Math.max(0, Math.min(b.y + b.h, P.h - P.bottom) - Math.max(b.y, P.top));
    c.ganadorFuera = Math.max(c.ganadorFuera, 1 - (dw * dh) / (b.w * b.h));
    if (pl && dt >= 0.35) {
      const ow = Math.max(0, Math.min(b.x + b.w, pl.x + pl.w) - Math.max(b.x, pl.x));
      const oh = Math.max(0, Math.min(b.y + b.h, pl.y + pl.h) - Math.max(b.y, pl.y));
      c.ganadorTapado = Math.max(c.ganadorTapado, (ow * oh) / (b.w * b.h));
    }
  };
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
        if (t >= g && t <= g + 1.2) Z.enCuadro(T, t - g);
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
