import { BackSide, BoxGeometry, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Scene } from "three";
import { LLAMA_ALTO } from "./carrera-forma";
import { TAM3D, ZC, escala3D, type Efecto3D } from "./carrera-3d-mapa";

/**
 * Los obstáculos de la recta en 3D: piedras que caen del cerro y ruedan, polvo, y la ráfaga con rayas de viento y pasto que vuela.
 * (La valla es fija y la arma `armarMundo`; el salto de la llama es el `salto` de cada corredora.)
 *
 * No calcula nada de la carrera: dibuja lo que la escena 2D describe en cada cuadro (`Efecto3D`, función del plan y de la hora), y las piedras
 * donde las pone la vista de los obstáculos (`Efecto3D.piedras`). Lo que parece azar sale de un hash del lugar. Una sola tanda de piezas, que se esconden cuando no hay obstáculo: nada se crea ni se tira durante la carrera.
 */

const hash = (a: number, b = 0): number => {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};
export interface Efectos3D {
  frame(efectos: readonly Efecto3D[], u: number): void;
  /** Las piedras del cerro que se ven en el último cuadro, como las dejó three.js: centro y radio, en unidades del 3D. */
  piedrasVistas(): { x: number; y: number; z: number; r: number }[];
}

interface Desechable {
  add<T extends { dispose(): void }>(x: T): T;
}

const PIEDRAS = 5;
const POLVO = 14;
const RAYAS = 26;
const PASTO = 16;
const GOTAS = 12;
/** La gota de la escupida: crema, con el borde de tinta detrás (una esfera mayor vista por dentro). */
const GOTA_COLOR = 0xf3e6c4;
const GOTA_BORDE = 0x2f241a;

/**
 * Dónde va la gota de la escupida en el mundo 3D, en el avance `a` del vuelo (0 en la boca, 1 en la cara): sale de la boca, sube en arco
 * por encima de las dos cabezas y llega a la cara. `boca` y `cara` vienen en píxeles del mundo 2D (avance, y donde pisa), con el tamaño de cada
 * llama a esa hora (`esc`, el del 2D): la boca está a esa altura de la llama, que mientras pasa de su fila del grupo a su carril es más grande.
 */
export function puntoDeLaGota(boca: { x: number; y: number; esc: number }, cara: { x: number; y: number; esc: number }, a: number, u: number): [number, number, number] {
  const s = escala3D(u);
  const alto = LLAMA_ALTO * s * TAM3D;
  const f = Math.max(0, Math.min(1, a));
  return [
    (boca.x + (cara.x - boca.x) * f) * s,
    0.82 * alto * (boca.esc + (cara.esc - boca.esc) * f) + Math.sin(Math.PI * f) * 0.3 * alto,
    (boca.y + (cara.y - boca.y) * f) * s * ZC,
  ];
}
/** Las rayas de viento: finas, cortas, color crema y a media transparencia, para que se lean como aire y no como una llama o una línea del carril. */
const RAYA_COLOR = 0xf3e6c4;
const RAYA_OPACIDAD = 0.5;
const RAYA_GROSOR = 0.04;
const RAYA_LARGO_MIN = 1;
const RAYA_LARGO_MAX = 2.6;

