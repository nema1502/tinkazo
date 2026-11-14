import { describe, expect, it } from "vitest";
import { sembrar } from "../pixi/kit/azar";
import { conCierre, type FormaCierre } from "./carrera-cierre";
import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import { PIEDRAS_TARDE_DESDE, VENTANAS_C, conObstaculos, finDelEfecto, ventanasC, type TipoObstaculo } from "./carrera-obstaculos";
import { ctxDe } from "./carrera-prueba";
import { capasDeLaRecta, carrilesTardePara, planCarrera } from "./carrera-show";
import { conTopeDeAceleracion } from "./carrera-tope";
import { planRace, type Plan } from "./plan";

/**
 * El cierre y los obstáculos de la recta: cambian cómo se ve la carrera, no quién gana ni la justicia.
 * Las rondas son 1.200 planes de ocho, sin pasar por la selección: la ganadora es un carril sorteado.
 */
const NAMES = ["Ana", "Jorge", "Lucía", "Carlos", "Elena", "Diego", "María", "Pablo"];

const base = (i: number, n = 8): Plan => planRace(NAMES.slice(0, n), (i * 5) % n, sembrar(i * 7919 + 3));
const completo = (i: number, n = 8): Plan => conObstaculos(conCierre(base(i, n), sembrar(i * 104729 + 11)), sembrar(i * 1299709 + 5));
const puesto = (p: Plan, k: number, q: number): number => {
  const xs = p.lanes.map((_, j) => p.pos(j, q));
  return 1 + xs.filter((x, j) => j !== k && x > (xs[k] as number)).length;
};
const qDe = (p: Plan, s: number): number => qDeSegundos(s, p.foto);
const RONDAS = 1200;
/** El cierre solo (sin obstáculos): el plan de la recta que miden las pruebas del cierre. */
const planes = Array.from({ length: RONDAS }, (_, i) => conCierre(base(i), sembrar(i * 104729 + 11)));
/** El cierre con los obstáculos puestos encima (la recta que arma `carrera-show.ts`, sin la marcha). */
const conObs = Array.from({ length: RONDAS }, (_, i) => completo(i));

