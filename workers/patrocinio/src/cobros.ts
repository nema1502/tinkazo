/**
 * Los pagos del portero de mainnet: las órdenes, la lectura de los pagos que llegan a la cuenta de cobros y a qué
 * orden va cada uno.
 *
 * Quien llega de afuera paga en USDC por la red Stellar, desde cualquier app o exchange, a `CUENTA_COBROS` (el Worker
 * no tiene su llave) y con la nota de su orden, `tk:o:ABCD2345`. El servidor lee los pagos en Horizon y ata cada uno a
 * su orden. Las reglas:
 *
 * - Solo vale el USDC de Circle. Lo que llega convertido de otra moneda vale lo que llegó.
 * - La nota se lee como un cupón: sin espacios ni guiones, en mayúsculas, la O por 0 y la I o la L por 1, con el
 *   prefijo `tk:o:` sin distinguir mayúsculas (y `tk:0:`, con la misma regla). También vale la nota numérica (`MEMO_ID`): el id de la orden como número.
 * - Desde el 95 % del monto la orden queda pagada (los exchanges descuentan su comisión). Dos pagos de la misma orden
 *   suman. Un pago de al menos el 95 % a una orden ya pagada da otro paquete igual (`ref` `orden:<id>:<operación>`).
 * - **Un pago nunca sirve para dos cuentas y nunca se pierde**: cada operación de Horizon se anota una sola vez, en
 *   `pagos` (atada a una orden, que es de una sola persona) o en `pagos_sueltos` (sin nota, una nota que no es de
 *   ninguna orden, otro activo, o lo que sobra de una orden). Lo suelto se asigna o se devuelve a mano.
 * - Una orden vencida que se paga se respeta: la plata llegó. Lo ya pagado nunca se frena (ni el piso ni la pausa).
 * - El cursor de Horizon y los pagos de cada vuelta se escriben en la misma transacción, y el cursor nunca retrocede.
 *
 * Todo lo que escribe es síncrono (el objeto atiende de a uno mientras no haya un `await`); lo único que espera es la
 * lectura de Horizon, que va antes. El servidor de Horizon va fijo en el código (`servidores.ts`). El reloj y el
 * `fetch` entran como argumentos: las pruebas nunca tocan la red.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import type { Producto } from "./config";
import { ALFABETO } from "./cupon-codigo";
import { type Cupos, type Sql, texto } from "./cupos";
import { type Fetch, haciaHorizon } from "./servidores";

/** Quién emite el USDC en la red principal (Circle). Un "USDC" de otro emisor es otro activo. */
export const EMISOR_USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** El comienzo de la nota de una orden. */
export const PREFIJO_NOTA = "tk:o:";
/** Un id de orden: 8 caracteres del alfabeto de los cupones, 40 bits al azar. */
export const LARGO_ORDEN = 8;
/** Cuánto vive una orden abierta. Pagada después, igual se respeta. */
export const ORDEN_VIVE_MS = 72 * 3_600_000;
/**
 * Una orden sin pagar que ya recibió algo se sigue mostrando pasado su vencimiento, y pedirla otra vez la devuelve (con
 * la misma nota, para completar lo que falta), hasta este tiempo desde que se creó. Después queda para administración
 * (`parciales`). Por el mismo tiempo, una orden sin pagar hace que `/estado` y `/orden` lean antes los pagos nuevos.
 */
export const ORDEN_CON_PAGO_VIVE_MS = 30 * 24 * 3_600_000;
/** Desde qué parte del monto una orden queda pagada, en por ciento. */
export const PORCENTAJE_MINIMO = 95;
/** Horizon se lee como mucho una vez cada tanto para todo el objeto; en el medio se contesta con lo último leído. */
export const HORIZON_CADA_MS = 5_000;
/** Lo más que se espera a Horizon en cada página. */
export const ESPERA_HORIZON_MS = 8_000;
/** Páginas de 200 por vuelta, como `pagosEntrantes` del Worker de la cuenta. */
export const POR_PAGINA = 200;
export const PAGINAS = 5;
/** El ajuste donde vive el cursor de Horizon: el `paging_token` más grande ya leído. */
export const AJUSTE_CURSOR = "cobros_cursor";
/** Con `"1"`, no se crean órdenes nuevas (la red en amarillo, o a mano). Las abiertas siguen. */
export const AJUSTE_VENTA_PAUSADA = "venta_pausada";

const TIPOS = new Set(["payment", "path_payment_strict_send", "path_payment_strict_receive"]);
const DIGITOS = /^\d{1,30}$/;
const ID_ORDEN = new RegExp(`^[${ALFABETO}]{${LARGO_ORDEN}}$`);
const DOS_A_LA_40 = 2n ** 40n;
const MAX_NOTA = 64;

/* ------------------------------------------------------------------ la nota y los montos */

