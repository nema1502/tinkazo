import { describe, expect, it } from "vitest";
import { USDC_MAINNET } from "../stellar/pagos";
import { CENTAVO, DOLAR } from "./comision";
import { cuentaDePrueba } from "./cuentas-de-prueba";
import { estadoPorRpc, mirarLaComision, mirarLaComisionEnLaRed, pagoDeLaComision, pruebaDeSecuencia } from "./comision-red";

/** La mirada a la red de la comisión, con un `fetch` falso y sin reloj: cada caso arma sus registros a mano. */
const CUENTA = cuentaDePrueba(2);
const ORIGEN = cuentaDePrueba(5);
const OTRA = cuentaDePrueba(6);
const NOTA = "710126854477769";
const DESDE = Math.floor(Date.parse("2026-11-01T00:00:00Z") / 1000);
const BUSQUEDA = { cuenta: CUENTA, nota: NOTA, desde: DESDE };
const UMBRAL = 19_000_000n;

interface Cambios {
  to?: string;
  from?: string;
  type?: string;
  amount?: string;
  code?: string;
  issuer?: string;
  assetType?: string;
  memo?: string;
  memoType?: string;
  ok?: boolean;
  creado?: string;
  ficha?: string;
}

/** Un registro de `payments?join=transactions` de Horizon con lo que importa. */
function pago(c: Cambios = {}): Record<string, unknown> {
  return {
    type: c.type ?? "payment",
    transaction_successful: c.ok ?? true,
    to: c.to ?? CUENTA,
    from: c.from ?? ORIGEN,
    asset_type: c.assetType ?? "credit_alphanum4",
    asset_code: c.code ?? USDC_MAINNET.code,
    asset_issuer: c.issuer ?? USDC_MAINNET.issuer,
    amount: c.amount ?? "1.9000000",
    created_at: c.creado ?? "2026-11-20T15:00:00Z",
    paging_token: c.ficha ?? "100",
    transaction_hash: "a".repeat(64),
    transaction: { successful: c.ok ?? true, memo_type: c.memoType ?? "id", memo: c.memo ?? NOTA },
  };
}

const pagina = (registros: unknown[]): unknown => ({ _embedded: { records: registros } });

