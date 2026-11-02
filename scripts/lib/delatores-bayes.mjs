/**
 * El adivinador completo de la recta (`audit-delatores race`).
 *
 * Los repartos de `delatores-carrera.mjs` miran un momento de la recta a la vez:
 * dónde va la ganadora a un cuarto, a la mitad, a tres cuartos. Pero el camino
 * entero delata más que cada puesto suelto: con 18 personas, cada puesto era
 * parejo (de 12,0 a 13,0 %) y mirando los puestos de la recta hasta el 50 %
 * se acertaba el 38,7 % (el azar es 12,5 %) y hasta el 75 %, el 63,4 %.
 *
 * Acá un adivinador (Bayes ingenuo sobre el camino) mira los puestos de cada
 * carril en `qs`, aprende con rondas de entrenamiento cuáles caminos son de la
 * ganadora y cuáles no, y después apuesta en rondas que no vio. Sin señal,
 * acierta como el azar (1 / carriles). El umbral es el azar más tres errores
 * estándar de la prueba: con 8 carriles y 20.000 rondas, 13,2 %.
 *
 * El control cambia la ganadora por un carril cualquiera: tiene que dar el azar,
 * y si no, la medida está torcida y no vale.
 *
 * El auditor de arco (`medirArcos`) mira el otro lado: el arco que cuenta la carrera se nombra por cómo termina, así que tiene que variar
 * (`arcosEntre`: con ocho carriles, ninguno por debajo del 8 % ni por encima del 45 %: si no, el cartel y la cámara se repiten) y no puede decir antes del 88 % quién gana
 * (chi cuadrado entre el arco y el puesto de la ganadora a la entrada, a un cuarto y a la mitad).
 *
 * Es función de un `planDe(i)` que devuelve `{ pos(k, q), L, kw }`: la recta de
 * la ronda `i` y el carril de la ganadora. Sin `Math.random`.
 */

import { chi2sf } from "./delatores.mjs";

/** Los momentos de la recta que mira el adivinador, de la entrada al ataque. */
export const QS = [0.067, 0.25, 0.5, 0.75, 0.88];

/** Los puestos de cada carril en `q` (1 es el primero). */
export function puestos(p, q) {
  const xs = Array.from({ length: p.L }, (_, k) => p.pos(k, q));
  return xs.map((x, k) => 1 + xs.filter((v, j) => j !== k && v > x).length);
}

/** El umbral de la prueba: el azar más tres errores estándar. */
export const umbralBayes = (L, probar) => 1 / L + 3 * Math.sqrt(((1 / L) * (1 - 1 / L)) / probar);

/**
 * Mide qué acierta el adivinador mirando hasta cada momento de `qs`.
 * `planDe(i)` es la recta de la ronda `i`; las de entrenamiento y las de prueba no se cruzan.
 */
