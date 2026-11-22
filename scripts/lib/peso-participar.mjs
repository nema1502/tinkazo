/**
 * Lo que pesa la página del celular de quien participa (participar.html), comprimido como lo recibe el navegador.
 *
 * La página la abren 150 celulares con datos, así que lo que se le suma tiene tope. Se mide sobre `dist/` con tres números:
 *
 *  - `entrada`: el trozo de código de la página (participar-*.js). Es lo que el diseño llama "participar" y su tope es 15 KB.
 *  - `celular`: la suma de todos los trozos que la página carga al abrir y que son solo del celular, o sea los que no
 *    traen nada de la herramienta ni de otras páginas. El armado reparte los textos y el cliente de la sala en trozos
 *    propios, y sin esta suma lo que se agregue ahí no se vería en la entrada.
 *  - `html`: participar.html con los textos que lleva adentro, en español y en inglés.
 *  - `hoja`: la hoja de estilos de la campaña (la que trae las reglas de `.cmp-hero`), que la página pide aparte.
 *
 * Lo que se baja con `import()` (la tarjeta de confirmar el correo, la pantalla encendida) no cuenta: se baja solo cuando
 * hace falta. Sin red ni navegador.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

/** KB como los cuenta el diseño: 1 KB son 1.024 bytes. */
const KB = 1024;

/**
 * Los topes. El de la entrada es el del diseño (13,6 KB medidos en la copia de referencia, tope 15). Los otros dos son la
 * medida de hoy más lo que el diseño prevé sumar en las etapas siguientes: se suben solo con una razón escrita.
 *
 * El del código del celular pasó de 26 a 26,5 KB al sumar la pantalla del premio y el límite de ingresos: la línea del
 * límite, la lectura recordada de la cuenta y el texto de Ganaste según la cuenta se bajan con import() y no cuentan, pero
 * soltar la sesión del proveedor después de anotarse, no retomarla al recargar y los enlaces para llevar el premio a otro
 * navegador viven en la página. Se sacaron antes doce textos que ninguna pantalla usaba. La entrada sigue en 14,5 de 15 KB.
 * Lo que sume la cuenta regresiva va diferido.
 *
 * Pasó de 26,5 a 26,7 KB (27.263 bytes medidos) al corregir lo que dejó la revisión de la tarjeta de confirmar el correo: el
 * origen de cada aviso de cambio y que la tarjeta quieta no retenga la sesión del proveedor, la comparación de la sesión con la
 * cuenta al ir a recibir y la lectura de la cuenta de la página, y el interruptor de la ventana rápida. Lo que se pudo bajar a
 * pedido se bajó: el reparto del primer pedido va con la cuenta regresiva, la comparación de sesiones con lo de Ganaste y la
 * lectura de la sesión del navegador con la tarjeta. La entrada sigue en 13,8 de 15 KB.
 */
export const TOPES = {
  entrada: 15 * KB,
  celular: 26.7 * KB,
  html: 8 * KB,
  hoja: 5 * KB,
};

/** Lo que cuenta como código del celular: sus carpetas y el cliente de la sala de campañas. */
const ES_DEL_CELULAR = /^(?:src\/campana\/|src\/participar\.ts$|src\/sala\/campana\.ts$)/u;

/** Lo que pesa un archivo comprimido con gzip al máximo. */
export const comprimido = (contenido) => gzipSync(contenido, { level: 9 }).length;

/** Los trozos de código y las hojas de estilo que el HTML pide al abrir: el script de entrada y lo que precarga. */
export function trozosDelHtml(html) {
  const entradas = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/gu)].map((m) => m[1]);
  const precargas = [...html.matchAll(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+\.js)"/gu)].map((m) => m[1]);
  return { entrada: entradas[0] ?? null, js: [...new Set([...entradas, ...precargas])] };
}

/** La ruta de un archivo como la deja el mapa (con ../ delante), sin eso y con barras comunes. */
const rutaLimpia = (f) => String(f).replace(/\\/gu, "/").replace(/^(?:\.\.\/)+/u, "");

