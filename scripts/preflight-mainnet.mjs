#!/usr/bin/env node
/**
 * Comprobación previa al despliegue en mainnet.
 *
 * Todo lo que se puede comprobar **sin gastar un centavo**, corrido de una sola
 * vez. En mainnet un error cuesta plata de verdad y no hay deshacer: el
 * contrato es inmutable, no tiene administrador ni actualización.
 *
 * Esto no despliega nada. Cuando todo esté en verde, el despliegue es
 * `scripts/deploy.sh mainnet <identidad> --wasm <archivo> --sha256 <huella>`,
 * primero con `--ensayo`.
 *
 * Uso:
 *   node scripts/preflight-mainnet.mjs --wasm <archivo.wasm> --sha256 <huella>
 *     --account GXXXX… --necesario <XLM> [--sin-pruebas]
 *
 *   --wasm, --sha256  el .wasm del release (en mainnet no se compila acá) y la
 *                     huella del release. Sin --wasm la línea sale «ojo»; sin
 *                     --sha256 muestra la huella calculada para compararla a mano.
 *   --account         la cuenta de despliegue: que exista en mainnet.
 *   --necesario       los XLM que pide la simulación del día. Sin esta opción el
 *                     saldo sale «ojo»: el costo depende de qué tan llena esté la
 *                     red y no hay una cifra fija. Se compara con lo que la cuenta
 *                     puede gastar (el saldo menos su reserva mínima), con un 10 %
 *                     de margen: sin el margen sale «ojo».
 *   --sin-pruebas     no corre `cargo test` ni la suite de Vitest y los marca
 *                     «ojo». Sirve para comprobar el guion, o si las pruebas ya se
 *                     corrieron aparte ese mismo día.
 *
 * Cada corrida de pruebas tiene un tope de 15 minutos (la suite tarda unos 5 con
 * VITEST_MAX_WORKERS=3, el valor por defecto). Si se corta, la fila dice que fue
 * por tiempo y no una prueba roja.
 *
 * Salidas: 0 listo, 1 algo en rojo, 2 una opción mal escrita.
 */

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { correrConTope } from "./lib/correr-con-tope.mjs";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  TOPE_DE_PRUEBAS_MS,
  filaDePruebas,
  huellaDe,
  leerOpciones,
  lineaDeCosto,
  ordenesDeDespliegue,
  reservaDeLaCuenta,
  revisarSaldo,
  revisarWasm,
} from "./lib/prevuelo.mjs";

const run = promisify(execFile);

/**
 * Dónde está cargo.
 *
 * En la máquina del autor vive en `~/.cargo/bin` y no siempre está en el PATH
 * del shell que corre esto, así que se busca a mano antes de rendirse.
 */
function cargoBin() {
  for (const p of [join(homedir(), ".cargo", "bin", "cargo.exe"), join(homedir(), ".cargo", "bin", "cargo")]) {
    if (existsSync(p)) return p;
  }
  return "cargo";
}
let opciones;
try {
  opciones = leerOpciones(process.argv.slice(2));
} catch (e) {
  console.error(`${e.message}\nUso: node scripts/preflight-mainnet.mjs --wasm <archivo.wasm> --sha256 <huella> --account G… --necesario <XLM> [--sin-pruebas]`);
  process.exit(2);
}
const { account, necesario, sinPruebas } = opciones;

// La fuente de verdad es `RPC_URLS` en `src/stellar/config.ts`. Acá se repite
// porque esto es un script de Node suelto y no compila TypeScript; si allá se
// rota el endpoint, hay que tocar esta línea también.
const MAINNET_RPC = "https://mainnet.sorobanrpc.com";
const HORIZON = "https://horizon.stellar.org";

const rows = [];
let bad = 0;
let warn = 0;

