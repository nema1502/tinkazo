import { Keypair } from "@stellar/stellar-sdk/base";
import { describe, expect, it } from "vitest";
import { EMISOR_USDC } from "./cobros";
import {
  ESPERA_CUENTA_MS,
  GUARDA_COBROS_MS,
  NOTA_FIJA_DE_RETIRO,
  type PagoPorMirar,
  crearMemoria,
  estaEnHorizon,
  mirarParaPagar,
} from "./pagos-horizon";
import type { NotaDePago, SalidaDePago } from "./pagos-lista";
import { HORIZON_MAINNET, ServidorAjeno, haciaHorizon } from "./servidores";

const ORIGEN = Keypair.random().publicKey();
const PERSONA = Keypair.random().publicKey();
const COBROS = Keypair.random().publicKey();
/** Lo que llega en un retiro (1 dólar) y el costo (0,50), en diezmillonésimas. */
const UNO = 10_000_000n;
const COSTO = 5_000_000n;
const HASH = "a".repeat(64);
const SIN_NOTA: NotaDePago = { tipo: "ninguna" };

/** La línea del USDC de Circle de una cuenta, con lo que da Horizon: siete decimales y las deudas. */
const linea = (o: Record<string, unknown> = {}) => ({
  asset_type: "credit_alphanum4",
  asset_code: "USDC",
  asset_issuer: EMISOR_USDC,
  balance: "10.0000000",
  limit: "922337203685.4775807",
  buying_liabilities: "0.0000000",
  selling_liabilities: "0.0000000",
  is_authorized: true,
  ...o,
});
const nativo = { asset_type: "native", balance: "0.0000000", buying_liabilities: "0.0000000", selling_liabilities: "0.0000000" };
const cuenta = (balances: unknown[] = [nativo, linea()], data: Record<string, string> = {}) => ({ id: "G", balances, data });

type Respuesta = () => Response | Promise<Response>;
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

/** Un Horizon de mentira: contesta lo que se le dice por cuenta y por transacción, y anota cada pedido. */
function horizonDe(cuentas: Record<string, Respuesta>, transacciones: Record<string, Respuesta> = {}) {
  const pedidos: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    pedidos.push({ url, init });
    const u = new URL(url);
    const quien = /^\/accounts\/([^/]+)$/.exec(u.pathname)?.[1];
    const tx = /^\/transactions\/([^/]+)$/.exec(u.pathname)?.[1];
    const respuesta = quien ? cuentas[quien] : tx ? transacciones[tx] : undefined;
    return respuesta ? respuesta() : json({ status: 404 }, 404);
  };
  const de = (g: string) => pedidos.filter((p) => p.url.endsWith(`/accounts/${g}`)).length;
  return { fetch, pedidos, de, pedir: haciaHorizon(fetch) };
}

/** Las tres cuentas de un retiro, todas con su línea y lugar. */
const sanas = (): Record<string, Respuesta> => ({
  [ORIGEN]: () => json(cuenta()),
  [PERSONA]: () => json(cuenta()),
  [COBROS]: () => json(cuenta()),
});

const premio = (o: Partial<PagoPorMirar> = {}): PagoPorMirar => ({
  forma: "premio",
  origen: ORIGEN,
  salidas: [{ destino: PERSONA, monto: 30_000_000n }],
  nota: { tipo: "texto", valor: "tk:premio:5:0" },
  ...o,
});
const retiro = (o: Partial<PagoPorMirar> = {}): PagoPorMirar => ({
  forma: "retiro",
  origen: ORIGEN,
  salidas: [
    { destino: PERSONA, monto: UNO },
    { destino: COBROS, monto: COSTO },
  ],
  nota: SIN_NOTA,
  ...o,
});
const mirar = (h: { pedir: ReturnType<typeof haciaHorizon> }, pago: PagoPorMirar, memoria = crearMemoria(COBROS, () => 0)) =>
  mirarParaPagar(h.pedir, pago, memoria);

