import { esc } from "../dom";
import { getLang, onLangChange, t, T } from "../i18n";
import { ganadoresPedidos } from "./ganadores";

/**
 * "¿Qué sorteás?", con opciones.
 *
 * Quien organiza un evento rara vez sortea algo raro: una polera, un libro, una
 * entrada. Escribirlo cada vez, con el teclado del celular y frente a la sala,
 * era lo que más se repetía. Ahora arriba del cuadro hay botones con lo que
 * más se sortea, y primero los últimos premios que esta persona usó; tocar uno
 * lo pone en el cuadro, y el cuadro sigue ahí para escribir el que sea.
 *
 * El cuadro (`#prize`) sigue siendo la única fuente de verdad: el sello, la
 * imagen y las bases lo leen de ahí, como siempre. Los botones solo lo escriben
 * y reflejan lo que dice.
 *
 * La lógica que decide qué se muestra y qué se marca está aparte y sin DOM
 * (las funciones de arriba), para probarla.
 */

/** Cuántos de los últimos premios se recuerdan y se ofrecen. */
export const MAX_RECIENTES = 4;

/** Un premio como texto de comparación: sin mayúsculas, sin espacios de más. */
const clave = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

/** Un premio como se guarda: sin espacios de más. */
const limpio = (s: string): string => s.normalize("NFKC").trim().replace(/\s+/g, " ");

/**
 * Suma un premio a los recientes: primero, sin repetir (aunque cambie la
 * mayúscula) y sin pasar del máximo. Uno vacío no cambia nada.
 */
export function agregarReciente(lista: readonly string[], nuevo: string, max = MAX_RECIENTES): string[] {
  const premio = limpio(nuevo);
  if (!premio) return lista.slice(0, max);
  return [premio, ...lista.filter((p) => clave(p) !== clave(premio))].slice(0, max);
}

export interface Opcion {
  texto: string;
  /** Lo usó esta persona antes (va primero, marcado). */
  reciente: boolean;
}

/**
 * Lo que se ofrece: primero los recientes, después los sugeridos, sin repetir
 * ninguno. Si un reciente coincide con un sugerido queda una sola vez, como
 * reciente: lo que más se usa sube.
 */
export function opciones(sugeridos: readonly string[], recientes: readonly string[]): Opcion[] {
  const vistos = new Set<string>();
  const out: Opcion[] = [];
  for (const [lista, reciente] of [[recientes, true], [sugeridos, false]] as const) {
    for (const crudo of lista) {
      const texto = limpio(crudo);
      const k = clave(texto);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      out.push({ texto, reciente });
    }
  }
  return out;
}

/** El cuadro dice exactamente este premio (sin importar mayúsculas ni espacios de más). */
export const esElegido = (valor: string, texto: string): boolean => clave(valor) !== "" && clave(valor) === clave(texto);

/** Tocar un premio lo pone en el cuadro; tocarlo otra vez lo saca. */
export const alternar = (valor: string, texto: string): string => (esElegido(valor, texto) ? "" : texto);

/** Lo que el cuadro tiene que decir al elegir: el premio, tal cual, cortado al largo que admite. */
export const recortar = (texto: string, largoMax = 60): string => Array.from(texto).slice(0, largoMax).join("");

/* --------------------------------------------------------- un premio por lugar */

/**
 * Con más de un ganador hay un campo por lugar: el cuadro `#prize` es el del 1.er premio y los demás se arman acá
 * (`actualizarLugares`). Al sellar, los campos se arman en un solo texto para `meta` (`armarMeta`), con un formato
 * que el sitio sabe leer de vuelta (`lugaresDeMeta`): un `meta` que no lo siga se muestra tal cual, así los sorteos
 * de antes se ven igual. Todo el texto es el que ya lee el resultado, la pantalla grande, el comprobante y la
 * verificación: cada lugar va con su rótulo adentro.
 */

/** El largo que admite el texto del sello (`meta`), el mismo que recorta `intentoDeSello` (freeze.ts). */
export const MAX_META = 160;

/** Un lugar de los premios, como lo devuelve la lectura del texto armado. */
export interface LugarDePremio {
  /** El lugar, contando desde el 1: el 1.er premio, el 2.º premio y así. */
  lugar: number;
  /** Lo que se lleva, limpio de espacios de más. */
  premio: string;
}

