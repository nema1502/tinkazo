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
 * Mira también qué pasa cuando la red falla (`--fallos`, la contingencia de la
 * red, docs/ux.md "Cuando la red falla"). La app mira la red ANTES de que la
 * sala espere y, si no deja sellar, dice una frase y ofrece una sola acción que
 * reemplaza a "Sellar la lista". Cuatro casos, cada uno en otro Chrome y en el
 * primer tema:
 *  1. los dos RPC cortados: "Stellar no contesta", la acción es "Probar ahora",
 *     se ve en la pantalla (aunque se apriete la barra) y no se selló nada; y,
 *     en la primera pantalla, al volver la red la app sella sola;
 *  2. solo el primer RPC cortado (primera pantalla): se sella por el segundo, sin
 *     avisar nada;
 *  3. costo alto: la simulación del sello devuelve el costo del 25 de octubre
 *     (69 XLM, `Fetch.fulfillRequest` con el fixture). Pide restaurar el contrato
 *     (rojo): la frase del caso 1, "Seguir sin sello" con su confirmación (sin
 *     "verificable" ni XLM) y "Esperar a la red". Y si de verdad se sigue ("Seguir
 *     igual"), nada de lo que se lee dice "sellada" ni invita a comprobar lo que
 *     no se puede comprobar: el título de la sección, la línea de la cuenta, la
 *     espera en grande y, en la primera pantalla (espera la ronda de 90 s), el QR
 *     del resultado y la pantalla grande (protocolo §8). Y con la cuenta de prueba,
 *     que paga ella, el costo alto solo avisa (amarillo) y se puede sellar;
 *  4. sin saldo: Horizon dice que la cuenta tiene 0,01 XLM; "Cargar saldo de prueba".
 * Solo dos mandan una transacción, y de verdad, a la testnet con la cuenta de prueba (y solo en la primera pantalla):
 * "al volver la red, sella sola" y "el primer RPC cortado sella por el segundo". En los demás se corta todo
 * `sendTransaction`. `--fallos none` los saltea.
 *
 * Al final mira también unos anchos de celular que esas pantallas no cubren
 * (320, 360, 375 y 414 px: 360 y 375 son los más comunes). Es rápido y no graba
 * nada en Stellar: ahí el ancho rompe el indicador de pasos y el texto de los
 * botones, y fue donde aparecieron "Siguiente premio" partido con un punto
 * suelto y el indicador pegado al borde. `--solo-anchos` corre solo eso.
 *
 * Uso:
 *   node scripts/audit-flujo.mjs [--base http://localhost:4173] [--out DIR]
 *                                [--vistas laptop-100,celular] [--temas dark,light]
 *                                [--sin-resto laptop-100,celular-h] [--lang es|en]
 *                                [--fallos laptop-100,celular-h | none]
 *                                [--anchos 320,360,375,414 | none]
 *                                [--solo-anchos | --solo-fallos] [--casos "costo alto,sin saldo"]
 *                                [--sello-max 240] [--reintentos 2]
 *
 * Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto> node ...
 * Sale con código 1 si algo falla.
 */

import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";

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
// El caso en que no queda nadie sin premio ("Compartir el resultado" es la
// acción principal) es otro sorteo entero: se mira en las pantallas más justas.
const sinResto = opt("--sin-resto", "laptop-100,celular-h").split(",").filter(Boolean);
const selloMax = Number(opt("--sello-max", "240")) * 1000;
const reintentos = Number(opt("--reintentos", "2"));
// Los anchos de celular que las cinco pantallas no cubren ("none" los saltea).
const anchos = opt("--anchos", "320,360,375,414").split(",").filter((a) => a && a !== "none").map(Number);
const soloAnchos = args.includes("--solo-anchos");
const soloFallos = args.includes("--solo-fallos");

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
if (anchos.some((a) => !Number.isFinite(a) || a < 280 || a > 1000)) {
  console.error("uso: --anchos 320,360,375,414 (anchos de celular, entre 280 y 1000 px) o --anchos none");
  process.exit(2);
}
// Las pantallas donde se prueba el sellado que falla, apretado desde lo que se ve ("none" lo saltea).
const fallos = opt("--fallos", TODAS.map((v) => v[0]).join(",")).split(",").filter((f) => f && f !== "none");
// `--casos "costo alto"`: solo los casos de red cuyo nombre lleve alguna de esas palabras (para repetir uno).
const soloCasos = opt("--casos", "").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean);

let fallas = 0;
let total = 0;
const registro = [];
/** Cada comprobación sale apenas se hace: el recorrido dura minutos y se tiene que ver cómo va. */
function check(nombre, ok, detalle = "") {
  registro.push({ nombre, ok, detalle });
  total++;
  if (!ok) fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
  return ok;
}
const info = (texto) => console.log(`    ${texto}`);

/** Qué botón de verdad hace avanzar cada paso. */
const REAL = {
  // Con la lista vacía, "Pegar lista" (desde el 22 de octubre de 2026, diseño del onboarding).
  vacia: "#btn-pegar",
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
  // La geometría del indicador, para saber si entra en una sola línea y sin cortarse: no importa si se ve ahora.
  const lis = [...document.querySelectorAll('#pasos li')].map((li) => li.getBoundingClientRect());
  const pasosGeo = lis.length ? { arriba: Math.round(Math.min(...lis.map((r) => r.top))), abajo: Math.round(Math.max(...lis.map((r) => r.bottom))), alto: Math.round(Math.max(...lis.map((r) => r.height))), izq: Math.round(Math.min(...lis.map((r) => r.left))), der: Math.round(Math.max(...lis.map((r) => r.right))), lineas: new Set(lis.map((r) => Math.round(r.top / 4))).size } : null;
  // "Pegar lista" es la principal con la lista vacía y vuelve a ser un origen con la lista cargada; "¿Cómo se usa?"
  // y la oferta de primera vez no tienen nunca el color de la casa (diseño del onboarding, 22 de octubre de 2026).
  const principales = ['#btn-freeze', '#btn-draw', '#btn-again-sin', '#btn-proof', '#btn-again-nueva', '#sig-btn', '#btn-pegar', '#btn-como', '#primera-vez button', '#como-panel button']
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
    pasosGeo,
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
  // 6b. Y entra en una sola línea, sin cortarse por los costados de la pantalla (el celular parado es el justo).
  const pg = m.pasosGeo;
  check(
    `${quien} · ${n} ${nombre}: el indicador entra en una sola línea`,
    !!pg && pg.lineas === 1 && pg.izq >= -1 && pg.der <= m.vp.w + 1,
    pg ? `${pg.lineas} línea, de ${pg.izq} a ${pg.der} de ${m.vp.w}` : "no hay indicador",
  );
  // 7. Toques y contraste de lo que se ve.
  const s = JSON.parse(await page.eval(SONDA));
  if (celular) check(`${quien} · ${n} ${nombre}: blancos de toque de 44 px`, s.toques.length === 0, s.toques.slice(0, 3).map((x) => `"${x.t}" ${x.h}px`).join(" | "));
  check(`${quien} · ${n} ${nombre}: contraste del texto`, s.texto.length === 0, s.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.pide}`).join(" | "));
  // 8. La captura. El caso "sin resto" repite los pasos 1 a 3 con una lista de dos: sus capturas pisaban las
  //    del recorrido principal (mismo nombre), y lo que se miraba como "la lista cargada" era esa lista chica.
  //    De ese caso se guarda solo el resultado, que es lo que lo distingue.
  if (ctx.caso !== "sin-resto" || n >= 4) {
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-${n}-${sinTildes(nombre).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`));
  }
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

