import { readFileSync } from "node:fs";
import { gsap } from "gsap";
import { describe, expect, it } from "vitest";
import { segundosDe } from "../../duraciones";
import { tiemposFoco } from "../pixi/foco";
import type { Plan } from "../pixi/kit";
import { tamanoLetra } from "../pixi/kit/nombres";
import {
  ACERCA_FINAL_2D, ALTO_FESTEJO, DUR_ACERCA_2D, LLEGADA_ANTES, FOTO_DESPUES, GIRO_MAX, GIRO_PICO, RAMPA_CARTEL, VIAJE_MAX, ZOOM_FOTO_MAX, ZOOM_MAX, ZOOM_PICO,
  ampliacionDe, anguloEntre, cajaEnPantalla, cajaFinal2D, crearCamara3D, ejeDe, proyectar, zoomDeCaja, zoomFinal2D, type Plano, type Puesto,
} from "./carrera-camara";
import { PANTALLAS, correr, puestosDe, type Corrida, type Cuadro, type Hueco } from "./carrera-camara-prueba";
import { TAM3D, ZC, camara3D, escala3D, type Pose3D } from "./carrera-3d-mapa";
import { LLAMA_ALTO } from "./carrera-forma";
import { TARJETA } from "./carrera-base";
import { LLAMA_HOCICO, carrilesDe } from "./carrera-forma";
import { ctxDe } from "./carrera-prueba";
import { RECTA, planCarrera, type Datos } from "./carrera-show";

/**
 * La cámara del 3D de la carrera, sin navegador: se corre sobre rondas de verdad (`planCarrera`) a 60 cuadros por segundo y todo se mide por
 * la geometría de la cámara (la proyección de three.js): topes de giro y de acercamiento, alto de las llamas en la pantalla en cada tramo y
 * que sea la misma ronda cuadro por cuadro. Lo que dice `medir-escala-carrera` se mide con un navegador; esto lo cuenta antes.
 */

const TAMANOS = [2, 3, 8, 18, 60];
const SEMILLAS = [1, 2, 3, 4, 5, 6];

const cuantil = (xs: readonly number[], q: number): number => {
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.max(0, Math.floor(q * o.length)))] as number;
};
const minimo = (xs: readonly number[]): number => xs.reduce((a, b) => Math.min(a, b), Infinity);

/** Lo que importa de una ronda, en una pasada: se guarda esto y no los 14.000 cuadros. Los altos se toman de a un cuadro de cada seis. */
interface Resumen {
  giroMax: number;
  zoomMax: number;
  fotoMax: number;
  recta: number[];
  final: number[];
  festejo: number[];
  visiblesMin: number;
  cortes: { plano: Plano; t: number }[];
  d: Corrida["d"];
  tGolpe: number;
}
const resumenes = new Map<string, Resumen>();
function resumen(n: number, semilla: number, pantalla: keyof typeof PANTALLAS): Resumen {
  const clave = `${pantalla}|${n}|${semilla}`;
  const dado = resumenes.get(clave);
  if (dado) return dado;
  const c = correr(n, semilla, PANTALLAS[pantalla], 6);
  const r: Resumen = { giroMax: 0, zoomMax: 0, fotoMax: 0, recta: [], final: [], festejo: [], visiblesMin: Infinity, cortes: [], d: c.d, tGolpe: c.tGolpe };
  const gan = c.d.lanes.indexOf(c.d.campeona);
  c.cuadros.forEach((f, i) => {
    const sub = i % 6 === 0;
    if (f.corte && f.plano !== "base") r.cortes.push({ plano: f.plano, t: f.t });
    if (i > 0 && !f.corte) {
      const a = c.cuadros[i - 1] as Cuadro, dt = f.t - a.t;
      r.giroMax = Math.max(r.giroMax, anguloEntre(ejeDe(a.pose), ejeDe(f.pose)) / dt);
      const z = Math.abs(ampliacionDe(f.pose) - ampliacionDe(a.pose)) / dt;
      if (f.foto) r.fotoMax = Math.max(r.fotoMax, z);
      else r.zoomMax = Math.max(r.zoomMax, z);
    }
    if (f.t >= c.d.tAbre + 1 && f.t < c.d.tCrown - LLEGADA_ANTES) {
      r.visiblesMin = Math.min(r.visiblesMin, f.altos.filter((a) => a.visible).length);
      if (sub) f.altos.forEach((a) => a.visible && r.recta.push(a.alto));
    } else if (f.t >= c.d.tCrown - LLEGADA_ANTES && f.t < c.d.tCrown && sub) {
      const delante = f.puestos.map((p, j) => [p.x + LLAMA_HOCICO * p.esc, j] as const).sort((x, y) => y[0] - x[0]).slice(0, 3);
      for (const [, j] of delante) if ((f.altos[j] as { visible: boolean }).visible) r.final.push((f.altos[j] as { alto: number }).alto);
    } else if (f.t >= c.tGolpe + 1 && sub) {
      const a = f.altos[gan] as { alto: number; visible: boolean };
      if (a.visible) r.festejo.push(a.alto);
    }
  });
  resumenes.set(clave, r);
  return r;
}

/** Una ronda entera, cuadro por cuadro (para lo que mira cuadros sueltos): se corre cuando hace falta y no se guarda. */
const entera = (n: number, semilla: number, pantalla: keyof typeof PANTALLAS): Corrida => correr(n, semilla, PANTALLAS[pantalla], 6);

