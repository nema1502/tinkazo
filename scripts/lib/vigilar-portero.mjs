/**
 * La revisión diaria del portero de mainnet: lee la respuesta de `GET /v1/patrocinio/estado` (un archivo JSON que bajó
 * el paso del workflow con la clave de operar) y sale con 1 si hay algo que mirar:
 *
 * - los créditos de Pollar por debajo del piso más 1.000 (o sin leer);
 * - la cuenta patrocinadora baja o sin leer (`alerta`);
 * - más de 10 firmas sin explicar en las últimas 24 horas (o sin la vigilancia);
 * - el patrocinio de la app en Pollar que no está todo apagado (o sin leer);
 * - y que no sea el portero de mainnet: no se da por bueno el portero equivocado.
 *
 * Sin dependencias, solo Node: el workflow no instala nada. Lo que mide cada cifra está en
 * `workers/patrocinio/README.md`, «Altas y cupones».
 *
 *   node scripts/lib/vigilar-portero.mjs estado-portero-mainnet.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Lo que tiene que sobrar de créditos encima del piso. */
export const MARGEN_MINIMO = 1000;
/** Más que esto sin explicar en 24 horas es para mirar (el mismo número que `FIRMAS_SIN_EXPLICAR_MAX` del portero). */
export const MAX_SIN_EXPLICAR = 10;

const esNumero = (x) => typeof x === "number" && Number.isFinite(x);

/** Los problemas de este `/estado` (vacío si está todo en orden) y una línea con las cifras. */
export function revisarPortero(e) {
  const problemas = [];
  if (!e || typeof e !== "object") return { problemas: ["la respuesta de /estado no es un objeto"], resumen: "sin datos" };
  if (e.red !== "mainnet") problemas.push(`no es el portero de mainnet (red: ${String(e.red)})`);
  if (e.alerta !== false) problemas.push(`la cuenta patrocinadora está baja o no se pudo leer (${e.motivoAlerta ?? "sin alerta en la respuesta"})`);
  if (!esNumero(e.creditos) || !esNumero(e.piso)) problemas.push("no se pudo leer el saldo de créditos de Pollar o el piso");
  else if (e.creditos < e.piso + MARGEN_MINIMO) problemas.push(`los créditos de Pollar (${e.creditos}) están por debajo del piso más ${MARGEN_MINIMO} (${e.piso + MARGEN_MINIMO}): cargar créditos`);
  if (!esNumero(e.firmasSinExplicar)) problemas.push("no se pudo comparar las firmas que cobró Pollar con las nuestras");
  else if (e.firmasSinExplicar > MAX_SIN_EXPLICAR) problemas.push(`${e.firmasSinExplicar} firmas de cuentas de Google sin explicar en 24 horas (más de ${MAX_SIN_EXPLICAR}): alguien firma por fuera del sitio`);
  const pat = e.patrocinioPollar;
  if (!pat || typeof pat !== "object") problemas.push("no se pudo leer el patrocinio de la app en Pollar");
  else if (pat.esperado !== true) problemas.push(`el patrocinio de la app en Pollar no está todo apagado: ${Array.isArray(pat.prendidos) && pat.prendidos.length ? pat.prendidos.join(", ") : "sin detalle"}`);

  const f = e.firmas && typeof e.firmas === "object" ? e.firmas : {};
  const resumen = [
    `créditos ${e.creditos ?? "?"}, piso ${e.piso ?? "?"}`,
    `patrocinadora ${e.balanceStroops ?? "?"} stroops`,
    `firmas: ${f.cobradas ?? "?"} cobradas, ${f.explicadas ?? "?"} explicadas, ${e.firmasSinExplicar ?? "?"} sin explicar${f.completo === false ? " (vinieron 200 movimientos: puede haber más)" : ""}`,
    `patrocinio ${pat?.esperado === true ? "apagado" : pat ? "prendido" : "?"}`,
  ].join(" | ");
  return { problemas, resumen };
}

/** Lee el archivo, muestra el resumen y los problemas, y devuelve el código de salida. */
export function principal(argv, { log = console.log } = {}) {
  const [archivo] = argv;
  if (!archivo) {
    log("Uso: node scripts/lib/vigilar-portero.mjs <estado.json>");
    return 1;
  }
  let estado;
  try {
    estado = JSON.parse(readFileSync(archivo, "utf8"));
  } catch (e) {
    log(`No se pudo leer ${archivo}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const { problemas, resumen } = revisarPortero(estado);
  log(resumen);
  for (const p of problemas) log(`Problema: ${p}`);
  return problemas.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal(process.argv.slice(2));
}
