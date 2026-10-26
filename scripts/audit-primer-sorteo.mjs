#!/usr/bin/env node
/**
 * El primer sorteo, medido como lo vive alguien que llega por primera vez
 * (diseño del onboarding, 22 de octubre de 2026; nace del robot de la fase 1,
 * el robot del diseño).
 *
 * Un robot que toca como una persona apurada, en un Chrome nuevo por recorrido,
 * y cuenta toques, scrolls y segundos hasta el ganador, y en cada paso qué
 * acciones principales se ven y qué palabras técnicas hay a la vista:
 *
 * - `cuenta`: la portada → "Otras formas de entrar" → "Más formas de entrar" →
 *   la cuenta de prueba → "Pegar lista" → un premio → "Sellar la lista" →
 *   esperar el número → "Lanzar el sorteo" → el ganador. Sella y sortea de
 *   verdad en testnet (con Google serían el botón de la portada y elegir la
 *   cuenta, que un robot no puede hacer).
 * - `sincuenta`: "Sortear" de la cabecera → "Pegar lista" → "Sellar la lista"
 *   → la ventana con su motivo → la cuenta de prueba → "Ya entraste" con el
 *   foco en "Sellar la lista". No sella.
 * - `ensayo`: la portada → "Probar con un ejemplo" → "Sellar la lista" →
 *   "Lanzar el sorteo" → el final del ensayo.
 * - `ensayo-cuenta`: lo mismo con la cuenta de prueba abierta, y lo que importa:
 *   **ninguna llamada a la cadena** (ni simular ni mandar), nada nuevo en Mis
 *   sorteos ni en el servicio de enlaces cortos. Es la prueba de punta a punta
 *   de que el ensayo no graba (las unitarias están en src/ensayo-modo.test.ts).
 *
 * Uso:
 *   CDP_PORT=9701 node scripts/audit-primer-sorteo.mjs --base http://localhost:4700 \
 *     [--vistas celular,safari,escritorio] [--temas dark,light] \
 *     [--flujos cuenta,sincuenta,ensayo,ensayo-cuenta] [--out carpeta]
 *
 * Deja `resultados.json`, `log.txt` y una captura por paso en `--out`. Sale con
 * código 1 si algo de lo que comprueba falla (marcado con ✗).
 */
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { launch, sleep } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const arg = (k, def) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BASE = arg("base", "http://localhost:4173").replace(/\/$/, "");
const OUT = arg("out", "docs/capturas/primer-sorteo");
const vistasArg = arg("vistas", "celular,safari,escritorio");
const temasArg = arg("temas", "dark,light");
const flujosArg = arg("flujos", "cuenta,sincuenta,ensayo,ensayo-cuenta");
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "log.txt");
writeFileSync(LOG, "");
const log = (s) => {
  console.log(s);
  appendFileSync(LOG, s + "\n");
};

const VISTAS = {
  celular: { w: 390, h: 844, mobile: true },
  // Lo que deja ver Safari en un iPhone con sus barras.
  safari: { w: 390, h: 664, mobile: true },
  escritorio: { w: 1280, h: 720, mobile: false },
};

const NOMBRES = [
  "Ana Quispe", "Beto Mamani", "Carla Choque", "Diego Rojas", "Elena Condori", "Fabián Torrez", "Gabriela Flores",
  "Hugo Vargas", "Inés Gutiérrez", "Jorge Mamani", "Karen López", "Luis Apaza", "María Quispe", "Nicolás Arce",
  "Olga Ticona", "Pablo Gutiérrez", "Rosa Limachi", "Sergio Cruz", "Tania Poma", "Ulises Chura",
].join("\n");

/** Lo técnico que no debería ver quien sortea (docs/ux.md, principio 7). Las tres primeras son las de la tarea. */
const TAREA = ["ronda", "faro", "transacción"];
const JERGA = [...TAREA, "drand", "hash", "huella", "firma", "bytes", "XLM", "testnet", "Stellar", "billetera", "wallet", "Soroban", "contrato", "quicknet", "comisión", "ledger"];

