import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, lettersOf, planRound, planRounds } from "./quien-plan";

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

const EJEMPLO = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];
const lista = (n: number): string[] => Array.from({ length: n }, (_, i) => `${EJEMPLO[i % EJEMPLO.length]}${i >= EJEMPLO.length ? ` ${Math.floor(i / EJEMPLO.length) + 1}` : ""}`);

describe("quien-plan: las letras", () => {
  it("saca tildes, junta la Ñ con la N y deja solo letras", () => {
    expect([...lettersOf("Óscar Peña-Ibáñez")].sort().join("")).toBe("ABCEINOPRSZ");
    expect([...lettersOf("😀 3")]).toEqual(["3"]);
  });
});

describe("quien-plan: las preguntas", () => {
  it("el ganador nunca se da vuelta y al final queda solo (o con quien no se puede separar)", () => {
    for (const n of [2, 5, 12, 18, 50, 200]) {
      const names = lista(n);
      for (let seed = 1; seed <= 30; seed++) {
        const w = Math.floor(rngOf(seed)() * n);
        const r = planRound(names, names.map((_, i) => i), w, rngOf(seed));
        for (const q of r.questions) {
          expect(q.remaining).toContain(w);
          expect(q.out).not.toContain(w);
          expect(q.out.length).toBeGreaterThan(0);
        }
        const ult = r.questions.at(-1)?.remaining ?? names.map((_, i) => i);
        expect(new Set([w, ...r.ties])).toEqual(new Set(ult));
        expect(r.questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
      }
    }
  });

  it("parte el grupo cerca de la mitad: 50 nombres en pocas preguntas", () => {
    const names = lista(50);
    let peor = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = planRound(names, names.map((_, i) => i), seed % 50, rngOf(seed));
      peor = Math.max(peor, r.questions.length);
    }
    expect(peor).toBeLessThanOrEqual(9);
  });

  it("con nombres que no se pueden separar los declara empatados en vez de colgarse", () => {
    const r = planRound(["José", "Jose", "Ana"], [0, 1, 2], 0, rngOf(1));
    expect(r.ties).toEqual([1]);
  });

  it("una ronda por ganador, sin los ganadores anteriores", () => {
    const names = lista(30);
    const rs = planRounds(names, [4, 9, 20], rngOf(5));
    expect(rs).toHaveLength(3);
    expect(rs[1]?.pool).not.toContain(4);
    expect(rs[2]?.pool).not.toContain(9);
    expect(() => planRounds(names, [4, 4], rngOf(1))).toThrow();
  });

  it("es determinista", () => {
    const names = lista(50);
    expect(planRounds(names, [7], rngOf(9))).toEqual(planRounds(names, [7], rngOf(9)));
  });
});
