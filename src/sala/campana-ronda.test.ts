/** La ronda, el número del sorteo y la hora de la sala que el celular lee del estado público y de la consulta propia. */

import { describe, expect, it } from "vitest";
import { estadoPublico, miEstado } from "./campana";
import { fetchFalso } from "./fetch-falso";
import { horaDeLaCabecera, horaDeLaSala } from "./hora";

const CUENTA = `G${"A".repeat(55)}`;
const SERVICIO = "https://servicio.example.org";
const SALA = "ABCDEFGH";
const LLAVE = "L".repeat(22);
const FECHA = "Fri, 27 Nov 2026 20:00:07 GMT";
const HORA = Date.UTC(2026, 10, 27, 20, 0, 7);

const publico = { fase: "sellada", total: 37, cierraMs: 1_800_000_100_000, pase: "vale" };
const propio = { fase: "sellada", total: 37, cierraMs: 1_800_000_100_000, anotada: true };

const leerPublico = (cuerpo: unknown, cabeceras?: Record<string, string>) =>
  estadoPublico(SERVICIO, SALA, null, { fetch: fetchFalso([{ estado: 200, cuerpo, ...(cabeceras ? { cabeceras } : {}) }]).f });
const leerPropio = (cuerpo: unknown, cabeceras?: Record<string, string>) =>
  miEstado(SERVICIO, SALA, CUENTA, LLAVE, { fetch: fetchFalso([{ estado: 200, cuerpo, ...(cabeceras ? { cabeceras } : {}) }]).f });

describe("la hora de la sala", () => {
  it("sale de la cabecera Date, o es null si falta o no se entiende", () => {
    expect(horaDeLaCabecera(FECHA)).toBe(HORA);
    expect(horaDeLaCabecera(null)).toBeNull();
    expect(horaDeLaCabecera("ayer a la tarde")).toBeNull();
    expect(horaDeLaSala(new Response("{}", { headers: { Date: FECHA } }))).toBe(HORA);
    expect(horaDeLaSala(new Response("{}"))).toBeNull();
    expect(horaDeLaSala(null)).toBeNull();
    expect(horaDeLaSala({ headers: { get: () => { throw new Error("sin cabeceras"); } } })).toBeNull();
  });
});

describe("estadoPublico con la lista sellada", () => {
  it("trae la ronda, el número del sorteo y la hora de la sala", async () => {
    const r = await leerPublico({ ...publico, ronda: 6_000_000, sorteo: "12345678901234567890" }, { Date: FECHA });
    expect(r).toEqual({ ...publico, correo: false, ronda: 6_000_000, sorteo: "12345678901234567890", horaSala: HORA });
  });

  it("una sala que no manda la ronda deja el estado exactamente como siempre, aunque traiga la cabecera Date", async () => {
    expect(await leerPublico(publico, { Date: FECHA })).toEqual({ ...publico, correo: false });
  });

  it("sin la cabecera Date trae la ronda y no la hora", async () => {
    const r = await leerPublico({ ...publico, ronda: 6_000_000 });
    expect(r).toEqual({ ...publico, correo: false, ronda: 6_000_000 });
  });

  it("descarta valores raros sin romper el estado", async () => {
    for (const ronda of [0, -3, 1.5, "7", null, Number.MAX_SAFE_INTEGER + 2, Number.NaN]) {
      expect(await leerPublico({ ...publico, ronda, sorteo: "1" }, { Date: FECHA }), String(ronda)).toEqual({ ...publico, correo: false });
    }
  });

  it("descarta un número de sorteo que no tiene la forma, pero guarda la ronda", async () => {
    for (const sorteo of ["", "12a", "1".repeat(21), 123, "-4"]) {
      const r = await leerPublico({ ...publico, ronda: 9, sorteo });
      expect(r, String(sorteo)).toEqual({ ...publico, correo: false, ronda: 9 });
    }
  });

  it("antes de sellar no se toma ninguna ronda, aunque la sala la mande", async () => {
    for (const fase of ["lista", "abierta", "cerrada"]) {
      expect(await leerPublico({ ...publico, fase, ronda: 9, sorteo: "3" }, { Date: FECHA }), fase).toEqual({ ...publico, fase, correo: false });
    }
  });

  it("después del sorteo también viaja", async () => {
    const r = await leerPublico({ ...publico, fase: "sorteada", ronda: 9, sorteo: "3" });
    expect(r).toMatchObject({ fase: "sorteada", ronda: 9, sorteo: "3" });
  });
});

describe("la marca de correo confirmado en la consulta propia", () => {
  const cuerpoEnviado = async (confirmado?: boolean): Promise<Record<string, unknown>> => {
    const { f, llamadas } = fetchFalso([{ estado: 200, cuerpo: propio }]);
    await miEstado(SERVICIO, SALA, CUENTA, LLAVE, { fetch: f }, confirmado);
    return JSON.parse(String(llamadas[0]?.init.body)) as Record<string, unknown>;
  };

  it("sin pedirla el cuerpo es el de siempre", async () => {
    expect(await cuerpoEnviado()).toEqual({ cuenta: CUENTA, llave: LLAVE });
    expect(await cuerpoEnviado(false)).toEqual({ cuenta: CUENTA, llave: LLAVE });
  });

  it("pedida suma c en true y nada más", async () => {
    expect(await cuerpoEnviado(true)).toEqual({ cuenta: CUENTA, llave: LLAVE, c: true });
  });
});

describe("miEstado con la lista sellada", () => {
  it("trae la ronda, el número del sorteo y la hora de la sala junto con lo propio", async () => {
    const r = await leerPropio({ ...propio, ronda: 6_000_000, sorteo: "77" }, { Date: FECHA });
    expect(r).toEqual({ ...propio, ronda: 6_000_000, sorteo: "77", horaSala: HORA });
  });

  it("una sala que no manda la ronda deja la consulta propia como siempre", async () => {
    expect(await leerPropio(propio, { Date: FECHA })).toEqual(propio);
  });

  it("descarta una ronda con mala forma y antes de sellar", async () => {
    expect(await leerPropio({ ...propio, ronda: "9" }, { Date: FECHA })).toEqual(propio);
    expect(await leerPropio({ ...propio, fase: "abierta", ronda: 9 }, { Date: FECHA })).toEqual({ ...propio, fase: "abierta" });
  });
});
