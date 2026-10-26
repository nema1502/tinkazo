import { Container, Graphics, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, shorten, winnersLabel } from "../overlay";
import { CONTADOR, medidasContador, CREAM, INK, MONO, YELLOW, mountPixi, type FocoAt, type PixiStage } from "./stage";
import { tiemposFoco } from "./foco";
import { colorDeNombre } from "./foco-vista";
import { cabe, centrar, encuadrar, unir, type Caja, type Zona } from "./encuadre";
import { avatarColor } from "../../avatar";
import { assignSlots } from "./slots";
import { planQualifier } from "./qualifier";
import { HAND, MOUTH, SAPO_MAX, holeLayout, optsForArc, planThrows, throwTime, type Point, type Throw } from "./sapo-plan";

/**
 * El sapo.
 *
 * El juego de las ferias y los patios de Perú, Bolivia y Colombia: un
 * cajón de madera pintado, con una rana de bronce encima y agujeros en la
 * tapa. Desde lejos se tiran argollas: unas pegan en la madera y se
 * van, otras bailan en el borde de un agujero y salen, y la última de cada
 * ganador cae en su agujero. Cada agujero lleva el nombre de alguien.
 *
 * El juego no decide nada. Los ganadores salen del protocolo antes de que
 * empiece, los tiros se planean desde sus agujeros (`sapo-plan.ts`, puro y
 * probado) y este archivo solo los dibuja y los cuenta.
 *
 * Aguanta cualquier cantidad de gente: en la mesa entran 12 agujeros, así que
 * con más nombres empieza con una clasificatoria (`qualifier.ts`). Aparecen
 * todos, se tachan en oleadas hasta que quedan 12 finalistas (siempre con los
 * ganadores adentro) y esos vuelan a sus agujeros. Con 12 o menos, los nombres
 * vuelan directo. Así la pantalla se mueve desde el primer cuadro.
 *
 * Rediseñado el 2 de octubre de 2026 desde el que propuso Guido Salazar
 * (@GuidoSV7): la revisión visual lo vio como una mesa de póker (óvalo de paño verde y una
 * moneda dorada) y sin un solo nombre en la mesa.
 *
 * Todo sale de la hora del juego (`dt`), nunca del reloj de la pared.
 */

/** Lo que tarda cada parte de la entrada. */
const Q_SHOW = 1.0;
const Q_WAVE = 1.25;
const Q_FLY = 1.1;
const HANG_FIRST = 0.9;
const HANG_FINAL = 1.8;
const HANG_SMALL = 0.5;
/** Después de caer: el rebote y la salida, el baile en el borde, o hundirse en el agujero. */
const AFTER_MISS = 0.8;
const AFTER_NEAR = 1.3;
const AFTER_HIT = 1.0;
/**
 * No se acorta: "¡ADENTRO!" abre el remate de la música al caer, y el remate
 * rasguea casi dos segundos. Con 1,3 y con 1,6 el cartel llegaba encima del
 * rasgueo y el golpe del ganador sonaba más bajo que lo de antes (auditor de
 * mezcla, 7 de octubre de 2026: −4,6 y −8,1 LU).
 */
const AFTER_FINAL = 2.0;
/** La parte de AFTER_NEAR que la argolla baila en el borde antes de salir. */
const WOBBLE = 0.8;
const SINK = 0.5;
/** Lo que tarda la mano en tomar impulso antes de soltar. */
const WINDUP = 0.35;
/** En el susto, qué parte del último vuelo llega hasta el labio de la rana. */
const LABIO = 0.62;
/**
 * La boca (un fallo que entra a la rana, una vez por show): cuánto tarda en
 * hundirse la argolla, cuándo sale escupida y cuánto vuela hasta el aro.
 */
const BOCA_IN = 0.3;
const BOCA_SPIT = 0.45;
const BOCA_FLY = 0.5;
/** Lo que dura la boca entera: tragar, escupir, y rodar afuera como cualquier fallo. */
const BOCA_AFTER = BOCA_SPIT + BOCA_FLY + AFTER_MISS;

interface Toss {
  th: Throw;
  i: number;
  /** El participante (índice entre los finalistas) de este turno. */
  name: number;
  slot: number;
  grand: boolean;
  final: boolean;
  start: number;
  land: number;
  end: number;
  flight: number;
  announced: boolean;
  thrown: boolean;
  landed: boolean;
  /** La boca: si ya se escupió (el sonido y la frase salen una vez). */
  spat: boolean;
}

