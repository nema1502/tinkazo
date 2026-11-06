import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeMomentos } from "./kit/director";
import { validarGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { DIRECCIONES, problemasDeRespuestas } from "./kit/respuestas";
import type { Contexto, Kit } from "./kit/tipos";
import { avanceDe, planAutos, posicionDe, salidaDe, vivos, type Pant } from "./autos-plan";
import { TEXTOS } from "./autos-textos";

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

const LISTAS = [2, 3, 8, 9, 18, 40];
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

describe("Carrera de autos: el plan", () => {
  it("la misma ronda cuenta lo mismo: el plan es una función de la lista y la semilla", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = planAutos(contexto(n, ganadoresDe(n)));
        return JSON.stringify({ d: p.duracion, a: p.arco, x: p.datos, g: p.guion.map((l) => [l.t, l.texto, l.prioridad, l.hecho]), r: p.respuestas(p.duracion / 2) });
      };
      expect(resumir()).toBe(resumir());
    }
  });

  it("otras semillas cuentan otras historias", () => {
    const arcos = new Set(Array.from({ length: 24 }, (_, s) => planAutos(contexto(18, [3], s + 1)).arco));
    expect(arcos.size).toBeGreaterThan(1);
  });

  it("el juego no decide nada: quien gana nunca cae, todos los demás caen una sola vez y la rival cae última", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const { datos: d } = planAutos(contexto(n, gs));
        expect(d.ganador).toBe(gs[0]);
        const caidos = d.olas.flatMap((o) => o.victimas);
        expect(caidos).not.toContain(d.ganador);
        expect([...caidos].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i).filter((i) => i !== d.ganador));
        expect(salidaDe(d, d.ganador)).toBeNull();
        const ultima = d.olas.at(-1);
        expect(ultima?.victimas.at(-1)).toBe(d.rival);
        expect(d.rival).not.toBe(d.ganador);
      }
    }
  });

  it("los hoyos nunca son para quien gana; la roca del susto roza a quien gana, que sigue en carrera", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 6; s++) {
        const { datos: d } = planAutos(contexto(n, ganadoresDe(n), s));
        for (const o of d.olas.filter((o) => o.tipo === "hoyo")) expect(o.victimas).not.toContain(d.ganador);
        expect(d.susto.rozados).toContain(d.ganador);
        // A quien la roca roza, no lo aplasta: todos los rozados siguen vivos después del susto.
        const despues = vivos(d, d.susto.t + 0.5);
        for (const i of d.susto.rozados) expect(despues).toContain(i);
        expect(d.olas.some((o) => Math.abs(o.t - d.susto.t) < 1)).toBe(false);
        if (d.olas.length >= 2) expect(new Set(d.olas.map((o) => o.tipo)).size).toBe(2);
      }
    }
  });

  it("las olas van en orden, a más de un segundo, después de la largada y antes de la meta", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAutos(contexto(n, ganadoresDe(n)));
      expect(d.olas.length).toBeGreaterThanOrEqual(1);
      expect(d.olas.length).toBeLessThanOrEqual(8);
      expect(d.olas[0]?.t).toBeGreaterThanOrEqual(d.tLargada + 2);
      expect(d.olas.at(-1)?.t).toBeLessThanOrEqual(duracion - 2);
      for (let i = 1; i < d.olas.length; i++) expect((d.olas[i]?.t ?? 0) - (d.olas[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(1);
      for (const o of d.olas) expect(o.victimas.length).toBeGreaterThan(0);
    }
  });

  it("dura lo que un show: ni un parpadeo ni una eternidad", () => {
    for (const n of LISTAS) {
      const { duracion } = planAutos(contexto(n, ganadoresDe(n)));
      expect(duracion).toBeGreaterThanOrEqual(10);
      expect(duracion).toBeLessThanOrEqual(40);
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) expect(problemasDeMomentos(planAutos(contexto(n, ganadoresDe(n)))), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: seis palabras, un nombre, sin números", () => {
    for (const n of LISTAS) {
      const c = contexto(n, ganadoresDe(n));
      const p = planAutos(c);
      const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
      expect(r.problemas, `con ${n}`).toEqual([]);
      expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
    }
  });

  it("la tensión mira a quien gana y a la rival (o su hoyo), nunca a quien gana solo", () => {
    for (const n of LISTAS) {
      const p = planAutos(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        for (const t of [p.momentos.tension.desde, p.duracion]) {
          const plano = p.momentos.tension.toma(kitFalso(pant), t) as { caja: { x: number; w: number; h: number } };
          expect(plano.caja.w).toBeGreaterThan(0);
          expect(plano.caja.h).toBeGreaterThan(0);
          const g = posicionDe(pant, p.datos, p.datos.ganador, t);
          const r = posicionDe(pant, p.datos, p.datos.rival, t);
          expect(plano.caja.x).toBeLessThanOrEqual(Math.min(g.x, r.x));
          expect(plano.caja.x + plano.caja.w).toBeGreaterThanOrEqual(Math.max(g.x, r.x));
        }
      }
    }
  });

  it("el foco cae dentro de la pantalla, sobre quien gana", () => {
    for (const n of LISTAS) {
      const p = planAutos(contexto(n, ganadoresDe(n)));
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

describe("Carrera de autos: la pista", () => {
  it("quien gana cruza la meta justo con el golpe; nadie retrocede; quien cae se queda donde cayó", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAutos(contexto(n, ganadoresDe(n)));
      expect(avanceDe(d, d.ganador, d.tLargada)).toBe(0);
      expect(avanceDe(d, d.ganador, duracion)).toBeCloseTo(1, 6);
      expect(avanceDe(d, d.ganador, duracion + 3)).toBeCloseTo(1, 6);
      for (let i = 0; i < n; i++) {
        let previo = -1;
        for (let t = 0; t <= duracion + 3; t += 0.1) {
          const a = avanceDe(d, i, t);
          expect(a, `persona ${i} a los ${t.toFixed(1)} s`).toBeGreaterThanOrEqual(previo - 1e-9);
          expect(a).toBeLessThanOrEqual(1);
          previo = a;
        }
        const s = salidaDe(d, i);
        if (s !== null) {
          expect(avanceDe(d, i, s + 2)).toBeCloseTo(avanceDe(d, i, s), 9);
          expect(avanceDe(d, i, s)).toBeLessThan(1);
        }
      }
    }
  });

  it("los autos corren por carriles dentro de la franja libre, de izquierda a derecha, en todas las pantallas", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAutos(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        for (let i = 0; i < n; i++) {
          const a = posicionDe(pant, d, i, d.tLargada);
          const b = posicionDe(pant, d, i, duracion);
          expect(a.y).toBeGreaterThanOrEqual(pant.top);
          expect(a.y).toBeLessThanOrEqual(pant.bottom);
          expect(b.y).toBe(a.y);
          expect(b.x).toBeGreaterThanOrEqual(a.x);
        }
        // Dos autos del mismo carril nunca largan en el mismo lugar.
        const largada = Array.from({ length: n }, (_, i) => posicionDe(pant, d, i, d.tLargada + 2.5));
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (Math.abs((largada[i]?.y ?? 0) - (largada[j]?.y ?? 0)) < 1) {
              expect(Math.abs((largada[i]?.x ?? 0) - (largada[j]?.x ?? 0)), `${i} y ${j} con ${n}`).toBeGreaterThan(50 * pant.k);
            }
          }
        }
      }
    }
  });

  it("los que siguen son los que no cayeron, y al final queda quien gana", () => {
    for (const n of LISTAS) {
      const { datos: d, duracion } = planAutos(contexto(n, ganadoresDe(n)));
      expect(vivos(d, 0)).toHaveLength(n);
      expect(vivos(d, duracion)).toEqual([d.ganador]);
      for (const o of d.olas) {
        const antes = vivos(d, o.t - 0.01);
        const despues = vivos(d, o.t);
        for (const v of o.victimas) {
          expect(antes).toContain(v);
          expect(despues).not.toContain(v);
        }
        expect(antes.length - despues.length).toBe(o.victimas.length);
      }
    }
  });
});

