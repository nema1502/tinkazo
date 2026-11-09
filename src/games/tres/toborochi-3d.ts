import {
  BackSide, BufferAttribute, BufferGeometry, CircleGeometry, Color, ConeGeometry, DirectionalLight, DoubleSide, Euler, Float32BufferAttribute,
  Fog, Group, HemisphereLight, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, SphereGeometry,
  Object3D, Vector3, type Material,
} from "three";
import { hashDe } from "../pixi/kit/azar";
import type { Geo } from "../pixi/toborochi-arbol";
import { CIELOS, SombrasDeContacto, esparcirPorHash } from "./escena";
import { Instancias } from "./figuras";
import { hash, sinAzarDeTres } from "./ids";
import { definir3D } from "./motor";
import type { Motor3D } from "./motor";
import { aMundo, camaraParaMotor, distanciaDe, perfilEn, profMax, profundidadDe, suave, type EntradaToborochi, type PantallaFlor } from "./toborochi-3d-mapa";
import { geoFlor, geoTronco, radioDelTronco, type MedidasTronco } from "./toborochi-3d-piezas";
import type { Fabrica3D, Lanzador } from "./tipos";

export type { EntradaToborochi, FlorE, PantallaFlor } from "./toborochi-3d-mapa";

/**
 * El Toborochi en 3D (src/games/tres/README.md; el 2D y el plan en `pixi/toborochi*.ts`).
 *
 * Un toborochi solo en un campo abierto, de verdad: el tronco panzón con volumen y espinas, la copa con profundidad, las
 * flores que caen girando y enseñando el revés hasta quedar tendidas en el pasto, y un colibrí que se acerca y retrocede
 * en profundidad. No decide nada: el 2D pone dónde está cada flor, cuánto se dobla con el viento, cuánto brilla y por
 * dónde vuela el colibrí; esto lo viste. La cámara es la del director del 2D (ver `toborochi-3d-mapa.ts`), así que la
 * flor de quien gana, el foco, la placa y los nombres caen donde el 2D los espera. Las caras y los nombres siguen siendo
 * de PixiJS, encima.
 *
 * Sin azar: todo es función de `t` y de un hash del lugar. Nada de esto sabe quién gana antes del golpe: el único dato es
 * `e.ganador`, que el 2D llena recién cuando cae el golpe.
 */

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const c01 = (v: number): number => Math.max(0, Math.min(1, v));

/* ------------------------------------------------------------- la paleta */
interface Paleta {
  /** Las cuatro franjas del cielo, de arriba al horizonte (cada una, de un color al otro). */
  bandas: readonly (readonly [number, number])[];
  suelo: number;
  matas: number;
  alfombra: number;
  cerroLejos: number;
  cerroCerca: number;
  piel: number;
  sombra: number;
  espina: number;
  rama: number;
  sol: number;
  nube: number;
  tinta: number;
  /** De dónde viene el sol: la elevación en grados. */
  elevacionSol: number;
  /** Los acentos de la luz (la hemisférica y el sol) y cuánto pesan. */
  rosaMezcla: number;
}

const PALETAS: Record<"claro" | "oscuro", Paleta> = {
  oscuro: {
    bandas: [[0x2d2352, 0x4a3470], [0x6b3b78, 0x9a4b80], [0xc2587a, 0xe07a72], [0xf2985c, 0xffc07a]],
    suelo: 0x59764a, matas: 0x4c6a3f, alfombra: 0x4f6c42, cerroLejos: 0x4e3a6c, cerroCerca: 0x3b2c58,
    piel: 0x7f8f6a, sombra: 0x586848, espina: 0xd9d3b8, rama: 0x6f6a58, sol: 0xffe2a8, nube: 0x2b2542, tinta: 0x16161f, elevacionSol: 20, rosaMezcla: 0.12,
  },
  claro: {
    bandas: [[0x8fc7f0, 0xa9d6f5], [0xc2e2f5, 0xdcecf0], [0xf6e6dc, 0xfbe0d0], [0xfdd8c2, 0xfcd0b4]],
    suelo: 0x8dbb78, matas: 0x73a95f, alfombra: 0x86b572, cerroLejos: 0xb2cfae, cerroCerca: 0x95bd92,
    piel: 0x9aae7e, sombra: 0x728a5c, espina: 0xe9e1c4, rama: 0x7d6e58, sol: 0xfff6d6, nube: 0x6c7893, tinta: 0x191919, elevacionSol: 50, rosaMezcla: 0,
  },
};

const ROSAS = [0xff80b8, 0xff97c6, 0xf56aab];
const ROSA_BORDE = 0xc23a78;
const CREMA = 0xfff4d6;
const ESTAMBRE = 0xf2a93b;
const ORO = 0xffc629;
const ORO_NOCHE = 0xffd24d;
const BLANCO = 0xffffff;

const mezcla = (a: number, b: number, k: number): number => {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k), g = lerp((a >> 8) & 255, (b >> 8) & 255, k), bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** Cuántos tramos tiene cada rama y cuántos lados. */
const TRAMOS = 8;
const LADOS = 6;
const RAMAS_MAX = 8;
/** Cuántos pétalos suben en el remolino del golpe, y cuántas rayas de viento y pétalos en el aire hay. */
const REMOLINO_MAX = 48;
const RAYAS = 14;
const AIRE = 18;
const TRAMOS_RAYA = 7;
/** Hasta cuántas flores llevan contorno completo; con más, solo las que brillan. */
const CONTORNO_TODAS = 60;

/** El radio de la cúpula del cielo, en unidades 3D. */
const RC = 2600;

/* --------------------------------------------------------------- lo que arma */
interface Armado {
  /** Con qué tamaño de pantalla se armó. */
  w: number;
  h: number;
  n: number;
  actualizar(e: EntradaToborochi, s: number): void;
  pantallaDe(id: number): PantallaFlor | null;
  soltar(): void;
}

