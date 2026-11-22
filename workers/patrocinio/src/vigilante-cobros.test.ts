import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import {
  AJUSTE_PAGOS_CHICOS,
  Cobros,
  LectorDeCobros,
  PAGINAS,
  PAGINAS_POR_MINUTO,
  POR_PAGINA,
  RECLASIFICAR_MS,
  VIGILAR_CADA_MS,
  VIGILAR_DESPUES_MS,
  VIGILAR_PRIMERO_MS,
  VigilanteDeCobros,
} from "./cobros";
import { COBROS, PRECIOS_POR_UNIDAD, montarPagos } from "./cobros-prueba";
import { type PedidoDePago, UsoDePagos } from "./pagos-uso";

/**
 * La lectura de los pagos con la venta por unidad: la alarma que lee sola mientras haya órdenes vivas, ponerse al día con
 * muchas páginas, los pagos chicos sin orden que no escriben fila y asignar a mano mirando la hora del pago. Sin red: el
 * Horizon y el Pollar son de mentira, y el reloj es el de la prueba.
 */

const montar = () => montarPagos({ PRECIOS: PRECIOS_POR_UNIDAD }, { porUnidad: true });
type M = ReturnType<typeof montar>;
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;
const quedan = (m: M, usuario = "usr_ana") => m.cupos.quedan({ usuario }, m.hora()).quedan;
const lecturas = (m: M) => m.h.estado.pedidos.length;

async function conOrden(m: M, cantidad = 10, usuario = "usr_ana") {
  const p = m.persona(usuario);
  return { ...p, id: idDe(await m.ordenPorUnidad(p.token, cantidad)) };
}

describe("la alarma de cobros", () => {
  it("acredita el pago sin ningún pedido de la persona", async () => {
    const m = montar();
    const vigilante = new VigilanteDeCobros({ cobros: m.cobros, lector: m.lector, reloj: m.hora });
    const ana = await conOrden(m);
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    m.mover(VIGILAR_CADA_MS);
    expect(await vigilante.vuelta()).toBe(m.hora() + VIGILAR_CADA_MS);
    expect(quedan(m)).toBe(10);
    expect(m.cobros.orden(ana.id)).toMatchObject({ metodo: "usdc" });
    // Pagada la única orden, no queda nada vivo: no pide otra vuelta.
    expect(await vigilante.vuelta()).toBeNull();
  });

  it("sin órdenes vivas no lee y no pide otra vuelta", async () => {
    const m = montar();
    const vigilante = new VigilanteDeCobros({ cobros: m.cobros, lector: m.lector, reloj: m.hora });
    expect(await vigilante.vuelta()).toBeNull();
    expect(lecturas(m)).toBe(0);
    expect(vigilante.hayQueVigilar()).toBe(false);
  });

  it("una orden vencida, pagada o reemplazada no cuenta como viva", async () => {
    const m = montar();
    const ana = await conOrden(m, 10);
    await m.ordenPorUnidad(ana.token, 20);
    expect(m.cobros.ordenesVivas(m.hora())).toBe(1);
    m.mover(72 * 3_600_000 + 1);
    expect(m.cobros.cadaCuantoVigilar(m.hora())).toBeNull();
  });

  it("en la primera media hora lee cada vuelta y después espacia a 5 minutos hasta que vence", async () => {
    const m = montar();
    const vigilante = new VigilanteDeCobros({ cobros: m.cobros, lector: m.lector, reloj: m.hora });
    await conOrden(m);
    const antes = lecturas(m);
    expect(await vigilante.vuelta()).toBe(m.hora() + VIGILAR_CADA_MS);
    expect(lecturas(m)).toBe(antes + 1);
    m.mover(VIGILAR_CADA_MS);
    await vigilante.vuelta();
    expect(lecturas(m)).toBe(antes + 2);
    m.mover(VIGILAR_PRIMERO_MS);
    expect(await vigilante.vuelta()).toBe(m.hora() + VIGILAR_DESPUES_MS);
    expect(lecturas(m)).toBe(antes + 3);
    // Una alarma que llega antes (por un sello) no vuelve a leer: devuelve la misma hora.
    const cuando = m.hora() + VIGILAR_DESPUES_MS;
    m.mover(VIGILAR_CADA_MS);
    expect(await vigilante.vuelta()).toBe(cuando);
    expect(lecturas(m)).toBe(antes + 3);
    m.mover(VIGILAR_DESPUES_MS - VIGILAR_CADA_MS);
    await vigilante.vuelta();
    expect(lecturas(m)).toBe(antes + 4);
  });

  it("con Horizon caído la vuelta no lanza y vuelve a mirar a su hora", async () => {
    const m = montar();
    const vigilante = new VigilanteDeCobros({ cobros: m.cobros, lector: m.lector, reloj: m.hora });
    await conOrden(m);
    m.h.estado.caido = true;
    expect(await vigilante.vuelta()).toBe(m.hora() + VIGILAR_CADA_MS);
    expect(m.lector.atraso()).toMatchObject({ atrasado: true });
  });
});

