/**
 * Las partes puras de `scripts/capturar-vistas.mjs`: validar la lista de vistas,
 * armar la dirección de cada una y generar los nombres de prueba.
 *
 * La lista llega de afuera (una variable de entorno, un archivo, el dato de una
 * corrida de GitHub), así que se trata como lo que es: datos. Nada de lo que trae
 * se ejecuta como código. Cada vista y cada paso tiene una forma fija, se rechaza
 * lo que sobra o falta, y todo tiene un tope. Si algo no cumple, se devuelve la
 * lista completa de problemas antes de abrir ningún navegador.
 */

export const TOPES = {
  vistas: 40,
  pasos: 30,
  anchoMin: 280,
  anchoMax: 2560,
  altoMin: 280,
  altoMax: 2560,
  pausaMaxMs: 60_000,
  nombres: 2000,
  largoRuta: 600,
  largoSelector: 200,
  largoTexto: 2000,
  largoNombre: 64,
  /** Lo que una vista puede esperar en total entre pausas y esperas declaradas. */
  totalMs: 240_000,
  /** Cuánto puede durar el guion entero: el trabajo de GitHub corta a los 40 minutos y tiene que quedar el informe. */
  scriptMs: 35 * 60_000,
  /** Con menos que esto de tiempo total, una vista nueva ya no se empieza. */
  vistaMinimaMs: 10_000,
  /** Lo que declara un clicHasta: el tiempo que insiste antes de rendirse (ver `CLIC_HASTA` en vistas-pagina.mjs). */
  clicHastaMs: 20_000,
  variables: 20,
  largoValor: 200,
  largoRama: 200,
};

export const DEFECTOS = { ancho: 1440, alto: 900, pausaMs: 500, esperarMs: 30_000 };

export const ACCIONES = ["clic", "clicHasta", "escribir", "nombres", "esperar", "pausa", "tecla", "desplazar"];

