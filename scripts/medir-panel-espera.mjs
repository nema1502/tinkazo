#!/usr/bin/env node
/**
 * El panel Elegí el juego de la espera en grande, medido en el navegador.
 *
 * Lo que se ve de verdad no se puede probar en jsdom: ahí no hay diseño. Esta medida abre la herramienta en modo libre,
 * sella la lista de ejemplo, abre la espera en grande y el panel de juegos, y en cada pantalla y en los dos temas mide:
 *
 *  - el panel: fondo de papel lleno (la espera de atrás no se transparenta), sin desborde de costado, las capturas
 *    cargadas con una sola visible por tarjeta, cuántas columnas hay (cinco en una pantalla apaisada de 900 px o más),
 *    la letra del nombre y del rango (16 px, 20 px en el proyector común de 1280 x 720 y 1366 x 768, y 24 px en el
 *    proyector de 1600 x 900 o más), la opacidad de la captura apagada (0,3 en el tema claro y 0,45 en el oscuro) y que
 *    Sorprendeme y Listo estén a la vista;
 *  - que donde dice `sinRecorrer` (el proyector, la laptop a 100 %, la tablet acostada) el panel entra entero, sin
 *    barra de desplazamiento sobre la imagen proyectada;
 *  - que cada rango diga "personas" (o "people"), que haya juegos apagados porque no encajan con esta cantidad de gente
 *    y que la línea de la estrella esté bajo el título;
 *  - que al elegir un juego (la Ruleta y La Entrada, de las últimas de la lista) y volver a abrir el panel, la tarjeta
 *    marcada se vea: el nombre queda entre el borde de arriba de la pantalla y el de arriba de la barra;
 *  - con varias semillas de Sorprendeme, cuadro por cuadro (requestAnimationFrame): una sola tarjeta encendida, la luz
 *    no salta de una punta de la grilla a la otra, el elegido no es el juego de partida, la tarjeta se queda marcada
 *    entre 1,2 y 1,7 segundos antes de cerrar y, lo más importante, que el nombre de la tarjeta encendida o recién
 *    caída nunca toque la barra de Sorprendeme y Listo ni quede fuera de la pantalla. Cuando la lista se recorre por
 *    dentro (un celular acostado, un zoom de 200 %) no hay ruleta: se mide la tarjeta de llegada ya quieta.
 *
 * Y la barra de arriba de la espera, con el nombre de juego más largo y el rótulo de modo prueba: que la calcomanía, el rótulo,
 * el nombre del juego y los botones no se pisen, y que el nombre se vea con 1000 px o más de ancho aun en una pantalla baja.
 *
 * Con `--out` deja una captura por paso (el panel, girando, donde cayó, y el panel cerrado con el juego nuevo).
 *
 * Uso:
 *   node scripts/medir-panel-espera.mjs [--base http://localhost:4173 | --servir] [--out DIR] [--json]
 *        [--pantallas 1366x768,1362x632,844x390] [--temas dark,light] [--lang es|en] [--semillas 3,7,12345]
 *
 * `--servir` levanta `vite preview` del sitio construido (`pnpm build`), lo usa y lo cierra por su PID. Un Chrome a la
 * vez y con su propio puerto: CDP_PORT=<puerto>. Sale con 1 si algo falla.
 */
