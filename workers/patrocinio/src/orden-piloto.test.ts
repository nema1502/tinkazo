import { StrKey } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { codigo } from "./altas-prueba";
import { montarPagos } from "./cobros-prueba";
import type { Env } from "./config";
import { PISO_BASE } from "./rutas-altas";

/**
 * La orden en dólares digitales (`POST /v1/alta/orden`) en el piloto:
 *
 * - Mientras haya una lista del piloto puesta, la orden nueva también pide que la cuenta esté en la lista (la de la
 *   variable o una sumada por administración): si no, `503 fuera-del-piloto`. La lista está puesta con cuentas en
 *   `COMPRAS_QR_PILOTO` y también, con la variable vacía, con una sola cuenta sumada a mano. Una lista mal escrita no
 *   deja pasar a nadie. Con `todos` confirmado, o sin ninguna lista, la orden no mira el piloto. Una orden que ya existe
 *   se sigue devolviendo, y el permiso de terminar de una compra cargada no mira la lista.
 * - La reserva del evento (`RESERVA_CARGA_CREDITOS`) la respetan todos los caminos de la venta, también la orden nueva:
 *   no nace si los créditos, menos lo que promete, no cubren el piso, lo reservado por las compras cargadas y esa reserva.
 *   El canje de un cupón del evento no la respeta: es para él.
 */

const cuenta = (n: number) => StrKey.encodeEd25519PublicKey(Buffer.alloc(32, n));
const [ANA, BETO, NORA] = [cuenta(41), cuenta(42), cuenta(43)] as [string, string, string];
const PILOTO: Partial<Env> = { COMPRAS_QR: "1", CARGAS: "1", COMPRAS_QR_DIA: "6", COMPRAS_QR_PILOTO: `${ANA},${BETO}`, RESERVA_CARGA_CREDITOS: "8400", RECARGO_QR: "4:0.50", PRECIOS: "alta:4:3:90,p10:10:10:365" };
const idDe = (r: { cuerpo: unknown }) => (r.cuerpo as { orden: { id: string } }).orden.id;
/** Lo que promete el primer paquete de quien todavía no tiene alta: 3 sorteos de 40 y la activación, 30. */
const PROMETE_ALTA = 3 * 40 + 30;

