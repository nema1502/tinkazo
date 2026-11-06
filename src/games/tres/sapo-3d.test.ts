import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { planQualifier } from "../pixi/qualifier";
import { HAND, MOMENTOS_MONEDA, MOUTH, SAPO_MAX, holeLayout, optsForArc, planThrows, tomasDeTiros, type Point } from "../pixi/sapo-plan";
import { AFTER_FINAL, Q_FLY, Q_SHOW, Q_WAVE, SINK, WOBBLE, tiemposDeTiros } from "../pixi/sapo-tiempos";
import { assignSlots } from "../pixi/slots";
import { aplicarPose, crearMapa, poseCamara, type Pose3D } from "./camara";
import { compararPuestos, type Puesto2D } from "./prueba";
import {
  SEGUIR, TAPA_Y, ZOOM_MAX, alturaRana, camaraDelSapo, camaraDelTiro, cercaniaDelTiro, deltaCamara, elevacionDe, lugarDelMundo, luzDelGolpe, mezclarPose,
  perfilDelTiro, perfilSapo, pesoMoneda, poseArgolla, poseMoneda, tomaDeArgolla, type ArgollaSapo, type EstadoArgolla,
} from "./sapo-3d";

/**
 * El sapo en 3D no decide nada: dibuja lo que el plan 2D ya puso. Estas pruebas cuidan que las posiciones que dibuja son
 * las del plan (ida y vuelta por la cuenta de la casa, mismo orden), que quien gana en el 2D es el agujero más cercano a la
 * última argolla en el 3D, que ninguna argolla se mete por debajo de la tapa fuera de su agujero y que la cámara no
 * depende de quién gana.
 */

const aqui = new URL(".", import.meta.url);
const fuente = (f: string): string => readFileSync(new URL(f, aqui), "utf8");

