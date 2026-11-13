import { describe, expect, it } from "vitest";
import { montarPagos } from "./cobros-prueba";
import { ANULACIONES_POR_SEMANA, PERMISO_RESERVA_MS } from "./compras";
import type { Env } from "./config";
import { AVISO_ESPERA_MS } from "./rutas-altas";

/**
 * El recargo de pagar con QR no sale gratis: cuando la persona anula su compra cargada, se suelta la reserva de créditos
 * y NO el recargo, que sigue en toda orden suya hasta que se pague o lo suelte administración. Cada persona anula como
 * mucho `ANULACIONES_POR_SEMANA` veces en 7 días. Precios de prueba: el primer paquete a 2 USDC. Recargo, 4,25.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };
const montar = (env: Partial<Env> = {}) => montarPagos({ ...ABIERTA, ...env });
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

const RESERVA_ALTA = 380 + 3 * 40 + 30;
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;
const filasDe = (m: M, usuario: string) => Number(m.sql.exec("SELECT COUNT(*) AS n FROM compras_qr WHERE usuario = ?", usuario).toArray()[0]?.n ?? 0);

/** Empieza (o renueva), espera lo que pide el aviso y avisa la carga. */
async function cargarOtraVez(m: M, p: { token: string }) {
  expect((await m.empezar(p.token, "alta")).estado).toBe(200);
  m.mover(AVISO_ESPERA_MS);
  expect((await m.cargar(p.token, "alta")).estado).toBe(200);
}

describe("la persona anula: suelta la reserva y no el recargo", () => {
  it("la reserva se suelta y el recargo sigue en su orden; reintentar usa la misma compra; solo administración suelta el recargo", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const conRecargo = idDe(await m.orden(ana.token, "alta"));
    m.mover(10 * 60_000);
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: false } });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ cerrada: null, reserva: 0 });
    expect(m.cobros.orden(conRecargo)).toMatchObject({ pagada: null, metodo: null });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "6.25", precio: "2", recargo: "4.25" } } });
    expect(await m.orden(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "9.25", recargo: "4.25" } } });
    expect(m.anotado).toContainEqual(["compra-soltada", { producto: "alta" }]);
    expect(m.anotado.filter(([e]) => e === "compra-anulada")).toEqual([]);
    // Pedirlo otra vez es lo mismo, sin contar otra anulación.
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: true } });
    // Reintentar: empezar renueva la misma compra con su recargo y su reserva, y se puede avisar la carga otra vez.
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { permiso: { recargo: "4.25", cargada: true } } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(filasDe(m, "usr_ana")).toBe(1);
    // Administración sí suelta el recargo.
    expect((await m.admin.atender("compras-cerrar", { usuario: "usr_ana", ref: "soporte-0001" })).estado).toBe(200);
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "2" } } });
  });

  it(`como mucho ${ANULACIONES_POR_SEMANA} por persona en 7 días: la siguiente da 409 tope-de-anulaciones y la reserva sigue`, async () => {
    expect(ANULACIONES_POR_SEMANA).toBe(2);
    const m = montar();
    const [ana, beto] = [enPiloto(m, "usr_ana"), enPiloto(m, "usr_beto")];
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    for (let i = 0; i < ANULACIONES_POR_SEMANA; i++) {
      if (i > 0) await cargarOtraVez(m, ana);
      expect((await m.anular(ana.token, "alta")).cuerpo, String(i)).toEqual({ anulada: true, repetido: false });
    }
    await cargarOtraVez(m, ana);
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "tope-de-anulaciones" } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    // El tope es de cada persona: Beto anula la suya.
    await m.empezar(beto.token, "alta");
    await m.cargar(beto.token, "alta");
    expect((await m.anular(beto.token, "alta")).estado).toBe(200);
    // A los 7 días de la primera, Ana puede anular otra vez.
    m.mover(PERMISO_RESERVA_MS);
    await cargarOtraVez(m, ana);
    expect((await m.anular(ana.token, "alta")).estado).toBe(200);
  });

  it("el plazo de 30 minutos cuenta desde el último aviso que dio el sí", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    m.mover(25 * 60_000);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    m.mover(25 * 60_000);
    expect(await m.anular(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { anulada: true, repetido: false } });
  });
});
