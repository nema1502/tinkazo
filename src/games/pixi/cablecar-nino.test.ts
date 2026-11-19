import { beforeAll, describe, expect, it, vi } from "vitest";
import { problemasDeGrupos, problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";

/** El plan toma `clamp` de overlay.ts, que lee `location` al cargarse, y vitest corre en Node. */
let planCableCar: typeof import("./cablecar-plan").planCableCar;
let T_CROWN: number;
let T_RUN: number;
let nino: typeof import("./cablecar-nino");
beforeAll(async () => {
  vi.stubGlobal("location", { search: "" });
  ({ planCableCar, T_CROWN, T_RUN } = await import("./cablecar-plan"));
  nino = await import("./cablecar-nino");
}, 60_000);

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);
/** Lo que dura el silencio del foco antes del golpe, en segundos de juego (el de la remontada, el más corto, y el del susto, el más largo). */
const GOLPES = [0.5, 0.95];

function armar(n: number, semilla: number, golpe: number) {
  const ganador = n > 3 ? 3 : 0;
  const P = planCableCar(lista(n), [ganador], rngOf(semilla));
  return { P, ganador, plan: nino.planDelTelefericoDe(P, ganador, T_CROWN + golpe) };
}

describe("las respuestas del teleférico", () => {
  it("cumplen la prueba del plan con 2, 8, 18, 40 y 200 personas, en todos los arcos", () => {
    const arcos = new Set<string>();
    for (const n of [2, 8, 18, 40, 200]) {
      for (let semilla = 1; semilla <= 12; semilla++) {
        const { P, ganador, plan } = armar(n, semilla * 7919 + n, GOLPES[semilla % 2] as number);
        arcos.add(P.story.arc);
        const comoPlan: PlanDeRespuestas = { duracion: plan.tCartel, sentido: "derecha", respuestas: (t) => nino.respuestasTeleferico(plan, t, "derecha") };
        expect(problemasDeRespuestas(comoPlan, { n, ganadores: [ganador], paso: 0.05 }), `n=${n} semilla=${semilla} arco=${P.story.arc}`).toEqual([]);
      }
    }
    expect(arcos.size).toBe(4);
  });

  it("es de pie: en cada parada se baja un grupo entero, y el convoy no tiene a nadie «adelante»", () => {
    const { P, plan } = armar(18, 5, 0.5);
    let previo = 18;
    for (const st of P.stops) {
      const antes = nino.respuestasTeleferico(plan, st.tOff - 0.01, "derecha").adelante.quienes.length;
      const despues = nino.respuestasTeleferico(plan, st.tOff + 0.01, "derecha");
      expect(antes).toBe(previo);
      expect(despues.adelante.quienes.length).toBe(P.left[st.round + 1]);
      expect(despues.paso).toMatchObject({ tipo: "salio", desde: st.tOff });
      previo = despues.adelante.quienes.length;
    }
    expect(previo).toBe(1);
  });

  it("a la última estación llegan dos, uno se baja, y a la cumbre sube solo quien gana hasta el golpe", () => {
    for (let semilla = 1; semilla <= 10; semilla++) {
      const { P, ganador, plan } = armar(18, semilla, 0.95);
      const ult = P.stops.find((s) => s.last);
      const antes = nino.respuestasTeleferico(plan, (ult?.tOff ?? 0) - 0.01, "derecha");
      expect(antes.adelante.quienes).toHaveLength(2);
      expect(antes.adelante.quienes).toContain(ganador);
      const arriba = nino.respuestasTeleferico(plan, T_RUN + 0.5, "derecha");
      expect(arriba.adelante.quienes).toEqual([ganador]);
      expect(arriba.adelante.quienes).toEqual([...P.surv]);
      expect(nino.respuestasTeleferico(plan, plan.tCartel - 0.01, "derecha").paso.tipo).not.toBe("gano");
      const fin = nino.respuestasTeleferico(plan, plan.tCartel + 1, "derecha");
      expect(fin.adelante.quienes).toEqual([ganador]);
      expect(fin.progreso).toBe(1);
      expect(fin.paso).toMatchObject({ tipo: "gano", quien: ganador });
    }
  });

  it("declara los grupos que muestra la pantalla: uno por persona, el de su cabina, y quienes van juntos comparten nombre", () => {
    for (const n of [8, 18, 40]) {
      const { P } = armar(n, 11, 0.5);
      const grupos = nino.gruposDelTeleferico(P);
      expect(problemasDeGrupos(grupos, n), `n=${n}`).toEqual([]);
      P.pax.forEach((personas, cab) => {
        for (const i of personas) expect(grupos[i]).toBe(P.grupos[P.groupOfCab[cab] ?? 0]?.nombre);
      });
    }
  });

  it("al 25 % y al 60 % siguen cada vez menos, y el progreso solo sube", () => {
    const { plan } = armar(40, 9, 0.5);
    const r25 = nino.respuestasTeleferico(plan, 0.25 * plan.tCartel, "derecha");
    const r60 = nino.respuestasTeleferico(plan, 0.6 * plan.tCartel, "derecha");
    expect(r25.adelante.quienes.length).toBeGreaterThan(r60.adelante.quienes.length);
    expect(r60.adelante.quienes.length).toBeGreaterThanOrEqual(2);
    let previo = 0;
    for (let t = 0; t <= plan.tCartel + 2; t += 0.05) {
      const r = nino.respuestasTeleferico(plan, t, "derecha").progreso;
      expect(r).toBeGreaterThanOrEqual(previo);
      previo = r;
    }
  });

  it("los giros se cuentan con quien va en la cabina final: la puerta es un casi; la mordaza y el apagón, un freno", () => {
    const vistos = new Set<string>();
    for (let semilla = 1; semilla <= 30; semilla++) {
      const { P, plan } = armar(18, semilla, 0.5);
      const arriba = (x: number) => nino.respuestasTeleferico(plan, x, "derecha").adelante.quienes;
      if (P.puerta) {
        const r = nino.respuestasTeleferico(plan, P.puertaA + 0.05, "derecha");
        expect(r.paso).toMatchObject({ tipo: "casi", quien: P.nombrado });
        expect(arriba(P.puertaA + 0.05)).toContain(P.nombrado);
        vistos.add("puerta");
      }
      if (P.mordaza) {
        expect(nino.respuestasTeleferico(plan, P.mA + 0.05, "derecha").paso).toMatchObject({ tipo: "freno", quien: P.nombrado });
        expect(arriba(P.mA + 0.05)).toContain(P.nombrado);
        vistos.add("mordaza");
      }
      if (P.apagon) {
        expect(nino.respuestasTeleferico(plan, P.quieto + 0.05, "derecha").paso).toMatchObject({ tipo: "freno", quien: P.nombrado });
        expect(arriba(P.quieto + 0.05)).toContain(P.nombrado);
        vistos.add("apagon");
      }
    }
    expect([...vistos].sort()).toEqual(["apagon", "mordaza", "puerta"]);
  });

  it("sube hacia la derecha en horizontal y hacia arriba en el celular", () => {
    expect(nino.sentidoDelTeleferico(false)).toBe("derecha");
    expect(nino.sentidoDelTeleferico(true)).toBe("arriba");
  });
});
