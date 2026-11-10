import { describe, expect, it, vi } from "vitest";
import { CARA_FUNDIDO, alfasCara, cambiosDeCara, caraEn, cuantoCara, ponerCaras, quienDeCara, type SpriteCara } from "./carrera-cara";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

/**
 * La cara del cursor de la cinta es función de la hora del show: la misma hora da la misma cara llegando cuadro por cuadro,
 * saltando directo o yendo hacia atrás. Cuando la marca pasa a otra, la cara vieja se va mientras la nueva llega y el ícono
 * nunca queda vacío (antes quedaba un cuadro en el aro amarillo liso).
 */

vi.setConfig({ testTimeout: 600_000 });

const TAMANOS = [8, 18, 60];
const SEMILLAS = [1, 2, 3, 4, 5];
const FPS = 60;

const planes = new Map<string, Datos>();
function datosDe(n: number, s: number, nueva = false): Datos {
  const k = `${n}|${s}|${nueva}`;
  let d = planes.get(k);
  if (!d) planes.set(k, (d = planCarrera(ctxDe(n, s), { nueva }).datos));
  return d;
}

/** Un sprite de mentira: guarda la textura (el número de la persona) y cuenta cuántas veces se la cambian. */
function sprite(): SpriteCara<number> & { cambios: number } {
  let tx = -1;
  const s = {
    cambios: 0,
    alpha: 1,
    visible: true,
    width: 0,
    height: 0,
    get texture(): number {
      return tx;
    },
    set texture(v: number) {
      tx = v;
      s.cambios++;
    },
  };
  return s;
}

/** Lo que el cursor dibuja en `t` con estos dos sprites (el de abajo primero): solo lo que se ve. */
function dibujado(d: Datos, t: number, sale: SpriteCara<number>, entra: SpriteCara<number>): string {
  ponerCaras(sale, entra, caraEn(t, quienDeCara(d), cambiosDeCara(d)), cuantoCara(d, t), (i) => i, 10);
  return [sale, entra].filter((s) => s.visible).map((s) => `${s.texture}@${s.alpha.toFixed(9)}`).join(" ");
}

/** Las horas de los cuadros de todo el show, a 60 por segundo, hasta un poco después de la meta. */
const cuadros = (d: Datos): number[] => Array.from({ length: Math.ceil((d.tCrown + 1) * FPS) }, (_, i) => i / FPS);

