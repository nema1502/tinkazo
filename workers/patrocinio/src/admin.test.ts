import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { Administracion, TECHO_ALTAS_DIA, TECHO_SORTEOS_DIA, atenderAdmin, type AccionAdmin } from "./admin";
import { LOTE, SECRETO_CUPON, T0, codigo, montarAltas } from "./altas-prueba";
import { TECHO_CUPONES_DIA, mostrar } from "./altas";
import { DIA_MS, leerConfig } from "./config";

const OPERAR = "o".repeat(40);
const CUPONES = "k".repeat(40);
const VENCE = T0 + 30 * DIA_MS;

/** Un portero de mainnet con las altas y su administración, sobre el mismo SQLite que las rutas. */
function montar(env: Parameters<typeof montarAltas>[0] = {}, opciones: Parameters<typeof montarAltas>[1] = {}) {
  const m = montarAltas(env, opciones);
  const anotado: Array<[string, Record<string, string | number> | undefined]> = [];
  const admin = new Administracion({
    cfg: m.cfg,
    cupos: m.cupos,
    altas: m.altas,
    cuponSecreto: opciones.cuponSecreto === undefined ? SECRETO_CUPON : opciones.cuponSecreto,
    red: m.red,
    reloj: m.hora,
    registrar: (e, d) => void anotado.push([e, d]),
  });
  const crear = (codigos: unknown[], extra: Record<string, unknown> = {}) => admin.atender("cupones-crear", { lote: LOTE, codigos, sorteos: 3, dias: 60, vence: VENCE, usos: 1, ...extra });
  const admitir = (cuenta: string, extra: Record<string, unknown> = {}) => admin.atender("altas-admitir", { cuenta, sorteos: 20, dias: 60, ref: "pruebas-internas", ...extra });
  return { ...m, admin, adminAnotado: anotado, crear, admitir };
}

