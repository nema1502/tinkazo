#!/usr/bin/env node
/**
 * Capturas de una lista de vistas del sitio servido.
 *
 * Abre cada vista en Chrome (por el protocolo de DevTools, con `scripts/lib/browser.mjs`),
 * corre sus pasos, espera lo que haga falta y saca un PNG. La lista es solo datos: no
 * hay forma de pasarle JavaScript para que corra en la página. Se valida entera antes de
 * abrir nada (`scripts/lib/vistas.mjs`).
 *
 * Uso:
 *   pnpm preview &                                 # sirve dist/ en :4173
 *   VISTAS_JSON='[{"nombre":"portada","ruta":"/"}]' node scripts/capturar-vistas.mjs --base http://localhost:4173 --out capturas
 *   node scripts/capturar-vistas.mjs --vistas vistas.json --base http://localhost:4173 --out capturas
 *
 * Con `--validar` solo revisa la lista (y, si vienen, las variables ENTORNO y la rama RAMA)
 * y sale: es lo que corre el trabajo de GitHub antes de construir nada. Con
 * `--entorno-en <archivo>` además agrega al archivo una línea NOMBRE=valor por cada
 * variable de ENTORNO (el trabajo le pasa `$GITHUB_ENV`).
 *
 * Deja `<out>/<nombre>.png` por vista y `<out>/informe.json` con, por vista, si salió, el
 * error si no, la dirección final, si la página tiene scroll horizontal (scrollWidth contra
 * innerWidth) y los errores de consola. Sale con 1 si alguna vista no se pudo capturar (lo
 * que sí salió queda escrito) y con 2 si la lista o los argumentos no valen.
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
 *     {"accion":"escribir","selector":"#ta","texto":"Ana\nBeto"}        reemplaza lo que haya
 *     {"accion":"nombres","selector":"#ta","cantidad":150}              N nombres inventados, uno por renglón
 *     {"accion":"esperar","selector":"#wait-box","ms":20000}            espera a que se vea
 *     {"accion":"pausa","ms":1500}
 *     {"accion":"tecla","tecla":"Enter"}                                Enter, Escape, Tab, Space, flechas, Home, End...
 *     {"accion":"desplazar","selector":"#winner-box"}
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
 *   La espera de un sorteo de demostración, con la cuenta en marcha (hay 30 s de espera, la foto sale a los 4):
 *     {"nombre":"espera-demo","ruta":"/?demo=wheel&lead=30","ancho":1280,"alto":900,"tema":"dark",
 *      "esperar":"#wait-box","pausaMs":4000,"pasos":[{"accion":"desplazar","selector":"#wait-box"}]}
 *
 *   El resultado de una demostración (sin animaciones, la ronda llega a los 3 s):
 *     {"nombre":"resultado-demo","ruta":"/?demo=wheel&instant=1&lead=3","ancho":1280,"alto":900,"tema":"light",
 *      "esperar":".winner-name","pausaMs":2500,"pasos":[{"accion":"desplazar","selector":"#winner-box"}]}
 *
 *   Una página de lectura entera, en inglés y celular:
 *     {"nombre":"seguridad-en-390","ruta":"/seguridad.html","ancho":390,"alto":844,"idioma":"en","paginaEntera":true,"esperar":"main"}
 *
 * La espera con 150 nombres no se arma solo con pasos: la demostración usa siempre su lista
 * de ejemplo, el ensayo trae una fija y sellar una lista propia pide una cuenta. Para ver el
 * show con muchos nombres sirve la escena fija: "/?pose=wheel&n=150".
 */
import { mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { TECLAS, TOPES, direccionDeVista, generarNombres, leerEntorno, leerVistas, problemaDeBase, problemaDeRama } from "./lib/vistas.mjs";

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

/** Cuánto puede tardar una vista entera, con sus pasos y esperas declaradas. */
const PLAZO_VISTA_MS = TOPES.totalMs + 120_000;
const ALTO_MAXIMO_ENTERA = 16_000;

const js = (x) => JSON.stringify(x);
const visible = (sel) =>
  `(() => { const e = document.querySelector(${js(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; })()`;

async function esperarVisible(page, sel, ms) {
  const r = await page.waitFor(visible(sel), ms);
  if (!r.ok) throw new Error(`no se vio ${sel} en ${Math.round(ms / 1000)} s`);
}

/** Un clic de verdad, en el centro del elemento, ya a la vista. */
async function clic(page, sel) {
  await esperarVisible(page, sel, 10_000);
  const p = JSON.parse(
    await page.eval(
      `JSON.stringify((() => { const e = document.querySelector(${js(sel)}); e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`,
    ),
  );
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

async function paso(page, p) {
  switch (p.accion) {
    case "clic":
      return clic(page, p.selector);
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
    case "desplazar": {
      const r = await page.waitFor(`document.querySelector(${js(p.selector)})`, 10_000);
      if (!r.ok) throw new Error(`no está ${p.selector}`);
      await page.eval(`document.querySelector(${js(p.selector)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
      return undefined;
    }
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

async function fotografiar(page, archivo, entera) {
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
  writeFileSync(archivo, Buffer.from(data, "base64"));
  return truncada;
}

async function capturar(browser, v) {
  const url = direccionDeVista(v, base);
  const fila = { nombre: v.nombre, ok: false, archivo: null, error: null, direccion: url, direccionFinal: null, idiomaDeLaPagina: null, pantalla: `${v.ancho}x${v.alto}`, tema: v.tema, idioma: v.idioma, paginaEntera: v.paginaEntera, truncada: false, scrollHorizontal: null, anchoDelContenido: null, anchoDeLaPantalla: null, erroresDeConsola: [] };
  const page = await browser.open("about:blank");
  let errores = () => [];
  const trabajo = (async () => {
    await page.send("Emulation.setDeviceMetricsOverride", { width: v.ancho, height: v.alto, deviceScaleFactor: 1, mobile: v.ancho < 600, screenWidth: v.ancho, screenHeight: v.alto });
    await page.send("Log.enable").catch(() => undefined);
    // El idioma de una persona de acá. Sin esto, en una máquina de Linux sin idioma configurado el sitio abre en inglés
    // cuando la vista no pide ?lang=. Se cambia solo lo que dice el navegador, no su nombre.
    const ua = await page.eval("navigator.userAgent");
    await page.send("Emulation.setUserAgentOverride", { userAgent: ua, acceptLanguage: "es-BO,es" });
    await page.send("Emulation.setLocaleOverride", { locale: "es-BO" }).catch(() => undefined);
    errores = vigilarErrores(page);
    const nav = await page.send("Page.navigate", { url });
    if (nav.errorText) throw new Error(`no cargó ${url}: ${nav.errorText}`);
    const cargo = await page.waitFor("document.readyState === 'complete'", 30_000);
    if (!cargo.ok) throw new Error("la página no terminó de cargar en 30 s");
    // Las tipografías: sin esperarlas, la foto sale con la letra de reemplazo.
    await page.eval("Promise.race([document.fonts.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))])").catch(() => undefined);
    for (const [i, p] of v.pasos.entries()) {
      try {
        await paso(page, p);
      } catch (e) {
        throw new Error(`paso ${i + 1} (${p.accion}): ${e.message}`);
      }
    }
    if (v.esperar) await esperarVisible(page, v.esperar, 30_000);
    if (v.pausaMs) await sleep(v.pausaMs);
    const d = JSON.parse(await page.eval("JSON.stringify({ href: location.href, lang: document.documentElement.lang, sw: document.documentElement.scrollWidth, iw: window.innerWidth })"));
    fila.direccionFinal = d.href;
    fila.idiomaDeLaPagina = d.lang;
    fila.anchoDelContenido = d.sw;
    fila.anchoDeLaPantalla = d.iw;
    fila.scrollHorizontal = d.sw > d.iw + 1;
    if (new URL(d.href).origin !== new URL(base).origin) throw new Error(`la página terminó en otro sitio: ${d.href}`);
    const archivo = `${v.nombre}.png`;
    fila.truncada = await fotografiar(page, join(out, archivo), v.paginaEntera);
    fila.archivo = archivo;
    fila.ok = true;
  })();
  let plazo;
  try {
    await Promise.race([
      trabajo,
      new Promise((_, rej) => {
        plazo = setTimeout(() => rej(new Error(`la vista tardó más de ${Math.round(PLAZO_VISTA_MS / 1000)} s`)), PLAZO_VISTA_MS);
      }),
    ]);
  } catch (e) {
    fila.error = String(e.message ?? e).slice(0, 400);
    trabajo.catch(() => undefined);
  } finally {
    clearTimeout(plazo);
    fila.erroresDeConsola = errores();
    await page.send("Page.close").catch(() => undefined);
  }
  return fila;
}

const informe = { base, vistas: [], total: vistas.length, falladas: 0 };
const guardar = () => writeFileSync(join(out, "informe.json"), `${JSON.stringify(informe, null, 2)}\n`);
guardar();

const browser = await launch({ width: 1280, height: 900 });
try {
  for (const v of vistas) {
    const fila = await capturar(browser, v);
    informe.vistas.push(fila);
    informe.falladas = informe.vistas.filter((f) => !f.ok).length;
    guardar();
    console.log(`${fila.ok ? "OK    " : "FALLÓ "} ${v.nombre} (${fila.pantalla})${fila.ok ? `${fila.scrollHorizontal ? " con scroll horizontal" : ""}${fila.erroresDeConsola.length ? ` y ${fila.erroresDeConsola.length} errores de consola` : ""}` : `: ${fila.error}`}`);
  }
} finally {
  await browser.close();
}
console.log(`${informe.total - informe.falladas} de ${informe.total} vistas capturadas en ${out}`);
process.exitCode = informe.falladas ? 1 : 0;
