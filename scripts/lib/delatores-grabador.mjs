/**
 * El grabador del auditor de delatores: lo que se inyecta en la página antes
 * de que cargue (`Page.addScriptToEvaluateOnNewDocument`).
 *
 * Hace dos cosas, sin tocar ningún juego:
 *
 * 1. **El reloj en turbo**, como el auditor de emoción: cada cuadro real
 *    despacha varios cuadros de juego de 1/64 s. La animación es función del
 *    tiempo de juego, así que la historia es la misma que a velocidad normal.
 *    Con `dibujar: false` además saltea el dibujo de los cuadros (el motor
 *    sigue calculando todo igual: posiciones, nombres, cámara), que es lo que
 *    más tarda; con doscientas semillas por juego es la diferencia entre una
 *    tarde y una noche.
 * 2. **Lo que ve la sala**, cuadro a cuadro: cada nombre que está en pantalla
 *    (dónde, de qué alto, con qué opacidad), el acercamiento de la cámara, cada
 *    subtítulo con su hora, los datos que el juego deja anotados para los
 *    auditores (`data-arco`, `data-puesto`…) y cuándo sale el cartel del
 *    ganador. PixiJS avisa cuando arranca una aplicación
 *    (`globalThis.__PIXI_APP_INIT__`), y desde ahí se recorre su escena.
 *
 * Las capas del estadio son siempre las mismas (src/games/pixi/stage.ts): el
 * cielo, la escena, la interfaz, los nombres de pasar lista y el cartel del
 * ganador. Se leen las tres del medio; el cartel solo dice cuándo se reveló.
 */
import { crearReconocedor } from "./delatores-nombres.mjs";

/**
 * El guion para la página. `cfg`:
 * - `turbo`: cuadros de juego por cuadro real (20 por defecto).
 * - `cada`: cada cuántos cuadros de juego se fotografía la escena (4: 16 por segundo).
 * - `dibujar`: si se dibuja cada cuadro (false por defecto).
 * - `numeros`: si los números sueltos de la escena ("7", "N.º 7") cuentan como
 *   el puesto en la lista (las bolas de la tómbola). Los de la interfaz no:
 *   ahí están los contadores.
 * - `marcas`: textos que no son nombres pero hay que seguir ("¡Casi!"), como fuentes de expresiones regulares.
 * - `trazos`: contornos que hay que seguir, por color, opacidad y capa
 *   (`{ color: 0xffc629, alpha: 0.9 }`, `{ color: 0xf6efe2, capa: 1 }`): el
 *   foco que saltaba de carta en carta en "¿Quién es?" era un rectángulo
 *   amarillo, y el aro de los puestos que se prenden en el trueque es un
 *   círculo crema; ninguno es un texto. Sin `alpha`, cualquier opacidad; sin
 *   `capa`, cualquiera de las tres que se leen (1 es la escena).
 * - `escena`: si se graba, en cada cuadro, cómo lleva la cámara la escena a la
 *   pantalla (dónde cae su origen y sus dos ejes), para pasar lo que se ve a la
 *   escena: en el trueque, de qué puesto es cada aro aunque su nombre no esté
 *   a la vista.
 */
