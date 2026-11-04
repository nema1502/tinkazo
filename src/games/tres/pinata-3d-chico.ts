import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh, Mesh, MeshLambertMaterial, Object3D, SphereGeometry,
} from "three";
import { coloresPicos, contorno, entre, type Ctx } from "./pinata-3d-piezas";

/**
 * El chico del palo, con los ojos vendados: piernas que caminan, remera del color que el 2D le puso, la venda roja con su
 * moño, los brazos que agarran el palo con las dos manos, el palo forrado de papel de colores y, cuando lo marean, tres
 * estrellitas. Mide 137 de las zapatillas al pelo, en las unidades de su dibujo del 2D (el grupo se escala por `esc`).
 *
 * Las tres vueltas son vueltas de verdad: gira el chico entero sobre su eje, con el palo y los brazos. Mira hacia +x (la
 * piñata) y se ve de perfil, como en el 2D.
 */

/** Lo que mide el palo y dónde lo agarra, en el dibujo del 2D (`STICK`, `HAND_X`, `HAND_Y` de `pixi/pinata.ts`). */
export const PALO = 115;
export const MANO_X = 20;
/** La mano en el 3D: el 2D tiene la y hacia abajo (`HAND_Y = -66`). */
export const MANO_Y = 66;

export interface Chico {
  poner(o: { x: number; y: number; z: number; esc: number; estira: number; vueltas: number; inclina: number; paso: number; amp: number; palo: number; mareo: number; t: number; remera: number }): void;
  /** Dónde queda la punta del palo en el escenario (para probar que toca la olla). */
  readonly punta: [number, number, number];
}

