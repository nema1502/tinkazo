import { esCuenta } from "../../workers/cuenta/src/reglas";
import { SITIOS_DE_PRODUCCION } from "./patrocinio-config";

/**
 * Las banderas de las monedas, de la carga de saldo y del plan del equipo, y dónde está el Worker de la cuenta
 * (`workers/cuenta`), en un solo lugar. Todas nacen apagadas: prenderlas es una decisión de quien dirige el proyecto.
 *
 * - `VITE_MONEDAS=1`: "Tus monedas" y "Tu tiendita" en el panel de la cuenta, y "Canjear" para quien organiza.
 * - `VITE_RAMPA=meru|pollar`: "Cargá tu saldo". Sin ella (o con otra cosa), no se ofrece.
 * - `VITE_PLAN_EQUIPO=1` y `VITE_CUENTA_PLANES=G…`: la compra del plan del equipo. Sin las dos, no se ofrece.
 * - `VITE_CUENTA_URL`: el Worker. En tinkazo.app y www.tinkazo.app, con las monedas prendidas, vale `cuenta.tinkazo.app`.
 */

/** El Worker de la cuenta, desplegado en el dominio del proyecto. */
export const CUENTA_POR_DEFECTO = "https://cuenta.tinkazo.app";

export type ModoDeRampa = "meru" | "pollar" | "apagada";

export interface EntornoDeCuenta {
  /** Lo que trae `VITE_MONEDAS`. */
  monedas?: string | undefined;
  /** Lo que trae `VITE_RAMPA`. */
  rampa?: string | undefined;
  /** Lo que trae `VITE_PLAN_EQUIPO`. */
  plan?: string | undefined;
  /** Lo que trae `VITE_CUENTA_PLANES`. */
  cuentaPlanes?: string | undefined;
  /** Lo que trae `VITE_CUENTA_URL`. */
  url?: string | undefined;
  /** El `location.hostname` de la página. */
  host?: string | undefined;
}

const hostActual = (): string => (typeof location !== "undefined" && typeof location.hostname === "string" ? location.hostname : "");

/** El entorno del build, tal cual viene. */
export function entornoDeCuenta(): EntornoDeCuenta {
  const e = import.meta.env;
  return {
    monedas: e.VITE_MONEDAS as string | undefined,
    rampa: e.VITE_RAMPA as string | undefined,
    plan: e.VITE_PLAN_EQUIPO as string | undefined,
    cuentaPlanes: e.VITE_CUENTA_PLANES as string | undefined,
    url: e.VITE_CUENTA_URL as string | undefined,
    host: hostActual(),
  };
}

const prendida = (x: string | undefined): boolean => ["1", "true", "si", "sí", "on", "encendida"].includes((x ?? "").trim().toLowerCase());

export function modoDeRampa(e: EntornoDeCuenta = entornoDeCuenta()): ModoDeRampa {
  const r = (e.rampa ?? "").trim().toLowerCase();
  return r === "meru" || r === "pollar" ? r : "apagada";
}

export const monedasActivas = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => prendida(e.monedas);

/** Dónde está el Worker, o `null` si las monedas están apagadas o no hay a dónde hablar (localhost sin `VITE_CUENTA_URL`). */
export function urlDeCuenta(e: EntornoDeCuenta = entornoDeCuenta()): string | null {
  if (!prendida(e.monedas)) return null;
  const puesta = (e.url ?? "").trim().replace(/\/+$/, "");
  if (puesta) return puesta;
  return SITIOS_DE_PRODUCCION.includes((e.host ?? "").trim().toLowerCase()) ? CUENTA_POR_DEFECTO : null;
}

/** El plan del equipo: la cuenta que cobra, si la bandera está prendida, la cuenta es una dirección de verdad y hay Worker. */
export function planDelEquipo(e: EntornoDeCuenta = entornoDeCuenta()): { cuenta: string } | null {
  const cuenta = (e.cuentaPlanes ?? "").trim();
  if (!prendida(e.plan) || !esCuenta(cuenta) || urlDeCuenta(e) === null) return null;
  return { cuenta };
}