/** El rótulo de un lugar, en el idioma dado: «1.er premio», «2.º premio» / «1st prize», «2nd prize». */
export const etiquetaDeLugar = (lugar: number, lang: "es" | "en"): string => T[lang].prizeLugar(lugar);

/** Cuántos caracteres tiene un texto contando por letras: un emoji vale una, no dos. */
const largoDe = (s: string): number => Array.from(s).length;

/** Un texto cortado a `max` letras sin partir una. */
const recortarA = (s: string, max: number): string => Array.from(s).slice(0, max).join("");

/**
 * Arma el texto que va al sello con el premio de cada lugar. Con un solo lugar con texto queda tal cual: es el sello
 * de siempre y un `meta` viejo no se distingue de uno nuevo con un solo premio. Con varios, cada uno con su rótulo
 * («1.er premio: Bici, 2.º premio: Termo»), dentro de los 160 caracteres que admite `meta`: el lugar que no entra
 * se queda fuera.
 */
export function armarMeta(lugares: readonly string[], lang: "es" | "en", max = MAX_META): string {
  const conTexto = lugares
    .map(limpio)
    .map((premio, i) => ({ lugar: i + 1, premio }))
    .filter((x) => x.premio !== "");
  if (conTexto.length === 0) return "";
  if (conTexto.length === 1) return recortarA(conTexto[0]?.premio ?? "", max);
  const partes: string[] = [];
  for (const { lugar, premio } of conTexto) {
    const parte = `${etiquetaDeLugar(lugar, lang)}: ${premio}`;
    // El que no entra no se corta a la mitad: se deja fuera, con su lugar completo.
    if (partes.length > 0 && largoDe([...partes, parte].join(", ")) > max) break;
    partes.push(parte);
  }
  return recortarA(partes.join(", "), max);
}

/**
 * El rótulo de un lugar en el texto del sello: el número, su marca y la palabra, con los dos puntos. La marca está
 * suelta (`\.?`) para reconocer «1.er premio» como «1er premio», y las dos palabras para leer lo sellado en
 * cualquiera de los dos idiomas.
 */
const ROTULO_DE_LUGAR = /(\d{1,3})\s*\.?\s*(?:er|º|ª|st|nd|rd|th)\s+(?:premio|prize)\s*:\s*/gi;

/**
 * Lee de vuelta el texto de lugares que armó `armarMeta`, con el premio de cada uno. Si el texto no sigue el formato
 * (un `meta` de antes, un premio escrito a mano) devuelve `null`: quien lo muestra lo deja tal cual.
 */
export function lugaresDeMeta(meta: string): LugarDePremio[] | null {
  const texto = meta;
  const rotulos = [...texto.matchAll(ROTULO_DE_LUGAR)];
  // Un solo rótulo no es el formato: lo armado con más de un lugar lleva por lo menos dos.
  if (rotulos.length < 2) return null;
  // Antes del primer rótulo no puede haber nada.
  if (texto.slice(0, rotulos[0]?.index ?? 0).trim() !== "") return null;
  const lugares: LugarDePremio[] = [];
  for (let i = 0; i < rotulos.length; i++) {
    const m = rotulos[i] as RegExpMatchArray;
    const desde = (m.index ?? 0) + (m[0] ?? "").length;
    const hasta = i + 1 < rotulos.length ? (rotulos[i + 1] as RegExpMatchArray).index ?? texto.length : texto.length;
    const crudo = texto.slice(desde, hasta).trim().replace(/\s+/g, " ");
    // La coma que separa de los lugares era del armado, no del premio. En el último no hay nada que separar.
    const premio = i + 1 < rotulos.length ? crudo.replace(/,\s*$/, "") : crudo;
    if (!premio) return null;
    lugares.push({ lugar: Number(m[1]), premio });
  }
  return lugares;
}


/* -------------------------------------------------------------- recuerdo */

const CLAVE = "tinkazo.premios";

