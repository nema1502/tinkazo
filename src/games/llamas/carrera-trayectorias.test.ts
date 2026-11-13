import { describe, expect, it, vi } from "vitest";
import { RECTA } from "./carrera-base";
import { carrilesDe, LLAMA_HOCICO, type Pantalla } from "./carrera-forma";
import { CUERPO, FILA_CUERPOS } from "./carrera-marcha";
import { seriesDelShow } from "./carrera-marcha-datos";
import { ENSANCHE, VENTANAS_C } from "./carrera-obstaculos";
import { ctxDe } from "./carrera-prueba";
import { planCarrera, type Datos } from "./carrera-show";
import { TAM3D, ZC } from "./carrera-3d-mapa";
import { crearVistaObstaculos } from "./carrera-obstaculos-vista";
import { formaDelGrupo } from "./carrera-filas";
import { ABRE_DESDE, FRENADO, medioAncho3D, velocidadAlEcharse } from "./carrera-subfilas";
import { aperturaEchada, crearTrayectorias, ECHADA_ABRE, ECHADA_ANTES, ECHADA_COSTADO, FRENADOS, PASA, type GeometriaPista, type Posicion, type Trayectorias } from "./carrera-trayectorias";

/**
 * La prueba de la posición pura: lo que se ve en un cuadro sale idéntico llamado directo a esa hora, avanzando cuadro a cuadro a 60 por
 * segundo y saltando hacia adelante y volviendo, y coincide con las series de la marcha pasadas a píxeles y con el piso de cada fila.
 * Sin `Math.random`.
 */

vi.setConfig({ testTimeout: 120_000 });

const W = 1366, H = 768, U = W / 1920;
const PANTALLA: Pantalla = { w: W, h: H, u: U, retrato: false, top: 60 * U, bottom: H - 90 * U };

/** Una pantalla como la arma el auditor de sólidos. */
function pantallaDe(w: number, h: number): Pantalla {
  const u = w < h ? Math.min(w / 420, h / 900) : h / 720;
  return { w, h, u, retrato: w < h, top: 60 * u, bottom: h - 90 * u };
}

/** La geometría de la escena: el grupo con las filas según el carril (`formaDelGrupo`), los carriles y dónde empieza la recta. */
function geometria(d: Datos, P: Pantalla = PANTALLA, op: { subfila?: number } = {}): GeometriaPista {
  const cuerpo = CUERPO * ENSANCHE * RECTA * P.w;
  const grupo = formaDelGrupo({ P, d, nombrePx: 22 * P.u, nombreW: 110 * P.u, cuerpoPx: cuerpo });
  const forma = grupo.forma;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const carr = carrilesDe(P, d.lanes.length, 22 * P.u);
  const F0 = -(60 * P.u + LLAMA_HOCICO * forma.esc);
  return { F0, Xs: F0 + d.distAbre * P.w, ancho: P.w, cuerpo, forma, carr, caminata: null, filaDeLugar: grupo.filaDeLugar, ...(op.subfila === undefined ? {} : { subfila: op.subfila }) };
}

/** La caja en el piso de la huella del 3D, como la mide el auditor de sólidos. */
const caja3D = (pos: Posicion) => ({
  x0: pos.x - 36 * pos.esc * TAM3D, x1: pos.x + 38 * pos.esc * TAM3D,
  y0: pos.y - (13 * pos.esc * TAM3D) / ZC, y1: pos.y + (13 * pos.esc * TAM3D) / ZC,
});
/** Cuánto se enciman dos llamas: el área común en el piso sobre la del cuerpo más chico. */
function encimado(a: Posicion, b: Posicion): number {
  const ca = caja3D(a), cb = caja3D(b);
  const comun = Math.max(0, Math.min(ca.x1, cb.x1) - Math.max(ca.x0, cb.x0)) * Math.max(0, Math.min(ca.y1, cb.y1) - Math.max(ca.y0, cb.y0));
  return comun / Math.min((ca.x1 - ca.x0) * (ca.y1 - ca.y0), (cb.x1 - cb.x0) * (cb.y1 - cb.y0));
}

