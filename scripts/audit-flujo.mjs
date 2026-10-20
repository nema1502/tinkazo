#!/usr/bin/env node
/**
 * Auditor de flujo: la "QA de UX" de Tinkazo.
 *
 * Existe porque alguien que usaba la herramienta por primera vez, mirando la
 * espera de la ronda, dijo: "me cuesta encontrar el botón del siguiente... no
 * sé cuál es el siguiente". La interfaz se veía bien y ninguna comprobación
 * miraba si en cada paso se veía qué hacer. Hasta el 19 de octubre de 2026 el
 * botón de sortear quedaba a pantalla y media de la caja de la espera, y "otro
 * premio" a más de una pantalla del ganador, y solo se probaba en 1440x900 y
 * 390x844.
 *
 * Recorre el flujo de verdad, con la cuenta de prueba de testnet (la única que
 * no necesita a nadie), una vez por cada pantalla y por cada tema: carga la
 * lista, la sella, espera la ronda, sortea y pasa al siguiente premio. En cada
 * paso mide lo que se ve sin hacer scroll, con la pantalla donde la deja la
 * propia página, y comprueba:
 *
 *  - que hay UNA acción principal a la vista: el botón de verdad o, si ese
 *    queda fuera, el de la barra de "lo que sigue", nunca los dos ni ninguno;
 *  - que la barra no tapa al botón de verdad, ni el pie de la página, ni la
 *    toca nada encima (se prueba en el punto del clic);
 *  - que no hay scroll horizontal y, en el celular, que los blancos de toque
 *    miden 44 px o más;
 *  - que el indicador de pasos dice en qué paso se está;
 *  - que el texto se lee (contraste) en lo que trae el flujo;
 *  - que la barra se va con el estadio, con la espera en grande y con una
 *    ventana abierta, y vuelve al cerrarlas.
 *
 * Las pantallas son las cinco de siempre más el zoom al 200 % (681x316, que es
 * 1362x632 al doble). Deja una captura por paso en `--out`.
 *
 * El sellado en testnet a veces tarda (una vez pasó los 120 s): espera hasta
 * `--sello-max` segundos y, si falla, reintenta el recorrido de esa pantalla.
 *
 * Uso:
 *   node scripts/audit-flujo.mjs [--base http://localhost:4173] [--out DIR]
 *                                [--vistas laptop-100,celular] [--temas dark,light]
 *                                [--sin-resto laptop-100,celular-h] [--lang es|en]
 *                                [--sello-max 240] [--reintentos 2]
 *
 * Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto> node ...
 * Sale con código 1 si algo falla.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas/flujo");
const lang = opt("--lang", "es");
const quieren = opt("--vistas", "").split(",").filter(Boolean);
const temas = opt("--temas", "dark").split(",").filter(Boolean);
// El caso en que no queda nadie sin premio ("Compartir el comprobante" es la
// acción principal) es otro sorteo entero: se mira en las pantallas más justas.
const sinResto = opt("--sin-resto", "laptop-100,celular-h").split(",").filter(Boolean);
const selloMax = Number(opt("--sello-max", "240")) * 1000;
const reintentos = Number(opt("--reintentos", "2"));

// [etiqueta, ancho, alto, dpr, celular]
const TODAS = [
  ["laptop-100", 1362, 632, 1, false],
  ["escritorio", 1280, 720, 1, false],
  ["tablet-h", 1024, 560, 1, false],
  ["celular-h", 844, 390, 2, true],
  ["celular", 390, 844, 2, true],
  ["zoom-200", 681, 316, 2, false],
];
const VISTAS = quieren.length ? TODAS.filter((v) => quieren.includes(v[0])) : TODAS;
const desconocidas = quieren.filter((q) => !TODAS.some((v) => v[0] === q));
if (desconocidas.length || VISTAS.length === 0 || temas.some((t) => t !== "dark" && t !== "light")) {
  console.error(`uso: --vistas ${TODAS.map((v) => v[0]).join(",")} · --temas dark,light${desconocidas.length ? ` (no existe: ${desconocidas.join(", ")})` : ""}`);
  process.exit(2);
}

let fallas = 0;
let total = 0;
/** Cada comprobación sale apenas se hace: el recorrido dura minutos y se tiene que ver cómo va. */
function check(nombre, ok, detalle = "") {
  total++;
  if (!ok) fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
  return ok;
}
const info = (texto) => console.log(`    ${texto}`);

