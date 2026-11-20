/**
 * Los topes de la activación de campañas, en SQL sobre el objeto `Cupos` (que es donde los topes son exactos). No dependen de
 * Cloudflare: se prueban en Node con un SQLite en memoria. Todo lo que llega acá ya es una huella: ni la cuenta de quien organiza,
 * ni su sesión, ni su dirección se guardan en claro.
 *
 * - Por conexión y por ventana de 10 minutos: los pedidos que cuestan una mirada a la red, y las sesiones que el proveedor
 *   rechazó (con los mismos números que el alta de quien participa).
 * - Por sesión: cuántas veces se rechazó la misma ficha. Repetir una ficha mala no llama a nadie.
 * - Por cuenta y por día: las campañas distintas que se activaron. Repetir el mismo evento no suma, así que reintentar un
 *   pedido que falló (la red, el portero) no gasta lugar.
 */
import { ACTIVACIONES_POR_DIA, ACTIVAR_POR_CONEXION } from "./activar";
import { RECHAZOS_POR_CONEXION, RECHAZOS_POR_FICHA, VENTANA_CAMPANA_MS } from "./campana";
import type { Ejecutar } from "./registro";

/** Las tablas de los topes. Se crean junto con las demás del objeto. */
export function crearTablasDeActivar(sql: Ejecutar): void {
  const porVentana = "(grupo TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (grupo, ventana))";
  sql(`CREATE TABLE IF NOT EXISTS activar_ritmo ${porVentana}`);
  sql(`CREATE TABLE IF NOT EXISTS activar_rechazos ${porVentana}`);
  sql("CREATE TABLE IF NOT EXISTS activar_ficha (ficha TEXT NOT NULL, ventana INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (ficha, ventana))");
  sql("CREATE TABLE IF NOT EXISTS activar_cuenta (cuenta TEXT NOT NULL, dia TEXT NOT NULL, evento TEXT NOT NULL, PRIMARY KEY (cuenta, dia, evento))");
  sql("CREATE TABLE IF NOT EXISTS activar_nota (nota TEXT PRIMARY KEY, evento TEXT NOT NULL, hasta INTEGER NOT NULL)");
}

/** Cuánto queda tomada la nota de un evento: más que los 30 días en que cuenta un pago, así un pago viejo nunca sirve a otro. */
export const DIAS_DE_LA_NOTA = 31;

/**
 * Toma la nota de la comisión para este evento. La nota sale de una huella del evento con unas 50 cifras binarias: con
 * millones de nombres se pueden encontrar dos eventos con la misma nota, y un solo pago activaría los dos. La primera
 * activación pagada se queda con la nota por 31 días; otro evento con la misma nota no se activa con ese pago. El mismo
 * evento siempre la vuelve a tomar. No guarda nada personal: la nota y el evento ya son públicos en la red y en la sala.
 */
export function tomarNota(sql: Ejecutar, a: { nota: string; evento: string; ahora: number }): boolean {
  sql("DELETE FROM activar_nota WHERE hasta < ?", a.ahora);
  const duena = sql<{ evento: string }>("SELECT evento FROM activar_nota WHERE nota = ?", a.nota)[0];
  if (duena !== undefined) return duena.evento === a.evento;
  sql("INSERT INTO activar_nota (nota, evento, hasta) VALUES (?, ?, ?)", a.nota, a.evento, a.ahora + DIAS_DE_LA_NOTA * 86_400_000);
  return true;
}

/** Cuántos segundos faltan para que termine la ventana. */
function esperaDeVentana(ahora: number, ventana: number): number {
  return Math.max(1, Math.ceil(((ventana + 1) * VENTANA_CAMPANA_MS - ahora) / 1000));
}

export type AntesDeActivar = { ok: true } | { ok: false; motivo: "rechazos" | "cupo-conexion"; esperaS: number };

/**
 * Lo que se mira antes de llamar al proveedor de cuentas: la ficha repetida, los rechazos de la conexión y su ritmo. Si todo
 * está en orden, este pedido queda contado en el ritmo de la conexión.
 */
