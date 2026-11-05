import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { planQualifier } from "../pixi/qualifier";
import { HAND, MOUTH, SAPO_MAX, holeLayout, optsForArc, planThrows, type Point } from "../pixi/sapo-plan";
import { Q_FLY, Q_SHOW, Q_WAVE, WOBBLE, tiemposDeTiros } from "../pixi/sapo-tiempos";
import { assignSlots } from "../pixi/slots";
import { crearMapa, poseCamara } from "./camara";
import { compararPuestos, type Puesto2D } from "./prueba";
import {
  TAPA_Y, ZOOM_MAX, alturaRana, aroDestacado, cajaDeAro, camaraDelSapo, deltaCamara, elevacionDe, encajarAntes, lugarDelMundo, luzDelGolpe, perfilSapo,
  poseArgolla, proyectorDe, type AgujeroSapo, type ArgollaSapo, type AroDestacado, type EstadoArgolla,
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

describe("el primer plano del final en 3D: lo que se ve de cerca y despejado", () => {
  const w = 844, h = 390;
  const base = { x: w / 2, y: h / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };

  it("sin primer plano, el tope de siempre; con el primer plano entero, la cámara del director tal cual, y sin saltos entre medio", () => {
    const dir = { ...base, zoom: 3.2, x: 520, y: 150 };
    expect(camaraDelSapo(dir, w, h, ZOOM_MAX, 0)).toEqual(camaraDelSapo(dir, w, h));
    expect(camaraDelSapo(dir, w, h, ZOOM_MAX, 1)).toEqual(dir);
    let antes = camaraDelSapo(dir, w, h, ZOOM_MAX, 0);
    for (let i = 1; i <= 100; i++) {
      const c = camaraDelSapo(dir, w, h, ZOOM_MAX, i / 100);
      // Cada centésimo de avance mueve poco y siempre hacia la del director.
      expect(c.zoom).toBeGreaterThanOrEqual(antes.zoom);
      expect(Math.abs(c.zoom - antes.zoom)).toBeLessThan(0.05);
      expect(Math.abs(c.x - antes.x)).toBeLessThan(3);
      expect(Math.abs(c.y - antes.y)).toBeLessThan(3);
      antes = c;
    }
    // Por debajo del tope no cambia nada.
    expect(camaraDelSapo({ ...base, zoom: 1.05 }, w, h, ZOOM_MAX, 0.5)).toEqual({ ...base, zoom: 1.05 });
  });

  const trazo = { holes: [{ x: -0.6, y: 0.2 }, { x: 0.5, y: -0.3 }, { x: 0.1, y: 0.6 }], holeR: 0.145, frogR: 0.34, tableR: 1.55 };
  const ag = (lits: number[]): AgujeroSapo[] => lits.map((lit) => ({ nace: 1, aro: 0xff0000, lit }));

  it("el aro destacado es el del agujero encendido del todo, con lo que dibuja: el aro y, desde el golpe, el anillo que crece", () => {
    expect(aroDestacado({ trazo, agujeros: ag([0, 0.6, 0]), t: 9, golpe: -1, adentro: -1 })).toBeNull();
    const antes = aroDestacado({ trazo, agujeros: ag([0.6, 1, 0]), t: 9, golpe: -1, adentro: 5 });
    expect(antes).not.toBeNull();
    const a = antes as AroDestacado;
    expect(a.x).toBe(0.5);
    expect(a.z).toBe(-0.3);
    // El aro: radio 1,08 del agujero y su tubo de 0,13.
    expect(a.radio).toBeCloseTo(0.145 * 1.08 * 1.13, 9);
    expect(a.alto).toBeGreaterThan(a.bajo);
    const golpe = aroDestacado({ trazo, agujeros: ag([0.6, 1, 0]), t: 10.5, golpe: 10, adentro: 5 }) as AroDestacado;
    // El anillo amarillo: 1,1 del agujero, crecido 15 % a los 0,3 s, con su tubo de 0,2.
    expect(golpe.radio).toBeCloseTo(0.145 * 1.1 * 1.15 * 1.2, 9);
    // Con el salto de la tapa al caer la última argolla, el aro sube.
    const salta = aroDestacado({ trazo, agujeros: ag([0, 1, 0]), t: 5.125, golpe: -1, adentro: 5 }) as AroDestacado;
    expect(salta.bajo).toBeGreaterThan(a.bajo);
  });

  it("la caja del aro en la pantalla es la de su contorno proyectado, con la escala de la mesa", () => {
    const aro: AroDestacado = { x: 0.5, z: -0.3, radio: 0.2, bajo: 0, alto: 0.05 };
    const lugar = { px: 10, pz: 20, K: 2, Kz: 3 };
    // Una proyección lineal: x a la derecha, z hacia abajo, la altura hacia arriba.
    const caja = cajaDeAro(aro, lugar, (x, y, z) => ({ x: 100 + 10 * x, y: 50 + 10 * z - 10 * y })) as { x: number; y: number; w: number; h: number };
    expect(caja.x).toBeCloseTo(100 + 10 * (10 + 2 * (0.5 - 0.2)), 6);
    expect(caja.w).toBeCloseTo(10 * 2 * 2 * 0.2, 6);
    expect(caja.y).toBeCloseTo(50 + 10 * (20 + 3 * (-0.3 - 0.2)) - 10 * 2 * 0.05, 6);
    expect(caja.h).toBeCloseTo(10 * 3 * 2 * 0.2 + 10 * 2 * 0.05, 6);
    expect(cajaDeAro(aro, lugar, () => null)).toBeNull();
  });

  it("la proyección antes de dibujar es la de la cámara 3D: el punto mirado cae en el centro y el acercamiento agranda la caja", () => {
    const perfil = perfilSapo(0.62);
    const u = 0.54;
    const mapa = crearMapa(perfil, u);
    const mesa = { cx: 422, cy: 200, sc: 120, tilt: 0.62 };
    const lugar = lugarDelMundo(mapa, mesa);
    const cam = { ...base, x: 430, y: 190, zoom: 1.6 };
    const pose = poseCamara(cam, h, u, perfil);
    const c = proyectorDe(cam, w, h, u, perfil)(...pose.mira) as { x: number; y: number };
    expect(c.x).toBeCloseTo(w / 2, 6);
    expect(c.y).toBeCloseTo(h / 2, 6);
    const aro: AroDestacado = { x: 0.06, z: -0.08, radio: 0.19, bajo: 0, alto: 0.03 };
    const b1 = cajaDeAro(aro, lugar, proyectorDe(cam, w, h, u, perfil)) as { w: number; h: number };
    const b2 = cajaDeAro(aro, lugar, proyectorDe({ ...cam, zoom: 3.2 }, w, h, u, perfil)) as { w: number; h: number };
    expect(b2.w / b1.w).toBeGreaterThan(1.8);
    expect(b2.w / b1.w).toBeLessThan(2.2);
  });

  it("el despeje va antes de dibujar: mide con la cámara de ahora, despeja esa caja, vuelve a medir con la corregida y para cuando ya cabe", () => {
    const pasos: string[] = [];
    const cam0 = { ...base, zoom: 2 };
    // Una caja que baja 40 px por cada píxel que la cámara mira más arriba; el despeje la quiere con su borde de arriba en 100.
    const medir = (c: typeof cam0) => {
      pasos.push(`medir ${c.y.toFixed(1)}`);
      return { x: 300, y: 60 + (h / 2 - c.y) * 0.9, w: 80, h: 50 };
    };
    const encajar = (caja: { y: number }) => {
      pasos.push(`encajar ${caja.y.toFixed(1)}`);
      if (caja.y >= 100 - 1e-6) return null;
      return { ...cam0, y: h / 2 - (100 - 60) / 0.8 };
    };
    const fin = encajarAntes(cam0, medir, encajar, (c) => c);
    expect(pasos[0]).toBe(`medir ${(h / 2).toFixed(1)}`);
    expect(pasos[1]).toBe("encajar 60.0");
    expect(pasos[2]).toBe(`medir ${(h / 2 - 50).toFixed(1)}`);
    expect(fin.y).toBeCloseTo(h / 2 - 50, 9);
    // Nunca más de tres vueltas, aunque el despeje no termine de cerrar.
    let n = 0;
    encajarAntes(cam0, () => ({ x: 0, y: 0, w: 1, h: 1 }), () => (n++, { ...cam0 }), (c) => c);
    expect(n).toBe(3);
    // Sin despeje pedido, la cámara queda como estaba y no se mide nada.
    const solo: string[] = [];
    expect(encajarAntes(cam0, () => (solo.push("x"), null), undefined, (c) => c)).toBe(cam0);
  });

  it("el cuadro 3D despeja antes de dibujar y dibuja con la cámara despejada, sin nombrar a quien gana", () => {
    const src = fuente("sapo-3d.ts");
    const cuadro = src.slice(src.indexOf("    frame(e) {"), src.indexOf("    pantallaDe(id) {"));
    expect(cuadro.indexOf("encajarAntes(")).toBeGreaterThan(0);
    expect(cuadro.indexOf("encajarAntes(")).toBeLessThan(cuadro.indexOf("motor.cuadro("));
    expect(cuadro).toMatch(/motor\.cuadro\(\{ \.\.\.e, cam \}/);
    expect(cuadro).toContain("e.puente.destacada =");
    for (const [desde, hasta] of [["export function aroDestacado", "export function cajaDeAro"], ["export function cajaDeAro", "export function proyectorDe"],
      ["export function proyectorDe", "export function encajarAntes"], ["export function encajarAntes", "/* ====="]] as const) {
      const i = src.indexOf(desde);
      expect(i, desde).toBeGreaterThan(0);
      expect(src.slice(i, src.indexOf(hasta, i + 1))).not.toMatch(/ganador|winner|slot/i);
    }
  });
});