export function medirBayes(planDe, { L, qs = QS, entrenar = 60000, probar = 20000, desde = 0 } = {}) {
  const prefijos = qs.map((_, a) => Array.from({ length: a + 1 }, (_, i) => i));
  const clave = (M, k, idx) => idx.map((j) => M[j][k]).join(",");
  const tablas = prefijos.map(() => new Map());
  const total = [0, 0];
  const fila = (p) => qs.map((q) => puestos(p, q));
  for (let i = desde; i < desde + entrenar; i++) {
    const p = planDe(i);
    const M = fila(p);
    for (let k = 0; k < L; k++) {
      const g = k === p.kw ? 0 : 1;
      total[g]++;
      prefijos.forEach((idx, a) => {
        const c = clave(M, k, idx);
        const v = tablas[a].get(c) ?? [0, 0];
        v[g]++;
        tablas[a].set(c, v);
      });
    }
  }
  const razon = (a, c) => {
    const v = tablas[a].get(c) ?? [0, 0];
    const K = tablas[a].size || 1;
    return (v[0] + 1) / (total[0] + K) / ((v[1] + 1) / (total[1] + K));
  };
  const ok = prefijos.map(() => 0);
  // Control: la misma tabla con una ganadora falsa (el carril de al lado de la verdadera, sorteado por la ronda).
  const ctl = new Map();
  const tctl = [0, 0];
  const falsa = (i) => (Math.imul(i + 1, 2654435761) >>> 7) % L;
  const tope = Math.min(entrenar, 20000);
  for (let i = desde; i < desde + tope; i++) {
    const p = planDe(i);
    const M = fila(p);
    const kf = falsa(i);
    for (let k = 0; k < L; k++) {
      const g = k === kf ? 0 : 1;
      tctl[g]++;
      const c = clave(M, k, prefijos[prefijos.length - 1]);
      const v = ctl.get(c) ?? [0, 0];
      v[g]++;
      ctl.set(c, v);
    }
  }
  let okCtl = 0;
  let nCtl = 0;
  const pruebaCtl = Math.min(probar, 8000);
  for (let i = desde + entrenar; i < desde + entrenar + probar; i++) {
    const p = planDe(i);
    const M = fila(p);
    prefijos.forEach((idx, a) => {
      let mejor = -1;
      let mv = -1;
      for (let k = 0; k < L; k++) {
        const v = razon(a, clave(M, k, idx)) + k * 1e-12;
        if (v > mv) {
          mv = v;
          mejor = k;
        }
      }
      if (mejor === p.kw) ok[a]++;
    });
    if (i - (desde + entrenar) < pruebaCtl) {
      const kf = falsa(i);
      let mejor = -1;
      let mv = -1;
      const idx = prefijos[prefijos.length - 1];
      for (let k = 0; k < L; k++) {
        const v0 = ctl.get(clave(M, k, idx)) ?? [0, 0];
        const v = (v0[0] + 1) / (tctl[0] + ctl.size) / ((v0[1] + 1) / (tctl[1] + ctl.size)) + k * 1e-12;
        if (v > mv) {
          mv = v;
          mejor = k;
        }
      }
      nCtl++;
      if (mejor === kf) okCtl++;
    }
  }
  return {
    L,
    entrenar,
    probar,
    azar: 1 / L,
    umbral: umbralBayes(L, probar),
    hasta: qs.map((q, a) => ({ q, acierto: ok[a] / probar })),
    control: okCtl / Math.max(1, nCtl),
  };
}

/**
 * Lo que se pide a la variedad de arcos: con seis carriles o más, cada uno entre el 8 y el 45 % de las rondas; con menos hay menos
 * arcos posibles (la tapada necesita tres de adelante) y la llegada apretada es más rara (con dos, una de cada diecisiete).
 */
export const arcosEntre = (L) => (L >= 6 ? [0.08, 0.45] : L >= 3 ? [0.05, 0.65] : [0.04, 0.55]);

/**
 * El auditor de arco. `planDe(i)` devuelve además `arco` (el de la historia). Mide cuánto aparece cada arco y si el arco
 * depende del puesto de la ganadora antes del acordeón (no debe: p ≥ 0,001; desde el 70 % las posiciones ya se acercan al orden del
 * acordeón y el arco, que sale de él, se les parece sin que nadie delate nada: se miran la entrada, el 25 % y la mitad).
 */
export function medirArcos(planDe, { L, rondas = 20000, antes = [0.067, 0.25, 0.5] } = {}) {
  const arcos = new Map();
  const tablas = antes.map(() => new Map());
  for (let i = 0; i < rondas; i++) {
    const p = planDe(i);
    arcos.set(p.arco, (arcos.get(p.arco) ?? 0) + 1);
    antes.forEach((q, j) => {
      const puesto = puestos(p, q)[p.kw];
      const t = tablas[j];
      const fila = t.get(p.arco) ?? new Array(L).fill(0);
      fila[puesto - 1]++;
      t.set(p.arco, fila);
    });
  }
  const reparto = [...arcos].map(([arco, n]) => ({ arco, parte: n / rondas }));
  const independencia = antes.map((q, j) => {
    const filas = [...tablas[j].values()];
    const colTot = Array.from({ length: L }, (_, c) => filas.reduce((a, f) => a + f[c], 0));
    const filaTot = filas.map((f) => f.reduce((a, b) => a + b, 0));
    let chi = 0;
    filas.forEach((f, r) => f.forEach((v, c) => {
      const esp = (filaTot[r] * colTot[c]) / rondas;
      if (esp > 0) chi += (v - esp) ** 2 / esp;
    }));
    const gl = (filas.length - 1) * (L - 1);
    return { q, chi, gl, p: gl > 0 ? chi2sf(chi, gl) : 1 };
  });
  const [lo, hi] = arcosEntre(L);
  const varia = reparto.length >= (L >= 3 ? 3 : 2) && reparto.every((x) => x.parte >= lo && x.parte <= hi);
  return { L, rondas, reparto, independencia, varia };
}
