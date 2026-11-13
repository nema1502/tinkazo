#!/usr/bin/env node
/**
 * Auditor de los dos modos nuevos con la cuenta de prueba.
 *
 * Tinkazo agrega dos formas de usar el mismo sorteo, que se ven con un
 * parametro en la direccion: "Orden de turnos" (?modo=turnos: salen todas las
 * personas de la lista, en orden, y ese orden son los turnos) y "Varias
 * participaciones" (?modo=varias: las veces de cada persona se eligen tocando
 * un contador en un panel, o se aceptan los numeros que ya trae una lista
 * pegada con el boton "Si, usarlos").
 *
 * Recorre los dos modos de punta a punta con la cuenta de prueba de testnet,
 * en celular (390x844) y en escritorio (1366x768): carga la lista, la sella,
 * espera la ronda, sortea (con &instant=1 para no esperar la animacion) y mira
 * el resultado, "Mostrar en grande" y la pagina de verificacion. Deja una
 * captura por paso en `--out` y avisa con una tilde o una cruz por cada
 * comprobacion.
 *
 * Los casos son cinco: A (orden de turnos con doce nombres, uno largo y uno
 * corto; en el celular mira ademas la lista a 320, 360, 390 y 412 px, la letra
 * de "Mostrar en grande" y el boton de la lista a 320 px en los dos idiomas), B (los dos modos
 * juntos: aceptar los numeros de la lista y despues elegir el orden), C (varias
 * participaciones con tres ganadores), D (varias participaciones puestas
 * tocando el contador del panel, sin numeros en la lista, y el aire entre el
 * boton y el panel abierto) y E (el cartel final
 * del primer orden de turnos, con el juego corriendo de verdad). Si la cuenta de
 * prueba no puede sellar (sin red, sin saldo), lo dice en una linea clara y
 * sale con 2.
 *
 * Uso:
 *   node scripts/audit-modos.mjs [--base http://localhost:4173] [--out DIR]
 *                                 [--temas dark,light] [--casos A,B,C,D,E]
 *                                 [--vistas celular,escritorio] [--bandera]
 *
 * --bandera: la construccion que se mira se hizo con VITE_MODOS=1 (los modos a la vista aunque la direccion no traiga
 * ?modo=). Cambia lo que el caso C espera de la verificacion sin el parametro: cuatro personas con siete
 * participaciones y cuatro renglones, no siete participantes y siete renglones.
 *
 * Un solo navegador y con su propio puerto: CDP_PORT=<puerto> node ...
 * Sale con 1 si alguna comprobacion falla, con 2 si no se pudo sellar.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { HAY_BOTON_ENTRAR_JS, TOCAR_ENTRAR_JS } from "./lib/entrar.mjs";
import { esperadoSinElParametro, evaluarRepetidos } from "./lib/modos-comprobaciones.mjs";

const args = process.argv.slice(2);
if (args.includes("--ayuda") || args.includes("-h")) {
  console.log(
    [
      "Audita los dos modos nuevos (?modo=turnos y ?modo=varias) con la cuenta de prueba.",
      "",
      "Uso:",
      "  node scripts/audit-modos.mjs [--base http://localhost:4173] [--out DIR]",
      "                                [--temas dark,light] [--casos A,B,C,D,E]",
      "                                [--vistas celular,escritorio] [--bandera]",
      "",
      "--bandera: la construccion se hizo con VITE_MODOS=1; el caso C espera la verificacion agrupada sin el parametro.",
      "",
      "Un solo navegador y con su propio puerto: CDP_PORT=<puerto> node ...",
      "Sale con 1 si alguna comprobacion falla, con 2 si no se pudo sellar.",
    ].join("\n"),
  );
  process.exit(0);
}

const opt = (nombre, valor) => {
  const i = args.indexOf(nombre);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : valor;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas/modos");
const temas = opt("--temas", "dark").split(",").map((t) => t.trim()).filter(Boolean);
const casos = opt("--casos", "A,B,C,D,E").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
const conBandera = args.includes("--bandera");
const vistasPedidas = opt("--vistas", "celular,escritorio").split(",").map((v) => v.trim()).filter(Boolean);

const VISTAS = {
  celular: { etiqueta: "celular", ancho: 390, alto: 844, dpr: 2, movil: true },
  escritorio: { etiqueta: "escritorio", ancho: 1366, alto: 768, dpr: 1, movil: false },
};
const desconocidas = vistasPedidas.filter((v) => !VISTAS[v]);
if (
  desconocidas.length ||
  vistasPedidas.length === 0 ||
  temas.some((t) => t !== "dark" && t !== "light") ||
  casos.some((c) => !["A", "B", "C", "D", "E"].includes(c)) ||
  casos.length === 0
) {
  console.error("uso: --vistas celular,escritorio --temas dark,light --casos A,B,C,D,E");
  process.exit(2);
}
const vistas = vistasPedidas.map((v) => VISTAS[v]);

// Lo que se espera para no sellar nunca: 4 minutos como en audit-flujo, y 3 para que nazca la ronda.
const SELLO_MAX = 240000;
const RONDA_MAX = 180000;

let total = 0;
let fallas = 0;
const fallaron = [];
function check(nombre, ok, detalle = "") {
  total++;
  if (!ok) {
    fallas++;
    fallaron.push(nombre);
  }
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` - ${detalle}` : ""}`);
}
const info = (texto) => console.log(`    ${texto}`);

/** Si no se pudo sellar, el recorrido se corta con este error y la salida avisa en una linea y sale con 2. */
const selloImposible = (motivo) => {
  const e = new Error(motivo);
  e.codigo = "sello";
  return e;
};

async function quieto(page, ms = 700, max = 5000) {
  let ultimo = null;
  let estable = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < max) {
    const y = await page.eval("Math.round(scrollY)");
    if (y === ultimo) {
      estable += 150;
      if (estable >= ms) return;
    } else {
      estable = 0;
      ultimo = y;
    }
    await sleep(150);
  }
}

/** La cuenta de prueba: se conecta sola y le carga fondos. Lanza si algo no sale (patron de audit-flujo). */
async function conectarCuentaDePrueba(page) {
  if ((await page.eval("String(!!localStorage.getItem('tinkazo.guest.secret.testnet'))")) === "true") {
    const vuelta = await page.waitFor("document.querySelector('#wallet-box .hello')", 30000);
    if (!vuelta.ok) throw new Error("la cuenta de prueba de antes no se retomo");
    await sleep(900);
    return;
  }
  await page.waitFor(HAY_BOTON_ENTRAR_JS, 20000);
  await sleep(500);
  await page.eval(TOCAR_ENTRAR_JS);
  const ventana = await page.waitFor("document.querySelector('.login-opt')", 15000);
  if (!ventana.ok) throw new Error("no se abrio la ventana de ingreso");
  await sleep(300);
  const i = await page.eval("String([...document.querySelectorAll('.login-opt')].findIndex((el) => /prueba|Test account/.test(el.textContent)))");
  if (i === "-1") throw new Error("la ventana de ingreso no ofrece la cuenta de prueba");
  await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].click(); true`);
  const entro = await page.waitFor("!document.querySelector('.modal-back') && document.querySelector('#wallet-box .hello')", 120000);
  if (!entro.ok) throw new Error("la cuenta de prueba no quedo conectada");
  await sleep(900);
}

/** Escribe la lista en el cuadro (#ta) como si se tecleara. Devuelve cuantas lineas quedaron. */
async function escribirLista(page, texto) {
  await page.eval(
    `(() => { const ta = document.getElementById('ta'); ta.value = ${JSON.stringify(texto)}; ta.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
  );
  await sleep(900);
  return Number(await page.eval("document.querySelectorAll('#names i').length"));
}

/** Acepta los numeros que ya trae una lista pegada: el boton "Si, usarlos" de la pregunta bajo el cuadro. */
async function repartir(page) {
  const pregunta = await page.waitFor(
    "document.getElementById('btn-part-si') && getComputedStyle(document.getElementById('participaciones-aviso')).display !== 'none'",
    10000,
  );
  if (!pregunta.ok) throw new Error("no se ve la pregunta por los numeros de la lista");
  await page.eval("document.getElementById('btn-part-si').click(); true");
  await sleep(900);
  return "btn-part-si";
}

/** Elige "Orden de turnos" (#btn-turnos) en el selector de modo, que está a la vista arriba de la lista. */
async function elegirTurnos(page) {
  await page.eval("document.getElementById('btn-turnos').click(); true");
  const prendido = await page.waitFor("document.getElementById('btn-turnos').getAttribute('aria-pressed') === 'true'", 10000);
  if (!prendido.ok) throw new Error("no quedo prendido Orden de turnos");
  await sleep(900);
}

