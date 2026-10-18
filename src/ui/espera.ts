import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { app } from "../state";

/**
 * La espera en grande: los segundos entre sellar y poder sortear, puestos en
 * escena para la sala.
 *
 * Es el corazón del producto. La lista ya está cerrada y el número que la va a
 * decidir todavía no existe: nadie lo puede elegir porque nadie lo tiene. Eran
 * cuarenta y cinco segundos en una caja violeta dentro de la página, mientras
 * la sala miraba un formulario (revisión del 16 de octubre de 2026).
 *
 * Es una opción de la caja de la espera, no se abre sola: una cuenta grande, el
 * premio y los nombres de todos pasando. La primera versión cerraba con
 * "¡Contemos juntos!", un golpe por segundo y un "¡Nació!" con el botón de
 * sortear; a Nicolás no le gustó y salieron. Cuando nace el número se cierra
 * sola y deja el botón de sortear de siempre, a la vista y con el foco.
 *
 * No decide nada ni toca el sello: solo muestra la cuenta que ya llevaba el
 * botón de sortear. Se cierra con Escape o con "Volver a la página".
 */

/** Cuántas veces repetir una fila de nombres para que la cinta no muestre huecos. */
function vueltas(fila: number): number {
  return Math.max(1, Math.ceil(14 / Math.max(1, fila)));
}

/** Los nombres en una, dos o tres cintas, según cuántos sean. */
function cintas(names: string[]): string {
  const filas = names.length <= 12 ? 1 : names.length <= 60 ? 2 : 3;
  const por = Math.ceil(names.length / filas);
  let html = "";
  for (let f = 0; f < filas; f++) {
    const fila = names.slice(f * por, (f + 1) * por);
    if (!fila.length) continue;
    const una = Array.from({ length: vueltas(fila.length) }, () => fila).flat();
    // Dos copias seguidas: la cinta corre media vuelta y empieza de nuevo sin salto.
    const chips = [...una, ...una].map((n) => `<span>${esc(n)}</span>`).join("");
    const dur = Math.max(22, una.length * 2.2);
    html += `<div class="espera-cinta${f % 2 ? " al-reves" : ""}" style="--dur:${dur.toFixed(1)}s" aria-hidden="true">${chips}</div>`;
  }
  return html;
}

let abierta: HTMLElement | null = null;

/** Abre la espera en grande. `segundos` es la misma cuenta del botón de sortear. */
export function mostrarEspera(segundos: () => number): void {
  const f = app.frozen;
  if (!f || app.drawn || abierta || segundos() <= 0) return;
  const L_ = T[getLang()];
  const back = document.createElement("div");
  back.className = "espera";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("espSticker"));
  back.innerHTML =
    `<div class="espera-top">` +
    `<span class="sticker">${esc(t("espSticker"))}</span>` +
    `<button class="ghost" type="button" data-volver>${esc(t("espVolver"))}</button>` +
    `</div>` +
    (f.prize ? `<p class="espera-premio">${esc(t("cortinaSe"))} <b>${esc(f.prize)}</b></p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    `<div class="espera-nombres">${cintas(f.names)}</div>` +
    `<p class="espera-pie">${esc(L_.espPie(f.names.length))}</p>` +
    // El número del sorteo, para las fotos de la sala: si después aparece otro sello, todos tienen el del bueno.
    (f.raffleId !== undefined ? `<p class="espera-id mono">${esc(t("waitId").replace("{n}", String(f.raffleId)))}</p>` : "");
  document.body.appendChild(back);
  abierta = back;

  const reloj = back.querySelector<HTMLElement>(".espera-reloj");
  let timer = 0;

  const cerrar = (): void => {
    window.clearInterval(timer);
    removeEventListener("keydown", tecla);
    back.remove();
    if (abierta === back) abierta = null;
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  addEventListener("keydown", tecla);
  back.querySelector<HTMLButtonElement>("[data-volver]")?.addEventListener("click", cerrar);

  const tick = (): void => {
    const s = segundos();
    // Nació el número, se sorteó o se soltó el sello: la espera terminó. La
    // página ya deja el botón de sortear a la vista y con el foco.
    if (!app.frozen || app.drawn || s <= 0) {
      cerrar();
      return;
    }
    if (reloj) reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  tick();
  timer = window.setInterval(tick, 250);
  back.querySelector<HTMLButtonElement>("[data-volver]")?.focus({ preventScroll: true });
}

/** Si la espera en grande está abierta. */
export const esperaAbierta = (): boolean => abierta !== null;