/** Cómo se lee lo que viene después del prefijo, igual que un cupón: la O por 0, la I o la L por 1. */
function comoCupon(s: string): string {
  return s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Sin espacios de ningún tipo ni guiones (también los largos del teclado del celular). */
const sinSeparadores = (s: string) => s.replace(/[\s\-\u2010-\u2015\u2212]/g, "");

/** El id de una orden como lo manda el sitio o la herramienta: con o sin el prefijo `tk:o:`. null si no tiene forma. */
export function normalizarOrden(x: unknown): string | null {
  if (typeof x !== "string" || x.length > MAX_NOTA) return null;
  const limpio = sinSeparadores(x).replace(/^tk:[o0]:/i, "");
  if (!/^[0-9A-Za-z]+$/.test(limpio)) return null;
  const id = comoCupon(limpio);
  return ID_ORDEN.test(id) ? id : null;
}

/** La nota de una transacción: de texto, numérica (`MEMO_ID`) u otra (`hash`, `return`), que no nombra ninguna orden. */
export type Memo = { tipo: "texto" | "id" | "otro"; valor: string };

/** La orden que nombra una nota, o null. La de texto tiene que traer el prefijo; la numérica, un número de 40 bits. */
export function ordenDeNota(memo: Memo | null): string | null {
  if (!memo) return null;
  if (memo.tipo === "id") {
    if (!DIGITOS.test(memo.valor)) return null;
    const n = BigInt(memo.valor);
    return n < DOS_A_LA_40 ? idDeNumero(n) : null;
  }
  if (memo.tipo !== "texto" || memo.valor.length > MAX_NOTA) return null;
  const limpio = sinSeparadores(memo.valor);
  if (!/^tk:[o0]:/i.test(limpio)) return null;
  const resto = limpio.slice(PREFIJO_NOTA.length);
  if (!/^[0-9A-Za-z]+$/.test(resto)) return null;
  const id = comoCupon(resto);
  return ID_ORDEN.test(id) ? id : null;
}

function idDeNumero(n: bigint): string {
  let s = "";
  for (let i = 0; i < LARGO_ORDEN; i++) {
    s = ALFABETO[Number(n % 32n)] + s;
    n /= 32n;
  }
  return s;
}

/** La nota de texto de una orden: `tk:o:ABCD2345` (13 caracteres, entra en los 28 de una nota de texto). */
export const notaDe = (id: string): string => `${PREFIJO_NOTA}${id}`;

/** La nota numérica de una orden: sus 40 bits como número, en texto (para quien usa un exchange que solo acepta números). */
export function memoIdDe(id: string): string {
  if (!ID_ORDEN.test(id)) throw new Error("orden-forma");
  let n = 0n;
  for (const c of id) n = n * 32n + BigInt(ALFABETO.indexOf(c));
  return n.toString();
}

/** Un id de orden al azar: 40 bits de `crypto.getRandomValues`, nunca de `Math.random`. */
export function ordenAlAzar(): string {
  const b = crypto.getRandomValues(new Uint8Array(5));
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  return idDeNumero(n);
}

/** Lo mínimo que tiene que llegar para que la orden quede pagada: el 95 % del monto, redondeado para arriba. */
export const minimoDe = (monto: number): number => Math.ceil((monto * PORCENTAJE_MINIMO) / 100);

/** Un monto en diezmillonésimas como se muestra: `"2"`, `"1.9"`, `"1.5000001"`. */
export function usdcTexto(monto: number): string {
  const entero = Math.floor(monto / 10_000_000);
  const resto = String(monto % 10_000_000)
    .padStart(7, "0")
    .replace(/0+$/, "");
  return resto ? `${entero}.${resto}` : String(entero);
}

/** Un monto de Horizon (`"2.0000000"`) en diezmillonésimas. null si no se entiende o no es positivo. */
function montoDe(x: unknown): number | null {
  if (typeof x !== "string") return null;
  const m = /^(\d{1,15})(?:\.(\d{1,7}))?$/.exec(x);
  if (!m) return null;
  const n = BigInt(m[1] as string) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0") || "0");
  // Lo que pase de un entero seguro (más de 900 millones) se guarda redondeado: solo puede ser un suelto de otro activo.
  return n > 0n ? Number(n) : null;
}

/**
 * El pago de una orden como enlace SEP-7: las billeteras que lo entienden lo abren ya lleno.
 * `web+stellar:pay?destination=…&amount=2&asset_code=USDC&asset_issuer=…&memo=tk%3Ao%3A…&memo_type=MEMO_TEXT`.
 */
export function enlaceDePago(o: { destino: string; usdc: string; nota: string }): string {
  const q = new URLSearchParams({ destination: o.destino, amount: o.usdc, asset_code: "USDC", asset_issuer: EMISOR_USDC, memo: o.nota, memo_type: "MEMO_TEXT" });
  return `web+stellar:pay?${q.toString()}`;
}

/** El mayor de dos cursores de Horizon (números enteros en texto, más grandes que un entero seguro). */
function mayor(a: string | null, b: string | null): string | null {
  if (a === null || !DIGITOS.test(a)) return b !== null && DIGITOS.test(b) ? b : null;
  if (b === null || !DIGITOS.test(b)) return a;
  return BigInt(b) > BigInt(a) ? b : a;
}

/* ------------------------------------------------------------------ la lectura de Horizon */

/** Un pago que llegó a la cuenta de cobros, ya leído. */
export interface PagoLeido {
  /** El id de la operación en Horizon: dos pagos de una misma transacción son dos operaciones. */
  operacion: string;
  pagingToken: string;
  tx: string;
  de: string;
  /** USDC de Circle. */
  esUsdc: boolean;
  /** `USDC`, `XLM` o `CODIGO:EMISOR`. */
  activo: string;
  /** Lo que llegó, en diezmillonésimas del activo. */
  monto: number;
  memo: Memo | null;
  ms: number;
}

/**
 * Lo que cuenta de un registro de Horizon, o null si no es un pago que entró a la cuenta de cobros: otro tipo de
 * operación (abrir la cuenta, por ejemplo), una transacción fallida, lo que sale de la cuenta o lo que no llega a ella.
 */
export function pagoDe(r: unknown, cuenta: string): PagoLeido | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  if (typeof x.type !== "string" || !TIPOS.has(x.type)) return null;
  if (x.transaction_successful === false) return null;
  if (x.to !== cuenta || typeof x.from !== "string" || x.from === cuenta) return null;
  if (typeof x.id !== "string" || !DIGITOS.test(x.id)) return null;
  const pagingToken = typeof x.paging_token === "string" && DIGITOS.test(x.paging_token) ? x.paging_token : x.id;
  // Sin el hash de la transacción el pago igual se anota: lo que identifica la operación es su id.
  const tx = typeof x.transaction_hash === "string" ? x.transaction_hash.slice(0, 128) : "";
  const monto = montoDe(x.amount);
  if (monto === null) return null;
  let activo: string;
  let esUsdc = false;
  if (x.asset_type === "native") activo = "XLM";
  else {
    const codigo = typeof x.asset_code === "string" ? x.asset_code.slice(0, 12) : "?";
    const emisor = typeof x.asset_issuer === "string" ? x.asset_issuer.slice(0, 56) : "?";
    esUsdc = codigo === "USDC" && emisor === EMISOR_USDC;
    activo = esUsdc ? "USDC" : `${codigo}:${emisor}`;
  }
  const t = x.transaction as Record<string, unknown> | undefined;
  let memo: Memo | null = null;
  if (t && typeof t.memo_type === "string" && t.memo_type !== "none") {
    if (t.memo_type === "text" && typeof t.memo === "string") memo = { tipo: "texto", valor: t.memo.slice(0, MAX_NOTA) };
    else if (t.memo_type === "id" && typeof t.memo === "string" && DIGITOS.test(t.memo)) memo = { tipo: "id", valor: t.memo };
    else memo = { tipo: "otro", valor: t.memo_type.slice(0, 16) };
  }
  const ms = typeof x.created_at === "string" ? Date.parse(x.created_at) : Number.NaN;
  return { operacion: x.id, pagingToken, tx, de: x.from.slice(0, 69), esUsdc, activo, monto, memo, ms: Number.isFinite(ms) ? ms : 0 };
}

