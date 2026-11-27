/** Pruebas del recuerdo local, limitado a una semana y a datos no personales. */

import { describe, expect, it } from "vitest";
import {
  borrarMemoria,
  claveDeMemoria,
  guardarMemoria,
  leerMemoria,
  SIN_CUENTA,
  VIDA_MEMORIA_MS,
  VIDA_MEMORIA_PERSONA_MS,
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
    guardado: AHORA,
  };
}

describe("la memoria de una campaña", () => {
  it("guarda y lee los mismos cinco datos, y vence a los siete días y un milisegundo", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, recuerdo());
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_MS)).toEqual(recuerdo());
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_MS + 1)).toBeNull();
    expect(valores.getItem(claveDeMemoria(SALA))).toBeNull();
  });

  it("en una campaña de personas vive lo que vive la sala, 24 horas, y no siete días", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, { ...recuerdo(), cuenta: SIN_CUENTA });
    expect(VIDA_MEMORIA_PERSONA_MS).toBe(24 * 3_600_000);
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_PERSONA_MS)?.cuenta).toBe(SIN_CUENTA);
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_PERSONA_MS + 1)).toBeNull();
    expect(valores.getItem(claveDeMemoria(SALA))).toBeNull();
  });

  it("una campaña de cuentas sigue recordando siete días aunque pasen 24 horas", () => {
    const valores = almacen();
    guardarMemoria(valores, SALA, recuerdo());
    expect(leerMemoria(valores, SALA, AHORA + VIDA_MEMORIA_PERSONA_MS + 1)?.cuenta).toBe(CUENTA);
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
    const amplia = { ...recuerdo(), correo: "ana@example.com", nombre: "Ana", token: "secreto" };
    guardarMemoria(valores, SALA, amplia);
    const crudo = valores.getItem(claveDeMemoria(SALA)) ?? "";
    expect(Object.keys(JSON.parse(crudo) as Record<string, unknown>).sort()).toEqual([
      "comprobante",
      "cuenta",
      "fase",
      "guardado",
      "resultado",
    ]);
    expect(crudo).not.toContain("correo");
    expect(crudo).not.toContain("token");
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

describe("el recuerdo de una campaña de personas", () => {
  it("guarda y lee la marca sin cuenta, y no escribe ninguna cuenta ni nada de la persona", () => {
    const a = almacen();
    guardarMemoria(a, SALA, { ...recuerdo(), cuenta: SIN_CUENTA });
    expect(leerMemoria(a, SALA, AHORA)?.cuenta).toBe(SIN_CUENTA);
    const crudo = a.getItem(claveDeMemoria(SALA)) ?? "";
    expect(Object.keys(JSON.parse(crudo) as object).sort()).toEqual(["comprobante", "cuenta", "fase", "guardado", "resultado"]);
    expect(crudo).not.toMatch(/G[A-Z2-7]{55}/u);
  });

  it("solo vale la marca exacta: otra palabra o una cuenta mal escrita no se lee", () => {
    const a = almacen();
    for (const cuenta of ["Persona", "personas", "", "G123", "p1:aaaaaaaaaaaaaaaaaaaaaaaaaa"]) {
      a.setItem(claveDeMemoria(SALA), JSON.stringify({ ...recuerdo(), cuenta }));
      expect(leerMemoria(a, SALA, AHORA), cuenta).toBeNull();
    }
  });

  it("la memoria de siempre con su cuenta se lee como antes", () => {
    const a = almacen();
    guardarMemoria(a, SALA, recuerdo());
    expect(leerMemoria(a, SALA, AHORA)?.cuenta).toBe(CUENTA);
  });
});
