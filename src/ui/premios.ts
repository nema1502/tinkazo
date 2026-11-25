import { esc } from "../dom";
import { getLang, onLangChange, t, T } from "../i18n";
import { fijoPorCampana, ganadoresPedidos } from "./ganadores";
import { lugaresDeMeta, pareceRotulo } from "./lugares-de-meta";
import { actualizarAvisoDePlata } from "./premio-plata";

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

/** Lo que admite el texto del sello (`meta`): 160 bytes de UTF-8, el `MAX_META_LEN` del contrato. */
export const MAX_META = 160;

/** Un lugar de los premios, como lo devuelve la lectura del texto armado. */
export type { LugarDePremio } from "./lugares-de-meta";

/** El rótulo de un lugar, en el idioma dado: «1.er premio», «2.º premio» / «1st prize», «2nd prize». */
export const etiquetaDeLugar = (lugar: number, lang: "es" | "en"): string => T[lang].prizeLugar(lugar);

/**
 * Cuánto pesa un texto en el sello: el contrato mide `meta` en bytes de UTF-8, no en letras. Una tilde, una eñe o la
 * marca de «2.º» pesan dos, y un emoji cuatro: 156 letras con tildes pueden pasar de 160 y el sello falla.
 */
const largoDe = (s: string): number => new TextEncoder().encode(s).length;

/** Un texto cortado para que pese `max` como mucho en el sello, sin partir una letra. */
function recortarA(s: string, max: number): string {
  let out = "";
  for (const letra of Array.from(s)) {
    if (largoDe(out + letra) > max) break;
    out += letra;
  }
  return out;
}

/** El texto armado para el sello y el primer lugar que se quedó fuera de él (`null` si entran todos). */
interface Armado {
  texto: string;
  fuera: number | null;
}

/**
 * El premio de un lugar como va al sello cuando hay varios: sin espacios de más y con sus signos como se escribieron
 * («Nº 5», «m²», «½»). Solo el que trae algo con forma de rótulo pasa además por NFKC, que cambia la «º» escrita a
 * mano por una «o»: así «Termo 3º premio: x» no se lee después como otro lugar.
 */
const premioDeVarios = (escrito: string): string => (pareceRotulo(escrito) ? limpio(escrito) : escrito.trim().replace(/\s+/g, " "));

/** Arma los lugares en un solo texto dentro de `max` y anota cuál no entró: lo comparten `armarMeta` y el aviso. */
function armar(lugares: readonly string[], lang: "es" | "en", max: number): Armado {
  const conTexto = lugares
    .map((escrito, i) => ({ lugar: i + 1, premio: premioDeVarios(escrito), escrito: escrito.trim() }))
    .filter((x) => x.premio !== "");
  const [primero] = conTexto;
  if (!primero) return { texto: "", fuera: null };
  // Un solo premio se sella como se escribió, solo sin los espacios de las puntas, igual que el campo único de antes:
  // sin pasar por `limpio`, que juntaba los espacios de adentro y cambiaba signos como el de «Nº 5» por «No 5».
  if (conTexto.length === 1) {
    return { texto: recortarA(primero.escrito, max), fuera: largoDe(primero.escrito) > max ? primero.lugar : null };
  }
  const partes: string[] = [];
  for (const { lugar, premio } of conTexto) {
    const parte = `${etiquetaDeLugar(lugar, lang)}: ${premio}`;
    // El que no entra no se corta a la mitad: se deja fuera, con su lugar completo, y queda anotado para avisar.
    if (partes.length > 0 && largoDe([...partes, parte].join(", ")) > max) {
      return { texto: recortarA(partes.join(", "), max), fuera: lugar };
    }
    partes.push(parte);
  }
  const texto = partes.join(", ");
  // Solo puede pasar si el 1.er lugar con texto no entra ni solo: se corta, y tampoco se sella.
  return { texto: recortarA(texto, max), fuera: largoDe(texto) > max ? primero.lugar : null };
}

/**
 * Arma el texto que va al sello con el premio de cada lugar. Con un solo lugar con texto queda tal cual: es el sello
 * de siempre y un `meta` viejo no se distingue de uno nuevo con un solo premio. Con varios, cada uno con su rótulo
 * («1.er premio: Bici, 2.º premio: Termo»), dentro de los 160 bytes que admite `meta`: el lugar que no entra se
 * queda fuera, y `primerLugarQueNoEntra` lo dice para que no se selle así.
 */
export function armarMeta(lugares: readonly string[], lang: "es" | "en", max = MAX_META): string {
  return armar(lugares, lang, max).texto;
}

/**
 * El primer lugar cuyo premio no entra en el texto del sello, contando desde el 1, o `null` si entran todos. Con un
 * lugar fuera no se sella (`freeze.ts`): se avisa debajo de los campos hasta que se acorte.
 */
