import { describe, expect, it } from "vitest";
import { TARJETA, FIJOS, T_VUELO } from "../../src/games/llamas/carrera-base";
import { alfabetico, planCarrera } from "../../src/games/llamas/carrera-show";
import { writeStory } from "../../src/games/drama";
import { TEXTOS_CARRERA } from "../../src/games/llamas/carrera-textos";
import { azarDe, sembrar } from "../../src/games/pixi/kit/azar";
import { listHash } from "../../src/protocol/canonical";
import { select } from "../../src/protocol/select";
import { rondaDe } from "./delatores-carrera.mjs";
import {
  GOLPE_JUNTO,
  SILENCIO_MINIMO,
  TABLA_DIRECCION,
  cartelSeVe,
  duracionesDelPlan,
  evaluarDramaPlan,
  evaluarSemillas,
  golpeJunto,
  huecosDelPlan,
  instalarDrama,
  medirSemillaDrama,
  resumirDramaPlan,
  resumirSemillas,
  silencioAntesDelGolpe,
  tablaDeMetas,
} from "./drama-show.mjs";
import { relojTurbo } from "./reloj-turbo.mjs";

const lib = { planCarrera, alfabetico, sembrar, azarDe, textos: TEXTOS_CARRERA, writeStory, select, listHash };

describe("el silencio antes del golpe", () => {
  const golpe = 30;

  it("cuenta desde el fin del último efecto, con su duración", () => {
    // Un efecto de 0,2 s que arranca a 29,5 termina a 29,7: 0,3 s de silencio.
    const r = silencioAntesDelGolpe({ osc: [{ v: 29.5, dur: 0.2, musica: false }], golpeV: golpe });
    expect(r.efectos).toBeCloseTo(0.3, 5);
    expect(r.musica).toBeNull();
    expect(r.silencio).toBeCloseTo(0.3, 5);
  });

  it("el caso de hoy: un latido pegado al golpe deja 0 s", () => {
    const r = silencioAntesDelGolpe({ osc: [{ v: 29.8, dur: 0.22, musica: false }], golpeV: golpe });
    expect(r.efectos).toBe(0);
  });

  it("la música no cuenta como efecto: se mide por su corte", () => {
    const r = silencioAntesDelGolpe({ osc: [{ v: 29.99, dur: 0.5, musica: true }, { v: 29.0, dur: 0.1, musica: false }], golpeV: golpe, musicaCorte: 29.6 });
    expect(r.efectos).toBeCloseTo(0.9, 5);
    expect(r.musica).toBeCloseTo(0.4, 5);
    expect(r.silencio).toBeCloseTo(0.4, 5);
  });

  it("lo que arranca en el golpe (la fanfarria) o después no cuenta", () => {
    const r = silencioAntesDelGolpe({ osc: [{ v: 30, dur: 0.7, musica: false }, { v: 30.5, dur: 0.1, musica: false }], golpeV: golpe });
    expect(r.efectos).toBeNull();
    expect(r.silencio).toBeNull();
  });

  it("sin golpe no hay nada que medir", () => {
    expect(silencioAntesDelGolpe({ osc: [], golpeV: null }).silencio).toBeNull();
  });

  it("un sonido sin duración anotada vale un toque corto, no cero", () => {
    expect(silencioAntesDelGolpe({ osc: [{ v: 29.9, dur: 0, musica: false }], golpeV: golpe }).efectos).toBeCloseTo(0.05, 5);
  });
});

describe("cuándo se ve el cartel", () => {
  it("el primer cuadro en que mide la mitad de su ancho final", () => {
    const cuadros = [[1, 0], [1.1, 40], [1.2, 150], [1.3, 320], [1.4, 340], [1.5, 330]];
    // El ancho final es 340: la mitad, 170; a las 1,2 mide 150 y todavía no se lee.
    expect(cartelSeVe(cuadros)).toBe(1.3);
  });

  it("sin cartel no hay hora", () => {
    expect(cartelSeVe([[1, 0], [1.1, 0]])).toBeNull();
    expect(cartelSeVe(undefined)).toBeNull();
  });
});

