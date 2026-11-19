import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IP, codigo } from "./altas-prueba";
import { AJUSTE_VENTA_PAUSADA, GRACIA_REEMPLAZO_MS, ORDEN_VIVE_MS } from "./cobros";
import { COBROS, IDS, montarPagos } from "./cobros-prueba";
import { PERMISO_RESERVA_MS, RESERVA_SIN_CARGAR_MS } from "./compras";
import { DIA_MS, type Env, leerConfig } from "./config";
import { PorIp } from "./por-ip";
import { AJUSTE_PAUSA, AVISO_ESPERA_MS, type AccionCompra, atenderAlta } from "./rutas-altas";

/**
 * La compra de un paquete pagando con QR en el portero: el permiso de empezar (en vivo, con el piloto, el tope de
 * personas nuevas del día y la reserva de créditos), el aviso de carga que ata el recargo a la persona, el permiso de
 * terminar y el recargo en la orden. Precios de prueba: el primer paquete a 2 USDC con 3 sorteos y el de diez a 5. El
 * recargo, el de la oferta: 4,25 la primera vez y 0,50 las siguientes.
 */

/** La compra con QR abierta, con lugar para cinco personas nuevas por día. */
const ABIERTA: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "5" };
const montar = (env: Partial<Env> = {}) => montarPagos({ ...ABIERTA, ...env });
type M = ReturnType<typeof montar>;

/** Una persona con su billetera y en la lista del piloto. */
function enPiloto(m: M, usuario: string) {
  const p = m.persona(usuario);
  m.cupos.transaccion(() => m.compras.sumarPiloto(p.cuenta as string, m.hora()));
  return p;
}

/** La reserva del primer paquete la primera vez: 380 de la carga, 3 sorteos por 40 y la activación, 30. */
const RESERVA_ALTA = 380 + 3 * 40 + 30;
/** Lo que tiene que haber para el primer permiso: el piso de base (300), la reserva de la carga (400) y la del permiso. */
const UMBRAL = 300 + 400 + RESERVA_ALTA;

const filasDeCompras = (m: M) => Number(m.sql.exec("SELECT COUNT(*) AS n FROM compras_qr").toArray()[0]?.n ?? 0);
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;

