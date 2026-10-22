/**
 * La calidad del dibujo, según lo que aguanta el equipo.
 *
 * El show se mira en lo que haya: la placa de video de quien organiza, el
 * proyector de una laptop sin placa o un celular de gama media. Lo que se ve
 * mejor y cuesta se prende solo donde el equipo aguanta, y se apaga solo si
 * los cuadros empiezan a tardar. Nunca al revés: un equipo lento nunca dibuja
 * más que antes, y uno que tropieza baja (pedido de Nicolás, 21 de octubre de
 * 2026: "mejorar la calidad gráfica y que siga siendo rápido").
 *
 * Tres niveles:
 * - `alta`: el desenfoque de la cámara a la resolución del lienzo y con el
 *   suavizado de bordes; papel picado abundante.
 * - `media`: el desenfoque a resolución 1 y sin suavizado, como fue siempre;
 *   menos papel picado.
 * - `baja`: sin desenfoque (es una pasada más sobre toda la pantalla) y el
 *   papel picado justo. Si lo que tarda es la placa, también baja a tres
 *   cuartos la resolución de una pantalla de alta densidad, nunca por debajo
 *   de 1; si lo que tarda es el código del juego (un celular con el procesador
 *   justo), menos píxeles no lo apurarían y la imagen queda nítida.
 *
 * El nivel no toca el sorteo ni el guion: el ganador, los tiempos y lo que
 * pasa en la escena son los mismos en los tres. Se decide con el reloj de los
 * cuadros, el mismo que mueve el juego: con el reloj cambiado del auditor
 * exigente cada cuadro dura lo mismo y la misma ronda se dibuja igual.
 */
export type Nivel = "alta" | "media" | "baja";

export interface Ajustes {
  /** Píxeles del lienzo por píxel de la pantalla. */
  resolucion: number;
  /** El desenfoque de los acercamientos rápidos de la cámara. */
  desenfoque: "pleno" | "simple" | "no";
  /** Las tiras de papel picado del cartel del ganador. */
  papeles: number;
}

/** El tope de densidad de siempre: más de 2 no se nota en un celular y cuesta el doble. */
export const densidad = (dpr: number): number => Math.min(dpr || 1, 2);

const PAPELES: Record<Nivel, number> = { alta: 240, media: 170, baja: 100 };

/**
 * Lo que dibuja cada nivel. Con el modo para compartir, cuatro de cada diez
 * tiras de papel picado: el ruido se pierde en Zoom. `porPlaca`: lo que tarda
 * es la placa (solo entonces baja achica la resolución).
 */
export function ajustesDe(nivel: Nivel, dpr: number, compartir: boolean, porPlaca = true): Ajustes {
  const base = densidad(dpr);
  const papeles = PAPELES[nivel];
  return {
    resolucion: nivel === "baja" && porPlaca && base > 1 ? Math.max(1, Math.round(base * 0.75 * 4) / 4) : base,
    desenfoque: nivel === "alta" ? "pleno" : nivel === "media" ? "simple" : "no",
    papeles: compartir ? Math.round(papeles * 0.4) : papeles,
  };
}

const NIVELES: readonly Nivel[] = ["alta", "media", "baja"];
const esNivel = (s: string | null): s is Nivel => !!s && (NIVELES as readonly string[]).includes(s);

/**
 * Lo que se aprendió en el show anterior de esta página: el siguiente arranca
 * ahí, sin volver a tropezar para darse cuenta.
 */
let aprendido: Nivel | null = null;

/**
 * Con qué nivel arranca un show. `?calidad=alta|media|baja` lo fija y nadie lo
 * mueve (para medir y para los auditores). Si no, lo aprendido en el show
 * anterior; si es el primero, `alta`, o `baja` si el navegador dibuja por
 * software (una laptop sin placa, o una placa que el navegador no usa).
 */
export function nivelInicial(pedido: string | null, software: boolean): { nivel: Nivel; fijo: boolean } {
  if (esNivel(pedido)) return { nivel: pedido, fijo: true };
  if (aprendido) return { nivel: aprendido, fijo: false };
  return { nivel: software ? "baja" : "alta", fijo: false };
}

/** Anota el nivel al que bajó un show, para el próximo. */
export function aprender(nivel: Nivel): void {
  aprendido = nivel;
}

/** Para las pruebas: olvida lo aprendido. */
export function olvidar(): void {
  aprendido = null;
}