export function antesDeActivar(sql: Ejecutar, a: { grupo: string; ficha: string; ahora: number }): AntesDeActivar {
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  sql("DELETE FROM activar_ritmo WHERE ventana < ?", ventana);
  sql("DELETE FROM activar_rechazos WHERE ventana < ?", ventana);
  sql("DELETE FROM activar_ficha WHERE ventana < ?", ventana);
  const deFicha = sql<{ n: number }>("SELECT n FROM activar_ficha WHERE ficha = ? AND ventana = ?", a.ficha, ventana)[0]?.n ?? 0;
  if (deFicha >= RECHAZOS_POR_FICHA) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(a.ahora, ventana) };
  const rechazos = sql<{ n: number }>("SELECT n FROM activar_rechazos WHERE grupo = ? AND ventana = ?", a.grupo, ventana)[0]?.n ?? 0;
  if (rechazos >= RECHAZOS_POR_CONEXION) return { ok: false, motivo: "rechazos", esperaS: esperaDeVentana(a.ahora, ventana) };
  const pedidos = sql<{ n: number }>("SELECT n FROM activar_ritmo WHERE grupo = ? AND ventana = ?", a.grupo, ventana)[0]?.n ?? 0;
  if (pedidos >= ACTIVAR_POR_CONEXION) return { ok: false, motivo: "cupo-conexion", esperaS: esperaDeVentana(a.ahora, ventana) };
  sql(
    "INSERT INTO activar_ritmo (grupo, ventana, n) VALUES (?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1",
    a.grupo,
    ventana,
  );
  return { ok: true };
}

/**
 * Anota una sesión que el proveedor rechazó. La ficha siempre suma. La conexión suma solo la primera vez que se ve esa ficha:
 * repetirla no cuesta otra llamada al proveedor, y una sola sesión mala no deja sin tope a las demás.
 */
export function contarRechazoDeActivar(sql: Ejecutar, a: { grupo: string; ficha: string; ahora: number }): void {
  const ventana = Math.floor(a.ahora / VENTANA_CAMPANA_MS);
  const vista = sql<{ n: number }>("SELECT n FROM activar_ficha WHERE ficha = ? AND ventana = ?", a.ficha, ventana)[0];
  sql(
    "INSERT INTO activar_ficha (ficha, ventana, n) VALUES (?, ?, 1) ON CONFLICT(ficha, ventana) DO UPDATE SET n = n + 1",
    a.ficha,
    ventana,
  );
  if (vista !== undefined) return;
  sql(
    "INSERT INTO activar_rechazos (grupo, ventana, n) VALUES (?, ?, 1) ON CONFLICT(grupo, ventana) DO UPDATE SET n = n + 1",
    a.grupo,
    ventana,
  );
}

/** Si a esta cuenta todavía le cabe activar este evento hoy. Un evento que ya activó hoy siempre cabe (es repetir el pedido). */
export function cupoDeCuenta(
  sql: Ejecutar,
  a: { cuenta: string; evento: string; dia: string; ahora: number },
): { ok: true } | { ok: false; esperaS: number } {
  sql("DELETE FROM activar_cuenta WHERE dia < ?", a.dia);
  const ya = sql<{ n: number }>(
    "SELECT COUNT(*) AS n FROM activar_cuenta WHERE cuenta = ? AND dia = ? AND evento = ?",
    a.cuenta,
    a.dia,
    a.evento,
  )[0]?.n ?? 0;
  if (ya > 0) return { ok: true };
  const hoy = sql<{ n: number }>("SELECT COUNT(*) AS n FROM activar_cuenta WHERE cuenta = ? AND dia = ?", a.cuenta, a.dia)[0]?.n ?? 0;
  if (hoy < ACTIVACIONES_POR_DIA) return { ok: true };
  const finDelDia = (Math.floor(a.ahora / 86_400_000) + 1) * 86_400_000;
  return { ok: false, esperaS: Math.max(1, Math.ceil((finDelDia - a.ahora) / 1000)) };
}

/** Anota que esta cuenta activó este evento hoy. Anotarlo dos veces es lo mismo que una. */
export function anotarActivacion(sql: Ejecutar, a: { cuenta: string; evento: string; dia: string }): void {
  sql("INSERT OR IGNORE INTO activar_cuenta (cuenta, dia, evento) VALUES (?, ?, ?)", a.cuenta, a.dia, a.evento);
}