describe("el permiso de empezar", () => {
  it("con todo en orden da el permiso con su recargo y su total, lo anota con su hora y reserva sus créditos", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { permiso: { producto: "alta", desde: m.hora(), recargo: "4.25", total: "6.25", primera: true, cargada: false } } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(m.anotado).toContainEqual(["compra-permiso", { producto: "alta", primera: 1, nueva: 1 }]);
    // La bitácora no lleva la persona ni su cuenta.
    expect(JSON.stringify(m.anotado)).not.toContain("usr_ana");
    expect(JSON.stringify(m.anotado)).not.toContain(ana.cuenta as string);
  });

  it("cada condición de la configuración por separado: apagada, sin pago, sin carga, sin recargo o con fondeo diferido", async () => {
    const casos: Array<[Partial<Env>, string]> = [
      [{ COMPRAS_QR: "0" }, "compras-cerradas"],
      [{ ALTAS_PAGO: "0" }, "compras-cerradas"],
      [{ CARGAS: "0" }, "compras-cerradas"],
      [{ RECARGO_QR: "4,25:0,5" }, "compras-cerradas"],
      [{ POLLAR_FONDEO: "diferido" }, "fondeo-diferido"],
    ];
    for (const [env, motivo] of casos) {
      const m = montar(env);
      const ana = enPiloto(m, "usr_ana");
      expect(await m.empezar(ana.token, "alta"), JSON.stringify(env)).toEqual({ estado: 503, cuerpo: { motivo } });
      expect(m.compras.tuvo("usr_ana"), JSON.stringify(env)).toBe(false);
    }
  });

  it("cada condición de la persona por separado: el producto, la sesión, el piloto, la billetera y el acceso", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    for (const malo of ["p20", "", 3, null]) expect(await m.empezar(ana.token, malo)).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
    expect(await m.empezar(null, "alta")).toEqual({ estado: 401, cuerpo: { motivo: "sesion" } });
    const beto = m.persona("usr_beto");
    expect(await m.empezar(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    const caro = m.persona("usr_caro", null);
    expect(await m.empezar(caro.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    m.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES ('usr_ana', 'cupon', 'cupon:x', NULL, NULL, 'autorizada', ?, ?)", m.hora(), m.hora());
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
    // Con acceso, el de diez sí.
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "p10", total: "9.25" } } });
    expect(filasDeCompras(m)).toBe(1);
  });

  it("los créditos: el umbral justo no alcanza y uno más sí; las altas o la venta pausadas y Pollar sin leer, tampoco", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    m.pm.creditos = UMBRAL;
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "sin-lugar" } });
    expect(m.anotado).toContainEqual(["compra-pausa", { motivo: "sin-lugar" }]);
    m.pm.creditos = UMBRAL + 1;
    m.mover(61_000);
    m.cupos.fijarAjuste(AJUSTE_PAUSA, "1", m.hora());
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "sin-lugar" } });
    m.cupos.fijarAjuste(AJUSTE_PAUSA, "0", m.hora());
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "sin-lugar" } });
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "0", m.hora());
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    const sinLectura = montar();
    const beto = enPiloto(sinLectura, "usr_beto");
    sinLectura.pm.creditosCaido = true;
    expect(await sinLectura.empezar(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "sin-lugar" } });
  });

  it("las personas nuevas del día: el tope justo pasa y una más no; quien ya tiene una no cuenta; al otro día hay lugar", async () => {
    const m = montar({ COMPRAS_QR_DIA: "2" });
    const [ana, beto, caro] = ["usr_ana", "usr_beto", "usr_caro"].map((u) => enPiloto(m, u)) as [ReturnType<typeof enPiloto>, ReturnType<typeof enPiloto>, ReturnType<typeof enPiloto>];
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect((await m.empezar(beto.token, "alta")).estado).toBe(200);
    expect(await m.empezar(caro.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    m.mover(DIA_MS);
    expect((await m.empezar(caro.token, "alta")).estado).toBe(200);
    const cero = montar({ COMPRAS_QR_DIA: "0" });
    const nora = enPiloto(cero, "usr_nora");
    expect(await cero.empezar(nora.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "tope-del-dia" } });
  });

  it("si ya tiene uno abierto devuelve el mismo sin reservar de nuevo, y dos pedidos a la vez no reservan dos veces", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const [a, b] = await Promise.all([m.empezar(ana.token, "alta"), m.empezar(ana.token, "alta")]);
    expect(a).toEqual(b);
    expect(a.estado).toBe(200);
    m.mover(60_000);
    expect(await m.empezar(ana.token, "alta")).toEqual(a);
    expect(filasDeCompras(m)).toBe(1);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(m.anotado.filter(([e]) => e === "compra-permiso")).toHaveLength(1);
  });

  it("la reserva sube con cada compra abierta y frena a la siguiente; a la hora sin cargar se libera", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const beto = enPiloto(m, "usr_beto");
    await m.empezar(ana.token, "alta");
    m.pm.creditos = UMBRAL + RESERVA_ALTA;
    m.mover(61_000);
    expect(await m.empezar(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "sin-lugar" } });
    m.pm.creditos = UMBRAL + RESERVA_ALTA + 1;
    m.mover(61_000);
    expect((await m.empezar(beto.token, "alta")).estado).toBe(200);
    expect(m.compras.reservas(m.hora())).toBe(2 * RESERVA_ALTA);
    m.mover(RESERVA_SIN_CARGAR_MS);
    expect(m.compras.reservas(m.hora())).toBe(0);
    m.mover(PERMISO_RESERVA_MS);
    expect(m.compras.activa("usr_ana", m.hora())).toBeNull();
  });

  it("la reserva de una compra cargada va encima del piso para lo nuevo: un cupón y la carga se pausan antes de comérsela", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    // Cargada: sin cargar, su reserva no frena un canje (compras-topes.test.ts).
    await m.cargar(ana.token, "alta");
    await m.lote([codigo(1)]);
    const beto = m.persona("usr_beto");
    // El canje promete 3 sorteos por 40 y la activación: 150.
    m.pm.creditos = 300 + RESERVA_ALTA + 149;
    m.mover(61_000);
    expect(await m.cupon(beto.token, codigo(1))).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(await m.puerta.cargaAbierta()).toBe(false);
    m.pm.creditos = 300 + RESERVA_ALTA + 150;
    m.mover(61_000);
    expect((await m.cupon(beto.token, codigo(1))).estado).toBe(200);
    // Ahora el piso es 300 + 150: la carga abre solo por encima del piso, la reserva y los 400.
    m.pm.creditos = 450 + RESERVA_ALTA + 400;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(false);
    m.pm.creditos += 1;
    m.mover(61_000);
    expect(await m.puerta.cargaAbierta()).toBe(true);
    expect(await m.puerta.resumen()).toMatchObject({ piso: 450, reservasCompras: RESERVA_ALTA });
  });

  it("otro producto antes de cargar cierra el de antes y da uno nuevo; después de cargar, 409 compra-en-curso", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    // Sin alta todavía, el de diez reserva también la activación.
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "p10", recargo: "4.25", total: "9.25", primera: true } } });
    expect(m.compras.reservas(m.hora())).toBe(380 + 10 * 40 + 30);
    expect((await m.cargar(ana.token, "p10")).estado).toBe(200);
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "compra-en-curso", permiso: { producto: "p10", cargada: true } } });
    expect(filasDeCompras(m)).toBe(2);
  });
});

