import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  ExtrudeGeometry, Float32BufferAttribute, Group, HemisphereLight, InstancedMesh, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D,
  Shape, SphereGeometry, SRGBColorSpace, TorusGeometry, type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { perfil, type Pose3D } from "./camara";
import { crearAmbiente, esparcirPorHash, Rafagas, type Ambiente } from "./escena";
import { hash } from "./ids";
import { definir3D } from "./motor";
import type { EntradaBase, Fabrica3D, Lanzador } from "./tipos";
import { T_BRAKE, T_CREEP, T_CROWN, T_HOLD, T_LOCK, T_WIND } from "../pixi/wheel-beats";

/**
 * La ruleta en 3D (`?motor=3d`). Dibuja lo que `pixi/wheel.ts` ya decidió: el ángulo de la rueda, cómo se dobla la
 * paleta, cuántos foquitos hay prendidos, qué gajos ganaron. No calcula nada del juego (src/games/tres/README.md).
 *
 * Una rueda de feria de madera, parada, de frente, en una kermés. Todo lo que se arma está medido en radios de la
 * rueda (la rueda mide 1 y vive en el origen del mundo 2D, igual que en `wheel.ts`): un grupo lo lleva a la escala de la
 * pantalla (`mapa.s * R`) y no hay nada que rearmar cuando cambia el tamaño. Lo único que depende del 2D de verdad es la
 * textura del disco (los colores y los nombres de los gajos) y el ángulo.
 *
 * La cámara es la del director del 2D (el mismo punto, el mismo acercamiento, el mismo sacudón) más dos cosas que son
 * solo de la hora del juego y nunca de quién gana: entra girada diez grados y los deshace en 1,2 s, y sube hasta doce
 * grados sobre la flecha mientras la rueda frena, para ver los pernos pasar contra la paleta. En el golpe vuelve a mirar
 * de frente.
 */

/* ===================================================================== lo que el 2D le pasa */

/** Un gajo: el color que le toca y el nombre escrito (vacío si no lleva, con más de veinticuatro personas). */
export interface GajoEntrada {
  color: number;
  nombre: string;
}

export interface EntradaRueda extends EntradaBase {
  /** El radio de la rueda en píxeles del mundo 2D. */
  R: number;
  /** Cambia cada vez que el 2D rearma los gajos (otro tamaño de pantalla): la textura del disco se vuelve a pintar. */
  version: number;
  gajos: readonly GajoEntrada[];
  /** El tamaño de la letra de los gajos, en píxeles del mundo 2D. */
  letra: number;
  /** `wheel.rotation`: el ángulo de la rueda en radianes (positivo gira a la derecha en la pantalla). */
  angulo: number;
  /** Gajos por segundo. */
  velocidad: number;
  /** El ángulo de la paleta (`flapA`) y cuánto crece en la traba (`1 + (flash + bump) * 2.5`). */
  paleta: number;
  golpePaleta: number;
  /** El giro del cubo (`hub.rotation`). */
  cubo: number;
  /** Cuántos foquitos hay (de 0 a 64) y cuáles brillan: 0 ninguno; 1 y 2, los pares o los impares. */
  foquitos: number;
  encendidos: 0 | 1 | 2;
  /** Los gajos que ganaron, solo desde el golpe: antes de eso, `null` (el 3D no sabe quién gana). */
  ganan: readonly number[] | null;
}

/* ===================================================================== las cuentas (puras, se prueban en Node) */

const GRAD = Math.PI / 180;
/** El radio de los gajos, en radios de la rueda (el aro empieza en 0,88). */
export const RADIO_GAJOS = 0.86;
/** El campo de visión de la lente larga. */
export const FOV_RUEDA = 36 * GRAD;

const liso = (p: number): number => {
  const q = Math.max(0, Math.min(1, p));
  return q * q * (3 - 2 * q);
};

/**
 * Cómo está girada y alzada la cámara en la hora `t`. Solo depende de la hora: nunca de quién gana, así hasta el golpe
 * la cámara es la misma con cualquier ganador.
 *
 * - `az`: entra girada diez grados hacia la izquierda y los deshace en 1,2 s (se ve el canto de la rueda).
 * - `el`: seis grados de altura (el horizonte cae en el tercio de arriba); mientras frena sube hasta doce, y en el golpe
 *   vuelve a mirar de frente.
 */