describe("Carrera de autos: la regla del niño", () => {
  it("un solo sentido de avance: hacia la derecha", () => {
    for (const n of LISTAS) {
      const p = planAutos(contexto(n, ganadoresDe(n)));
      expect(DIRECCIONES).toContain(p.sentido);
      expect(p.sentido).toBe("derecha");
    }
  });

  it("el marcador es el único contador: arranca en todos, baja con cada ola y con el golpe queda en 1", () => {
    for (const n of LISTAS) {
      const p = planAutos(contexto(n, ganadoresDe(n)));
      const pasoMax = Math.max(...p.datos.olas.map((o) => o.victimas.length));
      expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax }), `con ${n}`).toEqual([]);
      if (n <= 9) expect(pasoMax).toBe(1);
    }
  });

  it("las respuestas dicen quién va adelante, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const p = planAutos(contexto(n, gs));
        expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n}`).toEqual([]);
        const r = p.respuestas(p.datos.susto.t + 0.3);
        expect(r.paso).toMatchObject({ tipo: "casi", quien: p.datos.ganador });
      }
    }
  });

  it("la cinta del camino (la meta) cae dentro de la pantalla en todas las pantallas", () => {
    for (const n of LISTAS) {
      const p = planAutos(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        for (const t of [0, p.duracion / 2, p.duracion]) {
          const m = p.momentos.meta?.(kitFalso(pant), t);
          expect(m, `con ${n}`).toBeTruthy();
          if (m) {
            expect(m.w).toBeLessThanOrEqual(pant.w + 1);
            expect(m.h).toBeLessThanOrEqual(pant.bottom - pant.top + 1);
          }
        }
      }
    }
  });
});

describe("Carrera de autos: los textos", () => {
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
      const p = planAutos(c);
      expect(validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres }).problemas, idioma).toEqual([]);
    }
  });
});
