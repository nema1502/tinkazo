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
    if (corta) {
      fuera.push(anotada);
      page.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => undefined);
    } else {
      page.send("Fetch.continueRequest", { requestId }).catch(() => undefined);
    }
  });
  await page.send("Fetch.enable", { patterns: [{ resourceType: "Document", requestStage: "Request" }] });
  return {
    fuera,
    revisar() {
      if (fuera.length) throw new Error(`la página quiso ir a otro sitio y se cortó: ${fuera.slice(0, 3).join(", ")}`);
    },
  };
}
