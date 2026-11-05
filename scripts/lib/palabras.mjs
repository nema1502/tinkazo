/**
 * Las piezas del auditor de palabras (`scripts/audit-palabras.mjs`): qué texto
 * hay en el repo, de qué juego o pantalla es, y qué palabras no puede decir.
 *
 * Dos grupos, con su lista en `palabras-prohibidas.json`:
 *  - `apuesta`: lo que huele a casino. Aplica a todo texto visible.
 *  - `vocabulario`: reglas por alcance (juegos de quedar de pie, ensayo y
 *    stand, todo lo visible, el show y las tarjetas).
 *
 * Nada acá abre un navegador ni toca la red. `recolectar(raiz)` lee archivos;
 * el resto recibe texto y devuelve hallazgos, para probarlo sin el repo.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { literalesDe, textosDeHtml } from "./glosario.mjs";

/** El juego al que pertenece un archivo de `src/` (por su ruta). Lo que no cae en ninguno es `comun`. */
export const ARCHIVOS_DE_JUEGO = {
  race: /^src\/games\/(?:llamas\/|race\.ts)/,
  sapo: /^src\/games\/pixi\/sapo/,
  trompo: /^src\/games\/pixi\/trompo/,
  chovena: /^src\/games\/pixi\/chovena/,
  pinata: /^src\/games\/pixi\/pinata/,
  wheel: /^src\/games\/(?:pixi\/wheel|wheel)/,
  teleferico: /^src\/games\/(?:pixi\/)?cablecar/,
  oruro: /^src\/games\/pixi\/(?:oruro|entrada|papel-picado)/,
  quien: /^src\/games\/pixi\/quien/,
  trueque: /^src\/games\/pixi\/trueque/,
  guajojo: /^src\/games\/pixi\/guajojo/,
  toborochi: /^src\/games\/pixi\/toborochi/,
  tombola: /^src\/games\/(?:pixi\/)?tombola/,
  pasanaku: /^src\/games\/(?:pixi\/)?pasanaku/,
  stellar: /^src\/games\/(?:pixi\/)?constellation/,
  luz: /^src\/games\/pixi\/luz/,
  ledger: /^src\/games\/(?:pixi\/)?ledger/,
  autos: /^src\/games\/pixi\/autos/,
};

/** El juego al que pertenece una clave de `src/i18n.ts` (por su nombre). */
export const CLAVES_DE_JUEGO = {
  race: /^(?:gameRace|jgRace|gameCarrera|jgCarrera|pel[A-Z]|lore(?:Soroban|Llama))/,
  sapo: /^(?:gameSapo|jgSapo|sapo[A-Z])/,
  trompo: /^(?:gameTrompo|jgTro[A-Z]|trompo[A-Z])/,
  chovena: /^(?:gameCho|jgCho[A-Z]|chovena[A-Z])/,
  pinata: /^(?:gamePinata|jgPin[A-Z]|pinata[A-Z])/,
  wheel: /^(?:gameWheel|jgWheel|jgRule|rule[A-Z]|wheel[A-Z])/,
  teleferico: /^(?:gameTeleferico|jgTel[A-Z]|tele[A-Z])/,
  oruro: /^(?:gameOruro|jgOru[A-Z]|oruro[A-Z])/,
  quien: /^(?:gameQuien|jgQuien|quien[A-Z])/,
  trueque: /^(?:gameTrueque|jgTrueque|tr[A-Z])/,
  guajojo: /^(?:gameGuajojo|jgGuajojo|guajojo[A-Z])/,
  toborochi: /^(?:gameToborochi|jgToborochi|toborochi[A-Z])/,
  tombola: /^(?:gameTombola|jgTom[A-Z]|tombola[A-Z])/,
  pasanaku: /^(?:gamePasanaku|jgPas[A-Z])/,
  stellar: /^(?:gameStellar|jgStellar)/,
  luz: /^(?:gameLuz|jgLuz[A-Z])/,
  ledger: /^(?:gameLedger|jgLedger)/,
  autos: /^(?:gameAutos|jgAutos|gcAutos|loreAutos)/,
};

/** Los juegos donde nadie «sale»: se queda de pie quien aguanta. */
export const DE_PIE = ["guajojo", "toborochi", "pinata", "sapo", "quien", "trueque"];