/** Las teclas que se pueden apretar: nombre, código y código virtual de Chrome, y el texto que escriben. */
export const TECLAS = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Escape: { code: "Escape", vk: 27 },
  Tab: { code: "Tab", vk: 9 },
  Backspace: { code: "Backspace", vk: 8 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  PageUp: { code: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", vk: 34 },
};

/** Los nombres que Windows no deja usar como archivo, tengan o no extensión: quien baje el artefacto allá no podría abrirlo. */
const NOMBRE_RESERVADO = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

const CAMPOS_VISTA = ["nombre", "ruta", "ancho", "alto", "tema", "idioma", "esperar", "pausaMs", "paginaEntera", "pasos"];
const CAMPOS_PASO = {
  clic: ["selector"],
  clicHasta: ["selector", "hasta"],
  escribir: ["selector", "texto"],
  nombres: ["selector", "cantidad"],
  esperar: ["selector", "ms"],
  pausa: ["ms"],
  tecla: ["tecla"],
  desplazar: ["selector"],
};

const esObjeto = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const esEntero = (x) => typeof x === "number" && Number.isInteger(x);
const hayControl = (s) => /[\u0000-\u001f\u007f]/.test(s);

/**
 * Qué hacer con la vista que viene, dado lo que ya gastó el guion: si se hace, cuánto puede durar
 * (el plazo de una vista o lo que queda del tiempo total, lo que sea menor) y si el límite lo pone el total.
 */
export function plazoDeLaVista(gastadoMs, plazoVistaMs) {
  const restanteMs = TOPES.scriptMs - gastadoMs;
  if (restanteMs < TOPES.vistaMinimaMs) return { hacer: false, plazoMs: 0, porElTotal: true };
  const porElTotal = restanteMs < plazoVistaMs;
  return { hacer: true, plazoMs: porElTotal ? restanteMs : plazoVistaMs, porElTotal };
}

/** Una sola base para resolver rutas: si el resultado cambia de origen, la ruta se salía del sitio. */
const ORIGEN_FALSO = "http://sitio.invalid";

/** ¿La ruta es un camino del propio sitio? Devuelve el motivo si no. */
export function problemaDeRuta(ruta) {
  if (typeof ruta !== "string" || !ruta) return "tiene que ser un texto";
  if (ruta.length > TOPES.largoRuta) return `no puede pasar de ${TOPES.largoRuta} caracteres`;
  if (!ruta.startsWith("/")) return "tiene que empezar con /";
  if (ruta.startsWith("//") || ruta.startsWith("/\\")) return "no puede apuntar a otro sitio";
  if (/\s/.test(ruta) || hayControl(ruta) || ruta.includes("\\")) return "no puede llevar espacios, barras invertidas ni caracteres de control";
  let u;
  try {
    u = new URL(ruta, ORIGEN_FALSO);
  } catch {
    return "no es una dirección válida";
  }
  if (u.origin !== ORIGEN_FALSO) return "sale del sitio servido";
  return "";
}

function problemaDeSelector(valor) {
  if (typeof valor !== "string" || !valor.trim()) return "tiene que ser un selector CSS (un texto que no esté vacío)";
  if (valor.length > TOPES.largoSelector) return `no puede pasar de ${TOPES.largoSelector} caracteres`;
  if (hayControl(valor)) return "no puede llevar caracteres de control";
  return "";
}

function validarPaso(paso, donde, errores) {
  if (!esObjeto(paso)) {
    errores.push(`${donde}: tiene que ser un objeto con "accion"`);
    return null;
  }
  const accion = paso.accion;
  if (!ACCIONES.includes(accion)) {
    errores.push(`${donde}: "accion" tiene que ser una de ${ACCIONES.join(", ")} (llegó ${JSON.stringify(accion)})`);
    return null;
  }
  const permitidos = ["accion", ...CAMPOS_PASO[accion]];
  const sobran = Object.keys(paso).filter((k) => !permitidos.includes(k));
  if (sobran.length) errores.push(`${donde}: la acción ${accion} no lleva ${sobran.map((k) => `"${k}"`).join(", ")} (solo ${CAMPOS_PASO[accion].join(", ")})`);
  const n = errores.length;
  const salida = { accion };
  if (CAMPOS_PASO[accion].includes("selector")) {
    const p = problemaDeSelector(paso.selector);
    if (p) errores.push(`${donde}: "selector" ${p}`);
    else salida.selector = paso.selector;
  }
  if (accion === "clicHasta") {
    const p = problemaDeSelector(paso.hasta);
    if (p) errores.push(`${donde}: "hasta" ${p}`);
    else salida.hasta = paso.hasta;
  }
  if (accion === "escribir") {
    if (typeof paso.texto !== "string" || paso.texto.length > TOPES.largoTexto) errores.push(`${donde}: "texto" tiene que ser un texto de hasta ${TOPES.largoTexto} caracteres`);
    else salida.texto = paso.texto;
  }
  if (accion === "nombres") {
    if (!esEntero(paso.cantidad) || paso.cantidad < 1 || paso.cantidad > TOPES.nombres) errores.push(`${donde}: "cantidad" tiene que ser un entero entre 1 y ${TOPES.nombres}`);
    else salida.cantidad = paso.cantidad;
  }
  if (accion === "pausa") {
    if (!esEntero(paso.ms) || paso.ms < 0 || paso.ms > TOPES.pausaMaxMs) errores.push(`${donde}: "ms" tiene que ser un entero entre 0 y ${TOPES.pausaMaxMs}`);
    else salida.ms = paso.ms;
  }
  if (accion === "esperar") {
    if (paso.ms === undefined) salida.ms = DEFECTOS.esperarMs;
    else if (!esEntero(paso.ms) || paso.ms < 100 || paso.ms > TOPES.pausaMaxMs) errores.push(`${donde}: "ms" tiene que ser un entero entre 100 y ${TOPES.pausaMaxMs}`);
    else salida.ms = paso.ms;
  }
  if (accion === "tecla") {
    if (typeof paso.tecla !== "string" || !Object.hasOwn(TECLAS, paso.tecla)) errores.push(`${donde}: "tecla" tiene que ser una de ${Object.keys(TECLAS).join(", ")}`);
    else salida.tecla = paso.tecla;
  }
  return errores.length === n ? salida : null;
}

/**
 * Valida una lista de vistas ya leída como JSON. Devuelve `{ vistas, errores }`:
 * si `errores` no está vacío, `vistas` no se puede usar.
 */
export function validarVistas(lista) {
  const errores = [];
  if (!Array.isArray(lista)) return { vistas: [], errores: ["la lista de vistas tiene que ser un arreglo JSON de objetos"] };
  if (lista.length === 0) return { vistas: [], errores: ["la lista de vistas está vacía"] };
  if (lista.length > TOPES.vistas) return { vistas: [], errores: [`hay ${lista.length} vistas y el tope es ${TOPES.vistas}`] };
  const vistas = [];
  const vistos = new Set();
  lista.forEach((v, i) => {
    const etiqueta = esObjeto(v) && typeof v.nombre === "string" ? `vista ${i + 1} (${v.nombre.slice(0, 40)})` : `vista ${i + 1}`;
    if (!esObjeto(v)) {
      errores.push(`${etiqueta}: tiene que ser un objeto`);
      return;
    }
    const n = errores.length;
    const sobran = Object.keys(v).filter((k) => !CAMPOS_VISTA.includes(k));
    if (sobran.length) errores.push(`${etiqueta}: campos desconocidos ${sobran.map((k) => `"${k}"`).join(", ")} (los válidos son ${CAMPOS_VISTA.join(", ")})`);
    if (typeof v.nombre !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.nombre) || v.nombre.length > TOPES.largoNombre) {
      errores.push(`${etiqueta}: "nombre" tiene que llevar solo letras, números, punto, guion y guion bajo (hasta ${TOPES.largoNombre}) y empezar con letra o número`);
    } else if (NOMBRE_RESERVADO.test(v.nombre)) {
      errores.push(`${etiqueta}: "nombre" es un nombre reservado de Windows (con, prn, aux, nul, com1 a com9, lpt1 a lpt9, con o sin extensión): el archivo no se podría crear`);
    } else if (v.nombre.endsWith(".")) {
      errores.push(`${etiqueta}: "nombre" no puede terminar en punto (Windows lo descarta al crear el archivo)`);
    } else if (/-fallo$/i.test(v.nombre)) {
      errores.push(`${etiqueta}: "nombre" no puede terminar en -FALLO (queda para la foto de una vista que falla)`);
    } else if (vistos.has(v.nombre.toLowerCase())) {
      errores.push(`${etiqueta}: el nombre se repite (saldría la misma imagen)`);
    } else vistos.add(v.nombre.toLowerCase());
    const pr = problemaDeRuta(v.ruta);
    if (pr) errores.push(`${etiqueta}: "ruta" ${pr}`);
    const ancho = v.ancho === undefined ? DEFECTOS.ancho : v.ancho;
    const alto = v.alto === undefined ? DEFECTOS.alto : v.alto;
    if (!esEntero(ancho) || ancho < TOPES.anchoMin || ancho > TOPES.anchoMax) errores.push(`${etiqueta}: "ancho" tiene que ser un entero entre ${TOPES.anchoMin} y ${TOPES.anchoMax}`);
    if (!esEntero(alto) || alto < TOPES.altoMin || alto > TOPES.altoMax) errores.push(`${etiqueta}: "alto" tiene que ser un entero entre ${TOPES.altoMin} y ${TOPES.altoMax}`);
    if (v.tema !== undefined && v.tema !== "light" && v.tema !== "dark") errores.push(`${etiqueta}: "tema" tiene que ser "light" o "dark"`);
    if (v.idioma !== undefined && v.idioma !== "es" && v.idioma !== "en") errores.push(`${etiqueta}: "idioma" tiene que ser "es" o "en"`);
    if (v.esperar !== undefined) {
      const p = problemaDeSelector(v.esperar);
      if (p) errores.push(`${etiqueta}: "esperar" ${p}`);
    }
    const pausaMs = v.pausaMs === undefined ? DEFECTOS.pausaMs : v.pausaMs;
    if (!esEntero(pausaMs) || pausaMs < 0 || pausaMs > TOPES.pausaMaxMs) errores.push(`${etiqueta}: "pausaMs" tiene que ser un entero entre 0 y ${TOPES.pausaMaxMs}`);
    if (v.paginaEntera !== undefined && typeof v.paginaEntera !== "boolean") errores.push(`${etiqueta}: "paginaEntera" tiene que ser true o false`);
    const pasos = [];
    if (v.pasos !== undefined) {
      if (!Array.isArray(v.pasos)) errores.push(`${etiqueta}: "pasos" tiene que ser una lista`);
      else if (v.pasos.length > TOPES.pasos) errores.push(`${etiqueta}: tiene ${v.pasos.length} pasos y el tope es ${TOPES.pasos}`);
      else {
        v.pasos.forEach((p, j) => {
          const ok = validarPaso(p, `${etiqueta}, paso ${j + 1}`, errores);
          if (ok) pasos.push(ok);
        });
      }
    }
    if (errores.length > n) return;
    const total = pausaMs + (v.esperar === undefined ? 0 : DEFECTOS.esperarMs) + pasos.reduce((s, p) => s + (p.ms ?? (p.accion === "clicHasta" ? TOPES.clicHastaMs : 0)), 0);
    if (total > TOPES.totalMs) {
      errores.push(`${etiqueta}: entre pausas y esperas declara hasta ${Math.round(total / 1000)} s y el tope es ${TOPES.totalMs / 1000} s`);
      return;
    }
    vistas.push({
      nombre: v.nombre,
      ruta: v.ruta,
      ancho,
      alto,
      tema: v.tema ?? null,
      idioma: v.idioma ?? null,
      esperar: v.esperar ?? null,
      pausaMs,
      paginaEntera: v.paginaEntera === true,
      pasos,
    });
  });
  return { vistas: errores.length ? [] : vistas, errores };
}

