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
 * Uso:
 *   pnpm build && pnpm preview --port 4173 &
 *   node scripts/audit-delatores.mjs [juego|todos|race,sapo] [--semillas 200] [--n 8]
 *        [--base http://localhost:4173] [--json salida.json] [--trazas carpeta] [--paralelo 1]
 *   node scripts/audit-delatores.mjs [juego|todos] --releer carpeta [--n 8]
 *
 * `--trazas` guarda lo grabado de cada semilla (comprimido), y `--releer` lo
 * vuelve a medir sin navegador: para revisar una señal nueva sin volver a
 * correr horas de semillas. `--paralelo` abre varias ventanas a la vez en el
 * mismo Chrome: lo medido no cambia, y con cuatro tarda la mitad o menos.
 * Cada semilla tarda entre 3 y 15 segundos según el juego y la carga: los diez
 * del selector con doscientas son unas dos o tres horas. Un Chrome a la vez, con su puerto: CDP_PORT.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { CDP, launch } from "./lib/browser.mjs";
import { grabador } from "./lib/delatores-grabador.mjs";
import { grabarPara, senales } from "./lib/delatores-senales.mjs";
import { UMBRAL, evaluarSenal, falsasAlarmas, formatoP, pct } from "./lib/delatores.mjs";

/** Los diez del selector. Los que salieron (tombola, pasanaku, stellar) se piden por nombre. */
const TODOS = ["race", "sapo", "trompo", "chovena", "pinata", "wheel", "quien", "trueque", "teleferico", "oruro"];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? TODOS : cual.split(",");
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const N = Math.max(1, Number(opt("--semillas", "200")));
const gente = Math.max(2, Number(opt("--n", "8")));
const json = opt("--json", "");
const trazas = opt("--trazas", "");
const releer = opt("--releer", "");
const paralelo = Math.max(1, Math.min(6, Number(opt("--paralelo", "1"))));
process.env.TINKAZO_GPU = "1";

/** La semilla `i`: 64 hex, distintas de las del auditor de emoción. */
const semilla = (i) => createHash("sha256").update(`delator-${i}`).digest("hex");

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
    const url = `${base}/?pose=${juego}&semilla=${seed}&n=${gente}&ganador=${seed}&pace=normal&motor=pixi&lang=es`;
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
const resumen = [];
const salida = { umbral: UMBRAL, n: gente, semillas: N, juegos: {} };
let juzgadas = 0;

if (trazas) mkdirSync(trazas, { recursive: true });
if (releer && !existsSync(releer)) {
  console.error(`no existe ${releer}`);
  process.exit(2);
}
const browser = releer ? null : await launch({ port: puerto, width: 1280, height: 720 });
const inicio = Date.now();
try {
  for (const juego of juegos) {
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
    if (distintos) console.log(`  ✗ en ${distintos} semillas el ganador no es el de la selección del protocolo: ¿la página entiende ?ganador=?`);
    const errores = filas.reduce((a, f) => a + f.errores, 0);
    const arcos = filas.reduce((m, f) => m.set(f.arco, (m.get(f.arco) ?? 0) + 1), new Map());
    const ganadores = new Set(filas.map((f) => f.ganador)).size;
    console.log(`  ${filas.length} semillas medidas${malas ? `, ${malas} sin ganador` : ""}${errores ? `, ${errores} errores en la página` : ""} · ganadores distintos: ${ganadores} · arcos: ${[...arcos].map(([a, c]) => `${a} ${c}`).join(", ")}`);

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
    const medidas = [...familias.entries()].map(([senal, fam]) => ({ senal, fam, ev: evaluarSenal(fam) }));
    const orden = { delator: 0, mirar: 1, limpia: 2, pocos: 3 };
    medidas.sort((a, b) => orden[a.ev.veredicto] - orden[b.ev.veredicto] || a.ev.p - b.ev.p);
    console.log(`  ${"señal".padEnd(18)} ${"regla".padEnd(14)} ${"aciertos".padStart(9)} ${"tasa".padStart(7)} ${"azar".padStart(7)} ${"veces".padStart(6)} ${"p".padStart(8)}`);
    const fila = { juego, delator: [], mirar: [] };
    for (const { senal, fam, ev } of medidas) {
      if (ev.veredicto !== "pocos") juzgadas++;
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
        fila[ev.veredicto].push(senal);
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
    resumen.push(fila);
    salida.juegos[juego] = {
      semillas: filas.length,
      sinGanador: malas,
      arcos: Object.fromEntries(arcos),
      senales: Object.fromEntries(medidas.map(({ senal, ev }) => [senal, { veredicto: ev.veredicto, p: ev.p, sentido: ev.sentido, m: ev.m, reglas: ev.reglas }])),
      observaciones: filas,
    };
  }
} finally {
  navegador?.ws.close();
  if (browser) await browser.close();
}

const min = ((Date.now() - inicio) / 60000).toFixed(1).replace(".", ",");
console.log(`\nResumen (${min} min):`);
for (const f of resumen) console.log(`  ${f.juego.padEnd(12)} ${f.delator.length ? `DELATA: ${f.delator.join(", ")}` : "sin delatores"}${f.mirar.length ? ` · a mirar: ${f.mirar.join(", ")}` : ""}`);
const esperadas = falsasAlarmas(juzgadas);
console.log(`  ${juzgadas} señales juzgadas: por pura casualidad se esperan ${esperadas.toFixed(2).replace(".", ",")} falsas alarmas con el umbral de 1 en ${Math.round(1 / UMBRAL.alfa)}.`);
if (json) {
  writeFileSync(json, JSON.stringify(salida, null, 1));
  console.log(`  detalle en ${json}`);
}
const hay = resumen.some((f) => f.delator.length);
console.log(`\n${hay ? "RECHAZADO: hay delatores" : "APROBADO: ningún delator"}`);
process.exit(hay ? 1 : 0);