describe("/v1/alta/estado y el permiso de terminar", () => {
  it("sin la compra con QR prendida y sin compras, /estado no cambia", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    expect(Object.keys((await m.estado(ana.token)).cuerpo)).not.toContain("compraQr");
  });

  it("con la compra con QR prendida dice si puede, por qué no, la abierta, el de terminar y el mínimo, sin reservar nada", async () => {
    const m = montar({ CARGA_MINIMO_BS: "100" });
    const ana = enPiloto(m, "usr_ana");
    const beto = m.persona("usr_beto");
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ compraQr: { puede: true, motivo: null, abierta: null, terminar: false, minimoBs: 100 } });
    expect((await m.estado(beto.token)).cuerpo).toMatchObject({ compraQr: { puede: false, motivo: "fuera-del-piloto", abierta: null, terminar: false } });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(filasDeCompras(m)).toBe(0);
    await m.empezar(ana.token, "alta");
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ compraQr: { puede: true, abierta: { producto: "alta", recargo: "4.25", total: "6.25", cargada: false }, terminar: true } });
    const caro = enPiloto(m, "usr_caro");
    m.pm.creditos = 1000;
    m.mover(61_000);
    expect((await m.estado(caro.token)).cuerpo).toMatchObject({ compraQr: { puede: false, motivo: "sin-lugar" } });
    // A beto no se le leen los créditos: no está en el piloto.
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
  });

  it("con la compra con QR apagada después de cargar, /estado sigue trayendo la compra y el de terminar", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const apagada = m.conVariables({ COMPRAS_QR: "0" });
    expect((await apagada.estado(ana.token)).cuerpo).toMatchObject({ compraQr: { puede: false, motivo: "compras-cerradas", abierta: { producto: "alta", cargada: true }, terminar: true } });
  });
});

