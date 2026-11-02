import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { comprobarMuestra, comprobarSecuencia, esNombreDelCartel, comprobarAccesoPublico, RELATOR_ORIGINAL, PROVENIENCIA, comprobarNombreFinal } from './ganador-altura-comprobaciones.mjs';

// Primer sostén estable seleccionado, no último cuadro. Las muestras siguen hasta el cierre.
export function valorCapturaFinal(corona, _timestamp) {
  return corona?.placaVisible && corona.tiempoCartel >= 1.7 ? -1 : Infinity;
}

/** Se serializa con addInitScript. Solo observa; el fixture afecta únicamente al relator. */
function instalar(opciones, comprobar, delCartel, capturaFinal) {
  const muestras = [], fallos = [], peores = new Map();
  let resultadoInicial = null, ultimoCuadro = 0, render = null;
  const fixture = { solicitado: opciones.relator, texto: opciones.frase, aplicado: false };
  const rect = e => {
    if (!e || !e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return null;
    const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const accesible = id => {
    const e = document.getElementById(id), r = rect(e);
    const p = r && document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
    return { id, caja: r, accesible: !!r && r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0
      && r.x + r.w <= innerWidth && r.y + r.h <= innerHeight && !e.disabled && !!p && e.contains(p) };
  };
  const datos = () => ({ muestras, fallos, fixture, resultadoInicial, ultimoCuadro, render,
    seleccionFinal: 'Primer cartel visible con tiempoCartel >= 1.7; no es el último cuadro',
    peores: [...peores].map(([nombre, p]) => ({ nombre, muestra: p.muestra, imagen: p.canvas.toDataURL('image/png') })) });
  window.__altura = { datos, accesible, leerCuadro: () => ultimoCuadro, hayPlaca: () => muestras.some(m => m.placaVisible) };
  window.__auditarGanador = {
    relator(msg, heat) {
      const nombres = window.__tinkazo?.corona?.().nombres ?? [];
      if (opciones.relator === 'original' && heat === 1 && nombres.some(n => msg.includes(n))) {
        Object.assign(fixture, { aplicado: true, original: msg, timestamp: performance.now() });
        return opciones.frase;
      }
      return msg;
    },
    frame(cuadro, timestamp) {
      ultimoCuadro = cuadro;
      const inicioObservador = performance.now();
      try {
        const aud = window.__tinkazo, estado = aud?.estadoGanador?.();
        if (!estado?.activa) return;
        const cv = document.getElementById('pixi-canvas'), css = rect(cv), app = aud.aplicacion;
        const screen = app.screen, corona = aud.corona?.(), estilo = getComputedStyle(cv);
        const cssCompatible = estilo.transform === 'none' && ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
          'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth'].every(k => parseFloat(estilo[k]) === 0);
        if (!render && cv) {
          const mini = document.createElement('canvas'); mini.width = 32; mini.height = 18;
          const g = mini.getContext('2d'); g.drawImage(cv, 0, 0, 32, 18);
          const d = g.getImageData(0, 0, 32, 18).data;
          render = { webgl: !!(cv.getContext('webgl2') || cv.getContext('webgl')),
            colores: new Set(Array.from({ length: d.length / 4 }, (_, i) => `${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]}`)).size };
        }
        if (!css || !screen?.width || !screen.height) throw new Error('Canvas/screen no medibles');
        // getBounds usa píxeles lógicos Pixi, no el backing store multiplicado por DPR.
        const cliente = b => b && ({ x: css.x + b.x * css.w / screen.width, y: css.y + b.y * css.h / screen.height,
          w: b.w * css.w / screen.width, h: b.h * css.h / screen.height });
        const tipografia = n => {
          const m = n.getGlobalTransform(), letraLocal = Number(n.style.fontSize);
          return { letraLocal, ejeY: { x: m.c, y: m.d },
            letraCSS: letraLocal * Math.hypot(m.c * css.w / screen.width, m.d * css.h / screen.height) };
        };
        const identidades = aud.nombres?.() ?? [], propietarios = identidades.map(n => n.id);
        const nombres = identidades.filter(n => n.visible)
          .map(n => ({ ...n, caja: cliente(n.caja), enCartel: true }));
        const esperados = corona?.nombres ?? [];
        const visitar = n => {
          if (!n.visible || !n.renderable || n.getGlobalAlpha() <= 0) return;
          if (typeof n.text === 'string') {
            const propio = nombres.find(t => t.id === n.uid);
            if (propio) Object.assign(propio, tipografia(n));
          }
          if (typeof n.text === 'string' && !delCartel(n.uid, propietarios)) for (const original of esperados) {
            if (!n.text.includes(original.split(' ')[0])) continue;
            const b = n.getBounds(), caja = cliente({ x: b.x, y: b.y, w: b.width, h: b.height });
            if (!nombres.some(t => t.texto === n.text && Math.abs(t.caja.x - caja.x) < .01 && Math.abs(t.caja.y - caja.y) < .01))
              nombres.push({ original, texto: n.text, caja, enCartel: false, ...tipografia(n) });
          }
          for (const h of n.children ?? []) visitar(h);
        };
        visitar(app.stage);
        const resultado = window.__altura.leerResultado();
        resultadoInicial ??= JSON.parse(JSON.stringify(resultado));
        const m = { cuadro, timestamp, lecturaPostRender: performance.now(), encuadre: aud.encuadreGanador ?? null,
          tiempo: estado.tiempo, tiempoCamara: aud.camara.tiempo, estado,
          corona, placaVisible: !!corona?.placaVisible, cuerpo: cliente(aud.cuerpoGanador?.()),
          cartel: cliente(aud.superficieCartel?.()), nombres, minimoLetra: window.__altura.letraMinima(),
          relator: rect(document.getElementById('commentary')),
          frase: document.getElementById('commentary')?.textContent,
          fixture: opciones.relator === 'original' && (fixture.aplicado || corona?.placaVisible) ? fixture.texto : null, viewport: { w: innerWidth, h: innerHeight },
          canvas: { css, cssCompatible, transform: estilo.transform, screen: { w: screen.width, h: screen.height }, backing: { w: cv.width, h: cv.height }, dpr: devicePixelRatio },
          controles: ['st-skip', 'st-sound'].map(accesible),
          resultadoIgual: JSON.stringify(resultado) === JSON.stringify(resultadoInicial),
          observador: { inicio: inicioObservador, copias: [] } };
        m.comprobaciones = comprobar(m);
        m.comprobaciones.push({ nombre: 'relator no mutado entre fixture, encuadre y observación',
          ok: !!m.encuadre && m.encuadre.frase === m.frase && m.encuadre.timestamp <= m.lecturaPostRender
            && (!fixture.aplicado || fixture.timestamp <= m.encuadre.timestamp) },
          { nombre: 'resultado sembrado invariante', ok: m.resultadoIgual },
          { nombre: 'mapeo CSS/Pixi sin bordes, padding ni transformación CSS no soportada', ok: cssCompatible });
        muestras.push(m);
        // Copia exacta del framebuffer de este render. No pausa ni repite la animación.
        // El PNG se codifica al terminar; cada copia conserva su propio cuadro/rects DOM.
        const distancias = m.comprobaciones.filter(c => c.coinciden && Number.isFinite(c.distancia));
        const candidatos = [['entrada', muestras.length === 1 ? -1 : 0],
          ['cartel', distancias.filter(c => c.nombre.includes('del cartel')).reduce((a, c) => Math.min(a, c.distancia), Infinity)],
          ['relator', distancias.filter(c => c.nombre.includes('del relator')).reduce((a, c) => Math.min(a, c.distancia), Infinity)],
          ['fallos', -m.comprobaciones.filter(c => !c.ok).length], ['final', capturaFinal(corona, timestamp)]];
        for (const [nombre, valor] of candidatos) {
          if (!Number.isFinite(valor) || (peores.has(nombre) && valor >= peores.get(nombre).valor)) continue;
          const inicio = performance.now();
          const canvas = peores.get(nombre)?.canvas ?? document.createElement('canvas');
          canvas.width = cv.width; canvas.height = cv.height;
          canvas.getContext('2d').drawImage(cv, 0, 0);
          const fin = performance.now();
          m.observador.copias.push({ nombre, w: cv.width, h: cv.height, inicio, fin, duracionSincronaMs: fin - inicio });
          peores.set(nombre, { valor, muestra: m, canvas });
        }
        m.observador.fin = performance.now();
        m.observador.duracionSincronaMs = m.observador.fin - inicioObservador;
      } catch (e) { fallos.push({ cuadro, timestamp, error: String(e) }); }
    },
  };
}

const LARGOS = 'María Fernanda Guadalupe Quispe Mamani Zu\nMaximiliano Alexander Constantino Rosario\nAna María de los Ángeles Condori Flores\nCarlos Alberto Gutiérrez Fernández\nLucía Alejandra Mendoza Vargas\nRodrigo Sebastián Flores Mamani';

// La barra puede aparecer tras el scroll o estar terminando su salida. Solo DOM real,
// sin avanzar relojes ni esconder controles para aprobar la captura.
function interfazResultadoEstable() {
  const barra = document.getElementById('siguiente');
  if (barra?.classList.contains('on')) return getComputedStyle(barra).visibility === 'visible' && getComputedStyle(barra).transform === 'none';
  if (barra && getComputedStyle(barra).visibility !== 'hidden') return false;
  const texto = document.getElementById('sig-btn')?.textContent.trim();
  const cab = document.querySelector('header');
  const arriba = cab && getComputedStyle(cab).position === 'sticky' ? Math.ceil(cab.getBoundingClientRect().height) : 0;
  return ['btn-again-sin', 'btn-proof', 'ens-mio'].some(id => {
    const boton = document.getElementById(id);
    if (!boton || boton.textContent.trim() !== texto || getComputedStyle(boton).visibility !== 'visible') return false;
    const b = boton.getBoundingClientRect();
    const w = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0));
    const h = Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, arriba));
    // 0.98 es la elegibilidad existente de siguiente.ts para esconder su barra,
    // NO una tolerancia del nombre: su predicado conserva viewport estricto y4px/1e-4.
    return b.width > 0 && b.height > 0 && w * h / (b.width * b.height) >= 0.98;
  });
}

