/**
 * El registro de equipos de una sala, sin depender de Cloudflare: recibe una función que corre SQL (la del Durable
 * Object en el Worker, la de `node:sqlite` en las pruebas) y decide qué se guarda.
 *
 * Dos reglas:
 *  - **Una cuenta anotada es de su celular.** En la primera alta el celular manda una llave al azar (16 bytes o más,
 *    en base64url) que guarda junto a los datos de su equipo; acá se guarda solo su huella SHA-256. Para volver a
 *    mandar esa cuenta (corregir los nombres, reintentar) hay que presentar la misma llave: sin ella, el pedido se
 *    rechaza con `ajena` y el registro que estaba queda igual. Quien organiza la libera quitando al equipo con su token
 *    (la fila se borra, con la huella).
 *  - **Un tope por conexión.** Las altas nuevas y los envíos se cuentan por grupo de dirección (`grupoDeIp`: la IPv4
 *    entera o el bloque /64 de IPv6) en ventanas fijas de 10 minutos. Generoso, porque en un evento decenas de
 *    celulares salen por la misma red del lugar: 60 equipos nuevos y 300 envíos por ventana dejan anotarse y corregir
 *    a 40 equipos sin tocarlo, y una sola conexión no llena los 200 lugares en dos minutos (a lo sumo 120, si cruza el
 *    cambio de ventana). La dirección no se guarda: se guarda una huella con una sal al azar de la sala, que se borra
 *    con ella, y las ventanas que pasaron se olvidan en cada envío.
 */
import { MAX_EQUIPOS, grupoDeIp, iguales } from "./logica";
import type { EstadoEquipo } from "./logica";

/** Lo que se le pasa a una consulta. */
export type ValorSql = string | number | null;
/** Corre una consulta y devuelve sus filas (ninguna, si no devuelve nada). */
export type Ejecutar = <T = Record<string, ValorSql>>(consulta: string, ...parametros: ValorSql[]) => T[];

/** La llave del celular: de 16 a 48 bytes al azar, en base64url sin relleno. */
export const ES_LLAVE = /^[A-Za-z0-9_-]{22,64}$/;
/** La ventana del tope por conexión. */
export const VENTANA_EQUIPOS_MS = 10 * 60_000;
/** Equipos nuevos por conexión y por ventana. */
export const ALTAS_POR_CONEXION = 60;
/** Envíos por conexión y por ventana (altas, correcciones y rechazados): una conexión no gasta sola el tope por minuto de la sala. */
export const ENVIOS_POR_CONEXION = 300;