describe("el aviso de carga", () => {
  it("sin permiso 404; con el permiso queda cargada, se anota una vez y avisar otra vez (pasados los 3 minutos) es lo mismo", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 404, cuerpo: { motivo: "sin-permiso" } });
    await m.empezar(ana.token, "alta");
    const r = await m.cargar(ana.token, "alta");
    expect(r).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "alta", recargo: "4.25", total: "6.25", cargada: true } } });
    // Antes de los 3 minutos es 409 cargando (compras-cargando.test.ts).
    m.mover(AVISO_ESPERA_MS);
    expect(await m.cargar(ana.token, "alta")).toEqual(r);
    expect(m.anotado.filter(([e]) => e === "compra-cargada")).toEqual([["compra-cargada", { producto: "alta" }]]);
    expect(await m.cargar(ana.token, "x")).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
  });

  it("otro producto, 409 compra-en-curso; a los 7 días, 409 permiso-vencido, y empezar lo renueva con su mismo recargo", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    expect(await m.cargar(ana.token, "p10")).toMatchObject({ estado: 409, cuerpo: { motivo: "compra-en-curso", permiso: { producto: "alta" } } });
    m.mover(PERMISO_RESERVA_MS);
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "permiso-vencido" } });
    // Renovar no cuenta como persona nueva ni cambia el recargo.
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { permiso: { producto: "alta", desde: m.hora(), recargo: "4.25", total: "6.25", primera: true, cargada: true } } });
    expect(m.anotado).toContainEqual(["compra-renovada", { producto: "alta", primera: 1, nueva: 1 }]);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(filasDeCompras(m)).toBe(1);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
  });

  it("fuera del piloto, con la compra con QR apagada o con acceso para el primer paquete, no carga", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    m.cupos.transaccion(() => m.compras.sacarPiloto(ana.cuenta as string));
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    m.cupos.transaccion(() => m.compras.sumarPiloto(ana.cuenta as string, m.hora()));
    expect(await m.conVariables({ COMPRAS_QR: "0" }).cargar(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "compras-cerradas" } });
    m.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES ('usr_ana', 'cupon', 'cupon:x', NULL, NULL, 'autorizada', ?, ?)", m.hora(), m.hora());
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
  });

  it("lee los pagos antes: un pago que ya llegó deja la orden pagada; con Horizon caído y órdenes sin pagar, 502 red sin tocar nada", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const vieja = idDe(await m.orden(ana.token, "alta"));
    await m.empezar(ana.token, "alta");
    m.h.estado.caido = true;
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 502, cuerpo: { motivo: "red" } });
    expect(m.cobros.orden(vieja)).toMatchObject({ pagada: null, metodo: null });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    // Pagó desde su app y no tocó Ya pagué: al cargar se lee, la orden queda pagada y ya no hay primer paquete que cargar.
    m.h.estado.caido = false;
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${vieja}` });
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "ya-tiene-acceso" } });
    expect(m.cobros.orden(vieja)).toMatchObject({ metodo: "usdc" });
  });

  it("una orden suya que ya recibió algo frena la carga: 409 orden-con-pago, y no se reemplaza nada", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const vieja = idDe(await m.orden(ana.token, "alta"));
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${vieja}` });
    await m.empezar(ana.token, "alta");
    expect(await m.cargar(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "orden-con-pago" } });
    expect(m.cobros.orden(vieja)).toMatchObject({ pagada: null, metodo: null });
    expect(m.compras.pendiente("usr_ana")).toBeNull();
  });
});

describe("la reserva de una compra cargada cuenta también desde la carga", () => {
  it("permiso en T0 y aviso casi a la hora: a los 7 días y media hora sigue contando y frena un cupón que se la come; a los 7 días del aviso se suelta", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    const desde = m.hora();
    // Sin cargar, el permiso reserva una hora: el aviso llega un milisegundo antes.
    m.mover(RESERVA_SIN_CARGAR_MS - 1);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    const cargada = m.hora();
    m.mover(desde + PERMISO_RESERVA_MS + 30 * 60_000 - m.hora());
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    // Es lo que lee la vigilancia: los créditos tienen que cubrir el piso más estas reservas.
    expect(await m.puerta.resumen()).toMatchObject({ piso: 300, reservasCompras: RESERVA_ALTA });
    // Un cupón que se come lo reservado se pausa: promete 3 sorteos por 40 y la activación, 150.
    await m.lote([codigo(1)]);
    const beto = m.persona("usr_beto");
    m.pm.creditos = 300 + RESERVA_ALTA + 149;
    m.mover(61_000);
    expect(await m.cupon(beto.token, codigo(1))).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    // Mientras reserva, avisar otra vez anda y empezar devuelve la misma compra: no se renueva ni se reserva dos veces.
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    expect(await m.empezar(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { permiso: { desde, cargada: true } } });
    expect(m.anotado.filter(([e]) => e === "compra-renovada")).toEqual([]);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    // A los 7 días del aviso se suelta: el cupón pasa, avisar pide renovar y empezar renueva con su mismo recargo.
    m.mover(cargada + PERMISO_RESERVA_MS - m.hora());
    expect(m.compras.reservas(m.hora())).toBe(0);
    m.mover(61_000);
    expect((await m.cupon(beto.token, codigo(1))).estado).toBe(200);
    expect(await m.cargar(ana.token, "alta")).toMatchObject({ estado: 409, cuerpo: { motivo: "permiso-vencido" } });
    m.pm.creditos = 100_000;
    m.mover(61_000);
    expect(await m.empezar(ana.token, "alta")).toEqual({ estado: 200, cuerpo: { permiso: { producto: "alta", desde: m.hora(), recargo: "4.25", total: "6.25", primera: true, cargada: true } } });
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    expect(filasDeCompras(m)).toBe(1);
  });
});

