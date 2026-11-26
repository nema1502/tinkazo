import { describe, expect, it } from "vitest";
import { leerTextoDeCampana } from "../../workers/sala/src/campana";
import { leerCampana } from "./modelo";

/**
 * El premio en mano en la lectura del sitio: qué se entrega, escrito en español y en inglés, en lugar de un monto. Solo va con
 * identidad persona y con todos los premios en "0". La sala lee el mismo campo y las dos lecturas tienen que aceptar y rechazar
 * lo mismo, porque lo que Tinkazo firma lo leen las dos.
 */

const CIERRA = 1764356400000;

const base = (): Record<string, unknown> => ({
  v: 1,
  evento: "e7k2m9",
  red: "testnet",
  estado: "abierta",
  empresa: { nombre: "Empresa de ejemplo", logo: null, color: "verde" },
  lugar: { es: "Evento de ejemplo", en: "Sample event" },
  zona: "America/La_Paz",
  premios: ["400000000"],
  abre_ms: 1764331200000,
  cierra_ms: CIERRA,
  sorteo_ms: 1764365400000,
  recibir_hasta_ms: 1779917400000,
  entrada: "google",
  pasos: [],
  bases: { es: "Bases", en: "Rules" },
  anotadas: 37,
  contrato: null,
  promo: null,
  comprobante: null,
});

const EN_MANO = { es: "Auriculares", en: "Headphones" };
/** Una campaña de personas con premio en mano: identidad persona, el premio escrito y todos los montos en cero. */
const MANO = { identidad: "persona", premio_en_mano: EN_MANO, premios: ["0", "0", "0"] };

const delSitio = (cambios: Record<string, unknown>) => leerCampana({ ...base(), ...cambios });
/** Lo que dice la sala del mismo texto, con la hora justo antes del cierre. */
const delaSala = (cambios: Record<string, unknown>) => leerTextoDeCampana(JSON.stringify({ ...base(), ...cambios }), CIERRA - 1);

function campoDelSitio(cambios: Record<string, unknown>): string {
  const lectura = delSitio(cambios);
  if (lectura.ok) throw new Error("se esperaba un error");
  return lectura.campo;
}

describe("leerCampana con premio en mano", () => {
  it("sin el campo, la campaña es la de siempre y no lleva la clave", () => {
    const lectura = delSitio({});
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(Object.keys(lectura.campana)).not.toContain("premioEnMano");
    expect(lectura.campana.premios).toEqual([400000000n]);
  });

  it("con identidad persona y todos los premios en 0, lee el premio escrito y los montos en cero", () => {
    const lectura = delSitio(MANO);
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.campana.premioEnMano).toEqual(EN_MANO);
    expect(lectura.campana.premios).toEqual([0n, 0n, 0n]);
    expect(lectura.campana.identidad).toBe("persona");
  });

  it("el premio en mano sin identidad persona falla en premio_en_mano", () => {
    expect(campoDelSitio({ premio_en_mano: EN_MANO, premios: ["0"] })).toBe("premio_en_mano");
    expect(campoDelSitio({ ...MANO, identidad: "cuenta" })).toBe("premio_en_mano");
    expect(campoDelSitio({ ...MANO, identidad: null })).toBe("premio_en_mano");
  });

  it("el premio en mano con montos en dólares falla en premios", () => {
    expect(campoDelSitio({ ...MANO, premios: ["400000000"] })).toBe("premios");
    expect(campoDelSitio({ ...MANO, premios: ["0", "100000"] })).toBe("premios");
    expect(campoDelSitio({ ...MANO, premios: ["00"] })).toBe("premios");
  });

  it("premios en 0 sin premio en mano fallan: no habría qué mostrar", () => {
    expect(campoDelSitio({ identidad: "persona", premios: ["0"] })).toBe("premios");
    expect(campoDelSitio({ premios: ["0"] })).toBe("premios");
  });

  it("una campaña de personas con montos, sin premio en mano, se lee como hoy", () => {
    const lectura = delSitio({ identidad: "persona" });
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.campana.identidad).toBe("persona");
    expect(Object.keys(lectura.campana)).not.toContain("premioEnMano");
  });

  it("el premio escrito va de 1 a 60 caracteres en cada idioma", () => {
    expect(delSitio({ ...MANO, premio_en_mano: { es: "a", en: "b" } }).ok).toBe(true);
    expect(delSitio({ ...MANO, premio_en_mano: { es: "a".repeat(60), en: "b".repeat(60) } }).ok).toBe(true);
    for (const malo of [
      { es: "", en: "Headphones" },
      { es: "Auriculares", en: "" },
      { es: "a".repeat(61), en: "Headphones" },
      { es: "Auriculares", en: "b".repeat(61) },
    ]) {
      expect(campoDelSitio({ ...MANO, premio_en_mano: malo }), JSON.stringify(malo)).toBe("premio_en_mano");
    }
  });

  it("de 1 a 10 premios, como siempre", () => {
    expect(delSitio({ ...MANO, premios: Array(10).fill("0") }).ok).toBe(true);
    expect(campoDelSitio({ ...MANO, premios: Array(11).fill("0") })).toBe("premios");
    expect(campoDelSitio({ ...MANO, premios: [] })).toBe("premios");
  });
});

