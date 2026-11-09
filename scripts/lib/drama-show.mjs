/**
 * El drama del show de la carrera contra lo que pide la dirección (secciones 2 y 3).
 * Lo usa `scripts/medir-drama-carrera.mjs`. Casi todo es puro (se prueba sin navegador); `instalarDrama` es lo único que
 * corre dentro de la página.
 *
 * Qué se mide:
 *
 * 1. **El silencio antes del golpe**: cuánto antes del golpe (la luz, el acercamiento y el cartel de quien gana) terminó el
 *    último sonido, de efectos o de música. La dirección pide 0,4 s sin nada. Hoy los latidos del foco (`latidosFoco`) suenan
 *    hasta pegados al golpe y la música se corta antes, así que la cuenta la manda el último efecto.
 * 2. **El golpe junto**: la luz, el acercamiento, el sonido y el cartel (cuando ya se lee: mide la mitad de su ancho final) a
 *    menos de 100 ms entre sí. La medida tiene la resolución de un cuadro del reloj en turbo (15,6 ms), que se suma al límite.
 * 3. **Los huecos**: segundos sin un hecho nuevo del plan (la salida, quien se echa, un cambio de punta, un tropiezo, un
 *    obstáculo, la llegada). La dirección pide un hecho cada 1,5 a 2,5 s y ningún hueco de más de 4 s. Es la misma línea de
 *    hechos que usa `audit-emocion` (`ritmo.mjs`); acá se arma directo del plan, en miles de rondas.
 * 4. **La duración por tramo y el total**: el vuelo y los nombres (o las tandas), el grupo, la recta y lo que no se estira (la
 *    foto, el golpe, el festejo y el cierre), contra la tabla de la sección 3.
 */

import { huecosEntre, lineaDeHechos } from "./ritmo.mjs";
import { CUADRO_S } from "./reloj-turbo.mjs";

/** El silencio que pide la dirección antes del golpe, en segundos. */
export const SILENCIO_MINIMO = 0.4;
/** Cuánto pueden separarse la luz, el acercamiento, el sonido y el cartel, en segundos. */
export const GOLPE_JUNTO = 0.1;
/** Ningún hueco entre dos hechos puede pasar de esto, en segundos. */
export const HUECO_MAXIMO = 4;
/** Cuándo se dice que el cartel «se ve»: cuando mide esta parte de su ancho final. */
export const CARTEL_SE_VE = 0.5;

/**
 * Lo que dice la tabla de la sección 3, por cantidad de personas: la duración "Normal" de cada tramo, en segundos.
 * `largada` es el vuelo de la cámara, los nombres y la salida (con tandas, solo el vuelo: los nombres van en las tandas).
 * `fijos` es lo que no se estira: la foto, el golpe y el festejo, y el cierre.
 */
export const TABLA_DIRECCION = {
  8: { tarjeta: 3.5, largada: 6, tandas: 0, grupo: 0, recta: 14, fijos: 6.5, total: 30 },
  18: { tarjeta: 3.5, largada: 7, tandas: 0, grupo: 16, recta: 15, fijos: 6.5, total: 48 },
  60: { tarjeta: 3.5, largada: 3, tandas: 20, grupo: 12, recta: 15, fijos: 6.5, total: 60 },
  200: { tarjeta: 3.5, largada: 3, tandas: 28, grupo: 12, recta: 15, fijos: 6.5, total: 68 },
};
/** La tolerancia de un tramo contra la tabla: lo mayor entre 1,5 s y un 10 %. */
export const toleranciaDe = (meta) => Math.max(1.5, 0.1 * meta);

const media = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const mediana = (xs) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

/* ------------------------------------------------------------------ en la página */

/**
 * Corre adentro de la página (el reloj en turbo la instala, `relojTurbo({ instalar: instalarDrama, muestrear:
 * "window.__dr.muestrear" })`). Necesita `?auditar=nino,camara`: con `nino` ve los hechos del plan, con `camara` el cartel.
 *
 * Anota, en segundos del reloj de la página: cada oscilador y cada fuente de audio que arranca (cuándo, cuánto dura, si es
 * música), el instante en que el estadio abre y cierra, los cambios de `paso` del plan, los subtítulos y, desde que cae el
 * golpe, el ancho del cartel en cada cuadro. Las horas de los efectos son la hora en que se pidió la nota más su adelanto en el
 * reloj del audio: con el reloj en turbo el audio va a su paso y el juego al suyo, así que solo vale lo que se agenda con
 * poco adelanto (un efecto, un latido, la fanfarria). La música se mide por su corte (`window.__golpe.musicaCorte`).
 * La luz, el acercamiento y el cartel los anota el motor en `window.__golpe` (`anotarGolpe` en `state.ts`).
 */
