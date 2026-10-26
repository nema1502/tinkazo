import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { app, avatar } from "../state";
import { beep, note } from "../sound";
import { enEnsayo } from "../ensayo-modo";

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
 * sortear; a Nicolás no le gustó y salieron, y no vuelven.
 *
 * Desde el 21 de octubre de 2026 desemboca en el show. Nicolás: "cuando
 * termine, empiece también, ¿no? Ahora la espera termina y se sale". Si está
 * abierta cuando nace el número, el sorteo arranca solo, como si se tocara
 * "Lanzar el sorteo" (`freeze.ts` aprieta el botón de verdad), y la espera se
 * queda arriba hasta que la tarjeta del juego o el estadio están detrás: la
 * sala no vuelve a ver el formulario. Mientras se trae el número (y, con
 * cuenta, se graba el sorteo) dice eso mismo, en el lugar de la cuenta, y hace
 * de cortina.
 *
 * - La pantalla completa se pide al tocar "Mostrar la espera en grande", que es
 *   el gesto que el navegador exige (`freeze.ts`). El show la hereda: no se
 *   vuelve a pedir sin un toque, porque el navegador la negaría.
 * - Si la cuenta pide aprobar cada operación en una ventana (Freighter), el
 *   sorteo no puede arrancar solo: la espera queda abierta con una sola acción
 *   grande, "Lanzar el sorteo". La cuenta de prueba y la de Google (Pollar)
 *   firman sin ventana, y arrancan solas.
 * - Si traer el número o grabar el sorteo falla, el motivo y "Reintentar el
 *   sorteo" se ven acá, en grande (`verError` de `siguiente.ts`), no en la
 *   página de atrás.
 * - Escape o "Volver a la página" salen, como siempre, y sueltan la pantalla
 *   completa que pidió la espera. Con la pantalla completa, Escape la suelta el
 *   navegador sin avisarle a la página: salir de ella también cierra la espera.
 * - Y el show desemboca en el resultado en grande, con el QR (`draw.ts` y
 *   `pantalla.ts`): la sala no ve la página tampoco al final. Al cerrarlo, la
 *   página sigue con "Siguiente premio" y suelta la pantalla completa.
 *
 * Si no está abierta cuando nace el número, todo queda como antes: el botón de
 * sortear de la página, a la vista y con el foco.
 *
 * No decide nada ni toca el sello: muestra la cuenta que ya llevaba el botón de
 * sortear, y lo aprieta cuando nace el número.
 */

/** Lo que la espera necesita de la página para desembocar en el show. */
export interface Sorteo {
  /** Aprieta "Lanzar el sorteo", el botón de verdad: hace lo mismo que tocarlo. */
  sortear: () => void;
  /** La cuenta pide aprobar en una ventana (Freighter): el sorteo no puede arrancar solo. */
  aMano: () => boolean;
  /** El sorteo se graba en Stellar, y tarda unos segundos más: lo dice mientras tanto. */
  graba: boolean;
  /** La pantalla completa la pidió la espera: al volver a la página, se suelta. */
  pantalla: boolean;
}

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
    // Cada nombre con su cara: la sala se busca en la cinta (el dibujo es el de toda la herramienta).
    const chips = [...una, ...una].map((n) => `<span><img src="${avatar(n, 56)}" alt="" />${esc(n)}</span>`).join("");
    const dur = Math.max(22, una.length * 2.2);
    html += `<div class="espera-cinta${f % 2 ? " al-reves" : ""}" style="--dur:${dur.toFixed(1)}s" aria-hidden="true">${chips}</div>`;
  }
  return html;
}

/**
 * En qué está la espera: contando; esperando que alguien lance el sorteo
 * (Freighter); sorteando, hasta que el show la tape; o con un error a la vista.
 */
type Fase = "cuenta" | "lanzar" | "sorteando" | "fallo";

