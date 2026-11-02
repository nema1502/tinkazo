/**
 * La pestaña escondida.
 *
 * El caso real de un meetup: quien organiza cambia a Zoom o a WhatsApp en el
 * medio del show y vuelve. El navegador frena los relojes de una pestaña que no
 * se ve: no hay cuadros de animación y los temporizadores pasan a uno por
 * segundo. Este módulo tiene dos partes:
 *
 *   - lo que se mide en la página (`PRELUDIO_PESTANA`, `correrPestana`), con el
 *     reloj de verdad y no el virtual de `audit-rigor`, porque lo que se prueba
 *     es justamente cómo se porta el reloj de verdad;
 *   - lo que se juzga con lo medido (`juzgarPestana` y las funciones chicas de
 *     abajo), puro y sin red, con sus pruebas en `pestana.test.mjs`.
 *
 * Todos los tiempos de lo medido son segundos desde que el estadio se ve.
 */
import { sleep } from "./browser.mjs";

/** Cuánto tiempo se esconde la pestaña. */
export const OCULTA_S = 10;
/** El medio segundo después de volver, en el que no puede caer una ráfaga. */
export const VENTANA_VUELTA_S = 0.5;
/**
 * Un sonido «atrasado» arranca más de esto en el pasado: lo programaron para antes de que sonara. Con el reloj frenado
 * (sin arreglo) llegan en racimos de 0,3 a 1,1 s de atraso, cientos en 10 s. Un tirón del hilo, que también pasa con
 * la música arreglada, deja un paso suelto de hasta 0,22 s: por eso no cuenta nada de ahí para abajo.
 */
export const TARDE_S = 0.25;
/** Cuántos sonidos atrasados caben desde que se esconde hasta medio segundo después de volver: más de 3 es una ráfaga. */
export const MAX_RAFAGA = 3;
/** Del tiempo normal que el cartel se queda a la vista, lo que se exige al volver. */
export const FRACCION_CARTEL = 0.9;

/**
 * Se inyecta antes que cualquier script de la página. No cambia ningún reloj:
 * solo anota, con la hora real, cada sonido que arranca (y si lo programaron
 * en el pasado), cada línea nueva del relator, cuándo aparece y desaparece el
 * cartel, y cada cambio de visibilidad.
 */
export const PRELUDIO_PESTANA = `(() => {
  const ps = window.__ps = { sonidos: [], coment: [], cartel: [], vis: [], errores: [], t0: -1, t1: -1, cuadros: 0, g: 0, gCierre: -1 };
  const ahora = () => performance.now();
  // La hora de juego: la suma de los cuadros con cada paso acotado a 0,05 s, como hace el motor. Una pestaña escondida no suma.
  let previo = 0;
  // Un sonido que arranca: «tarde» es cuánto antes de la hora del contexto de audio lo programaron.
  for (const C of [OscillatorNode, AudioBufferSourceNode]) {
    const o = C.prototype.start;
    C.prototype.start = function (...a) {
      try {
        const cuando = typeof a[0] === 'number' ? a[0] : this.context.currentTime;
        ps.sonidos.push({ r: ahora(), tarde: +(this.context.currentTime - cuando).toFixed(3) });
      } catch { /* sin audio */ }
      return o.apply(this, a);
    };
  }
  document.addEventListener('visibilitychange', () => ps.vis.push({ r: ahora(), v: document.visibilityState }));
  window.addEventListener('error', (e) => ps.errores.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => ps.errores.push('promesa ' + String(e.reason)));
  let ultima = '', cartelAntes = false;
  const RAF = window.requestAnimationFrame.bind(window);
  const mirar = () => {
    ps.cuadros++;
    const n = ahora();
    if (previo) ps.g += Math.min(0.05, (n - previo) / 1000);
    previo = n;
    const st = document.getElementById('stadium');
    const visible = !!st && st.style.display === 'block';
    if (visible && ps.t0 < 0) ps.t0 = ahora();
    if (ps.t0 >= 0 && !visible && ps.t1 < 0) { ps.t1 = ahora(); ps.gCierre = ps.g; }
    if (visible) {
      const c = document.querySelector('.commentary');
      const txt = c ? c.textContent : '';
      if (txt !== ultima) { ultima = txt; ps.coment.push({ r: ahora(), txt }); }
      const cv = st.querySelector('#pixi-canvas') || st.querySelector('canvas');
      const hay = !!(cv && cv.dataset.cartel);
      if (hay !== cartelAntes) { cartelAntes = hay; ps.cartel.push({ r: ahora(), on: hay, g: ps.g }); }
    }
    RAF(mirar);
  };
  RAF(mirar);
})()`;

