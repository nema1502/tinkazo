import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { atenderAdmin } from "./admin";
import { montarPagos } from "./cobros-prueba";
import { TECHO_PILOTO } from "./compras";
import { DIA_MS, type Env, leerConfig } from "./config";

/**
 * La lista del piloto de la compra con QR: vive en el portero, no en el sitio. Por la variable `COMPRAS_QR_PILOTO` y por
 * la ruta de administración con la clave de cupones (`cupones.mjs piloto`). Sacar a alguien frena lo nuevo, nunca lo
 * que ya tiene en camino.
 */

const montar = (env: Partial<Env> = {}) => montarPagos({ COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5", ...env });

describe("la lista del piloto por administración", () => {
  it("sumar, repetir, listar y sacar; la bitácora dice cuántas, nunca la cuenta", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    const g = ana.cuenta as string;
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: g, accion: "sumar" })).toEqual({ estado: 200, cuerpo: { ok: true, cuenta: g, enLista: true, cambio: true, total: 1 } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: g, accion: "sumar" })).toEqual({ estado: 200, cuerpo: { ok: true, cuenta: g, enLista: true, cambio: false, total: 1 } });
    expect(await m.admin.atender("piloto-lista", {})).toEqual({ estado: 200, cuerpo: { cuentas: [{ cuenta: g, desde: m.hora() }], variable: [], total: 1 } });
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect(await m.admin.atender("piloto-cambiar", { cuenta: g, accion: "sacar" })).toEqual({ estado: 200, cuerpo: { ok: true, cuenta: g, enLista: false, cambio: true, total: 0 } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: g, accion: "sacar" })).toMatchObject({ estado: 200, cuerpo: { cambio: false } });
    expect(m.adminAnotadoDe("admin-piloto")).toEqual([
      ["admin-piloto", { accion: "sumar", total: 1 }],
      ["admin-piloto", { accion: "sacar", total: 0 }],
    ]);
    expect(JSON.stringify(m.anotado)).not.toContain(g);
  });

  it("sacar a alguien frena lo nuevo y no lo que ya está en camino: su orden con recargo sale igual", async () => {
    const m = montar();
    const ana = m.persona("usr_ana");
    await m.admin.atender("piloto-cambiar", { cuenta: ana.cuenta, accion: "sumar" });
    await m.empezar(ana.token, "alta");
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    await m.admin.atender("piloto-cambiar", { cuenta: ana.cuenta, accion: "sacar" });
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "6.25", recargo: "4.25" } } });
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ compraQr: { puede: false, motivo: "fuera-del-piloto", abierta: { producto: "alta", cargada: true }, terminar: true } });
  });

  it("lo mal escrito no se toma, y el techo frena una cuenta más", async () => {
    const m = montar();
    for (const malo of [{ cuenta: "GNOESUNACUENTA", accion: "sumar" }, { cuenta: Keypair.random().publicKey(), accion: "borrar" }, { accion: "sumar" }, {}]) {
      expect(await m.admin.atender("piloto-cambiar", malo), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    for (let i = 0; i < TECHO_PILOTO; i++) expect((await m.admin.atender("piloto-cambiar", { cuenta: Keypair.random().publicKey(), accion: "sumar" })).estado).toBe(200);
    expect(await m.admin.atender("piloto-cambiar", { cuenta: Keypair.random().publicKey(), accion: "sumar" })).toEqual({ estado: 400, cuerpo: { motivo: "techo", que: "piloto", max: TECHO_PILOTO } });
    expect(m.compras.piloto()).toHaveLength(TECHO_PILOTO);
  });

  it("con las altas apagadas no hay administración del piloto", async () => {
    const m = montar({ ALTAS: "0" });
    expect(await m.admin.atender("piloto-lista", {})).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
  });
});