/** Lee la lista desde un texto JSON y la valida. */
export function leerVistas(texto) {
  if (typeof texto !== "string" || !texto.trim()) return { vistas: [], errores: ["no llegó ninguna lista de vistas (VISTAS_JSON vacía)"] };
  let lista;
  try {
    lista = JSON.parse(texto);
  } catch (e) {
    return { vistas: [], errores: [`la lista de vistas no es un JSON válido: ${String(e.message).slice(0, 160)}`] };
  }
  return validarVistas(lista);
}

/**
 * La dirección completa de una vista: la base, la ruta y, si la vista los pide,
 * `?theme=` y `?lang=` (que el sitio ya entiende). Lo que traiga la ruta se conserva.
 */
export function direccionDeVista(vista, base) {
  const u = new URL(vista.ruta, ORIGEN_FALSO);
  if (vista.tema) u.searchParams.set("theme", vista.tema);
  if (vista.idioma) u.searchParams.set("lang", vista.idioma);
  return `${String(base).replace(/\/+$/, "")}${u.pathname}${u.search}${u.hash}`;
}

/** La base tiene que ser una dirección http o https. Devuelve el motivo si no. */
export function problemaDeBase(base) {
  try {
    const u = new URL(base);
    return u.protocol === "http:" || u.protocol === "https:" ? "" : "tiene que ser http o https";
  } catch {
    return "no es una dirección válida";
  }
}

