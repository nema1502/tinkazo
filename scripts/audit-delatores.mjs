#!/usr/bin/env node
/**
 * El auditor de delatores.
 *
 * Un delator es algo que se ve durante el show y adivina al ganador más que el
 * azar: quién va adelante a mitad de la carrera, a quién se nombra primero,
 * dónde frena la cámara, de qué lado está cada uno en el mano a mano. Si una
 * señal delata, la sala aprende el final y el juego pierde la duda: "un final
 * que se aprende no se vuelve a querer ver" (auditoría de los juegos, 2.3 y 8.7).
 *
 * Para cada juego corre muchas semillas (doscientas, por defecto) con el reloj
 * en turbo y sin red. En cada una el ganador lo elige la selección del
 * protocolo con esa semilla, igual que un sorteo de verdad
 * (`?ganador=` con la misma semilla en la escena fija, src/pose.ts), y la
 * página graba lo que ve la sala:
 * los subtítulos con su hora, los nombres en pantalla cuadro a cuadro, la
 * cámara y lo que el juego anota (`scripts/lib/delatores-grabador.mjs`).
 * Después, cada señal se mide como una regla de apuesta ("gana el que nombran
 * primero") y se compara con el azar de esa semilla
 * (`scripts/lib/delatores-senales.mjs`), con una prueba exacta y un umbral
 * fijado de antemano (`scripts/lib/delatores.mjs`, `UMBRAL`):
 *
 * - **delator**: acertar así de seguido (o de poco) por casualidad tiene una
 *   probabilidad menor que 1 en 1000, corregida por las reglas que se miraron,
 *   y la regla acierta al menos 1,25 veces el azar (o la mitad o menos);
 * - **a mirar**: lo mismo con 1 en 100: vale otra corrida;
 * - **limpia**, o **pocos datos** con menos de diez semillas que informen.
 *
 * Con dieciséis semillas solo se ven los delatores groseros: con ocho
 * corredores, el azar acierta el 12,5% y duplicarlo pasa por casualidad una de
 * cada ocho veces. Con doscientas, un delator de 1,7 veces el azar ya no se
 * esconde.
 *
 * **La carrera se juzga a nivel del plan, sin navegador.** Su show es puro (quién
 * se echa y cuándo, quién lleva la punta, la tanda, el portón, cómo entran a la
 * recta, qué dice el relator): cada ronda cuesta unos milisegundos, así que
 * corre 1.500 rondas con 18, 30, 60, 100 y 200 personas en medio minuto
 * (`scripts/lib/delatores-carrera.mjs`). Ahí delata con solo salir de la
 * casualidad, con la probabilidad en 1 contra 1000 y sin pedirle además un
 * tamaño: con tantas rondas, un desvío chico y real se ve y no se esconde.
 * Además de las reglas de apuesta de siempre, mide **repartos** (¿cae parejo
 * la ganadora entre los puestos de la entrada, las tandas, los lugares del
 * portón?, chi cuadrado con casilleros menos uno grados de libertad) y
 * **promedios** (lo que sin señal vale cero). `--navegador` la mide en la
 * página como a los otros, con las señales genéricas (relator, cámara,
 * arranque).
 *
 * Uso:
 *   node scripts/audit-delatores.mjs race [--semillas 1500] [--n 18,30,60,100,200] [--json salida.json]
 *   pnpm build && pnpm preview --port 4173 &
 *   node scripts/audit-delatores.mjs [juego|todos|sapo,wheel] [--semillas 200] [--n 8]
 *        [--base http://localhost:4173] [--json salida.json] [--trazas carpeta] [--paralelo 1]
 *   node scripts/audit-delatores.mjs [juego|todos] --releer carpeta [--n 8]
 *
 * `--trazas` guarda lo grabado de cada semilla (comprimido), y `--releer` lo
 * vuelve a medir sin navegador: para revisar una señal nueva sin volver a
 * correr horas de semillas. `--paralelo` abre varias ventanas a la vez en el
 * mismo Chrome: lo medido no cambia, y con cuatro tarda la mitad o menos.
 * Con `--paralelo 4`, cada semilla cuesta de 0,7 a 2 segundos según el juego y
 * la carga: los diez que entonces tenía el selector, con doscientas, tardaban unos
 * 23 minutos en la máquina del 21 de octubre de 2026 (Ryzen 7 7735HS, placa RTX 4060), y volver
 * a medirlos con `--releer`, unos 12 segundos. En los delatores, el script dice
 * también cuántos segundos antes del cartel se ve la señal (la mediana). Un
 * Chrome a la vez, con su puerto: CDP_PORT.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { emitirJson } from "./lib/resumen.mjs";
import { juegosDe } from "./lib/juegos.mjs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { CDP, launch } from "./lib/browser.mjs";
import { cargarCarrera, observar, rondaDe, semillaDe } from "./lib/delatores-carrera.mjs";
import { grabador } from "./lib/delatores-grabador.mjs";
import { grabarPara, senales } from "./lib/delatores-senales.mjs";
import { UMBRAL, evaluarMedia, evaluarReparto, evaluarSenal, falsasAlarmas, formatoP, pct } from "./lib/delatores.mjs";

/** Los ocho del selector (`lib/juegos.mjs`). Los que salieron (tombola, pasanaku, stellar, quien, trueque…) se piden por nombre. */
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = juegosDe(cual);
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
/** Los juegos que se juzgan a nivel del plan (puro, sin navegador). `--navegador` los mide en la página como a los otros. */
const DEL_PLAN = new Set(["race"]);
const delPlan = (juego) => DEL_PLAN.has(juego) && !args.includes("--navegador");
const pedidas = opt("--semillas", "");
const N = Math.max(1, Number(pedidas || "200"));
const rondas = Math.max(1, Number(pedidas || "1500"));
const listaN = opt("--n", "").split(",").map(Number).filter((x) => x >= 2);
const gente = listaN[0] ?? 8;
const tamanos = listaN.length ? listaN : [18, 30, 60, 100, 200];
// `--json archivo` guarda el detalle ahí (como siempre); `--json` solo agrega al final la línea de resumen.
const json = (() => {
  const i = args.indexOf("--json");
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "";
})();
const trazas = opt("--trazas", "");
const releer = opt("--releer", "");
const paralelo = Math.max(1, Math.min(6, Number(opt("--paralelo", "1"))));
process.env.TINKAZO_GPU = "1";

