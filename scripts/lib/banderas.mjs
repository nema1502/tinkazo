/**
 * Las piezas de scripts/check-banderas.mjs, sin red ni archivos para poder probarlas.
 *
 * El sitio se construye con variables VITE_ que quedan escritas en su código. Acá
 * viven tres cosas: leer la tabla de docs/operacion.md, sacar de un texto de código
 * ya empaquetado las variables que quedaron escritas, y comparar las dos.
 *
 * Regla de oro: el informe de la comparación nunca escribe el valor de una variable
 * que la tabla marca como reservada (`definida`) ni de una que la tabla no nombra.
 * Un valor solo se escribe cuando la tabla lo publica.
 */

/** El encabezado de la sección de docs/operacion.md que lee la comprobación. */
export const TITULO_SECCION = "Las banderas del sitio y su estado en producción";

/** Lo que dice la columna En producción cuando la variable no está escrita en el sitio. */
export const SIN_DEFINIR = "sin definir";

/** Lo que dice la columna En producción de una variable reservada: solo se comprueba que exista. */
export const DEFINIDA = "definida";

/** Las variables que pone el sistema de publicación: no son banderas y no se leen ni se muestran. */
export const esDelSistema = (nombre) => nombre.startsWith("VITE_VERCEL_");

const limpiarCelda = (c) => c.trim().replace(/^`+|`+$/g, "").trim();

/**
 * La sección de banderas de operacion.md: sus filas y la frase de la lectura.
 * Devuelve `{ encontrada, lectura, filas, problemas }`. Cada fila trae
 * `variable`, `sinLaVariable` y `produccion` (un valor escrito, `definida` o `sin definir`).
 */
export function leerTabla(markdown) {
  const lineas = String(markdown).split(/\r?\n/);
  const inicio = lineas.findIndex((l) => l.trim() === `## ${TITULO_SECCION}`);
  const problemas = [];
  if (inicio < 0) {
    return { encontrada: false, lectura: null, filas: [], problemas: [`falta la sección "${TITULO_SECCION}"`] };
  }
  let fin = lineas.length;
  for (let i = inicio + 1; i < lineas.length; i++) {
    if (/^#{1,2} /.test(lineas[i])) {
      fin = i;
      break;
    }
  }
  const cuerpo = lineas.slice(inicio + 1, fin);
  const texto = cuerpo.join("\n");
  const m = /Leído del sitio publicado el (\d{1,2} de [a-záéíóú]+ de \d{4})/.exec(texto);
  const lectura = m ? m[1] : null;
  if (!lectura) problemas.push("la sección no dice 'Leído del sitio publicado el <fecha>'");

  const filas = [];
  const vistas = new Set();
  let enTabla = false;
  for (const linea of cuerpo) {
    if (!linea.trim().startsWith("|")) {
      enTabla = false;
      continue;
    }
    const celdas = linea.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    if (!enTabla) {
      // La primera fila de la tabla es el encabezado y la segunda su raya.
      enTabla = true;
      continue;
    }
    if (celdas.every((c) => /^[\s:-]*$/.test(c))) continue;
    if (celdas.length < 3) {
      problemas.push(`fila con menos de tres columnas: ${linea.trim().slice(0, 60)}`);
      continue;
    }
    const variable = limpiarCelda(celdas[0]);
    const sinLaVariable = celdas[1].trim();
    const produccion = limpiarCelda(celdas[2]);
    if (!/^VITE_[A-Z0-9_]+$/.test(variable)) {
      problemas.push(`la primera columna no es una variable VITE_: ${variable.slice(0, 40)}`);
      continue;
    }
    if (vistas.has(variable)) {
      problemas.push(`${variable} está dos veces en la tabla`);
      continue;
    }
    vistas.add(variable);
    if (!produccion) {
      problemas.push(`${variable} no dice qué hay en producción`);
      continue;
    }
    filas.push({ variable, sinLaVariable, produccion });
  }
  if (!filas.length) problemas.push("la tabla no tiene filas");
  return { encontrada: true, lectura, filas, problemas };
}

/** Lee un literal de JavaScript ya empaquetado desde la posición i. Devuelve `{ valor, fin }` o null. */
function leerLiteral(t, i) {
  const c = t[i];
  if (c === "`" || c === "'" || c === '"') {
    let valor = "";
    let j = i + 1;
    while (j < t.length) {
      const d = t[j];
      if (d === "\\") {
        const s = t[j + 1];
        const mapa = { n: "\n", t: "\t", r: "\r" };
        valor += mapa[s] ?? s;
        j += 2;
        continue;
      }
      if (d === c) return { valor, fin: j + 1 };
      // Una plantilla con expresión no es un valor fijo: no se sabe leer.
      if (c === "`" && d === "$" && t[j + 1] === "{") return null;
      valor += d;
      j++;
    }
    return null;
  }
  const resto = t.slice(i, i + 40);
  let m;
  if ((m = /^!0(?![\w$])/.exec(resto))) return { valor: true, fin: i + m[0].length };
  if ((m = /^!1(?![\w$])/.exec(resto))) return { valor: false, fin: i + m[0].length };
  if ((m = /^void 0(?![\w$])/.exec(resto)) || (m = /^undefined(?![\w$])/.exec(resto))) return { valor: undefined, fin: i + m[0].length };
  if ((m = /^null(?![\w$])/.exec(resto))) return { valor: null, fin: i + m[0].length };
  if ((m = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w$])/i.exec(resto))) return { valor: Number(m[0]), fin: i + m[0].length };
  return null;
}

