import { logoPorHuella } from "../logo-guardado";
import type { Logo } from "../logo";
import { app } from "../state";
import { crearPieza } from "./logo-pieza";

/**
 * Dónde se ve el logo del sorteo que está en pantalla: el estadio, el resultado
 * y el resultado en grande. El de la foto y el de la página de comprobar viven
 * en `foto.ts` y `verify.ts`.
 *
 * El logo es el que había al sellar (`Frozen.logo`, su huella), no el de ahora:
 * cambiar de logo a la mitad de un evento no cambia el sorteo en curso. La
 * demo (`?demo=`) no lleva logo (`logoParaSellar`). Nunca se mira al ganador ni
 * a la semilla: el logo es igual para todas las semillas, no se mueve y nada
 * de lo que se ve depende del sorteo.
 *
 * El cartel del ganador no lleva logo: es el momento de quien gana, y el lienzo
 * del juego no se entera de que hay uno.
 */

/** El logo del sorteo en curso, o null: sin logo, o este navegador ya no lo tiene. */
export const logoDelSorteo = (): Logo | null => logoPorHuella(app.frozen?.logo);

/* ------------------------------------------------------------- el estadio */

/**
 * El estadio es DOM y es uno solo (`#stadium .st-top`): lo usan los dos
 * motores, así que no hace falta tocar los juegos. Se mira cuándo se abre y se
 * pone la pieza a la derecha de la llama; al cerrarse se saca, para que un
 * sorteo sin logo (o la demo) no herede el de antes.
 */
export function iniciarLogoEnElEstadio(): void {
  const estadio = document.getElementById("stadium");
  const arriba = estadio?.querySelector<HTMLElement>(".st-top");
  if (!estadio || !arriba) return;
  const poner = (): void => {
    const abierto = estadio.style.display === "block";
    const huella = abierto ? (app.frozen?.logo ?? "") : "";
    if ((arriba.dataset.logo ?? "") === huella) return;
    arriba.dataset.logo = huella;
    arriba.querySelectorAll(".st-logo").forEach((e) => e.remove());
    arriba.classList.remove("con-logo");
    const logo = huella ? logoDelSorteo() : null;
    if (!logo) return;
    const envoltorio = document.createElement("span");
    envoltorio.className = "st-logo";
    envoltorio.append(crearPieza(logo));
    arriba.classList.add("con-logo");
    arriba.querySelector(".st-brand")?.after(envoltorio);
  };
  new MutationObserver(poner).observe(estadio, { attributes: true, attributeFilter: ["style"] });
  poner();
}

/* ------------------------------------------------------------- el resultado */

/** El logo en el renglón de "Lo que salió", a la derecha. Sin logo, el renglón queda como siempre. */
export function pintarLogoEnElResultado(): void {
  const sitio = document.getElementById("winner-logo");
  if (!sitio) return;
  sitio.replaceChildren();
  const logo = logoDelSorteo();
  if (logo) sitio.append(crearPieza(logo, { clase: "logo-resultado" }));
}

/** Lo saca (al empezar otro sorteo). */
export function quitarLogoDelResultado(): void {
  document.getElementById("winner-logo")?.replaceChildren();
}

/* ------------------------------------------------------------- el resultado en grande */

/**
 * La pieza del resultado en grande, para `.sala-top`, o null si no hay logo.
 * `alAbrir` avisa cuando ya se dibujó: la vista vuelve a medir los nombres.
 */
export function piezaParaLaSala(alAbrir: () => void): HTMLElement | null {
  const logo = logoDelSorteo();
  return logo ? crearPieza(logo, { clase: "logo-sala" }, alAbrir) : null;
}
