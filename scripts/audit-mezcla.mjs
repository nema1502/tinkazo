#!/usr/bin/env node
/**
 * Auditor de mezcla: lo que de verdad sale por el parlante, medido sin oídos.
 *
 * El auditor de sonido mira la partitura de los efectos (qué nota, cuándo, a
 * qué volumen). Este escucha la señal: engancha la salida de WebAudio antes de
 * que cargue la página, junta las muestras de la escena fija de cada juego, de
 * punta a punta, y mide con las reglas de la radiodifusión (investigación del
 * audio, 4 de octubre de 2026):
 *
 * - **Sonoridad integrada**, en LUFS, con la ponderación K y las compuertas de
 *   ITU-R BS.1770: lo que el oído siente como "fuerte", no el pico. Que los
 *   juegos suenen parejo entre sí, para que quien organiza no toque la perilla
 *   entre un sorteo y otro.
 * - **Nada recorta**: ninguna muestra llega a 1, y el pico real (sobremuestreado
 *   ×4) queda debajo de -1 dBTP, como piden EBU R128 y AES TD1008.
 * - **El parlante de un proyector**: la misma mezcla pasada por un paso alto de
 *   150 y de 300 Hz, que es lo que reproduce una laptop o un proyector. Si al
 *   sacarle los graves pierde mucho, en la sala va a sonar flaca: el bombo y el
 *   bajo tienen que tener armónicos arriba de eso.
 * - **El golpe del ganador**: cuánto más fuerte suena el medio segundo después
 *   de que sale el cartel que el medio segundo antes. Un revelado que no se
 *   distingue de lo que venía sonando no se siente.
 *
 * Los umbrales del parlante y del revelado no tienen norma: salen de la
 * investigación y se calibran con lo que hoy suena bien.
 *
 * Uso (con `pnpm preview` corriendo):
 *   node scripts/audit-mezcla.mjs [juego|todos] [--base http://localhost:4173] [--sin-musica] [--motor pixi] [--espectro]
 *   node scripts/audit-mezcla.mjs race --sonido musica:a,final:b   # la carrera con esas candidatas de sonido (src/sonidos/carrera.ts)
 *   node scripts/audit-mezcla.mjs race --consulta "musica=pistas&pistasdesde=http://127.0.0.1:8796/"   # la carrera con su música de archivo
 *
 * La grabación sale de un AudioWorklet, que corre en el hilo del audio y no pierde bloques cuando la página está
 * ocupada, y todo se cuenta con el reloj del audio. Sigue grabando hasta 2 s después del cartel del ganador; si lo
 * grabado quedó más corto que lo que sonó, o el cartel salió y el golpe no entró, lo dice y mide una vez más.
 * `--motor pixi` mide los juegos en 2D (sin él, lo que ve la sala). `--espectro` muestra cuánto pierde la mezcla con
 * pasos altos de 40 a 300 Hz y cómo se reparte la energía antes y después del cartel.
 *
 * Con `--grabar <carpeta> [--etiqueta antes|despues] [--segundos 20]` guarda también, de cada
 * juego, los segundos que terminan 4 s después del cartel del ganador (o los primeros, si no se vio), de lo que salió por el parlante en `<juego>-<etiqueta>.wav`
 * (16 bits, estéreo), para escuchar lo mismo antes y después de un cambio de sonido.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";
import { juegosDe } from "./lib/juegos.mjs";
import { grabacionCorta, hayQueRepetir, puedeParar } from "./lib/mezcla-captura.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const sinMusica = args.includes("--sin-musica");
// Con `--sonido pieza:candidata,...` la carrera suena con esas candidatas (`src/sonidos/carrera-eleccion.ts`).
const sonidoCarrera = opt("--sonido", "");
// Con `--consulta "musica=pistas&pistasdesde=http://127.0.0.1:8796/"` se suman esos parámetros a la dirección de cada juego
// (por ejemplo, para medir la música de archivo con los archivos servidos desde la máquina de quien mide).
const consulta = opt("--consulta", "").replace(/^[?&]+/, "");
// `--motor pixi` mide los juegos en 2D; sin `--motor`, lo que ve la sala (el motor que la página elige).
const motor = opt("--motor", "");
const espectro = args.includes("--espectro");
const carpetaWav = opt("--grabar", "");
const etiquetaWav = opt("--etiqueta", "despues");
const segundosWav = Number(opt("--segundos", "20"));
/** Un WAV de 16 bits y dos canales con el comienzo de la mezcla. */
function escribirWav(ruta, L, R, sr, seg) {
  const n = Math.min(L.length, Math.round(seg * sr));
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  writeFileSync(ruta, buf);
}
const lista = juegosDe(cual);

