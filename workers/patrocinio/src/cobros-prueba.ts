/**
 * Lo que comparten las pruebas de los pagos: un portero de mainnet con las altas y el pago prendidos, un Horizon de
 * mentira que contesta los pagos de la cuenta de cobros en orden ascendente y por cursor, como el de verdad, y la
 * administración sobre el mismo SQLite. Sin red ni Cloudflare. No entra en el Worker.
 */
import { Keypair } from "@stellar/stellar-sdk/base";
import { Administracion } from "./admin";
import { type PollarDeMentira, SECRETO_CUPON, montarAltas } from "./altas-prueba";
import { Cobros, EMISOR_USDC, LectorDeCobros } from "./cobros";
import type { Env } from "./config";
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
  const estado = { caido: false, pedidos: [] as string[], fallar: (_n: number) => false };
  let n = 0;
  /** Suma pagos a la cuenta, en orden; devuelve sus ids. */
  const sumar = (...ps: PagoHorizon[]): string[] =>
    ps.map((p) => {
      const id = p.op ?? String(250_000_000_000_000_000n + BigInt(++n) * 4097n);
      pagos.push({ ...p, id });
      return id;
    });
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
    transaction: p.nota !== undefined ? { memo_type: "text", memo: p.nota } : p.memoId !== undefined ? { memo_type: "id", memo: p.memoId } : { memo_type: "none" },
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
    return resp(200, { _links: { next: { href: `${HORIZON_MAINNET}/accounts/${cuenta}/payments?cursor=${ultimo}&limit=${limite}&order=asc` } }, _embedded: { records: trozo } });
  };
  return { pagos, estado, sumar, fetch };
}

/** Los ids de orden que van a salir, en orden: deterministas para las pruebas. */
export const IDS = ["ABCD2345", "K7M29QXA", "4HTR0PQZ", "MN56VWXY", "1234ABCD", "ZZZZ0000"];

export function montarPagos(env: Partial<Env> = {}, opciones: { cadaMs?: number } = {}) {
  const m = montarAltas({ ALTAS_PAGO: "1", CUENTA_COBROS: COBROS, ...env });
  const h = horizonDeCobros(COBROS);
  let i = 0;
  const cobros = new Cobros(m.sql, m.cupos, { idAlAzar: () => IDS[i++] ?? "QQQQ9999" });
  const registrar = (e: string, d?: Record<string, string | number>) => void m.anotado.push([e, d]);
  const lector = new LectorDeCobros({ cobros, cuenta: COBROS, fetch: h.fetch, reloj: m.hora, registrar, cadaMs: opciones.cadaMs ?? 0 });
  const puerta = new PuertaAltas({ cfg: m.cfg, cupos: m.cupos, altas: m.altas, pollar: m.pollar, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar, cobros, lector });
  const admin = new Administracion({ cfg: m.cfg, cupos: m.cupos, altas: m.altas, cuponSecreto: SECRETO_CUPON, red: m.red, reloj: m.hora, registrar, cobros, lector });
  const pm: PollarDeMentira = m.pm;
  const ip = "190.129.10.20";
  return {
    ...m,
    pm,
    h,
    cobros,
    lector,
    puerta,
    admin,
    estado: (token: string | null) => puerta.estado({ token, ip, cuerpo: {} }),
    cupon: (token: string | null, c: unknown) => puerta.cupon({ token, ip, cuerpo: { cupon: c } }),
    orden: (token: string | null, producto: unknown) => puerta.atenderPago("orden", { token, ip, cuerpo: { producto } }),
    pago: (token: string | null, orden: unknown) => puerta.atenderPago("pago", { token, ip, cuerpo: { orden } }),
    adminAnotadoDe: (evento: string) => m.anotado.filter(([e]) => e === evento),
    derechosDe: (usuario: string) => m.sql.exec("SELECT ref, sorteos, usados, origen, cuenta FROM derechos WHERE usuario = ? ORDER BY id", usuario).toArray(),
    sueltos: () => m.sql.exec("SELECT operacion, activo, monto, nota, motivo, estado, orden FROM pagos_sueltos ORDER BY ms, operacion").toArray(),
    filasDePagos: () => m.sql.exec("SELECT operacion, orden, monto FROM pagos ORDER BY operacion").toArray(),
  };
}
