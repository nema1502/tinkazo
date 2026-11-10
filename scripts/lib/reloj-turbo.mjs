/**
 * El reloj en turbo de los auditores con navegador, armado en un solo lugar para las tres medidas de la carrera
 * (`medir-final-carrera.mjs`, `medir-drama-carrera.mjs` y `medir-escala-carrera.mjs`).
 *
 * Es el mismo que usa `audit-emocion.mjs`: la página pide cuadros con `requestAnimationFrame`, y acá cada cuadro real
 * despacha hasta `lote` cuadros de juego, de 1/64 s cada uno (exacto en binario), con `performance.now()` en la hora
 * virtual. Toda la animación es función del tiempo de juego, así que el resultado es el mismo que a velocidad normal y un
 * show de un minuto se corre en unos segundos. Lo que se agenda con el reloj del audio o con `setTimeout` no sigue a este
 * reloj: quien mida sonido tiene que mapear las horas (ver `instalarDrama` en `drama-show.mjs`).
 *
 * `instalar`: una función que se corre dentro de la página una vez, con `performance.now` ya en la hora virtual.
 * `muestrear`: una expresión (`"window.__x.muestrear"`) que se llama con la hora virtual en ms después de cada cuadro de juego.
 */
export function relojTurbo({ instalar = null, muestrear = null, lote = 20 } = {}) {
  return `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0;
  const cbs = new Map();
  window.__v = () => virt;
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  ${instalar ? `(${instalar.toString()})();` : ""}
  const bombear = () => {
    for (let i = 0; i < ${lote} && cbs.size; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      for (const cb of lote) { try { cb(virt); } catch (e) { window.__errores = (window.__errores || 0) + 1; } }
      ${muestrear ? `try { ${muestrear}(virt); } catch (e) { window.__errores = (window.__errores || 0) + 1; }` : ""}
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;
}

/** Un cuadro de juego, en segundos: lo que resuelve cualquier medida con este reloj. */
export const CUADRO_S = 1 / 64;
