import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarConteo } from "../workers/enlaces/src/conteo";
import { contar, olvidarOrigen, paraElServicioViejo, probarCon, recordarOrigen } from "./contar";
import { contarEntradaConRed, contarPasoOficial } from "./ui/contadores";

/**
 * El sitio no depende de que el servicio que recibe los conteos ya esté actualizado.
 *
 * El servicio que hoy está publicado rechaza entero (400) el conteo que trae algo que no conoce: la red en la cuenta
 * conectada, el origen de una tarjeta o las etapas del paso de la cuenta. El sitio puede salir antes que el servicio.
 * Entonces la persona no tiene que ver nada, y lo que ya se contaba (la cuenta conectada y el sello confirmado) se
 * sigue contando, sin la novedad. Con el servicio ya actualizado, cada conteo sale una sola vez y completo.
 */

const DESTINO = "https://c.tinkazo.app/v1/contar";

type Salida = { via: "fetch" | "beacon"; texto: string };

/** Lo que contesta hoy el servicio de la rama principal: no conoce la red de la cuenta, el origen tarjeta ni las etapas. */
function servicioDeHoy(texto: string): number {
  const x = JSON.parse(texto) as { e: string; p?: Record<string, string> };
  if (x.e === "oficial_step" || x.e === "cupon_llegada") return 400;
  if (x.e === "account_connected" && x.p?.network !== undefined) return 400;
  if (x.p?.from === "tarjeta") return 400;
  return validarConteo(x).ok ? 204 : 400;
}

/** Lo que contesta el servicio ya actualizado: la lista cerrada de ahora. */
function servicioActualizado(texto: string): number {
  return validarConteo(JSON.parse(texto)).ok ? 204 : 400;
}

class Almacen {
  m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

let salidas: Salida[];

/** Una pestaña del sitio de verdad, con un servicio que contesta con `servicio` (o un error de red). */
function pestaña(servicio: ((texto: string) => number) | "sin-red", conFetch = true): void {
  salidas = [];
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "", pathname: "/index.html", hash: "" });
  vi.stubGlobal("navigator", {
    doNotTrack: null,
    sendBeacon: (_url: string, texto: unknown) => {
      salidas.push({ via: "beacon", texto: String(texto) });
      return true;
    },
  });
  vi.stubGlobal("document", { prerendering: false });
  vi.stubGlobal("sessionStorage", new Almacen());
  vi.stubGlobal(
    "fetch",
    conFetch
      ? async (_url: string, init: { body: string }) => {
          salidas.push({ via: "fetch", texto: String(init.body) });
          if (servicio === "sin-red") throw new TypeError("sin red");
          return { status: servicio(String(init.body)), ok: servicio(String(init.body)) < 400 };
        }
      : undefined,
  );
}

const reposo = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Los conteos que el servicio aceptó: lo que de verdad se suma. */
const aceptados = (servicio: (texto: string) => number): unknown[] => salidas.filter((s) => servicio(s.texto) === 204).map((s) => JSON.parse(s.texto));

beforeEach(() => {
  probarCon(DESTINO);
  olvidarOrigen();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  probarCon("");
  olvidarOrigen();
});

