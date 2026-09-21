#!/usr/bin/env node
/**
 * Auditor de sonido: escucha lo que suena, sin oírlo.
 *
 * Existe porque el sonido de los seis juegos se degradó durante meses sin que
 * nada fallara. Había golpes de clímax a 70 y 90 Hz, que el parlante de un
 * proyector no reproduce; sesenta y seis notas por debajo del murmullo de una
 * sala; dieciséis de veintiún puntos fuera de la escala; y la traba de la
 * ruleta disparándose catorce veces encima de la fanfarria. Todo eso estaba
 * escrito en el código y ninguna comprobación lo miraba.
 *
 * Lo que hace es enganchar `OscillatorNode` antes de que cargue la página y
 * anotar cada nota que arranca: cuándo, qué altura, qué timbre, qué volumen y
 * cuánto dura. Después mide lo que se puede medir sin oídos.
 *
 * Uso:
 *   node scripts/audit-sound.mjs <juego> [--base http://localhost:4173]
 *   node scripts/audit-sound.mjs todos
 */

import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const JUEGOS = ["race", "rockets", "stellar", "ledger", "pasanaku", "wheel"];
const pedido = args[0] && !args[0].startsWith("--") ? args[0] : "todos";
const lista = pedido === "todos" ? JUEGOS : [pedido];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ reglas */

/** La pentatónica de `src/sound.ts`, replicada para comprobar afinación. */
function note(degree) {
  const scale = [0, 2, 4, 7, 9];
  const d = Math.max(0, Math.round(degree));
  const semis = (scale[d % 5] ?? 0) + 12 * Math.floor(d / 5);
  return 130.81 * Math.pow(2, semis / 12);
}
const ESCALA = Array.from({ length: 34 }, (_, d) => note(d));
const enEscala = (f) => ESCALA.some((n) => Math.abs(n - f) < Math.max(0.6, n * 0.004));

/** Lo que reproduce el parlante de un proyector o de una sala chica. */
const F_MIN = 128;
const F_MAX = 2150;
/** Por debajo de esto queda bajo el murmullo de cincuenta personas. */
const VOL_MIN = 0.019;
/** Más silencio que esto y la escena se siente muerta. */
const HUECO_MAX = 4.0;

/**
 * El enganche, inyectado antes de que exista la página.
 *
 * El volumen se toma de la última rampa de ganancia, porque `beep` arma la
 * envolvente justo antes de arrancar el oscilador: el orden los empareja.
 */
const HOOK = `(() => {
  window.__snd = [];
  const OP = OscillatorNode.prototype;
  const start = OP.start, stop = OP.stop;
  OP.start = function (w) {
    // Se anota el reloj del contexto y el del navegador. Si el contexto queda
    // suspendido su reloj no avanza y todas las notas caerían en el instante
    // cero; el del navegador siempre corre, así que los huecos se miden con
    // ese y las duraciones con la diferencia entre el arranque y el corte.
    this.__rec = { t: +w || 0, w: performance.now() / 1000, f: this.frequency.value, tipo: this.type, g: window.__lastGain || 0, end: 0 };
    window.__snd.push(this.__rec);
    return start.apply(this, arguments);
  };
  OP.stop = function (w) { if (this.__rec) this.__rec.end = +w || 0; return stop.apply(this, arguments); };
  const lr = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (v) {
    if (v > 0.0002) window.__lastGain = v;
    return lr.apply(this, arguments);
  };
})()`;

/**
 * El narrador, medido sin voz.
 *
 * Chrome sin interfaz no trae ninguna voz instalada, así que `narrate()` se
 * vuelve en el acto y el narrador nunca habló en una auditoría. Por eso nadie
 * vio durante meses que cortaba sus propias frases por la mitad: cada línea
 * nueva cancelaba a la anterior, y en una sala eso se oye como un relator que
 * se traba.
 *
 * Acá se le pone una voz de mentira y se simula el tiempo que tardaría en decir
 * cada línea, a unos trece caracteres por segundo al ritmo base. Con eso se
 * cuentan las frases que quedan a medias sin que suene nada.
 */
