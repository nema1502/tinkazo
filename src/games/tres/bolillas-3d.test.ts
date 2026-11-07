// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANICA_R, CIRCULO_R } from "../pixi/bolillas-plan";
import type { Mapeo, Tiro } from "../pixi/bolillas-plan";
import { trayectoriaDe } from "../pixi/bolillas-plan";
import { crearMapa } from "./camara";
import { JUEGOS_CON_3D, ofrece3D } from "./ofrecidos";
import { tiene3D } from "./registro";
import { CANICA_ESCALA } from "../pixi/bolillas-arte";
import {
  ESTALLIDO_ENEMIGO, ESTALLIDO_MANO, ESTRELLA_PUNTAS, LINEAS_N, SACUDIDA_MAX, T_DESVIO, TIRADOR,
  LLEGADA_TITILA, TEETER_ALTO, TEETER_FRECUENCIA, ZOOM_MAX, camaraBolillas, giroDelCasi, GIRO_ALTO,
  DESTELLO_ALFA, DESTELLO_RADIO_TOPE, DESTELLO_VIDA, destelloDe,
  estallidoDe, estallidosDe, lugarDelMundo, mezclarPose, perfilBolillas, poseDelCerca, poseSacudida,
  posePersecucion, poseTiro, rodadoDe, rodadoDelTurno, sacudidaDe, teeterDelCasi, titileo, ventanaCadena,
  type EntradaBolillas, type Estallido,
} from "./bolillas-3d";
import { cercaDe, dibujoDe, LIMITE_EN_JUEGO, RADIO_DIBUJO } from "../pixi/bolillas-arte";

/**
 * Bolillas en 3D no decide nada: dibuja lo que el plan puro (`pixi/bolillas-plan.ts`) ya puso. Estas pruebas cuidan
 * las cuentas puras (el lugar del mundo, la pose de cada tiro, el titileo en la tiza), que la cámara no depende de
 * quién gana, y el cableado: el módulo está en el registro del 3D pero Bolillas no se ofrece en 3D por defecto (D3).
 */

// Bajo jsdom `import.meta.url` no es `file://`: se resuelve desde la raíz del repo.
const fuente = (f: string): string => readFileSync(resolve(process.cwd(), "src/games/tres", f), "utf8");

/** Un tiro de ejemplo, con sus datos tal como el plan los trae (unidades del círculo). */
const TIRO: Tiro = {
  tirador: 1,
  mio: 1,
  diana: 3,
  slot: 2,
  t: 10,
  tMano: 9.6,
  choque: { x: 0.1, y: 0.2 },
  empuje: { dir: { x: 0.8, y: -0.6 }, donde: { x: 0.5, y: -0.2 }, hasta: { x: 0.42, y: -0.14 }, vuelo: 0.4 },
  mano: { hasta: { x: 0.14, y: 0.07 } },
  desde: { x: 1.4, y: 0.3 },
  impacto: { x: 0.5, y: -0.2 },
  salida: { dir: { x: 0.6, y: 0.8 }, tiza: { x: 0.86, y: 0.48 }, fuerza: 1.1, vuelo: 0.4 },
  deflexion: { dir: { x: -0.8, y: 0.6 }, hasta: { x: 0.14, y: 0.07 } },
};

/** Pantallas de ejemplo: el mapa de la casa con la unidad de cada una. */
const PANTALLAS = [
  { nombre: "ancho", u: 1.067, mapeo: { cx: 683, cy: 330, e: 300 } as Mapeo },
  { nombre: "celular", u: 0.54, mapeo: { cx: 195, cy: 380, e: 130 } as Mapeo },
];

describe("el mundo 3D se apoya donde el 2D puso el círculo", () => {
  for (const pant of PANTALLAS) {
    it(`${pant.nombre}: un punto del plan, por el grupo del mundo, cae donde la cuenta de la casa lo lleva`, () => {
      const mapa = crearMapa(perfilBolillas(), pant.u);
      const { px, pz, K, Kz } = lugarDelMundo(mapa, pant.mapeo);
      for (const q of [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: -0.7, y: 0.55 },
        { x: 1.55, y: -1.2 },
      ]) {
        const [x3, , z3] = mapa.a3D(pant.mapeo.cx + q.x * pant.mapeo.e, pant.mapeo.cy + q.y * pant.mapeo.e, 0);
        // El grupo (posición + escala) y la cuenta directa llegan al mismo lugar.
        expect(px + K * q.x).toBeCloseTo(x3, 6);
        expect(pz + Kz * q.y).toBeCloseTo(z3, 6);
      }
      // La altura escala por K: `alto` plan-units son `alto * e` píxeles del dibujo (la misma cuenta del sapo).
      const [, y3] = mapa.a3D(0, 0, 2 * pant.mapeo.e);
      expect(K * 2).toBeCloseTo(y3, 6);
    });
  }
});

/** Un plan mínimo para mirar la cadena del tiro: las canicas donde el fixture las deja y un casi que no se usa acá. */
const PLAN_CADENA = {
  posiciones: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0.5, y: -0.2 }, { x: -0.4, y: 0.6 }],
  tiros: [TIRO],
  casi: { t: 20, ganador: 0, slot: 0, desde: { x: 0, y: 0 }, dir: { x: 0, y: 1 }, titila: { x: 0, y: 0.94 } },
  duracion: 23.4,
};

