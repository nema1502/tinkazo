import { HORIZON_URLS, RPC_LISTAS } from "../stellar/config";
import { type OpcionesDeLectura, pedir } from "../stellar/pagos-red";
import { USDC_MAINNET } from "../stellar/pagos";
import { CENTAVO, DOLAR } from "./comision";

/**
 * Mirar en la red si una campaña ya pagó lo que cobra Tinkazo, desde el navegador y sin guardar nada.
 *
 * El cobro es un pago de dólares digitales (el USDC de Circle) a la cuenta de Tinkazo que lo recibe, con una nota que sale
 * del evento de la campaña (`notaDeLaComision`). Alcanza con que lo que llegó con esa nota sume el umbral (la comisión
 * menos el costo del retiro). Quién lo pagó no importa: lo puede pagar la cuenta de Google o cualquier otra billetera.
 *
 * Dos lugares donde mirar, y el orden importa:
 *
 * - Con la cuenta de quien organiza (`origen`), se miran PRIMERO sus propios pagos (`/accounts/{origen}/payments`): es su
 *   historia, no la llena un extraño y se ve igual desde otra compu con la misma cuenta. Después, y solo si eso no alcanza,
 *   se mira lo que recibió la cuenta de Tinkazo (para el pago desde otra billetera). Si esa segunda mirada no se puede
 *   terminar (cualquiera puede mandarle muchos pagos chicos), se ignora: nunca traba a una campaña.
 * - Sin `origen`, se mira lo que recibió la cuenta de Tinkazo.
 *
 * Se cuentan los pagos que salieron bien, a esa cuenta, del activo de Circle, con la nota exacta (un número de la nota
 * `id` o el mismo número escrito como texto: varias billeteras mandan la nota como texto), de al menos un centavo. Un
 * registro que no tiene la forma esperada no cuenta y no corta la mirada. Si no se pudo mirar todo, no se dice que no está
 * pagada: se dice que no se pudo consultar.
 */

export interface BusquedaDeComision {
  /** La cuenta de Tinkazo que recibe el cobro. */
  cuenta: string;
  /** La nota del evento, un número escrito con cifras. */
  nota: string;
  /** Los pagos anteriores a este instante (segundos Unix) no cuentan y la búsqueda no baja más. */
  desde: number;
  /** La cuenta de quien organiza: con ella se miran sus propios pagos. Sin ella, lo que recibió la cuenta de Tinkazo. */
  origen?: string | null;
}

export type LecturaDeComision = { tipo: "pagada"; suma: bigint } | { tipo: "no-pagada"; suma: bigint } | { tipo: "sin-consulta" };

/** Lo que se mira como mucho: 200 pagos por página (el máximo de Horizon), 10 páginas y 20 segundos en total. */
const POR_PAGINA = 200;
const MAX_PAGINAS = 10;
const TIEMPO_TOTAL_MS = 20_000;
const TIEMPO_PEDIDO_MS = 8_000;
const MAX_BYTES = 6 * 1024 * 1024;

const ES_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const ES_MONTO = /^\d{1,13}(\.\d{1,7})?$/;
const ES_NOTA = /^\d{1,20}$/;
const ES_FICHA = /^\d{1,30}$/;

const esObjeto = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

const stroopsDe = (monto: string): bigint => {
  const [enteros = "0", decimales = ""] = monto.split(".");
  return BigInt(enteros) * DOLAR + BigInt(decimales.padEnd(7, "0"));
};

const hora = (v: unknown): number | null => {
  if (typeof v !== "string" || !ES_HORA.test(v)) return null;
  const s = Math.floor(Date.parse(v) / 1000);
  return Number.isSafeInteger(s) && s > 0 ? s : null;
};

/** ¿La nota de la transacción es la del evento? El número de una nota `id`, o el mismo número escrito como texto. */
function esLaNota(tx: Record<string, unknown>, nota: string): boolean {
  const memo = tx.memo;
  if (typeof memo !== "string") return false;
  if (tx.memo_type === "text") return memo === nota;
  if (tx.memo_type !== "id" || !ES_NOTA.test(memo) || !ES_NOTA.test(nota)) return false;
  return BigInt(memo) === BigInt(nota);
}

/**
 * El monto que un registro de `payments?join=transactions` aporta al cobro, o `null` si no cuenta. Puro. No cuenta: lo que no
 * es un pago a esa cuenta, otro activo (aunque tenga el mismo código), una transacción que falló, otra nota, un monto sin la
 * forma esperada o menos de un centavo.
 */
