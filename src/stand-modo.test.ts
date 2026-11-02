import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "./protocol/quicknet";
import { listHash } from "./protocol/canonical";
import { select } from "./protocol/select";
import { bytesToHex } from "./protocol/quicknet";

/**
 * El modo stand: rondas de ejemplo que nunca graban y nunca piden el número a la
 * red. Estas pruebas cuidan la decisión (`sinGrabar`, que miran el sello, el
 * sorteo, Mis sorteos, el premio, el enlace corto y el borrador) y el «número» de
 * la ronda (`faroDeStand`), que sale de `crypto.getRandomValues` y elige con el
 * mismo `select` que un sorteo de verdad.
 */

function pestana(search = "", roto = false): Map<string, string> {
  const datos = new Map<string, string>();
  vi.stubGlobal("location", { search });
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      return datos.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (roto) throw new Error("SecurityError");
      datos.set(k, v);
    },
    removeItem: (k: string) => {
      if (roto) throw new Error("SecurityError");
      datos.delete(k);
    },
  });
  return datos;
}

async function modo() {
  vi.resetModules();
  return import("./ensayo-modo");
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe("el modo stand no graba", () => {
  it("fuera del modo, un sorteo se graba", async () => {
    pestana();
    const m = await modo();
    expect(m.enStand()).toBe(false);
    expect(m.sinGrabar()).toBe(false);
  });

  it("en el modo stand sinGrabar() da verdadero, y vive en la pestaña", async () => {
    const datos = pestana();
    const m = await modo();
    m.marcarStand(true);
    expect(m.enStand()).toBe(true);
    expect(m.enPractica()).toBe(true);
    expect(m.sinGrabar()).toBe(true);
    expect(datos.get("tinkazo.stand")).toBe("1");
    // Otra página de la misma pestaña lo sigue viendo; la dirección no lo lleva.
    const otra = await modo();
    expect(otra.enStand()).toBe(true);
    m.marcarStand(false);
    expect((await modo()).sinGrabar()).toBe(false);
    expect(datos.has("tinkazo.stand")).toBe(false);
  });

  it("con el almacenamiento roto, el modo dura lo que la página y nunca graba", async () => {
    pestana("", true);
    const m = await modo();
    m.marcarStand(true);
    expect(m.enStand()).toBe(true);
    expect(m.sinGrabar()).toBe(true);
  });

  it("un parámetro de la dirección no lo enciende", async () => {
    pestana("?stand=1");
    const m = await modo();
    expect(m.enStand()).toBe(false);
  });

  it("el ensayo y la demo siguen sin grabar", async () => {
    pestana();
    const m = await modo();
    m.marcarEnsayo(true);
    expect(m.sinGrabar()).toBe(true);
    expect(m.enStand()).toBe(false);
  });
});

describe("el número de una ronda de stand", () => {
  it("no toca la red", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    vi.stubGlobal("XMLHttpRequest", f);
    pestana();
    const m = await modo();
    m.faroDeStand(42);
    expect(f).not.toHaveBeenCalled();
  });

  it("son 32 bytes en hex, distintos cada vez, y la firma no es una de verdad", async () => {
    pestana();
    const m = await modo();
    const a = m.faroDeStand(7);
    const b = m.faroDeStand(7);
    expect(a.round).toBe(7);
    expect(a.randomness).toMatch(/^[0-9a-f]{64}$/);
    expect(a.randomness).not.toBe(b.randomness);
    expect(a.signature).toBe("0".repeat(96));
  });

  it("sin Math.random: usa crypto.getRandomValues", async () => {
    pestana();
    const m = await modo();
    const azar = vi.spyOn(Math, "random");
    const crypto_ = vi.spyOn(globalThis.crypto, "getRandomValues");
    m.faroDeStand(1);
    expect(azar).not.toHaveBeenCalled();
    expect(crypto_).toHaveBeenCalledTimes(1);
    azar.mockRestore();
    crypto_.mockRestore();
  });

  it("elige con el mismo select que un sorteo de verdad: determinista dado el número", async () => {
    pestana();
    const m = await modo();
    const bytes = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
    const faro = m.faroDeStand(5, bytes);
    const lista = Array.from({ length: 12 }, (_, i) => `Persona ${i + 1}`);
    const h = listHash(lista);
    const una = select(hexToBytes(faro.randomness), h, lista.length, 2);
    const otra = select(hexToBytes(bytesToHex(bytes)), h, lista.length, 2);
    expect(una).toEqual(otra);
    expect(una).toHaveLength(2);
  });

  it("cuarenta números dan ganadores repartidos por toda la lista", async () => {
    pestana();
    const m = await modo();
    const lista = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const h = listHash(lista);
    const salieron = new Set<number>();
    for (let i = 0; i < 40; i++) salieron.add(select(hexToBytes(m.faroDeStand(1).randomness), h, lista.length, 1)[0] as number);
    expect(salieron.size).toBeGreaterThan(5);
  });
});

