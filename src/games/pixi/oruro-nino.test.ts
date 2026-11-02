import { describe, expect, it } from "vitest";
import { planEntrada, type EntradaPlan } from "./entrada-plan";
import { problemasDeGrupos, problemasDeRespuestas, type PlanDeRespuestas } from "./kit/respuestas";
import { SENTIDO_ORURO, gruposDeOruro, horaDeCaer, respuestasOruro } from "./oruro-nino";

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

/** Lo que dura el silencio del foco antes del golpe (el de la remontada, el más corto, y el del susto, el más largo). */
const GOLPES = [0.5, 0.95];
const NS = [2, 3, 5, 8, 18, 30, 50, 200];

function armar(n: number, semilla: number) {
  const ganador = Math.min(3, n - 1);
  const plan = planEntrada(n, [ganador], rngOf(semilla));
  const tCartel = plan.T_CROWN + (GOLPES[semilla % 2] as number);
  return { plan, ganador, p: { plan, tCartel } };
}
const comoPlan = (p: { plan: EntradaPlan; tCartel: number }): PlanDeRespuestas => ({ duracion: p.tCartel, sentido: SENTIDO_ORURO, respuestas: (t) => respuestasOruro(p, t) });

describe("las respuestas de La Entrada", () => {
  it("cumplen la prueba del plan con 2 a 200 personas, en todos los arcos", () => {
    const arcos = new Set<string>();
    for (const n of NS) {
      for (let semilla = 1; semilla <= 12; semilla++) {
        const { plan, ganador, p } = armar(n, semilla * 7919 + n);
        arcos.add(plan.arc);
        expect(problemasDeRespuestas(comoPlan(p), { n, ganadores: [ganador], paso: 0.05 }), `n=${n} semilla=${semilla} arco=${plan.arc}`).toEqual([]);
      }
    }
    expect(arcos.size).toBe(4);
  });

  it("es de pie: al empezar siguen todos, en cada arco se quedan unos en la vereda y al final queda quien gana", () => {
    const { plan, ganador, p } = armar(18, 5);
    expect(respuestasOruro(p, 0.1).adelante.quienes).toHaveLength(18);
    let quedan = 18;
    for (const a of plan.arches) {
      const antes = respuestasOruro(p, a.tExit - 0.01).adelante.quienes.length;
      const despues = respuestasOruro(p, a.tExit + 0.01);
      expect(antes).toBe(quedan);
      quedan -= a.exit.ids.length;
      expect(despues.adelante.quienes).toHaveLength(quedan);
      expect(despues.paso).toMatchObject({ tipo: "salio", desde: a.tExit });
      expect(a.exit.ids).toContain(despues.paso.quien);
    }
    expect(quedan).toBe(2);
    expect(respuestasOruro(p, plan.T_SOCAVON + 0.1).adelante.quienes).toHaveLength(2);
    const fin = respuestasOruro(p, p.tCartel + 1);
    expect(fin.adelante.quienes).toEqual([ganador]);
    expect(fin.progreso).toBe(1);
    expect(fin.paso).toMatchObject({ tipo: "gano", quien: ganador });
  });

  it("declara los grupos que muestra la pantalla: uno por persona, el de su fraternidad", () => {
    for (const n of [8, 18, 30, 50]) {
      const { plan } = armar(n, 5);
      const grupos = gruposDeOruro(plan);
      expect(problemasDeGrupos(grupos, n), `n=${n}`).toEqual([]);
      for (const f of plan.frats) for (const i of f.members) expect(grupos[i]).toBe(f.name);
    }
  });

  it("cae el que pierde el contrapunto: queda quien gana antes de la llegada y se dice quién cayó", () => {
    for (let semilla = 1; semilla <= 10; semilla++) {
      const { plan, ganador, p } = armar(18, semilla);
      const cae = horaDeCaer(plan.jumps);
      expect(cae).toBeGreaterThan(plan.T_SOCAVON);
      expect(respuestasOruro(p, cae - 0.01).adelante.quienes).toEqual(expect.arrayContaining([ganador, plan.rival]));
      const r = respuestasOruro(p, cae + 0.01);
      expect(r.adelante.quienes).toEqual([ganador]);
      expect(r.paso).toMatchObject({ tipo: "salio", quien: plan.rival, desde: cae });
    }
  });

  it("antes del golpe nadie gana y el progreso solo sube", () => {
    const { p } = armar(30, 4);
    let previo = 0;
    for (let t = 0; t < p.tCartel; t += 0.07) {
      const r = respuestasOruro(p, t);
      expect(r.paso.tipo).not.toBe("gano");
      expect(r.progreso).toBeGreaterThanOrEqual(previo);
      expect(r.progreso).toBeLessThan(1);
      previo = r.progreso;
    }
  });

  it("los giros se cuentan con quien sigue bailando: el amague y el susto son un casi, el trastabillón un freno", () => {
    const vistos = new Set<string>();
    for (let semilla = 1; semilla <= 40; semilla++) {
      const { plan, p } = armar(30, semilla);
      const f = plan.twists.fake;
      if (f && f.ids[0] !== undefined) {
        const r = respuestasOruro(p, f.t0 + 0.05);
        expect(r.paso).toMatchObject({ tipo: "casi", quien: f.ids[0] });
        expect(r.adelante.quienes).toContain(f.ids[0]);
        vistos.add("amague");
      }
      const s = plan.twists.scare;
      if (s) {
        const r = respuestasOruro(p, s.t + 0.05);
        expect(r.paso).toMatchObject({ tipo: "casi", quien: s.who });
        expect(r.adelante.quienes).toContain(s.who);
        vistos.add("susto");
      }
      plan.jumps.forEach((j, i) => {
        if (j.stumble !== "small" && j.stumble !== "big") return;
        const t = j.t + (((plan.jumps[i + 1]?.t ?? j.t + 0.8) - j.t) * 0.55);
        const r = respuestasOruro(p, t + 0.05);
        // Si el amague o el susto cayeron en el mismo segundo, manda el último; si no, es el trastabillón.
        expect(["freno", "casi", "salio", "adelante"]).toContain(r.paso.tipo);
        if (r.paso.tipo === "freno") {
          expect(r.paso.quien).toBe(j.who);
          expect(r.adelante.quienes).toContain(j.who);
        }
        vistos.add("trastabillon");
      });
    }
    expect([...vistos].sort()).toEqual(["amague", "susto", "trastabillon"]);
  });

  it("con una sola persona no hay contrapunto: gana quien está y nadie cae", () => {
    const { plan, p } = armar(1, 3);
    expect(plan.rival).toBe(-1);
    expect(horaDeCaer(plan.jumps)).toBe(-1);
    expect(respuestasOruro(p, p.tCartel + 1).adelante.quienes).toEqual([0]);
  });
});