const foto = (tr: Trayectorias, personas: readonly number[], t: number): Posicion[] => personas.map((p) => {
  const pos = tr.posicion(p, t);
  return { ...pos, momento: pos.momento ? { ...pos.momento } : null };
});

function sinAzar<T>(f: () => T): T {
  const espia = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Math.random en las trayectorias");
  });
  try {
    return f();
  } finally {
    espia.mockRestore();
  }
}

describe("las trayectorias puras", () => {
  for (const n of [8, 18, 30]) {
    for (const semilla of [1, 2, 3, 4, 5, 6]) {
      it(`con ${n}, semilla ${semilla}: los tres caminos dan lo mismo y coinciden con la marcha`, () => {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const geo = geometria(d);
        const personas = [...new Set([...d.gente, ...d.lanes])];
        const cuadros = new Set<number>();
        const iDe = (t: number): number => Math.round((t - d.tSalida) * 60);
        for (let t = d.tSalida; t <= d.tCrown; t += 0.5) cuadros.add(iDe(t));
        for (const e of d.tiempos.echadas) for (const dt of [-0.6, 0, 0.3, 1.3]) cuadros.add(iDe(e.t + dt));
        cuadros.add(iDe(d.tAbre));
        cuadros.add(iDe(d.tCrown));
        const ordenados = [...cuadros].filter((i) => i >= 0).sort((a, b) => a - b);
        const horaDe = (i: number): number => d.tSalida + i / 60;
        const ultimo = ordenados[ordenados.length - 1] as number;

        const directo = new Map<number, Posicion[]>();
        sinAzar(() => {
          for (const i of ordenados) directo.set(i, foto(crearTrayectorias(d, geo), personas, horaDe(i)));
        });

        const secuencial = crearTrayectorias(d, geo);
        sinAzar(() => {
          for (let i = 0; i <= ultimo; i++) {
            const t = horaDe(i);
            for (const p of personas) secuencial.posicion(p, t);
            if (cuadros.has(i)) expect(foto(secuencial, personas, t), `avanzando, cuadro ${i}`).toEqual(directo.get(i));
          }
        });

        const saltando = crearTrayectorias(d, geo);
        sinAzar(() => {
          for (const i of ordenados) {
            saltando.posicion(personas[0] as number, d.tCrown + 5);
            expect(foto(saltando, personas, horaDe(i)), `saltando, cuadro ${i}`).toEqual(directo.get(i));
          }
        });

        // Contra las series de la marcha, pasadas a píxeles, y contra el piso de cada fila.
        const series = seriesDelShow(d);
        const porId = new Map(series.series.map((s) => [s.id, s]));
        const tr = crearTrayectorias(d, geo);
        for (const i of ordenados) {
          const t = horaDe(i);
          if (t < series.t0 || t > d.tCrown) continue;
          const si = Math.round((t - series.t0) / series.dt);
          for (const p of personas) {
            const s = porId.get(p);
            if (!s || !s.corre[si]) continue;
            const pos = tr.posicion(p, t);
            if (t < d.tAbre) {
              const caeP = d.tiempos.cae.get(p) ?? Infinity;
              if ((t <= d.tCarriles || !d.lanes.includes(p)) && t < caeP - ECHADA_ANTES) expect(pos.y, `fila de ${p} en ${t}`).toBeCloseTo(geo.forma.yPie(tr.filaDe(p)) + tr.signoDe(p) * tr.delta(), 9);
              expect(pos.x, `x de ${p} en ${t}`).toBeCloseTo(geo.F0 + d.dist(Math.min(t, d.tAbre)) * W + (s.x[si] as number) * geo.cuerpo, 6);
            } else {
              const q = d.q(t);
              expect(pos.x, `x recta de ${p} en ${t}`).toBeCloseTo(geo.Xs + q * RECTA * W + (s.x[si] as number) * geo.cuerpo, 6);
            }
          }
        }

        // Las muestras son las posiciones, una por una.
        const muestras = tr.muestras(d.tSalida, d.tSalida + 2, 1 / 30);
        for (const p of personas) {
          const a = muestras.get(p) as Float64Array;
          for (let i = 0; i <= 60; i++) {
            const pos = tr.posicion(p, d.tSalida + i / 30);
            expect(a[i * 4]).toBeCloseTo(pos.x, 12);
            expect(a[i * 4 + 1]).toBeCloseTo(pos.y, 12);
            expect(a[i * 4 + 2]).toBeCloseTo(pos.alza ?? 0, 12);
            expect(a[i * 4 + 3]).toBeCloseTo(pos.esc, 12);
          }
        }
      });
    }
  }
});

