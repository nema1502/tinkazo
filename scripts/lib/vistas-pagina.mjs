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
 * ya falló por otro motivo y no vale la pena seguir insistiendo. Si el elemento está apagado o tapado (`ClicNoPosible`),
 * no cuenta como un clic: se vuelve a probar hasta el tope y el error nombra el motivo.
 */
export async function clicHasta(page, paso, deps) {
  const { clic, estaVisible, ahora, revisar } = deps;
  const inicio = ahora();
  let intentos = 0;
  let sinPoder = "";
  for (;;) {
    revisar?.();
    intentos++;
    try {
      await clic(page, paso.selector);
      sinPoder = "";
    } catch (e) {
      // Apagado o tapado ahora: puede ser que la página todavía no esté lista. Se espera y se vuelve a probar.
      if (!(e instanceof ClicNoPosible)) throw e;
      sinPoder = e.message;
    }
    if (await estaVisible(page, paso.hasta, CLIC_HASTA.esperaMs)) return intentos;
    if (ahora() - inicio >= CLIC_HASTA.topeMs) {
      const segundos = Math.round(CLIC_HASTA.topeMs / 1000);
      throw new Error(sinPoder ? `${sinPoder} y en ${segundos} s no se pudo hacer clic para que apareciera ${paso.hasta}` : `hice clic ${intentos} veces en ${paso.selector} y en ${segundos} s no apareció ${paso.hasta}`);
    }
  }
}

/** Lo que se guarda de una vista que falló: cuánto texto y cuánto esperar a la página. */
export const FALLO = { textoMax: 300, esperaMs: 15_000 };

/** Espera una promesa hasta `ms`: si tarda más, falla (y no deja el temporizador vivo). */
export function conTope(promesa, ms) {
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

/** Un clic que ahora no se puede hacer: el elemento está apagado, tapado o fuera de la pantalla. `clicHasta` lo reintenta. */
export class ClicNoPosible extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = "ClicNoPosible";
  }
}

/**
 * Corre DENTRO de la página (se manda como texto, por eso no puede usar nada de afuera). Lleva el elemento a la
 * vista y dice dónde hacer el clic, o por qué no se puede: apagado (`disabled` o `aria-disabled`), fuera de la
 * pantalla o tapado por otro elemento. El punto es el centro de lo que se ve del elemento.
 */
export function puntoDelClic(selector) {
  const e = document.querySelector(selector);
  if (!e) return { error: `${selector} no está en la página` };
  e.scrollIntoView({ block: "center", behavior: "instant" });
  if (e.disabled === true || e.matches(":disabled")) return { error: `${selector} está apagado (disabled)` };
  if (e.closest('[aria-disabled="true"]')) return { error: `${selector} está apagado (aria-disabled)` };
  const r = e.getBoundingClientRect();
  const izquierda = Math.max(r.left, 0);
  const derecha = Math.min(r.right, window.innerWidth);
  const arriba = Math.max(r.top, 0);
  const abajo = Math.min(r.bottom, window.innerHeight);
  if (derecha <= izquierda || abajo <= arriba) return { error: `${selector} no queda a la vista` };
  const x = (izquierda + derecha) / 2;
  const y = (arriba + abajo) / 2;
  const encima = document.elementFromPoint(x, y);
  if (!encima) return { error: `${selector}: en el punto del clic (${Math.round(x)}, ${Math.round(y)}) no hay nada, queda fuera de la pantalla` };
  if (encima !== e && !e.contains(encima)) {
    const clase = typeof encima.className === "string" ? encima.className.trim().split(/\s+/)[0] : "";
    const nombre = `${encima.tagName.toLowerCase()}${encima.id ? `#${encima.id}` : ""}${clase ? `.${clase}` : ""}`;
    const texto = (encima.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return { error: `${selector} está tapado en el punto del clic (${Math.round(x)}, ${Math.round(y)}) por ${nombre}${texto ? ` con el texto "${texto}"` : ""}` };
  }
  return { x, y };
}

/** Pide a la página el punto del clic de `selector` (ver `puntoDelClic`). Lanza `ClicNoPosible` si no se puede. */
export async function puntoDelClicEn(page, selector) {
  const r = JSON.parse(await page.eval(`JSON.stringify((${puntoDelClic.toString()})(${JSON.stringify(selector)}))`));
  if (r.error) throw new ClicNoPosible(r.error);
  return { x: r.x, y: r.y };
}

/**
 * Corre DENTRO de la página: lo que ella dice de sí misma al terminar los pasos. La dirección, el idioma de la
 * etiqueta html (solo la base: "es-BO" es "es"), el tema (el forzado por la página o, sin él, el del sistema),
 * el ancho del contenido y de la pantalla, y si hay contexto webgl2 y con qué placa dibuja.
 */
export function estadoDeLaPagina() {
  const raiz = document.documentElement;
  const forzado = raiz.dataset.theme;
  let tema = "light";
  if (forzado === "light" || forzado === "dark") tema = forzado;
  else if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches) tema = "dark";
  let webgl2 = false;
  let renderizador = null;
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (gl) {
      webgl2 = true;
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      if (info) renderizador = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
      const perder = gl.getExtension("WEBGL_lose_context");
      if (perder) perder.loseContext();
    }
  } catch (e) {
    webgl2 = false;
    renderizador = null;
  }
  return { href: location.href, idioma: String(raiz.lang || "").toLowerCase().split("-")[0], tema, sw: raiz.scrollWidth, iw: window.innerWidth, webgl2, renderizador };
}

