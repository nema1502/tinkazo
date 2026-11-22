/**
 * Activar una campaña al pagar: la sala firma el archivo de una campaña con una segunda llave (automática) cuando comprueba en
 * la red que la comisión del evento se pagó desde la cuenta de Google de quien organiza. Es lo que permite que cualquier
 * cuenta arme su campaña sin que nadie de Tinkazo firme a mano. La llave de siempre sigue valiendo igual.
 *
 * Esta parte no depende de Cloudflare: la usan `index.ts` y las pruebas en Node. Lee la red (Horizon, solo lectura, sin llave)
 * y nunca firma con la duda: si Horizon no contesta, o hay más pagos de los que se alcanzan a mirar, contesta 502 y no firma.
 * Los topes diarios por cuenta guardan una huella con sal del día. La lista de Tus campañas guarda la cuenta en claro junto con el
 * texto firmado de su campaña, hasta 30 días después del sorteo (ver `activar-cupos.ts`).
 */
import {
  CENTAVO,
  DOLAR,
  comisionDe,
  notaDeLaComision,
  umbralPagado,
} from "../../../src/campana/comision";
import { reglaQueFalla } from "../../../src/campana/reglas-de-activar";
import { leerMinimo, leerPb, minimoPosible } from "../../../src/stellar/comision-config";
import { leerElCosto, leerLaCuenta } from "../../../src/stellar/retiro-config";
import { formaDeToken } from "../../patrocinio/src/pollar";
import type { Pollar } from "../../patrocinio/src/pollar";
import type { AntesDeActivar, CampanaParaGuardar, TipoDeTope } from "./activar-cupos";
import { leerDatosDeLista, leerTextoDeCampana, viaPermitida } from "./campana";
import type { LecturaDeLista } from "./campana";
import { firmarConLlaveAuto, llavePublicaAuto } from "./firma";
import type { VariablesDeLlaveAuto } from "./firma";

/** Lo más que pesa el pedido de activación: el texto de la campaña y la sesión de quien organiza. */
export const MAX_CUERPO_ACTIVAR = 24_000;
/** Campañas distintas que una misma cuenta verificada puede activar por día (repetir el mismo evento no suma). */
export const ACTIVACIONES_POR_DIA = 5;
/** Pedidos de activación por conexión y por ventana de 10 minutos: cada uno cuesta una mirada a la red. */
export const ACTIVAR_POR_CONEXION = 60;
/**
 * Pedidos de las rutas de Tus campañas (listar y usar en otra compu) por conexión y por ventana de 10 minutos, en un grupo
 * propio que no gasta el de activar. Alcanza para un recinto con 20 empresas y 3 compus cada una, con un listado, una toma y
 * dos reintentos por compu (240).
 */
export const CUENTA_POR_CONEXION = 300;
/** Listados y tomas por cuenta y por ventana de 10 minutos, contados después de verificar la sesión. */
export const LISTADOS_POR_CUENTA = 30;
export const TOMAS_POR_CUENTA = 10;
/** El emisor del dólar digital de Circle (USDC) en la red principal. Una prueba lo compara con el del sitio. */
export const EMISOR_USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** Horizon de la red principal: se lee sin llave y sin guardar nada. */
export const HORIZON_PRINCIPAL = "https://horizon.stellar.org";
/** Cuánto espera cada pedido a la red, y lo más que se lee de cada respuesta. */
export const ESPERA_RED_MS = 8_000;
export const MAX_RESPUESTA_RED = 1_000_000;
/** Páginas de pagos que se miran como mucho, y pagos por página (el máximo de Horizon). */
export const PAGINAS_DE_PAGOS = 3;
export const PAGOS_POR_PAGINA = 200;
/** Lo más corto que puede ser el secreto compartido con el portero: el mismo mínimo que exige el portero. */
export const SALA_SECRETO_MINIMO = 32;
/** Hasta cuándo atrás cuenta un pago de la comisión. */
export const DIAS_DEL_PAGO = 30;

