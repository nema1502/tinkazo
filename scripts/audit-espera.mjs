#!/usr/bin/env node
/**
 * La espera en grande desemboca en el show.
 *
 * Nicolás, 21 de octubre de 2026: "cuando esté la espera en grande y termina,
 * debería hacer que cuando termine, empiece también, ¿no? Ahora la espera
 * termina y se sale". Desde ese día, si la espera en grande está abierta cuando
 * nace el número, el sorteo arranca solo y el show ocupa la pantalla sin pasar
 * por la página (src/ui/espera.ts).
 *
 * Esto lo comprueba en el modo libre, con `?lead=3`, sin Stellar: carga la
 * lista de ejemplo, la sella, abre la espera en grande con un clic de verdad
 * (el gesto que pide la pantalla completa) y no toca nada más. Mide cuadro por
 * cuadro, desde adentro de la página, que:
 *
 *  - la espera se abre y, con el gesto, pide la pantalla completa;
 *  - nace el número y la tarjeta del juego y el estadio aparecen solos, sin
 *    que nadie apriete "Lanzar el sorteo";
 *  - en ningún cuadro, desde que se abre la espera hasta el estadio, se ve la
 *    página: siempre hay algo que la tapa (la espera, la tarjeta o el estadio);
 *  - la pantalla completa que pidió la espera sigue puesta cuando arranca el
 *    show (la hereda: sin gesto, el navegador no la volvería a dar);
 *  - no aparece la cortina del sorteo encima de la espera: ella hace de cortina;
 *  - el show termina en el resultado en grande, sin un cuadro de la página en
 *    el medio, con la pantalla completa y el QR del comprobante; y "Cerrar"
 *    vuelve a la página, suelta la pantalla completa y deja "Siguiente premio"
 *    con el foco (desde el 21 de octubre de 2026, buscador de detalles D04);
 *  - el QR de ese resultado lleva el enlace corto, como el de "Mostrar en
 *    grande", y no lo espera más de dos segundos. El servicio de enlaces cortos
 *    es de mentira (la auditoría no crea enlaces de verdad): en las pantallas
 *    impares contesta, y el QR tiene que leerse como el corto; en las pares no
 *    contesta nunca, y el QR tiene que salir con el enlace largo a tiempo.
 *
 * Y dos casos más, en la primera pantalla:
 *
 *  - con la espera cerrada antes de que nazca el número ("Volver a la página"),
 *    todo queda como antes: el show no arranca solo y "Lanzar el sorteo" queda
 *    con el foco;
 *  - si traer el número falla (se cortan los relays a propósito), el motivo y
 *    "Reintentar el sorteo" se ven en la espera, en grande, con la pantalla
 *    completa; al volver la red y apretarlo, el show arranca.
 *
 * Deja capturas de la transición en `--out`, una cada `--cada` ms.
 *
 * Uso:
 *   node scripts/audit-espera.mjs [--base http://localhost:4173] [--out DIR]
 *                                 [--vistas 1280x720,390x844] [--tema dark|light]
 *                                 [--lang es|en] [--cada 600] [--sin-casos]
 *
 * Un Chrome a la vez y con su propio puerto: CDP_PORT=<puerto> node ...
 * Sale con código 1 si algo falla.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import jsQR from "jsqr";
import { launch, sleep } from "./lib/browser.mjs";
import { emitirJson } from "./lib/resumen.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const base = opt("base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("out", "docs/capturas/espera");
const vistas = opt("vistas", "1280x720,390x844").split(",").map((v) => {
  const [w, h] = v.split("x").map(Number);
  return { etiqueta: v, w, h, celular: w <= 700 };
});
const tema = opt("tema", "dark");
const lang = opt("lang", "es");
const cada = Number(opt("cada", "600"));
const conCasos = !args.includes("--sin-casos");
mkdirSync(outDir, { recursive: true });

let fallas = 0;
const registro = [];
const check = (nombre, ok, detalle = "") => {
  registro.push({ nombre, ok, detalle });
  if (!ok) fallas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nombre}${detalle ? ` · ${detalle}` : ""}`);
};
const info = (s) => console.log(`    ${s}`);

/** Cuadro por cuadro, desde la página: qué tapa la pantalla y si está en pantalla completa. */
const MUESTREO = `(() => {
  window.__muestras = [];
  const t0 = performance.now();
  const paso = () => {
    const est = document.getElementById('stadium');
    window.__muestras.push({
      t: Math.round(performance.now() - t0),
      espera: !!document.querySelector('.espera'),
      fase: document.querySelector('.espera .espera-sigue:not([hidden]) .espera-accion') ? 'accion' : document.querySelector('.espera .espera-sigue:not([hidden])') ? 'sorteando' : document.querySelector('.espera') ? 'cuenta' : '',
      cortina: !!document.querySelector('.cortina'),
      tarjeta: !!document.querySelector('.game-card'),
      estadio: !!est && est.style.display === 'block',
      grande: !!document.querySelector('.pantalla'),
      qr: !!document.querySelector('.pantalla .pantalla-qr img[src]'),
      fs: !!document.fullscreenElement,
    });
    if (!window.__parar) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
  return true;
})()`;

