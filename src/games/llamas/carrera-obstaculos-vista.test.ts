import { type Group, type Mesh, type MeshBasicMaterial, Scene } from "three";
import { describe, expect, it, vi } from "vitest";
import type { Efecto3D } from "./carrera-3d-mapa";
import { crearEfectos3D, type Efectos3D } from "./carrera-3d-obstaculos";
import { carrilesDe, formaDe, LLAMA_HOCICO } from "./carrera-forma";
import { CUERPO } from "./carrera-marcha";
import { ENSANCHE } from "./carrera-obstaculos";
import { crearTrayectorias } from "./carrera-trayectorias";
import { crearVistaObstaculos, type GeometriaVista, type VistaObstaculos } from "./carrera-obstaculos-vista";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera, type Datos } from "./carrera-show";
import { posturaObstaculo } from "./llama-obstaculos";

/**
 * La prueba de los dos caminos de los obstáculos: lo que se ve en un cuadro (los efectos que dibujan el 2D y el 3D, a quién le pasa algo, la
 * postura y el lugar de cada carril, y cada pieza del 3D) sale idéntico llamado directo a esa hora, avanzando cuadro a cuadro a 60 por segundo
 * desde que se abre la recta, y saltando hacia adelante y volviendo. Sin `Math.random` y sin objetos nuevos por cuadro.
 */

vi.setConfig({ testTimeout: 120_000 });

const W = 1366, H = 768, U = W / 1920;
const PANTALLA = { w: W, h: H, u: U, retrato: false, top: 60 * U, bottom: H - 90 * U };

/** La geometría de la escena, con dónde pisa y de qué tamaño es cada finalista a cada hora sacados de las trayectorias, como en `carrera.ts`. */
const geometria = (d: Datos): GeometriaVista => {
  const forma = formaDe(PANTALLA, Math.max(1, d.gente.length), 22 * U, 110 * U);
  const cuerpo = CUERPO * ENSANCHE * RECTA * W;
  forma.profundidad = Math.max(0, d.gente.length - 1) * d.orden.entrePuestos * cuerpo;
  const carr = carrilesDe(PANTALLA, d.lanes.length, 22 * U);
  const F0 = -(60 * U + LLAMA_HOCICO * forma.esc);
  const Xs = F0 + d.distAbre * W;
  const tr = crearTrayectorias(d, { F0, Xs, ancho: W, cuerpo, forma, carr, caminata: null });
  return { xs: Xs, largo: RECTA * W, ancho: W, esc: carr.esc, u: U, altoFila: carr.altoFila, yPie: (k) => carr.yPie(k), piso: (k, t) => tr.piso(k, t), escEn: (k, t) => tr.escEn(k, t) };
};

/** Lo que se dibuja en `t`, copiado (la vista reescribe sus objetos en cada llamada). */
function foto(d: Datos, vista: VistaObstaculos, tres: Efectos3D, piezas: readonly Mesh[], t: number) {
  const ef = vista.efectos(t);
  const efectos = ef.map((f) => ({ ...f, boca: f.boca ? { ...f.boca } : undefined, cara: f.cara ? { ...f.cara } : undefined, piedras: f.piedras?.map((p) => ({ ...p })) }));
  const apuros = [...vista.enApuros(t)];
  const marcadas = d.lanes.map((persona) => vista.marcada(persona, t));
  tres.frame(ef, U);
  const q = d.q(t);
  const carriles = d.lanes.map((_, k) => {
    const m = d.final.beatOf(k, q);
    return [d.final.pos(k, q), d.final.lateral?.(k, q) ?? 0, d.final.salto?.(k, q) ?? 0, m?.kind ?? "", m?.p ?? 0, JSON.stringify(posturaObstaculo(m))];
  });
  // De las piezas del 3D se mira lo que se ve: las escondidas guardan el último lugar que tuvieron y no se dibujan.
  const piezas3D = piezas.map((m) => (m.visible ? [1, ...m.position.toArray(), ...m.scale.toArray(), m.rotation.x, m.rotation.y, m.rotation.z, (m.material as MeshBasicMaterial).opacity] : [0]));
  return { efectos, apuros, marcadas, carriles, piezas3D };
}