/** Qué botón de verdad hace avanzar cada paso. */
const REAL = {
  lista: "#btn-freeze",
  espera: "#btn-draw",
  ronda: "#btn-draw",
  resultado: "#btn-again-sin",
  comprobante: "#btn-proof",
  siguiente: "#btn-freeze",
};

/**
 * Lo que se ve ahora: dónde está el botón de verdad y la barra, y si algo los
 * tapa. Todo en un solo viaje para que la medida sea de un mismo instante.
 */
const MEDIR = (selReal) => `JSON.stringify((() => {
  const caja = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10, h: Math.round(r.height), w: Math.round(r.width) };
  };
  const tocable = (el) => {
    const r = caja(el);
    if (!r) return null;
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { dentro: false };
    const arriba = document.elementFromPoint(x, y);
    return { dentro: true, ok: !!arriba && (arriba === el || el.contains(arriba)), quien: arriba ? (arriba.id ? '#' + arriba.id : arriba.tagName.toLowerCase() + '.' + String(arriba.className).split(' ')[0]) : null };
  };
  const cab = document.querySelector('header');
  const arriba = cab && getComputedStyle(cab).position === 'sticky' ? Math.round(cab.getBoundingClientRect().bottom) : 0;
  const real = document.querySelector(${JSON.stringify(selReal)});
  const barra = document.getElementById('siguiente');
  const sigBtn = document.getElementById('sig-btn');
  const pasos = [...document.querySelectorAll('#pasos li')].map((li) => ({ n: Number(li.dataset.paso), actual: li.classList.contains('actual'), hecho: li.classList.contains('hecho'), aria: li.getAttribute('aria-current'), marca: (li.querySelector('.p-n') || {}).textContent || '', texto: (li.querySelector('.p-t') || {}).textContent || '' }));
  const principales = ['#btn-freeze', '#btn-draw', '#btn-again-sin', '#btn-proof', '#btn-again-nueva', '#sig-btn']
    .map((s) => document.querySelector(s))
    .filter((e) => e && e.classList.contains('primary'))
    .map((e) => ({ id: e.id, caja: caja(e), off: !!e.disabled }))
    .filter((p) => p.caja);
  const pie = document.querySelector('footer');
  return {
    vp: { w: document.documentElement.clientWidth, h: innerHeight },
    scrollY: Math.round(scrollY),
    arriba,
    real: real ? { caja: caja(real), off: !!real.disabled, texto: (real.textContent || '').trim(), clases: real.className, tocable: tocable(real), anim: getComputedStyle(real).animationName } : null,
    barra: barra ? { existe: true, on: barra.classList.contains('on'), inert: !!barra.inert, region: barra.getAttribute('role'), nombre: barra.getAttribute('aria-label'), caja: caja(barra), btn: sigBtn ? { caja: caja(sigBtn), off: !!sigBtn.disabled, texto: (sigBtn.textContent || '').trim(), tocable: tocable(sigBtn), anim: getComputedStyle(sigBtn).animationName } : null, paso: (document.getElementById('sig-paso') || {}).textContent || '' } : { existe: false },
    aviso: (document.getElementById('sig-aviso') || {}).textContent || null,
    avisoVivo: document.getElementById('sig-aviso') ? { rol: document.getElementById('sig-aviso').getAttribute('role'), live: document.getElementById('sig-aviso').getAttribute('aria-live') } : null,
    pasos,
    principales,
    pie: caja(pie),
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ganadores: caja(document.getElementById('winner-cards')),
    primerGanador: caja(document.querySelector('#winner-cards .winner-card')),
    espera: caja(document.getElementById('wait-box')),
    otro: caja(document.getElementById('again-row')),
    grande: caja(document.getElementById('btn-grande')),
    verifica: caja(document.querySelector('.verify')),
    docY: Math.round(scrollY),
  };
})())`;

