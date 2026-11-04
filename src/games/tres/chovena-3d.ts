import type { Fog, HemisphereLight } from "three";
import { perfil, type Mapa, type PerfilMapa } from "./camara";
import {
  BAJA_SENTADO, HOMBRO_X, HOMBRO_Y, crearHombros, crearManos, manoDeFila, manoSuelta, mirada, punto, tomarManos,
  type ContextoManos, type Cuerpo, type Hombros, type ManosTomadas, type V3,
} from "./chovena-3d-brazos";
import { Gente, lineal, personaFija, type PersonaFija } from "./chovena-3d-gente";
import { crearPlaza } from "./chovena-3d-plaza";
import type { BailarinEntrada, EntradaChovena } from "./chovena-3d-tipos";
import { crearMedidas, medidor, type Medidas } from "./chovena-3d-auditoria";
import { crearAmbiente, SombrasDeContacto } from "./escena";
import { hash } from "./ids";
import { definir3D } from "./motor";
import type { Fabrica3D, Lanzador, Pantalla3D } from "./tipos";

export type { EntradaChovena } from "./chovena-3d-tipos";

/**
 * La chovena en 3D (`?motor=3d`). Dibuja lo que `pixi/chovena.ts` ya decidió: dónde baila cada uno, quién está de la
 * mano de quién, quién se tambalea, quién salió y se sentó, y cuándo corta el conjunto. No calcula nada del juego
 * (src/games/tres/README.md).
 *
 * La plaza del 2D es un óvalo aplastado: el 3D la mira desde la misma altura de cámara (21 grados acostado, 51 en el
 * celular parado, lo que da el aplastado), así cada pie cae donde el 2D lo pone, y las fichas de nombre, el cartel y el
 * foco siguen cayendo donde corresponde. La perspectiva reemplaza el crecimiento por profundidad del 2D.
 */

/** Lo que pesa en la cámara cada cosa que el 3D le suma al director: grados. */
const ARRANQUE_GRADOS = 9;
const TENSION_GRADOS = 4;
const GOLPE_GRADOS = 4;
/** La altura de la cámara con una rueda de tres a seis, en grados. */
const ELEVACION_CHICA = 40;
/**
 * El campo de visión: una lente más larga que la de la carrera (36 grados). Con la plaza llena la pantalla, a 36 grados la
 * fila de adelante de la rueda crece casi el doble que la de atrás y se sale por abajo, y con el acercamiento de la corona
 * la ganadora, que está más cerca de la cámara que el punto mirado, crece a una vez y media su tamaño en el 2D; a 20 grados
 * queda cerca de cómo el 2D acomoda los nombres, el cartel y el foco.
 */
const FOV_GRADOS = 20;

const grados = (g: number): number => (g * Math.PI) / 180;
const suave = (x: number, a = 0, b = 1): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Cuánto se ve de aplastada la plaza del 2D en esta pantalla: lo que da la altura de la cámara. */
export const aplastadoDe = (p: { rx: number; ry: number }): number => Math.max(0.2, Math.min(0.95, p.ry / Math.max(1, p.rx)));

/**
 * Cómo se mira: la altura que da el aplastado del 2D, más lo que suma el 3D (entra de más arriba y baja en 2,2 s, baja
 * unos grados en la última vuelta de la final y un contrapicado leve con el golpe). `zc` no cambia: lo que se pisa en el
 * 2D se pisa en el mismo lugar.
 */