export function primerLugarQueNoEntra(lugares: readonly string[], lang: "es" | "en", max = MAX_META): number | null {
  return armar(lugares, lang, max).fuera;
}

/**
 * La lectura de vuelta del texto armado (`lugaresDeMeta`) vive en `lugares-de-meta.ts`, sin página ni idioma, para que
 * el resultado, el pago y «No está» la lean aunque las pruebas reemplacen este módulo. Se exporta también desde acá.
 */
export { lugaresDeMeta };


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

/** El rótulo de un lugar a la vista, a la izquierda de su campo: no se va al escribir, como el texto de ayuda. */
function rotuloDeLugar(lugar: number): HTMLSpanElement {
  const rotulo = document.createElement("span");
  rotulo.className = "premio-lugar-n";
  // El campo ya lo dice con su nombre accesible: el lector de pantalla no lo lee dos veces.
  rotulo.setAttribute("aria-hidden", "true");
  rotulo.textContent = etiquetaDeLugar(lugar, getLang());
  return rotulo;
}

/**
 * El cuadro de siempre es el del 1.er premio cuando ganan varios y hay premio escrito en otro lugar: lleva su rótulo a
 * la vista (`#prize-n1`) y ese nombre. Con un solo ganador, o con los demás lugares vacíos, ni rótulo ni nombre de
 * lugar, como siempre: lo escrito ahí se lo llevan todos, y «1.er premio» decía que era solo del primero.
 */
function rotularElPrimero(): void {
  const caja = cajaLugares();
  const varios = !!caja && !caja.hidden && camposDeLugares().some((i) => i.value.trim() !== "");
  const rotulo = document.getElementById("prize-n1");
  if (rotulo) {
    rotulo.hidden = !varios;
    rotulo.textContent = varios ? etiquetaDeLugar(1, getLang()) : "";
  }
  const campo = document.getElementById("prize");
  if (!campo) return;
  if (varios) campo.setAttribute("aria-label", etiquetaDeLugar(1, getLang()));
  else campo.removeAttribute("aria-label");
}

/** Arma `cuantos - 1` campos por lugar, conservando lo que ya estaba escrito. */
function armarCampos(cuantos: number): void {
  const caja = cajaLugares();
  if (!caja) return;
  const campo = document.getElementById("prize");
  const valores = camposDeLugares().map((i) => i.value);
  caja.hidden = cuantos <= 1;
  if (caja.hidden) {
    caja.replaceChildren();
    pintarLargo();
    return;
  }
  caja.replaceChildren(
    ...Array.from({ length: cuantos - 1 }, (_, i) => {
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 60;
      input.autocomplete = "off";
      input.dataset.lugar = String(i + 2);
      input.placeholder = t("prizeLugarPh");
      input.setAttribute("aria-label", etiquetaDeLugar(i + 2, getLang()));
      input.value = valores[i] ?? "";
      input.disabled = campo instanceof HTMLInputElement ? campo.disabled : false;
      // Cada lugar en su renglón, con su rótulo a la izquierda, como el cuadro de arriba.
      const fila = document.createElement("div");
      fila.className = "premio-fila";
      fila.append(rotuloDeLugar(i + 2), input);
      return fila;
    }),
  );
  pintarLargo();
}

/**
 * Los campos por lugar que se ofrecen ahora: con más de un ganador y fuera del modo de turnos. Lo llaman el cambio
 * de la cantidad (`#nw`), el cambio de idioma y el modo de turnos.
 * Con la cantidad fija por una campaña de empresa tampoco: lo que se sella es el premio de la campaña, el que firmó
 * la sala, y un premio de otro lugar escrito antes se colaba en ese texto.
 */
export function actualizarLugares(): void {
  armarCampos(lugaresApagados || fijoPorCampana() ? 1 : ganadoresPedidos());
}

/** El premio de cada lugar tal como está en los campos: el cuadro de siempre es el del 1.er. */
export const premiosDeLosCampos = (): string[] => {
  const campo = document.getElementById("prize");
  return [campo instanceof HTMLInputElement ? campo.value : "", ...camposDeLugares().map((i) => i.value)];
};

/**
 * Vacía los campos de los lugares 2 en adelante. El cuadro de siempre (`#prize`, el 1.er premio) no se toca: lo
 * maneja quien llama, con `ponerPremio`. Sirve para que un sorteo nuevo no herede los premios del anterior.
 */
export function vaciarLugares(): void {
  for (const input of camposDeLugares()) input.value = "";
  pintarLargo();
}

/**
 * Vuelve a escribir en los campos de los lugares 2 en adelante lo que se guardó de ellos tal como estaba (el borrador de
 * la pestaña, el modo de turnos). Los campos siguen la cantidad de ganadores de ahora: lo que no tiene campo no se
 * escribe. Va aparte del texto que se sella para no perder el premio que no entraba ni mover uno de lugar.
 */