describe("la cara de la cinta, pura", () => {
  for (const nueva of [false, true]) {
    for (const n of TAMANOS) {
      it(`${nueva ? "nueva" : "de siempre"}, ${n} personas: cuadro por cuadro, saltando y hacia atrás dan la misma cara`, () => {
        for (const s of nueva ? SEMILLAS.slice(0, 2) : SEMILLAS) {
          const d = datosDe(n, s, nueva);
          const ts = cuadros(d);
          // Cuadro por cuadro, con los mismos sprites todo el show.
          const a = { sale: sprite(), entra: sprite() };
          const seguido = ts.map((t) => dibujado(d, t, a.sale, a.entra));
          // Hacia atrás, desde el final, con otros sprites.
          const b = { sale: sprite(), entra: sprite() };
          const atras = [...ts].reverse().map((t) => dibujado(d, t, b.sale, b.entra)).reverse();
          expect(atras).toEqual(seguido);
          // Saltando directo a cada hora, con sprites nuevos (cada décimo cuadro y todos los de alrededor de cada marca).
          const muestras = new Set<number>(ts.filter((_, i) => i % 10 === 0).map((t) => Math.round(t * FPS)));
          for (const m of d.marcas) for (let j = -3; j <= CARA_FUNDIDO * FPS + 3; j++) muestras.add(Math.round(m.t * FPS) + j);
          for (const i of muestras) {
            if (i < 0 || i >= ts.length) continue;
            const t = ts[i] as number;
            expect(dibujado(d, t, sprite(), sprite()), `${n} personas, semilla ${s}, t=${t.toFixed(3)}`).toBe(seguido[i]);
          }
          // Y saltando de una hora cualquiera a otra con los mismos sprites (dos caminos a la misma hora).
          const c = { sale: sprite(), entra: sprite() };
          for (let k = 0; k < 200; k++) {
            const i = (k * 7919) % ts.length;
            expect(dibujado(d, ts[i] as number, c.sale, c.entra)).toBe(seguido[i]);
          }
        }
      });
    }
  }

  for (const n of TAMANOS) {
    it(`de siempre, ${n} personas: cuando la marca pasa a otra, las dos caras se cruzan y la opacidad nunca baja de 0,5`, () => {
      let cruces = 0;
      for (const s of SEMILLAS) {
        const d = datosDe(n, s);
        const quien = quienDeCara(d);
        for (const m of d.marcas) {
          if (quien(m.t - 1e-6) === quien(m.t)) continue;
          const sale = sprite(), entra = sprite();
          let ambas = false;
          for (let t = m.t - 0.1; t <= m.t + CARA_FUNDIDO + 0.1; t += 1 / 240) {
            const cuanto = cuantoCara(d, t);
            if (cuanto < 1) continue;
            dibujado(d, t, sale, entra);
            // La opacidad de lo que tapa el aro amarillo: una cara encima de la otra.
            const a1 = sale.visible ? sale.alpha : 0, a2 = entra.visible ? entra.alpha : 0;
            const total = 1 - (1 - a1) * (1 - a2);
            expect(total, `${n} personas, semilla ${s}, marca en ${m.t.toFixed(2)}, t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(0.5);
            if (sale.visible && entra.visible && sale.texture !== entra.texture) ambas = true;
          }
          // La vieja se va mientras la nueva llega: a mitad del cruce se ven las dos.
          if (d.cursor(m.t + CARA_FUNDIDO / 2) >= 1 && !(d.tandas.length && m.t <= d.tSalida)) {
            expect(ambas, `${n} personas, semilla ${s}, marca en ${m.t.toFixed(2)}`).toBe(true);
            cruces++;
          }
        }
      }
      expect(cruces).toBeGreaterThan(0);
    });
  }

  it("la textura se toca solo cuando cambia de quién es la cara, no en cada cuadro", () => {
    const d = datosDe(18, 1);
    const sale = sprite(), entra = sprite();
    for (const t of cuadros(d)) dibujado(d, t, sale, entra);
    // Cada cambio de cara pone la textura una vez en cada sprite como mucho, más la primera.
    const cambios = cambiosDeCara(d).length;
    expect(entra.cambios).toBeLessThanOrEqual(cambios + 2);
    expect(sale.cambios).toBeLessThanOrEqual(cambios + 1);
  });

  it("fuera de un cruce, una sola cara; en el cruce, la de abajo entera y la de arriba entrando", () => {
    const quien = (t: number): number => (t < 5 ? 1 : 2);
    expect(caraEn(4.9, quien, [5])).toEqual({ sale: 1, entra: 1, mezcla: 1 });
    const medio = caraEn(5 + CARA_FUNDIDO / 2, quien, [5]);
    expect(medio.sale).toBe(1);
    expect(medio.entra).toBe(2);
    expect(medio.mezcla).toBeCloseTo(0.5, 9);
    expect(caraEn(5 + CARA_FUNDIDO, quien, [5])).toEqual({ sale: 2, entra: 2, mezcla: 1 });
    // Una marca que no cambia de dueña no hace nada.
    expect(caraEn(5.1, () => 3, [5])).toEqual({ sale: 3, entra: 3, mezcla: 1 });
  });

  for (const n of [31, 60, 100]) {
    it(`con tandas, ${n} personas: la cara entra en ${CARA_FUNDIDO} s desde la salida, sin saltos de más de 0,1 entre dos cuadros`, () => {
      for (const s of SEMILLAS.slice(0, 3)) {
        const d = datosDe(n, s);
        expect(d.tandas.length).toBeGreaterThan(0);
        const sale = sprite(), entra = sprite();
        const total = (t: number): number => {
          dibujado(d, t, sale, entra);
          const a1 = sale.visible ? sale.alpha : 0, a2 = entra.visible ? entra.alpha : 0;
          return 1 - (1 - a1) * (1 - a2);
        };
        let previo = total(d.tSalida - 1);
        for (let t = d.tSalida - 1 + 1 / FPS; t <= d.tSalida + 1; t += 1 / FPS) {
          const v = total(t);
          expect(Math.abs(v - previo), `${n} personas, semilla ${s}, t=${t.toFixed(3)}`).toBeLessThanOrEqual(0.1);
          previo = v;
        }
        expect(total(d.tSalida - 1 / FPS)).toBe(0);
        expect(total(d.tSalida)).toBeLessThan(0.05);
      }
    });
  }

  it("la opacidad compuesta de las dos caras coincide con lo que señala la cinta, para toda mezcla y todo cuanto", () => {
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 100; j++) {
        const cuanto = i / 20, mezcla = j / 100;
        const a = alfasCara({ sale: 1, entra: 2, mezcla }, cuanto);
        const total = 1 - (1 - a.sale) * (1 - a.entra);
        expect(Math.abs(total - cuanto), `cuanto ${cuanto}, mezcla ${mezcla}`).toBeLessThan(0.01);
        expect(a.sale).toBeGreaterThanOrEqual(0);
        expect(a.sale).toBeLessThanOrEqual(1);
      }
    }
    expect(alfasCara({ sale: 1, entra: 2, mezcla: 0.5 }, 1).sale).toBe(1);
  });
});