describe("la cadena del turno en 3D (S23): mano → mi canica → la del enemigo (S21)", () => {
  it("las ventanas del turno salen del plan y van en orden: suelte, toque, empuje, salida", () => {
    const v = ventanaCadena(TIRO);
    expect(v.suelte).toBeCloseTo(TIRO.tMano - TIRADOR, 9);
    expect(v.tMano).toBe(TIRO.tMano);
    expect(v.t).toBe(TIRO.t);
    expect(v.finMano).toBeCloseTo(TIRO.tMano + T_DESVIO, 9);
    expect(v.tiza).toBeCloseTo(TIRO.t + TIRO.salida.vuelo, 9);
    expect(v.suelte).toBeLessThan(v.tMano);
    expect(v.tMano).toBeLessThan(v.t);
    expect(ventanaCadena(TIRO)).toEqual(ventanaCadena(TIRO));
  });

  it("la mano larga de `desde`, pega en mi canica (`choque`) a la hora `tMano` y de ahí deriva a `mano.hasta`", () => {
    const largada = poseTiro(TIRO, TIRO.tMano - TIRADOR);
    expect(largada?.estado).toBe("ida");
    expect(largada?.x).toBeCloseTo(TIRO.desde.x, 9);
    expect(largada?.y).toBeCloseTo(TIRO.desde.y, 9);
    const medio = poseTiro(TIRO, TIRO.tMano - TIRADOR / 2) as { x: number; y: number; estado: string; f: number };
    expect(medio.f).toBeCloseTo(0.5, 9);
    expect(medio.x).toBeCloseTo((TIRO.desde.x + TIRO.choque.x) / 2, 9);
    expect(medio.y).toBeCloseTo((TIRO.desde.y + TIRO.choque.y) / 2, 9);
    const toque = poseTiro(TIRO, TIRO.tMano);
    expect(toque?.estado).toBe("ida");
    expect(toque?.f).toBeCloseTo(1, 9);
    expect(toque?.x).toBeCloseTo(TIRO.choque.x, 9);
    expect(toque?.y).toBeCloseTo(TIRO.choque.y, 9);
    // La mano ya no va contra la canica del enemigo: el primer choque es con la mía.
    expect(Math.hypot((toque?.x ?? 0) - TIRO.impacto.x, (toque?.y ?? 0) - TIRO.impacto.y)).toBeGreaterThan(CANICA_R);
    const desvio = poseTiro(TIRO, TIRO.tMano + 0.001);
    expect(desvio?.estado).toBe("desvio");
    const freno = poseTiro(TIRO, TIRO.tMano + T_DESVIO);
    expect(freno?.x).toBeCloseTo(TIRO.mano.hasta.x, 9);
    expect(freno?.y).toBeCloseTo(TIRO.mano.hasta.y, 9);
    expect(poseTiro(TIRO, TIRO.tMano - TIRADOR - 0.001)).toBeNull();
    expect(poseTiro(TIRO, TIRO.tMano + T_DESVIO + 0.001)).toBeNull();
    for (let i = 0; i < 20; i++) {
      const t = TIRO.tMano - TIRADOR + (i / 19) * (TIRADOR + T_DESVIO);
      expect(poseTiro(TIRO, t)).toEqual(poseTiro(TIRO, t));
    }
  });

  it("mi canica rueda de `choque` a `empuje.hasta` entre tMano y t, y la del enemigo cruza la tiza en su vuelo", () => {
    const antes = trayectoriaDe(PLAN_CADENA, TIRO.mio, TIRO.tMano - 0.01);
    expect(antes.estado).toBe("dentro");
    const arranque = trayectoriaDe(PLAN_CADENA, TIRO.mio, TIRO.tMano);
    expect(arranque.estado).toBe("vuela");
    expect(arranque.p.x).toBeCloseTo(TIRO.choque.x, 9);
    const medio = trayectoriaDe(PLAN_CADENA, TIRO.mio, (TIRO.tMano + TIRO.t) / 2);
    expect(medio.estado).toBe("vuela");
    expect(Math.hypot(medio.p.x - TIRO.choque.x, medio.p.y - TIRO.choque.y)).toBeGreaterThan(0);
    const freno = trayectoriaDe(PLAN_CADENA, TIRO.mio, TIRO.t);
    expect(freno.estado).toBe("dentro");
    expect(freno.p.x).toBeCloseTo(TIRO.empuje.hasta.x, 9);
    expect(freno.p.y).toBeCloseTo(TIRO.empuje.hasta.y, 9);

    const enemigo = trayectoriaDe(PLAN_CADENA, TIRO.slot, TIRO.t);
    expect(enemigo.estado).toBe("vuela");
    expect(enemigo.p.x).toBeCloseTo(TIRO.empuje.donde.x, 9);
    const aMitad = trayectoriaDe(PLAN_CADENA, TIRO.slot, TIRO.t + TIRO.salida.vuelo / 2);
    expect(aMitad.estado).toBe("vuela");
    const afuera = trayectoriaDe(PLAN_CADENA, TIRO.slot, TIRO.t + TIRO.salida.vuelo);
    expect(afuera.estado).toBe("afuera");
    // Cruza a lo largo de `salida.dir` desde el empuje, nunca de vuelta (S21): la distancia que vuela es
    // la que el plan mide entre `empuje.donde` y su `salida.tiza`.
    const largo = Math.hypot(TIRO.salida.tiza.x - TIRO.empuje.donde.x, TIRO.salida.tiza.y - TIRO.empuje.donde.y);
    expect(afuera.p.x).toBeCloseTo(TIRO.empuje.donde.x + TIRO.salida.dir.x * largo, 9);
    expect(afuera.p.y).toBeCloseTo(TIRO.empuje.donde.y + TIRO.salida.dir.y * largo, 9);
    // S21: cruza la tiza hacia afuera (el fixture no trae la salida alineada al empuje; la alineación del
    // plan se prueba en su propia suite, acá solo se cuida que la vista la saque hacia afuera).
    expect(Math.hypot(TIRO.salida.tiza.x, TIRO.salida.tiza.y)).toBeGreaterThan(Math.hypot(TIRO.empuje.donde.x, TIRO.empuje.donde.y));
  });
});