export function instalarDrama() {
  const D = { osc: [], cambios: [], subs: [], cartel: [], conPlan: false, duracion: null, abre: null, cierra: null, ultimaV: 0, tres: false };
  window.__dr = D;
  const enganchar = (proto, durDe) => {
    const start = proto.start;
    const stop = proto.stop;
    proto.start = function (w) {
      let ahora = 0;
      try { ahora = this.context.currentTime; } catch (e) { /* sin contexto */ }
      const cuando = Math.max(+w || 0, ahora);
      this.__d = { v: performance.now() / 1000 + (cuando - ahora), cuando, dur: durDe(this, arguments), musica: !!this.__musica };
      D.osc.push(this.__d);
      return start.apply(this, arguments);
    };
    proto.stop = function (w) {
      if (this.__d) this.__d.dur = Math.max(0, (+w || 0) - this.__d.cuando);
      return stop.apply(this, arguments);
    };
  };
  enganchar(OscillatorNode.prototype, () => 0);
  enganchar(AudioBufferSourceNode.prototype, (n, a) => (a[2] !== undefined ? +a[2] : n.buffer ? n.buffer.duration : 0));
  let llave = "";
  let sub = "";
  D.muestrear = (virt) => {
    const v = virt / 1000;
    D.ultimaV = v;
    const est = document.getElementById("stadium");
    const abierto = !!est && getComputedStyle(est).display === "block";
    if (abierto && D.abre === null) D.abre = v;
    // El lienzo 3D se va con el estadio: se anota mientras está abierto, para saber qué motor dibujó.
    if (abierto && document.getElementById("tres-canvas")) D.tres = true;
    if (!abierto && D.abre !== null && D.cierra === null) D.cierra = v;
    const N = window.__nino;
    if (N && typeof N.t === "function") {
      D.conPlan = true;
      if (D.duracion === null) D.duracion = N.duracion;
      const p = N.verdad().paso;
      const k = `${p.tipo}|${p.desde}|${p.quien}`;
      if (k !== llave) {
        llave = k;
        D.cambios.push({ tipo: p.tipo, quien: p.quien ?? null, desde: p.desde, visto: N.t() });
      }
    }
    const txt = (document.querySelector(".commentary") || {}).textContent || "";
    if (txt && txt !== sub) {
      sub = txt;
      D.subs.push({ v, texto: txt });
    }
    const G = window.__golpe;
    if (G && G.zoom !== undefined && v <= G.zoom + 2.5) {
      const c = window.__tinkazo && window.__tinkazo.cartel ? window.__tinkazo.cartel() : null;
      D.cartel.push([v, c ? c.w : 0]);
    }
  };
}

/* ------------------------------------------------------------ el silencio y el golpe */

/** Lo que dura un sonido, en segundos: si no se sabe, un toque corto. */
const durDe = (o) => (o.dur > 0 ? o.dur : 0.05);

/**
 * El silencio que termina en el golpe.
 *
 * @param osc          `{ v, dur, musica }` de cada sonido que arrancó: `v` es la hora en que empieza a sonar
 * @param golpeV       la hora del golpe en el reloj de la página
 * @param musicaCorte  la hora en que se cortó la música (`musicHold`), o undefined si no sonaba o no se cortó
 * @returns `{ efectos, musica, silencio }`: segundos entre el fin del último efecto y el golpe, entre el corte de la música y
 *          el golpe, y el menor de los dos. `null` donde no hubo con qué medir.
 */
export function silencioAntesDelGolpe({ osc, golpeV, musicaCorte }) {
  if (golpeV === null || golpeV === undefined) return { efectos: null, musica: null, silencio: null };
  let fin = null;
  for (const o of osc ?? []) {
    if (o.musica || !(o.v < golpeV - 1e-3)) continue;
    const e = o.v + durDe(o);
    if (fin === null || e > fin) fin = e;
  }
  const efectos = fin === null ? null : Math.max(0, golpeV - fin);
  const musica = musicaCorte === undefined || musicaCorte === null ? null : Math.max(0, golpeV - musicaCorte);
  const hay = [efectos, musica].filter((x) => x !== null);
  return { efectos, musica, silencio: hay.length ? Math.min(...hay) : null };
}

