import type { Pago } from "../../workers/cuenta/src/pagos";
import { HORIZON_URLS, type NetworkName } from "./config";
import { type ActivoDePago, USDC_MAINNET, USDC_TESTNET } from "./pagos";

/**
 * ¿Puede esta cuenta recibir dólares digitales (USDC)?
 *
 * Antes de mostrar la dirección para traer dólares digitales desde otra app, el sitio mira la cuenta en la red: si
 * existe, si tiene abierta la línea del USDC de Circle de la red del sitio, si está autorizada y si le queda lugar. La
 * dirección se muestra solo cuando la respuesta es que puede (`muestraDireccion`). En cualquier otro caso la ventana dice
 * qué falta y no muestra la dirección: así nadie manda dinero a una cuenta que no lo puede recibir.
 *
 * `mirarCuenta` lee (un `GET /accounts/{cuenta}` a Horizon, con tope) y nunca lanza. `estadoParaRecibir` decide, sin red
 * ni DOM, con lo leído y con lo que el sitio sabe de la cuenta (con qué entró, si está protegida, si ya hay una
 * activación esperando). El emisor es siempre el de Circle de la red (`USDC_MAINNET` o `USDC_TESTNET`): no se cambia con
 * ninguna variable.
 */

type Fetch = typeof fetch;

export interface OpcionesDeLectura {
  fetch?: Fetch;
  /** Otro Horizon (pruebas y la red local). Sin decirlo, el de la red. */
  horizon?: string;
  tiempoMs?: number;
}

/** Una línea de la cuenta: un activo que no es XLM. */
export interface LineaMirada {
  code: string;
  issuer: string;
  saldo: string;
  limite: string;
  autorizada: boolean;
  /** Quién puso la reserva de la línea, si no fue la cuenta. */
  patrocinador: string | null;
}

/** Lo que Horizon dice de una cuenta. Lo nuevo (el XLM y las reservas) es `null` si no vino: no es una falla. */
export interface CuentaMirada {
  secuencia: string;
  saldos: LineaMirada[];
  /** El saldo de XLM, con siete decimales. */
  xlm: string | null;
  /** El XLM comprometido en ofertas de venta (`selling_liabilities`). */
  xlmComprometido: string | null;
  subentradas: number | null;
  /** Cuántas reservas de otras cuentas paga esta (`num_sponsoring`). */
  patrocinando: number | null;
  /** Cuántas reservas de esta cuenta paga otra (`num_sponsored`). */
  patrocinadas: number | null;
}

export type LecturaDeCuenta = CuentaMirada | "no-existe" | "sin-red";

const TIEMPO_MS = 10_000;

async function conEspera<T>(ms: number, hacer: (senal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const vence = new Promise<never>((_, rechazar) => {
    ctl.signal.addEventListener("abort", () => rechazar(new Error("cuenta-espera")), { once: true });
  });
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await Promise.race([hacer(ctl.signal), vence]);
  } finally {
    clearTimeout(t);
  }
}

const montoDeHorizon = (x: unknown): string | null => (typeof x === "string" && /^\d{1,13}(?:\.\d{1,7})?$/.test(x) ? x : null);
const cantidad = (x: unknown): number | null => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : null);

/**
 * Lee la cuenta en Horizon. `no-existe` con 404; `sin-red` con cualquier otra falla, con el tiempo agotado o con un
 * cuerpo sin `sequence` o sin `balances`. Nunca lanza.
 */
export async function mirarCuenta(red: NetworkName, cuenta: string, op: OpcionesDeLectura = {}): Promise<LecturaDeCuenta> {
  const f = op.fetch ?? fetch;
  const base = op.horizon ?? HORIZON_URLS[red];
  try {
    return await conEspera(op.tiempoMs ?? TIEMPO_MS, async (signal) => {
      const r = await f(`${base}/accounts/${encodeURIComponent(cuenta)}`, { signal });
      if (r.status === 404) return "no-existe" as const;
      if (!r.ok) return "sin-red" as const;
      const j = (await r.json()) as Record<string, unknown>;
      if (typeof j.sequence !== "string" || !/^\d{1,20}$/.test(j.sequence) || !Array.isArray(j.balances)) return "sin-red" as const;
      const saldos: LineaMirada[] = [];
      let xlm: string | null = null;
      let xlmComprometido: string | null = null;
      for (const b of j.balances as Array<Record<string, unknown>>) {
        if (b.asset_type === "native") {
          xlm = montoDeHorizon(b.balance);
          xlmComprometido = montoDeHorizon(b.selling_liabilities);
          continue;
        }
        if (typeof b.asset_code !== "string" || typeof b.asset_issuer !== "string") continue;
        saldos.push({
          code: b.asset_code,
          issuer: b.asset_issuer,
          saldo: typeof b.balance === "string" ? b.balance : "0",
          limite: typeof b.limit === "string" ? b.limit : "0",
          // Sin el dato, se supone que sí: la mayoría de los emisores no pide autorización.
          autorizada: b.is_authorized !== false,
          patrocinador: typeof b.sponsor === "string" ? b.sponsor : null,
        });
      }
      return {
        secuencia: j.sequence,
        saldos,
        xlm,
        xlmComprometido,
        subentradas: cantidad(j.subentry_count),
        patrocinando: cantidad(j.num_sponsoring),
        patrocinadas: cantidad(j.num_sponsored),
      };
    });
  } catch {
    return "sin-red";
  }
}

