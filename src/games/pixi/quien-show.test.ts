import { describe, expect, it } from "vitest";
import { T } from "../../i18n";
import { writeStory } from "../drama";
import { problemasDeMomentos } from "./kit/director";
import { azarDe, sembrar } from "./kit/azar";
import { crearGuion, validarGuion, type EjecutorGuion } from "./kit/guion";
import { problemasDeMarcador } from "./kit/marcador";
import { problemasDeRespuestas } from "./kit/respuestas";
import { HZ_MAX, HZ_MIN, VOL_MIN, crearSonido, type Timbre, type Voz } from "./kit/sonido";
import type { Contexto, Idioma, Kit } from "./kit/tipos";
import { FIN, FINAL_HOLD, FLIP, NEXT_GAP, REGROUP, REVISAR, REVISAR_NEXT, SIT, T_DEAL, T_NEXT, TIC_SONIDO, lugaresEn, pasoEn, planQuien, vivosEn } from "./quien-show";
import { planRounds } from "./quien-plan";

const RONDA = "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829";
const NOMBRES = ["María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas", "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce", "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi"];
const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `${NOMBRES[i % NOMBRES.length]}${i >= NOMBRES.length ? ` ${Math.floor(i / NOMBRES.length) + 1}` : ""}`);

/** El contexto que arma el kit: el azar sembrado, y las frases del sitio en el idioma pedido. */
function contexto(n: number, ganadores: number[], semilla = 11, idioma: Idioma = "es"): Contexto {
  const rng = sembrar(semilla);
  return {
    nombres: lista(n),
    ganadores,
    ronda: RONDA,
    rng,
    idioma,
    txt: (clave, ...args) => {
      const v = T[idioma][clave];
      if (typeof v === "function") return (v as (...a: unknown[]) => string)(...args);
      return Array.isArray(v) ? (v[0] as string) : (v as string);
    },
    azar: (e) => azarDe(RONDA, e),
    historia: (a, g) => writeStory(rng, a, g),
  };
}

const CASOS: [number, number[]][] = [[8, [3]], [18, [5]], [50, [30]], [100, [77]], [18, [5, 9]], [30, [2, 10, 20]]];

describe("De pie, sobre el kit: el show es una función de la lista y la ronda", () => {
  it("la misma ronda cuenta lo mismo, paso por paso", () => {
    for (const [n, gs] of CASOS) {
      const a = planQuien(contexto(n, gs));
      const b = planQuien(contexto(n, gs));
      expect(JSON.stringify({ d: a.duracion, r: a.respiro, k: a.arco, s: a.datos.steps, m: a.marcas, g: a.guion.map((l) => [l.t, typeof l.texto === "function" ? l.texto() : l.texto]) })).toBe(
        JSON.stringify({ d: b.duracion, r: b.respiro, k: b.arco, s: b.datos.steps, m: b.marcas, g: b.guion.map((l) => [l.t, typeof l.texto === "function" ? l.texto() : l.texto]) }),
      );
    }
  });

  it("el azar se gasta en el mismo orden de siempre: primero las preguntas y después la historia", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs, 23));
      const rng = sembrar(23);
      const prizes = gs.length ? [...gs].reverse() : [0];
      const rondas = planRounds(lista(n), prizes, rng);
      const historia = writeStory(rng, Math.max(2, n), (prizes[prizes.length - 1] as number) % Math.max(2, n));
      expect(p.arco).toBe(historia.arc);
      expect(p.datos.story).toEqual(historia);
      expect(p.datos.rounds).toEqual(rondas);
    }
  });

  it("quien gana llega dado: la última ronda lo deja de pie y las anteriores coronan a los demás premios", () => {
    for (const [n, gs] of CASOS) {
      const { datos } = planQuien(contexto(n, gs));
      expect(datos.rounds.map((r) => r.winner)).toEqual([...gs].reverse());
      expect(datos.rounds.length).toBe(gs.length);
    }
  });

  it("dura lo que sumaban los pasos de siempre: reparto, revisión, respuesta, vuelta, aplauso y sostén", () => {
    for (const [n, gs] of CASOS) {
      const { duracion, datos } = planQuien(contexto(n, gs));
      let esperado = 0;
      datos.rounds.forEach((r, ri) => {
        const grand = ri === datos.total - 1;
        const Q = r.questions.length;
        esperado += ri === 0 ? T_DEAL : T_NEXT;
        let antes = r.pool.length;
        let finDicho = false;
        r.questions.forEach((q, qi) => {
          const revisar = (ri === 0 ? REVISAR : REVISAR_NEXT) + (qi >= Q - 2 ? 0.4 : 0) + (grand && qi === Q - 1 ? 1.0 : 0);
          esperado += revisar + SIT + FLIP + 0.1 + REGROUP;
          const quedan = q.remaining.length;
          if (!finDicho && quedan <= 4 && quedan > 1 && antes > 4) {
            finDicho = true;
            esperado += ri === 0 ? FIN : 2.4;
          }
          antes = quedan;
        });
        if (r.ties.length) esperado += 1.2 + 0.6 + FLIP + 0.1 + REGROUP;
        esperado += grand ? FINAL_HOLD : NEXT_GAP;
      });
      expect(duracion, `${n} con ${gs.length}`).toBeCloseTo(esperado, 9);
    }
  });

  it("los momentos de la cámara están en orden, y el respiro cae en la respuesta que decide", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs));
      expect(problemasDeMomentos(p), `${n}`).toEqual([]);
      const ultima = p.datos.pasosPregunta[p.datos.total - 1]?.at(-1);
      expect(p.respiro).toBe(ultima ? ultima.answer : p.duracion);
      expect(p.momentos.tension.desde).toBe(ultima ? ultima.start : Math.max(T_DEAL, p.duracion - 4));
      expect(p.respiro as number).toBeLessThanOrEqual(p.duracion);
    }
  });

  it("anota para los auditores cuántos son y cuántas preguntas hay por ronda", () => {
    const p = planQuien(contexto(18, [5, 9]));
    expect(p.marcas?.quien).toBe("18x2");
    expect(p.marcas?.preguntas?.split(",")).toHaveLength(2);
  });

  it("el susto trae su «¡Uy, casi se sienta!» a mitad del amague, y los otros arcos no", () => {
    let vistoSusto = false;
    let vistoOtro = false;
    for (let semilla = 1; semilla <= 40 && !(vistoSusto && vistoOtro); semilla++) {
      const p = planQuien(contexto(18, [5], semilla));
      const casi = p.guion.filter((l) => typeof l.texto === "function" && l.texto() === T.es.cQuiAlmost(0));
      if (p.arco === "susto") {
        vistoSusto = true;
        const ult = p.datos.pasosPregunta[0]?.at(-1);
        expect(casi).toHaveLength(1);
        expect(casi[0]?.t).toBeCloseTo((ult?.flip ?? 0) + 0.45, 9);
      } else {
        vistoOtro = true;
        expect(casi).toHaveLength(0);
      }
    }
    expect(vistoSusto && vistoOtro).toBe(true);
  });
});

