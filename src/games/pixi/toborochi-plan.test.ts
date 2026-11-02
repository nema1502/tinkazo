import { describe, expect, it } from "vitest";
import { writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { problemasDeMomentos } from "./kit/director";
import { validarGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { DIRECCIONES, problemasDeRespuestas } from "./kit/respuestas";
import type { Contexto, Kit } from "./kit/tipos";
import type { Pant } from "./toborochi-arbol";
import {
  OLA_EXTRA_MAX, enElArbolEn, enElSueloEn, faseDe, frenteEn, nubladoEn, olasPara, planToborochi, repartir, tPosa, vientoEn,
  type Datos,
} from "./toborochi-plan";
import { TEXTOS } from "./toborochi-textos";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";
const rondaDe = (semilla: number): string => (semilla >>> 0).toString(16).padStart(8, "0") + RONDA.slice(8);

/** El contexto que arma el kit, con un azar sembrado y los textos del juego. */
function contexto(n: number, ganadores: number[], semilla = 7, idioma: "es" | "en" = "es"): Contexto {
  const rng = sembrar(semilla);
  const ronda = rondaDe(semilla * 2654435761);
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${i + 1}`),
    ganadores,
    ronda,
    rng,
    idioma,
    txt: (clave, ...args) => {
      const v = (TEXTOS[idioma] as Record<string, string | ((...a: unknown[]) => string)>)[clave];
      return typeof v === "function" ? v(...args) : (v ?? clave);
    },
    azar: (etiqueta) => azarDe(ronda, etiqueta),
    historia: (actores, ganador) => writeStory(rng, actores, ganador),
  };
}

const LISTAS = [2, 3, 4, 8, 9, 18, 30, 60, 65, 200];
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

const plan = (n: number, gs = ganadoresDe(n), semilla = 7): ReturnType<typeof planToborochi> => planToborochi(contexto(n, gs, semilla));

describe("El Toborochi: el plan", () => {
  it("la misma ronda cuenta lo mismo: el plan es una función de la lista y la semilla", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = plan(n);
        return JSON.stringify({ d: p.duracion, a: p.arco, x: p.datos, g: p.guion.map((l) => [l.t, typeof l.texto === "function" ? l.texto() : l.texto, l.prioridad, l.hecho]), r: p.respuestas(p.duracion / 2) });
      };
      expect(resumir()).toBe(resumir());
    }
  });

  it("otras semillas cuentan otras historias", () => {
    const arcos = new Set(Array.from({ length: 24 }, (_, s) => plan(18, [3], s + 1).arco));
    expect(arcos.size).toBeGreaterThan(1);
  });

  it("el juego no decide nada: quien gana es el que llegó dado, y es una de las dos últimas", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)], [1, 0, Math.min(n - 1, 2)]]) {
        const { datos } = plan(n, gs.filter((x) => x < n));
        expect(datos.ganador).toBe(gs[0]);
        expect(datos.rival).not.toBe(datos.ganador);
        expect(datos.rival).toBeGreaterThanOrEqual(0);
        expect(datos.rival).toBeLessThan(n);
        // Con varios premios, la rival es la segunda.
        if (gs.length >= 2 && gs[1] !== undefined && gs[1] < n) expect(datos.rival).toBe(gs[1]);
      }
    }
  });

  it("al final solo quedan las dos: todas las demás se fueron, y las dos no cayeron nunca", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)], [0, 1, 2].filter((x) => x < n)]) {
        const p = plan(n, gs);
        const d = p.datos;
        const quedan = enElArbolEn(d, p.duracion);
        expect(quedan.sort((a, b) => a - b), `con ${n}`).toEqual([d.ganador, d.rival].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b));
        expect(d.tCae[d.ganador]).toBe(Infinity);
        expect(d.tCae[d.rival]).toBe(Infinity);
      }
    }
  });

  it("los premios de más se van con premio, en una calma y nunca en una ráfaga", () => {
    const p = plan(18, [3, 7, 10, 12]);
    const d = p.datos;
    expect(d.premios.sort((a, b) => a - b)).toEqual([10, 12]);
    for (const q of d.premios) {
      expect(d.causa[q]).toBe("premio");
      const enCalma = d.calmas.some((c) => d.tCae[q]! >= c.t0 && d.tCae[q]! < c.t1);
      expect(enCalma, `el premio ${q}`).toBe(true);
    }
    // Las ráfagas no se llevan a quienes ganan.
    for (const o of d.olas) for (const q of [...d.premios, d.ganador, d.rival]) expect(o.cae).not.toContain(q);
  });

  it("cuántas se lleva cada ráfaga: con 18, 8, 5 y 3", () => {
    expect(repartir(16, 3)).toEqual([8, 5, 3]);
    const p = plan(18);
    expect(p.datos.olas.filter((o) => p.arco !== "duelo" || true).map((o) => o.cae.length).reduce((a, b) => a + b, 0)).toBe(16);
    if (p.arco !== "duelo") expect(p.datos.olas.map((o) => o.cae.length)).toEqual([8, 5, 3]);
    for (const [n, olas] of [[2, 1], [7, 2], [8, 3], [18, 3], [19, 4], [42, 4], [43, 5], [102, 5], [103, 6], [200, 6]] as const) expect(olasPara(n)).toBe(olas);
    for (const f of [0, 1, 2, 5, 16, 60, 198]) for (const o of [1, 2, 3, 6]) expect(repartir(f, o).reduce((a, b) => a + b, 0)).toBe(f);
    // Con menos flores que ráfagas, una de práctica.
    expect(repartir(1, 2)).toEqual([0, 1]);
    expect(repartir(0, 1)).toEqual([0]);
  });

  it("con 2 es una ráfaga de práctica: nadie se cae", () => {
    const p = plan(2);
    expect(p.datos.olas).toHaveLength(1);
    expect(p.datos.olas[0]!.practica).toBe(true);
    expect(p.datos.olas[0]!.cae).toEqual([]);
  });

  it("el viento empuja al grupo, nunca a una: el instante de cada caída cae dentro de su ráfaga y el frente cruza de izquierda a derecha", () => {
    for (const n of LISTAS) {
      const p = plan(n);
      const d = p.datos;
      for (const o of d.olas) {
        for (const q of o.cae) {
          const t = d.tCae[q]!;
          expect(t, `con ${n}`).toBeGreaterThanOrEqual(o.t0 + 0.85);
          expect(t).toBeLessThan(o.t1);
          expect(d.causa[q]).toBe("viento");
        }
        // Las que están a la izquierda se sueltan antes que las de la derecha.
        // (en la última ráfaga, quien vive el giro del arco se suelta después de su momento)
        for (let m = 1; m < (o.ultima ? 0 : o.cae.length); m++) {
          const a = d.lugar[o.cae[m - 1]!]!.u;
          const b = d.lugar[o.cae[m]!]!.u;
          // El orden de las caídas sigue al frente, salvo un temblor chico.
          expect(b - a, `con ${n}`).toBeGreaterThan(-0.2);
        }
        // La ola mueve la copa entera: la misma fuerza para todas.
        const mitad = (o.t0 + o.t1) / 2;
        expect(vientoEn(d, mitad)).toBeGreaterThan(0);
      }
      expect(vientoEn(d, d.tQuedan0 + 0.1)).toBe(0);
      expect(frenteEn(d, d.tQuedan0 + 0.1)).toBe(-1);
    }
  });

  it("ninguna rama se vacía antes de la última ráfaga, y las ramas son las que dice el árbol", () => {
    for (const n of LISTAS.filter((x) => x >= 4)) {
      for (const semilla of [1, 2, 3, 4, 5, 6]) {
        const p = plan(n, [semilla % n], semilla);
        const d = p.datos;
        const ultima = d.olas[d.olas.length - 1]!;
        // Justo antes de la primera caída de la última ráfaga, cada rama sigue teniendo flores.
        const primera = Math.min(...ultima.cae.map((q) => d.tCae[q]!), ultima.t1);
        const enRama = new Array<number>(d.dis.ramas).fill(0);
        for (const i of enElArbolEn(d, primera - 0.001)) enRama[d.lugar[i]!.rama] = enRama[d.lugar[i]!.rama]! + 1;
        expect(Math.min(...enRama), `con ${n} y semilla ${semilla}`).toBeGreaterThan(0);
      }
    }
  });

  it("tiemblan fuerte entre tres y cinco, sorteadas entre todas las que siguen (también las que no caen)", () => {
    let cuales = 0;
    let finalistas = 0;
    for (let s = 1; s <= 40; s++) {
      const d = plan(30, [4], s).datos;
      for (const o of d.olas) {
        expect(o.tiembla.length).toBeGreaterThanOrEqual(3);
        expect(o.tiembla.length).toBeLessThanOrEqual(5);
        expect(new Set(o.tiembla).size).toBe(o.tiembla.length);
        // Ninguna ya había caído.
        for (const q of o.tiembla) expect(d.tCae[q]!).toBeGreaterThan(o.t0 - 1e-9);
        cuales += o.tiembla.length;
        finalistas += o.tiembla.filter((q) => q === d.ganador || q === d.rival).length;
      }
    }
    // Una de cada quince es una finalista cuando son 2 de 30: entre las que tiemblan, hay finalistas y no son todas.
    expect(finalistas).toBeGreaterThan(0);
    expect(finalistas / cuales).toBeLessThan(0.25);
  });

  it("la primera visitada por el colibrí gana la mitad de las veces, y la última siempre es la ganadora", () => {
    let primera = 0;
    const veces = 400;
    for (let s = 1; s <= veces; s++) {
      const d = plan(18, [s % 18], s).datos;
      expect(d.visitas.length).toBeGreaterThanOrEqual(2);
      expect(d.visitas.length).toBeLessThanOrEqual(4);
      expect(d.visitas[d.visitas.length - 1]!.quien).toBe(d.ganador);
      // Visita a las dos, alternando.
      expect(new Set(d.visitas.map((v) => v.quien)).size).toBe(2);
      d.visitas.forEach((v, m) => m > 0 && expect(v.quien).not.toBe(d.visitas[m - 1]!.quien));
      if (d.visitas[0]!.quien === d.ganador) primera++;
    }
    expect(primera / veces).toBeGreaterThan(0.4);
    expect(primera / veces).toBeLessThan(0.6);
  });

  it("el colibrí dura de 3,5 a 7 s, y el zumbido calla antes de posarse", () => {
    for (let s = 1; s <= 60; s++) {
      const d = plan(18, [s % 18], s).datos;
      const dur = d.tPico - d.tColibri0;
      expect(dur).toBeGreaterThanOrEqual(3.5);
      expect(dur).toBeLessThanOrEqual(7);
      expect(d.tPico - d.tCalla).toBeGreaterThanOrEqual(0.4 - 1e-9);
    }
  });

  it("los giros del arco les pasan a flores sorteadas entre todas las que siguen, no a las finalistas por ser finalistas", () => {
    let conGiro = 0;
    let finalistas = 0;
    let esperadas = 0;
    for (let s = 1; s <= 600; s++) {
      const d = plan(18, [s % 18], s).datos;
      const ultima = d.olas[d.olas.length - 1]!;
      const siguen = new Set([...ultima.cae, d.ganador, d.rival]);
      const quien = d.arco === "susto" ? d.hilos[0]?.quien : d.arco === "remontada" ? d.engancha?.quien : undefined;
      if (d.arco === "susto" || d.arco === "remontada") {
        expect(quien).toBeDefined();
        expect(siguen.has(quien!)).toBe(true);
        conGiro++;
        if (quien === d.ganador || quien === d.rival) finalistas++;
        esperadas += 2 / siguen.size;
        // Si cae, cae después de su giro y dentro de la ráfaga.
        if (d.tCae[quien!]! < Infinity) {
          const fin = d.arco === "susto" ? d.hilos[0]!.t1 : d.engancha!.t + 0.5;
          expect(d.tCae[quien!]!).toBeGreaterThan(fin);
          expect(d.tCae[quien!]!).toBeLessThan(ultima.t1);
        }
      }
      // El duelo trae una ráfaga más; la tapada deja a las dos sin nombre.
      if (d.arco === "duelo") expect(d.olas.length).toBe(olasPara(18) + 1);
      expect(d.sinNombres).toBe(d.arco === "tapada");
    }
    expect(conGiro).toBeGreaterThan(60);
    // Las finalistas viven el giro tanto como cualquiera de las que siguen: ni más ni menos que lo que da el azar.
    expect(finalistas / esperadas).toBeGreaterThan(0.75);
    expect(finalistas / esperadas).toBeLessThan(1.25);
  });

  it("dura lo que un show: ni un parpadeo ni una eternidad", () => {
    for (const n of LISTAS) {
      const { duracion } = plan(n);
      expect(duracion, `con ${n}`).toBeGreaterThanOrEqual(10);
      expect(duracion, `con ${n}`).toBeLessThanOrEqual(46);
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) for (const s of [1, 2, 3]) expect(problemasDeMomentos(plan(n, ganadoresDe(n), s)), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: seis palabras, un nombre, sin números", () => {
    for (const n of LISTAS) {
      for (const s of [1, 2, 3, 4]) {
        const c = contexto(n, ganadoresDe(n), s);
        const p = planToborochi(c);
        const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
        expect(r.problemas, `con ${n}`).toEqual([]);
        expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("también en inglés", () => {
    for (const n of [2, 8, 18, 60]) {
      const c = contexto(n, ganadoresDe(n), 5, "en");
      const p = planToborochi(c);
      const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
      expect(r.problemas, `con ${n}`).toEqual([]);
    }
  });

  it("la tensión mira a las dos finalistas, nunca a una sola", () => {
    for (const n of LISTAS.filter((x) => x >= 2)) {
      const p = plan(n);
      for (const pant of PANTALLAS) {
        const plano = p.momentos.tension.toma(kitFalso(pant), p.momentos.tension.desde) as { caja: { x: number; y: number; w: number; h: number } };
        expect(plano.caja.w).toBeGreaterThan(0);
        expect(plano.caja.h).toBeGreaterThan(0);
      }
    }
  });

  it("el foco cae dentro de la pantalla, sobre quien gana", () => {
    for (const n of LISTAS) {
      const p = plan(n);
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

describe("El Toborochi: la regla del niño", () => {
  it("un solo sentido de avance, y es uno de los que existen", () => {
    for (const n of LISTAS) expect(DIRECCIONES).toContain(plan(n).sentido);
  });

  it("el marcador es el único contador: arranca en todos, solo baja y con el golpe queda en 1", () => {
    for (const n of LISTAS) {
      for (const s of [1, 2, 3]) {
        const p = plan(n, ganadoresDe(n), s);
        // Una ráfaga suelta varias a la vez: el contador baja de a una por flor que se desprende, pero en un mismo cuadro pueden ser varias.
        expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax: n }), `con ${n}`).toEqual([]);
      }
    }
  });

  it("las respuestas dicen quién va adelante, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)], [0, 1, 2].filter((x) => x < n)]) {
        for (const s of [1, 2, 3, 4, 5, 6]) {
          const p = plan(n, gs, s);
          expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n} y semilla ${s}`).toEqual([]);
        }
      }
    }
  });
});

