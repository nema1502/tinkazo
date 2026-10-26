/**
 * El generador de juegos: la parte que se prueba. `scripts/nuevo-juego.mjs` es
 * solo la línea de comandos.
 *
 * Un juego nuevo en Tinkazo se tocaba a mano en unos veinte archivos (el
 * selector, la tarjeta, los diccionarios, los auditores, siete documentos). Con
 * el kit (`src/games/pixi/kit/`) quedan dos cosas: el juego, que escribe quien
 * lo inventa, y su entrada en el catálogo, que escribe esto. El juego nace
 * **apagado** (`selector: false`): abre con `?demo=<id>` y `?pose=<id>`, existe
 * en el selector como un botón oculto y pasa `audit-game`, pero nadie lo puede
 * elegir hasta que se enciende (`encender`).
 *
 * Todo se calcula antes de escribir nada: si algo falla, no queda a medias. Y se
 * escribe entre marcas (`>>> kit:<nombre>` … `<<< kit:<nombre>`), con un
 * encabezado por juego, así que dos corridas con el mismo id no duplican nada:
 * la segunda se rechaza.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FUERA_DEL_SELECTOR, SELECTOR } from "./juegos.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
/** Los archivos de partida, con `__ID__`, `__CAP__`, `__NOMBRE__` y `__NOMBRE_EN__` por rellenar. */
export const PLANTILLAS = join(AQUI, "..", "plantillas", "juego");
/** La raíz de este repositorio. */
export const RAIZ = join(AQUI, "..", "..");

const CATALOGO = "src/games/pixi/kit/catalogo.ts";
const I18N = "src/i18n.ts";

/** Ids que el sitio ya usa, estén o no en el selector. */
const RESERVADOS = new Set([...SELECTOR, ...FUERA_DEL_SELECTOR, "any", "todos", "kit", "base", "stellar"]);

const leer = (ruta) => readFileSync(ruta, "utf8");
/** Las plantillas se leen con saltos de línea de Unix, pase lo que pase con el checkout. */
const leerPlantilla = (nombre) => leer(join(PLANTILLAS, nombre)).replace(/\r\n/g, "\n");

export const capital = (id) => id.charAt(0).toUpperCase() + id.slice(1);

/** Lo que está mal con un id; vacío si sirve. Con `raiz`, mira también el catálogo y los archivos. */
export function problemasDeId(id, raiz) {
  if (!/^[a-z]{3,12}$/.test(String(id ?? ""))) return ["el id son de 3 a 12 letras minúsculas, sin tildes, números ni guiones"];
  const p = [];
  if (RESERVADOS.has(id)) p.push(`"${id}" ya es un juego del sitio`);
  if (raiz) {
    const cat = existsSync(join(raiz, CATALOGO)) ? leer(join(raiz, CATALOGO)) : "";
    if (new RegExp(`// --- ${id}\\r?\\n`).test(cat)) p.push(`"${id}" ya está en el catálogo del kit`);
    if (existsSync(join(raiz, `src/games/pixi/${id}.ts`))) p.push(`ya existe src/games/pixi/${id}.ts`);
  }
  return p;
}

export function variables(id, nombre, nombreEn) {
  const cap = capital(id);
  const es = (nombre ?? "").trim() || cap;
  return { id, cap, nombre: es, nombreEn: (nombreEn ?? "").trim() || es };
}

/** Rellena una plantilla con las variables de un juego. */
export function rellenar(texto, v) {
  return texto
    .replaceAll("__NOMBRE_EN__", v.nombreEn)
    .replaceAll("__NOMBRE__", v.nombre)
    .replaceAll("__CAP__", v.cap)
    .replaceAll("__ID__", v.id);
}

/** Los archivos que se crean, con la plantilla de la que salen. */
export function archivosDe(v) {
  return [
    { ruta: `src/games/pixi/${v.id}.ts`, plantilla: "escena.ts.tpl" },
    { ruta: `src/games/pixi/${v.id}-plan.ts`, plantilla: "plan.ts.tpl" },
    { ruta: `src/games/pixi/${v.id}-plan.test.ts`, plantilla: "plan.test.ts.tpl" },
    { ruta: `src/games/pixi/${v.id}-textos.ts`, plantilla: "textos.ts.tpl" },
    { ruta: `docs/juegos/${v.id}.md`, plantilla: "diseno.md.tpl" },
  ];
}

const lit = (s) => JSON.stringify(s);

