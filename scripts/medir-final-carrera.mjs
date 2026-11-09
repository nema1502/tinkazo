/**
 * El final de la carrera de llamas, sobre el plan y sin navegador.
 *
 *   node scripts/medir-final-carrera.mjs [--rondas 1500] [--n 8,18,60] [--json archivo]
 *
 * Mide lo que ve la sala en el último tramo, con las mismas rondas del auditor
 * de delatores: cuánto dura la recta y su tramo final, los segundos que la
 * ganadora lleva la punta antes de cruzar, cuántos cambios de mano hay, qué tan
 * apretado va el pelotón al 95 % y en la meta, que el avance de la ganadora no
 * dé saltos (la velocidad relativa es continua) y el puesto de la ganadora en
 * cada punto de control. Sin Chrome ni red.
 */
import { writeFileSync } from "node:fs";
import { cargarCarrera, rondaDe } from "./lib/delatores-carrera.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const rondas = Math.max(1, Number(opt("--rondas", "1500")));
const tamanos = opt("--n", "8,18,60").split(",").map(Number).filter((x) => x >= 2);
const json = opt("--json", "");

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
for (const n of tamanos) {
  const filas = [];
  const desde = Date.now();
  for (let i = 1; i <= rondas; i++) {
    const { ctx } = rondaDe(lib, n, i);
    const plan = lib.planCarrera(ctx, {});
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
    const puestos = [];
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
    const sal = {
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
    };
    void puestos;
    filas.push(sal);
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
  salida[`n${n}`] = r;
}
if (json) {
  writeFileSync(json, JSON.stringify(salida, null, 2));
  console.log(`\nGuardado en ${json}`);
}
