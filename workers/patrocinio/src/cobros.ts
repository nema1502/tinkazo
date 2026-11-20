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
 * - Desde el 95 % del precio del paquete la orden queda pagada (los exchanges descuentan su comisión), más el recargo
 *   del QR entero si lo lleva: el recargo paga la verificación y la carga, sin tolerancia. Dos pagos de la misma orden
 *   suman. Un pago a una orden ya pagada no da nada: va entero a los sueltos como `repetido`. Así ningún paquete sale sin
 *   pasar por la venta pausada, el piso de créditos y el precio del día, que se miran al crear cada orden.
 * - **Un pago nunca sirve para dos cuentas y nunca se pierde**: cada operación de Horizon se anota una sola vez, en
 *   `pagos` (atada a una orden, que es de una sola persona) o en `pagos_sueltos` (sin nota, una nota que no es de
 *   ninguna orden, otro activo, lo que sobra de una orden o un pago repetido). Lo suelto se asigna o se devuelve a mano.
 * - Una orden vencida que se paga se respeta: la plata llegó. Lo ya pagado nunca se frena (ni el piso ni la pausa).
 * - Una orden pagada a medias se devuelve en dos tiempos: primero administración la cierra (`cerrar`) y después se
 *   devuelve a mano lo que llegó. Cerrada no se completa nunca: lo que llegue después va a los sueltos como `cerrada`.
 * - Una orden reemplazada (sin nada recibido, porque la persona empezó a cargar con QR o anuló esa compra) tampoco se
 *   completa, salvo un pago que ya estaba en camino: si entró a la red como mucho 2 minutos después del reemplazo y
 *   llega al 95 %, se honra. Lo que entró después, o no llega, va a los sueltos como `cerrada`.
 * - El cursor de Horizon y los pagos de cada vuelta se escriben en la misma transacción, y el cursor nunca retrocede.
 * - **El costo de un retiro que pagó el portero no es un pago suelto ni de una orden.** Es el segundo pago de una transacción
 *   que el portero guardó en `retiros_cobrados` (`pagos-uso.ts`): se reconoce por el hash de esa transacción, de la misma
 *   cuenta y por el costo exacto, antes de mirar la nota. Queda en `pagos_sueltos` como `costo-retiro` y `cobrado`, fuera de lo
 *   que se lista, se asigna o se devuelve, y sin atarse a ninguna orden aunque su nota se lea como una. Sin esa tabla (`costos`
 *   no se pasa o no está disponible) la lectura es la de siempre.
 *
 * Todo lo que escribe es síncrono (el objeto atiende de a uno mientras no haya un `await`); lo único que espera es la
 * lectura de Horizon, que va antes. El servidor de Horizon va fijo en el código (`servidores.ts`). El reloj y el
 * `fetch` entran como argumentos: las pruebas nunca tocan la red.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { type Producto, UNIDAD_MAXIMO, UNIDAD_MINIMO, UNIDAD_PASO } from "./config";
import { ALFABETO } from "./cupon-codigo";
import { type Cupos, type Sql, texto } from "./cupos";
import type { UsoDePagos } from "./pagos-uso";
import { type Fetch, haciaHorizon } from "./servidores";

/**
 * Quién emite el USDC en la red principal (Circle). Un "USDC" de otro emisor es otro activo. Fuente:
 * https://developers.circle.com/stablecoins/usdc-contract-addresses y https://www.circle.com/.well-known/stellar.toml
 * (en Horizon, su `home_domain` es `circle.com`).
 */
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
/**
 * Un pago a una orden reemplazada se honra si su hora en la red (la del ledger, `created_at` de Horizon) es como mucho
 * la del reemplazo más esto: ya estaba en camino y el portero todavía no lo había leído (lectura guardada, lectura en
 * curso). Con el reloj de la red y el del portero corridos unos segundos, alcanza. Más tarde, no: si no, el recargo del
 * QR se saltearía pagando una orden vieja.
 */
export const GRACIA_REEMPLAZO_MS = 2 * 60_000;
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
/** Lo más que se convierte en sorteos de un solo pago que llegó de más o dos veces: el resto queda suelto, para devolverlo. */
export const CONVERSION_MAXIMA = 50;
/**
 * Con la venta por unidad, un pago chico sin orden no escribe fila: USDC por debajo de 0,50 (estricto: el costo de un retiro de
 * 0,50 se sigue anotando) y otra moneda por debajo de 1 unidad. Suma al contador del día y el cursor pasa por encima.
 */
export const CHICO_USDC = 5_000_000;
export const CHICO_OTRO = 10_000_000;
/** El ajuste con los pagos chicos sin fila del día (UTC): `{"dia":"AAAA-MM-DD","n":…}`. Solo cifras. */
export const AJUSTE_PAGOS_CHICOS = "cobros_chicos_dia";
/** Con la venta por unidad, los costos de retiro que quedaron sueltos se buscan solo en las últimas 72 horas. */
export const RECLASIFICAR_MS = 72 * 3_600_000;
/**
 * La alarma de cobros, con la venta por unidad: mientras la orden viva más nueva tenga menos de `VIGILAR_PRIMERO_MS`, lee los
 * pagos cada `VIGILAR_CADA_MS`. Después, cada `VIGILAR_DESPUES_MS`, hasta que vence. Sin órdenes vivas, no lee.
 */
export const VIGILAR_PRIMERO_MS = 30 * 60_000;
export const VIGILAR_CADA_MS = 20_000;
export const VIGILAR_DESPUES_MS = 5 * 60_000;
/**
 * Con la venta por unidad, una orden sin pagar reserva sus sorteos en el piso mientras tenga menos de esto: es cuando se paga
 * casi siempre (la pantalla mira sola esa media hora). Pasado eso deja de reservar, así una orden olvidada no frena la venta.
 */
export const RESERVA_ORDEN_MS = VIGILAR_PRIMERO_MS;
/** Cuando una lectura termina con todas sus páginas llenas, se lee otra enseguida, sin pasar de estas páginas por minuto. */
export const PAGINAS_POR_MINUTO = 20;

const TIPOS = new Set(["payment", "path_payment_strict_send", "path_payment_strict_receive"]);
const DIGITOS = /^\d{1,30}$/;
const ID_ORDEN = new RegExp(`^[${ALFABETO}]{${LARGO_ORDEN}}$`);
const DOS_A_LA_40 = 2n ** 40n;
const MAX_NOTA = 64;
/** Un hash de transacción en hexadecimal minúscula. */
const HASH_DE_TX = /^[0-9a-f]{64}$/;

/* ------------------------------------------------------------------ la nota y los montos */

/** Cómo se lee lo que viene después del prefijo, igual que un cupón: la O por 0, la I o la L por 1. */
function comoCupon(s: string): string {
  return s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
}

/** Sin espacios de ningún tipo ni guiones (también los largos del teclado del celular). */
export const sinSeparadores = (s: string) => s.replace(/[\s\-\u2010-\u2015\u2212]/g, "");

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
  /**
   * El hash de la transacción de adentro si Horizon trae la transacción envuelta en un fee-bump (`inner_transaction.hash`), o
   * null. Un retiro que paga el portero va envuelto, y no se mide cuál de los dos hashes pone Horizon en `tx`: el costo se
   * reconoce por cualquiera. Opcional: lo que se arma a mano sin esto es un pago sin envoltorio.
   */
  txInterna?: string | null;
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
  // Con `join=transactions`, una transacción envuelta trae la de adentro: su hash es el que guarda el portero.
  const interna = t?.inner_transaction;
  const adentro = interna && typeof interna === "object" ? (interna as Record<string, unknown>).hash : undefined;
  const txInterna = typeof adentro === "string" && HASH_DE_TX.test(adentro) ? adentro : null;
  return {
    operacion: x.id,
    pagingToken,
    tx,
    de: x.from.slice(0, 69),
    esUsdc,
    activo,
    monto,
    memo,
    ms: Number.isFinite(ms) ? ms : 0,
    txInterna,
  };
}

