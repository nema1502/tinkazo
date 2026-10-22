import { describe, expect, it } from "vitest";
import { MAX_QUESTIONS, WARMUP_UP_TO, enAM, largoOf, lettersOf, planRound, planRounds, rasgosOf, type Question, type Rasgos } from "./quien-plan";

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

/** Lo que dice una pregunta, releído contra los nombres: para comprobar que el juego no miente. */
function cumple(q: Question, r: Rasgos): boolean {
  if (q.tipo === "letra" || q.tipo === "numero") return r.letras.has(q.valor);
  if (q.tipo === "mitad") return r.enAM;
  if (q.tipo === "orden") return (r.numero ?? 0) > Number(q.valor);
  return r.largo > Number(q.valor);
}

describe("quien-plan: las letras", () => {
  it("saca tildes, junta la Ñ con la N y deja solo letras", () => {
    expect([...lettersOf("Óscar Peña-Ibáñez")].sort().join("")).toBe("ABCEINOPRSZ");
    expect([...lettersOf("😀 3")]).toEqual(["3"]);
  });

  it("la mitad del abecedario y el largo cuentan sin tildes ni números", () => {
    expect(enAM("Óscar")).toBe(false);
    expect(enAM("Ana")).toBe(true);
    expect(enAM("zoe")).toBe(false);
    expect(enAM("123")).toBe(false);
    expect(largoOf("Ana")).toBe(3);
    expect(largoOf("Anna")).toBe(4);
    expect(largoOf("Mamani 10")).toBe(6);
  });
});

describe("quien-plan: las preguntas", () => {
  it("el ganador nunca se sienta, cada pregunta es verdad y al final queda solo (o con quien no se puede separar)", () => {
    for (const n of [2, 5, 8, 12, 18, 50, 200]) {
      const names = lista(n);
      const R = names.map(rasgosOf);
      for (let seed = 1; seed <= 30; seed++) {
        const w = Math.floor(rngOf(seed)() * n);
        const r = planRound(names, names.map((_, i) => i), w, rngOf(seed));
        r.questions.forEach((q, qi) => {
          expect(q.remaining).toContain(w);
          expect(q.out).not.toContain(w);
          // Cada pregunta dice lo que pasa con el nombre de quien ganó, y se sienta a los que no siguen.
          expect(cumple(q, R[w] as Rasgos)).toBe(q.has);
          for (const i of q.remaining) expect(cumple(q, R[i] as Rasgos)).toBe(q.has);
          for (const i of q.out) expect(cumple(q, R[i] as Rasgos)).toBe(!q.has);
          // Solo la de calentamiento, la primera con pocas cartas, no saca a nadie.
          if (qi > 0 || n > WARMUP_UP_TO) expect(q.out.length).toBeGreaterThan(0);
        });
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

  it("varía el tipo de pregunta: con 50 nombres usa al menos tres de los cuatro tipos", () => {
    const names = lista(50);
    for (let seed = 1; seed <= 10; seed++) {
      const r = planRound(names, names.map((_, i) => i), seed % 50, rngOf(seed));
      expect(new Set(r.questions.map((q) => q.tipo)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it("con dos o tres cartas arranca con una pregunta que no saca a nadie y es verdad", () => {
    for (const names of [["Ana Vargas", "Diego Rojas"], ["Lucía", "Óscar", "Eli"], ["Bo", "Ty"]]) {
      for (let seed = 1; seed <= 20; seed++) {
        const w = seed % names.length;
        const r = planRound(names, names.map((_, i) => i), w, rngOf(seed));
        const q = r.questions[0];
        expect(q?.out).toEqual([]);
        expect(q?.tipo).toBe("letra");
        expect(lettersOf(names[w] as string).has(q?.valor as string)).toBe(q?.has);
        for (const nm of names) expect(lettersOf(nm).has(q?.valor as string)).toBe(q?.has);
        expect(r.questions.length).toBeGreaterThan(1);
      }
    }
  });

  it("con nombres que no se pueden separar los declara iguales en vez de colgarse", () => {
    const r = planRound(["José", "Jose", "Ana"], [0, 1, 2], 0, rngOf(1));
    expect(r.ties).toEqual([1]);
    expect(r.empate).toBe("iguales");
  });

  it("si dice 'iguales', los que quedan tienen las mismas letras, la misma mitad y el mismo largo que quien ganó", () => {
    const names = ["José", "Jose", "Jóse", "Ana", "Jose ", "Ana", "Ana"];
    for (let seed = 1; seed <= 20; seed++) {
      const w = seed % names.length;
      const r = planRound(names, names.map((_, i) => i), w, rngOf(seed));
      if (r.empate !== "iguales") continue;
      const suyo = rasgosOf(names[w] as string);
      for (const i of r.ties) {
        const otro = rasgosOf(names[i] as string);
        expect([...otro.letras].sort()).toEqual([...suyo.letras].sort());
        expect(otro.enAM).toBe(suyo.enAM);
        expect(otro.largo).toBe(suyo.largo);
      }
    }
  });

  it("con homónimos numerados (la prueba de 200) no dice 'iguales' si todavía se pueden separar", () => {
    const names = lista(200);
    let topes = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const r = planRound(names, names.map((_, i) => i), (seed * 37) % 200, rngOf(seed));
      if (r.empate === "tope") topes++;
      if (r.empate === "iguales") {
        // Sin separación posible, los que quedan son idénticos en todo lo que se pregunta.
        const suyo = rasgosOf(names[r.winner] as string);
        for (const i of r.ties) expect(rasgosOf(names[i] as string)).toEqual(suyo);
      }
    }
    expect(topes).toBeLessThanOrEqual(25);
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
