#!/usr/bin/env node
/**
 * Auditor de la interfaz: la ventana de ingreso, la cabecera, la cuenta, el paso
 * de fondos y el selector de juegos.
 *
 * Existe porque hubo cosas rotas que ninguna comprobación miraba: la foto de
 * perfil que no cargaba y dejaba el icono de imagen rota en el medio de la
 * cabecera, el nombre completo cortado a la mitad y, el 19 de octubre de 2026,
 * el panel de la cuenta cortado por arriba y por abajo en una laptop a 100 % de
 * zoom, con "Salir" y "Cancelar" fuera de la pantalla. Se probaba solo en
 * 1440x900 y 390x844, que son las pantallas donde nada se corta.
 *
 * Comprueba lo que se puede comprobar solo: que nada se salga de su caja, que
 * nada se pise, que el texto se lea, que las miniaturas estén animadas de
 * verdad y que los blancos de toque alcancen en un celular. Y la regla de las
 * ventanas: una ventana siempre entra en la pantalla o se recorre, y nada de lo
 * que se toca queda fuera de alcance. Para eso mira cuatro pantallas (escritorio,
 * laptop a 100 %, celular acostado y celular parado) en los dos temas, con un
 * historial de diez sorteos de nombres largos, y comprueba en el panel de la
 * cuenta que el encabezado con la ✕ y el pie con "Cerrar sesión" quedan dentro
 * de la pantalla sin hacer scroll de la página, que el cuerpo se recorre si es
 * más alto, que no hay scroll de costado, que los botones miden 44 px y que el
 * teclado funciona (el foco entra, no se escapa, Esc cierra y el foco vuelve).
 * Lo mismo, para la ventana de ingreso, para el paso de fondos (se llega con
 * una Freighter de mentira, ver `lib/freighter-falsa.mjs`) y para la de rearmar
 * un comprobante, que no trae alto máximo propio y depende de la regla general.
 *
 * Uso:
 *   node scripts/audit-ui.mjs [--base http://localhost:4173] [--out DIR]
 *                             [--pantalla laptop-100] [--sin-juegos]
 *
 *   CDP_PORT=<puerto> si otra auditoría tiene el Chrome por defecto.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch } from "./lib/browser.mjs";
import { CUENTA_FALSA, freighterFalsa } from "./lib/freighter-falsa.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas");
const soloPantalla = opt("--pantalla", "");
const sinJuegos = args.includes("--sin-juegos");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

/**
 * Las pantallas con las que se prueba. Las dos de siempre y las dos que se
 * habían quedado afuera: la laptop de Nicolás a 100 % de zoom (1362x632, donde
 * el panel medía 679 px) y el celular acostado (844x390, donde quedaba cortado
 * 144 px por arriba).
 */
const PANTALLAS = [
  { w: 1440, h: 900, etiqueta: "escritorio", movil: false },
  { w: 1362, h: 632, etiqueta: "laptop-100", movil: false },
  { w: 844, h: 390, etiqueta: "celular-h", movil: true },
  { w: 390, h: 844, etiqueta: "celular", movil: true },
];

/**
 * Mide contraste y desbordes.
 *
 * El fondo efectivo se busca subiendo por los padres hasta encontrar uno
 * opaco, porque un elemento transparente sobre otro transparente no dice nada
 * por sí solo.
 */
const PROBE = `(() => {
  const lum = (c) => { const [r,g,b] = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }); return 0.2126*r + 0.7152*g + 0.0722*b; };
  const nums = (s) => s.split(/[^0-9.]+/).filter(Boolean).map(Number).slice(0, 3);
  const opaque = (b) => b && b.indexOf('rgba(0, 0, 0, 0)') < 0 && b.indexOf('transparent') < 0;
  // Un fondo en degradado (el resaltado del título) cuenta por su último color
  // opaco: es el que queda detrás de las letras.
  const grad = (e) => { const g = getComputedStyle(e).backgroundImage; if (!g || g.indexOf('gradient(') < 0) return null; const cols = (g.match(/rgba?\\([^)]*\\)/g) || []).filter((c) => { const v = nums(c.replace(/^rgba?\\(/, '')); const a = c.startsWith('rgba') ? Number((c.match(/,\\s*([0-9.]+)\\s*\\)$/) || [0, 1])[1]) : 1; return a > 0.5 && v.length === 3; }); return cols.length ? nums(cols[cols.length - 1]) : null; };
  const bgOf = (el) => { let e = el; while (e) { const b = getComputedStyle(e).backgroundColor; if (opaque(b)) return nums(b); const gc = grad(e); if (gc) return gc; e = e.parentElement; } return [255,255,255]; };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)); };

  const out = { texto: [], desbordes: [], toques: [], rotas: [] };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Una imagen que no carga deja el icono de rota a la vista.
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && el.getAttribute('src')) {
      out.rotas.push((el.className || 'img') + ' ' + String(el.getAttribute('src')).slice(0, 48));
    }

    // Texto propio, no el de los hijos.
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    // Un botón desactivado está apagado a propósito: las pautas de contraste
    // no lo cuentan, y el "Seguir con el correo" vacío se marcaba solo.
    const apagado = !!el.closest('button:disabled');
    if (own.length > 1 && !apagado) {
      const size = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight) || 400;
      const need = (size >= 24 || (size >= 18.66 && w >= 700)) ? 3 : 4.5;
      const op = parseFloat(cs.opacity) || 1;
      const bg = bgOf(el);
      let col = nums(cs.color);
      if (op < 1) col = col.map((v, i) => v * op + bg[i] * (1 - op));
      const got = ratio(col, bg);
      if (got < need) out.texto.push({ t: own.slice(0, 26), r: got, need, sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] });
      // Texto recortado por su propia caja. Lo que está fuera de pantalla a
      // propósito para los lectores no cuenta: no lo ve nadie. Tampoco el que
      // se corta con puntos suspensivos: es un nombre largo que se abrevia a
      // propósito, con el texto entero en su title (el nombre de la cuenta, el
      // premio de un sorteo).
      const oculto = el.classList.contains('sr-only');
      const abreviado = cs.textOverflow === 'ellipsis';
      if (!oculto && !abreviado && el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' && el.clientWidth > 4) {
        out.desbordes.push({ t: own.slice(0, 26), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }

    // Blancos de toque. Un enlace dentro de un párrafo no es un blanco de
    // toque: es texto que ademas se puede tocar, y estirarlo a 44 px rompe el
    // renglón.
    const enLinea = el.tagName === 'A' && getComputedStyle(el).display.indexOf('inline') === 0;
    if (!enLinea && /^(BUTTON|A|SELECT)$/.test(el.tagName) && r.height > 0 && r.height < 44) {
      out.toques.push({ t: (el.textContent || '').trim().slice(0, 22), h: Math.round(r.height) });
    }
  }
  out.scroll = { doc: document.documentElement.scrollWidth, vista: document.documentElement.clientWidth };
  return JSON.stringify(out);
})()`;

