// Prueba scripts/deploy.sh con un `stellar` falso que anota cada llamada. Nunca corre la CLI de verdad:
// los directorios del PATH que tienen un `stellar` se sacan, y el guion corre desde una copia en una
// carpeta temporal, con su propio docs/deployments.md, para que ningún camino escriba en el repositorio.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StrKey } from "@stellar/stellar-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RPC_LISTAS } from "../../src/stellar/config.ts";
import { passphraseDe } from "../../src/stellar/oficiales.ts";
import { filaDelRegistro, problemasDeLaEntrada } from "./ensayo-oficial.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(aqui, "..", "..");
const GUION = join(RAIZ, "scripts", "deploy.sh");
const DOCS = join(RAIZ, "docs", "deployments.md");

/** En Linux, el bash del sistema. En Windows, el de Git: nunca el de System32, que es el de WSL. */
function buscarBash() {
  if (process.platform !== "win32") {
    const r = spawnSync("bash", ["--version"], { encoding: "utf8" });
    return r.status === 0 ? { bash: "bash" } : { motivo: "no hay bash en el PATH" };
  }
  const candidatos = [];
  const exec = spawnSync("git", ["--exec-path"], { encoding: "utf8" });
  if (exec.status === 0 && exec.stdout.trim()) {
    // …/Git/<mingw64|ucrt64>/libexec/git-core → …/Git
    candidatos.push(join(resolve(exec.stdout.trim(), "..", "..", ".."), "bin", "bash.exe"));
  }
  candidatos.push("C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe");
  const bash = candidatos.find((c) => !/system32/i.test(c) && existsSync(c));
  return bash ? { bash } : { motivo: "no se encontró el bash de Git en Windows" };
}

const { bash: BASH, motivo: MOTIVO } = buscarBash();
const barra = (p) => p.replace(/\\/g, "/");

const CONTRATO = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTRO_CONTRATO = StrKey.encodeContract(Buffer.alloc(32, 9));
const CUENTA = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const COMMIT_DEL_BUILD = "641e083" + "a".repeat(33);

const STELLAR_FALSO = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
[ -n "\${STELLAR_RPC_URL:-}\${STELLAR_NETWORK_PASSPHRASE:-}\${STELLAR_NETWORK:-}" ] && echo "variables de red en el entorno" >> "$FAKE_LOG"
case "$1 $2" in
  "--version ") echo "stellar 28.1.0 (falso)" ;;
  "keys address") echo "$FAKE_CUENTA" ;;
  "contract info") echo "commit: $FAKE_COMMIT" ;;
  "contract alias")
    if [ -n "\${FAKE_ALIAS:-}" ]; then echo "$FAKE_ALIAS"; exit 0; fi
    echo "error: no existe el alias" >&2; exit 1 ;;
  "contract deploy")
    echo "simulando la transacción" >&2
    if [ "\${FAKE_DEPLOY_FALLA:-}" = 1 ]; then echo "error: la transacción falló" >&2; exit 1; fi
    echo "\${FAKE_DEPLOY_SALIDA:-$FAKE_CONTRATO}" ;;
  "contract invoke")
    if [ "\${FAKE_INVOKE_FALLA:-}" = 1 ]; then echo "error: no responde" >&2; exit 1; fi
    echo 0 ;;
  "contract fetch")
    out=""
    while [ $# -gt 0 ]; do [ "$1" = --out-file ] && out="$2"; shift; done
    cp "\${FAKE_FETCH_WASM:-$FAKE_WASM}" "$out" ;;
  *) echo "orden no prevista: $*" >&2; exit 9 ;;