export function pagoDeLaComision(rec: unknown, b: BusquedaDeComision): bigint | null {
  if (!esObjeto(rec)) return null;
  if (rec.type !== "payment" && rec.type !== "path_payment_strict_send" && rec.type !== "path_payment_strict_receive") return null;
  const tx = rec.transaction;
  if (rec.transaction_successful === false || !esObjeto(tx) || tx.successful === false) return null;
  if (rec.to !== b.cuenta || rec.asset_type !== "credit_alphanum4") return null;
  if (rec.asset_code !== USDC_MAINNET.code || rec.asset_issuer !== USDC_MAINNET.issuer) return null;
  if (b.origen && rec.from !== b.origen) return null;
  if (!esLaNota(tx, b.nota)) return null;
  const monto = rec.amount;
  if (typeof monto !== "string" || !ES_MONTO.test(monto)) return null;
  const stroops = stroopsDe(monto);
  return stroops >= CENTAVO ? stroops : null;
}

/**
 * Recorre los pagos de una cuenta de los más nuevos a los más viejos, de a páginas, y le muestra a `ver` cada uno que cuenta (con
 * su monto). `ver` devuelve `true` para cortar. Termina en `fin` (se miró todo lo que había desde `desde`), `cortado` (`ver` cortó),
 * `larga` (la red contestó bien pero quedaron páginas sin mirar: el tope de páginas, o el del tiempo después de una página entera)
 * o `sin-consulta` (la red no contestó o contestó algo raro). Las dos últimas no dicen que no está pagada.
 */
async function recorrer(
  b: BusquedaDeComision,
  op: OpcionesDeLectura,
  ver: (registro: Record<string, unknown>, monto: bigint) => boolean,
): Promise<"fin" | "cortado" | "larga" | "sin-consulta"> {
  const base = op.horizon ?? HORIZON_URLS.mainnet;
  const duena = b.origen ?? b.cuenta;
  const limite = Date.now() + TIEMPO_TOTAL_MS;
  const opciones: OpcionesDeLectura = { ...op, tiempoMs: op.tiempoMs ?? TIEMPO_PEDIDO_MS, maxBytes: op.maxBytes ?? MAX_BYTES };
  const porPagina = op.porPagina ?? POR_PAGINA;
  let cursor = "";
  for (let pagina = 0; pagina < (op.maxPaginas ?? MAX_PAGINAS); pagina++) {
    // Sin tiempo: si ya se leyó una página entera es una cuenta con muchos pagos, y si no, la red anda lenta.
    if (Date.now() >= limite) return pagina > 0 ? "larga" : "sin-consulta";
    const url =
      `${base}/accounts/${encodeURIComponent(duena)}/payments?join=transactions&order=desc&limit=${porPagina}` +
      `&include_failed=false${cursor ? `&cursor=${cursor}` : ""}`;
    const r = await pedir(url, undefined, opciones);
    // Una cuenta que no existe no recibió ni mandó nada.
    if (r.tipo === "no-existe") return "fin";
    if (r.tipo !== "ok" || !esObjeto(r.json) || !esObjeto(r.json._embedded) || !Array.isArray(r.json._embedded.records)) return "sin-consulta";
    const registros = r.json._embedded.records as unknown[];
    for (const rec of registros) {
      const creado = esObjeto(rec) ? hora(rec.created_at) : null;
      // Un registro sin fecha no se puede ubicar: no cuenta, pero tampoco corta la mirada.
      if (creado === null || !esObjeto(rec)) continue;
      if (creado < b.desde) return "fin";
      const monto = pagoDeLaComision(rec, b);
      if (monto !== null && ver(rec, monto)) return "cortado";
    }
    if (registros.length < porPagina) return "fin";
    const ultimo = registros[registros.length - 1];
    const ficha = esObjeto(ultimo) ? ultimo.paging_token : undefined;
    if (typeof ficha !== "string" || !ES_FICHA.test(ficha)) return "sin-consulta";
    cursor = ficha;
  }
  // Quedaron páginas sin mirar: no se puede decir que no está pagada.
  return "larga";
}