/**
 * Cuándo se ve el cartel: el primer cuadro en que mide la mitad de su ancho final. El cartel entra de a poco (escala desde
 * cero con un rebote), y que su caja exista un cuadro no es que se lea.
 *
 * @param cuadros  `[hora, ancho]` por cuadro desde el golpe
 */
export function cartelSeVe(cuadros, parte = CARTEL_SE_VE) {
  const final = Math.max(0, ...(cuadros ?? []).map((c) => c[1]));
  if (!(final > 0)) return null;
  const c = cuadros.find((x) => x[1] >= final * parte);
  return c ? c[0] : null;
}

/**
 * Las cuatro partes del golpe y cuánto se separan.
 *
 * @param golpe    `window.__golpe`: `{ luz, zoom, cartel }`, las horas en que el motor las anotó
 * @param osc      los sonidos, como en `silencioAntesDelGolpe`
 * @param cartel   `[hora, ancho]` del cartel desde el golpe
 * @returns `{ luz, zoom, cartelPlaca, cartelSeVe, sonido, desde, hasta, separacion }`; `separacion` es el mayor menos el menor
 *          de lo que se pudo medir, y `partes` cuántas fueron
 */
export function golpeJunto({ golpe, osc, cartel }) {
  const g = golpe ?? {};
  const zoom = g.zoom ?? null;
  // La fanfarria arranca en el mismo cuadro que el acercamiento: su primera nota es el primer efecto desde un cuadro antes.
  let sonido = null;
  if (zoom !== null) for (const o of osc ?? []) if (!o.musica && o.v >= zoom - CUADRO_S * 2 && (sonido === null || o.v < sonido)) sonido = o.v;
  const se = cartelSeVe(cartel);
  const partes = { luz: g.luz ?? null, zoom, sonido, cartel: se };
  const vistos = Object.values(partes).filter((x) => x !== null);
  const desde = vistos.length ? Math.min(...vistos) : null;
  const hasta = vistos.length ? Math.max(...vistos) : null;
  return { ...partes, cartelPlaca: g.cartel ?? null, desde, hasta, partes: vistos.length, separacion: vistos.length > 1 ? hasta - desde : null };
}

/** Lo de una semilla en el navegador, listo para juntar: `rit` es `window.__dr` y `golpe` es `window.__golpe`. */
export function medirSemillaDrama(rit, golpe) {
  const golpeV = golpe?.zoom ?? null;
  const sil = silencioAntesDelGolpe({ osc: rit?.osc, golpeV, musicaCorte: golpe?.musicaCorte });
  const gj = golpeJunto({ golpe, osc: rit?.osc, cartel: rit?.cartel });
  const total = rit && rit.abre !== null && rit.cierra !== null ? rit.cierra - rit.abre : null;
  const { hechos, fin } = lineaDeHechos(rit?.cambios ?? [], null);
  const huecos = huecosEntre(hechos, fin);
  return {
    conGolpe: golpeV !== null,
    ...sil,
    golpe: gj,
    total,
    huecosVistos: huecos.length,
    huecosSobre4: huecos.filter((h) => h > HUECO_MAXIMO + 1e-9).length,
    maximoHueco: huecos.length ? Math.max(...huecos) : null,
  };
}

/* ------------------------------------------------------------------ desde el plan */

/** Los huecos entre hechos de una ronda, del segundo cero a la llegada, con la misma línea de hechos de `audit-emocion`. */
export function huecosDelPlan(datos) {
  const cambios = (datos.sucesos ?? []).map((s) => ({ tipo: s.tipo, quien: s.quien ?? null, desde: s.desde }));
  const { hechos, fin } = lineaDeHechos(cambios, datos.tCrown);
  const huecos = huecosEntre(hechos, fin);
  return { huecos, hechos: hechos.length, sobre4: huecos.filter((h) => h > HUECO_MAXIMO + 1e-9).length, maximo: huecos.length ? Math.max(...huecos) : 0 };
}

