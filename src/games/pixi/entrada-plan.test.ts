import { describe, expect, it } from "vitest";
import { cuantosGrupos, grupoDe } from "../grupos";
import { DANCES, memberRounds, planEntrada, presentationTime, type EntradaPlan } from "./entrada-plan";

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

/** Quiénes siguen en la comparsa después de todos los arcos. */
const quedan = (P: EntradaPlan): number[] => {
  const fuera = new Set(P.arches.flatMap((a) => a.exit.ids));
  return Array.from({ length: P.n }, (_, i) => i).filter((i) => !fuera.has(i));
};

describe("La Entrada: las fraternidades", () => {
  it.each([2, 3, 5, 8, 18, 30, 50, 200])("con %i personas, cada grupo es una fraternidad, con su baile y su color", (n) => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const P = planEntrada(n, [Math.min(3, n - 1)], rngOf(seed));
      expect(P.frats.length).toBe(cuantosGrupos(n));
      // El reparto es el de grupos.ts: el mismo del teleférico y de la lista del QR.
      for (const f of P.frats) for (const i of f.members) expect(grupoDe(i, n)).toBe(f.g);
      expect(P.frats.flatMap((f) => f.members).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      expect([...P.order].sort((a, b) => a - b)).toEqual(P.frats.map((f) => f.g));
      for (const f of P.frats) {
        expect(DANCES).toContain(f.dance);
        expect(f.color).toBeGreaterThan(0);
      }
      // Con cinco o menos fraternidades, ningún baile se repite.
      if (P.frats.length <= DANCES.length) expect(new Set(P.frats.map((f) => f.dance)).size).toBe(P.frats.length);
      expect(P.winG).toBe(grupoDe(P.winner, n));
    }
  });
});

describe("La Entrada: las cuadras", () => {
  it.each([2, 3, 4, 8, 18, 30, 50, 200])("con %i personas, cada fraternidad se queda una vez y entera, menos la del que gana", (n) => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const P = planEntrada(n, [Math.min(3, n - 1)], rngOf(seed));
      const enteras = P.arches.filter((a) => a.exit.kind === "frat");
      expect(enteras.length).toBe(P.frats.length - 1);
      expect(P.fratArches).toBe(enteras.length);
      expect(new Set(enteras.map((a) => a.exit.g)).size).toBe(enteras.length);
      expect(enteras.some((a) => a.exit.g === P.winG)).toBe(false);
      for (const a of enteras) expect([...a.exit.ids].sort()).toEqual([...(P.frats[a.exit.g]?.members ?? [])].sort());
      // Las fraternidades enteras primero; después, la última de a varios.
      const kinds = P.arches.map((a) => a.exit.kind);
      expect(kinds).toEqual([...kinds].sort((a, b) => (a === b ? 0 : a === "frat" ? -1 : 1)));
      for (const a of P.arches.filter((x) => x.exit.kind === "members")) {
        expect(a.exit.g).toBe(P.winG);
        expect(a.exit.ids.length).toBeGreaterThan(0);
        expect(a.exit.ids).not.toContain(P.winner);
        expect(a.exit.ids).not.toContain(P.rival);
      }
      // Al final quedan los dos del contrapunto.
      expect(quedan(P).sort()).toEqual(n >= 2 ? [P.winner, P.rival].sort() : [P.winner]);
      if (n >= 2) {
        expect(P.rival).not.toBe(P.winner);
        expect(grupoDe(P.rival, n)).toBe(P.winG);
      }
    }
  });

  it("los tiempos van para adelante, y cada arco tiene su momento", () => {
    for (const n of [2, 8, 18, 50, 200]) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const P = planEntrada(n, [Math.min(3, n - 1)], rngOf(seed));
        let t = P.T_GO;
        for (const a of P.arches) {
          expect(a.t).toBeGreaterThan(t);
          expect(a.tExit).toBeGreaterThanOrEqual(a.t);
          t = a.tExit;
        }
        expect(P.T_SOCAVON).toBeGreaterThan(t);
        let tj = P.T_SOCAVON;
        for (const j of P.jumps) {
          expect(j.t).toBeGreaterThan(tj);
          tj = j.t;
        }
        expect(P.T_CROWN).toBeGreaterThan(P.T_ARRIVE);
        // La presentación cubre a todas, una detrás de otra.
        expect(P.pres.map((p) => p.g)).toEqual(P.order);
        expect(P.pres.at(-1)?.t1).toBeCloseTo(P.T_GO);
      }
    }
  });

  it("dura lo que pide la ventana: ni tan corto que haya que estirarlo de más, ni tan largo", () => {
    const largo = (n: number): number => Math.max(...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => planEntrada(n, [3 % n], rngOf(s)).T_CROWN));
    const corto = (n: number): number => Math.min(...[1, 2, 3, 4, 5, 6, 7, 8].map((s) => planEntrada(n, [3 % n], rngOf(s)).T_CROWN));
    // "Normal" son 35 segundos de juego en la escena fija: el estirado va de 0,55 a 2,2.
    for (const n of [8, 18, 30, 50, 200]) {
      expect(corto(n)).toBeGreaterThanOrEqual(35 / 2.2);
      expect(largo(n)).toBeLessThanOrEqual(40);
    }
    expect(corto(2)).toBeGreaterThanOrEqual(9);
  });
});