describe("El Toborochi: lo que le pregunta la escena", () => {
  const d = (n = 18): Datos => plan(n, [3], 3).datos;

  it("la fase avanza en orden: florece, tandas, ráfagas con calmas, quedan dos y el colibrí", () => {
    const x = d();
    const orden: string[] = [];
    for (let t = 0; t <= x.tPico; t += 0.05) {
      const f = faseDe(x, t).fase;
      if (orden.at(-1) !== f) orden.push(f);
    }
    expect(orden[0]).toBe("florece");
    expect(orden[1]).toBe("tandas");
    expect(orden.at(-2)).toBe("quedan");
    expect(orden.at(-1)).toBe("colibri");
    expect(orden.filter((f) => f === "ola")).toHaveLength(x.olas.length);
    expect(orden.filter((f) => f === "calma")).toHaveLength(x.calmas.length);
  });

  it("sin tandas con más de 64 personas, y con 64 o menos de a ocho", () => {
    expect(d(65).tTandas).toBeNull();
    expect(d(60).tTandas).not.toBeNull();
    const t = d(30).tTandas!;
    expect(t[1] - t[0]).toBeCloseTo(4 * 1.5, 6);
  });

  it("el cielo se nubla de a poco, nunca de golpe, y se aclara al quedar dos", () => {
    const x = d();
    let previo = nubladoEn(x, 0);
    for (let t = 0; t <= x.tPico; t += 0.02) {
      const v = nubladoEn(x, t);
      expect(Math.abs(v - previo), `a los ${t.toFixed(2)} s`).toBeLessThan(0.05);
      expect(v).toBeLessThanOrEqual(0.5 + 1e-9);
      previo = v;
    }
    expect(nubladoEn(x, x.tPico)).toBe(0);
  });

  it("cada flor que se fue llega al suelo después de caer, y la alfombra las guarda en orden", () => {
    const x = d();
    const suelo = enElSueloEn(x, x.tPico + 5);
    expect(suelo).toHaveLength(x.n - 2);
    for (let m = 1; m < suelo.length; m++) expect(tPosa(x, suelo[m]!)).toBeGreaterThanOrEqual(tPosa(x, suelo[m - 1]!));
    for (const q of suelo) expect(tPosa(x, q)).toBeGreaterThan(x.tCae[q]!);
  });

  it("la ráfaga más larga no pasa de lo que dice el tope", () => {
    const x = d(200);
    for (const o of x.olas) expect(o.t1 - o.t0).toBeLessThanOrEqual(2.8 + OLA_EXTRA_MAX + 1e-9);
  });
});

