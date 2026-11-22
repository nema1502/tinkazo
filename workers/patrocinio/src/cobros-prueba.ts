/**
 * Lo que comparten las pruebas de los pagos: un portero de mainnet con las altas y el pago prendidos, un Horizon de
 * mentira que contesta los pagos de la cuenta de cobros en orden ascendente y por cursor, como el de verdad, y la
 * administración sobre el mismo SQLite. Sin red ni Cloudflare. No entra en el Worker.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { Administracion } from "./admin";
import { type PollarDeMentira, SECRETO_CUPON, montarAltas } from "./altas-prueba";
import { Cobros, type Conversion, EMISOR_USDC, LectorDeCobros } from "./cobros";
import { ComprasQr } from "./compras";
import { type Env, leerConfig, unidadDe } from "./config";
import { PuertaAltas } from "./rutas-altas";
import { HORIZON_MAINNET } from "./servidores";

/** Inventadas, solo para las pruebas: la cuenta que recibe los pagos y quien paga. */
export const COBROS = Keypair.random().publicKey();
export const PAGADOR = Keypair.random().publicKey();

/** Un pago como lo cuenta la prueba; el Horizon de mentira lo escribe con la forma de Horizon. */
export interface PagoHorizon {
  /** Con siete decimales como los da Horizon: `"2.0000000"`. */
  monto: string;
  /** La nota de texto. */
  nota?: string;
  /** La nota numérica (`MEMO_ID`), como texto. */
  memoId?: string;
  /** El id de la operación; si no, uno que crece, más grande que un entero seguro de JavaScript. */
  op?: string;
  tx?: string;
  /** El hash de la transacción de adentro, si la transacción viene envuelta en un fee-bump (`inner_transaction.hash`). */
  interna?: string;
  de?: string;
  a?: string;
  /** Por defecto, el USDC de Circle. */
  emisor?: string;
  codigo?: string;
  /** XLM. */
  nativo?: boolean;
  tipo?: string;
  exitoso?: boolean;
  ms?: number;
}

export function horizonDeCobros(cuenta: string) {
  const pagos: Array<PagoHorizon & { id: string }> = [];
  /**
   * `retener`: la respuesta se arma con los pagos del momento del pedido y sale recién cuando esa promesa se cumple,
   * como una lectura en curso que tarda.
   */
  const estado = { caido: false, pedidos: [] as string[], fallar: (_n: number) => false, retener: null as Promise<void> | null };
  let n = 0;
  /** Suma pagos a la cuenta, en orden; devuelve sus ids. */
  const sumar = (...ps: PagoHorizon[]): string[] =>
    ps.map((p) => {
      const id = p.op ?? String(250_000_000_000_000_000n + BigInt(++n) * 4097n);
      pagos.push({ ...p, id });
      return id;
    });
  /** La nota de la transacción como la cuenta Horizon: de texto, numérica o ninguna. */
  const memoDe = (p: PagoHorizon) => {
    if (p.nota !== undefined) {
      return { memo_type: "text", memo: p.nota };
    }
    if (p.memoId !== undefined) {
      return { memo_type: "id", memo: p.memoId };
    }
    return { memo_type: "none" };
  };
  const registro = (p: PagoHorizon & { id: string }) => ({
    id: p.id,
    paging_token: p.id,
    type: p.tipo ?? "payment",
    transaction_successful: p.exitoso ?? true,
    transaction_hash: p.tx ?? `tx${p.id}`,
    created_at: new Date(p.ms ?? 1_790_000_000_000).toISOString().replace(".000Z", "Z"),
    from: p.de ?? PAGADOR,
    to: p.a ?? cuenta,
    ...(p.nativo ? { asset_type: "native" } : { asset_type: "credit_alphanum4", asset_code: p.codigo ?? "USDC", asset_issuer: p.emisor ?? EMISOR_USDC }),
    amount: p.monto,
    transaction: { ...memoDe(p), ...(p.interna !== undefined ? { inner_transaction: { hash: p.interna } } : {}) },
  });
  const resp = (status: number, cuerpo: unknown) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  const fetch = async (url: string) => {
    estado.pedidos.push(url);
    const u = new URL(url);
    if (u.origin !== HORIZON_MAINNET) return resp(404, {});
    if (estado.caido || estado.fallar(estado.pedidos.length)) return resp(503, { status: 503 });
    const m = /^\/accounts\/([^/]+)\/payments$/.exec(u.pathname);
    if (!m || decodeURIComponent(m[1] as string) !== cuenta) return resp(404, { status: 404 });
    if (u.searchParams.get("order") !== "asc") return resp(400, { status: 400 });
    const limite = Math.min(Number(u.searchParams.get("limit") ?? 10), 200);
    const cursor = u.searchParams.get("cursor");
    const desde = cursor ? pagos.filter((p) => BigInt(p.id) > BigInt(cursor)) : pagos;
    const trozo = desde.slice(0, limite).map(registro);
    const ultimo = trozo.at(-1)?.paging_token ?? cursor ?? "";
    if (estado.retener) await estado.retener;
    return resp(200, { _links: { next: { href: `${HORIZON_MAINNET}/accounts/${cuenta}/payments?cursor=${ultimo}&limit=${limite}&order=asc` } }, _embedded: { records: trozo } });
  };
  return { pagos, estado, sumar, fetch };
}