/**
 * Mide una ventana abierta: si entra entera en la pantalla, si todo lo que se
 * puede tocar se alcanza (a la vista, o con scroll adentro de la ventana o del
 * fondo), si algo se corta de costado y qué blancos de toque son chicos.
 *
 * La regla (docs/marca.md): una ventana siempre entra o se recorre. Lo que está
 * fuera de la pantalla y no hay scroll que lo traiga es lo que el panel de la
 * cuenta tenía: "Salir" y "Cancelar" al pie de una tarjeta de 679 px en una
 * pantalla de 632. Un control adentro de un `<details>` cerrado no se cuenta.
 */
const ALCANCE = (sel) => `(() => {
  const dlg = document.querySelector(${JSON.stringify(sel)});
  if (!dlg) return JSON.stringify(null);
  const back = dlg.closest('.modal-back');
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  const r0 = dlg.getBoundingClientRect();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    let top = r.top, bottom = r.bottom, left = r.left, right = r.right;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
        const pr = p.getBoundingClientRect();
        top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom); left = Math.max(left, pr.left); right = Math.min(right, pr.right);
      }
    }
    top = Math.max(top, 0); left = Math.max(left, 0); bottom = Math.min(bottom, vh); right = Math.min(right, vw);
    return r.height > 0 && bottom - top >= r.height - 1 && right - left >= r.width - 1;
  };
  const todos = [...dlg.querySelectorAll('button, a[href], select, input:not([type=hidden]), summary')].filter((e) => {
    const c = getComputedStyle(e);
    if (c.display === 'none' || c.visibility === 'hidden' || e.getBoundingClientRect().height === 0) return false;
    if (e.classList.contains('sr-only')) return false;
    const d = e.closest('details:not([open])');
    return !d || e.tagName === 'SUMMARY';
  });
  const nombre = (e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().replace(/\\s+/g, ' ').slice(0, 28);
  const inalcanzables = [];
  for (const e of todos) {
    if (visible(e)) continue;
    e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!visible(e)) inalcanzables.push(nombre(e));
  }
  // Los blancos de toque: botones, selectores y enlaces que no van adentro de un renglón de texto.
  const chicos = todos
    .filter((e) => /^(BUTTON|SELECT)$/.test(e.tagName) || (e.tagName === 'A' && getComputedStyle(e).display !== 'inline'))
    .filter((e) => e.getBoundingClientRect().height < 43.5)
    .map((e) => nombre(e) + ' ' + Math.round(e.getBoundingClientRect().height) + 'px');
  for (const s of [back, dlg, ...dlg.querySelectorAll('*')]) { if (s && s.scrollTop) s.scrollTop = 0; }
  const de = document.documentElement;
  return JSON.stringify({
    vista: [vw, vh],
    card: { top: Math.round(r0.top), bottom: Math.round(r0.bottom), left: Math.round(r0.left), right: Math.round(r0.right), h: Math.round(r0.height) },
    entra: r0.top >= -0.5 && r0.bottom <= vh + 0.5 && r0.left >= -0.5 && r0.right <= vw + 0.5,
    // No se corta: arranca adentro de la pantalla, arriba y de costado (lo que hacía el fondo centrado, con la tarjeta más alta).
    sinCortar: r0.top >= -0.5 && r0.left >= -0.5 && r0.right <= vw + 0.5,
    // Se recorre: la ventana o el fondo tienen scroll y algo que recorrer.
    recorre: [back, dlg, ...dlg.querySelectorAll('*')].some((s) => s && /(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight + 1),
    inalcanzables, chicos,
    scrollH: de.scrollWidth > de.clientWidth + 1,
    cardScrollW: dlg.scrollWidth > dlg.clientWidth + 1,
    n: todos.length,
  });
})()`;