describe("el cierre de la recta", () => {
  it("no cambia quién gana ni cómo llega: la ganadora cruza primera donde la deja el plan base, y la foto es la del plan base", () => {
    for (let i = 0; i < RONDAS; i++) {
      const b = base(i), p = planes[i] as Plan;
      const w = p.story.winner;
      expect(w).toBe(b.story.winner);
      expect(p.foto).toBe(b.foto);
      expect(p.pos(w, 1)).toBeCloseTo(b.pos(w, 1), 9);
      for (let k = 0; k < p.lanes.length; k++) if (k !== w) expect(p.pos(k, 1)).toBeLessThan(p.pos(w, 1));
    }
  });

  it("los puestos que se sortean (al largar, al 25, al 50 y al 75 %) son los del plan base: lo parejo se conserva", () => {
    for (let i = 0; i < RONDAS; i++) {
      const b = base(i), p = planes[i] as Plan;
      for (const q of [0.067, 0.25, 0.5, 0.75]) expect(puesto(p, p.story.winner, q), `ronda ${i} al ${q * 100}%`).toBe(puesto(b, b.story.winner, q));
      // Y las otras también: el orden entero en esos puntos es el de siempre.
      for (const q of [0.067, 0.25, 0.5, 0.75]) for (let k = 0; k < 8; k++) expect(p.pos(k, q), `ronda ${i} carril ${k} al ${q * 100}%`).toBeCloseTo(b.pos(k, q), 9);
    }
  });

  it("hay tres formas de cerrar, cerca de un tercio cada una (la que aguanta es la menos frecuente)", () => {
    const cuenta: Record<FormaCierre, number> = { remontada: 0, disputa: 0, aguanta: 0 };
    for (const p of planes) cuenta[(p.cierre as { forma: FormaCierre }).forma]++;
    expect(cuenta.remontada / RONDAS).toBeGreaterThan(0.28);
    expect(cuenta.disputa / RONDAS).toBeGreaterThan(0.28);
    expect(cuenta.aguanta / RONDAS).toBeGreaterThan(0.18);
    expect(cuenta.aguanta).toBeLessThan(cuenta.remontada);
  });

  it("la ganadora no está en el podio al 90 % todas las veces, y en la remontada llega recién al final", () => {
    const podio = planes.filter((p) => puesto(p, p.story.winner, 0.9) <= 3).length / RONDAS;
    expect(podio).toBeLessThan(0.65);
    for (const p of planes.filter((x) => (x.cierre as { forma: FormaCierre }).forma === "remontada")) {
      const w = p.story.winner;
      expect(puesto(p, w, 0.88), "la que remonta va atrás").toBeGreaterThan(1);
      expect(puesto(p, w, 1)).toBe(1);
    }
  });

  it("en la disputa hay dos o tres cambios de punta en la recta final", () => {
    let total = 0, n = 0;
    for (const p of planes.filter((x) => (x.cierre as { forma: FormaCierre }).forma === "disputa")) {
      let cambios = 0, ant = -1;
      for (let q = 0.7; q <= 1; q += 0.0025) {
        const l = p.lanes.map((_, k) => k).sort((a, b) => p.pos(b, q) - p.pos(a, q))[0] as number;
        if (ant >= 0 && l !== ant) cambios++;
        ant = l;
      }
      total += cambios;
      n++;
    }
    expect(total / n).toBeGreaterThan(1.8);
    expect(total / n).toBeLessThan(5.5);
  });

  it("hasta el 90 % el cierre no cambia nada de lo ya medido, y de ahí en adelante empalma sin saltos de posición ni de velocidad", () => {
    for (let i = 0; i < 300; i++) {
      const p = conCierre(base(i), sembrar(i * 104729 + 11));
      for (let k = 0; k < p.lanes.length; k++) {
        const h = 0.0004;
        // Posición continua al cruzar el 90 %.
        expect(Math.abs(p.pos(k, 0.9 + 1e-9) - p.pos(k, 0.9 - 1e-9))).toBeLessThan(1e-6);
        // Y la velocidad también: la pendiente a un lado y al otro es casi la misma (en cuerpos por 0,5 % de la recta).
        const antes = (p.pos(k, 0.9) - p.pos(k, 0.9 - h)) / h, despues = (p.pos(k, 0.9 + h) - p.pos(k, 0.9)) / h;
        expect(Math.abs(antes - despues), `ronda ${i} carril ${k}`).toBeLessThan(0.9);
      }
    }
  });

  it("el final se reparte en segundos: la ganadora lleva la punta entre uno y medio y dos y medio, nunca menos de uno", () => {
    const xs: number[] = [];
    for (const p of planes) {
      const w = p.story.winner;
      const fin = segundosDeQ(1, p.foto);
      let ultima = 0.7;
      for (let q = 0.7; q <= 1; q += 0.0005) if (puesto(p, w, q) !== 1) ultima = q;
      xs.push(fin - segundosDeQ(ultima, p.foto));
    }
    xs.sort((a, b) => a - b);
    const mediana = xs[Math.floor(xs.length / 2)] as number, p10 = xs[Math.floor(xs.length / 10)] as number;
    expect(mediana, `mediana ${mediana.toFixed(2)}`).toBeGreaterThan(1.5);
    expect(mediana).toBeLessThan(2.5);
    expect(p10, `p10 ${p10.toFixed(2)}`).toBeGreaterThanOrEqual(1);
  });

  it("del 88 % a la meta pasan tres segundos o más, y el pelotón se aprieta: al 95 % las tres primeras dentro de un cuerpo y en la meta la segunda a medio cuerpo", () => {
    let apretadas = 0, fotos = 0;
    for (const p of planes) {
      expect(segundosDeQ(1, p.foto) - segundosDeQ(0.88, p.foto)).toBeGreaterThan(3);
      const o95 = p.lanes.map((_, k) => p.pos(k, 0.95)).sort((a, b) => b - a);
      if (((o95[0] as number) - (o95[2] as number)) / 0.0115 <= 1) apretadas++;
      const o1 = p.lanes.map((_, k) => p.pos(k, 1)).sort((a, b) => b - a);
      if (((o1[0] as number) - (o1[1] as number)) / 0.0115 <= 0.5) fotos++;
    }
    expect(apretadas / RONDAS).toBeGreaterThan(0.85);
    expect(fotos / RONDAS).toBeGreaterThan(0.7);
  });

  it("la ganadora pasa de a una: sube de puesto con varios décimos entre un pase y el siguiente, y sin saltos de velocidad", () => {
    let juntos = 0, pases = 0, salto = 0;
    for (const p of planes.slice(0, 400)) {
      const w = p.story.winner;
      let previo = puesto(p, w, 0.9), tPrevio = -9;
      const T0 = segundosDeQ(0.9, p.foto);
      for (let q = 0.9; q <= 1; q += 0.0005) {
        const pu = puesto(p, w, q), t = segundosDeQ(q, p.foto) - T0;
        if (pu < previo) {
          pases++;
          if (t - tPrevio < 0.12) juntos++;
          tPrevio = t;
        }
        previo = pu;
      }
      // El cambio de velocidad de la ganadora entre dos pasos de 0,02 s (en cuerpos por segundo): nada de saltos.
      let vPrev: number | null = null;
      for (let t = 0; t < 2.9; t += 0.04) {
        const q1 = qDe(p, T0 + t), q2 = qDe(p, T0 + t + 0.04);
        const v = (p.pos(w, q2) - q2 - (p.pos(w, q1) - q1)) / 0.0115 / 0.04;
        if (vPrev !== null) salto = Math.max(salto, Math.abs(v - vPrev));
        vPrev = v;
      }
    }
    expect(pases).toBeGreaterThan(400);
    expect(juntos / pases, "pases a menos de 0,12 s del anterior").toBeLessThan(0.1);
    expect(salto, `mayor salto de velocidad ${salto.toFixed(2)} cuerpos/s en 0,04 s`).toBeLessThan(3);
  });

  it("es una función de la ronda: la misma da lo mismo, y nada usa Math.random", () => {
    const a = completo(77), b = completo(77);
    for (const q of [0.1, 0.4, 0.6, 0.85, 0.93, 1]) for (let k = 0; k < 8; k++) expect(a.pos(k, q)).toBe(b.pos(k, q));
    const azar = Math.random;
    Math.random = () => {
      throw new Error("Math.random");
    };
    try {
      const c = completo(78);
      c.pos(0, 0.5);
    } finally {
      Math.random = azar;
    }
  });

  it("con menos de tres carriles no arma nada y deja el plan tal cual", () => {
    for (const n of [2]) {
      const b = base(5, n);
      expect(conCierre(b, sembrar(1))).toBe(b);
    }
  });
});

