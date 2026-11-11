/**
 * Ensaya el commit del día del despliegue en la red principal sin hacerlo.
 *
 * Pone en src/stellar/deployments.json una entrada `mainnet` inventada (la dirección de 32 bytes en
 * cero, con la forma exacta de la real), corre tipos, pruebas y build, y deja el archivo como estaba
 * pase lo que pase: al terminar, si falla un paso, con Ctrl+C o con una señal, y al arrancar si una
 * corrida anterior quedó cortada. Separa los rojos esperados (los que el commit del día arregla
 * copiando al HTML los textos de src/i18n-modo-oficial.ts) de los inesperados.
 *
 * Uso:
 *   node scripts/ensayo-entrada-oficial.mjs                          # tipos, pruebas y build
 *   node scripts/ensayo-entrada-oficial.mjs --pasos typecheck        # solo los tipos
 *   node scripts/ensayo-entrada-oficial.mjs --pasos vitest --pruebas src/ui/x.test.ts
 *   node scripts/ensayo-entrada-oficial.mjs --salida ensayo.json     # el resumen también en JSON
 *   node scripts/ensayo-entrada-oficial.mjs --restaurar              # solo devuelve la lista y sale
 *
 * Las rojas esperadas salen con su diferencia: qué página y qué clave copiar al HTML el día.
 *
 * Opciones:
 *   --archivo <ruta>     la lista (por defecto src/stellar/deployments.json)
 *   --pasos <lista>      typecheck,vitest,build (por defecto los tres)
 *   --pruebas <rutas>    archivos de prueba para Vitest, separados por comas
 *   --salida <archivo>   escribe el resumen en JSON
 *   --dist <carpeta>     dónde construye (por defecto una carpeta temporal: dist/ no se pisa)
 *   --restaurar          restaura lo que dejó una corrida cortada y sale
 *   --orden "<comando>"  reemplaza los pasos por ese comando; existe solo para las pruebas del guion
 *
 * Sale con 0 si tipos y build están en verde y solo hay rojos esperados; 1 si hay algo más; 2 si el
 * uso está mal o la lista está en un estado que no corresponde; 3 si no pudo dejar la lista como estaba
 * (o si una corrida cortada la dejó con la entrada y alguien la cambió después: ahí no la toca). Si se
 * corta con una señal y la lista quedó como estaba, sale con 130 (SIGINT), 143 (SIGTERM), 129 (SIGHUP)
 * o 149 (SIGBREAK).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bloqueDelReporte,
  claveDeRuta,
  clasificarFallas,
  decidirVitest,
  erroresDeTsc,
  hoyUtc,
  ponerEntradaDeEnsayo,
  rutaDelDist,
  rutaDelRespaldo,
  sha256,
  tieneEntradaDeEnsayo,
} from "./lib/ensayo-oficial.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LISTA_REAL = join(RAIZ, "src", "stellar", "deployments.json");
const PASOS = ["typecheck", "vitest", "build"];

const args = process.argv.slice(2);
const tiene = (nombre) => args.includes(nombre);
function opcion(nombre) {
  const i = args.indexOf(nombre);
  if (i < 0) return undefined;
  const valor = args[i + 1];
  if (valor === undefined || valor.startsWith("--")) salirPorUso(`a ${nombre} le falta el valor`);
  return valor;
}
function salirPorUso(motivo) {
  console.error(`ensayo: ${motivo}. Mirá --help.`);
  process.exit(2);
}

if (tiene("--help") || tiene("-h")) {
  const texto = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const cabecera = texto.slice(texto.indexOf("/**") + 3, texto.indexOf("*/"));
  console.log(cabecera.split(/\r?\n/).map((l) => l.replace(/^ \* ?/, "")).join("\n").trim());
  process.exit(0);
}

