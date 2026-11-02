/** Sin dependencias: la misma función corre en Vitest y después de cada render. */
export function comprobarMuestra(m) {
  const checks = [], eps = 1e-4;
  const add = (nombre, ok, extra = {}) => checks.push({ nombre, ok: !!ok, ...extra });
  const medible = b => !!b && [b.x, b.y, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0;
  const dentro = (b, r) => medible(b) && medible(r) && b.x >= r.x - eps && b.y >= r.y - eps
    && b.x + b.w <= r.x + r.w + eps && b.y + b.h <= r.y + r.h + eps;
  const horizontal = (b, r) => b.x < r.x + r.w && b.x + b.w > r.x;
  const viewport = { x: 0, y: 0, ...m.viewport };
  const cajas = [['cuerpo', m.cuerpo], ...(m.placaVisible ? [['cartel', m.cartel]] : []),
    ...m.nombres.map((n, i) => [`nombre ${i}`, n.caja])];
  add('relator medible', medible(m.relator));
  for (const [nombre, b] of cajas) {
    add(`${nombre} medible`, medible(b));
    add(`${nombre} entero en viewport`, dentro(b, viewport));
    if (medible(b) && medible(m.relator)) {
      const distancia = m.relator.y - b.y - b.h;
      add(`${nombre} separado del relator`, !horizontal(b, m.relator) || distancia >= 4 - eps, { distancia, minimo: 4, coinciden: horizontal(b, m.relator) });
    }
  }
  if (m.placaVisible && medible(m.cartel) && medible(m.cuerpo)) {
    const distancia = m.cuerpo.y - m.cartel.y - m.cartel.h;
    add('cuerpo separado del cartel', !horizontal(m.cuerpo, m.cartel) || distancia >= 4 - eps, { distancia, minimo: 4, coinciden: horizontal(m.cuerpo, m.cartel) });
  }
  add('nombre presente', m.nombres.length > 0);
  const normal = s => s.replace(/\s+/g, ' ').trim();
  m.nombres.forEach((n, i) => {
    add(`nombre ${i} completo`, !!normal(n.original) && normal(n.texto).includes(normal(n.original)));
    if (n.enCartel) add(`nombre ${i} contenido en su cartel`, dentro(n.caja, m.cartel));
    else if (m.placaVisible && medible(n.caja) && medible(m.cartel)) {
      const b = n.caja, r = m.cartel;
      const distancia = Math.max(b.y - r.y - r.h, r.y - b.y - b.h);
      add(`nombre ${i} separado del cartel`, !horizontal(b, r) || distancia >= 4 - eps, { distancia, minimo: 4, coinciden: horizontal(b, r) });
    }
  });
  // Misma regla y medio píxel de redondeo que seLee() en letra.ts; no cambia el margen geométrico.
  const originales = [...new Set(m.nombres.map(n => normal(n.original)))];
  add('nombre completo legible', Number.isFinite(m.minimoLetra) && m.minimoLetra > 0 && originales.length > 0
    && originales.every(original => m.nombres.some(n => normal(n.original) === original
      && normal(n.texto).includes(original) && Number.isFinite(n.letraCSS) && n.letraCSS >= m.minimoLetra - 0.5)),
    { minimo: m.minimoLetra, redondeo: 0.5 });
  add('controles accesibles', ['st-skip', 'st-sound'].every(id => m.controles.some(c => c.id === id && c.accesible)));
  if (m.fixture) add('frase exacta', m.frase === m.fixture);
  return checks;
}

export function comprobarSecuencia({ muestras: ms, fallos, ultimoCuadro }, reducido) {
  const checks = [{ nombre: 'errores del muestreador ausentes', ok: fallos.length === 0 }];
  if (reducido) return [...checks, { nombre: 'reducción sin renders omitidos', ok: ms.length === 0 && ultimoCuadro === 0 }];
  return [...checks,
    { nombre: 'cada render de transición muestreado', ok: ms.length > 2 && ms.at(-1).cuadro === ultimoCuadro
      && ms.every((m, i) => !i || m.cuadro === ms[i - 1].cuadro + 1) },
    { nombre: 'relojes finitos y crecientes', ok: ms.length > 0 && ms.every((m, i) => Number.isFinite(m.tiempo)
      && Number.isFinite(m.timestamp) && (!i || (m.timestamp > ms[i - 1].timestamp && m.tiempo >= ms[i - 1].tiempo))) },
    { nombre: 'entrada y sostén final cubiertos', ok: ms.some(m => m.placaVisible) && ms.at(-1)?.corona?.tiempoCartel >= 1.7 },
  ];
}

export function esNombreDelCartel(id, propietarios) { return propietarios.includes(id); }
export function comprobarAccesoPublico({ accesible, visible, proof, resultado, lista, pasos }) {
  return [
    { nombre: 'acción pública accesible', ok: !!accesible },
    { nombre: 'datos del comprobante sin sustitución', ok: proof.round === resultado.beacon.round
      && proof.signature === resultado.beacon.signature && JSON.stringify(proof.names) === JSON.stringify(resultado.names) },
    { nombre: 'lista y pasos públicos accesibles', ok: !!visible && !!pasos.trim() && lista.includes(resultado.names[resultado.winners[0]]) },
  ];
}

export const RELATOR_ORIGINAL = '¡EL TINKAZO ES PARA Rodrigo Sebastián Flores Mamani!';
export const PROVENIENCIA = {
  captura: '.evidence/arreglos-sorteos/red-cuerpo-hrE9yD/estadio-lista-teleferico-1024x560.png',
  medidas: '.evidence/arreglos-sorteos/red-cuerpo-hrE9yD/medidas.json',
  viewport: { w: 1024, h: 560 }, relator: { y: 421.09375, h: 112.90625 },
};

// Conserva la regla previa; además exige el margen existente ante la barra visible.
export function comprobarNombreFinal(final, barra) {
  const previo = final.nombre.trim() === final.esperado && final.sinRecorte && final.caja.w > 0 && final.caja.h > 0
    && final.caja.x >= 0 && final.caja.y >= 0 && final.caja.x + final.caja.w <= final.viewport.w
    && final.caja.y + final.caja.h <= final.viewport.h;
  if (!previo || !barra) return previo;
  if (![barra.x, barra.y, barra.w, barra.h].every(Number.isFinite) || barra.w <= 0 || barra.h <= 0) return false;
  const coincide = final.caja.x < barra.x + barra.w && final.caja.x + final.caja.w > barra.x;
  return !coincide || barra.y - final.caja.y - final.caja.h >= 4 - 1e-4;
}
