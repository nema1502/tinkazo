import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { type AccionAdmin, TECHO_SORTEOS_DIA, atenderAdmin } from "./admin";
import { IP } from "./altas-prueba";
import { AJUSTE_VENTA_PAUSADA } from "./cobros";
import { IDS, montarPagos } from "./cobros-prueba";
import { DIA_MS, leerConfig } from "./config";
import { PorIp } from "./por-ip";
import { atenderAlta } from "./rutas-altas";

const ID = IDS[0] as string;
const NOTA = `tk:o:${ID}`;

async function conOrden(m: ReturnType<typeof montarPagos>, usuario = "usr_ana", producto = "alta") {
  const p = m.persona(usuario);
  const r = await m.orden(p.token, producto);
  expect(r.estado).toBe(200);
  return { ...p, id: (r.cuerpo as { orden: { id: string } }).orden.id };
}

describe("dar sorteos a mano (POST /v1/admin/derechos)", () => {
  it("a una cuenta del libro le suma sus sorteos; el mismo ref otra vez no suma; fuera del libro, 409", async () => {
    const m = montarPagos();
    const g = Keypair.random().publicKey();
    expect(await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 10, dias: 365, ref: "venta-qr-0001" })).toEqual({ estado: 409, cuerpo: { motivo: "fuera-del-libro" } });
    expect((await m.admin.atender("altas-admitir", { cuenta: g, sorteos: 3, dias: 60, ref: "alta-1" })).estado).toBe(200);
    expect(await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 10, dias: 365, ref: "venta-qr-0001" })).toEqual({
      estado: 200,
      cuerpo: { ok: true, repetido: false, sorteos: { quedan: 13, proximoVence: { fecha: m.hora() + 60 * DIA_MS, cuantos: 3 } } },
    });
    expect(await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 10, dias: 365, ref: "venta-qr-0001" })).toMatchObject({ estado: 200, cuerpo: { ok: true, repetido: true, sorteos: { quedan: 13 } } });
    const otra = Keypair.random().publicKey();
    await m.admin.atender("altas-admitir", { cuenta: otra, sorteos: 3, dias: 60, ref: "alta-2" });
    expect(await m.admin.atender("derechos-dar", { cuenta: otra, sorteos: 10, dias: 365, ref: "venta-qr-0001" })).toEqual({ estado: 409, cuerpo: { motivo: "ref-usado" } });
    for (const malo of [{ cuenta: "G" }, { sorteos: 0 }, { sorteos: TECHO_SORTEOS_DIA + 1 }, { dias: 0 }, { ref: "con espacios" }, { ref: "" }]) {
      expect(await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 1, dias: 1, ref: "r", ...malo }), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
    expect(m.adminAnotadoDe("admin-derechos")).toHaveLength(1);
  });

  it(`el techo de ${TECHO_SORTEOS_DIA} sorteos dados por día vale también acá`, async () => {
    const m = montarPagos();
    const g = Keypair.random().publicKey();
    await m.admin.atender("altas-admitir", { cuenta: g, sorteos: 400, dias: 60, ref: "alta-1" });
    expect(await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 101, dias: 365, ref: "mucho" })).toEqual({ estado: 400, cuerpo: { motivo: "techo", que: "sorteos" } });
    expect((await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 100, dias: 365, ref: "justo" })).estado).toBe(200);
    m.mover(DIA_MS);
    expect((await m.admin.atender("derechos-dar", { cuenta: g, sorteos: 101, dias: 365, ref: "mucho" })).estado).toBe(200);
  });
});

