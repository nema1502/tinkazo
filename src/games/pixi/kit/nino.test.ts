import { describe, expect, it } from "vitest";
import { guardarMeta, tapaAlGanador, cajaDelFoco, crearDirector, type Pantalla } from "./director";
import { FIGURA, cuantasCaben, figurasDe, tamanoMinimoFigura } from "./figuras";
import { REGLA_NINO, palabrasDe, problemasDeLinea, validarGuion } from "./guion";
import { MARCADOR, ESQUINA, marcadorPorSalidas, medidasMarcador, problemasDeMarcador } from "./marcador";
import { SEPARACION_MAX, enFilaAparte, estaPegado, huecoAlCuerpo, nombreDeSalida, pegarAlCuerpo, unidadDe, type Rect } from "./nombres";
import { DIRECCIONES, POSE_MAX, SALIDAS_APARTE, lugarDe, problemasDeRespuestas, type Respuestas } from "./respuestas";
import { crearSonido, type Voz } from "./sonido";
import type { Camara, Kit, Momentos } from "./tipos";

/* ================================================================== marcador */
describe("marcador: un solo contador, arriba a la izquierda", () => {
  it("siempre en la misma esquina, con la letra de siempre y nunca bajo 15 px", () => {
    expect(ESQUINA).toBe("arriba-izquierda");
    expect(MARCADOR.x).toBe(22);
    expect(medidasMarcador(1).fuente).toBe(22);
    expect(medidasMarcador(0.4).fuente).toBe(15);
    expect(medidasMarcador(1.5).alto).toBeCloseTo(78, 9);
  });

  it("por salidas: baja de a uno, queda en 1 y con el golpe es 1", () => {
    const m = marcadorPorSalidas(5, [2, 4, 6, 8], 10);
    expect([0, 1.9, 2, 5, 6, 9, 10, 99].map(m)).toEqual([5, 5, 4, 3, 2, 1, 1, 1]);
    expect(problemasDeMarcador(m, { duracion: 10, total: 5 })).toEqual([]);
  });

  it("no baja de 1 aunque salgan de más", () => {
    expect(marcadorPorSalidas(2, [1, 2, 3], 9)(5)).toBe(1);
  });

  it("encuentra lo que rompe la regla: sube, salta, no llega a 1, no empieza en el total", () => {
    expect(problemasDeMarcador(() => 3, { duracion: 5, total: 3 }).join(" ")).toContain("con el golpe tiene que quedar en 1");
    expect(problemasDeMarcador((t) => (t < 2 ? 2 : 3), { duracion: 5, total: 2 }).join(" ")).toContain("sube");
    expect(problemasDeMarcador((t) => (t < 2 ? 5 : 1), { duracion: 5, total: 5 }).join(" ")).toContain("baja más de 1 de una vez");
    expect(problemasDeMarcador((t) => (t < 2 ? 5 : 1), { duracion: 5, total: 5, pasoMax: 4 })).toEqual([]);
    expect(problemasDeMarcador((t) => (t < 2 ? 4 : 1), { duracion: 5, total: 5, pasoMax: 9 }).join(" ")).toContain("empieza en 4");
    expect(problemasDeMarcador((t) => (t < 2 ? 2.5 : 1), { duracion: 5, total: 2.5 }).join(" ")).toContain("entero");
  });
});

/* ================================================================== nombres */
const CUERPO: Rect = { x: 100, y: 100, w: 60, h: 80 };

