import { describe, expect, it } from "vitest";
import { isTurnPrize } from "../modos/turnos";
import { T } from "../i18n";
import { MAX_META, MAX_RECIENTES, agregarReciente, alternar, armarMeta, etiquetaDeLugar, esElegido, lugaresDeMeta, opciones, recortar } from "./premios";

describe("premios: los recientes", () => {
  it("el último va primero y no se repite aunque cambie la mayúscula o los espacios", () => {
    expect(agregarReciente(["Libro", "Polera"], "  stickers ")).toEqual(["stickers", "Libro", "Polera"]);
    expect(agregarReciente(["Libro", "Polera"], "polera")).toEqual(["polera", "Libro"]);
    expect(agregarReciente(["Libro"], "LIBRO   ")).toEqual(["LIBRO"]);
  });

  it("no pasa del máximo: se va el más viejo", () => {
    const lleno = ["a", "b", "c", "d"];
    expect(lleno).toHaveLength(MAX_RECIENTES);
    expect(agregarReciente(lleno, "e")).toEqual(["e", "a", "b", "c"]);
  });

  it("un premio vacío no cambia nada", () => {
    expect(agregarReciente(["Libro"], "")).toEqual(["Libro"]);
    expect(agregarReciente(["Libro"], "   ")).toEqual(["Libro"]);
  });

  it("espacios dobles por dentro se juntan, como se van a leer", () => {
    expect(agregarReciente([], "Licencia   de  JetBrains")).toEqual(["Licencia de JetBrains"]);
  });
});

describe("premios: lo que se ofrece", () => {
  it("primero los recientes y después los sugeridos", () => {
    expect(opciones(["Polera", "Libro"], ["Termo"])).toEqual([
      { texto: "Termo", reciente: true },
      { texto: "Polera", reciente: false },
      { texto: "Libro", reciente: false },
    ]);
  });

  it("si un reciente coincide con un sugerido queda una sola vez, como reciente", () => {
    expect(opciones(["Polera", "Libro"], ["libro"])).toEqual([
      { texto: "libro", reciente: true },
      { texto: "Polera", reciente: false },
    ]);
  });

  it("sin recientes son solo los sugeridos, y sin nada no hay nada", () => {
    expect(opciones(["Polera"], [])).toEqual([{ texto: "Polera", reciente: false }]);
    expect(opciones([], [])).toEqual([]);
  });

  it("ignora los vacíos", () => {
    expect(opciones(["", "  "], ["", "Libro"])).toEqual([{ texto: "Libro", reciente: true }]);
  });
});

describe("premios: elegir y desmarcar", () => {
  it("está elegido el que dice el cuadro, sin importar mayúsculas ni espacios", () => {
    expect(esElegido("Libro", "libro")).toBe(true);
    expect(esElegido("  libro  ", "Libro")).toBe(true);
    expect(esElegido("Libro de Stellar", "Libro")).toBe(false);
  });

  it("con el cuadro vacío no está elegido ninguno", () => {
    expect(esElegido("", "")).toBe(false);
    expect(esElegido("   ", "Libro")).toBe(false);
  });

  it("tocar uno lo pone; tocarlo otra vez lo saca; tocar otro lo cambia", () => {
    expect(alternar("", "Libro")).toBe("Libro");
    expect(alternar("Libro", "Libro")).toBe("");
    expect(alternar("Libro", "Polera")).toBe("Polera");
    expect(alternar("algo escrito a mano", "Libro")).toBe("Libro");
  });

  it("el cuadro admite 60 caracteres: un premio largo se corta sin partir una letra", () => {
    expect(recortar("x".repeat(80))).toHaveLength(60);
    expect(recortar("Libro")).toBe("Libro");
    // Un emoji vale una letra, no dos.
    expect(Array.from(recortar("🦙".repeat(70)))).toHaveLength(60);
  });
});