/** La cuenta de prueba: se conecta sola y le carga fondos. Lanza si algo no sale, para repetir el recorrido. */
async function conectarCuentaDePrueba(page) {
  // Una segunda pantalla en el mismo Chrome (el costo alto abre dos) ya trae la cuenta de prueba de la primera, en el
  // almacenamiento del navegador: la sesión se retoma sola y no hay ventana de ingreso que abrir.
  if (await page.eval("String(!!localStorage.getItem('tinkazo.guest.secret.testnet'))") === "true") {
    const vuelta = await page.waitFor("document.querySelector('#wallet-box .hello')", 30000);
    hayFalla(!vuelta.ok, "la cuenta de prueba de antes no se retomó");
    await sleep(900);
    return;
  }
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
}

/**
 * Dónde queda el mensaje del sellado, para saber si se ve: sin contar la cabecera fija ni, si está puesta, la barra.
 */
const MEDIR_MENSAJE = `JSON.stringify((() => {
  const s = document.getElementById('seal-status');
  const cs = getComputedStyle(s);
  const r = s.getBoundingClientRect();
  const cab = document.querySelector('header');
  const arriba = cab && getComputedStyle(cab).position === 'sticky' ? Math.round(cab.getBoundingClientRect().bottom) : 0;
  const bar = document.getElementById('siguiente');
  const abajo = bar.classList.contains('on') ? Math.round(bar.getBoundingClientRect().top) : innerHeight;
  return { visible: cs.display !== 'none', texto: (s.textContent || '').trim().slice(0, 100), top: Math.round(r.top), bottom: Math.round(r.bottom), arriba, abajo, alto: innerHeight };
})())`;

/**
 * Lo que se lee de la caja de la red (`#red-estado`) y del botón de sellar, para saber si se ve:
 * sin contar la cabecera fija ni, si está puesta, la barra.
 */
const MEDIR_RED = `JSON.stringify((() => {
  const c = document.getElementById('red-estado');
  const cs = getComputedStyle(c);
  const r = c.getBoundingClientRect();
  const cab = document.querySelector('header');
  const arriba = cab && getComputedStyle(cab).position === 'sticky' ? Math.round(cab.getBoundingClientRect().bottom) : 0;
  const bar = document.getElementById('siguiente');
  const abajo = bar.classList.contains('on') ? Math.round(bar.getBoundingClientRect().top) : innerHeight;
  const f = document.getElementById('btn-freeze');
  return {
    visible: cs.display !== 'none',
    texto: (c.textContent || '').trim().slice(0, 240),
    clase: c.className,
    top: Math.round(r.top), bottom: Math.round(r.bottom), arriba, abajo,
    boton: (f.textContent || '').trim(),
    botones: [...c.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
    sellada: getComputedStyle(document.getElementById('sec-frozen')).display !== 'none',
  };
})())`;

/** Los textos de la contingencia, en los dos idiomas: lo que se espera ver. */
const TEXTO = {
  sinRpc: /Stellar no contesta|Stellar isn't answering/i,
  costoAlto: /cuesta más de lo que Tinkazo puede pagar|costs more today than Tinkazo can cover/i,
  costoMedio: /cuesta más de lo normal|costs more than usual/i,
  sinSaldo: /no tiene saldo para sellar|has no balance to seal/i,
  probar: /^(Probar ahora|Try now)$/,
  cargar: /^(Cargar saldo de prueba|Add test funds)$/,
  seguirSin: /^(Seguir sin sello|Continue without a seal)$/,
  seguirIgual: /^(Seguir igual|Continue anyway)$/,
  esperar: /^(Esperar a la red|Wait for the network)$/,
  confirma: /Sin sello, nadie va a poder comprobar|Without a seal, nobody will be able to check/i,
};

/**
 * Corta, falsea o deja pasar lo que la página le pide a otros servidores. `decidir(request)` devuelve
 * "fallar", "seguir" o `{ cuerpo, estado }` para contestar en su lugar. Nunca cierra ni habilita nada
 * más que lo que pide: la prueba no manda transacciones.
 */
async function interceptar(page, patrones, decidir) {
  page.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId, request } = m.params;
    const accion = decidir(request) ?? "seguir";
    if (accion === "fallar") {
      page.send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" }).catch(() => {});
    } else if (accion === "seguir") {
      page.send("Fetch.continueRequest", { requestId }).catch(() => {});
    } else {
      page
        .send("Fetch.fulfillRequest", {
          requestId,
          responseCode: accion.estado ?? 200,
          responseHeaders: [
            { name: "content-type", value: "application/json" },
            { name: "access-control-allow-origin", value: "*" },
          ],
          body: Buffer.from(accion.cuerpo).toString("base64"),
        })
        .catch(() => {});
    }
  });
  await page.send("Fetch.enable", { patterns: patrones.map((urlPattern) => ({ urlPattern })) });
}

