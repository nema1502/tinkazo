/**
 * Temas de la carrera. El motor es el mismo: cambia el escenario, el corredor
 * y la paleta. Agregar un tema es agregar una entrada acá, no otro juego.
 */

export type ThemeId = "andes" | "stellar";

type Pair = readonly [string, string];

export interface RaceTheme {
  id: ThemeId;
  /** Gradiente del fondo, de arriba a abajo. */
  sky: { light: Pair; dark: Pair };
  /** Cordillera lejana (parallax lento). */
  ridgeFar: { light: string; dark: string };
  /** Cerros cercanos (parallax medio). */
  ridgeNear: { light: string; dark: string };
  /** Superficie por donde corren. */
  track: { light: string; dark: string };
  /** El escenario es siempre nocturno: estrellas visibles con cualquier tema. */
  alwaysNight: boolean;
  /** Las cordilleras se dibujan como picos (montañas) o como arcos (planetas). */
  ridgeShape: "peaks" | "domes";
  /** Clave de i18n para el aviso de largada: las llamas y los cohetes no se anuncian igual. */
  readyKey: string;
  /**
   * Dibuja el corredor con su origen en (x, y) y escala `sc`, mirando a la
   * derecha. `stride` avanza con el tiempo y anima patas o llamarada.
   */
  drawRunner(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number, color: string, stride: number): void;
}

const rects =
  (ctx: CanvasRenderingContext2D, x: number, y: number, sc: number) =>
  (rx: number, ry: number, rw: number, rh: number): void =>
    ctx.fillRect(x + rx * sc, y + ry * sc, rw * sc, rh * sc);

/** Llama pixelada: la mascota de la casa. */
function drawLlama(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sc: number,
  color: string,
  stride: number,
): void {
  const r = rects(ctx, x, y, sc);
  ctx.fillStyle = color;
  r(2, 11, 16, 7); r(15, 3, 4, 10); r(14, 0, 8, 4); r(20, -2, 2, 3); r(0, 9, 3, 4);
  const legUp = Math.sin(stride) * 2.6;
  const legUp2 = Math.sin(stride + Math.PI) * 2.6;
  r(3, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
  r(8, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
  r(12.5, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
  r(16, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
  ctx.fillStyle = "#191919";
  ctx.fillRect(x + 19.4 * sc, y + 1.2 * sc, 1.4 * sc, 1.4 * sc);
}

/**
 * Cohete pixelado para la Carrera Stellar, con llamarada que late.
 *
 * Ocupa el mismo alto que la llama para que las dos carreras se vean parejas,
 * y lleva un halo detrás porque el fondo del espacio es casi negro.
 */
function drawRocket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  sc: number,
  color: string,
  stride: number,
): void {
  const r = rects(ctx, x, y, sc);
  // Halo: despega el cohete del fondo oscuro.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  r(1, 4, 22, 18);
  ctx.restore();
  // Llamarada: late con el paso y cambia de largo, detrás del cohete.
  const flame = 4 + Math.abs(Math.sin(stride)) * 4.5;
  ctx.fillStyle = "#ff7a1a";
  r(3 - flame, 10, flame, 7);
  ctx.fillStyle = "#ffc629";
  r(3 - flame * 0.6, 11.5, flame * 0.6, 4);
  // Aletas
  ctx.fillStyle = color;
  r(4, 1, 6, 6);
  r(4, 20, 6, 6);
  // Fuselaje y punta
  r(3, 7, 15, 13);
  r(18, 9, 4, 9);
  r(22, 11.5, 2, 4);
  // Franja y ventana
  ctx.fillStyle = "#f6efe2";
  r(8, 7, 3, 13);
  ctx.fillStyle = "#191919";
  r(12.5, 11, 4.5, 4.5);
  ctx.fillStyle = "#8fd3ff";
  r(13.2, 11.7, 3.1, 3.1);
}

export const THEMES: Record<ThemeId, RaceTheme> = {
  andes: {
    id: "andes",
    sky: { light: ["#8fd3ff", "#ffe9c4"], dark: ["#141032", "#3a1d5c"] },
    ridgeFar: { light: "#b98ad1", dark: "#241b4a" },
    ridgeNear: { light: "#7fc07a", dark: "#1d2a3f" },
    track: { light: "#e9c797", dark: "#2b2140" },
    alwaysNight: false,
    ridgeShape: "peaks",
    readyKey: "cReady",
    drawRunner: drawLlama,
  },
  stellar: {
    id: "stellar",
    // Siempre de noche: el espacio no tiene modo claro.
    sky: { light: ["#070a24", "#180d36"], dark: ["#070a24", "#180d36"] },
    ridgeFar: { light: "#4b3590", dark: "#4b3590" },
    ridgeNear: { light: "#2f2166", dark: "#2f2166" },
    // La pista es más clara que el cielo: si no, los cohetes se pierden.
    track: { light: "#241a52", dark: "#241a52" },
    alwaysNight: true,
    ridgeShape: "domes",
    readyKey: "cReadyStellar",
    drawRunner: drawRocket,
  },
};
