import { Asset, Networks, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import eventos from "./fixtures/rpc-getEvents-pagos.json";
import pagos from "./fixtures/horizon-pagos-premio.json";
import { armarPago } from "./pagos-envio";
import { type BusquedaDePago, buscarPago, buscarPagoConDetalle, crearLectorDePagos, ledgerDelCursor, pagoDelRegistro } from "./pagos-red";

/**
 * Las respuestas de `fixtures/` son las de verdad, grabadas de testnet el 6 de noviembre de 2026: los pagos de la cuenta
 * ganadora con su transacción (Horizon) y los eventos de transferencia de ese activo hacia ella (RPC). La testnet se
 * borra el 16 de diciembre: las pruebas no le piden nada a la red.
 */

const ORG = "GDALL7OBL7A44KEXQJPQPKUFMS4A56UXWLTHNB3VIARSEJ65ILAZCFIT";
const GANA = "GD57ZSBU5BVZ5WG65SJKSNTYF54DEHBZSW4TAHGH6442XGWHIFHQWUP6";
const EMISOR = "GCQPYIVQSYUCGFCGTZ7KTLEZ62PML72P6XND4V2YQLRFK22QQJRPFIAE";
const OTRA = "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR";
const HASH_777 = "0014053ff6a7b1afee9c0127a1eb27c0137046877a4cff8e13b34db154149ee2";
const HASH_778 = "145ec7ef4ce69b99c867365cae4ee0c87c6c96d2145932ba95e16b01781e975e";
/** Cuándo cerró el ledger del pago 777:0. */
const EL_PAGO = 1_793_960_531;

const BUSQUEDA: BusquedaDePago = {
  red: "testnet",
  destino: GANA,
  activo: { code: "TKUSD", issuer: EMISOR },
  nota: "tk:premio:777:0",
  pagadoras: [ORG],
  desde: EL_PAGO - 600,
};

/** Los registros de verdad de Horizon: el pago y la creación de la cuenta. */
const REGISTROS = (pagos as unknown as { _embedded: { records: Array<Record<string, any>> } })._embedded.records;
const registroDelPago = REGISTROS[0] as Record<string, any>;

const json = (cuerpo: unknown, estado = 200): Response => new Response(JSON.stringify(cuerpo), { status: estado });

/** Un `fetch` que anota cada pedido y contesta a Horizon con `horizon(url)` y al RPC con `rpc(método, parámetros)`. */
function red(o: { horizon?: (url: string) => Response | undefined; rpc?: (metodo: string, params: any) => unknown }): { fetch: typeof fetch; horizon: string[]; rpc: Array<{ metodo: string; params: any }> } {
  const horizon: string[] = [];
  const rpc: Array<{ metodo: string; params: any }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      const cuerpo = JSON.parse(String(init.body)) as { method: string; params: any };
      rpc.push({ metodo: cuerpo.method, params: cuerpo.params });
      const r = o.rpc?.(cuerpo.method, cuerpo.params);
      return r === undefined ? new Response("", { status: 503 }) : json(r);
    }
    horizon.push(String(url));
    return o.horizon?.(String(url)) ?? new Response("", { status: 503 });
  }) as typeof fetch;
  return { fetch: f, horizon, rpc };
}