describe("proyección: la cuenta de la prueba es la de three.js", () => {
  const pose = { pos: [10, 3, 20] as [number, number, number], mira: [10, 1, 0] as [number, number, number], fov: (30 * Math.PI) / 180, giro: 0 };
  it("el punto que se mira cae en el centro de la pantalla", () => {
    const p = proyectar(pose, 1920, 1080, pose.mira);
    expect(p.x).toBeCloseTo(960, 6);
    expect(p.y).toBeCloseTo(540, 6);
    expect(p.prof).toBeGreaterThan(0);
  });
  it("un punto a la derecha cae a la derecha y uno de arriba cae arriba", () => {
    const d = proyectar(pose, 1920, 1080, [12, 1, 0]);
    const a = proyectar(pose, 1920, 1080, [10, 3, 0]);
    expect(d.x).toBeGreaterThan(960);
    expect(a.y).toBeLessThan(540);
  });
  it("a la distancia d, un objeto de alto h mide H · h / (2 · d · tan(fov/2)) píxeles", () => {
    const frente = { pos: [0, 1, 30] as [number, number, number], mira: [0, 1, 0] as [number, number, number], fov: (30 * Math.PI) / 180, giro: 0 };
    const a = proyectar(frente, 1920, 1080, [0, 1 + 1, 0]);
    const b = proyectar(frente, 1920, 1080, [0, 1 - 1, 0]);
    expect(b.y - a.y).toBeCloseTo((1080 * 2) / (2 * 30 * Math.tan((15 * Math.PI) / 180)), 6);
  });
});

describe("los topes de movimiento de la cámara", () => {
  for (const pantalla of ["proyector", "celular"] as const) {
    for (const n of TAMANOS) {
      it(`${pantalla}, ${n} personas: el eje no gira más de 30 grados por segundo ni la ampliación cambia más de 1,5 veces por segundo`, () => {
        let giroMax = 0, zoomMax = 0, fotoMax = 0;
        for (const semilla of SEMILLAS) {
          const r = resumen(n, semilla, pantalla);
          giroMax = Math.max(giroMax, r.giroMax);
          zoomMax = Math.max(zoomMax, r.zoomMax);
          fotoMax = Math.max(fotoMax, r.fotoMax);
        }
        expect(giroMax).toBeLessThanOrEqual(GIRO_MAX);
        expect(zoomMax).toBeLessThanOrEqual(ZOOM_MAX);
        expect(fotoMax).toBeLessThanOrEqual(ZOOM_FOTO_MAX);
        // Los cambios de plano van con el pico que se fijó (el resto del margen es para lo que corre a la vez).
        expect(giroMax).toBeLessThanOrEqual(GIRO_PICO + 1e-3);
        expect(zoomMax).toBeLessThanOrEqual(ZOOM_PICO + 1e-3);
      });
    }
  }

  it("el riel de la recta no gira: ya instalado, el eje queda quieto mientras el grupo corre", () => {
    for (const n of [8, 18]) {
      const c = entera(n, 3, "proyector");
      const riel = c.cuadros.filter((f) => f.plano === "recta" && f.t > c.d.tAbre + 3 && f.t < c.d.tCrown - LLEGADA_ANTES - 0.1);
      expect(riel.length).toBeGreaterThan(300);
      let giro = 0;
      for (let i = 1; i < riel.length; i++) giro = Math.max(giro, anguloEntre(ejeDe((riel[i - 1] as Cuadro).pose), ejeDe((riel[i] as Cuadro).pose)) / ((riel[i] as Cuadro).t - (riel[i - 1] as Cuadro).t));
      expect(giro).toBeLessThan(0.5 * (Math.PI / 180));
    }
  });

  it("en el proyector la cámara no corta nunca (de la base al festejo es un solo viaje); en el celular, solo al festejo (donde el viaje esconde a la ganadora detrás del pelotón)", () => {
    for (const pantalla of ["proyector", "celular"] as const) {
      const r = resumen(18, 2, pantalla);
      expect(r.cortes.map((c) => c.plano)).toEqual(pantalla === "proyector" ? [] : ["festejo"]);
      if (pantalla === "celular") expect((r.cortes[0] as { plano: Plano; t: number }).t).toBeCloseTo(r.tGolpe, 1);
    }
  });

  it("en la llegada la cámara viaja, no salta: la posición de la cámara se mueve menos que el tope del riel", () => {
    for (const pantalla of ["proyector", "celular"] as const) {
      for (const n of [8, 18]) {
        const c = entera(n, 3, pantalla);
        const hl = LLAMA_ALTO * c.carr.esc * escala3D(c.P.u) * TAM3D;
        const llegada = c.cuadros.filter((f) => f.plano === "llegada" || (f.plano === "recta" && f.t >= c.d.tCrown - LLEGADA_ANTES - 0.5));
        expect(llegada.length).toBeGreaterThan(150);
        let viaje = 0;
        for (let i = 1; i < llegada.length; i++) {
          const a = llegada[i - 1] as Cuadro, b = llegada[i] as Cuadro;
          viaje = Math.max(viaje, Math.hypot(b.pose.pos[0] - a.pose.pos[0], b.pose.pos[1] - a.pose.pos[1], b.pose.pos[2] - a.pose.pos[2]) / (b.t - a.t));
        }
        expect(viaje / hl, `${pantalla}, ${n} personas: alturas de llama por segundo`).toBeLessThanOrEqual(VIAJE_MAX);
      }
    }
  });
});