/** Un `fetch` que contesta con las páginas en orden y guarda las direcciones que le pidieron. */
function red(respuestas: Array<{ estado?: number; cuerpo?: unknown } | "corte">): { fetch: typeof fetch; pedidos: string[] } {
  const pedidos: string[] = [];
  let i = 0;
  const f = (async (url: string): Promise<Response> => {
    pedidos.push(String(url));
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r === "corte" || r === undefined) throw new Error("corte");
    return new Response(JSON.stringify(r.cuerpo ?? {}), { status: r.estado ?? 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, pedidos };
}

describe("el pago de un registro", () => {
  it("un pago de USDC de Circle con la nota cuenta", () => {
    expect(pagoDeLaComision(pago(), BUSQUEDA)).toBe(19_000_000n);
  });

  it("la nota de otro evento no cuenta", () => {
    expect(pagoDeLaComision(pago({ memo: "710126854477770" }), BUSQUEDA)).toBeNull();
  });

  it("la nota escrita como texto con las mismas cifras sí cuenta", () => {
    expect(pagoDeLaComision(pago({ memoType: "text", memo: NOTA }), BUSQUEDA)).toBe(19_000_000n);
  });

  it("una nota de texto distinta no cuenta", () => {
    expect(pagoDeLaComision(pago({ memoType: "text", memo: "hola" }), BUSQUEDA)).toBeNull();
  });

  it("una nota que no son cifras no cuenta y no lanza", () => {
    expect(pagoDeLaComision(pago({ memoType: "id", memo: "12abc" }), BUSQUEDA)).toBeNull();
  });

  it("otro activo con el mismo código y otro emisor no cuenta", () => {
    expect(pagoDeLaComision(pago({ issuer: cuentaDePrueba(8) }), BUSQUEDA)).toBeNull();
  });

  it("el XLM no cuenta", () => {
    expect(pagoDeLaComision(pago({ assetType: "native" }), BUSQUEDA)).toBeNull();
  });

  it("un pago fallado no cuenta", () => {
    expect(pagoDeLaComision(pago({ ok: false }), BUSQUEDA)).toBeNull();
  });

  it("un pago a otra cuenta no cuenta", () => {
    expect(pagoDeLaComision(pago({ to: OTRA }), BUSQUEDA)).toBeNull();
  });

  it("un monto sin la forma esperada no cuenta y no lanza", () => {
    expect(pagoDeLaComision(pago({ amount: "1,9" }), BUSQUEDA)).toBeNull();
    expect(pagoDeLaComision(pago({ amount: "-1.0000000" }), BUSQUEDA)).toBeNull();
  });

  it("un monto de menos de un centavo no cuenta", () => {
    expect(pagoDeLaComision(pago({ amount: "0.0000001" }), BUSQUEDA)).toBeNull();
  });

  it("con la cuenta de quien organiza, solo cuentan sus pagos", () => {
    expect(pagoDeLaComision(pago({ from: OTRA }), { ...BUSQUEDA, origen: ORIGEN })).toBeNull();
    expect(pagoDeLaComision(pago({ from: ORIGEN }), { ...BUSQUEDA, origen: ORIGEN })).toBe(19_000_000n);
  });

  it("algo que no es un registro no cuenta", () => {
    expect(pagoDeLaComision(null, BUSQUEDA)).toBeNull();
    expect(pagoDeLaComision("x", BUSQUEDA)).toBeNull();
  });
});

describe("mirar los pagos de la cuenta que recibe", () => {
  it("un pago que llega al umbral es pagada", async () => {
    const r = red([{ cuerpo: pagina([pago()]) }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "pagada", suma: 19_000_000n });
  });

  it("dos pagos parciales suman", async () => {
    const r = red([{ cuerpo: pagina([pago({ amount: "1.0000000", ficha: "2" }), pago({ amount: "0.9000000", ficha: "1" })]) }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch, porPagina: 5 })).toEqual({ tipo: "pagada", suma: 19_000_000n });
  });

  it("un centavo menos que el umbral es no-pagada con lo que llegó", async () => {
    const r = red([{ cuerpo: pagina([pago({ amount: "1.8900000" })]) }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch, porPagina: 5 })).toEqual({ tipo: "no-pagada", suma: 18_900_000n });
  });

  it("un registro más viejo que desde corta la mirada", async () => {
    const r = red([{ cuerpo: pagina([pago({ creado: "2026-10-01T00:00:00Z" })]) }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "no-pagada", suma: 0n });
  });

  it("un 404 es no-pagada con cero", async () => {
    const r = red([{ estado: 404 }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "no-pagada", suma: 0n });
  });

  it("un 500 es sin-consulta", async () => {
    const r = red([{ estado: 500 }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("un corte es sin-consulta", async () => {
    const r = red(["corte"]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("un cuerpo raro es sin-consulta", async () => {
    const r = red([{ cuerpo: { hola: 1 } }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("páginas llenas sin llegar al final son sin-consulta", async () => {
    const llena = { cuerpo: pagina([pago({ to: OTRA, ficha: "9" }), pago({ to: OTRA, ficha: "8" })]) };
    const r = red([llena, llena, llena]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch, porPagina: 2, maxPaginas: 3 })).toEqual({ tipo: "sin-consulta" });
  });

  it("el cursor de la página siguiente es el paging_token del último", async () => {
    const llena = { cuerpo: pagina([pago({ to: OTRA, ficha: "9" }), pago({ to: OTRA, ficha: "8" })]) };
    const r = red([llena, { cuerpo: pagina([]) }]);
    await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch, porPagina: 2 });
    expect(r.pedidos[1]).toContain("cursor=8");
  });

  it("el pedido lleva join=transactions, order=desc, limit=200 e include_failed=false", async () => {
    const r = red([{ cuerpo: pagina([]) }]);
    await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch });
    expect(r.pedidos[0]).toContain(`/accounts/${CUENTA}/payments`);
    expect(r.pedidos[0]).toContain("join=transactions");
    expect(r.pedidos[0]).toContain("order=desc");
    expect(r.pedidos[0]).toContain("limit=200");
    expect(r.pedidos[0]).toContain("include_failed=false");
  });

  it("un registro raro entre los buenos no corta la mirada", async () => {
    const r = red([{ cuerpo: pagina([{ cualquier: "cosa" }, pago()]) }]);
    expect(await mirarLaComision(BUSQUEDA, UMBRAL, { fetch: r.fetch, porPagina: 5 })).toEqual({ tipo: "pagada", suma: 19_000_000n });
  });

  it("con la cuenta de quien organiza se piden sus propios pagos", async () => {
    const r = red([{ cuerpo: pagina([pago()]) }]);
    await mirarLaComision({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch });
    expect(r.pedidos[0]).toContain(`/accounts/${ORIGEN}/payments`);
  });
});

describe("la mirada completa", () => {
  it("si la propia historia lo muestra pagado, no pide más", async () => {
    const r = red([{ cuerpo: pagina([pago()]) }]);
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "pagada", suma: 19_000_000n });
    expect(r.pedidos).toHaveLength(1);
  });

  it("si no está, mira lo que recibió la cuenta de Tinkazo y el pago de otra billetera cuenta", async () => {
    const r = red([{ cuerpo: pagina([]) }, { cuerpo: pagina([pago({ from: OTRA })]) }]);
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "pagada", suma: 19_000_000n });
    expect(r.pedidos[1]).toContain(`/accounts/${CUENTA}/payments`);
  });

  it("si la cuenta de Tinkazo tiene tantos pagos que no se termina de mirar, no traba: vale lo de la propia historia", async () => {
    const llena = { cuerpo: pagina([pago({ to: OTRA, ficha: "9" }), pago({ to: OTRA, ficha: "8" })]) };
    const r = red([{ cuerpo: pagina([]) }, llena, llena]);
    const op = { fetch: r.fetch, porPagina: 2, maxPaginas: 2 };
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, op)).toEqual({ tipo: "no-pagada", suma: 0n });
  });

  it("si la cuenta de Tinkazo no contesta, es sin-consulta: quien pagó desde otra billetera no ve Pagar de nuevo", async () => {
    const r = red([{ cuerpo: pagina([]) }, { estado: 500 }]);
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("si la cuenta de Tinkazo contesta con un corte, también es sin-consulta", async () => {
    const r = red([{ cuerpo: pagina([]) }, "corte"]);
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("si la propia historia no se puede ver y la otra sí, vale la otra", async () => {
    const r = red([{ estado: 500 }, { cuerpo: pagina([pago({ amount: "1.0000000" })]) }]);
    expect(await mirarLaComisionEnLaRed({ ...BUSQUEDA, origen: ORIGEN }, UMBRAL, { fetch: r.fetch })).toEqual({ tipo: "no-pagada", suma: 10_000_000n });
  });

  it("sin la cuenta de quien organiza mira solo la de Tinkazo", async () => {
    const r = red([{ cuerpo: pagina([pago()]) }]);
    await mirarLaComisionEnLaRed(BUSQUEDA, UMBRAL, { fetch: r.fetch });
    expect(r.pedidos).toHaveLength(1);
  });
});

/** Un registro de `transactions` de Horizon. */
function transaccion(c: { fuente?: string; sec: string; memo?: string; memoType?: string; ok?: boolean; ficha?: string }): Record<string, unknown> {
  return {
    source_account: c.fuente ?? ORIGEN,
    source_account_sequence: c.sec,
    successful: c.ok ?? true,
    hash: "b".repeat(64),
    memo_type: c.memoType ?? "none",
    memo: c.memo,
    paging_token: c.ficha ?? "1",
  };
}

describe("la prueba de que la mirada está al día", () => {
  it("la más nueva de la cuenta tiene la secuencia leída y sin la nota es al-dia", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ sec: "500" })]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "al-dia" });
  });

  it("una secuencia más nueva que los pagos viejos es atrasada y no se manda", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ sec: "500" })]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 501n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "atrasada" });
  });

  it("una transacción exitosa de la cuenta con la nota es ya-hay-pago", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ sec: "500", memoType: "id", memo: NOTA })]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "ya-hay-pago", hash: "b".repeat(64) });
  });

  it("la misma nota en una transacción fallada no es un pago", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ sec: "500", memoType: "id", memo: NOTA, ok: false })]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "al-dia" });
  });

  it("las transacciones de otras cuentas no cuentan para la secuencia", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ fuente: OTRA, sec: "900" }), transaccion({ sec: "500" })]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "al-dia" });
  });

  it("una cuenta que nunca mandó nada y conserva su secuencia de origen es al-dia", async () => {
    const r = red([{ cuerpo: pagina([]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 4_294_967_296n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "al-dia" });
  });

  it("sin transacciones propias y con una secuencia que ya se movió es atrasada", async () => {
    const r = red([{ cuerpo: pagina([]) }]);
    expect(await pruebaDeSecuencia(ORIGEN, 4_294_967_297n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "atrasada" });
  });

  it("sin respuesta es sin-consulta", async () => {
    const r = red([{ estado: 503 }]);
    expect(await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch })).toEqual({ tipo: "sin-consulta" });
  });

  it("el pedido es el listado de transacciones de la cuenta, de la más nueva a la más vieja", async () => {
    const r = red([{ cuerpo: pagina([transaccion({ sec: "500" })]) }]);
    await pruebaDeSecuencia(ORIGEN, 500n, NOTA, { fetch: r.fetch });
    expect(r.pedidos[0]).toContain(`/accounts/${ORIGEN}/transactions`);
    expect(r.pedidos[0]).toContain("order=desc");
  });
});

