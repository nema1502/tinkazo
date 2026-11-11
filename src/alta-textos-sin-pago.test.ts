import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXTOS_ALTA } from "./alta-textos";
import { TEXTOS_ALTA_SIN_PAGO } from "./alta-textos-sin-pago";

/**
 * Mientras la compra de sorteos esté apagada (`altaPagoActivo()`, `alta-config.ts`), ningún texto ofrece comprar: las
 * variantes sin pago de los textos de la sección 8 que nombran un paquete, un pago o «sumar sorteos». Con el pago
 * prendido, los de la sección 8 tal cual.
 */

const IDIOMAS = ["es", "en"] as const;
const CLAVES = ["altaTexto", "altaYaActivada", "altaErrServicio", "cupoOfCeroTexto", "cupoOfVencidoTexto", "errAnchor.porteroSinAlta", "errAnchor.porteroSinSorteos"];
const variables = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

/** Lo que ofrece comprar: un paquete, un pago, dólares o sumar sorteos. */
const COMPRA = /paquete|pag(o|ar|aste)|d[oó]lar|compr|sum[aá]|\bpack\b|\bpay|\bbuy|US\$|\badd draws\b|\badd more\b/i;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("./stellar/config");
});

describe("los textos sin pago", () => {
  it("son variantes de las claves que nombran un pago, y solo de esas", () => {
    expect(Object.keys(TEXTOS_ALTA_SIN_PAGO.es).sort()).toEqual([...CLAVES].sort());
    expect(Object.keys(TEXTOS_ALTA_SIN_PAGO.en).sort()).toEqual([...CLAVES].sort());
    for (const k of CLAVES) for (const l of IDIOMAS) expect(TEXTOS_ALTA[l][k], `${l} ${k}`).toMatch(COMPRA);
  });

  it("ninguno ofrece comprar, y llevan los mismos datos entre llaves que la versión con pago", () => {
    for (const k of CLAVES) {
      for (const l of IDIOMAS) {
        const texto = TEXTOS_ALTA_SIN_PAGO[l][k] as string;
        expect(texto?.trim(), `${l} ${k}`).toBeTruthy();
        expect(texto, `${l} ${k}`).not.toMatch(COMPRA);
        expect(variables(texto), `${l} ${k}`).toEqual(variables(TEXTOS_ALTA[l][k] as string));
      }
    }
  });

  it("con las reglas de escritura: sin exclamaciones, punto medio, rayas ni flechas, y sin las palabras de juego de azar", () => {
    for (const k of CLAVES) {
      for (const l of IDIOMAS) {
        const texto = TEXTOS_ALTA_SIN_PAGO[l][k] as string;
        expect(texto, `${l} ${k}`).not.toMatch(/[·•—–―→←↑↓⇒⟶➜!¡]/);
        expect(texto, `${l} ${k}`).not.toMatch(/rifa|loter[ií]a|raffle|ticket|boleto|apuest|\bbet(s|ting)?\b|gambl/i);
        expect(texto, `${l} ${k}`).not.toMatch(/\b(USDC|Stellar|exchange|memo|XLM|hash|firma|signature|contrato|contract|red principal|mainnet|testnet|drand|token)\b/i);
      }
      expect(TEXTOS_ALTA_SIN_PAGO.es[k], k).not.toMatch(/\bLive\b|\bTest\b/);
      expect(TEXTOS_ALTA_SIN_PAGO.en[k], k).not.toMatch(/\bOficial\b|\bPrueba\b/);
    }
  });

  it("los que dirige quien decide, palabra por palabra", () => {
    expect(TEXTOS_ALTA_SIN_PAGO.es.altaTexto).toBe("Para sortear en modo Oficial, activá tu cuenta con el cupón de tu evento.");
    expect(TEXTOS_ALTA_SIN_PAGO.es["errAnchor.porteroSinSorteos"]).toBe("Se te acabaron los sorteos oficiales. Usá otro cupón o seguí gratis en Prueba.");
  });
});

describe("cuál llega al diccionario", () => {
  async function diccionario(env: Record<string, string>, red: "mainnet" | "testnet") {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.doMock("./stellar/config", async (orig) => {
      const real = await orig<typeof import("./stellar/config")>();
      return { ...real, network: { ...real.network, name: red } };
    });
    return (await import("./i18n")).T;
  }

  it("con el pago apagado (el build de hoy, solo VITE_ALTA, o en Prueba), la variante sin pago", async () => {
    const casos: [Record<string, string>, "mainnet" | "testnet"][] = [
      [{}, "mainnet"],
      [{ VITE_ALTA: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" }, "mainnet"],
      [{ VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" }, "testnet"],
    ];
    for (const [env, red] of casos) {
      const T = await diccionario(env, red);
      for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${JSON.stringify(env)} ${red} ${l} ${k}`).toBe(TEXTOS_ALTA_SIN_PAGO[l][k]);
    }
  });

  it("con el pago prendido en la red principal, los de la sección 8", async () => {
    const T = await diccionario({ VITE_ALTA: "1", VITE_ALTA_PAGO: "1", VITE_PATROCINIO_URL_MAINNET: "https://pm.tinkazo.app" }, "mainnet");
    for (const k of CLAVES) for (const l of IDIOMAS) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_ALTA[l][k]);
  });
});