esac
`;
const GIT_FALSO = `#!/usr/bin/env bash
[ "$*" = "rev-parse --short HEAD" ] && { echo 1234abc; exit 0; }
exit 1
`;
const PYTHON_FALSO = `#!/usr/bin/env bash
printf 'python %s\\n' "$*" >> "$FAKE_LOG"
[ "$1" = -c ] && [ "\${FAKE_PYTHON_FALLA:-}" = 1 ] && exit 1
cat > /dev/null
`;

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** El PATH sin ningún directorio que tenga un `stellar` de verdad. */
function pathSinStellar() {
  const clave = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  const entradas = (clave ? process.env[clave] : "").split(delimiter).filter(Boolean);
  return entradas.filter((d) => !["stellar", "stellar.exe"].some((n) => existsSync(join(d, n)))).join(delimiter);
}

let dir, repo, falsos, log, wasm, huella, docsCopia;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-sh-"));
  repo = join(dir, "repo");
  falsos = join(dir, "falsos");
  mkdirSync(join(repo, "scripts"), { recursive: true });
  mkdirSync(join(repo, "docs"), { recursive: true });
  mkdirSync(falsos);
  // Se copia tal cual: si el guion llegara con CRLF, las pruebas lo tienen que ver (y la de .gitattributes lo dice).
  copyFileSync(GUION, join(repo, "scripts", "deploy.sh"));
  docsCopia = join(repo, "docs", "deployments.md");
  copyFileSync(DOCS, docsCopia);
  for (const [nombre, texto] of [["stellar", STELLAR_FALSO], ["git", GIT_FALSO], ["python", PYTHON_FALSO]]) {
    writeFileSync(join(falsos, nombre), texto, { mode: 0o755 });
  }
  const bytes = Buffer.from("\0asm\x01\0\0\0 tinkazo de prueba " + Math.random());
  wasm = join(dir, "tinkazo-raffle_v0.2.0.wasm");
  writeFileSync(wasm, bytes);
  huella = sha(bytes);
  log = join(dir, "llamadas.log");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Corre la copia del guion con los falsos adelante en el PATH. */
function correr(args, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.toUpperCase() === "PATH") delete env[k];
  Object.assign(env, {
    PATH: pathSinStellar(),
    FAKE_DIR: falsos,
    FAKE_LOG: barra(log),
    FAKE_WASM: barra(wasm),
    FAKE_CUENTA: CUENTA,
    FAKE_COMMIT: COMMIT_DEL_BUILD,
    FAKE_CONTRATO: CONTRATO,
    ...extra,
  });
  // El bash de Git en Windows antepone sus propias carpetas al PATH: los falsos se ponen adelante desde adentro.
  const previo = 'd="$FAKE_DIR"; if command -v cygpath >/dev/null 2>&1; then d="$(cygpath -u "$d")"; fi; export PATH="$d:$PATH"; exec bash "$@"';
  const r = spawnSync(BASH, ["-c", previo, "_", barra(join(repo, "scripts", "deploy.sh")), ...args], {
    encoding: "utf8",
    env,
    timeout: 50000,
  });
  const llamadas = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { codigo: r.status, out: r.stdout ?? "", err: r.stderr ?? "", llamadas };
}

const deStellar = (llamadas) => llamadas.filter((l) => !l.startsWith("python ") && l !== "variables de red en el entorno");
/** La llamada a python que escribe la fila (la otra, `python -c`, solo comprueba que python ande). */
const escribeFila = (llamadas) => llamadas.some((l) => l.startsWith("python - "));
const hay = (llamadas, orden) => llamadas.some((l) => l.startsWith(orden));

describe("el texto de scripts/deploy.sh", () => {
  it("llega con finales de línea LF: git lo escribe así en cualquier copia, también con core.autocrlf", () => {
    // Con CRLF, Git Bash corta en `set -euo pipefail` (pipefail con \r) antes de llamar a stellar.
    expect(readFileSync(GUION, "utf8")).not.toContain("\r");
    const attr = spawnSync("git", ["-C", RAIZ, "check-attr", "eol", "--", "scripts/deploy.sh"], { encoding: "utf8" });
    expect(attr.status).toBe(0);
    expect(attr.stdout.trim()).toBe("scripts/deploy.sh: eol: lf");
  });

  it("el despliegue no tira el error de la CLI a /dev/null y la dirección sigue saliendo con tail -1", () => {
    const texto = readFileSync(GUION, "utf8");
    const desde = texto.indexOf("stellar contract deploy");
    expect(desde).toBeGreaterThan(0);
    const bloque = texto.slice(desde, texto.indexOf("tail -1", desde) + "tail -1".length);
    expect(bloque).toContain("--alias");
    expect(bloque).not.toContain("2>/dev/null");
    expect(bloque).not.toContain("2>&1");
  });
});

describe.skipIf(!BASH)(`scripts/deploy.sh con un stellar falso${BASH ? "" : ` (salteada: ${MOTIVO})`}`, () => {
  it("mainnet sin identidad sale con 2 sin llamar a stellar", () => {
    const r = correr(["mainnet", "--wasm", barra(wasm), "--sha256", huella]);
    expect(r.codigo).toBe(2);
    expect(r.err).toContain("identidad");
    expect(r.llamadas).toEqual([]);
  });

  it("mainnet con tinkazo-deployer sale con 2: es la identidad de la red de prueba", () => {
    const r = correr(["mainnet", "tinkazo-deployer", "--wasm", barra(wasm), "--sha256", huella]);
    expect(r.codigo).toBe(2);
    expect(r.err).toContain("red de prueba");
    expect(r.llamadas).toEqual([]);
  });

  it("mainnet sin --sha256 sale con 2", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm)]);
    expect(r.codigo).toBe(2);
    expect(r.err).toContain("--sha256");
    expect(r.llamadas).toEqual([]);
  });

  it("una huella mal escrita sale con 2", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", "abc"]);
    expect(r.codigo).toBe(2);
    expect(r.llamadas).toEqual([]);
  });

  it("con la huella equivocada sale con 1 y no llama nunca a stellar", () => {
    const otra = sha(Buffer.from("otro wasm"));
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", otra]);
    expect(r.codigo).toBe(1);
    expect(r.err).toContain(otra);
    expect(r.err).toContain(huella);
    expect(r.llamadas).toEqual([]);
  });

  it("--ensayo en mainnet sale con 0, muestra la orden y la fila, y no despliega, invoca, baja ni escribe", () => {
    const antes = sha(readFileSync(docsCopia));
    const antesReal = sha(readFileSync(DOCS));
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella.toUpperCase(), "--ensayo"]);
    expect(r.err).toBe("");
    expect(r.codigo).toBe(0);
    expect(r.out).toContain("stellar contract deploy");
    expect(r.out).toContain("--source-account tinkazo-mainnet --network mainnet --alias tinkazo-mainnet");
    expect(r.out).toContain(`| mainnet | \`C…\` | \`${huella}\` | 641e083 |`);
    expect(r.out).toMatch(/\| \d{4}-\d{2}-\d{2} \| mainnet \| `C…` \|/);
    expect(r.out).toContain(`la cuenta que despliega es ${CUENTA}: tiene que ser la misma que se pasó al prevuelo con --account`);
    expect(hay(r.llamadas, "contract info build")).toBe(true);
    expect(hay(r.llamadas, "keys address tinkazo-mainnet")).toBe(true);
    expect(hay(r.llamadas, "contract alias show tinkazo-mainnet --network mainnet")).toBe(true);
    for (const orden of ["contract deploy", "contract invoke", "contract fetch", "contract build"]) {
      expect(hay(r.llamadas, orden)).toBe(false);
    }
    expect(escribeFila(r.llamadas)).toBe(false);
    expect(r.out).toContain("CLI: stellar 28.1.0 (falso)");
    expect(sha(readFileSync(docsCopia))).toBe(antes);
    expect(sha(readFileSync(DOCS))).toBe(antesReal);
  });

  it("--id con --ensayo sale con 0, sin desplegar y con esa dirección en la fila", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO, "--ensayo"]);
    expect(r.codigo).toBe(0);
    expect(r.out).toContain(`\`${CONTRATO}\``);
    expect(hay(r.llamadas, "contract deploy")).toBe(false);
    expect(hay(r.llamadas, "contract invoke")).toBe(false);
    expect(hay(r.llamadas, "contract fetch")).toBe(false);
  });

  it("--id que no es un contrato sale con 2", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CUENTA, "--ensayo"]);
    expect(r.codigo).toBe(2);
    expect(r.llamadas).toEqual([]);
  });

  it("testnet sin identidad usa tinkazo-deployer, como siempre", () => {
    const r = correr(["testnet", "--wasm", barra(wasm), "--ensayo"]);
    expect(r.codigo).toBe(0);
    expect(hay(r.llamadas, "keys address tinkazo-deployer")).toBe(true);
    expect(r.out).toContain("--network testnet --alias tinkazo-testnet");
    // La guardia del alias es solo de mainnet.
    expect(hay(r.llamadas, "contract alias")).toBe(false);
  });

  it("si el alias ya apunta a un contrato, sale con 1 sin desplegar y dice cómo retomar", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_ALIAS: OTRO_CONTRATO });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain(`--id ${OTRO_CONTRATO}`);
    expect(hay(r.llamadas, "contract deploy")).toBe(false);
  });

  it("si alias show contesta algo que no es una dirección, sigue", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--ensayo"], { FAKE_ALIAS: "sin alias" });
    expect(r.codigo).toBe(0);
  });

  it("si el despliegue falla, el error de la CLI queda a la vista con la pista del alias y de las operaciones de la cuenta", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_DEPLOY_FALLA: "1" });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("error: la transacción falló");
    expect(r.err).toContain("El despliegue falló");
    expect(r.err).toContain("stellar contract alias show tinkazo-mainnet");
    // El alias se guarda recién con la confirmación: la pista no puede ser solo el alias.
    expect(r.err).toContain(`https://horizon.stellar.org/accounts/${CUENTA}/operations`);
    expect(r.err).toContain("--id");
    expect(r.err).not.toMatch(/se niega/);
    expect(hay(r.llamadas, "contract invoke")).toBe(false);
  });

  it("--id sobre un contrato que corre otro .wasm sale con 1, sin registrar nada", () => {
    const otro = join(dir, "otro.wasm");
    writeFileSync(otro, Buffer.from("\0asm\x01\0\0\0 otro contrato"));
    const antes = sha(readFileSync(docsCopia));
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO], { FAKE_FETCH_WASM: barra(otro) });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("La red tiene otro .wasm");
    expect(hay(r.llamadas, `contract fetch --id ${CONTRATO}`)).toBe(true);
    expect(hay(r.llamadas, "contract deploy")).toBe(false);
    expect(escribeFila(r.llamadas)).toBe(false);
    expect(sha(readFileSync(docsCopia))).toBe(antes);
  });

  it("un despliegue nuevo que en la red quedó con otro .wasm sale con 1, sin registrar nada", () => {
    const otro = join(dir, "otro.wasm");
    writeFileSync(otro, Buffer.from("\0asm\x01\0\0\0 otro contrato"));
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_FETCH_WASM: barra(otro) });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("La red tiene otro .wasm");
    expect(r.llamadas.filter((l) => l.startsWith("contract deploy"))).toHaveLength(1);
    expect(escribeFila(r.llamadas)).toBe(false);
  });

  it("--id sobre un contrato que ya tiene su fila no escribe otra", () => {
    const fila = `| 2026-11-20 | mainnet | \`${CONTRATO}\` | \`${huella.slice(0, 16)}…\` | 641e083 | \`GAAQ…\` | 30 bytes |`;
    writeFileSync(docsCopia, readFileSync(docsCopia, "utf8").replace(/^\| · \| mainnet \|.*$/m, fila));
    const antes = sha(readFileSync(docsCopia));
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO]);
    expect(r.codigo).toBe(0);
    expect(r.out).toContain("ya estaba registrado");
    expect(r.out.trim().split("\n").at(-1)).toBe(CONTRATO);
    expect(escribeFila(r.llamadas)).toBe(false);
    expect(sha(readFileSync(docsCopia))).toBe(antes);
  });

  it("si el alias ya apunta a un contrato, la orden para retomar vale solo si el registro no quedó hecho", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_ALIAS: OTRO_CONTRATO });
    expect(r.err).toContain("Si el registro de ese contrato no quedó hecho");
  });

  it("si el despliegue no devuelve una dirección de contrato, sale con 1", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_DEPLOY_SALIDA: "listo" });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("El despliegue falló");
    expect(hay(r.llamadas, "contract invoke")).toBe(false);
  });

  it("si algo falla después de desplegar, imprime la orden para retomar con --id", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_INVOKE_FALLA: "1" });
    expect(r.codigo).not.toBe(0);
    expect(r.out).toContain(`contrato: ${CONTRATO}`);
    expect(r.err).toContain("NO vuelvas a correr el guion sin --id");
    expect(r.err).toMatch(new RegExp(`mainnet tinkazo-mainnet --wasm '[^']+' --sha256 ${huella} --id ${CONTRATO}`));
    expect(r.llamadas.filter((l) => l.startsWith("contract deploy"))).toHaveLength(1);
  });

  it("un despliegue entero toma la dirección de la salida estándar aunque la CLI escriba en la de errores", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella]);
    expect(r.codigo).toBe(0);
    expect(r.err).toContain("simulando la transacción");
    expect(r.out.trim().split("\n").at(-1)).toBe(CONTRATO);
    const orden = deStellar(r.llamadas).map((l) => l.split(" ").slice(0, 2).join(" "));
    expect(orden).toEqual(["--version", "contract info", "keys address", "contract alias", "contract deploy", "contract invoke", "contract fetch"]);
    const python = r.llamadas.find((l) => l.startsWith("python - "));
    expect(python).toContain(`\`${CONTRATO}\``);
    expect(python).toContain("| mainnet |");
  });

  it("--id sin ensayo no despliega: lee, compara con la red y registra", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO]);
    expect(r.codigo).toBe(0);
    expect(hay(r.llamadas, "contract deploy")).toBe(false);
    expect(hay(r.llamadas, "contract alias")).toBe(false);
    expect(hay(r.llamadas, `contract invoke --id ${CONTRATO}`)).toBe(true);
    expect(hay(r.llamadas, `contract fetch --id ${CONTRATO}`)).toBe(true);
    expect(escribeFila(r.llamadas)).toBe(true);
  });

  it("la fila y la entrada que imprime --id con --ensayo pasan la guardia de la CI, con la huella entera", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO, "--ensayo"]);
    expect(r.codigo).toBe(0);
    const renglones = r.out.split(/\r?\n/);
    const fila = renglones.find((l) => l.includes("| mainnet |"))?.trim();
    expect(fila).toBeDefined();
    expect(filaDelRegistro(fila, "mainnet", CONTRATO, huella, { huellaEntera: true })).toBe(fila);
    const desde = renglones.findIndex((l) => l === '  "mainnet": {');
    const hasta = renglones.findIndex((l, i) => i > desde && l === "  }");
    expect(desde).toBeGreaterThan(0);
    const entrada = JSON.parse(`{${renglones.slice(desde, hasta + 1).join("\n")}}`).mainnet;
    expect(entrada).toMatchObject({ contractId: CONTRATO, wasmSha256: huella });
    const guardia = { red: "mainnet", passphrase: passphraseDe("mainnet"), rpcs: RPC_LISTAS.mainnet, docs: fila };
    expect(problemasDeLaEntrada(entrada, guardia)).toEqual([]);
    // Un error en el último carácter de la huella, copiada a mano, la guardia lo ve.
    const otraCola = huella.slice(0, 63) + (huella.at(-1) === "0" ? "1" : "0");
    expect(problemasDeLaEntrada({ ...entrada, wasmSha256: otraCola }, guardia)).toHaveLength(1);
  });

  it("si un despliegue se cortó sin registrar, la marca frena otro sin --id; con --id se registra y la marca se va", () => {
    const marca = join(repo, ".despliegue", "mainnet.en-curso");
    const fallo = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_DEPLOY_FALLA: "1" });
    expect(fallo.codigo).toBe(1);
    expect(existsSync(marca)).toBe(true);
    expect(fallo.err).toContain("borrá la marca");
    rmSync(log, { force: true });
    const otra = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella]);
    expect(otra.codigo).toBe(1);
    expect(otra.err).toContain("Quedó la marca de un despliegue");
    expect(hay(otra.llamadas, "contract deploy")).toBe(false);
    // El ensayo también lo dice.
    expect(correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--ensayo"]).codigo).toBe(1);
    const retomada = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--id", CONTRATO]);
    expect(retomada.codigo).toBe(0);
    expect(existsSync(marca)).toBe(false);
  });

  it("un despliegue que termina bien no deja la marca e imprime la entrada para pegar", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella]);
    expect(r.codigo).toBe(0);
    expect(existsSync(join(repo, ".despliegue", "mainnet.en-curso"))).toBe(false);
    expect(r.out).toContain(`"wasmSha256": "${huella}"`);
  });

  it("si el despliegue sale con 0 pero sin una dirección, muestra qué devolvió la CLI", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella], { FAKE_DEPLOY_SALIDA: "listo" });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("La CLI devolvió: listo");
  });

  it("las variables de red del entorno no le llegan a la CLI: la red sale solo de --network", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--ensayo"], {
      STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
      STELLAR_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
      STELLAR_NETWORK: "testnet",
    });
    expect(r.codigo).toBe(0);
    expect(r.llamadas).not.toContain("variables de red en el entorno");
  });

  it("si python no anda, el ensayo sale con 1 antes de preguntarle nada a la red", () => {
    const r = correr(["mainnet", "tinkazo-mainnet", "--wasm", barra(wasm), "--sha256", huella, "--ensayo"], { FAKE_PYTHON_FALLA: "1" });
    expect(r.codigo).toBe(1);
    expect(r.err).toContain("python no anda");
    expect(hay(r.llamadas, "keys address")).toBe(false);
  });

  it("una llave secreta en lugar del nombre de la identidad sale con 2 sin imprimirla", () => {
    const llave = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32, 3));
    const r = correr(["mainnet", llave, "--wasm", barra(wasm), "--sha256", huella]);
    expect(r.codigo).toBe(2);
    expect(r.out + r.err).not.toContain(llave);
    expect(r.llamadas).toEqual([]);
  });
});
