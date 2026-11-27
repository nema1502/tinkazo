#!/usr/bin/env node
/**
 * Firma campañas fuera del sitio y de los Workers. La llave privada nunca se escribe dentro del repositorio.
 *
 *   node scripts/campana-firmar.mjs --nueva-llave <archivo>
 *     Genera la llave privada, la guarda en hexadecimal y muestra solo la pública. No pisa un archivo existente.
 *
 *   node scripts/campana-firmar.mjs --nueva-llave-prueba
 *     Muestra un par descartable para el Worker local, sin escribir archivos.
 *
 *   node scripts/campana-firmar.mjs --llave <archivo> --campana <campaña.json>
 *     Escribe <campaña>.firmada.json al lado, que también tiene que quedar fuera del repositorio: quien lo tiene primero crea
 *     la sala del evento. El texto firmado es el JSON de la campaña, sin espacios.
 *     Antes de firmar corre los mismos lectores que después leen el archivo, el de la sala y el del sitio
 *     (`src/sala/validar-campana.ts`): no firma nada que alguno de los dos vaya a rechazar.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";

const ES_EVENTO = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/u;
const hexadecimal = (bytes) => Buffer.from(bytes).toString("hex");

/**
 * Normaliza y firma una campaña. `ahora` se pasa aparte para que la comprobación del cierre sea reproducible, y `validar`
 * es el validador de la campaña (`validarCampanaParaElFirmador`): sin él no se firma, porque firmar a ciegas es lo que esto evita.
 * Con `conComision` (lo que cobra Tinkazo a la campaña está prendido) los premios van en centavos justos: el panel suma el total al
 * centavo y un premio con fracción de centavo se mostraría distinto de lo que se suma. Lanza con el campo que falta o no sirve,
 * nunca con material de la llave.
 */
export function firmarCampana(secretoHex, textoCrudo, ahora, validar, { conComision = false } = {}) {
  if (typeof validar !== "function") throw new Error("falta el validador de la campaña: no se firma a ciegas");
  if (typeof secretoHex !== "string" || !/^[0-9a-f]{64}$/u.test(secretoHex)) {
    throw new Error("la llave privada tiene que ser de 64 caracteres hexadecimales");
  }
  let datos;
  try {
    datos = JSON.parse(textoCrudo);
  } catch {
    throw new Error("la campaña no es un JSON válido");
  }
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) {
    throw new Error("la campaña tiene que ser un objeto");
  }
  if (datos.v !== 1) throw new Error("la campaña tiene que tener v igual a 1");
  if (typeof datos.evento !== "string" || !ES_EVENTO.test(datos.evento)) {
    throw new Error("la campaña tiene que tener un evento válido");
  }
  if (datos.red !== "mainnet" && datos.red !== "testnet") {
    throw new Error("la campaña tiene que tener una red válida");
  }
  if (typeof datos.cierra_ms !== "number" || !Number.isSafeInteger(datos.cierra_ms) || datos.cierra_ms <= ahora) {
    throw new Error("cierra_ms tiene que ser una hora futura");
  }
  const texto = JSON.stringify(datos);
  const lectura = validar(texto, ahora);
  if (lectura === null || typeof lectura !== "object" || lectura.ok !== true) {
    const quien = lectura?.quien === "sala" ? "la sala rechazaría" : lectura?.quien === "firmador" ? "Tinkazo no firma" : "el sitio rechazaría";
    const campo = lectura?.campo ?? "desconocido";
    const motivo = lectura?.motivo ?? "sin motivo";
    throw new Error(`${quien} esta campaña: revisá el campo ${campo} (${motivo})`);
  }
  if (conComision && !(Array.isArray(datos.premios) && datos.premios.every((p) => /^\d{1,16}$/u.test(String(p)) && BigInt(p) % 100_000n === 0n))) {
    throw new Error("con el cobro de la comisión prendido los premios van en centavos justos: revisá el campo premios");
  }
  const firma = ed25519.sign(new TextEncoder().encode(texto), Buffer.from(secretoHex, "hex"));
  return { texto, firma: Buffer.from(firma).toString("base64url") };
}

/** Si `ruta` queda estrictamente dentro de `carpeta`, también cuando los dos caminos son relativos. */
export function dentroDe(ruta, carpeta) {
  const relacion = relative(resolve(carpeta), resolve(ruta));
  const sale = relacion === ".." || relacion.startsWith(`..${sep}`) || isAbsolute(relacion);
  return relacion !== "" && !sale;
}

const RAIZ = fileURLToPath(new URL("../", import.meta.url));

/** La ruta real de una carpeta, con enlaces simbólicos y junctions resueltos. Si no existe, la ruta tal cual. */
function real(ruta) {
  try {
    return realpathSync(ruta);
  } catch {
    return resolve(ruta);
  }
}

/**
 * Las carpetas del repositorio donde no puede quedar una llave: esta copia de trabajo y, si es una copia anidada bajo el
 * repositorio principal, también el principal (de esa carpeta se podría subir una llave con un solo `git add`).
 */
