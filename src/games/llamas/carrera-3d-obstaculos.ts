import { BoxGeometry, ConeGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Scene } from "three";
import { ZC, escala3D, type Efecto3D } from "./carrera-3d-mapa";

/**
 * Los obstáculos de la recta en 3D: piedras que caen del cerro y ruedan, polvo, y la ráfaga con rayas de viento y pasto que vuela.
 * (La valla es fija y la arma `armarMundo`; el salto de la llama es el `salto` de cada corredora.)
 *
 * No calcula nada de la carrera: dibuja lo que la escena 2D describe en cada cuadro (`Efecto3D`, función del plan y de la hora). Lo que parece azar
 * sale de un hash del lugar. Una sola tanda de piezas, que se esconden cuando no hay obstáculo: nada se crea ni se tira durante la carrera.
 */

const hash = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
const suave = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x * x * (3 - 2 * x);
};

export interface Efectos3D {
  frame(efectos: readonly Efecto3D[], u: number): void;
}

interface Desechable {
  add<T extends { dispose(): void }>(x: T): T;
}

const PIEDRAS = 5;
const POLVO = 14;
const RAYAS = 26;
const PASTO = 16;

export function crearEfectos3D(escena: Scene, basura: Desechable): Efectos3D {
  const grupo = new Group();
  escena.add(grupo);
  const geoPiedra = basura.add(new IcosahedronGeometry(1, 0));
  const matPiedra = basura.add(new MeshLambertMaterial({ color: 0x8d8478, flatShading: true }));
  const geoEsfera = basura.add(new SphereGeometry(1, 8, 6));
  const geoCaja = basura.add(new BoxGeometry(1, 1, 1));
  const geoPunta = basura.add(new ConeGeometry(0.14, 0.5, 4));
  const matPasto = basura.add(new MeshLambertMaterial({ color: 0x6fae4a, flatShading: true }));
  const matPaja = basura.add(new MeshLambertMaterial({ color: 0xc9b27a, flatShading: true }));

  const piedras = Array.from({ length: PIEDRAS }, () => {
    const m = new Mesh(geoPiedra, matPiedra);
    grupo.add(m);
    return m;
  });
  const polvos = Array.from({ length: POLVO }, () => {
    const m = new Mesh(geoEsfera, basura.add(new MeshBasicMaterial({ color: 0xd9cdb4, transparent: true, opacity: 0, depthWrite: false })));
    grupo.add(m);
    return m;
  });
  const rayas = Array.from({ length: RAYAS }, () => {
    const m = new Mesh(geoCaja, basura.add(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })));
    grupo.add(m);
    return m;
  });
  const pastos = Array.from({ length: PASTO }, (_, i) => {
    const m = new Mesh(geoPunta, i % 3 ? matPasto : matPaja);
    grupo.add(m);
    return m;
  });
  const todas = [...piedras, ...polvos, ...rayas, ...pastos];
  for (const m of todas) m.visible = false;

  const poner = (m: Mesh, x: number, y: number, z: number, esc: number): void => {
    m.visible = true;
    m.position.set(x, y, z);
    m.scale.setScalar(esc);
  };

  return {
    frame(efectos, u) {
      for (const m of todas) m.visible = false;
      if (!efectos.length) return;
      const s = escala3D(u);
      const X = (px: number): number => px * s;
      const Z = (py: number): number => py * s * ZC;
      let iPolvo = 0, iRaya = 0, iPasto = 0;
      const puff = (x: number, y: number, z: number, radio: number, opacidad: number): void => {
        const m = polvos[iPolvo++];
        if (!m) return;
        poner(m, x, y, z, radio);
        (m.material as MeshBasicMaterial).opacity = Math.max(0, opacidad);
      };
      for (const f of efectos) {
        if (f.tipo === "piedras") {
          for (let j = 0; j < PIEDRAS; j++) {
            const retraso = j === 0 ? 0 : hash(f.id * 3 + j, 1) * 0.06;
            const w = (f.s - retraso) / 0.3;
            const pieza = piedras[j];
            if (w < 0 || !pieza) continue;
            const dx = j === 0 ? 0 : (hash(f.id * 7 + j, 3) - 0.5) * 150 * u;
            const dz = j === 0 ? 0 : (hash(f.id * 5 + j, 9) - 0.5) * 70 * u;
            const lx = X(f.x + dx), lz = Z(f.y) + dz * s * ZC;
            const r = j === 0 ? 0.95 : 0.4 + 0.35 * hash(f.id + j, 2);
            if (w < 1) {
              // Cae del cerro: viene de arriba y de atrás, y gira.
              const caida = 1 - w * w;
              poner(pieza, lx - caida * 4, r + caida * 15, lz - caida * 8, r);
              pieza.rotation.set(w * 7 + j, w * 5, w * 3);
            } else {
              const v = (f.s - retraso - 0.3) / 0.45;
              if (v > 1) continue;
              // Rebota cada vez menos y rueda hacia adelante; al final se achica y desaparece.
              const rebote = Math.abs(Math.sin(v * Math.PI * 2.6)) * Math.exp(-v * 3.2) * 1.6;
              poner(pieza, lx + v * 2.6, r * 0.8 + rebote, lz, r * (1 - suave((v - 0.8) / 0.2)));
              pieza.rotation.set(7 + v * 9 + j, 5 + v * 2, 3 + v * 4);
              if (v < 0.5 && j < 3) {
                const a = v / 0.5;
                puff(lx + 0.4, 0.3 + a * 0.9, lz, 0.5 + a * 1.9, 0.55 * (1 - a));
                puff(lx - 0.5, 0.2 + a * 0.6, lz + 0.5, 0.4 + a * 1.5, 0.45 * (1 - a));
              }
            }
          }
        } else {
          const env = Math.sin(Math.PI * Math.min(1, f.s));
          const ancho = f.ancho * s;
          const xc = X(f.x);
          const zA = Z(f.y - 60 * u), zB = Z(f.y1 + 14 * u);
          for (let i = 0; i < RAYAS; i++) {
            const m = rayas[i];
            if (!m) break;
            const fase = (hash(f.id * 11 + i, 4) + f.s * 2.6) % 1;
            const largo = 2 + 4 * hash(f.id + i, 8);
            poner(m, xc - ancho / 2 + fase * ancho, 0.5 + 2.6 * hash(f.id * 13 + i, 6), zA + hash(f.id * 17 + i, 5) * (zB - zA) + f.lado * fase * 2.2, 1);
            m.scale.set(largo, 0.09, 0.09);
            (m.material as MeshBasicMaterial).opacity = 0.9 * env;
          }
          for (let i = 0; i < PASTO; i++) {
            const m = pastos[i];
            if (!m) break;
            const fase = (hash(f.id * 19 + i, 7) + f.s * 1.8) % 1;
            poner(m, xc - ancho / 2 + fase * ancho, 0.4 + Math.sin(fase * Math.PI) * (1.5 + 2 * hash(i, f.id)), zA + hash(f.id * 23 + i, 3) * (zB - zA) + f.lado * fase * 2, 1.7 * (0.4 + env));
            m.rotation.set(fase * 14 + i, fase * 9, fase * 11);
          }
          for (let i = 0; i < 5; i++) {
            const fase = (hash(f.id * 29 + i, 2) + f.s * 1.2) % 1;
            puff(xc - ancho / 2 + fase * ancho, 0.35 + 0.5 * hash(i, f.id), zA + hash(f.id * 31 + i, 1) * (zB - zA), 0.8 + 1.4 * hash(i + 5, f.id), 0.28 * env);
          }
        }
      }
    },
  };
}
