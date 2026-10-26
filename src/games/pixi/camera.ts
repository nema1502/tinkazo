import { dentro, type Caja, type Zona } from "./encuadre";
import { Graphics, type Container, type Filter, type Renderer } from "pixi.js";
import { ZoomBlurFilter } from "pixi-filters";
import { zoomDeEmocion, type Empuje, type Golpe } from "./zoom-emocion";

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
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
  rot: number;
  tx: number;
  ty: number;
  tz: number;
  tr: number;
  rate: number;
  lastZoom: number;
  reloj: number;
  empuje: Empuje | null;
  pegada: Golpe | null;
  emoZ: number;
  emoPicoZ: number;
  emoPicoT: number;
}

export class Camera {
  /** El punto del mundo que queda en el centro de la pantalla, y el acercamiento. */
  x = 0;
  y = 0;
  zoom = 1;
  rot = 0;
  /**
   * Lo que ningún acercamiento puede cortar: una caja del mundo y la zona de la
   * pantalla donde tiene que quedar entera. Ver `proteger`.
   */
  private guardia: { caja: Caja; zona: Zona } | null = null;
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
  private blurOn = true;
  private blurModo: "pleno" | "simple" | "no" = "simple";
  private readonly blur: ZoomBlurFilter;
  private readonly extra: Filter[] = [];
  /**
   * El reloj de la cámara: la suma de los `dt`, es decir, la hora del juego (ya
   * estirada o acortada por la duración elegida). El zoom de emoción se
   * programa contra él, así que la misma ronda se mira igual.
   */
  private reloj = 0;
  /** El empuje de tensión y el golpe, como los describe `zoom-emocion.ts`. */
  private empuje: Empuje | null = null;
  private pegada: Golpe | null = null;
  /** El zoom extra de emoción en este cuadro, y el más alto que llegó y cuándo. */
  private emoZ = 0;
  private emoPicoZ = 0;
  private emoPicoT = -1;

  constructor() {
    this.blur = new ZoomBlurFilter({ strength: 0, innerRadius: 60 });
  }

  /**
   * Compila el desenfoque y los filtros de la escena antes de que se vean.
   *
   * La primera vez que la cámara hace un acercamiento rápido, la placa de video
   * compila el programa del desenfoque y el cuadro espera: en la carrera, con
   * la CPU a 4×, fueron de 118 a 514 ms congelados al segundo de arrancar
   * (auditoría del stack, 29 de septiembre de 2026). Dibujando una vez un
   * cuadrito con los mismos filtros a una textura que se tira, la compilación
   * pasa antes de mostrar el estadio, donde nadie la ve.
   */
  warm(renderer: Renderer): void {
    const g = new Graphics().rect(0, 0, 8, 8).fill(0xffffff);
    const antes = this.blur.strength;
    this.blur.strength = 0.05;
    g.filters = [...this.extra, this.blur];
    renderer.generateTexture(g).destroy(true);
    g.filters = null;
    this.blur.strength = antes;
    g.destroy();
  }

