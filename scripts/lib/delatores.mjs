/**
 * La estadística del auditor de delatores (`scripts/audit-delatores.mjs`), sin
 * navegador.
 *
 * Un delator es algo que se ve durante el show y adivina al ganador más que el
 * azar: quién va adelante a mitad de carrera, a quién se nombra primero, dónde
 * frena la cámara. Si una señal delata, la sala aprende el final y el juego
 * pierde la duda (auditoría de los juegos, sección 8.7).
 *
 * Cada señal se mide como una **regla de apuesta**: en cada semilla, en el
 * momento en que la señal se ve, la regla apuesta por un grupo `G` de los que
 * siguen en juego `C` ("la que va primera", "el que nombraron primero", "los
 * dos del costado izquierdo"). Acierta si el ganador está en `G`. Si la señal
 * no supiera nada, acertaría con probabilidad `|G| / |C|`: eso es el azar de
 * esa semilla. Como `C` cambia de una semilla a otra (con oleadas, con
 * eliminados), cada semilla tiene su propio azar, y el total de aciertos sigue
 * una distribución binomial de Poisson: la suma de monedas con distinta
 * probabilidad. Con eso se calcula, exacto, qué tan raro sería acertar tanto
 * (o tan poco) por casualidad.
 *
 * El umbral está fijado antes de correr nada (sección 8.7: "el umbral, fijado
 * antes de correrlo"), y está en `UMBRAL`.
 */

/**
 * El umbral, fijo.
 *
 * - **`alfa`: 0,001.** Una señal es delatora si el azar solo produce un desvío
 *   así de fuerte menos de una vez en mil. Con doce juegos y unas veinte
 *   señales por juego son unas doscientas cuarenta pruebas, y con este umbral
 *   se espera, por pura casualidad, una falsa alarma cada cuatro corridas
 *   completas: el auditor lo dice al final de cada corrida.
 * - **`mirar`: 0,01.** Entre 0,001 y 0,01 la señal queda "a mirar": no
 *   rechaza, pero vale otra corrida con más semillas.
 * - **`arriba`: 1,25.** Además de raro, tiene que ser grande: la regla acierta
 *   por lo menos un 25% más que el azar. Con doscientas semillas el límite lo
 *   pone casi siempre `alfa` (con ocho corredores hace falta acertar uno de
 *   cada cinco, 1,6 veces el azar), y este margen evita que una diferencia
 *   chica pero muy medida cuente como delator con miles de semillas.
 * - **`abajo`: 0,5.** También delata al revés: si lo que señala la regla gana
 *   la mitad de lo que daría el azar, o menos, la sala aprende a descartarlo
 *   ("el amague nunca es de verdad", "el que nombran en el drama pierde").
 * - **`minimo`: 10.** Con menos observaciones no se juzga: "pocos datos".
 *
 * Cada señal puede tener varias reglas (un puesto por regla, izquierda y
 * derecha). Como se mira la mejor de varias, y en las dos colas, la
 * probabilidad se multiplica por el número de reglas y por dos (Bonferroni):
 * `pFamilia = min(1, 2 · m · p)`.
 */
export const UMBRAL = Object.freeze({ alfa: 0.001, mirar: 0.01, arriba: 1.25, abajo: 0.5, minimo: 10 });

/**
 * La distribución de la cantidad de aciertos cuando cada observación acierta
 * con su propia probabilidad `ps[i]`: `f[k]` es la probabilidad de exactamente
 * `k` aciertos. Programación dinámica, exacta salvo redondeo.
 */
export function distribucion(ps) {
  const f = new Float64Array(ps.length + 1);
  f[0] = 1;
  ps.forEach((p, n) => {
    for (let k = n + 1; k >= 1; k--) f[k] = f[k] * (1 - p) + f[k - 1] * p;
    f[0] *= 1 - p;
  });
  return f;
}

/** P(aciertos ≥ k), por azar. */
export function colaArriba(ps, k) {
  if (k <= 0) return 1;
  const f = distribucion(ps);
  let s = 0;
  for (let j = Math.ceil(k); j < f.length; j++) s += f[j];
  return Math.min(1, s);
}

/** P(aciertos ≤ k), por azar. */
export function colaAbajo(ps, k) {
  if (k >= ps.length) return 1;
  const f = distribucion(ps);
  let s = 0;
  for (let j = 0; j <= Math.floor(k); j++) s += f[j];
  return Math.min(1, s);
}