describe("la echada se abre hacia su lado", () => {
  for (const [w, h, n, semillas] of [[1366, 768, 18, [1, 2, 3]], [390, 844, 30, [1, 2]], [844, 390, 30, [3]]] as const) {
    it(`con ${n} en ${w}x${h}: sale de su subfila hacia su lado, con los topes de la marcha, y las de su fila que corren pasan al lado`, () => {
      for (const semilla of semillas) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const geo = geometria(d, pantallaDe(w, h));
        const tr = crearTrayectorias(d, geo);
        expect(d.tiempos.echadas.length).toBeGreaterThan(0);
        const abre = tr.apertura();
        expect(abre).toBeCloseTo(aperturaEchada(geo.forma.esc, geo.forma.altoFila), 9);
        for (const e of d.tiempos.echadas) {
          const p = e.quien, cae = e.t;
          const fila = tr.filaDe(p), yFila = geo.forma.yPie(fila);
          const s = tr.signoDe(p);
          expect([-1, 1]).toContain(s);
          // Antes de que empiece a abrirse, va en su subfila.
          expect(tr.posicion(p, cae - ECHADA_ANTES - 0.1).y).toBeCloseTo(yFila + s * tr.delta(), 9);
          // Abierta del todo, quedó hacia su lado (nunca cruza la otra subfila), y ahí se queda. En una fila de dos o menos no se abre.
          const enSuFila = d.gente.filter((q) => tr.filaDe(q) === fila).length;
          expect(tr.aperturaDe(p)).toBeCloseTo(enSuFila >= ABRE_DESDE ? abre : tr.delta(), 12);
          const abierta = tr.posicion(p, cae - ECHADA_ANTES + ECHADA_ABRE + 0.3).y;
          expect(abierta).toBeCloseTo(yFila + s * tr.aperturaDe(p), 6);
          expect(tr.posicion(p, cae + 3).y).toBeCloseTo(abierta, 9);
          // Los topes del corrimiento (M3): velocidad y aceleración laterales, en cuerpos (la fila vale `FILA_CUERPOS`), muestreadas fino.
          const paso = 1 / 240;
          let anterior: number | null = null, velAnterior = 0, velMax = 0, acelMax = 0;
          for (let t = cae - ECHADA_ANTES; t <= cae - ECHADA_ANTES + ECHADA_ABRE + paso; t += paso) {
            const y = (tr.posicion(p, t).y / geo.forma.altoFila) * FILA_CUERPOS;
            if (anterior !== null) {
              const vel = Math.abs(y - anterior) / paso;
              velMax = Math.max(velMax, vel);
              if (velAnterior > 0) acelMax = Math.max(acelMax, Math.abs(vel - velAnterior) / paso);
              velAnterior = vel;
            }
            anterior = y;
          }
          expect(velMax).toBeLessThanOrEqual(0.7);
          expect(acelMax).toBeLessThanOrEqual(1.25);
          // Ya abierta, la de su misma fila que sigue corriendo nunca se le encima más del 10 por ciento del cuerpo más chico.
          for (let t = cae + ECHADA_ABRE - ECHADA_ANTES; t <= Math.min(cae + 6, d.tAbre); t += 1 / 60) {
            const pe = tr.posicion(p, t);
            for (const q of d.gente) {
              if (q === p || tr.filaDe(q) !== fila || (d.tiempos.cae.get(q) ?? Infinity) <= t) continue;
              expect(encimado(pe, tr.posicion(q, t)), `${q} sobre la echada ${p} a los ${t}, ${w}x${h}`).toBeLessThanOrEqual(0.1);
            }
          }
        }
      }
    });
  }

  it("la apertura deja pasar a la de su subfila y no llega a la subfila de la fila vecina, en todas las pantallas", () => {
    for (const [w, h] of [[1366, 768], [1920, 1080], [844, 390], [390, 844]] as const) {
      for (const n of [10, 14, 18, 24, 30, 39]) {
        const d = planCarrera(ctxDe(n, 1)).datos;
        const geo = geometria(d, pantallaDe(w, h));
        const tr = crearTrayectorias(d, geo);
        const dos = 2 * medioAncho3D(geo.forma.esc);
        const abre = tr.apertura();
        // De la de su subfila (en δ) a la echada abierta, y de la echada a la subfila más cercana de la fila vecina.
        expect(abre - tr.delta(), `${w}x${h} con ${n}`).toBeGreaterThanOrEqual(PASA * dos - 1e-9);
        expect(geo.forma.altoFila - abre - tr.delta(), `${w}x${h} con ${n}`).toBeGreaterThanOrEqual(PASA * dos - 1e-9);
      }
    }
  });

  it("al echarse no salta la velocidad: sale con la suya y frena parejo, con uno de los frenados", () => {
    let echadas = 0;
    const elegidos = new Map<number, number>();
    for (const [w, h] of [[1366, 768], [390, 844]] as const) {
      for (const n of [18, 30]) {
        for (const semilla of [1, 2, 3]) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const geo = geometria(d, pantallaDe(w, h));
          const tr = crearTrayectorias(d, geo);
          for (const e of d.tiempos.echadas) {
            const p = e.quien, cae = e.t;
            const T = tr.frenadoDe(p);
            expect(FRENADOS).toContain(T);
            elegidos.set(T, (elegidos.get(T) ?? 0) + 1);
            const h0 = 1 / 480;
            const vAntes = (tr.posicion(p, cae - h0).x - tr.posicion(p, cae - 2 * h0).x) / h0 / geo.cuerpo;
            const vDespues = (tr.posicion(p, cae + 2 * h0).x - tr.posicion(p, cae + h0).x) / h0 / geo.cuerpo;
            // M3: menos de 0,05 cuerpos por segundo de salto (lo que cambia en dos cuadritos de 1/480 s frenando es mucho menos).
            expect(Math.abs(vDespues - vAntes), `${w}x${h} n=${n} s=${semilla} persona ${p}`).toBeLessThan(0.05);
            // Queda quieta donde la deja su frenado: su lugar al echarse más su velocidad por la mitad del frenado.
            const v0 = velocidadAlEcharse(d, p, cae);
            const lg = tr.lugarEnGrupo(p, cae) as { x: number };
            expect(tr.posicion(p, cae + T + 0.5).x).toBeCloseTo(lg.x + (v0 * geo.cuerpo * T) / 2, 6);
            // Nunca frena más fuerte que el frenado de siempre con esa velocidad.
            expect(T).toBeGreaterThanOrEqual(FRENADO);
            echadas++;
          }
        }
      }
    }
    expect(echadas).toBeGreaterThan(50);
    console.log(`frenados elegidos: ${[...elegidos].sort((a, b) => a[0] - b[0]).map(([T, k]) => `${T} s en ${k}`).join(", ")}`);
  });

  it("con las subfilas apagadas, todo como antes: en la línea de su fila, la echada abierta 0,45 de fila y el frenado de siempre", () => {
    for (const n of [18, 30]) {
      const d = planCarrera(ctxDe(n, 4)).datos;
      const geo = geometria(d, PANTALLA, { subfila: 0 });
      const tr = crearTrayectorias(d, geo);
      expect(tr.delta()).toBe(0);
      expect(tr.apertura()).toBeCloseTo(ECHADA_COSTADO * geo.forma.altoFila, 12);
      for (const p of d.gente) {
        expect(tr.signoDe(p)).toBe(0);
        expect(tr.frenadoDe(p)).toBe(FRENADO);
        expect(tr.lugarEnGrupo(p, d.tSalida + 2)?.y).toBe(geo.forma.yPie(tr.filaDe(p)));
      }
      // La echada frena con la velocidad del frente en 1,2 s, como antes.
      for (const e of d.tiempos.echadas) {
        const lg = tr.lugarEnGrupo(e.quien, e.t) as { x: number };
        const v0 = (geo.F0 + d.dist(e.t) * geo.ancho - (geo.F0 + d.dist(e.t - 0.1) * geo.ancho)) / 0.1;
        expect(tr.posicion(e.quien, e.t + 2).x).toBeCloseTo(lg.x + v0 * 0.6, 6);
      }
    }
  });

  it("las subfilas no tocan la x ni el tamaño: corriendo y en la recta, lo mismo que sin ellas", () => {
    for (const n of [8, 18, 30]) {
      for (const semilla of [1, 2]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const con = crearTrayectorias(d, geometria(d));
        const sin = crearTrayectorias(d, geometria(d, PANTALLA, { subfila: 0 }));
        const personas = [...new Set([...d.gente, ...d.lanes])];
        for (let t = d.tSalida; t <= d.tCrown; t += 0.25) {
          for (const p of personas) {
            if ((d.tiempos.cae.get(p) ?? Infinity) <= t) continue;
            const a = con.posicion(p, t), b = sin.posicion(p, t);
            expect(a.x, `persona ${p} a los ${t}`).toBe(b.x);
            expect(a.esc, `persona ${p} a los ${t}`).toBe(b.esc);
          }
        }
      }
    }
  });
});

