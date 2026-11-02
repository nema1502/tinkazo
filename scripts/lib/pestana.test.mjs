import { describe, expect, it } from "vitest";
import { atrasados, cartelDesde, cartelSeApago, cartelVisibleS, ganadorDicho, juzgarPestana, normalizar, ventanaOculta } from "./pestana.mjs";

/** Una corrida de control: 38 s, el cartel a los 34 y los sonidos a tiempo. */
const control = () => ({
  ganadorPlan: "Carlos Choque", cerro: true, dur: 38,
  comentarios: [{ t: 2, txt: "¡Arranca!" }, { t: 33.5, txt: "¿Se queda en Carlos Choque?" }, { t: 34, txt: "¡ES PARA Carlos Choque!" }],
  cartel: [{ t: 34, on: true }],
  sonidos: Array.from({ length: 100 }, (_, i) => ({ t: i * 0.38, tarde: -0.1 })),
  vis: [], errores: [],
});

/** La misma escena con la pestaña escondida de los 19 a los 29 s: el show se frena y termina 10 s después. */
const escondida = (cambia = {}) => ({
  ...control(), dur: 48,
  comentarios: [{ t: 2, txt: "¡Arranca!" }, { t: 43.5, txt: "¿Se queda en Carlos Choque?" }, { t: 44, txt: "¡ES PARA Carlos Choque!" }],
  cartel: [{ t: 44, on: true }],
  vis: [{ t: 19, v: "hidden" }, { t: 29, v: "visible" }],
  ...cambia,
});

const por = (cs, parte) => cs.find((c) => c.name.includes(parte));

describe("ventanaOculta", () => {
  it("devuelve cuándo se escondió y cuándo volvió", () => {
    expect(ventanaOculta([{ t: 19, v: "hidden" }, { t: 29, v: "visible" }])).toEqual({ desde: 19, hasta: 29 });
  });
  it("sin esconderse, o sin volver, no hay ventana", () => {
    expect(ventanaOculta([])).toBeNull();
    expect(ventanaOculta([{ t: 19, v: "hidden" }])).toBeNull();
    expect(ventanaOculta([{ t: 1, v: "visible" }])).toBeNull();
  });
  it("toma la primera vez que se escondió", () => {
    expect(ventanaOculta([{ t: 5, v: "hidden" }, { t: 8, v: "visible" }, { t: 12, v: "hidden" }, { t: 15, v: "visible" }])).toEqual({ desde: 5, hasta: 8 });
  });
});

describe("el cartel", () => {
  it("cartelDesde es la primera vez que aparece", () => {
    expect(cartelDesde([])).toBeNull();
    expect(cartelDesde([{ t: 3, on: false }, { t: 7, on: true }])).toBe(7);
  });
  it("se apagó si después de aparecer hubo un apagado", () => {
    expect(cartelSeApago([{ t: 7, on: true }])).toBe(false);
    expect(cartelSeApago([{ t: 7, on: true }, { t: 9, on: false }])).toBe(true);
    expect(cartelSeApago([])).toBe(false);
  });
  it("cuánto lo vio la sala no cuenta el rato escondida", () => {
    const c = { dur: 48, cartel: [{ t: 44, on: true }] };
    expect(cartelVisibleS(c)).toBe(4);
    // El cartel cayó a los 15 y la pestaña se escondió de 19 a 29: 10 s que no cuentan.
    expect(cartelVisibleS({ dur: 48, cartel: [{ t: 15, on: true }] }, { desde: 19, hasta: 29 })).toBe(23);
    // Un cartel posterior a la vuelta no resta nada.
    expect(cartelVisibleS(c, { desde: 19, hasta: 29 })).toBe(4);
  });
  it("sin cartel o sin cierre no hay tiempo", () => {
    expect(cartelVisibleS({ dur: 10, cartel: [] })).toBeNull();
    expect(cartelVisibleS({ dur: null, cartel: [{ t: 1, on: true }] })).toBeNull();
  });
});

describe("atrasados", () => {
  const s = [{ t: 29.0, tarde: 0.3 }, { t: 29.1, tarde: 0.4 }, { t: 29.2, tarde: -0.1 }, { t: 29.6, tarde: 0.4 }, { t: 28.9, tarde: 0.5 }];
  it("cuenta solo los que arrancan en el pasado y dentro de la ventana", () => {
    expect(atrasados(s, 29, 29.5)).toBe(2);
  });
  it("un poco de atraso no cuenta", () => {
    expect(atrasados([{ t: 1, tarde: 0.2 }, { t: 1, tarde: 0.251 }], 0, 5)).toBe(1);
  });
});