describe("una orden pagada a mano (POST /v1/admin/ordenes/pagada)", () => {
  it("la marca pagada y da lo mismo que un pago en USDC; otra vez es repetido; la persona la ve pagada", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    expect(await m.admin.atender("ordenes-pagada", { orden: ID, metodo: "qr-bs", ref: "comprobante-0001" })).toEqual({ estado: 200, cuerpo: { ok: true, repetido: false } });
    expect(m.cobros.orden(ID)).toMatchObject({ metodo: "qr-bs", ref: "qr-bs:comprobante-0001" });
    expect(await m.admin.atender("ordenes-pagada", { orden: ID.toLowerCase(), metodo: "qr-bs", ref: "comprobante-0001" })).toEqual({ estado: 200, cuerpo: { ok: true, repetido: true } });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(m.cupos.altaDe("usr_ana")).toMatchObject({ motivo: "pago" });
    expect(m.adminAnotadoDe("admin-pagada")).toEqual([["admin-pagada", { metodo: "qr-bs", producto: "alta" }]]);
  });

  it("una orden que no existe es 404; un método o un ref raros, 400", async () => {
    const m = montarPagos();
    await conOrden(m);
    expect(await m.admin.atender("ordenes-pagada", { orden: "ZZZZ9999", metodo: "a-mano", ref: "x" })).toEqual({ estado: 404, cuerpo: { motivo: "orden" } });
    for (const malo of [{ orden: "no" }, { metodo: "usdc" }, { metodo: "efectivo" }, { ref: "" }, { ref: "con espacio" }]) {
      expect(await m.admin.atender("ordenes-pagada", { orden: ID, metodo: "a-mano", ref: "x", ...malo }), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
  });

  it("cuenta para el techo de sorteos dados por día (una clave filtrada no regala paquetes)", async () => {
    const m = montarPagos();
    const g = Keypair.random().publicKey();
    await m.admin.atender("altas-admitir", { cuenta: g, sorteos: 460, dias: 60, ref: "alta-1" });
    await conOrden(m, "usr_ana", "p50");
    expect(await m.admin.atender("ordenes-pagada", { orden: ID, metodo: "a-mano", ref: "x" })).toEqual({ estado: 400, cuerpo: { motivo: "techo", que: "sorteos" } });
    expect(m.cobros.orden(ID)?.pagada).toBeNull();
  });
});

describe("las órdenes pagadas a medias", () => {
  it("la lista de sueltos lee antes los pagos nuevos y suma las órdenes pagadas a medias, también vencidas, sin la persona", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    await conOrden(m, "usr_beto");
    // Nadie tocó «Ya pagué»: el pago a medias lo lee la propia lista.
    m.h.sumar({ monto: "1.5000000", nota: NOTA });
    m.mover(4 * DIA_MS);
    const r = await m.admin.atender("sueltos-lista", {});
    expect(r).toEqual({
      estado: 200,
      cuerpo: { sueltos: [], parciales: [{ id: ID, producto: "alta", recibido: "1.5", total: "2", minimo: "1.9", creada: m.hora() - 4 * DIA_MS, vence: m.hora() - 4 * DIA_MS + 72 * 3_600_000, vencida: true }] },
    });
    expect(JSON.stringify(r.cuerpo)).not.toContain("usr_ana");
    // Marcada pagada a mano, sale de la lista.
    expect(await m.admin.atender("ordenes-pagada", { orden: ID, metodo: "a-mano", ref: "completo-0001" })).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    expect((await m.admin.atender("sueltos-lista", {})).cuerpo).toEqual({ sueltos: [] });
    expect(ana.id).toBe(ID);
  });

  it("con Horizon caído, la lista sale igual con lo que ya se sabía y lo dice", async () => {
    const m = montarPagos();
    await conOrden(m);
    m.h.estado.caido = true;
    expect(await m.admin.atender("sueltos-lista", {})).toEqual({ estado: 200, cuerpo: { sueltos: [], horizon: false } });
  });
});

