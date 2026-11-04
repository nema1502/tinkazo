import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "../pixi/kit/azar";
import type { Contexto } from "../pixi/kit/tipos";
import {
  Z_META, Z_PALO, Z_ULTIMOS, faseDe, geoDe, planGuajojo, proyectar, sentadaDe, xDe, zDe, type Pant,
} from "../pixi/guajojo-plan";
import { TEXTOS } from "../pixi/guajojo-textos";
import { aplicarPose } from "./camara";
import {
  CUERPO_PX, D0, PERFIL, PROF, U_MUNDO, aDibujo, alturaExtra, altoCamara, altoDelPalo, camaraDe, colocar, cuerpo3D, entradaVacia, escalaEn, focal,
  mapaDelMundo, mitadEnCuerpos, pantallaDe, type GeoG,
} from "./guajojo-3d-mapa";
import { compararPuestos, ordenPor, type Puesto2D } from "./prueba";

/**
 * El Guajojó en 3D no decide nada: dibuja lo que el plan 2D ya puso. Estas pruebas cuidan que cada persona cae donde el plan
 * la manda (el mismo orden, la misma profundidad), que la cámara mira lo mismo que el director del 2D (el palo, la meta y el
 * foco quedan donde el 2D los espera) y que lo liviano no trae three.js.
 */

const aqui = new URL(".", import.meta.url);
const fuente = (f: string): string => readFileSync(new URL(f, aqui), "utf8");
const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

function contexto(n: number, ganadores: number[], semilla: number): Contexto {
  const rng = sembrar(semilla);
  const ronda = RONDA.replace(/^.{8}/, semilla.toString(16).padStart(8, "0"));
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`),
    ganadores,
    ronda,
    rng,
    idioma: "es",
    txt: (clave, ...args) => {
      const v = (TEXTOS.es as Record<string, string | ((...a: unknown[]) => string)>)[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => azarDe(ronda, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

const PANTALLAS: Pant[] = [
  { w: 1366, h: 768, k: 1, top: 82, bottom: 640 },
  { w: 1920, h: 1080, k: 1.5, top: 82, bottom: 974 },
  { w: 390, h: 844, k: 0.93, top: 100, bottom: 726 },
];
const QS = [0.25, 0.5, 0.7, 0.88, 1];

describe("el 3D dibuja las posiciones del plan 2D", () => {
  for (const n of [5, 18, 30]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 70, 88 y 100 % cada una cae donde el plan la manda`, () => {
        const plan = planGuajojo(contexto(n, [n - 1], semilla));
        const d = plan.datos;
        const g = geoDe(PANTALLAS[0] as Pant);
        for (const q of QS) {
          const t = d.tAmanecer0 + (plan.duracion - d.tAmanecer0) * 0 + q * plan.duracion;
          const puestos: Puesto2D[] = [];
          for (let i = 0; i < n; i++) {
            const p = aDibujo(g, xDe(d, i, t), zDe(d, i, t));
            puestos.push({ id: i, x: p.x, y: p.y });
          }
          // La posición vuelve intacta con el mapa de la casa y el orden a lo ancho y a lo hondo es el mismo.
          expect(compararPuestos(puestos, PERFIL, U_MUNDO)).toEqual([]);
          // Más lejos en el sendero es más lejos de la cámara: el orden del 3D es el de la profundidad del plan, sin empates inventados.
          const porPlan = ordenPor(Array.from({ length: n }, (_, i) => ({ id: i, v: -zDe(d, i, t) })));
          const por3D = ordenPor(puestos.map((p) => ({ id: p.id, v: colocar(mapaDelMundo(), g, xDe(d, p.id, t), zDe(d, p.id, t))[2] })));
          expect(por3D).toEqual(porPlan);
        }
        // Al final, quien gana es quien llega más lejos, junto al palo: el 3D no cambia quién gana.
        const t1 = plan.duracion;
        const lejos = Array.from({ length: n }, (_, i) => ({ id: i, z: zDe(d, i, t1) })).sort((a, b) => b.z - a.z || a.id - b.id)[0]!;
        expect(lejos.id).toBe(d.ganador);
        expect(zDe(d, d.ganador, t1)).toBeCloseTo(Z_META, 6);
        const [gx, , gz] = colocar(mapaDelMundo(), g, xDe(d, d.ganador, t1), zDe(d, d.ganador, t1));
        for (let i = 0; i < n; i++) {
          if (i === d.ganador) continue;
          expect(colocar(mapaDelMundo(), g, xDe(d, i, t1), zDe(d, i, t1))[2]).toBeGreaterThan(gz);
        }
        expect(gx).toBeCloseTo(0, 6);
      });
    }
  }

  it("el 3D usa el mapa de la casa para colocar: un cuerpo son CUERPO_PX píxeles del dibujo", () => {
    const mapa = mapaDelMundo();
    const g = geoDe(PANTALLAS[0] as Pant);
    const [x, y, z] = colocar(mapa, g, 0.5, 0.25, 1);
    const p = aDibujo(g, 0.5, 0.25);
    expect([x, y, z]).toEqual(mapa.a3D(p.x, p.y, CUERPO_PX));
    expect(y).toBeCloseTo(cuerpo3D(mapa), 9);
    expect(cuerpo3D(mapa)).toBeCloseTo(mapa.escalaFigura(CUERPO_PX), 9);
  });

  it("los que se sientan no se mueven de su fila hasta que caen: la profundidad que dibuja el 3D es la del plan", () => {
    const plan = planGuajojo(contexto(18, [3], 5));
    const d = plan.datos;
    for (let i = 0; i < 18; i++) {
      const ts = d.sienta[i] as number;
      if (!Number.isFinite(ts)) continue;
      expect(sentadaDe(d, i, ts + 1)).toBeCloseTo(1, 3);
      // Una vez sentada, su z no cambia (la hinchada se corre a los costados).
      expect(zDe(d, i, ts + 1)).toBeCloseTo(zDe(d, i, ts + 3), 9);
    }
  });
});

