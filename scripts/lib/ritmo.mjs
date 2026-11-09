/**
 * El ritmo de los hechos, para `audit-emocion.mjs` (el grupo `ritmo`).
 *
 * Lo que `docs/juegos.md` decía que el auditor no podía ver ("un hecho nuevo
 * cada dos segundos", "los primeros tres segundos son llamada de atención",
 * "un cuarto de segundo de silencio antes del golpe", "la última pasada saca a
 * alguien") sale del plan del juego: `window.__nino.verdad().paso` es lo último
 * que pasó y desde qué segundo, y el kit lo declara para cada hecho.
 *
 * Qué se mide, por juego y por semilla:
 *
 * 1. **Los huecos entre hechos.** Un hecho nuevo cada 1,5 a 2,5 s (la mediana
 *    de los huecos) y nunca más de 4 s sin uno (ningún hueco pasa de eso).
 * 2. **Los primeros 3 s son llamada de atención.** Ningún hecho de información
 *    (`salio`, `adelante`, `freno`, `casi`) antes de los 3 s.
 * 3. **Silencio antes del golpe.** El último efecto de sonido que suena antes
 *    del golpe termina entre 0,2 y 0,6 s antes de él. Es un hueco a propósito:
 *    `audit-sound` solo se queja de huecos de más de 4 s, así que este no lo
 *    toca. La música no se mide: se agenda con el reloj del audio y no con el del
 *    juego, y con el reloj en turbo no coincide con el golpe.
 * 4. **La última pasada saca a alguien.** Si un subtítulo dice «última» (o
 *    «last» o «final») y en los 3 s siguientes no hay un hecho `salio` ni `gano`,
 *    fue una pasada vacía.
 *
 * Todo esto es informativo. Con `--ritmo-estricto` las cuatro son compuertas.
 * Lo de este archivo es puro, sin DOM, salvo `instalarRitmo`, que corre dentro
 * de la página.
 */

/** La banda de la mediana de los huecos entre hechos, en segundos. */
export const HUECO_BANDA = [1.5, 2.5];
/** Ningún hueco entre dos hechos puede pasar de esto, en segundos. */
export const HUECO_MAXIMO = 4;
/** Hasta qué segundo el juego solo llama la atención. */
export const SOLO_ATENCION = 3;
/** Los hechos que dan información: antes de `SOLO_ATENCION` no puede haber ninguno. */
export const TIPOS_DE_INFORMACION = ["salio", "adelante", "freno", "casi"];
/** El silencio que termina en el golpe: de un cuarto de segundo a algo más de medio. */
export const SILENCIO_BANDA = [0.2, 0.6];
/** Cuánto después de un subtítulo de «última» tiene que haber alguien que salga o gane. */
export const VENTANA_ULTIMA = 3;
/** Un subtítulo de última pasada, en español y en inglés. */
const RE_ULTIMA_PALABRA = /(^|[^\p{L}])(última|ultima|last|final)(?![\p{L}])/iu;
/** «La recta final» y «the final stretch» anuncian el tramo de llegada, no una última pasada. */
const RE_TRAMO_FINAL = /recta\s+final|final\s+stretch/giu;
export const RE_ULTIMA = { test: (texto) => RE_ULTIMA_PALABRA.test(String(texto).replace(RE_TRAMO_FINAL, " ")) };
/** Dos hechos a menos de esto se cuentan como uno solo, como pasa con el aviso y la salida que lo sigue. */
const MISMO_INSTANTE = 0.05;

/**
 * Corre adentro de la página, una vez por cuadro de juego (el reloj en turbo de
 * `audit-emocion.mjs` la llama con la hora virtual). Necesita `?auditar=nino`:
 * sin `window.__nino` no hay plan que mirar y `window.__rit.conPlan` queda en
 * falso. Anota los cambios de `paso`, los subtítulos, los efectos de sonido
 * (cuándo arrancan y cuánto duran) y el cuadro del golpe.
 */
