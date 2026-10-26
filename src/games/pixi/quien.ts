import { Container, Graphics, Sprite, Text } from "pixi.js";
import { T, getLang, t } from "../../i18n";
import { clamp, ease } from "../overlay";
import { colorDeNombre } from "./foco-vista";
import { crearJuego, type Caja, type FocoPunto, type Kit, type PlanoToma, type Zona } from "./kit";
import { FINALISTAS, FLIP, REGROUP, SALTO, SALTO_ALTO, TIC, T_DEAL, lugaresEn, pasoEn, planQuien, vivosEn, type Datos, type Step } from "./quien-show";
import type { Question, Round } from "./quien-plan";
import { CREAM, INK, YELLOW } from "./stage";

/**
 * De pie (antes ¿Quién es?).
 *
 * La sala se para. En cada turno aparece la pregunta sobre el nombre ("¿TU
 * NOMBRE TIENE LA R?"), cada uno la revisa en silencio, y después se contesta
 * por quien ganó: "¡SÍ! Se sientan los que no la tienen". La sala se sienta, y
 * recién entonces la pantalla da vuelta las cartas de los que se sentaron, como
 * un árbitro que confirma. Quedan de pie los que siguen; con cuatro o menos,
 * "¡Finalistas, que los vean!"; la última pregunta deja a uno solo, que es el
 * ganador.
 *
 * No decide nada: el ganador sale del protocolo antes, y las preguntas se
 * eligen sabiendo quién es (`quien-plan.ts`, puro y probado). Aguanta de 8 a
 * 200 personas: cada pregunta parte el grupo cerca de la mitad, así que 50
 * nombres son unas seis y 200 unas ocho.
 *
 * Nació del Ahorcado que propuso Guido Salazar (@GuidoSV7) el 1 de octubre de
 * 2026. Las preguntas son de letra, de número, de la mitad del abecedario y del
 * largo; el juego no muestra el nombre escondido ni delata con el foco.
 *
 * Está hecha sobre el kit (`kit/`): el show es puro (`quien-show.ts`), esta
 * escena es una función de la hora del juego y el kit pone lo demás. Todo sale
 * de la hora del juego.
 */

/* --------------------------------------------------------------- la escena */

/**
 * La escena de De pie: las cartas, el cartel de la pregunta, el sello y el
 * contador. Es una función de la hora del juego: `aim(t)` dice adónde mira la
 * cámara y `draw(t)` pone cada carta. El kit lleva el reloj, el guion, el golpe
 * y el foco (`crearJuego`).
 */