describe("nadie pasa a través de nadie en el grupo ni al pasar a los carriles", () => {
  // Lo que mide el auditor de sólidos (llama contra llama en el grupo y al pasar a los carriles), con la huella del 3D, a 20 cuadros por
  // segundo: dos que corren nunca se enciman más del 10 % del cuerpo más chico.
  for (const [w, h] of [[1366, 768], [1920, 1080], [844, 390], [390, 844]] as const) {
    for (const n of [8, 18, 30]) {
      it(`con ${n} en ${w}x${h}`, () => {
        const fallas: string[] = [];
        for (const semilla of [1, 2, 3, 4, 5, 6]) {
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const tr = crearTrayectorias(d, geometria(d, pantallaDe(w, h)));
          const personas = [...new Set([...d.gente, ...d.lanes])];
          const hasta = Math.min(d.tCrown, d.tCarriles + 8);
          for (let t = d.tSalida; t <= hasta; t += 1 / 20) {
            const corren = personas.filter((p) => (d.tiempos.cae.get(p) ?? Infinity) > t).map((p) => ({ p, pos: tr.posicion(p, t) })).sort((a, b) => a.pos.x - b.pos.x);
            for (let a = 0; a < corren.length; a++) {
              for (let b = a + 1; b < corren.length; b++) {
                const A = corren[a] as { p: number; pos: Posicion }, B = corren[b] as { p: number; pos: Posicion };
                if (B.pos.x - 36 * B.pos.esc * TAM3D > A.pos.x + 38 * A.pos.esc * TAM3D) break;
                const v = encimado(A.pos, B.pos);
                if (v > 0.1 && fallas.length < 12) fallas.push(`semilla ${semilla}, ${t.toFixed(2)} s: ${A.p} y ${B.p} (filas ${tr.filaDe(A.p)} y ${tr.filaDe(B.p)}) un ${(v * 100).toFixed(0)} %`);
              }
            }
          }
        }
        expect(fallas, fallas.join("\n")).toEqual([]);
      });
    }
  }
});

