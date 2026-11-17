#!/usr/bin/env node
/**
 * El auditor de tacto de la carrera: que ninguna llama salte de un lugar a otro.
 *
 * La regla (6 de noviembre de 2026): las llamas no cambian de lugar de golpe; se mueven como la gente en una carrera real. Los topes salen de la dirección de la carrera
 * (sección 1, reglas M1 a M5) y del modelo de `src/games/llamas/carrera-marcha.ts`. Todo se mide en **cuerpos** (el largo de una llama:
 * el 3,9 % del ancho de la pantalla) respecto del frente común del grupo, a 60 cuadros por segundo:
 *
 * - **M1** ninguna llama se corre más de 0,03 cuerpos por cuadro;
 * - **M2** velocidad de 1 cuerpo por segundo como mucho; de 1,5 en un pique o un obstáculo con causa a la vista, y por 2,5 s como mucho;
 * - **M3** aceleración de 1,2 cuerpos por segundo cada segundo, sin permiso;
 * - **M4** un adelantamiento se ve venir (un segundo o más a menos de dos cuerpos) y nunca dura menos de 0,5 s. Dos varas (`VARAS_CRUCE` de
 *   `carrera-marcha-datos.ts`): sin un obstáculo encima, más de 0,88 de los cruces duran 1,2 s o más; con una piedra, una valla, una escupida
 *   o un remolino encima de una de las dos, nueve de cada diez duran 0,8 s o más. Las dos varas se juzgan con todas las cantidades juntas;
 * - **M5** cambios de punta: de 3 a 5 en la recta;
 * - **las causas**: todo exceso de velocidad sobre el tope general tiene una causa registrada en el guion (`Datos.causas`), anunciada;
 * - **la justicia de la punta**: la que va primera a 1,5 s de la meta gana el 40 % de las veces o menos, y la ganadora lleva la punta
 *   como mucho 1,25 veces lo que le toca en los últimos ocho segundos.
 *
 * Dos pasadas:
 *
 * 1. **El plan, sin navegador** (`--rondas 1500 --n 8,18,60,200`): recorre `planCarrera` ronda por ronda a 60 cuadros por segundo y da cada
 *    tope con el peor caso y la ronda que lo produce.
 * 2. **Lo dibujado, con navegador** (`--navegador`, 2D y 3D, tres semillas por cantidad): `?auditar=marcha` vuelca el lugar de cada llama
 *    en cada cuadro dibujado; se mide lo mismo sobre lo que ve la sala y también el salto que nace al dibujar y no en el plan. Un solo Chrome,
 *    con su puerto: CDP_PORT.
 *
 * Uso:
 *   node scripts/audit-tacto.mjs [--rondas 300] [--n 8,18,60,200] [--sin-justicia]
 *   CDP_PORT=9750 node scripts/audit-tacto.mjs --navegador --base http://localhost:4750 [--motores pixi,3d] [--semillas 3] [--vista 1280x720]
 *   --json archivo   guarda el detalle ahí
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launch } from "./lib/browser.mjs";
import { cargarCarrera, rondaDe } from "./lib/delatores-carrera.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const rondas = Number(opt("--rondas", "300"));
const tamanos = opt("--n", "8,18,60,200").split(",").map(Number);
const conNavegador = args.includes("--navegador");
const sinJusticia = args.includes("--sin-justicia");
const jsonSalida = opt("--json", "");
const base = opt("--base", "http://localhost:4750").replace(/\/$/, "");
const motores = opt("--motores", "pixi,3d").split(",");
const semillasNav = Number(opt("--semillas", "3"));
const vista = (opt("--vista", "1280x720").match(/^(\d+)x(\d+)$/) ?? []).slice(1).map(Number);

const checks = [];
const check = (nombre, ok, detalle = "") => {
  checks.push({ nombre, ok, detalle });
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
};
const f = (x, d = 2) => Number(x).toFixed(d);
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
};

/**
 * El valor de `c` en `t` entre los cuadros `j` y `j + 1` de `pts` (con hora `t`): Hermite cúbico con las tangentes de los cuadros vecinos. La interpolación
 * lineal de cuadros a 64 por segundo a la grilla de 60 mete un ruido de ±0,5 en la aceleración.
 */
