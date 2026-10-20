export type Lang = "es" | "en";

/** Lo que una página puede mostrar, en un idioma: cadenas y, en la herramienta, funciones y variantes. */
export type Textos = Record<string, unknown>;

/**
 * El idioma, sin el diccionario.
 *
 * Elegir idioma, recordarlo y pintar los `data-i` no necesita las ~870 claves
 * de `i18n.ts`, que eran el 94 % del código común de cada página: las de
 * lectura y la de verificar bajaban la narración de doce juegos para mostrar
 * unos cuantos títulos. Ahora cada una trae en su HTML solo los textos que usa
 * (`<script id="textos">`, lo arma `vite.config.ts` al construir) y este
 * archivo los pinta. La herramienta registra el diccionario entero desde
 * `i18n.ts`, y ahí `T` y `t()` siguen igual.
 */

let dicts: Record<Lang, Textos> = { es: {}, en: {} };
let current: Lang = "es";
const listeners: Array<(l: Lang) => void> = [];

export const getLang = (): Lang => current;

/** El diccionario con que se pinta. `i18n.ts` registra el entero; una página, el suyo. */
export function usarTextos(d: Record<Lang, Textos>): void {
  dicts = d;
}

/** Los textos de la página en un idioma (por defecto, el de ahora). */
export const textos = (l: Lang = current): Textos => dicts[l];

/**
 * Los textos que vienen en el HTML de la página, en `<script type="application/json" id="textos">`.
 * Sin ese bloque la página queda con el texto del markup, en español.
 */
export function textosDeLaPagina(): void {
  const el = document.getElementById("textos");
  if (!el?.textContent) return;
  try {
    usarTextos(JSON.parse(el.textContent) as Record<Lang, Textos>);
  } catch {
    /* sin textos, el markup */
  }
}

/** Cadena del diccionario de la página. Si falta, la clave misma (y se avisa en desarrollo). */
export function texto(key: string): string {
  const v = dicts[current][key];
  if (typeof v === "string") return v;
  if (import.meta.env.DEV) console.warn(`[idioma] falta "${key}" en los textos de esta página`);
  return key;
}

/** Se ejecuta después de cada cambio de idioma (textos que no viven en `data-i`). */
export function onLangChange(fn: (l: Lang) => void): void {
  listeners.push(fn);
}

const LANG_KEY = "tinkazo.lang";

/**
 * El idioma con que arranca cualquier página: el de la URL (`?lang=`), si no
 * el que la persona eligió antes, y si no el del navegador. Antes "/" solo
 * miraba la URL y las páginas de lectura solo el navegador, así que quien
 * apretaba EN en la portada volvía al español al entrar a Juegos.
 */
export function initialLang(): Lang {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "es") return q;
  try {
    const s = localStorage.getItem(LANG_KEY);
    if (s === "en" || s === "es") return s;
  } catch {
    /* sin almacenamiento, el navegador decide */
  }
  return (navigator.language || "es").toLowerCase().startsWith("en") ? "en" : "es";
}

/** Lo que pasa al apretar ES o EN: se cambia y se recuerda para las otras páginas. */
export function chooseLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* se cambia igual, solo que no se recuerda */
  }
  setLang(l);
}

/**
 * El título y la descripción que una página de sorteo dice de sí misma en un
 * idioma. Su `<html>` pide las claves (`data-titulo-clave` y `data-desc-clave`)
 * y el diccionario las trae en los dos idiomas. Una página sin claves no dice
 * nada, y queda como está escrita.
 */
export function metasDePagina(dict: Textos, ds: DOMStringMap): { titulo?: string; desc?: string } {
  const titulo = ds.tituloClave ? dict[ds.tituloClave] : undefined;
  const desc = ds.descClave ? dict[ds.descClave] : undefined;
  return {
    ...(typeof titulo === "string" ? { titulo } : {}),
    ...(typeof desc === "string" ? { desc } : {}),
  };
}

/** Pone el `content` de una etiqueta `meta` si la página la trae. */
function fijarMeta(selector: string, valor: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute("content", valor);
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  document.getElementById("l-es")?.classList.toggle("on", l === "es");
  document.getElementById("l-en")?.classList.toggle("on", l === "en");
  const dict = dicts[l];
  // Las claves con variantes se saltan: el markup nunca las usa.
  document.querySelectorAll<HTMLElement>("[data-i]").forEach((el) => {
    const v = dict[el.dataset.i ?? ""];
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i-html]").forEach((el) => {
    const v = dict[el.dataset.iHtml ?? ""];
    if (typeof v === "string") el.innerHTML = v;
  });
  document.querySelectorAll<HTMLInputElement>("[data-i-ph]").forEach((el) => {
    const v = dict[el.dataset.iPh ?? ""];
    if (typeof v === "string") el.placeholder = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i-title]").forEach((el) => {
    const v = dict[el.dataset.iTitle ?? ""];
    if (typeof v === "string") el.title = v;
  });
  document.querySelectorAll<HTMLElement>("[data-i-aria]").forEach((el) => {
    const v = dict[el.dataset.iAria ?? ""];
    if (typeof v === "string") el.setAttribute("aria-label", v);
  });
  // Las páginas de sorteo dicen su título y su descripción en el idioma de la
  // página, y lo mismo en las etiquetas og: lo que se comparte sale en el
  // idioma que se lee.
  const { titulo, desc } = metasDePagina(dict, document.documentElement.dataset);
  if (titulo !== undefined) {
    document.title = titulo;
    fijarMeta('meta[property="og:title"]', titulo);
  }
  if (desc !== undefined) {
    fijarMeta('meta[name="description"]', desc);
    fijarMeta('meta[property="og:description"]', desc);
  }
  for (const fn of listeners) fn(l);
}
