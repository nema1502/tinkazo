#!/usr/bin/env node
/**
 * El auditor de identificación: ¿cada uno llega a verse?
 *
 * En un sorteo pierden casi todos, y lo que mantiene a la sala adentro es poder
 * seguirse: saber en dos segundos si uno sigue en juego. La forma más directa es
 * ver el propio nombre. Con `?auditar=identidad` el estadio anota cuándo se leyó
 * por primera vez cada nombre, en la escena o en el HUD, antes de que salga el
 * cartel del ganador (`identidadDe` en src/games/pixi/stage.ts). Un nombre cuenta
 * si se ve entero en pantalla, con opacidad de 0,6 o más y un alto de al menos
 * 1,6% de la pantalla; las etiquetas cortas ("María Q.") cuentan si no se
 * confunden con otro nombre.
 *
 * Lo pidió Nicolás el 4 de octubre de 2026, mirando la tómbola: salía el número
 * de la bola ganadora y nadie sabía de quién era. Comprueba:
 *
 * - **Con 8, todos se ven** antes del ganador, en todos los juegos.
 * - **Con 18, se ven 9 de cada 10** en los juegos que prometen 18 o más.
 * - Con 50, cuántos: se informa, sin aprobar ni rechazar todavía.
 *
 * Todos prometen hasta 200 (la ruleta, con más de veinticuatro, reúne grupos en
 * cada gajo; con más de 200 pasa a la tómbola): cada juego se mide hasta lo que promete.
 *
 * Corre sin red, con la escena fija y el reloj en turbo.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-identidad.mjs [juego|todos] [--base http://localhost:4173] [--gente 8,18,50]
 *
 * `--gente` cambia las cantidades que se miden (por defecto 8, 18 y 50). La
 * ruleta con más de veinticuatro se mide con `--gente 8,18,50,100,200`.
 */
import { launch } from "./lib/browser.mjs";

const TODOS = ["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien", "trueque"];
/**
 * Hasta cuántos promete cada juego, si no es 200. Hoy ninguno tiene menos: la
 * ruleta llega a 200 desde el 21 de octubre de 2026 (antes, 24). La carrera
 * prometía ocho hasta el 17 de octubre de 2026; desde la clasificatoria, todos
 * se ven antes de que corran los ocho de la final.
 */
const PROMETE = {};
/** Índice del ganador en la escena fija (`?pose=`): la cuarta persona de la lista. */
const GANADOR = 3;
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? TODOS : [cual];
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const GENTE = opt("--gente", "8,18,50").split(",").map((x) => Number(x.trim())).filter((x) => x > 0);
process.env.TINKAZO_GPU = "1";

const TURBO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0;
  const cbs = new Map();
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    for (let i = 0; i < 12 && cbs.size; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 60;
      for (const cb of lote) { try { cb(virt); } catch (e) { window.__errores = (window.__errores || 0) + 1; } }
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

async function correr(browser, juego, gente) {
  const page = await browser.open("about:blank");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
  await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&motor=pixi&pace=normal&auditar=identidad&n=${gente}` });
  const ok = await page.waitFor("window.__identidad && window.__identidad.revelado !== null", 120_000);
  const est = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__identidad)")) : null;
  const errores = Number(await page.eval("window.__errores || 0").catch(() => 0));
  const excepciones = [...page.exceptions];
  try {
    await page.send("Page.close");
  } catch {
    /* ya cerrada */
  }
  return { est, errores, excepciones };
}

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const resumen = [];

const browser = await launch({ port: Number(process.env.CDP_PORT || 9471), width: 1280, height: 720 });
try {
  for (const juego of juegos) {
    const tope = PROMETE[juego] ?? 200;
    console.log(`\n${juego} (promete hasta ${tope})`);
    const fila = { juego };
    for (const gente of GENTE) {
      if (gente > tope) {
        fila[gente] = "—";
        continue;
      }
      const r = await correr(browser, juego, gente);
      if (!r.est) {
        check(`con ${gente}: la escena corre y llega al ganador`, false, "no llegó en 120 s");
        fila[gente] = "?";
        continue;
      }
      const vistos = r.est.vistos.filter((t) => t >= 0);
      const pct = Math.round((vistos.length / r.est.n) * 100);
      const ultimo = vistos.length ? Math.max(...vistos) : 0;
      const detalle = `${vistos.length} de ${r.est.n} (${pct}%) antes del ganador, a los ${r.est.revelado.toFixed(1)} s${vistos.length ? `; el último en verse, a los ${ultimo.toFixed(1)} s` : ""}`;
      fila[gente] = `${pct}%`;
      if (r.errores + r.excepciones.length) check(`con ${gente}: sin errores`, false, r.excepciones[0]?.slice(0, 100) ?? `${r.errores} errores`);
      if (gente === 8) check("con 8, todos se ven", vistos.length === r.est.n, detalle);
      else if (gente === 18) check("con 18, se ven 9 de cada 10", vistos.length >= Math.ceil(r.est.n * 0.9), detalle);
      else console.log(`  · con ${gente}: ${detalle}`);
      // El ganador lo fija la escena fija: la cuarta persona (`W3` en src/main.ts).
      // Tiene que leerse antes del cartel, si no nadie sabe de quién es.
      if (gente >= 4) {
        const v = r.est.vistos[GANADOR];
        check(`con ${gente}: el nombre del ganador se lee antes del cartel`, v >= 0, v >= 0 ? `a los ${v.toFixed(1)} s, el cartel a los ${r.est.revelado.toFixed(1)} s` : "no se leyó antes del cartel");
      }
    }
    resumen.push(fila);
  }
} finally {
  await browser.close();
}

console.log("\nCuántos se ven antes del ganador:");
console.log(`  juego       ${GENTE.map((g) => `con ${g}`.padStart(8)).join("")}`);
for (const f of resumen) console.log(`  ${f.juego.padEnd(12)}${GENTE.map((g) => String(f[g] ?? "").padStart(8)).join("")}`);
const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
