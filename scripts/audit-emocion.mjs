#!/usr/bin/env node
/**
 * El auditor de emoción.
 *
 * Los otros auditores miran un sorteo por vez. Este mira muchos, porque lo que
 * mata la emoción no se ve en uno solo: se ve cuando la sala ya aprendió cómo
 * termina. La carrera de llamas remontaba siempre desde atrás al 80%, y a los
 * dos sorteos todos miraban a la última.
 *
 * Para cada juego corre dieciséis semillas y mide:
 *
 * - **Que los arcos varíen.** El director de emoción (`src/games/drama.ts`)
 *   elige uno de cuatro por sorteo; ninguno puede salir en más de la mitad, y
 *   tienen que aparecer al menos tres.
 * - **En la carrera, que el puesto de la ganadora a mitad de camino no la
 *   delate.** Si a la mitad siempre va primera, o siempre última, la sala lo
 *   aprende. Ningún puesto puede repetirse en más de la mitad de las carreras,
 *   y la ganadora tiene que ir adelante en algunas y atrás en otras.
 *
 * Para no esperar treinta segundos por semilla, cambia el reloj como el
 * auditor exigente, pero en turbo: cada cuadro real despacha veinte cuadros de
 * juego. La animación es función del tiempo de juego, así que el resultado es
 * el mismo que a velocidad normal.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-emocion.mjs [juego|todos] [--semillas 16]
 */
import { createHash } from "node:crypto";
import { launch, sleep } from "./lib/browser.mjs";

const TODOS = ["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien"];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = cual === "todos" ? TODOS : [cual];
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const N = Number(opt("--semillas", "16"));
// El motor nuevo es el de todos desde el 28 de septiembre (docs/motores.md);
// `--motor clasico` mide los juegos del motor anterior. El nuevo usa la placa de video.
const motor = opt("--motor", "pixi");
if (motor !== "clasico") process.env.TINKAZO_GPU = "1";

/** El reloj en turbo: veinte cuadros de juego por cuadro real, de a 1/64 s. */
const TURBO = `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0;
  const cbs = new Map();
  window.__v = () => virt;
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const bombear = () => {
    for (let i = 0; i < 20 && cbs.size; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      for (const cb of lote) { try { cb(virt); } catch (e) {} }
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
const cuenta = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

const browser = await launch({ port: Number(process.env.CDP_PORT || 9401), width: 1280, height: 720 });
try {
  for (const juego of juegos) {
    console.log(`\n${juego}`);
    const arcos = [];
    const aMitad = [];
    for (let i = 1; i <= N; i++) {
      const page = await browser.open("about:blank");
      await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
      await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&semilla=${semilla(i)}${motor ? `&motor=${motor}` : ""}` });
      const ok = await page.waitFor("document.getElementById('race-canvas').dataset.arco", 20_000);
      if (!ok.ok) {
        arcos.push("?");
      } else {
        arcos.push(await page.eval("document.getElementById('race-canvas').dataset.arco"));
      }
      // En la carrera, el puesto de la ganadora a mitad de camino. Lo anota la
      // carrera misma en el cuadro en que cruza la mitad, con su propio reloj.
      // Antes se leía cuando la hora de la página llegaba a quince segundos, y
      // esa hora corre en turbo también mientras el juego se descarga: con el
      // motor nuevo, que tarda más en arrancar, la foto caía antes de la mitad.
      if ((juego === "race" || juego === "rockets") && ok.ok) {
        const mitad = "document.getElementById('race-canvas').dataset.mitad";
        await page.waitFor(mitad, 20_000);
        aMitad.push(Number(await page.eval(`${mitad} || 0`)));
      }
      try {
        await page.send("Page.close");
      } catch {
        /* ya cerrada */
      }
    }
    const c = cuenta(arcos);
    const peor = Math.max(...c.values());
    check(
      "los arcos varían",
      c.size >= 3 && peor <= N / 2 && !c.has("?"),
      [...c.entries()].map(([a, k]) => `${a} ${k}`).join(" · "),
    );
    if (aMitad.length) {
      const p = cuenta(aMitad);
      const mas = Math.max(...p.values());
      const adelante = aMitad.filter((x) => x <= 2).length;
      const atras = aMitad.filter((x) => x >= 5).length;
      // Si apostar por la que va primera a la mitad, o por la última, acierta
      // en más del 40% de las carreras, es una pista: al azar se acierta en
      // una de ocho.
      const primera = aMitad.filter((x) => x === 1).length;
      const ultima = aMitad.filter((x) => x === 8).length;
      check(
        "a mitad de carrera, el puesto de la ganadora no la delata",
        mas <= N / 2 && adelante > 0 && atras > 0 && primera <= N * 0.4 && ultima <= N * 0.4 && adelante <= N * 0.6 && atras <= N * 0.6,
        `puestos ${aMitad.join(" ")} · primera en ${primera}, última en ${ultima}, adelante en ${adelante}, atrás en ${atras}`,
      );
    }
  }
} finally {
  await browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
process.exit(malos.length ? 1 : 0);
