import { esCuenta } from "../../workers/cuenta/src/reglas";
import { SITIOS_DE_PRODUCCION } from "./patrocinio-config";

/**
 * Las banderas de las monedas, de «Tus dólares digitales» y del plan del equipo, y dónde está el Worker de la cuenta
 * (`workers/cuenta`), en un solo lugar. Todas nacen apagadas: prenderlas es una decisión de quien dirige el proyecto.
 *
 * - `VITE_MONEDAS=1`: "Tus monedas" y "Tu tiendita" en el panel de la cuenta, y "Canjear" para quien organiza.
 * - `VITE_RAMPA`: «Tus dólares digitales». Con `pollar`, la ventana entera (cargar con bolivianos, traer y mandar); con
 *   `recibir` (o `meru`, el nombre de antes), solo traer y mandar; con `premios`, solo ver el saldo y recibir un premio,
 *   y nada más (Mandar se niega en el código). Sin ella, o con otra cosa, no se ofrece nada.
 * - `VITE_RAMPA_CUENTAS=G…,G…`: si tiene alguna cuenta, cargar con bolivianos se ofrece solo a esas. No esconde una carga
 *   que ya está en camino.
 * - `VITE_RAMPA_MINIMO`, `VITE_RAMPA_DEMO=1` y `VITE_RAMPA_PRACTICA=1`: solo en `localhost` (el mínimo para una prueba,
 *   la ventana con datos inventados y la práctica en la red de prueba). En cualquier otro sitio no hacen nada.
 * - `VITE_RAMPA_REGISTRO=1`: el registro de la carga en la consola.
 * - `VITE_PLAN_EQUIPO=1` y `VITE_CUENTA_PLANES=G…`: la compra del plan del equipo. Sin las dos, no se ofrece.
 * - `VITE_CUENTA_URL`: el Worker. En tinkazo.app y www.tinkazo.app, con las monedas prendidas, vale `cuenta.tinkazo.app`.
 * - `VITE_VOTO_POR_CONTENIDO=1`: que, en la red principal, el navegador de una cuenta de Google o de correo vote solo la
 *   transacción que armó la página (issue 180). Vacía o `0`, apagada, y cualquier otro valor frena el build
 *   (`premios-build.ts`). Esta lectura no mira la red ni decide nada por sí sola: quien la usa pregunta además por la red
 *   principal y por si el kit de cuentas de verdad tomó el voto a mano. Todavía nada la usa.
 */

/** El Worker de la cuenta, desplegado en el dominio del proyecto. */
export const CUENTA_POR_DEFECTO = "https://cuenta.tinkazo.app";

export type ModoDeRampa = "pollar" | "recibir" | "premios" | "apagada";

/**
 * En qué modos de la rampa la puerta del premio frena, en la red principal, el sello y el sorteo de una cuenta de Google
 * o de correo que puede guardar dinero, mientras el kit de cuentas no vote a mano lo que armó la página (issue 180).
 *
 * Son `premios`, `recibir` y `apagada`: un build sin `VITE_RAMPA` también cuida el premio, así que esconder la ventana
 * de los dólares digitales no deja a una cuenta con dinero firmando por hash. `pollar` queda afuera porque la venta
 * paga con el saldo de la cuenta y frenarla rompería la compra. Quien suma un modo nuevo a `ModoDeRampa` tiene que
 * decidir acá si entra (la prueba lo exige).
 *
 * Todavía nada la usa: la puerta de `wallet-pollar.ts` y la consulta adelantada de `freeze.ts` la leerán junto con el
 * voto a mano, que es lo que levanta la puerta. Está congelada para que ningún código la cambie en ejecución.
 */
export const PUERTA_DEL_PREMIO_EN: readonly ModoDeRampa[] = Object.freeze<ModoDeRampa[]>(["premios", "recibir", "apagada"]);

