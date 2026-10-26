import { CanvasSource, Texture } from "pixi.js";
import { T, getLang, t } from "../../../i18n";
import { musicCue, type MusicStyle } from "../../../music";
import { beep, fanfare, note } from "../../../sound";
import { paceFactor, params, setGameLength } from "../../../state";
import type { Emblema } from "../../emblemas";
import { cargarEmblemas, emblemaCanvas, emblemasListos } from "../../emblemas-dibujo";
import { WINNER_HOLD, winnersLabel } from "../../overlay";
import { mountPixi, type FocoAt, type PixiStage } from "../stage";
import type { Voz } from "./sonido";
import type { Baliza, Idioma } from "./tipos";

/**
 * El anfitrión: lo único del kit que conoce a tinkazo.app.
 *
 * Todo lo demás en `kit/` (el guion, los nombres, las figuras, el sonido, el
 * director, `crearJuego`) habla con este puerto y no importa nada del sitio: ni
 * sus textos, ni su estado, ni su audio, ni sus rutas. Publicar el kit como
 * paquete aparte es reemplazar este archivo por el de quien lo use. La prueba
 * `frontera.test.ts` vigila que sea el único.
 *
 * Qué le pide el kit al sitio:
 *
 * - **montar** el estadio (el lienzo, el relator, la cámara, el cartel);
 * - **idioma** y **frases** del diccionario, para los juegos que no traen las suyas;
 * - **ritmo** y **duración**: cuánto estira el reloj la duración elegida y cómo
 *   se lo cuenta al selector;
 * - **voz**: cómo suena una nota en esta página;
 * - **emblemas**: la hoja de dibujos y cómo pasar uno a textura.
 */
export { CHIP_SCALE, CREAM, INK, YELLOW } from "../stage";
export type Estadio = PixiStage;
export type Musica = MusicStyle;
/** Dónde está quien gana en la pantalla, con el arco que le da su sabor. */
export type Enfoque = FocoAt;

export interface Anfitrion {
  montar(baliza: Baliza, listo: () => void, alSaltar: () => void, o: { musica?: Musica }): Promise<Estadio | null>;
  idioma(): Idioma;
  /** Una frase del diccionario del sitio, o `undefined` si no existe. */
  frase(clave: string, args: readonly unknown[]): string | undefined;
  /** El anuncio de quien gana, para el relator. */
  anuncio(nombres: string[], ganadores: readonly number[]): string;
  /** El valor de `?auditar=`: lo que un auditor le pide al juego que deje a la vista (`nino`, `camara`, `identidad`, `marcas`: sin ninguno no se anotan las marcas del plan, `kit/marcas.ts`). */
  auditar(): string | null;
  /** Sostiene la música en una tensión de 0 a 1, sin que nadie diga nada. */
  calor(tension: number): void;
  /** Cuánto estira el reloj del juego la duración elegida (1 en Normal). */
  ritmo(): number;
  /** Le cuenta al selector de duración cuánto dura el juego y cuánto de eso es fijo (segundos reales). */
  duracion(segundos: number, fijos: number, normal?: number | null): void;
  /** Cuánto se sostiene el cartel de quien gana, en segundos reales. */
  readonly espera: number;
  readonly voz: Voz;
  readonly emblemas: {
    cargar(): Promise<void>;
    lista(): boolean;
    lienzo(e: Emblema, lado: number): HTMLCanvasElement;
    textura(lienzo: HTMLCanvasElement): Texture;
  };
}

/** El anfitrión de tinkazo.app. */
export const anfitrionTinkazo: Anfitrion = {
  montar: (baliza, listo, alSaltar, o) => mountPixi(baliza, listo, alSaltar, { music: o.musica }),
  idioma: () => getLang(),
  frase(clave, args) {
    const v = T[getLang()][clave];
    if (typeof v === "function") return (v as (...a: unknown[]) => string)(...args);
    // Una frase con variantes sortea una con el azar del juego (`t`), igual que si la dijera el propio juego.
    return typeof v === "string" || Array.isArray(v) ? t(clave) : undefined;
  },
  anuncio: (nombres, ganadores) => T[getLang()].cWin(winnersLabel(nombres, ganadores), ganadores.length > 1),
  auditar: () => params.get("auditar"),
  calor: (c) => musicCue(c),
  ritmo: () => paceFactor(),
  duracion: (segundos, fijos, normal) => setGameLength(segundos, fijos, normal ?? null),
  espera: WINNER_HOLD,
  voz: {
    tono: (hz, dur, timbre, vol) => beep(hz, dur, timbre, vol),
    nota: (grado) => note(grado),
    fanfarria: () => fanfare(),
    despues: (ms, fn) => void setTimeout(fn, ms),
  },
  emblemas: {
    cargar: () => cargarEmblemas(),
    lista: () => emblemasListos(),
    lienzo: (e, lado) => emblemaCanvas(e, lado),
    textura: (lienzo) => new Texture({ source: new CanvasSource({ resource: lienzo, autoGenerateMipmaps: true, scaleMode: "linear" }) }),
  },
};
