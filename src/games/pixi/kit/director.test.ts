import { describe, expect, it } from "vitest";
import { writeStory } from "../../drama";
import { latidosFoco, tiemposFoco } from "../foco";
import { sembrar } from "./azar";
import {
  ARCOS,
  FASES,
  POR_DEFECTO,
  SABOR,
  avance,
  crearDirector,
  cronograma,
  elegirToma,
  faseEn,
  planoEntero,
  planoSobre,
  problemasDeMomentos,
  resolverToma,
  type Fase,
  type Pantalla,
} from "./director";
import type { Caja, Camara, Kit, Momentos, PlanoToma, Toma } from "./tipos";

const KIT = {} as Kit;
const MUNDO: Caja = { x: 0, y: 0, w: 1000, h: 500 };
const PANT: Pantalla = { w: 1280, h: 720, k: 1, zona: { x0: 0, y0: 82, x1: 1280, y1: 600 } };

interface Llamada {
  que: string;
  args: unknown[];
}

/** Una cámara que anota lo que le piden. */
function camaraFalsa(): { cam: Camara; llamadas: Llamada[] } {
  const llamadas: Llamada[] = [];
  const anota = (que: string) => (...args: unknown[]): unknown => {
    llamadas.push({ que, args });
    return undefined;
  };
  const cam: Camara = {
    x: 0, y: 0, zoom: 1,
    lookAt: anota("lookAt"),
    tension: anota("tension"),
    golpe: (...args: unknown[]) => {
      llamadas.push({ que: "golpe", args });
      return 17.25;
    },
    punch: anota("punch"),
    shake: anota("shake"),
    proteger: anota("proteger"),
    toScreen: (x, y) => ({ x, y }),
  };
  return { cam, llamadas };
}

const toma = (id: number): Toma => () => ({ vista: { x: id, y: id, z: 1 + id / 10 } });

function plan(arco: "remontada" | "susto" | "duelo" | "tapada" = "remontada", extra: Partial<Momentos> = {}) {
  const momentos: Momentos = {
    presentacion: { hasta: 3, toma: toma(1) },
    tomas: [{ desde: 6, toma: toma(2) }, { desde: 9, toma: toma(3) }],
    tension: { desde: 12, toma: toma(4) },
    foco: () => ({ x: 0, y: 0, r: 10 }),
    ...extra,
  };
  return { duracion: 20, arco, momentos };
}

describe("director: el sabor de cada arco", () => {
  it("los valores por defecto son el empuje del 12 % y el golpe del 20 % sostenido 0,5 s", () => {
    expect(POR_DEFECTO.empuje).toBe(0.12);
    expect(POR_DEFECTO.golpe).toEqual({ amt: 0.2, hold: 0.5, vuelta: 1.2 });
    for (const arco of ARCOS) {
      expect(SABOR[arco].empuje).toBe(0.12);
      expect(SABOR[arco].golpe.amt).toBe(0.2);
      expect(SABOR[arco].golpe.hold).toBe(0.5);
    }
  });

  it("hay un sabor por cada arco de la historia, y los latidos son los del foco", () => {
    expect(Object.keys(SABOR).sort()).toEqual([...ARCOS].sort());
    for (const arco of ARCOS) expect(SABOR[arco].latidos).toBe(latidosFoco(arco).length);
    expect(SABOR.tapada.apagon).toBe(true);
    expect(SABOR.duelo.marco).toBe(true);
    expect(SABOR.remontada.apagon || SABOR.remontada.marco).toBe(false);
  });

  it("cada arco se siente distinto aunque los montos sean los mismos", () => {
    const firmas = new Set(ARCOS.map((a) => JSON.stringify([SABOR[a].empujeDur, SABOR[a].golpe.vuelta, SABOR[a].sacudon])));
    expect(firmas.size).toBe(4);
  });
});