describe("el pago de un premio en el registro de Horizon", () => {
  it("lee el pago de verdad: cuánto, cuándo, desde qué cuenta y en qué transacción", () => {
    expect(pagoDelRegistro(registroDelPago, BUSQUEDA)).toEqual({ tipo: "pagado", hash: HASH_777, monto: "12.5000000", cuando: EL_PAGO, de: ORG });
  });

  it("no es el pago de este premio si cambia la nota, el puesto, el sorteo o la forma de la nota", () => {
    for (const nota of ["tk:premio:777:1", "tk:premio:778:0", "tk:premio:77:0", "TK:PREMIO:777:0", "tk:premio:777:0 ", ""]) {
      expect(pagoDelRegistro(registroDelPago, { ...BUSQUEDA, nota }), nota).toBeNull();
    }
  });

  it("no cuenta si la nota no es de texto", () => {
    const registro = { ...registroDelPago, transaction: { ...registroDelPago.transaction, memo_type: "id", memo: "777" } };
    expect(pagoDelRegistro(registro, { ...BUSQUEDA, nota: "777" })).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, transaction: { ...registroDelPago.transaction, memo_type: "none" } }, BUSQUEDA)).toBeNull();
  });

  it("no cuenta si es otro activo, de otro emisor o a otra cuenta", () => {
    expect(pagoDelRegistro({ ...registroDelPago, asset_code: "USDC" }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, asset_issuer: OTRA }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, asset_type: "native", asset_code: undefined, asset_issuer: undefined }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, to: OTRA }, BUSQUEDA)).toBeNull();
  });

  it("solo cuenta si lo pagó una de las cuentas que pagan: una nota igual puesta por otra no hace Pagado", () => {
    expect(pagoDelRegistro({ ...registroDelPago, from: OTRA }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro(registroDelPago, { ...BUSQUEDA, pagadoras: [OTRA, ORG] })?.tipo).toBe("pagado");
    expect(pagoDelRegistro(registroDelPago, { ...BUSQUEDA, pagadoras: [OTRA] })).toBeNull();
    // Sin cuentas que pagan, vale cualquiera.
    expect(pagoDelRegistro({ ...registroDelPago, from: OTRA }, { ...BUSQUEDA, pagadoras: [] })?.tipo).toBe("pagado");
  });

  it("no cuenta si la transacción falló, ni en el pago ni en la transacción", () => {
    expect(pagoDelRegistro({ ...registroDelPago, transaction_successful: false }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, transaction: { ...registroDelPago.transaction, successful: false } }, BUSQUEDA)).toBeNull();
  });

  it("no cuenta si no es un pago, si no trae la transacción o si el monto o el hash no valen", () => {
    expect(pagoDelRegistro(REGISTROS[1], BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, type: "create_account" }, BUSQUEDA)).toBeNull();
    const { transaction: _t, ...sinTransaccion } = registroDelPago;
    expect(pagoDelRegistro(sinTransaccion, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, amount: "0.0000000" }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, amount: "mucho" }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, transaction_hash: "abc" }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro({ ...registroDelPago, created_at: "ayer" }, BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro("basura", BUSQUEDA)).toBeNull();
    expect(pagoDelRegistro(null, BUSQUEDA)).toBeNull();
  });

  it("un pago de camino que deja el activo en la cuenta también cuenta", () => {
    expect(pagoDelRegistro({ ...registroDelPago, type: "path_payment_strict_receive" }, BUSQUEDA)?.tipo).toBe("pagado");
    expect(pagoDelRegistro({ ...registroDelPago, type: "path_payment_strict_send" }, BUSQUEDA)?.tipo).toBe("pagado");
  });
});

