#!/usr/bin/env node
/**
 * El auditor de choques del trompo.
 *
 * Los otros auditores miran la pantalla y el sonido. Este mira la física: que
 * cada golpe sea un golpe. Existe porque hasta el 29 de septiembre de 2026 el
 * trompo que salía volaba solo, y las chispas aparecían a mitad de camino entre
 * dos trompos que a veces ni se tocaban. Nadie lo marcaba porque ningún
 * auditor sabía qué era un choque.
 *
 * El juego anota cada golpe cuando la página tiene `?auditar=choques` (ver
 * `src/games/pixi/trompo.ts`), y acá se comprueba, en varias semillas y con
 * 2, 3, 18, 60 y 200 personas:
 *
 * - **Contacto de verdad.** Cada golpe que saca o que roza pasa con los dos
 *   trompos tocándose, y ninguno se da forzado porque el que pegaba no llegó.
 *   Lo mismo cada choque del mano a mano, y son los que el guion dice.
 * - **Acción y reacción.** El golpeado sale hacia donde lo empujan y el que
 *   pega retrocede.
 * - **Nadie atraviesa a nadie.** Después de cada paso de física, ningún par
 *   queda encimado más de un 12% del diámetro.
 * - **El sacado termina afuera de la tiza.**
 * - **El golpe se siente.** Los choques del mano a mano tienen su parada, el
 *   último su cámara lenta, y las paradas no se amontonan: dos seguidas a
 *   menos de 0,35 s serían tartamudear.
 * - **Nada decide nada.** La ganadora nunca sale y es la única al final, la
 *   rival sale última, y cada uno sale en su ventana: entre que el que pega se
 *   echa atrás y el margen del golpe forzado.
 * - **Reproducible.** La misma semilla anota los mismos golpes, número por número.
 *
 * Corre sin red, con la escena fija y el reloj en turbo, como el auditor de
 * emoción: cada cuadro real despacha veinte cuadros de juego de 1/64 s.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-choques.mjs [--base http://localhost:4173] [--semillas 8]
 */
import { createHash } from "node:crypto";
import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const SEMILLAS = Number(opt("--semillas", "8"));
process.env.TINKAZO_GPU = "1";

