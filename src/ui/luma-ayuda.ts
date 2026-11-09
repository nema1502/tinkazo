/**
 * "Desde Luma" a la vista y su "?": enseña en tres pasos cómo bajar la lista
 * de invitados de Luma como CSV (el 31 de octubre de 2026: "Luma es una
 * herramienta increíble: enseñala"). Hasta ese día "Subir CSV" y "Desde Luma"
 * vivían dentro del pliegue de las opciones y la ayuda era un `title`, que en
 * el celular no se ve.
 *
 * El panel va en el lugar, como el de "¿Cómo se usa?": empuja la página y no
 * tapa nada, no es una ventana (no atrapa el foco ni esconde la barra de "lo que
 * sigue") y nunca se abre solo. Se cierra con el mismo "?", con Escape, al
 * elegir el archivo o al sellar. No guarda nada: ni qué se abrió ni el archivo.
 */
export function initLumaAyuda(): void {
  const q = document.getElementById("luma-q");
  const panel = document.getElementById("luma-ayuda");
  if (!(q instanceof HTMLButtonElement) || !panel) return;
  const poner = (abierto: boolean): void => {
    panel.hidden = !abierto;
    q.setAttribute("aria-expanded", String(abierto));
  };
  q.addEventListener("click", () => poner(panel.hasAttribute("hidden")));
  // Escape cierra el panel esté el foco donde esté; si estaba adentro o en el "?", el foco queda en el "?".
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || panel.hasAttribute("hidden")) return;
    const dentro = panel.contains(document.activeElement) || document.activeElement === q;
    poner(false);
    if (dentro) q.focus({ preventScroll: true });
  });
  // Quien ya eligió el archivo no necesita la guía; quien sella, tampoco.
  document.getElementById("csv-luma")?.addEventListener("change", () => poner(false));
  document.addEventListener("tinkazo:sellado", () => poner(false));
}