describe("los textos del modo stand y de la sala", () => {
  it("cada clave que usan stand.ts, stand-sala.ts y el HTML existe en español y en inglés, sin punto medio", async () => {
    const { readFileSync } = await import("node:fs");
    const { T } = await import("./i18n");
    const claves = new Set<string>();
    for (const f of ["src/ui/stand.ts", "src/ui/stand-sala.ts", "index.html"]) {
      for (const m of readFileSync(f, "utf8").matchAll(/["']((?:stand|standSala)[A-Za-z0-9]*)["']/g)) claves.add(m[1] as string);
    }
    expect(claves.size).toBeGreaterThan(20);
    for (const k of claves) {
      for (const l of ["es", "en"] as const) {
        const v = (T[l] as Record<string, unknown>)[k];
        expect(typeof v, `${l}.${k}`).toBe("string");
        expect(v as string, `${l}.${k}`).not.toContain("·");
        expect(v as string, `${l}.${k}`).not.toMatch(/\b(rifa|apuesta|raffle|bet)\b/i);
      }
    }
  });
});

describe("salir del modo stand no pisa el borrador del sorteo de verdad", () => {
  const BORRADOR = "tinkazo.borrador";

  /**
   * Lo que hace `guardarBorrador` al irse la página (`pagehide`), con el mismo
   * freno: `sinGrabar()`. El cuadro lleva los nombres del stand.
   */
  function alIrse(m: typeof import("./ensayo-modo"), datos: Map<string, string>, cuadro: string): void {
    if (m.sinGrabar()) return;
    if (!cuadro.trim()) datos.delete(BORRADOR);
    else datos.set(BORRADOR, JSON.stringify({ texto: cuadro }));
  }

  /** Lo que hace `reponerBorrador`: repone solo si no hay freno. */
  function alVolver(m: typeof import("./ensayo-modo"), datos: Map<string, string>): string {
    if (m.sinGrabar()) return "";
    return (JSON.parse(datos.get(BORRADOR) ?? "null") as { texto?: string } | null)?.texto ?? "";
  }

  it("salir: el pagehide sigue viendo el modo, y la página nueva lo apaga antes de reponer", async () => {
    const datos = pestana();
    datos.set(BORRADOR, JSON.stringify({ texto: "Ana\nBeto" })); // el de verdad, guardado al entrar
    const m = await modo();
    m.marcarStand(true);
    m.pedirSalidaDelStand();
    // pagehide de la recarga, con los nombres del stand en el cuadro: no escribe.
    expect(m.enStand()).toBe(true);
    alIrse(m, datos, "Llama Lupe\nCóndor Beto");
    expect(JSON.parse(datos.get(BORRADOR) ?? "")).toEqual({ texto: "Ana\nBeto" });
    // pagehide con el cuadro vacío: tampoco borra el de verdad.
    alIrse(m, datos, "");
    expect(datos.has(BORRADOR)).toBe(true);
    // La página nueva (memoria vacía, misma pestaña): apaga el modo y repone el de verdad.
    const nueva = await modo();
    expect(nueva.cerrarSalidaDelStand()).toBe(true);
    expect(nueva.enStand()).toBe(false);
    expect(datos.has("tinkazo.stand")).toBe(false);
    expect(datos.has("tinkazo.stand-salir")).toBe(false);
    expect(alVolver(nueva, datos)).toBe("Ana\nBeto");
  });

  it("cerrar la pestaña con el stand abierto: no guarda nada", async () => {
    const datos = pestana();
    const m = await modo();
    m.marcarStand(true);
    alIrse(m, datos, "Llama Lupe\nCóndor Beto");
    expect([...datos.keys()]).toEqual(["tinkazo.stand"]);
    // Una pestaña nueva arranca sin nada: el almacenamiento murió con la anterior.
    const otra = pestana();
    const nueva = await modo();
    expect(nueva.cerrarSalidaDelStand()).toBe(false);
    expect(nueva.enStand()).toBe(false);
    expect(otra.size).toBe(0);
  });

  it("recargar con el stand abierto: sigue en el modo y no repone ni guarda", async () => {
    const datos = pestana();
    datos.set(BORRADOR, JSON.stringify({ texto: "Ana\nBeto" }));
    const m = await modo();
    m.marcarStand(true);
    alIrse(m, datos, "Llama Lupe");
    expect(JSON.parse(datos.get(BORRADOR) ?? "")).toEqual({ texto: "Ana\nBeto" });
    const nueva = await modo();
    expect(nueva.cerrarSalidaDelStand()).toBe(false);
    expect(nueva.enStand()).toBe(true);
    expect(alVolver(nueva, datos)).toBe("");
  });

  it("sin almacenamiento, pedir la salida no rompe nada", async () => {
    pestana("", true);
    const m = await modo();
    m.marcarStand(true);
    expect(() => m.pedirSalidaDelStand()).not.toThrow();
    expect(m.enStand()).toBe(true);
    expect((await modo()).cerrarSalidaDelStand()).toBe(false);
  });
});
