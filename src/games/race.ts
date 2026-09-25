import { $ } from "../dom";
import { T, getLang, setPickSeed, t } from "../i18n";
import { LCOLORS, drawAvatar, instantMode, paceFactor, setGameLength, type Beacon } from "../state";
import { beep, beepFor, fanfare, note } from "../sound";
import { NO_POSE, THEMES, type Pose, type ThemeId } from "./themes";
import { tension, writeStory, type Arc, type Story } from "./drama";
import { registerSkip, WINNER_HOLD, chrome, drawWinnerPlate, flashScreen, shorten, winnerNames, winnersLabel } from "./overlay";
import { narrate, stopNarrator } from "../narrator";

/* Modo estadio: carrera de llamas a pantalla completa, sembrada con la semilla. */

interface Runner {
  i: number;
  name: string;
  color: string;
  x: number;
  v: number;
  n1: number;
  /** Cuánto lleva caminado: el paso de las patas sale de acá. */
  stride: number;
  /** Puesto en la tabla, suavizado para que las filas se deslicen. */
  row: number;
}

interface Ridge {
  dx: number;
  h: number;
  w: number;
}

export function stadiumRace(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
  themeId: ThemeId = "andes",
): void {
  const winnerIdx = winners[0] ?? 0;
  const skin = THEMES[themeId];
  // Igual que los juegos nuevos: `?instant=1` es del auditor, y la preferencia
  // del sistema es de una persona a la que las animaciones le hacen mal.
  if (instantMode || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    done();
    return;
  }
  const ov = $("stadium");
  const canvas = $<HTMLCanvasElement>("race-canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    done();
    return;
  }
  const commentEl = $("commentary");
  // Vacía al montar. Si no, en un evento con varios sorteos seguidos el juego
  // nuevo arrancaba mostrando "¡ganó fulano!" del sorteo anterior hasta que el
  // relator dijera su primera línea: casi tres segundos en la constelación.
  commentEl.textContent = "";
  $("st-round").textContent = `${t("seed")} ${beacon.round}`;
  ov.style.display = "block";
  document.body.style.overflow = "hidden";

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize(): void {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  resize();
  addEventListener("resize", resize);

  // PRNG sembrado con la aleatoriedad de drand: hasta la animación es reproducible.
  let s = parseInt(beacon.randomness.slice(0, 8), 16) | 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };

  // Las frases del narrador también salen de la semilla, igual que todo lo
  // demás: la misma ronda tiene que sonar igual en cada corrida.
  setPickSeed(rng);

  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches
    ? document.documentElement.dataset.theme !== "light"
    : document.documentElement.dataset.theme === "dark";
  // En el espacio siempre es de noche, sin importar el tema de la página.
  const dark = skin.alwaysNight || prefersDark;
  const tone = <T>(v: { light: T; dark: T }): T => (dark ? v.dark : v.light);
  const cs = getComputedStyle(document.documentElement);
  const P = LCOLORS.map((v) => cs.getPropertyValue(v).trim());
  const INK = "#191919";
  const color = (k: number): string => P[k % P.length] ?? INK;

  /**
   * Quiénes corren.
   *
   * Hay ocho carriles, así que con más de ocho participantes la mayoría no
   * aparece. Antes los acompañantes eran **los siete primeros de la lista**, y
   * eso delataba al ganador antes de largar: con una lista alfabética la sala
   * veía seis apellidos con A y uno del medio, y ganaba ese. El sorteo estaba
   * bien; el juego lo cantaba.
   *
   * Ahora se eligen con el azar sembrado con la ronda, como todo lo demás. El
   * ganador va adentro porque tiene que estar, pero su carril y sus rivales ya
   * no dicen nada.
   */
  const LANES = Math.min(8, names.length);
  const pool = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  const laneIdx = [winnerIdx, ...pool.slice(0, LANES - 1)];
  // Y el carril del ganador también se sortea: si siempre fuera el primero,
  // bastaría con mirar arriba.
  for (let i = laneIdx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [laneIdx[i], laneIdx[j]] = [laneIdx[j] as number, laneIdx[i] as number];
  }
  const runners: Runner[] = laneIdx.map((i, k) => ({
    i, name: names[i] ?? "", color: color(k), x: 0, v: 0, n1: rng() * 7, stride: k, row: k,
  }));
  // Arrancan en la línea de salida; `xAt` los ubica desde el primer cuadro.
  runners.forEach((r) => { r.x = canvas.width * (canvas.height > canvas.width * 1.1 ? 0.36 : 0.2); });

  // Escenario sembrado
  const peaks: Ridge[] = Array.from({ length: 24 }, (_, k) => ({ dx: k * 0.09, h: 0.14 + rng() * 0.16, w: 0.07 + rng() * 0.05 }));
  const hills: Ridge[] = Array.from({ length: 18 }, (_, k) => ({ dx: k * 0.13, h: 0.05 + rng() * 0.07, w: 0.11 + rng() * 0.06 }));
  const clouds = Array.from({ length: 6 }, () => ({ x: rng(), y: 0.06 + rng() * 0.16, sc: 0.5 + rng(), sp: 4 + rng() * 8 }));
  const starCount = skin.alwaysNight ? 150 : 60;
  // Con tema espacial las estrellas cubren toda la pantalla, no solo el cielo.
  const starSpread = skin.alwaysNight ? 1 : 0.4;
  const stars = Array.from({ length: starCount }, () => ({
    x: rng(), y: rng() * starSpread, r: rng() * 1.4 + 0.4,
  }));

  const DUR = 15;

  /* ---------------------------------------------------------- la historia
     El director de emoción escribe la carrera antes de largar: el arco de la
     ganadora, su rival, y lo que le pasa al resto. Acá se actúa.

     Antes cada llama tenía una velocidad que subía y bajaba sola, y la
     ganadora remontaba siempre desde atrás al 80%. Se veía como una
     simulación: nadie tropezaba, nadie se plantaba, no había duelos, y a los
     dos sorteos la sala ya sabía mirar a la última. */
  const story: Story = writeStory(rng, runners.length, Math.max(0, runners.findIndex((r) => r.i === winnerIdx)));

  /** Cambia de carril a dos actores, y la historia con ellos. */
  function swapLanes(a: number, b: number): void {
    if (a === b) return;
    const ra = runners[a] as Runner;
    const rb = runners[b] as Runner;
    runners[a] = rb;
    runners[b] = ra;
    const sw = (x: number): number => (x === a ? b : x === b ? a : x);
    story.winner = sw(story.winner);
    story.rival = sw(story.rival);
    story.rival2 = sw(story.rival2);
    for (const bt of story.beats) {
      bt.actor = sw(bt.actor);
      if (bt.target !== undefined) bt.target = sw(bt.target);
    }
  }
  // Los colores van con el carril, no con la persona.
  const recolor = (): void => runners.forEach((r, k) => { r.color = color(k); });
  // En la tapada, las dos que se pelean adelante van en carriles vecinos: si
  // no, la escupida cruzaría media pista.
  if (story.arc === "tapada" && Math.abs(story.rival - story.rival2) > 1) {
    const vecino = story.rival + (story.rival + 1 < runners.length ? 1 : -1);
    swapLanes(vecino, story.rival2);
  }
  // Y en el duelo, la ganadora y su rival: el mano a mano se lee codo a codo,
  // no con cuatro carriles en el medio.
  if (story.arc === "duelo" && Math.abs(story.winner - story.rival) > 1) {
    const vecino = story.winner + (story.winner + 1 < runners.length ? 1 : -1);
    swapLanes(vecino, story.rival);
  }
  // Una escupida del resto va al carril de al lado; si ahí no hay nadie libre,
  // se planta en vez de escupir.
  for (const bt of story.beats) {
    if (bt.kind !== "escupida" || bt.actor === story.rival) continue;
    const enArco = (k: number): boolean => k === story.winner || k === story.rival || k === story.rival2;
    const vecino = [bt.actor + 1, bt.actor - 1].find((k) => k >= 0 && k < runners.length && !enArco(k));
    if (vecino === undefined) {
      bt.kind = "plantada";
      delete bt.target;
    } else bt.target = vecino;
  }
  recolor();
  // El arco queda anotado en el lienzo, como el cartel: lo lee el auditor para
  // comprobar que los cuatro salen y que el final no se adivina.
  canvas.dataset.arco = story.arc;

  /* Cada llama sigue un camino planificado: la línea de base, que va de la
     largada a la meta, más una ventaja propia medida en anchos de pantalla,
     con puntos de control a lo largo de la carrera. El arco de la ganadora y
     de su rival sale de tablas; el resto va sembrado. */
  const GRID = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.74, 0.86, 0.94, 1];
  const ARC_W: Record<Arc, number[]> = {
    remontada: [0, -0.04, -0.1, -0.15, -0.18, -0.17, -0.13, -0.05, -0.012, 0],
    susto: [0, 0.02, 0.045, 0.06, 0.065, 0.06, 0.05, 0.035, 0.015, 0],
    duelo: [0, 0, 0.02, 0.012, 0.03, 0.024, 0.03, 0.02, 0.012, 0],
    tapada: [0, -0.03, -0.06, -0.07, -0.08, -0.08, -0.075, -0.045, -0.005, 0],
  };
  const ARC_V: Record<Arc, number[]> = {
    remontada: [0, 0.03, 0.05, 0.06, 0.07, 0.07, 0.06, 0.045, 0.02, -0.02],
    susto: [0, 0, 0.02, 0.035, 0.05, 0.06, 0.06, 0.045, 0.02, -0.018],
    duelo: [0, 0.01, 0.01, 0.025, 0.024, 0.035, 0.02, 0.028, 0.012, -0.012],
    tapada: [0, 0.02, 0.04, 0.05, 0.06, 0.07, 0.07, 0.055, 0.02, -0.03],
  };
  const V2_TAPADA = [0, 0.01, 0.03, 0.06, 0.05, 0.068, 0.075, 0.05, 0.01, -0.045];
  const gaps: number[][] = runners.map((_, k) => {
    if (k === story.winner) return ARC_W[story.arc];
    if (k === story.rival) return ARC_V[story.arc];
    if (story.arc === "tapada" && k === story.rival2) return V2_TAPADA;
    // El resto: un paseo sembrado, que al final queda detrás de la ganadora.
    const g = [0];
    let v = 0;
    for (let i = 1; i < GRID.length; i++) {
      v = Math.max(-0.24, Math.min(0.045, v + (rng() - 0.52) * 0.09));
      g.push((GRID[i] as number) >= 0.74 ? Math.min(v, -0.02 - rng() * 0.03) : v);
    }
    g[g.length - 1] = Math.min(g[g.length - 1] as number, -0.04 - rng() * 0.12);
    return g;
  });

  /** La ventaja propia de un actor a la altura `q`, suave entre puntos de control. */
  function gapAt(k: number, q: number): number {
    const g = gaps[k] as number[];
    let i = 0;
    while (i < GRID.length - 2 && q > (GRID[i + 1] as number)) i++;
    const t0 = GRID[i] as number, t1 = GRID[i + 1] as number;
    const tan = (j: number): number => {
      const a = Math.max(0, j - 1), b = Math.min(GRID.length - 1, j + 1);
      return ((g[b] as number) - (g[a] as number)) / ((GRID[b] as number) - (GRID[a] as number));
    };
    const d = t1 - t0;
    const x = Math.max(0, Math.min(1, (q - t0) / d));
    const h00 = 2 * x ** 3 - 3 * x ** 2 + 1, h10 = x ** 3 - 2 * x ** 2 + x;
    const h01 = -2 * x ** 3 + 3 * x ** 2, h11 = x ** 3 - x ** 2;
    return h00 * (g[i] as number) + h10 * d * tan(i) + h01 * (g[i + 1] as number) + h11 * d * tan(i + 1);
  }

  /**
   * Cuánto va atrasado el reloj propio de un actor a la altura `q`.
   *
   * Plantarse es que su reloj se detenga; tropezar, que se detenga un instante;
   * picar, que se adelante. Nunca corre para atrás, así que nadie retrocede en
   * la pista. La ganadora termina siempre con el reloj en hora: llega a la
   * meta justo cuando se acaba la carrera.
   */
  function delayAt(k: number, q: number): number {
    let d = 0;
    const ramp = (a: number, dur: number): number => Math.max(0, Math.min(1, (q - a) / dur));
    for (const bt of story.beats) {
      const soyYo = bt.actor === k;
      const meTocan = bt.target === k;
      if (!soyYo && !meTocan) continue;
      const a = bt.at;
      if (bt.kind === "plantada" && soyYo) {
        // Quieta 0,06 de carrera, y recupera la mitad.
        d += 0.06 * ramp(a, 0.06) - 0.03 * ramp(a + 0.06, 0.16);
      } else if (bt.kind === "tropiezo" && soyYo) {
        if (k === story.winner) {
          // El susto de la ganadora: pierde bastante y lo recupera entero.
          d += 0.05 * ramp(a, 0.05) - 0.05 * ramp(a + 0.05, Math.max(0.05, 0.95 - a - 0.05));
        } else d += 0.025 * ramp(a, 0.025) - 0.015 * ramp(a + 0.025, 0.12);
      } else if (bt.kind === "pique" && soyYo) {
        // Se adelanta y después se desinfla hasta volver a su camino.
        d -= 0.05 * ramp(a, 0.08) - 0.05 * ramp(a + 0.08, 0.16);
      } else if (bt.kind === "escupida") {
        if (soyYo) d += 0.015 * ramp(a, 0.015) - 0.005 * ramp(a + 0.015, 0.1);
        if (meTocan) d += 0.035 * ramp(a + 0.01, 0.035) - 0.015 * ramp(a + 0.045, 0.12);
      }
    }
    return d;
  }

  // La largada deja lugar a la izquierda para los nombres, que van detrás de
  // cada llama: en 0,05 quedaban fuera de la pantalla durante la cuenta.
  const X0 = (): number => W() * (H() > W() * 1.1 ? 0.36 : 0.2);
  /** Dónde está un actor a la altura `q` de la carrera. */
  function xAt(k: number, q: number): number {
    const tau = Math.max(0, Math.min(1, q - delayAt(k, q)));
    return X0() + (L() - X0()) * tau + gapAt(k, tau) * W();
  }

  /** En qué momento de la historia está un actor: para la postura y los efectos. */
  function beatOf(k: number, q: number): { kind: string; p: number } | null {
    for (const bt of story.beats) {
      const lasts = bt.kind === "plantada" ? 0.075 : bt.kind === "pique" ? 0.09 : bt.kind === "escupida" ? 0.05 : 0.035;
      if ((bt.actor === k || bt.target === k) && q >= bt.at && q < bt.at + lasts) {
        return { kind: bt.target === k && bt.actor !== k ? "escupido" : bt.kind, p: (q - bt.at) / lasts };
      }
    }
    return null;
  }

  /** Dónde se define por una nariz: en el duelo, la llegada va en cámara lenta. */
  const FOTO = story.arc === "duelo" ? 0.962 : 2;
  /** Momento de la carrera en que el ganador empieza a remontar. */
  const SURGE_AT = 0.8;
  // Lo que el selector puede estirar son los quince segundos de carrera. La
  // cuenta regresiva y el sostén del cartel van en segundos reales y no se
  // tocan: un "3" que dura dos segundos no se lee como cuenta regresiva.
  setGameLength(DUR, WINNER_HOLD + 3);
  let phase: "count" | "race" | "done" | "dead" = "count";
  let tPhase = 0, tRace = 0, camX = 0, shake = 0, lastLeader = -1, saidLast = false, finished = false, tFreeze = 0;
  let lastBeepN = 4;
  const winnerName = names[winnerIdx] ?? "";
  say(t(skin.readyKey), 0.1);

  function say(msg: string, heat = 0): void {
    commentEl.textContent = msg;
    commentEl.animate(
      [{ transform: "translateX(-50%) scale(0.75)" }, { transform: "translateX(-50%) scale(1)" }],
      { duration: 280, easing: "cubic-bezier(.34,1.56,.64,1)" },
    );
    narrate(msg, heat);
  }

  const W = () => canvas.width;
  const H = () => canvas.height;
  const L = () => W() * 2.6;
  const winner = (): Runner => runners.find((r) => r.i === winnerIdx) ?? (runners[0] as Runner);

  function skip(): void {
    if (finished) return;
    phase = "race";
    tRace = DUR;
    runners.forEach((r, k) => { r.x = xAt(k, 1); });
    finishNow();
  }
  registerSkip(skip);

  function finishNow(): void {
    finished = true;
    phase = "done";
    tFreeze = 0;
    shake = 1;
    flashK = 1;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
  }

  /* ---------------------------------------------------------------- sonido
     Catorce sonidos en veintiséis segundos, con huecos de 4,3 s a ritmo normal
     y 4,9 s en épico, y en épico el hueco caía dentro de la remontada. Una
     carrera muda no emociona por bien que se vea.

     Lo que falta es lo que hace una carrera: el galope, que además marca el
     paso de las patas, y un zumbido de tribuna que sube un grado de la escala
     cada tercio sin que nadie lo anuncie. Los dos en segundos de juego, así que
     se estiran con el selector igual que la imagen. */
  let flashK = 0;
  let hoofIn = 0;
  let hoofStep = 0;
  let droneIn = 0;

  function raceAudio(dt: number, prog: number): void {
    // Los últimos dos centésimos van mudos a propósito: el silencio antes del
    // golpe es lo que hace que el golpe se sienta.
    if (prog > 0.975) return;
    hoofIn -= dt;
    if (hoofIn <= 0) {
      // Cuatro pisadas por segundo de juego, seis en la remontada: el mismo
      // tempo que el balanceo de las patas, así imagen y sonido van juntos.
      hoofIn = prog > SURGE_AT ? 0.16 : 0.25;
      // Los cohetes no galopan: mismo ritmo, motor en vez de pezuña.
      const wave: OscillatorType = skin.alwaysNight ? "sawtooth" : "square";
      beep(note(hoofStep % 2 === 0 ? 0 : 3), 0.05, wave, 0.022);
      hoofStep++;
    }
    droneIn -= dt;
    if (droneIn <= 0) {
      droneIn = 0.7;
      beepFor(note(prog > SURGE_AT ? 4 : prog > 0.45 ? 2 : 0), 0.78, "sawtooth", 0.02);
    }
  }

  function update(dt: number): void {
    if (phase === "count") {
      // En segundos reales. El selector de duración divide el `dt`, así que en
      // modo épico el "3" se quedaba dos segundos y pico quieto en pantalla:
      // una cuenta que no va a un pitido por segundo no se lee como cuenta, se
      // lee como que se colgó.
      tPhase += dt * paceFactor();
      const n = 3 - Math.floor(tPhase);
      // Sube en vez de repetir el mismo la tres veces.
      if (n < lastBeepN && n >= 1) {
        lastBeepN = n;
        beep(note(n === 3 ? 9 : n === 2 ? 10 : 12), 0.18, "triangle", 0.06);
      }
      if (tPhase >= 3) {
        phase = "race";
        say(t("cStart"), 0.35);
        // Dos notas a una octava: una bocina, no un pitido.
        beep(note(14), 0.45, "square", 0.055);
        beep(note(9), 0.45, "square", 0.055);
      }
      return;
    }
    if (phase === "done") {
      // También en segundos reales: lo que tarda la sala en leer un nombre
      // proyectado y reaccionar no cambia porque el organizador elija "épico".
      // Con 1,4 segundos de juego el cartel vivía 1,6 s en normal y 0,9 s en
      // rápido, y la reacción de una sala recién arranca al segundo y pico.
      tFreeze += dt * paceFactor();
      shake = Math.max(0, shake - dt * 1.4);
      flashK = Math.max(0, flashK - dt * paceFactor() * 4);
      if (tFreeze > 3) cleanup();
      return;
    }
    // La foto: en el duelo, los últimos metros van en cámara lenta.
    const lenta = tRace / DUR > FOTO ? 0.4 : 1;
    tRace += dt * lenta;
    const prog = Math.min(1, tRace / DUR);
    raceAudio(dt, prog);
    const vb = (L() - X0()) / DUR;
    runners.forEach((r, k) => {
      const x = xAt(k, prog);
      r.v = dt > 0 ? (x - r.x) / (dt * lenta) : vb;
      r.x = x;
      // El paso sale de lo que corre de verdad: quieta no mueve las patas, en
      // el pique las mueve más rápido.
      r.stride += (Math.max(0, r.v) / vb) * dt * lenta * 14;
    });
    storyBeats(prog);
    const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
    if (leader.i !== lastLeader && tRace > 1 && !saidLast) {
      lastLeader = leader.i;
      if (sayIf(T[getLang()].cLead(leader.name), 0.3 + 0.4 * prog)) {
        beep(note(12), 0.12, "triangle", 0.05);
        setTimeout(() => beep(note(15), 0.1, "triangle", 0.04), 70);
      }
    }
    // 740 Hz era un fa sostenido: el único tono fuera de la escala del juego, y
    // marcaba justo el momento más importante.
    if (!saidLast && prog > SURGE_AT) {
      saidLast = true;
      sayIf(t("cLast"), 0.85);
      beep(note(13), 0.22, "triangle", 0.06);
    }
    // La cámara sigue al puntero, pero al final se destraba y deja la meta
    // cerca del centro. Con el tope viejo el remate pasaba en la franja
    // derecha de la pantalla y el resto de la pista quedaba vacía.
    //
    // Y el puntero va al 58% del ancho, no al 40%: con el pelotón abierto y el
    // puntero a la izquierda, el último corredor quedaba fuera de cuadro. Ahora
    // la carrera entera entra en pantalla y se ve quién le viene atrás a quién.
    const camTarget = leader.x - W() * 0.58;
    const camCap = L() - W() * (prog > SURGE_AT ? 0.62 : 0.86);
    camX += (Math.max(0, Math.min(camTarget, camCap)) - camX) * Math.min(1, dt * 2.6);
    // La tabla de posiciones: las filas se deslizan al nuevo puesto.
    const orden = runners.map((r, k) => ({ r, k })).sort((a, b) => b.r.x - a.r.x);
    orden.forEach(({ r }, puesto) => { r.row += (puesto - r.row) * Math.min(1, dt * 10); });
    if (prog >= 1) finishNow();
  }

  /* ------------------------------------------------ los momentos de la historia
     Cada uno suena y se dice una sola vez, con cierre. El relator no pisa una
     línea con otra de menos calor: si no hay lugar, la más fría se calla. */
  const fired = new Set<string>();
  let lastSayAt = -99;
  let lastHeat = 0;
  function sayIf(msg: string, heat: number): boolean {
    const now = tRace / paceFactor();
    if (now - lastSayAt < 1.1 && heat < lastHeat + 0.3) return false;
    lastSayAt = now;
    lastHeat = heat;
    say(msg, heat);
    return true;
  }
  const key = (base: string): string => `${base}${skin.voice}`;
  const nameOf = (k: number): string => (runners[k] as Runner).name;
  function storyBeats(prog: number): void {
    const L_ = T[getLang()];
    const calor = 0.35 + 0.5 * tension(story, prog);
    story.beats.forEach((bt, n) => {
      const id = `b${n}`;
      if (prog < bt.at || fired.has(id)) return;
      fired.add(id);
      const quien = nameOf(bt.actor);
      const suya = bt.actor === story.winner;
      if (bt.kind === "plantada") {
        sayIf((L_[key("cPlantada")] as (n: string) => string)(quien), calor);
        beep(note(8), 0.12, "triangle", 0.045);
        setTimeout(() => beep(note(3), 0.16, "triangle", 0.04), 120);
      } else if (bt.kind === "tropiezo") {
        sayIf((L_[key("cTropiezo")] as (n: string) => string)(quien), suya ? 0.85 : calor);
        beep(note(1), 0.09, "square", 0.05);
      } else if (bt.kind === "pique") {
        sayIf((L_[key("cPique")] as (n: string) => string)(quien), calor);
        [10, 12, 14].forEach((g, i) => setTimeout(() => beep(note(g), 0.08, "triangle", 0.04), i * 60));
      } else if (bt.kind === "escupida" && bt.target !== undefined) {
        const tapada = story.arc === "tapada" && bt.actor === story.rival;
        sayIf((L_[key("cEscupida")] as (a: string, b: string) => string)(quien, nameOf(bt.target)), tapada ? 0.8 : calor);
        beep(note(16), 0.05, "square", 0.035);
        setTimeout(() => beep(note(11), 0.07, "triangle", 0.035), 50);
      }
    });
    // Las líneas del arco, que la sala tiene que oír.
    const once = (id: string, at: number, fn: () => void): void => {
      if (prog >= at && !fired.has(id)) {
        fired.add(id);
        fn();
      }
    };
    const ganadora = nameOf(story.winner);
    const rival = nameOf(story.rival);
    if (story.arc === "remontada") once("arco", 0.74, () => sayIf(L_.cRemonta(ganadora), 0.8));
    if (story.arc === "duelo") {
      once("arco", 0.52, () => sayIf(L_.cDuelo(ganadora, rival), 0.7));
      once("foto", FOTO, () => {
        sayIf(t("cFoto"), 0.95);
        beep(note(18), 0.03, "square", 0.05);
        setTimeout(() => beep(note(18), 0.03, "square", 0.04), 90);
      });
    }
    if (story.arc === "tapada") once("arco", 0.88, () => sayIf(L_.cCuela(ganadora), 0.9));
    // En el duelo, un latido mientras van codo a codo.
    if (story.arc === "duelo" && prog > 0.52 && prog < FOTO) {
      const b = Math.floor((prog - 0.52) * DUR / 0.45);
      if (b !== latido) {
        latido = b;
        beep(note(0), 0.12, "sine", 0.065);
      }
    }
  }
  let latido = -1;

  function drawScene(): void {
    const c = ctx as CanvasRenderingContext2D;
    const w = W(), h = H(), u = h / 720;
    // El temblor sale del reloj, no del azar sembrado. Llamar a `rng()` en el
    // dibujo consume la secuencia a la velocidad de los cuadros, así que la
    // misma ronda no se dibujaba igual a 60 Hz que a 144, y el proyecto entero
    // se apoya en que la misma ronda dé siempre lo mismo. No cambia quién gana,
    // pero contradice la promesa.
    const shx = shake ? Math.sin(tFreeze * 97) * 7 * shake * u : 0;
    const shy = shake ? Math.sin(tFreeze * 131 + 1.7) * 5 * shake * u : 0;
    c.save();
    c.translate(shx, shy);
    // Cielo
    const sky = c.createLinearGradient(0, 0, 0, h * 0.62);
    const [skyTop, skyBottom] = tone(skin.sky);
    sky.addColorStop(0, skyTop);
    sky.addColorStop(1, skyBottom);
    c.fillStyle = sky;
    c.fillRect(-20, -20, w + 40, h * 0.64 + 20);
    if (dark) {
      c.fillStyle = "rgba(255,255,255,0.8)";
      for (const st of stars) { c.beginPath(); c.arc(st.x * w, st.y * h, st.r * u, 0, 7); c.fill(); }
      if (skin.alwaysNight) {
        // Planeta anillado en lugar de luna.
        c.fillStyle = "#ff8b3d";
        c.beginPath(); c.arc(w * 0.82, h * 0.15, 40 * u, 0, 7); c.fill();
        c.strokeStyle = "rgba(246,239,226,0.55)";
        c.lineWidth = 4 * u;
        c.beginPath(); c.ellipse(w * 0.82, h * 0.15, 66 * u, 16 * u, -0.35, 0, 7); c.stroke();
      } else {
        c.fillStyle = "#f6efe2";
        c.beginPath(); c.arc(w * 0.82, h * 0.14, 34 * u, 0, 7); c.fill();
      }
    } else {
      c.fillStyle = "#ffd24d";
      c.beginPath(); c.arc(w * 0.82, h * 0.15, 44 * u, 0, 7); c.fill();
      c.lineWidth = 3 * u; c.strokeStyle = INK; c.stroke();
    }
    // Nubes
    c.fillStyle = skin.alwaysNight
      ? "rgba(155,123,255,0.16)"
      : dark
        ? "rgba(255,255,255,0.14)"
        : "rgba(255,255,255,0.9)";
    // Desde que arrancó la carrera, no desde que se abrió la página: la misma
    // ronda tiene que dibujar las mismas nubes.
    const tNow = (performance.now() - tStart) / 1000;
    for (const cl of clouds) {
      const cx = ((cl.x * w * 3 - camX * 0.12 - tNow * cl.sp * u) % (w + 300 * u)) - 150 * u;
      const cy = cl.y * h;
      c.beginPath();
      c.ellipse(cx, cy, 60 * cl.sc * u, 16 * cl.sc * u, 0, 0, 7);
      c.ellipse(cx + 34 * cl.sc * u, cy - 8 * cl.sc * u, 40 * cl.sc * u, 13 * cl.sc * u, 0, 0, 7);
      c.fill();
    }
    // Montañas (parallax lejano), terminan en el horizonte, no bajo la pista
    c.fillStyle = tone(skin.ridgeFar);
    drawRange(peaks, 0.22, 0.425, w, h);
    // Cerros (parallax medio)
    c.fillStyle = tone(skin.ridgeNear);
    drawRange(hills, 0.5, 0.43, w, h);
    // Pista
    // La pista termina arriba de la caja del relator: el último carril caía
    // detrás y esa llama no se veía en toda la carrera.
    const trackTop = h * 0.42;
    const trackH = Math.max(h * 0.3, Math.min(h * 0.5, h - chrome(c).abajo - trackTop - 8 * u));
    c.fillStyle = tone(skin.track);
    c.fillRect(-20, trackTop, w + 40, trackH + 40);
    // Banderines al borde
    for (let k = 0; k * 260 * u < L() + w; k++) {
      const fx = k * 260 * u - camX;
      if (fx < -40 || fx > w + 40) continue;
      c.fillStyle = INK;
      c.fillRect(fx, trackTop - 58 * u, 4 * u, 58 * u);
      c.fillStyle = color(k);
      c.beginPath();
      c.moveTo(fx + 4 * u, trackTop - 56 * u);
      c.lineTo(fx + 40 * u, trackTop - 46 * u);
      c.lineTo(fx + 4 * u, trackTop - 36 * u);
      c.closePath(); c.fill();
      c.lineWidth = 2 * u; c.strokeStyle = INK; c.stroke();
    }
    // Carriles
    const lanes = runners.length;
    // Con dos corredores la pista entera se repartía en dos franjas gigantes.
    // Se acota el alto de carril y se centra lo que sobra.
    const laneH = Math.min(trackH / lanes, 118 * u);
    const trackPad = (trackH - laneH * lanes) / 2;
    c.strokeStyle = dark ? "rgba(246,239,226,0.25)" : "rgba(25,25,25,0.3)";
    c.lineWidth = 2 * u; c.setLineDash([18 * u, 16 * u]);
    // Las rayas se dibujaban de 0 a w en coordenadas de pantalla, con el patrón
    // clavado: la cámara sigue al puntero, así que el pelotón queda en el medio
    // y **nada se movía durante doce segundos**. Correr el patrón con la cámara
    // es una línea y es la diferencia entre una pista y un fondo fijo.
    c.lineDashOffset = -camX % (34 * u);
    for (let li = 1; li < lanes; li++) {
      c.beginPath();
      c.moveTo(0, trackTop + trackPad + li * laneH);
      c.lineTo(w, trackTop + trackPad + li * laneH);
      c.stroke();
    }
    c.setLineDash([]);
    c.lineDashOffset = 0;
    // Línea de salida y arco de meta
    // La línea de largada, en la nariz de las llamas.
    const startX = X0() - camX + laneH * 0.75;
    if (startX > -20 && startX < w + 20) { c.fillStyle = dark ? "#f6efe2" : INK; c.fillRect(startX, trackTop, 4 * u, trackH); }
    const finX = L() - camX;
    if (finX > -80 && finX < w + 120) {
      c.fillStyle = INK;
      c.fillRect(finX, trackTop - 70 * u, 8 * u, trackH + 70 * u);
      const sq = 12 * u;
      for (let yy = 0; yy < 3; yy++)
        for (let xx = 0; xx < Math.ceil(trackH / sq) + 1; xx++) {
          c.fillStyle = (xx + yy) % 2 ? "#fff" : INK;
          c.fillRect(finX + 8 * u, trackTop - 70 * u + yy * sq, sq, sq);
        }
      // banda vertical cuadriculada en la meta
      for (let yy = 0; yy < Math.ceil((trackH + 70 * u) / sq); yy++) {
        c.fillStyle = yy % 2 ? "#fff" : INK;
        c.fillRect(finX + 2 * u, trackTop - 70 * u + yy * sq, 4 * u, sq);
      }
    }
    // Llamas. Cuando sale el cartel, los que perdieron se apagan: si no,
    // siguen corriendo detrás y uno asoma por el borde del cartel robándole la
    // foto al ganador. El Cierre de Libro ya lo hacía; acá faltaba.
    const apaga = phase === "done" && tFreeze > 0.25;
    // En un celular vertical la escala sale del alto y no dice nada del ancho:
    // los nombres salían a 37 píxeles, tapaban a las llamas y se cortaban en
    // el borde. Ahí van más chicos, con el nombre de pila, detrás de la llama.
    const vertical = h > w * 1.1;
    const uc = vertical ? Math.min(u, w / 520) : u;
    const q = Math.min(1, tRace / DUR);
    const vb = (L() - X0()) / DUR;
    const laneY = (k: number): number => trackTop + trackPad + k * laneH + laneH * 0.5;
    runners.forEach((r, k) => {
      if (apaga) c.globalAlpha = r.i === winnerIdx ? 1 : 0.22;
      const ly = laneY(k);
      const lx = r.x - camX;
      if (lx < -320 * uc || lx > w + 140) return;
      // La llama ocupa el alto de su carril: el nombre ya no va encima, va
      // detrás, así que el lugar es de ella. Medía veinte píxeles.
      // En horizontal los carriles son bajos: la llama puede pisar la raya de
      // arriba, que es sólo una raya.
      const sc = Math.min(laneH * (vertical ? 0.8 : 1.05), 90 * u) / 24;
      const beat = phase === "race" ? beatOf(k, q) : null;
      const ratio = phase === "race" && vb > 0 ? r.v / vb : 0;
      // La postura: lo que le pasa a cada una se lee en el cuerpo.
      const pose: Pose = phase !== "race" ? NO_POSE : {
        lean: beat?.kind === "tropiezo" ? 0.45 * Math.sin(Math.PI * beat.p)
          : beat?.kind === "escupido" ? -0.28 * Math.sin(Math.PI * beat.p)
            : Math.max(-0.12, Math.min(0.3, (ratio - 1) * 0.5)),
        still: ratio < 0.15,
        spit: beat?.kind === "escupida" ? Math.sin(Math.PI * Math.min(1, beat.p * 2)) : 0,
      };
      const bob = phase === "race" && !pose.still ? Math.sin(r.stride * 1.15) * 3 * u : 0;
      const top = ly - 12 * sc + bob;
      // Detrás: polvo cuando pica o corre de más, polvareda al tropezar.
      if (phase === "race" && (ratio > 1.25 || beat?.kind === "pique")) {
        for (let i = 0; i < 4; i++) {
          const f = (r.stride * 0.35 + i * 0.25) % 1;
          c.globalAlpha = (apaga ? 0.22 : 1) * 0.5 * (1 - f);
          c.fillStyle = dark ? "#b9a88f" : "#a0896a";
          c.beginPath();
          c.arc(lx - f * 40 * sc * 0.4, top + 22 * sc - f * 6 * sc, (2 + f * 5) * sc * 0.5, 0, 7);
          c.fill();
        }
        // Líneas de velocidad en el pique.
        if (beat?.kind === "pique") {
          c.globalAlpha = apaga ? 0.22 : 0.7;
          c.strokeStyle = dark ? "#f6efe2" : INK;
          c.lineWidth = 2 * u;
          for (let i = 0; i < 3; i++) {
            c.beginPath();
            c.moveTo(lx - (8 + i * 6) * sc * 0.5, top + (8 + i * 5) * sc);
            c.lineTo(lx - (26 + i * 10) * sc * 0.5, top + (8 + i * 5) * sc);
            c.stroke();
          }
        }
        c.globalAlpha = apaga ? (r.i === winnerIdx ? 1 : 0.22) : 1;
      }
      if (beat?.kind === "tropiezo") {
        c.globalAlpha = 0.6 * (1 - beat.p);
        c.fillStyle = dark ? "#b9a88f" : "#a0896a";
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.arc(lx + (6 + i * 7) * sc, top + 23 * sc, (3 + beat.p * 8) * sc * 0.5, 0, 7);
          c.fill();
        }
        c.globalAlpha = 1;
      }
      skin.drawRunner(c, lx, top, sc, r.color, phase === "race" ? r.stride : 0, pose);
      // Encima: el "!" de la plantada y de la que recibe la escupida.
      if (beat && (beat.kind === "plantada" || beat.kind === "escupido")) {
        const pop = Math.min(1, beat.p * 5);
        const bx = lx + 18 * sc;
        const by = top - 7 * sc;
        c.fillStyle = INK;
        c.beginPath();
        c.arc(bx, by, 9 * u * pop, 0, 7);
        c.fill();
        c.fillStyle = "#ffc629";
        c.font = `900 ${13 * u * pop}px system-ui, sans-serif`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("!", bx, by + 1 * u);
        c.textAlign = "left";
        c.textBaseline = "alphabetic";
      }
      // La escupida cruza al carril de al lado, en arco.
      const esc = story.beats.find((bt) => bt.kind === "escupida" && bt.actor === k && bt.target !== undefined && q >= bt.at && q < bt.at + 0.05);
      if (esc && esc.target !== undefined) {
        const f = Math.min(1, (q - esc.at) / 0.03);
        const tr = runners[esc.target] as Runner;
        const x1 = lx + 22 * sc;
        const y1 = top + 3 * sc;
        const x2 = tr.x - camX + 20 * sc;
        const y2 = laneY(esc.target) - 8 * sc + 2 * sc;
        c.fillStyle = skin.voice === "R" ? "rgba(246,239,226,0.8)" : "#e8f6ff";
        for (let i = 0; i < 4; i++) {
          const g = Math.max(0, f - i * 0.08);
          if (g <= 0) continue;
          const mx = x1 + (x2 - x1) * g;
          const my = y1 + (y2 - y1) * g - Math.sin(Math.PI * g) * 26 * u;
          c.beginPath();
          c.arc(mx, my, (skin.voice === "R" ? 5 : 3) * u, 0, 7);
          c.fill();
        }
      }
      // El nombre. A 12·u el nombre medía el 1,7% del alto de pantalla:
      // proyectado en una sala no se lee. Y el del puntero va en amarillo, que
      // es la respuesta a "de lejos no se sabe quién va ganando".
      // Quién va primero ahora, no quién anunció el relator: el relator se
      // calla en los últimos metros y el resaltado quedaba en otra.
      const punta = phase === "race" && r === runners.reduce((a, b) => (b.x > a.x ? b : a));
      const label = vertical ? shorten(r.name.split(" ")[0] ?? r.name, 12) : shorten(r.name, 18);
      const fs = Math.max(13, Math.min(laneH * 0.42, (punta ? 19 : 16) * uc));
      c.font = `800 ${fs}px system-ui, sans-serif`;
      const tw = c.measureText(label).width;
      const hh = fs + 12 * uc, av = hh - 8 * uc;
      const cw = tw + av + 18 * uc;
      // Detrás de la llama y a su altura: arriba tapaba a la del carril de
      // encima, y en un celular a la propia.
      const chipX = lx - cw - 4 * uc;
      const chipY = ly + fs * 0.3;
      c.fillStyle = punta ? "#ffc629" : dark ? "#f6efe2" : "#fff";
      c.fillRect(chipX, chipY - hh * 0.64, cw, hh);
      c.lineWidth = (punta ? 3 : 2) * uc; c.strokeStyle = INK;
      c.strokeRect(chipX, chipY - hh * 0.64, cw, hh);
      drawAvatar(c, r.name, chipX + 4 * uc, chipY - hh * 0.5, av);
      c.fillStyle = "#191919";
      c.fillText(label, chipX + av + 10 * uc, chipY + fs * 0.34);
    });
    c.globalAlpha = 1;
    // La tabla de posiciones, como en la tele: en un celular es lo que cuenta
    // la carrera, porque los carriles son finitos y las ventajas se ven chicas.
    // Las filas se deslizan cuando alguien pasa a alguien.
    if (phase !== "count") {
      const ut = vertical ? Math.min(u, w / 560) : u;
      const x0 = 18 * ut;
      const y0 = chrome(c).arriba + 10 * ut;
      const rowH = 28 * ut;
      const bw = 190 * ut;
      c.font = `800 ${11 * ut}px ui-monospace, Consolas, monospace`;
      c.fillStyle = "rgba(246,239,226,0.75)";
      c.textBaseline = "top";
      const extra = names.length > runners.length ? ` · ${T[getLang()].cLanes(runners.length, names.length)}` : "";
      c.fillText(`${t("cTabla")}${vertical ? "" : extra}`, x0, y0);
      runners.forEach((r) => {
        const y = y0 + 18 * ut + r.row * rowH;
        const primero = Math.round(r.row) === 0;
        const gana = phase === "done" && r.i === winnerIdx;
        c.globalAlpha = apaga && !gana ? 0.35 : 1;
        c.fillStyle = primero || gana ? "#ffc629" : "rgba(20,14,30,0.78)";
        c.fillRect(x0, y, bw, rowH - 4 * ut);
        c.strokeStyle = INK;
        c.lineWidth = 2 * ut;
        c.strokeRect(x0, y, bw, rowH - 4 * ut);
        c.fillStyle = r.color;
        c.fillRect(x0 + 4 * ut, y + 4 * ut, 5 * ut, rowH - 12 * ut);
        c.font = `900 ${14 * ut}px system-ui, sans-serif`;
        c.fillStyle = primero || gana ? INK : "#f6efe2";
        c.fillText(String(Math.round(r.row) + 1), x0 + 14 * ut, y + 5 * ut);
        drawAvatar(c, r.name, x0 + 32 * ut, y + 4 * ut, rowH - 12 * ut);
        // El avatar deja el color cambiado: sin esto, los nombres salían en
        // tinta sobre el fondo oscuro.
        c.fillStyle = primero || gana ? INK : "#f6efe2";
        c.font = `800 ${13 * ut}px system-ui, sans-serif`;
        c.fillText(shorten(r.name, 16), x0 + 54 * ut, y + 6 * ut);
      });
      c.globalAlpha = 1;
      c.textBaseline = "alphabetic";
      // En vertical, la cuenta de cuántos corren va debajo de la tabla, no
      // detrás de la caja del relator.
      if (vertical && extra) {
        c.font = `700 ${11 * ut}px ui-monospace, Consolas, monospace`;
        c.fillStyle = "rgba(246,239,226,0.6)";
        c.fillText(T[getLang()].cLanes(runners.length, names.length), x0, y0 + 18 * ut + runners.length * rowH + 14 * ut);
      }
    }
    c.restore();

    // La tarjeta del ganador, igual que en los otros cuatro juegos. Sin esto,
    // el nombre solo aparecía en la caja del narrador y no se leía de lejos.
      // El fogonazo del revelado: el golpe visual que separa "apareció un
      // nombre" de "pasó algo". Va debajo del cartel, no encima.
    flashScreen(c, w, h, flashK);
    if (phase === "done" && tFreeze > 0.25) {
      const e = 1 + 2.70158 * Math.pow(Math.min(1, (tFreeze - 0.25) * 2.4) - 1, 3)
        + 1.70158 * Math.pow(Math.min(1, (tFreeze - 0.25) * 2.4) - 1, 2);
      drawWinnerPlate(c, winnerNames(names, winners), w / 2, h * 0.34, u, e);
    }

    // Countdown gigante
    if (phase === "count") {
      const n = Math.max(1, 3 - Math.floor(tPhase));
      c.font = `900 ${180 * u}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillStyle = INK;
      c.fillText(String(n), w / 2 + 6 * u, h * 0.36 + 6 * u);
      c.fillStyle = color(0);
      c.fillText(String(n), w / 2, h * 0.36);
      c.textAlign = "left";
    }
  }

  function drawRange(arr: Ridge[], parallax: number, baseY: number, w: number, h: number): void {
    const c = ctx as CanvasRenderingContext2D;
    c.beginPath();
    c.moveTo(-40, h * baseY);
    for (const p of arr) {
      const sx = p.dx * L() * 1.15 - camX * parallax;
      if (sx < -w * 0.3 || sx > w * 1.3) continue;
      if (skin.ridgeShape === "domes") {
        // Planetas asomando por el horizonte: media elipse trazada a mano para
        // que el contorno siga siendo un solo camino relleno.
        const rx = p.w * w;
        const ry = h * p.h;
        c.lineTo(sx - rx, h * baseY);
        for (let a = Math.PI; a >= 0; a -= Math.PI / 24) {
          c.lineTo(sx + Math.cos(a) * rx, h * baseY - Math.sin(a) * ry);
        }
        c.lineTo(sx + rx, h * baseY);
      } else {
        c.lineTo(sx - p.w * w, h * baseY);
        c.lineTo(sx, h * (baseY - p.h));
        c.lineTo(sx + p.w * w, h * baseY);
      }
    }
    c.lineTo(w + 40, h * baseY);
    c.closePath();
    c.fill();
  }

  let tPrev = performance.now();
  const tStart = tPrev;
  let rafId = 0;
  const pace = paceFactor();
  function loop(now: number): void {
    // El mismo factor de ritmo que los demás juegos: estira todo junto.
    const dt = Math.min(0.05, (now - tPrev) / 1000) / pace;
    tPrev = now;
    update(dt);
    drawScene();
    if (phase !== "dead") rafId = requestAnimationFrame(loop);
  }

  function cleanup(): void {
    phase = "dead";
    cancelAnimationFrame(rafId);
    removeEventListener("resize", resize);
    ov.style.display = "none";
    document.body.style.overflow = "";
    registerSkip(null);
    setPickSeed(null);
    stopNarrator();
    $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
    done();
  }

  rafId = requestAnimationFrame((now) => { tPrev = now; loop(now); });
}
