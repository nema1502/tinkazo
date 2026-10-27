import { describe, expect, it, vi } from "vitest";
import {
  ajustar, ajustarEnRenglones, envolver, formaQueEntra, formasDe, grafemas, inicialDe, mediana, nivelBase, nivelPorCantidad, nivelQueCabe, nivelesDe, palabras, planNombres,
  type Nivel,
} from "./nombres";

/** Los de la escena fija (`SAMPLE` en state.ts, que no se puede importar en Node: lee `location`). */
const SAMPLE = [
  "María Quispe", "Jorge Mamani", "Lucía Flores", "Carlos Choque", "Ana Vargas", "Diego Rojas",
  "Elena Condori", "Pablo Gutiérrez", "Sofía Aguilar", "Rodrigo Peña", "Valeria Torrez", "Miguel Arce",
  "Camila Suárez", "Andrés Villca", "Paola Mendoza", "Franco Ibáñez", "Daniela Cruz", "Óscar Limachi",
];

/** Los nombres de la tarea: 1, 12 y 40 caracteres, con acentos, emojis y sin espacios. */
const FIXTURES = [
  "Ñ",
  "María Quispe",
  "María Fernanda Guadalupe Quispe Mamani Zu",
  "Maximiliano_Alexander_Constantino_Rosario",
  "🌸 Ana 🌸",
  "Álvaro",
  "Alvaro",
  "élisa Mamani", // "é" con tilde combinada
  "👨🏽‍🚀 Jorge",
];

/** Una medida fija: ocho unidades por carácter visible, para no depender de ninguna fuente. */
const medir = (s: string): number => grafemas(s).length * 8;

describe("inicialDe", () => {
  it("la primera letra, en mayúscula del español", () => {
    expect(inicialDe("Ñ")).toBe("Ñ");
    expect(inicialDe("ñandú")).toBe("Ñ");
    expect(inicialDe("Álvaro")).toBe("Á");
    expect(inicialDe("maría quispe")).toBe("M");
  });
  it("se saltea emojis, comillas y signos", () => {
    expect(inicialDe("🌸 Ana 🌸")).toBe("A");
    expect(inicialDe("«Pepe»")).toBe("P");
    expect(inicialDe("  \"Lucho\"")).toBe("L");
    expect(inicialDe("(3) Carlos")).toBe("3");
  });
  it("un nombre de puros emojis conserva el primero, entero", () => {
    expect(inicialDe("😀😀")).toBe("😀");
    expect(inicialDe("👨🏽‍🚀")).toBe("👨🏽‍🚀");
  });
  it("sin nada, un signo de pregunta", () => {
    expect(inicialDe("")).toBe("?");
    expect(inicialDe("   ")).toBe("?");
  });
  it("la tilde combinada es una sola letra", () => {
    expect(inicialDe("élisa")).toBe("É");
  });
});

describe("formasDe", () => {
  it("las cuatro formas de un nombre con apellido", () => {
    expect(formasDe("María Quispe")).toEqual(["M", "María", "María Q.", "María Quispe"]);
  });
  it("con varios apellidos toma la inicial del último", () => {
    expect(formasDe("María Fernanda Guadalupe Quispe Mamani Zu")).toEqual([
      "M", "María", "María Z.", "María Fernanda Guadalupe Quispe Mamani Zu",
    ]);
  });
  it("una sola palabra: la misma forma en los tres niveles de arriba", () => {
    expect(formasDe("Álvaro")).toEqual(["Á", "Álvaro", "Álvaro", "Álvaro"]);
    expect(formasDe("Maximiliano_Alexander_Constantino_Rosario")[3]).toBe("Maximiliano_Alexander_Constantino_Rosario");
  });
  it("un emoji delante se queda con el nombre de pila", () => {
    // El último "apellido" es otro emoji, sin letra: el nivel 3 no inventa una inicial.
    expect(formasDe("🌸 Ana 🌸")).toEqual(["A", "🌸 Ana", "🌸 Ana", "🌸 Ana 🌸"]);
    expect(formasDe("👨🏽‍🚀 Jorge Mamani")[1]).toBe("👨🏽‍🚀 Jorge");
  });
  it("un número al final es el ordinal de un nombre repetido, no un apellido", () => {
    expect(formasDe("Valeria Torrez 2")).toEqual(["V", "Valeria", "Valeria T.", "Valeria Torrez 2"]);
    expect(formasDe("María 2")).toEqual(["M", "María", "María", "María 2"]);
  });
  it("espacios de más y distinta normalización dan lo mismo", () => {
    expect(formasDe("  María   Quispe  ")).toEqual(formasDe("María Quispe"));
    expect(formasDe("élisa Mamani")[3]).toBe("élisa Mamani");
  });
  it("cada forma es un corte por palabras del nombre: nunca la mitad de una palabra ni de un carácter", () => {
    for (const nombre of FIXTURES) {
      const ws = palabras(nombre);
      const [ini, pila, conApellido, completo] = formasDe(nombre);
      // El nivel 4 es el nombre entero.
      expect(completo).toBe(ws.join(" "));
      // La inicial es un carácter entero del nombre (o su mayúscula).
      expect(grafemas(ini).length).toBe(1);
      // El nombre de pila son las primeras palabras, completas.
      expect(ws.join(" ").startsWith(pila)).toBe(true);
      const palabrasPila = palabras(pila);
      expect(palabrasPila).toEqual(ws.slice(0, palabrasPila.length));
      // Con apellido: las palabras de la pila y una inicial con punto, o el nombre entero.
      if (conApellido !== pila && conApellido !== completo) {
        expect(conApellido.startsWith(`${pila} `)).toBe(true);
        expect(conApellido).toMatch(/ \S\.$/u);
      }
      // Nada de "…" en ninguna forma.
      for (const f of [ini, pila, conApellido, completo]) expect(f).not.toContain("…");
    }
  });
});

