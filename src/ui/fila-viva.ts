/**
 * La fila viva: lo que ve quien espera algo que pasa por detrás (que llegue un envío, que se confirme un pago, que se
 * abra una sala). Tiene tres estados y ocupa el lugar de la línea de estado: no suma un renglón.
 *
 * - `revisando`: una ruedita que gira y, en palabras simples, qué se está revisando.
 * - `llego`: el tilde, que salta una vez, y lo que llegó o quedó listo.
 * - `no-salio`: una marca de aviso y lo que pasó.
 *
 * El tilde y la marca de aviso los dibuja el estilo (`::before`): el texto de la fila es solo lo que se lee.
 *
 * Sin librerías: la ruedita es la de siempre (`.cc-gira`) y el tilde, el de la marca. Con movimiento reducido no hay nada
 * que se mueva (`styles.css`), y la señal de que sigue mirando no depende del movimiento: «Mirado hace N s», que se
 * actualiza cada segundo y solo aparece cuando quien lo usa avisa de cada mirada con `mirada()`.
 *
 * Para los lectores de pantalla el contenedor es un `role="status"`, y solo se reescribe cuando cambia el estado o el texto:
 * lo que no cambió no se vuelve a anunciar. «Mirado hace N s» va escondido de ellos.
 *
 * No decide nada: recibe el estado y lo pinta. Quien lo usa sigue siendo quien decide cuándo se puede pagar o reintentar.
 */

export type EstadoDeFila = "revisando" | "llego" | "no-salio";

export interface OpcionesDeFilaViva {
  /** Cómo se dice «Mirado hace N s», ya traducido. Sin esto, no se muestra. */
  hace?: (segundos: number) => string;
  /** ¿Pide el sistema poco movimiento? Por defecto, lo que dice el navegador. */
  reducido?: () => boolean;
  ahora?: () => number;
}

export interface FilaViva {
  /** Algo sigue en camino: la ruedita gira y el texto dice qué se revisa. */
  revisando(texto: string): void;
  /** Llegó o quedó listo: el tilde salta una vez. */
  llego(texto: string): void;
  /** No salió o no se pudo: la marca de aviso y el texto. */
  noSalio(texto: string): void;
  /** Anota que se acaba de mirar. Con movimiento reducido se ve como «Mirado hace N s». */
  mirada(): void;
  /** Vacía la fila: el contenedor queda sin nada y no se ve. */
  limpiar(): void;
  /** Para el reloj de «hace N s». Hay que llamarlo cuando la pantalla se cierra. */
  detener(): void;
  estado(): EstadoDeFila | null;
}

/** ¿Pide el navegador poco movimiento? Sin `matchMedia` (pruebas sin stub) no hay nada que quitar. */
const pideQuieto = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Arma la fila viva dentro de `el`. Conserva lo que `el` ya tenga de clases y atributos. */
export function crearFilaViva(el: HTMLElement, o: OpcionesDeFilaViva = {}): FilaViva {
  const ahora = o.ahora ?? Date.now;
  const reducido = o.reducido ?? pideQuieto;
  let actual: EstadoDeFila | null = null;
  let textoActual = "";
  let ultimaMirada: number | null = null;
  let haceEl: HTMLElement | null = null;
  let reloj: ReturnType<typeof setInterval> | null = null;

  if (!el.hasAttribute("role")) el.setAttribute("role", "status");
  if (!el.hasAttribute("aria-live")) el.setAttribute("aria-live", "polite");

  const pararReloj = (): void => {
    if (reloj !== null) clearInterval(reloj);
    reloj = null;
  };

  /** Escribe «Mirado hace N s» si pide poco movimiento, hay una mirada anotada y la fila sigue revisando. */
  const pintarHace = (): void => {
    if (!haceEl) return;
    if (actual !== "revisando" || ultimaMirada === null || !o.hace || !reducido()) {
      haceEl.textContent = "";
      return;
    }
    haceEl.textContent = o.hace(Math.max(0, Math.floor((ahora() - ultimaMirada) / 1000)));
  };

  const armarReloj = (): void => {
    pararReloj();
    if (actual !== "revisando" || !o.hace || !reducido()) return;
    reloj = setInterval(pintarHace, 1000);
  };

  function poner(estado: EstadoDeFila, texto: string): void {
    // Lo que no cambió no se reescribe: así un lector de pantalla lo oye una sola vez.
    if (estado === actual && texto === textoActual) return;
    const cambioElEstado = estado !== actual;
    actual = estado;
    textoActual = texto;
    el.classList.remove("fv-revisando", "fv-llego", "fv-no-salio");
    el.classList.add("fila-viva", `fv-${estado}`);
    const ico = document.createElement("span");
    ico.className = estado === "revisando" ? "fv-ico cc-gira" : "fv-ico";
    ico.setAttribute("aria-hidden", "true");
    const cuerpo = document.createElement("span");
    cuerpo.className = "fv-texto";
    cuerpo.textContent = texto;
    haceEl = document.createElement("span");
    haceEl.className = "fv-hace";
    haceEl.setAttribute("aria-hidden", "true");
    el.replaceChildren(ico, cuerpo, haceEl);
    if (cambioElEstado || reloj === null) armarReloj();
    pintarHace();
  }

  return {
    revisando: (texto) => poner("revisando", texto),
    llego: (texto) => poner("llego", texto),
    noSalio: (texto) => poner("no-salio", texto),
    mirada() {
      ultimaMirada = ahora();
      pintarHace();
    },
    limpiar() {
      pararReloj();
      actual = null;
      textoActual = "";
      haceEl = null;
      ultimaMirada = null;
      el.classList.remove("fila-viva", "fv-revisando", "fv-llego", "fv-no-salio");
      el.replaceChildren();
    },
    detener: pararReloj,
    estado: () => actual,
  };
}