/**
 * Lo que llegó a la cuenta de cobros desde el cursor, en orden ascendente, hasta cinco páginas de 200. `cursor` es el
 * `paging_token` más grande visto (aunque el registro no fuera un pago que cuenta). Si se corta después de la primera
 * página, devuelve lo leído con `completo: false`; si se corta la primera, `ok: false` y no se afirma nada. Una cuenta
 * que todavía no existe en la red no tiene pagos.
 */
export type LecturaHorizon = { ok: true; pagos: PagoLeido[]; cursor: string | null; completo: boolean } | { ok: false };

export async function leerPagos(pedir: (ruta: string, init?: RequestInit) => Promise<Response>, cuenta: string, cursor: string | null, esperaMs = ESPERA_HORIZON_MS): Promise<LecturaHorizon> {
  if (!StrKey.isValidEd25519PublicKey(cuenta)) return { ok: false };
  let ultimo = cursor !== null && DIGITOS.test(cursor) ? cursor : null;
  const pagos: PagoLeido[] = [];
  for (let pagina = 0; pagina < PAGINAS; pagina++) {
    const ruta = `/accounts/${cuenta}/payments?order=asc&limit=${POR_PAGINA}&include_failed=false&join=transactions${ultimo ? `&cursor=${ultimo}` : ""}`;
    const corte = (): LecturaHorizon => (pagina === 0 ? { ok: false } : { ok: true, pagos, cursor: ultimo, completo: false });
    let cuerpo: { _embedded?: { records?: unknown } } | null;
    try {
      const res = await pedir(ruta, { signal: AbortSignal.timeout(esperaMs), headers: { Accept: "application/json" } });
      if (res.status === 404 && pagina === 0) return { ok: true, pagos, cursor: ultimo, completo: true };
      if (!res.ok) return corte();
      cuerpo = (await res.json()) as typeof cuerpo;
    } catch {
      return corte();
    }
    const registros = Array.isArray(cuerpo?._embedded?.records) ? (cuerpo?._embedded?.records as unknown[]) : [];
    const antes = ultimo;
    for (const r of registros) {
      const token = r && typeof r === "object" ? (r as { paging_token?: unknown }).paging_token : undefined;
      if (typeof token === "string") ultimo = mayor(ultimo, token);
      const p = pagoDe(r, cuenta);
      if (p) pagos.push(p);
    }
    // Una página corta es la última; una que no movió el cursor no se vuelve a pedir.
    if (registros.length < POR_PAGINA || ultimo === antes) break;
  }
  return { ok: true, pagos, cursor: ultimo, completo: true };
}

