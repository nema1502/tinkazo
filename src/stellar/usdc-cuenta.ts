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
 *
 * La puerta del premio (`puertaDelPremio`, `mirarPuertaDelPremio`) es otra lectura de la misma cuenta, para otra
 * pregunta: ¿puede guardar dinero? Se hace antes de cada firma del sello y del sorteo con una cuenta de Google o de correo
 * en el modo `premios` (`wallet-pollar.ts`). No usa `mirarCuenta`: va sin caché, con su propio tope y sobre el JSON crudo.
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

/** Quien puede firmar por una cuenta: su clave y el peso de su firma. */
export interface Firmante {
  clave: string;
  peso: number;
}

/** Lo que Horizon dice de una cuenta. Lo nuevo (el XLM y las reservas) es `null` si no vino: no es una falla. */
export interface CuentaMirada {
  secuencia: string;
  saldos: LineaMirada[];
  /** Quién firma por la cuenta, o `null` si Horizon no lo trajo (o trajo algo que no se lee). Sin decirlo, no se sabe. */
  firmantes?: Firmante[] | null;
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

/** Los firmantes que trae Horizon (`signers`), o `null` si no vinieron o alguno no se lee: nunca una lista a medias. */
function firmantesDe(x: unknown): Firmante[] | null {
  if (!Array.isArray(x)) return null;
  const lista: Firmante[] = [];
  for (const s of x as unknown[]) {
    if (typeof s !== "object" || s === null) return null;
    const { key, weight } = s as Record<string, unknown>;
    if (typeof key !== "string" || key === "" || typeof weight !== "number" || !Number.isSafeInteger(weight) || weight < 0) return null;
    lista.push({ clave: key, peso: weight });
  }
  return lista;
}

/**
 * ¿La cuenta tiene una firma que no es la suya? Se supone que las cuentas del proveedor nacen con su sola llave (la
 * activación abre el patrocinio, crea la cuenta y lo cierra, sin sumar firmantes), así que cualquier otra clave con peso
 * sería un cambio que no hizo Tinkazo. La suposición se midió el 18 de noviembre de 2026 en una cuenta real de la red
 * principal: un solo firmante (su propia clave, con peso 1), umbrales 0, 0 y 0, patrocinada por otra cuenta y sin XLM
 * (la forma está en `usdc-cuenta.test.ts`). Con una sola cuenta medida, el aviso sigue siendo una línea suelta que no
 * esconde nada (`saldo.ts`). Sin el dato no se sabe, y no se avisa. No protege nada.
 */
export function tieneFirmanteAjeno(c: CuentaMirada, cuenta: string): boolean {
  return (c.firmantes ?? []).some((f) => f.clave !== cuenta && f.peso > 0);
}

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
        firmantes: firmantesDe(j.signers),
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

/* ------------------------------------------------------------ la puerta del premio */

/**
 * Qué dice la red de si la cuenta puede guardar un premio, justo antes de firmar el sello o el sorteo con una cuenta de
 * Google o de correo en la red principal en el modo `premios`:
 * - `libre`: no tiene la línea del dólar digital de Circle ni otra línea con saldo. Se firma como siempre, tenga o no XLM.
 * - `puede-guardar`: tiene la línea del dólar digital de Circle (con cualquier saldo, también cero) o alguna otra línea con
 *   saldo mayor que cero. El XLM no cuenta: ver `puertaDelPremio`.
 * - `no-se-sabe`: la red no contestó o contestó algo que no se lee. No se firma a ciegas.
 * - `no-existe`: Horizon todavía no conoce la cuenta (la de Google se crea en el paso «Dejá tu cuenta lista», que va
 *   después de la consulta adelantada de `freeze.ts`). No puede guardar nada y esa consulta la deja pasar. La puerta de
 *   la firma la trata como `no-se-sabe`: una cuenta que firma ya existe, y `mirarPuertaDelPremio` espera a que Horizon la
 *   vea antes de darla por no vista.
 */
export type PuertaDelPremio = "libre" | "puede-guardar" | "no-se-sabe" | "no-existe";

/**
 * La decisión de la puerta, sobre el JSON crudo de Horizon y no sobre la `CuentaMirada`: `mirarCuenta` pone `"0"` cuando
 * a una línea le falta el saldo, y eso abriría la puerta. Una duda de lectura nunca da `libre`.
 *
 * Frena desde que la cuenta puede guardar un premio y no desde que lo tiene: el voto del kit firma el hash de cualquier
 * transacción de la cuenta, y con saldo cero ya puede servir para robar después (un pago guardado, otra firma, un permiso
 * de gasto). Así una cuenta lista para recibir un premio no vuelve a votar por hash (docs/architecture.md).
 *
 * El XLM no frena, con cualquier saldo: en Stellar cualquiera puede mandarle XLM a cualquier cuenta sin su permiso, y la
 * dirección de quien organiza es pública desde que sella. Frenar por eso dejaría a quien organiza sin poder sellar ni
 * sortear ese día, con solo recibir unas fracciones de XLM. Para recibir cualquier otro activo la cuenta tiene que haber
 * abierto su línea, y lo que la puerta cuida es el premio, que llega por la línea de Circle. El XLM de una cuenta de
 * Google sigue bajo el riesgo aceptado (docs/architecture.md). Se sigue leyendo: sin su entrada nativa, o con un saldo que
 * no se entiende, la respuesta es `no-se-sabe`, nunca `libre`.
 */
export function puertaDelPremio(cuerpo: unknown, red: NetworkName): PuertaDelPremio {
  const balances = typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as { balances?: unknown }).balances : undefined;
  if (!Array.isArray(balances)) return "no-se-sabe";
  const usdc = usdcDeLaRed(red);
  let nativa = false;
  let circle = false;
  let otraConSaldo = false;
  let otraSinLeer = false;
  for (const b of balances as unknown[]) {
    if (typeof b !== "object" || b === null) return "no-se-sabe";
    const l = b as Record<string, unknown>;
    const saldo = typeof l.balance === "string" ? stroopsSeguro(l.balance) : null;
    if (l.asset_type === "native") {
      // El XLM tiene que leerse (una respuesta que no se entiende nunca da libre), pero su saldo no decide nada.
      if (saldo === null) return "no-se-sabe";
      nativa = true;
      continue;
    }
    if (l.asset_code === usdc.code && l.asset_issuer === usdc.issuer) {
      circle = true;
      continue;
    }
    if (saldo === null) otraSinLeer = true;
    else if (saldo > 0n) otraConSaldo = true;
  }
  if (!nativa) return "no-se-sabe";
  if (circle || otraConSaldo) return "puede-guardar";
  return otraSinLeer ? "no-se-sabe" : "libre";
}

