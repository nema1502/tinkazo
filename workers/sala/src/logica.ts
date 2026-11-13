/**
 * La parte de la sala que no depende de Cloudflare: los topes, las formas que
 * se aceptan y los orígenes. Va aparte de `index.ts` (que importa
 * `cloudflare:workers`) para poder probarla en Node.
 */

export const SITIO = "https://tinkazo.app";
/** Cuánto vive una sala: a las 10 h de creada se borra todo, sola. */
export const VIDA_MS = 10 * 3_600_000;
/** Nombres por sala. */
export const MAX_NOMBRES = 400;
/** Nombres por minuto por sala: todo un recinto puede salir por una sola IP, por eso el tope es de la sala y no de la dirección. */
export const NOMBRES_POR_MINUTO = 120;
/**
 * Altas de equipos por minuto por sala, con su propia ventana. Hasta el 13 de noviembre de 2026 gastaban el mismo
 * contador que los nombres: con el id de la sala del QR, 120 nombres por minuto dejaban a todos los equipos afuera.
 */
export const EQUIPOS_POR_MINUTO = 120;
/** Salas nuevas por dirección y por hora, y en total por día. */
export const SALAS_POR_IP_POR_HORA = 5;
export const SALAS_POR_DIA = 100;
/** Lo que mide, como mucho, un nombre cifrado: `[1][IV de 12][texto cifrado + 16 de la etiqueta]`. */
export const MAX_BYTES_NOMBRE = 256;
export const MIN_BYTES_NOMBRE = 13 + 16 + 1;
/** Lo que mide, como mucho, ese mismo nombre en base64url. */
export const MAX_CARACTERES = Math.ceil((MAX_BYTES_NOMBRE * 4) / 3);
/**
 * Sockets abiertos a la vez por sala: más allá de esto, uno nuevo solo entra si
 * desplaza a otro que lleva callado más de `PRESENTARSE_MS`. Alguien que tenga el
 * id puede ocupar lugares sin presentarse; con 12 lugares y 3 segundos tiene que
 * abrir unos cuatro por segundo, sin parar, para dejar afuera a la pantalla
 * real. Una pantalla de verdad se presenta apenas abre (un mensaje).
 */
export const MAX_SOCKETS = 12;
/** Cuánto puede un socket quedarse sin presentarse con el token. */
export const PRESENTARSE_MS = 3_000;

export const ES_ID = /^[0-9A-Za-z]{8}$/;
const ES_BASE64URL = /^[A-Za-z0-9_-]+$/;
/** 16 bytes en base64url, sin relleno. */
export const ES_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** Si es un nombre cifrado bien formado: base64url, del largo que puede tener. No lo descifra: nadie acá puede. */
export function nombreCifradoValido(s: string): boolean {
  if (s.length === 0 || s.length > MAX_CARACTERES || !ES_BASE64URL.test(s)) return false;
  const bytes = Math.floor((s.length * 3) / 4);
  return bytes >= MIN_BYTES_NOMBRE && bytes <= MAX_BYTES_NOMBRE;
}

/**
 * Desde dónde se pueden crear salas y abrir la pantalla. Los celulares que se
 * suman no cuentan: abren la página que sirve este mismo Worker.
 */
export function origenPermitido(origen: string | null): boolean {
  if (!origen) return false;
  if (origen === SITIO || origen === "https://www.tinkazo.app") return true;
  if (/^https:\/\/tinkazo(-[a-z0-9-]+)?\.vercel\.app$/.test(origen)) return true;
  return /^http:\/\/localhost:\d{2,5}$/.test(origen);
}

