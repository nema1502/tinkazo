import type { Game } from "../state";

/**
 * La miniatura animada de cada juego, en su botón del selector.
 *
 * Los nombres no dicen nada por sí solos. "Cierre de Libro" y "Pasanaku" no le
 * cuentan nada a alguien que llega por primera vez, y elegir a ciegas entre
 * seis botones de texto es un mal momento justo antes de lo divertido.
 *
 * Cada miniatura muestra en tres segundos lo que hace el juego: la llama
 * corriendo, el paquete saltando entre estrellas, las tarjetas barriéndose, el
 * aguayo cerrándose, la rueda girando. Nada de esto decide nada ni toca el
 * protocolo: es dibujo.
 *
 * Todas comparten un solo bucle de animación y se dibujan chiquitas, así que
 * seis corriendo a la vez cuestan menos que una de las escenas del estadio.
 */

const W = 54;
const H = 30;
const INK = "#191919";

type Painter = (c: CanvasRenderingContext2D, t: number, col: (k: number) => string) => void;

/** Una llama en cuatro rectángulos, la misma silueta de la mascota. */
function llama(c: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  c.fillStyle = fill;
  const r = (rx: number, ry: number, rw: number, rh: number): void =>
    c.fillRect(x + rx * s, y + ry * s, rw * s, rh * s);
  r(2, 11, 16, 7);
  r(15, 3, 4, 10);
  r(14, 0, 8, 4);
  r(20, -2, 2, 3);
  r(0, 9, 3, 4);
  r(3, 18, 2.5, 6);
  r(12.5, 18, 2.5, 6);
}

/** Una estrella de cuatro puntas, la de la constelación. */
function estrella(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  const P = [[1, 0.42], [0.42, 0.42], [0.42, 1], [-0.42, 1], [-0.42, 0.42], [-1, 0.42],
    [-1, -0.42], [-0.42, -0.42], [-0.42, -1], [0.42, -1], [0.42, -0.42], [1, -0.42]] as const;
  c.beginPath();
  P.forEach(([px, py], i) => {
    const ax = x + px * r;
    const ay = y + py * r;
    if (i === 0) c.moveTo(ax, ay);
    else c.lineTo(ax, ay);
  });
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

const PAINTERS: Record<string, Painter> = {
  /** Dos llamas corriendo hacia la meta. */
  race(c, t, col) {
    c.fillStyle = "#2a2146";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(246,239,226,0.18)";
    c.fillRect(0, H * 0.5, W, 1);
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.42 + i * 0.4) % 1.25) - 0.1;
      llama(c, p * W - 4, 3 + i * 13, 0.42, col(i));
    }
    c.fillStyle = "#f6efe2";
    for (let i = 0; i < 6; i++) c.fillRect(W - 6 + (i % 2) * 3, i * 5, 3, 5);
  },
  /** La misma pista, en el espacio. */
  rockets(c, t, col) {
    c.fillStyle = "#12102c";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(246,239,226,0.5)";
    for (let i = 0; i < 10; i++) c.fillRect((i * 17 + 5) % W, (i * 11 + 3) % H, 1, 1);
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.5 + i * 0.4) % 1.25) - 0.1;
      const x = p * W;
      const y = 7 + i * 13;
      c.fillStyle = col(i + 2);
      c.fillRect(x, y, 11, 5);
      c.fillRect(x + 11, y + 1, 3, 3);
      c.fillStyle = "#ff7a1a";
      c.fillRect(x - 4 - (t * 30) % 2, y + 1, 4, 3);
    }
  },
  /** El paquete saltando de estrella en estrella. */
  stellar(c, t, col) {
    c.fillStyle = "#0c0a24";
    c.fillRect(0, 0, W, H);
    const pts = [[9, 21], [20, 8], [34, 22], [45, 10]] as const;
    c.strokeStyle = col(0);
    c.lineWidth = 1.4;
    const step = (t * 0.9) % (pts.length - 1);
    const i = Math.floor(step);
    const f = step - i;
    for (let k = 0; k < i; k++) {
      c.beginPath();
      c.moveTo(pts[k]![0], pts[k]![1]);
      c.lineTo(pts[k + 1]![0], pts[k + 1]![1]);
      c.stroke();
    }
    pts.forEach(([x, y], k) => estrella(c, x, y, k === i + 1 && f > 0.7 ? 4.4 : 3.2, col(k)));
    const a = pts[i]!;
    const b = pts[Math.min(i + 1, pts.length - 1)]!;
    c.fillStyle = "#ffc629";
    c.save();
    c.translate(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
    c.rotate(t * 2);
    c.fillRect(-2.5, -2.5, 5, 5);
    c.restore();
  },
  /** La barra de cierre barriendo tarjetas. */
  ledger(c, t, col) {
    c.fillStyle = "#231b36";
    c.fillRect(0, 0, W, H);
    const y = ((t * 0.5) % 1) * H;
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 4; k++) {
        const cy = 4 + r * 8;
        if (cy < y - 2) continue;
        c.fillStyle = "#2f2547";
        c.fillRect(4 + k * 12, cy, 10, 6);
        c.fillStyle = col(r + k);
        c.fillRect(4 + k * 12, cy, 2, 6);
      }
    }
    c.fillStyle = "#00a896";
    c.fillRect(0, y - 1.5, W, 3);
  },
  /** El aguayo cerrándose sobre los bultos. */
  pasanaku(c, t, col) {
    c.fillStyle = "#1d1428";
    c.fillRect(0, 0, W, H);
    const k = 0.6 + 0.4 * Math.abs(Math.sin(t * 0.8));
    const hw = 22 * k;
    for (let b = 0; b < 5; b++) {
      c.fillStyle = col(b);
      c.fillRect(W / 2 - hw, 6 + b * 3.6 * k, hw * 2, 3.6 * k);
    }
    c.strokeStyle = INK;
    c.lineWidth = 1.2;
    c.strokeRect(W / 2 - hw, 6, hw * 2, 18 * k);
    for (let b = 0; b < 3; b++) {
      const a = t * 1.2 + b * 2.1;
      c.fillStyle = col(b + 1);
      c.fillRect(W / 2 + Math.cos(a) * hw * 0.4 - 2.5, 12 + Math.sin(a) * 4 - 2.5, 5, 5);
    }
  },
  /** La rueda girando. */
  wheel(c, t, col) {
    c.fillStyle = "#1a1330";
    c.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    const r = 12;
    c.save();
    c.translate(cx, cy);
    c.rotate(t * 1.6);
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, r, (i / 8) * 7, ((i + 1) / 8) * 7);
      c.closePath();
      c.fillStyle = col(i);
      c.fill();
    }
    c.restore();
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(cx - 3, cy - r - 4);
    c.lineTo(cx + 3, cy - r - 4);
    c.lineTo(cx, cy - r + 2);
    c.closePath();
    c.fill();
  },
};

