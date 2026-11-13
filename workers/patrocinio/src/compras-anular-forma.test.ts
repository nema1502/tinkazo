import { describe, expect, it } from "vitest";
import { COBROS, montarPagos } from "./cobros-prueba";
import type { Env } from "./config";

/**
 * La forma exacta de lo que contesta el servidor después de que la persona anula su compra cargada
 * (`POST /v1/compra/anular`): es el contrato con el sitio. La anulación suelta la reserva y NO el recargo, así que la
 * compra sigue abierta (`compraQr.abierta` con `cargada: true`), `compraQr.recargoPendiente` dice el recargo, `puede`
 * sigue en true (empezar renueva esa misma compra) y toda orden nueva de la persona lleva el recargo, con `precio` y
 * `recargo` además del total. Precios de prueba: el primer paquete a 2 USDC. Recargo, 4,25.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };

describe("después de anular, el estado y la orden", () => {
  it("anular contesta {anulada, repetido}; /v1/alta/estado trae la compra abierta con su recargo pendiente", async () => {
    const m = montarPagos(ABIERTA);
    const ana = m.persona("usr_ana");
    m.cupos.transaccion(() => m.compras.sumarPiloto(ana.cuenta as string, m.hora()));
    const permiso = await m.empezar(ana.token, "alta");
    const desde = (permiso.cuerpo as { permiso: { desde: number } }).permiso.desde;
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    m.mover(5 * 60_000);
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: false } });
    expect(await m.estado(ana.token)).toEqual({
      estado: 200,
      cuerpo: {
        acceso: "ninguno",
        cuenta: ana.cuenta,
        abierta: false,
        pedido: null,
        sorteos: { quedan: 0, proximoVence: null },
        orden: null,
        fondeo: "inmediato",
        compraQr: {
          puede: true,
          motivo: null,
          abierta: { producto: "alta", desde, recargo: "4.25", total: "6.25", primera: true, cargada: true },
          terminar: true,
          minimoBs: 0,
          recargoPendiente: "4.25",
        },
      },
    });
    const orden = await m.orden(ana.token, "alta");
    expect(orden.estado).toBe(200);
    const o = (orden.cuerpo as { orden: Record<string, unknown> }).orden;
    expect(Object.keys(o).sort()).toEqual(["destino", "enlace", "id", "memoId", "nota", "precio", "producto", "recargo", "sorteos", "usdc", "vence"]);
    expect(o).toMatchObject({ producto: "alta", usdc: "6.25", precio: "2", recargo: "4.25", sorteos: 3, destino: COBROS });
    // Pedirlo otra vez: lo mismo, repetido.
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: true } });
  });
});
