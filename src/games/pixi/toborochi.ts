import { Container, Graphics, Sprite } from "pixi.js";
import { musicHold } from "../../music";
import { mediana, nivelQueCabe, type Nivel } from "../nombres";
import { INK, anchoMarcador, crearJuego, hashDe, planNombres, reservaDeMarcas, textoMarcador, type Kit, type PlanNombres } from "./kit";
import { anchoAprox, casilla, geoDe, puntoDe, rejillaDe, type Geo, type Lugar, type Rejilla } from "./toborochi-arbol";
import { T_QUEDAN, T_SILENCIO, T_TRASIEGO, bajaEn, enElArbolEn, faseDe, frenteEn, hiloEn, nubladoEn, planToborochi, tPosa, tiembla, vientoEn, type Datos, type Visita } from "./toborochi-plan";
import { TEXTOS } from "./toborochi-textos";

/**
 * El Toborochi: la escena.
 *
 * Un toborochi en flor, sin hojas, en una mañana de mayo (tema claro) o al atardecer (tema oscuro). Cada persona es una
 * flor en la punta de una rama, con su cara; el nombre aparece de a ocho en la brisa del principio y en cada calma, y
 * viaja con la flor cuando el surazo la suelta hasta quedar escrito en la alfombra del suelo. Cuando quedan dos, un
 * colibrí las visita y se posa en la elegida.
 *
 * Todo lo que no es dibujo lo hace el kit (`./kit`): el montaje, la cámara, el foco de quien gana, los subtítulos, el
 * contador y el cierre. Lo que decide qué pasa y cuándo lo hace el plan (`toborochi-plan.ts`); acá se dibuja como función
 * del segundo `t`: la misma ronda dibuja los mismos cuadros, y saltar da lo mismo que mirar. La leyenda no se cuenta acá.
 *
 * Nada de lo que se ve distingue a quien gana antes de tiempo: el viento dobla la copa entera, las que tiemblan se
 * sortean entre todas, el colibrí visita a las dos, y la cámara encuadra a las dos.
 */

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const c01 = (v: number): number => Math.max(0, Math.min(1, v));
const suave = (v: number): number => {
  const x = c01(v);
  return x * x * (3 - 2 * x);
};
/** Mezcla dos colores, canal por canal. */
function mezcla(a: number, b: number, k: number): number {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k);
  const g = lerp((a >> 8) & 255, (b >> 8) & 255, k);
  const bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Los rosados del toborochi, de a tres: el tema oscuro los prende un poco más. */
const ROSAS = [0xff80b8, 0xff97c6, 0xf56aab];
const ROSA_BORDE = 0xc23a78;
const CREMA = 0xfff4d6;
/** La pasada del colibrí al empezar, en segundos de juego: termina cuando entran los primeros nombres. */
const T_PASADA: [number, number] = [0.5, 2.5];

interface Flor {
  raiz: Container;
  petalos: Graphics;
  brillo: Graphics;
  cara: Sprite | null;
}

interface Escena {
  raiz: Container;
  g: Geo;
  suelo: Graphics;
  ramas: Graphics;
  flores: Flor[];
  aire: Graphics;
  remolino: Graphics;
  colibri: Container;
  alas: Graphics[];
  capaChips: Container;
  chips: Map<number, Container>;
  /** Cuándo cayó el golpe, en segundos de juego. */
  tCorona: number | null;
  /** Qué ráfagas ya dieron su sacudón de cámara. */
  sacudidas: Set<number>;
  musica: boolean;
  /** Por rama, cuándo se desprende su última flor (infinito si alguna se queda hasta el final). */
  ramaFin: number[];
  /** Ya se apagó el desenfoque de la cámara (desde «quedan dos»). */
  sinBlur: boolean;
  /** El nombre que va en la alfombra y en vuelo (nivel 1 a 4), el ancho de su casilla y su rejilla. */
  formas: PlanNombres;
  nivel: Nivel;
  rejilla: Rejilla;
  /** Por persona, el puesto en que llegó a la alfombra. */
  puesto: number[];
  nubes: Graphics;
}

/* ---------------------------------------------------------------- la flor */

function hacerFlor(i: number, r: number, cara: ReturnType<Kit["figura"]> | null, dark: boolean): Flor {
  const raiz = new Container();
  const brillo = new Graphics();
  brillo.blendMode = "add";
  const petalos = new Graphics();
  const rosa = mezcla(ROSAS[Math.floor(hashDe(i, 5) * 3)] as number, 0xffffff, dark ? 0.12 : 0);
  const borde = Math.max(1, r * 0.075);
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
    petalos.circle(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.46).fill(rosa).stroke({ width: borde, color: ROSA_BORDE });
  }
  // Las vetas más oscuras de cada pétalo, hacia el centro.
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
    petalos.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4).lineTo(Math.cos(a) * r * 0.72, Math.sin(a) * r * 0.72).stroke({ width: Math.max(0.8, r * 0.04), color: ROSA_BORDE, alpha: 0.5 });
  }
  petalos.circle(0, 0, r * 0.52).fill(CREMA).stroke({ width: borde, color: INK });
  raiz.addChild(brillo, petalos);
  let sp: Sprite | null = null;
  if (cara) {
    sp = new Sprite(cara);
    sp.anchor.set(0.5);
    sp.width = r * 0.98;
    sp.height = r * 0.98;
    raiz.addChild(sp);
  } else {
    // Sin cara (con más de sesenta y cuatro): los estambres, un puñado de puntos amarillos.
    for (let m = 0; m < 5; m++) {
      const a = (m / 5) * Math.PI * 2 + hashDe(i, 6);
      petalos.circle(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, Math.max(0.8, r * 0.1)).fill(0xf2a93b);
    }
  }
  return { raiz, petalos, brillo, cara: sp };
}

/* ------------------------------------------------------------ el paisaje */