import { execSync, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const servir = args.includes("--servir");
const PUERTO = Number(opt("puerto", "4187"));
const base = (servir ? `http://127.0.0.1:${PUERTO}` : opt("base", "http://localhost:4173")).replace(/\/$/, "");
const outDir = opt("out", "");
const temas = opt("temas", "dark,light").split(",");
const lang = opt("lang", "es");
const semillas = opt("semillas", "3,7,12345,4294967295").split(",").map(Number);

/** Las pantallas de docs/ux.md y el zoom de 200 %. `sinRecorrer`: el panel tiene que entrar entero. */
const TODAS = [
  { etiqueta: "proyector-1080", w: 1920, h: 1080, sinRecorrer: true },
  { etiqueta: "proyector-900", w: 1600, h: 900, sinRecorrer: true },
  { etiqueta: "laptop-768", w: 1366, h: 768, sinRecorrer: true },
  { etiqueta: "laptop-100", w: 1362, h: 632, sinRecorrer: true },
  { etiqueta: "proyector-720", w: 1280, h: 720, sinRecorrer: true },
  { etiqueta: "tablet-h", w: 1024, h: 560, sinRecorrer: true },
  { etiqueta: "celular-h", w: 844, h: 390, celular: true },
  { etiqueta: "zoom-200", w: 681, h: 316 },
  { etiqueta: "celular", w: 390, h: 844, celular: true },
];
const pedidas = opt("pantallas", "");
const pantallas = pedidas
  ? pedidas.split(",").map((p) => {
      const [w, h] = p.split("x").map(Number);
      return TODAS.find((v) => v.w === w && v.h === h) ?? { etiqueta: p, w, h, celular: w <= 700 };
    })
  : TODAS;

let fallas = 0;
const registro = [];
const check = (nombre, ok, detalle = "") => {
  registro.push({ nombre, ok, detalle });
  if (!ok) fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` - ${detalle}` : ""}`);
};

/* ------------------------------------------------------------ el servidor del sitio construido */
let vite = null;
const cerrarServidor = () => {
  if (!vite) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${vite.pid} /T /F`, { stdio: "ignore" });
    else process.kill(vite.pid);
  } catch {
    /* ya cerrado */
  }
  vite = null;
};
if (servir) {
  vite = spawn(process.execPath, [join(raiz, "node_modules/vite/bin/vite.js"), "preview", "--port", String(PUERTO), "--strictPort", "--host", "127.0.0.1"], {
    cwd: raiz,
    stdio: "ignore",
  });
  process.on("exit", cerrarServidor);
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/`)).ok) break;
    } catch {
      /* todavía no levantó */
    }
    await sleep(500);
  }
}

/* ------------------------------------------------------------ la página */
/** La herramienta en modo libre, con la lista de ejemplo sellada y la espera en grande abierta (sin que nazca el número). */
async function abrirLaEspera(page, v, tema) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: !!v.celular, screenWidth: v.w, screenHeight: v.h });
  await page.send("Page.navigate", { url: `${base}/?lead=170&pace=rapido&theme=${tema}&lang=${lang}#sortear` });
  await page.waitFor("document.readyState === 'complete'", 30000);
  await sleep(1200);
  // Sin cuenta, el botón de sellar queda con aria-disabled detrás de la puerta: el modo libre arma el mismo flujo.
  await page.eval(
    "document.querySelector('#sec-participants .body').classList.remove('locked'); (() => { const s = document.getElementById('btn-freeze'); s.removeAttribute('aria-disabled'); s.dataset.i = 'freeze'; s.textContent = new URLSearchParams(location.search).get('lang') === 'en' ? 'Seal the list' : 'Sellar la lista'; })(); document.getElementById('gate').style.display = 'none'; document.getElementById('primera-vez')?.style.setProperty('display', 'none'); true",
  );
  await page.eval("document.getElementById('btn-sample').click(); document.getElementById('btn-freeze').click(); true");
  const ok = await page.waitFor("getComputedStyle(document.getElementById('btn-espera')).display !== 'none' && document.getElementById('btn-draw').disabled", 30000);
  if (!ok.ok) throw new Error("no se selló la lista de ejemplo");
  await sleep(800);
  await page.eval("document.getElementById('btn-espera').click(); true");
  if (!(await page.waitFor("document.querySelector('.espera')", 10000)).ok) throw new Error("la espera en grande no se abrió");
  await sleep(500);
}

const ABRIR_PANEL = "[...document.querySelectorAll('.espera [data-juego]')].find((b) => b.offsetParent !== null)?.click(); true";
async function abrirElPanel(page) {
  await page.eval(ABRIR_PANEL);
  if (!(await page.waitFor("document.querySelector('.espera-juegos') && !document.querySelector('.espera-juegos').hidden", 5000)).ok) throw new Error("el panel de juegos no se abrió");
  // Las capturas del panel son perezosas: se espera a que carguen.
  await page.waitFor("[...document.querySelectorAll('.espera-juegos-lista img')].every((i) => i.complete)", 10000);
  await sleep(400);
}

/**
 * La barra de arriba de la espera con el nombre más largo y el rótulo de modo prueba puestos (en Prueba es lo más apretado que
 * puede estar). Mide que ninguna pieza pise a otra (la calcomanía, el rótulo, el nombre del juego y los dos botones), que no
 * se salgan de la pantalla y que la barra no tape lo de abajo. Después deja todo como estaba.
 */