describe("los pagos sueltos", () => {
  it("se listan, se asignan a una orden (que queda pagada) o se marcan devueltos; nada se resuelve dos veces", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const [sinNota, otroActivo, chico] = m.h.sumar({ monto: "2.0000000" }, { monto: "5.0000000", nativo: true }, { monto: "0.1000000", nota: "tk:o:ZZZZ9999" });
    await m.pago(ana.token, ana.id);
    expect(await m.admin.atender("sueltos-lista", {})).toEqual({
      estado: 200,
      cuerpo: {
        sueltos: [
          expect.objectContaining({ operacion: sinNota, activo: "USDC", monto: 20_000_000, cantidad: "2", motivo: "sin-nota", estado: "suelto", nota: null }),
          expect.objectContaining({ operacion: otroActivo, activo: "XLM", motivo: "otro-activo" }),
          expect.objectContaining({ operacion: chico, motivo: "nota-desconocida", nota: "tk:o:ZZZZ9999" }),
        ],
      },
    });
    // El que vino sin nota es el de Ana: se asigna y la orden queda pagada.
    expect(await m.admin.atender("sueltos-asignar", { operacion: sinNota, orden: ID })).toEqual({ estado: 200, cuerpo: { ok: true, pagada: true, sobrante: "0" } });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(await m.admin.atender("sueltos-asignar", { operacion: sinNota, orden: ID })).toEqual({ estado: 409, cuerpo: { motivo: "ya-resuelto", estado: "asignado" } });
    // Lo que no es USDC no se asigna: se devuelve.
    expect(await m.admin.atender("sueltos-asignar", { operacion: otroActivo, orden: ID })).toEqual({ estado: 409, cuerpo: { motivo: "no-asignable" } });
    expect(await m.admin.atender("sueltos-asignar", { operacion: otroActivo, devuelto: true, ref: "devolucion-0001" })).toEqual({ estado: 200, cuerpo: { ok: true, repetido: false } });
    expect(await m.admin.atender("sueltos-asignar", { operacion: otroActivo, devuelto: true, ref: "devolucion-0001" })).toEqual({ estado: 200, cuerpo: { ok: true, repetido: true } });
    // Uno chico asignado a una orden ya pagada no alcanza para otro paquete: queda como sobrante de esa orden.
    expect(await m.admin.atender("sueltos-asignar", { operacion: chico, orden: ID })).toEqual({ estado: 200, cuerpo: { ok: true, pagada: true, sobrante: "0.1" } });
    expect((await m.admin.atender("sueltos-lista", {})).cuerpo).toEqual({ sueltos: [expect.objectContaining({ operacion: chico, motivo: "sobrante", orden: ID, estado: "suelto" })] });
    expect(await m.admin.atender("sueltos-asignar", { operacion: chico, orden: ID })).toEqual({ estado: 409, cuerpo: { motivo: "no-asignable" } });
    // Lo que no existe, y lo mal escrito.
    expect(await m.admin.atender("sueltos-asignar", { operacion: "1", orden: ID })).toEqual({ estado: 404, cuerpo: { motivo: "suelto" } });
    expect(await m.admin.atender("sueltos-asignar", { operacion: chico, orden: "ZZZZ8888" })).toEqual({ estado: 409, cuerpo: { motivo: "no-asignable" } });
    for (const malo of [{}, { operacion: 123, orden: ID }, { operacion: chico }, { operacion: chico, devuelto: true }, { operacion: chico, orden: ID, devuelto: true, ref: "x" }]) {
      expect(await m.admin.atender("sueltos-asignar", malo), JSON.stringify(malo)).toEqual({ estado: 400, cuerpo: { motivo: "cuerpo" } });
    }
  });

  it("asignar a una orden que no existe es 404, sin tocar el suelto", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const [op] = m.h.sumar({ monto: "2.0000000" });
    await m.pago(ana.token, ana.id);
    expect(await m.admin.atender("sueltos-asignar", { operacion: op, orden: "ZZZZ8888" })).toEqual({ estado: 404, cuerpo: { motivo: "orden" } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, estado: "suelto" })]);
  });

  it("asignar de más deja el resto como sobrante de esa orden", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    const [op] = m.h.sumar({ monto: "3.0000000", nota: "sin prefijo" });
    await m.pago(ana.token, ana.id);
    expect(await m.admin.atender("sueltos-asignar", { operacion: op, orden: ID })).toEqual({ estado: 200, cuerpo: { ok: true, pagada: true, sobrante: "1" } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, monto: 10_000_000, motivo: "sobrante", orden: ID, estado: "suelto" })]);
    expect(m.filasDePagos()).toEqual([{ operacion: op, orden: ID, monto: 20_000_000 }]);
  });
});

