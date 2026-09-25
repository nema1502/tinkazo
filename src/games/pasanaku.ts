import { T, getLang, t } from "../i18n";
import { beep, beepFor, fanfare, note } from "../sound";
import { paceFactor, setGameLength, type Beacon } from "../state";
import { INK, WINNER_HOLD, chrome, clamp, drawFlag, ease, mount, drawWinnerPlate, flashScreen, shorten, winnerNames, winnersLabel } from "./overlay";

/**
 * Pasanaku.
 *
 * El *Diccionario de americanismos* lo define, bajo la grafía `pasanacu`, como
 * "juego que consiste en sortear el dinero de las cuotas semanales o mensuales
 * de los participantes". O sea que no hubo que forzar nada: el pasanaku ya es
 * un sorteo, y uno que miles de bolivianos corren todos los meses con la misma
 * promesa que vende Tinkazo, que el orden lo decida algo que nadie pueda
 * arreglar.
 *
 * Un aguayo tendido en el suelo. Cada participante tira su bulto encima y se
 * tejen los hilos entre vecinos: esos hilos son las trustlines, porque a un
 * pasanaku solo entrás con gente de la que aceptarías plata. Después la tela
 * se empieza a cerrar y los bultos que quedan fuera del aro salen por el
 * borde. **El que sale no pierde: ya cobró**, que es exactamente como funciona.
 * Al final queda uno en el nudo, se ata con un cordón tricolor y se levanta.
 *
 * Escala al revés que la ruleta: con doscientos es un hervidero, y con dos son
 * dos atados forcejeando dentro de un nudo que se aprieta, que es todavía más
 * dramático.
 *
 * La física no decide nada. El orden de salida está sembrado con la ronda y el
 * ganador va primero en esa lista, así que nunca lo expulsan.
 */

type Phase = "spread" | "drop" | "weave" | "cinch" | "knot" | "lift" | "dead";

interface Bundle {
  idx: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Giro propio y fase del temblor, sembrados: nada queda nunca quieto. */
  rot: number;
  wob: number;
  ph: number;
  alive: boolean;
  /** Cuándo salió, para la caída y la pila de abajo. */
  out: number;
  /** Posición final en la pila de los que ya cobraron. */
  slot: number;
  /** Los dos vecinos del anillo: sus hilos. */
  a: number;
  b: number;
}

/** Paso fijo de la simulación. Sin esto la misma ronda dibuja distinto en
 *  una máquina de 60 Hz y en una de 144, y todo el proyecto se apoya en que
 *  la misma ronda dé siempre lo mismo. */
const DT = 1 / 120;

/* El juego duraba 8,6 segundos hasta la levantada, y las dos escenas que más
   valen duraban nada: el tejido de los hilos, que es lo que enseña qué es una
   trustline, tenía 0,8 segundos, y el nudo apretándose 1,3. Ahora dura 16,5 y
   el tiempo nuevo está casi todo ahí: tejido y apretones. */
const T_DROP = 1.0;
const T_WEAVE = 3.4;
const T_CINCH = 5.4;
/** Cuánto dura el apretón entero, repartido entre los tirones que haya. */
const CINCH_DUR = 7.5;
const T_KNOT = T_CINCH + CINCH_DUR;
const T_LIFT = 16.5;

