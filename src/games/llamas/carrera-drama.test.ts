import { describe, expect, it } from "vitest";
import { sembrar } from "../pixi/kit/azar";
import { conCierre, type FormaCierre } from "./carrera-cierre";
import { qDeSegundos, segundosDeQ } from "./carrera-ritmo";
import { conObstaculos, type TipoObstaculo } from "./carrera-obstaculos";
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
const planes = Array.from({ length: RONDAS }, (_, i) => completo(i));

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

describe("los obstáculos", () => {
  it("cada carrera tiene uno, dos o tres, de tipos distintos, y se reparten como se dijo", () => {
    const cuantos = [0, 0, 0, 0];
    const tipos: Record<TipoObstaculo, number> = { piedras: 0, salto: 0, viento: 0 };
    for (const p of planes) {
      const o = p.obstaculos ?? [];
      cuantos[o.length]!++;
      expect(new Set(o.map((x) => x.tipo)).size).toBe(o.length);
      const q = o.map((x) => x.ventana[0]);
      expect(q).toEqual([...q].sort((a, b) => a - b));
      for (const x of o) tipos[x.tipo]++;
    }
    expect(cuantos[0]).toBe(0);
    expect(cuantos[1]! / RONDAS).toBeGreaterThan(0.14);
    expect(cuantos[1]! / RONDAS).toBeLessThan(0.26);
    expect(cuantos[2]! / RONDAS).toBeGreaterThan(0.43);
    expect(cuantos[2]! / RONDAS).toBeLessThan(0.57);
    expect(cuantos[3]! / RONDAS).toBeGreaterThan(0.24);
    expect(cuantos[3]! / RONDAS).toBeLessThan(0.36);
    for (const t of Object.values(tipos)) expect(t / RONDAS).toBeGreaterThan(0.55);
  });

  it("no miran quién gana: le tocan a la ganadora tantas veces como a cualquiera", () => {
    const quienes = (o: NonNullable<Plan["obstaculos"]>[number], tipo: TipoObstaculo): number[] => (o.tipo !== tipo ? [] : tipo === "salto" ? o.malas : o.carriles);
    for (const tipo of ["piedras", "salto", "viento"] as const) {
      let ganadora = 0, esperadas = 0;
      for (const p of planes) {
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

  it("las piedras frenan a una llama y se recupera; la valla hace perder un puesto a la que salta mal; la ráfaga desordena a un grupo", () => {
    let piedras = 0, mal = 0, viento = 0;
    for (const p of planes) {
      for (const o of p.obstaculos ?? []) {
        const k = o.carriles[0] as number;
        if (o.tipo === "piedras") {
          // Sin las piedras iría más adelante: en el medio del golpe, a más de dos cuerpos; recuperada, igual.
          const b = conCierre(base(planes.indexOf(p)), sembrar(planes.indexOf(p) * 104729 + 11));
          const antes = b.pos(k, o.q + 0.02) - p.pos(k, o.q + 0.02);
          expect(antes).toBeGreaterThan(0.0115 * 2);
          expect(b.pos(k, o.ventana[1] + 0.03) - p.pos(k, o.ventana[1] + 0.03)).toBeCloseTo(0, 9);
          piedras++;
        }
        if (o.tipo === "salto") {
          expect(o.malas.length).toBeGreaterThanOrEqual(1);
          expect(o.malas.length).toBeLessThanOrEqual(2);
          for (const m of o.malas) {
            // La rezagada que llega a la valla después de la ventana (y quizá con otro obstáculo encima) no se mide.
            if ((o.llegan[m] as number) >= o.ventana[1]) continue;
            let vio = false;
            for (let q = (o.llegan[m] as number) - 0.05; q < (o.llegan[m] as number) + 0.08; q += 0.001) if (p.beatOf(m, q)?.kind === "malsalto") vio = true;
            expect(vio, "la que salta mal se ve").toBe(true);
          }
          mal++;
        }
        if (o.tipo === "viento") {
          expect(o.carriles.length).toBeGreaterThanOrEqual(Math.min(2, p.lanes.length));
          expect(o.carriles.length).toBeLessThanOrEqual(4);
          const medio = o.q + 0.03;
          expect(Math.abs(p.lateral?.(o.carriles[0] as number, medio) ?? 0)).toBeGreaterThan(0.5);
          // Y los que no están en el grupo no se corren.
          for (let j = 0; j < p.lanes.length; j++) if (!o.carriles.includes(j)) expect(p.lateral?.(j, medio) ?? 0).toBe(0);
          viento++;
        }
      }
    }
    expect(piedras).toBeGreaterThan(500);
    expect(mal).toBeGreaterThan(500);
    expect(viento).toBeGreaterThan(500);
  });

  it("en la valla saltan todas: cada carril sube al cruzarla, y la que la hace mal sube menos", () => {
    let vistas = 0;
    for (const p of planes.slice(0, 200)) {
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

  it("sin obstáculos y fuera de las ventanas el plan es el del cierre", () => {
    for (let i = 0; i < 200; i++) {
      const sin = conCierre(base(i), sembrar(i * 104729 + 11)), con = planes[i] as Plan;
      for (const q of [0, 0.05, 0.067, 0.25, 0.5, 0.75, 0.96, 1]) for (let k = 0; k < 8; k++) expect(con.pos(k, q)).toBeCloseTo(sin.pos(k, q), 9);
    }
  });
});
