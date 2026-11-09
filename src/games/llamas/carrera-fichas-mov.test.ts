import { describe, expect, it } from "vitest";
import { FICHA, estadoNuevo, pasoDe, pasoFicha, type EstadoFicha, type ObjetivoFicha } from "./carrera-fichas-mov";
import { seriesDelShow } from "./carrera-marcha-datos";
import { ctxDe } from "./carrera-prueba";
import { planCarrera } from "./carrera-show";

/**
 * Las fichas de nombre van con su llama, con el mismo tope de paso, y nunca saltan (regla M9 de la dirección de la carrera). Todo se mide en cuerpos (la unidad
 * de la marcha: `cuerpo` vale 1) respecto del frente del grupo, a 60 cuadros por segundo.
 */
const DT = 1 / 60;
/** El tope de paso por cuadro de las llamas (M1), con el 3 % de la cuenta numérica. */
const TOPE_CUADRO = 0.03 * 1.03;

const objetivo = (ox: number, oy: number, visible = true, llama = 0): ObjetivoFicha => ({ ox, oy, visible, llama });

describe("la ficha: el deslizamiento", () => {
  it("un renglón que se corre se desliza: no pasa del tope por cuadro, arranca y frena de a poco y tarda más de 0,3 s", () => {
    for (const salto of [0.4, 0.9, 2]) {
      let e: EstadoFicha = estadoNuevo(0, objetivo(0, 0));
      const o = objetivo(0, -salto);
      const pasos: number[] = [];
      let t90 = -1, previa = 0, aMax = 0, vPrev = 0;
      for (let i = 1; i <= 240; i++) {
        const n = pasoFicha(e, i * DT, o, 1);
        const paso = Math.hypot(n.ox - e.ox, n.oy - e.oy);
        pasos.push(paso);
        if (t90 < 0 && Math.abs(n.oy) >= 0.9 * salto) t90 = i * DT;
        aMax = Math.max(aMax, Math.abs(paso / DT - vPrev) / DT);
        vPrev = paso / DT;
        // Nunca se pasa del objetivo.
        expect(Math.abs(n.oy)).toBeLessThanOrEqual(salto * 1.005);
        previa = Math.max(previa, paso);
        e = n;
      }
      expect(e.oy, `salto ${salto}`).toBeCloseTo(-salto, 6);
      expect(previa, `salto ${salto}`).toBeLessThanOrEqual(TOPE_CUADRO);
      expect(t90, `salto ${salto}`).toBeGreaterThanOrEqual(0.3);
      // El primer cuadro no salta: arranca con la aceleración de la ficha.
      expect(pasos[0], `salto ${salto}`).toBeLessThanOrEqual(FICHA.aceleracion * DT * DT);
      expect(aMax, `salto ${salto}`).toBeLessThanOrEqual(FICHA.aceleracion * 1.15);
    }
  });

  it("con la llama yendo al tope, la ficha se corre con lo que sobra y el total respecto del frente no pasa de 0,03 cuerpos por cuadro", () => {
    for (const v of [0, 0.8, 1.0, 1.5]) {
      let e: EstadoFicha = estadoNuevo(0, objetivo(0, 0, true, v));
      let maxPaso = 0, ax = 0, prevX = 0, prevY = 0;
      for (let i = 1; i <= 720; i++) {
        const t = i * DT;
        ax = v * t;
        // A los dos segundos la decisión pone la ficha un renglón más arriba y otro a un costado.
        const o = objetivo(t > 2 ? 0.7 : 0, t > 2 ? -0.9 : 0, true, v);
        e = pasoFicha(e, t, o, 1);
        const x = ax + e.ox, y = e.oy;
        if (i > 1) maxPaso = Math.max(maxPaso, Math.hypot(x - prevX, y - prevY));
        prevX = x;
        prevY = y;
      }
      expect(maxPaso, `la llama a ${v} cuerpos por segundo`).toBeLessThanOrEqual(Math.max(TOPE_CUADRO, (v + FICHA.velocidadMin) * DT * 1.03));
      expect(e.oy).toBeCloseTo(-0.9, 3);
    }
  });

  it("la que se calla se apaga en 0,3 s o más (sin saltos de un cuadro) y la que aparece entra en 0,15 s", () => {
    let e: EstadoFicha = estadoNuevo(0, objetivo(1, 1));
    let t = 0, previa = 1, tApaga = -1;
    while (e.alfa > 0 && t < 3) {
      t += DT;
      e = pasoFicha(e, t, objetivo(1, 1, false), 1);
      expect(e.alfa).toBeLessThanOrEqual(previa);
      expect(previa - e.alfa, "se apaga de a poco").toBeLessThanOrEqual(DT / FICHA.apaga + 1e-9);
      previa = e.alfa;
      if (e.alfa === 0) tApaga = t;
    }
    expect(tApaga).toBeGreaterThanOrEqual(0.3 - 1e-6);
    let tEnciende = 0;
    while (e.alfa < 1 && tEnciende < 3) {
      tEnciende += DT;
      t += DT;
      e = pasoFicha(e, t, objetivo(1, 1, true), 1);
    }
    expect(tEnciende).toBeLessThanOrEqual(0.15 + 2 * DT);
  });

  it("un salto del reloj (más de un cuarto de segundo, o ir hacia atrás) es un corte: la ficha queda donde la decisión la pone", () => {
    const e = estadoNuevo(0, objetivo(0, 0));
    const n = pasoFicha(e, 0.5, objetivo(3, -2), 1);
    expect([n.ox, n.oy, n.alfa]).toEqual([3, -2, 1]);
    const m = pasoFicha(n, 0.2, objetivo(-1, 1), 1);
    expect([m.ox, m.oy]).toEqual([-1, 1]);
    // El mismo instante dos veces no cambia nada (el cambio de tamaño redibuja el cuadro).
    expect(pasoFicha(m, 0.2, objetivo(-1, 1), 1)).toBe(m);
  });
});

