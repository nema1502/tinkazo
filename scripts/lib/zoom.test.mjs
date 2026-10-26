import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { ZOOM_MINIMO, instalarZoom, razonDeZoom, resumirZoom, veces } from "./zoom.mjs";

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

  it("un juego que nunca hace el golpe queda sin medida, no con una inventada", () => {
    const ctx = pagina();
    const { cam, escena } = camara(ctx);
    for (let i = 1; i < 20; i++) cuadro(ctx, cam, escena, i, 1 + i / 100);
    expect(razonDeZoom(ctx.__zoom)).toBeNull();
  });
});