/** El nombre del método de JSON-RPC de un pedido al RPC, o "" si no lo es. */
const metodoRpc = (request) => {
  if (request.method !== "POST" || !request.postData) return "";
  try {
    return String(JSON.parse(request.postData).method ?? "");
  } catch {
    return "";
  }
};

const fixture = (nombre) => readFileSync(new URL(`../src/stellar/fixtures/${nombre}`, import.meta.url), "utf8");

/** Una pantalla lista para probar la red: la cuenta de prueba conectada, el ejemplo cargado y la tarjeta arriba. */
async function abrirParaLaRed(browser, vista, tema, antesDeLaLista) {
  const [, ancho, alto, dpr, celular] = vista;
  const page = await browser.open("about:blank");
  await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: celular, screenWidth: ancho, screenHeight: alto });
  await page.send("Page.navigate", { url: `${base}/?theme=${tema}&lang=${lang}&pace=rapido` });
  await page.waitFor("document.readyState === 'complete'", 20000);
  await conectarCuentaDePrueba(page);
  await antesDeLaLista?.(page);
  await page.eval(`document.getElementById('nw').value = '2'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('btn-sample').click(); true`);
  await sleep(900);
  await page.eval("document.getElementById('sec-participants').scrollIntoView({ block: 'start' }); true");
  await quieto(page);
  return page;
}

async function cerrar(page) {
  for (const metodo of ["Fetch.disable", "Page.close"]) {
    try {
      await page.send(metodo);
    } catch {
      /* ya cerrada */
    }
  }
}

