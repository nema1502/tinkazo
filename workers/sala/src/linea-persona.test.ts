import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { crearTablasDeCampana, huellaDePersona, salDeCampana } from "./campana";
import { esLineaDePersona, lineaDePersona } from "./linea-persona";
import type { Ejecutar, ValorSql } from "./registro";

/**
 * La línea de persona: lo que se sella en lugar de una cuenta en una campaña de personas. Los vectores viven en
 * `docs/vectors-persona.json` y se calcularon aparte, con otra implementación del HMAC y del base32.
 */

interface Vectores {
  casos: { sal: string; usuario: string; linea: string }[];
  campana: { sal: string; usuarios: string[]; lineas: string[]; ordenadas: string[] };
  formas: { validas: string[]; invalidas: string[] };
}

const vectores = JSON.parse(readFileSync(new URL("../../../docs/vectors-persona.json", import.meta.url), "utf8")) as Vectores;

describe("la línea de persona", () => {
  it("da la línea de cada caso de los vectores", async () => {
    expect(vectores.casos.length).toBeGreaterThanOrEqual(6);
    for (const c of vectores.casos) expect(await lineaDePersona(c.sal, c.usuario)).toBe(c.linea);
  });

  it("tiene el prefijo, 26 caracteres de base32 en minúsculas y 29 en total", async () => {
    for (const c of vectores.casos) {
      expect(c.linea).toMatch(/^p1:[a-z2-7]{26}$/);
      expect(c.linea).toHaveLength(29);
    }
  });

  it("la misma persona en otra campaña tiene otra línea, y otra persona en la misma campaña también", async () => {
    const [a, b, c, d] = vectores.casos;
    expect(a!.usuario).toBe(c!.usuario);
    expect(a!.linea).not.toBe(c!.linea);
    expect(a!.sal).toBe(b!.sal);
    expect(a!.linea).not.toBe(b!.linea);
    expect(c!.sal).toBe(d!.sal);
    expect(c!.linea).not.toBe(d!.linea);
  });

  it("tres personas de una campaña: el orden de texto es el que se sella y no se repite ninguna", async () => {
    const { sal, usuarios, lineas, ordenadas } = vectores.campana;
    const calculadas = await Promise.all(usuarios.map((u) => lineaDePersona(sal, u)));
    expect(calculadas).toEqual(lineas);
    expect(new Set(calculadas).size).toBe(3);
    expect([...calculadas].sort()).toEqual(ordenadas);
  });

  it("ni el usuario ni el identificador de Google se leen en la línea", async () => {
    for (const c of vectores.casos) {
      expect(c.linea).not.toContain("google");
      expect(c.linea).not.toContain(c.usuario.replace("google:", ""));
    }
  });

  it("usa la misma clave que la huella de persona de la sala: son los primeros 16 bytes de su HMAC", async () => {
    const db = new DatabaseSync(":memory:");
    const sql: Ejecutar = <T,>(consulta: string, ...p: ValorSql[]): T[] => db.prepare(consulta).all(...p) as unknown as T[];
    crearTablasDeCampana(sql);
    const sal = salDeCampana(sql);
    const huella = await huellaDePersona(sql, "google:100000000000000000009");
    const linea = await lineaDePersona(sal, "google:100000000000000000009");
    const esperados = Buffer.from(huella.slice(0, 32), "hex");
    expect(esperados).toHaveLength(16);
    const decodificada = decodificarBase32(linea.slice(3));
    expect(Buffer.from(decodificada).equals(esperados)).toBe(true);
  });

  it("rechaza una sal que no es hexadecimal y un usuario vacío, sin devolver una línea", async () => {
    await expect(lineaDePersona("", "google:1")).rejects.toThrow();
    await expect(lineaDePersona("xyz", "google:1")).rejects.toThrow();
    await expect(lineaDePersona("abc", "google:1")).rejects.toThrow();
    await expect(lineaDePersona("00112233", "")).rejects.toThrow();
  });
});

describe("esLineaDePersona", () => {
  it("acepta las formas válidas de los vectores", () => {
    for (const f of vectores.formas.validas) expect(esLineaDePersona(f), f).toBe(true);
  });

  it("rechaza las formas inválidas de los vectores", () => {
    for (const f of vectores.formas.invalidas) expect(esLineaDePersona(f), JSON.stringify(f)).toBe(false);
  });

  it("rechaza lo que no es texto", () => {
    for (const v of [null, undefined, 7, {}, [], true]) expect(esLineaDePersona(v)).toBe(false);
  });

  it("acepta cada línea de los vectores", () => {
    for (const c of vectores.casos) expect(esLineaDePersona(c.linea)).toBe(true);
  });
});

/** Un base32 minúsculo sin relleno, escrito a mano en la prueba para no depender de la función que se prueba. */
function decodificarBase32(texto: string): Uint8Array {
  const alfabeto = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let acumulado = 0;
  const salida: number[] = [];
  for (const c of texto) {
    acumulado = (acumulado << 5) | alfabeto.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      salida.push((acumulado >> bits) & 0xff);
    }
  }
  return Uint8Array.from(salida);
}
