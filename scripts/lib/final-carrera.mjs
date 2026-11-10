/**
 * El final de la carrera de llamas contra lo que pide la dirección (sección 2), sobre el
 * plan y sin navegador. Lo usa `scripts/medir-final-carrera.mjs`.
 *
 * T es el instante en que la ganadora cruza la línea (`datos.tCrown`). Todo se mide en los instantes en que mira la sala:
 *
 * - **Primera a 3, 1,5 y 0,5 s de la meta**: la que va primera ese instante, ¿es la ganadora? Si lo es demasiadas veces, la
 *   sala aprende "gana la que va primera" y la foto no sorprende; al azar entre ocho sería 1 de 8.
 * - **Tiempo en punta de la ganadora contra cada otra**, en la recta (de que se abre a la meta): cuántas veces más lleva la
 *   punta la ganadora que cada una de las otras finalistas. Parejo es 1; "sin el último segundo" no cuenta la llegada.
 * - **Segundos en punta antes de cruzar**: desde la última vez que otra iba primera hasta T.
 * - **Margen en la meta**: de la primera a la segunda, en cuerpos de llama (`CUERPO`, el de la recta del plan).
 * - **La mayor remontada del último cuarto** (de q = 0,75 a la meta): cuántos puestos gana cada finalista; ¿la mayor es de la
 *   ganadora? Si lo fuera siempre, "gana la que viene de atrás" (el 4 de noviembre se vio la otra cara: "gana la última").
 * - **Cambios de punta**: por terreno del grupo, y en la recta antes del cabeza a cabeza (hasta T − 3 s).
 *
 * Puro: no importa nada, recibe el plan que arma `planCarrera`. Cada función es probable con un plan inventado.
 */

/** Un cuerpo de llama, en fracción de la recta (`carrera-recta.ts`). */
export const CUERPO = 0.0115;
/** Cada cuánto se mira quién va primera, en segundos. */
export const PASO_LIDER = 0.02;
/** Desde cuántos segundos antes de la meta empieza el cabeza a cabeza (los últimos tres segundos). */
export const CABEZA_A_CABEZA = 3;
/** El último cuarto de la recta, en fracción de pista. */
export const ULTIMO_CUARTO = 0.75;

const media = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const cuantil = (xs, q) => {
  if (!xs.length) return NaN;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(q * o.length)))];
};

/** Cuántas veces cambia `quien(t)` entre `t0` y `t1`, sin contar el cambio de «nadie» (-1). */
export function cambiosEntre(quien, t0, t1, paso = PASO_LIDER) {
  let cambios = 0;
  let previo = null;
  for (let t = t0; t <= t1 + 1e-9; t += paso) {
    const q = quien(t);
    if (q < 0) continue;
    if (previo !== null && q !== previo) cambios++;
    previo = q;
  }
  return cambios;
}

/**
 * Los puestos que gana cada carril de q = 0,75 a la meta (positivo: sube). El 1.º es el que más lejos va.
 * @returns un número por carril
 */
export function remontadasDelCuarto(pos, L, q0 = ULTIMO_CUARTO) {
  const puestos = (q) => {
    const orden = Array.from({ length: L }, (_, j) => j).sort((a, b) => pos(b, q) - pos(a, q) || a - b);
    const lugar = new Array(L);
    orden.forEach((j, i) => (lugar[j] = i + 1));
    return lugar;
  };
  const antes = puestos(q0);
  const despues = puestos(1);
  return antes.map((p, j) => p - despues[j]);
}

/**
 * ¿La mayor remontada del último cuarto es de la ganadora? 1 si lo es sola, 1/k si comparte el máximo con k − 1 más, 0 si no.
 * Sin remontada de nadie (el máximo es 0 o menos) vale 0: no hay remontada que sea de la ganadora.
 */
export function mayorRemontadaEsDeLaGanadora(ganancias, kw) {
  const mayor = Math.max(...ganancias);
  if (!(mayor > 0) || ganancias[kw] !== mayor) return 0;
  return 1 / ganancias.filter((g) => g === mayor).length;
}