/** La espera abierta. `nacio`: la ronda nació, y el sorteo arranca solo o, si hay que aprobarlo a mano, se ofrece lanzarlo. */
let abierta: { nacio: () => void } | null = null;

/**
 * El show o el resultado ya están detrás de la espera: se puede ir sin que se
 * vea el formulario. El resultado en grande (sin show, con el movimiento
 * reducido) cuenta como el show: se queda con la pantalla completa.
 */
function relevo(): "show" | "resultado" | null {
  if (document.querySelector(".game-card, .pantalla") || document.getElementById("stadium")?.style.display === "block") return "show";
  if (document.getElementById("winner-box")?.style.display === "block") return "resultado";
  return null;
}

/**
 * Abre la espera en grande. `segundos` es la misma cuenta del botón de sortear.
 * Devuelve si la abrió: con el número ya nacido, o con una abierta, no.
 */
export function mostrarEspera(segundos: () => number, sorteo: Sorteo): boolean {
  const f = app.frozen;
  if (!f || app.drawn || abierta || segundos() <= 0) return false;
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
    // En el ensayo también se ve que no se graba, como en el estadio (ensayo.ts).
    (enEnsayo() ? `<p class="espera-ensayo">${esc(t("ensEstadio"))}</p>` : "") +
    (f.prize ? `<p class="espera-premio">${esc(t("cortinaSe"))} <b>${esc(f.prize)}</b></p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    // Lo que pasa cuando nace el número: la línea de la cortina, la acción grande o el error.
    `<div class="espera-sigue" hidden></div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    `<div class="espera-nombres">${cintas(f.names)}</div>` +
    `<p class="espera-pie">${esc(L_.espPie(f.names.length))}</p>` +
    // Para que la sala lo lea y quien organiza lo repita (diseño del onboarding, 22 de octubre de 2026).
    `<p class="espera-nadie">${esc(t("espNadie"))}</p>` +
    // El número del sorteo, para las fotos de la sala: si después aparece otro sello, todos tienen el del bueno.
    (f.raffleId !== undefined ? `<p class="espera-id mono">${esc(t("waitId").replace("{n}", String(f.raffleId)))}</p>` : "");
  document.body.appendChild(back);

  const sticker = back.querySelector<HTMLElement>(".sticker");
  const reloj = back.querySelector<HTMLElement>(".espera-reloj");
  const debajo = back.querySelector<HTMLElement>(".espera-t");
  const sigue = back.querySelector<HTMLElement>(".espera-sigue");
  const volver = back.querySelector<HTMLButtonElement>("[data-volver]");
  let fase: Fase = "cuenta";
  let timer = 0;
  let ultimoTic = -1;

  /**
   * Cierra la espera. `alShow`: el show ya la tapa y se queda con la pantalla
   * completa, que se suelta al cerrar el resultado en grande. Si no, se suelta la que pidió la
   * espera, y el foco vuelve a la página: al botón de sortear si ya se puede, y
   * si no, al que abrió la espera.
   */
  const cerrar = (alShow = false): void => {
    window.clearInterval(timer);
    removeEventListener("keydown", tecla);
    document.removeEventListener("fullscreenchange", pantalla);
    document.removeEventListener("tinkazo:error", alError);
    back.remove();
    if (abierta === yo) abierta = null;
    if (alShow) return;
    if (sorteo.pantalla && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const draw = document.getElementById("btn-draw") as HTMLButtonElement | null;
    const volverA = draw && !draw.disabled ? draw : document.getElementById("btn-espera");
    if (volverA && volverA.offsetParent !== null) volverA.focus({ preventScroll: true });
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") cerrar();
  };
  // Con la pantalla completa, Escape la suelta el navegador y la página no se
  // entera de la tecla: salir de ella es salir de la espera. Mientras se
  // sortea no, porque el show ya viene: un segundo Escape cierra.
  const pantalla = (): void => {
    if (!document.fullscreenElement && fase !== "sorteando") cerrar();
  };
  addEventListener("keydown", tecla);
  document.addEventListener("fullscreenchange", pantalla);
  volver?.addEventListener("click", () => cerrar());

  /** Pasa a otra fase: la cuenta y su línea dejan su lugar a lo que sigue, con el mismo alto (los nombres no saltan). */
  const pasar = (a: Fase, html: string): void => {
    fase = a;
    if (sticker) sticker.textContent = t("espStickerYa");
    back.setAttribute("aria-label", t("espStickerYa"));
    if (!sigue) return;
    if (reloj && !reloj.hidden) {
      const hueco = parseFloat(getComputedStyle(back).rowGap) || 0;
      sigue.style.minHeight = `${reloj.offsetHeight + (debajo?.offsetHeight ?? 0) + hueco}px`;
      reloj.hidden = true;
      if (debajo) debajo.hidden = true;
    }
    sigue.innerHTML = html;
    sigue.hidden = false;
  };

  /** Lo que se ve mientras llega el número y, con cuenta, se graba: lo mismo que la cortina del sorteo. */
  const sortear = (): void => {
    pasar(
      "sorteando",
      `<p class="cortina-t" role="status">${esc(t(sorteo.graba ? "cortinaGraba" : "cortinaNumero"))}</p>` +
        `<span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span>`,
    );
    // En la demo el sorteo lo lanza la propia demo: apretarlo acá sortearía dos veces.
    if (document.body.dataset.demo !== "1") sorteo.sortear();
  };

  /** Una sola acción, grande: lanzar el sorteo o reintentarlo. Con el foco, para seguir con Enter. */
  const accion = (a: Fase, texto: string, boton: string): void => {
    pasar(a, `<p class="espera-motivo" role="${a === "fallo" ? "alert" : "status"}">${esc(texto)}</p><button class="primary espera-accion" type="button">${esc(boton)}</button>`);
    const b = sigue?.querySelector<HTMLButtonElement>(".espera-accion");
    b?.addEventListener("click", sortear);
    b?.focus({ preventScroll: true });
  };

  /**
   * El sorteo no pudo seguir, y el motivo ya está escrito junto al botón de la
   * página. `verError` (`siguiente.ts`) lo ofrece acá antes de llevar la página
   * hasta él: con la espera abierta se ve en grande, con la acción para reintentar.
   */
  const alError = (e: Event): void => {
    if (fase !== "sorteando") return;
    e.preventDefault();
    accion("fallo", String((e as CustomEvent<string>).detail ?? ""), t("drawRetry"));
  };
  document.addEventListener("tinkazo:error", alError);

  const yo = {
    nacio: (): void => {
      if (fase !== "cuenta") return;
      if (sorteo.aMano()) accion("lanzar", t("espAprobar"), t("draw"));
      else sortear();
    },
  };
  abierta = yo;

  const tick = (): void => {
    // Se soltó el sello: la espera no tiene nada que esperar.
    if (!app.frozen) {
      cerrar();
      return;
    }
    // Ya se sorteó: se va recién cuando el show (o el resultado, sin show) está detrás.
    if (app.drawn) {
      const r = relevo();
      if (r) cerrar(r === "show");
      return;
    }
    if (fase !== "cuenta" || !reloj) return;
    const s = Math.max(0, segundos());
    reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    // Los últimos cinco segundos suben de tono, uno por uno: el pre-show sube hasta el show.
    if (s <= 5 && s !== ultimoTic) {
      ultimoTic = s;
      beep(note(12 - s * 2), 0.18, "triangle", 0.05);
    }
  };
  tick();
  timer = window.setInterval(tick, 250);
  volver?.focus({ preventScroll: true });
  return true;
}

/** Si la espera en grande está abierta. */
export const esperaAbierta = (): boolean => abierta !== null;

/** Nació el número (lo avisa la cuenta regresiva de `freeze.ts`): con la espera abierta, desemboca en el show. */
export function nacioElNumero(): void {
  abierta?.nacio();
}