export function raicesDelRepositorio(raiz = RAIZ) {
  const raices = new Set([real(raiz)]);
  const preguntar = (...args) => {
    try {
      return execFileSync("git", args, { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const arriba = preguntar("rev-parse", "--show-toplevel");
  if (arriba) raices.add(real(arriba));
  const comun = preguntar("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (comun && basename(comun) === ".git") raices.add(real(dirname(comun)));
  return [...raices];
}

/**
 * Lanza si el destino queda dentro de alguna de las carpetas del repositorio. Mira la carpeta que lo contiene ya con los
 * enlaces resueltos: una ruta que pasa por un enlace simbólico o una junction hacia el repositorio también cuenta. `que`
 * nombra lo que no puede quedar ahí, para el mensaje.
 */
function fueraDelRepositorio(destino, raices, que) {
  const absoluto = resolve(destino);
  const donde = join(real(dirname(absoluto)), basename(absoluto));
  if (raices.some((raiz) => dentroDe(donde, raiz) || dentroDe(absoluto, raiz))) {
    throw new Error(`${que} tiene que quedar fuera del repositorio`);
  }
}

/** La llave privada: con ella cualquiera firma campañas que la sala acepta. */
export function llaveFueraDelRepositorio(destino, raices = raicesDelRepositorio()) {
  fueraDelRepositorio(destino, raices, "la llave privada");
}

/**
 * El archivo firmado: quien lo tiene primero crea la sala del evento y se queda con el token de quien organiza. El
 * repositorio es público, así que tampoco puede quedar ahí, ni por un enlace.
 */
export function firmadaFueraDelRepositorio(destino, raices = raicesDelRepositorio()) {
  fueraDelRepositorio(destino, raices, "el archivo firmado");
}

function nuevaLlave(archivo) {
  const destino = resolve(archivo);
  llaveFueraDelRepositorio(destino);
  const secreto = ed25519.utils.randomSecretKey();
  const publica = ed25519.getPublicKey(secreto);
  writeFileSync(destino, `${hexadecimal(secreto)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log(`Llave pública: ${hexadecimal(publica)}`);
}

function nuevaLlaveDePrueba() {
  const secreto = ed25519.utils.randomSecretKey();
  console.log(`Llave privada de prueba: ${hexadecimal(secreto)}`);
  console.log(`Llave pública de prueba: ${hexadecimal(ed25519.getPublicKey(secreto))}`);
}

/** Carga el validador de la sala y del sitio (son TypeScript): con el mismo cargador de Vite que usan los otros guiones. */
async function cargarValidador() {
  const { runnerImport } = await import("vite");
  const ruta = fileURLToPath(new URL("../src/sala/validar-campana.ts", import.meta.url));
  const { module } = await runnerImport(ruta, { configFile: false, logLevel: "silent" });
  if (typeof module.validarCampanaParaElFirmador !== "function") throw new Error("no se pudo cargar el validador de campañas");
  return module.validarCampanaParaElFirmador;
}

async function firmarArchivo(archivoLlave, archivoCampana) {
  const salida = archivoCampana.replace(/\.json$/i, "") + ".firmada.json";
  // Antes de firmar: si el archivo firmado iba a caer dentro del repositorio, no se firma nada.
  firmadaFueraDelRepositorio(salida);
  const secretoHex = readFileSync(archivoLlave, "utf8").trim();
  const crudo = readFileSync(archivoCampana, "utf8");
  const conComision = ["VITE_COMISION_PB", "VITE_COMISION_MINIMO", "VITE_COMISION_CUENTA"].every((v) => (process.env[v] ?? "").trim() !== "");
  const firmada = firmarCampana(secretoHex, crudo, Date.now(), await cargarValidador(), { conComision });
  writeFileSync(salida, `${JSON.stringify(firmada, null, 2)}\n`, "utf8");
  const datos = JSON.parse(firmada.texto);
  console.log(`Evento: ${datos.evento}`);
  console.log(`Tamaño del texto firmado: ${Buffer.byteLength(firmada.texto)} bytes`);
  console.log(`Archivo: ${salida}`);
  if (conComision) {
    // El pago del cobro se reconoce por el evento: repetirlo haría que un pago de antes valga para esta campaña.
    console.log("Con el cobro de la comisión prendido, el pago se reconoce por el nombre del evento: el ensayo y la campaña del día llevan eventos distintos.");
  }
}

async function principal() {
  const args = process.argv.slice(2);
  const valor = (bandera) => {
    const i = args.indexOf(bandera);
    return i >= 0 ? args[i + 1] : undefined;
  };
  if (args.includes("--nueva-llave-prueba")) {
    nuevaLlaveDePrueba();
    return;
  }
  const nueva = valor("--nueva-llave");
  if (nueva) {
    nuevaLlave(nueva);
    return;
  }
  const llave = valor("--llave");
  const campana = valor("--campana");
  if (llave && campana) {
    await firmarArchivo(llave, campana);
    return;
  }
  throw new Error("uso: --nueva-llave <archivo>, --nueva-llave-prueba, o --llave <archivo> --campana <campaña.json>");
}

const directo = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (directo) {
  try {
    await principal();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "no se pudo firmar la campaña");
    process.exitCode = 1;
  }
}