/** El USDC de Circle de la red: el único que cuenta para recibir. */
export const usdcDeLaRed = (red: NetworkName): ActivoDePago => (red === "mainnet" ? USDC_MAINNET : USDC_TESTNET);

/* ------------------------------------------------------------------ la decisión */

/**
 * Con qué entró la persona: una cuenta de Google o de correo (Pollar), o su billetera, y en qué red está esa billetera
 * (`otra` si es una red que el sitio no conoce, `null` si no se supo).
 */
export type BilleteraParaRecibir = { tipo: "google" } | { tipo: "propia"; red: NetworkName | "otra" | null };

export interface EntradaParaRecibir {
  /** La red del sitio. */
  red: NetworkName;
  /** La práctica con dólares digitales de prueba (`practicaDeRampa`). */
  practica: boolean;
  billetera: BilleteraParaRecibir;
  lectura: LecturaDeCuenta;
  /** Solo Google en la red principal: si la cuenta tiene una forma de recuperarla. `null`: no se pudo saber. */
  proteccion?: "lista" | "falta" | null | undefined;
  /** Solo Google: si ya espera un pedido de abrir la línea del USDC. `null`: no se pudo saber. */
  pendiente?: boolean | null | undefined;
  /** Solo Google: si Pollar pone la reserva de la línea del USDC. `null`: no se pudo saber. */
  catalogo?: "patrocinada" | "no-patrocinada" | null | undefined;
}

export type EstadoParaRecibir =
  | { estado: "puede"; saldo: string }
  | { estado: "solo-oficial" }
  | { estado: "falta-activar"; paga: "app" | "cuenta" }
  | { estado: "falta-proteger" }
  | { estado: "creandose" }
  | { estado: "activandose" }
  | { estado: "no-se-sabe" }
  | { estado: "otra-red" }
  | { estado: "falta-xlm"; necesita: string; tiene: string }
  | { estado: "billetera-nueva" }
  | { estado: "no-recibe-mas" }
  | { estado: "no-puede-app" };

const STROOPS = 10_000_000n;
/** La reserva base de la red: medio XLM por cada entrada de la cuenta. */
const MEDIA_RESERVA = 5_000_000n;
/** Lo que hace falta libre para abrir la línea: la reserva de la línea y la comisión (0,5 + 0,0001 XLM). */
const PARA_ACTIVAR = MEDIA_RESERVA + 1_000n;
/** Lo mínimo que tiene que caber en la línea para decir que puede recibir: 1 dólar digital. */
const LUGAR_MINIMO = STROOPS;

const stroopsSeguro = (m: string): bigint | null => {
  const x = /^(\d{1,13})(?:\.(\d{1,7}))?$/.exec(m);
  return x ? BigInt(x[1] as string) * STROOPS + BigInt((x[2] ?? "").padEnd(7, "0")) : null;
};

const sieteDecimales = (s: bigint): string => `${s / STROOPS}.${(s % STROOPS).toString().padStart(7, "0")}`;

/**
 * El XLM libre de la cuenta, en stroops: el saldo menos las reservas (dos de base, una por subentrada y por lo que
 * patrocina, menos lo que le patrocinan) y menos lo comprometido. `null` si falta cualquiera de esos datos.
 */
export function disponibleXlm(m: CuentaMirada): bigint | null {
  if (m.xlm === null || m.xlmComprometido === null || m.subentradas === null || m.patrocinando === null || m.patrocinadas === null) return null;
  const saldo = stroopsSeguro(m.xlm);
  const comprometido = stroopsSeguro(m.xlmComprometido);
  if (saldo === null || comprometido === null) return null;
  const reservas = BigInt(2 + m.subentradas + m.patrocinando - m.patrocinadas) * MEDIA_RESERVA;
  return saldo - reservas - comprometido;
}

/**
 * Qué puede hacer la cuenta para recibir dólares digitales. Se mira en orden y vale el primer caso que se cumple. Ante
 * la duda (un dato que no se pudo leer), `no-se-sabe`: nunca `puede`.
 */