/** Pone cuantos ganan (#nw) como lo haria la persona, con los eventos del campo. */
async function ponerGanadores(page, n) {
  await page.eval(
    `(() => { const nw = document.getElementById('nw'); nw.value = ${JSON.stringify(String(n))}; nw.dispatchEvent(new Event('input', { bubbles: true })); nw.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
  );
  await sleep(700);
}

/** Sella la lista (#btn-freeze) y espera a que quede sellada. Si no se puede, lanza el error de salida 2. */
async function sellar(page) {
  await page.eval("document.getElementById('btn-freeze').click(); true");
  const sello = await page.waitFor(
    "getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none'",
    SELLO_MAX,
  );
  if (sello.ok) {
    info(`sellada en ${(sello.elapsed / 1000).toFixed(1)} s`);
    return;
  }
  const motivo = String(
    (await page.eval("(document.getElementById('seal-status') || {}).textContent || document.getElementById('red-estado')?.textContent || ''")).slice(0, 120),
  ).replace(/\s+/g, " ").trim();
  throw selloImposible(motivo || `no se sello en ${Math.round(SELLO_MAX / 1000)} s`);
}

/** Espera a que nazca la ronda y lanza el sorteo (#btn-draw) hasta el resultado. */
async function sortear(page) {
  const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", RONDA_MAX);
  if (!nacio.ok) throw new Error("la ronda no nacio en tres minutos");
  await sleep(500);
  await page.eval("document.getElementById('btn-draw').click(); true");
  // Con &instant=1 puede no haber estadio: el resultado llega directo.
  const estadio = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 60000);
  if (estadio.ok) {
    await sleep(1200);
    await page.eval("document.getElementById('st-skip')?.click(); true");
  }
  const sale = await page.waitFor(
    "getComputedStyle(document.getElementById('winner-box')).display !== 'none' && getComputedStyle(document.getElementById('again-row')).display !== 'none'",
    120000,
  );
  if (!sale.ok) throw new Error("no aparecio el resultado");
  await sleep(1500);
  await quieto(page, 1200, 6000);
}

/** Lo que se lee en la pantalla ahora mismo: solo el texto que de verdad se ve, nada de lo escondido ni de lo que esta fuera de la ventana. */
const LEER_VISIBLE = `JSON.stringify((() => {
  const dentro = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const sale = [];
  const paseo = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (paseo.nextNode()) {
    const n = paseo.currentNode;
    const t = n.textContent.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || el.closest('script,style,[inert],svg,.sr-only')) continue;
    let tapado = false;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (p.hidden || p.getAttribute('aria-hidden') === 'true' || pcs.display === 'none' || pcs.visibility === 'hidden' || +pcs.opacity < 0.05) { tapado = true; break; }
      if (p instanceof HTMLDetailsElement && !p.open && !el.closest('summary')) { tapado = true; break; }
    }
    if (tapado) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const rg = document.createRange();
    rg.selectNodeContents(n);
    const r = rg.getBoundingClientRect();
    if (!dentro(r)) continue;
    sale.push(t);
  }
  return sale.join(' ');
})())`;

const SIN_GANADOR = /ganador(?:es)?|\bgana\b|premio|winner|wins|prize/i;

const leerVisible = async (page) => String(await page.eval(LEER_VISIBLE));

/** La primera palabra prohibida a la vista, con el texto de alrededor: vacio si no hay ninguna. */
async function palabraProhibida(page) {
  const texto = await leerVisible(page);
  const m = SIN_GANADOR.exec(texto);
  if (!m) return "";
  const desde = Math.max(0, m.index - 70);
  const hasta = Math.min(texto.length, m.index + m[0].length + 70);
  return `"${m[0]}" en "...${texto.slice(desde, hasta)}..."`;
}

function checkSinGanador(quien, hallada) {
  check(`${quien}: en lo visible no se habla de ganar ni de premio`, !hallada, hallada);
}

/** Espera a que la pagina de verificacion muestre su veredicto: deja de decir que esta revisando y se ve el resultado. Devuelve el titulo del veredicto. */
async function esperarVeredicto(ver) {
  for (let i = 0; i < 90; i++) {
    const estado = JSON.parse(
      await ver.eval(`JSON.stringify({
        trabajo: document.getElementById('verdict') ? document.getElementById('verdict').classList.contains('working') : false,
        titulo: (document.getElementById('verdict-title') || {}).textContent || '',
        resultado: document.getElementById('sec-result') ? getComputedStyle(document.getElementById('sec-result')).display !== 'none' : false,
        lista: document.querySelectorAll('#v-names i').length,
      })`),
    );
    if (!estado.trabajo && estado.titulo.trim() && estado.resultado && estado.lista > 0) return estado.titulo;
    await sleep(800);
  }
  return "";
}
const sinScrollX = async (page) => Number(await page.eval("document.documentElement.scrollWidth - document.documentElement.clientWidth"));

/** Ninguna tarjeta ni fila del resultado trae la marca de la línea sellada («(2/3)»: es interna, para sellar). */
const sinMarcaDeLinea = (nombres) => nombres.every((t) => !/\(\d+\s*\/\s*\d+\)/.test(t));

/** La frase de la barra entra en su caja: ni cortada a lo ancho ni a lo alto (con reparto vale hasta dos renglones). */
const barraEntra = (page) =>
  page.eval(`(() => {
    const el = document.getElementById('sig-paso');
    if (!el) return 'no esta';
    const entra = el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1;
    return entra ? 'entra' : 'ancho ' + el.scrollWidth + '/' + el.clientWidth + ' alto ' + el.scrollHeight + '/' + el.clientHeight;
  })()`);

/** El aire entre el botón de más de un turno y el enlace del stand, en píxeles (u «oculto» si el botón no se ve). */
const aireBotonEnlace = (page) =>
  page.eval(`(() => {
    const b = document.getElementById('btn-varias');
    const s = document.getElementById('btn-stand');
    if (!b || !s) return 'falta';
    if (getComputedStyle(b).display === 'none') return 'oculto';
    return String(Math.round(s.getBoundingClientRect().top - b.getBoundingClientRect().bottom));
  })()`);

/**
 * Las medidas del botón de más de un turno, su panel y el enlace del stand, en coordenadas de la página (no se
 * mueven si la página se desplaza): el borde de abajo del botón, el de arriba del panel, el alto del panel y el
 * borde de arriba del enlace. El panel cerrado da null.
 */
const medidasDelPanel = async (page) =>
  JSON.parse(
    await page.eval(`JSON.stringify((() => {
      const y = (el) => el.getBoundingClientRect().top + scrollY;
      const b = document.getElementById('btn-varias');
      const p = document.getElementById('varias-panel');
      const s = document.getElementById('btn-stand');
      if (!b || !p || !s) return null;
      const abierto = getComputedStyle(p).display !== 'none';
      return {
        botonAbajo: b.getBoundingClientRect().bottom + scrollY,
        panelArriba: abierto ? y(p) : null,
        panelAlto: abierto ? p.getBoundingClientRect().height : null,
        enlaceArriba: y(s),
      };
    })())`),
  );

/**
 * Cuántos rectángulos da un rango sobre cada palabra de los elementos que elige el selector: una palabra partida
 * entre dos renglones da dos. Devuelve las palabras partidas, como «Valeria (2)». El texto se recorre nodo por
 * nodo, así que vale aunque el elemento tenga hijos.
 */
const PALABRAS_PARTIDAS = (selector) => `(() => {
  const partidas = [];
  const rg = document.createRange();
  for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
    const paseo = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (paseo.nextNode()) {
      const n = paseo.currentNode;
      for (const m of n.textContent.matchAll(/\\S+/g)) {
        rg.setStart(n, m.index);
        rg.setEnd(n, m.index + m[0].length);
        const rects = [...rg.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (rects.length !== 1) partidas.push(m[0] + ' (' + rects.length + ')');
      }
    }
  }
  return partidas;
})()`;

/** Pone la ventana del celular en otro ancho, con el alto de siempre, y espera a que la página se acomode. */
async function anchoDeCelular(page, vista, ancho) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: true, screenWidth: ancho, screenHeight: vista.alto });
  await sleep(700);
}

/**
 * La lista del orden de turnos a un ancho: palabras partidas en los nombres, cómo queda cada «Avisarle» (oculto,
 * cortado, más bajo que 44 px o partido en dos renglones) y si el del nombre corto va en el mismo renglón que el nombre.
 */
const medirListaDeTurnos = async (page, corto) =>
  JSON.parse(
    await page.eval(`JSON.stringify((() => {
      const filas = [...document.querySelectorAll('#winner-cards .winner-turnos .winner-fila')];
      const partidas = ${PALABRAS_PARTIDAS("#winner-cards .winner-turnos .winner-name")};
      const avisarMal = [];
      // Lo que se rompe sin hacer desplazar la página (la caja recorta lo que desborda): un nombre que se sale de su
      // caja, un nombre que se mete debajo de «Avisarle» y una fila que pasa el borde de la caja del resultado.
      const desbordan = [];
      const tapados = [];
      const fuera = [];
      // La regla de cada fila: «Avisarle» al lado solo si el nombre entero entra, y un nombre que entra en un
      // renglón al lado del número no se parte. Lo que la incumple son filas de formas distintas en la misma lista.
      const partidosSinNecesidad = [];
      const abajoSinNecesidad = [];
      // El nombre empieza en el renglón de su número, en todas las filas: si baja debajo del número, la fila tiene otra forma.
      const bajoElNumero = [];
      const caja = document.getElementById('winner-box');
      const cr = caja ? caja.getBoundingClientRect() : null;
      const rectsDe = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return [...rg.getClientRects()].filter((x) => x.width > 0 && x.height > 0); };
      let altoMin = Infinity;
      let mismoRenglonCorto = null;
      for (const f of filas) {
        const nombre = f.querySelector('.winner-name');
        const a = f.querySelector('.turno-avisar');
        const quien = nombre ? nombre.textContent.trim() : '?';
        const fr0 = f.getBoundingClientRect();
        if (cr && (fr0.right > cr.right + 1 || fr0.left < cr.left - 1)) fuera.push(quien);
        if (nombre && nombre.scrollWidth > nombre.clientWidth + 1) desbordan.push(quien);
        const num0 = f.querySelector('.winner-num');
        if (nombre && num0 && nombre.getBoundingClientRect().top >= num0.getBoundingClientRect().bottom) bajoElNumero.push(quien);
        if (!a) { avisarMal.push(quien + ': no hay boton'); continue; }
        if (a.hidden || getComputedStyle(a).display === 'none') { avisarMal.push(quien + ': oculto'); continue; }
        const r = a.getBoundingClientRect();
        const fr = f.getBoundingClientRect();
        if (nombre) {
          if (rectsDe(nombre).some((x) => x.left < r.right - 1 && x.right > r.left + 1 && x.top < r.bottom - 1 && x.bottom > r.top + 1)) tapados.push(quien);
          const cs = getComputedStyle(f);
          const gap = parseFloat(cs.columnGap) || 0;
          const num = f.querySelector('.winner-num');
          // Lo que le queda al nombre al lado del número: lo que deja el número, y como mucho el tope del nombre tal como
          // lo resuelve la página (src/styles.css), medido y no supuesto: se le pide un ancho enorme y se mira hasta dónde llega.
          const contenido = f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const anchoAntes = nombre.style.width;
          nombre.style.width = '100000px';
          const tope = nombre.getBoundingClientRect().width;
          nombre.style.width = anchoAntes;
          const libre = Math.min(contenido - (num ? num.getBoundingClientRect().width + gap : 0), tope);
          const medida = document.createElement('span');
          medida.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap';
          medida.style.font = getComputedStyle(nombre).font;
          medida.style.letterSpacing = getComputedStyle(nombre).letterSpacing;
          medida.textContent = nombre.textContent;
          document.body.appendChild(medida);
          const entero = medida.getBoundingClientRect().width;
          medida.remove();
          const renglones = new Set(rectsDe(nombre).map((x) => Math.round(x.top))).size;
          if (renglones > 1 && entero <= libre - 1) partidosSinNecesidad.push(quien);
          const nr0 = nombre.getBoundingClientRect();
          const alLado = r.top < nr0.bottom && r.bottom > nr0.top;
          if (!alLado && entero + gap + r.width <= libre - 1) abajoSinNecesidad.push(quien);
        }
        altoMin = Math.min(altoMin, r.height);
        if (r.height < 43.5) avisarMal.push(quien + ': ' + Math.round(r.height) + ' px de alto');
        if (a.scrollWidth > a.clientWidth + 1 || r.left < fr.left - 1 || r.right > fr.right + 1 || r.right > innerWidth) avisarMal.push(quien + ': cortado');
        const rg = document.createRange();
        rg.selectNodeContents(a);
        const tops = new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
        if (tops.size > 1) avisarMal.push(quien + ': en ' + tops.size + ' renglones');
        if (quien === ${JSON.stringify(corto)} && nombre) {
          const nr = nombre.getBoundingClientRect();
          mismoRenglonCorto = r.top < nr.bottom && r.bottom > nr.top;
        }
      }
      const ol = document.querySelector('#winner-cards ol.winner-turnos');
      if (ol) { ol.scrollIntoView({ block: 'start' }); scrollBy(0, -90); }
      return {
        bajoElNumero,
        filas: filas.length,
        partidas,
        avisarMal,
        altoMin: Number.isFinite(altoMin) ? Math.round(altoMin) : 0,
        mismoRenglonCorto,
        desbordan,
        tapados,
        fuera,
        partidosSinNecesidad,
        abajoSinNecesidad,
        scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })())`),
  );

/**
 * El botón «Mostrar la lista en grande» en el paso de la lista, a 320 px, en el idioma que se pide: que se vea
 * entero, sin salirse de la ventana ni cortarse, sin palabras partidas, y con el texto de ese idioma.
 */
async function botonDeLaListaA320(page, vista, tema, lang, quien) {
  await page.eval(`document.getElementById('l-${lang}').click(); true`);
  await sleep(700);
  await anchoDeCelular(page, vista, 320);
  const m = JSON.parse(
    await page.eval(`JSON.stringify((() => {
      const b = document.getElementById('btn-sala');
      if (!b) return { falta: true };
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      return {
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
        texto: b.textContent.trim(),
        dentro: r.left >= -0.5 && r.right <= innerWidth + 0.5,
        sinCorte: b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1,
        alto: Math.round(r.height),
        partidas: ${PALABRAS_PARTIDAS("#btn-sala")},
        scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })())`),
  );
  await sleep(300);
  await page.screenshot(join(outDir, `a-boton-lista-320-${lang}-${tema}.png`));
  const textoEsperado = lang === "es" ? /^Mostrar la lista en grande$/ : /^Show the list on the big screen$/;
  check(
    `${quien}: a 320 px en ${lang} el botón de la lista se ve entero`,
    !m.falta && m.visible && textoEsperado.test(m.texto) && m.dentro && m.sinCorte && m.partidas.length === 0 && m.alto >= 44 && m.scrollX <= 1,
    m.falta ? "no esta" : `"${m.texto}" ${m.alto}px de alto${m.dentro ? "" : ", se sale de la ventana"}${m.sinCorte ? "" : ", cortado"}${m.partidas.length ? `, partidas: ${m.partidas.join(", ")}` : ""}${m.scrollX > 1 ? `, scroll ${m.scrollX}px` : ""}`,
  );
}

/**
 * Abre el comprobante de un sorteo común agregándole un modo en la dirección: la página tiene que seguir
 * mostrándolo como un sorteo común, porque el parámetro por sí solo no cambia lo que se selló.
 */
async function abrirComunConModo(browser, vista, enlace, modo, quien) {
  const url = new URL(enlace, base);
  url.searchParams.set("modo", modo);
  const ver = await browser.open("about:blank");
  try {
    await ver.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await ver.send("Page.navigate", { url: url.toString() });
    await ver.waitFor("document.readyState === 'complete'", 20000);
    const veredicto = await esperarVeredicto(ver);
    check(`${quien}: con ?modo=${modo} la verificación mostró su veredicto`, !!veredicto, `"${veredicto}"`);
    const datos = JSON.parse(
      await ver.eval(`JSON.stringify({
        titulo: (document.getElementById('v-result-t') || {}).textContent || '',
        comprobaciones: (document.getElementById('checks') || {}).textContent || '',
        tarjetas: document.querySelectorAll('#v-winners .winner-card').length,
        filasTurnos: document.querySelectorAll('#v-winners .winner-fila').length,
        cuenta: (document.getElementById('v-count') || {}).textContent || '',
        renglones: document.querySelectorAll('#v-names i').length,
      })`),
    );
    check(
      `${quien}: con ?modo=${modo} un sorteo común se muestra como sorteo común`,
      /Quién ganó|Who won/.test(datos.titulo) && /El ganador, calculado de nuevo|The winner, worked out again/.test(datos.comprobaciones) && datos.tarjetas > 0 && datos.filasTurnos === 0,
      `"${datos.titulo}" / ${datos.tarjetas} tarjetas / ${datos.filasTurnos} turnos`,
    );
    return datos;
  } finally {
    await ver.send("Page.close").catch(() => {});
  }
}

/** Lo que dicen las cuentas de la pantalla: junto al cuadro, el resumen y la barra de lo que sigue. */
const leerCuentas = async (page) =>
  JSON.parse(
    await page.eval(
      "JSON.stringify({ cuadro: (document.getElementById('lista-cuenta') || {}).textContent || '', resumen: (document.getElementById('sellar-resumen') || {}).textContent || '', barra: (document.getElementById('sig-paso') || {}).textContent || '' })",
    ),
  );

/** Los numeros de personas y de lineas que dice cada cuenta: tienen que ser los mismos en las tres. */
function numerosDeCuenta(texto) {
  const personas = /(\d+)\s*personas?/i.exec(texto);
  const lineas = /(\d+)\s*(turnos|participaciones|entries|turns)/i.exec(texto);
  return { personas: personas ? personas[1] : null, lineas: lineas ? lineas[1] : null };
}

function checkCuentasCoinciden(quien, cuentas) {
  const vistas = [cuentas.cuadro, cuentas.resumen, cuentas.barra].filter((t) => t.trim());
  const pares = vistas.map(numerosDeCuenta);
  const personas = new Set(pares.map((p) => p.personas));
  const lineas = new Set(pares.map((p) => p.lineas).filter(Boolean));
  check(
    `${quien}: las cuentas de la pantalla coinciden entre si`,
    vistas.length > 0 && personas.size <= 1 && lineas.size <= 1,
    vistas.map((t) => `"${t.trim().slice(0, 60)}"`).join(" / "),
  );
}

/** El enlace de verificacion de ese sorteo: el que lleva el mensaje del resultado (#btn-whatsapp o #btn-email). */
async function enlaceDeVerificacion(page) {
  const hrefs = JSON.parse(
    await page.eval("JSON.stringify([(document.getElementById('btn-whatsapp') || {}).href || '', (document.getElementById('btn-email') || {}).href || ''])"),
  );
  for (const href of hrefs) {
    const decodificado = decodeURIComponent(href);
    const m = /(https?:\/\/[^\s"']*verificar\.html(?:\?[^\s"']*)?#[^\s"']*)/.exec(decodificado);
    if (m) return m[1];
    const corto = /(https?:\/\/[^\s"']*\/c\/[0-9A-Za-z]{8}#[A-Za-z0-9_-]{22})/.exec(decodificado);
    if (corto) return corto[1];
  }
  return "";
}

const esEnlaceDeVerificacion = (enlace) => /verificar\.html(?:\?[^#]*)?#|\/c\/[0-9A-Za-z]{8}#[A-Za-z0-9_-]{22}/.test(enlace);

/** El enlace de verificación con el tema de la corrida: sin él, la página abre en el tema de siempre y la captura «-dark» sale clara. */
function conTema(enlace, tema) {
  const u = new URL(enlace, base);
  u.searchParams.set("theme", tema);
  return u.toString();
}

/** Los nombres del resultado, en el orden en que se ven, y el titulo de la lista. */
const leerResultado = async (page) =>
  JSON.parse(
    await page.eval(`JSON.stringify({
      titulo: (document.querySelector('#winner-lista-t') || {}).textContent || '',
      filas: [...document.querySelectorAll('#winner-cards .winner-fila')].length,
      nombres: [...document.querySelectorAll('#winner-cards .winner-name')].map((el) => el.textContent.trim()),
      turnos: [...document.querySelectorAll('#winner-cards .winner-num')].map((el) => el.textContent.trim()),
      copiar: [...document.querySelectorAll('#winner-cards [data-copiar-orden]')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => b.textContent.trim()),
      tarjetas: document.querySelectorAll('#winner-cards .winner-card').length,
      caja: (document.getElementById('winner-box') || {}).textContent || '',
    })`),
  );

// Un nombre largo y uno corto entre doce: con el largo, «Avisarle» tiene que bajar a su renglón en los celulares
// angostos sin partir ninguna palabra y la pantalla grande no puede achicar la lista entera; con el corto, «Avisarle»
// va en el mismo renglón.
const NOMBRE_LARGO = "María Fernanda Rodríguez López";
const NOMBRE_CORTO = "Ana";
const NOMBRES_A = [
  NOMBRE_CORTO, "Beto Mamani", "Carla Flores", "Diego Rojas", "Elena Condori", "Fabian Torrez",
  NOMBRE_LARGO, "Gabriel Choque", "Hilda Vargas", "Iván Mendoza", "Julia Paz", "Kevin Ortiz",
];
const N_A = NOMBRES_A.length;
const ANCHOS_DE_CELULAR = [320, 360, 390, 412];

/** Caso A: orden de turnos con doce nombres, uno largo y uno corto. */
async function casoA(browser, vista, tema, ctx) {
  const quien = `A ${vista.etiqueta} ${tema}`;
  console.log(`\n  ${quien} - orden de turnos con doce nombres, uno largo y uno corto`);
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await page.send("Page.navigate", { url: `${base}/?modo=turnos&instant=1&pace=rapido&theme=${tema}&lang=es&red=prueba#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await conectarCuentaDePrueba(page);

    const n = await escribirLista(page, NOMBRES_A.join("\n"));
    check(`${quien}: la lista quedo con los ${N_A} nombres`, n === N_A, `${n} nombres`);
    const modo = await page.eval("document.getElementById('btn-turnos')?.getAttribute('aria-pressed')");
    check(`${quien}: Orden de turnos quedo elegido con ?modo=turnos`, modo === "true", `aria-pressed=${modo}`);
    const nw = await page.eval("document.getElementById('nw').value");
    check(`${quien}: la cantidad de turnos sigue a la lista`, nw === String(N_A), `cuantos ganan: ${nw}`);
    const cuentas = await leerCuentas(page);
    check(`${quien}: el resumen dice turnos del 1 al ${N_A}`, new RegExp(`turnos del 1 al ${N_A}\\b`, "i").test(cuentas.resumen), cuentas.resumen.slice(0, 80));
    checkCuentasCoinciden(quien, cuentas);
    check(`${quien}: sin scroll horizontal antes de sellar`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    checkSinGanador(quien, await palabraProhibida(page));
    await page.screenshot(join(outDir, `a-lista-${vista.etiqueta}-${tema}.png`));
    if (vista.movil) {
      // El botón de la lista a 320 px, en los dos idiomas; después vuelve al español y al ancho de la vista.
      await botonDeLaListaA320(page, vista, tema, "es", quien);
      await botonDeLaListaA320(page, vista, tema, "en", quien);
      await page.eval("document.getElementById('l-es').click(); true");
      await sleep(700);
      await anchoDeCelular(page, vista, vista.ancho);
      await page.eval("scrollTo(0, 0); true");
    }

    await sellar(page);
    await quieto(page);
    check(`${quien}: sin scroll horizontal en la espera`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `a-sellada-${vista.etiqueta}-${tema}.png`));

    await sortear(page);
    const res = await leerResultado(page);
    check(`${quien}: el titulo habla del orden de los turnos`, /El orden de los turnos|The turn order/.test(res.titulo), `"${res.titulo}"`);
    const todos = res.nombres.length === N_A && NOMBRES_A.every((x) => res.nombres.includes(x));
    check(`${quien}: estan los ${N_A} en orden`, res.filas === N_A && todos, res.nombres.join(" / "));
    const turnosBien = res.turnos.length === N_A && res.turnos.every((t, k) => new RegExp(`\\b${k + 1}\\b`).test(t));
    check(`${quien}: cada renglon dice su turno`, turnosBien, res.turnos.join(" / "));
    check(`${quien}: existe Copiar el orden`, res.copiar.some((t) => /Copiar el orden|Copy the order/.test(t)), res.copiar.join(" / ") || "no esta");
    checkSinGanador(quien, await palabraProhibida(page));
    check(`${quien}: sin scroll horizontal en el resultado`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `a-resultado-${vista.etiqueta}-${tema}.png`));

    if (vista.movil) {
      // La lista de turnos en cuatro celulares: ninguna palabra partida, «Avisarle» entero y de 44 px o más, sin
      // scroll a lo ancho, y con el nombre corto en 390 y 412 px «Avisarle» en su mismo renglón. Una captura por ancho.
      for (const ancho of ANCHOS_DE_CELULAR) {
        await anchoDeCelular(page, vista, ancho);
        const m = await medirListaDeTurnos(page, NOMBRE_CORTO);
        await sleep(300);
        await page.screenshot(join(outDir, `a-turnos-${ancho}-${tema}.png`));
        check(`${quien} ${ancho}px: ninguna palabra de un nombre queda partida`, m.filas === N_A && m.partidas.length === 0, m.filas === N_A ? m.partidas.join(", ") || "ninguna" : `${m.filas} renglones`);
        check(`${quien} ${ancho}px: «Avisarle» entero y de 44 px de alto o mas`, m.filas === N_A && m.avisarMal.length === 0 && m.altoMin >= 44, m.avisarMal.slice(0, 3).join(" / ") || `el mas bajo mide ${m.altoMin}px`);
        check(`${quien} ${ancho}px: sin scroll horizontal en la lista de turnos`, m.scrollX <= 1, `${m.scrollX}px`);
        // La caja del resultado recorta lo que desborda, así que el scroll de la página no lo ve: se mide fila por fila.
        const rotos = [...m.desbordan.map((x) => `${x}: se sale`), ...m.tapados.map((x) => `${x}: debajo de «Avisarle»`), ...m.fuera.map((x) => `${x}: pasa la caja`)];
        check(`${quien} ${ancho}px: ningun nombre se sale ni se mete debajo de «Avisarle», y ninguna fila pasa la caja`, m.filas === N_A && rotos.length === 0, rotos.slice(0, 3).join(" / ") || "bien");
        const fueraDeRegla = [...m.partidosSinNecesidad.map((x) => `${x}: partido y entraba`), ...m.abajoSinNecesidad.map((x) => `${x}: «Avisarle» abajo y entraba`)];
        check(`${quien} ${ancho}px: cada fila sigue la misma regla («Avisarle» al lado solo si el nombre entero entra)`, m.filas === N_A && fueraDeRegla.length === 0, fueraDeRegla.slice(0, 3).join(" / ") || "todas");
        check(`${quien} ${ancho}px: en todas las filas el nombre empieza en el renglon de su numero`, m.filas === N_A && m.bajoElNumero.length === 0, m.bajoElNumero.slice(0, 3).map((x) => `${x}: debajo del numero`).join(" / ") || "todas");
        // El final de la lista, del «Turno 10» en adelante: las filas de dos cifras son las que más ocupan.
        await page.eval("(() => { const fs = document.querySelectorAll('#winner-cards .winner-turnos .winner-fila'); const u = fs[fs.length - 1]; if (u) u.scrollIntoView({ block: 'center' }); return true; })()");
        await sleep(300);
        await page.screenshot(join(outDir, `a-turnos-${ancho}-${tema}-fin.png`));
        if (ancho >= 390) {
          check(`${quien} ${ancho}px: con el nombre corto, «Avisarle» va en su mismo renglon`, m.mismoRenglonCorto === true, String(m.mismoRenglonCorto));
        }
      }
      await anchoDeCelular(page, vista, vista.ancho);
      await page.eval("scrollTo(0, 0); true");
    }

    const grande = await page.eval("(() => { const b = document.getElementById('btn-grande'); return !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })()");
    if (grande) {
      await page.eval("document.getElementById('btn-grande').click(); true");
      const abrio = await page.waitFor("document.querySelector('.pantalla')", 15000);
      check(`${quien}: Mostrar en grande se abre`, abrio.ok);
      if (abrio.ok) {
        const qr = await page.waitFor("document.querySelector('.pantalla-qr img[src], .pantalla-qr canvas, .pantalla-qr svg') && !document.querySelector('.pantalla .pantalla-cargando, .pantalla [data-cargando]')", 15000);
        check(`${quien}: Mostrar en grande trae el codigo QR`, qr.ok);
        await sleep(500);
        await page.screenshot(join(outDir, `a-grande-${vista.etiqueta}-${tema}.png`));
        if (vista.movil) {
          // Con el nombre largo entre doce turnos, la letra de la lista no baja de 22 px: ese nombre se parte por sus
          // espacios antes que achicar a todos. Ninguna palabra queda partida a la mitad.
          const g = JSON.parse(
            await page.eval(`JSON.stringify((() => {
              const ns = [...document.querySelectorAll('.pantalla .pantalla-lista .pantalla-nombre')];
              const largo = ns.find((e) => e.textContent.trim() === ${JSON.stringify(NOMBRE_LARGO)});
              if (largo) largo.scrollIntoView({ block: 'center' });
              const letras = ns.map((e) => parseFloat(getComputedStyle(e).fontSize));
              // En la pantalla grande una palabra no se parte (overflow-wrap: normal): lo que puede salir mal es que se
              // salga de su caja, o que la lista quede más ancha que la pantalla.
              const cuerpo = document.querySelector('.pantalla .pantalla-body');
              const lista = document.querySelector('.pantalla .pantalla-ganadores');
              const rg = document.createRange();
              const renglones = (e) => { rg.selectNodeContents(e); return new Set([...rg.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size; };
              return {
                n: ns.length,
                largo: !!largo,
                letraMin: letras.length ? Math.min(...letras) : 0,
                desbordan: ns.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()),
                anchoDeMas: cuerpo && lista ? Math.round(lista.getBoundingClientRect().width - cuerpo.clientWidth) : 0,
                // Los nombres de dos palabras cortas van en un renglón: solo el largo se parte por sus espacios.
                partidosCortos: ns.filter((e) => e !== largo && renglones(e) > 1).map((e) => e.textContent.trim()),
              };
            })())`),
          );
          await sleep(400);
          await page.screenshot(join(outDir, `a-grande-largo-${vista.etiqueta}-${tema}.png`));
          check(
            `${quien}: en Mostrar en grande, con el nombre largo, la letra de la lista no baja de 22 px`,
            g.n === N_A && g.largo && g.letraMin >= 21.5,
            `${g.n} nombres, letra ${g.letraMin}px${g.largo ? "" : ", no esta el nombre largo"}`,
          );
          check(
            `${quien}: en Mostrar en grande ningun nombre se sale de su caja ni la lista de la pantalla`,
            g.n === N_A && g.desbordan.length === 0 && g.anchoDeMas <= 1,
            [g.desbordan.join(", "), g.anchoDeMas > 1 ? `la lista mide ${g.anchoDeMas}px de mas` : ""].filter(Boolean).join(" / ") || "ninguno",
          );
          check(`${quien}: en Mostrar en grande, con el nombre largo, solo ese nombre se parte`, g.n === N_A && g.partidosCortos.length === 0, g.partidosCortos.join(", ") || "solo el largo");
        }
        await page.eval("document.querySelector('.pantalla [data-cerrar]')?.click(); true");
        await page.waitFor("!document.querySelector('.pantalla')", 8000);
      }
    } else {
      check(`${quien}: Mostrar en grande se abre`, false, "no se ve el boton");
    }

    const enlace = await enlaceDeVerificacion(page);
    check(`${quien}: el resultado trae el enlace de verificacion`, esEnlaceDeVerificacion(enlace), enlace.slice(0, 60));
    const nombresResultado = res.nombres;
    await page.send("Page.close").catch(() => {});
    if (!esEnlaceDeVerificacion(enlace)) {
      check(`${quien}: la verificacion muestra el orden como orden`, false, "sin enlace no hay pagina que abrir");
      return;
    }
    const ver = await browser.open("about:blank");
    try {
      await ver.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
      await ver.send("Page.navigate", { url: conTema(enlace, tema) });
      await ver.waitFor("document.readyState === 'complete'", 20000);
      const veredicto = await esperarVeredicto(ver);
      check(`${quien}: la verificacion mostro su veredicto`, !!veredicto, `"${veredicto}"`);
      const titulo = String(await ver.eval("(document.getElementById('v-result-t') || {}).textContent || ''"));
      check(`${quien}: la verificacion muestra el orden como orden`, /El orden de los turnos|The turn order/.test(titulo), `"${titulo}"`);
      const vNombres = JSON.parse(await ver.eval("JSON.stringify([...document.querySelectorAll('#v-winners .winner-name')].map((el) => el.textContent.trim()))"));
      const mismoOrden = vNombres.length === N_A && vNombres.every((x, k) => x === nombresResultado[k]);
      check(`${quien}: la verificacion trae los ${N_A} en el mismo orden`, mismoOrden, vNombres.join(" / "));
      await ver.screenshot(join(outDir, `a-verificacion-${vista.etiqueta}-${tema}.png`));
      check(`${quien}: la verificacion no trae excepciones`, ver.exceptions.length === 0, ver.exceptions.slice(0, 2).join(" | "));
    } finally {
      await ver.send("Page.close").catch(() => {});
    }
    check(`${quien}: sin excepciones de la pagina`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
  } catch (e) {
    if (e?.codigo === "sello") throw e;
    check(`${quien}: el recorrido llego hasta el final`, false, String(e?.message ?? e).slice(0, 140));
    await page.screenshot(join(outDir, `a-falla-${vista.etiqueta}-${tema}.png`)).catch(() => {});
    await page.send("Page.close").catch(() => {});
  }
}

