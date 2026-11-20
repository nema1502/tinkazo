// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearSessionKind, saveSessionKind } from "./session-store";
import { hayCuentaGuardada } from "./cuenta-guardada";

/**
 * La cuenta guardada de una red, en `cuenta-guardada.ts`.
 *
 * La sesión vive por red (`tinkazo.session.kind.<red>`) y la marca de Pollar
 * también (`tinkazo.pollar.intent.<red>`). Para avisar que la cuenta quedó
 * abierta en el otro modo (nema1502/tinkazo#90) hace falta la misma pregunta
 * que sabe retomar una sesión, para otra red: si hay tipo guardado, o marca de
 * Google o de correo donde hay llave de Pollar.
 *
 * Se lee, nada más: nunca se abre acá la sesión de la otra red (S5).
 */

/** Las dos llaves de Pollar a mano, para no depender del entorno del build. */
const LLAVES = { mainnetKey: "L-Mainnet", testnetKey: "L-Prueba" };

const mapa = (v: Record<string, string>): Pick<Storage, "getItem"> => ({ getItem: (k: string) => v[k] ?? null });

beforeEach(() => {
  localStorage.clear();
});

describe("hayCuentaGuardada", () => {
  it("el tipo de sesión guardado de esa red vale, y solo el de esa red", () => {
    saveSessionKind("guest", "mainnet");
    expect(hayCuentaGuardada("mainnet")).toBe(true);
    expect(hayCuentaGuardada("testnet")).toBe(false);
    clearSessionKind("mainnet");
    expect(hayCuentaGuardada("mainnet")).toBe(false);
  });

  it("todo tipo de sesión guardado vale: invitado, Varial y Google", () => {
    saveSessionKind("guest", "testnet");
    expect(hayCuentaGuardada("testnet")).toBe(true);
    saveSessionKind("freighter", "testnet");
    expect(hayCuentaGuardada("testnet")).toBe(true);
    saveSessionKind("google", "testnet");
    expect(hayCuentaGuardada("testnet")).toBe(true);
  });

  it("la marca de Pollar de esa red vale donde hay llave", () => {
    expect(hayCuentaGuardada("mainnet", { env: LLAVES, almacen: mapa({ "tinkazo.pollar.intent.mainnet": "google" }) })).toBe(true);
    expect(hayCuentaGuardada("testnet", { env: LLAVES, almacen: mapa({ "tinkazo.pollar.intent.mainnet": "google" }) })).toBe(false);
    expect(hayCuentaGuardada("mainnet", { env: LLAVES, almacen: mapa({}) })).toBe(false);
    // De correo también: se guardan como "email".
    expect(hayCuentaGuardada("mainnet", { env: LLAVES, almacen: mapa({ "tinkazo.pollar.intent.mainnet": "email" }) })).toBe(true);
  });

  it("sin llave de Pollar en esa red, su marca no vale: ahí no se pudo entrar con Google", () => {
    expect(hayCuentaGuardada("mainnet", { env: { mainnetKey: "", testnetKey: "L-Prueba" }, almacen: mapa({ "tinkazo.pollar.intent.mainnet": "google" }) })).toBe(false);
  });

  it("la clave vieja sin red solo vale en Prueba, y solo si falta la de la red", () => {
    const vieja = mapa({ "tinkazo.pollar.intent": "google" });
    expect(hayCuentaGuardada("testnet", { env: LLAVES, almacen: vieja })).toBe(true);
    expect(hayCuentaGuardada("mainnet", { env: LLAVES, almacen: vieja })).toBe(false);
  });

  it("con las dos marcas, la de la red manda y la vieja ya no se mira", () => {
    const ambos = mapa({ "tinkazo.pollar.intent.testnet": "email", "tinkazo.pollar.intent": "google" });
    const conAmbas = hayCuentaGuardada("testnet", { env: LLAVES, almacen: ambos });
    expect(conAmbas).toBe(true);
    // Solo lectura: la llamada no inventa, ni borra, ni abre nada.
    expect(hayCuentaGuardada("testnet", { env: LLAVES, almacen: mapa({}) })).toBe(false);
  });

  it("un valor que no es Google ni correo vale igual: hay cuenta guardada detrás de esa marca", () => {
    expect(hayCuentaGuardada("mainnet", { env: LLAVES, almacen: mapa({ "tinkazo.pollar.intent.mainnet": "otra-cosa" }) })).toBe(true);
  });
});