/** Un clic de verdad (con el mouse del navegador): cuenta como gesto, como el de una persona. */
async function clicReal(page, sel) {
  // A la vista y quieto: el clic va a un punto de la pantalla, no a un elemento.
  const p = JSON.parse(
    await page.eval(
      `JSON.stringify((() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })())`,
    ),
  );
  if (!p) throw new Error(`no está ${sel}`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
  }
}

/**
 * El servicio de enlaces cortos, de mentira: así la auditoría no deja copias
 * en el de verdad ni gasta su cupo por dirección. `contesta` da un enlace fijo;
 * `colgado` no contesta nunca (`acortar` se rinde a los 5 s). Devuelve los
 * pedidos que llegaron.
 */
const CORTO_ID = "Au000001";
async function servicioCorto(page, modo) {
  const pedidos = [];
  page.ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method !== "Fetch.requestPaused" || !msg.params.request.url.startsWith("https://c.tinkazo.app/")) return;
    pedidos.push(msg.params.request.method);
    if (modo === "colgado") return;
    const cuerpo = JSON.stringify({ id: CORTO_ID, borrar: "permiso-de-la-auditoria" });
    void page
      .send("Fetch.fulfillRequest", {
        requestId: msg.params.requestId,
        responseCode: 201,
        responseHeaders: [
          { name: "Content-Type", value: "application/json" },
          { name: "Access-Control-Allow-Origin", value: new URL(base).origin },
        ],
        body: Buffer.from(cuerpo).toString("base64"),
      })
      .catch(() => undefined);
  });
  await page.send("Fetch.enable", { patterns: [{ urlPattern: "https://c.tinkazo.app/*" }] });
  return pedidos;
}

/** Lo que dice el QR de una imagen de la página, leído con un lector aparte (jsQR), o null. */
async function leerQr(page, sel) {
  const raw = await page.eval(`(async () => {
    const img = document.querySelector(${JSON.stringify(sel)});
    if (!img || !img.src) return null;
    const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const c = cv.getContext('2d');
    c.drawImage(bmp, 0, 0);
    const d = c.getImageData(0, 0, bmp.width, bmp.height);
    return JSON.stringify({ w: bmp.width, h: bmp.height, data: Array.from(d.data) });
  })()`);
  if (!raw) return null;
  const px = JSON.parse(raw);
  return jsQR(Uint8ClampedArray.from(px.data), px.w, px.h)?.data ?? null;
}

/** La herramienta en modo libre, con la lista de ejemplo sellada y la espera corriendo. */
async function sellar(page, v) {
  await page.send("Emulation.setDeviceMetricsOverride", { width: v.w, height: v.h, deviceScaleFactor: 1, mobile: v.celular, screenWidth: v.w, screenHeight: v.h });
  await page.send("Page.navigate", { url: `${base}/?lead=3&pace=rapido&theme=${tema}&lang=${lang}#sortear` });
  await page.waitFor("document.readyState === 'complete'", 20000);
  await sleep(900);
  // Sin cuenta, el botón de sellar queda con aria-disabled detrás de la puerta: el modo libre arma el mismo flujo.
  await page.eval(
    "document.querySelector('#sec-participants .body').classList.remove('locked'); document.getElementById('btn-freeze').removeAttribute('aria-disabled'); document.getElementById('gate').style.display = 'none'; document.getElementById('primera-vez')?.style.setProperty('display', 'none'); true",
  );
  await page.eval("document.getElementById('btn-sample').click(); document.getElementById('btn-freeze').click(); true");
  const ok = await page.waitFor("getComputedStyle(document.getElementById('btn-espera')).display !== 'none' && document.getElementById('btn-draw').disabled", 15000);
  if (!ok.ok) throw new Error("no se selló la lista de ejemplo");
  // Que termine el desplazamiento con que la página lleva a la lista sellada.
  await sleep(700);
}