/** Las variables del Worker que prenden y configuran la activación al pagar. */
export interface VariablesDeActivar {
  /** Solo con "1" la activación está prendida. */
  ACTIVAR_AL_PAGAR?: string;
  /** Los puntos básicos del total de los premios que cobra Tinkazo (200 es el 2 %). */
  COMISION_PB?: string;
  /** Lo menos que se cobra, en dólares digitales. */
  COMISION_MINIMO?: string;
  /** El costo fijo del retiro por el que viaja el cobro, en dólares digitales. */
  COSTO_RETIRO?: string;
  /** La cuenta de Tinkazo que recibe la comisión. */
  COMISION_CUENTA?: string;
  /** La dirección del portero, que le da acceso a quien organiza. */
  PORTERO_URL?: string;
  /** El secreto compartido con el portero. Se carga con `wrangler secret put`, nunca en el archivo. */
  SALA_SECRETO?: string;
}

/** Lo que se cobra y a quién, ya leído y comprobado. */
export interface ConfigDeActivar {
  pb: bigint;
  minimo: bigint;
  costo: bigint;
  cuenta: string;
  portero: string;
}

/**
 * La configuración de la activación, o null si está apagada o mal puesta. Usa los mismos lectores que el sitio: los números
 * valen lo mismo en los dos lados. Una variable fuera de forma deja todo apagado: nunca se cobra ni se firma con un monto dudoso.
 */
export function configDeActivar(env: VariablesDeActivar): ConfigDeActivar | null {
  if (env.ACTIVAR_AL_PAGAR !== "1") return null;
  const pb = leerPb(env.COMISION_PB);
  const minimo = leerMinimo(env.COMISION_MINIMO);
  const costo = leerElCosto(env.COSTO_RETIRO);
  const cuenta = leerLaCuenta(env.COMISION_CUENTA);
  if (pb.tipo !== "valido" || minimo.tipo !== "valido" || costo.tipo !== "valido" || cuenta.tipo !== "valida") return null;
  if (costo.stroops === 0n || minimo.valor < minimoPosible(costo.stroops)) return null;
  const portero = (env.PORTERO_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(portero)) return null;
  return { pb: pb.valor, minimo: minimo.valor, costo: costo.stroops, cuenta: cuenta.cuenta, portero };
}

/** Las reglas de la campaña que se activa sola viven en el sitio: el panel las mira antes de cobrar con el mismo archivo. */
export { DIAS_PARA_CERRAR, nombreImita } from "../../../src/campana/reglas-de-activar";

/** Una campaña que se puede activar: el texto compacto que se firma y lo que se necesita para cobrarla. */
export interface CampanaParaActivar {
  /** El JSON compacto (sin espacios) que se firma, tal como lo normaliza el firmador de Tinkazo. */
  compacto: string;
  evento: string;
  organizadora: string;
  premios: bigint[];
  cierraMs: number;
  sorteoMs: number;
  /** Lo que Tus campañas necesita del texto. Si falta algo, la campaña se firma igual y solo no aparece en la lista. */
  lista: LecturaDeLista;
}

export type LecturaParaActivar =
  | ({ ok: true } & CampanaParaActivar)
  | { ok: false; error: "forma" | "red"; campo: string };

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/**
 * Lee el texto de una campaña que se quiere activar sola. Además del lector de la sala (el mismo que corre al crear), exige: red
 * principal, entrada con Google, abierta, sin anotadas ni contrato, promo o comprobante, de 1 a 10 premios del mismo monto
 * (cada uno de 1 a 10.000 dólares digitales en centavos justos), cierre dentro de los próximos 7 días, sorteo hasta un día después
 * del cierre, la cuenta de quien organiza escrita y un nombre de empresa que no imita a Tinkazo. `campo` dice cuál no sirvió.
 */