/** La caja de la red se ve en la pantalla y queda una sola acción a la vista (el botón de verdad o la barra). */
async function cajaYAccionAlaVista(page, quien, ctx) {
  await sleep(600);
  await quieto(page);
  const msg = JSON.parse(await page.eval(MEDIR_RED));
  const seVe = msg.visible && msg.top >= msg.arriba - 1 && msg.bottom <= msg.abajo + 1;
  check(`${quien}: lo que dice la red se ve en la pantalla`, seVe, seVe ? `"${msg.texto.slice(0, 70)}"` : `queda en ${msg.top}–${msg.bottom}, la pantalla útil va de ${msg.arriba} a ${msg.abajo}`);
  const m = await medir(page, REAL.lista);
  const verReal = aLaVista(m.real?.caja ?? null, m);
  const verBarra = !!(m.barra.existe && m.barra.on && m.barra.btn?.caja && aLaVista(m.barra.btn.caja, m));
  check(`${quien}: una sola acción principal a la vista`, verReal !== verBarra, verReal ? `el botón "${m.real.texto}"` : verBarra ? `la barra: "${m.barra.btn.texto}"` : "ninguna");
  const prin = m.principales.filter((p) => aLaVista(p.caja, m));
  check(`${quien}: nunca dos botones principales a la vista`, prin.length <= 1, prin.map((p) => `#${p.id}`).join(" y "));
  const s = JSON.parse(await page.eval(SONDA));
  if (ctx.celular) check(`${quien}: blancos de toque de 44 px`, s.toques.length === 0, s.toques.slice(0, 3).map((x) => `"${x.t}" ${x.h}px`).join(" | "));
  check(`${quien}: contraste del texto`, s.texto.length === 0, s.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.pide}`).join(" | "));
  check(`${quien}: sin scroll horizontal`, m.scrollX <= 1, `${m.scrollX}px`);
  return { msg, m, verReal, verBarra };
}

/**
 * La red de Stellar no contesta: los dos RPC cortados. Antes la app dejaba apretar "Sellar" y fallaba al rato,
 * con el motivo escrito junto a un botón que, si se apretaba la barra, quedaba fuera de la pantalla (20 de octubre
 * de 2026). Ahora lo mira antes: dice "Stellar no contesta", la acción de ahí en adelante es "Probar ahora" (que
 * reemplaza a "Sellar la lista") y no se selló nada. En la primera pantalla, además, al volver la red la app
 * sella sola: la persona había apretado "Sellar la lista" y la red volvió.
 */
async function falloDelSello(browser, vista, tema, completo) {
  const [etiqueta, , , , celular] = vista;
  const quien = `${etiqueta} ${tema} · la red no contesta`;
  const page = await abrirParaLaRed(browser, vista, tema);
  try {
    // Los dos RPC de testnet dejan de contestar DESPUÉS de cargar la lista: lo último que se midió (hace menos de
    // 60 s) decía "bien", y es lo difícil: el sello falla, y la app tiene que mirar de nuevo y decirlo en vez de
    // dejar un error genérico.
    await interceptar(page, ["*soroban-testnet.stellar.org*", "*rpc.ankr.com*"], () => "fallar");
    const usaBarra = await pulsar(page, { etiqueta, tema, celular }, REAL.lista, "sellar con la red caída");
    const dijo = await page.waitFor(`(() => { const c = document.getElementById('red-estado'); return getComputedStyle(c).display !== 'none' && /Stellar no contesta|Stellar isn't answering/i.test(c.textContent || ''); })()`, 60000);
    check(`${quien}: lo dice antes de sellar${usaBarra ? " (se apretó la barra)" : ""}`, dijo.ok, dijo.ok ? "" : "no apareció la frase en 60 s: ¿cambió el servidor de Stellar o el RPC de respaldo?");
    if (!dijo.ok) return;
    const { msg } = await cajaYAccionAlaVista(page, quien, { celular });
    check(`${quien}: la acción de ahora reemplaza a "Sellar la lista" y es "Probar ahora"`, TEXTO.probar.test(msg.boton), `el botón dice "${msg.boton}"`);
    check(`${quien}: no se selló nada`, !msg.sellada, msg.sellada ? "la lista quedó sellada" : "");
    check(`${quien}: la frase no dice RPC, fee ni XLM`, !/\bRPC\b|\bfee\b|XLM|stroop/i.test(msg.texto + msg.boton), msg.texto.slice(0, 80));
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-6-la-red-no-contesta.png`));

    if (completo) {
      // La red vuelve: a los 15 s la app vuelve a probar sola y, como la persona había apretado "Sellar la lista", sella.
      await page.send("Fetch.disable");
      const sello = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", selloMax);
      check(`${quien}: al volver la red, sella sola`, sello.ok, sello.ok ? `en ${(sello.elapsed / 1000).toFixed(0)} s` : `no selló en ${Math.round(selloMax / 1000)} s`);
    }
  } finally {
    await cerrar(page);
  }
}

/**
 * Solo el primer RPC cortado: se sella por el segundo, sin avisar nada. Es el cambio automático de RPC; manda una
 * transacción real a la testnet, como el recorrido de siempre, y por eso va en una sola pantalla.
 */
async function primerRpcCortado(browser, vista, tema) {
  const [etiqueta, , , , celular] = vista;
  const quien = `${etiqueta} ${tema} · el primer RPC cortado`;
  const page = await abrirParaLaRed(browser, vista, tema);
  try {
    await interceptar(page, ["*soroban-testnet.stellar.org*"], () => "fallar");
    await pulsar(page, { etiqueta, tema, celular }, REAL.lista, "sellar con el primer RPC caído");
    const sello = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", selloMax);
    check(`${quien}: sella igual, por el segundo`, sello.ok, sello.ok ? `en ${(sello.elapsed / 1000).toFixed(0)} s` : `no selló en ${Math.round(selloMax / 1000)} s`);
    const caja = JSON.parse(await page.eval(MEDIR_RED));
    check(`${quien}: no avisó nada de la red`, !caja.visible || !TEXTO.sinRpc.test(caja.texto), caja.texto.slice(0, 80));
  } finally {
    await cerrar(page);
  }
}

/**
 * Un sorteo que se siguió sin sello nunca suena a sellado ni invita a comprobar (protocolo §8: lo que no está anclado
 * jamás se presenta como verificable). "Sin sello: no se puede comprobar" no invita a nada, es lo que se quiere decir;
 * cualquier otro "comprobar", "verificar" o "check" sí.
 */
const NEGADO = /no se (?:puede|va a poder) comprobar|(?:can't|cannot|won't be able to) be (?:checked|verified)/gi;
const sueleASellada = (texto) => /sellad[oa]s?|sealed/i.test(texto);
const invitaAComprobar = (texto) => /comprob|verific|\bverif|\bcheck/i.test(texto.replace(NEGADO, ""));
const DICE_SIN_SELLO = /sin sello|no seal/i;
/** El texto no promete nada. */
const honesto = (texto) => !sueleASellada(texto) && !invitaAComprobar(texto);

/** Lo que se lee de la página de un sorteo sin sello: el título, la línea de la cuenta, el botón, los pasos, la nota y el QR. */
const LEER_SIN_SELLO = `JSON.stringify((() => {
  const txt = (s) => { const e = document.querySelector(s); return e ? (e.textContent || '').trim() : ''; };
  const vis = (s) => { const e = document.querySelector(s); return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
  const bar = document.getElementById('siguiente');
  return {
    titulo: txt('#sec-frozen .head h2'),
    linea: txt('#wait-box .wait-line'),
    boton: txt('#btn-freeze'),
    pasos: txt('#pasos'),
    barra: bar && bar.classList.contains('on') ? (bar.textContent || '').trim() : '',
    qr: txt('#qr-box .kicker'),
    qrVisible: vis('#qr-box'),
    nota: txt('#sin-sello-nota'),
    notaVisible: vis('#sin-sello-nota'),
  };
})())`;

/** Lo que se lee de una pantalla grande (la espera o el resultado): todo su texto, su pie y la leyenda del QR. */
const leerGrande = (sel) => `JSON.stringify((() => {
  const e = document.querySelector(${JSON.stringify(sel)});
  if (!e) return null;
  const pie = e.querySelector('.espera-pie, .sala-pie');
  const qr = e.querySelector('.pantalla-qr p');
  const vis = (x) => !!x && getComputedStyle(x).display !== 'none' && x.getBoundingClientRect().height > 0;
  return { texto: (e.innerText || '').replace(/\\s+/g, ' ').trim(), pie: pie ? (pie.textContent || '').trim() : '', pieVisible: vis(pie), pieClase: pie ? pie.className : '', qr: qr ? (qr.textContent || '').trim() : '' };
})())`;

/**
 * "Seguir sin sello" de verdad (con la confirmación): lo que se lee mientras se espera, en la página y en la espera en
 * grande, y, si `completo`, en el resultado (el QR y la pantalla grande), no dice "sellada" ni invita a comprobar. El
 * resultado espera la ronda de 90 s: va solo en la primera pantalla. No manda nada: `sendTransaction` está cortado.
 */
async function seguirSinSelloDeVerdad(page, ctx, completo, quien) {
  const { etiqueta, tema } = ctx;
  await pulsar(page, ctx, REAL.lista, "seguir sin sello (para seguir de verdad)");
  const confirma = await page.waitFor(`/Seguir igual|Continue anyway/.test(document.getElementById('btn-freeze').textContent)`, 10000);
  check(`${quien} · seguir sin sello: vuelve a pedir confirmar`, confirma.ok);
  if (!confirma.ok) return;
  // La pregunta ignora el toque de los primeros 800 ms (el del botón de antes): se espera un poco más.
  await sleep(1300);
  await pulsar(page, ctx, REAL.lista, "seguir igual");
  const sigue = await page.waitFor(`getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none'`, 30000);
  check(`${quien} · seguir sin sello: la lista queda cerrada y corre la cuenta`, sigue.ok);
  if (!sigue.ok) return;
  await sleep(1500);
  await quieto(page);

  const en = `${quien} · seguir sin sello, esperando`;
  let p = JSON.parse(await page.eval(LEER_SIN_SELLO));
  check(`${en}: el título de la sección dice que no hay sello y no dice "sellada"`, honesto(p.titulo) && DICE_SIN_SELLO.test(p.titulo), `"${p.titulo}"`);
  check(`${en}: la línea bajo la cuenta lo dice y no promete nada`, honesto(p.linea) && DICE_SIN_SELLO.test(p.linea), `"${p.linea}"`);
  check(`${en}: el botón, los pasos y la barra no dicen "sellada"`, honesto(`${p.boton} ${p.pasos} ${p.barra}`), `"${p.boton}" / "${p.pasos}" / "${p.barra}"`);
  await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-10-sin-sello-esperando.png`));

  // La espera en grande es la que se proyecta a la sala: ahí se lee desde el fondo.
  await page.eval("document.getElementById('btn-espera').click(); true");
  const abrio = await page.waitFor("document.querySelector('.espera')", 15000);
  check(`${en}: se abre la espera en grande`, abrio.ok);
  if (abrio.ok) {
    await sleep(600);
    const g = JSON.parse(await page.eval(leerGrande(".espera")));
    check(`${en}: el pie de la espera en grande dice que no hay sello y no dice "sellada"`, !!g && honesto(g.pie) && DICE_SIN_SELLO.test(g.pie) && g.pieVisible, g ? `"${g.pie}"` : "no está");
    check(`${en}: nada de la espera en grande dice "sellada" ni invita a comprobar`, !!g && honesto(g.texto), g ? `"${g.texto.slice(0, 160)}"` : "no está");
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-11-sin-sello-espera-grande.png`));
    await page.eval("document.querySelector('.espera [data-volver]')?.click(); true");
    await page.waitFor("!document.querySelector('.espera')", 8000);
  }
  if (!completo) return;

  // El resultado: la ronda nace a los 90 s, se lanza el sorteo y se salta el show.
  const en2 = `${quien} · seguir sin sello, el resultado`;
  const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 180000);
  check(`${en2}: la ronda nació`, nacio.ok, nacio.ok ? `a los ${(nacio.elapsed / 1000).toFixed(0)} s` : "no nació en tres minutos");
  if (!nacio.ok) return;
  await sleep(500);
  await pulsar(page, ctx, REAL.ronda, "lanzar el sorteo sin sello");
  const estadio = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 120000);
  check(`${en2}: se abre el estadio`, estadio.ok);
  if (!estadio.ok) return;
  await sleep(1200);
  await page.eval("document.getElementById('st-skip').click(); true");
  const sale = await page.waitFor("getComputedStyle(document.getElementById('winner-box')).display !== 'none' && getComputedStyle(document.getElementById('again-row')).display !== 'none'", 120000);
  check(`${en2}: aparece el resultado`, sale.ok);
  if (!sale.ok) return;
  await sleep(1500);
  await quieto(page, 1200, 6000);
  p = JSON.parse(await page.eval(LEER_SIN_SELLO));
  check(`${en2}: la nota dice que no se puede comprobar`, p.notaVisible && DICE_SIN_SELLO.test(p.nota), `"${p.nota}"`);
  check(`${en2}: el QR dice que no hay sello y no invita a comprobar`, p.qrVisible && honesto(p.qr) && DICE_SIN_SELLO.test(p.qr), p.qrVisible ? `"${p.qr}"` : "el QR no se ve");
  await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-12-sin-sello-resultado.png`));

  // La pantalla grande del resultado: el pie "Sin sello" no se esconde y el QR no invita a comprobar.
  await page.eval("document.getElementById('btn-grande').click(); true");
  const grande = await page.waitFor("document.querySelector('.pantalla')", 15000);
  check(`${en2}: se abre el resultado en grande`, grande.ok);
  if (grande.ok) {
    await sleep(1500);
    const g = JSON.parse(await page.eval(leerGrande(".pantalla")));
    check(`${en2}: la pantalla grande dice "sin sello" a la vista`, !!g && g.pieVisible && /\bsin-sello\b/.test(g.pieClase) && DICE_SIN_SELLO.test(g.pie) && honesto(g.pie), g ? `"${g.pie}" ${g.pieVisible ? "(se ve)" : "(escondido)"}` : "no está");
    check(`${en2}: el QR de la pantalla grande no invita a comprobar`, !!g && honesto(g.qr), g ? `"${g.qr}"` : "no está");
    check(`${en2}: nada de la pantalla grande dice "sellada" ni invita a comprobar`, !!g && honesto(g.texto), g ? `"${g.texto.slice(0, 160)}"` : "no está");
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-13-sin-sello-pantalla-grande.png`));
    await page.eval("document.querySelector('.pantalla [data-cerrar]')?.click(); true");
  }
}

