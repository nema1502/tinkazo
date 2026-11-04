import { readFileSync } from "node:fs";
import { Group, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";
import { createPile } from "../pixi/pinata-monton";
import { calendarioDePalos } from "../pixi/pinata-plan";
import { perfilFiel, escala3D } from "./camara";
import { hash } from "./ids";
import { Materiales } from "./figuras";
import type { Motor3D } from "./motor";
import { Basura } from "./motor";
import { luzDeCorona } from "./pinata-3d";
import { crearChico, PALO, MANO_X, MANO_Y } from "./pinata-3d-chico";
import { ELEVACION, Proyector, aPantalla, azimutDe, elevacionDe, poseFrontal, proyectar } from "./pinata-3d-mapa";
import type { Ctx } from "./pinata-3d-piezas";
import { INK } from "./pinata-3d-piezas";
import { compararPuestos, type Puesto2D } from "./prueba";
import type { Camara2D } from "./tipos";

const aqui = new URL(".", import.meta.url);
const fuente = (f: string): string => readFileSync(new URL(f, aqui), "utf8");
const pinataPixi = readFileSync(new URL("../pixi/pinata.ts", import.meta.url), "utf8");
const sinComentarios = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Las medidas del 2D (`G()` de pixi/pinata.ts) para una pantalla de `w` por `h`, con la barra de abajo que deja el relator. */
function geometria(w: number, h: number) {
  const k = h / 720;
  const R = Math.min(h * 0.13, w * 0.12);
  const piso = h - 0.2 * h - 58 * k;
  return { w, h, k, R, piso, u: k };
}

/** Lo que el 2D pone en el piso: el montón de arena de `pinata-monton.ts`, en el orden en que caen los caramelos. */
function montonDelPlan(n: number, semilla: number, hasta: number, g: ReturnType<typeof geometria>): Puesto2D[] {
  const sz = Math.max(12 * g.k, Math.min(26 * g.k, Math.sqrt(1 / n) * 70 * g.k));
  const orden = Array.from({ length: Math.max(0, n - 2) }, (_, i) => i).sort((a, b) => hash(a, semilla) - hash(b, semilla));
  const { palos, fin } = calendarioDePalos(orden, Math.max(5, Math.min(9, 5 + Math.floor(n / 6))), semilla % 2 === 0, 3);
  const monton = createPile(sz, 20 * g.k, g.w - 20 * g.k);
  const out: Puesto2D[] = [];
  const t = hasta * (fin + 1.5);
  for (const p of palos) {
    if (p.at + 0.9 > t) break;
    for (const id of p.drop) {
      const x0 = g.w / 2 + (hash(id, 1) - 0.5) * g.R * 4;
      const spot = monton.settle(monton.colOf(x0), hash(id, 11) < 0.5 ? -1 : 1);
      const x = monton.centerOf(spot.col) + (hash(id, 12) - 0.5) * sz * 0.5;
      const y = g.piso - sz * 0.62 - spot.base;
      out.push({ id, x, y: 0, alto: g.piso - y });
    }
  }
  return out;
}

const camaraTipica = (g: ReturnType<typeof geometria>, zoom: number, rot = 0, sac = 0): Camara2D => ({
  x: g.w / 2 + 40, y: g.piso - 190, zoom, rot, sacudonX: sac, sacudonY: -sac / 2,
});

describe("la piñata en 3D dibuja las posiciones del plan 2D", () => {
  for (const n of [5, 18, 30]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 70, 88 y 100 % cada caramelo del montón cae donde el 2D lo puso`, () => {
        const g = geometria(1366, 768);
        const s = escala3D(g.u);
        for (const q of [0.25, 0.5, 0.7, 0.88, 1]) {
          const puestos = montonDelPlan(n, semilla, q, g);
          // El ayudante del kit: la posición vuelve intacta y el orden es el mismo con el perfil de la piñata (y = 0: todo en el mismo plano).
          expect(compararPuestos(puestos, perfilFiel(ELEVACION), g.u)).toEqual([]);
          // La cuenta de la casa para este juego: del 2D a la pantalla, al 3D por el rayo y de vuelta a la pantalla.
          for (const zoom of [1.0, 1.3, 1.6]) {
            const cam = camaraTipica(g, zoom, 0.01, 3);
            const pose = poseFrontal(cam, g.w, g.h, g.u, g.piso, elevacionDe(zoom, -1, -9), azimutDe(5));
            const py = new Proyector();
            py.fijar(pose, cam, g.w, g.h);
            const w = [0, 0, 0] as [number, number, number];
            const piso = py.plano(cam.x, g.piso, 0, [0, 0, 0]);
            const locales = puestos.map((p) => {
              py.plano(p.x, g.piso - (p.alto ?? 0), 0, w);
              const vuelta = proyectar(pose, g.w, g.h, w)!;
              const ida = aPantalla(cam, g.w, g.h, p.x, g.piso - (p.alto ?? 0));
              // Cae en la pantalla exactamente donde el 2D lo puso: ahí están su cara y su nombre.
              expect(vuelta.x).toBeCloseTo(ida.x, 6);
              expect(vuelta.y).toBeCloseTo(ida.y, 6);
              // En la pantalla la altura sobre el piso es exactamente la del montón del 2D (arriba). En el mundo 3D, una tarjeta
              // vertical vista desde arriba se acorta por el coseno del ángulo del rayo: se estira lo mismo para no perder la
              // posición, y con la cámara a 9 a 12 grados y el piso 11 a 16 grados más abajo eso es un 12 % como mucho.
              const alto = (w[1] - piso[1]) / s;
              if ((p.alto ?? 0) > 6 * g.k) expect(alto / (p.alto ?? 1)).toBeGreaterThan(0.99);
              if ((p.alto ?? 0) > 6 * g.k) expect(alto / (p.alto ?? 1)).toBeLessThan(1.12);
              return { id: p.id, x: w[0], y: w[1] };
            });
            // Quien está más a la izquierda en el 2D está más a la izquierda en el 3D, y quien está más alto, más alto
            // (los que miden lo mismo en el 2D no se comparan: el piso del 3D lleva una décima de píxel de la inclinación del director).
            for (let a = 0; a < puestos.length; a++) {
              for (let b = a + 1; b < puestos.length; b++) {
                const pa = puestos[a]!, pb = puestos[b]!, la = locales[a]!, lb = locales[b]!;
                if (Math.abs(pa.x - pb.x) > 0.5) expect(Math.sign(la.x - lb.x)).toBe(Math.sign(pa.x - pb.x));
                if (Math.abs((pa.alto ?? 0) - (pb.alto ?? 0)) > 1) expect(Math.sign(la.y - lb.y)).toBe(Math.sign((pa.alto ?? 0) - (pb.alto ?? 0)));
              }
            }
          }
        }
      });
    }
  }
});

describe("la cámara 3D mira lo que mira el director", () => {
  const g = geometria(1366, 768);
  const s = escala3D(g.u);

  it("apunta al mismo punto, a la altura del 2D, y se acerca con el zoom", () => {
    const a = poseFrontal(camaraTipica(g, 1), g.w, g.h, g.u, g.piso, ELEVACION, 0);
    const b = poseFrontal(camaraTipica(g, 2), g.w, g.h, g.u, g.piso, ELEVACION, 0);
    expect(a.mira[0]).toBeCloseTo((g.w / 2 + 40) * s, 9);
    expect(a.mira[1]).toBeCloseTo(190 * s, 9);
    const dist = (p: typeof a): number => Math.hypot(p.pos[0] - p.mira[0], p.pos[1] - p.mira[1], p.pos[2] - p.mira[2]);
    expect(dist(a) / dist(b)).toBeCloseTo(2, 9);
    // Con el acercamiento 1 se ve el alto del 2D en el plano de la piñata.
    expect(dist(a) * 2 * Math.tan(a.fov / 2) * Math.cos(0)).toBeCloseTo(g.h * s, 6);
  });

  it("el sacudón se copia como un corrimiento de la mira, no como un giro", () => {
    const a = poseFrontal(camaraTipica(g, 1.3, 0, 0), g.w, g.h, g.u, g.piso, ELEVACION, 0);
    const b = poseFrontal(camaraTipica(g, 1.3, 0, 12), g.w, g.h, g.u, g.piso, ELEVACION, 0);
    expect(b.giro).toBe(a.giro);
    expect(b.mira[0] - a.mira[0]).toBeCloseTo((-12 / 1.3) * s, 9);
  });

  it("el tilt del director se copia con tope de dos grados", () => {
    const p = poseFrontal(camaraTipica(g, 1.3, 0.5), g.w, g.h, g.u, g.piso, ELEVACION, 0);
    expect(Math.abs(p.giro)).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-12);
  });

  it("el horizonte no se inclina y el giro de entrada no pasa de tres grados", () => {
    expect(Math.abs(poseFrontal(camaraTipica(g, 1.3), g.w, g.h, g.u, g.piso, ELEVACION, azimutDe(0)).giro)).toBe(0);
    expect(azimutDe(0)).toBeLessThanOrEqual((3 * Math.PI) / 180 + 1e-9);
    expect(azimutDe(3)).toBe(0);
    expect(azimutDe(10)).toBe(0);
    // Baja de a poco: nunca de golpe.
    let antes = azimutDe(0);
    for (let t = 0.05; t <= 3.05; t += 0.05) {
      const a = azimutDe(t);
      expect(a).toBeLessThanOrEqual(antes + 1e-12);
      expect(antes - a).toBeLessThan(0.006);
      antes = a;
    }
  });

  it("la elevación sale de lo que el director ya hizo, entre 9 grados en los palos y un contrapicado leve al final", () => {
    expect(elevacionDe(1.2, -1, -9)).toBeCloseTo(ELEVACION, 9);
    // Con el acercamiento a la rajadura sube un poco, para verla de frente y de arriba.
    expect(elevacionDe(1.9, -1, -9)).toBeGreaterThan(elevacionDe(1.2, -1, -9));
    expect(elevacionDe(1.9, -1, -9)).toBeLessThan((14 * Math.PI) / 180);
    // Rota la piñata, baja con el caramelo; con el cartel queda apenas por debajo.
    expect(elevacionDe(1.5, 1.5, -2)).toBeLessThan(ELEVACION);
    expect(elevacionDe(1.3, 2, 1)).toBeLessThan(0);
    expect(elevacionDe(1.3, 2, 1)).toBeGreaterThan(-(3 * Math.PI) / 180);
    // Nunca de golpe: a 60 cuadros por segundo la cámara no se mueve más de 0,33 grados por cuadro (20 grados por segundo).
    let antes = elevacionDe(1.3, 0, -3);
    for (let t = -3; t < 4; t += 1 / 60) {
      const e = elevacionDe(1.3, t + 3, t);
      expect(Math.abs(e - antes)).toBeLessThan((0.33 * Math.PI) / 180);
      antes = e;
    }
  });

  it("la luz del mundo baja al 35 % en un cuarto de segundo con el golpe y vuelve al 60 % con el cartel", () => {
    expect(luzDeCorona(-5)).toBe(1);
    expect(luzDeCorona(0)).toBe(1);
    expect(luzDeCorona(0.25)).toBeCloseTo(0.35, 9);
    expect(luzDeCorona(0.5)).toBeCloseTo(0.35, 9);
    expect(luzDeCorona(2.2)).toBeCloseTo(0.6, 9);
    expect(luzDeCorona(30)).toBeCloseTo(0.6, 9);
  });
});

describe("el proyector lleva el 2D al 3D sin perder la posición, a cualquier profundidad", () => {
  it("un punto del 2D puesto en cualquier plano cae en el mismo píxel, y mide lo mismo en la pantalla con la compensación", () => {
    const g = geometria(390, 844);
    const cam = camaraTipica(g, 1.4, 0.015, 4);
    const pose = poseFrontal(cam, g.w, g.h, g.u, g.piso, 0.2, 0.03);
    const py = new Proyector();
    py.fijar(pose, cam, g.w, g.h);
    const a = [0, 0, 0] as [number, number, number], b = [0, 0, 0] as [number, number, number];
    for (const [x, y] of [[30, 100], [200, 400], [360, 700]] as const) {
      const ida = aPantalla(cam, g.w, g.h, x, y);
      py.plano(x, y, 0, a);
      for (const z of [-3 * g.R * escala3D(g.u), 0, 2 * g.R * escala3D(g.u)]) {
        py.plano(x, y, z, b);
        const p = proyectar(pose, g.w, g.h, b)!;
        expect(p.x).toBeCloseTo(ida.x, 6);
        expect(p.y).toBeCloseTo(ida.y, 6);
        // Más cerca de la cámara, el mismo tamaño en el mundo se ve más grande: se compensa por el cociente de profundidades.
        const comp = py.profundidad(b) / py.profundidad(a);
        expect(comp * (z > 0 ? 1 : 1)).toBeGreaterThan(0);
        if (z > 0) expect(comp).toBeLessThan(1);
        if (z < 0) expect(comp).toBeGreaterThan(1);
      }
    }
  });

  it("el rayo por el centro de la pantalla llega a la mira", () => {
    const g = geometria(1366, 768);
    const cam: Camara2D = { x: 700, y: 300, zoom: 1.2, rot: 0, sacudonX: 0, sacudonY: 0 };
    const pose = poseFrontal(cam, g.w, g.h, g.u, g.piso, 0.16, 0);
    const py = new Proyector();
    py.fijar(pose, cam, g.w, g.h);
    const p = py.plano(cam.x, cam.y, 0, [0, 0, 0]);
    expect(p[0]).toBeCloseTo(pose.mira[0], 6);
    expect(p[1]).toBeCloseTo(pose.mira[1], 6);
  });

  it("el piso se ve donde el 2D dice que está la línea del piso", () => {
    const g = geometria(1366, 768);
    const cam = camaraTipica(g, 1.3);
    const pose = poseFrontal(cam, g.w, g.h, g.u, g.piso, 0.16, 0);
    const py = new Proyector();
    py.fijar(pose, cam, g.w, g.h);
    const sobre = py.plano(cam.x, g.piso, 0, [0, 0, 0]);
    const pantalla = proyectar(pose, g.w, g.h, sobre)!;
    expect(pantalla.y).toBeCloseTo(aPantalla(cam, g.w, g.h, cam.x, g.piso).y, 6);
    // Y un punto sobre el piso, más cerca de la cámara, cae más abajo en la pantalla.
    const delante = py.suelo(cam.x, g.piso + 30, sobre[1], [0, 0, 0]);
    expect(delante[2]).toBeGreaterThan(0);
    expect(proyectar(pose, g.w, g.h, delante)!.y).toBeGreaterThan(pantalla.y);
  });
});

describe("el palo del chico toca la olla", () => {
  const ctx = (): Ctx => {
    const B = new Basura();
    return { motor: {} as Motor3D, B, tema: "claro", mat: new Materiales(B), escenario: new Group(), tinta: new MeshBasicMaterial(), inkHex: INK.claro };
  };

  for (const [w, h] of [[1366, 768], [390, 844]] as const) {
    it(`a ${w} por ${h}, en el cuadro del palo la punta queda adentro de la olla, a menos de un cuarto de radio de la superficie`, () => {
      const k = h / 720;
      const R = Math.min(h * 0.13, w * 0.12);
      const ks = k * (w > h ? 1.2 : 1);
      const piso = h - 0.2 * h - 58 * k;
      const ky = piso + 24 * k;
      const handY = ky - 66 * ks;
      const reach = PALO * ks + R * 0.8;
      for (const py of [handY - 0.75 * reach, handY - 0.9 * reach, handY - 0.5 * reach]) {
        const px = w * 0.5;
        // Donde se para el chico (`kidSpot` del 2D) y el ángulo del palo al pegar (`aim` de `drawKid`).
        const dy = Math.max(0.3 * reach, Math.min(0.95 * reach, handY - py));
        const kidX = px - Math.sqrt(reach * reach - dy * dy) - MANO_X * ks;
        const aim = Math.atan2(py - handY, px - (kidX + MANO_X * ks));
        const chico = crearChico(ctx());
        chico.poner({ x: kidX, y: piso - ky, z: 0, esc: ks, estira: 1, vueltas: 3, inclina: 0, paso: 0, amp: 0, palo: aim, mareo: 0, t: 5, remera: 0xe93d9c });
        const cx = px, cy = piso - py;
        const d = Math.hypot(chico.punta[0] - cx, chico.punta[1] - cy, chico.punta[2]);
        expect(d).toBeLessThanOrEqual(R * 1.001);
        expect(R - d).toBeLessThan(0.25 * R);
        expect(MANO_Y).toBe(66);
      }
    });
  }
});

describe("el 3D no decide nada ni delata a nadie", () => {
  const archivos = ["pinata-3d.ts", "pinata-3d-mapa.ts", "pinata-3d-patio.ts", "pinata-3d-pina.ts", "pinata-3d-chico.ts", "pinata-3d-piezas.ts", "pinata-3d-tipos.ts"];

  it("ningún archivo de la piñata en 3D nombra Math.random ni sabe quién gana", () => {
    for (const f of archivos) {
      // El lanzador del final recibe `winners` del sorteo y se lo pasa al 2D sin leerlo: no cuenta.
      const src = sinComentarios(fuente(f)).split("export const lanzador3D")[0] as string;
      expect(src, f).not.toContain("Math.random");
      expect(src, f).not.toMatch(/winnerIdx|winners|winC|rivalIdx|peekIdx/);
    }
  });

  it("la ganadora es un caramelo más hasta que el 2D la dibuja grande, después de la rotura", () => {
    const src = sinComentarios(pinataPixi);
    // Adentro de la olla, todos son iguales para el 3D: lo único que pasa es `dentro: true`.
    expect(src).toMatch(/o\.dentro = c\.inside;\s*if \(c\.inside\) continue;/);
    expect(src).toContain("o.ganadora = c === winC;");
    // El caramelo que se asoma lleva solo posición, tamaño y color: el mismo dibujo para la ganadora y la rival.
    expect(src).toMatch(/Object\.assign\(asoma3D, \{ ver: true, x: [^}]*color: S\.color\(peekIdx\) \}\)/);
  });

  it("la vista coloca todo con el proyector de la casa y no con una cuenta propia", () => {
    const src = sinComentarios(fuente("pinata-3d.ts"));
    expect(src).toContain("proy.plano(");
    expect(src).toContain("poseFrontal(");
    expect(src).toContain("elevacionDe(");
    // Dos ganadoras posibles en la misma ronda: la entrada que recibe la cámara no trae nada de la ganadora.
    expect(src).not.toMatch(/ca\.ganadora[^;]*(pose|cam)\b/);
  });

  it("el archivo del juego en 2D no trae three.js ni el motor: solo tipos y el enchufe", () => {
    const lineas = pinataPixi.split("\n").filter((l) => /^\s*import\s/.test(l) && /tres\//.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      expect(l).not.toMatch(/\/(motor|escena|figuras|pinata-3d)"/);
      expect(l).toMatch(/\/(enchufe|tipos|pinata-3d-tipos)"/);
    }
    expect(pinataPixi).toContain("enchufar3D(S, tres)");
    expect(pinataPixi).toContain("{ transparente: !!tres }");
  });

  it("sin 3D el 2D queda como estaba: se apaga solo si hay vista", () => {
    const src = sinComentarios(pinataPixi);
    expect(src).toMatch(/function apagar2D\(\): void \{\s*if \(!v3\) return;/);
  });

  it("la entrada se arma después de dibujar el cuadro, con la cámara ya aplicada", () => {
    const src = sinComentarios(pinataPixi);
    expect(src.indexOf("cam.apply(S.scene")).toBeGreaterThan(0);
    expect(src).toMatch(/draw\(now\);\s*frame3D\(\);/);
    expect(src.indexOf("cam.apply(S.scene")).toBeLessThan(src.search(/draw\(now\);\s*frame3D\(\);/));
  });
});