let fallas = 0;
const check = (que, ok, detalle = "") => {
  if (!ok) fallas++;
  log(`  ${ok ? "✓" : "✗"} ${que}${detalle ? ` — ${detalle}` : ""}`);
  return ok;
};

/** Lo que se ve ahora: los botones principales visibles (el de color de la casa), cuántas palabras y la jerga. */
const SONDA = `JSON.stringify((() => {
  const vh = innerHeight, vw = innerWidth;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  // Las principales a la vista, también la apagada que dice cuánto falta ("Se habilita en 0:38"): es la del paso.
  // "A la vista" como en audit-flujo: entera, sin la cabecera fija y sin quedar detrás de la barra de lo que sigue
  // (la barra sale justo cuando el botón de verdad no entra entero, y lo tapa).
  const cab = document.querySelector('header');
  const arriba = cab && getComputedStyle(cab).position === 'sticky' ? cab.getBoundingClientRect().bottom : 0;
  const bar = document.getElementById('siguiente');
  const barTop = bar && bar.classList.contains('on') ? bar.getBoundingClientRect().top : vh;
  const entero = (el) => { const r = el.getBoundingClientRect(); const abajo = bar && bar.contains(el) ? vh : barTop;
    return vis(el) && r.top >= arriba - 1 && r.bottom <= abajo + 1 && r.left >= -1 && r.right <= vw + 1; };
  const prin = [...document.querySelectorAll('button.primary, a.primary')].filter(entero).filter((b) => !b.closest('[inert]'))
    .map((b) => (b.textContent || '').trim().slice(0, 40));
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let palabras = 0; const texto = [];
  while (w.nextNode()) { const n = w.currentNode; const s = n.textContent.trim(); if (!s) continue;
    const el = n.parentElement; if (!el || el.closest('script,style,[inert],svg')) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const rg = document.createRange(); rg.selectNodeContents(n); const r = rg.getBoundingClientRect();
    if (r.width === 0 || r.bottom <= 0 || r.top >= vh) continue;
    palabras += s.split(/\\s+/).length; texto.push(s); }
  const todo = texto.join(' ');
  const jerga = ${JSON.stringify(JERGA)}.filter((j) => new RegExp('(^|[^\\\\p{L}])' + j, 'iu').test(todo));
  return { principales: prin, palabras, jerga, scrollY: Math.round(scrollY) };
})())`;

/** La caja de un elemento y si se ve entero, sin la cabecera fija ni la barra de lo que sigue. */
const CAJA = (sel) => `JSON.stringify((() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || r.width === 0) return { oculto: true };
  const cab = document.querySelector('header');
  // La cabecera fija tapa lo de arriba, pero no a lo que está en ella ("Sortear"): el robot de la fase 1 contaba un scroll ahí.
  const arriba = cab && !cab.contains(el) && getComputedStyle(cab).position === 'sticky' ? cab.getBoundingClientRect().bottom : 0;
  const bar = document.getElementById('siguiente');
  // La barra tapa lo de abajo, pero no a su propio botón (el robot de la fase 1 contaba un scroll ahí).
  const abajo = bar && bar.classList.contains('on') && !bar.contains(el) ? bar.getBoundingClientRect().top : innerHeight;
  return { top: Math.round(r.top), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), aLaVista: r.top >= arriba - 1 && r.bottom <= abajo + 1 };
})())`;

