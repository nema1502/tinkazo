import { LEGIBLE } from "./letra";
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { T, getLang, nameList, t } from "../../i18n";
import { paceFactor, setGameLength, type Beacon } from "../../state";
import { beep as sonido, beepFor as sonidoPor, fanfare, note } from "../../sound";
import { writeStory } from "../drama";
import { WINNER_HOLD, clamp, ease, winnersLabel } from "../overlay";
import { CREAM, INK, MONO, hash, mountPixi, type PixiStage } from "./stage";
import { dentro, unir, type Caja, type Zona } from "./encuadre";
import { planTrueque, type Encargo } from "./trueque-plan";

/**
 * Los efectos de la feria suben unos 6 dB más que los de otros juegos. Con la
 * música andina de fondo, la feria quedaba debajo del bajo: en un parlante de
 * proyector (corta en 150 Hz) perdía 3,6 LU, y el límite del auditor de mezcla
 * es 3,5 (sapo, con efectos más fuertes, pierde 2,9). Con este empuje, 3,0 a 3,2.
 */
const EMPUJE = 2.0;
const beep = (f: number, d: number, type: OscillatorType, g: number): void => sonido(f, d, type, g * EMPUJE);
const beepFor = (f: number, segundos: number, type: OscillatorType, g: number): void => sonidoPor(f, segundos, type, g * EMPUJE);

/**
 * El Trueque, en PixiJS, con el director de cámara.
 *
 * Una feria de puestos: cada persona tiene el suyo, con un toldo de color por
 * lo que acepta y un cuadrito por lo que da. Un encargo (un atado de aguayo, un
 * q'epi) sale de un origen con un producto y va de puesto en puesto. En cada
 * pase se prenden los que aceptan lo que lleva; el encargo se acerca a uno, y
 * si ese puesto lo cambia, el atado cambia de contenido ("¡Ahora es maíz!").
 * Si no hay camino desde ahí, es un callejón sin salida y el encargo vuelve.
 * Al final quedan dos puestos que aceptan lo que lleva, y el atado llega a
 * quien espera. Después se prende la ruta de cambios, con el nombre de cada uno
 * que la hizo posible.
 *
 * Quién cambia, qué producto entra y sale, y qué callejones aparecen lo decide
 * el plan (`trueque-plan.ts`), sembrado con la ronda: el juego solo lo cuenta.
 * Los encargos de varios premios salen juntos y cada uno llega a su dueño.
 *
 * Todo sale de la hora del juego, sin física acumulada: la misma ronda dibuja
 * los mismos cuadros. Cómo se ve, la fuente de cada cosa y los números están en
 * docs/juegos/trueque.md.
 */

/** Los productos, por número. Los colores son de este juego: el aguayo no tiene una paleta propia. */
const COLOR = [0xa0623a, 0x7e8fa3, 0xd6457b, 0xe9a23b, 0xf3efe4, 0xc9b07a, 0x6fb13f, 0x4f3426] as const;
const CLAVE = ["prPapa", "prChuno", "prQuinua", "prMaiz", "prArroz", "prYuca", "prPlatano", "prCafe"] as const;

/** Cuándo aparece cada puesto: los de la feria nacen de a uno, en orden. */
const T_BORN = 0.2;
const BORN_SPAN = 1.2;
/** Pasar lista: cuando ya están todos, y hasta que se abre el primer pase. */
const T_ROLL0 = 1.5;
const T_ROLL1 = 4.6;
const T_FERIA = 5.0;
/** Cuándo aparecen los encargos en su origen: antes del primer pase, así la feria no queda quieta mientras se pasa lista. */
const T_APPEAR = 3.0;
/** Un pase: "¿Quién acepta…?", después los intentos, y una pausa. Todo en segundos del juego. */
const BUSCA = 1.2;
const BUSCA_DUELO = 0.8;
const SLOT = 1.6;
const PAUSA = 0.5;
/** Dentro de un intento: el encargo llega al puesto, el puesto responde, y vuelve si no cambió. */
const T_TOCA = 0.6;
const T_RECHAZA = 1.0;
const T_VUELVE = 1.4;
/** La ruta se dibuja en segundos reales, dentro de la espera del cartel. */
const RUTA_DIBUJA = 2.4;
/** Lo que mide de alto el nombre de un puesto, con su sombra, en unidades de `S.u()` (el chip a su escala). */
const NOMBRE_ALTO = 44;

type Fase = "show" | "nova" | "dead";

/** Un intento de un encargo: el puesto al que llega, y si cambia el encargo (o llega). */
interface Mov {
  e: number;
  p: number;
  t0: number;
  quien: number;
  ok: boolean;
  /** El último intento del último pase: la entrega. */
  entrega: boolean;
}

