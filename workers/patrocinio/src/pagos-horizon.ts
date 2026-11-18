/**
 * La mirada del portero a Horizon antes de pagar un pago clásico, y su pregunta por una transacción.
 *
 * El portero paga la comisión de un premio y de un retiro sin simular nada: el RPC simula contratos y no pagos clásicos. En su
 * lugar mira las cuentas en Horizon y comprueba lo que haría fallar a la red: que la cuenta que paga tenga la línea del USDC
 * de Circle, autorizada y con saldo libre para todo lo que sale, y que cada destino exista, tenga su línea autorizada y lugar
 * para lo que recibe. Un pago que la red rechaza al aplicarlo le cuesta la comisión al portero y no trae el costo del retiro.
 *
 * Falla cerrada: si Horizon no contesta bien (un 5xx, un 429, el tiempo agotado, una respuesta sin saldos, una redirección o
 * una cuenta mal escrita), no se afirma nada y quien llama no paga ni reserva. Lo que Horizon dice que fallaría (`fallaria`)
 * tampoco reserva nada.
 *
 * Solo habla con el Horizon fijo del código (`haciaHorizon` de `servidores.ts`): el `fetch` entra como argumento y las
 * pruebas nunca tocan la red.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { EMISOR_USDC } from "./cobros";
import type { FormaDePago, NotaDePago, SalidaDePago } from "./pagos-lista";

/** Un pedido a Horizon por una ruta limpia del servidor fijo: `haciaHorizon(fetch)`. */
export type PedirHorizon = (ruta: string, init?: RequestInit) => Promise<Response>;

/** Lo más que se espera a Horizon por cada cuenta, en ms. */
export const ESPERA_CUENTA_MS = 8_000;
/** Cuánto se guarda la lectura de la cuenta de cobros, en ms: todos los retiros la miran y no hay que pedirla cada vez. */
export const GUARDA_COBROS_MS = 60_000;
/** La nota que lleva un retiro cuando la persona no pidió ninguna. Un destino que pide nota no la acepta como suya. */
export const NOTA_FIJA_DE_RETIRO = "tkz-retiro";
/** La marca de una cuenta que pide nota en todo depósito (SEP-29): el valor `1`, en base 64, en el dato `config.memo_required`. */
const MARCA_PIDE_NOTA = "MQ==";
const DATO_PIDE_NOTA = "config.memo_required";

const HASH = /^[0-9a-f]{64}$/;
const CABECERAS = { Accept: "application/json" };
/** Un monto de Horizon: hasta 13 dígitos enteros (el límite de una línea llega a 12) y siete decimales. */
const MONTO = /^(\d{1,13})(?:\.(\d{1,7}))?$/;

/** Lo que dice la mirada previa cuando la red rechazaría el pago. */
export type DetalleFallaria =
  | "origen-sin-cuenta"
  | "origen-sin-linea"
  | "origen-sin-saldo"
  | "destino-sin-cuenta"
  | "destino-sin-linea"
  | "destino-lleno"
  | "destino-pide-nota";

/** Lo que se va a pagar, tal como lo leyó el evaluador. */
export interface PagoPorMirar {
  forma: FormaDePago;
  /** La cuenta G que paga. */
  origen: string;
  /** Lo que sale, en orden: a quién y cuánto, en diezmillonésimas de USDC. */
  salidas: readonly SalidaDePago[];
  /** La nota de la transacción. */
  nota: NotaDePago;
}

/**
 * El resultado de mirar. `red`: Horizon no contestó bien y no se sabe nada (el servicio contesta 502 y no reserva).
 * `fallaria`: Horizon contestó y la red lo rechazaría, con la razón (el servicio contesta 400 y no reserva).
 */
export type MiradaDePago = { ok: true } | { ok: false; motivo: "red" } | { ok: false; motivo: "fallaria"; detalle: DetalleFallaria };

/** La línea del USDC de Circle de una cuenta, en diezmillonésimas. */
interface LineaDeUsdc {
  autorizada: boolean;
  saldo: bigint;
  limite: bigint;
  /** Lo que ya prometió comprar: ocupa lugar. */
  compra: bigint;
  /** Lo que ya prometió vender: no está libre. */
  venta: bigint;
}

interface CuentaMirada {
  /** Su línea del USDC de Circle, o null si no la tiene. */
  linea: LineaDeUsdc | null;
  /** Si pide nota en todo depósito. */
  pideNota: boolean;
}

type LecturaDeCuenta = { tipo: "existe"; cuenta: CuentaMirada } | { tipo: "no-existe" } | { tipo: "red" };

/**
 * Lo que recuerda la mirada entre un pedido y otro: la lectura de la cuenta de cobros, que está en todos los retiros. La
 * guarda `GUARDA_COBROS_MS`, así un retiro hace dos pedidos a Horizon y no tres, y no compite con la lectura de los cobros por
 * el límite de Horizon sobre la misma cuenta. Una lectura que falló no se guarda. Vive en la memoria del objeto.
 */
