import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorKey } from "../stellar/errores";

/**
 * Un `403 cuenta-ajena` del portero que llega como error del sello o del sorteo. En la red principal con el cobro por uso
 * (`VITE_ALTA=1` y una cuenta de Google o de correo) quiere decir que la cuenta no está en su libro: tiene que decir lo
 * mismo que la caja de la red (`errAnchor.porteroSinAlta`), y no la frase de Prueba (`errAnchor.porteroAjena`). En Prueba,
 * con Freighter o con la bandera apagada, la de siempre.
 */

const h = vi.hoisted(() => ({
  red: "mainnet" as "mainnet" | "testnet",
  billetera: null as unknown,
}));

vi.mock("../stellar/config", async (orig) => {
  const real = await orig<typeof import("../stellar/config")>();
  return {
    ...real,
    get network() {
      return { ...real.network, name: h.red };
    },
  };
});
vi.mock("../stellar/wallet-lite", async (orig) => ({ ...(await orig<typeof import("../stellar/wallet-lite")>()), activeWallet: () => h.billetera }));

const pollar = () => ({ kind: "external", submitsItself: true, address: "GAAA" });
const freighter = () => ({ kind: "external", address: "GAAA" });
const ajena = () => Object.assign(new Error("cuenta-ajena"), { name: "ErrorPortero", motivo: "cuenta-ajena", estado: 403 });
/** El no del candado de antes de la firma (`envio-sdk.ts`): la cuenta no tiene acceso, y no se pidió ninguna firma. */
const sinAlta = () => Object.assign(new Error("portero-sin-alta"), { name: "ErrorPortero", motivo: "sin-alta", estado: 403 });

// Con la compra de sorteos apagada (el build de hoy), la variante sin pago (`alta-textos-sin-pago.ts`).
const SIN_ALTA = "Tu cuenta todavía no tiene acceso al modo Oficial. Activala con el cupón de tu evento.";
const AJENA = "Esta cuenta no puede sortear gratis desde acá. Entrá con otra cuenta de Google o de correo.";

beforeEach(() => {
  h.red = "mainnet";
  h.billetera = pollar();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("la clave del no del portero", () => {
  it("cuenta-ajena con el cobro por uso es la del acceso; sin él, la de siempre", () => {
    expect(errorKey(ajena(), { cobroPorUso: true })).toBe("porteroSinAlta");
    expect(errorKey(ajena(), { cobroPorUso: false })).toBe("porteroAjena");
    expect(errorKey(ajena())).toBe("porteroAjena");
  });

  it("lo que no es de la cuenta sigue con su clave, con o sin el cobro por uso", () => {
    const conRazon = (razon: string) => Object.assign(ajena(), { razon });
    expect(errorKey(conRazon("fee-alta"), { cobroPorUso: true })).toBe("busy");
    expect(errorKey(conRazon("restaurar"), { cobroPorUso: true })).toBe("unknown");
    // `no-permitida` es la transacción, no el libro: la frase de siempre.
    expect(errorKey(Object.assign(ajena(), { motivo: "no-permitida", estado: 400 }), { cobroPorUso: true })).toBe("porteroAjena");
  });
});

describe("lo que lee la persona en el sello y en el sorteo", () => {
  it("en la red principal con el cobro por uso, lo mismo que la caja de la red", async () => {
    vi.stubEnv("VITE_ALTA", "1");
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(ajena(), "sello")).toBe(SIN_ALTA);
    expect(await anchorErrorText(ajena(), "sorteo")).toBe(SIN_ALTA);
  });

  it("con la bandera apagada, con Freighter o en Prueba, la frase de siempre", async () => {
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(ajena(), "sello")).toBe(AJENA);
    vi.stubEnv("VITE_ALTA", "1");
    h.billetera = freighter();
    expect(await anchorErrorText(ajena(), "sello")).toBe(AJENA);
    h.billetera = pollar();
    h.red = "testnet";
    expect(await anchorErrorText(ajena(), "sello")).toBe(AJENA);
  });
});

describe("el candado sin acceso, con el cobro por uso apagado", () => {
  // Sin VITE_ALTA no hay caja del cupón: decir «usá un cupón» no lleva a ningún lado. Es la frase de una cuenta que el
  // portero no cubre, la misma que la de cuenta-ajena.
  it("la clave es la de siempre sin el cobro por uso, y la del acceso con él (o sin decirlo)", () => {
    expect(errorKey(sinAlta(), { cobroPorUso: false })).toBe("porteroAjena");
    expect(errorKey(sinAlta(), { cobroPorUso: true })).toBe("porteroSinAlta");
    expect(errorKey(sinAlta())).toBe("porteroSinAlta");
  });

  it("lo que lee la persona en el sello y en el sorteo", async () => {
    const { anchorErrorText } = await import("./anchor");
    expect(await anchorErrorText(sinAlta(), "sello")).toBe(AJENA);
    expect(await anchorErrorText(sinAlta(), "sorteo")).toBe(AJENA);
    vi.stubEnv("VITE_ALTA", "1");
    expect(await anchorErrorText(sinAlta(), "sello")).toBe(SIN_ALTA);
  });
});