describe("el alto de las llamas en la pantalla, por la geometría de la cámara", () => {
  it("1080p, recta: las finalistas miden 150 px o más de mediana y ninguna menos de 100", () => {
    const altos: number[] = [];
    for (const n of TAMANOS) for (const semilla of SEMILLAS) altos.push(...resumen(n, semilla, "proyector").recta);
    expect(altos.length).toBeGreaterThan(5000);
    expect(cuantil(altos, 0.5)).toBeGreaterThanOrEqual(150);
    expect(minimo(altos)).toBeGreaterThanOrEqual(100);
  });

  it("1080p, recta: se ven siempre al menos seis de las ocho", () => {
    for (const semilla of SEMILLAS) expect(resumen(8, semilla, "proyector").visiblesMin).toBeGreaterThanOrEqual(6);
  });

  it("1080p, últimos 3 s: las tres de punta miden entre 200 y 450 px de mediana, y ninguna pasa de 450", () => {
    const altos: number[] = [];
    for (const n of TAMANOS) for (const semilla of SEMILLAS) altos.push(...resumen(n, semilla, "proyector").final);
    expect(cuantil(altos, 0.5)).toBeGreaterThanOrEqual(200);
    expect(cuantil(altos, 0.5)).toBeLessThanOrEqual(450);
    expect(altos.reduce((a, b) => Math.max(a, b), 0)).toBeLessThanOrEqual(450);
  });

  it("1080p, festejo: la ganadora mide 300 px o más de mediana, un segundo después del golpe, y no más que lo que deja el cartel", () => {
    const altos: number[] = [];
    for (const n of TAMANOS) for (const semilla of SEMILLAS) altos.push(...resumen(n, semilla, "proyector").festejo);
    expect(cuantil(altos, 0.5)).toBeGreaterThanOrEqual(300);
    expect(cuantil(altos, 0.5)).toBeLessThanOrEqual(ALTO_FESTEJO * 1080 * 1.1);
  });

  it("celular, recta: las llamas miden 70 px o más de mediana, y ninguna visible baja de 70", () => {
    const altos: number[] = [];
    for (const n of TAMANOS) for (const semilla of SEMILLAS) altos.push(...resumen(n, semilla, "celular").recta);
    expect(cuantil(altos, 0.5)).toBeGreaterThanOrEqual(70);
    expect(minimo(altos)).toBeGreaterThanOrEqual(70);
  });

  it("la ganadora, en el festejo, queda a la vista y no más grande que el tercio de abajo", () => {
    for (const n of [3, 8, 18]) for (const semilla of SEMILLAS.slice(0, 3)) {
      const c = entera(n, semilla, "proyector");
      const gan = c.d.lanes.indexOf(c.d.campeona);
      const f = c.cuadros[c.cuadros.length - 1] as Cuadro;
      expect(f.plano).toBe("festejo");
      const a = f.altos[gan] as { alto: number; visible: boolean };
      expect(a.visible).toBe(true);
      expect(a.alto).toBeLessThan(1080 * 0.45);
    }
  });
});

describe("la cámara no delata y es la misma ronda cuadro por cuadro", () => {
  const configDe = (c: Corrida) => ({ marco: { w: c.P.w, h: c.P.h, u: c.P.u }, tAbre: c.d.tAbre, tCrown: c.d.tCrown, tGolpe: c.tGolpe, metaX: c.metaX, carriles: { y0: c.carr.y0, y1: c.carr.y1, n: c.carr.n, esc: c.carr.esc } });

  it("es determinista: dos corridas de la misma ronda dan las mismas poses", () => {
    const a = correr(18, 5, PANTALLAS.proyector, 6);
    const b = correr(18, 5, PANTALLAS.proyector, 6);
    expect(b.cuadros.length).toBe(a.cuadros.length);
    for (let i = 0; i < a.cuadros.length; i += 7) expect(b.cuadros[i]?.pose).toEqual(a.cuadros[i]?.pose);
  });

  it("otra ronda mira distinto", () => {
    const a = correr(18, 1, PANTALLAS.proyector, 6);
    const b = correr(18, 2, PANTALLAS.proyector, 6);
    const i = Math.floor((Math.min(a.cuadros.length, b.cuadros.length) - 1) * 0.6);
    expect(JSON.stringify(a.cuadros[i]?.pose)).not.toBe(JSON.stringify(b.cuadros[i]?.pose));
  });

  it("no mira quién gana antes del golpe: con otra ganadora, las poses hasta el golpe son las mismas", () => {
    const c = entera(18, 4, "proyector");
    const otra = (c.d.campeona + 1) % 18;
    const cam = crearCamara3D(configDe(c));
    const base = (c.cuadros[0] as Cuadro).pose;
    for (const f of c.cuadros) {
      if (f.t >= c.tGolpe) break;
      expect(cam.cuadro({ t: f.t, puestos: f.puestos, puestosEn: c.puestosEn, base, ganadora: otra, golpeEn: null }).pose).toEqual(f.pose);
    }
  });

  it("la llegada termina en T mirando la línea de costado, quieta hasta la foto, y la foto sigue de ahí sin corte", () => {
    for (const pantalla of ["proyector", "celular"] as const) {
      for (const semilla of SEMILLAS.slice(0, 3)) {
        const c = entera(18, semilla, pantalla);
        const s = escala3D(c.P.u);
        const llegada = c.cuadros.filter((f) => f.plano === "llegada");
        expect(llegada.length).toBeGreaterThan(150);
        for (const f of llegada) expect(f.corte).toBe(false);
        // De T a la foto la cámara no se mueve: las llamas pararon en la línea y se ve quién tiene la nariz adelante.
        const quieta = llegada.filter((f) => f.t >= c.d.tCrown);
        expect(quieta.length).toBeGreaterThan(10);
        const enT = (quieta[0] as Cuadro).pose;
        for (const f of quieta) expect(f.pose).toEqual(enT);
        // Perpendicular a la línea y en su plano: la meta cae en el centro de la pantalla, vertical, en el carril de adelante y en el de atrás.
        for (const y of [c.carr.y0, c.carr.y1]) expect(proyectar(enT, c.P.w, c.P.h, [c.metaX * s, 0, y * s * ZC]).x).toBeCloseTo(c.P.w / 2, 6);
        // La foto arranca donde quedó la llegada.
        const foto = c.cuadros.find((f) => f.plano === "foto") as Cuadro;
        expect(foto.corte).toBe(false);
        expect(anguloEntre(ejeDe(foto.pose), ejeDe(enT))).toBeLessThan(1e-6);
        expect(Math.abs(ampliacionDe(foto.pose) - ampliacionDe(enT))).toBeLessThan(0.02);
      }
    }
  });

  it("la llegada no mira quién va adelante: a T mira la línea, estén donde estén las finalistas", () => {
    const c = entera(8, 2, "proyector");
    const enT = c.cuadros.find((f) => f.t >= c.d.tCrown) as Cuadro;
    const con = (puestos: Puesto[]) => crearCamara3D(configDe(c)).cuadro({ t: enT.t, puestos, base: (c.cuadros[0] as Cuadro).pose, ganadora: 0, golpeEn: null }).pose;
    // Las mismas finalistas corridas un cuerpo hacia atrás: la cámara de T es la misma.
    expect(con(enT.puestos.map((p) => ({ ...p, x: p.x - 40 * p.esc })))).toEqual(con(enT.puestos));
  });

  it("saltar al golpe (la hora salta de golpe) cae directo en el festejo, sin viaje", () => {
    const c = entera(18, 3, "proyector");
    const cam = crearCamara3D(configDe(c));
    const base = (c.cuadros[0] as Cuadro).pose;
    const medio = c.cuadros.find((f) => f.t >= c.d.tAbre + 4) as Cuadro;
    cam.cuadro({ t: medio.t, puestos: medio.puestos, puestosEn: c.puestosEn, base, ganadora: c.d.campeona, golpeEn: null });
    const fin = c.cuadros[c.cuadros.length - 1] as Cuadro;
    const s = cam.cuadro({ t: c.tGolpe + 0.02, puestos: fin.puestos, puestosEn: c.puestosEn, base, ganadora: c.d.campeona, golpeEn: c.tGolpe + 0.02 });
    expect(s.plano).toBe("festejo");
    expect(s.corte).toBe(true);
    expect(Number.isFinite(s.pose.pos[0] + s.pose.pos[1] + s.pose.pos[2])).toBe(true);
  });
});