let running = false;

/**
 * Pone una miniatura animada en cada botón del selector.
 *
 * Se llama una vez al cargar. Si un botón no está, simplemente no se dibuja:
 * nada de esto es necesario para sortear.
 */
export function initThumbs(games: readonly Game[]): void {
  const cs = getComputedStyle(document.documentElement);
  const palette = ["--magenta", "--orange", "--teal", "--purple", "--yellow"].map((v) =>
    cs.getPropertyValue(v).trim() || "#e93d9c",
  );
  const col = (k: number): string => palette[((k % 5) + 5) % 5] ?? "#e93d9c";

  const canvases: { c: CanvasRenderingContext2D; paint: Painter }[] = [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (const g of games) {
    const btn = document.getElementById(`g-${g}`);
    const paint = PAINTERS[g];
    if (!btn || !paint) continue;
    const cv = document.createElement("canvas");
    cv.className = "thumb";
    cv.width = W * dpr;
    cv.height = H * dpr;
    cv.setAttribute("aria-hidden", "true");
    const ctx = cv.getContext("2d");
    if (!ctx) continue;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    btn.insertBefore(cv, btn.firstChild);
    canvases.push({ c: ctx, paint });
  }
  if (canvases.length === 0 || running) return;
  running = true;

  // Un solo bucle para las seis. A esta escala el costo es despreciable, y se
  // frena cuando la pestaña no está visible.
  const loop = (now: number): void => {
    if (document.visibilityState === "visible") {
      const t = now / 1000;
      for (const { c, paint } of canvases) {
        c.clearRect(0, 0, W, H);
        paint(c, t, col);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