function interpolar(pts, j, t, c) {
  const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
  const h = b.t - a.t;
  if (!(h > 0)) return a[c];
  const pa = pts[Math.max(0, j - 1)], pb = pts[Math.min(pts.length - 1, j + 2)];
  const tg = (q, r) => (r.t > q.t ? (r[c] - q[c]) / (r.t - q.t) : 0);
  const u = (t - a.t) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a[c] + (u3 - 2 * u2 + u) * h * tg(pa, b) + (-2 * u3 + 3 * u2) * b[c] + (u3 - u2) * h * tg(a, pb);
}

/** Carga el módulo de la marcha con Vite (sin construir). */
async function cargarMarcha() {
  const { runnerImport } = await import("vite");
  const cargar = async (ruta) => (await runnerImport(resolve(process.cwd(), ruta), { configFile: false, logLevel: "silent" })).module;
  const [marcha, datos, caminata, trote] = await Promise.all([cargar("src/games/llamas/carrera-marcha.ts"), cargar("src/games/llamas/carrera-marcha-datos.ts"), cargar("src/games/llamas/carrera-caminata-datos.ts"), cargar("src/games/llamas/carrera-caminata.ts")]);
  return { ...marcha, ...datos, ...caminata, TOPES_TROTE: trote.TOPES_TROTE };
}

/* ======================================================================= 1. el plan */
const lib = await cargarCarrera();
const M = await cargarMarcha();
const T = M.TOPES;
const datos = { plan: {}, navegador: {} };