describe("el rodado de la cadena: mi canica gira mientras empuja", () => {
  it("el eje es perpendicular al viaje y los radianes son la distancia rodada sobre el radio", () => {
    const r = rodadoDe({ x: 0, y: 0 }, { x: 0, y: 2 }, 0.5, 2);
    expect(Math.hypot(r.eje.x, r.eje.y)).toBeCloseTo(1, 9);
    expect(r.eje.x * 0 + r.eje.y * 2).toBeCloseTo(0, 9);
    expect(r.giro).toBeCloseTo(0.5, 9);
    expect(rodadoDe({ x: 0, y: 0 }, { x: 1, y: 0 }, -1, 1).giro).toBe(0);
    expect(rodadoDe({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, 1).giro).toBeCloseTo(1, 9);
    expect(rodadoDe({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.5, 1).giro).toBe(0);
    expect(rodadoDe({ x: 0.2, y: -0.1 }, { x: 0.2, y: -0.1 }, 0.5, 1)).toEqual(rodadoDe({ x: 0.2, y: -0.1 }, { x: 0.2, y: -0.1 }, 0.5, 1));
  });

  it("mi canica gira solo mientras rueda el empuje; en la hora `t` se frena; la del enemigo gira al salir", () => {
    expect(rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano - 0.01, 1)).toBeNull();
    const medio = rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano + (TIRO.t - TIRO.tMano) / 2, 1) as { giro: number };
    expect(medio.giro).toBeGreaterThan(0);
    // Rueda lo que el plan dice que se movió: los radianes son la distancia viva sobre el radio.
    const medioTray = trayectoriaDe(PLAN_CADENA, TIRO.mio, TIRO.tMano + (TIRO.t - TIRO.tMano) / 2);
    const rodado = Math.hypot(medioTray.p.x - TIRO.choque.x, medioTray.p.y - TIRO.choque.y);
    expect(medio.giro).toBeCloseTo(rodado, 9);
    const antes = rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano + 0.05, 1) as { giro: number };
    const despues = rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano + 0.15, 1) as { giro: number };
    expect(despues.giro).toBeGreaterThan(antes.giro);
    expect(rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.t, 1)).toBeNull();
    const salida = rodadoDelTurno(PLAN_CADENA, TIRO.slot, TIRO.t + TIRO.salida.vuelo / 2, 1) as { giro: number };
    expect(salida.giro).toBeGreaterThan(0);
    expect(rodadoDelTurno(PLAN_CADENA, TIRO.slot, TIRO.t - 0.01, 1)).toBeNull();
    expect(rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano + 0.1, 1)).toEqual(rodadoDelTurno(PLAN_CADENA, TIRO.mio, TIRO.tMano + 0.1, 1));
  });

  it("si la misma canica empuja en dos turnos (la rotación puede repetir), gira en el que está rodando", () => {
    const segundo: Tiro = {
      ...TIRO,
      tMano: 12,
      t: 12.4,
      desde: { x: -1.4, y: 0.5 },
      choque: { x: -0.2, y: 0.1 },
      empuje: { dir: { x: 0.9, y: 0.2 }, donde: { x: 0.7, y: 0.3 }, hasta: { x: 0.55, y: 0.28 }, vuelo: 0.4 },
      mano: { hasta: { x: -0.15, y: 0.3 } },
    };
    const d = { tiros: [TIRO, segundo] };
    expect(rodadoDelTurno(d, TIRO.mio, 11, 1)).toBeNull();
    const r = rodadoDelTurno(d, TIRO.mio, 12.2, 1) as { giro: number };
    expect(r.giro).toBeGreaterThan(0);
    expect(rodadoDelTurno(d, TIRO.mio, 12.4, 1)).toBeNull();
  });
});

describe("el estallido de pelea en los dos choques del turno (S22)", () => {
  it("hay uno en cada impacto: el de la mano en `choque`/`tMano` y el grande en `empuje.donde`/`t`", () => {
    const mano = estallidoDe(TIRO, "mano", TIRO.tMano) as Estallido;
    expect(mano.golpe).toBe("mano");
    expect(mano.t0).toBe(TIRO.tMano);
    expect(mano.x).toBeCloseTo(TIRO.choque.x, 9);
    expect(mano.y).toBeCloseTo(TIRO.choque.y, 9);
    expect(mano.vida).toBe(ESTALLIDO_MANO);
    const enemigo = estallidoDe(TIRO, "enemigo", TIRO.t) as Estallido;
    expect(enemigo.golpe).toBe("enemigo");
    expect(enemigo.t0).toBe(TIRO.t);
    expect(enemigo.x).toBeCloseTo(TIRO.empuje.donde.x, 9);
    expect(enemigo.y).toBeCloseTo(TIRO.empuje.donde.y, 9);
    expect(enemigo.vida).toBe(ESTALLIDO_ENEMIGO);
    // La ventana de cada estallido: antes no hay, y muere exacto al final.
    expect(estallidoDe(TIRO, "mano", TIRO.tMano - 0.001)).toBeNull();
    expect(estallidoDe(TIRO, "mano", TIRO.tMano + ESTALLIDO_MANO + 1e-6)).toBeNull();
    expect(estallidoDe(TIRO, "enemigo", TIRO.t + ESTALLIDO_ENEMIGO + 1e-6)).toBeNull();
  });

  it("la estrella y las líneas de velocidad radian del impacto, y el golpe grande es más grande y más largo", () => {
    const medioMano = estallidoDe(TIRO, "mano", TIRO.tMano + ESTALLIDO_MANO * 0.45) as Estallido;
    const medioEnemigo = estallidoDe(TIRO, "enemigo", TIRO.t + ESTALLIDO_ENEMIGO * 0.45) as Estallido;
    expect(medioMano.puntas).toHaveLength(ESTRELLA_PUNTAS);
    expect(medioMano.lineas).toHaveLength(LINEAS_N);
    expect(medioEnemigo.puntas).toHaveLength(ESTRELLA_PUNTAS);
    expect(medioEnemigo.lineas).toHaveLength(LINEAS_N);
    for (const p of medioMano.puntas) {
      expect(Number.isFinite(p.a)).toBe(true);
      expect(p.largo).toBeGreaterThan(0);
    }
    for (const l of medioEnemigo.lineas) {
      expect(l.de).toBeGreaterThan(0);
      expect(l.hasta).toBeGreaterThan(l.de);
    }
    expect(medioEnemigo.radio).toBeGreaterThan(medioMano.radio);
    expect(ESTALLIDO_ENEMIGO).toBeGreaterThan(ESTALLIDO_MANO);
    expect(medioMano.velo).toBeGreaterThan(0);
    expect(medioMano.velo).toBeLessThanOrEqual(1);
  });

  it("es determinista y cosmético: es función de `t` y del plan, sin azar ni al ganador", () => {
    for (const t of [TIRO.tMano, TIRO.tMano + 0.1, TIRO.t, TIRO.t + 0.2, TIRO.t + 0.5]) {
      expect(estallidosDe(PLAN_CADENA, t)).toEqual(estallidosDe(PLAN_CADENA, t));
    }
    const src = fuente("bolillas-3d.ts");
    const tramo = src.slice(src.indexOf("export interface Estallido"), src.indexOf("export function poseSacudida"));
    expect(tramo).not.toMatch(/Math\.random|ganador/);
  });

  it("los dos choques se solapan cuando el empuje es corto, sin perder ninguno", () => {
    const corto: Tiro = { ...TIRO, t: TIRO.tMano + 0.16 };
    const est = estallidosDe({ tiros: [corto] }, corto.t);
    expect(est.map((e) => e.golpe).sort()).toEqual(["enemigo", "mano"]);
    expect(est.every((e) => e.u >= 0 && e.u < 1)).toBe(true);
  });
});

