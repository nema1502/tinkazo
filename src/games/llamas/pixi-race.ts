import { LEGIBLE } from "../pixi/letra";
import { CanvasSource, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { emblemasDe } from "../emblemas";
import { gsap } from "gsap";
import { T, getLang, t } from "../../i18n";
import { paceFactor, params, setGameLength, yaContaron, type Beacon } from "../../state";
import { hayPeloton, normalCarrera } from "../../duraciones";
import { cabe, centrar, crecer, dentro, unir, type Vista, type Zona } from "../pixi/encuadre";
import { beep, beepFor, fanfare, isMuted, audio, note } from "../../sound";
import { enOrden, tension } from "../drama";
import { WINNER_HOLD, shorten, winnersLabel } from "../overlay";
import { wavesAround } from "../pixi/qualifier";
import { CREAM, INK, MONO, YELLOW, contorno, hash, mountPixi, seeded, type PixiStage } from "../pixi/stage";
import { lugarDe } from "../pixi/kit/respuestas";
import { exponerNino } from "../pixi/nino";
import { planRace, type Plan } from "./plan";
import { duracionDeLaCarrera, horaDeLaCarrera, respuestasCarrera, type PlanDeLaCarrera } from "./race-nino";
import { planPeloton } from "./peloton-plan";
import { crearPeloton, type Peloton } from "./pixi-peloton";

/**
 * La carrera en PixiJS y GSAP, con el director de cámara. Dos pieles: llamas
 * por la cordillera y cohetes por el espacio.
 *
 * Es la misma carrera que `race.ts`: el mismo plan, la misma historia del
 * director de emoción y el mismo relato, con la misma ronda. Lo que cambia es
 * cómo se mira. La cámara arranca pegada a la largada, sigue a la punta, se
 * mete en cada momento de la historia (el tropiezo, la plantada, la escupida),
 * se cierra sobre las de adelante en la recta final, va en cámara lenta a la
 * meta en la foto, y pega un golpe cuando cruza la ganadora.
 *
 * Nada de eso decide nada: la cámara mira lo que el plan ya decidió.
 */

const DUR = 15;
/** Cuánto salta la ganadora cuando festeja, en unidades de pantalla: la cámara le deja ese lugar. */
const SALTO = 22;
type Skin = "andes" | "stellar" | "lago";

/**
 * Antes de la largada, en segundos de juego.
 *
 * Con más de ocho, la clasificatoria: aparecen todos con su llama del color de
 * su lana, se van tachando en oleadas, y los ocho de la final bajan a la pista.
 * En el evento del 17 de octubre de 2026 corrieron 8 de 27 y Nicolás no vio a
 * las otras 19: "no sentí que aparecieran las 25 o 26 llamas".
 *
 * Con ocho o menos, la presentación: cada carril entra con su nombre, como los
 * atletas antes de una final. Le da a cada uno su momento y a la sala unos
 * segundos de expectativa antes del disparo.
 */
const Q_SHOW = 1.8;
const Q_WAVE = 1.5;
const P_LANE = 0.5;
const P_TAIL = 0.7;

/** Colores de lana de llama: blanca, café, crema, oscura, gris. */
const FUR = [0xf3ead8, 0xa0683a, 0xe4c99a, 0x5b3a29, 0xc2bab0, 0x8a5a3c, 0xefe3cc, 0x6e4a36];

/** Un rectángulo en unidades del juego (o de pantalla, según de dónde venga). */
interface Caja {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Runner {
  root: Container;
  tag: Container;
  mark: Text;
  /** El cuerpo de la llama, en su propio sistema (se mide al armarla, quieta y sin el "!"). */
  caja?: Caja;
  /** Cuánto asoma el "!" de los momentos por encima del cuerpo, en el mismo sistema. */
  marca?: number;
  /** Pone la postura: `ph` es la fase del paso, `speed` 1 es ir al ritmo de la carrera. */
  pose(ph: number, speed: number, beat: { kind: string; p: number } | null, now: number): void;
}

/** El cuerpo de una llama, cohete o balsa: lo que ocupa el dibujo sin el nombre. */
const medirCaja = (root: Container): Caja => {
  const b = root.getLocalBounds();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
};

const lerpN = (a: number, b: number, k: number): number => a + (b - a) * k;

const dim = (c: number, f: number): number => {
  const r = ((c >> 16) & 255) * f, g = ((c >> 8) & 255) * f, b = (c & 255) * f;
  return (Math.round(Math.min(255, r)) << 16) | (Math.round(Math.min(255, g)) << 8) | Math.round(Math.min(255, b));
};

export async function llamasPixi(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
  skin: Skin = "andes",
): Promise<void> {
  const winnerIdx = winners[0] ?? 0;
  const space = skin === "stellar";
  const lake = skin === "lago";
  let skipFn = (): void => {};
  const st = await mountPixi(beacon, done, () => skipFn());
  if (!st) {
    done();
    return;
  }
  const S: PixiStage = st;
  const { rng, cam } = S;
  const dark = space || S.dark;
  const voice = space ? "R" : lake ? "B" : "L";

  // La cuenta propia de la largada. Si la sala ya contó "3, 2, 1" con la
  // tarjeta, larga directo: dos cuentas seguidas eran una de más.
  const CUENTA = yaContaron() ? 0 : 3;

  // El mismo azar que `race.ts`, consumido en el mismo orden: la misma ronda
  // cuenta la misma historia en los dos motores. `race.ts` siembra su paisaje
  // entre los carriles y la historia: una semilla de paso por corredor, 24
  // cerros, 18 lomas, 6 nubes, y 60 estrellas (150 en el espacio).
  const stars = space ? 150 : 60;
  /** La línea de "¡a sus puestos!": se sortea acá, en su turno del azar, y se dice cuando termina la presentación. */
  let listos = "";
  const plan: Plan = planRace(names, winnerIdx, rng, {
    sceneryDraws: Math.min(8, names.length) + 24 * 2 + 18 * 2 + 6 * 4 + stars * 3,
    beforePlace: () => {
      listos = t(space ? "cReadyStellar" : lake ? "cReadyLago" : "cReady");
    },
    co: winners.slice(1),
  });
  const { story, lanes } = plan;
  S.mark("arco", story.arc);
  const N = lanes.length;

  /**
   * El pelotón: de 9 a 30 personas, en la carrera de llamas, salen todas
   * juntas y se van echando hasta que quedan las ocho de la final (las mismas
   * de siempre, que eligió el plan de arriba). Con 8 o menos y con más de 30
   * sigue todo como antes. `?peloton=0` lo apaga y vuelve la clasificatoria.
   * El azar del pelotón es aparte: la final cuenta la misma historia.
   */
  const peloDicho = new Set<string>();
  const peloton = skin === "andes" && hayPeloton(names.length) && params.get("peloton") !== "0"
    ? planPeloton(names.length, lanes, seeded(parseInt(beacon.randomness.slice(48, 56), 16)))
    : null;

  // La clasificatoria, con un azar aparte (de la ronda, no el del plan): los
  // ocho de la final son los mismos de siempre, así que la carrera cuenta la
  // misma historia que antes y que en el motor anterior.
  // El dibujo de los emblemas, solo si hay pelotón, y esperado antes de arrancar: una imagen se
  // decodifica cuando el navegador quiere y las primeras fichas saldrían sin cara. Si no llega,
  // el pelotón sigue con la cara de siempre.
  let dibujoEmblemas: typeof import("../emblemas-dibujo") | null = null;
  if (peloton) {
    try {
      const m = await import("../emblemas-dibujo");
      await m.cargarEmblemas();
      dibujoEmblemas = m;
    } catch {
      dibujoEmblemas = null;
    }
  }
  // Una persona, una cara (hallazgo de la batería de cierre, 26 de octubre de 2026): con pelotón, la final y el cartel del
  // ganador usan el mismo emblema de figura que el pelotón; antes llevaban el glifo cuadrado y la misma persona tenía dos caras.
  const texEmblemas: Texture[] = [];
  const emblemaCara = ((): ((persona: number, lado: number) => Texture | null) | null => {
    if (!peloton || !dibujoEmblemas) return null;
    const dibujo = dibujoEmblemas;
    const emb = emblemasDe(names, beacon.randomness);
    const memo = new Map<string, Texture>();
    return (persona, lado) => {
      const key = `${persona}|${lado}`;
      let tex = memo.get(key);
      if (!tex) {
        const e = emb[persona];
        const lienzo = e ? dibujo.emblemaCanvas(e, lado) : null;
        if (!lienzo) return null;
        tex = new Texture({ source: new CanvasSource({ resource: lienzo, autoGenerateMipmaps: true, scaleMode: "linear" }) });
        memo.set(key, tex);
        texEmblemas.push(tex);
      }
      return tex;
    };
  })();
  S.onCleanup(() => {
    for (const tx of texEmblemas) tx.destroy(true);
    texEmblemas.length = 0;
  });
  const waves = !peloton && names.length > N ? wavesAround(names.length, lanes, seeded(parseInt(beacon.randomness.slice(40, 48), 16))) : [];
  /** Cuándo entra el primer carril: después del pelotón o de las oleadas, si los hay. */
  const T_LANES = peloton ? peloton.fin : waves.length ? Q_SHOW + waves.length * Q_WAVE : 0;
  /** Cuándo entra a la pista el carril `k`. */
  const laneAt = (k: number): number => T_LANES + k * P_LANE;
  /** Todo lo de antes de la cuenta, en segundos de juego. */
  const PRE = T_LANES + N * P_LANE + P_TAIL;
  /** Cuándo se va cada nombre de la clasificatoria: su oleada, y un escalonado chico adentro. */
  const goneAt = new Map<number, number>();
  waves.forEach((w, wi) => w.forEach((idx, j) => goneAt.set(idx, Q_SHOW + wi * Q_WAVE + 0.1 + (j / Math.max(1, w.length)) * 0.45)));
  setGameLength(DUR + PRE, WINNER_HOLD + CUENTA, peloton ? normalCarrera(names.length) : null);
  S.mark("clasificatoria", `${N}/${names.length}`);
  S.mark("peloton", peloton ? `${peloton.eventos.length}` : "0");
  const nameOf = (k: number): string => names[lanes[k] as number] ?? "";
  /** Los carriles de los que ganan algo: en la corona no se apagan. */
  const prizedLanes = new Set(winners.map((w) => lanes.indexOf(w)).filter((k) => k >= 0));
  const deco = seeded(parseInt(beacon.randomness.slice(24, 32), 16));

  /* ============================================================ geometría */
  interface Geo {
    sw: number; sh: number; u: number; portrait: boolean;
    X0: number; TL: number; trackTop: number; trackBot: number; laneH: number;
    laneY: (k: number) => number; laneScale: (k: number) => number; midY: number;
  }
  const geo = (): Geo => {
    const sw = S.sw(), sh = S.sh(), u = S.u(), portrait = S.portrait();
    const trackTop = sh * (portrait ? 0.36 : 0.35);
    const trackBot = sh - S.bottom() - 6 * u;
    const laneH = (trackBot - trackTop) / N;
    return {
      sw, sh, u, portrait, trackTop, trackBot, laneH,
      X0: sw * (portrait ? 0.36 : 0.2),
      TL: 2.4 * Math.max(sw, sh * 0.9),
      laneY: (k) => trackTop + laneH * (k + 0.82),
      laneScale: (k) => ((laneH * 2.3) / 86) * (0.88 + 0.24 * (N > 1 ? k / (N - 1) : 1)),
      midY: (trackTop + trackBot) / 2,
    };
  };
  let G = geo();

  /* =============================================================== escena */
  interface Layers {
    far: Container; mid: Container; near: Container; stands: Container; world: Container;
    crowd: Sprite[]; crowdBase: { x: number; y: number; ph: number }[]; people: Texture[];
    flags: Graphics; fx: Graphics; runners: Runner[]; clouds: Container; sun: Container;
    mini: Graphics; rows: Container[]; count: Text[]; foto: Container;
    board: Container; aviso: Container | null; qual: Qual;
    /** El pelotón (de 9 a 30), y el destello con que se abre en los carriles. */
    pelo: Peloton | null; destello: Graphics | null;
  }
  /** La clasificatoria en pantalla: todos los nombres con su llama, y las oleadas. */
  interface Qual {
    root: Container; dim: Graphics; head: Container; count: Text | null; strikes: Graphics;
    cells: Container[]; at: { x: number; y: number }[];
    /** Hasta dónde llega el chip de cada celda, para tacharlo. */
    ends: number[];
    /** Cuánto se corre el chip desde el centro de la celda (la llama va a la izquierda). */
    chipDx: number;
    /** A qué escala quedó la grilla: cada celda se arma al tamaño de siempre y se escala entera. */
    scale: number;
  }

  function gradientTexture(stops: [number, string][], h = 256): Texture {
    const c = document.createElement("canvas");
    c.width = 2;
    c.height = h;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createLinearGradient(0, 0, 0, h);
    for (const [at, col] of stops) g.addColorStop(at, col);
    cx.fillStyle = g;
    cx.fillRect(0, 0, 2, h);
    return Texture.from(c);
  }
  function glowTexture(col: string): Texture {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const cx = c.getContext("2d") as CanvasRenderingContext2D;
    const g = cx.createRadialGradient(128, 128, 0, 128, 128, 128);
    g.addColorStop(0, col);
    g.addColorStop(0.25, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, 256, 256);
    return Texture.from(c);
  }

  /** Una llama armada por partes, mirando a la derecha, con los pies en y = 0. */
  function makeLlama(k: number, sc: number, pelo?: { persona: number; manta: number; dorsal: string }): Runner {
    const fur = FUR[((pelo ? pelo.persona : lanes[k]) as number) % FUR.length] ?? 0xf3ead8;
    const root = new Container();
    root.addChild(new Graphics().ellipse(0, 0, 24, 5).fill({ color: 0x000000, alpha: 0.28 }));
    const body = new Container();
    root.addChild(body);
    /**
     * Una pata en dos partes, con la rodilla en el medio. Hasta el 29 de
     * septiembre de 2026 era un palito rígido que se balanceaba desde la
     * cadera; con la rodilla, la pata se dobla cuando va hacia adelante y se
     * estira cuando apoya, que es lo que hace que un galope se lea como galope.
     */
    const leg = (x: number, far: boolean): { hip: Container; knee: Container } => {
      const col = far ? dim(fur, 0.72) : fur;
      const hip = new Container();
      hip.position.set(x, -30);
      const knee = new Container();
      knee.position.set(0, 15);
      knee.addChild(new Graphics()
        .roundRect(-2.8, -1, 5.6, 16, 2.5).fill(col).stroke({ width: 2, color: INK })
        .roundRect(-3.5, 12, 7, 5, 2).fill(INK));
      hip.addChild(knee, new Graphics().roundRect(-3.3, 0, 6.6, 17, 3.2).fill(col).stroke({ width: 2, color: INK }));
      return { hip, knee };
    };
    const legs = [leg(-12, true), leg(15, true), leg(-16, false), leg(11, false)];
    body.addChild(legs[0]!.hip, legs[1]!.hip);
    const tail = new Graphics().ellipse(-3, -2, 6, 5).fill(fur).stroke({ width: 2, color: INK });
    tail.position.set(-24, -40);
    body.addChild(tail);
    const torso = new Graphics();
    for (let i = 0; i < 6; i++) torso.circle(-17 + i * 7, -44 + Math.sin(i * 1.7) * 1.5, 5.5).fill(fur);
    torso.ellipse(0, -36, 24, 13).fill(fur).stroke({ width: 2.2, color: INK });
    body.addChild(torso);
    const blanket = new Graphics()
      .roundRect(-15, -48, 30, 17, 4).fill(pelo ? pelo.manta : S.color(k)).stroke({ width: 2, color: INK })
      .rect(-15, -43, 30, 2.4).fill(YELLOW)
      .rect(-15, -38.5, 30, 2.4).fill(0x2f9e44);
    body.addChild(blanket);
    // En el pelotón no hay dorsal: la ficha de arriba ya lleva la inicial, y treinta textos
    // más son treinta texturas y otros tantos cortes del dibujo.
    if (!pelo) {
      const bib = S.text(String(k + 1), { fontSize: 11, fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 } });
      bib.anchor.set(0.5);
      bib.position.set(0, -40);
      body.addChild(bib);
    }
    body.addChild(legs[2]!.hip, legs[3]!.hip);
    const neck = new Container();
    neck.position.set(16, -42);
    const neckG = new Graphics()
      .roundRect(-5, -34, 11, 38, 5).fill(fur).stroke({ width: 2.2, color: INK })
      .ellipse(6, -38, 11, 8).fill(fur).stroke({ width: 2.2, color: INK })
      .ellipse(14, -36, 5.5, 4.5).fill(dim(fur, 0.8)).stroke({ width: 1.6, color: INK })
      .circle(6, -40, 1.8).fill(INK);
    const earL = new Graphics().poly([-3, 0, 0, -11, 3, 0]).fill(fur).stroke({ width: 1.8, color: INK });
    earL.position.set(1, -44);
    const earR = new Graphics().poly([-3, 0, 0, -12, 3, 0]).fill(dim(fur, 0.85)).stroke({ width: 1.8, color: INK });
    earR.position.set(6, -45);
    neck.addChild(earR, neckG, earL);
    body.addChild(neck);
    const mark = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
    mark.anchor.set(0.5, 1);
    mark.position.set(20, -98);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);
    return {
      root, mark, tag: pelo ? new Container() : S.chip(nameOf(k), 1, nameOf(k), emblemaCara?.(lanes[k] as number, 64) ?? null),
      pose(ph, speed, beat) {
        const sw = 0.55;
        let lean = speed > 1.25 ? 0.07 : 0;
        // Las patas se pliegan cuando la llama se echa (el pelotón): sin eso, vuelven a su largo.
        let plegada = 0;
        let legA = [Math.sin(ph) * sw, Math.sin(ph + 0.9) * sw, Math.sin(ph + Math.PI) * sw, Math.sin(ph + Math.PI + 0.9) * sw];
        let neckRot = Math.sin(ph * 2) * 0.05;
        mark.visible = false;
        if (beat?.kind === "plantada") {
          legA = [0.25, -0.35, 0.25, -0.35];
          lean = -0.1;
          neckRot = -0.25;
          mark.visible = true;
          mark.text = "!";
        } else if (beat?.kind === "tropiezo") lean = 0.35 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
        else if (beat?.kind === "escupida") neckRot = -0.35 * Math.sin(Math.PI * beat.p);
        else if (beat?.kind === "escupido") {
          lean = -0.12 * Math.sin(Math.PI * beat.p * 3);
          mark.visible = true;
          mark.text = "?!";
        } else if (beat?.kind === "tambalea") {
          // Se tambalea y sigue: se balancea de un lado al otro con el "¡!".
          lean = 0.22 * Math.sin(beat.p * Math.PI * 5) * (1 - beat.p * 0.4);
          neckRot = -0.18 * Math.sin(beat.p * Math.PI * 5 + 1);
          mark.visible = true;
          mark.text = "!";
        } else if (beat?.kind === "echada") {
          // Se echa: baja el cuerpo, pliega las patas y se queda quieta con el cuello alto.
          plegada = Math.min(1, beat.p);
          neckRot = -0.1;
        }
        // La cadera da el paso; la rodilla se dobla mientras la pata va hacia
        // adelante (cuando el ángulo baja) y queda derecha al apoyar.
        const phs = [ph, ph + 0.9, ph + Math.PI, ph + Math.PI + 0.9];
        const stiff = beat?.kind === "plantada" || speed < 0.1;
        legs.forEach((l, i) => {
          l.hip.rotation = plegada ? lerpN(legA[i] ?? 0, i % 2 ? 1.25 : -1.25, plegada) : (legA[i] ?? 0);
          l.knee.rotation = plegada ? plegada * (i % 2 ? -1.9 : 1.9) : stiff ? 0 : Math.max(0, -Math.cos(phs[i] ?? 0)) * (i % 2 === 0 ? 1.05 : 0.8);
          l.hip.scale.y = 1 - 0.3 * plegada;
        });
        body.rotation = lean;
        body.y = plegada ? 15 * plegada : speed > 0.1 ? -Math.abs(Math.sin(ph)) * 4 : 0;
        neck.rotation = neckRot;
        earL.rotation = Math.sin(ph * 2 + 1) * 0.25;
        earR.rotation = Math.sin(ph * 2 + 2) * 0.25;
        tail.rotation = Math.sin(ph * 2) * 0.4;
      },
    };
  }

  /** Un cohete, mirando a la derecha, con la cara de su piloto en la ventanilla. */
  function makeRocket(k: number, sc: number): Runner {
    const root = new Container();
    const body = new Container();
    root.addChild(body);
    const flame = new Graphics();
    body.addChild(flame);
    const col = S.color(k);
    const hull = new Graphics()
      .poly([-30, -46, -44, -60, -38, -46]).fill(col).stroke({ width: 2, color: INK })
      .poly([-30, -26, -44, -12, -38, -26]).fill(col).stroke({ width: 2, color: INK })
      .roundRect(-36, -50, 58, 28, 13).fill(0xeef0f8).stroke({ width: 2.4, color: INK })
      .poly([20, -50, 44, -36, 20, -22]).fill(col).stroke({ width: 2.4, color: INK })
      .rect(-22, -50, 6, 28).fill(col)
      .circle(4, -36, 10).fill(0x1d2336).stroke({ width: 2.4, color: INK });
    body.addChild(hull);
    const av = new Sprite(emblemaCara?.(lanes[k] as number, 64) ?? S.face(nameOf(k)));
    av.width = av.height = 14;
    av.anchor.set(0.5);
    av.position.set(4, -36);
    body.addChild(av);
    const bib = S.text(String(k + 1), { fontSize: 12, fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 } });
    bib.anchor.set(0.5);
    bib.position.set(-8, -36);
    body.addChild(bib);
    const mark = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
    mark.anchor.set(0.5, 1);
    mark.position.set(0, -66);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);
    return {
      root, mark, tag: S.chip(nameOf(k), 1, nameOf(k), emblemaCara?.(lanes[k] as number, 64) ?? null),
      pose(ph, speed, beat, now) {
        // La llama del motor: larga cuando acelera, corta y roja cuando se apaga.
        const off = beat?.kind === "plantada";
        const len = off ? 4 : 14 + Math.min(2, speed) * 16 + Math.sin(now * 40 + k) * 4;
        flame.clear()
          .poly([-40, -44, -40 - len, -36, -40, -28]).fill(off ? 0xd7263d : 0xff9f1c)
          .poly([-40, -40, -40 - len * 0.6, -36, -40, -32]).fill(0xfff3c4);
        let rot = speed > 1.25 ? -0.04 : Math.sin(ph * 0.5) * 0.02;
        mark.visible = false;
        if (off) {
          mark.visible = true;
          mark.text = "!";
          rot = 0.08 * Math.sin(now * 30);
        } else if (beat?.kind === "tropiezo") rot = 0.4 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
        else if (beat?.kind === "escupido") {
          rot = 0.1 * Math.sin(Math.PI * beat.p * 3);
          mark.visible = true;
          mark.text = "?!";
        }
        body.rotation = rot;
        body.y = Math.sin(ph * 0.7 + k) * 2;
      },
    };
  }

  /**
   * Una balsa de totora del Titicaca, mirando a la derecha, con la línea de
   * agua en y = 0: dos haces de totora curvados hacia arriba, la proa con
   * cabeza de puma y un remero de poncho y chullo con la cara del participante.
   */
  function makeBoat(k: number, sc: number): Runner {
    const col = S.color(k);
    const reed = 0xd9b45a, reedDark = 0x9c7a34;
    const root = new Container();
    root.addChild(new Graphics().ellipse(0, 1, 50, 6).fill({ color: 0x000000, alpha: 0.18 }));
    const body = new Container();
    root.addChild(body);
    const hull = new Graphics()
      .poly([-48, -26, -46, -22, -38, -8, -24, 1, 24, 1, 38, -8, 46, -22, 50, -30, 46, -31, 40, -20, 30, -12, -30, -12, -40, -20, -45, -28])
      .fill(reed).stroke({ width: 2.2, color: INK, join: "round" })
      .moveTo(-34, -7).lineTo(34, -7).moveTo(-26, -2).lineTo(26, -2).stroke({ width: 1.4, color: reedDark })
      .rect(-30, -12, 3, 13).fill(reedDark).rect(-10, -12, 3, 13).fill(reedDark).rect(10, -12, 3, 13).fill(reedDark).rect(28, -12, 3, 12).fill(reedDark)
      .circle(50, -34, 5.5).fill(reed).stroke({ width: 2, color: INK })
      .poly([47, -38, 48.5, -44, 51, -38]).fill(reed).stroke({ width: 1.4, color: INK })
      .circle(52, -34.5, 1.3).fill(INK);
    body.addChild(hull);
    const rower = new Container();
    const poncho = new Graphics().poly([-10, -12, 10, -12, 7, -24, 4, -31, -4, -31, -7, -24]).fill(col).stroke({ width: 2, color: INK, join: "round" })
      .rect(-8, -21, 16, 2.4).fill(0xffffff)
      .poly([4, -27, 13, -22, 11, -19, 3, -23]).fill(col).stroke({ width: 1.6, color: INK });
    const av = new Sprite(S.face(nameOf(k)));
    av.width = av.height = 13;
    av.anchor.set(0.5);
    av.position.set(0, -38);
    const chullo = new Graphics()
      .poly([-7.5, -42, -8.5, -34, -5.5, -34, -5, -42]).fill(col).stroke({ width: 1.2, color: INK })
      .poly([7.5, -42, 8.5, -34, 5.5, -34, 5, -42]).fill(col).stroke({ width: 1.2, color: INK })
      .ellipse(0, -44, 8, 5.5).fill(col).stroke({ width: 1.6, color: INK })
      .rect(-7, -44, 14, 1.6).fill(0xffffff)
      .circle(0, -50, 2.4).fill(YELLOW).stroke({ width: 1, color: INK });
    rower.addChild(poncho, av, chullo);
    rower.position.set(-6, 0);
    const paddle = new Graphics().rect(-1.2, 0, 2.4, 34).fill(0x7a5230).roundRect(-4, 30, 8, 14, 3).fill(0x7a5230).stroke({ width: 1.4, color: INK });
    paddle.position.set(-2, -26);
    body.addChild(rower, paddle);
    const bib = S.text(String(k + 1), { fontSize: 12, fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 } });
    bib.anchor.set(0.5);
    bib.position.set(-18, -5);
    body.addChild(bib);
    const mark = S.text("!", { fontSize: 26, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 5 } });
    mark.anchor.set(0.5, 1);
    mark.position.set(0, -62);
    mark.visible = false;
    root.addChild(mark);
    root.scale.set(sc);
    return {
      root, mark, tag: S.chip(nameOf(k), 1, nameOf(k), emblemaCara?.(lanes[k] as number, 64) ?? null),
      pose(ph, speed, beat, now) {
        // El remo va y viene con el paso; sin viento se queda quieto.
        let rot = Math.sin(ph * 0.5 + k) * 0.03;
        let stroke = 0.35 + Math.sin(ph) * 0.55;
        mark.visible = false;
        if (beat?.kind === "plantada") {
          stroke = 0.1;
          mark.visible = true;
          mark.text = "!";
          rot = 0.03 * Math.sin(now * 3);
        } else if (beat?.kind === "tropiezo") rot = 0.3 * Math.sin(Math.PI * Math.min(1, beat.p * 1.4));
        else if (beat?.kind === "escupido") {
          rot = -0.1 * Math.sin(Math.PI * beat.p * 3);
          mark.visible = true;
          mark.text = "?!";
        }
        paddle.rotation = stroke + (speed > 1.25 ? 0.15 : 0);
        body.rotation = rot;
        body.y = Math.sin(now * 2.2 + k) * 1.6;
      },
    };
  }

  let L!: Layers;
  /**
   * Si el pelotón falla (al armarse o a mitad del show), se aparta y la carrera
   * sigue con la final de siempre: lo que importa es el sorteo, no el pelotón.
   * Queda anotado en el lienzo para los auditores (`data-pelotonFalla`).
   */
  let peloRoto = false;
  function pelotonRoto(err: unknown): void {
    if (peloRoto) return;
    peloRoto = true;
    S.mark("pelotonFalla", String((err as Error | undefined)?.message ?? err).slice(0, 120));
    console.error(err);
    if (L?.pelo) {
      L.pelo.escena.visible = false;
      L.pelo.hud.visible = false;
    }
    if (L?.destello) L.destello.visible = false;
    if (L?.world) L.world.visible = true;
    // Lo que faltaba del pelotón se salta: `preUpdate` adelanta el reloj hasta la entrada de los carriles
    // (acá todavía no se puede tocar, el primer armado corre antes de que existan los relojes).
  }

  function build(): void {
    G = geo();
    const { sw, sh, u, X0, TL, trackTop, trackBot, laneH } = G;
    const finishX = X0 + TL;
    const standsTop = trackTop - 90 * u;
    for (const c of [S.bg, S.scene, S.hud]) c.removeChildren().forEach((x) => x.destroy({ children: true }));

    // El cielo, quieto detrás de todo.
    const sky = new Sprite(
      gradientTexture(
        space ? [[0, "#05071c"], [0.6, "#140b33"], [1, "#2a1250"]]
          : dark ? [[0, "#0b1230"], [0.55, "#2a1b48"], [1, "#c0603f"]]
            : [[0, "#5aa9e6"], [0.6, "#a8d8f0"], [1, "#ffe0a8"]],
      ),
    );
    sky.width = sw;
    sky.height = space ? sh : standsTop + 60 * u;
    S.bg.addChild(sky);
    // Debajo del cielo, su último color hasta abajo: con pocas personas la
    // cámara se aleja más que antes, y entre el cielo y la cordillera asomaba
    // el fondo oscuro del lienzo. De cerca la cordillera lo tapa, como siempre.
    if (!space) S.bg.addChild(new Graphics().rect(0, sky.height - 1, sw, Math.max(1, sh - sky.height + 1)).fill(dark ? 0xc0603f : 0xffe0a8));
    if (space) {
      const sg = new Graphics();
      for (let i = 0; i < 220; i++) sg.circle(deco() * sw, deco() * sh, (0.4 + deco() * 1.4) * u).fill({ color: 0xffffff, alpha: 0.4 + deco() * 0.6 });
      S.bg.addChild(sg);
    }
    const sun = new Container();
    const halo = new Sprite(glowTexture(space ? "rgba(150,110,255,0.55)" : dark ? "rgba(255,240,200,0.55)" : "rgba(255,245,200,0.9)"));
    halo.anchor.set(0.5);
    halo.width = halo.height = (space ? 360 : 230) * u;
    const disc = new Graphics().circle(0, 0, (space ? 58 : 30) * u).fill(space ? 0x7b61ff : dark ? 0xf4ecd8 : 0xfff3c4);
    if (space) disc.ellipse(0, 0, 100 * u, 16 * u).stroke({ width: 5 * u, color: 0xc9b8ff, alpha: 0.8 });
    sun.addChild(halo, disc);
    sun.position.set(sw * 0.78, (space ? sh * 0.2 : standsTop * 0.32));
    S.bg.addChild(sun);
    const clouds = new Container();
    for (let i = 0; i < 7; i++) {
      const g = new Graphics();
      const cx = deco() * sw * 1.4, cy = standsTop * (0.12 + deco() * 0.45), s = (0.6 + deco() * 0.8) * u;
      for (let j = 0; j < 5; j++) g.ellipse(cx + (j - 2) * 26 * s, cy + Math.sin(j * 2.1) * 6 * s, 30 * s, 16 * s);
      g.fill({ color: space ? 0x6a3fb0 : dark ? 0x3a3060 : 0xffffff, alpha: space ? 0.18 : dark ? 0.55 : 0.85 });
      clouds.addChild(g);
    }
    S.bg.addChild(clouds);

    // Lo que mira la cámara: capas con paralaje y la pista.
    const range = (baseY: number, amp: number, step: number, col: number, snow: boolean, width: number): Graphics => {
      const g = new Graphics();
      const pts: number[] = [-sw, baseY];
      const peaks: [number, number][] = [];
      for (let x = -sw; x <= width; x += step * (0.6 + deco() * 0.8)) {
        const y = baseY - amp * (0.35 + deco() * 0.65);
        if (space) {
          // En el espacio no hay cordillera: hay cúpulas de una base lunar.
          pts.push(x, baseY - amp * 0.2);
        } else pts.push(x, y);
        peaks.push([x, y]);
      }
      pts.push(width, baseY, width, sh * 2, -sw, sh * 2);
      g.poly(pts).fill(col);
      if (space) for (const [x, y] of peaks) g.circle(x, baseY - amp * 0.2, (baseY - y) * 0.45).fill(dim(col, 1.3));
      if (snow && !space) {
        for (const [x, y] of peaks) {
          if (baseY - y < amp * 0.7) continue;
          g.poly([x - 22 * u, y + 20 * u, x, y, x + 22 * u, y + 20 * u, x + 8 * u, y + 14 * u, x - 6 * u, y + 18 * u]).fill(0xeef0f8);
        }
      }
      return g;
    };
    const far = new Container();
    far.addChild(range(standsTop + 10 * u, 150 * u, 90 * u, space ? 0x241a52 : dark ? 0x3b3563 : 0x8a9cc0, true, sw * 3 + TL * 0.2));
    const mid = new Container();
    mid.addChild(range(standsTop + 30 * u, 80 * u, 70 * u, space ? 0x1c1442 : dark ? 0x2a2848 : 0x6f8f6a, false, sw * 3 + TL * 0.35));
    const near = new Container();
    near.addChild(range(standsTop + 50 * u, 40 * u, 60 * u, space ? 0x150f33 : dark ? 0x201d36 : 0xb89a62, false, sw * 3 + TL * 0.5));
    S.scene.addChild(far, mid, near);

    // La tribuna con la hinchada (en el espacio, la sala de control).
    const stands = new Container();
    const standsW = TL * 0.75 + sw * 3;
    const sg = new Graphics().rect(-sw, standsTop, standsW, trackTop - standsTop + 4 * u).fill(space ? 0x1a1640 : lake ? (dark ? 0x22301d : 0x6f8445) : dark ? 0x2b2640 : 0x5b5f79);
    for (let tier = 0; tier < 3; tier++) sg.rect(-sw, standsTop + (tier + 1) * 26 * u, standsW, 4 * u).fill({ color: 0x000000, alpha: 0.28 });
    if (lake) {
      // Los totorales de la orilla, de alturas sembradas.
      for (let x = -sw, i = 0; x < standsW - sw; x += 6 * u, i++) {
        const h = (14 + hash(i, 31) * 22) * u;
        sg.rect(x, standsTop - h + 6 * u, 2.4 * u, h).fill(i % 3 ? 0xc9b25a : 0x98883c);
      }
    } else sg.rect(-sw, standsTop - 10 * u, standsW, 10 * u).fill(INK);
    stands.addChild(sg);
    const people: Texture[] = [];
    const skinTones = [0xf1c27d, 0xc68642, 0x8d5524, 0xe0ac69];
    for (let i = 0; i < 8; i++) {
      for (const up of [false, true]) {
        const g = new Graphics();
        const shirt = i < 5 ? S.color(i) : ([0xffffff, 0x2f9e44, 0x1c64c8][i - 5] ?? 0xffffff);
        g.roundRect(-4, -8, 8, 9, 2).fill(shirt);
        g.circle(0, -11, 3.4).fill(skinTones[i % skinTones.length] ?? 0xf1c27d);
        if (up) g.moveTo(-3.5, -7).lineTo(-6, -15).moveTo(3.5, -7).lineTo(6, -15).stroke({ width: 1.6, color: shirt });
        people.push(S.app.renderer.generateTexture({ target: g, resolution: 2 * Math.min(window.devicePixelRatio || 1, 2) }));
        g.destroy();
      }
    }
    const crowd: Sprite[] = [];
    const crowdBase: Layers["crowdBase"] = [];
    for (let tier = 0; tier < 3; tier++) {
      for (let x = -sw; x < standsW - sw; x += (11 + deco() * 7) * u) {
        const sp = new Sprite(people[Math.floor(deco() * 8) * 2] as Texture);
        sp.anchor.set(0.5, 1);
        sp.scale.set(u * (1.25 + tier * 0.1));
        sp.tint = tier === 0 ? 0x9a9ab0 : tier === 1 ? 0xc8c8d6 : 0xffffff;
        const y = standsTop + (tier + 1) * 26 * u;
        sp.position.set(x, y);
        stands.addChild(sp);
        crowd.push(sp);
        crowdBase.push({ x, y, ph: deco() * 6.28 });
      }
    }
    const flags = new Graphics();
    stands.addChild(flags);
    S.scene.addChild(stands);

    const world = new Container();
    S.scene.addChild(world);
    const ground = new Graphics();
    ground.rect(-sw * 2, trackTop - 6 * u, TL + sw * 5, sh * 2).fill(space ? 0x221a4e : lake ? (dark ? 0x173a5c : 0x2f86bf) : dark ? 0x3d2b22 : 0xb98552);
    for (let k = 0; k < N; k++) {
      ground.rect(-sw * 2, trackTop + k * laneH, TL + sw * 5, laneH).fill({ color: k % 2 ? 0x000000 : 0xffffff, alpha: dark ? 0.05 : 0.06 });
    }
    for (let k = 1; k < N; k++) {
      const y = trackTop + k * laneH;
      for (let x = -sw * 2; x < TL + sw * 3; x += 34 * u) ground.rect(x, y - 1, 18 * u, 2).fill({ color: space ? 0x9fe3ff : 0xffffff, alpha: space ? 0.4 : 0.28 });
    }
    if (lake) {
      // La orilla de arena y la cuerda de boyas que marca la pista.
      ground.rect(-sw * 2, trackTop - 10 * u, TL + sw * 5, 6 * u).fill(0xe6d3a3);
      ground.rect(-sw * 2, trackTop - 1 * u, TL + sw * 5, 1.6 * u).fill({ color: 0xffffff, alpha: 0.6 });
      for (let x = -sw * 2, i = 0; x < TL + sw * 3; x += 44 * u, i++) ground.circle(x, trackTop, 4.2 * u).fill(i % 2 ? 0xff7a1a : 0xffffff).stroke({ width: 1.4 * u, color: INK });
      // Crestas de ola, quietas: el movimiento lo ponen las balsas.
      for (let i = 0; i < 260; i++) {
        const wx = -sw * 2 + hash(i, 41) * (TL + sw * 5), wy = trackTop + hash(i, 42) * (trackBot - trackTop);
        ground.moveTo(wx, wy).quadraticCurveTo(wx + 7 * u, wy - 4 * u, wx + 14 * u, wy).stroke({ width: 1.6 * u, color: 0xffffff, alpha: 0.22 });
      }
    } else {
      ground.rect(-sw * 2, trackTop - 8 * u, TL + sw * 5, 4 * u).fill(space ? 0x9fe3ff : CREAM);
      for (let x = -sw * 2; x < TL + sw * 3; x += 60 * u) ground.rect(x, trackTop - 20 * u, 4 * u, 16 * u).fill(space ? 0x9fe3ff : CREAM);
      ground.rect(-sw * 2, trackTop - 20 * u, TL + sw * 5, 3 * u).fill(space ? 0x9fe3ff : CREAM);
    }
    ground.rect(X0 - 3 * u, trackTop, 6 * u, trackBot - trackTop).fill({ color: 0xffffff, alpha: 0.85 });
    const cell = 9 * u;
    for (let y = trackTop, r = 0; y < trackBot; y += cell, r++) {
      for (let c = 0; c < 3; c++) ground.rect(finishX + c * cell, y, cell, cell).fill((r + c) % 2 ? INK : 0xffffff);
    }
    world.addChild(ground);
    for (let i = 1; i < 10; i++) {
      const x = X0 + TL * (i / 10);
      // El cartel de la distancia es el del tema oscuro en los dos temas:
      // placa oscura y letra crema con contorno. En el claro era tinta sobre
      // una placa blanca justa, y la medición de pantalla la daba por no
      // leída cuando la placa quedaba detrás de la tabla, del cartel o del
      // desenfoque de la cámara. Crema con contorno sobre la placa blanca
      // empastaba la "m"; sobre la oscura se lee limpia.
      const post = new Graphics()
        .rect(x - 2 * u, trackTop - 46 * u, 4 * u, 30 * u).fill(CREAM)
        // Un banderín sin número: los "90 m" de 13 px no se leían desde el fondo y sobraban (barrido de letra, 26 de octubre de 2026).
        .rect(x - 9 * u, trackTop - 46 * u, 18 * u, 9 * u).fill(0x2b2640).stroke({ width: 2 * u, color: INK });
      world.addChild(post);
    }
    const arch = new Graphics()
      .rect(finishX - 4 * u, trackTop - 110 * u, 8 * u, 110 * u).fill(CREAM).stroke({ width: 2 * u, color: INK })
      .roundRect(finishX - 70 * u, trackTop - 138 * u, 140 * u, 34 * u, 6 * u).fill(YELLOW).stroke({ width: 3 * u, color: INK });
    const meta = S.text(getLang() === "es" ? "META" : "FINISH", { fontSize: 22 * u, fontWeight: "900", fill: INK });
    meta.anchor.set(0.5);
    meta.position.set(finishX, trackTop - 121 * u);
    world.addChild(arch, meta);

    const runners: Runner[] = [];
    const tagsLayer = new Container();
    const runnersLayer = new Container();
    for (let k = 0; k < N; k++) {
      const r = space ? makeRocket(k, G.laneScale(k)) : lake ? makeBoat(k, G.laneScale(k)) : makeLlama(k, G.laneScale(k));
      // El cuerpo se mide ahora, quieto y sin el "!" (lo invisible no cuenta):
      // la cámara encuadra con esto.
      r.caja = medirCaja(r.root);
      r.marca = Math.max(0, r.caja.y - (r.mark.y - r.mark.height));
      runners.push(r);
      runnersLayer.addChild(r.root);
      tagsLayer.addChild(r.tag);
    }
    const fx = new Graphics();
    // El nombre va encima del corredor: la cola de la llama o el fuego del
    // motor salen de atrás del chip en vez de taparlo.
    world.addChild(runnersLayer, tagsLayer, fx);

    // La interfaz: viñeta, minimapa, tabla, cuenta y foto.
    const vig = document.createElement("canvas");
    vig.width = vig.height = 256;
    const vx = vig.getContext("2d") as CanvasRenderingContext2D;
    const vg = vx.createRadialGradient(128, 128, 60, 128, 128, 182);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    vx.fillStyle = vg;
    vx.fillRect(0, 0, 256, 256);
    const vignette = new Sprite(Texture.from(vig));
    vignette.width = sw;
    vignette.height = sh;
    S.hud.addChild(vignette);
    const mini = new Graphics();
    S.hud.addChild(mini);
    const board = new Container();
    const rows: Container[] = [];
    // La tabla con la letra de la sala (28 px en 1080): renglones de 31 y ancho de 228 (barrido de letra, 26 de octubre de 2026).
    const rowH = 31 * u;
    for (let k = 0; k < N; k++) {
      const r = new Container();
      // Opaca: con transparencia, la tribuna de colores se veía a través del nombre.
      const bgr = new Graphics().roundRect(0, 0, 228 * u, rowH - 3 * u, 4 * u).fill(INK);
      const num = new Graphics().roundRect(2 * u, 2 * u, 18 * u, rowH - 7 * u, 3 * u).fill(S.color(k));
      // El puesto en crema con contorno: sobre el color de la llama, el negro solo no se leía a 4,5 a 1 (la medición de pantalla, 720 de alto).
      const pos = S.text("", { fontSize: S.letra(14), fontWeight: "900", fill: CREAM, stroke: { color: INK, width: 3 * u } });
      pos.anchor.set(0.5);
      pos.position.set(11 * u, (rowH - 3 * u) / 2);
      const av = new Sprite(emblemaCara?.(lanes[k] as number, 64) ?? S.face(nameOf(k)));
      av.width = av.height = 14 * u;
      av.position.set(24 * u, 6.5 * u);
      const nm = S.text(shorten(nameOf(k), 16), { fontSize: S.letra(LEGIBLE.sec), fontWeight: "700", fill: CREAM });
      nm.position.set(42 * u, 3.5 * u);
      r.addChild(bgr, num, pos, av, nm);
      board.addChild(r);
      rows.push(r);
    }
    board.position.set(12 * u, S.top() + 40 * u);
    board.visible = !G.portrait;
    S.hud.addChild(board);
    // Con más de ocho corren ocho. El motor anterior lo avisaba y este no: con
    // 200 inscritos, 192 no sabían si estaban (auditoría, 4 de octubre de 2026).
    // Desde la clasificatoria se ven todos antes; el aviso queda para la carrera.
    let avisoBox: Container | null = null;
    if (names.length > N) {
      // En la pantalla ancha, a la letra de los nombres de la tabla: a 11 y a 14
      // se leía como de 9 píxeles desde el fondo (revisión visual, 21 de octubre
      // de 2026). En el celular ocupa el ancho entero y no puede crecer.
      const aviso = S.text(T[getLang()].cLanes(N, names.length), { fontFamily: MONO, fontSize: S.letra(LEGIBLE.sec), fontWeight: "800", fill: CREAM, wordWrap: true, wordWrapWidth: Math.max(120, G.sw - 36 * u) });
      const pad = 6 * u;
      aviso.position.set(pad, pad / 2);
      // Sobre la tribuna, sin fondo, no se leía.
      const caja = new Container();
      // Con 0,72, sobre las camisetas claras de la tribuna la letra quedaba por debajo de 4,5 a 1.
      caja.addChild(new Graphics().roundRect(0, 0, aviso.width + pad * 2, aviso.height + pad, 4 * u).fill({ color: INK, alpha: 0.92 }), aviso);
      caja.position.set(12 * u, S.top() + (G.portrait ? 8 : 12) * u);
      S.hud.addChild(caja);
      avisoBox = caja;
    }
    const count: Text[] = ["3", "2", "1", getLang() === "es" ? "¡YA!" : "GO!"].map((s) => {
      const tx = S.text(s, {
        fontSize: 190 * u, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 18 * u },
        dropShadow: { color: INK, distance: 10 * u, angle: Math.PI / 4, blur: 0, alpha: 1 },
      });
      tx.anchor.set(0.5);
      tx.position.set(sw / 2, sh * 0.42);
      tx.alpha = 0;
      S.hud.addChild(tx);
      return tx;
    });
    const foto = new Container();
    foto.addChild(new Graphics().rect(0, 0, sw, sh * 0.1).fill(INK).rect(0, sh * 0.9, sw, sh * 0.1).fill(INK));
    const fotoTx = S.text(getLang() === "es" ? "● FOTO" : "● PHOTO", { fontFamily: MONO, fontSize: 26 * u, fontWeight: "900", fill: 0xff4d4d, letterSpacing: 6 * u });
    // A la derecha, donde la franja está libre: a la izquierda se encimaba con
    // el aviso de cuántos corren.
    fotoTx.position.set(sw - fotoTx.width - 24 * u, sh * 0.1 + 12 * u);
    foto.addChild(fotoTx);
    foto.visible = false;
    S.hud.addChild(foto);

    L = { far, mid, near, stands, world, crowd, crowdBase, people, flags, fx, runners, clouds, sun, mini, rows, count, foto, board, aviso: avisoBox, qual: buildQual(), pelo: null, destello: null };
    if (peloton && !peloRoto) try {
      // `?pelotonFalla=armar|dibujo`: rompe el pelotón a propósito, para comprobar que la carrera sigue.
      if (params.get("pelotonFalla") === "armar") throw new Error("falla de prueba al armar el pelotón");
      const pel = crearPeloton({
        S, names, plan: peloton, lanes, ronda: beacon.randomness, dark, dicho: peloDicho,
        emblema: dibujoEmblemas ? (e, lado) => dibujoEmblemas?.emblemaCanvas(e, lado) ?? null : undefined,
        geo: () => ({ sw: G.sw, sh: G.sh, u: G.u, portrait: G.portrait, trackTop: G.trackTop, trackBot: G.trackBot }),
        llama: (persona, sc, manta, dorsal) => makeLlama(0, sc, { persona, manta, dorsal }),
        destino: (k) => {
          const r = L.runners[k];
          return r ? cam.toScreen(r.tag.x, r.tag.y, G.sw, G.sh) : null;
        },
        laneAt,
        decir: (msg, heat) => {
          S.say(msg, heat);
          lastSayAt = tReal;
        },
      });
      S.scene.addChild(pel.escena);
      const destello = new Graphics().rect(0, 0, sw, sh).fill(CREAM);
      destello.alpha = 0;
      // El destello va encima de las fichas: si no, las de los finalistas quedan nítidas sobre el fondo claro.
      S.hud.addChild(pel.hud, destello);
      L.pelo = pel;
      L.destello = destello;
    } catch (err) {
      // Si el pelotón no se puede armar, el show sigue con la final: nunca se queda sin sorteo.
      pelotonRoto(err);
    }
    choreograph();
  }

  /** Una llamita pixelada del color de la lana de cada uno, en una moneda clara: se ve sobre el fondo oscuro con cualquier lana. */
  function llamaIcon(fur: number): Graphics {
    const g = new Graphics().circle(0, 0, 15).fill(CREAM).stroke({ width: 2, color: INK });
    const partes: [number, number, number, number][] = [
      [2, 11, 16, 7], [15, 3, 4, 10], [14, 0, 8, 4], [20, -2, 2, 3], [0, 9, 3, 4],
      [3, 18, 2.5, 5], [8, 18, 2.5, 5], [12.5, 18, 2.5, 5], [16, 18, 2.5, 5],
    ];
    const s = 0.82;
    for (const [x, y, w, h] of partes) g.rect((x - 11) * s + 1, (y - 10.5) * s + 1, w * s, h * s).fill(INK);
    for (const [x, y, w, h] of partes) g.rect((x - 11) * s, (y - 10.5) * s, w * s, h * s).fill(fur);
    return g;
  }

  /**
   * La clasificatoria: todos los nombres en una grilla, cada uno con su llama,
   * del tamaño que entre. Se arma de nuevo si cambia el tamaño de la pantalla;
   * los tiempos no dependen de eso.
   */
  function buildQual(): Qual {
    const { sw, sh, u } = G;
    const root = new Container();
    const dim = new Graphics().rect(0, 0, sw, sh).fill({ color: INK, alpha: 0.82 });
    const head = new Container();
    const strikes = new Graphics();
    root.addChild(dim, head);
    const q: Qual = { root, dim, head, count: null, strikes, cells: [], at: [], ends: [], chipDx: 0, scale: 1 };
    root.visible = false;
    S.hud.addChild(root);
    if (!waves.length) return q;
    const L_ = T[getLang()];
    const title = S.text(L_.rqTitle, { fontSize: (G.portrait ? 30 : 44) * u, fontWeight: "900", fill: YELLOW, stroke: { color: INK, width: 8 * u }, letterSpacing: 2 * u });
    title.anchor.set(0.5, 0);
    title.position.set(sw / 2, S.top() + 8 * u);
    const sub = S.text(L_.rqSub(names.length, N), { fontFamily: MONO, fontSize: (G.portrait ? 12 : 15) * u, fontWeight: "800", fill: CREAM });
    sub.anchor.set(0.5, 0);
    sub.position.set(sw / 2, title.y + title.height + 2 * u);
    const count = S.text("", { fontFamily: MONO, fontSize: (G.portrait ? 12 : 14) * u, fontWeight: "900", fill: YELLOW, letterSpacing: 2 * u });
    count.anchor.set(0.5, 0);
    count.position.set(sw / 2, sub.y + sub.height + 6 * u);
    head.addChild(title, sub, count);
    q.count = count;
    // La grilla: la escala más grande en la que entran todos. Cada columna mide
    // lo que su nombre más largo, con chips armados una vez al tamaño de
    // siempre y la celda entera escalada. Con celdas fijas de 210 por 36, los
    // chips de letra legible se salían de su celda y se pisaban con la de al
    // lado (16 de octubre de 2026).
    const top = count.y + count.height + 14 * u, bottom = sh - S.bottom() - 12 * u;
    const areaW = sw * 0.95, areaH = Math.max(40 * u, bottom - top);
    /** De la llama al chip, y del borde de la celda a la llama. */
    const dx = 20 * u, lead = 17 * u, gapX = 14 * u;
    const built = names.map((nm, i) => {
      const cell = new Container();
      const icon = llamaIcon(FUR[i % FUR.length] ?? 0xf3ead8);
      icon.scale.set(u);
      const c = S.chip(shorten(nm, 18), 1, nm);
      c.position.set(dx, 0);
      cell.addChild(icon, c);
      return { cell, w: lead + dx + c.width + gapX, end: dx + c.width };
    });
    const ch = (built[0]?.cell.height ?? 40 * u) + 6 * u;
    /** Lo ancho de cada columna con `cols` columnas: lo que mide su nombre más largo. */
    const widths = (cols: number): number[] => {
      const out = new Array<number>(cols).fill(0);
      built.forEach((b, i) => { out[i % cols] = Math.max(out[i % cols] as number, b.w); });
      return out;
    };
    let best = { cols: 1, s: 0 };
    // Más de 60 columnas no entran en ninguna pantalla, y con miles de nombres
    // probarlas todas costaba más que armar la grilla.
    for (let cols = 1; cols <= Math.min(names.length, 60); cols++) {
      const rows = Math.ceil(names.length / cols);
      const s = Math.min(1.25, areaW / widths(cols).reduce((a, w) => a + w, 0), areaH / (rows * ch));
      if (s > best.s) best = { cols, s };
    }
    const s = best.s, cols = best.cols, rows = Math.ceil(names.length / cols);
    const colW = widths(cols);
    const colX: number[] = [];
    colW.reduce((x, w) => (colX.push(x), x + w), 0);
    const x0 = (sw - colW.reduce((a, w) => a + w, 0) * s) / 2, y0 = top + (areaH - rows * ch * s) / 2;
    q.chipDx = dx * s;
    built.forEach(({ cell, end }, i) => {
      cell.scale.set(s);
      const at = { x: x0 + ((colX[i % cols] ?? 0) + lead) * s, y: y0 + (Math.floor(i / cols) + 0.5) * ch * s };
      cell.position.set(at.x, at.y);
      root.addChild(cell);
      q.cells.push(cell);
      q.at.push(at);
      q.ends.push(end * s);
    });
    q.scale = s;
    root.addChild(strikes);
    return q;
  }

  /* ========================================================= coreografía */
  const tlCount = gsap.timeline({ paused: true });
  S.onCleanup(() => tlCount.kill());
  function choreograph(): void {
    tlCount.clear();
    L.count.forEach((tx, i) => {
      tlCount
        .fromTo(tx.scale, { x: 2.6, y: 2.6 }, { x: 1, y: 1, duration: 0.45, ease: "back.out(2.2)" }, i)
        .fromTo(tx, { alpha: 0 }, { alpha: 1, duration: 0.08 }, i)
        .to(tx, { alpha: 0, duration: 0.25 }, i + (i === 3 ? 0.55 : 0.75));
    });
  }

  build();
  const crown = S.crown(names, winners, false, emblemaCara ? (persona) => emblemaCara(persona, 256) : undefined);
  S.onResize(() => {
    build();
    // La cámara conserva lo que mira: solo cambia el tamaño.
  });

  /* ============================================================== estado */
  let phase: "pre" | "count" | "race" | "done" = "pre";
  let tPhase = 3 - CUENTA, tRace = 0, tFreeze = 0, lastLeader = -1, saidLast = false, finished = false, mitadMarcada = false;
  /** El empuje del zoom de emoción, desde el 80 % de la carrera: una sola vez. */
  let empujeDado = false;
  /** El reloj de la clasificatoria y la presentación, en segundos de juego. */
  let tPre = 0;
  /** El pelotón ya se abrió y la cámara ya hizo su corte a la largada. */
  let cortada = false;
  /** Segundos reales desde la largada, para el "¡YA!", que antes no llegaba a verse: la cuenta terminaba justo cuando aparecía. */
  let tGo = -1;
  /** El reloj de la sala, en segundos reales: el del relator. `tRace` va en segundos de juego y se frena en la foto. */
  let tReal = 0;
  let hushed = false;
  let lastBeepN = 4;
  const rowPos = lanes.map((_, k) => k);
  /** El orden de la llegada, de la primera a la última: el de la tabla en la corona. */
  const ordenFinal = lanes.map((_, k) => k).sort((a, b) => plan.pos(b, 1) - plan.pos(a, 1) || a - b);
  const winnerLane = story.winner;
  /**
   * `?auditar=encuadre`, para `scripts/audit-encuadre.mjs`: en la recta final,
   * en la foto y en la corona, dónde cae el cuerpo de cada llama en la pantalla
   * (sin el nombre), cuál gana y dónde está la zona de la corona. El auditor
   * comprueba que la ganadora quede entera y que el cartel no tape a ninguna.
   */
  const auditoria = params.get("auditar") === "encuadre"
    ? {
      n: N,
      ganadora: story.winner,
      rival: story.rival,
      arco: story.arc,
      muestras: [] as { t: number; fase: string; z: number; cajas: number[][]; zona: number[]; cartel: number[] | null; relator: number[] | null }[],
      listo: false,
    }
    : null;
  if (auditoria) (window as unknown as { __encuadre: typeof auditoria }).__encuadre = auditoria;
  let cuadroAud = 0;
  const qNow = (): number => Math.min(1, tRace / DUR);
  // `?auditar=nino`: la prueba del niño (`scripts/audit-nino.mjs`) lee del plan quién va adelante, hacia dónde, cuánto falta y qué pasó. Solo lee: es el caso de control, la carrera de hoy.
  {
    const planNino: PlanDeLaCarrera = { lanes, ganador: story.winner, pos: plan.pos, beats: story.beats, pre: PRE, cuenta: CUENTA, dur: DUR, peloton };
    const reloj = () => ({ fase: phase, tPre, tPhase, tRace, tFreeze });
    exponerNino({
      duracion: duracionDeLaCarrera(planNino),
      t: () => horaDeLaCarrera(planNino, reloj()),
      verdad: () => {
        const r = respuestasCarrera(planNino, reloj());
        // En la pista y con el cartel, en qué parte de la pantalla cae la que va adelante: lo decide la cámara, que el plan no conoce.
        const corredor = phase === "race" || phase === "done" ? L?.runners[lanes.indexOf(r.adelante.quienes[0] as number)] : undefined;
        if (!corredor?.root.parent) return r;
        const p = corredor.root.getGlobalPosition();
        return { ...r, adelante: { ...r.adelante, lugar: lugarDe(p.x, p.y, S.sw(), S.sh()) } };
      },
    });
  }
  const xOf = (k: number, q: number): number => G.X0 + plan.pos(k, q) * G.TL;

  // Arranca pegada a la largada.
  /**
   * El plano de la largada: los ocho carriles enteros, del nombre del primero
   * a las patas del último. A 1,55 fijo (el de antes) los dos de abajo
   * quedaban fuera, y en la presentación cada carril tiene que verse entrar.
   */
  const largada = (): { x: number; y: number; z: number } => {
    const arriba = G.laneY(0) - 100 * G.laneScale(0);
    const abajo = G.trackBot + 6 * G.u;
    const alto = G.sh - S.top() - S.bottom() - 70 * G.u;
    // De punta a punta: del nombre más largo (va a la izquierda de su llama) al hocico.
    const nombre = Math.max(0, ...(L?.runners ?? []).map((r) => r.tag.width));
    const izq = G.X0 - (space ? 82 : lake ? 86 : 70) * G.laneScale(N - 1) - nombre - 14 * G.u;
    const der = G.X0 + 70 * G.u;
    const z = Math.max(0.7, Math.min(G.portrait ? 1.3 : 1.55, alto / Math.max(1, abajo - arriba), G.sw / Math.max(1, der - izq)));
    // En celular, centrado en la largada; en la pantalla grande, la largada a
    // la izquierda y la pista libre a la derecha, sin dejar afuera un nombre.
    const x = G.portrait ? (izq + der) / 2 : Math.min(G.X0 + 60 * G.u, izq + G.sw / (2 * z) - 10 * G.u);
    return { x, y: (arriba + abajo) / 2, z };
  };
  if (peloton) cam.cut(G.sw / 2, G.sh / 2, 1);
  else {
    const l = largada();
    cam.cut(l.x, l.y, l.z);
  }

  skipFn = (): void => {
    if (finished) return;
    phase = "race";
    tRace = DUR;
    finishNow();
  };

  function finishNow(): void {
    finished = true;
    phase = "done";
    tFreeze = 0;
    // Desde el golpe mismo: ningún acercamiento la corta ni la mete debajo del cartel.
    protegerGanadora();
    // Un corte debajo del destello, a un plano apenas más abierto que el de la
    // corona, y desde ahí la cámara se acerca despacio hasta él. Viajando desde
    // la recta final, en el camino el cartel tapaba un rato a las de arriba.
    const corona = planoCorona();
    cam.cut(corona.x, corona.y, corona.z * 0.92);
    S.say(T[getLang()].cWin(winnersLabel(names, winners), winners.length > 1), 1);
    fanfare();
    // La tribuna explota con la ganadora: venía callada desde el respiro.
    roar?.burst();
    // El golpe del zoom de emoción: el acercamiento firme que vuelve suave, en
    // el mismo instante en que sale el cartel. Solo presentación.
    S.mark("golpe", cam.golpe(0.12, 0.3, 1.1).toFixed(3));
    cam.shake(14 * G.u);
  }

  const roar = space ? null : crowdNoise();

  /* ---------------------------------------------------------------- relato */
  const fired = new Set<string>();
  let lastSayAt = -99;
  let lastHeat = 0;
  function sayIf(msg: string, heat: number): boolean {
    // En segundos reales. Hasta el 7 de octubre de 2026 era `tRace / pace`,
    // al revés: el espacio entre líneas daba 2,8 s en "normal" y 5,3 s en
    // "épico", y el relator se tragaba el mano a mano, las historias chicas y
    // la última recta (lo encontró la auditoría con capturas).
    const now = tReal;
    if (now - lastSayAt < 1.1 && heat < lastHeat + 0.3) return false;
    lastSayAt = now;
    lastHeat = heat;
    S.say(msg, heat);
    return true;
  }
  const key = (base: string): string => `${base}${voice}`;
  let latido = -1;
  /** El momento de la historia que la cámara está mirando, y hasta cuándo. */
  let shot: { k: number; until: number; zoom: number } | null = null;
  /**
   * La línea de un momento de la historia que no entró porque otra recién
   * salió: espera su turno mientras el momento se ve. Si no, en pantalla
   * Elena escupía y el subtítulo hablaba de otra.
   */
  let enEspera: { msg: string; heat: number; hasta: number } | null = null;
  function storyBeats(prog: number): void {
    const L_ = T[getLang()];
    const calor = 0.35 + 0.5 * tension(story, prog);
    if (enEspera && (prog >= enEspera.hasta || sayIf(enEspera.msg, enEspera.heat))) enEspera = null;
    story.beats.forEach((bt, n) => {
      const id = `b${n}`;
      if (prog < bt.at || fired.has(id)) return;
      fired.add(id);
      const quien = nameOf(bt.actor);
      // La cámara se mete en cada momento de la historia.
      shot = { k: bt.target ?? bt.actor, until: prog + 0.06, zoom: bt.kind === "tropiezo" ? 1.7 : 1.5 };
      const contar = (msg: string, heat: number): void => {
        if (sayIf(msg, heat)) return;
        if (!enEspera || heat >= enEspera.heat) enEspera = { msg, heat, hasta: bt.at + 0.06 };
      };
      if (bt.kind === "plantada") {
        contar((L_[key("cPlantada")] as (n: string) => string)(quien), calor);
        beep(note(8), 0.12, "triangle", 0.045);
        setTimeout(() => beep(note(3), 0.16, "triangle", 0.04), 120);
      } else if (bt.kind === "tropiezo") {
        // Un tropiezo sube el tono igual sea de quien sea: con la ganadora más
        // fuerte, la música se cortaba justo cuando tropezaba ella.
        contar((L_[key("cTropiezo")] as (n: string) => string)(quien), Math.min(0.85, calor + 0.15));
        beep(note(1), 0.09, "square", 0.05);
        cam.punch(0.06).shake(8 * G.u);
      } else if (bt.kind === "pique") {
        contar((L_[key("cPique")] as (n: string) => string)(quien), calor);
        [10, 12, 14].forEach((g, i) => setTimeout(() => beep(note(g), 0.08, "triangle", 0.04), i * 60));
      } else if (bt.kind === "escupida" && bt.target !== undefined) {
        const tapada = story.arc === "tapada" && bt.actor === story.rival;
        contar((L_[key("cEscupida")] as (a: string, b: string) => string)(quien, nameOf(bt.target)), tapada ? 0.8 : calor);
        beep(note(16), 0.05, "square", 0.035);
        setTimeout(() => beep(note(11), 0.07, "triangle", 0.035), 50);
        cam.punch(0.04);
      }
    });
    const once = (id: string, at: number, fn: () => void): void => {
      if (prog >= at && !fired.has(id)) {
        fired.add(id);
        fn();
      }
    };
    /**
     * Las líneas del arco no se pierden: si otra recién salió, esperan su
     * turno. El texto se arma una sola vez, porque cada variante sorteada
     * consume azar, y se da por dicho recién cuando sale (o pasado el plazo).
     */
    const arco = (id: string, at: number, heat: number, make: () => string): boolean => {
      if (prog < at || fired.has(id)) return false;
      const msg = (arcMsg[id] ??= make());
      if (sayIf(msg, heat) || prog > at + 0.1) {
        fired.add(id);
        return true;
      }
      return false;
    };
    const ganadora = nameOf(story.winner);
    const rival = nameOf(story.rival);
    // La remontada nombra a las dos que vienen de atrás, en orden alfabético:
    // nombrando solo a la ganadora, "¡X viene de atrás!" la anunciaba en todas
    // las remontadas (auditor de delatores, 21 de octubre de 2026).
    if (story.arc === "remontada") {
      const dicho = arco("arco", 0.74, 0.8, () => (plan.decoy >= 0 ? L_.cRemonta2(...enOrden(ganadora, nameOf(plan.decoy))) : L_.cRemonta(ganadora)));
      // Y la cámara va a una de las dos, sorteada.
      if (dicho && plan.decoy >= 0) shot = { k: plan.foco, until: Math.max(prog + 0.05, 0.79), zoom: 1.5 };
    }
    if (story.arc === "duelo") {
      arco("arco", 0.52, 0.7, () => L_.cDuelo(...enOrden(ganadora, rival)));
      once("foto", plan.foto, () => {
        cam.punch(0.08);
        beep(note(18), 0.03, "square", 0.05);
        setTimeout(() => beep(note(18), 0.03, "square", 0.04), 90);
      });
      arco("fotoTx", plan.foto, 0.95, () => t("cFoto"));
    }
    // En la tapada se cuela la que nadie nombró, y tampoco se la nombra ahora:
    // "¡Y se cuela X!" la anunciaba en todas las tapadas.
    if (story.arc === "tapada") arco("arco", 0.88, 0.9, () => t("cCuelaAnon"));
    // En la recta final la tribuna grita por una, sorteada entre todas: la
    // última que se nombra sola ya no es siempre la que gana ni la que pierde.
    arco("hinchada", 0.84, 0.75, () => L_.cHinchada(nameOf(plan.hinchada)));
    // El latido del mano a mano: dos golpes con armónicos (un seno solo en el
    // piso del registro no pasaba por el parlante de un proyector), que se
    // apuran en la recta y siguen en la foto. Cuenta en tiempo de juego, así
    // que en la cámara lenta suena "tum… tum…" solo. La fase es continua en
    // el cambio de ritmo: con un contador nuevo se disparaba doble.
    if (story.arc === "duelo" && prog > 0.52 && prog < 1) {
      const s = (prog - 0.52) * DUR, s8 = (0.8 - 0.52) * DUR;
      const b = Math.floor(s <= s8 ? s / 0.45 : s8 / 0.45 + (s - s8) / 0.3);
      if (b !== latido) {
        latido = b;
        beep(note(0), 0.09, "square", 0.035);
        beep(note(5), 0.08, "triangle", 0.045);
        setTimeout(() => beep(note(3), 0.07, "triangle", 0.04), 140);
      }
    }
  }
  /** El texto de cada línea del arco, sorteado una sola vez. */
  const arcMsg: Record<string, string> = {};
  /** Cuándo dice el relator las líneas fijas: la del arco, la última recta y la foto. */
  const hitos = [0.8, 0.84, plan.foto, ...(story.arc === "remontada" ? [0.74] : story.arc === "duelo" ? [0.52] : story.arc === "tapada" ? [0.88] : [])];

  let hoofIn = 0, hoofStep = 0, droneIn = 0;
  function raceAudio(dt: number, prog: number): void {
    if (prog > 0.975) return;
    hoofIn -= dt;
    if (hoofIn <= 0) {
      hoofIn = prog > 0.8 ? 0.16 : 0.25;
      beep(note(hoofStep % 2 === 0 ? 0 : 3), 0.05, space ? "sawtooth" : lake ? "sine" : "square", 0.022);
      hoofStep++;
    }
    droneIn -= dt;
    if (droneIn <= 0) {
      droneIn = 0.7;
      beepFor(note(prog > 0.8 ? 4 : prog > 0.45 ? 2 : 0), 0.78, "sawtooth", 0.02);
    }
  }

  /* ---------------------------------------------------------- el guion */
  /**
   * El cuerpo de la llama del carril `k` en el mundo, cuando va por `q` de la
   * carrera: lo que se dibuja sin el nombre. `salto` le suma arriba lo que sube
   * la ganadora cuando festeja.
   */
  function cuerpo(k: number, q: number, salto = 0): Caja {
    const r = L.runners[k] as Runner;
    const c = (r.caja ??= medirCaja(r.root));
    const sc = G.laneScale(k);
    const x = G.X0 + plan.pos(k, q) * G.TL - 34 * sc;
    return { x: x + c.x * sc, y: G.laneY(k) + c.y * sc - salto, w: c.w * sc, h: c.h * sc + salto };
  }
  /** Un poco más grande que lo que se mira: lugar para el empuje y el golpe de la cámara sin cortarlo. */
  const holgado = (c: Caja): Caja => crecer(c, c.w * 0.05, c.h * 0.05);
  /**
   * Una zona con al menos un cuarto del alto de la pantalla, estirada hacia
   * arriba: en una pantalla bajísima, entre el cartel y el relator no quedaba
   * lugar, y la cámara se habría alejado hasta dejar todo como un punto.
   */
  const conAlto = (z: Zona): Zona => ({ ...z, y0: Math.max(0, Math.min(z.y0, z.y1 - 0.25 * G.sh)) });
  /** Donde se ve la carrera: debajo de la barra del recorrido, encima del relator y sin pegarse a los costados. */
  const zonaCarrera = (): Zona => conAlto({ x0: 8 * G.u, y0: S.top() + 30 * G.u, x1: G.sw - 8 * G.u, y1: G.sh - S.bottom() - 6 * G.u });
  /** Donde va todo en la corona: debajo del cartel, encima del relator y a `m` de los costados. */
  const zonaCorona = (m: number): Zona => conAlto({ x0: m, y0: S.placaBajo(winners.length) + m, x1: G.sw - m, y1: G.sh - S.bottom() - m });

  /**
   * La cámara de todos los días, sin dejar el primer carril debajo de la
   * barra de arriba: la barra del recorrido cruzaba el chip del carril 1 y el
   * recuadro del número público tapaba su nombre (lo encontró la revisión
   * visual). Los primeros planos no pasan por acá: miran lo que tienen que
   * mirar aunque el carril 1 quede fuera.
   *
   * Con `sujeto`, eso se ve entero: si no entra, la cámara se aleja, y si se
   * sale por un costado, se corre lo justo. Con pocas personas cada llama mide
   * más de dos carriles de alto, y los acercamientos pensados para ocho las
   * cortaban (21 de octubre de 2026). Con ocho entra y nada cambia.
   */
  function look(x: number, y: number, z: number, rate: number, sujeto?: Caja): void {
    const techo = S.top() + 46 * G.u;
    const cabeza = G.laneY(0) - 78 * G.laneScale(0);
    let v: Vista = { x, y: Math.min(y, cabeza - (techo - G.sh / 2) / z), z };
    if (sujeto) v = dentro(holgado(sujeto), zonaCarrera(), v, G.sw, G.sh);
    cam.lookAt(v.x, v.y, v.z, rate);
  }

  /**
   * La foto del duelo: las dos enteras, de donde van hasta la meta, y debajo
   * de donde va a salir el cartel, así la corona no tiene que moverlas. Las dos
   * por igual, sin mirar cuál gana: la cámara no delata a nadie. Hasta el 21 de
   * octubre de 2026 la foto se medía con la llama ganadora y miraba la meta, y
   * con pocas personas cortaba a las dos contra el borde.
   */
  function planoFoto(prog: number): Vista {
    const zona = zonaCorona(12 * G.u);
    const duo = [story.winner, story.rival];
    const caja = unir(duo.flatMap((k) => [cuerpo(k, prog), cuerpo(k, 1)]));
    const alta = Math.max(...duo.map((k) => cuerpo(k, 1).h));
    const z = Math.min(G.portrait ? 1.8 : 2.1, cabe(holgado(caja), zona), (0.78 * (zona.y1 - zona.y0)) / alta);
    // Con aire hacia la meta, si entra: centrada, en el medio de la pantalla
    // quedaba el nombre de la que llegaba primera.
    const v = centrar(caja, zona, G.sw, G.sh, z);
    return dentro(holgado(caja), zona, { ...v, x: v.x + 40 * G.u }, G.sw, G.sh);
  }

  /**
   * El plano de la corona. La ganadora va entera debajo del cartel y encima
   * del relator, y ninguna otra llama queda debajo del cartel. Con cinco o
   * menos se ven todas enteras, como en la foto de una llegada; con más, la
   * ganadora y las de los carriles de arriba, que son las únicas que podrían
   * quedar debajo del cartel (las de abajo tienen la cabeza más abajo que ella).
   *
   * El acercamiento sale del alto y del ancho de la pantalla: el grupo entra de
   * alto, la ganadora no pasa del 78% del alto ni del 62% del ancho (queda lugar
   * para el golpe de la meta) y, como antes, no pasa de 1,6 (1,35 en vertical).
   * Hasta el 21 de octubre de 2026 se medía solo a la ganadora, y con tres o
   * cuatro llamas quedaba cortada contra el borde del celular mientras el
   * cartel tapaba a la del carril de arriba (feedback de Alejandro, 19 de octubre).
   */
  function planoCorona(): Vista {
    const zona = zonaCorona(12 * G.u);
    const zw = zona.x1 - zona.x0, zh = zona.y1 - zona.y0;
    const ganadora = cuerpo(winnerLane, 1, SALTO * G.u);
    const todas = N <= 5;
    const grupo = unir(lanes.map((_, k) => k).filter((k) => todas || k <= winnerLane).map((k) => (k === winnerLane ? ganadora : cuerpo(k, 1))));
    const z = Math.max(0.3, Math.min(G.portrait ? 1.35 : 1.6, (0.78 * zh) / ganadora.h, (0.62 * zw) / ganadora.w, zh / grupo.h));
    const v = centrar(grupo, zona, G.sw, G.sh, z);
    // Con muchas, pegadas al cartel: debajo quedan las demás, que no tapa nadie.
    if (!todas) v.y = grupo.y - (zona.y0 - G.sh / 2) / z;
    // Y la ganadora siempre entera: si el grupo no entra de ancho, se cortan las de atrás.
    return dentro(ganadora, zona, v, G.sw, G.sh);
  }

  /**
   * Desde que se revela, la cámara protege a la ganadora: entera, con su salto,
   * debajo del cartel y encima del relator, con cualquier acercamiento (el
   * golpe de la meta, el sacudón, el zoom de emoción). Nunca antes: protegerla
   * antes de la meta sería delatarla.
   */
  function protegerGanadora(): void {
    cam.proteger(cuerpo(winnerLane, 1, SALTO * G.u), zonaCorona(3 * G.u));
  }

  /** Lo de antes de la cuenta: la clasificatoria (si hay) y la presentación de los carriles. */
  const dichoPre = new Set<string>();
  function preUpdate(dt: number): void {
    tPre += dt;
    tReal += dt * paceFactor();
    const L_ = T[getLang()];
    const once = (id: string, at: number, fn: () => void): void => {
      if (tPre >= at && !dichoPre.has(id)) {
        dichoPre.add(id);
        fn();
      }
    };
    if (waves.length) {
      once("q", 0.1, () => {
        sayIf(L_.rqStart(names.length, N), 0.3);
        // La tabla entra con su campanita: sin ella, entre el último número de
        // la tarjeta y la primera tanda de eliminados pasaban más de cuatro
        // segundos sin un efecto (lo marcaba el auditor de sonido).
        [10, 12, 15].forEach((d, i) => setTimeout(() => beep(note(d), 0.1, "triangle", 0.045), i * 90));
      });
      waves.forEach((w, wi) => once(`w${wi}`, Q_SHOW + wi * Q_WAVE + 0.55, () => {
        const quedan = names.length - waves.slice(0, wi + 1).reduce((a, x) => a + x.length, 0);
        S.say(L_.rqLeft(quedan, N), 0.35 + 0.15 * wi);
        lastSayAt = tReal;
        for (let i = 0; i < Math.min(6, 2 + w.length); i++) setTimeout(() => beep(note(3 - i), 0.05, "square", 0.03), i * 80);
      }));
    } else once("intro", T_LANES + 0.05, () => sayIf(L_.rqIntro, 0.3));
    // El pelotón: sus sonidos y sus subtítulos.
    if (peloton && !peloRoto) {
      try {
        L.pelo?.actualizar(tPre);
      } catch (err) {
        pelotonRoto(err);
      }
    }
    // Si el pelotón no se pudo armar, no hay nada que esperar.
    if (peloton && (peloRoto || !L.pelo) && tPre < T_LANES) tPre = T_LANES;
    // Cada carril entra con su nota, de abajo hacia arriba del pentagrama.
    for (let k = 0; k < N; k++) once(`l${k}`, laneAt(k), () => beep(note(5 + k), 0.09, "triangle", 0.045));
    once("listos", Math.max(laneAt(N - 1), PRE - 0.55), () => {
      S.say(listos, 0.45);
      lastSayAt = tReal;
    });
    // La cámara, quieta sobre la largada mientras entran. Con el pelotón, quieta y
    // de frente hasta que se abre, y entonces de un corte a la largada, debajo del destello.
    if (peloton && tPre < T_LANES) cam.lookAt(G.sw / 2, G.sh / 2, 1, 6);
    else {
      const l = largada();
      if (peloton && !cortada) {
        cortada = true;
        cam.cut(l.x, l.y, l.z);
      }
      cam.lookAt(l.x, l.y, l.z, 2);
    }
    if (tPre >= PRE) phase = "count";
  }

  function update(dt: number): void {
    if (phase === "pre") {
      preUpdate(dt);
      return;
    }
    if (phase === "count") {
      tPhase += dt * paceFactor();
      const n = 3 - Math.floor(tPhase);
      if (n < lastBeepN && n >= 1) {
        lastBeepN = n;
        beep(note(n === 3 ? 9 : n === 2 ? 10 : 12), 0.18, "triangle", 0.06);
        cam.punch(0.03);
      }
      // En la cuenta la cámara se va abriendo de a poco, sobre la largada.
      // Desde el plano de la presentación, abriéndose de a poco hacia la pista.
      const l = largada();
      // En celular, quieta: corrida, dejaba los nombres contra el borde.
      cam.lookAt(l.x + (G.portrait ? 0 : G.sw * 0.04 * Math.min(3, tPhase)), l.y, l.z - (G.portrait ? 0 : 0.05 * Math.min(3, tPhase)), 2);
      if (tPhase >= 3) {
        phase = "race";
        tGo = 0;
        S.say(t("cStart"), 0.6);
        beep(note(14), 0.45, "square", 0.055);
        beep(note(9), 0.45, "square", 0.055);
        cam.punch(0.08).shake(6 * G.u);
      }
      return;
    }
    if (phase === "done") {
      tFreeze += dt * paceFactor();
      // La tabla termina de acomodarse en el orden de la llegada: si dos filas
      // se estaban cruzando cuando la ganadora llegó, quedaban a mitad de
      // camino, una encima de la otra, toda la corona (revisión visual, 21 de
      // octubre de 2026).
      ordenFinal.forEach((k, puesto) => { rowPos[k] = (rowPos[k] as number) + (puesto - (rowPos[k] as number)) * Math.min(1, dt * 10); });
      // Con la ganadora ya en la meta, la cámara llega despacio al plano de la
      // corona: ella entera debajo del cartel y ninguna otra tapada por él.
      const corona = planoCorona();
      cam.lookAt(corona.x, corona.y, corona.z, 1.6);
      protegerGanadora();
      if (tFreeze > WINNER_HOLD) {
        if (auditoria) auditoria.listo = true;
        roar?.stop();
        S.cleanup();
      }
      return;
    }
    const lenta = tRace / DUR > plan.foto ? 0.4 : 1;
    tRace += dt * lenta;
    tReal += dt * paceFactor();
    if (tGo >= 0) tGo += dt * paceFactor();
    const prog = qNow();
    // Los cascos se frenan con las patas en la cámara lenta.
    raceAudio(dt * lenta, prog);
    storyBeats(prog);
    const xs = lanes.map((_, k) => plan.pos(k, prog));
    let leader = 0;
    xs.forEach((x, k) => { if (x > (xs[leader] as number)) leader = k; });
    // Los cambios de punta ceden el turno: con el relator a tiempo salen
    // seguido, y le quitaban el lugar a las historias del arco y a los
    // momentos de la historia que están por pasar.
    const cerca = (at: number): boolean => at > prog && at - prog < 0.05;
    const momento = enEspera !== null || story.beats.some((bt) => cerca(bt.at)) || hitos.some(cerca);
    // En el duelo, desde el mano a mano no se anuncia quién pasa adelante: las
    // dos se turnan, y con cada cambio la ganadora y la rival quedaban como las
    // más nombradas de la carrera.
    const enDuelo = story.arc === "duelo" && prog >= 0.52;
    if (leader !== lastLeader && tRace > 1 && !saidLast && !momento && !enDuelo && tReal - lastSayAt >= 2.5) {
      lastLeader = leader;
      if (sayIf(T[getLang()].cLead(nameOf(leader)), 0.3 + 0.4 * prog)) {
        beep(note(12), 0.12, "triangle", 0.05);
        setTimeout(() => beep(note(15), 0.1, "triangle", 0.04), 70);
        // La cámara se acerca un momento a la que pasa adelante, como a los
        // momentos de la historia. Si se acercara solo a esos, que son de las
        // que no ganan, la llama que más se mira sería la que pierde.
        if (!shot) shot = { k: leader, until: prog + 0.06, zoom: 1.5 };
      }
    }
    if (!saidLast && prog > 0.8) {
      if (arcMsg.last === undefined) beep(note(13), 0.22, "triangle", 0.06);
      // Si otra línea recién salió, espera su turno (un rato, no hasta la meta).
      if (sayIf((arcMsg.last ??= t("cLast")), 0.85) || prog > 0.9) saidLast = true;
    }
    // La tribuna se calla junto con la música, en el respiro antes de la meta.
    if (!hushed && tRace >= DUR - (0.4 * lenta) / paceFactor()) {
      hushed = true;
      roar?.hush();
    }
    const order = xs.map((x, k) => ({ x, k })).sort((a, b) => b.x - a.x);
    order.forEach(({ k }, puesto) => { rowPos[k] = (rowPos[k] as number) + (puesto - (rowPos[k] as number)) * Math.min(1, dt * 10); });
    const puesto = String(order.findIndex((o) => o.k === story.winner) + 1);
    S.mark("puesto", puesto);
    // El puesto en el cuadro en que la carrera cruza la mitad, para el auditor
    // de emoción: con el reloj del juego, no con el de la página.
    if (prog >= 0.5 && !mitadMarcada) {
      mitadMarcada = true;
      S.mark("mitad", puesto);
    }

    // La cámara. Por defecto sigue a la punta, un poco adelantada, y se
    // acerca a medida que sube la tensión. En un momento de la historia se
    // mete en ese carril; en la recta final se cierra sobre las dos de
    // adelante; en la foto va a la meta, bien cerca.
    const tens = tension(story, prog);
    const leadX = G.X0 + (xs[leader] as number) * G.TL;
    // El zoom de emoción: un empuje lento desde el 80 % hasta el golpe (la
    // meta). Dura lo que tarda la carrera en llegar, contado en la hora de la
    // cámara: la foto del duelo corre a 0,4, y ahí el empuje también se estira.
    if (!empujeDado && prog >= 0.8) {
      empujeDado = true;
      const fp = Math.min(1, Math.max(0.8, plan.foto));
      cam.tension((fp - 0.8) * DUR + ((1 - fp) * DUR) / 0.4, 0.06);
    }
    if (shot && prog >= shot.until) shot = null;
    if (prog > plan.foto) {
      // En la foto, sin desenfoque: el acercamiento rápido a la meta dejaba
      // borrosos justo los dos nombres del duelo (revisión de juegos del 16 de
      // octubre de 2026), como pasaba en el último tiro del sapo.
      cam.noBlur();
      const foto = planoFoto(prog);
      cam.lookAt(foto.x, foto.y, foto.z, 4);
    } else if (shot) {
      // El momento, con la llama entera y su "!": con pocas personas, a 1,5 o
      // 1,7 la cabeza y la marca quedaban arriba, fuera de la pantalla.
      const r = L.runners[shot.k] as Runner;
      const c = cuerpo(shot.k, prog);
      const marca = (r.marca ?? 0) * G.laneScale(shot.k);
      const v = dentro(holgado({ ...c, y: c.y - marca, h: c.h + marca }), zonaCarrera(), { x: xOf(shot.k, prog) + 20 * G.u, y: G.laneY(shot.k) - 40 * G.u, z: shot.zoom }, G.sw, G.sh);
      cam.lookAt(v.x, v.y, v.z, 5);
    } else if (prog > 0.8) {
      const second = order[1]?.k ?? leader;
      const x2 = xOf(second, prog);
      const y = (G.laneY(leader) + G.laneY(second)) / 2 - 30 * G.u;
      // Un acercamiento que se apura hasta la meta: con +0,2 parejo, de los 22
      // a los 26 s la pantalla casi no cambiaba. Nunca tan cerca que una de
      // las dos de adelante quede fuera, si van en carriles lejanos.
      const base = G.portrait ? 1.2 : 1.35;
      const alto = Math.abs(G.laneY(leader) - G.laneY(second)) + 120 * G.u;
      const cabe = (G.sh - S.top() - S.bottom() - 80 * G.u) / alto;
      const z = Math.max(base, Math.min(base + 0.55 * Math.pow((prog - 0.8) / 0.2, 1.5), cabe));
      // Las dos de adelante, enteras (con pocas personas no entraban a ese
      // acercamiento), con aire hacia la meta. Con poco aire, en el medio de la
      // pantalla quedaba el nombre de la que iba primera, como si la cámara la
      // mirara solo a ella (auditor de delatores, 21 de octubre de 2026).
      look((leadX + x2) / 2 + 100 * G.u, y, z, 3, unir([cuerpo(leader, prog), cuerpo(second, prog)]));
    } else {
      // La que va adelante, entera: en un celular, con pocas personas, la cola quedaba afuera.
      look(leadX - G.sw * 0.08, G.midY, 1 + 0.18 * tens, 2.6, cuerpo(leader, prog));
    }
    S.breath(tRace, DUR, lenta);
    if (prog >= 1) finishNow();
  }

  /**
   * Dónde va el minimapa: arriba, centrado. En la pantalla ancha no se mete
   * debajo del aviso de cuántos corren, que con la letra legible le tapaba la
   * largada (21 de octubre de 2026): se achica parejo de los dos lados. En el
   * celular el aviso ocupa el ancho entero y queda encima, como antes.
   */
  function minimapa(): { mw: number; mx: number; my: number } {
    const { sw, u } = G;
    let mw = G.portrait ? sw - 40 * u : Math.min(sw * 0.46, 560 * u);
    if (!G.portrait && L.aviso?.visible) {
      const b = L.aviso.getBounds();
      mw = Math.max(160 * u, Math.min(mw, 2 * (sw / 2 - (b.x + b.width) - 24 * u)));
    }
    return { mw, mx: (sw - mw) / 2, my: S.top() + 16 * u };
  }

  function draw(now: number): void {
    const prog = qNow();
    const { u, sw } = G;
    /** Antes de la largada, todos quietos en la línea. */
    const quieto = phase === "pre" || phase === "count";
    const tens = quieto ? 0.1 : phase === "done" ? 1 : tension(story, prog);

    // Paralaje: cada capa se corre una parte de lo que se corre la cámara.
    // Con el pelotón corre el suelo y no la cámara: lo de atrás se desplaza con `sc0`.
    const sc0 = L.pelo && phase === "pre" && tPre < T_LANES ? L.pelo.suelo(tPre) : 0;
    // La tribuna corre menos que la valla (está más lejos) y no se queda sin gente: `fs` es cuánto.
    const par = (c: Container, f: number, fs = f): void => {
      c.x = cam.x * (1 - f) - fs * sc0;
      c.y = (cam.y - G.midY) * (1 - f) * 0.6;
    };
    par(L.far, 0.1);
    par(L.mid, 0.2);
    par(L.near, 0.35);
    par(L.stands, 0.7, 0.33);
    L.clouds.x = -cam.x * 0.05 - 0.05 * sc0 - now * 6 * u;
    L.sun.x = sw * 0.78 - cam.x * 0.02;

    // La hinchada salta más cuanto más tensa está la carrera. Se dibuja la que
    // se ve: con la cámara alejada (pocas personas, en la corona) se ve más de
    // un ancho de pantalla para cada lado, y sin esto los costados quedaban sin gente.
    const media = Math.max(sw, sw / (2 * Math.max(0.2, cam.zoom)));
    const lo = cam.x * 0.7 + sc0 * 0.33 - media, hi = cam.x * 0.7 + sc0 * 0.33 + media;
    L.crowd.forEach((sp, i) => {
      const b = L.crowdBase[i];
      if (!b) return;
      if (b.x < lo || b.x > hi) {
        sp.visible = false;
        return;
      }
      sp.visible = true;
      sp.y = b.y - Math.max(0, Math.sin(now * (6 + tens * 6) + b.ph)) * (1 + tens * 6) * u;
      const up = tens > 0.7 && Math.sin(now * 3 + b.ph) > -0.2;
      const kind = Math.floor(((i * 7) % 16) / 2);
      sp.texture = (L.people[kind * 2 + (up ? 1 : 0)] ?? sp.texture) as Texture;
    });
    const fl = L.flags;
    fl.clear();
    for (let i = 0; i < 18; i++) {
      const x = (i + 0.5) * (G.TL * 0.75 + sw * 2) / 18 - sw * 0.5;
      if (x < lo - 60 * u || x > hi + 60 * u) continue;
      const y0 = G.trackTop - 100 * u;
      fl.moveTo(x, y0).lineTo(x, y0 - 34 * u).stroke({ width: 2 * u, color: CREAM });
      const pts: number[] = [];
      for (let j = 0; j <= 6; j++) pts.push(x - j * 5 * u, y0 - 34 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      for (let j = 6; j >= 0; j--) pts.push(x - j * 5 * u, y0 - 20 * u + Math.sin(now * 5 + i + j * 0.8) * 2.5 * u * (j / 6));
      fl.poly(pts).fill(S.color(i)).stroke({ width: 1.5 * u, color: INK });
    }

    // La tabla y el aviso se deciden antes que los nombres: los nombres no se
    // meten debajo de ellos.
    L.board.visible = !G.portrait && phase !== "pre";
    if (L.aviso) L.aviso.visible = phase !== "pre";
    /**
     * El nombre de cada carril va a la izquierda de su llama, y la cámara sigue
     * a la punta: en un celular los de atrás quedaban cortados contra el borde
     * izquierdo durante toda la carrera, y con la letra legible pasaba también
     * en la pantalla grande (crítico de juegos, 16 de octubre de 2026). El que
     * no entra se corre lo justo para quedar entero, en su carril: pegado al
     * borde, o a la derecha de la tabla de posiciones si está a su altura.
     */
    const o0 = cam.toScreen(0, 0, sw, G.sh);
    const z = cam.toScreen(1, 0, sw, G.sh).x - o0.x;
    // En los acercamientos el nombre no crece con la cámara: en la foto, a
    // 2,1, los chips legibles tapaban a las llamas enteras. Alejándose sí se
    // achica con la pista, para no encimarse con el del carril de al lado.
    const comp = 1 / Math.max(1, cam.zoom);
    const muros = [L.board, L.aviso].filter((b): b is Container => !!b && b.visible).map((b) => b.getBounds());
    const piso = G.sh - S.bottom();
    /** Lo de arriba que un nombre no tapa: el aviso de cuántos corren y el minimapa. */
    const techos: { x: number; y: number; width: number; height: number }[] = L.aviso?.visible ? [L.aviso.getBounds()] : [];
    if (phase !== "pre") {
      const m = minimapa();
      techos.push({ x: m.mx - 10 * u, y: m.my - 12 * u, width: m.mw + 20 * u, height: 24 * u });
    }
    /** El cuerpo de la llama en pantalla, sin el nombre. */
    const cajaEn = (r: Runner, sc: number): Caja => {
      const caja = (r.caja ??= medirCaja(r.root));
      const a = cam.toScreen(r.root.x + caja.x * sc, r.root.y + caja.y * sc, sw, G.sh);
      const b = cam.toScreen(r.root.x + (caja.x + caja.w) * sc, r.root.y + (caja.y + caja.h) * sc, sw, G.sh);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    /** Qué parte de la llama tapa un rectángulo de pantalla, de 0 a 1. */
    const tapa = (c: Caja, x: number, y: number, w: number, h: number): number => {
      const ix = Math.max(0, Math.min(x + w, c.x + c.w) - Math.max(x, c.x));
      const iy = Math.max(0, Math.min(y + h, c.y + c.h) - Math.max(y, c.y));
      return (ix * iy) / Math.max(1, c.w * c.h);
    };
    /**
     * El nombre de cada llama va a la izquierda de su cuerpo, entero y adentro
     * de la pantalla. Si para quedar entero tiene que correrse encima de su
     * propia llama, se achica (hasta 0,6) o queda solo la cara, pegada al
     * borde: antes el nombre se corría encima de la llama y tapaba el cuerpo.
     * Los dos del duelo siempre tienen su nombre entero, y el que cae debajo de
     * la pista se apaga, porque asomaba cortado detrás de la caja del relator.
     */
    const adentro = (r: Runner, sc: number, duo: boolean): void => {
      const tag = r.tag;
      const s0 = tag.scale.x;
      const p = cam.toScreen(tag.x, tag.y, sw, G.sh);
      const alto = (tag.height / 2) * z;
      if (!duo && p.y + alto > piso) {
        tag.visible = false;
        return;
      }
      // Arriba, lo mismo: el carril que un primer plano deja debajo de la barra,
      // del aviso o del minimapa no lleva nombre. Y si el nombre se sale por la
      // derecha, su llama (que va a su derecha) ya quedó fuera de cuadro: en el
      // celular asomaban "Valeria" sin el apellido o un chip partido contra la
      // barra (revisión visual, 21 de octubre de 2026). Los dos del duelo se
      // corren lo justo para quedar enteros.
      const ancho0 = tag.width * z;
      const debajo = (m: { x: number; y: number; width: number; height: number }): boolean =>
        p.x < m.x + m.width && p.x + ancho0 > m.x && p.y - alto < m.y + m.height && p.y + alto > m.y;
      if (!duo && (p.y - alto < S.top() || techos.some(debajo) || p.x + ancho0 > sw - 8 * u)) {
        tag.visible = false;
        return;
      }
      if (p.x + ancho0 > sw - 8 * u) {
        tag.x -= (p.x + ancho0 - (sw - 8 * u)) / z;
        return;
      }
      let min = 8 * u;
      for (const m of muros) if (p.y + alto > m.y && p.y - alto < m.y + m.height) min = Math.max(min, m.x + m.width + 8 * u);
      if (p.x >= min) return;
      const cuerpo = cajaEn(r, sc);
      tag.x += (min - p.x) / z;
      const ancho = tag.width * z;
      if (tapa(cuerpo, min, p.y - alto, ancho, 2 * alto) <= 0.1) return;
      const f = (cuerpo.x - 4 * u - min) / Math.max(1, ancho);
      if (duo || f >= 0.6) {
        tag.scale.set(s0 * Math.min(1, Math.max(0.6, f)));
        return;
      }
      const cara = tag.children[1];
      const fondo = tag.children[0];
      const texto = tag.children[2];
      if (!cara || !fondo || !texto) return;
      fondo.visible = false;
      texto.visible = false;
      if (tapa(cuerpo, min + cara.x * s0 * z, p.y - alto, cara.width * s0 * z, 2 * alto) > 0.1) tag.visible = false;
    };

    // Los corredores.
    const fx = L.fx;
    fx.clear();
    // En la corona, la ganadora va adelante de todas: en su carril de arriba
    // quedaba detrás de la del carril de al lado. Se mira en cada cuadro
    // porque un cambio de tamaño vuelve a armar la pista.
    if (phase === "done") {
      const w = L.runners[winnerLane]?.root;
      const capa = w?.parent;
      if (w && capa && capa.children[capa.children.length - 1] !== w) capa.addChild(w);
    }
    // Los nombres que no se apagan en un primer plano: las dos que van
    // adelante (las que mira la cámara en la recta final) y, en el duelo, las
    // dos del mano a mano. Hasta el 21 de octubre eran la ganadora y la rival en
    // todos los arcos: en un primer plano se apagaban los nombres de las demás,
    // y el de la ganadora quedaba.
    const punta = quieto || phase === "done" ? [] : lanes.map((_, k) => k).sort((a, b) => plan.pos(b, prog) - plan.pos(a, prog) || a - b).slice(0, 2);
    const protegido = (k: number): boolean => phase === "done"
      ? k === story.winner || k === story.rival
      : punta.includes(k) || (story.arc === "duelo" && prog >= 0.52 && (k === story.winner || k === story.rival));
    for (let k = 0; k < N; k++) {
      const r = L.runners[k] as Runner;
      const sc = G.laneScale(k);
      const p = quieto ? 0 : plan.pos(k, prog);
      const pPrev = quieto ? 0 : plan.pos(k, Math.max(0, prog - 0.004));
      const speed = phase === "race" ? (p - pPrev) / 0.004 : 0;
      // La presentación: cada una llega trotando desde atrás de la línea, se
      // planta y pega un salto cuando dicen su nombre.
      const h = phase === "pre" ? tPre - laneAt(k) : 9;
      const entra = Math.max(0, Math.min(1, h / 0.32));
      const llega = 1 - (1 - entra) ** 3;
      const salto = h > 0.25 && h < 0.7 ? Math.sin(((h - 0.25) / 0.45) * Math.PI) * 16 * u : 0;
      const x = G.X0 + p * G.TL - (1 - llega) * 150 * u;
      const y = G.laneY(k);
      r.root.position.set(x - 34 * sc, y - salto);
      r.root.alpha = entra;
      r.pose(phase === "pre" ? (1 - llega) * 12 : p * 95, phase === "pre" && entra < 1 ? 1 : speed, phase === "race" ? plan.beatOf(k, prog) : null, now);
      if (phase === "done" && k === winnerLane) r.root.y = y - Math.abs(Math.sin(tFreeze * 7)) * SALTO * u * Math.max(0, 1 - tFreeze / 2.6);
      // En la corona, las que no ganan nada se apagan, como sus nombres y la
      // tabla. Con tinte y no con transparencia: transparente, se veían las
      // patas a través del cuerpo.
      const premio = prizedLanes.has(k);
      r.root.tint = phase === "done" && !premio ? (dark ? 0x8a8499 : 0xb3aebf) : 0xffffff;
      // Detrás de la cola de la llama (llega a 67), de las aletas del cohete o
      // de la popa de la balsa.
      // El nombre aparece cuando llega su chip de la clasificatoria, y late una vez.
      const late = h > 0.15 && h < 0.55 ? Math.sin(((h - 0.15) / 0.4) * Math.PI) * 0.35 : 0;
      r.tag.scale.set((1 + late) * comp);
      // Todo el nombre visible para medirlo entero: adentro() puede apagar partes en este cuadro.
      r.tag.visible = true;
      for (const c of r.tag.children) c.visible = true;
      r.tag.position.set(x - (space ? 82 : lake ? 86 : 70) * sc - r.tag.width, y - 30 * sc);
      adentro(r, sc, protegido(k));
      // Las etiquetas de los que no ganaron no se apagan casi nada (0,95): con menos, el nombre no llega a 4,5 a 1 y en Zoom no se lee. El apagado va en la fila.
      r.tag.alpha = (phase === "done" && !premio ? 0.95 : 1) * Math.max(0, Math.min(1, (h + 0.05) / 0.2));
      if (quieto) continue;
      // Polvo (o estela), cada grano calculado desde su hora.
      const every = 0.006;
      for (let e = Math.floor((prog - 0.03) / every); e <= Math.floor(prog / every); e++) {
        if (e < 0) continue;
        const qe = e * every;
        const age = (prog - qe) / 0.03;
        if (age < 0 || age > 1) continue;
        const spd = (plan.pos(k, qe) - plan.pos(k, Math.max(0, qe - 0.004))) / 0.004;
        if (spd < 0.5) continue;
        const px = G.X0 + plan.pos(k, qe) * G.TL - (space ? 44 : lake ? 46 : 30) * sc - age * 26 * u - hash(e, k) * 10 * u;
        const py = y - (space ? 36 * sc : lake ? 2 * u : 3 * u) - age * (space ? (hash(k, e) - 0.5) * 16 : lake ? 3 + hash(k, e) * 6 : 8 + hash(k, e) * 12) * u;
        fx.circle(px, py, (3 + age * 7) * u * sc).fill({ color: space ? 0xff9f1c : lake ? 0xeaf8ff : dark ? 0x8a6a52 : 0xe0c49a, alpha: (space || lake ? 0.6 : 0.45) * (1 - age) });
      }
      if (speed > 1.3) {
        for (let j = 0; j < 3; j++) {
          const ly = y - (20 + j * 14) * sc;
          const lx = x - (70 + ((now * 900 + j * 37 + k * 11) % 60)) * u;
          fx.moveTo(lx, ly).lineTo(lx - 40 * u, ly).stroke({ width: 2 * u, color: 0xffffff, alpha: 0.6 });
        }
      }
      // En el lago, cada palada salpica: unas gotas saltan donde entra el remo.
      if (lake && speed > 0.3) {
        const ph = p * 95;
        const catchN = Math.floor((ph + Math.PI / 2) / (Math.PI * 2));
        for (let m = catchN - 1; m <= catchN; m++) {
          const a = ph - (m * Math.PI * 2 - Math.PI / 2);
          if (a < 0 || a > 2.4) continue;
          const f = a / 2.4;
          const bx = x - 34 * sc + 2 * sc, by = y - 2 * u;
          for (let j = 0; j < 5; j++) {
            const vx = -(8 + hash(m, j + k * 7) * 22) * u, vy = (18 + hash(j, m + k) * 16) * u;
            const dx = vx * f * 2.2, dy = -vy * Math.sin(Math.PI * f);
            fx.circle(bx + dx, by + dy, (2.6 - f * 1.4) * u * Math.max(0.6, sc)).fill({ color: 0xeaf8ff, alpha: 0.85 * (1 - f) });
          }
          if (f < 0.6) fx.ellipse(bx, by + 1 * u, (6 + f * 22) * u, (1.5 + f * 3) * u).stroke({ width: 1.5 * u, color: 0xeaf8ff, alpha: 0.7 * (1 - f / 0.6) });
        }
      }
      const beat = phase === "race" ? plan.beatOf(k, prog) : null;
      if (beat?.kind === "escupida") {
        const bt = story.beats.find((b) => b.kind === "escupida" && b.actor === k && prog >= b.at && prog < b.at + 0.05);
        if (bt?.target !== undefined) {
          const tx = xOf(bt.target, prog);
          const ty = G.laneY(bt.target) - 70 * G.laneScale(bt.target);
          const sx = x + 4 * u, sy = y - 78 * sc;
          for (let j = 0; j < 6; j++) {
            const f = Math.min(1, beat.p * 2) - j * 0.06;
            if (f < 0) continue;
            fx.circle(sx + (tx - sx) * f, sy + (ty - sy) * f - Math.sin(Math.PI * f) * 40 * u, 3.2 * u).fill({ color: space ? 0xff4d4d : 0x9fe3ff, alpha: 0.9 });
          }
        }
      }
    }

    // El pelotón: se ve hasta que se abre en los carriles; el destello tapa el corte.
    if (L.pelo && !peloRoto) try {
      const enPelo = phase === "pre" && tPre < T_LANES;
      L.world.visible = !enPelo;
      L.pelo.escena.visible = enPelo;
      L.pelo.hud.visible = phase === "pre" && L.pelo.vivo(tPre);
      if (phase === "pre") {
        if (params.get("pelotonFalla") === "dibujo" && tPre > 6) throw new Error("falla de prueba al dibujar el pelotón");
        L.pelo.dibujar(tPre, now);
      }
      if (L.destello) {
        const d = phase !== "pre" ? 0 : tPre < T_LANES ? Math.max(0, Math.min(1, (tPre - (T_LANES - 0.3)) / 0.3)) : Math.max(0, 1 - (tPre - T_LANES) / 0.45);
        L.destello.alpha = 0.92 * d;
        L.destello.visible = d > 0.01;
      }
    } catch (err) {
      pelotonRoto(err);
    }

    // Para el auditor de encuadre: dónde cayó cada cuerpo en este cuadro.
    if (auditoria && (phase === "done" || (phase === "race" && prog > 0.8)) && cuadroAud++ % 2 === 0) {
      const zc = zonaCorona(0);
      const r1 = (v: number): number => Math.round(v * 10) / 10;
      // El cartel lo anota el estadio en píxeles del lienzo; acá va en los de la pantalla.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cartel = (S.view.dataset.cartel ?? "").split(",").map(Number);
      const rel = document.getElementById("commentary")?.getBoundingClientRect();
      auditoria.muestras.push({
        cartel: phase === "done" && cartel.length === 4 && cartel.every(Number.isFinite) ? cartel.map((v) => r1(v / dpr)) : null,
        relator: rel ? [r1(rel.x), r1(rel.y), r1(rel.width), r1(rel.height)] : null,
        t: phase === "done" ? r1(tFreeze * 100) / 100 : -1,
        fase: phase === "done" ? "corona" : prog > plan.foto ? "foto" : "recta",
        z: Math.round(z * 1e4) / 1e4,
        cajas: L.runners.map((r, k) => {
          const c = cajaEn(r, G.laneScale(k));
          return [r1(c.x), r1(c.y), r1(c.w), r1(c.h)];
        }),
        zona: [zc.x0, zc.y0, zc.x1, zc.y1].map(Math.round),
      });
    }

    // El minimapa.
    const mini = L.mini;
    mini.clear();
    const { mw, mx, my } = minimapa();
    mini.roundRect(mx - 10 * u, my - 12 * u, mw + 20 * u, 24 * u, 12 * u).fill({ color: INK, alpha: 0.75 });
    mini.rect(mx, my - 1.5 * u, mw, 3 * u).fill({ color: CREAM, alpha: 0.5 });
    for (let c = 0; c < 4; c++) mini.rect(mx + mw - 6 * u + (c % 2) * 3 * u, my - 7 * u + Math.floor(c / 2) * 7 * u, 3 * u, 7 * u).fill(c % 3 === 0 ? 0xffffff : INK);
    mini.visible = phase !== "pre";
    const minis = lanes.map((_, k) => ({ k, p: quieto ? 0 : plan.pos(k, prog) })).sort((a, b) => a.p - b.p);
    for (const { k, p } of minis) {
      const lead = Math.round(rowPos[k] as number) === 0 && !quieto;
      mini.circle(mx + Math.max(0, Math.min(1, p)) * mw, my, (lead ? 7 : 5) * u).fill(S.color(k)).stroke({ width: 2 * u, color: INK });
    }
    const rowH = 31 * u;
    L.rows.forEach((r, k) => {
      const pos = rowPos[k] as number;
      r.y = pos * rowH;
      (r.children[2] as Text).text = String(Math.round(pos) + 1);
      // Mientras una fila pasa a otra, se ve apagada: el cruce se lee como un
      // adelantamiento y no como dos nombres escritos encima.
      const cruzando = Math.abs(pos - Math.round(pos)) > 0.1;
      r.alpha = cruzando ? 0.6 : 1;
      // En la corona, las que no ganan nada se apagan con tinte, como sus llamas,
      // y la fila sigue opaca: transparentes, sobre la tribuna de colores eran
      // chips grises que casi no se leían (revisión visual, 21 de octubre de
      // 2026). El nombre apagado queda a más de 4,5 a 1 sobre su fila.
      r.tint = phase === "done" && !prizedLanes.has(k) ? 0xb8b8b8 : 0xffffff;
    });

    tlCount.time(phase === "pre" ? 0 : phase === "count" ? tPhase : tGo >= 0 && tGo < 1 ? 3 + tGo : 4);
    L.foto.visible = prog > plan.foto && phase === "race";
    if (phase === "done") crown.at(tFreeze);
    roar?.(tens);
    drawQual();
  }

  /** La clasificatoria: las oleadas tachan, y los de la final vuelan a su carril. */
  function drawQual(): void {
    const Q = L.qual;
    Q.root.visible = phase === "pre" && waves.length > 0 && tPre < laneAt(N - 1) + 0.2;
    if (!Q.root.visible) return;
    const { u } = G;
    const sale = Math.max(0, Math.min(1, (tPre - T_LANES + 0.3) / 0.6));
    Q.dim.alpha = 1 - sale;
    Q.head.alpha = 1 - sale;
    const quedan = names.length - waves.reduce((a, w, wi) => a + (tPre >= Q_SHOW + wi * Q_WAVE + 0.55 ? w.length : 0), 0);
    if (Q.count) Q.count.text = `${t("cQualIn")}  ${quedan}`;
    Q.strikes.clear();
    // Los de la final laten mientras termina la última oleada.
    const pulso = tPre > T_LANES - 0.9 && tPre < T_LANES ? 1 + 0.07 * Math.sin((tPre - T_LANES) * 18) : 1;
    names.forEach((_, i) => {
      const cell = Q.cells[i];
      const at = Q.at[i];
      if (!cell || !at) return;
      const se = goneAt.get(i);
      if (se !== undefined) {
        const g = Math.max(0, Math.min(1, (tPre - se) / 0.35));
        cell.alpha = (1 - 0.82 * g) * (1 - sale);
        cell.position.set(at.x, at.y + 7 * u * g);
        if (g > 0) {
          const x1 = at.x + Q.chipDx - 4 * u;
          const x2 = x1 + ((Q.ends[i] ?? Q.chipDx) - Q.chipDx + 8 * u) * Math.min(1, g * 2);
          Q.strikes.moveTo(x1, cell.y).lineTo(x2, cell.y).stroke({ width: 3 * u, color: 0xff4d4d, alpha: 1 - sale });
        }
        return;
      }
      const k = lanes.indexOf(i);
      const t0 = laneAt(k) - 0.45;
      const f = Math.max(0, Math.min(1, (tPre - t0) / 0.45));
      const e = f * f * (3 - 2 * f);
      const r = L.runners[k];
      let tx = at.x, ty = at.y;
      if (r) {
        // A donde está el nombre de su carril, que ya quedó adentro de la pantalla.
        const s = cam.toScreen(r.tag.x, r.tag.y, G.sw, G.sh);
        tx = s.x - Q.chipDx;
        ty = s.y;
      }
      cell.position.set(at.x + (tx - at.x) * e, at.y + (ty - at.y) * e);
      cell.scale.set(Q.scale * (f > 0 ? 1 : pulso));
      cell.alpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
    });
  }

  S.run((dt, now) => {
    update(dt);
    cam.update(dt);
    cam.apply(S.scene, G.sw, G.sh, now);
    draw(now);
  });
}

/**
 * El ruido de la tribuna: ruido filtrado en la banda de las voces, que sube
 * con la tensión. No es una nota: es gente.
 *
 * Al final no sigue a la tensión: se calla en el respiro antes de la meta y
 * explota con la ganadora. Hasta el 7 de octubre de 2026 quedaba al máximo
 * desde el 80% de la carrera y seguía igual con el revelado, así que tapaba
 * el silencio de antes y no festejaba nada después.
 */
function crowdNoise(): ((tension: number) => void) & { stop: () => void; hush: () => void; burst: () => void } {
  const ctx = audio();
  const noop = Object.assign((_: number) => {}, { stop: () => {}, hush: () => {}, burst: () => {} });
  if (!ctx || isMuted()) return noop;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < len; i++) {
    s = (Math.imul(s, 1103515245) + 12345) | 0;
    d[i] = ((s >>> 8) / 8388608 - 1) * 0.6;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  // Sin agudos: con el pasabanda solo, el ruido seguía llegando hasta los
  // 19 kHz y la tribuna sonaba a soplido, no a gente. Lo encontró el auditor
  // del sonido de fondo del estudio (30 de septiembre de 2026).
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1500;
  lp.Q.value = 0.7;
  const lp2 = ctx.createBiquadFilter();
  lp2.type = "lowpass";
  lp2.frequency.value = 2200;
  lp2.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(bp).connect(lp).connect(lp2).connect(g).connect(ctx.destination);
  src.start();
  let dead = false;
  /** Desde el respiro, la tribuna ya no sigue a la tensión. */
  let fija = false;
  const set = (tension: number): void => {
    if (dead || fija) return;
    g.gain.setTargetAtTime(isMuted() ? 0 : 0.012 + 0.05 * tension * tension, ctx.currentTime, 0.25);
    bp.frequency.setTargetAtTime(800 + 500 * tension, ctx.currentTime, 0.4);
  };
  return Object.assign(set, {
    stop: () => {
      dead = true;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      setTimeout(() => { try { src.stop(); } catch { /* ya parado */ } }, 500);
    },
    /** Todos aguantan la respiración. */
    hush: () => {
      if (dead) return;
      fija = true;
      g.gain.setTargetAtTime(isMuted() ? 0 : 0.008, ctx.currentTime, 0.05);
    },
    /** La ovación: sube de golpe y queda festejando. */
    burst: () => {
      if (dead) return;
      fija = true;
      const t = ctx.currentTime;
      const top = isMuted() ? 0 : 0.12;
      // Desde donde esté (callada si hubo respiro; si se saltó, no).
      const now = g.gain.value;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(now, t);
      g.gain.linearRampToValueAtTime(top, t + 0.08);
      g.gain.setTargetAtTime(top * 0.375, t + 0.4, 0.7);
      bp.frequency.cancelScheduledValues(t);
      bp.frequency.setTargetAtTime(1500, t, 0.1);
    },
  });
}
