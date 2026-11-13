import { describe, expect, it } from "vitest";
import { atenderAdmin } from "./admin";
import { montarPagos } from "./cobros-prueba";
import { type Env, leerConfig } from "./config";

/**
 * `POST /v1/admin/compras/soltar {ref}`, con la clave de operar: suelta de una vez todas las compras con QR sin cargar
 * (cerradas con el motivo `soltada`), así su reserva vuelve enseguida para los canjes del evento. Las cargadas no se
 * tocan: tienen su dinero en camino.
 */

const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "10" };
const montar = () => montarPagos(ABIERTA);
type M = ReturnType<typeof montar>;

function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

const RESERVA_ALTA = 380 + 3 * 40 + 30;
const RESERVA_P10 = 380 + 10 * 40 + 30;

describe("soltar las compras sin cargar", () => {
  it("cierra todas las sin cargar y suelta su reserva; las cargadas siguen; otra vez no cambia nada", async () => {
    const m = montar();
    const [ana, beto, caro] = ["usr_ana", "usr_beto", "usr_caro"].map((u) => enPiloto(m, u)) as [ReturnType<typeof enPiloto>, ReturnType<typeof enPiloto>, ReturnType<typeof enPiloto>];
    await m.empezar(ana.token, "alta");
    await m.empezar(beto.token, "p10");
    await m.empezar(caro.token, "alta");
    await m.cargar(caro.token, "alta");
    expect(m.compras.reservas(m.hora())).toBe(2 * RESERVA_ALTA + RESERVA_P10);
    expect(await m.admin.atender("compras-soltar", { ref: "evento-14nov" })).toEqual({ estado: 200, cuerpo: { ok: true, soltadas: 2, reserva: RESERVA_ALTA + RESERVA_P10 } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(m.compras.activa("usr_ana", m.hora())).toBeNull();
    expect(m.compras.ultima("usr_beto")).toMatchObject({ motivo: "soltada", cerrada: m.hora() });
    expect(m.compras.pendiente("usr_caro")).toMatchObject({ cerrada: null });
    expect(m.anotado).toContainEqual(["admin-compra", { accion: "soltadas", soltadas: 2, reserva: RESERVA_ALTA + RESERVA_P10 }]);
    expect(await m.admin.atender("compras-soltar", { ref: "evento-14nov" })).toEqual({ estado: 200, cuerpo: { ok: true, soltadas: 0, reserva: 0 } });
    // Quien la tenía puede empezar otra después.
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect(JSON.stringify(m.anotado)).not.toContain("usr_");
  });

  it("anda con la compra con QR apagada: es para soltar, no para vender", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    const cerrada = m.conVariables({ COMPRAS_QR: "0", CARGAS: "0" });
    expect(cerrada.puerta).toBeDefined();
    expect(await m.admin.atender("compras-soltar", { ref: "cierre" })).toMatchObject({ estado: 200, cuerpo: { soltadas: 1 } });
    expect(m.compras.reservas(m.hora())).toBe(0);
  });

  it("lo mal escrito da 400 cuerpo y no toca nada", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    for (const malo of [{}, { ref: 3 }, { ref: "" }, { ref: "con espacios" }]) expect(await m.admin.atender("compras-soltar", malo), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
  });

  it("la ruta va con la clave de operar; con la de cupones, 401; otro método, 405", async () => {
    const CUPONES = "c".repeat(40);
    const OPERAR = "o".repeat(40);
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
    const env = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
    const pedido = (clave: string, init: RequestInit = {}) => new Request("https://pm.tinkazo.app/v1/admin/compras/soltar", { method: init.method ?? "POST", headers: { Authorization: `Bearer ${clave}` }, body: init.body });
    const vistos: Array<[string, unknown]> = [];
    const llamar = async (accion: string, datos: unknown) => (vistos.push([accion, datos]), { estado: 200, cuerpo: { ok: true } });
    expect((await atenderAdmin(pedido(OPERAR, { body: JSON.stringify({ ref: "evento-14nov" }) }), env, cfg, llamar))?.status).toBe(200);
    expect(vistos).toEqual([["compras-soltar", { ref: "evento-14nov" }]]);
    expect((await atenderAdmin(pedido(CUPONES, { body: "{}" }), env, cfg, llamar))?.status).toBe(401);
    expect((await atenderAdmin(pedido(OPERAR, { method: "GET" }), env, cfg, llamar))?.status).toBe(405);
  });
});
