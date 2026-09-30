#!/usr/bin/env node
/**
 * El auditor de física.
 *
 * Los juegos con cuerpos que chocan entre sí (las bolas de la tómbola, los
 * q'epis del aguayo) y luz roja, luz verde anotan con `?auditar=fisica` lo
 * encimados que quedan después de cada paso y si alguno se escapó de donde
 * tiene que estar. Este auditor los corre en varias semillas y con 2, 18, 60 y
 * 200 personas, y comprueba:
 *
 * - **Nadie atraviesa a nadie.** Después de cada paso de física, ningún par
 *   queda encimado más de un 12% del diámetro. En las capturas del 29 de
 *   septiembre de 2026 se veían bolas de la tómbola encimadas.
 * - **Nadie se escapa.** Ninguna bola sale del bombo, ningún q'epi de la tela.
 * - **Reproducible.** La misma semilla anota lo mismo, número por número.
 *
 * El trompo tiene su propio auditor, más fino: `audit-choques.mjs`.
 *
 * Corre sin red, con la escena fija y el reloj en turbo.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-fisica.mjs [juego|todos] [--base http://localhost:4173] [--semillas 4]
 */
import { createHash } from "node:crypto";
import { launch } from "./lib/browser.mjs";

const TODOS = ["tombola", "pasanaku", "luz"];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? TODOS : [cual];
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const SEMILLAS = Number(opt("--semillas", "4"));
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

async function correr(browser, juego, { seed, gente = 0 }) {
  const page = await browser.open("about:blank");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
  await page.send("Page.navigate", { url: `${base}/?pose=${juego}&motor=pixi&pace=normal&auditar=fisica&semilla=${semilla(seed)}${gente ? `&n=${gente}` : ""}` });
  const ok = await page.waitFor("window.__fisica && window.__fisica.done", 90_000);
  const log = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__fisica)")) : null;
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

const browser = await launch({ port: Number(process.env.CDP_PORT || 9461), width: 1280, height: 720 });
try {
  for (const juego of juegos) {
    const corridas = [];
    for (let i = 1; i <= SEMILLAS; i++) corridas.push({ nombre: `semilla ${i}`, seed: i });
    for (const gente of [2, 60, 200]) corridas.push({ nombre: `con ${gente}`, seed: 1, gente });
    let primera = null;
    for (const c of corridas) {
      const r = await correr(browser, juego, c);
      console.log(`\n${juego} · ${c.nombre}${r.log ? ` · ${r.log.n} personas · ${r.log.pasos} pasos` : ""}`);
      if (!r.log) {
        check("la escena corre y anota la física", false, "no terminó en 90 s");
        continue;
      }
      if (c.nombre === "semilla 1") primera = r.log;
      check("sin errores", r.errores + r.excepciones.length === 0, r.excepciones[0]?.slice(0, 100) ?? "");
      check("nadie atraviesa a nadie", r.log.maxOverlap < 0.12, `lo más encimado: ${(r.log.maxOverlap * 100).toFixed(1)}% del diámetro${r.log.maxAt !== undefined ? `, a los ${r.log.maxAt} s` : ""}`);
      check("nadie se escapa", r.log.escapes === 0, r.log.escapes ? `${r.log.escapes} veces afuera` : "");
      // Luz roja, luz verde: el haz solo agarra a los que se mueven, y con luz
      // roja nadie más se mueve.
      if (r.log.catches) {
        const quietos = r.log.catches.filter((c) => !(c.v > 0.01));
        const lejos = r.log.catches.filter((c) => c.dist > 0.13);
        check("a nadie lo agarran quieto", quietos.length === 0, quietos.length ? `${quietos.length} agarrados quietos` : `${r.log.catches.length} agarrados, todos moviéndose`);
        check("el haz los agarra cuando pasa por encima", lejos.length === 0, lejos.length ? `${lejos.length} agarrados lejos del haz` : "");
        check("con luz roja nadie más se mueve", r.log.redMove === 0, `lo más rápido: ${r.log.redMove}`);
        check("agarra a todos los que tocaba, y nunca a la ganadora", r.log.catches.length === r.log.planned && !r.log.catches.some((c) => c.idx === r.log.winner), `${r.log.catches.length} de ${r.log.planned}`);
      }
    }
    const otra = await correr(browser, juego, { seed: 1 });
    console.log(`\n${juego} · reproducible`);
    check("la misma semilla anota lo mismo", !!otra.log && !!primera && JSON.stringify(otra.log) === JSON.stringify(primera));
  }
} finally {
  browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