export interface MemoriaDeHorizon {
  /** La cuenta que se guarda, o null si no hay (un portero sin cuenta de cobros). */
  readonly cuentaGuardada: string | null;
  readonly reloj: () => number;
  guardada: { ms: number; cuenta: CuentaMirada } | null;
  /** La lectura que está en camino: dos retiros a la vez esperan la misma. */
  enCurso: Promise<LecturaDeCuenta> | null;
}

export function crearMemoria(cuentaGuardada: string | null, reloj: () => number = () => Date.now()): MemoriaDeHorizon {
  return { cuentaGuardada, reloj, guardada: null, enCurso: null };
}

/** Un monto de Horizon (`"12.5000000"`) en diezmillonésimas, o null si no tiene esa forma. */
function monto(x: unknown): bigint | null {
  if (typeof x !== "string") {
    return null;
  }
  const m = MONTO.exec(x);
  if (m?.[1] === undefined) {
    return null;
  }
  return BigInt(m[1]) * 10_000_000n + BigInt((m[2] ?? "").padEnd(7, "0"));
}

/** Si esta línea de saldos es el USDC de Circle. */
function esUsdc(b: Record<string, unknown>): boolean {
  return b.asset_type === "credit_alphanum4" && b.asset_code === "USDC" && b.asset_issuer === EMISOR_USDC;
}

/** La línea del USDC leída de un saldo de Horizon, o null si le falta algún número o no se entiende. */
function leerLinea(b: Record<string, unknown>): LineaDeUsdc | null {
  const saldo = monto(b.balance);
  const limite = monto(b.limit);
  const compra = monto(b.buying_liabilities);
  const venta = monto(b.selling_liabilities);
  if (saldo === null || limite === null || compra === null || venta === null) {
    return null;
  }
  // Sin el dato, se supone autorizada: la mayoría de los emisores no pide autorización. Con `false`, no.
  return { autorizada: b.is_authorized !== false, saldo, limite, compra, venta };
}

/** La cuenta leída del cuerpo de Horizon, o null si no tiene saldos o la línea del USDC no se entiende (no se afirma nada). */
function interpretar(cuerpo: unknown): CuentaMirada | null {
  if (!cuerpo || typeof cuerpo !== "object") {
    return null;
  }
  const c = cuerpo as Record<string, unknown>;
  if (!Array.isArray(c.balances)) {
    return null;
  }
  let linea: LineaDeUsdc | null = null;
  for (const b of c.balances) {
    if (!b || typeof b !== "object" || !esUsdc(b as Record<string, unknown>)) {
      continue;
    }
    linea = leerLinea(b as Record<string, unknown>);
    if (linea === null) {
      return null;
    }
  }
  const datos = c.data && typeof c.data === "object" ? (c.data as Record<string, unknown>) : {};
  return { linea, pideNota: datos[DATO_PIDE_NOTA] === MARCA_PIDE_NOTA };
}

/** Lee una cuenta en Horizon. Nunca lanza: lo que no se entiende es `red`. */
async function leerCuenta(pedir: PedirHorizon, cuenta: string): Promise<LecturaDeCuenta> {
  if (!StrKey.isValidEd25519PublicKey(cuenta)) {
    return { tipo: "red" };
  }
  try {
    const res = await pedir(`/accounts/${cuenta}`, { signal: AbortSignal.timeout(ESPERA_CUENTA_MS), headers: CABECERAS });
    if (res.status === 404) {
      return { tipo: "no-existe" };
    }
    if (!res.ok) {
      return { tipo: "red" };
    }
    const leida = interpretar(await res.json());
    return leida === null ? { tipo: "red" } : { tipo: "existe", cuenta: leida };
  } catch {
    return { tipo: "red" };
  }
}

/** Lo mismo que `leerCuenta`, pero la cuenta de cobros se guarda un minuto y dos lecturas a la vez comparten el pedido. */
async function leerConMemoria(pedir: PedirHorizon, cuenta: string, memoria: MemoriaDeHorizon): Promise<LecturaDeCuenta> {
  if (memoria.cuentaGuardada !== cuenta) {
    return leerCuenta(pedir, cuenta);
  }
  const guardada = memoria.guardada;
  if (guardada) {
    const edad = memoria.reloj() - guardada.ms;
    if (edad >= 0 && edad < GUARDA_COBROS_MS) {
      return { tipo: "existe", cuenta: guardada.cuenta };
    }
  }
  if (memoria.enCurso) {
    return memoria.enCurso;
  }
  const lectura = (async (): Promise<LecturaDeCuenta> => {
    try {
      const l = await leerCuenta(pedir, cuenta);
      if (l.tipo === "existe") {
        memoria.guardada = { ms: memoria.reloj(), cuenta: l.cuenta };
      }
      return l;
    } finally {
      memoria.enCurso = null;
    }
  })();
  memoria.enCurso = lectura;
  return lectura;
}

/**
 * Si la nota que lleva el pago sirve para un destino que pide nota. En el premio nunca: su nota es fija y un exchange no
 * podría acreditarla. En el retiro sirve la que pegó la persona (un número, o un texto que no es la nota fija).
 */