/**
 * Pasa lo que midió `ALCANCE` a comprobaciones.
 *
 * La regla es "entra o se recorre". Las ventanas con alto máximo y cuerpo que se
 * recorre (la cuenta, el ingreso, el paso de fondos) tienen que **entrar**:
 * `entra` queda en true. La que depende del fondo para recorrerse (la de rearmar)
 * puede ser más alta que la pantalla (`entra: false`), pero no puede cortarse por
 * arriba ni de costado, y tiene que recorrerse.
 */
function chequearVentana(pre, m, movil, { entra = true } = {}) {
  if (!m) {
    check(`${pre}: se midió`, false, "la ventana no estaba abierta");
    return;
  }
  const donde = `tarjeta de ${m.card.top} a ${m.card.bottom} en una pantalla de ${m.vista[1]} px de alto, y de ${m.card.left} a ${m.card.right} de ${m.vista[0]} de ancho`;
  if (entra) check(`${pre}: entra en la pantalla`, m.entra, donde);
  else check(`${pre}: entra en la pantalla o se recorre, sin cortarse`, m.sinCortar && (m.entra || m.recorre), `${donde}; ${m.recorre ? "se recorre" : "no se recorre"}`);
  check(`${pre}: todo lo que se toca se alcanza`, m.inalcanzables.length === 0, m.inalcanzables.slice(0, 3).join(" | "));
  check(`${pre}: sin scroll horizontal`, !m.scrollH && !m.cardScrollW);
  if (movil) check(`${pre}: blancos de toque de 44 px`, m.chicos.length === 0, m.chicos.slice(0, 3).join(" | "));
}

/** Una tecla de verdad (de confianza, con su acción por defecto: Tab mueve el foco). */
async function tecla(page, k, shift = false) {
  const code = { Tab: 9, Escape: 27, Enter: 13 }[k] ?? 0;
  const p = { key: k, code: k, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 };
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", ...p });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...p });
  await sleep(120);
}

/** Un toque de verdad en el centro de un elemento (o en un punto, `{x, y}`): el botón recibe el foco, como con el dedo. */
async function clic(page, selOPunto) {
  const p = typeof selOPunto === "string"
    ? JSON.parse(await page.eval(`JSON.stringify((() => { const r = document.querySelector(${JSON.stringify(selOPunto)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`))
    : selOPunto;
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(150);
}

/**
 * Diez sorteos de quien ya sorteó mucho, con nombres largos: los cuatro más
 * nuevos (los que muestra el panel) llevan los más largos, uno de ellos sin
 * sortear y sin comprobante, y el sexto es uno hecho, con número y sin
 * comprobante: el que ofrece "Rearmar". La clave es la que lee `history.ts`.
 */
const NOMBRES = [
  "Sorteo de camisetas del hackathon de Cochabamba, edición verano 2026",
  "Jesica Jimena Gutierrez Aguilera",
  "nº 19, 18, 10, 6 de la lista",
  "Tubienestarprimero",
  "Fabiola", "Oscar", "Meetup de Cochabamba", "Cumpleaños de Dani", "Clerk + WTM", "Taller de Rust",
];
async function sembrarHistorial(page) {
  await page.eval(`(() => {
    const dir = document.querySelector('#wallet-box .hello').title.split(' · ').pop();
    const lista = ${JSON.stringify(NOMBRES)}.map((n, i) => ({
      organizer: dir, listHash: 'a'.repeat(64), count: 20 + i, numWinners: 1, round: 100 + i,
      sealedAt: 1760000000 + (10 - i) * 86400, prize: n,
      ...(i === 2 ? {} : { winners: ['Ana'] }),
      ...(i === 2 || i === 5 ? {} : { proof: 'https://tinkazo.app/verificar.html#x' + i }),
      ...(i === 5 ? { id: '5' } : {}),
    }));
    localStorage.setItem('tinkazo.history.testnet', JSON.stringify(lista));
    return true;
  })()`);
}

/**
 * Conecta con la cuenta de prueba, que es la única que no necesita a nadie.
 * Antes mide la ventana de ingreso, que desde el 8 de octubre de 2026 tiene la
 * forma de la de Pollar: el correo, Google, la wallet y la cuenta de prueba.
 */
