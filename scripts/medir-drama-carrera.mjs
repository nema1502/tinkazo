/**
 * El drama de la carrera de llamas contra las metas de la dirección: el silencio antes del golpe, el golpe junto, los huecos
 * entre hechos y la duración por tramo y total.
 *
 *   node scripts/medir-drama-carrera.mjs [--rondas 1500] [--n 8,18,60,200] [--nueva | --las-dos] [--json archivo]
 *     [--navegador [--base http://localhost:4173] [--semillas 16] [--motores pixi,3d] [--personas 8,18,60]]
 *
 * Sin navegador (sobre el plan, 1.500 rondas por tamaño): la duración de cada tramo y el total contra la tabla de la sección 3
 * de la dirección, los huecos de más de 4 s sin un hecho y, como siempre, la percepción de la carrera (cuánto tiempo lleva la
 * punta quien gana, desde cuándo ya no la suelta, cuántos cambios de líder hay, cuántas terminan en remontada y quién recibe
 * primero la ficha amarilla; ver `lib/drama-carrera.mjs`).
 *
 * Con `--navegador` suma lo que el plan no sabe, con Chrome y el reloj en turbo (como `audit-emocion`): en 2D y en 3D, con 16
 * semillas por tamaño, el silencio de efectos y de música antes del golpe (meta 0,4 s), que la luz, el acercamiento, el sonido y
 * el cartel caigan a menos de 100 ms entre sí y que el show real dure lo que dice el plan (`lib/drama-show.mjs`). Necesita el
 * sitio servido (`pnpm preview`) y la placa de video. Sin `--navegador` esas filas no se miden y el programa lo dice.
 *
 * Imprime las tablas y sale con error (1) si alguna meta no se cumple.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cargarCarrera, rondaDe } from "./lib/delatores-carrera.mjs";
import { medirRonda, resumir, tabla } from "./lib/drama-carrera.mjs";
import { duracionesDelPlan, evaluarDramaPlan, evaluarSemillas, huecosDelPlan, instalarDrama, medirSemillaDrama, resumirDramaPlan, resumirSemillas, tablaDeMetas } from "./lib/drama-show.mjs";
import { esperarRam } from "./lib/ram.mjs";
import { relojTurbo } from "./lib/reloj-turbo.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rondas = Math.max(1, Number(opt("--rondas", "1500")));
const tamanos = opt("--n", "8,18,60,200").split(",").map(Number).filter((x) => x >= 2);
const json = opt("--json", "");
const cuales = args.includes("--nueva") ? [true] : args.includes("--las-dos") ? [false, true] : [false];
const navegador = args.includes("--navegador");

const lib = await cargarCarrera();
const salida = {};
const fallan = [];
const marca = (ok) => (ok ? "✓" : "✗");

for (const nueva of cuales) {
  const etiqueta = nueva ? "carrera nueva" : "carrera de siempre";
  const evaluadas = {};
  for (const n of tamanos) {
    const filas = [];
    const dramas = [];
    const desde = Date.now();
    for (let i = 1; i <= rondas; i++) {
      // Una línea cada tanto: con 200 personas cada ronda tarda y el vigilante de la máquina corta lo que se queda callado.
      if (i % 250 === 0) console.log(`  ... ${n} personas, ronda ${i}/${rondas}`);
      const { ctx } = rondaDe(lib, n, i);
      const plan = lib.planCarrera(ctx, { nueva });
      filas.push(medirRonda(plan));
      dramas.push({ huecos: huecosDelPlan(plan.datos), tramos: duracionesDelPlan(plan.datos, lib.constantes) });
    }
    const titulo = `${etiqueta} con ${n} personas`;
    console.log(`\n== ${titulo} (${((Date.now() - desde) / 1000).toFixed(1)} s)`);
    const recta = resumir(filas, "recta");
    const total = resumir(filas, "total");
    console.log(tabla(recta, "la recta (de que se abre a la meta)"));
    if (total) console.log(tabla(total, "toda la carrera (de la salida a la meta)"));
    const resumen = resumirDramaPlan(dramas);
    const metas = evaluarDramaPlan(resumen, n);
    evaluadas[n] = metas;
    console.log(tablaDeMetas(metas, `contra la dirección, sobre el plan (${rondas} rondas; tramos en segundos de show "Normal")`));
    for (const m of metas.filter((x) => !x.ok)) fallan.push(`${etiqueta}, ${n} personas: ${m.nombre} ${m.texto} (meta ${m.meta})`);
    salida[`${nueva ? "nueva" : "siempre"}-n${n}`] = { recta, total, direccion: { resumen, metas } };
  }
  if (navegador && !nueva) await conNavegador(evaluadas);
}

/**
 * La pasada con Chrome: por cada motor y cantidad, `--semillas` corridas con el reloj en turbo. El tamaño 200 no entra por
 * defecto (cada corrida con 200 nombres tarda lo que un minuto de show en un equipo lento): `--personas 8,18,60,200` lo suma.
 */