/** Dónde empieza el diccionario en inglés de `src/i18n.ts` y dónde termina. */
const INICIO_EN = "  en: {";
const FIN_DICCIONARIOS = "export function t(";

export const juegoDeArchivo = (ruta) => Object.entries(ARCHIVOS_DE_JUEGO).find(([, re]) => re.test(ruta))?.[0] ?? null;
export const juegoDeClave = (clave) => Object.entries(CLAVES_DE_JUEGO).find(([, re]) => re.test(clave))?.[0] ?? null;

/** Las claves del ensayo y del stand, y los archivos de su pantalla. */
export const esClaveDeEnsayoOStand = (clave) => /^(?:stand|ens)[A-Z]|^ensayo[A-Z]/.test(clave);
export const esArchivoDeEnsayoOStand = (ruta) => /^src\/(?:ui\/)?(?:stand|ensayo)[\w-]*\.ts$/.test(ruta);

/** Sin tildes ni mayúsculas, con el mismo largo que el original (para ubicar el fragmento). */
export function llano(s) {
  let out = "";
  for (const ch of s) {
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += (base[0] ?? ch).toLowerCase() + base.slice(1).replace(/./gs, "");
  }
  return out;
}

/** Quita las partes de un literal que no son lo que se lee: marcadores de plantilla y espacios. */
const limpio = (t) => t.replace(/\s+/g, " ").trim();