/* ------------------------------------------------------------------ las órdenes y los pagos */

export interface FilaOrden {
  id: string;
  usuario: string;
  producto: Producto["id"];
  /** En diezmillonésimas de USDC. */
  monto: number;
  sorteos: number;
  dias: number;
  creada: number;
  vence: number;
  pagada: number | null;
  metodo: "usdc" | "a-mano" | "qr-bs" | null;
  ref: string | null;
}

function filaOrden(f: Record<string, unknown>): FilaOrden {
  return {
    id: String(f.id),
    usuario: String(f.usuario),
    producto: String(f.producto) as Producto["id"],
    monto: Number(f.monto),
    sorteos: Number(f.sorteos),
    dias: Number(f.dias),
    creada: Number(f.creada),
    vence: Number(f.vence),
    pagada: f.pagada === null || f.pagada === undefined ? null : Number(f.pagada),
    metodo: f.metodo === null || f.metodo === undefined ? null : (String(f.metodo) as FilaOrden["metodo"]),
    ref: f.ref === null || f.ref === undefined ? null : String(f.ref),
  };
}

export type OrdenCreada = { ok: true; orden: FilaOrden; nueva: boolean } | { ok: false; motivo: "venta-pausada" | "altas-pausadas" };

/** Lo que pasó en una vuelta de lectura, para la bitácora: sin personas, cuentas, notas ni ids de orden. */
export type EventoCobro = { evento: "alta-pago"; producto: string; repetida: 0 | 1 } | { evento: "pago-suelto"; motivo: MotivoSuelto };

export type MotivoSuelto = "sin-nota" | "nota-desconocida" | "otro-activo" | "sobrante";

export interface FilaSuelto {
  operacion: string;
  tx: string;
  de: string;
  activo: string;
  monto: number;
  /** El monto como se muestra (`"2"`, `"0.1"`), en el activo que llegó. */
  cantidad: string;
  nota: string | null;
  motivo: MotivoSuelto;
  estado: "suelto" | "asignado" | "devuelto";
  orden: string | null;
  ref: string | null;
  ms: number;
}

export type Asignado = { ok: true; pagada: boolean; sobrante: number } | { ok: false; motivo: "suelto" | "orden" | "no-asignable" } | { ok: false; motivo: "ya-resuelto"; estado: string };
export type Devuelto = { ok: true; repetido: boolean } | { ok: false; motivo: "suelto" } | { ok: false; motivo: "ya-resuelto"; estado: string };
export type PagadaAMano = { ok: true; repetido: boolean } | { ok: false; motivo: "orden" | "techo-altas" | "techo-sorteos" };

/** El día UTC de un instante, `AAAA-MM-DD`: la clave de los techos diarios (los mismos de `altas.ts`). */
const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Un pago a punto de atarse a una orden: el de Horizon o uno suelto que se asigna a mano. */
interface Operacion {
  operacion: string;
  pagingToken: string;
  tx: string;
  de: string;
  monto: number;
  ms: number;
}

export class Cobros {
  private readonly idAlAzar: () => string;

  /** `sql` es el mismo SQLite de `cupos`, que ya creó las tablas. */
  constructor(
    private readonly sql: Sql,
    private readonly cupos: Cupos,
    opciones: { idAlAzar?: () => string } = {},
  ) {
    this.idAlAzar = opciones.idAlAzar ?? ordenAlAzar;
  }

  private filas(consulta: string, ...enlaces: unknown[]): Array<Record<string, unknown>> {
    return this.sql.exec(consulta, ...enlaces).toArray();
  }

  orden(id: string): FilaOrden | null {
    const f = this.filas("SELECT * FROM ordenes WHERE id = ?", id)[0];
    return f ? filaOrden(f) : null;
  }

