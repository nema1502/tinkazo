import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { type FuentesDeSesion, cuentaDeLaSesion } from "./sesion";

/**
 * La página de registro del equipo toma la cuenta de la sesión abierta en ese celular (ensayo del 6 de noviembre de
 * 2026: con la sesión abierta en la cabecera, pedía pegarla).
 */

const A = Keypair.random().publicKey();
const B = Keypair.random().publicKey();

const fuentes = (o: Partial<FuentesDeSesion> = {}): FuentesDeSesion & { pedidas: string[] } => {
  const pedidas: string[] = [];
  return {
    pedidas,
    tipo: null,
    hayPollar: false,
    google: async () => (pedidas.push("google"), null),
    freighter: async () => (pedidas.push("freighter"), null),
    prueba: async () => (pedidas.push("prueba"), null),
    ...o,
  };
};

describe("la cuenta de la sesión abierta", () => {
  it("sin sesión ni Google, no hay cuenta y no se pregunta a nadie", async () => {
    const f = fuentes();
    expect(await cuentaDeLaSesion(f)).toBeNull();
    expect(f.pedidas).toEqual([]);
  });

  it("con la cuenta de prueba abierta, la usa", async () => {
    expect(await cuentaDeLaSesion(fuentes({ tipo: "guest", prueba: async () => A }))).toBe(A);
  });

  it("con Freighter abierto, la usa (su función solo responde si ya hay permiso)", async () => {
    expect(await cuentaDeLaSesion(fuentes({ tipo: "freighter", freighter: async () => B }))).toBe(B);
  });

  it("con Google, como antes: se mira aunque no haya marca guardada", async () => {
    expect(await cuentaDeLaSesion(fuentes({ hayPollar: true, google: async () => A }))).toBe(A);
    expect(await cuentaDeLaSesion(fuentes({ tipo: "google", hayPollar: true, google: async () => B }))).toBe(B);
  });

  it("sin la llave de Pollar, Google no se mira", async () => {
    const f = fuentes({ tipo: "google", google: async () => A });
    expect(await cuentaDeLaSesion(f)).toBeNull();
  });

  it("si Freighter ya no da la cuenta, prueba con Google", async () => {
    expect(await cuentaDeLaSesion(fuentes({ tipo: "freighter", hayPollar: true, google: async () => A }))).toBe(A);
  });

  it("una falla o algo que no es una cuenta no rompe la página: queda para entrar a mano", async () => {
    expect(await cuentaDeLaSesion(fuentes({ tipo: "guest", prueba: async () => Promise.reject(new Error("sdk")) }))).toBeNull();
    expect(await cuentaDeLaSesion(fuentes({ tipo: "freighter", freighter: async () => "no-es-una-cuenta" }))).toBeNull();
  });

  it("si Freighter no contesta, a los 3 segundos sigue con Google en vez de dejar la página en blanco", async () => {
    vi.useFakeTimers();
    try {
      const f = fuentes({ tipo: "freighter", hayPollar: true, freighter: () => new Promise(() => undefined), google: async () => A });
      let listo = false;
      const r = cuentaDeLaSesion(f).then((c) => ((listo = true), c));
      await vi.advanceTimersByTimeAsync(2_900);
      expect(listo).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await r).toBe(A);
    } finally {
      vi.useRealTimers();
    }
  });

  it("si ninguna vía contesta, termina sin cuenta y la página ofrece entrar a mano", async () => {
    vi.useFakeTimers();
    try {
      const colgada = (): Promise<string | null> => new Promise(() => undefined);
      const r = cuentaDeLaSesion(fuentes({ tipo: "guest", hayPollar: true, prueba: colgada, google: colgada }));
      await vi.advanceTimersByTimeAsync(6_100);
      expect(await r).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