async function connect(page, p, tema) {
  const etiqueta = p.etiqueta;
  await page.waitFor(`document.querySelector('#gate button, #wallet-box button')`, 20000);
  await sleep(500);
  await page.eval(`(document.querySelector('#gate button') || document.querySelector('#wallet-box button')).click()`);
  const abrio = await page.waitFor(`document.querySelector('.login-opt')`, 15000);
  check(`${etiqueta} ${tema}: se abre la ventana de ingreso`, abrio.ok);
  if (!abrio.ok) return false;
  await sleep(400);
  const v = JSON.parse(await page.eval(PROBE));
  chequearVentana(`${etiqueta} ${tema}: la ventana de ingreso`, JSON.parse(await page.eval(ALCANCE(".modal-card.login"))), p.movil);
  check(
    `${etiqueta} ${tema}: la ventana de ingreso sin texto recortado`,
    v.desbordes.length === 0,
    v.desbordes.slice(0, 2).map((d) => `"${d.t}" ${d.sw}>${d.cw}`).join(" | "),
  );
  check(
    `${etiqueta} ${tema}: contraste en la ventana de ingreso`,
    v.texto.length === 0,
    v.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.need}`).join(" | "),
  );
  await page.screenshot(join(outDir, `ui-ingreso-${etiqueta}-${tema}.png`));
  const i = await page.eval(
    `String([...document.querySelectorAll('.login-opt')].findIndex(e => /prueba|Test account/.test(e.textContent)))`,
  );
  if (i === "-1") return false;
  await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].click()`);
  const cerro = await page.waitFor(`!document.querySelector('.modal-back')`, 90000);
  await sleep(600);
  return cerro.ok;
}

/**
 * El paso de fondos de la ventana de ingreso: una cuenta recién creada que no
 * tiene con qué pagar. Se llega por el camino de verdad con una Freighter de
 * mentira (la dirección es fija y Horizon dice que no existe todavía), en una
 * pestaña aparte, y se mide con la misma vara que las otras ventanas.
 */