/** Si la página salió con el tema y el idioma que se pidieron. Devuelve el motivo si no. */
export function problemaDeTemaEIdioma(pedido, leido) {
  if (pedido.tema && leido.tema !== pedido.tema) return `se pidió el tema ${pedido.tema} y la página salió con el tema ${leido.tema || "desconocido"}`;
  if (pedido.idioma && leido.idioma !== pedido.idioma) return `se pidió el idioma ${pedido.idioma} y la página salió en ${leido.idioma || "ningún idioma"}`;
  return "";
}

const PLACA_POR_SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software/i;

/** Con qué se dibujó la página: si hay webgl2 y si la placa es de software (la foto de un juego sale distinta que con placa de video). */
export function describirGraficos({ webgl2, renderizador }) {
  const placa = renderizador ? String(renderizador) : null;
  return { webgl2: Boolean(webgl2), renderizador: placa, porSoftware: webgl2 && placa ? PLACA_POR_SOFTWARE.test(placa) : null };
}

/** Un solo texto sin consulta ni fragmento (que pueden traer claves), para anotar una dirección. */
function sinConsulta(direccion) {
  try {
    const u = new URL(direccion);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(direccion).slice(0, 300);
  }
}

const CAMINO_DE_LA_PORTADA = "/index.html";
const normalizarCamino = (c) => (c === CAMINO_DE_LA_PORTADA ? "/" : c);
const ORIGEN_FALSO = "http://sitio.invalid";

/**
 * Comprueba, antes de navegar, que la ruta pedida es una página que de verdad existe en el sitio servido. El
 * servidor de vista previa contesta la portada con 200 a cualquier camino que no es un archivo (una ruta mal
 * escrita como /seguridad en vez de /seguridad.html), y una captura de la portada con el nombre de otra página es
 * peor que un error. Pide el camino (sin la consulta ni el fragmento) y lo compara con la portada, que pide
 * una sola vez: si el texto es el mismo, es el respaldo. Devuelve el motivo, o "" si está bien o si no se pudo
 * saber (la navegación lo dirá).
 */
export function crearComprobadorDeRutas(base, buscar = fetch) {
  const raiz = String(base).replace(/\/+$/, "");
  const leer = async (camino) => {
    const r = await buscar(`${raiz}${camino}`, { signal: AbortSignal.timeout(10_000) });
    const bien = r.status >= 200 && r.status < 300;
    return { estado: r.status, texto: bien ? await r.text() : "" };
  };
  let portada = null;
  return async (ruta) => {
    const camino = new URL(ruta, ORIGEN_FALSO).pathname;
    if (normalizarCamino(camino) === "/") return "";
    try {
      const pagina = await leer(camino);
      if (!(pagina.estado >= 200 && pagina.estado < 300)) return `el servidor contestó ${pagina.estado} a ${camino}`;
      portada ??= leer("/");
      if (pagina.texto === (await portada).texto) return `${camino} no existe en el sitio servido: el servidor devolvió la portada`;
      return "";
    } catch {
      return "";
    }
  };
}

