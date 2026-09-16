import { $ } from "../dom";
import { LCOLORS, instantMode } from "../state";
import { beep, fanfare } from "../sound";

const WHEEL_CSS = 480;
// Texto oscuro sobre naranja/amarillo, blanco sobre magenta/teal/púrpura (contraste por gajo)
const TEXT_ON = ["#ffffff", "#191919", "#ffffff", "#ffffff", "#191919"];

function wheelColors(): string[] {
  const cs = getComputedStyle(document.documentElement);
  return LCOLORS.map((v) => cs.getPropertyValue(v).trim());
}

function setupWheelCanvas(): CanvasRenderingContext2D {
  const c = $<HTMLCanvasElement>("wheel");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = WHEEL_CSS * dpr;
  c.height = WHEEL_CSS * dpr;
  c.style.width = WHEEL_CSS + "px";
  c.style.height = WHEEL_CSS + "px";
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas 2d no disponible");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function segColorIdx(i: number, n: number): number {
  let idx = i % LCOLORS.length;
  if (n % LCOLORS.length === 1 && i === n - 1) idx = (i + 2) % LCOLORS.length;
  return idx;
}

function drawWheel(ctx: CanvasRenderingContext2D, names: string[], rotation: number, highlightIdx = -1): void {
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue("--ink").trim();
  const colors = wheelColors();
  const n = names.length;
  const R = 224;
  const cx = WHEEL_CSS / 2;
  const cy = WHEEL_CSS / 2;
  ctx.clearRect(0, 0, WHEEL_CSS, WHEEL_CSS);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  const fontPx = n <= 10 ? 16 : n <= 16 ? 14 : 12;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
    const cIdx = segColorIdx(i, n);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
    ctx.fillStyle = colors[cIdx] ?? "#000";
    ctx.fill();
    if (highlightIdx >= 0 && i !== highlightIdx) {
      ctx.fillStyle = "rgba(20,15,30,0.55)";
      ctx.fill();
    }
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.save();
    ctx.rotate((a0 + a1) / 2);
    ctx.textAlign = "right";
    ctx.font = `800 ${fontPx}px system-ui, sans-serif`;
    const name = names[i] ?? "";
    const label = name.length > 15 ? name.slice(0, 14) + "…" : name;
    ctx.fillStyle = highlightIdx >= 0 && i !== highlightIdx ? "rgba(255,255,255,0.35)" : (TEXT_ON[cIdx] ?? "#fff");
    ctx.fillText(label, R - 14, fontPx * 0.35);
    ctx.restore();
  }
  if (highlightIdx >= 0) {
    const a0 = (highlightIdx / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((highlightIdx + 1) / n) * 2 * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.stroke();
  }
  // Hub con la llama de la casa
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, 2 * Math.PI);
  ctx.fillStyle = cs.getPropertyValue("--card").trim();
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawMiniLlama(ctx, -19, -16, 1.6, cs.getPropertyValue("--magenta").trim());
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.stroke();
}

function drawMiniLlama(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number, color: string): void {
  const r = (rx: number, ry: number, rw: number, rh: number) =>
    ctx.fillRect(x + rx * sc, y + ry * sc, rw * sc, rh * sc);
  ctx.fillStyle = color;
  r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
  r(3, 18, 2.5, 6); r(8, 18, 2.5, 6); r(12.5, 18, 2.5, 6); r(16, 18, 2.5, 6);
}

export function wheelSpin(names: string[], winnerIdx: number, done: () => void): void {
  $("wheel-wrap").style.display = "block";
  const ctx = setupWheelCanvas();
  const n = names.length;
  // El centro del segmento ganador debe terminar bajo el puntero (arriba).
  const target = 6 * 2 * Math.PI - ((winnerIdx + 0.5) / n) * 2 * Math.PI;
  if (instantMode) {
    drawWheel(ctx, names, target, winnerIdx);
    setTimeout(done, 60);
    return;
  }
  const dur = 4600;
  const t0 = performance.now();
  let lastTickSeg = -1;
  function frame(now: number): void {
    const p = Math.min((now - t0) / dur, 1);
    const ease = 1 - Math.pow(1 - p, 3);
    const rot = target * ease;
    drawWheel(ctx, names, rot);
    const seg = Math.floor((rot / (2 * Math.PI)) * n) % n;
    if (seg !== lastTickSeg) {
      lastTickSeg = seg;
      beep(300 + 200 * p, 0.03, "square", 0.02);
    }
    if (p < 1) requestAnimationFrame(frame);
    else {
      drawWheel(ctx, names, target, winnerIdx);
      fanfare();
      setTimeout(done, 600);
    }
  }
  requestAnimationFrame(frame);
}