describe("nombres: pegados al cuerpo y, al salir, donde pasó", () => {
  it("la etiqueta queda centrada contra el cuerpo, debajo o arriba", () => {
    expect(pegarAlCuerpo(CUERPO, { w: 100, h: 20 })).toEqual({ x: 80, y: 180, w: 100, h: 20 });
    expect(pegarAlCuerpo(CUERPO, { w: 100, h: 20 }, { arriba: true, sep: 2 })).toEqual({ x: 80, y: 78, w: 100, h: 20 });
  });

  it("pegado quiere decir a lo sumo un cuarto del alto del cuerpo, no al lado", () => {
    expect(SEPARACION_MAX).toBe(0.25);
    expect(estaPegado(CUERPO, pegarAlCuerpo(CUERPO, { w: 100, h: 20 }))).toBe(true);
    expect(estaPegado(CUERPO, pegarAlCuerpo(CUERPO, { w: 100, h: 20 }, { sep: 20 }))).toBe(true);
    expect(estaPegado(CUERPO, pegarAlCuerpo(CUERPO, { w: 100, h: 20 }, { sep: 21 }))).toBe(false);
    expect(estaPegado(CUERPO, { x: 400, y: 180, w: 100, h: 20 })).toBe(false);
    expect(huecoAlCuerpo(CUERPO, { x: 100, y: 180, w: 10, h: 10 })).toBe(0);
  });

  it("quien sale deja su nombre donde pasó, entero dentro de la zona", () => {
    const zona: Rect = { x: 0, y: 0, w: 300, h: 200 };
    const e = nombreDeSalida({ x: 0, y: 150, w: 40, h: 40 }, { w: 120, h: 24 }, zona);
    expect(e.x).toBe(0);
    expect(e.y + e.h).toBeLessThanOrEqual(200);
    expect(e.x + e.w).toBeLessThanOrEqual(300);
    // Casi en el mismo lugar: no viaja a otra parte de la pantalla.
    expect(Math.abs(e.y - 190)).toBeLessThan(40);
  });

  it("una fila aparte de nombres sueltos se detecta, y los pegados a su cuerpo no", () => {
    const cuerpos = [0, 1, 2, 3].map((i): Rect => ({ x: i * 120, y: 300, w: 60, h: 80 }));
    const pegadas = cuerpos.map((c) => pegarAlCuerpo(c, { w: 90, h: 20 }));
    expect(enFilaAparte(cuerpos, pegadas)).toBe(false);
    const fila = [0, 1, 2, 3].map((i): Rect => ({ x: i * 100, y: 10, w: 90, h: 20 }));
    expect(enFilaAparte(cuerpos, fila)).toBe(true);
    expect(enFilaAparte(cuerpos, fila.slice(0, 2))).toBe(false);
    // Las que salieron en una fila, aunque los vivos estén pegados.
    expect(enFilaAparte(cuerpos, [...pegadas, ...fila])).toBe(true);
  });
});

/* ================================================================== figuras */
describe("figuras: la persona es una figura con cara y nombre", () => {
  it("cada figura lleva su nombre, con cara o con emblema", () => {
    const nombres = ["Ana", "Luis", "Marta"];
    for (const modo of ["caras", "emblemas"] as const) {
      const f = figurasDe(nombres, "ab12", modo);
      expect(f.map((x) => x.nombre)).toEqual(nombres);
    }
  });

  it("nunca mide menos de 40 px: ni un emblema de 30", () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [1366, 768], [390, 844], [360, 640], [844, 390]] as const) {
      const px = tamanoMinimoFigura(unidadDe(w, h));
      expect(px, `${w}x${h}`).toBeGreaterThanOrEqual(FIGURA.minimoPx);
      expect(px).toBeGreaterThan(30);
    }
    expect(tamanoMinimoFigura(1.5)).toBeCloseTo(84, 9);
    expect(tamanoMinimoFigura(1, true)).toBeCloseTo(67.2, 9);
  });

  it("cuántas caben: más pantalla, más figuras, y figuras más grandes, menos", () => {
    const chica = cuantasCaben({ w: 390, h: 600 }, 52, 20);
    const grande = cuantasCaben({ w: 1800, h: 800 }, 84, 28);
    expect(grande).toBeGreaterThan(chica);
    expect(cuantasCaben({ w: 1800, h: 800 }, 168, 28)).toBeLessThan(grande);
    expect(cuantasCaben({ w: 10, h: 10 }, 52, 20)).toBe(0);
  });
});

/* ================================================================== guion */
describe("guion: lo que dice el relator, para un niño", () => {
  it("seis palabras como máximo", () => {
    expect(REGLA_NINO).toEqual({ palabras: 6, nombres: 1 });
    expect(palabrasDe("  ¡Se sienta Ana!  ")).toBe(3);
    expect(problemasDeLinea("Solo uno se lleva el premio.")).toEqual([]);
    expect(problemasDeLinea("Solo uno se lleva el gran premio.")[0]).toContain("7 palabras");
  });

  it("sin números: van en el marcador", () => {
    expect(problemasDeLinea("¡Quedan 17!")[0]).toContain("números");
  });

  it("un nombre por línea", () => {
    const lista = ["Miguel Arce", "Sofía Aguilar"];
    expect(problemasDeLinea("¡Sale Miguel Arce!", lista)).toEqual([]);
    expect(problemasDeLinea("¡Salen Miguel Arce y Sofía Aguilar!", lista).join(" ")).toContain("2 personas");
  });

  it("validarGuion con nino: marca las líneas que rompen la regla, y sin nino no las mira", () => {
    const lineas = [{ t: 1, texto: "¡Quedan 17 en la mesa final ya!" }, { t: 3, texto: "¡Bien!" }];
    expect(validarGuion(lineas, 5).problemas).toEqual([]);
    const r = validarGuion(lineas, 5, { nino: true });
    expect(r.problemas).toHaveLength(2);
  });
});