/** Cuánto se espera a Horizon en cada lectura de la puerta. No subirlo sin medir: se suma al margen de la ronda del sello. */
export const TOPE_DE_LA_PUERTA_MS = 5_000;
/** Lo más que dura la puerta entera, con sus reintentos. Tampoco se sube sin medir. */
export const PRESUPUESTO_DE_LA_PUERTA_MS = 7_000;
/** Cuánto se espera entre una lectura y la siguiente. */
export const PAUSA_DE_LA_PUERTA_MS = 700;
/** Cuántas veces más se vuelve a leer ante una duda: tres lecturas como mucho. */
export const REINTENTOS_DE_LA_PUERTA = 2;
/** Una lectura nueva solo vale si queda al menos este tiempo para hacerla. */
const LECTURA_MINIMA_MS = 1_000;

export interface OpcionesDeLaPuerta extends OpcionesDeLectura {
  /** Cuánto se espera entre una lectura y la siguiente. Sin decirlo, `PAUSA_DE_LA_PUERTA_MS`. */
  pausaMs?: number;
  /**
   * Un 404 se toma como respuesta y no se vuelve a preguntar. Lo usa la consulta adelantada de `freeze.ts`, que deja pasar a
   * una cuenta que todavía no existe. Sin esto, la puerta de la firma espera a que Horizon la vea.
   */
  sinReintentarNoExiste?: boolean;
}

/** Lo que sale de una lectura de la puerta: qué dice, y si la cuenta ya tiene la línea del dólar digital de Circle. */
interface LecturaDeLaPuerta {
  puerta: PuertaDelPremio;
  conLinea: boolean;
}

/** ¿La cuenta tiene la línea del dólar digital de Circle de la red, con cualquier saldo? Sobre el mismo JSON crudo. */
function conLaLineaDeCircle(cuerpo: unknown, red: NetworkName): boolean {
  const balances = typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as { balances?: unknown }).balances : undefined;
  if (!Array.isArray(balances)) return false;
  const usdc = usdcDeLaRed(red);
  return (balances as unknown[]).some((b) => typeof b === "object" && b !== null && (b as Record<string, unknown>).asset_code === usdc.code && (b as Record<string, unknown>).asset_issuer === usdc.issuer);
}

/** Una sola lectura de la cuenta en Horizon para la puerta, sin caché. Nunca lanza. */
async function leerLaPuerta(red: NetworkName, cuenta: string, op: OpcionesDeLectura, tiempoMs: number): Promise<LecturaDeLaPuerta> {
  const f = op.fetch ?? fetch;
  const base = op.horizon ?? HORIZON_URLS[red];
  try {
    return await conEspera(tiempoMs, async (signal): Promise<LecturaDeLaPuerta> => {
      const r = await f(`${base}/accounts/${encodeURIComponent(cuenta)}`, { signal, cache: "no-store" });
      if (r.status === 404) return { puerta: "no-existe", conLinea: false };
      if (!r.ok) return { puerta: "no-se-sabe", conLinea: false };
      const cuerpo: unknown = await r.json();
      return { puerta: puertaDelPremio(cuerpo, red), conLinea: conLaLineaDeCircle(cuerpo, red) };
    });
  } catch {
    return { puerta: "no-se-sabe", conLinea: false };
  }
}