class Medicion {
  constructor(page, nombre) {
    this.page = page;
    this.nombre = nombre;
    this.t0 = Date.now();
    this.toques = 0;
    this.scrolls = 0;
    this.pasos = [];
    this.n = 0;
  }
  t() {
    return ((Date.now() - this.t0) / 1000).toFixed(1);
  }
  async foto(etq) {
    this.n++;
    const f = `${this.nombre}-${String(this.n).padStart(2, "0")}-${etq}.jpg`;
    try {
      const { data } = await this.page.send("Page.captureScreenshot", { format: "jpeg", quality: 55 }, 30000);
      writeFileSync(join(OUT, f), Buffer.from(data, "base64"));
    } catch (e) {
      log(`  (sin captura: ${e.message})`);
    }
    let s;
    try {
      s = JSON.parse(await this.page.eval(SONDA));
    } catch (e) {
      s = { error: String(e).slice(0, 80) };
    }
    this.pasos.push({ t: this.t(), etq, foto: f, toques: this.toques, scrolls: this.scrolls, ...s });
    log(`  [${this.t()} s] ${etq} · toques ${this.toques} · scrolls ${this.scrolls} · principales ${JSON.stringify(s.principales)} · palabras ${s.palabras} · jerga ${JSON.stringify(s.jerga)}`);
    return s;
  }
  /** Toca lo que se ve. Si no se ve, la barra de lo que sigue (si la hay y se pidió) o un scroll. */
  async tocar(sel, que, { barra = false } = {}) {
    let c = JSON.parse(await this.page.eval(CAJA(sel)));
    if (!c || c.oculto) throw new Error(`no está ${sel} (${que})`);
    let via = "botón";
    if (!c.aLaVista) {
      const b = barra ? JSON.parse(await this.page.eval(CAJA("#sig-btn"))) : null;
      const on = barra && (await this.page.eval("document.getElementById('siguiente')?.classList.contains('on') || false"));
      if (b && !b.oculto && on && b.aLaVista) {
        c = b;
        via = "barra";
      } else {
        this.scrolls++;
        await this.page.eval(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' }); true`);
        await sleep(700);
        c = JSON.parse(await this.page.eval(CAJA(sel)));
        via = "botón tras scroll";
      }
    }
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.page.send("Input.dispatchMouseEvent", { type, x: c.x, y: c.y, button: "left", clickCount: 1 });
    }
    this.toques++;
    log(`  [${this.t()} s] toque ${this.toques}: ${que} (${via})`);
    return via;
  }
}

/** Un Chrome por recorrido, sin nada guardado: alguien que llega por primera vez. Con la red anotada. */
async function nuevaPagina(browser, vista, tema, url) {
  const page = await browser.open("about:blank");
  await page.send("Storage.clearDataForOrigin", { origin: new URL(BASE).origin, storageTypes: "all" }).catch(() => {});
  const v = VISTAS[vista];
  await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.mobile, screenWidth: v.w, screenHeight: v.h });
  if (v.mobile) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }).catch(() => {});
  // El tema del sistema: `?theme=` no viaja por los enlaces de la cabecera ni por la recarga del ensayo.
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: tema }] }).catch(() => {});
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await page.send("Browser.grantPermissions", { permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"], origin: new URL(BASE).origin }).catch(() => {});
  // Todo lo que sale a la red: para saber si algo fue a la cadena o al servicio de enlaces.
  const red = [];
  page.ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method !== "Network.requestWillBeSent") return;
    const r = m.params.request;
    red.push({ url: r.url, metodo: r.method, cuerpo: (r.postData || "").slice(0, 200) });
  });
  await page.send("Network.enable").catch(() => {});
  await page.send("Page.navigate", { url });
  return { page, red };
}

const aLaCadena = (red) => red.filter((r) => /soroban|sorobanrpc/.test(r.url) && /"method":"(sendTransaction|simulateTransaction)"/.test(r.cuerpo));
const aEnlaces = (red) => red.filter((r) => /c\.tinkazo\.app/.test(r.url) && r.metodo === "POST");

/** Una acción principal a la vista, una sola (docs/ux.md). Devuelve su texto. */
function unaPrincipal(s, quien, esperado) {
  const p = s.principales || [];
  const ok = p.length === 1 && (!esperado || esperado.test(p[0]));
  check(`${quien}: una sola acción principal a la vista${esperado ? ` (${esperado.source})` : ""}`, ok, JSON.stringify(p));
  return p[0];
}

const sinJergaDeLaTarea = (s, quien) => {
  const j = (s.jerga || []).filter((x) => TAREA.includes(x));
  check(`${quien}: sin "ronda", "faro" ni "transacción" a la vista`, j.length === 0, JSON.stringify(j));
};