/** Todo lo que se mide de una ronda: `datos` es el `plan.datos` de `planCarrera`. */
export function medirFinal(plan) {
  const d = plan.datos;
  const L = d.lanes.length;
  const kw = d.lanes.indexOf(d.campeona);
  const T = d.tCrown;
  const primera = (antes) => d.lider(Math.max(d.tAbre, T - antes)) === d.campeona;
  // El tiempo que lleva la punta cada una, en la recta; con todo y sin el último segundo.
  const lideres = [];
  for (let t = d.tAbre; t < T; t += PASO_LIDER) lideres.push({ t, l: d.lider(t) });
  const cuenta = (hasta) => {
    const v = lideres.filter((x) => x.t < hasta);
    const por = d.lanes.map((q) => v.filter((x) => x.l === q).length / (v.length || 1));
    return { ganadora: por[kw], otras: media(por.filter((_, j) => j !== kw)) };
  };
  const todo = cuenta(T);
  const sin1 = cuenta(T - 1);
  // Los segundos que lleva la punta antes de cruzar: desde la última vez que otra iba primera.
  let toma = d.tAbre;
  for (const x of lideres) if (x.l !== d.campeona) toma = x.t + PASO_LIDER;
  // La primera y la segunda en la meta.
  const enMeta = d.lanes.map((_, j) => d.final.pos(j, 1)).sort((a, b) => b - a);
  const ganancias = remontadasDelCuarto((j, q) => d.final.pos(j, q), L);
  return {
    arco: plan.arco,
    L,
    primera: { 3: primera(3), 1.5: primera(1.5), 0.5: primera(0.5) },
    tiempoGanadora: todo.ganadora,
    tiempoOtras: todo.otras,
    tiempoGanadoraSin1: sin1.ganadora,
    tiempoOtrasSin1: sin1.otras,
    segundosPunta: T - toma,
    margen: L > 1 ? (enMeta[0] - enMeta[1]) / CUERPO : 0,
    gananciaGanadora: ganancias[kw],
    mayorRemontada: Math.max(...ganancias),
    remontadaDeLaGanadora: mayorRemontadaEsDeLaGanadora(ganancias, kw),
    cambiosRecta: cambiosEntre((t) => d.lider(t), d.tAbre, T - CABEZA_A_CABEZA),
    cambiosFinal: cambiosEntre((t) => d.lider(t), T - CABEZA_A_CABEZA, T),
    // Los cambios de punta de cada terreno del grupo (vacío con hasta 8 personas: no hay grupo).
    cambiosPorTramo: (d.tramos ?? []).map((tr) => cambiosEntre((t) => d.lider(t), tr.t0, tr.t1, 0.05)),
  };
}

/** Las rondas de un tamaño, juntas en los números que se comparan con la meta. */
export function resumirFinal(filas) {
  const frac = (fn) => media(filas.map((f) => (fn(f) ? 1 : 0)));
  const porTramo = filas.flatMap((f) => f.cambiosPorTramo);
  const conGrupo = porTramo.length > 0;
  const cociente = (a, b) => media(filas.map((f) => f[a])) / Math.max(1e-9, media(filas.map((f) => f[b])));
  return {
    rondas: filas.length,
    carriles: media(filas.map((f) => f.L)),
    primera3: frac((f) => f.primera[3]),
    primera15: frac((f) => f.primera[1.5]),
    primera05: frac((f) => f.primera[0.5]),
    tiempoVeces: cociente("tiempoGanadora", "tiempoOtras"),
    tiempoVecesSin1: cociente("tiempoGanadoraSin1", "tiempoOtrasSin1"),
    segundosMediana: cuantil(filas.map((f) => f.segundosPunta), 0.5),
    segundosMas3: frac((f) => f.segundosPunta > 3),
    margenMedio: media(filas.map((f) => f.margen)),
    margenMaximo: Math.max(...filas.map((f) => f.margen)),
    remontadaDeLaGanadora: media(filas.map((f) => f.remontadaDeLaGanadora)),
    cambiosRecta: media(filas.map((f) => f.cambiosRecta)),
    cambiosFinal: media(filas.map((f) => f.cambiosFinal)),
    cambiosPorTramo: conGrupo ? media(porTramo) : null,
    tramosEnBanda: conGrupo ? porTramo.filter((c) => c >= 1 && c <= 2).length / porTramo.length : null,
    tramos: conGrupo ? porTramo.length / filas.length : 0,
    arcos: filas.reduce((m, f) => ({ ...m, [f.arco]: (m[f.arco] ?? 0) + 1 }), {}),
  };
}

