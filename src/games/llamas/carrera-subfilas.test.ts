import { describe, expect, it, vi } from "vitest";
import { RECTA } from "./carrera-base";
import { grupoDe } from "./carrera-duracion";
import { formaDelGrupo } from "./carrera-filas";
import { carrilesDe, LLAMA_HOCICO, type Pantalla } from "./carrera-forma";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";
import type { Orden } from "./carrera-orden";
import type { Tiempos } from "./carrera-tiempos";
import { sembrar } from "../pixi/kit/azar";
import { ABRE_DESDE, AIRE_SUBFILA, echadasCerca, FRENADO, FUERZA_BRUTA_MAX, muestrasDelPlan, PESO_ECHADAS, pesoDelPar, signosDeSubfila, umbralSubfila, velocidadAlEcharse, type DatosSubfila, type Signo } from "./carrera-subfilas";
import { costurasJuntas, crearTrayectorias } from "./carrera-trayectorias";

/**
 * La prueba de los signos de subfila: salen solo del plan del grupo, de quiénes son finalistas y de su carril, y de una moneda sembrada
 * por fila; la misma ronda da lo mismo, sin `Math.random` ni reloj; las finalistas de una fila quedan en el orden de su carril; nadie
 * queda en la línea; el lado no copia el puesto de salida (finalistas y resto, mitad y mitad); las muestras empiezan, paran y quedan
 * quietas donde dicen las trayectorias; ningún par que se junta en el plan queda sin peso; y con las subfilas apagadas todas quedan en 0.
 */

vi.setConfig({ testTimeout: 300_000 });

function pantalla(w: number, h: number): Pantalla {
  const u = w < h ? Math.min(w / 420, h / 900) : h / 720;
  return { w, h, u, retrato: w < h, top: 60 * u, bottom: h - 90 * u };
}

/** La fila de cada persona y el umbral en una pantalla, como los arma la escena (`carrera.ts`) y el auditor de sólidos. */
function geometria(d: Datos, w = 1366, h = 768): { filaDe: (p: number) => number; umbral: number; largo: number } {
  const P = pantalla(w, h);
  const cuerpo = CUERPO * ENSANCHE * RECTA * w;
  const grupo = formaDelGrupo({ P, d, nombrePx: 16 * P.u, nombreW: 110 * P.u, cuerpoPx: cuerpo });
  const umbral = umbralSubfila(grupo.forma.esc, cuerpo);
  return { filaDe: (p) => grupo.filaDeLugar[d.orden.rango(p)] as number, umbral, largo: umbral / (1 + AIRE_SUBFILA) };
}

function sinAzarNiReloj<T>(f: () => T): T {
  const espias = [
    vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random en las subfilas");
    }),
    vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now en las subfilas");
    }),
    vi.spyOn(performance, "now").mockImplementation(() => {
      throw new Error("performance.now en las subfilas");
    }),
  ];
  try {
    return f();
  } finally {
    for (const e of espias) e.mockRestore();
  }
}

const porFila = (d: Datos, filaDe: (p: number) => number): Map<number, number[]> => {
  const filas = new Map<number, number[]>();
  for (const p of d.gente) {
    const f = filaDe(p);
    filas.set(f, [...(filas.get(f) ?? []), p]);
  }
  return filas;
};

/**
 * Una ronda armada a mano: personas que corren con el puntaje dado, sin echarse, con la recta a los 20 s (las muestras llegan a los 19 s,
 * donde empieza el empalme con la recta).
 */
function rondaAMano(o: { puntajes: ((t: number) => number)[]; carriles?: Map<number, number>; cae?: Map<number, number>; semillaFilas?: number }): DatosSubfila {
  const gente = o.puntajes.map((_, i) => i);
  const lanes: number[] = [];
  for (const [p, c] of o.carriles ?? []) lanes[c] = p;
  const orden = { puntaje: (g: number, t: number) => (o.puntajes[g] as (t: number) => number)(t), rango: (g: number) => g } as unknown as Orden;
  const tiempos = { cae: o.cae ?? new Map<number, number>() } as unknown as Tiempos;
  return { gente, lanes: lanes.filter((p) => p !== undefined), orden, tiempos, tSalida: 0, tAbre: 20, tCarriles: 20, tandas: [], dist: (t: number) => t * 0.1, semillaFilas: o.semillaFilas ?? 1 };
}
const constante = (v: number) => () => v;
/** La primera muestra, calculada aparte del módulo: la salida, o tres segundos después si hay tandas (las que llegan tarde del portón). */
const t0De = (d: Datos): number => d.tSalida + (d.tandas.length ? 3 : 0);
/** Hasta cuándo corre `p` en las muestras, calculado aparte: hasta que se echa o pasa a los carriles, y nunca en el último segundo del grupo. */
const hastaDe = (d: Datos, p: number): number => Math.min(d.tiempos.cae.get(p) ?? Infinity, d.tCarriles, d.tAbre - 1);