/** Las tablas del registro. Se crean al armar la sala o al configurar el registro, nunca al despertar. */
export function crearTablasDeEquipos(sql: Ejecutar): void {
  sql("CREATE TABLE IF NOT EXISTS sala (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
  // `llave` es la huella SHA-256 de la llave del celular que anotó la cuenta; nunca se devuelve.
  sql("CREATE TABLE IF NOT EXISTS equipos (n INTEGER PRIMARY KEY AUTOINCREMENT, cuenta TEXT NOT NULL UNIQUE, d TEXT NOT NULL, estado TEXT NOT NULL, v INTEGER NOT NULL, llave TEXT NOT NULL)");
  sql("CREATE TABLE IF NOT EXISTS ritmo (grupo TEXT NOT NULL, ventana INTEGER NOT NULL, altas INTEGER NOT NULL, envios INTEGER NOT NULL, PRIMARY KEY (grupo, ventana))");
}

async function sha256Hex(texto: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** La sal de esta sala para las huellas de las direcciones: se inventa la primera vez y se borra con la sala. */
function salDeLaSala(sql: Ejecutar): string {
  const hay = sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sal-equipos'")[0]?.v;
  if (hay) return hay;
  const sal = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  sql("INSERT INTO sala (k, v) VALUES ('sal-equipos', ?) ON CONFLICT(k) DO NOTHING", sal);
  return sql<{ v: string }>("SELECT v FROM sala WHERE k = 'sal-equipos'")[0]?.v ?? sal;
}

export interface AltaDeEquipo {
  cuenta: string;
  /** Los datos del equipo, cifrados con la clave del QR. */
  d: string;
  /** La llave del celular, tal como la manda: acá se guarda solo su huella. */
  llave: string;
  /** La dirección de la conexión (`CF-Connecting-IP`). No se guarda. */
  ip: string;
  ahora: number;
  modo: "cupon" | "sorteo";
}

export type ResultadoDeAlta =
  | { ok: true; n: number; estado: EstadoEquipo; v: number }
  | { ok: false; motivo: "ajena" | "rapido" | "llena" }
  | { ok: false; motivo: "cupo-conexion"; esperaS: number };

/**
 * Anota un equipo, o cambia sus datos si el que manda es el mismo celular. `porMinuto` es el tope de la sala (en
 * memoria): se consulta solo si la conexión todavía tiene lugar, para que una sola no lo gaste.
 *
 * Lo que espera (las huellas) va antes de leer: desde la primera lectura hasta la escritura no hay ninguna espera,
 * así que en el Durable Object dos altas de la misma cuenta no se cruzan.
 */
export async function anotarEquipo(sql: Ejecutar, alta: AltaDeEquipo, porMinuto: () => boolean): Promise<ResultadoDeAlta> {
  if (!ES_LLAVE.test(alta.llave)) throw new Error("llave mal formada");
  const llave = await sha256Hex(alta.llave);
  const grupo = (await sha256Hex(`${grupoDeIp(alta.ip)}|${salDeLaSala(sql)}`)).slice(0, 16);

  const ventana = Math.floor(alta.ahora / VENTANA_EQUIPOS_MS);
  const esperaS = Math.max(1, Math.ceil(((ventana + 1) * VENTANA_EQUIPOS_MS - alta.ahora) / 1000));
  sql("DELETE FROM ritmo WHERE ventana < ?", ventana);
  const ritmo = sql<{ altas: number; envios: number }>("SELECT altas, envios FROM ritmo WHERE grupo = ? AND ventana = ?", grupo, ventana)[0] ?? { altas: 0, envios: 0 };
  if (ritmo.envios >= ENVIOS_POR_CONEXION) return { ok: false, motivo: "cupo-conexion", esperaS };
  if (!porMinuto()) return { ok: false, motivo: "rapido" };
  const contar = (nueva: boolean): void =>
    void sql(
      "INSERT INTO ritmo (grupo, ventana, altas, envios) VALUES (?, ?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET altas = altas + excluded.altas, envios = envios + 1",
      grupo,
      ventana,
      nueva ? 1 : 0,
    );

  const hay = sql<{ n: number; estado: EstadoEquipo; llave: string }>("SELECT n, estado, llave FROM equipos WHERE cuenta = ?", alta.cuenta)[0];
  if (hay) {
    contar(false);
    if (!iguales(hay.llave, llave)) return { ok: false, motivo: "ajena" };
    const v = siguienteVersion(sql);
    sql("UPDATE equipos SET d = ?, v = ? WHERE n = ?", alta.d, v, hay.n);
    return { ok: true, n: hay.n, estado: hay.estado, v };
  }
  if (ritmo.altas >= ALTAS_POR_CONEXION) {
    contar(false);
    return { ok: false, motivo: "cupo-conexion", esperaS };
  }
  if ((sql<{ c: number }>("SELECT COUNT(*) AS c FROM equipos")[0]?.c ?? 0) >= MAX_EQUIPOS) {
    contar(false);
    return { ok: false, motivo: "llena" };
  }
  contar(true);
  const v = siguienteVersion(sql);
  // Sin requisito no hay nada que aceptar: el equipo queda listo para recibir su cupón.
  const estado: EstadoEquipo = alta.modo === "sorteo" ? "solicitud" : "aceptado";
  const n = sql<{ n: number }>("INSERT INTO equipos (cuenta, d, estado, v, llave) VALUES (?, ?, ?, ?, ?) RETURNING n", alta.cuenta, alta.d, estado, v, llave)[0]?.n;
  if (typeof n !== "number") throw new Error("el alta no devolvió su número");
  return { ok: true, n, estado, v };
}

export function siguienteVersion(sql: Ejecutar): number {
  return sql<{ v: number }>("SELECT COALESCE(MAX(v), 0) + 1 AS v FROM equipos")[0]?.v ?? 1;
}

/** Quien organiza saca un equipo: con la fila se va la huella de la llave, y la cuenta queda libre para anotarse de nuevo. */
export function quitarEquipo(sql: Ejecutar, n: number): void {
  sql("DELETE FROM equipos WHERE n = ?", n);
}
