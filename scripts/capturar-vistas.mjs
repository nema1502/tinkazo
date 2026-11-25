#!/usr/bin/env node
/**
 * Capturas de una lista de vistas del sitio servido.
 *
 * NUNCA se capturan vistas con datos de personas reales (una lista de invitados, una campaña de verdad):
 * el artefacto que sube el flujo de GitHub, en un repositorio público, lo puede bajar cualquiera. Solo la
 * demostración y las páginas públicas.
 *
 * Abre cada vista en Chrome (por el protocolo de DevTools, con `scripts/lib/browser.mjs`),
 * corre sus pasos, espera lo que haga falta y saca un PNG. La lista es solo datos: no
 * hay forma de pasarle JavaScript para que corra en la página. Se valida entera antes de
 * abrir nada (`scripts/lib/vistas.mjs`).
 *
 * Uso: primero se construye el sitio, que es lo que se sirve.
 *   pnpm build
 *   pnpm preview --port 4173 &
 *   VISTAS_JSON='[{"nombre":"portada","ruta":"/"}]' node scripts/capturar-vistas.mjs --base http://localhost:4173 --out capturas
 *   node scripts/capturar-vistas.mjs --vistas vistas.json --base http://localhost:4173 --out capturas
 *
 * Con `--validar` solo revisa la lista (y, si vienen, las variables ENTORNO y la rama RAMA)
 * y sale: es lo que corre el trabajo de GitHub antes de construir nada. Con
 * `--entorno-en <archivo>` además agrega al archivo una línea NOMBRE=valor por cada
 * variable de ENTORNO (el trabajo le pasa `$GITHUB_ENV`).
 *
 * Deja `<out>/<nombre>.png` por vista y `<out>/informe.json` con UNA fila por cada vista pedida (las que no se
 * pudieron hacer, también): si salió, el error si no, la dirección final, el estado HTTP del documento, el idioma
 * y el tema que la página tenía de verdad, si tuvo gráficos acelerados (`graficos`: contexto webgl2, placa y si
 * dibuja por software, para leer con cuidado la captura de un juego), si tiene scroll horizontal (scrollWidth
 * contra innerWidth) y los errores de consola. De una vista que falla deja además `<nombre>-FALLO.png`
 * (lo que había en pantalla) y, en el informe, `archivoDelFallo`, `direccionEnElFallo` y los primeros
 * 300 caracteres del texto visible (`textoVisible`): por eso ningún nombre puede terminar en -FALLO. Sale con 1 si alguna vista no se pudo capturar (lo
 * que sí salió queda escrito) y con 2 si la lista o los argumentos no valen.
 *
 * Una vista falla, con su foto, si el servidor no contesta 2xx, si la ruta no es una página del sitio (el servidor
 * de vista previa contesta la portada a un camino que no existe, como /seguridad sin .html), si la página no
 * terminó en el camino pedido, si un clic es a un elemento apagado o tapado por otro (el error nombra al que lo tapa),
 * o si se pidió un tema o un idioma y la página salió con otro. Una vista que se pasó de su plazo no puede
 * terminar después y quedar como bien. Si el navegador deja de contestar, la que falla queda con su error y las que
 * faltan quedan como no hechas, con ese motivo.
 *
 * El guion entero tiene un tope de 35 minutos (el trabajo de GitHub corta a los 40): lo que no
 * llegó a hacerse queda en el informe como `sinHacer`, con el motivo, y el código de salida es 1.
 *
 * Cada vista es un objeto:
 *   nombre        sale <nombre>.png (letras, números, punto, guion, guion bajo)
 *   ruta          camino y consulta, con / adelante: "/?demo=wheel&instant=1&lead=3"
 *   ancho, alto   la pantalla, de 280 a 2560 px (1440 por 900 si no se dice)
 *   tema          "light" o "dark" (suma ?theme=)
 *   idioma        "es" o "en" (suma ?lang=). Sin él, el navegador dice que habla español de Bolivia
 *   esperar       selector CSS que tiene que estar visible antes de capturar (hasta 30 s)
 *   pausaMs       cuánto esperar antes de la foto, de 0 a 60000 (500 si no se dice)
 *   paginaEntera  true para fotografiar la página completa y no solo la pantalla
 *   pasos         acciones en orden antes de la foto:
 *     {"accion":"clic","selector":"#btn-freeze"}
 *     {"accion":"clicHasta","selector":"#btn-espera","hasta":".espera-reloj"}   clic y, si en 1 s no aparece lo otro, otro clic (hasta 20 s)
 *     {"accion":"escribir","selector":"#ta","texto":"Ana\nBeto"}        reemplaza lo que haya
 *     {"accion":"nombres","selector":"#ta","cantidad":150}              N nombres inventados, uno por renglón
 *     {"accion":"esperar","selector":"#wait-box","ms":20000}            espera a que se vea
 *     {"accion":"pausa","ms":1500}
 *     {"accion":"tecla","tecla":"Enter"}                                Enter, Escape, Tab, Space, flechas, Home, End...
 *     {"accion":"desplazar","selector":"#winner-box"}                   lo lleva al centro; falla si no se dibuja en 10 s (esperalo antes)
 *
 * Antes de cada foto el guion espera las tipografías y las imágenes que se dibujan (con paginaEntera
 * recorre la página de a una pantalla para que carguen las diferidas y vuelve arriba). El informe dice
 * cuántas imágenes había (`imagenesEnLaFoto`) y cuántas quedaron sin completar (`imagenesSinCompletar`).
 *
 * La pestaña no sale del sitio servido: navegar a otro origen se corta, y un enlace externo que abre
 * ventana nueva (target="_blank", window.open, un formulario) se frena antes de abrirse. La vista falla
 * con el sitio al que quiso ir.
 *
 * Recetas (probadas contra el sitio servido, cada una es un objeto de la lista):
 *
 *   Portada en escritorio y en celular, en los dos temas:
 *     {"nombre":"portada-1440-claro","ruta":"/","ancho":1440,"alto":900,"tema":"light","esperar":"header"}
 *     {"nombre":"portada-390-oscuro","ruta":"/","ancho":390,"alto":844,"tema":"dark","esperar":"header"}
 *
 *   La vista de Sortear con una lista de 150 nombres (cambiá la cantidad por 2, 18, 300...):
 *     {"nombre":"sortear-150","ruta":"/?red=prueba#sortear","ancho":1280,"alto":900,"tema":"light",
 *      "pasos":[{"accion":"nombres","selector":"#ta","cantidad":150},{"accion":"esperar","selector":"#lista-cuenta"}]}
 *
 *   La espera en grande de un sorteo de demostración, con la cuenta en marcha (hay 45 s de espera y la
 *   foto sale a los 4 de abrirla). La capa de la espera solo se abre tocando su botón, y ese botón no
 *   hace nada hasta que el sello termina: por eso es clicHasta y no clic.
 *     {"nombre":"espera-demo","ruta":"/?demo=wheel&lead=45","ancho":1280,"alto":900,"tema":"dark","pausaMs":4000,
 *      "pasos":[{"accion":"esperar","selector":"#btn-espera"},{"accion":"clicHasta","selector":"#btn-espera","hasta":".espera-reloj"}]}
 *
 *   Lo mismo con 150 personas (?n= acepta de 2 a 2000):
 *     {"nombre":"espera-demo-150","ruta":"/?demo=wheel&lead=45&n=150","ancho":1280,"alto":900,"tema":"dark","pausaMs":4000,
 *      "pasos":[{"accion":"esperar","selector":"#btn-espera"},{"accion":"clicHasta","selector":"#btn-espera","hasta":".espera-reloj"}]}
 *
 *   El resultado de una demostración (sin animaciones, la ronda llega a los 3 s). La caja del resultado
 *   existe desde el principio pero no se dibuja hasta que hay ganador: primero se espera al nombre, después
 *   se deja que termine el desplazamiento suave que hace el propio sitio y recién entonces se desplaza.
 *     {"nombre":"resultado-demo","ruta":"/?demo=wheel&instant=1&lead=3","ancho":1280,"alto":900,"tema":"light","pausaMs":500,
 *      "pasos":[{"accion":"esperar","selector":".winner-name"},{"accion":"pausa","ms":1500},{"accion":"desplazar","selector":"#winner-box"}]}
 *
 *   Una página de lectura entera, en inglés y celular:
 *     {"nombre":"seguridad-en-390","ruta":"/seguridad.html","ancho":390,"alto":844,"idioma":"en","paginaEntera":true,"esperar":"main"}
 *
 * Una lista propia con muchos nombres no llega a la espera con pasos: sellarla pide una cuenta.
 * Para ver la espera o el show con muchas personas sirve la demostración con ?n=, como arriba, o la
 * escena fija: "/?pose=wheel&n=150".
 *
 * Para ver una vista que falle a propósito (espera 30 s el selector y deja prueba-con-error-FALLO.png):
 *     {"nombre":"prueba-con-error","ruta":"/","pausaMs":0,"esperar":"#no-existe"}
 */
import { mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { clicHasta, conTope, correrConPlazo, cortarFueraDelOrigen, crearComprobadorDeRutas, desplazar, describirGraficos, estadoDeLaPagina, evidenciaDelFallo, prepararFoto, problemaDeTemaEIdioma, problemaDelDocumento, puntoDelClicEn, recorrerVistas, vigilarDocumentos } from "./lib/vistas-pagina.mjs";
import { TECLAS, TOPES, direccionDeVista, generarNombres, leerEntorno, leerVistas, plazoDeLaVista, problemaDeBase, problemaDeOrigen, problemaDeRama } from "./lib/vistas.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};

function salirConErrores(titulo, errores) {
  console.error(`${titulo}:`);
  for (const e of errores) console.error(`  - ${e}`);
  process.exit(2);
}

/** La lista, de --vistas <archivo> o de la variable VISTAS_JSON. */
function textoDeVistas() {
  const archivo = opt("--vistas", "");
  if (archivo) {
    try {
      return readFileSync(archivo, "utf8");
    } catch (e) {
      salirConErrores("no pude leer el archivo de vistas", [`${archivo}: ${e.code ?? e.message}`]);
    }
  }
  return process.env.VISTAS_JSON ?? "";
}

const { vistas, errores } = leerVistas(textoDeVistas());
if (errores.length) salirConErrores("la lista de vistas no vale", errores);

if (args.includes("--validar")) {
  const rama = problemaDeRama(process.env.RAMA);
  if (rama) salirConErrores("la rama no vale", [rama]);
  const origen = problemaDeOrigen({ ref: process.env.GITHUB_REF, ramaPorDefecto: process.env.RAMA_PRINCIPAL, rama: process.env.RAMA });
  if (origen) salirConErrores("la rama no vale", [origen]);
  const entorno = leerEntorno(process.env.ENTORNO);
  if (entorno.errores.length) salirConErrores("las variables de construcción no valen", entorno.errores);
  const destino = opt("--entorno-en", "");
  if (destino && entorno.pares.length) appendFileSync(destino, `${entorno.pares.map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  console.log(`la lista vale: ${vistas.length} vistas${entorno.pares.length ? `, ${entorno.pares.length} variables de construcción` : ""}`);
  process.exit(0);
}

const base = opt("--base", "http://localhost:4173").replace(/\/+$/, "");
const problemaBase = problemaDeBase(base);
if (problemaBase) salirConErrores("la base no vale", [`--base ${problemaBase}`]);
const out = resolve(opt("--out", "capturas"));
mkdirSync(out, { recursive: true });

/** Cuánto puede tardar una vista entera, con sus pasos y esperas declaradas (y nunca más de lo que queda del tiempo total). */
const PLAZO_VISTA_MS = TOPES.totalMs + 120_000;
const ALTO_MAXIMO_ENTERA = 16_000;

const js = (x) => JSON.stringify(x);
const visible = (sel) =>
  `(() => { const e = document.querySelector(${js(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; })()`;

async function esperarVisible(page, sel, ms) {
  const r = await page.waitFor(visible(sel), ms);
  if (!r.ok) throw new Error(`no se vio ${sel} en ${Math.round(ms / 1000)} s`);
}

/** Lo mismo sin lanzar: dice si se vio a tiempo. */
const estaVisible = async (page, sel, ms) => (await page.waitFor(visible(sel), ms)).ok;

/** Un clic de verdad, en el centro del elemento, ya a la vista. Falla con el motivo si está apagado o si otro elemento lo tapa. */
async function clic(page, sel) {
  await esperarVisible(page, sel, 10_000);
  const p = await puntoDelClicEn(page, sel);
  await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
  }
}

/** Escribe en un campo de texto como si se pegara: reemplaza lo que hubiera y dispara los eventos de siempre. */
async function escribir(page, sel, texto) {
  await esperarVisible(page, sel, 10_000);
  const ok = await page.eval(
    `(() => { const e = document.querySelector(${js(sel)}); if (!(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return 'no es un campo de texto'; if (e.readOnly || e.disabled) return 'el campo es de solo lectura o está apagado'; e.scrollIntoView({ block: 'center', behavior: 'instant' }); e.focus(); e.select(); return 'ok'; })()`,
  );
  if (ok !== "ok") throw new Error(`${sel}: ${ok}`);
  if (texto === "") await tecla(page, "Backspace");
  else await page.send("Input.insertText", { text: texto });
}

async function tecla(page, nombre) {
  const t = TECLAS[nombre];
  const evento = { key: t.key ?? nombre, code: t.code, windowsVirtualKeyCode: t.vk, nativeVirtualKeyCode: t.vk };
  await page.send("Input.dispatchKeyEvent", { type: t.text ? "keyDown" : "rawKeyDown", ...evento, ...(t.text ? { text: t.text, unmodifiedText: t.text } : {}) });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...evento });
}

async function paso(page, p, revisar) {
  switch (p.accion) {
    case "clic":
      return clic(page, p.selector);
    case "clicHasta":
      return clicHasta(page, p, { clic, estaVisible, ahora: Date.now, revisar });
    case "escribir":
      return escribir(page, p.selector, p.texto);
    case "nombres":
      return escribir(page, p.selector, generarNombres(p.cantidad).join("\n"));
    case "esperar":
      return esperarVisible(page, p.selector, p.ms);
    case "pausa":
      return sleep(p.ms);
    case "tecla":
      return tecla(page, p.tecla);
    case "desplazar":
      return desplazar(page, p.selector, esperarVisible);
    default:
      throw new Error(`acción desconocida ${p.accion}`);
  }
}

/** Lo que la página dijo mal: errores de consola, excepciones y fallas de carga de recursos. */
function vigilarErrores(page) {
  const extra = [];
  page.ws.addEventListener("message", (ev) => {
    try {
      const m = JSON.parse(ev.data);
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") extra.push(`${m.params.entry.text}${m.params.entry.url ? ` (${m.params.entry.url})` : ""}`);
    } catch {
      /* mensaje que no es de este tipo */
    }
  });
  return () => [...page.consoleErrors, ...page.exceptions, ...extra].map((e) => String(e).replace(/\s+/g, " ").slice(0, 300)).slice(0, 20);
}

async function fotografiar(page, archivo, entera, vigente = () => true) {
  const params = { format: "png" };
  let truncada = false;
  if (entera) {
    const m = await page.send("Page.getLayoutMetrics");
    const c = m.cssContentSize ?? m.contentSize;
    const alto = Math.min(Math.ceil(c.height), ALTO_MAXIMO_ENTERA);
    truncada = c.height > ALTO_MAXIMO_ENTERA;
    Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: Math.ceil(c.width), height: alto, scale: 1 } });
  }
  const { data } = await page.send("Page.captureScreenshot", params);
  // Una vista que ya se pasó de su plazo no escribe nada: su foto de después no tiene que aparecer como si hubiera salido.
  if (vigente()) writeFileSync(archivo, Buffer.from(data, "base64"));
  return truncada;
}

/** El comienzo del motivo de que una vista no se pudo hacer: el plazo de la vista o el total. */
const motivoDelPlazo = (plazoMs, porElTotal) => (porElTotal ? `se acabó el tiempo total de ${MINUTOS_TOTAL} minutos durante esta vista` : `la vista tardó más de ${Math.round(plazoMs / 1000)} s`);

/** Cuánto se espera a que el navegador abra una pestaña y cuánto a que la cierre. */
const ABRIR_PESTANA_MS = 30_000;
const CERRAR_PESTANA_MS = 5_000;

async function capturar(browser, v, { plazoMs, porElTotal }, comprobarRuta) {
  const url = direccionDeVista(v, base);
  const caminoPedido = new URL(url).pathname;
  const fila = { nombre: v.nombre, ok: false, archivo: null, error: null, direccion: url, direccionFinal: null, estadoHttp: null, idiomaDeLaPagina: null, temaDeLaPagina: null, graficos: null, pantalla: `${v.ancho}x${v.alto}`, tema: v.tema, idioma: v.idioma, paginaEntera: v.paginaEntera, truncada: false, imagenesEnLaFoto: null, imagenesSinCompletar: null, scrollHorizontal: null, anchoDelContenido: null, anchoDeLaPantalla: null, erroresDeConsola: [], archivoDelFallo: null, direccionEnElFallo: null, textoVisible: null };
  let page;
  try {
    page = await conTope(browser.open("about:blank"), ABRIR_PESTANA_MS);
  } catch (e) {
    // Sin pestaña no hay vista: queda con su error y el navegador no se da por bueno para las que siguen.
    fila.error = `no pude abrir la pestaña: ${String(e.message ?? e).slice(0, 300)}`;
    fila.navegadorCaido = true;
    return fila;
  }
  let errores = () => [];
  let revisar = () => undefined;
  // Si lo que se intentó falla y la página quiso ir a otro sitio, ese es el motivo que cuenta, no el síntoma.
  const motivoReal = async (f) => {
    try {
      return await f();
    } catch (e) {
      revisar();
      throw e;
    }
  };
  const resultado = await correrConPlazo(
    async (d, vigente) => {
      await page.send("Emulation.setDeviceMetricsOverride", { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: v.ancho < 600, screenWidth: v.ancho, screenHeight: v.alto });
      await page.send("Log.enable").catch(() => undefined);
      // El idioma de una persona de acá. Sin esto, en una máquina de Linux sin idioma configurado el sitio abre en inglés
      // cuando la vista no pide ?lang=. Se cambia solo lo que dice el navegador, no su nombre.
      const ua = await page.eval("navigator.userAgent");
      await page.send("Emulation.setUserAgentOverride", { userAgent: ua, acceptLanguage: "es-BO,es" });
      await page.send("Emulation.setLocaleOverride", { locale: "es-BO" }).catch(() => undefined);
      errores = vigilarErrores(page);
      // La pestaña no sale del sitio servido: un enlace externo se corta antes de visitarlo.
      const corte = await cortarFueraDelOrigen(page, base);
      revisar = corte.revisar;
      const documentos = await vigilarDocumentos(page);
      // Una ruta que el servidor contesta con la portada de respaldo: se navega igual (la foto del fallo muestra qué había) y se rechaza al cargar.
      const rutaMala = await comprobarRuta(v.ruta);
      const nav = await page.send("Page.navigate", { url });
      if (nav.errorText) throw new Error(`no cargó ${url}: ${nav.errorText}`);
      const cargo = await page.waitFor("document.readyState === 'complete'", 30_000);
      if (!cargo.ok) throw new Error("la página no terminó de cargar en 30 s");
      d.estadoHttp = documentos.ultimo()?.estado ?? null;
      const cargada = JSON.parse(await page.eval("JSON.stringify({ camino: location.pathname })"));
      const malaCarga = rutaMala || problemaDelDocumento({ respuestas: documentos.respuestas, caminoPedido, caminoCargado: cargada.camino });
      if (malaCarga) throw new Error(malaCarga);
      // Las tipografías: sin esperarlas, la foto sale con la letra de reemplazo.
      await page.eval("Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))])").catch(() => undefined);
      for (const [i, p] of v.pasos.entries()) {
        try {
          await motivoReal(() => paso(page, p, revisar));
          revisar();
        } catch (e) {
          throw new Error(`paso ${i + 1} (${p.accion}): ${e.message}`);
        }
      }
      if (v.esperar) await motivoReal(() => esperarVisible(page, v.esperar, 30_000));
      if (v.pausaMs) await sleep(v.pausaMs);
      revisar();
      // Las imágenes diferidas y las letras, antes de la foto (con la página entera, recorriéndola): lo que no llegó se anota.
      const listas = await motivoReal(() => prepararFoto(page, v.paginaEntera));
      d.imagenesEnLaFoto = listas.imagenes;
      d.imagenesSinCompletar = listas.sinCompletar;
      const e = JSON.parse(await page.eval(`JSON.stringify((${estadoDeLaPagina.toString()})())`));
      d.direccionFinal = e.href;
      d.idiomaDeLaPagina = e.idioma;
      d.temaDeLaPagina = e.tema;
      d.graficos = describirGraficos(e);
      d.anchoDelContenido = e.sw;
      d.anchoDeLaPantalla = e.iw;
      d.scrollHorizontal = e.sw > e.iw + 1;
      if (new URL(e.href).origin !== new URL(base).origin) throw new Error(`la página terminó en otro sitio: ${e.href}`);
      const malaDespues = problemaDelDocumento({ respuestas: documentos.respuestas, caminoPedido }) || problemaDeTemaEIdioma(v, e);
      if (malaDespues) throw new Error(malaDespues);
      const archivo = `${v.nombre}.png`;
      d.truncada = await fotografiar(page, join(out, archivo), v.paginaEntera, vigente);
      if (!vigente()) throw new Error("la vista se pasó de su plazo");
      d.archivo = archivo;
      d.ok = true;
    },
    plazoMs,
    motivoDelPlazo(plazoMs, porElTotal),
  );
  // Solo lo que el trabajo había anotado cuando terminó o cuando se acabó su plazo: lo que escriba después se ignora.
  Object.assign(fila, resultado.datos);
  if (!resultado.ok) {
    fila.ok = false;
    fila.archivo = null;
    fila.error = String(resultado.error?.message ?? resultado.error).slice(0, 400);
    // Lo que había en pantalla, antes de cerrar la pestaña. Con su propio intento: un error acá no tapa el de la vista.
    Object.assign(fila, await evidenciaDelFallo(page, (nombre) => fotografiar(page, join(out, nombre), false), `${v.nombre}-FALLO.png`));
    // Ni foto, ni dirección ni texto: la pestaña no contesta, y las que siguen tampoco van a poder.
    if (!fila.archivoDelFallo && fila.direccionEnElFallo === null && fila.textoVisible === null) fila.navegadorCaido = true;
  }
  fila.erroresDeConsola = errores();
  await page.send("Page.close", {}, CERRAR_PESTANA_MS).catch(() => undefined);
  return fila;
}

const MINUTOS_TOTAL = TOPES.scriptMs / 60_000;
/** Una vista que no se hizo: queda en el informe con el motivo, no desaparece. */
function vistaSinHacer(v, motivo) {
  return { nombre: v.nombre, ok: false, sinHacer: true, archivo: null, error: `no se hizo: ${motivo}`, direccion: direccionDeVista(v, base), pantalla: `${v.ancho}x${v.alto}`, tema: v.tema, idioma: v.idioma, erroresDeConsola: [] };
}

const informe = { base, vistas: [], total: vistas.length, falladas: 0, sinHacer: 0, topeTotalMinutos: MINUTOS_TOTAL };
const guardar = () => writeFileSync(join(out, "informe.json"), `${JSON.stringify(informe, null, 2)}
`);
guardar();

const comprobarRuta = crearComprobadorDeRutas(base);
const alTerminar = (fila) => {
  informe.vistas.push(fila);
  informe.falladas = informe.vistas.filter((f) => !f.ok).length;
  informe.sinHacer = informe.vistas.filter((f) => f.sinHacer).length;
  guardar();
  const aviso = fila.ok ? `${fila.scrollHorizontal ? " con scroll horizontal" : ""}${fila.imagenesSinCompletar ? ` con ${fila.imagenesSinCompletar} imágenes sin completar` : ""}${fila.erroresDeConsola.length ? ` y ${fila.erroresDeConsola.length} errores de consola` : ""}` : `: ${fila.error}${fila.archivoDelFallo ? ` (foto: ${fila.archivoDelFallo})` : ""}`;
  console.log(`${fila.sinHacer ? "SIN HACER" : fila.ok ? "OK    " : "FALLÓ "} ${fila.nombre} (${fila.pantalla ?? "sin pantalla"})${aviso}`);
};

// Si el navegador no arranca, el informe igual trae una fila por cada vista, con ese motivo.
let browser = null;
let sinNavegador = "";
try {
  browser = await launch({ width: 1280, height: 900 });
} catch (e) {
  sinNavegador = String(e.message ?? e).slice(0, 300);
}
try {
  await recorrerVistas({
    vistas,
    capturar: (v, plan) => capturar(browser, v, plan, comprobarRuta),
    sinHacer: vistaSinHacer,
    planear: (gastadoMs) => plazoDeLaVista(gastadoMs, PLAZO_VISTA_MS),
    motivoDelTotal: `se acabó el tiempo total de ${MINUTOS_TOTAL} minutos`,
    sinNavegador,
    alTerminar,
  });
} finally {
  await browser?.close();
}
console.log(`${informe.total - informe.falladas} de ${informe.total} vistas capturadas en ${out}`);
process.exitCode = informe.falladas ? 1 : 0;