function crearEscena(kit: Kit, d: Datos) {
  const S = kit.S;
  const cam = kit.cam;
  const L = T[getLang()];
  const { names, prizes, total, rounds, pasosPregunta, goneAt, story } = d;
  const winners = kit.ganadores;
  const alive = (ri: number, t: number): number[] => vivosEn(d, ri, t);
  const layoutSet = (ri: number, t: number): number[] => lugaresEn(d, ri, t);
  const stepAt = (t: number): Step => pasoEn(d, t);
  /** Lo que se dice al contestar una pregunta: las cartas que se sientan. */
  const frase = (q: Question): string =>
    q.tipo === "letra" ? L.cQuiSitL(q.valor, q.has)
      : q.tipo === "numero" ? L.cQuiSitD(q.valor, q.has)
        : q.tipo === "mitad" ? L.cQuiSitM(q.has)
          : q.tipo === "largo" ? L.cQuiSitG(Number(q.valor), q.has)
            : L.cQuiSitO(Number(q.valor), q.has);
  let tAll = 0;
  let crowned = false;

  /**
   * La caja del relator, medida de verdad: su borde de arriba, sin el
   * acercamiento con que entra cada frase. Una frase larga ocupa dos renglones
   * y la caja crece hacia arriba; con la franja de un renglón, la de las reglas
   * ("Vale el nombre de la lista, sin tildes…") tapaba los apellidos de la
   * última fila justo cuando cada uno busca su nombre (evaluador, 22 de octubre
   * de 2026). El tablero solo se achica, de a poco, y vuelve a medirse con cada
   * cambio de pantalla: no respira con cada frase.
   */
  const relator = document.getElementById("commentary");
  let techoRelator = Infinity;
  const fondoDe = (h: number, k: number): number => Math.min(h - S.bottom() - 12 * k, techoRelator - 12 * k);
  const G = (): { w: number; h: number; k: number; top: number; bottom: number } => {
    const w = S.sw(), h = S.sh(), k = S.u();
    // En el celular la pregunta va debajo del contador, así que las cartas arrancan más abajo.
    return { w, h, k, top: S.top() + (S.portrait() ? 175 : 112) * k, bottom: fondoDe(h, k) };
  };
  let g = G();
  /**
   * Las columnas del acomodo actual: se eligen al armarlo y no cambian hasta el
   * próximo. Así, cuando la caja del relator crece, el tablero se achica de a
   * poco en vez de reacomodarse de golpe (con 8, pasaba de dos filas a una en
   * pleno reparto).
   */
  let colsAcomodo: { m: number; cols: number } | null = null;
  /** La grilla de `m` cartas que mejor llena el tablero: el tamaño de carta y dónde va cada una. */
  const grid = (m: number): { cw: number; ch: number; at: (i: number) => { x: number; y: number } } => {
    const areaW = g.w * 0.94, areaH = Math.max(60, g.bottom - g.top);
    const ratio = 1.32;
    if (!colsAcomodo || colsAcomodo.m !== m) {
      let best = { cols: 1, cw: 0 };
      for (let cols = 1; cols <= m; cols++) {
        const rows = Math.ceil(m / cols);
        const cw = Math.min(areaW / cols, areaH / rows / ratio) * 0.9;
        if (cw > best.cw) best = { cols, cw };
      }
      colsAcomodo = { m, cols: best.cols };
    }
    const cols = colsAcomodo.cols, rows = Math.ceil(m / cols);
    const cw = Math.min(Math.min(areaW / cols, areaH / rows / ratio) * 0.9, 170 * g.k), ch = cw * ratio;
    const gx = areaW / cols, gy = Math.min(areaH / rows, ch * 1.12);
    const x0 = (g.w - cols * gx) / 2, y0 = g.top + (areaH - rows * gy) / 2;
    return { cw, ch, at: (i) => ({ x: x0 + ((i % cols) + 0.5) * gx, y: y0 + (Math.floor(i / cols) + 0.5) * gy }) };
  };

  /* ------------------------------------------------------------------ capas */
  const bg = new Graphics();
  S.bg.addChild(bg);
  const board = new Graphics();
  const cardLayer = new Container();
  const fx = new Graphics();
  S.scene.addChild(board, cardLayer, fx);
  // La pregunta, grande arriba: una línea chica y otra grande; la cuenta de la revisión, abajo.
  const banner = new Container();
  const bannerBg = new Graphics();
  const bannerBar = new Graphics();
  const bannerA = S.text("", { fontSize: 20, fontWeight: "900", fill: INK });
  bannerA.anchor.set(0.5);
  const bannerB = S.text("", { fontSize: 40, fontWeight: "900", fill: INK });
  bannerB.anchor.set(0.5);
  banner.addChild(bannerBg, bannerBar, bannerA, bannerB);
  S.hud.addChild(banner);
  /** El alto del cartel de la pregunta, sin escala: el sello del celular va debajo de él. */
  let bannerAlto = 0;
  // El sello de la respuesta que decide, grande y en el medio del tablero.
  const bigStamp = new Container();
  const bigStampBg = new Graphics();
  const bigStampText = S.text("", { fontSize: 72, fontWeight: "900", fill: INK });
  bigStampText.anchor.set(0.5);
  bigStamp.addChild(bigStampBg, bigStampText);
  bigStamp.visible = false;
  S.hud.addChild(bigStamp);
  // El contador de cuántos siguen de pie es el marcador del kit: arriba a la izquierda, igual en todos los juegos.

  interface Card { root: Container; front: Container; back: Container; face: Sprite; label: Container; x: number; y: number; s: number }
  let cards: Card[] = [];
  /** Dónde estaba cada carta cuando empezó el último acomodo, para que viaje suave. */
  const from = new Map<number, { x: number; y: number; s: number }>();
  let lastLayout = "";
  /** Cuándo empezó el acomodo actual, y si es el reparto del principio de una ronda. */
  let layoutT0 = 0;
  let layoutDeal = true;
  let latidoAntes = -1;

  const build = (): void => {
    // Otra pantalla, otra caja del relator: se vuelve a medir, y las columnas se eligen de nuevo.
    techoRelator = Infinity;
    colsAcomodo = null;
    g = G();
    const k = g.k;
    // Un tablero liso con un marco de colores.
    bg.clear().rect(0, 0, g.w, g.h).fill(S.dark ? 0x1b2340 : 0xdfe9f7);
    board.clear();
    cardLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    cards = names.map((nm, i) => {
      const root = new Container();
      const front = new Container();
      const W = 120, H = 158;
      const fondo = new Graphics()
        .roundRect(4, 5, W, H, 10).fill({ color: INK, alpha: 0.5 })
        .roundRect(0, 0, W, H, 10).fill(S.dark ? CREAM : 0xffffff).stroke({ width: 3, color: INK })
        .rect(8, 8, W - 16, 78).fill(S.color(i));
      const face = new Sprite(S.face(nm));
      face.anchor.set(0.5);
      face.width = face.height = 66;
      face.position.set(W / 2, 47);
      // El nombre completo, en dos líneas: lo que se pregunta tiene que estar a la vista.
      // Un solo texto con las dos líneas, porque es un nombre y se lee entero:
      // en dos textos sueltos, con homónimos ("Carlos Choque" y "Carlos Choque 2")
      // el nombre de pila solo no decía de quién era la carta, y con 50 el auditor
      // de identificación no leía a nadie (22 de octubre de 2026).
      const partes = nm.trim().split(/\s+/);
      const lineas = partes.length > 1 ? [partes[0] as string, partes.slice(1).join(" ")] : [nm.trim()];
      const label = S.text(lineas.join("\n"), { fontSize: 19, fontWeight: "900", fill: INK, align: "center", lineHeight: 24 });
      label.anchor.set(0.5);
      if (label.width > W - 10) label.scale.set((W - 10) / label.width);
      label.position.set(W / 2, 124);
      front.addChild(fondo, face, label);
      // El dorso: liso, con un signo de pregunta. Es lo que se ve de los que se sentaron.
      const back = new Graphics()
        .roundRect(4, 5, W, H, 10).fill({ color: INK, alpha: 0.5 })
        .roundRect(0, 0, W, H, 10).fill(S.dark ? 0x3a2f5a : 0x7a5cc4).stroke({ width: 3, color: INK });
      const signo = S.text("?", { fontSize: 96, fontWeight: "900", fill: CREAM });
      signo.anchor.set(0.5);
      signo.position.set(W / 2, H / 2);
      signo.alpha = 0.85;
      const backC = new Container();
      backC.addChild(back, signo);
      backC.visible = false;
      root.addChild(front, backC);
      root.pivot.set(W / 2, H / 2);
      cardLayer.addChild(root);
      return { root, front, back: backC, face, label, x: g.w / 2, y: (g.top + g.bottom) / 2, s: 0 };
    });
    bigStampText.style.fontSize = 72 * k;
    lastLayout = "";
    from.clear();
    cam.cut(g.w / 2, g.h / 2, 1);
  };

  /* -------------------------------------------------------------------- dibujo */
  function aim(ahora: number): PlanoToma {
    tAll = ahora;
    crowned = kit.coronado;
    avanzar(ahora);
    const paso = stepAt(tAll);
    const ri = paso.round;
    const set = layoutSet(ri, tAll);
    let z = 1, x = g.w / 2, y = (g.top + g.bottom) / 2;
    // Con pocas cartas de pie la cámara se acerca a ellas: los finalistas.
    // Coronado, la carta que queda sola sigue en primer plano: el golpe de cámara se suma a este
    // encuadre, y `protegida` la deja debajo del cartel y encima del relator.
    if (set.length <= (story.arc === "tapada" ? 1 : FINALISTAS)) {
      const gr = grid(set.length);
      const ps = set.map((_, i) => gr.at(i));
      x = ps.reduce((a, p) => a + p.x, 0) / ps.length;
      y = ps.reduce((a, p) => a + p.y, 0) / ps.length;
      // Nunca más cerca de lo que entra.
      // La carta que queda sola es la toma del héroe, antes y después del cartel: más cerca y con poco aire,
      // para que el golpe de cámara parta de un primer plano de verdad.
      const solo = set.length === 1;
      const ancho = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)) + gr.cw * (solo ? 1.1 : 1.2);
      const alto = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y)) + gr.ch * (solo ? 1.1 : 1.2);
      z = Math.max(1, Math.min(solo ? 1.55 : set.length === 2 ? 1.25 : 1.12, (g.w * 0.92) / ancho, ((g.bottom - g.top) * (solo ? 1 : 0.95)) / alto));
    }
    // Mientras la sala revisa su nombre o está en el aplauso, la cámara respira
    // un poco: la pantalla no se queda quieta aunque las cartas no se muevan.
    const respira = !crowned && (paso.kind === "finalistas" || (paso.kind === "pregunta" && tAll < paso.answer));
    if (respira) z += 0.012 * (1 + Math.sin(tAll * 1.2));
    x = clamp(x, g.w / 2 / z, g.w - g.w / 2 / z);
    y = clamp(y, g.h / 2 / z, g.h - g.h / 2 / z);
    return { vista: { x, y, z }, ritmo: 2.2 };
  }

  /** Los textos del cartel de cada paso: la línea chica, la grande, y la cuenta de la revisión. */
  const cartel = (paso: Step, r: Round, ahora: number): { a: string; b: string; aPx: number; bPx: number; cuenta: number | null } => {
    if (paso.kind === "reparto") return { a: "", b: t("cQuiDealB"), aPx: 20, bPx: 40, cuenta: null };
    if (paso.kind === "finalistas") return { a: t("cQuiFinA"), b: t("cQuiFinB"), aPx: 20, bPx: 40, cuenta: null };
    if (paso.kind === "empate") return { a: "", b: t(r.empate === "tope" ? "cQuiTopeShort" : "cQuiTieShort"), aPx: 20, bPx: 36, cuenta: null };
    const q = r.questions[paso.qi] as Question;
    if (ahora < paso.answer) {
      const a = t(q.tipo === "orden" ? "cQuiAskAN" : "cQuiAskA");
      const b = q.tipo === "letra" ? L.cQuiAskL(q.valor)
        : q.tipo === "numero" ? L.cQuiAskD(q.valor)
          : q.tipo === "mitad" ? L.cQuiAskM()
            : q.tipo === "largo" ? L.cQuiAskG(Number(q.valor))
              : L.cQuiAskO(Number(q.valor));
      return { a, b, aPx: 20, bPx: 40, cuenta: clamp((ahora - paso.start) / Math.max(0.1, paso.answer - paso.start), 0, 1) };
    }
    return { a: t(q.has ? "cQuiSi" : "cQuiNoStamp"), b: L.cQuiSits(frase(q)), aPx: 44, bPx: 22, cuenta: null };
  };

  /**
   * Pone el cartel como lo pide el paso: los textos, el tamaño, y la cuenta de
   * la revisión. Se pinta en cada cuadro: así acompaña el tamaño de la
   * pantalla y la cuenta baja en vivo.
   */
  const pintarCartel = (c: { a: string; b: string; aPx: number; bPx: number; cuenta: number | null }): void => {
    const k = g.k;
    const maxW = g.w * 0.86 - 40 * k;
    bannerA.text = c.a;
    bannerB.text = c.b;
    bannerA.visible = c.a !== "";
    if (bannerA.style.fontSize !== c.aPx * k) bannerA.style.fontSize = c.aPx * k;
    if (bannerB.style.fontSize !== c.bPx * k) bannerB.style.fontSize = c.bPx * k;
    bannerA.scale.set(1);
    bannerB.scale.set(1);
    const fit = (tx: Text): number => (tx.width > maxW ? maxW / tx.width : 1);
    bannerA.scale.set(c.a ? fit(bannerA) : 1);
    bannerB.scale.set(fit(bannerB));
    const hA = c.a ? bannerA.height : 0, gap = c.a ? 4 * k : 0, hB = bannerB.height;
    const inner = Math.max(c.a ? bannerA.width : 0, bannerB.width);
    const padX = 30 * k, padY = 14 * k;
    const barra = c.cuenta !== null ? 16 * k : 0;
    const bw = inner + padX * 2, bh = padY * 2 + hA + gap + hB + barra;
    bannerAlto = bh;
    banner.position.set(g.w / 2, S.top() + (S.portrait() ? 100 : 50) * k);
    bannerBg.clear().roundRect(-bw / 2 + 5 * k, -bh / 2 + 5 * k, bw, bh, 8 * k).fill(INK)
      .roundRect(-bw / 2, -bh / 2, bw, bh, 8 * k).fill(YELLOW).stroke({ width: 3 * k, color: INK });
    bannerBar.clear();
    if (c.cuenta !== null) {
      // La barra de la revisión: se achica en vivo, a la vista desde el fondo de la sala.
      const y = bh / 2 - barra / 2;
      bannerBar.roundRect(-bw / 2 + padX, y - 4 * k, bw - padX * 2, 8 * k, 4 * k).fill({ color: INK, alpha: 0.18 });
      bannerBar.roundRect(-bw / 2 + padX, y - 4 * k, (bw - padX * 2) * (1 - c.cuenta), 8 * k, 4 * k).fill(INK);
    }
    bannerA.position.set(0, -bh / 2 + padY + hA / 2);
    bannerB.position.set(0, -bh / 2 + padY + hA + gap + hB / 2);
  };

  function draw(ahora: number): void {
    tAll = ahora;
    crowned = kit.coronado;
    avanzar(ahora);
    const k = g.k;
    const paso = stepAt(tAll);
    const ri = paso.round;
    const r = rounds[ri] as Round;
    const set = layoutSet(ri, tAll);
    const key = `${ri}:${set.length}`;
    // Cuando cambia el acomodo, cada carta sale desde donde estaba y viaja
    // desde ese momento.
    if (key !== lastLayout) {
      layoutDeal = !lastLayout.startsWith(`${ri}:`);
      lastLayout = key;
      layoutT0 = tAll;
      // El acomodo nuevo elige sus columnas contra el tablero de ahora.
      colsAcomodo = null;
      for (const [i, c] of cards.entries()) from.set(i, { x: c.x, y: c.y, s: c.s });
    }
    const gr = grid(set.length);
    const durLayout = layoutDeal ? (ri === 0 ? T_DEAL : 1) : REGROUP;
    const u = ease.inOutCubic(clamp((tAll - layoutT0) / durLayout, 0, 1));
    const gone = goneAt[ri] as Map<number, number>;
    const winnersBefore = new Set(prizes.slice(0, ri));
    // La pregunta en la que no se sienta nadie: los de pie saltan en vez de darse vuelta las cartas.
    const nadieSeSienta = paso.kind === "pregunta" && (r.questions[paso.qi] as Question | undefined)?.out.length === 0;
    fx.clear();

    cards.forEach((c, i) => {
      const enRonda = r.pool.includes(i);
      const pos = set.indexOf(i);
      // Al coronar queda a la vista la carta del último ganador.
      if ((crowned && !(ri === total - 1 && i === r.winner)) || (!enRonda && !winnersBefore.has(i))) {
        c.root.visible = false;
        return;
      }
      if (winnersBefore.has(i)) {
        // Los ganadores de rondas anteriores esperan arriba a la derecha, con
        // un marco amarillo: se sentaron con su premio.
        const slot = prizes.indexOf(i);
        const esperan = winnersBefore.size;
        const cel = S.portrait();
        const sep = Math.min((cel ? 54 : 70) * k, (g.w * (cel ? 0.45 : 0.25)) / Math.max(1, esperan - 1));
        // El zoom con el golpe de cámara incluido, el mismo que escala la escena.
        const z = cam.toScreen(1, 0, g.w, g.h).x - cam.toScreen(0, 0, g.w, g.h).x;
        const sx = g.w - (cel ? 34 : 46) * k - slot * sep, sy = S.top() + (cel ? 38 : 72) * k;
        c.root.visible = true;
        c.x = cam.x + (sx - g.w / 2) / z;
        c.y = cam.y + (sy - g.h / 2) / z;
        c.s = ((cel ? 0.4 : 0.5) * k) / z;
        c.back.visible = false;
        c.front.visible = true;
        c.root.position.set(c.x, c.y);
        c.root.scale.set(c.s, c.s);
        c.root.rotation = 0;
        c.root.alpha = 1;
        fx.roundRect(c.x - 60 * c.s - (4 * k) / z, c.y - 79 * c.s - (4 * k) / z, 120 * c.s + (8 * k) / z, 158 * c.s + (8 * k) / z, (8 * k) / z).stroke({ width: (4 * k) / z, color: YELLOW });
        return;
      }
      const volteoEn = gone.get(i);
      const flipping = volteoEn !== undefined && tAll >= volteoEn;
      if (pos >= 0 || flipping) {
        c.root.visible = true;
        let tx = c.x, ts = c.s;
        if (pos >= 0) {
          const p = gr.at(pos);
          const f = from.get(i) ?? { x: g.w / 2, y: (g.top + g.bottom) / 2, s: 0 };
          // En el reparto cada carta llega un poco después que la anterior.
          const dealU = layoutDeal ? ease.outCubic(clamp(((tAll - layoutT0) / durLayout) * 1.6 - (pos / Math.max(1, set.length)) * 0.6, 0, 1)) : u;
          tx = f.x + (p.x - f.x) * dealU;
          const ty = f.y + (p.y - f.y) * dealU;
          ts = f.s + (gr.cw / 120 - f.s) * dealU;
          c.x = tx;
          c.y = ty;
          c.s = ts;
        }
        // El susto: en la última pregunta la carta de quien gana se medio
        // sienta, duda y vuelve.
        const ult = pasosPregunta[ri]?.at(-1);
        if (story.arc === "susto" && ri === total - 1 && i === r.winner && ult && tAll >= ult.flip && tAll < ult.flip + 0.9) {
          const f = (tAll - ult.flip) / 0.9;
          // "¡Uy, casi se sienta!" lo dice el guion, a mitad del amague (`planQuien`).
          c.root.position.set(c.x, c.y);
          c.root.scale.set(c.s * (1 - 0.8 * Math.sin(Math.PI * f)), c.s);
          c.root.alpha = 1;
          return;
        }
        // Darse vuelta: se achica de canto, aparece el dorso, se apaga.
        let sx = c.s, alpha = 1;
        c.front.visible = true;
        c.back.visible = false;
        if (flipping) {
          const f = clamp((tAll - (volteoEn as number)) / FLIP, 0, 1);
          sx = c.s * Math.abs(Math.cos(f * Math.PI));
          if (f > 0.5) {
            c.front.visible = false;
            c.back.visible = true;
          }
          alpha = f < 0.85 ? 1 : clamp((1 - f) / 0.15, 0, 1);
          if (pos < 0 && f >= 1) {
            c.root.visible = false;
            return;
          }
        }
        // Los que siguen de pie se mecen, cada uno a su ritmo: están parados, y
        // la sala no se queda quieta mientras se revisa el nombre.
        // La amplitud sigue al tamaño de la carta: con dos cartas grandes, un meneo chico no se ve.
        const vaiven = pos >= 0 && !layoutDeal ? Math.sin(tAll * 2.2 + i * 1.7) * Math.max(3, 0.06 * c.s * 158) * k : 0;
        // Nadie se sienta: cada uno salta un poco después del anterior.
        const fs = nadieSeSienta && pos >= 0 ? (tAll - paso.flip - pos * 0.08) / SALTO : -1;
        const salto = fs > 0 && fs < 1 ? Math.sin(Math.PI * fs) * SALTO_ALTO * c.s * 158 : 0;
        c.root.position.set(c.x, c.y + vaiven - salto);
        c.root.rotation = pos >= 0 && !layoutDeal ? Math.sin(tAll * 1.6 + i) * 0.025 : 0;
        c.root.scale.set(sx, c.s);
        c.root.alpha = alpha;
        // La carta de quien gana, cuando queda sola, brilla y late.
        if (set.length === 1 && i === r.winner) {
          const pulse = 0.3 + 0.2 * Math.sin(tAll * 7);
          // Cada latido de la carta sola suena, hasta que se corona.
          const latido = Math.floor(tAll * 7 / (2 * Math.PI));
          if (!crowned && latido !== latidoAntes) {
            latidoAntes = latido;
            // En triángulo y con una nota arriba: un seno de 131 Hz no lo
            // reproduce el parlante de un proyector.
            kit.sonido.latido();
          }
          fx.roundRect(c.x - 62 * c.s - 8 * k, c.y - 79 * c.s - 8 * k, 124 * c.s + 16 * k, 158 * c.s + 16 * k, 14 * k).stroke({ width: 5 * k, color: YELLOW, alpha: 0.6 + pulse });
        }
        // Los finalistas, en el aplauso, se mecen más: la pantalla no se queda quieta.
        if (paso.kind === "finalistas" && pos >= 0) {
          const latidoF = 1 + 0.05 * Math.sin(tAll * 6 + i);
          c.root.scale.set(sx * latidoF, c.s * latidoF);
        }
      } else {
        c.root.visible = false;
      }
    });

    // El cartel: la pregunta, la respuesta que sienta, o el aviso de los finalistas.
    banner.visible = !crowned;
    if (!crowned) {
      pintarCartel(cartel(paso, r, tAll));
      // Cada tic de la revisión late un poco: el cartel se mueve cada segundo, como un reloj.
      const enRevision = paso.kind === "pregunta" && tAll < paso.answer;
      const desdeTic = enRevision ? (tAll - paso.start) % TIC : 1;
      const latido = 1 + 0.03 * Math.max(0, 1 - desdeTic / 0.3);
      banner.scale.set(ease.outBack(clamp((tAll - paso.start) / 0.3, 0, 1)) * latido);
    }

    // La respuesta que decide: el sello grande en el medio del tablero, un segundo.
    const decisivo = paso.kind === "pregunta" && paso.round === total - 1 && paso.qi === r.questions.length - 1 && r.questions.length > 0;
    const sello = decisivo ? tAll - paso.answer : -1;
    if (!crowned && sello >= 0 && sello < 1.2) {
      const q = r.questions[paso.qi] as Question;
      bigStamp.visible = true;
      bigStampText.text = t(q.has ? "cQuiSi" : "cQuiNoStamp");
      const bw2 = bigStampText.width + 44 * k, bh2 = bigStampText.height + 18 * k;
      bigStampBg.clear().roundRect(-bw2 / 2 + 6 * k, -bh2 / 2 + 6 * k, bw2, bh2, 10 * k).fill(INK)
        .roundRect(-bw2 / 2, -bh2 / 2, bw2, bh2, 10 * k).fill(q.has ? 0x17c3b2 : 0xff5cb3).stroke({ width: 5 * k, color: INK });
      // En el medio del tablero, salvo en vertical: ahí las dos últimas cartas
      // quedan lado a lado justo en el medio y el sello les tapaba los nombres
      // (evaluador, 22 de octubre de 2026). Va en la franja libre entre la
      // pregunta y las cartas, achicado si no entra, y golpea con menos rebote.
      let sy = (g.top + g.bottom) / 2, base = 1;
      const cel = S.portrait();
      if (cel) {
        const arriba = banner.position.y + (bannerAlto / 2) * banner.scale.y;
        let cartas = Infinity;
        for (const i of set) {
          const c = cards[i];
          // El borde de arriba de la carta, con el meneo incluido.
          if (c) cartas = Math.min(cartas, cam.toScreen(c.x, c.y - 79 * c.s - Math.max(3, 0.06 * c.s * 158) * k, g.w, g.h).y);
        }
        if (Number.isFinite(cartas) && cartas > arriba) {
          // Girado, el sello ocupa más alto que su caja.
          const alto = bh2 * Math.cos(0.12) + bw2 * Math.sin(0.12);
          base = clamp((cartas - arriba - 8 * k) / alto, 0.45, 1);
          sy = (arriba + cartas) / 2;
        }
      }
      bigStamp.position.set(g.w / 2, sy);
      bigStamp.rotation = -0.12;
      bigStamp.scale.set(base * (1 + (cel ? 0.35 : 1.4) * (1 - ease.outBack(clamp(sello / 0.25, 0, 1)))));
    } else {
      bigStamp.visible = false;
    }
  }

  /** El cuadro anterior, para saber cuánto pasó entre uno y otro. */
  let tPrevio = 0;
  /**
   * El tablero, contra la caja del relator de verdad (ver `relator`): una vez
   * por cuadro, con el tiempo que pasó desde el anterior.
   */
  function avanzar(ahora: number): void {
    if (ahora === tPrevio) return;
    const dt = Math.max(0, ahora - tPrevio);
    tPrevio = ahora;
    // Coronado, el tablero deja de seguir al relator: la carta de quien gana queda como estaba
    // (no se achica cuando aparece el anuncio) y el golpe de cámara se suma a ese encuadre.
    if (crowned) return;
    if (relator?.textContent) techoRelator = Math.min(techoRelator, relator.offsetTop - 4);
    g.bottom += (fondoDe(g.h, g.k) - g.bottom) * Math.min(1, dt * 8);
  }

  /** La carta de quien gana el último premio. */
  const cartaDeQuienGana = (): Card | undefined => cards[(rounds[total - 1] as Round).winner];

  /** Dónde está quien gana en la pantalla, para el foco: el centro de su carta y lo que ocupa. */
  function foco(): FocoPunto {
    const c = cartaDeQuienGana();
    if (!c) return { x: g.w / 2, y: (g.top + g.bottom) / 2, r: 60 * g.k };
    const p = cam.toScreen(c.x, c.y, g.w, g.h);
    const z = Math.max(0.3, cam.toScreen(1, 0, g.w, g.h).x - cam.toScreen(0, 0, g.w, g.h).x);
    return { x: p.x, y: p.y, r: 79 * c.s * z, color: colorDeNombre(names[(rounds[total - 1] as Round).winner] ?? "") };
  }

  /** Lo que ningún zoom puede cortar con quien gana a la vista: su carta, debajo del cartel y encima del relator. */
  function protegida(): { caja: Caja; zona: Zona } | null {
    const c = cartaDeQuienGana();
    if (!c) return null;
    return {
      // Lo de abajo de la carta (el nombre y casi toda la cara): el borde de arriba puede quedar un poco debajo del cartel.
      caja: { x: c.x - 60 * c.s, y: c.y - 79 * c.s + 0.2 * 158 * c.s, w: 120 * c.s, h: 0.8 * 158 * c.s },
      zona: { x0: 8 * g.k, y0: S.placaBajo(winners.length) + 4 * g.k, x1: g.w - 8 * g.k, y1: g.h - S.bottom() - 6 * g.k },
    };
  }

  build();
  return { rebuild: build, aim, draw, foco, protegida };
}

/** Lo que la escena le da al kit y a las tomas. */
export type Escena = ReturnType<typeof crearEscena>;

/**
 * De pie, sobre el kit. Todo lo que no es esta escena (el montaje, la cámara con
 * sus cinco arcos, el golpe, el foco de quien gana, los subtítulos con cola, el
 * sonido y el cierre) lo hace `crearJuego`.
 */
export const quienPixi = crearJuego<Datos, Escena>({
  id: "quien",
  plan: planQuien,
  arma(k, plan, previa) {
    if (!previa) return crearEscena(k, plan.datos);
    previa.rebuild();
    return previa;
  },
  cuadro(_k, _plan, escena, t) {
    escena.draw(t);
  },
});
