import { getLang } from "../idioma";
import { passphraseDe } from "../stellar/oficiales";
import type { NetworkName } from "../stellar/config";
import { network, txUrl } from "../stellar/config";
import { pagarConGoogle } from "../stellar/cuenta-config";
import {
  type ActivoDePago,
  type LecturaDePago,
  esDireccionG,
  montoDelPremio,
  montoDePago,
  notaDelPremio,
  stroopsDe,
} from "../stellar/pagos";
import { type DatosDelPago, type Envio, type MotivoDeRechazo, type MotivoSinPago, mandarPago, prepararPago } from "../stellar/pagos-envio";
import { type BusquedaDePago, buscarPago } from "../stellar/pagos-red";
import { mirarCuenta, usdcDeLaRed } from "../stellar/usdc-cuenta";
import { montoConCentavos } from "../campana/formato";
import { crearFilaViva } from "./fila-viva";
import { type ManejadorDePagar, alCambiarDeIdioma, el, textoDePagos as tx } from "./panel-ganadores";
import { premioDeLugarEn } from "./lugares-de-meta";

/**
 * "Pagar premio": el pago en USDC de quien organiza a quien ganó, armado acá y firmado en la billetera de quien organiza.
 *
 * Tinkazo no firma ni guarda nada: arma el pago (`pagos-envio.ts`), se lo pasa a la billetera (Freighter, o la cuenta de
 * prueba en testnet) y manda lo firmado. Si la cuenta de quien organiza entró con Google (Pollar), no firma pagos desde
 * acá a propósito (su lista de firmas permitidas no incluye el pago de un premio: `atenderFirmas`, wallet-pollar.ts):
 * se muestra el pago listo para firmarlo afuera.
 *
 * Una cuenta que puede pagar sola (`Billetera.mandaSola`) cambia la pantalla: sin campo para escribir el monto. El monto
 * sale fijo del texto del premio cuando se puede leer, o se elige con un contador de a un dólar. Se muestra el saldo de la
 * cuenta que paga y, si no alcanza, se dice cuánto falta y se ofrece cargar dólares digitales. El pago lo hace esa
 * billetera: acá solo se arma, se le pasa y se traduce lo que contesta. La ofrece la cuenta de Google de la red principal
 * con pagar con Google prendido (`billeteraActiva`); sin la bandera todo queda como estaba. El camino de siempre, el
 * pago listo para aprobarlo en otra billetera, queda plegado en «Pagar desde otra billetera».
 *
 * La cuenta de quien ganó se vuelve a leer de la lista sellada justo antes de pagar con esa cuenta (`destinoDe`): nunca de
 * un campo de la pantalla ni de lo que quedó pintado. Si ya no se puede asegurar que sea la misma, no se paga nada.
 *
 * Antes de pedir la firma se mira la red: si la cuenta de quien ganó no existe o no tiene USDC activado, se dice en
 * palabras simples y se ofrece "Avisarle" (copiar un mensaje), en vez de hacer firmar algo que va a fallar.
 *
 * Un premio se paga una sola vez. Antes de armar el pago se busca en la red uno ya hecho con la nota de ese premio: si
 * está, no se arma nada; si la red no deja saberlo, tampoco (no se paga a ciegas). Y si al mandar un pago la red no
 * confirma si entró, el botón queda en pausa hasta que la red diga con certeza que ese pago no está.
 */

/* ------------------------------------------------------------- la secuencia */

/** Lo que se le pide a la cuenta cuando paga sola: lo mismo que se armó, para que se compare con lo que va a aprobar. */
export interface PedidoDeLaCuenta {
  /** La cuenta que paga. */
  cuenta: string;
  /** La cuenta de quien ganó. */
  destino: string;
  /** El monto, con siete decimales. */
  monto: string;
  /** La nota de texto del pago: `tk:premio:<sorteo>:<puesto>`. */
  nota: string;
}

/**
 * Cómo terminó un pago que la cuenta hace sola. `salio` es que entró (con el hash para verlo), `incierto` que no se sabe
 * todavía, y `no-salio` que no se pagó nada, con el motivo: la regla del pago no lo dejó pasar (`regla`), lo que había que
 * aprobar no era el pago armado (`no-coincide`), la persona lo cortó (`cancelado`), ahora no se puede pagar desde esa cuenta
 * (`ahora-no`) o se cortó la conexión al mandarlo (`red`, que no se sabe si salió).
 */
export type ResultadoDelPremio =
  | { estado: "salio"; hash: string }
  | { estado: "incierto" }
  | { estado: "no-salio"; motivo: "regla" | "no-coincide" | "cancelado" | "ahora-no" | "red" };

/** Una cuenta que paga sola, vista desde acá: lee su saldo y hace el pago que se le arma. */
export interface PagoSolo {
  /** Lo que tiene la cuenta en dólares digitales, en stroops, o `null` si no se pudo leer. */
  saldo(): Promise<bigint | null>;
  /** Paga el pago armado. Nunca lanza: lo que sale mal es un resultado. */
  pagar(xdr: string, pedido: PedidoDeLaCuenta): Promise<ResultadoDelPremio>;
  /**
   * Si un pago de este premio (por su nota) con la cuenta todavía puede entrar: lo pidió esta pestaña, otra o la página
   * antes de recargar, y su marca sigue viva. Mientras tanto no se arma otro pago de ese premio por ningún camino.
   */
  enCamino?(nota: string): boolean;
}

/** La billetera con que se firma, vista desde acá. */
export interface Billetera {
  /** La cuenta activa. */
  direccion: string;
  /** Firma dentro de la página (Freighter, la cuenta de prueba). Falso con Pollar: se firma afuera. */
  firmaAdentro: boolean;
  /** Solo la cuenta de Google que paga sola. Sin esto, el pago se firma adentro o afuera como siempre. */
  mandaSola?: PagoSolo;
  /** La red en que está la billetera, o `null` si no se sabe. */
  red(): Promise<string | null>;
  /** Firma el pago y devuelve el sobre firmado. Lanza si no se firmó. */
  firmar(xdr: string, passphrase: string, cuenta: string): Promise<string>;
}

export interface Dependencias {
  /** Busca en la red el pago de un premio. Sin caché: cada pregunta va a la red. */
  buscar: (b: BusquedaDePago) => Promise<LecturaDePago>;
  preparar: (d: DatosDelPago) => ReturnType<typeof prepararPago>;
  mandar: (red: NetworkName, xdrFirmado: string) => Promise<Envio>;
  billetera: Billetera | null;
  /** Para decir en qué paso va: mirando la red, esperando la firma, mandando, o pagando la cuenta que paga sola. */
  alAvanzar?: (paso: "mirando" | "firmando" | "enviando" | "pagando") => void;
  /**
   * Abre «Tus dólares digitales» para cargar saldo a `cuenta`. `alCerrar` se llama al cerrarla, para volver a leer el
   * saldo. Sin esto no hay botón que lleve a cargar.
   */
  cargar?: (cuenta: string, alCerrar: () => void) => void;
}

