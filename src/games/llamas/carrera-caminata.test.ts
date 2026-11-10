import { describe, expect, it } from "vitest";
import { CAMINATA, LLEGADA_TARDE, TOPES_TROTE, perfil, trazar } from "./carrera-caminata";
import { DT, PANTALLAS_ANCHAS, PANTALLAS_ANGOSTAS, medirCaminata } from "./carrera-caminata-datos";
import type { Pantalla } from "./carrera-forma";
import { ctxDe } from "./carrera-prueba";
import { planCarrera } from "./carrera-show";

/**
 * La caminata de las que pasan por el portón, medida en cuerpos (el 3,9 % del ancho) respecto del corral, a 60 cuadros por segundo, con la
 * geometría de verdad de varias pantallas y sin navegador. Los topes salen de la dirección de la carrera (M1 y M2): 0,03 cuerpos por cuadro, un cuerpo por
 * segundo y 1,2 de aceleración. Vale para la pantalla acostada (la del proyector y la del escritorio); en el celular parado el ancho es chico
 * y un cuerpo mide 15 píxeles, así que ahí se mide en largos de llama (ver `docs/juegos/carrera.md`).
 */
describe("la caminata: el perfil y el camino", () => {
  it("el perfil arranca y frena de a poco, sin pasar del tope, y recorre el largo justo", () => {
    for (const largo of [0.5, 3, 12, 20]) {
      const p = perfil(largo);
      expect(p.recorrido(0)).toBe(0);
      expect(p.recorrido(p.duracion)).toBeCloseTo(largo, 9);
      let anterior = 0, v0 = 0;
      for (let t = DT; t <= p.duracion; t += DT) {
        const r = p.recorrido(t);
        const v = (r - anterior) / DT;
        expect(v).toBeLessThanOrEqual(CAMINATA.velocidad + 1e-6);
        expect(Math.abs(v - v0) / DT).toBeLessThanOrEqual(CAMINATA.aceleracion + 1e-6);
        anterior = r;
        v0 = v;
      }
    }
  });

  it("el camino por los tres puntos pasa por ellos, avanza siempre hacia adelante y no tiene esquinas", () => {
    const c = trazar([{ x: 0, y: 300 }, { x: 100, y: 40 }, { x: 400, y: 320 }]);
    const ini = c.en(0), fin = c.en(c.largo);
    expect([ini.x, ini.y]).toEqual([0, 300]);
    expect(fin.x).toBeCloseTo(400, 6);
    expect(fin.y).toBeCloseTo(320, 6);
    let anterior = c.en(0), giroMax = 0, dirPrev = 0;
    for (let s = 1; s <= c.largo; s += 1) {
      const p = c.en(s);
      expect(p.x).toBeGreaterThanOrEqual(anterior.x - 1e-9);
      const dir = Math.atan2(p.y - anterior.y, p.x - anterior.x);
      if (s > 1) giroMax = Math.max(giroMax, Math.abs(dir - dirPrev));
      dirPrev = dir;
      anterior = p;
    }
    // Un giro de menos de nueve grados por píxel: una curva y no una esquina.
    expect(giroMax).toBeLessThan(0.16);
  });
});

describe("la caminata: las que pasan por el portón", () => {
  for (const [nombre, P] of PANTALLAS_ANCHAS) {
    for (const n of [31, 34, 40, 60, 100, 200]) {
      it(`${nombre}, ${n} personas, 8 semillas: ninguna pasa de 0,03 cuerpos por cuadro, de 1,5 cuerpos por segundo ni de 1,2 de aceleración, todas trotan con su causa a la vista y llegan antes de que se eche la primera`, () => {
        const peor = { paso: 0, vel: 0, acel: 0, tarde: -Infinity };
        const echadas: number[] = [];
        for (let s = 1; s <= 8; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const m = medirCaminata(d, P);
          expect(m.caminan, `semilla ${s}`).toBe(d.gente.length);
          // Cada una que trota tiene su causa, anunciada medio segundo antes de pasar de 1 cuerpo por segundo.
          const trotes = d.causas.filter((c) => c.tipo === "trote");
          expect(trotes, `semilla ${s}`).toHaveLength(d.gente.length);
          for (const c of trotes) expect(c.desde - c.aviso, `semilla ${s}`).toBeGreaterThanOrEqual(0.3);
          if (!m.antesDeEchada) echadas.push(s);
          peor.paso = Math.max(peor.paso, m.paso);
          peor.vel = Math.max(peor.vel, m.vel);
          peor.acel = Math.max(peor.acel, m.acel);
          peor.tarde = Math.max(peor.tarde, m.tarde);
        }
        const que = `paso ${peor.paso.toFixed(3)}, velocidad ${peor.vel.toFixed(2)}, aceleración ${peor.acel.toFixed(2)}, llega ${peor.tarde.toFixed(1)} s después de la salida`;
        expect(echadas, `llegan después de que se eche la primera; ${que}`).toEqual([]);
        expect(peor.paso, que).toBeLessThanOrEqual(0.03);
        expect(peor.vel, que).toBeLessThanOrEqual(TOPES_TROTE.velocidad * 1.06);
        expect(peor.acel, que).toBeLessThanOrEqual(TOPES_TROTE.aceleracion * 1.06);
        expect(peor.tarde, que).toBeLessThanOrEqual(LLEGADA_TARDE);
      });
    }
  }
});