describe("la micro-sacudida de la vista en el choque (S22)", () => {
  it("es chica, sale del impacto y muere sin sacar el encuadre", () => {
    expect(sacudidaDe([])).toEqual({ x: 0, y: 0 });
    const golpe = sacudidaDe([estallidoDe(TIRO, "enemigo", TIRO.t) as Estallido]);
    const largo = Math.hypot(golpe.x, golpe.y);
    expect(largo).toBeGreaterThan(0);
    expect(largo).toBeLessThanOrEqual(SACUDIDA_MAX + 1e-9);
    const casiFinal = sacudidaDe([estallidoDe(TIRO, "enemigo", TIRO.t + ESTALLIDO_ENEMIGO - 1e-6) as Estallido]);
    expect(Math.hypot(casiFinal.x, casiFinal.y)).toBeLessThan(1e-3);
    // Dos choques solapados siguen acotados por la receta del más fuerte.
    const corto: Tiro = { ...TIRO, t: TIRO.tMano + 0.16 };
    const solape = sacudidaDe(estallidosDe({ tiros: [corto] }, corto.t));
    expect(Math.hypot(solape.x, solape.y)).toBeLessThanOrEqual(SACUDIDA_MAX * 1.6);
  });

  it("la pose sacudida mueve la cámara un pelo (el encuadre del director manda) y sin golpe no toca nada", () => {
    const pose = { pos: [0, 10, 20] as [number, number, number], mira: [0, 0, 0] as [number, number, number], fov: 0.5, giro: 0 };
    expect(poseSacudida(pose, { x: 0, y: 0 }, 100, 100)).toEqual(pose);
    const movida = poseSacudida(pose, { x: 0.02, y: -0.01 }, 100, 120);
    expect(movida.pos[0]).toBeCloseTo(2, 9);
    expect(movida.pos[1]).toBe(10);
    expect(movida.pos[2]).toBeCloseTo(18.8, 9);
    expect(movida.mira).toEqual(pose.mira);
    expect(movida.fov).toBe(pose.fov);
    expect(poseSacudida(pose, { x: 0.02, y: -0.01 }, 100, 120)).toEqual(movida);
  });
});

describe("el titileo en la tiza arranca y termina en cero (la lección del sapo)", () => {
  it("no mueve nada antes de llegar, ni después del golpe, y en los bordes vale cero", () => {
    const d = { casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } }, duracion: 23.4 };
    // Antes de que la canica llegue a la orilla, quieta.
    expect(teeterDelCasi(d, d.casi.t)).toBe(0);
    expect(teeterDelCasi(d, d.casi.t + LLEGADA_TITILA - 0.01)).toBeCloseTo(0, 6);
    // En los bordes de la ventana vale cero: ni salto de entrada ni de salida.
    expect(teeterDelCasi(d, d.casi.t + LLEGADA_TITILA)).toBe(0);
    expect(teeterDelCasi(d, d.duracion)).toBe(0);
    expect(teeterDelCasi(d, d.duracion + 5)).toBe(0);
    // En el medio, titila de verdad, pero sin pasar de su amplitud.
    const medio = teeterDelCasi(d, d.casi.t + LLEGADA_TITILA + 0.35);
    expect(Math.abs(medio)).toBeGreaterThan(0.01);
    expect(Math.abs(medio)).toBeLessThanOrEqual(TEETER_ALTO + 1e-9);
  });

  it("la curva es continua y determinista: ningún salto entre muestras vecinas, ninguna tirada de moneda", () => {
    const t0 = 12.4, t1 = 15.8;
    let previa = titileo(t0 - 0.01, t0, t1);
    for (let t = t0; t <= t1 + 0.5; t += 0.01) {
      const v = titileo(t, t0, t1);
      expect(Math.abs(v - previa)).toBeLessThan(0.05);
      expect(v).toBe(v);
      previa = v;
    }
    // Al volver atrás (un salto del show a un segundo anterior), lo mismo.
    expect(titileo(13, t0, t1)).toBe(titileo(13, t0, t1));
  });

  it("titila sobre su frecuencia: más de un vaivén en la ventana y nunca abajo del piso ni arriba del alto", () => {
    // Con la frecuencia de la casa, en una ventana de 1,4 s hay varios vaivenes.
    let cruces = 0;
    for (let t = 12.4; t < 15.8; t += 0.005) {
      const a = titileo(t, 12.4, 15.8);
      const b = titileo(t + 0.005, 12.4, 15.8);
      if (Math.sign(a - 0.001) !== Math.sign(b - 0.001)) cruces++;
      expect(Math.abs(a)).toBeLessThanOrEqual(TEETER_ALTO + 1e-9);
    }
    expect(cruces).toBeGreaterThanOrEqual(Math.floor(((15.8 - 12.4) * TEETER_FRECUENCIA) / (2 * Math.PI)) - 1);
  });
});