export function reponerLugares(valores: readonly unknown[]): void {
  actualizarLugares();
  camposDeLugares().forEach((input, i) => {
    const valor = valores[i];
    if (typeof valor === "string") input.value = recortar(valor);
  });
  pintarLargo();
}

/** El premio que se sella: los lugares armados en un solo texto; con el campo único queda tal cual. */
export const premioActual = (): string => armarMeta(premiosDeLosCampos(), getLang());

/** El primer lugar de los campos que no entra en lo que se sella, o `null` si entran todos. */
const lugarQueNoEntra = (): number | null => primerLugarQueNoEntra(premiosDeLosCampos(), getLang());

/** Lo escrito en los campos no entra entero en lo que se sella: Sellar la lista se frena (`freeze.ts`) hasta que se acorte. */
export const premiosNoEntran = (): boolean => lugarQueNoEntra() !== null;

/**
 * La línea de debajo de los campos (`#prize-largo`): dice que los premios no entran y que hay que acortar. La llaman
 * cada letra que se escribe, el cambio de la cantidad y del idioma (los rótulos cambian de largo) y `ponerPremio`.
 * De paso pone o saca el rótulo del cuadro de arriba, que depende de lo mismo: si hay premio en otro lugar.
 */
function pintarLargo(): void {
  rotularElPrimero();
  actualizarAvisoDePlata();
  const linea = document.getElementById("prize-largo");
  if (!linea) return;
  const fuera = lugarQueNoEntra();
  const noEntra = fuera !== null;
  const varios = premiosDeLosCampos().filter((p) => p.trim() !== "").length > 1;
  const texto = noEntra ? T[getLang()].prizeNoEntran(varios) : "";
  if (linea.textContent !== texto) linea.textContent = texto;
  linea.hidden = !noEntra;
  // El campo que no entra queda marcado (`aria-invalid`, con su borde en styles.css): se ve cuál acortar sin leer el aviso.
  for (const campo of campoDeCadaLugar()) {
    if (campo.lugar === fuera) campo.input.setAttribute("aria-invalid", "true");
    else campo.input.removeAttribute("aria-invalid");
  }
}

/** El campo de cada lugar con su número: el cuadro de siempre es el 1 y los demás dicen el suyo en `data-lugar`. */
function campoDeCadaLugar(): { lugar: number; input: HTMLInputElement }[] {
  const primero = document.getElementById("prize");
  const resto = camposDeLugares().map((input) => ({ lugar: Number(input.dataset.lugar), input }));
  return primero instanceof HTMLInputElement ? [{ lugar: 1, input: primero }, ...resto] : resto;
}

/**
 * Al tocar Sellar la lista con premios que no entran: la línea a la vista, con el pliegue abierto, y el cursor en el
 * campo del primer lugar que no entra, para acortarlo ahí. Se encuadra la línea, no el campo: el foco solo dejaba el
 * campo justo encima de la barra de abajo, y la línea quedaba tapada por ella en el celular.
 */
export function mostrarQueNoEntran(): void {
  pintarLargo();
  const fuera = lugarQueNoEntra();
  if (fuera === null) return;
  const linea = document.getElementById("prize-largo");
  const pliegue = linea?.closest("details");
  if (pliegue) pliegue.open = true;
  const campo = fuera === 1 ? document.getElementById("prize") : cajaLugares()?.querySelector(`input[data-lugar="${fuera}"]`);
  if (campo instanceof HTMLInputElement) campo.focus({ preventScroll: true });
  linea?.scrollIntoView?.({ block: "center" });
}

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
    // Cada premio vuelve al campo de su número de lugar, no al de su orden en el texto: si el 1.º quedó vacío, el
    // 2.º no sube al cuadro de arriba. Por eso hacen falta campos hasta el lugar más alto, no tantos como premios.
    armarCampos(Math.max(lugaresApagados ? 1 : ganadoresPedidos(), ...lugares.map((l) => l.lugar)));
    p.campo.value = recortar(lugares.find((l) => l.lugar === 1)?.premio ?? "");
    const caja = cajaLugares();
    for (const { lugar, premio } of lugares) {
      if (lugar === 1) continue;
      const input = caja?.querySelector<HTMLInputElement>(`input[data-lugar="${lugar}"]`);
      if (input) input.value = recortar(premio);
    }
  } else {
    actualizarLugares();
    p.campo.value = recortar(valor);
  }
  sincronizarPremios();
  pintarLargo();
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
  // Al escribir, en el cuadro o en un lugar, se ve enseguida si lo escrito ya no entra en lo que se sella.
  p.campo.addEventListener("input", pintarLargo);
  cajaLugares()?.addEventListener("input", pintarLargo);
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

