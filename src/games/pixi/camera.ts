import type { Container, Filter } from "pixi.js";
import { ZoomBlurFilter } from "pixi-filters";

/**
 * El director de cámara.
 *
 * El director de emoción decide qué pasa en un sorteo; este decide cómo se
 * mira. Cada juego le dice a quién mirar y qué tan cerca, y la cámara llega
 * con suavidad, se acerca de golpe en los momentos grandes, sacude en los
 * choques y, cuando el acercamiento es rápido, desenfoca hacia el centro como
 * un zoom de cine.
 *
 * Tres reglas, las mismas del resto del proyecto:
 *
 * - **Todo sale de la hora del juego.** El sacudón es un seno del reloj, no
 *   azar: la misma ronda se mira igual. La suavidad depende del `dt`, que el
 *   auditor exigente fija en pasos exactos.
 * - **La cámara no decide nada.** Se mueve hacia lo que el juego ya decidió.
 * - **El desenfoque se apaga cuando no hace falta.** Un filtro sobre toda la
 *   escena cuesta en un celular: se prende solo mientras la cámara se mueve.
 */
export class Camera {
  /** El punto del mundo que queda en el centro de la pantalla, y el acercamiento. */
  x = 0;
  y = 0;
  zoom = 1;
  rot = 0;
  private tx = 0;
  private ty = 0;
  private tz = 1;
  private tr = 0;
  /** Qué tan rápido llega a su objetivo: más alto, más seco. */
  private rate = 3;
  private shakeAmt = 0;
  private punchAmt = 0;
  private lastZoom = 1;
  private blurK = 0;
  private readonly blur: ZoomBlurFilter;
  private readonly extra: Filter[] = [];

  constructor() {
    this.blur = new ZoomBlurFilter({ strength: 0, innerRadius: 60 });
  }

  /** Mirar a un punto, con un acercamiento, llegando a ese ritmo. */
  lookAt(x: number, y: number, zoom = this.tz, rate = 3, rot = 0): this {
    this.tx = x;
    this.ty = y;
    this.tz = zoom;
    this.tr = rot;
    this.rate = rate;
    return this;
  }

  /** Inclina la cámara, como una toma con el viento: se suma a lo que mira. */
  tilt(rot: number): this {
    this.tr = rot;
    return this;
  }

  /** Un corte: la cámara salta al punto sin viajar. */
  cut(x: number, y: number, zoom = this.tz): this {
    this.x = this.tx = x;
    this.y = this.ty = y;
    this.zoom = this.tz = this.lastZoom = zoom;
    return this;
  }

  /** Un sacudón, que se apaga solo. `a` en píxeles de pantalla. */
  shake(a: number): this {
    this.shakeAmt = Math.max(this.shakeAmt, a);
    return this;
  }

  /** Un acercamiento de golpe que vuelve solo: el "¡pum!" de un choque. */
  punch(z: number): this {
    this.punchAmt = Math.max(this.punchAmt, z);
    return this;
  }

  /** Filtros que el juego quiere sobre toda la escena, además del desenfoque. */
  addFilter(f: Filter): void {
    this.extra.push(f);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.rate * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * k;
    this.rot += (this.tr - this.rot) * k;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * (6 + this.shakeAmt * 0.4));
    this.punchAmt = Math.max(0, this.punchAmt - dt * 1.6);
    // El desenfoque sigue a la velocidad del acercamiento, suavizado para que
    // no parpadee de un cuadro al otro.
    const z = this.zoom * (1 + this.punchAmt);
    const speed = dt > 0 ? Math.abs(z - this.lastZoom) / dt : 0;
    this.lastZoom = z;
    // Tope en 0,1: más que eso ya no se lee lo que pasa mientras la cámara viaja.
    this.blurK += (Math.min(0.1, speed * 0.055) - this.blurK) * Math.min(1, dt * 12);
  }

  /** Aplica la cámara a la escena. `now` es la hora del juego, para el sacudón. */
  apply(scene: Container, sw: number, sh: number, now: number): void {
    const s = this.shakeAmt;
    const sx = s ? Math.sin(now * 91) * s + Math.sin(now * 37 + 1.3) * s * 0.5 : 0;
    const sy = s ? Math.sin(now * 113 + 0.7) * s * 0.8 : 0;
    const z = this.zoom * (1 + this.punchAmt);
    scene.pivot.set(this.x, this.y);
    scene.position.set(sw / 2 + sx, sh / 2 + sy);
    scene.scale.set(z);
    scene.rotation = this.rot + (s ? Math.sin(now * 53) * s * 0.0006 : 0);
    const filters: Filter[] = [...this.extra];
    if (this.blurK > 0.006) {
      this.blur.strength = this.blurK;
      this.blur.center = { x: sw / 2, y: sh / 2 };
      filters.push(this.blur);
    }
    scene.filters = filters.length ? filters : null;
  }

  /** Dónde cae en pantalla un punto del mundo, para la interfaz. */
  toScreen(x: number, y: number, sw: number, sh: number): { x: number; y: number } {
    const z = this.zoom * (1 + this.punchAmt);
    return { x: sw / 2 + (x - this.x) * z, y: sh / 2 + (y - this.y) * z };
  }
}
