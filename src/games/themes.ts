/**
 * Temas de la carrera. El motor es el mismo: cambia el escenario, el corredor
 * y la paleta. Agregar un tema es agregar una entrada acá, no otro juego.
 */

export type ThemeId = "andes" | "stellar";

type Pair = readonly [string, string];

/**
 * La postura del corredor en este cuadro.
 *
 * Sin esto todos corrían igual, con el mismo paso y la misma forma, y la sala
 * no tenía de dónde leer lo que le pasaba a cada uno. Ahora el cuerpo cuenta:
 * se inclina al picar, se tambalea al tropezar, se queda quieto al plantarse.
 */
export interface Pose {
  /** Inclinación hacia adelante, en radianes: positiva al acelerar. */
  lean: number;
  /** Quieto: sin paso, las patas firmes. */
  still: boolean;
  /** Escupiendo, de 0 a 1: la boca abierta en la llama, humo en el cohete. */
  spit: number;
}

export const NO_POSE: Pose = { lean: 0, still: false, spit: 0 };

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
   * Sufijo de las líneas del relator para los momentos de la historia: una
   * llama se planta, a un cohete se le apaga el motor.
   */
  voice: "L" | "R";
  /**
   * Dibuja el corredor con su origen en (x, y) y escala `sc`, mirando a la
   * derecha. `stride` avanza con lo que corre y anima patas o llamarada.
   */
  drawRunner(ctx: CanvasRenderingContext2D, x: number, y: number, sc: number, color: string, stride: number, pose?: Pose): void;
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
  pose: Pose = NO_POSE,
): void {
  ctx.save();
  // Se inclina sobre las patas de adelante, que es donde apoya al picar.
  ctx.translate(x + 16 * sc, y + 24 * sc);
  ctx.rotate(pose.lean);
  ctx.translate(-(x + 16 * sc), -(y + 24 * sc));
  const r = rects(ctx, x, y, sc);
  ctx.fillStyle = color;
  // Plantada, levanta la cabeza: terca, mirando a otro lado.
  const up = pose.still ? -1.5 : 0;
  r(2, 11, 16, 7); r(15, 3 + up, 4, 10 - up); r(14, 0 + up, 8, 4); r(20, -2 + up, 2, 3); r(0, 9, 3, 4);
  const amp = pose.still ? 0 : 2.6;
  const legUp = Math.sin(stride) * amp;
  const legUp2 = Math.sin(stride + Math.PI) * amp;
  r(3, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
  r(8, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
  r(12.5, 18 - Math.max(0, legUp2), 2.5, 6 + Math.min(0, legUp2));
  r(16, 18 - Math.max(0, legUp), 2.5, 6 + Math.min(0, legUp));
  ctx.fillStyle = "#191919";
  ctx.fillRect(x + 19.4 * sc, y + (1.2 + up) * sc, 1.4 * sc, 1.4 * sc);
  if (pose.spit > 0) {
    // La boca abierta, en la punta del hocico.
    ctx.fillStyle = "#191919";
    ctx.fillRect(x + 21 * sc, y + (2.6 + up) * sc, 1.6 * sc, (0.6 + pose.spit) * sc);
  }
  ctx.restore();
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
  pose: Pose = NO_POSE,
): void {
  ctx.save();
  // El cohete cabecea hacia arriba al acelerar, alrededor de su centro.
  ctx.translate(x + 12 * sc, y + 13 * sc);
  ctx.rotate(-pose.lean);
  ctx.translate(-(x + 12 * sc), -(y + 13 * sc));
  const r = rects(ctx, x, y, sc);
  // Escupir, en un cohete, es largar una bocanada de humo por la punta.
  if (pose.spit > 0) {
    ctx.fillStyle = "rgba(246,239,226,0.55)";
    r(24, 10 - pose.spit * 2, 3 + pose.spit * 4, 3 + pose.spit * 4);
  }
  // Halo: despega el cohete del fondo oscuro.
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = color;
  r(1, 4, 22, 18);
  ctx.restore();
  // Llamarada: late con el paso y cambia de largo, detrás del cohete. Con el
  // motor apagado queda un resto chico.
  const flame = pose.still ? 1.2 : 4 + Math.abs(Math.sin(stride)) * 4.5;
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
  ctx.restore();
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
    voice: "L",
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
    voice: "R",
    drawRunner: drawRocket,
  },
};
