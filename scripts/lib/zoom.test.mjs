import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { MAX_CARTEL_FUERA, ZOOM_MINIMO, fallasDeCuadro, instalarZoom, juntarCuadros, razonDeZoom, resumirZoom, veces } from "./zoom.mjs";

describe("la medida del zoom", () => {
  it("el mínimo es 1,6×", () => {
    expect(ZOOM_MINIMO).toBe(1.6);
  });

  it("las veces que se acercó es la escala del golpe sobre el plano general", () => {
    expect(razonDeZoom({ minAntes: 0.8, enGolpe: 1.6, golpe: 30 })).toBeCloseTo(2);
    expect(razonDeZoom({ minAntes: 1, enGolpe: 1.12, golpe: 30 })).toBeCloseTo(1.12);
  });

  it("sin golpe, o sin muestras, no hay medida", () => {
    expect(razonDeZoom({ minAntes: 1, enGolpe: 1.5, golpe: null })).toBeNull();
    expect(razonDeZoom({ minAntes: null, enGolpe: 1.5, golpe: 3 })).toBeNull();
    expect(razonDeZoom({ minAntes: Infinity, enGolpe: 0, golpe: 3 })).toBeNull();
    expect(razonDeZoom(null)).toBeNull();
  });

  it("resume las semillas: mínimo, mediana, máximo y cuántas tuvieron golpe", () => {
    expect(resumirZoom([1.5, 2.1, null, 1.8])).toEqual({ semillas: 4, conGolpe: 3, min: 1.5, mediana: 1.8, max: 2.1 });
    expect(resumirZoom([null, null])).toEqual({ semillas: 2, conGolpe: 0, min: null, mediana: null, max: null });
  });

  it("se lee con coma", () => {
    expect(veces(1.8449)).toBe("1,84×");
    expect(veces(null)).toBe("—");
  });
});

