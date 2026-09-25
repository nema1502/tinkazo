import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, ease, mount, drawWinnerPlate, shorten, winnerNames, winnersLabel } from "./overlay";

/**
 * Constelación Stellar.
 *
 * La Carrera Stellar era la carrera de llamas con otra piel. Se notaba en el
 * propio código: había que pintar la pista más clara que el cielo "para que los
 * cohetes no se pierdan", que es la confesión de que en el espacio no hay piso.
 * Mientras hubiera carriles y una meta a la derecha, iba a ser la misma carrera.
 *
 * Lo que el espacio sí pide es lo que Stellar hace de verdad: un pago que salta
 * de nodo en nodo hasta encontrar ruta al destinatario. De ahí sale una mecánica
 * distinta, con salto y aterrizaje en vez de avance continuo; cada participante
 * tiene su estrella, así que con doscientos nadie se queda sin aparecer, cosa
 * que en ocho carriles es imposible; y al terminar queda dibujada una
 * constelación, que es una imagen que una carrera no puede producir.
 *
 * El ganador llega dado. Lo único sembrado es dónde cae cada estrella y por
 * dónde rebota el paquete antes del último salto.
 */

type Phase = "arm" | "hop" | "nova" | "dead";

interface Node {
  x: number;
  y: number;
  kind: "star" | "anchor";
  idx: number;
  r: number;
  flare: number;
  seen: number;
  born: number;
}

interface Hop {
  from: number;
  to: number;
  dur: number;
  cx: number;
  cy: number;
}

/** Saltos del recorrido. El último es el único que toca al ganador. */
const K = 20;
/** Cuánto dura la fase de armado, antes del primer salto. */
// El armado del tablero. Dos segundos y pico no alcanzan para que la sala gire
// la cabeza y además lea de qué se trata: los primeros segundos de un show son
// llamada de atención, no información.
const ARM = 3.0;

/**
 * Los primeros seis saltos aceleran y después todo se frena.
 *
 * Una desaceleración pura desde el arranque se lee como "esto ya va a
 * terminar" desde el segundo tres. Acelerar primero hace que la sala aprenda
 * el ritmo y se relaje justo antes de que empiece a costar.
 */
function hopDur(i: number): number {
  const p = i / (K - 1);
  // Los veinte saltos sumaban 9,3 segundos y el juego entero 11,5, así que el
  // selector de duración lo tenía que estirar más de dos veces para llegar a
  // media pantalla de tiempo. Ahora suman 14,5: el mismo dibujo del ritmo
  // ·acelera, después se frena· con espacio para que se sienta.
  if (p < 0.28) return 0.62 - 0.4 * (p / 0.28);
  const v = (p - 0.28) / 0.72;
  return 0.22 + 1.95 * Math.pow(v, 2.4);
}

