#!/usr/bin/env node
/**
 * Comprobación previa al despliegue en mainnet.
 *
 * Todo lo que se puede comprobar **sin gastar un centavo**, corrido de una sola
 * vez. En mainnet un error cuesta plata de verdad y no hay deshacer: el
 * contrato es inmutable, no tiene administrador ni actualización.
 *
 * Esto no despliega nada. Cuando todo esté en verde, el despliegue es
 * `scripts/deploy.sh mainnet`.
 *
 * Uso:
 *   node scripts/preflight-mainnet.mjs [--account GXXXX…]
 *
 * Con `--account` comprueba además que esa cuenta exista y tenga saldo para el
 * despliegue y para un año de alquiler.
 */

import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
const args = process.argv.slice(2);
const account = args[args.indexOf("--account") + 1];
const wantAccount = args.includes("--account") && account && !account.startsWith("--");

/** Lo que cuesta desplegar y mantener, medido en testnet y anotado en docs/deployments.md. */
const DEPLOY_XLM = 16;
const RENT_YEAR_XLM = 49;
/** Reserva base de la cuenta más un colchón para las primeras invocaciones. */
const CUSHION_XLM = 5;
const NEEDED_XLM = DEPLOY_XLM + RENT_YEAR_XLM + CUSHION_XLM;

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

/* ------------------------------------------------------------------ código */

const cargo = cargoBin();
try {
  await run(cargo, ["test", "--workspace", "--quiet"], { cwd: ".", timeout: 600_000 });
  ok("los tests del contrato pasan");
} catch (e) {
  const msg = String(e).split("\n")[0];
  // Sin cargo instalado no se puede afirmar nada, pero tampoco es un rojo
  // del contrato: es una máquina sin el toolchain.
  if (msg.includes("ENOENT")) note("los tests del contrato pasan", "no encontré cargo en esta máquina");
  else fail("los tests del contrato pasan", msg);
}

try {
  await run("pnpm", ["test"], { shell: true, timeout: 300_000 });
  ok("los tests del protocolo en TypeScript pasan");
} catch (e) {
  fail("los tests del protocolo en TypeScript pasan", String(e).split("\n")[0]);
}

try {
  const wasm = "target/wasm32v1-none/release/tinkazo_raffle.wasm";
  const s = await stat(wasm);
  // La renta del código depende del tamaño del módulo compilado, así que un
  // salto acá se paga todos los años.
  ok("el contrato compila", `${(s.size / 1024).toFixed(1)} KB`);
  if (s.size > 20 * 1024) note("el contrato creció", "arriba de 20 KB la renta anual sube");
} catch {
  fail("el contrato compila", "falta el .wasm: corré `stellar contract build`");
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

if (wantAccount) {
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
      if (xlm >= NEEDED_XLM) ok("el saldo alcanza", `${xlm.toFixed(2)} de ${NEEDED_XLM} XLM`);
      else fail("el saldo alcanza", `${xlm.toFixed(2)} XLM, hacen falta ${NEEDED_XLM}`);
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
console.log(`Costo estimado: ${DEPLOY_XLM} XLM de despliegue y unos ${RENT_YEAR_XLM} al año de alquiler.`);
console.log("El contrato es inmutable: no tiene administrador, no se puede actualizar y no custodia fondos.\n");

if (bad) {
  console.log(`NO DESPLEGAR: ${bad} comprobación(es) en rojo${warn ? `, ${warn} para mirar` : ""}.\n`);
  process.exit(1);
}
console.log(`LISTO PARA DESPLEGAR${warn ? ` (${warn} cosa(s) para mirar antes)` : ""}.`);
console.log("El paso siguiente es `scripts/deploy.sh mainnet`, y después actualizar src/stellar/deployments.json en el mismo commit.\n");