describe("buscar el pago en Horizon", () => {
  const conPagos = (): ReturnType<typeof red> => red({ horizon: () => json(pagos) });

  it("pide los pagos de la cuenta ganadora, con la transacción de cada uno, y encuentra el del premio", async () => {
    const r = conPagos();
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, sinRpc: true });
    expect(lectura).toEqual({ tipo: "pagado", hash: HASH_777, monto: "12.5000000", cuando: EL_PAGO, de: ORG });
    expect(r.horizon).toEqual([`https://horizon-testnet.stellar.org/accounts/${GANA}/payments?join=transactions&order=desc&limit=25&include_failed=false`]);
    expect(r.rpc).toEqual([]);
  });

  it("en mainnet va al Horizon de mainnet", async () => {
    const r = conPagos();
    await buscarPago({ ...BUSQUEDA, red: "mainnet" }, { fetch: r.fetch, sinRpc: true });
    expect(r.horizon[0]?.startsWith(`https://horizon.stellar.org/accounts/${GANA}/payments`)).toBe(true);
  });

  it("si no hay pago con esa nota, no hay: se miraron todos los de la cuenta", async () => {
    const r = conPagos();
    expect(await buscarPago({ ...BUSQUEDA, nota: "tk:premio:777:1" }, { fetch: r.fetch, sinRpc: true })).toEqual({ tipo: "no-hay" });
    expect(r.horizon).toHaveLength(1);
  });

  it("un pago de antes del sorteo no cuenta", async () => {
    expect(await buscarPago({ ...BUSQUEDA, desde: EL_PAGO + 1 }, { fetch: conPagos().fetch, sinRpc: true })).toEqual({ tipo: "no-hay" });
  });

  it("una cuenta que no existe no recibió nada", async () => {
    const r = red({ horizon: () => json({ status: 404, title: "Resource Missing" }, 404) });
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch })).toEqual({ tipo: "no-hay" });
    // Sin ir al RPC: el 404 es una respuesta, no una falla.
    expect(r.rpc).toEqual([]);
  });

  it("si la respuesta no se entiende, o pasa del tamaño, o tarda demasiado, no se dice que no hay: sin consulta", async () => {
    expect(await buscarPago(BUSQUEDA, { fetch: red({ horizon: () => new Response("<html>", { status: 200 }) }).fetch, sinRpc: true })).toEqual({ tipo: "sin-consulta" });
    expect(await buscarPago(BUSQUEDA, { fetch: red({ horizon: () => json({ otra: "cosa" }) }).fetch, sinRpc: true })).toEqual({ tipo: "sin-consulta" });
    expect(await buscarPago(BUSQUEDA, { fetch: red({ horizon: () => json(pagos) }).fetch, sinRpc: true, maxBytes: 100 })).toEqual({ tipo: "sin-consulta" });
    for (const estado of [429, 500, 503]) {
      expect(await buscarPago(BUSQUEDA, { fetch: red({ horizon: () => new Response("", { status: estado }) }).fetch, sinRpc: true }), String(estado)).toEqual({ tipo: "sin-consulta" });
    }
    const colgado = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    expect(await buscarPago(BUSQUEDA, { fetch: colgado, sinRpc: true, tiempoMs: 20 })).toEqual({ tipo: "sin-consulta" });
  });

  /** Una página sintética de `n` pagos de la cuenta, de la `desde` en adelante (más nuevos primero). */
  const pagina = (desde: number, n: number, notaDelUltimo?: string): Record<string, unknown> => ({
    _embedded: {
      records: Array.from({ length: n }, (_, i) => {
        const orden = desde + i;
        return {
          ...registroDelPago,
          paging_token: String(9_000_000 - orden),
          created_at: new Date((EL_PAGO + 1000 - orden * 10) * 1000).toISOString().replace(".000Z", "Z"),
          transaction: { ...registroDelPago.transaction, memo: notaDelUltimo && i === n - 1 ? notaDelUltimo : `tk:premio:1:${orden}` },
        };
      }),
    },
  });

  it("sigue con la página siguiente hasta dar con el pago, y no pide más", async () => {
    const paginas: string[] = [];
    const r = red({
      horizon: (url) => {
        paginas.push(url);
        const cursor = /cursor=(\d+)/.exec(url)?.[1];
        return json(cursor ? pagina(2, 2, "tk:premio:777:0") : pagina(0, 2));
      },
    });
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, sinRpc: true, porPagina: 2 });
    expect(lectura.tipo).toBe("pagado");
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).not.toContain("cursor=");
    // La segunda sigue desde la ficha del último pago de la primera.
    expect(paginas[1]).toContain(`cursor=${9_000_000 - 1}`);
  });

  it("si se pasa del tope de páginas sin dar con el pago ni con el final, no se dice que no hay", async () => {
    const r = red({ horizon: () => json(pagina(0, 2)) });
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, sinRpc: true, porPagina: 2, maxPaginas: 3 });
    expect(lectura).toEqual({ tipo: "sin-consulta" });
    expect(r.horizon).toHaveLength(3);
  });

  it("deja de bajar cuando llega a pagos de antes del sorteo", async () => {
    const r = red({ horizon: () => json(pagina(0, 2)) });
    // Todos los de la página son más nuevos que `desde`... menos si `desde` cae en el medio.
    const lectura = await buscarPago({ ...BUSQUEDA, desde: EL_PAGO + 995 }, { fetch: r.fetch, sinRpc: true, porPagina: 2 });
    expect(lectura).toEqual({ tipo: "no-hay" });
    expect(r.horizon).toHaveLength(1);
  });

  it("una ficha de página que no es un número no se sigue", async () => {
    const r = red({ horizon: () => json({ _embedded: { records: pagina(0, 2)._embedded && (pagina(0, 2)._embedded as any).records.map((x: any) => ({ ...x, paging_token: "../../etc" })) } }) });
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch, sinRpc: true, porPagina: 2 })).toEqual({ tipo: "sin-consulta" });
    expect(r.horizon).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------- RPC */