describe("director: el cronograma y los cinco arcos", () => {
  it("con el ritmo normal, los tiempos son los del foco", () => {
    const c = cronograma(plan("susto"), 1);
    const f = tiemposFoco("susto");
    expect(c.corona).toBe(20);
    expect(c.golpeEn).toBeCloseTo(20 + f.golpe, 9);
    expect(c.placaEn).toBeCloseTo(20 + f.placa, 9);
    expect(c.silencioDesde).toBeCloseTo(19.6, 9);
  });

  it("el ritmo épico estira el juego, así que los segundos reales del foco duran menos en segundos de juego", () => {
    const normal = cronograma(plan(), 1);
    const epico = cronograma(plan(), 2.2);
    expect(epico.golpeEn - epico.corona).toBeCloseTo((normal.golpeEn - normal.corona) / 2.2, 9);
    expect(epico.silencioDesde).toBeGreaterThan(normal.silencioDesde);
  });

  it("el respiro puede caer antes de coronar (De pie corta la música en la respuesta que decide)", () => {
    const c = cronograma({ ...plan(), respiro: 15 }, 1);
    expect(c.silencioDesde).toBeCloseTo(14.6, 9);
  });

  it("la presentación, el juego, la tensión, el silencio, el golpe y el foco, en ese orden", () => {
    const c = cronograma(plan(), 1);
    const f = tiemposFoco("remontada");
    const visto: Fase[] = [];
    for (const t of [0, 2.9, 3, 8, 12, 15, 19.5, 19.7, 20 + f.golpe, 20 + f.placa - 0.01, 20 + f.placa, 30]) visto.push(faseEn(c, t));
    expect(visto).toEqual(["presentacion", "presentacion", "juego", "juego", "tension", "tension", "tension", "silencio", "golpe", "golpe", "foco", "foco"]);
    expect(new Set(visto).size).toBe(FASES.length);
  });

  it("el empuje empieza justo para llegar arriba al coronar, sin antes de la tensión", () => {
    expect(cronograma(plan("remontada"), 1).empujeDesde).toBe(16);
    expect(cronograma(plan("susto"), 1).empujeDesde).toBeCloseTo(15.5, 9);
    expect(cronograma({ ...plan(), momentos: { ...plan().momentos, tension: { desde: 18, toma: toma(4) } } }, 1).empujeDesde).toBe(18);
  });

  it("los momentos en orden no dan problemas, y los desordenados sí", () => {
    expect(problemasDeMomentos(plan())).toEqual([]);
    const mal = plan("remontada", { presentacion: { hasta: 14, toma: toma(1) } });
    expect(problemasDeMomentos(mal).length).toBeGreaterThan(0);
    expect(problemasDeMomentos({ ...plan(), duracion: 0 }).length).toBeGreaterThan(0);
    const desordenadas = plan("remontada", { tomas: [{ desde: 9, toma: toma(2) }, { desde: 6, toma: toma(3) }] });
    expect(problemasDeMomentos(desordenadas)).toContain("las tomas intermedias no están en orden");
    expect(problemasDeMomentos(plan("remontada", { tension: { desde: 12, toma: toma(4), empuje: 0.9 } }))).toHaveLength(1);
    expect(problemasDeMomentos({ ...plan(), respiro: 30 })).toHaveLength(1);
  });
});

