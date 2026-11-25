/**
 * Las cuentas nuevas y las activaciones por hora, contadas desde los movimientos de los créditos de Pollar
 * (`GET /v3/billing/credits`, que lee `pollar.ts` y los cuenta `vigilancia.ts` para las firmas): es lo que el vigilante
 * necesita para avisar cuando una ronda de cuentas pasa su umbral (issue 177). Crear la cuenta y activarla no pasa por
 * el portero: lo hace el proveedor de cuentas al entrar, y un guion podría hacerlo desde afuera con el QR a la vista.
 *
 * Módulo puro y el reloj entra como argumento, para que las pruebas no toquen hora ni red.
 *
 * Los nombres de los cobros: `wallet.created:STELLAR:COSIGNED` al crear la cuenta nueva está confirmado contra una lectura
 * real de los movimientos (igual que `cosign.signature:STELLAR` para las firmas, que cuenta `vigilancia.ts`).
 * `account.active:monthly` al activarla se tomó de la misma vigilancia y sigue por confirmar con Pollar. Se cuenta por el comienzo del evento, con el resto del sufijo libre, para que un cambio de la parte del
 * final (la red, el plan) no deje de contar. Un cobro que no se entiende no cuenta, y lo que no es un cobro tampoco.
 */
import { MAX_MOVIMIENTOS } from "./vigilancia";

const HORA_MS = 3_600_000;

/** El evento del cobro por crear la cuenta nueva (la billetera del proveedor). */
const EVENTO_CUENTA_NUEVA = /^wallet\.created(?::[A-Za-z_]{1,24})+$/;
/** El evento del cobro por activar la cuenta (ponerla en la red). */
const EVENTO_ACTIVACION = /^account\.active(?::[A-Za-z_]{1,24})+$/;

/** Un número de un campo de Pollar: número o texto con forma de número. null si no. */
function numero(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && /^-?\d{1,12}(\.\d{1,8})?$/.test(x)) return Number(x);
  return null;
}

/** Un instante de Pollar en ms (texto ISO, o un número en ms o en segundos), o null. */
function instante(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x) && x > 0) return x >= 1e12 ? x : x * 1000;
  if (typeof x === "string" && x.length <= 64) {
    const ms = Date.parse(x);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Las cuentas nuevas y las activaciones de una hora del conteo. */
export interface ConteoDeHora {
  /** El comienzo de la hora, en ISO. */
  hora: string;
  nuevas: number;
  activaciones: number;
}

/** El conteo por hora desde la ventana que pide la consulta, más una señal de página llena. */
export interface ConteoDeCuentas {
  /** Una entrada por cada hora entre `desde` y `ahora`, inclusive, sin importar si hubo movimientos. */
  porHora: ConteoDeHora[];
  /**
   * `false` si vino la página llena de movimientos (`MAX_MOVIMIENTOS`): las horas más viejas de la ventana pudieron
   * quedar afuera. Como los movimientos vienen los más nuevos primero, las horas recientes son las confiables.
   */
  completo: boolean;
}

/**
 * Las cuentas nuevas y las activaciones que Pollar cobró en estos movimientos, por hora, desde `desde` hasta `ahora`.
 * Solo cuentan los cobros (monto negativo, o sin monto) cuyo evento es el de crear una cuenta o el de activarla, y solo
 * desde `desde`. Un movimiento con `count` entero cuenta esa cantidad. Lo que no se entiende no cuenta, y sin fecha
 * cuenta para la hora de `ahora` (la consulta ya pide desde `desde`: es por las dudas).
 */
export function contarCuentasPorHora(movimientos: unknown, desde: number, ahora: number): ConteoDeCuentas {
  const primera = Math.floor(Math.max(0, desde) / HORA_MS);
  const ultima = Math.floor(Math.max(0, ahora) / HORA_MS);
  /** Las horas, de la más vieja a la del reloj. */
  const horas = new Map<string, ConteoDeHora>();
  for (let h = primera; h <= ultima; h++) {
    const hora = new Date(h * HORA_MS).toISOString();
    horas.set(hora, { hora, nuevas: 0, activaciones: 0 });
  }
  const delReloj = new Date(ultima * HORA_MS).toISOString();
  if (Array.isArray(movimientos)) {
    for (const m of movimientos.slice(0, MAX_MOVIMIENTOS)) {
      if (!m || typeof m !== "object" || Array.isArray(m)) continue;
      const o = m as Record<string, unknown>;
      if (typeof o.event !== "string") continue;
      const nueva = EVENTO_CUENTA_NUEVA.test(o.event);
      const activacion = EVENTO_ACTIVACION.test(o.event);
      if (!nueva && !activacion) continue;
      const monto = numero(o.amount ?? o.credits ?? o.delta);
      if (monto !== null && monto >= 0) continue;
      const cuando = instante(o.createdAt ?? o.created_at ?? o.at ?? o.timestamp);
      // Una fecha antes de la ventana no cuenta (la consulta ya acota: es por las dudas). Sin fecha, para la hora del
      // reloj; con una fecha adelante, tampoco se sabe de qué hora es, y esa hora todavía no existe: para la del reloj.
      if (cuando !== null && cuando < desde) continue;
      const hora = cuando === null ? delReloj : new Date(Math.floor(cuando / HORA_MS) * HORA_MS).toISOString();
      const conteo = horas.get(hora) ?? horas.get(delReloj);
      if (!conteo) continue;
      const n = typeof o.count === "number" && Number.isInteger(o.count) && o.count >= 1 && o.count <= 10_000 ? o.count : 1;
      if (nueva) conteo.nuevas += n;
      else conteo.activaciones += n;
    }
  }
  return { porHora: [...horas.values()], completo: !Array.isArray(movimientos) || movimientos.length < MAX_MOVIMIENTOS };
}