/** La binomial de siempre, como caso particular: `n` intentos con la misma `p`. */
export const binomialArriba = (n, p, k) => colaArriba(Array.from({ length: n }, () => p), k);

/** El intervalo de Wilson al 95% para una proporción. */
export function wilson(aciertos, n, z = 1.96) {
  if (n <= 0) return [0, 1];
  const p = aciertos / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const r = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - r), Math.min(1, c + r)];
}

/**
 * Una regla, sobre todas las semillas. `obs` es una lista de
 * `{ acierta, azar }`; las de azar 0 o 1 no informan (apostar por nadie o por
 * todos) y no cuentan.
 */
export function evaluarRegla(obs) {
  const validas = obs.filter((o) => o && Number.isFinite(o.azar) && o.azar > 0 && o.azar < 1);
  const n = validas.length;
  const ps = validas.map((o) => o.azar);
  const aciertos = validas.filter((o) => o.acierta).length;
  const esperado = ps.reduce((a, p) => a + p, 0);
  const azar = n ? esperado / n : 0;
  const tasa = n ? aciertos / n : 0;
  return {
    n,
    aciertos,
    esperado,
    tasa,
    azar,
    lift: azar > 0 ? tasa / azar : 1,
    pArriba: n ? colaArriba(ps, aciertos) : 1,
    pAbajo: n ? colaAbajo(ps, aciertos) : 1,
    intervalo: wilson(aciertos, n),
  };
}

/**
 * El veredicto de una regla ya medida, con `m` reglas en su familia.
 * Devuelve `delator`, `mirar`, `limpia` o `pocos`.
 */
export function veredicto(r, m = 1) {
  if (!r || r.n < UMBRAL.minimo) return { veredicto: "pocos", p: 1, sentido: null };
  const arriba = r.pArriba <= r.pAbajo;
  const p = Math.min(1, 2 * Math.max(1, m) * Math.min(r.pArriba, r.pAbajo));
  const grande = arriba ? r.lift >= UMBRAL.arriba : r.lift <= UMBRAL.abajo;
  const sentido = arriba ? "arriba" : "abajo";
  if (grande && p < UMBRAL.alfa) return { veredicto: "delator", p, sentido };
  if (grande && p < UMBRAL.mirar) return { veredicto: "mirar", p, sentido };
  return { veredicto: "limpia", p, sentido };
}

/**
 * Una señal con su familia de reglas: `{ nombreDeRegla: obs[] }`. Mide cada
 * regla, se queda con la más extrema (la de menor probabilidad por azar, en
 * cualquiera de las dos colas) y la juzga con la corrección por las `m`
 * reglas. Las reglas sin datos no cuentan en `m`.
 */
export function evaluarSenal(familia) {
  const reglas = Object.entries(familia)
    .map(([nombre, obs]) => ({ nombre, ...evaluarRegla(obs) }))
    .filter((r) => r.n > 0);
  if (!reglas.length) return { reglas: [], mejor: null, m: 0, veredicto: "pocos", p: 1, sentido: null };
  const m = reglas.length;
  // Solo compiten las que tienen datos suficientes; si ninguna llega, se informa la de más datos.
  const juzgables = reglas.filter((r) => r.n >= UMBRAL.minimo);
  const pool = juzgables.length ? juzgables : reglas;
  const mejor = pool.reduce((a, b) => (Math.min(b.pArriba, b.pAbajo) < Math.min(a.pArriba, a.pAbajo) ? b : a));
  return { reglas, mejor, m, ...veredicto(mejor, m) };
}

/** Cuántas falsas alarmas se esperan por casualidad en una corrida con `senales` señales juzgadas. */
export const falsasAlarmas = (senales) => senales * UMBRAL.alfa;

/** Formato corto de una probabilidad: "0,0004", "<1e-12". */
export function formatoP(p) {
  if (p < 1e-12) return "<1e-12";
  if (p < 0.001) return p.toExponential(1).replace(".", ",");
  return p.toFixed(p < 0.01 ? 4 : 3).replace(".", ",");
}

/** Un porcentaje con coma: "12,5%". */
export const pct = (x) => `${(Math.round(x * 1000) / 10).toString().replace(".", ",")}%`;
