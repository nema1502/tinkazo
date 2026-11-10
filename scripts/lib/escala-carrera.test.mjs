import { describe, expect, it } from "vitest";
import { CABEZA_A_CABEZA, FESTEJO_DESDE, LLEGADA_RECTA, METAS_ESCALA, TARJETA_MAXIMA, aLaVista, alturasPorTramo, estadisticas, evaluarEscala, tarjetaEnPantalla } from "./escala-carrera.mjs";

const W = 1920, H = 1080;
/** Una caja de `alto` px de alto, centrada en `(cx, cy)`. */
const caja = (cx, cy, alto) => [cx - alto / 2, cy - alto / 2, alto, alto];
/** Una muestra de la recta con tres carriles a las alturas dadas y los hocicos en el orden dado. */
const muestra = (tj, altos, narices = altos.map((_, j) => j), extra = {}) => ({ tj, t: tj - 100, fase: "recta", cajas: altos.map((a, j) => (a === null ? null : caja(200 + 100 * j, 500, a))), narices, ...extra });
const plan = { tAbre: 10, tCrown: 25, ganadora: 1, w: W, h: H };

describe("qué está a la vista", () => {
  it("el centro de la caja adentro de la pantalla; sin caja, no", () => {
    expect(aLaVista(caja(100, 100, 50), W, H)).toBe(true);
    expect(aLaVista(caja(-10, 100, 50), W, H)).toBe(false);
    expect(aLaVista(caja(100, H + 1, 50), W, H)).toBe(false);
    expect(aLaVista(null, W, H)).toBe(false);
  });
});

describe("los altos por tramo", () => {
  it("la recta empieza un segundo después de abrirse y termina a 3 s de la meta", () => {
    const ms = [muestra(10.5, [999, 999]), muestra(11, [100, 200]), muestra(15, [110, 210]), muestra(21.9, [120, 220]), muestra(22, [10, 10]), muestra(30, [5, 5])];
    const r = alturasPorTramo(ms, plan);
    expect(LLEGADA_RECTA).toBe(1);
    expect(CABEZA_A_CABEZA).toBe(3);
    // Entran 11, 15 y 21,9 (22 ya es el cabeza a cabeza): seis alturas, tres por llama.
    expect(r.recta.sort((a, b) => a - b)).toEqual([100, 110, 120, 200, 210, 220]);
    expect(r.porLlama[0]).toEqual([100, 110, 120]);
    expect(r.porLlama[1]).toEqual([200, 210, 220]);
  });

  it("los últimos 3 s miran las tres de más adelante, por el hocico", () => {
    // Cuatro carriles: los hocicos dicen que van adelante el 2, el 0 y el 3; el 1, atrás.
    const ms = [muestra(23, [300, 100, 320, 340], [5, 1, 9, 4])];
    const r = alturasPorTramo(ms, plan);
    expect(r.final.sort((a, b) => a - b)).toEqual([300, 320, 340]);
  });

  it("el festejo es la ganadora desde un segundo después del golpe", () => {
    const ms = [muestra(26, [90, 250], undefined, { fase: "corona", t: 0.5 }), muestra(27, [90, 310], undefined, { fase: "corona", t: FESTEJO_DESDE }), muestra(28, [90, 330], undefined, { fase: "corona", t: 2 })];
    const r = alturasPorTramo(ms, plan);
    expect(r.festejo).toEqual([310, 330]);
  });

  it("lo que no está a la vista no cuenta como alto y se anota aparte", () => {
    const ms = [muestra(12, [100, null, 120])];
    const r = alturasPorTramo(ms, plan);
    expect(r.recta.sort((a, b) => a - b)).toEqual([100, 120]);
    expect(r.sinVer).toBe(1);
  });

  it("las muestras sin cajas (las del grupo y las tandas) se saltan", () => {
    const r = alturasPorTramo([{ tj: 5, tarjeta: [0, 0, 10, 10] }, muestra(12, [100, 110])], plan);
    expect(r.cuadros).toBe(1);
  });
});

