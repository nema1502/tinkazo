import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarConteo } from "../../workers/enlaces/src/conteo";
import { probarCon } from "../contar";
import { contarEntradaConRed, contarPasoOficial } from "./contadores";

/**
 * Lo que sale por el contador anónimo del embudo desde la interfaz de la billetera y el paso de la cuenta.
 *
 * - La primera cuenta conectada de la pestaña lleva la red (Prueba u Oficial), y Google en Prueba y Google en Oficial
 *   se suman por separado (issue #83). Retomar una sesión no pasa por acá: lo cuida el contador de siempre.
 * - El paso «Dejá tu cuenta lista» cuenta cada etapa una vez por pestaña y por etapa, solo en la red principal.
 *
 * Todo anónimo, como el contador: sin token, sin id, sin cuenta, sin nombre. Las etapas que el código todavía no
 * puede ver (`cupon` y `prueba`), y la lectura del cupón en `cupon-enlace.ts`, quedan para el cambio que las alcanza.
 */

const DESTINO = "https://c.tinkazo.app/v1/contar";

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

let enviados: string[];
let almacen: Almacen;

function pestaña(): void {
  enviados = [];
  almacen = new Almacen();
  vi.stubGlobal("location", { hostname: "tinkazo.app", search: "", pathname: "/index.html", hash: "" });
  vi.stubGlobal("navigator", {
    doNotTrack: null,
    sendBeacon: (url: string, texto: unknown) => {
      enviados.push(String(texto));
      return true;
    },
  });
  vi.stubGlobal("document", { prerendering: false });
  vi.stubGlobal("sessionStorage", almacen);
}

const leidos = (): unknown[] => enviados.map((x) => JSON.parse(x));

beforeEach(() => {
  probarCon(DESTINO);
  pestaña();
});

afterEach(() => {
  vi.unstubAllGlobals();
  probarCon("");
});

describe("la entrada con red", () => {
  it("la primera cuenta conectada lleva la red: Oficial y Prueba salen por separado", () => {
    expect(contarEntradaConRed("google", "mainnet")).toBe(true);
    expect(leidos()).toEqual([{ e: "account_connected", p: { kind: "google", network: "mainnet", from: "home" } }]);
    almacen.m.clear();
    enviados = [];
    expect(contarEntradaConRed("google", "testnet")).toBe(true);
    expect(leidos()).toEqual([{ e: "account_connected", p: { kind: "google", network: "testnet", from: "home" } }]);
  });

  it("y una sola vez por pestaña, con la misma clave del contador de siempre", () => {
    expect(contarEntradaConRed("freighter", "testnet")).toBe(true);
    expect(contarEntradaConRed("freighter", "testnet")).toBe(false);
    expect(contarEntradaConRed("google", "testnet")).toBe(false);
    expect(enviados).toHaveLength(1);
  });

  it("lo que manda pasa la validación del Worker, y no lleva nada de nadie", () => {
    contarEntradaConRed("email", "mainnet");
    const cuerpo = JSON.parse(String(enviados[0])) as Record<string, unknown>;
    expect(Object.keys(cuerpo)).toEqual(["e", "p"]);
    const p = cuerpo.p as Record<string, string>;
    expect(Object.keys(p).every((k) => ["kind", "network", "from"].includes(k))).toBe(true);
    expect(validarConteo(cuerpo), JSON.stringify(cuerpo)).toMatchObject({ ok: true });
  });
});

describe("las etapas del paso de la cuenta", () => {
  it("cada etapa cuenta una vez por pestaña, y las etapas en paralelo no se juntan", () => {
    expect(contarPasoOficial("activada", "mainnet")).toBe(true);
    expect(contarPasoOficial("activada", "mainnet")).toBe(false);
    expect(contarPasoOficial("protegida", "mainnet")).toBe(true);
    expect(leidos()).toEqual([
      { e: "oficial_step", p: { paso: "activada" } },
      { e: "oficial_step", p: { paso: "protegida" } },
    ]);
  });

  it("fuera de la red principal no cuenta: el paso es de Oficial", () => {
    expect(contarPasoOficial("activada", "testnet")).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it("lo que manda pasa la validación del Worker, y no lleva nada de nadie", () => {
    contarPasoOficial("lista", "mainnet");
    const cuerpo = JSON.parse(String(enviados[0])) as Record<string, unknown>;
    expect(Object.keys(cuerpo)).toEqual(["e", "p"]);
    const p = cuerpo.p as Record<string, string>;
    expect(Object.keys(p)).toEqual(["paso"]);
    expect(validarConteo(cuerpo), JSON.stringify(cuerpo)).toMatchObject({ ok: true });
  });
});

describe("los ganchos quedan puestos donde el consejo vive", () => {
  const fuente = (ruta: string): string => readFileSync(new URL(ruta, import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("la entrada de wallet-ui.ts y la vuelta de Google en wallet-pollar.ts llevan la red de config", () => {
    const ui = fuente("./wallet-ui.ts");
    expect(ui).toMatch(/contarEntradaConRed\((pick === "guest"[\s\S]*?,\s*network\.name)/);
    expect(ui).not.toMatch(/[^C]contarEntrada\(/);
    const pollar = fuente("../stellar/wallet-pollar.ts");
    expect(pollar).toMatch(/contarEntradaConRed\(this\.#via[\s\S]*?,\s*network\.name/);
    expect(pollar).not.toMatch(/[^C]contarEntrada\(/);
  });

  it("el paso abierto lo cuenta wallet-ui.ts, y activar, proteger y quedar lista, wallet-pollar.ts", () => {
    const ui = fuente("./wallet-ui.ts");
    expect(ui).toMatch(/contarPasoOficial\("abrio",\s*network\.name\)/);
    const pollar = fuente("../stellar/wallet-pollar.ts");
    expect(pollar).toMatch(/contarPasoOficial\("activada",\s*network\.name\)/);
    expect(pollar).toMatch(/contarPasoOficial\("protegida",\s*network\.name\)/);
    expect(pollar).toMatch(/contarPasoOficial\("lista",\s*network\.name\)/);
  });
});