/** ¿Es un identificador o una ruta y no una frase? (`"source-out"`, `"es"`, `"#g-race"`). No se lee. */
export const esIdentificador = (t) => /^[a-z0-9_.:#/\-@[\]=%]+$/.test(t);

/** Cada patrón de la lista, con bordes de palabra, sin tildes ni mayúsculas. */
export function compilarLista(patrones) {
  return patrones.map((p) => ({
    patron: p,
    re: new RegExp(`(?<![\\p{L}\\p{N}_])(?:${llano(p)})(?![\\p{L}\\p{N}_])`, "gu"),
  }));
}

/** Las palabras de una lista que aparecen en un texto, con su fragmento alrededor. */
export function buscarEn(texto, compiladas) {
  const t = llano(texto);
  const out = [];
  for (const c of compiladas) {
    c.re.lastIndex = 0;
    for (const m of t.matchAll(c.re)) {
      const ini = Math.max(0, (m.index ?? 0) - 28);
      out.push({
        palabra: texto.slice(m.index ?? 0, (m.index ?? 0) + m[0].length),
        patron: c.patron,
        fragmento: limpio(texto.slice(ini, (m.index ?? 0) + m[0].length + 28)),
      });
    }
  }
  return out;
}

/**
 * Las reglas listas para usar: cada una con su grupo, su alcance y sus patrones
 * compilados por idioma: «dice» es una palabra común en español y «dice» (dados) en inglés una prohibida.
 */
export function reglasDe(datos) {
  const reglas = [
    {
      id: "apuesta",
      grupo: "apuesta",
      alcance: "todo",
      motivo: datos.apuesta.motivo,
      es: compilarLista(datos.apuesta.es),
      en: compilarLista(datos.apuesta.en),
    },
  ];
  for (const r of datos.vocabulario.reglas) {
    reglas.push({ id: r.id, grupo: "vocabulario", alcance: r.alcance, motivo: r.motivo, es: compilarLista(r.es ?? []), en: compilarLista(r.en ?? []) });
  }
  return reglas;
}

/**
 * ¿Cae este texto en el alcance de la regla?
 *  - `todo`: todo lo visible.
 *  - `de-pie`: cadenas de los juegos de quedar de pie.
 *  - `ensayo-stand`: cadenas del ensayo y del stand.
 *  - `relator`: cadenas dentro del código de los juegos (no las descripciones de la página de juegos), que también se leen en una ronda de stand.
 *  - `show`: cadenas de los juegos y tarjetas que se ven (no las técnicas).
 */
export function enAlcance(alcance, t) {
  switch (alcance) {
    case "todo":
      return true;
    case "de-pie":
      return DE_PIE.includes(t.juego ?? "");
    case "ensayo-stand":
      return t.ensayoStand === true;
    case "relator":
      return t.archivo.startsWith("src/games/") && !t.tecnico;
    case "show":
      return !t.tecnico && ((t.juego !== null && t.juego !== undefined) || t.tarjeta === true);
    default:
      throw new Error(`alcance desconocido: ${alcance}`);
  }
}

/** ¿La excepción cubre este hallazgo? `archivo` puede terminar en `*`. */
export function cubre(exc, h) {
  const arch = exc.archivo.endsWith("*") ? h.archivo.startsWith(exc.archivo.slice(0, -1)) : h.archivo === exc.archivo;
  if (!arch) return false;
  if (exc.regla && exc.regla !== h.regla) return false;
  if (exc.grupo && exc.grupo !== h.grupo) return false;
  if (exc.palabra && llano(exc.palabra) !== llano(h.palabra)) return false;
  if (exc.clave && exc.clave !== h.clave) return false;
  if (exc.juego && exc.juego !== h.juego) return false;
  if (exc.contiene && !llano(h.texto).includes(llano(exc.contiene))) return false;
  return true;
}

/**
 * Pasa los hallazgos por las excepciones. Devuelve los que siguen fallando, los
 * que una excepción deja pasar (con su motivo), y las excepciones que no
 * cubrieron nada (una lista que no se limpia deja de servir).
 */
export function aplicarExcepciones(hallazgos, excepciones) {
  const usadas = new Set();
  const fallan = [];
  const cubiertos = [];
  for (const h of hallazgos) {
    const i = excepciones.findIndex((e) => cubre(e, h));
    if (i < 0) fallan.push(h);
    else {
      usadas.add(i);
      cubiertos.push({ ...h, excepcion: excepciones[i] });
    }
  }
  const sinUso = excepciones.filter((_, i) => !usadas.has(i));
  return { fallan, cubiertos, sinUso };
}

/** Todos los hallazgos de una lista de textos contra las reglas. */
export function hallazgosDe(textos, reglas) {
  const out = [];
  for (const t of textos) {
    for (const r of reglas) {
      if (!enAlcance(r.alcance, t)) continue;
      for (const f of buscarEn(t.texto, r[t.idioma === "en" ? "en" : "es"])) {
        out.push({ archivo: t.archivo, clave: t.clave, linea: t.linea, juego: t.juego ?? "sitio", grupo: r.grupo, regla: r.id, ...f, texto: t.texto });
      }
    }
  }
  return out;
}

// ---- Recorrer el repo ----

const claveAntesDe = (fuente, desde) => {
  const ventana = fuente.slice(Math.max(0, desde - 600), desde);
  let clave = "";
  for (const m of ventana.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) clave = m[1];
  return clave;
};

/** Los archivos `.ts` de una carpeta, sin pruebas, con rutas relativas a `raiz` y con `/`. */
function archivosTs(raiz, carpeta) {
  const out = [];
  const visita = (dir) => {
    for (const nombre of readdirSync(dir).sort()) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) visita(ruta);
      else if (/\.ts$/.test(nombre) && !/\.(test|d)\.ts$/.test(nombre)) out.push(relative(raiz, ruta).split(sep).join("/"));
    }
  };
  if (existsSync(join(raiz, carpeta))) visita(join(raiz, carpeta));
  return out;
}

/** Las claves de `lore.ts` cuya tarjeta habla de la tecnología (`tecnica: true`): no salen en el show. */
export function clavesTecnicas(fuenteLore) {
  const out = new Set();
  const tarjetas = fuenteLore.split(/\n\s*\{\s*\n/).slice(1);
  for (const bloque of tarjetas) {
    const fin = bloque.indexOf("\n    },");
    const cuerpo = fin > 0 ? bloque.slice(0, fin) : bloque;
    if (!/tecnica:\s*true/.test(cuerpo)) continue;
    const q = cuerpo.match(/\bq:\s*"([^"]+)"/)?.[1];
    const a = cuerpo.match(/\ba:\s*"([^"]+)"/)?.[1];
    if (q) out.add(q);
    if (a) out.add(a);
  }
  return out;
}

/** El idioma de un texto suelto: por marcas del español; sin ellas, inglés. */
export function adivinarIdioma(t) {
  return /[¡¿áéíóúñÁÉÍÓÚÑ]|\b(?:el|la|los|las|de|del|que|y|en|un|una|con|para|por|se|tu|vos|sin)\b/i.test(t) ? "es" : "en";
}