describe("con el servicio sin actualizar", () => {
  it("la cuenta conectada se sigue contando, sin la red, y la persona no ve ningún error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    pestaña(servicioDeHoy);
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    await reposo();
    expect(aceptados(servicioDeHoy)).toEqual([{ e: "account_connected", p: { kind: "google", from: "home" } }]);
    // El primer intento (completo) y el de respaldo: nada más sale.
    expect(salidas.map((s) => s.via)).toEqual(["fetch", "beacon"]);
    expect(JSON.parse(String(salidas[0]?.texto))).toEqual({ e: "account_connected", p: { kind: "google", network: "mainnet", from: "home" } });
    expect(error).not.toHaveBeenCalled();
  });

  it("el origen tarjeta no hace perder la cuenta conectada ni el sello confirmado", async () => {
    pestaña(servicioDeHoy);
    recordarOrigen("?o=tarjeta");
    expect(contarEntradaConRed("email", "testnet")).toBe(true);
    expect(contar("seal_confirmed", { network: "testnet", from: "tarjeta" })).toBe(true);
    await reposo();
    expect(aceptados(servicioDeHoy)).toEqual([
      { e: "account_connected", p: { kind: "email" } },
      { e: "seal_confirmed", p: { network: "testnet" } },
    ]);
  });

  it("las etapas del paso de la cuenta no rompen nada y no se ve nada", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    pestaña(servicioDeHoy);
    expect(contarPasoOficial("abrio", "mainnet")).toBe(true);
    expect(contarPasoOficial("lista", "mainnet")).toBe(true);
    await reposo();
    // El servicio las rechaza en silencio: no hay nada que contar de antes ni nada que reenviar.
    expect(aceptados(servicioDeHoy)).toEqual([]);
    expect(salidas.every((s) => s.via === "beacon")).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(aviso).not.toHaveBeenCalled();
  });

  it("lo que ya se contaba antes de la novedad sale como siempre, una sola vez", async () => {
    pestaña(servicioDeHoy);
    expect(contar("seal_confirmed", { network: "mainnet", from: "aula" })).toBe(true);
    expect(contar("list_shown", {})).toBe(true);
    await reposo();
    expect(salidas.map((s) => s.via)).toEqual(["beacon", "beacon"]);
    expect(aceptados(servicioDeHoy)).toHaveLength(2);
  });

  it("si el pedido falla por la red, no pasa nada y no se manda dos veces", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    pestaña("sin-red");
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    await reposo();
    expect(salidas.map((s) => s.via)).toEqual(["fetch"]);
    expect(error).not.toHaveBeenCalled();
  });

  it("si el servicio dice que hay demasiados pedidos, no se vuelve a mandar", async () => {
    pestaña(() => 429);
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    await reposo();
    expect(salidas.map((s) => s.via)).toEqual(["fetch"]);
  });

  it("si el navegador no puede leer la respuesta, sale el cuerpo de antes", async () => {
    pestaña(servicioDeHoy, false);
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    await reposo();
    expect(salidas).toEqual([{ via: "beacon", texto: JSON.stringify({ e: "account_connected", p: { kind: "google", from: "home" } }) }]);
  });
});

describe("con el servicio ya actualizado", () => {
  it("la cuenta conectada sale una sola vez, con la red y el origen tarjeta", async () => {
    pestaña(servicioActualizado);
    recordarOrigen("?o=tarjeta");
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    await reposo();
    expect(salidas.map((s) => s.via)).toEqual(["fetch"]);
    expect(aceptados(servicioActualizado)).toEqual([{ e: "account_connected", p: { kind: "google", network: "mainnet", from: "tarjeta" } }]);
  });

  it("las etapas del paso salen y las acepta", async () => {
    pestaña(servicioActualizado);
    expect(contarPasoOficial("protegida", "mainnet")).toBe(true);
    await reposo();
    expect(aceptados(servicioActualizado)).toEqual([{ e: "oficial_step", p: { paso: "protegida" } }]);
  });
});

describe("el cuerpo de respaldo", () => {
  it("solo le saca lo nuevo y nunca le suma nada", () => {
    expect(paraElServicioViejo("account_connected", { kind: "google", network: "mainnet", from: "home" })).toEqual({ kind: "google", from: "home" });
    expect(paraElServicioViejo("account_connected", { kind: "google", from: "tarjeta" })).toEqual({ kind: "google" });
    expect(paraElServicioViejo("seal_confirmed", { network: "mainnet", from: "tarjeta" })).toEqual({ network: "mainnet" });
  });

  it("no hay respaldo cuando no hay nada nuevo", () => {
    expect(paraElServicioViejo("account_connected", { kind: "google", from: "home" })).toBeNull();
    expect(paraElServicioViejo("seal_confirmed", { network: "mainnet", from: "aula" })).toBeNull();
    expect(paraElServicioViejo("oficial_step", { paso: "lista" })).toBeNull();
  });
});