describe("el sitio y la sala leen igual el premio en mano", () => {
  const casos: [string, Record<string, unknown>][] = [
    ["premio en mano completo", MANO],
    ["un solo premio", { ...MANO, premios: ["0"] }],
    ["diez premios", { ...MANO, premios: Array(10).fill("0") }],
    ["once premios", { ...MANO, premios: Array(11).fill("0") }],
    ["un solo caracter en cada idioma", { ...MANO, premio_en_mano: { es: "a", en: "b" } }],
    ["sesenta caracteres", { ...MANO, premio_en_mano: { es: "a".repeat(60), en: "b".repeat(60) } }],
    ["sesenta y uno en español", { ...MANO, premio_en_mano: { es: "a".repeat(61), en: "b" } }],
    ["sesenta y uno en inglés", { ...MANO, premio_en_mano: { es: "a", en: "b".repeat(61) } }],
    ["español vacío", { ...MANO, premio_en_mano: { es: "", en: "b" } }],
    ["inglés vacío", { ...MANO, premio_en_mano: { es: "a", en: "" } }],
    ["solo espacios en español", { ...MANO, premio_en_mano: { es: "   ", en: "b" } }],
    ["solo espacios en inglés", { ...MANO, premio_en_mano: { es: "a", en: " " } }],
    ["un salto de línea", { ...MANO, premio_en_mano: { es: "a\nb", en: "c" } }],
    ["un carácter de control", { ...MANO, premio_en_mano: { es: "a", en: "b\u0000c" } }],
    ["un carácter que no se ve", { ...MANO, premio_en_mano: { es: "a​b", en: "c" } }],
    ["sin el idioma inglés", { ...MANO, premio_en_mano: { es: "a" } }],
    ["con un número en lugar de texto", { ...MANO, premio_en_mano: { es: 1, en: "b" } }],
    ["un texto suelto", { ...MANO, premio_en_mano: "Auriculares" }],
    ["una lista", { ...MANO, premio_en_mano: ["Auriculares", "Headphones"] }],
    ["nulo", { ...MANO, premio_en_mano: null }],
    ["sin identidad", { premio_en_mano: EN_MANO, premios: ["0"] }],
    ["identidad cuenta", { ...MANO, identidad: "cuenta" }],
    ["identidad desconocida", { ...MANO, identidad: "Persona" }],
    ["identidad nula", { ...MANO, identidad: null }],
    ["con un monto en dólares", { ...MANO, premios: ["400000000"] }],
    ["con un monto de un centavo", { ...MANO, premios: ["100000"] }],
    ["con un cero escrito 00", { ...MANO, premios: ["00"] }],
    ["con un cero y un monto", { ...MANO, premios: ["0", "400000000"] }],
    ["persona con montos y sin premio en mano", { identidad: "persona" }],
    ["la campaña de siempre", {}],
  ];

  for (const [nombre, cambios] of casos) {
    it(`${nombre}: las dos lecturas dicen lo mismo`, () => {
      const sitio = delSitio(cambios);
      const sala = delaSala(cambios);
      expect(sitio.ok, `sitio ${sitio.ok ? "acepta" : sitio.campo}, sala ${sala.ok ? "acepta" : sala.campo}`).toBe(sala.ok);
      if (!sitio.ok && !sala.ok) expect(sitio.campo).toBe(sala.campo);
    });
  }

  it("una campaña de personas con premio en mano que se acepta lleva lo mismo en las dos", () => {
    const sitio = delSitio(MANO);
    const sala = delaSala(MANO);
    expect(sitio.ok && sala.ok).toBe(true);
    if (sitio.ok && sala.ok) {
      expect(sitio.campana.identidad).toBe("persona");
      expect(sala.identidad).toBe("persona");
      expect(sitio.campana.premios.length).toBe(sala.premios);
    }
  });
});
