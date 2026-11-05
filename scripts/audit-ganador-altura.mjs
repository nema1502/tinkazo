#!/usr/bin/env node
/** Reconocimiento reproducible, sin escrituras remotas. WebKit normal (sin bypass de sandbox).
 * Uso: node scripts/audit-ganador-altura.mjs [--base URL] [--out DIR]
 *   [--juegos race,sapo,trompo,chovena,pinata,wheel,teleferico,oruro]
 *   [--vistas 1024x521,1024x560,1024x600,390x560] [--fase estadio|estadio-lista|resultado]
 *   [--comprobar] [--relator original|natural] [--nombres largos|cortos]
 *   [--lang es|en] [--movimiento normal|reduce] [--dispositivo viewport|iphone13] [--motor 2d|3d] [--help]
 * PLAYWRIGHT_PATH permite indicar el módulo instalado; por defecto importa 'playwright'.
 * --help imprime estas opciones y sale sin importar Playwright ni abrir el navegador.
 * Las capturas son emulación de viewport, no dispositivos físicos.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { auditarTransicion } from './lib/ganador-altura-transicion.mjs';
import { AYUDA, conMotor, leerOpciones, motorEfectivo, motorEnPagina } from './lib/ganador-altura-opciones.mjs';
import { LIMITE_MS, crearEsperas, progresoEnPagina, sondeo } from './lib/ganador-altura-esperas.mjs';
const opciones = leerOpciones(process.argv.slice(2));
if (opciones.ayuda) {
  console.log(AYUDA);
  process.exit(0);
}
const { base, out, juegos, vistas, fase, comprobar, relator, nombres, lang, movimiento, dispositivo, motor } = opciones;
const { webkit, devices } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');

await mkdir(out, { recursive: true });
const browser = await webkit.launch({ headless: true, timeout: 10000 });
const resultados = [];
try {
  for (const juego of juegos) for (const vista of vistas) {
    const [width, height] = vista.split('x').map(Number);
    // Verification opens a second public page in the same isolated session;
    // browser.newPage() creates an owned one-page context and rejects that.
    const context = await browser.newContext({ ...(dispositivo === 'iphone13' ? devices['iPhone 13'] : {}),
      viewport: { width, height }, locale: lang === 'en' ? 'en-US' : 'es-BO',
      reducedMotion: movimiento === 'reduce' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    const errores = [], esperas = crearEsperas(), motores = [];
    page.on('pageerror', e => errores.push(String(e)));
    try {
      if (comprobar) {
        const r = await auditarTransicion(page, { base, out, juego, vista, relator, nombres, lang, movimiento, motor });
        r.emulacion = { dispositivo, lang, navegador: 'WebKit',
          tipo: dispositivo === 'viewport' ? 'viewport responsive, no dispositivo Android' : 'descriptor iPhone 13, no teléfono físico',
          ...await page.evaluate(() => ({ userAgent: navigator.userAgent, dpr: devicePixelRatio, hasTouch: navigator.maxTouchPoints > 0 })) };
        resultados.push({ ...r, errores }); console.log(JSON.stringify({ ...r, errores }));
        continue;
      }
      if (fase === 'estadio') {
        await page.addInitScript(() => {
          let t = 0, id = 0;
          const pendientes = new Map();
          window.__PIXI_APP_INIT__ = app => { window.__app = app; };
          window.requestAnimationFrame = cb => { pendientes.set(++id, cb); return id; };
          window.cancelAnimationFrame = i => pendientes.delete(i);
          performance.now = () => t;
          window.__pasar = n => {
            for (let i = 0; i < n; i++) {
              const lote = [...pendientes.values()]; pendientes.clear(); t += 1000 / 64;
              for (const cb of lote) cb(t);
            }
          };
        });
        await page.goto(`${base}/?pose=${juego}&motor=pixi&pace=rapido&auditar=camara`);
        // El RAF está detenido por el auditor: también detenía el polling RAF
        // predeterminado de Playwright. Bombear desde un polling de tiempo real
        // permite completar el arranque antes de avanzar hasta el cartel.
        await page.waitForFunction(() => {
          window.__pasar(1);
          return !!window.__app?.stage && document.querySelector('#stadium').style.display === 'block';
        }, undefined, { timeout: 20000, polling: 50 });
        let listo = false;
        for (let i = 0; i < 360 && !listo; i++) {
          listo = await page.evaluate(() => { window.__pasar(16); return !!document.querySelector('#pixi-canvas')?.dataset.cartel; });
        }
        if (!listo) throw new Error('No apareció el cartel en 90 s virtuales');
        await page.evaluate(() => window.__pasar(64));
      } else {
        // El mismo desbloqueo del modo libre de audit-flujo; nunca conecta una cuenta.
        // Todos los nombres son largos: no se fuerza a quién elige el protocolo.
        if (fase === 'estadio-lista') await page.addInitScript(() => {
          window.__PIXI_APP_INIT__ = app => { window.__app = app; };
        });
        await page.goto(conMotor(`${base}/?lead=3&pace=rapido&grande=0&auditar=camara#sortear`, motor));
        await page.waitForSelector('#ta');
        await page.locator('#ta').fill('María Fernanda Guadalupe Quispe Mamani Zu\nMaximiliano Alexander Constantino Rosario\nAna María de los Ángeles Condori Flores\nCarlos Alberto Gutiérrez Fernández\nLucía Alejandra Mendoza Vargas\nRodrigo Sebastián Flores Mamani');
        await page.evaluate(j => {
          document.querySelector('#sec-participants .body').classList.remove('locked');
          document.querySelector('#btn-freeze').removeAttribute('aria-disabled');
          document.querySelector('#gate').style.display = 'none';
          document.querySelector(`#g-${j}`).click();
          document.querySelector('#btn-freeze').click();
        }, juego);
        await page.waitForFunction(() => !document.querySelector('#btn-draw').disabled, undefined, { timeout: 20000 });
        const lanzar = page.locator('#btn-draw');
        await lanzar.waitFor({ state: 'visible', timeout: 20000 });
        // El pulso del CTA no termina: como audit-flujo, clic en el botón real,
        // después de comprobar visibilidad y habilitación, sin exigir estabilidad.
        await lanzar.evaluate(boton => {
          if (boton.disabled) throw new Error('Lanzar el sorteo no está habilitado');
          boton.click();
        });
        const pagina = nombre => () => page.evaluate(progresoEnPagina, nombre);
        await esperas.esperar('estadio visible', LIMITE_MS,
          ms => page.waitForSelector('#stadium', { state: 'visible', timeout: ms }), pagina('estadio visible'));
        motores.push((await pagina('estadio visible')().catch(() => null))?.motor ?? null);
        if (fase === 'estadio-lista') {
          await esperas.esperar('cartel', LIMITE_MS, ms => page.waitForFunction(
            sondeo('cartel', () => !!document.querySelector('#pixi-canvas')?.dataset.cartel),
            undefined, { timeout: ms, polling: 100 }), pagina('cartel'));
          motores.push((await pagina('cartel')().catch(() => null))?.motor ?? null);
        } else {
          await page.evaluate(() => document.querySelector('#st-skip').click());
          await page.waitForSelector('#winner-box', { state: 'visible', timeout: 15000 });
          await page.waitForTimeout(2500);
        }
      }
      const medidas = await page.evaluate(() => {
        const box = e => {
          if (!e || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') return null;
          const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
        };
        const cv = document.querySelector('#pixi-canvas');
        let render = null;
        if (cv) {
          const mini = document.createElement('canvas'); mini.width = 32; mini.height = 18;
          const g = mini.getContext('2d'); g.drawImage(cv, 0, 0, 32, 18);
          const d = g.getImageData(0, 0, 32, 18).data;
          render = { webgl: !!(cv.getContext('webgl2') || cv.getContext('webgl')), colores: new Set(Array.from({ length: d.length / 4 }, (_, i) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`)).size };
        }
        const textos = [];
        const visitar = (n, capa) => {
          if (!n.visible || !n.renderable || n.worldAlpha < .5) return;
          if (typeof n.text === 'string') { const b = n.getBounds(); textos.push({ capa, texto: n.text, caja: { x: b.x, y: b.y, w: b.width, h: b.height } }); }
          for (const h of n.children || []) visitar(h, capa);
        };
        window.__app?.stage.children.forEach((n, i) => visitar(n, i));
        const aud = window.__tinkazo;
        // Las barras del HUD son canvas, no la tarjeta DOM ni el relator.
        const hud = (window.__app?.stage.children[2]?.children || [])
          .filter(n => n.visible && n.renderable && n.worldAlpha >= .5)
          .map(n => { const b = n.getBounds(); return { tipo: n.constructor.name, caja: { x: b.x, y: b.y, w: b.width, h: b.height } }; });
        return { render, cartel: aud?.cartel?.(), ganador: aud?.ganador?.(), cuerpo: aud?.cuerpoGanador?.(), textos, hud,
          cabecera: box(document.querySelector('.st-top')), relator: box(document.querySelector('#commentary')),
          tarjeta: box(document.querySelector('.winner-card')), nombre: box(document.querySelector('.winner-name')),
          barra: box(document.querySelector('#siguiente.on')), accion: box(document.querySelector('#btn-again-sin')),
          saltar: box(document.querySelector('#st-skip')), scroll: scrollY };
      });
      motores.push(await page.evaluate(motorEnPagina));
      await page.screenshot({ path: join(out, `${fase}-${juego}-${vista}.png`) });
      const r = { juego, vista, fase, medidas, errores, esperas: esperas.registros,
        motor: { pedido: fase === 'estadio' ? '2d' : motor, vistos: motores, efectivo: motorEfectivo(motores) } };
      resultados.push(r); console.log(JSON.stringify(r));
    } catch (error) {
      motores.push(await page.evaluate(motorEnPagina).catch(() => null));
      const diagnostico = await page.evaluate(() => {
        const aud = window.__tinkazo, cv = document.querySelector('#pixi-canvas');
        return { tiempo: aud?.camara.tiempo, golpeEn: aud?.camara.golpeEn,
          foco: cv?.dataset.foco, cartel: cv?.dataset.cartel,
          estadio: document.querySelector('#stadium')?.style.display, canvas: !!cv };
      }).catch(e => ({ errorDiagnostico: String(e) }));
      await page.screenshot({ path: join(out, `${fase}-${juego}-${vista}-fallo.png`), timeout: 5000 })
        .catch(e => { diagnostico.errorCaptura = String(e); });
      const r = { juego, vista, fase, error: String(error), errores, diagnostico,
        esperas: error?.esperas ?? esperas.registros,
        motor: { pedido: fase === 'estadio' ? '2d' : motor, vistos: motores, efectivo: motorEfectivo(motores) } };
      await writeFile(join(out, `${fase}-${juego}-${vista}-fallo.json`), JSON.stringify(r, null, 2));
      resultados.push(r); console.error(JSON.stringify(r));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
await writeFile(join(out, 'medidas.json'), JSON.stringify(resultados, null, 2));
process.exitCode = resultados.some(r => r.error || r.errores.length || r.comprobaciones?.some(c => !c.ok) || (fase !== 'resultado' && r.movimiento !== 'reduce' && (!r.medidas.render?.webgl || r.medidas.render.colores < 2))) ? 1 : 0;
