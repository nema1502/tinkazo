import { describe, expect, it } from "vitest";
import { alfabetico } from "./carrera-base";
import { ctxDe, nombresDe } from "./carrera-prueba";
import { duracionNominal, planCarrera, FINALISTAS, FIJOS, TARJETA } from "./carrera-show";
import { CARTEL_S, SALIDA_PORTON, TANDA_MAX, grupoDeTandas, pasanPorTanda, tandasPara } from "./carrera-tandas";

const TAMANOS = [31, 40, 50, 60, 75, 100, 150, 160, 175, 200];

describe("las tandas: de 31 a 200 se arman series que se juntan", () => {
  it("hay tandas de 25 o menos, parejas (±1) y todas pasan lo mismo", () => {
    for (const n of TAMANOS) {
      const T = tandasPara(n);
      // Las justas para que ninguna pase de 25; de 151 a 175, ocho más chicas (con siete no entra en los 90 s).
      expect(T).toBe(n > 150 && n <= 175 ? 8 : Math.ceil(n / TANDA_MAX));
      for (let s = 1; s <= 15; s++) {
        const { tandas, gente } = planCarrera(ctxDe(n, s)).datos as unknown as { tandas: { miembros: number[]; pasan: number[]; noPasan: number[] }[]; gente: number[] };
        expect(tandas).toHaveLength(T);
        const tam = tandas.map((t) => t.miembros.length);
        expect(Math.max(...tam)).toBeLessThanOrEqual(TANDA_MAX);
        expect(Math.max(...tam) - Math.min(...tam)).toBeLessThanOrEqual(1);
        expect(new Set(tandas.map((t) => t.pasan.length)).size, `n=${n}`).toBe(1);
        expect(tandas[0]?.pasan.length).toBe(pasanPorTanda(n));
        expect(gente).toHaveLength(grupoDeTandas(n));
        // Cada una está en una tanda, una sola vez.
        const todas = tandas.flatMap((t) => t.miembros);
        expect(new Set(todas).size).toBe(n);
        for (const t of tandas) expect([...t.pasan, ...t.noPasan].sort((a, b) => a - b)).toEqual([...t.miembros].sort((a, b) => a - b));
      }
    }
  });

  it("pasan todas las finalistas, y ninguna tanda tiene más finalistas que plazas", () => {
    for (const n of TAMANOS) {
      for (let s = 1; s <= 25; s++) {
        const d = planCarrera(ctxDe(n, s)).datos;
        for (const l of d.lanes) expect(d.gente, `n=${n} s=${s}`).toContain(l);
        for (const t of d.tandas) expect(t.pasan.filter((p) => d.lanes.includes(p)).length).toBeLessThanOrEqual(t.pasan.length);
      }
    }
  });

  it("el cartel dura CARTEL_S o más, los nombres van en orden alfabético y el portón saca de a una, a SALIDA_PORTON", () => {
    for (const n of TAMANOS) {
      const ctx = ctxDe(n, 4);
      const d = planCarrera(ctx).datos;
      d.tandas.forEach((t, i) => {
        expect(t.miembros).toEqual(alfabetico(nombresDe(n), t.miembros));
        expect(t.salidas[0]).toBeGreaterThanOrEqual(t.t0 + CARTEL_S - 1e-9);
        t.salidas.forEach((x, j) => {
          if (j) expect(x - (t.salidas[j - 1] as number)).toBeGreaterThanOrEqual(SALIDA_PORTON - 1e-9);
        });
        // El cartel sigue mientras corre su tanda: de t0 al cierre pasan más de 3 s.
        expect(t.tCierra - t.t0).toBeGreaterThanOrEqual(CARTEL_S);
        if (i) expect(t.t0).toBeCloseTo((d.tandas[i - 1] as { tFin: number }).tFin, 9);
      });
      expect(d.tSalida).toBeGreaterThan((d.tandas.at(-1) as { tCierra: number }).tCierra + 1);
    }
  });

  it("con tandas el show dura lo que dice normalCarrera, y nunca más de 90 s", () => {
    for (const n of TAMANOS) {
      const d = planCarrera(ctxDe(n, 3)).datos;
      expect(Math.abs(d.tCrown - duracionNominal(n)), `n=${n}`).toBeLessThan(1.2);
      expect(duracionNominal(n) + FIJOS + TARJETA, `n=${n}`).toBeLessThanOrEqual(90);
    }
  });

  it("con 200 pasa una por tanda y el grupo son las ocho de la final: no hay a quién echar", () => {
    expect(pasanPorTanda(200)).toBe(1);
    const d = planCarrera(ctxDe(200, 2)).datos;
    expect(d.gente).toHaveLength(FINALISTAS);
    expect(d.tiempos.echadas).toHaveLength(0);
    expect([...d.gente].sort((a, b) => a - b)).toEqual([...d.lanes].sort((a, b) => a - b));
  });
});

describe("las tandas no delatan (600 rondas)", () => {
  for (const n of [60, 100, 200]) {
    it(`con ${n}: la ganadora sale de cualquier tanda y por cualquier lugar del portón con la misma frecuencia`, () => {
      const T = tandasPara(n);
      const p = pasanPorTanda(n);
      const RONDAS = 600;
      const porTanda = new Array<number>(T).fill(0);
      const porSalida = new Array<number>(p).fill(0);
      const finalistasPorTanda = new Array<number>(T).fill(0);
      for (let s = 1; s <= RONDAS; s++) {
        const ctx = ctxDe(n, s);
        const d = planCarrera(ctx).datos;
        const h = d.tandas.findIndex((x) => x.pasan.includes(ctx.ganadores[0] as number));
        porTanda[h] = (porTanda[h] ?? 0) + 1;
        const j = (d.tandas[h] as { pasan: number[] }).pasan.indexOf(ctx.ganadores[0] as number);
        porSalida[j] = (porSalida[j] ?? 0) + 1;
        d.tandas.forEach((x, i) => (finalistasPorTanda[i] = (finalistasPorTanda[i] ?? 0) + x.pasan.filter((q) => d.lanes.includes(q)).length));
      }
      const sdT = Math.sqrt(RONDAS * (1 / T) * (1 - 1 / T));
      for (let i = 0; i < T; i++) expect(Math.abs((porTanda[i] as number) - RONDAS / T), `tanda ${i + 1}: ${porTanda.join(",")}`).toBeLessThan(4 * sdT);
      const sdS = Math.sqrt(RONDAS * (1 / p) * (1 - 1 / p));
      for (let j = 0; j < p; j++) expect(Math.abs((porSalida[j] as number) - RONDAS / p), `salida ${j + 1}: ${porSalida.join(",")}`).toBeLessThan(4 * sdS + 1e-9);
      // Cuántas finalistas pasan por cada tanda: parejo (las plazas son iguales, nada hace de una tanda "la de las finalistas").
      const media = finalistasPorTanda.reduce((a, b) => a + b, 0) / T;
      for (let i = 0; i < T; i++) expect(Math.abs((finalistasPorTanda[i] as number) - media), `finalistas por tanda: ${finalistasPorTanda.join(",")}`).toBeLessThan(0.12 * media + 4 * Math.sqrt(media));
    });
  }
});