describe("las piedras, la escupida y el remolino caen donde está la llama", () => {
  // Con 80 y 130 hay tandas y nadie más en el grupo: la recta se abre en la salida y las finalistas pasan a sus carriles hasta pasada la mitad.
  // Las piedras recién caen en C3.
  for (const n of [8, 18, 80, 130]) {
    it(`con ${n}: piedras, boca, cara y rayas van donde pisa la llama y con su tamaño a esa hora, y con el paso tarde no hay piedras antes de C3`, () => {
      for (const semilla of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const geo = geometria(d);
        const tr = crearTrayectorias(d, geo);
        const vista = crearVistaObstaculos(d, { xs: geo.Xs, largo: RECTA * W, ancho: W, esc: geo.carr.esc, u: U, altoFila: geo.carr.altoFila, yPie: (k) => geo.carr.yPie(k), piso: (k, t) => tr.piso(k, t), escEn: (k, t) => tr.escEn(k, t) });
        // El paso tarde: empieza después de abrirse la recta (con ocho o menos empieza al abrirse, y con grupo, antes).
        const tarde = d.tCarriles > d.tAbre + 1;
        expect(tarde, `semilla ${semilla}`).toBe(n === 80 || n === 130);
        const llama = (k: number, t: number): Posicion => tr.posicion(d.lanes[k] as number, t);
        for (const [id, o] of (d.final.obstaculos ?? []).entries()) {
          if (o.tipo === "piedras") {
            // Con el paso tarde, las piedras solo en C3 (de 0,61 a 0,64): en C2 todavía hay finalistas que comparten fila.
            if (tarde) expect(o.ventana[0], `semilla ${semilla}`).toBe((VENTANAS_C[2] as readonly [number, number])[0]);
            // Caen delante de donde está ella en ese cuadro y en su línea: `f.x` y `f.y` son su lugar, y la piedra grande cae delante de su
            // hocico (la huella del 3D, la más grande).
            const ahora = d.tDeQ(o.q);
            const f = vista.efectos(ahora).find((e) => e.id === id);
            const ya = llama(o.carriles[0] as number, ahora);
            expect(f?.y, `semilla ${semilla}`).toBeCloseTo(ya.y, 6);
            expect(f?.x, `semilla ${semilla}`).toBeCloseTo(ya.x, 3);
            const grande = f?.piedras?.[0];
            expect(grande && grande.x - grande.r, `semilla ${semilla}`).toBeGreaterThan(ya.x + 38 * ya.esc * TAM3D);
          } else if (o.tipo === "escupida") {
            const t0 = d.tDeQ(o.q);
            const f = vista.efectos(t0 + 0.1).find((e) => e.id === id);
            const a = llama(o.escupe, t0), b = llama(o.carriles[0] as number, t0 + 0.35);
            expect(f?.boca?.y, `semilla ${semilla}`).toBeCloseTo(a.y, 6);
            expect(f?.cara?.y, `semilla ${semilla}`).toBeCloseTo(b.y, 6);
            // El hocico y la altura de la boca salen del tamaño de cada llama a esa hora, no del de su carril.
            expect(f?.boca?.esc, `semilla ${semilla}`).toBeCloseTo(a.esc, 9);
            expect(f?.cara?.esc, `semilla ${semilla}`).toBeCloseTo(b.esc, 9);
            expect(f?.boca?.x, `semilla ${semilla}`).toBeCloseTo(a.x + LLAMA_HOCICO * a.esc, 3);
            expect(f?.cara?.x, `semilla ${semilla}`).toBeCloseTo(b.x + LLAMA_HOCICO * b.esc, 3);
          } else if (o.tipo === "viento") {
            // En el pico del empujón: las rayas van de donde pisa la primera del remolino a donde pisa la última, aunque todavía estén pasando
            // de sus filas del grupo a sus carriles.
            const k0 = Math.min(...o.carriles), k1 = Math.max(...o.carriles);
            let t = d.tDeQ(o.q), pico = 0;
            for (let s = d.tDeQ(o.q - 0.02); s <= d.tDeQ(o.q + o.dur * 1.7); s += 1 / 30) {
              const l = Math.abs(d.final.lateral?.(k0, d.q(s)) ?? 0);
              if (l > pico) [pico, t] = [l, s];
            }
            const f = vista.efectos(t).find((e) => e.id === id);
            expect(f?.y, `semilla ${semilla}`).toBeCloseTo(llama(k0, t).y, 6);
            expect(f?.y1, `semilla ${semilla}`).toBeCloseTo(llama(k1, t).y, 6);
          }
        }
      }
    });
  }
});
