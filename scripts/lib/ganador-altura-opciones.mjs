import { resolve, sep } from 'node:path';
import { SELECTOR } from './juegos.mjs';

export const AYUDA = `Uso: node scripts/audit-ganador-altura.mjs [opciones]
  --base URL        Servidor propio (http://127.0.0.1:5185)
  --out DIR         Evidencia (.evidence/arreglos-sorteos/antes)
  --juegos LISTA    Juegos separados por comas (${SELECTOR.join(',')})
  --vistas LISTA    Viewports (1024x521,1024x560,1024x600,390x560)
  --fase FASE       estadio, estadio-lista o resultado (estadio)
                    estadio-lista: UI libre simulada con nombres largos;
                    espera el cartel real sin saltar el juego
  --motor M        2d|3d (2d): agrega motor=pixi o motor=3d a la página.
                    El motor efectivo (el canvas que se vio) queda en el JSON;
                    --fase estadio siempre usa motor=pixi.
  --comprobar       Cada render: cuerpo/cartel/nombre vs relator y viewport,
                    cuerpo/nombre vs cartel y un nombre completo legible;
                    solo cuentan el cartel, el chip puente y los chips con
                    nombre de quien gana (identidad, no primera palabra);
                    las inscripciones de los gajos son decorado.
                    mide letra CSS transformada y resultado sin oclusión por barra fija;
                    usa scroll normal y conserva el acceso a comprobante.
                    Acceso público: mensaje real de WhatsApp → verificar.html;
                    distingue modo libre/sin sello de un ancla oficial.
                    Requiere --fase estadio-lista y servidor Vite (fuentes).
  --relator MODO    original|natural (original): frase histórica exacta, solo
                    fixture de narración; no sustituye al ganador del protocolo.
  --nombres MODO    largos|cortos (largos)
  --lang IDIOMA     es|en (es); el fixture original exige es.
  --movimiento M   normal|reduce (normal); reduce comprueba resultado sin show.
  --dispositivo D  viewport|iphone13 (viewport); descriptor iPhone 13 con
                    viewport sobrescrito; viewport no afirma ser Android.
  --help            Mostrar ayuda sin abrir navegador
Esperas de 40 s: el JSON guarda inicio/fin, sondeos y el último cuadro visto.
Entorno: PLAYWRIGHT_PATH indica el módulo Playwright; por defecto 'playwright'.
Capturas: emulación de viewport, no dispositivos físicos.`;

/** Lee y valida las opciones del auditor. No importa Playwright ni toca el disco. */
export function leerOpciones(args) {
  if (args.includes('--help')) return { ayuda: true };
  const opt = (k, d) => args.includes(k) ? args[args.indexOf(k) + 1] : d;
  const base = opt('--base', 'http://127.0.0.1:5185');
  const out = opt('--out', '.evidence/arreglos-sorteos/antes');
  const juegos = opt('--juegos', SELECTOR.join(',')).split(',');
  const vistas = opt('--vistas', '1024x521,1024x560,1024x600,390x560').split(',');
  const fase = opt('--fase', 'estadio');
  const comprobar = args.includes('--comprobar');
  if (comprobar && fase !== 'estadio-lista') throw new Error('--comprobar requiere --fase estadio-lista');
  const relator = opt('--relator', 'original'), nombres = opt('--nombres', 'largos');
  const lang = opt('--lang', 'es'), movimiento = opt('--movimiento', 'normal'), dispositivo = opt('--dispositivo', 'viewport');
  const motor = opt('--motor', '2d');
  for (const [k, v, permitidos] of [['--relator', relator, ['original', 'natural']], ['--nombres', nombres, ['largos', 'cortos']],
    ['--lang', lang, ['es', 'en']], ['--movimiento', movimiento, ['normal', 'reduce']], ['--dispositivo', dispositivo, ['viewport', 'iphone13']],
    ['--motor', motor, ['2d', '3d']]])
    if (!permitidos.includes(v)) throw new Error(`${k}: valor no válido ${v}`);
  if (motor === '3d' && fase === 'estadio') throw new Error('--fase estadio fuerza motor=pixi; --motor 3d requiere estadio-lista o resultado');
  if (comprobar && relator === 'original' && lang !== 'es') throw new Error('--relator original requiere --lang es');
  if (!comprobar && ['--relator', '--nombres', '--lang', '--movimiento', '--dispositivo'].some(k => args.includes(k)))
    throw new Error('Los controles de matriz requieren --comprobar');
  if (!vistas.every(v => /^[1-9]\d*x[1-9]\d*$/.test(v)) || !juegos.every(j => SELECTOR.includes(j))) throw new Error('Juego o viewport no válido');
  const raiz = resolve('.evidence/arreglos-sorteos');
  if (resolve(out) !== raiz && !resolve(out).startsWith(raiz + sep)) throw new Error('--out debe estar dentro de .evidence/arreglos-sorteos');
  return { ayuda: false, base, out, juegos, vistas, fase, comprobar, relator, nombres, lang, movimiento, dispositivo, motor };
}

/** `?motor=` de la página: `pixi` fuerza el 2D (engine.ts usa3D) y `3d` lo pide. Conserva el resto y el hash. */
export function conMotor(url, motor) {
  const u = new URL(url);
  u.searchParams.set('motor', motor === '3d' ? '3d' : 'pixi');
  return u.toString();
}

/** Corre en la página, sin dependencias: qué canvas dibuja el juego ahora. El 3D va primero (Pixi puede seguir de HUD). */
export function motorEnPagina() {
  const visible = e => !!e && e.isConnected && e.getClientRects().length > 0
    && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  if (visible(document.getElementById('tres-canvas'))) return '3d';
  if (visible(document.getElementById('pixi-canvas'))) return '2d';
  return null;
}

/** El motor de la corrida según lo que vio la página: `2d`, `3d`, `mixto` (cambió) o `sin-show` (nunca hubo canvas). */
export function motorEfectivo(vistos) {
  const s = new Set(vistos.filter(Boolean));
  return s.size === 0 ? 'sin-show' : s.size > 1 ? 'mixto' : [...s][0];
}
