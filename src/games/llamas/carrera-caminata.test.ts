import { describe, expect, it } from "vitest";
import { CAMINATA, LLEGADA_TARDE, TOPES_TROTE, enTanda, perfil, trazar, ubicarTandas } from "./carrera-caminata";
import { DT, PANTALLAS_ANCHAS, PANTALLAS_ANGOSTAS, PANTALLAS_SOLIDOS, altoTarjetaTandas, contactosAlEntrar, encimadasEnTandas, geometriaDe, medirCaminata } from "./carrera-caminata-datos";
import type { Pantalla } from "./carrera-forma";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";

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
 * De 76 a 100 y de 126 a 200 personas el grupo son las ocho de la final y nadie se echa: la recta se abre en la salida. Si alguna de las últimas
 * en pasar por el portón todavía camina al corral, lo que le falta caminar se suma a su lugar también en la recta, así que pasa del corral a su
 * carril sin saltar (M1 de la dirección de la carrera, la regla que mide `scripts/audit-tacto.mjs`).
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
      // Antes, en algunas la última llegaba con la recta ya abierta y esta prueba medía ese paso. Desde que las que pasan esperan adelante de su
      // tanda (`puestosEnTanda`) el camino es más corto y todas llegan antes de la salida. Si alguna vuelve a llegar con la recta abierta, esta
      // cuenta lo dice y hay que volver a mirar el paso del corral al carril con ella.
      expect(conRectaAbierta).toBe(0);
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

/**
 * Nadie pasa a través de nadie al entrar al corral: la que llega del portón no cruza la subfila de su compañera de fila ni se encima con
 * otra que también trota. Se mide con la huella del 3D (la más grande) y la cuenta del auditor de sólidos, en sus cuatro pantallas y en las
 * del proyector, de la primera salida por el portón a la última llegada (también en los primeros segundos del grupo).
 */
describe("la caminata: nadie se encima con nadie al entrar al corral", () => {
  for (const [nombre, P] of [...PANTALLAS_SOLIDOS, ...PANTALLAS_ANCHAS, ...PANTALLAS_ANGOSTAS]) {
    it(`${nombre}: con 40, 60 y 120 personas y 12 semillas, ninguna se encima más del 10 % con otra`, () => {
      const malas: string[] = [];
      for (const n of [40, 60, 120]) {
        for (let s = 1; s <= 12; s++) {
          const c = contactosAlEntrar(planCarrera(ctxDe(n, s)).datos, P);
          if (c.cuadros) malas.push(`n=${n} semilla ${s}: ${c.cuadros} cuadros, ${c.ejemplo}`);
        }
      }
      expect(malas).toEqual([]);
    });
  }
});

/**
 * Lo mismo con 151 o más personas, donde pasa una sola por tanda y las dos últimas en salir son de tandas distintas: la recta se abre en la
 * salida y las últimas todavía caminan.
 */
describe("la caminata: nadie se encima con nadie al entrar al corral, con una por tanda", () => {
  for (const [nombre, P] of [...PANTALLAS_SOLIDOS, ...PANTALLAS_ANCHAS, ...PANTALLAS_ANGOSTAS]) {
    it(`${nombre}: con 160, 180 y 200 personas y 6 semillas, ninguna se encima más del 10 % con otra`, () => {
      const malas: string[] = [];
      for (const n of [160, 180, 200]) {
        for (let s = 1; s <= 6; s++) {
          const c = contactosAlEntrar(planCarrera(ctxDe(n, s)).datos, P);
          if (c.cuadros) malas.push(`n=${n} semilla ${s}: ${c.cuadros} cuadros, ${c.ejemplo}`);
        }
      }
      expect(malas).toEqual([]);
    });
  }
});

/**
 * Las que pasan esperan adelante, en la primera columna de su tanda (o en las primeras, si son más que las filas), cerca de la altura de su
 * lugar en el corral: salen derecho al portón, sin nadie adelante. Ninguna que sale antes tiene que cruzar la fila de otra que sale después
 * para llegar a la altura de su lugar (si no, cruzaría a la que todavía espera). En una misma fila, la que sale antes espera más adelante. Las
 * que no pasan llenan los demás puestos en orden alfabético, cada puesto lo usa una sola, y la escena las dibuja donde la caminata las hace
 * salir (`enTanda`). Antes medía que las dos últimas en salir esperaran de arriba abajo como en el corral: lo que eso cuidaba (que al entrar
 * al corral ninguna cruce a la otra donde ya llegó) lo mide la prueba de contactos al entrar, también con 160, 180 y 200 personas.
 */
