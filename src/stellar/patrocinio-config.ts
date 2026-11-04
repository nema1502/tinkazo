import { network } from "./config";

/**
 * Dónde está el portero del patrocinio, en un solo lugar.
 *
 * - Si el build trae `VITE_PATROCINIO_URL`, manda esa dirección, en cualquier sitio y en cualquier red.
 * - Si no la trae, el sitio de producción (`tinkazo.app` y `www.tinkazo.app`) usa el portero de testnet por defecto.
 *   Nunca en `localhost`, en las vistas previas ni en los auditores: ahí sigue sin portero, como antes. Y solo en
 *   testnet: ese portero paga comisiones de testnet, y el de mainnet tendrá su propia dirección cuando exista.
 *
 * Con la dirección por defecto el portero no es condición para sellar: si no contesta, el sitio paga como
 * siempre (`patrocinador.ts`). Con la variable puesta a mano se mantiene lo de antes: cerrado ante la duda.
 */

/** El portero de testnet, desplegado en el dominio del proyecto. */
export const PORTERO_POR_DEFECTO = "https://p.tinkazo.app";

/** Los únicos sitios donde la dirección por defecto rige. */
export const SITIOS_DE_PRODUCCION: readonly string[] = ["tinkazo.app", "www.tinkazo.app"];

export interface ConfigDelPortero {
  /** La dirección sin barra al final, o `null` si no hay portero (entonces rige Pollar y no se consulta nada). */
  url: string | null;
  /** `true` si la dirección no viene del build sino de este archivo. */
  porDefecto: boolean;
}

export interface EntornoDelPortero {
  /** Lo que trae `VITE_PATROCINIO_URL`. */
  variable?: string | undefined;
  /** El `location.hostname` de la página. */
  host?: string | undefined;
  /** La red del build. */
  red?: string | undefined;
}

const hostActual = (): string => (typeof location !== "undefined" && typeof location.hostname === "string" ? location.hostname : "");

/** Resuelve la dirección del portero. Cada pedazo del entorno se puede pasar a mano (las pruebas). */
export function configDelPortero(e: EntornoDelPortero = {}): ConfigDelPortero {
  const crudo = e.variable === undefined ? ((import.meta.env.VITE_PATROCINIO_URL ?? "") as string) : e.variable;
  const puesta = String(crudo).trim().replace(/\/+$/, "");
  if (puesta) return { url: puesta, porDefecto: false };
  const host = (e.host === undefined ? hostActual() : e.host).trim().toLowerCase();
  const red = e.red === undefined ? network.name : e.red;
  if (red === "testnet" && SITIOS_DE_PRODUCCION.includes(host)) return { url: PORTERO_POR_DEFECTO, porDefecto: true };
  return { url: null, porDefecto: false };
}