/** Las hojas de estilo que el HTML pide al abrir. */
export function hojasDelHtml(html) {
  return [...new Set([...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+\.css)"/gu)].map((m) => m[1]))];
}

/** Si todo el código propio de un trozo es del celular. Un trozo sin mapa o sin código propio no cuenta. */
export function esSoloDelCelular(fuentes) {
  const propias = fuentes.map(rutaLimpia).filter((f) => !f.includes("node_modules"));
  return propias.length > 0 && propias.every((f) => ES_DEL_CELULAR.test(f));
}

/** Los archivos propios que trae un trozo, leídos de su mapa. Sin mapa, lista vacía. */
function fuentesDelTrozo(dist, ruta) {
  const mapa = join(dist, `${ruta}.map`);
  if (!existsSync(mapa)) return [];
  try {
    return JSON.parse(readFileSync(mapa, "utf8")).sources ?? [];
  } catch {
    return [];
  }
}

/** Mide `dist/participar.html`. Devuelve los tres números en bytes y el detalle de cada trozo del celular. */
export function medir(dist) {
  const archivo = join(dist, "participar.html");
  if (!existsSync(archivo)) throw new Error(`No hay ${archivo}. Construí el sitio primero (pnpm exec vite build).`);
  const html = readFileSync(archivo);
  const { entrada, js } = trozosDelHtml(html.toString("utf8"));
  if (!entrada) throw new Error("participar.html no pide ningún trozo de código: el armado cambió.");
  const detalle = [];
  for (const ruta of js) {
    const local = join(dist, ruta.replace(/^\//u, ""));
    if (!existsSync(local)) throw new Error(`participar.html pide ${ruta} y no está en ${dist}.`);
    const contenido = readFileSync(local);
    const delCelular = ruta === entrada || esSoloDelCelular(fuentesDelTrozo(dist, ruta.replace(/^\//u, "")));
    detalle.push({ ruta, crudo: contenido.length, comprimido: comprimido(contenido), delCelular });
  }
  const propios = detalle.filter((d) => d.delCelular);
  // La hoja de la campaña es la que trae `.cmp-hero` (el bloque de color de sus pantallas): las demás son de todo el sitio.
  let hoja = 0;
  for (const ruta of hojasDelHtml(html.toString("utf8"))) {
    const local = join(dist, ruta.replace(/^\//u, ""));
    if (!existsSync(local)) continue;
    const contenido = readFileSync(local);
    if (/\.cmp-hero/u.test(contenido.toString("utf8"))) hoja += comprimido(contenido);
  }
  return {
    entrada: propios.find((d) => d.ruta === entrada)?.comprimido ?? 0,
    celular: propios.reduce((suma, d) => suma + d.comprimido, 0),
    html: comprimido(html),
    hoja,
    detalle: propios,
  };
}

/** Qué números pasan de su tope. Lista vacía si todo entra. */
export function excesos(medida, topes = TOPES) {
  return ["entrada", "celular", "html", "hoja"]
    .filter((nombre) => medida[nombre] > topes[nombre])
    .map((nombre) => ({ nombre, medida: medida[nombre], tope: topes[nombre] }));
}

const enKb = (bytes) => `${(bytes / KB).toFixed(1).replace(".", ",")} KB`;

/** El informe en renglones, listo para imprimir. */
export function informe(medida, topes = TOPES) {
  const renglones = [
    `Entrada (participar-*.js): ${enKb(medida.entrada)} de ${enKb(topes.entrada)}`,
    `Código solo del celular, en todos sus trozos: ${enKb(medida.celular)} de ${enKb(topes.celular)}`,
    `participar.html con sus textos: ${enKb(medida.html)} de ${enKb(topes.html)}`,
    `Hoja de estilos de la campaña: ${enKb(medida.hoja)} de ${enKb(topes.hoja)}`,
    "",
    "Trozos del celular:",
    ...medida.detalle.map((d) => `  ${d.ruta}  ${enKb(d.comprimido)}  (${enKb(d.crudo)} sin comprimir)`),
  ];
  for (const e of excesos(medida, topes)) renglones.push("", `PASA EL TOPE: ${e.nombre} pesa ${enKb(e.medida)} y el tope es ${enKb(e.tope)}.`);
  return renglones.join("\n");
}