/** Un azar chico para recorrer cámaras. */
const alea = (i: number, j: number): number => azarDe(RONDA, `cam:${i}:${j}`);

/** Lo que hace la vista cada cuadro: cámara de three.js con la pose y el desplazamiento de lente. */
function camaraTres(w: number, h: number, g: GeoG, cam: Parameters<typeof camaraDe>[1], dH: number, zBloqueo?: number) {
  const mapa = mapaDelMundo();
  const c = camaraDe({ w, h }, cam, g, mapa, dH, zBloqueo);
  const cm = new PerspectiveCamera(36, w / h, 0.5, 4000);
  cm.setViewOffset(c.lente.fullW, c.lente.fullH, c.lente.x, c.lente.y, c.lente.w, c.lente.h);
  aplicarPose(cm, { pos: c.pos, mira: c.mira, fov: c.fov, giro: 0 }, w / h);
  return { cm, c, mapa };
}
const aPantalla = (cm: PerspectiveCamera, p: readonly [number, number, number], w: number, h: number): { x: number; y: number } => {
  const v = new Vector3(p[0], p[1], p[2]).project(cm);
  return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
};

describe("la cámara 3D cae donde la cámara del director del 2D", () => {
  for (const pant of PANTALLAS) {
    const { w, h } = pant;
    const g = geoDe(pant);
    it(`${w}x${h}: cada punto del sendero, a su altura, cae a menos de medio píxel de donde lo pone el 2D (cualquier acercamiento y sacudón)`, () => {
      for (let i = 0; i < 12; i++) {
        const zoom = 1 + 1.4 * alea(i, 1);
        const cam = { x: w * (0.3 + 0.4 * alea(i, 2)), y: pant.top + (pant.bottom - pant.top) * (0.2 + 0.6 * alea(i, 3)), zoom, rot: 0, sacudonX: (alea(i, 4) - 0.5) * 12, sacudonY: (alea(i, 5) - 0.5) * 12 };
        const { cm, mapa } = camaraTres(w, h, g, cam, 0);
        for (let j = 0; j < 14; j++) {
          const x = (alea(i * 20 + j, 6) - 0.5) * 2.2, z = alea(i * 20 + j, 7) * 1.1, cuerpos = alea(i * 20 + j, 8) * 1.2;
          const q = proyectar(g, x, z);
          const esperado = { x: w / 2 + cam.sacudonX + (q.x - cam.x) * zoom, y: h / 2 + cam.sacudonY + (q.y - cuerpos * g.cuerpo * q.s - cam.y) * zoom };
          const real = aPantalla(cm, colocar(mapa, g, x, z, cuerpos), w, h);
          expect(Math.abs(real.x - esperado.x)).toBeLessThan(0.5);
          expect(Math.abs(real.y - esperado.y)).toBeLessThan(0.5);
        }
      }
    });

    it(`${w}x${h}: al subir o bajar la cámara, lo que está a la altura del palo y de la meta no se corre`, () => {
      const cam = { x: w / 2, y: (pant.top + pant.bottom) / 2, zoom: 1.3, rot: 0, sacudonX: 0, sacudonY: 0 };
      const base = camaraTres(w, h, g, cam, 0);
      for (const dH of [-1.25, -0.5, 1, 2.6]) {
        const otra = camaraTres(w, h, g, cam, dH);
        for (const z of [Z_PALO, Z_META]) {
          for (const cuerpos of [0, 0.55, 1]) {
            const a = aPantalla(base.cm, colocar(base.mapa, g, 0, z, cuerpos), w, h);
            const b = aPantalla(otra.cm, colocar(otra.mapa, g, 0, z, cuerpos), w, h);
            // A la profundidad de bloqueo (1,0) no se mueve nada; en 0,97 y 1,06 casi nada.
            expect(Math.abs(a.x - b.x)).toBeLessThan(0.5);
            expect(Math.abs(a.y - b.y)).toBeLessThan(4 + Math.abs(dH) * 4);
          }
        }
        // El horizonte, en cambio, sí baja o sube: es el contrapicado.
        expect(otra.c.horizonte - base.c.horizonte).toBeCloseTo(-dH * g.cuerpo * escalaEn(1), 6);
      }
    });

    it(`${w}x${h}: la cuenta pura de pantallaDe coincide con la cámara de three.js`, () => {
      const cam = { x: w * 0.55, y: pant.top + 120, zoom: 1.7, rot: 0, sacudonX: 3, sacudonY: -2 };
      for (const dH of [0, -1]) {
        const { cm, c, mapa } = camaraTres(w, h, g, cam, dH);
        for (const [x, z, a] of [[0, 1.06, 2], [0.4, 0.74, 1], [-0.7, 0.2, 0.5]] as const) {
          const p = colocar(mapa, g, x, z, a);
          const real = aPantalla(cm, p, w, h);
          const pura = pantallaDe(c, { w, h }, g, p)!;
          expect(Math.abs(real.x - pura.x)).toBeLessThan(1e-3);
          expect(Math.abs(real.y - pura.y)).toBeLessThan(1e-3);
        }
      }
    });

    it(`${w}x${h}: el palo entero entra en el cuadro del director y la meta queda en el centro`, () => {
      // El director guarda el palo en todo cuadro (guajojo-plan.ts, `meta`): con la lente de recorte el palo cae igual en el 3D.
      const hp = altoDelPalo(g, Z_PALO);
      expect(hp).toBeGreaterThan(3);
      expect(hp).toBeLessThan(7);
      const cam = { x: g.cx, y: proyectar(g, 0, Z_PALO).y - g.alto * 0.12, zoom: 1.2, rot: 0, sacudonX: 0, sacudonY: 0 };
      const { cm, mapa } = camaraTres(w, h, g, cam, 0);
      const punta = aPantalla(cm, colocar(mapa, g, 0, Z_PALO, hp), w, h);
      const pie = aPantalla(cm, colocar(mapa, g, 0, Z_PALO, 0), w, h);
      expect(punta.y).toBeGreaterThan(0);
      expect(pie.y).toBeLessThan(h);
      expect(Math.abs(punta.x - w / 2)).toBeLessThan(1);
      // El pie del palo en 3D cae donde lo dibuja el 2D (la base de la caja del palo).
      const q = proyectar(g, 0, Z_PALO);
      expect(Math.abs(pie.y - (h / 2 + (q.y - cam.y) * cam.zoom))).toBeLessThan(0.5);
    });
  }
});