describe("De pie, sobre el kit: el guion", () => {
  it("no tiene líneas mudas ni fuera de tiempo, y la sala nunca espera cuatro segundos sin una frase", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs));
      const r = validarGuion(p.guion, p.duracion);
      expect(r.problemas, `${n}`).toEqual([]);
      // Hay revisiones de hasta cuatro segundos: entre la pregunta y su respuesta, el tic marca el pulso.
      expect(r.huecoMax, `${n}`).toBeLessThanOrEqual(6);
    }
  });

  it("corriendo el guion a 60 cuadros, ninguna frase se pisa y ninguna se tira", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs));
      const g = crearGuion(p.guion);
      const kit = { sonido: crearSonido(vozFalsa().voz), cam: { shake: () => undefined }, pantalla: () => ({ k: 1 }), calor: () => undefined } as unknown as Kit;
      const ej: EjecutorGuion<Kit> = { decir: () => undefined, hacer: (fn) => fn(kit) };
      for (let i = 0; i <= Math.ceil(p.duracion * 60) + 60; i++) g.avanzar(i / 60, ej);
      expect(g.pendientes(), `${n}`).toBe(0);
      expect(g.tiradas(), `${n}`).toBe(0);
      const dichas = g.dichas();
      for (let i = 1; i < dichas.length; i++) expect((dichas[i]?.t ?? 0) - (dichas[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(0.3 - 1e-9);
      // Con la mitad de las frases en juego, nunca dos iguales seguidas.
      expect(dichas.length).toBeGreaterThan(5);
    }
  });

  it("todo lo que suena cumple las reglas de audit-sound: dentro de la escala, del registro y sobre el murmullo", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs));
      const { voz, toques } = vozFalsa();
      const kit = { sonido: crearSonido(voz), cam: { shake: () => undefined }, pantalla: () => ({ k: 1 }), calor: () => undefined } as unknown as Kit;
      for (const l of p.guion) l.hacer?.(kit);
      expect(toques.length, `${n}`).toBeGreaterThan(20);
      for (const x of toques) {
        expect(x.hz).toBeGreaterThanOrEqual(HZ_MIN);
        expect(x.hz).toBeLessThanOrEqual(HZ_MAX);
        expect(x.vol).toBeGreaterThanOrEqual(VOL_MIN);
      }
    }
  });

  it("las frases salen en español y en inglés, ninguna vacía", () => {
    for (const idioma of ["es", "en"] as const) {
      for (const [n, gs] of CASOS) {
        const p = planQuien(contexto(n, gs, 5, idioma));
        for (const l of p.guion) {
          if (l.texto === undefined) continue;
          const texto = typeof l.texto === "function" ? l.texto() : l.texto;
          expect(texto.trim(), `${idioma} ${n}`).not.toBe("");
          expect(texto, `${idioma} ${n}`).not.toMatch(/^cQui|undefined|NaN/);
        }
      }
    }
  });

  it("el tic de la revisión es el de siempre: dos por segundo, sin delatar a nadie", () => {
    const p = planQuien(contexto(18, [5]));
    const s0 = p.datos.steps.find((s) => s.kind === "pregunta");
    expect(s0).toBeDefined();
    const tics = p.guion.filter((l) => l.texto === undefined && l.hacer && l.t > (s0?.start ?? 0) && l.t < (s0?.answer ?? 0));
    expect(tics.length).toBeGreaterThanOrEqual(3);
    expect(tics[0]?.t).toBeCloseTo((s0?.start ?? 0) + TIC_SONIDO, 9);
  });
});