function ok(name, detail = "") {
  rows.push(["ok", name, detail]);
}
function fail(name, detail = "") {
  bad++;
  rows.push(["mal", name, detail]);
}
function note(name, detail = "") {
  warn++;
  rows.push(["ojo", name, detail]);
}
/** Suma las filas que devuelven las piezas de scripts/lib/prevuelo.mjs. */
function sumar(filas) {
  for (const [state, name, detail] of filas) {
    if (state === "ok") ok(name, detail);
    else if (state === "ojo") note(name, detail);
    else fail(name, detail);
  }
}

/* ------------------------------------------------------------------ código */

if (sinPruebas) {
  note("los tests del contrato pasan", "salteadas con --sin-pruebas");
  note("los tests del protocolo en TypeScript pasan", "salteadas con --sin-pruebas");
} else {
  const cargo = await correrConTope(cargoBin(), ["test", "--workspace", "--quiet"], { tope: TOPE_DE_PRUEBAS_MS });
  // Sin cargo instalado no se puede afirmar nada, pero tampoco es un rojo
  // del contrato: es una máquina sin el toolchain.
  if (cargo.codigo === null && /ENOENT/.test(cargo.error)) note("los tests del contrato pasan", "no encontré cargo en esta máquina");
  else sumar([filaDePruebas("los tests del contrato pasan", cargo)]);

  // La suite entera, con los trabajadores que aguanta la máquina (VITEST_MAX_WORKERS, o 3).
  const trabajadores = process.env.VITEST_MAX_WORKERS || "3";
  const vitest = await correrConTope("pnpm", ["exec", "vitest", "run", `--maxWorkers=${trabajadores}`], { tope: TOPE_DE_PRUEBAS_MS, shell: true });
  sumar([filaDePruebas("los tests del protocolo en TypeScript pasan", vitest)]);
}

// En mainnet se despliega el .wasm del release, tal cual: se mira ese archivo
// y su huella, no uno compilado en esta máquina. La ruta se resuelve contra la
// carpeta desde donde se llamó (pnpm corre el guion desde la raíz).
if (opciones.wasm) {
  const ruta = resolve(process.env.INIT_CWD || process.cwd(), opciones.wasm);
  try {
    const contenido = await readFile(ruta);
    sumar(revisarWasm({ ruta: opciones.wasm, bytes: contenido.length, sha256: huellaDe(contenido), esperado: opciones.sha256 }));
  } catch (e) {
    fail("el .wasm coincide con la huella", `no pude leer ${ruta}: ${String(e).split("\n")[0]}`);
  }
} else {
  sumar(revisarWasm({ ruta: null, esperado: opciones.sha256 }));
}

/* ------------------------------------------------------------- despliegues */

try {
  const dep = JSON.parse(await readFile("src/stellar/deployments.json", "utf8"));
  if (dep.mainnet) {
    note("mainnet ya tiene una dirección", `${dep.mainnet.contractId} — desplegar de nuevo crea otro contrato`);
  } else {
    ok("mainnet todavía no tiene dirección", "es el primer despliegue");
  }
  if (!dep.testnet?.contractId) fail("testnet tiene dirección", "no hay nada probado");
  else ok("testnet tiene dirección", dep.testnet.contractId);
} catch (e) {
  fail("se puede leer src/stellar/deployments.json", String(e).split("\n")[0]);
}

/* ------------------------------------------------------------------ nada de secretos */

try {
  const ignore = await readFile(".gitignore", "utf8");
  const must = [".env", ".vercel", ".stellar"];
  const falta = must.filter((m) => !ignore.includes(m));
  if (falta.length) fail("el .gitignore cubre lo sensible", `falta ${falta.join(", ")}`);
  else ok("el .gitignore cubre lo sensible", must.join(", "));
} catch {
  fail("el .gitignore cubre lo sensible", "no pude leerlo");
}

try {
  // Una semilla de Stellar empieza con S y tiene 56 caracteres. Si alguna se
  // coló en un archivo versionado, este es el momento de enterarse.
  const { stdout } = await run("git", ["grep", "-nE", "\\bS[A-Z2-7]{55}\\b", "--", ".", ":!*.md"], { timeout: 60_000 }).catch(() => ({ stdout: "" }));
  if (stdout.trim()) fail("no hay semillas en el repositorio", stdout.trim().split("\n")[0]);
  else ok("no hay semillas en el repositorio");
} catch {
  note("no hay semillas en el repositorio", "no pude comprobarlo");
}