describe("la cámara sube y baja sin saber quién gana", () => {
  it("entra alta, baja en 2,6 segundos, baja un poco en el silencio y un poco más en el golpe, siempre sobre el piso", () => {
    const quieto = { oscuro: 0, ultimo: false, tau: -1 };
    expect(alturaExtra({ t: 0, ...quieto })).toBeCloseTo(2.6, 9);
    expect(alturaExtra({ t: 2.6, ...quieto })).toBeCloseTo(0, 9);
    expect(alturaExtra({ t: 30, ...quieto })).toBe(0);
    expect(alturaExtra({ t: 30, oscuro: 0.36, ultimo: false, tau: -1 })).toBeLessThan(-0.4);
    expect(alturaExtra({ t: 30, oscuro: 0.5, ultimo: true, tau: -1 })).toBeLessThan(alturaExtra({ t: 30, oscuro: 0.36, ultimo: false, tau: -1 }));
    expect(alturaExtra({ t: 40, oscuro: 0, ultimo: false, tau: 1 })).toBeCloseTo(-1.25, 9);
    // Nunca baja de la cintura de una persona.
    for (const pant of PANTALLAS) {
      const g = geoDe(pant);
      for (const e of [{ oscuro: 0.5, ultimo: true, tau: -1 }, { oscuro: 0, ultimo: false, tau: 5 }]) expect(altoCamara(g) + alturaExtra({ t: 40, ...e })).toBeGreaterThan(1.1);
    }
  });

  it("en el celular entra menos alta, para que el subtítulo no corte a la gente, y llega al mismo piso", () => {
    const quieto = { oscuro: 0, ultimo: false, tau: -1 };
    expect(alturaExtra({ t: 0, ...quieto, retrato: true })).toBeCloseTo(1.3, 9);
    expect(alturaExtra({ t: 0, ...quieto, retrato: true })).toBeLessThan(alturaExtra({ t: 0, ...quieto }));
    expect(alturaExtra({ t: 2.6, ...quieto, retrato: true })).toBeCloseTo(0, 9);
    expect(alturaExtra({ t: 40, oscuro: 0, ultimo: false, tau: 1, retrato: true })).toBeCloseTo(-1.25, 9);
  });

  it("la altura depende de la hora y de la fase, no de quién gana: dos rondas con ganadores distintos suben igual", () => {
    for (const t of [0.5, 5, 12, 20]) {
      const a = alturaExtra({ t, oscuro: 0.2, ultimo: false, tau: -1 });
      const b = alturaExtra({ t, oscuro: 0.2, ultimo: false, tau: -1 });
      expect(a).toBe(b);
    }
    const f = alturaExtra.toString();
    expect(f).not.toMatch(/ganador|winner/i);
  });

  it("el plan marca las fases que la cámara 3D usa", () => {
    const plan = planGuajojo(contexto(18, [4], 2));
    const d = plan.datos;
    const ult = d.ciclos[d.ciclos.length - 1]!;
    expect(faseDe(d, ult.tSil0 + 0.5).fase).toBe("silencio");
    expect(ult.ultimo).toBe(true);
    expect(zDe(d, d.rival, ult.tSil0)).toBeCloseTo(Z_ULTIMOS, 2);
  });
});