type Obst = NonNullable<Plan["obstaculos"]>[number];
const esC = (o: Obst): boolean => VENTANAS_C.some((v) => v[0] === o.ventana[0]);
/** A quién le toca un obstáculo (las que lo sufren y quien escupe): lo que excluye a una víctima de las ventanas C. */
const tocadas = (o: Obst): number[] => [...(o.tipo === "salto" ? o.malas : o.carriles), ...(o.escupe >= 0 ? [o.escupe] : [])];

describe("los obstáculos", () => {
  it("la ventana A trae valla o remolino en el 60 %, la B siempre trae uno, y las C traen piedras o escupida a una víctima nueva", () => {
    const cuantosAB = [0, 0, 0];
    const tipos: Record<TipoObstaculo, number> = { piedras: 0, salto: 0, viento: 0, escupida: 0 };
    const tiposC = { piedras: 0, escupida: 0 };
    const separaciones: number[] = [];
    let enC = 0, sinLibres = 0;
    for (const p of conObs) {
      const o = p.obstaculos ?? [];
      // En el orden de la recta.
      const q = o.map((x) => x.ventana[0]);
      expect(q).toEqual([...q].sort((a, b) => a - b));
      const ab = o.filter((x) => !esC(x)), cs = o.filter(esC);
      cuantosAB[ab.length]!++;
      expect(new Set(ab.map((x) => x.tipo)).size).toBe(ab.length);
      for (const x of ab) tipos[x.tipo]++;
      const b = ab[ab.length - 1] as Obst;
      expect(b.ventana).toEqual([0.42, 0.48]);
      if (ab.length === 2) {
        const a = ab[0] as Obst;
        expect(a.ventana).toEqual([0.18, 0.24]);
        expect(["salto", "viento"]).toContain(a.tipo);
        expect(["piedras", "escupida"]).toContain(b.tipo);
        // Los dos hechos quedan separados: la valla de la ventana A se cruza algo después de su hora sorteada, así que el mínimo medido es de 2,1 s y la mediana pasa de 2,9 s.
        separaciones.push(segundosDeQ(b.q, p.foto) - segundosDeQ(a.q, p.foto));
      }
      // Con ocho carriles, las tres ventanas C, en orden, de una sola llama, y cortas las que empiezan después de la mitad.
      expect(cs.map((x) => x.ventana)).toEqual(ventanasC(8).map((v) => [v[0], v[1]]));
      // La víctima de cada C sale entre las que no sufrieron nada ni escupieron en lo sorteado antes (A, B y las C anteriores), si quedan dos o más.
      const antes = [...ab];
      for (const c of cs) {
        expect(["piedras", "escupida"]).toContain(c.tipo);
        expect(c.carriles.length).toBe(1);
        expect(c.corta).toBe(c.ventana[0] > 0.5);
        tiposC[c.tipo as "piedras" | "escupida"]++;
        const usadas = new Set(antes.flatMap(tocadas));
        const libres = p.lanes.map((_, k) => k).filter((k) => !usadas.has(k));
        if (libres.length >= 2) expect(libres, "la víctima de una C no repite").toContain(c.carriles[0]);
        else sinLibres++;
        enC++;
        antes.push(c);
      }
      for (const x of o) if (!esC(x)) expect(x.corta).toBe(false);
    }
    expect(cuantosAB[0]).toBe(0);
    expect(cuantosAB[1]! / RONDAS).toBeGreaterThan(0.34);
    expect(cuantosAB[1]! / RONDAS).toBeLessThan(0.46);
    expect(cuantosAB[2]! / RONDAS).toBeGreaterThan(0.54);
    expect(cuantosAB[2]! / RONDAS).toBeLessThan(0.66);
    // En A y en B, cada tipo cerca del 40 % de las carreras, como antes.
    for (const t of Object.values(tipos)) {
      expect(t / RONDAS).toBeGreaterThan(0.34);
      expect(t / RONDAS).toBeLessThan(0.46);
    }
    // En C, piedras y escupida mitad y mitad.
    expect(tiposC.piedras / enC).toBeGreaterThan(0.46);
    expect(tiposC.piedras / enC).toBeLessThan(0.54);
    // Que se acaben las libres pasa cuando antes hubo un remolino de tres o cuatro y escupidas (cada una deja afuera a dos): entonces la víctima sale
    // entre todas. Medido con 1.200 rondas: el 7,9 % de las C.
    expect(sinLibres / enC).toBeLessThan(0.1);
    separaciones.sort((a, b) => a - b);
    expect(separaciones[0]).toBeGreaterThanOrEqual(2.1);
    expect(separaciones[Math.floor(separaciones.length / 2)]).toBeGreaterThanOrEqual(2.9);
  });

  it("las tardías (pulso corto) terminan antes de los tres segundos finales: medido sobre el lugar final, después del tope de aceleración", () => {
    // El fin de verdad de lo que hacen los obstáculos en un carril: la última hora en que el lugar final se aparta en más de una centésima de cuerpo de la
    // misma recta sin obstáculos y con el mismo tope. Y el fin antes del tope: lo mismo entre la recta con obstáculos y la marcha sola.
    const ultima = (a: Plan, b: Plan, k: number, foto: number, T: number): number => {
      let fin = -1;
      for (let t = 0; t <= T + 1e-9; t += 1 / 60) {
        const qq = qDeSegundos(t, foto);
        if (Math.abs(a.pos(k, qq) - b.pos(k, qq)) / 0.0115 > 0.01) fin = t;
      }
      return fin;
    };
    // El tope corre el fin un poco, nunca mucho: menos de un cuarto de segundo con la carrera de antes. Con la marcha pareja los momentos se ven
    // enteros hasta el 75 % (nadie los compensa), la señuelo sube en el final y la velocidad en el corte sale del tramo de antes, y todo se suma a los
    // obstáculos bajo el mismo tope, que tiene más que repartir: el peor caso medido es 0,6 s (con 18 personas, semilla 11, carril 3), en una diferencia
    // de una centésima de cuerpo. Lo que importa no cambia: ninguna tardía llega a los tres segundos finales.
    let cortas = 0, peorCorta = Infinity, corre = 0, medidas = 0, tarde = 0;
    const peorCorre = { false: { v: 0, donde: "" }, true: { v: 0, donde: "" } };
    for (const senuelos of [false, true]) for (const n of [8, 18, 60, 80, 130]) {
      for (let s = 1; s <= 60; s++) {
        const { marchada, conObs: crudo, final } = capasDeLaRecta(ctxDe(n, s), { senuelos });
        const ref = conTopeDeAceleracion(marchada);
        const foto = final.foto, T = segundosDeQ(1, foto);
        const obs = final.obstaculos ?? [];
        for (let k = 0; k < final.lanes.length; k++) {
          const real = ultima(final, ref, k, foto, T), antesDelTope = ultima(crudo, marchada, k, foto, T);
          if (real < 0) continue;
          medidas++;
          // El tope corre el fin un poco, nunca mucho.
          corre = Math.max(corre, real - antesDelTope);
          const peor = peorCorre[`${senuelos}`];
          if (real - antesDelTope > peor.v) Object.assign(peor, { v: real - antesDelTope, donde: `n=${n} semilla ${s} carril ${k}` });
          // Si lo último que le pasa a este carril es una tardía (el fin antes del tope cae dentro de su pulso), termina antes de los tres segundos finales.
          // Se miran todas las tardías del carril: una llama puede recibir en C2 y escupir en C3.
          for (const c of obs) {
            if (!c.corta || (c.tipo !== "piedras" && c.tipo !== "escupida") || (c.carriles[0] !== k && c.escupe !== k)) continue;
            const t0 = segundosDeQ(c.q, foto);
            if (antesDelTope >= t0 && antesDelTope <= t0 + finDelEfecto({ tipo: c.tipo, corta: true }) + 1 / 60) {
              cortas++;
              peorCorta = Math.min(peorCorta, T - real);
              expect(real, `n=${n} semilla ${s} carril ${k}: la tardía termina a ${(T - real).toFixed(2)} s de la meta`).toBeLessThan(T - 3);
            }
          }
          if (real >= T - 3) {
            // Lo único que llega a los tres segundos finales es, a veces, la valla de la ventana B mal saltada por este mismo carril (de antes de este
            // cambio: la valla se salta en la hora de cada una y su efecto dura cinco segundos y medio), y el fin cae dentro de ese efecto. Ninguna tardía.
            tarde++;
            const valla = obs.find((o) => o.tipo === "salto" && o.ventana[0] === 0.42 && o.malas.includes(k));
            const ta = valla ? segundosDeQ(valla.llegan[k] as number, foto) : NaN;
            const enSuEfecto = !!valla && antesDelTope >= ta - 1 && antesDelTope <= ta + finDelEfecto({ tipo: "piedras", corta: false }) + 1 / 60;
            expect(enSuEfecto, `n=${n} semilla ${s} carril ${k}: llega a los tres segundos finales con ${obs.map((o) => `${o.tipo}@${o.ventana[0]}`).join(" ")}`).toBe(true);
          }
        }
      }
    }
    expect(peorCorre.false.v, `con la carrera de antes, ${peorCorre.false.donde}: el tope corre el fin`).toBeLessThan(0.25);
    expect(peorCorre.true.v, `con la marcha pareja, ${peorCorre.true.donde}: el tope corre el fin`).toBeLessThan(0.75);
    expect(medidas).toBeGreaterThan(2000);
    expect(cortas).toBeGreaterThan(600);
    expect(peorCorta).toBeGreaterThan(3);
    expect(tarde / medidas).toBeLessThan(0.01);
  }, 210_000);

  it("las piedras se corren a C3 solo cuando las finalistas pasan tarde a sus carriles: de 2 a 200 personas", () => {
    for (let n = 2; n <= 200; n++) {
      const d = planCarrera(ctxDe(n, 1)).datos;
      expect(carrilesTardePara(n), `n=${n}`).toBe(d.tCarriles > d.tAbre + 1);
    }
  }, 90_000);

  it("con los carriles tarde no hay piedras antes de C3, y la valla y el remolino salen igual de seguido", () => {
    const tipos: Record<TipoObstaculo, number> = { piedras: 0, salto: 0, viento: 0, escupida: 0 };
    let piedrasC3 = 0;
    for (let i = 0; i < RONDAS; i++) {
      const p = conObstaculos(conCierre(base(i), sembrar(i * 104729 + 11)), sembrar(i * 1299709 + 5), { carrilesTarde: true });
      for (const o of p.obstaculos ?? []) {
        // Con el paso tarde, en C2 (de 0,52 a 0,55) todavía se pasa de las filas del grupo a los carriles: con piedras ahí, otra finalista pasaba a
        // menos de 0,2 filas de una roca en 3 a 5 de cada 28. Las piedras recién en C3, que sigue con piedras o escupida.
        if (o.ventana[0] <= (VENTANAS_C[1] as readonly [number, number])[0]) expect(o.tipo, `ronda ${i}`).not.toBe("piedras");
        if (o.tipo === "piedras" && o.ventana[0] === (VENTANAS_C[2] as readonly [number, number])[0]) piedrasC3++;
        if (!esC(o)) tipos[o.tipo]++;
      }
    }
    expect(PIEDRAS_TARDE_DESDE).toBeGreaterThan((VENTANAS_C[1] as readonly [number, number])[1]);
    expect(PIEDRAS_TARDE_DESDE).toBeLessThanOrEqual((VENTANAS_C[2] as readonly [number, number])[0]);
    expect(piedrasC3 / RONDAS).toBeGreaterThan(0.3);
    for (const t of [tipos.salto, tipos.viento]) {
      expect(t / RONDAS).toBeGreaterThan(0.34);
      expect(t / RONDAS).toBeLessThan(0.46);
    }
  });

  it("con 18 y 60 personas los obstáculos son los de antes de la regla de los carriles tarde", () => {
    // Tipo, ventana, víctimas, quien escupe y hora (q), sacados del plan anterior a la regla con las mismas semillas. Es la carrera de antes de la
    // marcha pareja (`senuelos: false`): la hora de la valla sale de dónde va cada una, y la marcha pareja la mueve unas milésimas.
    const fotos: [number, number, [TipoObstaculo, number, number[], number, number][]][] = [
      [18, 1, [["salto", 0.18, [0, 1, 2, 3, 4, 5, 6, 7], -1, 0.244], ["escupida", 0.31, [5], 4, 0.315543], ["piedras", 0.42, [7], -1, 0.439572], ["escupida", 0.52, [2], 1, 0.531161], ["escupida", 0.61, [6], 7, 0.621923]]],
      [18, 2, [["viento", 0.18, [4, 5, 6, 7], -1, 0.196086], ["piedras", 0.31, [3], -1, 0.330075], ["escupida", 0.42, [0], 1, 0.45021], ["piedras", 0.52, [2], -1, 0.524735], ["piedras", 0.61, [2], -1, 0.638243]]],
      [18, 3, [["escupida", 0.31, [5], 4, 0.346254], ["salto", 0.42, [0, 1, 2, 3, 4, 5, 6, 7], -1, 0.482176], ["piedras", 0.52, [6], -1, 0.546031], ["escupida", 0.61, [2], 1, 0.629992]]],
      [18, 4, [["piedras", 0.31, [2], -1, 0.319264], ["escupida", 0.42, [4], 3, 0.460166], ["escupida", 0.52, [6], 5, 0.540455], ["escupida", 0.61, [1], 0, 0.634255]]],
      [60, 1, [["salto", 0.18, [0, 1, 2, 3, 4, 5, 6, 7], -1, 0.244], ["escupida", 0.31, [5], 4, 0.315543], ["piedras", 0.42, [7], -1, 0.439572], ["escupida", 0.52, [2], 1, 0.531161], ["escupida", 0.61, [6], 7, 0.621923]]],
      [60, 2, [["viento", 0.18, [4, 5, 6, 7], -1, 0.196086], ["piedras", 0.31, [3], -1, 0.330075], ["escupida", 0.42, [0], 1, 0.45021], ["piedras", 0.52, [2], -1, 0.524735], ["piedras", 0.61, [2], -1, 0.638243]]],
      [60, 3, [["escupida", 0.31, [5], 4, 0.346254], ["salto", 0.42, [0, 1, 2, 3, 4, 5, 6, 7], -1, 0.480176], ["piedras", 0.52, [6], -1, 0.546031], ["escupida", 0.61, [2], 1, 0.629992]]],
      [60, 4, [["piedras", 0.31, [2], -1, 0.319264], ["escupida", 0.42, [4], 3, 0.460166], ["escupida", 0.52, [6], 5, 0.540455], ["escupida", 0.61, [1], 0, 0.634255]]],
    ];
    for (const [n, s, esperada] of fotos) {
      const obs = capasDeLaRecta(ctxDe(n, s), { senuelos: false }).final.obstaculos ?? [];
      expect(obs.map((o) => [o.tipo, o.ventana[0], o.carriles, o.escupe, Number(o.q.toFixed(6))]), `n=${n} semilla ${s}`).toEqual(esperada);
    }
  });

  it("la escupida le llega a cualquiera y quien escupe es la vecina de al lado", () => {
    let total = 0, victimaGanadora = 0, escupeGanadora = 0;
    for (const p of conObs) {
      for (const o of p.obstaculos ?? []) {
        if (o.tipo !== "escupida") continue;
        total++;
        const victima = o.carriles[0] as number;
        expect(Math.abs(o.escupe - victima), "quien escupe va al lado de quien recibe").toBe(1);
        expect(o.escupe).toBeGreaterThanOrEqual(0);
        expect(o.escupe).toBeLessThan(p.lanes.length);
        if (victima === p.story.winner) victimaGanadora++;
        if (o.escupe === p.story.winner) escupeGanadora++;
      }
    }
    expect(total).toBeGreaterThan(300);
    // Una de cada ocho, como cualquiera de los carriles: la ganadora recibe y escupe tantas veces como le toca.
    expect(victimaGanadora / total).toBeGreaterThan(0.08);
    expect(victimaGanadora / total).toBeLessThan(0.17);
    expect(escupeGanadora / total).toBeGreaterThan(0.08);
    expect(escupeGanadora / total).toBeLessThan(0.17);
  });

  it("no miran quién gana: le tocan a la ganadora tantas veces como a cualquiera", () => {
    const quienes = (o: NonNullable<Plan["obstaculos"]>[number], tipo: TipoObstaculo): number[] => (o.tipo !== tipo ? [] : tipo === "salto" ? o.malas : o.carriles);
    for (const tipo of ["piedras", "salto", "viento", "escupida"] as const) {
      let ganadora = 0, esperadas = 0;
      for (const p of conObs) {
        for (const o of p.obstaculos ?? []) {
          const tocadas = quienes(o, tipo);
          if (o.tipo !== tipo) continue;
          if (tocadas.includes(p.story.winner)) ganadora++;
          esperadas += tocadas.length / p.lanes.length;
        }
      }
      // Lo que le toca por azar a una de ocho; la diferencia queda dentro de cuatro desvíos de una binomial.
      expect(Math.abs(ganadora - esperadas), `${tipo}: ${ganadora} contra ${esperadas.toFixed(1)}`).toBeLessThan(4 * Math.sqrt(esperadas));
    }
  });

  it("con tacto: las piedras frenan a una llama de a poco y se recupera; la valla la hace perder lugar a la que salta mal; la ráfaga corre a un grupo despacio", () => {
    let piedras = 0, cortas = 0, mal = 0, viento = 0;
    for (const p of conObs) {
      for (const o of p.obstaculos ?? []) {
        const k = o.carriles[0] as number;
        // Una piedra a una llama a la que no le toca ningún otro obstáculo: sin ella iría más adelante, y después se recupera del todo.
        // La valla le quita un respiro a todas, también a las rezagadas que la saltan tarde: se miran las carreras sin valla.
        if (o.tipo === "piedras" && (p.obstaculos ?? []).every((x) => x === o || (x.tipo !== "salto" && !tocadas(x).includes(k)))) {
          const b = planes[conObs.indexOf(p)] as Plan;
          const t0 = segundosDeQ(o.q, p.foto);
          if (!o.corta) {
            // La de siempre: a los dos segundos y medio del golpe, a más de medio cuerpo; a los siete, recuperada.
            const q1 = qDe(p, t0 + 2.5), q2 = qDe(p, t0 + 7.2);
            expect((b.pos(k, q1) - p.pos(k, q1)) / 0.0115).toBeGreaterThan(0.5);
            expect(b.pos(k, q2) - p.pos(k, q2)).toBeCloseTo(0, 9);
            piedras++;
          } else {
            // La tardía: a los 1,4 s del golpe, a más de un cuarto de cuerpo; al terminar el pulso, recuperada.
            const q1 = qDe(p, t0 + 1.4), q2 = qDe(p, t0 + finDelEfecto({ tipo: "piedras", corta: true }) + 0.02);
            expect((b.pos(k, q1) - p.pos(k, q1)) / 0.0115).toBeGreaterThan(0.25);
            expect(b.pos(k, q2) - p.pos(k, q2)).toBeCloseTo(0, 9);
            cortas++;
          }
        }
        if (o.tipo === "salto") {
          expect(o.malas.length).toBeGreaterThanOrEqual(1);
          expect(o.malas.length).toBeLessThanOrEqual(2);
          for (const m of o.malas) {
            // La rezagada que llega a la valla después de la ventana (y quizá con otro obstáculo encima) no se mide.
            if ((o.llegan[m] as number) >= o.ventana[1]) continue;
            // Si a la misma le toca también otro obstáculo, la postura que se ve es la del primero.
            if ((p.obstaculos ?? []).some((x) => x !== o && ((x.tipo === "piedras" && x.carriles[0] === m) || (x.tipo === "viento" && x.carriles.includes(m))))) continue;
            let vio = false;
            for (let q = (o.llegan[m] as number) - 0.05; q < (o.llegan[m] as number) + 0.08; q += 0.001) if (p.beatOf(m, q)?.kind === "malsalto") vio = true;
            expect(vio, "la que salta mal se ve").toBe(true);
          }
          mal++;
        }
        if (o.tipo === "viento") {
          expect(o.carriles.length).toBeGreaterThanOrEqual(Math.min(2, p.lanes.length));
          expect(o.carriles.length).toBeLessThanOrEqual(4);
          // A los dos segundos y medio de la ráfaga el grupo ya va corrido (la mitad de una fila, de a poco); a los ocho, otra vez en su carril.
          const medio = qDe(p, segundosDeQ(o.q, p.foto) + 2.5);
          expect(Math.abs(p.lateral?.(o.carriles[0] as number, medio) ?? 0)).toBeGreaterThan(0.25);
          expect(p.lateral?.(o.carriles[0] as number, qDe(p, segundosDeQ(o.q, p.foto) + 8))).toBeCloseTo(0, 9);
          // Y los que no están en el grupo no se corren.
          for (let j = 0; j < p.lanes.length; j++) if (!o.carriles.includes(j)) expect(p.lateral?.(j, medio) ?? 0).toBe(0);
          viento++;
        }
      }
    }
    expect(piedras).toBeGreaterThan(80);
    expect(cortas).toBeGreaterThan(80);
    expect(mal).toBeGreaterThan(400);
    expect(viento).toBeGreaterThan(400);
  });

  it("en la valla saltan todas: cada carril sube al cruzarla, y la que la hace mal sube menos", () => {
    let vistas = 0;
    for (const p of conObs.slice(0, 200)) {
      for (const o of p.obstaculos ?? []) {
        if (o.tipo !== "salto") continue;
        for (let k = 0; k < p.lanes.length; k++) {
          // Las rezagadas que no llegan a la valla antes de la meta no saltan.
          if ((o.llegan[k] as number) >= 0.999) continue;
          let max = 0;
          for (let q = (o.llegan[k] as number) - 0.05; q < (o.llegan[k] as number) + 0.08; q += 0.001) max = Math.max(max, p.salto?.(k, q) ?? 0);
          expect(max, `carril ${k}`).toBeGreaterThan(0.2);
          if (!o.malas.includes(k)) expect(max).toBeGreaterThan(0.5);
          vistas++;
        }
      }
    }
    expect(vistas).toBeGreaterThan(100);
  });

  it("antes de abrirse la recta y en la llegada el plan es el del cierre: los obstáculos no tocan la meta ni la foto", () => {
    for (let i = 0; i < 200; i++) {
      const sin = planes[i] as Plan, con = conObs[i] as Plan;
      for (const q of [0, 1]) for (let k = 0; k < 8; k++) expect(con.pos(k, q), `ronda ${i} carril ${k} al ${q}`).toBeCloseTo(sin.pos(k, q), 9);
    }
  });
});
