import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { aplicarPose } from "./camara";
import { T_BRAKE, T_CREEP, T_CROWN, T_HOLD, T_LOCK, T_SETTLE, T_SPIN, T_WIND } from "../pixi/wheel-beats";
import { planWheelMotion } from "../pixi/wheel-motion";
import type { EntradaBase } from "./tipos";
import { escala3D } from "./camara";
import { anguloCamara, aMundoRueda, corona, gajoBajoLaFlecha3D, luzDelMundo, poseRueda, rotacionDisco } from "./wheel-3d";

/**
 * La ruleta en 3D no decide nada: dibuja lo que `pixi/wheel.ts` ya decidió. Estas pruebas cuidan que la cuenta que lleva
 * la rueda del 2D al 3D conserve donde está cada cosa, que el gajo bajo la flecha sea el mismo, que la cámara no sepa
 * quién gana, y que el archivo del juego en 2D no traiga three.js.
 */

const dosD = readFileSync(new URL("../pixi/wheel.ts", import.meta.url), "utf8");
const tresD = readFileSync(new URL("./wheel-3d.ts", import.meta.url), "utf8");

/** Un rng sembrado y simple (mulberry32), como el de wheel-motion.test.ts. */
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

/** El gajo bajo la flecha como lo cuenta `segUnder` de pixi/wheel.ts. */
const segUnder2D = (rot: number, segs: number): number => {
  const A = (Math.PI * 2) / segs;
  return Math.floor((((-rot / A) % segs) + segs) % segs) % segs;
};

const entrada = (w: number, h: number, cam: Partial<EntradaBase["cam"]> = {}): EntradaBase => ({
  t: 8, w, h, u: h / 720, cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0, ...cam },
});

describe("la ruleta en 3D usa las cuentas del 2D", () => {
  it("el 2D gira la rueda con `wheel.rotation = rot` y el 3D la gira al revés (la pantalla baja, el 3D sube)", () => {
    expect(dosD).toContain("wheel.rotation = rot;");
    expect(rotacionDisco(0.7)).toBeCloseTo(-0.7, 12);
    expect(tresD).toContain("rueda.rotation.z = rotacionDisco(e.angulo);");
  });

  it("el archivo del juego en 2D solo importa tipos del 3D (no trae three.js ni el motor)", () => {
    const lineas = dosD.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l) && /tres\//.test(l));
    expect(lineas.length).toBeGreaterThan(0);
    for (const l of lineas) {
      if (/tres\/(wheel-3d|tipos)/.test(l)) expect(l).toMatch(/^\s*import\s+type\b/);
      else expect(l).toContain("tres/enchufe");
    }
  });

  it("la vista 3D no usa Math.random ni recibe a quien gana antes del golpe", () => {
    const sinComentarios = tresD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(sinComentarios).not.toContain("Math.random");
    // El 2D solo pasa los gajos que ganan desde la coronación.
    expect(dosD).toContain("ganan: tAll >= T_CROWN ? gananJ : null");
  });
});

describe("el gajo bajo la flecha es el mismo en el 2D y en el 3D", () => {
  // Las cuatro horas que importan, en 16 semillas y con distinta cantidad de personas (y de gajos).
  const horas = [T_CREEP, T_HOLD, T_LOCK, T_CROWN];
  for (const n of [2, 5, 18, 40]) {
    it(`con ${n} personas, en T_CREEP, T_HOLD, T_LOCK y T_CROWN, 16 semillas`, () => {
      const rep = n <= 12 ? Math.max(1, Math.round(24 / n)) : 1;
      const segs = n > 24 ? 24 : n * rep;
      const ciclo = n > 24 ? 24 : n;
      const A = (Math.PI * 2) / segs;
      for (let seed = 1; seed <= 16; seed++) {
        const rng = rngOf(seed * 977);
        const startSeg = rng() * segs;
        const landing = (seed % ciclo) + ciclo * Math.floor(rng() * (segs / ciclo)) + 0.5;
        const falsa = seed % 3 === 0;
        const m = planWheelMotion({ segs, ciclo, startSeg, landing, falsa, rng });
        for (const t of horas) {
          const rot = -(startSeg + m.pos(t)) * A;
          expect(gajoBajoLaFlecha3D(rotacionDisco(rot), segs), `n=${n} semilla=${seed} t=${t}`).toBe(segUnder2D(rot, segs));
        }
      }
    });
  }

  it("el gajo ganador queda bajo la flecha también en el 3D al final", () => {
    for (const n of [2, 7, 18, 24]) {
      const rep = n <= 12 ? Math.max(1, Math.round(24 / n)) : 1;
      const segs = n * rep;
      const A = (Math.PI * 2) / segs;
      for (let seed = 1; seed <= 16; seed++) {
        const rng = rngOf(seed * 31 + n);
        const startSeg = rng() * segs;
        const ganador = seed % n;
        const winSeg = ganador + n * Math.floor(rng() * rep);
        const landing = winSeg + 0.5 + (rng() - 0.5) * 0.6;
        const m = planWheelMotion({ segs, ciclo: n, startSeg, landing, falsa: false, rng });
        const rot = -(startSeg + m.total) * A;
        const j = gajoBajoLaFlecha3D(rotacionDisco(rot), segs);
        expect(j % n).toBe(ganador);
      }
    }
  });
});