describe("El Toborochi: los textos", () => {
  it("están en español y en inglés, con las mismas claves y del mismo tipo", () => {
    const es = Object.keys(TEXTOS.es).sort();
    expect(Object.keys(TEXTOS.en).sort()).toEqual(es);
    for (const clave of es) {
      const a = (TEXTOS.es as Record<string, unknown>)[clave];
      const b = (TEXTOS.en as Record<string, unknown>)[clave];
      expect(typeof a, clave).toBe(typeof b);
    }
  });

  it("en pantalla es «surazo» y en inglés «the south wind»; nunca eliminado, perdió, suerte ni Araverá", () => {
    const todo = (o: Record<string, unknown>): string[] => Object.values(o).map((v) => (typeof v === "function" ? (v as (n: string) => string)("Ana") : String(v)));
    const es = todo(TEXTOS.es).join(" ");
    const en = todo(TEXTOS.en).join(" ");
    expect(es).toMatch(/surazo/);
    expect(en).toMatch(/south wind/i);
    for (const mala of [/eliminad/i, /perdi/i, /suerte/i, /arav/i, /apuest/i, /rifa/i]) expect(es).not.toMatch(mala);
    for (const mala of [/eliminat/i, /lost/i, /luck/i, /arav/i, /bet/i, /raffle/i]) expect(en).not.toMatch(mala);
  });
});