describe("la cámara no depende de los cuadros: en una hora de la grilla es la misma con cualquier cadencia", () => {
  /** La misma tolerancia que la prueba de las fichas (`carrera-fichas-mov.test.ts`) para las horas que son pasos de la grilla. */
  const TOL = 1e-9;
  type Campo = readonly [string, number];
  const camposDe = (p: Pose3D): Campo[] => [
    ["pos.x", p.pos[0]], ["pos.y", p.pos[1]], ["pos.z", p.pos[2]], ["mira.x", p.mira[0]], ["mira.y", p.mira[1]], ["mira.z", p.mira[2]], ["fov", p.fov], ["giro", p.giro],
  ];
  /** Los cuadros que cayeron justo en un paso de la grilla (`k / 60`), por paso. */
  const porPaso = (c: Corrida): Map<number, Cuadro> => {
    const m = new Map<number, Cuadro>();
    for (const f of c.cuadros) {
      const k = Math.round(f.t * 60);
      if (Math.abs(f.t * 60 - k) < 1e-6) m.set(k, f);
    }
    return m;
  };
  /** La mayor diferencia de la cámara entre dos corridas en las horas de la grilla que tienen en común, y cuántas hay; de paso, que el plano sea el mismo. */
  const diferencia = (a: Corrida, b: Corrida, desdeT = -Infinity): { max: number; donde: string; comunes: number; planos: number } => {
    const pa = porPaso(a);
    let max = 0, donde = "", comunes = 0, planos = 0;
    for (const [k, f] of porPaso(b)) {
      const g = pa.get(k);
      if (!g || f.t < desdeT) continue;
      comunes++;
      if (f.plano !== g.plano) planos++;
      const x = camposDe(f.pose), y = camposDe(g.pose);
      for (let i = 0; i < x.length; i++) {
        const dd = Math.abs((x[i] as Campo)[1] - (y[i] as Campo)[1]);
        if (dd > max) (max = dd), (donde = `${(x[i] as Campo)[0]} en t = ${f.t.toFixed(3)} (${f.plano})`);
      }
    }
    return { max, donde, comunes, planos };
  };

  const CASOS = [
    { n: 18, semilla: 2, pantalla: "proyector" },
    { n: 8, semilla: 4, pantalla: "celular" },
  ] as const;

  for (const caso of CASOS) {
    const nombre = `${caso.pantalla}, ${caso.n} personas`;
    const corrida = (fps = 60, huecos: readonly Hueco[] = []): Corrida => correr(caso.n, caso.semilla, PANTALLAS[caso.pantalla], 6, fps, huecos);

    it(`${nombre}: con cuadros a 30, 20 y 120 por segundo, la cámara en cada paso de la grilla es la de 60 por segundo`, () => {
      const base = corrida(60);
      for (const fps of [30, 20, 120]) {
        const r = diferencia(base, corrida(fps));
        expect(r.comunes, `${fps} cuadros por segundo`).toBeGreaterThan(300);
        expect(r.planos, `${fps} cuadros por segundo: el plano`).toBe(0);
        expect(r.max, `${fps} cuadros por segundo: ${r.donde}`).toBeLessThanOrEqual(TOL);
      }
    });

    it(`${nombre}: con un cuadro de 0,6 s en el medio (al abrirse la recta, en la recta, al cortar a la meta, en la foto y sobre el golpe) la cámara sigue igual en cada paso`, () => {
      const base = corrida(60);
      const { d } = base;
      const huecos: { donde: string; desde: number }[] = [
        { donde: "antes de abrirse la recta", desde: d.tAbre - 2 },
        { donde: "en la recta", desde: d.tAbre + 5 },
        { donde: "al empezar la llegada", desde: d.tCrown - LLEGADA_ANTES - 0.3 },
        { donde: "en el cabeza a cabeza", desde: d.tCrown - 1.5 },
        { donde: "en la foto", desde: d.tCrown - 0.1 },
        { donde: "sobre el golpe", desde: base.tGolpe - 0.5 },
      ];
      for (const h of huecos) {
        const c = corrida(60, [{ desde: h.desde, dur: 0.6 }]);
        expect(c.cuadros.length, h.donde).toBeLessThan(base.cuadros.length - 30);
        const r = diferencia(base, c);
        expect(r.comunes, h.donde).toBeGreaterThan(300);
        expect(r.planos, `${h.donde}: el plano`).toBe(0);
        expect(r.max, `${h.donde}: ${r.donde}`).toBeLessThanOrEqual(TOL);
      }
    });

    it(`${nombre}: los cortes y los hitos son los mismos con cualquier cadencia`, () => {
      const base = corrida(60);
      const cortes = (c: Corrida): string[] => c.cuadros.filter((f) => f.corte && f.plano !== "base").map((f) => `${f.plano}`);
      for (const fps of [30, 20, 120]) {
        const c = corrida(fps);
        expect(cortes(c), `${fps} cuadros por segundo`).toEqual(cortes(base));
        expect(c.hitos).toEqual(base.hitos);
      }
      // Las horas de los hitos son las nominales, no las de un cuadro.
      expect(base.hitos.llegada).toBeCloseTo(base.d.tCrown - LLEGADA_ANTES, 12);
      expect(base.hitos.foto).toBeCloseTo(base.d.tCrown + Math.min(FOTO_DESPUES, (base.tGolpe - base.d.tCrown) * 0.5), 12);
    });
  }

  it("un cuadro de más de un segundo (saltar el show) es un corte sin viaje, y el riel queda donde estaría si se lo hubiera seguido", () => {
    const base = correr(18, 2, PANTALLAS.proyector, 6);
    // Con un salto corto el riel avanza los pasos que se perdió (igual que siguiéndolo); con uno de más de seis segundos se rehace desde seis segundos
    // antes de la hora de llegada, de donde el filtro ya olvidó cómo era: a menos de una milésima de la altura de una llama.
    for (const [dur, tope] of [[2.5, 1e-9], [8, 1e-3]] as const) {
      const c = correr(18, 2, PANTALLAS.proyector, 6, 60, [{ desde: base.d.tAbre + 3, dur }]);
      const i = c.cuadros.findIndex((f, j) => j > 0 && f.t - (c.cuadros[j - 1] as Cuadro).t > 1);
      const corte = c.cuadros[i] as Cuadro;
      expect(corte.corte, `salto de ${dur} s`).toBe(true);
      expect(corte.plano, `salto de ${dur} s`).toBe("recta");
      const r = diferencia(base, c, corte.t);
      expect(r.comunes, `salto de ${dur} s`).toBeGreaterThan(300);
      expect(r.max, `salto de ${dur} s: ${r.donde}`).toBeLessThanOrEqual(tope);
    }
  });

  it("una cámara nueva (la pantalla cambió de tamaño) mira lo mismo que la que venía siguiendo la ronda, en la recta, en la meta y en el festejo", () => {
    const c = correr(18, 2, PANTALLAS.proyector, 6);
    const cfg = { marco: { w: c.P.w, h: c.P.h, u: c.P.u }, tAbre: c.d.tAbre, tCrown: c.d.tCrown, tGolpe: c.tGolpe, metaX: c.metaX, carriles: { y0: c.carr.y0, y1: c.carr.y1, n: c.carr.n, esc: c.carr.esc } };
    const base = (c.cuadros[0] as Cuadro).pose;
    const casos: { plano: Plano; t: number; tope: number }[] = [
      { plano: "recta", t: c.d.tAbre + 6, tope: 1e-3 },
      { plano: "llegada", t: c.d.tCrown - 2, tope: 1e-3 },
      { plano: "festejo", t: c.tGolpe + 4, tope: TOL },
    ];
    for (const k of casos) {
      const seguida = c.cuadros.reduce((a, f) => (Math.abs(f.t - k.t) < Math.abs(a.t - k.t) ? f : a));
      expect(seguida.plano).toBe(k.plano);
      const nueva = crearCamara3D(cfg).cuadro({ t: seguida.t, puestos: seguida.puestos, puestosEn: c.puestosEn, base, ganadora: c.d.campeona, golpeEn: seguida.t >= c.tGolpe ? c.tGolpe : null });
      expect(nueva.plano).toBe(k.plano);
      const x = camposDe(nueva.pose), y = camposDe(seguida.pose);
      for (let i = 0; i < x.length; i++) expect(Math.abs((x[i] as Campo)[1] - (y[i] as Campo)[1]), `${k.plano}: ${(x[i] as Campo)[0]}`).toBeLessThanOrEqual(k.tope * Math.max(1, Math.abs((y[i] as Campo)[1])));
    }
  });
});

