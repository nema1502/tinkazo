/**
 * Telemetría de las esperas del auditor. El límite sigue en 40 s (no se sube): solo se anota cuándo empezó y terminó
 * cada espera, cuántas veces se sondeó en la página y qué cuadro y muestra había, para distinguir un juego lento
 * (los cuadros siguen avanzando) de una página colgada (no avanzan o no responde).
 */
export const LIMITE_MS = 40000;

/**
 * Expresión para `page.waitForFunction`: cuenta cada sondeo en `window.__esperas[nombre]` y devuelve el predicado.
 * `predicado` se serializa: no puede cerrar sobre variables del auditor.
 */
export function sondeo(nombre, predicado) {
  return `(() => { const e = (window.__esperas ??= {})[${JSON.stringify(nombre)}] ??= { sondeos: 0 };
    e.sondeos++; e.ultimoSondeo = performance.now(); e.primerSondeo ??= e.ultimoSondeo;
    return (${predicado})(); })()`;
}

/** Corre en la página, sin dependencias: reloj, último cuadro, última muestra, sondeos y motor visible. */
export function progresoEnPagina(nombre) {
  const a = window.__altura, e = window.__esperas?.[nombre];
  const visible = el => !!el && el.isConnected && el.getClientRects().length > 0
    && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const ultima = a?.ultima?.() ?? { muestras: null, ultimaMuestra: null };
  return { ahora: performance.now(), cuadro: a?.leerCuadro?.() ?? null, muestras: ultima.muestras, ultimaMuestra: ultima.ultimaMuestra,
    sondeos: e?.sondeos ?? null, primerSondeo: e?.primerSondeo ?? null, ultimoSondeo: e?.ultimoSondeo ?? null,
    motor: visible(document.getElementById('tres-canvas')) ? '3d' : visible(document.getElementById('pixi-canvas')) ? '2d' : null };
}

/**
 * `esperar(nombre, limiteMs, ejecutar, leerPagina)`: corre `ejecutar(limiteMs)` y anota inicio, fin y el progreso de la
 * página antes y después. Si la página no contesta en `lecturaMs`, lo anota (`sinRespuesta`) en vez de colgarse.
 * Un error se relanza con `error.esperas` (todas las esperas de la corrida) para el JSON de fallo.
 */
export function crearEsperas({ ahora = () => Date.now(), lecturaMs = 2000 } = {}) {
  const registros = [];
  const leer = async leerPagina => {
    let reloj;
    const tope = new Promise(r => { reloj = setTimeout(() => r({ sinRespuesta: true, esperaMs: lecturaMs }), lecturaMs); });
    try {
      return await Promise.race([Promise.resolve().then(leerPagina).catch(e => ({ errorLectura: String(e) })), tope]);
    } finally { clearTimeout(reloj); }
  };
  return {
    registros,
    async esperar(nombre, limiteMs, ejecutar, leerPagina) {
      const r = { nombre, limiteMs, inicio: ahora(), fin: null, duracionMs: null, ok: false, error: null,
        paginaInicio: await leer(leerPagina), paginaFin: null };
      registros.push(r);
      try {
        const valor = await ejecutar(limiteMs);
        r.ok = true;
        return valor;
      } catch (error) {
        r.error = String(error);
        try { error.esperas = registros; } catch { /* error primitivo: queda en el registro */ }
        throw error;
      } finally {
        r.fin = ahora(); r.duracionMs = r.fin - r.inicio;
        r.paginaFin = await leer(leerPagina);
      }
    },
  };
}