/**
 * Las metas de la dirección. `de` saca el número del resumen; `ok` dice si cumple; `meta` es lo que se imprime.
 * Una meta con `aplica(r)` falso (por ejemplo, los cambios por terreno sin grupo) no se evalúa y no cuenta.
 */
export const METAS_FINAL = [
  { clave: "primera3", nombre: "la primera a 3 s de la meta es la ganadora", de: (r) => r.primera3, formato: "pc", meta: "entre 12 y 25 %", ok: (v) => v >= 0.12 - 1e-9 && v <= 0.25 + 1e-9 },
  { clave: "primera15", nombre: "la primera a 1,5 s de la meta es la ganadora", de: (r) => r.primera15, formato: "pc", meta: "40 % o menos", ok: (v) => v <= 0.4 + 1e-9 },
  { clave: "primera05", nombre: "la primera a 0,5 s de la meta es la ganadora", de: (r) => r.primera05, formato: "pc", meta: "60 % o menos", ok: (v) => v <= 0.6 + 1e-9 },
  { clave: "tiempoVecesSin1", nombre: "tiempo en punta de la ganadora contra cada otra, sin el último segundo", de: (r) => r.tiempoVecesSin1, formato: "veces", meta: "de 0,8 a 1,25 veces", ok: (v) => v >= 0.8 - 1e-9 && v <= 1.25 + 1e-9 },
  { clave: "tiempoVeces", nombre: "tiempo en punta de la ganadora contra cada otra, contando todo", de: (r) => r.tiempoVeces, formato: "veces", meta: "1,4 veces o menos", ok: (v) => v <= 1.4 + 1e-9 },
  { clave: "segundosMediana", nombre: "segundos en punta de la ganadora antes de cruzar (mediana)", de: (r) => r.segundosMediana, formato: "s", meta: "de 0,5 a 1,2 s", ok: (v) => v >= 0.5 - 1e-9 && v <= 1.2 + 1e-9 },
  { clave: "segundosMas3", nombre: "carreras con la ganadora más de 3 s en punta antes de cruzar", de: (r) => r.segundosMas3, formato: "pc", meta: "15 % o menos", ok: (v) => v <= 0.15 + 1e-9 },
  { clave: "margenMedio", nombre: "margen en la meta (media, en cuerpos)", de: (r) => r.margenMedio, formato: "cuerpos", meta: "de 0,1 a 0,5 cuerpos", ok: (v) => v >= 0.1 - 1e-9 && v <= 0.5 + 1e-9 },
  { clave: "margenMaximo", nombre: "margen en la meta (el mayor, en cuerpos)", de: (r) => r.margenMaximo, formato: "cuerpos", meta: "nunca más de 1 cuerpo", ok: (v) => v <= 1 + 1e-9 },
  { clave: "remontadaDeLaGanadora", nombre: "la mayor remontada del último cuarto es de la ganadora", de: (r) => r.remontadaDeLaGanadora, formato: "pc", meta: "1 de cada 3 o menos", ok: (v) => v <= 1 / 3 + 1e-9 },
  { clave: "cambiosPorTramo", nombre: "cambios de punta por terreno del grupo (media)", de: (r) => r.cambiosPorTramo, formato: "n", meta: "de 1 a 2", aplica: (r) => r.cambiosPorTramo !== null, ok: (v) => v >= 1 - 1e-9 && v <= 2 + 1e-9 },
  { clave: "cambiosRecta", nombre: "cambios de punta en la recta, antes del cabeza a cabeza (media)", de: (r) => r.cambiosRecta, formato: "n", meta: "de 3 a 5", ok: (v) => v >= 3 - 1e-9 && v <= 5 + 1e-9 },
];

const pc = (v) => `${(v * 100).toFixed(1).replace(".", ",")} %`;
const FORMATOS = {
  pc,
  veces: (v) => `${v.toFixed(2).replace(".", ",")} veces`,
  s: (v) => `${v.toFixed(2).replace(".", ",")} s`,
  cuerpos: (v) => `${v.toFixed(2).replace(".", ",")} cuerpos`,
  n: (v) => v.toFixed(2).replace(".", ","),
};