export interface PedidoDePago {
  red: NetworkName;
  raffleId: string;
  puesto: number;
  destino: string;
  activo: ActivoDePago;
  /** Lo que escribió la persona, o el monto que eligió con los botones (siete decimales). */
  monto: string;
  /** Solo si se firma afuera: la cuenta que va a pagar. Con billetera propia manda la billetera. */
  cuentaQuePaga?: string;
  /**
   * Armar el pago para aprobarlo en otra billetera, aunque la cuenta activa pueda pagar sola. Sin `cuentaQuePaga` no se
   * arma nada: el pago no puede salir de la cuenta activa.
   */
  afuera?: boolean;
  /** Los pagos anteriores a este instante (Unix, segundos) no son de este sorteo. */
  desde: number;
  /** Las cuentas cuyo pago con esta nota ya cuenta como hecho, además de la que paga. */
  pagadoras?: readonly string[];
}

export type Resultado =
  | { tipo: "monto-malo" }
  | { tipo: "cuenta-mala" }
  | { tipo: "no-se-puede"; motivo: MotivoSinPago; saldo?: string }
  /** El pago está armado y se firma afuera. */
  | { tipo: "afuera"; xdr: string; nota: string; origen: string }
  | { tipo: "otra-red" }
  | { tipo: "no-firmado" }
  /** La cuenta que paga sola no pagó nada: lo que había que aprobar no era el pago armado. */
  | { tipo: "no-coincide" }
  /** La cuenta que paga sola no puede pagar ahora. */
  | { tipo: "ahora-no" }
  | { tipo: "rechazado"; rechazo: MotivoDeRechazo }
  /** No se supo si el pago entró. `busqueda` es lo que hay que mirar en la red antes de volver a ofrecer pagar. */
  | { tipo: "sin-respuesta"; busqueda: BusquedaDePago }
  /** El premio ya tenía su pago en la red: no se armó otro. */
  | { tipo: "ya-pagado"; hash: string; origen: string }
  /** No se pudo mirar en la red si el premio ya estaba pagado: no se armó nada. */
  | { tipo: "sin-consulta" }
  | { tipo: "listo"; hash: string; origen: string };

/** Busca en la red el pago de un premio. Nunca lanza: si la búsqueda falla, no se sabe. */
export async function mirarSiSalio(deps: Pick<Dependencias, "buscar">, b: BusquedaDePago): Promise<LecturaDePago> {
  try {
    return await deps.buscar(b);
  } catch {
    return { tipo: "sin-consulta" };
  }
}

/* ------------------------------------------------------- el monto, con botones */

const UN_DOLAR = 10_000_000n;
/** Sin saber el saldo, el contador no pasa de un millón de dólares: un tope para que no se vaya al infinito. */
const TOPE_SIN_SALDO = 1_000_000n * UN_DOLAR;

/** Un número con un grupo de tres cifras tras un punto o una coma ("1.000", "2,500"): puede ser un millar y no un decimal. */
const PARECE_UN_MILLAR = /\d[.,]\d{3}(?!\d)/;

/**
 * El monto que dice el texto del premio, en stroops, o `null` si no hay uno claro. Si el texto escribe un número como
 * "1.000" no se sabe si es mil o uno: leerlo como uno pagaría mil veces menos y el premio quedaría pagado. Sin monto
 * claro se elige con el contador y la persona ve lo que va a pagar.
 */
export function montoFijoDelPremio(premio: string): bigint | null {
  if (PARECE_UN_MILLAR.test(premio)) return null;
  const crudo = montoDelPremio(premio);
  const normal = crudo === null ? null : montoDePago(crudo);
  return normal === null ? null : stroopsDe(normal);
}

/**
 * Lo menos y lo más que marca el contador con este saldo. Nunca menos de un dólar ni más que el saldo. Con menos de un
 * dólar en la cuenta el piso es lo que hay. Con la cuenta vacía queda en un dólar, y la pantalla dice cuánto falta.
 */
export function limitesDelContador(saldo: bigint | null): { piso: bigint; techo: bigint } {
  const hasta = saldo === null ? TOPE_SIN_SALDO : saldo;
  const piso = hasta > 0n && hasta < UN_DOLAR ? hasta : UN_DOLAR;
  return { piso, techo: hasta > piso ? hasta : piso };
}

/** Un monto dentro de lo que deja el contador. */
export function acotarMonto(monto: bigint, saldo: bigint | null): bigint {
  const { piso, techo } = limitesDelContador(saldo);
  if (monto < piso) return piso;
  return monto > techo ? techo : monto;
}

/** Sube o baja un dólar el monto, sin salirse de lo que deja el contador. */
export function deAUnDolarSolo(monto: bigint, signo: 1 | -1, saldo: bigint | null): bigint {
  return acotarMonto(monto + BigInt(signo) * UN_DOLAR, saldo);
}

/** Con qué monto arranca el contador: dólares enteros desde `desde` (el monto fijo, si había uno), o un dólar. */
export function arranqueDelContador(desde: bigint | null, saldo: bigint | null): bigint {
  return acotarMonto(desde === null ? UN_DOLAR : (desde / UN_DOLAR) * UN_DOLAR, saldo);
}

/** Un monto en stroops como lo pide el pago: siete decimales. */
export function montoEnTexto(stroops: bigint): string {
  return `${stroops / UN_DOLAR}.${(stroops % UN_DOLAR).toString().padStart(7, "0")}`;
}

/** Un monto en stroops como se lee en el idioma de ahora ("12,50" en español, "12.50" en inglés): dos decimales, y más solo si el monto los tiene. */
export function formatoDeMonto(stroops: bigint): string {
  return montoConCentavos(stroops, getLang(), "exacto");
}

/** Un monto escrito con punto ("50.0000000" o "12.5") como se lee en el idioma de ahora. Si no es un monto, se deja como vino. */
function montoParaLeer(monto: string): string {
  const valido = montoDePago(monto);
  return valido === null ? monto : formatoDeMonto(stroopsDe(valido));
}

/* ------------------------------------------------------------------ los pasos */

/**
 * Los pasos de un pago, sin pantalla: valida el monto, busca en la red si el premio ya está pagado, mira las cuentas,
 * arma el pago y, si hay billetera que firme acá, lo firma y lo manda. Nunca lanza. No manda nada si algo de antes falla.
 */