/** La cuenta de prueba desde la ventana de ingreso: "Más formas de entrar" (si está plegada) y la opción. */
async function cuentaDePrueba(m, page) {
  await page.waitFor("document.querySelector('.login-opt')", 20000);
  await sleep(500);
  const plegada = await page.eval("!!document.querySelector('.login-mas') && !document.querySelector('.login-mas').open");
  if (plegada) await m.tocar(".login-mas > summary", "Más formas de entrar");
  await sleep(300);
  const i = await page.eval(`String([...document.querySelectorAll('.login-opt')].findIndex((e) => /prueba|Test account/.test(e.textContent)))`);
  if (i === "-1") throw new Error("la ventana no ofrece la cuenta de prueba");
  await page.eval(`[...document.querySelectorAll('.login-opt')][${i}].setAttribute('data-prueba', '1'); true`);
  await m.tocar("[data-prueba='1']", "Cuenta de prueba");
  const entro = await page.waitFor("!document.querySelector('.modal-back') && document.querySelector('#wallet-box .hello')", 120000);
  if (!entro.ok) throw new Error("la cuenta de prueba no quedó conectada");
}

/** Copia la lista al portapapeles y toca "Pegar lista"; si el portapapeles no pegó, pega como el sistema. */
async function pegar(m, page) {
  await page.eval(`navigator.clipboard.writeText(${JSON.stringify(NOMBRES)}).then(() => true, () => false)`);
  // Con la lista vacía la barra también ofrece "Pegar lista" (siguiente.ts): si el botón no entra, se usa.
  await m.tocar("#btn-pegar", "Pegar lista", { barra: true });
  await sleep(1200);
  let n = await page.eval("document.getElementById('ta').value.split('\\n').filter((s) => s.trim()).length");
  if (n < 2) {
    log("  (Pegar lista no pegó: se pega como el sistema)");
    await page.eval(`(() => { const ta = document.getElementById('ta'); ta.focus(); const dt = new DataTransfer(); dt.setData('text/plain', ${JSON.stringify(NOMBRES)}); ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); return true; })()`);
    m.toques++;
    await sleep(800);
    n = await page.eval("document.getElementById('ta').value.split('\\n').filter((s) => s.trim()).length");
  }
  return n;
}

const resultados = [];

