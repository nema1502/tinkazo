/*
 * El reloj de los clips: se inyecta ANTES que cualquier script de la página
 * (Page.addScriptToEvaluateOnNewDocument). Cambia el reloj de verdad por uno que
 * mueve el grabador, un paso por vez: requestAnimationFrame, performance.now,
 * setTimeout y setInterval avanzan solo cuando se llama a __clip.paso(). Con
 * eso el show se dibuja cuadro por cuadro, tan rápido como la máquina pueda, y
 * dos corridas con la misma semilla dibujan los mismos cuadros.
 * Sin audio: los clips salen sin música para que quien los edita ponga la suya.
 */
(() => {
  const FPS = 60;
  const STEP = 1000 / FPS;
  const real = { setTimeout: window.setTimeout.bind(window), now: performance.now.bind(performance) };
  let virt = 0, id = 0, tid = 0;
  const raf = new Map();
  const timers = new Map();
  const errores = [];
  window.requestAnimationFrame = (cb) => { raf.set(++id, cb); return id; };
  window.cancelAnimationFrame = (i) => { raf.delete(i); };
  performance.now = () => virt;
  window.setTimeout = (fn, ms = 0, ...a) => {
    if (typeof fn !== "function") return 0;
    const i = ++tid; timers.set(i, { t: virt + Math.max(0, +ms || 0), fn, a, every: 0 }); return i;
  };
  window.setInterval = (fn, ms = 0, ...a) => {
    if (typeof fn !== "function") return 0;
    const e = Math.max(1, +ms || 0);
    const i = ++tid; timers.set(i, { t: virt + e, fn, a, every: e }); return i;
  };
  window.clearTimeout = window.clearInterval = (i) => { timers.delete(i); };
  const correrTemporizadores = () => {
    const vencidos = [...timers.entries()].filter(([, v]) => v.t <= virt).sort((a, b) => a[1].t - b[1].t);
    for (const [i, v] of vencidos) {
      if (!timers.has(i)) continue;
      if (v.every) v.t += v.every; else timers.delete(i);
      try { v.fn(...v.a); } catch (e) { errores.push(String((e && e.stack) || e)); }
    }
  };
  window.__clip = {
    FPS,
    errores,
    real,
    virt: () => virt,
    paso(n = 1) {
      for (let k = 0; k < n; k++) {
        virt += STEP;
        correrTemporizadores();
        const lote = [...raf.values()]; raf.clear();
        for (const cb of lote) { try { cb(virt); } catch (e) { errores.push(String((e && e.stack) || e)); } }
      }
    },
  };
})();