function pintarCielo(bg: Container, w: number, h: number, g: Geo, dark: boolean): void {
  bg.removeChildren().forEach((c) => c.destroy({ children: true }));
  const cielo = new Graphics();
  // Mañana de mayo: celeste que baja a durazno. Atardecer: violeta que baja a naranja.
  const bandas: [number, number][] = dark
    ? [
        [0x2d2352, 0x4a3470],
        [0x6b3b78, 0x9a4b80],
        [0xc2587a, 0xe07a72],
        [0xf2985c, 0xffc07a],
      ]
    : [
        [0x8fc7f0, 0xa9d6f5],
        [0xc2e2f5, 0xdcecf0],
        [0xf6e6dc, 0xfbe0d0],
        [0xfdd8c2, 0xfcd0b4],
      ];
  const B = bandas.length;
  const hor = g.suelo; // el horizonte es la línea del suelo
  for (let i = 0; i < B; i++) {
    const y0 = (hor * i) / B;
    const y1 = i === B - 1 ? h : (hor * (i + 1)) / B + 1;
    cielo.rect(0, y0, w, y1 - y0).fill(mezcla((bandas[i] as [number, number])[0], (bandas[i] as [number, number])[1], 0.5));
  }
  // El sol, bajo en el atardecer y alto y claro de mañana.
  const sx = w * (dark ? 0.78 : 0.2);
  const sy = g.suelo - (dark ? g.suelo * 0.1 : g.suelo * 0.62);
  const sr = Math.min(w, h) * 0.07;
  for (const [m, a] of [[3.4, 0.07], [2.2, 0.11], [1.5, 0.18]] as const) cielo.circle(sx, sy, sr * m).fill({ color: dark ? 0xffd08a : 0xfff3c4, alpha: a });
  cielo.circle(sx, sy, sr).fill(dark ? 0xffe2a8 : 0xfff6d6);
  // Los cerros del fondo, en dos capas.
  const cerros = (alto: number, color: number, fase: number): void => {
    const pts: number[] = [0, h];
    for (let i = 0; i <= 24; i++) pts.push((i / 24) * w, g.suelo - alto * (0.55 + 0.45 * Math.sin(i * 0.9 + fase)) * (0.7 + 0.3 * hashDe(i, fase * 10)));
    pts.push(w, h);
    cielo.poly(pts).fill(color);
  };
  cerros(g.suelo * 0.2, dark ? 0x4e3a6c : 0xb2cfae, 1);
  cerros(g.suelo * 0.12, dark ? 0x3b2c58 : 0x95bd92, 3);
  bg.addChild(cielo);
}

function pintarSuelo(e: Escena, dark: boolean): void {
  const g = e.g;
  const s = e.suelo.clear();
  const verde = dark ? 0x59764a : 0x8dbb78;
  s.rect(-g.w, g.suelo, g.w * 3, g.h * 2).fill(verde);
  s.rect(-g.w, g.suelo, g.w * 3, Math.max(2, 3 * g.k)).fill({ color: INK, alpha: 0.35 });
  // Pasto: unas briznas más oscuras.
  for (let i = 0; i < 90; i++) {
    const x = hashDe(i, 21) * g.w;
    const y = g.suelo + 4 * g.k + hashDe(i, 22) * (g.alfombra.h - 6 * g.k);
    s.moveTo(x, y).lineTo(x + (hashDe(i, 23) - 0.5) * 6 * g.k, y - (3 + 4 * hashDe(i, 24)) * g.k).stroke({ width: Math.max(1, g.k), color: dark ? 0x3f5a35 : 0x6ea15d, alpha: 0.7 });
  }
}

/** El tronco con panza de botella y sus espinas cónicas: el toborochi, sin hojas. */
function pintarTronco(raiz: Container, g: Geo, dark: boolean): void {
  const t = new Graphics();
  const base = g.troncoBase;
  const cima = g.troncoCima;
  const H = base - cima;
  const wB = g.troncoAncho;
  const piel = dark ? 0x7f8f6a : 0x9aae7e;
  const sombra = dark ? 0x586848 : 0x728a5c;
  const perfil = (y01: number): number => {
    // 0 arriba, 1 abajo: angosto arriba, panza al 60 %, un pie un poco más fino.
    const panza = Math.exp(-Math.pow((y01 - 0.6) / 0.28, 2));
    // Al pie se ensancha en vez de afinarse: el tronco se agarra al suelo con sus raíces, no se apoya como una maceta.
    const pie = suave((y01 - 0.82) / 0.18);
    return wB * (0.5 + 0.5 * panza) * (1 + 0.5 * pie);
  };
  const izq: number[] = [];
  const der: number[] = [];
  // El contorno: baja por la izquierda y sube por la derecha (si no, las dos mitades se cruzan como un moño).
  for (let i = 0; i <= 16; i++) {
    const y01 = i / 16;
    const y = cima + H * y01;
    izq.push(g.cx - perfil(y01) / 2, y);
    der.push(g.cx + perfil(y01) / 2, y);
  }
  const poly: number[] = [...izq];
  for (let i = der.length - 2; i >= 0; i -= 2) poly.push(der[i] as number, der[i + 1] as number);
  t.poly(poly).fill(piel).stroke({ width: Math.max(2, 2.5 * g.k), color: INK, join: "round" });
  // El lado en sombra, a la derecha.
  const som: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const y01 = i / 16;
    som.push(g.cx + perfil(y01) * 0.12, cima + H * y01);
  }
  for (let i = 16; i >= 0; i--) som.push(g.cx + perfil(i / 16) / 2 - Math.max(1, g.k), cima + H * (i / 16));
  t.poly(som).fill({ color: sombra, alpha: 0.55 });
  // Las espinas: conos chicos, en hileras.
  for (let fila = 0; fila < 9; fila++) {
    const y01 = 0.12 + (fila / 8) * 0.8;
    const y = cima + H * y01;
    const ancho = perfil(y01);
    for (let m = -2; m <= 2; m++) {
      if ((fila + m) % 2) continue;
      const x = g.cx + (m / 2.6) * ancho * 0.42;
      const l = Math.max(2.5, ancho * 0.05);
      t.poly([x - l * 0.7, y + l * 0.4, x, y - l * 1.6, x + l * 0.7, y + l * 0.4]).fill(dark ? 0xd9d3b8 : 0xe9e1c4).stroke({ width: Math.max(0.8, g.k * 0.9), color: INK });
    }
  }
  // Las raíces: lomos que salen del pie y se hunden en el pasto, tres a cada lado.
  const ancho0 = perfil(1);
  const hueso = Math.max(2, 2.5 * g.k);
  for (const lado of [-1, 1]) {
    for (let m = 0; m < 3; m++) {
      const largo = ancho0 * (0.5 + 0.2 * hashDe(m + (lado > 0 ? 3 : 0), 71) + 0.3 * m);
      const x0 = g.cx + lado * ancho0 * (0.34 + 0.1 * m);
      const y0 = base + g.k * 2 - m * 3 * g.k;
      const alto = Math.max(3, ancho0 * (0.24 - 0.06 * m));
      t.poly([x0, y0 - alto, x0 + lado * largo * 0.55, y0 - alto * 0.15, x0 + lado * largo, y0 + 2 * g.k, x0, y0 + 2 * g.k])
        .fill(m === 0 ? piel : sombra)
        .stroke({ width: Math.max(1.2, hueso * 0.7), color: INK, join: "round" });
    }
  }
  raiz.addChild(t);
  // El pasto que se le sube por delante: unas matas a cada lado del pie, para que el tronco nazca del suelo.
  const pasto = new Graphics();
  for (let m = 0; m < 16; m++) {
    const x = g.cx + (m / 15 - 0.5) * ancho0 * 1.9;
    const h = (10 + 12 * hashDe(m, 72)) * g.k;
    const y = base + 1.5 * g.k;
    pasto.poly([x - 4 * g.k, y, x + (hashDe(m, 73) - 0.5) * 6 * g.k, y - h, x + 4 * g.k, y]).fill(dark ? 0x4c6a3f : 0x73a95f).stroke({ width: Math.max(0.8, g.k * 0.8), color: dark ? 0x3a5430 : 0x5a8a4a });
  }
  raiz.addChild(pasto);
}