  /**
   * La orden abierta más reciente de una persona, de un producto o de cualquiera: sin pagar y sin vencer o, aunque haya
   * vencido, con algo ya pagado y creada hace menos de `ORDEN_CON_PAGO_VIVE_MS` (lo pagado a medias no se esconde).
   */
  ordenAbierta(usuario: string, ahora: number, producto?: Producto["id"]): FilaOrden | null {
    const abierta = "pagada IS NULL AND (vence > ? OR (creada > ? AND EXISTS (SELECT 1 FROM pagos WHERE pagos.orden = ordenes.id)))";
    const desde = ahora - ORDEN_CON_PAGO_VIVE_MS;
    const f = producto
      ? this.filas(`SELECT * FROM ordenes WHERE usuario = ? AND producto = ? AND ${abierta} ORDER BY creada DESC LIMIT 1`, usuario, producto, ahora, desde)[0]
      : this.filas(`SELECT * FROM ordenes WHERE usuario = ? AND ${abierta} ORDER BY creada DESC LIMIT 1`, usuario, ahora, desde)[0];
    return f ? filaOrden(f) : null;
  }

  /**
   * Si la persona tiene alguna orden sin pagar creada hace menos de `ORDEN_CON_PAGO_VIVE_MS`, vencida o no: entonces
   * conviene leer los pagos antes de contestarle (pudo pagar y no tocar «Ya pagué»).
   */
  tieneOrdenSinPagar(usuario: string, ahora: number): boolean {
    return this.filas("SELECT 1 AS n FROM ordenes WHERE usuario = ? AND pagada IS NULL AND creada > ? LIMIT 1", usuario, ahora - ORDEN_CON_PAGO_VIVE_MS).length > 0;
  }

  /**
   * Las órdenes sin pagar que ya recibieron algo (pagadas a medias), vencidas o no, de la más vieja a la más nueva (hasta
   * 500): para que administración las vea, las marque pagadas a mano o devuelva lo recibido. Sin la persona.
   */
  parciales(ahora: number, limite = 500): Array<{ id: string; producto: string; recibido: string; total: string; minimo: string; creada: number; vence: number; vencida: boolean }> {
    return this.filas(
      "SELECT o.id AS id, o.producto AS producto, o.monto AS monto, o.creada AS creada, o.vence AS vence, SUM(p.monto) AS recibido FROM ordenes o JOIN pagos p ON p.orden = o.id WHERE o.pagada IS NULL GROUP BY o.id ORDER BY o.creada, o.id LIMIT ?",
      limite,
    ).map((f) => ({
      id: String(f.id),
      producto: String(f.producto),
      recibido: usdcTexto(Number(f.recibido)),
      total: usdcTexto(Number(f.monto)),
      minimo: usdcTexto(minimoDe(Number(f.monto))),
      creada: Number(f.creada),
      vence: Number(f.vence),
      vencida: Number(f.vence) <= ahora,
    }));
  }

  /** Cuánto llegó ya para una orden (lo atado en `pagos`), en diezmillonésimas. */
  recibido(id: string): number {
    return Number(this.filas("SELECT COALESCE(SUM(monto), 0) AS n FROM pagos WHERE orden = ?", id)[0]?.n ?? 0);
  }

  /**
   * La orden abierta de esta persona para este producto o, si no hay, una nueva de 72 horas con el precio de ahora. Una
   * nueva no nace con la venta pausada, ni si `freno` (el piso de créditos) la para; la abierta se devuelve igual. Una
   * pagada a medias que ya había vencido vuelve con otras 72 horas: la persona completa lo que falta con la misma nota.
   */
  crearOrden(p: { usuario: string; producto: Producto; freno?: (c: { sorteos: number; altaNueva: boolean }) => "altas-pausadas" | null }, ahora: number): OrdenCreada {
    if (!texto(p.usuario, 200)) throw new Error("orden-usuario");
    return this.cupos.transaccion((): OrdenCreada => {
      const abierta = this.ordenAbierta(p.usuario, ahora, p.producto.id);
      if (abierta && abierta.vence <= ahora) {
        this.sql.exec("UPDATE ordenes SET vence = ? WHERE id = ? AND pagada IS NULL", ahora + ORDEN_VIVE_MS, abierta.id);
        return { ok: true, orden: this.orden(abierta.id) as FilaOrden, nueva: false };
      }
      if (abierta) return { ok: true, orden: abierta, nueva: false };
      if (this.cupos.ajuste(AJUSTE_VENTA_PAUSADA) === "1") return { ok: false, motivo: "venta-pausada" };
      const frenado = p.freno?.({ sorteos: p.producto.sorteos, altaNueva: this.cupos.altaDe(p.usuario) === null }) ?? null;
      if (frenado) return { ok: false, motivo: frenado };
      let id: string | null = null;
      for (let i = 0; i < 8 && !id; i++) {
        const c = this.idAlAzar();
        if (ID_ORDEN.test(c) && !this.orden(c)) id = c;
      }
      if (!id) throw new Error("orden-id");
      this.sql.exec(
        "INSERT INTO ordenes (id, usuario, producto, monto, sorteos, dias, creada, vence, pagada, metodo, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        id,
        p.usuario,
        p.producto.id,
        p.producto.monto,
        p.producto.sorteos,
        p.producto.dias,
        ahora,
        ahora + ORDEN_VIVE_MS,
      );
      return { ok: true, orden: this.orden(id) as FilaOrden, nueva: true };
    });
  }