  /**
   * Los filtros de un acercamiento rápido, al máximo: para medir cuánto le
   * cuestan a la placa antes del show (`calibrar` en `stage.ts`). El cuadro
   * siguiente los vuelve a poner como corresponda.
   */
  filtrosDePrueba(sw: number, sh: number): Filter[] {
    this.blur.strength = 0.05;
    this.blur.center = { x: sw / 2, y: sh / 2 };
    return [...this.extra, this.blur];
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

  /**
   * Un empuje lento hacia el golpe: en `dur` segundos de juego, el acercamiento
   * sube `amt` veces su valor (0,06 es un 6 %) con una curva suave, y se queda
   * ahí hasta el golpe. Se suma al encuadre que el juego ya pidió: no cambia a
   * dónde mira ni cuándo llega.
   */
  tension(dur: number, amt: number): this {
    this.empuje = { t0: this.reloj, dur: Math.max(0.05, dur), amt };
    return this;
  }

  /**
   * El golpe: el instante en que el show revela al ganador. Un acercamiento
   * corto y firme de `amt` (0,12 es un 12 %) que llega en una décima de segundo,
   * se sostiene `hold` segundos y vuelve suave en `vuelta` segundos. La vuelta
   * se lleva también el empuje de `tension`. Devuelve la hora de la cámara en
   * que cayó el golpe, para anotarla a los auditores.
   */
  golpe(amt = 0.12, hold = 0.3, vuelta = 1): number {
    this.pegada = { t0: this.reloj, amt, hold, vuelta: Math.max(0.05, vuelta) };
    return this.reloj;
  }

  /** La hora de la cámara: la del juego, desde que arrancó. */
  get tiempo(): number {
    return this.reloj;
  }

  /** La hora de la cámara en que cayó el golpe, o null si el juego no pidió ninguno (para los auditores). */
  get golpeEn(): number | null {
    return this.pegada ? this.pegada.t0 : null;
  }

  /** El zoom de emoción más alto que llegó, y en qué hora de la cámara. */
  pico(): { t: number; z: number } {
    return { t: this.emoPicoT, z: this.emoPicoZ };
  }

  /** El zoom extra que dan el empuje y el golpe en este momento (0 si no hay). */
  private emocionZ(): number {
    return zoomDeEmocion(this.reloj, this.empuje, this.pegada);
  }

  /** La pose y los objetivos, para devolverlos después de que un juego se rearma. */
  snapshot(): CameraPose {
    const { x, y, zoom, rot, tx, ty, tz, tr, rate, lastZoom } = this;
    const { reloj, empuje, pegada, emoZ, emoPicoZ, emoPicoT } = this;
    return { x, y, zoom, rot, tx, ty, tz, tr, rate, lastZoom, reloj, empuje, pegada, emoZ, emoPicoZ, emoPicoT };
  }

  restore(p: CameraPose): void {
    Object.assign(this, p);
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

  /**
   * Sin desenfoque en los acercamientos. Para los juegos donde el acercamiento
   * lento cae sobre el ganador: en el sapo, la mesa entera se veía borrosa
   * justo en el último tiro (lo notó Nicolás, 4 de octubre de 2026).
   */
  noBlur(): this {
    this.blurOn = false;
    this.blurK = 0;
    return this;
  }

  /**
   * Cómo desenfoca según lo que aguanta el equipo (`calidad.ts`). Un filtro de
   * PixiJS dibuja lo que filtra a resolución 1 y sin suavizado de bordes si no
   * se le pide otra cosa: mientras la cámara se acercaba rápido, un celular
   * (resolución 2) veía la escena entera a la mitad de resolución y con los
   * bordes en escalera, y al frenar volvía a verse nítida (21 de octubre de
   * 2026). `pleno` la dibuja como el lienzo; `simple` es lo de antes; `no` lo
   * apaga, y se ahorra una pasada sobre toda la pantalla.
   */
  desenfoque(modo: "pleno" | "simple" | "no"): this {
    this.blurModo = modo;
    this.blur.resolution = modo === "pleno" ? "inherit" : 1;
    this.blur.antialias = modo === "pleno" ? "inherit" : "off";
    return this;
  }

  /**
   * Una caja del mundo que tiene que quedar entera dentro de una zona de la
   * pantalla, pase lo que pase: el acercamiento que pidió el juego, un golpe, el
   * sacudón o cualquier zoom que se sume después. Si no entra, la cámara se
   * aleja lo justo; si se sale por un costado, se corre lo justo. Sin caja, nada.
   *
   * Nació con la carrera con pocas personas (feedback de Alejandro, 19 de
   * octubre de 2026): con el golpe de la meta, la ganadora quedaba cortada
   * contra el borde del celular. El juego la protege desde que la revela, nunca
   * antes: proteger a alguien antes sería delatarlo.
   */
  proteger(caja: Caja | null, zona?: Zona): this {
    this.guardia = caja && zona ? { caja, zona } : null;
    return this;
  }

  /**
   * Con algo protegido, la escena se corre o se aleja lo justo para que quede
   * entero en su zona, con el acercamiento que de verdad se aplicó. La cámara
   * queda donde terminó y el cuadro siguiente sigue desde ahí, así que no salta
   * de vuelta; `toScreen` ve lo mismo que la escena. El sacudón se corrige solo
   * en este cuadro, para que no se acumule en la cámara.
   */
  private respetar(scene: Container, sw: number, sh: number): void {
    const g = this.guardia;
    const z = scene.scale.x;
    if (!g || !(z > 0)) return;
    const v = dentro(g.caja, g.zona, { x: this.x, y: this.y, z }, sw, sh);
    if (v.z < z) {
      const f = v.z / z;
      this.zoom *= f;
      // El desenfoque mide la velocidad del acercamiento: esto no es un movimiento.
      this.lastZoom *= f;
      scene.scale.set(v.z);
    }
    this.x = v.x;
    this.y = v.y;
    const dx = scene.position.x - sw / 2, dy = scene.position.y - sh / 2;
    const w = dentro(g.caja, g.zona, v, sw + 2 * dx, sh + 2 * dy);
    scene.pivot.set(w.x, w.y);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.rate * dt);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.zoom += (this.tz - this.zoom) * k;
    this.rot += (this.tr - this.rot) * k;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * (6 + this.shakeAmt * 0.4));
    this.punchAmt = Math.max(0, this.punchAmt - dt * 1.6);
    this.reloj += dt;
    this.emoZ = this.emocionZ();
    if (this.emoZ > this.emoPicoZ) {
      this.emoPicoZ = this.emoZ;
      this.emoPicoT = this.reloj;
    }
    // El desenfoque sigue a la velocidad del acercamiento, suavizado para que
    // no parpadee de un cuadro al otro.
    const z = this.zoom * (1 + this.punchAmt);
    const speed = dt > 0 ? Math.abs(z - this.lastZoom) / dt : 0;
    this.lastZoom = z;
    // Tope en 0,05: con 0,1 los nombres se volvían ilegibles durante los
    // acercamientos de Oruro, la constelación y luz roja (lo encontró la revisión
    // visual, 30 de septiembre de 2026).
    this.blurK += (Math.min(0.05, speed * 0.055) - this.blurK) * Math.min(1, dt * 12);
  }

