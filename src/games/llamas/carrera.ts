import { Container, Graphics, Sprite, Text } from "pixi.js";
import { colorDeNombre } from "../pixi/foco-vista";
import { crearJuego, minimoPx, nivelPorCantidad, planNombres, type Caja, type FocoPunto, type Kit, type Nivel, type Zona } from "../pixi/kit";
import { CREAM, INK, YELLOW, contorno, hash } from "../pixi/stage";
import { ECHADA_DUR, carrilesDe, formaDe, hudDe, type Carriles, type Forma, type Pantalla } from "./carrera-forma";
import { RECTA, alfabetico, planCarrera, type Datos, type EscenaCarrera } from "./carrera-show";
import { TEXTOS_CARRERA } from "./carrera-textos";
import type { Tanda } from "./carrera-tandas";
import type { Terreno } from "./carrera-tiempos";
import { LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO, PELAJES, crearBorla, crearLlama, type Llama, type Momento } from "./llama";

/**
 * La carrera de llamas, sobre el kit (`pixi/kit`). El show es puro
 * (`carrera-show.ts`) y esta escena es una función de la hora del juego: el
 * kit lleva el reloj, la cámara con sus cinco arcos, el relator, el golpe y el
 * foco.
 *
 * Lo que se ve, sin leer (regla del niño, `docs/juegos.md`):
 *
 * - **Hacia dónde**: todo corre de izquierda a derecha, siempre. La cinta de
 *   arriba muestra el camino entero con sus terrenos, la bandera de la meta
 *   al final y, como cursor, la cara de quien va adelante.
 * - **Cuánto falta**: el cursor en la cinta, los postes que pasan, el suelo de
 *   cada terreno y, al final, el arco de la meta que se acerca.
 * - **Quién va adelante**: la de más a la derecha, con la borla amarilla (el
 *   único objeto que cambia de dueña) y la única ficha grande.
 * - **Qué pasó**: la que se echa se echa en el cuerpo (patas plegadas, gris,
 *   polvo) y se queda donde pasó, con su nombre.
 */

const TERRENO_COLOR: Record<Terreno | "corral" | "recta", number> = {
  corral: 0x8a6a4a, cuesta: 0x6b8f3f, barro: 0x6a4a32, piedras: 0x7a7a84, viento: 0xb4c49a, recta: 0xa05d48,
};
const TERRENO_ACENTO: Record<Terreno | "corral" | "recta", number> = {
  corral: 0xd9b36b, cuesta: 0x2f9e44, barro: 0xa86f3f, piedras: 0xcfd2dc, viento: 0x7ad0e8, recta: 0xffc629,
};

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const suave = (v: number): number => {
  const x = clamp01(v);
  return x * x * (3 - 2 * x);
};
const ease = (v: number): number => {
  const x = clamp01(v);
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
};

interface Etiqueta {
  raiz: Container;
  fondo: Graphics;
  texto: Text;
  w: number;
  h: number;
  clave: string;
}

interface Corredora {
  persona: number;
  llama: Llama;
  raiz: Container;
  etiqueta: Etiqueta;
  fase: number;
  usada: boolean;
}

interface Posicion {
  x: number;
  y: number;
  esc: number;
  velocidad: number;
  momento: Momento;
  /** Las que esperan su tanda no se dibujan. */
  visible: boolean;
  /** Falso: todavía no tiene su nombre en la pista (el de las tandas está en el cartel). */
  etiquetar?: boolean;
}