describe("premios: un premio por lugar", () => {
  it("con un solo lugar con premio queda tal cual, como el campo único de siempre", () => {
    expect(armarMeta(["Termo"], "es")).toBe("Termo");
    expect(armarMeta(["Termo"], "en")).toBe("Termo");
    // Los lugares sin texto no se nombran: con uno solo, el sello es el de siempre.
    expect(armarMeta(["", "Termo"], "es")).toBe("Termo");
    expect(armarMeta(["", "  "], "es")).toBe("");
    expect(armarMeta([], "es")).toBe("");
  });

  it("con varios lugares, cada premio con su rótulo, en el idioma en que se sella", () => {
    expect(armarMeta(["Bici", "Termo"], "es")).toBe("1.er premio: Bici, 2.º premio: Termo");
    expect(armarMeta(["Bici", "Termo", "Libro"], "es")).toBe("1.er premio: Bici, 2.º premio: Termo, 3.er premio: Libro");
    expect(armarMeta(["Bici", "Termo", "Libro"], "en")).toBe("1st prize: Bici, 2nd prize: Termo, 3rd prize: Libro");
  });

  it("un lugar que se dejó vacío no se nombra, y el que sigue conserva su número", () => {
    expect(armarMeta(["Bici", "", "Libro"], "es")).toBe("1.er premio: Bici, 3.er premio: Libro");
  });

  it("los premios con comas y con números quedan enteros", () => {
    const meta = armarMeta(["Polera (talle M), 2 unidades", "Kit con 3 stickers"], "es");
    expect(meta).toBe("1.er premio: Polera (talle M), 2 unidades, 2.º premio: Kit con 3 stickers");
    expect(lugaresDeMeta(meta)).toEqual([
      { lugar: 1, premio: "Polera (talle M), 2 unidades" },
      { lugar: 2, premio: "Kit con 3 stickers" },
    ]);
  });

  it("todo entra en los 160 caracteres que admite meta: el lugar que no cabe se queda fuera", () => {
    expect(MAX_META).toBe(160);
    const meta = armarMeta(["x".repeat(80), "x".repeat(80), "x".repeat(80)], "es");
    expect(Array.from(meta).length).toBeLessThanOrEqual(160);
    expect(meta.startsWith("1.er premio: ")).toBe(true);
    // Un premio solo que no cabe se corta, como se cortaba el del campo único.
    expect(Array.from(armarMeta(["y".repeat(200)], "es")).length).toBe(160);
  });

  it("ida y vuelta: lo armado se lee de vuelta lugar por lugar", () => {
    expect(lugaresDeMeta(armarMeta(["Bici", "Termo", "Libro"], "es"))).toEqual([
      { lugar: 1, premio: "Bici" },
      { lugar: 2, premio: "Termo" },
      { lugar: 3, premio: "Libro" },
    ]);
    // El formato lo reconocen los dos idiomas: lo sellado en uno se lee en el otro.
    expect(lugaresDeMeta(armarMeta(["Bici", "Termo"], "en"))).toEqual([
      { lugar: 1, premio: "Bici" },
      { lugar: 2, premio: "Termo" },
    ]);
    expect(lugaresDeMeta("1st prize: Bici, 2nd prize: Termo")).toEqual([
      { lugar: 1, premio: "Bici" },
      { lugar: 2, premio: "Termo" },
    ]);
    expect(lugaresDeMeta(armarMeta(["Bici", "", "Libro"], "es"))).toEqual([
      { lugar: 1, premio: "Bici" },
      { lugar: 3, premio: "Libro" },
    ]);
  });

  it("un meta que no sigue el formato se lee tal cual: los sorteos de antes no cambian", () => {
    expect(lugaresDeMeta("Termo")).toBeNull();
    expect(lugaresDeMeta("Turnos de limpieza")).toBeNull();
    expect(lugaresDeMeta("Polera (talle M), 2 unidades")).toBeNull();
    // Un premio que nombra los premios sin ser el texto del sello: no es el formato.
    expect(lugaresDeMeta("Gana el 1.er premio: una bici")).toBeNull();
    expect(lugaresDeMeta("1.er premio: Bici")).toBeNull();
    expect(lugaresDeMeta("1.er premio: Bici, 2.º premio: ")).toBeNull();
    expect(lugaresDeMeta("otro texto 1.er premio: Bici, 2.º premio: Termo")).toBeNull();
  });

  it("los rótulos de cada lugar, en los dos idiomas", () => {
    expect(etiquetaDeLugar(1, "es")).toBe("1.er premio");
    expect(etiquetaDeLugar(2, "es")).toBe("2.º premio");
    expect(etiquetaDeLugar(3, "es")).toBe("3.er premio");
    expect(etiquetaDeLugar(4, "es")).toBe("4.º premio");
    expect(etiquetaDeLugar(1, "en")).toBe("1st prize");
    expect(etiquetaDeLugar(2, "en")).toBe("2nd prize");
    expect(etiquetaDeLugar(3, "en")).toBe("3rd prize");
    expect(etiquetaDeLugar(4, "en")).toBe("4th prize");
    expect(etiquetaDeLugar(11, "en")).toBe("11th prize");
    expect(etiquetaDeLugar(12, "en")).toBe("12th prize");
    expect(etiquetaDeLugar(21, "en")).toBe("21st prize");
  });

  it("con turnos el nombre de siempre no se toca y se sigue reconociendo", () => {
    // En el modo de turnos no se ofrecen los campos por lugar: el cuadro queda solo, y el modo lo maneja otro módulo.
    expect(armarMeta(["Turnos de limpieza"], "es")).toBe("Turnos de limpieza");
    expect(isTurnPrize(armarMeta(["Turnos de limpieza"], "es"))).toBe(true);
    expect(isTurnPrize(armarMeta(["Turns"], "en"))).toBe(true);
    expect(isTurnPrize("Turnstile")).toBe(false);
  });

  it("los textos nuevos existen en los dos idiomas, con sus reglas de escritura", () => {
    for (const l of ["es", "en"] as const) {
      expect(typeof T[l].prizeLugar).toBe("function");
      expect(typeof T[l].prizeLugarPh).toBe("string");
      expect(T[l].prizeLugar(1)).toMatch(/premio|prize/);
      expect(T[l].prizeLugarPh as string).not.toMatch(/[«»;·]/);
    }
    expect(T.es.prizeLugar(2)).toBe("2.º premio");
    expect(T.en.prizeLugar(2)).toBe("2nd prize");
  });
});

describe("premios: los textos", () => {
  it("hay sugeridos en los dos idiomas, sin repetir ni pasarse del cuadro", () => {
    for (const l of ["es", "en"] as const) {
      const lista = T[l].prizeSugeridos;
      expect(Array.isArray(lista)).toBe(true);
      const v = lista as string[];
      expect(v.length).toBeGreaterThanOrEqual(6);
      expect(v.length).toBeLessThanOrEqual(10);
      expect(new Set(v.map((x) => x.toLocaleLowerCase())).size).toBe(v.length);
      expect(v.every((x) => x.length > 0 && x.length <= 60)).toBe(true);
    }
  });

  it("nada que huela a casino ni a plata: son cosas que se regalan en un evento", () => {
    // Tampoco un boleto: al lado de un sorteo, un premio que se llama así hace pensar en una rifa.
    const prohibidas = /dinero|efectivo|cash|bono|apuesta|bet|jackpot|casino|loter|ticket|boleto|rifa|raffle/i;
    for (const l of ["es", "en"] as const) {
      for (const p of T[l].prizeSugeridos as string[]) expect(p).not.toMatch(prohibidas);
    }
  });
});