/** Las claves del sitio para el juego, en un idioma: el botón, el nombre, la regla y una historia en borrador. */
export function bloqueI18n(v, idioma) {
  const es = idioma === "es";
  const nombre = es ? v.nombre : v.nombreEn;
  return [
    `// --- ${v.id}`,
    `game${v.cap}: ${lit(nombre)}, jg${v.cap}N: ${lit(nombre)},`,
    `jg${v.cap}B: ${lit(
      es
        ? `Borrador de ${nombre}: los nombres llegan a la mesa de a ocho y quedan los finalistas. El ganador ya salió del sorteo y el juego solo lo cuenta.`
        : `Draft of ${nombre}: names reach the table eight at a time and the finalists remain. The winner already came out of the draw and the game only tells it.`,
    )},`,
    `gc${v.cap}: ${lit(
      es
        ? "Los nombres llegan a la mesa de a ocho y quedan los finalistas. Gana quien salió del sorteo."
        : "Names reach the table eight at a time and the finalists remain. Whoever the draw picked wins.",
    )},`,
    `gc${v.cap}Many: ${lit(
      es ? "Los premios quedan en la mesa final: los que ganan se ven al final." : "The prizes sit at the final table: the winners show at the end.",
    )},`,
    `lore${v.cap}Q: ${lit(es ? `¿De dónde sale ${nombre}?` : `Where does ${nombre} come from?`)},`,
    `lore${v.cap}A: ${lit(
      es
        ? "Borrador: todavía no tiene su historia ni su fuente, y no sale en ningún sorteo hasta que se escriba."
        : "Draft: it has no story or source yet, and it does not show in any draw until one is written.",
    )},`,
    `// --- /${v.id}`,
  ];
}

/** La entrada del catálogo: apagada, para 2 a 200 personas y con la historia en borrador. */
export function bloqueCatalogo(v) {
  return [
    `// --- ${v.id}`,
    "{",
    `  id: "${v.id}",`,
    `  cargar: () => import("../${v.id}").then((m) => m.${v.id}Pixi),`,
    "  selector: false,",
    "  rango: { minimo: 2, maximo: 200 },",
    "  captura: false,",
    `  historia: { q: "lore${v.cap}Q", a: "lore${v.cap}A", href: "https://github.com/nema1502/tinkazo/blob/main/docs/juegos.md", src: "tinkazo · docs/juegos.md", hue: "teal", borrador: true },`,
    "},",
    `// --- /${v.id}`,
  ];
}

/**
 * Pone `lineas` justo antes de la marca de cierre, con la sangría de la marca y
 * los saltos de línea del archivo. Falla si faltan las marcas o si el juego ya
 * está entre ellas.
 */
export function insertarEntreMarcas(texto, marca, id, lineas) {
  const abre = `>>> kit:${marca}`;
  const cierra = `<<< kit:${marca}`;
  const i = texto.indexOf(abre);
  const f = i < 0 ? -1 : texto.indexOf(cierra, i);
  if (i < 0 || f < 0) throw new Error(`faltan las marcas "${abre}" y "${cierra}"`);
  if (new RegExp(`// --- ${id}\\r?\\n`).test(texto.slice(i, f))) throw new Error(`"${id}" ya está entre las marcas kit:${marca}`);
  const eol = texto.includes("\r\n") ? "\r\n" : "\n";
  const ini = texto.lastIndexOf("\n", f) + 1;
  const sangria = /^[ \t]*/.exec(texto.slice(ini))[0];
  return texto.slice(0, ini) + lineas.map((l) => sangria + l + eol).join("") + texto.slice(ini);
}

/** Qué sigue después de crear un juego, en orden. */
export function pasosSiguientes(v) {
  return [
    `Llená docs/juegos/${v.id}.md (el diseño en una página) y pedí el sí de quien mantiene el proyecto.`,
    `Escribí el plan en src/games/pixi/${v.id}-plan.ts: es puro y se prueba solo, con "pnpm vitest run src/games/pixi/${v.id}-plan.test.ts".`,
    `Dibujá la escena en src/games/pixi/${v.id}.ts y mirala con "pnpm dev": http://localhost:5173/?demo=${v.id}&instant=1 (sin animaciones) o ?demo=${v.id} (el show).`,
    `La batería: node scripts/audit-game.mjs ${v.id} --base http://localhost:4173 (20/20), y audit-rigor, audit-identidad, audit-emocion, audit-sound, audit-mezcla, audit-pantalla y audit-delatores.`,
    `La captura de la tarjeta: node scripts/capturas-juegos.mjs ${v.id} --en 6.5 (el segundo en que termina la presentación).`,
    `Cuando esté todo: node scripts/nuevo-juego.mjs --encender ${v.id}`,
  ];
}

