import { params } from "../../state";
import { camaraDeEscena } from "./camara";
import type { EntradaBase, Montaje3D, Vista3D } from "./tipos";

/**
 * Lo que el archivo de un juego en 2D usa para hablar con su 3D. No importa three.js ni el motor: pesa unas pocas líneas
 * y puede estar en el trozo del juego sin traer nada del 3D.
 *
 * El 2D sigue decidiendo todo. Con el 3D prendido, el lienzo de PixiJS queda transparente (`mountPixi(..., {
 * transparente: true })`), el 2D apaga su fondo y su suelo, y cada cuadro le pasa a la vista lo que ya puso.
 */

/** Lo mínimo del estadio de PixiJS que se usa acá. */
export interface EstadioEnchufe {
  view: HTMLCanvasElement;
  /** `S.app`: si no hay 3D, el fondo del lienzo (que se pidió transparente) vuelve a pintarse. */
  app?: { renderer: { background: { alpha: number } } };
  dark: boolean;
  scene: { pivot: { x: number; y: number }; position: { x: number; y: number }; scale: { x: number }; rotation: number };
  sw(): number;
  sh(): number;
  u(): number;
  onCleanup(fn: () => void): void;
}

/**
 * Arma la vista 3D del juego, o devuelve null si no hay 3D o no arranca (sin WebGL, sin memoria): entonces el 2D se
 * ve como siempre. Registra el cierre: al terminar el estadio se sueltan la vista, el motor y el contexto.
 *
 * Se llama después de `mountPixi` y de armar la escena 2D. **Apagá el fondo, el suelo y las figuras del 2D solo si
 * esto devuelve algo**: si devuelve null, el lienzo transparente deja ver la página y el 2D tiene que seguir pintando.
 */
export function enchufar3D<E extends EntradaBase>(S: EstadioEnchufe, montaje: Montaje3D<E> | undefined | null): Vista3D<E> | null {
  if (!montaje) return null;
  let vista: Vista3D<E> | null = null;
  try {
    vista = montaje(S.view, { tema: S.dark ? "oscuro" : "claro", auditar: params.get("auditar") === "3d" });
  } catch (err) {
    console.warn("[3d] no arrancó, sigue el 2D", err);
    vista = null;
  }
  if (!vista) {
    // Se pidió el lienzo transparente para ver el 3D debajo; sin 3D, vuelve a ser opaco y el 2D se ve como siempre.
    if (S.app) S.app.renderer.background.alpha = 1;
    return null;
  }
  const v = vista;
  S.onCleanup(() => v.destruir());
  return v;
}

/**
 * La parte de la entrada que es igual en todos los juegos: la hora, el tamaño de la pantalla, la unidad y la cámara
 * del director. Se llama en el cuadro DESPUÉS de `cam.apply(S.scene, ...)`, que es cuando la escena ya trae el
 * acercamiento de emoción, el golpe, el "pum" de un choque, el sacudón y lo que corrigió la guardia del ganador.
 */
export function entradaBase(S: Pick<EstadioEnchufe, "scene" | "sw" | "sh" | "u">, t: number): EntradaBase {
  const w = S.sw(), h = S.sh();
  return { t, w, h, u: S.u(), cam: camaraDeEscena(S.scene, w, h) };
}
