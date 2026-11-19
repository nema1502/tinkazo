/**
 * Las piezas del control de escritura (`scripts/check-escritura.mjs`).
 *
 * La regla (docs/marca.md, "Cómo se escribe"): en lo que lee la persona no van
 * comillas angulares ni punto y coma, en español ni en inglés. Acá viven las
 * funciones que encuentran esos dos signos. Casi todas reciben texto y
 * devuelven hallazgos, sin tocar el disco, para probarlas sin tocar el
 * repositorio. La única que lee archivos es `revisarRaiz`.
 *
 * Qué mira: el diccionario del sitio y las demás cadenas de `src/**.ts`, el
 * texto visible de las páginas HTML (nodos, atributos que se leen, metas de
 * descripción y datos estructurados), el manifiesto y los textos descargables
 * de `public/marca`. Qué no: comentarios de código, pruebas, CSS, docs,
 * scripts, README y los textos de licencias de terceros.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Lo que ocupa el lugar de un `${…}` dentro de una plantilla. */
export const HUECO = "";

// ---------------------------------------------------------------------------
// Los dos signos
// ---------------------------------------------------------------------------

/** Las comillas angulares (dobles y simples), escritas o como entidad HTML. */
const ANGULARES = /[«»‹›]|&(?:laquo|raquo|lsaquo|rsaquo);|&#0*(?:171|187|8249|8250);|&#x0*(?:ab|bb|2039|203a);/giu;
/** El punto y coma y sus parecidos de otras escrituras (griego, árabe, ancho completo). */
const SIGNOS_PUNTO_Y_COMA = /[;;؛⁏﹔；]/gu;
const ENTIDAD = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/giu;
const ENTIDAD_DEL_PUNTO_Y_COMA = /^&(?:semi|#0*59|#x0*3b);$/iu;

/**
 * Las propiedades de CSS que se reconocen en un estilo en línea. Una oración como
 * "Ojo: listo; luego" no se confunde con un estilo porque "Ojo" no está acá.
 */
const PROPIEDADES_CSS = [
  "position", "top", "left", "right", "bottom", "inset(?:-[a-z]+)*", "z-index", "display", "visibility", "opacity", "content",
  "(?:min-|max-)?(?:width|height|inline-size|block-size)", "aspect-ratio", "box-sizing", "float", "clear", "zoom",
  "(?:margin|padding)(?:-[a-z]+)*", "border(?:-[a-z]+)*", "outline(?:-[a-z]+)*", "box-shadow", "text-shadow", "drop-shadow",
  "background(?:-[a-z]+)*", "color", "accent-color", "caret-color", "color-scheme", "fill(?:-[a-z]+)*", "stroke(?:-[a-z]+)*",
  "font(?:-[a-z]+)*", "line-height", "letter-spacing", "word-spacing", "text-[a-z]+(?:-[a-z]+)*", "white-space", "word-break", "overflow(?:-[a-z]+)*",
  "hyphens", "direction", "writing-mode", "vertical-align", "quotes", "tab-size", "columns", "column-[a-z]+",
  "flex(?:-[a-z]+)*", "grid(?:-[a-z]+)*", "gap", "row-gap", "order", "(?:justify|align|place)-(?:items|content|self)",
  "transform(?:-[a-z]+)*", "translate", "rotate", "scale", "perspective(?:-origin)?", "backface-visibility",
  "transition(?:-[a-z]+)*", "animation(?:-[a-z]+)*", "will-change", "filter", "backdrop-filter", "mix-blend-mode", "clip-path", "mask(?:-[a-z]+)*",
  "cursor", "pointer-events", "user-select", "touch-action", "resize", "appearance", "object-fit", "object-position",
  "list-style(?:-[a-z]+)*", "counter-(?:reset|increment)", "table-layout", "caption-side", "empty-cells", "scroll(?:-[a-z]+)+", "overscroll-behavior(?:-[a-z]+)*",
  "isolation", "contain", "inline-size", "scrollbar-[a-z]+", "forced-color-adjust",
].join("|");

const DECLARACION_CSS = new RegExp(
  String.raw`(?<![\p{L}\p{N}_-])(?:--[\p{L}\p{N}_-]+|${PROPIEDADES_CSS})\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|[^;"'<>{}\n])*;?`,
  "gu",
);
/** El punto y coma de un tipo de contenido o de una dirección de datos, que no se escribe para nadie. */
const PUNTO_Y_COMA_DE_PROTOCOLO = /;(?=\s*(?:charset\s*=|base64\b|utf-?8\b|q\s*=|boundary\s*=))|(?<=\bdata:[\w/+.-]*);/giu;
/** Señales de que una cadena es código y no una oración. */
const SENAL_DE_CODIGO = /=>|===|!==|&&|\|\||\b(?:for|while|if)\s*\(|\bfunction\s*[\w$]*\s*\(|\b(?:const|let|var)\s+[\p{L}\p{N}_$]+\s*[=:;]/u;

const blanquear = (m) => " ".repeat(m.length);

/**
 * Los hallazgos de un texto: cada comilla angular y cada punto y coma, con su
 * posición. `diccionario: true` es para textos que seguro son para personas
 * (el diccionario, una página): ahí cualquier punto y coma cuenta. Sin eso, el
 * texto es una cadena suelta de código y solo cuenta si parece una oración: al
 * menos dos palabras y nada que se lea como código.
 */
export function hallazgosEnTexto(texto, { diccionario = false } = {}) {
  const res = [];
  for (const m of texto.matchAll(ANGULARES)) res.push({ tipo: "comillas", indice: m.index ?? 0, encontrado: m[0] });

  const puntosYComas = [];
  let t = texto.replace(ENTIDAD, (e, idx) => {
    if (ENTIDAD_DEL_PUNTO_Y_COMA.test(e)) puntosYComas.push({ tipo: "puntoycoma", indice: idx, encontrado: e });
    return blanquear(e);
  });
  t = t.replace(DECLARACION_CSS, blanquear).replace(PUNTO_Y_COMA_DE_PROTOCOLO, " ");
  for (const m of t.matchAll(SIGNOS_PUNTO_Y_COMA)) puntosYComas.push({ tipo: "puntoycoma", indice: m.index ?? 0, encontrado: m[0] });

  if (puntosYComas.length) {
    const palabras = (t.match(/\p{L}{2,}/gu) ?? []).length;
    if (diccionario || (palabras >= 2 && !SENAL_DE_CODIGO.test(t))) res.push(...puntosYComas);
  }
  return res.sort((a, b) => a.indice - b.indice);
}

// ---------------------------------------------------------------------------
// Segmentos: un trozo de texto con la línea donde empieza
// ---------------------------------------------------------------------------

/** La línea de una posición dentro de un segmento (cuenta los saltos de línea del archivo, no los `\n` escritos). */
export function lineaDe(segmento, indice) {
  let n = 0;
  for (const s of segmento.saltos ?? []) if (s < indice) n++;
  return segmento.linea + n;
}

const indicesDeSaltos = (texto) => {
  const s = [];
  for (let i = texto.indexOf("\n"); i >= 0; i = texto.indexOf("\n", i + 1)) s.push(i);
  return s;
};

const inicioDeLineas = (fuente) => {
  const inicios = [0];
  for (let i = fuente.indexOf("\n"); i >= 0; i = fuente.indexOf("\n", i + 1)) inicios.push(i + 1);
  return inicios;
};

const lineaEnOffset = (inicios, offset) => {
  let a = 0;
  let b = inicios.length - 1;
  while (a < b) {
    const m = (a + b + 1) >> 1;
    if (inicios[m] <= offset) a = m;
    else b = m - 1;
  }
  return a + 1;
};

// ---------------------------------------------------------------------------
// Las cadenas de un archivo de código
// ---------------------------------------------------------------------------

/** Después de estas palabras, una barra abre una expresión regular y no es una división. */
const ANTES_DE_REGEX = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await", "instanceof"]);
const ANTES_DE_CONSOLA = /\bconsole\s*\.\s*(?:log|info|warn|error|debug|trace)\s*\(\s*$/;

/**
 * Las cadenas de un archivo TypeScript o JavaScript, ya interpretadas (un
 * `«` escrito cuenta como la comilla que se ve), sin comentarios y sin
 * expresiones regulares. De una plantilla entrega el texto con un `HUECO` en
 * cada `${…}`, y las cadenas de adentro de esos huecos, aparte. Cada una trae
 * la línea donde empieza, los saltos de línea de adentro (`saltos`) y si es
 * argumento de `console` (`enConsola`), que no lee nadie.
 */
export function literalesDeCodigo(fuente) {
  const n = fuente.length;
  const inicios = inicioDeLineas(fuente);
  const out = [];

  const antesDeConsola = (pos) => ANTES_DE_CONSOLA.test(fuente.slice(Math.max(0, pos - 40), pos));

  /** Un escape a partir de la barra en `i`: el texto que representa y cuánto ocupa. */
  function escape(i) {
    const c = fuente[i + 1];
    if (c === undefined) return { t: "", k: 1, salto: false };
    if (c === "\r" && fuente[i + 2] === "\n") return { t: "", k: 3, salto: true };
    if (c === "\n" || c === "\r" || c === " " || c === " ") return { t: "", k: 2, salto: true };
    const simples = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v" };
    if (c in simples) return { t: simples[c], k: 2, salto: false };
    if (c === "0" && !/[0-9]/.test(fuente[i + 2] ?? "")) return { t: "\0", k: 2, salto: false };
    if (c === "x" && /^[0-9a-fA-F]{2}$/.test(fuente.slice(i + 2, i + 4))) return { t: String.fromCharCode(parseInt(fuente.slice(i + 2, i + 4), 16)), k: 4, salto: false };
    if (c === "u") {
      if (fuente[i + 2] === "{") {
        const f = fuente.indexOf("}", i + 3);
        const hex = f > 0 ? fuente.slice(i + 3, f) : "";
        if (/^[0-9a-fA-F]{1,6}$/.test(hex) && parseInt(hex, 16) <= 0x10ffff) return { t: String.fromCodePoint(parseInt(hex, 16)), k: f - i + 1, salto: false };
      } else if (/^[0-9a-fA-F]{4}$/.test(fuente.slice(i + 2, i + 6))) {
        return { t: String.fromCharCode(parseInt(fuente.slice(i + 2, i + 6), 16)), k: 6, salto: false };
      }
    }
    return { t: c, k: 2, salto: false };
  }

  /** Una cadena entre comillas simples o dobles. Si no cierra en su línea, corta ahí. */
  function cadena(i, q) {
    const inicio = i;
    let txt = "";
    const saltos = [];
    i++;
    while (i < n && fuente[i] !== q && fuente[i] !== "\n") {
      if (fuente[i] === "\\") {
        const e = escape(i);
        if (e.salto) saltos.push(txt.length);
        txt += e.t;
        i += e.k;
      } else txt += fuente[i++];
    }
    const sinCerrar = fuente[i] !== q;
    if (!sinCerrar) i++;
    out.push({ texto: txt, linea: lineaEnOffset(inicios, inicio), saltos, enConsola: antesDeConsola(inicio), sinCerrar, inicio });
    return i;
  }

  /** Una plantilla con comillas invertidas. */
  function plantilla(i) {
    const inicio = i;
    let txt = "";
    const saltos = [];
    i++;
    while (i < n && fuente[i] !== "`") {
      const c = fuente[i];
      if (c === "\\") {
        const e = escape(i);
        if (e.salto) saltos.push(txt.length);
        txt += e.t;
        i += e.k;
      } else if (c === "$" && fuente[i + 1] === "{") {
        txt += HUECO;
        i = codigo(i + 2, true);
      } else {
        if (c === "\n") saltos.push(txt.length);
        if (c !== "\r") txt += c;
        i++;
      }
    }
    const sinCerrar = fuente[i] !== "`";
    if (!sinCerrar) i++;
    out.push({ texto: txt, linea: lineaEnOffset(inicios, inicio), saltos, enConsola: antesDeConsola(inicio), sinCerrar, inicio });
    return i;
  }

  /** Una expresión regular a partir de la barra en `i`: el índice después de ella, o -1 si no es una. */
  function regex(i) {
    let j = i + 1;
    let clase = false;
    while (j < n) {
      const c = fuente[j];
      if (c === "\n") return -1;
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (clase) {
        if (c === "]") clase = false;
      } else if (c === "[") clase = true;
      else if (c === "/") {
        j++;
        while (j < n && /[a-z]/i.test(fuente[j])) j++;
        return j;
      }
      j++;
    }
    return -1;
  }

  /** Recorre código desde `i`. Dentro de un `${…}` termina en su llave de cierre y devuelve el índice que sigue. */
  function codigo(i, dentroDeHueco) {
    let prof = 0;
    let valor = false; // el último elemento es un valor: una barra divide, no abre una regex
    let palabra = "";
    while (i < n) {
      const c = fuente[i];
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        i++;
      } else if (c === "/" && fuente[i + 1] === "/") {
        while (i < n && fuente[i] !== "\n") i++;
      } else if (c === "/" && fuente[i + 1] === "*") {
        const f = fuente.indexOf("*/", i + 2);
        i = f < 0 ? n : f + 2;
      } else if (c === '"' || c === "'") {
        i = cadena(i, c);
        valor = true;
        palabra = "";
      } else if (c === "`") {
        i = plantilla(i);
        valor = true;
        palabra = "";
      } else if (c === "/") {
        const f = !valor || ANTES_DE_REGEX.has(palabra) ? regex(i) : -1;
        if (f > 0) {
          i = f;
          valor = true;
        } else {
          i++;
          valor = false;
        }
        palabra = "";
      } else if (c === "{") {
        prof++;
        i++;
        valor = false;
        palabra = "";
      } else if (c === "}") {
        if (dentroDeHueco && prof === 0) return i + 1;
        prof = Math.max(0, prof - 1);
        i++;
        valor = true;
        palabra = "";
      } else if (c === ")" || c === "]") {
        i++;
        valor = true;
        palabra = "";
      } else {
        const m = /[\p{L}\p{N}_$]+/uy;
        m.lastIndex = i;
        const r = m.exec(fuente);
        if (r) {
          palabra = r[0];
          valor = !ANTES_DE_REGEX.has(palabra);
          i += palabra.length;
        } else {
          i++;
          valor = false;
          palabra = "";
        }
      }
    }
    return i;
  }

  codigo(0, false);
  return out.sort((a, b) => a.inicio - b.inicio);
}

// ---------------------------------------------------------------------------
// El texto de una página HTML o SVG
// ---------------------------------------------------------------------------

/** Atributos cuyo valor se lee o se escucha. */
const ATRIBUTOS_DE_TEXTO = new Set(["alt", "title", "aria-label", "aria-description", "aria-roledescription", "aria-valuetext", "aria-placeholder", "placeholder", "label"]);
/** Metas cuyo `content` es una frase que se muestra (buscadores, redes). Las demás (viewport, theme-color) no. */
const METAS_DE_TEXTO = new Set(["description", "og:title", "og:description", "og:image:alt", "og:site_name", "twitter:title", "twitter:description", "twitter:image:alt"]);

const segmento = (texto, linea, origen) => ({ texto, linea, saltos: indicesDeSaltos(texto), origen });

/** Las cadenas de un objeto de datos estructurados: sin las claves que empiezan con `@` ni las direcciones. */
function cadenasDeJson(valor, clave = "", out = []) {
  if (typeof valor === "string") {
    if (!clave.startsWith("@") && !/^https?:\/\//i.test(valor) && /\p{L}/u.test(valor)) out.push(valor);
  } else if (Array.isArray(valor)) {
    for (const v of valor) cadenasDeJson(v, clave, out);
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) cadenasDeJson(v, k, out);
  }
  return out;
}

/**
 * Lo que se lee de una página: el texto entre etiquetas, los atributos que se
 * muestran o se leen en voz alta, el `content` de las metas de descripción y
 * las frases de los datos estructurados (`application/ld+json`), que los
 * buscadores muestran. Sin scripts, estilos, comentarios ni CDATA.
 */
export function textosDeHtml(html) {
  const n = html.length;
  const inicios = inicioDeLineas(html);
  const linea = (o) => lineaEnOffset(inicios, o);
  const out = [];
  let i = 0;
  let desde = 0; // donde empieza el texto que falta entregar

  const volcar = (hasta) => {
    if (hasta > desde) {
      const t = html.slice(desde, hasta);
      if (/\S/.test(t)) out.push(segmento(t, linea(desde), "texto"));
    }
  };

  /** Una etiqueta de apertura desde el `<` en `lt`: su nombre, sus atributos y dónde termina. */
  const etiqueta = (lt) => {
    let j = lt + 1;
    let nombre = "";
    while (j < n && !/[\s/>]/.test(html[j])) nombre += html[j++];
    const attrs = [];
    while (j < n) {
      while (j < n && /\s/.test(html[j])) j++;
      if (html[j] === ">") return { nombre: nombre.toLowerCase(), attrs, fin: j + 1 };
      if (html[j] === "/") {
        j++;
        continue;
      }
      let nom = "";
      while (j < n && !/[\s=/>]/.test(html[j])) nom += html[j++];
      while (j < n && /\s/.test(html[j])) j++;
      let valor = "";
      let offset = j;
      if (html[j] === "=") {
        j++;
        while (j < n && /\s/.test(html[j])) j++;
        offset = j;
        if (html[j] === '"' || html[j] === "'") {
          const f = html.indexOf(html[j], j + 1);
          if (f < 0) return { nombre: nombre.toLowerCase(), attrs, fin: n };
          valor = html.slice(j + 1, f);
          offset = j + 1;
          j = f + 1;
        } else {
          while (j < n && !/[\s>]/.test(html[j])) valor += html[j++];
        }
      }
      if (nom) attrs.push({ nombre: nom.toLowerCase(), valor, offset });
    }
    return { nombre: nombre.toLowerCase(), attrs, fin: n };
  };

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    const c1 = html[lt + 1] ?? "";
    if (html.startsWith("<!--", lt)) {
      volcar(lt);
      const f = html.indexOf("-->", lt + 4);
      i = desde = f < 0 ? n : f + 3;
    } else if (html.startsWith("<![CDATA[", lt)) {
      volcar(lt);
      const f = html.indexOf("]]>", lt + 9);
      i = desde = f < 0 ? n : f + 3;
    } else if (c1 === "!" || c1 === "?" || c1 === "/") {
      volcar(lt);
      const f = html.indexOf(">", lt);
      i = desde = f < 0 ? n : f + 1;
    } else if (!/[a-zA-Z]/.test(c1)) {
      i = lt + 1; // un `<` suelto es parte del texto
    } else {
      volcar(lt);
      const e = etiqueta(lt);
      const attr = (nombre) => e.attrs.find((a) => a.nombre === nombre);
      for (const a of e.attrs) {
        if (ATRIBUTOS_DE_TEXTO.has(a.nombre) && a.valor.trim()) out.push(segmento(a.valor, linea(a.offset), `atributo ${a.nombre}`));
      }
      if (e.nombre === "meta") {
        const quien = (attr("name") ?? attr("property") ?? attr("itemprop"))?.valor.toLowerCase();
        const c = attr("content");
        if (quien && METAS_DE_TEXTO.has(quien) && c?.valor.trim()) out.push(segmento(c.valor, linea(c.offset), `meta ${quien}`));
      }
      i = desde = e.fin;
      if (e.nombre === "script" || e.nombre === "style") {
        const cierre = html.toLowerCase().indexOf(`</${e.nombre}`, e.fin);
        const fin = cierre < 0 ? n : cierre;
        if (e.nombre === "script" && /ld\+json/i.test(attr("type")?.valor ?? "")) {
          const contenido = html.slice(e.fin, fin);
          let datos = null;
          try {
            datos = JSON.parse(contenido);
          } catch {
            datos = null;
          }
          if (datos === null) out.push(segmento(contenido, linea(e.fin), "datos estructurados"));
          else {
            for (const cadena of cadenasDeJson(datos)) {
              const donde = contenido.indexOf(JSON.stringify(cadena).slice(1, -1));
              out.push(segmento(cadena, linea(e.fin + Math.max(0, donde)), "datos estructurados"));
            }
          }
        }
        const f = html.indexOf(">", fin);
        i = desde = f < 0 ? n : f + 1;
      }
    }
  }
  volcar(n);
  return out;
}

/** Los textos de un manifiesto de aplicación web: nombre, nombre corto y descripción, también en sus accesos. */
export function textosDeManifiesto(contenido) {
  let datos;
  try {
    datos = JSON.parse(contenido);
  } catch {
    return [];
  }
  const inicios = inicioDeLineas(contenido);
  const out = [];
  const tomar = (obj) => {
    for (const k of ["name", "short_name", "description"]) {
      if (typeof obj?.[k] !== "string" || !obj[k].trim()) continue;
      const donde = contenido.indexOf(JSON.stringify(obj[k]).slice(1, -1));
      out.push(segmento(obj[k], lineaEnOffset(inicios, Math.max(0, donde)), `manifiesto ${k}`));
    }
  };
  tomar(datos);
  for (const acceso of datos?.shortcuts ?? []) tomar(acceso);
  return out;
}

/** Un archivo de texto plano: cada renglón con algo es un segmento. */
export function textosDeTxt(contenido) {
  const out = [];
  contenido.split(/\r?\n/).forEach((texto, i) => {
    if (texto.trim()) out.push({ texto, linea: i + 1, saltos: [], origen: "texto" });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Qué archivos son diccionarios, y las exclusiones
// ---------------------------------------------------------------------------

/** Los módulos donde viven los textos que se pintan: el diccionario, los avisos, los relatos y respuestas de los juegos. */
export function esArchivoDeTextos(ruta) {
  return /(^|\/)(?:i18n[^/]*|[^/]*textos[^/]*|mensajes|respuestas[^/]*|guion|leyenda)\.ts$/.test(ruta);
}

/**
 * Separa los hallazgos que una exclusión cubre. Cada exclusión lleva `archivo`
 * (un archivo exacto, o una carpeta si termina en `/`), `contiene` (un trozo
 * del texto, opcional) y `porque`, que es obligatorio. Devuelve lo vigente, lo
 * excluido (con su porqué) y las exclusiones que no cubrieron nada.
 */
export function aplicarExclusiones(hallazgos, exclusiones) {
  for (const e of exclusiones) {
    if (!e.archivo || !String(e.porque ?? "").trim()) throw new Error(`Una exclusión sin porque (archivo: ${e.archivo ?? "?"}) no vale: cada una explica por qué no es un texto para personas.`);
  }
  const usadas = new Set();
  const vigentes = [];
  const excluidos = [];
  for (const h of hallazgos) {
    const i = exclusiones.findIndex(
      (e) => (h.archivo === e.archivo || (e.archivo.endsWith("/") && h.archivo.startsWith(e.archivo))) && (!e.contiene || String(h.texto ?? "").includes(e.contiene)),
    );
    if (i < 0) vigentes.push(h);
    else {
      usadas.add(i);
      excluidos.push({ ...h, porque: exclusiones[i].porque });
    }
  }
  return { vigentes, excluidos, sinUso: exclusiones.filter((_, i) => !usadas.has(i)) };
}

// ---------------------------------------------------------------------------
// Recorrer el repositorio
// ---------------------------------------------------------------------------

/** Carpetas que no se recorren: dependencias, lo construido y las ocultas (control de versiones, configuración local). */
const CARPETAS_QUE_NO = new Set(["node_modules", "dist", "target"]);

function archivosDe(dir, salida = []) {
  let nombres = [];
  try {
    nombres = readdirSync(dir).sort();
  } catch {
    return salida;
  }
  for (const nombre of nombres) {
    if (CARPETAS_QUE_NO.has(nombre) || nombre.startsWith(".")) continue;
    const p = join(dir, nombre);
    if (statSync(p).isDirectory()) archivosDe(p, salida);
    else salida.push(p);
  }
  return salida;
}

/** Los archivos que se miran y cómo se leen: `[{ archivo, segmentos, diccionario }]`. */
export function fuentesDe(raiz) {
  const rel = (p) => relative(raiz, p).replace(/\\/g, "/");
  const leer = (p) => readFileSync(p, "utf8");
  const fuentes = [];
  let todos = [];
  try {
    todos = readdirSync(raiz).sort();
  } catch {
    return fuentes;
  }
  for (const nombre of todos) {
    if (nombre.endsWith(".html") && statSync(join(raiz, nombre)).isFile()) {
      fuentes.push({ archivo: nombre, segmentos: textosDeHtml(leer(join(raiz, nombre))), diccionario: true });
    }
  }
  for (const p of archivosDe(join(raiz, "public"))) {
    const r = rel(p);
    if (/^public\/[^/]+\.html$/.test(r)) fuentes.push({ archivo: r, segmentos: textosDeHtml(leer(p)), diccionario: true });
    else if (r === "public/manifest.webmanifest") fuentes.push({ archivo: r, segmentos: textosDeManifiesto(leer(p)), diccionario: true });
    else if (r.startsWith("public/marca/") && r.endsWith(".txt")) fuentes.push({ archivo: r, segmentos: textosDeTxt(leer(p)), diccionario: true });
    else if (r.endsWith(".svg")) fuentes.push({ archivo: r, segmentos: textosDeHtml(leer(p)), diccionario: true });
  }
  for (const p of archivosDe(join(raiz, "src"))) {
    const r = rel(p);
    if (!r.endsWith(".ts") || r.endsWith(".test.ts") || r.endsWith(".d.ts")) continue;
    fuentes.push({ archivo: r, segmentos: literalesDeCodigo(leer(p)), diccionario: esArchivoDeTextos(r) });
  }
  return fuentes.filter((f) => f.segmentos.length);
}

/** Cuánto del texto de alrededor se muestra al lado de un hallazgo. */
const ANTES = 40;
const DESPUES = 50;

export function fragmentoDe(texto, indice, largo = 1) {
  const ini = Math.max(0, indice - ANTES);
  const fin = Math.min(texto.length, indice + largo + DESPUES);
  const medio = texto.slice(ini, fin).replace(/\s+/g, " ").replaceAll(HUECO, "${…}").trim();
  return `${ini > 0 ? "…" : ""}${medio}${fin < texto.length ? "…" : ""}`;
}

/**
 * Revisa el repositorio entero. Devuelve los hallazgos vigentes, los
 * excluidos con su porqué, las exclusiones sin uso, las cadenas de `console`
 * que se dejaron de mirar, las cadenas de código que no cierran (señal de que
 * el lector se perdió en ese archivo) y cuántos archivos se leyeron.
 */
export function revisarRaiz(raiz, { exclusiones = [] } = {}) {
  const fuentes = fuentesDe(raiz);
  const todos = [];
  let consola = 0;
  const sinCerrar = [];
  for (const f of fuentes) {
    for (const seg of f.segmentos) {
      if (seg.sinCerrar) sinCerrar.push({ archivo: f.archivo, linea: seg.linea });
      if (seg.enConsola) {
        consola++;
        continue;
      }
      for (const h of hallazgosEnTexto(seg.texto, { diccionario: f.diccionario })) {
        todos.push({
          archivo: f.archivo,
          linea: lineaDe(seg, h.indice),
          tipo: h.tipo,
          encontrado: h.encontrado,
          origen: seg.origen ?? "texto",
          texto: seg.texto,
          fragmento: fragmentoDe(seg.texto, h.indice, h.encontrado.length),
        });
      }
    }
  }
  const { vigentes, excluidos, sinUso } = aplicarExclusiones(todos, exclusiones);
  return { hallazgos: vigentes, excluidos, sinUso, consola, sinCerrar, archivos: fuentes.length };
}

/** Los hallazgos agrupados por archivo, con sus cuentas: `[{ archivo, comillas, puntoYComa, hallazgos }]`. */
export function agruparPorArchivo(hallazgos) {
  const mapa = new Map();
  for (const h of hallazgos) {
    if (!mapa.has(h.archivo)) mapa.set(h.archivo, { archivo: h.archivo, comillas: 0, puntoYComa: 0, hallazgos: [] });
    const g = mapa.get(h.archivo);
    if (h.tipo === "comillas") g.comillas++;
    else g.puntoYComa++;
    g.hallazgos.push(h);
  }
  return [...mapa.values()].sort((a, b) => a.archivo.localeCompare(b.archivo));
}