const fabrica: Fabrica3D<EntradaToborochi> = (motor, o) => {
  const P = PALETAS[o.tema];
  const noche = o.tema === "oscuro";
  const B = motor.basura;
  const escena = motor.escena;

  /* ---------------------------------------------------------- luces y niebla */
  const C = CIELOS[o.tema];
  const horizonte = new Color(mezcla((P.bandas[3] as readonly [number, number])[0], (P.bandas[3] as readonly [number, number])[1], 0.5));
  const niebla = new Fog(horizonte, 1, 2);
  escena.fog = niebla;
  const hemi = new HemisphereLight(C.hemiCielo, C.hemiSuelo, C.hemiFuerza);
  const sol = new DirectionalLight(C.luzSol, C.luzSolFuerza);
  escena.add(hemi, sol, sol.target);
  const E = (P.elevacionSol * Math.PI) / 180;
  const haciaElSol = new Vector3(-0.5 * Math.cos(E), Math.sin(E), 0.87 * Math.cos(E)).normalize();

  /* ---------------------------------------------------------------- el cielo */
  const cenit = new Color(mezcla((P.bandas[0] as readonly [number, number])[0], 0x000000, noche ? 0.25 : 0));
  const franjas = P.bandas.map(([a, b]) => new Color(mezcla(a, b, 0.5)));
  const domoGeo = B.add(new SphereGeometry(RC, 24, 14));
  const pos = domoGeo.getAttribute("position");
  const colores: number[] = [];
  const cT = new Color();
  for (let i = 0; i < pos.count; i++) {
    // Cuatro franjas entre el horizonte y unos 20 grados; después, hacia el cenit.
    const k = c01(pos.getY(i) / RC / 0.36) * 3;
    const j = Math.min(2, Math.floor(k));
    cT.copy(franjas[3 - j] as Color).lerp(franjas[2 - j] as Color, k - j);
    if (k >= 3) cT.copy(franjas[0] as Color).lerp(cenit, c01((pos.getY(i) / RC - 0.36) / 0.5));
    colores.push(cT.r, cT.g, cT.b);
  }
  domoGeo.setAttribute("color", new Float32BufferAttribute(colores, 3));
  const matCielo = B.add(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  const domo = new Mesh(domoGeo, matCielo);
  domo.renderOrder = -10;
  domo.frustumCulled = false;
  escena.add(domo);
  // El sol (de mañana, alto a la izquierda; al atardecer, bajo a la derecha), plano.
  {
    const az = noche ? 0.3 : -0.32;
    const el = noche ? 0.09 : 0.3;
    const dir = new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const geo = B.add(new CircleGeometry(RC * 0.045, 24));
    const disco = new Mesh(geo, B.add(new MeshBasicMaterial({ color: P.sol, fog: false, depthWrite: false })));
    disco.position.copy(dir).multiplyScalar(RC * 0.92);
    disco.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().negate());
    disco.renderOrder = -9;
    disco.frustumCulled = false;
    domo.add(disco);
  }
  const blanco = new Color(0xffffff);
  const velo = new Color(P.nube).lerp(new Color(0xffffff), 0.35);
  const tinte = new Color();

  let armado: Armado | null = null;
  let ultimaCalidad = motor.ajustes.nivel;
  motor.alCambiarNivel((a) => {
    ultimaCalidad = a.nivel;
  });

  return {
    frame(e) {
      const claveH = `${e.w}x${e.h}`;
      if (!armado || `${armado.w}x${armado.h}` !== claveH || armado.n !== e.n) {
        armado?.soltar();
        // three.js le pone a cada objeto un identificador al azar: el auditor cuenta cada tirada, y el motor ya presta un contador al armar la vista y en cada cuadro, pero este armado cae entre los dos.
        armado = sinAzarDeTres(() => armar(motor, o, P, e));
      }
      const a = armado;
      const perfil = perfilEn(e);
      const ent = { ...e, cam: camaraParaMotor(e.cam) };
      motor.cuadro(ent, perfil, (mapa, pose) => {
        // El cielo sigue a la cámara; el velo del surazo solo lo oscurece a él (a las flores no las toca).
        domo.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
        tinte.copy(blanco).lerp(velo, c01(e.nube) * 0.7);
        matCielo.color.copy(tinte);
        sol.target.position.set(pose.mira[0], pose.mira[1], pose.mira[2]);
        sol.position.set(pose.mira[0] + haciaElSol.x * 200, pose.mira[1] + haciaElSol.y * 200, pose.mira[2] + haciaElSol.z * 200);
        // La niebla separa los planos: desde 1,5 veces la distancia a la escena y cierra a 5.
        const dist = distanciaDe(e.h) * mapa.s;
        niebla.near = dist * 1.5;
        niebla.far = dist * 5;
        a.actualizar(e, mapa.s);
      });
      const au = motor.auditoria as unknown as Record<string, number> | null;
      if (au) {
        const info = motor.renderer.info;
        au.llamadas = info.render.calls;
        au.triangulos = info.render.triangles;
        au.maxLlamadas = Math.max(au.maxLlamadas ?? 0, info.render.calls);
        au.nivel3d = ultimaCalidad === "alta" ? 2 : ultimaCalidad === "media" ? 1 : 0;
        // Para el medidor de encuadre (scripts/medir-toborochi-3d.mjs): dónde cae cada flor en la pantalla en este cuadro.
        au.tQuedan0 = e.tQuedan0;
        au.tPico = e.tPico;
        au.tau = e.tau;
        const lista: unknown[] = [];
        for (let i = 0; i < e.n; i++) {
          const f = e.flores[i];
          const p = f && f.escala > 0.015 ? armado?.pantallaDe(i) : null;
          if (p && f) lista.push([i, p.x, p.y, p.alto, f.cae > 0 || f.suelo ? 0 : 1]);
        }
        (au as unknown as { pantallas: unknown[] }).pantallas = lista;
      }
    },
    pantallaDe: (id) => armado?.pantallaDe(id) ?? null,
    reconstruir() {
      armado?.soltar();
      armado = null;
    },
    destruir() {
      armado?.soltar();
      armado = null;
    },
  };
};

/* ----------------------------------------------------------- el armado del mundo */

