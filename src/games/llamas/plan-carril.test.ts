import { describe, expect, it } from "vitest";
import { sembrar } from "../pixi/kit/azar";
import { ctxDe } from "./carrera-prueba";
import { planCarrera } from "./carrera-show";
import { planRace } from "./plan";

/**
 * El carril de la ganadora con pocas personas (`carrilParejo` en `plan.ts`).
 *
 * Los carriles se barajan con el azar de la ronda: la ganadora cae en cualquiera, una vez de cada L. En la tapada la historia juntaba a
 * las dos rivales en carriles vecinos, cambiando de carril a la que estaba al lado de una de ellas, y a veces esa era la ganadora. Con
 * tres carriles, en la tapada nunca corría en el del medio: medido con 1.500 rondas, la del carril del medio ganaba el 23 % de las
 * veces y no el 33 %. Ahora, con la marcha pareja (`SENUELOS`) y menos de ocho carriles, la ganadora se queda en el carril que le tocó al
 * barajar. Con ocho carriles (ocho personas o más) no cambia nada, y con el interruptor apagado tampoco (la huella).
 */

const nombres = (n: number): string[] => Array.from({ length: n }, (_, i) => `Persona ${i + 1}`);

/** Un azar que primero devuelve los números dados y después sigue con uno sembrado. */
function guionado(primeros: readonly number[], semilla: number): () => number {
  const resto = sembrar(semilla);
  let i = 0;
  return () => (i < primeros.length ? (primeros[i++] as number) : resto());
}

/** El número del azar que hace que `Math.floor(v * m)` dé `j`. */
const elige = (j: number, m: number): number => (j + 0.5) / m;

/** Todas las barajadas de `len` elementos (Fisher-Yates, de `len − 1` hasta 1), cada una como sus números del azar. Son `len!`, todas igual de probables. */
function barajadas(len: number): number[][] {
  let todas: number[][] = [[]];
  for (let i = len - 1; i > 0; i--) todas = todas.flatMap((antes) => Array.from({ length: i + 1 }, (_, j) => [...antes, elige(j, i + 1)]));
  return todas;
}

/** Un azar sembrado que anota cada número que da. */
function anotado(semilla: number): { rng: () => number; vistos: number[] } {
  const base = sembrar(semilla);
  const vistos: number[] = [];
  return { rng: () => { const v = base(); vistos.push(v); return v; }, vistos };
}

/**
 * El carril que le toca a la ganadora al barajar (`planRace`): primero se barajan las otras `n − 1` personas (`n − 2` números), después
 * los `L` carriles, con la ganadora primera en la lista.
 */
function carrilBarajado(vistos: readonly number[], n: number, L: number): number {
  let k = 0;
  for (let i = L - 1, v = Math.max(0, n - 2); i > 0; i--, v++) {
    const j = Math.floor((vistos[v] as number) * (i + 1));
    if (k === i) k = j;
    else if (k === j) k = i;
  }
  return k;
}

describe("el carril de la ganadora con pocas personas", () => {
  for (const L of [3, 4, 5]) {
    it(`en la tapada con ${L} carriles, contando todas las barajadas, la ganadora corre en cada carril exactamente una vez de cada ${L}`, () => {
      const cuenta = new Array(L).fill(0);
      const deLasOtras = new Array(Math.max(0, L - 2)).fill(0.5);
      let total = 0;
      for (const carriles of barajadas(L)) {
        for (const rivales of barajadas(L - 1)) {
          // Las otras personas, los carriles, las rivales de la historia y el arco: el cuarto, la tapada.
          const rng = guionado([...deLasOtras, ...carriles, ...rivales, elige(3, 4)], 7 * total + 1);
          const p = planRace(nombres(L), 0, rng, { entradaPareja: true, carrilParejo: true });
          expect(p.story.arc).toBe("tapada");
          cuenta[p.lanes.indexOf(0)]++;
          total++;
        }
      }
      expect(cuenta).toEqual(new Array(L).fill(total / L));
    });
  }

  it("con 2 a 7 personas la ganadora se queda en el carril que le tocó al barajar, en cualquier historia", () => {
    const arcos: Record<string, number> = {};
    for (let n = 2; n <= 7; n++) {
      for (let s = 1; s <= 120; s++) {
        const { rng, vistos } = anotado(s * 7919 + n);
        const w = (s * 5) % n;
        const p = planRace(nombres(n), w, rng, { entradaPareja: true, carrilParejo: true, ...(s % 4 === 0 ? { co: [(w + 1) % n] } : {}) });
        const k = carrilBarajado(vistos, n, n);
        expect(p.lanes.indexOf(w), `n ${n}, semilla ${s}, ${p.story.arc}`).toBe(k);
        expect(p.story.winner).toBe(k);
        arcos[p.story.arc] = (arcos[p.story.arc] ?? 0) + 1;
      }
    }
    expect(arcos.tapada).toBeGreaterThan(100);
  });

  it("la carrera de 2 a 7 personas deja a la ganadora en el carril que le tocó al barajar; con el interruptor apagado, la tapada la sigue moviendo", () => {
    let movidas = 0;
    for (let n = 2; n <= 7; n++) {
      for (let s = 1; s <= 30; s++) {
        for (const senuelos of [true, false]) {
          const ctx = ctxDe(n, s);
          const vistos: number[] = [];
          const rng = (): number => { const v = ctx.rng(); vistos.push(v); return v; };
          const d = planCarrera({ ...ctx, rng }, { senuelos }).datos;
          const w = ctx.ganadores[0] as number;
          const quedo = d.lanes.indexOf(w) === carrilBarajado(vistos, n, n);
          if (senuelos) expect(quedo, `n ${n}, semilla ${s}, ${d.final.story.arc}`).toBe(true);
          else if (!quedo) movidas++;
        }
      }
    }
    expect(movidas).toBeGreaterThan(0);
  }, 300_000);

  it("con ocho carriles (8 personas o más) los carriles y la historia no cambian", () => {
    for (const n of [8, 9, 12]) {
      for (let s = 1; s <= 80; s++) {
        const a = planRace(nombres(n), s % n, sembrar(s * 31 + n), { entradaPareja: true, carrilParejo: true });
        const b = planRace(nombres(n), s % n, sembrar(s * 31 + n), { entradaPareja: true });
        expect(a.lanes).toEqual(b.lanes);
        expect(a.story).toEqual(b.story);
      }
    }
  });
});
