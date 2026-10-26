import { describe, expect, it } from "vitest";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

/**
 * `orden(t)` no mira a nadie: la ganadora está en la punta, en el medio o atrás
 * con la misma probabilidad que cualquiera de las que siguen. Se mide con
 * muchas rondas (el auditor de delatores hace lo mismo con 1.500).
 */
const RONDAS = 600;

function ronda(n: number, s: number): { d: Datos; gana: number } {
  const ctx = ctxDe(n, s);
  return { d: planCarrera(ctx).datos, gana: ctx.ganadores[0] as number };
}

/** Quiénes llevan la punta, en orden, mirando el orden de verdad hasta la última echada (cuenta también cuando quien la lleva se echa). */
function lideres(d: Datos): number[] {
  const out: number[] = [];
  for (let t = d.tSalida; t < d.tiempos.ultima; t += 0.05) {
    const l = d.orden.lider(t);
    if (out[out.length - 1] !== l) out.push(l);
  }
  return out;
}

describe("el orden del grupo: la punta cambia de dueña", () => {
  it("con 18 la punta cambia al menos tres veces, con tres dueñas distintas, en todas las rondas", () => {
    for (let s = 1; s <= 40; s++) {
      const { d } = ronda(18, s);
      const ls = lideres(d);
      expect(ls.length - 1, `semilla ${s}`).toBeGreaterThanOrEqual(3);
      expect(new Set(ls).size, `semilla ${s}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("con 12 a 30 hay cambios de punta y ninguno a menos de medio segundo del anterior", () => {
    for (const n of [12, 18, 24, 30]) {
      for (let s = 1; s <= 12; s++) {
        const { d } = ronda(n, s);
        expect(lideres(d).length - 1, `n=${n} semilla ${s}`).toBeGreaterThanOrEqual(2);
        d.orden.cambios.forEach((c, i) => {
          if (i) expect(c.t - (d.orden.cambios[i - 1] as { t: number }).t).toBeGreaterThanOrEqual(0.5 - 1e-9);
        });
      }
    }
  });

  it("la punta no parpadea: casi ningún tramo de líder dura menos de 0,6 s y las puntas que se anuncian se sostienen un segundo", () => {
    // Antes la que entraba y la que salía se cruzaban a la vez, y una tercera (el paseo pelado) se colaba unos décimos:
    // 14 a 15 de cada 100 tramos duraban menos de 0,6 s, y de las puntas anunciadas, 23 de cada 100 menos de 1 s.
    let tramos = 0, cortos = 0, anunciadas = 0;
    for (const n of [12, 18, 30]) {
      for (let s = 1; s <= 40; s++) {
        const { d } = ronda(n, s);
        let actual = d.orden.lider(d.tSalida), desde = d.tSalida;
        for (let t = d.tSalida; t <= d.tiempos.ultima; t += 0.05) {
          const l = d.orden.lider(t);
          if (l === actual) continue;
          tramos++;
          if (t - desde < 0.6) cortos++;
          actual = l;
          desde = t;
        }
        for (const c of d.orden.cambios) {
          anunciadas++;
          expect(d.orden.lider(c.t + 0.95), `n=${n} semilla ${s}, punta de ${c.quien} a los ${c.t.toFixed(2)} s`).toBe(c.quien);
        }
      }
    }
    expect(anunciadas).toBeGreaterThan(300);
    expect(cortos / tramos, `${cortos} de ${tramos}`).toBeLessThan(0.06);
  });

  it("es función pura del tiempo: el mismo instante da el mismo orden, vengamos de donde vengamos", () => {
    const { d } = ronda(18, 5);
    const t = d.tSalida + 9.3;
    const a = d.orden.en(t);
    d.orden.en(t + 4);
    d.orden.en(t - 3);
    expect(d.orden.en(t)).toEqual(a);
    expect(d.orden.lider(t)).toBe(a[0]);
  });

  it("las que se echaron no están en el orden, y el orden nunca repite a nadie", () => {
    const { d } = ronda(20, 9);
    for (let t = d.tSalida; t <= d.tAbre; t += 0.7) {
      const en = d.orden.en(t);
      expect(new Set(en).size).toBe(en.length);
      for (const e of d.tiempos.echadas) if (e.t <= t) expect(en).not.toContain(e.quien);
    }
  });
});

describe("el orden del grupo no delata (muchas rondas, 18 personas)", () => {
  const filas = Array.from({ length: RONDAS }, (_, i) => ronda(18, i + 1));

  it("la ganadora entra a la recta en un puesto parejo, uno de ocho", () => {
    const cuenta = new Array<number>(8).fill(0);
    for (const { d, gana } of filas) {
      const r = d.vivas(d.tAbre - 0.2).indexOf(gana);
      cuenta[r] = (cuenta[r] ?? 0) + 1;
    }
    const esperado = RONDAS / 8;
    const sd = Math.sqrt(RONDAS * (1 / 8) * (7 / 8));
    for (let r = 0; r < 8; r++) expect(Math.abs((cuenta[r] as number) - esperado), `puesto ${r + 1}: ${cuenta.join(",")}`).toBeLessThan(4 * sd);
  });

  it("a la mitad del grupo, la ganadora lleva la punta tanto como cualquiera de las que siguen (1 sobre las que quedan)", () => {
    let visto = 0, esperado = 0, varianza = 0;
    for (const { d, gana } of filas) {
      const t = (d.tSalida + d.tiempos.ultima) / 2;
      const m = d.orden.en(t).length;
      visto += d.orden.lider(t) === gana ? 1 : 0;
      // La ganadora sigue en carrera con todas las demás: la que lleva la punta es una de las que siguen, sin mirar quién es.
      esperado += 1 / m;
      varianza += (1 / m) * (1 - 1 / m);
    }
    expect(Math.abs(visto - esperado)).toBeLessThan(4 * Math.sqrt(varianza));
  });

  it("quien lleva la punta es finalista con la misma frecuencia que le toca por cantidad (8 sobre las que quedan)", () => {
    let visto = 0, esperado = 0, varianza = 0;
    for (const { d } of filas) {
      for (const f of [0.25, 0.5, 0.75]) {
        const t = d.tSalida + f * (d.tiempos.ultima - d.tSalida);
        const m = d.orden.en(t).length;
        visto += d.lanes.includes(d.orden.lider(t)) ? 1 : 0;
        esperado += d.lanes.length / m;
        varianza += (d.lanes.length / m) * (1 - d.lanes.length / m);
      }
    }
    expect(Math.abs(visto - esperado)).toBeLessThan(4 * Math.sqrt(varianza));
  });

  it("la ganadora lleva la punta alguna vez igual que otra finalista cualquiera (no hay 'la ganadora no lidera a la mitad')", () => {
    let gana = 0, otra = 0;
    for (const { d, gana: g } of filas) {
      const otras = d.lanes.filter((x) => x !== g);
      const lidero = new Set<number>();
      for (let t = d.tSalida; t <= d.tiempos.ultima; t += 0.5) lidero.add(d.orden.lider(t));
      gana += lidero.has(g) ? 1 : 0;
      otra += lidero.has(otras[0] as number) ? 1 : 0;
    }
    const p = (gana + otra) / (2 * RONDAS);
    const sd = Math.sqrt((2 * RONDAS * p * (1 - p)) / 1);
    expect(Math.abs(gana - otra), `${gana} contra ${otra}`).toBeLessThan(4 * sd * 0.75);
  });
});
