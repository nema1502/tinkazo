import { describe, expect, it, vi } from "vitest";
import { AVISO, ESCALON, FINALISTAS, SEPARACION, duracionPeloton, lineasFijas, PELOTON_MAX, PELOTON_MIN, planPeloton, repartir, tramosPara, type PlanPeloton } from "./peloton-plan";

/** Un generador sembrado, el mismo de los juegos. */
function seeded(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let q = Math.imul(s ^ (s >>> 15), 1 | s);
    q = (q + Math.imul(q ^ (q >>> 7), 61 | q)) ^ q;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ocho finalistas repartidos por la lista, como los deja `planRace`. */
const finalistasDe = (n: number, semilla: number): number[] => {
  const r = seeded(semilla * 7919 + 13);
  const todos = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [todos[i], todos[j]] = [todos[j] as number, todos[i] as number];
  }
  return todos.slice(0, FINALISTAS);
};

const plan = (n: number, semilla = 1): PlanPeloton => planPeloton(n, finalistasDe(n, semilla), seeded(semilla));

describe("planPeloton: lo básico", () => {
  for (let n = PELOTON_MIN; n <= PELOTON_MAX; n++) {
    it(`con ${n}: se echan todos menos los ocho, una sola vez, y el pelotón termina en ocho`, () => {
      const p = plan(n, n);
      const fin = new Set(p.finalistas);
      expect(p.finalistas.length).toBe(FINALISTAS);
      const echados = p.eventos.flatMap((e) => e.personas);
      expect(echados.length).toBe(n - FINALISTAS);
      expect(new Set(echados).size).toBe(echados.length);
      for (const q of echados) expect(fin.has(q)).toBe(false);
      for (const q of p.finalistas) expect(p.cae[q]).toBe(Infinity);
      expect(p.quedanEn(0)).toBe(n);
      expect(p.quedanEn(p.fin)).toBe(FINALISTAS);
      expect(p.eventos.at(-1)?.quedan).toBe(FINALISTAS);
      // `quedan` baja de a uno o de a dos, y nunca sube.
      let prev = n;
      for (const e of p.eventos) {
        expect(e.quedan).toBe(prev - e.personas.length);
        expect(e.personas.length).toBeGreaterThanOrEqual(1);
        expect(e.personas.length).toBeLessThanOrEqual(2);
        prev = e.quedan;
      }
    });
  }
  it("los tramos son contiguos, crecen y cubren todas las echadas", () => {
    for (let n = PELOTON_MIN; n <= PELOTON_MAX; n++) {
      const p = plan(n, 3);
      expect(p.tramos.length).toBe(tramosPara(n - FINALISTAS));
      expect(p.tramos[0]?.t0).toBe(p.intro);
      p.tramos.forEach((t, k) => {
        expect(t.t1).toBeGreaterThan(t.t0 + 3);
        if (k) expect(t.t0).toBe(p.tramos[k - 1]?.t1);
      });
      for (const e of p.eventos) {
        const t = p.tramos[e.tramo];
        expect(t && e.t >= t.t0 + 1.9 && e.t + (e.personas.length - 1) * ESCALON < t.t1).toBe(true);
      }
      expect(p.fin).toBe(p.tramos.at(-1)?.t1);
    }
  });
  it("entre una echada y la siguiente hay al menos un segundo y cuarto (los subtítulos no se pisan)", () => {
    for (let n = PELOTON_MIN; n <= PELOTON_MAX; n++) {
      for (let s = 1; s <= 20; s++) {
        const p = plan(n, s);
        const fin = p.eventos.map((e) => e.t + (e.personas.length - 1) * ESCALON);
        for (let i = 1; i < p.eventos.length; i++) expect((p.eventos[i]?.t ?? 0) - (fin[i - 1] ?? 0)).toBeGreaterThanOrEqual(1.2);
      }
    }
  });
  it("ninguna línea del relator pisa a otra: ni los sustos, ni las echadas, ni las líneas fijas", () => {
    for (let n = PELOTON_MIN; n <= PELOTON_MAX; n++) {
      for (let s = 1; s <= 40; s++) {
        const p = plan(n, s);
        const momentos = [...lineasFijas(p.tramos, p.fin), ...p.eventos.map((e) => e.t), ...p.tambaleos.filter((x) => x.habla).map((x) => x.t)].sort((a, b) => a - b);
        for (let i = 1; i < momentos.length; i++) {
          expect((momentos[i] as number) - (momentos[i - 1] as number), `n=${n} semilla=${s} en ${(momentos[i] as number).toFixed(2)}`).toBeGreaterThanOrEqual(SEPARACION - 1e-9);
        }
      }
    }
  });
  it("cuántos tramos y cuántos por tramo", () => {
    expect([1, 3, 4, 8, 9, 14, 15, 22].map(tramosPara)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(repartir(22, [0.4, 0.32, 0.18, 0.1])).toEqual([9, 7, 4, 2]);
    for (let total = 4; total <= 22; total++) {
      for (const pesos of [[0.62, 0.38], [0.5, 0.32, 0.18], [0.4, 0.32, 0.18, 0.1]]) {
        const r = repartir(total, pesos);
        expect(r.reduce((a, b) => a + b, 0)).toBe(total);
        for (const x of r) expect(x).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it("la duración que se anuncia es la del plan, dentro de un segundo", () => {
    for (let n = PELOTON_MIN; n <= PELOTON_MAX; n++) {
      let suma = 0;
      for (let s = 1; s <= 40; s++) suma += plan(n, s).fin;
      expect(Math.abs(suma / 40 - duracionPeloton(n))).toBeLessThan(1);
    }
    expect(duracionPeloton(8)).toBe(0);
    // Más gente, más largo; nunca más corto.
    for (let n = PELOTON_MIN + 1; n <= PELOTON_MAX; n++) expect(duracionPeloton(n)).toBeGreaterThanOrEqual(duracionPeloton(n - 1));
  });
  it("los lugares del pelotón son una permutación de todos", () => {
    const p = plan(30, 5);
    expect([...p.orden].sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, i) => i));
  });
  it("vivosEn sigue el reloj", () => {
    const p = plan(20, 2);
    const e0 = p.eventos[0];
    expect(p.vivosEn(e0 ? e0.t - 0.01 : 0).length).toBe(20);
    expect(p.vivosEn(e0 ? e0.t + 0.01 : 0).length).toBeLessThan(20);
    expect(p.vivosEn(p.fin).sort((a, b) => a - b)).toEqual([...p.finalistas].sort((a, b) => a - b));
  });
  it("cada tambaleo cae un segundo antes de una echada, y es de alguien que todavía sigue", () => {
    for (let s = 1; s <= 30; s++) {
      const p = plan(26, s);
      for (const x of p.tambaleos) {
        expect(p.eventos.some((e) => Math.abs(e.t - AVISO - x.t) < 1e-9)).toBe(true);
        expect(p.cae[x.persona]).toBeGreaterThan(x.t);
      }
    }
  });
});

describe("planPeloton: es de la ronda y de nada más", () => {
  it("la misma ronda da el mismo plan, y no usa Math.random", () => {
    const espia = vi.spyOn(Math, "random");
    const a = plan(24, 9);
    const b = plan(24, 9);
    expect(a.eventos).toEqual(b.eventos);
    expect(a.orden).toEqual(b.orden);
    expect(a.tambaleos).toEqual(b.tambaleos);
    expect(plan(24, 10).eventos).not.toEqual(a.eventos);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
  it("con menos de uno para echar, avisa", () => {
    expect(() => planPeloton(8, [0, 1, 2, 3, 4, 5, 6, 7], seeded(1))).toThrow();
  });
});

describe("planPeloton: no delata al ganador", () => {
  // El ganador es uno de los ocho finalistas. Lo que se mide es que, con 1500
  // rondas, entre los que se tambalean la parte de finalistas es la que hay
  // entre los que siguen en carrera (8 sobre cuántos quedan), tanto en todos
  // como en los que el relator nombra.
  const N = 30;
  const rondas = 1500;
  let finalistasTamb = 0;
  let esperados = 0;
  let total = 0;
  let hablan = 0;
  let hablaFinalistas = 0;
  let hablaEsperados = 0;
  let porRonda = 0;
  const vez = new Array<number>(FINALISTAS).fill(0);
  for (let s = 1; s <= rondas; s++) {
    const fins = finalistasDe(N, s);
    const p = planPeloton(N, fins, seeded(s * 31 + 7));
    porRonda += p.tambaleos.length;
    for (const w2 of p.tambaleos) {
      const quedan = N - p.cae.filter((c) => c <= w2.t).length;
      esperados += FINALISTAS / quedan;
      total++;
      const k = p.finalistas.indexOf(w2.persona);
      if (k >= 0) {
        finalistasTamb++;
        vez[k] = (vez[k] ?? 0) + 1;
      }
      if (w2.habla) {
        hablan++;
        hablaEsperados += FINALISTAS / quedan;
        if (k >= 0) hablaFinalistas++;
      }
    }
  }
  it("hay tambaleos, pero no tantos como para llenar la pantalla", () => {
    const media = porRonda / rondas;
    expect(media).toBeGreaterThan(5);
    expect(media).toBeLessThan(16);
  });
  it("cada puesto de finalista se tambalea parecido (con ninguno se nota)", () => {
    const media = vez.reduce((a, b) => a + b, 0) / FINALISTAS;
    for (const v of vez) {
      expect(v).toBeGreaterThan(media * 0.8);
      expect(v).toBeLessThan(media * 1.2);
    }
  });
  it("entre los que se tambalean, la parte de finalistas es la que hay entre los que siguen", () => {
    expect(finalistasTamb / esperados).toBeGreaterThan(0.9);
    expect(finalistasTamb / esperados).toBeLessThan(1.1);
    expect(total).toBeGreaterThan(5000);
  });
  it("lo mismo entre los que el relator nombra: nombrar a alguien no adelanta qué le pasa", () => {
    expect(hablaFinalistas / hablaEsperados).toBeGreaterThan(0.85);
    expect(hablaFinalistas / hablaEsperados).toBeLessThan(1.15);
    // Y habla una parte de los que se tambalean: ni todos ni ninguno.
    expect(hablan / total).toBeGreaterThan(0.2);
    expect(hablan / total).toBeLessThan(0.65);
  });
  it("el que se echa primero no tiene nada que ver con la lista", () => {
    const cuenta = new Array<number>(N).fill(0);
    for (let s = 1; s <= 3000; s++) {
      const p = planPeloton(N, finalistasDe(N, s), seeded(s));
      const q = p.eventos[0]?.personas[0] ?? 0;
      cuenta[q] = (cuenta[q] ?? 0) + 1;
    }
    expect(cuenta.filter((c) => c > 0).length).toBe(N);
    expect(Math.max(...cuenta)).toBeLessThan(Math.min(...cuenta) * 2.2);
  });
});