describe("el recargo en la orden", () => {
  it("antes de cargar, otro medio no paga recargo; al pagarse, la compra deja de reservar", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    m.mover(60_000);
    const r = await m.orden(ana.token, "alta");
    expect(r).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "alta", usdc: "2" } } });
    expect(Object.keys((r.cuerpo as { orden: object }).orden)).not.toContain("recargo");
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${idDe(r)}` });
    expect(await m.pago(ana.token, idDe(r))).toMatchObject({ estado: 200, cuerpo: { pagada: true } });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(m.compras.activa("usr_ana", m.hora())).toBeNull();
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ acceso: "pago", compraQr: { abierta: null, terminar: true } });
  });

  it("después de cargar, la orden lleva el recargo y dice precio y recargo; pagada desde el 95 % del precio más el recargo da el acceso y libera la reserva", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const r = await m.orden(ana.token, "alta");
    expect(r).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "alta", usdc: "6.25", precio: "2", recargo: "4.25", sorteos: 3 } } });
    const enlace = new URL((r.cuerpo as { orden: { enlace: string } }).orden.enlace);
    expect(enlace.searchParams.get("amount")).toBe("6.25");
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ orden: { usdc: "6.25", precio: "2", recargo: "4.25" } });
    const id = idDe(r);
    // El 95 % del precio (2) más el recargo entero (4,25): 6,15 (minimo-recargo.test.ts).
    expect(await m.pago(ana.token, id)).toEqual({ estado: 200, cuerpo: { pagada: false, recibido: "0", total: "6.25", minimo: "6.15" } });
    m.h.sumar({ monto: "6.1500000", nota: `tk:o:${id}` });
    expect(await m.pago(ana.token, id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 3 } } });
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(m.compras.pendiente("usr_ana")).toBeNull();
    expect(m.compras.pagoLaPrimera("usr_ana")).toBe(true);
    expect((await m.estado(ana.token)).cuerpo).toMatchObject({ acceso: "pago", orden: null, compraQr: { abierta: null, terminar: true } });
  });

  it("las órdenes viejas se reemplazan al cargar, también las vencidas: un pago con su nota que entra a la red pasados los 2 minutos va a los sueltos y no da el paquete", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    const vencida = idDe(await m.orden(ana.token, "alta"));
    m.mover(ORDEN_VIVE_MS + 1);
    const abierta = idDe(await m.orden(ana.token, "p10"));
    expect([vencida, abierta]).toEqual([IDS[0], IDS[1]]);
    await m.empezar(ana.token, "alta");
    // Con una orden viva, el aviso pregunta antes (ordenes-reemplazadas.test.ts): la persona dice que no la pagó.
    expect((await m.cargar(ana.token, "alta", { reemplazar: true })).estado).toBe(200);
    for (const id of [vencida, abierta]) expect(m.cobros.orden(id), id).toMatchObject({ pagada: null, metodo: "reemplazada" });
    const nueva = idDe(await m.orden(ana.token, "alta"));
    expect(nueva).toBe(IDS[2]);
    // El Horizon de mentira fecha los pagos en septiembre, antes del reemplazo: estos entran a la red después.
    const tarde = m.hora() + GRACIA_REEMPLAZO_MS + 1;
    m.h.sumar({ monto: "2.0000000", nota: `tk:o:${vencida}`, ms: tarde }, { monto: "5.0000000", nota: `tk:o:${abierta}`, ms: tarde });
    // Preguntar por la orden con recargo lee los pagos nuevos: los de las reemplazadas no la completan.
    expect(await m.pago(ana.token, nueva)).toMatchObject({ estado: 200, cuerpo: { pagada: false, recibido: "0", total: "6.25" } });
    expect(await m.pago(ana.token, vencida)).toEqual({ estado: 410, cuerpo: { motivo: "orden-cerrada" } });
    expect(m.sueltos()).toEqual([
      expect.objectContaining({ monto: 20_000_000, motivo: "cerrada", orden: vencida, estado: "suelto" }),
      expect.objectContaining({ monto: 50_000_000, motivo: "cerrada", orden: abierta, estado: "suelto" }),
    ]);
    expect(m.cupos.altaDe("usr_ana")).toBeNull();
    expect(m.derechosDe("usr_ana")).toEqual([]);
  });

  it("con el recargo pendiente, otro producto lo lleva y reemplaza la orden anterior: una sola orden con recargo", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const a = idDe(await m.orden(ana.token, "alta"));
    expect(await m.orden(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "p10", usdc: "9.25", precio: "5", recargo: "4.25" } } });
    expect(m.cobros.orden(a)).toMatchObject({ metodo: "reemplazada" });
    const b = m.cobros.ordenAbierta("usr_ana", m.hora(), "p10")?.id as string;
    // Si la del otro producto ya recibió algo, no se reemplaza: 409 compra-en-curso.
    m.h.sumar({ monto: "1.0000000", nota: `tk:o:${b}` });
    await m.pago(ana.token, b);
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 409, cuerpo: { motivo: "compra-en-curso" } });
    expect(m.cobros.orden(b)).toMatchObject({ pagada: null, metodo: null });
  });

  it("la parte de la verificación se cobra una sola vez: la compra siguiente lleva 0,50 y reserva sin la verificación", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    const a = idDe(await m.orden(ana.token, "alta"));
    m.h.sumar({ monto: "6.2500000", nota: `tk:o:${a}` });
    expect(await m.pago(ana.token, a)).toMatchObject({ cuerpo: { pagada: true } });
    expect(await m.empezar(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { permiso: { producto: "p10", recargo: "0.5", total: "5.5", primera: false } } });
    expect(m.compras.reservas(m.hora())).toBe(150 + 10 * 40);
    await m.cargar(ana.token, "p10");
    expect(await m.orden(ana.token, "p10")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "5.5", precio: "5", recargo: "0.5" } } });
    expect(m.anotado).toContainEqual(["compra-permiso", { producto: "p10", primera: 0, nueva: 0 }]);
  });

  it("el recargo no se suelta; mientras reserva, la orden de esa compra sale con la venta pausada, bajo el piso y con la compra con QR apagada", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    // Beto también está en la lista: con una lista puesta, fuera de ella la orden ni llega a la pausa (orden-piloto.test.ts).
    const beto = enPiloto(m, "usr_beto");
    await m.empezar(ana.token, "alta");
    await m.cargar(ana.token, "alta");
    m.mover(DIA_MS);
    expect(m.compras.reservas(m.hora())).toBe(RESERVA_ALTA);
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "1", m.hora());
    m.pm.creditos = 0;
    m.mover(61_000);
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "6.25", recargo: "4.25" } } });
    expect(await m.conVariables({ COMPRAS_QR: "0", CARGAS: "0" }).orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "6.25" } } });
    // Cambia a propósito: pasada la reserva, el recargo sigue pero la orden pasa por la pausa y el piso.
    m.mover(PERMISO_RESERVA_MS);
    expect(m.compras.reservas(m.hora())).toBe(0);
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    expect(m.compras.pendiente("usr_ana")).toMatchObject({ recargo: 42_500_000 });
    // Lo que no es su compra no saltea nada: otro producto de ella y la orden de otra persona.
    expect(await m.orden(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    expect(await m.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "venta-pausada" } });
    m.cupos.fijarAjuste(AJUSTE_VENTA_PAUSADA, "0", m.hora());
    expect(await m.orden(beto.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
  });

  it("con el pago apagado o el producto fuera de venta, la orden no sale ni con el permiso de terminar", async () => {
    const m = montar();
    const ana = enPiloto(m, "usr_ana");
    await m.empezar(ana.token, "p10");
    await m.cargar(ana.token, "p10");
    expect(await m.conVariables({ ALTAS_PAGO: "0" }).orden(ana.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "pago-apagado" } });
    expect(await m.conVariables({ PRECIOS: "alta:2:3:365" }).orden(ana.token, "p10")).toEqual({ estado: 400, cuerpo: { motivo: "producto" } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(0);
  });
});

describe("las rutas de la compra en la puerta del Worker", () => {
  // Con la compra con QR abierta: cerrada, empezar y cargar contestan en la puerta (venta-cerrada.test.ts).
  const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: "app", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, CARGAS: "1", COMPRAS_QR: "1" });
  const pedido = (ruta: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    h.set("Origin", "https://tinkazo.app");
    h.set("CF-Connecting-IP", IP);
    return new Request(`https://pm.tinkazo.app${ruta}`, { method: init.method ?? "POST", headers: h, body: init.body });
  };
  const nada = async () => ({ estado: 500, cuerpo: {} });

  it("POST /v1/compra/empezar y /v1/compra/cargar pasan al objeto con el token y el cuerpo; sin quien las atienda, no existen", async () => {
    const vistos: Array<[string, unknown]> = [];
    const llamarCompra = async (accion: AccionCompra, p: { token: string | null; cuerpo: unknown }) => (vistos.push([accion, { token: p.token, cuerpo: p.cuerpo }]), { estado: 200, cuerpo: { visto: accion } });
    const h = { Authorization: "Bearer tok_abc", "Content-Type": "application/json" };
    for (const accion of ["empezar", "cargar"] as const) {
      const r = (await atenderAlta(pedido(`/v1/compra/${accion}`, { headers: h, body: JSON.stringify({ producto: "alta" }) }), cfg, nada, new PorIp(), nada, llamarCompra)) as Response;
      expect([r.status, await r.json()]).toEqual([200, { visto: accion }]);
    }
    expect(vistos).toEqual([
      ["empezar", { token: "tok_abc", cuerpo: { producto: "alta" } }],
      ["cargar", { token: "tok_abc", cuerpo: { producto: "alta" } }],
    ]);
    expect((await atenderAlta(pedido("/v1/compra/empezar", { headers: h, body: "{}" }), cfg, nada, new PorIp(), nada))?.status).toBe(404);
    expect((await atenderAlta(pedido("/v1/compra/otra", { headers: h, body: "{}" }), cfg, nada, new PorIp(), nada, llamarCompra))?.status).toBe(404);
    expect((await atenderAlta(pedido("/v1/compra/empezar", { method: "GET" }), cfg, nada, new PorIp(), nada, llamarCompra))?.status).toBe(405);
    expect((await atenderAlta(pedido("/v1/compra/empezar", { method: "OPTIONS" }), cfg, nada, new PorIp(), nada, llamarCompra))?.status).toBe(204);
    expect(await atenderAlta(pedido("/v1/compra/empezar", { headers: h, body: "{}" }), leerConfig({ RED: "testnet" }), nada, new PorIp(), nada, llamarCompra)).toBeNull();
  });

  it("el Worker las atiende por el objeto, que les pasa la compra con QR a la puerta", () => {
    const index = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(index).toMatch(/url\.pathname\.startsWith\("\/v1\/compra\/"\)/);
    expect(index).toMatch(/\(accion, pedido\) => objeto\.compra\(accion, pedido\)/);
    expect(index).toMatch(/async compra\(accion: AccionCompra, pedido: PedidoAlta\): Promise<Respuesta>/);
    expect(index).toMatch(/new ComprasQr\(this\.sql, cfg\)/);
  });
});