/** La semilla `i`: 64 hex, distintas de las del auditor de emoción. */
const semilla = semillaDe;

/**
 * El ganador de cada semilla, con la selección del protocolo (src/protocol),
 * para comprobar que la página usó la misma. Node lee TypeScript desde la 22.18;
 * con una versión anterior la comprobación se saltea con un aviso.
 */
let cotejar = null;
try {
  const [{ select }, { listHash }] = await Promise.all([import("../src/protocol/select.ts"), import("../src/protocol/canonical.ts")]);
  const bytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));
  cotejar = (names, seed) => select(bytes(seed), listHash(names), names.length, 1)[0];
} catch {
  console.warn("· sin comprobar el ganador con src/protocol (hace falta Node 22.18 o más nuevo)");
}

const puerto = Number(process.env.CDP_PORT || 9581);
let navegador = null;

async function conectar(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  return new CDP(ws);
}

/**
 * Una pestaña en su propia ventana, del tamaño de siempre. En una ventana
 * compartida, las pestañas de atrás quedan ocultas y no reciben
 * `requestAnimationFrame`: el reloj en turbo no avanzaba y `--paralelo` no
 * acortaba nada. En su ventana, cada una está a la vista y corre a la par.
 */
async function ventana() {
  if (!navegador) {
    const ver = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();
    navegador = await conectar(ver.webSocketDebuggerUrl);
  }
  const { targetId } = await navegador.send("Target.createTarget", { url: "about:blank", newWindow: true, width: 1280, height: 720 });
  const page = await conectar(`ws://127.0.0.1:${puerto}/devtools/page/${targetId}`);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  page.cerrar = async () => {
    try {
      await navegador.send("Target.closeTarget", { targetId }, 10_000);
    } catch {
      /* ya cerrada */
    }
    page.ws.close();
  };
  return page;
}