export function instalarRitmo() {
  const R = { conPlan: false, cambios: [], subs: [], osc: [], golpeT: null, golpeV: null, duracion: null, fin: false, ultimaV: 0 };
  window.__rit = R;

  // El enganche de los osciladores, como el de `audit-sound`. Una nota agendada
  // con un adelanto (`start(ahora + 0.12)`) suena ese adelanto después de la hora
  // en que se pidió.
  const OP = OscillatorNode.prototype;
  const start = OP.start;
  const stop = OP.stop;
  OP.start = function (w) {
    let ahora = 0;
    try { ahora = this.context.currentTime; } catch (e) { /* sin contexto */ }
    const cuando = Math.max(+w || 0, ahora);
    this.__r = { v: performance.now() / 1000 + (cuando - ahora), cuando, dur: 0, musica: !!this.__musica };
    R.osc.push(this.__r);
    return start.apply(this, arguments);
  };
  OP.stop = function (w) {
    if (this.__r) this.__r.dur = Math.max(0, (+w || 0) - this.__r.cuando);
    return stop.apply(this, arguments);
  };

  let llave = "";
  let sub = "";
  R.muestrear = (virt) => {
    R.ultimaV = virt / 1000;
    const N = window.__nino;
    const plan = !!N && typeof N.t === "function";
    // Sin plan (el juego no deja `__nino`) se sigue el golpe y los subtítulos con la hora del reloj.
    const t = plan ? N.t() : virt / 1000;
    if (plan) {
      R.conPlan = true;
      if (R.duracion === null) R.duracion = N.duracion;
      const p = N.verdad().paso;
      const k = `${p.tipo}|${p.desde}|${p.quien}`;
      if (k !== llave) {
        llave = k;
        R.cambios.push({ tipo: p.tipo, quien: p.quien ?? null, desde: p.desde, visto: t });
      }
    }
    const txt = (document.querySelector(".commentary") || {}).textContent || "";
    if (txt && txt !== sub) {
      sub = txt;
      R.subs.push({ t, texto: txt });
    }
    // El golpe lo anota el director en el lienzo en el mismo cuadro en que suena la fanfarria.
    if (R.golpeV === null) {
      const cv = document.getElementById("race-canvas");
      if (cv && cv.dataset.golpe) { R.golpeV = virt / 1000; R.golpeT = t; }
    }
  };
}

/* ------------------------------------------------------------ la línea de tiempo */

/**
 * La línea de tiempo de los hechos: cada cambio de `paso` distinto de `nada`,
 * una vez, con el segundo en que el plan dice que pasó (`desde`). Termina en el
 * golpe: el silencio de después del último hecho no es un hueco.
 *
 * @param cambios  los `paso` que se vieron, en orden: `{ tipo, quien, desde }`
 * @param golpeT   la hora de juego del golpe, o null si no llegó
 */
