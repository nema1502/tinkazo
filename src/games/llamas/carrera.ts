import { Container, Graphics, Sprite, Text } from "pixi.js";
import { params } from "../../state";
import { colorDeNombre } from "../pixi/foco-vista";
import { crearJuego, minimoPx, nivelPorCantidad, planNombres, type Caja, type DefJuego, type FocoPunto, type Kit, type Nivel, type Zona } from "../pixi/kit";
import { anfitrionTinkazo } from "../pixi/kit/anfitrion";
import { CREAM, INK, YELLOW, contorno, hash, mountPixi } from "../pixi/stage";
import type { Borla3D, Corredora3D, Efecto3D, Fabrica3D, Geometria3D, Valla3D, Vista3D, ZonaSuelo } from "./carrera-3d-mapa";
import { ECHADA_DUR, carrilesDe, formaDe, hudDe, type Carriles, type Forma, type Pantalla } from "./carrera-forma";
import { cajaVisible, cajaVisual, primerPlanoHorizontal } from "./carrera-zoom-final";
import { ENSANCHE, SALTO_MEDIO } from "./carrera-obstaculos";
import { RECTA, alfabetico, planCarrera, type Datos, type EscenaCarrera } from "./carrera-show";
import { pisaA, metida, sitioLibre, RENGLONES_MAX, type CajaF } from "./carrera-fichas";
import { crearLlamaAguayo } from "./llama-aguayo";
import { TEXTOS_CARRERA } from "./carrera-textos";
import type { Tanda } from "./carrera-tandas";
import type { Terreno } from "./carrera-tiempos";
import { BORLA_RADIO, LLAMA_ALTO, LLAMA_COLA, LLAMA_HOCICO, LLAMA_LARGO, PELAJES, crearBorla, crearLlama, crearManta, type Llama, type Momento } from "./llama";

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

/** Dónde va la primera en la pantalla en la carrera nueva, en fracción del ancho (entre 0,62 y 0,82 según corre). */
const AIRE = 0.72;
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
  /** El rótulo "ADELANTE" pegado a la izquierda de la ficha de quien va primera (celular): una palabra que contesta la pregunta sin mirar la raya. */
  rotulo: Container;
  rotuloTexto: Text;
  rotuloFondo: Graphics;
  /** Cuánto sobresale el rótulo a la izquierda de la ficha, en el espacio de la ficha (0 si no se muestra). */
  rotuloW: number;
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
  /** Cuánto se levanta del piso (el salto de la valla), en píxeles. */
  alza?: number;
}