const MEDIR_BARRA = (largo, prueba) => `(() => {
  const capa = document.querySelector('.espera');
  const top = capa.querySelector('.espera-top');
  const sticker = top.querySelector('.sticker');
  const acc = top.querySelector('.espera-top-acc');
  const nombres = [...capa.querySelectorAll('.espera-juego-n b')];
  const antes = nombres.map((b) => b.textContent);
  nombres.forEach((b) => { b.textContent = ${JSON.stringify(largo)}; });
  let rotulo = top.querySelector('.espera-prueba');
  const lo_puse = !rotulo;
  if (!rotulo) { rotulo = document.createElement('span'); rotulo.className = 'espera-prueba'; rotulo.textContent = ${JSON.stringify(prueba)}; top.insertBefore(rotulo, acc); }
  const visible = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  const caja = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
  const piezas = [
    ['la calcomanía', sticker],
    ['el rótulo', rotulo],
    ['el nombre del juego', [...top.querySelectorAll('.espera-juego-n')].find(visible)],
    ['Cambiar de juego', [...top.querySelectorAll('[data-juego]')].find(visible)],
    ['Volver a la página', top.querySelector('[data-volver]')],
  ].filter(([, el]) => visible(el)).map(([nombre, el]) => ({ nombre, ...caja(el) }));
  const cruza = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  const pisadas = [];
  for (let i = 0; i < piezas.length; i++) for (let j = i + 1; j < piezas.length; j++) if (cruza(piezas[i], piezas[j])) pisadas.push(piezas[i].nombre + ' con ' + piezas[j].nombre);
  const fuera = piezas.filter((x) => x.left < -0.5 || x.right > innerWidth + 0.5).map((x) => x.nombre);
  const contenido = [...capa.querySelectorAll('.espera-ensayo, .espera-premio, .espera-reloj')].find(visible);
  const baja = Math.max(...piezas.map((x) => x.bottom), top.getBoundingClientRect().bottom);
  const res = {
    piezas: piezas.map((x) => x.nombre + ' ' + Math.round(x.left) + '-' + Math.round(x.right)),
    nombreAlaVista: piezas.some((x) => x.nombre === 'el nombre del juego'),
    pisadas, fuera,
    barraBottom: Math.round(baja),
    contenidoTop: contenido ? Math.round(contenido.getBoundingClientRect().top) : null,
  };
  window.__barraRestaurar = () => { nombres.forEach((b, i) => { b.textContent = antes[i]; }); if (lo_puse) rotulo.remove(); };
  return JSON.stringify(res);
})()`;

/** Lo que se ve del panel quieto. */
const MEDIR_PANEL = `(() => {
  const panel = document.querySelector('.espera-juegos');
  const vp = { w: innerWidth, h: innerHeight };
  const dentro = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.top >= -0.5 && r.bottom <= vp.h + 0.5 && r.left >= -0.5 && r.right <= vp.w + 0.5; };
  const px = (el, prop) => (el ? parseFloat(getComputedStyle(el)[prop]) : null);
  const lista = panel.querySelector('.espera-juegos-lista');
  const cartas = [...lista.querySelectorAll('.espera-juego-op')];
  const filas = (xs) => new Set(xs.map((x) => Math.round(x))).size;
  const rangos = cartas.map((c) => c.querySelector('small')?.textContent ?? '');
  const azar = panel.querySelector('[data-azar]');
  const listo = panel.querySelector('[data-juegos-listo]');
  const sub = panel.querySelector('.espera-juegos-sub');
  const fondo = getComputedStyle(panel).backgroundColor;
  const alfa = /rgba\\(.*,\\s*([\\d.]+)\\)$/.exec(fondo);
  return JSON.stringify({
    vp,
    tarjetas: cartas.length,
    columnas: filas(cartas.map((c) => c.getBoundingClientRect().left)),
    filas: filas(cartas.map((c) => c.getBoundingClientRect().top)),
    anchoLista: Math.round(lista.getBoundingClientRect().width),
    anchoTarjeta: Math.round(cartas[0]?.getBoundingClientRect().width ?? 0),
    // Las capturas son perezosas: la del otro tema no se baja (está escondida), así que se pide que la visible esté cargada.
    capturas: cartas.map((c) => { const i = [...c.querySelectorAll('img')]; const vis = i.filter((x) => getComputedStyle(x).display !== 'none'); return { visibles: vis.length, cargada: vis.length === 1 && vis[0].complete && vis[0].naturalWidth > 0 }; }),
    nombrePx: Math.min(...cartas.map((c) => px(c.querySelector('.espera-juego-nombre'), 'fontSize'))),
    rangoPx: Math.min(...cartas.map((c) => px(c.querySelector('small'), 'fontSize')).filter((x) => x)),
    rangos,
    noEncaja: cartas.filter((c) => c.classList.contains('no-encaja')).map((c) => c.dataset.game),
    opacidadNoEncaja: (() => { const c = cartas.find((x) => x.classList.contains('no-encaja')); const i = c && [...c.querySelectorAll('img')].find((x) => getComputedStyle(x).display !== 'none'); return i ? Number(getComputedStyle(i).opacity) : null; })(),
    leyenda: sub ? sub.textContent.replace(/\\s+/g, ' ').trim() : null,
    leyendaPx: px(sub, 'fontSize'),
    azarVisible: azar && !azar.hidden ? dentro(azar) : null,
    listoVisible: dentro(listo),
    azarPx: px(azar, 'fontSize'),
    azarAlto: azar && !azar.hidden ? Math.round(azar.getBoundingClientRect().height) : null,
    recorre: panel.scrollHeight > panel.clientHeight + 1,
    // Con menos de dos filas y media a la vista, Sorprendeme no hace ruleta (espera.ts): solo marca dónde quedó.
    pocoLugar: panel.scrollHeight > panel.clientHeight + 1 && panel.clientHeight - (panel.querySelector('.espera-juegos-acc')?.offsetHeight ?? 0) < 2.5 * (cartas[0]?.offsetHeight ?? 0),
    alto: panel.scrollHeight,
    altoVisible: panel.clientHeight,
    desbordaDeLado: panel.scrollWidth > panel.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    fondo,
    fondoOpaco: !alfa || Number(alfa[1]) === 1,
    juegoDePartida: document.querySelector('.espera-juego-n b')?.textContent ?? null,
  });
})()`;