/** Lo que puede costar de más el desenfoque pleno en un cuadro, en ms, antes de bajar a media. */
const DESENFOQUE_CARO = 6;
/** Un cuadro sin desenfoque que tarda esto ya no deja lugar para el juego: baja. */
const ESCENA_CARA = 20;

/**
 * El nivel con que arranca el show según lo que tardó la placa en dibujar la
 * escena armada, sin y con el desenfoque pleno, antes de mostrar el estadio
 * (mientras la sala lee la tarjeta de cómo se juega). Así un equipo que no da
 * abasto arranca abajo sin tropezar delante de nadie; el gobernador sigue
 * mirando después. Solo baja desde `alta`.
 */
export function nivelMedido(nivel: Nivel, sinDesenfoque: number, conDesenfoque: number): Nivel {
  if (nivel !== "alta") return nivel;
  if (sinDesenfoque > ESCENA_CARA) return "baja";
  if (conDesenfoque - sinDesenfoque > DESENFOQUE_CARO) return "media";
  return "alta";
}

/**
 * Si lo que tarda es la placa y no el código: de un cuadro de `total` ms, el
 * código del juego (armar la escena y mandarla a dibujar) se llevó `codigo`.
 * Con más de la mitad en la placa, menos píxeles sí apuran.
 */
export const esPorPlaca = (codigo: number, total: number): boolean => total - codigo > codigo;

/** Los primeros cuadros no cuentan: el arranque paga texturas, textos y sombreadores. */
const ARRANQUE = 30;
/** Cuántos cuadros mira antes de decidir. */
const VENTANA = 48;
/** Un cuadro que tarda más que esto se perdió en una pantalla de 60 Hz: menos de 45 por segundo. */
const LENTO = 22;
/** Un hueco así es la pestaña escondida o el depurador, no el dibujo. */
const HUECO = 250;

/**
 * Mira cuánto tarda cada cuadro y baja de nivel si el equipo no da abasto.
 * Nunca sube: subir y bajar en el mismo show se vería como un parpadeo.
 *
 * - De `alta` a `media`: si el diez por ciento más lento de 48 cuadros pasa
 *   de 22 ms. El desenfoque pleno cuesta solo en los acercamientos rápidos, que
 *   no son todos los cuadros, y la mediana no lo vería.
 * - A `baja`: si la mediana pasa de 22 ms, desde cualquier nivel.
 */
export class Gobernador {
  private vistos = 0;
  private readonly ventana: number[] = [];
  private readonly codigo: number[] = [];

  constructor(
    public nivel: Nivel,
    private readonly bajar: (n: Nivel, porPlaca: boolean) => void,
    private readonly fijo = false,
  ) {}

  /**
   * Cuánto tardó el último cuadro, en milisegundos, y cuánto de eso se llevó el
   * código del juego: si es casi todo, el que no da abasto es el procesador, y
   * bajar la resolución no apuraría nada (`esPorPlaca`).
   */
  cuadro(ms: number, codigo = 0): void {
    if (this.fijo || this.nivel === "baja") return;
    if (++this.vistos <= ARRANQUE) return;
    if (!(ms > 0) || ms > HUECO) return;
    this.ventana.push(ms);
    this.codigo.push(codigo);
    if (this.ventana.length < VENTANA) return;
    const s = [...this.ventana].sort((a, b) => a - b);
    const c = [...this.codigo].sort((a, b) => a - b);
    this.ventana.length = 0;
    this.codigo.length = 0;
    const q = (v: number[], p: number): number => v[Math.min(v.length - 1, Math.floor(v.length * p))] ?? 0;
    const sig: Nivel | null = q(s, 0.5) > LENTO ? "baja" : this.nivel === "alta" && q(s, 0.9) > LENTO ? "media" : null;
    if (!sig) return;
    this.nivel = sig;
    this.bajar(sig, esPorPlaca(q(c, 0.5), q(s, 0.5)));
  }
}

let porSoftware: boolean | null = null;

/**
 * Si el navegador dibuja WebGL por software: sin placa, o con una que no usa.
 * Un contexto de prueba con `failIfMajorPerformanceCaveat` no nace en ese caso.
 * Se pregunta una vez por página y el contexto se suelta enseguida: los
 * navegadores aguantan pocos a la vez.
 */
export function dibujaPorSoftware(): boolean {
  if (porSoftware !== null) return porSoftware;
  try {
    const c = document.createElement("canvas");
    const o: WebGLContextAttributes = { failIfMajorPerformanceCaveat: true };
    const gl = c.getContext("webgl2", o) ?? c.getContext("webgl", o);
    porSoftware = !gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    porSoftware = false;
  }
  return porSoftware;
}