/**
 * Los tramos de una ronda, en segundos de show "Normal": lo que la sala ve de cada parte. La tarjeta de "cómo se juega" y lo
 * que no se estira vienen del código (`TARJETA`, `FIJOS`); el resto, del plan.
 *
 * @param datos  `plan.datos`
 * @param k      `{ TARJETA, FIJOS, T_VUELO }` de `carrera-base.ts`
 */
export function duracionesDelPlan(datos, { TARJETA, FIJOS, T_VUELO }) {
  const conTandas = (datos.tandas ?? []).length > 0;
  const largada = conTandas ? T_VUELO : datos.tSalida;
  const tandas = conTandas ? datos.tSalida - T_VUELO : 0;
  const grupo = datos.tAbre - datos.tSalida;
  const recta = datos.tCrown - datos.tAbre;
  return { tarjeta: TARJETA, largada, tandas, grupo, recta, fijos: FIJOS, total: TARJETA + datos.tCrown + FIJOS };
}

/** Las rondas de un tamaño, juntas. */
export function resumirDramaPlan(rondas) {
  const huecos = rondas.flatMap((r) => r.huecos.huecos);
  const por = (clave) => media(rondas.map((r) => r.tramos[clave]));
  return {
    rondas: rondas.length,
    huecosMediana: mediana(huecos),
    huecosMaximo: Math.max(...rondas.map((r) => r.huecos.maximo)),
    rondasConHuecoLargo: rondas.filter((r) => r.huecos.sobre4 > 0).length / rondas.length,
    huecosLargosPorRonda: media(rondas.map((r) => r.huecos.sobre4)),
    tramos: Object.fromEntries(["tarjeta", "largada", "tandas", "grupo", "recta", "fijos", "total"].map((c) => [c, por(c)])),
    totalMin: Math.min(...rondas.map((r) => r.tramos.total)),
    totalMax: Math.max(...rondas.map((r) => r.tramos.total)),
  };
}

/** Las metas de la duración y de los huecos de un tamaño. Sin tabla para ese tamaño, solo los huecos. */
export function evaluarDramaPlan(resumen, n) {
  const filas = [];
  const t = TABLA_DIRECCION[n];
  const nombres = { largada: "la largada (vuelo, nombres, salida)", tandas: "las tandas", grupo: "el grupo", recta: "la recta con el cabeza a cabeza", total: "el show entero, con la tarjeta" };
  if (t) {
    for (const c of ["largada", "tandas", "grupo", "recta", "total"]) {
      if (t[c] === 0 && resumen.tramos[c] < 0.01) continue;
      const meta = t[c];
      const tol = c === "total" ? 3 : toleranciaDe(meta);
      const valor = resumen.tramos[c];
      filas.push({ clave: c, nombre: nombres[c], valor, texto: `${valor.toFixed(1).replace(".", ",")} s`, meta: `${String(meta).replace(".", ",")} s ± ${tol.toFixed(1).replace(".", ",")}`, ok: Math.abs(valor - meta) <= tol + 1e-9 });
    }
  }
  filas.push({ clave: "huecos", nombre: "rondas con un hueco de más de 4 s sin un hecho", valor: resumen.rondasConHuecoLargo, texto: `${(resumen.rondasConHuecoLargo * 100).toFixed(1).replace(".", ",")} % (el mayor, ${resumen.huecosMaximo.toFixed(1).replace(".", ",")} s)`, meta: "ninguna", ok: resumen.rondasConHuecoLargo === 0 });
  filas.push({ clave: "huecosMediana", nombre: "mediana del hueco entre hechos", valor: resumen.huecosMediana, texto: `${resumen.huecosMediana.toFixed(1).replace(".", ",")} s`, meta: "de 1,5 a 2,5 s", ok: resumen.huecosMediana >= 1.5 - 1e-9 && resumen.huecosMediana <= 2.5 + 1e-9 });
  return filas;
}

/* -------------------------------------------------------------- las semillas del navegador */

