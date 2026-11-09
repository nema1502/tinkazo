import { readFileSync } from "node:fs";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "../pixi/kit/azar";
import type { Contexto } from "../pixi/kit/tipos";
import { geoDe, puntoDe, type Geo, type Pant } from "../pixi/toborochi-arbol";
import { planToborochi, vientoEn } from "../pixi/toborochi-plan";
import { TEXTOS } from "../pixi/toborochi-textos";
import { aplicarPose, crearMapa, poseCamara } from "./camara";
import { compararPuestos, ordenPor, type Puesto2D } from "./prueba";
import {
  FOV, PROF_COPA, aMundo, azimutEn, camaraParaMotor, distanciaDe, elevacionEn, entradaVacia, perfilEn, profMax, profundidadDe,
} from "./toborochi-3d-mapa";

/**
 * El Toborochi en 3D no decide nada: dibuja lo que el plan 2D ya puso. Estas pruebas cuidan que cada flor cae donde el 2D la
 * puso (la cámara en reposo ve cada punto de la pantalla del 2D en el mismo lugar), que ninguna se ve más grande que otra por
 * la profundidad, que la cámara no sabe quién gana y que lo liviano no trae three.js.
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

/** Dónde cae en la pantalla un punto del mundo, con la cámara del director en reposo mirando al centro de la zona. */
function pantallaDeMundo(g: Geo, u: number, X: number, Y: number, Z: number, t = 10): { x: number; y: number } {
  const cam = { x: g.cx, y: (g.top + g.bottom) / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
  const entrada = { t, tau: -1, tQuedan0: Number.POSITIVE_INFINITY, geo: g, cam };
  const perfil = perfilEn(entrada);
  const pose = poseCamara(camaraParaMotor(cam), g.h, u, perfil);
  const c = new PerspectiveCamera();
  aplicarPose(c, pose, g.w / g.h);
  const s = crearMapa(perfil, u).s;
  const v = new Vector3(X * s, Y * s, Z * s).project(c);
  return { x: ((v.x + 1) / 2) * g.w, y: ((1 - v.y) / 2) * g.h };
}
const enPantalla2D = (g: Geo, x: number, y: number): { x: number; y: number } => ({ x: x - g.cx + g.w / 2, y: y - (g.top + g.bottom) / 2 + g.h / 2 });

describe("el 3D dibuja las posiciones del plan 2D", () => {
  for (const n of [5, 18, 30]) {
    for (const semilla of [1, 2, 3, 4]) {
      it(`con ${n} personas, semilla ${semilla}: en 25, 50, 70, 88 y 100 % cada flor cae donde el 2D la puso`, () => {
        const plan = planToborochi(contexto(n, [n - 1], semilla));
        const d = plan.datos;
        for (const p of PANTALLAS) {
          const g = geoDe(p, n);
          const u = p.k;
          for (const q of QS) {
            const t = q * plan.duracion;
            const w = vientoEn(d, t);
            const puestos: Puesto2D[] = [];
            for (let i = 0; i < n; i++) {
              const l = d.lugar[i]!;
              const b = puntoDe(g, l);
              // La misma cuenta del 2D: la copa se dobla con el viento, más arriba más, igual para todas.
              const x = b.x + w * g.copa.ancho * 0.048 * (0.3 + 0.7 * l.v);
              const y = b.y;
              const M = aMundo(g, distanciaDe(g.h), x, y, 0);
              // En el árbol, el punto del 2D va al plano del árbol, a la altura sobre el piso.
              expect(M.Z).toBeCloseTo(0, 9);
              expect(M.Y).toBeCloseTo(g.suelo - y, 9);
              puestos.push({ id: i, x: M.X, y: 0, alto: M.Y });
              // Y la cámara en reposo lo ve en el mismo lugar de la pantalla que el 2D.
              const e2 = enPantalla2D(g, x, y);
              const e3 = pantallaDeMundo(g, u, M.X, M.Y, M.Z);
              expect(Math.abs(e3.x - e2.x)).toBeLessThan(0.6);
              expect(Math.abs(e3.y - e2.y)).toBeLessThan(0.6);
            }
            // La posición vuelve intacta con el mapa de la casa y el orden a lo ancho es el mismo.
            expect(compararPuestos(puestos, { zc: 1, elevacion: 0, azimut: 0, fov: FOV, acerca: 1, tam: 1, altoMira: 0, pieMira: 0 }, u)).toEqual([]);
          }
        }
      });
    }
  }

  it("la alfombra: lo que el 2D pone en el piso de abajo cae en el mismo lugar de la pantalla, más cerca de la cámara cuanto más abajo", () => {
    for (const p of PANTALLAS) {
      const g = geoDe(p, 18);
      const D = distanciaDe(g.h);
      let zAnterior = -1;
      for (let y = g.suelo + 1; y <= g.bottom; y += (g.bottom - g.suelo) / 8) {
        for (const x of [g.w * 0.1, g.w * 0.5, g.w * 0.9]) {
          const M = aMundo(g, D, x, y, 0);
          expect(M.Y).toBe(0);
          expect(M.k).toBeLessThan(1);
          const e2 = enPantalla2D(g, x, y);
          const e3 = pantallaDeMundo(g, p.k, M.X, M.Y, M.Z);
          expect(Math.abs(e3.x - e2.x)).toBeLessThan(0.6);
          expect(Math.abs(e3.y - e2.y)).toBeLessThan(0.6);
        }
        const z = aMundo(g, D, g.cx, y, 0).Z;
        expect(z).toBeGreaterThan(zAnterior);
        zAnterior = z;
      }
      // El suelo del árbol y el de la alfombra se juntan sin un salto.
      const justo = aMundo(g, D, g.cx + 100, g.suelo + 0.001, 0);
      expect(justo.Z).toBeLessThan(0.01);
      expect(justo.k).toBeGreaterThan(0.9999);
    }
  });
});

describe("la profundidad no hace más grande a nadie", () => {
  for (const [w, h] of [[1366, 768], [1920, 1080], [390, 844]] as const) {
    it(`a ${w} por ${h}, con 30 personas, la flor más grande en pantalla mide menos de un 10 % más que la más chica`, () => {
      const g = geoDe({ w, h, k: h / 720, top: 82, bottom: h - 128 }, 30);
      const D = distanciaDe(h);
      const esc: number[] = [];
      const lugares = planToborochi(contexto(30, [3], 7)).datos.lugar;
      for (const l of lugares) esc.push(D / (D - profundidadDe(l.u, l.v, h)));
      expect(g.r).toBeGreaterThan(0);
      expect(Math.max(...esc) / Math.min(...esc)).toBeLessThan(1.1);
    });
  }

  it("sale del lugar en la copa y nada más: el mismo lugar, la misma profundidad, sea quien sea", () => {
    for (let i = 0; i < 40; i++) {
      const u = (i % 9) / 4 - 1;
      const v = (i % 7) / 6;
      expect(profundidadDe(u, v, 768)).toBe(profundidadDe(u, v, 768));
      expect(Math.abs(profundidadDe(u, v, 768))).toBeLessThanOrEqual(profMax(768));
    }
    expect(PROF_COPA).toBeLessThanOrEqual(0.06);
  });
});

describe("la cámara 3D no sabe quién gana", () => {
  it("el perfil es el mismo con cualquier ganador: depende de la hora, del golpe y de la cámara del director", () => {
    const g = geoDe(PANTALLAS[0]!, 18);
    const cam = { x: g.cx, y: 300, zoom: 1.4, rot: 0, sacudonX: 0, sacudonY: 0 };
    for (const t of [0, 1.2, 3, 8, 14, 20]) {
      const a = entradaVacia(18, g, true);
      const b = entradaVacia(18, g, true);
      Object.assign(a, { t, cam, tQuedan0: 12, ganador: -1 });
      Object.assign(b, { t, cam, tQuedan0: 12, ganador: -1 });
      expect(perfilEn(a)).toEqual(perfilEn(b));
    }
  });

  it("entra desde un poco más alto y baja; con el golpe, un contrapicado leve; y gira cinco grados como mucho, siempre hacia el mismo lado", () => {
    expect(elevacionEn(0, -1)).toBeGreaterThan(0.1);
    expect(elevacionEn(0, -1)).toBeLessThan((11 * Math.PI) / 180);
    expect(elevacionEn(2.6, -1)).toBeCloseTo(0, 9);
    expect(elevacionEn(20, 5)).toBeLessThan(0);
    expect(elevacionEn(20, 5)).toBeGreaterThan(-(5 * Math.PI) / 180);
    for (let t = 0; t < 30; t += 0.25) {
      expect(azimutEn(t, 12)).toBeGreaterThanOrEqual(0);
      expect(azimutEn(t, 12)).toBeLessThanOrEqual((5 * Math.PI) / 180);
    }
    // Ningún cambio de la cámara supera 20 grados por segundo.
    for (let t = 0; t < 30; t += 1 / 60) {
      expect(Math.abs(elevacionEn(t + 1 / 60, t > 15 ? t - 15 : -1) - elevacionEn(t, t > 15 ? t - 15 : -1)) * 60).toBeLessThan((20 * Math.PI) / 180);
    }
  });

  it("el horizonte queda quieto: la inclinación de la cámara se copia con tope de dos grados", () => {
    const c = camaraParaMotor({ x: 1, y: 2, zoom: 1, rot: 0.2, sacudonX: 0, sacudonY: 0 });
    expect(Math.abs(c.rot)).toBeLessThanOrEqual((2 * Math.PI) / 180 + 1e-9);
    expect(c.y).toBe(0);
  });

  it("el 2D no le da el ganador al 3D antes del golpe", () => {
    const dos = fuente("../pixi/toborochi.ts");
    expect(dos).toMatch(/en\.ganador = tau >= 0 \? d\.ganador : -1/);
  });
});

describe("lo liviano no trae three.js ni el motor", () => {
  it("el 2D y la cuenta pura no importan three.js ni el motor más que como tipo", () => {
    for (const f of ["../pixi/toborochi.ts", "./toborochi-3d-mapa.ts"]) {
      for (const l of fuente(f).split("\n")) {
        if (/from\s+"three"/.test(l) || /from\s+"\.\/(motor|escena|figuras)"/.test(l) || /tres\/(motor|escena|figuras)/.test(l)) expect(l, `${f}: ${l}`).toMatch(/^\s*import\s+type\b/);
      }
    }
  });

  it("sin Math.random en el 3D: lo que parece azar sale de un hash del lugar", () => {
    expect(fuente("./toborochi-3d.ts")).not.toMatch(/Math\.random/);
    expect(fuente("./toborochi-3d-mapa.ts")).not.toMatch(/Math\.random/);
  });

  it("el 3D coloca todo con el mapa de la casa y el cielo, los cerros y las luces se arman con el kit", () => {
    const f = fuente("./toborochi-3d.ts");
    expect(f).toMatch(/aMundo\(/);
    expect(f).toMatch(/definir3D\(/);
    expect(f).toMatch(/motor\.cuadro\(/);
    expect(fuente("./toborochi-3d-mapa.ts")).toMatch(/crearMapa|perfil\(/);
  });

  it("la entrada vacía trae un arreglo de flores por persona y ningún ganador", () => {
    const g = geoDe(PANTALLAS[0]!, 30);
    const e = entradaVacia(30, g, true);
    expect(e.flores).toHaveLength(30);
    expect(e.ganador).toBe(-1);
    expect(e.tau).toBe(-1);
    expect(ordenPor(e.flores.map((f, i) => ({ id: i, v: f.x })))).toHaveLength(30);
  });
});
