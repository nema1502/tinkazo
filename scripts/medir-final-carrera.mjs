/**
 * El final de la carrera de llamas, sobre el plan y sin navegador, contra las metas de la dirección.
 *
 *   node scripts/medir-final-carrera.mjs [--rondas 1500] [--n 8,18,60,200] [--json archivo]
 *     [--navegador [--base http://localhost:4173] [--semillas 16] [--motores pixi,3d]] [--solo-dibujo]
 *
 * Mide lo que ve la sala en el último tramo, con las mismas rondas del auditor de delatores: con qué frecuencia la que va
 * primera a 3, 1,5 y 0,5 s de la meta termina ganando, cuánto tiempo lleva la punta la ganadora frente a cada otra, cuántos
 * segundos antes de cruzar, el margen en la meta, si la mayor remontada del último cuarto es de la ganadora y cuántos cambios
 * de punta hay por terreno y en la recta (`scripts/lib/final-carrera.mjs`, sección 2 de la dirección de la carrera).
 * Imprime una tabla con la meta de cada fila y sale con error (1) si alguna no se cumple. Además imprime el detalle de siempre:
 * la duración de la recta, el puesto de la ganadora en cada punto de control y la continuidad de su velocidad.
 *
 * Con `--navegador` suma una pasada con Chrome (reloj en turbo, `?auditar=encuadre`, 16 semillas por tamaño de 8, 18 y 60
 * personas, en 2D y en 3D): compara, cuadro a cuadro de la recta, quién va primera según los hocicos que la escena le pasa
 * al motor con el `lider` del plan. Si el dibujo se apartara del plan (el ensanche de los carriles, un orden distinto en el
 * 3D), saldría acá. Esa pasada no mide cuánto gana la primera: 16 semillas no alcanzan, eso lo dicen las 1.500 rondas.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cargarCarrera, rondaDe } from "./lib/delatores-carrera.mjs";
import { dibujadoContraElPlan, evaluarFinal, medirFinal, resumirFinal, tablaFinal } from "./lib/final-carrera.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rondas = Math.max(1, Number(opt("--rondas", "1500")));
const tamanos = opt("--n", "8,18,60,200").split(",").map(Number).filter((x) => x >= 2);
const json = opt("--json", "");
const soloDibujo = args.includes("--solo-dibujo");
const navegador = args.includes("--navegador") || soloDibujo;

const CUERPO = 0.0115;
const cuantil = (xs, q) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(q * o.length)))];
};
const media = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const pc = (v, dec = 0) => (v * 100).toFixed(dec).replace(".", ",") + " %";
const nu = (v, dec = 2) => v.toFixed(dec).replace(".", ",");

const lib = await cargarCarrera();
const salida = {};
const evaluadas = {};
// Con --solo-dibujo se salta el plan (las 1.500 rondas) y va directo a la pasada con Chrome.
for (const n of soloDibujo ? [] : tamanos) {
  const filas = [];
  const nuevas = [];
  const desde = Date.now();
  for (let i = 1; i <= rondas; i++) {
    // Una línea cada tanto: con 200 personas cada ronda tarda y el vigilante de la máquina corta lo que se queda callado.
    if (i % 250 === 0) console.log(`  ... ${n} personas, ronda ${i}/${rondas}`);
    const { ctx } = rondaDe(lib, n, i);
    const plan = lib.planCarrera(ctx, {});
    nuevas.push(medirFinal(plan));
    const d = plan.datos;
    const L = d.lanes.length;
    const kw = d.lanes.indexOf(d.campeona);
    const pos = (j, q) => d.final.pos(j, q);
    const puesto = (q) => 1 + d.lanes.filter((_, j) => j !== kw && pos(j, q) > pos(kw, q)).length;
    const orden = (q) => d.lanes.map((_, j) => pos(j, q)).sort((a, b) => b - a);
    // Los segundos que lleva la punta antes de cruzar: desde la última vez que otra iba primera.
    let toma = d.tAbre;
    for (let t = d.tAbre; t < d.tCrown; t += 0.02) if (d.lider(t) !== d.campeona) toma = t + 0.02;
    // Los cambios de mano de la punta del 88 % a la meta, y los de toda la ganadora (sube o baja de puesto).
    let cambios = 0, previo = -1;
    for (let t = d.tDeQ(0.88); t < d.tCrown; t += 0.02) {
      const l = d.lider(t);
      if (previo >= 0 && l !== previo) cambios++;
      previo = l;
    }
    // Los pasos de la ganadora: cuántos puestos gana del 90 % a la meta, y cada cuánto.
    let p0 = puesto(0.9);
    const llegada = [];
    for (let t = d.tDeQ(0.9); t <= d.tCrown; t += 0.02) {
      const p = puesto(d.q(t));
      if (p < p0) llegada.push(t - d.tDeQ(0.9));
      p0 = p;
    }
    // La velocidad relativa de la ganadora (cuerpos por segundo respecto de la línea) y su cambio brusco: el mayor salto de velocidad en 0,04 s.
    let saltoVel = 0, vPrev = null, velMax = 0;
    const dt = 0.04;
    for (let t = d.tDeQ(0.88); t + dt <= d.tCrown; t += dt) {
      const a = (pos(kw, d.q(t)) - d.q(t)) / CUERPO;
      const b = (pos(kw, d.q(t + dt)) - d.q(t + dt)) / CUERPO;
      const v = (b - a) / dt;
      if (vPrev !== null) saltoVel = Math.max(saltoVel, Math.abs(v - vPrev));
      velMax = Math.max(velMax, Math.abs(v));
      vPrev = v;
    }
    const o95 = orden(0.95), oMeta = orden(1);
    filas.push({
      arco: plan.arco,
      L,
      recta: d.tCrown - d.tAbre,
      tramoFinal: d.tCrown - d.tDeQ(0.9),
      desde88: d.tCrown - d.tDeQ(0.88),
      segundos: d.tCrown - toma,
      cambios,
      puestos: [0.07, 0.25, 0.5, 0.75, 0.9, 0.95].map(puesto),
      primera95: puesto(0.95) === 1,
      top3_95: (o95[0] - o95[Math.min(2, L - 1)]) / CUERPO,
      segunda_meta: (oMeta[0] - oMeta[1]) / CUERPO,
      segunda_95: (o95[0] - o95[1]) / CUERPO,
      saltoVel,
      velMax,
      pasos: llegada.length,
      normal: plan.normal,
      total: d.tCrown,
    });
  }
  const r = {
    rondas: filas.length,
    recta: media(filas.map((f) => f.recta)),
    tramoFinal: media(filas.map((f) => f.tramoFinal)),
    desde88: media(filas.map((f) => f.desde88)),
    segundosMediana: cuantil(filas.map((f) => f.segundos), 0.5),
    segundosP10: cuantil(filas.map((f) => f.segundos), 0.1),
    segundosP90: cuantil(filas.map((f) => f.segundos), 0.9),
    segundosMenos1: filas.filter((f) => f.segundos < 1).length / filas.length,
    cambios: media(filas.map((f) => f.cambios)),
    cambiosMas1: filas.filter((f) => f.cambios >= 2).length / filas.length,
    top3_95_un_cuerpo: filas.filter((f) => f.top3_95 <= 1).length / filas.length,
    top3_95_media: media(filas.map((f) => f.top3_95)),
    segundaMeta_medio: filas.filter((f) => f.segunda_meta <= 0.5).length / filas.length,
    segundaMeta_media: media(filas.map((f) => f.segunda_meta)),
    segundaMeta_p90: cuantil(filas.map((f) => f.segunda_meta), 0.9),
    primera95: filas.filter((f) => f.primera95).length / filas.length,
    saltoVelP99: cuantil(filas.map((f) => f.saltoVel), 0.99),
    saltoVelMax: Math.max(...filas.map((f) => f.saltoVel)),
    velMaxMediana: cuantil(filas.map((f) => f.velMax), 0.5),
    velMaxP99: cuantil(filas.map((f) => f.velMax), 0.99),
    puestoPorPunto: [0.07, 0.25, 0.5, 0.75, 0.9, 0.95].map((q, ip) => ({ q, reparto: Array.from({ length: filas[0].L }, (_, k) => filas.filter((f) => f.puestos[ip] === k + 1).length / filas.length) })),
    normal: media(filas.map((f) => f.normal)),
    total: media(filas.map((f) => f.total)),
    porArco: {},
  };
  for (const arco of new Set(filas.map((f) => f.arco))) {
    const fs = filas.filter((f) => f.arco === arco);
    r.porArco[arco] = { n: fs.length, segundosMediana: cuantil(fs.map((f) => f.segundos), 0.5), segundaMeta: media(fs.map((f) => f.segunda_meta)) };
  }
  console.log(`\n== ${n} personas (${((Date.now() - desde) / 1000).toFixed(1)} s, ${r.rondas} rondas)`);
  console.log(`  recta ${nu(r.recta, 1)} s; del 90 % a la meta ${nu(r.tramoFinal, 2)} s; del 88 % ${nu(r.desde88, 2)} s; normal ${nu(r.normal, 1)} s; la ganadora cruza a los ${nu(r.total, 1)} s`);
  console.log(`  segundos en punta: mediana ${nu(r.segundosMediana)}, p10 ${nu(r.segundosP10)}, p90 ${nu(r.segundosP90)}; menos de 1 s en ${pc(r.segundosMenos1)}`);
  console.log(`  cambios de punta del 88 % a la meta: ${nu(r.cambios)}; dos o más en ${pc(r.cambiosMas1)}`);
  console.log(`  al 95 %: las tres primeras dentro de un cuerpo en ${pc(r.top3_95_un_cuerpo)} (media ${nu(r.top3_95_media)} cuerpos); la ganadora va primera ${pc(r.primera95)}`);
  console.log(`  en la meta: la segunda a medio cuerpo o menos en ${pc(r.segundaMeta_medio)} (media ${nu(r.segundaMeta_media)} cuerpos, p90 ${nu(r.segundaMeta_p90)})`);
  console.log(`  mayor salto de velocidad de la ganadora (cuerpos/s en 0,04 s): p99 ${nu(r.saltoVelP99)}, máximo ${nu(r.saltoVelMax)}`);
  console.log(`  velocidad máxima de la ganadora respecto de la línea (cuerpos/s): mediana ${nu(r.velMaxMediana)}, p99 ${nu(r.velMaxP99)}`);
  for (const p of r.puestoPorPunto) console.log(`  puesto de la ganadora al ${Math.round(p.q * 100)} %: ${p.reparto.map((v) => pc(v)).join(" ")}`);
  console.log(`  por arco: ${Object.entries(r.porArco).map(([a, v]) => `${a} ${v.n} (mediana ${nu(v.segundosMediana)} s, segunda a ${nu(v.segundaMeta)} cuerpos)`).join("; ")}`);
  const resumen = resumirFinal(nuevas);
  evaluadas[n] = evaluarFinal(resumen);
  salida[`n${n}`] = { ...r, direccion: { resumen, metas: evaluadas[n] } };
}

if (!soloDibujo) console.log(`\nContra las metas de la dirección (${rondas} rondas por tamaño; ✓ cumple, ✗ no):\n`);
if (!soloDibujo) console.log(tablaFinal(evaluadas));
const fallan = Object.entries(evaluadas).flatMap(([n, ev]) => ev.filter((e) => !e.ok).map((e) => `${n} personas: ${e.nombre} ${e.texto} (meta ${e.meta})`));

/* --------------------------------------------------------------- con navegador */
let dibujo = null;
if (navegador) {
  const { launch } = await import("./lib/browser.mjs");
  const { relojTurbo } = await import("./lib/reloj-turbo.mjs");
  const { esperarRam } = await import("./lib/ram.mjs");
  process.env.TINKAZO_GPU = "1";
  const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
  const semillas = Number(opt("--semillas", "16"));
  const motores = opt("--motores", "pixi,3d").split(",");
  const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
  await esperarRam();
  const chrome = await launch({ port: Number(process.env.CDP_PORT || 9760), width: 1280, height: 720 });
  dibujo = [];
  try {
    for (const motor of motores) {
      for (const n of tamanos.filter((x) => [8, 18, 60].includes(x))) {
        let cuadros = 0, distintos = 0, entrada = 0, sinCorrer = 0, primeraGana = 0, medidas = 0, delPlanDistinta = 0;
        for (let i = 1; i <= semillas; i++) {
          console.log(`  corrida ${i}/${semillas} (${motor}, ${n} personas)`);
          const page = await chrome.open("about:blank");
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: relojTurbo() });
          await page.send("Page.navigate", { url: `${base}/?pose=1&n=${n}&motor=${motor}&pace=rapido&auditar=encuadre&semilla=${semilla(i)}` });
          const ok = await page.waitFor("window.__encuadre && window.__encuadre.listo", 120_000);
          const log = ok.ok ? JSON.parse(await page.eval("JSON.stringify(window.__encuadre)")) : null;
          try {
            await page.send("Page.close");
          } catch {
            /* ya cerrada */
          }
          if (!log || (motor === "3d") !== (log.motor === "3d")) {
            sinCorrer++;
            continue;
          }
          const r = dibujadoContraElPlan(log.muestras, log.tCrown, 1.5, log.tAbre);
          cuadros += r.cuadros;
          distintos += r.distintos;
          entrada += r.distintosEntrada;
          medidas++;
          if (r.primeraDibujada === log.ganadora) primeraGana++;
          if (r.primeraDibujada !== r.primeraDelPlan) delPlanDistinta++;
        }
        dibujo.push({ motor, n, semillas, medidas, sinCorrer, cuadros, distintos, entrada, primeraGana, delPlanDistinta });
      }
    }
  } finally {
    await chrome.close();
  }
  console.log(`\nLo dibujado contra el plan (reloj en turbo, ${semillas} semillas por tamaño; el orden de los hocicos que la escena le da al motor, cuadro a cuadro de la recta):\n`);
  console.log("  motor  personas  corridas  cuadros  cuadros con otra primera (y en la entrada)  a 1,5 s la primera dibujada es la del plan  gana la primera a 1,5 s");
  for (const f of dibujo) {
    console.log(`  ${f.motor.padEnd(5)}  ${String(f.n).padStart(8)}  ${`${f.medidas}/${f.semillas}`.padStart(8)}  ${String(f.cuadros).padStart(7)}  ${`${f.distintos} (${f.entrada})`.padStart(42)}  ${`${f.medidas - f.delPlanDistinta}/${f.medidas}`.padStart(40)}  ${`${f.primeraGana}/${f.medidas}`.padStart(21)}`);
    if (f.sinCorrer) fallan.push(`${f.motor} con ${f.n} personas: ${f.sinCorrer} de ${f.semillas} corridas sin medir (no hubo gancho o el motor no fue el pedido)`);
    if (f.distintos > 0) fallan.push(`${f.motor} con ${f.n} personas: ${f.distintos} cuadros (desde 1,6 s de abrirse la recta) en que lo dibujado pone primera a otra que el plan`);
    if (f.delPlanDistinta > 0) fallan.push(`${f.motor} con ${f.n} personas: a 1,5 s de la meta la primera dibujada no es la del plan en ${f.delPlanDistinta} corridas`);
  }
  salida.dibujo = dibujo;
}

console.log(`\n${fallan.length ? "NO CUMPLE" : "CUMPLE"}: ${fallan.length} medida(s) fuera de la meta`);
for (const f of fallan) console.log(`  ✗ ${f}`);
if (json) {
  writeFileSync(json, JSON.stringify({ ...salida, fallan }, null, 2));
  console.log(`\nGuardado en ${json}`);
}
process.exit(fallan.length ? 1 : 0);