describe("el medidor que corre en la página", () => {
  const pagina = () => {
    const ctx = { console };
    ctx.window = ctx;
    ctx.abierto = true;
    ctx.getComputedStyle = () => ({ display: ctx.abierto ? "block" : "none" });
    ctx.document = { getElementById: () => ({}) };
    vm.createContext(ctx);
    vm.runInContext(`(${instalarZoom.toString()})()`, ctx);
    return ctx;
  };
  /** Una cámara y una escena de mentira que el test mueve a mano. */
  const camara = (ctx) => {
    const cam = { tiempo: 0, golpeEn: null };
    const escena = { scale: { x: 1 } };
    ctx.__tinkazo = { camara: cam, escena };
    return { cam, escena };
  };
  const cuadro = (ctx, cam, escena, t, s, golpe = cam.golpeEn) => {
    cam.tiempo = t;
    escena.scale.x = s;
    cam.golpeEn = golpe;
    ctx.__zoom.medir();
  };

  it("el plano general es la escala más chica antes del golpe, y el golpe la más alta en su medio segundo", () => {
    const ctx = pagina();
    const { cam, escena } = camara(ctx);
    for (const [t, s] of [[0.5, 1.0], [5, 0.8], [10, 0.9], [20, 1.4]]) cuadro(ctx, cam, escena, t, s);
    cuadro(ctx, cam, escena, 29.9, 1.6);
    cuadro(ctx, cam, escena, 30, 1.7, 30);
    cuadro(ctx, cam, escena, 30.2, 2.0, 30);
    cuadro(ctx, cam, escena, 30.4, 1.9, 30);
    // Después del medio segundo, o con el plano que se abre otra vez, no cambia nada.
    cuadro(ctx, cam, escena, 31.5, 3.0, 30);
    cuadro(ctx, cam, escena, 33, 0.3, 30);
    expect(ctx.__zoom).toMatchObject({ minAntes: 0.8, enGolpe: 2.0, golpe: 30 });
    expect(razonDeZoom(ctx.__zoom)).toBeCloseTo(2.5);
  });

  it("no mide antes del primer cuadro de la cámara ni sin `window.__tinkazo`", () => {
    const ctx = pagina();
    ctx.__zoom.medir();
    expect(ctx.__zoom.muestras).toBe(0);
    const { cam, escena } = camara(ctx);
    cuadro(ctx, cam, escena, 0, 1);
    expect(ctx.__zoom.muestras).toBe(0);
  });

  it("sabe cuándo terminó el show", () => {
    const ctx = pagina();
    const { cam, escena } = camara(ctx);
    for (let i = 0; i < 8; i++) cuadro(ctx, cam, escena, 1 + i, 1);
    expect(ctx.__zoom.fin).toBe(false);
    ctx.abierto = false;
    for (let i = 0; i < 8; i++) cuadro(ctx, cam, escena, 10 + i, 1);
    expect(ctx.__zoom.fin).toBe(true);
  });

  describe("quien gana y el cartel, con el golpe", () => {
    /** Una pantalla de celular y lo que el juego dice del ganador y de dónde está el cartel en cada cuadro. */
    const conCuadro = (ganador, cartel) => {
      const ctx = pagina();
      const { cam, escena } = camara(ctx);
      ctx.__tinkazo.pantalla = () => ({ w: 390, h: 844, top: 100, bottom: 118 });
      ctx.__tinkazo.ganador = () => (typeof ganador === "function" ? ganador() : ganador);
      ctx.__tinkazo.cartel = () => (typeof cartel === "function" ? cartel() : cartel);
      for (const [t, s] of [[1, 1.0], [10, 0.9]]) cuadro(ctx, cam, escena, t, s);
      return { ctx, cam, escena };
    };
    const golpear = ({ ctx, cam, escena }, ts) => ts.forEach((t) => cuadro(ctx, cam, escena, 30 + t, 1.6, 30));

    it("el ganador entero y el cartel a la vista: sin fallas", () => {
      const m = conCuadro({ x: 150, y: 300, w: 90, h: 110 }, { x: 30, y: 120, w: 330, h: 120 });
      golpear(m, [0, 0.1, 0.4, 0.8, 1.2]);
      expect(m.ctx.__zoom.cuadro).toMatchObject({ n: 5, sinGanador: 0, ganadorFuera: 0, ganadorTapado: 0, cartelFuera: 0 });
      expect(fallasDeCuadro(m.ctx.__zoom.cuadro)).toEqual([]);
    });

    it("mide la parte del ganador que sale de lo que se ve: por un costado, por la barra y por el relator", () => {
      const lado = conCuadro({ x: 345, y: 300, w: 90, h: 110 }, null);
      golpear(lado, [0.1]);
      expect(lado.ctx.__zoom.cuadro.ganadorFuera).toBeCloseTo(0.5, 2);
      const arriba = conCuadro({ x: 150, y: 50, w: 90, h: 100 }, null);
      golpear(arriba, [0.1]);
      expect(arriba.ctx.__zoom.cuadro.ganadorFuera).toBeCloseTo(0.5, 2);
      const abajo = conCuadro({ x: 150, y: 700, w: 90, h: 100 }, null);
      golpear(abajo, [0.1]);
      expect(abajo.ctx.__zoom.cuadro.ganadorFuera).toBeCloseTo(0.74, 2);
      expect(fallasDeCuadro(lado.ctx.__zoom.cuadro)[0]).toMatch(/50 % de quien gana fuera/);
    });

    it("el cartel solo tapa al ganador cuando ya casi llegó a su tamaño, y se cuenta cuánto", () => {
      const m = conCuadro({ x: 150, y: 180, w: 100, h: 100 }, { x: 30, y: 120, w: 330, h: 120 });
      golpear(m, [0.1, 0.2]);
      expect(m.ctx.__zoom.cuadro.ganadorTapado).toBe(0);
      golpear(m, [0.5]);
      expect(m.ctx.__zoom.cuadro.ganadorTapado).toBeCloseTo(0.6, 2);
      expect(fallasDeCuadro(m.ctx.__zoom.cuadro).join(" ")).toMatch(/cartel tapa 60 %/);
    });

    it("el cartel que rebota más ancho que la pantalla falla, y 414 en 390 es lo que pasaba", () => {
      const m = conCuadro({ x: 150, y: 300, w: 90, h: 110 }, { x: -12, y: 120, w: 414, h: 120 });
      golpear(m, [0.3]);
      expect(m.ctx.__zoom.cuadro.cartelFuera).toBe(12);
      expect(fallasDeCuadro(m.ctx.__zoom.cuadro)[0]).toBe("el cartel se sale 12 px de la pantalla");
      expect(MAX_CARTEL_FUERA).toBe(1);
    });

    it("un juego que no dice dónde está quien gana no se puede medir: falla", () => {
      const m = conCuadro(null, null);
      golpear(m, [0, 0.2, 0.6]);
      expect(fallasDeCuadro(m.ctx.__zoom.cuadro)).toEqual(["el juego no dice dónde está quien gana"]);
    });

    it("de varias semillas toma lo peor, y suma los cuadros", () => {
      const j = juntarCuadros([
        { n: 10, sinGanador: 0, ganadorFuera: 0.05, ganadorTapado: 0, cartelFuera: 0 },
        { n: 12, sinGanador: 2, ganadorFuera: 0.3, ganadorTapado: 0.1, cartelFuera: 8 },
        null,
      ]);
      expect(j).toEqual({ n: 22, sinGanador: 2, ganadorFuera: 0.3, ganadorTapado: 0.1, cartelFuera: 8 });
      expect(fallasDeCuadro(j)).toHaveLength(2);
    });

    it("solo mira desde el golpe y hasta 1,2 s después", () => {
      const m = conCuadro({ x: 500, y: 300, w: 90, h: 110 }, null);
      cuadro(m.ctx, m.cam, m.escena, 29, 1.2);
      golpear(m, [1.5, 2]);
      expect(m.ctx.__zoom.cuadro.n).toBe(0);
      expect(fallasDeCuadro(m.ctx.__zoom.cuadro)).toEqual(["no hubo ningún cuadro del golpe para mirar"]);
    });
  });

  it("un juego que nunca hace el golpe queda sin medida, no con una inventada", () => {
    const ctx = pagina();
    const { cam, escena } = camara(ctx);
    for (let i = 1; i < 20; i++) cuadro(ctx, cam, escena, i, 1 + i / 100);
    expect(razonDeZoom(ctx.__zoom)).toBeNull();
  });
});
