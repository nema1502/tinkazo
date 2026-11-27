import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { crearTablasDeCampana, huellaDePersona, salDeCampana } from "./campana";
import { codigosDeEntrega, esLineaDePersona, lineaDePersona } from "./linea-persona";
import type { Ejecutar, ValorSql } from "./registro";

/**
 * La línea de persona: lo que se sella en lugar de una cuenta en una campaña de personas. Los vectores viven en
 * `docs/vectors-persona.json` y se calcularon aparte, con otra implementación del HMAC y del base32.
 */

interface Vectores {
  casos: { sal: string; usuario: string; linea: string }[];
  campana: { sal: string; usuarios: string[]; lineas: string[]; ordenadas: string[] };
  formas: { validas: string[]; invalidas: string[] };
  entrega: { casos: { nombre: string; sal: string; ganadoras: string[]; codigos: string[]; vueltas: number[] }[] };
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

describe("el código de entrega", () => {
  it("da el código de cada caso de los vectores", async () => {
    expect(vectores.entrega.casos.length).toBeGreaterThanOrEqual(5);
    for (const c of vectores.entrega.casos) expect(await codigosDeEntrega(c.sal, c.ganadoras), c.nombre).toEqual(c.codigos);
  });

  it("son siempre cuatro cifras, con ceros a la izquierda cuando hacen falta", async () => {
    let conCeros = 0;
    for (const c of vectores.entrega.casos) {
      for (const codigo of await codigosDeEntrega(c.sal, c.ganadoras)) {
        expect(codigo).toMatch(/^[0-9]{4}$/);
        if (codigo.startsWith("0")) conCeros++;
      }
    }
    expect(conCeros).toBeGreaterThan(0);
  });

  it("nunca se repite entre ganadoras, y el caso armado choca en la primera vuelta y lo separa la siguiente", async () => {
    for (const c of vectores.entrega.casos) expect(new Set(await codigosDeEntrega(c.sal, c.ganadoras)).size, c.nombre).toBe(c.ganadoras.length);
    const choque = vectores.entrega.casos.filter((c) => c.vueltas.some((v) => v > 0));
    expect(choque.length).toBeGreaterThanOrEqual(2);
    for (const c of choque) {
      // Sin la separación, el código de la vuelta cero de la que pasó de vuelta es el de otra ganadora.
      const solas = await Promise.all(c.ganadoras.map(async (l) => (await codigosDeEntrega(c.sal, [l]))[0]));
      expect(new Set(solas).size, c.nombre).toBeLessThan(c.ganadoras.length);
    }
  });

  it("depende del orden de puesto: la que llega primero se queda con su código de la vuelta cero", async () => {
    const delante = vectores.entrega.casos[3]!;
    const atras = vectores.entrega.casos[4]!;
    expect(atras.sal).toBe(delante.sal);
    const [, a, b] = delante.ganadoras as [string, string, string];
    expect(atras.ganadoras.slice(1)).toEqual([b, a]);
    // Las dos se llevan el mismo código en la vuelta cero: gana quien tiene el puesto de adelante.
    expect(delante.codigos[1]).toBe(atras.codigos[1]);
    expect(delante.codigos[2]).not.toBe(atras.codigos[2]);
    expect(await codigosDeEntrega(delante.sal, [a, b])).toEqual(delante.codigos.slice(1));
    expect(await codigosDeEntrega(delante.sal, [b, a])).toEqual(atras.codigos.slice(1));
  });

  it("no guarda nada ni depende de nada más: el mismo pedido da lo mismo, y la sal cambia los códigos", async () => {
    const c = vectores.entrega.casos[0]!;
    expect(await codigosDeEntrega(c.sal, c.ganadoras)).toEqual(await codigosDeEntrega(c.sal, c.ganadoras));
    const otra = vectores.entrega.casos[1]!.sal;
    expect(await codigosDeEntrega(otra, c.ganadoras)).not.toEqual(c.codigos);
  });

  it("sin ganadoras da una lista vacía, y una sola da su código", async () => {
    const c = vectores.entrega.casos[0]!;
    expect(await codigosDeEntrega(c.sal, [])).toEqual([]);
    expect(await codigosDeEntrega(c.sal, [c.ganadoras[0]!])).toEqual([c.codigos[0]]);
  });

  it("lanza con una línea mal formada, sin repetir la línea en el mensaje", async () => {
    const c = vectores.entrega.casos[0]!;
    for (const mala of vectores.formas.invalidas) {
      const error = await codigosDeEntrega(c.sal, [c.ganadoras[0]!, mala]).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, JSON.stringify(mala)).toBeInstanceOf(RangeError);
      if (mala.length > 3) expect((error as Error).message).not.toContain(mala);
    }
    await expect(codigosDeEntrega(c.sal, [7 as unknown as string])).rejects.toBeInstanceOf(RangeError);
  });

  it("lanza con una sal que no es hexadecimal", async () => {
    const c = vectores.entrega.casos[0]!;
    for (const sal of ["", "xyz", "abc"]) await expect(codigosDeEntrega(sal, c.ganadoras)).rejects.toBeInstanceOf(RangeError);
  });

  it("lanza si hay más ganadoras que códigos y no se queda dando vueltas", async () => {
    const c = vectores.entrega.casos[0]!;
    const muchas = Array.from({ length: 10_001 }, () => c.ganadoras[0]!);
    await expect(codigosDeEntrega(c.sal, muchas)).rejects.toBeInstanceOf(RangeError);
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
