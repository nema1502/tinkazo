/** Pruebas del recuerdo local, limitado a una semana: cuenta, fase, resultado, comprobante, nombre y número. */

import { describe, expect, it } from "vitest";
import {
  borrarMemoria,
  claveDeMemoria,
  guardarMemoria,
  leerMemoria,
  VIDA_MEMORIA_MS,
  type MemoriaDeCampana,
} from "./memoria";

const SALA = "sala-de-prueba";
const AHORA = Date.UTC(2026, 10, 21, 18);
const CUENTA = `G${"A".repeat(55)}`;

function almacen(): Storage {
  const valores = new Map<string, string>();
  return {
    get length() {
      return valores.size;
    },
    clear: () => valores.clear(),
    getItem: (clave) => valores.get(clave) ?? null,
    key: (indice) => [...valores.keys()][indice] ?? null,
    removeItem: (clave) => valores.delete(clave),
    setItem: (clave, valor) => void valores.set(clave, valor),
  };
}

function recuerdo(): MemoriaDeCampana {
  return {
    cuenta: CUENTA,
    fase: "abierta",
    resultado: null,
    comprobante: null,
    nombre: null,
    total: null,
    guardado: AHORA,
  };
}

describe("la memoria de una campaña", () => {
  it("guarda y lee los mismos siete datos, y vence a los siete días y un milisegundo", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, { ...recuerdo(), nombre: "Ana P.", total: 12 });
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_MS)).toEqual({ ...recuerdo(), nombre: "Ana P.", total: 12 });
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_MS + 1)).toBeNull();
    expect(valores.getItem(claveDeMemoria(SALA))).toBeNull();
  });

  it("guarda el nombre y el número solo con su forma", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, { ...recuerdo(), nombre: "Ana P.", total: 12 });
    expect(leerMemoria(valores, SALA, AHORA)).toEqual({ ...recuerdo(), nombre: "Ana P.", total: 12 });
    guardarMemoria(valores, SALA, { ...recuerdo(), nombre: "Ana P.", total: -3 });
    expect(leerMemoria(valores, SALA, AHORA)?.total).toBeNull();
    guardarMemoria(valores, SALA, { ...recuerdo(), nombre: undefined as unknown as string, total: undefined as unknown as number });
    const vacio = leerMemoria(valores, SALA, AHORA);
    expect(vacio?.nombre).toBeNull();
    expect(vacio?.total).toBeNull();
  });

  it("un recuerdo viejo, sin nombre ni número, abre igual", () => {
    const valores = almacen();
    valores.setItem(
      claveDeMemoria(SALA),
      JSON.stringify({ cuenta: CUENTA, fase: "abierta", resultado: null, comprobante: null, guardado: AHORA }),
    );
    expect(leerMemoria(valores, SALA, AHORA)).toEqual(recuerdo());
  });

  it("rechaza una cuenta con otra forma y un contenido que no sea JSON", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, { ...recuerdo(), cuenta: "cuenta-corta" });
    expect(leerMemoria(valores, SALA, AHORA)).toBeNull();
    valores.setItem(claveDeMemoria(SALA), "no es JSON");
    expect(leerMemoria(valores, SALA, AHORA)).toBeNull();
  });

  it("no conserva campos adicionales aunque lleguen en el objeto recibido", () => {
    const valores = almacen();
    const amplia = { ...recuerdo(), correo: "ana@example.com", token: "secreto" };
    guardarMemoria(valores, SALA, amplia);
    const crudo = valores.getItem(claveDeMemoria(SALA)) ?? "";
    expect(Object.keys(JSON.parse(crudo) as Record<string, unknown>).sort()).toEqual([
      "comprobante",
      "cuenta",
      "fase",
      "guardado",
      "nombre",
      "resultado",
      "total",
    ]);
    expect(crudo).not.toContain("correo");
    expect(crudo).not.toContain("secreto");
  });

  it("un almacenamiento bloqueado no rompe ninguna operación", () => {
    const bloqueado = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    } as unknown as Storage;
    expect(leerMemoria(bloqueado, SALA, AHORA)).toBeNull();
    expect(() => guardarMemoria(bloqueado, SALA, recuerdo())).not.toThrow();
    expect(() => borrarMemoria(bloqueado, SALA)).not.toThrow();
  });
});