describe("ganadorDicho", () => {
  it("encuentra el nombre aunque tenga acentos, mayúsculas o signos", () => {
    expect(ganadorDicho([{ t: 5, txt: "¡ES PARA María Fernández!" }], "Maria Fernandez")).toBe(true);
  });
  it("solo mira lo último que se dijo", () => {
    const cs = [{ t: 1, txt: "Carlos Choque va primero" }, { t: 9, txt: "¡Qué final!" }];
    expect(ganadorDicho(cs, "Carlos Choque")).toBe(false);
    expect(ganadorDicho([...cs, { t: 12, txt: "¡ES PARA Carlos Choque!" }], "Carlos Choque")).toBe(true);
  });
  it("sin nombre del plan, o sin nada dicho, no se puede afirmar nada", () => {
    expect(ganadorDicho([{ t: 1, txt: "algo" }], "")).toBe(false);
    expect(ganadorDicho([], "Ana")).toBe(false);
  });
});

describe("juzgarPestana", () => {
  it("un show que se frena y sigue limpio pasa todo", () => {
    const cs = juzgarPestana({ control: control(), prueba: escondida() });
    expect(cs.length).toBe(5);
    expect(cs.filter((c) => !c.ok)).toEqual([]);
  });

  it("si la pestaña no llegó a esconderse, lo dice y no sigue", () => {
    const cs = juzgarPestana({ control: control(), prueba: escondida({ vis: [] }) });
    expect(cs.length).toBe(1);
    expect(cs[0].ok).toBe(false);
  });

  it("el ganador equivocado reprueba", () => {
    const p = escondida({ comentarios: [{ t: 44, txt: "¡ES PARA Rosa Quispe!" }] });
    expect(por(juzgarPestana({ control: control(), prueba: p }), "ganador").ok).toBe(false);
  });

  it("sin cartel, reprueba el ganador y el cartel", () => {
    const cs = juzgarPestana({ control: control(), prueba: escondida({ cartel: [] }) });
    expect(por(cs, "ganador").ok).toBe(false);
    expect(por(cs, "cartel").ok).toBe(false);
  });

  it("una excepción reprueba, venga de la página o de la consola", () => {
    expect(por(juzgarPestana({ control: control(), prueba: escondida({ errores: ["boom"] }) }), "excepciones").ok).toBe(false);
    expect(por(juzgarPestana({ control: control(), prueba: escondida(), excepciones: ["TypeError"] }), "excepciones").ok).toBe(false);
  });

  it("el cartel que se saltó (dura menos de lo normal) reprueba", () => {
    // Cierra apenas aparece: 0,5 s contra 4 s normales.
    const p = escondida({ dur: 44.5 });
    expect(por(juzgarPestana({ control: control(), prueba: p }), "cartel").ok).toBe(false);
  });

  it("el cartel que se apagó antes de cerrar reprueba", () => {
    const p = escondida({ cartel: [{ t: 44, on: true }, { t: 45, on: false }, { t: 46, on: true }] });
    expect(por(juzgarPestana({ control: control(), prueba: p }), "cartel").ok).toBe(false);
  });

  it("si el golpe cayó con la pestaña escondida y el cartel se queda su tiempo, pasa", () => {
    // Escondida de 33 a 43, el cartel cayó al volver (43) y cierra a los 47: 4 s, como en el control.
    const p = escondida({ dur: 47, vis: [{ t: 33, v: "hidden" }, { t: 43, v: "visible" }], cartel: [{ t: 43.1, on: true }] });
    const c = por(juzgarPestana({ control: control(), prueba: p }), "cartel");
    expect(c.ok).toBe(true);
    expect(c.detail).toContain("cayó con la pestaña escondida");
  });

  it("más de tres sonidos atrasados en el primer medio segundo es una ráfaga", () => {
    const rafaga = Array.from({ length: 4 }, (_, i) => ({ t: 29.1 + i * 0.05, tarde: 0.3 }));
    const p = escondida({ sonidos: [...control().sonidos, ...rafaga] });
    const c = por(juzgarPestana({ control: control(), prueba: p }), "ráfaga");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("4 atrasados");
    expect(c.detail).toContain("4 de ellos al volver");
  });

  it("el racimo de cada segundo mientras estaba escondida también es una ráfaga", () => {
    const mientras = Array.from({ length: 50 }, (_, i) => ({ t: 20 + i * 0.1, tarde: 0.7 }));
    const c = por(juzgarPestana({ control: control(), prueba: escondida({ sonidos: [...control().sonidos, ...mientras] }) }), "ráfaga");
    expect(c.ok).toBe(false);
    expect(c.detail).toContain("0 de ellos al volver");
  });

  it("tres atrasados todavía pasan, y un tirón de 0,22 s con una nube de sonidos no cuenta", () => {
    const tres = Array.from({ length: 3 }, (_, i) => ({ t: 29.1 + i * 0.05, tarde: 0.3 }));
    const tiron = Array.from({ length: 24 }, (_, i) => ({ t: 25, tarde: 0.22 - i * 0.005 }));
    const c = por(juzgarPestana({ control: control(), prueba: escondida({ sonidos: [...control().sonidos, ...tres, ...tiron] }) }), "ráfaga");
    expect(c.ok).toBe(true);
  });

  it("la etiqueta va delante del nombre", () => {
    const cs = juzgarPestana({ control: control(), prueba: escondida(), etiqueta: "al 50 %" });
    expect(cs.every((c) => c.name.startsWith("al 50 %: "))).toBe(true);
  });

  it("si el plan del control y el de la prueba no coinciden, el ganador no es el del plan", () => {
    const p = escondida();
    p.ganadorPlan = "Otra Persona";
    p.comentarios = [{ t: 44, txt: "¡ES PARA Otra Persona!" }];
    expect(por(juzgarPestana({ control: control(), prueba: p }), "ganador").ok).toBe(false);
  });
});