/** Lo que se ve de la tarjeta marcada con el panel recién abierto: dónde queda su nombre respecto de la pantalla y de la barra. */
const MEDIR_MARCADA = `(() => {
  const panel = document.querySelector('.espera-juegos');
  const barra = panel.querySelector('.espera-juegos-acc').getBoundingClientRect();
  const marcadas = [...panel.querySelectorAll('.espera-juego-op[aria-pressed="true"]')];
  const m = marcadas[0];
  if (!m) return JSON.stringify({ n: 0 });
  const rn = m.querySelector('.espera-juego-nombre').getBoundingClientRect();
  return JSON.stringify({
    n: marcadas.length,
    game: m.dataset.game,
    nombre: { top: Math.round(rn.top), bottom: Math.round(rn.bottom) },
    barraTop: Math.round(barra.top),
    recorre: panel.scrollHeight > panel.clientHeight + 1,
    scrollTop: Math.round(panel.scrollTop),
  });
})()`;

/**
 * Elige un juego tocando su tarjeta (el panel se cierra), vuelve a abrir el panel y mide dónde queda la tarjeta marcada.
 * Con la lista que se recorre y el elegido abajo, el panel tiene que abrir mostrándolo: sin eso, quien vuelve a abrir no ve
 * cuál está elegido.
 */
async function elegirYVolverAAbrir(page, game) {
  const hay = await page.eval(`!!document.querySelector('.espera-juegos [data-game="${game}"]')`);
  if (!hay) return { sinTarjeta: true };
  // La lista arranca desde arriba: así se ve si el panel la llevó hasta el elegido al abrirse.
  await page.eval(`document.querySelector('.espera-juegos').scrollTop = 0; document.querySelector('.espera-juegos [data-game="${game}"]').click(); true`);
  if (!(await esperarA(page, "document.querySelector('.espera-juegos').hidden", 3000))) return { noCerro: true };
  await abrirElPanel(page);
  return JSON.parse(await page.eval(MEDIR_MARCADA));
}

