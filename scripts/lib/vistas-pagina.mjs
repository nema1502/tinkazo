/**
 * Las partes de `scripts/capturar-vistas.mjs` que hablan con la página pero se pueden
 * probar sin navegador: cada una recibe lo que necesita (el clic, la espera, el reloj)
 * y el guion le pasa lo de verdad. Siguen siendo solo datos: nada de lo que llega de
 * la lista se evalúa como código.
 */

/** El clic con reintento: cuánto espera a que pase lo esperado tras cada clic y cuánto insiste en total. */
export const CLIC_HASTA = { esperaMs: 1000, topeMs: 20_000 };

/**
 * Hace clic en `selector` y espera hasta un segundo a que se vea `hasta`. Si no se ve, vuelve a
 * hacer clic, hasta que pasen 20 s. Sirve cuando la página todavía no estaba lista y el clic no
 * hizo nada. Es para botones que abren algo y no alternan: con uno que alterna, un clic que
 * tardó en notarse se cancelaría con el siguiente. Devuelve cuántos clics hicieron falta.
 *
 * `deps`: `clic(page, selector)`, `estaVisible(page, selector, ms)` (verdadero o falso, sin
 * lanzar), `ahora()` en milisegundos y, si hace falta, `revisar()`, que lanza si la página
 * ya falló por otro motivo y no vale la pena seguir insistiendo.
 */
export async function clicHasta(page, paso, deps) {
  const { clic, estaVisible, ahora, revisar } = deps;
  const inicio = ahora();
  let intentos = 0;
  for (;;) {
    revisar?.();
    intentos++;
    await clic(page, paso.selector);
    if (await estaVisible(page, paso.hasta, CLIC_HASTA.esperaMs)) return intentos;
    if (ahora() - inicio >= CLIC_HASTA.topeMs) {
      throw new Error(`hice clic ${intentos} veces en ${paso.selector} y en ${Math.round(CLIC_HASTA.topeMs / 1000)} s no apareció ${paso.hasta}`);
    }
  }
}

/** Lo que se guarda de una vista que falló: cuánto texto y cuánto esperar a la página. */
export const FALLO = { textoMax: 300, esperaMs: 15_000 };

