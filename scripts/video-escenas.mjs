#!/usr/bin/env node
/**
 * El video corregido de la portada (issue #122), desde cero y determinista.
 *
 * Escenas armadas con el lenguaje visual de los juegos, según las reglas visuales de la casa: el atardecer de `carrera.ts`
 (`pintarCielo`) por franjas, la luna crema arriba a la derecha, montañas a
 * dos capas, estrellas que titilan con sembrado `tk.rng` (nada de
 * `Math.random`), tarjetas con borde y sombra dura, y la llamita en magenta
 * con mantita teal. Cada cuadro es una función pura del tiempo `t`: la misma
 * escena sale siempre igual, cuadro por cuadro.
 *
 * Qué corrige de la versión anterior (el cuerpo del issue #122):
 *   - sin capturas del juego: nada de "SOUND: ON" ni "Count with me!";
 *   - sin Bolillas 3D presentado como juego nuevo;
 *   - sin tecnicismos en la portada (ni "blockchain", ni 0xb41ec0, ni mod 28):
 *     lo técnico vive en sus páginas;
 *   - ningún texto sobre la luna (la zona superior derecha queda vedada) y
 *     todo el texto con contraste alto;
 *   - sin punto medio como separador;
 *   - sin pista de audio (por defecto del issue: ningún audio sin escucharlo).
 *
 * Camino de producción:
 *   1. arma la página de escenas en una carpeta temporal del sistema (fuera
 *      del repo), con las posiciones ya sembradas al armar el HTML;
 *   2. la abre en el Chromium de Playwright con el wrapper `--no-sandbox`
 *      (`CHROME=/tmp/chrome-wrapper.sh`);
 *   3. por cuadro: fija el tiempo con `__dibuja(t)` y saca la foto con
 *      `Page.captureScreenshot`;
 *   4. ffmpeg (v6.1.1) junta los cuadros en el mp4: H.264 yuv420p, la misma
 *      familia de códec que el mp4 que reemplaza, sin pista de audio; y
 *      saca el póster JPEG;
 *   5. escribe las pistas de subtítulos `.vtt` en español e inglés con los
 *      mismos tiempos de las escenas: al `<video>` de la portada van las dos
 *      pistas y así el inglés va de a caballo de la pista en español.
 *
 * La carpeta de cuadros se borra al terminar, salvo con `--deja-cuadros`.
 *
 * Uso:
 *   CHROME=/tmp/chrome-wrapper.sh CDP_PORT=9731 node scripts/video-escenas.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { launch, sleep } from "./lib/browser.mjs";

const FFMPEG = "/usr/bin/ffmpeg";
const FPS = 30;
const ANCHO = 1280;
const ALTO = 720;
const fuera = resolve("public", "videos");
const dejaCuadros = process.argv.includes("--deja-cuadros");

/**
 * Las escenas, con sus segundos: 44 s en total. `desde` lo completa este
 * script (segundos globales) y con esa misma tabla se arman los tiempos del
 * .vtt y el confVideo (la duración real).
 */
const ESCENAS = [
  { id: "intro", dur: 4 },
  { id: "lista", dur: 6 },
  { id: "numero", dur: 7 },
  { id: "cae", dur: 6 },
  { id: "compruebo", dur: 7 },
  { id: "trampa", dur: 4 },
  { id: "juegos", dur: 5 },
  { id: "cierre", dur: 5 },
];
let acumulado = 0;
for (const escena of ESCENAS) {
  escena.desde = acumulado;
  acumulado += escena.dur;
}
const SEGUNDOS = acumulado;
const CUADROS = Math.round(SEGUNDOS * FPS);

