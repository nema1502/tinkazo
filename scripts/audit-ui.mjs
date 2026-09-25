#!/usr/bin/env node
/**
 * Auditor de la interfaz: la cabecera, la cuenta y el selector de juegos.
 *
 * Existe porque hubo dos cosas rotas que ninguna comprobación miraba: la foto
 * de perfil que no cargaba y dejaba el icono de imagen rota en el medio de la
 * cabecera, y el nombre completo cortado a la mitad. Las dos se veían a simple
 * vista y ninguna fallaba nada.
 *
 * Comprueba lo que se puede comprobar solo: que nada se salga de su caja, que
 * nada se pise, que el texto se lea, que las miniaturas estén animadas de
 * verdad y que los blancos de toque alcancen en un celular.
 *
 * Uso:
 *   node scripts/audit-ui.mjs [--base http://localhost:4173] [--out DIR]
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { launch } from "./lib/browser.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const base = opt("--base", "http://localhost:4173").replace(/\/$/, "");
const outDir = opt("--out", "docs/capturas");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok, detail });

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
  const bgOf = (el) => { let e = el; while (e) { const b = getComputedStyle(e).backgroundColor; if (opaque(b)) return nums(b); e = e.parentElement; } return [255,255,255]; };
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
    if (own.length > 1) {
      const size = parseFloat(cs.fontSize), w = parseInt(cs.fontWeight) || 400;
      const need = (size >= 24 || (size >= 18.66 && w >= 700)) ? 3 : 4.5;
      const op = parseFloat(cs.opacity) || 1;
      const bg = bgOf(el);
      let col = nums(cs.color);
      if (op < 1) col = col.map((v, i) => v * op + bg[i] * (1 - op));
      const got = ratio(col, bg);
      if (got < need) out.texto.push({ t: own.slice(0, 26), r: got, need, sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0] });
      // Texto recortado por su propia caja. Lo que está fuera de pantalla a
      // propósito para los lectores no cuenta: no lo ve nadie.
      const oculto = el.classList.contains('sr-only');
      if (!oculto && el.scrollWidth > el.clientWidth + 2 && cs.overflow !== 'visible' && el.clientWidth > 4) {
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

/** Conecta con la cuenta de prueba, que es la única que no necesita a nadie. */
async function connect(page) {
  await page.waitFor(`document.querySelector('#gate button, #wallet-box button')`, 20000);
  await sleep(500);
  await page.eval(`(document.querySelector('#gate button') || document.querySelector('#wallet-box button')).click()`);
  const abrio = await page.waitFor(`document.querySelector('.wallet-row')`, 15000);
  if (!abrio.ok) return false;
  await sleep(300);
  const i = await page.eval(
    `String([...document.querySelectorAll('.wallet-row b')].findIndex(e => /prueba|Test account/.test(e.textContent)))`,
  );
  if (i === "-1") return false;
  await page.eval(`[...document.querySelectorAll('.wallet-row')][${i}].click()`);
  const cerro = await page.waitFor(`!document.querySelector('.modal-back')`, 90000);
  await sleep(600);
  return cerro.ok;
}

async function run() {
  await mkdir(outDir, { recursive: true });
  const browser = await launch({ width: 1440, height: 900 });
  try {
    console.log(`\nAuditando la interfaz contra ${base}\n`);

    for (const [ancho, alto, etiqueta] of [[1440, 900, "escritorio"], [390, 844, "celular"]]) {
      for (const tema of ["dark", "light"]) {
        const page = await browser.open("about:blank");
        await page.send("Emulation.setDeviceMetricsOverride", {
          width: ancho, height: alto, deviceScaleFactor: 2, mobile: ancho < 500,
          screenWidth: ancho, screenHeight: alto,
        });
        await page.send("Page.navigate", { url: `${base}/?theme=${tema}` });

        const ok = await connect(page);
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

        // El panel de la cuenta.
        await page.eval(`document.querySelector('#wallet-box .hello').click()`);
        const panel = await page.waitFor(`document.querySelector('.acct-card')`, 10000);
        check(`${etiqueta} ${tema}: se abre el panel de la cuenta`, panel.ok);
        if (panel.ok) {
          await sleep(1200);
          const p = JSON.parse(await page.eval(PROBE));
          check(
            `${etiqueta} ${tema}: sin imágenes rotas`,
            p.rotas.length === 0,
            p.rotas.slice(0, 2).join(" | "),
          );
          check(
            `${etiqueta} ${tema}: sin texto recortado`,
            p.desbordes.length === 0,
            p.desbordes.slice(0, 2).map((d) => `"${d.t}" ${d.sw}>${d.cw}`).join(" | "),
          );
          check(
            `${etiqueta} ${tema}: contraste del texto`,
            p.texto.length === 0,
            p.texto.slice(0, 3).map((x) => `"${x.t}" ${x.r}<${x.need}`).join(" | "),
          );
          check(
            `${etiqueta} ${tema}: sin scroll horizontal`,
            p.scroll.doc <= p.scroll.vista + 1,
            `${p.scroll.doc} vs ${p.scroll.vista}`,
          );
          if (etiqueta === "celular") {
            check(
              "celular: blancos de toque de 44 px",
              p.toques.length === 0,
              p.toques.slice(0, 3).map((x) => `"${x.t}" ${x.h}px`).join(" | "),
            );
          }
          await page.screenshot(join(outDir, `ui-cuenta-${etiqueta}-${tema}.png`));
          await page.eval(`document.querySelector('.acct-back').remove()`);
        }

        // El selector de juegos, que aparece al congelar.
        if (tema === "dark") {
          await page.eval(`document.getElementById('btn-sample').click()`);
          await page.eval(`document.getElementById('btn-freeze').click()`);
          const cong = await page.waitFor(
            `getComputedStyle(document.getElementById('sec-frozen')).display !== 'none'`,
            150000,
          );
          check(`${etiqueta}: la lista se congela`, cong.ok);
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
      }
    }
  } finally {
    browser.close();
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