function rngOf(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lo mismo que arma `sapoPixi` antes de dibujar, sin Pixi: la clasificatoria, los agujeros, los tiros y sus horas. */
function planSapo(all: number, ganadores: number[], semilla: number) {
  const rng = rngOf(semilla);
  const prizesAll = [...ganadores].reverse();
  const Q = planQualifier(all, prizesAll, SAPO_MAX, rng);
  const n = Q.finalists.length;
  const prizes = Q.finalWinners;
  const last = prizes.length - 1;
  const L = holeLayout(n);
  const story = writeStory(rng, Math.max(2, n), (prizes[last] as number) % Math.max(2, n));
  const plan = assignSlots(n, prizes, rng);
  const throws = planThrows(n, plan.winnerSlots, rng, optsForArc(story.arc), true);
  const tSeated = Q_SHOW + Q.waves.length * Q_WAVE + Q_FLY;
  const linea = tiemposDeTiros(throws, last, tSeated);
  return { L, plan, throws, linea, Q, last };
}

/** La pantalla de ejemplo: centro, píxeles por unidad de la mesa y aplastamiento (ancho 1366 y celular 390). */
const PANTALLAS = [
  { nombre: "ancho", mesa: { cx: 683, cy: 330, sc: 250, tilt: 0.62 }, u: 1.067 },
  { nombre: "celular", mesa: { cx: 195, cy: 380, sc: 110, tilt: 0.95 }, u: 0.54 },
];
const P = (m: { cx: number; cy: number; sc: number; tilt: number }, p: Point): Point => ({ x: m.cx + p.x * m.sc, y: m.cy + p.y * m.sc * m.tilt });

const QS = [0.25, 0.5, 0.7, 0.88, 1];

describe("el 3D dibuja las posiciones del plan 2D del sapo", () => {
  for (const pant of PANTALLAS) {
    for (const personas of [5, 18, 30]) {
      for (const semilla of [1, 2, 3, 4]) {
        it(`${pant.nombre}, ${personas} personas, semilla ${semilla}: agujeros y argollas vuelven intactos y en el mismo orden`, () => {
          const ganadores = [semilla % personas];
          const { L, throws, linea } = planSapo(personas, ganadores, semilla);
          const perfil = perfilSapo(pant.mesa.tilt);
          for (const q of QS) {
            const t = linea.corona * q;
            const puestos: Puesto2D[] = L.holes.map((h, s) => {
              const p = P(pant.mesa, h);
              return { id: s, x: p.x, y: p.y, alto: 0 };
            });
            throws.forEach((th, i) => {
              if (t < (linea.tiros[i] as { land: number }).land) return;
              const p = P(pant.mesa, th.landing);
              puestos.push({ id: 100 + i, x: p.x, y: p.y, alto: i % 3 === 0 ? 14 : 0 });
            });
            expect(compararPuestos(puestos, perfil, pant.u)).toEqual([]);
          }
        });
      }
    }
  }

  it("el grupo de la mesa lleva cada punto al mismo lugar que la cuenta de la casa", () => {
    for (const pant of PANTALLAS) {
      const perfil = perfilSapo(pant.mesa.tilt);
      const mapa = crearMapa(perfil, pant.u);
      const { px, pz, K, Kz } = lugarDelMundo(mapa, pant.mesa);
      const L = holeLayout(12);
      for (const h of L.holes) {
        const dos = P(pant.mesa, h);
        const [x3, , z3] = mapa.a3D(dos.x, dos.y, 0);
        // El punto de la mesa, por el grupo (posición + escala) y por la cuenta directa, es el mismo.
        expect(px + K * h.x).toBeCloseTo(x3, 6);
        expect(pz + Kz * h.y).toBeCloseTo(z3, 6);
      }
      // La altura de la mesa (un punto levantado `a` unidades) es la altura del dibujo a la misma escala.
      const [, y3] = mapa.a3D(0, 0, 0.5 * pant.mesa.sc);
      expect(K * 0.5).toBeCloseTo(y3, 6);
    }
  });

  for (const personas of [5, 18, 30]) {
    for (const semilla of [1, 2, 3, 4, 5, 6]) {
      it(`${personas} personas, semilla ${semilla}: el agujero más cercano a la última argolla, en 3D, es el de quien gana en el 2D`, () => {
        const ganadores = [semilla % personas, (semilla + 1) % personas].slice(0, semilla % 2 ? 1 : 2);
        const { L, plan, throws, last } = planSapo(personas, ganadores, semilla);
        const pant = PANTALLAS[semilla % 2] as (typeof PANTALLAS)[number];
        const mapa = crearMapa(perfilSapo(pant.mesa.tilt), pant.u);
        const { px, pz, K, Kz } = lugarDelMundo(mapa, pant.mesa);
        const aqui3D = (p: Point): [number, number] => [px + K * p.x, pz + Kz * p.y];
        const fin = throws[throws.length - 1] as (typeof throws)[number];
        const [lx, lz] = aqui3D(fin.landing);
        let mejor = -1, d = Infinity;
        L.holes.forEach((h, s) => {
          const [hx, hz] = aqui3D(h);
          const dd = Math.hypot(hx - lx, hz - lz);
          if (dd < d) { d = dd; mejor = s; }
        });
        expect(mejor).toBe(plan.winnerSlots[last]);
        // Y la última argolla cae adentro del aro de su agujero, con la escala del 3D.
        expect(d).toBeLessThan(L.holeR * K);
      });
    }
  }
});

/** Una argolla de ejemplo en el estado dado. */
const arg = (estado: EstadoArgolla, resto: Partial<ArgollaSapo> = {}): ArgollaSapo => ({
  estado, suelo: { x: 0.3, y: 0.7 }, alto: 0, escala: 1, alfa: 1, u: 0, edad: 0, ultima: false, borde: null, ...resto,
});

const FR = 0.34, BR = 0.08;
const MANO = [HAND.x * 0.86, 0.13, HAND.y * 0.82] as const;
const BOCA = [0, 0.72 * FR, 0.5 * FR] as const;

describe("ninguna argolla se mete por debajo de la tapa fuera de un agujero", () => {
  it("en el baile del borde, el punto más bajo nunca baja de la tapa (con cualquier inclinación y rumbo)", () => {
    const L = holeLayout(12);
    for (let s = 0; s < L.holes.length; s++) {
      const h = L.holes[s] as Point;
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const suelo = { x: h.x + Math.cos(ang) * L.holeR * 1.3, y: h.y + Math.sin(ang) * L.holeR * 1.3 };
        for (let i = 0; i <= 40; i++) {
          const u = i / 40;
          const hop = BR * 0.9 * (1 - u) * Math.abs(Math.sin(u * WOBBLE * 15));
          const p = poseArgolla(arg("baile", { suelo, borde: h, u, edad: u * WOBBLE, alto: hop }), BR, FR, MANO, BOCA);
          expect(p.bajo).toBeGreaterThanOrEqual(TAPA_Y - 1e-9);
          expect(p.visible).toBe(true);
        }
      }
    }
  });

  it("en el vuelo, al rodar y al salir de la boca nunca baja de la tapa", () => {
    for (const estado of ["vuelo", "rueda", "boca-sale"] as const) {
      for (let i = 0; i <= 50; i++) {
        const u = i / 50;
        const alto = 4 * 0.9 * u * (1 - u);
        for (const suelo of [{ x: 0.9, y: 0.4 }, { x: -1, y: -0.5 }, MOUTH, { x: 0.05, y: 0.05 }]) {
          const p = poseArgolla(arg(estado, { suelo, alto, u, edad: u * 0.8 }), BR, FR, MANO, BOCA);
          expect(p.bajo).toBeGreaterThanOrEqual(TAPA_Y - 1e-9);
        }
      }
    }
  });

  it("solo la argolla que cae en su agujero se hunde por debajo de la tapa", () => {
    const hunde = poseArgolla(arg("hunde", { u: 0.9 }), BR, FR, MANO, BOCA);
    expect(hunde.y).toBeLessThan(0);
    // Y al terminar de hundirse ya no se ve.
    expect(poseArgolla(arg("hunde", { u: 1 }), BR, FR, MANO, BOCA).visible).toBe(false);
    // Ningún otro estado baja de la tapa en su punto de reposo.
    for (const estado of ["mano", "vuelo", "rueda", "baile", "boca-sale"] as const) {
      expect(poseArgolla(arg(estado, { u: 0.3, edad: 0.2 }), BR, FR, MANO, BOCA).bajo).toBeGreaterThanOrEqual(TAPA_Y - 1e-9);
    }
  });

  it("la rana no se atraviesa: encima de su cuerpo la argolla queda por encima", () => {
    for (const x of [-0.2, 0, 0.2]) {
      for (const z of [-0.2, 0, 0.1]) {
        const cuerpo = alturaRana(x, z, FR);
        const p = poseArgolla(arg("vuelo", { suelo: { x, y: z }, u: 0.9, alto: 0 }), BR, FR, MANO, BOCA);
        expect(p.y).toBeGreaterThanOrEqual(cuerpo);
      }
    }
  });

  it("solo en el 2D hay un estado que se hunde: el 3D no inventa ningún hundimiento propio", () => {
    const f = fuente("../pixi/sapo.ts");
    // "hunde" lo produce tokenAt únicamente en la rama del tiro que entra (kind === "hit").
    const idx = f.indexOf('st: "hunde"');
    expect(idx).toBeGreaterThan(0);
    const antes = f.slice(Math.max(0, idx - 400), idx);
    expect(antes).toContain('o.th.kind === "hit"');
  });
});

