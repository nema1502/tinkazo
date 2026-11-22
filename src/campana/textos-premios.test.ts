import { describe, expect, it } from "vitest";
import { TEXTOS_PREMIOS } from "./textos-premios";

/** Los textos de la pantalla de quien ganó un premio de una campaña, en los dos idiomas (`textos-premios.ts`). */

const ES = TEXTOS_PREMIOS.es;
const EN = TEXTOS_PREMIOS.en;
const CLAVES = Object.keys(ES);
const huecos = (texto: string): string[] => [...texto.matchAll(/\{(\w+)\}/gu)].map((m) => m[1] ?? "").sort();

describe("los textos de la pantalla del premio", () => {
  it("las mismas claves en los dos idiomas y en el mismo orden, todas con pr", () => {
    expect(Object.keys(EN)).toEqual(CLAVES);
    expect(CLAVES.every((k) => /^pr[A-Z]/u.test(k))).toBe(true);
  });

  it("cada texto lleva los mismos huecos en los dos idiomas", () => {
    for (const k of CLAVES) expect(huecos(EN[k] ?? ""), k).toEqual(huecos(ES[k] ?? ""));
  });

  it("ninguno está vacío y ninguno lleva comillas dobles", () => {
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t?.trim().length, k).toBeGreaterThan(0);
      expect(t, k).not.toContain('"');
    }
  });

  it("sin punto y coma, comillas angulares, rayas, punto medio ni exclamaciones", () => {
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t, k).not.toMatch(/[;«»—–·!¡]/u);
    }
  });

  it("sin palabras de juegos de azar ni palabras técnicas", () => {
    const azar = /\b(rifa|rifas|loter[ií]a|boleto|boletos|ticket|tickets|apuesta|apuestas|raffle|lottery|bet|bets)\b/iu;
    const tecnicas = /\b(archivo|json|firma|campo|formato|stellar|usdc|wallet|hash|drand|bytes|claim|token|rpc)\b/iu;
    for (const k of CLAVES) for (const t of [ES[k], EN[k]]) {
      expect(t, k).not.toMatch(azar);
      expect(t, k).not.toMatch(tecnicas);
    }
  });

  it("hay un texto para cada estado del premio y para cada resultado de la línea", () => {
    for (const k of ["prGanoTitulo", "prGanoMonto", "prRecibirBtn", "prEnCaminoLinea", "prListoLinea", "prListoEnlaceTx", "prVolvioLinea", "prEstadoRecibido", "prEstadoPorRecibir", "prEstadoVolvio"]) {
      expect(typeof ES[k], k).toBe("string");
    }
    for (const k of ["activada", "enviada", "hecho", "en-curso", "no-aprobada", "ahora-no", "no-coincide", "no-coincide-tope", "no-patrocina", "sin-xlm", "otra-red", "sin-red", "no-salio", "no-corre", "apagada", "cuenta-creandose", "proteger"]) {
      expect(typeof ES[`prLinea${k.replace(/(?:^|-)([a-z])/gu, (_, c: string) => c.toUpperCase())}`], k).toBe("string");
    }
  });
});