describe("los cupones por administración", () => {
  it("crea un lote con los códigos en claro, guarda solo la huella y el canje anda", async () => {
    const m = montar();
    expect(await m.crear([mostrar(codigo(1)), codigo(2).toLowerCase()])).toEqual({ estado: 200, cuerpo: { creados: 2, repetidos: 0 } });
    // Los códigos no quedan en ningún lado: solo sus huellas.
    const todo = JSON.stringify(m.sql.exec("SELECT * FROM cupones").toArray());
    expect(todo).not.toContain(codigo(1));
    expect(todo).not.toContain(codigo(2));
    const ana = m.persona("usr_ana");
    expect(await m.cupon(ana.token, codigo(1))).toMatchObject({ estado: 200, cuerpo: { ok: true, sorteosSumados: 3 } });
  });

  it("el mismo código otra vez es repetido; uno mal escrito rechaza el pedido entero", async () => {
    const m = montar();
    await m.crear([codigo(1)]);
    expect(await m.crear([codigo(1), codigo(2)])).toEqual({ estado: 200, cuerpo: { creados: 1, repetidos: 1 } });
    expect(await m.crear([codigo(3), "K7M2-9QXA-4HTU"])).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo", detalle: "codigo" } });
    expect(m.altas.estadoDelLote(LOTE)).toMatchObject({ creados: 2 });
    for (const malo of [{ codigos: [] }, { codigos: "x" }, { lote: "Con Mayúsculas" }, { sorteos: 0 }, { dias: 0 }, { vence: T0 - 1 }, { vence: "2026-12-14" }, { usos: 0 }]) {
      expect(await m.crear([codigo(4)], malo), JSON.stringify(malo)).toMatchObject({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(await m.crear(Array.from({ length: 501 }, (_, i) => codigo(1000 + i)))).toMatchObject({ estado: 400, cuerpo: { motivo: "cuerpo" } });
  });

  it(`el techo: ${TECHO_CUPONES_DIA} usos nuevos por día; al día siguiente se puede de nuevo`, async () => {
    const m = montar();
    // De un sorteo cada uno: con más, el techo de sorteos llega antes que el de usos.
    expect(await m.crear(Array.from({ length: 500 }, (_, i) => codigo(i)), { sorteos: 1 })).toEqual({ estado: 200, cuerpo: { creados: 500, repetidos: 0 } });
    expect(await m.crear([codigo(600)], { sorteos: 1 })).toEqual({ estado: 400, cuerpo: { motivo: "techo" } });
    m.mover(DIA_MS);
    expect((await m.crear([codigo(600)], { sorteos: 1 })).estado).toBe(200);
  });

  it("el techo de sorteos: cupones de 50 sorteos, uno por lote, se cortan a los 500 sorteos del día", async () => {
    const m = montar();
    for (let i = 0; i < 10; i++) expect((await m.crear([codigo(700 + i)], { lote: `venta-${i}`, sorteos: 50 })).estado).toBe(200);
    expect(await m.crear([codigo(710)], { lote: "venta-10", sorteos: 50 })).toEqual({ estado: 400, cuerpo: { motivo: "techo" } });
    expect(await m.crear([codigo(711)], { sorteos: 51 })).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
  });

  it("el estado de un lote, y 404 si no existe", async () => {
    const m = montar();
    await m.crear([codigo(1), codigo(2)]);
    await m.cupon(m.persona("usr_ana").token, codigo(1));
    expect(await m.admin.atender("cupones-estado", { lote: LOTE })).toEqual({
      estado: 200,
      cuerpo: { lote: LOTE, creados: 2, canjeados: 1, cuentas: 1, sorteosUsados: 0, vence: VENCE, anulado: false, anulados: 0 },
    });
    expect(await m.admin.atender("cupones-estado", { lote: "otro-lote" })).toEqual({ estado: 404, cuerpo: { motivo: "lote" } });
    expect(await m.admin.atender("cupones-estado", { lote: null })).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
  });

  it("anular un lote o un código: lo canjeado sigue, lo demás da cupon-anulado", async () => {
    const m = montar();
    await m.crear([codigo(1), codigo(2), codigo(3)]);
    const ana = m.persona("usr_ana");
    await m.cupon(ana.token, codigo(1));
    expect(await m.admin.atender("cupones-anular", { codigo: mostrar(codigo(2)) })).toEqual({ estado: 200, cuerpo: { anulados: 1 } });
    expect(await m.cupon(m.persona("usr_beto").token, codigo(2))).toEqual({ estado: 410, cuerpo: { motivo: "cupon-anulado" } });
    expect(await m.admin.atender("cupones-anular", { lote: LOTE })).toEqual({ estado: 200, cuerpo: { anulados: 2 } });
    expect(await m.cupon(m.persona("usr_eva").token, codigo(3))).toEqual({ estado: 410, cuerpo: { motivo: "cupon-anulado" } });
    expect(m.cupos.quedan({ cuenta: ana.cuenta as string }, m.hora()).quedan).toBe(3);
    for (const malo of [{}, { codigo: "xx" }, { lote: "Mal Escrito" }, { lote: LOTE, codigo: codigo(1) }]) {
      expect((await m.admin.atender("cupones-anular", malo)).estado, JSON.stringify(malo)).toBe(400);
    }
  });
});

describe("admitir una cuenta que ya existe", () => {
  it("la mete en el libro con sus sorteos, y la persona de esa billetera ve acceso admin", async () => {
    const m = montar();
    const nico = m.persona("usr_nico");
    const g = nico.cuenta as string;
    m.abiertas.add(g);
    expect(await m.admitir(g)).toEqual({ estado: 200, cuerpo: { ok: true, repetido: false, altaNueva: true, sorteos: { quedan: 20, proximoVence: { fecha: T0 + 60 * DIA_MS, cuantos: 20 } } } });
    expect(m.cupos.estaEnElLibro(g)).toBe(true);
    expect(m.cupos.altaDe(`cuenta:${g}`)).toMatchObject({ motivo: "admin", cuenta: g, estado: "abierta" });
    expect(await m.estado(nico.token)).toMatchObject({ estado: 200, cuerpo: { acceso: "admin", cuenta: g, abierta: true, sorteos: { quedan: 20 } } });
  });

  it("el mismo ref otra vez no suma; el mismo ref para otra cuenta da 409 sin escribir nada", async () => {
    const m = montar();
    const g = Keypair.random().publicKey();
    const otra = Keypair.random().publicKey();
    await m.admitir(g);
    expect(await m.admitir(g)).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: true, altaNueva: false, sorteos: { quedan: 20 } } });
    expect(await m.admitir(otra)).toEqual({ estado: 409, cuerpo: { motivo: "ref-usado" } });
    expect(m.cupos.estaEnElLibro(otra)).toBe(false);
    // Con otro ref suma.
    expect(await m.admitir(g, { ref: "otra-vez", sorteos: 5 })).toMatchObject({ estado: 200, cuerpo: { repetido: false, altaNueva: false, sorteos: { quedan: 25 } } });
  });

  it("una cuenta que ya es de una persona con cupón recibe los sorteos sin otra alta", async () => {
    const m = montar();
    await m.crear([codigo(1)]);
    const ana = m.persona("usr_ana");
    await m.cupon(ana.token, codigo(1));
    const g = ana.cuenta as string;
    expect(await m.admitir(g, { sorteos: 10 })).toMatchObject({ estado: 200, cuerpo: { ok: true, altaNueva: false, sorteos: { quedan: 13 } } });
    expect(m.cupos.altaDe(`cuenta:${g}`)).toBeNull();
    expect(await m.estado(ana.token)).toMatchObject({ cuerpo: { acceso: "cupon", sorteos: { quedan: 13 } } });
  });

  it("si la cuenta no existe en la red (o la red no contesta), queda autorizada y cuenta para el piso", async () => {
    const m = montar();
    const g = Keypair.random().publicKey();
    m.red.caida = true;
    expect((await m.admitir(g)).estado).toBe(200);
    expect(m.cupos.altaDe(`cuenta:${g}`)).toMatchObject({ estado: "autorizada" });
    expect(m.cupos.prometido(m.hora())).toEqual({ sorteos: 20, altas: 1 });
  });

  it(`los techos: ${TECHO_ALTAS_DIA} altas y ${TECHO_SORTEOS_DIA} sorteos dados por día`, async () => {
    const m = montar();
    for (let i = 0; i < 50; i++) expect((await m.admitir(Keypair.random().publicKey(), { ref: `r-${i}`, sorteos: 1 })).estado).toBe(200);
    const g = Keypair.random().publicKey();
    expect(await m.admitir(g, { ref: "r-50", sorteos: 1 })).toEqual({ estado: 400, cuerpo: { motivo: "techo", que: "altas" } });
    expect(m.cupos.estaEnElLibro(g)).toBe(false);
    m.mover(DIA_MS);
    const h = Keypair.random().publicKey();
    expect((await m.admitir(h, { ref: "s-1", sorteos: 500 })).estado).toBe(200);
    // Darle más a una cuenta que ya está en el libro no es un alta nueva, pero sí suma sorteos.
    expect(await m.admitir(h, { ref: "s-2", sorteos: 1 })).toEqual({ estado: 400, cuerpo: { motivo: "techo", que: "sorteos" } });
    expect(m.cupos.quedan({ cuenta: h }, m.hora()).quedan).toBe(500);
  });

  it("lo mal escrito da 400 sin escribir nada", async () => {
    const m = montar();
    const g = Keypair.random().publicKey();
    for (const malo of [{ cuenta: "GNOESUNACUENTA" }, { sorteos: 0 }, { sorteos: 501 }, { sorteos: 1.5 }, { dias: 0 }, { dias: 3651 }, { ref: "" }, { ref: "con espacios" }, { ref: "x".repeat(65) }]) {
      expect(await m.admitir(g, malo), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(m.cupos.estaEnElLibro(g)).toBe(false);
  });
});

describe("pausar y reanudar las altas", () => {
  it("pausadas, un canje nuevo da 503 sin gastar el cupón; reanudadas, pasa", async () => {
    const m = montar();
    await m.crear([codigo(1)]);
    const ana = m.persona("usr_ana");
    expect(await m.admin.atender("altas-pausar", {})).toEqual({ estado: 200, cuerpo: { pausadas: true } });
    expect(await m.cupon(ana.token, codigo(1))).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(await m.admin.atender("altas-reanudar", {})).toEqual({ estado: 200, cuerpo: { pausadas: false } });
    expect((await m.cupon(ana.token, codigo(1))).estado).toBe(200);
  });
});

describe("apagado", () => {
  it("con ALTAS=0 o en testnet, 503 apagado y no se escribe nada", async () => {
    for (const m of [montar({ ALTAS: "0" }), montar({ RED: "testnet" })]) {
      for (const accion of ["cupones-crear", "cupones-estado", "cupones-anular", "altas-admitir", "altas-pausar", "altas-reanudar"] as AccionAdmin[]) {
        expect(await m.admin.atender(accion, { lote: LOTE, codigos: [codigo(1)], sorteos: 3, dias: 60, vence: VENCE, usos: 1 }), accion).toEqual({ estado: 503, cuerpo: { motivo: "apagado" } });
      }
      expect(m.sql.exec("SELECT COUNT(*) AS n FROM cupones").toArray()[0]?.n).toBe(0);
    }
  });

  it("sin el secreto de los cupones, lo de cupones da 503 por la configuración; admitir y pausar siguen", async () => {
    const m = montar({}, { cuponSecreto: null });
    expect(await m.crear([codigo(1)])).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
    expect(await m.admin.atender("cupones-anular", { codigo: codigo(1) })).toEqual({ estado: 503, cuerpo: { motivo: "apagado", detalle: "config" } });
    expect((await m.admitir(Keypair.random().publicKey())).estado).toBe(200);
    expect((await m.admin.atender("altas-pausar", {})).estado).toBe(200);
  });
});

describe("estado y exportar", () => {
  it("el resumen suma las altas de 24 horas y los cupones de hoy", async () => {
    const m = montar();
    await m.crear([codigo(1), codigo(2), codigo(3)]);
    await m.cupon(m.persona("usr_ana").token, codigo(1));
    await m.cupon(m.persona("usr_beto").token, codigo(2));
    await m.admitir(Keypair.random().publicKey());
    expect(m.admin.resumen()).toEqual({ altas24h: 3, cuponesHoy: 2, cuponesCreadosHoy: 3 });
    m.mover(DIA_MS + 1);
    expect(m.admin.resumen()).toEqual({ altas24h: 0, cuponesHoy: 0, cuponesCreadosHoy: 0 });
    // Fuera de mainnet con altas, nada.
    expect(montar({ ALTAS: "0" }).admin.resumen()).toEqual({});
  });

  it("exportar suma las tablas nuevas solo cuando se le pide; sin pedirlo, lo de siempre", async () => {
    const m = montar();
    await m.crear([codigo(1)]);
    expect(Object.keys(m.cupos.exportar()).sort()).toEqual(["ajustes", "cuenta_app", "cuentas", "reserva", "uso"]);
    const todo = m.cupos.exportar(true);
    expect(Object.keys(todo).sort()).toEqual(["ajustes", "altas", "canjes", "consumos", "cuenta_app", "cuentas", "cupones", "derechos", "ordenes", "pagos", "pagos_sueltos", "reserva", "sellos_portero", "uso"]);
    expect(todo.cupones).toHaveLength(1);
    expect(JSON.stringify(todo)).not.toContain(codigo(1));
  });
});

describe("la puerta de administración del Worker (atenderAdmin)", () => {
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const env = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
  const pedido = (ruta: string, clave: string | null, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    if (clave) h.set("Authorization", `Bearer ${clave}`);
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: init.method ?? "POST", headers: h, body: init.body });
  };
  const espia = () => {
    const vistos: Array<[AccionAdmin, unknown]> = [];
    return { vistos, llamar: async (accion: AccionAdmin, datos: unknown) => (vistos.push([accion, datos]), { estado: 200, cuerpo: { visto: accion } }) };
  };
  const correr = async (req: Request, e = espia(), conf = cfg, entorno: Record<string, string | undefined> = env) => {
    const r = await atenderAdmin(req, entorno, conf, e.llamar);
    return r ? [r.status, await r.json()] : null;
  };

  it("en testnet no atiende: la ruta sigue sin existir, como hoy", async () => {
    const e = espia();
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: "{}" }), e, leerConfig({ RED: "testnet", ALTAS: "1" }))).toBeNull();
    expect(await correr(pedido("/v1/patrocinio/estado", OPERAR, { method: "GET" }), e)).toBeNull();
    expect(e.vistos).toHaveLength(0);
  });

  it("sin clave, 401; la clave de operar no crea cupones ni admite; la de cupones no pausa", async () => {
    const e = espia();
    expect(await correr(pedido("/v1/admin/cupones", null, { body: "{}" }), e)).toEqual([401, { motivo: "clave" }]);
    expect(await correr(pedido("/v1/admin/cupones", OPERAR, { body: "{}" }), e)).toEqual([401, { motivo: "clave" }]);
    expect(await correr(pedido("/v1/admin/altas", OPERAR, { body: "{}" }), e)).toEqual([401, { motivo: "clave" }]);
    expect(await correr(pedido("/v1/admin/cupones?lote=x", OPERAR, { method: "GET" }), e)).toEqual([401, { motivo: "clave" }]);
    expect(await correr(pedido("/v1/admin/altas/pausar", CUPONES), e)).toEqual([401, { motivo: "clave" }]);
    expect(await correr(pedido("/v1/admin/cupones", CUPONES.slice(1), { body: "{}" }), e)).toEqual([401, { motivo: "clave" }]);
    expect(e.vistos).toHaveLength(0);
  });

  it("cada ruta con su clave llega al objeto con su acción y sus datos", async () => {
    const e = espia();
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: JSON.stringify({ lote: LOTE }) }), e)).toEqual([200, { visto: "cupones-crear" }]);
    await correr(pedido(`/v1/admin/cupones?lote=${LOTE}`, CUPONES, { method: "GET" }), e);
    await correr(pedido("/v1/admin/cupones/anular", CUPONES, { body: JSON.stringify({ lote: LOTE }) }), e);
    await correr(pedido("/v1/admin/altas", CUPONES, { body: JSON.stringify({ cuenta: "G" }) }), e);
    await correr(pedido("/v1/admin/altas/pausar", OPERAR), e);
    await correr(pedido("/v1/admin/altas/reanudar", OPERAR), e);
    expect(e.vistos).toEqual([
      ["cupones-crear", { lote: LOTE }],
      ["cupones-estado", { lote: LOTE }],
      ["cupones-anular", { lote: LOTE }],
      ["altas-admitir", { cuenta: "G" }],
      ["altas-pausar", {}],
      ["altas-reanudar", {}],
    ]);
  });

  it("sin la clave cargada (o corta) la ruta no existe; con las dos claves iguales, lo de cupones no se atiende", async () => {
    const e = espia();
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: "{}" }), e, cfg, { ADMIN_TOKEN: OPERAR })).toEqual([404, { motivo: "no-existe" }]);
    expect(await correr(pedido("/v1/admin/cupones", "corta", { body: "{}" }), e, cfg, { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: "corta" })).toEqual([404, { motivo: "no-existe" }]);
    expect(await correr(pedido("/v1/admin/altas/pausar", OPERAR), e, cfg, { CUPONES_TOKEN: CUPONES })).toEqual([404, { motivo: "no-existe" }]);
    expect(await correr(pedido("/v1/admin/cupones", OPERAR, { body: "{}" }), e, cfg, { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: OPERAR })).toEqual([503, { motivo: "apagado", detalle: "claves-iguales" }]);
    expect(e.vistos).toHaveLength(0);
  });

  it("método, ruta, cuerpo y tamaño", async () => {
    const e = espia();
    expect(await correr(pedido("/v1/admin/cupones/anular", CUPONES, { method: "GET" }), e)).toEqual([405, { motivo: "metodo" }]);
    expect(await correr(pedido("/v1/admin/altas/pausar", OPERAR, { method: "GET" }), e)).toEqual([405, { motivo: "metodo" }]);
    expect(await correr(pedido("/v1/admin/otra", CUPONES, { body: "{}" }), e)).toEqual([404, { motivo: "no-existe" }]);
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: "no es json" }), e)).toEqual([400, { motivo: "cuerpo" }]);
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: "[1]" }), e)).toEqual([400, { motivo: "cuerpo" }]);
    expect(await correr(pedido("/v1/admin/cupones", CUPONES, { body: JSON.stringify({ x: "y".repeat(70_000) }) }), e)).toEqual([400, { motivo: "cuerpo" }]);
    expect(e.vistos).toHaveLength(0);
    expect(
      await correr(pedido("/v1/admin/altas/pausar", OPERAR), {
        vistos: [],
        llamar: async () => {
          throw new Error("algo");
        },
      }),
    ).toEqual([500, { motivo: "interno" }]);
  });
});