/** Un muestreo cuadro por cuadro del panel mientras Sorprendeme gira y se queda, desde que se toca hasta que se cierra. */
const MUESTREAR = (semilla) => `(() => {
  const panel = document.querySelector('.espera-juegos');
  const barra = panel.querySelector('.espera-juegos-acc');
  const lista = panel.querySelector('.espera-juegos-lista');
  const original = crypto.getRandomValues.bind(crypto);
  // La semilla del toque, fija: así la medida se repite. Solo el pedido de un entero de 32 bits, que es el del botón.
  crypto.getRandomValues = (a) => { if (a instanceof Uint32Array && a.length === 1) { a[0] = ${semilla}; return a; } return original(a); };
  const t0 = performance.now();
  const vp = () => ({ w: innerWidth, h: innerHeight });
  const cruza = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
  window.__azar = { muestras: [], centros: {}, fin: false, partida: document.querySelector('.espera-juego-n b')?.textContent ?? null, juegoPartida: panel.querySelector('.espera-juego-op[aria-pressed="true"]')?.dataset.game ?? null };
  for (const c of lista.querySelectorAll('.espera-juego-op')) { const r = c.getBoundingClientRect(); window.__azar.centros[c.dataset.game] = { x: r.left + r.width / 2, y: r.top + r.height / 2, ancho: r.width }; }
  const paso = () => {
    const rb = barra.getBoundingClientRect();
    const encendidas = [...panel.querySelectorAll('.espera-juego-op[aria-pressed="true"]')];
    const e = encendidas[0];
    const m = { t: Math.round(performance.now() - t0), oculto: panel.hidden, n: encendidas.length, game: e?.dataset.game ?? null, quedo: !!panel.querySelector('.azar-quedo'), girando: panel.classList.contains('girando') };
    if (e && !panel.hidden) {
      const rn = e.querySelector('.espera-juego-nombre').getBoundingClientRect();
      const rc = e.getBoundingClientRect();
      const v = vp();
      m.tocaLaBarra = cruza(rn, rb);
      m.fueraDePantalla = rn.top < -0.5 || rn.bottom > v.h + 0.5 || rn.left < -0.5 || rn.right > v.w + 0.5;
      m.tarjetaTocaLaBarra = cruza(rc, rb);
      m.nombre = { top: Math.round(rn.top), bottom: Math.round(rn.bottom) };
      m.barra = { top: Math.round(rb.top), bottom: Math.round(rb.bottom) };
    }
    window.__azar.muestras.push(m);
    if (panel.hidden) { window.__azar.fin = true; crypto.getRandomValues = original; return; }
    requestAnimationFrame(paso);
  };
  document.querySelector('.espera-juegos [data-azar]').click();
  requestAnimationFrame(paso);
  return true;
})()`;

const estado = async (page) => JSON.parse(await page.eval("JSON.stringify({ oculto: document.querySelector('.espera-juegos').hidden, quedo: !!document.querySelector('.azar-quedo'), girando: document.querySelector('.espera-juegos').classList.contains('girando') })"));
const esperarA = async (page, condicion, ms) => (await page.waitFor(condicion, ms)).ok;

/** Qué pasó en un toque: lo que midió el muestreo, resumido. */
function resumirToque(r, centros, ancho) {
  const m = r.muestras;
  const vivas = m.filter((x) => !x.oculto);
  const enRuleta = vivas.filter((x) => x.girando && !x.quedo);
  const llegada = vivas.filter((x) => x.quedo);
  // La secuencia de tarjetas encendidas, sin repetir las seguidas: el camino de la luz.
  const camino = enRuleta.map((x) => x.game).filter((g, i, a) => g && (i === 0 || g !== a[i - 1]));
  const paso = ancho + 10;
  let mayorSalto = 0;
  for (let i = 1; i < camino.length; i++) {
    const a = centros[camino[i - 1]];
    const b = centros[camino[i]];
    if (a && b) mayorSalto = Math.max(mayorSalto, Math.hypot(a.x - b.x, a.y - b.y) / paso);
  }
  const quedoDesde = llegada[0]?.t;
  const cerroA = m.find((x) => x.oculto)?.t;
  // Todo lo que se vio con una tarjeta encendida, salvo los primeros 700 ms de la llegada, cuando el desplazamiento suave de
  // la lista todavía corre. No depende de las marcas de giro y de llegada: así la medida también ve un panel que no las tiene.
  const revisar = vivas.filter((x) => x.game && (!x.quedo || x.t - (quedoDesde ?? 0) >= 700));
  return {
    muestras: m.length,
    camino,
    pasos: camino.length,
    unaSolaEncendida: vivas.every((x) => x.n === 1),
    mayorSalto: Number(mayorSalto.toFixed(2)),
    elegido: llegada.at(-1)?.game ?? null,
    quedoMs: quedoDesde !== undefined && cerroA !== undefined ? cerroA - quedoDesde : null,
    ruletaMs: enRuleta.length ? enRuleta.at(-1).t - enRuleta[0].t : 0,
    nombreTocaLaBarra: revisar.filter((x) => x.tocaLaBarra).length,
    nombreFuera: revisar.filter((x) => x.fueraDePantalla).length,
    revisadas: revisar.length,
  };
}