describe("La Entrada: el contrapunto", () => {
  it("saltan alternados, el último salto del que pierde termina en el piso y el del que gana en la puerta", () => {
    for (const n of [2, 3, 8, 18, 200]) {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const P = planEntrada(n, [Math.min(3, n - 1)], rngOf(seed));
        const js = P.jumps;
        const fall = js.findIndex((j) => j.stumble === "fall");
        expect(js[fall]?.who).toBe(P.rival);
        expect(js.at(-1)).toMatchObject({ who: P.winner, final: true });
        for (let i = 1; i <= fall; i++) expect(js[i]?.who).not.toBe(js[i - 1]?.who);
        expect(js.filter((j) => j.stumble === "fall").length).toBe(1);
        expect(js.some((j) => j.stumble === "fall" && j.who === P.winner)).toBe(false);
      }
    }
  });

  it("con una sola persona no hay contrapunto, y llega igual", () => {
    const P = planEntrada(1, [0], rngOf(3));
    expect(P.rival).toBe(-1);
    expect(P.jumps).toEqual([]);
    expect(P.arches).toEqual([]);
    expect(P.T_CROWN).toBeGreaterThan(P.T_SOCAVON);
  });
});

describe("La Entrada: que no se aprenda", () => {
  const S = 600;
  const planes = (n: number): EntradaPlan[] => Array.from({ length: S }, (_, s) => planEntrada(n, [(s * 7 + 3) % n], rngOf(s + 1)));

  it("la fraternidad del que gana va en cualquier lugar del desfile, también a la cabeza", () => {
    const P = planes(50);
    const F = P[0]?.frats.length ?? 1;
    const lugares = Array.from({ length: F }, () => 0);
    for (const p of P) {
      const i = p.order.indexOf(p.winG);
      lugares[i] = (lugares[i] ?? 0) + 1;
    }
    for (const c of lugares) {
      expect(c / S).toBeGreaterThan(0.5 / F);
      expect(c / S).toBeLessThan(1.6 / F);
    }
  });

  it("y el que gana, en cualquier lugar de su fraternidad", () => {
    const P = planes(50);
    const lugares = [0, 0, 0, 0, 0];
    for (const p of P) {
      const i = p.frats[p.winG]?.members.indexOf(p.winner) ?? 0;
      lugares[i] = (lugares[i] ?? 0) + 1;
    }
    for (const c of lugares) expect(c / S).toBeGreaterThan(0.1);
  });

  it("de qué lado salta y quién salta primero, parejo", () => {
    const P = planes(18);
    const izquierda = P.filter((p) => p.side === -1).length / S;
    const primero = P.filter((p) => p.jumps[0]?.who === p.winner).length / S;
    expect(izquierda).toBeGreaterThan(0.4);
    expect(izquierda).toBeLessThan(0.6);
    expect(primero).toBeGreaterThan(0.4);
    expect(primero).toBeLessThan(0.6);
  });

  it("trastabillar le pasa a los dos, parejo, sin contar la caída final", () => {
    let gana = 0, pierde = 0;
    for (const p of planes(18)) {
      for (const j of p.jumps) {
        if (j.stumble !== "small" && j.stumble !== "big") continue;
        if (j.who === p.winner) gana++;
        else pierde++;
      }
    }
    expect(gana / pierde).toBeGreaterThan(0.75);
    expect(gana / pierde).toBeLessThan(1.33);
  });

  it("el amague de la remontada y el susto caen en el que gana lo que dice el azar, no más", () => {
    let fakeHits = 0, fakeEsperado = 0, scareHits = 0, scareEsperado = 0;
    for (const p of [...planes(18), ...planes(50)]) {
      const fk = p.twists.fake;
      if (fk && fk.ids.length > 1) {
        // Una fraternidad entera: la del que gana es una entre las que siguen.
        const gone = new Set(p.arches.slice(0, fk.arch + 1).filter((a) => a.exit.kind === "frat").map((a) => a.exit.g));
        const siguen = p.order.filter((g) => !gone.has(g)).length;
        fakeEsperado += 1 / siguen;
        if (fk.g === p.winG) fakeHits++;
      }
      const sc = p.twists.scare;
      if (sc && p.arches.some((a) => a.exit.kind === "members")) {
        const ultimo = p.arches.at(-1);
        const gone = new Set(p.arches.filter((a) => a !== ultimo).flatMap((a) => a.exit.ids));
        const bailan = (p.frats[p.winG]?.members ?? []).filter((i) => !gone.has(i)).length;
        scareEsperado += 1 / bailan;
        if (sc.who === p.winner) scareHits++;
      }
    }
    expect(fakeEsperado).toBeGreaterThan(10);
    expect(fakeHits).toBeLessThan(fakeEsperado * 1.6 + 6);
    expect(scareEsperado).toBeGreaterThan(10);
    expect(scareHits).toBeLessThan(scareEsperado * 1.6 + 6);
  });

  it("los cuatro arcos salen, y cada uno trae su giro", () => {
    const arcos = new Map<string, number>();
    for (const p of planes(18)) {
      arcos.set(p.arc, (arcos.get(p.arc) ?? 0) + 1);
      if (p.arc === "remontada") expect(p.twists.fake ?? p.jumps.some((j) => j.stumble === "big")).toBeTruthy();
      if (p.arc === "tapada") expect(p.twists.freeze).not.toBeNull();
      if (p.arc === "susto") expect(p.twists.scare).not.toBeNull();
      if (p.arc !== "tapada") expect(p.twists.freeze).toBeNull();
    }
    expect(arcos.size).toBe(4);
    for (const c of arcos.values()) expect(c / S).toBeLessThan(0.4);
  });
});