/** Cada meta contra el resumen de un tamaño: `{ clave, nombre, valor, texto, meta, ok }`. */
export function evaluarFinal(resumen, metas = METAS_FINAL) {
  return metas
    .filter((m) => !m.aplica || m.aplica(resumen))
    .map((m) => {
      const valor = m.de(resumen);
      return { clave: m.clave, nombre: m.nombre, valor, texto: FORMATOS[m.formato](valor), meta: m.meta, ok: Number.isFinite(valor) && m.ok(valor) };
    });
}

/** Una tabla de texto: una fila por meta, una columna por tamaño. `porTamano` es `{ 18: filasEvaluadas, ... }`. */
export function tablaFinal(porTamano) {
  const tamanos = Object.keys(porTamano);
  const claves = METAS_FINAL.map((m) => m.clave).filter((c) => tamanos.some((n) => porTamano[n].some((f) => f.clave === c)));
  const nombre = (c) => METAS_FINAL.find((m) => m.clave === c).nombre;
  const meta = (c) => METAS_FINAL.find((m) => m.clave === c).meta;
  const celda = (n, c) => {
    const f = porTamano[n].find((x) => x.clave === c);
    return f ? `${f.ok ? "✓" : "✗"} ${f.texto}` : "—";
  };
  const cols = ["medida", "meta", ...tamanos.map((n) => `${n} personas`)];
  const filas = claves.map((c) => [nombre(c), meta(c), ...tamanos.map((n) => celda(n, c))]);
  const ancho = cols.map((c, i) => Math.max(c.length, ...filas.map((f) => f[i].length)));
  const linea = (f) => `  ${f.map((c, i) => c.padEnd(ancho[i])).join("  ")}`;
  return [linea(cols), linea(ancho.map((a) => "-".repeat(a))), ...filas.map(linea)].join("\n");
}

/* ------------------------------------------------------------------ lo dibujado */

/**
 * Los segundos de la recta en que las llamas pasan de la formación del grupo a sus carriles (`fraccionMovida` en `carrera.ts`
 * tarda 1,6 s): ahí el orden dibujado todavía no es el del plan, porque cada una viene de un lugar del grupo.
 */
export const ENTRADA_A_CARRILES = 1.6;

/**
 * Lo que se dibuja contra lo que dice el plan, en una corrida con navegador (`window.__encuadre`, ver `carrera.ts`).
 * Con el hocico de cada una en el mundo en cada cuadro, quién va primera es la de más a la derecha: acá se compara con el
 * `lider` del plan en el mismo cuadro. Si el motor dibujara otra cosa (el 3D con otro orden), saldría acá.
 *
 * @param muestras  las de `window.__encuadre.muestras` con `narices` y `lider`
 * @param tAbre     desde cuándo es la recta: antes, las llamas están en la formación del grupo (que el plan no ordena por hocico)
 * @returns cuántos cuadros se miraron, en cuántos la primera dibujada no es la del plan (`distintos`, desde `ENTRADA_A_CARRILES` s
 *          después de abrirse la recta; `distintosEntrada`, en esos primeros segundos, en que las llamas todavía entran a sus
 *          carriles), y si la primera a `antes` s de la meta lo es
 */
export function dibujadoContraElPlan(muestras, tCrown, antes = 1.5, tAbre = -Infinity) {
  const con = muestras.filter((m) => Array.isArray(m.narices) && m.lider !== undefined && m.tj < tCrown && m.tj >= tAbre);
  let distintos = 0;
  let distintosEntrada = 0;
  for (const m of con) {
    const x = Math.max(...m.narices);
    const primeras = m.narices.map((n, j) => (n >= x - 1e-9 ? j : -1)).filter((j) => j >= 0);
    // Con dos hocicos empatados al píxel, cualquiera de los dos vale.
    if (primeras.includes(m.lider)) continue;
    if (Number.isFinite(tAbre) && m.tj < tAbre + ENTRADA_A_CARRILES) distintosEntrada++;
    else distintos++;
  }
  const alFinal = con.filter((m) => m.tj <= tCrown - antes).pop();
  const ganadoraDibujada = alFinal ? alFinal.narices.indexOf(Math.max(...alFinal.narices)) : -1;
  return { cuadros: con.length, distintos, distintosEntrada, primeraDibujada: ganadoraDibujada, primeraDelPlan: alFinal ? alFinal.lider : -1 };
}
