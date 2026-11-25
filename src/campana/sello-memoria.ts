/**
 * Lo que un celular recuerda de la comprobación propia del sello, para que recargar o volver a abrir el enlace no repita las
 * lecturas a la red: con cientos de celulares detrás de la misma conexión, cada pedido de más cuenta.
 *
 *  - Por sala se guarda una sola cosa: de qué comprobación (una huella de comprobante y cuenta) y qué dijo. Que la cuenta estaba
 *    se recuerda mientras dure la memoria de la campaña. Que no se pudo comprobar, solo un rato (`SIN_REPETIR_MS`): pasado ese
 *    tiempo vale la pena volver a intentar.
 *  - Si la red contestó que hay demasiados pedidos, se anota para toda la conexión de este celular: ninguna otra pestaña ni
 *    ninguna recarga lee hasta que pase `LIMITE_DE_LA_RED_MS`.
 *
 * Nunca se guarda el comprobante, la cuenta ni el nombre: solo una huella. Y un almacenamiento que falla o está bloqueado no
 * rompe nada: sin él, simplemente no se recuerda.
 */

import { VIDA_MEMORIA_MS } from "./memoria";

type Almacen = Pick<Storage, "getItem" | "setItem">;

/** Después de una comprobación que no se pudo hacer, cuánto se espera para volver a intentar al recargar. */
export const SIN_REPETIR_MS = 10 * 60_000;
/** Después de que la red dijo que hay demasiados pedidos, cuánto no se lee desde este celular. */
export const LIMITE_DE_LA_RED_MS = 5 * 60_000;

const claveDelSello = (sala: string): string => `tinkazo.comprobacion.${sala}`;
const CLAVE_DEL_LIMITE = "tinkazo.comprobacion.limite";

/** Lo que se recordaba de esta comprobación: que la cuenta estaba, que no se pudo comprobar (hace poco), o nada. */
export type LoRecordado = "esta" | "no-se-pudo" | null;

export function loRecordadoDelSello(almacen: Almacen, sala: string, huella: string, ahora: number): LoRecordado {
  try {
    const crudo = almacen.getItem(claveDelSello(sala));
    if (crudo === null) return null;
    const valor: unknown = JSON.parse(crudo);
    if (typeof valor !== "object" || valor === null) return null;
    const r = valor as Record<string, unknown>;
    if (r.h !== huella || typeof r.hasta !== "number" || !Number.isFinite(r.hasta) || ahora > r.hasta) return null;
    if (r.v === "esta") return "esta";
    if (r.v === "no-se-pudo") return "no-se-pudo";
    return null;
  } catch {
    return null;
  }
}

/** Anota lo que dijo la comprobación de esta huella. `null` es que no se pudo comprobar. */
export function recordarElSello(almacen: Almacen, sala: string, huella: string, dicho: "esta" | null, ahora: number): void {
  const hasta = ahora + (dicho === "esta" ? VIDA_MEMORIA_MS : SIN_REPETIR_MS);
  try {
    almacen.setItem(claveDelSello(sala), JSON.stringify({ h: huella, v: dicho === "esta" ? "esta" : "no-se-pudo", hasta }));
  } catch {
    /* Sin dónde guardar, no se recuerda y la página sigue igual. */
  }
}

/** La red dijo que hay demasiados pedidos: este celular deja de leer por un rato. */
export function marcarElLimiteDeLaRed(almacen: Almacen, ahora: number): void {
  try {
    almacen.setItem(CLAVE_DEL_LIMITE, String(ahora + LIMITE_DE_LA_RED_MS));
  } catch {
    /* igual que arriba */
  }
}

export function hayLimiteDeLaRed(almacen: Almacen, ahora: number): boolean {
  try {
    const crudo = almacen.getItem(CLAVE_DEL_LIMITE);
    if (crudo === null) return false;
    const hasta = Number(crudo);
    // Un valor roto o más lejano que el propio freno no frena: no puede dejar a un celular sin comprobar para siempre.
    return Number.isFinite(hasta) && hasta > ahora && hasta - ahora <= LIMITE_DE_LA_RED_MS;
  } catch {
    return false;
  }
}