describe("la venta pausada, a mano (POST /v1/admin/ventas/pausar y reanudar)", () => {
  it("pausa y reanuda las órdenes nuevas", async () => {
    const m = montarPagos();
    expect(await m.admin.atender("ventas-pausar", {})).toEqual({ estado: 200, cuerpo: { ventaPausada: true } });
    expect(m.cupos.ajuste(AJUSTE_VENTA_PAUSADA)).toBe("1");
    const ana = m.persona("usr_ana");
    expect(await m.orden(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    expect(await m.admin.atender("ventas-reanudar", {})).toEqual({ estado: 200, cuerpo: { ventaPausada: false } });
    expect((await m.orden(ana.token, "p10")).estado).toBe(200);
  });

  it("/estado suma los pagos sueltos sin resolver y la venta pausada", async () => {
    const m = montarPagos();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "2.0000000" });
    await m.pago(ana.token, ana.id);
    expect(m.admin.resumen()).toMatchObject({ pagosSueltos: 1, ventaPausada: false });
  });
});

describe("las rutas de administración de los pagos en el Worker", () => {
  const OPERAR = "o".repeat(40);
  const CUPONES = "k".repeat(40);
  const conf = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app" });
  const entorno = { ADMIN_TOKEN: OPERAR, CUPONES_TOKEN: CUPONES };
  const pedido = (ruta: string, clave: string, metodo = "POST", cuerpo: unknown = {}) =>
    new Request(`https://pm.tinkazo.app${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${clave}` }, ...(metodo === "GET" ? {} : { body: JSON.stringify(cuerpo) }) });
  const espia = () => {
    const vistos: Array<[AccionAdmin, unknown]> = [];
    return { vistos, llamar: async (accion: AccionAdmin, datos: unknown) => (vistos.push([accion, datos]), { estado: 200, cuerpo: { visto: accion } }) };
  };

  it("cada ruta con su clave y su acción; la clave de operar no da sorteos ni marca pagos, la de cupones no pausa la venta", async () => {
    const casos: Array<[string, string, "cupones" | "operar", AccionAdmin]> = [
      ["/v1/admin/derechos", "POST", "cupones", "derechos-dar"],
      ["/v1/admin/ordenes/pagada", "POST", "cupones", "ordenes-pagada"],
      ["/v1/admin/sueltos", "GET", "cupones", "sueltos-lista"],
      ["/v1/admin/sueltos/asignar", "POST", "cupones", "sueltos-asignar"],
      ["/v1/admin/ventas/pausar", "POST", "operar", "ventas-pausar"],
      ["/v1/admin/ventas/reanudar", "POST", "operar", "ventas-reanudar"],
    ];
    for (const [ruta, metodo, clave, accion] of casos) {
      const e = espia();
      const buena = clave === "cupones" ? CUPONES : OPERAR;
      const mala = clave === "cupones" ? OPERAR : CUPONES;
      expect((await atenderAdmin(pedido(ruta, mala, metodo), entorno, conf, e.llamar))?.status, `${ruta} con la otra clave`).toBe(401);
      const r = (await atenderAdmin(pedido(ruta, buena, metodo), entorno, conf, e.llamar)) as Response;
      expect(r.status, ruta).toBe(200);
      expect(e.vistos.map(([a]) => a)).toEqual([accion]);
    }
  });
});

