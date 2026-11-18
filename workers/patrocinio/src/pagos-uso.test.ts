import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { DIA_MS, TECHO_ALTAS_PREMIO_DIA, TECHO_PAGOS_RECHAZADOS_DIA, TECHO_TOPE_PAGOS_STROOPS, leerConfig } from "./config";
import { Cupos, PURGA_USO_MS } from "./cupos";
import {
  AJUSTE_ALTAS_PREMIO_DIA,
  AJUSTE_RECHAZOS_DIA,
  AJUSTE_TOPE_PAGOS,
  AJUSTES_DE_PAUSA,
  DEVUELTOS_POR_CUENTA_DIA,
  type LimitesDePagos,
  PREMIOS_POR_ORGANIZADOR_DIA,
  PREMIOS_POR_SORTEO,
  PREMIOS_RECHAZADOS_POR_DESTINO_DIA,
  PREMIOS_RECHAZADOS_POR_ORGANIZADOR_DIA,
  type PedidoDePago,
  REINTENTAR_OCUPADO_MS,
  RETIROS_POR_CUENTA_DIA,
  RETIROS_RECHAZADOS_POR_CUENTA_DIA,
  UsoDePagos,
  huellaDeDestino,
  limitesDePagos,
  topeEnCaliente,
} from "./pagos-uso";
import { sqlDePrueba, sqlQueFallaEn } from "./sqlite-prueba";

const AHORA = 1_790_000_000_000;
/** Lo que vale la oferta del envoltorio de un premio y de un retiro, en stroops. */
const OFERTA_PREMIO = 20_000;
const OFERTA_RETIRO = 30_000;
const COSTO = 5_000_000;
const LIM: LimitesDePagos = { topePagos: 20_000_000, rechazosPorDia: 20 };
const CONTRATO = `C${"A".repeat(55)}`;
const OTRO_CONTRATO = `C${"B".repeat(55)}`;
const VENCE = Math.floor(AHORA / 1000) + 240;

let contador = 0;
/**
 * Un puesto distinto para cada premio que no dice cuál es, así dos premios de una prueba no se pisan. Da la vuelta en 300,
 * los ganadores por defecto: un puesto que no existe en su sorteo no se reserva.
 */
let puestos = 0;
const otroPuesto = (): number => ++puestos % 300;
const hash = (): string => (++contador).toString(16).padStart(64, "0");
const cuenta = (): string => Keypair.random().publicKey();

function nueva() {
  const sql = sqlDePrueba();
  const avisos: Array<[string, unknown]> = [];
  const uso = new UsoDePagos(sql, (evento, datos) => void avisos.push([evento, datos]));
  return { sql, uso, avisos };
}

interface OpcionesDePremio {
  hash?: string;
  cuenta?: string;
  contrato?: string;
  sorteo?: string;
  puesto?: number;
  destino?: string;
  ganadores?: number;
  delLibro?: boolean;
}

function premio(o: OpcionesDePremio = {}): PedidoDePago {
  return {
    hash: o.hash ?? hash(),
    envuelta: hash(),
    forma: "premio",
    cuenta: o.cuenta ?? cuenta(),
    delLibro: o.delLibro ?? true,
    estimado: OFERTA_PREMIO,
    vence: VENCE,
    premio: {
      contrato: o.contrato ?? CONTRATO,
      sorteo: o.sorteo ?? "5",
      puesto: o.puesto ?? otroPuesto(),
      destino: o.destino ?? cuenta(),
      ganadores: o.ganadores ?? 300,
    },
    costo: null,
  };
}

function retiro(o: { hash?: string; cuenta?: string; delLibro?: boolean; costo?: number } = {}): PedidoDePago {
  return {
    hash: o.hash ?? hash(),
    envuelta: hash(),
    forma: "retiro",
    cuenta: o.cuenta ?? cuenta(),
    delLibro: o.delLibro ?? true,
    estimado: OFERTA_RETIRO,
    vence: VENCE,
    premio: null,
    costo: o.costo ?? COSTO,
  };
}

const NUEVO = { ok: true, yaContado: false } as const;

/** Lo que dice un tope por cuenta que se llenó: el motivo, cuál y hasta cuándo, con lo que se hizo a la hora de la prueba. */
const llenoPorCuenta = (que: string, max: number, liberaEn = AHORA + DIA_MS) => ({ ok: false, motivo: "cupo-cuenta", que, liberaEn, max });

/** Reserva un pago que tiene que pasar y lo cierra, así no queda en el aire y la misma cuenta puede seguir. */
function pagar(uso: UsoDePagos, p: PedidoDePago, estado: "ok" | "fallo" = "ok", lim = LIM, ahora = AHORA): void {
  expect(uso.reservar(p, ahora, lim)).toEqual(NUEVO);
  uso.cerrar(p.hash, estado, 200);
}

/** Reserva un pago que tiene que pasar y lo devuelve: la red no lo tomó. */
function intentar(uso: UsoDePagos, p: PedidoDePago): void {
  expect(uso.reservar(p, AHORA, LIM)).toEqual(NUEVO);
  uso.devolver(p.hash);
}