describe("La Entrada: varios premios sin mentir", () => {
  it("el co-ganador se va con premio, y del último premio al segundo", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const n = 18;
      const winners = [3, 8, 13];
      const P = planEntrada(n, winners, rngOf(seed));
      const premios = P.arches.reduce((a, x) => a + x.exit.prizes, 0);
      // Cada co-ganador sale en algún arco, con premio, salvo si es el del contrapunto.
      expect(premios + (winners.includes(P.rival) ? 1 : 0)).toBe(2);
      for (const a of P.arches) expect(a.exit.prizes).toBe(a.exit.ids.filter((i) => winners.slice(1).includes(i)).length);
    }
  });

  it("el otro del contrapunto no tiene premio, si se puede", () => {
    // Con 8 son dos fraternidades de cuatro: la del 1 tiene al 1, 3, 5 y 7.
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const P = planEntrada(8, [1, 3, 5], rngOf(seed));
      expect(P.rival).toBe(7);
      // Los premiados de la última fraternidad se quedan al final, el tercero antes que el segundo.
      const ultimos = P.arches.filter((a) => a.exit.kind === "members").flatMap((a) => a.exit.ids);
      expect(ultimos).toEqual([5, 3]);
    }
  });
});

describe("La Entrada: piezas", () => {
  it("la última fraternidad se queda de a varios, hasta que quedan dos", () => {
    expect(memberRounds(1)).toEqual([]);
    expect(memberRounds(2)).toEqual([]);
    expect(memberRounds(3)).toEqual([1]);
    expect(memberRounds(4)).toEqual([1, 1]);
    expect(memberRounds(5)).toEqual([2, 1]);
    expect(memberRounds(8)).toEqual([4, 2]);
    expect(memberRounds(20)).toEqual([10, 5, 3]);
    for (let s = 3; s <= 40; s++) expect(memberRounds(s).reduce((a, b) => a + b, 0)).toBe(s - 2);
  });

  it("cada fraternidad pasa frente al palco al menos 0,92 s", () => {
    for (let F = 1; F <= 10; F++) expect(presentationTime(F)).toBeGreaterThanOrEqual(0.92);
  });

  it("la misma ronda escribe el mismo plan", () => {
    expect(JSON.stringify(planEntrada(200, [3, 40], rngOf(9)))).toBe(JSON.stringify(planEntrada(200, [3, 40], rngOf(9))));
  });
});