/** Un número en [0, 1) que depende solo de las dos semillas. */
const azar = (a: number, b: number): number => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

describe("la ficha: el estado a una hora dada no depende de los cuadros", () => {
  it("con cuadros a 60, a 71 y a 120 por segundo la ficha queda igual en cada paso de la grilla; con cuadros más espaciados (37 por segundo), a menos de 0,02 cuerpos", () => {
    // La decisión cambia justo en un paso de la grilla (un renglón y un silencio): lo que pasa después es función de la hora y nada más. (Si cambiara entre dos pasos,
    // el cuadro que la ve primero la pone en un paso o en el siguiente según cuándo caiga: una diferencia de una sesentava de segundo, medio píxel como mucho.)
    const meta = (t: number): ObjetivoFicha => objetivo(t >= 1 ? 0.6 : 0, t >= 1 ? -0.9 : 0, !(t >= 2.4 && t < 3), 0.5);
    const correr = (paso: number): Map<number, EstadoFicha> => {
      const visto = new Map<number, EstadoFicha>();
      let e = estadoNuevo(0, meta(0));
      visto.set(e.k, e);
      for (let i = 1; i * paso < 4; i++) {
        const t = i * paso;
        e = pasoFicha(e, t, meta(t), 1);
        visto.set(e.k, e);
      }
      return visto;
    };
    const base = correr(1 / 60);
    for (const paso of [1 / 71, 1 / 120, 1 / 37]) {
      // Con cuadros más espaciados que la grilla, los pasos que se saltan usan la decisión del cuadro que cae: la diferencia es de un paso como mucho.
      const espaciados = paso > 1 / 60;
      const otra = correr(paso);
      let comunes = 0;
      for (const [k, e] of otra) {
        const b = base.get(k);
        if (!b) continue;
        comunes++;
        for (const campo of ["ox", "oy", "vx", "vy", "alfa"] as const) {
          const tope = !espaciados ? 1e-9 : campo === "alfa" ? 0.12 : campo === "vx" || campo === "vy" ? 0.05 : 0.02;
          expect(Math.abs(e[campo] - b[campo]), `paso ${k} (${campo}) con cuadros cada ${paso.toFixed(4)} s`).toBeLessThanOrEqual(tope);
        }
      }
      expect(comunes, `cuadros cada ${paso.toFixed(4)} s`).toBeGreaterThan(100);
    }
  });

  it("con decisiones que cambian entre dos pasos, una deriva continua y la velocidad de la llama, a cualquier cadencia la ficha queda a menos de un paso de la de 60 por segundo", () => {
    // Lo que el cuadro puede no saber: una decisión que salta (otro renglón, callarse) a mitad de un paso, una deriva continua del objetivo (la cámara que
    // empuja la ficha contra el borde) y una llama que acelera y frena. Se mide contra los 60 cuadros por segundo, que evalúan todo en cada paso.
    const llamaEn = (h: number): number => 0.55 + 0.45 * Math.sin(2.7 * h);
    const meta = (t: number): ObjetivoFicha => ({
      ox: (t >= 0.5 ? 0.5 * Math.min(2, t - 0.5) : 0) + (t >= 1.0083 ? 0.6 : 0),
      oy: (t >= 1.0083 ? -0.9 : 0) + (t >= 3.5042 ? 0.9 : 0),
      visible: !(t >= 2.4083 && t < 3.0083),
      llama: llamaEn(Math.floor(t * 60 + 1e-9) / 60),
      llamaEn,
    });
    const correr = (paso: number): Map<number, EstadoFicha> => {
      const visto = new Map<number, EstadoFicha>();
      let e = estadoNuevo(0, meta(0));
      visto.set(e.k, e);
      for (let i = 1; i * paso < 5; i++) {
        const t = i * paso;
        e = pasoFicha(e, t, meta(t), 1);
        visto.set(e.k, e);
      }
      return visto;
    };
    const base = correr(1 / 60);
    for (const fps of [120, 71, 37, 30, 20]) {
      const otra = correr(1 / fps);
      let comunes = 0, peor = 0;
      for (const [k, e] of otra) {
        const b = base.get(k);
        if (!b) continue;
        comunes++;
        peor = Math.max(peor, Math.hypot(e.ox - b.ox, e.oy - b.oy));
        // Una decisión que salta se ve en el cuadro que cae en el paso: a cuadros espaciados se atribuye a pasos que ya pasaron, un paso o dos de deslizamiento
        // (un paso de encendido de la ficha son 0,11 de transparencia). La velocidad de una ficha apagada no se ve, y no se mide.
        expect(Math.abs(e.alfa - b.alfa), `paso ${k} (alfa) a ${fps} cuadros por segundo`).toBeLessThanOrEqual(0.12);
        if (e.alfa > 0 && b.alfa > 0) expect(Math.hypot(e.vx - b.vx, e.vy - b.vy), `paso ${k} (velocidad) a ${fps} cuadros por segundo`).toBeLessThanOrEqual(0.1);
      }
      expect(comunes, `${fps} cuadros por segundo`).toBeGreaterThan(50);
      expect(peor, `${fps} cuadros por segundo: ${peor.toFixed(4)} cuerpos`).toBeLessThanOrEqual(0.03);
    }
  });

  it("el paso de la grilla es siempre el mismo para la misma hora", () => {
    for (const t of [0, 0.0166, 1 / 60, 2 / 60, 1.5, 59.999999, 60, 123.4567]) expect(pasoDe(t)).toBe(pasoDe(t));
    expect(pasoDe(1 / 60)).toBe(1);
    expect(pasoDe(3 / 60)).toBe(3);
    expect(pasoDe(0.5)).toBe(30);
  });
});

