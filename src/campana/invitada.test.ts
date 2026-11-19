import { describe, expect, it } from "vitest";
import {
  CLAVE_INVITADA,
  CLAVE_PREMIO,
  CLAVE_VENTANA,
  esInvitada,
  esVentanaDeGoogle,
  leerPremio,
  marcarInvitada,
  marcarPremio,
  marcarVentana,
  soltarInvitada,
  soltarPremio,
  soltarVentana,
} from "./invitada";

/** Las marcas de quien participa en el sorteo de una empresa: lo que dura cada una y que un almacenamiento roto no lance. */

const HORA = 3_600_000;
const MINUTO = 60_000;
const T0 = 1_800_000_000_000;

/** Un almacenamiento falso con un `Map`. */
function almacen(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

/** Un almacenamiento que lanza en todo, como en una ventana privada con los datos del sitio bloqueados. */
function roto(): Storage {
  const falla = (): never => {
    throw new Error("sin almacenamiento");
  };
  return { length: 0, clear: falla, getItem: falla, key: falla, removeItem: falla, setItem: falla };
}

describe("la marca de invitada", () => {
  it("recién marcada es invitada, y a las 47 horas también", () => {
    const a = almacen();
    marcarInvitada(a, T0);
    expect(esInvitada(a, T0)).toBe(true);
    expect(esInvitada(a, T0 + 47 * HORA)).toBe(true);
  });

  it("a las 48 horas y un milisegundo ya no es invitada", () => {
    const a = almacen();
    marcarInvitada(a, T0);
    expect(esInvitada(a, T0 + 48 * HORA + 1)).toBe(false);
  });

  it("sin marca no es invitada", () => {
    expect(esInvitada(almacen(), T0)).toBe(false);
  });

  it("con un valor que no es un número, no es invitada", () => {
    const a = almacen();
    a.setItem(CLAVE_INVITADA, "mañana");
    expect(esInvitada(a, T0)).toBe(false);
    a.setItem(CLAVE_INVITADA, "1e99");
    expect(esInvitada(a, T0)).toBe(false);
  });

  it("con un almacenamiento que lanza, no es invitada y no lanza", () => {
    expect(esInvitada(roto(), T0)).toBe(false);
    expect(() => marcarInvitada(roto(), T0)).not.toThrow();
    expect(() => soltarInvitada(roto())).not.toThrow();
  });

  it("soltarla la borra", () => {
    const a = almacen();
    marcarInvitada(a, T0);
    soltarInvitada(a);
    expect(esInvitada(a, T0)).toBe(false);
    expect(a.getItem(CLAVE_INVITADA)).toBeNull();
  });
});

describe("la marca de la ventana de Google", () => {
  it("vale 10 minutos", () => {
    const a = almacen();
    marcarVentana(a, T0);
    expect(esVentanaDeGoogle(a, T0 + 10 * MINUTO - 1)).toBe(true);
    expect(esVentanaDeGoogle(a, T0 + 10 * MINUTO + 1)).toBe(false);
  });

  it("soltarla la borra", () => {
    const a = almacen();
    marcarVentana(a, T0);
    soltarVentana(a);
    expect(esVentanaDeGoogle(a, T0)).toBe(false);
    expect(a.getItem(CLAVE_VENTANA)).toBeNull();
  });

  it("no se confunde con la de invitada", () => {
    const a = almacen();
    marcarVentana(a, T0);
    expect(esInvitada(a, T0)).toBe(false);
  });

  it("con un almacenamiento que lanza, no lanza y da falso", () => {
    expect(esVentanaDeGoogle(roto(), T0)).toBe(false);
    expect(() => marcarVentana(roto(), T0)).not.toThrow();
    expect(() => soltarVentana(roto())).not.toThrow();
  });
});

describe("la marca del premio", () => {
  it("sin cuenta espera a la primera sesión, y vale 30 minutos", () => {
    const a = almacen();
    marcarPremio(a, T0);
    expect(leerPremio(a, T0)).toEqual({ cuenta: null });
    expect(leerPremio(a, T0 + 30 * MINUTO - 1)).toEqual({ cuenta: null });
    expect(leerPremio(a, T0 + 30 * MINUTO + 1)).toBeNull();
  });

  it("con cuenta, dice de cuál es", () => {
    const a = almacen();
    marcarPremio(a, T0, "GAAA");
    expect(leerPremio(a, T0)).toEqual({ cuenta: "GAAA" });
  });

  it("soltarla la borra", () => {
    const a = almacen();
    marcarPremio(a, T0, "GAAA");
    soltarPremio(a);
    expect(leerPremio(a, T0)).toBeNull();
    expect(a.getItem(CLAVE_PREMIO)).toBeNull();
  });

  it("con un valor que no se entiende, no hay marca", () => {
    const a = almacen();
    a.setItem(CLAVE_PREMIO, "mañana");
    expect(leerPremio(a, T0)).toBeNull();
    a.setItem(CLAVE_PREMIO, `${T0 + MINUTO}:no es una cuenta`);
    expect(leerPremio(a, T0)).toBeNull();
  });

  it("con un almacenamiento que lanza, no hay marca y no lanza", () => {
    expect(leerPremio(roto(), T0)).toBeNull();
    expect(() => marcarPremio(roto(), T0, "GAAA")).not.toThrow();
    expect(() => soltarPremio(roto())).not.toThrow();
  });
});