/** Lo que dice la suma de una cuenta, con `larga` aparte de `sin-consulta`: la mirada completa trata distinto a cada una. */
async function sumar(b: BusquedaDeComision, umbral: bigint, op: OpcionesDeLectura): Promise<LecturaDeComision | { tipo: "larga" }> {
  let suma = 0n;
  const fin = await recorrer(b, op, (_rec, monto) => {
    suma += monto;
    return suma >= umbral;
  });
  if (fin === "cortado") return { tipo: "pagada", suma };
  if (fin === "fin") return { tipo: "no-pagada", suma };
  return { tipo: fin };
}

/** Los pagos de una cuenta, de los más nuevos a los más viejos, sumando lo que cuenta hasta llegar al umbral. */
export async function mirarLaComision(b: BusquedaDeComision, umbral: bigint, op: OpcionesDeLectura = {}): Promise<LecturaDeComision> {
  const r = await sumar(b, umbral, op);
  return r.tipo === "larga" ? { tipo: "sin-consulta" } : r;
}

/** Un pago que cuenta, tal como lo muestra el guion de quien activa campañas: para poder devolver lo que se cobró de más. */
export interface PagoDeLaComision {
  hash: string;
  monto: bigint;
  /** Segundos Unix. */
  cuando: number;
  de: string;
}

/** Todos los pagos que cuentan para una nota, con su hash, su monto, cuándo llegaron y de quién. `completa` es si se miró todo. */
export async function listarLosPagosDeLaComision(
  b: BusquedaDeComision,
  op: OpcionesDeLectura = {},
): Promise<{ pagos: PagoDeLaComision[]; completa: boolean }> {
  const pagos: PagoDeLaComision[] = [];
  const fin = await recorrer(b, op, (rec, monto) => {
    const cuando = hora(rec.created_at);
    const hash = rec.transaction_hash;
    const de = rec.from;
    if (cuando !== null && typeof hash === "string" && typeof de === "string") pagos.push({ hash, monto, cuando, de });
    return false;
  });
  return { pagos, completa: fin === "fin" };
}

/**
 * La mirada completa que usa el panel. Con la cuenta de quien organiza, primero la propia historia y, si no alcanza, lo que
 * recibió la cuenta de Tinkazo (por si pagó desde otra billetera). Esa segunda se ignora solo si tiene tantos pagos que no se
 * termina de mirar (cualquiera le puede mandar muchos pagos chicos y eso no traba a nadie). Si la red no contesta, no se ignora:
 * es `sin-consulta`, porque decir que falta pagar a quien ya pagó desde otra billetera lo invitaría a pagar dos veces.
 */
export async function mirarLaComisionEnLaRed(b: BusquedaDeComision, umbral: bigint, op: OpcionesDeLectura = {}): Promise<LecturaDeComision> {
  if (!b.origen) return mirarLaComision(b, umbral, op);
  const propia = await mirarLaComision(b, umbral, op);
  if (propia.tipo === "pagada") return propia;
  const ajena = await sumar({ ...b, origen: null }, umbral, op);
  if (ajena.tipo === "pagada") return ajena;
  if (ajena.tipo === "sin-consulta") return ajena;
  // Lo que recibió la cuenta de Tinkazo incluye lo de la propia historia: si se miró entera, vale la suma más grande.
  if (ajena.tipo === "no-pagada") {
    const antes = propia.tipo === "no-pagada" ? propia.suma : 0n;
    return { tipo: "no-pagada", suma: ajena.suma > antes ? ajena.suma : antes };
  }
  return propia;
}

/* ------------------------------------------------------- la prueba de que la mirada está al día */

/**
 * Lo que dice una sola respuesta de `GET /accounts/{origen}/transactions`, que se compara con la secuencia con que se armó
 * el pago:
 *
 * - `al-dia`: la transacción más nueva de la cuenta tiene justo esa secuencia y ninguna lleva la nota del cobro. Se puede mandar.
 * - `ya-hay-pago`: hay una transacción exitosa de la cuenta con la nota del cobro. No se manda.
 * - `atrasada`: la secuencia no coincide (Horizon contestó desde un nodo atrasado, o la cuenta cambió). No se manda.
 * - `sin-consulta`: no se pudo ver.
 *
 * Son dos pedidos distintos (la cuenta y sus pagos) que Horizon puede contestar desde nodos distintos. Esta prueba sale de una
 * sola respuesta, así que no se contradice a sí misma.
 */
export type PruebaDeSecuencia = { tipo: "al-dia" } | { tipo: "ya-hay-pago"; hash: string } | { tipo: "atrasada" } | { tipo: "sin-consulta" };