describe("el golpe y el festejo dejan la cabeza de la ganadora debajo del cartel", () => {
  // Dónde termina el cartel, con su margen, como fracción del alto de la pantalla: el del proyector es más bajo que el del celular, que lo tiene más arriba.
  const BAJO = { proyector: 0.38, celular: 0.36 } as const;
  for (const pantalla of ["proyector", "celular"] as const) {
    for (const n of [8, 18, 60]) {
      it(`${pantalla}, ${n} personas: desde que el cartel está entero la cabeza de la ganadora queda debajo de su borde, sin girar ni cambiar el acercamiento`, () => {
        const P = PANTALLAS[pantalla];
        const bajo = BAJO[pantalla] * P.h;
        let pedidos = 0;
        for (const semilla of [1, 2, 3, 4, 5, 6]) {
          const sin = correr(n, semilla, P, 5);
          const con = correr(n, semilla, P, 5, 60, [], bajo);
          const gan = sin.d.lanes.indexOf(sin.d.campeona);
          const golpe = (sin.cuadros.find((f) => f.t >= sin.tGolpe) as Cuadro).t;
          expect(con.cuadros.length).toBe(sin.cuadros.length);
          con.cuadros.forEach((f, i) => {
            const antes = sin.cuadros[i] as Cuadro;
            const cab = cajaEnPantalla(f.pose, P.w, P.h, P.u, f.puestos[gan] as Cuadro["puestos"][number]).y;
            const cab0 = cajaEnPantalla(antes.pose, P.w, P.h, P.u, antes.puestos[gan] as Cuadro["puestos"][number]).y;
            if (f.t < golpe) {
              // Antes del golpe no hay cartel y no se toca nada.
              expect(f.pose, `t = ${f.t.toFixed(2)}`).toEqual(antes.pose);
              return;
            }
            if (f.plano !== "festejo") return;
            // El eje y la ampliación no cambian: es un desplazamiento de toda la mira.
            expect(anguloEntre(ejeDe(f.pose), ejeDe(antes.pose)), `eje en t = ${f.t.toFixed(2)}`).toBeLessThan(1e-6);
            expect(Math.abs(ampliacionDe(f.pose) - ampliacionDe(antes.pose)), `ampliación en t = ${f.t.toFixed(2)}`).toBeLessThan(1e-9);
            if (cab0 < bajo && f.t - golpe >= RAMPA_CARTEL) {
              pedidos++;
              expect(cab, `semilla ${semilla}, t = ${f.t.toFixed(2)}: la cabeza estaba en ${cab0.toFixed(0)} px y el cartel termina en ${bajo.toFixed(0)}`).toBeGreaterThanOrEqual(bajo - 0.5);
            }
            // Donde ya estaba debajo del cartel, no se mueve nada.
            if (cab0 >= bajo) expect(f.pose, `t = ${f.t.toFixed(2)}`).toEqual(antes.pose);
          });
          // Sin salto: el desplazamiento entra y sale de a poco (un cuadro cambia como mucho el 30 % de lo que sube en total).
          let cambio = 0, total = 0;
          for (let i = 1; i < con.cuadros.length; i++) {
            const a = con.cuadros[i - 1] as Cuadro, b = con.cuadros[i] as Cuadro;
            if (b.plano !== "festejo" || a.plano !== "festejo") continue;
            const da = a.pose.pos[1] - (sin.cuadros[i - 1] as Cuadro).pose.pos[1], db = b.pose.pos[1] - (sin.cuadros[i] as Cuadro).pose.pos[1];
            cambio = Math.max(cambio, Math.abs(db - da));
            total = Math.max(total, Math.abs(db));
          }
          if (total > 0.01) expect(cambio, `semilla ${semilla}: lo que cambia el despeje de un cuadro al otro, con un despeje de hasta ${total.toFixed(2)}`).toBeLessThanOrEqual(0.3 * total);
        }
        // La prueba ve el problema: en el proyector, en alguna ronda la cabeza pasa por detrás del cartel sin el despeje (en el celular el festejo es un corte
        // directo al encuadre final, donde ya está debajo).
        if (pantalla === "proyector") expect(pedidos, "cuadros que necesitaban despeje").toBeGreaterThan(0);
      });
    }
    // Quien gana salta en el festejo (`dibujar` en `carrera.ts`) y la cabeza subía por detrás del cartel: el auditor de emoción medía 21 % tapado.
    it(`${pantalla}: con el salto del festejo, la cabeza queda debajo del cartel también en lo más alto del salto`, () => {
      const P = PANTALLAS[pantalla];
      const bajo = BAJO[pantalla] * P.h;
      const salto = 20 * P.u;
      let medidos = 0;
      for (const semilla of [1, 2, 3, 4, 5, 6]) {
        const con = correr(18, semilla, P, 5, 60, [], bajo, salto);
        const gan = con.d.lanes.indexOf(con.d.campeona);
        const golpe = (con.cuadros.find((f) => f.t >= con.tGolpe) as Cuadro).t;
        for (const f of con.cuadros) {
          if (f.plano !== "festejo" || f.t - golpe < RAMPA_CARTEL) continue;
          const c = f.puestos[gan] as Puesto;
          expect(c.salto).toBe(salto);
          const arriba = cajaEnPantalla(f.pose, P.w, P.h, P.u, c).y, suelo = cajaEnPantalla(f.pose, P.w, P.h, P.u, { ...c, salto: 0 }).y;
          expect(arriba, `semilla ${semilla}, t = ${f.t.toFixed(2)}`).toBeGreaterThanOrEqual(bajo - 0.5);
          expect(suelo).toBeGreaterThan(arriba);
          medidos++;
        }
      }
      expect(medidos).toBeGreaterThan(0);
    });
  }
});