export async function truequePixi(names: string[], winners: readonly number[], beacon: Beacon, done: () => void): Promise<void> {
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const n = names.length;
  if (n === 0) {
    S.cleanup();
    return;
  }
  const winnerIdx = clamp(winners[0] ?? 0, 0, n - 1);
  const story = writeStory(rng, Math.max(2, n), winnerIdx % Math.max(2, n));
  S.mark("arco", story.arc);
  const plan = planTrueque(n, winners, rng);
  const encargos: Encargo[] = plan.encargos;
  const P = plan.pases;
  const duelo = story.arc === "duelo";
  const prim = encargos[0];
  const nombre = (p: number): string => t(CLAVE[p % CLAVE.length] ?? "prPapa");
  const persona = (i: number): string => names[i] ?? "";
  const esGanador = new Set(encargos.map((en) => en.destino));

  /* --------------------------------------------------------------- horario */
  // Cuántos intentos tiene cada pase (el mayor de los encargos), y cuánto dura.
  const J: number[] = [];
  const BL: number[] = [];
  for (let p = 0; p < P; p++) {
    J.push(Math.max(1, ...encargos.map((en) => en.pases[p]?.intentos.length ?? 0)));
    BL.push(BUSCA + (p === P - 1 && duelo ? BUSCA_DUELO : 0));
  }
  const B: number[] = [];
  let tc = T_FERIA;
  for (let p = 0; p < P; p++) {
    B.push(tc);
    tc += (BL[p] ?? BUSCA) + (J[p] ?? 1) * SLOT + PAUSA;
  }
  /** Cuándo termina el último pase: a partir de acá se muestra la ruta. */
  const T_NOVA = tc;
  /** La entrega: cuando el encargo llega a quien espera, y se abre el cartel. */
  const T_ENTREGA = (B[P - 1] ?? T_FERIA) + (BL[P - 1] ?? BUSCA) + ((J[P - 1] ?? 1) - 1) * SLOT + T_TOCA;
  setGameLength(T_NOVA, WINNER_HOLD);

  // Cada intento, con su hora: los intentos se alinean a la derecha de cada pase,
  // así la entrega cae en el mismo instante para todos los encargos.
  const movs: Mov[][] = encargos.map((en, e) => {
    const out: Mov[] = [];
    for (let p = 0; p < P; p++) {
      const pase = en.pases[p];
      if (!pase) continue;
      const L = pase.intentos.length;
      pase.intentos.forEach((it, i) => {
        const slot = (J[p] ?? 1) - L + i;
        out.push({
          e, p, t0: (B[p] ?? 0) + (BL[p] ?? BUSCA) + slot * SLOT, quien: it.quien, ok: it.ok,
          entrega: p === P - 1 && it.ok && it.quien === en.destino,
        });
      });
    }
    return out;
  });
  const todos = movs.flat().sort((a, b) => a.t0 - b.t0);
  /** Cuándo cambia cada puesto (el encargo llega y lo cambia). Infinity si nunca. */
  const cambioAt: number[] = Array.from({ length: n }, () => Infinity);
  for (const m of todos) if (m.ok && !m.entrega) cambioAt[m.quien] = Math.min(cambioAt[m.quien] ?? Infinity, m.t0 + T_TOCA);
  /** En qué pase cada persona se prende (pase 0 = el primero). */
  const luz: Set<number>[] = plan.prendidos.map((l) => new Set(l));
  const bornAt = Array.from({ length: n }, (_, i) => T_BORN + (n > 1 ? (i / (n - 1)) * BORN_SPAN : 0));

  /** El pase en que está la feria en `tt`, o -1 antes y después. */
  const paseEn = (tt: number): number => {
    for (let p = 0; p < P; p++) {
      const ini = B[p] ?? 0;
      const fin = ini + (BL[p] ?? BUSCA) + (J[p] ?? 1) * SLOT + PAUSA;
      if (tt >= ini && tt < fin) return p;
    }
    return -1;
  };

  /* ---------------------------------------------------------------- lugar */
  let fase: Fase = "show";
  let tAll = 0;
  let tHold = 0;
  let pos: { x: number; y: number }[] = [];
  let origen: { x: number; y: number }[] = [];
  let radio = 10;
  let feriaY0 = 0;
  let feriaY1 = 0;
  /** Dónde termina la leyenda y dónde va la franja de aguayo, en la pantalla. */
  let leyendaAbajo = 0;
  let franjaY = 0;

  /* ------------------------------------------------------------ escenario */
  let bgG!: Graphics;
  let adornosG!: Graphics;
  let stallsG!: Graphics;
  let routeG!: Graphics;
  let bundlesG!: Graphics;
  let contador!: Text;
  let leyenda!: Container;
  const etiquetas: Container[] = [];
  const etiquetaTexto: string[] = [];
  /** Lo que mide la etiqueta de cada encargo en el último cuadro (ancho y alto, en la escena). */
  const etqMide: { w: number; h: number }[] = [];
  let tinta = INK;

  /** Lo que se ve de los puestos y del encargo en `tt`: el producto que lleva cada uno. */
  const productoEn = (en: Encargo, e: number, tt: number): number => {
    let cambios = 0;
    for (const m of movs[e] ?? []) if (m.ok && !m.entrega && m.t0 + T_TOCA <= tt) cambios++;
    return en.productos[Math.min(cambios, en.productos.length - 1)] ?? en.origen;
  };

  /** Dónde está el encargo `e` en `tt`: en su origen, en un puesto, o viajando hacia uno. */
  const encargoEn = (e: number, tt: number): { x: number; y: number } => {
    const o = origen[e] ?? { x: 0, y: 0 };
    let holder = -1;
    for (const m of movs[e] ?? []) {
      const desde = holder < 0 ? o : (pos[holder] ?? o);
      const hasta = pos[m.quien] ?? o;
      if (tt < m.t0) break;
      if (tt < m.t0 + T_TOCA) {
        const q = ease.inOutCubic((tt - m.t0) / T_TOCA);
        const alto = Math.hypot(hasta.x - desde.x, hasta.y - desde.y) * 0.22;
        return { x: desde.x + (hasta.x - desde.x) * q, y: desde.y + (hasta.y - desde.y) * q - Math.sin(q * Math.PI) * alto };
      }
      if (!m.ok) {
        if (tt < m.t0 + T_RECHAZA) return hasta;
        if (tt < m.t0 + T_VUELVE) {
          const q = ease.inOutCubic((tt - m.t0 - T_RECHAZA) / (T_VUELVE - T_RECHAZA));
          return { x: hasta.x + (desde.x - hasta.x) * q, y: hasta.y + (desde.y - hasta.y) * q };
        }
        continue;
      }
      holder = m.quien;
    }
    return holder < 0 ? o : (pos[holder] ?? o);
  };

  /* --------------------------------------------------------------- build */
  function build(): void {
    const k = S.u();
    const w = S.sw();
    const h = S.sh();
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));
    etiquetas.length = 0;
    etiquetaTexto.length = 0;
    tinta = S.dark ? CREAM : INK;

    // El cielo, la cordillera y el suelo de la feria.
    const cv = document.createElement("canvas");
    cv.width = 2;
    cv.height = 256;
    const cx = cv.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, S.dark ? "#1b1230" : "#f7e6c4");
    g.addColorStop(1, S.dark ? "#3a2440" : "#f1d29f");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 2, 256);
    const sky = new Sprite(Texture.from(cv));
    sky.width = w;
    sky.height = h;
    S.bg.addChild(sky);
    bgG = new Graphics();
    const montaña = S.dark ? 0x2a1d3f : 0xd9b98a;
    const suelo = S.dark ? 0x4b3424 : 0xe6c896;
    const piso = h * 0.78;
    const picos: { x: number; y: number }[] = [{ x: 0, y: piso }];
    for (let x = 0; x <= w + 40 * k; x += 40 * k) {
      const alto = h * (0.56 + 0.1 * Math.sin(x * 0.013) + 0.05 * Math.sin(x * 0.041 + 1.3));
      picos.push({ x, y: alto });
    }
    picos.push({ x: w, y: piso });
    bgG.poly(picos.flatMap((p) => [p.x, p.y])).fill(montaña);
    bgG.rect(0, piso, w, h - piso).fill(suelo);
    S.bg.addChild(bgG);
    // Los banderines, con los colores de los productos, se mecen en cada cuadro: la feria no queda quieta.
    adornosG = new Graphics();
    S.bg.addChild(adornosG);

    // Arriba, el contador y la leyenda de los colores, con letra que se lee
    // desde el fondo de la sala: 14 px o más en 720. Iban en 11 y 12 px, y la
    // sala solo seguía los subtítulos (evaluación de la subida 2, hallazgo 6).
    const margen = 10 * k;
    const fsLey = S.letra(LEGIBLE.sec);
    const fsCont = S.letra(LEGIBLE.sec);
    contador = S.text("", { fontFamily: MONO, fontSize: fsCont, fontWeight: "700", fill: tinta });
    contador.position.set(margen, S.top() + 8 * k);
    leyenda = new Container();
    const txtLey = S.text(t("trLeyenda"), { fontFamily: MONO, fontSize: fsLey, fontWeight: "700", fill: tinta, wordWrap: true, wordWrapWidth: w - 2 * margen });
    txtLey.position.set(margen, S.top() + 8 * k + fsCont * 1.35);
    // La frase de la leyenda se fue: los colores con su producto se entienden solos (barrido de letra).
    txtLey.visible = false;
    leyenda.addChild(txtLey);
    const cuadro = Math.round(fsLey * 0.85);
    const renglon = fsLey * 1.45;
    let lx = margen;
    let ly = txtLey.y;
    for (let p = 0; p < COLOR.length; p++) {
      const sq = new Graphics().rect(0, 0, cuadro, cuadro).fill(COLOR[p] ?? 0).stroke({ width: Math.max(1, k), color: INK });
      const tx = S.text(nombre(p), { fontFamily: MONO, fontSize: fsLey, fontWeight: "700", fill: tinta });
      const ancho = cuadro + 6 * k + tx.width + 16 * k;
      if (lx > margen && lx + ancho - 16 * k > w - margen) {
        lx = margen;
        ly += renglon;
      }
      sq.position.set(lx, ly + (tx.height - cuadro) / 2);
      tx.position.set(lx + cuadro + 6 * k, ly);
      leyenda.addChild(sq, tx);
      lx += ancho;
    }
    leyendaAbajo = ly + renglon;
    // La franja, donde estaba (de 170 a 192 en 720, sobre la fila que muestrea
    // el auditor exigente: docs/juegos/trueque.md), o debajo de la leyenda si la
    // leyenda llega más abajo, como en un celular.
    franjaY = Math.max(S.top() + 88 * k, leyendaAbajo + 4 * k);

    // La feria: cuadrícula de puestos, como una tabla sin orden. Debajo de la
    // leyenda y de la franja de aguayo, con lugar para el nombre que va encima
    // de cada puesto de la primera fila sin pisar la leyenda.
    feriaY0 = Math.max(franjaY + 30 * k, leyendaAbajo + (NOMBRE_ALTO + 12) * k);
    feriaY1 = h - S.bottom() - 16 * k;
    const x1 = w * 0.93;
    const armar = (x0: number): { x0: number; cols: number; cw: number; ch: number; r: number } => {
      const cols = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / Math.max(1, feriaY1 - feriaY0))));
      const cw = (x1 - x0) / cols;
      const ch = (feriaY1 - feriaY0) / Math.ceil(n / cols);
      // Con pocos puestos los toldos pueden ser grandes; con doscientos, el tope los deja en la cuadrícula.
      // Con 30 de tope medían unos 60 px en 720, y lo que acepta y da cada uno no se leía desde la sala.
      return { x0, cols, cw, ch, r: clamp(Math.min(cw, ch) * 0.34, 4.5 * k, 37 * k) };
    };
    let red = armar(w * 0.07);
    // El atado espera en su origen, a la izquierda de la feria, con la etiqueta
    // del producto encima: entero, y sin pisar el primer puesto. En un celular
    // quedaba a doce píxeles del borde y se cortaba la mitad, con la etiqueta
    // (revisión del Trueque, 21 de octubre de 2026): si no entra, la feria se
    // corre a la derecha lo justo.
    const fsEtq = S.letra(LEGIBLE.sec);
    const medida = S.text("", { fontFamily: MONO, fontSize: fsEtq, fontWeight: "800" });
    let etiq = 0;
    for (let p = 0; p < CLAVE.length; p++) {
      medida.text = nombre(p).toUpperCase();
      etiq = Math.max(etiq, medida.width + 14 * k);
    }
    medida.destroy();
    const lado = (r: number): number => Math.max(r * 2.1, etiq) / 2;
    const borde = (q: typeof red): number => q.x0 + q.cw * 0.42 - q.r;
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const falta = lado(red.r) * 2 + 12 * k - borde(red);
      if (falta <= 0.5) break;
      red = armar(red.x0 + falta);
    }
    const { x0, cols, cw, ch } = red;
    radio = red.r;
    pos = Array.from({ length: n }, (_, i) => ({
      x: x0 + cw * ((i % cols) + 0.5) + (hash(i, 11) - 0.5) * cw * 0.16,
      y: feriaY0 + ch * (Math.floor(i / cols) + 0.5) + (hash(i, 12) - 0.5) * ch * 0.16,
    }));
    const oX = Math.max(w * 0.07 * 0.45, lado(radio) + 6 * k);
    origen = encargos.map((_, e) => ({
      x: oX,
      y: feriaY0 + ((e + 0.5) / Math.max(1, encargos.length)) * (feriaY1 - feriaY0),
    }));

    stallsG = new Graphics();
    routeG = new Graphics();
    bundlesG = new Graphics();
    S.scene.addChild(stallsG, routeG, bundlesG);
    for (let e = 0; e < encargos.length; e++) {
      const c = new Container();
      const bg = new Graphics();
      const txt = S.text("", { fontFamily: MONO, fontSize: fsEtq, fontWeight: "800", fill: INK });
      txt.anchor.set(0.5, 0.5);
      c.addChild(bg, txt);
      c.visible = false;
      S.scene.addChild(c);
      etiquetas.push(c);
      etiquetaTexto.push("");
    }

    // Lo que dice cada toldo, arriba de la feria: la leyenda de los colores (se arma arriba, antes de la feria).
    S.hud.addChild(leyenda);
    S.hud.addChild(contador);
  }

  build();
  const crown = S.crown(names, winners);
  /** El golpe de la cámara cae una sola vez, cuando entra la entrega y sale el cartel. */
  let golpeDado = false;
  S.onResize(build);
  cam.noBlur();
  cam.cut(S.sw() / 2, S.sh() / 2, 1);

  /* -------------------------------------------------------------- eventos */
  interface Ev { at: number; run: () => void; critico?: boolean }
  const evs: Ev[] = [];
  const decir = (at: number, msg: string, heat: number, critico = false): void => {
    evs.push({ at, run: () => S.say(msg, heat), critico });
  };
  const sonar = (at: number, run: () => void, critico = false): void => {
    evs.push({ at, run, critico });
  };
  decir(0.05, t("trFeria"), 0.1);
  sonar(0.05, () => beep(note(8), 0.12, "triangle", 0.04));
  // Los puestos nacen de a uno: un tic por cada tanto de ellos, para que la feria se arme a la vista.
  for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 14))) {
    sonar(bornAt[i] ?? 0, () => beep(note(4 + (i % 8)), 0.07, "sine", 0.025));
  }
  decir(1.6, t("trAcepta"), 0.15);
  sonar(1.6, () => beep(note(5), 0.1, "triangle", 0.035));
  // Un fondo sostenido, suave, en la banda de arriba del corte de los parlantes chicos: la feria tiene cuerpo
  // durante toda la escena, no solo en los golpes (lo mide el auditor de mezcla).
  // Notas encadenadas, no un tono largo: si se salta, las que no llegaron a sonar no suenan.
  for (let s = T_FERIA - 0.5, j = 0; s < T_NOVA; s += 1.6, j++) {
    const grado = j % 2 ? 5 : 3;
    sonar(s, () => beepFor(note(grado), 1.8, "sine", 0.02));
  }
  // Los atados aparecen en su origen con un sonido, y antes del primer pase un tic que marca la espera.
  sonar(T_APPEAR, () => beep(note(2), 0.12, "sine", 0.03));
  sonar(T_APPEAR + 0.2, () => beep(note(7), 0.12, "triangle", 0.035));
  sonar(4.1, () => beep(note(4), 0.07, "sine", 0.025));
  if (prim) decir(3.2, T[getLang()].trSale(nombre(prim.origen)), 0.2);
  // Cada pase: "¿Quién acepta…?" del encargo principal, un tic a mitad de la búsqueda, y cada intento.
  for (let p = 0; p < P; p++) {
    const q = prim?.pases[p]?.producto ?? prim?.origen ?? 0;
    decir(B[p] ?? 0, T[getLang()].trBusca(nombre(q)), 0.3 + (0.5 * p) / Math.max(1, P), false);
    sonar(B[p] ?? 0, () => beep(note(6), 0.12, "triangle", 0.04));
    // El cuerpo de la búsqueda, un poco más grave, para que se oiga en un parlante chico (lo mide el auditor de mezcla).
    sonar(B[p] ?? 0, () => beep(note(2), 0.2, "triangle", 0.04));
    sonar((B[p] ?? 0) + BUSCA / 2, () => beep(note(9), 0.07, "sine", 0.03));
  }
  // En la entrega del encargo principal pueden probarse uno o dos puestos antes
  // de quien espera: "no, es para el otro" se dice cuando ya queda uno solo.
  const metaPrim = prim ? (plan.puestos[prim.destino]?.acepta ?? -1) : -1;
  let quedanEnLaEntrega = [...(luz[P - 1] ?? [])].filter((i) => plan.puestos[i]?.acepta === metaPrim).length;
  for (const m of todos) {
    const en = encargos[m.e];
    if (!en) continue;
    const principal = m.e === 0;
    // El viaje del encargo principal se oye: un barrido corto hacia el puesto.
    if (principal) sonar(m.t0, () => beepFor(note(3 + (m.p % 4)), 0.45, "sine", 0.028));
    if (!m.ok) {
      sonar(m.t0 + T_TOCA, () => {
        beep(note(4), 0.12, "triangle", 0.045);
        beep(note(1), 0.22, "sine", 0.035);
      });
      if (principal) {
        // Al último puesto que se prueba lo nombra: "no, es para el otro". Los demás, un callejón.
        const variantes = T[getLang()].trCallejon;
        const enLaEntrega = m.p === P - 1;
        if (enLaEntrega) quedanEnLaEntrega--;
        const frase = enLaEntrega
          ? quedanEnLaEntrega <= 1 ? T[getLang()].trNoEs : (variantes[1] ?? "")
          : (variantes[(m.p + m.e) % variantes.length] ?? "");
        decir(m.t0 + T_TOCA + 0.05, frase, 0.55);
      }
      continue;
    }
    if (m.entrega) {
      // La entrega: el cartel del ganador, con su sonido y el papel picado.
      evs.push({
        at: m.t0 + T_TOCA,
        critico: true,
        run: () => {
          crown.at(0);
          S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
          fanfare();
          beep(note(0), 0.8, "sine", 0.08);
          beep(note(3), 0.7, "triangle", 0.05);
        },
      });
      continue;
    }
    sonar(m.t0 + T_TOCA, () => {
      beep(note(10), 0.14, "triangle", 0.05);
      beep(note(12), 0.14, "triangle", 0.045);
    });
    if (principal) {
      const despues = productoEn(en, 0, m.t0 + T_TOCA + 0.001);
      decir(m.t0 + T_TOCA + 0.05, T[getLang()].trCambio(nombre(despues)), 0.45);
    }
  }
  // La ruta, después de la entrega: la cadena de productos y quién la hizo posible.
  if (prim) {
    const cadena = prim.productos.map((p) => nombre(p)).join(" → ");
    const quienes = prim.cambios.map((i) => persona(i));
    const llego = persona(prim.destino);
    const tEntrega = T_ENTREGA;
    decir(tEntrega + 1.0, cadena, 0.9, true);
    decir(tEntrega + 2.4, quienes.length ? T[getLang()].trRuta(nameList(quienes), llego) : T[getLang()].trDirecto(llego), 0.9, true);
  }
  evs.sort((a, b) => a.at - b.at);
  let proximo = 0;

  /**
   * A quiénes se les pone el nombre en `tt`: el pasar lista de la feria, los que
   * se prueban en el pase, y, al final, quienes hicieron la ruta y quien espera.
   * `S.tags` los acomoda sin que se pisen, igual que en los demás juegos.
   */
  function nombresEn(tt: number): number[] {
    const quienes = new Set<number>();
    for (const i of S.batch(n, tt, T_ROLL0, T_ROLL1)) quienes.add(i);
    for (const m of todos) if (m.e === 0 && tt >= m.t0 - 0.05 && tt < m.t0 + T_VUELVE) quienes.add(m.quien);
    if (prim && tt >= T_ENTREGA) {
      const avance = clamp(tHold / RUTA_DIBUJA, 0, 1);
      prim.cambios.forEach((i, j) => {
        if (avance * prim.cambios.length >= j + 1) quienes.add(i);
      });
      for (const en of encargos) quienes.add(en.destino);
    }
    return [...quienes];
  }

  /* -------------------------------------------------------------- dibujo */
  /**
   * La franja de aguayo de arriba de la feria: rayas con los colores de los
   * productos que corren despacio de lado a lado, como el tejido que se
   * desplaza en la mano. Es grande a propósito: la vista de fondo de la sala
   * tiene que ver que la escena se mueve aunque no pase nada en los puestos.
   */
  function dibujarAdornos(tt: number): void {
    adornosG.clear();
    const w = S.sw();
    const h = S.sh();
    const k = S.u();
    // Una nube que cruza la feria despacio, sobre el suelo y el cielo (no sobre los puestos): sombra de día,
    // y de noche una luz suave. Es grande, así que la sala la ve pasar en los dos temas.
    const yNube = (S.top() + 80 * k + (h - S.bottom() - 16 * k)) / 2;
    const xNube = ((tt * 60 * k) % (w + 800 * k)) - 400 * k;
    // En el tema claro, con tinta al 20 % se veía como una mancha gris sobre la feria (evaluación de la subida 2).
    adornosG.ellipse(xNube, yNube, 380 * k, 170 * k).fill(S.dark ? { color: CREAM, alpha: 0.13 } : { color: 0x6b4a2a, alpha: 0.09 });
    // Debajo de la leyenda y encima de los puestos.
    const y0 = franjaY;
    const alto = 22 * k;
    const ancho = 22 * k;
    const corrimiento = (tt * 60 * k) % (ancho * COLOR.length);
    for (let s = -COLOR.length; s * ancho + corrimiento < w; s++) {
      const x = s * ancho + corrimiento;
      adornosG.rect(x, y0, ancho, alto).fill({ color: COLOR[((s % COLOR.length) + COLOR.length) % COLOR.length] ?? 0, alpha: 0.9 });
    }
    adornosG.rect(0, y0, w, Math.max(1, k)).fill({ color: INK, alpha: 0.5 });
    adornosG.rect(0, y0 + alto - Math.max(1, k), w, Math.max(1, k)).fill({ color: INK, alpha: 0.5 });
  }

  function dibujarPuestos(tt: number, p: number, ruta: boolean): void {
    stallsG.clear();
    const luzPase = p >= 0 ? (luz[p] ?? new Set<number>()) : new Set<number>();
    const rechazan = new Set<number>();
    const cambian = new Map<number, number>();
    for (const m of todos) {
      if (!m.ok && tt >= m.t0 + T_TOCA && tt < m.t0 + T_VUELVE) rechazan.add(m.quien);
      if (m.ok && !m.entrega && tt >= m.t0 + T_TOCA && tt < m.t0 + T_TOCA + 0.5) cambian.set(m.quien, m.t0 + T_TOCA);
    }
    const pulso = 0.6 + 0.4 * Math.sin(tt * 9);
    for (let i = 0; i < n; i++) {
      const at = pos[i];
      const pu = plan.puestos[i];
      if (!at || !pu) continue;
      const crece = clamp((tt - (bornAt[i] ?? 0)) / 0.3, 0, 1);
      if (crece <= 0) continue;
      const r = radio * (0.72 + 0.28 * crece);
      const cerrado = (cambioAt[i] ?? Infinity) + 0.15 <= tt;
      const alfa = cerrado ? 0.32 : 1;
      const esDestino = esGanador.has(i);
      const dorado = esDestino && ruta;
      if (dorado) stallsG.circle(at.x, at.y, r * 1.7).fill({ color: 0xffc629, alpha: 0.28 });
      // El toldo: lo que acepta. Las rayas, para que se lea como puesto y no como cuadro.
      stallsG.rect(at.x - r, at.y - r * 0.72, 2 * r, r * 0.82).fill({ color: COLOR[pu.acepta] ?? 0, alpha: alfa });
      if (r > 6 * S.u()) {
        // Las rayas del toldo corren despacio de lado a lado, como el tejido en la mano: el toldo se mueve.
        const ancho = 2 * r;
        const corre = (tt * 20 * S.u() + i * 5 * S.u()) % ancho;
        for (let s = 0; s < 4; s++) {
          const x = at.x - r + ((s * ancho) / 4 + corre) % ancho;
          stallsG.rect(x - r * 0.07, at.y - r * 0.72, r * 0.14, r * 0.82).fill({ color: CREAM, alpha: 0.35 * alfa });
        }
      }
      // El cuerpo del puesto y lo que da: el cuadrito de abajo a la derecha.
      stallsG.rect(at.x - r, at.y + r * 0.1, 2 * r, r * 0.9).fill({ color: S.dark ? 0x3b2a22 : 0xd2b48c, alpha: alfa });
      stallsG.rect(at.x + r * 0.28, at.y + r * 0.22, r * 0.52, r * 0.52).fill({ color: COLOR[pu.da] ?? 0, alpha: alfa }).stroke({ width: Math.max(1, S.u()), color: INK, alpha: alfa });
      stallsG.rect(at.x - r, at.y - r * 0.72, 2 * r, 1.72 * r).stroke({ width: Math.max(1, 1.2 * S.u()), color: INK, alpha: 0.9 });
      if (luzPase.has(i) && !cerrado && !rechazan.has(i)) {
        stallsG.circle(at.x, at.y, r * 1.5).stroke({ width: 3 * S.u(), color: CREAM, alpha: 0.55 + 0.4 * pulso });
        stallsG.circle(at.x, at.y, r * 1.5 + 2 * S.u()).stroke({ width: Math.max(1, S.u()), color: INK, alpha: 0.8 });
      }
      if (rechazan.has(i)) {
        stallsG.circle(at.x, at.y, r * 1.6).fill({ color: 0xff4d4d, alpha: 0.32 });
        const d = r * 0.5;
        stallsG.moveTo(at.x - d, at.y - d).lineTo(at.x + d, at.y + d).stroke({ width: 3 * S.u(), color: 0xff4d4d });
        stallsG.moveTo(at.x + d, at.y - d).lineTo(at.x - d, at.y + d).stroke({ width: 3 * S.u(), color: 0xff4d4d });
      }
      const f = cambian.get(i);
      if (f !== undefined) {
        const q = clamp((tt - f) / 0.5, 0, 1);
        stallsG.circle(at.x, at.y, r * (1.2 + q)).stroke({ width: 3 * S.u(), color: COLOR[pu.da] ?? 0, alpha: 1 - q });
      }
    }
  }

  function dibujarEncargos(tt: number): void {
    bundlesG.clear();
    encargos.forEach((en, e) => {
      const aparece = clamp((tt - T_APPEAR - e * 0.05) / 0.3, 0, 1);
      const etiq = etiquetas[e];
      // Desde la entrega, la foto final queda limpia: sin etiquetas de producto debajo del cartel.
      if (aparece <= 0 || !etiq || tt >= T_ENTREGA) {
        if (etiq) etiq.visible = false;
        return;
      }
      const lugar = encargoEn(e, tt);
      // Un vaivén chico aun quieto: el atado no queda clavado en su origen mientras se pasa lista.
      const q = { x: lugar.x, y: lugar.y + Math.sin(tt * 2.4 + e * 1.3) * 1.2 * S.u() };
      const prod = productoEn(en, e, tt);
      const s = radio * 2.1 * aparece;
      bundlesG.ellipse(q.x, q.y + s * 0.5, s * 0.55, s * 0.16).fill({ color: INK, alpha: 0.32 });
      bundlesG.rect(q.x - s / 2, q.y - s / 2, s, s).fill({ color: COLOR[prod] ?? 0 }).stroke({ width: Math.max(1, 1.5 * S.u()), color: INK });
      // Las bandas del pallay, en crema, como en el aguayo.
      for (let b = 0; b < 3; b++) bundlesG.rect(q.x - s / 2, q.y - s / 2 + ((b + 1) * s) / 4 - s * 0.04, s, s * 0.08).fill({ color: CREAM, alpha: 0.75 });
      bundlesG.circle(q.x, q.y - s / 2 - s * 0.08, s * 0.1).fill(CREAM).stroke({ width: Math.max(1, S.u()), color: INK });
      // La etiqueta con el producto que lleva ahora.
      const texto = nombre(prod).toUpperCase();
      if (etiquetaTexto[e] !== texto) {
        etiquetaTexto[e] = texto;
        const tx = (etiq.children[1] as Text | undefined);
        if (tx) tx.text = texto;
      }
      etiq.visible = true;
      etiq.position.set(q.x, q.y - s / 2 - s * 0.32);
      const tx = etiq.children[1] as Text;
      const bg = etiq.children[0] as Graphics;
      const anch = tx.width + 14 * S.u(), alt = tx.height + 6 * S.u();
      etqMide[e] = { w: anch, h: alt };
      bg.clear().roundRect(-anch / 2, -alt / 2, anch, alt, 5 * S.u()).fill({ color: S.dark ? CREAM : 0xffffff, alpha: 0.95 }).stroke({ width: Math.max(1, S.u()), color: INK });
    });
  }

  /**
   * El atado `e` con su etiqueta, en la escena, mientras se ve: la cámara no lo
   * deja afuera y los nombres no lo tapan. Con un nombre encima, la etiqueta
   * del producto que viaja no se leía (revisión del Trueque, 21 de octubre de 2026).
   */
  function cajaAtado(e: number, tt: number): Caja | null {
    const aparece = clamp((tt - T_APPEAR - e * 0.05) / 0.3, 0, 1);
    if (aparece <= 0 || tt >= T_ENTREGA) return null;
    const q = encargoEn(e, tt);
    const s = radio * 2.1 * aparece;
    const m = etqMide[e] ?? { w: 0, h: 0 };
    const ancho = Math.max(s, m.w);
    const arriba = q.y - s / 2 - s * 0.32 - m.h / 2;
    return { x: q.x - ancho / 2, y: arriba, w: ancho, h: q.y + s * 0.66 - arriba };
  }
  /** Lo que se ve de la feria: debajo de la barra de arriba y encima del relator. */
  const zonaJuego = (): Zona => ({ x0: 4 * S.u(), y0: S.top() + 4 * S.u(), x1: S.sw() - 4 * S.u(), y1: S.sh() - S.bottom() - 4 * S.u() });
  /** Donde tienen que quedar los puestos del aro: debajo de la leyenda y encima del relator. */
  const zonaPuestos = (): Zona => ({ x0: 4 * S.u(), y0: leyendaAbajo + 4 * S.u(), x1: S.sw() - 4 * S.u(), y1: S.sh() - S.bottom() - 4 * S.u() });

  /**
   * Los puestos que en el pase `p` aceptan lo que lleva el encargo (los del
   * aro, sin los que ya cambiaron) y el que se está probando, con su aro, en la
   * escena. Al acercarse, la cámara los deja enteros: en un celular uno con aro
   * quedaba partido por el borde (evaluación de la subida 2, hallazgo 6). Son
   * los que la sala ve prendidos, así que encuadrarlos no adelanta nada.
   */
  function cajaCandidatos(tt: number, p: number, quien: number): Caja | null {
    const r = radio * 1.6 + 2 * S.u();
    const cajas: Caja[] = [];
    for (const i of [...(luz[p] ?? []), quien]) {
      if (i !== quien && (cambioAt[i] ?? Infinity) + 0.15 <= tt) continue;
      const q = pos[i];
      if (q) cajas.push({ x: q.x - r, y: q.y - r, w: 2 * r, h: 2 * r });
    }
    return cajas.length ? unir(cajas) : null;
  }

  function dibujarRuta(tt: number): void {
    routeG.clear();
    if (tt < T_ENTREGA) return;
    const avance = clamp(tHold / RUTA_DIBUJA, 0, 1);
    encargos.forEach((en, e) => {
      const pts = [origen[e] ?? { x: 0, y: 0 }, ...en.cambios.map((i) => pos[i] ?? { x: 0, y: 0 }), pos[en.destino] ?? { x: 0, y: 0 }];
      const segs = pts.length - 1;
      const g = avance * segs;
      for (let s = 0; s < segs; s++) {
        const f = clamp(g - s, 0, 1);
        if (f <= 0) break;
        const a = pts[s] as { x: number; y: number };
        const b = pts[s + 1] as { x: number; y: number };
        const x2 = a.x + (b.x - a.x) * f, y2 = a.y + (b.y - a.y) * f;
        routeG.moveTo(a.x, a.y).lineTo(x2, y2).stroke({ width: 10 * S.u(), color: INK, cap: "round" });
        routeG.moveTo(a.x, a.y).lineTo(x2, y2).stroke({ width: 5 * S.u(), color: 0xffc629, cap: "round" });
      }
      for (let j = 1; j <= en.cambios.length; j++) {
        if (g < j) break;
        const p = pts[j] as { x: number; y: number };
        routeG.circle(p.x, p.y, radio * 0.42).fill({ color: COLOR[en.productos[j] ?? 0] ?? 0 }).stroke({ width: Math.max(1, S.u()), color: INK });
      }
    });
  }

  /** El intento del encargo principal que está en curso en `tt`: va, responde el puesto y, si no cambió, vuelve. */
  const intentoEn = (tt: number): Mov | undefined => todos.find((m) => m.e === 0 && tt >= m.t0 && tt < m.t0 + T_VUELVE);

  /**
   * Lo que la cámara no puede dejar afuera mientras se juega: el atado que
   * sigue, con su etiqueta, y durante cada pase, hasta la entrega, los del
   * aro. La vista que pide `dirigir` ya los deja enteros; esto cuida el camino
   * hasta ahí, que con el acercamiento a medias metía un aro de la fila de
   * abajo debajo del relator.
   */
  function cajaVista(tt: number): Caja | null {
    const atado = cajaAtado(0, tt);
    const p = paseEn(tt);
    const aro = p >= 0 && tt < T_ENTREGA ? cajaCandidatos(tt, p, intentoEn(tt)?.quien ?? -1) : null;
    return atado && aro ? unir([atado, aro]) : (atado ?? aro);
  }

  /** La cámara: la feria entera al armarse, sigue al encargo en cada intento, y al final encuadra la ruta debajo del cartel. */
  function dirigir(tt: number): void {
    const w = S.sw(), h = S.sh();
    if (fase === "nova") {
      // Encuadra todas las rutas juntas, con la mitad de abajo de la pantalla libre para el cartel.
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      encargos.forEach((en, e) => {
        const pts = [origen[e] ?? { x: 0, y: 0 }, ...en.cambios.map((i) => pos[i] ?? { x: 0, y: 0 }), pos[en.destino] ?? { x: 0, y: 0 }];
        for (const q of pts) {
          x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
        }
      });
      if (!Number.isFinite(x0)) return;
      const yTop = S.placaBajo(winners.length), yBot = h - S.bottom() - 8 * S.u();
      // Arriba de cada puesto va el nombre de quien lo atiende: entra también,
      // así el cartel no tapa al ganador. Con cincuenta personas, en la
      // pantalla ancha su nombre quedaba debajo del cartel (21 de octubre de 2026).
      let z = 1;
      for (let vuelta = 0; vuelta < 2; vuelta++) {
        const arriba = y0 - radio * 1.5 - 8 * S.u() - NOMBRE_ALTO * S.u() / z;
        z = clamp(Math.min((0.88 * w) / Math.max(1, x1 - x0), Math.max(1, yBot - yTop) / Math.max(1, y1 + radio - arriba)), 0.7, 1.7);
      }
      const arriba = y0 - radio * 1.5 - 8 * S.u() - NOMBRE_ALTO * S.u() / z;
      const tx = w / 2, ty = (yTop + yBot) / 2;
      cam.lookAt((x0 + x1) / 2 - (tx - w / 2) / z, (arriba + y1 + radio) / 2 - (ty - h / 2) / z, z, 1.6);
      return;
    }
    if (tt >= T_ENTREGA) {
      // Quien espera, con su nombre debajo del cartel que sale en ese momento.
      const d = pos[prim?.destino ?? 0] ?? { x: w / 2, y: h / 2 };
      const z = 1.45;
      const yS = Math.max(h / 2, S.placaBajo(winners.length) + (radio * 1.5 + 8 * S.u()) * z + NOMBRE_ALTO * S.u());
      cam.lookAt(d.x, d.y - (yS - h / 2) / z, z, 2.4);
      return;
    }
    const p = paseEn(tt);
    const activo = intentoEn(tt);
    if (activo && p >= 0) {
      const a = encargoEn(0, tt);
      const b = pos[activo.quien] ?? a;
      // Entre el encargo y el puesto que se prueba, sin dejar afuera a los del aro.
      const caja = cajaCandidatos(tt, p, activo.quien);
      const v = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: 1.25 };
      const ve = caja ? dentro(caja, zonaPuestos(), v, w, h) : v;
      cam.lookAt(ve.x, ve.y, ve.z, 2.6);
    } else {
      // Entre intentos vuelve a la feria entera. Dentro de los pases, más rápido:
      // con la vuelta lenta, el pase siguiente prendía un puesto de la fila de
      // abajo cuando la cámara todavía estaba cerca, y quedaba debajo del relator.
      cam.lookAt(w / 2, h / 2, 1, p >= 0 ? 4 : 2);
    }
  }

  /* -------------------------------------------------------- bucle del juego */
  /** El contador de cambios del encargo principal, mientras se hacen cambios. */
  function contar(tt: number): void {
    if (!prim || tt < T_FERIA || tt >= T_ENTREGA || prim.cambios.length === 0) {
      contador.text = "";
      return;
    }
    const hechos = prim.cambios.filter((i) => (cambioAt[i] ?? Infinity) <= tt).length;
    contador.text = T[getLang()].trCuenta(hechos, prim.cambios.length);
  }

  skipFn = (): void => {
    if (fase !== "show") return;
    // Al saltar se muestra el final: se disparan los eventos críticos (el ganador y la ruta), y el resto se descarta.
    while (proximo < evs.length && (evs[proximo]?.at ?? Infinity) < T_NOVA) {
      const ev = evs[proximo];
      if (ev?.critico) ev.run();
      proximo++;
    }
    tAll = T_NOVA;
    fase = "nova";
    tHold = 0;
    cam.noBlur();
  };

  // Un primer dibujo antes de arrancar el bucle: el calentamiento del andamiaje (que compila lo que se ve)
  // corre con la escena ya armada, y la feria de doscientos puestos no paga la compilación en el show.
  dibujarAdornos(0);
  dibujarPuestos(0, -1, false);
  dibujarEncargos(0);
  dibujarRuta(0);
  S.run((dt, now) => {
    tAll += dt;
    S.breath(tAll, T_ENTREGA);
    // Los eventos en su hora, uno por vez, cada uno una sola vez.
    while (proximo < evs.length && tAll >= (evs[proximo]?.at ?? Infinity)) {
      evs[proximo]?.run();
      proximo++;
    }
    if (fase === "show" && tAll >= T_NOVA) {
      fase = "nova";
      tHold = 0;
    }
    if (fase === "nova") {
      tHold += dt * paceFactor();
      if (tHold >= WINNER_HOLD) {
        fase = "dead";
        S.cleanup();
        return;
      }
    }
    if (fase === "dead") return;
    const tt = tAll;
    dirigir(tt);
    // El atado que sigue la cámara, siempre entero en cuadro: cuando volvía de
    // un puesto que no lo cambió, iba más rápido que la cámara y salía por el
    // costado (revisión del Trueque, 21 de octubre de 2026).
    cam.proteger(fase === "show" ? cajaVista(tt) : null, zonaJuego());
    cam.update(dt);
    cam.apply(S.scene, S.sw(), S.sh(), now);
    dibujarAdornos(tt);
    // La leyenda y el contador se van con la entrega: el cartel y la ruta ocupan la pantalla.
    leyenda.visible = tt < T_ENTREGA;
    contador.visible = tt < T_ENTREGA;
    dibujarPuestos(tt, paseEn(tt), tt >= T_ENTREGA);
    dibujarEncargos(tt);
    dibujarRuta(tt);
    contar(tt);
    if (tt >= T_ENTREGA && !golpeDado) {
      golpeDado = true;
      S.mark("golpe", cam.golpe(0.3, 0.8, 1.2).toFixed(3));
      cam.shake(12 * S.u());
    }
    if (tt >= T_ENTREGA) crown.at(tt - T_ENTREGA);
    // Los nombres: el pasar lista de la feria, los que se prueban, y la ruta con
    // quien espera. Sin tapar el atado ni la etiqueta de lo que lleva.
    const evitar = encargos.flatMap((_, e) => {
      const c = cajaAtado(e, tt);
      if (!c) return [];
      const a = cam.toScreen(c.x, c.y, S.sw(), S.sh()), b = cam.toScreen(c.x + c.w, c.y + c.h, S.sw(), S.sh());
      return [{ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }];
    });
    S.tags(names, nombresEn(tt), (i) => {
      const p = pos[i];
      return p && tt > (bornAt[i] ?? 0) ? cam.toScreen(p.x, p.y - radio * 1.5 - 8 * S.u(), S.sw(), S.sh()) : null;
    }, evitar);
  });
}
