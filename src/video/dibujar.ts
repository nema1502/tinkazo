/**
 * El dibujo de un cuadro del video, en un lienzo 2D.
 *
 * Recibe el plan (`plan.ts`), el número de cuadro y un contexto 2D, y dibuja
 * ese cuadro entero. No acumula nada entre cuadros: como el plan de la carrera
 * (`src/games/llamas/plan.ts`), todo es función del cuadro que toca, así que
 * cualquier cuadro se puede dibujar solo, en cualquier orden, y la misma ronda
 * dibuja siempre lo mismo.
 *
 * Las cadenas visibles van en español e inglés, las dos a la vista, como en la
 * foto que se comparte (`src/ui/foto.ts`). No importa `i18n.ts` a propósito:
 * el prototipo se mide por consola, no por la interfaz, y así se puede probar
 * sin página.
 *
 * El QR no lo dibuja acá: lo arma quien graba con `qrLienzo` (`src/ui/qr.ts`)
 * y lo pasa ya hecho en `extras.qr`.
 */

import { escenaDe, type PlanVideo } from "./plan";

/** «Verificalo vos» / «Don't trust, verify»: el cierre del video, en los dos idiomas. */
export const VERIFICACION_ES = "Verificalo vos";
export const VERIFICACION_EN = "Don't trust, verify";

/** La tinta y el papel del video: oscuro de estadio, con la marca de Tinkazo. */
const PAPEL = "#141019";
const TINTA = "#f3ede2";
const MARCA = "#f5b942";
const SOMBRA = "rgba(0, 0, 0, 0.55)";

/** Lo que hace falta además del plan para dibujar un cuadro. */
export interface ExtrasCuadro {
  /** El QR del comprobante, ya dibujado (`qrLienzo`), o nada si no salió. */
  qr?: CanvasImageSource | null;
}

/** Un renglón centrado, con su fuente y su color. */
function texto(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, fuente: string, color: string, alfa = 1): void {
  ctx.globalAlpha = alfa;
  ctx.font = fuente;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}

/** El fondo de todas las escenas: la noche del estadio, con una veta de la marca. */
function fondo(ctx: CanvasRenderingContext2D, p: PlanVideo): void {
  ctx.fillStyle = PAPEL;
  ctx.fillRect(0, 0, p.ancho, p.alto);
  ctx.fillStyle = MARCA;
  ctx.fillRect(0, 0, p.ancho, 8);
}

/** «Hecho con Tinkazo», abajo de todo, como en la foto que se comparte. */
function pie(ctx: CanvasRenderingContext2D, p: PlanVideo): void {
  texto(ctx, "Hecho con Tinkazo · Made with Tinkazo", p.ancho / 2, p.alto - 44, "500 26px system-ui, sans-serif", TINTA, 0.65);
}

/** La escena de entrada: qué sorteo es, entre quiénes, y la semilla que lo hace comprobable. */
function dibujarEntrada(ctx: CanvasRenderingContext2D, p: PlanVideo, local: number): void {
  const r = p.ronda;
  const entra = Math.min(1, local / 20);
  ctx.save();
  ctx.globalAlpha = entra;
  texto(ctx, r.titulo || "Sorteo de Tinkazo", p.ancho / 2, 320, "700 64px system-ui, sans-serif", TINTA);
  if (r.premio) texto(ctx, `Premio: ${r.premio}`, p.ancho / 2, 420, "500 40px system-ui, sans-serif", MARCA);
  texto(ctx, `${r.nombres.length} participantes · ${r.nombres.length} participants`, p.ancho / 2, 520, "500 36px system-ui, sans-serif", TINTA, 0.85);
  texto(ctx, `Semilla drand: ${r.seed}`, p.ancho / 2, p.alto / 2 + 60, "400 28px ui-monospace, monospace", TINTA, 0.6);
  texto(ctx, "El show que viene pasó tal cual · The draw you are about to see is exactly what happened", p.ancho / 2, p.alto / 2 + 140, "400 28px system-ui, sans-serif", TINTA, 0.6);
  ctx.restore();
  void entra;
}