/**
 * Lo que llegó a la cuenta de cobros desde el cursor, en orden ascendente, hasta cinco páginas de 200. `cursor` es el
 * `paging_token` más grande visto (aunque el registro no fuera un pago que cuenta). Si se corta después de la primera
 * página, devuelve lo leído con `completo: false`; si se corta la primera, `ok: false` y no se afirma nada. Una cuenta
 * que todavía no existe en la red no tiene pagos.
 */
export type LecturaHorizon = { ok: true; pagos: PagoLeido[]; cursor: string | null; completo: boolean } | { ok: false };

/**
 * Lo que `leerPagos` cuenta de una lectura, si se le pasa: cuántas páginas pidió con respuesta y si la última vino llena (con
 * el cursor movido), o sea que puede haber más. Así el lector sabe si tiene que ponerse al día.
 */
export interface MedidaDeLectura {
  paginas: number;
  llena: boolean;
}

export async function leerPagos(
  pedir: (ruta: string, init?: RequestInit) => Promise<Response>,
  cuenta: string,
  cursor: string | null,
  esperaMs = ESPERA_HORIZON_MS,
  medida?: MedidaDeLectura,
): Promise<LecturaHorizon> {
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
    const llena = registros.length >= POR_PAGINA && ultimo !== antes;
    if (medida) {
      medida.paginas += 1;
      medida.llena = llena;
    }
    // Una página corta es la última; una que no movió el cursor no se vuelve a pedir.
    if (!llena) break;
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
  /**
   * Cómo se pagó. Con `pagada` en null: `devuelta` es una orden cerrada para devolver lo que llegó (`cerrar`) y
   * `reemplazada`, una que se cerró sin nada recibido porque la persona empezó a cargar con QR y su orden nueva lleva
   * el recargo (`reemplazar`), o porque se anuló la compra con QR que la ataba.
   */
  metodo: "usdc" | "a-mano" | "qr-bs" | "devuelta" | "reemplazada" | null;
  ref: string | null;
  /**
   * Cuándo se reemplazó (ms), o null: nunca se reemplazó, o se reemplazó antes de que se guardara la hora. Queda escrito
   * aunque después se honre un pago que ya estaba en camino.
   */
  reemplazada: number | null;
}

/**
 * Una orden cerrada (para devolver lo que llegó, o reemplazada por una con el recargo del QR): no se completa, no se
 * paga a mano y no recibe nada asignado. Lo que llegue con su nota va a los sueltos como `cerrada`, salvo el pago a una
 * reemplazada que ya estaba en camino (`puedeHonrarse`).
 */
export const estaCerrada = (o: Pick<FilaOrden, "pagada" | "metodo">): boolean => o.pagada === null && (o.metodo === "devuelta" || o.metodo === "reemplazada");

/**
 * Si una orden cerrada todavía puede quedar pagada: una reemplazada con su hora guardada, por un pago que entró a la red
 * hasta `GRACIA_REEMPLAZO_MS` después del reemplazo y llega al 95 %. Una cerrada para devolver, o una reemplazada sin
 * hora, no.
 */
export const puedeHonrarse = (o: Pick<FilaOrden, "pagada" | "metodo" | "reemplazada">): boolean => o.pagada === null && o.metodo === "reemplazada" && o.reemplazada !== null;

/** El recargo del QR que lleva una orden y la compra a la que está atada. */
export interface RecargoDeOrden {
  compra: number;
  /** En diezmillonésimas de USDC: ya está sumado al monto de la orden. */
  recargo: number;
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
    reemplazada: f.reemplazada === null || f.reemplazada === undefined ? null : Number(f.reemplazada),
  };
}

export type OrdenCreada = { ok: true; orden: FilaOrden; nueva: boolean } | { ok: false; motivo: "venta-pausada" | "altas-pausadas" | "fuera-del-piloto" | "compra-en-curso" };

/**
 * La orden por unidad de `cantidad` sorteos: el precio de uno por la cantidad, los mismos días. null si la cantidad no es un
 * entero de `UNIDAD_MINIMO` a `UNIDAD_MAXIMO` de a `UNIDAD_PASO`, o si `unidad` no es el producto por unidad. El monto lo arma
 * siempre el servidor: el sitio manda solo la cantidad.
 */
export function productoPorUnidad(unidad: Producto, cantidad: unknown): Producto | null {
  if (unidad.id !== "sorteo" || unidad.sorteos !== 1) return null;
  if (typeof cantidad !== "number" || !Number.isInteger(cantidad) || cantidad < UNIDAD_MINIMO || cantidad > UNIDAD_MAXIMO) return null;
  if ((cantidad - UNIDAD_MINIMO) % UNIDAD_PASO !== 0) return null;
  const monto = unidad.monto * cantidad;
  return { id: "sorteo", usdc: usdcTexto(monto), monto, sorteos: cantidad, dias: unidad.dias };
}

/**
 * Lo que mira `Cobros` para convertir en sorteos lo que llegó de más o dos veces a una orden por unidad. Lo arma la puerta de
 * las altas: `precio` es el producto por unidad de hoy (null si hoy no se vende por unidad) y `permite` dice, sin esperar nada,
 * si hoy se vende: la venta prendida y sin pausar, la persona dentro del piloto y los créditos guardados por encima del piso con
 * la reserva de la venta. Sin esto, nada se convierte y todo va a los sueltos, como siempre.
 */
export interface Conversion {
  precio(): Producto | null;
  permite(c: { usuario: string; sorteos: number; altaNueva: boolean }, ahora: number): boolean;
}

/**
 * Lo que pasó en una vuelta de lectura, para la bitácora: sin personas, cuentas, notas ni ids de orden. `orden-honrada`
 * va junto con `alta-pago` cuando la orden pagada estaba reemplazada y el pago ya estaba en camino.
 */
export type EventoCobro =
  | { evento: "alta-pago" | "orden-honrada"; producto: string }
  /** `orden-parte`: una orden por unidad dio parte de sus sorteos. `orden-convertida`: lo de más o repetido se volvió sorteos. */
  | { evento: "orden-parte" | "orden-convertida"; producto: string }
  | { evento: "pago-suelto"; motivo: MotivoSuelto }
  /** El costo de un retiro que pagó el portero, reconocido por su transacción: no es un suelto ni una orden. */
  | { evento: "costo-retiro" }
  /** Cuántos pagos chicos sin orden de esta vuelta no escribieron fila (con la venta por unidad). Solo la cifra. */
  | { evento: "pagos-chicos"; cuantos: number };

/**
 * Por qué un pago quedó suelto. `repetido`: llegó a una orden ya pagada (no da otro paquete). `cerrada`: a una cerrada.
 * `costo-retiro`: el costo de un retiro que pagó el portero. Ese no es un suelto: queda `cobrado` y no se resuelve.
 */
export type MotivoSuelto = "sin-nota" | "nota-desconocida" | "otro-activo" | "sobrante" | "repetido" | "cerrada" | "costo-retiro";
/** Lo suelto de USDC que se puede asignar a mano a una orden abierta. Lo que sobra de una orden, otro activo y un costo, no. */
const ASIGNABLES: ReadonlySet<MotivoSuelto> = new Set(["sin-nota", "nota-desconocida", "repetido", "cerrada"]);

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
  /** `cobrado`: el costo de un retiro, que ya es nuestro. No se lista, no se asigna y no se devuelve. */
  estado: "suelto" | "asignado" | "devuelto" | "cobrado";
  orden: string | null;
  ref: string | null;
  ms: number;
}