export interface EntornoDeCuenta {
  /** Lo que trae `VITE_MONEDAS`. */
  monedas?: string | undefined;
  /** Lo que trae `VITE_RAMPA`. */
  rampa?: string | undefined;
  /** Lo que trae `VITE_RAMPA_CUENTAS`. */
  rampaCuentas?: string | undefined;
  /** Lo que trae `VITE_RAMPA_MINIMO`. */
  rampaMinimo?: string | undefined;
  /** Lo que trae `VITE_RAMPA_DEMO`. */
  rampaDemo?: string | undefined;
  /** Lo que trae `VITE_RAMPA_REGISTRO`. */
  rampaRegistro?: string | undefined;
  /** Lo que trae `VITE_RAMPA_PRACTICA`. */
  rampaPractica?: string | undefined;
  /** Lo que trae `VITE_PLAN_EQUIPO`. */
  plan?: string | undefined;
  /** Lo que trae `VITE_CUENTA_PLANES`. */
  cuentaPlanes?: string | undefined;
  /** Lo que trae `VITE_CUENTA_URL`. */
  url?: string | undefined;
  /** Lo que trae `VITE_VOTO_POR_CONTENIDO`. */
  votoPorContenido?: string | undefined;
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
    rampaCuentas: e.VITE_RAMPA_CUENTAS as string | undefined,
    rampaMinimo: e.VITE_RAMPA_MINIMO as string | undefined,
    rampaDemo: e.VITE_RAMPA_DEMO as string | undefined,
    rampaRegistro: e.VITE_RAMPA_REGISTRO as string | undefined,
    rampaPractica: e.VITE_RAMPA_PRACTICA as string | undefined,
    plan: e.VITE_PLAN_EQUIPO as string | undefined,
    cuentaPlanes: e.VITE_CUENTA_PLANES as string | undefined,
    url: e.VITE_CUENTA_URL as string | undefined,
    votoPorContenido: e.VITE_VOTO_POR_CONTENIDO as string | undefined,
    host: hostActual(),
  };
}

const prendida = (x: string | undefined): boolean => ["1", "true", "si", "sí", "on", "encendida"].includes((x ?? "").trim().toLowerCase());

/** La página corre en la máquina de quien prueba: lo único donde valen las banderas de prueba. */
const enLocal = (host: string | undefined): boolean => ["localhost", "127.0.0.1", "[::1]", "::1"].includes((host ?? "").trim().toLowerCase());

export function modoDeRampa(e: EntornoDeCuenta = entornoDeCuenta()): ModoDeRampa {
  const r = (e.rampa ?? "").trim().toLowerCase();
  if (r === "pollar") return "pollar";
  if (r === "recibir" || r === "meru") return "recibir";
  if (r === "premios") return "premios";
  return "apagada";
}

/** Las cuentas del piloto de la carga con bolivianos, sin repetir. Lo que no es una dirección se descarta. Vacía: no hay lista. */
export function cuentasDelPiloto(e: EntornoDeCuenta = entornoDeCuenta()): string[] {
  const crudo = e.rampaCuentas ?? "";
  return [...new Set(crudo.split(/[\s,;]+/).filter((c) => c !== "" && esCuenta(c)))];
}

/** El mínimo en bolivianos para una prueba de la carga, solo en `localhost`; `null` si no hay uno que valga. */
export function minimoDePrueba(e: EntornoDeCuenta = entornoDeCuenta()): number | null {
  if (!enLocal(e.host)) return null;
  const m = (e.rampaMinimo ?? "").trim();
  if (!/^\d{1,6}$/.test(m)) return null;
  const n = Number(m);
  return n > 0 ? n : null;
}

/** La ventana con datos inventados, sin red: solo en `localhost`. */
export const demoDeRampa = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => enLocal(e.host) && prendida(e.rampaDemo);

/** La práctica con dólares digitales de prueba en la red de prueba: solo en `localhost`. */
export const practicaDeRampa = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => enLocal(e.host) && prendida(e.rampaPractica);

/** El registro de la carga en la consola. */
export const registroDeRampa = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => prendida(e.rampaRegistro);

export const monedasActivas = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => prendida(e.monedas);

/**
 * Si el build pide el voto por contenido (`VITE_VOTO_POR_CONTENIDO`). Vale solo con un `1` exacto: ni un espacio, ni
 * `true`, ni `si`. El build no deja pasar esos valores (`problemasDelVoto`, `premios-build.ts`) y, ante la duda, acá queda
 * apagada. No mira la red ni el kit de cuentas: lo que se levanta con el voto depende de que el cliente armado de verdad
 * vote a mano, no de esta bandera.
 */
export const votoPorContenido = (e: EntornoDeCuenta = entornoDeCuenta()): boolean => e.votoPorContenido === "1";

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
