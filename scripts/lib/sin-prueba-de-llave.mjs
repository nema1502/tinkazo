/**
 * La revisión de que la prueba de la llave no llega a producción (issue 301).
 *
 * Mira una carpeta ya construida. Sin `presente`, la carpeta NO puede traer nada de la prueba: ni la página, ni un mapa de
 * fuentes que nombre al kit o a su SDK, ni sus direcciones. Con `presente`, tiene que traerla entera: es el control de que
 * la revisión no está vacía (un armado donde las marcas nunca coinciden pasaría siempre).
 *
 * Las marcas son las mismas de `src/prueba-llave/en-el-build.ts`: la forma real del almacén de pnpm, sobre rutas con barras
 * normales. Una prueba las compara con las de ese archivo.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const MARCAS = [
  /\/\.pnpm\/smart-account-kit@/,
  /\/\.pnpm\/smart-account-kit-bindings@/,
  /\/\.pnpm\/@simplewebauthn\+browser@/,
  /\/\.pnpm\/@stellar\+stellar-sdk@16\./,
  /\/\.pnpm\/base64url@/,
  /\/node_modules\/smart-account-kit(-bindings)?\//,
  /\/node_modules\/@simplewebauthn\//,
  /\/src\/prueba-llave\//,
];

/** Textos que identifican la prueba y que no pueden estar en ningún archivo publicado. */
export const TEXTOS_DE_LA_PRUEBA = ["openzeppelin-smart-account-kit", "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F", "c514d35ea67e"];

const EXTENSIONES_DE_TEXTO = new Set([".js", ".mjs", ".html", ".css", ".json", ".map", ".txt", ".xml", ".webmanifest"]);

/** Una ruta de un mapa de fuentes, con barras normales y una barra delante para que las marcas la reconozcan. */
export function rutaDeFuente(fuente) {
  return `/${String(fuente).replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

export function esMarcaDeLaPrueba(fuente) {
  const ruta = rutaDeFuente(fuente);
  return MARCAS.some((m) => m.test(ruta));
}

function archivos(dir) {
  const salida = [];
  const pendientes = [dir];
  while (pendientes.length) {
    const d = pendientes.pop();
    for (const nombre of readdirSync(d)) {
      const ruta = join(d, nombre);
      if (statSync(ruta).isDirectory()) pendientes.push(ruta);
      else salida.push(ruta);
    }
  }
  return salida;
}

const extension = (ruta) => {
  const i = ruta.lastIndexOf(".");
  return i < 0 ? "" : ruta.slice(i).toLowerCase();
};

/** Las fuentes que nombra un mapa, o un arreglo vacío si no se puede leer. */
function fuentesDeMapa(texto) {
  try {
    const m = JSON.parse(texto);
    return Array.isArray(m.sources) ? m.sources.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Revisa una carpeta construida. Devuelve `{ ok, problemas, hallado }`. Los mensajes no escriben rutas de afuera de la carpeta.
 * @param {string} dir
 * @param {{ presente?: boolean }} [o]
 */
export function revisarCarpeta(dir, o = {}) {
  const presente = o.presente === true;
  const problemas = [];
  if (!existsSync(dir)) return { ok: false, problemas: [`no existe la carpeta ${dir}`], hallado: { pagina: false, kit: false, sdk16: false, textos: [] } };

  const hallado = { pagina: existsSync(join(dir, "prueba", "llave", "index.html")), kit: false, sdk16: false, textos: [] };
  const archivosDeLaPrueba = existsSync(join(dir, "prueba")) ? archivos(join(dir, "prueba")).length : 0;
  const delKit = /\/\.pnpm\/smart-account-kit@|\/node_modules\/smart-account-kit\//;
  const delSdk16 = /\/\.pnpm\/@stellar\+stellar-sdk@16\./;
  const marcasHalladas = new Set();

  for (const ruta of archivos(dir)) {
    const ext = extension(ruta);
    if (!EXTENSIONES_DE_TEXTO.has(ext)) continue;
    const relativa = ruta.slice(dir.length).replace(/\\/g, "/").replace(/^\/+/, "");
    const texto = readFileSync(ruta, "utf8");
    if (ext === ".map") {
      for (const f of fuentesDeMapa(texto)) {
        const r = rutaDeFuente(f);
        if (delKit.test(r)) hallado.kit = true;
        if (delSdk16.test(r)) hallado.sdk16 = true;
        if (esMarcaDeLaPrueba(f)) marcasHalladas.add(`${relativa} nombra ${r.split("/").slice(-3).join("/")}`);
      }
    }
    for (const t of TEXTOS_DE_LA_PRUEBA) {
      if (texto.includes(t)) {
        hallado.textos.push(t);
        marcasHalladas.add(`${relativa} trae ${t}`);
      }
    }
  }

  if (!presente) {
    if (archivosDeLaPrueba > 0) problemas.push("la carpeta trae la carpeta prueba/");
    for (const m of [...marcasHalladas].slice(0, 10)) problemas.push(m);
  } else {
    if (!hallado.pagina) problemas.push("falta prueba/llave/index.html: la revisión no tiene qué revisar");
    if (!hallado.kit) problemas.push("ningún mapa de fuentes nombra al kit: las marcas no coinciden con la forma del almacén");
    if (!hallado.sdk16) problemas.push("ningún mapa de fuentes nombra al SDK 16 del kit: las marcas no coinciden con la forma del almacén");
    if (!hallado.textos.includes("c514d35ea67e")) problemas.push("ningún archivo trae el código de la cuenta de la prueba");
  }
  return { ok: problemas.length === 0, problemas, hallado };
}