/** Una semilla de un juego, en una ventana nueva: lo que grabó la página, con `ok` si llegó al ganador. */
async function grabar(juego, seed) {
  let page = null;
  try {
    page = await ventana();
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: grabador(grabarPara(juego)) });
    const url = `${base}/?pose=${juego}&semilla=${seed}&n=${gente}&ganador=${seed}&pace=normal&motor=pixi&lang=es&auditar=marcas`;
    await page.send("Page.navigate", { url });
    const ok = await page.waitFor("window.__delator && window.__delator.fin !== null", 120_000);
    const tr = JSON.parse(await page.eval("JSON.stringify({ ...(window.__delator || {}), pose: window.__pose || null })"));
    tr.ok = ok.ok && !!tr.pose && tr.revelado != null && Array.isArray(tr.frames);
    tr.excepciones = [...page.exceptions];
    return tr;
  } catch (e) {
    return { ok: false, excepciones: [String(e?.message ?? e)] };
  } finally {
    await page?.cerrar();
  }
}

const archivo = (dir, juego, i) => join(dir, `${juego}-n${gente}-${String(i).padStart(3, "0")}.json.gz`);

/**
 * Las trazas de un juego, en el orden de las semillas: grabadas ahora (de a
 * `--paralelo` pestañas a la vez en el mismo Chrome), o leídas de `--releer`.
 * El reloj de cada pestaña es suyo, así que correr varias a la vez cambia
 * cuánto tarda, no lo que se mide.
 */
async function* trazasDe(juego) {
  if (releer) {
    const nombres = readdirSync(releer).filter((f) => f.startsWith(`${juego}-n${gente}-`) && f.endsWith(".json.gz")).sort();
    for (const f of nombres) yield JSON.parse(gunzipSync(readFileSync(join(releer, f))).toString("utf8"));
    return;
  }
  const una = async (i) => {
    const seed = semilla(i);
    let tr = await grabar(juego, seed);
    // Una vez más si la página no llegó: la máquina puede estar cargada.
    if (!tr.ok) tr = await grabar(juego, seed);
    tr.semilla = seed;
    tr.i = i;
    if (trazas && tr.ok) writeFileSync(archivo(trazas, juego, i), gzipSync(JSON.stringify(tr)));
    return tr;
  };
  const enCurso = new Map();
  let proxima = 1;
  for (let i = 1; i <= N; i++) {
    while (enCurso.size < paralelo && proxima <= N) {
      enCurso.set(proxima, una(proxima));
      proxima++;
    }
    const tr = await enCurso.get(i);
    enCurso.delete(i);
    yield tr;
  }
}

const iconos = { delator: "✗", mirar: "!", limpia: "✓", pocos: "·" };
const coma = (x, d = 1) => x.toFixed(d).replace(".", ",");
const firmado = (x, d = 3) => `${x >= 0 ? "+" : "−"}${coma(Math.abs(x), d)}`;
/** Qué es cada casillero de un reparto, para decirlo con palabras. */
const CASILLERO = { tanda: "tanda", porton: "lugar", carril: "carril" };
const casilleroDe = (senal) => CASILLERO[senal] ?? "puesto";

const resumen = [];
const soloPlan = juegos.every(delPlan);
const salida = { umbral: UMBRAL, n: soloPlan ? tamanos : gente, semillas: soloPlan ? rondas : N, juegos: {} };
let juzgadas = 0;

/**
 * Mide y cuenta lo que dejaron las semillas de un juego: las reglas de apuesta
 * (`senales`), los repartos (¿cae parejo la ganadora?) y los promedios (lo que
 * sin señal vale cero). `delPlan` juzga a nivel del plan: delata con solo salir
 * de la casualidad (1 en 1000), sin pedir además un tamaño (`UMBRAL.arriba`).
 */