export function estadoParaRecibir(e: EntradaParaRecibir): EstadoParaRecibir {
  const enPrincipal = e.red === "mainnet";
  // Fuera de la red principal, solo en la práctica: así nadie confunde dólares de prueba con dólares de verdad.
  if (!enPrincipal && !e.practica) return { estado: "solo-oficial" };
  const google = e.billetera.tipo === "google";
  if (e.billetera.tipo === "propia" && e.billetera.red !== null && e.billetera.red !== e.red) return { estado: "otra-red" };
  const l = e.lectura;
  if (l === "sin-red") return { estado: "no-se-sabe" };
  if (l === "no-existe") return { estado: google ? "creandose" : "billetera-nueva" };
  // Dinero en una cuenta sin forma de recuperarla se pierde si se borra el navegador: proteger va antes que recibir.
  if (google && enPrincipal) {
    if (e.proteccion === null || e.proteccion === undefined) return { estado: "no-se-sabe" };
    if (e.proteccion !== "lista") return { estado: "falta-proteger" };
  }

  const usdc = usdcDeLaRed(e.red);
  const linea = l.saldos.find((s) => s.code === usdc.code && s.issuer === usdc.issuer);
  if (linea) {
    const limite = stroopsSeguro(linea.limite);
    const saldo = stroopsSeguro(linea.saldo);
    if (limite === null || saldo === null) return { estado: "no-se-sabe" };
    if (linea.autorizada && limite - saldo >= LUGAR_MINIMO) return { estado: "puede", saldo: linea.saldo };
    return { estado: "no-recibe-mas" };
  }

  if (google) {
    if (e.pendiente === true) return { estado: "activandose" };
    if (e.pendiente === null || e.pendiente === undefined) return { estado: "no-se-sabe" };
    if (e.catalogo === null || e.catalogo === undefined) return { estado: "no-se-sabe" };
    if (e.catalogo === "patrocinada") return { estado: "falta-activar", paga: "app" };
    // En la red principal no se le pide a la cuenta de Google que aparte su XLM: la reserva la pone la app o nadie.
    const libre = enPrincipal ? null : disponibleXlm(l);
    if (libre !== null && libre >= PARA_ACTIVAR) return { estado: "falta-activar", paga: "cuenta" };
    return { estado: "no-puede-app" };
  }

  const libre = disponibleXlm(l);
  if (libre === null) return { estado: "no-se-sabe" };
  if (libre >= PARA_ACTIVAR) return { estado: "falta-activar", paga: "cuenta" };
  return { estado: "falta-xlm", necesita: sieteDecimales(PARA_ACTIVAR), tiene: sieteDecimales(libre > 0n ? libre : 0n) };
}

/* ------------------------------------------------------------- Ya lo mandé */

/**
 * Desde dónde se cuentan los pagos nuevos: el más nuevo que había cuando la cuenta pasó a poder recibir en este aparato.
 * Se guarda en el navegador para que una pestaña recargada al volver de la otra app siga viendo el pago como nuevo.
 */
export interface BaseDeLlegadas {
  ms: number;
  ultimoTx: string | null;
}

/** Un pago que trae la persona: de otra cuenta y sin la nota de Tinkazo (los premios y los cupones llevan `tk:`). */
export const esLlegada = (p: Pago, cuenta: string): boolean => p.de !== cuenta && !(p.memo ?? "").startsWith("tk:");

export type Llegada =
  /** Pagos nuevos desde la base: cuánto suman y el más nuevo, que pasa a ser la base. */
  | { tipo: "llegaron"; monto: bigint; ultimoTx: string }
  /** Ninguno nuevo, o no se puede saber cuál es nuevo: el último que llegó. */
  | { tipo: "ultimo"; monto: bigint; ms: number }
  | { tipo: "ninguno" };

/**
 * Qué llegó, con los pagos de USDC que entraron (del más nuevo al más viejo, `pagosEntrantes`). Sin base no se puede
 * decir qué es nuevo: se dice el último, con su fecha, para que la persona lo reconozca. Nunca dice que no llegó si hay
 * un pago a la vista.
 */
export function queLlego(pagos: readonly Pago[], cuenta: string, base: BaseDeLlegadas | null): Llegada {
  const entradas = pagos.filter((p) => esLlegada(p, cuenta));
  let nuevos: Pago[] = [];
  if (base) {
    if (base.ultimoTx === null) nuevos = entradas;
    else {
      const i = entradas.findIndex((p) => p.tx === base.ultimoTx);
      nuevos = i >= 0 ? entradas.slice(0, i) : entradas.filter((p) => p.ms > base.ms);
    }
  }
  const primero = nuevos[0];
  if (primero) return { tipo: "llegaron", monto: nuevos.reduce((s, p) => s + p.monto, 0n), ultimoTx: primero.tx };
  const ultimo = entradas[0];
  if (ultimo) return { tipo: "ultimo", monto: ultimo.monto, ms: ultimo.ms };
  return { tipo: "ninguno" };
}

/** La dirección (y su QR) se muestra solo cuando la cuenta puede recibir. */
export const muestraDireccion = (e: EstadoParaRecibir): boolean => e.estado === "puede";

/**
 * Con Google en la red principal, lo que falta para recibir es dejar la cuenta lista (crearla o protegerla): eso lo hace
 * el paso «Dejá tu cuenta lista», no un botón de esta ventana.
 */
export const abrePasoDeLaCuenta = (e: EstadoParaRecibir, red: NetworkName): boolean =>
  red === "mainnet" && (e.estado === "falta-proteger" || e.estado === "creandose");
