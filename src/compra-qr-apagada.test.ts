import { describe, expect, it } from "vitest";
import { TEXTOS_COMPRA } from "./compra-textos";
import { T } from "./i18n";
import type { PreciosDeAlta, ResultadoDeAlta } from "./stellar/alta-api";
import { banderasDeAlta, compraQrActiva } from "./stellar/alta-config";
import { ofertaDe, recargoQrDe } from "./stellar/alta-oferta";
import { medioDeEstaCuenta, medioPorDefecto } from "./ui/medio-de-pago";

/**
 * Con la compra con QR apagada (`VITE_COMPRA_QR`, que nace apagada), nada de lo que se ve hoy cambia: las banderas de
 * siempre dan lo mismo, el camino de pago es el de hoy (otra app y sin enlace), lo que se ofrece es lo mismo aunque el
 * servidor anuncie el recargo del QR, y el diccionario solo suma claves nuevas.
 */

const VALORES = [undefined, "0", "1"] as const;
const PORTERO = "https://pm.tinkazo.app";

/** Las banderas como eran antes de la compra con QR. */
function antes(env: Record<string, string | undefined>, red: string) {
  if (red !== "mainnet") return { alta: false, libre: false, pago: false, sorteoServidor: false };
  const alta = env.VITE_ALTA === "1" && !!env.VITE_PATROCINIO_URL_MAINNET;
  return { alta, libre: env.VITE_ALTA_LIBRE === "1" && env.VITE_ALTA !== "1", pago: alta && env.VITE_ALTA_PAGO === "1", sorteoServidor: alta && env.VITE_SORTEO_SERVIDOR === "1" };
}

describe("con la compra con QR apagada no cambia nada de lo que se ve hoy", () => {
  it("las banderas de siempre dan lo mismo que antes, y la del QR apagada, en todas las combinaciones sin VITE_COMPRA_QR", () => {
    for (const red of ["mainnet", "testnet"]) for (const portero of [PORTERO, undefined]) for (const a of VALORES) for (const l of VALORES) for (const p of VALORES) for (const s of VALORES) for (const sa of VALORES) {
      const env = { VITE_ALTA: a, VITE_ALTA_LIBRE: l, VITE_ALTA_PAGO: p, VITE_SORTEO_SERVIDOR: s, VITE_PAGO_CON_SALDO: sa, VITE_PATROCINIO_URL_MAINNET: portero };
      expect(banderasDeAlta(env, red), JSON.stringify({ red, ...env })).toEqual({ ...antes(env, red), qr: false });
    }
  });

  it("en este build la compra con QR está apagada", () => {
    expect(compraQrActiva()).toBe(false);
  });

  it("el camino de pago es el de hoy: otra app y sin enlace, diga lo que diga el servidor, la zona o lo elegido", () => {
    for (const servidor of [{ puede: true, motivo: null }, { puede: false, motivo: "fuera-del-piloto" }, null]) for (const zona of ["America/La_Paz", "Europe/Berlin", null]) for (const elegido of ["qr", "app", null] as const) {
      expect(medioPorDefecto({ enElBuild: false, servidor, elegido, zona })).toEqual({ medio: "app", cambio: false });
    }
    expect(medioDeEstaCuenta({ puede: true, motivo: null }, { almacen: null, zona: "America/La_Paz" })).toEqual({ medio: "app", cambio: false });
  });

  it("lo que se ofrece es lo mismo aunque el servidor anuncie el recargo del QR, y el recargo no se lee", () => {
    const datos: PreciosDeAlta = { red: "mainnet", pago: true, alta: { usdc: "4", sorteos: 3, dias: 90, pausado: false }, paquetes: [{ id: "p10", usdc: "10", sorteos: 10, dias: 365, pausado: false }] };
    const sin: ResultadoDeAlta<PreciosDeAlta> = { ok: true, datos };
    const con: ResultadoDeAlta<PreciosDeAlta> = { ok: true, datos: { ...datos, recargoQr: { primera: "4.25", siguientes: "0.5" } } };
    expect(ofertaDe(con)).toEqual(ofertaDe(sin));
    expect(recargoQrDe(con, compraQrActiva())).toBeNull();
    expect(recargoQrDe(con, false)).toBeNull();
    expect(recargoQrDe(con, true)).toEqual({ primera: "4.25", siguientes: "0.5" });
  });

  it("el diccionario suma los textos de la compra tal cual (que no pisan ninguno de antes lo fija compra-textos.test.ts)", () => {
    for (const l of ["es", "en"] as const) for (const k of Object.keys(TEXTOS_COMPRA[l])) expect(T[l][k], `${l} ${k}`).toBe(TEXTOS_COMPRA[l][k]);
  });
});