export function perfilChovena(ap: number, t: number, tension: number, golpe: number, hMira = 0, chica = 0): PerfilMapa {
  // La rueda chica (de tres a seis) queda estirada a lo hondo en el piso: se la mira de más arriba, y el piso se estira menos
  // (`zc`) a la par, así nadie se mueve en la pantalla pero las manos se alcanzan.
  const piso = Math.asin(ap);
  const base = piso + Math.max(0, grados(ELEVACION_CHICA) - piso) * Math.max(0, Math.min(1, chica));
  const extra = grados(ARRANQUE_GRADOS) * (1 - suave(t, 0, 2.2)) - grados(TENSION_GRADOS) * suave(tension) - (golpe >= 0 ? grados(GOLPE_GRADOS) * suave(golpe, 0, 0.9) : 0);
  // El centro de la pantalla del 2D es un punto del cuerpo de quien se mira, a `hMira` píxeles sobre el piso: la cámara mira ahí.
  return perfil({ elevacion: Math.max(grados(8), base + extra), azimut: 0, zc: 1 / Math.sin(base), acerca: 1, tam: 1, fov: grados(FOV_GRADOS), altoMira: hMira, pieMira: hMira });
}

/**
 * La luz del mundo: baja con la corona (es la penumbra del foco hecha luz) y vuelve a un poco más de la mitad mientras
 * dura el cartel.
 */
export const luzDeCorona = (corona: number, golpe: number): number => {
  if (corona < 0) return 1;
  const baja = 1 - 0.5 * suave(corona, 0, 0.25);
  return golpe < 0 ? baja : baja + 0.15 * suave(golpe, 0, 1.2);
};

const TINTES: Record<"claro" | "oscuro", readonly [readonly [number, number, number], readonly [number, number, number]]> = {
  oscuro: [lineal(0x9a92ad), lineal(0xfff0c2)],
  claro: [lineal(0xc2bccb), lineal(0xfff0c2)],
};
const SIN_TINTE = [1, 1, 1] as const;
const ALTO_CABEZA = 1.08;

/** Cuánto levanta el pie el trote, en bailarines (`lift` del 2D). */
const LEVANTE = 0.04;

interface Cache {
  n: number;
  gente: Gente;
  sombras: SombrasDeContacto;
  fijas: PersonaFija[];
  hombros: Hombros;
  manos: ManosTomadas;
  cuerpos: Cuerpo[];
  /** Por bailarín: la cabeza y los pies en el mundo 3D, y si se vio en este cuadro. */
  cabeza: Float32Array;
  pie: Float32Array;
  visto: Uint8Array;
}

