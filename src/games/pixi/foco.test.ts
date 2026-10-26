import { describe, expect, it, vi } from "vitest";
import { ARCS } from "../drama";
import { ESTADO_QUIETO, estadoFoco, latidosFoco, piezasDePenumbra, radioSano, tiemposFoco, type EstadoFoco } from "./foco";

const CLAVES = ["oscuro", "luz", "cono", "rayos", "suben", "destello", "marco", "marcoRival"] as const;

describe("los tiempos del foco", () => {
  it("la placa sale después del golpe y todo cabe en un par de segundos", () => {
    for (const a of ARCS) {
      const t = tiemposFoco(a);
      expect(t.placa).toBeGreaterThan(t.golpe);
      expect(t.placa - t.golpe).toBeLessThanOrEqual(0.25);
      expect(t.golpe).toBeGreaterThanOrEqual(0.4);
      expect(t.placa).toBeLessThanOrEqual(1.3);
    }
  });

  it("el susto tarda más que la remontada: un latido de más", () => {
    expect(tiemposFoco("susto").golpe).toBeGreaterThan(tiemposFoco("remontada").golpe + 0.3);
  });

  it("sin arco vale lo de la remontada", () => {
    expect(tiemposFoco(undefined)).toEqual(tiemposFoco("remontada"));
  });
});

describe("los latidos del silencio", () => {
  it("caen adentro del silencio, antes del golpe, y no se pisan", () => {
    for (const a of ARCS) {
      const l = latidosFoco(a);
      const { golpe } = tiemposFoco(a);
      expect(l.length).toBeGreaterThanOrEqual(1);
      for (const t of l) {
        expect(t).toBeGreaterThan(0.1);
        expect(t).toBeLessThan(golpe - 0.2);
      }
      for (let i = 1; i < l.length; i++) expect((l[i] as number) - (l[i - 1] as number)).toBeGreaterThanOrEqual(0.2);
    }
  });

  it("el susto y la tapada, que esperan más, tienen dos; los rápidos, uno", () => {
    expect(latidosFoco("susto")).toHaveLength(2);
    expect(latidosFoco("tapada")).toHaveLength(2);
    expect(latidosFoco("remontada")).toHaveLength(1);
    expect(latidosFoco("duelo")).toHaveLength(1);
  });

  it("ningún silencio pasa de un segundo sin sonar nada: del corte al primer latido, y entre latidos, menos de medio segundo", () => {
    for (const a of ARCS) {
      const l = latidosFoco(a);
      const { golpe } = tiemposFoco(a);
      const marcas = [0, ...l, golpe];
      for (let i = 1; i < marcas.length; i++) expect((marcas[i] as number) - (marcas[i - 1] as number)).toBeLessThan(0.65);
    }
  });
});

