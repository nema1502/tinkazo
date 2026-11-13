import { describe, expect, it } from "vitest";
import { IP } from "./altas-prueba";
import { COBROS, montarPagos } from "./cobros-prueba";
import { type Env, leerConfig } from "./config";
import { PorIp } from "./por-ip";
import { type AccionCompra, atenderAlta, atenderCarga, compraCerradaDe } from "./rutas-altas";

/**
 * Con la venta cerrada (el primer despliegue), las rutas de la compra con QR y el cupo de la carga contestan en la
 * puerta del Worker: no entran al objeto que paga los sellos y los sorteos, no le preguntan la sesión a Pollar y no
 * gastan el contador por dirección que comparte todo el stand. Anular sigue pasando: es la salida de lo que ya empezó.
 */

const BASE: Partial<Env> = { RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" };
/** Todo lo que pide la compra con QR para abrir. */
const ABIERTA: Partial<Env> = { ...BASE, ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, CARGAS: "1", COMPRAS_QR: "1" };
/** Cada forma de tenerla cerrada, con el motivo que contesta. */
const CERRADAS: Array<[Partial<Env>, string]> = [
  [{ COMPRAS_QR: "0" }, "compras-cerradas"],
  [{ CARGAS: "0" }, "compras-cerradas"],
  [{ ALTAS_PAGO: "0" }, "compras-cerradas"],
  [{ CUENTA_COBROS: "" }, "compras-cerradas"],
  [{ RECARGO_QR: "4,25:0,5" }, "compras-cerradas"],
  [{ POLLAR_FONDEO: "diferido" }, "fondeo-diferido"],
];

/** Un contador por dirección que dice cuántas veces se lo tocó. */
class PorIpQueCuenta extends PorIp {
  tocadas = 0;
  override toca(ip: string, tope: number): boolean {
    this.tocadas++;
    return super.toca(ip, tope);
  }
}

const pedido = (ruta: string, cuerpo = JSON.stringify({ producto: "alta" })) =>
  new Request(`https://pm.tinkazo.app${ruta}`, {
    method: "POST",
    headers: { Origin: "https://tinkazo.app", "CF-Connecting-IP": IP, Authorization: "Bearer tok_abc", "Content-Type": "application/json" },
    body: cuerpo,
  });
const nada = async () => ({ estado: 500, cuerpo: {} });

describe("la compra con QR cerrada, en la puerta del Worker", () => {
  it("empezar y cargar contestan 503 con su motivo sin entrar al objeto ni tocar el contador por dirección", async () => {
    for (const [env, motivo] of CERRADAS) {
      const cfg = leerConfig({ ...ABIERTA, ...env });
      expect(compraCerradaDe(cfg), JSON.stringify(env)).toBe(motivo);
      for (const accion of ["empezar", "cargar"] as const) {
        const vistos: string[] = [];
        const porIp = new PorIpQueCuenta();
        const r = (await atenderAlta(pedido(`/v1/compra/${accion}`), cfg, nada, porIp, nada, async (a: AccionCompra) => (vistos.push(a), { estado: 200, cuerpo: {} }))) as Response;
        expect([r.status, await r.json()], `${accion} ${JSON.stringify(env)}`).toEqual([503, { motivo }]);
        expect(vistos, accion).toEqual([]);
        expect(porIp.tocadas, accion).toBe(0);
      }
    }
  });

  it("anular pasa al objeto también con la venta cerrada; abierta, pasan las tres", async () => {
    const cerrada = leerConfig({ ...ABIERTA, COMPRAS_QR: "0", CARGAS: "0" });
    const vistos: string[] = [];
    const llamar = async (a: AccionCompra) => (vistos.push(a), { estado: 200, cuerpo: { visto: a } });
    expect((await atenderAlta(pedido("/v1/compra/anular"), cerrada, nada, new PorIp(), nada, llamar))?.status).toBe(200);
    expect(vistos).toEqual(["anular"]);
    const abierta = leerConfig(ABIERTA);
    expect(compraCerradaDe(abierta)).toBeNull();
    for (const a of ["empezar", "cargar", "anular"]) expect((await atenderAlta(pedido(`/v1/compra/${a}`), abierta, nada, new PorIp(), nada, llamar))?.status, a).toBe(200);
    expect(vistos).toEqual(["anular", "empezar", "cargar", "anular"]);
  });

  it("GET /v1/carga/cupo con la carga apagada dice cerrada sin consultar el objeto ni el contador; prendida, consulta", async () => {
    const get = () => new Request("https://pm.tinkazo.app/v1/carga/cupo", { method: "GET", headers: { "CF-Connecting-IP": IP } });
    let consultas = 0;
    const consultar = async () => (consultas++, true);
    for (const env of [{ CARGAS: "0" }, {}, { CARGAS: "true" }]) {
      const porIp = new PorIpQueCuenta();
      const r = (await atenderCarga(get(), leerConfig({ ...BASE, ...env }), porIp, consultar)) as Response;
      expect([r.status, await r.json()], JSON.stringify(env)).toEqual([200, { abierta: false }]);
      expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(porIp.tocadas).toBe(0);
    }
    expect(consultas).toBe(0);
    const r = (await atenderCarga(get(), leerConfig({ ...BASE, CARGAS: "1" }), new PorIp(), consultar)) as Response;
    expect(await r.json()).toEqual({ abierta: true });
    expect(consultas).toBe(1);
  });
});

describe("la compra con QR cerrada, en el objeto", () => {
  it("empezar y cargar no le preguntan la sesión a Pollar: contestan el motivo aunque el token no sirva", async () => {
    for (const [env, motivo] of CERRADAS) {
      const m = montarPagos({ CARGAS: "1", COMPRAS_QR: "1", ...env });
      const ana = m.persona("usr_ana");
      const antes = m.pm.llamadas.length;
      for (const token of [ana.token, null, "cualquiera"]) {
        expect(await m.empezar(token, "alta"), JSON.stringify(env)).toEqual({ estado: 503, cuerpo: { motivo } });
        expect(await m.cargar(token, "alta"), JSON.stringify(env)).toEqual({ estado: 503, cuerpo: { motivo } });
      }
      expect(m.pm.llamadas.slice(antes), JSON.stringify(env)).toEqual([]);
      expect(m.compras.tuvo("usr_ana")).toBe(false);
    }
  });

  it("anular sigue pidiendo la sesión con la venta cerrada", async () => {
    const m = montarPagos({ COMPRAS_QR: "0" });
    expect(await m.anular(null, "alta")).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
  });
});