describe("la cámara 3D sigue al director y no sabe quién gana", () => {
  it("hasta el tope es la cámara del director; más allá, el zoom queda en el tope y el centro vuelve sin saltos", () => {
    const w = 1366, h = 768;
    const base = { x: w / 2, y: h / 2, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 };
    for (const z of [0.7, 1, ZOOM_MAX]) expect(camaraBolillas({ ...base, zoom: z, x: 900, y: 200 }, w, h)).toEqual({ ...base, zoom: z, x: 900, y: 200 });
    const c = camaraBolillas({ ...base, zoom: 1.6, x: 900, y: 200 }, w, h);
    expect(c.zoom).toBe(ZOOM_MAX);
    expect(Math.abs(c.x - w / 2)).toBeLessThan(Math.abs(900 - w / 2));
    expect(Math.abs(c.y - h / 2)).toBeLessThan(Math.abs(200 - h / 2));
    // Continua: pasar el tope por un pelo no mueve la cámara.
    const a = camaraBolillas({ ...base, zoom: ZOOM_MAX, x: 900, y: 200 }, w, h);
    const b = camaraBolillas({ ...base, zoom: ZOOM_MAX + 0.001, x: 900, y: 200 }, w, h);
    expect(Math.abs(a.x - b.x)).toBeLessThan(3);
    expect(Math.abs(a.y - b.y)).toBeLessThan(3);
  });

  it("el perfil mira desde arriba (el círculo se lee como círculo) y no menciona a nadie que gane", () => {
    const p = perfilBolillas();
    expect(p.elevacion).toBeGreaterThan(0.8);
    expect(p.elevacion).toBeLessThan(1.2);
    // Fiel: las proporciones del piso del 2D se conservan.
    expect(p.zc).toBeCloseTo(1 / Math.sin(p.elevacion), 6);
    expect(p.azimut).toBe(0);
  });

  it("la cámara depende del reloj y de la pantalla, y de nada más (no recibe quién gana)", () => {
    const src = fuente("bolillas-3d.ts");
    const firma = src.slice(src.indexOf("export function camaraBolillas"), src.indexOf("export const perfilBolillas"));
    expect(firma).toContain("(cam: Camara2D, w: number, h: number");
    expect(firma).not.toMatch(/ganador|winner|slot/i);
  });
});

describe("el acercamiento a la ganadora: la bolilla gira, la cámara llega (S14)", () => {
  /** El casi de ejemplo: la canica 1 gana y rueda de (0,5, 0,5) hasta la tiza en (0,5, 0,94). */
  const CASI_D = {
    casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } },
    duracion: 23.4,
    posiciones: [{ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }],
    tiros: [] as Tiro[],
  };

  it("el giro sobre la tiza nace y muere en cero exacto (la misma envolvente del titileo)", () => {
    expect(giroDelCasi(CASI_D, CASI_D.casi.t)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.casi.t + LLEGADA_TITILA)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.duracion)).toBe(0);
    expect(giroDelCasi(CASI_D, CASI_D.duracion + 3)).toBe(0);
    // En el medio gira de verdad: dos ejes (el vaivén del otro lado + el giro acá), y nunca más alto que su amplitud.
    const medio = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(giroDelCasi(CASI_D, CASI_D.casi.t + LLEGADA_TITILA + ((i + 1) / 61) * (CASI_D.duracion - CASI_D.casi.t - LLEGADA_TITILA)))));
    expect(medio).toBeGreaterThan(0.3);
    expect(medio).toBeLessThanOrEqual(GIRO_ALTO + 1e-9);
    expect(giroDelCasi(CASI_D, 22.2)).toBe(giroDelCasi(CASI_D, 22.2));
  });

  it("la pose de cerca mira a la canica por su lugar del plan, y queda a tiro de foto sin atravesarla", () => {
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    for (const t of [20.2, 20.9, 21.6, 22.3, 23.1]) {
      const pose = poseDelCerca(CASI_D, t, lugar, 1.3);
      // La mira cae sobre la canica tal como se dibuja (S25): el punto del plan, apretado adentro de la tiza con aire
      // para su cuerpo doblado cuando el plan la deja sobre el aro.
      const p = trayectoriaDe(CASI_D, 1, t).p;
      const dib = dibujoDe(CASI_D, 1, t)?.p ?? p;
      expect(pose.mira[0]).toBeCloseTo(lugar.px + lugar.K * dib.x, 4);
      expect(pose.mira[2]).toBeCloseTo(lugar.pz + lugar.Kz * dib.y, 4);
      expect(Math.hypot(dib.x, dib.y) + RADIO_DIBUJO).toBeLessThanOrEqual(CIRCULO_R + 1e-9);
      // Adentro del aire, el dibujo es el punto del plan: la cámara no se corre de la canica.
      if (Math.hypot(p.x, p.y) <= LIMITE_EN_JUEGO) expect(dib).toEqual(p);
      expect(pose.mira[1]).toBeGreaterThan(0);
      // Cerca, pero nunca adentro del vidrio: a entre media y una canica y media de largo.
      const lejos = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[2] - pose.mira[2]) / lugar.K;
      expect(lejos).toBeGreaterThan(0.2);
      expect(lejos).toBeLessThan(1.1);
      expect(pose.fov).toBeGreaterThan(0);
      expect(pose.mira).toEqual(pose.mira);
    }
    // Determinista: la misma hora, la misma pose.
    expect(poseDelCerca(CASI_D, 21.4, lugar, 1.3)).toEqual(poseDelCerca(CASI_D, 21.4, lugar, 1.3));
  });

  it("la mezcla de poses es la de la casa: peso 0 devuelve la del director, peso 1 la de cerca, y en el medio no salta", () => {
    const a = { pos: [0, 0, 10] as [number, number, number], mira: [0, 0, 0] as [number, number, number], fov: 0.5, giro: 0 };
    const b = { pos: [4, 3, 0] as [number, number, number], mira: [2, 2, 2] as [number, number, number], fov: 0.8, giro: 0.2 };
    expect(mezclarPose(a, b, 0)).toEqual(a);
    expect(mezclarPose(a, b, 1)).toEqual(b);
    const m = mezclarPose(a, b, 0.5);
    expect(m.pos[0]).toBeCloseTo(2, 9);
    expect(m.pos[2]).toBeCloseTo(5, 9);
    expect(m.fov).toBeCloseTo(0.65, 9);
    // Y el peso del acercamiento es la misma cuenta del 2D: una sola, para las dos escenas.
    expect(cercaDe(CASI_D, CASI_D.casi.t + 1.3)).toBeGreaterThan(0);
    expect(cercaDe(CASI_D, CASI_D.casi.t + 1.3)).toBeLessThan(1);
    expect(cercaDe(CASI_D, CASI_D.duracion)).toBe(1);
  });
});