  /** El cursor guardado de Horizon, o null si todavía no se leyó nada. */
  cursor(): string | null {
    const c = this.cupos.ajuste(AJUSTE_CURSOR);
    return c !== undefined && DIGITOS.test(c) ? c : null;
  }

  private visto(operacion: string): boolean {
    return this.filas("SELECT 1 AS n FROM pagos WHERE operacion = ? UNION ALL SELECT 1 AS n FROM pagos_sueltos WHERE operacion = ?", operacion, operacion).length > 0;
  }

  private suelto(p: { operacion: string; tx: string; de: string; activo: string; monto: number; nota: string | null }, motivo: MotivoSuelto, orden: string | null, ms: number): void {
    this.sql.exec(
      "INSERT INTO pagos_sueltos (operacion, tx, de, activo, monto, nota, motivo, estado, orden, ref, ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'suelto', ?, NULL, ?)",
      p.operacion,
      p.tx,
      p.de,
      p.activo,
      p.monto,
      p.nota,
      motivo,
      orden,
      ms,
    );
  }

  /**
   * Una vuelta de lectura, todo o nada: cada pago a su orden o a los sueltos, y el cursor (el mayor entre el guardado y
   * el leído). Una operación que ya se anotó no se vuelve a anotar. Devuelve lo que pasó, para la bitácora.
   */
  registrarLectura(pagos: readonly PagoLeido[], cursor: string | null, ahora: number): EventoCobro[] {
    return this.cupos.transaccion(() => {
      const eventos: EventoCobro[] = [];
      for (const p of pagos) {
        if (this.visto(p.operacion)) continue;
        const nota = p.memo ? (p.memo.tipo === "otro" ? `(${p.memo.valor})` : p.memo.valor) : null;
        const base = { operacion: p.operacion, tx: p.tx, de: p.de, activo: p.activo, monto: p.monto, nota };
        if (!p.esUsdc) {
          this.suelto(base, "otro-activo", null, p.ms);
          eventos.push({ evento: "pago-suelto", motivo: "otro-activo" });
          continue;
        }
        const id = ordenDeNota(p.memo);
        const o = id ? this.orden(id) : null;
        if (!o) {
          const motivo = p.memo ? "nota-desconocida" : "sin-nota";
          this.suelto(base, motivo, null, p.ms);
          eventos.push({ evento: "pago-suelto", motivo });
          continue;
        }
        const r = this.atribuir(o, p, ahora);
        if (r.sobrante > 0) {
          this.suelto({ ...base, monto: r.sobrante }, "sobrante", o.id, p.ms);
          eventos.push({ evento: "pago-suelto", motivo: "sobrante" });
        }
        if (r.concedido) eventos.push({ evento: "alta-pago", producto: o.producto, repetida: r.repetida ? 1 : 0 });
      }
      // El cursor va después de los pagos, en la misma transacción: si no se puede escribir, no queda ningún pago.
      const nuevo = mayor(this.cursor(), cursor);
      if (nuevo !== null && nuevo !== this.cursor()) this.cupos.fijarAjuste(AJUSTE_CURSOR, nuevo, ahora);
      return eventos;
    });
  }

  /**
   * Ata una operación a una orden, sin abrir transacción (quien llama ya está adentro de una).
   *
   * - Sin pagar: se anota lo que falta para el monto (lo de más es `sobrante`); si lo recibido llega al 95 %, queda
   *   pagada y se da lo suyo.
   * - Ya pagada: un pago de al menos el 95 % da otro paquete igual; uno menor es todo `sobrante`.
   */
  private atribuir(o: FilaOrden, op: Operacion, ahora: number): { concedido: boolean; repetida: boolean; sobrante: number } {
    const anotar = (parte: number) => this.sql.exec("INSERT INTO pagos (operacion, paging_token, tx, orden, de, monto, ms) VALUES (?, ?, ?, ?, ?, ?, ?)", op.operacion, op.pagingToken, op.tx, o.id, op.de, parte, op.ms);
    const minimo = minimoDe(o.monto);
    if (o.pagada === null) {
      const previo = this.recibido(o.id);
      const parte = Math.min(op.monto, Math.max(0, o.monto - previo));
      if (parte > 0) anotar(parte);
      const sobrante = op.monto - parte;
      if (previo + parte < minimo) return { concedido: false, repetida: false, sobrante };
      this.sql.exec("UPDATE ordenes SET pagada = ?, metodo = 'usdc', ref = ? WHERE id = ? AND pagada IS NULL", ahora, `usdc:${op.operacion}`, o.id);
      this.conceder(o, `orden:${o.id}`, ahora);
      return { concedido: true, repetida: false, sobrante };
    }
    if (op.monto < minimo) return { concedido: false, repetida: false, sobrante: op.monto };
    const parte = Math.min(op.monto, o.monto);
    anotar(parte);
    this.conceder(o, `orden:${o.id}:${op.operacion}`, ahora);
    return { concedido: true, repetida: true, sobrante: op.monto - parte };
  }