function informar({ clave, etiqueta, filas, malas = 0, distintos = 0, delPlan = false }) {
  if (distintos) console.log(`  ✗ en ${distintos} semillas el ganador no es el de la selección del protocolo: ¿la página entiende ?ganador=?`);
  const errores = filas.reduce((a, f) => a + f.errores, 0);
  const arcos = filas.reduce((m, f) => m.set(f.arco, (m.get(f.arco) ?? 0) + 1), new Map());
  const ganadores = new Set(filas.map((f) => f.ganador)).size;
  console.log(`  ${filas.length} ${delPlan ? "rondas medidas" : "semillas medidas"}${malas ? `, ${malas} sin ganador` : ""}${errores ? `, ${errores} errores en la página` : ""} · ganadores distintos: ${ganadores} · arcos: ${[...arcos].map(([a, c]) => `${a} ${c}`).join(", ")}`);

  const fila = { juego: etiqueta, delator: [], mirar: [] };
  const detalle = { semillas: filas.length, sinGanador: malas, arcos: Object.fromEntries(arcos), senales: {}, repartos: {}, medias: {} };
  const sumar = (senal, veredicto) => {
    if (veredicto !== "pocos") juzgadas++;
    if (veredicto === "delator" || veredicto === "mirar") fila[veredicto].push(senal);
  };

  // Cada señal, con sus reglas, sobre todas las semillas.
  const familias = new Map();
  for (const f of filas) {
    for (const [senal, reglas] of Object.entries(f.senales)) {
      if (!familias.has(senal)) familias.set(senal, {});
      const fam = familias.get(senal);
      // `antes`: cuántos segundos antes del cartel se vio la señal en esta semilla.
      const t = f.tiempos?.[senal];
      const antes = t == null ? null : Math.round((f.revelado - t) * 10) / 10;
      for (const [regla, obs] of Object.entries(reglas)) (fam[regla] ??= []).push(obs && { ...obs, arco: f.arco, antes });
    }
  }
  const medidas = [...familias.entries()].map(([senal, fam]) => ({ senal, fam, ev: evaluarSenal(fam, { tamano: !delPlan }) }));
  const orden = { delator: 0, mirar: 1, limpia: 2, pocos: 3 };
  medidas.sort((a, b) => orden[a.ev.veredicto] - orden[b.ev.veredicto] || a.ev.p - b.ev.p);
  console.log(`  ${"señal".padEnd(18)} ${"regla".padEnd(14)} ${"aciertos".padStart(9)} ${"tasa".padStart(7)} ${"azar".padStart(7)} ${"veces".padStart(6)} ${"p".padStart(8)}`);
  for (const { senal, fam, ev } of medidas) {
    sumar(senal, ev.veredicto);
    const m = ev.mejor;
    if (!m) {
      console.log(`  ${iconos.pocos} ${senal.padEnd(16)} sin datos`);
      continue;
    }
    const veces = m.lift.toFixed(2).replace(".", ",");
    console.log(
      `  ${iconos[ev.veredicto]} ${senal.padEnd(16)} ${m.nombre.padEnd(14)} ${`${m.aciertos}/${m.n}`.padStart(9)} ${pct(m.tasa).padStart(7)} ${pct(m.azar).padStart(7)} ${veces.padStart(6)} ${formatoP(ev.p).padStart(8)}${ev.veredicto === "pocos" ? "  pocos datos" : ev.veredicto === "limpia" ? "" : `  ${ev.veredicto.toUpperCase()}${ev.sentido === "abajo" ? " (al revés: lo que señala pierde)" : ""}`}`,
    );
    if (ev.veredicto === "delator" || ev.veredicto === "mirar") {
      // Por arco: un delator suele vivir en uno solo. Y cuánto antes del
      // cartel se ve: a medio segundo no adelanta nada.
      const porArco = new Map();
      const antes = [];
      for (const o of fam[m.nombre] ?? []) {
        if (!o) continue;
        const x = porArco.get(o.arco) ?? { a: 0, n: 0 };
        x.n++;
        if (o.acierta) x.a++;
        porArco.set(o.arco, x);
        if (o.antes != null) antes.push(o.antes);
      }
      antes.sort((a, b) => a - b);
      const med = antes.length ? antes[Math.floor(antes.length / 2)].toFixed(1).replace(".", ",") : null;
      console.log(`      por arco: ${[...porArco].map(([a, x]) => `${a} ${x.a}/${x.n}`).join(" · ")}${med ? ` · se ve a ${med} s del cartel (mediana)` : ""}`);
    }
  }
  detalle.senales = Object.fromEntries(medidas.map(({ senal, ev }) => [senal, { veredicto: ev.veredicto, p: ev.p, sentido: ev.sentido, m: ev.m, reglas: ev.reglas }]));

  // Los repartos: en cuál de K casilleros cae la ganadora, contra el reparto parejo (chi cuadrado con K − 1 grados).
  const repartos = new Map();
  for (const f of filas) {
    for (const [senal, r] of Object.entries(f.repartos ?? {})) {
      const x = repartos.get(senal) ?? { K: r.K, conteos: new Array(r.K).fill(0), probs: r.probs ?? null, porArco: new Map(), antes: [], malos: 0 };
      if (r.K !== x.K) {
        x.malos++;
        repartos.set(senal, x);
        continue;
      }
      x.conteos[r.k]++;
      const pa = x.porArco.get(f.arco) ?? new Array(r.K).fill(0);
      pa[r.k]++;
      x.porArco.set(f.arco, pa);
      const t = f.tiempos?.[senal];
      if (t != null) x.antes.push(Math.round((f.revelado - t) * 10) / 10);
      repartos.set(senal, x);
    }
  }
  if (repartos.size) {
    console.log(`\n  ${"reparto".padEnd(18)} ${"casilleros".padStart(10)} ${"chi²".padStart(8)} ${"gl".padStart(3)} ${"p".padStart(8)}   el que más se aleja`);
    const evs = [...repartos].map(([senal, x]) => ({ senal, x, ev: evaluarReparto(x.conteos, x.probs) }));
    evs.sort((a, b) => orden[a.ev.veredicto] - orden[b.ev.veredicto] || a.ev.p - b.ev.p);
    for (const { senal, x, ev } of evs) {
      sumar(senal, ev.veredicto);
      const mas = ev.mas;
      const donde = mas ? `${casilleroDe(senal)} ${mas.indice + 1}: ${mas.observado} de ${coma(mas.esperado)} esperadas (${coma(mas.veces, 2)} veces)` : "";
      console.log(
        `  ${iconos[ev.veredicto]} ${senal.padEnd(16)} ${String(ev.K).padStart(10)} ${coma(ev.chi2).padStart(8)} ${String(ev.gl).padStart(3)} ${formatoP(ev.p).padStart(8)}   ${ev.veredicto === "pocos" ? "pocos datos" : donde}${ev.veredicto === "limpia" || ev.veredicto === "pocos" ? "" : `  ${ev.veredicto.toUpperCase()}`}`,
      );
      if (ev.veredicto === "delator" || ev.veredicto === "mirar") {
        console.log(`      cuántas veces en cada ${casilleroDe(senal)}: ${ev.conteos.join(" ")}`);
        for (const [arco, pa] of [...x.porArco].sort()) console.log(`      ${arco.padEnd(10)} ${pa.join(" ")}`);
        const antes = [...x.antes].sort((a, b) => a - b);
        if (antes.length) console.log(`      se ve a ${coma(antes[Math.floor(antes.length / 2)])} s del cartel (mediana)`);
      }
      if (x.malos) console.log(`      ${x.malos} rondas con otra cantidad de casilleros: no se cuentan`);
      detalle.repartos[senal] = { veredicto: ev.veredicto, K: ev.K, gl: ev.gl, chi2: ev.chi2, p: ev.p, conteos: ev.conteos, esperados: ev.esperados };
    }
  }

  // Los promedios: lo que sin señal vale cero.
  const medias = new Map();
  for (const f of filas) for (const [senal, m] of Object.entries(f.medias ?? {})) (medias.get(senal) ?? medias.set(senal, { v: [], sd: m.sd ?? null }).get(senal)).v.push(m.v);
  if (medias.size) {
    console.log(`\n  ${"promedio".padEnd(18)} ${"rondas".padStart(7)} ${"media".padStart(8)} ${"desvío".padStart(7)} ${"z".padStart(7)} ${"p".padStart(8)}`);
    const evs = [...medias].map(([senal, x]) => ({ senal, ev: evaluarMedia(x.v, { sd: x.sd }) }));
    evs.sort((a, b) => orden[a.ev.veredicto] - orden[b.ev.veredicto] || a.ev.p - b.ev.p);
    for (const { senal, ev } of evs) {
      sumar(senal, ev.veredicto);
      console.log(
        `  ${iconos[ev.veredicto]} ${senal.padEnd(16)} ${String(ev.n).padStart(7)} ${firmado(ev.media).padStart(8)} ${coma(ev.de, 3).padStart(7)} ${firmado(ev.z, 2).padStart(7)} ${formatoP(ev.p).padStart(8)}${ev.veredicto === "pocos" ? "  pocos datos" : ev.veredicto === "limpia" ? "" : `  ${ev.veredicto.toUpperCase()}`}`,
      );
      detalle.medias[senal] = { veredicto: ev.veredicto, n: ev.n, media: ev.media, de: ev.de, z: ev.z, p: ev.p };
    }
  }

  resumen.push(fila);
  salida.juegos[clave] = { ...detalle, ...(delPlan ? {} : { observaciones: filas }) };
}

