/**
 * La percepción de la carrera, a nivel del plan (sin navegador).
 *
 * `audit-delatores` mira si algún dato suelto adivina a la ganadora (el puesto
 * a la mitad, a quién se nombra primero). La sala no mira un instante: mira
 * todo el tiempo. Acá se mide lo que ve entre la salida y la meta, con las
 * mismas rondas del auditor (`rondaDe`), en dos alcances:
 *
 * - `recta`: de que se abre la recta hasta la meta, entre las ocho de la final.
 * - `total`: de la salida a la meta, con el grupo (si lo hay).
 *
 * Las medidas, por alcance:
 *
 * (a) `tiempoGanadora` y `tiempoOtras`: la fracción del tiempo que la ganadora
 *     lleva la punta, contra la de cada una de las otras finalistas (promedio).
 * (b) `toma`: desde qué fracción del alcance ya no suelta la punta (0 si nunca
 *     la perdió; se reparte en mediana y p90).
 * (c) `cambios` y `cambiosUltimoTercio`: cuántas veces cambia el líder.
 * (d) `remontada`: la ganadora estaba fuera del podio al 70 %.
 * (e) `fichaPrimera`: la primera dueña de la ficha amarilla del alcance es la
 *     ganadora; `fichaDuenas`: cuántas dueñas distintas tuvo la ficha.
 * (f) `lidera[f]`: la que va primera al `f` del alcance es la ganadora (sin
 *     señal vale `1 / carriles`: es el "quien va ganando, gana").
 * (g) `antes80`: lo que la ganadora lleva la punta antes del 80 %, menos el
 *     promedio de las otras, y `tardia`: no lidera hasta después del 85 %.
 */

const PASO = 0.1;
const FRACCIONES = [0.5, 0.7, 0.8, 0.9];

const promedio = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const cuantil = (xs, q) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(q * o.length)))];
};

/** Lo que ve la sala de una ronda en un alcance `[t0, t1]`. */
export function medirAlcance(d, t0, t1, finalistas, azarFicha = 1 / finalistas.length) {
  const w = d.campeona;
  const pasos = Math.max(1, Math.floor((t1 - t0) / PASO));
  const ts = Array.from({ length: pasos }, (_, i) => t0 + (i + 0.5) * ((t1 - t0) / pasos));
  const lideres = ts.map((t) => d.lider(t));
  const duenas = ts.map((t) => d.duena(t));
  const compartidos = finalistas.map((g) => lideres.filter((l) => l === g).length / pasos);
  const kw = finalistas.indexOf(w);
  const tiempoGanadora = kw >= 0 ? (compartidos[kw] ?? 0) : 0;
  const tiempoOtras = promedio(compartidos.filter((_, k) => k !== kw));
  // Desde dónde ya no suelta la punta: el último paso en que alguien más iba primera.
  let ultimo = -1;
  for (let i = 0; i < pasos; i++) if (lideres[i] !== w) ultimo = i;
  const toma = (ultimo + 1) / pasos;
  const cambiosEn = (arr, desde) => {
    let c = 0;
    for (let i = Math.max(1, desde); i < arr.length; i++) if (arr[i] !== arr[i - 1]) c++;
    return c;
  };
  const tercio = Math.floor((2 * pasos) / 3);
  const antes = Math.floor(0.8 * pasos);
  const gan80 = lideres.slice(0, antes).filter((l) => l === w).length / Math.max(1, antes);
  const otras80 = promedio(finalistas.filter((g) => g !== w).map((g) => lideres.slice(0, antes).filter((l) => l === g).length / Math.max(1, antes)));
  const t70 = t0 + 0.7 * (t1 - t0);
  const puesto70 = d.vivas(t70).indexOf(w) + 1;
  const lidera = {};
  for (const f of FRACCIONES) lidera[f] = d.lider(t0 + f * (t1 - t0)) === w;
  return {
    tiempoGanadora,
    tiempoOtras,
    toma,
    cambios: cambiosEn(lideres, 1),
    cambiosUltimoTercio: cambiosEn(lideres, tercio),
    remontada: puesto70 > 3,
    fichaPrimera: duenas[0] === w,
    azarFicha,
    fichaDuenas: new Set(duenas).size,
    fichaCambios: cambiosEn(duenas, 1),
    lidera,
    antes80: gan80 - otras80,
    tardia: toma > 0.85,
  };
}

/** Un cuerpo de llama, en fracción de la recta (`carrera-recta.ts`). */
const CUERPO = 0.0115;
const PUNTOS_CIERRE = [0.7, 0.8, 0.9, 0.95];