export function lineaDeHechos(cambios, golpeT = null) {
  const vistos = new Set();
  const hechos = [];
  for (const c of cambios ?? []) {
    if (!c || c.tipo === "nada") continue;
    const k = `${c.tipo}|${c.desde}|${c.quien ?? ""}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    hechos.push({ tipo: c.tipo, quien: c.quien ?? null, t: +c.desde });
  }
  hechos.sort((a, b) => a.t - b.t);
  // El final de la línea es quien gana; si el juego no lo declaró, el golpe.
  const gano = hechos.find((h) => h.tipo === "gano");
  const fin = gano ? gano.t : golpeT;
  return { hechos: fin === null || fin === undefined ? hechos : hechos.filter((h) => h.t <= fin + 1e-9), fin: fin ?? null };
}

/** Los huecos entre un hecho y el siguiente, desde el segundo cero hasta el final. */
export function huecosEntre(hechos, fin) {
  const horas = [0, ...hechos.map((h) => h.t)];
  if (fin !== null && fin !== undefined) horas.push(fin);
  horas.sort((a, b) => a - b);
  const unicas = [];
  for (const h of horas) if (!unicas.length || h - unicas[unicas.length - 1] > MISMO_INSTANTE) unicas.push(h);
  const huecos = [];
  for (let i = 1; i < unicas.length; i++) huecos.push(unicas[i] - unicas[i - 1]);
  return huecos;
}

const mediana = (xs) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  return v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const r2 = (x) => (x === null || x === undefined ? null : +x.toFixed(2));

/** Los hechos que dan información y caen antes de los primeros 3 s. */
export function informacionTemprana(hechos) {
  return hechos.filter((h) => TIPOS_DE_INFORMACION.includes(h.tipo) && h.t < SOLO_ATENCION - 1e-9);
}

/**
 * Los subtítulos de «última pasada» que no sacaron a nadie: en los 3 s que
 * siguen no hay un hecho `salio` ni `gano`.
 */
export function pasadasVacias(subs, hechos) {
  const vacias = [];
  for (const s of subs ?? []) {
    if (!RE_ULTIMA.test(s.texto)) continue;
    const saca = hechos.some((h) => (h.tipo === "salio" || h.tipo === "gano") && h.t >= s.t - 0.3 && h.t <= s.t + VENTANA_ULTIMA);
    if (!saca) vacias.push({ t: r2(s.t), texto: String(s.texto).slice(0, 40) });
  }
  return vacias;
}

/**
 * El silencio que termina en el golpe: cuánto antes de él terminó el último
 * efecto que sonaba. Solo cuentan los efectos que arrancaron antes del golpe
 * (la fanfarria arranca en él). Sin efectos antes del golpe no hay con qué medir (null).
 *
 * @param osc     `{ v, dur, musica }` por oscilador: `v` es la hora en que empieza a sonar, en segundos del reloj de la página
 * @param golpeV  la hora del golpe en ese mismo reloj
 */
export function silencioAntesDelGolpe(osc, golpeV) {
  if (golpeV === null || golpeV === undefined) return null;
  let fin = null;
  for (const o of osc ?? []) {
    if (o.musica || !(o.v < golpeV - 1e-3)) continue;
    const e = o.v + (o.dur > 0 ? o.dur : 0.05);
    if (fin === null || e > fin) fin = e;
  }
  return fin === null ? null : Math.max(0, golpeV - fin);
}

/** Todo lo de una semilla, de lo que anotó la página (`window.__rit`). */
export function medirSemilla(rit) {
  if (!rit || !rit.conPlan) {
    return { conPlan: false, silencio: rit ? silencioAntesDelGolpe(rit.osc, rit.golpeV) : null, subtitulos: (rit?.subs ?? []).length, huecosSubs: huecosDeSubtitulos(rit?.subs, rit?.golpeT).map(r2) };
  }
  const { hechos, fin } = lineaDeHechos(rit.cambios, rit.golpeT ?? rit.duracion);
  const huecos = huecosEntre(hechos, fin);
  return {
    conPlan: true,
    golpe: rit.golpeT !== null,
    hechos: hechos.length,
    huecos: huecos.map(r2),
    mediana: r2(mediana(huecos)),
    maximo: r2(huecos.length ? Math.max(...huecos) : null),
    sobreMaximo: huecos.filter((h) => h > HUECO_MAXIMO + 1e-9).length,
    temprana: informacionTemprana(hechos).map((h) => `${h.tipo} ${r2(h.t)} s`),
    silencio: r2(silencioAntesDelGolpe(rit.osc, rit.golpeV)),
    vacias: pasadasVacias(rit.subs, hechos),
    ultimas: (rit.subs ?? []).filter((s) => RE_ULTIMA.test(s.texto)).length,
    subtitulos: (rit.subs ?? []).length,
    huecosSubs: huecosDeSubtitulos(rit.subs, rit.golpeT ?? rit.duracion).map(r2),
  };
}

/** Los huecos entre un subtítulo y el siguiente, hasta el golpe. Es contexto: los subtítulos no son hechos. */
export function huecosDeSubtitulos(subs, fin) {
  const horas = (subs ?? []).map((s) => s.t).filter((t) => fin === null || fin === undefined || t <= fin);
  const h = [];
  for (let i = 1; i < horas.length; i++) h.push(horas[i] - horas[i - 1]);
  return h;
}

/** Las semillas de un juego, juntas: lo que va en la tabla y en el JSON. */
export function resumirRitmo(semillas) {
  const v = semillas.filter(Boolean);
  const conPlan = v.filter((s) => s.conPlan);
  const silencios = v.map((s) => s.silencio).filter((x) => x !== null && x !== undefined);
  const hs = v.flatMap((s) => s.huecosSubs ?? []);
  const base = {
    semillas: v.length,
    subsMediana: r2(mediana(hs)),
    subsMaximo: hs.length ? r2(Math.max(...hs)) : null,
    conPlan: conPlan.length,
    silencioMin: silencios.length ? r2(Math.min(...silencios)) : null,
    silencioMediana: r2(mediana(silencios)),
    silencioMax: silencios.length ? r2(Math.max(...silencios)) : null,
    silencioFuera: silencios.filter((x) => x < SILENCIO_BANDA[0] - 1e-9 || x > SILENCIO_BANDA[1] + 1e-9).length,
    silencios: silencios.length,
  };
  if (!conPlan.length) return { ...base, hechos: null, medianaHuecos: null, maximoHuecos: null, huecosSobre4: null, temprana: null, vacias: null, ultimas: null };
  const todos = conPlan.flatMap((s) => s.huecos);
  return {
    ...base,
    hechos: r2(mediana(conPlan.map((s) => s.hechos))),
    medianaHuecos: r2(mediana(todos)),
    maximoHuecos: r2(Math.max(...todos)),
    huecosSobre4: conPlan.reduce((a, s) => a + s.sobreMaximo, 0),
    temprana: conPlan.reduce((a, s) => a + s.temprana.length, 0),
    ejemplosTemprana: [...new Set(conPlan.flatMap((s) => s.temprana))].slice(0, 3),
    vacias: conPlan.reduce((a, s) => a + s.vacias.length, 0),
    ultimas: conPlan.reduce((a, s) => a + s.ultimas, 0),
  };
}

/**
 * Qué reglas no cumple un juego, en palabras. Vacío si cumple las cuatro. Un
 * juego que no deja medir una regla no la cumple: una compuerta no puede dejar
 * pasar lo que no ve (`sin medir`).
 */
export function fallasDeRitmo(r) {
  const f = [];
  if (r.medianaHuecos === null) f.push("hechos: sin medir (el juego no deja su plan a la vista)");
  else {
    if (r.medianaHuecos < HUECO_BANDA[0] || r.medianaHuecos > HUECO_BANDA[1]) f.push(`hecho nuevo cada ${segs(r.medianaHuecos)} de mediana (pide de ${segs(HUECO_BANDA[0])} a ${segs(HUECO_BANDA[1])})`);
    if (r.huecosSobre4 > 0) f.push(`${r.huecosSobre4} hueco(s) de más de ${HUECO_MAXIMO} s sin un hecho (el mayor, ${segs(r.maximoHuecos)})`);
    if (r.temprana > 0) f.push(`${r.temprana} hecho(s) de información antes de los ${SOLO_ATENCION} s (${(r.ejemplosTemprana ?? []).join(", ")})`);
    if (r.vacias > 0) f.push(`${r.vacias} pasada(s) de «última» sin que salga ni gane nadie`);
  }
  if (r.silencios === 0) f.push("silencio antes del golpe: sin medir (no sonó ningún efecto antes del golpe)");
  else if (r.silencioFuera > 0) f.push(`silencio antes del golpe de ${segs(r.silencioMin)} a ${segs(r.silencioMax)} (pide de ${segs(SILENCIO_BANDA[0])} a ${segs(SILENCIO_BANDA[1])}; fuera en ${r.silencioFuera} de ${r.silencios})`);
  return f;
}

/** Segundos como se leen: "1,8 s". */
export const segs = (x) => (x === null || x === undefined ? "—" : `${x.toFixed(1).replace(".", ",")} s`);

/** La tabla de los juegos medidos, para imprimir. */
export function tablaDeRitmo(porJuego) {
  const cols = ["juego", "huecos (med / máx)", "> 4 s", "info < 3 s", "silencio antes del golpe", "«última» vacías", "subtítulos (med / máx)"];
  const filas = Object.entries(porJuego).map(([juego, r]) => [
    juego,
    r.medianaHuecos === null ? "sin plan" : `${segs(r.medianaHuecos)} / ${segs(r.maximoHuecos)}`,
    r.huecosSobre4 === null ? "—" : String(r.huecosSobre4),
    r.temprana === null ? "—" : String(r.temprana),
    r.silencios ? `${segs(r.silencioMediana)} (${segs(r.silencioMin)} a ${segs(r.silencioMax)})` : "sin efectos",
    r.vacias === null ? "—" : `${r.vacias} de ${r.ultimas}`,
    r.subsMediana === null ? "—" : `${segs(r.subsMediana)} / ${segs(r.subsMaximo)}`,
  ]);
  const ancho = cols.map((c, i) => Math.max(c.length, ...filas.map((f) => f[i].length)));
  const linea = (f) => `  ${f.map((c, i) => c.padEnd(ancho[i])).join("  ")}`;
  return [linea(cols), linea(ancho.map((a) => "-".repeat(a))), ...filas.map(linea)].join("\n");
}
