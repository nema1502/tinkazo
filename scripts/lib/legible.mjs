/**
 * Lo que `scripts/audit-legible.mjs` necesita y se puede probar sin Chrome: la
 * regla de tamaños, cómo se juzga una medida y el código que corre adentro de
 * la página (se escribe como funciones de verdad y se manda con `toString()`,
 * así `legible.test.mjs` lo ejecuta contra una página de mentira).
 *
 * La regla (la de la tarea del barrido de letra, 25 de octubre de 2026), en
 * píxeles CSS de la pantalla:
 *
 *   proyector 1920×1080: 28 px lo secundario, 48 px lo principal
 *   celular    390×844:  16 px lo secundario, 22 px lo principal
 *
 * Principal es lo que se lee primero: los títulos, el botón de la acción, el
 * nombre del ganador y el cartel del estadio. Todo lo demás es secundario.
 */

export const REGLAS = {
  proyector: { nombre: "proyector", ancho: 1920, alto: 1080, celular: false, secundario: 28, principal: 48 },
  celular: { nombre: "celular", ancho: 390, alto: 844, celular: true, secundario: 16, principal: 22 },
};

/** `proyector=28:48,celular=16:22`: otra regla, sin tocar el código. */
export function reglasDe(texto = "") {
  const r = { proyector: { ...REGLAS.proyector }, celular: { ...REGLAS.celular } };
  for (const par of texto.split(",").filter(Boolean)) {
    const m = /^(proyector|celular)=(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(par.trim());
    if (!m) throw new Error(`regla mal escrita: «${par}» (se espera proyector=28:48 o celular=16:22)`);
    r[m[1]].secundario = Number(m[2]);
    r[m[1]].principal = Number(m[3]);
  }
  return r;
}

export const minimoPara = (tamano, principal) => (principal ? tamano.principal : tamano.secundario);

const mediana = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : NaN;
};

/**
 * Los textos del DOM contra la regla. Los que comparten selector, tamaño y
 * rol se juntan en una sola falla (el pie de página son cuarenta enlaces con
 * el mismo estilo: se arregla una vez), y la falla cuenta cuántos son.
 * Devuelve `{ medidos, grupos }`, cada grupo con su primer texto (`caja`) para la captura.
 */
export function evaluarDom(textos, tamano) {
  const vistos = new Map();
  for (const t of textos) {
    const k = `${t.ruta}|${t.texto}`;
    const previo = vistos.get(k);
    if (!previo || t.px > previo.px) vistos.set(k, t);
  }
  const unicos = [...vistos.values()];
  const grupos = new Map();
  for (const t of unicos) {
    const minimo = minimoPara(tamano, t.principal);
    if (t.px >= minimo - 0.01) continue;
    const k = `${t.ruta}|${t.px.toFixed(1)}|${t.principal ? "p" : "s"}`;
    const g = grupos.get(k) ?? { ruta: t.ruta, px: t.px, minimo, principal: !!t.principal, textos: [], caja: { x: t.x, y: t.y, w: t.w, h: t.h } };
    g.textos.push(t.texto);
    grupos.set(k, g);
  }
  return { medidos: unicos.length, grupos: [...grupos.values()].sort((a, b) => a.px / a.minimo - b.px / b.minimo) };
}

/**
 * Los textos que dibuja Pixi contra la regla: los que se vieron en al menos dos
 * muestras y cuya mediana (el tamaño que tuvieron la mayor parte del tiempo,
 * sin el instante de entrar o salir) queda debajo del mínimo de su capa. El
 * cartel del ganador es lo principal; nombres, marcador y escena, lo secundario.
 */
export function evaluarEstadio(textos, tamano) {
  const malos = [];
  let medidos = 0;
  for (const t of textos) {
    if (t.n < 2) continue;
    medidos++;
    const minimo = minimoPara(tamano, t.capa === "podio");
    if (t.mediana >= minimo - 0.01) continue;
    malos.push({ texto: t.s, capa: t.capa, mediana: t.mediana, max: t.max, n: t.n, minimo, caja: t.box, recorte: t.recorte ?? null });
  }
  malos.sort((a, b) => a.mediana / a.minimo - b.mediana / b.minimo);
  return { medidos, malos };
}

/**
 * Los textos del lienzo que quedaron bajo la regla, juntos por capa y por
 * tamaño: veinte nombres con la misma etiqueta chica son una sola falla, que
 * se arregla en un solo lugar, y la falla dice cuántos son.
 */
