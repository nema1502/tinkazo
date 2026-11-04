import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { aplicarPose } from "./camara";
import { compararPuestos, ganaIgual, type Puesto2D } from "./prueba";
import { ALZA, PERFIL_TELEFERICO, alMundo, deMundo, mapaTeleferico, poseLateral } from "./teleferico-mapa";
import type { Camara2D } from "./tipos";

/**
 * El 3D del teleférico no decide nada: dibuja lo que el plan 2D ya decidió. Estas pruebas cuidan que las cabinas del
 * 3D caigan donde el 2D las puso (en el mundo y en la pantalla), que el orden y el ganador no cambien, y que el 3D no
 * pueda saber quién gana antes del golpe.
 */

/** El plan toma `clamp` de overlay.ts, que lee `location` al cargarse, y vitest corre en Node. */
let planCableCar: typeof import("../pixi/cablecar-plan").planCableCar;
let T_BOARD: number, T_DOCK: number, T_CROWN: number;
beforeAll(async () => {
  vi.stubGlobal("location", { search: "" });
  ({ planCableCar, T_BOARD, T_DOCK, T_CROWN } = await import("../pixi/cablecar-plan"));
}, 60_000);

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
const aqui = new URL(".", import.meta.url);
const fuente = (f: string): string => readFileSync(new URL(f, aqui), "utf8");

/** La geometría del 2D (`geo()` en cablecar.ts) para una pantalla horizontal y una vertical. */
function geo(w: number, h: number) {
  const u = h / 720;
  const vertical = h > w;
  const k = Math.min(u, w / 720);
  const theta = vertical ? 0.95 : 0.4;
  return { u, k, vertical, dir: { x: Math.cos(theta), y: -Math.sin(theta) }, span: vertical ? h * 0.52 : w * 0.62, cw: 104 * k, ch: 78 * k, gap: 132 * k };
}

type Plan = ReturnType<typeof planCableCar>;

/** Dónde cuelga la cabina `cab` a la hora `x`, en el mundo 2D: lo mismo que `cabPoint` de cablecar.ts. */
function cabPoint(P: Plan, G: ReturnType<typeof geo>, cab: number, x: number): { x: number; y: number } {
  const SLIP = 0.95;
  const td = P.detachT[cab] as number;
  let back = 0;
  if (x > td) {
    const since = x - td;
    back = 0.5 * 2.2 * since * since * 140 * G.k;
  }
  const resbala = cab === P.winnerCab ? P.slipAt(x) * G.gap * SLIP : 0;
  const d = P.headAt(x) * G.span - (P.slotAt(cab, x) * G.gap + back + resbala);
  return { x: G.dir.x * d, y: G.dir.y * d };
}

const QS = [0.25, 0.5, 0.75, 1];