export function crearChico(c: Ctx): Chico {
  const { B, tema, escenario, mat } = c;
  const d = new Object3D();
  const col = new Color();
  const raiz = new Group();
  // Primero gira sobre su eje y después se tambalea en el plano de la pantalla.
  raiz.rotation.order = "ZYX";
  escenario.add(raiz);

  const cil = B.add(new CylinderGeometry(1, 1, 1, 7, 1));
  const caja = B.add(new BoxGeometry(1, 1, 1));
  const esfera = B.add(new SphereGeometry(1, 10, 8));
  const piel = mat.plano(0xc68a5c);
  const tinta = mat.plano(c.inkHex);
  const rojo = mat.plano(0xd7263d);
  const pelo = mat.plano(0x2b1d14);
  const pantalon = mat.plano(0x2b2d42);
  const madera = mat.plano(0x8a6238);
  // La remera cambia con el color del chico: su propio material.
  const remera = B.add(new MeshLambertMaterial({ color: 0xffffff, flatShading: true }));

  const pieza = (geo: BufferGeometry, m: MeshLambertMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, padre: Group = raiz): Mesh => {
    const me = new Mesh(geo, m);
    me.position.set(x, y, z);
    me.scale.set(sx, sy, sz);
    padre.add(me);
    return me;
  };

  // Las piernas, de la cadera para abajo: giran ahí al caminar. Las zapatillas, de tinta, mirando hacia adelante.
  const caderas: Group[] = [];
  for (const z of [-7.5, 7.5]) {
    const cadera = new Group();
    cadera.position.set(-7, 44, z);
    const pierna = pieza(cil, pantalon, 0, -22, 0, 5.6, 44, 5.6, cadera);
    contorno(c, pierna, 1.12).scale.y = 1.0;
    pieza(caja, tinta, 3.2, -40.5, 0, 15, 7, 11, cadera);
    raiz.add(cadera);
    caderas.push(cadera);
  }
  // El cuerpo y la cabeza.
  const torso = pieza(caja, remera, -7, 66, 0, 34, 52, 26);
  contorno(c, torso, 1.05);
  const cabeza = pieza(esfera, piel, -7, 108, 0, 17, 17, 17);
  contorno(c, cabeza, 1.06);
  pieza(esfera, pelo, -9, 119, 0, 15, 12.5, 15.5);
  // La venda sobre los ojos, con el moño atrás.
  pieza(cil, rojo, -7, 109, 0, 17.8, 10, 17.8);
  pieza(caja, rojo, -25.5, 108, 0, 8, 8, 8);
  const ala1 = pieza(caja, rojo, -30, 113, 0, 10, 4, 5);
  ala1.rotation.z = 0.5;
  const ala2 = pieza(caja, rojo, -30, 102, 0, 10, 4, 5);
  ala2.rotation.z = -0.5;

  // Los brazos: del hombro (a cada lado del cuerpo) a las manos, que agarran el palo.
  const brazoA = pieza(cil, remera, 0, 0, 0, 4.2, 1, 4.2);
  const brazoB = pieza(cil, remera, 0, 0, 0, 4.2, 1, 4.2);
  const manos = new InstancedMesh(esfera, piel, 2);
  manos.frustumCulled = false;
  B.add({ dispose: () => manos.dispose() });
  raiz.add(manos);
  // El palo y su forro de papel de colores.
  const palo = pieza(cil, madera, 0, 0, 0, 3.8, 1, 3.8);
  contorno(c, palo, 1.35).scale.y = 1.0;
  const forro = new InstancedMesh(cil, B.add(new MeshLambertMaterial({ flatShading: true })), 5);
  const picos = coloresPicos(tema);
  for (let i = 0; i < 5; i++) forro.setColorAt(i, col.setHex(picos[i] as number));
  forro.frustumCulled = false;
  B.add({ dispose: () => forro.dispose() });
  raiz.add(forro);
  // Las estrellitas del mareo.
  const estrellas = new InstancedMesh(B.add(new IcosahedronGeometry(1, 0)), B.add(new MeshLambertMaterial({ color: 0xffc629, flatShading: true })), 3);
  estrellas.frustumCulled = false;
  B.add({ dispose: () => estrellas.dispose() });
  raiz.add(estrellas);

  const punta: [number, number, number] = [0, 0, 0];
  const v = { x: 0, y: 0, z: 0 };

  return {
    punta,
    poner(o) {
      raiz.position.set(o.x, o.y, o.z);
      // Más alto que ancho lo justo para que, visto desde arriba, mida en la pantalla lo mismo que en el 2D.
      raiz.scale.set(o.esc, o.esc * o.estira, o.esc);
      raiz.rotation.set(0, o.vueltas * Math.PI * 2, -o.inclina);
      remera.color.setHex(o.remera);
      // El 2D tiene la rotación de las piernas con la y hacia abajo: acá el signo es el contrario.
      caderas[0]!.rotation.z = -Math.sin(o.paso) * o.amp;
      caderas[1]!.rotation.z = Math.sin(o.paso) * o.amp;
      // El palo: en el dibujo del 2D el ángulo crece hacia abajo.
      const ca = Math.cos(o.palo), sa = -Math.sin(o.palo);
      const bx = MANO_X - ca * 8, by = MANO_Y - sa * 8;
      const tx = MANO_X + ca * PALO, ty = MANO_Y + sa * PALO;
      entre(palo, bx, by, 0, tx, ty, 0, 3.8);
      const h2x = MANO_X + ca * 13, h2y = MANO_Y + sa * 13;
      entre(brazoA, -7, 84, -13.5, h2x, h2y, 0, 4.2);
      entre(brazoB, -7, 84, 13.5, MANO_X, MANO_Y, 0, 4.2);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(4.4);
      d.position.set(MANO_X, MANO_Y, 0);
      d.updateMatrix();
      manos.setMatrixAt(0, d.matrix);
      d.position.set(h2x, h2y, 0);
      d.updateMatrix();
      manos.setMatrixAt(1, d.matrix);
      manos.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < 5; i++) {
        const r = 30 + i * 18;
        entre(d, MANO_X + ca * (r - 2.5), MANO_Y + sa * (r - 2.5), 0, MANO_X + ca * (r + 2.5), MANO_Y + sa * (r + 2.5), 0, 4.6);
        d.updateMatrix();
        forro.setMatrixAt(i, d.matrix);
      }
      forro.instanceMatrix.needsUpdate = true;
      if (forro.instanceColor) forro.instanceColor.needsUpdate = true;
      const ver = o.mareo > 0.05;
      estrellas.visible = ver;
      if (ver) {
        for (let i = 0; i < 3; i++) {
          const a = o.t * 7 + (i * 2 * Math.PI) / 3;
          d.rotation.set(a, a * 0.7, 0);
          d.position.set(-7 + Math.cos(a) * 20, 146, Math.sin(a) * 20);
          d.scale.setScalar(5 * o.mareo);
          d.updateMatrix();
          estrellas.setMatrixAt(i, d.matrix);
        }
        estrellas.instanceMatrix.needsUpdate = true;
      }
      // La punta del palo en el escenario: del dibujo del chico, con su giro y su escala.
      raiz.updateMatrix();
      v.x = tx; v.y = ty; v.z = 0;
      const e = raiz.matrix.elements;
      punta[0] = e[0]! * v.x + e[4]! * v.y + e[8]! * v.z + e[12]!;
      punta[1] = e[1]! * v.x + e[5]! * v.y + e[9]! * v.z + e[13]!;
      punta[2] = e[2]! * v.x + e[6]! * v.y + e[10]! * v.z + e[14]!;
    },
  };
}