const archivo = resolve(opcion("--archivo") ?? LISTA_REAL);
const orden = opcion("--orden");
const pasos = (opcion("--pasos") ?? PASOS.join(",")).split(",").map((p) => p.trim()).filter(Boolean);
for (const p of pasos) if (!PASOS.includes(p)) salirPorUso(`paso desconocido: ${p} (valen ${PASOS.join(", ")})`);
const pruebas = (opcion("--pruebas") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const salida = opcion("--salida");
const dist = resolve(opcion("--dist") ?? rutaDelDist(archivo));
// Las rutas van a una orden de la consola: solo caracteres que no le dicen nada a cmd ni a sh.
for (const ruta of [...pruebas, dist]) if (!/^[\w./:\\ -]+$/.test(ruta)) salirPorUso(`ruta con caracteres que no se aceptan: ${ruta}`);

const { carpeta: carpetaRespaldo, respaldo: rutaRespaldo, estado: rutaEstado } = rutaDelRespaldo(archivo);
const esLaListaReal = claveDeRuta(archivo) === claveDeRuta(LISTA_REAL);

if (!existsSync(archivo)) salirPorUso(`no existe ${archivo}`);

/** El respaldo que dejó otra corrida, si sus bytes son los que dice su estado. */
function respaldoValido() {
  try {
    const estado = JSON.parse(readFileSync(rutaEstado, "utf8"));
    const bytes = readFileSync(rutaRespaldo);
    if (claveDeRuta(estado.archivo) !== claveDeRuta(archivo) || sha256(bytes) !== estado.sha256Original) return null;
    return { estado, bytes };
  } catch {
    return null;
  }
}
const vivo = (pid) => {
  if (!pid || pid === process.pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === "EPERM"; }
};
const borrarRespaldo = () => rmSync(carpetaRespaldo, { recursive: true, force: true });
/**
 * El sha256 de lo que puso la corrida del respaldo. Lo guarda su estado; uno de antes de que lo
 * guardara se recalcula con la fecha en que arrancó. Si no se puede saber, null (no coincide con nada).
 */
function puestoDe({ estado, bytes }) {
  if (typeof estado.sha256Puesto === "string") return estado.sha256Puesto;
  try {
    return sha256(Buffer.from(ponerEntradaDeEnsayo(bytes.toString("utf8"), String(estado.desde).slice(0, 10))));
  } catch {
    return null;
  }
}

// ── Arranque: ¿quedó algo de una corrida cortada? ───────────────────────────────────────────────
let bytesOriginales = readFileSync(archivo);
const previo = respaldoValido();
if (previo && vivo(previo.estado.pid)) {
  if (!tiene("--restaurar")) {
    console.error(
      `ensayo: hay otro ensayo corriendo sobre esta lista (proceso ${previo.estado.pid}). Esperá a que termine.
` +
        "  Si no hay ninguno (ese número quedó de otro programa), --restaurar devuelve la lista igual.",
    );
    process.exit(2);
  }
  console.error(`ensayo: el proceso ${previo.estado.pid} sigue vivo; restauro igual porque lo pediste.`);
}
if (tieneEntradaDeEnsayo(bytesOriginales.toString("utf8"))) {
  if (!previo) {
    console.error(
      `ensayo: ${archivo} tiene algo de la entrada de ensayo (la dirección inventada o la huella de 64 ceros) y no hay un respaldo que sirva para devolverla.\n` +
        (esLaListaReal
          ? "  Para dejarla como en git: git checkout -- src/stellar/deployments.json"
          : "  Hay que sacar la entrada a mano (mainnet vuelve a null)."),
    );
    process.exit(2);
  }
  // Solo se pisa si la lista es exactamente la que puso la corrida cortada: si alguien la editó después
  // (por ejemplo, puso la dirección real y dejó la huella de ceros), lo editado no se pierde.
  if (sha256(bytesOriginales) !== puestoDe(previo)) {
    console.error(
      `ensayo: ${archivo} tiene algo de la entrada de ensayo, pero no es la lista que dejó la corrida cortada: alguien la cambió después. No la toqué.\n` +
        `  Los bytes de antes del ensayo quedaron en ${rutaRespaldo}. Revisala a mano y, si sirve, copiá ese respaldo encima.`,
    );
    process.exit(3);
  }
  writeFileSync(archivo, previo.bytes);
  if (sha256(readFileSync(archivo)) !== previo.estado.sha256Original) {
    console.error("ensayo: NO PUDE DEVOLVER LA LISTA de una corrida cortada. Revisala a mano antes de seguir.");
    process.exit(3);
  }
  borrarRespaldo();
  console.log(`ensayo: una corrida anterior quedó cortada; devolví la lista como estaba (sha256 ${previo.estado.sha256Original.slice(0, 16)}…).`);
  bytesOriginales = previo.bytes;
} else if (previo || existsSync(carpetaRespaldo)) {
  borrarRespaldo(); // un respaldo viejo con la lista ya sana: no sirve de nada
}

if (tiene("--restaurar")) {
  console.log("ensayo: la lista no tiene la entrada de ensayo.");
  process.exit(0);
}

let lista;
try {
  lista = JSON.parse(bytesOriginales.toString("utf8"));
} catch (e) {
  console.error(`ensayo: ${archivo} no es JSON válido: ${e.message}`);
  process.exit(2);
}
if (lista.mainnet !== null) {
  console.error("ensayo: la lista ya tiene una entrada en mainnet: esto no se corre sobre una lista con contrato real.");
  process.exit(2);
}
if (esLaListaReal) {
  const enIndice = spawnSync("git", ["-C", RAIZ, "diff", "--cached", "--name-only", "--", archivo], { encoding: "utf8" });
  if (enIndice.status !== 0 || enIndice.stdout.trim()) {
    console.error("ensayo: la lista está en el índice de git (o git no contestó). Sacala del índice antes de ensayar: git restore --staged src/stellar/deployments.json");
    process.exit(2);
  }
}

// ── El respaldo y la restauración, enganchada a todo lo que puede cortar ────────────────────────
const shaOriginal = sha256(bytesOriginales);
const desde = new Date();
/** El texto que pone el ensayo: lo único que la restauración pisa. Se calcula antes del respaldo para que el estado lo guarde. */
const aPoner = ponerEntradaDeEnsayo(bytesOriginales.toString("utf8"), hoyUtc(desde));
mkdirSync(carpetaRespaldo, { recursive: true });
writeFileSync(rutaRespaldo, bytesOriginales);
writeFileSync(
  rutaEstado,
  JSON.stringify({ archivo, sha256Original: shaOriginal, sha256Puesto: sha256(Buffer.from(aPoner)), pid: process.pid, desde: desde.toISOString() }, null, 2),
);

let restaurada = false;
/** El texto que puso el ensayo, desde que lo escribió. */
let puesto = null;
/** La lista no es ni la de antes ni la que puso el ensayo: alguien la cambió mientras corría. */
let cambiadaPorOtro = false;
const avisoCambiada = () =>
  `la lista cambió mientras corría el ensayo y no es la que puso: no la toqué. Los bytes de antes quedaron en ${rutaRespaldo}`;
/**
 * Devuelve los bytes exactos y comprueba el sha256. Sincrónica: también corre en `exit`. Si la lista
 * ya no es la que puso el ensayo (alguien la editó o hizo checkout mientras corría), no la pisa.
 */
function restaurar() {
  if (restaurada) return true;
  try {
    const actual = readFileSync(archivo);
    if (actual.equals(bytesOriginales)) {
      borrarRespaldo();
      restaurada = true;
      return true;
    }
    if (puesto === null || actual.toString("utf8") !== puesto) {
      cambiadaPorOtro = true;
      return false;
    }
    writeFileSync(archivo, bytesOriginales);
    if (sha256(readFileSync(archivo)) !== shaOriginal) return false;
    borrarRespaldo();
    restaurada = true;
    return true;
  } catch {
    return false;
  }
}
let hijo = null;
function matarHijo() {
  if (!hijo || hijo.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-hijo.pid, "SIGTERM");
  } catch { /* ya terminó */ }
}
function cortar(codigo, motivo) {
  matarHijo();
  const ok = restaurar();
  const estado = ok
    ? `La lista quedó como estaba (sha256 ${shaOriginal.slice(0, 16)}…).`
    : cambiadaPorOtro
      ? `Ojo: ${avisoCambiada()}.`
      : "NO PUDE DEVOLVER LA LISTA: corré --restaurar.";
  console.error(`\nensayo: ${motivo}. ${estado}`);
  process.exit(ok ? codigo : 3);
}
process.on("exit", () => {
  if (!restaurada && !restaurar() && !cambiadaPorOtro) console.error("ensayo: NO PUDE DEVOLVER LA LISTA: corré node scripts/ensayo-entrada-oficial.mjs --restaurar");
});
const SENALES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };
for (const [senal, codigo] of Object.entries(SENALES)) {
  try { process.on(senal, () => cortar(codigo, `cortado con ${senal}`)); } catch { /* señal que esta plataforma no tiene */ }
}
process.on("uncaughtException", (e) => cortar(1, `error sin atrapar: ${e?.stack ?? e}`));
process.on("unhandledRejection", (e) => cortar(1, `promesa rechazada sin atrapar: ${e?.stack ?? e}`));