export async function sapoPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  // El último tiro es un acercamiento lento: con desenfoque, la mesa se veía
  // borrosa justo cuando todos miran la argolla.
  cam.noBlur();
  const all = names.length;
  // Los premios se tiran del último al primero, como en una premiación: el
  // turno largo, con la remontada, los "casi" y el acercamiento, es el del
  // primer premio. Antes el primero se decidía a los seis segundos, cuando la
  // sala recién miraba, y todo el suspenso era para el tercero. El cartel y el
  // relator del final siguen con el orden de `winners`. Con un solo premio no
  // cambia nada.
  const prizesAll = winners.length ? [...winners].reverse() : [0];

  /* ------------------------------------------------------------ la clasificatoria */
  let Q: ReturnType<typeof planQualifier>;
  try {
    Q = planQualifier(all, prizesAll, SAPO_MAX, rng);
  } catch {
    // Más ganadores que agujeros, o un ganador inválido: nunca dejar el sorteo colgado.
    S.cleanup();
    return;
  }
  const fin = Q.finalists;
  const n = fin.length;
  const prizes = Q.finalWinners;
  const total = prizes.length;
  const last = total - 1;
  const waves = Q.waves;
  const T_FLY = Q_SHOW + waves.length * Q_WAVE;
  const T_SEATED = T_FLY + Q_FLY;

  const L = holeLayout(n);
  const holes = L.holes.length;
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  S.mark("arco", story.arc);
  S.mark("sapo", `${holes}/${all}`);
  const plan = assignSlots(n, prizes, rng);
  let throws: Throw[];
  try {
    throws = planThrows(n, plan.winnerSlots, rng, optsForArc(story.arc), true);
  } catch {
    S.cleanup();
    return;
  }
  /** En el susto la rana deja de ser decoración: el último tiro pega en su labio y rebota al agujero. */
  const labio = story.arc === "susto";
  /**
   * El color de la cara de cada persona, para el aro de su agujero. El
   * amarillo es de la argolla y del ganador: un aro amarillo desde el
   * principio parecía ya elegido, así que esas caras llevan el aro crema.
   */
  const colorDe = (i: number): number => {
    const c = parseInt((avatarColor(names[i] ?? "") || "#ffc629").replace("#", ""), 16);
    return c === YELLOW ? CREAM : c;
  };
  /** El índice original de quien está en el agujero `s`. */
  const whoAt = (s: number): number => fin[plan.nameAt[s] as number] as number;
  const nameOfSlot = (s: number): string => names[whoAt(s)] ?? "";
  /** El agujero de cada participante original que llegó a la final. */
  const slotOfName = new Map<number, number>();
  for (let s = 0; s < holes; s++) slotOfName.set(whoAt(s), s);
  /** El número de premio del turno `turn`: se tiran del último al primero. */
  const premioDe = (turn: number): number => total - turn;

  /* ---------------------------------------------------------------- el guion */
  const tosses: Toss[] = [];
  let tt = T_SEATED;
  throws.forEach((th, i) => {
    const final = i === throws.length - 1;
    const grand = th.turn === last;
    tt += i === 0 ? HANG_FIRST : final ? HANG_FINAL : HANG_SMALL;
    const flight = throwTime(th.kind, grand);
    const after = th.boca ? BOCA_AFTER : th.kind === "miss" ? AFTER_MISS : th.kind === "near" ? AFTER_NEAR : final ? AFTER_FINAL : AFTER_HIT;
    const start = tt;
    tosses.push({
      th, i, name: prizes[th.turn] as number, slot: plan.winnerSlots[th.turn] as number, grand, final,
      start, land: start + flight, end: start + flight + after, flight,
      announced: false, thrown: false, landed: false, spat: false,
    });
    tt = start + flight + after;
  });
  const T_CROWN = tt;
  /** Cuándo cae la última argolla: ahí va el respiro de la música. */
  const T_LAND = (tosses[tosses.length - 1] as Toss).land;
  /** Desde cuándo sube el zoom de emoción: cuando tira la última argolla, hasta la corona. */
  const T_EMPUJE = (tosses[tosses.length - 1] as Toss).start;
  /** El foco de la coronación: cuándo golpea y cuándo sale el cartel (`foco.ts`). */
  const FOCO = tiemposFoco(story.arc);
  setGameLength(T_CROWN, WINNER_HOLD + FOCO.placa);

  /* ---------------------------------------------------------------- geometría */
  /**
   * Dónde está la mano que tira, en unidades de la mesa: sobre la esquina de
   * abajo a la derecha en una pantalla ancha, y debajo de la mesa en un
   * celular, donde al costado achicaba la mesa y salía cortada.
   */
  const handPoint = (): Point => (S.portrait() ? { x: 0.9, y: L.tableR + 0.5 } : { x: HAND.x * 0.86, y: HAND.y * 0.82 });
  /** Lo que mide el chip de cada nombre a escala 1, en unidades de `S.u()`. Se mide al armar. */
  let anchoNombre: number[] = [];
  /** Lo que mide de alto un chip a escala 1, con su sombra, en unidades de `S.u()`. */
  let altoNombre = 25;
  const G = (): { w: number; h: number; k: number; cx: number; cy: number; sc: number; br: number; tilt: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    const topY = S.top() + 54 * k, botY = h - S.bottom() - 6 * k;
    const hp = handPoint();
    // En un celular la tapa se ve más de frente, para usar el alto de la pantalla.
    const tilt = S.portrait() ? 0.95 : 0.62;
    let ancho = S.portrait() ? (w * 0.46) / L.tableR : Math.min((w * 0.4) / L.tableR, (w * 0.47) / (hp.x + 0.35));
    if (S.portrait() && anchoNombre.length) {
      // En un celular la mesa ocupaba casi todo el ancho y los nombres de los
      // costados volvían sobre su agujero. Se achica lo justo para que el más
      // largo entre afuera, y no menos de un tercio del ancho.
      for (let s = 0; s < holes; s++) {
        const h = L.holes[s] as Point;
        const ux = h.x / (Math.hypot(h.x, h.y) || 1);
        if (Math.abs(ux) <= 0.35) continue;
        const W = (anchoNombre[whoAt(s)] ?? 0) * k * labelScale();
        ancho = Math.min(ancho, (w / 2 - 6 * k - W) / (Math.abs(h.x) + L.holeR * 1.45 * Math.abs(ux)));
      }
      ancho = Math.max(ancho, (w * 0.4) / L.tableR);
    }
    // Lo que ocupa de alto: desde el borde de arriba del cajón hasta lo más bajo
    // entre su borde de abajo y la mano, más el frente con los cajoncitos.
    const arriba = L.tableR * 1.03, abajo = Math.max(hp.y, L.tableR * 1.03), frente = 46 * k;
    const sc = Math.max(8, Math.min(ancho, (botY - topY - frente) / ((arriba + abajo) * tilt)));
    const sobra = botY - topY - ((arriba + abajo) * tilt * sc + frente);
    const cy = topY + Math.max(0, sobra) / 2 + arriba * tilt * sc;
    // La argolla, grande: con 25 px no se seguía con la vista.
    return { w, h, k, cx: w / 2, cy, sc, br: clamp(sc * 0.13, 8 * k, 20 * k), tilt };
  };
  let g = G();
  const P = (p: Point): Point => ({ x: g.cx + p.x * g.sc, y: g.cy + p.y * g.sc * g.tilt });
  /** Dónde va el nombre de un agujero: afuera, del lado opuesto a la rana, pegado al aro. */
  const labelAt = (s: number): Point => {
    const h = L.holes[s] as Point;
    const d = Math.hypot(h.x, h.y) || 1;
    return { x: h.x + (h.x / d) * L.holeR * 1.45, y: h.y + (h.y / d) * L.holeR * 1.45 };
  };
  /**
   * Cómo se ancla el chip del agujero `s`: por su borde de adentro. A la
   * derecha de la rana el chip crece hacia la derecha, a la izquierda hacia
   * la izquierda, y arriba y abajo se centra. Centrado, un chip ancho volvía
   * sobre su propio agujero.
   */
  const anchorOf = (s: number): { ax: number; ay: number } => {
    const h = L.holes[s] as Point;
    const d = Math.hypot(h.x, h.y) || 1;
    const ux = h.x / d, uy = h.y / d;
    return { ax: ux > 0.35 ? 0 : ux < -0.35 ? 1 : 0.5, ay: uy < -0.6 ? 1 : uy > 0.6 ? 0 : 0.5 };
  };
  /** El cajón entero en la escena, con su frente: lo que dibuja `drawBox`, sin la sombra. */
  const mesa = (): Caja => {
    const R = L.tableR * g.sc;
    const w = R * 2.1, d = R * 2.05 * g.tilt;
    return { x: g.cx - w / 2, y: g.cy - d / 2, w, h: d + 46 * g.k };
  };
  /** Lo que se ve del juego: debajo de la barra de arriba y encima del relator. */
  const zonaJuego = (): Zona => ({ x0: 4 * g.k, y0: S.top(), x1: g.w - 4 * g.k, y1: g.h - S.bottom() });
  /** Debajo de donde sale el cartel del ganador, encima del relator y sin pegarse a los costados. */
  const zonaFinal = (): Zona => ({ x0: 8 * g.k, y0: S.placaBajo(winners.length) + 4 * g.k, x1: g.w - 8 * g.k, y1: g.h - S.bottom() - 6 * g.k });

  /* ------------------------------------------------------------------ capas */
  const floor = new Graphics();
  S.bg.addChild(floor);
  const boxG = new Graphics();
  const frogG = new Graphics();
  const fx = new Graphics();
  const tokG = new Graphics();
  const handG = new Graphics();
  S.scene.addChild(boxG, frogG, fx, tokG, handG);
  const strikeG = new Graphics();
  const chipLayer = new Container();
  S.hud.addChild(chipLayer, strikeG);
  // El contador de la casa, como el de la piñata: arriba a la izquierda.
  const counterBox = new Graphics();
  const counter = S.text("", { fontFamily: MONO, fontSize: CONTADOR.fuente, fontWeight: "700", fill: CREAM });
  counter.anchor.set(0.5);
  const counterG = new Container();
  counterG.addChild(counterBox, counter);
  S.hud.addChild(counterG);
  // "¡Casi!" como calcomanía amarilla, legible desde el fondo.
  const almostBox = new Graphics();
  const almost = S.text("", { fontSize: 26, fontWeight: "900", fill: INK });
  almost.anchor.set(0.5);
  const almostG = new Container();
  almostG.addChild(almostBox, almost);
  almostG.alpha = 0;
  S.hud.addChild(almostG);
  // Detrás del chip de quien gana, un resplandor amarillo.
  const glowG = new Graphics();
  S.hud.addChildAt(glowG, 0);
  const badgeLayer = new Container();
  const badgeOf = new Map<number, Text>();
  S.hud.addChild(badgeLayer);

  /** Un chip por nombre de la lista original, con su cara. Los finalistas terminan siendo los nombres de los agujeros. */
  let chips: Container[] = [];
  /** Dónde estaba cada chip en la grilla de la clasificatoria (pantalla). */
  let gridAt: Point[] = [];
  let gridScale = 1;
  /**
   * El tamaño de los nombres de la mesa, sobre la base legible (CHIP_SCALE).
   * En un celular no hay lugar entre la mesa y el borde: con la base, y aun a
   * 0,75, los nombres de los costados no entraban y se apagaban, 5 de 12
   * (16 de octubre de 2026). Ahí quedan como estaban antes de la base nueva.
   * En horizontal, 0,9 sobre CHIP_SCALE (1,6) da la letra de 17 px de antes: con
   * 1,45 el chip salía 1,6 veces más grande, y en 4:3 y 5:4 los de los costados
   * no entraban entre la mesa y el borde (revisión del 20 de octubre de 2026).
   */
  const labelScale = (): number => (S.portrait() ? 0.6 : 0.9);
  /** Nombre y `n` letras del apellido: "María Q.", "María Qu.". En la mesa entran doce, y el nombre entero no. */
  const corto = (nm: string, n = 1): string => {
    const p = nm.trim().split(/\s+/);
    if (p.length < 2) return Array.from(nm.trim()).length > 13 ? shorten(nm.trim(), 13) : nm.trim();
    const ap = Array.from(p.slice(1).join(" "));
    // Si el corte cae en el fin de una palabra, "Peña." se leería como el apellido entero.
    if (n >= ap.length || ap[n] === " " || ap[n - 1] === " ") return shorten(nm.trim(), 18);
    return `${p[0]} ${ap.slice(0, n).join("")}.`;
  };

  /**
   * La etiqueta de cada nombre: la más corta que no choque con la de otra
   * persona. "María Q." dos veces pasa a "María Qu." y "María Qs."; si no
   * alcanza, el nombre entero acortado por el medio.
   */
  const etiqueta: string[] = (() => {
    const out = names.map((nm) => corto(nm));
    for (let n = 2; n <= 6; n++) {
      const veces = new Map<string, number>();
      for (const c of out) veces.set(c, (veces.get(c) ?? 0) + 1);
      let quedan = false;
      names.forEach((nm, i) => {
        if ((veces.get(out[i] as string) ?? 0) > 1) {
          out[i] = corto(nm, n);
          quedan = true;
        }
      });
      if (!quedan) break;
    }
    const veces = new Map<string, number>();
    for (const c of out) veces.set(c, (veces.get(c) ?? 0) + 1);
    return names.map((nm, i) => ((veces.get(out[i] as string) ?? 0) > 1 ? shorten(nm, 18) : (out[i] as string)));
  })();

  const build = (): void => {
    g = G();
    const k = g.k;
    // El piso de un patio: baldosas grandes, del color del tema.
    floor.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1e1830 : 0xf3e3c3);
    const tile = 64 * k;
    for (let y = 0; y < g.h + tile; y += tile) {
      for (let x = (Math.floor(y / tile) % 2) * (tile / 2) - tile; x < g.w + tile; x += tile) {
        floor.rect(x + 2, y + 2, tile - 4, tile - 4).fill({ color: S.dark ? 0x2a2140 : 0xe8d3ab, alpha: 0.55 });
      }
    }
    chipLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    chips = names.map((nm) => {
      // La cara es la del nombre entero: con la etiqueta corta salía la cara de otra persona.
      const c = S.chip(etiqueta[names.indexOf(nm)] ?? corto(nm), 1, nm);
      c.visible = false;
      chipLayer.addChild(c);
      return c;
    });
    anchoNombre = chips.map((c) => c.width / k);
    altoNombre = (chips[0]?.height ?? 25 * k) / k;
    g = G();
    // La grilla de la clasificatoria: todos los nombres a la vista, del tamaño
    // que entre. Las celdas miden lo que el chip más ancho y su alto de verdad:
    // con las de 150 por 30 de antes, los chips de letra legible se pisaban
    // (16 de octubre de 2026).
    let top = S.top() + 54 * k, bottom = g.h - S.bottom() - 10 * k;
    let areaW = g.w * 0.94;
    // Con doce o menos no hay clasificatoria: la grilla es la presentación de la
    // mesa, y tiene que caer sobre la tapa, no sobre la pantalla (en un celular,
    // la columna de ocho se salía por el frente de la mesa).
    if (all <= holes) {
      const atras = P({ x: 0, y: -L.tableR }).y, delante = P({ x: 0, y: L.tableR }).y;
      top = Math.max(top, atras + 8 * k);
      bottom = Math.min(bottom, delante - 8 * k);
      areaW = Math.min(areaW, 2 * L.tableR * g.sc);
    }
    const areaH = Math.max(40, bottom - top);
    const cw = chips.reduce((m, c) => Math.max(m, c.width), 0) + 12 * k, ch = (chips[0]?.height ?? 40 * k) + 6 * k;
    let best = { cols: 1, s: 0 };
    for (let cols = 1; cols <= all; cols++) {
      const rows = Math.ceil(all / cols);
      const s = Math.min(1.2, areaW / (cols * cw), areaH / (rows * ch));
      if (s > best.s) best = { cols, s };
    }
    gridScale = best.s;
    const rows = Math.ceil(all / best.cols);
    const cols = Math.ceil(all / rows);
    const x0 = (g.w - cols * cw * gridScale) / 2, y0 = top + (areaH - rows * ch * gridScale) / 2;
    // Cada nombre en la celda que mira hacia su agujero: las columnas de la
    // izquierda para los agujeros de la izquierda y, en cada columna, de arriba
    // abajo. En el orden de la lista los vuelos se cruzaban en el medio de la
    // mesa y medio segundo los nombres quedaban uno encima de otro: "Valeria
    // T." asomaba como "Va" (revisión visual, 21 de octubre de 2026). Los que no
    // llegan a la mesa miran al medio.
    const destino = names.map((_, i) => {
      const s = slotOfName.get(i);
      return s === undefined ? { x: g.w / 2, y: g.h / 2 } : P(labelAt(s));
    });
    const porX = names.map((_, i) => i).sort((a, b) => (destino[a] as Point).x - (destino[b] as Point).x || a - b);
    const celda: number[] = [];
    for (let c = 0; c < cols; c++) {
      porX.slice(c * rows, (c + 1) * rows)
        .sort((a, b) => (destino[a] as Point).y - (destino[b] as Point).y || a - b)
        .forEach((i, r) => { celda[i] = r * cols + c; });
    }
    gridAt = names.map((_, i) => {
      const at = celda[i] ?? i;
      return { x: x0 + ((at % cols) + 0.5) * cw * gridScale, y: y0 + (Math.floor(at / cols) + 0.5) * ch * gridScale };
    });
    badgeLayer.removeChildren().forEach((c) => c.destroy());
    badgeOf.clear();
    counter.style.fontSize = medidasContador(k).fuente;
    counter.style.fill = CREAM;
    almost.style.fontSize = 26 * k;
    almost.text = t("cSapAlmost");
    const aw = almost.width + 24 * k, ah = 40 * k;
    almostBox.clear().roundRect(-aw / 2 + 4 * k, -ah / 2 + 4 * k, aw, ah, 6 * k).fill(INK)
      .roundRect(-aw / 2, -ah / 2, aw, ah, 6 * k).fill(YELLOW).stroke({ width: 3 * k, color: INK });
    cam.cut(g.w / 2, g.h / 2, 1);
  };
  build();
  S.onResize(build);

  /** Cuándo se va cada nombre de la clasificatoria: su oleada y un escalonado chico dentro de ella. */
  const goneAt = new Map<number, number>();
  waves.forEach((w, wi) => w.forEach((idx, j) => goneAt.set(idx, Q_SHOW + wi * Q_WAVE + 0.1 + (j / Math.max(1, w.length)) * 0.45)));
  /** Cuándo arranca a volar cada finalista hacia su agujero. */
  const flyAt = (s: number): number => T_FLY + (s / Math.max(1, holes)) * 0.35;
  /** El agujero aparece cuando su nombre llega. */
  const holeAt = (s: number): number => flyAt(s) + Q_FLY * 0.75;

  /* ------------------------------------------------------------------ movimiento */
  interface Tok { x: number; y: number; ground: Point; scale: number; alpha: number; height: number }

  const arc = (a: Point, b: Point, f: number, apex: number): Point => ({
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f - 4 * apex * f * (1 - f),
  });

  /** Dónde está la argolla en el momento `t`, en pantalla, con su punto sobre la tapa. */
  const tokenAt = (o: Toss, t: number): Tok => {
    const hp = handPoint();
    const hand = P(hp);
    const land = P(o.th.landing);
    if (t < o.land) {
      const f = clamp((t - o.start) / o.flight, 0, 1);
      const apex = g.sc * (o.final ? 0.95 : 0.7);
      // El susto: el último tiro pega en el labio de la rana y rebota al agujero.
      if (o.final && labio) {
        const lab = { x: 0, y: L.frogR * 0.15 };
        if (f < LABIO) {
          const u = f / LABIO;
          const q = arc(hand, P(lab), u, apex);
          return { x: q.x, y: q.y, ground: { x: hp.x + (lab.x - hp.x) * u, y: hp.y + (lab.y - hp.y) * u }, scale: 1, alpha: 1, height: 4 * apex * u * (1 - u) };
        }
        const u = (f - LABIO) / (1 - LABIO);
        const q = arc(P(lab), land, u, apex * 0.35);
        return { x: q.x, y: q.y, ground: { x: lab.x + (o.th.landing.x - lab.x) * u, y: lab.y + (o.th.landing.y - lab.y) * u }, scale: 1, alpha: 1, height: 4 * apex * 0.35 * u * (1 - u) };
      }
      const q = arc(hand, land, f, apex);
      const ground = { x: hp.x + (o.th.landing.x - hp.x) * f, y: hp.y + (o.th.landing.y - hp.y) * f };
      return { x: q.x, y: q.y, ground, scale: 1, alpha: 1, height: 4 * apex * f * (1 - f) };
    }
    if (o.th.boca) {
      // La boca: la argolla se hunde, la rana la escupe sobre el aro y de ahí rueda.
      const age = t - o.land;
      const b = o.th.boca;
      const m = P(MOUTH);
      if (age < BOCA_IN) {
        const u = age / BOCA_IN;
        return { x: m.x, y: m.y, ground: MOUTH, scale: 1 - 0.6 * u * u, alpha: 1 - u * u, height: 0 };
      }
      if (age < BOCA_SPIT) return { x: m.x, y: m.y, ground: MOUTH, scale: 1, alpha: 0, height: 0 };
      if (age < BOCA_SPIT + BOCA_FLY) {
        const f = (age - BOCA_SPIT) / BOCA_FLY;
        const apex = g.sc * 0.5;
        const q = arc(m, P(b.spit), f, apex);
        const ground = { x: MOUTH.x + (b.spit.x - MOUTH.x) * f, y: MOUTH.y + (b.spit.y - MOUTH.y) * f };
        return { x: q.x, y: q.y, ground, scale: 1, alpha: 1, height: 4 * apex * f * (1 - f) };
      }
      const u = clamp((age - BOCA_SPIT - BOCA_FLY) / AFTER_MISS, 0, 1);
      const gp = { x: b.spit.x + (b.exit.x - b.spit.x) * ease.outCubic(u), y: b.spit.y + (b.exit.y - b.spit.y) * ease.outCubic(u) };
      const q = P(gp);
      const hop = g.br * 2.6 * (1 - u) * Math.abs(Math.sin(u * Math.PI * 3));
      const off = clamp((Math.hypot(gp.x, gp.y) - L.tableR) / 0.15, 0, 1);
      return { x: q.x, y: q.y - hop, ground: gp, scale: 1, alpha: 1 - off, height: hop };
    }
    const age = t - o.land;
    if (o.th.kind === "hit") {
      const u = clamp(age / SINK, 0, 1);
      return { x: land.x, y: land.y + g.br * 0.8 * u, ground: o.th.landing, scale: 1 - 0.85 * ease.outCubic(u), alpha: u >= 1 ? 0 : 1, height: 0 };
    }
    let gp: Point;
    let hop: number;
    if (o.th.kind === "near" && age < WOBBLE) {
      const u = age / WOBBLE;
      const w = 0.03 * (1 - u);
      gp = { x: o.th.landing.x + w * Math.sin(age * 26), y: o.th.landing.y + w * Math.cos(age * 19) };
      hop = g.br * 0.9 * (1 - u) * Math.abs(Math.sin(age * 15));
    } else {
      const base = o.th.kind === "near" ? WOBBLE : 0;
      const span = (o.th.kind === "near" ? AFTER_NEAR : AFTER_MISS) - base;
      const u = clamp((age - base) / span, 0, 1);
      const e = ease.outCubic(u);
      gp = { x: o.th.landing.x + (o.th.exit.x - o.th.landing.x) * e, y: o.th.landing.y + (o.th.exit.y - o.th.landing.y) * e };
      hop = g.br * 2.6 * (1 - u) * Math.abs(Math.sin(u * Math.PI * 3));
    }
    const q = P(gp);
    const off = clamp((Math.hypot(gp.x, gp.y) - L.tableR) / 0.15, 0, 1);
    return { x: q.x, y: q.y - hop, ground: gp, scale: 1, alpha: 1 - off, height: hop };
  };

  /* ------------------------------------------------------------------ el guion hablado */
  let tAll = 0, tHold = 0, crowned = false, dead = false, introSaid = 0, labioSonado = false, croo = false, silbido = false;
  const saidWave = new Set<number>();
  /** El empuje del zoom de emoción: una sola vez, desde que tira la última argolla. */
  let empujeDado = false;

  const crownUI = S.crown(names, winners, true);
  function crown(): void {
    if (crowned) return;
    crowned = true;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    // El golpe del zoom de emoción: el acercamiento firme sobre el agujero del
    // ganador, en el instante en que sale el cartel. Solo presentación.
    S.mark("golpe", cam.golpe(0.12, 0.3, 1).toFixed(3));
    cam.shake(10 * S.u());
  }
  skipFn = (): void => {
    if (crowned || dead) return;
    for (const o of tosses) o.announced = o.thrown = o.landed = true;
    // Saltar es ir al golpe: el silencio del foco no se espera.
    tAll = T_CROWN + FOCO.golpe / paceFactor();
    tHold = Math.max(tHold, FOCO.golpe);
    crown();
  };

  /**
   * El agujero más cerca de donde pegó la argolla, sin los que ya tienen
   * medalla: el relator nombra a esa persona en cada tiro a la madera.
   */
  const cercano = (o: Toss): number => {
    const ganados = new Set(tosses.filter((x) => x.th.kind === "hit" && x.i < o.i).map((x) => x.slot));
    let mejor = -1, d = Infinity;
    L.holes.forEach((h, s) => {
      const dd = Math.hypot(h.x - o.th.landing.x, h.y - o.th.landing.y);
      if (!ganados.has(s) && dd < d) {
        d = dd;
        mejor = s;
      }
    });
    return Math.max(0, mejor);
  };

  const onLand = (o: Toss): void => {
    o.landed = true;
    const big = o.grand;
    const k = g.k;
    if (o.th.boca) {
      // Entra a la boca: el croar de la rana, y la frase va al escupir. No nombra a nadie.
      beep(note(4), 0.12, "triangle", 0.05);
      setTimeout(() => beep(note(1), 0.18, "triangle", 0.05), 110);
      cam.punch(0.03).shake(3 * k);
      return;
    }
    if (o.th.kind === "miss") {
      // La madera no suena siempre igual, y la argolla rebota: un segundo
      // golpe más bajo con su saltito. Eran cuatro golpes iguales seguidos.
      beep(note(4 + (o.i % 3)), 0.08, "square", big ? 0.05 : 0.03);
      setTimeout(() => beep(note(2 + (o.i % 3)), 0.06, "square", 0.03), 150);
      cam.punch(big ? 0.04 : 0.02).shake((big ? 4 : 2) * k);
      // Con el nombre de quien estaba más cerca: doce segundos de "¡Afuera!"
      // sin nombrar a nadie no le daban a la sala de dónde agarrarse. En la
      // tapada no se nombra a nadie hasta que entra.
      if (big) S.say(story.arc === "tapada" ? t("cSapMiss") : T[getLang()].cSapMissBy(nameOfSlot(cercano(o))), 0.5);
    } else if (o.th.kind === "near") {
      beep(note(12), 0.09, "triangle", big ? 0.055 : 0.035);
      [0, 1, 2].forEach((d) => setTimeout(() => beep(note(11 - d), 0.05, "square", 0.025), 110 + d * 130));
      cam.punch(big ? 0.06 : 0.03).shake((big ? 6 : 3) * k);
      if (big) {
        if (story.arc === "tapada") S.say(t("cSapRim"), 0.7);
        else S.say(T[getLang()].cSapNear(nameOfSlot(o.th.rimSlot as number)), 0.85);
      }
    } else {
      if (o.final) {
        // La caída que decide, en el registro de un proyector: el clonc de la
        // argolla, cuerpo en dos notas y el trago de la rana. Eran dos notas a
        // 131 Hz (el grado -5 se recorta a 0), debajo de lo que reproduce un
        // parlante de sala.
        beep(note(7), 0.06, "square", 0.05);
        beep(note(5), 0.45, "triangle", 0.08);
        beep(note(0), 0.5, "triangle", 0.06);
        [12, 9, 7].forEach((d, i) => setTimeout(() => beep(note(d), 0.07, "triangle", 0.045), 120 + i * 90));
      } else {
        beep(note(3), 0.2, "triangle", 0.05);
        beep(note(3), 0.16, "sawtooth", 0.035);
      }
      cam.punch(o.final ? 0.1 : 0.05).shake((o.final ? 12 : 6) * k);
      if (o.final) S.say(t("cSapIn"), 1);
      // El co-ganador que entra sale con premio, y el relator dice el número del
      // premio: nombrarlo acá lo anunciaba antes del final.
      else S.say(T[getLang()].cSapDone(premioDe(o.th.turn)), 0.55);
    }
  };

  function script(): void {
    const cues: [number, () => void][] = [
      [0.1, () => {
        S.say(all > holes ? T[getLang()].cQualStart(all) : t("cSapHang"), 0.15);
        [5, 7, 9].forEach((d, i) => setTimeout(() => beep(note(d), 0.12, "triangle", 0.04), 120 + i * 140));
      }],
      [T_FLY, () => {
        S.say(T[getLang()].cSapCount(holes), 0.2);
        for (let i = 0; i < 5; i++) setTimeout(() => beep(note(10 + (i % 3)), 0.04, "square", 0.025), 200 + i * 90);
      }],
    ];
    while (introSaid < cues.length && tAll >= (cues[introSaid] as [number, () => void])[0]) (cues[introSaid++] as [number, () => void])[1]();
    // Cada oleada de la clasificatoria: el tachón suena y el relator cuenta cuántos quedan.
    waves.forEach((w, wi) => {
      const at = Q_SHOW + wi * Q_WAVE + 0.6;
      if (saidWave.has(wi) || tAll < at) return;
      saidWave.add(wi);
      const quedan = all - waves.slice(0, wi + 1).reduce((a, x) => a + x.length, 0);
      S.say(T[getLang()].cQualLeft(quedan), 0.25 + 0.15 * wi);
      for (let i = 0; i < Math.min(6, 2 + w.length); i++) setTimeout(() => beep(note(3 - i), 0.05, "square", 0.03), i * 80);
      cam.shake(3 * g.k);
    });
    for (const o of tosses) {
      const firstOfTurn = o.i === 0 || (tosses[o.i - 1] as Toss).th.turn !== o.th.turn;
      if (!o.announced && tAll >= o.start - 0.7) {
        o.announced = true;
        if (firstOfTurn && total > 1) {
          S.say(T[getLang()].cSapNext(premioDe(o.th.turn), total), 0.3 + 0.5 * (o.th.turn / Math.max(1, last)));
          beep(note(8 + (o.th.turn % 4)), 0.12, "sine", 0.04);
        }
        if (o.final) S.say(t("cSapLast"), 0.9);
      }
      // La rana croa mientras la mano levanta la última argolla. En la tapada,
      // con pocos tiros y el reloj estirado casi al doble, quedaban 5 segundos
      // sin un solo efecto entre el último "casi" y el tiro (auditor de sonido,
      // 4 de octubre de 2026).
      if (o.final && !croo && tAll >= o.start - 1.0) {
        croo = true;
        beep(note(2), 0.16, "triangle", 0.045);
        setTimeout(() => beep(note(0), 0.2, "triangle", 0.04), 170);
      }
      if (!o.thrown && tAll >= o.start) {
        o.thrown = true;
        beep(note(7), 0.1, "triangle", o.grand ? 0.045 : 0.03);
        if (o.i === 0 || (o.grand && o.th.kind === "miss" && firstOfTurn)) S.say(t("cSapThrow"), 0.3);
      }
      // Arriba del último vuelo, un silbido corto que sube. En el susto ahí
      // suena el labio de la rana, así que no hace falta.
      if (o.final && !labio && !silbido && tAll >= o.start + o.flight * 0.5) {
        silbido = true;
        beep(note(9), 0.09, "sine", 0.035);
        setTimeout(() => beep(note(12), 0.12, "sine", 0.035), 110);
      }
      if (o.final && labio && !labioSonado && tAll >= o.start + o.flight * LABIO) {
        labioSonado = true;
        beep(note(12), 0.08, "square", 0.05);
        beep(note(5), 0.12, "triangle", 0.04);
        cam.punch(0.05).shake(5 * g.k);
        S.say(t("cSapLip"), 0.95);
      }
      // La boca escupe la argolla sobre el aro: un golpe corto, y la frase una vez.
      if (o.th.boca && !o.spat && tAll >= o.land + BOCA_SPIT) {
        o.spat = true;
        beep(note(9), 0.07, "square", 0.035);
        setTimeout(() => beep(note(12), 0.1, "triangle", 0.04), 90);
        S.say(t("cSapMouth"), 0.65);
      }
      if (!o.landed && tAll >= o.land) onLand(o);
    }
  }

  /* -------------------------------------------------------------------- dibujo */
  const current = (): Toss | undefined => tosses.find((o) => tAll >= o.start - 0.4 && tAll < o.end);

  /**
   * Cuánto se achica el nombre del agujero `s` (de la persona `i`) ya sentado:
   * el que no entra entre su punto y el borde se achica, en vez de volver sobre
   * su agujero. Se mide sin zoom: con la cámara cerca se achicaban todos los de
   * los bordes.
   */
  const encogeSentado = (s: number, i: number): number => {
    const lp = P(labelAt(s));
    const an = anchorOf(s);
    const libre = an.ax <= 0.01 ? g.w - 4 - lp.x : an.ax >= 0.99 ? lp.x - 4 : g.w - 8;
    const finalW = (anchoNombre[i] ?? 0) * g.k * labelScale();
    return libre > 0 && finalW > libre ? Math.max(0.7, libre / finalW) : 1;
  };

  /**
   * La mesa con el nombre de cada agujero ya sentado, en la escena, mirada con
   * el acercamiento `z`: lo que en un celular tiene que verse entero. Los
   * nombres son de la interfaz y no crecen con la cámara: en la escena miden lo
   * que miden en la pantalla dividido por el acercamiento.
   */
  const mesaConNombres = (z: number): Caja => {
    const cajas: Caja[] = [mesa()];
    const ls = labelScale();
    for (let s = 0; s < holes; s++) {
      const i = whoAt(s);
      const e = ls * encogeSentado(s, i);
      const w = ((anchoNombre[i] ?? 0) * g.k * e) / z, h = (altoNombre * g.k * e) / z;
      const lp = P(labelAt(s));
      const an = anchorOf(s);
      cajas.push({ x: lp.x - w * an.ax, y: lp.y - h * an.ay, w, h });
    }
    return unir(cajas);
  };

  /** El acercamiento más grande con el que la mesa y todos sus nombres entran en lo que se ve del juego. */
  const topeConNombres = (): number => {
    let z = 1;
    for (let vuelta = 0; vuelta < 3; vuelta++) z = cabe(mesaConNombres(z), zonaJuego());
    return z;
  };

  function aim(): void {
    const ultimo = tosses[tosses.length - 1] as Toss;
    // En un celular la mesa ocupa el ancho con los nombres de los costados
    // pegados al borde: cualquier acercamiento los sacaba de cuadro. En el
    // último tiro, con el acercamiento lento y el empuje de emoción, quedaban a
    // la vista 4 de 8 nombres, o 4 de 12, justo cuando cada uno busca su agujero
    // (evaluación de la subida 2, hallazgo 5). Ahí, desde que los nombres llegan
    // a la mesa hasta la corona, la mesa con todos sus nombres queda entera: el
    // acercamiento, los golpes y el empuje llegan hasta donde entran, y la
    // cámara sigue a la argolla de arriba abajo. Con la corona los demás nombres
    // se apagan, y el golpe sobre el ganador sigue igual. En la pantalla ancha
    // no cambia nada. El tope se pide desde el principio, así la cámara llega
    // suave y no salta cuando los nombres se sientan.
    const tope = S.portrait() ? topeConNombres() : Infinity;
    const cuidar = S.portrait() && !crowned && tAll >= T_SEATED;
    const zEfectivo = Math.max(0.3, cam.toScreen(1, 0, g.w, g.h).x - cam.toScreen(0, 0, g.w, g.h).x);
    cam.proteger(cuidar ? mesaConNombres(zEfectivo) : null, zonaJuego());
    if (tAll >= ultimo.land) {
      // Desde que cae la última argolla, la mesa entera debajo de donde sale el
      // cartel y encima del relator: el agujero ganador se ve, los demás también,
      // y el cartel no tapa ninguno. Hasta el 21 de octubre de 2026 la cámara se
      // acercaba a 1,5 sobre el agujero, y en el celular dejaba agujeros afuera
      // por los dos costados y nombres debajo del relator (revisión visual). En
      // el celular no se acerca más que la mesa de todo el juego: ahí la mesa
      // se mide para que los nombres de los costados entren justo.
      const zona = zonaFinal();
      let caja = mesa();
      let z = Math.min(S.portrait() ? Math.min(1, tope) : 1.5, cabe(caja, zona));
      // En la pantalla ancha el chip grande del ganador sale de su agujero hacia
      // afuera de la mesa (hacia arriba en la fila de arriba): entra en el
      // encuadre también, así el cartel no lo pisa ni el relator lo tapa. Con
      // cincuenta personas el de la fila de arriba quedaba debajo del cartel.
      const quien = whoAt(ultimo.slot);
      const ch = chips[quien];
      if (!S.portrait() && ch) {
        const an = anchorOf(ultimo.slot);
        const lp = P(labelAt(ultimo.slot));
        const sc = 1.45 * 1.3;
        const w = (anchoNombre[quien] ?? 0) * g.k * sc + 14 * g.k, h = (ch.height / Math.max(1e-6, ch.scale.y)) * sc + 14 * g.k;
        const base = mesa();
        for (let vuelta = 0; vuelta < 2; vuelta++) {
          caja = unir([base, { x: lp.x - (w * an.ax) / z, y: lp.y + (h * (0.5 - an.ay)) / z - h / 2 / z, w: w / z, h: h / z }]);
          z = Math.min(1.5, cabe(caja, zona));
        }
      }
      const v = centrar(caja, zona, g.w, g.h, z);
      cam.lookAt(v.x, v.y, z, 3);
      return;
    }
    const cur = current();
    let x = g.w / 2, y = g.h / 2, z = 1, rate = 2;
    if (cur && cur.grand && tAll < T_CROWN) {
      const tok = tokenAt(cur, clamp(tAll, cur.start, cur.end));
      const close = story.arc === "remontada";
      if (tAll < cur.start) {
        z = close ? 1.25 : 1;
      } else if (cur.final) {
        if (tAll < cur.land) {
          // Un acercamiento lento durante todo el último vuelo; en la tapada, recién en la segunda mitad.
          const f = clamp((tAll - cur.start) / cur.flight, 0, 1);
          z = story.arc === "tapada" ? 1 + 0.6 * Math.max(0, f - 0.5) * 2 : 1 + 0.6 * f * f;
          x = tok.x;
          y = tok.y;
          rate = 3 + 2 * f;
        } else {
          // El agujero de cerca y en la mitad de abajo: arriba entra el cartel del ganador.
          const q = P(cur.th.landing);
          z = 1.5;
          x = q.x;
          y = q.y - (g.h * 0.12) / z;
          rate = 3;
        }
      } else if (tok.alpha >= 0.5) {
        // Sigue a la argolla mientras está en la mesa; cuando se va, vuelve a la mesa entera.
        z = close ? 1.25 : cur.th.kind === "near" && tAll >= cur.land ? 1.45 : 1.15;
        x = tok.x;
        y = tok.y;
        rate = 2.5;
      }
      // En un celular la mesa se mide para que los nombres de los costados
      // entren justo: cualquier acercamiento los sacaba de cuadro. Ahí la
      // cámara queda quieta, y en el último tiro sigue a la argolla sin
      // acercarse más de lo que dejan entrar los nombres.
      if (S.portrait() && !cur.final) {
        z = 1;
        x = g.w / 2;
        y = g.h / 2;
      }
      z = Math.min(z, tope);
      // La fila de abajo, por encima de la caja de subtítulos.
      if (z > 1) y += (S.bottom() * 0.5) / z;
    }
    z = Math.min(z, tope);
    // De cerca, la mesa entera si entra; si no, de borde a borde de la
    // pantalla: antes la cámara se pegaba al borde de la pantalla y mostraba
    // piso de un lado mientras dejaba agujeros afuera del otro.
    const v = encuadrar(mesa(), zonaJuego(), { x, y, z }, g.w, g.h);
    cam.lookAt(v.x, v.y, z, rate);
  }

  /** La rana respira, parpadea y abre la boca cuando cae una argolla. */
  const croakAt = (): number => {
    let c = 0.1 + 0.06 * Math.max(0, Math.sin(tAll * 2.4));
    const fin = tosses[tosses.length - 1];
    if (labio && fin) {
      const a = tAll - (fin.start + fin.flight * LABIO);
      if (a >= 0 && a < 0.8) c = Math.max(c, 1 - a / 0.8);
    }
    // La rana se ríe con el golpe de la coronación, con la boca bien abierta.
    const tGolpe = T_CROWN + FOCO.golpe / paceFactor();
    if (tAll >= tGolpe) {
      const a = tAll - tGolpe;
      c = Math.max(c, clamp(1 - a / 2.4, 0, 1) * (0.8 + 0.2 * Math.sin(a * 18)));
    }
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land) continue;
      const age = tAll - o.land;
      c = Math.max(c, o.final ? clamp(1 - age / 2.2, 0, 1) * (0.75 + 0.25 * Math.sin(age * 16)) : clamp(1 - age / 0.9, 0, 1));
    }
    // La boca: se abre al tragar la argolla y se cierra después de escupirla.
    for (const o of tosses) {
      if (!o.th.boca || tAll < o.land) continue;
      const a = tAll - o.land;
      c = Math.max(c, Math.min(1, a / 0.1) * (1 - clamp((a - 0.45) / 0.8, 0, 1)));
    }
    return clamp(c, 0, 1);
  };

  /** El cajón del sapo visto desde arriba y adelante: tapa de madera pintada, guarda de colores y frente. */
  function drawBox(): void {
    const k = g.k;
    const R = L.tableR * g.sc;
    const w = R * 2.1, d = R * 2.05 * g.tilt, front = 46 * k;
    const x0 = g.cx - w / 2, y0 = g.cy - d / 2;
    boxG.clear();
    boxG.roundRect(x0 + 8 * k, y0 + 10 * k, w, d + front, 10 * k).fill({ color: INK, alpha: 0.35 });
    // El frente del cajón, más oscuro, con los cajoncitos numerados del sapo de verdad.
    boxG.rect(x0, y0 + d, w, front).fill(S.dark ? 0x7a2e1c : 0xb4462a).stroke({ width: 3 * k, color: INK });
    const cajones = 5;
    for (let i = 0; i < cajones; i++) {
      const cx = x0 + ((i + 0.5) * w) / cajones;
      boxG.rect(cx - (w / cajones) * 0.36, y0 + d + front * 0.22, (w / cajones) * 0.72, front * 0.56).fill(S.dark ? 0x5a2014 : 0x8f3520).stroke({ width: 2 * k, color: INK });
      boxG.circle(cx, y0 + d + front * 0.5, 3 * k).fill(YELLOW);
    }
    // La tapa: madera clara con vetas, y una guarda del aguayo en el borde.
    boxG.rect(x0, y0, w, d).fill(S.dark ? 0x9a6a3c : 0xd29a5c).stroke({ width: 3 * k, color: INK });
    for (let i = 1; i < 7; i++) {
      const yy = y0 + (i * d) / 7;
      boxG.moveTo(x0 + 6 * k, yy).lineTo(x0 + w - 6 * k, yy).stroke({ width: 1.4 * k, color: INK, alpha: 0.12 });
    }
    const band = 9 * k, paso = band * 1.6;
    for (let x = x0; x < x0 + w - 1; x += paso) {
      const c = S.color(Math.floor((x - x0) / paso));
      boxG.poly([x, y0, x + paso / 2, y0 + band, x + paso, y0]).fill(c);
      boxG.poly([x, y0 + d, x + paso / 2, y0 + d - band, x + paso, y0 + d]).fill(c);
    }
  }

  /** La rana de bronce, sentada, con la boca que se abre. */
  function drawFrog(): void {
    const k = g.k;
    const c0 = P({ x: 0, y: 0 });
    const fr = L.frogR * g.sc;
    const open = croakAt();
    const bronce = 0xb98a3e, oscuro = 0x7d5a22;
    const blink = (Math.floor(tAll * 0.7) % 5 === 0 && (tAll * 0.7) % 1 < 0.12) ? 0.15 : 1;
    const garganta = 1 + 0.06 * Math.max(0, Math.sin(tAll * 5));
    frogG.clear();
    frogG.ellipse(c0.x, c0.y + fr * 0.55, fr * 1.15, fr * 0.45).fill({ color: INK, alpha: 0.35 });
    // Las patas de atrás, el cuerpo y la cabeza.
    for (const sx of [-1, 1]) frogG.ellipse(c0.x + sx * fr * 0.78, c0.y + fr * 0.35, fr * 0.42, fr * 0.3).fill(oscuro).stroke({ width: 2 * k, color: INK });
    frogG.ellipse(c0.x, c0.y + fr * 0.1, fr * 0.95, fr * 0.72).fill(bronce).stroke({ width: 2.5 * k, color: INK });
    frogG.ellipse(c0.x, c0.y + fr * 0.32, fr * 0.6 * garganta, fr * 0.32 * garganta).fill(0xd8b06a);
    for (const sx of [-0.5, 0.5]) {
      frogG.circle(c0.x + sx * fr, c0.y - fr * 0.5, fr * 0.28).fill(bronce).stroke({ width: 2 * k, color: INK });
      frogG.ellipse(c0.x + sx * fr, c0.y - fr * 0.5, fr * 0.13, fr * 0.13 * blink).fill(INK);
    }
    // El brillo del metal.
    frogG.ellipse(c0.x - fr * 0.35, c0.y - fr * 0.05, fr * 0.22, fr * 0.1).fill({ color: 0xfff1c4, alpha: 0.55 });
    const mx = fr * 0.55 * (0.7 + 0.3 * open), my = fr * (0.06 + 0.3 * open);
    frogG.ellipse(c0.x, c0.y + fr * 0.02, mx, my).fill(INK);
    if (open > 0.55) frogG.ellipse(c0.x, c0.y + fr * 0.02 + my * 0.3, mx * 0.5, my * 0.45).fill(0xe0707a);
  }

  /** Dónde está la mano, en la escena. */
  const handAt = (): Point => P(handPoint());

  /** La mano que tira: toma impulso hacia atrás y suelta. */
  function drawHand(): void {
    handG.clear();
    if (crowned) return;
    const k = g.k;
    const h = handAt();
    // Antes del tiro la mano baja (toma impulso); al soltar sube de golpe y vuelve.
    const next = tosses.find((o) => tAll < o.start + 0.3);
    let swing = 0;
    if (next) {
      const u = next.start - tAll;
      if (u >= 0) swing = u < WINDUP ? 1 - u / WINDUP : 0;
      else swing = -0.8 * Math.sin(Math.PI * clamp(-u / 0.3, 0, 1));
    }
    const hx = h.x, hy = h.y + swing * 22 * k;
    // El brazo entra desde fuera de la pantalla, abajo a la derecha.
    const ax = hx + 70 * 8 * k, ay = hy + 96 * 8 * k;
    const mx = hx + 32 * k, my = hy + 44 * k;
    // La manga, de un color de la casa, y la mano con los dedos que sostienen la argolla.
    handG.moveTo(ax, ay).lineTo(mx, my).stroke({ width: 34 * k, color: INK, cap: "round" });
    handG.moveTo(ax, ay).lineTo(mx, my).stroke({ width: 28 * k, color: S.color(2), cap: "round" });
    handG.moveTo(mx, my).lineTo(hx, hy).stroke({ width: 22 * k, color: INK, cap: "round" });
    handG.moveTo(mx, my).lineTo(hx, hy).stroke({ width: 16 * k, color: 0xc68a5c, cap: "round" });
    handG.circle(hx, hy, 15 * k).fill(0xc68a5c).stroke({ width: 2.5 * k, color: INK });
    for (const [dx, dy] of [[-13, -6], [-9, -13], [-1, -16]]) {
      handG.circle(hx + (dx as number) * k, hy + (dy as number) * k, 5 * k).fill(0xc68a5c).stroke({ width: 2 * k, color: INK });
    }
  }

  /** La argolla amarilla: un disco con agujero, para que no se lea como moneda. */
  function drawToken(x: number, y: number, s: number, glow: boolean, alpha = 1): void {
    const r = g.br * s;
    // La argolla del último tiro lleva un aro nítido. Antes era un halo
    // amarillo transparente que sobre la madera se leía como una mancha borrosa.
    if (glow) {
      tokG.ellipse(x, y, r * 1.6, r * 1.28).stroke({ width: 6 * g.k, color: INK, alpha });
      tokG.ellipse(x, y, r * 1.6, r * 1.28).stroke({ width: 3 * g.k, color: YELLOW, alpha });
    }
    tokG.ellipse(x + 2 * g.k, y + 3 * g.k, r, r * 0.8).fill({ color: INK, alpha: 0.45 * alpha });
    tokG.ellipse(x, y, r, r * 0.8).fill({ color: YELLOW, alpha }).stroke({ width: 3 * g.k, color: INK, alpha });
    tokG.ellipse(x, y, r * 0.4, r * 0.32).fill({ color: 0x3a2a14, alpha }).stroke({ width: 2 * g.k, color: INK, alpha });
  }

  function draw(): void {
    const k = g.k;
    drawBox();
    drawFrog();
    drawHand();
    fx.clear();
    tokG.clear();
    strikeG.clear();
    glowG.clear();

    const lit = new Map<number, number>();
    for (const o of tosses) if (o.th.kind === "hit" && tAll >= o.land) lit.set(o.slot, o.final ? 1 : 0.6);
    for (let s = 0; s < holes; s++) {
      const f = clamp((tAll - holeAt(s)) / 0.35, 0, 1);
      if (f <= 0) continue;
      const c = P(L.holes[s] as Point);
      const rx = L.holeR * g.sc * ease.outBack(f), ry = rx * g.tilt;
      const glow = lit.get(s);
      const aro = glow !== undefined ? YELLOW : colorDe(whoAt(s));
      boxG.ellipse(c.x, c.y, Math.max(0.01, rx * 1.2), Math.max(0.01, ry * 1.2)).fill(aro).stroke({ width: (glow !== undefined ? 6 : 2) * k, color: glow !== undefined ? YELLOW : INK });
      boxG.ellipse(c.x, c.y, Math.max(0.01, rx), Math.max(0.01, ry)).fill(0x140f0a);
      if (glow === 1) {
        // El estallido del agujero ganador, como el del trompo.
        const fin = tosses[tosses.length - 1] as Toss;
        const age = tAll - fin.land;
        if (age >= 0 && age < 0.7) {
          const e = ease.outCubic(age / 0.7);
          for (let r = 0; r < 12; r++) {
            const a = (r / 12) * Math.PI * 2;
            const r0 = rx * (1.3 + 0.4 * e), r1 = rx * (1.6 + 1.6 * e);
            fx.moveTo(c.x + Math.cos(a) * r0, c.y + Math.sin(a) * r0 * g.tilt)
              .lineTo(c.x + Math.cos(a) * r1, c.y + Math.sin(a) * r1 * g.tilt)
              .stroke({ width: 5 * k, color: YELLOW, alpha: 1 - age / 0.7, cap: "round" });
          }
        }
      }
    }

    // Los nombres: primero en la grilla de la clasificatoria, después volando a su agujero, y ahí se quedan.
    const ls = labelScale();
    names.forEach((_, i) => {
      const c = chips[i] as Container;
      const slot = slotOfName.get(i);
      const enter = clamp((tAll - (i / Math.max(1, all)) * 0.5) / 0.35, 0, 1);
      const grid = gridAt[i] as Point;
      if (slot === undefined) {
        // Se va en su oleada: se tacha, cae y se apaga.
        const at = goneAt.get(i) ?? 0;
        const age = tAll - at;
        c.visible = enter > 0 && age < 0.7;
        if (!c.visible) return;
        c.scale.set(gridScale * ease.outBack(enter));
        c.alpha = clamp(1 - Math.max(0, age - 0.25) / 0.45, 0, 1);
        const cy = grid.y + Math.max(0, age - 0.2) * 70 * k;
        c.position.set(grid.x - c.width / 2, cy);
        if (age > 0) {
          const f = clamp(age / 0.18, 0, 1);
          strikeG.moveTo(grid.x - c.width / 2, cy).lineTo(grid.x - c.width / 2 + c.width * f, cy).stroke({ width: 3 * k, color: 0xd52b1e, alpha: c.alpha });
        }
        return;
      }
      const ganador = lit.get(slot) === 1;
      if (crowned && !ganador) {
        c.visible = false;
        return;
      }
      c.visible = enter > 0;
      const lp = P(labelAt(slot));
      const q = cam.toScreen(lp.x, lp.y, g.w, g.h);
      const u = ease.inOutCubic(clamp((tAll - flyAt(slot)) / Q_FLY, 0, 1));
      // El que no entra entre su punto y el borde se achica, en vez de volver
      // sobre su agujero. Se mide sin zoom: con la cámara cerca se achicaban
      // todos los de los bordes. Y vuela ya hacia ese tamaño: si se achicaba
      // recién al llegar, en el vuelo quedaba pegado al borde, encima del
      // vecino (el "Va" de la revisión visual del 21 de octubre de 2026).
      const an0 = anchorOf(slot);
      const encoge = ganador ? 1 : encogeSentado(slot, i);
      // El ganador conserva la letra grande de antes: en horizontal, 1,45 sobre la base.
      // En un celular el ganador va sobre su aro y no puede ser tan grande: con
      // 1,1 no toca los aros de los vecinos.
      const sc = (gridScale + ((ganador && !S.portrait() ? 1.45 : ls * encoge) - gridScale) * u) * (ganador ? (S.portrait() ? 1.1 : 1.3) : 1);
      c.scale.set(sc * (u > 0 ? 1 : ease.outBack(enter)));
      let an = an0;
      let qx = q.x, qy = q.y;
      if (ganador && S.portrait()) {
        // En un celular el chip grande del ganador no entra al lado de su agujero, y
        // debajo tapaba los aros de los dos vecinos (revisión visual, 20 de octubre
        // de 2026). Va centrado sobre el aro de su propio agujero: ahí no cubre a nadie más.
        const fin = tosses[tosses.length - 1] as Toss;
        const f = ease.outCubic(clamp((tAll - fin.land) / 0.35, 0, 1));
        const h = L.holes[slot] as Point;
        const c = P(h);
        const d = cam.toScreen(c.x, c.y, g.w, g.h);
        qx = q.x + (d.x - q.x) * f;
        qy = q.y + (d.y - q.y) * f;
        an = { ax: an.ax + (0.5 - an.ax) * f, ay: an.ay + (0.5 - an.ay) * f };
      }
      // En la grilla va centrado; al llegar, anclado por su borde de adentro.
      const tx = qx - c.width * an.ax, ty = qy + c.height * (0.5 - an.ay);
      const x = grid.x - c.width / 2 + (tx - (grid.x - c.width / 2)) * u, y = grid.y + (ty - grid.y) * u - Math.sin(Math.PI * u) * 40 * k;
      const xx = clamp(x, 4, Math.max(4, g.w - c.width - 4));
      c.position.set(xx, y);
      // Con la cámara cerca, el nombre que quedaría cortado contra el borde se
      // apaga en vez de arrastrarse encima de los agujeros o de la rana.
      c.alpha = ganador || u < 1 || (Math.abs(xx - x) < 6 * k && qx > 0 && qx < g.w) ? 1 : 0;
      if (ganador) {
        glowG.roundRect(c.x - 7 * k, c.y - c.height / 2 - 7 * k, c.width + 14 * k, c.height + 14 * k, 10 * k).fill({ color: YELLOW, alpha: 0.9 });
      }
    });

    for (const o of tosses) {
      if (tAll < o.start - HANG_FIRST) continue;
      const prevDone = o.i === 0 || (tosses[o.i - 1] as Toss).landed || tAll >= (tosses[o.i - 1] as Toss).end - 0.2;
      if (tAll < o.start) {
        // En la mano, esperando el tiro.
        if (prevDone && o.start - tAll < (o.final ? HANG_FINAL : o.i === 0 ? HANG_FIRST : HANG_SMALL)) {
          const hp = handAt();
          const u = o.start - tAll;
          const sw = u < WINDUP ? 1 - u / WINDUP : 0;
          drawToken(hp.x - 4 * k, hp.y - 8 * k + sw * 22 * k, 1, false);
        }
        continue;
      }
      if (tAll >= o.end && !(o.final && o.th.kind === "hit")) continue;
      const tk = tokenAt(o, Math.min(tAll, o.end));
      if (tAll < o.land) {
        const sh = P(tk.ground);
        const sz = g.br * (1 - clamp(tk.height / (g.sc * 2), 0, 0.5));
        fx.ellipse(sh.x, sh.y + g.br * 0.5, sz, sz * g.tilt).fill({ color: INK, alpha: 0.35 });
        drawToken(tk.x, tk.y, tk.scale, o.final);
      } else {
        const age = tAll - o.land;
        if (o.th.kind !== "hit" && !o.th.boca && age < 0.4) {
          const lp = P(o.th.landing);
          fx.ellipse(lp.x, lp.y, g.br * (1 + 4 * age), g.br * (1 + 4 * age) * g.tilt).stroke({ width: 2 * k, color: YELLOW, alpha: 1 - age / 0.4 });
        }
        if (tk.alpha > 0.01) {
          const sh = P(tk.ground);
          fx.ellipse(sh.x, sh.y + g.br * 0.5, g.br, g.br * g.tilt).fill({ color: INK, alpha: 0.3 * tk.alpha });
          drawToken(tk.x, tk.y, tk.scale, false, tk.alpha);
        }
      }
    }

    // El contador de la casa: cuántos quedan en la clasificatoria, después los agujeros o el ganador de turno.
    let turn = 0;
    for (const o of tosses) if (tAll >= o.start - 0.7) turn = o.th.turn;
    const started = tAll >= (tosses[0] as Toss).start - 0.7;
    const quedan = all - waves.reduce((a, w, wi) => a + (tAll >= Q_SHOW + wi * Q_WAVE + 0.6 ? w.length : 0), 0);
    counter.text = !started
      ? (tAll < T_FLY && all > holes ? `${t("cQualIn")}  ${quedan}` : `${t("cSapHoles")}  ${holes}`)
      : total > 1 ? T[getLang()].cSapTally(premioDe(turn), total).toUpperCase() : `${t("cSapHoles")}  ${holes}`;
    const bw = counter.width + medidasContador(k).aire, bh = medidasContador(k).alto;
    counter.position.set(bw / 2, bh / 2);
    counterBox.clear().rect(5 * k, 5 * k, bw, bh).fill(INK).rect(0, 0, bw, bh).fill(0x221a33).stroke({ width: 3 * k, color: INK });
    counterG.position.set(22 * k, S.top() + 10 * k);
    counterG.visible = !crowned;
    // Con la cámara cerca tapaba nombres de la fila de arriba.
    counterG.alpha = clamp((1.15 - cam.zoom) / 0.1, 0, 1);

    // Los agujeros ya ocupados: una medalla con el orden (o una tilde con un solo ganador).
    for (const o of tosses) {
      if (o.th.kind !== "hit" || tAll < o.land + SINK || crowned) continue;
      const c = P(L.holes[o.slot] as Point);
      const p = cam.toScreen(c.x + L.holeR * g.sc * 0.95, c.y - L.holeR * g.sc * g.tilt * 1.1, g.w, g.h);
      const br = Math.max(9 * k, 12 * k);
      strikeG.circle(p.x, p.y, br).fill(YELLOW).stroke({ width: 2 * k, color: INK });
      if (total > 1) {
        let b = badgeOf.get(o.th.turn);
        if (!b) {
          b = S.text(`${premioDe(o.th.turn)}`, { fontSize: br * 1.3, fontWeight: "900", fill: INK });
          b.anchor.set(0.5);
          badgeOf.set(o.th.turn, b);
          badgeLayer.addChild(b);
        }
        b.position.set(p.x, p.y);
      } else {
        strikeG.moveTo(p.x - br * 0.45, p.y).lineTo(p.x - br * 0.1, p.y + br * 0.35).lineTo(p.x + br * 0.5, p.y - br * 0.35).stroke({ width: 2.5 * k, color: INK });
      }
    }
    badgeLayer.visible = !crowned;

    // "¡Casi!" al lado de la argolla que bailó en el borde. En la interfaz, para que no se borronee con la cámara.
    almostG.alpha = 0;
    for (const o of tosses) {
      if (o.th.kind !== "near" || tAll < o.land || tAll >= o.land + AFTER_NEAR) continue;
      const age = tAll - o.land;
      // Entre la argolla y la rana: afuera quedaba encima del nombre del vecino.
      const lp = P({ x: o.th.landing.x * 0.55, y: o.th.landing.y * 0.55 });
      const q = cam.toScreen(lp.x, lp.y, g.w, g.h);
      almostG.position.set(q.x, q.y - 6 * k * ease.outCubic(clamp(age / 0.3, 0, 1)));
      almostG.rotation = -0.08;
      almostG.alpha = clamp(age / 0.15, 0, 1) * clamp((AFTER_NEAR - age) / 0.3, 0, 1);
    }
  }

  /** Dónde está el agujero de quien gana en la pantalla, para el foco. */
  function focoDelAgujero(): FocoAt {
    const slot = (tosses[tosses.length - 1] as Toss).slot;
    const c = P(L.holes[slot] as Point);
    const s = cam.toScreen(c.x, c.y, g.w, g.h);
    const z = Math.max(0.3, cam.toScreen(1, 0, g.w, g.h).x - cam.toScreen(0, 0, g.w, g.h).x);
    return { arco: story.arc, x: s.x, y: s.y, r: L.holeR * g.sc * z * 1.7, color: colorDeNombre(nameOfSlot(slot)), rival: null };
  }

  S.run((dt, now) => {
    tAll += dt;
    // El empuje del zoom de emoción: lento, desde la última argolla hasta la
    // corona, para que el golpe llegue con la cámara ya un poco más cerca.
    if (!empujeDado && tAll >= T_EMPUJE) {
      empujeDado = true;
      cam.tension(Math.max(0.5, T_CROWN - T_EMPUJE), 0.05);
    }
    // El respiro, antes de que caiga la argolla y no antes del cartel:
    // "¡ADENTRO!" ya dispara el remate, y después del remate el respiro no
    // cortaba nada. Silencio, caída, golpe.
    S.breath(tAll, T_LAND);
    script();
    if (tAll >= T_CROWN) {
      tHold += dt * paceFactor();
      // El silencio del foco: la fanfarria, el golpe de cámara y el relator esperan al golpe.
      if (tHold >= FOCO.golpe) crown();
    }
    aim();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw();
    if (tAll >= T_CROWN) crownUI.at(tAll - T_CROWN, true, focoDelAgujero());
    if (tHold >= WINNER_HOLD + FOCO.placa) {
      dead = true;
      S.cleanup();
    }
  });
}
