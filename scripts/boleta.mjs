#!/usr/bin/env node
/**
 * La boleta de un juego, armada con JSON que los auditores ya dejaron. Sin red ni Chrome.
 *
 *   node scripts/boleta.mjs <juego> --de docs/capturas/auditorias/<fecha>.json[,otro.json]
 *                           [--delatores detalle.json] [--nino docs/capturas/nino/<juego>/veredicto.json]
 *                           [--vetos docs/boletas-vetos.json] [--out docs/capturas/boletas/<juego>.md] [--json]
 *
 * - `--de`: informes de `pnpm audit:todo`, líneas de resumen sueltas o una salida de texto con
 *   líneas JSON (la de `audit-nino --juzgar --json`, por ejemplo). Varios, separados por coma.
 * - `--delatores`: el detalle de `audit-delatores --json <archivo>`, para el Bayes máximo.
 * - Sin `--nino`, usa `docs/capturas/nino/<juego>/veredicto.json` si existe.
 * - Escribe `docs/capturas/boletas/<juego>.md` (sin versionar) y, con `--json`, termina con
 *   una línea {"auditor":"boleta","objetivo":<juego>,"aprobadas":N,"total":8,…}.
 * - Sale con 1 si la boleta no aprueba (alguna fila roja o gris).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { corridasDeTexto, resumenDeBoleta } from "./lib/boleta.mjs";
import { escribirBoleta } from "./lib/boleta-archivo.mjs";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const juego = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};

if (!juego) {
  console.error("uso: node scripts/boleta.mjs <juego> --de <informe.json>[,otro.json]");
  process.exit(2);
}
const desde = (opt("--de", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!desde.length) {
  console.error("falta --de: el informe de `pnpm audit:todo` (docs/capturas/auditorias/<fecha>.json)");
  process.exit(2);
}
const inicio = Date.now();
const corridas = [];
for (const ruta of desde) {
  if (!existsSync(ruta)) {
    console.error(`no existe ${ruta}`);
    process.exit(2);
  }
  corridas.push(...corridasDeTexto(readFileSync(ruta, "utf8")));
}

const { boleta, md, salida } = escribirBoleta({
  raiz,
  juego,
  corridas,
  vetos: resolve(raiz, opt("--vetos", "docs/boletas-vetos.json")),
  nino: opt("--nino", resolve("docs", "capturas", "nino", juego, "veredicto.json")),
  delatores: opt("--delatores", ""),
  salida: opt("--out", ""),
});
console.log(md);
console.log(`escrita en ${salida}`);
if (args.includes("--json")) console.log(JSON.stringify(resumenDeBoleta(boleta, (Date.now() - inicio) / 1000)));
process.exitCode = boleta.aprueba ? 0 : 1;
