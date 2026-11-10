/**
 * Medidas de una señal de audio ya grabada o renderizada, sin navegador.
 *
 * Son las mismas que mide `audit-mezcla.mjs` adentro de la página (sonoridad con la ponderación K de ITU-R BS.1770,
 * pico real sobremuestreado, lo que se pierde en un parlante que corta los graves), más las que necesitan las
 * candidatas de sonido de la carrera: el silencio, el nivel de una ventana y cuánta energía hay en una banda.
 * Trabaja con `Float32Array` por canal; los WAV de 16 bits se leen y escriben acá.
 */

/** Lee un WAV de 16 bits y dos canales. */
export function leerWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("no es un WAV");
  let p = 12;
  let sr = 0, canales = 0, datos = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const tam = buf.readUInt32LE(p + 4);
    if (id === "fmt ") {
      canales = buf.readUInt16LE(p + 10);
      sr = buf.readUInt32LE(p + 12);
      if (buf.readUInt16LE(p + 22) !== 16) throw new Error("solo WAV de 16 bits");
    } else if (id === "data") {
      datos = buf.subarray(p + 8, p + 8 + tam);
      break;
    }
    p += 8 + tam + (tam % 2);
  }
  if (!datos || !sr) throw new Error("WAV sin datos");
  const n = Math.floor(datos.length / (2 * canales));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = datos.readInt16LE(i * 2 * canales) / 32768;
    R[i] = canales > 1 ? datos.readInt16LE(i * 2 * canales + 2) / 32768 : L[i];
  }
  return { sr, L, R };
}

/** Escribe un WAV de 16 bits y dos canales. */
export function escribirWav(L, R, sr) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/** La ponderación K de BS.1770 para cualquier frecuencia de muestreo (los coeficientes de libebur128). */
export function ponderarK(x, sr) {
  let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const s1 = biquad(x, (Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  return biquad(s1, 1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
}

/** Un paso alto de segundo orden (Butterworth): el parlante de una sala chica corta los graves en `fc`. */
export function pasoAlto(x, sr, fc) {
  const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const a0 = 1 + al;
  return biquad(x, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0);
}

const potencia = (a, b, i0, i1) => {
  let s = 0;
  for (let i = i0; i < i1; i++) s += a[i] * a[i] + b[i] * b[i];
  return s / Math.max(1, i1 - i0);
};
const lufs = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));

/** Sonoridad integrada de dos canales ya ponderados: bloques de 400 ms al 75 % y las dos compuertas. */
export function integrada(ka, kb, sr) {
  const blk = Math.round(0.4 * sr), paso = Math.round(0.1 * sr);
  const ps = [];
  for (let i = 0; i + blk <= ka.length; i += paso) ps.push(potencia(ka, kb, i, i + blk));
  const abs = ps.filter((p) => lufs(p) > -70);
  if (!abs.length) return -70;
  const m0 = abs.reduce((x, y) => x + y, 0) / abs.length;
  const rel = abs.filter((p) => lufs(p) > lufs(m0) - 10);
  return lufs(rel.reduce((x, y) => x + y, 0) / Math.max(1, rel.length));
}

/** La sonoridad más alta en ventanas de `ventanaS` segundos cada `pasoS`: momentánea (0,4) o de corto plazo (3). */
export function sonoridadMaxima(ka, kb, sr, ventanaS = 0.4, pasoS = 0.1) {
  let max = -70;
  const w = Math.min(ka.length, Math.round(ventanaS * sr));
  for (let i = 0; i + w <= ka.length; i += Math.round(pasoS * sr)) max = Math.max(max, lufs(potencia(ka, kb, i, i + w)));
  return max;
}

/** La sonoridad (LUFS) de un tramo [t0, t1) en segundos, sin compuertas. */
export function sonoridadDeTramo(ka, kb, sr, t0, t1) {
  const i0 = Math.max(0, Math.round(t0 * sr)), i1 = Math.min(ka.length, Math.round(t1 * sr));
  return lufs(potencia(ka, kb, i0, Math.max(i0 + 1, i1)));
}

/** Pico de muestra, muestras en 1 y pico real (sobremuestreado ×4, sinc con ventana de Hann), en amplitud lineal. */
export function picos(L, R) {
  let pico = 0, recortes = 0;
  for (const x of [L, R]) for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]);
    if (v > pico) pico = v;
    if (v >= 1) recortes++;
  }
  const TAPS = 32, fases = 4;
  const h = [];
  for (let f = 1; f < fases; f++) {
    const hf = [];
    for (let t = -TAPS / 2; t < TAPS / 2; t++) {
      const xx = t + f / fases;
      const sinc = Math.sin(Math.PI * xx) / (Math.PI * xx);
      const win = 0.5 + 0.5 * Math.cos((Math.PI * xx) / (TAPS / 2));
      hf.push(sinc * win);
    }
    h.push(hf);
  }
  let picoReal = pico;
  for (const x of [L, R]) {
    for (let i = TAPS; i < x.length - TAPS; i++) {
      if (Math.abs(x[i]) < pico * 0.7) continue;
      for (const hf of h) {
        let s = 0;
        for (let t = 0; t < TAPS; t++) s += hf[t] * x[i - TAPS / 2 + t + 1];
        picoReal = Math.max(picoReal, Math.abs(s));
      }
    }
  }
  return { pico, picoReal, recortes };
}