/** Espera una promesa hasta `ms`: si tarda más, falla (y no deja el temporizador vivo). */
function conTope(promesa, ms) {
  let t;
  const corte = new Promise((_, rechazar) => {
    t = setTimeout(() => rechazar(new Error(`no contestó en ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promesa, corte]).finally(() => clearTimeout(t));
}

/**
 * Qué había en pantalla cuando una vista falló: la foto (`fotografiar(archivo)`), la dirección en ese
 * momento y los primeros 300 caracteres del texto visible. Cada cosa tiene su propio intento y su
 * propio tope de tiempo: si una falla queda en null y las demás se guardan igual. Nunca lanza, para
 * que un error acá no tape el error de la vista.
 */
export async function evidenciaDelFallo(page, fotografiar, archivo, ms = FALLO.esperaMs) {
  const r = { archivoDelFallo: null, direccionEnElFallo: null, textoVisible: null };
  try {
    await conTope(Promise.resolve().then(() => fotografiar(archivo)), ms);
    r.archivoDelFallo = archivo;
  } catch {
    /* la foto no salió: se anota sin ella */
  }
  try {
    r.direccionEnElFallo = String(await conTope(page.eval("location.href"), ms));
  } catch {
    /* sin dirección */
  }
  try {
    const texto = await conTope(page.eval("(document.body ? document.body.innerText : '')"), ms);
    r.textoVisible = String(texto).replace(/\s+/g, " ").trim().slice(0, FALLO.textoMax);
  } catch {
    /* sin texto */
  }
  return r;
}

/** Desplazar: cuánto espera a que el elemento se dibuje antes de rendirse. */
export const DESPLAZAR = { esperaMs: 10_000 };

/**
 * Lleva `selector` al centro de la pantalla, pero solo si de verdad se dibuja: un elemento que está en la
 * página con `display: none` (como la caja del resultado antes de que haya resultado) no se puede desplazar,
 * y hacerlo sin avisar daba una foto equivocada. `esperarVisible(page, selector, ms)` lanza si no se ve a tiempo.
 */
export async function desplazar(page, selector, esperarVisible) {
  await esperarVisible(page, selector, DESPLAZAR.esperaMs);
  await page.eval(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
}

/** Antes de la foto: cuánto se espera a las imágenes, cuántas pantallas se recorren y cada cuánto. */
export const IMAGENES = { esperaMs: 10_000, pantallasMax: 90, pasoMs: 120 };

/**
 * El guion que corre en la página antes de la foto. Con la página entera la recorre de a una pantalla (las
 * imágenes diferidas solo se piden al acercarse) y vuelve arriba. Después espera, hasta `esperaMs`, a que todas
 * las imágenes que se dibujan estén completas (las de toda la página, o las de la pantalla si la foto es de una
 * sola) y a las tipografías, y devuelve cuántas había y cuántas quedaron sin completar. Las que no se dibujan
 * (escondidas por el tema, por ejemplo) no se esperan: el navegador no las pide nunca.
 */
export function guionDeImagenes(entera, { esperaMs = IMAGENES.esperaMs, pasoMs = IMAGENES.pasoMs } = {}) {
  return `(async () => {
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  const entera = ${entera ? "true" : "false"};
  if (entera) {
    for (let i = 0; i < ${IMAGENES.pantallasMax}; i++) {
      window.scrollBy({ top: window.innerHeight, left: 0, behavior: 'instant' });
      await dormir(${Number(pasoMs)});
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) break;
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }
  const dibujadas = () => [...document.images].filter((i) => {
    if (!i.getClientRects().length) return false;
    if (entera) return true;
    const r = i.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
  });
  const fin = Date.now() + ${Number(esperaMs)};
  while (dibujadas().some((i) => !i.complete) && Date.now() < fin) await dormir(100);
  await Promise.race([document.fonts.ready, dormir(5000)]);
  const lista = dibujadas();
  return JSON.stringify({ imagenes: lista.length, sinCompletar: lista.filter((i) => !i.complete).length });
})()`;
}

/** Deja la página lista para la foto (ver `guionDeImagenes`). Devuelve `{ imagenes, sinCompletar }`. */
export async function prepararFoto(page, entera, opciones) {
  const d = JSON.parse(await page.eval(guionDeImagenes(entera, opciones)));
  return { imagenes: d.imagenes, sinCompletar: d.sinCompletar };
}

/**
 * El guion que se inyecta en cada documento de la pestaña para que no se abra una ventana nueva hacia otro
 * sitio. La pestaña principal ya no puede salir del sitio servido (el dominio Fetch, abajo), pero un enlace
 * con `target="_blank"` abre otra pestaña, que es otro objetivo del navegador y no pasa por ese corte. El
 * guion frena, en la fase de captura, el clic en un enlace http o https de otro origen que abre ventana nueva
 * (con el destino propio, el de la etiqueta base o uno con nombre), un `window.open` a otro origen y un
 * formulario que manda a otro origen en ventana nueva, y avisa con la función `tinkazoFuera` (sin consulta
 * ni fragmento). Es código fijo del guion: nada de lo que llega de la lista de vistas se mezcla en él, salvo
 * el origen servido, que entra como texto JSON.
 */
export function guionContraVentanasNuevas(origen) {
  return `(() => {
  const ORIGEN = ${JSON.stringify(origen)};
  const EN_ESTA = ['', '_self', '_top', '_parent'];
  const fuera = (dir) => {
    try {
      const u = new URL(dir, document.baseURI);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.origin === ORIGEN ? null : u.origin + u.pathname;
    } catch (e) {
      return null;
    }
  };
  const avisar = (anotada) => {
    try {
      if (typeof window.tinkazoFuera === 'function') window.tinkazoFuera(anotada);
    } catch (e) {}
  };
  const texto = (x) => String((x && typeof x === 'object' && 'baseVal' in x ? x.baseVal : x) || '');
  const deLaBase = () => {
    const b = document.querySelector('base[target]');
    return b ? String(b.target || '') : '';
  };
  window.addEventListener('click', (ev) => {
    const a = ev.target && typeof ev.target.closest === 'function' ? ev.target.closest('a[href], area[href]') : null;
    if (!a) return;
    if (EN_ESTA.includes(texto(a.target) || deLaBase())) return;
    const anotada = fuera(texto(a.href));
    if (!anotada) return;
    ev.preventDefault();
    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
    avisar(anotada);
  }, true);
  window.addEventListener('submit', (ev) => {
    const f = ev.target;
    if (!f || typeof f.getAttribute !== 'function') return;
    const s = ev.submitter;
    const destino = (s && s.formTarget) || texto(f.target) || deLaBase();
    if (EN_ESTA.includes(destino)) return;
    const accion = (s && s.getAttribute && s.getAttribute('formaction')) || f.getAttribute('action') || '';
    const anotada = fuera(accion);
    if (!anotada) return;
    ev.preventDefault();
    avisar(anotada);
  }, true);
  const abrir = window.open;
  window.open = function (...args) {
    const dir = args[0];
    const anotada = dir === undefined || dir === null || dir === '' ? null : fuera(String(dir));
    if (anotada) {
      avisar(anotada);
      return null;
    }
    return abrir.apply(this, args);
  };
})()`;
}

/**
 * Que la pestaña no salga del sitio servido. Un clic en un enlace externo hacía que la máquina visitara
 * ese sitio antes de que el guion lo notara. Con el dominio Fetch del protocolo se pausan solo las
 * navegaciones de documentos (no las imágenes, las fuentes ni los pedidos de datos del sitio a terceros,
 * como la ronda pública de drand): la del marco principal que va a otro origen se cancela, y las demás
 * siguen. Cancelada con "Aborted", la pestaña se queda en la página donde estaba, y la foto del fallo
 * la muestra. Devuelve `fuera`, las direcciones cortadas (sin consulta ni fragmento, que pueden traer
 * claves), y `revisar()`, que lanza con un mensaje claro si hubo alguna.
 */
export async function cortarFueraDelOrigen(page, base) {
  const origen = new URL(base).origin;
  const fuera = [];
  const { frameTree } = await page.send("Page.getFrameTree");
  const principal = frameTree.frame.id;
  page.ws.addEventListener("message", (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    // Una ventana nueva hacia otro sitio, frenada por el guion de cada documento (ver `guionContraVentanasNuevas`).
    if (m.method === "Runtime.bindingCalled" && m.params?.name === "tinkazoFuera") {
      fuera.push(String(m.params.payload).slice(0, 300));
      return;
    }
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request, frameId, resourceType } = m.params;
    let corta = false;
    let anotada = "";
    if (resourceType === "Document" && frameId === principal) {
      try {
        const u = new URL(request.url);
        corta = u.origin !== origen;
        anotada = `${u.origin}${u.pathname}`;
      } catch {
        corta = true;
        anotada = "una dirección que no se entiende";
      }
    }
    // Un pedido pausado que no se contesta deja la página colgada: se contesta siempre, aunque la conexión ya se haya cerrado.
    const contestar = (metodo, params) => {
      try {
        page.send(metodo, params).catch(() => undefined);
      } catch {
        /* la conexión se cerró */
      }
    };
    if (corta) {
      fuera.push(anotada);
      contestar("Fetch.failRequest", { requestId, errorReason: "Aborted" });
    } else {
      contestar("Fetch.continueRequest", { requestId });
    }
  });
  await page.send("Fetch.enable", { patterns: [{ resourceType: "Document", requestStage: "Request" }] });
  // Las ventanas nuevas (target="_blank", window.open) son otro objetivo del navegador y el corte de arriba no las ve:
  // el guion las frena antes de que se abran y avisa por el binding (que se pide antes, para que el guion lo encuentre).
  await page.send("Runtime.addBinding", { name: "tinkazoFuera" });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: guionContraVentanasNuevas(origen) });
  return {
    fuera,
    revisar() {
      if (fuera.length) throw new Error(`la página quiso ir a otro sitio y se cortó: ${fuera.slice(0, 3).join(", ")}`);
    },
  };
}