export function leerParaActivar(texto: string, ahora: number): LecturaParaActivar {
  const forma = (campo: string): LecturaParaActivar => ({ ok: false, error: "forma", campo });
  const base = leerTextoDeCampana(texto, ahora);
  if (!base.ok) return forma(base.campo);
  if (base.red !== "mainnet") return { ok: false, error: "red", campo: "red" };
  const c = JSON.parse(texto) as unknown;
  if (!esObjeto(c)) return forma("texto");
  if (c.entrada !== "google") return forma("entrada");
  if (c.estado !== "abierta") return forma("estado");
  if (c.anotadas !== 0) return forma("anotadas");
  if (c.contrato !== null) return forma("contrato");
  if (c.promo !== null) return forma("promo");
  if (c.comprobante !== null) return forma("comprobante");
  const organizadora = base.organizadora;
  if (organizadora === null) return forma("organizadora");
  const premios = Array.isArray(c.premios) ? (c.premios as unknown[]) : [];
  const montos: bigint[] = [];
  for (const premio of premios) {
    // El lector de la sala ya exigió cifras: acá solo se pasan a números.
    if (typeof premio !== "string") return forma("premios");
    montos.push(BigInt(premio));
  }
  const empresa = c.empresa;
  const nombre = esObjeto(empresa) ? empresa.nombre : null;
  const falla = reglaQueFalla({ premios: montos, cierraMs: base.cierraMs, sorteoMs: base.sorteoMs, nombre }, ahora);
  if (falla !== null) return forma(falla);
  const compacto = JSON.stringify(c);
  return {
    ok: true,
    compacto,
    evento: base.evento,
    organizadora,
    premios: montos,
    cierraMs: base.cierraMs,
    sorteoMs: base.sorteoMs,
    lista: leerDatosDeLista(compacto),
  };
}

/* ---------------------------------------------------------------- la mirada a la red */

type Pedir = typeof fetch;
const ES_MONTO = /^\d{1,13}(\.\d{1,7})?$/;
const ES_HORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const ES_FICHA = /^\d{1,30}$/;
const ES_NOTA = /^\d{1,20}$/;

const stroopsDe = (monto: string): bigint => {
  const [enteros = "0", decimales = ""] = monto.split(".");
  return BigInt(enteros) * DOLAR + BigInt(decimales.padEnd(7, "0"));
};

