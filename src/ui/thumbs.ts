import type { Game } from "../state";

/**
 * La miniatura animada de cada juego, en su botón del selector.
 *
 * Los nombres no dicen nada por sí solos. "Cierre de Libro" y "Pasanaku" no le
 * cuentan nada a alguien que llega por primera vez, y elegir a ciegas entre
 * seis botones de texto es un mal momento justo antes de lo divertido.
 *
 * Cada miniatura muestra en unos segundos lo que hace el juego: las llamas
 * galopando, el paquete saltando de estrella en estrella, la barra barriendo
 * tarjetas, el aguayo cerrándose sobre los bultos, la rueda girando. Nada de
 * esto decide nada ni toca el protocolo: es dibujo.
 *
 * Fueron de 54x30 px y a ese tamaño no había nada que ver: una llama medía
 * nueve píxeles, un cohete eran dos rectángulos sobre fondo casi negro y el
 * libro se quedaba vacío media vuelta del ciclo. Ahora la escena tiene sitio,
 * las patas se mueven, el suelo corre y ninguna se queda quieta.
 *
 * Todas comparten un solo bucle de animación, y ese bucle se frena mientras
 * hay un sorteo en pantalla.
 */

const W = 116;
const H = 66;
const INK = "#191919";
const TAU = Math.PI * 2;

type Painter = (c: CanvasRenderingContext2D, t: number, col: (k: number) => string) => void;

/** Una llama, con las patas en movimiento. La misma silueta de la mascota. */
function llama(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  fill: string,
  gait: number,
): void {
  const r = (rx: number, ry: number, rw: number, rh: number): void =>
    c.fillRect(x + rx * s, y + ry * s, rw * s, rh * s);
  // El balanceo de las patas es lo que separa "algo se desliza" de "algo
  // corre". Cuesta dos senos y es la mitad de la miniatura.
  const a = Math.sin(gait) * 2.4;
  const b = Math.sin(gait + Math.PI) * 2.4;
  const bob = Math.sin(gait * 2) * 0.7;
  c.fillStyle = INK;
  r(3 + a - 0.4, 17.6, 3.3, 6.8);
  r(12.5 + b - 0.4, 17.6, 3.3, 6.8);
  c.fillStyle = fill;
  r(3 + a, 18, 2.5, 6);
  r(12.5 + b, 18, 2.5, 6);
  c.fillStyle = INK;
  r(1.4, 10.4 + bob, 17.2, 8.2);
  r(14.4, 2.4 + bob, 5.2, 11);
  r(13.4, -0.6 + bob, 9.2, 5.2);
  c.fillStyle = fill;
  r(2, 11 + bob, 16, 7);
  r(15, 3 + bob, 4, 10);
  r(14, 0 + bob, 8, 4);
  r(20, -2 + bob, 2, 3);
  r(0, 9 + bob, 3, 4);
  // El ojo, que es lo que hace que parezca un bicho y no un rectángulo.
  c.fillStyle = INK;
  r(18.6, 1.2 + bob, 1.6, 1.6);
}

/** Una estrella de cuatro puntas, la de la constelación. */
function estrella(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
): void {
  // Doce vértices de brazos rectos dan un signo de más, por angostos que sean:
  // una estrella necesita que la punta se afine. Ocho vértices alternando radio
  // lleno en las cuatro puntas y 0,28 en los valles de en medio.
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.28;
    const ax = x + Math.cos(a) * rr;
    const ay = y + Math.sin(a) * rr;
    if (i === 0) c.moveTo(ax, ay);
    else c.lineTo(ax, ay);
  }
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/** El suelo que corre: rayas que se desplazan, que es lo que da velocidad. */
function pista(c: CanvasRenderingContext2D, y: number, h: number, off: number, tint: string): void {
  c.fillStyle = tint;
  c.fillRect(0, y, W, h);
  c.fillStyle = "rgba(246,239,226,0.16)";
  for (let k = -1; k < 7; k++) {
    const x = (((k * 22 - off) % (W + 22)) + W + 22) % (W + 22) - 22;
    c.fillRect(x, y + h - 3, 13, 2);
  }
}

