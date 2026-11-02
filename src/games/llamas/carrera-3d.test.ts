import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { permite3D, type Entorno3D } from "../permite3d";
import { ACERCA, TAM3D, camara3D, colocar, escala3D, ZC, type Corredora3D } from "./carrera-3d-mapa";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera } from "./carrera-show";

/**
 * El prototipo 3D de la carrera no decide nada: dibuja lo que el plan 2D ya decidió.
 * Estas pruebas cuidan tres cosas: que las posiciones que dibuja son las del plan,
 * que la cámara mira lo que mira el director, y que se apaga donde tiene que apagarse.
 */

/** El 2D pone a quien corre la recta en `Xs + (q + (pq - q) · ENSANCHE) · RECTA · ancho` (`posicion` en carrera.ts). */
const ENSANCHE = 1.7;
const xDelDosD = (pq: number, q: number, Xs: number, w: number): number => Xs + (q + (pq - q) * ENSANCHE) * RECTA * w;

const QS = [0.25, 0.5, 0.7, 0.88, 1];

describe("el 3D dibuja las posiciones del plan 2D", () => {
  it("la cuenta del 2D que usa el 3D es la que está escrita en carrera.ts", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    expect(fuente).toContain("const pq = d.final.pos(carril, qq);");
    expect(fuente).toContain("const xl = Xs + (qq + (pq - qq) * 1.7) * RECTA * P.w;");
  });

  for (const n of [5, 8, 18, 30]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 70, 88 y 100 % cada carril cae donde el plan lo manda`, () => {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const w = 1366, u = 1.9, Xs = 4120, s = escala3D(u);
        for (const q of QS) {
          const t = d.tDeQ(q);
          // El reloj de la recta y la fracción de pista son la misma cosa, de ida y de vuelta.
          expect(d.q(t)).toBeCloseTo(q, 6);
          const puestos = d.lanes.map((persona, carril) => {
            const pq = d.final.pos(carril, q);
            const c: Corredora3D = { persona, x: xDelDosD(pq, q, Xs, w), y: 300 + carril * 70, salto: 0, esc: 0.6, velocidad: 1, momento: null, fase: 0 };
            return { carril, pq, p: colocar(c, u) };
          });
          for (const { carril, pq, p } of puestos) {
            // Del x del 3D se vuelve a la fracción de pista y es la del plan.
            const vuelta = (p.x / s - Xs) / (RECTA * w);
            expect(q + (vuelta - q) / ENSANCHE).toBeCloseTo(pq, 9);
            // Los carriles quedan en el mismo orden de profundidad.
            if (carril > 0) expect(p.z).toBeGreaterThan(puestos[carril - 1]!.p.z);
          }
          // El orden en la pista es el del plan: quien va más adelante en el plan va más adelante en el 3D.
          const porPlan = [...puestos].sort((a, b) => b.pq - a.pq || a.carril - b.carril).map((x) => x.carril);
          const por3D = [...puestos].sort((a, b) => b.p.x - a.p.x || a.carril - b.carril).map((x) => x.carril);
          expect(por3D).toEqual(porPlan);
        }
        // En la meta, la ganadora es la que más adelante termina en el plan: el 3D no cambia quién gana.
        const final = d.lanes.map((_, carril) => d.final.pos(carril, 1));
        const campeona = d.lanes.indexOf(d.campeona);
        expect(final[campeona]).toBe(Math.max(...final));
      });
    }
  }

  it("la altura y la profundidad salen de los píxeles del 2D, a la misma escala", () => {
    const u = 2;
    const s = escala3D(u);
    const p = colocar({ persona: 3, x: 1000, y: 400, salto: 30, esc: 0.5, velocidad: 1, momento: null, fase: 0 }, u);
    expect(p.x).toBeCloseTo(1000 * s, 9);
    expect(p.y).toBeCloseTo(30 * s, 9);
    expect(p.z).toBeCloseTo(400 * s * ZC, 9);
    expect(p.escala).toBeCloseTo(0.5 * s * TAM3D, 9);
  });
});

describe("la cámara del 3D mira lo que mira el director", () => {
  const u = 1.5, w = 1366, h = 768;
  const s = escala3D(u);

  it("apunta al mismo punto y a la misma altura del cuerpo", () => {
    const c = camara3D({ x: 2400, y: 380, zoom: 1.3, rot: 0 }, w, h, u, 0.6);
    expect(c.mira[0]).toBeCloseTo(2400 * s, 9);
    expect(c.mira[1]).toBeGreaterThan(0);
    expect(c.giro).toBe(0);
  });

  it("el ancho que se ve a esa distancia es el del 2D con ese acercamiento (un poco más cerca, `ACERCA`)", () => {
    for (const zoom of [0.6, 1, 1.7, 2.4]) {
      const c = camara3D({ x: 0, y: 380, zoom, rot: 0 }, w, h, u, 0.6);
      const dist = Math.hypot(c.pos[0] - c.mira[0], c.pos[1] - c.mira[1], c.pos[2] - c.mira[2]);
      const ancho = 2 * dist * Math.tan(c.fov / 2) * (w / h);
      expect(ancho).toBeCloseTo((w / zoom) * s * ACERCA, 6);
    }
  });

  it("acercarse es acercarse: el doble de zoom, la mitad de distancia", () => {
    const a = camara3D({ x: 0, y: 380, zoom: 1, rot: 0 }, w, h, u, 0.6);
    const b = camara3D({ x: 0, y: 380, zoom: 2, rot: 0 }, w, h, u, 0.6);
    const da = Math.hypot(a.pos[0] - a.mira[0], a.pos[1] - a.mira[1], a.pos[2] - a.mira[2]);
    const db = Math.hypot(b.pos[0] - b.mira[0], b.pos[1] - b.mira[1], b.pos[2] - b.mira[2]);
    expect(da / db).toBeCloseTo(2, 9);
  });

  it("es función de la cámara del 2D y nada más: la misma entrada da la misma cámara", () => {
    const a = camara3D({ x: 1234, y: 321, zoom: 1.4, rot: 0.02 }, w, h, u, 0.55);
    const b = camara3D({ x: 1234, y: 321, zoom: 1.4, rot: 0.02 }, w, h, u, 0.55);
    expect(b).toEqual(a);
    expect(a.giro).toBe(0.02);
  });
});

describe("el 3D se apaga solo", () => {
  const bueno: Entorno3D = { motor: "3d", webgl: true, ahorroDeDatos: false, conexion: null, compartir: false };

  it("corre con la bandera y buenas condiciones", () => {
    expect(permite3D(bueno)).toBe(true);
    expect(permite3D({ ...bueno, conexion: "4g" })).toBe(true);
  });

  it("nunca por defecto: sin la bandera, o con otra, no corre", () => {
    expect(permite3D({ ...bueno, motor: null })).toBe(false);
    expect(permite3D({ ...bueno, motor: "clasico" })).toBe(false);
    expect(permite3D({ ...bueno, motor: "pixi" })).toBe(false);
  });

  it("sin WebGL, con ahorro de datos, con datos lentos o con el modo para compartir, la bandera se ignora", () => {
    expect(permite3D({ ...bueno, webgl: false })).toBe(false);
    expect(permite3D({ ...bueno, ahorroDeDatos: true })).toBe(false);
    expect(permite3D({ ...bueno, compartir: true })).toBe(false);
    for (const c of ["slow-2g", "2g", "3g"]) expect(permite3D({ ...bueno, conexion: c })).toBe(false);
  });
});

describe("el 3D no tiene azar ni reloj propio", () => {
  for (const archivo of ["carrera-3d.ts", "carrera-3d-mapa.ts"]) {
    it(`${archivo} no usa Math.random ni reloj`, () => {
      const fuente = readFileSync(new URL(`./${archivo}`, import.meta.url), "utf8");
      expect(fuente).not.toMatch(/Math\.random/);
      expect(fuente).not.toMatch(/Date\.now|new Date\(/);
      expect(fuente).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
    });
  }

  it("el único lugar que nombra Math.random es el que le presta a three.js un contador para sus identificadores", () => {
    const fuente = readFileSync(new URL("./carrera-3d-ids.ts", import.meta.url), "utf8");
    expect(fuente).toContain("Math.random = original;");
  });

  it("three.js solo se importa desde el archivo del 3D, nunca desde el paquete normal", () => {
    for (const archivo of ["carrera.ts", "carrera-3d-mapa.ts", "../engine.ts", "../pixi/index.ts", "../permite3d.ts"]) {
      const fuente = readFileSync(new URL(`./${archivo}`, import.meta.url), "utf8");
      expect(fuente).not.toMatch(/from\s+["']three["']/);
      // El archivo del 3D solo se pide con import dinámico.
      expect(fuente).not.toMatch(/^import\s+[^;]*["'][^"']*carrera-3d["']/m);
    }
  });
});