const fabrica: Fabrica3D<EntradaChovena> = (motor, o) => {
  const oscuro = o.tema === "oscuro";
  const amb = crearAmbiente(motor, oscuro ? { solDesde: [-70, 40, 90] } : { solDesde: [-55, 85, 75] });
  amb.sol.castShadow = false;
  const hemi = motor.escena.children.find((x): x is HemisphereLight => (x as HemisphereLight).isHemisphereLight === true);
  const plaza = crearPlaza(motor);
  const tinta = oscuro ? 0x16161f : 0x191919;
  let c: Cache | null = null;
  const tintes = TINTES[o.tema];
  const manoL: V3 = [0, 0, 0], manoR: V3 = [0, 0, 0], tmp: V3 = [0, 0, 0], fila: V3 = [0, 0, 0];
  const centro: V3 = [0, 0, 0];
  const ctx: ContextoManos = { modo: "rueda", tipoy: false, ritmo: 0, aplauso: 0, salida: -1 };
  // Con `?auditar=3d`: cuántos eslabones pidió el 2D y cuántos se hicieron, en `window.__tres.extra`.
  const extra = motor.auditoria ? ((motor.auditoria as unknown as { extra: Medidas }).extra = crearMedidas()) : null;
  const medir = extra ? medidor(extra) : null;

  const armar = (e: EntradaChovena): Cache => {
    const n = e.bailarines.length;
    const liviano = n > 60;
    const gente = new Gente(motor.escena, motor.basura, n + 3, tinta, liviano, true);
    const sombras = new SombrasDeContacto(motor, n + 3, 0.32);
    const fijas = e.bailarines.map((b) => personaFija(b.tipoy, b.color, Math.floor(hash(b.id, 42) * 4), Math.floor(hash(b.id, 43) * 4), Math.floor(hash(b.id, 44) * 4)));
    return {
      n, gente, sombras, fijas,
      hombros: crearHombros(n),
      manos: crearManos(n),
      cuerpos: e.bailarines.map(() => ({ fx: 0, fy: 0, fz: 0, D: 1, yaw: 0, lean: 0, baja: 0 })),
      cabeza: new Float32Array(3 * (n + 3)),
      pie: new Float32Array(3 * (n + 3)),
      visto: new Uint8Array(n + 3),
    };
  };

  /** Dónde queda el cuerpo de `b` en el mundo 3D y hacia dónde mira. */
  const plantar = (b: BailarinEntrada, k: Cuerpo, e: EntradaChovena, mapa: Mapa, D: number): void => {
    const [fx, fy, fz] = mapa.a3D(b.x, b.y, b.alto);
    const [cxp, , czp] = mapa.a3D(b.cx, b.cy);
    let par: [number, number] | null = null;
    if (b.pareja >= 0) {
      const q = e.bailarines[b.pareja];
      if (q) {
        const [qx, , qz] = mapa.a3D(q.x, q.y);
        par = [qx, qz];
      }
    }
    k.fx = fx;
    k.fy = fy;
    k.fz = fz;
    k.D = D;
    k.yaw = mirada(fx, fz, cxp, czp, b.sentido, b.haciaSala, par);
    k.lean = -b.inclinacion;
    k.baja = BAJA_SENTADO * b.sentado;
  };

  return {
    frame(e) {
      const ap = aplastadoDe(e.plaza);
      // A qué altura sobre el piso está el punto que mira el director: el medio del cuerpo en la rueda, la cabeza en la corona.
      const hMira = Math.max(0.3 * e.plaza.dh, Math.min(1.15 * e.plaza.dh, e.plaza.cy - e.cam.y));
      const perf = perfilChovena(ap, e.t, e.tension, e.golpe, hMira, e.chica);
      motor.cuadro(e, perf, (mapa, pose) => {
        if (!c) c = armar(e);
        const K = c;
        const D = mapa.escalaFigura(e.plaza.dh);
        const B = e.bailarines;

        // La niebla sigue a la cámara: arranca a 1,5 veces la distancia al centro de la escena y cierra a 5.
        const fog = motor.escena.fog as Fog | null;
        if (fog) {
          const dist = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[1] - pose.mira[1], pose.pos[2] - pose.mira[2]);
          fog.near = dist * 1.5;
          fog.far = dist * 5;
        }
        // La luz del mundo baja con la corona.
        const luz = luzDeCorona(e.corona, e.golpe);
        amb.sol.intensity = amb.paleta.luzSolFuerza * luz;
        if (hemi) hemi.intensity = amb.paleta.hemiFuerza * luz;

        plaza.actualizar(e, mapa);

        // 1. Dónde está cada uno y dónde tiene los hombros.
        const H = K.hombros;
        for (let i = 0; i < K.n; i++) {
          const b = B[i] as BailarinEntrada;
          const k = K.cuerpos[i] as Cuerpo;
          K.visto[i] = b.visible ? 1 : 0;
          if (!b.visible) continue;
          plantar(b, k, e, mapa, D);
          punto(k, 0, HOMBRO_Y, 0, centro);
          H.centro.set(centro, 3 * i);
          punto(k, HOMBRO_X, HOMBRO_Y, 0, centro);
          H.izq.set(centro, 3 * i);
          punto(k, -HOMBRO_X, HOMBRO_Y, 0, centro);
          H.der.set(centro, 3 * i);
          H.izqDir[2 * i] = Math.cos(k.yaw);
          H.izqDir[2 * i + 1] = -Math.sin(k.yaw);
          H.D[i] = D;
        }
        // 2. Las manos que se toman: las dos llegan al mismo punto.
        const hechos = tomarManos(H, e.eslabones, K.manos);

        // 3. Dibujar a todos.
        ctx.ritmo = e.ritmo;
        ctx.aplauso = e.aplauso;
        K.gente.inicio();
        K.sombras.usar(0);
        let ns = 0;
        for (let i = 0; i < K.n; i++) {
          const b = B[i] as BailarinEntrada;
          if (!b.visible) continue;
          const k = K.cuerpos[i] as Cuerpo;
          ctx.modo = b.modo;
          ctx.tipoy = b.tipoy;
          ctx.salida = b.salida;
          for (let li = 0; li < 2; li++) {
            const lado = li === 0 ? 1 : -1;
            const out = li === 0 ? manoL : manoR;
            const usa = li === 0 ? K.manos.usaIzq[i] : K.manos.usaDer[i];
            if (usa) {
              const src = li === 0 ? K.manos.izq : K.manos.der;
              out[0] = src[3 * i] as number;
              out[1] = src[3 * i + 1] as number;
              out[2] = src[3 * i + 2] as number;
            } else {
              manoSuelta(ctx, lado, tmp);
              punto(k, tmp[0], tmp[1], tmp[2], out);
            }
            // En las filas del arranque: ellas con las manos en la cintura, ellos dando palmadas.
            if (b.filas > 0) {
              manoDeFila(ctx, lado, tmp);
              punto(k, tmp[0], tmp[1], tmp[2], fila);
              for (let a = 0; a < 3; a++) out[a] = (out[a] as number) * (1 - b.filas) + (fila[a] as number) * b.filas;
            }
          }
          const mult = b.tinte === 0 ? SIN_TINTE : (tintes[b.tinte - 1] as readonly [number, number, number]);
          // Quien gana queda con todo su color aunque baje la luz del mundo.
          const brillo = b.modo === "salta" ? Math.min(2.4, 1 + (1 / Math.max(0.3, luz) - 1) * 0.85) : 1;
          const lev = b.paso * LEVANTE;
          K.gente.persona(K.fijas[i] as PersonaFija, k, Math.max(0, lev), Math.max(0, -lev), b.sentado, manoL, manoR, mult, brillo);
          // El piso bajo sus pies, sin lo que se levanta.
          const [sx, , sz] = [k.fx, 0, k.fz];
          K.sombras.poner(ns++, sx, sz, 0.2 * D, 0.2 * D * 0.9, 0.04);
          // Dónde quedan su cabeza y sus pies, para su nombre.
          punto(k, 0, ALTO_CABEZA, 0, tmp);
          K.cabeza.set(tmp, 3 * i);
          K.pie.set([k.fx, k.fy, k.fz], 3 * i);
        }
        // El conjunto: los músicos son tres personas más, de camisa y sombrero.
        for (const m of plaza.musicos(e, mapa)) {
          const k: Cuerpo = { fx: m.fx, fy: m.fy, fz: m.fz, D: m.D, yaw: 0, lean: m.lean, baja: 0 };
          K.gente.persona(m.fija, k, 0, 0, 0, m.manoI, m.manoD, SIN_TINTE, 1);
          K.sombras.poner(ns++, m.fx, m.fz, 0.2 * m.D, 0.18 * m.D, 0.07);
        }
        K.sombras.usar(ns);
        K.sombras.fin();
        K.gente.fin(motor.ajustes.nivel !== "baja");

        medir?.(e, hechos, { n: K.n, cabeza: K.cabeza, pie: K.pie, visto: K.visto, D }, (id) => this.pantallaDe(id));
      });
    },
    pantallaDe(id): Pantalla3D | null {
      if (!c || id < 0 || id >= c.n || !c.visto[id]) return null;
      const h = c.cabeza, p = c.pie;
      return motor.pantalla([h[3 * id] as number, h[3 * id + 1] as number, h[3 * id + 2] as number], [p[3 * id] as number, p[3 * id + 1] as number, p[3 * id + 2] as number]);
    },
    destruir() {
      c = null;
    },
  };
};

/** La vista que `pixi/chovena.ts` recibe como quinto parámetro. */
export const montaje = definir3D(fabrica);

/** Lo que busca `registro.ts`: la chovena en 3D aparece sola, sin editar ningún archivo compartido. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/chovena");
  return (names, winners, beacon, done) => m.chovenaPixi(names, winners, beacon, done, montaje);
};

