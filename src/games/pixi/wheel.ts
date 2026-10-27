import { LEGIBLE, letraMinima } from "./letra";
import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep, beepFor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, shorten, winnersLabel } from "../overlay";
import { formaQueEntra } from "../nombres";
import { gajoDe, repartir } from "../wheel-layout";
import { FALSA, T_BRAKE, T_CREEP, T_CROWN, T_HOLD, T_LOCK, T_SETTLE, T_SPIN, T_WIND, beatFor, type BeatReason } from "./wheel-beats";
import { lugarDe } from "./kit/respuestas";
import { exponerNino } from "./nino";
import { W0, planWheelMotion } from "./wheel-motion";
import { respuestasRuleta } from "./wheel-nino";
import { CREAM, INK, YELLOW, contorno, mountPixi, type PixiStage } from "./stage";

/**
 * La ruleta, en PixiJS, con el director de cámara.
 *
 * Cada persona se lleva varios gajos intercalados, y la rueda gira de modo que
 * la flecha caiga justo en el gajo del ganador (`wheel-motion.ts`). Cuánto le
 * falta al empezar el último tramo, cuánto avanza después de trabarse y si la
 * parada falsa del arco "susto" se queda o avanza uno o dos, sale de la
 * semilla: así ni el gajo bajo la flecha al empezar el último tramo, ni el
 * último que nombra el relator, ni el de la parada falsa dicen quién gana.
 * Cómo se mira: la cámara arranca pegada al cubo, se abre mientras se arma la
 * rueda, y cuando la rueda frena se va acercando al puntero hasta quedar
 * encima en el amague. Con el ganador se abre para que se vean sus gajos
 * encendidos.
 */

const SEGS = 24;
const TAU = Math.PI * 2;

/**
 * El nombre que entra en un gajo: entero si es corto, si no el nombre de pila
 * con la inicial del apellido ("María Q."), y si tampoco entra, el de pila.
 * Antes se cortaba por la mitad ("María…spe"), y eso de lejos no se reconoce.
 */
function sliceLabel(name: string, max: number): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? "";
  const initial = parts.length > 1 ? `${first} ${(parts[parts.length - 1] ?? "").charAt(0)}.` : first;
  for (const c of [name, initial, first]) if (c.length <= max) return c;
  return `${first.slice(0, Math.max(1, max - 1))}…`;
}