function notaDeLaPersona(forma: FormaDePago, nota: NotaDePago): boolean {
  if (forma === "premio") {
    return false;
  }
  if (nota.tipo === "id") {
    return true;
  }
  return nota.tipo === "texto" && nota.valor.length > 0 && nota.valor !== NOTA_FIJA_DE_RETIRO;
}

/**
 * Mira en Horizon lo que haría fallar a la red. Pide la cuenta que paga y cada destino distinto, en paralelo y con 8 s cada
 * una, y comprueba:
 *
 * - la cuenta que paga existe, tiene la línea del USDC de Circle autorizada y su saldo libre (`saldo − lo que ya vende`)
 *   alcanza para todo lo que sale
 * - cada destino existe, tiene la línea autorizada y lugar (`límite − saldo − lo que ya compra`) para lo que recibe
 * - un destino que pide nota no recibe un premio nunca, ni un retiro sin la nota de la persona
 *
 * Si alguna lectura falla, la respuesta es `red` aunque otra ya diga que fallaría: no se afirma nada a medias. Un pago sin
 * salidas o con un monto que no es positivo no llega acá (lo frena el evaluador): si llegara, tampoco se afirma nada y no se
 * le pregunta nada a Horizon, porque sin salidas no habría ningún destino que mirar y daría que pasa.
 */
export async function mirarParaPagar(pedir: PedirHorizon, pago: PagoPorMirar, memoria: MemoriaDeHorizon): Promise<MiradaDePago> {
  if (pago.salidas.length === 0 || pago.salidas.some((s) => s.monto <= 0n)) {
    return { ok: false, motivo: "red" };
  }
  const cuentas = [...new Set([pago.origen, ...pago.salidas.map((s) => s.destino)])];
  const lecturas = await Promise.all(cuentas.map((c) => leerConMemoria(pedir, c, memoria)));
  if (lecturas.some((l) => l.tipo === "red")) {
    return { ok: false, motivo: "red" };
  }
  const de = new Map(cuentas.map((c, i) => [c, lecturas[i] as LecturaDeCuenta]));
  const fallaria = (detalle: DetalleFallaria): MiradaDePago => ({ ok: false, motivo: "fallaria", detalle });

  const origen = de.get(pago.origen);
  if (origen?.tipo !== "existe") {
    return fallaria("origen-sin-cuenta");
  }
  const suya = origen.cuenta.linea;
  if (suya === null || !suya.autorizada) {
    return fallaria("origen-sin-linea");
  }
  const sale = pago.salidas.reduce((suma, s) => suma + s.monto, 0n);
  if (suya.saldo - suya.venta < sale) {
    return fallaria("origen-sin-saldo");
  }

  // Lo que recibe cada destino: un destino que aparece dos veces recibe las dos.
  const recibe = new Map<string, bigint>();
  for (const s of pago.salidas) {
    recibe.set(s.destino, (recibe.get(s.destino) ?? 0n) + s.monto);
  }
  for (const [destino, cuanto] of recibe) {
    const l = de.get(destino);
    if (l?.tipo !== "existe") {
      return fallaria("destino-sin-cuenta");
    }
    const linea = l.cuenta.linea;
    if (linea === null || !linea.autorizada) {
      return fallaria("destino-sin-linea");
    }
    if (linea.limite - linea.saldo - linea.compra < cuanto) {
      return fallaria("destino-lleno");
    }
    if (l.cuenta.pideNota && !notaDeLaPersona(pago.forma, pago.nota)) {
      return fallaria("destino-pide-nota");
    }
  }
  return { ok: true };
}

/**
 * Lo que dice Horizon de una transacción: `esta: false` si no la conoce (404), y si la conoce, si salió bien y cuánto cobró la
 * red de comisión (null si no se puede leer). `null` es que no se sabe: cualquier otra respuesta, un cuerpo que no se entiende
 * o un corte. Acepta el hash de la transacción de adentro de un fee-bump, el que guarda el portero.
 */
export type EnHorizon = { esta: false } | { esta: true; ok: boolean; cobrado: number | null } | null;

/** Le pregunta a Horizon por una transacción. Nunca lanza. Lo usa la alarma antes de dar un pago por no entrado. */
export async function estaEnHorizon(pedir: PedirHorizon, hashDeLaTransaccion: string): Promise<EnHorizon> {
  if (!HASH.test(hashDeLaTransaccion)) {
    return null;
  }
  try {
    const res = await pedir(`/transactions/${hashDeLaTransaccion}`, { signal: AbortSignal.timeout(ESPERA_CUENTA_MS), headers: CABECERAS });
    if (res.status === 404) {
      return { esta: false };
    }
    if (!res.ok) {
      return null;
    }
    const cuerpo: unknown = await res.json();
    if (!cuerpo || typeof cuerpo !== "object") {
      return null;
    }
    const t = cuerpo as Record<string, unknown>;
    if (typeof t.successful !== "boolean") {
      return null;
    }
    const cobrado = typeof t.fee_charged === "string" && /^\d{1,15}$/.test(t.fee_charged) ? Number(t.fee_charged) : null;
    return { esta: true, ok: t.successful, cobrado };
  } catch {
    return null;
  }
}