describe("ponerse al día y los pagos chicos", () => {
  it("mil pagos de 0,0000001 no escriben filas y no atrasan un pago real de 10 más de una vuelta", async () => {
    const m = montar();
    const ana = await conOrden(m);
    for (let i = 0; i < 1000; i++) m.h.sumar({ monto: "0.0000001" });
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ estado: 200, cuerpo: { pagada: true, sorteos: { quedan: 10 } } });
    expect(m.sueltos()).toEqual([]);
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(1000);
    expect(m.cobros.cursor()).toBe(m.h.pagos.at(-1)?.id);
    expect(m.anotado.filter(([e]) => e === "pagos-chicos").reduce((n, [, d]) => n + Number(d?.cuantos), 0)).toBe(1000);
    expect(m.lector.atraso()).toMatchObject({ atrasado: false, paginasMinuto: PAGINAS + 1 });
  });

  it(`no pasa de ${PAGINAS_POR_MINUTO} páginas por minuto: lo que queda, en la vuelta siguiente`, async () => {
    const m = montar();
    const ana = await conOrden(m);
    for (let i = 0; i < 5000; i++) m.h.sumar({ monto: "0.0000001" });
    m.h.sumar({ monto: "10.0000000", nota: `tk:o:${ana.id}` });
    const antes = lecturas(m);
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: false } });
    expect(lecturas(m) - antes).toBe(PAGINAS_POR_MINUTO);
    expect(m.lector.atraso()).toMatchObject({ atrasado: true, paginasMinuto: PAGINAS_POR_MINUTO });
    m.mover(60_001);
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { pagada: true } });
    expect(m.sueltos()).toEqual([]);
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(5000);
  });

  it("0,50 justos sin orden siguen escribiendo su fila, y 0,4999999 no", async () => {
    const m = montar();
    const ana = await conOrden(m);
    const [justo] = m.h.sumar(
      { monto: "0.5000000" },
      { monto: "0.4999999" },
      { monto: "0.9999999", nativo: true },
      { monto: "1.0000000", nativo: true },
    );
    await m.pago(ana.token, ana.id);
    expect(m.sueltos().map((s) => [s.operacion === justo ? "justo" : s.activo, s.motivo, s.monto])).toEqual([
      ["justo", "sin-nota", 5_000_000],
      ["XLM", "otro-activo", 10_000_000],
    ]);
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(2);
  });

  it("un pago chico con la nota de una orden sí se ata a ella", async () => {
    const m = montar();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "0.1000000", nota: `tk:o:${ana.id}` });
    expect(await m.pago(ana.token, ana.id)).toMatchObject({ cuerpo: { recibido: "0.1" } });
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(0);
  });

  it("el contador de los pagos chicos es del día: al otro día empieza de cero", async () => {
    const m = montar();
    const ana = await conOrden(m);
    m.h.sumar({ monto: "0.0000001" });
    await m.pago(ana.token, ana.id);
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(1);
    expect(JSON.parse(m.cupos.ajuste(AJUSTE_PAGOS_CHICOS) ?? "{}")).toEqual({ dia: new Date(m.hora()).toISOString().slice(0, 10), n: 1 });
    m.mover(24 * 3_600_000);
    expect(m.cobros.pagosChicosHoy(m.hora())).toBe(0);
  });

  it("sin la venta por unidad, los pagos chicos escriben su fila y la lectura es de cinco páginas, como siempre", async () => {
    const m = montarPagos();
    const ana = m.persona("usr_ana");
    const id = idDe(await m.orden(ana.token, "alta"));
    for (let i = 0; i < 1100; i++) m.h.sumar({ monto: "0.0000001" });
    await m.pago(ana.token, id);
    expect(m.h.estado.pedidos).toHaveLength(PAGINAS);
    expect(m.sueltos()).toHaveLength(PAGINAS * POR_PAGINA);
    expect(m.cupos.ajuste(AJUSTE_PAGOS_CHICOS)).toBeUndefined();
  });
});

