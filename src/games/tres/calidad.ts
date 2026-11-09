/**
 * La calidad del 3D, según lo que aguanta el equipo. Puro: se prueba en Node.
 *
 * Tres niveles, como el 2D (`pixi/calidad.ts`) pero propios, porque cuestan en otro lugar (la placa de video):
 *
 * - `alta`: sombras de verdad en PC, mucho polvo y papel picado, `pixelRatio` hasta 2 en PC y 1,5 en celular.
 * - `media`: sombra de óvalo (sin mapa de sombras), la mitad de las partículas, `pixelRatio` hasta 1,5 y 1,25.
 * - `baja`: sin sombras, un cuarto de las partículas, `pixelRatio` 1 y sin suavizado de bordes.
 *
 * Nunca decide qué se ve ni qué pasa en el juego: solo cuánto se gasta dibujando. Un equipo lento nunca dibuja
 * más que antes; el `Gobernador3D` baja de nivel si los cuadros tardan, y no vuelve a subir en el mismo show.
 */
export type Nivel3D = "alta" | "media" | "baja";

export interface Entorno3DCalidad {
  /** Pantalla táctil o angosta: se trata como celular. */
  celular: boolean;
  /** `window.devicePixelRatio`. */
  dpr: number;
  /** GB que dice tener el equipo (`navigator.deviceMemory`), si lo dice. */
  memoriaGB?: number | null;
  /** Núcleos de CPU (`navigator.hardwareConcurrency`), si lo dice. */
  nucleos?: number | null;
  /** El navegador dibuja por software (sin placa de video). */
  software?: boolean;
  /** El pedido a mano, `?calidad=alta|media|baja`, que fija el nivel. */
  pedido?: string | null;
  /** El modo para compartir pantalla (se transmite comprimida): menos partículas. */
  compartir?: boolean;
}

export interface Ajustes3D {
  nivel: Nivel3D;
  /** Cuántos píxeles del lienzo por píxel de la pantalla. */
  pixelRatio: number;
  /** `mapa`: sombras de verdad (shadow map); `ovalo`: un óvalo oscuro bajo cada figura; `no`. */
  sombras: "mapa" | "ovalo" | "no";
  /** Qué parte de las partículas del juego se dibuja (1, 0,5 o 0,25). */
  particulas: number;
  /** Suavizado de bordes del lienzo (no se puede cambiar después de crearlo). */
  antialias: boolean;
}

const NIVELES: readonly Nivel3D[] = ["alta", "media", "baja"];
const esNivel = (s: string | null | undefined): s is Nivel3D => !!s && (NIVELES as readonly string[]).includes(s);

/** Con qué nivel arranca un show en este equipo. */
export function nivelInicial3D(e: Entorno3DCalidad): { nivel: Nivel3D; fijo: boolean } {
  if (esNivel(e.pedido)) return { nivel: e.pedido, fijo: true };
  if (e.software) return { nivel: "baja", fijo: false };
  const justo = (e.memoriaGB ?? 99) <= 4 || (e.nucleos ?? 99) <= 4;
  if (e.celular) return { nivel: justo ? "baja" : "media", fijo: false };
  return { nivel: justo ? "media" : "alta", fijo: false };
}

/** Lo que dibuja cada nivel en este equipo. */
export function ajustes3D(nivel: Nivel3D, e: Pick<Entorno3DCalidad, "celular" | "dpr" | "compartir">): Ajustes3D {
  const tope = e.celular ? (nivel === "alta" ? 1.5 : nivel === "media" ? 1.25 : 1) : nivel === "alta" ? 2 : nivel === "media" ? 1.5 : 1;
  const dpr = Math.max(1, e.dpr || 1);
  const particulas = (nivel === "alta" ? 1 : nivel === "media" ? 0.5 : 0.25) * (e.compartir ? 0.5 : 1);
  return {
    nivel,
    pixelRatio: Math.min(dpr, tope),
    sombras: nivel === "alta" && !e.celular ? "mapa" : nivel === "baja" ? "no" : "ovalo",
    particulas,
    antialias: nivel !== "baja",
  };
}

/** Un cuadro que tarda más que esto en una pantalla de 60 Hz se perdió. */
const LENTO = 24;
/** Los primeros cuadros no cuentan: el arranque paga sombreadores y texturas. */
const ARRANQUE = 30;
const VENTANA = 48;
/** Un hueco así es la pestaña escondida o el depurador, no el dibujo. */
const HUECO = 250;

/**
 * Mira cuánto tarda cada cuadro y baja de nivel si la mediana de 48 pasa de 24 ms. Nunca sube. Como el del 2D, usa el
 * intervalo entre cuadros (el reloj real), no la hora del juego.
 */
export class Gobernador3D {
  private vistos = 0;
  private readonly ventana: number[] = [];

  constructor(
    public nivel: Nivel3D,
    private readonly bajar: (n: Nivel3D) => void,
    private readonly fijo = false,
  ) {}

  cuadro(ms: number): void {
    this.vistos++;
    if (this.fijo || this.nivel === "baja" || this.vistos <= ARRANQUE || ms > HUECO) return;
    this.ventana.push(ms);
    if (this.ventana.length < VENTANA) return;
    const orden = [...this.ventana].sort((a, b) => a - b);
    this.ventana.length = 0;
    if ((orden[orden.length >> 1] ?? 0) > LENTO) {
      this.nivel = this.nivel === "alta" ? "media" : "baja";
      this.bajar(this.nivel);
    }
  }
}