/** Las semillas de un motor y un tamaño, juntas: lo que va en la tabla y en el JSON. */
export function resumirSemillas(semillas) {
  const v = semillas.filter(Boolean);
  const con = v.filter((s) => s.conGolpe);
  const silencios = con.map((s) => s.silencio).filter((x) => x !== null);
  const efectos = con.map((s) => s.efectos).filter((x) => x !== null);
  const musica = con.map((s) => s.musica).filter((x) => x !== null);
  const seps = con.map((s) => s.golpe.separacion).filter((x) => x !== null);
  const totales = v.map((s) => s.total).filter((x) => x !== null);
  return {
    semillas: v.length,
    conGolpe: con.length,
    silencioMin: silencios.length ? Math.min(...silencios) : null,
    silencioMediana: mediana(silencios),
    efectosMediana: mediana(efectos),
    musicaMediana: mediana(musica),
    sinMusica: con.length - musica.length,
    separacionMax: seps.length ? Math.max(...seps) : null,
    separacionMediana: mediana(seps),
    partesMin: con.length ? Math.min(...con.map((s) => s.golpe.partes)) : 0,
    luzMediana: mediana(con.map((s) => (s.golpe.luz !== null && s.golpe.desde !== null ? s.golpe.luz - s.golpe.desde : null)).filter((x) => x !== null)),
    zoomMediana: mediana(con.map((s) => (s.golpe.zoom !== null && s.golpe.desde !== null ? s.golpe.zoom - s.golpe.desde : null)).filter((x) => x !== null)),
    sonidoMediana: mediana(con.map((s) => (s.golpe.sonido !== null && s.golpe.desde !== null ? s.golpe.sonido - s.golpe.desde : null)).filter((x) => x !== null)),
    cartelMediana: mediana(con.map((s) => (s.golpe.cartel !== null && s.golpe.desde !== null ? s.golpe.cartel - s.golpe.desde : null)).filter((x) => x !== null)),
    totalMedio: totales.length ? media(totales) : null,
    huecosLargos: v.reduce((a, s) => a + (s.huecosSobre4 ?? 0), 0),
  };
}

/** Las metas del navegador de un motor y un tamaño. */
export function evaluarSemillas(r) {
  const seg = (x) => (x === null || x === undefined ? "—" : `${x.toFixed(2).replace(".", ",")} s`);
  const filas = [];
  filas.push({ clave: "golpe", nombre: "corridas con golpe", valor: r.conGolpe, texto: `${r.conGolpe} de ${r.semillas}`, meta: "todas", ok: r.semillas > 0 && r.conGolpe === r.semillas });
  filas.push({
    clave: "silencio",
    nombre: "silencio de efectos y música antes del golpe (el menor de todas las corridas)",
    valor: r.silencioMin,
    texto: r.silencioMin === null ? "sin medir" : `${seg(r.silencioMin)} (efectos ${seg(r.efectosMediana)}, música ${r.musicaMediana === null ? "no sonó" : seg(r.musicaMediana)}, medianas)`,
    meta: `${String(SILENCIO_MINIMO).replace(".", ",")} s o más`,
    ok: r.silencioMin !== null && r.silencioMin >= SILENCIO_MINIMO - 1e-9,
  });
  filas.push({
    clave: "golpeJunto",
    nombre: "la luz, el acercamiento, el sonido y el cartel, juntos (la mayor separación)",
    valor: r.separacionMax,
    texto: r.separacionMax === null ? "sin medir" : `${Math.round(r.separacionMax * 1000)} ms (luz ${Math.round((r.luzMediana ?? 0) * 1000)}, acercamiento ${Math.round((r.zoomMediana ?? 0) * 1000)}, sonido ${Math.round((r.sonidoMediana ?? 0) * 1000)}, cartel ${Math.round((r.cartelMediana ?? 0) * 1000)} ms después de la primera, medianas)`,
    meta: `${GOLPE_JUNTO * 1000} ms (+ ${Math.round(CUADRO_S * 1000)} ms de un cuadro)`,
    ok: r.separacionMax !== null && r.partesMin >= 4 && r.separacionMax <= GOLPE_JUNTO + CUADRO_S + 1e-9,
  });
  return filas;
}

/** Una tabla de texto con filas `{ nombre, texto, meta, ok }`, una fila por meta. */
export function tablaDeMetas(filas, titulo = "") {
  const cols = ["medida", "meta", "resultado"];
  const f = filas.map((x) => [x.nombre, x.meta, `${x.ok ? "✓" : "✗"} ${x.texto}`]);
  const ancho = cols.map((c, i) => Math.max(c.length, ...f.map((r) => r[i].length)));
  const linea = (r) => `  ${r.map((c, i) => c.padEnd(ancho[i])).join("  ")}`;
  return [titulo, linea(cols), linea(ancho.map((a) => "-".repeat(a))), ...f.map(linea)].filter(Boolean).join("\n");
}