/** Las variables de construcción: `VITE_X=1 VITE_Y=a.b`, separadas por espacios. */
export function leerEntorno(texto) {
  const errores = [];
  const pares = [];
  const partes = String(texto ?? "").split(/\s+/).filter(Boolean);
  if (partes.length > TOPES.variables) return { pares: [], errores: [`hay ${partes.length} variables y el tope es ${TOPES.variables}`] };
  const vistas = new Set();
  for (const parte of partes) {
    const i = parte.indexOf("=");
    if (i < 1) {
      errores.push(`entorno: "${parte.slice(0, 60)}" tiene que ser NOMBRE=valor`);
      continue;
    }
    const nombre = parte.slice(0, i);
    const valor = parte.slice(i + 1);
    if (!/^VITE_[A-Z0-9_]+$/.test(nombre)) errores.push(`entorno: el nombre "${nombre.slice(0, 60)}" tiene que empezar con VITE_ y llevar solo mayúsculas, números y guion bajo`);
    else if (vistas.has(nombre)) errores.push(`entorno: ${nombre} está repetido`);
    else if (valor.length > TOPES.largoValor || !/^[A-Za-z0-9_.:/-]*$/.test(valor)) errores.push(`entorno: el valor de ${nombre} solo puede llevar letras, números y los signos _ . : / - (hasta ${TOPES.largoValor})`);
    else {
      vistas.add(nombre);
      pares.push([nombre, valor]);
    }
  }
  return { pares: errores.length ? [] : pares, errores };
}