export const aDb = (v) => (v > 0 ? 20 * Math.log10(v) : -120);

/** Todas las medidas de sonoridad de una señal. */
export function medirSenal(L, R, sr) {
  const ka = ponderarK(L, sr), kb = ponderarK(R, sr);
  const I = integrada(ka, kb, sr);
  const momentanea = sonoridadMaxima(ka, kb, sr, 0.4, 0.1);
  const corto = sonoridadMaxima(ka, kb, sr, 3, 0.5);
  const { pico, picoReal, recortes } = picos(L, R);
  const sinGraves = (fc) => {
    const a = ponderarK(pasoAlto(L, sr, fc), sr), b = ponderarK(pasoAlto(R, sr, fc), sr);
    return { I: integrada(a, b, sr), momentanea: sonoridadMaxima(a, b, sr, 0.4, 0.1) };
  };
  const s150 = sinGraves(150), s300 = sinGraves(300);
  return {
    seg: L.length / sr,
    I,
    momentanea,
    corto,
    picoDb: aDb(pico),
    picoRealDb: aDb(picoReal),
    recortes,
    // Lo que se pierde, en LU, si el parlante corta los graves. Para una pieza corta se mira la sonoridad momentánea más alta, que
    // es la que se oye; para una larga, la integrada.
    pierde150: I - s150.I,
    pierde300: I - s300.I,
    pierde150Momentanea: momentanea - s150.momentanea,
    pierde300Momentanea: momentanea - s300.momentanea,
  };
}

/** El nivel más alto, en dBFS, de una ventana [t0, t1) en segundos: cuánto suena de verdad durante un silencio. */
export function nivelMaximoDeTramo(L, R, sr, t0, t1) {
  const i0 = Math.max(0, Math.round(t0 * sr)), i1 = Math.min(L.length, Math.round(t1 * sr));
  let m = 0;
  for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(L[i]), Math.abs(R[i]));
  return aDb(m);
}

/* ------------------------------------------------------------------- espectro */

/** FFT de potencia de 2 muestras, en el lugar. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * La energía de la señal repartida por bandas: promedia el espectro de potencia de ventanas de 4096 muestras (Hann, al 50 %)
 * de los dos canales sumados. Devuelve la fracción de la energía total que cae entre `f0` y `f1`, y entre 0 y `f0`.
 */
export function energiaEnBanda(L, R, sr, f0, f1) {
  const N = 4096;
  const w = new Float32Array(N);
  for (let i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const pot = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  let ventanas = 0;
  for (let i0 = 0; i0 + N <= L.length; i0 += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = ((L[i0 + i] + R[i0 + i]) / 2) * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pot[k] += re[k] * re[k] + im[k] * im[k];
    ventanas++;
  }
  if (!ventanas) return { enBanda: 0, debajo: 0, total: 0 };
  const df = sr / N;
  let total = 0, enBanda = 0, debajo = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = k * df;
    total += pot[k];
    if (f >= f0 && f < f1) enBanda += pot[k];
    if (f < f0) debajo += pot[k];
  }
  return { enBanda: total ? enBanda / total : 0, debajo: total ? debajo / total : 0, total };
}

/** Quita el silencio del principio y del final de una señal (bajo `umbralDb`), para medir solo lo que suena. Devuelve los índices. */
export function tramoQueSuena(L, R, umbralDb = -60) {
  const u = Math.pow(10, umbralDb / 20);
  let a = 0, b = L.length;
  while (a < b && Math.abs(L[a]) < u && Math.abs(R[a]) < u) a++;
  while (b > a && Math.abs(L[b - 1]) < u && Math.abs(R[b - 1]) < u) b--;
  return [a, b];
}

/** Aplica una ganancia en dB a las dos señales. */
export function conGanancia(L, R, dB) {
  const g = Math.pow(10, dB / 20);
  return [L.map((v) => v * g), R.map((v) => v * g)];
}