/**
 * Lee la cuenta en Horizon para la puerta: sin caché (una respuesta vieja no sirve) y con su propio tope. Nunca lanza.
 * Un 404 da `no-existe`. Cualquier otra respuesta que no sea 2xx, un corte, el tope o un cuerpo que no se lee dan
 * `no-se-sabe`.
 *
 * Ante una duda (`no-existe` o `no-se-sabe`) vuelve a leer, hasta dos veces más y dentro de `PRESUPUESTO_DE_LA_PUERTA_MS`:
 * todavía no se firmó nada, y un Horizon que tropieza o que va unos segundos atrás de la red no tiene por qué dejar al
 * sorteo sin guardar ni frenar el primer sello de una cuenta nueva. Una respuesta que dice algo (`libre` o
 * `puede-guardar`) no se repite nunca: si dijo `puede-guardar`, no se pregunta de nuevo a ver si cambia. Si al final sigue
 * la duda, sale la duda y la puerta cierra.
 */
export async function mirarPuertaDelPremio(red: NetworkName, cuenta: string, op: OpcionesDeLaPuerta = {}): Promise<PuertaDelPremio> {
  return (await mirarLaPuerta(red, cuenta, op)).puerta;
}

async function mirarLaPuerta(red: NetworkName, cuenta: string, op: OpcionesDeLaPuerta): Promise<LecturaDeLaPuerta> {
  const pausa = op.pausaMs ?? PAUSA_DE_LA_PUERTA_MS;
  const inicio = Date.now();
  const quedan = (): number => PRESUPUESTO_DE_LA_PUERTA_MS - (Date.now() - inicio);
  for (let i = 0; ; i++) {
    const lectura = await leerLaPuerta(red, cuenta, op, Math.min(op.tiempoMs ?? TOPE_DE_LA_PUERTA_MS, quedan()));
    const { puerta } = lectura;
    if (puerta === "libre" || puerta === "puede-guardar") return lectura;
    if (puerta === "no-existe" && op.sinReintentarNoExiste) return lectura;
    if (i >= REINTENTOS_DE_LA_PUERTA || quedan() - pausa < LECTURA_MINIMA_MS) return lectura;
    if (pausa > 0) await new Promise<void>((seguir) => setTimeout(seguir, pausa));
  }
}

/**
 * Qué hay que saber antes de pedir la línea del dólar digital con una cuenta de Google o de correo en el modo `premios`
 * (`wallet-pollar.ts`, `activarUsdc`): pedirla es un voto por hash de una transacción nueva, y a una cuenta que ya puede
 * guardar dinero no se le piden votos así.
 * - `ya-esta`: la cuenta ya tiene la línea (otra pestaña la activó, o llegó un premio). No hay nada que pedir.
 * - `libre`: no tiene la línea ni otra línea con saldo (el XLM no cuenta, `puertaDelPremio`), o Horizon todavía no la
 *   conoce. Se puede pedir.
 * - `no-se-sabe`: la red no deja saberlo, o tiene otra línea con saldo sin la de Circle. No se pide nada.
 * Un 404 no se repite: la cuenta que se está creando sigue su camino.
 */
export type AntesDeActivar = "ya-esta" | "libre" | "no-se-sabe";

export async function mirarAntesDeActivar(red: NetworkName, cuenta: string, op: OpcionesDeLaPuerta = {}): Promise<AntesDeActivar> {
  const { puerta, conLinea } = await mirarLaPuerta(red, cuenta, { ...op, sinReintentarNoExiste: true });
  if (puerta === "libre" || puerta === "no-existe") return "libre";
  return puerta === "puede-guardar" && conLinea ? "ya-esta" : "no-se-sabe";
}

/**
 * La puerta frenó la firma: la cuenta puede guardar dinero, o no se pudo saber. Se reconoce por el nombre y la forma
 * (`esDelPremio` en `errores.ts`), sin importar este archivo. No lleva causa: no es un corte de la red ni un sello incierto.
 */
export class PremioGuardado extends Error {
  readonly que: "puede-guardar" | "no-se-sabe";
  constructor(que: "puede-guardar" | "no-se-sabe") {
    super(que === "puede-guardar" ? "premio-guardado" : "premio-sin-saber");
    this.name = "PremioGuardado";
    this.que = que;
  }
}
