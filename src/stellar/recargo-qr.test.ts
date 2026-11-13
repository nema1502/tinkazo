import { describe, expect, it } from "vitest";
import { leerRecargoQr, precios } from "./alta-api";
import { ofertaDe, recargoQrDe } from "./alta-oferta";

/**
 * El recargo por pagar con el QR del banco, como lo anuncia el servidor en `GET /v1/alta/precios` (`recargoQr`): el sitio
 * no escribe ningún monto, lo lee. Lo que paga cada persona sale del total de su compra, que el servidor da con el
 * recargo ya sumado. Mal escrito, no hay recargo y no se abre el QR, pero lo que se vende se lee igual.
 */

const URL = "https://pm.example";
const BASE = { red: "mainnet", pago: true, alta: { usdc: "4", sorteos: 3, dias: 90 }, paquetes: [{ id: "p10", usdc: "10", sorteos: 10, dias: 365 }] };
const RECARGO = { primera: "4.25", siguientes: "0.5" };
const responder = (cuerpo: unknown): typeof fetch => (async () => new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
const leer = (cuerpo: unknown) => precios({ url: URL, fetch: responder(cuerpo) });

describe("el recargo del QR que anuncia el servidor", () => {
  it("se lee tal como lo da el servidor: la primera vez y las siguientes, con punto", async () => {
    const r = await leer({ ...BASE, recargoQr: RECARGO });
    expect(r.ok && r.datos.recargoQr).toEqual(RECARGO);
    expect(recargoQrDe(r, true)).toEqual(RECARGO);
  });

  it("sin recargo, o con null, los precios quedan como hoy, sin el campo", async () => {
    for (const cuerpo of [BASE, { ...BASE, recargoQr: null }]) {
      const r = await leer(cuerpo);
      expect(r.ok).toBe(true);
      if (r.ok) expect("recargoQr" in r.datos).toBe(false);
      expect(recargoQrDe(r, true)).toBeNull();
    }
  });

  it("mal escrito no hay recargo, y lo que se vende se lee igual", async () => {
    const sin = ofertaDe(await leer(BASE));
    for (const recargoQr of [{ primera: "4,25", siguientes: "0.5" }, { primera: "4.25" }, { primera: 4.25, siguientes: 0.5 }, { primera: "-1", siguientes: "0.5" }, { primera: "51", siguientes: "0.5" }, { primera: "4.25", siguientes: "0.12345678" }, "4.25:0.5", []]) {
      expect(leerRecargoQr(recargoQr), JSON.stringify(recargoQr)).toBeNull();
      const r = await leer({ ...BASE, recargoQr });
      expect(r.ok, JSON.stringify(recargoQr)).toBe(true);
      expect(recargoQrDe(r, true), JSON.stringify(recargoQr)).toBeNull();
      expect(ofertaDe(r), JSON.stringify(recargoQr)).toEqual(sin);
    }
  });

  it("cero vale como recargo, y cincuenta es el techo", () => {
    expect(leerRecargoQr({ primera: "0", siguientes: "0" })).toEqual({ primera: "0", siguientes: "0" });
    expect(leerRecargoQr({ primera: "50", siguientes: "50.0" })).toEqual({ primera: "50", siguientes: "50.0" });
    expect(leerRecargoQr({ primera: "50.01", siguientes: "0.5" })).toBeNull();
  });

  it("solo con la compra con QR en el build, en la red principal y con el pago prendido", async () => {
    const con = { ...BASE, recargoQr: RECARGO };
    expect(recargoQrDe(await leer(con), false)).toBeNull();
    expect(recargoQrDe(await leer({ ...con, red: "testnet" }), true)).toBeNull();
    expect(recargoQrDe(await leer({ ...con, pago: false }), true)).toBeNull();
    expect(recargoQrDe({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 }, true)).toBeNull();
  });
});
