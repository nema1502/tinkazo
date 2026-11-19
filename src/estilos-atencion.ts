/**
 * Animaciones de atención: decoración para que la página avise por dónde
 * empezar y qué se puede tocar. Ninguna decide nada del sorteo —el resultado lo
 * fija el protocolo antes de que exista ninguna de estas clases— y ninguna
 * corre con movimiento reducido: ahí ni se arman sus temporizadores, y el CSS
 * (`styles.css`, bloque "Animaciones de atención") apaga las animaciones.
 *
 * Las piezas:
 * - `iniciarTemblorHero`: los dos botones de la portada tiemblan sutilmente
 *   tras ~8 s sin interactuar; cualquier interacción corta el ciclo y lo rearma.
 * - `iniciarDestelloPie`: cada ~4 s un brillo cruza el badge del pie de la
 *   página (el «sello» de la marca), en ~0,8 s, y se apaga solo.
 * - `iniciarHoverVivo`: la captura de la tarjeta bajo el mouse se mueve suave
 *   dentro de su marco (Ken Burns) mientras el hover dura; en pantalla táctil
 *   no hay hover, y no aplica.
 * - `animarEntradaIngreso` / `animarSalidaIngreso`: la ventana de ingreso entra
 *   con fade y el panel sube; al cerrar, sale más corto antes de quitar el
 *   nodo. Todavía sin conectar: `wallet-ui.ts` no las llama, y su CSS no corre.
 * - `destrabarCtas`: marca el botón grande de la portada cuando el JS ya pintó
 *   su texto. La regla que lo escondía hasta entonces está apagada (ver
 *   `styles.css`, interruptor `data-cta-espera`).
 *
 * El pase, el temblor, el destello y el hover vivo tienen su interruptor en
 * `ATENCION_PRENDIDA`, y hoy entran apagados.
 */

/* -------------------------------------------------- los interruptores */

/** Las piezas que se mueven solas, cada una con su interruptor. */
export type PiezaDeAtencion = "pase" | "temblor" | "destello" | "hoverVivo";

/**
 * Qué piezas corren en el sitio. Entran apagadas el 13 de noviembre de 2026,
 * la víspera del primer evento con sorteos en la red principal, por lo que se
 * vio a tamaño real:
 * - pase (`ui/espera.ts`): en Mostrar en grande, frente a la sala, la tarjeta
 *   elegida se apaga a la mitad cada vuelta y parece que el juego cambió solo.
 * - temblor: vuelve cada 8,6 s sin fin, también en el recuadro del final de la
 *   demo y sobre la portada oculta, y una sacudida se lee como un error.
 * - destello: en el tema claro es una mancha gris sobre el texto del pie, y
 *   corre cada 4 s en todas las páginas, también tapado por el show.
 * - hoverVivo: al crecer la captura, su borde de abajo baja y engorda, en la
 *   portada se come el aire del marco, y al salir vuelve de golpe.
 * Para prender una, primero se arregla lo que dice su renglón.
 */
export const ATENCION_PRENDIDA: Readonly<Record<PiezaDeAtencion, boolean>> = {
  pase: false,
  temblor: false,
  destello: false,
  hoverVivo: false,
};

const forzadas: Partial<Record<PiezaDeAtencion, boolean>> = {};

/** Para las pruebas: `true` prende la pieza, `false` la apaga y `null` la devuelve a lo que trae el sitio. */
export function forzarAtencion(pieza: PiezaDeAtencion, valor: boolean | null): void {
  if (valor === null) delete forzadas[pieza];
  else forzadas[pieza] = valor;
}

/** ¿Corre hoy esta pieza? */
export function atencionPrendida(pieza: PiezaDeAtencion): boolean {
  return forzadas[pieza] ?? ATENCION_PRENDIDA[pieza];
}