describe("las subfilas del grupo", () => {
  for (const n of [8, 18, 30]) {
    it(`con ${n}: la misma ronda da los mismos signos dos veces, sin azar ni reloj`, () => {
      for (const semilla of [1, 2, 3]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const { filaDe, umbral } = geometria(d);
        const a = sinAzarNiReloj(() => signosDeSubfila({ ...d }, filaDe, umbral));
        const b = sinAzarNiReloj(() => signosDeSubfila({ ...d }, filaDe, umbral));
        const c = sinAzarNiReloj(() => signosDeSubfila(d, filaDe, umbral));
        expect([...b]).toEqual([...a]);
        expect([...c]).toEqual([...a]);
        expect(a.size).toBe(d.gente.length);
      }
    });
  }

  it("nadie queda en la línea salvo la que está sola en su fila: las demás van arriba o abajo", () => {
    let filasDeVarias = 0;
    let solas = 0;
    for (const [w, h] of [[1366, 768], [844, 390], [390, 844]] as const) {
      for (const n of [8, 18, 30]) {
        for (let semilla = 1; semilla <= 8; semilla++) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const { filaDe, umbral } = geometria(d, w, h);
          const s = signosDeSubfila(d, filaDe, umbral);
          for (const miembros of porFila(d, filaDe).values()) {
            if (miembros.length === 1) {
              solas++;
              expect(s.get(miembros[0] as number)).toBe(0);
            } else {
              filasDeVarias++;
              for (const p of miembros) expect([-1, 1]).toContain(s.get(p));
            }
          }
        }
      }
    }
    expect(filasDeVarias).toBeGreaterThan(0);
    expect(solas).toBeGreaterThan(0);
  });

  it("las finalistas de una fila quedan en el orden de su carril: la de carril menor arriba", () => {
    let filasConDos = 0;
    for (const [w, h] of [[1366, 768], [1920, 1080], [844, 390], [390, 844]] as const) {
      for (const n of [8, 18, 30]) {
        for (let semilla = 1; semilla <= 10; semilla++) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const { filaDe, umbral } = geometria(d, w, h);
          const s = signosDeSubfila(d, filaDe, umbral);
          for (const miembros of porFila(d, filaDe).values()) {
            const fins = miembros.filter((p) => d.lanes.includes(p)).sort((a, b) => d.lanes.indexOf(a) - d.lanes.indexOf(b));
            if (fins.length < 2) continue;
            filasConDos++;
            const lados = fins.map((p) => s.get(p) as Signo);
            expect(lados[0]).toBe(-1);
            expect(lados[lados.length - 1]).toBe(1);
            for (let j = 1; j < lados.length; j++) expect(lados[j] as number).toBeGreaterThanOrEqual(lados[j - 1] as number);
          }
        }
      }
    }
    expect(filasConDos).toBeGreaterThan(0);
    // A mano: dos finalistas que nunca se juntan, con los carriles al revés del puesto. Sin carriles alternarían -1 y +1 por puesto.
    const d = rondaAMano({ puntajes: [constante(0), constante(-10)], carriles: new Map([[0, 5], [1, 2]]) });
    const s = signosDeSubfila(d, () => 0, 2);
    expect(s.get(1)).toBe(-1);
    expect(s.get(0)).toBe(1);
  });

  it("a mano: tres en una fila y la primera pasa a las otras dos; queda sola en su lado", () => {
    // La 0 sale de atrás y pasa a la 1 y a la 2, que van separadas y nunca se juntan entre ellas.
    const d = rondaAMano({ puntajes: [(t) => -20 + 1.5 * t, constante(0), constante(-10)] });
    const m = muestrasDelPlan(d);
    expect(pesoDelPar(m, 0, 1, 2)).toBeGreaterThan(0);
    expect(pesoDelPar(m, 0, 2, 2)).toBeGreaterThan(0);
    expect(pesoDelPar(m, 1, 2, 2)).toBe(0);
    const s = signosDeSubfila(d, () => 0, 2);
    expect(s.get(0)).not.toBe(0);
    expect(s.get(1)).toBe(-(s.get(0) as number));
    expect(s.get(2)).toBe(-(s.get(0) as number));
  });

  it("una fila sin cruces se reparte alternando por puesto, y una moneda de la fila elige con qué lado empieza; la sola en su fila va en la línea", () => {
    const filas = [0, 0, 0, 0, 1];
    const empiezaArriba = new Map<number, number>([[0, 0], [1, 0]]);
    for (let semillaFilas = 1; semillaFilas <= 64; semillaFilas++) {
      const d = rondaAMano({ puntajes: [constante(0), constante(-10), constante(-20), constante(-30), constante(-5)], semillaFilas });
      const s = signosDeSubfila(d, (p) => filas[p] as number, 2);
      const a = s.get(0) as Signo;
      expect([-1, 1]).toContain(a);
      expect([1, 2, 3].map((p) => s.get(p))).toEqual([-a, a, -a]);
      expect(s.get(4)).toBe(0);
      empiezaArriba.set(a === -1 ? 1 : 0, (empiezaArriba.get(a === -1 ? 1 : 0) as number) + 1);
      // La misma semilla da lo mismo.
      expect([...signosDeSubfila(rondaAMano({ puntajes: [constante(0), constante(-10), constante(-20), constante(-30), constante(-5)], semillaFilas }), (p) => filas[p] as number, 2)]).toEqual([...s]);
    }
    // Con 64 semillas, cada lado sale entre 20 y 44 veces (más de cuatro desviaciones de un lado parejo).
    for (const v of empiezaArriba.values()) expect(v).toBeGreaterThanOrEqual(20);
  });

  it("el lado no copia el puesto de salida: en el celular con 30, finalistas y resto van arriba mitad y mitad", () => {
    // Con «la primera» de las asignaciones empatadas, la última de cada fila por puesto iba siempre abajo; la finalista sale más
    // seguido atrás de su compañera de fila, y quedaban arriba el 41,6 % de las finalistas contra el 53,1 % del resto.
    let finArriba = 0, fin = 0, restoArriba = 0, resto = 0;
    for (let semilla = 1; semilla <= 200; semilla++) {
      const d = planCarrera(ctxDe(30, semilla)).datos;
      const { filaDe, umbral } = geometria(d, 390, 844);
      const s = signosDeSubfila(d, filaDe, umbral);
      const esFinal = new Set(d.lanes);
      for (const p of d.gente) {
        const arriba = s.get(p) === -1 ? 1 : 0;
        if (esFinal.has(p)) { finArriba += arriba; fin++; } else { restoArriba += arriba; resto++; }
      }
    }
    expect(finArriba / fin).toBeGreaterThan(0.46);
    expect(finArriba / fin).toBeLessThan(0.54);
    expect(restoArriba / resto).toBeGreaterThan(0.46);
    expect(restoArriba / resto).toBeLessThan(0.54);
  });

  it("a mano: la de atrás pasa por donde ya está echada otra, y eso no pesa: la echada dejó de correr", () => {
    // La 0 se echa a los 5 s en el puntaje 0; la 1 viene de atrás y llega a ese puntaje a los 13,3 s, cuando la 0 ya no corre.
    const d = rondaAMano({ puntajes: [constante(0), (t) => -20 + 1.5 * t], cae: new Map([[0, 5]]) });
    const m = muestrasDelPlan(d);
    expect((m.corre.get(0) as Float64Array).length).toBe(Math.floor(5 / 0.05) + 1);
    expect((m.corre.get(1) as Float64Array).length).toBe(Math.floor(19 / 0.05) + 1);
    expect(pesoDelPar(m, 0, 1, 2)).toBe(0);
  });

  for (const n of [8, 18, 30, 60]) {
    it(`con ${n}: las muestras van a 20 por segundo desde la salida y paran al echarse o al pasar a los carriles`, () => {
      let paranAlEcharse = 0, paranEnLosCarriles = 0;
      for (const semilla of [1, 2, 3]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const m = muestrasDelPlan(d);
        const t0 = t0De(d);
        expect(m.t0).toBe(t0);
        expect(m.paso).toBe(0.05);
        for (const p of d.gente) {
          const hasta = hastaDe(d, p);
          const a = m.corre.get(p) as Float64Array;
          expect(a.length, `persona ${p}`).toBe(hasta >= t0 ? Math.floor((hasta - t0) / 0.05 + 1e-9) + 1 : 0);
          if (a.length) {
            expect(a[0]).toBe(d.orden.puntaje(p, t0));
            expect(a[a.length - 1]).toBe(d.orden.puntaje(p, t0 + (a.length - 1) * 0.05));
          }
          if (hasta === d.tiempos.cae.get(p)) paranAlEcharse++;
          else paranEnLosCarriles++;
        }
      }
      if (n > 8) expect(paranAlEcharse).toBeGreaterThan(0);
      expect(paranEnLosCarriles).toBeGreaterThan(0);
    });
  }

  it("la echada queda quieta donde la dejan las trayectorias", () => {
    let echadas = 0;
    for (const n of [18, 30, 60]) {
      for (const semilla of [1, 2]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const W = 1366, H = 768;
        const P = pantalla(W, H);
        const cuerpo = CUERPO * ENSANCHE * RECTA * W;
        const grupo = formaDelGrupo({ P, d, nombrePx: 16 * P.u, nombreW: 110 * P.u, cuerpoPx: cuerpo });
        const F0 = -(60 * P.u + LLAMA_HOCICO * grupo.forma.esc);
        const tr = crearTrayectorias(d, { F0, Xs: F0 + d.distAbre * W, ancho: W, cuerpo, forma: grupo.forma, filaDeLugar: grupo.filaDeLugar, carr: carrilesDe(P, d.lanes.length, 16 * P.u), caminata: null });
        const m = muestrasDelPlan(d);
        for (const [p, reposo] of m.reposo) {
          const cae = d.tiempos.cae.get(p) as number;
          // El reposo del plan es con el frenado de siempre; si la echada eligió uno más largo, queda más adelante su velocidad por la
          // mitad de lo que se alarga.
          const T = tr.frenadoDe(p);
          const corre = (velocidadAlEcharse(d, p, cae) * (T - FRENADO)) / 2;
          expect(Math.abs((reposo + corre) * cuerpo - (tr.posicion(p, cae + T + 0.1).x - F0)), `con ${n}, semilla ${semilla}, persona ${p}`).toBeLessThan(1e-6);
          echadas++;
        }
      }
    }
    expect(echadas).toBeGreaterThan(0);
  });

  it("dos echadas que quedan quietas una al lado de la otra van a lados opuestos aunque corriendo nunca se junten", () => {
    // El frente avanza 0,1 anchos por segundo: la 2 va 10 cuerpos atrás de la 0 y se echa justo cuando llega adonde quedó la 0.
    const cuerposPorSegundo = 0.1 / (CUERPO * ENSANCHE * RECTA);
    const e = rondaAMano({ puntajes: [constante(0), constante(-30), constante(-10)], cae: new Map([[0, 5], [2, 5 + 10 / cuerposPorSegundo]]) });
    const me = muestrasDelPlan(e);
    // Quietas juntas pesan `PESO_ECHADAS`, y la 2 además pasa junto a la 0 mientras se abre para echarse.
    expect(pesoDelPar(me, 0, 2, 2)).toBeGreaterThanOrEqual(PESO_ECHADAS);
    expect(pesoDelPar(me, 0, 1, 2)).toBe(0);
    expect(pesoDelPar(me, 1, 2, 2)).toBe(0);
    // Alternando por puesto, la 0 y la 2 irían del mismo lado.
    const s = signosDeSubfila(e, () => 0, 2);
    expect(s.get(0)).not.toBe(0);
    expect(s.get(2)).toBe(-(s.get(0) as number));
  });

  it("las costuras: dos echadas de filas vecinas que quedan quietas juntas nunca se abren una hacia la otra", () => {
    // Dos filas de tres: la 0 (fila 0) y la 1 (fila 1) se echan juntas y quedan quietas en el mismo lugar; las demás van lejos.
    const cae = new Map([[0, 5], [1, 5]]);
    const filas = [0, 1, 0, 1, 0, 1];
    const puntajes = [constante(0), constante(0), constante(-20), constante(-20), constante(-40), constante(-40)];
    let sinCostura = 0, cambiadas = 0, deArriba = 0;
    for (let semillaFilas = 1; semillaFilas <= 96; semillaFilas++) {
      const d = rondaAMano({ puntajes, cae, semillaFilas });
      const libre = signosDeSubfila(d, (p) => filas[p] as number, 2);
      const abierta = libre.get(0) === 1 && libre.get(1) === -1;
      if (abierta) sinCostura++;
      const s = signosDeSubfila(d, (p) => filas[p] as number, 2, undefined, { costuras: true });
      expect(s.get(0) === 1 && s.get(1) === -1, `semilla ${semillaFilas}`).toBe(false);
      // Cada fila sigue alternando por puesto: las costuras no tocan el peso ni la alternancia.
      expect([s.get(2), s.get(4)]).toEqual([-(s.get(0) as number), s.get(0)]);
      expect([s.get(3), s.get(5)]).toEqual([-(s.get(1) as number), s.get(1)]);
      if (abierta) {
        cambiadas++;
        // Cuál de las dos filas cambia lo dice la moneda de la ronda: a veces la de arriba y a veces la de abajo.
        if (s.get(0) !== libre.get(0)) deArriba++;
      } else expect([...s]).toEqual([...libre]);
    }
    // Sin mirar las costuras, una de cada cuatro quedaría abierta una hacia la otra; mirándolas, ninguna, y solo cambian esas.
    expect(sinCostura).toBeGreaterThan(10);
    expect(cambiadas).toBe(sinCostura);
    expect(deArriba).toBeGreaterThan(0);
    expect(deArriba).toBeLessThan(sinCostura);
  });

  it("en las filas de dos o menos no hay costuras: la echada no se abre", () => {
    const cae = new Map([[0, 5], [1, 5]]);
    for (let semillaFilas = 1; semillaFilas <= 32; semillaFilas++) {
      const d = rondaAMano({ puntajes: [constante(0), constante(0), constante(-20), constante(-20)], cae, semillaFilas });
      const filas = [0, 1, 0, 1];
      expect([...signosDeSubfila(d, (p) => filas[p] as number, 2, undefined, { costuras: true })]).toEqual([...signosDeSubfila(d, (p) => filas[p] as number, 2)]);
    }
  });

  it("las costuras en rondas de verdad, donde la fila es angosta para dos aperturas: ninguna queda abierta si hay cómo evitarlo", () => {
    let costuras = 0, abiertas = 0;
    for (const [w, h] of [[1366, 768], [844, 390]] as const) {
      for (const n of [10, 12, 14]) {
        for (let semilla = 1; semilla <= 24; semilla++) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const P = pantalla(w, h);
          const cuerpo = CUERPO * ENSANCHE * RECTA * w;
          const grupo = formaDelGrupo({ P, d, nombrePx: 16 * P.u, nombreW: 110 * P.u, cuerpoPx: cuerpo });
          if (!costurasJuntas(grupo.forma.esc, grupo.forma.altoFila)) continue;
          const filaDe = (p: number): number => grupo.filaDeLugar[d.orden.rango(p)] as number;
          const umbral = umbralSubfila(grupo.forma.esc, cuerpo);
          const s = signosDeSubfila(d, filaDe, umbral, undefined, { costuras: true });
          const m = muestrasDelPlan(d);
          const tam = (f: number): number => d.gente.filter((p) => filaDe(p) === f).length;
          for (const a of m.reposo.keys()) {
            for (const b of m.reposo.keys()) {
              if (filaDe(b) !== filaDe(a) + 1 || tam(filaDe(a)) < ABRE_DESDE || tam(filaDe(b)) < ABRE_DESDE || !echadasCerca(m, a, b, umbral)) continue;
              costuras++;
              if (s.get(a) === 1 && s.get(b) === -1) abiertas++;
            }
          }
        }
      }
    }
    // Las que quedan abiertas no tienen arreglo con las asignaciones de menor peso de cada fila (lo prueba la búsqueda a la fuerza de
    // abajo); con su frenado, ninguna termina encimada (el auditor de sólidos lo mide).
    console.log(`costuras con la fila angosta: ${costuras}, abiertas sin arreglo: ${abiertas}`);
    expect(costuras).toBeGreaterThan(5);
    expect(abiertas).toBeLessThanOrEqual(costuras * 0.1);
  });

  it("las costuras: la elección es la de menos costuras abiertas, contra la búsqueda a la fuerza en 300 rondas armadas a mano", () => {
    const rng = sembrar(20261112);
    let conCosturas = 0, abiertasEnTotal = 0;
    for (let caso = 0; caso < 300; caso++) {
      // De dos a cuatro filas de tres; algunas se echan y quedan quietas cerca de alguna de la fila vecina.
      const F = 2 + Math.floor(rng() * 3);
      const k = 3 * F;
      const puntajes = Array.from({ length: k }, () => {
        const base = -rng() * 12, amp = rng() * 3, per = 3 + rng() * 9, fase = rng() * 6;
        return (t: number) => base + amp * Math.sin(t / per + fase);
      });
      const cae = new Map<number, number>();
      for (let p = 0; p < k; p++) if (rng() < 0.5) cae.set(p, 2 + rng() * 15);
      const filas = Array.from({ length: k }, (_, p) => p % F);
      const d = rondaAMano({ puntajes, cae, semillaFilas: 1 + caso });
      const umbral = 1 + rng() * 2;
      const s = signosDeSubfila(d, (p) => filas[p] as number, umbral, undefined, { costuras: true });
      const m = muestrasDelPlan(d);
      const costuras: [number, number][] = [];
      for (const a of m.reposo.keys()) for (const b of m.reposo.keys()) if ((filas[b] as number) === (filas[a] as number) + 1 && echadasCerca(m, a, b, umbral)) costuras.push([a, b]);
      if (!costuras.length) continue;
      conCosturas++;
      const abiertasDe = (sig: (p: number) => number): number => costuras.filter(([a, b]) => sig(a) === 1 && sig(b) === -1).length;
      const elegidas = abiertasDe((p) => s.get(p) as number);
      abiertasEnTotal += elegidas;
      // A la fuerza: por fila, las asignaciones de menor peso; después, todas las combinaciones.
      const miembros = Array.from({ length: F }, (_, f) => d.gente.filter((p) => filas[p] === f).sort((a, b) => a - b));
      const opciones = miembros.map((ms) => {
        let menor = Infinity;
        const todas: { mascara: number; peso: number }[] = [];
        for (let mascara = 0; mascara < 1 << ms.length; mascara++) {
          let peso = 0;
          for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) if (((mascara >> i) & 1) === ((mascara >> j) & 1)) peso += pesoDelPar(m, ms[i] as number, ms[j] as number, umbral);
          todas.push({ mascara, peso });
          menor = Math.min(menor, peso);
        }
        return todas.filter((x) => x.peso === menor).map((x) => x.mascara);
      });
      let mejor = Infinity;
      const recorrer = (f: number, elegidasPorFila: number[]): void => {
        if (f === F) {
          const sig = (p: number): number => {
            const fila = filas[p] as number;
            return (elegidasPorFila[fila] as number) >> (miembros[fila] as number[]).indexOf(p) & 1 ? -1 : 1;
          };
          mejor = Math.min(mejor, abiertasDe(sig));
          return;
        }
        for (const mascara of opciones[f] as number[]) recorrer(f + 1, [...elegidasPorFila, mascara]);
      };
      recorrer(0, []);
      expect(elegidas, `caso ${caso}`).toBe(mejor);
    }
    expect(conCosturas).toBeGreaterThan(50);
    console.log(`casos con costuras: ${conCosturas}, abiertas sin arreglo: ${abiertasEnTotal}`);
  });

  it("la velocidad al echarse es la suya: la del frente más la de su puntaje", () => {
    const d = rondaAMano({ puntajes: [(t) => 0.5 * t], cae: new Map([[0, 5]]) });
    const cuerposPorSegundo = 0.1 / (CUERPO * ENSANCHE * RECTA);
    expect(velocidadAlEcharse(d, 0, 5)).toBeCloseTo(cuerposPorSegundo + 0.5, 6);
  });

  it("contra una búsqueda ingenua en 300 filas sembradas: el mismo peso y la misma alternancia, y las finalistas en orden", () => {
    const rng = sembrar(20261109);
    for (let caso = 0; caso < 300; caso++) {
      const k = 2 + Math.floor(rng() * 8);
      const puntajes = Array.from({ length: k }, () => {
        const base = -rng() * 3 * k, amp = rng() * 4, per = 3 + rng() * 9, fase = rng() * 6;
        return (t: number) => base + amp * Math.sin(t / per + fase);
      });
      const cae = new Map<number, number>();
      for (let p = 0; p < k; p++) if (rng() < 0.3) cae.set(p, 2 + rng() * 15);
      const carriles = new Map<number, number>();
      const libres = [0, 1, 2, 3, 4, 5, 6, 7];
      for (let p = 0; p < k; p++) if (rng() < 0.35) carriles.set(p, libres.splice(Math.floor(rng() * libres.length), 1)[0] as number);
      // Las que se echan no son finalistas.
      for (const p of carriles.keys()) cae.delete(p);
      const d = rondaAMano({ puntajes, carriles, cae });
      const umbral = 1 + rng() * 2;
      const s = signosDeSubfila(d, () => 0, umbral);
      const m = muestrasDelPlan(d);
      const w = (a: number, b: number): number => pesoDelPar(m, a, b, umbral);
      const fins = [...carriles.keys()].sort((a, b) => (carriles.get(a) as number) - (carriles.get(b) as number));
      const valida = (v: readonly number[]): boolean => {
        if (fins.length < 2) return true;
        const l = fins.map((p) => v[p] as number);
        return l[0] === -1 && l[l.length - 1] === 1 && l.every((x, j) => j === 0 || x >= (l[j - 1] as number));
      };
      const costo = (v: readonly number[]): [number, number] => {
        let peso = 0, alterna = 0;
        for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) if (v[a] === v[b]) peso += w(a, b);
        for (let a = 0; a + 1 < k; a++) if (v[a] !== v[a + 1]) alterna++;
        return [peso, alterna];
      };
      let mejor: [number, number] = [Infinity, -1];
      for (let mascara = 0; mascara < 1 << k; mascara++) {
        const v = Array.from({ length: k }, (_, i) => ((mascara >> i) & 1 ? 1 : -1));
        if (!valida(v)) continue;
        const c = costo(v);
        if (c[0] < mejor[0] || (c[0] === mejor[0] && c[1] > mejor[1])) mejor = c;
      }
      const elegida = Array.from({ length: k }, (_, p) => s.get(p) as number);
      expect(valida(elegida), `caso ${caso}`).toBe(true);
      expect(costo(elegida), `caso ${caso}`).toEqual(mejor);
    }
  });

  it("con más de 16 en una fila alternan por puesto desde el lado de la moneda, y las finalistas siguen en el orden de su carril", () => {
    const k = FUERZA_BRUTA_MAX + 1;
    const primeras = new Set<number>();
    for (let semillaFilas = 1; semillaFilas <= 16; semillaFilas++) {
      const d = rondaAMano({ puntajes: Array.from({ length: k }, () => constante(0)), carriles: new Map([[2, 6], [5, 1], [9, 3]]), semillaFilas });
      const s = signosDeSubfila(d, () => 0, 2);
      // Las finalistas en orden de carril son la 5, la 9 y la 2: arriba, lo que dé la alternancia y abajo.
      const fins = [5, 9, 2].map((p) => s.get(p) as number);
      expect(fins[0]).toBe(-1);
      expect(fins[2]).toBe(1);
      const primera = s.get(0) as number;
      primeras.add(primera);
      expect(fins[1]).toBe(primera * -1);
      for (let p = 0; p < k; p++) if (![2, 5, 9].includes(p)) expect(s.get(p)).toBe(p % 2 === 0 ? primera : -primera);
    }
    expect([...primeras].sort()).toEqual([-1, 1]);
  });

  it("con las subfilas apagadas (SUBFILA en 0) todas quedan en la línea", () => {
    for (const n of [8, 18, 30, 60]) {
      const d = planCarrera(ctxDe(n, 3)).datos;
      const { filaDe, umbral } = geometria(d);
      const s = signosDeSubfila(d, filaDe, umbral, 0);
      expect(s.size).toBe(d.gente.length);
      for (const p of d.gente) expect(s.get(p)).toBe(0);
    }
  });

  it("no leen de la ronda nada fuera del plan del grupo, los carriles y la semilla de las filas", () => {
    // Esto solo vigila los campos que lee el módulo. El plan del grupo no es ciego a la recta (el orden de entrada de las finalistas
    // decide sus puestos de salida): que el lado no delate a la ganadora lo dice la medida contra toda la gente de la ronda.
    const permitidas = new Set(["gente", "lanes", "orden", "tiempos", "tSalida", "tAbre", "tCarriles", "tandas", "dist", "semillaFilas"]);
    for (const n of [8, 18, 30, 60]) {
      for (const semilla of [1, 2, 3, 4]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const { filaDe, umbral } = geometria(d);
        const base = signosDeSubfila(d, filaDe, umbral);
        // Leer cualquier otra cosa de la ronda (quién gana, la recta, los nombres) tira error.
        const vigilada = new Proxy({ ...d }, {
          get(obj, clave) {
            if (typeof clave === "string" && !permitidas.has(clave)) throw new Error(`las subfilas leyeron d.${clave}`);
            return Reflect.get(obj, clave);
          },
        });
        expect([...signosDeSubfila(vigilada, filaDe, umbral)]).toEqual([...base]);
      }
    }
  });

  it("con tandas, todas las del grupo reciben su signo", () => {
    for (const n of [60, 200]) {
      const d = planCarrera(ctxDe(n, 2)).datos;
      expect(d.tandas.length).toBeGreaterThan(0);
      const { filaDe, umbral } = geometria(d);
      const s = signosDeSubfila(d, filaDe, umbral);
      expect(s.size).toBe(d.gente.length);
    }
  });

  for (const n of [8, 18, 30, 60]) {
    it(`con ${n}, contra la fuerza bruta a 240 por segundo: ningún par de una fila que pasa a menos de 0,9 largos queda sin peso`, () => {
      let paresCerca = 0;
      for (const [w, h] of [[1366, 768], [390, 844]] as const) {
        for (const semilla of [1, 2, 3, 4, 5]) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          if (n === 60) expect(d.tandas.length).toBeGreaterThan(0);
          const { filaDe, umbral, largo } = geometria(d, w, h);
          const m = muestrasDelPlan(d);
          // Desde la salida (tres segundos después con tandas) y hasta donde corren, calculado aparte del módulo.
          const t0 = t0De(d);
          for (const miembros of porFila(d, filaDe).values()) {
            for (let a = 0; a < miembros.length; a++) {
              for (let b = a + 1; b < miembros.length; b++) {
                const pa = miembros[a] as number;
                const pb = miembros[b] as number;
                const hasta = Math.min(hastaDe(d, pa), hastaDe(d, pb));
                let cerca = false;
                for (let i = 0, t = t0; t <= hasta && !cerca; i++, t = t0 + i / 240) if (Math.abs(d.orden.puntaje(pa, t) - d.orden.puntaje(pb, t)) < 0.9 * largo) cerca = true;
                if (!cerca) continue;
                paresCerca++;
                expect(pesoDelPar(m, pa, pb, umbral), `semilla ${semilla}, ${w}x${h}: ${pa} y ${pb}`).toBeGreaterThan(0);
              }
            }
          }
        }
      }
      if (n > 8 && n < 60) expect(paresCerca).toBeGreaterThan(0);
    });
  }

  it("arma los signos en poco tiempo: con 30, con el grupo más grande y con una fila de 16 donde todas se juntan", () => {
    // La cota es holgada para que la máquina cargada no la haga fallar, y atrapa igual una explosión del tiempo. En una máquina
    // tranquila, la mediana da unos 4 ms con 30 personas.
    const cota = 150;
    const mediana = (f: () => unknown): number => {
      const tiempos: number[] = [];
      for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        f();
        tiempos.push(performance.now() - t0);
      }
      tiempos.sort((a, b) => a - b);
      return tiempos[Math.floor(tiempos.length / 2)] as number;
    };
    // El grupo más grande que arma la carrera, con cualquier cantidad de personas: hoy, 30 (`PELOTON_MAX`); con tandas es más chico.
    let nMax = 30;
    for (let n = 31; n <= 300; n++) if (grupoDe(n) > grupoDe(nMax)) nMax = n;
    for (const n of new Set([30, nMax])) {
      const d = planCarrera(ctxDe(n, 7)).datos;
      const { filaDe, umbral } = geometria(d);
      expect(mediana(() => signosDeSubfila({ ...d }, filaDe, umbral)), `con ${n}`).toBeLessThan(cota);
    }
    // El peor caso de la fuerza bruta: 16 en una fila, todas en el mismo lugar, con dos finalistas.
    const peor = rondaAMano({ puntajes: Array.from({ length: FUERZA_BRUTA_MAX }, () => constante(0)), carriles: new Map([[3, 0], [11, 1]]) });
    expect(mediana(() => signosDeSubfila({ ...peor }, () => 0, 2)), "16 en una fila").toBeLessThan(cota);
  });
});