/** `orden-posterior`: con la venta por unidad, la orden se creó después de la hora del pago y no puede ser la suya. */
export type Asignado =
  | { ok: true; pagada: boolean; sobrante: number }
  | { ok: false; motivo: "suelto" | "orden" | "no-asignable" | "orden-pagada" | "orden-cerrada" | "orden-posterior" }
  | { ok: false; motivo: "ya-resuelto"; estado: string };
export type Devuelto = { ok: true; repetido: boolean } | { ok: false; motivo: "suelto" } | { ok: false; motivo: "ya-resuelto"; estado: string };
export type PagadaAMano = { ok: true; repetido: boolean } | { ok: false; motivo: "orden" | "orden-cerrada" | "techo-altas" | "techo-sorteos" };
/** Lo que llegó a una orden y hay que devolver: cada operación con quién la mandó. */
export interface ParaDevolver {
  operacion: string;
  de: string;
  monto: number;
  tx: string;
}
/** `con-sorteos`: una orden por unidad que ya dio parte de sus sorteos no se cierra para devolver: se resuelve a mano. */
export type Cerrada =
  | { ok: true; repetido: boolean; recibido: number; devolver: ParaDevolver[] }
  | { ok: false; motivo: "orden" | "orden-pagada" | "sin-pagos" | "con-sorteos" };

/** El día UTC de un instante, `AAAA-MM-DD`: la clave de los techos diarios (los mismos de `altas.ts`). */
const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Lo que dejó atar un pago a su orden: si la orden quedó pagada (`concedido`), si una orden por unidad dio parte de sus sorteos
 * sin completarse (`parte`) y lo que no entró en la orden (`sobrante`), con por qué.
 */
interface Atribucion {
  concedido: boolean;
  parte: boolean;
  sobrante: number;
  motivo: "sobrante" | "repetido" | "cerrada";
}

/** Un pago a punto de atarse a una orden: el de Horizon o uno suelto que se asigna a mano. */
interface Operacion {
  operacion: string;
  pagingToken: string;
  tx: string;
  de: string;
  monto: number;
  ms: number;
}

/** Lo que `Cobros` necesita de lo que guarda el portero de los retiros que pagó (`UsoDePagos`). */
export type CostosDeRetiro = Pick<UsoDePagos, "disponible" | "costoDeRetiro">;

export class Cobros {
  private readonly idAlAzar: () => string;
  private readonly costos: CostosDeRetiro | undefined;
  private readonly conversion: Conversion | undefined;
  private readonly vigilante: boolean;

  /**
   * `sql` es el mismo SQLite de `cupos`, que ya creó las tablas. `costos` es opcional: sin él, o con sus tablas rotas, un
   * costo de retiro se lee como cualquier otro pago (`registrarLectura`). `conversion` también: sin ella, lo que llega de
   * más o dos veces a una orden por unidad va a los sueltos, como en las demás órdenes. `vigilante` (con la venta por unidad):
   * los pagos chicos sin orden no escriben fila, los costos sueltos se buscan en 72 horas y asignar a mano mira la hora del pago.
   */
  constructor(
    private readonly sql: Sql,
    private readonly cupos: Cupos,
    opciones: { idAlAzar?: () => string; costos?: CostosDeRetiro; conversion?: Conversion; vigilante?: boolean } = {},
  ) {
    this.idAlAzar = opciones.idAlAzar ?? ordenAlAzar;
    this.costos = opciones.costos;
    this.conversion = opciones.conversion;
    this.vigilante = opciones.vigilante === true;
  }

  /**
   * Cada cuánto conviene leer los pagos, para la alarma: `VIGILAR_CADA_MS` si la orden viva más nueva (sin pagar, sin cerrar y
   * sin vencer) nació hace menos de `VIGILAR_PRIMERO_MS`, `VIGILAR_DESPUES_MS` si es más vieja, y null sin órdenes vivas.
   */
  cadaCuantoVigilar(ahora: number): number | null {
    const f = this.filas("SELECT MAX(creada) AS nueva FROM ordenes WHERE pagada IS NULL AND metodo IS NULL AND vence > ?", ahora)[0];
    if (f?.nueva === null || f?.nueva === undefined) return null;
    return ahora - Number(f.nueva) < VIGILAR_PRIMERO_MS ? VIGILAR_CADA_MS : VIGILAR_DESPUES_MS;
  }

  /** Cuántas órdenes vivas hay (sin pagar, sin cerrar y sin vencer), para `/estado`. */
  ordenesVivas(ahora: number): number {
    return Number(this.filas("SELECT COUNT(*) AS n FROM ordenes WHERE pagada IS NULL AND metodo IS NULL AND vence > ?", ahora)[0]?.n ?? 0);
  }

  /**
   * Los sorteos que prometen las órdenes vivas (sin pagar, sin cerrar y sin vencer) nacidas hace menos de `RESERVA_ORDEN_MS`,
   * menos los que ya dieron por unidad (esos ya cuentan en el piso como derechos). Sin las de `excluirUsuario`: su orden nueva
   * reemplaza a la abierta. Para que muchas órdenes abiertas a la vez no prometan más de lo que Pollar puede patrocinar.
   * Síncrono: se llama adentro de la transacción que crea la orden.
   */
  sorteosEnOrdenesVivas(ahora: number, excluirUsuario: string | null = null): number {
    const dados = "COALESCE((SELECT SUM(d.sorteos) FROM derechos d WHERE d.ref LIKE 'orden:' || o.id || ':%'), 0)";
    const consulta =
      `SELECT COALESCE(SUM(MAX(0, o.sorteos - ${dados})), 0) AS n FROM ordenes o ` +
      "WHERE o.pagada IS NULL AND o.metodo IS NULL AND o.vence > ? AND o.creada > ? AND (? IS NULL OR o.usuario <> ?)";
    return Number(this.filas(consulta, ahora, ahora - RESERVA_ORDEN_MS, excluirUsuario, excluirUsuario)[0]?.n ?? 0);
  }