/** El prng sembrado: misma semilla, misma secuencia, siempre. */
const SEMILLA = 20261120;
function sembrado() {
  let s = SEMILLA >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * La narración de los subtítulos por escena: [desde, hasta, es, en] con los
 * segundos relativos al arranque de la escena. La pista en inglés se declara
 * como segunda pista del mismo `<video>`.
 */
const NARRACION = {
  intro: [
    [0.3, 4, "La llamita te muestra cómo se hace un sorteo que nadie puede amañar.", "The little llama shows you how a draw that nobody can rig is done."],
  ],
  lista: [
    [0.3, 3, "Antes de sortear, la lista de nombres se cierra.", "Before the draw, the list of names is sealed."],
    [3, 6, "Queda a la vista de todos, y nadie la puede borrar ni cambiar.", "It stays in plain view, and nobody can erase or change it."],
  ],
  numero: [
    [0.3, 3, "El ganador no lo elige nadie: sale de un número público.", "Nobody picks the winner: it comes out of a public number."],
    [3, 5, "Lo publica un campanario de números, a la vista de todos.", "It is published by a tower of numbers, in plain sight."],
    [5, 7, "Ni Tinkazo ni quien organiza pueden elegir ese número.", "Neither Tinkazo nor the organizer can pick that number."],
  ],
  cae: [
    [0.3, 3, "El número público cae sobre la lista y señala a alguien.", "The public number lands on the list and points at someone."],
    [3, 6, "Toca a Sofía, la tercera de la lista con sello.", "It lands on Sofía, third on the sealed list."],
  ],
  compruebo: [
    [0.3, 3.5, "¿Me creés? Desde el comprobante, cualquiera lo vuelve a hacer.", "Don't take my word for it: from the receipt, anyone can redo it."],
    [3.5, 7, "En el celular de quien organizó, o en otro: el ganador es el mismo.", "On the organizer's phone, or any other phone: the winner is the same."],
  ],
  trampa: [
    [0.3, 4, "Si alguien cambia un nombre, la lista no cuadra: trampa detectada.", "If someone changes a name, the list no longer matches: cheating gets caught."],
  ],
  juegos: [
    [0.3, 5, "Y de paso: hay diez juegos, y todos sortean con este mismo método.", "And by the way: there are ten games, and all draw with this same method."],
  ],
  cierre: [
    [0.3, 3, "No hace falta creerme: cada paso se puede comprobar.", "You don't have to trust me: every step can be checked."],
    [3, 5, "Tinkazo: sorteos justos para tu comunidad.", "Tinkazo: fair draws for your community."],
  ],
};

/** Montaña con picos alternados (unos altos, otros bajos), sembrada. */
function picosDeMontana(rng, saltos, minimo, rango) {
  const puntos = [];
  for (let i = 0; i <= saltos; i++) {
    const x = Math.round((ANCHO * i) / saltos);
    // El SVG mide ALTO: las picos pares altos, los impares bajos y variados.
    const base = i % 2 === 0 ? ALTO - 10 : minimo - rng() * rango;
    puntos.push([x, Math.round(base)]);
  }
  return puntos;
}

/** Publica el fondo (estrellas, confeti y picos) sembrado desde Node. */
export function fondo() {
  const rng = sembrado();
  const estrellas = [];
  for (let i = 0; i < 90; i++) {
    estrellas.push({
      x: Math.round(rng() * ANCHO),
      y: Math.round(rng() * 240), // solo las dos franjas de arriba
      f: Math.round(rng() * 628) / 100,
    });
  }
  const confeti = [];
  const colores = ["#ff5cb3", "#ff7a1a", "#ffc629", "#00a896", "#6c4ce0"];
  for (let i = 0; i < 46; i++) {
    confeti.push({
      x: Math.round(rng() * ANCHO),
      y0: Math.round(rng() * (ALTO + 60)) - 30,
      vel: 90 + Math.round(rng() * 70),
      giro: Math.round(rng() * 400 - 200),
      color: colores[i % colores.length],
    });
  }
  return {
    estrellas,
    confeti,
    atras: picosDeMontana(rng, 9, ALTO - 120, 60),
    adelante: picosDeMontana(rng, 9, ALTO - 150, 70),
  };
}

const TRAZO = 'fill="#ff5cb3" stroke="#191919" stroke-width="5.5" stroke-linejoin="round"';

/** La llamita dibujada de cuerpo entero (patas incluidas), como pide la marca. */
function llamitaSvg() {
  return `<svg class="llamita" width="128" height="160" viewBox="-10 -44 128 160" aria-hidden="true">
    <g class="patas g1">
      <rect x="14" y="70" width="9" height="36" rx="4" ${TRAZO}/>
      <rect x="66" y="70" width="9" height="36" rx="4" ${TRAZO}/>
    </g>
    <g class="patas g2">
      <rect x="34" y="70" width="9" height="30" rx="4" ${TRAZO}/>
      <rect x="86" y="70" width="9" height="30" rx="4" ${TRAZO}/>
    </g>
    <rect x="6" y="34" width="96" height="44" rx="20" ${TRAZO}/>
    <rect x="74" y="2" width="18" height="44" rx="9" ${TRAZO}/>
    <rect x="66" y="-16" width="34" height="22" rx="10" ${TRAZO}/>
    <rect x="74" y="-30" width="8" height="18" rx="3" transform="rotate(-8 78 -21)" ${TRAZO}/>
    <rect x="86" y="-30" width="8" height="18" rx="3" transform="rotate(8 90 -21)" ${TRAZO}/>
    <circle cx="92" cy="-6" r="3.5" fill="#191919"/>
    <rect x="14" y="30" width="34" height="22" rx="4" fill="#00a896" stroke="#191919" stroke-width="5"/>
  </svg>`;
}

/** Banda de ancho completo para centrar una pieza sin pelear con el translate. */
function banda(top, contenido, extra) {
  return `<div class="banda" style="top:${top}px${extra ?? ""}">${contenido}</div>`;
}

/**
 * El DOM de cada escena. Los elementos con `data-i` entran escalonados
 * (0.22 s), con la misma entrada suave que los juegos. Nada de texto pasa
 * por la zona de la luna (arriba a la derecha).
 */
function escenaHtml(id) {
  switch (id) {
    case "intro":
      return `
  <div class="arriba" style="top:110px"><h1 data-i>¿Cómo se hace un sorteo justo?</h1>
  <p class="sub" data-i style="margin-top:24px">La llamita te lo muestra, paso a paso.</p></div>`;
    case "lista":
      return `
  <div class="arriba" style="top:64px"><span class="kicker" data-i>Paso 1</span>
  <h2 data-i style="margin-top:8px">La lista se cierra antes de sortear.</h2></div>
  ${banda(232, `<div class="tarjeta" data-i style="width:440px">
    <div class="kicker" style="margin-bottom:8px">Lista de hoy</div>
    <div class="fila">Ana</div><div class="fila">Franco</div><div class="fila">Sofía</div>
    <div class="fila">Mateo</div><div class="fila">Valeria</div><div class="fila resto">+ 22 más</div>
  </div>`)}
  ${banda(602, `<div class="chips" data-i><span class="chip">Todos la ven</span><span class="chip">Nadie la borra</span><span class="chip">Nadie la cambia</span></div>`)}`;
    case "numero":
      return `
  <div class="arriba" style="top:64px"><span class="kicker" data-i>Paso 2</span>
  <h2 data-i style="margin-top:8px">El ganador no lo elige nadie.</h2>
  <p class="sub" data-i style="margin-top:16px">Sale de un número público, publicado a la vista de todos.</p></div>
  ${banda(252, `<div class="tarjeta" data-i style="width:560px;text-align:center">
    <div class="kicker">El número público</div>
    <div class="mono grande">4.912.003</div>
  </div>`)}
  ${banda(468, `<span class="sello" data-i>PÚBLICO</span>`)}
  ${banda(596, `<p class="sub" data-i>Ni Tinkazo ni quien organiza pueden elegir ese número.</p>`)}`;
    case "cae":
      return `
  <div class="arriba" style="top:64px"><span class="kicker" data-i>Paso 3</span>
  <h2 data-i style="margin-top:8px">El número cae sobre la lista.</h2></div>
  ${banda(238, `<div class="tarjeta" data-i style="width:440px">
    <div class="kicker" style="margin-bottom:8px">La lista con sello</div>
    <div class="fila">Ana</div><div class="fila">Franco</div><div class="fila albo" id="filaSofia">Sofía</div>
    <div class="fila">Mateo</div><div class="fila">Valeria</div>
  </div>`)}
  <div class="banda" style="top:596px">
    <span class="chip" id="ganaSofia">Gana Sofía</span>
    <span class="sub mono" id="filaTexto" style="opacity:0;margin-left:18px;align-self:center">la tercera de la lista</span>
  </div>`;
    case "compruebo":
      return `
  <div class="arriba" style="top:64px"><span class="kicker" data-i>Paso 4</span>
  <h2 data-i style="margin-top:8px">¿Me creés? Comprobalo vos mismo.</h2></div>
  ${banda(244, `<div class="duo" data-i>
    <div class="tarjeta" style="width:380px">
      <div class="kicker">El celular de Ana</div>
      <div class="fila">Ana</div><div class="fila">Franco</div><div class="fila">Mateo</div>
      <button class="boton" style="margin-top:16px">Gana Sofía</button>
    </div>
    <div class="check">✔</div>
    <div class="tarjeta" style="width:380px">
      <div class="kicker">Cualquier otro celular</div>
      <div class="fila">Ana</div><div class="fila">Franco</div><div class="fila">Mateo</div>
      <button class="boton" style="margin-top:16px">Gana Sofía</button>
    </div>
  </div>`)}
  ${banda(596, `<p class="sub" data-i>El mismo ganador. Siempre.</p>`)}`;
    case "trampa":
      return `
  <div class="arriba" style="top:84px"><span class="kicker" data-i>La lista tiene sello</span>
  <h2 data-i style="margin-top:8px">Si alguien cambia un nombre, no cuadra.</h2></div>
  ${banda(248, `<div class="tarjeta" data-i style="width:520px">
    <div class="fila">Ana</div><div class="fila">Franco</div>
    <div class="fila trampa" id="filaTrampa"><span id="pedia">Pepe Impostor</span></div>
    <div class="fila">Mateo</div><div class="fila">Valeria</div>
  </div>`)}
  <div class="banda" style="top:596px"><span class="chip roja" id="chipTrampa" style="opacity:0">Trampa detectada</span></div>`;
    case "juegos":
      return `
  <div class="arriba" style="top:110px"><h1 data-i>Esto mismo, en diez juegos</h1>
  <p class="sub" data-i style="margin-top:22px">Todos con este mismo sorteo: justo, y todos comprobables.</p></div>`;
    case "cierre":
      return `
  <div class="arriba cierre" style="top:130px"><h1 data-i>No hace falta creerme.</h1>
  <p class="sub" data-i style="margin-top:20px">Cada paso se puede comprobar.</p>
  <p class="sub fuerte" data-i style="margin-top:14px">Tinkazo: sorteos justos en pantalla grande.</p></div>
  <p class="mono pie" style="opacity:0" id="pieCiere">tinkazo.app</p>`;
    default:
      return "";
  }
}

/** La página completa: escenas apiladas, fondo compartido y el reloj `t`. */
export function pagina(jsonFondo, jsonEscenas) {
  const secciones = ESCENAS.map((e) => `<section class="escena" id="e-${e.id}">${escenaHtml(e.id)}</section>`).join("\n");
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<style>
  :root {
    --ink: #f6efe2; --card: #221a33; --muted: #97909f; --magenta: #ff5cb3;
    --amarillo: #ffc629; --teal: #17c3b2;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${ANCHO}px; height: ${ALTO}px; overflow: hidden; background: #1d2248; }
  body { font-family: "Liberation Sans", "DejaVu Sans", sans-serif; color: var(--ink); }
  .mono { font-family: "Liberation Mono", "DejaVu Sans Mono", monospace; }

  /* el atardecer de carrera.ts: seis franjas, de arriba a abajo */
  .fondo { position: absolute; inset: 0; overflow: hidden; }
  .franja { position: absolute; left: 0; width: 100%; height: calc(100% / 6); }
  .f1 { background: #1d2248; top: 0; }
  .f2 { background: #2d2c5e; top: 16.666%; }
  .f3 { background: #4b3b6e; top: 33.333%; }
  .f4 { background: #7b4a73; top: 50%; }
  .f5 { background: #b06a6a; top: 66.666%; }
  .f6 { background: #e0956a; top: 83.333%; }
  .mtn { position: absolute; left: 0; right: 0; top: 52%; height: 48%; }
  .mtn.atras { opacity: .75; }
  .mtn svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* la luna crema, arriba a la derecha, radio ~6% del alto: zona vedada para el texto */
  .luna { position: absolute; right: 88px; top: 56px; width: 86px; height: 86px; border-radius: 50%;
    background: #ffe9a8; opacity: .9; }
  .luna i { position: absolute; border-radius: 50%; background: #f2d98e; }
  .estrella { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #fff; }
  .confeti { position: absolute; top: 0; width: 11px; height: 17px; border-radius: 3px; opacity: 0; }

  /* tarjetas y UI de la marca */
  .kicker { font-family: "Liberation Mono", monospace; font-size: 17px; text-transform: uppercase;
    letter-spacing: .18em; color: var(--muted); font-weight: 600; }
  .tarjeta { background: var(--card); border: 3px solid var(--ink); box-shadow: 8px 8px 0 rgba(10, 6, 28, .7);
    border-radius: 6px; padding: 20px 28px; }
  .chip { display: inline-block; background: var(--amarillo); color: #191919; border: 3px solid #191919;
    box-shadow: 4px 4px 0 var(--magenta); border-radius: 4px; padding: 8px 18px; font-weight: 800; font-size: 24px; }
  .chip.roja { background: var(--magenta); box-shadow: 4px 4px 0 rgba(10, 6, 28, .7); }
  .sub { font-size: 30px; text-shadow: 2px 2px 0 rgba(12, 8, 30, .85); }
  .fuerte { font-weight: 800; }
  .sello { display: inline-block; background: var(--teal); color: #191919; border: 3px solid #191919;
    border-radius: 50%; width: 96px; height: 96px; line-height: 92px; text-align: center;
    font-family: "Liberation Mono", monospace; font-size: 14px; font-weight: 800; letter-spacing: .1em;
    box-shadow: 4px 4px 0 rgba(10, 6, 28, .7); }
  .boton { background: var(--amarillo); color: #191919; border: 3px solid #191919; border-radius: 4px;
    box-shadow: 3px 3px 0 var(--magenta); font-weight: 800; font-size: 24px; padding: 8px 20px; width: 100%; font-family: inherit; }

  .escena { position: absolute; inset: 0; display: none; }
  .escena.activa { display: block; }
  .arriba { position: absolute; left: 84px; right: 216px; }
  .arriba.cierre { text-align: center; width: 100%; left: 0; }
  .arriba h1 { font-size: 58px; font-weight: 800; line-height: 1.15; text-shadow: 3px 3px 0 rgba(12, 8, 30, .85); }
  .arriba h2 { font-size: 48px; font-weight: 800; text-shadow: 3px 3px 0 rgba(12, 8, 30, .85); }
  .banda { position: absolute; left: 0; right: 0; display: flex; justify-content: center; align-items: flex-start; }
  .banda p { white-space: nowrap; }
  .fila { font-size: 30px; padding: 6px 2px; border-bottom: 2px solid rgba(246, 239, 226, .14); }
  .fila.resto { border-bottom: 0; color: var(--muted); font-size: 26px; }
  .fila.albo { border-bottom: 0; }
  .fila.ganadora { background: var(--amarillo); color: #191919; font-weight: 800; border-radius: 4px; }
  .fila.trampa { border-bottom: 0; }
  .fila.trampa span.tachada { text-decoration: line-through 5px var(--magenta); color: var(--muted); }
  .chips { display: flex; gap: 24px; }
  .grande { font-size: 58px; font-weight: 700; margin-top: 14px; text-align: center; }
  .duo { display: flex; gap: 96px; align-items: flex-start; }
  .duo .check { align-self: center; font-size: 58px; color: var(--teal); font-weight: 800;
    text-shadow: 2px 2px 0 rgba(10, 6, 28, .8); }
  .pie { position: absolute; bottom: 18px; font-size: 20px; color: var(--muted); }
  .llamita { position: absolute; left: 0; top: 0; will-change: transform; }
</style></head>
<body>
  <div class="fondo">
    <div class="franja f1"></div><div class="franja f2"></div><div class="franja f3"></div>
    <div class="franja f4"></div><div class="franja f5"></div><div class="franja f6"></div>
    <div class="mtn atras"><svg viewBox="0 0 ${ANCHO} ${ALTO}" preserveAspectRatio="none">
      <polygon points="0,${ALTO} ${jsonFondo.atras.map((p) => p.join(",")).join(" ")} ${ANCHO},${ALTO}" fill="#2d2a52"/></svg></div>
    <div class="mtn adelante"><svg viewBox="0 0 ${ANCHO} ${ALTO}" preserveAspectRatio="none">
      <polygon points="0,${ALTO} ${jsonFondo.adelante.map((p) => p.join(",")).join(" ")} ${ANCHO},${ALTO}" fill="#3a3566"/></svg></div>
    <div id="estrellas"></div>
    <div class="luna"><i style="left:18px;top:26px;width:16px;height:16px"></i><i style="left:52px;top:14px;width:10px;height:10px"></i><i style="left:58px;top:50px;width:12px;height:12px"></i><i style="left:30px;top:58px;width:7px;height:7px"></i></div>
  </div>
  ${secciones}
  ${llamitaSvg()}
  <div id="confeti">${jsonFondo.confeti.map((p) => `<i class="confeti" style="left:${p.x}px;background:${p.color}"></i>`).join("")}</div>
<script>
'use strict';
// La escena entera es función pura de t (segundos desde el arranque). Las
// piezas (estrellas, confeti, picos, patas) salen del sembrado que Node
// inyectó acá abajo; nada usa Math.random.
var FONDO = ${JSON.stringify(jsonFondo)};
var ESCENAS = ${jsonEscenas};
var FPS = ${FPS};

function porId(id) { return document.getElementById(id); }
function recorte(x) { return Math.max(0, Math.min(1, x)); }
function fueraCubica(x) { var p = recorte(x); return 1 - Math.pow(1 - p, 3); }
function fueraResorte(x) {
  var p = recorte(x), c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}
// entra(el, l, demora): sube y aparece, con la misma entrada de los juegos.
function entra(el, l, demora, ms) {
  var e = fueraCubica((l - demora) / ((ms || 500) / 1000));
  el.style.opacity = String(e);
  el.style.transform = 'translateY(' + Math.round((1 - e) * 26) + 'px)';
}
function pop(el, l, demora) {
  var e = fueraResorte((l - demora) / .45);
  el.style.opacity = String(recorte(e * 3));
  el.style.transform = 'scale(' + (0.6 + 0.4 * e).toFixed(3) + ')';
}

// Estrellas armadas al cargar, con lo sembrado.
(function () {
  var arriba = porId('estrellas');
  FONDO.estrellas.forEach(function (s) {
    var i = document.createElement('i');
    i.className = 'estrella';
    i.style.left = s.x + 'px';
    i.style.top = s.y + 'px';
    i.dataset.f = s.f;
    arriba.appendChild(i);
  });
})();

var escenas = {};
var indice = {};
ESCENAS.forEach(function (e, i) {
  var raiz = porId('e-' + e.id);
  escenas[e.id] = { raiz: raiz, piezas: [].slice.call(raiz.querySelectorAll('[data-i]')), dur: e.dur, desde: e.desde };
  indice[e.id] = i;
});

// Dónde está la llamita en cada escena (a: de x0 a x1 durante la escena).
// y = la altura de las patas: el piso que pisa sobre la silueta de las montañas.
var RUTA = {
  intro: { a: [-80, 540], y: 694, cara: 1 },
  lista: { a: [96, 140], y: 694, cara: 1 },
  numero: { a: [1130, 1096], y: 694, cara: -1 },
  cae: { a: [1050, 1020], y: 694, cara: -1 },
  compruebo: { a: [60, 96], y: 694, cara: 1 },
  trampa: { a: [1080, 1040], y: 694, cara: -1 },
  juegos: { a: [-100, 1380], y: 694, cara: 1 },
  cierre: { a: [590, 590], y: 686, cara: 1, salto: true }
};

var lama = document.querySelector('.llamita');
var g1 = document.querySelector('.llamita .g1');
var g2 = document.querySelector('.llamita .g2');
var confPiezas = [].slice.call(porId('confeti').querySelectorAll('i'));
var estrellas = [].slice.call(porId('estrellas').querySelectorAll('.estrella'));

function dibujaLlamita(id, l, dur) {
  var r = RUTA[id];
  var paso = recorte(l / dur);
  var x = r.a[0] + (r.a[1] - r.a[0]) * paso;
  var andando = Math.abs(r.a[1] - r.a[0]) > 30;
  var salto = 0;
  if (r.salto && l > .55) {
    // salto de alegría: parabólico cada 1.1 s, parándose antes del cierre
    var fase = (l - .55) % 1.1;
    salto = Math.sin(Math.PI * recorte(fase / .85)) * 52 * recorte((dur - .55 - l) / .8);
  }
  var rebote = andando ? Math.abs(Math.sin(l * 7)) * 3 : Math.sin(l * 2.2) * 1.6;
  // las patas llegan a V=106 (+44 del arranque del viewBox) = 150 desde el borde
  // superior: el piso queda en r.y y el cuerpo descansa sobre él.
  lama.style.transform = 'translateX(' + Math.round(x - 64) + 'px) translateY(' + Math.round(r.y - rebote - 150 - salto) + 'px) scaleX(' + r.cara + ')';
  var ciclo = andando ? Math.sin(l * 14) : Math.sin(l * 4) * .25;
  g1.setAttribute('transform', 'translate(0,' + (ciclo > 0 ? -8 : 0) + ')');
  g2.setAttribute('transform', 'translate(0,' + (ciclo <= 0 ? -8 : 0) + ')');
}

function dibujaConfeti(l, dur) {
  // Cae durante toda la escena de cierre y se apaga con ella.
  var visible = recorte((dur - .5 - l) / .5) * recorte(l * 12);
  for (var i = 0; i < FONDO.confeti.length; i++) {
    var p = FONDO.confeti[i];
    var y = ((p.y0 + l * p.vel) % 780) - 30;
    confPiezas[i].style.transform = 'translate(0,' + Math.round(y) + 'px) rotate(' + Math.round((l * p.giro) % 360) + 'deg)';
    confPiezas[i].style.opacity = visible.toFixed(2);
  }
}

// Detalles propios de cada escena, después de las entradas comunes.
var detalles = {
  cae: function (l) {
    var fila = porId('filaSofia');
    fila.className = l > 1.5 ? 'fila ganadora albo' : 'fila albo';
    porId('ganaSofia').style.opacity = l > 1.5 ? '1' : '0';
    if (l > 1.5) pop(porId('ganaSofia'), l, 1.5);
    else porId('ganaSofia').style.transform = 'scale(.6)';
    porId('filaTexto').style.opacity = String(fueraCubica((l - 2.1) / .4));
  },
  trampa: function (l) {
    porId('pedia').className = l > 1.2 ? 'tachada' : '';
    if (l > 1.8) { porId('chipTrampa').style.opacity = '1'; pop(porId('chipTrampa'), l, 1.8); }
    else porId('chipTrampa').style.opacity = '0';
  },
  cierre: function (l) {
    porId('pieCiere').style.opacity = String(fueraCubica((l - 2.4) / .5) * .9);
  }
};

function dibuja(t) {
  var i = 0;
  while (i < ESCENAS.length - 1 && t >= ESCENAS[i].desde + ESCENAS[i].dur) i++;
  var escena = ESCENAS[i];
  var l = t - escena.desde;
  for (var k = 0; k < ESCENAS.length; k++) {
    escenas[ESCENAS[k].id].raiz.className = k === i ? 'escena activa' : 'escena';
  }
  var datos = escenas[escena.id];
  // entradas escalonadas: 0.22 s entre piezas, la primera a los 0.15 s
  for (var p = 0; p < datos.piezas.length; p++) {
    entra(datos.piezas[p], l, .15 + p * .22, 500);
  }
  // salida: toda la escena se apaga antes del corte
  datos.raiz.style.opacity = String(recorte((datos.dur - .4 - l) / .4));
  for (var s = 0; s < estrellas.length; s++) {
    var e = estrellas[s];
    e.style.opacity = String(.5 + .5 * Math.sin(t * 3 + parseFloat(e.dataset.f)));
  }
  dibujaLlamita(escena.id, l, datos.dur);
  if (escena.id === 'cierre') dibujaConfeti(l, datos.dur);
  if (detalles[escena.id]) detalles[escena.id](l);
}

window.__dibuja = dibuja;
window.__listo = true;
</script>
</body></html>`;
}

/** El .vtt de un idioma, con los tiempos globales de las escenas. */
export function pistaVtt(idioma) {
  const reloj = (s) => {
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const sec = String(Math.floor(s % 60)).padStart(2, "0");
    const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
    return `00:${m}:${sec}.${ms}`;
  };
  const lineas = ["WEBVTT", ""];
  let n = 0;
  for (const escena of ESCENAS) {
    for (const [desde, hasta, es, en] of NARRACION[escena.id] ?? []) {
      n++;
      const t0 = escena.desde + desde;
      const t1 = Math.min(escena.desde + hasta, SEGUNDOS);
      lineas.push(String(n), `${reloj(t0)} --> ${reloj(t1)}`, idioma === "es" ? es : en, "");
    }
  }
  return lineas.join("\n");
}

export const duracion = SEGUNDOS;

/** El renderizado completo solo corre cuando este script es el principal. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
(async () => {
  const sellos = fondo();
  const jsonEscenas = JSON.stringify(ESCENAS.map(({ id, dur, desde }) => ({ id, dur, desde })));
  const temporal = mkdtempSync(join(tmpdir(), "tinkazo-video-"));
  const rutaHtml = join(temporal, "escenas.html");
  writeFileSync(rutaHtml, pagina(sellos, jsonEscenas));
  mkdirSync(fuera, { recursive: true });

  const browser = await launch({ width: ANCHO, height: ALTO });
  try {
    const cdp = await browser.open(`file://${rutaHtml}`);
    // La ventana de headless=new reserva la barra de herramientas: el viewport
    // real queda de ~589 px. Con la emulación de métricas el viewport es
    // exactamente 1280x720 y cada cuadro sale completo.
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: ANCHO,
      height: ALTO,
      deviceScaleFactor: 1,
      mobile: false,
    });
    for (let i = 0; i < 100; i++) {
      const r = await cdp.send("Runtime.evaluate", { expression: "window.__listo === true" });
      if (r.result?.value === true) break;
      await sleep(100);
      if (i === 99) throw new Error("la página de escenas no arrancó");
    }
    const fuentes = await cdp.send("Runtime.evaluate", {
      expression: "document.fonts.ready.then(() => document.fonts.status)",
      awaitPromise: true,
      returnByValue: true,
    });
    console.log(`fuentes: ${fuentes.result?.value}`);
    await sleep(250);

    const cuadros = mkdtempSync(join(tmpdir(), "tinkazo-cuadros-"));
    for (let i = 0; i < CUADROS; i++) {
      await cdp.send("Runtime.evaluate", { expression: `__dibuja(${(i / FPS).toFixed(6)})` });
      const foto = await cdp.send("Page.captureScreenshot", {
        format: "jpeg",
        quality: 92,
        // El tamaño de la ventana no siempre es el del contenido: con el
        // recorte explícito el cuadro sale completo a 1280x720.
        clip: { x: 0, y: 0, width: ANCHO, height: ALTO, scale: 1 },
      });
      writeFileSync(join(cuadros, `${String(i).padStart(6, "0")}.jpg`), Buffer.from(foto.data, "base64"));
      if (i % 300 === 0) console.log(`cuadro ${String(i).padStart(5, "0")} / ${CUADROS}`);
    }

    // El mp4: misma familia de códec que el que reemplaza (H.264, yuv420p),
    // sin pista de audio, y liviano (CRF 28 con escenas casi estáticas).
    const mp4 = join(fuera, "llamita-explica.mp4");
    const armar = spawnSync(FFMPEG, [
      "-y", "-framerate", String(FPS), "-i", join(cuadros, "%06d.jpg"),
      "-vf", "format=yuv420p",
      "-c:v", "libx264", "-preset", "slow", "-crf", "28",
      "-an", "-movflags", "+faststart", mp4,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    if (armar.status !== 0) throw new Error(`ffmpeg no pudo armar el mp4:\n${armar.stderr?.toString().slice(-2000)}`);

    // El póster: un cuadro del cierre (la llamita saltando con confeti).
    const cuadroPoster = Math.round((ESCENAS.find((e) => e.id === "cierre").desde + 3.4) * FPS);
    const poster = join(fuera, "llamita-poster.jpg");
    const pintar = spawnSync(FFMPEG, [
      "-y", "-i", join(cuadros, `${String(cuadroPoster).padStart(6, "0")}.jpg`),
      "-vf", "scale=640:360", "-q:v", "4", poster,
    ], { stdio: ["ignore", "ignore", "pipe"] });
    if (pintar.status !== 0) throw new Error(`ffmpeg no pudo pintar el póster:\n${pintar.stderr?.toString().slice(-1000)}`);

    // Las dos pistas de subtítulos, con los mismos tiempos de las escenas.
    writeFileSync(join(fuera, "llamita-explica.es.vtt"), pistaVtt("es"));
    writeFileSync(join(fuera, "llamita-explica.en.vtt"), pistaVtt("en"));

    console.log(`escenas: ${ESCENAS.map((e) => `${e.id}@${e.desde}s`).join(" ")}`);
    console.log(`duración: ${SEGUNDOS}s (${CUADROS} cuadros a ${FPS})`);
    console.log(`mp4: ${statSync(mp4).size} bytes, póster: ${statSync(poster).size} bytes`);
    if (!dejaCuadros) rmSync(cuadros, { recursive: true, force: true });
    else console.log(`cuadros dejados en ${cuadros}`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
}
