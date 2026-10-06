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
 *   node scripts/audit-mezcla.mjs [juego|todos] [--base http://localhost:4173] [--sin-musica]
 */
import { launch, sleep } from "./lib/browser.mjs";

const TODOS = ["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien"];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const sinMusica = args.includes("--sin-musica");
const lista = cual === "todos" ? TODOS : [cual];

/** Los umbrales. */
const PICO_REAL_MAX = -1.0;
const PAREJO_LU = 3.0;
const CORTO_SOBRE_INTEGRADA = 7.0;
// Calibrado con la mezcla de hoy (5 de octubre de 2026): antes de los armónicos
// del bajo y de los bombos se perdían de 4,1 a 4,9 LU, y con ellos de 2,6 a 3,5.
// No hay norma para este número: hay que ajustarlo midiendo parlantes reales.
const PIERDE_150 = 3.5;
const PIERDE_300 = 6.0;
const GOLPE_MIN = 2.0;

/**
 * El oído, inyectado antes de que exista la página: la salida del contexto
 * pasa por una ganancia que además alimenta un procesador que copia las
 * muestras. El parlante sigue recibiendo lo mismo.
 */
const OIDO = `(() => {
  const AC = window.AudioContext;
  const o = window.__mezcla = { L: [], R: [], sr: 0, t0: -1, cartel: -1, juntando: true };
  window.AudioContext = function (...a) {
    const ctx = new AC(...a);
    const real = ctx.destination;
    const mezcla = ctx.createGain();
    mezcla.connect(real);
    const sp = ctx.createScriptProcessor(4096, 2, 2);
    const mudo = ctx.createGain();
    mudo.gain.value = 0;
    mezcla.connect(sp);
    sp.connect(mudo);
    mudo.connect(real);
    o.sr = ctx.sampleRate;
    sp.onaudioprocess = (e) => {
      if (!o.juntando) return;
      if (o.t0 < 0) o.t0 = performance.now();
      o.L.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      o.R.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };
    Object.defineProperty(ctx, 'destination', { get: () => mezcla });
    o.ctx = ctx;
    return ctx;
  };
  window.AudioContext.prototype = AC.prototype;
  // Cuándo se revela el ganador: con \`?auditar=mezcla\` el estadio lo anota en
  // el primer cuadro del cartel. Si no está (el motor anterior), cuando el
  // cartel aparece en el lienzo, que es a los 0,6 s de su entrada.
  const mirar = () => {
    const cv = document.getElementById('pixi-canvas') || document.getElementById('race-canvas');
    if (o.cartel < 0 && o.t0 >= 0) {
      if (window.__revelado !== undefined) o.cartel = window.__revelado - o.t0;
      else if (cv && cv.dataset.cartel) o.cartel = performance.now() - o.t0 - 600;
    }
    requestAnimationFrame(mirar);
  };
  requestAnimationFrame(mirar);
  o.medir = () => {
    o.juntando = false;
    const une = (xs) => { let n = 0; for (const x of xs) n += x.length; const y = new Float32Array(n); let i = 0; for (const x of xs) { y.set(x, i); i += x.length; } return y; };
    const L = une(o.L), R = une(o.R), sr = o.sr;
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
    // El golpe del ganador: el medio segundo después del cartel contra el de antes.
    let golpe = null;
    if (o.cartel > 0) {
      const c = Math.round((o.cartel / 1000) * sr), d = Math.round(0.5 * sr);
      if (c - d > 0 && c + d < ka.length) golpe = lufs(potencia(ka, kb, c, c + d)) - lufs(potencia(ka, kb, c - d, c));
    }
    return { seg: L.length / sr, I, corto, pico, picoReal, recortes, I150, I300, golpe, cartel: o.cartel };
  };
})();`;

const SIN_MUSICA = `(() => { try { localStorage.setItem('tinkazo.musica', '0'); } catch {} })();`;

const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
const f1 = (v) => (v === null || v === undefined ? "—" : v.toFixed(1));

async function medir(browser, juego) {
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: OIDO });
    if (sinMusica) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: SIN_MUSICA });
    await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&auditar=mezcla` });
    const ok = await page.waitFor("document.getElementById('stadium') && document.getElementById('stadium').style.display === 'block'", 30_000);
    if (!ok.ok) return { error: "el estadio no apareció" };
    // Hasta que el juego cierra solo, o como mucho 60 s.
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      await sleep(500);
      const abierto = await page.eval("document.getElementById('stadium').style.display === 'block'");
      if (!abierto) break;
    }
    await sleep(400);
    const r = await page.eval("window.__mezcla && window.__mezcla.L.length ? window.__mezcla.medir() : null");
    if (!r) return { error: "no sonó nada (¿el contexto de audio quedó suspendido?)" };
    return r;
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
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
      else console.log(`${juego.padEnd(11)} ${f1(r.I)} LUFS · pico real ${f1(db(r.picoReal))} dBTP · corto máx ${f1(r.corto)} · sin graves de 150 Hz ${f1(r.I - r.I150)} LU, de 300 Hz ${f1(r.I - r.I300)} LU · golpe ${f1(r.golpe)} LU · ${r.seg.toFixed(1)} s`);
    }
  } finally {
    await browser.close();
  }

  const buenos = res.filter((r) => !r.error);
  const orden = buenos.map((r) => r.I).sort((a, b) => a - b);
  const mediana = orden.length ? orden[Math.floor(orden.length / 2)] : 0;
  let pasan = 0, total = 0;
  const check = (ok, txt, det) => {
    total++;
    if (ok) pasan++;
    console.log(`  ${ok ? "✓" : "✗"} ${txt}${det ? ` · ${det}` : ""}`);
  };
  console.log("");
  for (const r of res) {
    console.log(r.juego);
    if (r.error) {
      check(false, "se pudo medir", r.error);
      continue;
    }
    check(r.recortes === 0, "nada recorta", `${r.recortes} muestras en 1 o más`);
    check(db(r.picoReal) <= PICO_REAL_MAX, `el pico real queda bajo ${PICO_REAL_MAX} dBTP`, `${f1(db(r.picoReal))} dBTP`);
    if (lista.length > 1) check(Math.abs(r.I - mediana) <= PAREJO_LU, `suena parejo con los demás (±${PAREJO_LU} LU de la mediana)`, `${f1(r.I)} contra ${f1(mediana)} LUFS`);
    check(r.corto - r.I <= CORTO_SOBRE_INTEGRADA, `ningún tramo de 3 s salta más de ${CORTO_SOBRE_INTEGRADA} LU`, `${f1(r.corto - r.I)} LU sobre la integrada`);
    check(r.I - r.I150 <= PIERDE_150, `en un parlante que corta en 150 Hz pierde ${PIERDE_150} LU o menos`, `${f1(r.I - r.I150)} LU`);
    check(r.I - r.I300 <= PIERDE_300, `en uno que corta en 300 Hz pierde ${PIERDE_300} LU o menos`, `${f1(r.I - r.I300)} LU`);
    if (r.golpe !== null) check(r.golpe >= GOLPE_MIN, `el ganador suena ${GOLPE_MIN} LU más fuerte que lo de antes`, `${f1(r.golpe)} LU`);
  }
  const ok = pasan === total;
  console.log(`\n${ok ? "APROBADO" : "RECHAZADO"}: ${pasan}/${total} comprobaciones`);
  process.exit(ok ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