describe("estadísticas", () => {
  it("mediana, mínimo, el 5 % más chico y máximo", () => {
    const e = estadisticas([100, 200, 300, 400, 500]);
    expect(e).toMatchObject({ n: 5, mediana: 300, minimo: 100, maximo: 500 });
    expect(e.p05).toBe(100);
  });

  it("sin datos, todo vacío", () => {
    expect(estadisticas([])).toMatchObject({ n: 0, mediana: null, minimo: null });
  });
});

describe("la tarjeta de nombres", () => {
  it("el mayor por ciento de pantalla y los segundos por encima del tope", () => {
    // En 390x844 (329.160 px²): una tarjeta de 300x300 es el 27,3 %.
    const ms = [
      { tj: 0, tarjeta: null },
      { tj: 1, tarjeta: [45, 100, 300, 300] },
      { tj: 2, tarjeta: [45, 100, 300, 300] },
      { tj: 3, tarjeta: [45, 100, 100, 100] },
      { tj: 4, tarjeta: null },
    ];
    const r = tarjetaEnPantalla(ms, 390, 844);
    expect(r.maximo).toBeCloseTo(90000 / (390 * 844), 6);
    expect(r.visible).toBe(3);
    expect(r.segundosSobre).toBe(2);
    expect(r.segundosVisible).toBe(3);
  });

  it("lo que cae fuera de la pantalla no tapa nada", () => {
    const r = tarjetaEnPantalla([{ tj: 0, tarjeta: [-200, 0, 400, 100] }], 390, 844);
    expect(r.maximo).toBeCloseTo(200 * 100 / (390 * 844), 6);
  });

  it("un salto de más de un segundo entre muestras no se cuenta como tiempo visible", () => {
    const r = tarjetaEnPantalla([{ tj: 0, tarjeta: [0, 0, 390, 844] }, { tj: 40, tarjeta: null }], 390, 844);
    expect(r.segundosVisible).toBe(0);
    expect(r.maximo).toBe(1);
  });
});

describe("las metas de la dirección", () => {
  const stats = (rec, fin, fes) => ({ recta: estadisticas(rec), final: estadisticas(fin), festejo: estadisticas(fes) });

  it("en 1080: mediana de 150 o más, ninguna bajo 100, las de punta de 200 a 450 y la ganadora de 300 o más", () => {
    expect(METAS_ESCALA.proyector).toMatchObject({ rectaMediana: 150, rectaMinimo: 100, festejo: 300 });
    const bien = evaluarEscala("proyector", stats([100, 160, 170, 180], [250, 300, 400], [320, 330]));
    expect(bien.every((f) => f.ok)).toBe(true);
    const mal = Object.fromEntries(evaluarEscala("proyector", stats([60, 70, 90], [150], [200])).map((f) => [f.clave, f]));
    expect(mal.rectaMediana.ok).toBe(false);
    expect(mal.rectaMinimo.ok).toBe(false);
    expect(mal.final.ok).toBe(false);
    expect(mal.festejo.ok).toBe(false);
  });

  it("en el celular: la recta de 70 px o más y la tarjeta de 25 % o menos", () => {
    const filas = Object.fromEntries(evaluarEscala("celular", stats([40, 50, 60], [], []), { maximo: 0.4, segundosSobre: 30 }).map((f) => [f.clave, f]));
    expect(filas.rectaMediana.ok).toBe(false);
    expect(filas.tarjeta.ok).toBe(false);
    expect(filas.tarjeta.texto).toMatch(/40,0 %.*30,0 s/);
    expect(filas.rectaMinimo).toBeUndefined();
    const bien = evaluarEscala("celular", stats([70, 80, 90], [], []), { maximo: TARJETA_MAXIMA, segundosSobre: 0 });
    expect(bien.every((f) => f.ok)).toBe(true);
  });

  it("sin nada medido no cumple: una meta no pasa lo que no ve", () => {
    const filas = evaluarEscala("proyector", stats([], [], []));
    expect(filas.every((f) => !f.ok)).toBe(true);
    expect(filas[0].texto).toBe("sin medir");
  });
});