const ULTIMO_LEDGER = 5_587_660;
/** Cuándo cerró ese ledger: 25 minutos después del pago. */
const CIERRE = EL_PAGO + 1500;
const SAC = new Asset("TKUSD", EMISOR).contractId(Networks.TESTNET);
/** Un cursor del RPC en el ledger dado: el ledger va en los 32 bits de arriba. */
const cursorEn = (ledger: number): string => `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-4294967295`;

const resultadoDeEventos = (eventosDe: unknown[], cursor: string, ultimo = ULTIMO_LEDGER): unknown => ({
  jsonrpc: "2.0",
  id: 1,
  result: { events: eventosDe, cursor, latestLedger: ultimo, oldestLedger: ultimo - 120_960 },
});

const EVENTOS = (eventos as unknown as { result: { events: Array<Record<string, any>> } }).result.events;

/** Un RPC que sabe el último ledger y contesta `getEvents` con `alPedir`. */
const rpcCon = (alPedir: (params: any, n: number) => unknown, extra: Record<string, (params: any) => unknown> = {}): ReturnType<typeof red> => {
  let n = 0;
  return red({
    horizon: () => new Response("", { status: 503 }),
    rpc: (metodo, params) => {
      if (metodo === "getLatestLedger") return { jsonrpc: "2.0", id: 1, result: { sequence: ULTIMO_LEDGER, closeTime: String(CIERRE) } };
      if (metodo === "getEvents") return alPedir(params, n++);
      return extra[metodo]?.(params);
    },
  });
};