describe("la lista del piloto por variable", () => {
  it("las cuentas de COMPRAS_QR_PILOTO entran sin la ruta, se listan aparte y la ruta no las saca", async () => {
    const g = Keypair.random().publicKey();
    const m = montar({ COMPRAS_QR_PILOTO: g });
    const ana = m.persona("usr_ana", g);
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect(await m.admin.atender("piloto-lista", {})).toEqual({ estado: 200, cuerpo: { cuentas: [], variable: [g], total: 1 } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: g, accion: "sacar" })).toEqual({ estado: 200, cuerpo: { ok: true, cuenta: g, enLista: true, cambio: false, total: 1 } });
    // Con la variable mal escrita no entra nadie: la compra entera queda cerrada (compras-piloto-dos.test.ts).
    const mal = montar({ COMPRAS_QR_PILOTO: `${g},otra` });
    const beto = mal.persona("usr_beto", g);
    expect(await mal.empezar(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
  });
});

describe("abierta a todos: COMPRAS_QR_PILOTO = todos", () => {
  it("cualquier cuenta empieza sin estar en la lista: fuera-del-piloto no aparece y el freno es tope-del-dia", async () => {
    const m = montar({ COMPRAS_QR_PILOTO: "todos", COMPRAS_QR_TODOS: "1", COMPRAS_QR_DIA: "2" });
    const [ana, beto, caro] = ["usr_ana", "usr_beto", "usr_caro"].map((u) => m.persona(u));
    expect(m.compras.piloto()).toEqual([]);
    expect((await m.estado(ana!.token)).cuerpo).toMatchObject({ compraQr: { puede: true, motivo: null } });
    expect((await m.empezar(ana!.token, "alta")).estado).toBe(200);
    expect((await m.cargar(ana!.token, "alta")).estado).toBe(200);
    expect((await m.empezar(beto!.token, "p10")).estado).toBe(200);
    // La tercera persona nueva del día: el tope, no la lista.
    expect(await m.empezar(caro!.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
    expect((await m.estado(caro!.token)).cuerpo).toMatchObject({ compraQr: { puede: false, motivo: "tope-del-dia" } });
    // Sin billetera no hay compra: termina en un pago desde la cuenta de la persona.
    const sinCuenta = m.persona("usr_nora", null);
    expect(await m.empezar(sinCuenta.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    // Al otro día, hay lugar.
    m.mover(DIA_MS);
    expect((await m.empezar(caro!.token, "alta")).estado).toBe(200);
  });

  it("la lista dice que está abierta a todos, y sacar a alguien no lo frena", async () => {
    const m = montar({ COMPRAS_QR_PILOTO: "todos", COMPRAS_QR_TODOS: "1" });
    const ana = m.persona("usr_ana");
    expect(await m.admin.atender("piloto-lista", {})).toEqual({ estado: 200, cuerpo: { cuentas: [], variable: [], total: 0, todos: true } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: ana.cuenta, accion: "sumar" })).toMatchObject({ estado: 200, cuerpo: { enLista: true, cambio: true, todos: true } });
    expect(await m.admin.atender("piloto-cambiar", { cuenta: ana.cuenta, accion: "sacar" })).toEqual({ estado: 200, cuerpo: { ok: true, cuenta: ana.cuenta, enLista: true, cambio: true, total: 0, todos: true } });
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    // Sin todos, la respuesta es la de siempre.
    expect(await montar().admin.atender("piloto-lista", {})).toEqual({ estado: 200, cuerpo: { cuentas: [], variable: [], total: 0 } });
  });

  it("con una cuenta mal escrita junto a todos, la compra con QR no se abre a nadie por la variable", async () => {
    const m = montar({ COMPRAS_QR_PILOTO: "todos,GNOESUNACUENTA", COMPRAS_QR_TODOS: "1" });
    const ana = m.persona("usr_ana");
    // La compra entera queda cerrada (compras-piloto-dos.test.ts).
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
    expect(await m.admin.atender("piloto-lista", {})).toEqual({ estado: 200, cuerpo: { cuentas: [], variable: [], total: 0 } });
  });
});

describe("la ruta del Worker", () => {
  const CUPONES = "c".repeat(40);
  const OPERAR = "o".repeat(40);
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const env = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
  const pedido = (clave: string, init: RequestInit = {}) =>
    new Request("https://pm.tinkazo.app/v1/admin/compras/piloto", { method: init.method ?? "POST", headers: { Authorization: `Bearer ${clave}` }, body: init.body });

  it("POST cambia y GET lista, con la clave de cupones; con la de operar, 401", async () => {
    const vistos: Array<[string, unknown]> = [];
    const llamar = async (accion: string, datos: unknown) => (vistos.push([accion, datos]), { estado: 200, cuerpo: { ok: true } });
    const g = Keypair.random().publicKey();
    expect((await atenderAdmin(pedido(CUPONES, { body: JSON.stringify({ cuenta: g, accion: "sumar" }) }), env, cfg, llamar))?.status).toBe(200);
    expect((await atenderAdmin(pedido(CUPONES, { method: "GET" }), env, cfg, llamar))?.status).toBe(200);
    expect(vistos.map(([a]) => a)).toEqual(["piloto-cambiar", "piloto-lista"]);
    expect(vistos[0]?.[1]).toEqual({ cuenta: g, accion: "sumar" });
    expect((await atenderAdmin(pedido(OPERAR, { body: "{}" }), env, cfg, llamar))?.status).toBe(401);
    expect((await atenderAdmin(pedido(CUPONES, { method: "PUT", body: "{}" }), env, cfg, llamar))?.status).toBe(405);
  });
});