describe("la caminata: las que pasan esperan adelante, a la altura de su lugar en el corral", () => {
  for (const [nombre, P] of PANTALLAS_SOLIDOS) {
    it(`${nombre}: con 40, 60, 120 y 200 personas y 6 semillas`, () => {
      const malas: string[] = [];
      for (const n of [40, 60, 120, 200]) {
        for (let s = 1; s <= 6; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const { ub, tr, cam } = geometriaDe(d, P);
          const a = ub.formaArena;
          const yTanda = (p: number): number => a.yPie(a.slot(cam.puesto(p)).fila);
          const yCorral = (p: number): number => (tr.lugarEnGrupo(p, d.tSalida) as { y: number }).y;
          for (const t of d.tandas) {
            const usados = new Set(t.miembros.map((p) => cam.puesto(p)));
            if (usados.size !== t.miembros.length || [...usados].some((i) => i < 0 || i >= t.miembros.length)) malas.push(`n=${n} semilla ${s}: dos esperan en el mismo puesto`);
            const cap = Math.ceil(t.pasan.length / a.filas);
            for (const p of t.pasan) if (cam.puesto(p) >= cap * a.filas) malas.push(`n=${n} semilla ${s}: ${p} pasa y no espera adelante (puesto ${cam.puesto(p)})`);
            t.pasan.forEach((x, i) => t.pasan.slice(i + 1).forEach((y) => {
              const ya = yTanda(x), yb = yTanda(y), va = yCorral(x) - ya;
              if (yb !== ya && Math.sign(yb - ya) === Math.sign(va) && Math.abs(yb - ya) < Math.abs(va) + a.altoFila / 2) malas.push(`n=${n} semilla ${s}: ${x} sale antes que ${y} y tiene que cruzar su fila`);
              if (yb === ya && cam.puesto(x) > cam.puesto(y)) malas.push(`n=${n} semilla ${s}: ${y} sale después de ${x} y espera adelante en su fila`);
            }));
            const quedan = t.miembros.filter((p) => !t.pasan.includes(p)).map((p) => cam.puesto(p));
            if (quedan.some((q, i) => i > 0 && q < (quedan[i - 1] as number))) malas.push(`n=${n} semilla ${s}: las que no pasan no siguen el orden alfabético`);
            // La escena las dibuja en ese puesto mientras esperan.
            for (const p of t.pasan) {
              const e = enTanda(t, p, (t.salidas[0] as number) - 0.5, a, ub.arenaX, cam, d.tandas[t.indice - 1]);
              const sl = a.slot(cam.puesto(p));
              if (e.que !== "espera" || e.x !== ub.arenaX - sl.dx || e.y !== a.yPie(sl.fila)) malas.push(`n=${n} semilla ${s}: ${p} no espera en su puesto`);
            }
          }
        }
      }
      expect(malas).toEqual([]);
    });
  }
});

/**
 * En el celular parado la tanda que corre va debajo de su tarjeta de nombres (`hTarjeta` en `carrera.ts`): las pruebas la arman igual, con el
 * ancho de los textos aproximado. Sin la tarjeta la tanda de las pruebas quedaba de 10 a 80 píxeles más arriba que la de la escena, y la
 * elección del camino de cada una mira dónde está.
 */
describe("la caminata: en el celular parado la tanda va debajo de su tarjeta, como en la escena", () => {
  const P = (PANTALLAS_SOLIDOS.find(([nombre]) => nombre === "390x844") as [string, Pantalla])[1];
  it("con 60, 120 y 200 personas y 3 semillas", () => {
    for (const n of [60, 120, 200]) {
      for (let s = 1; s <= 3; s++) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const hTarjeta = altoTarjetaTandas(d, P);
        expect(hTarjeta, `n=${n} semilla ${s}`).toBeGreaterThan(0);
        const g = geometriaDe(d, P);
        const conTarjeta = ubicarTandas({ P, forma: g.forma, F0: g.F0, tam: Math.max(...d.tandas.map((h) => h.miembros.length)), nombreW: 110 * P.u, hTarjeta });
        expect(g.ub.formaArena.yPie(0), `n=${n} semilla ${s}`).toBe(conTarjeta.formaArena.yPie(0));
        expect(g.ub.gateX, `n=${n} semilla ${s}`).toBe(conTarjeta.gateX);
      }
    }
    // Acostada no hay tarjeta arriba de la tanda.
    const d = planCarrera(ctxDe(60, 1)).datos;
    for (const [, Q] of PANTALLAS_ANCHAS) expect(altoTarjetaTandas(d, Q)).toBe(0);
  });
});

/**
 * Por dónde entra cada una al corral se ve antes de la salida, así que no puede salir de la final, que se arma alrededor de la ganadora. De 76 a
 * 100 y de 126 a 200 personas la recta se abre en la salida y las últimas en pasar por el portón todavía caminan: la elección mira dónde va cada
 * una en esos segundos, y lo tiene que saber sin leer cómo corre cada carril en la final. Con una final que no se puede leer, la caminata sale
 * igual.
 */
