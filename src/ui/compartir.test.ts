import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import type { SorteoDelEvento } from "../protocol/evento";
import { PROOF_VERSION, type Proof } from "../protocol/proof";
import { mensajeDeEvento, mensajeDeSorteo, paqueteDeEvento, partesDelEvento } from "./compartir";

const enlace = "https://tinkazo.app/verificar.html#rEJEMPLO";
const BASE = "https://tinkazo.app";
const lista = (lang: "es" | "en", nombres: string[]): string =>
  new Intl.ListFormat(lang === "es" ? "es" : "en", { type: "conjunction" }).format(nombres);

describe("mensaje del sorteo: el mismo que el de la pantalla del sorteo", () => {
  const casos = [
    { ganadores: ["Ana"], premio: "Pizza" },
    { ganadores: ["Ana"], premio: "" },
    { ganadores: ["Ana", "Beto"], premio: "Pizza" },
    { ganadores: ["Ana", "Beto", "Carla"], premio: "" },
  ];
  for (const lang of ["es", "en"] as const) {
    for (const c of casos) {
      it(`${lang}: ${c.ganadores.length} ganador(es), premio "${c.premio}", palabra por palabra igual a T.${lang}.summary`, () => {
        const varios = c.ganadores.length > 1;
        const esperado = T[lang].summary(lista(lang, c.ganadores), 12, c.premio, enlace, varios);
        expect(mensajeDeSorteo(lang, { ganadores: c.ganadores, total: 12, premio: c.premio, enlace })).toBe(esperado);
      });
    }
  }
});

describe("mensaje del evento: el mismo que el de Mis sorteos", () => {
  it("es: con el nombre por defecto y uno o varios sorteos, igual a summaryEvento", () => {
    for (const n of [1, 3]) {
      expect(mensajeDeEvento("es", { titulo: "Sorteos del 20 de octubre de 2026", sorteos: n, enlaces: enlace })).toBe(
        T.es.summaryEvento("20 de octubre de 2026", n, enlace),
      );
    }
  });

  it("en: igual a summaryEvento", () => {
    for (const n of [1, 3]) {
      expect(mensajeDeEvento("en", { titulo: "Draws from October 20, 2026", sorteos: n, enlaces: enlace })).toBe(
        T.en.summaryEvento("October 20, 2026", n, enlace),
      );
    }
  });

  it("con nombre propio, el nombre va en el lugar de la fecha", () => {
    const m = mensajeDeEvento("es", { titulo: "Meetup Cochabamba", sorteos: 2, enlaces: enlace });
    expect(m.startsWith("Meetup Cochabamba (2 sorteos), todos verificables.\n")).toBe(true);
    expect(m).toContain(`Si querés verificarlos, entrá acá:\n${enlace}`);
  });
});

/** Un comprobante de tamaño real: nombres distintos, para que el enlace pese. */
function sorteoGrande(i: number, personas: number): SorteoDelEvento {
  const names = Array.from({ length: personas }, (_, k) => `Persona ${(k * 2654435761 + i * 40503) % 4294967296} de ${i}`);
  const comprobante: Proof = { v: PROOF_VERSION, names, round: 32_000_000 + i, prize: `Premio ${i}`, signature: "ab".repeat(48) };
  return { ...comprobante, ganadores: [names[0] as string] };
}

describe("evento con varias partes: títulos, enlaces y mensaje", () => {
  const sorteos = [sorteoGrande(1, 200), sorteoGrande(2, 200), sorteoGrande(3, 200), sorteoGrande(4, 200), sorteoGrande(5, 200)];

  it("es: cada parte dice cuál es, y el mensaje trae todos los enlaces, uno por parte", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "es", BASE);
    expect(r).not.toBeNull();
    const partes = r?.partes ?? [];
    expect(partes.length).toBeGreaterThan(1);
    partes.forEach((p, i) => {
      expect(p.titulo).toBe(`Meetup · Parte ${i + 1} de ${partes.length}`);
      expect(p.enlace.startsWith(`${BASE}/evento.html#`)).toBe(true);
      expect(r?.mensaje).toContain(`Parte ${i + 1} de ${partes.length}: ${p.enlace}`);
    });
    expect(r?.mensaje.startsWith(`Meetup (${sorteos.length} sorteos), todos verificables.\n`)).toBe(true);
  });

  it("en: el título de cada parte dice Part x of y", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "en", BASE);
    const n = r?.partes.length ?? 0;
    expect(n).toBeGreaterThan(1);
    expect(r?.partes[0]?.titulo).toBe(`Meetup · Part 1 of ${n}`);
    expect(r?.mensaje).toContain(`Part ${n} of ${n}: `);
  });

  it("el conteo de partes del botón coincide con el del paquete", async () => {
    const r = await paqueteDeEvento("Meetup", sorteos, "es", BASE);
    expect(await partesDelEvento("Meetup", sorteos)).toBe(r?.partes.length);
  });

  it("un evento chico es un solo enlace, con el nombre tal cual y sin 'Parte'", async () => {
    const r = await paqueteDeEvento("Meetup", [sorteoGrande(1, 3)], "es", BASE);
    expect(r?.partes).toHaveLength(1);
    expect(r?.partes[0]?.titulo).toBe("Meetup");
    expect(r?.mensaje).not.toContain("Parte");
    expect(r?.mensaje).toContain(r?.partes[0]?.enlace ?? "");
  });

  it("sin sorteos no hay paquete", async () => {
    expect(await paqueteDeEvento("Meetup", [], "es", BASE)).toBeNull();
    expect(await partesDelEvento("Meetup", [])).toBe(0);
  });
});

describe("textos nuevos de compartir y de eventos", () => {
  const codigo = readFileSync("src/ui/compartir.ts", "utf8");
  const usadas = [...codigo.matchAll(/cad\(\s*\w+,\s*"(\w+)"\s*\)/g)].map((m) => m[1] as string);
  const marcas = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

  it("cada clave que pide compartir.ts existe en español y en inglés", () => {
    expect(usadas.length).toBeGreaterThan(15);
    const faltan = usadas.filter((k) => typeof T.es[k] !== "string" || typeof T.en[k] !== "string");
    expect(faltan).toEqual([]);
  });

  it("los textos de compartir y de Mis eventos tienen las mismas marcas en los dos idiomas", () => {
    const claves = Object.keys(T.es).filter((k) => /^(cmp|evn)/.test(k) || k === "vCompartir");
    expect(claves.length).toBeGreaterThan(30);
    const distintas = claves.filter((k) => JSON.stringify(marcas(String(T.es[k]))) !== JSON.stringify(marcas(String(T.en[k]))));
    expect(distintas).toEqual([]);
  });

  it("ningún texto nuevo para la sala dice rifa, boleto, lotería ni hash", () => {
    const claves = Object.keys(T.es).filter((k) => /^(cmp|evn)/.test(k));
    const prohibidas = /rifa|boleto|lotería|loteria|casino|hash|firma|drand/i;
    for (const k of claves) {
      expect(String(T.es[k])).not.toMatch(prohibidas);
      expect(String(T.en[k])).not.toMatch(prohibidas);
    }
  });
});