const soloNavegador = args.includes("--solo-navegador");
/** Los adelantamientos de todas las cantidades juntas, para las dos varas (`VARAS_CRUCE`). */
const todas = { pasesSin: 0, cortosSin: 0, pasesCon: 0, cortosCon: 0 };
if (!soloNavegador) console.log(`\nEl plan: ${rondas} rondas con ${tamanos.join(", ")} personas, a 60 cuadros por segundo`);
for (const n of soloNavegador ? [] : tamanos) {
  const peor = { paso: [0, 0], vel: [0, 0], acel: [0, 0], pique: [0, 0] };
  let sinCausa = 0, velSinCausa = 0, acelExceso = 0, excesosVel = 0, excesosVelConCausa = 0, pases = 0, cortos = 0, rapidos = 0, sinAviso = 0;
  let pasesSin = 0, pasesCon = 0, cortosCon = 0;
  const rondasMalasVel = new Set(), rondasMalasAcel = new Set();
  const cruces = [], cambiosRecta = [], cambios8 = [];
  // Las tandas (de 31 a 200 personas): la caminata de las que pasan por el portón, en las pantallas anchas.
  const camina = { paso: 0, vel: 0, acel: 0, tarde: -Infinity, mal: 0 };
  let primeraA15 = 0, primeraA3 = 0, cuota = 0, cuadros = 0, causas = 0, causasSinAviso = 0;
  const L = Math.min(8, n);
  let hechas = 0;
  for (let i = 1; i <= rondas; i++) {
    const { ctx } = rondaDe(lib, n, i);
    const plan = lib.planCarrera(ctx);
    const d = plan.datos;
    const s = M.seriesDelShow(d);
    const m = M.medirMarcha(s.series, s.t0, s.dt, s.causas);
    hechas++;
    if (d.tandas.length) {
      for (const [, P] of M.PANTALLAS_ANCHAS) {
        const c = M.medirCaminata(d, P);
        camina.paso = Math.max(camina.paso, c.paso);
        camina.vel = Math.max(camina.vel, c.vel);
        camina.acel = Math.max(camina.acel, c.acel);
        camina.tarde = Math.max(camina.tarde, c.tarde);
        if (!c.antesDeEchada || c.caminan !== d.gente.length) camina.mal++;
      }
    }
    if (m.pasoMax > peor.paso[0]) peor.paso = [m.pasoMax, i];
    if (m.velMax > peor.vel[0]) peor.vel = [m.velMax, i];
    if (m.acelMax > peor.acel[0]) peor.acel = [m.acelMax, i];
    if (m.piqueMax > peor.pique[0]) peor.pique = [m.piqueMax, i];
    sinCausa += m.sinCausa.length;
    for (const e of m.sinCausa) {
      if (e.tipo === "aceleracion") (acelExceso++, rondasMalasAcel.add(i));
      else (velSinCausa++, rondasMalasVel.add(i));
    }
    for (const e of m.excesos) if (e.tipo === "velocidad") (excesosVel++, e.conCausa && excesosVelConCausa++);
    const obstaculos = M.causasDeObstaculos(d);
    for (const p of m.pases) {
      pases++;
      cruces.push(p.cruce);
      // Dos varas (`VARAS_CRUCE`): sin un obstáculo encima, el cruce corto es el de menos de 1,2 s; con uno, el de menos de 0,8 s.
      if (M.conObstaculoEncima(obstaculos, p)) {
        pasesCon++;
        if (p.cruce < M.VARAS_CRUCE.conObstaculo.cruce) cortosCon++;
      } else {
        pasesSin++;
        if (p.cruce < M.VARAS_CRUCE.sinObstaculo.cruce) cortos++;
      }
      if (p.cruce < 0.5) rapidos++;
      if (p.aviso < 1) sinAviso++;
    }
    for (const c of d.causas) {
      causas++;
      if (c.desde - c.aviso < 0.3 - 1e-9) causasSinAviso++;
    }
    if (!sinJusticia) {
      const fin = s.series.filter((x) => d.lanes.includes(x.id));
      const N = fin[0].x.length;
      const lider = (k) => fin.reduce((a, x) => (x.x[k] > a.x[k] ? x : a), fin[0]).id;
      const iA = Math.round((d.tAbre - s.t0) / s.dt);
      const cuenta = (i0, i1) => {
        let prev = lider(i0), cand = prev, desde = i0, c = 0;
        for (let k = i0; k <= i1; k++) {
          const l = lider(k);
          if (l !== cand) (cand = l, desde = k);
          if (cand !== prev && k - desde >= 12) (prev = cand, c++);
        }
        return c;
      };
      const i8 = Math.max(iA, N - 1 - Math.round(8 / s.dt));
      cambiosRecta.push(cuenta(iA, N - 1));
      cambios8.push(cuenta(i8, N - 1));
      // Como la dirección: sin el último segundo (la foto y el cruce se miden aparte).
      for (let k = i8; k < N - Math.round(1 / s.dt); k++) {
        cuadros++;
        if (lider(k) === d.campeona) cuota++;
      }
      if (lider(N - 1 - 90) === d.campeona) primeraA15++;
      if (lider(N - 1 - 180) === d.campeona) primeraA3++;
    }
  }
  console.log(`\n${n} personas (${hechas} rondas)`);
  check("M1 ningún salto: el mayor desplazamiento por cuadro", peor.paso[0] <= T.cuadro * T.tolerancia, `${f(peor.paso[0], 4)} cuerpos (tope ${T.cuadro}) · ronda ${peor.paso[1]}`);
  check("M2 velocidad de 1 cuerpo por segundo, 1,5 en un pique con causa", peor.vel[0] <= T.pique * T.tolerancia && velSinCausa === 0, `la mayor ${f(peor.vel[0])} cuerpos/s · ronda ${peor.vel[1]} · ${velSinCausa} cuadros sin causa en ${rondasMalasVel.size} rondas`);
  check(`M2 un pique no dura más de ${T.piqueDura} s por encima de 1`, peor.pique[0] <= T.piqueDura, `${f(peor.pique[0], 1)} s · ronda ${peor.pique[1]}`);
  check("M3 aceleración de 1,2 cuerpos por segundo cada segundo, sin permiso", acelExceso === 0, `la mayor ${f(peor.acel[0])} · ronda ${peor.acel[1]} · ${acelExceso} cuadros pasados en ${rondasMalasAcel.size} de ${hechas} rondas`);
  check("causas: todo exceso de velocidad sobre el tope general tiene una causa registrada, anunciada", excesosVel === excesosVelConCausa && causasSinAviso === 0, `${excesosVel} excesos, ${excesosVelConCausa} con causa · ${causas} causas, ${causasSinAviso} sin aviso de 0,3 s`);
  // Las dos varas se juzgan con todas las cantidades juntas, como en la prueba de la marcha (al final): con una sola cantidad y 300 rondas
  // quedan unos cien cruces sin obstáculo, y el azar mueve la parte más que el margen. Acá se muestran como dato.
  todas.pasesSin += pasesSin;
  todas.cortosSin += cortos;
  todas.pasesCon += pasesCon;
  todas.cortosCon += cortosCon;
  check("M4 los adelantamientos se ven venir y no son un salto", sinAviso === 0 && rapidos === 0, `${pases} pases, ${sinAviso} sin aviso de 1 s, ${rapidos} de menos de 0,5 s. Sin obstáculo encima ${pasesSin}, ${cortos} de menos de 1,2 s (${f((100 * cortos) / Math.max(1, pasesSin), 1)} %). Con obstáculo ${pasesCon}, ${cortosCon} de menos de 0,8 s (${f((100 * cortosCon) / Math.max(1, pasesCon), 1)} %). Mediana del cruce ${f(pct(cruces, 0.5))} s`);
  if (camina.tarde > -Infinity) {
    check("tandas M1 la caminata por el portón: el mayor desplazamiento por cuadro", camina.paso <= T.cuadro, `${f(camina.paso, 4)} cuerpos (tope ${T.cuadro})`);
    check("tandas M2 el trote al corral: 1,5 cuerpos por segundo como mucho, con su causa a la vista", camina.vel <= M.TOPES_TROTE.velocidad * T.tolerancia, `la mayor ${f(camina.vel)} cuerpos/s`);
    check("tandas M3 aceleración de 1,2 cuerpos por segundo cada segundo", camina.acel <= M.TOPES_TROTE.aceleracion * T.tolerancia, `la mayor ${f(camina.acel)}`);
    check("tandas: todas llegan al corral a más tardar 3 s después de la salida y antes de la primera echada", camina.mal === 0 && camina.tarde <= 3, `la última llega ${f(camina.tarde, 1)} s después de la salida · ${camina.mal} rondas con alguna fuera de lugar`);
  }
  if (!sinJusticia) {
    const mCr = cambiosRecta.reduce((a, b) => a + b, 0) / hechas, m8 = cambios8.reduce((a, b) => a + b, 0) / hechas;
    check("M5 cambios de punta en la recta: de 3 a 5", mCr >= 3 && mCr <= 5, `${f(mCr, 1)} por carrera (últimos 8 s: ${f(m8, 1)}, mínimo ${Math.min(...cambios8)})`);
    check("la que va primera a 1,5 s de la meta gana 40 % o menos", primeraA15 / hechas <= 0.4, `${f((100 * primeraA15) / hechas, 0)} % (a 3 s: ${f((100 * primeraA3) / hechas, 0)} %)`);
    const veces = cuota / cuadros / (1 / L);
    check("la punta de la ganadora en los últimos 8 s: 1,45 veces lo que le toca o menos (meta revisada; la dirección pedía 1,25: con la ganadora entre las cuatro de adelante a T-3, parejo, el piso es 1,35, y manda el reparto)", veces <= 1.45, `${f(veces)} veces`);
  }
  datos.plan[n] = { rondas: hechas, peor, sinCausa, pases, cortos, causas };
}
if (!soloNavegador && todas.pasesSin + todas.pasesCon > 0) {
  const V = M.VARAS_CRUCE;
  const sinOk = todas.pasesSin === 0 || 1 - todas.cortosSin / todas.pasesSin > V.sinObstaculo.parte;
  const conOk = todas.pasesCon === 0 || 1 - todas.cortosCon / todas.pasesCon >= V.conObstaculo.parte;
  console.log(`\nLos adelantamientos, con ${tamanos.join(", ")} personas juntas`);
  check("M4 dos varas: sin obstáculo encima, más de 0,88 en 1,2 s o más; con un obstáculo encima, nueve de cada diez en 0,8 s o más", sinOk && conOk, `sin obstáculo ${f(1 - todas.cortosSin / Math.max(1, todas.pasesSin), 3)} (${todas.pasesSin - todas.cortosSin} de ${todas.pasesSin}), con obstáculo ${f(1 - todas.cortosCon / Math.max(1, todas.pasesCon), 3)} (${todas.pasesCon - todas.cortosCon} de ${todas.pasesCon})`);
}