describe("el golpe junto", () => {
  const osc = [{ v: 49.99, dur: 0.1, musica: false }, { v: 50, dur: 0.7, musica: false }, { v: 50.02, dur: 0.1, musica: false }];

  it("separación entre la luz, el acercamiento, el sonido y el cartel", () => {
    const g = golpeJunto({ golpe: { luz: 50, zoom: 50, cartel: 50.1 }, osc, cartel: [[50.1, 0], [50.15, 100], [50.2, 320], [50.3, 330]] });
    expect(g.luz).toBe(50);
    expect(g.zoom).toBe(50);
    // El primer efecto desde dos cuadros antes del acercamiento: el de 49,99.
    expect(g.sonido).toBeCloseTo(49.99, 5);
    expect(g.cartel).toBe(50.2);
    expect(g.partes).toBe(4);
    expect(g.separacion).toBeCloseTo(0.21, 5);
    expect(g.cartelPlaca).toBe(50.1);
  });

  it("todo en el mismo cuadro: separación cero", () => {
    const g = golpeJunto({ golpe: { luz: 50, zoom: 50 }, osc: [{ v: 50, dur: 0.7, musica: false }], cartel: [[50, 300], [50.1, 300]] });
    expect(g.separacion).toBe(0);
  });

  it("lo que no se pudo medir no cuenta, pero se anota cuántas partes fueron", () => {
    const g = golpeJunto({ golpe: { luz: 50, zoom: 50 }, osc: [], cartel: [] });
    expect(g.partes).toBe(2);
    expect(g.sonido).toBeNull();
    expect(g.cartel).toBeNull();
  });

  it("la música no es el sonido del golpe", () => {
    const g = golpeJunto({ golpe: { luz: 50, zoom: 50 }, osc: [{ v: 50, dur: 1, musica: true }], cartel: [] });
    expect(g.sonido).toBeNull();
  });
});

describe("las semillas del navegador", () => {
  const rit = (v0) => ({
    osc: [{ v: v0 - 0.6, dur: 0.1, musica: false }, { v: v0, dur: 0.7, musica: false }],
    cartel: [[v0 + 0.1, 0], [v0 + 0.15, 330], [v0 + 0.2, 340]],
    cambios: [{ tipo: "empezo", desde: 0 }, { tipo: "salio", quien: 1, desde: 3 }, { tipo: "gano", quien: 2, desde: 12 }],
    abre: 0.5,
    cierra: 14.5,
  });
  const semilla = (v0, silencioMusica) => medirSemillaDrama(rit(v0), { zoom: v0, luz: v0, cartel: v0 + 0.1, musicaCorte: v0 - silencioMusica });

  it("una semilla: silencio, golpe, total y huecos", () => {
    const s = semilla(13, 0.9);
    expect(s.conGolpe).toBe(true);
    expect(s.efectos).toBeCloseTo(0.5, 5);
    expect(s.musica).toBeCloseTo(0.9, 5);
    expect(s.silencio).toBeCloseTo(0.5, 5);
    expect(s.total).toBe(14);
    // Hechos: 0, 3, 12; con el final en el último: huecos de 3 y 9.
    expect(s.huecosSobre4).toBe(1);
    expect(s.maximoHueco).toBe(9);
  });

  it("un show que nunca llegó al golpe no tiene silencio ni golpe", () => {
    const s = medirSemillaDrama({ osc: [], cartel: [], cambios: [], abre: 0, cierra: 10 }, {});
    expect(s.conGolpe).toBe(false);
    expect(s.silencio).toBeNull();
  });

  it("junta las semillas y evalúa contra la dirección: el silencio de 0,5 s y el golpe a 0,2 s", () => {
    const r = resumirSemillas([semilla(13, 0.9), semilla(20, 0.7), semilla(31, 0.8)]);
    expect(r.semillas).toBe(3);
    expect(r.silencioMin).toBeCloseTo(0.5, 5);
    const ev = Object.fromEntries(evaluarSemillas(r).map((e) => [e.clave, e]));
    expect(ev.silencio.ok).toBe(true);
    expect(ev.golpe.ok).toBe(true);
    // El cartel se ve 0,15 s después del golpe: más de 100 ms y un cuadro.
    expect(ev.golpeJunto.ok).toBe(false);
    expect(ev.golpeJunto.texto).toMatch(/150 ms/);
  });

  it("un silencio de menos de 0,4 s no cumple, y sin ninguna medida de silencio tampoco", () => {
    const corto = resumirSemillas([medirSemillaDrama({ ...rit(13), osc: [{ v: 12.9, dur: 0.1, musica: false }, { v: 13, dur: 0.7, musica: false }] }, { zoom: 13, luz: 13, cartel: 13, musicaCorte: 12.5 })]);
    expect(evaluarSemillas(corto).find((e) => e.clave === "silencio").ok).toBe(false);
    const sin = resumirSemillas([medirSemillaDrama({ osc: [], cartel: [], cambios: [], abre: 0, cierra: 5 }, { zoom: 5, luz: 5 })]);
    expect(evaluarSemillas(sin).find((e) => e.clave === "silencio").ok).toBe(false);
  });

  it("las metas son las de la dirección", () => {
    expect(SILENCIO_MINIMO).toBe(0.4);
    expect(GOLPE_JUNTO).toBe(0.1);
  });
});