describe("la cámara 3D", () => {
  const proyectar = (e: EntradaBase, az: number, el: number, x: number, y: number): { x: number; y: number } => {
    const s = escala3D(e.u);
    const cam = new PerspectiveCamera();
    aplicarPose(cam, poseRueda(e, s, az, el), e.w / e.h);
    const [px, py, pz] = aMundoRueda(x, y, s);
    const v = new Vector3(px, py, pz).project(cam);
    return { x: ((v.x + 1) / 2) * e.w, y: ((1 - v.y) / 2) * e.h };
  };

  for (const [w, h] of [[1366, 768], [390, 844], [1920, 1080]] as const) {
    it(`a ${w} por ${h}, mirando de frente, un punto de la rueda cae en el píxel donde lo pone el 2D`, () => {
      for (const cam of [{ x: 0, y: 0, zoom: 1 }, { x: 120, y: -90, zoom: 2.3 }, { x: -200, y: 40, zoom: 0.84 }, { x: 30, y: -250, zoom: 1.9, sacudonX: 6, sacudonY: -4 }]) {
        const e = entrada(w, h, cam);
        for (const [x, y] of [[0, 0], [100, -150], [-80, 60], [0, -250]] as const) {
          const p = proyectar(e, 0, 0, x, y);
          // Cómo lo pone el 2D: el centro de la pantalla es (cam.x, cam.y) corrido el sacudón, y todo se agranda `zoom` veces.
          const z = cam.zoom, sx = (cam as { sacudonX?: number }).sacudonX ?? 0, sy = (cam as { sacudonY?: number }).sacudonY ?? 0;
          expect(p.x).toBeCloseTo(w / 2 + (x - (cam.x - sx / z)) * z, 5);
          expect(p.y).toBeCloseTo(h / 2 + (y - (cam.y - sy / z)) * z, 5);
        }
      }
    });
  }

  it("con la cámara alzada y girada el centro de la pantalla sigue siendo el punto que mira el director", () => {
    const e = entrada(1366, 768, { x: 50, y: -100, zoom: 1.6 });
    for (const t of [0, 0.6, T_WIND, 6, T_BRAKE, T_HOLD, T_CROWN, T_CROWN + 1]) {
      const { az, el } = anguloCamara(t);
      const p = proyectar(e, az, el, 50, -100);
      expect(p.x).toBeCloseTo(683, 4);
      expect(p.y).toBeCloseTo(384, 4);
    }
  });

  it("el giro y la altura son solo de la hora, con topes: 10 grados de giro, 12 de altura y menos de 20 grados por segundo", () => {
    let maxAz = 0, maxEl = 0, maxVel = 0, prev = anguloCamara(0);
    for (let t = 0.01; t <= T_CROWN + 4; t += 0.01) {
      const a = anguloCamara(t);
      maxAz = Math.max(maxAz, Math.abs(a.az));
      maxEl = Math.max(maxEl, a.el);
      maxVel = Math.max(maxVel, Math.abs(a.az - prev.az) / 0.01, Math.abs(a.el - prev.el) / 0.01);
      prev = a;
    }
    expect(maxAz).toBeLessThanOrEqual((10 * Math.PI) / 180 + 1e-9);
    expect(maxEl).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-9);
    expect(maxVel).toBeLessThan((20 * Math.PI) / 180);
    // Y el arranque de la rueda llega de frente: pasado T_WIND ya no hay giro.
    expect(anguloCamara(T_WIND).az).toBeCloseTo(0, 12);
    expect(anguloCamara(T_SPIN).az).toBeCloseTo(0, 12);
  });

  it("la cámara no sabe quién gana: la pose sale solo de la hora y de la cámara del director", () => {
    expect(poseRueda.length).toBe(4);
    expect(anguloCamara.length).toBe(1);
    const base = entrada(1366, 768, { x: 10, y: -60, zoom: 2 });
    const a = poseRueda({ ...base, t: T_CROWN - 0.01 }, 0.1, ...Object.values(anguloCamara(T_CROWN - 0.01)) as [number, number]);
    const b = poseRueda({ ...(base as EntradaBase & { ganan: number[] | null }), t: T_CROWN - 0.01, ganan: [3] } as EntradaBase, 0.1, ...Object.values(anguloCamara(T_CROWN - 0.01)) as [number, number]);
    expect(b).toEqual(a);
  });
});

describe("la luz y la corona", () => {
  it("la luz baja al 35 % en 0,25 s del golpe y vuelve al 60 %; antes del golpe no se mueve", () => {
    expect(luzDelMundo(0)).toBe(1);
    expect(luzDelMundo(T_CROWN - 0.001)).toBe(1);
    expect(luzDelMundo(T_CROWN + 0.25)).toBeCloseTo(0.35, 12);
    expect(luzDelMundo(T_CROWN + 3)).toBeCloseTo(0.6, 12);
    expect(corona(T_SETTLE)).toBe(0);
    expect(corona(T_CROWN + 0.5)).toBe(1);
  });
});