async function pasoDeFondos(browser, p, tema) {
  const pre = `${p.etiqueta} ${tema}`;
  const page = await browser.open("about:blank");
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: p.w, height: p.h, deviceScaleFactor: 2, mobile: p.movil, screenWidth: p.w, screenHeight: p.h,
    });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: freighterFalsa() });
    await page.send("Page.navigate", { url: `${base}/?theme=${tema}` });
    await page.waitFor("document.readyState === 'complete' && document.fonts && document.fonts.status === 'loaded'", 15000);
    await page.waitFor(`document.querySelector('#gate button, #wallet-box button')`, 20000);
    await sleep(600);
    await page.eval(`(document.querySelector('#gate button') || document.querySelector('#wallet-box button')).click()`);
    await page.waitFor(`document.querySelector('.login-opt')`, 15000);
    await sleep(500);
    const i = await page.eval(
      `String([...document.querySelectorAll('.login-opt')].findIndex(e => /Freighter/.test(e.textContent) && !/instalar|install/.test(e.textContent)))`,
    );
    if (i === "-1") {
      check(`${pre}: el paso de fondos se abre`, false, "la Freighter de mentira no aparece instalada");
      return;
    }
    await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].click()`);
    const ok = await page.waitFor(`document.querySelector('.modal-card .fund')`, 25000);
    check(`${pre}: el paso de fondos se abre`, ok.ok);
    if (!ok.ok) return;
    await sleep(600);
    chequearVentana(`${pre}: el paso de fondos`, JSON.parse(await page.eval(ALCANCE(".modal-card.login"))), p.movil);
    await page.screenshot(join(outDir, `ui-fondos-${p.etiqueta}-${tema}.png`));
  } finally {
    try {
      await page.send("Page.close");
    } catch {
      /* ya cerrada */
    }
  }
}

/**
 * El panel de la cuenta, con diez sorteos de nombres largos en el historial.
 * Lo que se comprueba es lo que falló el 19 de octubre de 2026: que la ✕ y
 * "Cerrar sesión" estén a la vista sin mover la página, y que lo demás se pueda
 * recorrer. Y lo que se prometió al arreglarlo: el teclado.
 */
async function panelDeLaCuenta(page, p, tema, primera) {
  const pre = `${p.etiqueta} ${tema}`;
  await sembrarHistorial(page);
  await clic(page, "#wallet-box .hello");
  const abrio = await page.waitFor(`document.querySelector('.acct-card')`, 10000);
  check(`${pre}: se abre el panel de la cuenta`, abrio.ok);
  if (!abrio.ok) return;
  await sleep(1300);

  const sem = JSON.parse(
    await page.eval(`JSON.stringify((() => {
      const d = document.querySelector('.acct-card');
      const l = d.getAttribute('aria-labelledby');
      const t = l && document.getElementById(l);
      const a = document.activeElement;
      return { rol: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), titulo: t ? t.textContent.trim() : '', foco: a === d || d.contains(a) };
    })())`),
  );
  check(
    `${pre}: el panel es un diálogo con título (role, aria-modal y aria-labelledby)`,
    sem.rol === "dialog" && sem.modal === "true" && !!sem.titulo,
    JSON.stringify(sem),
  );
  check(`${pre}: el foco entra a la ventana al abrir`, sem.foco);

  // El encabezado (con la ✕) y el pie (con "Cerrar sesión") dentro de la pantalla, sin scroll de la página.
  const g = JSON.parse(
    await page.eval(`JSON.stringify((() => {
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const dentro = (s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5 && r.left >= -0.5 && r.right <= vw + 0.5; };
      const x = document.querySelector('.acct-x').getBoundingClientRect();
      const b = document.querySelector('.acct-body');
      const masAlto = b.scrollHeight > b.clientHeight + 1;
      let llega = true;
      if (masAlto) {
        b.scrollTop = b.scrollHeight;
        const ult = b.lastElementChild.getBoundingClientRect(), br = b.getBoundingClientRect();
        llega = ult.bottom <= br.bottom + 1 && /(auto|scroll)/.test(getComputedStyle(b).overflowY);
        b.scrollTop = 0;
      }
      return {
        tarjeta: dentro('.acct-card'), cabecera: dentro('.acct-head'), x: dentro('.acct-x'), pie: dentro('.acct-foot'), salir: dentro('.acct-out'),
        scrollY: window.scrollY, xw: Math.round(x.width), xh: Math.round(x.height), masAlto, llega,
        cuerpo: [b.clientHeight, b.scrollHeight],
      };
    })())`),
  );
  check(
    `${pre}: el encabezado (con la ✕) y el pie (con Cerrar sesión) quedan dentro de la pantalla sin hacer scroll`,
    g.tarjeta && g.cabecera && g.x && g.pie && g.salir,
    `tarjeta ${g.tarjeta} · encabezado ${g.cabecera} · ✕ ${g.x} · pie ${g.pie} · Cerrar sesión ${g.salir}`,
  );
  check(`${pre}: la ✕ mide 44 px como mínimo`, g.xw >= 44 && g.xh >= 44, `${g.xw}x${g.xh}`);
  check(
    `${pre}: el cuerpo se recorre si es más alto que la ventana`,
    g.llega,
    g.masAlto ? `el cuerpo mide ${g.cuerpo[1]} y se ve ${g.cuerpo[0]}` : "todo cabe sin recorrer",
  );

  const m = JSON.parse(await page.eval(ALCANCE(".acct-card")));
  chequearVentana(`${pre}: el panel de la cuenta`, m, p.movil);
  check(
    `${pre}: sin scroll horizontal`,
    (await page.eval(`(() => { const b = document.querySelector('.acct-body'); return b.scrollWidth <= b.clientWidth + 1; })()`)) === true,
    "el cuerpo del panel",
  );

  const q = JSON.parse(await page.eval(PROBE));
  check(`${pre}: sin imágenes rotas`, q.rotas.length === 0, q.rotas.slice(0, 2).join(" | "));
  check(
    `${pre}: sin texto recortado`,
    q.desbordes.length === 0,
    q.desbordes.slice(0, 2).map((d) => `"${d.t}" ${d.sw}>${d.cw}`).join(" | "),
  );
  check(
    `${pre}: contraste del texto`,
    q.texto.length === 0,
    q.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.need}`).join(" | "),
  );
  check(`${pre}: sin scroll horizontal en la página`, q.scroll.doc <= q.scroll.vista + 1, `${q.scroll.doc} vs ${q.scroll.vista}`);
  if (p.movil) {
    check(`${pre}: blancos de toque de 44 px en toda la página`, q.toques.length === 0, q.toques.slice(0, 3).map((x) => `"${x.t}" ${x.h}px`).join(" | "));
  }
  await page.screenshot(join(outDir, `ui-cuenta-${p.etiqueta}-${tema}.png`));

  // Teclado: Tab da la vuelta sin escaparse; Esc cierra; el foco vuelve al botón.
  const n = Number(await page.eval(`document.querySelectorAll('.acct-card a[href], .acct-card button, .acct-card select').length`));
  let fuera = 0;
  for (let i = 0; i < n + 3; i++) {
    await tecla(page, "Tab");
    if (!(await page.eval(`!!(document.activeElement && document.activeElement.closest('.acct-card'))`))) fuera++;
  }
  check(`${pre}: Tab no se escapa de la ventana`, fuera === 0, `${fuera} de ${n + 3} pulsaciones salieron`);
  await tecla(page, "Escape");
  const cerro = await page.eval(`!document.querySelector('.acct-card')`);
  check(`${pre}: Esc cierra el panel`, cerro === true);
  const vuelve = await page.eval(`!!(document.activeElement && document.activeElement.classList.contains('hello'))`);
  check(`${pre}: al cerrar, el foco vuelve al botón que la abrió`, vuelve === true);

  // Tocar el fondo también cierra.
  await clic(page, "#wallet-box .hello");
  await page.waitFor(`document.querySelector('.acct-card')`, 8000);
  await sleep(300);
  await clic(page, { x: 3, y: 3 });
  check(`${pre}: tocar el fondo cierra el panel`, (await page.eval(`!document.querySelector('.acct-card')`)) === true);

  // Con movimiento reducido no hay animación de entrada. Una vez alcanza: es CSS.
  if (primera) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await clic(page, "#wallet-box .hello");
    await page.waitFor(`document.querySelector('.acct-card')`, 8000);
    const an = await page.eval(`getComputedStyle(document.querySelector('.acct-card')).animationName`);
    check(`${pre}: con movimiento reducido el panel no se anima al entrar`, an === "none", an);
    await tecla(page, "Escape");
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
  }
}

/**
 * Las dos formas del panel que no salen con la cuenta de prueba: una cuenta de
 * Google (sin saldo ni grifo mientras tenga menos de 1 XLM, con un nombre muy
 * largo) y una de Freighter con poco saldo (la insignia del saldo y el botón del
 * grifo, que es lo más alto que puede quedar el bloque de arriba). Se abre
 * `openAccount` con una vista inventada, importando el trozo `account-*.js` que
 * la página ya cargó, y se miden igual que el otro.
 */