describe("la mirada previa en Horizon pasa lo que la red aceptaría", () => {
  it("un premio con saldo en quien paga, y destino con línea autorizada y lugar", async () => {
    expect(await mirar(horizonDe(sanas()), premio())).toEqual({ ok: true });
  });

  it("un retiro: quien paga, quien recibe y la cuenta de cobros, los tres con su línea", async () => {
    expect(await mirar(horizonDe(sanas()), retiro())).toEqual({ ok: true });
  });

  it("el saldo justo alcanza: lo que sale es exactamente lo libre", async () => {
    const h = horizonDe({ ...sanas(), [ORIGEN]: () => json(cuenta([nativo, linea({ balance: "1.5000000" })])) });
    expect(await mirar(h, retiro())).toEqual({ ok: true });
  });

  it("pide cada cuenta una sola vez y con su tiempo de espera, aunque aparezca en dos pagos", async () => {
    const h = horizonDe(sanas());
    await mirar(h, retiro({ salidas: [{ destino: PERSONA, monto: UNO }, { destino: PERSONA, monto: COSTO }] }));
    expect(h.pedidos.map((p) => p.url).sort()).toEqual([`${HORIZON_MAINNET}/accounts/${ORIGEN}`, `${HORIZON_MAINNET}/accounts/${PERSONA}`].sort());
    for (const p of h.pedidos) {
      expect(p.init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(ESPERA_CUENTA_MS).toBe(8_000);
  });
});

describe("la mirada previa falla cerrada: sin una respuesta clara de Horizon no se paga", () => {
  const caidas: Array<[string, Respuesta]> = [
    ["un 503", () => json({ status: 503 }, 503)],
    ["un 429", () => json({ status: 429 }, 429)],
    ["un 500 sin cuerpo", () => new Response(null, { status: 500 })],
    ["el tiempo agotado", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
    ["la red cortada", () => Promise.reject(new TypeError("fetch failed"))],
    ["una respuesta sin saldos", () => json({ id: "G" })],
    ["saldos que no son una lista", () => json({ id: "G", balances: {} })],
    ["un cuerpo que no es JSON", () => new Response("<html>", { status: 200 })],
    ["una línea del USDC con un monto que no se entiende", () => json(cuenta([linea({ balance: "mucho" })]))],
    ["una línea del USDC sin límite", () => json(cuenta([linea({ limit: undefined })]))],
    ["una redirección", () => new Response(null, { status: 302, headers: { Location: "https://otro.example/" } })],
  ];

  it.each(caidas)("origen con %s da red y no afirma nada", async (_nombre, respuesta) => {
    expect(await mirar(horizonDe({ ...sanas(), [ORIGEN]: respuesta }), premio())).toEqual({ ok: false, motivo: "red" });
  });

  it.each(caidas)("destino con %s da red y no afirma nada", async (_nombre, respuesta) => {
    expect(await mirar(horizonDe({ ...sanas(), [PERSONA]: respuesta }), premio())).toEqual({ ok: false, motivo: "red" });
  });

  it("si una lectura falla gana la red aunque otra ya diga que fallaría", async () => {
    const h = horizonDe({ ...sanas(), [ORIGEN]: () => json(cuenta([nativo])), [PERSONA]: () => json({ status: 500 }, 500) });
    expect(await mirar(h, premio())).toEqual({ ok: false, motivo: "red" });
  });

  it("una cuenta mal escrita no se pide y da red", async () => {
    const h = horizonDe(sanas());
    expect(await mirar(h, premio({ salidas: [{ destino: "//horizon.otro.example", monto: UNO }] }))).toEqual({ ok: false, motivo: "red" });
    expect(h.pedidos.every((p) => p.url === `${HORIZON_MAINNET}/accounts/${ORIGEN}`)).toBe(true);
  });

  it.each([
    ["sin salidas", []],
    ["con un monto en cero", [{ destino: PERSONA, monto: 0n }]],
    ["con un monto negativo que bajaría lo que sale", [{ destino: PERSONA, monto: UNO }, { destino: COBROS, monto: -UNO }]],
  ] as Array<[string, SalidaDePago[]]>)("(ataque) un pago %s no se afirma y no se le pregunta nada a Horizon", async (_nombre, salidas) => {
    const h = horizonDe(sanas());
    expect(await mirar(h, retiro({ salidas }))).toEqual({ ok: false, motivo: "red" });
    expect(h.pedidos).toEqual([]);
  });
});

describe("la mirada previa dice lo que haría fallar a la red", () => {
  const dice = async (cuentas: Record<string, Respuesta>, pago: PagoPorMirar) => {
    const m = await mirar(horizonDe({ ...sanas(), ...cuentas }), pago);
    return m.ok ? "ok" : m.motivo === "fallaria" ? m.detalle : m.motivo;
  };

  it("la cuenta que paga no existe", async () => {
    expect(await dice({ [ORIGEN]: () => json({ status: 404 }, 404) }, premio())).toBe("origen-sin-cuenta");
  });

  it("la cuenta que paga no tiene la línea del USDC de Circle", async () => {
    expect(await dice({ [ORIGEN]: () => json(cuenta([nativo])) }, premio())).toBe("origen-sin-linea");
  });

  it("la cuenta que paga tiene un USDC de otro emisor, que no es la línea", async () => {
    const otro = linea({ asset_issuer: Keypair.random().publicKey() });
    expect(await dice({ [ORIGEN]: () => json(cuenta([nativo, otro])) }, premio())).toBe("origen-sin-linea");
  });

  it("la cuenta que paga tiene la línea sin autorización", async () => {
    expect(await dice({ [ORIGEN]: () => json(cuenta([nativo, linea({ is_authorized: false })])) }, premio())).toBe("origen-sin-linea");
  });

  it("la cuenta que paga no tiene saldo para el premio", async () => {
    expect(await dice({ [ORIGEN]: () => json(cuenta([nativo, linea({ balance: "2.9999999" })])) }, premio())).toBe("origen-sin-saldo");
  });

  it("el saldo de quien paga se cuenta sin lo que ya prometió vender", async () => {
    const vende = linea({ balance: "10.0000000", selling_liabilities: "7.5000000" });
    expect(await dice({ [ORIGEN]: () => json(cuenta([nativo, vende])) }, premio())).toBe("origen-sin-saldo");
  });

  it("un retiro necesita saldo para lo que llega y también para el costo", async () => {
    const justo = (balance: string) => ({ [ORIGEN]: () => json(cuenta([nativo, linea({ balance })])) });
    expect(await dice(justo("1.4999999"), retiro())).toBe("origen-sin-saldo");
    expect(await dice(justo("1.5000000"), retiro())).toBe("ok");
  });

  it("el destino no existe", async () => {
    expect(await dice({ [PERSONA]: () => json({ status: 404 }, 404) }, premio())).toBe("destino-sin-cuenta");
  });

  it("el destino no tiene la línea", async () => {
    expect(await dice({ [PERSONA]: () => json(cuenta([nativo])) }, premio())).toBe("destino-sin-linea");
  });

  it("el destino tiene la línea sin autorización", async () => {
    expect(await dice({ [PERSONA]: () => json(cuenta([nativo, linea({ is_authorized: false })])) }, premio())).toBe("destino-sin-linea");
  });

  it("una línea sin el dato de autorización se toma como autorizada", async () => {
    const sinDato = linea({ is_authorized: undefined });
    expect(await dice({ [PERSONA]: () => json(cuenta([nativo, sinDato])) }, premio())).toBe("ok");
  });

  it("el destino tiene la línea llena", async () => {
    const llena = linea({ balance: "900.0000000", limit: "900.0000000" });
    expect(await dice({ [PERSONA]: () => json(cuenta([nativo, llena])) }, premio())).toBe("destino-lleno");
  });

  it("el lugar del destino se cuenta sin lo que ya prometió comprar", async () => {
    const casi = (buying_liabilities: string) => linea({ balance: "5.0000000", limit: "10.0000000", buying_liabilities });
    const compra = (buying_liabilities: string) => ({ [PERSONA]: () => json(cuenta([nativo, casi(buying_liabilities)])) });
    expect(await dice(compra("2.0000001"), premio())).toBe("destino-lleno");
    expect(await dice(compra("2.0000000"), premio())).toBe("ok");
  });

  it("la cuenta de cobros sin línea o sin lugar frena el retiro", async () => {
    expect(await dice({ [COBROS]: () => json(cuenta([nativo])) }, retiro())).toBe("destino-sin-linea");
    expect(await dice({ [COBROS]: () => json(cuenta([nativo, linea({ balance: "5.0", limit: "5.2" })])) }, retiro())).toBe("destino-lleno");
  });
});

describe("la cuenta de cobros se guarda un minuto", () => {
  it("el segundo retiro dentro del minuto no vuelve a pedir la cuenta de cobros, y pasado el minuto sí", async () => {
    let ahora = 1_000_000;
    const memoria = crearMemoria(COBROS, () => ahora);
    const h = horizonDe(sanas());
    await mirarParaPagar(h.pedir, retiro(), memoria);
    expect(h.de(COBROS)).toBe(1);
    expect(h.pedidos).toHaveLength(3);
    ahora += GUARDA_COBROS_MS - 1;
    await mirarParaPagar(h.pedir, retiro(), memoria);
    expect(h.de(COBROS)).toBe(1);
    expect(h.pedidos).toHaveLength(5);
    ahora += 1;
    await mirarParaPagar(h.pedir, retiro(), memoria);
    expect(h.de(COBROS)).toBe(2);
  });

  it("una lectura que falló no se guarda: el retiro siguiente la vuelve a pedir", async () => {
    let cae = true;
    const memoria = crearMemoria(COBROS, () => 0);
    const h = horizonDe({ ...sanas(), [COBROS]: () => (cae ? json({ status: 503 }, 503) : json(cuenta())) });
    expect(await mirarParaPagar(h.pedir, retiro(), memoria)).toEqual({ ok: false, motivo: "red" });
    cae = false;
    expect(await mirarParaPagar(h.pedir, retiro(), memoria)).toEqual({ ok: true });
    expect(h.de(COBROS)).toBe(2);
  });

  it("una cuenta que no existe no se guarda", async () => {
    const memoria = crearMemoria(COBROS, () => 0);
    const h = horizonDe({ ...sanas(), [COBROS]: () => json({ status: 404 }, 404) });
    await mirarParaPagar(h.pedir, retiro(), memoria);
    await mirarParaPagar(h.pedir, retiro(), memoria);
    expect(h.de(COBROS)).toBe(2);
  });

  it("dos retiros a la vez comparten la misma lectura de la cuenta de cobros", async () => {
    const memoria = crearMemoria(COBROS, () => 0);
    const h = horizonDe(sanas());
    const dos = await Promise.all([mirarParaPagar(h.pedir, retiro(), memoria), mirarParaPagar(h.pedir, retiro(), memoria)]);
    expect(dos).toEqual([{ ok: true }, { ok: true }]);
    expect(h.de(COBROS)).toBe(1);
  });

  it("la lectura guardada vale para el costo pero la comprobación se hace con cada monto", async () => {
    const memoria = crearMemoria(COBROS, () => 0);
    const h = horizonDe({ ...sanas(), [COBROS]: () => json(cuenta([nativo, linea({ balance: "5.0", limit: "5.6" })])) });
    expect(await mirarParaPagar(h.pedir, retiro(), memoria)).toEqual({ ok: true });
    const grande = retiro({ salidas: [{ destino: PERSONA, monto: UNO }, { destino: COBROS, monto: 7_000_000n }] });
    expect(await mirarParaPagar(h.pedir, grande, memoria)).toEqual({ ok: false, motivo: "fallaria", detalle: "destino-lleno" });
    expect(h.de(COBROS)).toBe(1);
  });

  it("un reloj que va para atrás no estira la guarda", async () => {
    let ahora = 5_000_000;
    const memoria = crearMemoria(COBROS, () => ahora);
    const h = horizonDe(sanas());
    await mirarParaPagar(h.pedir, retiro(), memoria);
    ahora -= 1;
    await mirarParaPagar(h.pedir, retiro(), memoria);
    expect(h.de(COBROS)).toBe(2);
  });
});

describe("un destino que pide nota", () => {
  const pide = { [PERSONA]: () => json(cuenta([nativo, linea()], { "config.memo_required": "MQ==" })) };
  const dice = async (cuentas: Record<string, Respuesta>, pago: PagoPorMirar) => {
    const m = await mirar(horizonDe({ ...sanas(), ...cuentas }), pago);
    return m.ok ? "ok" : m.motivo === "fallaria" ? m.detalle : m.motivo;
  };

  it("(ataque) un premio nunca se paga a un destino que pide nota: la nota del premio es fija", async () => {
    expect(await dice(pide, premio())).toBe("destino-pide-nota");
  });

  it("(ataque) un retiro sin nota a un destino que pide nota se rechaza", async () => {
    expect(await dice(pide, retiro())).toBe("destino-pide-nota");
  });

  it("(ataque) un retiro con la nota fija de Tinkazo a un destino que pide nota se rechaza", async () => {
    expect(await dice(pide, retiro({ nota: { tipo: "texto", valor: NOTA_FIJA_DE_RETIRO } }))).toBe("destino-pide-nota");
  });

  it("un retiro con la nota numérica que pegó la persona a un destino que pide nota pasa", async () => {
    expect(await dice(pide, retiro({ nota: { tipo: "id", valor: "12345" } }))).toBe("ok");
  });

  it("un retiro con una nota de texto que pegó la persona a un destino que pide nota pasa", async () => {
    expect(await dice(pide, retiro({ nota: { tipo: "texto", valor: "mi-deposito-77" } }))).toBe("ok");
  });

  it("una nota de texto vacía no sirve para un destino que pide nota", async () => {
    expect(await dice(pide, retiro({ nota: { tipo: "texto", valor: "" } }))).toBe("destino-pide-nota");
  });

  it("(ataque) la cuenta de cobros que pidiera nota también frena el retiro sin nota", async () => {
    const cobrosPide = { [COBROS]: () => json(cuenta([nativo, linea()], { "config.memo_required": "MQ==" })) };
    expect(await dice(cobrosPide, retiro())).toBe("destino-pide-nota");
  });

  it("otro valor en el dato, o el dato en otra cuenta, no cuenta como pedir nota", async () => {
    const otroValor = { [PERSONA]: () => json(cuenta([nativo, linea()], { "config.memo_required": "MA==" })) };
    expect(await dice(otroValor, premio())).toBe("ok");
    const enOrigen = { [ORIGEN]: () => json(cuenta([nativo, linea()], { "config.memo_required": "MQ==" })) };
    expect(await dice(enOrigen, premio())).toBe("ok");
  });
});

describe("la mirada solo le habla al Horizon fijo del código", () => {
  it("todos los pedidos van a las cuentas del Horizon de la red principal, por una ruta limpia y sin seguir redirecciones", async () => {
    const h = horizonDe(sanas());
    await mirar(h, retiro());
    expect(h.pedidos.map((p) => p.url).sort()).toEqual([ORIGEN, PERSONA, COBROS].map((g) => `${HORIZON_MAINNET}/accounts/${g}`).sort());
    for (const p of h.pedidos) {
      expect(p.init?.redirect).toBe("manual");
    }
  });

  it("(ataque) una ruta que no es de Horizon no sale a ningún lado: el pedido fijo la rechaza con ServidorAjeno", async () => {
    const h = horizonDe(sanas());
    await expect(h.pedir("//otro.example/accounts/G")).rejects.toBeInstanceOf(ServidorAjeno);
    await expect(h.pedir("https://otro.example/")).rejects.toBeInstanceOf(ServidorAjeno);
    expect(h.pedidos).toEqual([]);
  });

  it("una redirección de Horizon no se sigue: da red", async () => {
    const h = horizonDe({ ...sanas(), [ORIGEN]: () => new Response(null, { status: 301, headers: { Location: "https://otro.example/" } }) });
    expect(await mirar(h, premio())).toEqual({ ok: false, motivo: "red" });
    expect(h.pedidos.every((p) => p.url.startsWith(HORIZON_MAINNET))).toBe(true);
  });
});

describe("estaEnHorizon", () => {
  const transaccion = (o: Record<string, unknown> = {}) => ({ id: HASH, hash: HASH, successful: true, fee_charged: "200", ...o });

  it("la transacción está y salió bien: dice cuánto cobró la red", async () => {
    const h = horizonDe({}, { [HASH]: () => json(transaccion()) });
    expect(await estaEnHorizon(h.pedir, HASH)).toEqual({ esta: true, ok: true, cobrado: 200 });
    expect(h.pedidos[0]?.url).toBe(`${HORIZON_MAINNET}/transactions/${HASH}`);
  });

  it("la transacción está y falló: ok en falso", async () => {
    const h = horizonDe({}, { [HASH]: () => json(transaccion({ successful: false, fee_charged: "300" })) });
    expect(await estaEnHorizon(h.pedir, HASH)).toEqual({ esta: true, ok: false, cobrado: 300 });
  });

  it("la transacción de adentro de un fee-bump se encuentra por su hash, como en el ejemplo real", async () => {
    const adentro = "93a2c960028652fc075ace78b123aa015fc59584843561f30181a39394d7cbe0";
    const h = horizonDe({}, { [adentro]: () => json(transaccion({ hash: adentro, fee_bump_transaction: { hash: "ea".repeat(32) } })) });
    expect(await estaEnHorizon(h.pedir, adentro)).toEqual({ esta: true, ok: true, cobrado: 200 });
  });

  it("un cobro que no se entiende no inventa un número", async () => {
    const h = horizonDe({}, { [HASH]: () => json(transaccion({ fee_charged: "mucho" })) });
    expect(await estaEnHorizon(h.pedir, HASH)).toEqual({ esta: true, ok: true, cobrado: null });
  });

  it("un 404 dice que no está", async () => {
    expect(await estaEnHorizon(horizonDe({}).pedir, HASH)).toEqual({ esta: false });
  });

  it.each([
    ["un 503", () => json({ status: 503 }, 503)],
    ["un 429", () => json({ status: 429 }, 429)],
    ["una redirección", () => new Response(null, { status: 302, headers: { Location: "https://otro.example/" } })],
    ["el tiempo agotado", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
    ["un cuerpo que no es JSON", () => new Response("no", { status: 200 })],
    ["un cuerpo sin si salió bien", () => json({ id: HASH })],
  ] as Array<[string, Respuesta]>)("con %s no se sabe", async (_nombre, respuesta) => {
    expect(await estaEnHorizon(horizonDe({}, { [HASH]: respuesta }).pedir, HASH)).toBeNull();
  });

  it("un hash que no es un hash no se pregunta", async () => {
    const h = horizonDe({});
    for (const malo of ["", "abc", "A".repeat(64), `${HASH}/../accounts`, "g".repeat(64)]) {
      expect(await estaEnHorizon(h.pedir, malo), malo).toBeNull();
    }
    expect(h.pedidos).toEqual([]);
  });
});