/** Un JSON de Horizon: `null` si no contesta, no se entiende o pasa del tope; `"no-existe"` con un 404. Nunca lanza. */
async function leerHorizon(f: Pedir, ruta: string): Promise<unknown> {
  try {
    const r = await f(`${HORIZON_PRINCIPAL}${ruta}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(ESPERA_RED_MS) });
    if (r.status === 404) return "no-existe";
    if (!r.ok) return null;
    const largo = Number(r.headers.get("content-length") ?? "0");
    if (Number.isFinite(largo) && largo > MAX_RESPUESTA_RED) return null;
    const texto = await r.text();
    if (texto.length > MAX_RESPUESTA_RED) return null;
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

/** Los segundos Unix de un instante de Horizon, o null si no tiene la forma. */
function horaDe(x: unknown): number | null {
  if (typeof x !== "string" || !ES_HORA.test(x)) return null;
  const s = Math.floor(Date.parse(x) / 1000);
  return Number.isSafeInteger(s) && s > 0 ? s : null;
}

/** Lo que un registro de pagos aporta a la comisión, o null si no cuenta. Solo cuenta lo que sale de la cuenta de quien organiza. */
function aporteDelPago(rec: Record<string, unknown>, b: BusquedaDeComision): bigint | null {
  if (rec.type !== "payment" && rec.type !== "path_payment_strict_send" && rec.type !== "path_payment_strict_receive") return null;
  const tx = rec.transaction;
  if (rec.transaction_successful === false || !esObjeto(tx) || tx.successful === false) return null;
  if (rec.to !== b.cuenta || rec.from !== b.origen || rec.asset_type !== "credit_alphanum4") return null;
  if (rec.asset_code !== "USDC" || rec.asset_issuer !== EMISOR_USDC) return null;
  // La nota tiene que ser un número (memo `id`): una nota de texto no cuenta, aunque diga el mismo número.
  const memo = tx.memo;
  if (tx.memo_type !== "id" || typeof memo !== "string" || !ES_NOTA.test(memo) || BigInt(memo) !== BigInt(b.nota)) return null;
  const monto = rec.amount;
  if (typeof monto !== "string" || !ES_MONTO.test(monto)) return null;
  const stroops = stroopsDe(monto);
  return stroops >= CENTAVO ? stroops : null;
}

export interface BusquedaDeComision {
  /** La cuenta de Tinkazo que recibe la comisión. */
  cuenta: string;
  /** La cuenta de quien organiza: el pago tiene que salir de ella. */
  origen: string;
  /** La nota numérica del evento. */
  nota: string;
  /** Lo que alcanza para dar la comisión por pagada. */
  umbral: bigint;
  /** Los pagos anteriores a este instante (segundos Unix) no cuentan. */
  desdeS: number;
}

export type LecturaDelPago = { tipo: "ok"; suma: bigint } | { tipo: "red" };

/**
 * Suma lo que recibió la cuenta de Tinkazo desde la de quien organiza, con la nota del evento, en los últimos 30 días. Se
 * miran los pagos de la cuenta de quien organiza y no los de la cuenta de Tinkazo: todo pago que sale de ella está en su
 * historia, y la de Tinkazo la puede llenar cualquiera con pagos chicos hasta dejar el de una empresa fuera de las páginas que
 * se miran. Mira hasta 3 páginas de 200, de lo más nuevo a lo más viejo. Corta apenas la suma llega al umbral (ya está pagada).
 * Si Horizon no contesta, contesta algo raro o quedan páginas sin mirar sin haber llegado al umbral, es `red`: no se firma
 * con la duda. Una cuenta que no existe no mandó nada.
 */
export async function sumarLaComision(f: Pedir, b: BusquedaDeComision): Promise<LecturaDelPago> {
  let suma = 0n;
  let cursor = "";
  for (let pagina = 0; pagina < PAGINAS_DE_PAGOS; pagina++) {
    const ruta =
      `/accounts/${encodeURIComponent(b.origen)}/payments?join=transactions&order=desc&limit=${PAGOS_POR_PAGINA}` +
      `&include_failed=false${cursor ? `&cursor=${cursor}` : ""}`;
    const json = await leerHorizon(f, ruta);
    if (json === "no-existe" && pagina === 0) return { tipo: "ok", suma };
    if (!esObjeto(json) || !esObjeto(json._embedded) || !Array.isArray(json._embedded.records)) return { tipo: "red" };
    const registros = json._embedded.records as unknown[];
    for (const rec of registros) {
      if (!esObjeto(rec)) continue;
      const creado = horaDe(rec.created_at);
      // Un registro sin fecha no se puede ubicar: no cuenta, pero tampoco corta la mirada.
      if (creado === null) continue;
      if (creado < b.desdeS) return { tipo: "ok", suma };
      const aporte = aporteDelPago(rec, b);
      if (aporte !== null) suma += aporte;
      if (suma >= b.umbral) return { tipo: "ok", suma };
    }
    if (registros.length < PAGOS_POR_PAGINA) return { tipo: "ok", suma };
    const ultimo = registros[registros.length - 1];
    const ficha = esObjeto(ultimo) ? ultimo.paging_token : undefined;
    if (typeof ficha !== "string" || !ES_FICHA.test(ficha)) return { tipo: "red" };
    cursor = ficha;
  }
  // Quedaron páginas sin mirar y la suma no llegó: no se puede decir que no está pagada, ni darla por pagada.
  return { tipo: "red" };
}

export type LecturaDelSaldo = { tipo: "ok"; saldo: bigint } | { tipo: "red" };

/** El saldo de dólares digitales de Circle de una cuenta. Una cuenta que no existe tiene cero. */
export async function saldoDeDolares(f: Pedir, cuenta: string): Promise<LecturaDelSaldo> {
  const json = await leerHorizon(f, `/accounts/${encodeURIComponent(cuenta)}`);
  if (json === "no-existe") return { tipo: "ok", saldo: 0n };
  if (!esObjeto(json) || !Array.isArray(json.balances)) return { tipo: "red" };
  for (const linea of json.balances as unknown[]) {
    if (!esObjeto(linea) || linea.asset_type !== "credit_alphanum4") continue;
    if (linea.asset_code !== "USDC" || linea.asset_issuer !== EMISOR_USDC) continue;
    if (typeof linea.balance !== "string" || !ES_MONTO.test(linea.balance)) return { tipo: "red" };
    return { tipo: "ok", saldo: stroopsDe(linea.balance) };
  }
  return { tipo: "ok", saldo: 0n };
}

/** Lo que dijo el portero al pedirle acceso: dado, el tope del día lleno (con cuántos segundos faltan) o cualquier otra cosa. */
export type AccesoDelPortero = { tipo: "dado" } | { tipo: "cupo"; esperaS: number } | { tipo: "no" };

/** Lo más que se le dice a quien organiza que espere por el tope del día del portero: el día entero. */
const ESPERA_MAXIMA_S = 86_400;

/**
 * Le pide al portero que le dé acceso a quien organiza. Es idempotente: repetir el mismo pedido es inofensivo. Con cualquier
 * cosa que no sea un 200 (no contesta, rechaza, tarda de más) no hay acceso y la sala no firma. Un 429 con su hora es el tope
 * del día del portero: se devuelve aparte para que el panel diga que espere, y no que pruebe de nuevo enseguida.
 */
export async function darAcceso(
  f: Pedir,
  o: { portero: string; secreto: string; cuenta: string; evento: string; ahora: number },
): Promise<AccesoDelPortero> {
  try {
    const r = await f(`${o.portero}/v1/alta/organizadora`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sala-secreto": o.secreto },
      body: JSON.stringify({ cuenta: o.cuenta, evento: o.evento }),
      signal: AbortSignal.timeout(ESPERA_RED_MS),
    });
    if (r.status === 200) return { tipo: "dado" };
    if (r.status !== 429) return { tipo: "no" };
    const x = (await r.json().catch(() => null)) as unknown;
    const libera = esObjeto(x) ? x.liberaEn : undefined;
    const faltaS = typeof libera === "number" && Number.isFinite(libera) ? Math.ceil((libera - o.ahora) / 1000) : ESPERA_MAXIMA_S;
    return { tipo: "cupo", esperaS: Math.min(Math.max(faltaS, 60), ESPERA_MAXIMA_S) };
  } catch {
    return { tipo: "no" };
  }
}

/** Cuánto se recuerda que el portero atiende a la sala, para no preguntarle en cada consulta del panel. */
export const MEMORIA_DEL_PORTERO_MS = 60_000;
let porteroAtiendeHasta: { portero: string; hasta: number } | null = null;

/**
 * Si el portero atiende a la sala con su secreto, sin escribir nada: se le manda un cuerpo vacío y, con el secreto bien y la
 * ruta prendida, contesta 400 forma. Apagada contesta 503, con otro secreto 401, y el portero de antes no tiene la ruta (404).
 * Solo se recuerda que sí, por un minuto: un arreglo se nota enseguida.
 */
export async function porteroAtiende(f: Pedir, o: { portero: string; secreto: string; ahora: number }): Promise<boolean> {
  const visto = porteroAtiendeHasta;
  if (visto !== null && visto.portero === o.portero && visto.hasta > o.ahora) return true;
  porteroAtiendeHasta = null;
  try {
    const r = await f(`${o.portero}/v1/alta/organizadora`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sala-secreto": o.secreto },
      body: "{}",
      signal: AbortSignal.timeout(ESPERA_RED_MS),
    });
    const x = (await r.json().catch(() => null)) as unknown;
    const atiende = r.status === 400 && esObjeto(x) && x.motivo === "forma";
    if (atiende) porteroAtiendeHasta = { portero: o.portero, hasta: o.ahora + MEMORIA_DEL_PORTERO_MS };
    return atiende;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- el pedido entero */

/** Lo que `POST /v1/activar` le pide a los topes por conexión y por cuenta (viven en el objeto `Cupos`). */
export interface TopesDeActivar {
  antes(ip: string, ficha: string): Promise<AntesDeActivar>;
  rechazo(ip: string, ficha: string): Promise<void>;
  cuenta(cuenta: string, evento: string): Promise<{ ok: true } | { ok: false; esperaS: number }>;
  anotar(cuenta: string, evento: string): Promise<void>;
  /** Toma la nota de la comisión para este evento: `false` si ya es de otro evento (ver `tomarNota`). */
  nota(nota: string, evento: string): Promise<boolean>;
  /** Si este evento no tiene otra dueña. Antes de esto se mira, si hace falta, las salas anteriores a la dueña. */
  eventoLibre(cuenta: string, evento: string): Promise<boolean>;
  /** Guarda la campaña de la cuenta para Tus campañas. Dice `ajeno` si el evento ya es de otra cuenta. */
  guardarCampana(campana: Omit<CampanaParaGuardar, "ahora">): Promise<{ ok: true } | { ok: false; motivo: "ajeno" }>;
}

export interface DepsDeActivar {
  env: VariablesDeActivar & VariablesDeLlaveAuto & { SOLO_GOOGLE?: string };
  ahora: number;
  ip: string;
  f: Pedir;
  /** El proveedor de cuentas de la sala (el mismo del alta), o null si no está configurado. */
  proveedor: Pick<Pollar, "verificar" | "billeteraDe"> | null;
  topes: TopesDeActivar;
  /** Deja un código fijo en el registro: nunca una cuenta, una sesión ni un nombre. */
  registrar?: (evento: string, datos?: Record<string, string | number>) => void;
}

/** Lo que contesta la activación: el estado, el cuerpo y, en un 429, cuánto esperar. */
export interface RespuestaDeActivar {
  estado: number;
  cuerpo: Record<string, unknown>;
  esperaS?: number;
}

const error = (estado: number, codigo: string, extra: Record<string, unknown> = {}): RespuestaDeActivar => ({
  estado,
  cuerpo: { error: codigo, ...extra },
});

/** Lo que hace falta para saber quién es quien organiza: la conexión, el proveedor de cuentas y los topes de antes y de rechazos. */
export interface DepsDeVerificar {
  ip: string;
  /** El proveedor de cuentas de la sala (el mismo del alta), o null si no está configurado. */
  proveedor: Pick<Pollar, "verificar" | "billeteraDe"> | null;
  topes: { antes: TopesDeActivar["antes"]; rechazo: TopesDeActivar["rechazo"] };
}

/**
 * Quién es la cuenta de esta sesión: `cuenta` es null si la sesión no trae cuenta y el proveedor no tiene una billetera para
 * ella. Quien llama decide qué responder en ese caso, porque no es lo mismo al activar que al listar.
 */
export type QuienOrganiza = { ok: true; cuenta: string | null } | { ok: false; respuesta: RespuestaDeActivar };

/**
 * Verifica la sesión de quien organiza, en el orden en que cuesta menos: los topes de la conexión y de la ficha antes de llamar
 * a nadie, el proveedor configurado (503 sin-pollar), la sesión (502 red si el proveedor falla, 401 sesion y un rechazo
 * contado si no la reconoce), solo Google y siempre en modo estricto (403 no-google y un rechazo) y, por último, la cuenta de la
 * sesión o la billetera del usuario (502 red si el proveedor falla). La cuenta sale siempre del proveedor, nunca del pedido.
 */
export async function verificarQuienOrganiza(sesion: string, d: DepsDeVerificar): Promise<QuienOrganiza> {
  // Antes de llamar al proveedor: los topes de rechazos y de pedidos de esta conexión y de esta sesión.
  const antes = await d.topes.antes(d.ip, sesion);
  if (!antes.ok) return { ok: false, respuesta: { ...error(429, antes.motivo), esperaS: antes.esperaS } };
  if (d.proveedor === null) return { ok: false, respuesta: error(503, "sin-pollar") };
  const verificada = await d.proveedor.verificar(sesion);
  if (!verificada.ok) {
    if (verificada.motivo === "pollar") return { ok: false, respuesta: error(502, "red") };
    await d.topes.rechazo(d.ip, sesion);
    return { ok: false, respuesta: error(401, "sesion") };
  }
  // Solo Google y siempre en modo estricto, aunque la lista de la sala esté en modo suave: una sesión que no dice por dónde
  // entró no firma campañas ni recibe acceso en el portero.
  const via = viaPermitida(verificada.via, "estricto");
  if (!via.ok) {
    await d.topes.rechazo(d.ip, sesion);
    return { ok: false, respuesta: error(403, "no-google") };
  }
  let cuenta = verificada.cuenta;
  if (cuenta === null) {
    const billetera = await d.proveedor.billeteraDe(verificada.usuario);
    if (!billetera.ok) return { ok: false, respuesta: error(502, "red") };
    cuenta = billetera.cuenta;
  }
  return { ok: true, cuenta };
}

/** Los topes propios de las rutas de Tus campañas (viven en el objeto `Cupos`). */
export interface TopesDeCuenta {
  /** Rechazos de la conexión y de la ficha, y el ritmo del grupo propio de la conexión (una sesión conocida no lo suma). */
  antes(ip: string, ficha: string, conocida: boolean): Promise<AntesDeActivar>;
  /** Una sesión que el proveedor rechazó: las mismas tablas de rechazos que usa activar. */
  rechazo(ip: string, ficha: string): Promise<void>;
  /** Los listados y las tomas por cuenta, ya verificada la sesión. */
  tope(cuenta: string, tipo: TipoDeTope): Promise<{ ok: true } | { ok: false; esperaS: number }>;
}

export interface DepsDeCuenta {
  ip: string;
  ahora: number;
  proveedor: Pick<Pollar, "verificar" | "billeteraDe" | "conocida"> | null;
  topes: TopesDeCuenta;
}

/**
 * La cuenta de quien pide listar o usar una campaña en otra compu. Es la verificación de activar con tres cosas más, en este
 * orden: sin forma de token no se cuenta nada ni se llama a nadie (401 sesion), el ritmo de la conexión tiene su grupo propio y
 * una sesión que el proveedor ya dio por buena no lo suma, y después de verificar hay un tope por cuenta (429 cupo-cuenta).
 * Sin cuenta, 409 sin-billetera. Una cuenta sin campañas y una que nunca existió reciben lo mismo: eso lo decide quien llama.
 */
export async function verificarCuentaDeCampanas(
  sesion: unknown,
  tipo: TipoDeTope,
  d: DepsDeCuenta,
): Promise<{ ok: true; cuenta: string } | { ok: false; respuesta: RespuestaDeActivar }> {
  if (typeof sesion !== "string" || !formaDeToken(sesion, d.ahora)) return { ok: false, respuesta: error(401, "sesion") };
  if (d.proveedor === null) return { ok: false, respuesta: error(503, "sin-pollar") };
  const conocida = await d.proveedor.conocida(sesion);
  const quien = await verificarQuienOrganiza(sesion, {
    ip: d.ip,
    proveedor: d.proveedor,
    topes: { antes: (ip, ficha) => d.topes.antes(ip, ficha, conocida), rechazo: (ip, ficha) => d.topes.rechazo(ip, ficha) },
  });
  if (!quien.ok) return quien;
  if (quien.cuenta === null) return { ok: false, respuesta: error(409, "sin-billetera") };
  const cupo = await d.topes.tope(quien.cuenta, tipo);
  if (!cupo.ok) return { ok: false, respuesta: { ...error(429, "cupo-cuenta"), esperaS: cupo.esperaS } };
  return { ok: true, cuenta: quien.cuenta };
}

/**
 * Activa una campaña: comprueba la sesión, el texto, el pago de la comisión y los fondos, le da acceso a quien organiza en el
 * portero y recién entonces firma. El orden va del más barato al más caro, y nada se firma si algún paso duda.
 */
export async function activarCampana(cuerpo: unknown, d: DepsDeActivar): Promise<RespuestaDeActivar> {
  const config = configDeActivar(d.env);
  if (config === null) return error(503, "apagada");
  if (llavePublicaAuto(d.env) === null) return error(503, "sin-llave");
  const secreto = d.env.SALA_SECRETO;
  // Sin el secreto compartido no hay forma de darle acceso a quien organiza: tampoco se firma. El mismo largo mínimo que el
  // portero: con uno más corto el portero no atiende y cada activación terminaría en un 502 después de mirar la red.
  if (typeof secreto !== "string" || secreto.length < SALA_SECRETO_MINIMO) return error(503, "sin-llave");
  if (!esObjeto(cuerpo)) return error(400, "forma", { campo: "cuerpo" });
  const { texto, sesion } = cuerpo;
  if (texto === undefined && sesion === undefined) {
    // La pregunta del panel antes de cobrar, con el cuerpo vacío: si la sala y el portero están listos contesta 400 forma,
    // como cualquier cuerpo sin texto. Si el portero no la atiende, 503 sin-portero, y el panel no ofrece pagar.
    if (!(await porteroAtiende(d.f, { portero: config.portero, secreto, ahora: d.ahora }))) return error(503, "sin-portero");
    return error(400, "forma", { campo: "texto" });
  }
  if (typeof texto !== "string") return error(400, "forma", { campo: "texto" });
  if (typeof sesion !== "string") return error(400, "forma", { campo: "sesion" });
  const campana = leerParaActivar(texto, d.ahora);
  if (!campana.ok) return error(400, campana.error, { campo: campana.campo });

  // La sesión de quien organiza: topes, proveedor, vía de Google y cuenta, en este orden y con las mismas respuestas de siempre.
  const quien = await verificarQuienOrganiza(sesion, d);
  if (!quien.ok) return quien.respuesta;
  const cuenta = quien.cuenta;
  if (cuenta === null || cuenta !== campana.organizadora) return error(403, "organizadora");

  // Un evento tiene una sola dueña: si ya es de otra cuenta, ni se mira la red. Con la misma respuesta aunque la sala no exista.
  if (!(await d.topes.eventoLibre(cuenta, campana.evento))) return error(409, "evento-ajeno");

  const cupo = await d.topes.cuenta(cuenta, campana.evento);
  if (!cupo.ok) return { ...error(429, "cupo-cuenta"), esperaS: cupo.esperaS };

  // La comisión de este texto y su nota, con las mismas funciones que el panel.
  const comision = comisionDe(campana.premios, config.pb, config.minimo);
  const umbral = umbralPagado(comision, config.costo);
  const nota = notaDeLaComision(campana.evento);
  const pagos = await sumarLaComision(d.f, {
    cuenta: config.cuenta,
    origen: cuenta,
    nota,
    umbral,
    desdeS: Math.floor(d.ahora / 1000) - DIAS_DEL_PAGO * 86_400,
  });
  if (pagos.tipo === "red") return error(502, "red");
  if (pagos.suma < umbral) return error(402, "no-pagada", { falta: (umbral - pagos.suma).toString(), nota });

  // Los premios que se van a pagar tienen que estar en la cuenta.
  const saldo = await saldoDeDolares(d.f, cuenta);
  if (saldo.tipo === "red") return error(502, "red");
  const premios = campana.premios.reduce((a, p) => a + p, 0n);
  if (saldo.saldo < premios) return error(402, "sin-fondos", { falta: (premios - saldo.saldo).toString() });

  // Un pago sirve a un solo evento: si otro evento con la misma nota ya se activó con ella, para este no hay pago.
  if (!(await d.topes.nota(nota, campana.evento))) return error(402, "no-pagada", { falta: umbral.toString(), nota });

  const acceso = await darAcceso(d.f, { portero: config.portero, secreto, cuenta, evento: campana.evento, ahora: d.ahora });
  if (acceso.tipo === "cupo") return { ...error(429, "cupo-portero"), esperaS: acceso.esperaS };
  if (acceso.tipo !== "dado") return error(502, "acceso");

  const firma = firmarConLlaveAuto(d.env, campana.compacto);
  if (firma === null) return error(503, "sin-llave");
  // La campaña queda guardada para Tus campañas. Si el texto no trae algo de lo que la lista necesita, se firma igual y solo no
  // aparece en ella. Si la escritura falla, el panel reintenta: activar de nuevo es gratis.
  if (campana.lista.ok) {
    let guardada: { ok: true } | { ok: false; motivo: "ajeno" } | null = null;
    try {
      guardada = await d.topes.guardarCampana({
        cuenta,
        evento: campana.evento,
        texto: campana.compacto,
        firma,
        empresa: campana.lista.empresa,
        zona: campana.lista.zona,
        abreMs: campana.lista.abreMs,
        cierraMs: campana.cierraMs,
        sorteoMs: campana.sorteoMs,
      });
    } catch {
      guardada = null;
    }
    if (guardada === null) return error(503, "ocupado");
    if (!guardada.ok) return error(409, "evento-ajeno");
  } else {
    d.registrar?.("activar-sin-lista", { codigo: campana.lista.campo.slice(0, 40) });
  }
  await d.topes.anotar(cuenta, campana.evento);
  return { estado: 200, cuerpo: { texto: campana.compacto, firma, evento: campana.evento, organizadora: cuenta } };
}