async function variantesDelPanel(page, p, tema) {
  const pre = `${p.etiqueta} ${tema}`;
  const url = await page.eval(
    `(performance.getEntriesByType('resource').find((e) => /\\/assets\\/account-[^/?#]+\\.js/.test(e.name)) || {}).name || ''`,
  );
  if (!url) {
    check(`${pre}: las variantes del panel (Google, Freighter)`, false, "no encontré el trozo account-*.js de la página");
    return;
  }
  const abrirCon = async (vista) => {
    await page.eval(`(async () => {
      const m = await import(${JSON.stringify(url)});
      m.closeAccount();
      m.openAccount({ ...${JSON.stringify(vista)}, onDisconnect() {}, onFund() {} });
      return true;
    })()`);
    const ok = await page.waitFor(`document.querySelector('.acct-card')`, 6000);
    await sleep(900);
    return ok.ok;
  };
  const cerrar = () => page.eval(`import(${JSON.stringify(url)}).then((m) => { m.closeAccount(); return true; })`);

  if (await abrirCon({ address: CUENTA_FALSA, name: "Nicolás Emir Mejía Agreda de la Torre Quispe Mamani", label: "Google", balance: 0 })) {
    const g = JSON.parse(
      await page.eval(`JSON.stringify({
        saldo: !!document.querySelector('.acct-badge:not(.net)'), grifo: !!document.querySelector('[data-k=fund]'),
        red: document.querySelector('.acct-badge.net').textContent, vacio: !!document.querySelector('.acct-empty'),
      })`),
    );
    check(`${pre}: con Google y menos de 1 XLM el panel no muestra el saldo ni el grifo`, !g.saldo && !g.grifo, JSON.stringify(g));
    check(`${pre}: sin sorteos el panel dice algo amable`, g.vacio);
    chequearVentana(`${pre}: el panel de una cuenta de Google con nombre largo`, JSON.parse(await page.eval(ALCANCE(".acct-card"))), p.movil);
    await page.screenshot(join(outDir, `ui-cuenta-google-${p.etiqueta}-${tema}.png`));
  } else check(`${pre}: se abre el panel de una cuenta de Google`, false);

  if (await abrirCon({ address: CUENTA_FALSA, label: "Freighter", balance: 5 })) {
    const f = JSON.parse(
      await page.eval(`JSON.stringify({ saldo: !!document.querySelector('.acct-badge:not(.net)'), grifo: !!document.querySelector('[data-k=fund]') })`),
    );
    check(`${pre}: con Freighter y 5 XLM el panel muestra el saldo y el grifo`, f.saldo && f.grifo, JSON.stringify(f));
    chequearVentana(`${pre}: el panel de una cuenta de Freighter con poco saldo`, JSON.parse(await page.eval(ALCANCE(".acct-card"))), p.movil);
    await page.screenshot(join(outDir, `ui-cuenta-freighter-${p.etiqueta}-${tema}.png`));
  } else check(`${pre}: se abre el panel de una cuenta de Freighter`, false);
  await cerrar();
}

/**
 * La ventana de rearmar un comprobante: una tarjeta sin alto máximo propio, que
 * depende de la regla general (el fondo se recorre y la tarjeta se centra con
 * `margin: auto`). Si esa regla se rompe, esta es la primera que se corta: en un
 * celular acostado perdía 40 px por arriba y "Rearmar" y "Cancelar" quedaban
 * fuera de alcance.
 */
async function ventanaDeRearmar(page, p, tema) {
  const pre = `${p.etiqueta} ${tema}`;
  await page.eval(`location.hash = '#mis-sorteos'`);
  const hay = await page.waitFor(`document.querySelector('[data-rearmar]')`, 8000);
  check(`${pre}: el historial ofrece rearmar un comprobante`, hay.ok);
  if (!hay.ok) return;
  await page.eval(`document.querySelector('[data-rearmar]').click()`);
  const ok = await page.waitFor(`document.querySelector('.modal-back .modal-card')`, 5000);
  check(`${pre}: se abre la ventana de rearmar`, ok.ok);
  if (ok.ok) {
    await sleep(500);
    chequearVentana(`${pre}: la ventana de rearmar un comprobante`, JSON.parse(await page.eval(ALCANCE(".modal-back .modal-card"))), p.movil, { entra: false });
    await tecla(page, "Escape");
    check(`${pre}: Esc cierra la ventana de rearmar`, (await page.eval(`!document.querySelector('.modal-back')`)) === true);
  }
  await page.eval(`location.hash = '#sortear'`);
  await sleep(300);
}