describe("el despeje del cartel termina cuando el cartel entra con el golpe, también al saltar la animación", () => {
  // Cuándo está entero el cartel, contado desde el golpe, leído de `stage.ts`: con `cartelConGolpe` su línea de tiempo va `entraCartel` adelante del
  // golpe y la escala arranca en `entraCartel`, así que crece desde el golpe con su curva; está entero la primera vez que la curva llega a 1.
  const fuente = readFileSync(new URL("../pixi/stage.ts", import.meta.url), "utf8");
  const escala = /\.fromTo\(plate\.scale, \{ x: 0, y: 0 \}, \{ x: 1, y: 1, duration: ([\d.]+), ease: "([^"]+)" \}, entraCartel\)/.exec(fuente);
  const entero = ((): number => {
    if (!escala) return NaN;
    const dur = Number(escala[1]);
    const curva = gsap.parseEase(escala[2] as string);
    for (let i = 1; i <= 100000; i++) if (curva(i / 100000) >= 1) return (i / 100000) * dur;
    return NaN;
  })();
  const BAJO_PROYECTOR = 0.38;
  // Rondas elegidas (personas, semilla) entre las de 8 a 60 personas y semillas 1 a 20: sin el despeje, entre 0,12 s y 0,35 s después del golpe,
  // la cabeza de la ganadora quedaría hasta unos 240 px por encima del borde del cartel (8 y 12, 18 y 11, 40 y 16, 60 y 1) o apenas por encima,
  // unos 15 px (8 y 1). Al saltar la animación casi todas caen en un encuadre que no lo pide; 8 y 12, 30 y 2 y 30 y 20 sí lo piden.
  const RONDAS = [[8, 12], [8, 1], [18, 11], [30, 2], [30, 20], [40, 16], [60, 1]] as const;

  it("el cartel crece desde el golpe y está entero antes de que pase un cuarto de segundo", () => {
    expect(escala, "el rebote del cartel en stage.ts").not.toBeNull();
    expect(fuente).toContain("conGolpe ? tg + entraCartel");
    expect(entero).toBeGreaterThan(0.1);
    expect(entero).toBeLessThan(0.25);
  });

  for (const salto of [0, 20]) {
    for (const saltada of [false, true]) {
      it(`proyector, salto de ${salto} u, ${saltada ? "saltando la animación" : "sin saltar"}: desde que el cartel está entero la cabeza de la ganadora queda debajo de su borde`, () => {
        const P = PANTALLAS.proyector;
        const bajo = BAJO_PROYECTOR * P.h;
        let medidos = 0;
        for (const [n, semilla] of RONDAS) {
          // El primer cuadro y la hora del golpe salen de la ronda como en `correr`, sin correr la cámara una vez más.
          const d = planCarrera(ctxDe(n, semilla)).datos;
          const t0 = Math.ceil(Math.max(0, d.tAbre - 2) * 60 - 1e-9) / 60;
          const tGolpe = d.tCrown + tiemposFoco(d.final.story.arc).golpe;
          // Saltar lleva el reloj justo al golpe (`crear.ts`): un cuadro largo desde el primero hasta el golpe.
          const huecos: Hueco[] = saltada ? [{ desde: t0, dur: Math.ceil((tGolpe - t0) * 60 - 1e-9) / 60 }] : [];
          const con = correr(n, semilla, P, 2, 60, huecos, bajo, salto * P.u);
          expect(con.tGolpe).toBe(tGolpe);
          expect((con.cuadros[0] as Cuadro).t).toBe(t0);
          if (saltada) {
            // El segundo cuadro es el primero de la grilla en el golpe o después.
            const tras = (con.cuadros[1] as Cuadro).t;
            expect(tras).toBeGreaterThanOrEqual(tGolpe - 1e-9);
            expect(tras - 1 / 60).toBeLessThan(tGolpe);
          }
          const gan = con.d.lanes.indexOf(con.d.campeona);
          for (const f of con.cuadros) {
            if (f.plano !== "festejo" || f.t - con.tGolpe < entero) continue;
            const cab = cajaEnPantalla(f.pose, P.w, P.h, P.u, f.puestos[gan] as Puesto).y;
            expect(cab, `${n} personas, semilla ${semilla}, ${(f.t - con.tGolpe).toFixed(3)} s después del golpe`).toBeGreaterThanOrEqual(bajo - 0.5);
            medidos++;
          }
        }
        expect(medidos).toBeGreaterThan(0);
      });
    }
  }
});

