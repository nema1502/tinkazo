#!/usr/bin/env node
/**
 * Avisa cuando la red de Stellar cambia lo que cuesta guardar datos en Soroban.
 *
 * El 25 de octubre de 2026 el sello de testnet pasó de 0,7 a 69 XLM porque el
 * estado vivo de la red cruzó su objetivo, y a las 13:34 la SDF subió ese
 * objetivo de 4.000 a 7.000 MB sin anunciarlo. Este guion mira, en testnet y en
 * mainnet, tres cosas:
 *
 *   1. los 17 parámetros de costo de Soroban y el protocolo, contra la línea
 *      base de `scripts/vigilar-red.base.json`: si cambia uno, avisa y lo nombra;
 *   2. el estado vivo (el promedio de la ventana, que es lo que paga la renta)
 *      contra los niveles: mainnet amarillo 2.000 MB, naranja 2.500 y rojo 2.850;
 *      testnet rojo 6.000;
 *   3. la pendiente de las últimas 24 horas y cuántas horas faltan para el rojo
 *      si sigue así (informativo: no hace fallar la corrida).
 *
 * Solo lee, del RPC público de cada red. Sin dependencias: Node 22 y `fetch`.
 * Lo corre `.github/workflows/vigilar-red.yml` cada media hora; GitHub avisa por
 * correo cuando la corrida falla. La explicación está en docs/deployments.md,
 * «Vigilancia de la red».
 *
 * Uso:
 *   node scripts/vigilar-red.mjs                       # las dos redes
 *   node scripts/vigilar-red.mjs --red mainnet         # una sola
 *   node scripts/vigilar-red.mjs --json                # lo mismo, en una línea de JSON
 *   node scripts/vigilar-red.mjs --actualizar-base     # la red cambió y el cambio es legítimo
 *
 * Sale con 0 si todo está igual; con 1 si cambió un parámetro, si mainnet llegó
 * a amarillo o más, o si testnet llegó a 6.000 MB; con 2 si no se pudo mirar
 * (sin RPC o sin línea base).
 */

import { readFile, writeFile } from "node:fs/promises";
import {
  NETWORKS,
  analyze,
  annotation,
  buildBase,
  decide,
  describeChange,
  diffParams,
  formatReport,
  readNetwork,
  serializeBase,
  toJson,
} from "./lib/vigilar-red.mjs";

const BASE_FILE = new URL("./vigilar-red.base.json", import.meta.url);

const HELP = `Avisa cuando la red de Stellar cambia lo que cuesta guardar datos en Soroban.

  node scripts/vigilar-red.mjs [--red testnet|mainnet] [--json]
  node scripts/vigilar-red.mjs --actualizar-base [--red testnet|mainnet]

  --red NOMBRE         Mira solo esa red (por defecto, las dos).
  --json               Imprime el resultado en una sola línea de JSON.
  --actualizar-base    Guarda como línea base lo que la red dice hoy. Usarlo solo
                       cuando un cambio es legítimo; después hay que commitear
                       scripts/vigilar-red.base.json.
  --ayuda              Esta ayuda.

Sale con 0 si todo está igual, con 1 si hay una alarma y con 2 si no se pudo mirar.`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Una llamada al RPC, con tres intentos salvo que se pidan menos: los RPC públicos tienen sus malos ratos. */
async function rpcCall(url, method, params, { attempts = 3 } = {}) {
  // `getLedgers` trae el ledger entero (en mainnet, varios MB); lo demás es chico.
  const timeoutMs = method === "getLedgers" ? 40_000 : 20_000;
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) {
        const error = new Error(body.error.message ?? "error del RPC");
        // Parámetros inválidos (-32602) o método inexistente (-32601): pedir lo mismo da lo mismo.
        error.permanent = body.error.code === -32602 || body.error.code === -32601;
        throw error;
      }
      return body.result;
    } catch (e) {
      last = e;
      if (e.permanent) break;
      if (attempt < attempts) await sleep(attempt * 3000);
    }
  }
  throw new Error(`${method}: ${last.message}`);
}

async function readBase() {
  try {
    return JSON.parse(await readFile(BASE_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`no se pudo leer la línea base: ${e.message}`);
  }
}

function option(args, name) {
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i < 0) return null;
  return args[i].includes("=") ? args[i].split("=")[1] : (args[i + 1] ?? null);
}

async function updateBase({ names, reads, failures, previous, when }) {
  const failed = Object.entries(failures);
  if (failed.length > 0) {
    for (const [network, message] of failed) console.error(`${network}: no se pudo mirar (${message}); la línea base no se tocó.`);
    return 2;
  }
  const next = buildBase(previous, reads, when);
  await writeFile(BASE_FILE, serializeBase(next));
  console.log("Línea base actualizada (scripts/vigilar-red.base.json). Falta commitearla.");
  for (const network of names) {
    const before = previous?.networks?.[network];
    if (!before) {
      console.log(`  ${network}: primera vez, ${Object.keys(reads[network].params).length} valores guardados`);
      continue;
    }
    const changes = diffParams(before.params, reads[network].params);
    if (changes.length === 0) console.log(`  ${network}: sin diferencias con la anterior`);
    for (const c of changes) console.log(`  ${network}: ${describeChange(c)}`);
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--ayuda") || args.includes("-h")) {
    console.log(HELP);
    return 0;
  }
  const only = option(args, "--red");
  if (only && !NETWORKS[only]) {
    console.error(`La red «${only}» no existe: son ${Object.keys(NETWORKS).join(" y ")}.`);
    return 2;
  }
  const names = only ? [only] : Object.keys(NETWORKS);

  const when = new Date();
  const settled = await Promise.allSettled(
    names.map((network) => readNetwork((method, params, options) => rpcCall(NETWORKS[network].rpcUrl, method, params, options))),
  );
  const reads = {};
  const failures = {};
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") reads[names[i]] = s.value;
    else failures[names[i]] = s.reason?.message ?? String(s.reason);
  });

  let base;
  try {
    base = await readBase();
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  if (args.includes("--actualizar-base")) return updateBase({ names, reads, failures, previous: base, when });

  const results = names.map((network) =>
    failures[network]
      ? { network, error: failures[network] }
      : analyze(network, reads[network], base?.networks?.[network] ?? null),
  );
  const decision = decide(results);
  if (args.includes("--json")) {
    console.log(JSON.stringify(toJson({ when, results, decision })));
  } else {
    console.log(formatReport({ when, results, decision }));
    if (process.env.GITHUB_ACTIONS === "true") {
      for (const a of decision.alerts) console.log(annotation(`${a.network}: ${a.message}`));
      for (const e of decision.errors) console.log(annotation(`${e.network}: sin mirar: ${e.message}`));
    }
  }
  return decision.code;
}

process.exitCode = await main();
