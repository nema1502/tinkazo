// Los umbrales de la red, para los guiones de Node.
//
// La única fuente es src/stellar/red-umbrales.json: la app lo importa con Vite
// (src/stellar/chequeo-red.ts) y el detector (scripts/vigilar-red.mjs) lo lee de acá. Así los
// dos miran la red con los mismos números y no hay dos listas que se desacomoden. Se lee con
// `readFileSync` y no con `import ... with { type: "json" }`: anda igual en cualquier Node
// reciente, sin avisos de función experimental.
//
// Si el archivo no tiene la forma que el detector espera, esto lanza con el motivo: el
// detector sale con error en vez de comparar contra números que no existen.
import { readFileSync } from "node:fs";

const RUTA = new URL("../../src/stellar/red-umbrales.json", import.meta.url);

const NOMBRES_DE_NIVEL = ["amarillo", "naranja", "rojo"];

/**
 * Comprueba la parte del archivo que lee el detector: los niveles de estado vivo de cada red,
 * de menor a mayor y terminando en rojo, y el porcentaje del objetivo. Lanza con el motivo.
 */
export function validarEstado(umbrales) {
  for (const red of ["testnet", "mainnet"]) {
    const niveles = umbrales?.[red]?.estadoMb;
    if (!Array.isArray(niveles) || niveles.length === 0) throw new Error(`red-umbrales.json: ${red}.estadoMb tiene que ser una lista con niveles`);
    let antes = 0;
    for (const n of niveles) {
      if (!NOMBRES_DE_NIVEL.includes(n?.name)) throw new Error(`red-umbrales.json: ${red}.estadoMb tiene un nivel sin nombre válido (${JSON.stringify(n?.name)})`);
      if (!Number.isFinite(n.mb) || n.mb <= antes) throw new Error(`red-umbrales.json: ${red}.estadoMb tiene que ir de menor a mayor, con MB positivos`);
      antes = n.mb;
    }
    if (niveles.at(-1).name !== "rojo") throw new Error(`red-umbrales.json: el último nivel de ${red}.estadoMb tiene que ser el rojo`);
  }
  const porciento = umbrales?.comun?.rojoPorcientoDelObjetivo;
  if (!Number.isFinite(porciento) || porciento <= 0 || porciento > 100) {
    throw new Error("red-umbrales.json: comun.rojoPorcientoDelObjetivo tiene que estar entre 0 y 100");
  }
  return umbrales;
}

/** El archivo entero, ya comprobado. */
export const UMBRALES = validarEstado(JSON.parse(readFileSync(RUTA, "utf8")));

/** Los niveles de estado vivo por red, en MB: con la forma del `LEVELS` del detector. */
export const LEVELS = { mainnet: UMBRALES.mainnet.estadoMb, testnet: UMBRALES.testnet.estadoMb };

/** El rojo nunca pasa de este porcentaje del objetivo vigente. */
export const RED_PERCENT_OF_TARGET = UMBRALES.comun.rojoPorcientoDelObjetivo;
