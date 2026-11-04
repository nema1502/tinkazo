import {
  BackSide, BoxGeometry, BufferGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, Euler, Float32BufferAttribute,
  Fog, Group, HemisphereLight, PointLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Points, PointsMaterial, Quaternion,
  SphereGeometry, Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashDe } from "../pixi/kit/azar";
import { SombrasDeContacto } from "./escena";
import { Instancias, Materiales } from "./figuras";
import { sinAzarDeTres } from "./ids";
import { D0, PERFIL, PROF, alturaExtra, altoDelPalo, camaraDe, colocar, cuerpo3D, focal, mapaDelMundo, mitadEnCuerpos, suave, type EntradaGuajojo, type GeoG } from "./guajojo-3d-mapa";
import { Basura, definir3D } from "./motor";
import type { Fabrica3D, Lanzador } from "./tipos";

export type { EntradaGuajojo, PersonaG } from "./guajojo-3d-mapa";

/**
 * El Guajojó en 3D (src/games/tres/README.md; el brief y el 2D en `pixi/guajojo.ts`).
 *
 * Un sendero del monte de noche, de verdad: el palo crece a medida que se acerca la gente, los farolitos alumbran el piso
 * y el amanecer echa sombras largas hacia la sala. No decide nada: el 2D pone dónde está cada persona, cómo mueve las
 * piernas y los brazos, cuánto abre los ojos el palo y qué ramita se parte, y esto lo viste. La cámara es la del director
 * del 2D (ver `guajojo-3d-mapa.ts`), así que el palo, quien llega a la meta, el foco y los nombres caen donde el 2D dice.
 *
 * Sin azar: todo es función de `t` y de un hash del lugar. Nada de esto sabe quién gana antes del golpe: el único dato es
 * `e.ganador`, que el 2D llena recién cuando cae el golpe.
 */

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const c01 = (v: number): number => Math.max(0, Math.min(1, v));

/* ------------------------------------------------------------- la paleta */
interface Paleta {
  suelo: number;
  sendero: number;
  matas: number;
  ramitas: number;
  arboles: number;
  cerros: number;
  lejanos: number;
  tinta: number;
  hemiCielo: number;
  hemiSuelo: number;
  hemiFuerza: number;
  luz: number;
  luzFuerza: number;
  /** Las cuatro franjas del cielo, de arriba al horizonte: de noche y con el alba. */
  bandas: readonly (readonly [number, number])[];
  luna: number;
}

const PALETAS: Record<"claro" | "oscuro", Paleta> = {
  oscuro: {
    suelo: 0x1d4a2f, sendero: 0x6a5e4c, matas: 0x103a22, ramitas: 0x2a2018, arboles: 0x0a0e22, cerros: 0x151b3b, lejanos: 0x0f1430, tinta: 0x16161f,
    hemiCielo: 0x9fb0ff, hemiSuelo: 0x4a4258, hemiFuerza: 1.5, luz: 0xcfd4ff, luzFuerza: 1.9,
    bandas: [[0x070a22, 0x5a6fb5], [0x0e1438, 0xb8708d], [0x1b2150, 0xf2a2a0], [0x2f3470, 0xffd27a]], luna: 0xeef2ff,
  },
  claro: {
    suelo: 0x2f5236, sendero: 0x8a7258, matas: 0x254a2d, ramitas: 0x4a3626, arboles: 0x241c40, cerros: 0x3a2e63, lejanos: 0x2b2250, tinta: 0x191919,
    hemiCielo: 0xffd9b0, hemiSuelo: 0x7a5a48, hemiFuerza: 1.55, luz: 0xffd7a0, luzFuerza: 1.7,
    bandas: [[0x2b2250, 0x5a6fb5], [0x6b3a78, 0xe08a9a], [0xc2527a, 0xf5b080], [0xf59e5b, 0xffd78a]], luna: 0xfff1d0,
  },
};
const CABELLOS = [0x2b1d14, 0x3d2817, 0x151515, 0x5a3a22];
const PIEL = 0xc68a5c;
const PANTALON = 0x2b2d42;
const ZAPATO = 0xe9e2d2;
const FAROL = 0xffc65a;
const AMARILLO = 0xffc629;