export function stellarConstellation(
  names: string[],
  winners: readonly number[],
  beacon: Beacon,
  done: () => void,
): void {
  // La animación se centra en el primero; el cartel y el narrador cantan
  // a todos. Con tres premios sorteados, la sala tiene que oír tres nombres.
  const winnerIdx = winners[0] ?? 0;
  const st = mount(beacon, done, () => skip());
  if (!st) {
    done();
    return;
  }
  const { c, W, H, u, rng, color, say, chip, dark, cleanup, run } = st;

  const nodes: Node[] = [];
  let WIN_NODE = 0;
  let DECOY = 0;
  let hops: Hop[] = [];

  let phase: Phase = "arm";
  let tPhase = 0;
  let tAll = 0;
  let hopI = 0;
  let hopT = 0;
  let camRot = 0;
  let camScale = 1;
  /**
   * Cuánto se acerca la cámara al paquete, de 0 a 1. En los saltos lentos del
   * final el paquete era una miga cruzando un cielo casi quieto: con pocos
   * participantes, casi cinco segundos sin que la pantalla cambiara. El primer
   * plano es el suspenso; al estallar la nova la cámara se aleja y muestra la
   * constelación entera, que es el remate.
   */
  let focusK = 0;
  let focusX = 0;
  let focusY = 0;
  let shake = 0;
  let novaK = 0;
  let saidNarrow = false;
  let saidReady = false;
  let saidBuild = false;
  let tHold = 0;
  let saidDecoy = false;
  let bornTicks = 0;
  let barTick = 0;
  const trail: { x: number; y: number }[] = [];
  const links: { a: number; b: number; c: string }[] = [];
  const chips: { node: number; a: number }[] = [];

  // ---------------------------------------------------------------- escenario
  const neb = Array.from({ length: 3 }, (_, k) => ({
    x: 0.1 + rng() * 0.8,
    y: 0.1 + rng() * 0.7,
    r: 220 + rng() * 160,
    ph: rng() * 7,
    col: k % 2 ? "233,61,156" : "108,76,224",
  }));
  const layer = (n: number, r: number, v: number): { x: number; y: number; r: number; v: number; ph: number }[] =>
    Array.from({ length: n }, () => ({ x: rng(), y: rng(), r, v, ph: rng() * 7 }));
  const back = [...layer(120, 0.6, 2), ...layer(80, 1, 5), ...layer(50, 1.6, 9)];

  /** Coloca a todos en una grilla con temblor: nunca se superponen, a cualquier n. */
  function build(): void {
    nodes.length = 0;
    const w = W();
    const h = H();
    const k = u();
    const n = names.length;
    const x0 = w * 0.08;
    const x1 = w * 0.94;
    const y0 = h * 0.14;
    const y1 = h * 0.84;
    const cols = Math.max(1, Math.round(Math.sqrt((n * (x1 - x0)) / (y1 - y0))));
    const rows = Math.ceil(n / cols);
    const cw = (x1 - x0) / cols;
    const ch = (y1 - y0) / rows;
    const r = clamp(Math.min(cw, ch) * 0.3, 4 * k, 26 * k);
    for (let i = 0; i < n; i++) {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      nodes.push({
        x: x0 + cw * (cx + 0.5) + (rng() - 0.5) * cw * 0.62,
        y: y0 + ch * (cy + 0.5) + (rng() - 0.5) * ch * 0.62,
        kind: "star",
        idx: i,
        r,
        flare: 0,
        seen: 0,
        born: 0.6 + (i / n) * 1,
      });
    }
    // Los rombos intermedios son las trustlines por las que rebota el pago.
    // Con pocos participantes hacen falta más, porque nadie recibe el pago más
    // de tres veces y el paquete necesita a dónde ir. Pero no veinte: con dos
    // o tres participantes la pantalla se volvía un campo de rombos con un par
    // de estrellas perdidas. Ocho alcanzan para los veinte saltos.
    const anchors = clamp(22 - n * 2, 8, 20);
    // Con poca gente, casi todos los saltos caen en rombos: tienen que verse.
    // Eran de catorce píxeles con dos participantes, y el cielo quedaba en dos
    // estrellas y polvo.
    const ar = (n <= 6 ? 11 : 7) * k;
    for (let a = 0; a < anchors; a++) {
      for (let tryI = 0; tryI < 8; tryI++) {
        const x = x0 + rng() * (x1 - x0);
        const y = y0 + rng() * (y1 - y0);
        if (nodes.some((q) => Math.hypot(q.x - x, q.y - y) < 1.4 * r)) continue;
        // De a uno, intercalados con las estrellas: el cielo se arma a la vista.
        nodes.push({ x, y, kind: "anchor", idx: -1, r: ar, flare: 0, seen: 0, born: 0.3 + (a / anchors) * 1.5 });
        break;
      }
    }
    WIN_NODE = nodes.findIndex((q) => q.idx === winnerIdx);
    if (WIN_NODE < 0) WIN_NODE = 0;
    DECOY = pickDecoy();
    hops = buildHops();
    // Lo que dura sin estirar: el armado del tablero más la suma de los veinte
    // saltos. Sale de los saltos de verdad y no de una constante, para que no
    // se despegue si `hopDur` cambia.
    setGameLength(ARM + hops.reduce((a, h) => a + h.dur, 0), WINNER_HOLD);
  }

  /** El señuelo es una estrella vecina del ganador: el engaño tiene que ser corto. */
  function pickDecoy(): number {
    const win = nodes[WIN_NODE] as Node;
    const near = nodes
      .map((q, i) => ({ i, d: Math.hypot(q.x - win.x, q.y - win.y) }))
      .filter((q) => q.i !== WIN_NODE && nodes[q.i]?.kind === "star")
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    return near.length ? (near[Math.floor(rng() * near.length)] as { i: number }).i : WIN_NODE;
  }

  function buildHops(): Hop[] {
    const w = W();
    const h = H();
    const minD = 0.18 * Math.min(w, h);
    const pool = nodes.map((_, i) => i).filter((i) => i !== WIN_NODE);
    // Entra siempre por la izquierda: el ojo sabe dónde mirar al arrancar.
    let first = pool[0] ?? 0;
    for (const i of pool) if ((nodes[i] as Node).x < (nodes[first] as Node).x) first = i;
    const seq = [first];
    for (let i = 1; i < K; i++) {
      const prev = seq[i - 1] as number;
      let to = -1;
      for (let a = 0; a < 8 && to < 0; a++) {
        const wantStar = rng() < 0.62;
        const cand = pool.filter((j) => {
          const q = nodes[j] as Node;
          // Nadie recibe el pago más de tres veces: con dos participantes el
          // paquete no puede quedar rebotando en la única estrella que hay.
          return q.seen < 3 && (a > 3 || (q.kind === "star") === wantStar);
        });
        if (!cand.length) break;
        const j = cand[Math.floor(rng() * cand.length)] as number;
        const q = nodes[j] as Node;
        const p = nodes[prev] as Node;
        // Ningún salto mide menos del 18% del lado corto: todos se ven.
        if (j !== prev && Math.hypot(q.x - p.x, q.y - p.y) > minD) to = j;
      }
      if (to < 0) to = pool[Math.floor(rng() * pool.length)] ?? prev;
      (nodes[to] as Node).seen++;
      seq.push(to);
    }
    seq.push(WIN_NODE);
    return seq.slice(1).map((to, i) => {
      const a = nodes[seq[i] as number] as Node;
      const b = nodes[to] as Node;
      const d = nodes[DECOY] as Node;
      const last = i === K - 1;
      return {
        from: seq[i] as number,
        to,
        dur: hopDur(i),
        // En el último salto la curva se apoya en el señuelo, así que el
        // paquete parece ir para allá hasta que ya no.
        cx: last ? d.x * 0.86 + b.x * 0.14 : (a.x + b.x) / 2,
        cy: last ? d.y * 0.86 + b.y * 0.14 : (a.y + b.y) / 2,
      };
    });
  }

  build();

  // -------------------------------------------------------------------- lógica
  function packetPos(): { x: number; y: number } {
    const hp = hops[hopI] as Hop;
    const a = nodes[hp.from] as Node;
    const b = nodes[hp.to] as Node;
    const p = ease.inOutCubic(hopT);
    const q = 1 - p;
    return {
      x: q * q * a.x + 2 * q * p * hp.cx + p * p * b.x,
      y: q * q * a.y + 2 * q * p * hp.cy + p * p * b.y,
    };
  }

  function arrive(ni: number): void {
    const n = nodes[ni] as Node;
    n.flare = 1;
    links.push({ a: (hops[hopI] as Hop).from, b: ni, c: color(hopI) });
    // Una nota por salto, subiendo la escala pentatónica. Antes eran dos
    // sonidos superpuestos con hercios sueltos, y sonaban desafinados entre
    // ellos: el tono subía, sí, pero el resultado era ruido de aparato.
    //
    // Ahora suena un solo golpe por aterrizaje, y el timbre dice de qué se
    // trata: suave y redondo cuando el pago rebota en un rombo, brillante
    // cuando toca a una persona. El oído lo aprende en dos saltos.
    if (n.idx >= 0) {
      // Un grado por salto y sin techo llevaba los últimos aterrizajes a
      // 2,1-3,5 kHz, donde el sonido ya no tiene cuerpo: el ascenso adelgazaba
      // en vez de crecer. Medio grado por salto se queda dentro del registro
      // que reproduce un parlante de sala, y desde el salto doce se dobla una
      // octava abajo, que es como se gana cuerpo sin subir.
      const deg = 5 + Math.round(hopI * 0.53);
      beep(note(deg), 0.16, "triangle", 0.05);
      if (hopI >= 12) beep(note(Math.max(0, deg - 5)), 0.2, "sine", 0.04);
      chips.push({ node: ni, a: 1 });
      if ((hops[hopI] as Hop).dur > 0.3 && n.idx !== winnerIdx) {
        say(T[getLang()].cConstPass(names[n.idx] ?? ""), 0.25 + 0.4 * (hopI / K));
      }
    } else {
      beep(note(2 + Math.round(hopI * 0.4)), 0.1, "sine", 0.03);
    }
  }

  function toNova(): void {
    phase = "nova";
    tPhase = 0;
    novaK = 0;
    shake = 1;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    fanfare();
    // Una octava abajo del grado 0 son 65 Hz: inaudible en cualquier parlante
    // de sala. Y los adornos caían a 10 y 20 ms de notas de la fanfarria que
    // suenan al doble de volumen: quedaban enmascarados.
    beep(note(0), 0.8, "sine", 0.08);
    setTimeout(() => beep(note(15), 0.14, "triangle", 0.045), 520);
    setTimeout(() => beep(note(18), 0.14, "triangle", 0.035), 700);
  }

  /** Saltar deja exactamente la misma imagen final, solo que sin la espera. */
  function skip(): void {
    if (phase === "nova" || phase === "dead") return;
    for (let i = hopI; i < hops.length; i++) {
      const hp = hops[i] as Hop;
      links.push({ a: hp.from, b: hp.to, c: color(i) });
    }
    hopI = hops.length - 1;
    hopT = 1;
    (nodes[WIN_NODE] as Node).flare = 1;
    toNova();
  }

  function update(dt: number): void {
    if (phase === "arm") {
      tPhase += dt;
      // La cámara entra despacio mientras se arma el cielo. El armado eran
      // cinco segundos reales de estrellitas apareciendo sobre fondo quieto:
      // desde el fondo de la sala, una foto. El auditor exigente midió siete
      // segundos y medio sin que la pantalla cambiara lo suficiente.
      const desde = names.length <= 6 ? 0.7 : 0.84;
      camScale = desde + (1 - desde) * ease.inOutCubic(clamp(tPhase / ARM, 0, 1));
      if (tPhase >= 0.05 && !saidBuild) {
        saidBuild = true;
        say(t("cConstBuild"), 0.1);
      }
      // Doscientas estrellas apareciendo no pueden sonar a ametralladora: como
      // mucho veinticuatro golpecitos, repartidos en el segundo que dura.
      // Las estrellas encendiéndose: notas de la escala, suaves, subiendo.
      const want = Math.floor(clamp((tPhase - 0.6) / 1, 0, 1) * Math.min(18, names.length));
      while (bornTicks < want) {
        // Llegaba al grado 25: los últimos seis eran silbidos, y a 0,016 de
        // volumen ninguno se oía en una sala.
        beep(note(4 + Math.round(bornTicks * 0.4)), 0.07, "sine", 0.028);
        bornTicks++;
      }
      // Con cierre. `barTick === 0` se cumple durante 0,15 s de juego, o sea
      // unos siete cuadros, y `say` se disparaba en cada uno cancelando al
      // anterior: el narrador tartamudeaba justo al arrancar.
      if (tPhase >= 1.6 && !saidReady) {
        saidReady = true;
        say(t("cConstReady"), 0.1);
      }
      const ticks = [1.75, 1.95, 2.15];
      while (barTick < 3 && tPhase >= (ticks[barTick] as number)) {
        beep(note(5 + barTick * 2), 0.12, "triangle", 0.045);
        barTick++;
      }
      if (tPhase >= ARM) {
        phase = "hop";
        hopI = 0;
        hopT = 0;
        say(t("cRouteFound"), 0.35);
        beep(note(10), 0.3, "triangle", 0.055);
        beep(note(5), 0.34, "sine", 0.035);
      }
      return;
    }

    if (phase === "hop") {
      const hp = hops[hopI] as Hop;
      // El vuelo del paquete era mudo, y en los últimos saltos eso es casi un
      // segundo de silencio con la única cosa que importa moviéndose.
      if (hopT === 0) beepFor(note(4 + Math.round(hopI * 0.5)), hp.dur * 0.6, "sine", 0.02);
      if (hopT === 0 && hopI === K - 1) {
        say(t("cConstLast"), 0.85);
        // Tres cuartos del salto, no el salto entero: el último cuarto va mudo
        // a propósito. Un cuarto de segundo de silencio antes del golpe es el
        // efecto más barato que existe y no estaba en ninguno de los juegos.
        beepFor(note(0), hp.dur * 0.72, "sawtooth", 0.04);
      } else if (!saidNarrow && hopI === 15 && hopT >= 0.45) {
        // A mitad del salto y no al arrancarlo: al arrancar pisaba, un cuadro
        // después, el "¡pasa por fulano!" del salto anterior, y la caja
        // mostraba ese nombre durante dieciséis milisegundos.
        say(t("cConstNarrow"), 0.6);
        saidNarrow = true;
      }
      hopT += dt / hp.dur;
      if (hopI === K - 1 && !saidDecoy && hopT >= 0.72) {
        // El engaño: 380 ms yendo claramente hacia el vecino equivocado.
        (nodes[DECOY] as Node).flare = 1;
        say(t("cConstDecoy"), 0.95);
        // El señuelo: una nota alta que promete, y enseguida otra por debajo
        // que la contradice. Es el "casi" dicho en dos sonidos.
        // Mismo gesto, registro que se oye: el grado 24 son 3,5 kHz, donde el
        // mejor momento dramático del juego quedaba en un silbido.
        beep(note(15), 0.14, "triangle", 0.05);
        setTimeout(() => beep(note(11), 0.12, "sine", 0.04), 120);
        saidDecoy = true;
      }
      if (hopT >= 1) {
        hopT = 0;
        arrive(hp.to);
        hopI++;
        if (hopI >= hops.length) {
          hopI = hops.length - 1;
          toNova();
        }
      }
      camScale = 1 + 0.06 * (hopI / K);
      camRot = 0.021 * (hopI / K);
      focusK = ease.inOutCubic(clamp((hopI + hopT - 13) / 4, 0, 1));
      const pk = packetPos();
      focusX = pk.x;
      focusY = pk.y;
      return;
    }

    if (phase === "nova") {
      tPhase += dt;
      novaK = Math.min(1, novaK + dt);
      // La cámara se aleja para mostrar lo que quedó dibujado.
      focusK = Math.max(0, focusK - dt * 0.9);
      shake = Math.max(0, shake - dt * 1.5);
      // En segundos reales: eran 1,62 s de juego, o sea 1,3 s en modo rápido.
      tHold += dt * paceFactor();
      if (tHold >= WINNER_HOLD) {
        phase = "dead";
        cleanup();
      }
    }
  }

  // -------------------------------------------------------------------- dibujo
  function drawSpace(): void {
    const g = c.createLinearGradient(0, 0, 0, H());
    // El espacio no tiene modo día, pero un proyector en una sala con luz sí
    // necesita más piso de luminancia.
    g.addColorStop(0, dark ? "#070a24" : "#141a4e");
    g.addColorStop(1, dark ? "#180d36" : "#2d1a5e");
    c.fillStyle = g;
    c.fillRect(0, 0, W(), H());
  }

  function drawNebulae(now: number): void {
    const k = u();
    const a = dark ? 0.1 : 0.16;
    for (const n of neb) {
      const x = n.x * W() + Math.sin(now * 0.08 + n.ph) * 30 * k;
      const y = n.y * H();
      const r = n.r * k;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${n.col},${a})`);
      g.addColorStop(1, `rgba(${n.col},0)`);
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function drawBackStars(now: number): void {
    const k = u();
    const w = W();
    const span = w + 40 * k;
    c.fillStyle = dark ? "rgba(246,239,226,0.75)" : "rgba(255,246,233,0.90)";
    for (const s of back) {
      const x = ((((s.x * w - now * s.v * k) % span) + span) % span) - 20 * k;
      c.globalAlpha = 0.55 + 0.45 * Math.sin(now * 2 + s.ph);
      c.fillRect(x, s.y * H(), s.r * k, s.r * k);
    }
    c.globalAlpha = 1;
  }

  /** Vértices de la estrella: una cruz de doce puntas, en fracciones del radio. */
  const STAR = [
    [1, 0.42], [0.42, 0.42], [0.42, 1], [-0.42, 1], [-0.42, 0.42], [-1, 0.42],
    [-1, -0.42], [-0.42, -0.42], [-0.42, -1], [0.42, -1], [0.42, -0.42], [1, -0.42],
  ] as const;

  function drawStar(n: Node): void {
    const k = u();
    const grow = clamp((tAll - n.born) / 0.28, 0, 1);
    if (grow <= 0) return;
    const pop = grow < 1 ? 1 + 0.15 * Math.sin(grow * Math.PI) : 1;
    // Las estrellas respiran, cada una a su tiempo, más mientras la sala lee
    // el cielo y menos cuando el paquete ya está saltando. Con el cielo fijo,
    // el armado era una foto desde el fondo de la sala.
    const breath = 1 + (phase === "arm" ? 0.09 : 0.035) * Math.sin(tAll * 3.1 + n.x * 0.013 + n.y * 0.007);
    const r = n.r * (1 + 0.28 * n.flare) * grow * pop * breath;
    const col = color(n.idx);
    if (n.flare > 0) {
      c.globalAlpha = 0.35 * n.flare;
      c.fillStyle = col;
      c.beginPath();
      c.arc(n.x, n.y, r * 2.6, 0, 7);
      c.fill();
      // Y una onda que se abre desde la estrella. El paquete aterrizando era
      // un rombo de once píxeles tocando otra cosa chica: de cerca se veía, de
      // lejos no. La onda es lo que la sala ve como "tocó a alguien".
      const k = u();
      c.globalAlpha = n.flare;
      c.strokeStyle = col;
      c.lineWidth = 5 * k * n.flare;
      c.beginPath();
      c.arc(n.x, n.y, r * (1.4 + (1 - n.flare) * 4.2), 0, 7);
      c.stroke();
      c.globalAlpha = 1;
    }
    // Un solo trazado, para que el contorno de tinta no se corte por dentro.
    c.beginPath();
    STAR.forEach(([px, py], i) => {
      const x = n.x + px * r;
      const y = n.y + py * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    });
    c.closePath();
    c.fillStyle = col;
    c.fill();
    // Con muchos participantes la estrella es chica y el contorno se la come.
    if (r >= 8 * k) {
      c.lineWidth = Math.max(2, r * 0.22);
      c.strokeStyle = INK;
      c.stroke();
    }
    c.fillStyle = "#f6efe2";
    c.fillRect(n.x - r * 0.26, n.y - r * 0.26, r * 0.52, r * 0.52);
  }

  function drawAnchor(n: Node): void {
    const k = u();
    const grow = clamp((tAll - n.born) / 0.22, 0, 1);
    if (grow <= 0) return;
    // Al nacer y al recibir el paquete, una onda violeta: como las estrellas.
    // El rombo tocado era lo único del juego que no reaccionaba.
    const born = clamp(1 - (tAll - n.born) / 0.5, 0, 1);
    const wave = Math.max(n.flare, born);
    if (wave > 0) {
      c.globalAlpha = wave;
      c.strokeStyle = "#8f6cff";
      c.lineWidth = 4 * k * wave;
      c.beginPath();
      c.arc(n.x, n.y, n.r * (1.3 + (1 - wave) * 4.5), 0, 7);
      c.stroke();
      c.globalAlpha = 1;
    }
    const breath = 1 + (phase === "arm" ? 0.12 : 0.05) * Math.sin(tAll * 2.6 + n.x * 0.017 + n.y * 0.011);
    const s = n.r * grow * breath * (1 + 0.6 * n.flare);
    c.beginPath();
    c.moveTo(n.x, n.y - s);
    c.lineTo(n.x + s, n.y);
    c.lineTo(n.x, n.y + s);
    c.lineTo(n.x - s, n.y);
    c.closePath();
    c.strokeStyle = "#6c4ce0";
    c.lineWidth = 2 * k;
    c.stroke();
    c.fillStyle = "#6c4ce0";
    c.fillRect(n.x - 0.75 * k, n.y - 0.75 * k, 1.5 * k, 1.5 * k);
  }

  function drawLink(a: Node, b: Node, col: string, fat: boolean): void {
    const k = u();
    c.lineCap = "square";
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.strokeStyle = INK;
    c.lineWidth = (fat ? 10 : 7) * k;
    c.stroke();
    c.strokeStyle = col;
    c.lineWidth = (fat ? 5 : 3) * k;
    c.stroke();
  }

  function drawPacket(now: number): void {
    const k = u();
    trail.forEach((q, i) => {
      const p = i / trail.length;
      c.globalAlpha = 0.1 + 0.55 * p;
      c.fillStyle = p > 0.6 ? "#ff7a1a" : "#e93d9c";
      const s = (3 + 6 * p) * k;
      c.save();
      c.translate(q.x, q.y);
      c.rotate(Math.PI / 4);
      c.fillRect(-s / 2, -s / 2, s, s);
      c.restore();
    });
    c.globalAlpha = 1;
    const p = packetPos();
    // Era de once píxeles: el protagonista del juego, del tamaño de una miga.
    const s = 19 * k + Math.sin(now * 14) * 1.6 * k;
    c.globalAlpha = 0.22;
    c.fillStyle = "#ffc629";
    c.beginPath();
    c.arc(p.x, p.y, s * 1.5, 0, 7);
    c.fill();
    c.globalAlpha = 1;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(Math.PI / 4 + now * 1.6);
    c.fillStyle = "#ffc629";
    c.fillRect(-s / 2, -s / 2, s, s);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(-s / 2, -s / 2, s, s);
    c.fillStyle = "#ffffff";
    c.fillRect(-s / 6, -s / 6, s / 3, s / 3);
    c.restore();
  }

  function drawNova(): void {
    const n = nodes[WIN_NODE] as Node;
    const k = u();
    const e = 1 - Math.pow(1 - novaK, 2.2);
    for (const off of [0, 0.14, 0.28]) {
      const q = clamp((novaK - off) / (1 - off), 0, 1);
      if (q <= 0) continue;
      const r = 30 * k + q * 560 * k;
      c.globalAlpha = (1 - q) * 0.9;
      c.beginPath();
      c.arc(n.x, n.y, r, 0, 7);
      c.lineWidth = (14 - 10 * q) * k;
      c.strokeStyle = INK;
      c.stroke();
      c.lineWidth = (7 - 5 * q) * k;
      c.strokeStyle = off ? "#ff7a1a" : "#ffc629";
      c.stroke();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + novaK * 0.4;
      const L = 40 * k + e * 300 * k;
      const wd = 16 * k * (1 - novaK * 0.7);
      c.save();
      c.translate(n.x, n.y);
      c.rotate(a);
      c.beginPath();
      c.moveTo(0, -wd / 2);
      c.lineTo(L, 0);
      c.lineTo(0, wd / 2);
      c.closePath();
      c.fillStyle = "#ffc629";
      c.fill();
      c.lineWidth = 3 * k;
      c.strokeStyle = INK;
      c.stroke();
      c.restore();
    }
    if (novaK < 0.35) {
      c.fillStyle = `rgba(255,198,41,${0.3 * (1 - novaK / 0.35)})`;
      c.fillRect(0, 0, W(), H());
    }
  }

  function drawRouteBar(): void {
    const k = u();
    const w = W();
    const p = clamp((tPhase - 1.6) / 0.6, 0, 1);
    const bw = 340 * k;
    const bh = 26 * k;
    const bx = w / 2 - bw / 2;
    const by = H() * 0.86;
    c.fillStyle = INK;
    c.fillRect(bx + 5 * k, by + 5 * k, bw, bh);
    c.fillStyle = "#241a52";
    c.fillRect(bx, by, bw, bh);
    c.fillStyle = "#e93d9c";
    c.fillRect(bx, by, bw * p, bh);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(bx, by, bw, bh);
    c.font = `700 ${13 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "center";
    c.fillStyle = "#f6efe2";
    c.fillText(p < 1 ? t("cRoute") : t("cRouteFoundShort"), w / 2, by - 10 * k);
  }

  function drawWinnerCard(): void {
    // Amarillo con tinta encima es el par de mayor contraste de la paleta: se
    // lee desde el fondo de la sala con cualquier proyector. Si hubo varios
    // premios, se listan todos.
    drawWinnerPlate(c, winnerNames(names, winners), W() / 2, H() * 0.5, u(), ease.outBack(Math.min(1, novaK * 2.4)));
  }

  function draw(now: number): void {
    const k = u();
    // El temblor sale del reloj, no del azar sembrado. Llamar a `rng()` en el
    // dibujo consume la secuencia a la velocidad de los cuadros, así que la
    // misma ronda no se dibujaba igual a 60 Hz que a 144, y el proyecto entero
    // se apoya en que la misma ronda dé siempre lo mismo. No cambia quién gana,
    // pero contradice la promesa.
    const sx = shake ? Math.sin(tPhase * 97) * 8 * shake * k : 0;
    const sy = shake ? Math.sin(tPhase * 131 + 1.7) * 6 * shake * k : 0;
    c.save();
    c.translate(sx, sy);
    drawSpace();
    drawNebulae(now);
    drawBackStars(now);

    c.save();
    c.translate(W() / 2, H() / 2);
    c.rotate(camRot);
    // El primer plano: más cerca, y con el paquete corrido hacia el centro.
    const zoom = camScale * (1 + 0.45 * focusK);
    c.scale(zoom, zoom);
    c.translate(-W() / 2 + (W() / 2 - focusX) * focusK * 0.7, -H() / 2 + (H() / 2 - focusY) * focusK * 0.7);

    // En la nova la constelación entera engorda de golpe: es lo que convierte
    // veinte líneas sueltas en un dibujo.
    for (const l of links) {
      drawLink(nodes[l.a] as Node, nodes[l.b] as Node, l.c, phase === "nova");
    }
    for (const n of nodes) {
      if (n.kind === "anchor") drawAnchor(n);
      else drawStar(n);
    }
    if (phase === "hop") drawPacket(now);
    if (phase === "nova") drawNova();
    // Nunca los doscientos nombres a la vez: solo el actual y los anteriores
    // desvaneciéndose. Es lo que hace que doscientos se lean en un proyector.
    // Con pocos participantes los nombres quedan puestos todo el tiempo: si
    // solo aparecen cuando el paquete los toca, la sala no sabe quién es quién.
    // El chip de quien tiene el paquete ahora va más grande que los que se
    // desvanecen: es el único nombre que importa en ese instante, y al tamaño
    // de textura quedaba ilegible en un proyector.
    const enMano = (hops[Math.min(hopI, hops.length - 1)] as Hop | undefined)?.to ?? -1;
    if (names.length <= 4) {
      for (const q of nodes) {
        if (q.idx < 0) continue;
        chip(names[q.idx] ?? "", q.x + q.r + 6 * k, q.y - q.r - 10 * k, 1, 1.6);
      }
    } else {
      for (const ch of chips) {
        const q = nodes[ch.node] as Node;
        // El chip queda opaco casi toda su vida: sobre el cielo oscuro, medio
        // transparente no se lee desde el fondo de la sala.
        if (q.idx < 0) continue;
        const vivo = ch.node === enMano;
        chip(
          names[q.idx] ?? "",
          q.x + q.r + 6 * k,
          q.y - q.r - 10 * k,
          Math.min(1, ch.a * 3),
          vivo ? 1.7 : 1,
        );
      }
    }
    c.restore();

    if (phase === "arm") drawRouteBar();
    if (phase === "hop") {
      c.font = `700 ${11 * k}px ui-monospace, Consolas, monospace`;
      c.textAlign = "left";
      c.fillStyle = "rgba(246,239,226,0.55)";
      c.fillText(`${t("cHop")} ${hopI + 1}/${K}`, 22 * k, chrome(c).arriba + 22 * k);
    }
    if (phase === "nova") drawWinnerCard();
    c.restore();
  }

  run((dt, now) => {
    tAll += dt;
    update(dt);
    if (phase === "hop") {
      trail.push(packetPos());
      if (trail.length > 14) trail.shift();
    }
    for (const n of nodes) n.flare = Math.max(0, n.flare - dt * 2.2);
    for (let i = chips.length - 1; i >= 0; i--) {
      const ch = chips[i] as { a: number };
      ch.a = Math.max(0, ch.a - dt * 0.8);
      if (ch.a <= 0) chips.splice(i, 1);
    }
    draw(now);
  });
}
