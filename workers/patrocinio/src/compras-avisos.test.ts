import { describe, expect, it } from "vitest";
import { montarPagos } from "./cobros-prueba";
import { AVISOS_POR_COMPRA, PERMISO_RESERVA_MS } from "./compras";
import type { Env } from "./config";
import { AVISO_ESPERA_MS } from "./rutas-altas";

/**
 * Cada aviso de carga que da el sí le permite al sitio crear otra orden de carga (otro QR del banco que paga Tinkazo),
 * y la reserva de la compra cuenta los créditos de una sola carga. Por eso una compra da como mucho
 * `AVISOS_POR_COMPRA` avisos que dan el sí en 7 días: el siguiente contesta `409 tope-de-avisos {permiso}` y no se carga.
 * La persona puede seguir pagando su orden con el recargo, y quien opera puede anular la compra.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };
const montar = () => montarPagos(ABIERTA);
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

describe("el tope de avisos de carga por compra", () => {
  it(`${AVISOS_POR_COMPRA} avisos que dan el sí; el siguiente da 409 tope-de-avisos y no anota otro aviso`, async () => {
    expect(AVISOS_POR_COMPRA).toBe(3);
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    for (let i = 0; i < AVISOS_POR_COMPRA; i++) {
      if (i > 0) m.mover(AVISO_ESPERA_MS);
      expect((await m.cargar(ana.token, "alta")).estado, String(i)).toBe(200);
    }
    const ultimo = m.compras.pendiente("usr_ana")?.avisada;
    m.mover(AVISO_ESPERA_MS);
    const pasado = await m.cargar(ana.token, "alta");
    expect(pasado).toMatchObject({ estado: 409, cuerpo: { motivo: "tope-de-avisos", permiso: { producto: "alta", cargada: true } } });
    expect(m.compras.pendiente("usr_ana")?.avisada).toBe(ultimo);
    expect(m.compras.avisosDe((m.compras.pendiente("usr_ana") as { id: number }).id, m.hora())).toBe(AVISOS_POR_COMPRA);
    // Ni con reemplazar ni más tarde dentro de la semana.
    m.mover(60 * 60_000);
    expect(await m.cargar(ana.token, "alta", { reemplazar: true })).toMatchObject({ estado: 409, cuerpo: { motivo: "tope-de-avisos" } });
    // Su orden con el recargo sale igual: puede pagarla con dólares digitales de otra app.
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { recargo: "4.25" } } });
  });

  it("el tope es de cada compra y cuenta 7 días: pasada la semana, la misma compra renovada vuelve a cargar", async () => {
    const m = montar();
    const [ana, beto] = [enPiloto(m, "usr_ana"), enPiloto(m, "usr_beto")];
    await m.empezar(ana.token, "alta");
    for (let i = 0; i < AVISOS_POR_COMPRA; i++) {
      m.mover(AVISO_ESPERA_MS);
      expect((await m.cargar(ana.token, "alta")).estado, String(i)).toBe(200);
    }
    // Beto tiene su propia compra y sus propios avisos.
    await m.empezar(beto.token, "alta");
    expect((await m.cargar(beto.token, "alta")).estado).toBe(200);
    m.mover(PERMISO_RESERVA_MS);
    // Pasados los 7 días la compra ya no reserva: empezar la renueva y el aviso vuelve a dar el sí.
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "permiso-vencido" } });
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
  });

  it("la exportación trae los avisos, sin la persona", () => {
    const m = montar();
    const tablas = m.cupos.exportar(true);
    expect(tablas.compras_avisos).toEqual([]);
  });
});