/** La escena del show: los carriles que avanzan, la tensión que sube. */
function dibujarShow(ctx: CanvasRenderingContext2D, p: PlanVideo, cuadro: number, local: number): void {
  const r = p.ronda;
  const i = cuadro - (p.escenas.find((e) => e.id === "show")?.desde ?? 0);
  const c = p.show[Math.max(0, Math.min(p.show.length - 1, i))]!;

  texto(ctx, r.titulo || "Sorteo de Tinkazo", p.ancho / 2, 140, "700 44px system-ui, sans-serif", TINTA, 0.9);

  // La pista: un carril debajo del otro, cada uno con su nombre avanzando.
  const pistaX = 90;
  const pistaAncho = p.ancho - pistaX * 2 - 40;
  const pistaY = 260;
  const paso = Math.min(96, (p.alto - pistaY - 420) / p.carriles);
  for (let k = 0; k < p.carriles; k++) {
    const y = pistaY + k * paso;
    const nombre = r.nombres[p.laneDe[k] as number] ?? "";
    const x = pistaX + c.posiciones[k]! * pistaAncho;
    // El riel del carril.
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = TINTA;
    ctx.fillRect(pistaX, y + paso * 0.36, pistaAncho, 4);
    ctx.globalAlpha = 1;
    // La ficha que corre: el ganador va en color de la marca.
    ctx.fillStyle = k === 0 ? MARCA : TINTA;
    ctx.globalAlpha = k === 0 ? 1 : 0.9;
    const anchoFicha = Math.max(120, nombre.length * 22 + 48);
    ctx.beginPath();
    ctx.roundRect(x, y, anchoFicha, paso * 0.72, paso * 0.36);
    ctx.fill();
    ctx.fillStyle = k === 0 ? "#191919" : "#191919";
    ctx.font = "600 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(nombre, x + anchoFicha / 2, y + paso * 0.36);
    ctx.globalAlpha = 1;
  }

  // La meta, a la derecha de la pista.
  ctx.fillStyle = MARCA;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(pistaX + pistaAncho + 10, pistaY - 20, 6, paso * p.carriles + 20);
  ctx.globalAlpha = 1;

  // La tensión, como una barra que respira con la música.
  const barraY = p.alto - 340;
  ctx.fillStyle = SOMBRA;
  ctx.beginPath();
  ctx.roundRect(pistaX, barraY, p.ancho - pistaX * 2, 18, 9);
  ctx.fill();
  ctx.fillStyle = MARCA;
  ctx.beginPath();
  ctx.roundRect(pistaX, barraY, (p.ancho - pistaX * 2) * c.tension, 18, 9);
  ctx.fill();

  // El minuto del show: cuánto falta, en cuadros contados desde el plan.
  void local;
}

/** La escena del cartel: quién ganó, con el nombre grande. */
function dibujarCartel(ctx: CanvasRenderingContext2D, p: PlanVideo, local: number): void {
  const r = p.ronda;
  const entra = Math.min(1, local / 12);
  ctx.save();
  ctx.globalAlpha = entra;
  texto(ctx, "¡Ganó! · Won!", p.ancho / 2, 420, "700 44px system-ui, sans-serif", MARCA);
  texto(ctx, r.ganador, p.ancho / 2, 560, "800 96px system-ui, sans-serif", TINTA);
  if (r.premio) texto(ctx, r.premio, p.ancho / 2, 690, "500 44px system-ui, sans-serif", TINTA, 0.85);
  texto(ctx, "Comprobá el sorteo · Verify the draw", p.ancho / 2, 800, "400 32px system-ui, sans-serif", TINTA, 0.6);
  ctx.restore();
}

/** La escena del cierre: «Verificalo vos», el QR y el enlace del comprobante. */
function dibujarCierre(ctx: CanvasRenderingContext2D, p: PlanVideo, extras: ExtrasCuadro): void {
  const r = p.ronda;
  texto(ctx, VERIFICACION_ES, p.ancho / 2, 300, "800 72px system-ui, sans-serif", TINTA);
  texto(ctx, VERIFICACION_EN, p.ancho / 2, 380, "600 40px system-ui, sans-serif", TINTA, 0.75);
  const ladoQr = 480;
  const xQr = (p.ancho - ladoQr) / 2;
  if (extras.qr) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(xQr - 16, 460 - 16, ladoQr + 32, ladoQr + 32);
    ctx.drawImage(extras.qr, xQr, 460, ladoQr, ladoQr);
  } else {
    ctx.fillStyle = SOMBRA;
    ctx.fillRect(xQr, 460, ladoQr, ladoQr);
  }
  texto(ctx, "Escaneá el QR del comprobante · Scan the receipt QR", p.ancho / 2, 1010, "500 30px system-ui, sans-serif", TINTA, 0.85);
  // El enlace, corto para que quepa: lo completo está en el QR.
  ctx.font = "400 24px ui-monospace, monospace";
  ctx.fillStyle = TINTA;
  ctx.globalAlpha = 0.7;
  ctx.textAlign = "center";
  const largo = 64;
  const enlace = r.enlace.length > largo ? `${r.enlace.slice(0, largo)}…` : r.enlace;
  ctx.fillText(enlace, p.ancho / 2, 1080);
  ctx.globalAlpha = 1;
}

/**
 * Dibuja un cuadro del plan en el contexto. Tira si el cuadro no está en el
 * plan: mejor fallar ruidoso que grabar un video con cuadros vacíos.
 */
export function dibujarCuadro(ctx: CanvasRenderingContext2D, p: PlanVideo, cuadro: number, extras: ExtrasCuadro): void {
  const paso = escenaDe(p, cuadro);
  if (!paso) throw new Error(`el cuadro ${cuadro} no está en el plan (van ${p.cuadros})`);
  const { escena, local } = paso;
  fondo(ctx, p);
  switch (escena.id) {
    case "entrada":
      dibujarEntrada(ctx, p, local);
      break;
    case "show":
      dibujarShow(ctx, p, cuadro, local);
      break;
    case "cartel":
      dibujarCartel(ctx, p, local);
      break;
    case "cierre":
      dibujarCierre(ctx, p, extras);
      break;
  }
  pie(ctx, p);
}
