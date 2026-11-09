import { describe, expect, it } from "vitest";
import { LEGACY_POLLAR_INTENT_KEY, hasPollarKey, leerMarcaPollar, pollarIntentKey, pollarKeyFor } from "./pollar-config";

describe("la llave de Pollar de cada red", () => {
  it("en Oficial vale solo la de Oficial y nunca cae a la de Prueba", () => {
    expect(pollarKeyFor("mainnet", { mainnetKey: "pub_oficial", testnetKey: "pub_prueba", legacyKey: "pub_vieja" })).toBe("pub_oficial");
    expect(pollarKeyFor("mainnet", { testnetKey: "pub_prueba", legacyKey: "pub_vieja" })).toBe("");
    expect(pollarKeyFor("mainnet", { legacyKey: "pub_vieja" })).toBe("");
    expect(hasPollarKey("mainnet", { testnetKey: "pub_prueba" })).toBe(false);
  });

  it("en Prueba vale la suya y, si no está, la de siempre", () => {
    expect(pollarKeyFor("testnet", { testnetKey: "pub_prueba", legacyKey: "pub_vieja" })).toBe("pub_prueba");
    expect(pollarKeyFor("testnet", { legacyKey: "pub_vieja" })).toBe("pub_vieja");
    expect(pollarKeyFor("testnet", {})).toBe("");
  });

  it("las llaves con espacios se leen limpias y una en blanco no cuenta", () => {
    expect(pollarKeyFor("mainnet", { mainnetKey: "  pub_oficial  " })).toBe("pub_oficial");
    expect(pollarKeyFor("mainnet", { mainnetKey: "   " })).toBe("");
  });

  it("la marca de entrada se guarda por red y la vieja solo queda como lectura de Prueba", () => {
    expect(pollarIntentKey("mainnet")).toBe("tinkazo.pollar.intent.mainnet");
    expect(pollarIntentKey("testnet")).toBe("tinkazo.pollar.intent.testnet");
    expect(pollarIntentKey("mainnet")).not.toBe(pollarIntentKey("testnet"));
    expect(LEGACY_POLLAR_INTENT_KEY).toBe("tinkazo.pollar.intent");
  });
});

describe("la marca de entrada de Pollar que leen las páginas de lectura", () => {
  const almacen = (datos: Record<string, string>): Pick<Storage, "getItem"> => ({ getItem: (k) => datos[k] ?? null });

  it("quien entró con correo en Prueba, después de la subida, sigue siendo de correo", () => {
    expect(leerMarcaPollar(almacen({ [pollarIntentKey("testnet")]: "email" }), "testnet")).toBe("email");
  });

  it("lo mismo en Oficial, que nunca tuvo clave vieja", () => {
    expect(leerMarcaPollar(almacen({ [pollarIntentKey("mainnet")]: "email" }), "mainnet")).toBe("email");
  });

  it("la marca de la red gana sobre la vieja", () => {
    expect(leerMarcaPollar(almacen({ [pollarIntentKey("testnet")]: "email", [LEGACY_POLLAR_INTENT_KEY]: "google" }), "testnet")).toBe("email");
  });

  it("con solo la clave vieja, en Prueba sigue valiendo", () => {
    expect(leerMarcaPollar(almacen({ [LEGACY_POLLAR_INTENT_KEY]: "email" }), "testnet")).toBe("email");
  });

  it("la clave vieja no vale en Oficial", () => {
    expect(leerMarcaPollar(almacen({ [LEGACY_POLLAR_INTENT_KEY]: "email" }), "mainnet")).toBeNull();
  });

  it("las marcas de una red no se leen en la otra", () => {
    expect(leerMarcaPollar(almacen({ [pollarIntentKey("mainnet")]: "email" }), "testnet")).toBeNull();
    expect(leerMarcaPollar(almacen({ [pollarIntentKey("testnet")]: "email" }), "mainnet")).toBeNull();
  });
});