describe("las rutas de los pagos en la puerta del Worker", () => {
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", ALTAS_PAGO: "1", POLLAR_APP_ID: "app", CUENTA_COBROS: Keypair.random().publicKey() });
  const pedido = (ruta: string, init: RequestInit & { origen?: string | null } = {}) => {
    const h = new Headers(init.headers);
    if (init.origen !== null) h.set("Origin", init.origen ?? "https://tinkazo.app");
    h.set("CF-Connecting-IP", IP);
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: init.method ?? "POST", headers: h, body: init.body });
  };
  const nada = async () => ({ estado: 500, cuerpo: {} });

  it("GET /v1/alta/precios es abierta, con caché de 5 minutos, y dice los productos", async () => {
    const r = (await atenderAlta(pedido("/v1/alta/precios", { method: "GET", origen: null }), cfg, nada, new PorIp(), nada)) as Response;
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await r.json()).toEqual({
      red: "mainnet",
      pago: true,
      alta: { usdc: "2", sorteos: 3, dias: 365 },
      paquetes: [
        { id: "p10", usdc: "5", sorteos: 10, dias: 365 },
        { id: "p50", usdc: "20", sorteos: 50, dias: 365 },
      ],
    });
    const sinPago = (await atenderAlta(pedido("/v1/alta/precios", { method: "GET" }), leerConfig({ RED: "mainnet", ALTAS: "1" }), nada, new PorIp(), nada)) as Response;
    expect(await sinPago.json()).toMatchObject({ pago: false });
    expect((await atenderAlta(pedido("/v1/alta/precios", { method: "POST" }), cfg, nada, new PorIp(), nada))?.status).toBe(405);
    expect((await atenderAlta(pedido("/v1/alta/precios", { method: "GET" }), leerConfig({ RED: "mainnet", ALTAS: "0" }), nada, new PorIp(), nada))?.status).toBe(503);
    expect(await atenderAlta(pedido("/v1/alta/precios", { method: "GET" }), leerConfig({ RED: "testnet", ALTAS: "1" }), nada, new PorIp(), nada)).toBeNull();
  });

  it("POST /v1/alta/orden y /v1/alta/pago pasan al objeto con el token y el cuerpo; sin quien los atienda, no existen", async () => {
    const vistos: Array<[string, unknown]> = [];
    const llamarPago = async (accion: "orden" | "pago", p: { token: string | null; cuerpo: unknown }) => (vistos.push([accion, { token: p.token, cuerpo: p.cuerpo }]), { estado: 200, cuerpo: { visto: accion } });
    const h = { Authorization: "Bearer tok_abc", "Content-Type": "application/json" };
    expect((await atenderAlta(pedido("/v1/alta/orden", { headers: h, body: JSON.stringify({ producto: "alta" }) }), cfg, nada, new PorIp(), llamarPago))?.status).toBe(200);
    expect((await atenderAlta(pedido("/v1/alta/pago", { headers: h, body: JSON.stringify({ orden: ID }) }), cfg, nada, new PorIp(), llamarPago))?.status).toBe(200);
    expect(vistos).toEqual([
      ["orden", { token: "tok_abc", cuerpo: { producto: "alta" } }],
      ["pago", { token: "tok_abc", cuerpo: { orden: ID } }],
    ]);
    const sinPago = (await atenderAlta(pedido("/v1/alta/orden", { headers: h, body: "{}" }), cfg, nada, new PorIp())) as Response;
    expect([sinPago.status, await sinPago.json()]).toEqual([404, { motivo: "no-existe" }]);
    expect((await atenderAlta(pedido("/v1/alta/pago", { method: "GET" }), cfg, nada, new PorIp(), llamarPago))?.status).toBe(405);
    expect((await atenderAlta(pedido("/v1/alta/orden", { body: "{}", origen: "https://otro.example" }), cfg, nada, new PorIp(), llamarPago))?.status).toBe(403);
  });

  it("la nota del pago que muestra el sitio es la de la orden", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    const r = await m.orden(ana.token, "alta");
    expect((r.cuerpo as { orden: { nota: string } }).orden.nota).toBe(NOTA);
  });
});