/* ------------------------------------------------------------- las posiciones */

/** Dónde está la flor `i` en el segundo `t`, ya doblada por el viento. */
function dondeEsta(d: Datos, g: Geo, i: number, t: number, w: number, destino: { x: number; y: number }): { x: number; y: number; rot: number; escala: number; suelo: boolean; cae: number } {
  const l = d.lugar[i] as Lugar;
  const base = puntoDe(g, l);
  // La copa entera se dobla con el viento, más arriba más: igual para todas.
  const dobla = w * g.copa.ancho * 0.048 * (0.3 + 0.7 * l.v);
  const vaiven = Math.sin(t * 1.1 + i * 1.7) * g.r * 0.05 + w * Math.sin(t * 9 + l.u * 5 + i * 0.3) * g.r * 0.1;
  let x = base.x + dobla + vaiven;
  let y = base.y - Math.abs(dobla) * 0.12;
  let rot = Math.sin(t * 1.4 + i) * 0.03 + w * Math.sin(t * 8 + i) * 0.1;
  // Las que tiemblan fuerte, sorteadas entre todas.
  const tr = tiembla(d, i, t);
  if (tr > 0) {
    x += Math.sin(t * 31 + i) * g.r * 0.28 * tr;
    y += Math.cos(t * 27 + i) * g.r * 0.16 * tr;
    rot += Math.sin(t * 26 + i) * 0.5 * tr;
  }
  // Una que cuelga de un hilo, o que se engancha más abajo.
  const h = hiloEn(d, i, t);
  if (h > 0) {
    y += h * g.r * 1.2 + Math.sin(t * 12) * h * g.r * 0.12;
    rot += Math.sin(t * 9) * 0.4 * h;
  }
  const b = bajaEn(d, i, t);
  if (b > 0) y += b * (d.engancha?.dv ?? 0) * g.copa.alto;
  const tc = d.tCae[i] as number;
  // Florece: las flores se abren de abajo hacia afuera, una tras otra, en los primeros segundos.
  const abre = suave((t - (0.1 + 1.3 * l.v)) / 0.8);
  if (t < tc) return { x, y, rot, escala: abre, suelo: false, cae: 0 };
  // Cae: aletea de lado a lado, más hacia donde sopla el viento, y queda tendida en la alfombra.
  const dur = d.durCaida[i] as number;
  const f = c01((t - tc) / dur);
  // Cae justo debajo del chip de su casilla: el nombre y la flor tendida quedan juntos.
  const aterriza = destino.y;
  const premio = d.causa[i] === "premio";
  const deriva = destino.x - x;
  const ease = f * f * 0.75 + f * 0.25;
  const xf = x + deriva * f + Math.sin(f * 7.5 + i) * g.r * (premio ? 0.5 : 0.9) * (1 - 0.4 * f);
  const yf = lerp(y, aterriza, ease);
  const gira = Math.sin(f * 9 + i) * 0.9 * (1 - f);
  return { x: xf, y: yf, rot: gira, escala: lerp(1, 0.78, f), suelo: f >= 1, cae: f };
}

/* ------------------------------------------------------------- el colibrí */

