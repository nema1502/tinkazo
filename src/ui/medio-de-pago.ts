import { compraQrActiva } from "../stellar/alta-config";

/**
 * Cómo paga la persona su compra: con el QR de su banco en bolivianos, o desde otra app. El sitio lo deduce y nunca
 * pregunta. El cambio queda siempre a un toque (No estoy en Bolivia, Estoy en Bolivia, Pagar desde otra app), y solo se
 * recuerda lo que la persona elige con ese toque: la deducción nunca se guarda sola.
 *
 * Vale el primer renglón que se cumple:
 * 1. Sin la compra con QR en el build (`VITE_COMPRA_QR`): otra app, sin enlace.
 * 2. El servidor dice que esta cuenta no compra con QR por algo que no cambia hoy (fuera del piloto, la compra con QR
 *    cerrada, o el fondeo de las cuentas diferido), o no dice nada, o dice que no por un motivo que no conocemos: otra
 *    app, sin enlace, como si el QR no existiera.
 * 3. La persona ya eligió en este navegador: lo que eligió, con enlace.
 * 4. La zona horaria del navegador es la de Bolivia: el QR, con enlace.
 * 5. Si no: otra app, con enlace.
 *
 * El cupo del día no entra: una persona del piloto en Bolivia con el QR lleno hoy ve Ahora no hay pago con QR, con el
 * enlace a otra app. Leer el almacenamiento o la zona puede fallar (ventana privada, datos bloqueados): se lee con
 * try/catch y sin nada se sigue con el renglón siguiente.
 */

export type Medio = "qr" | "app";

/** Lo que dice el servidor de la compra con QR para esta cuenta (`compraQr` de `/v1/alta/estado`). */
export interface CompraQrDelServidor {
  /** La lectura en vivo del permiso de empezar, sin reservar nada. */
  puede: boolean;
  motivo: string | null;
}

export interface Deduccion {
  medio: Medio;
  /** Se ofrece el enlace para pasar al otro camino. */
  cambio: boolean;
}

/** Dónde se recuerda lo que eligió la persona con el enlace. */
export const CLAVE_DEL_MEDIO = "tinkazo:medio-de-pago";
export const ZONA_DE_BOLIVIA = "America/La_Paz";

/** Para esta cuenta el QR no existe hoy: no se ofrece ni el enlace. */
export const SIN_QR_PARA_ESTA_CUENTA: ReadonlySet<string> = new Set(["fuera-del-piloto", "compras-cerradas", "fondeo-diferido"]);
/** Un no de hoy que no saca a la persona del camino del QR: el cupo del día, otro paquete, o una compra en curso. */
const NO_DE_HOY: ReadonlySet<string> = new Set(["tope-del-dia", "sin-lugar", "ya-tiene-acceso", "compra-en-curso"]);

const OTRA_APP_SIN_ENLACE: Deduccion = Object.freeze({ medio: "app", cambio: false });

/** La deducción, sin leer ni escribir nada. */
export function medioPorDefecto(e: { enElBuild: boolean; servidor: CompraQrDelServidor | null | undefined; elegido: Medio | null; zona: string | null }): Deduccion {
  if (!e.enElBuild) return { ...OTRA_APP_SIN_ENLACE };
  const sv = e.servidor;
  const motivo = sv?.motivo ?? "";
  // Sin `compraQr`, el servidor la tiene cerrada. Un no con un motivo que no conocemos se lee como el más cerrado.
  if (!sv || SIN_QR_PARA_ESTA_CUENTA.has(motivo) || (!sv.puede && !NO_DE_HOY.has(motivo))) return { ...OTRA_APP_SIN_ENLACE };
  if (e.elegido) return { medio: e.elegido, cambio: true };
  if (e.zona === ZONA_DE_BOLIVIA) return { medio: "qr", cambio: true };
  return { medio: "app", cambio: true };
}

type Almacen = Pick<Storage, "getItem" | "setItem">;

function almacenDelNavegador(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Lo que eligió la persona en este navegador, o `null`. Nunca lanza. */
export function leerMedio(almacen: Almacen | null = almacenDelNavegador()): Medio | null {
  if (!almacen) return null;
  try {
    const v = almacen.getItem(CLAVE_DEL_MEDIO);
    return v === "qr" || v === "app" ? v : null;
  } catch {
    return null;
  }
}

/** Recuerda lo que la persona eligió con el enlace. Sin almacenamiento, vale mientras la ventana esté abierta. Nunca lanza. */
export function recordarMedio(medio: Medio, almacen: Almacen | null = almacenDelNavegador()): void {
  if (!almacen) return;
  try {
    almacen.setItem(CLAVE_DEL_MEDIO, medio);
  } catch {
    // Sin lugar o sin permiso.
  }
}

/** La zona horaria del navegador, o `null` si no se puede leer. */
export function zonaHoraria(leer: () => string | undefined = () => Intl.DateTimeFormat().resolvedOptions().timeZone): string | null {
  try {
    const z = leer();
    return typeof z === "string" && z !== "" ? z : null;
  } catch {
    return null;
  }
}

/** La deducción para esta cuenta en este navegador: lee lo elegido y la zona, y no guarda nada. */
export function medioDeEstaCuenta(
  servidor: CompraQrDelServidor | null | undefined,
  o: { enElBuild?: boolean; almacen?: Almacen | null; zona?: string | null } = {},
): Deduccion {
  return medioPorDefecto({
    enElBuild: o.enElBuild ?? compraQrActiva(),
    servidor,
    elegido: leerMedio(o.almacen === undefined ? almacenDelNavegador() : o.almacen),
    zona: o.zona === undefined ? zonaHoraria() : o.zona,
  });
}
