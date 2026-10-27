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
 * - **El zoom del golpe.** Cuántas veces más cerca está la cámara en el golpe que
 *   en el plano general (la escala de la escena, que es la que se ve): al menos
 *   1,6×. Corre el show entero con `?auditar=camara`, así que se mide en las
 *   primeras `--semillas-zoom` (2) y no en las dieciséis. Con `--json`, la línea
 *   trae `datos.zoom` por juego (mínimo, mediana, máximo y cuántas semillas
 *   tuvieron golpe) y `datos.arcos`.
 *
 * Para no esperar treinta segundos por semilla, cambia el reloj como el
 * auditor exigente, pero en turbo: cada cuadro real despacha veinte cuadros de
 * juego. La animación es función del tiempo de juego, así que el resultado es
 * el mismo que a velocidad normal.
 *
 * Uso:
 *   pnpm preview &
 *   node scripts/audit-emocion.mjs [juego|todos] [--semillas 16] [--vista 390x844]
 *
 * `--vista 390x844` mira el show en la pantalla de un celular parado (por defecto, la
 * ventana de 1280x720): el golpe tiene que llegar también ahí. `--solo-zoom` se salta las
 * dieciséis semillas de los arcos y mira nada más el zoom y el cuadro del golpe (unos
 * minutos para los diez juegos en lugar de media hora).
 */
import { createHash } from "node:crypto";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";
import { LOS_DIEZ as CON_ZOOM_TODOS, juegosDe, juegosDelKit } from "./lib/juegos.mjs";
import { ZOOM_MINIMO, fallasDeCuadro, instalarZoom, juntarCuadros, razonDeZoom, resumirZoom, veces } from "./lib/zoom.mjs";

/**
 * Los juegos que tienen zoom de emoción (`Camera.golpe` en `docs/motores.md`):
 * el pico del zoom tiene que caer en el golpe, que es el instante en que sale el
 * cartel. Los demás todavía no lo tienen y no se miran.
 */
// Los diez que todavía abren tienen el golpe de cámara (barrido de letra, 26 de octubre de 2026), y todo juego del kit:
// el director de cámara hace el golpe (`kit/director.ts`).
const CON_ZOOM = [...new Set([...CON_ZOOM_TODOS, ...juegosDelKit()])];
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const cual = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "todos";
const juegos = juegosDe(cual);
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const N = Number(opt("--semillas", "16"));
// El zoom del golpe necesita correr el show entero (el golpe cae al final) y no
// depende del arco: se mira en las primeras semillas nada más. 0 lo saltea.
const zoomSemillas = Number(opt("--semillas-zoom", "2"));
const zoomMin = Number(opt("--zoom-min", String(ZOOM_MINIMO)));
/** `--solo-zoom`: sin las semillas de los arcos ni la carrera a mitad de camino. */
const soloZoom = args.includes("--solo-zoom");
// El motor nuevo es el de todos desde el 28 de septiembre (docs/motores.md);
// `--motor clasico` mide los juegos del motor anterior. El nuevo usa la placa de video.
const motor = opt("--motor", "pixi");
/** `--vista 390x844`: otra pantalla (celular, tablet, girado); sin ella, la ventana de siempre. */
const vista = (opt("--vista", "").match(/^(\d+)x(\d+)$/) ?? []).slice(1).map(Number);
const conVista = vista.length === 2;
/** Una pestaña nueva, en la pantalla pedida. */
async function abrir() {
  const page = await browser.open("about:blank");
  if (conVista) await page.send("Emulation.setDeviceMetricsOverride", { width: vista[0], height: vista[1], deviceScaleFactor: 1, mobile: (vista[0] ?? 1280) < 700, screenWidth: vista[0], screenHeight: vista[1] });
  return page;
}
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

/**
 * Lo mismo, y además mide el zoom del director: la escala de la escena antes del
 * golpe (el plano general más ancho) y en el golpe (`scripts/lib/zoom.mjs`).
 */
const TURBO_ZOOM = TURBO.replace("performance.now = () => virt;", () => `performance.now = () => virt;
  (${instalarZoom.toString()})();`).replace(
  "for (const cb of lote) { try { cb(virt); } catch (e) {} }",
  () => `for (const cb of lote) { try { cb(virt); } catch (e) {} }
      try { window.__zoom.medir(); } catch (e) {}`,
);
if (!TURBO_ZOOM.includes("__zoom.medir") || !TURBO_ZOOM.includes("window.__zoom = Z")) throw new Error("no pude armar el reloj con zoom");

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
const cuenta = (xs) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());

// Lo que `--json` deja además de las comprobaciones: el zoom del golpe y los arcos, por juego.
const datos = { zoom: {}, arcos: {} };