describe("desde el plan", () => {
  it("con 18 personas: huecos, tramos y total de cada ronda son números del plan", () => {
    for (let i = 1; i <= 3; i++) {
      const { ctx } = rondaDe(lib, 18, i);
      const plan = planCarrera(ctx, {});
      const d = plan.datos;
      const h = huecosDelPlan(d);
      expect(h.hechos).toBeGreaterThan(5);
      expect(h.maximo).toBeGreaterThan(0);
      const t = duracionesDelPlan(d, { TARJETA, FIJOS, T_VUELO });
      expect(t.tarjeta).toBe(TARJETA);
      // Sin tandas (18): la largada es el vuelo y los nombres hasta la salida.
      expect(t.largada).toBe(d.tSalida);
      expect(t.tandas).toBe(0);
      expect(t.largada + t.grupo + t.recta).toBeCloseTo(d.tCrown, 5);
      expect(t.total).toBeCloseTo(TARJETA + d.tCrown + FIJOS, 5);
    }
  });

  it("con 60 personas hay tandas: la largada es solo el vuelo y las tandas, lo que sigue hasta la salida", () => {
    const { ctx } = rondaDe(lib, 60, 2);
    const d = planCarrera(ctx, {}).datos;
    const t = duracionesDelPlan(d, { TARJETA, FIJOS, T_VUELO });
    expect(t.largada).toBe(T_VUELO);
    expect(t.tandas).toBeCloseTo(d.tSalida - T_VUELO, 5);
    expect(t.tandas).toBeGreaterThan(10);
  });

  it("evalúa contra la tabla de la sección 3: el show de hoy con 18 personas dura más de lo que pide", () => {
    const rondas = [1, 2, 3, 4].map((i) => {
      const { ctx } = rondaDe(lib, 18, i);
      const d = planCarrera(ctx, {}).datos;
      return { huecos: huecosDelPlan(d), tramos: duracionesDelPlan(d, { TARJETA, FIJOS, T_VUELO }) };
    });
    const r = resumirDramaPlan(rondas);
    const ev = Object.fromEntries(evaluarDramaPlan(r, 18).map((e) => [e.clave, e]));
    expect(ev.total.valor).toBeGreaterThan(TABLA_DIRECCION[18].total);
    expect(ev.total.ok).toBe(false);
    expect(ev.huecos).toBeDefined();
    expect(tablaDeMetas(Object.values(ev), "x")).toMatch(/el show entero/);
  });

  it("sin tabla para ese tamaño (30, por ejemplo) solo mira los huecos", () => {
    const r = resumirDramaPlan([{ huecos: { huecos: [2, 2, 2], maximo: 2, sobre4: 0 }, tramos: { tarjeta: 3.5, largada: 6.7, tandas: 0, grupo: 20, recta: 15, fijos: 6, total: 50 } }]);
    const ev = evaluarDramaPlan(r, 30);
    expect(ev.map((e) => e.clave)).toEqual(["huecos", "huecosMediana"]);
    expect(ev.every((e) => e.ok)).toBe(true);
  });
});

describe("la página", () => {
  it("instalarDrama y el reloj en turbo arman un guion de página válido", () => {
    const s = relojTurbo({ instalar: instalarDrama, muestrear: "window.__dr.muestrear" });
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain("window.__dr = D");
    expect(s).toContain("window.__dr.muestrear(virt)");
  });
});
