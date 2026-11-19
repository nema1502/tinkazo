import { CENTAVO, DOLAR, LLEGA_MINIMO_DEL_RETIRO } from "../campana/comision";
import { costoDelRetiro, cuentaDelRetiro, leerLaCuenta } from "./retiro-config";

/**
 * La configuración de lo que Tinkazo cobra a una campaña de empresa antes de abrir la inscripción. Son tres variables del
 * build y van juntas:
 *
 * - `VITE_COMISION_PB`: los puntos básicos del total de los premios, un entero de 1 a 1.000 (200 es el 2 %).
 * - `VITE_COMISION_MINIMO`: lo menos que se cobra, en dólares digitales con punto y hasta dos decimales (centavos justos).
 * - `VITE_COMISION_CUENTA`: la cuenta de Tinkazo que recibe el cobro. Una cuenta común que no es la de cobros del portero
 *   ni ninguna otra suya. Su dirección no se escribe en el código: sale solo de esta variable.
 *
 * El cobro viaja por el camino del retiro (`VITE_RETIRO_COSTO`, `retiro-config.ts`): una transacción con dos pagos. Por eso
 * el mínimo no puede bajar de lo que el retiro permite (el costo más 1 dólar), y sin el costo del retiro configurado no hay
 * cobro. Sin las tres variables, la comisión está apagada y nada cambia en ninguna pantalla.
 *
 * Es un archivo sin nada del navegador a propósito: lo lee también `vite.config.ts`.
 */

type Entorno = Record<string, unknown>;

/** Los puntos básicos y el mínimo leídos del entorno: sin poner, mal escritos, o un valor bueno. */
export type LecturaDeNumero = { tipo: "vacio" } | { tipo: "mal-escrito" } | { tipo: "valido"; valor: bigint };

const FORMA_DEL_PB = /^\d{1,4}$/;
const FORMA_DEL_MINIMO = /^\d{1,3}(\.\d{1,2})?$/;

/** Los puntos básicos más altos que se aceptan: 1.000 son el 10 %. Arriba de eso es un error de escritura. */
export const TOPE_DE_PB = 1_000n;

const texto = (crudo: unknown): string | null | undefined => {
  if (crudo === undefined || crudo === null) return undefined;
  if (typeof crudo !== "string") return null;
  return crudo.trim();
};

/** Lee `VITE_COMISION_PB`. Fuera de 1 a 1.000 es mal escrito: el build no deja salir ese valor. */
export function leerPb(crudo: unknown): LecturaDeNumero {
  const s = texto(crudo);
  if (s === undefined || s === "") return { tipo: "vacio" };
  if (s === null || !FORMA_DEL_PB.test(s)) return { tipo: "mal-escrito" };
  const pb = BigInt(s);
  return pb >= 1n && pb <= TOPE_DE_PB ? { tipo: "valido", valor: pb } : { tipo: "mal-escrito" };
}

/** Lee `VITE_COMISION_MINIMO` a stroops, en centavos justos y sin redondear. Cero es mal escrito. */
export function leerMinimo(crudo: unknown): LecturaDeNumero {
  const s = texto(crudo);
  if (s === undefined || s === "") return { tipo: "vacio" };
  if (s === null || !FORMA_DEL_MINIMO.test(s)) return { tipo: "mal-escrito" };
  const [enteros = "0", decimales = ""] = s.split(".");
  const stroops = BigInt(enteros) * DOLAR + BigInt(decimales.padEnd(2, "0")) * CENTAVO;
  return stroops > 0n ? { tipo: "valido", valor: stroops } : { tipo: "mal-escrito" };
}

/** Lo que el sitio necesita para cobrar: el porcentaje, el mínimo, la cuenta que recibe, el costo del retiro y la cuenta de cobros. */
export interface ConfigDeComision {
  pb: bigint;
  minimo: bigint;
  cuenta: string;
  costo: bigint;
  cobros: string;
}

/** Lo menos que puede valer el mínimo: el costo del retiro más lo que tiene que llegar. */
export const minimoPosible = (costo: bigint): bigint => costo + LLEGA_MINIMO_DEL_RETIRO;

/**
 * La configuración del cobro, o `null` si está apagada: sin alguna de las tres variables, con una fuera de forma, sin el costo
 * del retiro, con la cuenta igual a la de cobros o con un mínimo que el camino del retiro no puede pagar. Con cualquier cosa
 * rara devuelve `null` y el panel queda como hoy: lo que el build no deja salir, tampoco prende acá.
 */
export function comisionDelBuild(env: Entorno): ConfigDeComision | null {
  const pb = leerPb(env.VITE_COMISION_PB);
  const minimo = leerMinimo(env.VITE_COMISION_MINIMO);
  const cuenta = leerLaCuenta(env.VITE_COMISION_CUENTA);
  if (pb.tipo !== "valido" || minimo.tipo !== "valido" || cuenta.tipo !== "valida") return null;
  const costo = costoDelRetiro(env);
  const cobros = cuentaDelRetiro(env);
  if (costo === null || cobros === null || cuenta.cuenta === cobros) return null;
  if (minimo.valor < minimoPosible(costo)) return null;
  return { pb: pb.valor, minimo: minimo.valor, cuenta: cuenta.cuenta, costo, cobros };
}

/**
 * Los valores de la sección `[env.mainnet.vars]` de `workers/patrocinio/wrangler.toml` que se piden, leídos del texto. Solo
 * lee: no escribe ni toca el archivo. Lo que no está queda fuera.
 */
export function variablesDelPorteroEnElToml(toml: string, nombres: readonly string[]): Record<string, string> {
  const salida: Record<string, string> = {};
  let seccion = "";
  for (const linea of toml.split(/\r?\n/)) {
    const encabezado = /^\s*\[{1,2}([^\]]+)\]{1,2}\s*(?:#.*)?$/.exec(linea);
    if (encabezado) {
      seccion = (encabezado[1] ?? "").trim();
      continue;
    }
    if (seccion !== "env.mainnet.vars") continue;
    const valor = /^\s*([A-Z0-9_]+)\s*=\s*"([^"]*)"/.exec(linea);
    const nombre = valor?.[1];
    if (valor && nombre !== undefined && nombres.includes(nombre)) salida[nombre] = (valor[2] ?? "").trim();
  }
  return salida;
}

/** Las cuentas del portero de la red principal (la patrocinadora, la de cobros y la sorteadora), sin las vacías. */
export function cuentasDelPorteroEnElToml(toml: string): string[] {
  const v = variablesDelPorteroEnElToml(toml, ["CUENTA_PATROCINADORA", "CUENTA_COBROS", "CUENTA_SORTEADORA"]);
  return Object.values(v).filter((c) => c !== "");
}

/** El costo del retiro que exige el portero, en stroops, leído de `COSTO_RETIRO`, o `null` si no está o no tiene forma. */
export function costoDelRetiroDelToml(toml: string): bigint | null {
  const crudo = variablesDelPorteroEnElToml(toml, ["COSTO_RETIRO"]).COSTO_RETIRO;
  if (crudo === undefined || !/^\d{1,3}(\.\d{1,7})?$/.test(crudo)) return null;
  const [enteros = "0", decimales = ""] = crudo.split(".");
  return BigInt(enteros) * DOLAR + BigInt(decimales.padEnd(7, "0"));
}

/** ¿El portero de la red principal atiende retiros? `RETIROS` en `1`. */
export const retirosDelToml = (toml: string): boolean => variablesDelPorteroEnElToml(toml, ["RETIROS"]).RETIROS === "1";