function hacerColibri(): { raiz: Container; alas: Graphics[] } {
  const raiz = new Container();
  const cola = new Graphics().poly([-0.7, 0.05, -1.75, 0.55, -1.5, -0.05]).fill(0x127a5a).stroke({ width: 0.08, color: INK });
  const alaTras = new Graphics().ellipse(-0.1, -0.1, 0.85, 0.24).fill({ color: 0xdff7ff, alpha: 0.5 }).stroke({ width: 0.05, color: 0x6b8da0, alpha: 0.7 });
  const cuerpo = new Graphics()
    .ellipse(0, 0, 0.95, 0.46)
    .fill(0x1fa67a)
    .stroke({ width: 0.08, color: INK })
    .ellipse(0.12, 0.17, 0.62, 0.24)
    .fill(0xcfeccb)
    .circle(0.98, -0.12, 0.38)
    .fill(0x2ec4a0)
    .stroke({ width: 0.08, color: INK })
    .circle(1.04, 0.1, 0.17)
    .fill(0xe0364f)
    .circle(1.1, -0.2, 0.07)
    .fill(INK)
    .poly([1.28, -0.28, 2.5, -0.1, 1.28, -0.06])
    .fill(INK);
  const alaFrente = new Graphics().ellipse(-0.1, -0.1, 0.85, 0.24).fill({ color: 0xeafaff, alpha: 0.6 }).stroke({ width: 0.05, color: 0x6b8da0, alpha: 0.8 });
  alaTras.pivot.set(0.1, 0);
  alaFrente.pivot.set(0.1, 0);
  alaTras.position.set(0.1, -0.2);
  alaFrente.position.set(0.1, -0.2);
  raiz.addChild(cola, alaTras, cuerpo, alaFrente);
  return { raiz, alas: [alaTras, alaFrente] };
}

interface PoseColibri {
  x: number;
  y: number;
  /** 1 mira a la derecha, -1 a la izquierda. */
  mira: 1 | -1;
  escala: number;
  /** 0 quieto, 1 aleteo a pleno. */
  aleteo: number;
  visible: boolean;
}

/** `ven` es lo que se ve del mundo de la escena en este cuadro, de lado a lado, con la cámara donde esté. */
function poseColibri(d: Datos, g: Geo, t: number, posDe: (i: number) => { x: number; y: number }, ven: { x0: number; x1: number }): PoseColibri {
  const s = Math.min(40 * g.k, Math.max(7 * g.k, g.r * 0.6));
  const oculto: PoseColibri = { x: 0, y: 0, mira: 1, escala: s, aleteo: 0, visible: false };
  // La pasada del principio: antes de que lleguen los nombres, el colibrí cruza la copa y se asoma a las flores que se abren. Es el que va
  // a elegir; no mira a nadie en particular (el mismo vuelo en todas las rondas), así que no delata a nadie.
  if (t >= T_PASADA[0] && t < T_PASADA[1]) {
    const u = (t - T_PASADA[0]) / (T_PASADA[1] - T_PASADA[0]);
    const y0 = g.copa.base - g.copa.alto * 0.62;
    // Cruza de izquierda a derecha, baja a mirar una flor del medio (se frena ahí) y sigue.
    const x = lerp(-g.w * 0.06, g.w * 1.06, u + 0.09 * Math.sin(u * Math.PI * 2));
    const y = y0 + Math.sin(u * Math.PI * 2) * g.copa.alto * 0.1 - Math.sin(u * Math.PI) * g.copa.alto * 0.12;
    return { x, y, mira: 1, escala: s, aleteo: 1, visible: true };
  }
  // El colibrí lejano de la primera calma: un punto verde que cruza el horizonte de un lado al otro.
  if (d.lejos && t >= d.lejos[0] && t < d.lejos[1] && t < d.tColibri0) {
    const u = (t - d.lejos[0]) / (d.lejos[1] - d.lejos[0]);
    return { x: lerp(-g.w * 0.05, g.w * 1.05, u), y: g.top + (g.suelo - g.top) * (0.14 + 0.05 * Math.sin(u * 9)), mira: 1, escala: s * 0.45, aleteo: 1, visible: true };
  }
  if (t < d.tColibri0) return oculto;
  // Si el lado de afuera no tiene lugar (un celular, una flor pegada al borde), se suspende del otro: nunca se corta.
  const vs = d.visitas.map((v): Visita => {
    const fx = posDe(v.quien).x;
    const afuera = fx + v.lado * (g.r * 0.95 + 4.6 * s);
    return afuera < 0 || afuera > g.w ? { ...v, lado: (v.lado > 0 ? -1 : 1) as 1 | -1 } : v;
  });
  // Con la cámara acercada, el borde del cuadro queda más cerca que el de la escena: el colibrí se achica lo justo para que entre
  // entero del lado de afuera de su flor (cola incluida), y nunca menos de la mitad.
  const tam = (v: Visita): number => {
    const fx = posDe(v.quien).x;
    const lugar = (v.lado > 0 ? ven.x1 - fx : fx - ven.x0) - 5 * g.k;
    return Math.max(s * 0.5, Math.min(s, (lugar - g.r * 0.95) / 4.05));
  };
  const punto = (v: Visita, sv: number, extra = 0): { x: number; y: number } => {
    const f = posDe(v.quien);
    return { x: f.x + v.lado * (g.r * 0.95 + 2.3 * sv + extra), y: f.y - g.r * 0.08 };
  };
  const primero = vs[0] as Visita;
  const s0 = tam(primero);
  const p0 = punto(primero, s0);
  // Entra por el costado de afuera de la primera, desde arriba.
  if (t < primero.llega) {
    const u = suave((t - d.tColibri0) / (primero.llega - d.tColibri0));
    const ini = { x: p0.x + primero.lado * g.w * 0.6, y: p0.y - (g.suelo - g.top) * 0.22 };
    return { x: lerp(ini.x, p0.x, u), y: lerp(ini.y, p0.y, u) - Math.sin(u * Math.PI) * g.r * 0.9, mira: (primero.lado > 0 ? -1 : 1) as 1 | -1, escala: lerp(s, s0, u), aleteo: 1, visible: true };
  }
  for (let m = 0; m < vs.length; m++) {
    const v = vs[m] as Visita;
    const ultima = m === vs.length - 1;
    const miraA = (v.lado > 0 ? -1 : 1) as 1 | -1;
    const sv = tam(v);
    const pa = punto(v, sv);
    // Suspendido frente a la flor, con el vaivén de un colibrí.
    if (t < v.sale) {
      return { x: pa.x + Math.sin(t * 5 + m) * sv * 0.06, y: pa.y + Math.sin(t * 11 + m) * sv * 0.1, mira: miraA, escala: sv, aleteo: 1, visible: true };
    }
    if (ultima) {
      // Calla el zumbido y mete el pico: se acerca despacio hasta que la punta toca el centro.
      const u = suave((t - v.sale) / T_SILENCIO);
      const f = posDe(v.quien);
      const dentro = { x: f.x + v.lado * (g.r * 0.2 + 2.3 * sv), y: f.y - g.r * 0.02 };
      // Del lado de afuera la cola ocupa 0,2 r + 4,05 s: si no entra, también se achica.
      const lugar = (v.lado > 0 ? ven.x1 - f.x : f.x - ven.x0) - 5 * g.k;
      const sf = Math.max(sv * 0.5, Math.min(sv, (lugar - g.r * 0.2) / 4.05));
      const df = { x: f.x + v.lado * (g.r * 0.2 + 2.3 * sf), y: dentro.y };
      return { x: lerp(pa.x, df.x, u), y: lerp(pa.y, df.y, u), mira: miraA, escala: lerp(sv, sf, u), aleteo: t >= d.tPico ? 0.12 : 1 - 0.85 * u, visible: true };
    }
    const sig = vs[m + 1] as Visita;
    if (t < sig.llega) {
      // Retrocede (vuela para atrás, mirando a la que deja) y se va a la otra por arriba.
      const u = c01((t - v.sale) / T_TRASIEGO);
      const ss = tam(sig);
      const pb = punto(sig, ss);
      const ctrl = { x: pa.x + v.lado * (g.r * 2.4 + 3 * sv), y: Math.min(pa.y, pb.y) - g.r * 1.8 - 2 * sv };
      const a = (1 - u) * (1 - u);
      const b = 2 * u * (1 - u);
      const c = u * u;
      const mira = u < 0.5 ? miraA : ((sig.lado > 0 ? -1 : 1) as 1 | -1);
      return { x: a * pa.x + b * ctrl.x + c * pb.x, y: a * pa.y + b * ctrl.y + c * pb.y, mira, escala: lerp(sv, ss, u), aleteo: 1, visible: true };
    }
  }
  return oculto;
}

