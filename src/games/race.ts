import { $ } from "../dom";
import { T, getLang, setPickSeed, t } from "../i18n";
import { LCOLORS, avatar, instantMode, paceFactor, type Beacon } from "../state";
import { beep, beepFor, fanfare, note } from "../sound";
import { THEMES, type ThemeId } from "./themes";
import { registerSkip, drawWinnerPlate, flashScreen, shorten, winnerNames, winnersLabel } from "./overlay";
import { narrate, stopNarrator } from "../narrator";

/* Modo estadio: carrera de llamas a pantalla completa, sembrada con la semilla. */

interface Runner {
  i: number;
  name: string;
  color: string;
  x: number;
  v: number;
  n1: number;
  img: HTMLImageElement | null;
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
    i, name: names[i] ?? "", color: color(k), x: 0, v: 0, n1: rng() * 7, img: null,
  }));
  runners.forEach((r) => {
    const im = new Image();
    im.src = avatar(r.name, 64);
    r.img = im;
  });
  // Arrancan justo después de la línea de salida, no cortadas en el borde
  runners.forEach((r) => { r.x = canvas.width * 0.05; });

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
  /** Momento de la carrera en que el ganador empieza a remontar. */
  const SURGE_AT = 0.8;
  let phase: "count" | "race" | "done" | "dead" = "count";
  let tPhase = 0, tRace = 0, camX = 0, shake = 0, lastLeader = -1, leadCd = 0, saidLast = false, finished = false, tFreeze = 0;
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
    winner().x = L();
    runners.forEach((r) => {
      if (r.i !== winnerIdx) r.x = Math.min(r.x, L() - W() * 0.12) || L() * 0.9;
    });
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
    tRace += dt;
    const baseV = L() / DUR;
    const prog = tRace / DUR;
    const cap = L() - W() * 0.055;
    raceAudio(dt, prog);

    // El pelotón corre por su cuenta; al ganador lo ubicamos después, según
    // dónde esté el pelotón. Antes el ganador aceleraba en el segundo 9 de 15 y
    // desde ahí no lo alcanzaba nadie: la sala sabía el final y los últimos
    // cuatro segundos sobraban. Ahora va atrás y remonta al final.
    const pack = runners.filter((r) => r.i !== winnerIdx);
    const wr = winner();
    const packLeader = pack.reduce((a, b) => (b.x > a.x ? b : a), pack[0] ?? wr);
    const packBack = pack.reduce((a, b) => (b.x < a.x ? b : a), pack[0] ?? wr);
    for (const r of pack) {
      r.n1 += dt * (0.9 + 0.3 * (r.i % 3));
      // Más variación: con 0,92 a 1,14 el pelotón salía como un bloque, y un
      // bloque no tiene carrera adentro.
      let mult = 0.87 + 0.33 * (0.5 + 0.5 * Math.sin(r.n1 * 1.7 + r.i));
      // La banda elástica juntaba al pelotón en el 28% del ancho, y de lejos
      // eso se lee como una sola mancha: los ocho corredores y sus ocho
      // carteles caían uno encima de otro. Abierta al 46% se ve quién va
      // adelante sin leer nada, que es lo único que la sala quiere saber.
      if (r.x < packLeader.x - W() * 0.4) mult *= 1.22;
      r.x = Math.min(r.x + baseV * mult * dt, cap);
    }

    if (prog < SURGE_AT) {
      // Se queda en el tercio de atrás, visible pero lejos de la punta.
      const want = prog < 0.5 ? 0.32 : 0.12; // 0 = último del pelotón, 1 = puntero
      const target = packBack.x + (packLeader.x - packBack.x) * want;
      wr.n1 += dt * 1.1;
      const drift = 0.5 + 0.5 * Math.sin(wr.n1 * 2.1);
      wr.x += (target - wr.x) * Math.min(1, dt * 2.2) + baseV * (0.88 + 0.14 * drift) * dt;
    } else {
      // Remontada: la velocidad se calcula para llegar justo cuando se acaba el
      // tiempo, así nunca se amontona en la meta ni llega antes de hora.
      const timeLeft = Math.max(0.2, (1 - prog) * DUR);
      wr.x += Math.max(baseV * 1.1, (L() - wr.x) / timeLeft) * dt;
    }
    const leader = runners.reduce((a, b) => (b.x > a.x ? b : a));
    if (leader.i !== lastLeader && tRace > 1 && leadCd <= 0 && !saidLast) {
      lastLeader = leader.i;
      // En segundos reales: el habla no se estira con el selector, así que en
      // rápido este cooldown valía 1,28 s y las frases se cortaban entre ellas.
      leadCd = 1.6;
      say(T[getLang()].cLead(leader.name), 0.3 + 0.4 * prog);
      beep(note(12), 0.12, "triangle", 0.05);
      setTimeout(() => beep(note(15), 0.1, "triangle", 0.04), 70);
    }
    leadCd -= dt * paceFactor();
        // 740 Hz era un fa sostenido: el único tono fuera de la escala del juego, y
    // marcaba justo el momento más importante.
    if (!saidLast && prog > SURGE_AT) {
      saidLast = true;
      say(t("cLast"), 0.85);
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
    if (wr.x >= L()) finishNow();
  }

  function drawScene(): void {
    const c = ctx as CanvasRenderingContext2D;
    const w = W(), h = H(), u = h / 720;
    const shx = shake ? (rng() - 0.5) * 14 * shake * u : 0;
    const shy = shake ? (rng() - 0.5) * 10 * shake * u : 0;
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
    const tNow = performance.now() / 1000;
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
    const trackTop = h * 0.42, trackH = h * 0.5;
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
    const startX = 40 * u - camX;
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
    // Llamas
    runners.forEach((r, k) => {
      const ly = trackTop + trackPad + k * laneH + laneH * 0.5;
      const lx = r.x - camX;
      if (lx < -140 || lx > w + 140) return;
      const sc = Math.min(laneH * 0.62, 78 * u) / 26;
      const bob = phase === "race" ? Math.sin(tRace * 16 + k * 2) * 3 * u : 0;
      skin.drawRunner(c, lx, ly - 8 * sc + bob, sc, r.color, phase === "race" ? tRace * 14 + k : 0);
      // Chip con nombre y avatar. A 12·u el nombre medía el 1,7% del alto de
      // pantalla: proyectado en una sala no se lee. Y el del puntero va en
      // amarillo, que es la respuesta a "de lejos no se sabe quién va ganando".
      const punta = r.i === lastLeader && phase === "race";
      const label = shorten(r.name, 18);
      const fs = Math.max(13, (punta ? 19 : 16) * u);
      c.font = `800 ${fs}px system-ui, sans-serif`;
      const tw = c.measureText(label).width;
      const hh = fs + 12 * u;
      const chipY = ly - Math.min(laneH * 0.52, 32 * u), av = hh - 8 * u;
      c.fillStyle = punta ? "#ffc629" : dark ? "#f6efe2" : "#fff";
      c.fillRect(lx - 4 * u, chipY - hh * 0.64, tw + av + 18 * u, hh);
      c.lineWidth = (punta ? 3 : 2) * u; c.strokeStyle = INK;
      c.strokeRect(lx - 4 * u, chipY - hh * 0.64, tw + av + 18 * u, hh);
      if (r.img && r.img.complete && r.img.naturalWidth) {
        c.drawImage(r.img, lx, chipY - hh * 0.5, av, av);
      }
      c.fillStyle = "#191919";
      c.fillText(label, lx + av + 6 * u, chipY + fs * 0.34);
    });
    // Cuántos corren de cuántos. Con ocho carriles y doscientos inscritos,
    // callarlo hace pensar que el sorteo fue entre ocho.
    if (names.length > runners.length) {
      c.font = `700 ${12 * u}px ui-monospace, Consolas, monospace`;
      c.textAlign = "left";
      c.fillStyle = "rgba(246,239,226,0.6)";
      c.fillText(T[getLang()].cLanes(runners.length, names.length), 22 * u, h - 26 * u);
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
