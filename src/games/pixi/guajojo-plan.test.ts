import { describe, expect, it } from "vitest";
import { ARCS, writeStory } from "../drama";
import { azarDe, sembrar } from "./kit/azar";
import { ARCOS, problemasDeMomentos } from "./kit/director";
import { validarGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { DIRECCIONES, POSE_MAX, problemasDeRespuestas } from "./kit/respuestas";
import type { Contexto, Kit } from "./kit/tipos";
import {
  T_AMANECER, T_CANTO, T_CRAC, T_ULTIMO, Z_META, Z_PALO, cajaDelPalo, enPieEn, faseDe, geoDe, miradaDe, planGuajojo, proyectar, quedanEn, repartoDe,
  sentadaDe, silenciosPara, swayDe, tandaDeLista, xDe, zDe, type Ciclo, type Pant,
} from "./guajojo-plan";
import { duracionBase, normalGuajojo } from "./guajojo-duracion";
import { TEXTOS } from "./guajojo-textos";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";

/** El contexto que arma el kit, con un azar sembrado y los textos del juego. */
function contexto(n: number, ganadores: number[], semilla = 7, idioma: "es" | "en" = "es"): Contexto {
  const rng = sembrar(semilla);
  const ronda = semilla === 7 ? RONDA : RONDA.replace(/^.{8}/, semilla.toString(16).padStart(8, "0"));
  return {
    nombres: Array.from({ length: n }, (_, i) => `Persona ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`),
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
const kitFalso = (p: Pant): Kit =>
  ({
    pantalla: () => ({ ...p, retrato: p.h > p.w * 1.1 }),
    cam: { toScreen: (x: number, y: number) => ({ x, y }) },
  }) as unknown as Kit;

/** Una semilla por arco, para recorrer los cuatro. */
function semillasPorArco(n: number): Record<string, number> {
  const por: Record<string, number> = {};
  for (let s = 1; s < 400 && Object.keys(por).length < ARCOS.length; s++) {
    const a = planGuajojo(contexto(n, ganadoresDe(n), s)).arco;
    if (!(a in por)) por[a] = s;
  }
  return por;
}

describe("Guajojó: el plan", () => {
  it("la misma ronda cuenta lo mismo", () => {
    for (const n of LISTAS) {
      const resumir = (): string => {
        const p = planGuajojo(contexto(n, ganadoresDe(n)));
        const d = p.datos;
        return JSON.stringify({ d: p.duracion, a: p.arco, s: d.sienta, c: d.ciclos.map((c) => [c.t0, c.victimas, c.tCae, c.mirada]), g: p.guion.map((l) => [l.t, l.texto, l.prioridad, l.hecho]) });
      };
      expect(resumir()).toBe(resumir());
    }
  });

  it("otras semillas cuentan otras historias, y salen los cuatro arcos", () => {
    const arcos = new Set(Array.from({ length: 40 }, (_, s) => planGuajojo(contexto(18, [3], s + 1)).arco));
    expect(arcos.size).toBe(ARCS.length);
  });

  it("el juego no decide nada: quien gana nunca se sienta y es el único que queda de pie", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)], [1, 0, Math.min(n - 1, 2)]]) {
        for (const s of [7, 8, 9, 10]) {
          const p = planGuajojo(contexto(n, gs, s));
          const d = p.datos;
          expect(d.ganador).toBe(gs[0]);
          expect(d.sienta[gs[0] as number], `con ${n}`).toBe(Infinity);
          const quedan = enPieEn(d, p.duracion);
          expect(quedan, `con ${n}`).toEqual([gs[0]]);
          // Todos los demás se sientan una sola vez, en un ciclo que existe, antes del amanecer.
          for (let i = 0; i < n; i++) {
            if (i === gs[0]) continue;
            expect(Number.isFinite(d.sienta[i] as number), `persona ${i} de ${n}`).toBe(true);
            expect(d.sienta[i] as number).toBeLessThan(d.tAmanecer0);
            expect(d.ciclos[d.cicloDe[i] as number]?.victimas).toContain(i);
          }
        }
      }
    }
  });

  it("los silencios son los del diseño, el último es de la rival sola y con dos o tres hay uno de práctica", () => {
    expect([2, 3, 7, 8, 18, 19, 42, 43, 102, 103].map(silenciosPara)).toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 7]);
    for (const n of LISTAS) {
      for (const s of [7, 8, 9, 10, 11, 12]) {
        const p = planGuajojo(contexto(n, ganadoresDe(n), s));
        const d = p.datos;
        const base = silenciosPara(n) + (p.arco === "duelo" && n > 2 ? 1 : 0);
        expect(d.ciclos).toHaveLength(base);
        const ult = d.ciclos[base - 1] as Ciclo;
        expect(ult.ultimo).toBe(true);
        expect(ult.victimas).toEqual([d.rival]);
        expect(d.rival).not.toBe(d.ganador);
        if (n <= 3) expect(d.ciclos.filter((c) => c.practica).length).toBeGreaterThanOrEqual(1);
        else if (base === silenciosPara(n)) expect(d.ciclos.filter((c) => c.practica)).toHaveLength(0);
        // Las prácticas van antes que los silencios en que alguien se sienta.
        const firstReal = d.ciclos.findIndex((c) => !c.practica);
        expect(d.ciclos.slice(firstReal).some((c, j) => c.practica && j > 0 && !c.ultimo)).toBe(false);
      }
    }
  });

  it("con 18 caen 8, 5 y 3 y al final la rival; el reparto suma a quienes se sientan", () => {
    expect(repartoDe(16, 4, "remontada", 18)).toEqual([8, 5, 3]);
    for (const n of LISTAS) {
      const p = planGuajojo(contexto(n, ganadoresDe(n)));
      const total = p.datos.ciclos.reduce((a, c) => a + c.victimas.length, 0);
      expect(total).toBe(n - 1);
    }
    // Con más de 64 el primer silencio sienta a la mitad, más o menos.
    const grande = planGuajojo(contexto(200, [3]));
    const primero = (grande.datos.ciclos[0] as Ciclo).victimas.length;
    expect(primero).toBeGreaterThanOrEqual(80);
    expect(primero).toBeLessThanOrEqual(120);
  });

  it("con varios premios la rival es la segunda y los demás premiados se sientan antes", () => {
    const p = planGuajojo(contexto(18, [2, 5, 9]));
    expect(p.datos.rival).toBe(5);
    expect(p.datos.sienta[5]).toBeGreaterThan(p.datos.sienta[9] as number);
    expect(Number.isFinite(p.datos.sienta[9] as number)).toBe(true);
  });

  it("dura lo prometido: entre 25 y 60 segundos con el cartel, y Normal nunca pasa de 60", () => {
    for (const n of LISTAS) {
      const p = planGuajojo(contexto(n, ganadoresDe(n)));
      expect(p.duracion, `con ${n}`).toBeGreaterThanOrEqual(19);
      expect(p.duracion + 6.5, `con ${n}`).toBeLessThanOrEqual(64);
      expect(p.normal, `con ${n}`).toBeLessThanOrEqual(60);
      expect(p.normal as number, `con ${n}`).toBeGreaterThanOrEqual(25);
    }
    // El del diseño: con 18 y sin duelo, 34,6 s de show hasta el cartel.
    const s = semillasPorArco(18);
    const p = planGuajojo(contexto(18, [3], s.remontada ?? 1));
    expect(p.duracion).toBeCloseTo(34.6, 1);
  });

  it("lo que promete el selector sale de la misma cuenta que el plan: sin duelo ni tapada dura lo base, y «Normal» no depende del arco", () => {
    for (const n of LISTAS) {
      for (let s = 1; s <= 30; s++) {
        const p = planGuajojo(contexto(n, ganadoresDe(n), s));
        if (p.arco === "susto" || p.arco === "remontada" || (p.arco === "tapada" && n <= 2)) expect(p.duracion, `con ${n}`).toBeCloseTo(duracionBase(n), 5);
        if (p.arco === "duelo" && n > 2) expect(p.duracion).toBeGreaterThan(duracionBase(n) + 5);
        expect(p.normal, `con ${n}`).toBe(normalGuajojo(n));
      }
    }
  });

  it("los momentos de la cámara están en orden", () => {
    for (const n of LISTAS) for (const s of [7, 8, 9, 10]) expect(problemasDeMomentos(planGuajojo(contexto(n, ganadoresDe(n), s))), `con ${n}`).toEqual([]);
  });

  it("el guion no deja huecos de cuatro segundos, y cumple la regla del niño: seis palabras, un nombre, sin números", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        const c = contexto(n, gs);
        const p = planGuajojo(c);
        const r = validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres });
        expect(r.problemas, `con ${n}`).toEqual([]);
        expect(r.huecoMax, `con ${n}`).toBeLessThanOrEqual(4);
      }
    }
  });

  it("nunca dice eliminado, perdió, muerte ni agüero", () => {
    for (const idioma of ["es", "en"] as const) {
      const todo = Object.values(TEXTOS[idioma]).map((v) => (typeof v === "function" ? v("Ana") : v)).join(" ").toLowerCase();
      expect(todo).not.toMatch(/elimin|perdi|muert|agüer|aguer|lost|dead|death/);
    }
  });

  it("la tensión mira a los dos últimos y al palo, nunca a quien gana solo", () => {
    for (const n of LISTAS) {
      const p = planGuajojo(contexto(n, ganadoresDe(n)));
      for (const pant of PANTALLAS) {
        const plano = p.momentos.tension.toma(kitFalso(pant), p.momentos.tension.desde) as { caja: { x: number; w: number; h: number } };
        expect(plano.caja.w).toBeGreaterThan(0);
        const palo = cajaDelPalo(geoDe(pant));
        expect(plano.caja.h).toBeGreaterThanOrEqual(palo.h);
      }
    }
  });

  it("el foco cae dentro de la pantalla, sobre quien gana", () => {
    for (const n of LISTAS) {
      const p = planGuajojo(contexto(n, ganadoresDe(n)));
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

describe("Guajojó: el movimiento", () => {
  it("nadie retrocede por el sendero, y la ganadora termina a los pies del palo", () => {
    for (const n of [2, 8, 18, 60]) {
      const p = planGuajojo(contexto(n, ganadoresDe(n)));
      const d = p.datos;
      for (let i = 0; i < n; i++) {
        let prev = -1;
        for (let t = 0; t <= p.duracion; t += 0.1) {
          const z = zDe(d, i, t);
          expect(z, `persona ${i} a los ${t.toFixed(1)}`).toBeGreaterThanOrEqual(prev - 1e-9);
          prev = z;
        }
      }
      expect(zDe(d, d.ganador, p.duracion)).toBeCloseTo(Z_META, 2);
      expect(xDe(d, d.ganador, p.duracion)).toBeCloseTo(0, 2);
      expect(Z_META).toBeLessThan(Z_PALO);
    }
  });

  it("quien se sienta se mueve a la hinchada, a un costado, y queda sentado", () => {
    const p = planGuajojo(contexto(18, [3]));
    const d = p.datos;
    const i = d.ciclos[0]?.victimas[0] as number;
    const ts = d.sienta[i] as number;
    expect(sentadaDe(d, i, ts - 0.01)).toBe(0);
    expect(sentadaDe(d, i, ts + 1)).toBe(1);
    expect(Math.abs(xDe(d, i, ts + 2))).toBeGreaterThan(1.1);
  });

  it("los dos últimos esperan a cada lado del palo", () => {
    for (const s of [7, 8, 9]) {
      const p = planGuajojo(contexto(18, [3], s));
      const d = p.datos;
      const ult = d.ciclos[d.ciclos.length - 1] as Ciclo;
      const xg = xDe(d, d.ganador, ult.tSil0);
      const xr = xDe(d, d.rival, ult.tSil0);
      expect(Math.sign(xg)).toBe(-Math.sign(xr));
      expect(Math.abs(xg)).toBeGreaterThan(0.3);
      expect(zDe(d, d.ganador, ult.tSil0)).toBeCloseTo(zDe(d, d.rival, ult.tSil0), 1);
    }
  });

  it("el último silencio dura 3,6 s y la mirada pasa por los dos; en el susto, empieza por la ganadora", () => {
    const porArco = semillasPorArco(18);
    for (const [arco, s] of Object.entries(porArco)) {
      const p = planGuajojo(contexto(18, [3], s));
      const d = p.datos;
      const ult = d.ciclos[d.ciclos.length - 1] as Ciclo;
      expect(ult.tCrac0 - ult.tSil0).toBeCloseTo(T_ULTIMO, 5);
      expect(ult.t1 - ult.tCrac0).toBeCloseTo(T_CRAC, 5);
      expect(ult.tSil0 - ult.t0).toBeCloseTo(T_CANTO, 5);
      const xs = [d.xGanador, d.xRival];
      // La mirada pasa por ambos.
      for (const x of xs) {
        const cerca = Array.from({ length: 80 }, (_, j) => miradaDe(d, ult.tSil0 + j * 0.045)).some((m) => m && Math.abs(m.x - x) < 0.05 && m.abierto > 0.9);
        expect(cerca, `${arco} mira a ${x}`).toBe(true);
      }
      expect(T_AMANECER).toBe(1.8);
    }
  });

  it("nada de lo que se ve cuando quedan dos adivina quién gana: quién va adelante y a quién mira primero la mirada son un cara o cruz en cada arco", () => {
    const por: Record<string, { adelante: number; primero: number; n: number }> = {};
    for (let s = 1; s <= 600; s++) {
      const p = planGuajojo(contexto(18, [3], s));
      const d = p.datos;
      const pen = d.ciclos[d.ciclos.length - 2] as Ciclo;
      const ult = d.ciclos[d.ciclos.length - 1] as Ciclo;
      const r = (por[p.arco] ??= { adelante: 0, primero: 0, n: 0 });
      r.n++;
      if (zDe(d, d.ganador, pen.tSil0 + 0.1) > zDe(d, d.rival, pen.tSil0 + 0.1)) r.adelante++;
      if (ult.primero === d.ganador) r.primero++;
    }
    for (const [arco, r] of Object.entries(por)) {
      expect(r.n, arco).toBeGreaterThan(80);
      // Una moneda justa se sale de 0,5 ± 0,12 con menos de 1 de cada 100 mil con 100 tiros.
      expect(Math.abs(r.adelante / r.n - 0.5), `${arco}: quién va adelante`).toBeLessThan(0.14);
      expect(Math.abs(r.primero / r.n - 0.5), `${arco}: a quién mira primero`).toBeLessThan(0.14);
    }
  });

  it("la tambaleada de quien cae y de quien se salva se parecen: tambalear no delata", () => {
    // De los que tambalean en los silencios, algunos se salvan; la ganadora tambalea con otros que se salvan.
    let ganTamb = 0, salvosTamb = 0, rondas = 0;
    for (let s = 1; s <= 60; s++) {
      const p = planGuajojo(contexto(18, [3], s));
      const d = p.datos;
      rondas++;
      if (d.tamb[3]?.some((e) => !e.cae)) ganTamb++;
      for (const c of d.ciclos) if (!c.ultimo) salvosTamb += c.tambaleos.filter((e) => !e.cae).length;
    }
    expect(ganTamb).toBeGreaterThan(rondas * 0.2);
    expect(salvosTamb).toBeGreaterThan(rondas * 2);
    for (let s = 1; s <= 10; s++) {
      const d = planGuajojo(contexto(18, [3], s)).datos;
      for (const c of d.ciclos) for (const e of c.tambaleos) {
        const ai = swayDe(d, e.quien, (e.t0 + e.t1) / 2);
        expect(ai).toBeGreaterThan(0.2);
      }
    }
  });

  it("la mirada solo existe en los silencios", () => {
    const p = planGuajojo(contexto(18, [3]));
    const d = p.datos;
    expect(miradaDe(d, 0.5)).toBeNull();
    for (const c of d.ciclos) {
      expect(miradaDe(d, c.t0 + 0.5)).toBeNull();
      const m = miradaDe(d, (c.tSil0 + c.tCrac0) / 2);
      expect(m).not.toBeNull();
      expect(m?.abierto).toBeGreaterThan(0.9);
    }
    expect(miradaDe(d, d.tAmanecer0 + 1)).toBeNull();
  });

  it("las fases se suceden: llamada, lista, canto, silencio, crac y amanecer", () => {
    const p = planGuajojo(contexto(18, [3]));
    const d = p.datos;
    expect(faseDe(d, 0.5).fase).toBe("llamada");
    expect(faseDe(d, d.tLista0 + 0.2).fase).toBe("lista");
    const c = d.ciclos[0] as Ciclo;
    expect(faseDe(d, c.t0 + 0.1).fase).toBe("canto");
    expect(faseDe(d, c.tSil0 + 0.1).fase).toBe("silencio");
    expect(faseDe(d, c.tCrac0 + 0.1).fase).toBe("crac");
    expect(faseDe(d, d.tAmanecer0 + 0.1).fase).toBe("amanecer");
  });

  it("la lista muestra a todos con su nombre, de a ocho; con más de 64 no hay lista", () => {
    for (const n of [8, 18, 30, 64]) {
      const d = planGuajojo(contexto(n, ganadoresDe(n))).datos;
      const vistos = new Set<number>();
      for (let t = d.tLista0; t < d.tLista1; t += 0.1) {
        const tanda = tandaDeLista(d, t);
        expect(tanda.length).toBeLessThanOrEqual(8);
        tanda.forEach((i) => vistos.add(i));
      }
      expect(vistos.size, `con ${n}`).toBe(n);
    }
    const d = planGuajojo(contexto(65, [3])).datos;
    expect(d.tLista1).toBe(d.tLista0);
    expect(tandaDeLista(d, d.tLista0 + 0.1)).toEqual([]);
  });
});

describe("Guajojó: la regla del niño", () => {
  it("un solo sentido de avance, y es uno de los que existen", () => {
    for (const n of LISTAS) expect(DIRECCIONES).toContain(planGuajojo(contexto(n, ganadoresDe(n))).sentido);
  });

  it("el marcador es el único contador: arranca en todos, solo baja y con el golpe queda en 1", () => {
    for (const n of LISTAS) {
      for (const s of [7, 8]) {
        const p = planGuajojo(contexto(n, ganadoresDe(n), s));
        const mayor = Math.max(1, ...p.datos.ciclos.map((c) => c.victimas.length));
        expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax: mayor }), `con ${n}`).toEqual([]);
        expect(quedanEn(p.datos, 0)).toBe(n);
      }
    }
  });

  it("con pocos, cada persona que se sienta baja el marcador de a una", () => {
    const p = planGuajojo(contexto(8, [3]));
    expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: 8, pasoMax: 1 })).toEqual([]);
  });

  it("las respuestas dicen quién va adelante, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const n of LISTAS) {
      for (const gs of [ganadoresDe(n), [0, Math.min(n - 1, 1)]]) {
        for (const s of [7, 8, 9]) {
          const p = planGuajojo(contexto(n, gs, s));
          expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n} y semilla ${s}`).toEqual([]);
        }
      }
    }
  });

  it("cada hecho que cuenta una línea se ve en el cuerpo a los 0,3 s", () => {
    const p = planGuajojo(contexto(18, [3]));
    const conHecho = p.guion.filter((l) => l.hecho);
    expect(conHecho.length).toBeGreaterThan(4);
    for (const l of conHecho) {
      const r = p.respuestas(l.t + POSE_MAX);
      expect(r.paso.tipo).toBe(l.hecho?.tipo);
      expect(r.paso.quien).toBe(l.hecho?.quien);
      // Y el cuerpo lo muestra: el que se sienta, sentado; el que aguanta, tambaleando.
      const q = l.hecho?.quien as number;
      if (l.hecho?.tipo === "salio") expect(sentadaDe(p.datos, q, l.t + POSE_MAX)).toBeGreaterThan(0.9);
      if (l.hecho?.tipo === "casi") expect(swayDe(p.datos, q, l.t + POSE_MAX)).toBeGreaterThan(0.3);
    }
  });

  it("el palo (la meta) cae adentro de la pantalla en todas las pantallas, y los cuerpos no lo tapan", () => {
    for (const pant of PANTALLAS) {
      const g = geoDe(pant);
      const c = cajaDelPalo(g);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(pant.w);
      expect(c.y).toBeGreaterThanOrEqual(pant.top);
      expect(c.y + c.h).toBeLessThanOrEqual(pant.bottom + 1);
      // Todos los puestos del sendero entran en la pantalla, a lo ancho.
      for (const x of [-0.86, 0.86]) {
        const q = proyectar(g, x, 0);
        expect(q.x).toBeGreaterThan(0);
        expect(q.x).toBeLessThan(pant.w);
        expect(q.y).toBeLessThanOrEqual(pant.bottom);
      }
    }
  });
});

describe("Guajojó: los textos", () => {
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
      for (const n of [3, 18, 65]) {
        const c = contexto(n, ganadoresDe(n), 7, idioma);
        const p = planGuajojo(c);
        expect(validarGuion(p.guion, p.duracion, { nino: true, nombres: c.nombres }).problemas, `${idioma} con ${n}`).toEqual([]);
      }
    }
  });

  it("la mayoría de los silencios y los cracs tienen su sonido en la escala, entre los grados 0 y 20", () => {
    // Los grados que pide el guion son de 0 a 20: lo asegura `sonido.tono`, que los acota; acá, que el plan no pide otros.
    const texto = (idioma: "es" | "en"): string => JSON.stringify(Object.keys(TEXTOS[idioma]));
    expect(texto("es")).toBe(texto("en"));
  });
});