describe("la ficha sobre un plan: sigue a su llama con el mismo tope de paso", () => {
  for (const n of [8, 18, 60, 200]) {
    it(`${n} personas, 4 semillas: con todo lo que puede correrla (la amarilla que cambia de dueña, la echada, el paso a los carriles, un renglón cada pocos segundos y callarse) ninguna ficha pasa de 0,03 cuerpos por cuadro respecto del frente`, () => {
      for (let s = 1; s <= 4; s++) {
        const d = planCarrera(ctxDe(n, s)).datos;
        const ser = seriesDelShow(d);
        const N = ser.series[0]?.x.length ?? 0;
        // Los eventos que mueven una ficha, en cuerpos respecto de su ancla: el nombre arriba de la cabeza, la ficha grande de quien va primera
        // (que cambia de dueña en cada cambio de punta), la echada (el nombre baja), el modo de la recta (arriba de la cabeza o al costado)
        // y un renglón de más o de menos cada tantos segundos, el peor caso de la decisión de no pisar a otra.
        const cambios = d.cambiosDePunta;
        let peor = 0, peorQuien = -1, peorT = 0, deslizadas = 0, sinDeslizar = 0;
        for (const sr of ser.series) {
          let e: EstadoFicha | null = null;
          let px = 0, py = 0, antes = { x: 0, y: -1.6 };
          for (let i = 0; i < N; i++) {
            if (!(sr.corre[i] as number)) {
              e = null;
              continue;
            }
            const t = ser.t0 + i * ser.dt;
            const duena = cambios.filter((c) => c.t <= t).pop()?.quien;
            let ox = 0, oy = -1.6;
            if (duena === sr.id) (ox -= 0.3), (oy -= 0.5);
            if (t >= d.tAbre - 1 && d.lanes.includes(sr.id)) (ox += 0.5), (oy += 0.4);
            if (t >= (d.tiempos.cae.get(sr.id) ?? Infinity)) oy += 0.6;
            const ventana = Math.floor(t / 2.7);
            const fila = azar(sr.id, ventana);
            if (fila < 0.3) oy -= 0.9;
            else if (fila > 0.7) oy += 0.9;
            const visible = azar(sr.id + 1000, Math.floor(t / 1.1)) > 0.15;
            const o = objetivo(ox, oy, visible, i > 0 ? Math.abs((sr.x[i] as number) - (sr.x[i - 1] as number)) / ser.dt : 0);
            // El control: la misma ficha sin deslizar, tal como se dibujaba (la decisión manda de un cuadro al otro).
            if (i > 0 && (sr.corre[i - 1] as number) && visible) sinDeslizar = Math.max(sinDeslizar, Math.hypot(sr.x[i] as number - (sr.x[i - 1] as number) + (ox - antes.x), oy - antes.y));
            antes = { x: ox, y: oy };
            e = e ? pasoFicha(e, t, o, 1) : estadoNuevo(t, o);
            if (e.vx !== 0 || e.vy !== 0) deslizadas++;
            const x = (sr.x[i] as number) + e.ox, y = e.oy;
            if (i > 0 && (sr.corre[i - 1] as number) && Math.hypot(e.vx, e.vy) > 0) {
              const dd = Math.hypot(x - px, y - py);
              if (dd > peor) (peor = dd), (peorQuien = sr.id), (peorT = t);
            }
            px = x;
            py = y;
          }
        }
        expect(deslizadas, `n=${n} semilla ${s}`).toBeGreaterThan(0);
        // La prueba ve el problema: sin deslizar, la ficha salta un renglón (0,9 cuerpos o más) de un cuadro al otro.
        expect(sinDeslizar, `n=${n} semilla ${s}`).toBeGreaterThan(0.5);
        // Mientras la ficha se desliza: la llama más lo que sobra del tope, nunca más (las llamas con causa a la vista van hasta 1,5 y dejan 0,25).
        expect(peor, `n=${n} semilla ${s}: ${peor.toFixed(4)} cuerpos (persona ${peorQuien}, a los ${peorT.toFixed(1)} s)`).toBeLessThanOrEqual(0.03 * 1.12);
      }
    });
  }
});