/**
 * El costo alto: la simulación del sello devuelve lo del 25 de octubre. Con el contrato por restaurar (rojo) la
 * app lo dice antes de sellar y la acción es "Seguir sin sello", que pide confirmar; con la cuenta de prueba (que
 * paga ella) un costo alto solo avisa. No manda nada: corta todo `sendTransaction`. `completo`: sigue sin sello
 * hasta el resultado (espera la ronda de 90 s).
 */
async function costoAlto(browser, vista, tema, completo = false) {
  const [etiqueta, , , , celular] = vista;
  const ctx = { etiqueta, tema, celular };
  let quien = `${etiqueta} ${tema} · costo alto (pide restaurar)`;
  let page = await abrirParaLaRed(browser, vista, tema, (p) =>
    interceptar(p, ["*soroban-testnet.stellar.org*"], (r) => {
      const metodo = metodoRpc(r);
      if (metodo === "simulateTransaction") return { cuerpo: fixture("rpc-simulate-sello-restaurar.json") };
      return metodo === "sendTransaction" ? "fallar" : "seguir";
    }),
  );
  try {
    // Sin apretar nada: con la cuenta y la lista a la vista la app mira la red sola y lo dice enseguida.
    const dijo = await page.waitFor(`(() => { const c = document.getElementById('red-estado'); return getComputedStyle(c).display !== 'none' && c.textContent.trim().length > 0; })()`, 60000);
    check(`${quien}: lo dice antes de sellar, sin que se apriete nada`, dijo.ok);
    if (!dijo.ok) return;
    let { msg } = await cajaYAccionAlaVista(page, quien, ctx);
    check(`${quien}: la frase del caso`, TEXTO.costoAlto.test(msg.texto), `"${msg.texto.slice(0, 80)}"`);
    check(`${quien}: la acción es "Seguir sin sello" y "Probar ahora" queda aparte`, TEXTO.seguirSin.test(msg.boton) && msg.botones.length === 1 && TEXTO.probar.test(msg.botones[0]), `${msg.boton} / ${msg.botones.join(", ")}`);
    check(`${quien}: no se selló nada`, !msg.sellada);
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-7-costo-alto.png`));

    // "Seguir sin sello" nunca sigue de un solo toque: pide confirmar, y desalienta.
    await pulsar(page, ctx, REAL.lista, "seguir sin sello (primer toque)");
    await sleep(600);
    ({ msg } = await cajaYAccionAlaVista(page, `${etiqueta} ${tema} · seguir sin sello`, ctx));
    check(`${etiqueta} ${tema} · seguir sin sello: pide confirmar`, TEXTO.confirma.test(msg.texto), `"${msg.texto.slice(0, 90)}"`);
    check(`${etiqueta} ${tema} · seguir sin sello: la acción pasa a ser "Seguir igual", con "Esperar a la red" aparte`, TEXTO.seguirIgual.test(msg.boton) && msg.botones.length === 1 && TEXTO.esperar.test(msg.botones[0]), `${msg.boton} / ${msg.botones.join(", ")}`);
    check(`${etiqueta} ${tema} · seguir sin sello: nada de "verificable" ni de XLM`, !/verific|XLM/i.test(msg.texto + msg.boton + msg.botones.join(" ")), msg.texto.slice(0, 80));
    check(`${etiqueta} ${tema} · seguir sin sello: todavía no se siguió`, !msg.sellada);
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-8-seguir-sin-sello.png`));
    // "Esperar a la red" vuelve a mirar y no sigue.
    await page.eval("[...document.querySelectorAll('#red-estado button')].find((b) => /Esperar a la red|Wait for the network/.test(b.textContent)).click(); true");
    const volvio = await page.waitFor(`/Seguir sin sello|Continue without a seal/.test(document.getElementById('btn-freeze').textContent) && !/Sin sello, nadie|Without a seal, nobody/.test(document.getElementById('red-estado').textContent)`, 30000);
    check(`${etiqueta} ${tema} · seguir sin sello: "Esperar a la red" vuelve a la frase del caso y no sigue`, volvio.ok);
    // Y si de verdad se sigue: nada de lo que se lee dice "sellada" ni invita a comprobar (protocolo §8).
    if (volvio.ok) await seguirSinSelloDeVerdad(page, ctx, completo, `${etiqueta} ${tema}`);
  } finally {
    await cerrar(page);
  }

  // Con la cuenta de prueba (paga ella) el costo del 25 de octubre (69 XLM) solo avisa: se puede sellar.
  quien = `${etiqueta} ${tema} · costo alto con la cuenta de prueba`;
  let mandadas = 0;
  page = await abrirParaLaRed(browser, vista, tema, (p) =>
    interceptar(p, ["*soroban-testnet.stellar.org*"], (r) => {
      const metodo = metodoRpc(r);
      if (metodo === "simulateTransaction") return { cuerpo: fixture("rpc-simulate-sello-caro.json") };
      if (metodo === "sendTransaction") {
        mandadas++;
        return "fallar";
      }
      return "seguir";
    }),
  );
  try {
    // Tampoco se aprieta nada: el aviso sale solo, y la prueba no llega a sellar.
    const aviso = await page.waitFor(`(() => { const c = document.getElementById('red-estado'); return getComputedStyle(c).display !== 'none' && /cuesta más de lo normal|costs more than usual/i.test(c.textContent || ''); })()`, 60000);
    check(`${quien}: avisa antes de sellar que cuesta más de lo normal`, aviso.ok);
    const msg = JSON.parse(await page.eval(MEDIR_RED));
    check(`${quien}: es un aviso (amarillo): el botón sigue siendo "Sellar la lista"`, /amarillo/.test(msg.clase) && !TEXTO.seguirSin.test(msg.boton) && !TEXTO.probar.test(msg.boton), `${msg.clase} · "${msg.boton}"`);
    check(`${quien}: sin XLM ni fee en lo que se lee`, !/XLM|\bfee\b|RPC/i.test(msg.texto), msg.texto.slice(0, 80));
    info(`transacciones que intentó mandar (todas cortadas por la prueba): ${mandadas}`);
  } finally {
    await cerrar(page);
  }
}