function leerRecientes(): string[] {
  try {
    const crudo = localStorage.getItem(CLAVE);
    const lista = crudo ? (JSON.parse(crudo) as unknown) : [];
    return Array.isArray(lista) ? lista.filter((p): p is string => typeof p === "string").slice(0, MAX_RECIENTES) : [];
  } catch {
    // Sin almacenamiento o con datos rotos: simplemente no hay recientes.
    return [];
  }
}

function guardarRecientes(lista: string[]): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    /* que no se pueda recordar no frena el sorteo */
  }
}

/* ---------------------------------------------------------------- pantalla */

/** Los campos por lugar no se ofrecen en el modo Orden de turnos (lo pone `src/ui/turnos.ts`, que no se puede importar acá). */
let lugaresApagados = false;

/** El modo de turnos prende o apaga la oferta de campos por lugar: un orden no tiene premios. */
export const bloquearLugares = (si: boolean): void => {
  lugaresApagados = si;
};

const cajaLugares = (): HTMLElement | null => document.getElementById("prize-lugares");

/** Los campos por lugar que hay ahora, con lo que cada uno dice. */
const camposDeLugares = (): HTMLInputElement[] => [...(cajaLugares()?.querySelectorAll<HTMLInputElement>("input[data-lugar]") ?? [])];

/** Arma `cuantos - 1` campos por lugar, conservando lo que ya estaba escrito. */
function armarCampos(cuantos: number): void {
  const caja = cajaLugares();
  if (!caja) return;
  const campo = document.getElementById("prize");
  const valores = camposDeLugares().map((i) => i.value);
  caja.hidden = cuantos <= 1;
  if (caja.hidden) {
    caja.replaceChildren();
    return;
  }
  caja.replaceChildren(
    ...Array.from({ length: cuantos - 1 }, (_, i) => {
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 60;
      input.autocomplete = "off";
      input.dataset.lugar = String(i + 2);
      // En renglón, como el cuadro de arriba: cada lugar debajo del otro.
      input.style.display = "block";
      input.placeholder = t("prizeLugarPh");
      input.setAttribute("aria-label", etiquetaDeLugar(i + 2, getLang()));
      input.value = valores[i] ?? "";
      input.disabled = campo instanceof HTMLInputElement ? campo.disabled : false;
      return input;
    }),
  );
}

/**
 * Los campos por lugar que se ofrecen ahora: con más de un ganador y fuera del modo de turnos. Lo llaman el cambio
 * de la cantidad (`#nw`), el cambio de idioma y el modo de turnos.
 */
export function actualizarLugares(): void {
  armarCampos(lugaresApagados ? 1 : ganadoresPedidos());
}

/** El premio de cada lugar tal como está en los campos: el cuadro de siempre es el del 1.er. */
export const premiosDeLosCampos = (): string[] => {
  const campo = document.getElementById("prize");
  return [campo instanceof HTMLInputElement ? campo.value : "", ...camposDeLugares().map((i) => i.value)];
};

/** El premio que se sella: los lugares armados en un solo texto; con el campo único queda tal cual. */
export const premioActual = (): string => armarMeta(premiosDeLosCampos(), getLang());

/** Los premios que ya salieron en esta sentada: se marcan para no repetir sin querer. */
let salieron: string[] = [];
let montado = false;

/** Dónde está el cuadro y los botones, o null si la página no los tiene (no es la herramienta). */
function partes(): { campo: HTMLInputElement; caja: HTMLElement } | null {
  const campo = document.getElementById("prize");
  const caja = document.getElementById("prize-chips");
  return campo instanceof HTMLInputElement && caja ? { campo, caja } : null;
}

const sugeridos = (): string[] => {
  const v = T[getLang()].prizeSugeridos;
  return Array.isArray(v) ? v : [];
};

