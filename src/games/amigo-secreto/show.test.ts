import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "../pixi/kit/azar";
import { problemasDeMomentos } from "../pixi/kit/director";
import { validarGuion } from "../pixi/kit/guion";
import { problemasDeMarcador } from "../pixi/kit/marcador";
import { DIRECCIONES, problemasDeRespuestas } from "../pixi/kit/respuestas";
import type { Contexto, Kit } from "../pixi/kit/tipos";
import { asignarAmigos } from "./asignacion";
import { TEXTOS, cajaDe, layoutTarjetas, planAmigo, type Pant } from "./show";

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

const LISTAS = [2, 3, 8, 9, 18, 40, 200];
const ganadoresDe = (n: number): number[] => [Math.min(n - 1, 3)];
const PANTALLAS: Pant[] = [
  { w: 1920, h: 1080, k: 1.5, top: 82, bottom: 974 },
  { w: 1280, h: 720, k: 1, top: 82, bottom: 614 },
  { w: 844, h: 390, k: 0.93, top: 60, bottom: 330 },
];

/** Un kit de mentira con lo que usan las tomas y el foco. */
const kitFalso = (p: Pant): Kit =>
  ({
    pantalla: () => ({ ...p, retrato: p.h > p.w * 1.1 }),
    cam: { toScreen: (x: number, y: number) => ({ x, y }) },
  }) as unknown as Kit;

