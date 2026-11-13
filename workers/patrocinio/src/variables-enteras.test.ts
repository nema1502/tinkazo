import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { codigo } from "./altas-prueba";
import { COBROS, montarPagos } from "./cobros-prueba";
import { type Env, RESERVA_CARGA_CREDITOS, leerConfig } from "./config";
import { compraCerradaDe } from "./rutas-altas";

/**
 * `RESERVA_CARGA_CREDITOS` (los créditos guardados para las tarjetas del evento) y `COMPRAS_QR_DIA` (las compras con QR
 * del día) se escriben solo con dígitos. Un valor mal escrito (con el punto o la coma de los miles, un espacio en el
 * medio, un signo o letras) no se toma a medias: cierra la venta entera (ni orden nueva, ni carga, ni compra con QR) y
 * el estado lo dice en `faltaAltas` para que la vigilancia avise. Nunca queda una reserva chica sin aviso. Vacías valen
 * lo de siempre (400 y 0).
 */

const ANA = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 31));
const BASE: Partial<Env> = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS };
const PILOTO: Partial<Env> = { CARGAS: "1", COMPRAS_QR: "1", COMPRAS_QR_DIA: "6", COMPRAS_QR_PILOTO: ANA, RESERVA_CARGA_CREDITOS: "8400", RECARGO_QR: "4:0.50" };

const RESERVA_MAL = ["8.400", "8 400", "8,400", "-5", "mucho", "8400.0", "1e4", "+8400", "0x20D0", "８４００"];
const DIA_MAL = ["6.0", "seis", "-1", "6,0", "1e1", "6 6", "+6"];

describe("solo dígitos en la reserva del evento y en las compras del día", () => {
  it("bien escritas valen, también con espacios alrededor; vacías dan lo de siempre, sin aviso", () => {
    expect(leerConfig({ ...BASE, ...PILOTO })).toMatchObject({ reservaCargaCreditos: 8400, comprasQrDia: 6, altasPago: true, cargas: true, comprasQr: true, faltaAltas: [] });
    expect(leerConfig({ ...BASE, ...PILOTO, RESERVA_CARGA_CREDITOS: " 8400 ", COMPRAS_QR_DIA: " 6 " })).toMatchObject({ reservaCargaCreditos: 8400, comprasQrDia: 6, faltaAltas: [] });
    expect(compraCerradaDe(leerConfig({ ...BASE, ...PILOTO }))).toBeNull();
    const vacias = leerConfig({ ...BASE, ...PILOTO, RESERVA_CARGA_CREDITOS: "", COMPRAS_QR_DIA: "" });
    expect(vacias).toMatchObject({ reservaCargaCreditos: RESERVA_CARGA_CREDITOS, comprasQrDia: 0, faltaAltas: [] });
  });

  it("la reserva mal escrita cierra la venta entera y se anota; nunca queda una reserva chica", () => {
    for (const mal of RESERVA_MAL) {
      const cfg = leerConfig({ ...BASE, ...PILOTO, RESERVA_CARGA_CREDITOS: mal });
      expect(cfg.faltaAltas, mal).toEqual(["reserva-carga-creditos"]);
      expect(cfg, mal).toMatchObject({ altasPago: false, cargas: false });
      expect(compraCerradaDe(cfg), mal).toBe("compras-cerradas");
      expect(cfg.reservaCargaCreditos, mal).toBeGreaterThanOrEqual(RESERVA_CARGA_CREDITOS);
    }
  });

  it("las compras del día mal escritas cierran la venta entera y se anotan", () => {
    for (const mal of DIA_MAL) {
      const cfg = leerConfig({ ...BASE, ...PILOTO, COMPRAS_QR_DIA: mal });
      expect(cfg.faltaAltas, mal).toEqual(["compras-qr-dia"]);
      expect(cfg, mal).toMatchObject({ altasPago: false, cargas: false, comprasQrDia: 0 });
      expect(compraCerradaDe(cfg), mal).toBe("compras-cerradas");
    }
    // Las dos mal: las dos se anotan.
    expect(leerConfig({ ...BASE, ...PILOTO, RESERVA_CARGA_CREDITOS: "8.400", COMPRAS_QR_DIA: "seis" }).faltaAltas).toEqual(["reserva-carga-creditos", "compras-qr-dia"]);
  });

  it("con la venta cerrada del primer despliegue también se anotan, para corregirlas antes de abrir; sin el libro o en testnet, no", () => {
    const cerrada = { ...BASE, ALTAS_PAGO: "0", CARGAS: "0", COMPRAS_QR: "0", COMPRAS_QR_DIA: "0", COMPRAS_QR_PILOTO: "" };
    expect(leerConfig({ ...cerrada, RESERVA_CARGA_CREDITOS: "8400" }).faltaAltas).toEqual([]);
    expect(leerConfig({ ...cerrada, RESERVA_CARGA_CREDITOS: "8.400" }).faltaAltas).toEqual(["reserva-carga-creditos"]);
    expect(leerConfig({ RED: "mainnet", ALTAS: "0", RESERVA_CARGA_CREDITOS: "8.400", COMPRAS_QR_DIA: "x" }).faltaAltas).toEqual([]);
    expect(leerConfig({ RED: "testnet", ALTAS: "1", RESERVA_CARGA_CREDITOS: "8.400", COMPRAS_QR_DIA: "x" }).faltaAltas).toEqual([]);
  });

  it("en el objeto: ni compra, ni orden, ni carga; el canje del evento sigue y el estado avisa", async () => {
    for (const [variable, mal, nombre] of [
      ["RESERVA_CARGA_CREDITOS", "8.400", "reserva-carga-creditos"],
      ["COMPRAS_QR_DIA", "6.0", "compras-qr-dia"],
    ] as const) {
      const m = montarPagos({ ...PILOTO, [variable]: mal });
      m.pm.creditos = 1_000_000;
      const ana = m.persona("usr_ana", ANA);
      expect(await m.empezar(ana.token, "alta"), variable).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
      expect(await m.orden(ana.token, "alta"), variable).toEqual({ estado: 503, cuerpo: { motivo: "pago-apagado" } });
      expect(await m.puerta.cargaAbierta(), variable).toBe(false);
      expect((await m.puerta.resumen()).faltaAltas, variable).toEqual([nombre]);
      await m.lote([codigo(1)]);
      expect((await m.cupon(ana.token, codigo(1))).estado, variable).toBe(200);
    }
  });
});