/* ------------------------------------------------------------- los nombres */

/** Dónde queda tendida la flor `i`: debajo de su casilla, en la parte de abajo de la alfombra. */
function destinoDe(e: Escena, d: Datos, g: Geo, i: number): { x: number; y: number } {
  const c = casilla(e.rejilla, (e.puesto[i] as number) % e.rejilla.cap);
  return { x: c.x + (hashDe(i, 4) - 0.5) * e.rejilla.colW * 0.35, y: g.alfombra.y + g.alfombra.h * (0.76 + 0.2 * hashDe(i, 3)) };
}

/** Cuándo se termina de ir la última flor de una rama: cuando ya cayó, un momento más. */
const tPosa0 = (tUltimaCaida: number): number => tUltimaCaida + 0.6;

/** Una casilla de la alfombra que ya no está libre: la de más atrás se pisa con la de más adelante (anillo). */
const casillaDe = (e: Escena, i: number): { x: number; y: number } => casilla(e.rejilla, (e.puesto[i] as number) % e.rejilla.cap);

function chipDe(k: Kit, e: Escena, i: number): Container {
  let c = e.chips.get(i);
  if (c) return c;
  const { S } = k;
  const lado = e.rejilla.colW - 4 * k.pantalla().k;
  // El nivel del nombre baja hasta que entra: menos texto, nunca letra más chica.
  let nivel: number = e.nivel;
  c = S.chip(e.formas.formas[i]?.[nivel - 1] ?? k.nombres[i] ?? "", 1, k.nombres[i], null, false);
  while (c.width > lado && nivel > 1) {
    c.destroy({ children: true });
    nivel--;
    c = S.chip(e.formas.formas[i]?.[nivel - 1] ?? "", 1, k.nombres[i], null, false);
  }
  e.chips.set(i, c);
  e.capaChips.addChild(c);
  return c;
}

