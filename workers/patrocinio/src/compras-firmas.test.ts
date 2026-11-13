import { describe, expect, it } from "vitest";
import { montarPagos } from "./cobros-prueba";
import { AVISO_ESPERA_MS } from "./rutas-altas";

/**
 * La vigilancia de firmas explica por la compra con QR solo las compras cargadas, una vez por persona en el día y con
 * un techo de 20 personas: un permiso pedido mil veces, o cerrado por cambio de producto, no tapa firmas que se gastan
 * por fuera. Y el recargo pendiente se ve: en el estado de la persona (`compraQr.recargoPendiente`) y en el del portero
 * (`recargosPendientes`).
 */

const montar = () => montarPagos({ COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "40" });
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

describe("las firmas que explica la compra con QR", () => {
  it("las sin cargar no explican nada; cargada, una vez por persona aunque avise dos veces; con techo de 20", async () => {
    const m = montar();
    const desde = m.hora() - 1;
    const ana = enPiloto(m, "usr_ana");
    for (const p of ["alta", "p10", "alta"]) expect((await m.empezar(ana.token, p)).estado, p).toBe(200);
    expect(m.compras.firmas(desde).compras).toBe(0);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(m.compras.firmas(desde).compras).toBe(1);
    m.mover(AVISO_ESPERA_MS);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(m.compras.firmas(desde).compras).toBe(1);
    for (let i = 0; i < 25; i++) {
      const p = enPiloto(m, `usr_p${i}`);
      expect((await m.empezar(p.token, "alta")).estado, String(i)).toBe(200);
      expect((await m.cargar(p.token, "alta")).estado, String(i)).toBe(200);
    }
    expect(m.compras.firmas(desde).compras).toBe(20);
  });
});

describe("el recargo pendiente a la vista", () => {
  it("en el estado de la persona y en el del portero; sin compra cargada, null y cero", async () => {
    const m = montar();
    const [ana, nora] = [enPiloto(m, "usr_ana"), enPiloto(m, "usr_nora")];
    await m.empezar(ana.token, "alta");
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { recargoPendiente: null } } });
    expect(await m.puerta.resumen()).toMatchObject({ recargosPendientes: 0 });
    await m.cargar(ana.token, "alta");
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { recargoPendiente: "4.25" } } });
    expect(await m.estado(nora.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { recargoPendiente: null } } });
    expect(await m.puerta.resumen()).toMatchObject({ recargosPendientes: 1 });
    // Anulada por administración, el recargo deja de estar pendiente.
    await m.admin.atender("compras-cerrar", { usuario: "usr_ana", ref: "soporte-0001" });
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { recargoPendiente: null } } });
    expect(await m.puerta.resumen()).toMatchObject({ recargosPendientes: 0 });
  });
});