/**
 * El cierre de la recta, lo que ve la sala cuando se acerca la meta (h): en cada punto, si la ganadora está en el
 * podio y cuántas finalistas siguen en pelea (a menos de tres cuerpos de la que va primera).
 */
export function medirCierre(d) {
  const L = d.lanes.length;
  const kw = d.lanes.indexOf(d.campeona);
  const cierre = {};
  for (const q of PUNTOS_CIERRE) {
    const xs = d.lanes.map((_, j) => d.final.pos(j, q));
    const tope = Math.max(...xs);
    cierre[q] = {
      podio: xs.filter((x, j) => j !== kw && x > xs[kw]).length < 3,
      primera: xs.every((x, j) => j === kw || x < xs[kw]),
      enPelea: xs.filter((x) => tope - x <= 3 * CUERPO).length,
      distancia: (tope - xs[kw]) / CUERPO,
    };
  }
  // El puesto al entrar a la recta y al 90 %, y cuántos segundos lleva la punta la ganadora antes de cruzar (los del plan, con la foto).
  const puestoEn = (q) => 1 + d.lanes.filter((_, j) => j !== kw && d.final.pos(j, q) > d.final.pos(kw, q)).length;
  let toma = d.tAbre;
  for (let t = d.tAbre; t < d.tCrown; t += 0.05) if (d.lider(t) !== d.campeona) toma = t + 0.05;
  const desde = d.q(toma);
  let pegado = Infinity;
  for (let q = desde; q <= 0.985; q += 0.005) {
    const otras = d.lanes.map((_, j) => (j === kw ? -Infinity : d.final.pos(j, q)));
    pegado = Math.min(pegado, (d.final.pos(kw, q) - Math.max(...otras)) / CUERPO);
  }
  return { L, cierre, puestoEntrada: puestoEn(0), puesto90: puestoEn(0.9), segundosPunta: d.tCrown - toma, pegado: pegado < 1.5 };
}

/** Todas las medidas de una ronda: `{ recta, total }`. */
export function medirRonda(plan) {
  const d = plan.datos;
  const finalistas = d.lanes;
  const tSalida = d.tSalida + 0.6;
  return {
    arco: plan.arco,
    recta: { ...medirAlcance(d, d.tAbre, d.tCrown, finalistas), ...(({ cierre, puestoEntrada, puesto90, segundosPunta, pegado }) => ({ cierre, puestoEntrada, puesto90, segundosPunta, pegado }))(medirCierre(d)) },
    total: d.tAbre - d.tSalida > 4 ? medirAlcance(d, tSalida, d.tCrown, finalistas, 1 / d.gente.length) : null,
    carriles: finalistas.length,
  };
}

/** Junta las rondas de un alcance en los números que se informan. */
export function resumir(filas, alcance) {
  const rs = filas.map((f) => f[alcance]).filter(Boolean);
  if (!rs.length) return null;
  const media = (fn) => promedio(rs.map(fn));
  const frac = (fn) => media((r) => (fn(r) ? 1 : 0));
  const L = promedio(filas.filter((f) => f[alcance]).map((f) => f.carriles));
  const lidera = {};
  for (const f of FRACCIONES) lidera[f] = frac((r) => r.lidera[f]);
  const arcos = {};
  for (const f of filas) arcos[f.arco] = (arcos[f.arco] ?? 0) + 1;
  return {
    rondas: rs.length,
    carriles: L,
    azar: 1 / L,
    azarFicha: media((r) => r.azarFicha),
    tiempoGanadora: media((r) => r.tiempoGanadora),
    tiempoOtras: media((r) => r.tiempoOtras),
    tomaMediana: cuantil(rs.map((r) => r.toma), 0.5),
    tomaP90: cuantil(rs.map((r) => r.toma), 0.9),
    tomaAntes75: frac((r) => r.toma < 0.75),
    tardia: frac((r) => r.tardia),
    cambios: media((r) => r.cambios),
    cambiosUltimoTercio: media((r) => r.cambiosUltimoTercio),
    sinCambiosUltimoTercio: frac((r) => r.cambiosUltimoTercio === 0),
    remontada: frac((r) => r.remontada),
    fichaPrimera: frac((r) => r.fichaPrimera),
    fichaDuenas: media((r) => r.fichaDuenas),
    fichaCambios: media((r) => r.fichaCambios),
    lidera,
    antes80: media((r) => r.antes80),
    arcos,
    ...(rs[0].cierre
      ? {
          puestoEntrada: Array.from({ length: 8 }, (_, i) => frac((r) => r.puestoEntrada === i + 1)),
          puesto90: Array.from({ length: 8 }, (_, i) => frac((r) => r.puesto90 === i + 1)),
          segundosMedia: media((r) => r.segundosPunta),
          segundos: { menos2: frac((r) => r.segundosPunta < 2), de2a4: frac((r) => r.segundosPunta >= 2 && r.segundosPunta < 4), de4a6: frac((r) => r.segundosPunta >= 4 && r.segundosPunta < 6), de6a8: frac((r) => r.segundosPunta >= 6 && r.segundosPunta < 8), mas8: frac((r) => r.segundosPunta >= 8) },
          mas8Pegado: frac((r) => r.segundosPunta >= 8 && r.pegado),
          mas4Pegado: frac((r) => r.segundosPunta >= 4 && r.pegado),
          cierre: Object.fromEntries(
            PUNTOS_CIERRE.map((q) => [q, {
              podio: frac((r) => r.cierre[q].podio),
              primera: frac((r) => r.cierre[q].primera),
              enPelea: media((r) => r.cierre[q].enPelea),
              distancia: media((r) => r.cierre[q].distancia),
            }]),
          ),
        }
      : {}),
  };
}

