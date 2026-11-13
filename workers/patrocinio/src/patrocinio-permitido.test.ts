import { describe, expect, it } from "vitest";
import { type Env, leerConfig } from "./config";
import { patrocinioEsperado } from "./vigilancia";

/**
 * `PATROCINIO_PERMITIDO` solo vale con la venta que lo necesita prendida (la carga o la compra con QR). Con la venta
 * cerrada, la vigilancia vuelve a esperar todo el patrocinio de Pollar apagado: si alguien lo prende sin querer, avisa.
 */

const BASE: Partial<Env> = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" };
const LISTA = "sponsor_trustlines,sponsor_transfer_cosigned";

describe("PATROCINIO_PERMITIDO y la venta", () => {
  it("con la compra con QR y la carga apagadas la lista queda vacía: la vigilancia espera todo apagado", () => {
    for (const env of [{}, { COMPRAS_QR: "0", CARGAS: "0" }, { COMPRAS_QR: "true" }, { ALTAS: "0", COMPRAS_QR: "1", CARGAS: "1" }]) {
      const cfg = leerConfig({ ...BASE, PATROCINIO_PERMITIDO: LISTA, ...env });
      expect(cfg.patrocinioPermitido, JSON.stringify(env)).toEqual([]);
      expect(patrocinioEsperado({ sponsor_trustlines: true, sponsor_transfer_cosigned: false }, cfg.patrocinioPermitido).esperado, JSON.stringify(env)).toBe(false);
    }
  });

  it("con la carga o la compra con QR prendidas, la lista vale", () => {
    for (const env of [{ CARGAS: "1" }, { COMPRAS_QR: "1" }, { CARGAS: "1", COMPRAS_QR: "1" }]) {
      const cfg = leerConfig({ ...BASE, PATROCINIO_PERMITIDO: LISTA, ...env });
      expect(cfg.patrocinioPermitido, JSON.stringify(env)).toEqual(["sponsor_transfer_cosigned", "sponsor_trustlines"]);
      expect(cfg.faltaAltas).toEqual([]);
      expect(patrocinioEsperado({ sponsor_trustlines: true, sponsor_transfer_cosigned: true }, cfg.patrocinioPermitido).esperado, JSON.stringify(env)).toBe(true);
    }
  });

  it("mal escrita se anota igual con la venta cerrada: así se ve antes de abrir", () => {
    const cfg = leerConfig({ ...BASE, PATROCINIO_PERMITIDO: "sponsor_trustlines;x" });
    expect(cfg.patrocinioPermitido).toEqual([]);
    expect(cfg.faltaAltas).toEqual(["patrocinio-permitido"]);
  });
});
