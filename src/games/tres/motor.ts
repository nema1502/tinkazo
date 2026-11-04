import { PCFShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { Gobernador3D, ajustes3D, nivelInicial3D, type Ajustes3D, type Nivel3D } from "./calidad";
import { aplicarPose, crearMapa, poseCamara, type Mapa, type PerfilMapa } from "./camara";
import { sinAzarDeTres } from "./ids";
import type { EntradaBase, Fabrica3D, Montaje3D, Pantalla3D } from "./tipos";

/**
 * El motor común del 3D: three.js cargado una sola vez para todos los juegos, la escena debajo del lienzo de PixiJS
 * (que queda transparente encima con el relator, el cartel, el foco y los nombres), el tamaño que sigue a la
 * pantalla, la calidad por equipo y todo lo que hay que soltar al cerrar.
 *
 * Este archivo importa three.js a las claras: por eso solo se carga con `import()` desde `registro.ts`, y nunca desde el
 * archivo de un juego en 2D (que habla con el 3D por los tipos de `tipos.ts` y por `enchufar3D`, que no pesan nada).
 * `vite.config.ts` junta three.js en un trozo con nombre propio (`three`) que todos los juegos comparten.
 *
 * El motor no decide nada del juego. Cada cuadro, `cuadro` acomoda la cámara a la del director del 2D, deja que el
 * juego acomode su escena y renderiza.
 */

/** Lo que se tira al cerrar: geometrías, materiales y texturas creadas por el 3D de un juego. */
export class Basura {
  private readonly cosas: { dispose(): void }[] = [];
  add<T extends { dispose(): void }>(x: T): T {
    this.cosas.push(x);
    return x;
  }
  vaciar(): void {
    for (const c of this.cosas) c.dispose();
    this.cosas.length = 0;
  }
}

/** Lo que `?auditar=3d` deja en `window.__tres` (lo leen `capturas-3d.mjs` y los auditores). */
export interface Auditoria3D {
  cuadros: number;
  /** Ms entre un cuadro y el siguiente. */
  intervalos: number[];
  /** Ms de CPU que tarda cada cuadro del 3D. */
  cpu: number[];
  ultima: number;
  t: number;
  /** La hora de juego de cada momento que el auditor quiere fotografiar (el juego la llena). */
  horas: number[];
  /** Dónde puso cada figura en el 3D, para comparar con el plan 2D (el juego la llena). */
  puestos: { persona: number; x: number; z: number }[];
}

export interface Motor3D {
  readonly renderer: WebGLRenderer;
  readonly escena: Scene;
  readonly camara: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  /** Todo lo que la vista cree (geometrías, materiales, texturas) va acá para que `destruir` lo suelte. */
  readonly basura: Basura;
  /** La calidad de ahora: mirala en cada cuadro, puede bajar en el medio del show. */
  readonly ajustes: Ajustes3D;
  readonly tema: "claro" | "oscuro";
  /** Con `?auditar=3d`, el objeto de `window.__tres`; si no, null. */
  readonly auditoria: Auditoria3D | null;
  /** Pide que te avisen cuando la calidad baja (para apagar sombras, partículas). */
  alCambiarNivel(fn: (a: Ajustes3D) => void): void;
  /**
   * Un cuadro: acomoda el lienzo al tamaño de la pantalla, pone la cámara donde la tiene el director del 2D, llama a
   * `dibujar` (acá el juego acomoda su escena; sin azar de three.js) y renderiza. `perfil` dice cómo se mira (ver
   * `PerfilMapa`); `dibujar` recibe el `Mapa` de este cuadro.
   */
  cuadro(e: EntradaBase, perfil: PerfilMapa, dibujar: (mapa: Mapa, pose: ReturnType<typeof poseCamara>) => void): void;
  /** El `Mapa` para esta pantalla, para armar lo fijo del mundo (sin esperar un cuadro). */
  mapa(u: number, perfil: PerfilMapa): Mapa;
  /** Dónde cae en la pantalla una figura con la cabeza en `cabeza` y los pies en `pie` (puntos 3D), con la cámara del último cuadro. Null si está detrás de la cámara. */
  pantalla(cabeza: readonly [number, number, number], pie: readonly [number, number, number]): Pantalla3D | null;
  /** Un punto 3D en la pantalla, en píxeles (x, y) y profundidad (z, menor es más cerca). Null si está detrás de la cámara. */
  proyectar(x: number, y: number, z: number): { x: number; y: number; z: number } | null;
  /** Cuánto mide la pantalla del 3D ahora. */
  tamano(): { w: number; h: number };
  /** Suelta la basura, el renderer y el contexto. Lo llama `definir3D` al destruir la vista. */
  destruir(): void;
}

/** Lo que `crearMotor` necesita del sitio. */
export interface OpcionesMotor {
  /** El lienzo de PixiJS: el 3D va justo debajo. */
  lienzoPixi: HTMLCanvasElement;
  tema: "claro" | "oscuro";
  auditar: boolean;
}

function entornoDelEquipo(): Parameters<typeof nivelInicial3D>[0] {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let celular = false;
  let compartir = false;
  try {
    celular = matchMedia("(pointer: coarse)").matches || Math.min(innerWidth, innerHeight) <= 520;
  } catch {
    celular = false;
  }
  try {
    compartir = new URLSearchParams(location.search).get("compartir") === "1";
  } catch {
    compartir = false;
  }
  return {
    celular,
    dpr: window.devicePixelRatio || 1,
    memoriaGB: nav.deviceMemory ?? null,
    nucleos: nav.hardwareConcurrency ?? null,
    pedido: new URLSearchParams(location.search).get("calidad"),
    compartir,
  };
}

/**
 * Crea el motor, o devuelve null si no arranca (sin WebGL, sin memoria): el 2D sigue como siempre y no se entera.
 * Todo el motor se arma sin tocar `Math.random`.
 */
export function crearMotor(o: OpcionesMotor): Motor3D | null {
  try {
    return sinAzarDeTres(() => armarMotor(o));
  } catch (err) {
    console.warn("[3d] no arrancó, sigue el 2D", err);
    return null;
  }
}

function armarMotor(o: OpcionesMotor): Motor3D {
  const entorno = entornoDelEquipo();
  const arranque = nivelInicial3D(entorno);
  let ajustes = ajustes3D(arranque.nivel, entorno);
  const renderer = new WebGLRenderer({
    antialias: ajustes.antialias,
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: o.auditar,
  });
  const canvas = renderer.domElement;
  document.getElementById("tres-canvas")?.remove();
  canvas.id = "tres-canvas";
  canvas.dataset.calidad = ajustes.nivel;
  // Justo debajo del lienzo de PixiJS, que va transparente encima.
  o.lienzoPixi.before(canvas);
  renderer.setPixelRatio(ajustes.pixelRatio);
  renderer.shadowMap.enabled = ajustes.sombras === "mapa";
  renderer.shadowMap.type = PCFShadowMap;

  let perdido = false;
  canvas.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    perdido = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    perdido = false;
  });

  const escena = new Scene();
  const camara = new PerspectiveCamera(36, 1, 0.5, 4000);
  const basura = new Basura();
  const oyentes: ((a: Ajustes3D) => void)[] = [];
  const bajar = (n: Nivel3D): void => {
    ajustes = ajustes3D(n, entorno);
    canvas.dataset.calidad = n;
    renderer.setPixelRatio(ajustes.pixelRatio);
    renderer.shadowMap.enabled = ajustes.sombras === "mapa";
    renderer.setSize(W, H, false);
    for (const fn of oyentes) fn(ajustes);
  };
  const gobernador = new Gobernador3D(arranque.nivel, bajar, arranque.fijo);
  // El objeto `ajustes` se reemplaza al bajar: se expone con un getter para que quien lo guardó vea siempre el de ahora.
  const auditoria: Auditoria3D | null = o.auditar ? { cuadros: 0, intervalos: [], cpu: [], ultima: 0, t: 0, horas: [], puestos: [] } : null;
  if (auditoria) (window as unknown as { __tres: Auditoria3D }).__tres = auditoria;

  let W = 0, H = 0;
  const v = new Vector3();
  const mapas = new Map<string, Mapa>();
  const mapa = (u: number, p: PerfilMapa): Mapa => {
    const k = `${u}|${p.zc}|${p.tam}`;
    let m = mapas.get(k);
    if (!m) {
      m = crearMapa(p, u);
      if (mapas.size > 8) mapas.clear();
      mapas.set(k, m);
    }
    return m;
  };
  let ultimoReloj = 0;

  return {
    renderer,
    escena,
    camara,
    canvas,
    basura,
    get ajustes() {
      return ajustes;
    },
    tema: o.tema,
    auditoria,
    alCambiarNivel: (fn) => void oyentes.push(fn),
    mapa,
    tamano: () => ({ w: W, h: H }),
    cuadro(e, perfil, dibujar) {
      const t0 = performance.now();
      if (ultimoReloj) gobernador.cuadro(t0 - ultimoReloj);
      ultimoReloj = t0;
      if (e.w !== W || e.h !== H) {
        W = e.w;
        H = e.h;
        renderer.setSize(W, H, false);
      }
      const pose = poseCamara(e.cam, e.h, e.u, perfil);
      sinAzarDeTres(() => {
        dibujar(mapa(e.u, perfil), pose);
        aplicarPose(camara, pose, W / Math.max(1, H));
        if (!perdido) renderer.render(escena, camara);
      });
      if (auditoria) {
        const ahora = performance.now();
        if (auditoria.ultima) auditoria.intervalos.push(ahora - auditoria.ultima);
        auditoria.ultima = ahora;
        auditoria.cpu.push(ahora - t0);
        auditoria.cuadros++;
        auditoria.t = e.t;
      }
    },
    proyectar(x, y, z) {
      v.set(x, y, z).project(camara);
      if (v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, z: v.z };
    },
    pantalla(cabeza, pie) {
      if (W === 0) return null;
      v.set(cabeza[0], cabeza[1], cabeza[2]).project(camara);
      if (v.z > 1) return null;
      const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
      v.set(pie[0], pie[1], pie[2]).project(camara);
      const yPie = ((1 - v.y) / 2) * H;
      return { x, y, alto: Math.abs(yPie - y) };
    },
    destruir() {
      basura.vaciar();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (auditoria && (window as unknown as { __tres?: Auditoria3D }).__tres === auditoria) delete (window as unknown as { __tres?: Auditoria3D }).__tres;
    },
  };
}

/**
 * Lo que el archivo de un juego en 3D exporta: del `Fabrica3D` que escribe quien porta, un montaje que sabe crear el
 * motor, armar la vista y soltar todo junto. Devuelve null si el 3D no arranca.
 */
export function definir3D<E extends EntradaBase>(fabrica: Fabrica3D<E>): Montaje3D<E> {
  return (lienzoPixi, o) => {
    const motor = crearMotor({ lienzoPixi, tema: o.tema, auditar: o.auditar });
    if (!motor) return null;
    try {
      const vista = sinAzarDeTres(() => fabrica(motor, o));
      return {
        frame: (e) => vista.frame(e),
        pantallaDe: (id) => vista.pantallaDe(id),
        reconstruir: () => sinAzarDeTres(() => vista.reconstruir?.()),
        destruir() {
          try {
            vista.destruir();
          } finally {
            motor.destruir();
          }
        },
      };
    } catch (err) {
      console.warn("[3d] la vista no arrancó, sigue el 2D", err);
      motor.destruir();
      return null;
    }
  };
}