function armar3D(): { tres: Efectos3D; piezas: Mesh[] } {
  const escena = new Scene();
  // Three sortea los identificadores al crear cada pieza: el azar se mira solo mientras se dibuja.
  const tres = crearEfectos3D(escena, { add: <T extends { dispose(): void }>(x: T): T => x });
  return { tres, piezas: (escena.children[0] as Group).children as Mesh[] };
}

/** Corre `f` con `Math.random` prohibido. */
function sinAzar<T>(f: () => T): T {
  const espia = vi.spyOn(Math, "random").mockImplementation(() => {
    throw new Error("Math.random en el camino de los obstáculos");
  });
  try {
    return f();
  } finally {
    espia.mockRestore();
  }
}

describe("los obstáculos, por los dos caminos", () => {
  const vistos = new Set<string>();
  for (const n of [8, 18, 60]) {
    for (const semilla of [1, 2, 3, 4, 5, 6]) {
      it(`con ${n}, semilla ${semilla}: el mismo cuadro directo, avanzando a 60 por segundo y saltando`, () => {
        const d = planCarrera(ctxDe(n, semilla)).datos;
        const obs = d.final.obstaculos ?? [];
        expect(obs.length).toBeGreaterThan(0);
        const geo = geometria(d);
        // Las horas que se miran: de T0 − 2 a T0 + 4 cada 0,25 s de cada obstáculo, en un cuadro exacto de 60 por segundo desde que se abre la recta.
        const cuadros = new Set<number>();
        for (const o of obs) {
          vistos.add(o.tipo);
          const t0 = d.tDeQ(o.q);
          for (let j = 0; j <= 24; j++) {
            const i = Math.round((t0 - 2 + j * 0.25 - d.tAbre) * 60);
            if (i >= 0) cuadros.add(i);
          }
        }
        const ultimo = Math.max(...cuadros);
        const horaDe = (i: number): number => d.tAbre + i / 60;

        // (a) Directo: una vista y un 3D nuevos para cada hora.
        const directo = new Map<number, ReturnType<typeof foto>>();
        for (const i of cuadros) {
          const a3 = armar3D();
          const va = crearVistaObstaculos(d, geo);
          directo.set(i, sinAzar(() => foto(d, va, a3.tres, a3.piezas, horaDe(i))));
        }

        // (b) Avanzando: una sola vista y un solo 3D, cuadro a cuadro. El arreglo y sus objetos son siempre los mismos.
        const b3 = armar3D();
        const vb = crearVistaObstaculos(d, geo);
        const arreglos = new Set<Efecto3D[]>();
        const objetos = new Set<Efecto3D>();
        const listas = new Set<readonly number[]>();
        let conEfecto = 0;
        sinAzar(() => {
          for (let i = 0; i <= ultimo; i++) {
            const t = horaDe(i);
            const ef = vb.efectos(t);
            arreglos.add(ef);
            for (const f of ef) objetos.add(f);
            if (ef.length) conEfecto++;
            listas.add(vb.enApuros(t));
            b3.tres.frame(ef, U);
            if (cuadros.has(i)) expect(foto(d, vb, b3.tres, b3.piezas, t), `avanzando, cuadro ${i}`).toEqual(directo.get(i));
          }
        });
        expect(arreglos.size).toBe(1);
        expect(listas.size).toBe(1);
        expect(objetos.size).toBeLessThanOrEqual(obs.length);
        if (obs.some((o) => o.tipo !== "salto")) expect(conEfecto).toBeGreaterThan(0);

        // (c) Saltando: a T0 + 6 y de vuelta a cada hora.
        const c3 = armar3D();
        const vc = crearVistaObstaculos(d, geo);
        sinAzar(() => {
          for (const o of obs) {
            const lejos = d.tDeQ(o.q) + 6;
            for (const i of cuadros) {
              vc.efectos(lejos);
              vc.enApuros(lejos);
              c3.tres.frame(vc.efectos(lejos), U);
              expect(foto(d, vc, c3.tres, c3.piezas, horaDe(i)), `saltando, cuadro ${i}`).toEqual(directo.get(i));
            }
          }
        });
      });
    }
  }

  it("las rondas de la prueba pasan por los cuatro obstáculos", () => {
    expect([...vistos].sort()).toEqual(["escupida", "piedras", "salto", "viento"]);
  });
});
