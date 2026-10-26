import { esc } from "../dom";
import { getLang, onLangChange, t, T } from "../i18n";

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
export const recortar = (texto: string, largo = 60): string => Array.from(texto).slice(0, largo).join("");

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
      const aviso = [o.reciente ? t("prizeRecent") : "", ya ? t("prizeUsed") : ""].filter(Boolean).join(" · ");
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

/** Escribe el premio en el cuadro (el sello, la imagen y las bases lo leen de ahí) y refleja el cambio. */
export function ponerPremio(valor: string): void {
  const p = partes();
  if (!p) return;
  p.campo.value = recortar(valor);
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
  onLangChange(pintar);
  pintar();
}

/** Para las pruebas: vuelve al estado de recién cargada la página. */
export function reiniciarPremios(): void {
  salieron = [];
  montado = false;
}