function crearEscena(k: Kit, d: Datos) {
  const S = k.S;
  const cam = k.cam;
  // Los nombres se leen siempre: nada de desenfoque en los acercamientos (con 8 la escena quedaba borrosa un segundo).
  cam.noBlur();
  const names = d.names;
  const formasN = planNombres(names).formas;
  const pant = (): Pantalla => {
    const p = k.pantalla();
    return { w: p.w, h: p.h, u: p.k, retrato: p.retrato, top: p.top, bottom: p.bottom };
  };
  let P = pant();

  /* ----------------------------------------------------------------- capas */
  const cielo = new Container();
  const cieloFijo = new Graphics();
  const montes: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
  cielo.addChild(cieloFijo, ...montes);
  S.bg.addChild(cielo);
  const mundo = new Container();
  const suelo = new Graphics();
  const marcas = new Container();
  const porton = new Graphics();
  const corredoras = new Container();
  corredoras.sortableChildren = true;
  const borlaCapa = new Container();
  const etiquetas = new Container();
  // Las fichas se ordenan: la amarilla de quien va adelante arriba de todas, y la de quien se acaba de echar arriba de las comunes.
  etiquetas.sortableChildren = true;
  mundo.addChild(suelo, marcas, porton, corredoras, borlaCapa, etiquetas);
  S.scene.addChild(mundo);
  const hud = new Container();
  S.hud.addChild(hud);

  /* ------------------------------------------------------------- geometría */
  const nombrePx = (): number => k.letra("nombre");
  const medidor = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM });
  medidor.visible = false;
  const cache = new Map<string, number>();
  const ancho = (s: string, px: number): number => {
    const clave = `${px.toFixed(1)}|${s}`;
    let v = cache.get(clave);
    if (v === undefined) {
      medidor.style.fontSize = px;
      medidor.text = s;
      v = medidor.width;
      cache.set(clave, v);
    }
    return v;
  };
  const nivelDe = (vivas: number): Nivel => (vivas <= 8 ? 4 : vivas <= 14 ? 3 : 2);
  const textoDe = (i: number, nivel: Nivel): string => (formasN[i] as readonly string[])[nivel - 1] ?? names[i] ?? "";

  let forma: Forma;
  let carr: Carriles;
  let F0 = 0;
  let Xs = 0;
  let metaX = 0;
  let nombreW = 0;
  let gateX = 0;
  let arenaX = 0;
  let formaArena: Forma | null = null;
  function medirGeometria(): void {
    P = pant();
    const px = nombrePx();
    nombreW = 0;
    // El ancho de las fichas: el del nivel con que arrancan (con ocho o menos, el nombre entero), con un poco de aire para la ficha amarilla, que es más grande.
    const nivelInicial: Nivel = d.gente.length <= 8 ? 4 : 3;
    for (const g of d.gente) nombreW = Math.max(nombreW, ancho(textoDe(g, nivelInicial), px) * 1.15);
    forma = formaDe(P, Math.max(1, d.gente.length), px, nombreW);
    carr = carrilesDe(P, d.lanes.length, px);
    F0 = -(60 * P.u + LLAMA_HOCICO * forma.esc);
    Xs = F0 + d.distAbre * P.w;
    metaX = Xs + RECTA * P.w + LLAMA_HOCICO * carr.esc;
    // Con tandas: el portón queda justo atrás del corral y la tanda que corre espera más atrás, en un grupo apretado sin nombres (están en el cartel).
    const sobra = forma.arriba ? nombreW / 2 + forma.largo / 2 : nombreW + forma.largo;
    gateX = F0 - forma.profundidad - sobra - 90 * P.u;
    if (d.tandas.length) {
      const tam = Math.max(...d.tandas.map((h) => h.miembros.length));
      // En el celular el cartel ocupa la parte de arriba: el grupo de la tanda va debajo, en filas como en el proyector.
      const banda = P.bottom - hudDe(P).bajo;
      formaArena = formaDe(P.retrato ? { ...P, retrato: false, w: P.w * 0.8, top: P.top + 0.54 * banda } : { ...P, w: P.w * 0.5 }, tam, 4, 0);
      arenaX = gateX - 110 * P.u;
    }
  }
  medirGeometria();
  const heatDe = new Map<number, number>();
  d.tandas.forEach((h, i) => h.miembros.forEach((m) => heatDe.set(m, i)));
  const corralMemo = new Map<number, { x: number; y: number } | null>();
  const corralDe = (persona: number): { x: number; y: number } | null => {
    if (!corralMemo.has(persona)) corralMemo.set(persona, lugarEnGrupo(persona, d.tSalida));
    return corralMemo.get(persona) ?? null;
  };
  /** Dónde está el frente del grupo (el origen de la primera) en el mundo. */
  const xFrente = (t: number): number => F0 + d.dist(Math.min(t, d.tAbre)) * P.w;
  /** El mundo en x para un instante del grupo (de la línea de salida al comienzo de la recta). */
  const xDeT = (t: number): number => F0 + d.dist(t) * P.w;

  /* ------------------------------------------------------------- etiquetas */
  function crearEtiqueta(): Etiqueta {
    const raiz = new Container();
    const fondo = new Graphics();
    const texto = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM, stroke: contorno(20) });
    texto.anchor.set(0.5);
    raiz.addChild(fondo, texto);
    return { raiz, fondo, texto, w: 0, h: 0, clave: "" };
  }
  function ponerEtiqueta(e: Etiqueta, s: string, px: number, estilo: "normal" | "lider" | "echada"): void {
    const clave = `${s}|${px.toFixed(1)}|${estilo}`;
    if (e.clave === clave) return;
    e.clave = clave;
    const fs = estilo === "lider" ? px * 1.25 : px;
    e.texto.style.fontSize = fs;
    e.texto.style.fill = estilo === "lider" ? INK : CREAM;
    // La ficha amarilla lleva tinta, con un borde de tinta fino: la letra queda firme y el auditor ve el contorno oscuro.
    e.texto.style.stroke = estilo === "lider" ? { color: INK, width: Math.max(3, fs / 9), join: "round" } : contorno(fs);
    e.texto.text = s;
    const w = e.texto.width + fs * 0.5;
    const h = fs * 1.28;
    e.w = w;
    e.h = h;
    e.texto.position.set(0, 0);
    e.fondo.clear();
    if (estilo === "lider") e.fondo.roundRect(-w / 2 + 3, -h / 2 + 3, w, h, h * 0.3).fill(INK).roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill(YELLOW).stroke({ width: Math.max(2, fs / 9), color: INK });
    else e.fondo.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color: estilo === "echada" ? 0x3a3a46 : INK, alpha: estilo === "echada" ? 0.78 : 0.62 });
  }

  /* ------------------------------------------------------------ corredoras */
  const enUso = new Map<number, Corredora>();
  function tomar(persona: number): Corredora {
    let c = enUso.get(persona);
    if (c) return c;
    const llama = crearLlama(S, { pelaje: PELAJES[persona % PELAJES.length] ?? 0xf3ead8, manta: S.color(persona) });
    const raiz = new Container();
    raiz.addChild(llama.root);
    const etiqueta = crearEtiqueta();
    corredoras.addChild(raiz);
    etiquetas.addChild(etiqueta.raiz);
    c = { persona, llama, raiz, etiqueta, fase: hash(persona, 7) * 6.28, usada: true };
    enUso.set(persona, c);
    return c;
  }
  /** Cuando una tanda termina, sus llamas se van: cada una tiene su pelaje y su manta, así que no se reusan. */
  function soltar(persona: number): void {
    const c = enUso.get(persona);
    if (!c) return;
    enUso.delete(persona);
    c.raiz.destroy({ children: true });
    c.etiqueta.raiz.destroy({ children: true });
  }

  /* ---------------------------------------------------------- posiciones */
  const VENTANA = 6;
  const DT = 0.05;
  /** Dónde va quien está en el grupo en `t`: la media de los últimos instantes, así un cambio de puesto es un deslizamiento. */
  function lugarEnGrupo(persona: number, t: number): { x: number; y: number } | null {
    let dx = 0, fila = 0, n = 0;
    for (let j = 0; j < VENTANA; j++) {
      const tt = Math.max(d.tSalida, t - j * DT);
      const en = d.orden.en(tt);
      const r = en.indexOf(persona);
      if (r < 0) continue;
      const s = forma.slot(r);
      dx += s.dx;
      fila += s.fila;
      n++;
    }
    if (!n) return null;
    return { x: xFrente(t) - dx / n, y: forma.yPie(fila / n) };
  }
  const fraccionMovida = (t: number): number => suave((t - d.tAbre) / 1.6);

  /** Una persona de una tanda: espera su turno en el grupo apretado; si pasa, sale por el portón al corral; si no, se echa cuando se cierra. */
  function posicionEnTanda(persona: number, t: number): Posicion {
    const oculta: Posicion = { x: 0, y: 0, esc: forma.esc, velocidad: 0, momento: null, visible: false, etiquetar: false };
    const hi = heatDe.get(persona);
    if (hi === undefined || !formaArena) return oculta;
    const h = d.tandas[hi] as Tanda;
    if (t < h.t0 - 0.2) return oculta;
    const s = formaArena.slot(h.miembros.indexOf(persona));
    const xa = arenaX - s.dx, ya = formaArena.yPie(s.fila), ea = formaArena.esc;
    const j = h.pasan.indexOf(persona);
    if (j < 0) {
      if (t >= h.tFin + 1.2) return oculta;
      if (t >= h.tCierra) return { x: xa, y: ya, esc: ea, velocidad: 0, momento: { kind: "echada", p: (t - h.tCierra) / ECHADA_DUR }, visible: true, etiquetar: false };
      return { x: xa, y: ya, esc: ea, velocidad: 0.4, momento: null, visible: true, etiquetar: false };
    }
    const ts = h.salidas[j] as number;
    if (t < ts) return { x: xa, y: ya, esc: ea, velocidad: 0.4, momento: null, visible: true, etiquetar: false };
    // Las que pasan esperan del otro lado del portón, en un grupo apretado; cuando se cierra la última tanda se acomodan en el corral.
    const k = Math.max(0, d.gente.indexOf(persona));
    const sh = formaArena.slot(k);
    const espera = { x: gateX + 110 * P.u + sh.dx * 1.4, y: formaArena.yPie(sh.fila) };
    const u = clamp01((t - ts) / 1.1);
    const yg = (forma.y0 + forma.y1) / 2;
    const e1 = ease(Math.min(1, u / 0.45)), e2 = ease(Math.max(0, (u - 0.45) / 0.55));
    let x = u < 0.45 ? lerp(xa, gateX, e1) : lerp(gateX, espera.x, e2);
    let y = u < 0.45 ? lerp(ya, yg, e1) : lerp(yg, espera.y, e2);
    let esc = u < 0.45 ? lerp(ea, ea * 1.15, e1) : ea * 1.15;
    const tB0 = (d.tandas[d.tandas.length - 1] as Tanda).tCierra;
    if (t >= tB0) {
      const c = corralDe(persona) ?? { x: F0, y: forma.yPie(0) };
      const e = ease((t - tB0) / Math.max(0.5, d.tSalida - tB0));
      x = lerp(espera.x, c.x, e);
      y = lerp(espera.y, c.y, e);
      esc = lerp(ea * 1.15, forma.esc, e);
      return { x, y, esc, velocidad: e < 1 ? 1 : 0.35, momento: null, visible: true, etiquetar: e > 0.5 || d.lider(t) === persona };
    }
    return { x, y, esc, velocidad: u < 1 ? 1 : 0.35, momento: null, visible: true, etiquetar: u >= 0.6 && d.lider(t) === persona };
  }

  /** La posición de `persona` en `t`, con su postura. */
  function posicion(persona: number, t: number): Posicion {
    if (d.tandas.length && t < d.tSalida) return posicionEnTanda(persona, t);
    const cae = d.tiempos.cae.get(persona) ?? Infinity;
    const carril = d.lanes.indexOf(persona);
    const corriendo: Momento = null;
    // Antes de la salida: en el corral, quietas, en el orden de salida.
    if (t < d.tSalida) {
      const lg = corralDe(persona) ?? { x: F0, y: forma.yPie(0) };
      return { x: lg.x, y: lg.y, esc: forma.esc, velocidad: 0.35, momento: corriendo, visible: true };
    }
    // Echada: se queda donde pasó, con un deslizón corto.
    if (t >= cae) {
      const lg = lugarEnGrupo(persona, cae) ?? { x: F0, y: forma.yPie(0) };
      const s = t - cae;
      const desliza = 0.5 * (1 - (1 - clamp01(s / 0.6)) ** 2) * 0.6 * P.w * 0.1;
      return { x: lg.x + desliza, y: lg.y, esc: forma.esc, velocidad: 0, momento: { kind: "echada", p: s / ECHADA_DUR }, visible: true };
    }
    if (t < d.tAbre || carril < 0) {
      const lg = lugarEnGrupo(persona, t) ?? { x: F0, y: forma.yPie(0) };
      return { x: lg.x, y: lg.y, esc: forma.esc, velocidad: 1, momento: corriendo, visible: true };
    }
    // La recta: de la forma del grupo a su carril, sin frenar.
    const qq = d.q(t);
    // Las diferencias entre carriles se ensanchan un 70 % en la pantalla: así los adelantamientos se ven (el orden y la llegada son los del plan).
    const pq = d.final.pos(carril, qq);
    const xl = Xs + (qq + (pq - qq) * 1.7) * RECTA * P.w;
    const yl = carr.yPie(carril);
    const e = fraccionMovida(t);
    const m = d.final.beatOf(carril, qq);
    if (e >= 1) return { x: xl, y: yl, esc: carr.esc, velocidad: m?.kind === "plantada" ? 0 : 1.2, momento: m, visible: true };
    const lg = lugarEnGrupo(persona, d.tAbre - 0.001) ?? { x: Xs, y: yl };
    const xg = lg.x + RECTA * P.w * qq;
    return { x: lerp(xg, xl, e), y: lerp(lg.y, yl, e), esc: lerp(forma.esc, carr.esc, e), velocidad: 1.1, momento: m, visible: true };
  }

  /* --------------------------------------------------------------- el suelo */
  function pintarSuelo(): void {
    const vz = cam.zoom || 1;
    const x0 = cam.x - P.w / (2 * vz) - 120;
    const x1 = cam.x + P.w / (2 * vz) + 120;
    const yTop = forma.y0 - 14 * P.u;
    const yBot = cam.y + P.h / (2 * vz) + 40;
    suelo.clear();
    type ZonaSuelo = { desde: number; hasta: number; tipo: Terreno | "corral" | "recta"; idx: number };
    const zonas: ZonaSuelo[] = [{ desde: -1e9, hasta: 0, tipo: "corral", idx: 0 }];
    d.tramos.forEach((tr, i) => zonas.push({ desde: i === 0 ? 0 : xDeT(tr.t0), hasta: xDeT(tr.t1), tipo: tr.terreno, idx: i + 1 }));
    zonas.push({ desde: d.tramos.length ? Xs : 0, hasta: 1e9, tipo: "recta", idx: 9 });
    if (!d.tramos.length) zonas[0] = { desde: -1e9, hasta: 0, tipo: "corral", idx: 0 };
    for (const z of zonas) {
      const a = Math.max(x0, z.desde), b = Math.min(x1, z.hasta);
      if (b <= a) continue;
      suelo.rect(a, yTop, b - a, yBot - yTop).fill(TERRENO_COLOR[z.tipo]);
      suelo.rect(a, yTop, b - a, 5 * P.u).fill({ color: 0x000000, alpha: 0.22 });
      const T = 150 * P.u;
      for (let i = Math.floor(a / T); i * T < b; i++) {
        for (let m = 0; m < 4; m++) {
          const r1 = hash(i * 31 + m, z.idx * 7 + 1), r2 = hash(i * 17 + m, z.idx * 5 + 3), r3 = hash(i * 13 + m, z.idx * 3 + 9);
          const px = i * T + r1 * T, py = lerp(forma.y0, forma.y1 + 30 * P.u, r2);
          if (px < a || px > b) continue;
          const c = TERRENO_ACENTO[z.tipo];
          if (z.tipo === "barro") suelo.ellipse(px, py, (16 + 22 * r3) * P.u, (5 + 5 * r3) * P.u).fill({ color: 0x3e2a1c, alpha: 0.55 });
          else if (z.tipo === "piedras") suelo.poly([px, py, px + 12 * P.u * r3 + 6 * P.u, py - 7 * P.u, px + 20 * P.u, py + 2 * P.u]).fill({ color: c, alpha: 0.75 }).stroke({ width: 1.5 * P.u, color: INK, alpha: 0.5 });
          else if (z.tipo === "viento") suelo.moveTo(px, py).lineTo(px + (28 + 40 * r3) * P.u, py - 2 * P.u).stroke({ width: 2 * P.u, color: 0xffffff, alpha: 0.5 });
          else if (z.tipo === "cuesta") suelo.moveTo(px, py).lineTo(px + 7 * P.u, py - 12 * P.u).moveTo(px + 6 * P.u, py).lineTo(px + 13 * P.u, py - 14 * P.u).stroke({ width: 2 * P.u, color: c, alpha: 0.85 });
          else suelo.circle(px, py, 2.5 * P.u).fill({ color: c, alpha: 0.4 });
        }
      }
    }
    // La recta: carriles con sus rayas.
    const aR = Math.max(x0, Xs - 160 * P.u);
    if (x1 > aR) {
      for (let j = 0; j <= carr.n; j++) {
        const y = carr.y0 + j * carr.altoFila;
        suelo.moveTo(aR, y).lineTo(x1, y).stroke({ width: 2.5 * P.u, color: 0xffffff, alpha: j === 0 || j === carr.n ? 0.8 : 0.4 });
      }
    }
    // Postes: uno cada 0,2 anchos, con una banderita del color del terreno. Pasan de derecha a izquierda.
    const gap = 0.2 * P.w;
    for (let i = Math.max(0, Math.floor((x0 - F0) / gap)); F0 + i * gap < x1; i++) {
      const px = F0 + i * gap + gap * 0.5;
      if (px < x0 || px > metaX - 40 * P.u) continue;
      const base = forma.y0 - 4 * P.u;
      const tr = d.tramos.find((t) => px >= xDeT(t.t0) && px < xDeT(t.t1));
      const col = TERRENO_ACENTO[px >= Xs ? "recta" : (tr?.terreno ?? "corral")];
      suelo.rect(px - 3 * P.u, base - 62 * P.u, 6 * P.u, 62 * P.u).fill(INK);
      suelo.poly([px + 3 * P.u, base - 62 * P.u, px + 32 * P.u, base - 52 * P.u, px + 3 * P.u, base - 40 * P.u]).fill(col).stroke({ width: 2 * P.u, color: INK });
    }
  }

  /* --------------------------------------------------- la salida y la meta */
  function pintarMarcas(): void {
    marcas.removeChildren().forEach((c) => c.destroy({ children: true }));
    const g = new Graphics();
    const u = P.u;
    const y0 = forma.y0 - 14 * u, y1 = forma.y1 + 8 * u;
    // El corral: una cerca atrás de la línea de salida.
    const ancho = d.tandas.length ? -gateX + P.w * 0.7 : forma.profundidad + nombreW + 260 * u;
    for (let x = -ancho; x <= 0; x += 70 * u) g.rect(x - 3 * u, y0 - 26 * u, 6 * u, 36 * u).fill(0x6b4a2c).stroke({ width: 1.5 * u, color: INK });
    g.rect(-ancho, y0 - 20 * u, ancho, 5 * u).fill(0x8a6238).rect(-ancho, y0 - 6 * u, ancho, 5 * u).fill(0x8a6238);
    // La línea de salida.
    g.rect(-6 * u, y0, 12 * u, y1 - y0).fill(0xffffff);
    for (let y = y0, i = 0; y < y1; y += 12 * u, i++) if (i % 2) g.rect(-6 * u, y, 12 * u, 12 * u).fill(INK);
    // La meta: dos postes y un arco con cuadros.
    const pm = metaX;
    g.rect(pm - 7 * u, y0 - 70 * u, 14 * u, y1 - y0 + 70 * u).fill({ color: 0x000000, alpha: 0.0 });
    for (let y = y0, i = 0; y < y1; y += 14 * u, i++) {
      g.rect(pm - 14 * u, y, 14 * u, 14 * u).fill(i % 2 ? INK : 0xffffff);
      g.rect(pm, y, 14 * u, 14 * u).fill(i % 2 ? 0xffffff : INK);
    }
    g.rect(pm - 12 * u, y0 - 78 * u, 24 * u, 78 * u).fill(INK);
    g.rect(pm - 12 * u, y1, 24 * u, 12 * u).fill(INK);
    // Los portones de la recta: uno por carril, donde el grupo se abre. Cuántas pasan se cuenta con cosas, no con números.
    if (d.tiempos.echadas.length) {
      g.rect(Xs - 2 * u, carr.y0, 4 * u, carr.y1 - carr.y0).fill({ color: 0xffffff, alpha: 0.5 });
      for (let j = 0; j <= carr.n; j++) {
        const y = carr.y0 + j * carr.altoFila;
        g.rect(Xs - 3 * u, y - 30 * u, 6 * u, 32 * u).fill(INK);
        g.circle(Xs, y - 34 * u, 7 * u).fill(YELLOW).stroke({ width: 2.5 * u, color: INK });
      }
    }
    g.roundRect(pm - 90 * u, y0 - 100 * u, 180 * u, 38 * u, 8 * u).fill(0xffffff).stroke({ width: 3 * u, color: INK });
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) g.rect(pm - 90 * u + i * 20 * u, y0 - 100 * u + j * 19 * u, 20 * u, 19 * u).fill(INK);
    marcas.addChild(g);
    const meta = S.text(k.txt("carRotuloMeta"), { fontSize: 34 * u, fontWeight: "900", fill: YELLOW, stroke: contorno(34 * u) });
    meta.anchor.set(0.5);
    meta.position.set(pm, y0 - 118 * u);
    const salida = S.text(k.txt("carSalida").replace(/[¡!]/g, "").toUpperCase(), { fontSize: 26 * u, fontWeight: "900", fill: CREAM, stroke: contorno(26 * u) });
    salida.anchor.set(0, 0.5);
    salida.position.set(26 * u, y0 + 30 * u);
    marcas.addChild(meta, salida);
  }

  /* ------------------------------------------------------------- el cielo */
  function pintarCielo(): void {
    const u = P.u;
    cieloFijo.clear();
    const franjas = [0x1d2248, 0x2d2c5e, 0x4b3b6e, 0x7b4a73, 0xb06a6a, 0xe0956a];
    franjas.forEach((c, i) => cieloFijo.rect(0, (P.h * i) / franjas.length, P.w, P.h / franjas.length + 1).fill(c));
    cieloFijo.circle(P.w * 0.82, P.h * 0.2, 46 * u).fill({ color: 0xffe9a8, alpha: 0.9 });
    const periodo = 1.4 * P.w;
    montes.forEach((m, j) => {
      m.clear();
      const base = P.h * 0.52;
      const col = [0x3a3566, 0x2d2a52][j % 2] as number;
      const picos = [0, 0.12, 0.26, 0.4, 0.55, 0.7, 0.86, 1.0];
      m.poly([0, base, ...picos.flatMap((p, i) => [p * periodo, base - (i % 2 ? 110 : 40 + hash(i, 5) * 80) * u]), periodo, base]).fill(col);
      m.rect(0, base - 1, periodo, P.h).fill(col);
    });
  }

  /* ------------------------------------------------------------------ la cinta */
  const cinta = new Container();
  const cintaG = new Graphics();
  const cursor = new Container();
  const cursorAro = new Graphics();
  const cursorCara = new Sprite();
  const cursorMascara = new Graphics();
  cursor.addChild(cursorAro, cursorCara, cursorMascara);
  cursorCara.mask = cursorMascara;
  cinta.addChild(cintaG, cursor);
  hud.addChild(cinta);
  let hudG = hudDe(P);
  let cursorDe = -1;
  let cintaXa = 0;
  let cintaXb = 1;
  function pintarCinta(): void {
    hudG = hudDe(P);
    const c = hudG.cinta;
    const u = P.u;
    cintaG.clear();
    cintaG.roundRect(c.x0 - 4 * u, c.y - 4 * u, c.x1 - c.x0 + 8 * u, c.h + 8 * u, 10 * u).fill(INK);
    const r = c.h * 0.72;
    // El camino va entre el cursor del principio y la bandera del final: el cursor nunca queda cortado en el borde.
    cintaXa = c.x0 + r * 0.8;
    cintaXb = c.x1 - c.h * 0.95 - r * 0.3;
    const ancho = cintaXb - cintaXa;
    const x0 = cintaXa;
    for (const s of d.cinta) {
      const col = TERRENO_COLOR[s.tipo === "recta" ? "recta" : (s.terreno ?? "corral")];
      const a = x0 + s.f0 * ancho, b = x0 + s.f1 * ancho;
      cintaG.rect(a, c.y, b - a, c.h).fill(col);
      const ac = TERRENO_ACENTO[s.tipo === "recta" ? "recta" : (s.terreno ?? "corral")];
      if (s.tipo === "tandas") for (let x = a + 10 * u; x < b - 6 * u; x += 16 * u) cintaG.rect(x, c.y + c.h * 0.2, 3 * u, c.h * 0.6).fill({ color: INK, alpha: 0.8 });
      else if (s.tipo === "recta") for (let j = 1; j < 4; j++) cintaG.moveTo(a, c.y + (c.h * j) / 4).lineTo(b, c.y + (c.h * j) / 4).stroke({ width: 1.5 * u, color: 0xffffff, alpha: 0.5 });
      else if (s.terreno === "barro") for (let x = a + 8 * u; x < b - 6 * u; x += 22 * u) cintaG.ellipse(x, c.y + c.h * 0.65, 8 * u, 3 * u).fill({ color: 0x3e2a1c, alpha: 0.7 });
      else if (s.terreno === "piedras") for (let x = a + 8 * u; x < b - 6 * u; x += 20 * u) cintaG.circle(x, c.y + c.h * 0.6, 4.5 * u).fill({ color: ac, alpha: 0.85 });
      else if (s.terreno === "viento") for (let y = 1; y < 4; y++) cintaG.moveTo(a + 4 * u, c.y + (c.h * y) / 4).lineTo(b - 4 * u, c.y + (c.h * y) / 4 - 2 * u).stroke({ width: 1.8 * u, color: 0xffffff, alpha: 0.7 });
      else if (s.terreno === "cuesta") cintaG.poly([a, c.y + c.h, b, c.y + c.h, b, c.y + c.h * 0.2]).fill({ color: ac, alpha: 0.6 });
      if (s.f0 > 0) cintaG.moveTo(a, c.y).lineTo(a, c.y + c.h).stroke({ width: 2 * u, color: INK });
    }
    // La bandera de la meta, a cuadros, al final.
    const bx = cintaXb + r * 0.3;
    const cuadro = c.h / 4;
    cintaG.rect(bx - 3 * u, c.y - 2 * u, 3 * u, c.h + 4 * u).fill(INK);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) cintaG.rect(bx + i * cuadro, c.y + j * cuadro, cuadro, cuadro).fill((i + j) % 2 ? INK : 0xffffff);
    cintaG.rect(bx, c.y, cuadro * 4, c.h).stroke({ width: 1.5 * u, color: INK });
    // El cursor: la cara de quien va adelante.
    cursorAro.clear().circle(0, 0, r).fill(YELLOW).stroke({ width: 3 * u, color: INK });
    cursorMascara.clear().circle(0, 0, r * 0.82).fill(0xffffff);
    cursorCara.anchor.set(0.5);
    cursorCara.width = cursorCara.height = r * 1.64;
    cursorDe = -1;
  }

  /* -------------------------------------------------------- el cartel de nombres */
  const cartel = new Container();
  const cartelFondo = new Graphics();
  const cartelTextos: Text[] = [];
  cartel.addChild(cartelFondo);
  hud.addChild(cartel);
  let cartelClave = "";
  let cartelOrden: number[] = [];
  let cartelEstados: number[] = [];
  interface OpcionesCartel {
    lado: "centro" | "izquierda";
    /** 0 normal, 1 pasó (amarillo), 2 no pasó (apagado). */
    estado?: (i: number) => 0 | 1 | 2;
  }
  function ponerCartel(ids: readonly number[], alfa: number, op: OpcionesCartel = { lado: "centro" }): void {
    cartel.visible = alfa > 0.01 && ids.length > 0;
    cartel.alpha = alfa;
    if (!cartel.visible) return;
    const clave = `${ids.join(",")}|${P.w}x${P.h}|${op.lado}`;
    if (clave !== cartelClave) {
      cartelClave = clave;
      cartelEstados = [];
      disponerCartel(ids, op.lado);
    }
    if (op.estado) {
      cartelOrden.forEach((i, j) => {
        const e = op.estado?.(i) ?? 0;
        if (cartelEstados[j] === e) return;
        cartelEstados[j] = e;
        const t = cartelTextos[j];
        if (!t) return;
        t.style.fill = e === 1 ? YELLOW : CREAM;
        t.alpha = e === 2 ? 0.4 : 1;
      });
    }
  }
  function disponerCartel(ids: readonly number[], lado: "centro" | "izquierda"): void {
    const u = P.u;
    const ordenados = alfabetico(names, ids);
    cartelOrden = ordenados;
    const izq = lado === "izquierda";
    const area = izq && P.retrato
      ? { x: P.w * 0.04 + 22 * u, y: hudG.bajo + 10 * u, w: P.w * 0.92 - 44 * u, h: Math.max(80, (P.bottom - hudG.bajo) * 0.5) }
      : izq
      ? { x: P.w * 0.02 + 22 * u, y: hudG.bajo + 10 * u, w: P.w * 0.34 - 44 * u, h: Math.max(80, P.bottom - hudG.bajo - 24 * u) }
      : { x: P.w * 0.04, y: hudG.bajo + 10 * u, w: P.w * 0.92, h: Math.max(80, P.bottom - hudG.bajo - 24 * u) };
    const minimo = minimoPx("nombre", P.w, P.h);
    let px = Math.max(nombrePx(), minimo);
    let diseno: { cols: number; filas: number; anchoCol: number; dosLineas: boolean[] } | null = null;
    for (let intento = 0; intento < 6 && !diseno; intento++) {
      const lineaH = px * 1.4;
      for (let cols = 1; cols <= 6 && !diseno; cols++) {
        const anchoCol = area.w / cols - 14 * u;
        const dos = ordenados.map((i) => ancho(names[i] ?? "", px) > anchoCol);
        const filasN = Math.ceil(ordenados.length / cols);
        let alto = 0;
        for (let c = 0; c < cols; c++) {
          let h = 0;
          for (let r = 0; r < filasN; r++) h += (dos[c * filasN + r] ? 2 : 1) * lineaH;
          alto = Math.max(alto, h);
        }
        if (alto <= area.h && dos.every((x, j) => !x || Math.max(...partirEn2(names[ordenados[j] as number] ?? "").map((l) => ancho(l, px))) <= anchoCol)) diseno = { cols, filas: filasN, anchoCol, dosLineas: dos };
      }
      if (!diseno) px = Math.max(minimo, px * 0.9);
    }
    // Si no entra de ninguna manera, en dos columnas (celular) o cuatro con los nombres partidos: nunca encimados.
    const colsRes = P.retrato ? 2 : 4;
    const dis = diseno ?? {
      cols: colsRes, filas: Math.ceil(ordenados.length / colsRes), anchoCol: area.w / colsRes - 14 * u,
      dosLineas: ordenados.map((i) => ancho(names[i] ?? "", px) > area.w / colsRes - 14 * u),
    };
    let maxW = 0;
    ordenados.forEach((i, j) => {
      const nm = names[i] ?? "";
      maxW = Math.max(maxW, dis.dosLineas[j] ? Math.max(...partirEn2(nm).map((s) => ancho(s, px))) : ancho(nm, px));
    });
    dis.anchoCol = Math.min(dis.anchoCol, maxW + 18 * u);
    while (cartelTextos.length < ordenados.length) {
      const t = S.text("", { fontSize: 20, fontWeight: "800", fill: CREAM, stroke: contorno(20) });
      t.anchor.set(0, 0.5);
      cartel.addChild(t);
      cartelTextos.push(t);
    }
    const lineaH = px * 1.4;
    let altoMax = 0;
    const ys: number[] = [];
    for (let c = 0; c < dis.cols; c++) {
      let y = 0;
      for (let r = 0; r < dis.filas; r++) {
        const j = c * dis.filas + r;
        if (j >= ordenados.length) break;
        const lineas = dis.dosLineas[j] ? 2 : 1;
        ys[j] = y + (lineas * lineaH) / 2;
        y += lineas * lineaH;
      }
      altoMax = Math.max(altoMax, y);
    }
    const ancho2 = dis.cols * dis.anchoCol + (dis.cols - 1) * 14 * u;
    const x0 = izq ? area.x : (P.w - ancho2) / 2;
    const y0 = izq ? area.y : area.y + (area.h - altoMax) / 2;
    cartelTextos.forEach((t, j) => {
      t.visible = j < ordenados.length;
      t.alpha = 1;
      t.style.fill = CREAM;
      if (!t.visible) return;
      const nombre = names[ordenados[j] as number] ?? "";
      t.style.fontSize = px;
      t.style.stroke = contorno(px);
      t.style.align = "left";
      t.text = dis.dosLineas[j] ? partirEn2(nombre).join("\n") : nombre;
      const c = Math.floor(j / dis.filas);
      t.position.set(x0 + c * (dis.anchoCol + 14 * u), y0 + (ys[j] as number));
    });
    cartelFondo.clear().roundRect(x0 - 22 * u, y0 - 18 * u, ancho2 + 44 * u, altoMax + 36 * u, 18 * u).fill({ color: INK, alpha: 0.86 }).stroke({ width: 3 * u, color: YELLOW });
  }

  /** El portón de las tandas: abierto mientras pasan, cerrado cuando las demás se echan. */
  function pintarPorton(t: number): void {
    porton.clear();
    if (!d.tandas.length) return;
    const u = P.u;
    const h = d.tandas.find((x) => t >= x.t0 - 0.3 && t < x.tFin);
    const cerrado = !!h && t >= h.tCierra;
    const ya = forma.y0 - 6 * u, yb = forma.y1 + 4 * u;
    porton.rect(gateX - 6 * u, ya - 34 * u, 12 * u, 42 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
    porton.rect(gateX - 6 * u, yb - 8 * u, 12 * u, 42 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
    if (cerrado) porton.rect(gateX - 4 * u, ya, 8 * u, yb - ya).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
    else {
      porton.rect(gateX - 4 * u, ya, 8 * u, 30 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
      porton.rect(gateX - 4 * u, yb - 30 * u, 8 * u, 30 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
    }
  }

  /* --------------------------------------------------------------- la borla */
  const borla = crearBorla();
  borlaCapa.addChild(borla);

  /* ------------------------------------------------------------- el cuadro */
  /** Una caja del cuerpo de quien corre, con el nombre: lo que no puede cortar la cámara. */
  const cuerpoDe = (p: Posicion, conNombre = false, quien?: number): Caja => {
    const w = LLAMA_LARGO * p.esc;
    const h = LLAMA_ALTO * p.esc + (conNombre ? forma.altoNombre : 0);
    // Con el nombre a la izquierda (celular), la caja también lo incluye: la cámara no lo corta.
    const izq = conNombre && quien !== undefined && p.esc === carr.esc && !carr.arriba ? (ancho(textoDe(quien, 4), nombrePx()) * 1.25 + nombrePx()) * 1.12 : 0;
    return { x: p.x + LLAMA_COLA * p.esc - izq, y: p.y - h, w: w + 6 * p.esc + izq, h };
  };

  function dibujar(t: number): void {
    const vz = cam.zoom || 1;
    pintarSuelo();
    // El cielo se mueve con la cámara, más despacio.
    const periodo = 1.4 * P.w;
    const desp = -((cam.x * 0.12) % periodo);
    montes.forEach((m, j) => {
      m.position.set(desp + j * periodo - (j === 0 ? periodo : 0), 0);
      m.alpha = 1;
    });
    // Los que se ven: las del grupo y, con tandas, las de la tanda que corre (y las que se echaron en la anterior).
    const quienes = new Set<number>(d.gente.length ? d.gente : d.lanes);
    if (d.tandas.length && t < d.tSalida) for (const h of d.tandas) if (t >= h.t0 - 0.2 && t < h.tFin + 1.3) for (const m of h.miembros) quienes.add(m);
    for (const q of [...enUso.keys()]) if (!quienes.has(q)) soltar(q);
    const nVivas = d.tiempos.echadas.length ? d.vivas(t).length : d.lanes.length;
    const nivel = nivelDe(nVivas);
    const px = nombrePx();
    const lider = d.lider(t);
    const corona = t - d.tCrown;
    // La borla y la ficha grande viajan juntas: la ficha pasa cuando la borla está por aterrizar.
    const bp = posicionBorla(t, lider);
    const duenia = bp?.duenia ?? lider;
    for (const q of quienes) {
      const c = tomar(q);
      const p = posicion(q, t);
      if (!p.visible) {
        c.raiz.visible = false;
        c.etiqueta.raiz.visible = false;
        continue;
      }
      const post = c.llama;
      c.raiz.visible = true;
      c.raiz.position.set(p.x, p.y);
      c.raiz.scale.set(p.esc);
      const lying = p.momento?.kind === "echada";
      // La que se acaba de echar queda por encima de las que pasan: la echada no se tapa.
      const reciente = lying && (p.momento?.p ?? 9) < 4;
      c.raiz.zIndex = p.y + (reciente ? 1e5 : 0);
      const ph = t * (p.velocidad > 0.5 ? 13 : 5) + c.fase;
      let momento = p.momento;
      if (corona >= 0 && q === d.campeona) {
        // Festeja: salta.
        const s = corona;
        c.raiz.position.y = p.y - Math.abs(Math.sin(s * 7)) * 20 * P.u * Math.max(0, 1 - s / 3);
        momento = null;
      }
      post.pose(ph, corona >= 0 && q !== d.campeona ? 0 : p.velocidad, momento);
      // La marca de la llama ("!", "?!") se lee desde el fondo: en la pantalla nunca mide menos que un nombre.
      if (post.marca.visible) post.marca.scale.set(Math.max(1, minimoPx("nombre", P.w, P.h) / (26 * p.esc * vz)));
      post.zz.scale.set(Math.max(1, Math.min(3, (0.016 * P.h) / (11 * p.esc * vz))));
      // La etiqueta: pegada al cuerpo.
      const et = c.etiqueta;
      const soyLider = q === duenia && !lying && t < d.tCrown + 99;
      const estilo = lying ? "echada" : soyLider ? "lider" : "normal";
      const nv: Nivel = lying ? 3 : nivel;
      ponerEtiqueta(et, textoDe(q, nv), px, estilo);
      // La ficha nunca se ve más chica que el piso del kit (16 px en el celular, el 2,6 % del alto en el proyector).
      const comp = Math.max(1, Math.min(2.2, minimoPx("nombre", P.w, P.h) / (px * vz)));
      et.raiz.scale.set(comp);
      const enCarril = t >= d.tAbre && d.lanes.includes(q);
      const arriba = enCarril ? carr.arriba : forma.arriba;
      const esc = p.esc;
      if (arriba) et.raiz.position.set(p.x + 6 * esc, p.y - (LLAMA_ALTO * esc + (et.h * comp) / 2 + 3 * P.u));
      else et.raiz.position.set(p.x + (LLAMA_COLA * esc - 4 * P.u - (et.w * comp) / 2), p.y - (LLAMA_ALTO * esc) / 3);
      et.raiz.zIndex = soyLider ? 3e6 : reciente ? 2e6 : 1e6;
      // Las que quedaron lejos de la pantalla no se dibujan.
      const dentro = p.x > cam.x - P.w / (2 * vz) - 300 && p.x < cam.x + P.w / (2 * vz) + 300;
      c.raiz.visible = dentro;
      // En el celular no hay lugar para que los nombres de todas las que se echaron queden a la vista: a los 2,5 s se va la ficha y queda la llama echada.
      const sinLugar = P.retrato && lying && (p.momento?.p ?? 0) > 5;
      et.raiz.visible = dentro && p.etiquetar !== false && !sinLugar;
    }
    pintarPorton(t);
    // La borla: pasa de una a otra (se calculó antes del bucle).
    borla.visible = !!bp && t < d.tCrown + 0.01 && (!d.tandas.length || t >= ((d.tandas[0] as Tanda).salidas[0] as number));
    if (bp) {
      borla.position.set(bp.x, bp.y);
      borla.scale.set(bp.esc);
    }
    // La cinta: el cursor lleva la cara de quien va adelante.
    const c = hudG.cinta;
    const lid = lider >= 0 ? lider : (d.lanes[0] as number);
    if (cursorDe !== lid) {
      cursorDe = lid;
      cursorCara.texture = k.figura(lid);
      cursorCara.width = cursorCara.height = c.h * 0.72 * 1.64;
    }
    cursor.position.set(cintaXa + clamp01(d.frac(t)) * (cintaXb - cintaXa), c.y + c.h / 2);
    // El cartel de los nombres: del vuelo a la salida.
    if (d.tandas.length) {
      // Con tandas: los nombres de la tanda que corre, a un costado y en orden; quien pasa se pone amarilla y las demás se apagan.
      const hi = d.tanda(t);
      const h = hi >= 0 ? (d.tandas[hi] as Tanda) : null;
      const aparece = h ? suave((t - (h.t0 - 0.05)) / 0.25) * (1 - suave((t - (h.tFin - 0.2)) / 0.25)) : 0;
      ponerCartel(h?.miembros ?? [], aparece, {
        lado: "izquierda",
        estado: (i) => (h && h.pasan.some((p2, j) => p2 === i && (h.salidas[j] as number) <= t) ? 1 : h && t >= h.tCierra && h.noPasan.includes(i) ? 2 : 0),
      });
    } else {
      // Hasta 30: todos juntos, enteros, antes de la salida.
      const aparece = suave((t - (d.tVuelo - 0.3)) / 0.4) * (1 - suave((t - (d.tSalida - 0.15)) / 0.3));
      // Con 12 o menos, el cartel va a un costado (en el proyector) y no tapa al grupo.
      ponerCartel(d.names.map((_, i) => i), aparece, { lado: !P.retrato && d.gente.length <= 12 ? "izquierda" : "centro" });
    }
  }

  /** Dónde va la borla: sobre el lomo de quien va adelante, o volando de una a otra. */
  function posicionBorla(t: number, lider: number): { x: number; y: number; esc: number; duenia: number } | null {
    if (lider < 0) return null;
    const sobre = (q: number): { x: number; y: number; esc: number; duenia: number } => {
      const p = posicion(q, t);
      return { x: p.x - 2 * p.esc, y: p.y - 70 * p.esc, esc: Math.max(p.esc * 1.25, 0.8 * P.u), duenia: q };
    };
    const antes = d.lider(t - 0.45);
    if (antes < 0 || antes === lider || t - 0.45 < d.tSalida) return sobre(lider);
    let a = t - 0.45, b = t;
    for (let i = 0; i < 6; i++) {
      const m = (a + b) / 2;
      if (d.lider(m) === lider) b = m;
      else a = m;
    }
    const e = ease((t - b) / 0.45);
    const A = sobre(antes), B = sobre(lider);
    return { x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e) - Math.sin(Math.PI * e) * 46 * P.u, esc: lerp(A.esc, B.esc, e), duenia: e < 0.55 ? antes : lider };
  }

  /* ---------------------------------------------------------------- cámara */
  const camX = (t: number): number => xFrente(t) - (forma.ancla - P.w / 2);
  const vistaCorral: () => { x: number; y: number; z: number } = () => ({ x: camX(d.tSalida), y: P.h / 2, z: 1 });
  /** Con tandas: el portón a 0,7 del ancho, la tanda que espera a la izquierda del portón y el corral a la derecha (los nombres, en el costado izquierdo). */
  const vistaTanda = (): { x: number; y: number; z: number } => (P.retrato ? { x: gateX + 0.05 * P.w, y: P.h / 2, z: 0.52 } : { x: gateX - 0.2 * P.w, y: P.h / 2, z: 1 });
  function vistaPresentacion(t: number) {
    const v = d.tandas.length ? vistaTanda() : vistaCorral();
    const e = ease(t / d.tVuelo);
    const xA = metaX - 0.3 * P.w;
    return { x: lerp(xA, v.x, e), y: P.h / 2, z: lerp(0.62, 1, e) };
  }
  function vistaGrupo(t: number) {
    return { x: camX(t), y: P.h / 2, z: 1 };
  }
  /** Los cuerpos (y sus nombres) de las ocho en la recta. */
  function cajaDeLasOcho(t: number, solo?: readonly number[]): Caja[] {
    const quienes = solo ?? d.lanes;
    return quienes.map((q) => cuerpoDe(posicion(q, Math.max(t, d.tAbre)), true, q));
  }
  function cajaCarriles(t: number): Caja {
    const cajas = cajaDeLasOcho(t);
    const x0 = Math.min(...cajas.map((c) => c.x)) - 24 * P.u;
    const x1 = Math.max(...cajas.map((c) => c.x + c.w)) + 24 * P.u;
    const ancho = Math.max(x1 - x0, 0.55 * P.w);
    return { x: x0 + (x1 - x0) / 2 - ancho / 2, y: carr.y0 - forma.altoNombre, w: ancho, h: carr.y1 - carr.y0 + forma.altoNombre + 16 * P.u };
  }
  function cajasDelFrente(t: number): Caja[] {
    const t2 = Math.max(t, d.tAbre);
    // En el celular entran las ocho: con el nombre a la izquierda, las de atrás se cortaban contra el borde.
    const orden = P.retrato ? d.lanes : d.vivas(t2).slice(0, 3);
    const cajas = cajaDeLasOcho(t2, orden);
    const m = { x: metaX - 30 * P.u, y: carr.y0 - 40 * P.u, w: 60 * P.u, h: carr.y1 - carr.y0 + 50 * P.u };
    return metaCerca(t2) ? [...cajas, m] : cajas;
  }
  const metaCerca = (t: number): boolean => d.frac(t) >= 0.86;
  function meta(): Caja {
    return { x: metaX - 100 * P.u, y: carr.y0 - 130 * P.u, w: 140 * P.u, h: carr.y1 - carr.y0 + 150 * P.u };
  }
  function zona(): Zona {
    return { x0: 0, y0: hudG.bajo, x1: P.w, y1: P.bottom };
  }
  function caja(_t: number): Caja | null {
    return null;
  }
  function foco(): FocoPunto {
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p);
    const s = cam.toScreen(c.x + c.w / 2, c.y + c.h * 0.55, P.w, P.h);
    const z = cam.zoom || 1;
    return { x: s.x, y: s.y, r: Math.max(c.w, c.h) * 0.6 * z, color: colorDeNombre(names[d.campeona] ?? "") };
  }
  function protegida(): { caja: Caja; zona: Zona } | null {
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p, true);
    return { caja: { x: c.x, y: c.y + c.h * 0.2, w: c.w, h: c.h * 0.8 }, zona: { x0: 8 * P.u, y0: S.placaBajo(k.ganadores.length) + 4 * P.u, x1: P.w - 8 * P.u, y1: P.bottom } };
  }

  /* -------------------------------------------------------------- reconstruir */
  function reconstruir(): void {
    medirGeometria();
    cache.clear();
    corralMemo.clear();
    for (const c of enUso.values()) c.etiqueta.clave = "";
    pintarCielo();
    pintarMarcas();
    pintarCinta();
    cartelClave = "";
  }
  reconstruir();

  const escena: EscenaCarrera & { rebuild(): void; draw(t: number): void } = {
    rebuild: reconstruir,
    draw: dibujar,
    vistaPresentacion,
    vistaGrupo,
    cajaCarriles,
    cajasDelFrente,
    caja,
    zona,
    meta,
    foco,
    protegida,
  };
  return escena;
}

/** Parte un nombre en dos líneas por el espacio más cercano al medio. */
function partirEn2(nombre: string): string[] {
  const p = nombre.split(" ");
  if (p.length < 2) return [nombre];
  let mejor = 1, dif = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p.slice(0, i).join(" ").length, b = p.slice(i).join(" ").length;
    if (Math.abs(a - b) < dif) {
      dif = Math.abs(a - b);
      mejor = i;
    }
  }
  return [p.slice(0, mejor).join(" "), p.slice(mejor).join(" ")];
}

export type Escena = ReturnType<typeof crearEscena>;

export const carreraPixi = crearJuego<Datos, Escena>({
  id: "race",
  textos: TEXTOS_CARRERA,
  plan: planCarrera,
  arma(k, plan, previa) {
    if (!previa) return crearEscena(k, plan.datos);
    previa.rebuild();
    return previa;
  },
  cuadro(_k, _plan, escena, t) {
    escena.draw(t);
  },
});