export function anguloCamara(t: number): { az: number; el: number } {
  const az = -10 * GRAD * (1 - liso(t / T_WIND));
  const tension = liso((t - T_BRAKE) / (T_HOLD - T_BRAKE));
  const suba = (6 + 6 * tension) * GRAD;
  const baja = liso((t - T_CROWN) / 0.6);
  const el = suba + (4 * GRAD - suba) * baja;
  return { az, el };
}

/** Del mundo 2D (píxeles, y hacia abajo) al 3D de la rueda (unidades, y hacia arriba, sobre el plano de la rueda). */
export const aMundoRueda = (x: number, y: number, s: number): [number, number, number] => [x * s, -y * s, 0];

/**
 * La cámara 3D a partir de la del director del 2D: mira el mismo punto de la rueda (el sacudón se copia como un
 * corrimiento, no como un temblor aparte) y está a la distancia en que el alto que se ve en el plano de la rueda es el
 * mismo que veía el 2D con ese acercamiento. Con `az` y `el` en cero, un punto del 2D cae en el 3D en el mismo píxel.
 */
export function poseRueda(e: EntradaBase, s: number, az: number, el: number): Pose3D {
  const zoom = Math.max(0.05, e.cam.zoom || 1);
  const cx = e.cam.x - (e.cam.sacudonX || 0) / zoom;
  const cy = e.cam.y - (e.cam.sacudonY || 0) / zoom;
  const mira = aMundoRueda(cx, cy, s);
  const dist = ((e.h / zoom) * s) / (2 * Math.tan(FOV_RUEDA / 2));
  const ce = Math.cos(el);
  // La inclinación del director, con tope de dos grados: la rueda no se tuerce.
  const giro = Math.max(-2 * GRAD, Math.min(2 * GRAD, e.cam.rot || 0));
  return {
    pos: [mira[0] + dist * Math.sin(az) * ce, mira[1] + dist * Math.sin(el), mira[2] + dist * Math.cos(az) * ce],
    mira,
    fov: FOV_RUEDA,
    giro,
  };
}

/** Cuánto gira el disco en el 3D: el 2D gira a la derecha de la pantalla (y hacia abajo), el 3D hacia arriba. */
export const rotacionDisco = (angulo: number): number => -angulo;

/**
 * Qué gajo está bajo la flecha, mirando la rotación del disco en el 3D. La flecha está arriba (a 90 grados del eje x en
 * el 3D); el gajo `j` abarca, sin girar, de `90 - (j + 1) * A` a `90 - j * A` grados. Tiene que dar lo mismo que
 * `segUnder` de `pixi/wheel.ts`.
 */
export function gajoBajoLaFlecha3D(rotZ: number, segs: number): number {
  const A = (Math.PI * 2) / segs;
  const local = Math.PI / 2 - rotZ;
  const k = Math.floor((Math.PI / 2 - local) / A);
  return ((k % segs) + segs) % segs;
}

/** La luz del mundo: baja al 35 % en 0,25 s cuando se corona y vuelve al 60 % mientras se sostiene el cartel. */
export function luzDelMundo(t: number): number {
  if (t < T_CROWN) return 1;
  const d = t - T_CROWN;
  if (d < 0.25) return 1 - 0.65 * (d / 0.25);
  return 0.35 + 0.25 * liso((d - 0.25) / 1.1);
}

/** Cuánto sale la escena de golpe de la corona, de 0 a 1 (los gajos se adelantan y los demás se apagan). */
export const corona = (t: number): number => Math.max(0, Math.min(1, (t - T_CROWN) * 2));

/* ===================================================================== lo que se dibuja */

const TAU = Math.PI * 2;
const INK = 0x191919;
const CREAM = 0xf6efe2;
const YELLOW = 0xffc629;
const FUENTE = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const css = (c: number): string => `#${c.toString(16).padStart(6, "0")}`;
/** Un punto del disco: el ángulo del 2D (a la derecha, y hacia abajo, desde el eje x) a coordenadas 3D (y hacia arriba). */
const en3D = (a: number, r: number): [number, number] => [Math.cos(a) * r, -Math.sin(a) * r];

const mezcla = (a: number, b: number, k: number): number => new Color(a).lerp(new Color(b), k).getHex();