/** Blancos de toque y contraste, solo de lo que hay en la pantalla ahora. */
const SONDA = `JSON.stringify((() => {
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const nums = (s) => s.split(/[^0-9.]+/).filter(Boolean).map(Number).slice(0, 3);
  const opaco = (b) => b && b.indexOf('rgba(0, 0, 0, 0)') < 0 && b.indexOf('transparent') < 0;
  const fondo = (el) => { let e = el; while (e) { const b = getComputedStyle(e).backgroundColor; if (opaco(b)) return nums(b); e = e.parentElement; } return [255, 255, 255]; };
  const razon = (a, b) => { const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)); };
  const sale = { toques: [], texto: [] };
  const raices = ['#pasos', '#siguiente.on', '#sec-frozen', '#sec-draw', '#sec-participants'];
  for (const r of raices) {
    for (const el of document.querySelectorAll(r + ' *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const rc = el.getBoundingClientRect();
      if (!rc.width || !rc.height) continue;
      // Solo lo que se ve: lo de más abajo no cuenta hasta que se baje.
      if (rc.bottom < 0 || rc.top > innerHeight || rc.right < 0 || rc.left > innerWidth) continue;
      if (el.classList.contains('sr-only')) continue;
      const enLinea = el.tagName === 'A' && cs.display.indexOf('inline') === 0;
      if (!enLinea && /^(BUTTON|A|SELECT)$/.test(el.tagName) && rc.height < 43.5) {
        sale.toques.push({ t: (el.textContent || '').trim().slice(0, 24), h: Math.round(rc.height * 10) / 10 });
      }
      const propio = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      // Un botón apagado lo está a propósito: las pautas de contraste no lo cuentan.
      if (propio.length > 1 && !el.closest('button:disabled') && !el.closest('.confetti')) {
        const tam = parseFloat(cs.fontSize), peso = parseInt(cs.fontWeight) || 400;
        const pide = tam >= 24 || (tam >= 18.66 && peso >= 700) ? 3 : 4.5;
        const op = parseFloat(cs.opacity) || 1;
        const bg = fondo(el);
        let col = nums(cs.color);
        if (op < 1) col = col.map((v, i) => v * op + bg[i] * (1 - op));
        const r2 = razon(col, bg);
        if (r2 < pide) sale.texto.push({ t: propio.slice(0, 28), r: r2, pide, sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] });
      }
    }
  }
  return sale;
})())`;

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

const medir = async (page, sel) => JSON.parse(await page.eval(MEDIR(sel)));

/** ¿El botón entra entero en la pantalla, sin la cabecera fija que le tapa el borde de arriba? */
const aLaVista = (caja, m) => !!caja && caja.top >= m.arriba - 1 && caja.bottom <= m.vp.h + 1 && caja.left >= -1 && caja.right <= m.vp.w + 1;

const solapan = (a, b) => !!a && !!b && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5 && a.left < b.right && a.right > b.left;

const sinTildes = (s) => s.normalize("NFD").replace(/\p{M}/gu, "");

/**
 * Lo que se comprueba en cada paso. `esperado.paso` es el número del
 * indicador; `esperado.real` el botón de verdad de ese paso.
 */