describe("Amigo secreto: el plan", () => {
  it("la misma ronda cuenta lo mismo: el plan es una función de la lista y la semilla", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = planAmigo(contexto(n, ganadoresDe(n)));
        return JSON.stringify({ d: p.duracion, a: p.arco, x: p.datos, g: p.guion.map((l) => [l.t, l.texto, l.prioridad, l.hecho]), r: p.respuestas(p.duracion / 2) });
      };
      expect(resumir()).toBe(resumir());
    }
  });

  it("la asignación sale del faro: es la del módulo puro, nadie se autoasigna y todos reciben", () => {
    for (const n of LISTAS) {
      const p = planAmigo(contexto(n, ganadoresDe(n)));
      const esperada = asignarAmigos(Array.from({ length: n }, (_, i) => `Persona ${i + 1}`), RONDA);
      expect(p.datos.asignacion).toEqual(esperada);
      for (let i = 0; i < n; i++) expect(p.datos.asignacion[i]).not.toBe(i);
      expect([...p.datos.asignacion].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("el juego no decide nada: quien gana es el que fijó el protocolo y su sobre es el último", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const p = planAmigo(contexto(n, gs));
        expect(p.datos.ganador).toBe(gs[0]);
        expect(p.datos.orden.at(-1)).toBe(gs[0]);
        expect(new Set(p.datos.orden).size).toBe(n);
      }
    }
  });

  it("con dos personas, el show los hace intercambiarse: la asignación es mutua", () => {
    const p = planAmigo(contexto(2, [0]));
    expect(p.datos.asignacion).toEqual([1, 0]);
    expect(p.datos.orden).toEqual([1, 0]);
  });

  it("los sobres se abren de a uno, en orden, cada uno con su tiempo, y el ganador se abre con el golpe", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAmigo(contexto(n, ganadoresDe(n)));
      // En el orden de la revelación, cada sobre se abre después del anterior.
      for (let k = 1; k < d.orden.length; k++) {
        const previo = d.tiempos[d.orden[k - 1] as number] ?? 0;
        const actual = d.tiempos[d.orden[k] as number] ?? 0;
        expect(actual, `posición ${k} con n=${n}`).toBeGreaterThanOrEqual(previo);
      }
      // El ganador se abre con el golpe; todos los demás, antes.
      expect(d.tiempos[d.ganador]).toBe(duracion);
      for (const i of d.orden.slice(0, -1)) expect(d.tiempos[i] ?? 0).toBeLessThan(duracion);
      // De a uno: entre dos aperturas individuales hay su segundo de show (menos en la revelación en grupo).
      const individuales = d.orden.slice(0, d.individuales);
      for (let k = 1; k < individuales.length; k++) {
        expect((d.tiempos[individuales[k] as number] ?? 0) - (d.tiempos[individuales[k - 1] as number] ?? 0)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("dura lo que un show: con listas largas se recorta a una revelación en grupo", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAmigo(contexto(n, ganadoresDe(n)));
      expect(duracion).toBeGreaterThanOrEqual(8);
      expect(duracion, `con ${n} personas`).toBeLessThanOrEqual(22);
      if (n > 10) {
        expect(d.individuales).toBeLessThan(n - 1);
        expect(d.tGrupo).not.toBeNull();
        const grupo = d.orden.slice(d.individuales, -1);
        for (const i of grupo) {
          const t = d.tiempos[i] ?? 0;
          expect(t, `persona ${i} con n=${n}`).toBeGreaterThanOrEqual(d.tGrupo ?? 0);
          expect(t).toBeLessThan(d.tGrupo! + 4);
        }
      } else {
        expect(d.tGrupo).toBeNull();
      }
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) expect(problemasDeMomentos(planAmigo(contexto(n, ganadoresDe(n)))), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: seis palabras, un nombre, sin números", () => {
    for (const n of LISTAS) {
      const c = contexto(n, ganadoresDe(n));
      const p = planAmigo(c);
      const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
      expect(r.problemas, `con ${n}`).toEqual([]);
      expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
    }
  });

  it("la tensión mira el sobre del premio y otro más, nunca al ganador solo", () => {
    for (const n of LISTAS) {
      if (n < 3) continue;
      const p = planAmigo(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        const plano = p.momentos.tension.toma(kitFalso(pant), p.duracion) as { caja: { x: number; w: number; h: number } };
        expect(plano.caja.w).toBeGreaterThan(0);
        expect(plano.caja.h).toBeGreaterThan(0);
        const g = cajaDe(pant, layoutTarjetas(pant, n), p.datos.ganador);
        const r = cajaDe(pant, layoutTarjetas(pant, n), p.datos.rival);
        expect(plano.caja.x).toBeLessThanOrEqual(Math.min(g.x, r.x));
        expect(plano.caja.x + plano.caja.w).toBeGreaterThanOrEqual(Math.max(g.x + g.w, r.x + r.w));
      }
    }
  });

  it("el foco cae dentro de la pantalla, sobre el sobre del premio", () => {
    for (const n of LISTAS) {
      const p = planAmigo(contexto(n, ganadoresDe(n)));
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

describe("Amigo secreto: la regla del niño", () => {
  it("un solo sentido de avance", () => {
    for (const n of LISTAS) {
      const p = planAmigo(contexto(n, ganadoresDe(n)));
      expect(DIRECCIONES).toContain(p.sentido);
    }
  });

  it("el marcador es el único contador: arranca en todos, baja con cada sobre y con el golpe queda en 1", () => {
    for (const n of LISTAS) {
      const p = planAmigo(contexto(n, ganadoresDe(n)));
      // Con la revelación en grupo el contador baja de a varios: ese es el paso que el juego declara,
      // y solo dentro de la ventana del grupo. Fuera de ella, de a uno.
      let pasoMax = 1;
      for (let t = 0.05; t <= p.duracion; t += 0.05) {
        const paso = Math.round(p.marcador(t - 0.05) - p.marcador(t));
        if (paso > pasoMax) pasoMax = paso;
      }
      expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax }), `con ${n}`).toEqual([]);
      if (p.datos.tGrupo === null) {
        expect(pasoMax, `con ${n} sin grupo`).toBe(1);
      } else {
        const antesDeGrupo = p.datos.tGrupo - 0.05;
        for (let t = 0.05; t <= antesDeGrupo; t += 0.05) {
          expect(Math.round(p.marcador(t - 0.05) - p.marcador(t)), `antes del grupo con n=${n}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("las respuestas dicen quiénes siguen, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const p = planAmigo(contexto(n, gs));
        expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n}`).toEqual([]);
        const r = p.respuestas(p.duracion);
        expect(r.paso).toMatchObject({ tipo: "gano", quien: gs[0] });
        expect(r.progreso).toBeCloseTo(1, 6);
      }
    }
  });

  it("la meta (el sobre que se está abriendo) cae dentro de la pantalla en todas las pantallas", () => {
    for (const n of LISTAS) {
      const p = planAmigo(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        for (const t of [0, p.duracion / 2, p.duracion]) {
          const m = p.momentos.meta?.(kitFalso(pant), t);
          if (m) {
            expect(m.x).toBeGreaterThanOrEqual(-1);
            expect(m.y).toBeGreaterThanOrEqual(pant.top - 1);
            expect(m.x + m.w).toBeLessThanOrEqual(pant.w + 1);
            expect(m.y + m.h).toBeLessThanOrEqual(pant.bottom + 1);
          }
        }
      }
    }
  });
});

describe("Amigo secreto: los textos", () => {
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
      const p = planAmigo(c);
      expect(validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres }).problemas, idioma).toEqual([]);
    }
  });
});

describe("Amigo secreto: el lugar de los sobres", () => {
  it("todas las tarjetas caen dentro de la franja libre, en todas las pantallas y con cualquier cantidad", () => {
    for (const pant of PANTALLAS) {
      for (const n of [2, 3, 8, 18, 40, 200]) {
        const l = layoutTarjetas(pant, n);
        for (let i = 0; i < n; i++) {
          const c = cajaDe(pant, l, i);
          expect(c.x, `persona ${i} con n=${n}`).toBeGreaterThanOrEqual(-1);
          expect(c.x + c.w).toBeLessThanOrEqual(pant.w + 1);
          expect(c.y).toBeGreaterThanOrEqual(pant.top - 1);
          expect(c.y + c.h).toBeLessThanOrEqual(pant.bottom + 1);
        }
      }
    }
  });

  it("ninguna tarjeta repite lugar: cada sobre es un sobre", () => {
    for (const n of [2, 8, 18, 200]) {
      const l = layoutTarjetas(PANTALLAS[0] as Pant, n);
      const vistos = new Set(l.pos.map((q) => `${q.x},${q.y}`));
      expect(vistos.size).toBe(n);
    }
  });
});
