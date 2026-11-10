import { EMISOR_USDC, type Red } from "./reglas";
import { HORIZON } from "./pagos";

/**
 * Un Horizon de mentira para las pruebas (del Worker y del sitio): contesta `GET /accounts/<cuenta>` y
 * `GET /accounts/<cuenta>/payments` con la forma de Horizon. Solo lo usan las pruebas; nada de la página lo importa.
 */

export interface PagoFalso {
  de: string;
  a: string;
  /** Con siete decimales como los da Horizon: `"5.0000000"`. */
  monto: string;
  tx: string;
  /** La nota de texto de la transacción. */
  memo?: string;
  /** Por defecto, el USDC oficial de la red. */
  emisor?: string;
  codigo?: string;
  tipo?: string;
  exitoso?: boolean;
  ms?: number;
}

export function registroDePago(p: PagoFalso, red: Red): Record<string, unknown> {
  return {
    id: `op-${p.tx}`,
    type: p.tipo ?? "payment",
    transaction_successful: p.exitoso ?? true,
    transaction_hash: p.tx,
    created_at: new Date(p.ms ?? 1_790_000_000_000).toISOString().replace(".000Z", "Z"),
    from: p.de,
    to: p.a,
    asset_type: "credit_alphanum4",
    asset_code: p.codigo ?? "USDC",
    asset_issuer: p.emisor ?? EMISOR_USDC[red],
    amount: p.monto,
    transaction: p.memo === undefined ? { memo_type: "none" } : { memo_type: "text", memo: p.memo },
  };
}

export interface OpcionesDelHorizonFalso {
  red?: Red;
  /** Las cuentas que existen en la red. */
  cuentas?: string[];
  /** Por cuenta, sus pagos del más nuevo al más viejo (los que entran y los que salen). */
  pagos?: Record<string, PagoFalso[]>;
  /** Cuántos registros entran en una página (200 en Horizon). */
  porPagina?: number;
  /** Contesta 503 a todo. */
  caido?: boolean;
}

export interface HorizonFalso {
  fetch: typeof fetch;
  /** Las direcciones que se pidieron, en orden. */
  pedidos: string[];
}

export function horizonFalso(o: OpcionesDelHorizonFalso = {}): HorizonFalso {
  const red = o.red ?? "testnet";
  const base = HORIZON[red];
  const pedidos: string[] = [];
  const f = (async (entrada: string | URL | Request) => {
    const url = new URL(String(entrada));
    pedidos.push(String(entrada));
    if (o.caido) return new Response("{}", { status: 503 });
    const m = /^\/accounts\/([^/]+)(\/payments)?$/.exec(url.pathname);
    if (!m) return new Response("{}", { status: 404 });
    const cuenta = decodeURIComponent(m[1] as string);
    const existe = (o.cuentas ?? []).includes(cuenta) || cuenta in (o.pagos ?? {});
    if (!existe) return new Response(JSON.stringify({ status: 404, title: "Resource Missing" }), { status: 404 });
    if (!m[2]) return new Response(JSON.stringify({ id: cuenta, balances: [] }), { status: 200 });
    const lista = o.pagos?.[cuenta] ?? [];
    const porPagina = Math.min(Number(url.searchParams.get("limit") ?? 10), o.porPagina ?? 200);
    const desde = Number(url.searchParams.get("cursor") ?? 0);
    const trozo = lista.slice(desde, desde + porPagina).map((p) => registroDePago(p, red));
    const cuerpo = {
      _links: { next: { href: `${base}/accounts/${cuenta}/payments?order=desc&limit=${porPagina}&cursor=${desde + porPagina}` } },
      _embedded: { records: trozo },
    };
    return new Response(JSON.stringify(cuerpo), { status: 200 });
  }) as typeof fetch;
  return { fetch: f, pedidos };
}