describe("director: las tomas", () => {
  it("elige la presentación, la última intermedia que ya empezó, y la tensión", () => {
    const m = plan().momentos;
    const id = (t: number): number => ((elegirToma(m, t)(KIT, t) as { vista: { x: number } }).vista.x);
    expect([0, 2.9, 3, 5.9, 6, 8.9, 9, 11.9, 12, 19].map(id)).toEqual([1, 1, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("una caja se encuadra entera dentro de la zona libre", () => {
    const v = resolverToma({ caja: MUNDO }, PANT);
    // 1000 x 500 en 1280 x 518: manda el alto.
    expect(v.z).toBeCloseTo(518 / 500, 9);
    expect(v.x).toBeCloseTo(500, 9);
    // El centro de la caja cae en el centro de la zona (y = 341), no de la pantalla (y = 360).
    expect(PANT.h / 2 + (250 - v.y) * v.z).toBeCloseTo(341, 6);
  });

  it("el acercamiento máximo manda aunque la caja entrara más", () => {
    expect(resolverToma({ caja: { x: 0, y: 0, w: 100, h: 50 }, zoomMax: 1.5 }, PANT).z).toBe(1.5);
  });

  it("una vista ya calculada pasa tal cual, y una caja vacía no rompe nada", () => {
    expect(resolverToma({ vista: { x: 5, y: 6, z: 2 } }, PANT)).toEqual({ x: 5, y: 6, z: 2 });
    const v = resolverToma({ caja: { x: 10, y: 10, w: 0, h: 0 } }, PANT);
    expect(v.z).toBe(1);
    expect(Number.isFinite(v.x) && Number.isFinite(v.y)).toBe(true);
  });

  it("planoEntero respira un 1 % y planoSobre une las cajas con su margen", () => {
    expect((planoEntero(MUNDO)(KIT, 0) as { respira: number }).respira).toBe(0.01);
    const sobre = planoSobre(() => [{ x: 0, y: 0, w: 10, h: 10 }, { x: 90, y: 40, w: 10, h: 10 }], { margen: 5, zoomMax: 2 })(KIT, 0) as Extract<PlanoToma, { caja: Caja }>;
    expect(sobre.caja).toEqual({ x: -5, y: -5, w: 110, h: 60 });
    expect(sobre.zoomMax).toBe(2);
  });

  it("avance() va de 0 a 1", () => {
    expect([avance(0, 1, 3), avance(2, 1, 3), avance(5, 1, 3)]).toEqual([0, 0.5, 1]);
  });
});

/** Corre el director cuadro por cuadro a 60 por segundo. */
function correr(p: ReturnType<typeof plan>, ritmo = 1, hasta = 26) {
  const { cam, llamadas } = camaraFalsa();
  const marcas: [string, string][] = [];
  const d = crearDirector(p, { cam, kit: KIT, pantalla: () => PANT, marcar: (k, v) => marcas.push([k, v]), ritmo: () => ritmo });
  const horaDeLlamada: number[] = [];
  const fases: Fase[] = [];
  for (let i = 0; i <= hasta * 60; i++) {
    const t = i / 60;
    const antes = llamadas.length;
    fases.push(d.cuadro(t));
    if (llamadas.slice(antes).some((l) => l.que === "tension")) horaDeLlamada.push(t);
    if (t >= d.cronograma.golpeEn && i % 60 === 0) d.golpe();
  }
  return { d, llamadas, marcas, horaDeLlamada, fases };
}

describe("director: lo que le pide a la cámara", () => {
  it("lleva la cámara en cada cuadro, con números de verdad", () => {
    const { llamadas } = correr(plan());
    const miradas = llamadas.filter((l) => l.que === "lookAt");
    expect(miradas.length).toBe(26 * 60 + 1);
    for (const m of miradas) for (const n of m.args) expect(Number.isFinite(n as number)).toBe(true);
  });

  it("la tensión se pide una sola vez, desde el empuje y con el 12 %", () => {
    const { llamadas, horaDeLlamada } = correr(plan());
    const t = llamadas.filter((l) => l.que === "tension");
    expect(t).toHaveLength(1);
    expect(t[0]?.args[1]).toBe(0.12);
    expect(horaDeLlamada[0]).toBeGreaterThanOrEqual(16);
    expect(horaDeLlamada[0]).toBeLessThan(16.05);
    // Llega arriba justo al coronar.
    expect(((t[0]?.args[0] as number) + (horaDeLlamada[0] as number))).toBeCloseTo(20, 1);
  });

  it("el plan puede pedir su propio empuje", () => {
    const { llamadas } = correr(plan("remontada", { tension: { desde: 12, toma: toma(4), empuje: 0.2 } }));
    expect(llamadas.find((l) => l.que === "tension")?.args[1]).toBe(0.2);
  });

  it("el golpe cae una sola vez, con el 20 %, el sostén y el sacudón, y se anota", () => {
    const { llamadas, marcas } = correr(plan("susto"));
    expect(llamadas.filter((l) => l.que === "golpe")).toHaveLength(1);
    expect(llamadas.find((l) => l.que === "golpe")?.args).toEqual([0.2, 0.5, 1.4]);
    expect(llamadas.find((l) => l.que === "shake")?.args).toEqual([12]);
    expect(marcas.filter(([k]) => k === "golpe")).toEqual([["golpe", "17.250"]]);
  });

  it("anota cada arco una vez, en orden, para los auditores", () => {
    const { marcas } = correr(plan());
    expect(marcas.filter(([k]) => k === "momento").map(([, v]) => v)).toEqual(["presentacion", "juego", "tension", "silencio", "golpe", "foco"]);
  });

  it("lo protegido se pide recién con el golpe, nunca antes", () => {
    const caja: Caja = { x: 1, y: 2, w: 3, h: 4 };
    const zona = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const { llamadas } = correr(plan("remontada", { protegido: () => ({ caja, zona }) }));
    const guardias = llamadas.filter((l) => l.que === "proteger");
    expect(guardias.length).toBeGreaterThan(0);
    expect(guardias.every((g) => g.args[0] === caja && g.args[1] === zona)).toBe(true);
    const primera = llamadas.findIndex((l) => l.que === "proteger");
    const ultimoLookAntes = llamadas.slice(0, primera).filter((l) => l.que === "lookAt").length;
    expect(ultimoLookAntes / 60).toBeGreaterThanOrEqual(20.5 - 0.05);
  });

  it("una toma con respiración late alrededor de su acercamiento", () => {
    const entero: Toma = () => ({ vista: { x: 0, y: 0, z: 1 }, respira: 0.01 });
    const { llamadas } = correr(plan("remontada", { presentacion: { hasta: 10, toma: entero }, tomas: [] }));
    // Diez segundos: más de un ciclo completo de la respiración.
    const zs = llamadas.filter((l) => l.que === "lookAt").slice(0, 600).map((l) => l.args[2] as number);
    expect(Math.max(...zs)).toBeGreaterThan(1.005);
    expect(Math.min(...zs)).toBeLessThan(0.995);
    expect(Math.max(...zs)).toBeLessThanOrEqual(1.01 + 1e-9);
  });
});

describe("director: determinista desde la semilla", () => {
  const arcoDe = (semilla: number): "remontada" | "susto" | "duelo" | "tapada" => writeStory(sembrar(semilla), 12, 3).arc;

  it("la misma semilla cuenta el mismo arco, el mismo sabor y las mismas llamadas a la cámara", () => {
    for (let s = 1; s <= 16; s++) {
      const a = correr(plan(arcoDe(s)));
      const b = correr(plan(arcoDe(s)));
      expect(a.llamadas).toEqual(b.llamadas);
      expect(a.marcas).toEqual(b.marcas);
      expect(a.d.cronograma).toEqual(b.d.cronograma);
    }
  });

  it("entre cuarenta semillas aparecen los cuatro arcos: el director varía", () => {
    const vistos = new Set(Array.from({ length: 40 }, (_, i) => arcoDe(i + 1)));
    expect(vistos.size).toBe(4);
  });

  it("cada arco tiene un golpe y un cronograma propios", () => {
    const golpes = new Set(ARCOS.map((a) => correr(plan(a)).d.cronograma.golpeEn.toFixed(3)));
    expect(golpes.size).toBe(4);
  });
});