/* ================================================================== sonido */
describe("sonido: la salida suena igual en todos los juegos", () => {
  it("un solo tono suave, sin fracaso: ni grave ni bajando", () => {
    const toques: { hz: number; vol: number }[] = [];
    const nota = (g: number): number => 130.81 * Math.pow(2, (([0, 2, 4, 7, 9][g % 5] ?? 0) + 12 * Math.floor(g / 5)) / 12);
    const voz: Voz = { tono: (hz, _d, _t, vol) => toques.push({ hz, vol }), nota, fanfarria: () => undefined, despues: (_m, fn) => fn() };
    crearSonido(voz).salida();
    expect(toques).toHaveLength(1);
    expect(toques[0]?.hz).toBeGreaterThan(300);
    expect(toques[0]?.vol).toBeGreaterThanOrEqual(0.04);
  });
});

/* ================================================================== director */
const PANT: Pantalla = { w: 1000, h: 600, k: 1, zona: { x0: 0, y0: 80, x1: 1000, y1: 500 }, placaBajo: 250 };

describe("director: la meta en todo cuadro y el cartel nunca sobre el ganador", () => {
  it("la meta que está dentro no mueve la vista", () => {
    const v = { x: 500, y: 290, z: 1 };
    expect(guardarMeta(v, { x: 800, y: 200, w: 50, h: 50 }, PANT)).toEqual(v);
    expect(guardarMeta(v, null, PANT)).toEqual(v);
  });

  it("la meta que quedaría afuera aleja la cámara o la corre hasta que entre entera", () => {
    const v = { x: 200, y: 290, z: 2 };
    const meta = { x: 1500, y: 200, w: 100, h: 100 };
    const g = guardarMeta(v, meta, PANT);
    const px = (x: number): number => PANT.w / 2 + (x - g.x) * g.z;
    // Cabe a este acercamiento: la cámara solo se corre.
    expect(g.z).toBeLessThanOrEqual(v.z);
    // Una meta grande, que no entra a ese acercamiento, aleja la cámara hasta que entre.
    expect(guardarMeta({ x: 450, y: 250, z: 3 }, { x: 0, y: 100, w: 900, h: 300 }, PANT).z).toBeCloseTo(1000 / 900, 9);
    expect(px(meta.x)).toBeGreaterThanOrEqual(PANT.zona.x0 - 1e-6);
    expect(px(meta.x + meta.w)).toBeLessThanOrEqual(PANT.zona.x1 + 1e-6);
  });

  it("el cartel está encima de quien gana si su centro queda por encima del borde de abajo del cartel", () => {
    expect(tapaAlGanador(250, { x: 500, y: 200, r: 40 })).toBe(true);
    expect(tapaAlGanador(250, { x: 500, y: 400, r: 40 })).toBe(false);
  });

  it("el cuadrado de quien gana vuelve al mundo con la vista de la cámara", () => {
    const v = { x: 300, y: 200, z: 2 };
    const f = { x: 650, y: 380, r: 60 };
    const c = cajaDelFoco(f, v, PANT.w, PANT.h);
    // Su centro, mirado con la misma vista, cae donde dice el foco.
    expect(PANT.w / 2 + (c.x + c.w / 2 - v.x) * v.z).toBeCloseTo(f.x, 9);
    expect(PANT.h / 2 + (c.y + c.h / 2 - v.y) * v.z).toBeCloseTo(f.y, 9);
    expect(c.w * v.z).toBeCloseTo(120, 9);
  });

  it("con el golpe, si el plan no dijo qué proteger, la cámara protege a quien gana debajo del cartel", () => {
    const llamadas: { que: string; args: unknown[] }[] = [];
    const anota = (que: string) => (...args: unknown[]): unknown => void llamadas.push({ que, args });
    const cam: Camara = { x: 500, y: 300, zoom: 1, lookAt: anota("lookAt"), tension: anota("tension"), golpe: () => 1, punch: anota("punch"), shake: anota("shake"), proteger: anota("proteger"), toScreen: (x, y) => ({ x, y }) };
    const momentos: Momentos = {
      presentacion: { hasta: 2, toma: () => ({ vista: { x: 500, y: 300, z: 1 } }) },
      tension: { desde: 5, toma: () => ({ vista: { x: 500, y: 300, z: 1 } }) },
      foco: () => ({ x: 500, y: 400, r: 50 }),
    };
    const d = crearDirector({ duracion: 10, arco: "remontada", momentos }, { cam, kit: {} as Kit, pantalla: () => PANT, marcar: () => undefined, ritmo: () => 1 });
    d.cuadro(3);
    expect(llamadas.some((l) => l.que === "proteger")).toBe(false);
    d.cuadro(11);
    const g = llamadas.filter((l) => l.que === "proteger").at(-1);
    expect(g?.args[0]).toEqual(cajaDelFoco({ x: 500, y: 400, r: 50 }, { x: 500, y: 300, z: 1 }, PANT.w, PANT.h));
    expect((g?.args[1] as { y0: number }).y0).toBe(250);
  });
});