describe("S13 en 3D: sombras de contacto y chispas de vidrio", () => {
  it("las canicas se ven apoyadas en la tierra y cada choque echa su brillo, dibujados por la vista", () => {
    const src = fuente("bolillas-3d.ts");
    // Sombra de contacto: un plano chico debajo de cada canica (estilo de la casa, pocos polígonos).
    expect(src).toMatch(/sombra/i);
    expect(src).toMatch(/CircleGeometry/);
    // Chispas: brillo breve en el impacto, determinista por hash (sin azar propio).
    expect(src).toMatch(/Chispas/);
    expect(src).toMatch(/chispo\.nuevo/);
    expect(src).not.toContain("Math.random");
  });
});

describe("S17 en 3D: las canicas se dibujan más grandes", () => {
  it("el vidrio, el rodado, el pivote y la sombra usan el radio dibujado (radio del plan × escala)", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toMatch(/CANICA_ESCALA/);
    // La malla de la canica se arma con el radio dibujado, y el rodado y el pivote también lo usan.
    expect(src).toMatch(/CANICA_R \* CANICA_ESCALA/);
    expect(src).toMatch(/R_DIBUJO/);
    expect(src).not.toContain("Math.random");
  });

  it("la pose de cerca mira a la canica a la altura del vidrio agrandado, sin meterse en él", () => {
    const CASI_D = {
      casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } },
      duracion: 23.4,
      posiciones: [{ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }],
      tiros: [] as Tiro[],
    };
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    const pose = poseDelCerca(CASI_D, 21.4, lugar, 1.3);
    // La mira cae a la altura del centro de la canica agrandada.
    expect(pose.mira[1]).toBeCloseTo(lugar.K * CANICA_R * CANICA_ESCALA * 0.9, 4);
    // Y la cámara queda fuera del vidrio: a más de un radio dibujado de la superficie.
    const lejos = Math.hypot(pose.pos[0] - pose.mira[0], pose.pos[2] - pose.mira[2]) / lugar.K;
    expect(lejos).toBeGreaterThan(2 * CANICA_R * CANICA_ESCALA);
  });
});

describe("S19 en 3D: el anillo del anuncio alrededor de la diana", () => {
  it("la vista dibuja el anillo con rayas de la cuenta pura (anuncioDeDiana), con el pulso del plan, sin azar", () => {
    const src = fuente("bolillas-3d.ts");
    // La cuenta vive en el arte puro (`anuncioDeDiana`); la vista solo la dibuja, con pocos polígonos.
    expect(src).toMatch(/anuncioDeDiana/);
    expect(src).toMatch(/RingGeometry/);
    expect(src).not.toContain("Math.random");
  });

  it("la pose de cerca de la ganadora queda a altura del vidrio doblado (S20 retunea la toma)", () => {
    const CASI_D = {
      casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.5, y: 0.5 }, dir: { x: 0, y: 1 }, titila: { x: 0.5, y: 0.94 } },
      duracion: 23.4,
      posiciones: [{ x: 0.5, y: 0.5 }, { x: 0.3, y: 0.4 }],
      tiros: [] as Tiro[],
    };
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    const pose = poseDelCerca(CASI_D, 21.4, lugar, 1.3);
    const top = 2 * CANICA_R * CANICA_ESCALA; // lo alto que queda el vidrio doblado, con el ojo de la cámara por encima
    expect(pose.pos[1] / lugar.K, "ojo por encima del vidrio doblado").toBeGreaterThanOrEqual(top * 1.1);
  });
});