describe("la hora del golpe en la cámara es la del juego, con el ritmo, en cualquier pantalla", () => {
  const RITMOS = ["rapido", "normal", "epico"] as const;
  type Ritmo = (typeof RITMOS)[number];
  /** El sostén del cartel de quien gana, en segundos reales: `WINNER_HOLD` de `overlay.ts`, que no se importa sin navegador. */
  const ESPERA = 3;
  /**
   * `paceFactor` (`state.ts`), que no se importa sin navegador (pide `location`), con lo que le declara el kit para la carrera (`crear.ts`): la duración
   * del plan, lo fijo (el sostén del cartel más la placa del foco), lo que promete «Normal» con esa gente, y la tarjeta que sale del mismo total.
   */
  const factorDe = (ritmo: Ritmo, plan: Plan<Datos>): number => {
    const meta = segundosDe(ritmo, plan.normal as number);
    const util = Math.max(4, meta - (ESPERA + tiemposFoco(plan.arco).placa) - TARJETA);
    return Math.max(0.55, Math.min(2.2, util / plan.duracion));
  };
  /** Cuánto dura cada cuadro de la pantalla, en segundos reales, desde el segundo (el primero arranca el reloj con `dt = 0`). Desfasada, el segundo llega a un tercio de cuadro. */
  const CADENCIAS: readonly { nombre: string; paso: (i: number) => number }[] = [
    { nombre: "60 Hz", paso: () => 1 / 60 },
    { nombre: "144 Hz", paso: () => 1 / 144 },
    { nombre: "60 Hz desfasado", paso: (i) => (i === 1 ? 0.37 / 60 : 1 / 60) },
  ];

  interface Golpe {
    /** La hora del golpe que recibe la cámara (la misma cuenta que `carrera.ts`). */
    tGolpe: number;
    /** La hora de juego del cuadro en que golpea el juego, y cuánto dura ese cuadro en hora de juego. */
    real: number;
    cuadro: number;
    /** La hora del primer cuadro en que la cámara está en el festejo. */
    festejo: number;
    /** La pose de la cámara que siguió los cuadros, en una hora fija después del golpe (la misma con cualquier cadencia). */
    pose: Pose3D;
  }

  /**
   * El bucle del juego: el reloj de `overlay.ts` (lo real, con tope de 0,05 s, dividido por el ritmo) y la espera del golpe de `crear.ts` (suma lo real
   * desde el cuadro que cruza T). La cámara recibe la hora del golpe como en `carrera.ts`: la del primer cuadro coronado. Con `delPlan`, recibe la hora
   * del plan en el primer cuadro que llega a ella (lo que pasa al saltar el show): es la referencia. La cámara entra un segundo antes de T, en la
   * cámara de la meta, que es la misma con o sin lo de antes.
   */
  function jugar(plan: Plan<Datos>, factor: number, paso: (i: number) => number, delPlan = false): Golpe {
    const d = plan.datos;
    const P = PANTALLAS.proyector;
    const carr = carrilesDe(P, d.lanes.length, tamanoLetra("nombre", P.u));
    const metaX = RECTA * P.w + LLAMA_HOCICO * carr.esc;
    const F = tiemposFoco(plan.arco);
    const tGolpe = d.tCrown + tiemposFoco(d.final.story.arc).golpe / factor;
    const cam = crearCamara3D({ marco: { w: P.w, h: P.h, u: P.u }, tAbre: d.tAbre, tCrown: d.tCrown, tGolpe, metaX, carriles: { y0: carr.y0, y1: carr.y1, n: carr.n, esc: carr.esc } });
    const puestosEn = (t: number): Puesto[] => puestosDe(d, carr, P, 0, t);
    const base = camara3D({ x: -0.2 * P.w, y: P.h / 2, zoom: 1, rot: 0 }, P.w, P.h, P.u, carr.esc);
    let t = 0, tHold = 0, coronado = false;
    let golpeEn: number | null = null;
    let real = NaN, cuadro = NaN, festejo = NaN;
    for (let i = 0; i < 1e6 && !(golpeEn !== null && t >= tGolpe + 0.2); i++) {
      const dt = i === 0 ? 0 : Math.min(0.05, paso(i)) / factor;
      t += dt;
      if (t >= plan.duracion) {
        tHold += dt * factor;
        if (tHold >= F.golpe && !coronado) {
          coronado = true;
          real = t;
          cuadro = dt;
        }
      }
      if (t < d.tCrown - 1) continue;
      if (golpeEn === null && (delPlan ? t >= tGolpe : coronado)) golpeEn = delPlan ? tGolpe : t;
      const s = cam.cuadro({ t, puestos: puestosEn(t), puestosEn, base, ganadora: d.campeona, golpeEn });
      if (s.plano === "festejo" && Number.isNaN(festejo)) festejo = t;
    }
    const tFija = tGolpe + 0.4;
    const pose = cam.cuadro({ t: tFija, puestos: puestosEn(tFija), puestosEn, base, ganadora: d.campeona, golpeEn }).pose;
    return { tGolpe, real, cuadro, festejo, pose };
  }

  for (const ritmo of RITMOS) {
    it(`${ritmo}: de 8 a 60 personas, a 60 Hz, a 144 Hz y a 60 Hz desfasado, la cámara usa la misma hora de golpe, a menos de un cuadro del golpe del juego`, () => {
      let antes = 0;
      for (const n of [8, 9, 12, 18, 24, 30, 31, 40, 50, 60]) {
        for (const semilla of [1, 2, 3]) {
          const plan = planCarrera(ctxDe(n, semilla));
          const factor = factorDe(ritmo, plan);
          const ref = jugar(plan, factor, (CADENCIAS[0] as (typeof CADENCIAS)[number]).paso, true);
          for (const c of CADENCIAS) {
            const g = jugar(plan, factor, c.paso);
            const donde = `${n} personas, semilla ${semilla}, ${c.nombre} (factor ${factor.toFixed(3)}, golpe en ${g.real.toFixed(4)}, hora ${g.tGolpe.toFixed(4)})`;
            if (g.real < g.tGolpe) antes++;
            // La hora de la cámara está a menos de un cuadro del golpe del juego.
            expect(Math.abs(g.real - g.tGolpe), donde).toBeLessThanOrEqual(g.cuadro + 1e-9);
            // El festejo empieza en su hora, nunca antes, y a lo más un cuadro después del golpe del juego.
            expect(g.festejo, donde).toBeGreaterThanOrEqual(g.tGolpe);
            expect(g.festejo - g.real, donde).toBeLessThanOrEqual(g.cuadro + 1e-9);
            // La misma hora con cualquier cadencia: después del golpe, la cámara es la de la referencia, con el golpe en la hora del plan.
            expect(g.pose, donde).toEqual(ref.pose);
          }
        }
      }
      // La prueba ve el problema: el cuadro que cruza T suma entero a la espera del golpe, así que el juego golpea antes de la hora en muchas rondas.
      expect(antes, "golpes que caen antes de la hora").toBeGreaterThan(0);
    });
  }

  it("la carrera arma la cámara con la hora del golpe del juego: lo que tarda el foco dividido por el ritmo", () => {
    const fuente = readFileSync(new URL("./carrera.ts", import.meta.url), "utf8");
    expect(fuente).toContain("tGolpe: d.tCrown + tiemposFoco(d.final.story.arc).golpe / paceFactor()");
  });
});