if (trazas) mkdirSync(trazas, { recursive: true });
if (releer && !existsSync(releer)) {
  console.error(`no existe ${releer}`);
  process.exit(2);
}
// El navegador solo se abre si algún juego se mide ahí: la carrera se juzga en el plan.
const browser = releer || juegos.every(delPlan) ? null : await launch({ port: puerto, width: 1280, height: 720 });
const inicio = Date.now();
let lib = null;
try {
  for (const juego of juegos) {
    if (delPlan(juego)) {
      lib ??= await cargarCarrera();
      for (const n of tamanos) {
        console.log(`\n${juego} · ${rondas} rondas del plan · ${n} personas`);
        const desde = Date.now();
        const filas = [];
        for (let i = 1; i <= rondas; i++) {
          const { ctx } = rondaDe(lib, n, i);
          const o = observar(lib, lib.planCarrera(ctx), ctx);
          filas.push({ i, errores: 0, ...o });
        }
        console.log(`  (${((Date.now() - desde) / 1000).toFixed(1).replace(".", ",")} s)`);
        informar({ clave: `${juego}-n${n}`, etiqueta: `${juego} (${n} personas)`, filas, delPlan: true });
      }
      continue;
    }
    console.log(`\n${juego} · ${releer ? "trazas guardadas" : `${N} semillas`} · ${gente} personas`);
    const filas = [];
    let malas = 0, distintos = 0, k = 0;
    const desde = Date.now();
    for await (const tr of trazasDe(juego)) {
      k++;
      if (!tr.ok) {
        malas++;
        console.log(`  · semilla ${tr.i ?? k}: no llegó al ganador${tr.excepciones?.[0] ? ` (${tr.excepciones[0].slice(0, 80)})` : ""}`);
        continue;
      }
      if (cotejar && cotejar(tr.pose.names, tr.semilla) !== tr.pose.winners[0]) distintos++;
      const s = senales(tr, juego);
      filas.push({ i: tr.i ?? k, ganador: tr.pose.winners[0], arco: s.arco, errores: tr.errores + (tr.excepciones?.length ?? 0), revelado: s.revelado, tiempos: s.tiempos, senales: s.senales });
      if (!releer && k % 20 === 0) {
        const seg = (Date.now() - desde) / 1000 / k;
        console.log(`  … ${k}/${N} (${seg.toFixed(1)} s por semilla, faltan unos ${Math.ceil((seg * (N - k)) / 60)} min)`);
      }
    }
    informar({ clave: juego, etiqueta: juego, filas, malas, distintos });
  }
} finally {
  navegador?.ws.close();
  if (browser) await browser.close();
}

