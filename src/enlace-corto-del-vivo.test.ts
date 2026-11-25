import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dejarCortoDelVivo, tomarCortoDelVivo } from "./enlace-corto";

/**
 * El corto con el que entró un celular viaja de la vista en vivo a la página del comprobante por `sessionStorage`,
 * atado a la ruta a la que va, como el logo (`enlace-corto-logo.test.ts`). Quien comparte desde el comprobante
 * comparte ese mismo corto y no crea otro desde la conexión del salón. Lo que se toma se vuelve a validar: nada ajeno.
 */

const ORIGEN = "https://tinkazo.app";
const CORTO = `${ORIGEN}/c/AbCdEfGh#${"a".repeat(22)}`;
const RUTA = "/verificar.html#AAAAAAAAAA";

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

beforeEach(() => {
  vi.stubGlobal("sessionStorage", new Almacen());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el corto de la vista en vivo hacia el comprobante", () => {
  it("va y vuelve con la misma ruta", () => {
    dejarCortoDelVivo(RUTA, CORTO);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBe(CORTO);
  });

  it("con otra ruta no entrega nada", () => {
    dejarCortoDelVivo(RUTA, CORTO);
    expect(tomarCortoDelVivo("/verificar.html#otraCosa", ORIGEN)).toBeNull();
  });

  it("sin nada dejado, no entrega nada", () => {
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("un corto de otro origen no se acepta", () => {
    dejarCortoDelVivo(RUTA, `https://otro.example/c/AbCdEfGh#${"a".repeat(22)}`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    dejarCortoDelVivo(RUTA, `https://tinkazo.app.malo.example/c/AbCdEfGh#${"a".repeat(22)}`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("un id de 7 caracteres, una clave de 21 o una ruta que no es de un corto no se aceptan", () => {
    dejarCortoDelVivo(RUTA, `${ORIGEN}/c/AbCdEfG#${"a".repeat(22)}`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    dejarCortoDelVivo(RUTA, `${ORIGEN}/c/AbCdEfGh#${"a".repeat(21)}`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    dejarCortoDelVivo(RUTA, `${ORIGEN}/verificar.html#${"a".repeat(22)}`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    dejarCortoDelVivo(RUTA, `${CORTO}/extra`);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("lo que haya en sessionStorage se vuelve a validar: roto o de otro tipo, nada", () => {
    sessionStorage.setItem("tinkazo.corto-del-vivo", "{roto");
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    sessionStorage.setItem("tinkazo.corto-del-vivo", JSON.stringify({ r: RUTA, c: 7 }));
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("con sessionStorage bloqueado, no tira y no entrega nada", () => {
    const tira = (): never => {
      throw new Error("bloqueado");
    };
    vi.stubGlobal("sessionStorage", { getItem: tira, setItem: tira, removeItem: tira });
    expect(() => dejarCortoDelVivo(RUTA, CORTO)).not.toThrow();
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("no sale a la red", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    dejarCortoDelVivo(RUTA, CORTO);
    tomarCortoDelVivo(RUTA, ORIGEN);
    expect(f).not.toHaveBeenCalled();
  });

  it("se entrega una sola vez: después de tomarlo ya no queda en la pestaña", () => {
    dejarCortoDelVivo(RUTA, CORTO);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBe(CORTO);
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    expect((sessionStorage as unknown as Almacen).m.size).toBe(0);
  });

  it("tomarlo para otra ruta también lo retira: una carga que no es la de la vista no lo hereda más tarde", () => {
    dejarCortoDelVivo(RUTA, CORTO);
    expect(tomarCortoDelVivo("/verificar.html#otraCosa", ORIGEN)).toBeNull();
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });

  it("pasado un minuto ya no vale: un clic que abrió otra pestaña no deja un corto para siempre", () => {
    vi.useFakeTimers();
    try {
      dejarCortoDelVivo(RUTA, CORTO);
      vi.setSystemTime(Date.now() + 59_000);
      expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBe(CORTO);
      dejarCortoDelVivo(RUTA, CORTO);
      vi.setSystemTime(Date.now() + 61_000);
      expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sin la hora de cuando se dejó, no vale", () => {
    sessionStorage.setItem("tinkazo.corto-del-vivo", JSON.stringify({ r: RUTA, c: CORTO }));
    expect(tomarCortoDelVivo(RUTA, ORIGEN)).toBeNull();
  });
});
