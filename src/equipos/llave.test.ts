import { describe, expect, it } from "vitest";
import { ES_LLAVE } from "../../workers/sala/src/registro";
import { anotarEquipoEnSala } from "../sala/equipos";
import { llaveDelCelular } from "./celular";

/**
 * La llave con que el celular del encargado prueba ante la sala que es el mismo que anotó la cuenta, y lo que
 * contesta la sala cuando no lo es.
 */

const memoria = (): Storage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
};

describe("la llave del celular", () => {
  it("es de 16 bytes al azar, con la forma que acepta la sala", () => {
    const l = llaveDelCelular("AbCd1234", memoria());
    expect(l).toMatch(ES_LLAVE);
    expect(Buffer.from(l, "base64url")).toHaveLength(16);
  });
  it("la misma sala, la misma llave: el celular que recarga la página puede corregir sus datos", () => {
    const al = memoria();
    const a = llaveDelCelular("AbCd1234", al);
    expect(llaveDelCelular("AbCd1234", al)).toBe(a);
    expect(llaveDelCelular("ZzYy9876", al)).not.toBe(a);
    expect(llaveDelCelular("AbCd1234", al)).toBe(a);
  });
  it("otro navegador (u otro celular) tiene otra", () => {
    expect(llaveDelCelular("AbCd1234", memoria())).not.toBe(llaveDelCelular("AbCd1234", memoria()));
  });
  it("recuerda solo las últimas salas", () => {
    const al = memoria();
    const primera = llaveDelCelular("sala0000", al);
    for (let i = 1; i <= 8; i++) llaveDelCelular(`sala000${i}`, al);
    expect(JSON.parse(al.getItem("tinkazo.equipo.llaves") ?? "[]")).toHaveLength(8);
    expect(llaveDelCelular("sala0000", al)).not.toBe(primera);
  });
  it("sin almacenamiento o con algo roto guardado, igual devuelve una", () => {
    const roto = { getItem: () => "{no es json", setItem: () => undefined } as unknown as Storage;
    expect(llaveDelCelular("AbCd1234", roto)).toMatch(ES_LLAVE);
    const bloqueado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    } as unknown as Storage;
    expect(llaveDelCelular("AbCd1234", bloqueado)).toMatch(ES_LLAVE);
  });
});

describe("lo que contesta la sala cuando la cuenta no es de este celular", () => {
  const con = (estado: number, cuerpo: unknown = {}) => ({ fetch: (async () => new Response(JSON.stringify(cuerpo), { status: estado })) as never });
  const G = `G${"A".repeat(55)}`;
  it("409 con «ajena» es otra cosa que un registro sin armar", async () => {
    expect(await anotarEquipoEnSala("s", "i", G, "d", "L".repeat(22), con(409, { error: "ajena" }))).toEqual({ ok: false, motivo: "ajena" });
    expect(await anotarEquipoEnSala("s", "i", G, "d", "L".repeat(22), con(409, { error: "sin-registro" }))).toEqual({ ok: false, motivo: "sin-registro" });
  });
  it("429 con «cupo-conexion» es el tope de esta red, no el de la sala", async () => {
    expect(await anotarEquipoEnSala("s", "i", G, "d", "L".repeat(22), con(429, { error: "cupo-conexion" }))).toEqual({ ok: false, motivo: "cupo-conexion" });
  });
});