export function crearEfectos3D(escena: Scene, basura: Desechable): Efectos3D {
  const grupo = new Group();
  escena.add(grupo);
  const geoPiedra = basura.add(new IcosahedronGeometry(1, 0));
  const matPiedra = basura.add(new MeshLambertMaterial({ color: 0x8d8478, flatShading: true }));
  const geoEsfera = basura.add(new SphereGeometry(1, 8, 6));
  const geoCaja = basura.add(new BoxGeometry(1, 1, 1));
  // Las hojas que vuela la ráfaga: un elipsoide achatado, plano como una hoja, en dos verdes (nada de conos ni de paja beige).
  const geoHoja = basura.add(new SphereGeometry(0.5, 6, 4));
  const matPasto = basura.add(new MeshLambertMaterial({ color: 0x6fae4a, flatShading: true }));
  const matPasto2 = basura.add(new MeshLambertMaterial({ color: 0x86bd55, flatShading: true }));

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
    const m = new Mesh(geoCaja, basura.add(new MeshBasicMaterial({ color: RAYA_COLOR, transparent: true, opacity: 0, depthWrite: false })));
    grupo.add(m);
    return m;
  });
  const pastos = Array.from({ length: PASTO }, (_, i) => {
    const m = new Mesh(geoHoja, i % 3 ? matPasto : matPasto2);
    grupo.add(m);
    return m;
  });
  // La gota que vuela, las tres que la siguen y las ocho del salpicón: crema con borde de tinta, en la misma tanda fija.
  const matGota = basura.add(new MeshBasicMaterial({ color: GOTA_COLOR }));
  const matGotaBorde = basura.add(new MeshBasicMaterial({ color: GOTA_BORDE, side: BackSide }));
  const gotas = Array.from({ length: GOTAS }, () => {
    const borde = new Mesh(geoEsfera, matGotaBorde);
    const centro = new Mesh(geoEsfera, matGota);
    grupo.add(borde, centro);
    return { borde, centro };
  });
  const todas = [...piedras, ...polvos, ...rayas, ...pastos, ...gotas.flatMap((g) => [g.borde, g.centro])];
  for (const m of todas) m.visible = false;

  const poner = (m: Mesh, x: number, y: number, z: number, esc: number): void => {
    m.visible = true;
    m.position.set(x, y, z);
    m.scale.setScalar(esc);
  };

  return {
    piedrasVistas() {
      return piedras.filter((m) => m.visible).map((m) => ({ x: m.position.x, y: m.position.y, z: m.position.z, r: m.scale.x }));
    },
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
        if (f.tipo === "piedras" && f.piedras) {
          // Dónde va cada piedra lo dice la vista (`carrera-obstaculos-vista.ts`), la misma cuenta del 2D y del auditor de sólidos: acá solo se viste.
          for (let j = 0; j < PIEDRAS; j++) {
            const p = f.piedras[j];
            const pieza = piedras[j];
            if (!p?.visible || !pieza) continue;
            const lx = X(p.x), lz = Z(p.y), r = p.r * s;
            poner(pieza, lx, p.alto * s, lz, r * p.k);
            if (p.cae < 1) {
              // Cae del cerro: viene de arriba y de atrás, y gira.
              pieza.rotation.set(p.cae * 7 + j, p.cae * 5, p.cae * 3);
            } else {
              // Rebota cada vez menos y rueda hacia adelante; al final se achica y desaparece.
              const v = p.rueda;
              pieza.rotation.set(7 + v * 9 + j, 5 + v * 2, 3 + v * 4);
              if (v < 0.5 && j < 3) {
                const a = v / 0.5;
                puff(lx + 0.4, 0.3 + a * 0.9, lz, 0.5 + a * 1.9, 0.55 * (1 - a));
                puff(lx - 0.5, 0.2 + a * 0.6, lz + 0.5, 0.4 + a * 1.5, 0.45 * (1 - a));
              }
            }
          }
        } else if (f.tipo === "viento") {
          const env = Math.sin(Math.PI * Math.min(1, f.s));
          const ancho = f.ancho * s;
          const xc = X(f.x);
          const zA = Z(f.y - 60 * u), zB = Z(f.y1 + 14 * u);
          for (let i = 0; i < RAYAS; i++) {
            const m = rayas[i];
            if (!m) break;
            const fase = (hash(f.id * 11 + i, 4) + f.s * 2.6) % 1;
            const largo = RAYA_LARGO_MIN + (RAYA_LARGO_MAX - RAYA_LARGO_MIN) * hash(f.id + i, 8);
            poner(m, xc - ancho / 2 + fase * ancho, 0.5 + 2.6 * hash(f.id * 13 + i, 6), zA + hash(f.id * 17 + i, 5) * (zB - zA) + f.lado * fase * 2.2, 1);
            m.scale.set(largo, RAYA_GROSOR, RAYA_GROSOR);
            (m.material as MeshBasicMaterial).opacity = RAYA_OPACIDAD * env;
          }
          for (let i = 0; i < PASTO; i++) {
            const m = pastos[i];
            if (!m) break;
            const fase = (hash(f.id * 19 + i, 7) + f.s * 1.8) % 1;
            const hoja = 1.7 * (0.4 + env);
            poner(m, xc - ancho / 2 + fase * ancho, 0.4 + Math.sin(fase * Math.PI) * (1.5 + 2 * hash(i, f.id)), zA + hash(f.id * 23 + i, 3) * (zB - zA) + f.lado * fase * 2, 1);
            // Larga, angosta y casi sin espesor: una hoja que da vueltas en el aire.
            m.scale.set(hoja * 0.5, hoja * 0.05, hoja * 0.2);
            m.rotation.set(fase * 14 + i, fase * 9, fase * 11);
          }
          for (let i = 0; i < 5; i++) {
            const fase = (hash(f.id * 29 + i, 2) + f.s * 1.2) % 1;
            puff(xc - ancho / 2 + fase * ancho, 0.35 + 0.5 * hash(i, f.id), zA + hash(f.id * 31 + i, 1) * (zB - zA), 0.8 + 1.4 * hash(i + 5, f.id), 0.28 * env);
          }
        } else if (f.tipo === "escupida" && f.boca && f.cara) {
          const alto = LLAMA_ALTO * s * TAM3D;
          const ponerGota = (i: number, x: number, y: number, z: number, r: number): void => {
            const g = gotas[i];
            if (!g) return;
            poner(g.borde, x, y, z, r * 1.3);
            poner(g.centro, x, y, z, r);
          };
          if (f.s <= 1) {
            // La gota grande y tres chicas detrás, en el mismo arco de la boca a la cara.
            for (let j = 0; j < 4; j++) {
              const a = f.s - j * 0.09;
              if (a < 0) continue;
              const [x, y, z] = puntoDeLaGota(f.boca, f.cara, a, u);
              ponerGota(j, x, y, z, (j === 0 ? 0.13 : 0.1 - j * 0.018) * alto);
            }
          } else {
            // El salpicón: ocho gotitas que se abren alrededor de la cara y caen.
            const b = Math.max(0, Math.min(1, f.s - 1));
            const [cx, cy, cz] = puntoDeLaGota(f.boca, f.cara, 1, u);
            for (let i = 0; i < 8; i++) {
              const ang = hash(f.id * 37 + i, 12) * Math.PI * 2;
              const dist = 0.35 * alto * Math.sin(Math.PI * Math.min(1, b * 1.15));
              ponerGota(4 + i, cx + Math.cos(ang) * dist, cy - b * b * 0.5 * alto + Math.sin(b * Math.PI) * 0.08 * alto, cz + Math.sin(ang) * dist * 0.7, 0.07 * alto);
            }
          }
        }
      }
    },
  };
}
