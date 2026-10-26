/**
 * La letra mínima del flujo y del estadio (docs/ux.md, "La letra grande").
 *
 * `sondaTexto()` devuelve el código que corre DENTRO de la página y lista cada
 * texto que se ve (con su tamaño calculado en píxeles) para compararlo con un
 * umbral. Lo usan `audit-ui.mjs` (que no vuelva a pasar) y `medir-texto.mjs`
 * (el inventario de la letra pequeña).
 *
 * Qué cuenta como "se ve": el elemento tiene caja, no está escondido, tiene
 * opacidad, no es solo para lectores de pantalla (`.sr-only`, 1 px) y no está
 * dentro de algo inerte. Un texto se mide por el elemento que lo contiene.
 */

/** Los umbrales, en píxeles. Los explica docs/ux.md. */
export const UMBRALES = {
  /** Lo que lee quien organiza, en la página: escritorio y celular por igual. */
  flujo: 16,
  /** Rótulos, el indicador de pasos y lo de la cuenta (`EXCEPCIONES`): un poco menos, y nunca debajo de esto. */
  excepcion: 13,
  /** Lo que se proyecta, como parte del alto de la pantalla (en 1080: 32 px el subtítulo y 22 px los botones). */
  estadio: { subtitulo: 0.03, botones: 0.02 },
};

/**
 * Elementos del flujo que pueden bajar de `flujo` sin ser un defecto: sus
 * selectores (se prueban con `closest`). Cada uno tiene su razón en docs/ux.md.
 */
export const EXCEPCIONES = [
  // Rótulos (mayúsculas con letra de máquina): acompañan a un control o a un título.
  "label",
  ".kicker",
  ".sticker",
  ".langs",
  ".lore-src",
  // El indicador de pasos es un mapa, no el mensaje: la acción grande es la del paso.
  "#pasos",
  // Lo de la cabecera que dice quién está adentro y en qué red.
  ".auth",
  ".netbadge",
  // El pie de la portada: el enlace legal vive ahí.
  "footer",
];

/**
 * Código para `Runtime.evaluate`: lista los textos visibles por debajo de `min`
 * píxeles, excepto los que cuadran con `excepciones`. `solo` limita a un
 * contenedor (selector). Devuelve un JSON.
 */
export function sondaTexto({ min = UMBRALES.flujo, minExcepcion = UMBRALES.excepcion, excepciones = EXCEPCIONES, solo = "body", sinTocar = [] } = {}) {
  return `JSON.stringify((() => {
    const min = ${JSON.stringify(min)};
    const minExc = ${JSON.stringify(minExcepcion)};
    const exc = ${JSON.stringify(excepciones)};
    const fuera = ${JSON.stringify(sinTocar)};
    const raiz = document.querySelector(${JSON.stringify(solo)});
    if (!raiz) return { error: 'no hay ' + ${JSON.stringify(solo)} };
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    const vistos = new Map();
    const camino = (el) => {
      const partes = [];
      for (let e = el; e && e !== document.body && partes.length < 3; e = e.parentElement) {
        partes.unshift(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''));
      }
      return partes.join(' > ');
    };
    let total = 0;
    while (w.nextNode()) {
      const n = w.currentNode;
      const s = n.textContent.replace(/\\s+/g, ' ').trim();
      if (!s) continue;
      const el = n.parentElement;
      if (!el || el.closest('script,style,svg,noscript,[inert],[hidden],.sr-only')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
      // Ningún ancestro escondido ni transparente.
      let oculto = false;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const c = getComputedStyle(e);
        if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) { oculto = true; break; }
      }
      if (oculto) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const r = rg.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      total++;
      const px = parseFloat(cs.fontSize);
      if (px >= min - 0.01) continue;
      if (px >= minExc - 0.01 && exc.some((sel) => el.closest(sel))) continue;
      if (fuera.some((sel) => el.closest(sel))) continue;
      const k = camino(el) + ' @ ' + px;
      const v = vistos.get(k);
      if (v) v.veces++;
      else vistos.set(k, { donde: camino(el), px, texto: s.slice(0, 60), veces: 1 });
    }
    return { total, chicos: [...vistos.values()].sort((a, b) => a.px - b.px) };
  })())`;
}