const min = ((Date.now() - inicio) / 60000).toFixed(1).replace(".", ",");
console.log(`\nResumen (${min} min):`);
for (const f of resumen) console.log(`  ${f.juego.padEnd(24)} ${f.delator.length ? `DELATA: ${f.delator.join(", ")}` : "sin delatores"}${f.mirar.length ? ` · a mirar: ${f.mirar.join(", ")}` : ""}`);
const esperadas = falsasAlarmas(juzgadas);
console.log(`  ${juzgadas} señales juzgadas: por pura casualidad se esperan ${esperadas.toFixed(2).replace(".", ",")} falsas alarmas con el umbral de 1 en ${Math.round(1 / UMBRAL.alfa)}.`);
if (json) {
  writeFileSync(json, JSON.stringify(salida, null, 1));
  console.log(`  detalle en ${json}`);
}
const hay = resumen.some((f) => f.delator.length);
console.log(`\n${hay ? "RECHAZADO: hay delatores" : "APROBADO: ningún delator"}`);
emitirJson({
  auditor: "audit-delatores",
  objetivo: cual,
  checks: resumen.map((f) => ({
    name: `${f.juego}: ninguna señal adivina al ganador`,
    ok: !f.delator.length,
    detail: f.delator.length ? `delata: ${f.delator.join(", ")}` : f.mirar.length ? `a mirar: ${f.mirar.join(", ")}` : "",
  })),
});
process.exit(hay ? 1 : 0);