/**
 * Crea el juego `id`: sus archivos y su entrada en el catálogo y en los dos
 * diccionarios. Con `dryRun` calcula todo y no escribe nada.
 */
export function aplicar({ raiz = RAIZ, id, nombre, nombreEn, dryRun = false }) {
  const problemas = problemasDeId(id, raiz);
  if (problemas.length) throw new Error(problemas.join("; "));
  const v = variables(id, nombre, nombreEn);
  const nuevos = archivosDe(v).map((a) => ({ ruta: a.ruta, texto: rellenar(leerPlantilla(a.plantilla), v) }));
  for (const a of nuevos) if (existsSync(join(raiz, a.ruta))) throw new Error(`ya existe ${a.ruta}`);
  // Todo se calcula antes de escribir: si falta una marca, no queda nada a medias.
  const catalogo = insertarEntreMarcas(leer(join(raiz, CATALOGO)), "catalogo", id, bloqueCatalogo(v));
  let i18n = insertarEntreMarcas(leer(join(raiz, I18N)), "i18n-es", id, bloqueI18n(v, "es"));
  i18n = insertarEntreMarcas(i18n, "i18n-en", id, bloqueI18n(v, "en"));
  const editados = [
    { ruta: CATALOGO, texto: catalogo },
    { ruta: I18N, texto: i18n },
  ];
  if (!dryRun) {
    for (const a of nuevos) {
      mkdirSync(dirname(join(raiz, a.ruta)), { recursive: true });
      writeFileSync(join(raiz, a.ruta), a.texto);
    }
    for (const a of editados) writeFileSync(join(raiz, a.ruta), a.texto);
  }
  return { id, creados: nuevos.map((a) => a.ruta), editados: editados.map((a) => a.ruta), siguientes: pasosSiguientes(v) };
}

/** ¿Hay una batería guardada de este juego en `docs/capturas/auditorias`? */
function hayBateria(raiz, id) {
  const dir = join(raiz, "docs/capturas/auditorias");
  if (!existsSync(dir)) return false;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .some((f) => new RegExp(`"objetivo"\\s*:\\s*"${id}"`).test(leer(join(dir, f))));
}

/**
 * Enciende el juego: lo pone en el selector. Solo con su captura, la historia
 * sin borrador, el rango y la batería guardada en JSON. Después quedan a mano
 * la ficha de `juegos.html` y la fila de `docs/juegos.md`.
 */
export function encender({ raiz = RAIZ, id, dryRun = false }) {
  if (!/^[a-z]{3,12}$/.test(String(id ?? ""))) throw new Error("el id son de 3 a 12 letras minúsculas");
  const cat = leer(join(raiz, CATALOGO));
  const m = new RegExp(`(// --- ${id}\\r?\\n)([\\s\\S]*?)(// --- /${id})`).exec(cat);
  if (!m) throw new Error(`"${id}" no está en el catálogo del kit`);
  const bloque = m[2];
  if (/selector:\s*true/.test(bloque)) throw new Error(`"${id}" ya está encendido`);
  const faltan = [];
  if (!existsSync(join(raiz, `public/juegos/${id}.webp`))) faltan.push(`falta la captura public/juegos/${id}.webp (node scripts/capturas-juegos.mjs ${id} --en 6.5)`);
  if (/borrador:\s*true/.test(bloque)) faltan.push("la historia sigue en borrador: escribila con una fuente primaria verificada y sacale borrador: true");
  if (!/rango:\s*\{[^}]*(?:maximo|minimo)/.test(bloque)) faltan.push("falta el rango de personas");
  if (!hayBateria(raiz, id)) faltan.push("falta la batería guardada en JSON en docs/capturas/auditorias (node scripts/audit-todo.mjs --json)");
  if (faltan.length) throw new Error(`todavía no se puede encender "${id}":\n  - ${faltan.join("\n  - ")}`);
  const nuevo = bloque.replace(/selector:\s*false/, "selector: true").replace(/captura:\s*false/, "captura: true");
  if (!dryRun) writeFileSync(join(raiz, CATALOGO), cat.replace(m[0], m[1] + nuevo + m[3]));
  return {
    id,
    siguientes: [
      `Sumá la ficha de ${id} en juegos.html (con la captura) y la fila de docs/juegos.md.`,
      "Corré pnpm check:paginas y pnpm check:lore, y pedí el ok de quien mantiene el proyecto antes de subirlo.",
    ],
  };
}