describe("De pie, sobre el kit: quién sigue de pie", () => {
  it("al empezar están todos, y al terminar cada ronda queda solo quien gana", () => {
    for (const [n, gs] of CASOS) {
      const { datos, duracion } = planQuien(contexto(n, gs));
      datos.rounds.forEach((r, ri) => {
        const primero = datos.steps.find((s) => s.round === ri) as { start: number };
        expect(vivosEn(datos, ri, primero.start).length).toBe(r.pool.length);
        const fin = datos.steps.filter((s) => s.round === ri).at(-1) as { end: number };
        expect(vivosEn(datos, ri, fin.end + 5)).toEqual([r.winner]);
        expect(lugaresEn(datos, ri, fin.end + 5)).toEqual([r.winner]);
      });
      expect(pasoEn(datos, 0).kind).toBe("reparto");
      expect(pasoEn(datos, duracion + 10).round).toBe(datos.total - 1);
    }
  });

  it("nadie vuelve a pararse: los que siguen de pie solo se achican con el tiempo", () => {
    const { datos, duracion } = planQuien(contexto(50, [30]));
    let previo = Infinity;
    for (let t = 0; t <= duracion; t += 0.1) {
      const v = vivosEn(datos, 0, t).length;
      expect(v).toBeLessThanOrEqual(previo);
      previo = v;
    }
  });
});

function vozFalsa(): { voz: Voz; toques: { hz: number; dur: number; timbre: Timbre; vol: number }[] } {
  const toques: { hz: number; dur: number; timbre: Timbre; vol: number }[] = [];
  const nota = (grado: number): number => {
    const d = Math.max(0, Math.round(grado));
    return 130.81 * Math.pow(2, (([0, 2, 4, 7, 9][d % 5] ?? 0) + 12 * Math.floor(d / 5)) / 12);
  };
  return { voz: { tono: (hz, dur, timbre, vol) => toques.push({ hz, dur, timbre, vol }), nota, fanfarria: () => undefined, despues: (_ms, fn) => fn() }, toques };
}

describe("De pie, sobre el kit: la regla del niño", () => {
  const UN_PREMIO = CASOS.filter(([, gs]) => gs.length === 1);

  it("avanza hacia un solo sentido: el medio de la mesa", () => {
    for (const [n, gs] of CASOS) expect(planQuien(contexto(n, gs)).sentido).toBe("centro");
  });

  it("el marcador cuenta a los que siguen de pie: arranca en todos, solo baja y con el golpe queda en 1", () => {
    for (const [n, gs] of UN_PREMIO) {
      const p = planQuien(contexto(n, gs));
      // De pie sienta a varios a la vez: baja por tandas, no de a uno (rediseño pendiente, regla 6 de la regla del niño).
      expect(problemasDeMarcador(p.marcador, { duracion: p.duracion, total: n, pasoMax: n }), `con ${n}`).toEqual([]);
    }
  });

  it("con varios premios el marcador cuenta la ronda que corre, y con el golpe queda en 1", () => {
    for (const [n, gs] of CASOS.filter(([, g]) => g.length > 1)) {
      const p = planQuien(contexto(n, gs));
      expect(p.marcador(0)).toBe(n);
      expect(p.marcador(p.duracion)).toBe(1);
    }
  });

  it("las respuestas dicen quién sigue de pie, hacia dónde, cuánto falta y qué pasó, en todo cuadro", () => {
    for (const [n, gs] of CASOS) {
      const p = planQuien(contexto(n, gs));
      expect(problemasDeRespuestas(p, { n, ganadores: gs }), `con ${n}`).toEqual([]);
    }
  });

  it("adelante es estar de pie: al empezar son todos y con el golpe, quien gana", () => {
    const p = planQuien(contexto(18, [5]));
    expect(p.respuestas(0).adelante.quienes).toHaveLength(18);
    expect(p.respuestas(p.duracion).adelante.quienes).toEqual([5]);
    expect(p.respuestas(p.duracion).paso).toMatchObject({ tipo: "gano", quien: 5 });
    expect(p.respuestas(0).paso.tipo).toBe("empezo");
  });

  it("anota cada salida en su segundo, con quién se sentó", () => {
    const p = planQuien(contexto(18, [5]));
    const salidas = p.datos.steps.filter((s) => s.kind === "pregunta");
    const conSalida = salidas.find((s) => (p.datos.rounds[0]?.questions[s.qi]?.out.length ?? 0) > 0) as { flip: number; qi: number };
    const quien = p.datos.rounds[0]?.questions[conSalida.qi]?.out[0];
    expect(p.respuestas(conSalida.flip + 0.05).paso).toMatchObject({ tipo: "salio", quien, desde: conSalida.flip });
  });
});
