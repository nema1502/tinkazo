/**
 * Esperar a que haya memoria libre antes de abrir un Chrome. La máquina de trabajo la comparten varios agentes y un Chrome con
 * la placa de video pide más de un giga: abrirlo con menos libre traba todo. Espera de a tandas, imprimiendo la memoria libre
 * en cada una (un comando callado más de unos minutos lo corta el vigilante de la máquina).
 */
import { freemem } from "node:os";

/** La memoria libre mínima para abrir un Chrome, en GB: 1,2, o lo que diga `TINKAZO_RAM_MINIMA_GB` en una máquina con poca memoria. */
export const RAM_MINIMA_GB = Number(process.env.TINKAZO_RAM_MINIMA_GB) > 0 ? Number(process.env.TINKAZO_RAM_MINIMA_GB) : 1.2;

const gb = (bytes) => bytes / 1024 ** 3;

/**
 * @param minimo   GB libres que hacen falta
 * @param cada     milisegundos entre una mirada y la siguiente
 * @param maximo   milisegundos que se espera como mucho; pasado ese tiempo se sigue igual y se avisa
 * @param libre    la memoria libre en bytes (se puede inyectar para probar)
 * @param dormir   `(ms) => Promise` (se puede inyectar para probar)
 * @param decir    cómo se imprime
 * @returns `{ esperadoMs, libreGB, alcanzo }`
 */
export async function esperarRam({ minimo = RAM_MINIMA_GB, cada = 20_000, maximo = 30 * 60_000, libre = freemem, dormir = (ms) => new Promise((r) => setTimeout(r, ms)), decir = console.log } = {}) {
  let esperado = 0;
  let actual = gb(libre());
  if (actual >= minimo) return { esperadoMs: 0, libreGB: actual, alcanzo: true };
  while (actual < minimo && esperado < maximo) {
    decir(`  esperando RAM: ${actual.toFixed(2)} GB libres, hacen falta ${minimo} (${Math.round(esperado / 1000)} s)`);
    await dormir(cada);
    esperado += cada;
    actual = gb(libre());
  }
  const alcanzo = actual >= minimo;
  decir(alcanzo ? `  RAM libre: ${actual.toFixed(2)} GB, se abre Chrome` : `  RAM libre: ${actual.toFixed(2)} GB tras ${Math.round(esperado / 1000)} s: se abre Chrome igual`);
  return { esperadoMs: esperado, libreGB: actual, alcanzo };
}