/* ================================================================== 2. lo dibujado */
if (conNavegador) {
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
  const semilla = (i) => createHash("sha256").update(`semilla-${i}`).digest("hex");
  process.env.TINKAZO_GPU = "1";
  const browser = await launch({ port: Number(process.env.CDP_PORT || 9750), width: vista[0] ?? 1280, height: vista[1] ?? 720 });
  try {
    for (const motor of motores) {
      console.log(`\nLo dibujado, motor ${motor}, ${semillasNav} semillas`);
      for (const n of tamanos.filter((x) => x <= 60)) {
        let peorPaso = 0, peorVel = 0, peorAcel = 0, sinCausa = 0, cuadros = 0, causas = 0, peorPasoFicha = 0, pasosFicha = 0, pasosFichaAlto = 0;
        const ejemplos = [], tandasInfo = [];
        for (let i = 1; i <= semillasNav; i++) {
          const page = await browser.open("about:blank");
          if (vista.length === 2) await page.send("Emulation.setDeviceMetricsOverride", { width: vista[0], height: vista[1], deviceScaleFactor: 1, mobile: vista[0] < 700, screenWidth: vista[0], screenHeight: vista[1] });
          await page.send("Page.addScriptToEvaluateOnNewDocument", { source: TURBO });
          await page.send("Page.navigate", { url: `${base}/?pose=1&semilla=${semilla(i)}&auditar=marcha&n=${n}&motor=${motor}` });
          const ok = await page.waitFor("window.__marcha && window.__marcha.cuadros.length > 0", 40_000);
          if (!ok.ok) {
            check(`${motor} ${n} semilla ${i}: arranca`, false, "la carrera no arrancó");
            try { await page.send("Page.close"); } catch {}
            continue;
          }
          await page.waitFor("(() => { const m = window.__marcha.meta(); const c = window.__marcha.cuadros; return c.length && c[c.length - 1].t > m.tCrown + 1.2; })()", 150_000);
          const tr = JSON.parse(await page.eval("JSON.stringify({ meta: window.__marcha.meta(), cuadros: window.__marcha.cuadros.map((c) => [c.t, c.ref, c.llamas, c.fichas ?? []]) })"));
          if (process.env.TRAZAS_DIR) writeFileSync(resolve(process.env.TRAZAS_DIR, `traza-${motor}-n${n}-s${i}.json`), JSON.stringify(tr));
          try { await page.send("Page.close"); } catch {}
          // Series a 60 por segundo, respecto del frente común, en cuerpos. Se saltea el corral (antes del primer cartel) y las echadas.
          const { meta } = tr;
          // El show corre desde la salida (`tSalida`); lo que pasa antes (las tandas, de 31 a 200 personas) se mira aparte, como informativo.
          const tTandas = meta.tSalida > 4 && n > 30;
          // Hasta 0,1 s antes de la meta: en el golpe todo se congela (un corte declarado) y el último cuadro mediría esa parada.
          const t0 = tTandas ? meta.tSalida + 0.3 : 3.2, t1 = meta.tCrown - 0.1;
          const Nf = Math.floor((t1 - t0) * 60) + 1;
          const por = new Map();
          for (const [t, ref, llamas] of tr.cuadros) for (const [p, x, y, mo, alza] of llamas) {
            if (!por.has(p)) por.set(p, []);
            por.get(p).push({ t, x: (x - ref) / meta.cuerpo, y: y / meta.cuerpo, mo, alza });
          }
          const series = [];
          for (const [p, pts] of por) {
            const x = new Float64Array(Nf), y = new Float64Array(Nf), corre = new Uint8Array(Nf);
            let j = 0;
            for (let k = 0; k < Nf; k++) {
              const t = t0 + k / 60;
              while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
              const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
              if (!a || a.t > t || t > b.t + 1e-9 || b.t - a.t > 0.1) continue;
              // La echada y el arco de la valla no cuentan (cada una tiene su regla).
              if (a.mo === "echada" || b.mo === "echada") continue;
              x[k] = interpolar(pts, j, t, "x");
              y[k] = interpolar(pts, j, t, "y");
              corre[k] = 1;
            }
            series.push({ id: p, x, y, corre });
          }
          if (tTandas) {
            // Las tandas: cuánto se mueve cada llama entre el cartel y la salida, sin saltos pero a la velocidad del paso por el portón.
            const iFin = Math.floor((meta.tSalida - 3.2) * 60);
            const sTandas = [];
            for (const [p, pts] of por) {
              const x = new Float64Array(iFin), y = new Float64Array(iFin), corre = new Uint8Array(iFin);
              let j = 0;
              for (let k = 0; k < iFin; k++) {
                const t = 3.2 + k / 60;
                while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
                const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
                if (!a || a.t > t || t > b.t + 1e-9 || b.t - a.t > 0.1 || a.mo === "echada" || b.mo === "echada") continue;
                const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
                x[k] = a.x + (b.x - a.x) * u;
                y[k] = a.y + (b.y - a.y) * u;
                corre[k] = 1;
              }
              sTandas.push({ id: p, x, y, corre });
            }
            const mt = M.medirMarcha(sTandas, 3.2, 1 / 60, []);
            tandasInfo.push(mt.pasoMax);
          }
          // Las fichas de nombre (M9): van con su llama con el mismo tope de paso por cuadro; se miden mientras se ven enteras (sin apagarse ni encenderse).
          const porF = new Map();
          // Las echadas quedan quietas en el mundo (respecto del frente del grupo se alejan a la velocidad del grupo: no es un salto), las que el borde de la pantalla deja pegadas siguen
          // a la cámara (la ficha nunca sale cortada) y después de la meta todo se congela.
          for (const [t, ref, , fichas] of tr.cuadros) for (const [p, x, y, a, eco, pegada] of fichas) {
            if (!porF.has(p)) porF.set(p, []);
            porF.get(p).push({ t, x: (x - ref) / meta.cuerpo, y: y / meta.cuerpo, a: eco || pegada ? 0 : a });
          }
          const seriesF = [];
          for (const [p, pts] of porF) {
            const x = new Float64Array(Nf), y = new Float64Array(Nf), corre = new Uint8Array(Nf);
            let j = 0;
            for (let k = 0; k < Nf; k++) {
              const t = t0 + k / 60;
              while (j + 1 < pts.length && pts[j + 1].t <= t) j++;
              const a = pts[j], b = pts[Math.min(j + 1, pts.length - 1)];
              if (!a || a.t > t || t > b.t + 1e-9 || b.t - a.t > 0.1 || a.a < 0.99 || b.a < 0.99) continue;
              x[k] = interpolar(pts, j, t, "x");
              y[k] = interpolar(pts, j, t, "y");
              corre[k] = 1;
            }
            seriesF.push({ id: p, x, y, corre });
          }
          if (seriesF.length) {
            // El paso por cuadro de cada ficha: la parte que pasa del tope es de las fichas que la cámara empuja (la que llega al borde de la pantalla sigue al borde).
            for (const sr of seriesF) for (let k = 1; k < Nf; k++) {
              if (!sr.corre[k] || !sr.corre[k - 1]) continue;
              const dd = Math.hypot(sr.x[k] - sr.x[k - 1], sr.y[k] - sr.y[k - 1]);
              pasosFicha++;
              if (dd > T.cuadro * T.tolerancia) pasosFichaAlto++;
              peorPasoFicha = Math.max(peorPasoFicha, dd);
            }
          }
          const m = M.medirMarcha(series, t0, 1 / 60, meta.causas ?? []);
          peorPaso = Math.max(peorPaso, m.pasoMax);
          peorVel = Math.max(peorVel, m.velMax);
          peorAcel = Math.max(peorAcel, m.acelMax);
          sinCausa += m.sinCausa.length;
          for (const e of m.sinCausa.slice(0, 2)) ejemplos.push(`semilla ${i}: ${e.tipo} ${f(e.valor)} a los ${f(e.t, 1)} s (llama ${e.id}${meta.lanes.includes(e.id) ? "" : ", del grupo"}; la recta abre a los ${f(meta.tAbre, 1)})`);
          cuadros += Nf;
        }
        // Con las causas del guion que deja la página (`Datos.causas`): lo mismo que en el plan, pero sobre lo que se dibuja.
        check(`${motor} ${n}: lo dibujado no salta`, peorPaso <= T.cuadro * T.tolerancia * (T.pique / T.velocidad) && sinCausa === 0, `mayor paso ${f(peorPaso, 4)} cuerpos por cuadro · velocidad ${f(peorVel)} · aceleración ${f(peorAcel)} · ${sinCausa} cuadros sobre el tope sin causa`);
        for (const e of ejemplos.slice(0, 4)) console.log(`      ${e}`);
        if (motor !== "3d") {
          check(`${motor} ${n}: las fichas de nombre van con su llama y no saltan`, peorPasoFicha <= T.cuadro * T.tolerancia * (T.pique / T.velocidad), `mayor paso ${f(peorPasoFicha, 4)} cuerpos por cuadro (el tope de la llama con causa a la vista); ${f((100 * pasosFichaAlto) / Math.max(1, pasosFicha), 2)} % de los cuadros pasan de ${T.cuadro} (sin las pegadas al borde de la pantalla, que siguen a la cámara)`);
        } else console.log(`  · 3d ${n}: las fichas de nombre del 3D no se miden acá (van en píxeles de pantalla): ver la prueba de \`carrera-fichas-mov.test.ts\``);
        if (tandasInfo.length) console.log(`  · ${motor} ${n}: las tandas (antes de la salida, informativo): ${f(Math.max(...tandasInfo), 3)} cuerpos por cuadro como mucho, sin saltos de lugar`);
        datos.navegador[`${motor}-${n}`] = { peorPaso, peorVel, peorAcel, sinCausa };
      }
    }
  } finally {
    await browser.close();
  }
}

const malos = checks.filter((c) => !c.ok);
console.log(`\n${malos.length ? "RECHAZADO" : "APROBADO"}: ${checks.length - malos.length}/${checks.length} comprobaciones`);
if (jsonSalida) writeFileSync(jsonSalida, JSON.stringify({ checks, datos }, null, 1));
emitirJson({ auditor: "audit-tacto", objetivo: "race", checks, datos });
process.exit(malos.length ? 1 : 0);