/** El caso principal: la espera abierta cuando nace el número. */
async function desemboca(browser, v, modo) {
  const quien = `${v.etiqueta} ${tema}`;
  console.log(`\n  ${quien} · la espera desemboca en el show (servicio de enlaces cortos: ${modo === "contesta" ? "contesta" : "no contesta"})`);
  const page = await browser.open("about:blank");
  try {
    await sellar(page, v);
    const pedidos = await servicioCorto(page, modo);
    await page.eval(MUESTREO);
    await clicReal(page, "#btn-espera");
    const abrio = await page.waitFor("document.querySelector('.espera')", 8000);
    check(`${quien} · la espera en grande se abre`, abrio.ok);
    if (!abrio.ok) return;
    // Las capturas de la transición, hasta un rato después de que aparece el estadio.
    let k = 0;
    let hasta = Infinity;
    const t0 = Date.now();
    while (Date.now() < hasta && Date.now() - t0 < 40000) {
      await page.screenshot(join(outDir, `espera-${v.etiqueta}-${tema}-${String(++k).padStart(2, "0")}.png`));
      if (hasta === Infinity && (await page.eval("document.getElementById('stadium').style.display === 'block'"))) hasta = Date.now() + 1500;
      await sleep(cada);
    }
    const m = await page.eval("window.__muestras");
    const abierta = m.findIndex((x) => x.espera);
    const show = m.findIndex((x, i) => i > abierta && (x.tarjeta || x.estadio));
    const estadio = m.findIndex((x) => x.estadio);
    check(`${quien} · nace el número y el show arranca solo`, show > 0 && estadio > 0, show > 0 ? `tarjeta a ${m[show].t} ms, estadio a ${estadio > 0 ? m[estadio].t : "—"} ms` : "no apareció ni la tarjeta ni el estadio");
    const tramo = show > 0 ? m.slice(abierta, estadio > 0 ? estadio + 1 : show + 1) : [];
    const huecos = tramo.filter((x) => !x.espera && !x.cortina && !x.tarjeta && !x.estadio);
    check(`${quien} · en ningún cuadro se ve la página`, tramo.length > 0 && huecos.length === 0, huecos.length ? `${huecos.length} cuadros sin nada encima, el primero a ${huecos[0].t} ms` : `${tramo.length} cuadros`);
    const sorteando = m.some((x) => x.fase === "sorteando");
    check(`${quien} · cuando nace el número la espera dice que está llegando, sin botón`, sorteando && !m.some((x) => x.fase === "accion"));
    const cortinaEncima = m.some((x) => x.espera && x.cortina);
    check(`${quien} · la cortina no aparece encima de la espera`, !cortinaEncima);
    const conPantalla = m[abierta + Math.min(30, Math.max(0, m.length - abierta - 1))]?.fs || m.slice(abierta).some((x) => x.espera && x.fs);
    if (!conPantalla) {
      info(`(el navegador no dio la pantalla completa: no se puede medir que el show la herede)`);
    } else {
      const desde = m.findIndex((x, i) => i >= abierta && x.fs);
      const perdio = m.slice(desde, estadio > 0 ? estadio + 1 : m.length).filter((x) => !x.fs);
      check(`${quien} · la pantalla completa que pidió la espera sigue con el show`, perdio.length === 0 && estadio > 0 && m[estadio].fs, perdio.length ? `se soltó a ${perdio[0].t} ms` : "");
    }
    // Saltar el juego: el show desemboca en el resultado en grande, sin pasar por la página.
    await page.eval("document.getElementById('st-skip')?.click(); true");
    const fin = await page.waitFor("document.getElementById('winner-box').style.display === 'block' && document.getElementById('stadium').style.display !== 'block' && document.querySelector('.pantalla')", 30000);
    check(`${quien} · después del show, el resultado en grande`, fin.ok);
    await sleep(800);
    // El QR sale con el comprobante y el enlace corto, o con el largo a los 2 s: hasta ahí se sigue mirando.
    const qr = await page.waitFor("document.querySelector('.pantalla .pantalla-qr img[src]')", 8000);
    await page.eval("window.__parar = true; true");
    const m2 = await page.eval("window.__muestras");
    const ultimoEstadio = m2.findLastIndex((x) => x.estadio);
    const grande = m2.findIndex((x, i) => i > ultimoEstadio && x.grande);
    const entre = ultimoEstadio >= 0 && grande > 0 ? m2.slice(ultimoEstadio, grande + 1).filter((x) => !x.estadio && !x.grande) : [null];
    check(`${quien} · entre el estadio y el resultado en grande no se ve la página`, entre.length === 0, entre.length ? `${entre.length} cuadros sin nada encima` : "");
    if (conPantalla) check(`${quien} · y sigue en pantalla completa`, !!m2[m2.length - 1]?.fs);
    check(`${quien} · el resultado en grande trae el QR del comprobante`, qr.ok);
    if (qr.ok) {
      // Desde que se ve el resultado en grande hasta que se ve el QR, y lo que dice el QR.
      const conQr = m2.findIndex((x, i) => i >= grande && x.qr);
      const tarda = grande > 0 && conQr >= 0 ? m2[conQr].t - m2[grande].t : NaN;
      const leido = await leerQr(page, ".pantalla .pantalla-qr img");
      const dice = `${leido ? `${leido.slice(0, 44)}…` : "no se pudo leer"} · a ${tarda} ms del resultado`;
      if (modo === "contesta") {
        // Con la marca del QR antes del `#` (`?o=qr`, src/contar.ts).
        const corto = new RegExp(`/c/${CORTO_ID}[?]o=qr#[A-Za-z0-9_-]{22}$`).test(leido ?? "");
        const altas = pedidos.filter((p) => p === "POST").length;
        check(`${quien} · el QR lleva el enlace corto, como "Mostrar en grande", pedido una sola vez`, corto && altas === 1, `${dice} · ${altas} pedidos`);
      } else {
        check(`${quien} · sin respuesta del servicio, el QR sale con el enlace largo antes de 3 s`, /\/verificar\.html\?o=qr#/.test(leido ?? "") && tarda <= 3000, dice);
      }
    }
    await page.screenshot(join(outDir, `espera-${v.etiqueta}-${tema}-resultado-grande.png`));
    // Cerrarlo vuelve a la página: suelta la pantalla completa y deja lo que sigue con el foco.
    await clicReal(page, ".pantalla [data-cerrar]");
    const cerro = await page.waitFor("!document.querySelector('.pantalla') && !document.fullscreenElement", 5000);
    await sleep(500);
    const f = await page.eval("document.activeElement && document.activeElement.id");
    check(`${quien} · "Cerrar" vuelve a la página, sin pantalla completa y con "Siguiente premio" con el foco`, cerro.ok && (f === "btn-again-sin" || f === "sig-btn"), `foco en ${f || "body"}`);
    await page.screenshot(join(outDir, `espera-${v.etiqueta}-${tema}-resultado.png`));
  } finally {
    await page.send("Page.close").catch(() => undefined);
  }
}

/** Con la espera cerrada antes de que nazca el número, todo queda como antes. */
async function volver(browser, v) {
  const quien = `${v.etiqueta} ${tema}`;
  console.log(`\n  ${quien} · con la espera cerrada, como antes`);
  const page = await browser.open("about:blank");
  try {
    await sellar(page, v);
    await clicReal(page, "#btn-espera");
    const abrio = await page.waitFor("document.querySelector('.espera [data-volver]')", 8000);
    if (!abrio.ok) {
      check(`${quien} · la espera en grande se abre`, false);
      return;
    }
    await clicReal(page, ".espera [data-volver]");
    const cerro = await page.waitFor("!document.querySelector('.espera')", 4000);
    check(`${quien} · "Volver a la página" la cierra`, cerro.ok);
    const fs = await page.eval("!!document.fullscreenElement");
    check(`${quien} · y suelta la pantalla completa`, !fs);
    const nacio = await page.waitFor("!document.getElementById('btn-draw').disabled", 20000);
    await sleep(1500);
    const estado = JSON.parse(
      await page.eval("JSON.stringify({ foco: document.activeElement && document.activeElement.id, tarjeta: !!document.querySelector('.game-card'), estadio: document.getElementById('stadium').style.display === 'block', espera: !!document.querySelector('.espera') })"),
    );
    check(`${quien} · nace el número y el show no arranca solo`, nacio.ok && !estado.tarjeta && !estado.estadio && !estado.espera);
    check(`${quien} · "Lanzar el sorteo" queda con el foco`, estado.foco === "btn-draw", `foco en ${estado.foco || "body"}`);
  } finally {
    await page.send("Page.close").catch(() => undefined);
  }
}

/** Si traer el número falla, el reintento se ve en grande. */
async function sinNumero(browser, v) {
  const quien = `${v.etiqueta} ${tema}`;
  console.log(`\n  ${quien} · sin el número, el reintento en grande`);
  const page = await browser.open("about:blank");
  try {
    await sellar(page, v);
    // Los relays del número dejan de contestar.
    await page.send("Fetch.enable", { patterns: [{ urlPattern: "*drand*" }] });
    const cortar = (msg) => {
      if (msg.method === "Fetch.requestPaused") void page.send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "InternetDisconnected" }).catch(() => undefined);
    };
    page.ws.addEventListener("message", (ev) => cortar(JSON.parse(ev.data)));
    await page.eval(MUESTREO);
    await clicReal(page, "#btn-espera");
    await page.waitFor("document.querySelector('.espera')", 8000);
    info("esperando a que se rindan los intentos (unos 25 s)…");
    const fallo = await page.waitFor("document.querySelector('.espera .espera-accion')", 60000);
    const estado = JSON.parse(
      await page.eval(
        "JSON.stringify({ motivo: (document.querySelector('.espera .espera-motivo') || {}).textContent || '', boton: (document.querySelector('.espera .espera-accion') || {}).textContent || '', foco: document.activeElement && document.activeElement.className, fs: !!document.fullscreenElement })",
      ),
    );
    check(`${quien} · el motivo y "Reintentar el sorteo" se ven en la espera`, fallo.ok && !!estado.motivo && !!estado.boton, `"${estado.motivo}" · "${estado.boton}"`);
    check(`${quien} · el reintento tiene el foco`, /espera-accion/.test(estado.foco || ""));
    const m = await page.eval("window.__muestras");
    if (m.some((x) => x.espera && x.fs)) check(`${quien} · sigue en pantalla completa`, estado.fs);
    await page.screenshot(join(outDir, `espera-${v.etiqueta}-${tema}-sin-numero.png`));
    // Vuelve la red, y el reintento lleva al show.
    await page.send("Fetch.disable");
    await clicReal(page, ".espera .espera-accion");
    const show = await page.waitFor("document.querySelector('.game-card') || document.getElementById('stadium').style.display === 'block'", 30000);
    check(`${quien} · al reintentar con la red de vuelta, el show arranca`, show.ok);
    await page.eval("window.__parar = true; true");
  } finally {
    await page.send("Page.close").catch(() => undefined);
  }
}

const browser = await launch({ width: 1280, height: 900 });
try {
  for (const [i, v] of vistas.entries()) {
    try {
      await desemboca(browser, v, i % 2 === 0 ? "contesta" : "colgado");
    } catch (e) {
      check(`${v.etiqueta} ${tema} · la espera desemboca en el show`, false, e.message);
    }
  }
  if (conCasos) {
    const v = vistas[0];
    for (const caso of [volver, sinNumero]) {
      try {
        await caso(browser, v);
      } catch (e) {
        check(`${v.etiqueta} ${tema} · ${caso.name}`, false, e.message);
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`\n${fallas ? `✗ ${fallas} fallas` : "✓ todo bien"} · capturas en ${outDir}`);
emitirJson({ auditor: "audit-espera", objetivo: "sitio", checks: registro });
process.exit(fallas ? 1 : 0);
