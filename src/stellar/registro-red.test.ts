import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Diagnostico } from "./chequeo-red";
import {
  CLAVE_REGISTRO,
  MAX_REGISTRO,
  anotar,
  anotarChequeo,
  anotarSaturacion,
  leerRegistro,
  limpiar,
  lineaDelRegistro,
  olvidarRegistro,
  registroParaCopiar,
  saturacionReciente,
} from "./registro-red";

const CUENTA = "GBZQHWXF4I4ERXBLLHLQOENNXIJMHDGIYMFDYZVNX5KZM4OXTY4BDSQY";
const HUELLA = "cd".repeat(32);
const AHORA = Date.UTC(2026, 9, 25, 23, 41, 37);

function almacenamiento() {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
    datos,
  };
}

const diagnostico = (o: Partial<Diagnostico> = {}): Diagnostico => ({
  nivel: "rojo",
  caso: "costo-alto",
  casos: [{ caso: "costo-alto", nivel: "rojo" }],
  red: "testnet",
  rpc: "https://soroban-testnet.stellar.org/algo?clave=secreta",
  pagador: "patrocinado",
  costoXlm: 69.0000100,
  rojoXlm: 33,
  ms: 612,
  ledger: 5391787,
  protocolo: 29,
  inclusionP90: 100,
  saldoXlm: null,
  restaurar: false,
  sinInternet: false,
  sinChequeo: false,
  motivo: "ok",
  hora: AHORA,
  ...o,
});

beforeEach(() => {
  vi.stubGlobal("localStorage", almacenamiento());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  olvidarRegistro();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el registro de la red", () => {
  it("anota minuto, red, servidor, paso, caso, nivel, costo, umbral, latencia, ledger, protocolo, acción y final", () => {
    anotarChequeo("chequeo", diagnostico(), { accion: "sellar-con-saldo-de-prueba", final: "entró" }, AHORA);
    const [e] = leerRegistro();
    expect(e).toEqual({
      minuto: "2026-10-25T23:41Z",
      red: "testnet",
      rpc: "soroban-testnet.stellar.org",
      paso: "chequeo",
      caso: "costo-alto",
      nivel: "rojo",
      costoXlm: 69.00001,
      umbralXlm: 33,
      ms: 612,
      ledger: 5391787,
      protocolo: 29,
      accion: "sellar-con-saldo-de-prueba",
      final: "entró",
    });
  });

  it("de la dirección del servidor solo guarda el nombre", () => {
    anotar({ red: "mainnet", paso: "sellar", rpc: "https://mainnet.sorobanrpc.com/v1/abc?token=zzz" }, AHORA);
    expect(leerRegistro()[0]?.rpc).toBe("mainnet.sorobanrpc.com");
    expect(JSON.stringify(leerRegistro())).not.toMatch(/token|abc|zzz/);
  });

  it("no guarda direcciones, huellas, hashes ni nada que no sea de la lista cerrada", () => {
    const sucio = {
      red: "testnet",
      paso: "sellar",
      organizer: CUENTA,
      listHash: HUELLA,
      names: ["María Quispe", "Jorge Mamani"],
      ip: "190.1.2.3",
      final: `falló ${CUENTA} con ${HUELLA}`,
      accion: `tx ${HUELLA}`,
    } as never;
    anotar(sucio, AHORA);
    const guardado = localStorage.getItem(CLAVE_REGISTRO) ?? "";
    for (const prohibido of [CUENTA, HUELLA, "Quispe", "Mamani", "190.1.2.3", "organizer", "listHash", "names"]) {
      expect(guardado).not.toContain(prohibido);
    }
    expect(guardado).toContain("***");
    expect(console.info).toHaveBeenCalled();
    const impreso = String(vi.mocked(console.info).mock.calls.at(-1)?.join(" "));
    expect(impreso).not.toContain(CUENTA);
  });

  it("guarda las últimas 50, la más nueva primero", () => {
    for (let i = 0; i < MAX_REGISTRO + 12; i++) anotar({ red: "testnet", paso: "chequeo", ms: i }, AHORA + i * 60_000);
    const todas = leerRegistro();
    expect(todas).toHaveLength(MAX_REGISTRO);
    expect(todas[0]?.ms).toBe(MAX_REGISTRO + 11);
    expect(todas.at(-1)?.ms).toBe(12);
  });

  it("sin almacenamiento queda en memoria y nada lanza", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
      removeItem: () => {
        throw new Error("bloqueado");
      },
    });
    expect(() => anotar({ red: "testnet", paso: "chequeo" }, AHORA)).not.toThrow();
    expect(leerRegistro()).toHaveLength(1);
    expect(() => olvidarRegistro()).not.toThrow();
  });

  it("datos rotos en el almacenamiento no rompen la lectura", () => {
    localStorage.setItem(CLAVE_REGISTRO, "{no es una lista");
    expect(leerRegistro()).toEqual([]);
    localStorage.setItem(CLAVE_REGISTRO, JSON.stringify([1, "x", null, { minuto: "2026-10-25T23:41Z", red: "testnet", paso: "chequeo" }]));
    expect(leerRegistro()).toHaveLength(1);
  });

  it("la línea para copiar se lee de corrido y las últimas diez salen juntas", () => {
    anotarChequeo("chequeo", diagnostico(), { accion: "seguir-sin-sello" }, AHORA);
    expect(lineaDelRegistro(leerRegistro()[0] as never)).toBe(
      "2026-10-25T23:41Z · chequeo · testnet · soroban-testnet.stellar.org · caso costo-alto · rojo · costo 69.00001 XLM (umbral 33) · 612 ms · ledger 5391787 · protocolo 29 · acción seguir-sin-sello",
    );
    for (let i = 0; i < 20; i++) anotar({ red: "testnet", paso: "reintento" }, AHORA + i);
    expect(registroParaCopiar().split("\n")).toHaveLength(10);
  });

  it("limpiar() pone un valor por defecto en lo que falta, y un nivel raro no entra", () => {
    const e = limpiar({ nivel: "morado", red: undefined } as never, "2026-10-25T23:41Z");
    expect(e).toEqual({ minuto: "2026-10-25T23:41Z", red: "?", paso: "chequeo" });
  });
});

describe("la red dijo que estaba llena", () => {
  it("cuenta cinco minutos desde el último TRY_AGAIN_LATER", () => {
    expect(saturacionReciente(AHORA)).toBe(false);
    anotarSaturacion(AHORA);
    expect(saturacionReciente(AHORA + 4 * 60_000)).toBe(true);
    expect(saturacionReciente(AHORA + 5 * 60_000)).toBe(false);
  });
});