describe("el puesto de un premio", () => {
  it("un premio reservado ocupa su puesto: otro pago del mismo contrato, sorteo y puesto da puesto-usado con el hash del primero", () => {
    const { uso } = nueva();
    const primero = premio({ puesto: 3 });
    expect(uso.reservar(primero, AHORA, LIM)).toEqual(NUEVO);
    const otro = premio({ puesto: 3 });
    expect(uso.reservar(otro, AHORA, LIM)).toEqual({ ok: false, motivo: "puesto-usado", hash: primero.hash, estado: "reservado" });
    expect(uso.puestoUsado(CONTRATO, "5", 3)).toEqual({ hash: primero.hash, estado: "reservado" });
    expect(uso.buscar(otro.hash)).toBeNull();
  });

  it("el mismo sorteo y puesto con otro contrato pasa: con un contrato nuevo los números vuelven a empezar", () => {
    const { uso } = nueva();
    pagar(uso, premio({ puesto: 3 }));
    expect(uso.reservar(premio({ puesto: 3, contrato: OTRO_CONTRATO }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("el mismo contrato con otro sorteo u otro puesto pasa", () => {
    const { uso } = nueva();
    pagar(uso, premio({ puesto: 3 }));
    expect(uso.reservar(premio({ puesto: 4 }), AHORA, LIM)).toEqual(NUEVO);
    expect(uso.reservar(premio({ puesto: 3, sorteo: "6" }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("un puesto que se pagó bien sigue ocupado, y el que está enviado también", () => {
    const { uso } = nueva();
    const enviado = premio({ puesto: 1 });
    expect(uso.reservar(enviado, AHORA, LIM)).toEqual(NUEVO);
    uso.marcarEnviado(enviado.hash);
    expect(uso.reservar(premio({ puesto: 1 }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "puesto-usado", estado: "enviado" });
    uso.cerrar(enviado.hash, "ok", 200);
    expect(uso.reservar(premio({ puesto: 1 }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "puesto-usado", estado: "ok" });
  });

  it("un puesto con su pago en fallo se puede pagar otra vez", () => {
    const { uso } = nueva();
    pagar(uso, premio({ puesto: 2 }), "fallo");
    expect(uso.puestoUsado(CONTRATO, "5", 2)).toBeNull();
    expect(uso.reservar(premio({ puesto: 2 }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("un puesto con su pago devuelto se puede pagar otra vez", () => {
    const { uso } = nueva();
    intentar(uso, premio({ puesto: 2 }));
    expect(uso.puestoUsado(CONTRATO, "5", 2)).toBeNull();
    expect(uso.reservar(premio({ puesto: 2 }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("(ataque) treinta pedidos a la vez del mismo puesto: reserva uno solo", async () => {
    const { uso } = nueva();
    const pedidos = Array.from({ length: 30 }, () => premio({ puesto: 7 }));
    const respuestas = await Promise.all(pedidos.map(async (p) => uso.reservar(p, AHORA, LIM)));
    expect(respuestas.filter((r) => r.ok)).toHaveLength(1);
    expect(respuestas.filter((r) => !r.ok && r.motivo === "puesto-usado")).toHaveLength(29);
    expect(uso.enElAire()).toBe(1);
  });

  it("un premio sin sorteo o un retiro sin costo es un error de quien llama y lanza", () => {
    const { uso } = nueva();
    expect(() => uso.reservar({ ...premio(), premio: null }, AHORA, LIM)).toThrow("pago-forma");
    expect(() => uso.reservar({ ...retiro(), costo: null }, AHORA, LIM)).toThrow("pago-forma");
    expect(uso.enElAire()).toBe(0);
  });
});

describe("lo que se exige de quien llama: un número que no es un número no deja pasar nada", () => {
  const conPremio = (cambio: Partial<NonNullable<PedidoDePago["premio"]>>): PedidoDePago => {
    const p = premio();
    return { ...p, premio: { ...(p.premio as NonNullable<PedidoDePago["premio"]>), ...cambio } };
  };

  it.each([
    ["un presupuesto que no es un número", { topePagos: Number.NaN, rechazosPorDia: 20 }],
    ["un tope de rechazos que no es un número", { topePagos: 20_000_000, rechazosPorDia: Number.NaN }],
    ["un presupuesto infinito", { topePagos: Number.POSITIVE_INFINITY, rechazosPorDia: 20 }],
    ["un tope negativo", { topePagos: 20_000_000, rechazosPorDia: -1 }],
  ] as Array<[string, LimitesDePagos]>)("(ataque) %s lanza y no reserva", (_nombre, lim) => {
    const { uso } = nueva();
    expect(() => uso.reservar(retiro(), AHORA, lim)).toThrow("pago-topes");
    expect(() => uso.frenoPara(premio(), AHORA, lim)).toThrow("pago-topes");
    expect(uso.exportar().pagos_portero).toEqual([]);
  });

  it.each([
    ["ganadores que no son un número", { ganadores: Number.NaN }],
    ["cero ganadores", { ganadores: 0 }],
    ["más de 300 ganadores", { ganadores: 301, puesto: 0 }],
    ["un puesto igual a los ganadores", { ganadores: 3, puesto: 3 }],
    ["un puesto negativo", { puesto: -1 }],
    ["un puesto con decimales", { puesto: 1.5 }],
    ["un sorteo vacío", { sorteo: "" }],
    ["un contrato vacío", { contrato: "" }],
  ] as Array<[string, Partial<NonNullable<PedidoDePago["premio"]>>]>)("(ataque) un premio con %s lanza y no reserva", (_nombre, cambio) => {
    const { uso } = nueva();
    expect(() => uso.reservar(conPremio(cambio), AHORA, LIM)).toThrow("pago-forma");
    expect(uso.exportar().pagos_portero).toEqual([]);
  });

  it.each([
    ["una oferta que no es un número", { estimado: Number.NaN }],
    ["una oferta en cero", { estimado: 0 }],
    ["un vencimiento que no es un número", { vence: Number.NaN }],
    ["un hash que no es un hash", { hash: "no-es-un-hash" }],
    ["un hash en mayúsculas", { hash: "A".repeat(64) }],
    ["un hash de afuera que no es un hash", { envuelta: "x" }],
    ["un costo que no es un número", { costo: Number.NaN }],
    ["un costo en cero", { costo: 0 }],
    ["un retiro con premio", { premio: { contrato: CONTRATO, sorteo: "5", puesto: 0, destino: cuenta(), ganadores: 3 } }],
  ] as Array<[string, Partial<PedidoDePago>]>)("(ataque) un retiro con %s lanza y no reserva", (_nombre, cambio) => {
    const { uso } = nueva();
    expect(() => uso.reservar({ ...retiro(), ...cambio }, AHORA, LIM)).toThrow("pago-forma");
    expect(uso.exportar()).toEqual({ pagos_portero: [], retiros_cobrados: [] });
  });

  it("un premio con costo, o una forma que no es ninguna de las dos, lanza", () => {
    const { uso } = nueva();
    expect(() => uso.reservar({ ...premio(), costo: COSTO }, AHORA, LIM)).toThrow("pago-forma");
    const rara = { ...retiro(), forma: "otra" } as unknown as PedidoDePago;
    expect(() => uso.reservar(rara, AHORA, LIM)).toThrow("pago-forma");
  });

  it("con un tope en 0 no pasa nada: es el lado seguro", () => {
    const { uso } = nueva();
    expect(uso.reservar(retiro(), AHORA, { topePagos: 0, rechazosPorDia: 20 })).toEqual({ ok: false, motivo: "fondo", detalle: "presupuesto" });
    expect(uso.reservar(retiro(), AHORA, { topePagos: 20_000_000, rechazosPorDia: 0 })).toMatchObject({ ok: false, motivo: "fondo" });
  });

  it("(ataque) sin el índice único del puesto no se reserva ningún pago nuevo, aunque la tabla esté", () => {
    const uso = new UsoDePagos(sqlQueFallaEn(/CREATE UNIQUE INDEX IF NOT EXISTS pagos_portero_puesto/));
    expect(() => uso.reservar(premio(), AHORA, LIM)).toThrow("pagos-sin-tablas");
    expect(() => uso.frenoPara(retiro(), AHORA, LIM)).toThrow("pagos-sin-tablas");
    expect(uso.exportar().pagos_portero).toEqual([]);
  });
});

describe("uno en el aire por cuenta", () => {
  it("la cuenta con un pago en el aire no puede tener otro, de ninguna forma, y cerrado el primero sí", () => {
    const { uso } = nueva();
    const c = cuenta();
    const primero = retiro({ cuenta: c });
    expect(uso.reservar(primero, AHORA, LIM)).toEqual(NUEVO);
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toEqual({ ok: false, motivo: "otro-en-curso", hash: primero.hash, vence: VENCE });
    expect(uso.reservar(premio({ cuenta: c }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "otro-en-curso", hash: primero.hash });
    expect(uso.enElAireDe(c)?.hash).toBe(primero.hash);
    uso.cerrar(primero.hash, "ok", 300);
    expect(uso.enElAireDe(c)).toBeNull();
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("el pago en el aire de una cuenta no frena a las demás", () => {
    const { uso } = nueva();
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual(NUEVO);
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual(NUEVO);
  });

  it("un pago devuelto deja el lugar libre", () => {
    const { uso } = nueva();
    const c = cuenta();
    intentar(uso, retiro({ cuenta: c }));
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toEqual(NUEVO);
  });
});

describe("el presupuesto de los pagos es aparte del de los sellos", () => {
  it("con los sellos en su tope general un pago se reserva", () => {
    const { sql, uso } = nueva();
    const cupos = new Cupos(sql);
    const sellos = { maxSellos: 100, maxSorteos: 100, topeGeneral: 2_000_000, reservaSorteo: 1_000_000 };
    const sello = (c: string) => ({ hash: hash(), cuenta: c, metodo: "seal" as const, estimado: 1_000_000, vence: VENCE });
    expect(cupos.reservar(sello(cuenta()), AHORA, sellos)).toMatchObject({ ok: true });
    expect(cupos.reservar(sello(cuenta()), AHORA, sellos)).toEqual({ ok: false, motivo: "fondo" });
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual(NUEVO);
  });

  it("con los pagos en su tope un sello se reserva", () => {
    const { sql, uso } = nueva();
    const cupos = new Cupos(sql);
    const poco = { topePagos: 2 * OFERTA_PREMIO, rechazosPorDia: 20 };
    expect(uso.reservar(premio(), AHORA, poco)).toEqual(NUEVO);
    expect(uso.reservar(premio(), AHORA, poco)).toEqual(NUEVO);
    expect(uso.reservar(premio(), AHORA, poco)).toEqual({ ok: false, motivo: "fondo", detalle: "presupuesto" });
    const sellos = { maxSellos: 100, maxSorteos: 100, topeGeneral: 15 * 10_000_000, reservaSorteo: 1_000_000 };
    const sello = { hash: hash(), cuenta: cuenta(), metodo: "seal" as const, estimado: 1_000_000, vence: VENCE };
    expect(cupos.reservar(sello, AHORA, sellos)).toMatchObject({ ok: true });
    expect(cupos.gastoDeLaVentana(AHORA)).toBe(1_000_000);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(2 * OFERTA_PREMIO);
  });

  it("el gasto cuenta lo real cuando se sabe, y lo reservado hasta entonces", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(OFERTA_RETIRO);
    uso.cerrar(p.hash, "ok", 312);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(312);
  });

  it("lo de hace más de 24 horas ya no cuenta", () => {
    const { uso } = nueva();
    const p = retiro();
    pagar(uso, p);
    expect(uso.gastoDeLaVentana(AHORA + DIA_MS - 1)).toBe(200);
    expect(uso.gastoDeLaVentana(AHORA + DIA_MS)).toBe(0);
  });
});

describe("los topes por cuenta", () => {
  it("(ataque) el retiro 11 de una cuenta en 24 horas da cupo-cuenta retiros, y vuelve pasado el día", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < RETIROS_POR_CUENTA_DIA; i++) {
      pagar(uso, retiro({ cuenta: c }));
    }
    const siguiente = retiro({ cuenta: c });
    expect(uso.reservar(siguiente, AHORA + 1000, LIM)).toEqual(llenoPorCuenta("retiros", 10));
    expect(uso.reservar(siguiente, AHORA + DIA_MS - 1, LIM)).toMatchObject({ ok: false, motivo: "cupo-cuenta", que: "retiros" });
    expect(uso.reservar(siguiente, AHORA + DIA_MS, LIM)).toEqual(NUEVO);
  });

  it("(ataque) el tercer retiro de una cuenta que la red rechazó al aplicarlo da cupo-cuenta rechazos, y sus premios siguen", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < RETIROS_RECHAZADOS_POR_CUENTA_DIA; i++) {
      pagar(uso, retiro({ cuenta: c }), "fallo");
    }
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toEqual(llenoPorCuenta("rechazos", 2));
    expect(uso.reservar(premio({ cuenta: c }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("el retiro de otra cuenta no se frena por los rechazos de esta", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < RETIROS_RECHAZADOS_POR_CUENTA_DIA; i++) {
      pagar(uso, retiro({ cuenta: c }), "fallo");
    }
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual(NUEVO);
  });

  it("(ataque) el premio 61 de un organizador en 24 horas da cupo-cuenta premios", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 1; i <= PREMIOS_POR_ORGANIZADOR_DIA; i++) {
      pagar(uso, premio({ cuenta: c, sorteo: String(i) }));
    }
    expect(uso.reservar(premio({ cuenta: c, sorteo: "61" }), AHORA, LIM)).toEqual(llenoPorCuenta("premios", 60));
    expect(uso.reservar(premio({ cuenta: c, sorteo: "61" }), AHORA + DIA_MS, LIM)).toEqual(NUEVO);
  });

  it("(ataque) el premio 51 de un sorteo de 300 ganadores da cupo-sorteo", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < PREMIOS_POR_SORTEO; i++) {
      pagar(uso, premio({ cuenta: c, puesto: i }));
    }
    expect(uso.reservar(premio({ cuenta: c, puesto: 50 }), AHORA, LIM)).toEqual({ ok: false, motivo: "cupo-sorteo", max: 50 });
    expect(uso.reservar(premio({ cuenta: c, puesto: 50, sorteo: "6" }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("en uno de 8 ganadores el noveno puesto no existe: no se reserva y lanza (el servicio contesta puesto antes)", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < 8; i++) {
      pagar(uso, premio({ cuenta: c, puesto: i, ganadores: 8 }));
    }
    expect(() => uso.reservar(premio({ cuenta: c, puesto: 8, ganadores: 8 }), AHORA, LIM)).toThrow("pago-forma");
    expect(uso.exportar().pagos_portero).toHaveLength(8);
  });

  it("en uno de 8 ganadores con los 8 puestos pagados, otro pago de ese sorteo choca con su puesto", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < 8; i++) {
      pagar(uso, premio({ cuenta: c, puesto: i, ganadores: 8 }));
    }
    expect(uso.reservar(premio({ cuenta: c, puesto: 3, ganadores: 8 }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "puesto-usado" });
  });

  it("en uno de 60 ganadores el tope es 50: el puesto 51 se frena aunque exista", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < PREMIOS_POR_SORTEO; i++) {
      pagar(uso, premio({ cuenta: c, puesto: i, ganadores: 60 }));
    }
    expect(uso.reservar(premio({ cuenta: c, puesto: 55, ganadores: 60 }), AHORA, LIM)).toEqual({ ok: false, motivo: "cupo-sorteo", max: 50 });
  });

  it("un premio que falló no cuenta para el tope de su sorteo", () => {
    const { uso } = nueva();
    const c = cuenta();
    pagar(uso, premio({ cuenta: c, puesto: 0, ganadores: 1 }), "fallo");
    expect(uso.reservar(premio({ cuenta: c, puesto: 0, ganadores: 1 }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("(ataque) el sexto premio que falla de un organizador da cupo-cuenta rechazos", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < PREMIOS_RECHAZADOS_POR_ORGANIZADOR_DIA; i++) {
      pagar(uso, premio({ cuenta: c, puesto: i }), "fallo");
    }
    expect(uso.reservar(premio({ cuenta: c, puesto: 9 }), AHORA, LIM)).toEqual(llenoPorCuenta("rechazos", 5));
  });

  it("(ataque) el tercer premio que falla hacia el mismo destino da destino-frenado aunque sea de otro organizador", () => {
    const { uso } = nueva();
    const destino = cuenta();
    for (let i = 0; i < PREMIOS_RECHAZADOS_POR_DESTINO_DIA; i++) {
      pagar(uso, premio({ destino, puesto: i }), "fallo");
    }
    expect(uso.reservar(premio({ destino, puesto: 9 }), AHORA, LIM)).toEqual({ ok: false, motivo: "destino-frenado", liberaEn: AHORA + DIA_MS });
    expect(uso.reservar(premio({ puesto: 9 }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("dos premios que fallan hacia un destino de dos organizadores distintos no frenan a ninguno de los dos", () => {
    const { uso } = nueva();
    const destino = cuenta();
    pagar(uso, premio({ destino, puesto: 0 }), "fallo");
    expect(uso.reservar(premio({ destino, puesto: 1 }), AHORA, LIM)).toEqual(NUEVO);
  });

  it("(ataque) el intento 11 de una cuenta, sumando las dos formas, da cupo-cuenta intentos", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < DEVUELTOS_POR_CUENTA_DIA / 2; i++) {
      intentar(uso, premio({ cuenta: c, puesto: i }));
      intentar(uso, retiro({ cuenta: c }));
    }
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toEqual(llenoPorCuenta("intentos", 10));
    expect(uso.reservar(premio({ cuenta: c, puesto: 40 }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "cupo-cuenta", que: "intentos" });
    expect(uso.reservar(retiro({ cuenta: c }), AHORA + DIA_MS, LIM)).toEqual(NUEVO);
  });

  it("lo devuelto no cuenta para el presupuesto, ni para los topes de retiros, premios o rechazos, y sí para el de intentos", () => {
    const { uso } = nueva();
    const c = cuenta();
    for (let i = 0; i < DEVUELTOS_POR_CUENTA_DIA - 1; i++) {
      intentar(uso, retiro({ cuenta: c }));
    }
    expect(uso.gastoDeLaVentana(AHORA)).toBe(0);
    expect(uso.resumen(AHORA).retiro).toEqual({ enElAire: 0, ok24h: 0, fallo24h: 0 });
    for (let i = 0; i < RETIROS_POR_CUENTA_DIA; i++) {
      pagar(uso, retiro({ cuenta: c }));
    }
    expect(uso.reservar(retiro({ cuenta: c }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "cupo-cuenta", que: "retiros" });
    expect(uso.reservar(premio({ cuenta: c }), AHORA, LIM)).toEqual(NUEVO);
  });
});

describe("la última red: lo que falló y lo que está en el aire, por forma y entre todas las cuentas", () => {
  it("(ataque) con 20 retiros fallados en el día, el siguiente da fondo rechazos y los premios siguen", () => {
    const { uso } = nueva();
    for (let i = 0; i < LIM.rechazosPorDia; i++) {
      pagar(uso, retiro(), "fallo");
    }
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual({ ok: false, motivo: "fondo", detalle: "rechazos", liberaEn: AHORA + DIA_MS });
    expect(uso.reservar(premio(), AHORA, LIM)).toEqual(NUEVO);
    expect(uso.reservar(retiro(), AHORA + DIA_MS, LIM)).toEqual(NUEVO);
  });

  it("(ataque) con 15 fallados y 5 en el aire, el siguiente da fondo ocupado con reintentarEn, y pasa cuando uno de los del aire cierra bien", () => {
    const { uso } = nueva();
    for (let i = 0; i < 15; i++) {
      pagar(uso, retiro(), "fallo");
    }
    const enElAire = Array.from({ length: 5 }, () => retiro());
    for (const p of enElAire) {
      expect(uso.reservar(p, AHORA, LIM)).toEqual(NUEVO);
    }
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual({ ok: false, motivo: "fondo", detalle: "ocupado", reintentarEn: REINTENTAR_OCUPADO_MS });
    expect(REINTENTAR_OCUPADO_MS).toBe(5_000);
    uso.cerrar((enElAire[0] as PedidoDePago).hash, "ok", 300);
    expect(uso.reservar(retiro(), AHORA, LIM)).toEqual(NUEVO);
  });

  it("un tope en caliente más bajo se aplica en el momento", () => {
    const { uso } = nueva();
    pagar(uso, retiro(), "fallo");
    pagar(uso, retiro(), "fallo");
    const frenado = uso.reservar(retiro(), AHORA, { topePagos: 20_000_000, rechazosPorDia: 2 });
    expect(frenado).toMatchObject({ ok: false, motivo: "fondo", detalle: "rechazos" });
  });

  it("los premios que fallan no llenan el tope de los retiros ni al revés", () => {
    const { uso } = nueva();
    const chico = { topePagos: 20_000_000, rechazosPorDia: 2 };
    pagar(uso, premio({ puesto: 0 }), "fallo", chico);
    pagar(uso, premio({ puesto: 1 }), "fallo", chico);
    expect(uso.reservar(premio({ puesto: 2 }), AHORA, chico)).toMatchObject({ ok: false, motivo: "fondo", detalle: "rechazos" });
    expect(uso.reservar(retiro(), AHORA, chico)).toEqual(NUEVO);
  });
});

describe("reservar un pago que ya estaba", () => {
  it("el mismo hash otra vez no se cuenta de nuevo, aunque los topes ya no lo dejarían pasar", () => {
    const { uso } = nueva();
    const c = cuenta();
    const primero = retiro({ cuenta: c });
    expect(uso.reservar(primero, AHORA, LIM)).toEqual(NUEVO);
    expect(uso.reservar(primero, AHORA, { topePagos: 1, rechazosPorDia: 1 })).toEqual({ ok: true, yaContado: true });
    expect(uso.frenoPara(primero, AHORA, { topePagos: 1, rechazosPorDia: 1 })).toBeNull();
    expect(uso.enElAire()).toBe(1);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(OFERTA_RETIRO);
  });

  it("un pago cerrado tampoco se cuenta de nuevo", () => {
    const { uso } = nueva();
    const p = retiro();
    pagar(uso, p);
    expect(uso.reservar(p, AHORA, LIM)).toEqual({ ok: true, yaContado: true });
    expect(uso.buscar(p.hash)?.estado).toBe("ok");
  });

  it("un pago devuelto se reserva de nuevo con su misma fila, si pasa los topes", () => {
    const { uso } = nueva();
    const p = retiro();
    intentar(uso, p);
    expect(uso.buscar(p.hash)?.estado).toBe("devuelto");
    expect(uso.reservar(p, AHORA + 5_000, LIM)).toEqual(NUEVO);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "reservado", creado: AHORA + 5_000, real: null });
    expect(uso.exportar().pagos_portero).toHaveLength(1);
  });

  it("frenoPara mira lo mismo que reservar y no escribe nada", () => {
    const { uso } = nueva();
    const c = cuenta();
    const primero = retiro({ cuenta: c });
    uso.reservar(primero, AHORA, LIM);
    const otro = retiro({ cuenta: c });
    expect(uso.frenoPara(otro, AHORA, LIM)).toEqual({ motivo: "otro-en-curso", hash: primero.hash, vence: VENCE });
    expect(uso.frenoPara(retiro(), AHORA, LIM)).toBeNull();
    expect(uso.buscar(otro.hash)).toBeNull();
    expect(uso.exportar().pagos_portero).toHaveLength(1);
  });
});

describe("cerrar, devolver y lo que queda en el aire", () => {
  it("cerrar guarda lo que cobró la red y el resultado", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    uso.cerrar(p.hash, "fallo", 321);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "fallo", real: 321 });
    expect(uso.gastoDeLaVentana(AHORA)).toBe(321);
  });

  it("(ataque) un premio que se dio por devuelto y entró igual vuelve a ocupar su puesto: no se paga dos veces", () => {
    const { uso } = nueva();
    const p = premio({ puesto: 4 });
    intentar(uso, p);
    expect(uso.puestoUsado(CONTRATO, "5", 4)).toBeNull();
    uso.cerrar(p.hash, "ok", 210);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "ok", real: 210 });
    expect(uso.puestoUsado(CONTRATO, "5", 4)).toEqual({ hash: p.hash, estado: "ok" });
    expect(uso.reservar(premio({ puesto: 4 }), AHORA, LIM)).toMatchObject({ ok: false, motivo: "puesto-usado", hash: p.hash });
    expect(uso.gastoDeLaVentana(AHORA)).toBe(210);
  });

  it("un retiro que se dio por devuelto y entró igual cuenta su comisión y su lugar en el día", () => {
    const { uso } = nueva();
    const p = retiro();
    intentar(uso, p);
    uso.cerrar(p.hash, "fallo", 300);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "fallo", real: 300 });
    expect(uso.gastoDeLaVentana(AHORA)).toBe(300);
    expect(uso.resumen(AHORA).retiro.fallo24h).toBe(1);
  });

  it("(ataque) si el puesto de un premio devuelto que entró ya lo ocupa otro pago, no se pisa y se anota el pago doble", () => {
    const { uso, avisos } = nueva();
    const primero = premio({ puesto: 6 });
    intentar(uso, primero);
    const segundo = premio({ puesto: 6 });
    expect(uso.reservar(segundo, AHORA, LIM)).toEqual(NUEVO);
    uso.cerrar(primero.hash, "ok", 200);
    expect(uso.buscar(primero.hash)).toMatchObject({ estado: "devuelto", real: 200 });
    expect(uso.puestoUsado(CONTRATO, "5", 6)).toEqual({ hash: segundo.hash, estado: "reservado" });
    expect(avisos).toEqual([["error-interno", { donde: "pago-doble", forma: "premio" }]]);
  });

  it("(ataque) un pago ya cerrado no cambia de resultado: un premio pagado no libera su puesto", () => {
    const { uso } = nueva();
    const p = premio({ puesto: 8 });
    pagar(uso, p, "ok");
    uso.cerrar(p.hash, "fallo", 999);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "ok", real: 200 });
    expect(uso.puestoUsado(CONTRATO, "5", 8)).toEqual({ hash: p.hash, estado: "ok" });
  });

  it("un pago cerrado sin lo cobrado lo anota la vez siguiente", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    uso.cerrar(p.hash, "ok", null);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(OFERTA_RETIRO);
    uso.cerrar(p.hash, "ok", 280);
    expect(uso.buscar(p.hash)).toMatchObject({ estado: "ok", real: 280 });
  });

  it("devolver solo vale para lo que está en el aire: un pago cerrado nunca vuelve atrás", () => {
    const { uso } = nueva();
    const p = premio();
    pagar(uso, p);
    uso.devolver(p.hash);
    expect(uso.buscar(p.hash)?.estado).toBe("ok");
    const f = retiro();
    pagar(uso, f, "fallo");
    uso.devolver(f.hash);
    expect(uso.buscar(f.hash)?.estado).toBe("fallo");
  });

  it("cerrar o devolver algo que no existe no hace nada ni lanza", () => {
    const { uso } = nueva();
    uso.cerrar(hash(), "ok", 1);
    uso.devolver(hash());
    uso.marcarEnviado(hash());
    expect(uso.exportar().pagos_portero).toEqual([]);
  });

  it("pendientes lista lo que sigue en el aire desde antes de un momento, el más viejo primero", () => {
    const { uso } = nueva();
    const viejo = retiro();
    const nuevo = retiro();
    const cerrado = retiro();
    uso.reservar(viejo, AHORA, LIM);
    uso.reservar(nuevo, AHORA + 60_000, LIM);
    pagar(uso, cerrado);
    expect(uso.pendientes(AHORA + 30_000).map((f) => f.hash)).toEqual([viejo.hash]);
    expect(uso.pendientes(AHORA + 120_000).map((f) => f.hash)).toEqual([viejo.hash, nuevo.hash]);
    expect(uso.enElAire()).toBe(2);
    uso.marcarEnviado(viejo.hash);
    expect(uso.pendientes(AHORA + 30_000)).toHaveLength(1);
  });

  it("la fila guarda lo que se le pidió, con los nombres del código", () => {
    const { uso } = nueva();
    const p = premio({ sorteo: "42", puesto: 7, delLibro: false });
    uso.reservar(p, AHORA, LIM);
    expect(uso.buscar(p.hash)).toEqual({
      hash: p.hash,
      envuelta: p.envuelta,
      forma: "premio",
      cuenta: p.cuenta,
      delLibro: false,
      contrato: CONTRATO,
      sorteo: "42",
      puesto: 7,
      destinoHuella: huellaDeDestino((p.premio as NonNullable<PedidoDePago["premio"]>).destino),
      creado: AHORA,
      estado: "reservado",
      estimado: OFERTA_PREMIO,
      real: null,
      vence: VENCE,
    });
  });
});

describe("las firmas que explica la vigilancia", () => {
  it("cuentan solo las filas de cuentas que estaban en el libro: un retiro de una billetera propia no suma", () => {
    const { uso } = nueva();
    pagar(uso, retiro({ delLibro: true }));
    pagar(uso, retiro({ delLibro: false }));
    pagar(uso, premio({ delLibro: true }));
    pagar(uso, premio({ delLibro: false }));
    expect(uso.firmas(AHORA - 1)).toEqual({ premios: 1, retiros: 1 });
  });

  it("cuentan en cualquier estado, también el devuelto y el que falló: la persona firmó igual", () => {
    const { uso } = nueva();
    intentar(uso, retiro());
    pagar(uso, retiro(), "fallo");
    uso.reservar(premio(), AHORA, LIM);
    expect(uso.firmas(AHORA - 1)).toEqual({ premios: 1, retiros: 2 });
  });

  it("solo cuentan lo de después del momento que se pide", () => {
    const { uso } = nueva();
    pagar(uso, retiro());
    expect(uso.firmas(AHORA)).toEqual({ premios: 0, retiros: 0 });
    expect(uso.firmas(AHORA - 1)).toEqual({ premios: 0, retiros: 1 });
  });

  it("el resumen del día cuenta por forma, sin cuentas ni sorteos", () => {
    const { uso } = nueva();
    pagar(uso, retiro(), "ok");
    pagar(uso, retiro(), "fallo");
    pagar(uso, premio(), "ok");
    uso.reservar(premio(), AHORA, LIM);
    expect(uso.resumen(AHORA)).toEqual({
      gasto24h: 200 + 200 + 200 + OFERTA_PREMIO,
      enElAire: 1,
      premio: { enElAire: 1, ok24h: 1, fallo24h: 0 },
      retiro: { enElAire: 0, ok24h: 1, fallo24h: 1 },
    });
  });
});

describe("lo que guarda un retiro para reconocer su costo", () => {
  it("el retiro escribe su fila de retiros_cobrados en la misma transacción que su fila de pagos", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    expect(uso.exportar().retiros_cobrados).toEqual([{ hash: p.hash, envuelta: p.envuelta, cuenta: p.cuenta, costo: COSTO, ms: AHORA }]);
  });

  it("(ataque) si no se puede escribir la fila del costo, tampoco queda el pago: todo o nada", () => {
    const sql = sqlQueFallaEn(/INTO retiros_cobrados/);
    const uso = new UsoDePagos(sql);
    const p = retiro();
    expect(() => uso.reservar(p, AHORA, LIM)).toThrow();
    expect(uso.buscar(p.hash)).toBeNull();
    expect(uso.enElAire()).toBe(0);
    expect(uso.gastoDeLaVentana(AHORA)).toBe(0);
  });

  it("un premio no escribe nada en retiros_cobrados", () => {
    const { uso } = nueva();
    uso.reservar(premio(), AHORA, LIM);
    expect(uso.exportar().retiros_cobrados).toEqual([]);
  });

  it("la purga borra lo cerrado de hace más de 35 días, salvo los premios que entraron bien, y deja lo que está en el aire", () => {
    const { uso } = nueva();
    const retiroOk = retiro();
    const premioOk = premio({ puesto: 0 });
    const premioFallo = premio({ puesto: 1 });
    const premioDevuelto = premio({ puesto: 2 });
    const enElAire = retiro();
    pagar(uso, retiroOk);
    pagar(uso, premioOk);
    pagar(uso, premioFallo, "fallo");
    intentar(uso, premioDevuelto);
    uso.reservar(enElAire, AHORA, LIM);
    uso.purgar(AHORA + PURGA_USO_MS);
    expect(uso.exportar().pagos_portero).toHaveLength(5);
    uso.purgar(AHORA + PURGA_USO_MS + 1);
    expect(uso.exportar().pagos_portero.map((f) => f.hash).sort()).toEqual([premioOk.hash, enElAire.hash].sort());
  });

  it("la purga no borra la fila de retiros_cobrados, ni la de un retiro devuelto", () => {
    const { uso } = nueva();
    const cobrado = retiro();
    const devuelto = retiro();
    pagar(uso, cobrado);
    intentar(uso, devuelto);
    expect(uso.exportar().retiros_cobrados.map((f) => f.hash).sort()).toEqual([cobrado.hash, devuelto.hash].sort());
    uso.purgar(AHORA + 10 * PURGA_USO_MS);
    expect(uso.exportar().pagos_portero).toEqual([]);
    expect(uso.exportar().retiros_cobrados.map((f) => f.hash).sort()).toEqual([cobrado.hash, devuelto.hash].sort());
  });

  it("un retiro devuelto que entró igual se reconoce: conserva su fila de costo", () => {
    const { uso } = nueva();
    const p = retiro();
    intentar(uso, p);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(true);
  });
});

describe("costoDeRetiro reconoce el pago del costo de un retiro", () => {
  it("por el hash de adentro, por el de afuera, o por cualquiera de los dos si llegan juntos", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    const afuera = p.envuelta as string;
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(true);
    expect(uso.costoDeRetiro([afuera], p.cuenta, COSTO)).toBe(true);
    expect(uso.costoDeRetiro([hash(), p.hash], p.cuenta, COSTO)).toBe(true);
    expect(uso.costoDeRetiro([afuera, p.hash], p.cuenta, COSTO)).toBe(true);
  });

  it("(ataque) exige la misma cuenta y el costo exacto: otra cuenta, otro monto o otra transacción no", () => {
    const { uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    expect(uso.costoDeRetiro([p.hash], cuenta(), COSTO)).toBe(false);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO - 1)).toBe(false);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO + 1)).toBe(false);
    expect(uso.costoDeRetiro([hash()], p.cuenta, COSTO)).toBe(false);
  });

  it("lo que no es un hash no se busca, y sin hashes da false", () => {
    const { uso } = nueva();
    // Con letras: así el mismo hash en mayúsculas es otro texto (uno de solo números saldría igual).
    const p = retiro({ hash: "ab".repeat(32) });
    uso.reservar(p, AHORA, LIM);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(true);
    for (const malo of [[], [""], ["abc"], [p.hash.toUpperCase()], [`${p.hash}' OR 1=1 --`]]) {
      expect(uso.costoDeRetiro(malo, p.cuenta, COSTO), JSON.stringify(malo)).toBe(false);
    }
  });

  it("un premio no es el costo de ningún retiro", () => {
    const { uso } = nueva();
    const p = premio();
    uso.reservar(p, AHORA, LIM);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, OFERTA_PREMIO)).toBe(false);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(false);
  });

  it("con la tabla rota da false sin lanzar y lo anota una sola vez", () => {
    const { sql, uso, avisos } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    sql.db.exec("DROP TABLE retiros_cobrados");
    expect(uso.disponible()).toBe(true);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(false);
    expect(uso.costoDeRetiro([p.hash], p.cuenta, COSTO)).toBe(false);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.[0]).toBe("error-interno");
    expect(avisos[0]?.[1]).toMatchObject({ donde: "costo-retiro" });
  });

  it("con las tablas sin crear da false sin lanzar ni anotar nada", () => {
    const sql = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS retiros_cobrados/);
    const avisos: unknown[] = [];
    const uso = new UsoDePagos(sql, (...a) => void avisos.push(a));
    expect(uso.costoDeRetiro([hash()], cuenta(), COSTO)).toBe(false);
    expect(avisos).toEqual([]);
  });
});

describe("los topes en caliente respetan su techo", () => {
  const cfg = leerConfig({ RED: "mainnet" });
  const ajustes = (claves: Record<string, string>) => (k: string) => claves[k];

  it("sin ajustes valen los de la configuración", () => {
    expect(limitesDePagos(cfg, ajustes({}))).toEqual({ topePagos: 20_000_000, rechazosPorDia: 20 });
  });

  it("el presupuesto de 5 XLM vale, y el techo de 10 XLM también", () => {
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_TOPE_PAGOS]: "50000000" })).topePagos).toBe(50_000_000);
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_TOPE_PAGOS]: String(TECHO_TOPE_PAGOS_STROOPS) })).topePagos).toBe(100_000_000);
  });

  it("(ataque) un presupuesto de más de 10 XLM se ignora: vale el de la configuración", () => {
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_TOPE_PAGOS]: String(TECHO_TOPE_PAGOS_STROOPS + 1) })).topePagos).toBe(20_000_000);
  });

  it("los rechazos por día valen hasta 100, y más de 100 se ignora", () => {
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_RECHAZOS_DIA]: "50" })).rechazosPorDia).toBe(50);
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_RECHAZOS_DIA]: String(TECHO_PAGOS_RECHAZADOS_DIA) })).rechazosPorDia).toBe(100);
    expect(limitesDePagos(cfg, ajustes({ [AJUSTE_RECHAZOS_DIA]: String(TECHO_PAGOS_RECHAZADOS_DIA + 1) })).rechazosPorDia).toBe(20);
  });

  it("las altas de quien ganó por día valen hasta 300, y más de 300 se ignora", () => {
    expect(topeEnCaliente("250", 100, TECHO_ALTAS_PREMIO_DIA)).toBe(250);
    expect(topeEnCaliente(String(TECHO_ALTAS_PREMIO_DIA), 100, TECHO_ALTAS_PREMIO_DIA)).toBe(300);
    expect(topeEnCaliente(String(TECHO_ALTAS_PREMIO_DIA + 1), 100, TECHO_ALTAS_PREMIO_DIA)).toBe(100);
  });

  it.each(["", " ", "0", "00", "-3", "1.5", "1e3", "abc", "5 ", "99999999999999999"])("el ajuste mal escrito %j se ignora", (malo) => {
    expect(topeEnCaliente(malo, 100, TECHO_ALTAS_PREMIO_DIA)).toBe(100);
  });

  it("sin ajuste vale el de la configuración", () => {
    expect(topeEnCaliente(undefined, 100, TECHO_ALTAS_PREMIO_DIA)).toBe(100);
  });

  it("los ajustes se leen de la tabla de ajustes de cupos", () => {
    const cupos = new Cupos(sqlDePrueba());
    cupos.fijarAjuste(AJUSTE_TOPE_PAGOS, "30000000", AHORA);
    cupos.fijarAjuste(AJUSTE_RECHAZOS_DIA, "40", AHORA);
    expect(limitesDePagos(cfg, (k) => cupos.ajuste(k))).toEqual({ topePagos: 30_000_000, rechazosPorDia: 40 });
    expect(AJUSTE_ALTAS_PREMIO_DIA).toBe("altas_premio_dia");
  });

  it("las pausas tienen su ajuste por forma", () => {
    expect(AJUSTES_DE_PAUSA).toEqual({ premio: "pagos_premio_pausado", retiro: "retiros_pausado", "alta-premio": "altas_premio_pausado" });
  });
});