async function conNavegador(planPorTamano) {
  const { launch } = await import("./lib/browser.mjs");
  process.env.TINKAZO_GPU = "1";
  const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
  const semillas = Number(opt("--semillas", "16"));
  const motores = opt("--motores", "pixi,3d").split(",");
  const personas = opt("--personas", "8,18,60").split(",").map(Number);
  const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
  const TURBO = relojTurbo({ instalar: instalarDrama, muestrear: "window.__dr.muestrear" });
  await esperarRam();
  const chrome = await launch({ port: Number(process.env.CDP_PORT || 9760), width: 1280, height: 720 });
  salida.navegador = {};
  try {
    for (const motor of motores) {
      for (const n of personas) {
        const corridas = [];
        let sinCorrer = 0;
        for (let i = 1; i <= semillas; i++) {
          console.log(`  corrida ${i}/${semillas} (${motor}, ${n} personas)`);
          const page = await chrome.open("about:blank");
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
          await page.send("Page.navigate", { url: `${base}/?pose=1&n=${n}&motor=${motor}&pace=normal&auditar=nino,camara&semilla=${semilla(i)}` });
          // El show terminó cuando el estadio, que se vio abierto, se cierra.
          const ok = await page.waitFor("window.__dr && window.__dr.cierra !== null", 180_000);
          const crudo = ok.ok ? await page.eval("JSON.stringify({ dr: window.__dr, golpe: window.__golpe || {} })") : null;
          try {
            await page.send("Page.close");
          } catch {
            /* ya cerrada */
          }
          const r = crudo ? JSON.parse(crudo) : null;
          // Pidió el 3D y dibujó 2D (o al revés): no es una medida de ese motor.
          if (!r || (motor === "3d") !== r.dr.tres) {
            sinCorrer++;
            continue;
          }
          corridas.push(medirSemillaDrama(r.dr, r.golpe));
        }
        const res = resumirSemillas(corridas);
        const metas = evaluarSemillas(res);
        // El show real contra el plan: el estadio abierto, de la tarjeta de «cómo se juega» al cierre, contra la tarjeta más el plan más lo que no se estira.
        const plan = planPorTamano[n]?.find((f) => f.clave === "total");
        if (plan && res.totalMedio !== null) {
          metas.push({ clave: "duracionReal", nombre: "el estadio abierto dura lo que dice el plan (con la tarjeta)", valor: res.totalMedio, texto: `${res.totalMedio.toFixed(1).replace(".", ",")} s contra ${plan.valor.toFixed(1).replace(".", ",")} s`, meta: "± 2 s", ok: Math.abs(res.totalMedio - plan.valor) <= 2 });
        }
        if (sinCorrer) metas.push({ clave: "sinCorrer", nombre: "corridas que no se pudieron medir (sin gancho o el motor no fue el pedido)", valor: sinCorrer, texto: `${sinCorrer} de ${semillas}`, meta: "ninguna", ok: false });
        console.log(tablaDeMetas(metas, `\n${motor === "3d" ? "3D" : "2D (PixiJS)"} con ${n} personas, ${semillas} semillas, reloj en turbo`));
        for (const m of metas.filter((x) => !x.ok)) fallan.push(`${motor === "3d" ? "3D" : "2D"}, ${n} personas: ${m.nombre} ${m.texto} (meta ${m.meta})`);
        salida.navegador[`${motor}-n${n}`] = { resumen: res, metas, corridas };
      }
    }
  } finally {
    await chrome.close();
  }
}

if (!navegador) console.log("\nSin --navegador no se midió el silencio antes del golpe, el golpe junto ni la duración real (agregá --navegador con el sitio servido).");
console.log(`\n${fallan.length ? "NO CUMPLE" : "CUMPLE"}: ${fallan.length} medida(s) fuera de la meta`);
for (const f of fallan) console.log(`  ✗ ${f}`);
if (json) {
  writeFileSync(json, JSON.stringify({ ...salida, fallan }, null, 1));
  console.log(`detalle en ${json}`);
}
process.exit(fallan.length ? 1 : 0);