describe("el 3D dibuja las posiciones del plan 2D", () => {
  it("la cuenta del 2D que usa esta prueba es la que está escrita en cablecar.ts", () => {
    const f = fuente("../pixi/cablecar.ts");
    expect(f).toContain("const resbala = cab === slipCab ? P.slipAt(x) * G.gap * SLIP : 0;");
    expect(f).toContain("const p = pt(P.headAt(x), P.slotAt(cab, x) * G.gap + back + resbala);");
    expect(f).toContain("back = 0.5 * 2.2 * since * since * 140 * G.k;");
    expect(f).toContain("const d = pos * G.span - off;");
    expect(f).toContain("return { x: G.dir.x * d, y: G.dir.y * d };");
  });

  for (const n of [5, 8, 18, 30, 200]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 75 % y en la llegada cada cabina cae donde el plan la manda`, () => {
        const ganador = n > 3 ? 3 : 0;
        const P = planCableCar(lista(n), [ganador], rngOf(semilla));
        for (const [w, h] of [[1366, 768], [390, 844]] as const) {
          const G = geo(w, h);
          const mapa = mapaTeleferico(G.u);
          const horas = [...QS.map((q) => T_BOARD + q * (T_DOCK - T_BOARD)), T_DOCK];
          for (const x of horas) {
            const puestos: Puesto2D[] = [];
            for (let cab = 0; cab < P.C; cab++) {
              const p = cabPoint(P, G, cab, x);
              // El 2D tiene la `y` hacia abajo y el 3D la altura hacia arriba: `alto = -y`.
              puestos.push({ id: cab, x: p.x, y: 0, alto: -p.y });
              const v = alMundo(mapa, p.x, p.y);
              const vuelta = deMundo(mapa, v[0], v[1]);
              expect(vuelta.x).toBeCloseTo(p.x, 6);
              expect(vuelta.y).toBeCloseTo(p.y, 6);
              // El plano del cable es el de las cabinas: ninguna se corre hacia el fondo.
              expect(v[2]).toBe(0);
            }
            // Con la misma cuenta del mapa de la casa, la posición vuelve intacta.
            expect(compararPuestos(puestos, PERFIL_TELEFERICO, G.u)).toEqual([]);
          }
          // La cabina de los dos que llegan es la que más lejos llega a lo largo del cable.
          const llegada = cabPoint(P, G, P.winnerCab, T_DOCK);
          const final: Puesto2D[] = Array.from({ length: P.C }, (_, cab) => {
            const p = cabPoint(P, G, cab, T_DOCK);
            return { id: cab, x: p.x, y: 0, alto: -p.y };
          }).filter((p) => (P.detachT[p.id] as number) === Infinity);
          expect(final.map((p) => p.id)).toContain(P.winnerCab);
          expect(ganaIgual(final, P.winnerCab, PERFIL_TELEFERICO, G.u)).toBe(true);
          expect(llegada.x).toBeCloseTo(G.dir.x * P.TOP * G.span, 6);
        }
      });
    }
  }
});

describe("la cámara 3D cae donde la del director", () => {
  /** Proyecta un punto 3D con la cámara que arma el motor (pose, lente corrida y giro). */
  function proyectar(cam: Camara2D, w: number, h: number, u: number, alza: number, punto: [number, number, number]): { x: number; y: number } {
    const pose = poseLateral(cam, h, u, alza);
    const c = new PerspectiveCamera(36, 1, 0.5, 4000);
    c.setViewOffset(w, h, pose.corrimiento.x, pose.corrimiento.y, w, h);
    aplicarPose(c, { pos: pose.pos, mira: pose.mira, fov: pose.fov, giro: pose.giro }, w / h);
    const v = new Vector3(...punto).project(c);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }
  /** Lo que hace PixiJS con la escena del director: centrar, acercar y girar (el sacudón es un corrimiento). */
  function proyectar2D(cam: Camara2D, w: number, h: number, x: number, y: number): { x: number; y: number } {
    const dx = (x - cam.x) * cam.zoom, dy = (y - cam.y) * cam.zoom;
    const c = Math.cos(cam.rot), s = Math.sin(cam.rot);
    return { x: w / 2 + (cam.sacudonX || 0) + dx * c - dy * s, y: h / 2 + (cam.sacudonY || 0) + dx * s + dy * c };
  }

  const casos: Camara2D[] = [
    { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
    { x: 340, y: -150, zoom: 1.55, rot: 0, sacudonX: 0, sacudonY: 0 },
    { x: 900, y: -420, zoom: 2.1, rot: 0, sacudonX: 6, sacudonY: -4 },
    { x: 1500, y: -700, zoom: 0.8, rot: 0.035, sacudonX: 0, sacudonY: 0 },
    { x: 220, y: -90, zoom: 1.35, rot: -0.03, sacudonX: -3, sacudonY: 5 },
  ];

  for (const [w, h] of [[1366, 768], [390, 844], [844, 390]] as const) {
    it(`a ${w} por ${h} el centro de una cabina cae a 2 píxeles o menos del que le da el 2D, en cualquier fase`, () => {
      const u = h / 720;
      const mapa = mapaTeleferico(u);
      for (const cam of casos) {
        for (const alza of Object.values(ALZA)) {
          for (const dp of [{ x: 0, y: 0 }, { x: 120, y: -50 }, { x: -200, y: 80 }, { x: 60, y: 140 }]) {
            const x2 = cam.x + dp.x, y2 = cam.y + dp.y;
            const q3 = proyectar(cam, w, h, u, alza, alMundo(mapa, x2, y2));
            // Con giro, el 2D gira la escena sobre el centro de la pantalla; el sacudón se suma después.
            const q2 = proyectar2D({ ...cam }, w, h, x2, y2);
            expect(Math.abs(q3.x - q2.x)).toBeLessThan(2);
            expect(Math.abs(q3.y - q2.y)).toBeLessThan(2);
          }
        }
      }
    });
  }
});

describe("el 3D no puede saber quién gana antes del golpe", () => {
  const f3 = fuente("teleferico-3d.ts");
  const f2 = fuente("../pixi/cablecar.ts");

  it("el 2D le pasa los ganadores recién cuando suena el golpe", () => {
    expect(f2).toContain("ganadores: sinGolpe > 0 ? winners : []");
  });

  it("el módulo 3D no recibe el índice del ganador ni lo nombra, y no usa azar", () => {
    // `winners` solo aparece para pasárselo tal cual al 2D en el lanzador.
    expect(f3.replace("(names, winners, beacon, done) => m.cableCarPixi(names, winners, beacon, done, montaje)", "")).not.toMatch(/winnerIdx|winnerCab|winners\b/);
    expect(f3).not.toMatch(/Math\.random/);
    // Las únicas cabinas que se distinguen son las que dice el 2D (su color de línea, su luz), no la que gana.
    expect(f3).not.toMatch(/ganador(a)?Cab|esGanador/);
  });

  it("el 2D no trae three.js ni el motor del 3D: solo tipos y el enchufe", () => {
    const imports = f2.split("\n").filter((l) => /^import /.test(l) && l.includes("../tres/"));
    for (const l of imports) {
      expect(l).toMatch(/enchufe|import type/);
    }
    expect(f2).not.toMatch(/from "three"/);
  });
});