describe("el acercamiento a la ganadora con la cadena nueva (S14/S23)", () => {
  /** La ganadora ya fue empujada: su casi arranca donde la dejó el empuje, no en su siembra. */
  const CASI_EMPUJADA = {
    casi: { t: 20, ganador: 0, slot: 1, desde: { x: 0.62, y: -0.21 }, dir: { x: 0.36, y: 0.93 }, titila: { x: 0, y: 0.945 } },
    duracion: 23.4,
    posiciones: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.3 }],
    tiros: [] as Tiro[],
  };

  it("arranca en `casi.desde` (el `hasta` del empuje, no la siembra) y aterriza en el titileo de la tiza", () => {
    const pant = PANTALLAS[0] as { nombre: string; u: number; mapeo: Mapeo };
    const mapa = crearMapa(perfilBolillas(), pant.u);
    const lugar = lugarDelMundo(mapa, pant.mapeo);
    const arranque = poseDelCerca(CASI_EMPUJADA, CASI_EMPUJADA.casi.t, lugar, 1.3);
    expect(arranque.mira[0]).toBeCloseTo(lugar.px + lugar.K * CASI_EMPUJADA.casi.desde.x, 4);
    expect(arranque.mira[2]).toBeCloseTo(lugar.pz + lugar.Kz * CASI_EMPUJADA.casi.desde.y, 4);
    const llegada = poseDelCerca(CASI_EMPUJADA, CASI_EMPUJADA.casi.t + LLEGADA_TITILA, lugar, 1.3);
    expect(llegada.mira[0]).toBeCloseTo(lugar.px + lugar.K * CASI_EMPUJADA.casi.titila.x, 4);
    // Llega a la tiza, dibujada adentro con aire para el cuerpo doblado (S25): la cámara mira a la canica que se ve.
    expect(llegada.mira[2]).toBeCloseTo(lugar.pz + lugar.Kz * LIMITE_EN_JUEGO, 4);
    // El `casi.desde` no es la siembra: la cadena la dejó en otro lado.
    const siembra = CASI_EMPUJADA.posiciones[1] as { x: number; y: number };
    expect(Math.hypot(CASI_EMPUJADA.casi.desde.x - siembra.x, CASI_EMPUJADA.casi.desde.y - siembra.y)).toBeGreaterThan(0.1);
    // Al aterrizar, el titileo ya arrancó en la tiza y la cámara de cerca lo está mirando.
    expect(teeterDelCasi(CASI_EMPUJADA, CASI_EMPUJADA.casi.t + LLEGADA_TITILA)).toBe(0);
    expect(Math.abs(teeterDelCasi(CASI_EMPUJADA, CASI_EMPUJADA.casi.t + LLEGADA_TITILA + 0.3))).toBeGreaterThan(0);
    expect(cercaDe(CASI_EMPUJADA, CASI_EMPUJADA.casi.t + LLEGADA_TITILA)).toBe(1);
  });
});