/**
 * Los documentos que cargó la pestaña principal, con su estado HTTP. Se anotan solo los del marco principal (no
 * las imágenes ni los marcos de adentro) y sin la consulta de la dirección.
 */
export async function vigilarDocumentos(page) {
  const { frameTree } = await page.send("Page.getFrameTree");
  const principal = frameTree.frame.id;
  const respuestas = [];
  page.ws.addEventListener("message", (ev) => {
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (m.method !== "Network.responseReceived") return;
    const { type, frameId, response } = m.params ?? {};
    if (type !== "Document" || frameId !== principal || !response) return;
    respuestas.push({ estado: Number(response.status), direccion: sinConsulta(response.url) });
  });
  await page.send("Network.enable");
  return { respuestas, ultimo: () => respuestas.at(-1) ?? null };
}

/**
 * Si lo que cargó la pestaña es lo que se pidió: todos los documentos con estado 2xx y, si se sabe el camino
 * cargado, que sea el pedido (la portada vale como / y como /index.html). Devuelve el motivo, o "" si está bien.
 */
export function problemaDelDocumento({ respuestas, caminoPedido, caminoCargado }) {
  if (!respuestas.length) return "no pude comprobar el estado de la página: el navegador no avisó de ningún documento cargado";
  const mala = respuestas.find((r) => !(r.estado >= 200 && r.estado < 300));
  if (mala) return `el servidor contestó ${mala.estado} a ${mala.direccion}`;
  if (caminoCargado !== undefined && normalizarCamino(caminoCargado) !== normalizarCamino(caminoPedido)) return `se pidió ${caminoPedido} y la página terminó en ${caminoCargado}`;
  return "";
}

/**
 * Corre `hacer(datos, vigente)` con un plazo. `datos` es donde el trabajo anota lo que va sabiendo, y `vigente()` dice
 * si el plazo sigue abierto. Si el plazo se acaba, el resultado es un error, `datos` queda como estaba en ese
 * momento (una copia) y todo lo que el trabajo escriba o haga después se ignora: una vista que se pasó no puede
 * terminar más tarde y quedar marcada como bien. Un error del trabajo que llega tarde se absorbe.
 */
export async function correrConPlazo(hacer, plazoMs, mensaje) {
  const estado = { vigente: true };
  const datos = {};
  const trabajo = Promise.resolve().then(() => hacer(datos, () => estado.vigente));
  let reloj;
  const corte = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(mensaje)), plazoMs);
  });
  try {
    await Promise.race([trabajo, corte]);
    return { ok: true, error: null, datos: { ...datos } };
  } catch (e) {
    return { ok: false, error: e, datos: { ...datos } };
  } finally {
    estado.vigente = false;
    clearTimeout(reloj);
    trabajo.catch(() => undefined);
  }
}

/**
 * Recorre las vistas en orden y deja SIEMPRE una fila por cada una, con `alTerminar(fila)` después de cada
 * una. `capturar(vista, plan)` devuelve su fila. Si lanza, o si la fila dice `navegadorCaido`, el navegador
 * ya no sirve y las que faltan quedan como no hechas con ese motivo. Lo mismo si el navegador ni arrancó
 * (`sinNavegador`) o si se acabó el tiempo total (`planear` dice que no se hace).
 */
export async function recorrerVistas({ vistas, capturar, sinHacer, planear, motivoDelTotal, ahora = Date.now, alTerminar = () => undefined, sinNavegador = "" }) {
  const inicio = ahora();
  let corte = sinNavegador ? `no se pudo abrir el navegador: ${sinNavegador}` : "";
  for (const v of vistas) {
    let fila;
    if (corte) fila = sinHacer(v, corte);
    else {
      const plan = planear(ahora() - inicio);
      if (!plan.hacer) fila = sinHacer(v, motivoDelTotal);
      else {
        try {
          fila = await capturar(v, plan);
        } catch (e) {
          fila = { nombre: v.nombre, ok: false, archivo: null, error: String(e?.message ?? e).slice(0, 400), navegadorCaido: true };
        }
        if (fila.navegadorCaido) corte = `el navegador dejó de contestar en la vista ${v.nombre} (${fila.error})`;
      }
    }
    alTerminar(fila);
  }
}
