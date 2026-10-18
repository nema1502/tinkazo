import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { app } from "../state";
import { beep, note } from "../sound";

/**
 * La espera en grande: los segundos entre sellar y poder sortear, puestos en
 * escena para la sala.
 *
 * Es el corazón del producto. La lista ya está cerrada y el número que la va a
 * decidir todavía no existe: nadie lo puede elegir porque nadie lo tiene. Eran
 * cuarenta y cinco segundos en una caja violeta dentro de la página, mientras
 * la sala miraba un formulario (revisión del 16 de octubre de 2026). Y en el
 * evento del 17, Nicolás pidió más expectativa.
 *
 * Ahora es la pantalla entera: una cuenta gigante, el premio, los nombres de
 * todos pasando, y en los últimos diez segundos "¡Contemos juntos!", con un
 * golpe por segundo. Cuando nace el número, el botón de sortear, grande.
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

/**
 * Abre la espera en grande. `segundos` es la misma cuenta del botón de sortear;
 * `sortear` lo aprieta cuando nace el número.
 */
export function mostrarEspera(segundos: () => number, sortear: () => void): void {
  const f = app.frozen;
  if (!f || app.drawn || abierta) return;
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
    (f.raffleId !== undefined ? `<p class="espera-id mono">${esc(t("waitId").replace("{n}", String(f.raffleId)))}</p>` : "") +
    `<button class="primary espera-go" type="button" data-sortear hidden>${esc(t("espSortear"))}</button>`;
  document.body.appendChild(back);
  abierta = back;

  const reloj = back.querySelector<HTMLElement>(".espera-reloj");
  const linea = back.querySelector<HTMLElement>(".espera-t");
  const go = back.querySelector<HTMLButtonElement>("[data-sortear]");
  const volver = back.querySelector<HTMLButtonElement>("[data-volver]");
  let ultimo = -1;
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
  volver?.addEventListener("click", cerrar);
  go?.addEventListener("click", () => {
    cerrar();
    sortear();
  });

  const tick = (): void => {
    // Si se sorteó o se soltó el sello por otro lado, la espera ya no tiene sentido.
    if (!app.frozen || app.drawn) {
      cerrar();
      return;
    }
    const s = segundos();
    if (s === ultimo) return;
    ultimo = s;
    if (!reloj || !linea) return;
    if (s > 10) {
      back.classList.remove("ultimos", "nacio");
      reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      linea.textContent = t("espFaltan");
    } else if (s > 0) {
      back.classList.add("ultimos");
      reloj.textContent = String(s);
      linea.textContent = t("espContemos");
      // El latido vuelve a arrancar con cada número.
      reloj.classList.remove("late");
      void reloj.offsetWidth;
      reloj.classList.add("late");
      beep(note(s > 3 ? 7 : 10 + (3 - s)), 0.12, "triangle", 0.05);
    } else {
      back.classList.remove("ultimos");
      back.classList.add("nacio");
      reloj.textContent = t("espNacio");
      linea.textContent = t("espListo");
      beep(note(14), 0.3, "square", 0.05);
      beep(note(9), 0.3, "square", 0.05);
      if (go) {
        go.hidden = false;
        go.focus({ preventScroll: true });
      }
      window.clearInterval(timer);
    }
  };
  tick();
  timer = window.setInterval(tick, 200);
  volver?.focus({ preventScroll: true });
}

/** Si la espera en grande está abierta. */
export const esperaAbierta = (): boolean => abierta !== null;