async function paso(page, ctx, n, nombre, esperado) {
  const { etiqueta, tema, celular } = ctx;
  const quien = `${etiqueta} ${tema}`;
  const m = await medir(page, esperado.real);
  const real = m.real?.caja ?? null;
  const verReal = aLaVista(real, m);
  const b = m.barra;
  const verBarra = !!(b.existe && b.on && b.btn?.caja && aLaVista(b.btn.caja, m));
  const donde = real
    ? `real ${Math.round(real.top)}–${Math.round(real.bottom)} de ${m.vp.h}${verReal ? " (a la vista)" : " (fuera)"}`
    : "el botón de verdad no se ve";
  const quienAccion = verReal ? `el botón "${m.real.texto}"` : verBarra ? `la barra: "${b.btn.texto}"` : "ninguna";
  console.log(`\n  ${etiqueta} · ${tema} · ${n} ${nombre}`);
  info(`${donde} · barra ${verBarra ? `puesta (${Math.round(b.caja.top)}–${Math.round(b.caja.bottom)}, "${b.paso}")` : b.existe ? "escondida" : "no existe"} · scroll ${m.scrollY}`);

  // 1. Una acción principal, y una sola.
  check(
    `${quien} · ${n} ${nombre}: una acción principal a la vista`,
    verReal !== verBarra,
    verReal && verBarra ? `las dos a la vista: ${donde}` : !verReal && !verBarra ? `ninguna: ${donde}${b.existe ? "" : " y no hay barra"}` : `es ${quienAccion}`,
  );
  // 2. Una sola principal (de color) entre todos los botones del flujo.
  const prin = m.principales.filter((p) => aLaVista(p.caja, m));
  check(
    `${quien} · ${n} ${nombre}: nunca dos botones principales a la vista`,
    prin.length <= 1,
    prin.length > 1 ? prin.map((p) => `#${p.id}`).join(" y ") : "",
  );
  // 3. La barra no tapa al botón de verdad ni lo importante de este paso. Lo importante
  //    es lo que la gente tiene que ver al llegar: la espera, y el primer ganador. Una
  //    barra fija siempre tapa algo de lo que está más abajo mientras no se baja; eso se
  //    alcanza con el scroll (la herramienta deja aire abajo, ver el pie) y no cuenta.
  if (b.existe && b.on) {
    check(`${quien} · ${n} ${nombre}: la barra no tapa el botón de verdad`, !solapan(real, b.caja) || !aLaVista(real, m), real && solapan(real, b.caja) ? `el botón ${Math.round(real.top)}–${Math.round(real.bottom)} queda bajo la barra ${Math.round(b.caja.top)}` : "");
    for (const [clave, caja] of [["la espera", m.espera], ["el primer ganador", m.primerGanador]]) {
      if (!caja || !esperado.importante?.includes(clave)) continue;
      // Tapado a medias: empieza arriba de la barra y termina debajo. Lo que empieza debajo de la barra no se ve todavía.
      const tapado = caja.top < b.caja.top - 0.5 && caja.bottom > b.caja.top + 0.5;
      check(`${quien} · ${n} ${nombre}: la barra no tapa ${clave}`, !tapado, tapado ? `${Math.round(caja.top)}–${Math.round(caja.bottom)} contra la barra en ${Math.round(b.caja.top)}` : "");
    }
  }
  // 4. Y la que se ve se puede tocar: nada encima.
  const elVisible = verReal ? m.real.tocable : verBarra ? b.btn.tocable : null;
  if (elVisible) check(`${quien} · ${n} ${nombre}: la acción a la vista se puede tocar`, elVisible.dentro && elVisible.ok, elVisible.ok ? "" : `encima hay ${elVisible.quien}`);
  // 5. Sin scroll de costado.
  check(`${quien} · ${n} ${nombre}: sin scroll horizontal`, m.scrollX <= 1, `${m.scrollX}px`);
  // 6. El indicador de pasos.
  const cur = m.pasos.filter((p) => p.actual);
  const okPasos = m.pasos.length === 4 && cur.length === 1 && cur[0].n === esperado.paso && cur[0].aria === "step" && m.pasos.filter((p) => p.hecho).length === esperado.paso - 1;
  check(
    `${quien} · ${n} ${nombre}: el indicador marca el paso ${esperado.paso}`,
    okPasos,
    m.pasos.length === 0 ? "no hay indicador de pasos" : okPasos ? m.pasos.map((p) => (p.hecho ? "✓" : p.actual ? `[${p.n}]` : p.n)).join(" ") : `marca ${cur.map((p) => p.n).join(",") || "ninguno"} y ${m.pasos.filter((p) => p.hecho).length} hechos`,
  );
  // 7. Toques y contraste de lo que se ve.
  const s = JSON.parse(await page.eval(SONDA));
  if (celular) check(`${quien} · ${n} ${nombre}: blancos de toque de 44 px`, s.toques.length === 0, s.toques.slice(0, 3).map((x) => `"${x.t}" ${x.h}px`).join(" | "));
  check(`${quien} · ${n} ${nombre}: contraste del texto`, s.texto.length === 0, s.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.pide}`).join(" | "));
  // 8. La captura.
  await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-${n}-${sinTildes(nombre).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`));
  return { m, verReal, verBarra };
}