describe("las tablas, cada una con su propio try/catch", () => {
  it("las tablas de los pagos no las crea el constructor de Cupos: un portero sin pagos no las tiene", () => {
    const sql = sqlDePrueba();
    new Cupos(sql);
    const tablas = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((f) => String(f.name));
    expect(tablas).not.toContain("pagos_portero");
    expect(tablas).not.toContain("retiros_cobrados");
    new UsoDePagos(sql);
    const despues = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((f) => String(f.name));
    expect(despues).toEqual(expect.arrayContaining(["pagos_portero", "retiros_cobrados"]));
  });

  it("con todo creado, disponible da true y no falta nada", () => {
    const { uso } = nueva();
    expect(uso.disponible()).toBe(true);
    expect(uso.faltan()).toEqual([]);
  });

  it("arrancar dos veces sobre los mismos datos no cambia nada ni falla", () => {
    const { sql, uso } = nueva();
    const p = retiro();
    uso.reservar(p, AHORA, LIM);
    const otra = new UsoDePagos(sql);
    expect(otra.disponible()).toBe(true);
    expect(otra.exportar()).toEqual(uso.exportar());
  });

  it("un CREATE de una tabla que falla no lanza: disponible da false y faltan la nombra, con su índice", () => {
    const sql = sqlQueFallaEn(/CREATE TABLE IF NOT EXISTS retiros_cobrados/);
    const uso = new UsoDePagos(sql);
    expect(uso.disponible()).toBe(false);
    expect(uso.faltan()).toEqual(["retiros_cobrados", "retiros_cobrados_envuelta"]);
  });

  it("un CREATE de un índice que falla no lanza: disponible da false y faltan lo nombra", () => {
    const uso = new UsoDePagos(sqlQueFallaEn(/CREATE UNIQUE INDEX IF NOT EXISTS pagos_portero_puesto/));
    expect(uso.disponible()).toBe(false);
    expect(uso.faltan()).toEqual(["pagos_portero_puesto"]);
  });

  it("si falla todo, el constructor sigue sin lanzar y las dos tablas faltan", () => {
    const uso = new UsoDePagos(sqlQueFallaEn(/CREATE/));
    expect(uso.disponible()).toBe(false);
    expect(uso.faltan()).toHaveLength(8);
    expect(uso.faltan()).toEqual(expect.arrayContaining(["pagos_portero", "retiros_cobrados"]));
  });

  it("lo que falló al crear no tumba a Cupos sobre el mismo SQLite", () => {
    const sql = sqlQueFallaEn(/CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS (pagos_portero|retiros_cobrados)/);
    expect(new UsoDePagos(sql).disponible()).toBe(false);
    const cupos = new Cupos(sql);
    expect(cupos.columnasQueFaltan()).toEqual([]);
    expect(cupos.enElAire()).toBe(0);
  });

  it("exportar da las dos tablas, y de un premio solo la huella del destino, nunca su dirección", () => {
    const { uso } = nueva();
    const destino = cuenta();
    uso.reservar(premio({ destino }), AHORA, LIM);
    uso.reservar(retiro(), AHORA, LIM);
    const exporte = uso.exportar();
    expect(Object.keys(exporte)).toEqual(["pagos_portero", "retiros_cobrados"]);
    expect(exporte.pagos_portero).toHaveLength(2);
    expect(exporte.retiros_cobrados).toHaveLength(1);
    expect(JSON.stringify(exporte)).not.toContain(destino);
    expect(JSON.stringify(exporte)).toContain(huellaDeDestino(destino));
    expect(huellaDeDestino(destino)).toMatch(/^[0-9a-f]{32}$/);
  });
});
