import { describe, expect, it } from "vitest";
import {
  CLAVE_DEL_BORRADOR,
  CLAVE_DE_LA_CUENTA_DEL_BORRADOR,
  anotarDuenaDelBorrador,
  borradorEsDeOtra,
  borrarBorrador,
  guardarBorrador,
  leerBorrador,
} from "./borrador";

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
    expect(leerBorrador(a, null)).toBe('{"evento":"x"}');
  });

  it("sin nada guardado no hay borrador", () => {
    expect(leerBorrador(almacen(), null)).toBeNull();
  });

  it("se saca y no vuelve", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    borrarBorrador(a);
    expect(leerBorrador(a, null)).toBeNull();
  });

  it("un borrador de más de 200.000 caracteres no se guarda", () => {
    const a = almacen();
    expect(guardarBorrador(a, "x".repeat(200_001))).toBe(false);
    expect(leerBorrador(a, null)).toBeNull();
  });

  it("sin almacenamiento, o con uno que lanza, guardar dice que no y leer y borrar no rompen", () => {
    expect(guardarBorrador(null, "{}")).toBe(false);
    expect(leerBorrador(null, null)).toBeNull();
    expect(guardarBorrador(bloqueado(), "{}")).toBe(false);
    expect(leerBorrador(bloqueado(), null)).toBeNull();
    expect(() => borrarBorrador(bloqueado())).not.toThrow();
    expect(() => borrarBorrador(null)).not.toThrow();
  });
});

describe("de quién es el borrador", () => {
  const A = "cuenta-a";
  const B = "cuenta-b";

  it("sin dueña anotada vale para quien entre primero, con o sin sesión", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    expect(leerBorrador(a, null)).toBe("{}");
    expect(leerBorrador(a, A)).toBe("{}");
    expect(leerBorrador(a, B)).toBe("{}");
    expect(borradorEsDeOtra(a, B)).toBe(false);
  });

  it("anotado a una cuenta, otra cuenta no lo ve ni se le ofrece, pero no se borra", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    anotarDuenaDelBorrador(a, A);
    expect(a.getItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR)).toBe(A);
    expect(leerBorrador(a, A)).toBe("{}");
    expect(leerBorrador(a, B)).toBeNull();
    expect(borradorEsDeOtra(a, B)).toBe(true);
    expect(borradorEsDeOtra(a, A)).toBe(false);
    // Sin sesión se ve: la campaña por activar no se esconde.
    expect(leerBorrador(a, null)).toBe("{}");
    expect(borradorEsDeOtra(a, null)).toBe(false);
    expect(a.getItem(CLAVE_DEL_BORRADOR)).toBe("{}");
  });

  it("la primera cuenta que lo toma se queda con él y otra no se lo quita", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    anotarDuenaDelBorrador(a, A);
    anotarDuenaDelBorrador(a, B);
    expect(a.getItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR)).toBe(A);
  });

  it("sin borrador no se anota a nadie", () => {
    const a = almacen();
    anotarDuenaDelBorrador(a, A);
    expect(a.getItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR)).toBeNull();
  });

  it("un borrador nuevo no hereda la dueña del anterior, y borrarlo borra también la dueña", () => {
    const a = almacen();
    guardarBorrador(a, "{}");
    anotarDuenaDelBorrador(a, A);
    guardarBorrador(a, '{"evento":"otro"}');
    expect(leerBorrador(a, B)).toBe('{"evento":"otro"}');
    anotarDuenaDelBorrador(a, A);
    borrarBorrador(a);
    expect(a.getItem(CLAVE_DE_LA_CUENTA_DEL_BORRADOR)).toBeNull();
  });

  it("con un almacenamiento que lanza no rompe nada", () => {
    expect(() => anotarDuenaDelBorrador(bloqueado(), A)).not.toThrow();
    expect(borradorEsDeOtra(bloqueado(), A)).toBe(false);
    expect(borradorEsDeOtra(null, A)).toBe(false);
  });
});
