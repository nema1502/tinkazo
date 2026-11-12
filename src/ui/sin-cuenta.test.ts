// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Seguir sin cuenta, el estado: solo existe con la bandera del plan B del ingreso prendida y en Prueba. En Oficial, o
 * con la bandera apagada, no hay forma de que valga, ni siquiera con la marca ya escrita en la pestaña.
 */

const h = vi.hoisted(() => ({ red: "testnet" as "testnet" | "mainnet" }));

vi.mock("../stellar/config", async (orig) => {
  const o = await orig<typeof import("../stellar/config")>();
  return {
    ...o,
    get network() {
      return { ...o.network, name: h.red };
    },
  };
});

const MARCA = "tinkazo.sin-cuenta";
let avisos = 0;
const contar = (): void => void avisos++;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  h.red = "testnet";
  avisos = 0;
  sessionStorage.clear();
  document.addEventListener("tinkazo:sin-cuenta", contar);
});

afterEach(() => {
  document.removeEventListener("tinkazo:sin-cuenta", contar);
  vi.unstubAllEnvs();
});

const cargar = (): Promise<typeof import("./sin-cuenta")> => import("./sin-cuenta");

describe("con la bandera apagada, nada cambia", () => {
  it("elegir no hace nada: no escribe, no avisa y sigue sin valer", async () => {
    const m = await cargar();
    expect(m.sinCuentaElegido()).toBe(false);
    expect(m.elegirSinCuenta()).toBe(false);
    expect(m.sinCuentaElegido()).toBe(false);
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(avisos).toBe(0);
  });
  it("una marca vieja en la pestaña no abre la puerta", async () => {
    sessionStorage.setItem(MARCA, "1");
    const m = await cargar();
    expect(m.sinCuentaElegido()).toBe(false);
  });
});

describe("con la bandera apagada, salir tampoco toca el almacenamiento de la pestaña", () => {
  it("ni lo lee, ni lo escribe, ni lo borra, ni avisa", async () => {
    const llamadas: string[] = [];
    const proto = Storage.prototype as unknown as Record<"getItem" | "setItem" | "removeItem", (...a: unknown[]) => unknown>;
    const originales = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
    for (const metodo of ["getItem", "setItem", "removeItem"] as const) {
      proto[metodo] = function (this: Storage, ...a: unknown[]): unknown {
        llamadas.push(`${metodo}:${String(a[0])}`);
        return originales[metodo].apply(this, a);
      };
    }
    try {
      const m = await cargar();
      m.salirDeSinCuenta();
      expect(m.sinCuentaElegido()).toBe(false);
      expect(llamadas.filter((l) => l.endsWith(":tinkazo.sin-cuenta"))).toEqual([]);
      expect(avisos).toBe(0);
    } finally {
      Object.assign(proto, originales);
    }
  });
});

describe("con la bandera prendida, entrar con una cuenta limpia la marca en cualquier modo", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("en Oficial, con una cuenta, la marca que quedó de Prueba se borra, y al volver a Prueba no revive", async () => {
    const m = await cargar();
    // En Prueba se elige seguir sin cuenta; se pasa a Oficial y se entra con una cuenta.
    expect(m.elegirSinCuenta()).toBe(true);
    expect(sessionStorage.getItem(MARCA)).toBe("1");
    h.red = "mainnet";
    expect(m.sinCuentaElegido()).toBe(false);
    m.salirDeSinCuenta();
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    // Al volver a Prueba, la elección vieja no revive sola: ni la marca ni la memoria.
    h.red = "testnet";
    expect(m.sinCuentaElegido()).toBe(false);
    vi.resetModules();
    expect((await cargar()).sinCuentaElegido()).toBe(false);
  });

  it("en Oficial, sin ninguna elección, no avisa ni escribe nada", async () => {
    h.red = "mainnet";
    const m = await cargar();
    m.salirDeSinCuenta();
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(avisos).toBe(0);
  });
});

describe("con una cuenta abierta, elegir no hace nada", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));
  it("un aviso viejo que sigue en pantalla después de entrar no deja elegir", async () => {
    const m = await cargar();
    expect(m.elegirSinCuenta(true)).toBe(false);
    expect(m.sinCuentaElegido()).toBe(false);
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(avisos).toBe(0);
    // Sin cuenta, el mismo gesto sí elige.
    expect(m.elegirSinCuenta(false)).toBe(true);
  });
});

describe("con la bandera prendida, en Prueba", () => {
  beforeEach(() => vi.stubEnv("VITE_INGRESO_PLAN_B", "1"));

  it("no vale hasta que la persona elige", async () => {
    const m = await cargar();
    expect(m.sinCuentaElegido()).toBe(false);
  });
  it("elegir vale, se recuerda en la pestaña y avisa una sola vez", async () => {
    const m = await cargar();
    expect(m.elegirSinCuenta()).toBe(true);
    expect(m.sinCuentaElegido()).toBe(true);
    expect(sessionStorage.getItem(MARCA)).toBe("1");
    expect(avisos).toBe(1);
    expect(m.elegirSinCuenta()).toBe(true);
    expect(avisos).toBe(1);
  });
  it("sobrevive a recargar la página en la misma pestaña", async () => {
    await (await cargar()).elegirSinCuenta();
    vi.resetModules();
    expect((await cargar()).sinCuentaElegido()).toBe(true);
  });
  it("salir lo borra y avisa", async () => {
    const m = await cargar();
    m.elegirSinCuenta();
    avisos = 0;
    m.salirDeSinCuenta();
    expect(m.sinCuentaElegido()).toBe(false);
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(avisos).toBe(1);
    m.salirDeSinCuenta();
    expect(avisos).toBe(1);
  });
  it("si el almacenamiento no responde, dura lo que la página", async () => {
    const m = await cargar();
    const roto = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sin almacenamiento");
    });
    try {
      expect(m.elegirSinCuenta()).toBe(true);
      expect(m.sinCuentaElegido()).toBe(true);
    } finally {
      roto.mockRestore();
    }
  });
  it("si la bandera se apaga después, la marca de la pestaña deja de valer", async () => {
    const m = await cargar();
    m.elegirSinCuenta();
    vi.stubEnv("VITE_INGRESO_PLAN_B", "");
    expect(m.sinCuentaElegido()).toBe(false);
  });
});

describe("en Oficial, nunca", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_INGRESO_PLAN_B", "1");
    h.red = "mainnet";
  });
  it("elegir no hace nada", async () => {
    const m = await cargar();
    expect(m.elegirSinCuenta()).toBe(false);
    expect(m.sinCuentaElegido()).toBe(false);
    expect(sessionStorage.getItem(MARCA)).toBeNull();
    expect(avisos).toBe(0);
  });
  it("la marca que dejó una pestaña en Prueba no vale al pasar a Oficial", async () => {
    sessionStorage.setItem(MARCA, "1");
    const m = await cargar();
    expect(m.sinCuentaElegido()).toBe(false);
  });
});