const browser = await launch({ port: Number(process.env.CDP_PORT || 9401), width: 1280, height: 720 });
try {
  for (const juego of juegos) {
    console.log(`\n${juego}`);
    const arcos = [];
    const aMitad = [];
    const zooms = [];
    for (let i = 1; i <= (soloZoom ? 0 : N); i++) {
      const page = await abrir();
      await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
      // `auditar=marcas`: el juego anota su arco y el puesto de la ganadora en el lienzo solo si se lo piden (`kit/marcas.ts`).
      await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&semilla=${semilla(i)}&auditar=marcas${motor ? `&motor=${motor}` : ""}` });
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
      if (CON_ZOOM.includes(juego) && ok.ok) {
        // El golpe lo anota el juego al salir el cartel, y el pico del zoom lo
        // anota el escenario. Los dos están en la hora de la cámara.
        const g = await page.waitFor("document.getElementById('race-canvas').dataset.golpe", 30_000);
        if (g.ok) {
          const golpe = Number(await page.eval("document.getElementById('race-canvas').dataset.golpe"));
          const pico = Number(await page.eval("document.getElementById('race-canvas').dataset.zoomPico || '-1'"));
          zooms.push({ golpe, pico });
        } else {
          zooms.push(null);
        }
      }
      try {
        await page.send("Page.close");
      } catch {
        /* ya cerrada */
      }
    }
    const c = cuenta(arcos);
    const peor = Math.max(...c.values());
    datos.arcos[juego] = Object.fromEntries(c);
    if (!soloZoom) check(
      "los arcos varían",
      c.size >= 3 && peor <= N / 2 && !c.has("?"),
      [...c.entries()].map(([a, k]) => `${a} ${k}`).join(" · "),
    );
    if (CON_ZOOM.includes(juego) && !soloZoom) {
      // El pico entre el golpe y 0,35 s después: el acercamiento llega en una
      // décima y se sostiene 0,3 s (`zoom-emocion.ts`).
      const en = zooms.filter((z) => z && z.pico - z.golpe >= -0.01 && z.pico - z.golpe <= 0.35).length;
      check(
        "el zoom de emoción cae en el golpe",
        zooms.length === N && en === N,
        zooms.map((z) => (z ? `golpe ${z.golpe.toFixed(2)} pico ${z.pico.toFixed(2)}` : "sin golpe")).slice(0, 4).join(" · ") + ` · ${en}/${N}`,
      );
    }
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
    // El zoom del director: en el golpe, cuántas veces más cerca que el plano general.
    if (zoomSemillas > 0) {
      const razones = [];
      const muestras = [];
      const cuadros = [];
      for (let i = 1; i <= zoomSemillas; i++) {
        const page = await abrir();
        await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO_ZOOM });
        await page.send("Page.navigate", { url: `${base}/?pose=${juego === "race" ? "1" : juego}&semilla=${semilla(i)}&auditar=camara${motor ? `&motor=${motor}` : ""}` });
        // El show terminó cuando el estadio, que se vio abierto, se cierra. Si no
        // cierra en dos minutos, igual se lee lo que alcanzó a medir.
        await page.waitFor("window.__zoom && window.__zoom.vio && getComputedStyle(document.getElementById('stadium')).display !== 'block'", 120_000);
        const z = JSON.parse((await page.eval("window.__zoom ? JSON.stringify({ minAntes: window.__zoom.minAntes, enGolpe: window.__zoom.enGolpe, golpe: window.__zoom.golpe, muestras: window.__zoom.muestras, cuadro: window.__zoom.cuadro }) : 'null'")) || "null");
        razones.push(razonDeZoom(z));
        muestras.push(z ? z.muestras : 0);
        cuadros.push(z ? z.cuadro : null);
        try {
          await page.send("Page.close");
        } catch {
          /* ya cerrada */
        }
      }
      const rz = resumirZoom(razones);
      datos.zoom[juego] = { ...rz, pedido: zoomMin };
      check(
        `el zoom del golpe llega a ${veces(zoomMin)} el plano general`,
        rz.conGolpe === razones.length && rz.min >= zoomMin,
        rz.conGolpe ? `mín ${veces(rz.min)} · mediana ${veces(rz.mediana)} · máx ${veces(rz.max)} · con golpe ${rz.conGolpe}/${razones.length}${rz.min < zoomMin ? ` · por semilla ${razones.map((r) => veces(r)).join(" ")}` : ""}` : muestras.every((m) => m === 0) ? "no hubo ninguna muestra de la cámara (¿no existe window.__tinkazo en este build?)" : `el juego no hace ningún golpe de cámara (${muestras.join("/")} muestras)`,
      );
      // Y con el golpe, quien gana y el cartel siguen a la vista: el acercamiento no corta a nadie ni lo mete debajo del cartel.
      const cuadro = juntarCuadros(cuadros);
      datos.zoom[juego].cuadro = cuadro;
      const fallas = fallasDeCuadro(cuadro);
      check(
        "el golpe deja a quien gana y al cartel a la vista",
        fallas.length === 0,
        fallas.length ? fallas.join(" · ") : `ganador fuera ${Math.round(cuadro.ganadorFuera * 100)} % · tapado por el cartel ${Math.round(cuadro.ganadorTapado * 100)} % · cartel afuera ${Math.round(cuadro.cartelFuera)} px (${cuadro.n} cuadros)`,
      );
    }
  }
} finally {
  await browser.close();
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
emitirJson({ auditor: "audit-emocion", objetivo: cual, checks, datos });
process.exit(malos.length ? 1 : 0);