describe("la orden en dólares digitales y la lista del piloto", () => {
  it("fuera de la lista no nace (fuera-del-piloto), tampoco sin billetera; en la lista, sí", async () => {
    const m = montarPagos(PILOTO);
    const [ana, nora, sinCuenta] = [m.persona("usr_ana", ANA), m.persona("usr_nora", NORA), m.persona("usr_sin", null)];
    expect(await m.orden(nora.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.orden(nora.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.orden(sinCuenta.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    expect(await m.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { producto: "alta", usdc: "4" } } });
    expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
  });

  it("una cuenta sumada por administración también entra; sacada, ya no", async () => {
    const m = montarPagos(PILOTO);
    const nora = m.persona("usr_nora", NORA);
    m.cupos.transaccion(() => m.compras.sumarPiloto(NORA, m.hora()));
    expect((await m.orden(nora.token, "alta")).estado).toBe(200);
    m.cupos.transaccion(() => m.compras.sacarPiloto(NORA));
    expect(await m.orden(nora.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
  });

  it("con la variable vacía, la lista sumada a mano también es una lista puesta: fuera de ella la orden no nace", async () => {
    for (const vacia of ["", " , "]) {
      const m = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: vacia });
      const [ana, nora, sinCuenta] = [m.persona("usr_ana", ANA), m.persona("usr_nora", NORA), m.persona("usr_sin", null)];
      m.cupos.transaccion(() => m.compras.sumarPiloto(ANA, m.hora()));
      expect(await m.orden(nora.token, "alta"), JSON.stringify(vacia)).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
      expect(await m.orden(sinCuenta.token, "alta"), JSON.stringify(vacia)).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
      expect((await m.orden(ana.token, "alta")).estado, JSON.stringify(vacia)).toBe(200);
      expect(m.sql.exec("SELECT COUNT(*) AS n FROM ordenes").toArray()[0]?.n).toBe(1);
    }
  });

  it("con la variable vacía y nadie sumado a mano, o con todos confirmado, la orden no mira el piloto", async () => {
    const sinLista = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: "" });
    expect((await sinLista.orden(sinLista.persona("usr_nora", NORA).token, "alta")).estado).toBe(200);
    // Sacada la última cuenta sumada a mano, ya no hay lista puesta.
    const sacada = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: "" });
    sacada.cupos.transaccion(() => sacada.compras.sumarPiloto(ANA, sacada.hora()));
    sacada.cupos.transaccion(() => sacada.compras.sacarPiloto(ANA));
    expect((await sacada.orden(sacada.persona("usr_nora", NORA).token, "alta")).estado).toBe(200);
    const todos = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: "todos", COMPRAS_QR_TODOS: "1" });
    todos.cupos.transaccion(() => todos.compras.sumarPiloto(ANA, todos.hora()));
    expect((await todos.orden(todos.persona("usr_nora", NORA).token, "alta")).estado).toBe(200);
    expect((await todos.orden(todos.persona("usr_ana", ANA).token, "alta")).estado).toBe(200);
  });

  it("una lista mal escrita no deja pasar a nadie, ni a las cuentas bien escritas ni a las sumadas a mano", async () => {
    for (const mal of [`${ANA},beto`, `${ANA};${BETO}`, "todos", "Todos"]) {
      const m = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: mal });
      const [ana, nora] = [m.persona("usr_ana", ANA), m.persona("usr_nora", NORA)];
      m.cupos.transaccion(() => m.compras.sumarPiloto(NORA, m.hora()));
      expect(await m.orden(ana.token, "alta"), mal).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
      expect(await m.orden(nora.token, "alta"), mal).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
    }
  });

  it("la orden que ya existía se sigue devolviendo; una nueva de otro producto, no", async () => {
    const m = montarPagos({ ...PILOTO, COMPRAS_QR_PILOTO: "" });
    const nora = m.persona("usr_nora", NORA);
    const antes = idDe(await m.orden(nora.token, "alta"));
    const conLista = m.conVariables({ COMPRAS_QR_PILOTO: `${ANA},${BETO}` });
    expect(await conLista.orden(nora.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { id: antes } } });
    expect(await conLista.orden(nora.token, "p10")).toEqual({ estado: 503, cuerpo: { motivo: "fuera-del-piloto" } });
  });

  it("el permiso de terminar no mira la lista: quien ya cargó saca su orden aunque lo hayan sacado", async () => {
    const m = montarPagos(PILOTO);
    const ana = m.persona("usr_ana", ANA);
    expect((await m.empezar(ana.token, "alta")).estado).toBe(200);
    expect((await m.cargar(ana.token, "alta")).estado).toBe(200);
    const sinAna = m.conVariables({ COMPRAS_QR_PILOTO: BETO });
    expect(await sinAna.orden(ana.token, "alta")).toMatchObject({ estado: 200, cuerpo: { orden: { usdc: "8", recargo: "4" } } });
  });
});

describe("la orden nueva respeta la reserva del evento", () => {
  it("no nace si se come los créditos guardados para las tarjetas; el canje del evento sí pasa", async () => {
    const m = montarPagos(PILOTO);
    const [ana, beto] = [m.persona("usr_ana", ANA), m.persona("usr_beto", BETO)];
    // Justo un crédito menos de lo que hace falta: el piso, la reserva del evento y lo que promete esta orden.
    m.pm.creditos = PISO_BASE + 8400 + PROMETE_ALTA - 1;
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    expect(m.anotado).toContainEqual(["alta-pausa", { motivo: "piso", donde: "orden" }]);
    // Con los mismos créditos, la tarjeta del evento se canjea: la reserva es para ella.
    await m.lote([codigo(1)]);
    expect(await m.cupon(beto.token, codigo(1))).toMatchObject({ estado: 200, cuerpo: { ok: true } });
    // El canje subió el piso en lo que prometió: con eso y la reserva cubiertos, la orden nace.
    m.mover(61_000);
    m.pm.creditos = PISO_BASE + PROMETE_ALTA + 8400 + PROMETE_ALTA;
    expect((await m.orden(ana.token, "alta")).estado).toBe(200);
  });

  it("también con la reserva por defecto, sin la variable", async () => {
    const m = montarPagos({ COMPRAS_QR_PILOTO: "" });
    const ana = m.persona("usr_ana", ANA);
    m.pm.creditos = PISO_BASE + 400 + PROMETE_ALTA - 1;
    expect(await m.orden(ana.token, "alta")).toEqual({ estado: 503, cuerpo: { motivo: "altas-pausadas" } });
    m.mover(61_000);
    m.pm.creditos = PISO_BASE + 400 + PROMETE_ALTA;
    expect((await m.orden(ana.token, "alta")).estado).toBe(200);
  });
});
