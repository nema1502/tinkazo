/**
 * La escala de la carrera de llamas contra lo que pide la dirección (sección 4): cuántos
 * píxeles de alto miden las llamas en pantalla y cuánto de la pantalla tapa la tarjeta de nombres. Lo usa
 * `scripts/medir-escala-carrera.mjs`. Puro: trabaja con lo que la carrera anota con `?auditar=encuadre` (`window.__encuadre`,
 * ver `carrera.ts`), que sale del estado del motor y no de mirar la imagen.
 *
 * De dónde sale cada número:
 *
 * - **El alto de una llama** es el alto de su caja en la pantalla, en píxeles de la página. En el 2D, el cuerpo de la
 *   llama (de las orejas a la sombra) por el acercamiento de la cámara de ese cuadro; en el 3D, de la cabeza al pie por la
 *   cámara de ese cuadro. Cuenta solo la que está a la vista (el centro de su caja adentro de la pantalla).
 * - **La recta** es de que la cámara la tiene en plano (un segundo después de que se abre) hasta que empieza el cabeza a cabeza
 *   (T − 3 s, con T el instante en que cruza la ganadora). **Los últimos 3 s** son de ahí a T, y se miran las tres de más
 *   adelante (el grupo de punta). **El festejo** es desde un segundo después del golpe, con la cámara ya quieta.
 * - **La tarjeta de nombres** es el rectángulo de su fondo mientras se ve; se mide qué parte de la pantalla ocupa.
 *
 * Qué no mide: que la tarjeta no pise a ninguna llama (las cajas de las llamas solo se anotan desde la recta, y la tarjeta
 * está antes) y cuánto dura a tamaño entero.
 */

/** Cuántos píxeles de alto pide la dirección, por pantalla: en 1080 y en el celular parado. */
export const METAS_ESCALA = {
  proyector: { rectaMediana: 150, rectaMinimo: 100, finalMin: 200, finalMax: 450, festejo: 300 },
  celular: { rectaMediana: 70 },
};
/** Cuánto de la pantalla puede tapar la tarjeta de nombres en el celular. */
export const TARJETA_MAXIMA = 0.25;
/** El segundo de la recta en que la cámara todavía llega y no se mide. */
export const LLEGADA_RECTA = 1;
/** Los últimos segundos antes de la meta: el cabeza a cabeza. */
export const CABEZA_A_CABEZA = 3;
/** Desde cuántos segundos después del golpe se mide el festejo. */
export const FESTEJO_DESDE = 1;
/** Cuántas del frente cuentan en los últimos 3 s. */
export const GRUPO_DE_PUNTA = 3;

const cuantil = (xs, q) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(q * o.length)))];
};

/** ¿La caja `[x, y, w, h]` tiene su centro adentro de la pantalla? */
export const aLaVista = (caja, w, h) => !!caja && caja[0] + caja[2] / 2 >= 0 && caja[0] + caja[2] / 2 <= w && caja[1] + caja[3] / 2 >= 0 && caja[1] + caja[3] / 2 <= h;

/**
 * Los altos de las llamas, por tramo.
 *
 * @param muestras  `window.__encuadre.muestras`: `{ tj, t, fase, cajas, narices }` (las de la recta en adelante traen `cajas`)
 * @param plan      `{ tAbre, tCrown, ganadora, w, h }`: la ganadora es el carril
 * @returns `{ recta, porLlama, final, festejo, sinVer, cuadros }`: listas de píxeles, y cuántas cajas no se veían
 */
export function alturasPorTramo(muestras, { tAbre, tCrown, ganadora, w, h }) {
  const recta = [];
  const porLlama = [];
  const final = [];
  const festejo = [];
  let sinVer = 0;
  let cuadros = 0;
  for (const m of muestras) {
    if (!Array.isArray(m.cajas)) continue;
    cuadros++;
    if (m.tj >= tAbre + LLEGADA_RECTA && m.tj < tCrown - CABEZA_A_CABEZA) {
      m.cajas.forEach((c, j) => {
        if (!aLaVista(c, w, h)) return void sinVer++;
        recta.push(c[3]);
        (porLlama[j] ??= []).push(c[3]);
      });
    } else if (m.tj >= tCrown - CABEZA_A_CABEZA && m.tj < tCrown && Array.isArray(m.narices)) {
      // Las tres de más adelante, por el hocico.
      const orden = m.narices.map((x, j) => [x, j]).sort((a, b) => b[0] - a[0]).slice(0, GRUPO_DE_PUNTA);
      for (const [, j] of orden) {
        if (aLaVista(m.cajas[j], w, h)) final.push(m.cajas[j][3]);
        else sinVer++;
      }
    } else if (m.fase === "corona" && m.t >= FESTEJO_DESDE) {
      const c = m.cajas[ganadora];
      if (aLaVista(c, w, h)) festejo.push(c[3]);
      else sinVer++;
    }
  }
  return { recta, porLlama, final, festejo, sinVer, cuadros };
}

