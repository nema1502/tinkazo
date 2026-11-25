import { describe, expect, it } from "vitest";
import { borrarCreacionPendiente, borrarSelloPendiente, guardarCreacionPendiente, guardarSelloPendiente, leerCreacionPendiente, leerSelloPendiente, type Almacen, type SelloPendiente } from "./pendiente";

function almacenDeMemoria(): Almacen & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => void datos.set(k, v),
    removeItem: (k) => void datos.delete(k),
  };
}

const sello: SelloPendiente = { id: "12", ronda: 4_000_000, nombres: ["Ana", "Nora", "Beto"], hashSello: "ab".repeat(32), selladoEn: 1_800_000_000, credentialId: "cred" };

describe("el sello pendiente", () => {
  it("se guarda, se lee igual y se borra", () => {
    const a = almacenDeMemoria();
    expect(leerSelloPendiente(a)).toBeNull();
    guardarSelloPendiente(sello, a);
    expect(leerSelloPendiente(a)).toEqual(sello);
    borrarSelloPendiente(a);
    expect(leerSelloPendiente(a)).toBeNull();
  });

  it("lo que está mal formado se lee como que no hay nada", () => {
    const a = almacenDeMemoria();
    a.setItem("tinkazo.prueba-llave.sello", "no es json");
    expect(leerSelloPendiente(a)).toBeNull();
    a.setItem("tinkazo.prueba-llave.sello", JSON.stringify({ ...sello, id: "no es un numero" }));
    expect(leerSelloPendiente(a)).toBeNull();
    a.setItem("tinkazo.prueba-llave.sello", JSON.stringify({ ...sello, nombres: [1, 2] }));
    expect(leerSelloPendiente(a)).toBeNull();
  });

  it("sin almacenamiento, o con uno que lanza, no se rompe nada", () => {
    expect(() => guardarSelloPendiente(sello, null)).not.toThrow();
    expect(leerSelloPendiente(null)).toBeNull();
    const roto: Almacen = {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    };
    expect(() => guardarSelloPendiente(sello, roto)).not.toThrow();
    expect(leerSelloPendiente(roto)).toBeNull();
    expect(() => borrarSelloPendiente(roto)).not.toThrow();
  });
});

describe("la creación pendiente", () => {
  it("se guarda, se lee y se borra", () => {
    const a = almacenDeMemoria();
    guardarCreacionPendiente({ credentialId: "cred", hashCreacion: "cd".repeat(32) }, a);
    expect(leerCreacionPendiente(a)).toEqual({ credentialId: "cred", hashCreacion: "cd".repeat(32) });
    borrarCreacionPendiente(a);
    expect(leerCreacionPendiente(a)).toBeNull();
  });
});