export async function pagarUnPremio(deps: Dependencias, p: PedidoDePago): Promise<Resultado> {
  const monto = montoDePago(p.monto);
  if (!monto) return { tipo: "monto-malo" };
  const b = deps.billetera;
  // «Pagar desde otra billetera»: el pago se arma para aprobarlo afuera, aunque la cuenta activa pueda pagar sola.
  const solo = p.afuera === true ? undefined : b?.mandaSola;
  const firmaAdentro = !!b?.firmaAdentro && p.afuera !== true;
  const origen = firmaAdentro || solo ? (b as Billetera).direccion : (p.cuentaQuePaga ?? (p.afuera === true ? "" : (b?.direccion ?? "")));
  if (!esDireccionG(origen)) return { tipo: "cuenta-mala" };

  deps.alAvanzar?.("mirando");
  let busqueda: BusquedaDePago;
  try {
    const pagadoras = [...new Set([...(p.pagadoras ?? []), origen])];
    busqueda = { red: p.red, destino: p.destino, activo: p.activo, nota: notaDelPremio(p.raffleId, p.puesto), pagadoras, desde: p.desde };
  } catch {
    return { tipo: "no-se-puede", motivo: "datos-invalidos" };
  }
  // Un pago con la nota de este premio ya en la red (de otra pestaña, de antes de recargar, o uno que entró sin que
  // la red lo confirmara) hace que no se arme otro. Sin poder saberlo, tampoco se arma.
  const previo = await mirarSiSalio(deps, busqueda);
  if (previo.tipo === "pagado") return { tipo: "ya-pagado", hash: previo.hash, origen: previo.de };
  if (previo.tipo === "sin-consulta") return { tipo: "sin-consulta" };

  const prep = await deps.preparar({ red: p.red, origen, destino: p.destino, activo: p.activo, monto, raffleId: p.raffleId, puesto: p.puesto });
  if (!prep.ok) return { tipo: "no-se-puede", motivo: prep.motivo, ...(prep.saldo !== undefined ? { saldo: prep.saldo } : {}) };
  if (solo) return pagarSola(solo, { xdr: prep.xdr, nota: prep.nota, monto: prep.monto }, { destino: p.destino, origen, busqueda }, deps.alAvanzar);
  if (!firmaAdentro) return { tipo: "afuera", xdr: prep.xdr, nota: prep.nota, origen };

  const pass = passphraseDe(p.red);
  const suya = await (b as Billetera).red().catch(() => null);
  if (suya !== null && suya !== pass) return { tipo: "otra-red" };

  deps.alAvanzar?.("firmando");
  let firmado: string;
  try {
    firmado = await (b as Billetera).firmar(prep.xdr, pass, origen);
  } catch {
    return { tipo: "no-firmado" };
  }
  deps.alAvanzar?.("enviando");
  const env = await deps.mandar(p.red, firmado);
  if (env.ok) return { tipo: "listo", hash: env.hash, origen };
  return env.rechazo === "sin-respuesta" ? { tipo: "sin-respuesta", busqueda } : { tipo: "rechazado", rechazo: env.rechazo };
}

/**
 * El pago de una cuenta que paga sola: le pasa lo armado y traduce lo que contesta. Un corte al mandar o un error que no
 * se esperaba dejan el pago en duda (no se sabe si salió), no como no pagado: el botón solo vuelve cuando la red dice
 * con certeza que ese pago no está.
 */
async function pagarSola(
  solo: PagoSolo,
  armado: { xdr: string; nota: string; monto: string },
  quien: { destino: string; origen: string; busqueda: BusquedaDePago },
  alAvanzar: Dependencias["alAvanzar"],
): Promise<Resultado> {
  alAvanzar?.("pagando");
  let r: ResultadoDelPremio;
  try {
    r = await solo.pagar(armado.xdr, { cuenta: quien.origen, destino: quien.destino, monto: armado.monto, nota: armado.nota });
  } catch {
    return { tipo: "sin-respuesta", busqueda: quien.busqueda };
  }
  if (r.estado === "salio") return { tipo: "listo", hash: r.hash, origen: quien.origen };
  if (r.estado === "incierto") return { tipo: "sin-respuesta", busqueda: quien.busqueda };
  if (r.motivo === "no-coincide") return { tipo: "no-coincide" };
  if (r.motivo === "ahora-no") return { tipo: "ahora-no" };
  if (r.motivo === "red") return { tipo: "sin-respuesta", busqueda: quien.busqueda };
  return { tipo: "no-firmado" };
}

/**
 * Lo que dice cuánto tiene una cuenta en dólares digitales (stroops): `0` si no tiene la línea o la cuenta no existe, y
 * `null` si no se pudo saber. Nunca lanza.
 */
export async function saldoDeLaCuenta(red: NetworkName, cuenta: string, leer: typeof mirarCuenta = mirarCuenta): Promise<bigint | null> {
  try {
    const l = await leer(red, cuenta);
    if (l === "no-existe") return 0n;
    if (typeof l !== "object") return null;
    const usdc = usdcDeLaRed(red);
    const linea = l.saldos.find((s) => s.code === usdc.code && s.issuer === usdc.issuer);
    return linea ? stroopsDe(linea.saldo) : 0n;
  } catch {
    return null;
  }
}

/** De lo que depende armar la billetera, para reemplazarlo en las pruebas. */
export interface EntornoDeLaBilletera {
  /** La red de este sitio. */
  red: NetworkName;
  /** ¿Pagar con la cuenta de Google está prendido en el build? */
  pagarConGoogle: () => boolean;
  /** Cuánto tiene la cuenta en dólares digitales. */
  saldo: (red: NetworkName, cuenta: string) => Promise<bigint | null>;
}

/**
 * La billetera activa de la página, si firma pagos acá. Una billetera propia firma adentro. Una cuenta de Google de la red
 * principal, con pagar con Google prendido y su billetera lista para pagar premios, paga sola (`mandaSola`): lee su saldo
 * y le pasa el pago a la billetera, que lo revisa, lo aprueba con su voto y lo manda por el servicio de comisiones. Esa
 * billetera nunca firma un pago desde acá por otro camino (`firmar` lanza), y sin la bandera queda como siempre: no firma
 * adentro y el pago se arma para aprobarlo afuera.
 */