  /**
   * Lo que da una orden pagada: el alta si la persona no tenía (un pago siempre cubre la activación) y los sorteos de la
   * orden, que vencen a los días de la orden desde ahora. Si la persona ya tiene su cuenta atada, cuentan para esa cuenta;
   * si no, se atan cuando el servidor sepa su cuenta (`/v1/alta/estado` o `/v1/alta/pago`).
   */
  private conceder(o: FilaOrden, ref: string, ahora: number): void {
    const alta = this.cupos.altaDe(o.usuario);
    if (!alta) this.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'pago', ?, NULL, NULL, 'autorizada', ?, ?)", o.usuario, `orden:${o.id}`, ahora, ahora);
    this.cupos.otorgar({ usuario: o.usuario, cuenta: alta?.cuenta ?? null, origen: o.producto === "alta" ? "alta" : "paquete", ref, sorteos: o.sorteos, dias: o.dias }, ahora);
  }

  /**
   * Una orden que se pagó por fuera (QR en bolivianos, a mano): queda pagada y da lo mismo que un pago en USDC. Otra vez
   * es `repetido`. Cuenta para los techos diarios de altas y de sorteos dados a mano: con la clave de cupones filtrada no
   * se regalan paquetes.
   */
  marcarPagadaAMano(p: { orden: string; metodo: "a-mano" | "qr-bs"; ref: string; techoAltas: number; techoSorteos: number }, ahora: number): PagadaAMano {
    return this.cupos.transaccion((): PagadaAMano => {
      const o = this.orden(p.orden);
      if (!o) return { ok: false, motivo: "orden" };
      if (o.pagada !== null) return { ok: true, repetido: true };
      const dia = diaUtc(ahora);
      const altasHoy = Number(this.cupos.ajuste(`altas_dia:${dia}`) ?? 0);
      const sorteosHoy = Number(this.cupos.ajuste(`derechos_dia:${dia}`) ?? 0);
      const altaNueva = this.cupos.altaDe(o.usuario) === null;
      if (altaNueva && altasHoy + 1 > p.techoAltas) return { ok: false, motivo: "techo-altas" };
      if (sorteosHoy + o.sorteos > p.techoSorteos) return { ok: false, motivo: "techo-sorteos" };
      this.sql.exec("UPDATE ordenes SET pagada = ?, metodo = ?, ref = ? WHERE id = ? AND pagada IS NULL", ahora, p.metodo, `${p.metodo}:${p.ref}`, o.id);
      this.conceder(o, `orden:${o.id}`, ahora);
      if (altaNueva) this.cupos.fijarAjuste(`altas_dia:${dia}`, String(altasHoy + 1), ahora);
      this.cupos.fijarAjuste(`derechos_dia:${dia}`, String(sorteosHoy + o.sorteos), ahora);
      return { ok: true, repetido: false };
    });
  }

  private filaSuelto(f: Record<string, unknown>): FilaSuelto {
    const monto = Number(f.monto);
    return {
      operacion: String(f.operacion),
      tx: String(f.tx),
      de: String(f.de),
      activo: String(f.activo),
      monto,
      cantidad: usdcTexto(monto),
      nota: f.nota === null || f.nota === undefined ? null : String(f.nota),
      motivo: String(f.motivo) as MotivoSuelto,
      estado: String(f.estado) as FilaSuelto["estado"],
      orden: f.orden === null || f.orden === undefined ? null : String(f.orden),
      ref: f.ref === null || f.ref === undefined ? null : String(f.ref),
      ms: Number(f.ms),
    };
  }

  /** Los pagos sueltos sin resolver, del más viejo al más nuevo (hasta 500). */
  sueltos(limite = 500): FilaSuelto[] {
    return this.filas("SELECT * FROM pagos_sueltos WHERE estado = 'suelto' ORDER BY ms, operacion LIMIT ?", limite).map((f) => this.filaSuelto(f));
  }

  /** Cuántos pagos sueltos hay sin resolver, para `/estado`. */
  sueltosSinResolver(): number {
    return Number(this.filas("SELECT COUNT(*) AS n FROM pagos_sueltos WHERE estado = 'suelto'")[0]?.n ?? 0);
  }

  /**
   * Asigna a mano un pago suelto de USDC (sin nota o con una nota que no era de ninguna orden) a una orden: cuenta como
   * si hubiera llegado con su nota. Lo que sobre queda como sobrante de esa orden, para devolverlo. Lo que no es USDC y
   * lo que ya es un sobrante no se asignan: se devuelven.
   */
  asignar(p: { operacion: string; orden: string }, ahora: number): Asignado {
    return this.cupos.transaccion((): Asignado => {
      const f = this.filas("SELECT * FROM pagos_sueltos WHERE operacion = ?", p.operacion)[0];
      if (!f) return { ok: false, motivo: "suelto" };
      const s = this.filaSuelto(f);
      if (s.estado !== "suelto") return { ok: false, motivo: "ya-resuelto", estado: s.estado };
      if (s.activo !== "USDC" || (s.motivo !== "sin-nota" && s.motivo !== "nota-desconocida")) return { ok: false, motivo: "no-asignable" };
      // Por las dudas: una operación que ya está atada a una orden no se ata otra vez.
      if (this.filas("SELECT 1 AS n FROM pagos WHERE operacion = ?", s.operacion).length) return { ok: false, motivo: "no-asignable" };
      const o = this.orden(p.orden);
      if (!o) return { ok: false, motivo: "orden" };
      const r = this.atribuir(o, { operacion: s.operacion, pagingToken: s.operacion, tx: s.tx, de: s.de, monto: s.monto, ms: s.ms }, ahora);
      if (r.sobrante > 0) this.sql.exec("UPDATE pagos_sueltos SET monto = ?, motivo = 'sobrante', orden = ? WHERE operacion = ?", r.sobrante, o.id, s.operacion);
      else this.sql.exec("UPDATE pagos_sueltos SET estado = 'asignado', orden = ? WHERE operacion = ?", o.id, s.operacion);
      return { ok: true, pagada: this.orden(o.id)?.pagada !== null, sobrante: r.sobrante };
    });
  }

  /** Marca devuelto un pago suelto (la devolución la hace a mano quien tiene la llave de la cuenta de cobros). */
  devolver(p: { operacion: string; ref: string }): Devuelto {
    return this.cupos.transaccion((): Devuelto => {
      const f = this.filas("SELECT estado FROM pagos_sueltos WHERE operacion = ?", p.operacion)[0];
      if (!f) return { ok: false, motivo: "suelto" };
      if (f.estado === "devuelto") return { ok: true, repetido: true };
      if (f.estado !== "suelto") return { ok: false, motivo: "ya-resuelto", estado: String(f.estado) };
      this.sql.exec("UPDATE pagos_sueltos SET estado = 'devuelto', ref = ? WHERE operacion = ?", p.ref, p.operacion);
      return { ok: true, repetido: false };
    });
  }
}