/* --------------------------------------------------------------------- red */

for (const [name, url] of [
  ["api.drand.sh", "https://api.drand.sh/health"],
  ["api2.drand.sh", "https://api2.drand.sh/health"],
  ["api3.drand.sh", "https://api3.drand.sh/health"],
  ["drand.cloudflare.com", "https://drand.cloudflare.com/health"],
]) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) ok(`el relay ${name} responde`);
    else note(`el relay ${name} responde`, `HTTP ${res.status}`);
  } catch {
    note(`el relay ${name} responde`, "sin respuesta");
  }
}

try {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getNetwork" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  const passphrase = body?.result?.passphrase;
  if (passphrase === "Public Global Stellar Network ; September 2015") {
    ok("el RPC de mainnet responde", passphrase);
  } else {
    fail("el RPC de mainnet responde", `passphrase inesperada: ${passphrase}`);
  }
} catch (e) {
  fail("el RPC de mainnet responde", String(e).split("\n")[0]);
}

try {
  const res = await fetch(MAINNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getLatestLedger" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.json();
  const proto = body?.result?.protocolVersion;
  // Las funciones de BLS12-381 que usa `draw` entraron con CAP-0059, en el
  // protocolo 22. Por debajo de eso el contrato no puede verificar la firma.
  if (typeof proto === "number" && proto >= 22) ok("mainnet soporta BLS12-381", `protocolo ${proto}`);
  else fail("mainnet soporta BLS12-381", `protocolo ${proto}, hace falta 22 o más`);
} catch (e) {
  fail("mainnet soporta BLS12-381", String(e).split("\n")[0]);
}

/* ----------------------------------------------------------------- la cuenta */

if (account) {
  try {
    const res = await fetch(`${HORIZON}/accounts/${account}`, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) {
      fail("la cuenta existe en mainnet", "no existe: hay que fondearla primero");
    } else if (!res.ok) {
      fail("la cuenta existe en mainnet", `HTTP ${res.status}`);
    } else {
      const body = await res.json();
      const native = body.balances?.find((b) => b.asset_type === "native");
      const xlm = Number(native?.balance ?? 0);
      ok("la cuenta existe en mainnet", `${xlm.toFixed(2)} XLM`);
      // Lo que pide la simulación no puede salir de la reserva mínima de la cuenta.
      sumar(revisarSaldo({ xlm, necesario, reserva: reservaDeLaCuenta(body) }));
    }
  } catch (e) {
    fail("la cuenta existe en mainnet", String(e).split("\n")[0]);
  }
} else {
  note("saldo de la cuenta", "pasá --account GXXXX… para comprobarlo");
}

/* ------------------------------------------------------------------ informe */

console.log("\nComprobación previa al despliegue en mainnet\n");
for (const [state, name, detail] of rows) {
  const mark = state === "ok" ? "  ✓" : state === "ojo" ? "  ·" : "  ✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}
console.log("");
console.log(lineaDeCosto(necesario));
console.log("El contrato es inmutable: no tiene administrador, no se puede actualizar y no custodia fondos.\n");

if (bad) {
  console.log(`NO DESPLEGAR: ${bad} comprobación(es) en rojo${warn ? `, ${warn} para mirar` : ""}.\n`);
  process.exit(1);
}
console.log(`LISTO PARA DESPLEGAR${warn ? ` (${warn} cosa(s) para mirar antes)` : ""}.`);
const [ensayo, despliegue] = ordenesDeDespliegue({ wasm: opciones.wasm, sha256: opciones.sha256 });
console.log("El paso siguiente es deploy.sh, primero con --ensayo:");
console.log(`  ${ensayo}`);
console.log(`  ${despliegue}`);
console.log("Después, la dirección y el sha256 van a src/stellar/deployments.json y a docs/deployments.md en el mismo commit.\n");
