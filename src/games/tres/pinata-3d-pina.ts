import {
  BoxGeometry, ConeGeometry, Color, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, Object3D, PlaneGeometry, SphereGeometry,
} from "three";
import { hash } from "./ids";
import { ACENTOS, coloresPicos, contorno, entre, type Ctx } from "./pinata-3d-piezas";

/**
 * La piñata: la olla facetada con sus cinco franjas de papel de china, los siete picos con sus flecos, las grietas que
 * crecen con cada palo y la cuerda. Y su rotura: la olla en ocho gajos, los siete picos que salen volando y la lluvia de
 * papel. Todo en píxeles del dibujo del 2D, con la olla de radio 1 (el grupo se escala por `R`).
 */

const GRAV = 1500;
const PAPEL_MAX = 240;

export interface Pina {
  /** Pone la piñata (si se ve) y su cuerda. `(x, y)` es el centro de la olla en el escenario; `cx, cy` de dónde cuelga. */
  poner(o: { ver: boolean; x: number; y: number; z: number; R: number; escX: number; escY: number; rot: number; grietas: number; t: number; cx: number; cy: number; cz: number; k: number; comp: number }): void;
}

export function crearPina(c: Ctx): Pina {
  const { B, tema, escenario, mat } = c;
  const [mag, nar, , ama] = ACENTOS[tema];
  const picos = coloresPicos(tema);
  const d = new Object3D();
  const col = new Color();

  const grupo = new Group();
  const giro = new Group();
  grupo.add(giro);
  escenario.add(grupo);

  // La olla: un icosaedro de detalle 1, facetado, se ve hecho a mano.
  const olla = new Mesh(B.add(new IcosahedronGeometry(1, 1)), mat.plano(nar));
  contorno(c, olla, 1.05);
  giro.add(olla);

  // Las cinco franjas, anillos finos de doce lados: magenta y amarillo como en el 2D.
  const matFranja = B.add(new MeshLambertMaterial({ flatShading: true }));
  const franjas = new InstancedMesh(B.add(new CylinderGeometry(1, 1, 0.16, 12, 1, true)), matFranja, 5);
  for (let b = -2; b <= 2; b++) {
    const y = b * 0.38;
    const r = Math.sqrt(Math.max(0.05, 1 - y * y)) * 1.012 + 0.012;
    d.position.set(0, y, 0);
    d.rotation.set(0, 0, 0);
    d.scale.set(r, 1, r);
    d.updateMatrix();
    franjas.setMatrixAt(b + 2, d.matrix);
    franjas.setColorAt(b + 2, col.setHex(b % 2 !== 0 ? ama : mag));
  }
  franjas.frustumCulled = false;
  B.add({ dispose: () => franjas.dispose() });
  giro.add(franjas);

  // Los siete picos, en el plano de la pantalla y apenas inclinados hacia la cámara.
  const geoPico = B.add(new ConeGeometry(0.34, 0.97, 6, 1));
  geoPico.translate(0, 0.485, 0);
  const matPico = B.add(new MeshLambertMaterial({ flatShading: true }));
  const pinchos = new InstancedMesh(geoPico, matPico, 7);
  const contornoPicos = new InstancedMesh(geoPico, c.tinta, 7);
  const flecos = new InstancedMesh(B.add(new BoxGeometry(1, 1, 1)), matPico, 21);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
    const dx = Math.cos(a), dy = -Math.sin(a);
    d.position.set(dx * 0.78, dy * 0.78, 0);
    d.rotation.order = "ZXY";
    d.rotation.set(0.18, 0, -a - Math.PI / 2);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    pinchos.setMatrixAt(i, d.matrix);
    pinchos.setColorAt(i, col.setHex(picos[i] as number));
    d.scale.set(1.14, 1.1, 1.14);
    d.updateMatrix();
    contornoPicos.setMatrixAt(i, d.matrix);
    for (let f = 0; f < 3; f++) {
      d.rotation.order = "XYZ";
      d.rotation.set(0, 0, 0);
      d.position.set(dx * 1.75 + (f - 1) * 0.07, dy * 1.75 - 0.18, 0.06);
      d.scale.set(0.045, 0.36, 0.045);
      d.updateMatrix();
      flecos.setMatrixAt(i * 3 + f, d.matrix);
      flecos.setColorAt(i * 3 + f, col.setHex(picos[(i + f + 1) % 7] as number));
    }
  }
  d.rotation.order = "XYZ";
  for (const m of [pinchos, contornoPicos, flecos]) {
    m.frustumCulled = false;
    B.add({ dispose: () => m.dispose() });
    giro.add(m);
  }

  // Las grietas: tres tramos de tinta por palo, pegados a la cara que mira a la cámara.
  const grietas = new InstancedMesh(B.add(new BoxGeometry(1, 1, 1)), new MeshBasicMaterial({ color: c.inkHex }), 24);
  B.add(grietas.material as MeshBasicMaterial);
  for (let i = 0; i < 8; i++) {
    const a = hash(i, 17) * Math.PI * 2;
    let cx = Math.cos(a) * 0.15, cy = -Math.sin(a) * 0.15;
    for (let s = 0; s < 3; s++) {
      const ang = a + (hash(i, s) - 0.5) * 1.2;
      const nx = cx + Math.cos(ang) * 0.28, ny = cy - Math.sin(ang) * 0.28;
      const r2 = Math.min(0.9, ((cx + nx) / 2) ** 2 + ((cy + ny) / 2) ** 2);
      d.position.set((cx + nx) / 2, (cy + ny) / 2, Math.sqrt(1 - r2) + 0.025);
      d.rotation.set(0, 0, Math.atan2(ny - cy, nx - cx));
      d.scale.set(Math.hypot(nx - cx, ny - cy) + 0.03, 0.035, 0.03);
      d.updateMatrix();
      grietas.setMatrixAt(i * 3 + s, d.matrix);
      cx = nx;
      cy = ny;
    }
  }
  grietas.count = 0;
  grietas.frustumCulled = false;
  B.add({ dispose: () => grietas.dispose() });
  giro.add(grietas);

  // La cuerda: un cilindro fino de tinta entre el gancho y la cabeza de la piñata.
  const cuerda = new Mesh(B.add(new CylinderGeometry(1, 1, 1, 6, 1)), B.add(new MeshBasicMaterial({ color: c.inkHex })));
  cuerda.frustumCulled = false;
  escenario.add(cuerda);

  return {
    poner(o) {
      grupo.visible = o.ver;
      if (o.ver) {
        grupo.position.set(o.x, o.y, o.z);
        grupo.rotation.set(0, 0, -o.rot);
        grupo.scale.set(o.R * o.escX, o.R * o.escY, o.R);
        // Gira despacio sobre su cuerda: se le ven los picos de costado.
        giro.rotation.y = Math.sin(o.t * 0.9) * 0.43;
        grietas.count = Math.min(8, o.grietas) * 3;
      }
      // La cuerda sale del gancho (arriba, fuera de la pantalla) y llega a la cabeza de la olla.
      entre(cuerda, o.cx, o.cy, o.cz, o.x, o.y + o.R * 0.9 * o.escY, o.z, 1.5 * o.k);
    },
  };
}

