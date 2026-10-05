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
 * La carrera corre ocho carriles por diseño y la ruleta llega a 24: cada juego
 * se mide hasta lo que promete.
 *
 * Corre sin red, con la escena fija y el reloj en turbo.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-identidad.mjs [juego|todos] [--base http://localhost:4173]
 */
import { launch } from "./lib/browser.mjs";

const TODOS = ["race", "luz", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien"];
/** Hasta cuántos promete cada juego hoy: la carrera corre ocho, la ruleta llega a 24, el resto a 200. */
const PROMETE = { race: 8, wheel: 24 };
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? TODOS : [cual];
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
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
    for (const gente of [8, 18, 50]) {
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
    }
    resumen.push(fila);
  }
} finally {
  browser.close();
}

console.log("\nCuántos se ven antes del ganador:");
console.log("  juego        con 8   con 18  con 50");
for (const f of resumen) console.log(`  ${f.juego.padEnd(12)} ${String(f[8] ?? "").padStart(5)}  ${String(f[18] ?? "").padStart(6)}  ${String(f[50] ?? "").padStart(6)}`);
const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