async function flujoCuenta(browser, vista, tema) {
  const nombre = `cuenta-${vista}-${tema}`;
  log(`\n== ${nombre}`);
  const { page, red } = await nuevaPagina(browser, vista, tema, `${BASE}/`);
  const m = new Medicion(page, nombre);
  try {
    await page.waitFor("document.readyState === 'complete' && document.querySelector('.hero [data-cta-entrar]')", 30000);
    await sleep(1200);
    const portada = await m.foto("portada");
    unaPrincipal(portada, `${nombre} · portada`);
    await m.tocar(".hero [data-otras-formas]", "Otras formas de entrar");
    await cuentaDePrueba(m, page);
    await sleep(1500);
    const entro = await m.foto("con-cuenta");
    unaPrincipal(entro, `${nombre} · recién entrado`, /Pegar lista|Paste list/);
    const n = await pegar(m, page);
    const pegada = await m.foto("lista-pegada");
    check(`${nombre} · la lista quedó en el cuadro`, n === 20, `${n} nombres`);
    unaPrincipal(pegada, `${nombre} · lista pegada`, /Sellar|Seal/);
    const foco = await page.eval("document.activeElement && document.activeElement.id");
    check(`${nombre} · después de pegar, el cuadro no se queda con el foco en el celular`, !VISTAS[vista].mobile || foco !== "ta", `foco en ${foco}`);
    const chip = await page.eval(`(() => { const b = [...document.querySelectorAll('#prize-chips button')]; const t = b.find((x) => /Termo/i.test(x.textContent)) || b[0]; if (!t) return ''; t.setAttribute('data-onb', '1'); return t.textContent.trim(); })()`);
    if (chip) await m.tocar("[data-onb='1']", `premio: ${chip}`);
    await sleep(400);
    const resumen = await page.eval("document.getElementById('sellar-resumen')?.textContent || ''");
    check(`${nombre} · el resumen antes de sellar dice qué se sella`, /20 (personas|people)/.test(resumen), resumen);
    await m.tocar("#btn-freeze", "Sellar la lista", { barra: true });
    const tSello = Date.now();
    await sleep(800);
    const sellando = await m.foto("sellando");
    sinJergaDeLaTarea(sellando, `${nombre} · sellando`);
    const sellada = await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' && getComputedStyle(document.getElementById('wait-box')).display !== 'none'", 240000);
    log(`  sellada a los ${m.t()} s (${((Date.now() - tSello) / 1000).toFixed(1)} s sellando)`);
    if (!sellada.ok) throw new Error("no se selló: " + (await page.eval("document.getElementById('seal-status').textContent")));
    await sleep(1500);
    const esperando = await m.foto("esperando");
    unaPrincipal(esperando, `${nombre} · esperando`, /Se habilita|Available/);
    sinJergaDeLaTarea(esperando, `${nombre} · esperando`);
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 180000);
    if (!nacio.ok) throw new Error("el número no salió");
    await sleep(800);
    const lista = await m.foto("numero-listo");
    unaPrincipal(lista, `${nombre} · el número salió`, /Lanzar|Run/);
    await m.tocar("#btn-draw", "Lanzar el sorteo", { barra: true });
    const fin = await page.waitFor("document.getElementById('stadium').style.display !== 'block' && document.querySelector('#winner-cards')?.children.length > 0 && !document.querySelector('.game-card')", 240000);
    if (!fin.ok) throw new Error("no llegó al ganador");
    await sleep(1500);
    const res = await m.foto("resultado");
    unaPrincipal(res, `${nombre} · resultado`, /Siguiente|Next/);
    resultados.push({ flujo: nombre, ok: true, toques: m.toques, scrolls: m.scrolls, segundos: m.t(), pasos: m.pasos, cadena: aLaCadena(red).length });
  } catch (e) {
    check(`${nombre} · el recorrido llegó al final`, false, e.message);
    await m.foto("falla").catch(() => {});
    resultados.push({ flujo: nombre, ok: false, error: e.message, toques: m.toques, scrolls: m.scrolls, segundos: m.t(), pasos: m.pasos });
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}