describe("normalizar", () => {
  it("pasa los milisegundos del reloj a segundos desde que se ve el estadio", () => {
    const ps = {
      t0: 10_000, t1: 48_000, cuadros: 100,
      sonidos: [{ r: 11_000, tarde: 0.1 }],
      coment: [{ r: 12_000, txt: "hola" }],
      cartel: [{ r: 44_000, on: true }],
      vis: [{ r: 29_000, v: "hidden" }],
      errores: ["x"],
    };
    const n = normalizar(ps, { ganadorPlan: "Ana" });
    expect(n.dur).toBe(38);
    expect(n.cerro).toBe(true);
    expect(n.sonidos).toEqual([{ t: 1, tarde: 0.1 }]);
    expect(n.comentarios).toEqual([{ t: 2, txt: "hola" }]);
    expect(n.cartel).toEqual([{ t: 34, on: true }]);
    expect(n.vis).toEqual([{ t: 19, v: "hidden" }]);
    expect(n.ganadorPlan).toBe("Ana");
  });
  it("un estadio que no cerró no tiene duración", () => {
    const n = normalizar({ t0: 1000, t1: -1, cuadros: 1, sonidos: [], coment: [], cartel: [], vis: [], errores: [] });
    expect(n.cerro).toBe(false);
    expect(n.dur).toBeNull();
  });
});

describe("el cartel en tiempo de juego", () => {
  it("usa el reloj del show: una corrida lenta en tiempo real con el mismo tiempo de juego no cambia nada", () => {
    const rapida = { dur: 40, gCierre: 30, cartel: [{ t: 37.6, on: true, g: 27.6 }] };
    const lenta = { dur: 40.7, gCierre: 30, cartel: [{ t: 37.6, on: true, g: 27.6 }] };
    expect(cartelVisibleS(rapida)).toBeCloseTo(2.4);
    expect(cartelVisibleS(lenta)).toBeCloseTo(2.4);
  });
  it("la escondida se compara con el control en la misma unidad y pasa aunque el control haya sido lento", () => {
    const ctl = { ...control(), dur: 40.7, gCierre: 30, cartel: [{ t: 37.6, on: true, g: 27.6 }] };
    const prueba = { ...escondida(), dur: 50, gCierre: 30, cartel: [{ t: 47.6, on: true, g: 27.6 }] };
    const r = juzgarPestana({ control: ctl, prueba, excepciones: [], etiqueta: "x" });
    expect(r.find((c) => c.name.includes("se queda su tiempo normal")).ok).toBe(true);
  });
  it("normalizar pasa la hora de juego", () => {
    const n = normalizar({ t0: 1000, t1: 41000, cuadros: 1, g: 30, gCierre: 30, coment: [], sonidos: [], vis: [], errores: [], cartel: [{ r: 38600, on: true, g: 27.6 }] });
    expect(n.gCierre).toBe(30);
    expect(n.cartel[0].g).toBe(27.6);
  });
});