/** La rama o el commit a construir. Vacío vale (la misma de la corrida). Devuelve el motivo si no sirve. */
export function problemaDeRama(rama) {
  const r = String(rama ?? "");
  if (!r) return "";
  if (r.length > TOPES.largoRama) return `la rama no puede pasar de ${TOPES.largoRama} caracteres`;
  if (!/^[A-Za-z0-9._/-]+$/.test(r) || r.startsWith("-") || r.includes("..")) return "la rama solo puede llevar letras, números y los signos _ . / - (sin empezar con guion ni llevar dos puntos seguidos)";
  return "";
}

/** Un generador chico y repetible: la misma semilla da siempre los mismos números. */
function mulberry32(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INICIOS = ["ku", "mi", "ra", "to", "vel", "dan", "pi", "zo", "lu", "ne", "sar", "quen", "tay", "bru", "fo", "chi", "gal", "pen", "yo", "xa", "tri", "ven", "cor", "jul", "hai", "wen", "kor", "dru"];
const MEDIOS = ["ba", "ri", "mo", "ta", "lu", "ne", "so", "ki", "de", "va", "pu", "ge", "ma", "ro", "ti", "ñu", "cha", "llo"];
const FINALES = ["", "n", "s", "r", "l", "ta", "ro", "ni", "ya", "ño", "lis", "mar", "bel", "dor", "quén", "sé", "tín", "ña", "ría", "ález", "ó"];

function palabra(azar, silabas) {
  let s = INICIOS[Math.floor(azar() * INICIOS.length)];
  for (let i = 1; i < silabas; i++) s += MEDIOS[Math.floor(azar() * MEDIOS.length)];
  s += FINALES[Math.floor(azar() * FINALES.length)];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `cantidad` nombres inventados, sin repetirse, para llenar una lista de prueba. Son
 * sílabas armadas al azar (con una semilla fija: salen siempre los mismos), de uno a
 * tres renglones de palabras y de unos 4 a 36 caracteres, con algún acento y alguna ñ.
 * No se parecen a nadie a propósito: nada de nombres de personas reales.
 */
export function generarNombres(cantidad, semilla = 7) {
  const azar = mulberry32(semilla);
  const salida = [];
  const vistos = new Set();
  let intentos = 0;
  while (salida.length < cantidad && intentos < cantidad * 50 + 100) {
    intentos++;
    const palabras = 1 + Math.floor(azar() * 3);
    const largo = azar() < 0.1;
    const nombre = Array.from({ length: palabras }, (_, k) => palabra(azar, largo ? 3 + Math.floor(azar() * 2) : 1 + Math.floor(azar() * 2 + (k === 0 ? 0 : -0.5)))).join(" ");
    const recortado = nombre.length > 36 ? nombre.slice(0, 36).trimEnd() : nombre;
    if (recortado.length < 3 || vistos.has(recortado)) continue;
    vistos.add(recortado);
    salida.push(recortado);
  }
  return salida;
}