async function flujoSinCuenta(browser, vista, tema) {
  const nombre = `sincuenta-${vista}-${tema}`;
  log(`\n== ${nombre}`);
  const { page } = await nuevaPagina(browser, vista, tema, `${BASE}/`);
  const m = new Medicion(page, nombre);
  try {
    await page.waitFor("document.readyState === 'complete' && document.querySelector('.nav-app')", 30000);
    await sleep(1000);
    await m.tocar(".topnav .nav-app", "Sortear (cabecera)");
    await sleep(1800);
    const puerta = await m.foto("herramienta");
    unaPrincipal(puerta, `${nombre} · la herramienta sin cuenta`, /Pegar lista|Paste list/);
    const gate = await page.eval("JSON.stringify({ alto: Math.round(document.getElementById('gate').getBoundingClientRect().height), boton: !!document.querySelector('#gate button') })");
    const g = JSON.parse(gate);
    // Con la letra de 16 px (letra grande, 24 de octubre de 2026) el texto da dos renglones a 390 px y el botón queda
    // debajo: 124 px. Lo que se vigila es que siga siendo un aviso compacto con su botón secundario, y no un bloque.
    check(`${nombre} · la cuenta es un aviso compacto con su botón`, g.boton && g.alto <= 140, `${g.alto} px`);
    const oferta = await page.eval("getComputedStyle(document.getElementById('primera-vez')).display !== 'none'");
    check(`${nombre} · la oferta de primera vez está, sin botones de color`, oferta && !(await page.eval("!!document.querySelector('#primera-vez .primary')")));
    await pegar(m, page);
    const pegada = await m.foto("pegada");
    unaPrincipal(pegada, `${nombre} · lista pegada sin cuenta`, /Sellar|Seal/);
    const via = await m.tocar("#btn-freeze", "Sellar la lista (sin cuenta)", { barra: true });
    await page.waitFor("document.querySelector('.login-opt')", 20000);
    await sleep(600);
    const ventana = await m.foto("ventana-motivo");
    const motivo = await page.eval("document.querySelector('.login-head p')?.textContent || ''");
    check(`${nombre} · la ventana dice para qué`, /20/.test(motivo), motivo);
    const enfoco = await page.eval("document.activeElement && (document.activeElement.id || document.activeElement.className)");
    check(`${nombre} · la ventana no deja el foco en el correo`, !/login-mail/.test(String(enfoco)), String(enfoco));
    void ventana;
    await cuentaDePrueba(m, page);
    await sleep(1500);
    const vuelta = await m.foto("ya-entraste");
    const ya = JSON.parse(await page.eval("JSON.stringify({ ve: getComputedStyle(document.getElementById('ya-entraste')).display !== 'none', texto: document.getElementById('ya-entraste').textContent, foco: document.activeElement && document.activeElement.id, sellada: !!document.getElementById('sec-frozen') && getComputedStyle(document.getElementById('sec-frozen')).display !== 'none' })"));
    check(`${nombre} · al entrar: "Ya entraste" y el foco en "Sellar la lista", sin sellar solo`, ya.ve && /20/.test(ya.texto) && ya.foco === "btn-freeze" && !ya.sellada, JSON.stringify(ya));
    unaPrincipal(vuelta, `${nombre} · ya entró`, /Sellar|Seal/);
    resultados.push({ flujo: nombre, ok: true, toques: m.toques, scrolls: m.scrolls, segundos: m.t(), via, pasos: m.pasos });
  } catch (e) {
    check(`${nombre} · el recorrido llegó al final`, false, e.message);
    await m.foto("falla").catch(() => {});
    resultados.push({ flujo: nombre, ok: false, error: e.message, pasos: m.pasos });
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}

/** El ensayo, desde la portada (sin cuenta) o con la cuenta de prueba abierta (`conCuenta`). */
async function flujoEnsayo(browser, vista, tema, conCuenta) {
  const nombre = `${conCuenta ? "ensayo-cuenta" : "ensayo"}-${vista}-${tema}`;
  log(`\n== ${nombre}`);
  const { page, red } = await nuevaPagina(browser, vista, tema, `${BASE}/`);
  const m = new Medicion(page, nombre);
  try {
    await page.waitFor("document.readyState === 'complete' && document.querySelector('.hero [data-entrar-ensayo]')", 30000);
    await sleep(1000);
    let historiaAntes = "[]";
    if (conCuenta) {
      // Con la cuenta de prueba abierta, como quien entró y quiere probar antes de su evento.
      await m.tocar(".hero [data-otras-formas]", "Otras formas de entrar");
      await cuentaDePrueba(m, page);
      await sleep(1500);
      historiaAntes = await page.eval("localStorage.getItem('tinkazo.history.testnet') || '[]'");
      // El ensayo, desde el enlace de debajo del cuadro vacío.
      await m.tocar("#btn-ensayo", "o probá con un ejemplo");
    } else {
      await m.tocar(".hero [data-entrar-ensayo]", "Probar con un ejemplo");
    }
    await page.waitFor("document.body.dataset.ensayo === '1'", 10000);
    await sleep(1200);
    const entra = await m.foto("ensayo");
    unaPrincipal(entra, `${nombre} · el ensayo arranca`, /Sellar|Seal/);
    const banda = await page.eval("getComputedStyle(document.getElementById('ensayo-banda')).display !== 'none'");
    const guia = await page.eval("document.getElementById('ensayo-guia').textContent");
    check(`${nombre} · se ve que es un ensayo, con la línea que guía`, banda && /Sellar|Seal/.test(guia), guia);
    await m.tocar("#btn-freeze", "Sellar la lista", { barra: true });
    await page.waitFor("getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'", 20000);
    await sleep(1200);
    const espera = await m.foto("ensayo-esperando");
    sinJergaDeLaTarea(espera, `${nombre} · esperando`);
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 60000);
    if (!nacio.ok) throw new Error("el número no salió");
    log(`  el número salió a los ${m.t()} s`);
    await sleep(600);
    await m.tocar("#btn-draw", "Lanzar el sorteo", { barra: true });
    const estadio = await page.waitFor("document.getElementById('stadium').style.display === 'block'", 60000);
    if (estadio.ok) {
      await sleep(2500);
      const rotulo = await page.eval("getComputedStyle(document.getElementById('st-round'), '::after').content");
      check(`${nombre} · el estadio dice que es un ensayo`, /ENSAYO|REHEARSAL/.test(rotulo), rotulo);
      await m.foto("ensayo-estadio");
    }
    const fin = await page.waitFor("document.getElementById('stadium').style.display !== 'block' && document.querySelector('#winner-cards')?.children.length > 0 && !document.querySelector('.game-card')", 180000);
    if (!fin.ok) throw new Error("no llegó al ganador");
    await sleep(1500);
    const res = await m.foto("ensayo-final");
    unaPrincipal(res, `${nombre} · el final del ensayo`, /Sortear con mi lista|Draw with my list/);
    const final = JSON.parse(await page.eval("JSON.stringify(['#again-row', '#btn-grande', '#qr-box', '#btn-proof', '#btn-whatsapp'].filter((s) => { const e = document.querySelector(s); return e && e.getClientRects().length && getComputedStyle(e).display !== 'none'; }))"));
    check(`${nombre} · al final no hay siguiente premio, en grande, QR ni compartir`, final.length === 0, JSON.stringify(final));
    const cadena = aLaCadena(red);
    check(`${nombre} · nada fue a la cadena (ni simular ni mandar)`, cadena.length === 0, cadena.map((r) => r.cuerpo.slice(0, 60)).join(" | "));
    const enlaces = aEnlaces(red);
    check(`${nombre} · nada fue al servicio de enlaces cortos`, enlaces.length === 0, `${enlaces.length} pedidos`);
    if (conCuenta) {
      const historia = await page.eval("localStorage.getItem('tinkazo.history.testnet') || '[]'");
      check(`${nombre} · Mis sorteos no cambió`, historia === historiaAntes, `${historiaAntes.length} → ${historia.length} caracteres`);
    }
    resultados.push({ flujo: nombre, ok: true, toques: m.toques, scrolls: m.scrolls, segundos: m.t(), pasos: m.pasos, cadena: cadena.length });
  } catch (e) {
    check(`${nombre} · el recorrido llegó al final`, false, e.message);
    await m.foto("falla").catch(() => {});
    resultados.push({ flujo: nombre, ok: false, error: e.message, pasos: m.pasos });
  } finally {
    await page.send("Page.close").catch(() => {});
  }
}