// ── Los pasos ───────────────────────────────────────────────────────────────────────────────────
const comillas = (s) => `"${s}"`;
/** Corre una orden de la consola con la salida a la vista y guardada. */
function correr(comando) {
  return new Promise((listo) => {
    console.log(`\n$ ${comando}`);
    let texto = "";
    hijo = spawn(comando, {
      cwd: RAIZ,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TINKAZO_ENSAYO_OFICIAL: "1" },
    });
    hijo.stdout.on("data", (d) => { texto += d; process.stdout.write(d); });
    hijo.stderr.on("data", (d) => { texto += d; process.stderr.write(d); });
    hijo.on("error", (e) => { texto += String(e); });
    hijo.on("close", (codigo) => { hijo = null; listo({ codigo: codigo ?? 1, texto }); });
  });
}

const resumen = { archivo, contrato: "ensayo", pasos: {} };
let codigoFinal = 0;
try {
  puesto = aPoner;
  writeFileSync(archivo, puesto);
  console.log(`ensayo: puse la entrada de ensayo en ${archivo}`);

  if (orden !== undefined) {
    const r = await correr(orden);
    resumen.pasos.orden = { codigo: r.codigo };
    if (r.codigo !== 0) codigoFinal = 1;
  } else {
    if (pasos.includes("typecheck")) {
      const r = await correr("pnpm typecheck");
      const errores = erroresDeTsc(r.texto);
      resumen.pasos.typecheck = { codigo: r.codigo, errores };
      if (r.codigo !== 0) codigoFinal = 1;
    }
    if (pasos.includes("vitest")) {
      const informe = join(dirname(rutaDelDist(archivo)), "vitest.json");
      rmSync(informe, { force: true });
      const trabajadores = process.env.VITEST_MAX_WORKERS || "3";
      const r = await correr(
        ["pnpm exec vitest run", `--maxWorkers=${trabajadores}`, "--reporter=default", "--reporter=json", `--outputFile.json=${comillas(informe)}`, ...pruebas.map(comillas)].join(" "),
      );
      let clasificadas;
      let leido = null;
      try {
        leido = JSON.parse(readFileSync(informe, "utf8"));
        clasificadas = clasificarFallas(leido, RAIZ);
      } catch (e) {
        clasificadas = { esperadas: [], inesperadas: [{ archivo: "(vitest)", nombre: "el informe JSON no se pudo leer", mensaje: String(e.message ?? e) }] };
      }
      // El código de salida y la salida también cuentan: un error suelto o una ruta mal escrita no dejan rojas en el informe.
      clasificadas = decidirVitest({ codigo: r.codigo, informe: leido, texto: r.texto, clasificadas, pedidas: pruebas, raiz: RAIZ });
      for (const f of clasificadas.esperadas) f.mensajeEntero = bloqueDelReporte(r.texto, f.archivo, f.titulos) ?? f.mensajeEntero;
      resumen.pasos.vitest = { codigo: r.codigo, ...clasificadas };
      if (clasificadas.inesperadas.length) codigoFinal = 1;
    }
    if (pasos.includes("build")) {
      const r = await correr(`pnpm exec vite build --outDir ${comillas(dist)} --emptyOutDir`);
      resumen.pasos.build = { codigo: r.codigo, ok: r.codigo === 0, dist };
      if (r.codigo !== 0) codigoFinal = 1;
    }
  }
} finally {
  const ok = restaurar();
  resumen.lista = { restaurada: ok, sha256: shaOriginal };
  if (ok) console.log(`\nensayo: la lista quedó como estaba (sha256 ${shaOriginal})`);
  else {
    console.error(
      cambiadaPorOtro
        ? `\nensayo: ${avisoCambiada()}. Revisala a mano.`
        : "\nensayo: NO PUDE DEVOLVER LA LISTA. Corré node scripts/ensayo-entrada-oficial.mjs --restaurar y revisala.",
    );
    codigoFinal = 3;
  }
}

