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
 *
 * Con `tamano: false` la regla no tiene que ser además grande (1,25 veces el
 * azar): delata con solo salir de la casualidad. Es lo que se usa a nivel del
 * plan, donde con 1.500 rondas se mide tan fino que un desvío chico y real ya
 * se ve, y no hay que esconderlo.
 */
export function veredicto(r, m = 1, { tamano = true } = {}) {
  if (!r || r.n < UMBRAL.minimo) return { veredicto: "pocos", p: 1, sentido: null };
  const arriba = r.pArriba <= r.pAbajo;
  const p = Math.min(1, 2 * Math.max(1, m) * Math.min(r.pArriba, r.pAbajo));
  const grande = !tamano || (arriba ? r.lift >= UMBRAL.arriba : r.lift <= UMBRAL.abajo);
  const sentido = arriba ? "arriba" : "abajo";
  if (grande && p < UMBRAL.alfa) return { veredicto: "delator", p, sentido };
  if (grande && p < UMBRAL.mirar) return { veredicto: "mirar", p, sentido };
  return { veredicto: "limpia", p, sentido };
}

/**
 * Una señal con su familia de reglas: `{ nombreDeRegla: obs[] }`. Mide cada
 * regla, se queda con la más extrema (la de menor probabilidad por azar, en
 * cualquiera de las dos colas) y la juzga con la corrección por las `m`
 * reglas. Las reglas sin datos no cuentan en `m`. `opciones` son las de
 * `veredicto`.
 */
export function evaluarSenal(familia, opciones = {}) {
  const reglas = Object.entries(familia)
    .map(([nombre, obs]) => ({ nombre, ...evaluarRegla(obs) }))
    .filter((r) => r.n > 0);
  if (!reglas.length) return { reglas: [], mejor: null, m: 0, veredicto: "pocos", p: 1, sentido: null };
  const m = reglas.length;
  // Solo compiten las que tienen datos suficientes; si ninguna llega, se informa la de más datos.
  const juzgables = reglas.filter((r) => r.n >= UMBRAL.minimo);
  const pool = juzgables.length ? juzgables : reglas;
  const mejor = pool.reduce((a, b) => (Math.min(b.pArriba, b.pAbajo) < Math.min(a.pArriba, a.pAbajo) ? b : a));
  return { reglas, mejor, m, ...veredicto(mejor, m, opciones) };
}

/* ===================================================== a nivel del plan */

/** ln Γ(x) (Lanczos, g = 7). */
function lnGamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const y = x - 1;
  const t = y + 7.5;
  let a = c[0];
  for (let i = 1; i < c.length; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** La gamma incompleta regularizada superior Q(a, x): serie si x < a + 1, fracción continua si no. */
function gammaQ(a, x) {
  if (x <= 0) return 1;
  const prefijo = Math.exp(-x + a * Math.log(x) - lnGamma(a));
  if (x < a + 1) {
    let suma = 1 / a;
    let termino = suma;
    for (let k = 1; k < 2000; k++) {
      termino *= x / (a + k);
      suma += termino;
      if (Math.abs(termino) < Math.abs(suma) * 1e-16) break;
    }
    return Math.max(0, 1 - suma * prefijo);
  }
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 2000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return prefijo * h;
}

/**
 * La probabilidad de que el azar dé un chi cuadrado de `x` o más con `gl`
 * grados de libertad. Con `gl = 1` es la cola de los dos lados de una normal
 * (`z² = x`).
 */
export const chi2sf = (x, gl) => (gl >= 1 ? gammaQ(gl / 2, x / 2) : 1);

/** La cola de los dos lados de una normal estándar, para un `z`. */
export const colaNormal = (z) => chi2sf(z * z, 1);

/** `delator`, `mirar` o `limpia` por la probabilidad sola, con el umbral de siempre. */
export const veredictoP = (p) => (p < UMBRAL.alfa ? "delator" : p < UMBRAL.mirar ? "mirar" : "limpia");

/**
 * Un reparto: en cuál de `K` casilleros cae la ganadora (el puesto con que
 * entra a la recta, su tanda, su lugar en el portón), contra el reparto parejo
 * (o contra `probs`, si los casilleros no son iguales: tandas de 16 y de 15).
 *
 * Chi cuadrado con **K − 1 grados de libertad**: con ocho casilleros el crítico
 * a 1 en 1000 es 24,3; con tres, 13,8; con cuatro, 16,3. Contar los grados de
 * libertad de otro reparto deja pasar un desvío o inventa uno. Con menos de
 * cinco esperados en algún casillero la aproximación no vale: pocos datos.
 *
 * `mas` es el casillero que más se aleja de lo esperado (en desvíos).
 */
export function evaluarReparto(conteos, probs = null) {
  const K = conteos.length;
  const n = conteos.reduce((a, b) => a + b, 0);
  const pr = probs ?? Array.from({ length: K }, () => 1 / K);
  const esperados = pr.map((q) => n * q);
  const gl = K - 1;
  const chi2 = esperados.reduce((s, e, i) => (e > 0 ? s + (conteos[i] - e) ** 2 / e : s), 0);
  const alcanza = K >= 2 && n >= UMBRAL.minimo && esperados.every((e) => e >= 5);
  const p = alcanza ? Math.min(1, chi2sf(chi2, gl)) : 1;
  let mas = null;
  esperados.forEach((e, i) => {
    const desvio = e > 0 ? (conteos[i] - e) / Math.sqrt(e * (1 - pr[i])) : 0;
    if (!mas || Math.abs(desvio) > Math.abs(mas.desvio)) mas = { indice: i, observado: conteos[i], esperado: e, veces: e > 0 ? conteos[i] / e : 1, desvio };
  });
  return { n, K, gl, chi2, p, conteos, esperados, mas, veredicto: alcanza ? veredictoP(p) : "pocos" };
}

/**
 * Un promedio que, sin señal, vale `media0` (cero): la diferencia entre el
 * tiempo en la punta de la ganadora y el de las otras finalistas, o una
 * correlación estandarizada. `sd` es el desvío si se conoce de antemano; si
 * no, el de la muestra (y hacen falta 30 rondas). Prueba z de los dos lados.
 */
export function evaluarMedia(valores, { media0 = 0, sd = null } = {}) {
  const v = valores.filter(Number.isFinite);
  const n = v.length;
  const media = n ? v.reduce((a, b) => a + b, 0) / n : 0;
  const de = sd ?? (n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - media) ** 2, 0) / (n - 1)) : 0);
  const minimo = sd == null ? Math.max(UMBRAL.minimo, 30) : UMBRAL.minimo;
  const alcanza = n >= minimo && de > 0;
  const z = alcanza ? (media - media0) / (de / Math.sqrt(n)) : 0;
  const p = alcanza ? colaNormal(z) : 1;
  return { n, media, de, z, p, veredicto: alcanza ? veredictoP(p) : "pocos" };
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
