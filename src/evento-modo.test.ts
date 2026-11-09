import { beforeEach, describe, expect, it, vi } from "vitest";
import { T } from "./i18n";
import { eventoEsDePrueba, veredictoConModo } from "./evento-modo";
import { fotoDeEvento, mensajeDeEvento, prepararEvento } from "./ui/compartir";
import { PROOF_VERSION, type Proof } from "./protocol/proof";
import type { SorteoDelEvento } from "./protocol/evento";

/**
 * Un evento de Prueba lo dice: en la página (en cualquier color), en la foto y en el mensaje. Todo depende del modo
 * Oficial: sin él queda exactamente como en producción.
 */

const h = vi.hoisted(() => ({ oficial: true }));
vi.mock("./stellar/config", async (orig) => {
  const real = await orig<typeof import("./stellar/config")>();
  return {
    ...real,
    get hayModoOficial() {
      return h.oficial;
    },
  };
});

const tt = (lang: "es" | "en") => (k: string): string => String(T[lang][k]);

const sorteo = (net?: string, i = 1): SorteoDelEvento => {
  const comprobante: Proof = { v: PROOF_VERSION, names: ["Ana", "Beto"], round: 32_000_000 + i, prize: `Premio ${i}`, signature: "ab".repeat(48), sealedAt: 1_792_500_000 + i, ...(net ? { net, contract: "CABC", id: String(i) } : {}) };
  return { ...comprobante, ganadores: ["Ana"] };
};

beforeEach(() => {
  h.oficial = true;
});

describe("el modo del evento, en su página", () => {
  it("un evento es de Prueba si algún sorteo trae net de testnet", () => {
    expect(eventoEsDePrueba([sorteo("testnet")])).toBe(true);
    expect(eventoEsDePrueba([sorteo("mainnet"), sorteo("testnet", 2)])).toBe(true);
    expect(eventoEsDePrueba([sorteo("mainnet")])).toBe(false);
    expect(eventoEsDePrueba([sorteo()])).toBe(false);
  });

  for (const lang of ["es", "en"] as const) {
    it(`en los tres colores el rótulo lleva Prueba y la marca (${lang})`, () => {
      for (const estado of ["ok", "partial", "bad"] as const) {
        const r = veredictoConModo({ estado, kicker: "Kicker", detalle: "Detalle.", prueba: true }, tt(lang));
        expect(r.marca).toBe(true);
        expect(r.kicker).toBe(`${T[lang].netTest}, Kicker`);
      }
    });

    it(`en amarillo y rojo el detalle dice que se borra; en verde ya lo decía su texto (${lang})`, () => {
      for (const estado of ["partial", "bad"] as const) {
        expect(veredictoConModo({ estado, kicker: "K", detalle: "D.", prueba: true }, tt(lang)).detalle).toBe(`D. ${T[lang].netTestHint}`);
      }
      expect(veredictoConModo({ estado: "ok", kicker: "K", detalle: "D.", prueba: true }, tt(lang)).detalle).toBe("D.");
    });
  }

  it("uno Oficial queda como viene, sin marca", () => {
    for (const estado of ["ok", "partial", "bad", "working"] as const) {
      expect(veredictoConModo({ estado, kicker: "K", detalle: "D.", prueba: false }, tt("es"))).toEqual({ kicker: "K", detalle: "D.", marca: false });
    }
  });
});

describe("la foto y el mensaje de un evento de Prueba", () => {
  const corto = "https://tinkazo.app/c/abc";

  it("la foto lleva Prueba en su rótulo solo si se lo piden, y la de Oficial no", () => {
    expect(fotoDeEvento("es", "Meetup", [sorteo("testnet")], corto, null, true).rotulo).toContain(T.es.fotoPrueba as string);
    expect(fotoDeEvento("es", "Meetup", [sorteo("mainnet")], corto, null, false).rotulo).not.toContain(T.es.fotoPrueba as string);
    expect(fotoDeEvento("en", "Meetup", [sorteo("testnet")], corto, null, true).rotulo).toContain(T.en.fotoPrueba as string);
  });

  it("el mensaje suma la línea de Prueba solo si es de Prueba", () => {
    const base = { titulo: "Meetup", sorteos: 1, enlaces: corto, lineas: ["Polera: Ana"] };
    expect(mensajeDeEvento("es", { ...base, prueba: true })).toContain(T.es.cmpEvPrueba as string);
    expect(mensajeDeEvento("en", { ...base, prueba: true })).toContain(T.en.cmpEvPrueba as string);
    expect(mensajeDeEvento("es", base)).not.toContain(T.es.cmpEvPrueba as string);
  });

  it("preparar un evento de Prueba con el modo Oficial a la vista pone la marca en foto y mensaje", async () => {
    const r = await prepararEvento("Meetup", [sorteo("testnet")], "es", { corto: false, base: "https://tinkazo.app" });
    expect(r.mensaje).toContain(T.es.cmpEvPrueba as string);
    expect(r.fotos[0]?.rotulo).toContain(T.es.fotoPrueba as string);
  }, 30_000);

  it("uno Oficial no lleva la marca", async () => {
    const r = await prepararEvento("Meetup", [sorteo("mainnet")], "es", { corto: false, base: "https://tinkazo.app" });
    expect(r.mensaje).not.toContain(T.es.cmpEvPrueba as string);
    expect(r.fotos[0]?.rotulo).not.toContain(T.es.fotoPrueba as string);
  }, 30_000);

  it("sin modo Oficial, el de Prueba queda como en producción: sin la marca", async () => {
    h.oficial = false;
    const r = await prepararEvento("Meetup", [sorteo("testnet")], "es", { corto: false, base: "https://tinkazo.app" });
    expect(r.mensaje).not.toContain(T.es.cmpEvPrueba as string);
    expect(r.fotos[0]?.rotulo).not.toContain(T.es.fotoPrueba as string);
  }, 30_000);
});