const HOOK_VOZ = `(() => {
  window.__voz = { dichas: [], cortadas: [] };
  const voz = { name: "Prueba", lang: "es-ES", localService: true, default: true, voiceURI: "prueba" };
  const SS = Object.getPrototypeOf(speechSynthesis);
  SS.getVoices = () => [voz];
  // Y una declamación de mentira: asignarle una voz que no es un
  // SpeechSynthesisVoice de verdad al objeto nativo tira una excepción.
  window.SpeechSynthesisUtterance = function (texto) {
    this.text = texto;
    this.rate = 1;
    this.pitch = 1;
    this.volume = 1;
    this.voice = null;
    this.lang = "";
    this.onend = null;
    this.onerror = null;
  };
  let viva = null;
  SS.speak = function (u) {
    if (!u || !u.text || !u.text.trim()) return;
    const dur = (u.text.length / (13 * (u.rate || 1))) * 1000;
    const rec = { t: performance.now(), texto: u.text, dur: dur, dicho: 0 };
    window.__voz.dichas.push(rec);
    const id = setTimeout(() => {
      rec.dicho = dur;
      viva = null;
      if (u.onend) u.onend(new Event("end"));
    }, dur);
    viva = { u: u, rec: rec, id: id };
  };
  SS.cancel = function () {
    if (!viva) return;
    clearTimeout(viva.id);
    const r = viva.rec;
    r.dicho = performance.now() - r.t;
    if (r.dicho < r.dur * 0.88) window.__voz.cortadas.push({ texto: r.texto, pct: r.dicho / r.dur });
    const u = viva.u;
    viva = null;
    if (u.onend) u.onend(new Event("end"));
  };
  Object.defineProperty(SS, "speaking", { configurable: true, get: () => !!viva });
  Object.defineProperty(SS, "paused", { configurable: true, get: () => false });
})()`;

async function correr(browser, juego) {
  const page = await browser.open("about:blank");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK_VOZ });
  await page.send("Page.navigate", { url: `${base}/?demo=${juego}&lead=3&pace=normal` });

  const arranco = await page.waitFor(
    `document.getElementById('stadium').style.display === 'block'`,
    120000,
  );
  if (!arranco.ok) return { juego, error: "el juego no arrancó" };
  const termino = await page.waitFor(
    `document.getElementById('stadium').style.display !== 'block'`,
    120000,
  );
  await sleep(400);
  const crudo = await page.eval(`JSON.stringify(window.__snd || [])`);
  const voz = await page.eval(`JSON.stringify(window.__voz || { dichas: [], cortadas: [] })`);
  return { juego, notas: JSON.parse(crudo), voz: JSON.parse(voz), termino: termino.ok };
}

function medir(notas) {
  const orden = [...notas].sort((a, b) => a.w - b.w);
  const fuera = [];
  const bajas = [];
  const desafinadas = [];
  const cortas = [];
  for (const n of orden) {
    const d = Math.max(0, n.end - n.t);
    if (n.f < F_MIN || n.f > F_MAX) fuera.push(`${Math.round(n.f)} Hz`);
    if (n.g && n.g < VOL_MIN) bajas.push(`${Math.round(n.f)} Hz a ${n.g}`);
    if (!enEscala(n.f)) desafinadas.push(`${Math.round(n.f)} Hz`);
    // Sólo cuenta como melodía lo que tiene cuerpo: por debajo de 40 ms el
    // oído no percibe altura, oye un clic, y un clic como clic está bien.
    if (d > 0 && d < 0.04 && n.g >= 0.04) cortas.push(`${Math.round(n.f)} Hz ${Math.round(d * 1000)} ms`);
  }

  // El hueco más largo sin nada sonando, contando lo que cada nota dura.
  const t0 = orden.length ? orden[0].w : 0;
  let hueco = 0;
  let cuando = 0;
  let libre = t0;
  for (const n of orden) {
    if (n.w - libre > hueco) {
      hueco = n.w - libre;
      cuando = libre - t0;
    }
    libre = Math.max(libre, n.w + Math.max(0, n.end - n.t));
  }

  // Golpes repetidos. Lo que se busca no es que un sonido suene muchas veces
  // (un cambio de líder puede pasar diez veces en una carrera y está bien),
  // sino la forma del redisparo: la misma nota, al mismo volumen, **apretada en
  // un ratito**. Así sonaba la traba de la ruleta, catorce veces en 1,8 s.
  const VENTANA = 1.5;
  const repes = [];
  for (let i = 0; i < orden.length; i++) {
    const a = orden[i];
    if (a.g < 0.05) continue;
    let veces = 1;
    for (let j = i + 1; j < orden.length && orden[j].w - a.w < VENTANA; j++) {
      const b = orden[j];
      if (Math.round(b.f) === Math.round(a.f) && b.tipo === a.tipo && b.g === a.g) veces++;
    }
    if (veces >= 4) repes.push(`${Math.round(a.f)} Hz x${veces} en ${VENTANA} s`);
  }

  // Enmascarados: dos sonidos en el mismo instante donde uno suena al doble que
  // el otro. El flojo está escrito y no existe, que es lo que pasaba con los
  // adornos de la corona puestos dentro de la fanfarria.
  //
  // No se mira que los timbres sean distintos: con todo en una misma escala
  // pentatónica, dos notas juntas son un acorde, no un choque. Lo que las
  // vuelve un defecto es que una tape a la otra.
  // Acá vivió una comprobación de sonidos enmascarados, y se sacó a propósito.
  //
  // La idea era cazar el adorno escrito dentro de la fanfarria, que suena a la
  // mitad de volumen y no lo oye nadie. Pero "flojo y simultáneo con algo
  // fuerte" describe también al galope de la carrera, que es cama de fondo y
  // tiene que ir por debajo; al tono de vuelo de la constelación, que dura más
  // que el aterrizaje que lo tapa y se sigue oyendo después; y a las notas de
  // textura de las tarjetas del cierre. Tres intentos de afinar la regla
  // dejaron los tres casos buenos marcados y ningún defecto encontrado.
  //
  // El riesgo real ya lo cubre la comprobación de registro: los adornos que
  // nadie oía estaban a 3520 y 4186 Hz, o sea fuera de lo que reproduce el
  // parlante de una sala, y eso sí se mide sin ambigüedad. Una comprobación que
  // marca código correcto es peor que no tenerla: enseña a ignorar la salida.

  const ultima = orden[orden.length - 1];
  const dur = orden.length ? ultima.w - t0 + Math.max(0, ultima.end - ultima.t) : 0;
  return { total: orden.length, dur, hueco, cuando, fuera, bajas, desafinadas, cortas, repes };
}