/**
 * Que el resaltado del título no tape letras de otra línea.
 *
 * El 29 de septiembre de 2026 el recuadro amarillo de "cualquiera puede
 * comprobar" le tapaba las colas a la "q" de "que", en la línea de arriba: el
 * interlineado era apretado y el resaltado, que se dibuja después, subía hasta
 * ahí. Ninguna comprobación lo veía, porque las cajas no se pisaban: se pisaba
 * lo pintado.
 *
 * Por eso se mide por píxeles: una foto del título tal cual y otra con el
 * resaltado sin fondo y con sus letras del color del resto, donde se ven todas
 * las letras del título enteras. Un píxel del centro de una letra de esa
 * segunda foto que en la primera no es de ningún color de letra (ni el del
 * título ni el del resaltado) es una letra tapada: por el amarillo, o por la
 * franja de otro renglón del mismo resaltado. Los bordes suavizados no
 * cuentan: ahí se mezclan los colores aunque nada tape nada.
 *
 * La primera versión solo miraba las letras de afuera del resaltado, y no vio
 * que el renglón de abajo del resaltado le cortaba la cola a la "q" de
 * "cualquiera", en el renglón de arriba. Lo encontró la revisión visual.
 */
async function resaltadoTapa(page) {
  const box = JSON.parse(await page.eval(`(() => { scrollTo(0, 0); const h = document.querySelector('h1'); if (!h || !h.querySelector('.hl')) return JSON.stringify({ w: 0 }); const r = h.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }); })()`));
  if (!box.w) return { ok: true, detail: "sin resaltado en el título" };
  const clip = { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.w + 8, height: box.h + 8, scale: 1 };
  const shot = async () => (await page.send("Page.captureScreenshot", { format: "png", clip })).data;
  await sleep(200);
  const a = await shot();
  await page.eval(`(() => { const s = document.createElement('style'); s.id = '__sin-hl'; const tinta = getComputedStyle(document.querySelector('h1')).color; s.textContent = 'html body h1 .hl.hl.hl, html body h1 .hl.hl.hl * { background: none !important; color: ' + tinta + ' !important; }'; document.head.appendChild(s); return true; })()`);
  await sleep(150);
  const b = await shot();
  await page.eval(`(() => { document.getElementById('__sin-hl')?.remove(); return true; })()`);
  const r = JSON.parse(await page.eval(`(async () => {
    const load = async (d) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + d;
      await im.decode();
      const c = document.createElement('canvas');
      c.width = im.width; c.height = im.height;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      return x.getImageData(0, 0, c.width, c.height).data;
    };
    const A = await load(${JSON.stringify(a)}), B = await load(${JSON.stringify(b)});
    const rgb = (css) => (css.match(/[0-9.]+/g) || []).slice(0, 3).map(Number);
    const tinta = rgb(getComputedStyle(document.querySelector('h1')).color);
    const tintaHl = rgb(getComputedStyle(document.querySelector('h1 .hl')).color);
    const cerca = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]) < 110;
    const lum = (d, i) => (d[i] * 0.2126 + d[i + 1] * 0.7152 + d[i + 2] * 0.0722) / 255;
    const fondo = lum(B, 0);
    const W = ${Math.round(clip.width * 2)}, H = B.length / 4 / W;
    // El interior de una letra: el píxel y sus vecinos a dos píxeles en las
    // cuatro direcciones son letra. Los bordes suavizados cambian apenas de una
    // foto a la otra aunque nada tape nada, y no cuentan.
    const letra = (x, y) => x >= 0 && y >= 0 && x < W && y < H && Math.abs(lum(B, (y * W + x) * 4) - fondo) > 0.55;
    let tapadas = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!(letra(x, y) && letra(x - 2, y) && letra(x + 2, y) && letra(x, y - 2) && letra(x, y + 2))) continue;
        // Tapada de verdad: ni ese píxel ni sus vecinos inmediatos tienen color
        // de letra en la foto normal. Una letra corrida un píxel entre las dos
        // fotos no cuenta; una cola tapada es una zona entera sin letra.
        let hay = false;
        for (let dy = -1; dy <= 1 && !hay; dy++) {
          for (let dx = -1; dx <= 1 && !hay; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = (yy * W + xx) * 4;
            if (cerca(A, j, tinta) || cerca(A, j, tintaHl)) hay = true;
          }
        }
        if (!hay) tapadas++;
      }
    }
    return JSON.stringify({ tapadas });
  })()`));
  return { ok: r.tapadas <= 12, detail: `${r.tapadas} píxeles de letra tapados`, tapadas: r.tapadas };
}