/** El idioma de un literal de código por el bloque `es: {` o `en: {` más cercano antes de él; si no hay, se adivina. */
function idiomaDeBloque(fuente, desde, texto) {
  const ventana = fuente.slice(Math.max(0, desde - 4000), desde);
  let ultimo = "";
  for (const m of ventana.matchAll(/\b(es|en)\s*:\s*\{/g)) ultimo = m[1];
  return ultimo || adivinarIdioma(texto);
}

const textoValido = (t) => t.trim().length >= 1 && !esIdentificador(t.trim());

/**
 * Todos los textos que se leen, con su origen:
 * `{archivo, clave, linea, texto, juego, tarjeta, tecnico, ensayoStand}`.
 */
export function recolectar(raiz) {
  const textos = [];
  const empuja = (t) => textoValido(t.texto) && textos.push({ juego: null, tarjeta: false, tecnico: false, ensayoStand: false, clave: "", ...t });

  // 1. El diccionario del sitio, en los dos idiomas.
  const i18n = join(raiz, "src", "i18n.ts");
  if (existsSync(i18n)) {
    const src = readFileSync(i18n, "utf8");
    const tecnicas = existsSync(join(raiz, "src", "games", "lore.ts")) ? clavesTecnicas(readFileSync(join(raiz, "src", "games", "lore.ts"), "utf8")) : new Set();
    const ini = src.indexOf("export const T:");
    const fin = src.indexOf(FIN_DICCIONARIOS);
    for (const lit of literalesDe(src)) {
      if (lit.desde < ini || (fin > 0 && lit.desde > fin)) continue;
      const clave = claveAntesDe(src, lit.desde);
      const enIngles = lit.desde > src.indexOf(INICIO_EN);
      const juego = juegoDeClave(clave);
      empuja({
        archivo: "src/i18n.ts",
        idioma: enIngles ? "en" : "es",
        clave,
        linea: lit.linea,
        texto: lit.texto,
        juego,
        tarjeta: /^lore[A-Z]/.test(clave),
        tecnico: tecnicas.has(clave),
        ensayoStand: esClaveDeEnsayoOStand(clave),
      });
    }
  }

  // 2. Los textos dentro del código del juego y de las pantallas del ensayo y el stand.
  for (const ruta of [...archivosTs(raiz, "src/games"), ...archivosTs(raiz, "src/ui"), "src/ensayo-modo.ts", "src/stand-modo.ts"]) {
    if (!existsSync(join(raiz, ruta))) continue;
    if (ruta === "src/games/lore.ts") continue; // las claves; el texto está en i18n
    const juego = juegoDeArchivo(ruta);
    const esJuego = ruta.startsWith("src/games/");
    const src = readFileSync(join(raiz, ruta), "utf8");
    for (const lit of literalesDe(src)) {
      // El mensaje de un error de programación no lo lee nadie del público.
      if (/(?:Error|assert[A-Za-z]*|console\.[a-z]+)\(\s*$/.test(src.slice(Math.max(0, lit.desde - 40), lit.desde))) continue;
      empuja({
        archivo: ruta,
        idioma: idiomaDeBloque(src, lit.desde, lit.texto),
        clave: claveAntesDe(src, lit.desde),
        linea: lit.linea,
        texto: lit.texto,
        // Lo común de los juegos (cámara, nombres, andamiaje) cuenta como juego sin dueño: se mira con `todos`.
        juego: esJuego ? (juego ?? "comun") : null,
        ensayoStand: esArchivoDeEnsayoOStand(ruta),
      });
    }
  }

  // 3. Las páginas de lectura.
  for (const nombre of readdirSync(raiz).filter((f) => f.endsWith(".html")).sort()) {
    const html = readFileSync(join(raiz, nombre), "utf8");
    for (const t of textosDeHtml(html)) empuja({ archivo: nombre, idioma: adivinarIdioma(t.texto), clave: "", linea: t.linea, texto: t.texto });
  }
  return textos;
}

/** A qué unidad de revisión pertenece un texto: el id del juego, `comun` o `sitio`. */
export const unidadDe = (t) => t.juego ?? "sitio";
