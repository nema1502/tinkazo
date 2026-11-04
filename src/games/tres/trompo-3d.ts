import {
  BoxGeometry, CanvasTexture, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Fog, Group,
  IcosahedronGeometry, LatheGeometry, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, PointsMaterial, Quaternion,
  RingGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector2, Vector3, BufferGeometry, type Material,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { perfil } from "./camara";
import { crearAmbiente, esparcirPorHash, Rafagas, SombrasDeContacto, type Ambiente } from "./escena";
import { Instancias, Materiales, crearGeometrias, crearPersona, type PersonaRig } from "./figuras";
import { hash } from "./ids";
import { definir3D } from "./motor";
import type { EntradaBase, Fabrica3D, Lanzador } from "./tipos";

/**
 * El trompo en 3D (`?motor=3d`). Dibuja lo que `pixi/trompo.ts` ya decidió: dónde está cada trompo, cuánto cabecea,
 * cuándo lo golpean, quién sale volando. No calcula nada del juego (src/games/tres/README.md).
 *
 * Todo el mundo fijo (la tierra, el ruedo de tiza, las piedritas, la rayuela, los chicos que miran) vive en un grupo
 * a la escala del ruedo: medido en radios del ruedo, igual que la física del 2D. Así no hay nada que rearmar cuando
 * cambia el tamaño de la pantalla: el grupo se corre y se agranda. Los trompos, en cambio, se ponen con el mapa de la
 * casa (`mapa.a3D`), que es lo que comprueba la prueba de igualdad.
 *
 * Los 200 trompos entran en siete mallas instanciadas (punta, cuerpo, banda, tapa, perilla, marcas y cuerda), con el
 * color por instancia: siete dibujos, sin importar cuántos sean.
 */

/** El ruedo del 2D es una elipse aplastada a este alto (`SQUASH` en `pixi/trompo.ts`): el 3D la estira para que sea un círculo de verdad. */
export const APLASTADO_2D = 0.55;
/** El borde de la tiza, en radios del ruedo (`LIM` en `pixi/trompo.ts`). */
export const LIM_RUEDO = 0.9;

/** Cómo se mira: a la misma altura de cámara que el 2D (el ruedo se ve con el mismo alto en la pantalla) y con perspectiva. */
export const PERFIL_TROMPO = perfil({ elevacion: Math.asin(APLASTADO_2D), azimut: 0, zc: 1 / APLASTADO_2D, fov: (38 * Math.PI) / 180, acerca: 1, tam: 1 });

/** Un trompo tal como el 2D lo dejó en este cuadro. Todo en píxeles del mundo 2D, salvo lo que dice. */
export interface TrompoEntrada {
  id: number;
  visible: boolean;
  /** Dónde toca el piso. */
  x: number;
  y: number;
  /** Cuánto se levantó del piso (el que sale volando) y cuánto viene hacia la cámara (el que acaba de tirarse). */
  alto: number;
  adelante: number;
  /** La inclinación de su eje en el plano de la pantalla, en radianes: el cabeceo y el que se cae. */
  inclinacion: number;
  /** El aplastón del golpe y el agrandado de la coronación, respecto de su tamaño. */
  sx: number;
  sy: number;
  /** De 0 a 1: se apaga al irse. */
  opacidad: number;
  /** De 0 a 1: el destello blanco de un golpe. */
  destello: number;
  /** La fase del giro, en radianes. */
  giro: number;
  color: number;
}

/** Un golpe, para el polvo, las chispas, la onda y la estrella. `x` e `y`, en radios del ruedo desde su centro (la física del 2D). */
export interface ImpactoEntrada {
  x: number;
  y: number;
  /** Segundos desde el golpe (en la hora de los efectos, que no se frena). */
  edad: number;
  pow: number;
  /** 0 un roce, 1 un golpe, 2 un golpe con parada, 3 un choque del mano a mano. */
  tier: 0 | 1 | 2 | 3;
  seed: number;
  /** La dirección del golpe, en el disco del ruedo. */
  nx: number;
  ny: number;
}

/** Una nube de polvo; `x` e `y`, en radios del ruedo desde su centro. */
export interface PolvoEntrada {
  x: number;
  y: number;
  edad: number;
  pow: number;
  seed: number;
}

export interface EntradaTrompo extends EntradaBase {
  /** El ruedo: dónde está su centro y cuánto mide su radio, en píxeles del mundo 2D. */
  ruedo: { cx: number; cy: number; r: number };
  /** El radio con el que chocan los trompos, en píxeles. */
  radio: number;
  trompos: TrompoEntrada[];
  impactos: ImpactoEntrada[];
  polvos: PolvoEntrada[];
  /** Quién gana (para su aura en la coronación) y qué tanto va la coronación, de 0 a 1. */
  ganadora: number;
  corona: number;
}

const lighten = (c: number, f: number): number => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const m = (v: number): number => Math.round(v + (255 - v) * f);
  return (m(r) << 16) | (m(g) << 8) | m(b);
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const outCubic = (p: number): number => 1 - Math.pow(1 - p, 3);
const outBack = (p: number): number => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

/** El perfil del cuerpo de un trompo: radio y altura sobre la punta, para un trompo de radio 1. */
const CUERPO: readonly [number, number][] = [[0.08, 0.4], [0.34, 0.66], [0.62, 0.96], [0.85, 1.26], [0.98, 1.5], [1.0, 1.62]];
const radioEn = (y: number): number => {
  for (let i = 1; i < CUERPO.length; i++) {
    const [r0, y0] = CUERPO[i - 1] as [number, number], [r1, y1] = CUERPO[i] as [number, number];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 1;
};
/** Lo que mide de alto un trompo de radio 1, hasta la perilla. */
const ALTO_TROMPO = 1.9;
/** Un trompo de verdad es más alto que ancho: se estira a lo alto. */
const ESTIRADO = 1.4;

interface PiezasTrompo {
  punta: Instancias;
  cuerpo: Instancias;
  banda: Instancias;
  tapa: Instancias;
  perilla: Instancias;
  marcas: Instancias;
  cuerda: Instancias;
  todas: Instancias[];
}

const fabrica: Fabrica3D<EntradaTrompo> = (motor, o) => {
  const B = motor.basura;
  const oscuro = o.tema === "oscuro";
  const g = crearGeometrias(B);
  const mat = new Materiales(B);

  // Lo que depende del equipo y de cuántos son se arma en el primer cuadro.
  let amb: Ambiente | null = null;
  let mundo: Group | null = null;
  let tops: PiezasTrompo | null = null;
  let sombras: SombrasDeContacto | null = null;
  let polvo: Rafagas | null = null;
  let chispas: Rafagas | null = null;
  const vistos = new Set<string>();
  const ondas: Mesh[] = [];
  const estrellas: Sprite[] = [];
  let aura: Mesh | null = null;
  let chicos: { rig: PersonaRig; ang: number; fase: number }[] = [];
  let hijosFx: Group | null = null;
  const cabezas = new Map<number, { cabeza: [number, number, number]; pie: [number, number, number] }>();

  /* ------------------------------------------------------------ las piezas de un trompo */
  const crearTrompos = (n: number): PiezasTrompo => {
    const punta = B.add(new ConeGeometry(0.11, 0.5, 8));
    punta.rotateX(Math.PI);
    punta.translate(0, 0.25, 0);
    const cuerpo = B.add(new LatheGeometry(CUERPO.map(([r, y]) => new Vector2(r, y)), 14));
    const banda = B.add(new CylinderGeometry(0.85, 0.69, 0.2, 14, 1, true));
    banda.translate(0, 1.1, 0);
    const tapa = B.add(new CylinderGeometry(0.97, 0.97, 0.1, 16));
    tapa.translate(0, 1.65, 0);
    const perilla = B.add(new CylinderGeometry(0.14, 0.17, 0.2, 8));
    perilla.translate(0, 1.8, 0);
    const marcas = B.add(unir([0, 1, 2].map((i) => {
      const m = new BoxGeometry(0.16, 0.34, 0.06);
      m.translate(0, 1.12, 0.88);
      m.rotateY((i * Math.PI * 2) / 3);
      return m;
    })));
    const cuerda = B.add(unir([0.6, 0.72, 0.84].map((y) => {
      const c = new CylinderGeometry(radioEn(y + 0.03) + 0.025, radioEn(y - 0.03) + 0.025, 0.06, 14, 1, true);
      c.translate(0, y, 0);
      return c;
    })));
    const m = (c: number, doble = false): MeshLambertMaterial => B.add(new MeshLambertMaterial({ color: c, flatShading: true, side: doble ? DoubleSide : undefined }));
    const mk = (geo: BufferGeometry, material: Material): Instancias => {
      const inst = new Instancias(geo, material, Math.max(1, n), B);
      inst.malla.castShadow = true;
      motor.escena.add(inst.malla);
      return inst;
    };
    const p: PiezasTrompo = {
      punta: mk(punta, m(0x9aa1ad)),
      cuerpo: mk(cuerpo, m(0xffffff)),
      banda: mk(banda, m(0xffffff, true)),
      tapa: mk(tapa, m(0xffffff)),
      perilla: mk(perilla, m(0x16161f)),
      marcas: mk(marcas, m(0x16161f)),
      cuerda: mk(cuerda, m(0xf3ead8, true)),
      todas: [],
    };
    p.todas = [p.punta, p.cuerpo, p.banda, p.tapa, p.perilla, p.marcas, p.cuerda];
    return p;
  };

  /* ------------------------------------------------------------ el mundo fijo, en radios del ruedo */
  const armarMundo = (): Group => {
    const G = new Group();
    motor.escena.add(G);
    const tierra = oscuro ? 0x3a2a1f : 0xe2c29a;
    const suelo = new Mesh(B.add(new PlaneGeometry(60, 60)), B.add(new MeshLambertMaterial({ color: tierra })));
    suelo.rotation.x = -Math.PI / 2;
    suelo.receiveShadow = true;
    G.add(suelo);
    // Adentro del ruedo la tierra está barrida: un poco más clara.
    const barrido = new Mesh(B.add(new CircleGeometry(LIM_RUEDO, 56)), B.add(new MeshLambertMaterial({ color: lighten(tierra, oscuro ? 0.14 : 0.2), polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    barrido.rotation.x = -Math.PI / 2;
    barrido.position.y = 0.004;
    barrido.receiveShadow = true;
    G.add(barrido);
    // La tiza: una tira apenas temblada, y la cruz del medio.
    const tiza = B.add(anillo(LIM_RUEDO, 0.008, 64));
    tiza.computeBoundingSphere();
    const tizaCol = oscuro ? 0xf1ece2 : 0xffffff;
    const marca = new Mesh(tiza, B.add(new MeshBasicMaterial({ color: tizaCol, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    marca.position.y = 0.008;
    G.add(marca);
    for (const ang of [Math.PI / 6, -Math.PI / 6]) {
      const raya = new Mesh(B.add(new PlaneGeometry(0.09, 0.012)), B.add(new MeshBasicMaterial({ color: tizaCol, transparent: true, opacity: 0.7 })));
      raya.rotation.x = -Math.PI / 2;
      raya.rotation.z = ang;
      raya.position.y = 0.009;
      G.add(raya);
    }
    // Piedritas por toda la tierra, menos adentro del ruedo; matas secas más lejos.
    const ico = B.add(new IcosahedronGeometry(1, 0));
    const piedra = B.add(new MeshLambertMaterial({ color: oscuro ? 0x5b4636 : 0xb8946a, flatShading: true }));
    const fuera = (x: number, z: number): boolean => Math.hypot(x, z) < LIM_RUEDO * 1.06;
    const im1 = esparcirPorHash(motor, {
      geo: ico, material: piedra, x0: -9, x1: 9, z0: -9, z1: 9, cantidad: 200, semilla: 3, evitar: fuera,
      ubicar: (r, d, x, z) => { d.position.set(x, 0.01, z); d.scale.set(0.012 + r * 0.03, 0.008 + r * 0.016, 0.012 + r * 0.03); d.rotation.set(r * 3, r * 7, 0); },
    });
    motor.escena.remove(im1);
    G.add(im1);
    const cono = B.add(new ConeGeometry(1, 1, 5));
    const mata = B.add(new MeshLambertMaterial({ color: oscuro ? 0x6b7a3a : 0x9aa84a, flatShading: true }));
    const im2 = esparcirPorHash(motor, {
      geo: cono, material: mata, x0: -14, x1: 14, z0: -14, z1: 14, cantidad: 90, semilla: 9, evitar: (x, z) => Math.hypot(x, z) < 1.45,
      ubicar: (r, d, x, z) => { d.position.set(x, 0.06 + r * 0.04, z); d.scale.set(0.05 + r * 0.04, 0.12 + r * 0.14, 0.05 + r * 0.04); d.rotation.set(0, r * 9, 0); },
    });
    motor.escena.remove(im2);
    G.add(im2);
    // La rayuela dibujada con tiza, a un costado.
    const cx = lienzo(256, 512);
    if (cx) {
      cx.strokeStyle = "rgba(255,255,255,0.78)";
      cx.fillStyle = "rgba(255,255,255,0.78)";
      cx.lineWidth = 7;
      cx.font = "bold 44px monospace";
      cx.textAlign = "center";
      cx.textBaseline = "middle";
      const celdas: [number, number][] = [[1, 7], [1, 6], [0, 5], [2, 5], [1, 4], [0, 3], [2, 3], [1, 2], [1, 1]];
      celdas.slice(0, 8).forEach(([c, f], i) => {
        const w = 84, h = 56, x0 = 8 + c * 86 - (c === 1 ? 0 : 0), y0 = 512 - 8 - (f + 1) * (h + 2);
        cx.strokeRect(x0 + (c === 1 ? 0 : 0), y0, w, h);
        cx.fillText(String(i + 1), x0 + w / 2, y0 + h / 2);
      });
      const t = B.add(new CanvasTexture(cx.canvas));
      t.colorSpace = SRGBColorSpace;
      const ray = new Mesh(B.add(new PlaneGeometry(0.42, 0.84)), B.add(new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false })));
      ray.rotation.x = -Math.PI / 2;
      ray.rotation.z = 0.5;
      ray.position.set(-1.5, 0.006, 0.3);
      G.add(ray);
    }
    return G;
  };

  /** Los chicos que miran el ruedo: de pie en un semicírculo atrás y a los lados, con su fase y su lugar sembrados por hash. */
  const armarChicos = (G: Group): void => {
    const geos = crearGeometrias(B);
    const mats = new Materiales(B);
    const N = 11;
    chicos = [];
    for (let i = 0; i < N; i++) {
      const ang = Math.PI * (1.05 + (0.9 * (i + 0.5)) / N) + (hash(i, 31) - 0.5) * 0.08;
      const rad = 1.3 + hash(i, 32) * 0.2;
      const rig = crearPersona(geos, mats, `chico ${i}`);
      const s = 0.0026 * (0.88 + 0.24 * hash(i, 33));
      rig.raiz.scale.setScalar(s);
      rig.raiz.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad);
      // Mira al centro: el modelo mira a +x.
      rig.raiz.rotation.y = Math.atan2(Math.sin(ang), -Math.cos(ang));
      G.add(rig.raiz);
      chicos.push({ rig, ang, fase: hash(i, 34) * 6.28 });
    }
  };

  /** Una onda en el piso, la estrella del golpe y los destellos: piezas que se reciclan. */
  const armarFx = (G: Group): void => {
    hijosFx = new Group();
    G.add(hijosFx);
    const anilloG = B.add(new RingGeometry(0.9, 1, 40));
    anilloG.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new Mesh(anilloG, B.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide })));
      m.visible = false;
      m.position.y = 0.012;
      G.add(m);
      ondas.push(m);
    }
    const cx = lienzo(128, 128);
    let tex: CanvasTexture | null = null;
    if (cx) {
      const pts: [number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, r = i % 2 ? 26 : 56;
        pts.push([64 + Math.cos(a) * r, 64 + Math.sin(a) * r]);
      }
      cx.beginPath();
      pts.forEach(([x, y], i) => (i ? cx.lineTo(x, y) : cx.moveTo(x, y)));
      cx.closePath();
      cx.lineJoin = "round";
      cx.lineWidth = 9;
      cx.strokeStyle = "#0a0816";
      cx.stroke();
      cx.fillStyle = "#ffc629";
      cx.fill();
      cx.beginPath();
      cx.arc(64, 64, 14, 0, Math.PI * 2);
      cx.fillStyle = "#ffffff";
      cx.fill();
      tex = B.add(new CanvasTexture(cx.canvas));
      tex.colorSpace = SRGBColorSpace;
    }
    for (let i = 0; i < 4; i++) {
      const sm = B.add(new SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
      const sp = new Sprite(sm);
      sp.visible = false;
      sp.renderOrder = 12;
      G.add(sp);
      estrellas.push(sp);
    }
    aura = new Mesh(B.add(new CircleGeometry(1, 32)), B.add(new MeshBasicMaterial({ color: 0xffc629, transparent: true, opacity: 0.35, depthWrite: false })));
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.014;
    aura.visible = false;
    G.add(aura);
  };

  const inicio = (e: EntradaTrompo): void => {
    motor.camara.near = 0.3;
    motor.camara.far = 3000;
    const R3 = 12;
    amb = crearAmbiente(motor, { nieblaCerca: R3 * 5, nieblaLejos: R3 * 26, alcanceSombra: R3 * 1.7, solDesde: [-R3 * 3, R3 * 5, R3 * 3.5] });
    // La luz de un patio: el atardecer en el tema oscuro, el sol de mediodía en el claro (la paleta es la del cielo).
    mundo = armarMundo();
    armarChicos(mundo);
    armarFx(mundo);
    tops = crearTrompos(e.trompos.length);
    sombras = new SombrasDeContacto(motor, e.trompos.length + 1, 0.32);
    // El polvo y las chispas viven en el grupo del ruedo: sus posiciones son radios del ruedo.
    polvo = new Rafagas(motor, { max: 20, porRafaga: 12, color: oscuro ? 0xb89a7c : 0xa07e58, tam: 0.06, vida: 0.7, gravedad: 2, velocidad: 0.5, empujeArriba: 0.12 });
    chispas = new Rafagas(motor, { max: 24, porRafaga: 16, color: 0xffd24d, tam: 0.028, vida: 0.34, gravedad: 12, velocidad: 2.2, empujeArriba: 0.5 });
    for (const r of [polvo, chispas]) {
      motor.escena.remove(r.objeto);
      mundo.add(r.objeto);
    }
  };

  const V = new Vector3(), Q = new Quaternion(), E = new Euler(0, 0, 0, "XZY"), ESC = new Vector3(), POS = new Vector3();
  const M = new Matrix4(), MG = new Matrix4(), MARCAS = new Matrix4();

  return {
    frame(e) {
      motor.cuadro(e, PERFIL_TROMPO, (mapa, pose) => {
        if (!amb) inicio(e);
        if (!amb || !mundo || !tops || !sombras || !polvo || !chispas) return;
        const s = mapa.s;
        const R3 = e.ruedo.r * s;
        const [cx3, , cz3] = mapa.a3D(e.ruedo.cx, e.ruedo.cy);
        mundo.position.set(cx3, 0, cz3);
        mundo.scale.setScalar(R3);
        const fog = motor.escena.fog as Fog | null;
        if (fog) {
          fog.near = R3 * 5;
          fog.far = R3 * 26;
        }
        for (const r of [polvo, chispas]) (r.objeto.material as PointsMaterial).size = (r === polvo ? 0.07 : 0.03) * R3;
        const sm = e.radio * s * 0.78;
        const mapaSombras = motor.ajustes.sombras === "mapa";
        sombras.usar(mapaSombras ? 0 : e.trompos.length);
        let n = 0;
        cabezas.clear();
        for (const t of e.trompos) {
          const i = n++;
          const apagado = !t.visible || t.opacidad <= 0.01;
          if (apagado) {
            // Fuera de escena: una matriz sin tamaño.
            M.makeScale(0, 0, 0);
            for (const p of tops.todas) p.ponerMatriz(i, M, 0xffffff);
            sombras.poner(i, 0, 0, 0);
            continue;
          }
          const w = mapa.a3D(t.x, t.y + t.adelante, t.alto);
          const inc = t.inclinacion;
          const acostado = clamp((Math.abs(inc) - 0.5) / 0.95, 0, 1);
          // El eje cabecea de costado (lo que decide el 2D) y, un poco, hacia la cámara y de vuelta: se ve en profundidad.
          const prec = 0.5 * Math.abs(inc) * Math.cos(e.t * 7 + t.id * 2.1) * (1 - clamp((Math.abs(inc) - 0.4) / 0.4, 0, 1));
          E.set(prec, 0, -inc);
          Q.setFromEuler(E);
          const k = sm * Math.sqrt(clamp(t.opacidad, 0, 1));
          // El agrandado de la coronación se atempera: el trompo es más alto que el dibujo del 2D y taparía el cartel.
          const sx = t.sx > 1 ? 1 + (t.sx - 1) * 0.35 : t.sx, sy = t.sy > 1 ? 1 + (t.sy - 1) * 0.35 : t.sy;
          ESC.set(k * sx, k * sy * ESTIRADO, k * sx);
          // Acostado, el cuerpo descansa sobre su costado y no se hunde en la tierra.
          POS.set(w[0], w[1] + 0.9 * k * acostado, w[2]);
          M.compose(POS, Q, ESC);
          MARCAS.makeRotationY(t.giro);
          MG.multiplyMatrices(M, MARCAS);
          tops.punta.ponerMatriz(i, M);
          tops.cuerpo.ponerMatriz(i, M);
          tops.banda.ponerMatriz(i, M);
          tops.tapa.ponerMatriz(i, M);
          tops.perilla.ponerMatriz(i, M);
          tops.cuerda.ponerMatriz(i, M);
          tops.marcas.ponerMatriz(i, MG);
          tops.cuerpo.ponerColorMezclado(i, t.color, t.destello);
          tops.banda.ponerColorMezclado(i, lighten(t.color, 0.55), t.destello);
          tops.tapa.ponerColorMezclado(i, lighten(t.color, 0.3), t.destello);
          // La sombra se queda en el piso y se achica con la altura.
          const alt = t.alto / Math.max(1, e.ruedo.r);
          const sc = (k * 0.95) / (1 + alt * 6);
          sombras.poner(i, w[0] + acostado * k * (inc > 0 ? 0.7 : -0.7), w[2], sc * (1 + 0.6 * acostado), sc);
          cabezas.set(t.id, {
            cabeza: [w[0] + ALTO_TROMPO * ESTIRADO * k * Math.sin(-inc) * 0, w[1] + ALTO_TROMPO * ESTIRADO * k * Math.cos(inc) + 0.05 * k, w[2]],
            pie: [w[0], w[1], w[2]],
          });
        }
        for (const p of tops.todas) {
          p.usar(n);
          p.fin();
        }
        sombras.fin();

        // El aura de la ganadora en la coronación.
        if (aura) {
          const gan = e.trompos.find((t) => t.id === e.ganadora);
          const gk = e.corona > 0 && gan ? outBack(clamp(e.corona, 0, 1)) : 0;
          aura.visible = gk > 0 && !!gan;
          if (aura.visible && gan) {
            const dx = (gan.x - e.ruedo.cx) / e.ruedo.r, dz = (gan.y - e.ruedo.cy) / (e.ruedo.r * APLASTADO_2D);
            aura.position.set(dx, 0.014, dz);
            aura.scale.setScalar(((e.radio * 0.95) / e.ruedo.r) * (0.9 + 0.7 * gk) * 1.15);
          }
        }

        // Los golpes: polvo, chispas, la onda en el piso y la estrella.
        for (const p of e.polvos) {
          const clave = `p${p.seed}:${Math.round((e.t - p.edad) * 100)}`;
          if (vistos.has(clave)) continue;
          vistos.add(clave);
          polvo.emitir(e.t - p.edad, p.x, 0.02, p.y, 0.6 + 0.8 * p.pow);
        }
        let onda = 0, estrella = 0;
        const rr = e.radio / e.ruedo.r;
        for (const im of e.impactos) {
          const dx = im.x, dz = im.y;
          const clave = `i${im.seed}:${Math.round((e.t - im.edad) * 100)}`;
          if (!vistos.has(clave)) {
            vistos.add(clave);
            chispas.emitir(e.t - im.edad, dx, rr * 0.9, dz, (im.tier === 0 ? 0.5 : 0.8) + 0.5 * im.pow + (im.tier === 3 ? 0.6 : 0));
          }
          if (im.tier >= 1 && im.edad < 0.4 && onda < ondas.length) {
            const p = im.edad / 0.4;
            const rx = rr * (0.4 + (im.tier === 3 ? 3.2 : im.tier === 2 ? 2.4 : 1.6) * outCubic(p));
            const m = ondas[onda++] as Mesh;
            m.visible = true;
            m.position.set(dx, 0.012, dz);
            m.scale.set(rx, 1, rx);
            (m.material as MeshBasicMaterial).opacity = 0.8 * (1 - p);
          }
          if (im.tier >= 1 && im.edad < 0.22 && estrella < estrellas.length) {
            const sp = estrellas[estrella++] as Sprite;
            const k = im.edad < 0.05 ? outBack(im.edad / 0.05) : 1 - (clamp((im.edad - 0.05) / 0.17, 0, 1) < 0.5 ? 4 * Math.pow(clamp((im.edad - 0.05) / 0.17, 0, 1), 3) : 1 - Math.pow(-2 * clamp((im.edad - 0.05) / 0.17, 0, 1) + 2, 3) / 2);
            const R0 = rr * (0.9 + 0.7 * im.pow) * (im.tier === 3 ? 1.7 : im.tier === 2 ? 1.3 : 1) * Math.max(0, k) * 1.6;
            sp.visible = R0 > 0.001;
            sp.position.set(dx, rr * 1.0, dz);
            sp.scale.set(R0, R0, 1);
          }
        }
        for (let i = onda; i < ondas.length; i++) (ondas[i] as Mesh).visible = false;
        for (let i = estrella; i < estrellas.length; i++) (estrellas[i] as Sprite).visible = false;
        polvo.actualizar(e.t);
        chispas.actualizar(e.t);
        if (vistos.size > 400) vistos.clear();

        // Los chicos: se asoman un poco, y con la coronación saltan con los brazos arriba.
        for (const c of chicos) {
          const fest = clamp(e.corona * 1.5, 0, 1);
          c.rig.poner(e.t * 5 + c.fase, 0, fest);
          c.rig.raiz.position.y = Math.max(0, Math.sin(e.t * 7 + c.fase)) * 0.03 * fest;
        }

        amb.seguir(pose);
      });
    },
    pantallaDe(id) {
      const c = cabezas.get(id);
      return c ? motor.pantalla(c.cabeza, c.pie) : null;
    },
    destruir() {
      cabezas.clear();
      vistos.clear();
    },
  };
};

/** Una tira de tiza: un anillo de radio `R` con el ancho de la línea y un tembleque sembrado, en `n` tramos. */
function anillo(R: number, medio: number, n: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const j = 1 + (hash(i % n, 5) - 0.5) * 0.02;
    for (const d of [-medio, medio]) pos.push(Math.cos(a) * (R * j + d), 0, Math.sin(a) * (R * j + d));
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Junta varias geometrías en una. */
function unir(gs: BufferGeometry[]): BufferGeometry {
  const m = mergeGeometries(gs);
  if (!m) throw new Error("no se pudieron unir las piezas del trompo");
  return m;
}

function lienzo(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d");
}

/** La vista que `pixi/trompo.ts` recibe como quinto parámetro. */
export const montaje = definir3D(fabrica);

/** Lo que busca `registro.ts`: el trompo en 3D aparece solo, sin editar ningún archivo compartido. */
export const lanzador3D = async (): Promise<Lanzador> => {
  const m = await import("../pixi/trompo");
  return (names, winners, beacon, done) => m.trompoPixi(names, winners, beacon, done, montaje);
};