const mezcla = (a: number, b: number, k: number): number => {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, k), g = lerp((a >> 8) & 255, (b >> 8) & 255, k), bl = lerp(a & 255, b & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

const ESTRELLAS = 140;
const HALOS = [0.1, 0.14, 0.2];

/* ------------------------------------------------------------- la fábrica */
interface Cabeza {
  x: number;
  y: number;
  z: number;
}

const fabrica: Fabrica3D<EntradaGuajojo> = (motor, o) => {
  const P = PALETAS[o.tema];
  const noche = o.tema === "oscuro";
  const mapa = mapaDelMundo();
  const K = cuerpo3D(mapa);
  const B = motor.basura;
  const escena = motor.escena;
  const mat = new Materiales(B);
  const tmp = { m: new Matrix4(), q: new Quaternion(), e: new Euler(), p: new Vector3(), s: new Vector3() };

  /* ---------------------------------------------------------------- luces y niebla */
  const niebla = new Fog(new Color(P.bandas[3]![0]), 25 * K, 90 * K);
  escena.fog = niebla;
  const hemi = new HemisphereLight(P.hemiCielo, P.hemiSuelo, P.hemiFuerza);
  const luz = new DirectionalLight(P.luz, P.luzFuerza);
  // El foco de quien gana: una luz cálida delante de ella desde el golpe (apagada, en intensidad 0, hasta entonces; existe desde el arranque para no recompilar).
  const focoGana = new PointLight(0xffe0a0, 0, 14 * K, 2);
  escena.add(hemi, luz, luz.target, focoGana);
  const lunaDir = new Vector3(-0.45, 0.85, 0.55).normalize();
  const solDir = new Vector3(0.06, 0.1, -1).normalize();
  const dir = new Vector3();
  const cLuna = new Color(noche ? 0xcfd4ff : 0xffd7a0);
  const cSol = new Color(0xffe2b8);
  const cHemiNoche = new Color(P.hemiCielo);
  const cHemiDia = new Color(0xffd9b8);
  const cSuelo = new Color(P.hemiSuelo);
  const cSueloDia = new Color(0x8a6a50);

  /* ---------------------------------------------------------------- el cielo */
  const RC = 1800;
  const domoGeo = B.add(new SphereGeometry(RC, 24, 14));
  const nv = domoGeo.getAttribute("position").count;
  const atributoColor = new Float32BufferAttribute(new Float32Array(nv * 3), 3);
  domoGeo.setAttribute("color", atributoColor);
  const domo = new Mesh(domoGeo, B.add(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
  domo.renderOrder = -10;
  domo.frustumCulled = false;
  escena.add(domo);
  const cTmp = new Color();
  const cBlanco = new Color(0xffffff);
  const vZ = new Vector3(0, 0, 1);
  const cBanda = P.bandas.map(() => new Color());
  let albaPintada = -1;
  const pintarCielo = (alba: number): void => {
    if (Math.abs(alba - albaPintada) < 0.003) return;
    albaPintada = alba;
    P.bandas.forEach(([a, b], i) => cBanda[i]!.setHex(mezcla(a, b, alba)));
    const pos = domoGeo.getAttribute("position");
    for (let i = 0; i < nv; i++) {
      // k: 0 en el horizonte, 1 a unos 20 grados; las cuatro franjas del 2D, de abajo hacia arriba.
      const k = c01(pos.getY(i) / RC / 0.342);
      const f = k * 4 - 0.5;
      const j = Math.max(0, Math.min(2, Math.floor(f)));
      const kk = c01(f - j);
      cTmp.copy(cBanda[3 - j]!).lerp(cBanda[2 - j]!, kk);
      atributoColor.setXYZ(i, cTmp.r, cTmp.g, cTmp.b);
    }
    atributoColor.needsUpdate = true;
    niebla.color.copy(cBanda[3]!);
  };
  pintarCielo(0);

  // Las estrellas, sobre el domo: quietas, y se apagan con el día.
  const estGeo = B.add(new BufferGeometry());
  const ep: number[] = [];
  for (let i = 0; i < ESTRELLAS; i++) {
    const az = (hashDe(i, 1) - 0.5) * 2 * 1.1;
    const el = 0.02 + hashDe(i, 2) * 0.36;
    ep.push(Math.sin(az) * Math.cos(el) * RC * 0.98, Math.sin(el) * RC * 0.98, -Math.cos(az) * Math.cos(el) * RC * 0.98);
  }
  estGeo.setAttribute("position", new Float32BufferAttribute(ep, 3));
  const estMat = B.add(new PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false, depthWrite: false }));
  const estrellas = new Points(estGeo, estMat);
  estrellas.frustumCulled = false;
  domo.add(estrellas);
  // La luna y el sol: discos planos sobre el domo, en la dirección que les toca; el sol sale detrás del palo.
  const discoGeo = B.add(new CircleGeometry(1, 28));
  const basico = (color: number, opacity = 1, transparente = opacity < 1): MeshBasicMaterial => B.add(new MeshBasicMaterial({ color, transparent: transparente, opacity, fog: false, depthWrite: false, side: DoubleSide }));
  const lunaMat = basico(P.luna, 1, true);
  const luna = new Mesh(discoGeo, lunaMat);
  const lunaHalo = new Mesh(discoGeo, basico(P.luna, 0.1));
  luna.renderOrder = lunaHalo.renderOrder = -9;
  domo.add(luna, lunaHalo);
  const solMat = basico(0xffe9a8, 1, true);
  const sol = new Mesh(discoGeo, solMat);
  const solHalos = [[3.6, 0.1], [2.4, 0.14], [1.5, 0.2]].map(([m, a]) => ({ m: m as number, malla: new Mesh(discoGeo, basico(0xffd27a, a as number)) }));
  sol.renderOrder = -8;
  for (const h of solHalos) {
    h.malla.renderOrder = -9;
    domo.add(h.malla);
  }
  domo.add(sol);
  const hacia = new Vector3();
  const sobreElDomo = (m: Mesh, az: number, el: number, radio: number): void => {
    const d = RC * 0.96;
    hacia.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    m.position.copy(hacia).multiplyScalar(d);
    // El disco mira al centro del domo (donde está la cámara).
    m.quaternion.setFromUnitVectors(vZ, hacia.negate());
    m.scale.setScalar(radio * d);
  };

  /* ---------------------------------------------------------------- lo fijo del sendero (depende del ancho) */
  const fijoBasura = new Basura();
  let fijo: Group | null = null;
  let geoFijo: GeoG | null = null;
  let hp = 4.3;
  let zPaloM = 0;
  const palo = { ojosY: 0, ojosX: 0, ojosZ: 0, r: 0.3 };
  const ojos: { disco: Mesh; pupila: Mesh; rendija: Mesh; halo: Mesh; halo2: Mesh }[] = [];
  const ojosGrupo = new Group();
  escena.add(ojosGrupo);

  // Todo lo quieto del monte se hornea en dos mallas (una con luz y otra sin) con el color en cada vértice: menos llamadas de dibujo.
  const lugarM = (x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, rz = 0): Matrix4 => {
    const t = tmp;
    t.e.set(0, ry, rz);
    return new Matrix4().compose(t.p.set(x, y, z), new Quaternion().setFromEuler(t.e), t.s.set(sx, sy, sz));
  };
  const hornear = (destino: BufferGeometry[], geo: BufferGeometry, color: number, lugar: Matrix4): void => {
    // Sin índice, así las piezas con y sin índice se pueden unir.
    const g2 = geo.index ? geo.toNonIndexed() : geo.clone();
    g2.deleteAttribute("uv");
    g2.applyMatrix4(lugar);
    const nv2 = g2.getAttribute("position").count;
    const col = new Float32Array(nv2 * 3);
    cTmp.setHex(color);
    for (let i = 0; i < nv2; i++) {
      col[i * 3] = cTmp.r;
      col[i * 3 + 1] = cTmp.g;
      col[i * 3 + 2] = cTmp.b;
    }
    g2.setAttribute("color", new Float32BufferAttribute(col, 3));
    destino.push(g2);
  };

  const armarFijo = (g: GeoG): void => {
    if (fijo) escena.remove(fijo);
    fijoBasura.vaciar();
    for (const j of ojos) ojosGrupo.remove(j.disco, j.pupila, j.rendija, j.halo, j.halo2);
    ojos.length = 0;
    geoFijo = g;
    const hw = mitadEnCuerpos(g);
    const grupo = new Group();
    const Z = (z: number): number => -z * PROF * K;
    const conLuz: BufferGeometry[] = [];
    const sinLuz: BufferGeometry[] = [];
    const cajaUnit = new BoxGeometry(1, 1, 1);
    // El monte y el sendero.
    hornear(conLuz, cajaUnit, P.suelo, lugarM(0, -0.1 * K, 0, 0, 6000 * K, 0.2 * K, 6000 * K));
    const senderoLargo = 1.32 * PROF;
    hornear(conLuz, cajaUnit, P.sendero, lugarM(0, -0.04 * K, (Z(-0.22) + Z(1.1)) / 2, 0, 2 * hw * K, 0.1 * K, senderoLargo * K));
    // Las matas del borde: conos de cinco lados.
    const conoGeo = new ConeGeometry(1, 1, 5, 1);
    conoGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 70; i++) {
      const z = hashDe(i, 41) * 1.05 - 0.08;
      const lado = i % 2 ? 1 : -1;
      const x = lado * (1.04 + 0.35 * hashDe(i, 42)) * hw;
      const h = 0.35 + 0.45 * hashDe(i, 43);
      hornear(conLuz, conoGeo, P.matas, lugarM(x * K, 0, Z(z), hashDe(i, 44) * 6, (0.28 + 0.22 * hashDe(i, 45)) * K, h * K, (0.28 + 0.22 * hashDe(i, 45)) * K));
    }
    // Las ramitas caídas.
    const ramGeo = new CylinderGeometry(1, 1, 1, 5, 1);
    ramGeo.rotateZ(Math.PI / 2);
    for (let i = 0; i < 26; i++) {
      const x = (hashDe(i, 51) - 0.5) * 1.7 * hw;
      const z = hashDe(i, 52) * 0.9;
      const l = 0.2 + 0.2 * hashDe(i, 53);
      hornear(conLuz, ramGeo, mezcla(P.ramitas, 0xd9b27a, 0.15), lugarM(x * K, 0.02 * K, Z(z), hashDe(i, 54) * 3.1, l * K, 0.016 * K, 0.016 * K));
    }
    // Los árboles de al lado (y los del horizonte): tronco y copa ancha.
    const troncoGeo = new CylinderGeometry(0.7, 1, 1, 7, 1);
    troncoGeo.translate(0, 0.5, 0);
    const copaGeo = new SphereGeometry(1, 8, 6);
    const arbol = (destino: BufferGeometry[], color: number, x: number, zz: number, alto: number, completo: boolean): void => {
      hornear(destino, troncoGeo, color, lugarM(x * K, 0, zz, 0, 0.04 * alto * K, 0.64 * alto * K, 0.04 * alto * K));
      hornear(destino, copaGeo, color, lugarM(x * K, 0.7 * alto * K, zz, 0, 0.42 * alto * K, 0.2 * alto * K, 0.42 * alto * K));
      if (completo) {
        hornear(destino, copaGeo, color, lugarM((x - 0.22 * alto) * K, 0.62 * alto * K, zz, 0, 0.22 * alto * K, 0.12 * alto * K, 0.22 * alto * K));
        hornear(destino, copaGeo, color, lugarM((x + 0.24 * alto) * K, 0.64 * alto * K, zz, 0, 0.2 * alto * K, 0.11 * alto * K, 0.2 * alto * K));
      }
    };
    // En el celular el sendero es angosto y los árboles del marco comían media pantalla: más chicos, más afuera y con la luz del monte.
    const arbolesColor = g.retrato ? mezcla(P.arboles, P.cerros, 0.55) : P.arboles;
    const arbolesEsc = g.retrato ? 0.55 : 1;
    const arbolesAfuera = g.retrato ? 1.3 : 1;
    for (const [x, z, h] of [[-1.5, 0.55, 1.9], [1.55, 0.7, 1.6], [-1.9, 0.15, 3.1], [1.95, 0.25, 2.8]] as const) arbol(conLuz, arbolesColor, x * hw * arbolesAfuera, Z(z), h * 2.2 * arbolesEsc, true);
    // Los cerros lejanos, una tira de cuarenta picos, y árboles en el horizonte: siluetas con niebla.
    const Dr = D0 + PROF + 38;
    const ang = g.alto / focal(g);
    const ancho = Dr * 1.9;
    const pos: number[] = [];
    const picos = 40;
    for (let i = 0; i < picos; i++) {
      const xa = -ancho + (2 * ancho * i) / picos, xb = -ancho + (2 * ancho * (i + 1)) / picos;
      const ha = (0.03 + 0.07 * hashDe(i, 31)) * ang * Dr, hb = (0.03 + 0.07 * hashDe(i + 1, 31)) * ang * Dr;
      pos.push(xa, -3, 0, xb, -3, 0, xa, ha, 0, xb, -3, 0, xb, hb, 0, xa, ha, 0);
    }
    const cerroGeo = new BufferGeometry();
    cerroGeo.setAttribute("position", new Float32BufferAttribute(pos.map((v) => v * K), 3));
    cerroGeo.setAttribute("normal", new Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    hornear(sinLuz, cerroGeo, P.cerros, new Matrix4().makeTranslation(0, 0, (-(PROF + 38)) * K));
    for (let i = 0; i < 26; i++) {
      const x = -ancho * 0.8 + (i / 25) * ancho * 1.6 + (hashDe(i, 3) - 0.5) * 4;
      const alto = (0.12 + 0.08 * hashDe(i, 4)) * ang * Dr * 0.6;
      arbol(sinLuz, P.lejanos, x, -(PROF + 36) * K, alto, false);
    }

    // El palo seco: tres tramos torcidos, una rama muerta y los ojos de adelante.
    // En el celular el panel del contador cubre el borde de arriba: el palo es un poco más bajo y su punta se ve siempre.
    hp = altoDelPalo(g, 1.06) * (g.retrato ? 0.86 : 1);
    zPaloM = Z(1.06);
    const tramo = (y0: number, y1: number, r0: number, r1: number, inclina: number, color = 0x5b4a3c): void => {
      const geo = new CylinderGeometry(r1 * hp * K, r0 * hp * K, (y1 - y0) * hp * K, 7, 1);
      hornear(conLuz, geo, color, lugarM(0, ((y0 + y1) / 2) * hp * K, zPaloM, 0, 1, 1, 1, inclina));
    };
    tramo(0, 0.5, 0.19, 0.14, 0.015);
    tramo(0.5, 0.82, 0.14, 0.115, -0.03, 0x3a2e26);
    tramo(0.82, 0.97, 0.115, 0.06, 0.04);
    hornear(conLuz, new ConeGeometry(0.06 * hp * K, 0.05 * hp * K, 7), 0x5b4a3c, lugarM(0.004 * hp * K, 0.995 * hp * K, zPaloM, 0, 1, 1, 1));
    hornear(conLuz, new CylinderGeometry(0.025 * hp * K, 0.035 * hp * K, 0.3 * hp * K, 5, 1), 0x5b4a3c, lugarM(0.28 * hp * K, 0.46 * hp * K, zPaloM, 0, 1, 1, 1, -1.0));
    const malla = (geos: BufferGeometry[], m: MeshLambertMaterial | MeshBasicMaterial): void => {
      const unida = mergeGeometries(geos, false);
      if (!unida) return;
      fijoBasura.add(unida);
      const me = new Mesh(unida, m);
      me.frustumCulled = false;
      grupo.add(me);
    };
    malla(conLuz, fijoBasura.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true })));
    malla(sinLuz, fijoBasura.add(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })));
    // Los ojos: dos discos amarillos que se abren, con su pupila; cerrados, una rendija.
    palo.r = 0.065 * hp;
    palo.ojosY = 0.776 * hp;
    palo.ojosX = 0.118 * hp;
    palo.ojosZ = zPaloM / K + 0.12 * hp;
    const basicoFijo = (color: number): MeshBasicMaterial => fijoBasura.add(new MeshBasicMaterial({ color }));
    const amarillo = basicoFijo(0xffd23a);
    amarillo.fog = false;
    const negro = basicoFijo(0x120c06);
    negro.fog = false;
    const rendMat = basicoFijo(0x2a2018);
    const rendGeo = fijoBasura.add(new BoxGeometry(1, 1, 1));
    const haloOjo = fijoBasura.add(new MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.16, depthWrite: false, fog: false }));
    const haloOjo2 = fijoBasura.add(new MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.1, depthWrite: false, fog: false }));
    for (const lado of [-1, 1]) {
      const d = new Mesh(discoGeo, amarillo);
      const p = new Mesh(discoGeo, negro);
      const r = new Mesh(rendGeo, rendMat);
      // El resplandor de cada ojo, dos discos suaves detrás: como el del 2D, sin ser más luz que los demás.
      const h1 = new Mesh(discoGeo, haloOjo);
      const h2 = new Mesh(discoGeo, haloOjo2);
      h1.renderOrder = h2.renderOrder = 1;
      for (const m of [d, p, r, h1, h2]) {
        m.position.set(lado * palo.ojosX * K, palo.ojosY * K, palo.ojosZ * K);
        ojosGrupo.add(m);
      }
      h1.position.z -= 0.02 * K;
      h2.position.z -= 0.02 * K;
      ojos.push({ disco: d, pupila: p, rendija: r, halo: h1, halo2: h2 });
    }
    fijo = grupo;
    escena.add(grupo);
  };

  /* ---------------------------------------------------------------- la gente */
  let n = 0;
  let completa = true;
  let gente: {
    piernas: Instancias; torsos: Instancias; brazos: Instancias; manos: Instancias; cabezas: Instancias; pelos: Instancias;
    chullos: Instancias; faroles: Instancias; halos: Instancias; cascos: InstancedMesh[]; sombras: SombrasDeContacto; chulloDe: number[]; colores: number[];
  } | null = null;
  let cabezas: Cabeza[] = [];
  let ganadorMarcado = -1;

  const caja = (w: number, h: number, d: number, cx = 0, cy = 0, cz = 0): BoxGeometry => {
    const g = B.add(new BoxGeometry(w, h, d));
    g.translate(cx, cy, cz);
    return g;
  };
  const esfera = (r: number, a = 8, b = 6): SphereGeometry => B.add(new SphereGeometry(r, a, b));

  const armarGente = (e: EntradaGuajojo): void => {
    n = e.gente.length;
    completa = e.completa;
    const blanco = mat.plano(0xffffff);
    const inst = (geo: BufferGeometry, m: MeshLambertMaterial | MeshBasicMaterial, max: number): Instancias => {
      const i = new Instancias(geo, m, max, B);
      i.usar(max);
      escena.add(i.malla);
      return i;
    };
    const tinta = B.add(new MeshBasicMaterial({ color: P.tinta, side: BackSide }));
    const casco = (de: Instancias, geo: BufferGeometry): InstancedMesh => {
      const c = new InstancedMesh(geo, tinta, Math.max(1, de.max));
      c.instanceMatrix = de.malla.instanceMatrix;
      c.count = de.malla.count;
      c.frustumCulled = false;
      B.add({ dispose: () => c.dispose() });
      escena.add(c);
      return c;
    };
    // La pierna y su zapato, en una sola pieza con el color en cada vértice.
    const pierna = caja(0.13, 0.5, 0.13, 0, -0.25, 0);
    const zapato = caja(0.15, 0.075, 0.22, 0, -0.4625, -0.035);
    const pintar = (geo: BufferGeometry, color: number): BufferGeometry => {
      geo.deleteAttribute("uv");
      const cnt = geo.getAttribute("position").count;
      const col = new Float32Array(cnt * 3);
      cTmp.setHex(color);
      for (let i = 0; i < cnt; i++) {
        col[i * 3] = cTmp.r;
        col[i * 3 + 1] = cTmp.g;
        col[i * 3 + 2] = cTmp.b;
      }
      geo.setAttribute("color", new Float32BufferAttribute(col, 3));
      return geo;
    };
    // Con más de 60 personas (figura simple) las dos piernas son una sola pieza, un poco más ancha: menos cuentas por cuadro.
    const piernaDoble = caja(0.24, 0.5, 0.13, 0, -0.25, 0);
    const zapatoDoble = caja(0.26, 0.075, 0.22, 0, -0.4625, -0.035);
    const piernaYZapato = B.add(mergeGeometries(completa ? [pintar(pierna, PANTALON), pintar(zapato, ZAPATO)] : [pintar(piernaDoble, PANTALON), pintar(zapatoDoble, ZAPATO)], false)!);
    const piernas = inst(piernaYZapato, B.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true })), completa ? 2 * n : n);
    const torsos = inst(caja(0.38, 0.4, 0.24), blanco, n);
    const brazos = inst(caja(0.1, 0.34, 0.1, 0, -0.17, 0), blanco, 2 * n);
    const manos = inst(esfera(0.055), mat.plano(PIEL), completa ? 2 * n : 0);
    // Simple (más de 60): la cabeza lleva el color del pelo, que es lo que se ve desde atrás, y no hay pelo aparte.
    const cabs = inst(esfera(completa ? 0.135 : 0.148), completa ? mat.plano(PIEL) : blanco, n);
    const pelos = inst(esfera(0.148), blanco, completa ? n : 0);
    const chulloDe: number[] = Array.from({ length: n }, () => -1);
    let nch = 0;
    if (completa) for (let i = 0; i < n; i++) if (hashDe(i, 9) < 0.4) chulloDe[i] = nch++;
    const conoChullo = B.add(new ConeGeometry(0.15, 0.22, 6, 1));
    conoChullo.translate(0, 0.11, 0);
    const chullos = inst(conoChullo, blanco, nch);
    const faroles = inst(caja(0.09, 0.11, 0.09), B.add(new MeshBasicMaterial({ color: FAROL })), n);
    const haloGeo = B.add(new CircleGeometry(completa ? 1.0 : 0.7, 20));
    haloGeo.rotateX(-Math.PI / 2);
    // Con más de 60 personas los discos de luz se pueden amontonar de a decenas y pesan en el celular: ahí solo hay uno, el de quien gana.
    const halos = inst(haloGeo, B.add(new MeshBasicMaterial({ color: FAROL, transparent: true, opacity: 0.42, depthWrite: false, fog: false })), completa ? n : 1);
    halos.malla.renderOrder = 1;
    const cascos = [
      casco(piernas, caja(0.185, 0.56, 0.185, 0, -0.265, 0)),
      casco(torsos, caja(0.45, 0.47, 0.31)),
      casco(brazos, caja(0.15, 0.4, 0.15, 0, -0.185, 0)),
      casco(cabs, esfera(0.148)),
    ];
    const sombras = new SombrasDeContacto(motor, n, 0.35);
    // El color de cada persona: el mismo del 2D. El pelo y el chullo salen del mismo hash que en el 2D.
    const cols: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = e.colores[i] ?? AMARILLO;
      cols.push(c);
      torsos.malla.setColorAt(i, cTmp.setHex(c));
      brazos.malla.setColorAt(2 * i, cTmp.setHex(c));
      brazos.malla.setColorAt(2 * i + 1, cTmp.setHex(c));
      const cabello = CABELLOS[Math.floor(hashDe(i, 8) * 4)] ?? 0x151515;
      if (completa) pelos.malla.setColorAt(i, cTmp.setHex(cabello));
      else cabs.malla.setColorAt(i, cTmp.setHex(cabello));
      const k = chulloDe[i] as number;
      if (k >= 0) chullos.malla.setColorAt(k, cTmp.setHex(mezcla(c, AMARILLO, 0.5)));
    }
    for (const m of [torsos, brazos, pelos, chullos, cabs]) if (m.malla.instanceColor) m.malla.instanceColor.needsUpdate = true;
    gente = { piernas, torsos, brazos, manos, cabezas: cabs, pelos, chullos, faroles, halos, cascos, sombras, chulloDe, colores: cols };
    cabezas = Array.from({ length: n }, () => ({ x: 0, y: 0, z: 0 }));
  };

  /* ---------------------------------------------------------------- el haz, las luciérnagas y las ramitas */
  const hazMat = B.add(new MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false }));
  const hazInMat = B.add(new MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false }));
  const hazGeo = B.add(new CylinderGeometry(0.35, 1, 1, 18, 1, true));
  const haz = new Mesh(hazGeo, hazMat);
  const hazIn = new Mesh(hazGeo, hazInMat);
  haz.renderOrder = hazIn.renderOrder = 2;
  haz.frustumCulled = hazIn.frustumCulled = false;
  const spotGeo = B.add(new CircleGeometry(1, 24));
  spotGeo.rotateX(-Math.PI / 2);
  const spotMat = B.add(new MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const spot = new Mesh(spotGeo, spotMat);
  spot.renderOrder = 2;
  spot.frustumCulled = false;
  escena.add(haz, hazIn, spot);
  const qHaz = new Quaternion();
  const vArriba = new Vector3(0, 1, 0);

  const bichosMax = 26;
  const bichos = new Instancias(B.add(new SphereGeometry(1, 6, 4)), B.add(new MeshBasicMaterial({ color: 0xeaff9a })), bichosMax, B);
  bichos.usar(bichosMax);
  // El resplandor de cada luciérnaga: una esfera más grande y translúcida en el mismo lugar.
  const bichosHalo = new Instancias(B.add(new SphereGeometry(1, 6, 4)), B.add(new MeshBasicMaterial({ color: 0xc8ff5a, transparent: true, opacity: 0.22, depthWrite: false })), bichosMax, B);
  bichosHalo.usar(bichosMax);
  bichosHalo.malla.renderOrder = 1;
  escena.add(bichos.malla, bichosHalo.malla);

  const ramas = new Instancias(caja(0.22, 0.03, 0.03), mat.plano(0xd9b27a), 64, B);
  const astillas = new Instancias(caja(0.1, 0.025, 0.025), B.add(new MeshBasicMaterial({ color: 0xffffff })), 192, B);
  ramas.usar(0);
  astillas.usar(0);
  escena.add(ramas.malla, astillas.malla);

  /* ---------------------------------------------------------------- el cuadro */
  const dirHaz = new Vector3();
  const centroLuz = new Vector3();
  // Matrices de trabajo: nada se crea dentro del cuadro.
  const mBase = new Matrix4();
  const mLocal = new Matrix4();
  const mPierna = new Matrix4();
  const mBrazo = new Matrix4();
  const mAux = new Matrix4();
  const qID = new Quaternion();
  const eul = new Euler();
  const vp = new Vector3();
  const vs = new Vector3();
  const qq = new Quaternion();

  /** Pone una parte: la matriz de la persona por la local (posición, giros, escala). */
  const parte = (inst: Instancias, i: number, base: Matrix4, out: Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number, sx = 1, sy = 1, sz = 1): Matrix4 => {
    eul.set(rx, ry, rz);
    mLocal.compose(vp.set(px, py, pz), qq.setFromEuler(eul), vs.set(sx, sy, sz));
    out.multiplyMatrices(base, mLocal);
    inst.malla.setMatrixAt(i, out);
    return out;
  };
  /** Una parte colgada de otra (el pie de la pierna, la mano del brazo). */
  const colgada = (inst: Instancias, i: number, padre: Matrix4, px: number, py: number, pz: number, sy = 1): void => {
    mLocal.compose(vp.set(px, py, pz), qID, vs.set(1, sy, 1));
    mAux.multiplyMatrices(padre, mLocal);
    inst.malla.setMatrixAt(i, mAux);
  };

  return {
    frame(e) {
      const g = e.geo;
      if (!fijo || !geoFijo || geoFijo.mitad !== g.mitad || geoFijo.cuerpo !== g.cuerpo || geoFijo.alto !== g.alto || geoFijo.yH !== g.yH) sinAzarDeTres(() => armarFijo(g));
      if (!gente) sinAzarDeTres(() => armarGente(e));
      const G = gente!;
      if (motor.auditoria) {
        // Lo que dibujó el cuadro anterior: llamadas y triángulos (las mide el auditor de rendimiento).
        const a = motor.auditoria as unknown as Record<string, number>;
        a.llamadas = motor.renderer.info.render.calls;
        a.triangulos = motor.renderer.info.render.triangles;
        a.maxLlamadas = Math.max(a.maxLlamadas ?? 0, a.llamadas);
      }
      const dH = alturaExtra({ t: e.t, oscuro: e.oscuro, ultimo: e.ultimo, tau: e.tau, retrato: g.retrato });
      const cam = camaraDe(e, e.cam, g, mapa, dH);
      const f = focal(g);
      motor.cuadro(e, PERFIL, (_m, pose) => {
        // La cámara del director del 2D, con la altura de este momento y el recorte como desplazamiento de lente.
        pose.pos = cam.pos;
        pose.mira = cam.mira;
        pose.fov = cam.fov;
        pose.giro = cam.giro;
        motor.camara.setViewOffset(cam.lente.fullW, cam.lente.fullH, cam.lente.x, cam.lente.y, cam.lente.w, cam.lente.h);

        /* ----- el cielo, el alba y las luces */
        const alba = e.alba;
        pintarCielo(alba);
        domo.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
        estMat.opacity = 0.7 * (1 - alba);
        estrellas.visible = alba < 0.98;
        // La luna y el sol, a la altura y al costado que les da el 2D (ángulos desde el horizonte).
        const cielo = g.alto * (g.retrato ? 0.3 : 0.33);
        const elLuna = (cielo * (0.72 - 0.4 * alba)) / f;
        const rLuna = (g.alto * 0.055) / f;
        sobreElDomo(luna, (0.3 * e.w) / f, elLuna, rLuna);
        sobreElDomo(lunaHalo, (0.3 * e.w) / f, elLuna, rLuna * 2.2);
        luna.visible = lunaHalo.visible = alba < 0.98;
        lunaMat.opacity = 1 - alba;
        const s = e.tau >= 0 ? suave(e.tau / 2.2) : 0;
        const mostrarSol = e.tau >= 0 || alba > 0.3;
        sol.visible = mostrarSol;
        const elSol = ((0.12 * s - 0.05) * g.alto) / f;
        const rSol = (g.alto * 0.09) / f;
        sobreElDomo(sol, 0, elSol, rSol);
        solMat.opacity = s;
        solHalos.forEach((h, j) => {
          h.malla.visible = mostrarSol;
          sobreElDomo(h.malla, 0, elSol, rSol * h.m);
          (h.malla.material as MeshBasicMaterial).opacity = (HALOS[j] ?? 0.1) * s;
        });
        // La luz: la luna, y con el alba el sol bajo detrás del palo, que echa las sombras hacia la sala.
        const golpe = e.tau < 0 ? 1 : 1 - 0.35 * suave(e.tau / 0.25) + 0.2 * suave((e.tau - 1.5) / 1);
        const L = (1 - 0.8 * e.oscuro) * golpe;
        const aSol = suave((alba - 0.35) / 0.65);
        hemi.intensity = P.hemiFuerza * L;
        hemi.color.copy(cHemiNoche).lerp(cHemiDia, aSol);
        hemi.groundColor.copy(cSuelo).lerp(cSueloDia, aSol);
        luz.intensity = lerp(P.luzFuerza, 1.5, aSol) * L;
        luz.color.copy(cLuna).lerp(cSol, aSol);
        dirHaz.copy(lunaDir).lerp(solDir, aSol).normalize();
        centroLuz.set(0, 0, zPaloM * 0.4);
        luz.target.position.copy(centroLuz);
        luz.position.copy(centroLuz).addScaledVector(dirHaz, 220 * K);

        /* ----- la gente */
        const nGente = Math.min(n, e.gente.length);
        const conContorno = nGente <= 60 && motor.ajustes.nivel !== "baja";
        const estira = 1 + 5.5 * suave((alba - 0.5) / 0.5);
        let haloGanador = false;
        focoGana.intensity = 0;
        for (let i = 0; i < nGente; i++) {
          const p = e.gente[i]!;
          const [X, , Z] = colocar(mapa, g, p.x, p.z);
          // Con el golpe, quien gana crece casi la mitad y su disco de luz se agranda: la sala la tiene que encontrar sin buscarla.
          const gana = e.tau >= 0 && i === e.ganador ? suave(e.tau / 0.6) : 0;
          const esc = (completa ? 1.1 : 1) * (1 + 0.45 * gana);
          mBase.compose(vp.set(X, 0, Z), qID, vs.setScalar(K * esc));
          if (gana > 0) {
            focoGana.position.set(X, 1.7 * K * esc, Z + 1.3 * K);
            focoGana.intensity = 6 * K * K * gana;
          }
          const dy = -p.torsoDy;
          const sit = p.sentado;
          const hipY = 0.5 + dy;
          // Las piernas: el paso del 2D; sentada, estiradas hacia adelante.
          if (completa) {
            for (let l = 0; l < 2; l++) {
              const ang = (l === 0 ? p.piernaI : p.piernaD) * (1 - sit) + 1.45 * sit;
              const esc = l === 0 ? p.escPiernaI : 1;
              parte(G.piernas, 2 * i + l, mBase, mPierna, l === 0 ? -0.09 : 0.09, hipY, 0, ang, 0, 0, 1, esc, 1);
            }
          } else {
            parte(G.piernas, i, mBase, mPierna, 0, hipY, 0, p.piernaI * (1 - sit) + 1.45 * sit, 0, 0, 1, p.escPiernaI, 1);
          }
          // El torso, que acompaña el paso y se inclina al tambalear.
          parte(G.torsos, i, mBase, mAux, 0, 0.67 + dy, 0, 0, 0, -p.torsoRot);
          // Los brazos: al compás (adelante y atrás), arriba al festejar, abrazando las rodillas al sentarse.
          for (let l = 0; l < 2; l++) {
            const a = l === 0 ? p.brazoI : p.brazoD;
            const arriba = c01((Math.abs(a) - 1.2) / 0.8);
            parte(G.brazos, 2 * i + l, mBase, mBrazo, l === 0 ? -0.21 : 0.21, 0.8 + dy, 0, lerp(-a, 0.6, sit) * (1 - arriba), 0, -a * arriba);
            if (completa) colgada(G.manos, 2 * i + l, mBrazo, 0, -0.37, 0);
            // El farolito, colgado de la mano derecha.
            if (l === 1) colgada(G.faroles, i, mBrazo, 0, -0.42, -0.03);
          }
          // La cabeza, el pelo y el chullo.
          parte(G.cabezas, i, mBase, mAux, 0, 1.0 + dy, 0, 0, 0, -p.torsoRot * 0.5);
          if (completa) parte(G.pelos, i, mBase, mAux, 0, 1.035 + dy, 0.03, 0, 0, -p.torsoRot * 0.5, 1, 0.82, 1.04);
          const kc = G.chulloDe[i] as number;
          if (kc >= 0) parte(G.chullos, kc, mBase, mAux, 0, 1.1 + dy, 0.01, 0, 0, -p.torsoRot * 0.5);
          // El disco de luz del farolito en el piso: igual para todos los que siguen de pie.
          if (completa) parte(G.halos, i, mBase, mAux, 0.12, 0.02, 0, 0, 0, 0, 1 + 1.6 * gana, 1, 1 + 1.6 * gana);
          else if (gana > 0) {
            parte(G.halos, 0, mBase, mAux, 0.12, 0.02, 0, 0, 0, 0, 1 + 1.6 * gana, 1, 1 + 1.6 * gana);
            haloGanador = true;
          }
          // La sombra: un óvalo duro que con el sol bajo se estira hacia la sala.
          G.sombras.poner(i, X, Z + 0.07 * K * (estira - 1) * 0.9, 0.3 * K * (completa ? 1.1 : 1), 0.07 * K * estira);
          const c = cabezas[i]!;
          c.x = X;
          // La ficha va sobre la coronilla (con el crecimiento de quien gana), nunca encima de la cara.
          c.y = (1.2 + dy) * K * esc;
          c.z = Z;
        }
        G.sombras.usar(nGente);
        G.sombras.fin();
        if (!completa) G.halos.usar(haloGanador ? 1 : 0);
        for (const inst of [G.piernas, G.torsos, G.brazos, G.manos, G.cabezas, G.pelos, G.chullos, G.faroles, G.halos]) inst.fin();
        // El contorno de tinta de las figuras, mientras no sean demasiadas.
        G.cascos[0]!.count = conContorno ? (completa ? 2 : 1) * nGente : 0;
        G.cascos[1]!.count = conContorno ? nGente : 0;
        G.cascos[2]!.count = conContorno ? 2 * nGente : 0;
        G.cascos[3]!.count = conContorno ? nGente : 0;
        // Quien gana, con su color pleno: solo desde el golpe, cuando el 2D lo dice.
        if (e.ganador !== ganadorMarcado) {
          const w = e.ganador;
          if (w >= 0 && w < n) {
            cTmp.setHex(G.colores[w] ?? AMARILLO).lerp(cBlanco, 0.1).multiplyScalar(1.25);
            G.torsos.malla.setColorAt(w, cTmp);
            G.brazos.malla.setColorAt(2 * w, cTmp);
            G.brazos.malla.setColorAt(2 * w + 1, cTmp);
            for (const m of [G.torsos, G.brazos]) if (m.malla.instanceColor) m.malla.instanceColor.needsUpdate = true;
          }
          ganadorMarcado = e.ganador;
        }

        /* ----- el palo: los ojos y la mirada */
        const ab = e.ojos;
        const cerrados = ab < 0.04;
        const r = palo.r * K;
        for (let l = 0; l < 2; l++) {
          const j = ojos[l]!;
          const lado = l === 0 ? -1 : 1;
          j.disco.visible = j.pupila.visible = !cerrados;
          j.halo.visible = j.halo2.visible = !cerrados;
          const hs = Math.sqrt(ab);
          j.halo.scale.setScalar(r * (1.5 + 0.7 * ab) * hs);
          j.halo2.scale.setScalar(r * (2.3 + 1.2 * ab) * hs);
          j.rendija.visible = cerrados;
          j.disco.scale.set(r * 1.1, r * (0.12 + 0.98 * ab), 1);
          j.pupila.scale.set(r * 0.38, r * (0.1 + 0.38 * ab), 1);
          j.pupila.position.x = lado * palo.ojosX * K + Math.max(-1, Math.min(1, e.pupila)) * r * 0.3;
          j.pupila.position.z = j.disco.position.z + 0.03 * K;
          j.rendija.scale.set(r * 1.6, Math.max(0.01 * K, r * 0.22), 0.01 * K);
        }
        const mira = e.mira;
        const aH = mira && ab > 0.02 && e.tau < 0 ? ab : 0;
        hazMat.opacity = 0.11 * aH;
        hazInMat.opacity = 0.1 * aH;
        spotMat.opacity = 0.2 * aH;
        haz.visible = hazIn.visible = spot.visible = aH > 0;
        const hw = mitadEnCuerpos(g);
        if (mira && aH > 0) {
          const [sx, , sz] = colocar(mapa, g, mira.x, mira.z);
          const ex = 0, ey = palo.ojosY * K, ez = palo.ojosZ * K;
          const ancho = 0.17 * hw * 1.5 * K;
          dirHaz.set(ex - sx, ey, ez - sz);
          const largo = dirHaz.length();
          dirHaz.normalize();
          qHaz.setFromUnitVectors(vArriba, dirHaz);
          for (const [m, k] of [[haz, 1.3], [hazIn, 0.6]] as const) {
            m.position.set((ex + sx) / 2, ey / 2, (ez + sz) / 2);
            m.quaternion.copy(qHaz);
            m.scale.set(ancho * k, largo, ancho * k);
          }
          spot.position.set(sx, 0.03 * K, sz);
          spot.scale.set(ancho * 1.4, 1, ancho * 0.7);
        }

        /* ----- las luciérnagas */
        const nb = n > 64 ? 14 : bichosMax;
        bichos.usar(nb);
        bichosHalo.usar(n > 64 ? 0 : nb);
        for (let i = 0; i < nb; i++) {
          const z = hashDe(i, 61) * 0.9;
          const x = (hashDe(i, 62) - 0.5) * 3 * hw + Math.sin(e.t * 0.7 + i * 2) * 0.12;
          const y = 0.5 + hashDe(i, 63) * 1.4 + Math.cos(e.t * 0.9 + i) * 0.08;
          const pulso = (0.25 + 0.75 * Math.max(0, Math.sin(e.t * (1 + hashDe(i, 64)) + i * 3))) * (1 - alba);
          const [bx, , bz] = colocar(mapa, g, x / hw, z);
          bichos.poner(i, bx, y * K, bz, 0.05 * K * pulso);
          bichosHalo.poner(i, bx, y * K, bz, 0.15 * K * pulso);
        }
        bichos.fin();
        bichosHalo.fin();

        /* ----- la ramita que se parte y sus astillas */
        let nr = 0;
        let na = 0;
        const vis = Math.max(0, Math.min(6, Math.round(6 * motor.ajustes.particulas)));
        for (const c of e.cracs) {
          if (nr >= 62 || na + vis > 190) break;
          const [cx, , cz] = colocar(mapa, g, c.x, c.z);
          const f2 = 1 - c.dt / 0.55;
          const sep = (0.1 + c.dt * 0.6) * K;
          for (const lado of [-1, 1]) ramas.poner(nr++, cx + lado * sep, 0.05 * K, cz, f2 * K, f2 * K, f2 * K, lado * c.dt * 2);
          for (let r2 = 0; r2 < vis; r2++) {
            const an = (r2 / 6) * Math.PI * 2 + hashDe(c.i, r2) * 6;
            const rr = (0.12 + 0.5 * c.dt) * K;
            astillas.poner(na++, cx + Math.cos(an) * rr, (0.1 + 0.55 * c.dt * (1 - c.dt)) * K, cz + Math.sin(an) * rr * 0.6, f2 * K, f2 * K, f2 * K, an);
          }
        }
        ramas.usar(nr);
        astillas.usar(na);
        ramas.fin();
        astillas.fin();

        if (motor.auditoria) {
          motor.auditoria.puestos.length = 0;
          for (let i = 0; i < nGente; i++) {
            const [px, , pz] = colocar(mapa, g, e.gente[i]!.x, e.gente[i]!.z);
            motor.auditoria.puestos.push({ persona: i, x: px, z: pz });
          }
        }
      });
    },
    pantallaDe(id) {
      const c = cabezas[id];
      if (!c) return null;
      return motor.pantalla([c.x, c.y, c.z], [c.x, 0, c.z]);
    },
    destruir() {
      fijoBasura.vaciar();
    },
  };
};

export const montaje = definir3D(fabrica);

/** Lo que `registro.ts` busca: el Guajojó aparece en 3D sin editar ningún otro archivo compartido. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/guajojo");
  return (names, winners, beacon, done) => m.guajojoPixi3D(montaje)(names, winners, beacon, done);
};
