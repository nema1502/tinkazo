import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeMomentos } from "./kit/director";
import { validarGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { DIRECCIONES, problemasDeRespuestas } from "./kit/respuestas";
import type { Contexto, Kit } from "./kit/tipos";
import { lugares, plan__CAP__, tandaDe, type Pant } from "./__ID__-plan";
import { TEXTOS } from "./__ID__-textos";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego. */
function contexto(n: number, ganadores: number[], semilla = 7, idioma: "es" | "en" = "es"): Contexto {
  const rng = sembrar(semilla);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda: RONDA,
    rng,
    idioma,
    txt: (clave, ...args) => {
      const v = (TEXTOS[idioma] as Record<string, string | ((...a: unknown[]) => string)>)[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => azarDe(RONDA, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

const LISTAS = [2, 3, 8, 9, 18, 60, 200];
const ganadoresDe = (n: number): number[] => [Math.min(n - 1, 3)];
const PANTALLAS: Pant[] = [
  { w: 1920, h: 1080, k: 1.5, top: 82, bottom: 974 },
  { w: 1280, h: 720, k: 1, top: 82, bottom: 614 },
  { w: 390, h: 844, k: 0.93, top: 100, bottom: 726 },
];

/** Un kit de mentira con lo que usan las tomas y el foco. */
const kitFalso = (p: Pant): Kit =>
  ({
    pantalla: () => ({ ...p, retrato: p.h > p.w * 1.1 }),
    cam: { toScreen: (x: number, y: number) => ({ x, y }) },
  }) as unknown as Kit;

describe("__NOMBRE__: el plan", () => {
  it("la misma ronda cuenta lo mismo: el plan es una función de la lista y la semilla", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = plan__CAP__(contexto(n, ganadoresDe(n)));
        return JSON.stringify({ d: p.duracion, a: p.arco, x: p.datos, g: p.guion.map((l) => [l.t, l.texto, l.prioridad, l.hecho]), r: p.respuestas(p.duracion / 2) });
      };
      expect(resumir()).toBe(resumir());
    }
  });

  it("otras semillas cuentan otras historias", () => {
    const arcos = new Set(Array.from({ length: 24 }, (_, s) => plan__CAP__(contexto(18, [3], s + 1)).arco));
    expect(arcos.size).toBeGreaterThan(1);
  });

  it("el juego no decide nada: quien gana está siempre en la mesa final y es el que llegó dado", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const { datos } = plan__CAP__(contexto(n, gs));
        expect(datos.ganador).toBe(gs[0]);
        for (const g of gs) expect(datos.finalistas).toContain(g);
        expect(datos.finalistas.length).toBeGreaterThanOrEqual(Math.min(n, 2));
        expect(datos.finalistas.length).toBeLessThanOrEqual(Math.max(7, gs.length + 1));
        expect(new Set(datos.finalistas).size).toBe(datos.finalistas.length);
        expect(datos.finalistas.every((i) => i >= 0 && i < n)).toBe(true);
      }
    }
  });

  it("dura lo que un show: ni un parpadeo ni una eternidad", () => {
    for (const n of LISTAS) {
      const { duracion } = plan__CAP__(contexto(n, ganadoresDe(n)));
      expect(duracion).toBeGreaterThanOrEqual(10);
      expect(duracion).toBeLessThanOrEqual(40);
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) expect(problemasDeMomentos(plan__CAP__(contexto(n, ganadoresDe(n)))), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: seis palabras, un nombre, sin números", () => {
    for (const n of LISTAS) {
      const c = contexto(n, ganadoresDe(n));
      const p = plan__CAP__(c);
      const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
      expect(r.problemas, `con ${n}`).toEqual([]);
      expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
    }
  });

  it("la tensión mira a la mesa final entera, nunca a quien gana solo", () => {
    for (const n of LISTAS.filter((x) => x >= 2)) {
      const p = plan__CAP__(contexto(n, ganadoresDe(n)));
      expect(p.datos.finalistas.length).toBeGreaterThanOrEqual(2);
      for (const pant of PANTALLAS) {
        const plano = p.momentos.tension.toma(kitFalso(pant), p.momentos.tension.desde) as { caja: { w: number; h: number } };
        expect(plano.caja.w).toBeGreaterThan(0);
        expect(plano.caja.h).toBeGreaterThan(0);
      }
    }
  });

  it("el foco cae dentro de la pantalla, sobre quien gana", () => {
    for (const n of LISTAS) {
      const p = plan__CAP__(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        const f = p.momentos.foco(kitFalso(pant));
        expect(f.x).toBeGreaterThan(0);
        expect(f.x).toBeLessThan(pant.w);
        expect(f.y).toBeGreaterThan(pant.top - 1);
        expect(f.y).toBeLessThan(pant.bottom + 1);
        expect(f.r).toBeGreaterThan(0);
      }
    }
  });
});