/** El primer nombre: para decirlo en voz alta cuando varias personas comparten un gajo. */
function primerNombre(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** Un renglón de la placa de los grupos. */
interface PanelRow {
  row: Container;
  fondo: Graphics;
  lugar: Graphics;
  bar: Graphics;
  txt: Text;
  /** Alto del renglón, y el ancho que queda para el nombre después de la barra de color. */
  h: number;
  maxW: number;
  barW: number;
  /** Índice de la persona en la lista, o -1 si el renglón está vacío. */
  idx: number;
}

export async function wheelPixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const n = names.length;
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  const falsa = story.arc === "susto" && n >= 2;
  S.mark("arco", story.arc);
  // Con más de veinticuatro, la rueda sigue con veinticuatro gajos y cada uno
  // reúne a un grupo seguido de la lista (ver `wheel-layout.ts`).
  const grupos = n > SEGS ? repartir(n) : null;
  const rep = n <= 12 ? Math.max(1, Math.round(SEGS / n)) : 1;
  const segs = grupos ? SEGS : n * rep;
  const A = TAU / segs;
  /** Lo que cae bajo el puntero: una persona, o el grupo de su gajo si hay más de veinticuatro. */
  const personOf = (k: number): number => (grupos ? ((k % segs) + segs) % segs : ((k % n) + n) % n);
  /** Lo que gana: su gajo, con grupos, o la persona misma. */
  const ganUnit = grupos ? gajoDe(grupos, winnerIdx) : winnerIdx;
  /** El grupo más grande: cuántas filas lleva la placa de los grupos. */
  const tamMax = grupos ? Math.max(...grupos.map((g) => g.length)) : 1;
  /** Cómo se nombra lo que pasa bajo la flecha: la persona, o los primeros del grupo. */
  const etiqueta = (k: number): string => {
    if (!grupos) return names[k] ?? "";
    const ns = (grupos[k] ?? []).slice(0, 2).map((i) => primerNombre(names[i] ?? ""));
    return T[getLang()].cWheelGroup(ns, (grupos[k]?.length ?? 0) - ns.length);
  };
  setGameLength(T_CROWN, WINNER_HOLD);

  const startSeg = rng() * segs;
  const winSeg = grupos ? ganUnit : winnerIdx + n * Math.floor(rng() * rep);
  // La flecha para dentro del gajo ganador, nunca en su borde (ahí se confunde
  // con el vecino), y no siempre en el medio: con el medio fijo el final se
  // aprendía (auditoría, sección 8.7). Sale de la misma semilla; el gajo que
  // gana no cambia, lo fija el número público.
  const landing = winSeg + 0.5 + (rng() - 0.5) * 0.6;
  // Cómo gira hasta ahí, también de la semilla. Con grupos, cada gajo es un
  // grupo y la vuelta de nombres es la rueda entera.
  const mov = planWheelMotion({ segs, ciclo: grupos ? segs : n, startSeg, landing, falsa, rng });

  /* ============================================================ escena */
  /**
   * `col`: hay columna de nombres a la izquierda (catorce o menos, en pantalla
   * ancha). Sin columna, la rueda va al medio. Hasta el 18 de octubre de 2026
   * se quedaba a la derecha igual, con media pantalla vacía, porque al medio
   * chocaba con la placa del nombre, que iba a la izquierda y a media altura
   * (lo encontró el crítico de juegos, 16 de octubre de 2026). La placa ahora
   * va arriba (ver `build`), y al medio la rueda baja lo justo para que la
   * flecha no quede debajo de la barra del número público.
   */
  interface Geo { R: number; cx: number; cy: number; u: number; alto: boolean; col: boolean }
  const geo = (): Geo => {
    const sw = S.sw(), sh = S.sh(), u = S.u();
    const alto = S.portrait();
    if (alto) return { R: Math.min(sw * 0.4, sh * 0.28), cx: sw / 2, cy: sh * 0.38, u, alto, col: false };
    const wide43 = sw / sh < 1.5;
    const R = Math.min(sh * (wide43 ? 0.34 : 0.395), sw * (wide43 ? 0.26 : 0.3));
    const cx = Math.max(sw * 0.56, sw - R - 110 * u);
    if (n <= 14 && cx - R - 70 * u > 260 * u) return { R, cx, cy: sh * 0.5, u, alto, col: true };
    // Al medio: el poste arranca debajo de la barra de arriba (que es HTML, en
    // píxeles de pantalla) y el borde de abajo queda encima de la caja del
    // relator. Antes la caja podía tapar hasta 40 px de la rueda: a 1280x720 con
    // dieciocho personas tapaba el tercio de abajo (revisión de juegos, 20 de
    // octubre de 2026).
    const yTop = S.top() - 22 + 54 * u;
    const Rc = Math.min(R, (sh - S.bottom() - 12 * u - yTop) / 2);
    return { R: Rc, cx: sw / 2, cy: yTop + Rc, u, alto, col: false };
  };
  let G = geo();
  /** El acercamiento sobre la flecha mientras frena: en el celular, menos. */
  const closeZoom = (): number => (G.alto ? 1.9 : 2.3);
  /** Dónde quedó la placa del nombre, en la pantalla: la cámara la esquiva al acercarse. */
  let plateBox = { x: 0, y: 0, w: 0, h: 0, mid: false };

  let rays!: Graphics;
  let wheel!: Container;
  let ghosts: Container[] = [];
  let segG: Graphics[] = [];
  /** El nombre escrito en cada gajo (si lo lleva), para apagarlo junto con su gajo. */
  let segNames: (Text | undefined)[] = [];
  let bulbs!: Graphics;
  let bulbKey = -1;
  let stripes!: Graphics;
  let pointer!: Graphics;
  let hub!: Container;
  let rows: Container[] = [];
  let bigPlate!: Container;
  let bigName!: Text;
  let bigAv!: Sprite;
  let bigBar!: Graphics;
  /**
   * La placa de los grupos (con más de veinticuatro): una persona por renglón,
   * las del gajo que pasa bajo la flecha, y el renglón del ganador se enciende.
   */
  let panel: Container | null = null;
  let panelRows: PanelRow[] = [];
  let panelFor = -1;
  let lugarPintado = false;
  /** Dónde empieza la placa de los grupos en el celular: la rueda se encuadra encima. */
  let panelTop = 0;

  function discGraphics(R: number, u: number, withNames: boolean): Container {
    const c = new Container();
    const Rd = R * 0.86;
    if (withNames) segNames = [];
    for (let j = 0; j < segs; j++) {
      const a0 = j * A - Math.PI / 2;
      const g = new Graphics().moveTo(0, 0).arc(0, 0, Rd, a0, a0 + A).closePath().fill(S.color(personOf(j))).stroke({ width: 2.5 * u, color: INK });
      c.addChild(g);
      if (withNames && n <= 24) {
        // El nombre en su gajo, escrito hacia afuera: con la rueda quieta se
        // lee de quién es cada pedazo sin mirar la columna. Hasta el 7 de
        // octubre de 2026 solo con doce o menos; con más, lo único que daba
        // nombres era la placa, que cambiaba treinta veces por segundo.
        // Claro y con contorno de tinta: en tinta sola, sobre el morado del
        // tema claro no llegaba a 4,5 a 1, y al final, con los gajos apagados,
        // no se leía en ninguno (la medición de pantalla).
        //
        // La letra de la regla (28 px en 1080, 16 en un celular) y nunca menos: hasta el 26 de octubre de 2026 el gajo
        // le ponía tope (13 px con veinticuatro gajos en un celular) y un nombre largo se achicaba para entrar. Ahora lo
        // que se acorta es el nombre ("Valeria T.", "Valeria"), hasta donde el gajo deja que dos nombres vecinos no se
        // pisen mucho (la cuerda del gajo, a esa distancia del centro, no baja de seis décimas de la letra).
        const size = letraMinima(u);
        const nm = S.text("", { fontSize: size, fontWeight: "900", fill: CREAM, stroke: contorno(size) });
        nm.anchor.set(1, 0.5);
        const hastaElCentro = (0.6 * size) / (2 * Math.sin(A / 2));
        const cabe = Math.max(Rd * 0.2, Math.min(Rd * 0.62, Rd * 0.9 - hastaElCentro));
        const largo = sliceLabel(names[personOf(j)] ?? "", n <= 4 ? 12 : 10);
        const forma = formaQueEntra(largo, cabe, (s) => {
          nm.text = s;
          return nm.width;
        });
        nm.text = forma;
        const mid = a0 + A / 2;
        nm.rotation = mid;
        nm.position.set(Math.cos(mid) * Rd * 0.9, Math.sin(mid) * Rd * 0.9);
        nm.alpha = 0.85;
        c.addChild(nm);
        segNames[j] = nm;
      }
    }
    return c;
  }

  /**
   * Arma la placa de los grupos donde le toca según la pantalla: en horizontal,
   * una columna a la izquierda, a la altura de la rueda; en vertical, dos
   * columnas bajo la rueda y por encima de la barra de abajo. Cada renglón
   * lleva el color del gajo, para que se vea de qué gajo es la gente.
   */
  function buildPanel(): void {
    if (!grupos) return;
    const k = G.u;
    const sw = S.sw(), sh = S.sh();
    const gap = 8 * k;
    const alto = G.alto;
    const cols = alto ? 2 : 1;
    const filas = Math.ceil(tamMax / cols);
    const colW = alto ? Math.min((sw - 32 * k - gap) / 2, 220 * k) : Math.min(340 * k, G.cx - G.R - 64 * k);
    const rh = Math.max(
      18 * k,
      alto
        ? Math.min(40 * k, (sh - S.bottom() - 10 * k - (G.cy + G.R + 14 * k) - gap * (filas - 1)) / filas)
        : Math.min(40 * k, (sh * 0.62 - gap * (filas - 1)) / filas),
    );
    const x0 = alto ? (sw - (2 * colW + gap)) / 2 : 40 * k;
    // En el celular va pegada a la caja del relator, y no pegada a la rueda: así
    // le deja a la rueda todo el lugar de arriba cuando la cámara la encuadra.
    const y0 = alto ? sh - S.bottom() - 10 * k - (filas * rh + gap * (filas - 1)) : G.cy - (filas * rh + gap * (filas - 1)) / 2;
    panelTop = y0;
    const barW = 10 * k;
    panel = new Container();
    panel.visible = false;
    panelRows = [];
    panelFor = -1;
    lugarPintado = false;
    for (let i = 0; i < tamMax; i++) {
      const row = new Container();
      const fondo = new Graphics().rect(4 * k, 4 * k, colW, rh).fill(INK).rect(0, 0, colW, rh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
      const lugar = new Graphics().rect(0, 0, colW, rh).fill(YELLOW).stroke({ width: 4 * k, color: INK });
      lugar.visible = false;
      const bar = new Graphics();
      const txt = S.text("", { fontSize: Math.min(alto ? 18 * k : 20 * k, rh * 0.5), fontWeight: "800", fill: S.dark ? CREAM : INK });
      txt.anchor.set(0, 0.5);
      txt.position.set(barW + 12 * k, rh / 2);
      row.addChild(fondo, lugar, bar, txt);
      const col = alto ? i % 2 : 0;
      const fila = alto ? Math.floor(i / 2) : i;
      row.position.set(x0 + col * (colW + gap), y0 + fila * (rh + gap));
      row.visible = false;
      panel.addChild(row);
      panelRows.push({ row, fondo, lugar, bar, txt, h: rh, maxW: colW - barW - 24 * k, barW, idx: -1 });
    }
    S.hud.addChild(panel);
  }

  /** Pone en la placa a las personas del gajo `g`, una por renglón. */
  function setPanel(g: number): void {
    if (!grupos) return;
    panelFor = g;
    lugarPintado = false;
    const miembros = grupos[g] ?? [];
    panelRows.forEach((pr, i) => {
      const idx = miembros[i];
      pr.idx = idx ?? -1;
      pr.row.visible = idx !== undefined;
      pr.row.alpha = 1;
      pr.lugar.visible = false;
      pr.txt.style.fill = S.dark ? CREAM : INK;
      if (idx === undefined) return;
      pr.txt.text = names[idx] ?? "";
      pr.txt.scale.set(1);
      if (pr.txt.width > pr.maxW) pr.txt.scale.set(pr.maxW / pr.txt.width);
      pr.bar.clear().rect(0, 0, pr.barW, pr.h).fill(S.color(g));
    });
  }

  /** El lugar del ganador: su renglón se enciende y los demás se apagan un poco. */
  function pintarLugar(): void {
    panelRows.forEach((pr) => {
      const gana = pr.idx === winnerIdx;
      pr.lugar.visible = gana;
      pr.txt.style.fill = gana ? INK : S.dark ? CREAM : INK;
      pr.row.alpha = gana || pr.idx < 0 ? 1 : 0.5;
    });
    lugarPintado = true;
  }

  function build(): void {
    G = geo();
    const { R, u } = G;
    const sw = S.sw(), sh = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));

    S.bg.addChild(new Graphics().rect(0, 0, sw, sh).fill(S.dark ? 0x191226 : 0x241a3c));
    rays = new Graphics();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      rays.poly([0, 0, Math.cos(a - 0.1) * 1600 * u, Math.sin(a - 0.1) * 1600 * u, Math.cos(a + 0.1) * 1600 * u, Math.sin(a + 0.1) * 1600 * u]);
    }
    rays.fill({ color: YELLOW, alpha: 0.06 });
    S.scene.addChild(rays);

    // La rueda vive en el origen del mundo: la cámara decide dónde se ve.
    S.scene.addChild(new Graphics().circle(10 * u, 12 * u, R).fill(INK));
    wheel = new Container();
    ghosts = [0, 1].map(() => {
      const gc = discGraphics(R, u, false);
      gc.alpha = 0.3;
      S.scene.addChild(gc);
      return gc;
    });
    const disc = discGraphics(R, u, true);
    segG = disc.children.filter((c): c is Graphics => c instanceof Graphics);
    wheel.addChild(disc);
    // Sombra radial: sin esto, veinticuatro gajos planos son papilla.
    const shade = new Graphics();
    for (let i = 0; i < 6; i++) shade.circle(0, 0, R * 0.86 * (1 - i * 0.12)).fill({ color: 0x000000, alpha: 0.03 });
    wheel.addChild(shade);
    // El aro: un anillo, con el agujero cortado (en PixiJS 8 dos círculos
    // rellenos no hacen un anillo, hacen un disco que tapa los gajos).
    const rim = new Graphics().circle(0, 0, R).fill(S.dark ? 0x120d22 : 0x2b1f4a).circle(0, 0, R * 0.88).cut();
    rim.circle(0, 0, R).stroke({ width: 3 * u, color: INK }).circle(0, 0, R * 0.88).stroke({ width: 3 * u, color: INK });
    wheel.addChild(rim);
    stripes = new Graphics();
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU;
      stripes.moveTo(Math.cos(a) * R * 0.88, Math.sin(a) * R * 0.88).lineTo(Math.cos(a) * R, Math.sin(a) * R);
    }
    stripes.stroke({ width: 2 * u, color: CREAM, alpha: 0.3 });
    wheel.addChild(stripes);
    // Los foquitos del aro, como en una rueda de feria. Hasta el 7 de octubre
    // de 2026 eran los 64 dígitos del número del sorteo: en el primer plano del final
    // eran lo más grande después de la flecha, y durante el sorteo no va nada
    // técnico en pantalla. El número del sorteo se comprueba en la tarjeta de después.
    bulbs = new Graphics();
    bulbKey = -1;
    wheel.addChild(bulbs);
    const pegs = new Graphics();
    const rr = R * 0.875;
    for (let j = 0; j < segs; j++) {
      const a = j * A - Math.PI / 2;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, s = 8 * u;
      pegs.poly([x, y - s, x + s, y, x, y + s, x - s, y]).fill(YELLOW).stroke({ width: 2 * u, color: INK });
    }
    // El perno cero, con las tres barritas: marca la vuelta.
    pegs.rect(-9 * u, -rr - 22 * u, 18 * u, 16 * u).fill(INK)
      .rect(-7.5 * u, -rr - 20.5 * u, 15 * u, 4.3 * u).fill(0xd52b1e)
      .rect(-7.5 * u, -rr - 16.2 * u, 15 * u, 4.3 * u).fill(0xf9e300)
      .rect(-7.5 * u, -rr - 11.9 * u, 15 * u, 4.3 * u).fill(0x007a33);
    wheel.addChild(pegs);
    S.scene.addChild(wheel);

    hub = new Container();
    const rh = R * 0.2;
    hub.addChild(new Graphics().circle(0, 0, rh).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 4 * u, color: INK }));
    const sc = (rh * 1.25) / 26;
    const llama = new Graphics();
    const r = (rx: number, ry: number, rw: number, rh2: number): void => { llama.rect((rx - 11) * sc, (ry - 11) * sc, rw * sc, rh2 * sc); };
    r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
    r(3, 18, 2.5, 6); r(8, 18, 2.5, 6); r(12.5, 18, 2.5, 6); r(16, 18, 2.5, 6);
    llama.fill(0xe93d9c);
    hub.addChild(llama);
    S.scene.addChild(hub);

    pointer = new Graphics().poly([-17 * u, 0, 17 * u, 0, 0, 34 * u]).fill(YELLOW).stroke({ width: 4 * u, color: INK });
    const post = new Graphics().rect(-6 * u, -R - 54 * u, 12 * u, 30 * u).fill(INK);
    S.scene.addChild(post, pointer);
    pointer.position.set(0, -R - 26 * u);

    // La columna de nombres (o una placa grande), fija en la pantalla.
    rows = [];
    const k = u;
    if (G.col) {
      const colW = G.cx - R - 90 * k;
      const cnt = Math.min(n, 9);
      const gap = 10 * k;
      const hgt = Math.min(64 * k, (sh * 0.72 - gap * cnt) / cnt);
      const y0 = G.cy - (cnt * (hgt + gap) - gap) / 2;
      for (let i = 0; i < cnt; i++) {
        const row = new Container();
        const av = Math.min(hgt * 0.62, 44 * k);
        const bgr = new Graphics().rect(5 * k, 5 * k, colW, hgt).fill(INK).rect(0, 0, colW, hgt).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 3 * k, color: INK });
        const bar = new Graphics().rect(0, 0, 10 * k, hgt).fill(S.color(i));
        const sp = new Sprite(S.face(names[i] ?? ""));
        sp.width = sp.height = av;
        sp.position.set(36 * k, (hgt - av) / 2);
        const nm = S.text(shorten(names[i] ?? "", 22), { fontSize: Math.min(26 * k, hgt * 0.36), fontWeight: "800", fill: S.dark ? CREAM : INK });
        nm.anchor.set(0, 0.5);
        nm.position.set(36 * k + av + 12 * k, hgt / 2);
        const maxW = colW - (36 * k + av + 26 * k);
        if (nm.width > maxW) nm.scale.set(maxW / nm.width);
        row.addChild(bgr, bar, sp, nm);
        row.position.set(40 * k, y0 + i * (hgt + gap));
        S.hud.addChild(row);
        rows.push(row);
      }
    }
    // La placa del nombre que pasa bajo la flecha sale recién a paso de hombre,
    // y para entonces la cámara está encima de la flecha y la rueda llena la
    // pantalla: a media altura tapaba gajos de cualquier lado, y en el celular
    // el mismo gajo de la flecha (lo encontró el crítico de juegos, 16 de
    // octubre de 2026). Va arriba, donde con la cámara encima de la flecha
    // solo hay cielo: en pantalla ancha, a la izquierda de la flecha; si ahí no
    // entra (en el celular), centrada encima del poste, y la cámara baja lo que
    // haga falta para que el poste arranque debajo (ver `underPlate`).
    bigPlate = new Container();
    const ph = (G.alto ? 92 : 96) * k;
    // Lo que queda a la izquierda de la flecha con la cámara encima: la flecha
    // mide 17 de medio ancho, crece un 30% en el golpe de la traba y se ve
    // agrandada por el acercamiento.
    const side = sw / 2 - 40 * k - 17 * k * 1.3 * closeZoom() - 20 * k;
    const mid = G.alto || side < 240 * k;
    const pw = mid ? Math.min(sw - 32 * k, 520 * k) : Math.min(520 * k, side);
    bigBar = new Graphics();
    bigPlate.addChild(new Graphics().rect(6 * k, 6 * k, pw, ph).fill(INK).rect(0, 0, pw, ph).fill(S.dark ? 0x221a33 : 0xffffff).stroke({ width: 4 * k, color: YELLOW }), bigBar);
    bigAv = new Sprite(S.face(names[0] ?? ""));
    bigAv.width = bigAv.height = 56 * k;
    bigAv.position.set(38 * k, (ph - 56 * k) / 2);
    bigName = S.text("", { fontSize: 30 * k, fontWeight: "900", fill: S.dark ? CREAM : INK });
    bigName.anchor.set(0, 0.5);
    bigName.position.set(38 * k + 68 * k, ph / 2);
    bigPlate.addChild(bigAv, bigName);
    bigPlate.position.set(mid ? (sw - pw) / 2 : 40 * k, S.top() + 8 * k);
    // Con grupos, la placa grande no sale: la reemplaza la de los renglones, que
    // va a un costado y no tapa la rueda, así que la cámara no le pone límite.
    if (!grupos) plateBox = { x: bigPlate.x, y: bigPlate.y, w: pw, h: ph, mid };
    bigPlate.visible = rows.length === 0 && !grupos;
    S.hud.addChild(bigPlate);
    buildPanel();
  }
  build();
  const crown = S.crown(names, winners);
  S.onResize(build);

  /** El mundo se mira de modo que la rueda quede donde manda la disposición. */
  const restView = (): { x: number; y: number } => ({ x: S.sw() / 2 - G.cx, y: S.sh() / 2 - G.cy });
  cam.cut(0, 0, 1.9);

  /* ============================================================ estado */
  let tAll = 0, tHold = 0;
  let rot = -startSeg * A;
  let lastClick = Math.floor(startSeg), lastLap = -1, lastHum = -1, saidUpTo = -1;
  let pegHits = 0, buildTick = 0, holdBeats = 0;
  let cur = personOf(Math.floor(startSeg));
  /** El último gajo que el relator nombró mientras la rueda frena. */
  let namedCur = -1;
  let flash = 0, bump = 0, didLock = false, saidPeg = false, saidLast = false, didCrown = false;
  // `?auditar=nino`: la prueba del niño (`scripts/audit-nino.mjs`) lee del plan quién va adelante, hacia dónde, cuánto falta y qué pasó. Solo lee.
  exponerNino({
    duracion: T_CROWN,
    t: () => tAll,
    verdad: () => {
      const r = respuestasRuleta({ n, segs, grupos, startSeg, mov, ganador: winnerIdx, falsa }, tAll);
      // En qué parte de la pantalla cae el gajo que está bajo la flecha: lo decide la cámara, que el plan no conoce.
      const p = S.scene.toGlobal({ x: 0, y: -G.R * 0.78 });
      return { ...r, adelante: { ...r.adelante, lugar: lugarDe(p.x, p.y, S.sw(), S.sh()) } };
    },
  });

  const segUnder = (): number => Math.floor((((-rot / A) % segs) + segs) % segs) % segs;
  /**
   * La lengüeta es un resorte amortiguado. El clavo que pasa la empuja hasta
   * donde la dobla (`flapper`); cuando la suelta, vuelve sola, se pasa un poco
   * para el otro lado y tiembla, como la de una ruleta de feria. Hasta el 29 de
   * septiembre de 2026 seguía al clavo sin física y se enderezaba de golpe.
   * Corre a paso fijo de 1/240 s, así la misma ronda tiembla igual.
   */
  let flapA = 0, flapV = 0, flapAcc = 0;
  function flapStep(dt: number, w: number): void {
    const h = 1 / 240;
    flapAcc += dt;
    while (flapAcc >= h) {
      flapAcc -= h;
      flapV += (-900 * flapA - 11 * flapV) * h;
      flapA += flapV * h;
    }
    const contact = flapper(w);
    if (flapA < contact) {
      flapV = Math.max(flapV, dt > 0 ? (contact - flapA) / dt : 0);
      flapA = contact;
    }
  }
  function flapper(w: number): number {
    const s = (((-rot / A) % segs) + segs) % segs;
    const frac = s - Math.floor(s);
    const bend = Math.max(0, Math.min(1, 1 - (Math.min(frac, 1 - frac) * 2) / 0.22));
    return 0.42 * Math.max(bend, Math.max(0, Math.min(0.75, w / 24)));
  }

  skipFn = (): void => {
    if (tAll >= T_CROWN) return;
    tAll = T_CROWN;
    rot = -(startSeg + mov.total) * A;
    didLock = true;
    crowned();
  };
  /** Aplica un beat de cámara de la agenda pura (wheel-beats.ts): una sola sacudida, en la coronación. */
  function camBeat(reason: BeatReason): void {
    const b = beatFor(falsa, reason);
    if (!b) return;
    if (b.kind === "shake") cam.shake(b.strength * G.u);
    else if (b.kind === "punch" || b.kind === "push") cam.punch(b.strength);
  }
  function crowned(): void {
    if (didCrown) return;
    didCrown = true;
    cur = ganUnit;
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
    // En un celular la rueda entera ya llena la pantalla y el golpe de 0,3 llegaba a 1,4 veces el plano general (se pide
    // 1,6): sube a 0,55. El gajo ganador, debajo de la flecha, queda entero debajo del cartel y encima del relator con
    // cualquier acercamiento: la cámara se corre lo justo (nunca antes del golpe: protegerlo antes lo delataría).
    S.mark("golpe", cam.golpe(G.alto ? 0.55 : 0.3, 0.6, 1.1).toFixed(3));
    cam.proteger({ x: -0.2 * G.R, y: -1.02 * G.R, w: 0.4 * G.R, h: 0.62 * G.R }, { x0: 8 * G.u, y0: S.placaBajo(winners.length) + 12 * G.u, x1: S.sw() - 8 * G.u, y1: S.sh() - S.bottom() - 10 * G.u });
    camBeat("crown");
  }

  function tickAudio(w: number): void {
    if (tAll >= T_SPIN && tAll < T_BRAKE) {
      const lap = Math.floor(mov.pos(tAll) / segs);
      if (lap !== lastLap) {
        lastLap = lap;
        beep(note(15), 0.05, "sine", 0.03);
      }
    }
    if (tAll >= T_SPIN && w > 16) {
      const hum = Math.floor(tAll / 0.3);
      if (hum !== lastHum) {
        lastHum = hum;
        beepFor(note(Math.round((w / W0) * 4)), 0.36, "sawtooth", 0.026);
      }
      return;
    }
    if (w > 16 || w <= 0) return;
    const s = Math.floor((((-rot / A) % segs) + segs) % segs);
    if (s === lastClick) return;
    lastClick = s;
    // Los últimos clics son los que deciden: en cada gajo que pasa cuando la rueda
    // casi para, la flecha da un golpecito.
    if (w < 3) bump = Math.max(bump, 0.1 + 0.08 * (1 - w / 3));
    if (n <= 4) {
      beep(note([5, 8, 10, 12][personOf(s)] ?? 5), 0.05, "triangle", 0.03);
      return;
    }
    // Tic y tac, y cada vez más fuerte a medida que frena: eran ochenta clics
    // idénticos, y los últimos, que son los que deciden, pesaban lo mismo.
    beep(note(s % 2 ? 7 : 8), 0.03, "square", 0.034 + 0.016 * (1 - w / 16));
  }

  function sayIfDue(w: number): void {
    // Al saltar, la hora pasa directo al cartel: lo que quedaba por decir no
    // se dice encima del ganador.
    if (didCrown) return;
    const cues: [number, () => void][] = [
      [0.05, () => S.say(t("cWheelBuild"), 0.1)],
      [0.7, () => S.say(grupos ? T[getLang()].cWheelGroups(segs, tamMax) : T[getLang()].cWheelSplit(segs, rep), 0.15)],
      [T_WIND, () => S.say(t("cWheelCharge"), 0.3)],
      [T_SPIN, () => S.say(t("cWheelGo"), 0.45)],
      [3.4, () => S.say(t("cWheelFast"), 0.5)],
      [5.6, () => S.say(t("cWheelSlow"), 0.62)],
      // Mientras frena eran diez segundos con la misma línea, y la música se
      // enfriaba justo antes del final.
      [7.8, () => S.say(t("cWheelTick"), 0.7)],
      // El último tramo: desde acá la rueda se arrastra hasta trabarse. Es el
      // momento que decide para el auditor de delatores. Antes no se nombra a
      // nadie, y lo que le falta recorrer sale de la semilla.
      [
        T_CREEP,
        () => {
          S.say(t("cWheelLast"), 0.8);
          // El gajo de este momento no se nombra: se nombran los que entran después.
          namedCur = cur;
        },
      ],
      // Sin parada falsa, después de trabarse la rueda se arrastra hasta el
      // final: a veces se queda en el último nombrado y a veces pasa al otro.
      ...(falsa ? [] : ([[T_SETTLE, () => S.say(t("cWheelWhere"), 0.96)]] as [number, () => void][])),
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }
    // El nombre se dice cuando el puntero cambia de gajo y el gajo va a durar lo
    // bastante para que se lea (0,4 s: `w` va en gajos por segundo). Antes se
    // decía cada 0,45 s desde los 4,5 gajos por segundo, y la línea nombraba
    // un gajo que la flecha ya había pasado, con la placa mostrando otro. Se
    // nombra hasta que se traba: después la rueda a veces se queda en el
    // último nombrado y a veces avanza al siguiente.
    if (tAll >= T_CREEP + 0.6 && tAll < T_HOLD && w < 2.5 && cur !== namedCur) {
      namedCur = cur;
      S.say(T[getLang()].cWheelOn(etiqueta(cur)), 0.55);
    }
    if (tAll >= T_HOLD && !saidPeg) {
      saidPeg = true;
      S.say(falsa ? T[getLang()].cWheelFalse(etiqueta(cur)) : t("cWheelPeg"), 0.9);
      cam.punch(0.06);
      // La parada falsa tiene que sonar a parada: un clac como el de la traba,
      // más chico. Hasta el 7 de octubre de 2026 eran 2,7 s sin ningún efecto.
      if (falsa) {
        beep(note(5), 0.07, "square", 0.05);
        beep(note(0), 0.25, "sine", 0.06);
      }
    }
    // La parada falsa se resuelve: se destraba y avanza uno o dos gajos, o se
    // queda en el nombrado. Hasta el 21 de octubre de 2026 avanzaba siempre
    // uno, y el nombrado no ganaba nunca.
    if (falsa && tAll >= T_HOLD + FALSA && !saidLast) {
      saidLast = true;
      if (mov.seQueda) {
        S.say(t("cWheelStays"), 0.95);
        beep(note(0), 0.18, "sine", 0.07);
        setTimeout(() => beep(note(5), 0.1, "triangle", 0.045), 90);
      } else {
        S.say(t("cWheelMoved"), 0.95);
        beep(note(3), 0.08, "square", 0.06);
        setTimeout(() => beep(note(10), 0.12, "triangle", 0.05), 60);
      }
      camBeat("tease");
    }
  }

  /**
   * Lo más arriba que puede mirar la cámara con ese acercamiento y la flecha
   * en el medio, sin que la rueda quede debajo de la placa del nombre. Con la
   * placa a un costado cuenta el aro a la altura de su borde de adentro; con la
   * placa centrada, el poste de la flecha, que es lo más alto. Con un 6% más
   * de acercamiento, por los golpes de zoom del final.
   */
  function underPlate(zoom: number): number {
    const z = zoom * 1.06;
    const u = G.u;
    const below = plateBox.y + plateBox.h + 12 * u - S.sh() / 2;
    if (plateBox.mid) return -G.R - 54 * u - below / z;
    const dx = plateBox.x + plateBox.w - S.sw() / 2;
    const r = z * G.R;
    if (Math.abs(dx) >= r) return Infinity;
    return -(Math.sqrt(r * r - dx * dx) + below) / z;
  }

  /**
   * Dónde mirar para que la rueda entre entera entre dos rayas de la pantalla,
   * `yTop` arriba y `yBot` abajo, centrada entre las dos, sin salirse por los
   * costados y sin acercarse más de `zMax`. `conPoste`: con la flecha y su
   * poste, que van encima del aro. Devuelve el punto del mundo que va al centro
   * de la pantalla y el acercamiento, como los pide `cam.lookAt`.
   */
  function enCaja(yTop: number, yBot: number, zMax: number, conPoste: boolean): { x: number; y: number; z: number } {
    const u = G.u, R = G.R, sw = S.sw(), sh = S.sh();
    const arriba = conPoste ? R + 54 * u : R;
    // El aro y su sombra, corrida 10 a la derecha y 12 hacia abajo.
    const abajo = R + 12 * u;
    const z = Math.max(0.3, Math.min(zMax, (yBot - yTop) / (arriba + abajo), (sw - 16 * u) / (2 * R + 10 * u)));
    const cy = yTop + (yBot - yTop - z * (arriba + abajo)) / 2 + z * arriba;
    // A lo ancho, donde la deja la disposición, acercada hacia el centro como
    // la acerca la cámara, y sin cortarse contra los bordes.
    const media = z * R;
    const cx = Math.min(Math.max(sw / 2 + (G.cx - sw / 2) * z, media + 8 * u), sw - media - 18 * u);
    return { x: (sw / 2 - cx) / z, y: (sh / 2 - cy) / z, z };
  }

  /** La cámara: pegada al cubo al armar, abierta al girar, encima del puntero al frenar. */
  function direct(): void {
    const rest = restView();
    const R = G.R;
    const u = G.u;
    const ptr = { x: 0, y: -R * 0.78 };
    const cajaArriba = S.sh() - S.bottom() - 10 * u;
    // En el celular, cuando frena, la rueda entera entre lo de arriba (la placa
    // del nombre, o la barra si los nombres van en la placa de los grupos) y lo
    // de abajo (la caja del relator, o la placa de los grupos). Acercada sobre la
    // flecha se cortaba por los costados y por abajo, y la caja le tapaba la
    // parte de abajo (evaluador visual, 21 de octubre de 2026). En la pantalla
    // ancha el acercamiento sigue cortando la rueda a propósito.
    const celu = G.alto
      ? enCaja(grupos ? S.top() + 8 * u : plateBox.y + plateBox.h + 12 * u, grupos ? panelTop - 10 * u : cajaArriba, closeZoom(), true)
      : null;
    if (tAll < T_WIND) {
      const p = tAll / T_WIND;
      cam.lookAt(rest.x * p, rest.y * p, 1.9 - 0.9 * p, 3);
    } else if (tAll < T_BRAKE) {
      cam.lookAt(rest.x, rest.y, 1, 2.5, -0.02 * Math.sin(tAll * 1.3));
    } else if (tAll < T_CREEP) {
      const p = (tAll - T_BRAKE) / (T_CREEP - T_BRAKE);
      const e = p * p;
      if (celu) cam.lookAt(rest.x + (celu.x - rest.x) * e, rest.y + (celu.y - rest.y) * e, 1 + (celu.z - 1) * e, 2);
      else cam.lookAt(rest.x * (1 - e) + ptr.x * e * 0.6, rest.y * (1 - e) + ptr.y * e * 0.6, 1 + 0.45 * e, 2);
    } else if (tAll < T_CROWN) {
      if (celu) {
        cam.lookAt(celu.x, celu.y, celu.z, 3.5);
      } else {
        const close = closeZoom();
        const z = tAll >= T_HOLD ? close : 1.6 + (close - 1.6) * ((tAll - T_CREEP) / (T_HOLD - T_CREEP));
        cam.lookAt(ptr.x, Math.min(ptr.y, underPlate(z)), z, 3.5);
      }
    } else {
      // Con el ganador, la rueda entera entre el cartel, que sale arriba al
      // centro, y la caja del relator: el gajo ganador queda arriba, bajo la
      // flecha, y no lo tapa el cartel. Antes bajaba un 17 % de la pantalla y
      // la caja le tapaba la parte de abajo (evaluador visual, 21 de octubre de
      // 2026). Llega en un segundo: el cartel dura tres, y al ritmo de antes la
      // rueda recién terminaba de abrirse cuando el estadio se cerraba.
      const c = enCaja(S.placaBajo(winners.length) + 10 * u, cajaArriba, G.alto ? 0.96 : 0.84, false);
      cam.lookAt(c.x, c.y, c.z, 6);
    }
  }

  function draw(w: number, now: number, dt: number): void {
    const u = G.u;
    rays.rotation = -now * 0.04;
    wheel.rotation = rot;
    ghosts.forEach((g, i) => {
      g.rotation = rot - w * A * 0.012 * (i + 1);
      g.visible = w > 6;
    });
    const shown = Math.min(64, Math.floor(Math.max(0, Math.min(1, tAll / 0.7)) * 64));
    const R = G.R;
    const rm = (R + R * 0.88) / 2;
    stripes.visible = w > 12;
    bulbs.visible = w <= 12;
    // Con el ganador, los foquitos se prenden en amarillo, de a uno sí y uno no.
    const lit = tAll >= T_CROWN ? 1 + (Math.floor((tAll - T_CROWN) * 5) % 2) : 0;
    const key = shown * 3 + lit;
    if (bulbs.visible && key !== bulbKey) {
      bulbKey = key;
      bulbs.clear();
      for (let i = 0; i < shown; i++) {
        const a = (i / 64) * TAU - Math.PI / 2;
        const on = lit > 0 && i % 2 === lit - 1;
        bulbs.circle(Math.cos(a) * rm, Math.sin(a) * rm, (on ? 3.6 : 2.8) * u).fill({ color: on ? YELLOW : CREAM, alpha: on ? 1 : lit ? 0.35 : 0.6 });
      }
    }
    hub.rotation = Math.max(-1.2, Math.min(1.2, -rot * 0.25)) * (w > 0 ? 1 : 0);
    flapStep(dt, w);
    pointer.rotation = flapA;
    // Al trabarse, la lengüeta pega un golpe: crece y vuelve.
    pointer.scale.set(1 + (flash + bump) * 2.5);
    // Con el ganador, sus gajos salen hacia afuera y los demás se apagan.
    if (tAll >= T_CROWN) {
      const e = Math.min(1, (tAll - T_CROWN) * 2);
      segG.forEach((g, j) => {
        const mine = personOf(j) === ganUnit;
        const mid = j * A - Math.PI / 2 + A / 2;
        g.position.set(mine ? Math.cos(mid) * 16 * u * e : 0, mine ? Math.sin(mid) * 16 * u * e : 0);
        g.alpha = mine ? 1 : 1 - 0.55 * e;
        // El nombre se apaga con su gajo: claro, si no, quedaba más prendido
        // que el gajo y le competía al del ganador.
        const nm = segNames[j];
        if (nm) nm.alpha = 0.85 * g.alpha;
      });
    }
    // La columna: la fila del puntero se enciende; en el acercamiento, placa grande.
    const close = tAll >= T_CREEP && tAll < T_CROWN + 10;
    rows.forEach((r, i) => {
      const on = i === cur;
      r.x = 40 * u + (on ? 12 * u : 0);
      r.scale.set(on ? 1.06 : 1);
      r.alpha = close ? Math.max(0, 1 - (tAll - T_CREEP) * 2) : 1;
    });
    // La placa, solo cuando se puede leer: girando cambiaba treinta veces por
    // segundo, y de entrada tapaba la rueda. Mientras gira, cada uno busca su
    // nombre en su gajo.
    bigPlate.visible = !grupos && close && w < 4;
    // Arriba, al lado del cartel del ganador: se apaga enseguida, si no son
    // dos placas con el mismo nombre.
    bigPlate.alpha = tAll >= T_CROWN ? Math.max(0, 1 - (tAll - T_CROWN) * 6) : 1;
    // Con grupos, la placa de los renglones: el gajo que pasa, y al frenar, el lugar del ganador.
    if (grupos && panel) {
      panel.visible = close && w < 4;
      panel.alpha = tAll >= T_CROWN ? Math.max(0, 1 - (tAll - T_CROWN) * 6) : 1;
      if (panel.visible) {
        if (panelFor !== cur) setPanel(cur);
        if (!lugarPintado && tAll >= T_LOCK && panelFor === ganUnit) pintarLugar();
      }
    }
    const pname = names[cur] ?? "";
    // Escondida no se reescribe: girando cambiaba treinta veces por segundo, y
    // cada cambio vuelve a dibujar el texto en el hilo principal.
    if (bigPlate.visible && bigName.text !== pname) {
      bigName.text = pname;
      bigAv.texture = S.face(pname);
      const maxW = plateBox.w - 130 * u;
      bigName.scale.set(1);
      if (bigName.width > maxW) bigName.scale.set(maxW / bigName.width);
      bigBar.clear().rect(0, 0, 26 * u, plateBox.h).fill(S.color(cur));
    }
    if (tAll >= T_CROWN) crown.at(tAll - T_CROWN);
  }

  // Para el auditor de emoción: el gajo ganador, debajo de la flecha, en la pantalla.
  S.ganadorEn(() => {
    const sw = S.sw(), sh = S.sh();
    const z = cam.toScreen(1, 0, sw, sh).x - cam.toScreen(0, 0, sw, sh).x;
    // La rueda está en el origen del mundo; la cámara es la que la lleva adonde manda la disposición.
    const a = cam.toScreen(0, -G.R * 0.95, sw, sh), b = cam.toScreen(0, -G.R * 0.4, sw, sh);
    const ancho = G.R * 0.34 * z;
    return { x: a.x - ancho / 2, y: a.y, w: ancho, h: b.y - a.y };
  });

  S.run((dt, now) => {
    tAll += dt;
    S.breath(tAll, T_CROWN);
    const w = mov.speed(tAll);
    rot = -(startSeg + mov.pos(tAll)) * A;
    if (tAll < 1.1) {
      const want = Math.floor((tAll / 1.1) * 24);
      while (buildTick < want) {
        beep(note(5 + Math.floor(buildTick / 2)), 0.05, "square", 0.03);
        buildTick++;
      }
    }
    if (!falsa && tAll >= T_HOLD && tAll < T_SETTLE) {
      const hits = Math.floor(Math.pow((tAll - T_HOLD) / (T_SETTLE - T_HOLD), 0.62) * 7);
      while (pegHits < hits) {
        pegHits++;
        const q = pegHits / 7;
        beep(note(Math.max(0, 2 - Math.round(q * 2))), 0.06, "square", 0.062 - q * 0.028);
      }
    }
    // Mientras dura la parada falsa, un latido. Los últimos 0,15 s van en
    // silencio, para que la sala crea que paró antes del "¡se movió!".
    if (falsa && tAll >= T_HOLD && tAll < T_HOLD + FALSA - 0.15) {
      const want = Math.floor((tAll - T_HOLD) / 0.25);
      while (holdBeats < want) {
        holdBeats++;
        beep(note(0), 0.12, "sine", 0.06 + 0.008 * holdBeats);
        beep(note(5), 0.08, "triangle", 0.03);
      }
    }
    if (tAll >= T_LOCK && !didLock) {
      didLock = true;
      flash = 0.12;
      // Corta: con su cola larga pisaba el silencio de antes del cartel.
      beep(note(0), 0.3, "sine", 0.08);
      setTimeout(() => beep(note(5), 0.07, "square", 0.06), 40);
      setTimeout(() => beep(note(15), 0.12, "triangle", 0.05), 90);
      camBeat("lock");
    }
    flash = Math.max(0, flash - dt);
    bump = Math.max(0, bump - dt * 8);
    if (tAll >= T_CROWN) crowned();
    else cur = personOf(segUnder());
    tickAudio(w);
    sayIfDue(w);
    direct();
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    draw(w, now, dt);
    if (tAll >= T_CROWN) tHold += dt * paceFactor();
    if (tHold >= WINNER_HOLD) S.cleanup();
  });
}