/** Los ids de orden que van a salir, en orden: deterministas para las pruebas. */
export const IDS = ["ABCD2345", "K7M29QXA", "4HTR0PQZ", "MN56VWXY", "1234ABCD", "ZZZZ0000"];

/**
 * Los precios de las pruebas de los pagos, fijos y con los tres productos: 2, 5 y 20 USDC, todos por un año. No son los
 * que se venden (esos son `PRECIOS_POR_DEFECTO`): las pruebas miran cómo se paga, no cuánto.
 */
export const PRECIOS_DE_PRUEBA = "alta:2:3:365,p10:5:10:365,p50:20:50:365";

/**
 * Los precios de las pruebas de la venta por unidad: 1 USDC por sorteo, por un año, junto a los paquetes de siempre.
 */
export const PRECIOS_POR_UNIDAD = "sorteo:1:1:365,alta:2:3:365,p10:5:10:365";

export function montarPagos(
  env: Partial<Env> = {},
  opciones: { cadaMs?: number; sql?: NonNullable<Parameters<typeof montarAltas>[1]>["sql"]; porUnidad?: boolean } = {},
) {
  const m = montarAltas({ ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: PRECIOS_DE_PRUEBA, ...env }, opciones.sql ? { sql: opciones.sql } : {});
  const h = horizonDeCobros(COBROS);
  let i = 0;
  // Con `porUnidad`, como en el objeto con el producto por unidad en `PRECIOS`: la conversión mira los frenos de la puerta y
  // cada lectura refresca antes el saldo de créditos. Sin eso, todo como siempre.
  let puertaDeLaConversion: PuertaAltas | null = null;
  const unidad = unidadDe(m.cfg);
  const conversion: Conversion | null =
    opciones.porUnidad && unidad ? { precio: () => unidad, permite: (c, ahora) => puertaDeLaConversion?.permiteConvertir(c, ahora) ?? false } : null;
  // Y la lectura nueva: los pagos chicos sin orden no escriben fila y la lectura se pone al día con muchas páginas.
  const vigilante = conversion ? { vigilante: true } : {};
  const cobros = new Cobros(m.sql, m.cupos, { idAlAzar: () => IDS[i++] ?? "QQQQ9999", ...(conversion ? { conversion } : {}), ...vigilante });
  const registrar = (e: string, d?: Record<string, string | number>) => void m.anotado.push([e, d]);
  const pollar = m.pollar;
  const antes = conversion && pollar ? { antes: () => pollar.creditos(), alDia: true } : {};
  const lector = new LectorDeCobros({ cobros, cuenta: COBROS, fetch: h.fetch, reloj: m.hora, registrar, cadaMs: opciones.cadaMs ?? 0, ...antes });
  // Como en el objeto: si al arrancar no se pudo sumar la hora del último aviso, la vigilancia la cuenta sin ella.
  const compras = new ComprasQr(m.sql, m.cfg);
  if (m.cupos.faltaColumna("compras_qr", "avisada")) compras.sinHoraDeAviso();
  const puerta = new PuertaAltas({ cfg: m.cfg, cupos: m.cupos, altas: m.altas, pollar: m.pollar, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar, cobros, lector, compras });
  puertaDeLaConversion = puerta;
  const admin = new Administracion({ cfg: m.cfg, cupos: m.cupos, altas: m.altas, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar, cobros, lector, compras });
  const pm: PollarDeMentira = m.pm;
  const ip = "190.129.10.20";
  /**
   * La misma puerta sobre el mismo SQLite con otras variables, como queda el portero después de desplegar con otro
   * `wrangler.toml`: lo guardado sigue y lo que se decide con las variables cambia.
   */
  const conVariables = (otras: Partial<Env>) => {
    const cfg = leerConfig({ RED: "mainnet", ALTAS: "1", POLLAR_APP_ID: m.cfg.pollarAppId ?? "", ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, PRECIOS: PRECIOS_DE_PRUEBA, ...env, ...otras });
    const otra = new PuertaAltas({ cfg, cupos: m.cupos, altas: m.altas, pollar: m.pollar, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar, cobros, lector, compras: new ComprasQr(m.sql, cfg) });
    return {
      puerta: otra,
      estado: (token: string | null) => otra.estado({ token, ip, cuerpo: {} }),
      orden: (token: string | null, producto: unknown) => otra.atenderPago("orden", { token, ip, cuerpo: { producto } }),
      empezar: (token: string | null, producto: unknown) => otra.atenderCompra("empezar", { token, ip, cuerpo: { producto } }),
      cargar: (token: string | null, producto: unknown) => otra.atenderCompra("cargar", { token, ip, cuerpo: { producto } }),
      anular: (token: string | null, producto: unknown) => otra.atenderCompra("anular", { token, ip, cuerpo: { producto } }),
    };
  };
  return {
    ...m,
    pm,
    h,
    cobros,
    lector,
    compras,
    puerta,
    admin,
    conVariables,
    estado: (token: string | null) => puerta.estado({ token, ip, cuerpo: {} }),
    cupon: (token: string | null, c: unknown) => puerta.cupon({ token, ip, cuerpo: { cupon: c } }),
    orden: (token: string | null, producto: unknown) => puerta.atenderPago("orden", { token, ip, cuerpo: { producto } }),
    /** La orden por unidad: el producto `sorteo` con su cantidad. */
    ordenPorUnidad: (token: string | null, cantidad: unknown) => puerta.atenderPago("orden", { token, ip, cuerpo: { producto: "sorteo", cantidad } }),
    pago: (token: string | null, orden: unknown) => puerta.atenderPago("pago", { token, ip, cuerpo: { orden } }),
    empezar: (token: string | null, producto: unknown) => puerta.atenderCompra("empezar", { token, ip, cuerpo: { producto } }),
    /** El aviso de carga; `extra` suma campos al cuerpo (`{reemplazar: true}`). */
    cargar: (token: string | null, producto: unknown, extra: Record<string, unknown> = {}) => puerta.atenderCompra("cargar", { token, ip, cuerpo: { ...extra, producto } }),
    anular: (token: string | null, producto: unknown) => puerta.atenderCompra("anular", { token, ip, cuerpo: { producto } }),
    adminAnotadoDe: (evento: string) => m.anotado.filter(([e]) => e === evento),
    derechosDe: (usuario: string) => m.sql.exec("SELECT ref, sorteos, usados, origen, cuenta FROM derechos WHERE usuario = ? ORDER BY id", usuario).toArray(),
    sueltos: () => m.sql.exec("SELECT operacion, activo, monto, nota, motivo, estado, orden FROM pagos_sueltos ORDER BY ms, operacion").toArray(),
    filasDePagos: () => m.sql.exec("SELECT operacion, orden, monto FROM pagos ORDER BY operacion").toArray(),
  };
}
