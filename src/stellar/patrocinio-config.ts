import { network } from "./config";

/**
 * Dónde está el portero del patrocinio, uno por red, en un solo lugar.
 *
 * - Si el build trae la variable de esta red (`VITE_PATROCINIO_URL_TESTNET` en
 *   Prueba o `VITE_PATROCINIO_URL_MAINNET` en Oficial), manda esa dirección.
 *   La de una red nunca vale para la otra.
 * - Si no la trae, en Prueba vale la vieja (`VITE_PATROCINIO_URL`), para que lo
 *   que ya está desplegado siga igual. En Oficial la vieja nunca vale.
 * - Si no hay ninguna, el sitio de producción (`tinkazo.app` y `www.tinkazo.app`)
 *   usa en Prueba el portero de siempre por defecto. Nunca en `localhost`, en
 *   las vistas previas ni en los auditores: ahí sigue sin portero, como antes.
 *   En Oficial sin su variable no hay portero por defecto.
 *
 * Sin portero configurado para esta red, Prueba funciona como antes de que
 * existiera el portero: paga Pollar. Con la dirección por defecto el portero
 * no es condición para sellar: si no contesta, el sitio paga como siempre
 * (`patrocinador.ts`). Con la variable puesta a mano, cerrado ante la duda.
 */

/** El portero de Prueba, desplegado en el dominio del proyecto. */
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
  /** Lo que trae `VITE_PATROCINIO_URL_MAINNET`. Solo vale en Oficial. */
  variableMainnet?: string | undefined;
  /** Lo que trae `VITE_PATROCINIO_URL_TESTNET`. Solo vale en Prueba. */
  variableTestnet?: string | undefined;
  /** Lo que trae la vieja `VITE_PATROCINIO_URL`. Solo vale en Prueba. */
  variableLegacy?: string | undefined;
  /** El `location.hostname` de la página. */
  host?: string | undefined;
  /** La red del modo vigente. */
  red?: string | undefined;
}

const hostActual = (): string => (typeof location !== "undefined" && typeof location.hostname === "string" ? location.hostname : "");

/** Resuelve la dirección del portero de esta red. Cada pedazo del entorno se puede pasar a mano (las pruebas). */
export function configDelPortero(e: EntornoDelPortero = {}): ConfigDelPortero {
  const red = e.red === undefined ? network.name : e.red;
  const deEstaRed = red === "mainnet" ? e.variableMainnet : e.variableTestnet;
  const delBuild =
    red === "mainnet"
      ? (import.meta.env.VITE_PATROCINIO_URL_MAINNET as string | undefined)
      : (import.meta.env.VITE_PATROCINIO_URL_TESTNET as string | undefined);
  const crudo = deEstaRed === undefined ? (delBuild ?? "") : deEstaRed;
  const puesta = String(crudo).trim().replace(/\/+$/, "");
  if (puesta) return { url: puesta, porDefecto: false };
  // Sin la variable nueva, en Prueba vale la vieja, como antes de esta rama.
  if (red === "testnet") {
    const crudaVieja = e.variableLegacy === undefined ? ((import.meta.env.VITE_PATROCINIO_URL ?? "") as string) : e.variableLegacy;
    const vieja = String(crudaVieja).trim().replace(/\/+$/, "");
    if (vieja) return { url: vieja, porDefecto: false };
  }
  const host = (e.host === undefined ? hostActual() : e.host).trim().toLowerCase();
  if (red === "testnet" && SITIOS_DE_PRODUCCION.includes(host)) return { url: PORTERO_POR_DEFECTO, porDefecto: true };
  return { url: null, porDefecto: false };
}