/** Mediana, mínimo y percentil 5 de una lista de píxeles. */
export const estadisticas = (xs) => ({ n: xs.length, mediana: cuantil(xs, 0.5), minimo: xs.length ? Math.min(...xs) : null, p05: cuantil(xs, 0.05), maximo: xs.length ? Math.max(...xs) : null });

/**
 * Qué parte de la pantalla ocupa la tarjeta de nombres en cada muestra en que se ve, y cuánto tiempo pasa de la parte máxima.
 *
 * @returns `{ visible, maximo, segundosSobre, segundosVisible }`: el mayor por ciento (0 a 1) y los segundos de juego en que
 *          supera `TARJETA_MAXIMA` y en que se ve, con el tiempo entre muestras tomado de `tj`
 */
export function tarjetaEnPantalla(muestras, w, h, tope = TARJETA_MAXIMA) {
  const area = w * h;
  let maximo = 0;
  let segundosSobre = 0;
  let segundosVisible = 0;
  let visible = 0;
  for (let i = 0; i < muestras.length; i++) {
    const m = muestras[i];
    if (!Array.isArray(m.tarjeta)) continue;
    // Solo lo que cae adentro de la pantalla tapa algo.
    const [x, y, tw, th] = m.tarjeta;
    const ix = Math.max(0, Math.min(x + tw, w) - Math.max(x, 0));
    const iy = Math.max(0, Math.min(y + th, h) - Math.max(y, 0));
    const parte = (ix * iy) / area;
    visible++;
    maximo = Math.max(maximo, parte);
    const dt = (muestras[i + 1]?.tj ?? m.tj) - m.tj;
    const paso = dt > 0 && dt <= 1 ? dt : 0;
    segundosVisible += paso;
    if (parte > tope + 1e-9) segundosSobre += paso;
  }
  return { visible, maximo, segundosSobre, segundosVisible };
}

const px = (v) => (v === null || v === undefined ? "sin medir" : `${Math.round(v)} px`);
const pct = (v) => `${(v * 100).toFixed(1).replace(".", ",")} %`;

/**
 * Las metas de una pantalla. `vista` es `proyector` (1080) o `celular`; `a` son las alturas juntas de todas las corridas
 * (`estadisticas` de cada tramo) y `t` la tarjeta (el mayor por ciento de todas las corridas).
 */
export function evaluarEscala(vista, a, t = null) {
  const filas = [];
  const m = METAS_ESCALA[vista];
  const fila = (clave, nombre, valor, texto, meta, ok) => filas.push({ clave, nombre, valor, texto, meta, ok: valor !== null && valor !== undefined && ok });
  fila("rectaMediana", "alto de las finalistas en la recta (mediana)", a.recta.mediana, px(a.recta.mediana), `${m.rectaMediana} px o más`, a.recta.mediana >= m.rectaMediana);
  if (vista === "proyector") {
    fila("rectaMinimo", "alto de las finalistas en la recta (la más chica de todas)", a.recta.minimo, `${px(a.recta.minimo)} (el 5 % más chico: ${px(a.recta.p05)})`, `ninguna bajo ${m.rectaMinimo} px`, a.recta.minimo >= m.rectaMinimo);
    fila("final", "alto de las tres de punta en los últimos 3 s (mediana)", a.final.mediana, px(a.final.mediana), `de ${m.finalMin} a ${m.finalMax} px`, a.final.mediana >= m.finalMin && a.final.mediana <= m.finalMax);
    fila("festejo", "alto de la ganadora en el festejo (mediana)", a.festejo.mediana, px(a.festejo.mediana), `${m.festejo} px o más`, a.festejo.mediana >= m.festejo);
  }
  if (t) fila("tarjeta", "pantalla que tapa la tarjeta de nombres (el mayor por ciento)", t.maximo, `${pct(t.maximo)}${t.segundosSobre ? `, ${t.segundosSobre.toFixed(1).replace(".", ",")} s por encima del tope` : ""}`, `${Math.round(TARJETA_MAXIMA * 100)} % o menos`, t.maximo <= TARJETA_MAXIMA + 1e-9);
  return filas;
}