const browser = await launch({ port: Number(process.env.CDP_PORT || 9222), width: 1280, height: 900 });
try {
  const flujos = flujosArg.split(",");
  for (const vista of vistasArg.split(",")) {
    for (const tema of temasArg.split(",")) {
      if (flujos.includes("sincuenta")) await flujoSinCuenta(browser, vista, tema);
      if (flujos.includes("ensayo")) await flujoEnsayo(browser, vista, tema, false);
      if (flujos.includes("cuenta")) {
        const antes = fallas;
        await flujoCuenta(browser, vista, tema);
        // Un reintento si testnet rechazó o tardó: lo medido en el intento caído no cuenta.
        const ult = resultados[resultados.length - 1];
        if (!ult.ok) {
          log("  reintento en 15 s (lo de este intento no cuenta)");
          await sleep(15000);
          fallas = antes;
          ult.descartado = true;
          await flujoCuenta(browser, vista, tema);
        }
      }
    }
  }
  // Con la cuenta abierta, una vez alcanza: la prueba de que el ensayo no graba no depende de la pantalla.
  if (flujos.includes("ensayo-cuenta")) await flujoEnsayo(browser, vistasArg.split(",")[0], temasArg.split(",")[0], true);
} finally {
  writeFileSync(join(OUT, "resultados.json"), JSON.stringify(resultados, null, 1));
  await browser.close();
}
log(`\n${fallas ? `✗ ${fallas} fallas` : "✓ todo bien"} · ${resultados.length} recorridos · capturas y resultados en ${OUT}`);
process.exit(fallas ? 1 : 0);