describe("el estado del foco", () => {
  it("antes de coronar no hay nada: el foco nunca se enciende antes del ganador", () => {
    for (const a of ARCS) {
      for (const tr of [-1, 0, -0.001]) expect(estadoFoco(a, tr)).toEqual(ESTADO_QUIETO);
      expect(estadoFoco(a, NaN)).toEqual(ESTADO_QUIETO);
    }
  });

  it("es una función pura de la hora y del arco, sin azar", () => {
    const azar = vi.spyOn(Math, "random");
    for (const a of ARCS) {
      for (let tr = 0.01; tr < 5; tr += 0.037) expect(estadoFoco(a, tr)).toEqual(estadoFoco(a, tr));
    }
    expect(azar).not.toHaveBeenCalled();
    azar.mockRestore();
  });

  it("todo queda entre 0 y 1 y sin NaN, en cualquier momento y arco", () => {
    for (const a of ARCS) {
      for (let tr = 0.001; tr < 8; tr += 0.013) {
        const e = estadoFoco(a, tr);
        for (const c of CLAVES) {
          expect(Number.isFinite(e[c])).toBe(true);
          expect(e[c]).toBeGreaterThanOrEqual(0);
          expect(e[c]).toBeLessThanOrEqual(1.0001);
        }
        expect(Number.isFinite(e.giro)).toBe(true);
        expect(e.pulso).toBeGreaterThan(0.9);
        expect(e.pulso).toBeLessThan(1.1);
        for (const o of [e.onda, e.onda2]) expect(o === -1 || (o >= 0 && o <= 1)).toBe(true);
      }
    }
  });

  it("primero el silencio: oscuro y sin golpe; recién con el golpe, onda, rayos y destello", () => {
    for (const a of ARCS) {
      const { golpe } = tiemposFoco(a);
      const antes = estadoFoco(a, golpe - 0.02);
      expect(antes.silencio).toBe(true);
      expect(antes.oscuro).toBeGreaterThan(0.6);
      expect(antes.onda).toBe(-1);
      expect(antes.rayos).toBe(0);
      expect(antes.destello).toBe(0);
      expect(antes.luz).toBeLessThan(0.7);
      const despues = estadoFoco(a, golpe + 0.05);
      expect(despues.silencio).toBe(false);
      expect(despues.onda).toBeGreaterThanOrEqual(0);
      expect(despues.rayos).toBeGreaterThan(0);
      expect(despues.destello).toBeGreaterThan(0.2);
    }
  });

  it("la luz queda encendida mientras se sostiene el cartel y la penumbra se afloja sin irse", () => {
    for (const a of ARCS) {
      const { placa } = tiemposFoco(a);
      for (const dt of [0.5, 1.5, 3]) {
        const e = estadoFoco(a, placa + dt);
        expect(e.luz).toBeGreaterThan(0.75);
        expect(e.oscuro).toBeGreaterThan(0.3);
        expect(e.oscuro).toBeLessThan(0.7);
      }
    }
  });

  it("la penumbra solo baja con el golpe, no antes", () => {
    for (const a of ARCS) {
      const { golpe } = tiemposFoco(a);
      let prev = 0;
      for (let tr = 0.01; tr < golpe; tr += 0.01) {
        const o = estadoFoco(a, tr).oscuro;
        expect(o).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = o;
      }
    }
  });

  it("cada arco tiene su sabor", () => {
    const g = (a: (typeof ARCS)[number], d: number): EstadoFoco => estadoFoco(a, tiemposFoco(a).golpe + d);
    // Solo la remontada sube rayos del piso; solo el duelo tiene la foto.
    expect(g("remontada", 0.2).suben).toBeGreaterThan(0.3);
    for (const a of ["susto", "duelo", "tapada"] as const) expect(g(a, 0.2).suben).toBe(0);
    expect(g("duelo", 0.6).marco).toBe(1);
    expect(g("duelo", 0.6).marcoRival).toBe(1);
    for (const a of ["remontada", "susto", "tapada"] as const) expect(g(a, 0.6).marco).toBe(0);
    // El duelo suelta el flash entero; la tapada se apaga del todo antes del golpe.
    expect(g("duelo", 0.01).destello).toBeGreaterThan(0.9);
    expect(estadoFoco("tapada", 0.3).oscuro).toBeGreaterThan(0.95);
    // La tapada tiene sus chispazos antes de prender; el susto, un hilo que late.
    expect(estadoFoco("tapada", 0.35).luz).toBeGreaterThan(0.2);
    expect(estadoFoco("tapada", 0.45).luz).toBeLessThan(0.05);
    const hilo = [0.15, 0.32, 0.42, 0.6].map((t) => estadoFoco("susto", t).luz);
    expect(Math.max(...hilo)).toBeLessThan(0.45);
    expect(Math.max(...hilo)).toBeGreaterThan(0.2);
  });

  it("las ondas salen una detrás de otra y terminan", () => {
    const a = "remontada";
    const { golpe } = tiemposFoco(a);
    expect(estadoFoco(a, golpe + 0.05).onda2).toBe(-1);
    expect(estadoFoco(a, golpe + 0.3).onda2).toBeGreaterThan(0);
    expect(estadoFoco(a, golpe + 2).onda).toBe(-1);
    expect(estadoFoco(a, golpe + 2).onda2).toBe(-1);
  });
});

describe("la penumbra con su hueco", () => {
  const area = (cajas: { w: number; h: number }[]): number => cajas.reduce((s, c) => s + c.w * c.h, 0);

  it("las piezas más el hueco cubren la pantalla justa, sin encimarse", () => {
    const W = 1280, H = 720;
    for (const [cx, cy, R] of [[640, 360, 120], [100, 80, 150], [1200, 700, 90], [640, 360.4, 119.6], [-50, 300, 80], [1300, 400, 400]] as const) {
      const { hueco, piezas } = piezasDePenumbra(cx, cy, R, W, H);
      // Lo que del hueco queda adentro de la pantalla.
      const ix = Math.max(0, Math.min(W, hueco.x + hueco.w) - Math.max(0, hueco.x));
      const iy = Math.max(0, Math.min(H, hueco.y + hueco.h) - Math.max(0, hueco.y));
      expect(area(piezas) + ix * iy).toBe(W * H);
      for (const p of piezas) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(W);
        expect(p.y + p.h).toBeLessThanOrEqual(H);
        expect(Number.isInteger(p.x) && Number.isInteger(p.y) && Number.isInteger(p.w) && Number.isInteger(p.h)).toBe(true);
      }
    }
  });

  it("el radio de quien gana se acota", () => {
    expect(radioSano(2, 1280, 720, 1)).toBe(26);
    expect(radioSano(9999, 1280, 720, 1)).toBe(216);
    expect(radioSano(NaN, 1280, 720, 1)).toBe(26);
    expect(radioSano(100, 1280, 720, 1)).toBe(100);
  });
});