/** Caso B: repartir participaciones y despues elegir el orden de turnos. */
async function casoB(browser, vista, tema, ctx) {
  const quien = `B ${vista.etiqueta} ${tema}`;
  console.log(`\n  ${quien} - repartir y ordenar`);
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await page.send("Page.navigate", { url: `${base}/?modo=varias&instant=1&pace=rapido&theme=${tema}&lang=es&red=prueba#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await conectarCuentaDePrueba(page);

    await escribirLista(page, "Ana Quispe, 2\nBeto Rojas\nCarla Suarez, 2");
    await repartir(page);
    const lineas = Number(await page.eval("document.getElementById('ta').value.split('\\n').filter((s) => s.trim()).length"));
    check(`${quien}: el reparto dejo cinco lineas`, lineas === 5, `${lineas} lineas`);
    await page.screenshot(join(outDir, `b-repartida-${vista.etiqueta}-${tema}.png`));

    await elegirTurnos(page);
    const cuentas = await leerCuentas(page);
    const dicePersonasYTurnos = [cuentas.cuadro, cuentas.resumen, cuentas.barra].filter((t) => /3 personas/i.test(t) && /5 turnos/i.test(t));
    check(`${quien}: todas las cuentas dicen 3 personas, 5 turnos`, dicePersonasYTurnos.length >= 2, [cuentas.cuadro, cuentas.resumen, cuentas.barra].map((t) => `"${t.trim().slice(0, 50)}"`).join(" / "));
    check(`${quien}: el resumen dice turnos del 1 al 5`, /turnos del 1 al 5/i.test(cuentas.resumen), cuentas.resumen.slice(0, 80));
    checkCuentasCoinciden(quien, cuentas);
    checkSinGanador(quien, await palabraProhibida(page));
    check(`${quien}: sin scroll horizontal antes de sellar`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `b-modo-${vista.etiqueta}-${tema}.png`));

    await sellar(page);
    await quieto(page);
    await page.screenshot(join(outDir, `b-sellada-${vista.etiqueta}-${tema}.png`));

    await sortear(page);
    const res = await leerResultado(page);
    check(`${quien}: el titulo habla del orden de los turnos`, /El orden de los turnos|The turn order/.test(res.titulo), `"${res.titulo}"`);
    check(`${quien}: estan los cinco en orden`, res.filas === 5 && res.nombres.length === 5, res.nombres.join(" / "));
    check(`${quien}: existe Copiar el orden`, res.copiar.some((t) => /Copiar el orden|Copy the order/.test(t)), res.copiar.join(" / ") || "no esta");
    checkSinGanador(quien, await palabraProhibida(page));
    check(`${quien}: sin scroll horizontal en el resultado`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `b-resultado-${vista.etiqueta}-${tema}.png`));
    const enlace = await enlaceDeVerificacion(page);
    check(`${quien}: el resultado trae el enlace de verificacion`, esEnlaceDeVerificacion(enlace), enlace.slice(0, 60));
    check(`${quien}: sin excepciones de la pagina`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
    await page.send("Page.close").catch(() => {});
    if (!esEnlaceDeVerificacion(enlace)) {
      check(`${quien}: la verificacion cuenta lo mismo que la herramienta`, false, "sin enlace no hay pagina que abrir");
      return;
    }
    // Quien escanea el codigo lee lo mismo que se anuncio: el enlace de un orden lleva solo ?modo=turnos, y aun asi la
    // verificacion cuenta por persona (3 personas, 5 participaciones) y no muestra el sufijo de cada linea.
    const ver = await browser.open("about:blank");
    try {
      await ver.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
      await ver.send("Page.navigate", { url: conTema(enlace, tema) });
      await ver.waitFor("document.readyState === 'complete'", 20000);
      const veredicto = await esperarVeredicto(ver);
      check(`${quien}: la verificacion mostro su veredicto`, !!veredicto, `"${veredicto}"`);
      const titulo = String(await ver.eval("(document.getElementById('v-result-t') || {}).textContent || ''"));
      check(`${quien}: la verificacion muestra el orden como orden`, /El orden de los turnos|The turn order/.test(titulo), `"${titulo}"`);
      const cuenta = String(await ver.eval("(document.getElementById('v-count') || {}).textContent || ''"));
      check(
        `${quien}: la verificacion dice 3 personas y 5 participaciones`,
        /3\s*personas|3\s*people/i.test(cuenta) && /5\s*(participaciones|entries)/i.test(cuenta) && !/5\s*participantes/i.test(cuenta),
        `"${cuenta}"`,
      );
      const vNombres = JSON.parse(await ver.eval("JSON.stringify([...document.querySelectorAll('#v-winners .winner-name')].map((el) => el.textContent.trim()))"));
      check(`${quien}: la verificacion trae los cinco turnos sin el sufijo de cada linea`, vNombres.length === 5 && !vNombres.some((x) => /\(\d+\/\d+\)/.test(x)), vNombres.join(" / "));
      const mismoOrden = vNombres.length === res.nombres.length && vNombres.every((x, k) => x === res.nombres[k]);
      check(`${quien}: la verificacion trae los cinco en el mismo orden que la herramienta`, mismoOrden, vNombres.join(" / "));
      await ver.screenshot(join(outDir, `b-verificacion-${vista.etiqueta}-${tema}.png`));
      check(`${quien}: la verificacion no trae excepciones`, ver.exceptions.length === 0, ver.exceptions.slice(0, 2).join(" | "));
    } finally {
      await ver.send("Page.close").catch(() => {});
    }
  } catch (e) {
    if (e?.codigo === "sello") throw e;
    check(`${quien}: el recorrido llego hasta el final`, false, String(e?.message ?? e).slice(0, 140));
    await page.screenshot(join(outDir, `b-falla-${vista.etiqueta}-${tema}.png`)).catch(() => {});
    await page.send("Page.close").catch(() => {});
  }
}

/** Caso C: varias participaciones con tres ganadores. */
async function casoC(browser, vista, tema, ctx) {
  const quien = `C ${vista.etiqueta} ${tema}`;
  console.log(`\n  ${quien} - varias participaciones con tres ganadores`);
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await page.send("Page.navigate", { url: `${base}/?modo=varias&instant=1&pace=rapido&theme=${tema}&lang=es&red=prueba#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await conectarCuentaDePrueba(page);

    await escribirLista(page, "Ana Quispe, 3\nBeto Rojas\nCarla Suarez, 2\nDana Flores");
    await repartir(page);
    const cuentas = await leerCuentas(page);
    const dice = [cuentas.cuadro, cuentas.resumen, cuentas.barra].filter((t) => /4 personas/i.test(t) && /7 participaciones/i.test(t));
    check(`${quien}: la cuenta dice 4 personas, 7 participaciones`, dice.length >= 2, [cuentas.cuadro, cuentas.resumen].map((t) => `"${t.trim().slice(0, 60)}"`).join(" / "));
    checkCuentasCoinciden(quien, cuentas);
    if (vista.movil) {
      const barraC = await barraEntra(page);
      check(`${quien}: la frase de la barra entra en su caja`, barraC === "entra", barraC);
    }
    await page.screenshot(join(outDir, `c-repartida-${vista.etiqueta}-${tema}.png`));

    await ponerGanadores(page, 3);
    const nw = await page.eval("document.getElementById('nw').value");
    check(`${quien}: quedaron tres ganadores`, nw === "3", `cuantos ganan: ${nw}`);

    await sellar(page);
    await quieto(page);
    await page.screenshot(join(outDir, `c-sellada-${vista.etiqueta}-${tema}.png`));
    const cabezaC = String(await page.eval("(document.getElementById('rec-head') || {}).textContent || ''"));
    check(`${quien}: la cabecera del selector cuenta 4 personas, no 7`, /4 personas/i.test(cabezaC) && !/7 personas/i.test(cabezaC), cabezaC.trim().slice(0, 80));

    await sortear(page);
    const res = await leerResultado(page);
    check(`${quien}: salieron tres ganadores`, res.nombres.length === 3, res.nombres.join(" / "));
    check(`${quien}: ninguna tarjeta ni fila trae la marca de la linea sellada`, sinMarcaDeLinea(res.nombres), res.nombres.join(" / "));
    // Los renglones traen la linea sellada con su sufijo («Ana Quispe (2/3)»): se cuenta por persona, y el aviso es el
    // que escribe la app, con tilde («salió 2 veces»). Con esta lista alguien repite en casi la mitad de los sorteos;
    // si en esta corrida nadie repitio, solo se comprueba que no se invente un aviso.
    const repeticion = evaluarRepetidos(res.nombres, res.caja);
    check(
      repeticion.hayRepetidos ? `${quien}: el resultado dice quien salio mas de una vez y cuantas veces` : `${quien}: nadie repitio, el resultado no inventa repetidos`,
      repeticion.ok,
      repeticion.detalle,
    );
    check(`${quien}: sin scroll horizontal en el resultado`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `c-resultado-${vista.etiqueta}-${tema}.png`));

    const enlace = await enlaceDeVerificacion(page);
    check(`${quien}: el resultado trae el enlace de verificacion`, esEnlaceDeVerificacion(enlace), enlace.slice(0, 60));
    await page.send("Page.close").catch(() => {});
    if (!esEnlaceDeVerificacion(enlace)) {
      check(`${quien}: la verificacion muestra la lista sellada`, false, "sin enlace no hay pagina que abrir");
      return;
    }
    const ver = await browser.open("about:blank");
    try {
      await ver.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
      await ver.send("Page.navigate", { url: conTema(enlace, tema) });
      await ver.waitFor("document.readyState === 'complete'", 20000);
      const veredicto = await esperarVeredicto(ver);
      check(`${quien}: la verificacion mostro su veredicto`, !!veredicto, `"${veredicto}"`);
      const cuenta = String(await ver.eval("(document.getElementById('v-count') || {}).textContent || ''"));
      check(`${quien}: la verificacion dice 4 personas y 7 participaciones`, /4\s*personas/i.test(cuenta) && /7\s*participaciones|7\s*entries/i.test(cuenta), `"${cuenta}"`);
      const grupos = Number(await ver.eval("document.querySelectorAll('#v-names i').length"));
      check(`${quien}: la lista sale agrupada por persona`, grupos === 4, `${grupos} renglones`);
      const texto = String(await ver.eval("(document.getElementById('v-names') || {}).textContent || ''"));
      check(
        `${quien}: cada persona junta sus participaciones`,
        /Ana Quispe/i.test(texto) && /3\s*participaciones|3\s*entries/i.test(texto) && /Carla Suarez/i.test(texto) && /2\s*participaciones|2\s*entries/i.test(texto),
        texto.slice(0, 120),
      );
      await ver.screenshot(join(outDir, `c-verificacion-${vista.etiqueta}-${tema}.png`));
      check(`${quien}: la verificacion no trae excepciones`, ver.exceptions.length === 0, ver.exceptions.slice(0, 2).join(" | "));
    } finally {
      await ver.send("Page.close").catch(() => {});
    }
    await abrirComunConModo(browser, vista, enlace, "turnos", quien);
    const sinModoUrl = new URL(enlace, base);
    sinModoUrl.searchParams.delete("modo");
    const verSin = await browser.open("about:blank");
    try {
      await verSin.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
      await verSin.send("Page.navigate", { url: sinModoUrl.toString() });
      await verSin.waitFor("document.readyState === 'complete'", 20000);
      const veredictoSin = await esperarVeredicto(verSin);
      check(`${quien}: sin el parametro la verificacion mostro su veredicto`, !!veredictoSin, `"${veredictoSin}"`);
      const cuentaSin = String(await verSin.eval("(document.getElementById('v-count') || {}).textContent || ''"));
      // Con la bandera de construccion (--bandera) los modos estan a la vista sin parametro y la lista sale agrupada.
      const esperado = esperadoSinElParametro(conBandera);
      check(
        conBandera ? `${quien}: sin el parametro, con la bandera, la lista sale agrupada por persona` : `${quien}: sin el parametro la lista sale linea por linea`,
        esperado.cuenta.test(cuentaSin),
        `"${cuentaSin}" (se esperaba ${esperado.cuentaDetalle})`,
      );
      const renglonesSin = Number(await verSin.eval("document.querySelectorAll('#v-names i').length"));
      check(`${quien}: sin el parametro hay ${esperado.renglones} renglones`, renglonesSin === esperado.renglones, `${renglonesSin} renglones`);
    } finally {
      await verSin.send("Page.close").catch(() => {});
    }
    check(`${quien}: sin excepciones de la pagina`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
  } catch (e) {
    if (e?.codigo === "sello") throw e;
    check(`${quien}: el recorrido llego hasta el final`, false, String(e?.message ?? e).slice(0, 140));
    await page.screenshot(join(outDir, `c-falla-${vista.etiqueta}-${tema}.png`)).catch(() => {});
    await page.send("Page.close").catch(() => {});
  }
}

/** Caso D: varias participaciones puestas tocando el contador del panel, sin numeros en la lista. */
async function casoD(browser, vista, tema, ctx) {
  const quien = `D ${vista.etiqueta} ${tema}`;
  console.log(`\n  ${quien} - participaciones desde el contador`);
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await page.send("Page.navigate", { url: `${base}/?modo=varias&instant=1&pace=rapido&theme=${tema}&lang=es&red=prueba#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await conectarCuentaDePrueba(page);

    await escribirLista(page, "Ana Quispe\nBeto Rojas\nCarla Suarez");
    const abrio = await page.waitFor("document.getElementById('btn-varias') && getComputedStyle(document.getElementById('btn-varias')).display !== 'none'", 10000);
    check(`${quien}: se ve el boton para poner mas de una participacion`, abrio.ok);
    const aire = await aireBotonEnlace(page);
    check(`${quien}: entre el boton y el enlace del stand hay 12 px o mas`, aire === "oculto" || (/^\d+$/.test(aire) && Number(aire) >= 12), `${aire}px`);
    const cerrado = await medidasDelPanel(page);
    await page.eval("document.getElementById('btn-varias').click(); true");
    const panel = await page.waitFor("document.querySelectorAll('.varias-mas').length === 3", 10000);
    check(`${quien}: el panel trae una fila por persona`, panel.ok);
    // Con el panel abierto: 12 px entre el botón y el panel (no 24, sumando los dos márgenes), y lo de abajo no baja
    // más de lo que mide el panel (con los márgenes sumados bajaría 12 px de más).
    await sleep(400);
    const abierto = await medidasDelPanel(page);
    if (cerrado && abierto && abierto.panelArriba !== null) {
      const aireAbierto = Math.round(abierto.panelArriba - abierto.botonAbajo);
      check(`${quien}: con el panel abierto, entre el boton y el panel hay 12 px`, Math.abs(aireAbierto - 12) <= 1, `${aireAbierto}px`);
      const salto = Math.round(abierto.enlaceArriba - cerrado.enlaceArriba);
      const mide = Math.round(abierto.panelAlto);
      check(`${quien}: al abrir el panel, lo de abajo no baja mas de lo que mide el panel`, salto <= mide + 1, `bajo ${salto}px, el panel mide ${mide}px`);
      await page.eval("document.getElementById('btn-varias').scrollIntoView({ block: 'start' }); scrollBy(0, -90); true");
      await sleep(300);
      await page.screenshot(join(outDir, `d-panel-abierto-${vista.etiqueta}-${tema}.png`));
      if (vista.movil) {
        // A 320 px y con un nombre largo en la fila de Carla (solo en la pantalla, la lista no cambia): ninguna palabra
        // del panel se parte, y los contadores no se salen de la fila.
        await anchoDeCelular(page, vista, 320);
        const p = JSON.parse(
          await page.eval(`JSON.stringify((() => {
            const n = document.querySelectorAll('.varias-nombre')[2];
            const antes = n ? n.textContent : '';
            if (n) n.textContent = ${JSON.stringify(NOMBRE_LARGO)};
            document.getElementById('btn-varias').scrollIntoView({ block: 'start' });
            const partidas = ${PALABRAS_PARTIDAS(".varias-nombre")};
            const fuera = [...document.querySelectorAll('.varias-fila')].filter((f) => {
              const c = f.querySelector('.varias-control');
              return c && c.getBoundingClientRect().right > f.getBoundingClientRect().right + 1;
            }).length;
            return { partidas, fuera, antes, hay: !!n };
          })())`),
        );
        await sleep(300);
        await page.screenshot(join(outDir, `d-panel-320-${tema}.png`));
        check(`${quien} 320px: en el panel, con un nombre largo, ninguna palabra se parte`, p.hay && p.partidas.length === 0 && p.fuera === 0, p.partidas.join(", ") || (p.fuera ? `${p.fuera} filas con los contadores afuera` : "ninguna"));
        await page.eval(`(() => { const n = document.querySelectorAll('.varias-nombre')[2]; if (n) n.textContent = ${JSON.stringify(p.antes)}; return true; })()`);
        await anchoDeCelular(page, vista, vista.ancho);
      }
    } else {
      check(`${quien}: con el panel abierto, entre el boton y el panel hay 12 px`, false, "no se pudo medir el panel");
    }
    for (const fila of [0, 0, 2]) {
      await page.eval(`document.querySelectorAll('.varias-mas')[${fila}].click(); true`);
      await sleep(500);
    }
    const cuentaPanel = String(await page.eval("(document.getElementById('varias-cuenta') || {}).textContent || ''"));
    check(`${quien}: el panel cuenta 3 personas, 6 participaciones`, /3 personas/i.test(cuentaPanel) && /6 participaciones/i.test(cuentaPanel), cuentaPanel.trim());
    const cuentas = await leerCuentas(page);
    check(`${quien}: la cuenta dice 3 personas, 6 participaciones`, /3 personas/i.test(cuentas.cuadro) && /6 participaciones/i.test(cuentas.cuadro), cuentas.cuadro.trim());
    checkCuentasCoinciden(quien, cuentas);
    if (vista.movil) {
      const barraD = await barraEntra(page);
      check(`${quien}: la frase de la barra entra en su caja`, barraD === "entra", barraD);
    }
    const cuadro = String(await page.eval("document.getElementById('ta').value"));
    const esperado = ["Ana Quispe (1/3)", "Ana Quispe (2/3)", "Ana Quispe (3/3)", "Beto Rojas", "Carla Suarez (1/2)", "Carla Suarez (2/2)"];
    check(`${quien}: el cuadro quedo reescrito con las participaciones`, JSON.stringify(cuadro.split("\n")) === JSON.stringify(esperado), cuadro.replaceAll("\n", " / "));
    await page.screenshot(join(outDir, `d-panel-${vista.etiqueta}-${tema}.png`));

    await sellar(page);
    await quieto(page);
    await sortear(page);
    const res = await leerResultado(page);
    check(`${quien}: el sorteo salio con un resultado`, res.nombres.length === 1, res.nombres.join(" / "));
    check(`${quien}: ninguna tarjeta ni fila trae la marca de la linea sellada`, sinMarcaDeLinea(res.nombres), res.nombres.join(" / "));
    check(`${quien}: sin scroll horizontal en el resultado`, (await sinScrollX(page)) <= 1, `${await sinScrollX(page)}px`);
    await page.screenshot(join(outDir, `d-resultado-${vista.etiqueta}-${tema}.png`));
    check(`${quien}: sin excepciones de la pagina`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
    await page.send("Page.close").catch(() => {});
  } catch (e) {
    if (e?.codigo === "sello") throw e;
    check(`${quien}: el recorrido llego hasta el final`, false, String(e?.message ?? e).slice(0, 140));
    await page.screenshot(join(outDir, `d-falla-${vista.etiqueta}-${tema}.png`)).catch(() => {});
    await page.send("Page.close").catch(() => {});
  }
}

/**
 * Caso E: el primer orden de turnos de la visita, con el juego corriendo de verdad (sin `instant`): el cartel
 * final que corona el juego tiene que decir que el orden quedó listo, nunca que alguien gana. Antes el cartel
 * leía la marca del sorteo anterior y en el primer orden decía «¡GANAN ...!».
 */
async function casoE(browser, vista, tema, ctx) {
  const quien = `E ${vista.etiqueta} ${tema}`;
  console.log(`\n  ${quien} - el cartel final del primer orden de turnos`);
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: vista.ancho, height: vista.alto, deviceScaleFactor: vista.dpr, mobile: vista.movil, screenWidth: vista.ancho, screenHeight: vista.alto });
    await page.send("Page.navigate", { url: `${base}/?modo=turnos&pace=rapido&theme=${tema}&lang=es&red=prueba#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await conectarCuentaDePrueba(page);
    await escribirLista(page, "Ana Quispe\nBeto Mamani\nCarla Flores");
    await sellar(page);
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", RONDA_MAX);
    if (!nacio.ok) throw new Error("la ronda no nacio en tres minutos");
    await sleep(500);
    await page.eval("document.getElementById('btn-draw').click(); true");
    // Mientras el juego corre, se junta todo lo que dice el relator: ahí corona el cartel final.
    const dichos = new Set();
    let listo = false;
    for (let i = 0; i < 400 && !listo; i++) {
      const estado = JSON.parse(
        await page.eval(`JSON.stringify({
          relator: (document.getElementById('commentary') || {}).textContent || '',
          resultado: document.getElementById('winner-box') ? getComputedStyle(document.getElementById('winner-box')).display !== 'none' : false,
        })`),
      );
      if (estado.relator.trim()) dichos.add(estado.relator.trim());
      listo = estado.resultado;
      if (!listo) await sleep(400);
    }
    check(`${quien}: el juego llego al resultado`, listo);
    const todo = [...dichos].join(" | ");
    check(`${quien}: el cartel final dice que el orden quedó listo`, /El orden quedó listo/.test(todo), todo.slice(0, 160));
    check(`${quien}: el cartel final del primer orden no dice que alguien gana`, !SIN_GANADOR.test(todo) && !/GANAN/.test(todo), todo.slice(0, 160));
    await page.screenshot(join(outDir, `e-resultado-${vista.etiqueta}-${tema}.png`));
    check(`${quien}: sin excepciones de la pagina`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
    await page.send("Page.close").catch(() => {});
  } catch (e) {
    if (e?.codigo === "sello") throw e;
    check(`${quien}: el recorrido llego hasta el final`, false, String(e?.message ?? e).slice(0, 140));
    await page.screenshot(join(outDir, `e-falla-${vista.etiqueta}-${tema}.png`)).catch(() => {});
    await page.send("Page.close").catch(() => {});
  }
}

const CASOS = { A: casoA, B: casoB, C: casoC, D: casoD, E: casoE };

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`\nAuditando los modos contra ${base}`);
  console.log(`  casos: ${casos.join(",")} - vistas: ${vistas.map((v) => `${v.etiqueta} ${v.ancho}x${v.alto}`).join(", ")} - temas: ${temas.join(",")} - capturas en ${outDir}\n`);
  const browser = await launch({ width: vistas[0].ancho, height: vistas[0].alto });
  try {
    for (const vista of vistas) {
      for (const tema of temas) {
        for (const caso of casos) {
          await CASOS[caso](browser, vista, tema);
        }
      }
    }
  } finally {
    await browser.close();
  }
}

main().then(
  () => {
    console.log("");
    if (fallas) {
      console.log(`RECHAZADO: ${total - fallas}/${total} comprobaciones`);
      for (const nombre of fallaron) console.log(`  - ${nombre}`);
      console.log(`Capturas en ${outDir}/<caso>-<paso>-<tamano>-<tema>.png\n`);
      process.exit(1);
    }
    console.log(`APROBADO: ${total}/${total} comprobaciones`);
    console.log(`Capturas en ${outDir}/<caso>-<paso>-<tamano>-<tema>.png\n`);
    process.exit(0);
  },
  (e) => {
    if (e?.codigo === "sello") {
      console.log(`No se pudo sellar con la cuenta de prueba${e.message ? `: ${e.message}` : ""}. Revisa la red y el saldo, y volve a correrlo.`);
      process.exit(2);
    }
    total++;
    fallas++;
    console.log(`  ✗ la auditoria corrio sin caerse - ${String(e?.message ?? e).slice(0, 140)}`);
    console.log("");
    console.log(`RECHAZADO: ${total - fallas}/${total} comprobaciones`);
    for (const nombre of fallaron) console.log(`  - ${nombre}`);
    console.log(`Capturas en ${outDir}/<caso>-<paso>-<tamano>-<tema>.png\n`);
    process.exit(1);
  },
);