const fabrica: Fabrica3D<EntradaRueda> = (motor, o) => {
  const B = motor.basura;
  const oscuro = o.tema === "oscuro";
  const amb: Ambiente = crearAmbiente(motor, oscuro ? { solDesde: [-80, 32, 60] } : { solDesde: [-50, 88, 46] });
  const hemi = motor.escena.children.find((c): c is HemisphereLight => (c as HemisphereLight).isHemisphereLight === true);
  const hemiBase = hemi?.intensity ?? 1;
  const solBase = amb.sol.intensity;
  const horizonte = new Color(amb.paleta.horizonte);
  const cieloMat = amb.cielo.material as MeshBasicMaterial;

  const lambert = (color: number, extra: { side?: typeof DoubleSide } = {}): MeshLambertMaterial =>
    B.add(new MeshLambertMaterial({ color, flatShading: true, ...extra }));
  const basico = (color: number, extra: Partial<ConstructorParameters<typeof MeshBasicMaterial>[0]> = {}): MeshBasicMaterial =>
    B.add(new MeshBasicMaterial({ color, ...extra }));

  const mundo = new Group();
  motor.escena.add(mundo);
  /** La rueda y lo que la sostiene se inclinan un poco hacia la cámara cuando sube, para que la cara no se achate. */
  const inclina = new Group();
  mundo.add(inclina);
  /** Lo único que gira. */
  const rueda = new Group();
  inclina.add(rueda);

  /* ------------------------------------------------------------ el suelo, el fondo y la kermés */
  const maderaOscura = oscuro ? 0x5b4330 : 0x8a6238;
  const suelo = oscuro ? 0x3a2f3e : 0xd9c9a8;
  const pisoGeo = B.add(new CircleGeometry(120, 24));
  pisoGeo.rotateX(-Math.PI / 2);
  const piso = new Mesh(pisoGeo, lambert(suelo));
  piso.position.y = -1.5;
  mundo.add(piso);
  const piedras = esparcirPorHash(motor, {
    geo: B.add(new SphereGeometry(1, 5, 4)),
    material: lambert(oscuro ? 0x55485a : 0xb8a37c),
    x0: -22, x1: 22, z0: -12, z1: 6, cantidad: 90, semilla: 4,
    evitar: (x, z) => Math.abs(x) < 1.6 && z > -1.2,
    ubicar: (r, d, x, z) => { d.position.set(x, -1.5, z); d.scale.set(0.05 + r * 0.1, 0.03 + r * 0.05, 0.05 + r * 0.1); d.rotation.set(0, r * 9, 0); },
  });
  motor.escena.remove(piedras);
  mundo.add(piedras);

  // El fondo entero (tablas, postes, banderines, la carpa) en una sola malla con el color en los vértices.
  const trozos: BufferGeometry[] = [];
  const pintar = (g: BufferGeometry, c: number): BufferGeometry => {
    const ni = g.index ? g.toNonIndexed() : g;
    ni.deleteAttribute("uv");
    if (!ni.getAttribute("normal")) ni.computeVertexNormals();
    const n = ni.getAttribute("position").count;
    const col = new Color(c);
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    ni.setAttribute("color", new BufferAttribute(a, 3));
    return ni;
  };
  const caja = (w: number, h: number, d: number, x: number, y: number, z: number, c: number, rx = 0, rz = 0): void => {
    const g = new BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    trozos.push(pintar(g, c));
    g.dispose();
  };
  const apagado = (c: number): number => mezcla(c, oscuro ? 0x2d2a52 : 0xd8cfc0, 0.55);
  const ACENTOS = oscuro ? [0xff5cb3, 0xff8b3d, 0x17c3b2, 0xffd24d, 0x9b7bff] : [0xe93d9c, 0xff7a1a, 0x00a896, 0xffc629, 0x6c4ce0];
  const rayaA = oscuro ? 0x5c4a78 : 0xe8dcc4;
  const rayaB = oscuro ? 0x8a7aa4 : 0xa08fba;

  // La carpa de rayas, al fondo, a un costado: paredes y techo, con la raya según el ángulo.
  const carpa = (cx: number, cz: number, r: number): void => {
    const lados = 12;
    const paredes = new CylinderGeometry(r, r, 1.5, lados, 1, true);
    paredes.translate(cx, -0.75, cz);
    const techo = new ConeGeometry(r * 1.1, 1.7, lados, 1, true);
    techo.translate(cx, 0.85, cz);
    for (const g of [paredes, techo]) {
      const ni = g.toNonIndexed();
      ni.deleteAttribute("uv");
      const p = ni.getAttribute("position");
      const col = new Float32Array(p.count * 3);
      const c = new Color();
      for (let i = 0; i < p.count; i += 3) {
        const mx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 - cx;
        const mz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 - cz;
        const rayas = Math.floor(((Math.atan2(mz, mx) + Math.PI) / TAU) * lados);
        c.setHex(rayas % 2 ? rayaA : rayaB);
        for (let k = 0; k < 3; k++) { col[(i + k) * 3] = c.r; col[(i + k) * 3 + 1] = c.g; col[(i + k) * 3 + 2] = c.b; }
      }
      ni.setAttribute("color", new BufferAttribute(col, 3));
      trozos.push(ni);
    }
    caja(0.07, 0.9, 0.07, cx, 1.9, cz, maderaOscura);
    // La bandera de la punta.
    const bandera = new BufferGeometry();
    bandera.setAttribute("position", new Float32BufferAttribute([cx, 2.35, cz, cx + 0.5, 2.22, cz, cx, 2.1, cz], 3));
    trozos.push(pintar(bandera, apagado(ACENTOS[0] as number)));
  };
  carpa(4.6, -13, 3.1);

  // Los puestos: mostrador de madera, dos palos y un toldo de tablas de dos colores.
  const puesto = (x: number, z: number, ancho: number, c1: number, c2: number): void => {
    caja(ancho, 1.1, 1.0, x, -0.95, z, apagado(0xa7835a));
    caja(ancho + 0.2, 0.08, 1.3, x, -0.36, z + 0.1, maderaOscura);
    for (const dx of [-1, 1]) caja(0.08, 1.7, 0.08, x + dx * (ancho / 2 - 0.05), -0.55, z + 0.6, maderaOscura);
    const tablas = 4;
    for (let i = 0; i < tablas; i++) {
      const w = (ancho + 0.3) / tablas;
      caja(w, 0.06, 1.45, x - (ancho + 0.3) / 2 + w * (i + 0.5), 0.42, z + 0.25, i % 2 ? c1 : c2, -0.32);
    }
    // Algo sobre el mostrador, para que parezca de feria.
    for (let i = 0; i < 3; i++) caja(0.22, 0.22, 0.22, x - ancho * 0.28 + i * ancho * 0.28, -0.22, z + 0.35, apagado(ACENTOS[(i * 2 + Math.round(Math.abs(x))) % 5] as number));
  };
  puesto(-6.4, -7.5, 2.3, apagado(ACENTOS[2] as number), rayaA);
  puesto(-3.1, -9, 2.0, apagado(ACENTOS[1] as number), rayaA);
  puesto(8.4, -8, 2.2, apagado(ACENTOS[4] as number), rayaA);

  // Los banderines de un poste a otro.
  const NB = 24;
  for (const px of [-9.5, 9.5]) caja(0.09, 4.1, 0.09, px, 0.55, -5.2, maderaOscura);
  for (let i = 0; i < NB; i++) {
    const x = -9.5 + (19 * (i + 0.5)) / NB;
    const y = 2.55 - 0.7 * (1 - Math.pow(x / 9.5, 2));
    const tri = new BufferGeometry();
    tri.setAttribute("position", new Float32BufferAttribute([x - 0.38, y, -5.2, x + 0.38, y, -5.2, x, y - 0.75, -5.2], 3));
    trozos.push(pintar(tri, apagado(ACENTOS[i % 5] as number)));
    caja(0.8, 0.04, 0.04, x, y, -5.2, maderaOscura);
  }
  const fondoGeo = B.add(mergeGeometries(trozos, false) as BufferGeometry);
  for (const g of trozos) g.dispose();
  const fondo = new Mesh(fondoGeo, B.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })));
  mundo.add(fondo);

  // El abanico de doce tablas pintadas detrás de la rueda, girando al revés (el sol de rayos del 2D).
  const abanicoPos: number[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    abanicoPos.push(0, 0, 0, Math.cos(a - 0.1) * 7, Math.sin(a - 0.1) * 7, 0, Math.cos(a + 0.1) * 7, Math.sin(a + 0.1) * 7, 0);
  }
  const abanicoGeo = B.add(new BufferGeometry());
  abanicoGeo.setAttribute("position", new Float32BufferAttribute(abanicoPos, 3));
  const abanicoMat = basico(oscuro ? YELLOW : 0xffffff, { transparent: true, opacity: oscuro ? 0.07 : 0.2, depthWrite: false, fog: false, side: DoubleSide });
  const abanico = new Mesh(abanicoGeo, abanicoMat);
  abanico.position.z = -1.6;
  abanico.renderOrder = -5;
  mundo.add(abanico);

  /* ------------------------------------------------------------ el sostén de la rueda */
  const madera = lambert(maderaOscura);
  const tinta = lambert(oscuro ? 0x16161f : 0x2b1f4a);
  const negro = lambert(INK);
  const cajaMesh = (w: number, h: number, d: number, x: number, y: number, z: number, m: Material, rz = 0): Mesh => {
    const me = new Mesh(B.add(new BoxGeometry(w, h, d)), m);
    me.position.set(x, y, z);
    me.rotation.z = rz;
    return me;
  };
  // Las dos patas en A que bajan del eje hasta el piso, la columna de atrás y el brazo que lleva el poste de la flecha.
  const patas = new Group();
  for (const lado of [-1, 1]) patas.add(cajaMesh(0.11, 1.95, 0.11, lado * 0.62, -0.78, -0.24, madera, lado * 0.62));
  patas.add(cajaMesh(0.1, 1.5, 0.1, 0, 0.55, -0.24, madera));
  patas.add(cajaMesh(0.08, 0.08, 0.5, 0, 1.28, -0.02, madera));
  patas.add(cajaMesh(0.06, 0.2, 0.06, 0, 1.17, 0.19, negro));
  inclina.add(patas);
  // Una sombra dura, corrida a la derecha y abajo, como la de la marca: separa la rueda del fondo.
  const sombra = new Mesh(B.add(new CircleGeometry(1.0, 64)), basico(0x000000, { transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
  sombra.position.set(0.06, -0.07, -0.34);
  inclina.add(sombra);

  /* ------------------------------------------------------------ el disco y el aro */
  const celu = (): boolean => Math.min(motor.tamano().w, motor.tamano().h) <= 520 || motor.ajustes.nivel === "baja";
  const lienzo = document.createElement("canvas");
  let textura: CanvasTexture | null = null;
  let version = -1;
  let tamTextura = 0;
  const caraMat = B.add(new MeshBasicMaterial({ color: 0xffffff }));
  const ganaMat = B.add(new MeshBasicMaterial({ color: 0xffffff }));
  const cara = new Mesh(B.add(new CircleGeometry(RADIO_GAJOS, 96)), caraMat);
  cara.position.z = 0.002;
  rueda.add(cara);
  const cantoGeo = B.add(new CylinderGeometry(RADIO_GAJOS + 0.012, RADIO_GAJOS + 0.012, 0.18, 48, 1, false));
  cantoGeo.rotateX(Math.PI / 2);
  const canto = new Mesh(cantoGeo, lambert(maderaOscura));
  canto.position.z = -0.09;
  rueda.add(canto);
  const aro = new Mesh(B.add(new TorusGeometry(0.94, 0.062, 8, 72)), tinta);
  aro.scale.z = 1.25;
  aro.position.z = -0.01;
  rueda.add(aro);
  // El perno cero con las tres barritas, que sobresale arriba del aro: marca la vuelta.
  const marca = new Group();
  marca.add(cajaMesh(0.1, 0.13, 0.05, 0, 0, 0, negro));
  const colores = [0xd52b1e, 0xf9e300, 0x007a33];
  colores.forEach((c, i) => marca.add(cajaMesh(0.082, 0.032, 0.056, 0, 0.04 - i * 0.04, 0.004, B.add(new MeshLambertMaterial({ color: c, flatShading: true })))));
  marca.position.set(0, 1.09, 0.0);
  rueda.add(marca);

  // Los 24 pernos de los bordes de gajo (o los que sean) y los 64 foquitos, instanciados.
  const pernoGeo = B.add(new CylinderGeometry(0.028, 0.034, 0.09, 6));
  pernoGeo.rotateX(Math.PI / 2);
  const pernos = new InstancedMesh(pernoGeo, lambert(YELLOW), 48);
  pernos.count = 0;
  pernos.frustumCulled = false;
  B.add({ dispose: () => pernos.dispose() });
  rueda.add(pernos);
  let pernosPara = -1;
  const bombilla = B.add(new SphereGeometry(1, 8, 6));
  const foquitos = new InstancedMesh(bombilla, basico(0xffffff), 64);
  foquitos.count = 0;
  foquitos.frustumCulled = false;
  B.add({ dispose: () => foquitos.dispose() });
  rueda.add(foquitos);
  const objeto = new Object3D();
  const color = new Color();
  const colorTinta = new Color(oscuro ? 0x16161f : 0x2b1f4a);
  let fKey = "";

  /* ------------------------------------------------------------ el cubo, la llama y la flecha */
  const hubGeo = B.add(new CylinderGeometry(0.2, 0.2, 0.07, 20));
  hubGeo.rotateX(Math.PI / 2);
  const cubo = new Group();
  cubo.position.z = 0.0;
  const hubMat = basico(CREAM);
  const hubCuerpo = new Mesh(hubGeo, hubMat);
  hubCuerpo.position.z = 0.035;
  const hubAro = new Mesh(B.add(new CylinderGeometry(0.215, 0.215, 0.05, 20)), negro);
  hubAro.geometry.rotateX(Math.PI / 2);
  hubAro.position.z = 0.022;
  cubo.add(hubAro, hubCuerpo);
  // La llama de la marca en relieve: las mismas cajas que dibuja el 2D, en un solo cuerpo.
  const sc = (0.2 * 1.25) / 26;
  const trozosLlama: [number, number, number, number][] = [[2, 11, 16, 7], [15, 3, 4, 10], [14, 0, 8, 4], [20, -2, 2, 3], [0, 9, 3, 4], [3, 18, 2.5, 6], [8, 18, 2.5, 6], [12.5, 18, 2.5, 6], [16, 18, 2.5, 6]];
  const formas = trozosLlama.map(([rx, ry, rw, rh]) => {
    const x0 = (rx - 11) * sc, y0 = -(ry - 11) * sc, x1 = (rx - 11 + rw) * sc, y1 = -(ry - 11 + rh) * sc;
    const f = new Shape();
    f.moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).closePath();
    return f;
  });
  const llamaGeo = B.add(new ExtrudeGeometry(formas, { depth: 0.022, bevelEnabled: false }));
  const llama = new Mesh(llamaGeo, lambert(ACENTOS[0] as number));
  llama.position.z = 0.07;
  cubo.add(llama);
  inclina.add(cubo);

  // La flecha: un prisma triangular amarillo con el contorno de tinta, que cuelga del brazo y se dobla contra los pernos.
  const flecha = new Group();
  const tri = (m: number): Shape => {
    const s = new Shape();
    s.moveTo(-0.06 - m, 0.02 + m * 0.6).lineTo(0.06 + m, 0.02 + m * 0.6).lineTo(0, -0.14 - m * 1.4).closePath();
    return s;
  };
  const flechaAmarilla = new Mesh(B.add(new ExtrudeGeometry(tri(0), { depth: 0.08, bevelEnabled: false })), basico(YELLOW));
  flechaAmarilla.position.z = 0.1;
  const flechaTinta = new Mesh(B.add(new ExtrudeGeometry(tri(0.022), { depth: 0.06, bevelEnabled: false })), negro);
  flechaTinta.position.z = 0.094;
  flecha.add(flechaTinta, flechaAmarilla);
  flecha.position.set(0, 1.065, 0);
  inclina.add(flecha);

  /* ------------------------------------------------------------ los gajos que ganan: una malla aparte, desde el golpe */
  let ganaMalla: Mesh | null = null;
  let ganaPara = "";
  const sectores = (js: readonly number[], segs: number): BufferGeometry => {
    const A = TAU / segs;
    const pasos = 6;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const j of js) {
      const base = pos.length / 3;
      pos.push(0, 0, 0);
      uv.push(0.5, 0.5);
      const a0 = j * A - Math.PI / 2;
      for (let p = 0; p <= pasos; p++) {
        const [x, y] = en3D(a0 + (A * p) / pasos, RADIO_GAJOS);
        pos.push(x, y, 0);
        uv.push(0.5 + x / (2 * RADIO_GAJOS), 0.5 + y / (2 * RADIO_GAJOS));
      }
      for (let p = 0; p < pasos; p++) idx.push(base, base + 2 + p, base + 1 + p);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  };

  /* ------------------------------------------------------------ las astillas de la flecha */
  const astillas = new Rafagas(motor, { max: 6, porRafaga: 10, color: 0xd9b27a, tam: 0.22, vida: 0.4, gravedad: 9, velocidad: 2.4, empujeArriba: 2.2 });
  let ultimoGajo = -1;
  let trabado = false;

  /* ------------------------------------------------------------ la textura del disco */
  const pintarDisco = (e: EntradaRueda): void => {
    const TS = celu() ? 1024 : 2048;
    if (lienzo.width !== TS) { lienzo.width = TS; lienzo.height = TS; }
    const c = lienzo.getContext("2d");
    if (!c) return;
    const segs = e.gajos.length;
    const A = TAU / segs;
    const Rd = RADIO_GAJOS * e.R;
    const k = TS / (2 * Rd);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, TS, TS);
    c.translate(TS / 2, TS / 2);
    c.scale(k, k);
    c.lineJoin = "round";
    for (let j = 0; j < segs; j++) {
      const a0 = j * A - Math.PI / 2;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, Rd, a0, a0 + A);
      c.closePath();
      c.fillStyle = css(e.gajos[j]!.color);
      c.fill();
      c.lineWidth = 2.5 * e.u;
      c.strokeStyle = css(INK);
      c.stroke();
    }
    // La sombra radial de la rueda: sin esto, veinticuatro gajos planos son papilla.
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.arc(0, 0, Rd * (1 - i * 0.12), 0, TAU);
      c.fillStyle = "rgba(0,0,0,0.03)";
      c.fill();
    }
    c.font = `900 ${e.letra}px ${FUENTE}`;
    c.textAlign = "right";
    c.textBaseline = "middle";
    c.strokeStyle = css(INK);
    c.fillStyle = css(CREAM);
    c.lineWidth = Math.max(3, e.letra / 4);
    for (let j = 0; j < segs; j++) {
      const nombre = e.gajos[j]!.nombre;
      if (!nombre) continue;
      const mid = j * A - Math.PI / 2 + A / 2;
      c.save();
      c.rotate(mid);
      c.strokeText(nombre, Rd * 0.9, 0);
      c.fillText(nombre, Rd * 0.9, 0);
      c.restore();
    }
    if (!textura || tamTextura !== TS) {
      textura?.dispose();
      textura = new CanvasTexture(lienzo);
      textura.colorSpace = SRGBColorSpace;
      textura.anisotropy = Math.min(8, motor.renderer.capabilities.getMaxAnisotropy());
      tamTextura = TS;
      caraMat.map = textura;
      ganaMat.map = textura;
      caraMat.needsUpdate = true;
      ganaMat.needsUpdate = true;
    } else textura.needsUpdate = true;
    version = e.version;
  };

  const armarPernos = (segs: number): void => {
    const A = TAU / segs;
    for (let j = 0; j < segs; j++) {
      const [x, y] = en3D(j * A - Math.PI / 2, 0.905);
      objeto.position.set(x, y, 0.07);
      objeto.rotation.set(0, 0, 0);
      objeto.scale.set(1, 1, 1);
      objeto.updateMatrix();
      pernos.setMatrixAt(j, objeto.matrix);
    }
    pernos.count = segs;
    pernos.instanceMatrix.needsUpdate = true;
    pernosPara = segs;
  };

  let stretchPuesto = -1;
  let foquitosCount = -1;
  const ponerFoquitos = (cuantos: number, encendidos: number, estira: number): void => {
    const key = `${cuantos}|${encendidos}|${estira.toFixed(2)}`;
    if (key === fKey) return;
    fKey = key;
    foquitos.count = cuantos;
    for (let i = 0; i < cuantos; i++) {
      const a = (i / 64) * TAU - Math.PI / 2;
      const [x, y] = en3D(a, 0.968);
      const on = encendidos > 0 && i % 2 === encendidos - 1;
      objeto.position.set(x, y, 0.062);
      objeto.rotation.set(0, 0, -a + Math.PI / 2);
      const r = (on ? 0.027 : 0.021);
      objeto.scale.set(r * (1 + estira), r, r);
      objeto.updateMatrix();
      foquitos.setMatrixAt(i, objeto.matrix);
      color.setHex(on ? YELLOW : CREAM);
      if (!on && encendidos > 0) color.lerp(colorTinta, 0.65);
      else if (!on) color.lerp(colorTinta, 0.25);
      foquitos.setColorAt(i, color);
    }
    foquitos.instanceMatrix.needsUpdate = true;
    if (foquitos.instanceColor) foquitos.instanceColor.needsUpdate = true;
    stretchPuesto = estira;
    foquitosCount = cuantos;
  };
  void stretchPuesto;
  void foquitosCount;

  const baseFondoFog = horizonte.clone();

  return {
    frame(e) {
      motor.cuadro(e, perfil({ fov: FOV_RUEDA }), (mapa, pose) => {
        const t = e.t;
        const segs = e.gajos.length;
        const k = mapa.s * e.R;
        mundo.scale.setScalar(k);
        if (version !== e.version) pintarDisco(e);
        if (pernosPara !== segs) armarPernos(segs);

        // La cámara: la del director, mirando a la rueda en su plano.
        const { az, el } = anguloCamara(t);
        const p = poseRueda(e, mapa.s, az, el);
        pose.pos = p.pos;
        pose.mira = p.mira;
        pose.fov = p.fov;
        pose.giro = p.giro;
        inclina.rotation.x = -0.5 * el;

        // La rueda: solo gira.
        rueda.rotation.z = rotacionDisco(e.angulo);
        const g = corona(t);
        const luz = luzDelMundo(t);
        const estira = e.velocidad > 12 ? Math.min(2.4, (e.velocidad - 12) / 9) : 0;
        ponerFoquitos(e.foquitos, e.encendidos, Math.round(estira * 20) / 20);

        // La flecha: el ángulo y el golpe salen del 2D.
        flecha.rotation.z = -e.paleta;
        flecha.scale.setScalar(e.golpePaleta);
        cubo.rotation.z = -e.cubo;
        abanico.rotation.z = t * 0.04;
        abanicoMat.opacity = (oscuro ? 0.07 : 0.2) * (1 + (oscuro ? 1.2 : 0.4) * g);

        // Los gajos que ganan: aparte, solo desde el golpe, y se adelantan; los demás se apagan.
        if (e.ganan && e.ganan.length) {
          const clave = e.ganan.join(",") + "|" + segs;
          if (clave !== ganaPara) {
            ganaPara = clave;
            if (ganaMalla) { ganaMalla.geometry.dispose(); rueda.remove(ganaMalla); }
            ganaMalla = new Mesh(sectores(e.ganan, segs), ganaMat);
            rueda.add(ganaMalla);
          }
          if (ganaMalla) {
            ganaMalla.visible = true;
            ganaMalla.position.z = 0.004 + 0.05 * g;
            ganaMalla.scale.setScalar(1 + 0.025 * g);
          }
        } else if (ganaMalla) ganaMalla.visible = false;
        const apaga = 1 - 0.6 * g;
        caraMat.color.setScalar(apaga);
        hubMat.color.setScalar(1 - 0.5 * g);

        // La luz del mundo baja con el golpe; quien gana queda con su color pleno (el disco no usa luces).
        if (hemi) hemi.intensity = hemiBase * luz;
        amb.sol.intensity = solBase * luz;
        cieloMat.color.setScalar(luz);
        if (motor.escena.fog) {
          motor.escena.fog.color.copy(baseFondoFog).multiplyScalar(luz);
          (motor.escena.fog as { near: number; far: number }).near = 5.5 * k;
          (motor.escena.fog as { near: number; far: number }).far = 30 * k;
        }

        // Astillas: cada perno que pasa contra la flecha en el último tramo, y la traba.
        const A = TAU / segs;
        const s = Math.floor((((-e.angulo / A) % segs) + segs) % segs);
        const punta: [number, number, number] = [0, 0.93 * k, 0.12 * k];
        if (t >= T_CREEP && t < T_LOCK && s !== ultimoGajo && ultimoGajo >= 0) astillas.emitir(t, punta[0], punta[1], punta[2], 0.45);
        ultimoGajo = s;
        if (t >= T_LOCK && !trabado) {
          trabado = true;
          astillas.emitir(t, punta[0], punta[1], punta[2], 1);
          astillas.emitir(t + 0.02, punta[0], punta[1], punta[2], 0.8);
        }
        if (t < T_LOCK) trabado = false;
        astillas.actualizar(t);

        amb.seguir({ ...p, mira: [p.mira[0], 0, p.mira[2]] });
        if (motor.auditoria) {
          (window as unknown as { __ruleta3d: unknown }).__ruleta3d = {
            llamadas: motor.renderer.info.render.calls,
            triangulos: motor.renderer.info.render.triangles,
            gajoBajoLaFlecha: gajoBajoLaFlecha3D(rueda.rotation.z, segs),
            textura: tamTextura,
          };
        }
      });
    },
    pantallaDe: () => null,
    destruir() {
      textura?.dispose();
      if (ganaMalla) ganaMalla.geometry.dispose();
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: la ruleta en 3D aparece sin editar ningún otro archivo. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/wheel");
  return (names, winners, beacon, done) => m.wheelPixi(names, winners, beacon, done, montaje);
};

/** Para el cálculo de los tiempos que la cámara usa (se prueba que no dependan de nada más). */
export const TIEMPOS_CAMARA = { T_WIND, T_BRAKE, T_HOLD, T_CROWN } as const;