describe("el costo de un retiro, con la lectura nueva", () => {
  const CUENTA_RETIRO = Keypair.random().publicKey();
  const INTERNA = "a".repeat(64);

  function conCostos(m: M) {
    const uso = new UsoDePagos(m.sql);
    const cobros = new Cobros(m.sql, m.cupos, { costos: uso, vigilante: true });
    const lector = new LectorDeCobros({ cobros, cuenta: COBROS, fetch: m.h.fetch, reloj: m.hora, cadaMs: 0, alDia: true });
    const pedido: PedidoDePago = {
      hash: INTERNA,
      envuelta: "b".repeat(64),
      forma: "retiro",
      cuenta: CUENTA_RETIRO,
      delLibro: true,
      estimado: 30_000,
      vence: 1,
      premio: null,
      costo: 5_000_000,
    };
    expect(uso.reservar(pedido, m.hora(), { topePagos: 20_000_000, rechazosPorDia: 20 })).toEqual({ ok: true, yaContado: false });
    return { cobros, lector };
  }

  it("0,50 justos de un retiro siguen siendo cobrado", async () => {
    const m = montar();
    const { cobros, lector } = conCostos(m);
    const [op] = m.h.sumar({ monto: "0.5000000", de: CUENTA_RETIRO, tx: INTERNA });
    expect(await lector.leer()).toEqual({ ok: true });
    const cobrado = { operacion: op, activo: "USDC", monto: 5_000_000, nota: null, motivo: "costo-retiro", estado: "cobrado", orden: null };
    expect(m.sueltos()).toEqual([cobrado]);
    expect(cobros.pagosChicosHoy(m.hora())).toBe(0);
  });

  it("los costos que quedaron sueltos se reconocen solo si son de las últimas 72 horas", async () => {
    const m = montar();
    const { lector } = conCostos(m);
    // Dos sueltos de antes, como los dejaba una lectura sin el reconocimiento: uno de hace 71 horas y otro de hace 73.
    const fila = [
      "INSERT INTO pagos_sueltos (operacion, tx, de, activo, monto, nota, motivo, estado, orden, ref, ms)",
      "VALUES (?, ?, ?, 'USDC', 5000000, NULL, 'sin-nota', 'suelto', NULL, NULL, ?)",
    ].join(" ");
    m.sql.exec(fila, "1", INTERNA, CUENTA_RETIRO, m.hora() - RECLASIFICAR_MS + 3_600_000);
    m.sql.exec(fila, "2", INTERNA, CUENTA_RETIRO, m.hora() - RECLASIFICAR_MS - 3_600_000);
    await lector.leer();
    expect(m.sueltos().map((s) => [s.operacion, s.estado])).toEqual([
      ["2", "suelto"],
      ["1", "cobrado"],
    ]);
  });
});

describe("asignar a mano", () => {
  it("a una orden creada después del pago da error y el suelto queda como estaba", async () => {
    const m = montar();
    const [op] = m.h.sumar({ monto: "10.0000000", ms: m.hora() - 60_000 });
    const beto = m.persona("usr_beto");
    // La lectura de antes deja el pago suelto, sin nota.
    await m.admin.atender("sueltos-lista", {});
    const id = idDe(await m.ordenPorUnidad(beto.token, 10));
    expect(await m.admin.atender("sueltos-asignar", { operacion: op, orden: id })).toEqual({ estado: 409, cuerpo: { motivo: "orden-posterior" } });
    expect(m.sueltos()).toEqual([expect.objectContaining({ operacion: op, estado: "suelto", orden: null })]);
    expect(quedan(m, "usr_beto")).toBe(0);
  });

  it("a una orden de esa persona creada antes del pago, sí", async () => {
    const m = montar();
    const ana = await conOrden(m);
    const [op] = m.h.sumar({ monto: "10.0000000", ms: m.hora() + 60_000 });
    await m.admin.atender("sueltos-lista", {});
    const r = await m.admin.atender("sueltos-asignar", { operacion: op, orden: ana.id });
    expect(r).toEqual({ estado: 200, cuerpo: { ok: true, pagada: true, sobrante: "0" } });
    expect(quedan(m)).toBe(10);
  });
});
