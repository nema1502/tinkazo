/**
 * Qué se le pide a cada candidata de sonido de la carrera, medida sobre el audio ya renderizado.
 *
 * Las metas salen de la sección 8 de la dirección de la carrera (6 de noviembre de 2026): sonoridad del show −18 LUFS con
 * 2 de margen, pérdida de 3 LU o menos en un parlante que corta en 150 Hz (6 en 300 Hz), pico real −1 dBTP o menos,
 * silencio de 0,4 s bajo −50 dB entre el clic y el golpe, golpe de 6 a 10 LU sobre la música de la recta y una sola
 * fanfarria. Lo que la dirección no fija pieza por pieza (cuánto suena un paso o una echada) son bandas de la sonoridad
 * momentánea que propone este archivo, marcadas abajo: sirven para que ninguna candidata quede inaudible bajo la música ni la tape.
 *
 * Esto es lo que se puede medir sin oídos. Que una candidata cumpla no dice que suene bien: eso lo decide quien escucha.
 */

export const REFERENCIA_RECTA = -18;

/** Bandas de la sonoridad momentánea más alta (400 ms, en LUFS) de cada pieza de efecto, a nivel de show. */
export const BANDAS = {
  // Propuestas: un paso se siente más de lo que se oye; una echada y un obstáculo se oyen sin tapar la música (−18).
  pasos: [-40, -26],
  echarse: [-28, -14],
  obstaculos: [-24, -10],
  // De la dirección: el golpe suena de 6 a 10 LU sobre la música de la recta (−18).
  final: [REFERENCIA_RECTA + 6, REFERENCIA_RECTA + 10],
  // Propuesta: el festejo se oye debajo del golpe.
  festejo: [-20, -10],
};


/**
 * Juzga una candidata. `m` trae las medidas de `medirCandidata`: `medida` (de `medirSenal`), `registro`
 * (fracción de la energía entre 250 Hz y 4 kHz: se informa, no se exige; lo que se exige del registro es lo que se pierde sin graves), `silencio` (para el final: el nivel máximo, en dBFS, de las ventanas
 * de silencio), `golpe` (la sonoridad momentánea del golpe) y `duracionFestejo`.
 */
export function juzgar(pieza, m) {
  const fallas = [];
  const x = m.medida;
  if (x.recortes > 0) fallas.push(`${x.recortes} muestras recortadas`);
  if (x.picoRealDb > -1) fallas.push(`pico real ${x.picoRealDb.toFixed(1)} dBTP (el límite es −1)`);
  // Una pieza larga (la música) se juzga por su sonoridad integrada; una corta, por la momentánea más alta, que es la que se oye.
  const pierde150 = pieza === "musica" ? x.pierde150 : x.pierde150Momentanea;
  const pierde300 = pieza === "musica" ? x.pierde300 : x.pierde300Momentanea;
  if (pierde150 > 3) fallas.push(`pierde ${pierde150.toFixed(1)} LU sin graves de 150 Hz (el límite es 3)`);
  if (pierde300 > 6) fallas.push(`pierde ${pierde300.toFixed(1)} LU sin graves de 300 Hz (el límite es 6)`);
  if (pieza === "musica") {
    if (Math.abs(x.I + 18) > 2) fallas.push(`suena a ${x.I.toFixed(1)} LUFS y tiene que estar en −18 con 2 de margen`);
  } else if (pieza === "final") {
    const [lo, hi] = BANDAS.final;
    if (m.golpe < lo || m.golpe > hi) fallas.push(`el golpe suena a ${m.golpe.toFixed(1)} LUFS (${(m.golpe - REFERENCIA_RECTA).toFixed(1)} sobre la recta) y tiene que estar entre ${lo} y ${hi}`);
    if (m.silencio > -50) fallas.push(`en el silencio de antes del golpe suena ${m.silencio.toFixed(1)} dBFS y tiene que estar bajo −50`);
  } else {
    const [lo, hi] = BANDAS[pieza];
    if (x.momentanea < lo || x.momentanea > hi) fallas.push(`suena a ${x.momentanea.toFixed(1)} LUFS (momentánea) y tiene que estar entre ${lo} y ${hi}`);
    if (pieza === "festejo" && (m.duracionFestejo < 2 || m.duracionFestejo > 3.1)) fallas.push(`dura ${m.duracionFestejo.toFixed(2)} s y tiene que durar de 2 a 3`);
  }
  return { ok: fallas.length === 0, fallas };
}

/** Cuánto hay que subir o bajar una pieza para llevarla al nivel de la meta (dB), según qué mide su meta. */
export function correccionDeNivel(pieza, m) {
  const x = m.medida;
  if (pieza === "musica") return -18 - x.I;
  if (pieza === "final") return (BANDAS.final[0] + BANDAS.final[1]) / 2 - m.golpe;
  const [lo, hi] = BANDAS[pieza];
  return (lo + hi) / 2 - x.momentanea;
}