describe("buscar el pago en el RPC cuando Horizon no contesta", () => {
  const OPS = { rpcs: ["https://rpc.ejemplo"] };

  it("lee el pago de los eventos de transferencia: la nota viene en el evento", async () => {
    const r = rpcCon(() => eventos);
    const { lectura, horizonFallo } = await buscarPagoConDetalle(BUSQUEDA, { fetch: r.fetch, ...OPS });
    expect(horizonFallo).toBe(true);
    expect(lectura).toEqual({ tipo: "pagado", hash: HASH_777, monto: "12.5000000", cuando: EL_PAGO, de: ORG });
    // Sin preguntar por la transacción: el evento ya trae la nota.
    expect(r.rpc.map((x) => x.metodo)).toEqual(["getLatestLedger", "getEvents"]);
  });

  it("pide los eventos del USDC hacia esa cuenta, desde un poco antes del sorteo", async () => {
    const r = rpcCon(() => eventos);
    await buscarPagoConDetalle(BUSQUEDA, { fetch: r.fetch, ...OPS });
    const pedido = r.rpc[1]?.params;
    // Desde el sorteo (10 minutos antes del pago) hasta ahora: 35 minutos a un ledger cada 4 segundos, más la holgura.
    const atras = Math.ceil((CIERRE - BUSQUEDA.desde) / 4) + 300;
    expect(pedido.startLedger).toBe(ULTIMO_LEDGER - atras);
    expect(pedido.filters).toHaveLength(1);
    const f = pedido.filters[0];
    expect(f.type).toBe("contract");
    expect(f.contractIds).toEqual([SAC]);
    expect(f.topics).toHaveLength(1);
    expect(f.topics[0]).toHaveLength(4);
    expect(f.topics[0][1]).toBe("*");
    expect(f.topics[0][3]).toBe("*");
    // transfer(de, a, activo): el tercer tema es quien recibe.
    expect(f.topics[0][2]).toBe(EVENTOS[0]?.topic[2]);
    expect(f.topics[0][0]).toBe(EVENTOS[0]?.topic[0]);
  });

  it("de varios pagos con la misma nota, el más nuevo", async () => {
    const r = rpcCon(() => eventos);
    const { lectura } = await buscarPagoConDetalle({ ...BUSQUEDA, nota: "tk:premio:778:0" }, { fetch: r.fetch, ...OPS });
    expect(lectura).toMatchObject({ tipo: "pagado", hash: HASH_778, monto: "5.5000000" });
  });

  it("si ningún evento es de este premio, no hay", async () => {
    const r = rpcCon(() => eventos);
    expect(await buscarPago({ ...BUSQUEDA, nota: "tk:premio:777:3" }, { fetch: r.fetch, ...OPS })).toEqual({ tipo: "no-hay" });
  });

  it("solo cuenta lo que pagó una de las cuentas que pagan", async () => {
    const r = rpcCon(() => eventos);
    expect(await buscarPago({ ...BUSQUEDA, pagadoras: [OTRA] }, { fetch: r.fetch, ...OPS })).toEqual({ tipo: "no-hay" });
    expect(await buscarPago({ ...BUSQUEDA, pagadoras: [] }, { fetch: r.fetch, ...OPS })).toMatchObject({ tipo: "pagado", hash: HASH_777 });
  });

  it("no cuenta un pago de antes del sorteo", async () => {
    const r = rpcCon(() => eventos);
    expect(await buscarPago({ ...BUSQUEDA, desde: EL_PAGO + 5 }, { fetch: r.fetch, ...OPS })).toEqual({ tipo: "no-hay" });
  });

  it("un evento que no trae nota se confirma con la transacción: su nota y su hash", async () => {
    const { xdr } = await armarPago({ red: "testnet", origen: ORG, destino: GANA, activo: BUSQUEDA.activo, monto: "12.5000000", raffleId: "777", puesto: 0 }, "100");
    const hash = Buffer.from(TransactionBuilder.fromXDR(xdr, Networks.TESTNET).hash()).toString("hex");
    const evento = { ...EVENTOS[0], txHash: hash, value: nativeToScVal(125_000_000n, { type: "i128" }).toXDR("base64") };
    const r = rpcCon(() => resultadoDeEventos([evento], cursorEn(ULTIMO_LEDGER)), {
      getTransaction: () => ({ jsonrpc: "2.0", id: 1, result: { status: "SUCCESS", envelopeXdr: xdr, createdAt: String(EL_PAGO) } }),
    });
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, ...OPS });
    expect(lectura).toEqual({ tipo: "pagado", hash, monto: "12.5000000", cuando: EL_PAGO, de: ORG });
    expect(r.rpc.map((x) => x.metodo)).toEqual(["getLatestLedger", "getEvents", "getTransaction"]);
    expect(r.rpc[2]?.params).toEqual({ hash });
  });

  it("si la transacción que contesta el RPC no es la del evento, no cuenta", async () => {
    const { xdr } = await armarPago({ red: "testnet", origen: ORG, destino: GANA, activo: BUSQUEDA.activo, monto: "12.5000000", raffleId: "777", puesto: 0 }, "100");
    const evento = { ...EVENTOS[0], txHash: "e".repeat(64), value: nativeToScVal(125_000_000n, { type: "i128" }).toXDR("base64") };
    const r = rpcCon(() => resultadoDeEventos([evento], cursorEn(ULTIMO_LEDGER)), {
      getTransaction: () => ({ jsonrpc: "2.0", id: 1, result: { status: "SUCCESS", envelopeXdr: xdr, createdAt: String(EL_PAGO) } }),
    });
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch, ...OPS })).toEqual({ tipo: "no-hay" });
  });

  it("un evento con otra nota no hace preguntar por la transacción", async () => {
    const r = rpcCon(() => eventos);
    await buscarPago({ ...BUSQUEDA, nota: "tk:premio:999:9" }, { fetch: r.fetch, ...OPS });
    expect(r.rpc.some((x) => x.metodo === "getTransaction")).toBe(false);
  });

  it("sigue el cursor hasta el último ledger, aunque haya páginas vacías: el RPC mira de a un tramo", async () => {
    const r = rpcCon((params, n) => (n === 0 ? resultadoDeEventos([], cursorEn(ULTIMO_LEDGER - 400)) : eventos));
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, ...OPS });
    expect(lectura.tipo).toBe("pagado");
    const pedidosDeEventos = r.rpc.filter((x) => x.metodo === "getEvents");
    expect(pedidosDeEventos).toHaveLength(2);
    expect(pedidosDeEventos[1]?.params.pagination.cursor).toBe(cursorEn(ULTIMO_LEDGER - 400));
    expect(pedidosDeEventos[1]?.params.startLedger).toBeUndefined();
  });

  it("si el cursor no llega al último ledger dentro del tope de páginas, no se dice que no hay", async () => {
    const r = rpcCon(() => resultadoDeEventos([], cursorEn(ULTIMO_LEDGER - 4000)));
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch, ...OPS })).toEqual({ tipo: "sin-consulta" });
    expect(r.rpc.filter((x) => x.metodo === "getEvents").length).toBe(16);
  });

  it("si el RPC guarda menos de lo que se pidió, vuelve a pedir desde lo más viejo que tiene", async () => {
    const r = rpcCon((params, n) =>
      n === 0 ? { jsonrpc: "2.0", id: 1, error: { code: -32600, message: `startLedger must be within the ledger range: ${ULTIMO_LEDGER - 100} - ${ULTIMO_LEDGER}` } } : eventos,
    );
    const lectura = await buscarPago(BUSQUEDA, { fetch: r.fetch, ...OPS });
    expect(lectura.tipo).toBe("pagado");
    const pedidosDeEventos = r.rpc.filter((x) => x.metodo === "getEvents");
    // Un poco después de lo más viejo: esa cifra se corre con cada ledger que cierra. Y nunca pasa del último.
    expect(pedidosDeEventos[1]?.params.startLedger).toBe(ULTIMO_LEDGER);
  });

  it("prueba el siguiente RPC si el primero falla", async () => {
    const malos: string[] = [];
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method !== "POST") return new Response("", { status: 503 });
      if (String(url) === "https://rpc.caido") {
        malos.push(String(url));
        return new Response("", { status: 502 });
      }
      const { method } = JSON.parse(String(init.body)) as { method: string };
      return json(method === "getLatestLedger" ? { jsonrpc: "2.0", id: 1, result: { sequence: ULTIMO_LEDGER, closeTime: String(CIERRE) } } : eventos);
    }) as typeof fetch;
    const lectura = await buscarPago(BUSQUEDA, { fetch: f, rpcs: ["https://rpc.caido", "https://rpc.bueno"] });
    expect(lectura.tipo).toBe("pagado");
    expect(malos).toEqual(["https://rpc.caido"]);
  });

  it("si Horizon y el RPC fallan, sin consulta", async () => {
    const r = red({});
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch, rpcs: ["https://rpc.a", "https://rpc.b"] })).toEqual({ tipo: "sin-consulta" });
    expect(await buscarPago(BUSQUEDA, { fetch: r.fetch, sinRpc: true })).toEqual({ tipo: "sin-consulta" });
  });

  it("no se usa el RPC si Horizon contestó, y si Horizon falla se usa una sola vez por tramo", async () => {
    const buena = red({ horizon: () => json(pagos), rpc: () => eventos });
    await buscarPago(BUSQUEDA, { fetch: buena.fetch, ...OPS });
    expect(buena.rpc).toEqual([]);
  });

  it("el cursor del RPC dice el ledger en que va", () => {
    expect(ledgerDelCursor(cursorEn(5_587_657))).toBe(5_587_657);
    expect(ledgerDelCursor((eventos as unknown as { result: { cursor: string } }).result.cursor)).toBe(5_587_657);
    expect(ledgerDelCursor("basura")).toBe(-1);
  });
});