describe("planNombres", () => {
  it("los nombres repetidos tienen ordinal desde el segundo, en los niveles 3 y 4", () => {
    const p = planNombres(["Juan Pérez", "Ana Ruiz", "Juan Pérez", "Juan  Pérez"]);
    expect(p.ordinal).toEqual([1, 1, 2, 3]);
    expect(p.formas[0]).toEqual(["J", "Juan", "Juan P.", "Juan Pérez"]);
    expect(p.formas[2]).toEqual(["J", "Juan", "Juan P. (2)", "Juan Pérez (2)"]);
    expect(p.formas[3]?.[3]).toBe("Juan Pérez (3)");
    expect(p.formas[1]?.[3]).toBe("Ana Ruiz");
  });
  it("la lista de la escena fija de 30 sale sin repetir nombres enteros", () => {
    const lista = Array.from({ length: 30 }, (_, i) => `${SAMPLE[i % SAMPLE.length]}${i >= SAMPLE.length ? ` ${Math.floor(i / SAMPLE.length) + 1}` : ""}`);
    const p = planNombres(lista);
    expect(new Set(p.formas.map((f) => f[3])).size).toBe(30);
  });
});

describe("nivelPorCantidad y nivelBase", () => {
  it("sube cuando queda menos gente y nunca baja", () => {
    const niveles = Array.from({ length: 40 }, (_, i) => nivelPorCantidad(40 - i));
    for (let i = 1; i < niveles.length; i++) expect(niveles[i]).toBeGreaterThanOrEqual(niveles[i - 1] as number);
    expect(nivelPorCantidad(30)).toBe(1);
    expect(nivelPorCantidad(20)).toBe(2);
    expect(nivelPorCantidad(13)).toBe(2);
    expect(nivelPorCantidad(12)).toBe(3);
    expect(nivelPorCantidad(9)).toBe(3);
    expect(nivelPorCantidad(8)).toBe(4);
    expect(nivelPorCantidad(1)).toBe(4);
  });
  it("el lugar manda: un celular no llega al nombre entero con los mismos que un proyector", () => {
    const anchos: Record<Nivel, number> = { 1: 20, 2: 60, 3: 90, 4: 130 };
    const ancho = (n: Nivel): number => anchos[n];
    expect(nivelQueCabe(500, ancho)).toBe(4);
    expect(nivelQueCabe(100, ancho)).toBe(3);
    expect(nivelQueCabe(70, ancho)).toBe(2);
    expect(nivelQueCabe(10, ancho)).toBe(1);
    expect(nivelBase(6, 500, ancho)).toBe(4);
    expect(nivelBase(6, 70, ancho)).toBe(2);
    expect(nivelBase(30, 500, ancho)).toBe(1);
  });
  it("la mediana no la mueve un nombre larguísimo", () => {
    expect(mediana([60, 62, 64, 66, 400])).toBe(64);
    expect(mediana([])).toBe(0);
  });
});