/** Un toque de Sorprendeme con una semilla, con el panel ya abierto. Devuelve el resumen y, si hay `capturas`, las saca. */
async function tocar(page, semilla, recorre, capturas) {
  await page.eval(MUESTREAR(semilla));
  if (capturas) {
    if (!recorre) {
      await sleep(900);
      await page.screenshot(capturas.girando);
    }
    await esperarA(page, "!!document.querySelector('.azar-quedo')", 6000);
    await sleep(recorre ? 800 : 500);
    await page.screenshot(capturas.quedo);
  }
  const cerro = await esperarA(page, "window.__azar && window.__azar.fin", 12000);
  const crudo = JSON.parse(await page.eval("JSON.stringify(window.__azar)"));
  if (capturas) {
    await sleep(300);
    await page.screenshot(capturas.cerrado);
  }
  const ancho = Object.values(crudo.centros)[0]?.ancho ?? 180;
  return { cerro, crudo, ...resumirToque(crudo, crudo.centros, ancho) };
}

/* ------------------------------------------------------------ una pantalla, un tema */
async function medir(browser, v, tema) {
  const id = `${v.etiqueta}-${v.w}x${v.h}-${tema === "light" ? "claro" : "oscuro"}-${lang}`;
  console.log(`\n== ${id}`);
  const page = await browser.open("about:blank");
  try {
    await abrirLaEspera(page, v, tema);
    // La barra de arriba, antes de abrir el panel de juegos.
    const barra = JSON.parse(await page.eval(MEDIR_BARRA(lang === "en" ? "Spinning tops" : "Carrera de llamas", lang === "en" ? "Test mode" : "Modo prueba")));
    if (outDir) await page.screenshot(join(outDir, `${id}-0-barra.png`));
    await page.eval("window.__barraRestaurar(); true");
    // Solo en las pantallas bajas (560 px o menos): ahí cambió la regla del nombre en la barra.
    if (v.h <= 560) check(`${id} - en la barra de arriba nada se pisa (con el nombre más largo y el rótulo de modo prueba)`, barra.pisadas.length === 0 && barra.fuera.length === 0, `${barra.pisadas.join(", ") || "sin pisadas"}${barra.fuera.length ? ` - fuera: ${barra.fuera.join(", ")}` : ""} (${barra.piezas.join("; ")})`);
    // El nombre del juego se esconde solo en una pantalla baja y angosta (un celular acostado): con 1000 px o más de ancho se ve.
    if (v.h <= 560 && v.w >= 1000) check(`${id} - el nombre del juego se ve en la barra`, barra.nombreAlaVista, barra.piezas.join("; "));
    if (v.h <= 560 && v.w < 1000) check(`${id} - el nombre del juego no está en la barra, solo el botón`, !barra.nombreAlaVista, barra.piezas.join("; "));
    if (barra.contenidoTop !== null && v.h <= 560) check(`${id} - la barra de arriba no tapa lo de abajo`, barra.barraBottom <= barra.contenidoTop + 1, `la barra llega a ${barra.barraBottom} px y el contenido empieza en ${barra.contenidoTop} px`);
    await abrirElPanel(page);
    const p = JSON.parse(await page.eval(MEDIR_PANEL));
    const quien = `${id}`;
    if (outDir) await page.screenshot(join(outDir, `${id}-1-panel.png`));

    check(`${quien} - hay diez tarjetas con su captura cargada y una sola visible`, p.tarjetas === 10 && p.capturas.every((c) => c.cargada && c.visibles === 1), JSON.stringify(p.capturas.filter((c) => !c.cargada || c.visibles !== 1)));
    check(`${quien} - el fondo del panel es de papel lleno`, p.fondoOpaco, p.fondo);
    check(`${quien} - sin desborde de costado`, !p.desbordaDeLado);
    check(`${quien} - Sorprendeme y Listo a la vista`, p.azarVisible === true && p.listoVisible === true, `Sorprendeme ${p.azarVisible} - Listo ${p.listoVisible}`);
    // Tres escalones de letra: el proyector (1600 x 900 o más: 24 px), el común (1180 x 700 o más, apaisado: 1280 x 720 y
    // 1366 x 768, a 20 px) y el resto (16 px, con 1362 x 632 incluido: no tiene alto para más).
    const proyector = v.w >= 1600 && v.h >= 900;
    const comun = !proyector && v.w >= 1180 && v.h >= 700 && v.w > v.h;
    const minimoLetra = proyector ? 24 : comun ? 20 : 16;
    const minimoBoton = proyector ? 22 : comun ? 18 : 16;
    const minimoLeyenda = proyector ? 22 : comun ? 18 : 16;
    check(`${quien} - nombre y rango a ${minimoLetra} px o más`, p.nombrePx >= minimoLetra && p.rangoPx >= minimoLetra, `${p.nombrePx} y ${p.rangoPx}`);
    if (!proyector && !comun) check(`${quien} - sin escalón: el nombre y el rango siguen a 16 px`, p.nombrePx === 16 && p.rangoPx === 16, `${p.nombrePx} y ${p.rangoPx}`);
    check(`${quien} - los botones a ${minimoBoton} px o más`, p.azarPx >= minimoBoton, String(p.azarPx));
    if (comun) check(`${quien} - los botones de 52 px de alto o más`, p.azarAlto >= 52, String(p.azarAlto));
    check(`${quien} - la línea que explica la estrella está bajo el título y se lee a ${minimoLeyenda} px o más`, !!p.leyenda && /★/.test(p.leyenda) && p.leyendaPx >= minimoLeyenda, `${p.leyenda} (${p.leyendaPx} px)`);
    const unidad = lang === "en" ? /people$/ : /personas$/;
    check(`${quien} - cada rango dice a quién se refiere`, p.rangos.every((r) => unidad.test(r)), p.rangos.filter((r) => !unidad.test(r)).join(" | "));
    check(`${quien} - el juego que no encaja con esta cantidad de gente se ve apagado`, p.noEncaja.length >= 1, p.noEncaja.join(", "));
    const apagado = tema === "light" ? 0.3 : 0.45;
    check(`${quien} - la captura que no encaja se apaga a ${apagado} en el tema ${tema === "light" ? "claro" : "oscuro"}`, p.opacidadNoEncaja !== null && Math.abs(p.opacidadNoEncaja - apagado) < 0.005, String(p.opacidadNoEncaja));
    if (v.w >= 900 && v.w > v.h) check(`${quien} - cinco columnas en dos filas`, p.columnas === 5 && p.filas === 2, `${p.columnas} columnas, ${p.filas} filas`);
    if (proyector) check(`${quien} - en el proyector el panel crece`, p.anchoLista >= 1300 && p.anchoTarjeta >= 250, `lista ${p.anchoLista} px, tarjeta ${p.anchoTarjeta} px`);
    if (comun) check(`${quien} - en el proyector común la lista mide 1180 px`, Math.abs(p.anchoLista - 1180) <= 2, `lista ${p.anchoLista} px, tarjeta ${p.anchoTarjeta} px`);
    if (v.sinRecorrer) check(`${quien} - el panel entra entero, sin barra de desplazamiento`, !p.recorre, `alto ${p.alto} px en ${p.altoVisible} px`);
    else console.log(`    (el panel se recorre por dentro: ${p.alto} px en ${p.altoVisible} px, ${p.pocoLugar ? "con menos de dos filas y media a la vista" : "con lugar para varias filas"})`);

    // Elegir un juego y volver a abrir el panel: la tarjeta marcada se ve, con su nombre entre el borde de arriba de la
    // pantalla y el de arriba de la barra. La Ruleta y La Entrada son de las últimas de la lista: en una pantalla donde la
    // lista se recorre, hay que bajar hasta ellas.
    for (const game of ["wheel", "oruro"]) {
      const m = await elegirYVolverAAbrir(page, game);
      const nombre = `${quien} - al volver a abrir con ${game} elegido`;
      if (m.sinTarjeta || m.noCerro) {
        check(`${nombre}, la tarjeta se toca y el panel se cierra`, false, m.sinTarjeta ? "no hay tarjeta de ese juego" : "el panel no se cerró");
        continue;
      }
      check(`${nombre}, queda una sola tarjeta marcada y es la suya`, m.n === 1 && m.game === game, `${m.n} marcadas, la primera es ${m.game}`);
      check(`${nombre}, el nombre de la marcada queda a la vista, entre 0 y el borde de arriba de la barra`, m.nombre && m.nombre.top >= 0 && m.nombre.bottom <= m.barraTop, `nombre de ${m.nombre?.top} a ${m.nombre?.bottom} px, la barra empieza en ${m.barraTop} px${m.recorre ? `, la lista se recorre (bajó ${m.scrollTop} px)` : ", la lista entra entera"}`);
    }

    // Sorprendeme, con varias semillas. Entre una y otra el panel se cierra solo: se vuelve a abrir.
    let primera = true;
    const elegidos = [];
    for (const semilla of semillas) {
      if (!primera) await abrirElPanel(page);
      const antes = JSON.parse(await page.eval(MEDIR_PANEL));
      if (antes.azarVisible !== true) {
        check(`${quien} - semilla ${semilla}: Sorprendeme se ve`, false);
        break;
      }
      const capturas = outDir && primera
        ? { girando: join(outDir, `${id}-2-girando.png`), quedo: join(outDir, `${id}-3-quedo.png`), cerrado: join(outDir, `${id}-4-cerrado.png`) }
        : null;
      const r = await tocar(page, semilla, antes.pocoLugar, capturas);
      primera = false;
      const nombre = `${quien} - semilla ${semilla}`;
      check(`${nombre} - terminó y cerró el panel`, r.cerro && r.elegido !== null, `elegido ${r.elegido}`);
      check(`${nombre} - una sola tarjeta encendida en cada cuadro`, r.unaSolaEncendida);
      check(`${nombre} - el elegido no es el juego de partida`, r.elegido !== null && r.elegido !== r.crudo.juegoPartida, `${r.crudo.juegoPartida} pasó a ${r.elegido}`);
      check(`${nombre} - la tarjeta se queda marcada entre 1,2 y 1,7 segundos`, r.quedoMs !== null && r.quedoMs >= 1200 && r.quedoMs <= 1700, `${r.quedoMs} ms`);
      check(`${nombre} - el nombre de la tarjeta nunca toca la barra ni sale de la pantalla`, r.nombreTocaLaBarra === 0 && r.nombreFuera === 0 && r.revisadas > 0, `${r.revisadas} cuadros, ${r.nombreTocaLaBarra} tocan la barra, ${r.nombreFuera} fuera de la pantalla`);
      if (antes.pocoLugar) check(`${nombre} - con menos de dos filas y media a la vista no hay ruleta: solo la tarjeta de llegada`, r.pasos === 0, `${r.pasos} tarjetas en el camino`);
      else {
        check(`${nombre} - la luz recorre varias tarjetas`, r.pasos >= 5, `${r.pasos} tarjetas`);
        // Con cinco columnas (dos filas parejas) la luz da la vuelta sin saltos. Con cuatro y una fila de dos al final, saltarse una
        // tarjeta que no encaja puede costar hasta lo que mide una fila: nunca más que eso.
        const tope = Math.max(2.6, antes.columnas - 0.7);
        check(`${nombre} - la luz no salta de una punta de la grilla a la otra`, r.mayorSalto <= tope, `el mayor salto es de ${r.mayorSalto} tarjetas (hasta ${tope.toFixed(1)}), con ${antes.columnas} columnas`);
        check(`${nombre} - la ruleta dura entre 1,5 y 3,5 segundos`, r.ruletaMs >= 1500 && r.ruletaMs <= 3500, `${r.ruletaMs} ms`);
      }
      elegidos.push(r.elegido);
      console.log(`    camino: ${r.camino.join(" > ") || "(sin ruleta)"} - cayó en ${r.elegido}`);
      // El nombre de la cabecera es el del juego nuevo.
      const nuevo = await page.eval("document.querySelector('.espera-juego-n b')?.textContent ?? null");
      check(`${nombre} - el nombre de la espera cambió`, nuevo !== null && nuevo !== r.crudo.partida, `${r.crudo.partida} pasó a ${nuevo}`);
    }
    check(`${quien} - las semillas dan juegos distintos`, new Set(elegidos).size >= 2, elegidos.join(", "));
  } catch (e) {
    check(`${id} - corrió sin errores`, false, String(e?.message ?? e));
    if (outDir) {
      try {
        await page.screenshot(join(outDir, `${id}-ERROR.png`));
      } catch {
        /* sin captura */
      }
    }
  } finally {
    await page.send("Page.close").catch(() => undefined);
  }
}

if (outDir) mkdirSync(outDir, { recursive: true });
const browser = await launch({ port: Number(process.env.CDP_PORT || 9787) });
try {
  for (const v of pantallas) for (const tema of temas) await medir(browser, v, tema);
} finally {
  await browser.close();
  cerrarServidor();
}
console.log(`\n${fallas ? `✗ ${fallas} fallas` : "✓ todo bien"}${outDir ? ` - capturas en ${outDir}` : ""}`);
emitirJson({ auditor: "medir-panel-espera", objetivo: "sitio", checks: registro });
process.exit(fallas ? 1 : 0);