const MAX_PAGINAS_DE_LA_PRUEBA = 3;
const BAJOS_32_BITS = (1n << 32n) - 1n;

export async function pruebaDeSecuencia(
  origen: string,
  secuencia: bigint,
  nota: string,
  op: OpcionesDeLectura = {},
): Promise<PruebaDeSecuencia> {
  const base = op.horizon ?? HORIZON_URLS.mainnet;
  const opciones: OpcionesDeLectura = { ...op, tiempoMs: op.tiempoMs ?? TIEMPO_PEDIDO_MS, maxBytes: op.maxBytes ?? MAX_BYTES };
  let cursor = "";
  let nueva: bigint | null = null;
  let terminada = false;
  const porPagina = op.porPagina ?? POR_PAGINA;
  for (let pagina = 0; pagina < MAX_PAGINAS_DE_LA_PRUEBA; pagina++) {
    const url =
      `${base}/accounts/${encodeURIComponent(origen)}/transactions?order=desc&limit=${porPagina}&include_failed=true` +
      (cursor ? `&cursor=${cursor}` : "");
    const r = await pedir(url, undefined, opciones);
    if (r.tipo === "no-existe") return { tipo: "atrasada" };
    if (r.tipo !== "ok" || !esObjeto(r.json) || !esObjeto(r.json._embedded) || !Array.isArray(r.json._embedded.records)) return { tipo: "sin-consulta" };
    const registros = r.json._embedded.records as unknown[];
    for (const rec of registros) {
      if (!esObjeto(rec) || rec.source_account !== origen) continue;
      if (rec.successful === true && typeof rec.hash === "string" && esLaNota(rec, nota)) return { tipo: "ya-hay-pago", hash: rec.hash };
      // La más nueva de la cuenta es la primera que se ve: el listado va de lo más nuevo a lo más viejo.
      if (nueva === null && typeof rec.source_account_sequence === "string" && ES_NOTA.test(rec.source_account_sequence)) {
        nueva = BigInt(rec.source_account_sequence);
      }
    }
    if (registros.length < porPagina) {
      terminada = true;
      break;
    }
    const ultimo = registros[registros.length - 1];
    const ficha = esObjeto(ultimo) ? ultimo.paging_token : undefined;
    if (typeof ficha !== "string" || !ES_FICHA.test(ficha)) return { tipo: "sin-consulta" };
    cursor = ficha;
  }
  if (nueva !== null) return compararSecuencia(nueva, secuencia);
  // Una cuenta que nunca mandó nada conserva la secuencia con que nació: sus 32 bits de abajo en cero.
  if (terminada) return (secuencia & BAJOS_32_BITS) === 0n ? { tipo: "al-dia" } : { tipo: "atrasada" };
  return { tipo: "sin-consulta" };
}

const compararSecuencia = (vista: bigint, leida: bigint): PruebaDeSecuencia => (vista === leida ? { tipo: "al-dia" } : { tipo: "atrasada" });

/* ------------------------------------------------------------ el respaldo que no es Horizon */

/**
 * Cómo está una transacción según el RPC (`getTransaction`), que no es Horizon: `entro`, `fallo`, `no-esta` o `no-se-sabe`.
 * Es la segunda mirada de una transacción cuyo hash ya se conoce (el que dejó el pago de esta compu): si Horizon no contesta,
 * el RPC puede confirmarla. Nunca lanza.
 */
export async function estadoPorRpc(hash: string, op: OpcionesDeLectura = {}): Promise<"entro" | "fallo" | "no-esta" | "no-se-sabe"> {
  if (!/^[0-9a-f]{64}$/i.test(hash)) return "no-se-sabe";
  const urls = op.rpcs ?? RPC_LISTAS.mainnet;
  for (const url of urls.slice(0, 2)) {
    const cuerpo = { jsonrpc: "2.0", id: 1, method: "getTransaction", params: { hash: hash.toLowerCase() } };
    const r = await pedir(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }, op);
    if (r.tipo !== "ok" || !esObjeto(r.json) || !esObjeto(r.json.result)) continue;
    const estado = r.json.result.status;
    if (estado === "SUCCESS") return "entro";
    if (estado === "FAILED") return "fallo";
    if (estado === "NOT_FOUND") return "no-esta";
  }
  return "no-se-sabe";
}
