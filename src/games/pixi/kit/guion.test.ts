import { describe, expect, it } from "vitest";
import { PRIORIDAD, PROTECCION, SEPARACION_MIN, VENCE, crearGuion, validarGuion, type EjecutorGuion } from "./guion";
import type { LineaGuion } from "./tipos";

type K = { n: number };

/** Corre el guion a 60 cuadros por segundo y anota qué se dijo y qué se hizo, y cuándo. */
function correr(lineas: LineaGuion<K>[], hasta: number, saltarEn?: number): { dicho: { t: number; texto: string }[]; hecho: number[] } {
  const g = crearGuion<K>(lineas);
  const dicho: { t: number; texto: string }[] = [];
  const hecho: number[] = [];
  let ahora = 0;
  const ej: EjecutorGuion<K> = {
    decir: (texto) => dicho.push({ t: ahora, texto }),
    hacer: () => hecho.push(ahora),
  };
  for (let i = 0; i <= Math.round(hasta * 60); i++) {
    ahora = i / 60;
    if (saltarEn !== undefined && ahora >= saltarEn) g.saltar();
    g.avanzar(ahora, ej);
  }
  return { dicho, hecho };
}

describe("guion: cada línea sale una vez, en su segundo", () => {
  it("dice cada frase cuando le toca y no la repite", () => {
    const { dicho } = correr([{ t: 1, texto: "uno" }, { t: 3, texto: "tres" }, { t: 2, texto: "dos" }], 5);
    expect(dicho.map((d) => d.texto)).toEqual(["uno", "dos", "tres"]);
    for (const [i, esperado] of [1, 2, 3].entries()) expect(dicho[i]?.t).toBeGreaterThanOrEqual(esperado);
    for (const [i, esperado] of [1, 2, 3].entries()) expect(dicho[i]?.t).toBeLessThan(esperado + 0.05);
  });

  it("las acciones salen en su segundo aunque no tengan texto", () => {
    const { hecho, dicho } = correr([{ t: 0.5, hacer: () => undefined }, { t: 2, hacer: () => undefined }], 3);
    expect(dicho).toEqual([]);
    expect(hecho.length).toBe(2);
    expect(hecho[0]).toBeGreaterThanOrEqual(0.5);
    expect(hecho[1]).toBeGreaterThanOrEqual(2);
  });

  it("una línea con texto y acción hace las dos juntas", () => {
    const { dicho, hecho } = correr([{ t: 1, texto: "ahora", hacer: () => undefined }], 2);
    expect(dicho.length).toBe(1);
    expect(hecho).toEqual([dicho[0]?.t]);
  });
});

describe("guion: frases que se arman al decirlas", () => {
  it("una función se evalúa recién cuando la frase sale, y una sola vez", () => {
    let llamadas = 0;
    const { dicho } = correr([{ t: 2, texto: () => `armada ${++llamadas}` }], 4);
    expect(dicho.map((d) => d.texto)).toEqual(["armada 1"]);
    expect(llamadas).toBe(1);
  });

  it("si la frase vence en la cola, nunca se arma", () => {
    let llamadas = 0;
    correr([{ t: 1, texto: "importante", prioridad: PRIORIDAD.importante }, { t: 1.4, texto: () => `tarde ${++llamadas}`, vence: 0.2 }], 5);
    expect(llamadas).toBe(0);
  });

  it("validarGuion también mira las frases armadas", () => {
    expect(validarGuion<K>([{ t: 1, texto: () => "  " }], 5).problemas).toHaveLength(1);
    expect(validarGuion<K>([{ t: 1, texto: () => "ok" }], 5).problemas).toEqual([]);
  });
});