/* ================================================================== respuestas */
const base = (): { duracion: number; sentido: "derecha"; respuestas: (t: number) => Respuestas; guion: { t: number; hecho?: { tipo: "salio" | "adelante"; quien?: number } }[] } => ({
  duracion: 20,
  sentido: "derecha",
  respuestas: (t) => ({
    adelante: { quienes: t >= 20 ? [2] : [2, 5], lugar: "derecha" },
    hacia: "derecha",
    progreso: Math.min(1, t / 20),
    paso: t < 1 ? { tipo: "empezo", desde: 0 } : t < 8 ? { tipo: "adelante", quien: 5, desde: 1 } : t < 14 ? { tipo: "salio", quien: 4, desde: 8 } : { tipo: "salio", quien: 3, desde: 14 },
  }),
  guion: [{ t: 8, hecho: { tipo: "salio", quien: 4 } }, { t: 14, hecho: { tipo: "salio", quien: 3 } }],
});

describe("respuestas: la prueba del niño", () => {
  const o = { n: 8, ganadores: [2] };

  it("un plan que dice quién va adelante, hacia dónde, cuánto falta y qué pasó no tiene problemas", () => {
    expect(problemasDeRespuestas(base(), o)).toEqual([]);
    expect(POSE_MAX).toBe(0.3);
    expect(SALIDAS_APARTE).toBe(1);
    expect(DIRECCIONES).toContain("alrededor");
  });

  it("un solo sentido: si «hacia» cambia, falla", () => {
    const p = base();
    const r = p.respuestas;
    p.respuestas = (t) => ({ ...r(t), hacia: t > 10 ? "izquierda" : "derecha" });
    expect(problemasDeRespuestas(p, o).join(" ")).toContain("«hacia» cambia");
  });

  it("el progreso solo sube y llega a 1 con el golpe", () => {
    const p = base();
    const r = p.respuestas;
    p.respuestas = (t) => ({ ...r(t), progreso: t > 10 ? 0.2 : t / 20 });
    expect(problemasDeRespuestas(p, o).join(" ")).toContain("el progreso baja");
    const q = base();
    q.respuestas = (t) => ({ ...base().respuestas(t), progreso: t / 40 });
    expect(problemasDeRespuestas(q, o).join(" ")).toContain("no llega a 1");
  });

  it("quien gana tiene que ir adelante con el golpe", () => {
    expect(problemasDeRespuestas(base(), { n: 8, ganadores: [6] }).join(" ")).toContain("quien gana no va adelante");
  });

  it("dos salidas a menos de 1 s: ninguna se ve", () => {
    const p = base();
    const r = p.respuestas;
    p.respuestas = (t) => (t >= 14 && t < 14.5 ? { ...r(t), paso: { tipo: "salio", quien: 3, desde: 8.5 } } : r(t));
    expect(problemasDeRespuestas({ ...p, guion: [] }, o).join(" ")).toContain("dos salidas a menos de 1 s");
  });

  it("cada hecho de una línea tiene que verse en el cuerpo a los 0,3 s", () => {
    const p = base();
    p.guion = [{ t: 7.5, hecho: { tipo: "salio", quien: 4 } }];
    expect(problemasDeRespuestas(p, o).join(" ")).toContain("a los 0.3 s el cuerpo no lo muestra");
  });

  it("los puestos tienen que existir, y no repetirse", () => {
    const p = base();
    const r = p.respuestas;
    p.respuestas = (t) => ({ ...r(t), adelante: { quienes: [2, 99], lugar: "derecha" } });
    expect(problemasDeRespuestas(p, o).join(" ")).toContain("no existen o repetidos");
  });

  it("el lugar sale de la pantalla: el tercio del medio es el centro", () => {
    expect(lugarDe(500, 300, 1000, 600)).toBe("centro");
    expect(lugarDe(900, 300, 1000, 600)).toBe("derecha");
    expect(lugarDe(100, 300, 1000, 600)).toBe("izquierda");
    expect(lugarDe(500, 50, 1000, 600)).toBe("arriba");
    expect(lugarDe(500, 560, 1000, 600)).toBe("abajo");
  });
});