/** ¿Pide el navegador poco movimiento? Sin `matchMedia` (pruebas sin stub) no anima. */
function movimientoReducido(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** ¿Hay hover de verdad (mouse)? En pantalla táctil el hover vivo no aplica. */
function conHover(): boolean {
  return !(typeof matchMedia === "function") || matchMedia("(hover: hover)").matches;
}

/* -------------------------------------------------- el temblor del hero */

/** Los ms de inactividad (sin mouse, toque ni tecla) antes del temblor del hero. */
export const TEMBLOR_TRAS_MS = 8000;
/** Cuánto dura una sacudida: ~0,5 s con dos vaivenes dentro; el tiempo exacto lo manda el CSS. */
export const TEMBLOR_DURACION_MS = 600;
/** Los dos botones de la portada: el grande de entrar y "Probar con un ejemplo". */
const BOTONES_HERO = ".hero-ctas [data-cta-entrar], .hero-ctas [data-entrar-ensayo]";

/**
 * Los dos botones del hero tiemblan sutilmente cuando nadie interactúa hace
 * ~8 s: una sacudida corta, y se vuelve a armar. Cualquier interacción corta el
 * ciclo en el acto. El filtro de lo visible mira el display del propio botón:
 * la portada oculta desde un ancestro no lo frena. Devuelve la limpieza.
 */
export function iniciarTemblorHero(raiz: ParentNode = document): () => void {
  if (!atencionPrendida("temblor") || movimientoReducido()) return () => undefined;
  const botones = (): HTMLElement[] => [...raiz.querySelectorAll<HTMLElement>(BOTONES_HERO)];
  let tArmado = 0;
  let tSacudida = 0;
  const cortar = (): void => {
    if (tArmado) clearTimeout(tArmado);
    if (tSacudida) clearTimeout(tSacudida);
    tArmado = 0;
    tSacudida = 0;
    for (const b of botones()) b.classList.remove("temblor");
  };
  const armar = (): void => {
    if (tArmado) clearTimeout(tArmado);
    tArmado = window.setTimeout(sacudir, TEMBLOR_TRAS_MS);
  };
  const sacudir = (): void => {
    tArmado = 0;
    // La portada puede estar oculta (la herramienta abierta): no tiembla nada que no se ve.
    const visibles = botones().filter((b) => getComputedStyle(b).display !== "none");
    if (!visibles.length) {
      armar();
      return;
    }
    for (const b of visibles) b.classList.add("temblor");
    tSacudida = window.setTimeout(() => {
      tSacudida = 0;
      for (const b of botones()) b.classList.remove("temblor");
      armar();
    }, TEMBLOR_DURACION_MS);
  };
  const alInteraccion = (): void => {
    cortar();
    armar();
  };
  const tipos = ["pointermove", "pointerdown", "keydown", "wheel", "click"] as const;
  for (const tipo of tipos) document.addEventListener(tipo, alInteraccion, { passive: true, capture: true });
  armar();
  return () => {
    cortar();
    for (const tipo of tipos) document.removeEventListener(tipo, alInteraccion, { capture: true });
  };
}

/* -------------------------------------------------- el destello del pie */

/** Cada cuánto vuelve a cruzar el brillo del pie. */
export const DESTELLO_CADA_MS = 4000;
/** Cuánto se ve el brillo cada vez: el cruce dura ~0,8 s; el movimiento lo manda el CSS. */
export const DESTELLO_BRILLO_MS = 800;
/** El badge del pie de todas las páginas, donde hoy vive el sello de la marca. */
export const SELECTOR_PIE = 'footer [data-i="footR"]';

/**
 * Cada ~4 s un brillo cruza el badge del pie en ~0,8 s y se apaga solo: una
 * clase con temporizador limpio, no un glow permanente. Devuelve la limpieza.
 */
export function iniciarDestelloPie(selector: string = SELECTOR_PIE, raiz: ParentNode = document): () => void {
  if (!atencionPrendida("destello") || movimientoReducido()) return () => undefined;
  const pendientes = new Set<number>();
  const cruzar = (): void => {
    for (const el of raiz.querySelectorAll<HTMLElement>(selector)) {
      el.classList.add("destello");
      const quitar = window.setTimeout(() => {
        pendientes.delete(quitar);
        el.classList.remove("destello");
      }, DESTELLO_BRILLO_MS);
      pendientes.add(quitar);
    }
  };
  const id = setInterval(cruzar, DESTELLO_CADA_MS);
  return () => {
    clearInterval(id);
    for (const t of pendientes) clearTimeout(t);
    pendientes.clear();
    for (const el of raiz.querySelectorAll<HTMLElement>(selector)) el.classList.remove("destello");
  };
}

/* -------------------------------------------------- el hover vivo */

/**
 * La captura de la tarjeta bajo el mouse se anima mientras el hover dura (la
 * clase `hover-vivo` conecta el Ken Burns del CSS) y al salir vuelve. En
 * pantalla táctil no hay hover: no aplica. Devuelve la limpieza.
 */
export function iniciarHoverVivo(selector: string, raiz: ParentNode = document): () => void {
  if (!atencionPrendida("hoverVivo") || movimientoReducido() || !conHover()) return () => undefined;
  const sueltos: { el: HTMLElement; entra: () => void; sale: () => void }[] = [];
  for (const el of raiz.querySelectorAll<HTMLElement>(selector)) {
    const entra = (): void => el.classList.add("hover-vivo");
    const sale = (): void => el.classList.remove("hover-vivo");
    el.addEventListener("pointerenter", entra);
    el.addEventListener("pointerleave", sale);
    sueltos.push({ el, entra, sale });
  }
  return () => {
    for (const { el, entra, sale } of sueltos) {
      el.removeEventListener("pointerenter", entra);
      el.removeEventListener("pointerleave", sale);
      el.classList.remove("hover-vivo");
    }
  };
}

/* ------------------------------------------ la ventana de ingreso */

/** Cuánto tarda en entrar el panel (~220 ms) y en salir (~150 ms): la espera al quitar el nodo; el movimiento lo manda el CSS. */
export const INGRESO_ENTRA_MS = 220;
export const INGRESO_SALE_MS = 150;
const ENTRA = "ingreso-entra";
const SALE = "ingreso-sale";

/**
 * La ventana de ingreso se abre: el fondo hace fade y el panel sube (las
 * animaciones están en `styles.css`, enganchadas a esta clase). El módulo
 * llama esto apenas agrega la capa al documento.
 */
export function animarEntradaIngreso(back: HTMLElement): void {
  if (movimientoReducido()) return;
  back.classList.remove(SALE);
  back.classList.add(ENTRA);
}

/**
 * La ventana de ingreso se cierra: sale más corto y después se quita el nodo.
 * Llámalo en vez de `back.remove()`: la clase prende la salida del CSS y el
 * temporizador limpia la capa; una segunda llamada mientras sale no duplica la
 * espera, y una capa ya quitada se quita sin drama.
 */
export function animarSalidaIngreso(back: HTMLElement): void {
  if (movimientoReducido() || !back.isConnected) {
    back.remove();
    return;
  }
  if (back.classList.contains(SALE)) return;
  back.classList.remove(ENTRA);
  back.classList.add(SALE);
  window.setTimeout(() => back.remove(), INGRESO_SALE_MS);
}

/* -------------------------------------------------- el FOUC de la portada */

/**
 * El texto de sesión del botón grande («Entrar con Google y sortear» / «Ir a
 * sortear») no se ve hasta que el JS lo decidió: sin flash de texto equivocado
 * al recargar. El CSS lo esconde mientras falte esta marca, y `pintarCta` la
 * pone después de pintar el estado de verdad.
 */
export function destrabarCtas(raiz: ParentNode = document): void {
  for (const el of raiz.querySelectorAll<HTMLElement>("[data-cta-entrar]")) el.setAttribute("data-cta-listo", "");
}
