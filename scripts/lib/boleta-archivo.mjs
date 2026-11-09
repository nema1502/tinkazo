/**
 * Arma y guarda la boleta de un juego a partir de corridas ya leídas, con lo que haya en disco
 * (vetos, veredicto de la prueba del niño, tarjetas). La usan `scripts/boleta.mjs` y `pnpm audit:todo --boleta`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { armarBoleta, bayesMaximo, boletaMd, tarjetasDe as tarjetasDeJuegoDe } from "./boleta.mjs";

const leerJson = (ruta) => (existsSync(ruta) ? JSON.parse(readFileSync(ruta, "utf8")) : null);
const leerTs = (raiz, r) => (existsSync(resolve(raiz, r)) ? readFileSync(resolve(raiz, r), "utf8") : "");

/**
 * @param {object} p
 * @param {string} p.raiz        la raíz del repo
 * @param {string} p.juego
 * @param {object[]} p.corridas  las corridas de los auditores (`corridasDe`/`corridasDeTexto`)
 * @param {string} [p.vetos]     ruta de `boletas-vetos.json`
 * @param {string} [p.nino]      ruta del `veredicto.json` de la prueba del niño
 * @param {string} [p.delatores] ruta del detalle de `audit-delatores`
 * @param {string} [p.salida]    dónde escribir el .md
 * @param {string} [p.fecha]
 * @returns {{ boleta: object, md: string, salida: string }}
 */
export function escribirBoleta({ raiz, juego, corridas, vetos, nino, delatores, salida, fecha }) {
  const vetosJuego = leerJson(vetos ?? resolve(raiz, "docs/boletas-vetos.json"))?.[juego] ?? {};
  const ninoJson = leerJson(nino ?? resolve(raiz, "docs", "capturas", "nino", juego, "veredicto.json"));
  const ninoDato = ninoJson ? { pasa: !!ninoJson.pasa, pasan: ninoJson.pasan, semillas: ninoJson.semillas, minimo: ninoJson.minimo } : null;
  const detalle = delatores ? leerJson(delatores) : null;
  const lore = leerTs(raiz, "src/games/lore.ts");
  const catalogo = leerTs(raiz, "src/games/pixi/kit/catalogo.ts");
  const boleta = armarBoleta({ juego, corridas, vetos: vetosJuego, nino: ninoDato, tarjetas: lore ? tarjetasDeJuegoDe(lore, juego, catalogo) : null, bayes: bayesMaximo(detalle) });
  const md = boletaMd(boleta, { fecha: fecha ?? new Date().toISOString().slice(0, 10) });
  const ruta = resolve(salida || resolve(raiz, "docs", "capturas", "boletas", `${juego}.md`));
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, md);
  return { boleta, md, salida: ruta };
}