/** Clic en lo que se ve: la barra si es la que está puesta, y si no el botón de verdad. */
async function pulsar(page, ctx, sel, nombre) {
  const m = await medir(page, sel);
  const usaBarra = !!(m.barra.existe && m.barra.on && m.barra.btn && !m.barra.btn.off && !aLaVista(m.real?.caja ?? null, m));
  await page.eval(usaBarra ? "document.getElementById('sig-btn').click(); true" : `document.querySelector(${JSON.stringify(sel)}).click(); true`);
  info(`${nombre}: clic ${usaBarra ? "en la barra" : "en el botón de verdad"}`);
  return usaBarra;
}

const hayFalla = (cond, que) => {
  if (cond) throw new Error(que);
};

/** La barra se esconde con el estadio, la espera en grande y una ventana. */
async function superpuestos(page, ctx) {
  const quien = `${ctx.etiqueta} ${ctx.tema}`;
  // Se saca el botón de la pantalla para que la barra esté puesta: si no, esconderla no prueba nada.
  await page.eval("scrollTo(0, document.documentElement.scrollHeight); true");
  await sleep(700);
  let m = await medir(page, REAL.espera);
  if (!(m.barra.existe && m.barra.on)) {
    check(`${quien} · la barra está puesta con el botón fuera de la pantalla`, false, "no apareció al bajar al pie");
    return;
  }
  check(`${quien} · la barra está puesta con el botón fuera de la pantalla`, true);
  // El pie de la página queda sobre la barra, entero.
  const pie = m.pie;
  check(`${quien} · la barra no tapa el pie de la página`, !!pie && pie.bottom <= m.barra.caja.top + 1, pie ? `el pie termina en ${Math.round(pie.bottom)} y la barra empieza en ${Math.round(m.barra.caja.top)}` : "no se ve el pie");
  // Con la espera en grande abierta, la barra no está.
  await page.eval("document.getElementById('btn-espera').click(); true");
  const abrio = await page.waitFor("document.querySelector('.espera')", 15000);
  await sleep(500);
  m = await medir(page, REAL.espera);
  check(`${quien} · con la espera en grande abierta no hay barra`, abrio.ok && !m.barra.on && m.barra.inert, abrio.ok ? "" : "no abrió la espera en grande");
  await page.eval("document.querySelector('.espera [data-volver]')?.click(); true");
  await page.waitFor("!document.querySelector('.espera')", 8000);
  await sleep(600);
  m = await medir(page, REAL.espera);
  check(`${quien} · al cerrarla la barra vuelve`, !!m.barra.on, "");
  // Y con una ventana abierta (el panel de la cuenta).
  await page.eval("document.querySelector('#wallet-box .hello')?.click(); true");
  const panel = await page.waitFor("document.querySelector('.modal-back')", 15000);
  await sleep(500);
  m = await medir(page, REAL.espera);
  check(`${quien} · con una ventana abierta no hay barra`, panel.ok && !m.barra.on && m.barra.inert, panel.ok ? "" : "no abrió el panel de la cuenta");
  await page.eval("document.querySelectorAll('.modal-back').forEach((e) => e.remove()); true");
  await sleep(600);
  m = await medir(page, REAL.espera);
  check(`${quien} · al cerrarla la barra vuelve`, !!m.barra.on, "");
  // De vuelta arriba de la lista sellada.
  await page.eval("document.getElementById('sec-frozen').scrollIntoView({ block: 'start' }); true");
  await quieto(page);
}

