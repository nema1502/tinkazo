import { describe, expect, it } from "vitest";
import { CLAVE_DEL_BORRADOR, borrarBorrador, guardarBorrador, leerBorrador } from "./borrador";

/** El borrador de una campaña sin activar: se guarda, se lee y se saca, y sin almacenamiento nada se rompe. */

function almacen(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

/** Un almacenamiento que lanza en cada uso, como el de un navegador con los datos bloqueados. */
const bloqueado = (): Storage =>
  ({
    getItem: () => {
      throw new Error("bloqueado");
    },
    setItem: () => {
      throw new Error("bloqueado");
    },
    removeItem: () => {
      throw new Error("bloqueado");
    },
  }) as unknown as Storage;

describe("el borrador de la campaña", () => {
  it("se guarda con su clave y se lee igual", () => {
    const a = almacen();
    expect(guardarBorrador(a, '{"evento":"x"}')).toBe(true);
    expect(a.getItem("tinkazo.campana.borrador")).toBe('{"evento":"x"}');
    expect(CLAVE_DEL_BORRADOR).toBe("tinkazo.campana.borrador");
    expect(leerBorrador(a)).toBe('{"evento":"x"}');
  });

  it("sin nada guardado no hay borrador", () => {
    expect(leerBorrador(almacen())).toBeNull();
  });

  it("se saca y no vuelve", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    borrarBorrador(a);
    expect(leerBorrador(a)).toBeNull();
  });

  it("un borrador de más de 200.000 caracteres no se guarda", () => {
    const a = almacen();
    expect(guardarBorrador(a, "x".repeat(200_001))).toBe(false);
    expect(leerBorrador(a)).toBeNull();
  });

  it("sin almacenamiento, o con uno que lanza, guardar dice que no y leer y borrar no rompen", () => {
    expect(guardarBorrador(null, "{}")).toBe(false);
    expect(leerBorrador(null)).toBeNull();
    expect(guardarBorrador(bloqueado(), "{}")).toBe(false);
    expect(leerBorrador(bloqueado())).toBeNull();
    expect(() => borrarBorrador(bloqueado())).not.toThrow();
    expect(() => borrarBorrador(null)).not.toThrow();
  });
});