function armar(motor: Motor3D, o: { tema: "claro" | "oscuro" }, P: Paleta, e0: EntradaToborochi): Armado {
  const noche = o.tema === "oscuro";
  const g: Geo = e0.geo;
  const n = e0.n;
  const h = e0.h;
  const D = distanciaDe(h);
  const DZ = profMax(h);
  const mundo = new Group();
  motor.escena.add(mundo);
  const desechos: { dispose(): void }[] = [];
  const reg = <T extends { dispose(): void }>(x: T): T => {
    desechos.push(x);
    motor.basura.add(x);
    return x;
  };
  const cRama = mezcla(P.piel, noche ? 0x3f3626 : 0x5a4a34, 0.24);
  const lambert = (color: number, extra: object = {}): MeshLambertMaterial => reg(new MeshLambertMaterial({ color, flatShading: true, ...extra }));
  const basico = (color: number, extra: object = {}): MeshBasicMaterial => reg(new MeshBasicMaterial({ color, ...extra }));
  const agregar = (m: Object3D): void => void mundo.add(m);
  const mesh = (geo: BufferGeometry, mat: Material): Mesh => new Mesh(reg(geo), mat);
  const cZ = (x: number): number => {
    // Una rama a la profundidad de la panza de la copa en esa `x`.
    const uu = Math.max(-1, Math.min(1, (x - g.cx) / Math.max(1, g.copa.ancho / 2)));
    return 0.225 * DZ * (1 - uu * uu);
  };

  /* ------------------------------------------------------------ el piso y los cerros */
  const GRANDE = Math.max(g.w, h) * 40;
  const piso = mesh(new PlaneGeometry(GRANDE, GRANDE), lambert(P.suelo));
  piso.rotation.x = -Math.PI / 2;
  piso.position.set(g.cx, -0.5, 0);
  agregar(piso);
  // La alfombra: un tono más apagado, en la franja del piso que viene hacia quien mira.
  {
    const cy0 = (g.top + g.bottom) / 2;
    const zMax = D * (1 - Math.max(0.1, Math.max(1, g.suelo - cy0) / Math.max(1, g.bottom - cy0)));
    const alf = mesh(new PlaneGeometry(g.w * 1.6, zMax + 40), lambert(P.alfombra));
    alf.rotation.x = -Math.PI / 2;
    alf.position.set(g.cx, 0.2, (zMax + 40) / 2 - 20);
    agregar(alf);
  }
  // Las matas, esparcidas por hash.
  {
    const geoMata = reg(new ConeGeometry(1, 1, 3, 1));
    geoMata.translate(0, 0.5, 0);
    const im = esparcirPorHash(motor, {
      geo: geoMata, material: lambert(P.matas), x0: g.cx - g.w * 0.75, x1: g.cx + g.w * 0.75, z0: -D * 0.9, z1: D * 0.5, cantidad: 150, semilla: 3,
      evitar: (x, z) => Math.abs(x - g.cx) < g.troncoAncho * 0.7 && Math.abs(z) < g.troncoAncho * 0.8,
      ubicar: (r, d, x, z) => {
        d.position.set(x, 0, z);
        d.scale.set((3 + 4 * r) * g.k, (10 + 14 * r) * g.k, (3 + 4 * r) * g.k);
        d.rotation.y = r * 6.28;
      },
    });
    mundo.add(im);
  }
  // Los cerros, en dos capas: bajos y lejos, por detrás del árbol.
  {
    const Hc = Math.max(1, g.suelo - (g.top + g.bottom) / 2);
    const cerros = (z: number, alto: number, color: number, fase: number): void => {
      const ancho = g.w * (1 + Math.abs(z) / D) * 1.3;
      const N = 28;
      const pos: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i <= N; i++) {
        const x = g.cx - ancho + (i / N) * 2 * ancho;
        const forma = (0.5 + 0.5 * Math.sin(i * 0.9 + fase)) * (0.65 + 0.35 * hashDe(i, fase * 10));
        const a = Hc * 0.93 + (alto - Hc * 0.93) * forma;
        // Sin pared hasta el piso: la cresta apenas baja de la altura de la vista, y debajo se ve el campo.
        pos.push(x, Hc * 0.93, z, x, a, z);
        if (i < N) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      geo.setIndex(idx);
      agregar(mesh(geo, basico(color, { side: DoubleSide })));
    };
    // La cresta queda un poco por encima del horizonte: la altura de la vista más un 6 y un 4 % del alto de la pantalla, a su distancia.
    cerros(-D * 1.5, Hc + 0.055 * h * 2.5, P.cerroLejos, 1);
    cerros(-D * 0.8, Hc + 0.06 * h * 1.8, P.cerroCerca, 3);
  }

  /* --------------------------------------------------------------------- el tronco */
  // El tronco de botella: la panza abajo, el cuello que sube y se cierra entre las ramas, y el pie que se agarra al suelo.
  // Queda un poco atrás del plano de las flores (`zT`), así ninguna flor del centro queda tapada por el cuello.
  const zT = -1.2 * DZ;
  const W3 = Math.min(g.troncoAncho * (g.retrato ? 1.2 : 0.9), g.w * (g.retrato ? 0.3 : 0.22));
  const medidas: MedidasTronco = { y0: g.suelo - g.troncoBase, y1: g.suelo - g.copa.base + 0.2 * g.copa.alto, ancho: W3 };
  const alturaTronco = medidas.y1 - medidas.y0;
  const troncoG = new Group();
  troncoG.position.set(g.cx, 0, zT);
  {
    const geoT = reg(geoTronco(medidas, P.piel, P.sombra));
    const tronco = new Mesh(geoT, lambert(BLANCO, { side: DoubleSide, vertexColors: true }));
    troncoG.add(tronco);
    // El contorno de tinta: la misma forma por dentro, un poco más ancha.
    const borde = new Mesh(geoT, basico(P.tinta, { side: BackSide }));
    borde.scale.set(1.06, 1.015, 1.06);
    borde.position.set(0, -0.5, 0);
    troncoG.add(borde);
    // Las espinas: conos de cuatro lados en hileras escalonadas por el frente y los costados, cada una mirando hacia afuera y un poco arriba.
    const cono4 = reg(new ConeGeometry(1, 1, 4, 1));
    cono4.translate(0, 0.5, 0);
    const espinas = new Instancias(cono4, lambert(P.espina), 96, motor.basura);
    const m = new Matrix4(), q = new Quaternion(), vS = new Vector3(), vP = new Vector3(), arriba = new Vector3(0, 1, 0), dir = new Vector3();
    let c = 0;
    const FILAS = 8;
    for (let fila = 0; fila < FILAS; fila++) {
      const y = medidas.y0 + alturaTronco * (0.1 + 0.5 * (fila / (FILAS - 1)));
      const rad = radioDelTronco(medidas, y);
      const cuantas = 7;
      for (let j = 0; j < cuantas; j++) {
        const ang = ((j + (fila % 2) * 0.5) / (cuantas - 1) - 0.5) * 3.0 + (hash(fila, j) - 0.5) * 0.18;
        if (Math.abs(ang) > 1.5) continue;
        const l = Math.max(2.4, rad * 0.075) * (0.85 + 0.3 * hash(j, fila + 5));
        dir.set(Math.sin(ang), 0.38, Math.cos(ang)).normalize();
        q.setFromUnitVectors(arriba, dir);
        vP.set(Math.sin(ang) * rad * 0.98, y + (hash(fila, j + 9) - 0.5) * 0.02 * alturaTronco, Math.cos(ang) * rad * 0.98);
        vS.set(l * 0.9, l * 2.3, l * 0.9);
        m.compose(vP, q, vS);
        espinas.ponerMatriz(c++, m);
      }
    }
    espinas.usar(c);
    espinas.fin();
    troncoG.add(espinas.malla);
    agregar(troncoG);
    // La sombra del tronco en el piso.
    const sombra = new SombrasDeContacto(motor, 1, 0.3);
    sombra.usar(1);
    sombra.poner(0, g.cx + W3 * 0.2, 0, W3 * 1.0, W3 * 0.44, 0.4);
    sombra.fin();
    mundo.add(sombra.malla);
  }

  /* ------------------------------------------------------------------ las ramas */
  // Ramas gruesas que nacen del cuello y se abren hacia arriba, con contorno de tinta, y de cada una las ramitas que sostienen las flores.
  const matRama = lambert(cRama, { side: DoubleSide });
  const nVert = RAMAS_MAX * (TRAMOS + 1) * LADOS;
  const rPos = new Float32Array(nVert * 3);
  const rPosB = new Float32Array(nVert * 3);
  const ramasGeo = new BufferGeometry();
  const ramasBordeGeo = new BufferGeometry();
  ramasGeo.setAttribute("position", new BufferAttribute(rPos, 3));
  ramasBordeGeo.setAttribute("position", new BufferAttribute(rPosB, 3));
  {
    const idx: number[] = [];
    for (let r = 0; r < RAMAS_MAX; r++) {
      for (let j = 0; j < TRAMOS; j++) {
        for (let l = 0; l < LADOS; l++) {
          const a = (r * (TRAMOS + 1) + j) * LADOS + l;
          const b = (r * (TRAMOS + 1) + j) * LADOS + ((l + 1) % LADOS);
          const a2 = a + LADOS, b2 = b + LADOS;
          idx.push(a, b, a2, b, b2, a2);
        }
      }
    }
    ramasGeo.setIndex(idx);
    ramasBordeGeo.setIndex(idx);
  }
  const ramasBorde = mesh(ramasBordeGeo, basico(P.tinta, { side: BackSide }));
  ramasBorde.frustumCulled = false;
  agregar(ramasBorde);
  const ramasMesh = mesh(ramasGeo, matRama);
  ramasMesh.frustumCulled = false;
  agregar(ramasMesh);
  // La línea del centro de cada rama (en el mundo), para que las ramitas nazcan de ella.
  const cl = new Float32Array(RAMAS_MAX * (TRAMOS + 1) * 3);
  const clViva = new Uint8Array(RAMAS_MAX);
  const clR = new Float32Array(RAMAS_MAX * (TRAMOS + 1));
  // Las ramitas: de la rama a cada flor, dos cintas cruzadas que se afinan hacia la flor.
  const tPos = new Float32Array(n * 8 * 3);
  const tGeo = new BufferGeometry();
  tGeo.setAttribute("position", new BufferAttribute(tPos, 3));
  {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const b = i * 8;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2, b + 4, b + 5, b + 6, b + 5, b + 7, b + 6);
    }
    tGeo.setIndex(idx);
  }
  const ramitas = mesh(tGeo, lambert(cRama, { side: DoubleSide }));
  ramitas.frustumCulled = false;
  agregar(ramitas);

  /* ----------------------------------------------------------------- las flores */
  // Una malla por flor: cinco pétalos con su lomo y la punta levantada (ver `geoFlor`). El contorno es la misma flor un poco más ancha y apenas atrás.
  const florGeo = reg(geoFlor());
  const centroGeo = reg(new SphereGeometry(1, 8, 4));
  const matPetalo = lambert(BLANCO, { vertexColors: true, side: DoubleSide });
  const petalos = new Instancias(florGeo, matPetalo, n, motor.basura);
  const matBorde = basico(BLANCO, { side: DoubleSide });
  const contornos = new Instancias(florGeo, matBorde, n <= CONTORNO_TODAS ? n : 12, motor.basura);
  const centros = new Instancias(centroGeo, lambert(CREMA), n, motor.basura);
  const estambres = new Instancias(centroGeo, lambert(ESTAMBRE), n, motor.basura);
  [contornos, petalos, centros, estambres].forEach((x) => agregar(x.malla));
  const oro = noche ? ORO_NOCHE : ORO;

  // Lo de cada pieza, en la flor de radio 1.
  const O = new Object3D();
  const locBorde = new Matrix4().compose(new Vector3(0, 0, -0.05), new Quaternion(), new Vector3(1.12, 1.12, 1));
  const locBordeOro = new Matrix4().compose(new Vector3(0, 0, -0.06), new Quaternion(), new Vector3(1.2, 1.2, 1));
  const locCentro = new Matrix4().compose(new Vector3(0, 0, 0.06), new Quaternion(), new Vector3(0.5, 0.5, 0.15));
  const locEstambre = new Matrix4().compose(new Vector3(0, 0, 0.2), new Quaternion(), new Vector3(0.3, 0.3, 0.1));

  // El color de cada flor, como en el 2D.
  const rosaDe = (i: number): number => mezcla(ROSAS[Math.floor(hashDe(i, 5) * 3)] as number, 0xffffff, P.rosaMezcla);
  const clave = new Int16Array(n).fill(-1);
  const colorTmp = new Color();
  const posF = new Float32Array(n * 3);
  const orient = new Float32Array(n * 3);
  const rad = new Float32Array(n);
  const visible = new Uint8Array(n);

  const mF = new Matrix4(), mP = new Matrix4();
  const vP = new Vector3(), vS = new Vector3(), qF = new Quaternion(), eF = new Euler();
  const cero = new Matrix4().makeScale(0, 0, 0);

  /* ------------------------------------------------------------------ el colibrí */
  const ave = new Group();
  ave.visible = false;
  const parte = (geo: BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0): Mesh => {
    const m = new Mesh(reg(geo), lambert(color));
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.z = rz;
    ave.add(m);
    return m;
  };
  const esf = (a: number, b: number): SphereGeometry => new SphereGeometry(1, a, b);
  parte(esf(8, 6), 0x1fa67a, 0, 0, 0, 0.95, 0.46, 0.5);
  parte(esf(7, 4), 0xcfeccb, 0.12, -0.17, 0.05, 0.62, 0.24, 0.42);
  parte(esf(7, 5), 0x2ec4a0, 0.98, 0.12, 0, 0.38, 0.38, 0.38);
  parte(esf(6, 4), 0xe0364f, 1.04, -0.1, 0.1, 0.17, 0.17, 0.2);
  parte(esf(5, 4), 0x16161f, 1.1, 0.2, 0.3, 0.07, 0.07, 0.07);
  {
    // El pico: un cono largo que apunta hacia adelante.
    const pico = new ConeGeometry(1, 1, 4, 1);
    pico.rotateZ(-Math.PI / 2);
    pico.translate(0.5, 0, 0);
    parte(pico, 0x16161f, 1.28, 0.06, 0, 1.22, 0.15, 0.15);
    // La cola: tres puntas hacia atrás.
    const cola = new ConeGeometry(1, 1, 3, 1);
    cola.rotateZ(Math.PI / 2);
    cola.translate(-0.5, 0, 0);
    parte(cola, 0x127a5a, -0.7, 0, 0, 1.15, 0.38, 0.5);
  }
  // Las alas: un abanico translúcido a cada lado (no un aleteo cuadro a cuadro, que sería un destello).
  const alas: Mesh[] = [];
  {
    const geoAla = reg(new PlaneGeometry(1.7, 0.5));
    geoAla.translate(0.85, 0, 0);
    const matAla = reg(new MeshBasicMaterial({ color: 0xdff7ff, transparent: true, opacity: 0.38, side: DoubleSide, depthWrite: false }));
    for (const lado of [1, -1]) {
      for (const abre of [-0.38, 0, 0.38]) {
        const ala = new Mesh(geoAla, matAla);
        ala.position.set(0.1, 0.2, 0.12 * lado);
        ala.userData.base = Math.PI - 0.9 + abre;
        ala.rotation.z = ala.userData.base as number;
        ala.rotation.y = lado * 0.22;
        ave.add(ala);
        alas.push(ala);
      }
    }
  }
  agregar(ave);

  /* ---------------------------------------------------- el viento y los pétalos que sube */
  const rayasGeo = new BufferGeometry();
  const yPos = new Float32Array(RAYAS * (TRAMOS_RAYA + 1) * 2 * 3);
  rayasGeo.setAttribute("position", new BufferAttribute(yPos, 3));
  {
    const idx: number[] = [];
    for (let r = 0; r < RAYAS; r++) {
      for (let j = 0; j < TRAMOS_RAYA; j++) {
        const a = (r * (TRAMOS_RAYA + 1) + j) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    rayasGeo.setIndex(idx);
  }
  const matRaya = reg(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: DoubleSide, depthWrite: false, fog: false }));
  const rayas = new Mesh(reg(rayasGeo), matRaya);
  rayas.frustumCulled = false;
  rayas.renderOrder = 3;
  agregar(rayas);
  const petaloMenor = new Instancias(reg(new SphereGeometry(1, 6, 3)), basico(0xff97c6, { fog: false }), AIRE + REMOLINO_MAX, motor.basura);
  petaloMenor.malla.renderOrder = 3;
  agregar(petaloMenor.malla);

  /* --------------------------------------------------------------- cada cuadro */
  const mundoAD = (x: number, y: number, dz: number): { X: number; Y: number; Z: number; k: number } => aMundo(g, D, x, y, dz);
  const vA = new Vector3(), vB = new Vector3(), vT = new Vector3(), vN1 = new Vector3(), vN2 = new Vector3(), vC = new Vector3();

  const actualizar = (e: EntradaToborochi, s: number): void => {
    mundo.scale.setScalar(s);
    const { tau, t } = e;
    // Desde «quedan dos» las que siguen en el árbol se alinean con el plano del árbol: la profundidad de cada una sale de su lugar.
    const plano = 1 - suave((t - e.tQuedan0) / 1.2);

    /* ------------------------------------------------------------- las flores */
    let nh = 0;
    petalos.usar(n);
    centros.usar(n);
    estambres.usar(e.conCara ? 0 : n);
    for (let i = 0; i < n; i++) {
      const f = e.flores[i];
      if (!f || f.escala < 0.015) {
        visible[i] = 0;
        petalos.ponerMatriz(i, cero);
        centros.ponerMatriz(i, cero);
        estambres.ponerMatriz(i, cero);
        continue;
      }
      visible[i] = 1;
      const dz = profundidadDe(f.u, f.v, h) * (f.cae > 0 ? 1 : plano);
      const M = mundoAD(f.x, f.y, dz);
      const rW = g.r * f.escala * M.k;
      let yaw = 0, pitch = 0, roll = 0;
      if (f.suelo) {
        yaw = (hash(i, 9) - 0.5) * 2.4;
        pitch = -1.1;
      } else if (f.cae > 0) {
        yaw = f.rot * 1.9;
        roll = f.rot * 0.5;
        pitch = -1.1 * suave((f.cae - 0.55) / 0.45);
      } else {
        yaw = f.rot * 1.4;
        roll = f.rot * 0.6;
      }
      // Nunca se hunde en el piso: tendida, se apoya en su pétalo más bajo.
      const Y = Math.max(M.Y, rW * (1.06 * Math.cos(pitch) + 0.04));
      posF[i * 3] = M.X;
      posF[i * 3 + 1] = Y;
      posF[i * 3 + 2] = M.Z;
      orient[i * 3] = pitch;
      orient[i * 3 + 1] = yaw;
      orient[i * 3 + 2] = roll;
      rad[i] = rW;
      qF.setFromEuler(eF.set(pitch, yaw, roll, "YXZ"));
      mF.compose(vP.set(M.X, Y, M.Z), qF, vS.setScalar(rW));
      const brilla = f.brillo > 0.02;
      const k10 = Math.round(f.brillo * 10);
      if (clave[i] !== k10) {
        clave[i] = k10;
        const cuerpo = mezcla(rosaDe(i), 0xfff1b8, 0.4 * c01(f.brillo));
        // Los vértices de la flor van de 0,7 a 1: el color de la instancia se levanta un poco para que la punta quede en el rosa de la casa.
        petalos.malla.setColorAt(i, colorTmp.setHex(cuerpo).multiplyScalar(1.12));
        if (petalos.malla.instanceColor) petalos.malla.instanceColor.needsUpdate = true;
        centros.malla.setColorAt(i, colorTmp.setHex(CREMA));
        if (centros.malla.instanceColor) centros.malla.instanceColor.needsUpdate = true;
        estambres.malla.setColorAt(i, colorTmp.setHex(ESTAMBRE));
        if (estambres.malla.instanceColor) estambres.malla.instanceColor.needsUpdate = true;
      }
      petalos.ponerMatriz(i, mF);
      mP.multiplyMatrices(mF, locCentro);
      centros.ponerMatriz(i, mP);
      if (!e.conCara) {
        mP.multiplyMatrices(mF, locEstambre);
        estambres.ponerMatriz(i, mP);
      }
      if (n <= CONTORNO_TODAS) {
        mP.multiplyMatrices(mF, brilla ? locBordeOro : locBorde);
        contornos.ponerMatriz(i, mP, brilla ? oro : ROSA_BORDE);
        nh = n;
      } else if (brilla && nh < contornos.max) {
        mP.multiplyMatrices(mF, locBordeOro);
        contornos.ponerMatriz(nh, mP, oro);
        nh++;
      }
    }
    if (n <= CONTORNO_TODAS) {
      for (let i = 0; i < n; i++) if (!visible[i]) contornos.ponerMatriz(i, cero);
    }
    contornos.usar(nh);
    petalos.fin();
    contornos.fin();
    centros.fin();
    estambres.fin();

    /* --------------------------------------------------------------- las ramas */
    {
      const r0 = W3 * 0.15;
      const x0 = g.cx, y0 = g.copa.base;
      rPos.fill(0);
      rPosB.fill(0);
      clViva.fill(0);
      for (let r = 0; r < Math.min(RAMAS_MAX, e.ramas.length); r++) {
        const ra = e.ramas[r] as { x1: number; y1: number; alfa: number };
        if (ra.alfa <= 0.01) continue;
        clViva[r] = 1;
        const dx = ra.x1 - x0, dy = ra.y1 - y0;
        const zr = (hash(r, 77) - 0.5) * 0.5 * DZ * c01(plano);
        // La línea del centro: mitad recta, mitad la curva del 2D (sube y después se abre).
        for (let j = 0; j <= TRAMOS; j++) {
          const sj = j / TRAMOS;
          const cx2 = x0 + dx * 0.15, cy2 = lerp(y0, ra.y1, 0.55);
          const qx = (1 - sj) * (1 - sj) * x0 + 2 * sj * (1 - sj) * cx2 + sj * sj * ra.x1;
          const qy = (1 - sj) * (1 - sj) * y0 + 2 * sj * (1 - sj) * cy2 + sj * sj * ra.y1;
          const px = lerp(x0 + dx * sj, qx, 0.55), py = lerp(y0 + dy * sj, qy, 0.55);
          const M = mundoAD(px, py, 0);
          const k = (r * (TRAMOS + 1) + j) * 3;
          cl[k] = M.X;
          cl[k + 1] = M.Y;
          cl[k + 2] = lerp(zT, cZ(px) * c01(plano), suave(sj / 0.5)) + zr * sj;
          clR[r * (TRAMOS + 1) + j] = r0 * (1 - 0.8 * sj) * ra.alfa;
        }
        for (let j = 0; j <= TRAMOS; j++) {
          const j0 = Math.max(0, j - 1), j1 = Math.min(TRAMOS, j + 1);
          const k0 = (r * (TRAMOS + 1) + j0) * 3, k1 = (r * (TRAMOS + 1) + j1) * 3, kc = (r * (TRAMOS + 1) + j) * 3;
          vT.set((cl[k1] as number) - (cl[k0] as number), (cl[k1 + 1] as number) - (cl[k0 + 1] as number), 0);
          if (vT.lengthSq() < 1e-6) vT.set(0, 1, 0);
          vT.normalize();
          vN1.set(-vT.y, vT.x, 0);
          vN2.set(0, 0, 1);
          const radio = clR[r * (TRAMOS + 1) + j] as number;
          const radioB = radio * 1.1 + (radio > 0.01 ? 0.7 * g.k : 0);
          for (let l = 0; l < LADOS; l++) {
            const a = (l / LADOS) * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            const k = ((r * (TRAMOS + 1) + j) * LADOS + l) * 3;
            rPos[k] = (cl[kc] as number) + (vN1.x * ca + vN2.x * sa) * radio;
            rPos[k + 1] = (cl[kc + 1] as number) + (vN1.y * ca + vN2.y * sa) * radio;
            rPos[k + 2] = (cl[kc + 2] as number) + (vN1.z * ca + vN2.z * sa) * radio;
            rPosB[k] = (cl[kc] as number) + (vN1.x * ca + vN2.x * sa) * radioB;
            rPosB[k + 1] = (cl[kc + 1] as number) + (vN1.y * ca + vN2.y * sa) * radioB;
            rPosB[k + 2] = (cl[kc + 2] as number) + (vN1.z * ca + vN2.z * sa) * radioB;
          }
        }
      }
      ramasGeo.attributes.position!.needsUpdate = true;
      ramasBordeGeo.attributes.position!.needsUpdate = true;
      // Las ramitas: nacen del punto de la rama más cercano al lugar que el 2D les dio y llegan a la flor.
      tPos.fill(0);
      const wB = Math.max(1.6, r0 * 0.3);
      for (let i = 0; i < n; i++) {
        const f = e.flores[i];
        if (!f || !visible[i] || f.cae > 0 || Number.isNaN(f.rx)) continue;
        const ax = f.rx, ay = g.suelo - f.ry;
        let mejor = Infinity;
        for (let r = 0; r < RAMAS_MAX; r++) {
          if (!clViva[r]) continue;
          for (let j = 0; j < TRAMOS; j++) {
            const k0 = (r * (TRAMOS + 1) + j) * 3, k1 = k0 + 3;
            const sx = (cl[k1] as number) - (cl[k0] as number), sy = (cl[k1 + 1] as number) - (cl[k0 + 1] as number);
            const l2 = sx * sx + sy * sy;
            const u = l2 > 1e-6 ? c01(((ax - (cl[k0] as number)) * sx + (ay - (cl[k0 + 1] as number)) * sy) / l2) : 0;
            const qx = (cl[k0] as number) + sx * u, qy = (cl[k0 + 1] as number) + sy * u;
            const d = (qx - ax) * (qx - ax) + (qy - ay) * (qy - ay);
            if (d < mejor) {
              mejor = d;
              vA.set(qx, qy, lerp(cl[k0 + 2] as number, cl[k1 + 2] as number, u));
            }
          }
        }
        if (mejor === Infinity) continue;
        vB.set(posF[i * 3] as number, posF[i * 3 + 1] as number, posF[i * 3 + 2] as number);
        vT.subVectors(vB, vA);
        if (vT.lengthSq() < 1e-6) continue;
        vT.normalize();
        const wT = wB * 0.55;
        const b = i * 8 * 3;
        const poner = (k: number, p: Vector3, dx: number, dy: number, dz: number): void => {
          tPos[b + k * 3] = p.x + dx;
          tPos[b + k * 3 + 1] = p.y + dy;
          tPos[b + k * 3 + 2] = p.z + dz;
        };
        const nx = -vT.y, ny = vT.x;
        poner(0, vA, -nx * wB, -ny * wB, 0); poner(1, vA, nx * wB, ny * wB, 0); poner(2, vB, -nx * wT, -ny * wT, 0); poner(3, vB, nx * wT, ny * wT, 0);
        poner(4, vA, 0, 0, -wB); poner(5, vA, 0, 0, wB); poner(6, vB, 0, 0, -wT); poner(7, vB, 0, 0, wT);
      }
      tGeo.attributes.position!.needsUpdate = true;
    }

    /* ----------------------------------------------------------------- el colibrí */
    const cb = e.colibri;
    ave.visible = cb.visible;
    if (cb.visible) {
      const M = mundoAD(cb.x, cb.y, 0);
      ave.position.set(M.X, M.Y, cb.prof * g.r);
      ave.scale.setScalar(cb.escala);
      ave.rotation.y = cb.mira > 0 ? 0 : Math.PI;
      // El cuerpo cabecea un poco; las alas, un temblor chico, nunca un aleteo cuadro a cuadro.
      ave.rotation.z = Math.sin(t * 5) * 0.04 * cb.aleteo;
      for (const ala of alas) ala.rotation.z = (ala.userData.base as number) + Math.sin(t * 30 + (ala.position.z > 0 ? 0 : 1.7)) * 0.07 * cb.aleteo;
    }

    /* ------------------------------------------------- el viento y el remolino */
    {
      const w = e.viento;
      matRaya.opacity = 0.4 * w;
      rayas.visible = w > 0.04 && e.frente > -1;
      yPos.fill(0);
      if (rayas.visible) {
        const fr = e.frente;
        const j = e.olaJ;
        for (let m = 0; m < RAYAS; m++) {
          const y = g.top + (g.suelo - g.top) * (0.05 + 0.85 * hash(m, 31 + j));
          const ini = hash(m, 32 + j) * 0.6;
          const u = c01((fr + 0.2 - ini) / 0.9);
          if (u <= 0 || u >= 1) continue;
          const x0 = lerp(-g.w * 0.1, g.w * 1.1, u);
          const largo = g.w * (0.1 + 0.12 * hash(m, 33));
          const pA = { x: x0 - largo, y: y + Math.sin(u * 6 + m) * 6 * g.k };
          const pC = { x: x0 - largo / 2, y: y - 10 * g.k };
          const pB = { x: x0, y: y + Math.sin(u * 6 + m + 1) * 6 * g.k };
          const zr = 3 * DZ + hash(m, 34) * DZ;
          const ancho = Math.max(1.5, 2 * g.k) * 1.2;
          for (let q = 0; q <= TRAMOS_RAYA; q++) {
            const sq = q / TRAMOS_RAYA;
            const x = (1 - sq) * (1 - sq) * pA.x + 2 * sq * (1 - sq) * pC.x + sq * sq * pB.x;
            const yy = (1 - sq) * (1 - sq) * pA.y + 2 * sq * (1 - sq) * pC.y + sq * sq * pB.y;
            const k = ((m * (TRAMOS_RAYA + 1) + q) * 2) * 3;
            yPos[k] = x;
            yPos[k + 1] = g.suelo - yy + ancho;
            yPos[k + 2] = zr;
            yPos[k + 3] = x;
            yPos[k + 4] = g.suelo - yy - ancho;
            yPos[k + 5] = zr;
          }
        }
      }
      rayasGeo.attributes.position!.needsUpdate = true;
      // Los pétalos que se lleva el viento y los que suben con el golpe.
      let np = 0;
      if (rayas.visible) {
        const fr = e.frente;
        for (let m = 0; m < AIRE; m++) {
          const u = c01((fr + 0.15 - hash(m, 41) * 0.5) / 0.9);
          if (u <= 0 || u >= 1) continue;
          const x = lerp(g.w * 0.25, g.w * 1.05, u);
          const y = g.copa.base - g.copa.alto * (0.2 + 0.7 * hash(m, 42)) + u * g.copa.alto * 0.3 + Math.sin(u * 9 + m) * 10 * g.k;
          petalo(np++, x, g.suelo - y, 2 * DZ * hash(m, 43), 4 * g.k, 2.6 * g.k, u * 8 + m, 0xff97c6);
        }
      }
      if (tau >= 0 && tau < 3.2 && e.ganador >= 0) {
        const q = e.flores[e.ganador];
        if (q) {
          let m = 0;
          for (let i = 0; i < n && m < REMOLINO_MAX; i++) {
            const f = e.flores[i];
            if (!f || !f.suelo) continue;
            const u = suave((tau - 0.1 - 0.5 * hashDe(i, 51)) / 2.2);
            const idx = m++;
            if (u <= 0 || u >= 1) continue;
            const an = hashDe(i, 52) * 6.28 + u * (5 + 3 * hashDe(i, 53));
            const rd = (1 - u) * g.w * 0.12 * hashDe(i, 54) + g.r * 1.2 * u;
            const x = lerp(f.x, q.x, u) + Math.cos(an) * rd;
            const y = lerp(f.y, q.y, u) - Math.sin(u * Math.PI) * g.copa.alto * 0.25 + Math.sin(an) * rd * 0.5;
            if (Math.hypot(x - q.x, y - q.y) < g.r * 1.5) continue;
            const Mf = mundoAD(f.x, f.y, 0);
            const Z = lerp(Mf.Z, 0, u) + Math.sin(an) * rd * 0.6;
            if (np >= AIRE + REMOLINO_MAX) break;
            petalo(np++, x, Math.max(2, g.suelo - y), Z, Math.max(2, g.r * 0.22), Math.max(1.4, g.r * 0.15), an * 2, idx % 3 ? 0xff97c6 : 0xffd36a);
          }
        }
      }
      petaloMenor.usar(np);
      petaloMenor.fin();
    }
  };

  // Un pétalo suelto (el que se lleva el viento, el que sube en el remolino): chato, a (x, altura, z).
  const petalo = (i: number, x: number, y: number, z: number, rx: number, ry: number, giro: number, color: number): void => {
    const d = O;
    d.position.set(x, y, z);
    d.rotation.set(giro * 0.4, giro, giro * 0.7);
    d.scale.set(rx, ry, Math.min(rx, ry) * 0.5);
    d.updateMatrix();
    petaloMenor.ponerMatriz(i, d.matrix, color);
  };

  /* ----------------------------------------------------------- lo que ve la pantalla */
  const pa = new Vector3(), ex = new Vector3(), ey = new Vector3(), en = new Vector3();
  const pantallaDe = (id: number): PantallaFlor | null => {
    if (id < 0 || id >= n || !visible[id]) return null;
    const s = mundo.scale.x;
    const r = (rad[id] as number) * s;
    const cx = (posF[id * 3] as number) * s, cy = (posF[id * 3 + 1] as number) * s, cz = (posF[id * 3 + 2] as number) * s;
    const alto = motor.pantalla([cx, cy + 1.05 * r, cz], [cx, cy - 1.05 * r, cz]);
    if (!alto) return null;
    qF.setFromEuler(eF.set(orient[id * 3] as number, orient[id * 3 + 1] as number, orient[id * 3 + 2] as number, "YXZ"));
    ex.set(1, 0, 0).applyQuaternion(qF);
    ey.set(0, 1, 0).applyQuaternion(qF);
    en.set(0, 0, 1).applyQuaternion(qF);
    const cam = motor.camara.position;
    pa.set(cam.x - cx, cam.y - cy, cam.z - cz).normalize();
    const mira = en.dot(pa);
    // La cara, en el disco del centro (un poco hacia quien mira), a medio radio de lado.
    const cf = vC.set(cx, cy, cz).addScaledVector(en, 0.2 * r);
    const media = 0.49 * r;
    const P0 = motor.proyectar(cf.x, cf.y, cf.z);
    const Px1 = motor.proyectar(cf.x + ex.x * media, cf.y + ex.y * media, cf.z + ex.z * media);
    const Px0 = motor.proyectar(cf.x - ex.x * media, cf.y - ex.y * media, cf.z - ex.z * media);
    const Py1 = motor.proyectar(cf.x - ey.x * media, cf.y - ey.y * media, cf.z - ey.z * media);
    const Py0 = motor.proyectar(cf.x + ey.x * media, cf.y + ey.y * media, cf.z + ey.z * media);
    if (!P0 || !Px1 || !Px0 || !Py1 || !Py0) return { ...alto, mira, m: { a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 } };
    return { ...alto, mira, m: { a: Px1.x - Px0.x, b: Px1.y - Px0.y, c: Py1.x - Py0.x, d: Py1.y - Py0.y, tx: P0.x, ty: P0.y } };
  };

  // Los programas de la placa se compilan ahora, con todo prendido (el colibrí y el viento recién salen a mitad del show y compilarlos ahí se ve como un tirón).
  {
    const viaAve = ave.visible, viaRayas = rayas.visible;
    ave.visible = true;
    rayas.visible = true;
    try {
      motor.renderer.compile(motor.escena, motor.camara);
    } catch {
      // Si no puede, compila al dibujar el primer cuadro.
    }
    ave.visible = viaAve;
    rayas.visible = viaRayas;
  }

  return {
    w: e0.w,
    h: e0.h,
    n,
    actualizar,
    pantallaDe,
    soltar() {
      motor.escena.remove(mundo);
      for (const d of desechos) d.dispose();
      desechos.length = 0;
    },
  };
}

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: el Toborochi con el 3D debajo. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/toborochi");
  return m.toborochiPixi3D(montaje);
};