/** Los umbrales. */
const PICO_REAL_MAX = -1.0;
const PAREJO_LU = 3.0;
const CORTO_SOBRE_INTEGRADA = 7.0;
// Calibrado con la mezcla de hoy (5 de octubre de 2026): antes de los armónicos
// del bajo y de los bombos se perdían de 4,1 a 4,9 LU, y con ellos de 2,6 a 3,5.
// No hay norma para este número: hay que ajustarlo midiendo parlantes reales.
// 4 de noviembre de 2026: con los osciladores de siempre la carrera perdía de 3,6 a 3,9 LU (el 57 % de la energía
// de la mezcla caía bajo 150 Hz, la cuarta parte entre 60 y 100 Hz: el seno del bombo y el bajo). Con el seno del
// bombo y del bombo electrónico más bajos, y el cuerpo y la sierra del bajo más arriba, pierde de 2,5 a 2,7.
const PIERDE_150 = 3.5;
const PIERDE_300 = 6.0;
const GOLPE_MIN = 2.0;

/**
 * El oído, inyectado antes de que exista la página: la salida del contexto
 * pasa por una ganancia que además alimenta un procesador que copia las
 * muestras. El parlante sigue recibiendo lo mismo.
 */
const OIDO = `(() => {
  const ESPECTRO = ${espectro};
  const AC = window.AudioContext;
  window.__espectro = ESPECTRO;
  const o = window.__mezcla = { L: [], R: [], sr: 0, f0: -1, cartelSeg: -1, juntando: true, listo: false, falla: '' };
  // El oído es un AudioWorklet: corre en el hilo del audio y manda las muestras en trozos de 4096. El ScriptProcessor
  // de antes corría en el hilo de la página y, con la máquina cargada, perdía bloques: la grabación quedaba más corta
  // que el show (36,7 s de 39) y el cartel caía corrido.
  const CODIGO = \`class Oido extends AudioWorkletProcessor {
    constructor() { super(); this.n = 0; this.L = new Float32Array(4096); this.R = new Float32Array(4096); this.f = -1; }
    process(entradas) {
      const c = entradas[0] || [];
      if (this.f < 0) this.f = currentFrame;
      for (let k = 0; k < 128; k++) {
        this.L[this.n] = c[0] ? c[0][k] : 0;
        this.R[this.n] = c[1] ? c[1][k] : c[0] ? c[0][k] : 0;
        if (++this.n === 4096) {
          this.port.postMessage({ L: this.L, R: this.R, f: this.f }, [this.L.buffer, this.R.buffer]);
          this.L = new Float32Array(4096); this.R = new Float32Array(4096); this.n = 0; this.f = -1;
        }
      }
      return true;
    }
  }
  registerProcessor('oido-mezcla', Oido);\`;
  window.AudioContext = function (...a) {
    const ctx = new AC(...a);
    const real = ctx.destination;
    const mezcla = ctx.createGain();
    mezcla.connect(real);
    o.sr = ctx.sampleRate;
    const url = URL.createObjectURL(new Blob([CODIGO], { type: 'text/javascript' }));
    ctx.audioWorklet.addModule(url).then(() => {
      const nodo = new AudioWorkletNode(ctx, 'oido-mezcla', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      const mudo = ctx.createGain();
      mudo.gain.value = 0;
      mezcla.connect(nodo);
      nodo.connect(mudo);
      mudo.connect(real);
      nodo.port.onmessage = (e) => {
        if (!o.juntando) return;
        if (o.f0 < 0) o.f0 = e.data.f;
        o.L.push(e.data.L);
        o.R.push(e.data.R);
      };
      o.listo = true;
    }).catch((err) => { o.falla = String(err); });
    Object.defineProperty(ctx, 'destination', { get: () => mezcla });
    o.ctx = ctx;
    return ctx;
  };
  window.AudioContext.prototype = AC.prototype;
  // Cuándo se revela el ganador, en segundos del reloj del audio: con \`?auditar=mezcla\` el estadio anota la hora de
  // la pared en el primer cuadro del cartel (se pasa a hora del audio restándole lo que pasó desde entonces). Si no
  // está (el motor anterior), cuando el cartel aparece en el lienzo, que es a los 0,6 s de su entrada.
  const mirar = () => {
    const cv = document.getElementById('pixi-canvas') || document.getElementById('race-canvas');
    if (o.cartelSeg < 0 && o.f0 >= 0 && o.ctx) {
      const ahora = o.ctx.currentTime;
      if (window.__revelado !== undefined) o.cartelSeg = ahora - (performance.now() - window.__revelado) / 1000;
      else if (cv && cv.dataset.cartel) o.cartelSeg = ahora - 0.6;
    }
    requestAnimationFrame(mirar);
  };
  requestAnimationFrame(mirar);
  // Para el auditor: cuánto sonó desde que empezó la grabación y cuánto se grabó.
  o.estado = () => ({ listo: o.listo, falla: o.falla, ahora: o.ctx ? o.ctx.currentTime : 0, primerCuadro: o.f0, sr: o.sr, cartelSeg: o.cartelSeg, grabadoSeg: o.L.length * 4096 / (o.sr || 1) });
  o.medir = () => {
    o.juntando = false;
    const une = (xs) => { let n = 0; for (const x of xs) n += x.length; const y = new Float32Array(n); let i = 0; for (const x of xs) { y.set(x, i); i += x.length; } return y; };
    const L = une(o.L), R = une(o.R), sr = o.sr;
    // El cartel, en ms desde el comienzo de lo grabado (el reloj del audio y el de la grabación son el mismo).
    const cartel = o.cartelSeg >= 0 ? (o.cartelSeg - o.f0 / sr) * 1000 : -1;
    const biquad = (x, b0, b1, b2, a1, a2) => {
      const y = new Float32Array(x.length);
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < x.length; i++) {
        const xi = x[i];
        const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
      }
      return y;
    };
    // La ponderación K de BS.1770, para cualquier frecuencia de muestreo (los
    // coeficientes de libebur128).
    const kw = (x) => {
      let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
      let K = Math.tan(Math.PI * f0 / sr);
      const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
      let a0 = 1 + K / Q + K * K;
      const s1 = biquad(x, (Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
      f0 = 38.13547087602444; Q = 0.5003270373238773;
      K = Math.tan(Math.PI * f0 / sr);
      a0 = 1 + K / Q + K * K;
      return biquad(s1, 1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0);
    };
    // Un paso alto de segundo orden (Butterworth): el parlante de una sala chica.
    const pasoAlto = (x, fc) => {
      const w = 2 * Math.PI * fc / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
      const a0 = 1 + al;
      return biquad(x, (1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0);
    };
    // Sonoridad de un tramo [i0, i1) de señales ya ponderadas.
    const potencia = (a, b, i0, i1) => {
      let s = 0;
      for (let i = i0; i < i1; i++) s += a[i] * a[i] + b[i] * b[i];
      return s / Math.max(1, i1 - i0);
    };
    const lufs = (p) => -0.691 + 10 * Math.log10(Math.max(p, 1e-12));
    // Integrada, con bloques de 400 ms solapados al 75% y las dos compuertas.
    const integrada = (a, b) => {
      const blk = Math.round(0.4 * sr), paso = Math.round(0.1 * sr);
      const ps = [];
      for (let i = 0; i + blk <= a.length; i += paso) ps.push(potencia(a, b, i, i + blk));
      const abs = ps.filter((p) => lufs(p) > -70);
      if (!abs.length) return -70;
      const m0 = abs.reduce((x, y) => x + y, 0) / abs.length;
      const rel = abs.filter((p) => lufs(p) > lufs(m0) - 10);
      return lufs(rel.reduce((x, y) => x + y, 0) / Math.max(1, rel.length));
    };
    const ka = kw(L), kb = kw(R);
    const I = integrada(ka, kb);
    // La de corto plazo, en ventanas de 3 s cada medio segundo: la más fuerte.
    let corto = -70;
    const w3 = Math.round(3 * sr);
    for (let i = 0; i + w3 <= ka.length; i += Math.round(0.5 * sr)) corto = Math.max(corto, lufs(potencia(ka, kb, i, i + w3)));
    // Pico de muestra, recortes, y pico real con sobremuestreo ×4 (un filtro
    // de seno cardinal con ventana de Hann, 32 coeficientes por fase).
    let pico = 0, recortes = 0;
    for (const x of [L, R]) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > pico) pico = v; if (v >= 1) recortes++; }
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
        // Solo cerca de las muestras fuertes: el resto no puede pasarlas.
        if (Math.abs(x[i]) < pico * 0.7) continue;
        for (const hf of h) {
          let s = 0;
          for (let t = 0; t < TAPS; t++) s += hf[t] * x[i - TAPS / 2 + t + 1];
          picoReal = Math.max(picoReal, Math.abs(s));
        }
      }
    }
    // Lo que pierde en un parlante chico.
    const sinGraves = (fc) => integrada(kw(pasoAlto(L, fc)), kw(pasoAlto(R, fc)));
    const I150 = sinGraves(150), I300 = sinGraves(300);
    // Con --espectro: cuánto pierde la mezcla con pasos altos de varias frecuencias, para ver dónde está la energía grave.
    // Y cuánta de la energía (ponderada) cae antes del cartel, en los primeros 3 s después y más tarde, con y sin los graves.
    let tramos = null;
    if (window.__espectro && cartel > 0) {
      const ha = kw(pasoAlto(L, 150)), hb = kw(pasoAlto(R, 150));
      const c = Math.round((cartel / 1000) * sr), d3 = Math.min(ka.length, c + Math.round(3 * sr));
      const parte = (i0, i1) => ({ seg: (i1 - i0) / sr, todo: potencia(ka, kb, i0, i1) * (i1 - i0), alto: potencia(ha, hb, i0, i1) * (i1 - i0) });
      const tot = parte(0, ka.length).todo;
      tramos = [["antes", parte(0, c)], ["3 s del cartel", parte(c, d3)], ["despues", parte(d3, ka.length)]].map(([n, t]) => ({ n, seg: t.seg, pct: (100 * t.todo) / tot, pierde: 10 * Math.log10(t.todo / Math.max(t.alto, 1e-12)) }));
    }
    const cortes = window.__espectro ? Object.fromEntries([40, 60, 80, 100, 125, 150, 200, 300].map((fc) => [fc, I - sinGraves(fc)])) : null;
    // El golpe del ganador: el medio segundo después del cartel contra el de antes.
    let golpe = null;
    if (cartel > 0) {
      const c = Math.round((cartel / 1000) * sr), d = Math.round(0.5 * sr);
      if (c - d > 0 && c + d < ka.length) golpe = lufs(potencia(ka, kb, c, c + d)) - lufs(potencia(ka, kb, c - d, c));
    }
    return { seg: L.length / sr, I, corto, pico, picoReal, recortes, I150, I300, golpe, cartel, cortes, tramos };
  };
})();`;

