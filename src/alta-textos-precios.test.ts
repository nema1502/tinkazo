import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_PRECIOS_CON_CUPON } from "./alta-textos-precios";

const PROHIBIDAS = /rifa|lotería|loteria|raffle|ticket|boleto|apuesta|usdc|stellar|exchange|memo/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("la frase de precios cuando el modo Oficial se abre con cupones", () => {
  it("es la de la sección 8 del diseño, en español y en inglés", () => {
    expect(TEXTOS_PRECIOS_CON_CUPON.es.prNote).toBe("Con un cupón de tu evento, el modo Oficial es gratis. Participar en un sorteo y comprobarlo es gratis, siempre.");
    expect(TEXTOS_PRECIOS_CON_CUPON.en.prNote).toBe("With a coupon from your event, Live mode is free. Joining a draw and checking it is always free.");
  });

  it("cumple las reglas de escritura: sin exclamaciones, punto medio, rayas largas ni flechas, y sin palabras prohibidas", () => {
    for (const l of ["es", "en"] as const) {
      const t = TEXTOS_PRECIOS_CON_CUPON[l].prNote as string;
      expect(t, l).not.toMatch(/[!¡\u00b7\u2014\u2013\u2190-\u21ff]/);
      expect(t, l).not.toMatch(PROHIBIDAS);
    }
  });

  it("con la bandera apagada, que es la de hoy, la página dice lo de siempre", async () => {
    vi.stubEnv("VITE_ALTA", "");
    vi.resetModules();
    const { T } = await import("./i18n");
    expect(T.es.prNote).toMatch(/^Hoy Tinkazo es gratis\. Los precios para quien organiza/);
    expect(T.en.prNote).toMatch(/^Today Tinkazo is free\./);
  });

  it("con VITE_ALTA=1 en el build, la página habla del cupón", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    vi.resetModules();
    const { T } = await import("./i18n");
    expect(T.es.prNote).toBe(TEXTOS_PRECIOS_CON_CUPON.es.prNote);
    expect(T.en.prNote).toBe(TEXTOS_PRECIOS_CON_CUPON.en.prNote);
  });
});
