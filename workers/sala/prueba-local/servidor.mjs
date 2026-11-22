/**
 * Levanta el Worker de la sala en esta máquina con `wrangler dev` (modo local: nada de la nube, ningún secreto real) y lo
 * apaga por su PID. Lo usan `correr.mjs` y `almacen-viejo.mjs`.
 *
 * Qué wrangler usa, en este orden: la variable WRANGLER_JS, el que traiga el repositorio en `node_modules`, y el que ya
 * esté en la memoria de npx de esta máquina (se corre con node, sin instalar nada global). Si no hay ninguno se dice qué falta.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = resolve(AQUI, "..", "..", "..");
export const SALA = resolve(AQUI, "..");
export const RPC_FALSO = "https://rpc.prueba.invalid";
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const derecha = (ruta) => ruta.split("\\").join("/");

/** La ruta de wrangler.js, o null si no hay ninguno a mano. */
export function buscarWrangler() {
  if (process.env.WRANGLER_JS && existsSync(process.env.WRANGLER_JS)) return process.env.WRANGLER_JS;
  const propio = join(RAIZ, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(propio)) return propio;
  const cache = [process.env.npm_config_cache, join(process.env.LOCALAPPDATA ?? "", "npm-cache"), join(homedir(), ".npm")].filter(Boolean);
  let mejor = null;
  for (const carpeta of cache) {
    const npx = join(carpeta, "_npx");
    if (!existsSync(npx)) continue;
    for (const hash of readdirSync(npx)) {
      const js = join(npx, hash, "node_modules", "wrangler", "bin", "wrangler.js");
      if (!existsSync(js)) continue;
      const version = JSON.parse(readFileSync(join(npx, hash, "node_modules", "wrangler", "package.json"), "utf8")).version;
      const numeros = version.split(".").map(Number);
      if (numeros[0] !== 4) continue;
      if (!mejor || numeros.join(".") > mejor.numeros.join(".")) mejor = { js, version, numeros };
    }
  }
  return mejor ? mejor.js : null;
}

export async function puertoLibre() {
  for (let i = 0; i < 80; i++) {
    const puerto = 9700 + Math.floor(Math.random() * 260);
    const libre = await new Promise((listo) => {
      const s = createServer();
      s.once("error", () => listo(false));
      s.listen(puerto, "127.0.0.1", () => s.close(() => listo(true)));
    });
    if (libre) return puerto;
  }
  throw new Error("no hay un puerto libre entre 9700 y 9960");
}

/**
 * La configuración de la prueba, hecha de la de verdad: sin la cuenta ni el dominio (nada se publica), con otro programa
 * principal, el RPC apuntando a uno que no existe (lo imita `entrada.mjs`) y las variables de prueba.
 */
export function configuracionDePrueba({ main, extra = {} }) {
  let toml = readFileSync(join(SALA, "wrangler.toml"), "utf8").replace(/\r\n/g, "\n");
  toml = toml
    .replace(/^account_id = .*\n/m, "")
    .replace(/^routes = .*\n/m, "")
    .replace(/^main = .*\n/m, `main = "${derecha(main)}"\n`)
    .replace(/^RPC_MAINNET = .*\n/m, `RPC_MAINNET = "${RPC_FALSO}"\n`);
  for (const [k, v] of Object.entries(extra)) toml += `${k} = "${v}"\n`;
  return toml;
}

/**
 * Levanta el Worker. `main` es el programa (por defecto la entrada de prueba), `persistir` la carpeta del almacén (la misma
 * en dos arranques seguidos deja el almacén del primero), `extra` las variables de prueba. Devuelve la dirección y cómo apagarlo.
 */
export async function levantar({ main, persistir, carpeta, extra = {}, etiqueta = "sala" }) {
  const wrangler = buscarWrangler();
  if (!wrangler) {
    throw new Error(
      "No hay wrangler a mano. Instalalo en el repositorio con `pnpm add -D wrangler@4` (no se hizo por vos) o corré una vez `npx wrangler@4 --version` para que quede en la memoria de npx, o apuntá WRANGLER_JS a su bin/wrangler.js.",
    );
  }
  mkdirSync(carpeta, { recursive: true });
  const puerto = await puertoLibre();
  let inspector = await puertoLibre();
  while (inspector === puerto) inspector = await puertoLibre();
  const config = join(carpeta, `wrangler.${etiqueta}.toml`);
  writeFileSync(config, configuracionDePrueba({ main, extra }));
  const registro = join(carpeta, `wrangler.${etiqueta}.log`);
  const fd = openSync(registro, "w");
  const hijo = spawn(
    process.execPath,
    [wrangler, "dev", "--config", config, "--port", String(puerto), "--inspector-port", String(inspector), "--ip", "127.0.0.1", "--persist-to", persistir, "--show-interactive-dev-session=false"],
    {
      cwd: carpeta,
      stdio: ["ignore", fd, fd],
      windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_UPDATE_NOTIFIER: "1", CI: "1", FORCE_COLOR: "0" },
    },
  );
  let salio = null;
  hijo.on("exit", (codigo) => (salio = codigo ?? -1));
  const base = `http://127.0.0.1:${puerto}`;
  const apagar = () => {
    if (!hijo.pid) return;
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
      else process.kill(-hijo.pid);
    } catch {
      /* ya había terminado */
    }
  };
  const inicio = Date.now();
  while (Date.now() - inicio < 120_000) {
    if (salio !== null) throw new Error(`wrangler dev terminó con ${salio} antes de abrir. Salida en ${registro}`);
    try {
      const r = await fetch(`${base}/AbCd1234`);
      if (r.status === 200) return { base, puerto, pid: hijo.pid, registro, apagar, wrangler };
    } catch {
      /* todavía no abre */
    }
    await pausa(500);
  }
  apagar();
  throw new Error(`wrangler dev no abrió en dos minutos. Salida en ${registro}`);
}