async function run() {
  await mkdir(outDir, { recursive: true });
  const browser = await launch({ width: 1440, height: 900 });
  try {
    console.log(`\nAuditando la interfaz contra ${base}\n`);

    let primera = true;
    for (const p of PANTALLAS) {
      if (soloPantalla && soloPantalla !== p.etiqueta) continue;
      const etiqueta = p.etiqueta;
      for (const tema of ["dark", "light"]) {
        const page = await browser.open("about:blank");
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: p.w, height: p.h, deviceScaleFactor: 2, mobile: p.movil,
          screenWidth: p.w, screenHeight: p.h,
        });
        await page.send("Page.navigate", { url: `${base}/?theme=${tema}` });
        await page.waitFor("document.readyState === 'complete' && document.fonts && document.fonts.status === 'loaded'", 15000);

        const tapa = await resaltadoTapa(page);
        check(`${etiqueta} ${tema}: el resaltado del título no tapa letras`, tapa.ok, tapa.detail);

        const ok = await connect(page, p, tema);
        check(`${etiqueta} ${tema}: conecta una cuenta`, ok);
        if (!ok) continue;

        // La cabecera, con la sesión abierta.
        const cab = JSON.parse(await page.eval(`JSON.stringify((() => {
          const box = document.getElementById('wallet-box');
          const r = box.getBoundingClientRect();
          const hello = box.querySelector('.hello');
          const hr = hello ? hello.getBoundingClientRect() : null;
          return {
            dentro: r.right <= innerWidth + 1 && r.left >= -1,
            nombre: hello ? hello.textContent.trim() : '',
            cortado: hello ? hello.scrollWidth > hello.clientWidth + 2 : false,
            foto: !!box.querySelector('.hello-face'),
          };
        })())`));
        check(`${etiqueta} ${tema}: la cabecera entra en la pantalla`, cab.dentro);
        check(`${etiqueta} ${tema}: el nombre no queda cortado`, !cab.cortado, cab.nombre);

        await page.screenshot(join(outDir, `ui-cabecera-${etiqueta}-${tema}.png`));

        // El panel de la cuenta, en sus tres formas, y el paso de fondos.
        await panelDeLaCuenta(page, p, tema, primera);
        primera = false;
        await variantesDelPanel(page, p, tema);
        await ventanaDeRearmar(page, p, tema);
        await pasoDeFondos(browser, p, tema);

        // El selector de juegos, que aparece al congelar.
        if (tema === "dark" && !sinJuegos) {
          await page.eval(`document.getElementById('btn-sample').click()`);
          // Sellar en testnet a veces falla de pasada ("La red rechazó la
          // transacción. Suele ser pasajero"): la pantalla misma dice que se
          // pruebe de nuevo, y el auditor lo hace hasta tres veces. Cada intento
          // espera a que la lista se congele o a que el botón vuelva a estar
          // disponible con el error a la vista. Si no se congela, el detalle
          // dice qué mostraba la pantalla: así se distingue la red de un defecto.
          let cong = { ok: false };
          let estado = "";
          for (let intento = 1; intento <= 3 && !cong.ok; intento++) {
            await page.eval(`document.getElementById('btn-freeze').click()`);
            await page.waitFor(
              `getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' || (!document.getElementById('btn-freeze').disabled && !!((document.getElementById('seal-status') || {}).textContent || '').trim() && getComputedStyle(document.getElementById('seal-status')).display !== 'none')`,
              120000,
            );
            cong = { ok: (await page.eval(`getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'`)) === true };
            estado = await page.eval(`((document.getElementById('seal-status') || {}).textContent || '').trim().slice(0, 100)`);
          }
          check(`${etiqueta}: la lista se congela`, cong.ok, cong.ok ? "" : `la pantalla decía: "${estado}"`);
          if (cong.ok) {
            // Primero a la vista y después a medir: las miniaturas sólo se
            // animan cuando el selector está en pantalla, que es lo que hace
            // que no gasten batería mientras nadie las mira.
            await page.eval(`document.querySelector('.gamepick').scrollIntoView({block:'center'})`);
            await sleep(1500);
            const t1 = await page.eval(`JSON.stringify([...document.querySelectorAll('.gamepick canvas.thumb')].map(cv => {
              const c = cv.getContext('2d');
              return [...c.getImageData(0, 0, cv.width, cv.height).data].reduce((a, v) => a + v, 0);
            }))`);
            await sleep(700);
            const t2 = await page.eval(`JSON.stringify([...document.querySelectorAll('.gamepick canvas.thumb')].map(cv => {
              const c = cv.getContext('2d');
              return [...c.getImageData(0, 0, cv.width, cv.height).data].reduce((a, v) => a + v, 0);
            }))`);
            const a = JSON.parse(t1);
            const bb = JSON.parse(t2);
            // Contra los botones del selector, no contra un número escrito a
            // mano: eran seis, y al sumar juegos el auditor fallaba solo.
            const botones = Number(await page.eval(`document.querySelectorAll('.gamepick button').length`));
            check(`${etiqueta}: hay una miniatura por juego`, a.length === botones && botones > 0, `${a.length} de ${botones}`);
            const quietas = a.filter((v, k) => v === bb[k]).length;
            check(
              `${etiqueta}: las miniaturas están animadas`,
              a.length > 0 && quietas === 0,
              quietas ? `${quietas} no se mueven` : "",
            );
            await sleep(200);
            await page.screenshot(join(outDir, `ui-juegos-${etiqueta}.png`));
          }
        }

        check(`${etiqueta} ${tema}: sin excepciones`, page.exceptions.length === 0, page.exceptions.slice(0, 2).join(" | "));
        try {
          await page.send("Page.close");
        } catch {
          /* ya cerrada */
        }
      }
    }
  } finally {
    await browser.close();
  }
}

run()
  .catch((e) => check("la auditoría corrió sin caerse", false, String(e).slice(0, 160)))
  .finally(() => {
    let malas = 0;
    for (const c of checks) {
      if (!c.ok) malas++;
      console.log(`  ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` · ${c.detail}` : ""}`);
    }
    console.log("");
    console.log(malas ? `RECHAZADO: ${checks.length - malas}/${checks.length}` : `APROBADO: ${checks.length}/${checks.length} comprobaciones`);
    console.log(`Capturas en ${outDir}/ui-*.png\n`);
    process.exit(malas ? 1 : 0);
  });
