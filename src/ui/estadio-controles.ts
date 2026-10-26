/**
 * Los botones del estadio (Sonido y Saltar) se esconden solos.
 *
 * En un proyector, dos botones de 12 px en la esquina eran "esa letra chica":
 * la sala los leía como parte del juego (24 de octubre de 2026). Ahora se ven al
 * abrirse el estadio, unos segundos, y se vuelven a esconder. Reaparecen al
 * mover el mouse, al tocar la pantalla o al apretar una tecla; con el botón
 * escondido el toque no lo aprieta (el CSS le saca los eventos), así que un
 * toque a ciegas en el celular muestra los botones y no salta el juego.
 *
 * Nada depende de pasar el mouse por encima: el toque y el teclado también
 * los muestran, y un botón con el foco se ve siempre.
 */

/** Cuánto quedan a la vista después de la última señal. */
export const VISIBLES_MS = 4_000;

export function iniciarControlesDelEstadio(): void {
  const st = document.getElementById("stadium");
  if (!st) return;
  let timer = 0;
  const esconder = (): void => {
    // Con el foco adentro de los botones se quedan: quien usa el teclado los está buscando.
    if (st.contains(document.activeElement) && document.activeElement?.closest(".st-actions")) {
      timer = window.setTimeout(esconder, VISIBLES_MS);
      return;
    }
    st.classList.remove("st-vivo");
  };
  const mostrar = (): void => {
    st.classList.add("st-vivo");
    window.clearTimeout(timer);
    timer = window.setTimeout(esconder, VISIBLES_MS);
  };
  for (const ev of ["pointermove", "pointerdown", "touchstart", "keydown"]) st.addEventListener(ev, mostrar, { passive: true });
  // Al abrirse el estadio, a la vista un rato: quien organiza ve que están.
  let abierto = false;
  new MutationObserver(() => {
    const ahora = st.style.display === "block";
    if (ahora && !abierto) mostrar();
    if (!ahora) {
      window.clearTimeout(timer);
      st.classList.remove("st-vivo");
    }
    abierto = ahora;
  }).observe(st, { attributes: true, attributeFilter: ["style"] });
}