describe("la cámara 3D sigue al director y no sabe quién gana", () => {
  it("entra 6 grados más alta, baja a su altura en 2,5 s, y con la tensión baja 4 grados más; en el golpe, 3", () => {
    expect(deltaCamara(0, 0, -1)).toBeCloseTo((6 * Math.PI) / 180, 2);
    expect(deltaCamara(2.5, 0, -1)).toBeCloseTo(0, 6);
    expect(deltaCamara(10, 1, -1)).toBeCloseTo((-4 * Math.PI) / 180, 2);
    expect(deltaCamara(20, 1, 19.9)).toBeLessThan(deltaCamara(20, 1, -1) + 1e-9);
    // Nunca mareante: ni 12 grados de diferencia en todo el show.
    for (let t = 0; t < 30; t += 0.1) expect(Math.abs(deltaCamara(t, Math.min(1, t / 20), t > 25 ? 25 : -1))).toBeLessThan((12 * Math.PI) / 180);
  });

  it("la cámara depende del reloj, de la tensión y del golpe, y de nada más (no recibe quién gana)", () => {
    const src = fuente("sapo-3d.ts");
    const firma = src.slice(src.indexOf("export function deltaCamara"), src.indexOf("export function luzDelGolpe"));
    expect(firma).toContain("(t: number, tension: number, golpe: number)");
    expect(firma).not.toMatch(/ganador|winner|slot/i);
  });

  it("la elevación sale del aplastamiento del 2D: 38 grados de frente a la pantalla ancha, 63 en el celular", () => {
    expect((elevacionDe(0.62) * 180) / Math.PI).toBeCloseTo(38.3, 0);
    expect((elevacionDe(0.95) * 180) / Math.PI).toBeCloseTo(63, 0);
  });

  it("el acercamiento del director se recorta en 3D para que la mesa entera siga en cuadro, sin saltos y sin saber quién gana", () => {
    const w = 1366, h = 768;
    const base = { x: w / 2, y: h / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
    // Hasta el tope, la cámara es la del director, tal cual.
    for (const z of [0.7, 1, ZOOM_MAX]) expect(camaraDelSapo({ ...base, zoom: z, x: 900, y: 200 }, w, h)).toEqual({ ...base, zoom: z, x: 900, y: 200 });
    // Más allá, el zoom queda en el tope y el centro vuelve hacia el de la pantalla.
    const c = camaraDelSapo({ ...base, zoom: 1.5, x: 900, y: 200 }, w, h);
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(Math.abs(c.x - w / 2)).toBeLessThan(Math.abs(900 - w / 2));
    expect(Math.abs(c.y - h / 2)).toBeLessThan(Math.abs(200 - h / 2));
    // Continua: pasar el tope por un pelo no mueve la cámara.
    const a = camaraDelSapo({ ...base, zoom: ZOOM_MAX, x: 900, y: 200 }, w, h);
    const b = camaraDelSapo({ ...base, zoom: ZOOM_MAX + 0.001, x: 900, y: 200 }, w, h);
    expect(Math.abs(a.x - b.x)).toBeLessThan(3);
    expect(Math.abs(a.y - b.y)).toBeLessThan(3);
    const src = fuente("sapo-3d.ts");
    const firma = src.slice(src.indexOf("export function camaraDelSapo"), src.indexOf("export function deltaCamara"));
    expect(firma).not.toMatch(/ganador|winner|slot/i);
  });

  it("la luz baja al golpe en 0,25 s y vuelve un poco mientras dura el cartel", () => {
    expect(luzDelGolpe(5, -1)).toBe(1);
    expect(luzDelGolpe(5, 6)).toBe(1);
    expect(luzDelGolpe(6.25, 6)).toBeCloseTo(0.5, 2);
    expect(luzDelGolpe(8, 6)).toBeGreaterThan(0.6);
    expect(luzDelGolpe(8, 6)).toBeLessThan(0.75);
  });
});

describe("el sapo en 3D usa la casa y no cambia lo que pasa", () => {
  it("coloca con el mapa de la casa, sin azar y sin importar el motor desde el 2D", () => {
    const tres = fuente("sapo-3d.ts");
    expect(tres).toContain("mapa.a3D(");
    expect(tres).not.toContain("Math.random");
    const dos = fuente("../pixi/sapo.ts");
    const importes = dos.split("\n").filter((l) => /^\s*import\s/.test(l) && l.includes("/tres/"));
    for (const l of importes) expect(l, l).toMatch(/import type\b|\/tres\/enchufe"/);
    expect(dos).not.toMatch(/from "three"/);
  });

  it("el 2D no le pasa al 3D nada del ganador antes de que su argolla caiga", () => {
    const dos = fuente("../pixi/sapo.ts");
    // lit (el aro amarillo) sale de los tiros que ya aterrizaron.
    expect(dos).toContain('for (const o of tosses) if (o.th.kind === "hit" && tAll >= o.land) lit.set(');
    // La mirada de la rana al agujero ganador es solo después de la corona.
    expect(dos).toContain("mira: crowned ?");
  });
});

/* ===================================================================== la cámara de los tiros (S4) y la de la moneda (S5) */

/** Las pantallas de ejemplo con su tamaño, para proyectar con una cámara de three.js de verdad. */
const PANTALLAS_WH = [
  { ...(PANTALLAS[0] as (typeof PANTALLAS)[number]), w: 1366, h: 768, mano: { x: HAND.x * 0.86, y: HAND.y * 0.82 } },
  { ...(PANTALLAS[1] as (typeof PANTALLAS)[number]), w: 390, h: 844, mano: { x: 0.9, y: 1.55 + 0.5 } },
];
const DEG = Math.PI / 180;

/** Proyecta puntos del mundo 3D con la pose dada, en píxeles de la pantalla (z mayor que 1: detrás de la cámara). */
function proyectar(pose: Pose3D, w: number, h: number, pts: readonly (readonly [number, number, number])[]): { x: number; y: number; z: number }[] {
  const c = new PerspectiveCamera(36, w / h, 0.5, 4000);
  aplicarPose(c, pose, w / h);
  const v = new Vector3();
  return pts.map((p) => {
    v.set(p[0], p[1], p[2]).project(c);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, z: v.z };
  });
}
const adentro = (q: { x: number; y: number; z: number }, w: number, h: number, margen = 0): boolean =>
  q.z < 1 && q.x >= margen && q.x <= w - margen && q.y >= margen && q.y <= h - margen;

describe("la cámara de cada tiro: baja, gira hacia la mano y sigue a la argolla, y vuelve al golpe (S4)", () => {
  const golpe = (t: number, punto: Point = { x: 0.5, y: 0.5 }) => ({ t, punto, fuerza: 0.85 });

  it("quieta sin tiro en el aire; sube con el vuelo y baja en menos de 0,8 s después del golpe, sin saltos", () => {
    expect(cercaniaDelTiro([], [], 3).cerca).toBe(0);
    expect(cercaniaDelTiro([arg("mano")], [], 3).cerca).toBe(0);
    // En el vuelo sube desde 0 y nunca baja hasta caer.
    let antes = -1;
    for (let i = 0; i <= 40; i++) {
      const c = cercaniaDelTiro([arg("vuelo", { u: i / 40, suelo: { x: 1 - i / 40, y: 1 - i / 40 } })], [], 5).cerca;
      expect(c).toBeGreaterThanOrEqual(antes);
      expect(c).toBeLessThanOrEqual(1);
      antes = c;
    }
    expect(cercaniaDelTiro([arg("vuelo", { u: 0 })], [], 5).cerca).toBe(0);
    expect(antes).toBe(1);
    // Al golpe sigue igual (sin salto) y se aleja: a los 0,8 s ya está quieta, cuando el 2D suelta el golpe.
    const t0 = 5;
    expect(cercaniaDelTiro([arg("rueda", { edad: 0 })], [golpe(t0)], t0).cerca).toBeCloseTo(1, 6);
    let previo = 1;
    for (let k = 1; k <= 16; k++) {
      const t = t0 + k * 0.05;
      const c = cercaniaDelTiro([arg("rueda", { edad: t - t0 })], [golpe(t0)], t).cerca;
      expect(c).toBeLessThanOrEqual(previo + 1e-9);
      expect(previo - c).toBeLessThan(0.2);
      previo = c;
    }
    expect(previo).toBeCloseTo(0, 6);
    // El foco es la argolla en el aire, y al caer el lugar del golpe.
    expect(cercaniaDelTiro([arg("vuelo", { u: 0.5, suelo: { x: 0.4, y: -0.3 } })], [], 5).foco).toEqual({ x: 0.4, y: -0.3 });
    expect(cercaniaDelTiro([arg("rueda")], [golpe(5, { x: -0.7, y: 0.2 })], 5.1).foco).toEqual({ x: -0.7, y: 0.2 });
  });

  it("la boca de la rana: al tragar se aleja de a poco y la argolla escupida no la vuelve a acercar", () => {
    let previo = 1;
    for (const [estado, edad] of [["boca-entra", 0], ["boca-entra", 0.2], ["oculta", 0.35], ["boca-sale", 0.5], ["boca-sale", 0.9]] as const) {
      const c = cercaniaDelTiro([arg(estado, { edad, suelo: MOUTH })], [], 9).cerca;
      expect(c).toBeLessThanOrEqual(previo + 1e-9);
      previo = c;
    }
    expect(previo).toBeCloseTo(0, 6);
    // Sin golpe (la boca no deja astillas), la argolla que rueda después ya no mueve la cámara.
    expect(cercaniaDelTiro([arg("rueda", { edad: 0, suelo: { x: 0.6, y: 0.1 } })], [], 9.5).cerca).toBe(0);
  });

  it("la última argolla no usa esta cámara: tiene la suya (la de la moneda)", () => {
    expect(cercaniaDelTiro([arg("vuelo", { u: 0.5, ultima: true })], [], 5).cerca).toBe(0);
    expect(cercaniaDelTiro([arg("hunde", { u: 0.2, edad: 0.1, ultima: true })], [golpe(5)], 5.1).cerca).toBe(0);
  });

  it("el ángulo del tiro: más baja y del lado de la mano, sin marear y sin pasar el tope de acercamiento", () => {
    for (const pant of PANTALLAS_WH) {
      const base = perfilSapo(pant.mesa.tilt);
      const p0 = perfilDelTiro(base, 0, pant.mesa.tilt);
      expect(p0).toEqual(base);
      const p1 = perfilDelTiro(base, 1, pant.mesa.tilt);
      // Baja y gira hacia la mano (a la derecha de la pantalla): se ve el tiro desde quien tira.
      expect(p1.elevacion).toBeLessThan(base.elevacion - 6 * DEG);
      expect(p1.azimut).toBeGreaterThan(base.azimut + 4 * DEG);
      expect(Math.abs(p1.elevacion - base.elevacion)).toBeLessThan(14 * DEG);
      expect(Math.abs(p1.azimut - base.azimut)).toBeLessThan(15 * DEG);
      // La cuenta de la casa no cambia: los agujeros caen en el mismo lugar del 3D.
      expect(p1.zc).toBe(base.zc);
      expect(p1.acerca).toBe(base.acerca);
      const cam = { x: pant.w / 2, y: pant.h / 2, zoom: ZOOM_MAX, rot: 0, sacudonX: 0, sacudonY: 0 };
      const c1 = camaraDelTiro(cam, 1, { x: 0.8, y: -0.6 }, pant.mesa);
      const tira = pant.mesa.tilt > 0.8 ? SEGUIR.celular : SEGUIR.ancho;
      expect(c1.zoom).toBeCloseTo(ZOOM_MAX * (1 + tira.acerca), 9);
      expect(c1.zoom).toBeLessThan(1.25);
      // Va hacia la argolla, sin llegar: la mesa sigue siendo lo que se ve.
      const fx = pant.mesa.cx + 0.8 * pant.mesa.sc, fy = pant.mesa.cy - 0.6 * pant.mesa.sc * pant.mesa.tilt;
      expect(Math.abs(c1.x - fx)).toBeLessThan(Math.abs(cam.x - fx));
      expect(Math.abs(c1.y - fy)).toBeLessThan(Math.abs(cam.y - fy));
      expect(camaraDelTiro(cam, 0, { x: 0.8, y: -0.6 }, pant.mesa)).toEqual(cam);
      expect(camaraDelTiro(cam, 1, null, pant.mesa).x).toBe(cam.x);
    }
  });

  it("con la cámara del tiro todos los agujeros siguen en cuadro, en la pantalla ancha y en el celular", () => {
    const L = holeLayout(SAPO_MAX);
    for (const pant of PANTALLAS_WH) {
      const focos: Point[] = [pant.mano, MOUTH, ...L.holes];
      for (const cerca of [0, 0.5, 1]) {
        for (const foco of focos) {
          const perfil = perfilDelTiro(perfilSapo(pant.mesa.tilt, deltaCamara(10, 0, -1)), cerca, pant.mesa.tilt);
          const cam = camaraDelTiro(camaraDelSapo({ x: pant.w / 2, y: pant.h / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 }, pant.w, pant.h), cerca, foco, pant.mesa);
          const mapa = crearMapa(perfil, pant.u);
          const { px, pz, K, Kz } = lugarDelMundo(mapa, pant.mesa);
          const pose = poseCamara(cam, pant.h, pant.u, perfil);
          const pts = L.holes.flatMap((h) => [-1, 1].flatMap((sx) => [[px + K * (h.x + sx * L.holeR), 0, pz + Kz * h.y], [px + K * h.x, 0, pz + Kz * (h.y + sx * L.holeR)]] as const));
          for (const q of proyectar(pose, pant.w, pant.h, pts)) expect(adentro(q, pant.w, pant.h), `${pant.nombre} cerca ${cerca} foco ${foco.x},${foco.y}: ${q.x},${q.y}`).toBe(true);
        }
      }
    }
  });

  it("depende solo de las argollas, los golpes y el reloj: no recibe quién gana", () => {
    const src = fuente("sapo-3d.ts");
    for (const [desde, hasta] of [["export function cercaniaDelTiro", "export function camaraDelTiro"], ["export function camaraDelTiro", "export function perfilDelTiro"], ["export function pesoMoneda", "export function poseMoneda"]] as const) {
      const firma = src.slice(src.indexOf(desde), src.indexOf(hasta));
      expect(firma.length).toBeGreaterThan(40);
      expect(firma).not.toMatch(/ganador|winner|slot/i);
    }
  });
});

describe("la última argolla, desde la argolla: del lanzamiento con zoom hasta verla entrar (S5)", () => {
  it("la toma de cada argolla es la del plan: la del último tiro (el acierto del último ganador) es la de la moneda", () => {
    for (const personas of [5, 18, 30]) {
      for (const semilla of [1, 2, 3, 4, 5, 6]) {
        const ganadores = [semilla % personas, (semilla + 2) % personas].slice(0, semilla % 2 ? 1 : 2);
        const { throws, linea, plan, last } = planSapo(personas, ganadores, semilla);
        const tomas = tomasDeTiros(throws);
        // El 2D le pasa `ultima: o.final` (sapo.ts, argollas3): el 3D elige la toma con eso.
        throws.forEach((_, i) => {
          const final = (linea.tiros[i] as { final: boolean }).final;
          expect(tomaDeArgolla(arg("vuelo", { ultima: final }))).toBe(tomas[i]);
        });
        expect(throws[tomas.indexOf("moneda")]?.targetSlot).toBe(plan.winnerSlots[last]);
      }
    }
    // La mano todavía no es la toma de la moneda: el 2D la manda sin `ultima`.
    expect(tomaDeArgolla(arg("mano"))).toBe("seguir");
  });

  it("entra con la suelta, sigue todo el vuelo y la caída, y suelta la cámara antes de la corona", () => {
    expect(pesoMoneda([]).peso).toBe(0);
    expect(pesoMoneda([arg("mano")]).peso).toBe(0);
    expect(pesoMoneda([arg("vuelo", { u: 0.5 })]).peso).toBe(0);
    expect(pesoMoneda([arg("vuelo", { u: 0, ultima: true })]).peso).toBe(0);
    expect(pesoMoneda([arg("vuelo", { u: MOMENTOS_MONEDA.vuela, ultima: true })]).peso).toBeCloseTo(1, 9);
    let antes = 0;
    for (let i = 0; i <= 50; i++) {
      const u = i / 50;
      const m = pesoMoneda([arg("rueda"), arg("vuelo", { u, ultima: true })]);
      expect(m.peso).toBeGreaterThanOrEqual(antes - 1e-9);
      expect(m.peso - antes).toBeLessThan(0.25);
      expect(m.s).toBeCloseTo(u, 9);
      antes = m.peso;
    }
    // Mientras se hunde (y un rato después), la cámara sigue en el agujero; antes de la corona vuelve la del director.
    for (let edad = 0; edad <= SINK + 0.25; edad += 0.05) expect(pesoMoneda([arg("hunde", { u: Math.min(1, edad / SINK), edad, ultima: true })]).peso).toBeCloseTo(1, 9);
    let previo = 1;
    for (let edad = SINK; edad <= AFTER_FINAL; edad += 0.05) {
      const p = pesoMoneda([arg("hunde", { u: 1, edad, ultima: true })]).peso;
      expect(p).toBeLessThanOrEqual(previo + 1e-9);
      expect(previo - p).toBeLessThan(0.12);
      previo = p;
    }
    expect(pesoMoneda([arg("hunde", { u: 1, edad: AFTER_FINAL - 0.05, ultima: true })]).peso).toBe(0);
    // Las otras argollas que se hunden (los premios de antes) no la usan.
    expect(pesoMoneda([arg("hunde", { u: 0.5, edad: 0.2 })]).peso).toBe(0);
  });

  it("mezclar es continuo: con peso 0 es la del director, con 1 la de la moneda", () => {
    const a: Pose3D = { pos: [0, 10, 20], mira: [0, 0, 0], fov: 0.5, giro: 0.1 };
    const b: Pose3D = { pos: [4, 2, 6], mira: [2, 0, -3], fov: 0.7, giro: 0 };
    expect(mezclarPose(a, b, 0)).toEqual(a);
    expect(mezclarPose(a, b, 1)).toEqual(b);
    const m = mezclarPose(a, b, 0.5);
    expect(m.pos).toEqual([2, 6, 13]);
    expect(m.fov).toBeCloseTo(0.6, 9);
  });

  /** Las dos maneras en que vuela la última argolla en el 2D (`tokenAt`): derecho al agujero, o al labio de la rana y de ahí al agujero. */
  const LABIO = 0.62;
  function vuelo(mano: Point, landing: Point, u: number, labio: boolean): { suelo: Point; alto: number } {
    if (!labio) return { suelo: { x: mano.x + (landing.x - mano.x) * u, y: mano.y + (landing.y - mano.y) * u }, alto: 4 * 0.95 * u * (1 - u) };
    if (u < LABIO) {
      const k = u / LABIO;
      return { suelo: { x: mano.x + (MOUTH.x - mano.x) * k, y: mano.y + (MOUTH.y - mano.y) * k }, alto: 4 * 0.95 * k * (1 - k) };
    }
    const k = (u - LABIO) / (1 - LABIO);
    return { suelo: { x: MOUTH.x + (landing.x - MOUTH.x) * k, y: MOUTH.y + (landing.y - MOUTH.y) * k }, alto: 4 * 0.95 * 0.35 * k * (1 - k) };
  }

  for (const pant of PANTALLAS_WH) {
    it(`${pant.nombre}: la argolla siempre en cuadro, la cámara sobre la mesa y la rana, se acerca, sin saltos, y al final se ve el agujero`, () => {
      for (const personas of [5, 12, 30]) {
        for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
          const { throws, L } = planSapo(personas, [semilla % personas], semilla);
          const fin = throws[throws.length - 1] as (typeof throws)[number];
          const perfil = perfilSapo(pant.mesa.tilt);
          const mapa = crearMapa(perfil, pant.u);
          const lugar = lugarDelMundo(mapa, pant.mesa);
          const director = poseCamara({ x: pant.w / 2, y: pant.h / 2, zoom: ZOOM_MAX, rot: 0, sacudonX: 0, sacudonY: 0 }, pant.h, pant.u, perfil);
          const manoMundo = [pant.mano.x, 0.13, pant.mano.y] as const;
          for (const labio of [false, true]) {
            let previa: Pose3D | null = null;
            let distPrevia = Infinity;
            const muestras: { u: number; estado: EstadoArgolla; edad: number }[] = [];
            for (let i = 0; i <= 60; i++) muestras.push({ u: i / 60, estado: "vuelo", edad: 0 });
            for (let i = 1; i <= 10; i++) muestras.push({ u: Math.min(1, (i * 0.05) / SINK), estado: "hunde", edad: i * 0.05 });
            for (const mu of muestras) {
              const v = mu.estado === "vuelo" ? vuelo(pant.mano, fin.landing, mu.u, labio) : { suelo: fin.landing, alto: 0 };
              const a = arg(mu.estado, { u: mu.u, edad: mu.edad, suelo: v.suelo, alto: v.alto, ultima: true });
              const m = pesoMoneda([a]);
              const p = poseArgolla(a, BR, FR, manoMundo, BOCA);
              const moneda = poseMoneda(a, m.s, p, pant.mano, FR, lugar, pant.w / pant.h);
              const pose = mezclarPose(director, moneda, m.peso);
              // La cámara de la moneda va por encima de la tapa y de la rana (en unidades de la mesa).
              const camX = (moneda.pos[0] - lugar.px) / lugar.K, camY = moneda.pos[1] / lugar.K, camZ = (moneda.pos[2] - lugar.pz) / lugar.Kz;
              expect(camY).toBeGreaterThan(0.2);
              expect(camY).toBeGreaterThan(alturaRana(camX, camZ, FR) + 0.1);
              // La argolla se ve: en la pantalla, con margen.
              const coin = [lugar.px + lugar.K * p.x, lugar.K * Math.max(p.y, 0), lugar.pz + lugar.Kz * p.z] as const;
              const [q] = proyectar(pose, pant.w, pant.h, [coin]);
              expect(adentro(q as { x: number; y: number; z: number }, pant.w, pant.h, Math.min(pant.w, pant.h) * 0.08), `${personas}/${semilla} labio ${labio} u ${mu.u} ${mu.estado}: ${q?.x},${q?.y}`).toBe(true);
              // Se acerca: la cámara de la moneda nunca se aleja de la argolla mientras vuela, y termina mucho más cerca que el director.
              // (En unidades de la mesa: el mundo estira la profundidad por `Kz`, y medida en el 3D la distancia cambiaría con el rumbo.)
              const d = Math.hypot((moneda.pos[0] - coin[0]) / lugar.K, (moneda.pos[1] - coin[1]) / lugar.K, (moneda.pos[2] - coin[2]) / lugar.Kz);
              if (mu.estado === "vuelo" && mu.u > 0) expect(d, `${personas}/${semilla} labio ${labio} u ${mu.u}`).toBeLessThanOrEqual(distPrevia + 1e-6);
              if (mu.estado === "vuelo") distPrevia = d;
              // Sin saltos: entre una muestra y la siguiente (unos 2 cuadros), la cámara se mueve poco. En la suelta viaja
              // desde la del director, y ese viaje se reparte: ningún paso lleva más de un sexto del camino que falta.
              if (previa) {
                const lejos = Math.hypot(director.pos[0] - moneda.pos[0], director.pos[1] - moneda.pos[1], director.pos[2] - moneda.pos[2]) / lugar.K;
                const paso = Math.hypot(pose.pos[0] - previa.pos[0], pose.pos[1] - previa.pos[1], pose.pos[2] - previa.pos[2]) / lugar.K;
                const pasoMira = Math.hypot(pose.mira[0] - previa.mira[0], pose.mira[1] - previa.mira[1], pose.mira[2] - previa.mira[2]) / lugar.K;
                expect(paso, `${personas}/${semilla} labio ${labio} u ${mu.u}`).toBeLessThan(0.35 + lejos / 6);
                expect(pasoMira, `${personas}/${semilla} labio ${labio} u ${mu.u}`).toBeLessThan(0.35 + lejos / 6);
              }
              previa = pose;
            }
            // Al final, de cerca: el agujero del ganador ocupa una buena parte de la pantalla.
            const hoyo = L.holes.reduce((m, h) => (Math.hypot(h.x - fin.landing.x, h.y - fin.landing.y) < Math.hypot(m.x - fin.landing.x, m.y - fin.landing.y) ? h : m));
            const final = poseMoneda(arg("hunde", { u: 0.5, edad: 0.25, suelo: fin.landing, ultima: true }), 1, poseArgolla(arg("hunde", { u: 0.5, suelo: fin.landing }), BR, FR, manoMundo, BOCA), pant.mano, FR, lugar, pant.w / pant.h);
            const [c, b] = proyectar(final, pant.w, pant.h, [[lugar.px + lugar.K * hoyo.x, 0, lugar.pz + lugar.Kz * hoyo.y], [lugar.px + lugar.K * (hoyo.x + L.holeR), 0, lugar.pz + lugar.Kz * hoyo.y]]);
            expect(adentro(c as { x: number; y: number; z: number }, pant.w, pant.h, Math.min(pant.w, pant.h) * 0.15)).toBe(true);
            const [cd] = proyectar(director, pant.w, pant.h, [[lugar.px + lugar.K * hoyo.x, 0, lugar.pz + lugar.Kz * hoyo.y]]);
            const [bd] = proyectar(director, pant.w, pant.h, [[lugar.px + lugar.K * (hoyo.x + L.holeR), 0, lugar.pz + lugar.Kz * hoyo.y]]);
            const radioMoneda = Math.hypot((b?.x ?? 0) - (c?.x ?? 0), (b?.y ?? 0) - (c?.y ?? 0));
            const radioDirector = Math.hypot((bd?.x ?? 0) - (cd?.x ?? 0), (bd?.y ?? 0) - (cd?.y ?? 0));
            expect(radioMoneda).toBeGreaterThan(radioDirector * 2.5);
          }
        }
      }
    });
  }
});