export function grabador(cfg = {}) {
  const c = { turbo: 20, cada: 4, dibujar: false, numeros: false, marcas: [], trazos: [], escena: false, ...cfg };
  return `(() => {
  const CFG = ${JSON.stringify(c)};
  const crearReconocedor = ${crearReconocedor.toString()};
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0, cuadro = 0;
  const cbs = new Map();
  window.__v = () => virt;
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  const rec = { t0: null, W: innerWidth, H: innerHeight, frames: [], nums: [], marcas: [], trazos: [], escena: [], subs: [], marks: [], revelado: null, fin: null, fallas: 0, errores: 0, apps: 0 };
  window.__delator = rec;
  let app = null;
  globalThis.__PIXI_APP_INIT__ = (a) => {
    rec.apps++;
    app = a;
    if (!CFG.dibujar) {
      // El primer cuadro sí se dibuja (lo que el motor compila al arrancar), después no.
      const r = a.renderer;
      const dibujar = r.render.bind(r);
      let veces = 0;
      r.render = (...args) => (veces++ < 2 ? dibujar(...args) : undefined);
    }
  };
  const marcasRe = CFG.marcas.map((s) => new RegExp(s, "iu"));
  const numRe = /^\\s*(?:n\\.?\\s*º\\s*)?(\\d{1,4})\\s*$/iu;
  let reconocer = null;
  let mostrado = false;
  let ultimas = {};
  const r1 = (v) => Math.round(v * 10) / 10;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r4 = (v) => Math.round(v * 10000) / 10000;
  function recorrer(nodo, alfa, out, capa, contornos) {
    if (!nodo || nodo.destroyed || !nodo.visible || nodo.renderable === false) return;
    const a = alfa * (nodo.alpha ?? 1);
    if (a < 0.05) return;
    if (typeof nodo.text === "string" && nodo.style) {
      out.push([nodo, a, capa]);
      return;
    }
    if (contornos && nodo.context && Array.isArray(nodo.context.instructions)) {
      for (const ins of nodo.context.instructions) {
        if (ins.action !== "stroke" || !ins.data || !ins.data.style || !ins.data.path) continue;
        const st = ins.data.style;
        CFG.trazos.forEach((q, k) => {
          if (st.color !== q.color) return;
          if (q.capa !== undefined && q.capa !== capa) return;
          if (q.alpha !== undefined && Math.abs((st.alpha ?? 1) - q.alpha) > 0.011) return;
          const b = ins.data.path.bounds;
          if (!b || !Number.isFinite(b.minX)) return;
          const p = nodo.toGlobal({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
          const e = nodo.toGlobal({ x: b.maxX, y: b.maxY });
          contornos.push(k, r1(p.x), r1(p.y), r1(Math.abs(e.x - p.x) * 2), r1(Math.abs(e.y - p.y) * 2));
        });
      }
    }
    const hijos = nodo.children;
    if (hijos) for (let k = 0; k < hijos.length; k++) recorrer(hijos[k], a, out, capa, contornos);
  }
  function foto(t) {
    const capas = app.stage.children;
    const textos = [];
    const contornos = CFG.trazos.length ? [] : null;
    for (const k of [1, 2, 3]) recorrer(capas[k], 1, textos, k, contornos);
    const mejor = new Map();
    const nums = new Map();
    const marcas = [];
    for (const [tx, a, capa] of textos) {
      const s = tx.text;
      if (!s || s.length > 60) continue;
      let i = reconocer ? reconocer(s) : -1;
      let destino = mejor;
      if (i < 0 && CFG.numeros && capa === 1) {
        const m = numRe.exec(s);
        if (m) {
          i = Number(m[1]) - 1;
          destino = nums;
        }
      }
      const marca = i < 0 ? marcasRe.findIndex((re) => re.test(s)) : -1;
      if (i < 0 && marca < 0) continue;
      const b = tx.getBounds();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (marca >= 0) {
        marcas.push(marca, r1(x), r1(y), r1(b.height), r3(a));
        continue;
      }
      const previo = destino.get(i);
      if (!previo || b.height * a > previo[3] * previo[4]) destino.set(i, [i, r1(x), r1(y), r1(b.height), r3(a)]);
    }
    const escena = capas[1];
    const z = escena ? r3(escena.scale.x) : 1;
    rec.frames.push([r3(t), z, ...[...mejor.values()].flat()]);
    if (CFG.escena && escena) {
      const o = escena.toGlobal({ x: 0, y: 0 }), a = escena.toGlobal({ x: 1, y: 0 }), b = escena.toGlobal({ x: 0, y: 1 });
      rec.escena.push([r3(t), r1(o.x), r1(o.y), r4(a.x - o.x), r4(a.y - o.y), r4(b.x - o.x), r4(b.y - o.y)]);
    }
    if (CFG.numeros) rec.nums.push([r3(t), ...[...nums.values()].flat()]);
    if (marcas.length) rec.marcas.push([r3(t), ...marcas]);
    if (contornos && contornos.length) rec.trazos.push([r3(t), ...contornos]);
  }
  function tick() {
    const t = virt / 1000;
    const st = document.getElementById("stadium");
    const visible = !!st && st.style.display === "block";
    if (visible) mostrado = true;
    else {
      if (mostrado && rec.fin === null) rec.fin = r3(t);
      return;
    }
    if (!app || !app.stage || app.stage.destroyed) return;
    if (rec.t0 === null) rec.t0 = r3(t);
    if (!reconocer && window.__pose) reconocer = crearReconocedor(window.__pose.names);
    const ds = document.getElementById("race-canvas")?.dataset ?? {};
    for (const k of Object.keys(ds)) {
      if (ultimas[k] !== ds[k]) {
        ultimas[k] = ds[k];
        rec.marks.push([r3(t), k, ds[k]]);
      }
    }
    const podio = app.stage.children[4];
    if (rec.revelado === null && podio && podio.children.some((ch) => ch.visible)) rec.revelado = r3(t);
    if (cuadro++ % CFG.cada === 0) foto(t);
  }
  const bombear = () => {
    for (let i = 0; i < CFG.turbo && cbs.size; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      for (const cb of lote) { try { cb(virt); } catch (e) { rec.errores++; } }
      try { tick(); } catch (e) { rec.fallas++; rec.ultimaFalla = String(e && e.message || e); }
    }
    RAF(bombear);
  };
  RAF(bombear);
  // El relator escribe con \`textContent\` (S.say en stage.ts): se engancha ese
  // escritor en el elemento, así cada línea queda con la hora exacta del cuadro
  // en que salió. Con un MutationObserver llegaban al final de cada tanda de
  // cuadros, y de dos líneas en la misma tanda se perdía la primera.
  const mirarSubtitulos = () => {
    const el = document.getElementById("commentary");
    const d = Object.getOwnPropertyDescriptor(Node.prototype, "textContent");
    if (!el || !d || !d.set || !d.get) return;
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get() { return d.get.call(this); },
      set(v) {
        const s = String(v ?? "");
        if (s) rec.subs.push([Math.round(virt) / 1000, s]);
        d.set.call(this, v);
      },
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mirarSubtitulos);
  else mirarSubtitulos();
})()`;
}
