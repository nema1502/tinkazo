import { describe, expect, it } from "vitest";
import { codigo } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";
import { COMPRAS_POR_PERSONA_DIA, PERMISO_RESERVA_MS, RESERVA_SIN_CARGAR_MS } from "./compras";
import { DIA_MS, type Env } from "./config";

/**
 * Las previsiones de la plata en el permiso de empezar: una compra que nunca se carga reserva créditos poco tiempo (una
 * hora) y esa reserva no frena los canjes de cupones del evento. El tope del día cuenta cada compra que se da, hay un
 * tope de compras por persona y por día, y cambiar de producto no abre otra reserva por fuera de los topes.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };
const montar = (env: Partial<Env> = {}) => montarPagos({ ...ABIERTA, ...env });
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

/** La reserva del primer paquete la primera vez: 380 de la carga, 3 sorteos por 40 y la activación, 30. */
const RESERVA_ALTA = 380 + 3 * 40 + 30;
const filasDe = (m: M, usuario: string) => Number(m.sql.exec("SELECT COUNT(*) AS n FROM compras_qr WHERE usuario = ?", usuario).toArray()[0]?.n ?? 0);

describe("una compra sin cargar reserva una hora", () => {
  it("reserva hasta un milisegundo antes de la hora y a la hora justa ya no; cargada, reserva 7 días", async () => {
    expect(RESERVA_SIN_CARGAR_MS).toBe(60 * 60_000);
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    m.mover(RESERVA_SIN_CARGAR_MS - 1);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    m.mover(1);
    expect(m.compras.reservas(m.hora())).toBe(0);
    // Pasada la hora, avisar la carga pide renovar: empezar la renueva con su reserva y el mismo recargo.
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "permiso-vencido" } });
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { permiso: { desde: m.hora(), recargo: "4.25" } } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(filasDe(m, "usr_ana")).toBe(1);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    m.mover(PERMISO_RESERVA_MS - 1);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    m.mover(1);
    expect(m.compras.reservas(m.hora())).toBe(0);
  });

  it("la reserva de una compra sin cargar no frena un canje; la de una cargada sí", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.lote([codigo(1), codigo(2)]);
    m.pm.creditos = 300 + 400 + RESERVA_ALTA + 1;
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    // Alcanza para el canje de Beto (3 sorteos y su activación: 150) sobre el piso, pero no sobre el piso más la reserva.
    m.mover(61_000);
    m.pm.creditos = 300 + 150 + 1;
    const beto = m.persona("usr_beto");
    expect(await m.cupon(beto.token, codigo(1))).toMatchObject({ estado: 200, cuerpo: { ok: true, sorteosSumados: 3 } });
    // Ana avisa la carga: desde ahí su reserva protege a quien tiene su dinero en camino, también contra los canjes.
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    m.mover(61_000);
    m.pm.creditos = 450 + 150 + 1;
    const caro = m.persona("usr_caro");
    expect(await m.cupon(caro.token, codigo(2))).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    // Sin la compra cargada, ese mismo canje pasa: el freno es la reserva de la cargada.
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
  });

  it("una orden de otra app tampoco la frena una compra sin cargar", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    m.pm.creditos = 300 + 400 + RESERVA_ALTA + 1;
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    m.mover(61_000);
    // La orden respeta la reserva del evento (400 por defecto, orden-piloto.test.ts), pero no la de una compra sin cargar.
    m.pm.creditos = 300 + 400 + 150 + 1;
    // Beto, en la lista: con una lista puesta, la orden de alguien de afuera no nace (orden-piloto.test.ts).
    const beto = enPiloto(m, "usr_beto");
    expect((await m.orden(beto.token, "alta")).estado).toBe(200);
  });
});

describe("los topes del permiso de empezar", () => {
  it("el tope del día cuenta cada compra que se da: cambiar de producto también cuenta", async () => {
    const m = montar({ COMPRAS_QR_DIA: "2" });
    const [ana, beto] = [enPiloto(m, "usr_ana"), enPiloto(m, "usr_beto")];
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect((await m.empezar(ana.token, "p10")).estado).toBe(200);
    expect(await m.empezar(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
    // Pedir otra vez lo mismo devuelve la que tiene: no es otra compra y no cuenta.
    expect((await m.empezar(ana.token, "p10")).estado).toBe(200);
    // Con el tope lleno, cambiar de producto tampoco abre otra reserva.
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
    expect(m.compras.reservas(m.hora())).toBe(m.compras.activa("usr_ana", m.hora())?.reserva);
    m.mover(DIA_MS);
    expect((await m.empezar(beto.token, "alta")).estado).toBe(200);
  });

  it(`cada persona da como mucho ${COMPRAS_POR_PERSONA_DIA} compras por día; las demás siguen; al otro día puede otra vez`, async () => {
    expect(COMPRAS_POR_PERSONA_DIA).toBe(3);
    const m = montar();
    const [ana, beto] = [enPiloto(m, "usr_ana"), enPiloto(m, "usr_beto")];
    const productos = ["alta", "p10", "alta"];
    for (const p of productos) expect((await m.empezar(ana.token, p)).estado, p).toBe(200);
    expect(filasDe(m, "usr_ana")).toBe(COMPRAS_POR_PERSONA_DIA);
    expect(await m.empezar(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
    expect(filasDe(m, "usr_ana")).toBe(COMPRAS_POR_PERSONA_DIA);
    expect(m.anotado).toContainEqual(["compra-pausa", { motivo: "tope-del-dia" }]);
    expect((await m.empezar(beto.token, "alta")).estado).toBe(200);
    m.mover(DIA_MS);
    expect((await m.empezar(ana.token, "p10")).estado).toBe(200);
  });

  it("con el tope de la persona lleno, su misma compra sigue: el estado dice que puede y renovarla no es otra compra", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    for (const p of ["alta", "p10", "alta"]) await m.empezar(ana.token, p);
    expect(await m.estado(ana.token)).toMatchObject({ estado: 200, cuerpo: { compraQr: { puede: true, abierta: { producto: "alta" } } } });
    m.mover(RESERVA_SIN_CARGAR_MS);
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(filasDe(m, "usr_ana")).toBe(3);
  });
});