/** En IPv6 cuenta el bloque /64, no la dirección entera (con la entera, un solo bloque daba millones de topes). */
export function grupoDeIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  const v4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4?.[1]) return v4[1];
  const doble = ip.includes("::");
  const [cabeza = "", cola = ""] = ip.toLowerCase().split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = doble && cola ? cola.split(":") : [];
  const bloques = doble ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return `${bloques
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Cuenta eventos por minuto, en memoria. `intentar` suma uno y dice si cabe.
 * Si el objeto se desaloja a mitad de un minuto, la cuenta vuelve a cero y ese
 * minuto caben otros 120: el tope por minuto solo frena el ritmo, no es exacto.
 * Lo exacto es el de 400 nombres por sala, que vive en SQLite y no se reinicia;
 * lo peor que gana alguien que desaloje el objeto es llenar la sala más rápido.
 */
export class VentanaPorMinuto {
  private minuto = -1;
  private n = 0;
  constructor(private readonly max: number) {}
  intentar(ahora: number): boolean {
    const m = Math.floor(ahora / 60_000);
    if (m !== this.minuto) {
      this.minuto = m;
      this.n = 0;
    }
    if (this.n >= this.max) return false;
    this.n += 1;
    return true;
  }
}

/** La hora UTC de un instante, contada desde 1970: la ventana de las altas por dirección. */
export function horaUtc(ms: number): number {
  return Math.floor(ms / 3_600_000);
}

/** Donde viven las altas de la hora: en el almacenamiento del objeto, para que dormirse no las borre. */
export interface AltasPorHora {
  leer(grupo: string, hora: number): number;
  sumar(grupo: string, hora: number): void;
  /** Olvida todas las horas anteriores a esta. */
  olvidarAntes(hora: number): void;
}

/**
 * Cuenta un alta de `grupo` en la hora de `ahora` si cabe en `max`. Ventana fija
 * por hora (no deslizante): en el cambio de hora caben hasta `2 * max`, y el tope
 * del día sigue siendo uno solo. `grupo` ya viene hecho huella: acá no se ve la dirección.
 */
export function intentarAlta(a: AltasPorHora, grupo: string, ahora: number, max: number): boolean {
  const hora = horaUtc(ahora);
  a.olvidarAntes(hora);
  if (a.leer(grupo, hora) >= max) return false;
  a.sumar(grupo, hora);
  return true;
}

/** Compara dos huellas hexadecimales sin cortar en la primera diferencia. */
export function iguales(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** El día UTC de un instante, `AAAA-MM-DD`: lo único del momento que se guarda de las altas. */
export function diaUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ los equipos */

/**
 * Los equipos de un evento (Space Apps y parecidos): cada equipo se anota desde el
 * celular de su encargado con su cuenta de Stellar. La cuenta es pública y viaja en
 * claro; el nombre del equipo y los de sus integrantes viajan cifrados con la clave
 * del QR, como los nombres de la sala: este servicio no puede leerlos.
 */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** El control de una dirección de Stellar (CRC16 XMODEM) sobre sus primeros 33 bytes. */
function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/**
 * Una cuenta de Stellar de verdad: la letra G, 55 caracteres en base 32 y el final de control que cuadra. Una dirección
 * con una letra cambiada no pasa: dejarla entrar haría fallar el cupón de todo el evento. Sin el SDK: el Worker no lo carga.
 */
export function esCuentaValida(x: unknown): x is string {
  if (typeof x !== "string" || !/^G[A-Z2-7]{55}$/.test(x)) return false;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of x) {
    acc = (acc << 5) | BASE32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  // 35 bytes: la versión de una cuenta (6 << 3), la llave de 32 y el control de 2 (el menos pesado primero).
  if (bytes.length !== 35 || bytes[0] !== 6 << 3) return false;
  return crc16(bytes.slice(0, 33)) === (bytes[34] as number) * 256 + (bytes[33] as number);
}

/** Equipos por sala. Los cupones se mandan de a 100 por transacción; con 200 caben en dos. */
export const MAX_EQUIPOS = 200;
/** Lo que mide, como mucho, un equipo cifrado: el nombre del equipo y hasta cinco integrantes. */
export const MAX_BYTES_EQUIPO = 1100;
export const MIN_BYTES_EQUIPO = 13 + 16 + 1;
export const MAX_CARACTERES_EQUIPO = Math.ceil((MAX_BYTES_EQUIPO * 4) / 3);
/** Lo más que pesa el cuerpo de un alta de equipo (la cuenta y el texto cifrado). */
export const MAX_CUERPO_EQUIPO = 2000;
/** Lo más que pesa la configuración que manda quien organiza. */
export const MAX_CUERPO_CONFIG = 1000;

/**
 * En qué punto está un equipo. Lo cambia solo quien tiene el token de la sala (la pantalla de quien organiza).
 *  - `solicitud`: pidió participar y quien organiza todavía no lo aceptó (solo en el modo «sorteo»);
 *  - `aceptado`: puede recibir su cupón (modo «cupon»), o tiene que hacer primero un sorteo con Tinkazo (modo «sorteo»);
 *  - `sorteo`: ya hizo un sorteo con su cuenta, y puede recibir su cupón;
 *  - `cupon`: ya recibió su cupón.
 */
export const ESTADOS_EQUIPO = ["solicitud", "aceptado", "sorteo", "cupon"] as const;
export type EstadoEquipo = (typeof ESTADOS_EQUIPO)[number];
export const esEstadoEquipo = (x: unknown): x is EstadoEquipo => typeof x === "string" && (ESTADOS_EQUIPO as readonly string[]).includes(x);

/** Si es un equipo cifrado bien formado: base64url, del largo que puede tener. No lo descifra: nadie acá puede. */
export function equipoCifradoValido(s: unknown): s is string {
  if (typeof s !== "string" || s.length === 0 || s.length > MAX_CARACTERES_EQUIPO || !ES_BASE64URL.test(s)) return false;
  const bytes = Math.floor((s.length * 3) / 4);
  return bytes >= MIN_BYTES_EQUIPO && bytes <= MAX_BYTES_EQUIPO;
}

/**
 * Cómo se arma el registro:
 *  - «cupon»: el equipo queda anotado y recibe un cupón gratis (el de reserva, sin requisito);
 *  - «sorteo»: el equipo pide participar, quien organiza lo acepta, y para recibir el cupón tiene que haber hecho
 *    antes al menos un sorteo con Tinkazo desde su propia cuenta, en la misma red del evento.
 */
export interface ConfigEquipos {
  modo: "cupon" | "sorteo";
  /** El identificador corto del evento, sin espacios. */
  evento: string;
  /** La cuenta del evento: la que reparte los cupones. */
  cuenta: string;
}

const ES_EVENTO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** La nota de un cupón es `tk:cupon:` más el evento, y una nota de texto de Stellar mide, como mucho, 28 bytes. */
export const MAX_EVENTO = 19;

/** La configuración tal como la manda la pantalla, o `null` si algo no cuadra. Lo que sobra se descarta. */
export function validarConfigEquipos(x: unknown): ConfigEquipos | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const modo = o.modo;
  if (modo !== "cupon" && modo !== "sorteo") return null;
  const evento = o.evento;
  if (typeof evento !== "string" || evento.length < 3 || evento.length > MAX_EVENTO || !ES_EVENTO.test(evento)) return null;
  const cuenta = o.cuenta;
  if (!esCuentaValida(cuenta)) return null;
  return { modo, evento, cuenta };
}