/* ------------------------------------------------------------------ el lector */

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;

export interface OpcionesLector {
  cobros: Cobros;
  /** `CUENTA_COBROS`. */
  cuenta: string;
  /** El `fetch` de verdad (o el de la prueba): solo se usa sobre el Horizon fijo. */
  fetch: Fetch;
  reloj?: () => number;
  registrar?: Registrar;
  cadaMs?: number;
  esperaMs?: number;
}

/**
 * Lee Horizon y anota lo que llegó, como mucho una vez cada `HORIZON_CADA_MS` para todo el objeto: en el medio contesta
 * con lo último leído, y dos pedidos a la vez esperan la misma lectura. `ok: false` si Horizon no contestó entero.
 */
export class LectorDeCobros {
  private readonly pedir: (ruta: string, init?: RequestInit) => Promise<Response>;
  private readonly reloj: () => number;
  private readonly registrar: Registrar;
  private readonly cadaMs: number;
  private ultima = Number.NEGATIVE_INFINITY;
  private ultimo: { ok: boolean } = { ok: false };
  private enCurso: Promise<{ ok: boolean }> | null = null;

  constructor(private readonly o: OpcionesLector) {
    this.pedir = haciaHorizon(o.fetch);
    this.reloj = o.reloj ?? (() => Date.now());
    this.registrar = o.registrar ?? (() => {});
    this.cadaMs = o.cadaMs ?? HORIZON_CADA_MS;
  }

  leer(): Promise<{ ok: boolean }> {
    if (this.enCurso) return this.enCurso;
    if (this.reloj() - this.ultima < this.cadaMs) return Promise.resolve(this.ultimo);
    this.ultima = this.reloj();
    this.enCurso = (async () => {
      try {
        const l = await leerPagos(this.pedir, this.o.cuenta, this.o.cobros.cursor(), this.o.esperaMs);
        if (!l.ok) {
          this.registrar("error-horizon", { donde: "cobros" });
          return (this.ultimo = { ok: false });
        }
        // Desde acá, sin await: los pagos y el cursor, en una transacción.
        const eventos = this.o.cobros.registrarLectura(l.pagos, l.cursor, this.reloj());
        for (const e of eventos) this.registrar(e.evento, e.evento === "alta-pago" ? { producto: e.producto, repetida: e.repetida } : { motivo: e.motivo });
        if (!l.completo) this.registrar("error-horizon", { donde: "cobros", completo: 0 });
        return (this.ultimo = { ok: l.completo });
      } catch (e) {
        this.registrar("error-horizon", { donde: "cobros", error: e instanceof Error ? e.name : "desconocido" });
        return (this.ultimo = { ok: false });
      } finally {
        this.enCurso = null;
      }
    })();
    return this.enCurso;
  }
}