function crearEscena(k: Kit, d: Datos, fabrica3d: Fabrica3D | null = null) {
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
  // La raya del frente (carrera nueva): una línea de luz en el hocico de la primera, debajo de las llamas.
  const raya = new Graphics();
  // Las estelas (carrera nueva): rayitas de velocidad detrás de cada llama que corre, para que se lea hacia dónde van sin leer.
  const estelas = new Graphics();
  // Los obstáculos de la recta (`carrera-obstaculos.ts`): piedras que caen y viento, debajo de las llamas. La valla es fija y va en las marcas.
  const obstaculosG = new Graphics();
  const corredoras = new Container();
  corredoras.sortableChildren = true;
  const borlaCapa = new Container();
  const etiquetas = new Container();
  // Las fichas se ordenan: la amarilla de quien va adelante arriba de todas, y la de quien se acaba de echar arriba de las comunes.
  etiquetas.sortableChildren = true;
  mundo.addChild(suelo, marcas, porton, raya, estelas, obstaculosG, corredoras, borlaCapa, etiquetas);
  S.scene.addChild(mundo);
  const hud = new Container();
  S.hud.addChild(hud);

  /** Los momentos de la recta que miran el auditor y las fotos del prototipo 3D. */
const HORAS_Q = [0.25, 0.5, 0.7, 0.88, 1];
/** Cuántas de las que cruzan detrás de quien gana protege la cámara debajo del cartel, además de ella: con más, el golpe no llega a su acercamiento (`audit-emocion`). */
const PROTEGE_DETRAS = 1;

/** El prototipo 3D (`?motor=3d`, carrera-3d.ts): si está, dibuja el estadio y las llamas; las fichas, la cinta y el cartel siguen siendo de acá. */
  let tres: Vista3D | null = null;

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
    const rotulo = new Container();
    const rotuloFondo = new Graphics();
    const rotuloTexto = S.text("", { fontSize: 12, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 2, join: "round" } });
    rotuloTexto.anchor.set(0.5);
    rotulo.addChild(rotuloFondo, rotuloTexto);
    rotulo.visible = false;
    raiz.addChild(fondo, texto, rotulo);
    return { raiz, fondo, texto, rotulo, rotuloTexto, rotuloFondo, rotuloW: 0, w: 0, h: 0, clave: "" };
  }
  function ponerEtiqueta(e: Etiqueta, s: string, px: number, estilo: "normal" | "lider" | "echada"): void {
    const clave = `${s}|${px.toFixed(1)}|${estilo}`;
    if (e.clave === clave) return;
    const conRotulo = d.nueva && P.retrato && estilo === "lider";
    e.clave = clave;
    const fs = estilo === "lider" ? px * 1.25 : px;
    e.texto.style.fontSize = fs;
    e.texto.style.fill = estilo === "lider" ? INK : CREAM;
    // La ficha amarilla lleva letra de tinta sin borde oscuro, en las dos carreras: tinta sobre amarillo ya tiene contraste
    // de sobra, y un borde de tinta sobre la tinta engorda las letras hasta que el nombre se vuelve una mancha que no se lee.
    // El trazo amarillo, del color de la ficha, no se ve: deja la letra tal cual.
    e.texto.style.stroke = estilo === "lider" ? { color: YELLOW, width: 1, join: "round" } : contorno(fs);
    e.texto.text = s;
    const w = e.texto.width + fs * 0.5;
    // La ficha amarilla tiene más aire arriba y abajo: la letra queda rodeada de amarillo y no del borde de tinta.
    const h = fs * (estilo === "lider" ? 1.6 : 1.28);
    e.w = w;
    e.h = h;
    e.texto.position.set(0, 0);
    e.fondo.clear();
    if (estilo === "lider") e.fondo.roundRect(-w / 2 + 3, -h / 2 + 3, w, h, h * 0.3).fill(INK).roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill(YELLOW).stroke({ width: Math.max(2, fs / 9), color: INK });
    else e.fondo.roundRect(-w / 2, -h / 2, w, h, h * 0.3).fill({ color: estilo === "echada" ? 0x3a3a46 : INK, alpha: estilo === "echada" ? 0.78 : 0.62 });
    // En el celular las llamas son chicas y las filas se apilan: la de adelante lleva la palabra pegada a su ficha, además de la raya y la manta.
    e.rotulo.visible = conRotulo;
    e.rotuloW = 0;
    if (conRotulo) {
      const rf = fs * 0.8;
      e.rotuloTexto.style.fontSize = rf;
      e.rotuloTexto.text = k.txt("carRotuloPunta");
      const rw = e.rotuloTexto.width + rf * 0.9, rh = rf * 1.35;
      e.rotuloFondo.clear().roundRect(-rw / 2, -rh / 2, rw, rh, rh * 0.3).fill(INK);
      e.rotulo.position.set(-w / 2 - rw / 2 + 3, 0);
      e.rotuloW = rw - 3;
    }
  }

  /* ------------------------------------------------------------ corredoras */
  const enUso = new Map<number, Corredora>();
  function tomar(persona: number): Corredora {
    let c = enUso.get(persona);
    if (c) return c;
    // La carrera nueva dibuja la llama de aguayo (la B del diseño); la de siempre, la de lana.
    const llama = (d.nueva ? crearLlamaAguayo : crearLlama)(S, { pelaje: PELAJES[persona % PELAJES.length] ?? 0xf3ead8, manta: S.color(persona) });
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
  /**
   * La carrera nueva: la x de cada una es su distancia de verdad (el puntaje de `orden`, en cuerpos) y su fila es la que tiene al salir
   * y no cambia en toda la carrera. Una se escapa, la alcanzan y la pasan por al lado: nada se salta de un casillero a otro.
   */
  const genteSet = new Set(d.gente);
  /** Cuántos píxeles vale una unidad de puntaje: dos de la misma fila nunca se pisan el nombre, y todo el grupo entra detrás de la primera. */
  const pxPorPuntaje = (): number => {
    const sobra = forma.arriba ? nombreW / 2 + forma.largo / 2 : nombreW + forma.largo;
    const largoGrupo = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos + 3;
    return Math.min(forma.ancho / (forma.filas * d.orden.entrePuestos), (AIRE * P.w - sobra - 0.04 * P.w) / largoGrupo);
  };
  /**
   * La fila de cada una: la del puesto con que sale, pero con las filas intercaladas (arriba, abajo, arriba...) para que la salida sea un
   * pelotón y no una escalera. Dos de la misma fila siguen a `filas` puestos una de otra: los nombres no se pisan.
   */
  const filaDe = (persona: number): number => {
    const n = forma.filas;
    const r = d.orden.rango(persona) % n;
    const mitad = Math.ceil(n / 2);
    return r % 2 === 0 ? r / 2 : Math.min(n - 1, mitad + (r - 1) / 2);
  };
  /** Dónde está el frente del grupo, en puntaje: la media de la última décima de las que siguen, así que no salta cuando la primera se echa. */
  const frenteMemo = new Map<number, number>();
  function sFrente(t: number): number {
    const clave = Math.round(t * 1000);
    const dado = frenteMemo.get(clave);
    if (dado !== undefined) return dado;
    let suma = 0, cuantas = 0;
    for (let j = 0; j < 10; j++) {
      const tt = Math.max(d.tSalida, t - j * 0.1);
      let mejor = -Infinity;
      for (const g of d.gente) if ((d.tiempos.cae.get(g) ?? Infinity) > tt) mejor = Math.max(mejor, d.orden.puntaje(g, tt));
      if (Number.isFinite(mejor)) {
        suma += mejor;
        cuantas++;
      }
    }
    const v = cuantas ? suma / cuantas : 0;
    if (frenteMemo.size > 4000) frenteMemo.clear();
    frenteMemo.set(clave, v);
    return v;
  }
  function lugarEnGrupoNuevo(persona: number, t: number): { x: number; y: number } | null {
    if (!genteSet.has(persona)) return null;
    const tt = Math.max(d.tSalida, t);
    return { x: xFrente(t) + (d.orden.puntaje(persona, tt) - sFrente(tt)) * pxPorPuntaje(), y: forma.yPie(filaDe(persona)) };
  }
  /** Dónde va quien está en el grupo en `t`: la media de los últimos instantes, así un cambio de puesto es un deslizamiento. */
  function lugarEnGrupo(persona: number, t: number): { x: number; y: number } | null {
    if (d.nueva) return lugarEnGrupoNuevo(persona, t);
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
    const xl = Xs + (qq + (pq - qq) * ENSANCHE) * RECTA * P.w;
    // La ráfaga corre a un grupo de carriles hacia un costado; la valla levanta a quien la salta (ambas del plan, `carrera-obstaculos.ts`).
    const yl = carr.yPie(carril) + (d.final.lateral?.(carril, qq) ?? 0) * carr.altoFila;
    const alza = (d.final.salto?.(carril, qq) ?? 0) * carr.altoFila;
    const e = fraccionMovida(t);
    const m = d.final.beatOf(carril, qq);
    if (e >= 1) return { x: xl, y: yl, esc: carr.esc, velocidad: m?.kind === "plantada" ? 0 : 1.2, momento: m, visible: true, alza };
    const lg = lugarEnGrupo(persona, d.tAbre - 0.001) ?? { x: Xs, y: yl };
    const xg = lg.x + RECTA * P.w * qq;
    return { x: lerp(xg, xl, e), y: lerp(lg.y, yl, e), esc: lerp(forma.esc, carr.esc, e), velocidad: 1.1, momento: m, visible: true };
  }

  /* ------------------------------------------------------------ los obstáculos */
  /** Dónde está en el mundo el carril `kk` cuando la recta va en `q` (la misma cuenta que `posicion`). */
  const xCarril = (kk: number, q: number): number => Xs + (q + (d.final.pos(kk, q) - q) * ENSANCHE) * RECTA * P.w;
  /** Las vallas del plan, en el mundo: cruzan los carriles de la final. */
  function vallasDelPlan(): Valla3D[] {
    return (d.final.obstaculos ?? []).filter((o) => o.tipo === "salto").map((o) => ({ x: Xs + o.valla * RECTA * P.w, y0: carr.y0, y1: carr.y1, alto: 0.34 * carr.altoFila }));
  }
  /** Las piedras y la ráfaga que están pasando en `t`, tal como las ve el 2D y las dibuja el 3D. */
  function efectosEn(t: number): Efecto3D[] {
    const obs = d.final.obstaculos;
    if (!obs?.length || t < d.tAbre || t > d.tCrown) return [];
    const qq = d.q(t);
    const out: Efecto3D[] = [];
    obs.forEach((o, id) => {
      if (o.tipo === "piedras") {
        const qa = o.q - 0.05, qf = o.q + 0.1;
        if (qq < qa || qq > qf) return;
        const kk = o.carriles[0] as number;
        out.push({ tipo: "piedras", s: (qq - qa) / (qf - qa), x: xCarril(kk, o.q + 0.004) + (LLAMA_HOCICO + 30) * carr.esc, y: carr.yPie(kk), y1: 0, ancho: 0, lado: 0, id });
      } else if (o.tipo === "viento") {
        const qa = o.q - 0.02, qf = o.q + o.dur * 1.7;
        if (qq < qa || qq > qf) return;
        const xs = o.carriles.map((kk) => xCarril(kk, qq));
        out.push({ tipo: "viento", s: (qq - qa) / (qf - qa), x: xs.reduce((a, b) => a + b, 0) / xs.length, y: carr.yPie(Math.min(...o.carriles)), y1: carr.yPie(Math.max(...o.carriles)), ancho: 0.55 * P.w, lado: o.lado, id });
      }
    });
    return out;
  }
  /** Las personas a las que les está pasando algo en `t` (la piedra, la que salta mal, el grupo de la ráfaga): el director las incluye en el plano. */
  function enApuros(t: number): number[] {
    const obs = d.final.obstaculos;
    if (!obs?.length) return [];
    const qq = d.q(Math.max(t, d.tAbre));
    const out = new Set<number>();
    for (const o of obs) {
      if (o.tipo === "piedras") {
        if (qq > o.q - 0.03 && qq < o.q + 0.09) out.add(d.lanes[o.carriles[0] as number] as number);
      } else if (o.tipo === "salto") {
        for (const m of o.malas) if (qq > (o.llegan[m] as number) - 0.02 && qq < (o.llegan[m] as number) + 0.08) out.add(d.lanes[m] as number);
      } else if (qq > o.q - 0.01 && qq < o.q + o.dur * 1.4) for (const kk of o.carriles) out.add(d.lanes[kk] as number);
    }
    return [...out];
  }
  /** Una roca de seis puntas, irregular según `h`, centrada en (x, y). */
  const roca = (x: number, y: number, r: number, h: number, giro: number): number[] => {
    const pts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const a = giro + (i / 6) * Math.PI * 2;
      const rr = r * (0.72 + 0.4 * hash(i + 3, Math.floor(h * 97)));
      pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.82);
    }
    return pts;
  };
  function pintarObstaculos(t: number): void {
    obstaculosG.clear();
    const ef = efectosEn(t);
    if (!ef.length) return;
    const u = P.u;
    for (const f of ef) {
      const env = Math.sin(Math.PI * Math.min(1, f.s));
      if (f.tipo === "piedras") {
        for (let j = 0; j < 5; j++) {
          const dx = j === 0 ? 0 : (hash(f.id * 7 + j, 3) - 0.5) * 150 * u;
          const dy = j === 0 ? 0 : (hash(f.id * 5 + j, 9) - 0.5) * carr.altoFila * 0.7;
          const retraso = j === 0 ? 0 : hash(f.id * 3 + j, 1) * 0.06;
          const w = (f.s - retraso) / 0.3;
          if (w < 0) continue;
          const gx = f.x + dx, gy = f.y + dy;
          const r = (j === 0 ? 17 : 9 + 6 * hash(f.id + j, 2)) * u;
          if (w < 1) {
            // Cae del cerro: viene de arriba y de atrás, con su sombra creciendo en el piso.
            obstaculosG.ellipse(gx, gy, r * (0.5 + w), r * 0.3 * (0.5 + w)).fill({ color: 0x000000, alpha: 0.3 * w });
            obstaculosG.poly(roca(gx - (1 - w * w) * 70 * u, gy - (1 - w * w) * 430 * u, r, hash(f.id, j), w * 9)).fill(0x8d8478).stroke({ width: 2 * u, color: INK });
          } else {
            const v = (f.s - retraso - 0.3) / 0.45;
            if (v > 1) continue;
            const rebote = Math.abs(Math.sin(v * Math.PI * 2.6)) * Math.exp(-v * 3.2) * 36 * u;
            obstaculosG.ellipse(gx + v * 46 * u, gy, r, r * 0.3).fill({ color: 0x000000, alpha: 0.25 * (1 - v) });
            obstaculosG.poly(roca(gx + v * 46 * u, gy - rebote - r * 0.3, r, hash(f.id, j), v * 12)).fill(0x8d8478).stroke({ width: 2 * u, color: INK });
            if (v < 0.5) for (let i = 0; i < 4; i++) obstaculosG.circle(gx + (i - 1.5) * 18 * u, gy - 8 * u - v * 30 * u * (1 + (i % 2)), (9 + 36 * v) * u).fill({ color: 0xd9cdb4, alpha: 0.5 * (1 - v * 2) });
          }
        }
      } else {
        const yTop = f.y - carr.altoFila * 0.85, yBot = f.y1 + carr.altoFila * 0.15;
        for (let i = 0; i < 16; i++) {
          const yy = yTop + hash(f.id * 11 + i, 4) * (yBot - yTop);
          const fase = (hash(f.id * 13 + i, 6) + f.s * 2.6) % 1;
          const xx = f.x - f.ancho / 2 + fase * f.ancho;
          const largo = (60 + 90 * hash(f.id + i, 8)) * u;
          obstaculosG.moveTo(xx, yy + f.lado * fase * 14 * u).lineTo(xx + largo, yy + f.lado * (fase * 14 + 6) * u).stroke({ width: 2.4 * u, color: 0xffffff, alpha: 0.65 * env, cap: "round" });
        }
        for (let i = 0; i < 10; i++) {
          const yy = yTop + hash(f.id * 17 + i, 5) * (yBot - yTop);
          const fase = (hash(f.id * 19 + i, 7) + f.s * 1.8) % 1;
          const xx = f.x - f.ancho / 2 + fase * f.ancho;
          obstaculosG.poly(roca(xx, yy - Math.sin(fase * Math.PI) * 40 * u, 5 * u, hash(i, f.id), fase * 14)).fill({ color: i % 3 ? 0x6fae4a : 0xc9b27a, alpha: 0.85 * env });
        }
      }
    }
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
  /** El rótulo META y dónde lo deja la pista: el cuadro lo corre hacia adentro de la pantalla (`acomodarMeta`). */
  let metaTxt: Text | null = null;
  /** El letrero SALIDA, en el mundo: las fichas de nombre no se le ponen encima mientras esté a la vista. */
  let salidaTxt: Text | null = null;
  let metaBase = { x: 0, y: 0 };
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
        g.circle(Xs, y - 34 * u, 7 * u).fill(d.nueva ? CREAM : YELLOW).stroke({ width: 2.5 * u, color: INK });
      }
    }
    // Las vallas del salto: una cerca baja de lado a lado de los carriles, con rayas, y un poste en cada raya de carril.
    for (const v of vallasDelPlan()) {
      const largo = v.y1 - v.y0;
      g.roundRect(v.x - 5 * u, v.y0, 10 * u, largo, 4 * u).fill(0x8a6238).stroke({ width: 2 * u, color: INK });
      for (let y = v.y0, i = 0; y < v.y1; y += 20 * u, i++) if (i % 2) g.rect(v.x - 5 * u, y, 10 * u, Math.min(20 * u, v.y1 - y)).fill(0xe8e2d4);
      for (let j = 0; j <= carr.n; j++) g.circle(v.x, v.y0 + j * carr.altoFila, 9 * u).fill(0x6b4a2c).stroke({ width: 2 * u, color: INK });
      g.rect(v.x - SALTO_MEDIO * RECTA * P.w, v.y0, 2 * SALTO_MEDIO * RECTA * P.w, largo).fill({ color: 0xffffff, alpha: 0.07 });
    }
    // En la carrera nueva el arco de la meta baja al borde de la pista: arriba quedaba debajo de la cabecera y se cortaba.
    const bajaMeta = d.nueva ? 88 * u : 0;
    g.roundRect(pm - 90 * u, y0 - 100 * u + bajaMeta, 180 * u, 38 * u, 8 * u).fill(0xffffff).stroke({ width: 3 * u, color: INK });
    for (let i = 0; i < 9; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2 === 0) g.rect(pm - 90 * u + i * 20 * u, y0 - 100 * u + bajaMeta + j * 19 * u, 20 * u, 19 * u).fill(INK);
    marcas.addChild(g);
    const meta = S.text(k.txt("carRotuloMeta"), { fontSize: 34 * u, fontWeight: "900", fill: YELLOW, stroke: contorno(34 * u) });
    meta.anchor.set(0.5);
    // En la nueva, la palabra va al costado del arco: debajo quedaba la ganadora cruzando y la tapaba.
    // En el celular no hay lugar a la derecha del arco: la palabra va a su izquierda.
    if (d.nueva) meta.anchor.set(P.retrato ? 1 : 0, 0.5);
    metaBase = { x: d.nueva ? pm + (P.retrato ? -98 : 98) * u : pm, y: d.nueva ? y0 - 100 * u + bajaMeta + 19 * u : y0 - 118 * u };
    meta.position.set(metaBase.x, metaBase.y);
    metaTxt = meta;
    const salida = S.text(k.txt("carSalida").replace(/[¡!]/g, "").toUpperCase(), { fontSize: 26 * u, fontWeight: "900", fill: CREAM, stroke: contorno(26 * u) });
    salida.anchor.set(0, 0.5);
    salida.position.set(26 * u, y0 + 30 * u);
    salidaTxt = salida;
    marcas.addChild(meta, salida);
  }

  /**
   * META entera y a la vista: si su lugar en la pista cae debajo de la cabecera (el medallón de la cinta) o pegado a un borde, se corre
   * hacia adentro de lo que se ve; si habría que correrla más de cuatro veces su alto (la cámara se fue lejos), o ya cayó el golpe (el cartel de quien gana le tapa el lugar), se calla.
   */
  function acomodarMeta(t: number): void {
    const m = metaTxt;
    if (!m || m.destroyed) return;
    const lim = limites();
    // El medallón de la cinta cuelga más abajo que la cinta: META queda debajo de él, no detrás.
    const c = hudG.cinta;
    lim.y0 = Math.max(lim.y0, S.scene.pivot.y + (c.y + c.h / 2 + c.h * 0.72 + 5 * P.u - S.scene.position.y) / (S.scene.scale.x || 1));
    const w = m.width, h = m.height;
    const ax = m.anchor.x;
    m.visible = t < d.tCrown;
    if (!m.visible) return;
    // Todavía no entró (o ya salió) por el costado: es el mundo que pasa, no hay nada que acomodar.
    const cx = metaBase.x + (0.5 - ax) * w;
    if (cx < lim.x0 || cx > lim.x1 || w > lim.x1 - lim.x0) {
      m.position.set(metaBase.x, metaBase.y);
      return;
    }
    const izq = Math.min(Math.max(metaBase.x - ax * w, lim.x0), lim.x1 - w);
    const arriba = Math.min(Math.max(metaBase.y - h / 2, lim.y0), lim.y1 - h);
    if (Math.abs(arriba - (metaBase.y - h / 2)) > 4 * h) {
      m.visible = false;
      return;
    }
    m.position.set(izq + ax * w, arriba + h / 2);
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

  /** La dueña de la ficha amarilla y de la manta (`Datos.duena`): en la carrera nueva no parpadea en el acordeón. */
  const estable = (t: number): number => d.duena(t);

  /* ------------------------------------------------------------ la raya del frente */
  /**
   * La raya del frente (carrera nueva): una línea de luz amarilla en el hocico de la que va primera, de lado a lado de la pista.
   * Contesta cuánto le falta a cada una para alcanzarla y el instante en que la pasan. Sigue al hocico más adelantado de las que
   * corren, así que no salta: cuando dos se cruzan, la raya ya está en las dos.
   */
  let rayaX = 0;
  function pintarRaya(t: number): void {
    raya.clear();
    if (t < d.tSalida + 0.3 || t >= d.tCrown) return;
    const u = P.u;
    const vz = cam.zoom || 1;
    const y0 = (t >= d.tAbre ? carr.y0 : forma.y0) - 10 * u, y1 = (t >= d.tAbre ? carr.y1 : forma.y1) + 6 * u;
    const ancho = Math.max(3 * u, 3.2 / vz);
    raya.rect(rayaX - ancho * 3, y0, ancho * 6, y1 - y0).fill({ color: YELLOW, alpha: 0.2 });
    raya.rect(rayaX - ancho / 2, y0, ancho, y1 - y0).fill({ color: YELLOW, alpha: 0.95 });
    // Tres flechas a la derecha sobre la raya: la línea es vertical, y sin ellas una pantalla alta (el celular) parece correr hacia arriba.
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const y = y0 + (y1 - y0) * f;
      raya.poly([rayaX - 4 * u, y - 12 * u, rayaX + 18 * u, y, rayaX - 4 * u, y + 12 * u]).fill(YELLOW).stroke({ width: 2 * u, color: INK, join: "round" });
    }
  }

  /* --------------------------------------------------------------- la borla */
  // La carrera nueva cambia la borla por la manta amarilla en el lomo de quien va adelante (no tapa su cara) y la raya del frente.
  const borla: Container = d.nueva ? crearManta() : crearBorla();
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

  interface Ficha {
    q: number;
    c: Corredora;
    p: Posicion;
    estilo: "normal" | "lider" | "echada";
    nv: Nivel;
    arriba: boolean;
    comp: number;
    esc: number;
    soyLider: boolean;
  }
  /** Dónde va la ficha de una: arriba de la cabeza (proyector) o a la izquierda del cuerpo (celular), sin salirse de la pantalla ni meterse bajo la cabecera. */
  function ubicarFicha(et: Etiqueta, p: Posicion, arriba: boolean, comp: number, vz: number, lider = false): void {
    const esc = p.esc;
    let x: number, y: number;
    if (arriba) {
      x = p.x + 6 * esc;
      y = p.y - (LLAMA_ALTO * esc + (et.h * comp) / 2 + 3 * P.u);
    } else {
      x = p.x + (LLAMA_COLA * esc - 4 * P.u - (et.w * comp) / 2);
      y = p.y - (LLAMA_ALTO * esc) / 3;
      // La ficha amarilla es más grande, con sombra y borde, y la manta de quien va adelante flamea por detrás de la cola:
      // se corre hacia atrás lo que sobra, para que no tape el cuerpo ni se pegue a la manta.
      if (d.nueva && lider) x -= 8 * esc + 3 * P.u + 5 * comp;
    }
    // Ni debajo de la cabecera (la ficha amarilla es más alta que lo que se reservó).
    const arribaMin = limites().y0 + (et.h * comp) / 2;
    if (y < arribaMin) y = arribaMin;
    et.raiz.position.set(x, y);
  }
  /**
   * Lo que la pantalla deja ver del mundo, en coordenadas del mundo: debajo de la cabecera y encima del relator, sin pegarse a los bordes.
   * Se mide con lo que la cámara aplicó de verdad a la escena (`scene`: su acercamiento incluye el golpe y el de la emoción, que
   * `cam.zoom` no trae), no con la meta de la cámara.
   */
  /** Desde que cae el golpe las fichas no pasan de la parte de abajo del cartel de quien gana: los nombres de las que llegan detrás no quedan debajo de él. */
  function pisoDeFichas(): number {
    return k.coronado ? S.placaBajo(k.ganadores.length) + 4 * P.u : 0;
  }
  function limites(): CajaF {
    const sc = S.scene;
    const z = sc.scale.x || 1;
    const x = (px: number): number => sc.pivot.x + (px - sc.position.x) / z;
    const y = (py: number): number => sc.pivot.y + (py - sc.position.y) / z;
    return { x0: x(4 * P.u), x1: x(P.w - 4 * P.u), y0: y(Math.max(hudG.bajo + 3 * P.u, pisoDeFichas())), y1: y(P.bottom) };
  }
  /** Cuánto dura en pantalla la línea del relator que nombra a una (la echada, el cambio de punta). */
  const NOMBRADA_DUR = 2.5;
  /** Las que el relator nombra en `t`: su ficha no puede quedar tapada. */
  function nombradas(t: number): Set<number> {
    const s = new Set<number>();
    for (const e of d.tiempos.echadas) if (t >= e.t && t < e.t + NOMBRADA_DUR) s.add(e.quien);
    for (const c of d.cambiosDePunta) if (t >= c.t && t < c.t + NOMBRADA_DUR) s.add(c.quien);
    return s;
  }
  /**
   * Las fichas no se pisan, en las dos carreras. Se ubican de la que más manda a la que menos: la que el relator nombra ahora,
   * la amarilla, las que se echaron y después el resto, de adelante hacia atrás. La que pisa a una ya puesta (más del 10 % de la
   * más chica) pasa a un nombre más corto (solo la carrera nueva) y, si todavía pisa, se corre un renglón arriba o abajo, alternando,
   * sin irse más de dos renglones de su llama. Si no cabe, se calla ese cuadro. Una ficha que no entra entera en la pantalla se
   * corre hacia adentro, o se calla: nunca sale cortada. Es una función del cuadro, sin azar.
   */
  function resolverFichas(fichas: Ficha[], px: number, vz: number, nombrados: ReadonlySet<number>): void {
    const puestas: CajaF[] = [];
    const lim = limites();
    // El letrero SALIDA cuenta como una caja ya puesta mientras se ve: las fichas lo pisaban y quedaba «SALI» con un nombre encima.
    const sal = salidaTxt;
    if (sal && !sal.destroyed && marcas.visible && sal.visible) {
      const w = sal.width, h = sal.height;
      const c = { x0: sal.x - sal.anchor.x * w, y0: sal.y - sal.anchor.y * h, x1: sal.x + (1 - sal.anchor.x) * w, y1: sal.y + (1 - sal.anchor.y) * h };
      if (c.x1 > lim.x0 && c.x0 < lim.x1 && c.y1 > lim.y0 && c.y0 < lim.y1) puestas.push(c);
    }
    const caja = (f: Ficha): CajaF => {
      const et = f.c.etiqueta;
      const w = et.w * f.comp, h = et.h * f.comp;
      return { x0: et.raiz.x - w / 2 - et.rotuloW * f.comp, y0: et.raiz.y - h / 2, x1: et.raiz.x + w / 2, y1: et.raiz.y + h / 2 };
    };
    /** Mete la ficha en la pantalla; falso si no entra entera o habría que irse demasiado lejos de su llama. */
    const encajar = (f: Ficha): boolean => {
      const et = f.c.etiqueta;
      const m = metida(caja(f), lim);
      if (!m) return false;
      et.raiz.position.set(et.raiz.x + m.dx, et.raiz.y + m.dy);
      return true;
    };
    // La amarilla se ubica primero, pegada a su llama; la que el relator nombra busca lugar después, sin empujarla.
    const manda = (f: Ficha): number => (f.soyLider ? 5 : nombrados.has(f.q) ? 4 : f.estilo === "echada" ? 2 : 1);
    const orden = [...fichas].sort((a, b) => manda(b) - manda(a) || b.p.x - a.p.x);
    fichas: for (const f of orden) {
      const et = f.c.etiqueta;
      // Dónde cae su ficha sin más (y lo que ya se corrió para entrar en la pantalla): el tope de renglones cuenta desde ahí.
      let yNatural = et.raiz.y;
      if (!encajar(f)) {
        et.raiz.visible = false;
        continue;
      }
      let r = caja(f);
      let nv = f.nv;
      while (d.nueva && pisaA(r, puestas) && nv > 2 && !f.soyLider && f.estilo !== "echada") {
        nv = (nv - 1) as Nivel;
        ponerEtiqueta(et, textoDe(f.q, nv), px, f.estilo);
        ubicarFicha(et, f.p, f.arriba, f.comp, vz, f.soyLider);
        yNatural = et.raiz.y;
        if (!encajar(f)) {
          et.raiz.visible = false;
          continue fichas;
        }
        r = caja(f);
      }
      if (pisaA(r, puestas)) {
        if (nombrados.has(f.q) && !f.soyLider) {
          // La que el relator nombra busca lugar debajo de su llama (justo bajo las patas y, si no, un renglón abajo y después arriba); si no
          // entra con su nombre, pasa a su nombre de pila. Nunca empuja a la amarilla, y si no hay lugar se queda donde está, por encima de todas.
          const buscar = (): number | null => {
            const cab = caja(f);
            if (f.arriba) {
              const h = cab.y1 - cab.y0;
              const dyPies = f.p.y + 3 * P.u + h / 2 - et.raiz.y;
              const c = { ...cab, y0: cab.y0 + dyPies, y1: cab.y1 + dyPies };
              if (dyPies > 0 && et.raiz.y + dyPies - yNatural <= LLAMA_ALTO * f.p.esc + RENGLONES_MAX * (h + 1) && c.y0 >= lim.y0 && c.y1 <= lim.y1 && !pisaA(c, puestas)) return dyPies;
            }
            return sitioLibre(cab, puestas, lim, false, et.raiz.y - yNatural, true);
          };
          let dy = buscar();
          if (dy === null && nv > 2) {
            nv = 2;
            ponerEtiqueta(et, textoDe(f.q, nv), px, f.estilo);
            ubicarFicha(et, f.p, f.arriba, f.comp, vz, f.soyLider);
            yNatural = et.raiz.y;
            if (encajar(f)) {
              r = caja(f);
              dy = pisaA(r, puestas) ? buscar() : 0;
            }
          }
          if (dy !== null) et.raiz.y += dy;
        } else {
          // Un renglón arriba o abajo, alternando (sobre la cabeza, primero para arriba).
          const dy = sitioLibre(r, puestas, lim, f.arriba, et.raiz.y - yNatural);
          if (dy !== null) et.raiz.y += dy;
          else if (manda(f) < 4) {
            et.raiz.visible = false;
            continue;
          }
        }
      }
      puestas.push(caja(f));
      // El cuerpo de la amarilla también cuenta: ninguna otra ficha se le pone encima (la que se leía como suya era la de al lado).
      if (f.soyLider) {
        const b = cuerpoDe(f.p);
        puestas.push({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
      }
    }
  }

  /**
   * La misma postura y ficha de una corredora, para dibujar y medir: sin cajas de carril ni de meta. La usa el primer plano
   * de quien gana (`tomaGanadora`), que necesita saber qué ocupa la campeona en la pantalla del cuadro del golpe.
   */
  function pintarCorredora(q: number, t: number, duenia: number, nivel: Nivel): void {
    const c = tomar(q);
    const p = posicion(q, t);
    if (!p.visible) {
      c.raiz.visible = false;
      c.etiqueta.raiz.visible = false;
      return;
    }
    const vz = cam.zoom || 1;
    const px = nombrePx();
    const corona = t - d.tCrown;
    const post = c.llama;
    c.raiz.visible = true;
    c.raiz.position.set(p.x, p.y - (p.alza ?? 0));
    c.raiz.scale.set(p.esc);
    const lying = p.momento?.kind === "echada";
    // La que se acaba de echar queda por encima de las que pasan: la echada no se tapa.
    const reciente = lying && (p.momento?.p ?? 9) < 4;
    c.raiz.zIndex = p.y + (reciente ? 1e5 : 0);
    const ph = t * (p.velocidad > 0.5 ? 13 : 5) + c.fase;
    let momento = p.momento;
    if (corona >= 0 && q === d.campeona) {
      // Festeja: salta.
      c.raiz.position.y = p.y - Math.abs(Math.sin(corona * 7)) * 20 * P.u * Math.max(0, 1 - corona / 3);
      momento = null;
    }
    post.pose(ph, corona >= 0 && q !== d.campeona ? 0 : p.velocidad, momento);
    if (post.marca.visible) post.marca.scale.set(Math.max(1, minimoPx("nombre", P.w, P.h) / (26 * p.esc * vz)));
    post.zz.scale.set(Math.max(1, Math.min(3, (0.016 * P.h) / (11 * p.esc * vz))));
    const et = c.etiqueta;
    const soyLider = q === duenia && !lying && t < d.tCrown + 99;
    const estilo = lying ? "echada" : soyLider ? "lider" : "normal";
    const nv: Nivel = lying ? 3 : nivel;
    ponerEtiqueta(et, textoDe(q, nv), px, estilo);
    const comp = Math.max(1, Math.min(2.2, minimoPx("nombre", P.w, P.h) / (px * vz)));
    et.raiz.scale.set(comp);
    const enCarril = t >= d.tAbre && d.lanes.includes(q);
    const arriba = enCarril ? carr.arriba : forma.arriba;
    ubicarFicha(et, p, arriba, comp, vz, soyLider);
    et.raiz.zIndex = soyLider ? 3e6 : reciente ? 2e6 : 1e6;
    et.raiz.visible = p.etiquetar !== false;
  }

  function dibujar(t: number): void {
    const vz = cam.zoom || 1;
    if (!tres) pintarSuelo();
    const gente3: Corredora3D[] = [];
    const fichas3: { et: Etiqueta; persona: number; comp: number; y: number; etiquetar: boolean; sinLugar: boolean; peso: number }[] = [];
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
    const lider = estable(t);
    const corona = t - d.tCrown;
    // La borla y la ficha grande viajan juntas: la ficha pasa cuando la borla está por aterrizar.
    const bp = posicionBorla(t, lider);
    const duenia = bp?.duenia ?? lider;
    let rayaMax = -Infinity;
    estelas.clear();
    acomodarMeta(t);
    const fichas: Ficha[] = [];
    const nombrados = nombradas(t);
    for (const q of quienes) {
      const c = tomar(q);
      const p = posicion(q, t);
      if (!p.visible) {
        c.raiz.visible = false;
        c.etiqueta.raiz.visible = false;
        continue;
      }
      const post = c.llama;
      if (d.nueva && p.momento?.kind !== "echada" && (!d.tandas.length || t >= d.tSalida)) {
        const xh = p.x + LLAMA_HOCICO * p.esc;
        if (xh > rayaMax) rayaMax = xh;
      }
      if (d.nueva && p.velocidad > 0.5 && p.momento?.kind !== "echada" && t >= d.tSalida + 0.3) {
        // Tres rayitas que se alargan con el paso, a la altura del lomo, del hocico a la cola y más atrás.
        const largo = (34 + 10 * Math.sin(t * 9 + c.fase)) * p.esc;
        for (const [a, h] of [[0.0, 52], [0.25, 36], [0.5, 22]] as const) {
          estelas.moveTo(p.x + (LLAMA_COLA - 4 - a * 30) * p.esc, p.y - h * p.esc).lineTo(p.x + (LLAMA_COLA - 4) * p.esc - largo * (1 - a * 0.5), p.y - h * p.esc).stroke({ width: Math.max(1.6 * P.u, 2.2 * p.esc), color: 0xffffff, alpha: 0.6, cap: "round" });
        }
      }
      c.raiz.visible = true;
      c.raiz.position.set(p.x, p.y - (p.alza ?? 0));
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
      if (tres) gente3.push({ persona: q, x: p.x, y: p.y, salto: p.y - c.raiz.position.y, esc: p.esc, velocidad: corona >= 0 && q !== d.campeona ? 0 : p.velocidad, momento, fase: ph });
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
      if (tres) fichas3.push({ et, persona: q, comp, y: p.y, etiquetar: false, sinLugar: false, peso: soyLider ? 3e6 : reciente ? 2e6 : 1e6 });
      else ubicarFicha(et, p, arriba, comp, vz, soyLider);
      et.raiz.zIndex = nombrados.has(q) ? 4e6 : soyLider ? 3e6 : reciente ? 2e6 : 1e6;
      // Las que quedaron lejos de la pantalla no se dibujan.
      const dentro = p.x > cam.x - P.w / (2 * vz) - 300 && p.x < cam.x + P.w / (2 * vz) + 300;
      c.raiz.visible = dentro;
      // En el celular no hay lugar para que los nombres de todas las que se echaron queden a la vista: a los 2,5 s se va la ficha y queda la llama echada.
      const sinLugar = P.retrato && lying && (p.momento?.p ?? 0) > 5;
      // Cuando cae el golpe, quien gana ya tiene su cartel: la ficha sobra (el nombre aparecía tres veces).
      const sobra = d.nueva && ((k.coronado && q === d.campeona) || p.x + LLAMA_HOCICO * p.esc < cam.x - P.w / (2 * vz) + 4 * P.u);
      et.raiz.visible = dentro && p.etiquetar !== false && !sinLugar && !sobra;
      if (tres) {
        const f = fichas3[fichas3.length - 1];
        if (f) {
          f.etiquetar = p.etiquetar !== false;
          f.sinLugar = sinLugar || sobra;
        }
      } else if (et.raiz.visible) fichas.push({ q, c, p, estilo, nv, arriba, comp, esc, soyLider });
    }
    if (!tres) resolverFichas(fichas, px, vz, nombrados);
    pintarPorton(t);
    pintarObstaculos(t);
    if (Number.isFinite(rayaMax)) rayaX = rayaMax;
    // La borla: pasa de una a otra (se calculó antes del bucle).
    borla.visible = !!bp && t < d.tCrown + 0.01 && (!d.tandas.length || t >= ((d.tandas[0] as Tanda).salidas[0] as number));
    if (bp) {
      borla.position.set(bp.x, bp.y);
      borla.scale.set(bp.esc);
      if (d.nueva) (borla as Container & { flamea?(hora: number): void }).flamea?.(t);
    }
    if (d.nueva) pintarRaya(t);
    // En el celular el cartel de quien gana cae justo sobre la cinta: ya no hay nada que medir, y debajo del cartel asomaba a medias.
    cinta.visible = !(d.nueva && P.retrato && k.coronado);
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
    if (tres) dibujar3D(t, gente3, fichas3, bp, corona);
  }

  /**
   * El cuadro del prototipo 3D: le pasa a la vista lo que el 2D ya puso (posiciones, posturas, cámara del director) y,
   * con la cámara de este cuadro, lleva cada ficha de nombre a donde cae la cabeza de su llama en la pantalla.
   */
  function dibujar3D(
    t: number,
    gente: Corredora3D[],
    fichas: { et: Etiqueta; persona: number; comp: number; y: number; etiquetar: boolean; sinLugar: boolean; peso: number }[],
    bp: { x: number; esc: number; pie: number; y: number; duenia: number } | null,
    corona: number,
  ): void {
    if (!tres) return;
    const vz = cam.zoom || 1;
    const medir = params.get("auditar") === "3d";
    const medidas: { persona: number; px: number; alto: number; ancho: number; x: number; y: number }[] = [];
    const borla3: Borla3D | null = bp && borla.visible ? { x: bp.x, pie: bp.pie, alto: bp.pie - bp.y, radio: BORLA_RADIO * bp.esc, duenia: bp.duenia, manta: d.nueva } : null;
    tres.frame({ t, w: P.w, h: P.h, u: P.u, cam: { x: cam.x, y: cam.y, zoom: vz, rot: cam.rot }, gente, borla: borla3, campeona: d.campeona, corona, horas: HORAS_Q.map((q) => d.tDeQ(q)), efectos: efectosEn(t) });
    // Las fichas no se pisan: la que manda (la del primero, después las recientes) se queda donde cae; la que choca con una puesta
    // se corre hacia arriba o hacia abajo por su alto y, si ni así cabe, no se muestra en ese cuadro.
    // Y ninguna ficha tapa la cabeza de otra llama (la perspectiva apila las filas, y la ficha de la de adelante caía sobre la de atrás).
    const puestas: { x0: number; y0: number; x1: number; y1: number; de?: number; cabeza?: boolean }[] = [];
    for (const f of fichas) {
      const pc = tres.pantallaDe(f.persona);
      if (!pc || pc.x < 0 || pc.x > P.w || pc.y < P.top || pc.y > P.bottom) continue;
      puestas.push({ de: f.persona, cabeza: true, x0: pc.x - pc.alto * 0.28, x1: pc.x + pc.alto * 0.28, y0: pc.y - pc.alto * 0.1, y1: pc.y + pc.alto * 0.3 });
    }
    for (const f of [...fichas].sort((a, b2) => b2.peso - a.peso)) {
      const pan = tres.pantallaDe(f.persona);
      const et = f.et;
      if (!pan) {
        et.raiz.visible = false;
        continue;
      }
      const dentro = pan.x > -40 && pan.x < P.w + 40 && pan.y > P.top - 20 && pan.y < P.bottom + 40;
      // La ficha mide en la pantalla lo mismo que en el 2D (`comp` por el acercamiento) y se apoya sobre la cabeza.
      const e = f.comp * vz;
      et.raiz.scale.set(e);
      // Entera en la pantalla: en el celular los de los bordes se cortaban.
      const mitad = (et.w * e) / 2 + 4 * P.u;
      const piso = Math.max(P.top, pisoDeFichas());
      et.raiz.position.set(Math.max(mitad, Math.min(P.w - mitad, pan.x)), Math.max(piso + (et.h * e) / 2, pan.y - (et.h * e) / 2 - 3 * P.u));
      et.raiz.zIndex = f.peso + pan.y;
      et.raiz.visible = dentro && f.etiquetar && !f.sinLugar;
      if (et.raiz.visible) {
        const w = et.w * e, h = et.h * e, y0 = et.raiz.y;
        const caja = (dx: number, dy: number): { x0: number; y0: number; x1: number; y1: number; de: number } => ({ x0: et.raiz.x + dx - w / 2, y0: y0 + dy - h / 2, x1: et.raiz.x + dx + w / 2, y1: y0 + dy + h / 2, de: f.persona });
        const choca = (r: { x0: number; y0: number; x1: number; y1: number }): boolean => puestas.some((b2) => b2.de !== f.persona && !(f.peso >= 3e6 && b2.cabeza) && r.x0 < b2.x1 - 1 && r.x1 > b2.x0 + 1 && r.y0 < b2.y1 - 1 && r.y1 > b2.y0 + 1);
        const paso = h + 2 * P.u;
        // Primero arriba de su cabeza; si ahí no cabe, un escalón más arriba o abajo, y después corrida medio ancho a un lado.
        let lugar: { dx: number; dy: number } | undefined;
        for (const dy of [0, -paso, -2 * paso, paso, 2 * paso]) {
          for (const dx of [0, -w * 0.5, w * 0.5]) {
            if (!lugar && !choca(caja(dx, dy)) && y0 + dy - h / 2 > piso - 1 && et.raiz.x + dx - w / 2 > 0 && et.raiz.x + dx + w / 2 < P.w) lugar = { dx, dy };
          }
        }
        if (!lugar && f.peso >= 3e6) lugar = { dx: 0, dy: 0 };
        if (!lugar) et.raiz.visible = false;
        else {
          et.raiz.x += lugar.dx;
          et.raiz.y = y0 + lugar.dy;
          puestas.push(caja(0, lugar.dy));
        }
      }
      if (medir && et.raiz.visible) medidas.push({ persona: f.persona, px: et.texto.style.fontSize as number * e, alto: et.h * e, ancho: et.w * e, x: et.raiz.x, y: et.raiz.y });
    }
    if (medir) {
      (window as unknown as { __fichas3d: unknown }).__fichas3d = medidas;
      // Para el auditor de nombres: cuántas fichas se pisan entre sí, cuántas tapan la cabeza de otra llama y cuántas llamas con nombre se quedaron sin ficha.
      const rects = medidas.map((m) => {
        const et = fichas.find((f) => f.persona === m.persona)!.et;
        return { persona: m.persona, x0: et.raiz.x - m.ancho / 2, x1: et.raiz.x + m.ancho / 2, y0: et.raiz.y - m.alto / 2, y1: et.raiz.y + m.alto / 2 };
      });
      let entreSi = 0, sobreCabeza = 0;
      rects.forEach((a, i) => {
        for (let j = i + 1; j < rects.length; j++) {
          const b2 = rects[j]!;
          if (a.x0 < b2.x1 - 1 && a.x1 > b2.x0 + 1 && a.y0 < b2.y1 - 1 && a.y1 > b2.y0 + 1) entreSi++;
        }
        for (const f of fichas) {
          if (f.persona === a.persona) continue;
          const pan = tres?.pantallaDe(f.persona);
          if (!pan || pan.x < 0 || pan.x > P.w) continue;
          const h = pan.alto * 0.3;
          if (a.x0 < pan.x + h && a.x1 > pan.x - h && a.y0 < pan.y + h && a.y1 > pan.y - h * 0.3) sobreCabeza++;
        }
      });
      const sinFicha = fichas.filter((f) => f.etiquetar && !f.sinLugar && !f.et.raiz.visible && (tres?.pantallaDe(f.persona)?.x ?? -1) > 0 && (tres?.pantallaDe(f.persona)?.x ?? -1) < P.w).length;
      (window as unknown as { __solapes3d: unknown }).__solapes3d = { fichas: rects.length, entreSi, sobreCabeza, sinFicha };
    }
  }

  /** Dónde va la borla: sobre el lomo de quien va adelante, o volando de una a otra. En el 3D no hay borla que vuele: la ficha y el aro pasan a la nueva dueña apenas cambia quién va adelante. */
  function posicionBorla(t: number, lider: number): { x: number; y: number; esc: number; duenia: number; pie: number } | null {
    if (lider < 0) return null;
    const sobre = (q: number): { x: number; y: number; esc: number; duenia: number; pie: number } => {
      const p = posicion(q, t);
      // La manta se apoya en el lomo, atrás del cuello: no tapa la cara de quien va primera.
      if (d.nueva) return { x: p.x + 8 * p.esc, y: p.y - 47 * p.esc, esc: p.esc, duenia: q, pie: p.y };
      return { x: p.x - 2 * p.esc, y: p.y - 70 * p.esc, esc: Math.max(p.esc * 1.25, 0.8 * P.u), duenia: q, pie: p.y };
    };
    const vuelo = d.nueva ? 0.3 : 0.45;
    const antes = estable(t - vuelo);
    if (antes < 0 || antes === lider || t - vuelo < d.tSalida) return sobre(lider);
    let a = t - vuelo, b = t;
    for (let i = 0; i < 6; i++) {
      const m = (a + b) / 2;
      if (estable(m) === lider) b = m;
      else a = m;
    }
    const e = ease((t - b) / vuelo);
    const A = sobre(antes), B = sobre(lider);
    return { x: lerp(A.x, B.x, e), y: lerp(A.y, B.y, e) - Math.sin(Math.PI * e) * (d.nueva ? 30 : 46) * P.u, esc: lerp(A.esc, B.esc, e), duenia: d.nueva || tres || e >= 0.55 ? lider : antes, pie: lerp(A.pie, B.pie, e) };
  }

  /* ---------------------------------------------------------------- cámara */
  // La carrera nueva deja aire adelante: la primera va a 0,72 del ancho y, cuando acelera o la alcanzan, entre 0,62 y 0,82. La cámara sigue
  // al promedio de las que van adelante en la última décima (`sFrente`), no a la primera: es función de la hora, saltar da lo mismo.
  const camX = (t: number): number => xFrente(t) - ((d.nueva ? AIRE : forma.ancla / P.w) - 0.5) * P.w;
  const vistaCorral: () => { x: number; y: number; z: number } = () => ({ x: camX(d.tSalida), y: P.h / 2, z: 1 });
  /** Con tandas: el portón a 0,7 del ancho, la tanda que espera a la izquierda del portón y el corral a la derecha (los nombres, en el costado izquierdo). */
  const vistaTanda = (): { x: number; y: number; z: number } => (P.retrato ? { x: gateX + 0.05 * P.w, y: P.h / 2, z: 0.52 } : { x: gateX - 0.2 * P.w, y: P.h / 2, z: 1 });
  function vistaPresentacion(t: number) {
    const v = d.tandas.length ? vistaTanda() : vistaCorral();
    const e = ease(t / d.tVuelo);
    const xA = metaX - 0.3 * P.w;
    // La carrera nueva no deja la cámara quieta mientras se leen los nombres: un acercamiento lento (6 %) hasta la salida. Con dos personas el
    // corral era lo único en pantalla y pasaba de 4 s sin que nada cambiara (`audit-rigor`).
    const respira = d.nueva && !d.tandas.length ? 0.06 * suave((t - d.tVuelo) / Math.max(1, d.tSalida - d.tVuelo)) : 0;
    return { x: lerp(xA, v.x, e), y: P.h / 2, z: lerp(0.62, 1, e) + respira };
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
    const orden = P.retrato ? d.lanes : [...new Set([...d.vivas(t2).slice(0, 3), ...enApuros(t2)])];
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
    const pan = tres?.pantallaDe(d.campeona);
    if (pan) return { x: pan.x, y: pan.y + pan.alto * 0.5, r: pan.alto * 0.62, color: colorDeNombre(names[d.campeona] ?? "") };
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p);
    const s = cam.toScreen(c.x + c.w / 2, c.y + c.h * 0.55, P.w, P.h);
    const z = cam.zoom || 1;
    return { x: s.x, y: s.y, r: Math.max(c.w, c.h) * 0.6 * z, color: colorDeNombre(names[d.campeona] ?? "") };
  }
  /** En qué punto de la pantalla está quien va adelante (la que lleva la borla; al final, la campeona): lo lee la prueba del niño. */
  function puntoDelFrente(t: number): { x: number; y: number } | null {
    const q = t >= d.tCrown ? d.campeona : d.duena(t);
    const p = posicion(q, t);
    if (!p.visible) return null;
    const c = cuerpoDe(p);
    return cam.toScreen(c.x + c.w / 2, c.y + c.h * 0.55, P.w, P.h);
  }
  function protegida(): { caja: Caja; zona: Zona } | null {
    // Con el primer plano final del golpe, lo que hay que dejar libre es lo que la cámara del cierre va a encuadrar.
    const final = tomaGanadora(k.t);
    if (final) return { caja: final.caja, zona: final.zona };
    const p = posicion(d.campeona, d.tCrown);
    const c = cuerpoDe(p, true);
    // Con el pelotón apretado en la línea, la que llega pegada a la ganadora tiene que quedar debajo del cartel, con su nombre entero:
    // la caja suma a la que cruza justo detrás, con el nombre. Las fichas de las demás no bajan del cartel (`pisoDeFichas`).
    const todas = d.lanes
      .filter((q) => q !== d.campeona)
      .map((q) => ({ q, p: posicion(q, d.tCrown) }))
      .sort((a, b) => b.p.x - a.p.x)
      .slice(0, PROTEGE_DETRAS)
      .map((o) => cuerpoDe(o.p, true, o.q));
    const cajas = [{ x: c.x, y: c.y + c.h * 0.2, w: c.w, h: c.h * 0.8 }, ...todas];
    const x0 = Math.min(...cajas.map((b) => b.x)), y0 = Math.min(...cajas.map((b) => b.y));
    const x1 = Math.max(...cajas.map((b) => b.x + b.w)), y1 = Math.max(...cajas.map((b) => b.y + b.h));
    return { caja: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, zona: { x0: 8 * P.u, y0: S.placaBajo(k.ganadores.length) + 4 * P.u, x1: P.w - 8 * P.u, y1: P.bottom } };
  }

  function zonaGanadora(): Zona {
    return { x0: 4, y0: Math.max(hudG.bajo, S.placaBajo(k.ganadores.length)) + 4, x1: P.w - 4, y1: P.bottom - 4 };
  }
  function tomaGanadora(t: number) {
    if (t < d.tCrown || !primerPlanoHorizontal(P)) return null;
    pintarCorredora(d.campeona, t, d.campeona, 4);
    const c = tomar(d.campeona);
    return { caja: cajaVisual([c.llama.root, c.etiqueta.raiz], S.scene), zona: zonaGanadora(), ritmo: 3 };
  }
  /** Al coronar, el kit le pide a la escena que despeje a quien gana: el primer plano corre la escena para que no quede detrás del cartel. */
  function despejarGanadora(t: number): void {
    if (t >= d.tCrown && primerPlanoHorizontal(P)) {
      const c = tomar(d.campeona);
      S.despejarGanador(cajaVisible([c.llama.root, c.etiqueta.raiz]));
    }
  }

  /* -------------------------------------------------------------- reconstruir */
  function reconstruir(): void {
    medirGeometria();
    cache.clear();
    corralMemo.clear();
    frenteMemo.clear();
    for (const c of enUso.values()) c.etiqueta.clave = "";
    pintarCielo();
    pintarMarcas();
    pintarCinta();
    cartelClave = "";
    tres?.reconstruir(geometria3D());
  }

  /** El mundo 2D que el prototipo 3D tiene que vestir: lo mismo que pinta `pintarSuelo` y `pintarMarcas`. */
  function geometria3D(): Geometria3D {
    const zonas: ZonaSuelo[] = [{ desde: -1e9, hasta: 0, tipo: "corral", color: TERRENO_COLOR.corral, acento: TERRENO_ACENTO.corral }];
    d.tramos.forEach((tr, i) => zonas.push({ desde: i === 0 ? 0 : xDeT(tr.t0), hasta: xDeT(tr.t1), tipo: tr.terreno, color: TERRENO_COLOR[tr.terreno], acento: TERRENO_ACENTO[tr.terreno] }));
    zonas.push({ desde: d.tramos.length ? Xs : 0, hasta: 1e9, tipo: "recta", color: TERRENO_COLOR.recta, acento: TERRENO_ACENTO.recta });
    return {
      w: P.w, h: P.h, u: P.u, F0, Xs, metaX, gateX, y0: forma.y0, y1: forma.y1, carY0: carr.y0, carY1: carr.y1, carN: carr.n, zonas,
      pasoPostes: 0.2 * P.w, conPorton: d.tandas.length > 0, conPortonesRecta: d.tiempos.echadas.length > 0,
      corral: d.tandas.length ? -gateX + P.w * 0.7 : forma.profundidad + nombreW + 260 * P.u,
      rotuloMeta: k.txt("carRotuloMeta"), rotuloSalida: k.txt("carSalida").replace(/[¡!]/g, "").toUpperCase(),
      vallas: vallasDelPlan(),
    };
  }
  reconstruir();

  // El prototipo 3D: si no arranca (sin WebGL, sin memoria), el 2D sigue como siempre y no se entera.
  if (fabrica3d) {
    try {
      tres = fabrica3d({
        lienzoPixi: S.view,
        geometria: geometria3D,
        colores: (persona) => ({ pelaje: PELAJES[persona % PELAJES.length] ?? 0xf3ead8, manta: S.color(persona) }),
        auditar: params.get("auditar") === "3d",
      });
      // El estadio y las llamas del 2D se apagan; las fichas de nombre pasan a la pantalla, sobre el 3D.
      cielo.visible = false;
      suelo.visible = false;
      marcas.visible = false;
      porton.visible = false;
      corredoras.visible = false;
      borlaCapa.visible = false;
      // Las fichas van sobre el 3D y debajo de la capa `hud` del andamiaje: así no se van con ella cuando, en el celular, entra el cartel de quien
      // gana (la capa se desvanece), y los nombres de las que llegan detrás se siguen leyendo.
      const raiz = S.app.stage;
      raiz.addChildAt(etiquetas, Math.max(0, raiz.getChildIndex(S.hud)));
      S.onCleanup(() => {
        etiquetas.parent?.removeChild(etiquetas);
        tres?.destruir();
      });
    } catch (err) {
      console.warn('[3d] no arrancó, sigue el 2D', err);
      tres = null;
    }
  }

  // Para el auditor de emoción: dónde queda quien gana en la pantalla. Sin su nombre: desde el golpe la ficha se va (el cartel ya dice
  // quién gana), y lo que no puede cortar ni tapar el cartel es su cuerpo.
  S.ganadorEn(() => {
    // Con el prototipo 3D la llama se ve por su cámara: de la cabeza al pie, con un ancho parecido a su alto.
    const pan = tres?.pantallaDe(d.campeona);
    if (tres) return pan ? { x: pan.x - pan.alto * 0.55, y: pan.y, w: pan.alto * 1.1, h: pan.alto } : null;
    const c = cuerpoDe(posicion(d.campeona, d.tCrown));
    const a = cam.toScreen(c.x, c.y, P.w, P.h), b = cam.toScreen(c.x + c.w, c.y + c.h, P.w, P.h);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  });

  const escena: EscenaCarrera & { rebuild(): void; draw(t: number): void; despejar(t: number): void } = {
    rebuild: reconstruir,
    draw: dibujar,
    despejar: despejarGanadora,
    tomaGanadora,
    vistaPresentacion,
    vistaGrupo,
    cajaCarriles,
    cajasDelFrente,
    caja,
    zona,
    meta,
    foco,
    protegida,
    puntoDelFrente,
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

const definicion = (fabrica3d: Fabrica3D | null): DefJuego<Datos, Escena> => ({
  id: "race",
  textos: TEXTOS_CARRERA,
  // `?carrera=nueva`: la carrera nueva, hasta que pase las compuertas. Sin la bandera, la de siempre.
  plan: (ctx) => planCarrera(ctx, { nueva: params.get("carrera") === "nueva" }),
  arma(k, plan, previa) {
    if (!previa) return crearEscena(k, plan.datos, fabrica3d);
    previa.rebuild();
    return previa;
  },
  cuadro(_k, _plan, escena, t) {
    escena.draw(t);
  },
  trasCorona(_k, _plan, escena, t) {
    escena.despejar(t);
  },
});

export const carreraPixi = crearJuego<Datos, Escena>(definicion(null));

/**
 * El prototipo en 3D (`?motor=3d`, docs/motores.md): el mismo juego, con el lienzo de PixiJS transparente y la vista 3D
 * debajo. `index.ts` la pide solo cuando `engine.ts` lo permite, y trae three.js recién ahí.
 */
export const carreraPixi3D = (fabrica: Fabrica3D) => crearJuego<Datos, Escena>(definicion(fabrica), {
  ...anfitrionTinkazo,
  montar: (baliza, listo, alSaltar, o) => mountPixi(baliza, listo, alSaltar, { music: o.musica, transparente: true }),
});
