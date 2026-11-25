/**
 * Las piezas de scripts/check-banderas.mjs, sin red ni archivos para poder probarlas.
 *
 * El sitio se construye con variables VITE_ que quedan escritas en su código. Acá
 * viven cuatro cosas: leer la tabla de docs/operacion.md, sacar de un texto de código
 * ya empaquetado las variables que quedaron escritas, comparar las dos, y bajar el sitio
 * con reintentos y un tope de tiempo (la red entra por parámetro, para probarlo sin ella).
 *
 * Regla de oro: el informe de la comparación nunca escribe el valor de una variable
 * reservada (la lista fija de RESERVADAS: montos, cuentas y llaves), diga lo que diga
 * su fila, ni el de una que la tabla no nombra. De las demás, solo escribe el valor
 * del sitio si es uno de los conocidos de VALORES_QUE_SE_ESCRIBEN y, si no, dice
 * que tiene otro valor.
 */

/** El encabezado de la sección de docs/operacion.md que lee la comprobación. */
export const TITULO_SECCION = "Las banderas del sitio y su estado en producción";

/** Lo que dice la columna En producción cuando la variable no está escrita en el sitio. */
export const SIN_DEFINIR = "sin definir";

/** Lo que dice la columna En producción de una variable reservada: solo se comprueba que exista. */
export const DEFINIDA = "definida";

/**
 * Las variables cuyo valor es un monto, una dirección o una llave pública. La tabla de
 * operacion.md dice de ellas solo `definida` y la comprobación solo mira que existan.
 * La lista es fija a propósito: no depende de lo que escriba la tabla.
 */
export const RESERVADAS = new Set([
  "VITE_COMISION_CUENTA",
  "VITE_COMISION_MINIMO",
  "VITE_COMISION_PB",
  "VITE_RETIRO_CUENTA",
  "VITE_RETIRO_COSTO",
  "VITE_POLLAR_PUBLISHABLE_KEY",
  "VITE_POLLAR_PUBLISHABLE_KEY_MAINNET",
  "VITE_PATROCINIO_URL_MAINNET",
]);

/** Los únicos valores del sitio que un informe puede escribir en un desajuste de una bandera común. */
const VALORES_QUE_SE_ESCRIBEN = new Set(["", "0", "1", "true", "false", "mainnet", "testnet", "premios", "sintetizada"]);

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

/** Cuánto puede tardar en total la lectura del sitio: pasado esto el guion falla con su propio mensaje. */
export const TOPE_TOTAL_MS = 90_000;
/** Cuánto se espera a un solo archivo en cada intento. */
export const TIEMPO_POR_INTENTO_MS = 15_000;
/** Cuántas veces más se pide un archivo que no bajó, antes de darlo por caído. */
export const REINTENTOS = 2;
/** La espera corta entre un intento y el siguiente. */
export const ESPERA_ENTRE_INTENTOS_MS = 1_500;
/** Cuántos archivos se bajan a la vez. */
export const SIMULTANEOS = 6;

const dormirDeVerdad = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** El error de una lectura que se quedó sin el tiempo total: el guion lo cuenta aparte de un corte del sitio. */
export class SinTiempo extends Error {
  constructor(mensaje = "se acabó el tiempo total de la lectura") {
    super(mensaje);
    this.name = "SinTiempo";
    this.sinTiempo = true;
  }
}

/**
 * Baja un texto con reintentos: una respuesta que no es 2xx, un corte de red o un archivo que no termina
 * de llegar se piden de nuevo (`reintentos` veces más, con una espera corta) antes de dar el archivo por caído.
 * `limite` es la hora (en milisegundos, la de `ahora()`) en que se acaba el tiempo total: ningún intento ni
 * ninguna espera pasan de ahí, y si ya pasó se lanza `SinTiempo`. El mensaje del error dice solo cuántos
 * intentos se hicieron y qué respondió el sitio: nunca el contenido de lo que se bajó. Todo lo de afuera
 * (`fetchFn`, `ahora`, `dormir`) se puede reemplazar para probarlo sin red.
 */
export async function bajarConReintentos(url, opciones = {}) {
  const {
    fetchFn = fetch,
    reintentos = REINTENTOS,
    esperaMs = ESPERA_ENTRE_INTENTOS_MS,
    tiempoMs = TIEMPO_POR_INTENTO_MS,
    limite = Infinity,
    ahora = Date.now,
    dormir = dormirDeVerdad,
  } = opciones;
  let motivo = "sin respuesta";
  let intentos = 0;
  for (let n = 0; n <= reintentos; n++) {
    if (n > 0) {
      const espera = Math.min(esperaMs, limite - ahora());
      if (espera <= 0) throw new SinTiempo();
      await dormir(espera);
    }
    const restante = limite - ahora();
    if (restante <= 0) throw new SinTiempo();
    intentos++;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(tiempoMs, restante))), headers: { "user-agent": "check-banderas" } });
      if (res.ok) return await res.text();
      motivo = `el sitio contestó ${res.status}`;
    } catch (e) {
      motivo = e && (e.name === "TimeoutError" || e.name === "AbortError") ? "no terminó de bajar a tiempo" : "sin respuesta";
    }
  }
  throw new Error(`${motivo}, en ${intentos} intentos`);
}