  /** Aplica la cámara a la escena. `now` es la hora del juego, para el sacudón. */
  apply(scene: Container, sw: number, sh: number, now: number): void {
    const s = this.shakeAmt;
    const sx = s ? Math.sin(now * 91) * s + Math.sin(now * 37 + 1.3) * s * 0.5 : 0;
    const sy = s ? Math.sin(now * 113 + 0.7) * s * 0.8 : 0;
    const z = this.zoom * (1 + this.punchAmt + this.emoZ);
    scene.pivot.set(this.x, this.y);
    scene.position.set(sw / 2 + sx, sh / 2 + sy);
    scene.scale.set(z);
    scene.rotation = this.rot + (s ? Math.sin(now * 53) * s * 0.0006 : 0);
    // Lo protegido, entero en su zona con cualquier acercamiento: ver `proteger`.
    this.respetar(scene, sw, sh);
    const filters: Filter[] = [...this.extra];
    if (this.blurOn && this.blurModo !== "no" && this.blurK > 0.006) {
      this.blur.strength = this.blurK;
      this.blur.center = { x: sw / 2, y: sh / 2 };
      filters.push(this.blur);
    }
    scene.filters = filters.length ? filters : null;
  }

  /** Dónde cae en pantalla un punto del mundo, para la interfaz. */
  toScreen(x: number, y: number, sw: number, sh: number): { x: number; y: number } {
    const z = this.zoom * (1 + this.punchAmt + this.emoZ);
    return { x: sw / 2 + (x - this.x) * z, y: sh / 2 + (y - this.y) * z };
  }
}
