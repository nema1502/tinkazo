import type { TipoDeDestino } from "./destino";

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

/** Un pago de monedas de prueba mandado y no confirmado: se guarda antes de mandar para poder preguntar por su hash. */
export interface PremioPendiente {
  contractId: string;
  hash: string;
  /** Hasta qué segundo de la red vale la transacción. */
  vence: number;
  /** El monto, en la unidad mínima y como texto. */
  monto: string;
  desdeMs: number;
}

/** Un envío de monedas mandado y no confirmado. */
export interface EnvioPendiente {
  contractId: string;
  hash: string;
  vence: number;
  hacia: string;
  base: string;
  tipo: TipoDeDestino;
  origen: "pagina" | "enlace";
  nota: string | null;
  monto: string;
  desdeMs: number;
}

/** Cómo va el premio de una billetera en este aparato. Solo avanza: por pagar, pagado, enviado. */
export type EstadoDelPremio = "por-pagar" | "pagado" | "enviado";

export interface RegistroDePremio {
  contractId: string;
  estado: EstadoDelPremio;
  hashPremio: string | null;
  hashEnvio: string | null;
}

export interface Almacen {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

export const CLAVE_DEL_SELLO = "tinkazo.prueba-llave.sello";
export const CLAVE_DE_LA_CREACION = "tinkazo.prueba-llave.creacion";
export const CLAVE_DEL_PREMIO = "tinkazo.prueba-llave.premio";
export const CLAVE_DEL_ENVIO = "tinkazo.prueba-llave.envio";
export const CLAVE_DE_LOS_PREMIOS = "tinkazo.prueba-llave.premios";

/** Cuántas billeteras recuerda el registro de premios en este aparato. */
export const TOPE_DE_REGISTROS = 10;

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

const esNumero = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const esMonto = (x: unknown): x is string => typeof x === "string" && /^\d+$/.test(x);

function esPremioPendiente(x: unknown): x is PremioPendiente {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return esTexto(o["contractId"]) && esTexto(o["hash"]) && esNumero(o["vence"]) && esMonto(o["monto"]) && esNumero(o["desdeMs"]);
}

function esEnvioPendiente(x: unknown): x is EnvioPendiente {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    esTexto(o["contractId"]) &&
    esTexto(o["hash"]) &&
    esNumero(o["vence"]) &&
    esTexto(o["hacia"]) &&
    esTexto(o["base"]) &&
    (o["tipo"] === "G" || o["tipo"] === "M" || o["tipo"] === "C") &&
    (o["origen"] === "pagina" || o["origen"] === "enlace") &&
    (o["nota"] === null || esMonto(o["nota"])) &&
    esMonto(o["monto"]) &&
    esNumero(o["desdeMs"])
  );
}

function esRegistroDePremio(x: unknown): x is RegistroDePremio {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    esTexto(o["contractId"]) &&
    (o["estado"] === "por-pagar" || o["estado"] === "pagado" || o["estado"] === "enviado") &&
    (o["hashPremio"] === null || esTexto(o["hashPremio"])) &&
    (o["hashEnvio"] === null || esTexto(o["hashEnvio"]))
  );
}

/** Se guarda antes de mandar el pago: si la página se cierra, se puede preguntar por ese hash. */
export function guardarPremioPendiente(p: PremioPendiente, almacen: Almacen | null = almacenDelNavegador()): void {
  guardar(CLAVE_DEL_PREMIO, p, almacen);
}
export function leerPremioPendiente(almacen: Almacen | null = almacenDelNavegador()): PremioPendiente | null {
  return leer(CLAVE_DEL_PREMIO, esPremioPendiente, almacen);
}
export function borrarPremioPendiente(almacen: Almacen | null = almacenDelNavegador()): void {
  borrar(CLAVE_DEL_PREMIO, almacen);
}

/** Se guarda antes de mandar el envío. */
export function guardarEnvioPendiente(e: EnvioPendiente, almacen: Almacen | null = almacenDelNavegador()): void {
  guardar(CLAVE_DEL_ENVIO, e, almacen);
}
export function leerEnvioPendiente(almacen: Almacen | null = almacenDelNavegador()): EnvioPendiente | null {
  return leer(CLAVE_DEL_ENVIO, esEnvioPendiente, almacen);
}
export function borrarEnvioPendiente(almacen: Almacen | null = almacenDelNavegador()): void {
  borrar(CLAVE_DEL_ENVIO, almacen);
}

const ORDEN_DEL_PREMIO: Record<EstadoDelPremio, number> = { "por-pagar": 0, pagado: 1, enviado: 2 };

/**
 * El registro nuevo sobre el previo. El estado solo avanza: un pedido de volver atrás devuelve el previo tal cual. Los hashes
 * ya anotados no se borran.
 */
export function avanzarRegistro(previo: RegistroDePremio | null, nuevo: RegistroDePremio): RegistroDePremio {
  if (!previo || previo.contractId !== nuevo.contractId) return nuevo;
  if (ORDEN_DEL_PREMIO[nuevo.estado] < ORDEN_DEL_PREMIO[previo.estado]) return previo;
  return { contractId: nuevo.contractId, estado: nuevo.estado, hashPremio: nuevo.hashPremio ?? previo.hashPremio, hashEnvio: nuevo.hashEnvio ?? previo.hashEnvio };
}

function leerLista(almacen: Almacen | null): RegistroDePremio[] {
  try {
    const crudo = almacen?.getItem(CLAVE_DE_LOS_PREMIOS);
    if (!crudo) return [];
    const x: unknown = JSON.parse(crudo);
    return Array.isArray(x) ? x.filter(esRegistroDePremio) : [];
  } catch {
    return [];
  }
}

/** El registro de una billetera en este aparato, o `null` si no hay (otro aparato, o nunca se creó acá). */
export function leerRegistroDePremio(contractId: string, almacen: Almacen | null = almacenDelNavegador()): RegistroDePremio | null {
  return leerLista(almacen).find((r) => r.contractId === contractId) ?? null;
}

/** Anota el registro de una billetera: la más nueva queda al final y no se guardan más de `TOPE_DE_REGISTROS`. */
export function anotarRegistroDePremio(r: RegistroDePremio, almacen: Almacen | null = almacenDelNavegador()): void {
  const lista = leerLista(almacen);
  const previo = lista.find((x) => x.contractId === r.contractId) ?? null;
  const nuevo = avanzarRegistro(previo, r);
  guardar(CLAVE_DE_LOS_PREMIOS, [...lista.filter((x) => x.contractId !== r.contractId), nuevo].slice(-TOPE_DE_REGISTROS), almacen);
}