export function agruparEstadio(malos) {
  const g = new Map();
  for (const m of malos) {
    const k = `${m.capa}|${Math.round(m.mediana)}`;
    const x = g.get(k) ?? { capa: m.capa, mediana: m.mediana, minimo: m.minimo, textos: [], max: m.max, recorte: null };
    x.textos.push(m.texto);
    x.max = Math.max(x.max, m.max);
    if (!x.recorte && m.recorte) x.recorte = m.recorte;
    g.set(k, x);
  }
  return [...g.values()].sort((a, b) => a.mediana / a.minimo - b.mediana / b.minimo);
}

/* ───────── lo que corre adentro de la página ───────── */

/**
 * Los textos visibles del DOM bajo una raíz (o de toda la página), con su
 * tamaño de letra en píxeles de pantalla (el de CSS por la escala con que se
 * dibuja) y su caja en coordenadas de la página.
 */
export function escanearDom(raizSel) {
  const raiz = raizSel ? document.querySelector(raizSel) : document.body;
  if (!raiz) return [];
  const PRINCIPAL = "h1, h2, .winner-name, #btn-draw, #btn-freeze, #btn-again-sin, button.primary";
  const OCULTOS = "script, style, noscript, template, svg, canvas, [aria-hidden='true']";
  const ruta = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? `.${[...el.classList].slice(0, 2).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const visible = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.2) return false;
    }
    return true;
  };
  const salida = [];
  const cache = new Map();
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    const texto = (n.nodeValue || "").replace(/\s+/g, " ").trim();
    if (texto.length < 2) continue;
    const p = n.parentElement;
    if (!p || p.closest(OCULTOS)) continue;
    if (!cache.has(p)) cache.set(p, visible(p));
    if (!cache.get(p)) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    const rect = r.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const caja = p.getBoundingClientRect();
    const escala = p.offsetWidth > 0 && caja.width > 0 ? caja.width / p.offsetWidth : 1;
    const px = parseFloat(getComputedStyle(p).fontSize) * (escala > 0.05 && escala < 20 ? escala : 1);
    salida.push({
      texto: texto.slice(0, 60),
      px: Math.round(px * 100) / 100,
      ruta: ruta(p),
      principal: !!p.closest(PRINCIPAL),
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height,
    });
  }
  return salida;
}

/** En qué paso del sorteo está la página (los botones son los de `audit-flujo`). */
export function estadoDelSorteo() {
  const visible = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    const cs = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
  };
  const draw = document.getElementById("btn-draw");
  return {
    lista: visible("#btn-freeze"),
    esperando: visible("#btn-draw") && !!draw && !!draw.disabled,
    ronda: visible("#btn-draw") && !!draw && !draw.disabled,
    resultado: document.querySelectorAll(".winner-name").length > 0,
  };
}

/**
 * El muestreador del estadio: cada cierto número de cuadros mira los textos
 * que dibuja Pixi (se llega a ellos por `window.__app`, el gancho que Pixi
 * llama al arrancar), anota su tamaño en pantalla y, de los que quedan chicos,
 * se guarda un recorte del lienzo para la captura. Es el mismo cálculo que
 * `audit-pantalla.mjs` (tamaño de letra por la escala de la transformación
 * del mundo), pero guarda cada texto y no solo el más chico del cuadro.
 */
export function instalarMuestreador(config) {
  const L = { textos: new Map(), muestras: 0, vio: false, fin: false, errores: [], recortes: 0 };
  window.__legible = L;
  const CAPAS = ["fondo", "escena", "hud", "nombres", "podio"];
  const minimo = (capa) => (capa === "podio" ? config.principal : config.secundario);
  const recortar = (b) => {
    const cv = document.getElementById("pixi-canvas");
    if (!cv || !cv.width || !window.innerWidth) return null;
    const k = cv.width / window.innerWidth;
    const x0 = Math.max(0, b.x - 16);
    const y0 = Math.max(0, b.y - 16);
    const w = Math.min(window.innerWidth - x0, b.width + 32);
    const h = Math.min(window.innerHeight - y0, b.height + 32);
    if (w < 4 || h < 4 || w * h > 640 * 360) return null;
    const c2 = document.createElement("canvas");
    c2.width = Math.ceil(w * k);
    c2.height = Math.ceil(h * k);
    c2.getContext("2d").drawImage(cv, x0 * k, y0 * k, w * k, h * k, 0, 0, c2.width, c2.height);
    return c2.toDataURL("image/png");
  };
  const registrar = (s, capa, px, nodo) => {
    const k = `${capa}|${s.slice(0, 40)}`;
    let r = L.textos.get(k);
    if (!r) {
      r = { s: s.slice(0, 40), capa, px: [], max: 0, box: null, recorte: null, pxRecorte: 0, veces: 0 };
      L.textos.set(k, r);
    }
    if (r.px.length < 400) r.px.push(px);
    const b = nodo.getBounds();
    if (px > r.max) {
      r.max = px;
      r.box = [b.x, b.y, b.width, b.height];
    }
    if (px < minimo(capa) && r.veces < 3 && (r.recorte === null ? L.recortes < 8 : px > r.pxRecorte)) {
      try {
        const rec = recortar(b);
        if (rec) {
          if (r.recorte === null) L.recortes++;
          r.recorte = rec;
          r.pxRecorte = px;
          r.veces++;
        }
      } catch (e) {
        L.errores.push(String(e));
      }
    }
  };
  const visitar = (nodo, capa, alfaPadre) => {
    if (!nodo.visible || !nodo.renderable) return;
    const a = alfaPadre * nodo.alpha;
    // Lo que entra o sale, apenas visible, no cuenta.
    if (a < 0.5) return;
    if (typeof nodo.text === "string" && nodo.style) {
      const s = nodo.text.trim();
      if (s.length >= 2) {
        const wt = nodo.worldTransform;
        const px = (parseFloat(nodo.style.fontSize) || 0) * (Math.hypot(wt.a, wt.b) || 1);
        if (px > 0) registrar(s, capa, px, nodo);
      }
    }
    for (const h of nodo.children || []) visitar(h, capa, a);
  };
  L.muestrear = () => {
    const est = document.getElementById("stadium");
    const abierto = !!est && getComputedStyle(est).display === "block";
    if (abierto) L.vio = true;
    else if (L.vio) L.fin = true;
    const app = window.__app;
    if (!abierto || !app || !app.stage) return;
    L.muestras++;
    app.stage.children.forEach((raiz, i) => visitar(raiz, CAPAS[i] || "otra", 1));
  };
  L.resumen = () =>
    [...L.textos.values()].map((r) => {
      const v = [...r.px].sort((x, y) => x - y);
      return { s: r.s, capa: r.capa, n: v.length, mediana: v[v.length >> 1], max: r.max, min: v[0], box: r.box, recorte: r.recorte };
    });
}

/**
 * Lo que se inyecta antes de que cargue la página del estadio: el reloj en
 * turbo de `audit-emocion.mjs` (veinte cuadros de juego por cuadro real, de a
 * 1/64 s, así que la animación es la misma que a velocidad normal), el gancho
 * de Pixi y el muestreador, que mira cada `cada` cuadros.
 */
export function preludioEstadio({ cada = 16, principal, secundario }) {
  return `(() => {
  const RAF = window.requestAnimationFrame.bind(window);
  let virt = 0, id = 0, cuadro = 0;
  const cbs = new Map();
  window.__app = null;
  window.__PIXI_APP_INIT__ = (app) => { window.__app = app; };
  window.requestAnimationFrame = (cb) => { cbs.set(++id, cb); return id; };
  window.cancelAnimationFrame = (x) => { cbs.delete(x); };
  performance.now = () => virt;
  (${instalarMuestreador.toString()})(${JSON.stringify({ principal, secundario })});
  const bombear = () => {
    // Al menos un cuadro por cuadro real, aunque el juego ya no pida ninguno: así
    // el muestreador se entera de que el estadio se cerró.
    for (let i = 0; i < 20; i++) {
      const lote = [...cbs.values()];
      cbs.clear();
      virt += 1000 / 64;
      cuadro++;
      for (const cb of lote) { try { cb(virt); } catch (e) {} }
      if (cuadro % ${cada} === 0) { try { window.__legible.muestrear(); } catch (e) { window.__legible.errores.push(String(e)); } }
      if (!cbs.size) break;
    }
    RAF(bombear);
  };
  RAF(bombear);
})()`;
}

/** Una expresión para evaluar una función de arriba en la página. */
export const llamar = (fn, ...argumentos) => `JSON.stringify((${fn.toString()})(${argumentos.map((a) => JSON.stringify(a)).join(", ")}))`;

/** La mediana de una lista, para quien la necesite fuera de la página. */
export { mediana };

/** Un nombre de archivo seguro para una captura. */
export const archivoDe = (...partes) =>
  `${partes
    .join("-")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 90)}.png`;