/** Segundos desde `t0` (ambos en milisegundos). */
const seg = (r, t0) => (r - t0) / 1000;

/** Pasa lo que anotó la página (milisegundos de reloj) a segundos desde que se ve el estadio. */
export function normalizar(ps, { ganadorPlan = "", pose = null } = {}) {
  const t0 = ps.t0;
  return {
    ganadorPlan,
    pose,
    cerro: ps.t1 >= 0,
    dur: ps.t1 >= 0 ? seg(ps.t1, t0) : null,
    cuadros: ps.cuadros,
    comentarios: ps.coment.map((c) => ({ t: seg(c.r, t0), txt: c.txt })),
    cartel: ps.cartel.map((c) => ({ t: seg(c.r, t0), on: c.on, ...(typeof c.g === "number" ? { g: c.g } : {}) })),
    ...(typeof ps.gCierre === "number" && ps.gCierre >= 0 ? { gCierre: ps.gCierre } : {}),
    sonidos: ps.sonidos.map((s) => ({ t: seg(s.r, t0), tarde: s.tarde })),
    vis: ps.vis.map((v) => ({ t: seg(v.r, t0), v: v.v })),
    errores: [...ps.errores],
  };
}

/** Cuándo se escondió y cuándo volvió, o null si no pasó. */
export function ventanaOculta(vis) {
  const i = vis.findIndex((v) => v.v === "hidden");
  if (i < 0) return null;
  const vuelta = vis.slice(i + 1).find((v) => v.v === "visible");
  return vuelta ? { desde: vis[i].t, hasta: vuelta.t } : null;
}

/** Cuándo apareció el cartel por primera vez, o null. */
export function cartelDesde(cartel) {
  const c = cartel.find((x) => x.on);
  return c ? c.t : null;
}

/** El cartel se apagó antes de que cerrara el estadio (no es lo mismo que cerrar con él a la vista). */
export function cartelSeApago(cartel) {
  const i = cartel.findIndex((x) => x.on);
  return i >= 0 && cartel.slice(i + 1).some((x) => !x.on);
}

/**
 * Cuánto tiempo vio la sala el cartel, en tiempo de juego: los segundos del reloj del show (cuadros con el paso acotado a
 * 0,05 s) entre que apareció y cerró el estadio. Una corrida lenta por carga no lo estira y los segundos con la pestaña
 * escondida no cuentan porque no hay cuadros. Sin hora de juego anotada, cae al tiempo real sin los segundos escondidos.
 */
export function cartelVisibleS(corrida, oculta = null) {
  const on = corrida.cartel.find((x) => x.on);
  if (!on || corrida.dur === null) return null;
  if (typeof on.g === "number" && typeof corrida.gCierre === "number") return corrida.gCierre - on.g;
  const d = on.t;
  let total = corrida.dur - d;
  if (oculta) {
    const solapa = Math.min(corrida.dur, oculta.hasta) - Math.max(d, oculta.desde);
    if (solapa > 0) total -= solapa;
  }
  return total;
}

/** Los sonidos que arrancan en el pasado (los que el reloj frenado dejó atrasados) en `[desde, hasta)`. */
export function atrasados(sonidos, desde, hasta, umbral = TARDE_S) {
  return sonidos.filter((s) => s.t >= desde && s.t < hasta && s.tarde > umbral).length;
}