/** El recorrido de una pantalla, en un tema. Devuelve si llegó hasta el final. */
async function recorrer(browser, vista, tema, caso) {
  const [etiqueta, ancho, alto, dpr, celular] = vista;
  const ctx = { etiqueta, tema, celular };
  const quien = `${etiqueta} ${tema}`;
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: celular, screenWidth: ancho, screenHeight: alto });
    await page.send("Page.navigate", { url: `${base}/?theme=${tema}&lang=${lang}&pace=rapido` });
    await page.waitFor("document.readyState === 'complete'", 20000);

    // La cuenta de prueba: se conecta sola y le carga fondos.
    await page.waitFor("document.querySelector('#gate button, #wallet-box button')", 20000);
    await sleep(500);
    await page.eval("(document.querySelector('#gate button') || document.querySelector('#wallet-box button')).click(); true");
    const ventana = await page.waitFor("document.querySelector('.login-opt')", 15000);
    hayFalla(!ventana.ok, "no se abrió la ventana de ingreso");
    await sleep(300);
    const i = await page.eval(`String([...document.querySelectorAll('.login-opt')].findIndex((e) => /prueba|Test account/.test(e.textContent)))`);
    hayFalla(i === "-1", "la ventana de ingreso no ofrece la cuenta de prueba");
    await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].click(); true`);
    const entro = await page.waitFor("!document.querySelector('.modal-back') && document.querySelector('#wallet-box .hello')", 120000);
    hayFalla(!entro.ok, "la cuenta de prueba no quedó conectada");
    await sleep(900);

    // 1. Lista cargada.
    if (caso === "sin-resto") {
      await page.eval(`(() => { const ta = document.getElementById('ta'); ta.value = 'Ana Quispe\\nBeto Mamani'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('nw').value = '2'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    } else {
      await page.eval(`document.getElementById('nw').value = '2'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('btn-sample').click(); true`);
    }
    await sleep(900);
    // La tarjeta de participantes arriba: ahí queda quien pega la lista.
    await page.eval("document.getElementById('sec-participants').scrollIntoView({ block: 'start' }); true");
    await quieto(page);
    await paso(page, ctx, 1, "lista cargada", { paso: 2, real: REAL.lista });
    // El inicio de la página, con el indicador arriba y la lista cargada.
    const viaBarraSello = await pulsar(page, ctx, REAL.lista, "sellar");

    // 2. Sellada y esperando la ronda.
    // Termina cuando quedó sellada o cuando falló: con un error la página
    // vuelve a prender el botón de sellar y deja el motivo escrito. Sin mirar
    // eso se esperaban los 240 s enteros para nada.
    const selladaEn = await page.waitFor(
      `(getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none')
        || (document.getElementById('seal-status').style.display === 'block' && !document.getElementById('btn-freeze').disabled && !document.getElementById('seal-status').textContent.includes('…'))`,
      selloMax,
    );
    const selladaOk = selladaEn.ok && (await page.eval("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'"));
    if (!selladaOk) {
      const motivo = await page.eval("(document.getElementById('seal-status') || {}).textContent || ''");
      throw new Error(`el sellado ${selladaEn.ok ? "falló" : `no terminó en ${Math.round(selloMax / 1000)} s`}${motivo ? ` (${String(motivo).slice(0, 90)})` : ""}${viaBarraSello ? " [se apretó la barra]" : ""}`);
    }
    info(`sellada en ${(selladaEn.elapsed / 1000).toFixed(1)} s`);
    await quieto(page);
    const espera = await paso(page, ctx, 2, "sellada y esperando", { paso: 3, real: REAL.espera, importante: ["la espera"] });
    check(`${quien} · 2 sellada y esperando: el botón dice cuánto falta`, !!espera.m.real && /\d+:\d\d/.test(espera.m.real.texto) && espera.m.real.off, espera.m.real ? `"${espera.m.real.texto}"` : "");
    check(
      `${quien} · 2 sellada y esperando: la línea de paso nombra el paso y la cuenta`,
      !espera.m.barra.existe || !espera.m.barra.on || /3.*4/.test(espera.m.barra.paso) && /\d+:\d\d/.test(espera.m.barra.paso),
      espera.m.barra.on ? espera.m.barra.paso : "",
    );
    check(`${quien} · 2 sellada y esperando: el aviso del cambio de paso es un lector de pantalla amable`, !!espera.m.avisoVivo && espera.m.avisoVivo.live === "polite" && espera.m.avisoVivo.rol === "status", espera.m.avisoVivo ? "" : "no hay #sig-aviso");
    check(`${quien} · 2 sellada y esperando: la barra es una región con nombre`, !espera.m.barra.existe || (espera.m.barra.region === "region" && !!espera.m.barra.nombre), espera.m.barra.existe ? `"${espera.m.barra.nombre}"` : "no hay barra");
    await superpuestos(page, ctx);

    // 3. La ronda ya nació.
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 180000);
    hayFalla(!nacio.ok, "la ronda no nació en tres minutos");
    await sleep(500);
    await quieto(page);
    const lista = await paso(page, ctx, 3, "ronda lista", { paso: 3, real: REAL.ronda });
    check(`${quien} · 3 ronda lista: el botón está encendido y dice qué hace`, !!lista.m.real && !lista.m.real.off && /Lanzar|Run the draw/.test(lista.m.real.texto), lista.m.real ? `"${lista.m.real.texto}"` : "");
    check(`${quien} · 3 ronda lista: se enciende con un pulso`, !!lista.m.real && /\blista\b/.test(lista.m.real.clases) && lista.m.real.anim !== "none", lista.m.real ? `animación ${lista.m.real.anim}` : "");
    // Con el movimiento reducido el pulso se apaga y el aro queda quieto.
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await sleep(200);
    const quietoM = await medir(page, REAL.ronda);
    check(`${quien} · 3 ronda lista: con movimiento reducido el pulso se apaga`, !!quietoM.real && quietoM.real.anim === "none", quietoM.real ? `animación ${quietoM.real.anim}` : "");
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
    // El botón sale de la pantalla y la barra lo reemplaza: el sorteo se lanza desde ahí.
    await page.eval("scrollTo(0, scrollY + document.documentElement.clientHeight * 2.2); true");
    await sleep(900);
    const fuera = await medir(page, REAL.ronda);
    const barraEnc = !!(fuera.barra.existe && fuera.barra.on && fuera.barra.btn && !fuera.barra.btn.off);
    check(`${quien} · 3 ronda lista: con el botón fuera la barra lo ofrece encendido`, barraEnc && /Lanzar|Run the draw/.test(fuera.barra.btn.texto), fuera.barra.existe ? `"${fuera.barra.btn?.texto ?? ""}"` : "no hay barra");
    check(`${quien} · 3 ronda lista: el pulso también está en la barra`, barraEnc && fuera.barra.btn.anim !== "none", barraEnc ? `animación ${fuera.barra.btn.anim}` : "");
    check(`${quien} · 3 ronda lista: la barra lleva la línea del paso`, barraEnc && /3.*4/.test(fuera.barra.paso), fuera.barra.paso);
    const viaBarraSorteo = await pulsar(page, ctx, REAL.ronda, "lanzar el sorteo");

    // 4. Sortear: estadio, saltar, resultado.
    const estadio = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 120000);
    hayFalla(!estadio.ok, `el sorteo no abrió el estadio${viaBarraSorteo ? " (se apretó la barra)" : ""}`);
    await sleep(1200);
    const durante = await medir(page, REAL.ronda);
    check(`${quien} · con el estadio abierto no hay barra`, !durante.barra.on && durante.barra.inert, "");
    await page.eval("document.getElementById('st-skip').click(); true");
    const sale = await page.waitFor("getComputedStyle(document.getElementById('winner-box')).display !== 'none' && getComputedStyle(document.getElementById('again-row')).display !== 'none'", 120000);
    hayFalla(!sale.ok, "no apareció el resultado");
    await sleep(900);
    await quieto(page, 1200, 6000);
    const real4 = caso === "sin-resto" ? REAL.comprobante : REAL.resultado;
    const res = await paso(page, ctx, 4, caso === "sin-resto" ? "resultado, no queda nadie" : "resultado", { paso: 4, real: real4, importante: ["el primer ganador"] });
    // "Lo que sigue" va pegado al ganador, antes de "Mostrar en grande" y de la verificación.
    const g = res.m.ganadores;
    const o = res.m.otro;
    check(
      `${quien} · 4 resultado: lo que sigue va pegado al ganador`,
      !!g && !!o && o.top >= g.bottom - 1 && o.top - g.bottom <= 90,
      g && o ? `${Math.round(o.top - g.bottom)} px debajo de los ganadores` : "falta el bloque",
    );
    check(
      `${quien} · 4 resultado: va antes de "Mostrar en grande" y de la verificación`,
      !!o && !!res.m.grande && !!res.m.verifica && o.bottom <= res.m.grande.top + 1 && o.bottom <= res.m.verifica.top + 1,
      "",
    );
    const t4 = res.m.real?.texto ?? "";
    check(
      `${quien} · 4 resultado: la acción principal es ${caso === "sin-resto" ? '"Compartir el comprobante"' : '"Siguiente premio" con cuántos quedan'}`,
      caso === "sin-resto" ? /Compartir el comprobante|Share the receipt/.test(t4) : /Siguiente premio|Next prize/.test(t4) && /\d+/.test(t4),
      `"${t4}"`,
    );
    // Lo demás es secundario: el comprobante y "usar otra lista" no llevan el color de la acción principal.
    const clases = JSON.parse(await page.eval(`JSON.stringify({ sin: document.getElementById('btn-again-sin').className, prueba: document.getElementById('btn-proof').className, otra: document.getElementById('btn-again-nueva').className })`));
    const esPrimario = (c) => /\bprimary\b/.test(c);
    check(
      `${quien} · 4 resultado: lo demás es secundario`,
      caso === "sin-resto" ? esPrimario(clases.prueba) && !esPrimario(clases.otra) : esPrimario(clases.sin) && !esPrimario(clases.prueba) && !esPrimario(clases.otra),
      `siguiente: ${clases.sin || "—"} · comprobante: ${clases.prueba || "—"} · otra lista: ${clases.otra || "—"}`,
    );
    if (caso === "sin-resto") {
      info("sin siguiente premio: queda el comprobante");
      return { ok: true, page };
    }

    // 5. Siguiente premio.
    await pulsar(page, ctx, REAL.resultado, "siguiente premio");
    const volvio = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display === 'none' && getComputedStyle(document.getElementById('again-note')).display !== 'none'", 20000);
    hayFalla(!volvio.ok, "'Siguiente premio' no devolvió a la lista");
    await sleep(500);
    await quieto(page, 900, 5000);
    await paso(page, ctx, 5, "siguiente premio", { paso: 2, real: REAL.siguiente });
    return { ok: true, page };
  } catch (e) {
    return { ok: false, page, error: e };
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`\nAuditando el flujo contra ${base}`);
  console.log(`  pantallas: ${VISTAS.map((v) => `${v[0]} ${v[1]}x${v[2]}`).join(", ")} · temas: ${temas.join(", ")} · capturas en ${outDir}\n`);
  for (const tema of temas) {
    for (const vista of VISTAS) {
      for (const caso of ["resto", ...(sinResto.includes(vista[0]) && tema === temas[0] ? ["sin-resto"] : [])]) {
        let hecho = false;
        for (let intento = 0; intento <= reintentos && !hecho; intento++) {
          // Las comprobaciones de un intento que se descarta no cuentan: el recorrido se repite entero.
          const antes = { total, fallas };
          // Un Chrome nuevo por recorrido: cada uno es una persona que llega por primera vez, con su cuenta de prueba.
          const browser = await launch({ width: vista[1], height: vista[2] });
          try {
            const r = await recorrer(browser, vista, tema, caso);
            if (r.ok) {
              check(`${vista[0]} ${tema}${caso === "sin-resto" ? " (sin resto)" : ""}: sin excepciones`, r.page.exceptions.length === 0, r.page.exceptions.slice(0, 2).join(" | "));
              hecho = true;
            } else {
              const ultimo = intento === reintentos;
              console.log(`  ${ultimo ? "✗" : "…"} ${vista[0]} ${tema}${caso === "sin-resto" ? " (sin resto)" : ""}: el recorrido se cortó: ${String(r.error?.message ?? r.error).slice(0, 200)}${ultimo ? "" : " · se descarta y se reintenta en 15 s"}`);
              if (ultimo) {
                total++;
                fallas++;
              } else {
                total = antes.total;
                fallas = antes.fallas;
              }
            }
          } finally {
            await browser.close();
          }
          // Testnet a veces rechaza en seguido: un respiro antes de repetir.
          if (!hecho && intento < reintentos) await sleep(15000);
        }
      }
    }
  }
}

main()
  .catch((e) => {
    total++;
    fallas++;
    console.log(`  ✗ la auditoría corrió sin caerse · ${String(e).slice(0, 200)}`);
  })
  .finally(() => {
    console.log("");
    console.log(fallas ? `RECHAZADO: ${total - fallas}/${total} comprobaciones` : `APROBADO: ${total}/${total} comprobaciones`);
    console.log(`Capturas en ${outDir}/flujo-*.png\n`);
    process.exit(fallas ? 1 : 0);
  });