describe("la escena dibuja la cadena y el estallido (S21/S22/S23)", () => {
  it("el cuadro consume las cuentas nuevas: la mano en `tMano`/`choque`, el rodado de la cadena y los dos estallidos", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toMatch(/tiro\.tMano/);
    expect(src).toMatch(/tiro\.mano\.hasta/);
    expect(src).toMatch(/rodadoDelTurno\(/);
    expect(src).toMatch(/estallidosDe\(/);
    expect(src).toMatch(/poseSacudida\(/);
    expect(src).toMatch(/chispo\.nuevo\(e\.t, tiro\.choque/);
    expect(src).not.toContain("Math.random");
  });
});

describe("el cableado: registrado en el 3D, apagado en el selector (D3)", () => {
  it("el módulo de Bolillas está en el registro del 3D", () => {
    expect(tiene3D("bolillas")).toBe(true);
  });

  it("Bolillas no entra a JUEGOS_CON_3D: el 3D se prueba con ?motor=3d, no con el interruptor", () => {
    expect(JUEGOS_CON_3D).not.toContain("bolillas");
    expect(ofrece3D("bolillas")).toBe(false);
  });

  it("el lanzador conecta con el enchufe del 2D (bolillasPixi3D) y sin él sigue el 2D; nada de azar", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toContain("export const lanzador3D");
    expect(src).toContain("bolillasPixi3D");
    expect(src).toContain("import(\"../pixi/bolillas\")");
    expect(src).not.toContain("Math.random");
  });

  it("el 3D no emite sonido propio: la voz única es la del kit, que el cuadro del 2D corre en ambos modos", () => {
    const src = fuente("bolillas-3d.ts");
    // El clic, su eco, el golpe seco de la caída y los ticks del titileo salen de `bolillas-sonido.ts` por la voz
    // del kit (`k.sonido`); si esta vista también sonara, cada choque se oiría doble.
    expect(src.split("\n").some((l) => /^\s*import\s.*\bsound\b/.test(l))).toBe(false);
    expect(src).not.toContain("beep(");
  });

  it("la entrada que el 2D le pasa es el plan y su mapeo, sin nada del ganador", () => {
    const vacia: EntradaBolillas = {
      t: 0, w: 0, h: 0, u: 1,
      cam: { x: 0, y: 0, zoom: 1, rot: 0, sacudonX: 0, sacudonY: 0 },
      plan: null,
      mapeo: { cx: 0, cy: 0, e: 100 },
    };
    expect(vacia.plan).toBeNull();
    const src = fuente("bolillas-3d.ts");
    const contrato = src.slice(src.indexOf("export interface EntradaBolillas"), src.indexOf("export function entradaBolillasVacia"));
    expect(contrato).toContain("plan: Datos | null");
    expect(contrato).toContain("mapeo: Mapeo");
    expect(contrato).not.toMatch(/ganador/);
  });
});

describe("S26 en 3D: el estallido de pelea chico y legible", () => {
  const R = CANICA_R * CANICA_ESCALA;

  it("la estrella no pasa de dos canicas de ancho y las líneas no se van del golpe", () => {
    for (const golpe of ["mano", "enemigo"] as const) {
      const t0 = golpe === "mano" ? TIRO.tMano : TIRO.t;
      const vida = golpe === "mano" ? ESTALLIDO_MANO : ESTALLIDO_ENEMIGO;
      for (const u of [0, 0.2, 0.5, 0.9]) {
        const est = estallidoDe(TIRO, golpe, t0 + u * vida) as Estallido;
        expect(est.radio, `${golpe} a ${u}`).toBeLessThanOrEqual(2 * R);
        for (const p of est.puntas) expect(p.largo).toBeLessThanOrEqual(2 * R);
        for (const l of est.lineas) expect(l.hasta).toBeLessThanOrEqual(2.2 * R);
      }
    }
  });

  it("los dos golpes siguen distintos, pero los dos cortos: el grande es el más grande y el más largo", () => {
    const medioMano = estallidoDe(TIRO, "mano", TIRO.tMano + ESTALLIDO_MANO * 0.45) as Estallido;
    const medioEnemigo = estallidoDe(TIRO, "enemigo", TIRO.t + ESTALLIDO_ENEMIGO * 0.45) as Estallido;
    expect(medioEnemigo.radio).toBeGreaterThan(medioMano.radio);
    expect(ESTALLIDO_ENEMIGO).toBeGreaterThan(ESTALLIDO_MANO);
    // Un parpadeo de manga, no una nube que se queda.
    expect(ESTALLIDO_ENEMIGO).toBeLessThanOrEqual(0.5);
    expect(ESTALLIDO_MANO).toBeLessThanOrEqual(0.35);
  });

  it("el destello del vidrio sobre la canica golpeada es chico y corto, como el del 2D", () => {
    // Nace en el golpe y se apaga exacto al final de su vida.
    expect(destelloDe(0).alfa).toBe(DESTELLO_ALFA);
    expect(destelloDe(1).alfa).toBe(0);
    expect(destelloDe(2).alfa).toBe(0);
    // Pico en la mitad: ni el radio ni el velo se van de su tope.
    const pico = destelloDe(0.5);
    expect(pico.r).toBeLessThanOrEqual(DESTELLO_RADIO_TOPE * CANICA_R * CANICA_ESCALA);
    expect(pico.r).toBeGreaterThan(CANICA_R * CANICA_ESCALA);
    expect(pico.alto).toBeGreaterThan(0);
    expect(destelloDe(0.5).alfa).toBeLessThan(DESTELLO_ALFA);
    expect(DESTELLO_VIDA).toBeLessThanOrEqual(0.25);
    // Determinista y sin azar.
    expect(destelloDe(0.3)).toEqual(destelloDe(0.3));
  });

  it("la vista dibuja el destello y las líneas más suaves, sin tapar la tierra", () => {
    const src = fuente("bolillas-3d.ts");
    // Los velos del centro, las puntas y las líneas salen de constantes acotadas (S26).
    expect(src).toMatch(/ESTALLO_VELO_CENTRO/);
    expect(src).toMatch(/ESTALLO_VELO_PUNTA/);
    expect(src).toMatch(/ESTALLO_VELO_LINEA/);
    expect(src).not.toContain("Math.random");
  });
});

describe("S25 en 3D: la canica eliminada sale del dibujo como en el 2D", () => {
  it("la vista apaga la malla y su sombra con la cuenta pura de la salida, y olvida su lugar para el chip", () => {
    const src = fuente("bolillas-3d.ts");
    // Una sola cuenta para las dos escenas: el dibujo de la canica sale de `bolillas-arte.ts`.
    expect(src).toMatch(/dibujoDe\(/);
    expect(src).toMatch(/if \(!dib\)/);
    // Sin dibujo no hay malla, ni sombra, ni lugar para proyectar el chip.
    expect(src).toMatch(/c\.grupo\.visible = false/);
    expect(src).toMatch(/c\.sombra\.visible = false/);
    expect(src).toMatch(/puestos\.delete\(slot\)/);
    // Y la canica que se va se apaga de verdad: el vidrio baja su opacidad con el velo del arte.
    expect(src).toMatch(/dib\.velo/);
    expect(src).not.toContain("Math.random");
  });
});

describe("la persecución de la ganadora (S24)", () => {
  it("la cámara se mete detrás de su canica, baja y mirando por delante del empuje", () => {
    const lugar = { px: 100, pz: 200, K: 300, Kz: 260 };
    const pers = { peso: 1, p: { x: 0.2, y: -0.1 }, dir: { x: 0.8, y: -0.6 }, estelas: [] };
    const pose = posePersecucion(pers, lugar);
    const dx = (pose.pos[0] - lugar.px) / lugar.K;
    const dz = (pose.pos[2] - lugar.pz) / lugar.Kz;
    // Detrás: el punto de la cámara queda del lado contrario al rumbo del empuje.
    expect((dx - pers.p.x) * pers.dir.x + (dz - pers.p.y) * pers.dir.y).toBeLessThan(0);
    // Baja y afuera de la canica: el ojo queda por debajo del lomo del vidrio dibujado, no mirando desde arriba.
    expect(pose.pos[1]).toBeLessThan(lugar.K * CANICA_R * 2 * CANICA_ESCALA);
    expect(Math.hypot(dx - pers.p.x, dz - pers.p.y)).toBeGreaterThan(CANICA_R);
    // Mira adelante del empuje: el golpe viene de frente.
    const mx = (pose.mira[0] - lugar.px) / lugar.K;
    const mz = (pose.mira[2] - lugar.pz) / lugar.Kz;
    expect((mx - pers.p.x) * pers.dir.x + (mz - pers.p.y) * pers.dir.y).toBeGreaterThan(0);
    // Más abierto que la mirada del director, para que la persecución se sienta.
    expect(pose.fov).toBeGreaterThan(0.9);
    expect(pose.giro).toBe(0);
  });
});

describe("la línea del anuncio (S28)", () => {
  it("el anuncio de la diana dibuja también la línea punteada negra", () => {
    const src = fuente("bolillas-3d.ts");
    expect(src).toMatch(/digo\.linea/);
    expect(src).toMatch(/grupoLinea/);
    expect(src).toMatch(/0x14100c/);
  });
});