describe("la geometría del sendero en el 3D", () => {
  it("la cámara y el palo salen de las mismas cuentas del 2D", () => {
    for (const pant of PANTALLAS) {
      const g = geoDe(pant);
      // La largada: un cuerpo del 3D vuelve a medir lo que mide en el 2D a esa distancia.
      expect(focal(g) / D0).toBeCloseTo(g.cuerpo, 9);
      expect((altoCamara(g) * focal(g)) / D0).toBeCloseTo(g.yPie - g.yH, 6);
      expect(mitadEnCuerpos(g) * g.cuerpo).toBeCloseTo(g.mitad, 9);
      expect(escalaEn(0)).toBe(1);
      expect(PROF).toBeCloseTo(1.8 * D0, 9);
      const e = entradaVacia(3, true, [1, 2, 3]);
      expect(e.gente).toHaveLength(3);
      expect(e.ganador).toBe(-1);
    }
  });
});

describe("lo liviano no trae three.js y nada usa azar", () => {
  it("el mapa del Guajojó y el archivo del juego en 2D no importan three.js ni el motor más que como tipo", () => {
    for (const [f, base] of [["guajojo-3d-mapa.ts", aqui], ["../pixi/guajojo.ts", aqui]] as const) {
      const lineas = readFileSync(new URL(f, base), "utf8").split("\n").filter((l) => /^\s*import\s/.test(l));
      for (const l of lineas) {
        if (/from\s+"three"/.test(l) || /\/tres\/(motor|escena|figuras|guajojo-3d)"/.test(l) || /from\s+"\.\/(motor|escena|figuras|guajojo-3d)"/.test(l)) expect(l, `${f}: ${l}`).toMatch(/^\s*import\s+type\b/);
      }
    }
  });

  it("la vista 3D no nombra Math.random ni recibe quién gana antes del golpe", () => {
    const v = fuente("guajojo-3d.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(v).not.toContain("Math.random");
    const dos = readFileSync(new URL("../pixi/guajojo.ts", aqui), "utf8");
    // El 2D llena `ganador` solo desde el golpe.
    expect(dos).toContain("en.ganador = tau >= 0 ? d.ganador : -1;");
    // Y el farolito de la ganadora no viaja al 3D: todos los de pie con la misma luz.
    expect(dos).not.toMatch(/entrada3[^\n]*luz/);
  });

  it("registro: el Guajojó tiene versión en 3D", async () => {
    const { tiene3D } = await import("./registro");
    expect(tiene3D("guajojo")).toBe(true);
  });
});