/** Sin saldo: Horizon dice que la cuenta de prueba tiene 0,01 XLM. "Cargar saldo de prueba" reemplaza a "Sellar la lista". */
async function sinSaldo(browser, vista, tema) {
  const [etiqueta, , , , celular] = vista;
  const quien = `${etiqueta} ${tema} · sin saldo`;
  const page = await abrirParaLaRed(browser, vista, tema, (p) =>
    interceptar(p, ["*horizon-testnet.stellar.org/accounts/*"], (r) =>
      r.method === "GET" && /\/accounts\/G[A-Z2-7]{55}$/.test(r.url.split("?")[0])
        ? { cuerpo: JSON.stringify({ id: "G", balances: [{ asset_type: "native", balance: "0.0100000" }] }) }
        : "seguir",
    ),
  );
  try {
    const dijo = await page.waitFor(`(() => { const c = document.getElementById('red-estado'); return getComputedStyle(c).display !== 'none' && /no tiene saldo para sellar|has no balance to seal/i.test(c.textContent || ''); })()`, 60000);
    check(`${quien}: lo dice antes de sellar, sin que se apriete nada`, dijo.ok, dijo.ok ? "" : "no apareció en 60 s");
    if (!dijo.ok) return;
    const { msg } = await cajaYAccionAlaVista(page, quien, { celular });
    check(`${quien}: la acción es "Cargar saldo de prueba" y "Seguir sin sello" queda aparte`, TEXTO.cargar.test(msg.boton) && msg.botones.length === 1 && TEXTO.seguirSin.test(msg.botones[0]), `${msg.boton} / ${msg.botones.join(", ")}`);
    check(`${quien}: no se selló nada`, !msg.sellada);
    await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-9-sin-saldo.png`));
  } finally {
    await cerrar(page);
  }
}

/** El recorrido de una pantalla, en un tema. Devuelve si llegó hasta el final. */
async function recorrer(browser, vista, tema, caso) {
  const [etiqueta, ancho, alto, dpr, celular] = vista;
  const ctx = { etiqueta, tema, celular, caso };
  const quien = `${etiqueta} ${tema}`;
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: alto, deviceScaleFactor: dpr, mobile: celular, screenWidth: ancho, screenHeight: alto });
    await page.send("Page.navigate", { url: `${base}/?theme=${tema}&lang=${lang}&pace=rapido` });
    await page.waitFor("document.readyState === 'complete'", 20000);

    await conectarCuentaDePrueba(page);

    // 0. Recién entrado, con la lista vacía: la principal es "Pegar lista", y la oferta de primera vez y
    //    "¿Cómo se usa?" no compiten con ella (diseño del onboarding, 22 de octubre de 2026).
    if (caso !== "sin-resto") {
      await page.eval("scrollTo(0, 0); true");
      await quieto(page);
      await paso(page, ctx, 0, "lista vacia", { paso: 1, real: REAL.vacia });
    }

    // 1. Lista cargada.
    if (caso === "sin-resto") {
      await page.eval(`(() => { const ta = document.getElementById('ta'); ta.value = 'Ana Quispe\\nBeto Mamani'; ta.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('nw').value = '2'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    } else {
      await page.eval(`document.getElementById('nw').value = '2'; document.getElementById('nw').dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('btn-sample').click(); true`);
    }
    await sleep(900);
    // El inicio de la página, con el indicador de pasos arriba y la lista cargada: es la captura que
    // enseña dónde está uno. Va antes de medir el paso, para no mover la pantalla donde la deja la página.
    if (caso !== "sin-resto") {
      await page.eval("scrollTo(0, 0); true");
      await quieto(page);
      await page.screenshot(join(outDir, `flujo-${etiqueta}-${tema}-0-inicio-con-indicador.png`));
    }
    // La tarjeta de participantes arriba: ahí queda quien pega la lista.
    await page.eval("document.getElementById('sec-participants').scrollIntoView({ block: 'start' }); true");
    await quieto(page);
    await paso(page, ctx, 1, "lista cargada", { paso: 2, real: REAL.lista });
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
      `${quien} · 4 resultado: la acción principal es ${caso === "sin-resto" ? '"Compartir el resultado"' : '"Siguiente premio" con cuántos quedan'}`,
      caso === "sin-resto" ? /Compartir el resultado|Share the result/.test(t4) : /Siguiente premio|Next prize/.test(t4) && /\d+/.test(t4),
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
      info("sin siguiente premio: queda compartir el resultado");
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

/**
 * Lo que un ancho de celular puede romper, y las cinco pantallas no miran: el indicador de pasos y los botones del flujo.
 * Por cada botón visible, si el texto se sale de su caja; y el indicador, en cuántas líneas queda y entre qué bordes.
 */
const MEDIR_ANCHO = `JSON.stringify((() => {
  const ids = ['btn-freeze', 'btn-draw', 'btn-again-sin', 'btn-proof', 'btn-again-nueva', 'sig-btn', 'btn-cambiar', 'btn-espera', 'btn-grande', 'btn-imagen'];
  const botones = [];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    botones.push({ id, w: Math.round(r.width), corta: el.scrollWidth > el.clientWidth + 1, sw: el.scrollWidth, cw: el.clientWidth, der: Math.round(r.right) });
  }
  // Un botón dentro de una fila flexible no corta su texto: se ensancha y se sale de su tarjeta. Por eso se mira
  // también a las cajas: ninguna debe dejar salir lo que lleva adentro.
  const cajas = [];
  for (const id of ['again-row', 'lanzar', 'wait-box', 'siguiente', 'sec-frozen', 'sec-draw', 'winner-box']) {
    const el = document.getElementById(id);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getBoundingClientRect().width) continue;
    cajas.push({ id, sw: el.scrollWidth, cw: el.clientWidth, desborda: el.scrollWidth > el.clientWidth + 1 });
  }
  const lis = [...document.querySelectorAll('#pasos li')].map((li) => li.getBoundingClientRect());
  return {
    vp: document.documentElement.clientWidth,
    scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    pasos: lis.length ? { lineas: new Set(lis.map((r) => Math.round(r.top / 4))).size, izq: Math.round(Math.min(...lis.map((r) => r.left))), der: Math.round(Math.max(...lis.map((r) => r.right))) } : null,
    botones,
    cajas,
  };
})())`;

/**
 * Los anchos de celular que el flujo largo no cubre (360 y 375 px son los más comunes y no están entre las cinco
 * pantallas). Es rápido: no graba nada en Stellar (modo libre, con ?lead=3) y no mira la barra ni la acción principal,
 * que ya mira el flujo largo, sino lo que el ancho rompe: scroll de costado, el indicador de pasos y el texto de los botones.
 * El 20 de octubre de 2026 esto encontró "Siguiente premio" partido con un punto suelto a 360 y 375 px, y el
 * indicador pegado al borde a 320.
 */
async function anchosDeCelular(browser, ancho) {
  const quien = `celular ${ancho}px`;
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", { width: ancho, height: 740, deviceScaleFactor: 2, mobile: true, screenWidth: ancho, screenHeight: 740 });
    await page.send("Page.navigate", { url: `${base}/?theme=${temas[0]}&lang=${lang}&lead=3&pace=rapido#sortear` });
    await page.waitFor("document.readyState === 'complete'", 20000);
    await sleep(900);
    // Sin cuenta, el botón de sellar queda con aria-disabled detrás de la puerta: el modo libre arma el mismo flujo.
    await page.eval(`document.querySelector('#sec-participants .body').classList.remove('locked'); document.getElementById('btn-freeze').removeAttribute('aria-disabled'); document.getElementById('gate').style.display = 'none'; document.getElementById('primera-vez')?.style.setProperty('display', 'none'); true`);
    const mirar = async (nombre) => {
      const m = JSON.parse(await page.eval(MEDIR_ANCHO));
      check(`${quien} · ${nombre}: sin scroll horizontal`, m.scrollX <= 1, `${m.scrollX}px`);
      const p = m.pasos;
      check(
        `${quien} · ${nombre}: el indicador entra en una sola línea, con margen a los dos lados`,
        !!p && p.lineas === 1 && p.izq >= 8 && p.der <= m.vp - 8,
        p ? `${p.lineas} línea, de ${p.izq} a ${p.der} de ${m.vp}` : "no hay indicador",
      );
      const cortados = m.botones.filter((b) => b.corta || b.der > m.vp);
      check(`${quien} · ${nombre}: ningún botón corta su texto ni se sale de la pantalla`, cortados.length === 0, cortados.slice(0, 3).map((b) => `#${b.id} (texto ${b.sw}, caja ${b.cw})`).join(" | "));
      const desbordan = m.cajas.filter((c) => c.desborda);
      check(`${quien} · ${nombre}: ninguna caja del flujo deja salir lo que lleva adentro`, desbordan.length === 0, desbordan.slice(0, 3).map((c) => `#${c.id} (contenido ${c.sw}, caja ${c.cw})`).join(" | "));
      await page.screenshot(join(outDir, `flujo-ancho-${ancho}-${sinTildes(nombre).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`));
    };
    console.log(`\n  ${quien}`);
    await page.eval(`document.getElementById('nw').value = '2'; document.getElementById('btn-sample').click(); true`);
    await sleep(800);
    await mirar("lista cargada");
    await page.eval("document.getElementById('btn-freeze').click(); true");
    const sello = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", 20000);
    hayFalla(!sello.ok, "no se selló la lista de ejemplo");
    await sleep(1500);
    await mirar("sellada y esperando");
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 60000);
    hayFalla(!nacio.ok, "la ronda de ejemplo no nació");
    await sleep(1200);
    await mirar("ronda lista");
    await page.eval("document.getElementById('btn-draw').click(); true");
    const estadio = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 40000);
    if (estadio.ok) {
      await sleep(800);
      await page.eval("document.getElementById('st-skip').click(); true");
    }
    const sale = await page.waitFor("getComputedStyle(document.getElementById('winner-box')).display !== 'none' && getComputedStyle(document.getElementById('again-row')).display !== 'none'", 60000);
    hayFalla(!sale.ok, "no apareció el resultado");
    await sleep(3500);
    await page.eval("document.getElementById('again-row').scrollIntoView({ block: 'center' }); true");
    await sleep(800);
    await mirar("resultado");
    check(`${quien}: sin excepciones`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
  } catch (e) {
    check(`${quien}: el recorrido llegó hasta el final`, false, String(e?.message ?? e).slice(0, 160));
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
}

async function main() {
  await mkdir(outDir, { recursive: true });
  console.log(`\nAuditando el flujo contra ${base}`);
  console.log(
    `  pantallas: ${soloAnchos || soloFallos ? "ninguna (solo " + (soloAnchos ? "anchos" : "fallos") + ")" : VISTAS.map((v) => `${v[0]} ${v[1]}x${v[2]}`).join(", ")} · temas: ${soloAnchos || soloFallos ? "—" : temas.join(", ")} · anchos de celular: ${anchos.length ? anchos.map((a) => `${a}px`).join(", ") : "ninguno"} · capturas en ${outDir}\n`,
  );
  for (const tema of soloAnchos || soloFallos ? [] : temas) {
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
  // La red que falla, apretado desde lo que se ve: una vez por pantalla, en el primer tema. Cada caso en su Chrome.
  // Dos RPC cortados y el costo alto no mandan nada; "al volver la red, sella sola" y "el primer RPC cortado" sellan
  // de verdad en la testnet, y van solo en la primera pantalla.
  const pantallasDeFallos = soloAnchos ? [] : VISTAS.filter((v) => fallos.includes(v[0]));
  const casosDeFallos = [
    ["la red no contesta", (b, v, t, primera) => falloDelSello(b, v, t, primera)],
    ["costo alto", (b, v, t, primera) => costoAlto(b, v, t, primera)],
    ["sin saldo", (b, v, t) => sinSaldo(b, v, t)],
  ];
  for (const [i, vista] of pantallasDeFallos.entries()) {
    const casos = i === 0 ? [...casosDeFallos, ["el primer RPC cortado", (b, v, t) => primerRpcCortado(b, v, t)]] : casosDeFallos;
    for (const [nombre, correr] of casos) {
      if (soloCasos.length && !soloCasos.some((c) => nombre.toLowerCase().includes(c))) continue;
      let hecho = false;
      for (let intento = 0; intento <= 1 && !hecho; intento++) {
        const browser = await launch({ width: vista[1], height: vista[2] });
        try {
          await correr(browser, vista, temas[0], i === 0);
          hecho = true;
        } catch (e) {
          const motivo = String(e?.message ?? e).slice(0, 140);
          if (intento === 1) check(`${vista[0]} ${temas[0]} · ${nombre}: la prueba llegó hasta el final`, false, motivo);
          else console.log(`  … ${vista[0]} · ${nombre}: se cortó (${motivo}) · se reintenta`);
        } finally {
          await browser.close();
        }
      }
    }
  }
  // Los anchos de celular: rápido, sin Stellar.
  for (const ancho of soloFallos ? [] : anchos) {
    const browser = await launch({ width: ancho, height: 740 });
    try {
      await anchosDeCelular(browser, ancho);
    } finally {
      await browser.close();
    }
  }
}

main()
  .catch((e) => {
    registro.push({ nombre: "la auditoría corrió sin caerse", ok: false, detalle: String(e).slice(0, 200) });
    total++;
    fallas++;
    console.log(`  ✗ la auditoría corrió sin caerse · ${String(e).slice(0, 200)}`);
  })
  .finally(() => {
    console.log("");
    console.log(fallas ? `RECHAZADO: ${total - fallas}/${total} comprobaciones` : `APROBADO: ${total}/${total} comprobaciones`);
    console.log(`Capturas en ${outDir}/flujo-*.png\n`);
    emitirJson({ auditor: "audit-flujo", objetivo: "sitio", checks: registro });
    process.exit(fallas ? 1 : 0);
  });