describe("el 2D en los últimos 3 s: se acerca al grupo de punta 1,8 veces, despacio y sin centrar a una", () => {
  const zona = { x0: 0, y0: 175, x1: 1920, y1: 974 };
  it("el acercamiento sale del plano general que traía y llega a 1,8 veces sin pasar el tope de 1,5 veces por segundo", () => {
    const z0 = 0.9, tF = 50;
    expect(zoomFinal2D(z0, tF - 1, tF)).toBeCloseTo(z0, 9);
    expect(zoomFinal2D(z0, tF, tF)).toBeCloseTo(z0, 9);
    expect(zoomFinal2D(z0, tF + DUR_ACERCA_2D, tF)).toBeCloseTo(z0 * ACERCA_FINAL_2D, 9);
    expect(zoomFinal2D(z0, tF + 99, tF)).toBeCloseTo(z0 * ACERCA_FINAL_2D, 9);
    let pico = 0, previo = z0;
    for (let t = tF + 1 / 60; t <= tF + DUR_ACERCA_2D + 1; t += 1 / 60) {
      const z = zoomFinal2D(z0, t, tF);
      expect(z).toBeGreaterThanOrEqual(previo - 1e-12);
      pico = Math.max(pico, Math.log(z / previo) * 60);
      previo = z;
    }
    expect(pico).toBeLessThanOrEqual(ZOOM_MAX);
    // Termina un poco antes de la meta: la dirección pide llegar al plano de cerca antes de que crucen.
    expect(DUR_ACERCA_2D).toBeLessThan(LLEGADA_ANTES);
  });

  it("la caja que pide deja ese acercamiento y centra al promedio del grupo, no a una", () => {
    const grupo = [{ x: 900, y: 400, w: 60, h: 60 }, { x: 960, y: 520, w: 60, h: 60 }, { x: 930, y: 640, w: 60, h: 60 }];
    const z = 1.62;
    const caja = cajaFinal2D(grupo, zona, z, 40);
    expect(zoomDeCaja(caja, zona, 40)).toBeCloseTo(z, 9);
    const cx = grupo.reduce((a, c) => a + c.x + c.w / 2, 0) / 3, cy = grupo.reduce((a, c) => a + c.y + c.h / 2, 0) / 3;
    expect(caja.x + caja.w / 2).toBeCloseTo(cx, 9);
    expect(caja.y + caja.h / 2).toBeCloseTo(cy, 9);
  });

  it("si el grupo no entra a ese acercamiento, el acercamiento baja: ninguna del grupo queda cortada", () => {
    const grupo = [{ x: 100, y: 200, w: 60, h: 60 }, { x: 1700, y: 700, w: 60, h: 60 }];
    const caja = cajaFinal2D(grupo, zona, 3, 40);
    expect(zoomDeCaja(caja, zona, 40)).toBeLessThan(3);
    for (const g of grupo) {
      expect(g.x).toBeGreaterThanOrEqual(caja.x);
      expect(g.x + g.w).toBeLessThanOrEqual(caja.x + caja.w);
      expect(g.y).toBeGreaterThanOrEqual(caja.y);
      expect(g.y + g.h).toBeLessThanOrEqual(caja.y + caja.h);
    }
  });
});