export function pasanaku(
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

  const n = names.length;
  const FINAL = Math.min(3, n);
  /** Cuántos apretones. Suman siempre lo mismo, así que el total no cambia con n. */
  const PULLS = n <= 4 ? 1 : n <= 12 ? 2 : 3;
  // Lo que dura sin estirar: hasta que se levanta el aguayo.
  setGameLength(T_LIFT, WINNER_HOLD);
  const PULL_DUR = CINCH_DUR / PULLS;

  /**
   * El orden de salida. El ganador va primero y por lo tanto nunca lo
   * expulsan: la tela no decide nada, solo muestra lo que el protocolo decidió.
   */
  const rank = names.map((_, i) => i).filter((i) => i !== winnerIdx);
  for (let i = rank.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rank[i], rank[j]] = [rank[j] as number, rank[i] as number];
  }
  rank.unshift(winnerIdx);
  /** Puesto de cada persona: 0 es el ganador, el último es el primero en salir. */
  const place = new Map(rank.map((idx, pos) => [idx, pos]));

  let phase: Phase = "spread";
  let tAll = 0;
  let acc = 0;
  let cinchTotal = 0;
  let pulls = 0;
  let collected = 0;
  let dropTicks = 0;
  let weaveTicks = 0;
  let tHold = 0;
  let flashK = 0;
  let shake = 0;
  let knotHits = 0;
  let saidKnot = false;
  let tugs = 0;
  let lastTug = -99;
  let saidUpTo = -1;
  let lastOut = -999;
  let liftK = 0;
  const bundles: Bundle[] = [];

  const C = (): { x: number; y: number; k: number } => ({ x: W() / 2, y: H() * 0.47, k: u() });
  const R0 = (): number => Math.min(H() * 0.46, W() * 0.34);
  const Rc = (): number => R0() * (1 - 0.62 * cinchTotal);
  // Los bultos ocupan como mucho un quinto de la tela: si tapan el aguayo se
  // pierde el tablero, que es justamente lo que cuenta el juego.
  const rad = (): number => clamp(Math.sqrt((Rc() * Rc() * 0.20) / n), 7 * u(), 30 * u());

  /* Los bultos arrancan arriba y caen escalonados. */
  {
    const { x, y } = C();
    const r0 = R0();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.2;
      const d = 0.3 + rng() * 0.6;
      bundles.push({
        idx: i,
        x: x + Math.cos(a) * r0 * d,
        y: y + Math.sin(a) * r0 * d * 0.62,
        vx: 0,
        vy: 0,
        rot: rng() * Math.PI,
        wob: 1.4 + rng() * 2.2,
        ph: rng() * 7,
        alive: true,
        out: 0,
        slot: 0,
        a: (i + 1) % n,
        b: (i + n - 1) % n,
      });
    }
  }

  const alive = (): Bundle[] => bundles.filter((q) => q.alive);

  /* ----------------------------------------------------------------- física */
  function step(dt: number): void {
    const { x: cx, y: cy, k } = C();
    const list = alive();
    const r = rad();
    for (const q of list) {
      // La tela empuja hacia el centro, más fuerte cuanto más apretado está.
      const dx = cx - q.x;
      const dy = (cy - q.y) * 1.6;
      const d = Math.hypot(dx, dy) || 1;
      const g = 220 * k * (0.25 + cinchTotal);
      q.vx += (dx / d) * g * dt;
      q.vy += (dy / d) * g * dt;
      // Temblor sembrado: nada queda nunca quieto.
      q.vx += Math.sin(tAll * q.wob + q.ph) * 26 * k * dt;
      q.vy += Math.cos(tAll * q.wob * 0.83 + q.ph) * 26 * k * dt;
      q.vx *= 0.965;
      q.vy *= 0.965;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vx * dt * 0.01;
    }
    // Empuje entre pares que se solapan, mitad para cada uno. Con doscientos
    // son veinte mil comprobaciones por paso, menos de un milisegundo. Arriba
    // de cuatrocientos convendría una grilla de celdas.
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Bundle;
      for (let j = i + 1; j < list.length; j++) {
        const q = list[j] as Bundle;
        const dx = q.x - p.x;
        const dy = (q.y - p.y) / 0.62;
        const d = Math.hypot(dx, dy);
        const min = r * 2;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        const ux = dx / d;
        const uy = dy / d;
        p.x -= ux * push;
        p.y -= uy * push * 0.62;
        q.x += ux * push;
        q.y += uy * push * 0.62;
      }
    }
    // El aro elíptico contiene a los que siguen adentro.
    const rr = Rc();
    for (const q of list) {
      const dx = q.x - cx;
      const dy = (q.y - cy) / 0.62;
      const d = Math.hypot(dx, dy);
      const lim = rr - r;
      if (d <= lim || d === 0) continue;
      const ux = dx / d;
      const uy = dy / d;
      q.x = cx + ux * lim;
      q.y = cy + uy * lim * 0.62;
      q.vx *= -0.42;
      q.vy *= -0.42;
    }
    // Los que ya cobraron caen a la pila de abajo.
    for (const q of bundles) {
      if (q.alive) continue;
      q.out += dt;
      q.vy += 900 * k * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += dt * 3;
      // Se apilan en una franja abajo: con doscientos, la pila crece y se
      // vuelve una barra de progreso hecha de cuerpos.
      const r = rad();
      const cols = Math.max(1, Math.floor((W() - 120 * u()) / (r * 2.2)));
      const col = q.slot % cols;
      const row = Math.floor(q.slot / cols);
      const tx = 60 * u() + col * r * 2.2 + r;
      const ty = H() - 56 * u() - row * r * 1.5;
      if (q.out > 0.45) {
        const sp = Math.min(1, dt * 6);
        q.x += (tx - q.x) * sp;
        q.y += (ty - q.y) * sp;
        q.vx *= 0.6;
        q.vy *= 0.6;
      } else if (q.y > ty) {
        q.y = ty;
        q.vy *= -0.25;
        q.vx *= 0.8;
      }
    }
  }

  /** Saca a los que toca. Nunca al ganador: su puesto es el 0. */
  function evict(keep: number): void {
    const list = alive().sort((a, b) => (place.get(b.idx) ?? 0) - (place.get(a.idx) ?? 0));
    const { x: cx, y: cy, k } = C();
    for (const q of list) {
      if (alive().length <= keep) break;
      q.alive = false;
      q.out = 0;
      q.slot = collected++;
      const a = Math.atan2(q.y - cy, q.x - cx);
      q.vx = Math.cos(a) * 380 * k;
      q.vy = Math.sin(a) * 380 * k - 160 * k;
      // Con mucha gente no suena cada salida: sería una ametralladora.
      // Dos notas que bajan: "ya cobró", dicho sin palabras.
      if (n <= 40 || collected % 6 === 0) {
        beep(note(7), 0.09, "sine", 0.03);
        setTimeout(() => beep(note(5), 0.09, "sine", 0.026), 60);
      }
      // El penúltimo no se anuncia: sale 0,15 s de juego antes del cartel, y
      // su línea duraba un cuarto de segundo antes de que la pisara la corona.
      if (tAll - lastOut > 0.5 && alive().length <= 8 && keep > 1) {
        lastOut = tAll;
        say(T[getLang()].cPasOut(names[q.idx] ?? ""), 0.5);
      }
    }
  }

  function skip(): void {
    if (phase === "lift" || phase === "dead") return;
    cinchTotal = 1;
    evict(1);
    tAll = T_LIFT;
    phase = "lift";
    crown();
  }

  let crowned = false;
  function crown(): void {
    if (crowned) return;
    crowned = true;
    flashK = 1;
    shake = 1;
    say(T[getLang()].cWin(winnersLabel(names, winners)), 1);
    // 90 Hz no sale por el parlante de ninguna sala: el golpe de la levantada,
    // que es el clímax del juego, se perdía entero.
    beep(note(0), 0.7, "sine", 0.09);
    fanfare();
    // A 150 y 300 ms caían dentro de la fanfarria, que suena al doble: estaban
    // escritos y no existían. Después del acorde sí se oyen.
    setTimeout(() => beep(note(17), 0.12, "triangle", 0.045), 520);
    setTimeout(() => beep(note(19), 0.12, "triangle", 0.035), 700);
  }

  /* ----------------------------------------------------------------- guion */
  function script(dt: number): void {
    const cues: [number, () => void][] = [
      [0.05, () => say(t("cPasSpread"), 0.1)],
      [T_DROP + 0.1, () => say(t("cPasDrop"), 0.2)],
      // La línea que enseña: en dos segundos la sala ve una red de confianza y
      // oye que no hay contrato. Eso es la trustline sin decir "trustline".
      [T_WEAVE, () => say(t("cPasWeave"), 0.3)],
    ];
    for (let i = saidUpTo + 1; i < cues.length; i++) {
      const cue = cues[i] as [number, () => void];
      if (tAll < cue[0]) break;
      saidUpTo = i;
      cue[1]();
    }

    if (phase === "cinch") {
      const want = Math.min(PULLS, Math.floor((tAll - T_CINCH) / PULL_DUR) + 1);
      while (pulls < want) {
        pulls++;
        // Tope en 0,75. A 0,9 el anuncio del apretón superaba por más de tres
        // décimos a las salidas ·que van en 0,5· y las cortaba por la mitad:
        // "¡Sale Rodrigo Peña, ya l" al trece por ciento. Quién cobró importa
        // más que anunciar que se aprieta, y ahora espera turno en vez de pisar.
        const calor = Math.min(0.75, 0.3 + pulls * 0.15);
        say(t(pulls === 1 ? "cPasCinch" : pulls === 2 ? "cPasCinch2" : "cPasCinch3"), calor);
        // 109, 98 y 87 Hz: el último está fuera de escala y ninguno sale por el
        // parlante de un proyector. Y 0,7 s reales para un apretón de 1,96 s
        // dejaban al nudo cerrándose en silencio, 2,4 s en épico. Ahora baja un
        // grado por apretón y dura el apretón entero.
        beepFor(note(Math.max(0, 4 - (pulls - 1) * 2)), PULL_DUR + 0.2, "sawtooth", 0.03);
      }
      // Cada apretón son tres tirones, con golpe y sacudida de la tela. El
      // último apretón no saca a nadie ·ya quedan los finalistas· y eran
      // cuatro segundos reales de un zumbido parejo: la sala no tenía nada
      // nuevo que mirar ni que oír justo antes del nudo.
      // Un tirón por segundo de juego como mucho, no un tercio del apretón:
      // con dos participantes hay un solo apretón de 7,5 segundos, y en tercios
      // quedaban cuatro segundos reales entre tirón y tirón. El que cae justo
      // donde arranca un apretón no suena: ahí ya suena el apretón.
      const tug = Math.min(1, PULL_DUR / 3);
      const wantTugs = Math.floor((tAll - T_CINCH) / tug);
      while (tugs < wantTugs) {
        tugs++;
        const fase = (tugs * tug) % PULL_DUR;
        if (fase < 0.2 || PULL_DUR - fase < 0.2) continue;
        lastTug = tAll;
        beep(note(3), 0.08, "square", 0.04);
      }
      const p = clamp((tAll - T_CINCH) / CINCH_DUR, 0, 1);
      cinchTotal = ease.outCubic(p) * 0.86 + 0.035 * Math.exp(-(tAll - lastTug) * 9);
      // Cuántos quedan vivos según lo avanzado del apretón.
      const target = Math.max(FINAL, Math.round(n * (1 - p) ** 1.5));
      if (alive().length > target) evict(target);
      return;
    }

    if (phase === "knot") {
      cinchTotal = 0.86 + 0.12 * clamp((tAll - T_KNOT) / (T_LIFT - T_KNOT), 0, 1);
      const hits = Math.floor((tAll - T_KNOT) / 0.14);
      while (knotHits < hits) {
        knotHits++;
        // El único sonido de altura al azar del producto, y a 0,012 de volumen
        // no se oía: el nudo apretándose era mudo.
        // Los últimos cuatro décimos de juego van mudos: la tela sigue
        // cerrándose y no se oye nada, que es lo que hace que la levantada
        // golpee.
        if (knotHits % 2 === 0 && tAll < T_LIFT - 0.4) beep(note(15), 0.035, "sine", 0.024);
      }
      // El penúltimo sale cerca del final y deja a uno solo.
      if (tAll >= T_LIFT - 0.15 && alive().length > 1) {
        beep(note(1), 0.35, "sine", 0.07);
        evict(1);
      } else if (alive().length > FINAL) {
        evict(FINAL);
      }
      // Con cierre, no con `knotHits === 1`: esa condición se cumple unos
      // catorce cuadros seguidos, y en cada uno el relator elegía otra variante
      // de la frase. El auditor exigente midió ocho cambios del comentario en
      // dos décimas de segundo, justo en el nudo.
      if (knotHits >= 1 && !saidKnot) {
        saidKnot = true;
        say(t("cPasKnot"), 0.9);
      }
      return;
    }

    if (phase === "lift") {
      liftK = Math.min(1, liftK + dt * 0.8);
      crown();
    }
  }

  /* ---------------------------------------------------------------- dibujo */
  function drawRoom(now: number): void {
    // Es el único juego que pide luz: la constelación es de noche y el Cierre
    // de Libro es papel frío.
    c.fillStyle = dark ? "#1b1224" : "#f3e6d2";
    c.fillRect(0, 0, W(), H());
    const { x, y } = C();
    const g = c.createRadialGradient(x, y, 0, x, y, Math.max(W(), H()) * 0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    // La viñeta respira: nunca queda del todo quieta.
    g.addColorStop(1, `rgba(0,0,0,${0.22 + 0.03 * Math.sin(now * 0.6)})`);
    c.fillStyle = g;
    c.fillRect(0, 0, W(), H());
  }

  /** El borde de la tela nunca es un círculo: siempre ondula. */
  function clothR(a: number, now: number, rr: number): number {
    return rr * (1 + 0.06 * Math.sin(3 * a + now * 1.4) + liftK * 0.22 * Math.sin(4 * a));
  }

  function clothPath(now: number, rr: number, scale = 1): void {
    const { x, y } = C();
    c.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = clothR(a, now, rr) * scale;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.62 - liftK * 70 * u();
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
    c.closePath();
  }

  /**
   * El aguayo.
   *
   * La primera versión eran anillos concéntricos y no se leía como una tela:
   * se leía como un blanco de tiro. Un aguayo es **rectangular y de franjas
   * horizontales**, con bandas lisas anchas (pampa) y bandas angostas con
   * rombos tejidos (pallay) entre medio. Eso es lo que hace que un boliviano
   * lo reconozca de una y un extranjero vea una tela y no un gráfico.
   *
   * Se dibuja en perspectiva, como tendido en el suelo: más angosto arriba que
   * abajo. El borde ondula siempre, porque una tela no tiene bordes rectos.
   */
  function drawAguayo(now: number): void {
    const { x, y, k } = C();
    const rr = Rc();
    const lift = liftK * 70 * k;
    const grow = phase === "spread" ? ease.outBack(clamp(tAll / T_DROP, 0, 1)) : 1;

    // Sombra en el suelo.
    c.save();
    c.globalAlpha = 0.35;
    c.fillStyle = INK;
    c.beginPath();
    c.ellipse(x, y + 22 * k, rr * 1.15, rr * 0.44, 0, 0, 7);
    c.fill();
    c.restore();

    // La tela en perspectiva: el borde de arriba más corto que el de abajo.
    const halfB = rr * 1.02;
    const halfT = rr * 0.74;
    const top = y - lift - rr * 0.6 * grow;
    const bot = y - lift + rr * 0.6 * grow;
    /** El ancho de la tela a una altura dada, con la ondulación del borde. */
    const halfAt = (p: number): number =>
      (halfT + (halfB - halfT) * p) * (1 + 0.035 * Math.sin(p * 7 + now * 1.4));

    c.save();
    // Recorta todo lo que venga al contorno de la tela.
    c.beginPath();
    c.moveTo(x - halfAt(0), top);
    for (let i = 0; i <= 20; i++) {
      const p = i / 20;
      c.lineTo(x + halfAt(p), top + (bot - top) * p);
    }
    for (let i = 20; i >= 0; i--) {
      const p = i / 20;
      c.lineTo(x - halfAt(p), top + (bot - top) * p);
    }
    c.closePath();
    c.save();
    c.clip();

    // Las franjas, de arriba abajo. Anchas de color, angostas con rombos.
    const pal = ["#e93d9c", "#ff7a1a", "#00a896", "#6c4ce0", "#ffc629"];
    const bands = 9;
    for (let b = 0; b < bands; b++) {
      const p0 = b / bands;
      const p1 = (b + 1) / bands;
      const yy0 = top + (bot - top) * p0;
      const yy1 = top + (bot - top) * p1;
      const pallay = b % 2 === 1;
      c.fillStyle = pallay
        ? dark ? "#efe4cf" : "#fbf3e4"
        : pal[Math.floor(b / 2) % pal.length] ?? "#e93d9c";
      c.fillRect(x - halfB * 1.1, yy0, halfB * 2.2, yy1 - yy0 + 1);
      if (!pallay) continue;
      // La banda de pallay: rombos de tinta, que es el diseño tejido.
      const mid = (yy0 + yy1) / 2;
      const sz = (yy1 - yy0) * 0.38;
      const half = halfAt((p0 + p1) / 2);
      const step = sz * 2.6;
      // Un paso de cero no avanza nunca y este `for` no termina: cuelga la
      // pestaña entera, sin excepción y sin cuadro dibujado. Pasa en el primer
      // cuadro, donde `dt` vale 0 y `ease.outBack(0)` no devuelve cero sino
      // 2,2e-16: la tela mide 1e-13 px de alto, `yy1 - yy0` se redondea contra
      // `top` y el paso se va con él. Medio píxel no dibuja nada igual.
      if (!(step > 0.5)) continue;
      c.fillStyle = INK;
      for (let px = x - half + step / 2; px < x + half; px += step) {
        c.beginPath();
        c.moveTo(px, mid - sz);
        c.lineTo(px + sz, mid);
        c.lineTo(px, mid + sz);
        c.lineTo(px - sz, mid);
        c.closePath();
        c.fill();
      }
    }
    c.restore();

    // El contorno, con el mismo camino que sirvió de recorte.
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.stroke();
    c.restore();
  }

  function drawCorners(now: number): void {
    const { x, y, k } = C();
    const rr = Rc();
    const lift = liftK * 70 * k;
    // Las cuatro puntas se levantan y ondean.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const up = (cinchTotal * 0.6 + liftK) * 130 * k + Math.sin(now * 2 + i) * 6 * k;
      const bx = x + Math.cos(a) * rr;
      const by = y + Math.sin(a) * rr * 0.62 - lift;
      c.beginPath();
      c.moveTo(bx - 26 * k, by);
      c.quadraticCurveTo(bx, by - up * 0.6, x + Math.cos(a) * rr * 0.2, by - up);
      c.quadraticCurveTo(bx, by - up * 0.4, bx + 26 * k, by);
      c.closePath();
      c.fillStyle = ["#e93d9c", "#ff7a1a", "#00a896", "#6c4ce0"][i] ?? "#e93d9c";
      c.fill();
      c.lineWidth = 2 * k;
      c.strokeStyle = INK;
      c.stroke();
    }
  }

  function drawThreads(): void {
    const k = u();
    c.lineWidth = 3 * k;
    const byIdx = new Map(bundles.map((q) => [q.idx, q]));
    for (const q of bundles) {
      if (!q.alive) continue;
      for (const other of [q.a, q.b]) {
        const o = byIdx.get(other);
        if (!o || !o.alive || o.idx < q.idx) continue;
        c.globalAlpha = 0.75;
        c.strokeStyle = color(q.idx);
        c.beginPath();
        c.moveTo(q.x, q.y);
        c.lineTo(o.x, o.y);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
  }

  function drawBundle(q: Bundle, now: number): void {
    const k = u();
    const r = q.alive ? rad() : rad() * 0.8;
    const col = color(q.idx);
    c.save();
    c.translate(q.x, q.y - (q.alive ? liftK * 70 * k : 0));
    c.rotate(q.rot + 0.12 * Math.sin(now * 1.1 + q.ph));
    c.fillStyle = INK;
    c.fillRect(-r + 3 * k, -r + 3 * k, r * 2, r * 2);
    c.fillStyle = col;
    c.fillRect(-r, -r, r * 2, r * 2);
    c.lineWidth = 2.5 * k;
    c.strokeStyle = INK;
    c.strokeRect(-r, -r, r * 2, r * 2);
    // Las dos orejitas del atado, como un bulto de apthapi.
    c.beginPath();
    c.moveTo(-r * 0.5, -r);
    c.lineTo(-r * 0.15, -r * 1.45);
    c.lineTo(r * 0.15, -r);
    c.moveTo(r * 0.15, -r);
    c.lineTo(r * 0.5, -r * 1.4);
    c.lineTo(r * 0.75, -r);
    c.closePath();
    c.fillStyle = col;
    c.fill();
    c.strokeStyle = INK;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.35)";
    c.fillRect(-r * 0.6, -r * 0.6, r * 0.3, r * 0.3);
    c.restore();
  }

  function drawPot(): void {
    const k = u();
    const put = phase === "spread" ? 0 : Math.min(n, Math.floor(clamp((tAll - T_DROP) / 1.6, 0, 1) * n));
    const label = `${t("cPasPot")}  ${Math.max(put, collected ? n : put)} / ${n}`;
    c.font = `700 ${14 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "center";
    const bw = c.measureText(label).width + 40 * k;
    const bh = 40 * k;
    const bx = 22 * k;
    const by = 92 * k;
    c.fillStyle = INK;
    c.fillRect(bx + 5 * k, by + 5 * k, bw, bh);
    c.fillStyle = dark ? "#221a33" : "#ffffff";
    c.fillRect(bx, by, bw, bh);
    c.lineWidth = 3 * k;
    c.strokeStyle = INK;
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = dark ? "#f6efe2" : INK;
    c.textBaseline = "middle";
    c.fillText(label, bx + bw / 2, by + bh / 2);
    c.textBaseline = "alphabetic";
    // Los cantos de las monedas apiladas debajo: la pila crece mientras cae la
    // cuota de cada uno.
    //
    // Eran catorce barras rectas del ancho de la caja del pote, y a tamaño de
    // celular eso no se lee como una pila de monedas: se lee como un código de
    // barras naranja flotando en una esquina. Son elipses, más angostas que la
    // caja, apenas desalineadas entre ellas, que es como se apila plata de
    // verdad.
    const coins = Math.min(put, 14);
    const cw = Math.min(82 * k, bw - 40 * k);
    const cx0 = bx + bw / 2;
    for (let i = 0; i < coins; i++) {
      const off = Math.sin(i * 2.1) * 4 * k;
      const cy = by + bh + 18 * k + (coins - 1 - i) * 7 * k;
      c.fillStyle = INK;
      c.beginPath();
      c.ellipse(cx0 + off, cy + 2 * k, cw / 2 + 2 * k, 5.4 * k, 0, 0, 7);
      c.fill();
      c.fillStyle = i % 2 ? "#ffc629" : "#ff7a1a";
      c.beginPath();
      c.ellipse(cx0 + off, cy, cw / 2, 3.6 * k, 0, 0, 7);
      c.fill();
    }
  }

  function drawKnot(now: number): void {
    const { x, y, k } = C();
    const ky = y - liftK * 70 * k - Rc() * 0.9;
    c.save();
    c.translate(x, ky);
    c.rotate(0.06 * Math.sin(now * 3));
    // El cordón tricolor: es lo que ata el nudo, así que es funcional. Aparece
    // un segundo y medio, al final, cuando ya no hay tensión que robar.
    c.fillStyle = INK;
    c.fillRect(-17 * k, -7 * k, 34 * k, 26 * k);
    drawFlag(c, -14 * k, -4 * k, 28 * k, 20 * k);
    c.restore();
  }

  function drawWinnerCard(): void {
      // El fogonazo del revelado: el golpe visual que separa "apareció un
      // nombre" de "pasó algo". Va debajo del cartel, no encima.
    flashScreen(c, W(), H(), flashK);
    drawWinnerPlate(c, winnerNames(names, winners), W() / 2, H() * 0.74, u(), ease.outBack(Math.min(1, liftK * 1.6)), 54);
  }

  function drawHud(): void {
    const k = u();
    c.font = `700 ${11 * k}px ui-monospace, Consolas, monospace`;
    c.textAlign = "left";
    c.fillStyle = dark ? "rgba(246,239,226,0.55)" : "rgba(25,25,25,0.55)";
    c.textAlign = "right";
    c.fillText(`${t("cWheelRound")} #${beacon.round}`, W() - 22 * k, H() - chrome(c).abajo);
    if (phase === "cinch") {
      c.fillText(`${t("cPasCinchLbl")} ${pulls}/${PULLS}`, W() - 22 * k, H() - chrome(c).abajo - 18 * k);
    }
    c.textAlign = "left";
  }

  /* ------------------------------------------------------------------ bucle */
  run((dt, now) => {
    tAll += dt;
    phase =
      tAll < T_DROP ? "spread"
        : tAll < T_WEAVE ? "drop"
          : tAll < T_CINCH ? "weave"
            : tAll < T_KNOT ? "cinch"
              : tAll < T_LIFT ? "knot"
                : "lift";

    if (phase === "drop") {
      const want = Math.floor(clamp((tAll - T_DROP) / (T_WEAVE - T_DROP), 0, 1) * Math.min(24, n));
      while (dropTicks < want) {
        // Siete alturas en ciclo, ninguna en escala: sonaba a marcador de
        // partidos. Dos notas que alternan dicen lo mismo y suenan bien.
        beep(note(dropTicks % 2 === 0 ? 5 : 8), 0.06, "triangle", 0.035);
        dropTicks++;
      }
    }
    // El tejido de los hilos era **mudo**, y es justo la escena que enseña qué
    // es una trustline: una red de confianza que nadie firma. Un hilo, una nota.
    if (phase === "weave") {
      const want = Math.floor(clamp((tAll - T_WEAVE) / (T_CINCH - T_WEAVE), 0, 1) * 18);
      while (weaveTicks < want) {
        beep(note(10 + (weaveTicks % 5)), 0.14, "sine", 0.025);
        weaveTicks++;
      }
    }
    script(dt);

    acc += dt;
    let guard = 0;
    while (acc >= DT && guard++ < 12) {
      step(DT);
      acc -= DT;
    }
    if (acc > DT) acc = 0;

    shake = Math.max(0, shake - dt * 2.2);
    // El temblor del golpe. La carrera y la constelación ya lo tenían; acá
    // faltaba, y es lo que hace que el revelado se sienta en el cuerpo y no
    // sólo se vea. Sale del reloj y no del azar, para que la misma ronda se
    // dibuje igual a 60 y a 144 cuadros por segundo.
    const tem = shake > 0;
    if (tem) {
      c.save();
      c.translate(Math.sin(shake * 97) * 9 * shake * u(), Math.sin(shake * 131 + 1.7) * 7 * shake * u());
    }
    drawRoom(now);
    drawAguayo(now);
    drawCorners(now);
    drawThreads();
    for (const q of bundles) if (!q.alive) drawBundle(q, now);
    for (const q of bundles) if (q.alive) drawBundle(q, now);
    // Con doscientos nombres a la vez no se lee nada: los chips solo cuando
    // quedan pocos, la misma regla que la constelación.
    const live = alive();
    if (live.length <= 8) {
      const r = rad();
      const k = u();
      // Se escalonan para que no se pisen cuando los bultos se juntan.
      // Se ordenan por altura y se escalonan de arriba hacia abajo: apilados
      // en el mismo lugar se tapaban entre ellos y no se leía ninguno.
      [...live]
        .sort((a, bb) => a.y - bb.y)
        .forEach((q, i) => {
          chip(names[q.idx] ?? "", q.x + r + 6 * k, q.y - r - 10 * k - liftK * 70 * k - i * 26 * k, 1);
        });
    }
    if (tem) c.restore();
    drawPot();
    drawHud();
    if (phase === "lift") {
      drawKnot(now);
      drawWinnerCard();
    }
    // En segundos reales: eran 1,7 s de juego, o sea 1,36 s en modo rápido.
    if (phase === "lift") tHold += dt * paceFactor();
    flashK = Math.max(0, flashK - dt * paceFactor() * 4);
    if (tHold >= WINNER_HOLD) {
      phase = "dead";
      cleanup();
    }
  });
}