describe("guion: la cola", () => {
  it("nunca dos frases a menos de 0,3 s: la segunda espera", () => {
    const { dicho } = correr([{ t: 1, texto: "a" }, { t: 1.05, texto: "b" }, { t: 1.1, texto: "c" }], 4);
    expect(dicho.map((d) => d.texto)).toEqual(["a", "b", "c"]);
    for (let i = 1; i < dicho.length; i++) {
      expect((dicho[i]?.t ?? 0) - (dicho[i - 1]?.t ?? 0)).toBeGreaterThanOrEqual(SEPARACION_MIN - 1e-9);
    }
  });

  it("las frases siguen en el orden del guion aunque una espere", () => {
    const { dicho } = correr([{ t: 1, texto: "a" }, { t: 1.01, texto: "b" }, { t: 1.02, texto: "c" }], 4);
    expect(dicho.map((d) => d.texto)).toEqual(["a", "b", "c"]);
  });

  it("una frase normal no pisa a una importante antes de 1,2 s", () => {
    const { dicho } = correr([{ t: 1, texto: "importante", prioridad: PRIORIDAD.importante }, { t: 1.5, texto: "normal" }], 5);
    expect(dicho.map((d) => d.texto)).toEqual(["importante", "normal"]);
    expect((dicho[1]?.t ?? 0) - (dicho[0]?.t ?? 0)).toBeGreaterThanOrEqual(PROTECCION - 1e-9);
  });

  it("una importante sí entra después de una normal, separada solo por 0,3 s", () => {
    const { dicho } = correr([{ t: 1, texto: "normal" }, { t: 1.1, texto: "importante", prioridad: PRIORIDAD.importante }], 4);
    expect(dicho.map((d) => d.texto)).toEqual(["normal", "importante"]);
    expect((dicho[1]?.t ?? 0) - (dicho[0]?.t ?? 0)).toBeLessThan(0.4);
  });

  it("lo que espera más de lo que vence se tira, y su acción pasa igual", () => {
    const g = crearGuion<K>([
      { t: 1, texto: "importante", prioridad: PRIORIDAD.importante },
      { t: 1.4, texto: "tarde", vence: 0.2, hacer: () => undefined },
    ]);
    const dicho: string[] = [];
    let hechos = 0;
    for (let i = 0; i <= 300; i++) g.avanzar(i / 60, { decir: (x) => dicho.push(x), hacer: () => hechos++ });
    expect(dicho).toEqual(["importante"]);
    expect(g.tiradas()).toBe(1);
    expect(hechos).toBe(1);
  });

  it("la espera por defecto es de 1,5 s", () => {
    expect(VENCE).toBe(1.5);
  });

  it("quien gana pisa todo, también a una importante fresca", () => {
    const { dicho } = correr([
      { t: 1, texto: "importante", prioridad: PRIORIDAD.importante },
      { t: 1.05, texto: "GANA", prioridad: PRIORIDAD.ganador },
    ], 3);
    expect(dicho.map((d) => d.texto)).toEqual(["importante", "GANA"]);
    expect((dicho[1]?.t ?? 0) - (dicho[0]?.t ?? 0)).toBeLessThan(0.1);
  });
});

describe("guion: saltar", () => {
  it("al saltar se tira lo pendiente y no sale nada más", () => {
    const g = crearGuion<K>([{ t: 1, texto: "a" }, { t: 5, texto: "b", hacer: () => undefined }, { t: 6, hacer: () => undefined }]);
    const dicho: string[] = [];
    let hechos = 0;
    const ej: EjecutorGuion<K> = { decir: (x) => dicho.push(x), hacer: () => hechos++ };
    g.avanzar(1.1, ej);
    expect(g.pendientes()).toBe(2);
    g.saltar();
    expect(g.pendientes()).toBe(0);
    g.avanzar(10, ej);
    expect(dicho).toEqual(["a"]);
    expect(hechos).toBe(0);
  });
});

describe("guion: determinismo", () => {
  it("el mismo guion cuenta lo mismo cuadro por cuadro", () => {
    const lineas: LineaGuion<K>[] = Array.from({ length: 12 }, (_, i) => ({ t: 0.5 + i * 0.37, texto: `frase ${i}`, prioridad: i % 4 === 0 ? 2 : 1 }));
    expect(correr(lineas, 8)).toEqual(correr(lineas, 8));
  });
});

describe("validarGuion", () => {
  it("encuentra los tiempos inválidos, los textos vacíos y las líneas mudas", () => {
    const r = validarGuion<K>([{ t: -1, texto: "a" }, { t: 2, texto: "  " }, { t: 3 }, { t: 99, texto: "b" }], 10);
    expect(r.problemas.length).toBe(4);
  });

  it("mide el hueco más largo entre frases, con el arranque y el cierre", () => {
    const r = validarGuion<K>([{ t: 2, texto: "a" }, { t: 5, texto: "b" }], 12);
    expect(r.huecoMax).toBe(7);
    expect(r.frases).toBe(2);
    expect(r.problemas).toEqual([]);
  });

  it("cuenta las frases pegadas", () => {
    expect(validarGuion<K>([{ t: 1, texto: "a" }, { t: 1.1, texto: "b" }, { t: 3, texto: "c" }], 4).juntas).toBe(1);
  });
});