// ── El resumen ──────────────────────────────────────────────────────────────────────────────────
const { typecheck, vitest, build } = resumen.pasos;
console.log("\n── Resumen del ensayo ──");
if (resumen.pasos.orden) console.log(`orden: salió con ${resumen.pasos.orden.codigo}`);
if (typecheck) {
  console.log(`tipos: ${typecheck.codigo === 0 ? "en verde" : `${typecheck.errores.length} error(es)`}`);
  for (const e of typecheck.errores) console.log(`  ${e.archivo}:${e.linea} ${e.codigo} ${e.mensaje}`);
  if (typecheck.codigo !== 0 && !typecheck.errores.length) console.log("  (salió con error y no encontré renglones de tsc: mirá la salida de arriba)");
}
if (vitest) {
  console.log(`pruebas: ${vitest.inesperadas.length} roja(s) inesperada(s), ${vitest.esperadas.length} esperada(s)`);
  for (const f of vitest.inesperadas) console.log(`  INESPERADA${f.tiempo ? " (por tiempo)" : ""} ${f.archivo} > ${f.nombre}\n    ${f.mensaje}`);
  for (const f of vitest.esperadas) {
    console.log(`  esperada ${f.archivo} > ${f.nombre}\n    ${f.motivo}`);
    if (f.mensajeEntero) console.log(f.mensajeEntero.split(/\r?\n/).map((l) => `      ${l}`).join("\n"));
  }
}
if (build) console.log(`build: ${build.ok ? `en verde, en ${build.dist}` : `falló (salió con ${build.codigo})`}`);
console.log(`resultado: ${codigoFinal === 0 ? "listo para el commit del día (solo rojos esperados)" : codigoFinal === 3 ? "LA LISTA NO QUEDÓ COMO ESTABA" : "hay algo más que arreglar"}`);

if (salida) {
  const destino = resolve(salida);
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify({ ...resumen, codigo: codigoFinal }, null, 2) + "\n");
}
process.exitCode = codigoFinal;
