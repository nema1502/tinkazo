import { describe, expect, it, vi } from "vitest";
import { FUNDIDO_NOMBRE, NIVEL_ECHADA, formaEn, nivelGeneral, nivelPorVivas, nivelesDe, vivasEn } from "./carrera-nombre-nivel";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

/**
 * La forma del nombre de cada ficha es función de la hora del show: el nivel de todas cambia solo en horas que el plan conoce (cuando
 * cambia cuántas siguen en carrera) y en cada una el nombre se funde en `FUNDIDO_NOMBRE` segundos, en vez de cambiar de golpe.
 */

vi.setConfig({ testTimeout: 600_000 });

const TAMANOS = [8, 18, 60];
const SEMILLAS = [1, 2, 3, 4];
const FPS = 60;

function datosDe(n: number, s: number, nueva = false): Datos {
  return planCarrera(ctxDe(n, s), { nueva }).datos;
}

describe("el nivel de los nombres, por hora", () => {
  for (const nueva of [false, true]) {
    for (const n of TAMANOS) {
      it(`${nueva ? "nueva" : "de siempre"}, ${n} personas: el nivel sale de las horas del plan y es el de la cuenta de las que siguen`, () => {
        for (const s of nueva ? SEMILLAS.slice(0, 2) : SEMILLAS) {
          const d = datosDe(n, s, nueva);
          const niv = nivelesDe(d);
          // En cada cuadro del show, y justo antes y después de cada echada, el nivel de las horas del plan es el de la cuenta.
          const horas = Array.from({ length: Math.ceil((d.tCrown + 1) * FPS) }, (_, i) => i / FPS);
          for (const e of d.tiempos.echadas) horas.push(e.t - 1e-4, e.t, e.t + 1e-4);
          for (const t of horas) expect(nivelGeneral(niv, t), `${n} personas, semilla ${s}, t=${t.toFixed(4)}`).toBe(nivelPorVivas(vivasEn(d, t)));
          // Cada cambio cae en una echada, en la salida o cuando se abre la recta: horas que el plan ya conoce, nunca por quién.
          const conocidas = new Set([d.tSalida, d.tAbre, ...d.tiempos.echadas.map((e) => e.t)]);
          for (const c of niv.cambios) expect(conocidas.has(c.t)).toBe(true);
          // Dos cambios nunca se pisan: el fundido de uno termina antes del siguiente.
          niv.cambios.forEach((c, i) => {
            const sig = niv.cambios[i + 1];
            if (sig) expect(sig.t - c.t).toBeGreaterThan(FUNDIDO_NOMBRE);
          });
        }
      });
    }
  }

  it("con 18 personas el nombre pasa del de pila a la inicial del apellido y después al entero: dos cambios, fundidos", () => {
    for (const s of SEMILLAS) {
      const niv = nivelesDe(datosDe(18, s));
      expect(niv.inicial).toBe(2);
      expect(niv.cambios.map((c) => [c.de, c.a])).toEqual([[2, 3], [3, 4]]);
      for (const c of niv.cambios) {
        expect(formaEn(niv, c.t - 1 / FPS)).toEqual({ de: c.de, a: c.de, mezcla: 1 });
        expect(formaEn(niv, c.t)).toEqual({ de: c.de, a: c.a, mezcla: 0 });
        const medio = formaEn(niv, c.t + FUNDIDO_NOMBRE / 2);
        expect(medio.mezcla).toBeCloseTo(0.5, 9);
        expect(formaEn(niv, c.t + FUNDIDO_NOMBRE)).toEqual({ de: c.a, a: c.a, mezcla: 1 });
      }
    }
  });

  it("la que se echa funde su nombre desde la hora en que se echa, aunque en esa hora cambie el de todas", () => {
    const niv = { inicial: 2 as const, cambios: [{ t: 10, de: 2 as const, a: 3 as const }, { t: 20, de: 3 as const, a: 4 as const }] };
    // Se echa en la misma hora en que cambia el de todas: su nombre va del de pila al suyo de echada.
    expect(formaEn(niv, 10, 10)).toEqual({ de: 2, a: NIVEL_ECHADA, mezcla: 0 });
    // Se echa con el nivel de todas igual al suyo: no cambia nada.
    expect(formaEn(niv, 15, 15)).toEqual({ de: 3, a: 3, mezcla: 1 });
    // Echada, no sigue al de todas.
    expect(formaEn(niv, 20.1, 15)).toEqual({ de: 3, a: 3, mezcla: 1 });
    // Se echa con el nombre entero: va al suyo de echada fundiéndose.
    const f = formaEn(niv, 30 + FUNDIDO_NOMBRE / 2, 30);
    expect([f.de, f.a]).toEqual([4, NIVEL_ECHADA]);
    expect(f.mezcla).toBeCloseTo(0.5, 9);
  });
});