const pc = (v, dec = 1) => (v * 100).toFixed(dec).replace(".", ",") + " %";
const nu = (v, dec = 2) => v.toFixed(dec).replace(".", ",");

/** Una tabla de texto con las medidas de un alcance. */
export function tabla(r, titulo) {
  if (!r) return `${titulo}: sin grupo (no hay alcance total)\n`;
  const l = [];
  l.push(`${titulo} (${r.rondas} rondas, ${nu(r.carriles, 1)} carriles, azar 1/L = ${pc(r.azar)})`);
  l.push(`  (a) tiempo en la punta: ganadora ${pc(r.tiempoGanadora)}, cada una de las otras ${pc(r.tiempoOtras)} (cociente ${nu(r.tiempoGanadora / Math.max(1e-9, r.tiempoOtras))})`);
  l.push(`      antes del 80 %: ganadora menos otras = ${pc(r.antes80)} de ese tramo`);
  l.push(`  (b) ya no suelta la punta desde: mediana ${pc(r.tomaMediana, 0)}, p90 ${pc(r.tomaP90, 0)}; antes del 75 % en ${pc(r.tomaAntes75, 0)} de las carreras; recién después del 85 % en ${pc(r.tardia, 0)}`);
  l.push(`  (c) cambios de líder por carrera: ${nu(r.cambios)}, en el último tercio ${nu(r.cambiosUltimoTercio)} (sin ninguno en el último tercio: ${pc(r.sinCambiosUltimoTercio, 0)})`);
  l.push(`  (d) remontada (fuera del podio al 70 %): ${pc(r.remontada)}`);
  l.push(`  (e) la ganadora es la primera dueña de la ficha: ${pc(r.fichaPrimera)} (azar ${pc(r.azarFicha)}); dueñas distintas ${nu(r.fichaDuenas)}, cambios de dueña ${nu(r.fichaCambios)}`);
  l.push(`  (f) quien va primera al 50 / 70 / 80 / 90 % es la ganadora: ${Object.values(r.lidera).map((v) => pc(v, 0)).join(" / ")}`);
  if (r.cierre) {
    for (const [q, c] of Object.entries(r.cierre)) l.push(`  cierre al ${Math.round(q * 100)} %: la ganadora en el podio ${pc(c.podio, 0)} (azar 37,5 %), primera ${pc(c.primera, 0)}, ${nu(c.enPelea, 1)} finalistas a menos de tres cuerpos de la punta, a ${nu(c.distancia, 1)} cuerpos de ella`);
  }
  if (r.puestoEntrada) {
    l.push(`  (f) puesto de la ganadora al entrar a la recta, del 1.º al 8.º: ${r.puestoEntrada.map((v) => pc(v, 0)).join(" ")}; al 90 %: ${r.puesto90.map((v) => pc(v, 0)).join(" ")}`);
    l.push(`  (g) segundos que lleva la punta antes de cruzar: media ${nu(r.segundosMedia, 1)}; menos de 2 s ${pc(r.segundos.menos2, 0)}, de 2 a 4 ${pc(r.segundos.de2a4, 0)}, de 4 a 6 ${pc(r.segundos.de4a6, 0)}, de 6 a 8 ${pc(r.segundos.de6a8, 0)}, 8 o más ${pc(r.segundos.mas8, 0)}; 4 s o más con una rival pegada ${pc(r.mas4Pegado, 0)}, 8 s o más ${pc(r.mas8Pegado, 0)}`);
  }
  l.push(`  arcos: ${Object.entries(r.arcos).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  return l.join("\n") + "\n";
}