/**
 * De 76 a 100 y de 126 a 200 personas el grupo son las ocho de la final y nadie se echa: la recta se abre en la salida, con las últimas en pasar
 * por el portón todavía caminando al corral. Lo que les falta caminar se suma a su lugar también en la recta, así que pasan del corral a su carril
 * sin saltar (M1 de la dirección de la carrera, la regla que mide `scripts/audit-tacto.mjs`).
 */
describe("la caminata y la recta que se abre en la salida", () => {
  const TAMANOS_SIN_ECHADAS = [76, 90, 100, 126, 150, 200];
  const casos: [string, Pantalla, number][] = [...PANTALLAS_ANCHAS.map(([nombre, P]): [string, Pantalla, number] => [nombre, P, 0.03]), ...PANTALLAS_ANGOSTAS.map(([nombre, P]): [string, Pantalla, number] => [nombre, P, 0.03 * 1.5])];
  for (const [nombre, P, tope] of casos) {
    it(`${nombre}: con ${TAMANOS_SIN_ECHADAS.join(", ")} personas y 6 semillas, ninguna se corre más de ${tope.toFixed(3)} cuerpos por cuadro del corral a su carril`, () => {
      let conRectaAbierta = 0;
      for (const n of TAMANOS_SIN_ECHADAS) {
        for (let s = 1; s <= 6; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const m = medirCaminata(d, P);
          const que = `n=${n} semilla ${s}: respecto del frente ${m.pasoFrente.toFixed(4)} cuerpos por cuadro, ${m.velFrente.toFixed(2)} por segundo y ${m.acelFrente.toFixed(2)} de aceleración, llega ${m.tarde.toFixed(1)} s después de la salida`;
          // Es el caso que se mide: nadie se echa y la recta se abre en la salida.
          expect(d.tiempos.echadas, que).toHaveLength(0);
          expect(d.tAbre, que).toBeCloseTo(d.tSalida, 9);
          if (m.tarde > 0) conRectaAbierta++;
          expect(m.pasoFrente, que).toBeLessThanOrEqual(tope);
        }
      }
      // Y en algunas la última llega con la recta ya abierta (en todas las pantallas de la lista pasa).
      expect(conRectaAbierta).toBeGreaterThan(0);
    });
  }
});

describe("la caminata en pantallas angostas", () => {
  for (const [nombre, P] of PANTALLAS_ANGOSTAS) {
    for (const n of [34, 60, 200]) {
      it(`${nombre}, ${n} personas: llegan antes de que se eche la primera, sin saltos y sin pasar de dos cuerpos por segundo`, () => {
        for (let s = 1; s <= 8; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const m = medirCaminata(d, P);
          const que = `semilla ${s}: paso ${m.paso.toFixed(3)}, velocidad ${m.vel.toFixed(2)}, llega ${m.tarde.toFixed(1)} s después de la salida`;
          expect(m.antesDeEchada, que).toBe(true);
          expect(m.tarde, que).toBeLessThanOrEqual(LLEGADA_TARDE);
          expect(m.paso, que).toBeLessThanOrEqual(0.03 * 1.5);
          expect(m.vel, que).toBeLessThanOrEqual(2);
        }
      });
    }
  }
});