export async function auditarTransicion(page, { base, out, juego, vista, relator, nombres, lang, movimiento }) {
  const prefijo = `transicion-${juego}-${vista}-${lang}-${movimiento}-${nombres}-${relator}`;
  await page.addInitScript({ content: `(${instalar})(${JSON.stringify({ relator, frase: RELATOR_ORIGINAL })}, ${comprobarMuestra}, ${esNombreDelCartel}, ${valorCapturaFinal});` });
  let traza;
  const capturas = [];
  const capturar = async etapa => {
    const antes = await page.evaluate(() => ({ timestamp: performance.now(), cuadro: window.__altura.leerCuadro() }));
    const archivo = `${prefijo}-${etapa}.png`;
    await page.screenshot({ path: join(out, archivo) });
    const despues = await page.evaluate(() => ({ timestamp: performance.now(), cuadro: window.__altura.leerCuadro() }));
    capturas.push({ archivo, antes, despues });
  };
  try {
    await page.goto(`${base}/?lead=3&pace=rapido&grande=0&auditar=camara&lang=${lang}#sortear`);
    // Lectura del estado de la UI real, solo en el servidor Vite de auditoría.
    // No se reemplazan beacon, selección, nombres finales, sello ni comprobante.
    await page.evaluate(async () => {
      const { app } = await import('/src/state.ts');
      const { letraMinima, unidadDePantalla } = await import('/src/games/pixi/letra.ts');
      window.__altura.letraMinima = () => letraMinima(unidadDePantalla(innerWidth, innerHeight));
      window.__altura.leerResultado = () => ({ winners: app.drawn?.winners, beacon: app.drawn?.beacon,
        names: app.frozen?.names, listHash: app.frozen?.listHash, round: app.frozen?.round });
    });
    await page.locator('#ta').fill(nombres === 'largos' ? LARGOS : 'María\nMax\nAna\nCarlos\nLucía\nRodrigo');
    await page.evaluate(j => {
      document.querySelector('#sec-participants .body').classList.remove('locked');
      document.querySelector('#btn-freeze').removeAttribute('aria-disabled');
      document.querySelector('#gate').style.display = 'none';
      document.querySelector(`#g-${j}`).click(); document.querySelector('#btn-freeze').click();
    }, juego);
    await page.waitForFunction(() => !document.querySelector('#btn-draw').disabled, undefined, { timeout: 20000 });
    await page.locator('#btn-draw').evaluate(b => { if (b.disabled) throw new Error('Lanzar no habilitado'); b.click(); });
    if (movimiento !== 'reduce') {
      await page.waitForSelector('#stadium', { state: 'visible', timeout: 40000 });
      // Interacción real de teclado: la regla existente mantiene accesibles los
      // controles con foco. No se cambian clases ni se pulsa Sonido/Saltar.
      await page.locator('#st-sound').focus();
      await page.waitForFunction(() => window.__altura.hayPlaca(), undefined, { timeout: 40000, polling: 100 });
      await capturar('entrada-pagina');
      await page.waitForSelector('#stadium', { state: 'hidden', timeout: 40000 });
    }
    await page.waitForSelector('.winner-name', { state: 'visible', timeout: 40000 });
    // El resultado es una página desplazable: ubicamos el nombre mediante scroll
    // normal antes de medirlo, sin modificar estilos, contenido ni predicados.
    await page.locator('.winner-name').scrollIntoViewIfNeeded();
    await page.waitForFunction(interfazResultadoEstable, undefined, { timeout: 40000, polling: 100 });
    const ubicacionResultado = await page.evaluate(() => {
      const n = document.querySelector('.winner-name').getBoundingClientRect();
      const barra = document.querySelector('#siguiente.on')?.getBoundingClientRect();
      // WebKit trunca scrolls fraccionarios: ceil conserva los cuatro píxeles.
      const desplazamiento = barra ? Math.ceil(Math.max(0, n.bottom + 4 - barra.top)) : 0;
      const antes = scrollY;
      if (desplazamiento) scrollBy({ top: desplazamiento, behavior: 'instant' });
      return { desplazamiento, antes, despues: scrollY };
    });
    await page.waitForFunction(interfazResultadoEstable, undefined, { timeout: 40000, polling: 100 });
    await capturar('resultado');
    traza = await page.evaluate(() => window.__altura.datos());
    const final = await page.evaluate(async () => {
      const { select } = await import('/src/protocol/select.ts');
      const { listHash } = await import('/src/protocol/canonical.ts');
      const { hexToBytes } = await import('/src/protocol/quicknet.ts');
      const r = window.__altura.leerResultado();
      const elegidos = select(hexToBytes(r.beacon.randomness), listHash(r.names), r.names.length, r.winners.length);
      const nombre = document.querySelector('.winner-name'), b = nombre.getBoundingClientRect();
      const barra = document.querySelector('#siguiente.on')?.getBoundingClientRect();
      return { resultado: r, elegidos, nombre: nombre.textContent, esperado: r.names[r.winners[0]],
        caja: { x: b.x, y: b.y, w: b.width, h: b.height },
        barra: barra ? { x: barra.x, y: barra.y, w: barra.width, h: barra.height } : null,
        sinRecorte: nombre.scrollWidth <= nombre.clientWidth && nombre.scrollHeight <= nombre.clientHeight,
        viewport: { w: innerWidth, h: innerHeight },
        movimiento: matchMedia('(prefers-reduced-motion: reduce)').matches };
    });
    const comprobaciones = [
      { nombre: 'selección normal del protocolo', ok: JSON.stringify(final.elegidos) === JSON.stringify(final.resultado.winners) },
      { nombre: 'nombre final completo sin recorte', ok: comprobarNombreFinal(final, final.barra) },
      { nombre: 'preferencia de movimiento respetada', ok: final.movimiento === (movimiento === 'reduce') },
      ...comprobarSecuencia(traza, movimiento === 'reduce'),
    ];
    const ms = traza.muestras;
    if (movimiento !== 'reduce') {
      comprobaciones.push({ nombre: 'resultado invariante al finalizar', ok: JSON.stringify(traza.resultadoInicial) === JSON.stringify(final.resultado) });
      if (relator === 'original') {
        comprobaciones.push({ nombre: 'fixture original aplicado sin azar', ok: traza.fixture.aplicado });
        if (juego === 'teleferico' && vista === '1024x560') {
          const h = ms.findLast(m => m.timestamp - traza.fixture.timestamp > 350);
          comprobaciones.push({ nombre: 'rect original del relator reproducido', ok: !!h && h.frase === RELATOR_ORIGINAL
            && Math.abs(h.relator.y - PROVENIENCIA.relator.y) < .01 && Math.abs(h.relator.h - PROVENIENCIA.relator.h) < .01,
          esperado: PROVENIENCIA.relator, actual: h?.relator });
        }
      }
    }
    // .solo-verificar está oculto globalmente por diseño: el público recibe el
    // enlace en el mensaje de WhatsApp y audita en verificar.html, no en esos nodos.
    const accesos = [];
    for (const id of ['btn-proof', 'btn-whatsapp']) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      accesos.push(await page.evaluate(id => window.__altura.accesible(id), id));
    }
    await page.waitForFunction(() => document.querySelector('#btn-whatsapp')?.getAttribute('href')?.includes('verificar.html'),
      undefined, { timeout: 20000, polling: 100 });
    const href = await page.locator('#btn-whatsapp').getAttribute('href');
    const mensaje = new URL(href).searchParams.get('text');
    const enlace = mensaje.match(/https?:\/\/[^\s]+/g)?.find(u => new URL(u).pathname === '/verificar.html');
    if (!enlace || new URL(enlace).origin !== new URL(base).origin) throw new Error('Enlace público de verificación ausente o ajeno al servidor propio');
    const proof = await page.evaluate(async hash => (await import('/src/protocol/proof.ts')).decodeProof(hash), new URL(enlace).hash);
    const consulta = await page.context().newPage();
    let informacion;
    try {
      await consulta.goto(enlace, { timeout: 20000 });
      await consulta.waitForFunction(() => document.querySelector('#v-steps')?.textContent.trim()
        && document.querySelector('#v-names')?.textContent.trim(), undefined, { timeout: 20000, polling: 100 });
      await consulta.locator('#v-buscar').scrollIntoViewIfNeeded();
      informacion = { lista: await consulta.locator('#v-names').innerText(), pasos: await consulta.locator('#v-steps').innerText(),
        visible: await consulta.locator('#v-names').isVisible() && await consulta.locator('#v-steps').isVisible(),
        veredicto: await consulta.locator('#verdict-title').innerText(),
        modo: proof.net && proof.contract && proof.id ? 'anclado' : proof.sinSello ? 'sin-sello' : 'libre-sin-ancla' };
      await consulta.screenshot({ path: join(out, `${prefijo}-verificacion-publica.png`) });
    } finally { await consulta.close(); }
    comprobaciones.push(...comprobarAccesoPublico({ ...informacion, accesible: accesos.every(a => a.accesible), proof, resultado: final.resultado }));
    const prueba = { enlace, mensaje, proof, ...informacion }, ronda = final.resultado.beacon.round;
    await capturar('acceso-publico');
    const minimos = {};
    for (const m of ms) for (const c of m.comprobaciones) if (c.coinciden && Number.isFinite(c.distancia)
      && (!minimos[c.nombre] || c.distancia < minimos[c.nombre].distancia))
      minimos[c.nombre] = { distancia: c.distancia, cuadro: m.cuadro, tiempo: m.tiempo, timestamp: m.timestamp };
    return { juego, vista, fase: 'estadio-lista', final, ubicacionResultado, accesos, prueba, ronda, proveniencia: PROVENIENCIA, minimos,
      comprobaciones: [...comprobaciones, ...ms.flatMap(m => m.comprobaciones.filter(c => !c.ok).map(c => ({ ...c, cuadro: m.cuadro, tiempo: m.tiempo })))],
      medidas: { render: traza.render }, movimiento, controlesProbe: 'foco de teclado en st-sound',
      muestras: ms.length, fixture: traza.fixture, evidencia: `${prefijo}.json` };
  } finally {
    traza = await page.evaluate(() => window.__altura?.datos()).catch(e => ({ error: String(e) }));
    if (traza) {
      traza.capturasPagina = capturas;
      traza.configuracion = { juego, vista, relator, nombres, lang, movimiento };
    }
    if (traza?.peores) {
      for (const p of traza.peores) {
        await writeFile(join(out, `${prefijo}-peor-${p.nombre}-canvas.png`), Buffer.from(p.imagen.split(',')[1], 'base64'));
        delete p.imagen;
      }
    }
    await writeFile(join(out, `${prefijo}.json`), JSON.stringify(traza, null, 2));
  }
}