/** Arma los botones: los recientes y los sugeridos, marcando el elegido y los que ya salieron. */
function pintar(): void {
  const p = partes();
  if (!p) return;
  const { campo, caja } = p;
  const usados = new Set(salieron.map(clave));
  caja.innerHTML = opciones(sugeridos(), leerRecientes())
    .map((o) => {
      const ya = usados.has(clave(o.texto));
      const texto = esc(o.texto);
      const clases = [o.reciente ? "reciente" : "", ya ? "salio" : ""].filter(Boolean).join(" ");
      const aviso = [o.reciente ? t("prizeRecent") : "", ya ? t("prizeUsed") : ""].filter(Boolean).join(", ");
      return (
        `<button type="button" class="${clases}" data-premio="${texto}" aria-pressed="${esElegido(campo.value, o.texto)}"` +
        `${aviso ? ` title="${aviso}"` : ""}${campo.disabled ? " disabled" : ""}>` +
        `${o.reciente ? '<span aria-hidden="true">↺ </span>' : ""}${ya ? '<span aria-hidden="true">✓ </span>' : ""}${texto}` +
        `${ya ? `<span class="sr-only"> (${t("prizeUsed")})</span>` : ""}</button>`
      );
    })
    .join("");
}

/** Pone lo que dice el cuadro en los botones: cuál está elegido, y si se pueden tocar. */
export function sincronizarPremios(): void {
  const p = partes();
  if (!p) return;
  for (const b of p.caja.querySelectorAll<HTMLButtonElement>("button[data-premio]")) {
    b.setAttribute("aria-pressed", String(esElegido(p.campo.value, b.dataset.premio ?? "")));
    b.disabled = p.campo.disabled;
  }
}

/**
 * Escribe el premio en el cuadro (el sello, la imagen y las bases lo leen de ahí) y refleja el cambio. Un texto
 * armado por lugares vuelve a sus campos: el 1.er al cuadro de siempre y los demás a los suyos, aunque la cantidad
 * de ganadores de ahora no los ofrezca (se restauro un sorteo ya sellado).
 */
export function ponerPremio(valor: string): void {
  const p = partes();
  if (!p) return;
  const lugares = lugaresDeMeta(valor);
  if (lugares && lugares.length > 1) {
    armarCampos(Math.max(lugaresApagados ? 1 : ganadoresPedidos(), lugares.length));
    p.campo.value = recortar(lugares[0]?.premio ?? "");
    const caja = cajaLugares();
    for (const { lugar, premio } of lugares.slice(1)) {
      const input = caja?.querySelector<HTMLInputElement>(`input[data-lugar="${lugar}"]`);
      if (input) input.value = recortar(premio);
    }
  } else {
    actualizarLugares();
    p.campo.value = recortar(valor);
  }
  sincronizarPremios();
  // Sin `input`, que es del teclado: lo escuchan el resumen de "Sellar la lista" y la barra, que lo muestran.
  p.campo.dispatchEvent(new CustomEvent("tinkazo:premio"));
}

/**
 * Anota un premio como usado en un sello: la próxima vez es uno de los últimos.
 * Se llama solo con sorteos de verdad, no con la demo.
 */
export function recordarPremio(premio: string): void {
  if (!limpio(premio)) return;
  guardarRecientes(agregarReciente(leerRecientes(), premio));
  pintar();
}

/** Un premio ya salió en esta sentada: queda marcado "ya salió" hasta recargar o empezar de nuevo. */
export function marcarSalio(premio: string): void {
  if (!limpio(premio) || salieron.some((p) => clave(p) === clave(premio))) return;
  salieron = [...salieron, limpio(premio)];
  pintar();
}

/** Empieza de nuevo (otra lista, otro evento): ninguno está marcado. */
export function olvidarSalieron(): void {
  if (!salieron.length) return;
  salieron = [];
  pintar();
}

/** Los botones de la herramienta: se arman, se tocan, y se vuelven a armar al cambiar de idioma. */
export function montarPremios(): void {
  const p = partes();
  if (!p || montado) return;
  montado = true;
  p.caja.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-premio]");
    if (!b || p.campo.disabled) return;
    ponerPremio(alternar(p.campo.value, b.dataset.premio ?? ""));
  });
  p.campo.addEventListener("input", sincronizarPremios);
  // Con más de un ganador, un campo por lugar: sigue la cantidad y, al cambiar de idioma, los rótulos.
  document.getElementById("nw")?.addEventListener("change", actualizarLugares);
  document.getElementById("nw")?.addEventListener("input", actualizarLugares);
  onLangChange(() => {
    pintar();
    actualizarLugares();
  });
  actualizarLugares();
  pintar();
}

/** Para las pruebas: vuelve al estado de recién cargada la página. */
export function reiniciarPremios(): void {
  salieron = [];
  montado = false;
}

