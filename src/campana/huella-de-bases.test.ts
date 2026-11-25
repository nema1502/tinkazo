/**
 * La huella de las bases de una campaña, con un vector fijo.
 * El canon es el del depósito: JSON canónico con claves ordenadas, sin espacios, UTF-8,
 * y encima SHA-256 en hexadecimal. Un vector fijo conocido, escrito a mano una vez, ata
 * el canon: si alguien cambia el orden de las claves o mete espacios, estas pruebas
 * se rompen antes de que dos implementaciones dejen de dar la misma cifra.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { huellaDeBases } from "./huella-de-bases";

describe("huellaDeBases", () => {
  it("da el vector fijo: claves ordenadas, sin espacios y UTF-8 con acentos", () => {
    const bases = { b: 2, a: "hola «ñ»", anidado: { z: [1, true, null], a: "x" } };
    // Texto canónico: {"a":"hola «ñ»","anidado":{"a":"x","z":[1,true,null]},"b":2}
    expect(huellaDeBases(bases)).toBe("58dfee808d4934554b4e09108b035b57b305330277e706425c5f015f09803f99");
  });

  it("el objeto vacío da su vector fijo", () => {
    expect(huellaDeBases({})).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
  });

  it("el orden de las claves no cambia la huella", () => {
    expect(huellaDeBases({ a: 1, b: 2 })).toBe(huellaDeBases({ b: 2, a: 1 }));
    expect(huellaDeBases({ anidado: { x: 1, y: 2 }, a: 3 })).toBe(huellaDeBases({ a: 3, anidado: { y: 2, x: 1 } }));
  });

  it("los espacios del texto de entrada no cambian la huella", () => {
    const conEspacios = JSON.stringify({ a: 1, b: [1, 2], c: { d: "x" } }, null, 2);
    expect(huellaDeBases(JSON.parse(conEspacios))).toBe(huellaDeBases({ a: 1, b: [1, 2], c: { d: "x" } }));
  });

  it("el orden del arreglo sí cambia la huella", () => {
    expect(huellaDeBases([1, 2])).not.toBe(huellaDeBases([2, 1]));
  });

  it("las claves con valor undefined no entran en la huella", () => {
    expect(huellaDeBases({ a: 1, b: undefined })).toBe(huellaDeBases({ a: 1 }));
  });

  it("lo que no es JSON lanza, y la huella es de 64 hexadecimales", () => {
    expect(huellaDeBases({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
    expect(() => huellaDeBases(undefined)).toThrow();
    expect(() => huellaDeBases({ a: () => 1 })).toThrow();
    expect(() => huellaDeBases({ a: 1n })).toThrow();
  });

  it("los números que JSON escribe como null (NaN e infinitos) lanzan: no dan la huella de un null", () => {
    expect(() => huellaDeBases({ a: NaN })).toThrow();
    expect(() => huellaDeBases({ a: Infinity })).toThrow();
    expect(() => huellaDeBases([-Infinity])).toThrow();
    expect(huellaDeBases({ a: 0 })).not.toBe(huellaDeBases({ a: null }));
  });

  it("lo que se escribiría vacío sin avisar lanza: fechas, mapas, conjuntos, direcciones e instancias de clase", () => {
    class Bases {
      a = 1;
    }
    for (const raro of [new Date(0), new Map([["a", 1]]), new Set([1]), new URL("https://example.org"), new Bases(), /x/u, new Uint8Array(2)]) {
      expect(() => huellaDeBases({ a: raro }), String(raro)).toThrow();
      expect(() => huellaDeBases([raro]), String(raro)).toThrow();
    }
    expect(() => huellaDeBases(new Date(0))).toThrow();
    // Un registro sin prototipo sí es un registro simple, y da lo mismo que uno de siempre.
    const sinPrototipo = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(huellaDeBases(sinPrototipo)).toBe(huellaDeBases({ a: 1 }));
  });

  it("un valor que se contiene a sí mismo lanza un error claro y no desborda la pila", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.yo = circular;
    expect(() => huellaDeBases(circular)).toThrow(/se contiene a sí mismo/u);
    const lista: unknown[] = [1];
    lista.push(lista);
    expect(() => huellaDeBases(lista)).toThrow(/se contiene a sí mismo/u);
    // El mismo objeto dos veces, sin ser su propio ancestro, no es un ciclo.
    const compartido = { x: 1 };
    expect(huellaDeBases({ a: compartido, b: compartido })).toBe(huellaDeBases({ a: { x: 1 }, b: { x: 1 } }));
  });

  it("las claves se ordenan por unidades UTF-16 (RFC 8785): un emoji va antes que una letra de ancho completo", () => {
    // U+FF5E es una sola unidad (0xFF5E) y el emoji son dos (0xD83D 0xDE00): por unidades va primero el emoji,
    // y por bytes UTF-8 o puntos de código iría al revés. Se fija el orden elegido con el texto canónico escrito a mano.
    const texto = '{"\u{1F600}":1,"\u{FF5E}":2}';
    expect(huellaDeBases({ "\u{FF5E}": 2, "\u{1F600}": 1 })).toBe(bytesToHex(sha256(new TextEncoder().encode(texto))));
  });
});