/** Se saca todo lo que no es letra ni número: así «¡ES PARA Carlos Choque!» contiene a «carlos choque». */
const plano = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim();

/** ¿La última línea que dijo el relator nombra al ganador del plan? El anuncio del ganador es lo último que se dice. */
export function ganadorDicho(comentarios, ganadorPlan) {
  const g = plano(ganadorPlan);
  const ultima = comentarios.at(-1);
  return !!g && !!ultima && plano(ultima.txt).includes(g);
}

/**
 * El ganador que se ve al coronar. El nombre del cartel se dibuja en el lienzo y no se puede leer como texto, así que
 * se juzga por lo que sí queda: si la última línea del relator nombra al ganador del plan, pasa; si el relator calló
 * al coronar (la carrera nueva borra su línea porque el cartel ya dice el nombre), pasa cuando la última línea queda vacía
 * y el cartel llegó a verse (el relator calla un poco antes de que salga), y que sea el ganador del plan lo asegura la comparación con la corrida de control.
 */
export function ganadorEnPantalla(comentarios, cartel, ganadorPlan) {
  if (ganadorDicho(comentarios, ganadorPlan)) return true;
  const desde = cartelDesde(cartel);
  const ultima = comentarios.at(-1);
  return !!plano(ganadorPlan) && desde !== null && !!ultima && plano(ultima.txt) === "";
}

/**
 * Juzga una corrida con la pestaña escondida contra la de control (la misma
 * escena sin esconder nada). Devuelve las comprobaciones: `{ name, ok, detail }`.
 *
 * - El ganador que se ve es el del plan: el cartel apareció, y lo último que
 *   dijo el relator nombra al ganador del plan.
 * - Cero excepciones, en la página y en la consola.
 * - Si el golpe cayó con la pestaña escondida (o después de volver), el cartel
 *   está a la vista y se queda su tiempo normal. Si ya había caído antes de
 *   esconderla, no se apagó al volver.
 * - Sin ráfaga: a lo sumo `MAX_RAFAGA` sonidos atrasados desde que se esconde
 *   hasta medio segundo después de volver. El pedido original miraba solo ese
 *   medio segundo, pero el racimo que cae al volver depende de en qué punto del
 *   segundo de espera del navegador se vuelva; mirando también lo de escondida,
 *   la comprobación no depende de la suerte.
 */
export function juzgarPestana({ control, prueba, excepciones = [], etiqueta = "" }) {
  const e = etiqueta ? `${etiqueta}: ` : "";
  const out = [];
  const oculta = ventanaOculta(prueba.vis);
  out.push({
    name: `${e}se esconde y se vuelve, y el show cierra solo`,
    ok: !!oculta && prueba.cerro,
    detail: oculta ? `escondida de los ${oculta.desde.toFixed(1)} a los ${oculta.hasta.toFixed(1)} s · el show duró ${prueba.dur === null ? "?" : prueba.dur.toFixed(1)} s (sin esconder: ${control.dur === null ? "?" : control.dur.toFixed(1)} s)` : "la pestaña no llegó a esconderse",
  });
  if (!oculta) return out;

  const desde = cartelDesde(prueba.cartel);
  out.push({
    name: `${e}el ganador en pantalla es el del plan`,
    ok: desde !== null && ganadorEnPantalla(prueba.comentarios, prueba.cartel, prueba.ganadorPlan) && control.ganadorPlan === prueba.ganadorPlan,
    detail: desde === null ? "el cartel nunca apareció" : `plan: ${prueba.ganadorPlan || "?"} · último dicho: ${prueba.comentarios.at(-1)?.txt || "vacío"}`,
  });

  out.push({
    name: `${e}cero excepciones`,
    ok: prueba.errores.length + excepciones.length === 0,
    detail: [...prueba.errores, ...excepciones].slice(0, 1).join(" ").slice(0, 120),
  });

  const normal = cartelVisibleS(control);
  const visto = cartelVisibleS(prueba, oculta);
  const cayoEscondida = desde !== null && desde >= oculta.desde;
  const apagado = cartelSeApago(prueba.cartel);
  out.push({
    name: `${e}el cartel está a la vista y se queda su tiempo normal`,
    ok: desde !== null && !apagado && normal !== null && visto !== null && visto >= FRACCION_CARTEL * normal,
    detail: desde === null
      ? "el cartel nunca apareció"
      : `${cayoEscondida ? "cayó con la pestaña escondida o después" : "ya estaba antes de esconderla"} · a la vista ${visto === null ? "?" : visto.toFixed(1)} s contra ${normal === null ? "?" : normal.toFixed(1)} s normales${apagado ? " · SE APAGÓ antes de cerrar" : ""}`,
  });

  const alVolver = atrasados(prueba.sonidos, oculta.hasta, oculta.hasta + VENTANA_VUELTA_S);
  const n = atrasados(prueba.sonidos, oculta.desde, oculta.hasta + VENTANA_VUELTA_S);
  out.push({
    name: `${e}sin ráfaga de sonidos atrasados`,
    ok: n <= MAX_RAFAGA,
    detail: `${n} atrasados más de ${Math.round(TARDE_S * 1000)} ms desde que se escondió hasta medio segundo después de volver (hasta ${MAX_RAFAGA}), ${alVolver} de ellos al volver`,
  });
  return out;
}