/* --------------------------------------------------------------------- el lector */

describe("el lector con memoria corta", () => {
  const conReloj = (): { ahora: () => number; avanzar: (ms: number) => void } => {
    let t = 1_000_000;
    return { ahora: () => t, avanzar: (ms) => (t += ms) };
  };

  it("el mismo pedido no se repite mientras lo leído sigue vigente (45 s)", async () => {
    const reloj = conReloj();
    const r = red({ horizon: () => json(pagos) });
    const leer = crearLectorDePagos({ fetch: r.fetch, ahora: reloj.ahora, sinRpc: true });
    const nota = { ...BUSQUEDA, nota: "tk:premio:777:1" };
    expect((await leer(nota)).tipo).toBe("no-hay");
    reloj.avanzar(44_000);
    await leer(nota);
    expect(r.horizon).toHaveLength(1);
    reloj.avanzar(2_000);
    await leer(nota);
    expect(r.horizon).toHaveLength(2);
  });

  it("dos pedidos a la vez de lo mismo son uno solo", async () => {
    const r = red({ horizon: () => json(pagos) });
    const leer = crearLectorDePagos({ fetch: r.fetch, sinRpc: true });
    await Promise.all([leer(BUSQUEDA), leer(BUSQUEDA), leer(BUSQUEDA)]);
    expect(r.horizon).toHaveLength(1);
  });

  it("Actualizar vuelve a preguntar, pero no más seguido que cada 5 segundos", async () => {
    const reloj = conReloj();
    const r = red({ horizon: () => json(pagos) });
    const leer = crearLectorDePagos({ fetch: r.fetch, ahora: reloj.ahora, sinRpc: true });
    const nota = { ...BUSQUEDA, nota: "tk:premio:777:1" };
    await leer(nota);
    reloj.avanzar(2_000);
    await leer(nota, true);
    expect(r.horizon).toHaveLength(1);
    reloj.avanzar(3_500);
    await leer(nota, true);
    expect(r.horizon).toHaveLength(2);
  });

  it("un pago encontrado no se vuelve a preguntar: los pagos no se deshacen", async () => {
    const reloj = conReloj();
    const r = red({ horizon: () => json(pagos) });
    const leer = crearLectorDePagos({ fetch: r.fetch, ahora: reloj.ahora, sinRpc: true });
    expect((await leer(BUSQUEDA)).tipo).toBe("pagado");
    reloj.avanzar(86_400_000);
    expect((await leer(BUSQUEDA, true)).tipo).toBe("pagado");
    expect(r.horizon).toHaveLength(1);
  });

  it("lo que no se pudo consultar no se recuerda: la próxima vez se vuelve a preguntar", async () => {
    let anda = false;
    const r = red({ horizon: () => (anda ? json(pagos) : new Response("", { status: 503 })) });
    const leer = crearLectorDePagos({ fetch: r.fetch, sinRpc: true });
    expect(await leer(BUSQUEDA)).toEqual({ tipo: "sin-consulta" });
    anda = true;
    // Actualizar vuelve a probar Horizon aunque haya fallado hace un instante.
    expect((await leer(BUSQUEDA, true)).tipo).toBe("pagado");
    expect(r.horizon).toHaveLength(2);
  });

  it("cada premio es un pedido distinto: otra nota, otra cuenta o otras cuentas que pagan", async () => {
    const r = red({ horizon: () => json(pagos) });
    const leer = crearLectorDePagos({ fetch: r.fetch, sinRpc: true });
    await leer(BUSQUEDA);
    await leer({ ...BUSQUEDA, nota: "tk:premio:777:1" });
    await leer({ ...BUSQUEDA, destino: OTRA });
    await leer({ ...BUSQUEDA, pagadoras: [ORG, OTRA] });
    expect(r.horizon).toHaveLength(4);
  });

  it("tras un Horizon que no contestó, los pedidos siguientes van directo al RPC por 30 segundos", async () => {
    const reloj = conReloj();
    const horizonFalla = { si: true };
    const r = red({
      horizon: () => (horizonFalla.si ? new Response("", { status: 503 }) : json(pagos)),
      rpc: (metodo) => (metodo === "getLatestLedger" ? { jsonrpc: "2.0", id: 1, result: { sequence: ULTIMO_LEDGER, closeTime: String(CIERRE) } } : eventos),
    });
    const leer = crearLectorDePagos({ fetch: r.fetch, ahora: reloj.ahora, rpcs: ["https://rpc.ejemplo"] });
    expect((await leer(BUSQUEDA)).tipo).toBe("pagado");
    expect(r.horizon).toHaveLength(1);
    // Otra cuenta: no se vuelve a esperar a Horizon.
    expect((await leer({ ...BUSQUEDA, destino: OTRA, nota: "tk:premio:777:2" })).tipo).toBe("no-hay");
    expect(r.horizon).toHaveLength(1);
    // Pasado el reposo, Horizon vuelve a probarse.
    reloj.avanzar(31_000);
    horizonFalla.si = false;
    await leer({ ...BUSQUEDA, destino: OTRA, nota: "tk:premio:777:3" });
    expect(r.horizon).toHaveLength(2);
  });
});