export const toborochiPixi = crearJuego<Datos, Escena>({
  id: "toborochi",
  textos: TEXTOS,
  plan: planToborochi,

  arma(k, plan, previa) {
    const { S } = k;
    const d = plan.datos;
    const p = k.pantalla();
    const g = geoDe({ w: p.w, h: p.h, k: p.k, top: p.top, bottom: p.bottom }, d.n);
    const raiz = previa?.raiz ?? new Container();
    if (!previa) S.scene.addChild(raiz);
    raiz.removeChildren().forEach((c) => c.destroy({ children: true }));
    for (const c of previa?.chips.values() ?? []) c.destroy({ children: true });
    previa?.capaChips.destroy({ children: true });
    pintarCielo(S.bg, p.w, p.h, g, S.dark);
    const nubes = new Graphics();
    S.bg.addChild(nubes);

    const suelo = new Graphics();
    const ramas = new Graphics();
    const aire = new Graphics();
    const remolino = new Graphics();
    const florRaiz = new Container();
    florRaiz.sortableChildren = true;
    const { raiz: colibri, alas } = hacerColibri();
    colibri.visible = false;
    raiz.addChild(suelo);
    const esc: Escena = {
      raiz, g, suelo, ramas, flores: [], aire, remolino, colibri, alas, capaChips: new Container(), chips: new Map(),
      tCorona: previa?.tCorona ?? null, sacudidas: previa?.sacudidas ?? new Set(), musica: previa?.musica ?? false, ramaFin: [], sinBlur: previa?.sinBlur ?? false,
      formas: planNombres(k.nombres as string[]), nivel: 4, rejilla: { cols: 1, rows: 1, cap: 1, colW: 100, rowH: 30, x: 0, y: 0 }, puesto: [], nubes,
    };
    esc.ramaFin = Array.from({ length: d.dis.ramas }, (_, r) => Math.max(...d.lugar.map((l, i) => (l.rama === r ? (d.tCae[i] as number) : -Infinity))));
    pintarSuelo(esc, S.dark);
    pintarTronco(raiz, g, S.dark);
    raiz.addChild(ramas, florRaiz, aire, colibri, remolino);

    // Las flores: con cara hasta sesenta y cuatro; con más, solo la flor.
    const conCara = d.n <= 64;
    for (let i = 0; i < d.n; i++) {
      const f = hacerFlor(i, g.r, conCara ? k.figura(i) : null, S.dark);
      florRaiz.addChild(f.raiz);
      esc.flores.push(f);
    }
    // La alfombra: el nombre que entra en la casilla, y cuántas casillas hay.
    const letra = k.letra("nombre");
    const colW = p.retrato ? p.w * 0.46 : Math.max(150 * p.k, p.w * 0.15);
    esc.nivel = nivelQueCabe(colW - 14 * p.k, (nv) => mediana(esc.formas.formas.map((f) => anchoAprox(f[nv - 1] as string, letra) + 16 * p.k)));
    const muestra = S.chip("Mg", 1, undefined, null, false);
    const chipH = muestra.height;
    muestra.destroy({ children: true });
    esc.rejilla = rejillaDe(g, colW, chipH);
    esc.puesto = new Array<number>(d.n).fill(0);
    const orden = Array.from({ length: d.n }, (_, i) => i).filter((i) => Number.isFinite(d.tCae[i])).sort((a, b) => tPosa(d, a) - tPosa(d, b) || a - b);
    orden.forEach((i, r) => (esc.puesto[i] = r));
    S.hud.addChild(esc.capaChips);
    // Los chips de las que caen se arman ahora y no a mitad del show: nada se crea por cuadro y la misma ronda dibuja lo mismo.
    for (const i of orden) chipDe(k, esc, i).visible = false;
    // Para el auditor de emoción: la flor de quien gana, entera, en la pantalla de ese cuadro.
    S.ganadorEn(() => {
      const f = esc.flores[d.ganador];
      if (!f) return null;
      const z = k.cam.toScreen(1, 0, p.w, p.h).x - k.cam.toScreen(0, 0, p.w, p.h).x;
      const c = k.cam.toScreen(f.raiz.x, f.raiz.y, p.w, p.h);
      const r = g.r * f.raiz.scale.x * 1.05 * z;
      return { x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r };
    });
    k.cam.cut(p.w / 2, (p.top + p.bottom) / 2, 1);
    if (!previa) S.onCleanup(() => musicHold(false));
    return esc;
  },

  cuadro(k, plan, e, t) {
    const d = plan.datos;
    const { S } = k;
    const g = e.g;
    const p = k.pantalla();
    if (k.coronado && e.tCorona === null) e.tCorona = t;
    const tau = e.tCorona === null ? -1 : t - e.tCorona;
    const { fase, ola } = faseDe(d, t);
    const w = vientoEn(d, t);

    // Desde «quedan dos» la cámara se acerca a las dos: sin desenfoque, que los nombres se lean.
    if (t >= d.tQuedan0 && !e.sinBlur) {
      e.sinBlur = true;
      k.cam.noBlur();
    }

    // El silencio: el viento para al quedar dos y la música calla cuando el colibrí se suspende frente a la primera flor, hasta el golpe.
    const quiereCalla = t >= (d.visitas[0]?.llega ?? d.tQuedan0) && !k.coronado;
    if (quiereCalla !== e.musica) {
      e.musica = quiereCalla;
      musicHold(quiereCalla);
    }

    // El cielo: se nubla de a poco y se aclara con el golpe. Solo el cielo; las flores no se tocan.
    // En el silencio del colibrí el cielo se va oscureciendo de a poco: así el golpe no es un salto de claro a oscuro y a claro (un destello), sino un cielo que ya venía apagándose y se aclara.
    const dimSilencio = 0.85 * suave((t - (d.tQuedan0 + T_QUEDAN)) / Math.max(0.5, d.tPico - d.tQuedan0 - T_QUEDAN));
    const nube = Math.max(nubladoEn(d, t), dimSilencio) * (tau >= 0 ? 1 - suave((tau - 0.5) / 2.4) : 1);
    e.nubes.clear().rect(0, 0, p.w, g.suelo).fill({ color: S.dark ? 0x2b2542 : 0x6c7893, alpha: nube * 0.7 });

    /* ----------------------------------------------------- las flores */
    const pos = new Array<ReturnType<typeof dondeEsta>>(d.n);
    for (let i = 0; i < d.n; i++) pos[i] = dondeEsta(d, g, i, t, w, destinoDe(e, d, g, i));
    const posDe = (i: number): { x: number; y: number } => pos[i] as { x: number; y: number };

    const lugarGanadora = d.lugar[d.ganador] as Lugar;
    for (let i = 0; i < d.n; i++) {
      const f = e.flores[i] as Flor;
      const q = pos[i] as ReturnType<typeof dondeEsta>;
      f.raiz.position.set(q.x, q.y);
      let esc = q.escala;
      let rot = q.rot;
      f.brillo.clear();
      const gana = i === d.ganador;
      if (tau >= 0 && (gana || (d.rivalGana && i === d.rival))) {
        // La flor se enciende: crece, late y suelta luz dorada.
        const u = suave(tau / 0.4);
        const pulso = 1 + 0.06 * Math.sin(tau * 7) * u;
        esc *= (1 + (gana ? 0.4 : 0.22) * u) * pulso;
        const alfa = (gana ? 0.22 : 0.16) * u;
        f.brillo.circle(0, 0, g.r * 3.2).fill({ color: 0xffd36a, alpha: alfa * 0.35 }).circle(0, 0, g.r * 2.1).fill({ color: 0xffe08a, alpha: alfa * 0.6 }).circle(0, 0, g.r * 1.35).fill({ color: 0xfff1b8, alpha: alfa });
        rot += Math.sin(tau * 5) * 0.05;
      } else if (d.causa[i] === "premio" && q.cae > 0 && q.cae < 1) {
        // Se va con premio: un brillo dorado que la acompaña hasta el suelo.
        f.brillo.circle(0, 0, g.r * 1.9).fill({ color: 0xffd36a, alpha: 0.4 * (1 - q.cae) });
      }
      f.raiz.scale.set(esc);
      f.raiz.rotation = q.suelo ? 0 : rot;
      // Tendida en el suelo: aplastada, como pétalos sobre el pasto.
      if (q.suelo) f.raiz.scale.set(esc, esc * 0.5);
      f.raiz.alpha = q.suelo ? 0.92 : 1;
      f.raiz.zIndex = q.suelo ? 0 : 1;
    }

    /* ---------------------------------------- las ramas y el viento en el aire */
    e.ramas.clear();
    const pie = { x: g.cx, y: g.copa.base };
    const doblaDe = (v: number): number => w * g.copa.ancho * 0.048 * (0.3 + 0.7 * v);
    const ancho = Math.max(2, g.troncoAncho * 0.12);
    for (let r = 0; r < d.dis.ramas; r++) {
      const ang = d.dis.ramaAng[r] as number;
      const lar = d.dis.ramaLargo[r] as number;
      const fin = { u: Math.sin(ang) * lar, v: Math.cos(ang) * lar - 0.04 };
      const q = puntoDe(g, fin);
      const x1 = q.x + doblaDe(fin.v);
      const y1 = q.y;
      // Una rama que se quedó sin flores se desvanece: no queda un palo pelado ocupando la pantalla.
      const sinFlores = e.ramaFin[r] as number;
      const alfaRama = Number.isFinite(sinFlores) ? 1 - suave((t - tPosa0(sinFlores)) / 0.7) : 1;
      if (alfaRama <= 0.01) continue;
      e.ramas.moveTo(pie.x, pie.y).quadraticCurveTo(pie.x + (x1 - pie.x) * 0.15, lerp(pie.y, y1, 0.55), x1, y1).stroke({ width: ancho, color: S.dark ? 0x6f6a58 : 0x7d6e58, cap: "round", alpha: alfaRama });
    }
    // Las ramitas: de cada flor que sigue en el árbol a la rama de su abanico.
    for (let i = 0; i < d.n; i++) {
      if (t >= (d.tCae[i] as number)) continue;
      const l = d.lugar[i] as Lugar;
      const r = l.rama;
      const ang = d.dis.ramaAng[r] as number;
      const lar = d.dis.ramaLargo[r] as number;
      const dir = { u: Math.sin(ang), v: Math.cos(ang) };
      const tp = Math.max(0.1, Math.min(lar, l.u * dir.u + (l.v + 0.04) * dir.v));
      const pr = puntoDe(g, { u: dir.u * tp, v: dir.v * tp - 0.04 });
      const px = pr.x + doblaDe(dir.v * tp - 0.04);
      const f = pos[i] as ReturnType<typeof dondeEsta>;
      e.ramas.moveTo(px, pr.y).lineTo(f.x, f.y).stroke({ width: Math.max(1, ancho * 0.5), color: S.dark ? 0x6f6a58 : 0x7d6e58, cap: "round" });
    }
    // El viento: unas rayas largas que cruzan de izquierda a derecha, y pétalos que se lleva.
    e.aire.clear();
    if (w > 0.04 && ola) {
      const fr = frenteEn(d, t);
      for (let m = 0; m < 14; m++) {
        const y = g.top + (g.suelo - g.top) * (0.05 + 0.85 * hashDe(m, 31 + ola.j));
        const ini = hashDe(m, 32 + ola.j) * 0.6;
        const u = c01((fr + 0.2 - ini) / 0.9);
        if (u <= 0 || u >= 1) continue;
        const x0 = lerp(-g.w * 0.1, g.w * 1.1, u);
        const largo = g.w * (0.1 + 0.12 * hashDe(m, 33));
        e.aire.moveTo(x0 - largo, y + Math.sin(u * 6 + m) * 6 * g.k).quadraticCurveTo(x0 - largo / 2, y - 10 * g.k, x0, y + Math.sin(u * 6 + m + 1) * 6 * g.k).stroke({ width: Math.max(1.5, 2 * g.k), color: 0xffffff, alpha: 0.45 * w });
      }
      for (let m = 0; m < 18; m++) {
        const u = c01((fr + 0.15 - hashDe(m, 41) * 0.5) / 0.9);
        if (u <= 0 || u >= 1) continue;
        const x = lerp(g.w * 0.25, g.w * 1.05, u);
        const y = g.copa.base - g.copa.alto * (0.2 + 0.7 * hashDe(m, 42)) + u * g.copa.alto * 0.3 + Math.sin(u * 9 + m) * 10 * g.k;
        e.aire.ellipse(x, y, 4 * g.k, 2.6 * g.k).fill({ color: 0xff97c6, alpha: 0.85 * (1 - u * 0.5) });
      }
    }
    // En cada ráfaga, un sacudón chico de la cámara cuando cruza el frente, y una inclinación leve de toda la escena.
    if (ola && w > 0.55 && !e.sacudidas.has(ola.j)) {
      e.sacudidas.add(ola.j);
      k.cam.shake(2.6 * p.k).punch(0.01);
    }
    S.scene.rotation += w * 0.012;

    /* -------------------------------------------------------- el colibrí */
    const z0 = k.cam.toScreen(0, 0, p.w, p.h).x;
    const zz = Math.max(0.05, k.cam.toScreen(1, 0, p.w, p.h).x - z0);
    const pc = poseColibri(d, g, t, posDe, { x0: -z0 / zz, x1: (p.w - z0) / zz });
    e.colibri.visible = pc.visible;
    if (pc.visible) {
      e.colibri.position.set(pc.x, pc.y);
      e.colibri.scale.set(pc.escala * pc.mira, pc.escala);
      const ritmo = pc.aleteo;
      (e.alas[0] as Graphics).rotation = (Math.sin(t * 58) * 0.85 + 0.2) * ritmo;
      (e.alas[1] as Graphics).rotation = (Math.sin(t * 58 + 1.7) * 0.85 + 0.2) * ritmo;
    }

    /* ------------------------------------ el golpe: los pétalos suben en remolino */
    e.remolino.clear();
    if (tau >= 0 && tau < 3.2) {
      const q = pos[d.ganador] as ReturnType<typeof dondeEsta>;
      const suelo = Array.from({ length: d.n }, (_, i) => i).filter((i) => (pos[i] as ReturnType<typeof dondeEsta>).suelo).slice(0, 48);
      suelo.forEach((i, m) => {
        const o = pos[i] as ReturnType<typeof dondeEsta>;
        const u = suave((tau - 0.1 - 0.5 * hashDe(i, 51)) / 2.2);
        if (u <= 0 || u >= 1) return;
        const an = hashDe(i, 52) * 6.28 + u * (5 + 3 * hashDe(i, 53));
        const rad = (1 - u) * g.w * 0.12 * hashDe(i, 54) + g.r * 1.2 * u;
        const x = lerp(o.x, q.x, u) + Math.cos(an) * rad;
        const y = lerp(o.y, q.y, u) - Math.sin(u * Math.PI) * g.copa.alto * 0.25 + Math.sin(an) * rad * 0.5;
        // Los pétalos suben y se acercan, pero ninguno tapa la cara de quien gana.
        if (Math.hypot(x - q.x, y - q.y) < g.r * 1.5) return;
        e.remolino.ellipse(x, y, Math.max(2, g.r * 0.3), Math.max(1.4, g.r * 0.2)).fill({ color: m % 3 ? 0xff97c6 : 0xffd36a, alpha: 0.7 * (1 - u * 0.4) });
      });
    }

    /* ------------------------------------------------------------ los nombres */
    nombres(k, d, e, g, t, fase, pos);
  },
});