export interface Rotura {
  /** Los pedazos de la rotura, `edad` segundos después del golpe, desde `(ox, oy, oz)` (el centro de la olla). */
  poner(o: { edad: number; ox: number; oy: number; oz: number; R: number; k: number; rot: number; particulas: number }): void;
}

export function crearRotura(c: Ctx): Rotura {
  const { B, tema, escenario } = c;
  const [mag, nar] = ACENTOS[tema];
  const picos = coloresPicos(tema);
  const d = new Object3D();
  const col = new Color();

  // Los siete picos que salen volando.
  const geoPico = B.add(new ConeGeometry(0.34, 0.97, 6, 1));
  geoPico.translate(0, 0.485, 0);
  const pinchos = new InstancedMesh(geoPico, B.add(new MeshLambertMaterial({ flatShading: true })), 7);
  const tinta = new InstancedMesh(geoPico, c.tinta, 7);
  for (let i = 0; i < 7; i++) pinchos.setColorAt(i, col.setHex(picos[i] as number));
  // Los ocho gajos de la olla: una cuña de la esfera de polo a polo, que desde el frente es una porción de torta.
  const geoGajo = B.add(new SphereGeometry(1, 3, 6, 0, Math.PI / 4, 0, Math.PI));
  geoGajo.rotateX(Math.PI / 2);
  geoGajo.rotateZ(-Math.PI - Math.PI / 8);
  const gajos = new InstancedMesh(geoGajo, B.add(new MeshLambertMaterial({ flatShading: true, side: DoubleSide })), 8);
  for (let i = 0; i < 8; i++) gajos.setColorAt(i, col.setHex(i % 2 ? nar : mag));
  // La lluvia de papel de china.
  const papel = new InstancedMesh(B.add(new PlaneGeometry(1, 1)), B.add(new MeshBasicMaterial({ side: DoubleSide })), PAPEL_MAX);
  for (let i = 0; i < PAPEL_MAX; i++) papel.setColorAt(i, col.setHex(picos[i % 7] as number));
  for (const m of [pinchos, tinta, gajos, papel]) {
    m.frustumCulled = false;
    m.visible = false;
    B.add({ dispose: () => m.dispose() });
    escenario.add(m);
  }

  return {
    poner(o) {
      const ver = o.edad >= 0;
      pinchos.visible = tinta.visible = gajos.visible = papel.visible = ver;
      if (!ver) return;
      const { edad, ox, oy, oz, R, k } = o;
      d.rotation.order = "ZXY";
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + (i / 7) * Math.PI * 2;
        const dist = R + edad * 520 * k;
        const caida = 0.5 * GRAV * k * edad * edad * 0.6;
        d.position.set(ox + Math.cos(a) * dist, oy - Math.sin(a) * dist - caida, oz + (0.3 + hash(i, 71)) * 340 * k * edad);
        d.rotation.set(edad * (2 + hash(i, 72) * 3), 0, -a - Math.PI / 2 - edad * (2 + 0.6 * i) * (i % 2 ? 1 : -1));
        d.scale.setScalar(R * 0.9);
        d.updateMatrix();
        pinchos.setMatrixAt(i, d.matrix);
        d.scale.setScalar(R * 0.9 * 1.12);
        d.updateMatrix();
        tinta.setMatrixAt(i, d.matrix);
      }
      for (let i = 0; i < 8; i++) {
        const am = ((i + 0.5) / 8) * Math.PI * 2;
        const v = (260 + hash(i, 61) * 260) * k;
        const alcance = v * edad;
        const caida = -180 * k * edad + 0.5 * GRAV * k * edad * edad * 0.7;
        d.position.set(ox + Math.cos(am) * alcance, oy - Math.sin(am) * alcance - caida, oz + (hash(i, 64) - 0.2) * 300 * k * edad);
        d.rotation.set(edad * (1.5 + hash(i, 63) * 2.5), 0, -am + edad * (2.5 + hash(i, 62) * 3) * (i % 2 ? 1 : -1));
        d.scale.setScalar(R);
        d.updateMatrix();
        gajos.setMatrixAt(i, d.matrix);
      }
      d.rotation.order = "XYZ";
      const hay = Math.round(PAPEL_MAX * Math.max(0, Math.min(1, o.particulas)));
      papel.count = hay;
      for (let i = 0; i < hay; i++) {
        const a = hash(i, 51) * Math.PI * 2;
        const v = (180 + hash(i, 52) * 420) * k;
        const vida = 2.2 - hash(i, 56) * 0.5;
        const resto = Math.max(0, Math.min(1, (vida - edad) / 0.35));
        const x = ox + Math.cos(a) * v * edad;
        const caida = 0.5 * GRAV * 0.35 * k * edad * edad;
        d.position.set(x + Math.sin(edad * (3 + hash(i, 57) * 3) + hash(i, 58) * 6) * 8 * k, oy - Math.sin(a) * v * edad - caida, oz + (hash(i, 55) - 0.3) * 320 * k * edad);
        d.rotation.set(hash(i, 53) * 6 + edad * (3 + hash(i, 54) * 6), hash(i, 59) * 6 + edad * 2, hash(i, 60) * 6);
        d.scale.set(13 * k * resto, 8 * k * resto, 1);
        d.updateMatrix();
        papel.setMatrixAt(i, d.matrix);
      }
      for (const m of [pinchos, tinta, gajos, papel]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    },
  };
}