describe("el respaldo que no es Horizon", () => {
  it("una transacción con éxito en el RPC entró", async () => {
    const r = red([{ cuerpo: { result: { status: "SUCCESS" } } }]);
    expect(await estadoPorRpc("c".repeat(64), { fetch: r.fetch, rpcs: ["https://rpc.ejemplo"] })).toBe("entro");
  });

  it("una que el RPC no encuentra, no está", async () => {
    const r = red([{ cuerpo: { result: { status: "NOT_FOUND" } } }]);
    expect(await estadoPorRpc("c".repeat(64), { fetch: r.fetch, rpcs: ["https://rpc.ejemplo"] })).toBe("no-esta");
  });

  it("sin respuesta no se sabe", async () => {
    const r = red(["corte"]);
    expect(await estadoPorRpc("c".repeat(64), { fetch: r.fetch, rpcs: ["https://rpc.ejemplo"] })).toBe("no-se-sabe");
  });

  it("un hash mal escrito no se pregunta", async () => {
    const r = red([{ cuerpo: {} }]);
    expect(await estadoPorRpc("xx", { fetch: r.fetch })).toBe("no-se-sabe");
    expect(r.pedidos).toHaveLength(0);
  });
});

describe("lo que se usa de los montos", () => {
  it("un dólar y un centavo en stroops", () => {
    expect(DOLAR).toBe(10_000_000n);
    expect(CENTAVO).toBe(100_000n);
  });
});