const unicos = (a, n = 3) => [...new Set(a)].slice(0, n).join(", ");

async function run() {
  const browser = await launch({ width: 1280, height: 720 });
  let malas = 0;
  try {
    console.log(`\nEscuchando ${base}\n`);
    for (const juego of lista) {
      const r = await correr(browser, juego);
      if (r.error) {
        console.log(`${juego.padEnd(9)} ✗ ${r.error}`);
        malas++;
        continue;
      }
      const m = medir(r.notas);
      const fallas = [];
      if (m.total === 0) fallas.push("no sonó nada");
      if (m.fuera.length) fallas.push(`${m.fuera.length} fuera del parlante (${unicos(m.fuera)})`);
      if (m.bajas.length) fallas.push(`${m.bajas.length} por debajo del murmullo (${unicos(m.bajas)})`);
      if (m.desafinadas.length) fallas.push(`${m.desafinadas.length} fuera de escala (${unicos(m.desafinadas)})`);
      if (m.repes.length) fallas.push(`golpe repetido (${unicos(m.repes)})`);
      if (m.hueco > HUECO_MAX) fallas.push(`${m.hueco.toFixed(1)} s de silencio en el segundo ${m.cuando.toFixed(1)}`);
      if (m.cortas.length) fallas.push(`${m.cortas.length} notas sin altura audible (${unicos(m.cortas)})`);

      // El narrador. Una frase cortada es aceptable: el anuncio del ganador
      // tiene derecho a pisar lo que se esté diciendo. Dos ya son un relator
      // que se traba, que es como sonaba antes.
      const v = r.voz ?? { dichas: [], cortadas: [] };
      if (v.cortadas.length > 1) {
        fallas.push(
          `${v.cortadas.length} frases del narrador cortadas: ` +
            v.cortadas.slice(0, 2).map((x) => `"${x.texto.slice(0, 24)}" al ${Math.round(x.pct * 100)}%`).join(", "),
        );
      }

      const cortes = v.cortadas.length ? ` · ${v.cortadas.length} cortada(s)` : "";
      const cab = `${juego.padEnd(9)} ${String(m.total).padStart(3)} notas y ${String(v.dichas.length).padStart(2)} frases en ${m.dur.toFixed(1)} s · hueco máximo ${m.hueco.toFixed(1)} s${cortes}`;
      if (fallas.length) {
        malas++;
        console.log(`✗ ${cab}`);
        for (const f of fallas) console.log(`    ${f}`);
      } else {
        console.log(`✓ ${cab}`);
      }
    }
  } finally {
    browser.close();
  }
  console.log("");
  console.log(malas ? `RECHAZADO: ${lista.length - malas}/${lista.length} juegos` : `APROBADO: ${lista.length}/${lista.length} juegos`);
  console.log("");
  process.exit(malas ? 1 : 0);
}

run().catch((e) => {
  console.error("la auditoría se cayó:", String(e).slice(0, 200));
  process.exit(1);
});