const PAINTERS: Record<string, Painter> = {
  /** Dos llamas galopando hacia la meta, con el suelo corriendo debajo. */
  race(c, t, col) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#3a2a63");
    g.addColorStop(1, "#6a3f7a");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // Cerros al fondo, para que el cielo no sea una plancha de color.
    c.fillStyle = "#2a2146";
    c.beginPath();
    c.moveTo(0, 30);
    for (let k = 0; k <= 6; k++) c.lineTo(k * 20, 30 - (k % 2 === 0 ? 10 : 3));
    c.lineTo(W, 30);
    c.lineTo(W, 0);
    c.lineTo(0, 0);
    c.closePath();
    c.fill();
    const off = t * 58;
    pista(c, 30, 18, off, "#4a3566");
    pista(c, 48, 18, off * 1.25, "#573d74");
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.34 + i * 0.5) % 1.12) - 0.06;
      llama(c, p * W - 8, 8 + i * 18, 1.05, col(i), t * 11 + i * 2);
    }
    // El arco de meta, siempre a la vista: dice adónde se corre.
    c.fillStyle = INK;
    c.fillRect(W - 13, 26, 3, 40);
    for (let yy = 0; yy < 8; yy++) {
      c.fillStyle = yy % 2 === 0 ? "#f6efe2" : INK;
      c.fillRect(W - 10, 26 + yy * 5, 10, 5);
    }
  },

  /** La misma pista, en el espacio, con la llamarada larga. */
  rockets(c, t, col) {
    c.fillStyle = "#0e0c24";
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const sx = (i * 37 + 7 - t * (14 + (i % 3) * 9)) % W;
      const x = (sx + W) % W;
      const y = (i * 19 + 5) % H;
      c.fillStyle = i % 5 === 0 ? "#ffc629" : "rgba(246,239,226,0.6)";
      c.fillRect(x, y, i % 4 === 0 ? 2 : 1, 1);
    }
    for (let i = 0; i < 2; i++) {
      const p = ((t * 0.38 + i * 0.5) % 1.12) - 0.06;
      const x = p * W - 6;
      const y = 16 + i * 24;
      // La estela, que es lo que se lee como velocidad a tamaño chico.
      const grd = c.createLinearGradient(x - 34, 0, x, 0);
      grd.addColorStop(0, "rgba(255,122,26,0)");
      grd.addColorStop(1, "rgba(255,198,41,0.75)");
      c.fillStyle = grd;
      c.fillRect(x - 34, y + 4, 34, 6);
      const fl = 9 + Math.sin(t * 26 + i * 3) * 4;
      c.fillStyle = "#ff7a1a";
      c.beginPath();
      c.moveTo(x - 1, y + 2);
      c.lineTo(x - 1 - fl, y + 7);
      c.lineTo(x - 1, y + 12);
      c.closePath();
      c.fill();
      c.fillStyle = "#ffc629";
      c.beginPath();
      c.moveTo(x - 1, y + 4);
      c.lineTo(x - 1 - fl * 0.5, y + 7);
      c.lineTo(x - 1, y + 10);
      c.closePath();
      c.fill();
      // El casco.
      c.fillStyle = INK;
      c.fillRect(x - 1, y + 1, 26, 12);
      c.fillStyle = col(i + 2);
      c.fillRect(x, y + 2, 22, 10);
      c.beginPath();
      c.moveTo(x + 22, y + 2);
      c.lineTo(x + 30, y + 7);
      c.lineTo(x + 22, y + 12);
      c.closePath();
      c.fill();
      c.fillStyle = "#f6efe2";
      c.fillRect(x + 5, y + 4, 5, 5);
      c.fillStyle = INK;
      c.fillRect(x + 4, y - 2, 7, 4);
      c.fillRect(x + 4, y + 12, 7, 4);
    }
  },

  /** El paquete saltando de estrella en estrella, con la ruta que se arma. */
  stellar(c, t, col) {
    c.fillStyle = "#0b0922";
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      const x = (i * 43 + 9) % W;
      const y = (i * 23 + 4) % H;
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.6 + i));
      c.fillStyle = "rgba(246,239,226," + (tw * 0.5).toFixed(2) + ")";
      c.fillRect(x, y, 1, 1);
    }
    const pts = [[14, 48], [36, 16], [58, 44], [80, 14], [102, 40]] as const;
    const step = (t * 0.85) % (pts.length - 1);
    const i = Math.floor(step);
    const f = step - i;
    c.lineWidth = 2;
    c.lineCap = "round";
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k] as readonly [number, number];
      const b = pts[k + 1] as readonly [number, number];
      c.strokeStyle = k <= i ? col(k) : "rgba(246,239,226,0.14)";
      c.beginPath();
      c.moveTo(a[0], a[1]);
      // El tramo en curso se dibuja a medias: la ruta se ve avanzar.
      if (k === i) c.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
      else c.lineTo(b[0], b[1]);
      c.stroke();
    }
    pts.forEach((pt, k) => {
      const viva = k === i || (k === i + 1 && f > 0.6);
      if (viva) {
        c.fillStyle = col(k) + "44";
        c.beginPath();
        c.arc(pt[0], pt[1], 11, 0, TAU);
        c.fill();
      }
      estrella(c, pt[0], pt[1], viva ? 8 : 5.5, col(k));
    });
    const a = pts[i] as readonly [number, number];
    const b = pts[Math.min(i + 1, pts.length - 1)] as readonly [number, number];
    // El paquete va por un arco, no en línea recta: se lee como un salto.
    const px = a[0] + (b[0] - a[0]) * f;
    const py = a[1] + (b[1] - a[1]) * f - Math.sin(f * Math.PI) * 13;
    c.save();
    c.translate(px, py);
    c.rotate(t * 2.4);
    c.fillStyle = INK;
    c.fillRect(-5, -5, 10, 10);
    c.fillStyle = "#ffc629";
    c.fillRect(-3.6, -3.6, 7.2, 7.2);
    c.restore();
  },

  /** La barra de cierre barriendo tarjetas, con el libro nunca vacío. */
  ledger(c, t, col) {
    c.fillStyle = "#231b36";
    c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(246,239,226,0.05)";
    for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) c.fillRect(x, y, 1, 1);
    const ciclo = 2.6;
    const p = (t % ciclo) / ciclo;
    const y = p * (H + 14) - 7;
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 5; k++) {
        const cy = 5 + r * 15;
        const cx = 5 + k * 22;
        // Sólo la fila que la barra acaba de pasar queda tachada; las de más
        // arriba ya se repusieron. Así el libro no se queda vacío (que es lo que
        // pasaba antes media vuelta del ciclo) ni se convierte en una pared de
        // tachas, que era lo que pasaba la otra media.
        const d = y - (cy + 11);
        const ida = d > 0 && d < 18;
        c.fillStyle = INK;
        c.fillRect(cx, cy, 19, 11);
        c.fillStyle = ida ? "#2a2240" : "#f6efe2";
        c.fillRect(cx + 1, cy + 1, 17, 9);
        c.fillStyle = ida ? "#4a3f63" : col(r + k);
        c.fillRect(cx + 1, cy + 1, 4, 9);
        c.fillStyle = ida ? "#3b3253" : "#8d8579";
        c.fillRect(cx + 7, cy + 3, 9, 1.5);
        c.fillRect(cx + 7, cy + 6, 6, 1.5);
        if (!ida) continue;
        c.strokeStyle = "#00a896";
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(cx + 3, cy + 2);
        c.lineTo(cx + 16, cy + 9);
        c.moveTo(cx + 16, cy + 2);
        c.lineTo(cx + 3, cy + 9);
        c.stroke();
      }
    }
    // La barra, con resplandor: es lo que uno sigue con el ojo.
    const gl = c.createLinearGradient(0, y - 9, 0, y + 9);
    gl.addColorStop(0, "rgba(0,168,150,0)");
    gl.addColorStop(0.5, "rgba(0,168,150,0.55)");
    gl.addColorStop(1, "rgba(0,168,150,0)");
    c.fillStyle = gl;
    c.fillRect(0, y - 9, W, 18);
    c.fillStyle = "#17c3b2";
    c.fillRect(0, y - 2, W, 4);
  },

  /** El aguayo cerrándose sobre los bultos, que se quedan quietos. */
  pasanaku(c, t, col) {
    c.fillStyle = "#1d1428";
    c.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2;
    // Antes se escalaba todo junto y se leía como un rectángulo respirando.
    // Ahora el que se mueve es el borde de la tela; los bultos están quietos,
    // con tinta alrededor, y por eso se ve que los está apretando.
    const k = 0.52 + 0.48 * (0.5 + 0.5 * Math.cos(t * 1.15));
    const hw = 50 * k;
    const hh = 24;
    c.save();
    c.beginPath();
    // Borde ondulado, para que sea tela y no una caja.
    c.moveTo(cx - hw, cy - hh);
    for (let i = 0; i <= 12; i++) {
      const q = i / 12;
      c.lineTo(cx - hw + hw * 2 * q, cy - hh + Math.sin(q * 7 + t * 1.6) * 3);
    }
    for (let i = 12; i >= 0; i--) {
      const q = i / 12;
      c.lineTo(cx - hw + hw * 2 * q, cy + hh + Math.sin(q * 7 - t * 1.6) * 3);
    }
    c.closePath();
    c.save();
    c.clip();
    const bandH = (hh * 2) / 9;
    for (let b = 0; b < 9; b++) {
      const by = cy - hh + b * bandH;
      const pallay = b % 2 === 1;
      c.fillStyle = pallay ? "#efe4cf" : col(Math.floor(b / 2));
      c.fillRect(cx - hw, by, hw * 2, bandH + 1);
      if (!pallay) continue;
      c.fillStyle = INK;
      const sz = bandH * 0.34;
      for (let px = cx - hw + sz; px < cx + hw; px += sz * 2.6) {
        c.beginPath();
        c.moveTo(px, by + bandH * 0.5 - sz);
        c.lineTo(px + sz, by + bandH * 0.5);
        c.lineTo(px, by + bandH * 0.5 + sz);
        c.lineTo(px - sz, by + bandH * 0.5);
        c.closePath();
        c.fill();
      }
    }
    c.restore();
    c.lineWidth = 2.5;
    c.strokeStyle = INK;
    c.stroke();
    c.restore();
    // Los bultos: quietos, con tinta, por encima de la tela.
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * TAU + 0.6;
      const bx = cx + Math.cos(a) * 19 * k;
      const by = cy + Math.sin(a) * 9;
      c.fillStyle = INK;
      c.fillRect(bx - 5, by - 5, 10, 10);
      c.fillStyle = col(b + 1);
      c.fillRect(bx - 3.6, by - 3.6, 7.2, 7.2);
    }
  },

  /** Tres cabinas subiendo por el cable hasta la estación de arriba. */
  teleferico(c, t) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#152052");
    g.addColorStop(0.6, "#2a1b48");
    g.addColorStop(1, "#b3553f");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // Las luces de la ciudad, abajo, quietas.
    c.fillStyle = "#ffc27a";
    for (let i = 0; i < 18; i++) c.fillRect((i * 37) % W, H - 4 - ((i * 13) % 12), 1.5, 1.5);
    const x0 = -6;
    const y0 = H + 2;
    const x1 = W + 6;
    const y1 = 4;
    const at = (q: number): [number, number] => [x0 + (x1 - x0) * q, y0 + (y1 - y0) * q];
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
    // Las cabinas llevan los colores de las líneas: roja, verde, azul.
    const lines = ["#d7263d", "#2f9e44", "#1c64c8"];
    for (let i = 0; i < 3; i++) {
      const q = ((t * 0.16 + i * 0.28) % 1) * 0.72;
      const [x, y] = at(q);
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x, y + 6);
      c.stroke();
      c.fillStyle = INK;
      c.fillRect(x - 6.5, y + 7.5, 14, 11);
      c.fillStyle = lines[i] ?? "#d7263d";
      c.fillRect(x - 8, y + 6, 14, 11);
      c.strokeRect(x - 8, y + 6, 14, 11);
      c.fillStyle = "#1d2336";
      c.fillRect(x - 6, y + 8, 10, 5);
    }
    // La estación de arriba, encima: las cabinas entran y desaparecen.
    const [sx, sy] = at(0.72);
    c.fillStyle = INK;
    c.fillRect(sx - 12, sy - 2, 28, 20);
    c.fillStyle = "#f6efe2";
    c.fillRect(sx - 14, sy - 4, 28, 20);
    c.fillStyle = "#ffc629";
    c.fillRect(sx - 14, sy - 4, 28, 5);
    c.lineWidth = 1.5;
    c.strokeRect(sx - 14, sy - 4, 28, 20);
  },

  /** El bombo girando con las bolas adentro, y una que baja por la canaleta. */
  tombola(c, t, col) {
    c.fillStyle = "#1b1426";
    c.fillRect(0, 0, W, H);
    const cx = 40;
    const cy = 30;
    const r = 22;
    const a = t * 2.2;
    // Las bolas se hamacan abajo, arrastradas por el giro.
    for (let i = 0; i < 9; i++) {
      const q = i / 9;
      const ang = Math.PI * (0.25 + 0.5 * q) + Math.sin(t * 2.2 + i) * 0.35;
      const d = 9 + (i % 3) * 4;
      c.fillStyle = INK;
      c.beginPath();
      c.arc(cx + Math.cos(ang) * d + 0.6, cy + Math.sin(ang) * d + 0.6, 3.6, 0, TAU);
      c.fill();
      c.fillStyle = col(i);
      c.beginPath();
      c.arc(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 3.6, 0, TAU);
      c.fill();
    }
    // Los barrotes, que giran.
    for (let i = 0; i < 8; i++) {
      const b = a + (i / 8) * TAU;
      c.strokeStyle = i % 2 ? "#ffc629" : "#e93d9c";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(cx + Math.cos(b) * 4, cy + Math.sin(b) * 4);
      c.lineTo(cx + Math.cos(b) * r, cy + Math.sin(b) * r);
      c.stroke();
    }
    c.strokeStyle = INK;
    c.lineWidth = 4;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();
    c.strokeStyle = "#ff7a1a";
    c.lineWidth = 2;
    c.stroke();
    // La canaleta y la bola que baja, en ciclo.
    c.strokeStyle = "#5c5378";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(cx + 18, cy + 14);
    c.lineTo(96, 40);
    c.lineTo(78, 52);
    c.stroke();
    const p = (t * 0.45) % 1;
    const bx = p < 0.6 ? cx + 18 + (96 - cx - 18) * (p / 0.6) : 96 - 18 * ((p - 0.6) / 0.4);
    const by = p < 0.6 ? cy + 14 + (40 - cy - 14) * (p / 0.6) : 40 + 12 * ((p - 0.6) / 0.4);
    c.fillStyle = "#ffc629";
    c.beginPath();
    c.arc(bx, by - 3, 4.2, 0, TAU);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "#ffc629";
    c.fillRect(70, 52, 20, 10);
    c.strokeRect(70, 52, 20, 10);
  },

  /** La rueda girando, con la paleta arriba. */
  wheel(c, t, col) {
    c.fillStyle = "#1a1330";
    c.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H / 2 + 3;
    const r = 26;
    const segs = 10;
    const rot = t * 1.9;
    c.save();
    c.translate(cx, cy);
    c.rotate(rot);
    for (let i = 0; i < segs; i++) {
      c.beginPath();
      c.moveTo(0, 0);
      // Iba `(i/8)*7` en vez de la vuelta entera: los ocho gajos sumaban 401
      // grados y el último pisaba al primero. Salía una rueda con un gajo de
      // más, que es justo lo que la ruleta de verdad no hace.
      c.arc(0, 0, r, (i / segs) * TAU, ((i + 1) / segs) * TAU);
      c.closePath();
      c.fillStyle = col(i);
      c.fill();
      c.strokeStyle = INK;
      c.lineWidth = 1;
      c.stroke();
    }
    c.restore();
    // El aro y los pernos.
    c.strokeStyle = INK;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, r, 0, TAU);
    c.stroke();
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU + rot;
      c.fillStyle = "#f6efe2";
      c.beginPath();
      c.arc(cx + Math.cos(a) * (r + 2.5), cy + Math.sin(a) * (r + 2.5), 1.4, 0, TAU);
      c.fill();
    }
    // El centro.
    c.fillStyle = INK;
    c.beginPath();
    c.arc(cx, cy, 6, 0, TAU);
    c.fill();
    c.fillStyle = "#ffc629";
    c.beginPath();
    c.arc(cx, cy, 3.4, 0, TAU);
    c.fill();
    // La paleta, que es lo que dice que esto elige a alguien.
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(cx - 6, cy - r - 9);
    c.lineTo(cx + 6, cy - r - 9);
    c.lineTo(cx, cy - r + 4);
    c.closePath();
    c.fill();
    c.fillStyle = "#ffc629";
    c.beginPath();
    c.moveTo(cx - 3.6, cy - r - 7);
    c.lineTo(cx + 3.6, cy - r - 7);
    c.lineTo(cx, cy - r + 1);
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
    btn.insertBefore(cv, btn.firstChild);
    canvases.push({ c: ctx, paint });
  }
  if (canvases.length === 0 || running) return;
  running = true;

  // Un solo bucle para las seis, y se frena en tres casos.
  //
  // Cuando la pestaña no está visible, por lo obvio. **Mientras corre un
  // sorteo**, porque seis lienzos animados detrás del estadio le robaban
  // cuadros al juego y lo dejaban corriendo a un tercio de su velocidad: se
  // veía como si se hubiera colgado. Y cuando el selector no está en pantalla,
  // que es casi todo el tiempo: la página es larga, el selector vive abajo en
  // la sección de la lista congelada, y dibujar seis escenas que nadie mira es
  // batería de un celular a cambio de nada.
  const stadium = document.getElementById("stadium");
  const pick = document.querySelector(".gamepick");
  let aLaVista = true;
  if (pick && typeof IntersectionObserver === "function") {
    aLaVista = false;
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) aLaVista = e.isIntersecting;
      },
      { rootMargin: "120px" },
    ).observe(pick);
  }
  const loop = (now: number): void => {
    const jugando = stadium?.style.display === "block";
    if (aLaVista && !jugando && document.visibilityState === "visible") {
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