describe("la caminata: la entrada al corral no lee la final", () => {
  for (const [nombre, P] of [...PANTALLAS_SOLIDOS, ...PANTALLAS_ANGOSTAS]) {
    it(`${nombre}: con 76, 100 y 150 personas y 3 semillas, cada una elige su camino sin leer la final`, () => {
      const leidas: string[] = [];
      for (const n of [76, 100, 150]) {
        for (let s = 1; s <= 3; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const prohibida = (): never => {
            throw new Error("la caminata leyó la final");
          };
          const ciega: Datos = { ...d, final: { ...d.final, pos: prohibida, lateral: prohibida, salto: prohibida, beatOf: prohibida } };
          const vista = geometriaDe(d, P).cam;
          let sinFinal: ReturnType<typeof geometriaDe>["cam"];
          try {
            sinFinal = geometriaDe(ciega, P).cam;
          } catch (e) {
            leidas.push(`n=${n} semilla ${s}: ${(e as Error).message}`);
            continue;
          }
          for (const h of d.tandas) {
            h.pasan.forEach((p, j) => {
              expect(sinFinal.llega(p), `n=${n} semilla ${s}, llama ${p}`).toBe(vista.llega(p));
              for (let t = h.salidas[j] as number; t <= vista.llega(p); t += 0.25) expect(sinFinal.en(p, t), `n=${n} semilla ${s}, llama ${p}`).toEqual(vista.en(p, t));
            });
          }
        }
      }
      expect(leidas).toEqual([]);
    });
  }
});

/**
 * Las tandas usan los mismos lugares: la que entra aparece cuando ya se fueron las echadas de la anterior, y no de pie adentro de ellas (antes
 * aparecía 1,4 s antes, en cada lugar de cada tanda después de la primera).
 */
describe("las tandas: ninguna aparece encima de las echadas de la anterior", () => {
  for (const [nombre, P] of PANTALLAS_SOLIDOS) {
    it(`${nombre}: con 40, 60, 120 y 200 personas y 4 semillas`, () => {
      const malas: string[] = [];
      for (const n of [40, 60, 120, 200]) {
        for (let s = 1; s <= 4; s++) {
          const e = encimadasEnTandas(planCarrera(ctxDe(n, s)).datos, P);
          if (e.sobreEchadaAjena) malas.push(`n=${n} semilla ${s}: ${e.sobreEchadaAjena} cuadros, ${e.ejemplo}`);
        }
      }
      expect(malas).toEqual([]);
    });
  }
});

/**
 * La que sale de su tanda no pasa a través de nadie: ni de las que esperan su turno, ni de las echadas, ni de otra que también sale, hasta
 * cruzar el portón (de ahí en adelante lo mide la de contactos al entrar). Son las filas de las tandas del auditor de sólidos, con la huella
 * del 3D y con la del 2D, desde el 10 %. En las cuatro pantallas del auditor y en 1280x720 y 1024x768: en 1920x1080 y 2340x1080 con las
 * barras de las pruebas, las que esperan quietas en la tanda ya se enciman un 11 % en el 3D (las columnas están a un largo del 2D más 26 u),
 * así que ahí la que sale toca a la de atrás en el primer cuadro sin moverse hacia ella.
 */
describe("las tandas: la que sale no pasa a través de las que esperan", () => {
  for (const [nombre, P] of [...PANTALLAS_SOLIDOS, ...PANTALLAS_ANCHAS.filter(([nombre]) => nombre === "1280x720"), ...PANTALLAS_ANGOSTAS]) {
    it(`${nombre}: con 40, 60, 120 y 200 personas y 4 semillas, en el 3D y en el 2D`, () => {
      const malas: string[] = [];
      for (const n of [40, 60, 120, 200]) {
        for (let s = 1; s <= 4; s++) {
          const d = planCarrera(ctxDe(n, s)).datos;
          const g = geometriaDe(d, P);
          for (const motor of ["3d", "2d"] as const) {
            const e = encimadasEnTandas(d, P, motor, g);
            if (e.caminaSobreQuieta + e.caminaSobreEchada + e.caminaSobreCamina) {
              malas.push(`${motor} n=${n} semilla ${s}: ${e.caminaSobreQuieta} cuadros sobre una que espera, ${e.caminaSobreEchada} sobre una echada y ${e.caminaSobreCamina} sobre otra que sale, ${e.ejemploCamina}`);
            }
          }
        }
      }
      expect(malas).toEqual([]);
    });
  }
});