/** Corre `trabajo` sobre cada elemento, con a lo sumo `cuantos` a la vez. Devuelve los resultados en el orden de la lista. */
async function enParalelo(lista, cuantos, trabajo) {
  const resultados = new Array(lista.length);
  let siguiente = 0;
  const obrero = async () => {
    while (siguiente < lista.length) {
      const i = siguiente++;
      resultados[i] = await trabajo(lista[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(cuantos, lista.length) }, obrero));
  return resultados;
}

/** La ruta de un archivo sin su dirección completa ni sus parámetros: es lo que se nombra en un informe. */
export function rutaCorta(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url).slice(0, 80);
  }
}

/**
 * Baja la portada y sus archivos de código y devuelve las copias del objeto de variables que encuentra.
 * `bajar(url)` devuelve el texto de una dirección o lanza un error (el guion le pasa `bajarConReintentos`).
 * Se bajan varios a la vez y todos los que nombra la portada se miran. Solo si ninguno trae el objeto
 * se siguen los enlaces relativos que nombran, por rondas, hasta `maxArchivos`.
 *
 * Nada se saltea en silencio: cada archivo que no bajó queda en `noBajaron` con su ruta y su motivo, y
 * `sinTiempo` dice si la lectura paró porque venció `limite`. La portada que no baja lanza el error.
 * Devuelve `{ copias, archivos, noBajaron, sinTiempo }`, con `archivos` los que sí bajaron.
 */
export async function leerDelSitio({ base, bajar, maxArchivos = 250, simultaneos = SIMULTANEOS, limite = Infinity, ahora = Date.now }) {
  const html = await bajar(`${base}/`);
  let ronda = archivosDeLaPortada(html).map((ref) => new URL(ref, `${base}/`).href);
  if (!ronda.length) throw new Error("la portada no nombra ningún archivo de código");
  const vistos = new Set();
  const copias = [];
  const noBajaron = [];
  let archivos = 0;
  let sinTiempo = false;
  while (ronda.length && vistos.size < maxArchivos && !sinTiempo) {
    const lote = [];
    for (const url of ronda) {
      if (vistos.has(url) || vistos.size >= maxArchivos) continue;
      vistos.add(url);
      lote.push(url);
    }
    const hechos = await enParalelo(lote, simultaneos, async (url) => {
      if (ahora() >= limite) return { url, motivo: "no hubo tiempo para pedirlo", tope: true };
      try {
        return { url, codigo: await bajar(url) };
      } catch (e) {
        return { url, motivo: e instanceof Error ? e.message : "sin respuesta", tope: Boolean(e && e.sinTiempo) };
      }
    });
    const siguientes = [];
    for (const h of hechos) {
      if (h.motivo !== undefined) {
        noBajaron.push({ ruta: rutaCorta(h.url), motivo: h.motivo });
        if (h.tope) sinTiempo = true;
        continue;
      }
      archivos++;
      const v = sacarVariables(h.codigo);
      if (v) copias.push(v);
      else for (const rel of referenciasRelativas(h.codigo)) siguientes.push(new URL(rel, h.url).href);
    }
    ronda = copias.length ? [] : siguientes;
  }
  return { copias, archivos, noBajaron, sinTiempo };
}

/** Los archivos que no bajaron, dichos en una frase: hasta cinco nombres y cuántos más. Vacía si todos bajaron. */
export function describirNoBajaron(noBajaron, nombres = 5) {
  if (!noBajaron.length) return "";
  const lista = noBajaron.slice(0, nombres).map((f) => f.ruta).join(", ");
  const mas = noBajaron.length > nombres ? ` y ${noBajaron.length - nombres} más` : "";
  const cuantos = noBajaron.length === 1 ? "no bajó 1 archivo de código" : `no bajaron ${noBajaron.length} archivos de código`;
  return `${cuantos} (${lista}${mas}), último motivo: ${noBajaron[noBajaron.length - 1].motivo}`;
}

const valorTexto = (v) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v)).slice(0, 40);

/** Cómo se nombra, en un informe, el valor que trae el sitio: nunca el de una reservada ni uno desconocido. */
function mostrar(variable, valor) {
  if (valor === "") return "vacía";
  if (RESERVADAS.has(variable) || !VALORES_QUE_SE_ESCRIBEN.has(valor)) return "otro valor";
  return valor;
}

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
    const reservada = RESERVADAS.has(f.variable);
    let ok = true;
    let estado;
    if (f.produccion === SIN_DEFINIR) {
      const prendida = /^(pistas )?prendidas?\b/i.test(f.sinLaVariable);
      estado = escrita ? "definida en el sitio" : prendida ? `sin definir, así que está prendida por defecto (${f.sinLaVariable})` : `sin definir, ${f.sinLaVariable}`;
      if (escrita) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice '${SIN_DEFINIR}' y el sitio la trae definida`);
      }
    } else if (f.produccion === DEFINIDA || reservada) {
      estado = escrita && valor !== "" ? "definida" : escrita ? "vacía" : "sin definir";
      if (!escrita || valor === "") {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice '${DEFINIDA}' y el sitio la trae ${escrita ? "vacía" : "sin definir"}`);
      } else if (f.produccion !== DEFINIDA) {
        // Una reservada con un valor escrito en la tabla: se rechaza la fila sin comparar ni mostrar ningún valor.
        ok = false;
        fallas.push(`${f.variable}: es una variable reservada y su fila debe decir '${DEFINIDA}', no un valor`);
      }
    } else {
      estado = escrita ? `vale ${mostrar(f.variable, valor)}` : "sin definir";
      if (!escrita) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice que vale ${f.produccion} y el sitio no la trae`);
      } else if (valor !== f.produccion) {
        ok = false;
        fallas.push(`${f.variable}: la tabla dice que vale ${f.produccion} y el sitio trae ${mostrar(f.variable, valor)}`);
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
