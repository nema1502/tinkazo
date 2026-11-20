import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { ESPERA_GOOGLE_MS, ESPERA_MAXIMA_MS, type FuentesDeSesion, cuentaDeLaSesion, entrarYRecordar } from "./sesion";

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

  it("si ninguna vía contesta, termina sin cuenta y la página ofrece entrar a mano: 3 s para la prueba y 8 para Google", async () => {
    vi.useFakeTimers();
    try {
      const colgada = (): Promise<string | null> => new Promise(() => undefined);
      let listo = false;
      const r = cuentaDeLaSesion(fuentes({ tipo: "guest", hayPollar: true, prueba: colgada, google: colgada })).then((c) => ((listo = true), c));
      await vi.advanceTimersByTimeAsync(10_900);
      expect(listo).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(await r).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retomar la cuenta de Google puede tardar hasta 8 segundos (con la red lenta): a los 7 todavía se la espera", async () => {
    vi.useFakeTimers();
    try {
      const tarda = (): Promise<string | null> => new Promise((ok) => setTimeout(() => ok(A), 7_000));
      const r = cuentaDeLaSesion(fuentes({ tipo: "google", hayPollar: true, google: tarda }));
      await vi.advanceTimersByTimeAsync(7_100);
      expect(await r).toBe(A);
      expect(ESPERA_GOOGLE_MS).toBe(8_000);
      expect(ESPERA_MAXIMA_MS).toBe(3_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("entrar con Google desde el registro", () => {
  it("deja guardado el tipo de sesión después de entrar, como la herramienta", async () => {
    const orden: string[] = [];
    const cuenta = await entrarYRecordar(
      async () => (orden.push("entrar"), A),
      () => orden.push("recordar"),
    );
    expect(cuenta).toBe(A);
    expect(orden).toEqual(["entrar", "recordar"]);
  });

  it("si la entrada falla, no guarda nada y la falla sigue su camino", async () => {
    const recordar = vi.fn();
    await expect(entrarYRecordar(async () => Promise.reject(new Error("popup-closed")), recordar)).rejects.toThrow("popup-closed");
    expect(recordar).not.toHaveBeenCalled();
  });
});