  /** Cuántos pagos chicos sin orden no escribieron fila hoy (UTC). */
  pagosChicosHoy(ahora: number): number {
    try {
      const o = JSON.parse(this.cupos.ajuste(AJUSTE_PAGOS_CHICOS) ?? "null") as { dia?: unknown; n?: unknown } | null;
      return o && o.dia === diaUtc(ahora) && typeof o.n === "number" && Number.isSafeInteger(o.n) ? o.n : 0;
    } catch {
      return 0;
    }
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
   * vencido, con algo ya pagado y creada hace menos de `ORDEN_CON_PAGO_VIVE_MS` (lo pagado a medias no se esconde). Una
   * cerrada para devolver no está abierta.
   */
  ordenAbierta(usuario: string, ahora: number, producto?: Producto["id"]): FilaOrden | null {
    const abierta = "pagada IS NULL AND metodo IS NULL AND (vence > ? OR (creada > ? AND EXISTS (SELECT 1 FROM pagos WHERE pagos.orden = ordenes.id)))";
    const desde = ahora - ORDEN_CON_PAGO_VIVE_MS;
    const f = producto
      ? this.filas(`SELECT * FROM ordenes WHERE usuario = ? AND producto = ? AND ${abierta} ORDER BY creada DESC LIMIT 1`, usuario, producto, ahora, desde)[0]
      : this.filas(`SELECT * FROM ordenes WHERE usuario = ? AND ${abierta} ORDER BY creada DESC LIMIT 1`, usuario, ahora, desde)[0];
    return f ? filaOrden(f) : null;
  }

  /**
   * Si la persona tiene alguna orden sin pagar creada hace menos de `ORDEN_CON_PAGO_VIVE_MS`, vencida o no, o una que se
   * reemplazó (con su hora) hace menos de `ORDEN_VIVE_MS`: entonces conviene leer los pagos antes de contestarle (pudo
   * pagar y no tocar «Ya pagué», o su pago ya estaba en camino cuando se reemplazó la orden).
   */
  tieneOrdenSinPagar(usuario: string, ahora: number): boolean {
    // Sin la columna del reemplazo (no se pudo sumar al arrancar, y entonces la venta está cerrada), la consulta de antes.
    if (this.cupos.faltaColumna("ordenes", "reemplazada"))
      return this.filas("SELECT 1 AS n FROM ordenes WHERE usuario = ? AND pagada IS NULL AND creada > ? LIMIT 1", usuario, ahora - ORDEN_CON_PAGO_VIVE_MS).length > 0;
    return (
      this.filas(
        "SELECT 1 AS n FROM ordenes WHERE usuario = ? AND pagada IS NULL AND ((metodo IS NULL AND creada > ?) OR (metodo = 'reemplazada' AND reemplazada > ?)) LIMIT 1",
        usuario,
        ahora - ORDEN_CON_PAGO_VIVE_MS,
        ahora - ORDEN_VIVE_MS,
      ).length > 0
    );
  }

  /**
   * Las órdenes sin pagar que ya recibieron algo (pagadas a medias), vencidas o no, de la más vieja a la más nueva (hasta
   * 500): para que administración las vea, las marque pagadas a mano o las cierre para devolver lo recibido. Sin la
   * persona. Las ya cerradas no figuran.
   */
  parciales(ahora: number, limite = 500): Array<{ id: string; producto: string; recibido: string; total: string; minimo: string; creada: number; vence: number; vencida: boolean }> {
    return this.filas(
      "SELECT o.id AS id, o.producto AS producto, o.monto AS monto, o.creada AS creada, o.vence AS vence, SUM(p.monto) AS recibido FROM ordenes o JOIN pagos p ON p.orden = o.id WHERE o.pagada IS NULL AND o.metodo IS NULL GROUP BY o.id ORDER BY o.creada, o.id LIMIT ?",
      limite,
    ).map((f) => ({
      id: String(f.id),
      producto: String(f.producto),
      recibido: usdcTexto(Number(f.recibido)),
      total: usdcTexto(Number(f.monto)),
      minimo: usdcTexto(this.minimoDeOrden({ id: String(f.id), monto: Number(f.monto) })),
      creada: Number(f.creada),
      vence: Number(f.vence),
      vencida: Number(f.vence) <= ahora,
    }));
  }

  /**
   * Lo mínimo que tiene que llegar para que esta orden quede pagada, en diezmillonésimas: el 95 % del precio del paquete,
   * redondeado para arriba, más el recargo del QR entero si lo lleva (`compras_qr_ordenes`). Sin recargo, el 95 % del
   * monto, como siempre. Todo en enteros.
   */
  minimoDeOrden(o: Pick<FilaOrden, "id" | "monto">): number {
    const recargo = this.recargoDe(o.id)?.recargo ?? 0;
    return recargo > 0 && recargo <= o.monto ? minimoDe(o.monto - recargo) + recargo : minimoDe(o.monto);
  }

  /** Cuánto llegó ya para una orden (lo atado en `pagos`), en diezmillonésimas. */
  recibido(id: string): number {
    return Number(this.filas("SELECT COALESCE(SUM(monto), 0) AS n FROM pagos WHERE orden = ?", id)[0]?.n ?? 0);
  }

  /**
   * La orden abierta de esta persona para este producto o, si no hay, una nueva de 72 horas con el precio de ahora. Una
   * nueva no nace con la venta pausada, ni si `freno` (el piso de créditos) la para; la abierta se devuelve igual. Una
   * pagada a medias que ya había vencido vuelve con otras 72 horas: la persona completa lo que falta con la misma nota.
   *
   * Con `recargo` (la persona ya avisó una carga con QR y no la pagó), la orden suma el recargo a su monto y queda atada
   * a esa compra. Una abierta que no lleva este mismo recargo no se devuelve: se reemplaza por una nueva, y lo mismo las
   * otras sin pagar atadas a la misma compra, para que el recargo se cobre una sola vez. Si alguna de esas
   * ya recibió algo, `compra-en-curso` y no se escribe nada. Sin `recargo`, una abierta con recargo se reemplaza igual:
   * su compra ya se pagó por otra orden. `sinFrenos` (el permiso de terminar) no mira la venta pausada ni el piso.
   */
  crearOrden(
    p: { usuario: string; producto: Producto; freno?: (c: { sorteos: number; altaNueva: boolean }) => "altas-pausadas" | "fuera-del-piloto" | null; recargo?: RecargoDeOrden | null; sinFrenos?: boolean },
    ahora: number,
  ): OrdenCreada {
    if (!texto(p.usuario, 200)) throw new Error("orden-usuario");
    const quiere = p.recargo ?? null;
    if (quiere && (!Number.isSafeInteger(quiere.recargo) || quiere.recargo < 0 || !Number.isSafeInteger(quiere.compra))) throw new Error("orden-recargo");
    return this.cupos.transaccion((): OrdenCreada => {
      const abierta = this.ordenAbierta(p.usuario, ahora, p.producto.id);
      const lleva = abierta ? this.recargoDe(abierta.id) : null;
      const coincide = (lleva?.compra ?? null) === (quiere?.compra ?? null);
      // Por unidad, la abierta vale para la misma cantidad. Con otra, se reemplaza si no recibió nada. Si ya recibió algo,
      // vuelve la abierta: la cantidad nunca cambia a mitad de un pago.
      const otraCantidad = abierta !== null && p.producto.id === "sorteo" && abierta.sorteos !== p.producto.sorteos;
      const sigue = abierta !== null && coincide && (!otraCantidad || this.recibido(abierta.id) > 0);
      if (abierta && sigue && abierta.vence <= ahora) {
        this.sql.exec("UPDATE ordenes SET vence = ? WHERE id = ? AND pagada IS NULL", ahora + ORDEN_VIVE_MS, abierta.id);
        return { ok: true, orden: this.orden(abierta.id) as FilaOrden, nueva: false };
      }
      if (abierta && sigue) return { ok: true, orden: abierta, nueva: false };
      if (!p.sinFrenos) {
        if (this.cupos.ajuste(AJUSTE_VENTA_PAUSADA) === "1") return { ok: false, motivo: "venta-pausada" };
        const frenado = p.freno?.({ sorteos: p.producto.sorteos, altaNueva: this.cupos.altaDe(p.usuario) === null }) ?? null;
        if (frenado) return { ok: false, motivo: frenado };
      }
      // Lo que se reemplaza: la abierta de este producto que no lleva este recargo y, con recargo, las otras sin pagar
      // atadas a la misma compra (de otro producto, o vencidas). Primero se mira todo y recién después se escribe.
      const reemplazar = abierta ? [abierta] : [];
      if (quiere) for (const o of this.ordenesSinPagar(p.usuario)) if (o.id !== abierta?.id && this.recargoDe(o.id)?.compra === quiere.compra) reemplazar.push(o);
      if (reemplazar.some((o) => this.recibido(o.id) > 0)) return { ok: false, motivo: "compra-en-curso" };
      let id: string | null = null;
      for (let i = 0; i < 8 && !id; i++) {
        const c = this.idAlAzar();
        if (ID_ORDEN.test(c) && !this.orden(c)) id = c;
      }
      if (!id) throw new Error("orden-id");
      for (const o of reemplazar) this.reemplazar(o.id, `orden:${id}`, ahora);
      this.sql.exec(
        "INSERT INTO ordenes (id, usuario, producto, monto, sorteos, dias, creada, vence, pagada, metodo, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
        id,
        p.usuario,
        p.producto.id,
        p.producto.monto + (quiere?.recargo ?? 0),
        p.producto.sorteos,
        p.producto.dias,
        ahora,
        ahora + ORDEN_VIVE_MS,
      );
      if (quiere) this.sql.exec("INSERT INTO compras_qr_ordenes (orden, compra, recargo) VALUES (?, ?, ?)", id, quiere.compra, quiere.recargo);
      return { ok: true, orden: this.orden(id) as FilaOrden, nueva: true };
    });
  }

  /** El recargo del QR que lleva una orden, o null si no lleva. */
  recargoDe(id: string): RecargoDeOrden | null {
    const f = this.filas("SELECT compra, recargo FROM compras_qr_ordenes WHERE orden = ?", id)[0];
    return f ? { compra: Number(f.compra), recargo: Number(f.recargo) } : null;
  }

  /** Las órdenes sin pagar ni cerrar de una persona, de cualquier fecha (también las vencidas). */
  ordenesSinPagar(usuario: string): FilaOrden[] {
    return this.filas("SELECT * FROM ordenes WHERE usuario = ? AND pagada IS NULL AND metodo IS NULL ORDER BY creada, id", usuario).map(filaOrden);
  }

  /**
   * Cierra una orden sin pagar porque la persona empezó a cargar con QR y su orden nueva lleva el recargo: queda
   * `reemplazada`, con la hora (no se completa, y lo que llegue con su nota va a los sueltos como `cerrada`, salvo un
   * pago que ya estaba en camino: ver `atribuir`). Sin abrir transacción: quien llama ya está adentro y ya miró que no
   * haya recibido nada.
   */
  reemplazar(id: string, ref: string, ahora: number): void {
    this.sql.exec("UPDATE ordenes SET metodo = 'reemplazada', ref = ?, reemplazada = ? WHERE id = ? AND pagada IS NULL AND metodo IS NULL", `reemplazada:${ref}`.slice(0, 120), ahora, id);
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
   * Anota el costo de un retiro que pagó el portero: un cobro, no un suelto. Queda `cobrado` y sin orden, así `sueltos`, la
   * cuenta de `/estado`, `asignar` y `devolver` no lo ven (todos miran `estado = 'suelto'`).
   */
  private costoCobrado(p: { operacion: string; tx: string; de: string; activo: string; monto: number; nota: string | null }, ms: number): void {
    this.sql.exec(
      [
        "INSERT INTO pagos_sueltos (operacion, tx, de, activo, monto, nota, motivo, estado, orden, ref, ms)",
        "VALUES (?, ?, ?, ?, ?, ?, 'costo-retiro', 'cobrado', NULL, NULL, ?)",
      ].join(" "),
      p.operacion,
      p.tx,
      p.de,
      p.activo,
      p.monto,
      p.nota,
      ms,
    );
  }

  /**
   * Si este pago es el costo de un retiro que pagó el portero: de USDC, de una transacción que el portero guardó (por el hash
   * de afuera o el de adentro), de la cuenta que pagó el retiro y por el costo exacto que exigía. Sin `costos`, o con sus tablas
   * rotas, nunca: la lectura es la de siempre.
   */
  private esCostoDeRetiro(p: PagoLeido): boolean {
    if (!p.esUsdc || !this.costos?.disponible()) {
      return false;
    }
    const hashes = [p.tx, p.txInterna].filter((h): h is string => typeof h === "string" && HASH_DE_TX.test(h));
    return hashes.length > 0 && this.costos.costoDeRetiro(hashes, p.de, p.monto);
  }

  /**
   * Pasa a `costo-retiro` lo que una lectura anterior dejó suelto y que, visto ahora, es el costo de un retiro del portero: de
   * USDC, sin nota o con una nota que no era de ninguna orden, de una transacción guardada, de la misma cuenta y por el costo
   * exacto. Cubre lo que leyó una versión del código sin este reconocimiento, que no se vuelve a leer (`visto`). No toca lo ya
   * atado a una orden. Si la consulta falla no hace nada: la lectura sigue.
   */
  private reclasificarCostos(ahora: number): void {
    const costos = this.costos;
    if (!costos?.disponible()) {
      return;
    }
    try {
      // Con la venta por unidad, solo lo de las últimas 72 horas: lo viejo ya se miró y no atrasa cada lectura.
      const reciente = this.vigilante ? " AND ms > ?" : "";
      const candidatos = this.filas(
        [
          "SELECT operacion, tx, de, monto FROM pagos_sueltos",
          `WHERE estado = 'suelto' AND activo = 'USDC' AND orden IS NULL AND motivo IN ('sin-nota','nota-desconocida')${reciente}`,
          "ORDER BY ms, operacion LIMIT 500",
        ].join(" "),
        ...(this.vigilante ? [ahora - RECLASIFICAR_MS] : []),
      );
      for (const c of candidatos) {
        if (costos.costoDeRetiro([String(c.tx)], String(c.de), Number(c.monto))) {
          const cobrado = "UPDATE pagos_sueltos SET motivo = 'costo-retiro', estado = 'cobrado' WHERE operacion = ? AND estado = 'suelto'";
          this.sql.exec(cobrado, String(c.operacion));
        }
      }
    } catch {
      // Una consulta que falla no tumba la lectura de los pagos: queda para la vuelta siguiente.
    }
  }

  /** Los costos de retiro cobrados desde `desde` (ms): cuántos y cuánto suman, en diezmillonésimas de USDC. Para `/estado`. */
  costosDeRetiro(desde: number): { cuantos: number; monto: number } {
    const f = this.filas("SELECT COUNT(*) AS n, COALESCE(SUM(monto), 0) AS m FROM pagos_sueltos WHERE motivo = 'costo-retiro' AND ms > ?", desde)[0];
    return { cuantos: Number(f?.n ?? 0), monto: Number(f?.m ?? 0) };
  }

  /**
   * Una vuelta de lectura, todo o nada: cada pago a su orden o a los sueltos, y el cursor (el mayor entre el guardado y
   * el leído). Una operación que ya se anotó no se vuelve a anotar. Devuelve lo que pasó, para la bitácora.
   *
   * El costo de un retiro que pagó el portero se reconoce antes de mirar la nota (`esCostoDeRetiro`): queda `cobrado` y no
   * se ata a ninguna orden aunque su nota se lea como una. Al final de la vuelta, `reclasificarCostos` hace lo mismo con lo
   * que una lectura anterior dejó suelto.
   */
  registrarLectura(pagos: readonly PagoLeido[], cursor: string | null, ahora: number): EventoCobro[] {
    return this.cupos.transaccion(() => {
      const eventos: EventoCobro[] = [];
      let chicos = 0;
      for (const p of pagos) {
        if (this.visto(p.operacion)) continue;
        const nota = p.memo ? (p.memo.tipo === "otro" ? `(${p.memo.valor})` : p.memo.valor) : null;
        const base = { operacion: p.operacion, tx: p.tx, de: p.de, activo: p.activo, monto: p.monto, nota };
        if (!p.esUsdc) {
          // Con la venta por unidad, menos de una unidad de otra moneda es basura: no escribe fila y no tapa los sueltos.
          if (this.vigilante && p.monto < CHICO_OTRO) {
            chicos += 1;
            continue;
          }
          this.suelto(base, "otro-activo", null, p.ms);
          eventos.push({ evento: "pago-suelto", motivo: "otro-activo" });
          continue;
        }
        if (this.esCostoDeRetiro(p)) {
          this.costoCobrado(base, p.ms);
          eventos.push({ evento: "costo-retiro" });
          continue;
        }
        const id = ordenDeNota(p.memo);
        const o = id ? this.orden(id) : null;
        if (!o) {
          // Lo mismo con el USDC chico sin orden. El costo de un retiro ya se reconoció arriba, por su transacción.
          if (this.vigilante && p.monto < CHICO_USDC) {
            chicos += 1;
            continue;
          }
          const motivo = p.memo ? "nota-desconocida" : "sin-nota";
          this.suelto(base, motivo, null, p.ms);
          eventos.push({ evento: "pago-suelto", motivo });
          continue;
        }
        const r = this.atribuir(o, p, ahora);
        // Lo de más o repetido de una orden por unidad se vuelve sorteos, con los frenos de la venta de hoy. El resto, suelto.
        const convertido = r.sobrante > 0 ? this.convertir(o, r.motivo, p, r.sobrante, ahora) : 0;
        const queda = r.sobrante - convertido;
        if (queda > 0) {
          this.suelto({ ...base, monto: queda }, r.motivo, o.id, p.ms);
          eventos.push({ evento: "pago-suelto", motivo: r.motivo });
        }
        if (convertido > 0) eventos.push({ evento: "orden-convertida", producto: o.producto });
        if (r.parte) eventos.push({ evento: "orden-parte", producto: o.producto });
        if (r.concedido) eventos.push({ evento: "alta-pago", producto: o.producto });
        if (r.concedido && estaCerrada(o)) eventos.push({ evento: "orden-honrada", producto: o.producto });
      }
      if (chicos > 0) {
        this.cupos.fijarAjuste(AJUSTE_PAGOS_CHICOS, JSON.stringify({ dia: diaUtc(ahora), n: this.pagosChicosHoy(ahora) + chicos }), ahora);
        eventos.push({ evento: "pagos-chicos", cuantos: chicos });
      }
      this.reclasificarCostos(ahora);
      // El cursor va después de los pagos, en la misma transacción: si no se puede escribir, no queda ningún pago.
      const nuevo = mayor(this.cursor(), cursor);
      if (nuevo !== null && nuevo !== this.cursor()) this.cupos.fijarAjuste(AJUSTE_CURSOR, nuevo, ahora);
      return eventos;
    });
  }

  /**
   * Ata una operación a una orden, sin abrir transacción (quien llama ya está adentro de una).
   *
   * - Sin pagar: se anota lo que falta para el monto (lo de más es `sobrante`); si lo recibido llega al mínimo
   *   (`minimoDeOrden`: el 95 % del precio más el recargo entero), queda pagada y se da lo suyo.
   * - Ya pagada: no da nada. El pago entero va a los sueltos como `repetido` de esa orden, para devolverlo o asignarlo a
   *   mano a otra orden abierta: un paquete nuevo nace siempre de una orden nueva, con la venta, el piso y el precio de hoy.
   * - Cerrada para devolver: tampoco da nada, y el pago entero va a los sueltos como `cerrada`.
   * - Reemplazada: lo mismo, salvo un pago que ya estaba en camino (`honra`): ese la deja pagada y da lo suyo, como si
   *   no se hubiera reemplazado. La hora del reemplazo queda escrita.
   * - Por unidad y sin pagar: con cada pago da los sorteos de lo que llegó (`floor(recibido / precio)`, todos desde el 95 %),
   *   la diferencia con lo ya dado (`parte`). Queda pagada recién al llegar al 95 %. Lo que falta sigue con la misma nota.
   */
  private atribuir(o: FilaOrden, op: Operacion, ahora: number): Atribucion {
    if (estaCerrada(o) && !this.honra(o, op)) return { concedido: false, parte: false, sobrante: op.monto, motivo: "cerrada" };
    if (o.pagada !== null) return { concedido: false, parte: false, sobrante: op.monto, motivo: "repetido" };
    const previo = this.recibido(o.id);
    const parte = Math.min(op.monto, Math.max(0, o.monto - previo));
    if (parte > 0) this.sql.exec("INSERT INTO pagos (operacion, paging_token, tx, orden, de, monto, ms) VALUES (?, ?, ?, ?, ?, ?, ?)", op.operacion, op.pagingToken, op.tx, o.id, op.de, parte, op.ms);
    const sobrante = op.monto - parte;
    const completa = previo + parte >= this.minimoDeOrden(o);
    const pagada = "UPDATE ordenes SET pagada = ?, metodo = 'usdc', ref = ? WHERE id = ? AND pagada IS NULL";
    if (o.producto === "sorteo") {
      const dio = this.darUnidades(o, previo + parte, completa, `orden:${o.id}:${op.operacion}`, ahora);
      if (completa) this.sql.exec(pagada, ahora, `usdc:${op.operacion}`, o.id);
      return { concedido: completa, parte: dio && !completa, sobrante, motivo: "sobrante" };
    }
    if (!completa) return { concedido: false, parte: false, sobrante, motivo: "sobrante" };
    this.sql.exec(pagada, ahora, `usdc:${op.operacion}`, o.id);
    this.conceder(o, `orden:${o.id}`, ahora);
    return { concedido: true, parte: false, sobrante, motivo: "sobrante" };
  }

  /**
   * Los sorteos que ya dio una orden por unidad: los derechos con `ref` `orden:<id>:…` (cada pago que dio algo deja el suyo).
   * Las demás órdenes dan todo de una vez con `ref` `orden:<id>`, que no entra acá.
   */
  dadosDeOrden(id: string): number {
    return Number(this.filas("SELECT COALESCE(SUM(sorteos), 0) AS n FROM derechos WHERE ref LIKE ?", `orden:${id}:%`)[0]?.n ?? 0);
  }

  /**
   * Da lo que le toca a una orden por unidad con `recibido` (lo atado a ella): todos sus sorteos si `completa`, y si no uno por
   * cada precio entero que llegó, sin contar el recargo del QR. Otorga solo la diferencia con lo ya dado, con `ref`. Devuelve si
   * dio algo. Sin abrir transacción: quien llama ya está adentro.
   */
  private darUnidades(o: FilaOrden, recibido: number, completa: boolean, ref: string, ahora: number): boolean {
    const recargo = this.recargoDe(o.id)?.recargo ?? 0;
    const precio = Math.floor((o.monto - recargo) / o.sorteos);
    const tocan = completa ? o.sorteos : precio > 0 ? Math.min(o.sorteos, Math.floor(Math.max(0, recibido - recargo) / precio)) : 0;
    const faltan = tocan - this.dadosDeOrden(o.id);
    if (faltan < 1) return false;
    this.conceder(o, ref, ahora, faltan);
    return true;
  }

  /**
   * Convierte en sorteos lo que llegó de más (`sobrante`), dos veces (`repetido`) o a una orden reemplazada (`cerrada`) de una
   * orden por unidad: `floor(monto / precio de hoy)`, como mucho `CONVERSION_MAXIMA`, con `ref` `conv:<operacion>` y origen
   * `paquete`. Solo si hoy se vende por unidad y la conversión lo permite (`Conversion.permite`). Una orden cerrada para
   * devolver nunca convierte. Devuelve lo que se convirtió, en diezmillonésimas: el resto queda suelto, como siempre.
   */
  private convertir(o: FilaOrden, motivo: "sobrante" | "repetido" | "cerrada", op: Operacion, monto: number, ahora: number): number {
    if (o.producto !== "sorteo" || !this.conversion) return 0;
    if (motivo === "cerrada" && o.metodo !== "reemplazada") return 0;
    const unidad = this.conversion.precio();
    if (!unidad || unidad.id !== "sorteo" || unidad.sorteos !== 1 || unidad.monto <= 0) return 0;
    const sorteos = Math.min(CONVERSION_MAXIMA, Math.floor(monto / unidad.monto));
    if (sorteos < 1) return 0;
    const alta = this.cupos.altaDe(o.usuario);
    if (!this.conversion.permite({ usuario: o.usuario, sorteos, altaNueva: alta === null }, ahora)) return 0;
    const nueva = [
      "INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada)",
      "VALUES (?, 'pago', ?, NULL, NULL, 'autorizada', ?, ?)",
    ].join(" ");
    if (!alta) this.sql.exec(nueva, o.usuario, `orden:${o.id}`, ahora, ahora);
    const ref = `conv:${op.operacion}`;
    const derecho = { usuario: o.usuario, cuenta: alta?.cuenta ?? null, origen: "paquete" as const, ref, sorteos, dias: unidad.dias };
    return this.cupos.otorgar(derecho, ahora).repetido ? 0 : sorteos * unidad.monto;
  }

  /**
   * Si un pago a una orden reemplazada se honra: ya estaba en camino cuando se reemplazó (su hora en la red es como mucho
   * la del reemplazo más `GRACIA_REEMPLAZO_MS`) y, solo, llega al 95 % del monto. Un pago sin hora no se honra. Una
   * cerrada para devolver, nunca.
   */
  private honra(o: FilaOrden, op: Operacion): boolean {
    if (!puedeHonrarse(o) || !Number.isFinite(op.ms) || op.ms <= 0) return false;
    return op.ms <= (o.reemplazada as number) + GRACIA_REEMPLAZO_MS && this.recibido(o.id) + op.monto >= this.minimoDeOrden(o);
  }

  /**
   * Lo que da una orden pagada: el alta si la persona no tenía (un pago siempre cubre la activación) y los sorteos de la
   * orden, que vencen a los días de la orden desde ahora. Si la persona ya tiene su cuenta atada, cuentan para esa cuenta;
   * si no, se atan cuando el servidor sepa su cuenta (`/v1/alta/estado` o `/v1/alta/pago`). `sorteos` es para la orden por
   * unidad, que da de a partes: sin él, los de la orden.
   */
  private conceder(o: FilaOrden, ref: string, ahora: number, sorteos = o.sorteos): void {
    const alta = this.cupos.altaDe(o.usuario);
    if (!alta) this.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'pago', ?, NULL, NULL, 'autorizada', ?, ?)", o.usuario, `orden:${o.id}`, ahora, ahora);
    const origen = o.producto === "alta" ? "alta" : "paquete";
    this.cupos.otorgar({ usuario: o.usuario, cuenta: alta?.cuenta ?? null, origen, ref, sorteos, dias: o.dias }, ahora);
  }

  /**
   * Una orden que se pagó por fuera (QR en bolivianos, a mano): queda pagada y da lo mismo que un pago en USDC. Otra vez
   * es `repetido`. Cuenta para los techos diarios de altas y de sorteos dados a mano: con la clave de cupones filtrada no
   * se regalan paquetes. Una orden cerrada para devolver no se marca.
   */
  marcarPagadaAMano(p: { orden: string; metodo: "a-mano" | "qr-bs"; ref: string; techoAltas: number; techoSorteos: number }, ahora: number): PagadaAMano {
    return this.cupos.transaccion((): PagadaAMano => {
      const o = this.orden(p.orden);
      if (!o) return { ok: false, motivo: "orden" };
      if (estaCerrada(o)) return { ok: false, motivo: "orden-cerrada" };
      if (o.pagada !== null) return { ok: true, repetido: true };
      const dia = diaUtc(ahora);
      const altasHoy = Number(this.cupos.ajuste(`altas_dia:${dia}`) ?? 0);
      const sorteosHoy = Number(this.cupos.ajuste(`derechos_dia:${dia}`) ?? 0);
      const altaNueva = this.cupos.altaDe(o.usuario) === null;
      if (altaNueva && altasHoy + 1 > p.techoAltas) return { ok: false, motivo: "techo-altas" };
      if (sorteosHoy + o.sorteos > p.techoSorteos) return { ok: false, motivo: "techo-sorteos" };
      this.sql.exec("UPDATE ordenes SET pagada = ?, metodo = ?, ref = ? WHERE id = ? AND pagada IS NULL", ahora, p.metodo, `${p.metodo}:${p.ref}`, o.id);
      // Por unidad, lo que ya dio con cada pago no se da otra vez: solo lo que falta.
      if (o.producto === "sorteo") this.darUnidades(o, o.monto, true, `orden:${o.id}:${p.metodo}`, ahora);
      else this.conceder(o, `orden:${o.id}`, ahora);
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
   * Asigna a mano un pago suelto de USDC (sin nota, con una nota que no era de ninguna orden, o repetido) a una orden
   * abierta: cuenta como si hubiera llegado con su nota. Lo que sobre queda como sobrante de esa orden, para devolverlo.
   * Lo que no es USDC y lo que ya es un sobrante no se asignan: se devuelven. A una orden ya pagada no se asigna nada:
   * no daría nada y el pago quedaría atado a ella.
   */
  asignar(p: { operacion: string; orden: string }, ahora: number): Asignado {
    return this.cupos.transaccion((): Asignado => {
      const f = this.filas("SELECT * FROM pagos_sueltos WHERE operacion = ?", p.operacion)[0];
      if (!f) return { ok: false, motivo: "suelto" };
      const s = this.filaSuelto(f);
      if (s.estado !== "suelto") return { ok: false, motivo: "ya-resuelto", estado: s.estado };
      if (s.activo !== "USDC" || !ASIGNABLES.has(s.motivo)) return { ok: false, motivo: "no-asignable" };
      // Por las dudas: una operación que ya está atada a una orden no se ata otra vez.
      if (this.filas("SELECT 1 AS n FROM pagos WHERE operacion = ?", s.operacion).length) return { ok: false, motivo: "no-asignable" };
      const o = this.orden(p.orden);
      if (!o) return { ok: false, motivo: "orden" };
      if (estaCerrada(o)) return { ok: false, motivo: "orden-cerrada" };
      if (o.pagada !== null) return { ok: false, motivo: "orden-pagada" };
      // Con la venta por unidad, solo a una orden creada antes del pago: una de después no puede ser la que se quiso pagar.
      if (this.vigilante && o.creada > s.ms) return { ok: false, motivo: "orden-posterior" };
      const r = this.atribuir(o, { operacion: s.operacion, pagingToken: s.operacion, tx: s.tx, de: s.de, monto: s.monto, ms: s.ms }, ahora);
      if (r.sobrante > 0) this.sql.exec("UPDATE pagos_sueltos SET monto = ?, motivo = ?, orden = ? WHERE operacion = ?", r.sobrante, r.motivo, o.id, s.operacion);
      else this.sql.exec("UPDATE pagos_sueltos SET estado = 'asignado', orden = ? WHERE operacion = ?", o.id, s.operacion);
      return { ok: true, pagada: this.orden(o.id)?.pagada !== null, sobrante: r.sobrante };
    });
  }

  /**
   * Cierra una orden pagada a medias para devolver lo que llegó: queda con `metodo` `devuelta` y su `ref`, sin pagar y
   * con sus pagos atados (lo que se devuelve), y ya no se completa. Se cierra **antes** de devolver: lo que llegue
   * después va a los sueltos. Una pagada no se cierra; una sin nada recibido tampoco (no hay qué devolver). Cerrarla otra
   * vez devuelve lo mismo, sin cambiar su `ref`. Quien llama tiene que haber leído antes los pagos nuevos.
   */
  cerrar(p: { orden: string; ref: string }): Cerrada {
    return this.cupos.transaccion((): Cerrada => {
      const o = this.orden(p.orden);
      if (!o) return { ok: false, motivo: "orden" };
      const repetido = estaCerrada(o);
      if (!repetido && o.pagada !== null) return { ok: false, motivo: "orden-pagada" };
      const devolver = this.filas("SELECT operacion, de, monto, tx FROM pagos WHERE orden = ? ORDER BY ms, operacion", o.id).map((f) => ({ operacion: String(f.operacion), de: String(f.de), monto: Number(f.monto), tx: String(f.tx) }));
      if (!devolver.length) return { ok: false, motivo: "sin-pagos" };
      // Una orden por unidad que ya dio sorteos con lo que llegó: devolverlo todo dejaría esos sorteos sin pagar.
      if (!repetido && o.producto === "sorteo" && this.dadosDeOrden(o.id) > 0) return { ok: false, motivo: "con-sorteos" };
      if (!repetido) this.sql.exec("UPDATE ordenes SET metodo = 'devuelta', ref = ? WHERE id = ? AND pagada IS NULL AND metodo IS NULL", `devuelta:${p.ref}`, o.id);
      return { ok: true, repetido, recibido: devolver.reduce((a, x) => a + x.monto, 0), devolver };
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
  /**
   * Lo que se hace antes de cada lectura de Horizon, con la venta por unidad: refrescar el saldo de créditos guardado, que es
   * lo que mira la conversión. Lo que falle acá no frena la lectura. Sin esto, la lectura de siempre.
   */
  antes?: () => Promise<unknown>;
  /**
   * Con la venta por unidad: si una lectura termina con todas sus páginas llenas, se lee otra enseguida, sin pasar de
   * `PAGINAS_POR_MINUTO` páginas en un minuto, y el atraso queda para `/estado` (`atraso`). Sin esto, cinco páginas por vuelta.
   */
  alDia?: boolean;
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
  /** Cuándo se pidió cada página del último minuto, para el tope de `PAGINAS_POR_MINUTO`. En memoria. */
  private paginas: number[] = [];
  /** Si la última lectura quedó con páginas por leer (o no se pudo terminar), y cuándo terminó. En memoria. */
  private atrasado = false;
  private terminada: number | null = null;

  constructor(private readonly o: OpcionesLector) {
    this.pedir = haciaHorizon(o.fetch);
    this.reloj = o.reloj ?? (() => Date.now());
    this.registrar = o.registrar ?? (() => {});
    this.cadaMs = o.cadaMs ?? HORIZON_CADA_MS;
  }

  /** Las páginas pedidas en el último minuto. */
  private paginasDelMinuto(): number {
    const desde = this.reloj() - 60_000;
    this.paginas = this.paginas.filter((t) => t > desde);
    return this.paginas.length;
  }

  private contar(n: number): void {
    const ahora = this.reloj();
    for (let i = 0; i < n; i++) this.paginas.push(ahora);
  }

  /** Anota lo leído: los pagos y el cursor en una transacción, y sus hechos en el registro de sucesos (sin personas ni notas). */
  private anotar(l: Extract<LecturaHorizon, { ok: true }>): void {
    const eventos = this.o.cobros.registrarLectura(l.pagos, l.cursor, this.reloj());
    for (const e of eventos) {
      const datos = "producto" in e ? { producto: e.producto } : "motivo" in e ? { motivo: e.motivo } : "cuantos" in e ? { cuantos: e.cuantos } : {};
      this.registrar(e.evento, datos);
    }
  }

  /** Para `/estado`, con la venta por unidad: si la lectura va atrasada, las páginas del último minuto y cuándo terminó la última. */
  atraso(): { atrasado: boolean; paginasMinuto: number; ultimaLectura: number | null } {
    return { atrasado: this.atrasado, paginasMinuto: this.paginasDelMinuto(), ultimaLectura: this.terminada };
  }

  leer(): Promise<{ ok: boolean }> {
    if (this.enCurso) return this.enCurso;
    if (this.reloj() - this.ultima < this.cadaMs) return Promise.resolve(this.ultimo);
    this.ultima = this.reloj();
    this.enCurso = (async () => {
      try {
        if (this.o.antes) {
          try {
            await this.o.antes();
          } catch {
            // Sin el saldo fresco, la conversión mira el que había: lo peor es que lo de más quede suelto.
          }
        }
        let medida: MedidaDeLectura = { paginas: 0, llena: false };
        const l = await leerPagos(this.pedir, this.o.cuenta, this.o.cobros.cursor(), this.o.esperaMs, medida);
        this.contar(medida.paginas);
        if (!l.ok) {
          this.registrar("error-horizon", { donde: "cobros" });
          this.atrasado = this.o.alDia === true;
          return (this.ultimo = { ok: false });
        }
        // Desde acá, sin await: los pagos y el cursor, en una transacción.
        this.anotar(l);
        if (!l.completo) this.registrar("error-horizon", { donde: "cobros", completo: 0 });
        let completo = l.completo;
        // Ponerse al día: con todas las páginas llenas puede haber más (mil pagos chicos delante de uno de verdad). Se sigue
        // leyendo mientras el tope por minuto deje otra lectura entera. Lo que quede, en la vuelta siguiente.
        while (this.o.alDia && completo && medida.llena && this.paginasDelMinuto() + PAGINAS <= PAGINAS_POR_MINUTO) {
          medida = { paginas: 0, llena: false };
          const otra = await leerPagos(this.pedir, this.o.cuenta, this.o.cobros.cursor(), this.o.esperaMs, medida);
          this.contar(medida.paginas);
          if (!otra.ok) {
            this.registrar("error-horizon", { donde: "cobros" });
            completo = false;
            break;
          }
          this.anotar(otra);
          if (!otra.completo) {
            this.registrar("error-horizon", { donde: "cobros", completo: 0 });
            completo = false;
          }
        }
        if (this.o.alDia) {
          this.atrasado = !completo || medida.llena;
          this.terminada = this.reloj();
        }
        return (this.ultimo = { ok: completo });
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

/**
 * La parte de cobros de la alarma, con la venta por unidad: mientras haya órdenes vivas, lee los pagos sola (también con la
 * pantalla de la persona cerrada), cada vuelta en la primera media hora de la orden más nueva y cada 5 minutos después. Sin
 * órdenes vivas no lee ni pide otra vuelta. La lectura es la del lector, compartida con las rutas (como mucho una cada 5 s).
 */
export class VigilanteDeCobros {
  private readonly reloj: () => number;
  /** Cuándo leyó la última vez esta parte. En memoria: un reinicio lee en la primera vuelta. */
  private leido = Number.NEGATIVE_INFINITY;

  constructor(private readonly o: { cobros: Cobros; lector: LectorDeCobros; reloj?: () => number }) {
    this.reloj = o.reloj ?? (() => Date.now());
  }

  /** Si hay órdenes vivas: si hace falta la alarma por los cobros. */
  hayQueVigilar(): boolean {
    return this.o.cobros.cadaCuantoVigilar(this.reloj()) !== null;
  }

  /** Una vuelta: lee si ya toca y devuelve cuándo vuelve a tocar (ms), o null sin órdenes vivas. */
  async vuelta(): Promise<number | null> {
    const ahora = this.reloj();
    const cada = this.o.cobros.cadaCuantoVigilar(ahora);
    if (cada === null) return null;
    if (ahora - this.leido >= cada) {
      this.leido = ahora;
      await this.o.lector.leer();
    }
    return this.leido + cada;
  }
}