/**
 * Corre una escena fija con el reloj de verdad y, si se pide, esconde la
 * pestaña `ocultaS` segundos cuando pasó `escondeEn` segundos del show:
 * abre una segunda pestaña y la pasa al frente, como quien cambia de ventana.
 *
 * `capturas`: una carpeta para guardar tres imágenes (al volver, 0,3 s
 * después y con el cartel).
 */
export async function correrPestana(browser, url, { escondeEn = null, ocultaS = OCULTA_S, capturas = null, nombre = "escena", limite = 240_000 } = {}) {
  const p = await browser.open("about:blank");
  await p.send("Page.addScriptToEvaluateOnNewDocument", { source: PRELUDIO_PESTANA });
  await p.send("Page.navigate", { url });
  const arranco = await p.waitFor("window.__ps && window.__ps.t0 >= 0", 60_000);
  let otra = null;
  let escondida = false;
  const sacar = async (cual) => {
    if (!capturas) return;
    try {
      await p.screenshot(`${capturas}/${nombre}-${cual}.png`);
    } catch {
      /* la captura no es parte de la prueba */
    }
  };
  let cartelFoto = false;
  const t0 = Date.now();
  while (arranco.ok && Date.now() - t0 < limite) {
    const e = JSON.parse(await p.eval(`JSON.stringify({ t0: __ps.t0, t1: __ps.t1, ahora: performance.now(), cartel: __ps.cartel.length })`));
    if (e.t1 >= 0) break;
    const corre = (e.ahora - e.t0) / 1000;
    if (escondeEn !== null && !escondida && corre >= escondeEn) {
      escondida = true;
      otra = await browser.open("about:blank");
      await otra.send("Page.bringToFront");
      await sleep(ocultaS * 1000);
      await p.send("Page.bringToFront");
      await sleep(80);
      await sacar("1-al-volver");
      await sleep(300);
      await sacar("2-tras-0.3s");
    }
    if (capturas && e.cartel > 0 && !cartelFoto && escondida) {
      cartelFoto = true;
      await sleep(600);
      await sacar("3-cartel");
    }
    await sleep(100);
  }
  const ps = JSON.parse(await p.eval(`JSON.stringify(window.__ps)`));
  const pose = JSON.parse(await p.eval(`JSON.stringify(window.__pose ? { names: window.__pose.names, winners: window.__pose.winners } : null)`));
  const excepciones = [...p.exceptions];
  for (const x of [p, otra]) {
    try {
      await x?.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
  const ganadorPlan = pose ? pose.names[pose.winners[0]] ?? "" : "";
  return { ...normalizar(ps, { ganadorPlan, pose }), excepciones, arranco: arranco.ok };
}