/** Lee una clave (sin comillas o con ellas) desde la posición i. */
function leerClave(t, i) {
  const c = t[i];
  if (c === "'" || c === '"' || c === "`") {
    const l = leerLiteral(t, i);
    return l && typeof l.valor === "string" ? { clave: l.valor, fin: l.fin } : null;
  }
  const m = /^[A-Za-z_$][\w$]*/.exec(t.slice(i, i + 80));
  return m ? { clave: m[0], fin: i + m[0].length } : null;
}

/**
 * Las variables de un objeto `{BASE_URL:..., MODE:..., VITE_X:...}` que el empaquetador
 * deja en el código. Se lee en secuencia, clave por clave, porque el valor de alguna
 * (el mensaje del commit, una configuración con llaves adentro) es texto libre.
 * Devuelve un Map nombre a valor, sin las del sistema, o null si no hay objeto.
 * `error` dice, sin mostrar contenido, por qué no se pudo leer un objeto que empezaba bien.
 */
export function sacarVariables(codigo) {
  const texto = String(codigo);
  const reInicio = /\{(["'`]?)BASE_URL\1:/g;
  let hallado = null;
  let m;
  while ((m = reInicio.exec(texto))) {
    const vars = new Map();
    let i = m.index + 1;
    let ok = false;
    for (;;) {
      const k = leerClave(texto, i);
      if (!k || texto[k.fin] !== ":") break;
      const v = leerLiteral(texto, k.fin + 1);
      if (!v) break;
      if (k.clave.startsWith("VITE_") && !esDelSistema(k.clave)) vars.set(k.clave, v.valor);
      i = v.fin;
      if (texto[i] === ",") {
        i++;
        continue;
      }
      if (texto[i] === "}") ok = true;
      break;
    }
    if (ok) {
      hallado = vars;
      break;
    }
  }
  return hallado;
}

/** Los archivos de código que nombra la portada: el script de entrada y los modulepreload. */
export function archivosDeLaPortada(html) {
  const salida = new Set();
  const reTag = /<(script|link)\b[^>]*>/gi;
  let m;
  while ((m = reTag.exec(String(html)))) {
    const tag = m[0];
    const esScript = /^<script/i.test(tag) && /\btype\s*=\s*["']module["']/i.test(tag);
    const esPre = /^<link/i.test(tag) && /\brel\s*=\s*["']modulepreload["']/i.test(tag);
    if (!esScript && !esPre) continue;
    const ref = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (ref && /\.m?js(?:\?|$)/.test(ref[1])) salida.add(ref[1]);
  }
  return [...salida];
}

/** Los archivos .js que un código empaquetado nombra con ruta relativa a su carpeta (./x.js). */
export function referenciasRelativas(codigo) {
  const salida = new Set();
  const re = /["'`]\.\/([\w.-]+\.js)["'`]/g;
  let m;
  while ((m = re.exec(String(codigo)))) salida.add(m[1]);
  return [...salida];
}

const valorTexto = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v)).slice(0, 40);

/**
 * Compara la tabla con lo que el sitio tiene escrito. `variables` es un Map de
 * `sacarVariables`. Devuelve `{ filas, fallas }`: una entrada por fila con su estado
 * efectivo, y un mensaje por cada diferencia. Nunca escribe un valor reservado.
 */
export function comparar(tabla, variables) {
  const fallas = [];
  const filas = [];
  const nombradas = new Set(tabla.map((f) => f.variable));
  for (const f of tabla) {
    const escrita = variables.has(f.variable);
    const valor = escrita ? valorTexto(variables.get(f.variable)) : "";
    let ok = true;
    let estado;
    if (f.produccion === SIN_DEFINIR) {
      const prendida = /^(pistas )?prendidas?\b/i.test(f.sinLaVariable);
      estado = escrita ? "definida en el sitio" : prendida ? `sin definir, así que está prendida por defecto (${f.sinLaVariable})` : `sin definir, ${f.sinLaVariable}`;
      if (escrita) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice '${SIN_DEFINIR}' y el sitio la trae definida`);
      }
    } else if (f.produccion === DEFINIDA) {
      estado = escrita && valor !== "" ? "definida" : escrita ? "vacía" : "sin definir";
      if (!escrita || valor === "") {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice '${DEFINIDA}' y el sitio la trae ${escrita ? "vacía" : "sin definir"}`);
      }
    } else {
      estado = escrita ? `vale ${valor}` : "sin definir";
      if (!escrita) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice que vale ${f.produccion} y el sitio no la trae`);
      } else if (valor !== f.produccion) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice que vale ${f.produccion} y el sitio trae ${valor === "" ? "vacía" : valor}`);
      }
    }
    filas.push({ variable: f.variable, ok, estado });
  }
  for (const [nombre, v] of variables) {
    if (esDelSistema(nombre) || nombradas.has(nombre)) continue;
    fallas.push(`${nombre}: el sitio la trae ${valorTexto(v) === "" ? "vacía" : "definida"} y la tabla no la nombra`);
  }
  return { filas, fallas };
}