const SIN_MUSICA = `(() => { try { localStorage.setItem('tinkazo.musica', '0'); } catch {} })();`;

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
const f1 = (v) => (v === null || v === undefined ? "—" : v.toFixed(1));

async function medirUna(browser, juego) {
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: OIDO });
    if (sinMusica) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: SIN_MUSICA });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&auditar=mezcla${motor ? `&motor=${motor}` : ""}${sonidoCarrera ? `&sonido=${encodeURIComponent(sonidoCarrera)}` : ""}${consulta ? `&${consulta}` : ""}` });
    const ok = await page.waitFor("document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'", 30_000);
    if (!ok.ok) return { error: "el estadio no apareció" };
    // Hasta que el juego cierra solo (o sale el resultado), o como mucho 150 s: la carrera de 30 dura hasta 90 s con el
    // pelotón (`normalCarrera` en src/duraciones.ts) y con 60 s se cortaba antes del ganador.
    const t0 = Date.now();
    let cerro = false;
    while (Date.now() - t0 < 150_000) {
      await sleep(500);
      cerro = Boolean(await page.eval("document.getElementById('stadium').style.display !== 'block' || document.querySelector('.winner-name') !== null"));
      if (cerro) break;
    }
    // Después de que cierra se sigue grabando hasta dos segundos del reloj del audio después del cartel, si se vio, y
    // un poco más para que lleguen los últimos trozos: el golpe del ganador tiene que quedar adentro.
    let e = await page.eval("window.__mezcla ? window.__mezcla.estado() : null");
    if (!e) return { error: "no se pudo enganchar el oído" };
    if (e.falla) return { error: `el oído no arrancó: ${e.falla}` };
    const t1 = Date.now();
    while (cerro && Date.now() - t1 < 15_000) {
      e = await page.eval("window.__mezcla.estado()");
      if (puedeParar({ cerro, cartelSeg: e.cartelSeg, ahoraSeg: e.ahora })) break;
      await sleep(200);
    }
    // Hasta ahí sonó esto; se espera a que lo grabado lo alcance (los trozos viajan por mensajes).
    const sonadoSeg = e.ahora - e.primerCuadro / e.sr;
    for (let i = 0; i < 20; i++) {
      e = await page.eval("window.__mezcla.estado()");
      if (e.grabadoSeg >= sonadoSeg - 0.1) break;
      await sleep(100);
    }
    const r = await page.eval("window.__mezcla && window.__mezcla.L.length ? window.__mezcla.medir() : null");
    if (!r) return { error: "no sonó nada (¿el contexto de audio quedó suspendido?)" };
    r.sonadoSeg = sonadoSeg;
    // Con la música de archivo prendida: lo que dice el reproductor, para saber si la pista sonó o si cayó a la de osciladores.
    try {
      const p = await page.eval("window.__tinkazoPista ? JSON.stringify(window.__tinkazoPista()) : null");
      if (p) r.pista = JSON.parse(p);
    } catch {
      /* sin reproductor de archivo */
    }
    r.corta = grabacionCorta({ grabadoSeg: r.seg, sonadoSeg });
    if (carpetaWav) {
      // Se trae el comienzo de la mezcla en trozos chicos: el canal de DevTools no aguanta un mensaje de varios MB.
      const sr = Number(await page.eval("window.__mezcla.sr"));
      const total = Math.round(segundosWav * sr);
      const L = new Float32Array(total), R = new Float32Array(total);
      // Los segundos que terminan cuatro después del cartel del ganador (con el cartel adentro), o los primeros si no se vio.
      const desde = r.cartel > 0 ? Math.max(0, Math.round((r.cartel / 1000 + 4) * sr) - total) : 0;
      let puesto = 0, bloque = Math.floor(desde / 4096);
      let saltar = desde - bloque * 4096;
      while (puesto < total) {
        const par = JSON.parse(await page.eval(`(() => { const b = window.__mezcla; const i = ${bloque}; if (!b.L[i]) return "null"; return JSON.stringify([Array.from(b.L[i], (v) => Math.round(v * 32767)), Array.from(b.R[i], (v) => Math.round(v * 32767))]); })()`));
        if (!par) break;
        const ini = saltar; saltar = 0;
        const n = Math.min(par[0].length - ini, total - puesto);
        for (let k = 0; k < n; k++) { L[puesto + k] = par[0][ini + k] / 32767; R[puesto + k] = par[1][ini + k] / 32767; }
        puesto += n; bloque++;
      }
      mkdirSync(carpetaWav, { recursive: true });
      escribirWav(join(carpetaWav, `${juego}-${etiquetaWav}.wav`), L, R, sr, segundosWav);
    }
    return r;
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
}

/**
 * Mide un juego; si la grabación quedó más corta que lo que sonó, o se vio el cartel y el golpe no entró, lo dice y
 * repite una vez en vez de dar una cifra rara. Si la segunda también queda corta, el resultado lleva `corta`.
 */
async function medir(browser, juego) {
  let r;
  try {
    r = await medirUna(browser, juego);
  } catch (e) {
    // La página dejó de contestar (la máquina cargada, una pestaña colgada): una vez más, en una pestaña nueva.
    console.log(`${juego.padEnd(11)} la página no contestó (${String(e.message ?? e).slice(0, 80)}): repito una vez`);
    r = await medirUna(browser, juego);
  }
  if (!r.error && hayQueRepetir({ corta: r.corta, cartelMs: r.cartel, golpe: r.golpe })) {
    console.log(`${juego.padEnd(11)} la grabación no quedó completa (${r.seg.toFixed(1)} s de ${r.sonadoSeg.toFixed(1)} s${r.cartel > 0 && r.golpe === null ? ", sin golpe" : ""}): repito una vez`);
    r = await medirUna(browser, juego);
  }
  return r;
}

async function run() {
  process.env.TINKAZO_GPU = "1";
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9671), width: 1280, height: 720 });
  const res = [];
  try {
    console.log(`\nMidiendo la mezcla en ${base}${sinMusica ? " (sin música)" : ""}\n`);
    for (const juego of lista) {
      const r = await medir(browser, juego);
      res.push({ juego, ...r });
      if (r.error) console.log(`${juego.padEnd(11)} ✗ ${r.error}`);
      else if (espectro) console.log(`${juego.padEnd(11)} pierde por corte: ${Object.entries(r.cortes).map(([k, v]) => `${k} Hz ${f1(v)}`).join(" · ")}`);
      if (r.tramos) for (const t of r.tramos) console.log(`             ${t.n}: ${t.seg.toFixed(1)} s, ${t.pct.toFixed(0)} % de la energía, pierde ${f1(t.pierde)} LU`);
      if (!r.error) console.log(`${juego.padEnd(11)} ${f1(r.I)} LUFS · pico real ${f1(db(r.picoReal))} dBTP · corto máx ${f1(r.corto)} · sin graves de 150 Hz ${f1(r.I - r.I150)} LU, de 300 Hz ${f1(r.I - r.I300)} LU · golpe ${f1(r.golpe)} LU · ${r.seg.toFixed(1)} s`);
      if (!r.error && r.pista) {
        const avisos = r.pista.registro.filter((x) => /^(pista|falla|cae|corre)|llegó tarde/.test(x.que)).map((x) => x.que);
        console.log(`             música de archivo: ${r.pista.modo}${r.pista.suena ? ", sonando al cerrar" : ""}${avisos.length ? `, ${avisos.join(" | ")}` : ", sin avisos"}`);
      }
    }
  } finally {
    await browser.close();
  }

  const buenos = res.filter((r) => !r.error);
  const orden = buenos.map((r) => r.I).sort((a, b) => a - b);
  const mediana = orden.length ? orden[Math.floor(orden.length / 2)] : 0;
  let pasan = 0, total = 0;
  const registro = [];
  let juegoActual = "";
  const check = (ok, txt, det) => {
    total++;
    registro.push({ nombre: `${juegoActual}: ${txt}`, ok, detalle: det ?? "" });
    if (ok) pasan++;
    console.log(`  ${ok ? "✓" : "✗"} ${txt}${det ? ` · ${det}` : ""}`);
  };
  console.log("");
  for (const r of res) {
    console.log(r.juego);
    juegoActual = r.juego;
    if (r.error) {
      check(false, "se pudo medir", r.error);
      continue;
    }
    if (r.corta) check(false, "la grabación cubre todo lo que sonó", `${f1(r.seg)} s de ${f1(r.sonadoSeg)} s, aun repitiendo`);
    check(r.recortes === 0, "nada recorta", `${r.recortes} muestras en 1 o más`);
    check(db(r.picoReal) <= PICO_REAL_MAX, `el pico real queda bajo ${PICO_REAL_MAX} dBTP`, `${f1(db(r.picoReal))} dBTP`);
    if (lista.length > 1) check(Math.abs(r.I - mediana) <= PAREJO_LU, `suena parejo con los demás (±${PAREJO_LU} LU de la mediana)`, `${f1(r.I)} contra ${f1(mediana)} LUFS`);
    check(r.corto - r.I <= CORTO_SOBRE_INTEGRADA, `ningún tramo de 3 s salta más de ${CORTO_SOBRE_INTEGRADA} LU`, `${f1(r.corto - r.I)} LU sobre la integrada`);
    check(r.I - r.I150 <= PIERDE_150, `en un parlante que corta en 150 Hz pierde ${PIERDE_150} LU o menos`, `${f1(r.I - r.I150)} LU`);
    check(r.I - r.I300 <= PIERDE_300, `en uno que corta en 300 Hz pierde ${PIERDE_300} LU o menos`, `${f1(r.I - r.I300)} LU`);
    if (r.cartel > 0 && r.golpe === null) check(false, "se pudo medir el golpe del ganador", "el cartel salió pero no entra medio segundo de cada lado");
    if (r.golpe !== null) check(r.golpe >= GOLPE_MIN, `el ganador suena ${GOLPE_MIN} LU más fuerte que lo de antes`, `${f1(r.golpe)} LU`);
  }
  const ok = pasan === total;
  console.log(`\n${ok ? "APROBADO" : "RECHAZADO"}: ${pasan}/${total} comprobaciones`);
  emitirJson({ auditor: "audit-mezcla", objetivo: cual, checks: registro });
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
