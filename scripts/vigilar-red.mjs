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
 * Solo lee, del RPC público de cada red (mainnet tiene dos de respaldo). Sin
 * dependencias: Node 22 y `fetch`. Lo corre `.github/workflows/vigilar-red.yml`
 * cada media hora, y una vez al día con `--diario`; GitHub avisa por correo
 * cuando la corrida falla. Para que falle solo cuando hay algo nuevo que decir,
 * lo que ya se avisó se guarda entre corridas (`--anterior` y `--guardar`; en
 * GitHub, en la caché de Actions): el nivel de cada red y la huella de los
 * parámetros que ya se avisaron. La explicación está en docs/deployments.md,
 * «Vigilancia de la red».
 *
 * Uso:
 *   node scripts/vigilar-red.mjs                       # las dos redes, sin memoria
 *   node scripts/vigilar-red.mjs --red mainnet         # una sola
 *   node scripts/vigilar-red.mjs --json                # lo mismo, en una línea de JSON
 *   node scripts/vigilar-red.mjs --anterior N.json --guardar N.json   # con lo que ya se avisó
 *   node scripts/vigilar-red.mjs --diario              # el recordatorio: falla también con naranja estable o con la base vieja
 *   node scripts/vigilar-red.mjs --actualizar-base --red mainnet   # la red cambió y el cambio es legítimo
 *
 * Sale con 0 si no hay novedades; con 1 si cambió un parámetro y es la primera
 * vez que se ve (con la base todavía vieja, las corridas que siguen pasan y
 * `--diario` la recuerda), si el nivel de una red se movió respecto de la corrida
 * anterior (sin memoria, cualquier nivel y cualquier cambio cuentan como nuevos),
 * si una red está en rojo o si, con `--diario`, está en naranja; con 2 si no se
 * pudo mirar (sin RPC, o sin línea base).
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  NETWORKS,
  annotation,
  buildBase,
  describeChange,
  diffParams,
  emptyState,
  evaluate,
  formatReport,
  makeCaller,
  parseState,
  readNetwork,
  serializeBase,
  serializeState,
  summarize,
  toJson,
} from "./lib/vigilar-red.mjs";

const BASE_FILE = new URL("./vigilar-red.base.json", import.meta.url);

const HELP = `Avisa cuando la red de Stellar cambia lo que cuesta guardar datos en Soroban.

  node scripts/vigilar-red.mjs [--red testnet|mainnet] [--json] [--diario]
      [--anterior ARCHIVO] [--guardar ARCHIVO]
  node scripts/vigilar-red.mjs --actualizar-base [--red testnet|mainnet]

  --red NOMBRE         Mira solo esa red (por defecto, las dos).
  --json               Imprime el resultado en una sola línea de JSON.
  --anterior ARCHIVO   Lee de ahí lo que ya se avisó: el nivel de cada red en la corrida
                       anterior y la huella de los parámetros que ya se avisaron (si no
                       existe, es «normal» y nada se avisó). Sin esto, cualquier nivel y
                       cualquier cambio de parámetros cuentan como nuevos.
  --guardar ARCHIVO    Escribe ahí lo mismo de esta corrida, falle o no la corrida.
  --diario             El recordatorio de todos los días: falla también si una red
                       sigue en naranja o si la línea base sigue vieja (en rojo falla
                       siempre).
  --actualizar-base    Guarda como línea base lo que la red dice hoy. Usarlo solo
                       cuando un cambio es legítimo; después hay que commitear
                       scripts/vigilar-red.base.json.
  --ayuda              Esta ayuda.

Sale con 0 si no hay novedades, con 1 si hay una alarma y con 2 si no se pudo mirar.`;

async function readBase() {
  try {
    return JSON.parse(await readFile(BASE_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw new Error(`no se pudo leer la línea base: ${e.message}`);
  }
}

/** Lo que ya se avisó en la corrida anterior; sin archivo (la primera vez, o la caché vacía) es «normal» en todas y sin nada avisado. */
async function readState(path) {
  try {
    return parseState(await readFile(path, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`No se pudo leer lo avisado antes (${e.message}); se toma como si nada se hubiera avisado.`);
    return emptyState();
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
  const settled = await Promise.allSettled(names.map((network) => readNetwork(makeCaller(NETWORKS[network].rpcUrls))));
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

  const previousPath = option(args, "--anterior");
  const memory = previousPath ? await readState(previousPath) : emptyState();
  const { results, decision, next } = evaluate({ names, reads, failures, base, memory, daily: args.includes("--diario"), when });

  // Lo avisado se guarda aunque la corrida falle: si no, el aviso se repetiría en cada corrida.
  const savePath = option(args, "--guardar");
  if (savePath) {
    await mkdir(dirname(savePath), { recursive: true });
    await writeFile(savePath, serializeState(next));
  }
  // En GitHub, el resumen queda como salida del paso para ponerlo en el nombre de otro.
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `resumen=${summarize(results)}\ncodigo=${decision.code}\n`);
  }

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