describe("__NOMBRE__: la regla del niño", () => {
  it("un solo sentido de avance, y es uno de los que existen", () => {
    for (const n of LISTAS) expect(DIRECCIONES).toContain(plan__CAP__(contexto(n, ganadoresDe(n))).sentido);
  });

  it("el marcador es el único contador: arranca en todos, solo baja y con el golpe queda en 1", () => {
    for (const n of LISTAS) {
      const p = plan__CAP__(contexto(n, ganadoresDe(n)));
      // Pasar lista no es eliminar: cuando se arma la mesa final bajan juntos. Si tu juego saca a la gente de a uno, `pasoMax: 1`.
      expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax: n }), `con ${n}`).toEqual([]);
    }
  });

  it("las respuestas dicen quién va adelante, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const p = plan__CAP__(contexto(n, gs));
        expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n}`).toEqual([]);
      }
    }
  });

  it("la meta (la mesa final) cae dentro de la pantalla en todas las pantallas", () => {
    for (const n of LISTAS) {
      const p = plan__CAP__(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        const m = p.momentos.meta?.(kitFalso(pant), 0);
        expect(m, `con ${n}`).toBeTruthy();
        if (m) {
          expect(m.x).toBeGreaterThanOrEqual(-1);
          expect(m.x + m.w).toBeLessThanOrEqual(pant.w + 1);
        }
      }
    }
  });
});

describe("__NOMBRE__: los lugares", () => {
  it("todos entran en la franja libre de la pantalla, de a uno por lugar", () => {
    for (const pant of PANTALLAS) {
      for (let m = 0; m <= 8; m++) {
        const ls = lugares(pant, m);
        expect(ls).toHaveLength(m);
        for (const l of ls) {
          expect(l.x).toBeGreaterThan(0);
          expect(l.x).toBeLessThan(pant.w);
          expect(l.y).toBeGreaterThanOrEqual(pant.top);
          expect(l.y).toBeLessThanOrEqual(pant.bottom);
        }
        expect(new Set(ls.map((l) => `${Math.round(l.x)},${Math.round(l.y)}`)).size).toBe(m);
      }
    }
  });

  it("las tandas nunca pasan de ocho, no se repiten y siempre hay alguien en la mesa", () => {
    for (const n of LISTAS) {
      const vistos = new Set<number>();
      for (let t = 0.8; t < 0.8 + 4 * 4.5; t += 0.5) {
        const tanda = tandaDe(n, t, 0.8, 0.8 + Math.min(4, Math.ceil(n / 8)) * 4.5);
        if (t >= 0.8 + Math.min(4, Math.ceil(n / 8)) * 4.5) continue;
        expect(tanda.length, `con ${n} a los ${t} s`).toBeGreaterThan(0);
        expect(tanda.length).toBeLessThanOrEqual(8);
        for (const i of tanda) vistos.add(i);
      }
      if (n <= 32) expect(vistos.size, `con ${n}`).toBe(n);
    }
  });
});

describe("__NOMBRE__: los textos", () => {
  it("están en español y en inglés, con las mismas claves y del mismo tipo", () => {
    const es = Object.keys(TEXTOS.es).sort();
    expect(Object.keys(TEXTOS.en).sort()).toEqual(es);
    for (const clave of es) {
      const a = (TEXTOS.es as Record<string, unknown>)[clave];
      const b = (TEXTOS.en as Record<string, unknown>)[clave];
      expect(typeof a).toBe(typeof b);
    }
  });

  it("ninguna frase queda vacía ni rompe la regla del niño en ninguno de los dos idiomas", () => {
    for (const idioma of ["es", "en"] as const) {
      const c = contexto(18, [3], 7, idioma);
      const p = plan__CAP__(c);
      expect(validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres }).problemas, idioma).toEqual([]);
    }
  });
});