const TURBO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0;
  const cbs = new Map();
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    for (let i = 0; i < 20 && cbs.size; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      for (const cb of lote) { try { cb(virt); } catch (e) { window.__errores = (window.__errores || 0) + 1; } }
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");

async function correr(browser, { seed, gente = 0 }) {
  const page = await browser.open("about:blank");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
  const url = `${base}/?pose=trompo&motor=pixi&pace=normal&auditar=choques&semilla=${semilla(seed)}${gente ? `&n=${gente}` : ""}`;
  await page.send("Page.navigate", { url });
  const ok = await page.waitFor("window.__choques && window.__choques.done", 90_000);
  const log = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__choques)")) : null;
  const errores = Number(await page.eval("window.__errores || 0").catch(() => 0));
  const excepciones = [...page.exceptions];
  try {
    await page.send("Page.close");
  } catch {
    /* ya cerrada */
  }
  return { log, errores, excepciones };
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

/** Mide una corrida y devuelve lo que falló, con detalle. */
function medir(log) {
  const golpes = log.events.filter((e) => e.tipo !== "duelo");
  const duelos = log.events.filter((e) => e.tipo === "duelo");
  const sinTocar = golpes.filter((e) => e.gap > 1.0001);
  const forzados = golpes.filter((e) => e.forced);
  const duelosMal = duelos.filter((e) => e.gap > 1.0001 || e.forced);
  const alReves = log.events.filter((e) => !(e.dvV > 0 && e.dvH < 0));
  const sacados = new Set(log.outs.filter((o) => o.tipo === "kick").map((o) => o.idx));
  const adentro = log.afuera.filter((a) => sacados.has(a.idx) && a.r <= 0.9);
  const sinDato = [...sacados].filter((i) => !log.afuera.some((a) => a.idx === i));
  const paradas = [...log.stops].sort((a, b) => a.t - b.t);
  const pegadas = paradas.slice(1).filter((s, i) => s.t - paradas[i].t < 0.35);
  // Cada uno sale en su ventana: desde que el que pega se echa atrás hasta el
  // margen del golpe forzado. Los que se caen de golpe al empezar el mano a
  // mano no tienen ventana: son los que no alcanzaron a salir antes.
  const plan = new Map(log.plan.map((p) => [p.idx, p]));
  const fueraDeHora = log.outs.filter((o) => {
    const p = plan.get(o.idx);
    if (!p) return false;
    return o.t < p.at - log.windows.wind - 0.01 || o.t > p.at + log.windows.grace + 0.02;
  });
  const ultimo = log.outs.at(-1);
  const rivalUltima = log.planned.length === 0 || (ultimo && ultimo.idx === log.rival);
  const ganadoraSale = log.outs.some((o) => o.idx === log.winner);
  const soloElla = log.aliveAtCrown.length === 1 && log.aliveAtCrown[0] === log.winner;
  return {
    golpes: golpes.length, sacan: golpes.filter((e) => e.tipo === "saca").length, duelos: duelos.length,
    sinTocar, forzados, duelosMal, alReves, adentro, sinDato, pegadas, fueraDeHora,
    rivalUltima, ganadoraSale, soloElla, overlap: log.maxOverlap,
    duelosPlaneados: log.planned.length ? log.clashes : 0,
    paradasDuelo: duelos.every((e) => e.stop > 0), lenta: duelos.length === 0 || log.slow > 0,
    borde: log.arc !== "remontada" || log.planned.length === 0 || log.events.some((e) => e.tipo === "borde"),
  };
}

const browser = await launch({ port: Number(process.env.CDP_PORT || 9451), width: 1280, height: 720 });
try {
  const corridas = [];
  for (let i = 1; i <= SEMILLAS; i++) corridas.push({ nombre: `semilla ${i}`, seed: i });
  for (const gente of [2, 3, 60, 200]) corridas.push({ nombre: `con ${gente}`, seed: 1, gente });

  const medidas = [];
  for (const c of corridas) {
    const r = await correr(browser, c);
    if (!r.log) {
      console.log(`\n${c.nombre}`);
      check("la escena corre y anota los golpes", false, "no terminó en 90 s");
      continue;
    }
    const m = medir(r.log);
    medidas.push({ ...c, log: r.log, m });
    console.log(`\n${c.nombre} · ${r.log.n} personas · arco ${r.log.arc} · ${m.golpes} golpes (${m.sacan} sacan), ${m.duelos} choques en el mano a mano`);
    check("sin errores", r.errores + r.excepciones.length === 0, r.excepciones[0]?.slice(0, 100) ?? "");
    check(
      "cada golpe toca de verdad",
      m.sinTocar.length === 0 && m.forzados.length === 0,
      m.sinTocar.length || m.forzados.length
        ? `${m.sinTocar.length} sin tocar, ${m.forzados.length} forzados de ${m.golpes}`
        : `${m.golpes} de ${m.golpes}`,
    );
    check(
      "cada choque del mano a mano toca de verdad",
      m.duelosMal.length === 0 && m.duelos === m.duelosPlaneados,
      `${m.duelos - m.duelosMal.length} de ${m.duelosPlaneados}`,
    );
    check("acción y reacción: el golpeado sale, el que pega retrocede", m.alReves.length === 0, m.alReves.length ? `${m.alReves.length} al revés` : "");
    check("nadie atraviesa a nadie", m.overlap < 0.12, `lo más encimado: ${(m.overlap * 100).toFixed(1)}% del diámetro`);
    check(
      "el sacado termina afuera de la tiza",
      m.adentro.length === 0 && m.sinDato.length === 0,
      m.adentro.length || m.sinDato.length ? `${m.adentro.length} adentro, ${m.sinDato.length} sin llegar a apagarse` : "",
    );
    check(
      "el golpe se siente: paradas en el mano a mano, cámara lenta al final, sin amontonarse",
      m.paradasDuelo && m.lenta && m.pegadas.length === 0,
      m.pegadas.length ? `${m.pegadas.length} paradas a menos de 0,35 s` : "",
    );
    check("la remontada tiene su golpe contra la tiza", m.borde);
    check(
      "la ganadora nunca sale y es la única al final; la rival sale última",
      !m.ganadoraSale && m.soloElla && m.rivalUltima,
      `${m.ganadoraSale ? "la sacaron · " : ""}${m.soloElla ? "" : `quedan ${r.log.aliveAtCrown.length} · `}${m.rivalUltima ? "" : "la rival no salió última"}`,
    );
    check("cada uno sale en su ventana", m.fueraDeHora.length === 0, m.fueraDeHora.length ? `${m.fueraDeHora.length} fuera de hora` : "");
    if (r.log.n >= 4) check("hay golpes que sacan", m.sacan >= 1, `${m.sacan}`);
  }

  // La misma semilla, otra vez: los mismos golpes, número por número.
  console.log("\nreproducible");
  const otra = await correr(browser, { seed: 1 });
  const primera = medidas.find((x) => x.nombre === "semilla 1");
  check(
    "la misma semilla anota los mismos golpes",
    !!otra.log && !!primera && JSON.stringify(otra.log) === JSON.stringify(primera.log),
    otra.log && primera ? `${otra.log.events.length} golpes` : "",
  );

  // Que los arcos que se auditaron cubran los cuatro, o casi.
  const arcos = new Set(medidas.filter((x) => !x.gente).map((x) => x.log.arc));
  check("las semillas cubren al menos tres arcos", arcos.size >= 3, [...arcos].join(", "));
} finally {
  browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