describe("nivelesDe: los que siguen suben juntos; los que se confunden, un poco más", () => {
  const lista = ["María Quispe", "María Mendoza", "Jorge Mamani", "Lucía Flores", "Ana Vargas", "María Quispe", "Óscar Limachi"];
  const plan = planNombres(lista);
  const todos = lista.map((_, i) => i);
  it("sin choques todos quedan en el nivel base", () => {
    const sin = [2, 3, 4, 6];
    expect(nivelesDe(plan, sin, 2)).toEqual([2, 2, 2, 2]);
    expect(nivelesDe(plan, sin, 4)).toEqual([4, 4, 4, 4]);
  });
  it("el nivel 1 no separa a nadie: la inicial se repite y el emblema los distingue", () => {
    expect(nivelesDe(plan, todos, 1)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });
  it("tres María en el nivel 2 suben hasta distinguirse", () => {
    const n = nivelesDe(plan, todos, 2);
    // "María" x3 sube a "María Q.", "María M." y "María Q. (2)": con el ordinal ya se distinguen.
    expect(n[0]).toBe(3);
    expect(n[5]).toBe(3);
    expect(n[1]).toBe(3);
    expect(n[2]).toBe(2);
    expect(n[3]).toBe(2);
    expect(n[4]).toBe(2);
    expect(n[6]).toBe(2);
    // El texto que queda en pantalla es único entre los que están a la vez.
    const textos = todos.map((p, k) => (plan.formas[p] as readonly string[])[(n[k] as number) - 1]);
    const iguales = textos.filter((x, i) => textos.indexOf(x) !== i);
    expect(iguales).toEqual([]);
  });
  it("es una función de quiénes siguen y del nivel: el orden de la lista y el ganador no cambian nada", () => {
    const a = nivelesDe(plan, [0, 1, 2, 3], 2);
    const b = nivelesDe(plan, [3, 2, 1, 0], 2);
    expect(a).toEqual([b[3], b[2], b[1], b[0]]);
  });
});

describe("ajustar: el nombre entra entero o se achica, nunca se corta", () => {
  const caja = (ancho: number) => (nombre: string) => ajustar(nombre, ancho, medir);
  for (const ancho of [320, 390, 1280]) {
    it(`con ${ancho} unidades de ancho, todos los de la prueba entran en una o dos líneas, sin puntos suspensivos`, () => {
      for (const nombre of FIXTURES) {
        const a = caja(ancho)(nombre);
        expect(a.lineas.length).toBeGreaterThanOrEqual(1);
        expect(a.lineas.length).toBeLessThanOrEqual(2);
        for (const l of a.lineas) {
          expect(l).not.toContain("…");
          expect(medir(l) * a.escala).toBeLessThanOrEqual(ancho + 1e-6);
        }
        // Si hubo corte, juntando las líneas sale el nombre entero (el corte se come un espacio como mucho).
        expect(a.lineas.join(" ").replace(/\s+/gu, "")).toBe(palabras(nombre).join("").replace(/\s+/gu, ""));
        expect(a.escala).toBeGreaterThan(0.3);
      }
    });
  }
  it("una línea cuando entra", () => {
    expect(ajustar("María Quispe", 200, medir)).toEqual({ lineas: ["María Quispe"], escala: 1, partida: false });
  });
  it("achica un poco antes de partir", () => {
    // 12 caracteres = 96; en 100 entra, en 90 se achica a 0,93 (apenas se nota).
    const a = ajustar("María Quispe", 90, medir);
    expect(a.lineas).toEqual(["María Quispe"]);
    expect(a.escala).toBeCloseTo(0.9375, 3);
  });
  it("parte en el espacio, repartido, cuando achicar sería mucho", () => {
    const a = ajustar("María Fernanda Guadalupe Quispe Mamani Zu", 200, medir);
    expect(a.lineas.length).toBe(2);
    expect(a.partida).toBe(false);
    for (const l of a.lineas) expect(l.startsWith(" ") || l.endsWith(" ")).toBe(false);
    // Las dos mitades miden parecido.
    expect(Math.abs(medir(a.lineas[0] as string) - medir(a.lineas[1] as string))).toBeLessThan(80);
  });
  it("sin espacios, parte después de un guion bajo", () => {
    const a = ajustar("Maximiliano_Alexander_Constantino_Rosario", 200, medir);
    expect(a.lineas.length).toBe(2);
    expect(a.lineas[0]).toMatch(/_$/u);
    expect(a.partida).toBe(false);
  });
  it("una palabra sola que no entra por ningún lado: se achica, y recién muy al final se parte por caracteres enteros", () => {
    const larga = "Supercalifragilisticoespialidosoincreiblementelargo";
    const a = ajustar(larga, 120, medir);
    expect(a.lineas.join("")).toBe(larga);
    for (const l of a.lineas) expect(grafemas(l).join("")).toBe(l);
    const b = ajustar(larga, 250, medir);
    expect(b.partida).toBe(false);
    expect(b.lineas).toEqual([larga]);
  });
  it("no parte un emoji con modificadores ni una letra con tilde combinada", () => {
    const nombre = "👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀👨🏽‍🚀";
    const a = ajustar(nombre, 40, medir);
    expect(a.lineas.join("")).toBe(nombre);
    for (const l of a.lineas) expect(grafemas(l).every((g) => g === "👨🏽‍🚀")).toBe(true);
  });
});

describe("envolver: un nombre larguísimo en los renglones que haga falta, a la letra que se pide", () => {
  const u = (s: string): number => grafemas(s).length * 8;

  it("un nombre que entra queda en un renglón, y uno más largo se parte en los espacios", () => {
    expect(envolver("María Quispe", 12 * 8, u)).toEqual(["María Quispe"]);
    expect(envolver("María Quispe", 11 * 8, u)).toEqual(["María", "Quispe"]);
    expect(envolver("María Fernanda Guadalupe Quispe Mamani Zu", 15 * 8, u)).toEqual(["María Fernanda", "Guadalupe", "Quispe Mamani", "Zu"]);
  });

  it("parte después de un guion bajo o un guion, y solo si hace falta", () => {
    expect(envolver("Maximiliano_Alexander_Constantino_Rosario", 26 * 8, u)).toEqual(["Maximiliano_Alexander_", "Constantino_Rosario"]);
    expect(envolver("Pérez-Gil Soto", 9 * 8, u)).toEqual(["Pérez-Gil", "Soto"]);
    expect(envolver("Pérez-Gil Soto", 6 * 8, u)).toEqual(["Pérez-", "Gil", "Soto"]);
  });

  it("una palabra más ancha que la caja se parte por letras enteras, sin puntos suspensivos", () => {
    const l = envolver("Anticonstitucionalmente", 8 * 8, u);
    expect(l.join("")).toBe("Anticonstitucionalmente");
    for (const x of l) {
      expect(u(x)).toBeLessThanOrEqual(8 * 8);
      expect(x.endsWith("…")).toBe(false);
    }
    // Una letra con tilde combinada o un emoji no se parte por el medio.
    expect(envolver("🌸🌸🌸🌸", 2 * 8, u)).toEqual(["🌸🌸", "🌸🌸"]);
  });

  it("nunca pierde ni inventa letras: unir los renglones devuelve el nombre", () => {
    for (const nombre of [...SAMPLE, ...FIXTURES]) {
      for (const ancho of [3, 6, 10, 16, 40].map((n) => n * 8)) {
        const l = envolver(nombre, ancho, u);
        const quitar = (x: string): string => x.normalize("NFC").replace(/\s+/gu, "");
        expect(quitar(l.join(" "))).toBe(quitar(nombre));
        for (const x of l) expect(u(x)).toBeLessThanOrEqual(Math.max(ancho, 8));
      }
    }
  });
});

describe("ajustarEnRenglones: el nombre del cartel entero, en los renglones que haga falta y nunca bajo la regla", () => {
  const u = (s: string): number => grafemas(s).length * 8;

  it("un nombre que entra queda en un renglón a escala 1", () => {
    expect(ajustarEnRenglones("María Quispe", 200, u)).toEqual({ lineas: ["María Quispe"], escala: 1, partida: false });
  });

  it("prefiere un renglón apenas achicado (0,85) a partirlo, y partirlo a la letra normal a achicar más", () => {
    const a = ajustarEnRenglones("María Quispe", 12 * 8 * 0.9, u);
    expect(a.lineas).toEqual(["María Quispe"]);
    expect(a.escala).toBe(0.85);
    const b = ajustarEnRenglones("María Quispe", 12 * 8 * 0.7, u);
    expect(b).toEqual({ lineas: ["María", "Quispe"], escala: 1, partida: false });
  });

  it("un nombre larguísimo lo escribe entero en varios renglones, y la escala nunca baja del piso", () => {
    const nombre = "María Fernanda Guadalupe Quispe Mamani Zuleta";
    for (const piso of [0.45, 0.6, 0.8]) {
      for (const ancho of [6, 9, 12, 20].map((n) => n * 8)) {
        const a = ajustarEnRenglones(nombre, ancho, u, piso);
        expect(a.escala).toBeGreaterThanOrEqual(piso);
        expect(a.escala).toBeLessThanOrEqual(1);
        const quitar = (x: string): string => x.replace(/\s+/gu, "");
        expect(quitar(a.lineas.join(" "))).toBe(quitar(nombre));
        // Lo que se dibuja, a esa escala, entra en la caja.
        for (const l of a.lineas) expect(u(l) * a.escala).toBeLessThanOrEqual(Math.max(ancho, 8 * a.escala) + 1e-9);
        expect(a.lineas.some((l) => l.endsWith("…"))).toBe(false);
      }
    }
  });

  it("con un tope de renglones, si ni a la escala del piso entra, lo dice (partida) para que se use otra forma del nombre", () => {
    const entra = ajustarEnRenglones("Elena Condori", 9 * 8, u, 0.8, 2);
    expect(entra.partida).toBe(false);
    expect(entra.lineas).toEqual(["Elena", "Condori"]);
    const largo = ajustarEnRenglones("María Fernanda Guadalupe Quispe Mamani Zuleta", 14 * 8, u, 0.8, 2);
    expect(largo.partida).toBe(true);
    expect(largo.lineas.length).toBeGreaterThan(2);
    expect(largo.escala).toBe(0.8);
    // Sin tope no hace falta partirlo: a la escala del piso entra en tres renglones.
    const libre = ajustarEnRenglones("María Fernanda Guadalupe Quispe Mamani Zuleta", 14 * 8, u, 0.8);
    expect(libre.partida).toBe(false);
    expect(libre.lineas).toEqual(["María Fernanda", "Guadalupe Quispe", "Mamani Zuleta"]);
  });

  it("con espacio para unas pocas letras por renglón lo escribe en cuatro renglones a lo sumo mientras el piso lo permita", () => {
    const a = ajustarEnRenglones("María Fernanda Guadalupe Quispe", 12 * 8, u, 0.6);
    expect(a.lineas.length).toBeLessThanOrEqual(4);
    expect(a.escala).toBeGreaterThanOrEqual(0.6);
  });
});

describe("formaQueEntra: la letra no se achica, se muestra menos del nombre", () => {
  it("el nombre entero si entra, y si no el más largo que sí entra, siempre por palabras", () => {
    const u = (s: string): number => grafemas(s).length * 8;
    expect(formaQueEntra("María Quispe", 12 * 8, u)).toBe("María Quispe");
    expect(formaQueEntra("María Quispe", 11 * 8, u)).toBe("María Q.");
    expect(formaQueEntra("María Quispe", 7 * 8, u)).toBe("María");
    expect(formaQueEntra("María Quispe", 3 * 8, u)).toBe("M");
    // Un solo nombre de pila largo: la inicial, nunca la mitad del nombre ni "…".
    expect(formaQueEntra("Maximiliano", 5 * 8, u)).toBe("M");
    expect(formaQueEntra("Maximiliano", 11 * 8, u)).toBe("Maximiliano");
  });
  it("nunca devuelve un texto más ancho que la caja salvo la inicial, y nunca termina en puntos suspensivos", () => {
    const u = (s: string): number => grafemas(s).length * 8;
    for (const nombre of [...SAMPLE, ...FIXTURES]) {
      for (const ancho of [8, 24, 48, 64, 96, 200]) {
        const f = formaQueEntra(nombre, ancho, u);
        expect(f.endsWith("…")).toBe(false);
        if (f !== inicialDe(nombre)) expect(u(f)).toBeLessThanOrEqual(ancho);
      }
    }
  });
  it("es una de las formas del nombre", () => {
    for (const nombre of SAMPLE) expect(formasDe(nombre)).toContain(formaQueEntra(nombre, 80, medir));
  });
});

describe("determinismo", () => {
  it("no usa Math.random en ninguna parte", () => {
    const espia = vi.spyOn(Math, "random");
    const lista = [...FIXTURES, ...SAMPLE];
    const plan = planNombres(lista);
    nivelesDe(plan, lista.map((_, i) => i), 2);
    for (const nombre of lista) ajustar(nombre, 150, medir);
    expect(espia).not.toHaveBeenCalled();
    espia.mockRestore();
  });
  it("la misma lista da lo mismo", () => {
    expect(planNombres(FIXTURES)).toEqual(planNombres([...FIXTURES]));
  });
});