/* ------------------------------------------------------------------------ los nombres */

function nombres(k: Kit, d: Datos, e: Escena, g: Geo, t: number, fase: string, pos: ReturnType<typeof dondeEsta>[]): void {
  const { S } = k;
  const p = k.pantalla();
  const alto = (i: number): { x: number; y: number } => {
    const q = pos[i] as ReturnType<typeof dondeEsta>;
    return k.cam.toScreen(q.x, q.y - g.r * 0.9, p.w, p.h);
  };
  /* Los de a ocho en la brisa; hasta ocho de las que quedan en cada calma y hasta seis durante las ráfagas (cinco y tres en un celular), para saber quién sigue. */
  let quienes: number[] = [];
  // En un celular entran menos nombres a la vez: de a cinco en la brisa, hasta seis en las calmas y tres en las ráfagas.
  const chico = p.retrato;
  if (fase === "tandas" && d.tTandas) quienes = S.batch(d.n, t, d.tTandas[0], d.tTandas[1], undefined, chico ? 5 : 8);
  else if (fase === "calma" || fase === "ola") {
    const vivos = enElArbolEn(d, t).filter((i) => !(k.coronado));
    quienes = vivos
      .map((i) => ({ i, h: hashDe(i, 61) }))
      .sort((a, b) => a.h - b.h || a.i - b.i)
      .slice(0, fase === "calma" ? (chico ? 5 : 8) : chico ? 3 : 6)
      .map((x) => x.i);
  } else if ((fase === "quedan" || fase === "colibri") && !d.sinNombres && !k.coronado) quienes = [d.ganador, d.rival];
  // El contador de arriba a la izquierda no se tapa.
  // El contador lleva el total («QUEDAN  18 DE 18») y debajo la fila de marcas: se reserva lo que miden.
  const reserva = reservaDeMarcas(d.n, S.u(), p.w);
  const contador = { x: 0, y: S.top() - 4 * p.k, width: Math.max(anchoMarcador(textoMarcador(k.txt("marcadorQuedan"), d.n, { de: k.txt("marcadorDe"), cuantos: d.n }), S.u()), reserva.ancho), height: 74 * p.k + reserva.alto };
  S.tags(k.nombres as string[], quienes, alto, [contador]);

  /* Los nombres de las que caen y los de la alfombra. */
  const vivosEnElSuelo: number[] = [];
  let aterrizadas = 0;
  for (let i = 0; i < d.n; i++) if (Number.isFinite(d.tCae[i]) && t >= tPosa(d, i)) aterrizadas++;
  for (const c of e.chips.values()) c.visible = false;
  for (let i = 0; i < d.n; i++) {
    if (!Number.isFinite(d.tCae[i]) || t < (d.tCae[i] as number)) continue;
    const q = pos[i] as ReturnType<typeof dondeEsta>;
    const slot = casillaDe(e, i);
    const aterrizo = t >= tPosa(d, i);
    if (aterrizo) {
      // Sigue en la alfombra mientras no la pise otra: se muestran las últimas que entran en la rejilla.
      if ((e.puesto[i] as number) < aterrizadas - e.rejilla.cap) continue;
      const c = chipDe(k, e, i);
      c.visible = true;
      c.alpha = 1 - suave((t - d.tQuedan0) / 0.5);
      if (c.alpha < 0.02) c.visible = false;
      c.position.set(slot.x - c.width / 2, slot.y - c.height / 2);
      vivosEnElSuelo.push(i);
    } else if (d.vuelo[i]) {
      const c = chipDe(k, e, i);
      const f = q.cae;
      const s = k.cam.toScreen(q.x, q.y - g.r * 1.1, p.w, p.h);
      // Va con la flor y, al final de la caída, se acomoda en su casilla.
      const m = suave((f - 0.7) / 0.3);
      const x = lerp(s.x - c.width / 2, slot.x - c.width / 2, m);
      const y = lerp(s.y - c.height / 2, slot.y - c.height / 2, m);
      c.visible = true;
      c.alpha = suave(f * 8);
      c.position.set(Math.max(4 * p.k, Math.min(p.w - c.width - 4 * p.k, x)), Math.max(S.top() + 2 * p.k, y));
    }
  }
}
