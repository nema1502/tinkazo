/**
 * Lo que la página guarda en este aparato para poder seguir si se cierra o se recarga. Todo en `localStorage`, y todo
 * dentro de un try: sin almacenamiento la prueba anda igual, solo que no retoma.
 */

export interface SelloPendiente {
  /** El número del sorteo, como texto porque es un entero de 64 bits. */
  id: string;
  ronda: number;
  nombres: string[];
  /** El hash de la transacción del sello. */
  hashSello: string;
  /** Cuándo se selló, en segundos. */
  selladoEn: number;
  credentialId: string;
}

export interface CreacionPendiente {
  credentialId: string;
  hashCreacion: string;
}

export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export const CLAVE_DEL_SELLO = "tinkazo.prueba-llave.sello";
export const CLAVE_DE_LA_CREACION = "tinkazo.prueba-llave.creacion";

function almacenDelNavegador(): Almacen | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function leer<T>(clave: string, valido: (x: unknown) => x is T, almacen: Almacen | null): T | null {
  try {
    const crudo = almacen?.getItem(clave);
    if (!crudo) return null;
    const x: unknown = JSON.parse(crudo);
    return valido(x) ? x : null;
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: unknown, almacen: Almacen | null): void {
  try {
    almacen?.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin almacenamiento, no se retoma */
  }
}

function borrar(clave: string, almacen: Almacen | null): void {
  try {
    almacen?.removeItem(clave);
  } catch {
    /* ya está */
  }
}

const esTexto = (x: unknown): x is string => typeof x === "string" && x.length > 0;

function esSelloPendiente(x: unknown): x is SelloPendiente {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    esTexto(o["id"]) &&
    /^\d+$/.test(o["id"]) &&
    Number.isInteger(o["ronda"]) &&
    Array.isArray(o["nombres"]) &&
    o["nombres"].every((n) => typeof n === "string") &&
    esTexto(o["hashSello"]) &&
    Number.isFinite(o["selladoEn"]) &&
    esTexto(o["credentialId"])
  );
}

function esCreacionPendiente(x: unknown): x is CreacionPendiente {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  // El hash queda vacío hasta que se manda la creación.
  return esTexto(o["credentialId"]) && typeof o["hashCreacion"] === "string";
}

export function guardarSelloPendiente(s: SelloPendiente, almacen: Almacen | null = almacenDelNavegador()): void {
  guardar(CLAVE_DEL_SELLO, s, almacen);
}
export function leerSelloPendiente(almacen: Almacen | null = almacenDelNavegador()): SelloPendiente | null {
  return leer(CLAVE_DEL_SELLO, esSelloPendiente, almacen);
}
export function borrarSelloPendiente(almacen: Almacen | null = almacenDelNavegador()): void {
  borrar(CLAVE_DEL_SELLO, almacen);
}

/** Se guarda antes de esperar que la creación se confirme: si la página se cierra, se puede preguntar por ese hash. */
export function guardarCreacionPendiente(c: CreacionPendiente, almacen: Almacen | null = almacenDelNavegador()): void {
  guardar(CLAVE_DE_LA_CREACION, c, almacen);
}
export function leerCreacionPendiente(almacen: Almacen | null = almacenDelNavegador()): CreacionPendiente | null {
  return leer(CLAVE_DE_LA_CREACION, esCreacionPendiente, almacen);
}
export function borrarCreacionPendiente(almacen: Almacen | null = almacenDelNavegador()): void {
  borrar(CLAVE_DE_LA_CREACION, almacen);
}