export async function billeteraActiva(entorno: Partial<EntornoDeLaBilletera> = {}): Promise<Billetera | null> {
  const [{ activeWallet }, pollar] = await Promise.all([import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
  const w = activeWallet();
  if (!w?.address) return null;
  const direccion = w.address;
  const red = entorno.red ?? network.name;
  const hayBandera = entorno.pagarConGoogle ?? pagarConGoogle;
  const leerSaldo = entorno.saldo ?? ((r, c) => saldoDeLaCuenta(r, c));
  const google = pollar.submitsItself(w);
  const paga = google ? w.pagarPremio?.bind(w) : undefined;
  const base: Billetera = {
    direccion,
    firmaAdentro: !google,
    red: () => w.networkPassphrase(),
    firmar: async (xdr, networkPassphrase, address) => (await w.signTransaction(xdr, { networkPassphrase, address })).signedTxXdr,
  };
  if (paga === undefined || red !== "mainnet" || !hayBandera()) return base;
  const saldo = (): Promise<bigint | null> => leerSaldo(red, direccion);
  // La marca del premio que pone la billetera al pedir la firma, y que vive mientras ese pago pueda entrar.
  const enCamino = (nota: string): boolean => {
    const hasta = pollar.leerMarcaDeLaCuenta(pollar.MARCA_DEL_PREMIO + nota);
    return hasta !== null && hasta > Math.floor(Date.now() / 1000);
  };
  const mandaSola: PagoSolo = { saldo, pagar: (xdr, pedido) => paga(xdr, pedido), enCamino };
  return { ...base, firmaAdentro: true, firmar: noFirmaAcaPorEllaSola, mandaSola };
}

/** Una cuenta de Google no firma un pago desde este formulario: paga con `mandaSola` o se arma el pago para aprobarlo afuera. */
async function noFirmaAcaPorEllaSola(): Promise<string> {
  throw new Error("pago-sin-firma-aca");
}

/* ----------------------------------------------------------------- el mensaje */

/** Lo que dice cada resultado: la clave del texto, lo que se le reemplaza y qué ofrece. `cargar` es el botón de cargar saldo. */
export interface Mensaje {
  clave: string;
  vars: Record<string, string>;
  avisar: boolean;
  error: boolean;
  cargar: boolean;
}

/**
 * Qué texto va con cada resultado (su clave y lo que se le reemplaza), y si ofrece "Avisarle" o cargar saldo. Con
 * `google` (la cuenta que paga sola) algunos resultados tienen su propio texto, que habla de los dólares digitales de la cuenta.
 */
export function mensajeDe(r: Resultado, c: { quien: string; red: NetworkName; monto: string; google?: boolean }): Mensaje {
  const base = mensajeBase(r, c);
  // Cargar saldo ayuda solo cuando falta del lado de la cuenta que paga sola: sin cuenta, sin dólares digitales o sin saldo.
  const faltaEnLaCuenta = r.tipo === "no-se-puede" && ["origen-sin-saldo", "origen-sin-linea", "origen-sin-cuenta"].includes(r.motivo);
  return { ...base, cargar: c.google === true && faltaEnLaCuenta };
}

function mensajeBase(r: Resultado, c: { quien: string; red: NetworkName; monto: string; google?: boolean }): Omit<Mensaje, "cargar"> {
  const v: Record<string, string> = { quien: c.quien, red: c.red, monto: montoParaLeer(c.monto) };
  const g = c.google === true;
  switch (r.tipo) {
    case "monto-malo":
      return { clave: "pgMontoMal", vars: v, avisar: false, error: true };
    case "cuenta-mala":
      return { clave: "pgCuentaMala", vars: v, avisar: false, error: true };
    case "no-se-puede":
      switch (r.motivo) {
        case "destino-sin-cuenta":
          return { clave: "pgSinCuentaDestino", vars: v, avisar: true, error: true };
        case "destino-sin-linea":
          return { clave: "pgSinLinea", vars: v, avisar: true, error: true };
        case "destino-lleno":
          return { clave: "pgDestinoLleno", vars: v, avisar: false, error: true };
        case "origen-sin-cuenta":
          return { clave: "pgSinCuentaPropia", vars: v, avisar: false, error: true };
        case "origen-sin-linea":
          return { clave: "pgSinLineaPropia", vars: v, avisar: false, error: true };
        case "origen-sin-saldo":
          if (g) return { clave: "pgGoogleNoAlcanza", vars: { ...v, ...cuantoFalta(c.monto, r.saldo) }, avisar: false, error: true };
          return { clave: "pgSinSaldo", vars: { ...v, saldo: formatoDeMonto(stroopsDe(r.saldo ?? "0")) }, avisar: false, error: true };
        case "sin-red":
          return { clave: "pgSinRed", vars: v, avisar: false, error: true };
        default:
          return { clave: "pgCuentaMala", vars: v, avisar: false, error: true };
      }
    case "afuera":
      return { clave: "pgAfuera", vars: v, avisar: false, error: false };
    case "otra-red":
      return { clave: "pgOtraRed", vars: v, avisar: false, error: true };
    case "no-firmado":
      return { clave: g ? "pgGoogleNoSalio" : "pgNoFirmaste", vars: v, avisar: false, error: true };
    case "no-coincide":
      return { clave: "pgGoogleNoCoincide", vars: v, avisar: false, error: true };
    case "ahora-no":
      return { clave: "pgGoogleAhoraNo", vars: v, avisar: false, error: true };
    case "rechazado":
      return {
        clave: { "sin-saldo": "pgRechazoSaldo", "sin-linea": "pgSinLinea", "sin-cuenta": "pgSinCuentaDestino", lleno: "pgDestinoLleno", secuencia: "pgRechazoSecuencia", vencido: "pgRechazoVencido", firma: "pgRechazoFirma", otro: "pgRechazoOtro" }[r.rechazo],
        vars: v,
        avisar: r.rechazo === "sin-linea" || r.rechazo === "sin-cuenta",
        error: true,
      };
    case "sin-respuesta":
      return { clave: g ? "pgGoogleDuda" : "pgDuda", vars: v, avisar: false, error: true };
    case "ya-pagado":
      return { clave: "pgYaPagado", vars: v, avisar: false, error: false };
    case "sin-consulta":
      return { clave: "pgSinConsultaPrevia", vars: v, avisar: false, error: true };
    case "listo":
      return { clave: "pgListo", vars: v, avisar: false, error: false };
  }
}

/** Lo que tiene la cuenta, el monto del premio y lo que falta, en el idioma de ahora: para el texto de que no alcanza. */
function cuantoFalta(monto: string, saldo: string | undefined): Record<string, string> {
  const quiere = stroopsDe(montoDePago(monto) ?? "0");
  const tiene = stroopsDe(saldo ?? "0");
  return { saldo: formatoDeMonto(tiene), monto: formatoDeMonto(quiere), falta: formatoDeMonto(quiere > tiene ? quiere - tiene : 0n) };
}

/** Los mensajes que son una espera (la ruedita) y los que dicen que el pago ya salió (el tilde). */
const DE_ESPERA = new Set(["pgDudaMirando", "pgGoogleDudaMirando"]);
const DE_LISTO = new Set(["pgListo", "pgYaPagado"]);

/** El texto de cada paso mientras se paga. Con la cuenta que paga sola, mirar y pagar tienen su propia frase. */
function claveDelPaso(paso: "mirando" | "firmando" | "enviando" | "pagando", conLaCuenta: boolean): string {
  if (paso === "mirando") return conLaCuenta ? "pgGoogleMirando" : "pgMirando";
  if (paso === "pagando") return "pgGooglePagando";
  return paso === "firmando" ? "pgFirmando" : "pgEnviando";
}

/** Copia al portapapeles. `false` si el navegador no deja. */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- la pantalla */

export interface ContextoDePago {
  red: NetworkName;
  raffleId: string;
  premio: string;
  activo: ActivoDePago;
  /** Se le suma la cuenta que paga, para que el panel reconozca su pago. */
  pagadoras: Set<string>;
  /** Los pagos anteriores a este instante (Unix, segundos) no son de este sorteo. */
  desde: number;
  /** Tras un pago sin respuesta, cuánto se espera antes de mirar en la red si entró (6 s: que alcance a cerrar un ledger). */
  esperaMs?: number;
  /** Para las pruebas: las dependencias de la red y la billetera. */
  dependencias?: () => Promise<Dependencias>;
  /**
   * Vuelve a leer de la lista sellada la cuenta de quien ganó en ese puesto, o `null` si ya no se puede asegurar (otro
   * sorteo, otra lista, un puesto que no es una cuenta). Es lo que paga la cuenta que paga sola: sin esto, esa cuenta no paga.
   */
  destinoDe?: (puesto: number) => string | null;
}

/** Lo que queda de un formulario cerrado, para reabrirlo tal cual si un pago está en camino, en duda o ya hecho. */
interface FormularioGuardado {
  form: HTMLFormElement;
  retener: () => boolean;
  /** Si el pago de ese premio quedó en duda (no se sabe si salió). */
  enDuda: () => boolean;
  reabrir: () => void;
}

/**
 * El manejador de "Pagar premio" para `montarGanadores`: abre, debajo de la fila, el monto y el botón "Firmar y pagar".
 * Tocar "Pagar premio" otra vez (o "Cancelar") lo cierra. Si el pago de ese premio está en camino, en duda o hecho,
 * reabrir muestra ese mismo formulario y no uno nuevo con el botón disponible.
 *
 * Con una cuenta que paga sola el formulario cambia apenas se sabe quién paga: sin campo de monto, con el monto fijo o el
 * contador, el saldo y el botón Pagar. Un toque que llegó antes del cambio no paga nada: la persona ve el formulario nuevo.
 *
 * Con el pago en duda, o con uno de ese premio con la cuenta que todavía puede entrar, Pagar y Otro monto no se ven: queda
 * el aviso y Volver a mirar, que solo pregunta a la red. El manejador también dice si el pago de una fila está sin confirmar
 * (`sinConfirmar`), para que el panel no la muestre como pendiente.
 */
export function pagarPremioEn(ctx: ContextoDePago): ManejadorDePagar {
  const guardados = new Map<number, FormularioGuardado>();
  const manejador: ManejadorDePagar = (fila, caja, alTerminar, alCambiar) => {
    if (caja.firstElementChild) {
      caja.replaceChildren();
      return;
    }
    const guardado = guardados.get(fila.puesto);
    if (guardado?.retener()) {
      caja.replaceChildren(guardado.form);
      guardado.reabrir();
      return;
    }
    const form = el("form", "gan-form");
    form.noValidate = true;
    // El monto sale del premio del lugar de esta fila (`puesto` cuenta desde 0, el lugar desde 1): con un premio por
    // lugar, nunca del de otro lugar, y si el suyo quedó sin premio no hay monto que ofrecer. Sin lugares, el de todos.
    const premioDeLaFila = premioDeLugarEn(ctx.premio, fila.puesto + 1) ?? ctx.premio;

    const montoL = el("label", "gan-campo");
    const montoT = el("span", "kicker");
    const monto = el("input");
    monto.type = "text";
    monto.inputMode = "decimal";
    monto.autocomplete = "off";
    monto.value = montoDelPremio(premioDeLaFila) ?? "";
    const ayuda = el("span", "note gan-ayuda");
    montoL.append(montoT, monto, ayuda);

    // La cuenta que paga solo se pregunta cuando se firma afuera: con Freighter es la de la billetera.
    const cuentaL = el("label", "gan-campo");
    const cuentaT = el("span", "kicker");
    const cuenta = el("input");
    cuenta.type = "text";
    cuenta.autocomplete = "off";
    cuenta.spellcheck = false;
    cuentaL.append(cuentaT, cuenta);
    cuentaL.hidden = true;

    // El monto con botones, para la cuenta que paga sola: el fijo en grande, o el contador de a un dólar.
    const montos = el("div", "gan-google");
    montos.hidden = true;
    const grande = el("p", "gan-monto-grande");
    const contador = el("div", "gan-contador");
    const menos = el("button", "ghost");
    menos.type = "button";
    const valor = el("b", "gan-contador-valor");
    valor.setAttribute("aria-live", "polite");
    const mas = el("button", "ghost");
    mas.type = "button";
    contador.append(menos, valor, mas);
    const otroMonto = el("button", "ghost");
    otroMonto.type = "button";
    montos.append(grande, contador, otroMonto);

    const explica = el("p", "note gan-explica");
    // Lo que falta para pagar y el botón que lleva a cargar dólares digitales.
    const falta = el("p", "gan-falta");
    falta.setAttribute("role", "status");
    falta.hidden = true;
    const cargar = el("button", "primary");
    cargar.type = "button";
    cargar.hidden = true;
    const acciones = el("div", "row");
    const pagar = el("button", "primary");
    pagar.type = "submit";
    // Tras un pago en duda: vuelve a mirar en la red si entró.
    const volver = el("button", "primary gan-volver");
    volver.type = "button";
    volver.hidden = true;
    const cancelar = el("button", "ghost");
    cancelar.type = "button";
    acciones.append(pagar, volver, cancelar);

    const msg = el("p", "gan-msg");
    msg.setAttribute("role", "status");
    // La línea de mensaje es una fila viva: la ruedita mientras trabaja y el tilde cuando el pago salió. Solo cambia cómo se ve
    // lo que ya se decía: cuándo se puede pagar, pagar de nuevo o reintentar lo deciden los mismos candados de siempre.
    const filaMsg = crearFilaViva(msg);
    const avisar = el("button", "ghost");
    avisar.type = "button";
    avisar.hidden = true;
    const manual = el("textarea", "gan-copia");
    manual.readOnly = true;
    manual.rows = 3;
    manual.hidden = true;

    // «Pagar desde otra billetera»: solo con la cuenta que paga sola. Lleva la cuenta que paga y arma el pago de siempre.
    const otraB = el("details", "gan-otra");
    const otraBResumen = el("summary");
    const armarAfuera = el("button", "ghost");
    armarAfuera.type = "button";
    otraB.append(otraBResumen, armarAfuera);
    otraB.hidden = true;

    const afuera = el("details", "gan-afuera");
    const resumen = el("summary");
    const xdr = el("textarea", "gan-copia mono");
    xdr.readOnly = true;
    xdr.rows = 4;
    const copiarXdr = el("button", "ghost");
    copiarXdr.type = "button";
    afuera.append(resumen, xdr, copiarXdr);
    afuera.hidden = true;

    const enlace = el("a", "gan-enlace");
    enlace.target = "_blank";
    enlace.rel = "noopener";
    enlace.hidden = true;

    form.append(montoL, montos, cuentaL, explica, falta, cargar, acciones, msg, avisar, manual, otraB, afuera, enlace);
    caja.replaceChildren(form);

    // Lo que se está diciendo, para escribirlo de nuevo si cambia el idioma. `rehacer` vuelve a armar lo que lleva números.
    let dicho: { clave: string; vars: Record<string, string>; rehacer?: () => Record<string, string> } | null = null;
    let progreso: string | null = null;
    let montoAviso = "";
    // Mientras no se mandó nada, la cuenta que paga sigue a la billetera; una vez pagado, ese campo ya no se muestra.
    let hecho = false;
    // Un pago mandado sin respuesta de la red: hasta saber que no está, no se ofrece pagar otra vez.
    let enDuda: { deps: Dependencias; busqueda: BusquedaDePago; google: boolean } | null = null;
    let mirandoDuda = false;
    // Las dependencias con que se armó la cuenta que paga sola: con ellas se mira un pago en camino que este formulario no mandó.
    let depsDeLaCuenta: Dependencias | null = null;
    // Si la última vez que se pintó había un pago en duda o en camino: el panel se entera solo cuando cambia.
    let ultimaFrenada = false;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    let ocupado = false;
    // La cuenta que paga sola: quién es, cuánto tiene, y qué monto va a pagar (fijo del premio o elegido con el contador).
    let solo: PagoSolo | null = null;
    let cuentaSola = "";
    let abrirCarga: Dependencias["cargar"];
    let saldo: bigint | null = null;
    const fijo = montoFijoDelPremio(premioDeLaFila);
    let enContador = fijo === null;
    let cuanto = fijo ?? UN_DOLAR;
    // El último resultado pide cargar saldo (la cuenta que paga todavía no tiene dólares digitales).
    let cargarPorMensaje = false;
    let lecturas = 0;

    /** Escribe lo que dice la línea: una espera lleva la ruedita, un pago hecho el tilde, y lo demás es texto solo. */
    const escribir = (texto: string, modo: "espera" | "listo" | "texto"): void => {
      if (modo === "espera") filaMsg.revisando(texto);
      else if (modo === "listo") filaMsg.llego(texto);
      else {
        filaMsg.limpiar();
        msg.textContent = texto;
      }
    };
    const escribirClave = (clave: string, texto: string): void =>
      escribir(texto, DE_LISTO.has(clave) ? "listo" : DE_ESPERA.has(clave) ? "espera" : "texto");

    const decir = (clave: string | null, vars: Record<string, string> = {}, error = false, rehacer?: () => Record<string, string>): void => {
      dicho = clave ? { clave, vars, ...(rehacer ? { rehacer } : {}) } : null;
      msg.classList.toggle("bad", error);
      if (clave) escribirClave(clave, tx(clave, vars));
      else escribir("", "texto");
    };

    /**
     * Un pago de este premio con la cuenta que todavía puede entrar (de esta pestaña, de otra o de antes de recargar). Si no
     * se puede saber, cuenta como que sí: armar otro pago de ese premio puede pagarlo dos veces.
     */
    const enCamino = (): boolean => {
      const lector = solo;
      if (lector?.enCamino === undefined) return false;
      try {
        return lector.enCamino(fila.nota);
      } catch {
        return true;
      }
    };

    /** Un pago de este premio con la cuenta que todavía puede entrar, y ninguno que este formulario esté mandando ahora. */
    const enCaminoAhora = (): boolean => solo !== null && !hecho && !ocupado && enDuda === null && enCamino();

    /**
     * Qué botones se ven. Con un pago en duda, o uno de este premio con la cuenta que todavía puede entrar, Pagar no se ve ni
     * se puede tocar: queda Volver a mirar como única acción principal. Cuando eso cambia, se le avisa al panel de la fila.
     */
    const pintarAcciones = (): void => {
      const frenado = enDuda !== null || enCaminoAhora();
      const sinSaldo = solo !== null && saldo !== null && cuanto > saldo;
      volver.hidden = hecho || !frenado || mirandoDuda;
      pagar.hidden = hecho || frenado || sinSaldo || cargarPorMensaje;
      pagar.disabled = ocupado || frenado || hecho;
      if (frenado !== ultimaFrenada) {
        ultimaFrenada = frenado;
        alCambiar?.();
      }
    };

    /** El formulario de la cuenta que paga sola: el monto, el saldo, lo que falta y qué botones se ven. */
    const pintarSola = (): void => {
      if (solo === null) return;
      const tiene = saldo;
      const sinSaldo = tiene !== null && cuanto > tiene;
      // Con un pago de este premio en camino (y sin que se esté pagando ahora), el aviso ocupa el lugar de la línea de la plata.
      const camino = enCaminoAhora();
      const frenado = enDuda !== null || camino;
      const quieto = ocupado || frenado || hecho;
      const num = (n: bigint): string => formatoDeMonto(n);
      const conUnidad = (n: bigint): string => tx("saldoMonto", { n: num(n) });
      const { piso, techo } = limitesDelContador(tiene);
      montos.hidden = hecho;
      grande.hidden = enContador;
      grande.textContent = conUnidad(cuanto);
      contador.hidden = !enContador;
      valor.textContent = conUnidad(cuanto);
      menos.textContent = tx("saldoMandarMenos");
      menos.disabled = quieto || cuanto <= piso;
      mas.textContent = tx("saldoMandarMas");
      mas.disabled = quieto || cuanto >= techo;
      otroMonto.textContent = tx("pgGoogleOtroMonto");
      // Con un pago en duda o en camino no se elige otro monto: no hay nada que pagar de nuevo.
      otroMonto.hidden = enContador || frenado;
      otroMonto.disabled = quieto;
      explica.hidden = hecho || enDuda !== null || (sinSaldo && !camino);
      explica.classList.toggle("aviso", camino);
      if (camino) explica.textContent = tx("pgGoogleEnCamino");
      else if (tiene === null) explica.textContent = tx("pgGoogleVasSinSaldo", { monto: num(cuanto), quien: fila.nombre });
      else if (!sinSaldo) explica.textContent = tx("pgGoogleVas", { monto: num(cuanto), quien: fila.nombre, resto: conUnidad(tiene - cuanto) });
      falta.hidden = hecho || frenado || !sinSaldo;
      falta.textContent =
        tiene !== null && sinSaldo ? tx("pgGoogleNoAlcanza", { saldo: num(tiene), monto: num(cuanto), falta: num(cuanto - tiene) }) : "";
      cargar.textContent = tx("pgGoogleCargar");
      cargar.hidden = hecho || frenado || !(sinSaldo || cargarPorMensaje);
      otraBResumen.textContent = tx("pgGoogleOtraBilletera");
      armarAfuera.textContent = tx("pgArmar");
      // Con un pago en duda, o uno de este premio con la cuenta que todavía puede entrar, no se arma otro desde otra
      // billetera: se esconde en vez de dejar un camino que pagaría dos veces.
      otraB.hidden = hecho || enDuda !== null || enCamino();
      // Sin saldo la acción que importa es cargar, y con un pago frenado es Volver a mirar: Pagar se esconde para que haya una sola.
      pintarAcciones();
    };

    const pintar = (): void => {
      montoT.textContent = tx("pgMontoL");
      ayuda.textContent = tx("pgMontoAyuda");
      cuentaT.textContent = tx("pgCuentaPagaL");
      explica.textContent = tx("pgPaga", { quien: fila.nombre, nota: fila.nota });
      pagar.textContent = solo !== null ? tx("pgGooglePagar") : cuentaL.hidden ? tx("pgFirmar") : tx("pgArmar");
      volver.textContent = tx("pgVolverAMirar");
      cancelar.textContent = tx("pgCerrarCuadro");
      avisar.textContent = tx("pgAvisar");
      resumen.textContent = tx("pgXdrResumen");
      copiarXdr.textContent = tx("pgCopiar");
      if (dicho) escribirClave(dicho.clave, tx(dicho.clave, dicho.rehacer ? dicho.rehacer() : dicho.vars));
      if (progreso) escribir(tx(progreso), "espera");
      pintarSola();
      pintarAcciones();
    };

    /** Lee lo que tiene la cuenta que paga sola. Si no se puede, no se sabe: Pagar sigue y la red revisa el saldo al armar. */
    const leerSaldo = async (): Promise<void> => {
      const lector = solo;
      if (lector === null) return;
      const esta = ++lecturas;
      let leido: bigint | null;
      try {
        leido = await lector.saldo();
      } catch {
        leido = null;
      }
      // Una lectura más nueva manda: la que llegó tarde no pisa lo que ya se ve.
      if (esta !== lecturas) return;
      saldo = leido;
      if (enContador) cuanto = acotarMonto(cuanto, saldo);
      pintarSola();
    };

    /** Pasa el formulario al de la cuenta que paga sola: sin campo de monto, con el monto fijo o el contador. */
    const entrarEnSola = (deps: Dependencias, lector: PagoSolo): void => {
      const primera = solo === null;
      solo = lector;
      depsDeLaCuenta = deps;
      cuentaSola = deps.billetera?.direccion ?? "";
      abrirCarga = deps.cargar;
      if (!primera) return;
      montoL.remove();
      // Lo que importa (a quién se paga y cuánto queda) va pegado al monto y en tinta, no en gris después del botón.
      explica.classList.remove("note");
      montos.insertBefore(explica, otroMonto);
      otraB.insertBefore(cuentaL, armarAfuera);
      cuentaL.hidden = false;
      void leerSaldo();
    };

    alCambiarDeIdioma(pintar, form);
    pintar();
    monto.focus();
    // Con la billetera de quien organiza, paga su cuenta; si se firma afuera (Pollar), se elige la cuenta que paga.
    const preparar = async (): Promise<Dependencias> => {
      const deps = ctx.dependencias ? await ctx.dependencias() : await dependenciasReales();
      const lector = deps.billetera?.mandaSola;
      if (lector) entrarEnSola(deps, lector);
      else cuentaL.hidden = hecho || deps.billetera?.firmaAdentro === true;
      if (!cuenta.value && deps.billetera && !lector) cuenta.value = deps.billetera.direccion;
      pintar();
      return deps;
    };
    void preparar()
      .then(() => form.scrollIntoView?.({ block: "nearest" }))
      .catch(() => undefined);

    // Un pago mandado o encontrado: queda la confirmación y el enlace, y el botón no vuelve.
    const terminarPagado = (hash: string, origen: string, yaEstaba = false): void => {
      hecho = true;
      form.classList.add("gan-hecho");
      ctx.pagadoras.add(origen);
      enlace.href = txUrl(hash, ctx.red);
      enlace.textContent = tx("pgVerPago");
      enlace.hidden = false;
      montoL.hidden = true;
      cuentaL.hidden = true;
      explica.hidden = true;
      acciones.hidden = true;
      pagar.hidden = true;
      pintarSola();
      alTerminar(yaEstaba);
    };

    /** Lo que hay que mirar en la red por un pago de este premio que pudo salir con la cuenta sin que este formulario lo mandara. */
    const dudaPorCamino = (): { deps: Dependencias; busqueda: BusquedaDePago; google: boolean } | null => {
      const deps = depsDeLaCuenta;
      if (deps === null) return null;
      const origen = deps.billetera?.direccion ?? "";
      const pagadoras = [...new Set([...ctx.pagadoras, origen])];
      const busqueda: BusquedaDePago = { red: ctx.red, destino: fila.cuenta, activo: ctx.activo, nota: fila.nota, pagadoras, desde: ctx.desde };
      return { deps, busqueda, google: true };
    };

    /**
     * Mira en la red si el pago en duda, o el que está en camino, entró. Solo pregunta: no arma, no firma ni manda nada. Solo
     * un "no está" seguro, con la cuenta ya sin poder pagarlo, vuelve a habilitar el botón.
     */
    const mirarDuda = async (): Promise<void> => {
      if (mirandoDuda) return;
      const guardada = enDuda;
      // Sin duda guardada, lo que se ve es un pago en camino (`ultimaFrenada`): se pregunta aunque su marca haya vencido hace un momento.
      const duda = guardada ?? (ultimaFrenada ? dudaPorCamino() : null);
      if (!duda) return;
      clearTimeout(reloj);
      mirandoDuda = true;
      progreso = null;
      decir(duda.google ? "pgGoogleDudaMirando" : "pgDudaMirando");
      pintarAcciones();
      const l = await mirarSiSalio(duda.deps, duda.busqueda);
      mirandoDuda = false;
      if (enDuda !== guardada) {
        pintarAcciones();
        return;
      }
      if (l.tipo === "pagado") {
        enDuda = null;
        decir("pgListo");
        terminarPagado(l.hash, l.de, true);
      } else if (l.tipo === "no-hay" && !(duda.google && enCamino())) {
        // No está y, con la cuenta, ya no puede entrar: recién ahí se puede volver a intentar. Mientras pueda, sigue la duda.
        enDuda = null;
        decir(duda.google ? "pgGoogleDudaNoEsta" : "pgDudaNoEsta");
        pintarSola();
        pintarAcciones();
      } else {
        // Sin un "no está" seguro, un pago en camino pasa a quedar en duda: aunque su marca venza, Pagar no vuelve sin preguntar.
        if (guardada === null) enDuda = duda;
        decir(duda.google ? "pgGoogleDudaSinRed" : "pgDudaSinRed", {}, true);
        pintarSola();
        pintarAcciones();
      }
    };
    volver.addEventListener("click", () => void mirarDuda());

    guardados.set(fila.puesto, {
      form,
      retener: () => ocupado || enDuda !== null || hecho,
      enDuda: () => enDuda !== null,
      reabrir: () => {
        alCambiarDeIdioma(pintar, form);
        pintar();
      },
    });

    const cerrar = (): void => caja.replaceChildren();
    cancelar.addEventListener("click", cerrar);
    form.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cerrar();
    });

    // El contador y «Otro monto»: no se tocan con un pago en camino, en duda o hecho.
    const cambiarMonto = (nuevo: bigint, contando: boolean): void => {
      if (ocupado || enDuda || hecho) return;
      cuanto = nuevo;
      enContador = contando;
      cargarPorMensaje = false;
      decir(null);
      pintarSola();
    };
    menos.addEventListener("click", () => cambiarMonto(deAUnDolarSolo(cuanto, -1, saldo), true));
    mas.addEventListener("click", () => cambiarMonto(deAUnDolarSolo(cuanto, 1, saldo), true));
    otroMonto.addEventListener("click", () => cambiarMonto(arranqueDelContador(fijo, saldo), true));
    cargar.addEventListener("click", () => {
      abrirCarga?.(cuentaSola, () => {
        // Al volver de cargar, lo que se dijo antes de cargar ya no vale: se vuelve a leer el saldo.
        cargarPorMensaje = false;
        if (!enDuda && !hecho) decir(null);
        void leerSaldo();
      });
    });

    avisar.addEventListener("click", async () => {
      const texto = tx("pgAviso", { monto: montoAviso, cuenta: fila.cuenta });
      if (await copiar(texto)) {
        decir("pgAvisoCopiado");
        manual.hidden = true;
      } else {
        decir("pgAvisoManual");
        manual.value = texto;
        manual.hidden = false;
        manual.select();
      }
    });
    copiarXdr.addEventListener("click", async () => {
      if (await copiar(xdr.value)) copiarXdr.textContent = tx("pgCopiado");
      else xdr.select();
    });

    /** Paga el premio. Con `fuera`, arma el pago para aprobarlo en otra billetera en vez de pagarlo con la cuenta que paga sola. */
    const pagarAhora = async (fuera: boolean): Promise<void> => {
      // Un toque doble, un Enter con el botón en pausa o un premio ya pagado no arman otro pago.
      if (ocupado || enDuda || hecho) return;
      // Un pago de este premio con la cuenta que todavía puede entrar: no se arma otro para pagarlo desde otra billetera.
      if (fuera && enCamino()) {
        decir("pgGoogleDuda", {}, true);
        pintarSola();
        return;
      }
      const eraDeLaCuenta = solo !== null;
      ocupado = true;
      pagar.disabled = true;
      avisar.hidden = true;
      manual.hidden = true;
      afuera.hidden = true;
      enlace.hidden = true;
      cargarPorMensaje = false;
      progreso = null;
      pintarSola();
      try {
        const deps = await preparar();
        // El formulario pasó a ser el de la cuenta que paga sola mientras se tocaba: lo que la persona vio no era esto. No se paga nada.
        if (deps.billetera?.mandaSola && !eraDeLaCuenta) {
          decir(null);
          return;
        }
        const conLaCuenta = solo !== null && !fuera;
        // Con la cuenta que paga sola, la cuenta de quien ganó se relee de la lista sellada y tiene que ser la que se ve en la
        // fila. Si no se puede asegurar, no se arma ni se paga nada.
        let destino = fila.cuenta;
        if (conLaCuenta) {
          const sellado = ctx.destinoDe?.(fila.puesto) ?? null;
          if (sellado === null || sellado !== fila.cuenta) {
            progreso = null;
            decir("pgGoogleNoSalio", {}, true);
            return;
          }
          destino = sellado;
        }
        const montoTexto = solo !== null ? montoEnTexto(cuanto) : monto.value;
        const r = await pagarUnPremio(
          {
            ...deps,
            alAvanzar: (paso) => {
              progreso = claveDelPaso(paso, conLaCuenta);
              dicho = null;
              msg.classList.remove("bad");
              escribir(tx(progreso), "espera");
            },
          },
          {
            red: ctx.red,
            raffleId: ctx.raffleId,
            puesto: fila.puesto,
            destino,
            activo: ctx.activo,
            monto: montoTexto,
            desde: ctx.desde,
            pagadoras: [...ctx.pagadoras],
            ...(fuera ? { afuera: true } : {}),
            ...(cuenta.value.trim() ? { cuentaQuePaga: cuenta.value.trim() } : {}),
          },
        );
        progreso = null;
        montoAviso = montoParaLeer(montoTexto);
        const contexto = { quien: fila.nombre, red: ctx.red, monto: montoTexto, google: conLaCuenta };
        const m = mensajeDe(r, contexto);
        if (conLaCuenta && r.tipo === "no-se-puede" && r.motivo === "origen-sin-saldo" && r.saldo !== undefined) {
          // La red dice que no alcanza: el formulario lo muestra con lo que falta y el botón de cargar.
          saldo = stroopsDe(r.saldo);
          decir(null);
        } else {
          cargarPorMensaje = m.cargar;
          decir(m.clave, m.vars, m.error, () => mensajeDe(r, contexto).vars);
        }
        avisar.hidden = !m.avisar;
        if (r.tipo === "afuera" && solo !== null && enCamino()) {
          // Mientras se armaba, un pago de este premio con la cuenta empezó (en otra pestaña): no se muestra el de afuera.
          decir("pgGoogleDuda", {}, true);
        } else if (r.tipo === "afuera") {
          // El panel reconoce el pago de esa cuenta cuando se haga.
          ctx.pagadoras.add(r.origen);
          if (solo !== null) decir("pgGoogleAfuera");
          xdr.value = r.xdr;
          afuera.hidden = false;
          afuera.open = true;
        } else if (r.tipo === "listo" || r.tipo === "ya-pagado") {
          terminarPagado(r.hash, r.origen, r.tipo === "ya-pagado");
        } else if (r.tipo === "sin-respuesta") {
          enDuda = { deps, busqueda: r.busqueda, google: conLaCuenta };
          alTerminar();
          reloj = setTimeout(() => void mirarDuda(), ctx.esperaMs ?? 6_000);
        }
      } finally {
        ocupado = false;
        pintarSola();
        pintarAcciones();
      }
    };
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void pagarAhora(false);
    });
    armarAfuera.addEventListener("click", () => void pagarAhora(true));
    // En «Pagar desde otra billetera», Enter arma el pago de esa cuenta: no paga con la cuenta que paga sola.
    cuenta.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || solo === null) return;
      e.preventDefault();
      void pagarAhora(true);
    });
  };
  /**
   * Si el pago de ese premio está sin confirmar: quedó en duda en esta página, o hay uno de ese premio con la cuenta que
   * todavía puede entrar (de otra pestaña o de antes de recargar). Solo mira: no arma, no firma ni manda nada.
   */
  manejador.sinConfirmar = async (fila) => {
    if (guardados.get(fila.puesto)?.enDuda()) return true;
    // Sin pagar con Google en la red principal no hay marca que mirar: no se carga la billetera para saberlo.
    if (!ctx.dependencias && (ctx.red !== "mainnet" || !pagarConGoogle())) return false;
    let billetera: Billetera | null;
    try {
      billetera = ctx.dependencias ? (await ctx.dependencias()).billetera : await billeteraActiva();
    } catch {
      return false;
    }
    const lector = billetera?.mandaSola;
    if (lector?.enCamino === undefined) return false;
    try {
      return lector.enCamino(fila.nota);
    } catch {
      // Sin poder saberlo cuenta como que sí, igual que en el formulario.
      return true;
    }
  };
  return manejador;
}

/**
 * Abre «Tus dólares digitales» directo en la dirección para cargar. `alCerrar` avisa cuando se cierra. Con `falta` (el
 * monto ya escrito) la ventana dice cuánto mandar. Mira sola si llegó, sin esperar a que toquen Ya lo mandé.
 */
export function cargarEnSaldo(cuenta: string, alCerrar: () => void, falta?: string): void {
  void import("./saldo").then((m) =>
    m.abrirSaldo({ address: cuenta }, {}, { vista: "traer", alCerrar, vigilar: true, ...(falta ? { falta } : {}) }),
  );
}

/** Las dependencias de verdad: la red de Stellar y la billetera activa. */
async function dependenciasReales(): Promise<Dependencias> {
  return {
    buscar: (b) => buscarPago(b),
    preparar: (d) => prepararPago(d),
    mandar: (red, xdr) => mandarPago(red, xdr),
    billetera: await billeteraActiva(),
    cargar: cargarEnSaldo,
  };
}
