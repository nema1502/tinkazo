import { esc } from "../dom";
import { getLang, t } from "../i18n";
import { app, avatar } from "../state";
import { beep, note } from "../sound";
import { enEnsayo } from "../ensayo-modo";
import { pieDeLaEspera, sinSelloAhora } from "./sin-sello-textos";
import { rechazarGrande } from "./vista-grande";
import { soltarPantallaCompleta } from "./pantalla-completa";

/**
 * La espera en grande: los segundos entre sellar y poder sortear, puestos en
 * escena para la sala.
 *
 * Es el corazón del producto. La lista ya está cerrada y el número que la va a
 * decidir todavía no existe: nadie lo puede elegir porque nadie lo tiene. Eran
 * cuarenta y cinco segundos en una caja violeta dentro de la página, mientras
 * la sala miraba un formulario (revisión del 16 de octubre de 2026).
 *
 * Es la vista grande: una cuenta grande, el premio y los nombres de todos
 * pasando. La primera versión cerraba con "¡Contemos juntos!", un golpe por
 * segundo y un "¡Nació!" con el botón de sortear; a quien organiza no le gustó y
 * salieron, y no vuelven.
 *
 * Desde el 26 de octubre de 2026 se abre sola al sellar: el clic de "Sellar la
 * lista" pide la pantalla completa (es el gesto que el navegador exige;
 * `freeze.ts`) y, cuando el sello está, la espera se pone en grande sin una
 * pantalla intermedia que lo pida. Si el navegador la niega o no la ofrece (el
 * iPhone), esta capa se abre igual, sin pedir nada. "Mostrar la espera en
 * grande" sigue a mano, para volver (`vista-grande.ts`).
 *
 * - Escape o "Volver a la página" salen, como siempre, y sueltan la pantalla
 *   completa. Con la pantalla completa, Escape la suelta el navegador sin
 *   avisarle a la página: salir de ella también cierra la espera. En los dos
 *   casos la persona dijo que no, y no se le vuelve a forzar en esta sesión.
 * - "Cambiar de juego": el selector está detrás de esta capa, así que el juego
 *   se elige sin salir (secundario: la acción principal sigue siendo una sola).
 * - Si la cuenta pide aprobar cada operación en una ventana (Freighter), el
 *   sorteo no puede arrancar solo: la espera queda abierta con una sola acción
 *   grande, "Lanzar el sorteo". La cuenta de prueba y la de Google (Pollar)
 *   firman sin ventana, y arrancan solas.
 * - Si traer el número o grabar el sorteo falla, el motivo y "Reintentar el
 *   sorteo" se ven acá, en grande (`verError` de `siguiente.ts`), no en la
 *   página de atrás.
 * - Y el show desemboca en el resultado en grande, con el QR (`draw.ts` y
 *   `pantalla.ts`): la sala no ve la página tampoco al final. Al cerrarlo, la
 *   página sigue con "Siguiente premio" y suelta la pantalla completa.
 *
 * Desde el 21 de octubre de 2026 desemboca en el show. Pedido: "cuando
 * termine, empiece también, ¿no? Ahora la espera termina y se sale". Si está
 * abierta cuando nace el número, el sorteo arranca solo, como si se tocara
 * "Lanzar el sorteo" (`freeze.ts` aprieta el botón de verdad), y la espera se
 * queda arriba hasta que la tarjeta del juego o el estadio están detrás: la
 * sala no vuelve a ver el formulario. Mientras se trae el número (y, con
 * cuenta, se graba el sorteo) dice eso mismo, en el lugar de la cuenta, y hace
 * de cortina.
 *
 * Si no está abierta cuando nace el número (la persona volvió a la página), todo
 * queda como antes: el botón de sortear de la página, a la vista y con el foco.
 *
 * No decide nada ni toca el sello: muestra la cuenta que ya llevaba el botón de
 * sortear, y lo aprieta cuando nace el número.
 */

/** Un juego que se puede elegir desde la espera. */
export interface OpcionDeJuego {
  game: string;
  nombre: string;
  /** El tramo de personas en que luce ("6–12"), o vacío. */
  rango: string;
  recomendado: boolean;
  elegido: boolean;
}

/** Lo que la espera necesita de la página para desembocar en el show. */
export interface Sorteo {
  /** Aprieta "Lanzar el sorteo", el botón de verdad: hace lo mismo que tocarlo. */
  sortear: () => void;
  /** La cuenta pide aprobar en una ventana (Freighter): el sorteo no puede arrancar solo. */
  aMano: () => boolean;
  /** El sorteo se graba en Stellar, y tarda unos segundos más: lo dice mientras tanto. */
  graba: boolean;
  /** Los juegos que se pueden elegir, en el orden en que los recomienda esta cantidad de gente. */
  juegos: () => OpcionDeJuego[];
  /** Quien organiza eligió otro juego sin salir de la espera. */
  elegirJuego: (game: string) => void;
  /**
   * La abrió el propio sello y no un toque: el foco queda en la capa y no en "Volver a la
   * página", para que un Enter de más (justo después de sellar) no la cierre.
   */
  alSellar?: boolean;
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
 * Hasta dónde se deja achicar la espera para que entre, según cuántas cintas de nombres quedan: por debajo de esto el
 * texto ya no se lee desde el fondo de la sala. Con las tres cintas, nunca menos de 0,7; si así no entra, se quita la
 * tercera (los nombres son decoración: con dos filas pasan igual) y se deja hasta 0,65, y por último queda una sola.
 */
const AJUSTE_MIN = [0.7, 0.65, 0.6];

/**
 * Que todo entre en la pantalla, sin barra ni nada cortado (26 de octubre de 2026). Los tamaños se miden por el ancho
 * (`vw`), y en un proyector de 1280 x 720 o una laptop de 1366 x 768 un premio largo, tres cintas de nombres y el
 * número del sorteo no tenían alto para todo: lo de abajo quedaba cortado ("Nadie puede elegir…", el número que la sala
 * anota) o, con la capa recorriéndose, una barra de desplazamiento sobre la imagen proyectada. Se busca el tamaño más
 * grande al que todo entra (`--ajuste`, que multiplica los tamaños en styles.css) y, si ni con el mínimo entra, se
 * van quitando cintas de nombres (`data-apretada`). Una pantalla baja (un celular acostado, un zoom de 200 %) no se
 * achica: se le quitan cintas y, si aun así no entra, se recorre por dentro.
 */
function ajustar(capa: HTMLElement): void {
  const baja = matchMedia("(max-height: 560px)").matches;
  const sobra = (): boolean => capa.scrollHeight > capa.clientHeight + 1;
  /** ¿Entra con este nivel de cintas (0 = todas, 1 = sin la tercera, 2 = una sola)? Deja puesto el mayor tamaño que entra. */
  const probar = (nivel: number): boolean => {
    if (nivel) capa.dataset.apretada = String(nivel);
    else delete capa.dataset.apretada;
    capa.style.setProperty("--ajuste", "1");
    if (!sobra()) return true;
    if (baja) return false;
    let entra = AJUSTE_MIN[nivel] ?? 0.6;
    let noEntra = 1;
    capa.style.setProperty("--ajuste", entra.toFixed(3));
    if (sobra()) return false;
    for (let i = 0; i < 7; i++) {
      const medio = (entra + noEntra) / 2;
      capa.style.setProperty("--ajuste", medio.toFixed(3));
      if (sobra()) noEntra = medio;
      else entra = medio;
    }
    capa.style.setProperty("--ajuste", entra.toFixed(3));
    return true;
  };
  // Sin tres cintas no hay nada que quitar: con dos o una, los niveles repiten lo mismo y se pasa al siguiente sin costo.
  for (const nivel of [0, 1, 2]) if (probar(nivel)) return;
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
 * La fila "Juego: Carrera de llamas · Cambiar de juego". Va dos veces y el CSS muestra una: en la barra de arriba
 * cuando la pantalla es ancha (una laptop o un proyector, donde cada renglón de alto cuenta), y abajo del todo cuando no.
 */
function juegoHtml(juegos: OpcionDeJuego[], lugar: "barra" | "flujo"): string {
  // Con uno solo no hay nada que cambiar.
  if (juegos.length < 2) return "";
  const actual = juegos.find((j) => j.elegido) ?? juegos[0];
  return (
    `<div class="espera-juego en-${lugar}">` +
    `<span class="espera-juego-n">${esc(t("espJuego"))} <b>${esc(actual?.nombre ?? "")}</b></span>` +
    `<button class="ghost" type="button" data-juego aria-haspopup="true" aria-expanded="false">${esc(t("cambiarJuego"))}</button>` +
    `</div>`
  );
}

/** La lista para elegir otro juego, sobre toda la espera. Se llena al abrirla. */
function panelDeJuegosHtml(juegos: OpcionDeJuego[]): string {
  if (juegos.length < 2) return "";
  return (
    `<div class="espera-juegos" role="group" aria-label="${esc(t("espJuegosT"))}" hidden>` +
    `<p class="espera-juegos-t">${esc(t("espJuegosT"))}</p>` +
    `<div class="espera-juegos-lista"></div>` +
    `<button class="ghost" type="button" data-juegos-listo>${esc(t("espJuegosListo"))}</button>` +
    `</div>`
  );
}

/** Los botones de la lista de juegos: el elegido marcado, la estrella en los que encajan con esta cantidad de gente. */
function opcionesHtml(juegos: OpcionDeJuego[]): string {
  return juegos
    .map(
      (j) =>
        `<button type="button" class="espera-juego-op" data-game="${esc(j.game)}" aria-pressed="${j.elegido}">` +
        `<span class="espera-juego-nombre">${j.recomendado ? `<i aria-hidden="true">★</i> ` : ""}${esc(j.nombre)}</span>` +
        (j.recomendado ? `<span class="sr-only"> · ${esc(t("recBadge"))}</span>` : "") +
        (j.rango ? `<small>${esc(j.rango)}</small>` : "") +
        `</button>`,
    )
    .join("");
}

/**
 * Abre la espera en grande. `segundos` es la misma cuenta del botón de sortear.
 * Devuelve si la abrió: con el número ya nacido, o con una abierta, no.
 */
export function mostrarEspera(segundos: () => number, sorteo: Sorteo): boolean {
  const f = app.frozen;
  if (!f || app.drawn || abierta || segundos() <= 0) return false;
  const back = document.createElement("div");
  back.className = "espera";
  back.setAttribute("role", "dialog");
  back.setAttribute("aria-modal", "true");
  back.setAttribute("aria-label", t("espSticker"));
  back.tabIndex = -1;
  const juegos = sorteo.juegos();
  back.innerHTML =
    `<div class="espera-top">` +
    `<span class="sticker">${esc(t("espSticker"))}</span>` +
    `<div class="espera-top-acc">${juegoHtml(juegos, "barra")}<button class="ghost" type="button" data-volver>${esc(t("espVolver"))}</button></div>` +
    `</div>` +
    // En el ensayo también se ve que no se graba, como en el estadio (ensayo.ts).
    (enEnsayo() ? `<p class="espera-ensayo">${esc(t("ensEstadio"))}</p>` : "") +
    (f.prize ? `<p class="espera-premio">${esc(t("cortinaSe"))} <b>${esc(f.prize)}</b></p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    // Lo que pasa cuando nace el número: la línea de la cortina, la acción grande o el error.
    `<div class="espera-sigue" hidden></div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    `<div class="espera-nombres">${cintas(f.names)}</div>` +
    // Sin sello (la red no dejó sellar) no dice "sellada": la sala lo lee desde el fondo y no debe creer que se puede comprobar.
    `<p class="espera-pie">${esc(pieDeLaEspera(getLang(), f.names.length, sinSelloAhora(f)))}</p>` +
    // Para que la sala lo lea y quien organiza lo repita (diseño del onboarding, 22 de octubre de 2026).
    `<p class="espera-nadie">${esc(t("espNadie"))}</p>` +
    // El número del sorteo, para las fotos de la sala: si después aparece otro sello, todos tienen el del bueno.
    (f.raffleId !== undefined ? `<p class="espera-id mono">${esc(t("waitId").replace("{n}", String(f.raffleId)))}</p>` : "") +
    // El juego, para la sala y para quien organiza: el selector queda detrás de esta capa.
    juegoHtml(juegos, "flujo") +
    panelDeJuegosHtml(juegos);
  document.body.appendChild(back);
  // Que entre en la pantalla: ahora, cuando cambia el tamaño (un proyector que se conecta, un zoom) y cuando llegan las letras.
  const ajusta = (): void => ajustar(back);
  ajusta();
  addEventListener("resize", ajusta);
  void document.fonts?.ready.then(() => back.isConnected && ajusta());

  const sticker = back.querySelector<HTMLElement>(".sticker");
  const reloj = back.querySelector<HTMLElement>(".espera-reloj");
  const debajo = back.querySelector<HTMLElement>(".espera-t");
  const sigue = back.querySelector<HTMLElement>(".espera-sigue");
  const volver = back.querySelector<HTMLButtonElement>("[data-volver]");
  const filasJuego = [...back.querySelectorAll<HTMLElement>(".espera-juego")];
  const botonesJuego = [...back.querySelectorAll<HTMLButtonElement>("[data-juego]")];
  const panel = back.querySelector<HTMLElement>(".espera-juegos");
  /** El botón que se ve ahora: de las dos filas, el CSS muestra una. */
  const botonJuego = (): HTMLButtonElement | undefined => botonesJuego.find((b) => b.offsetParent !== null) ?? botonesJuego[0];
  let fase: Fase = "cuenta";
  let timer = 0;
  let ultimoTic = -1;

  /**
   * Cierra la espera. `alShow`: el show ya la tapa y se queda con la pantalla
   * completa, que se suelta al cerrar el resultado en grande. Si no, se suelta la
   * pantalla completa, y el foco vuelve a la página: al botón de sortear si ya se
   * puede, y si no, al que abrió la espera.
   */
  const cerrar = (alShow = false): void => {
    window.clearInterval(timer);
    removeEventListener("resize", ajusta);
    removeEventListener("keydown", tecla);
    document.removeEventListener("fullscreenchange", pantalla);
    document.removeEventListener("tinkazo:error", alError);
    document.removeEventListener("tinkazo:sello", alSello);
    back.remove();
    if (abierta === yo) abierta = null;
    if (alShow) return;
    soltarPantallaCompleta();
    const draw = document.getElementById("btn-draw") as HTMLButtonElement | null;
    const volverA = draw && !draw.disabled ? draw : document.getElementById("btn-espera");
    if (volverA && volverA.offsetParent !== null) volverA.focus({ preventScroll: true });
  };
  /** La persona se fue de la vista grande (Escape, "Volver a la página", salir de la pantalla completa): no se le vuelve a forzar. */
  const salir = (): void => {
    rechazarGrande();
    cerrar();
  };

  /* -------------------------------------------------------- elegir otro juego */
  const juegosAbiertos = (): boolean => !!panel && !panel.hidden;
  const pintarNombre = (): void => {
    const actual = sorteo.juegos().find((j) => j.elegido);
    if (!actual) return;
    for (const el of back.querySelectorAll<HTMLElement>(".espera-juego-n b")) el.textContent = actual.nombre;
  };
  const abrirJuegos = (): void => {
    const lista = panel?.querySelector<HTMLElement>(".espera-juegos-lista");
    if (!panel || !lista) return;
    lista.innerHTML = opcionesHtml(sorteo.juegos());
    panel.hidden = false;
    for (const b of botonesJuego) b.setAttribute("aria-expanded", "true");
    (lista.querySelector<HTMLElement>('[aria-pressed="true"]') ?? lista.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
  };
  const cerrarJuegos = (devolverFoco = true): void => {
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    for (const b of botonesJuego) b.setAttribute("aria-expanded", "false");
    if (devolverFoco) botonJuego()?.focus({ preventScroll: true });
  };
  for (const b of botonesJuego) b.addEventListener("click", () => (juegosAbiertos() ? cerrarJuegos() : abrirJuegos()));
  panel?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-game], [data-juegos-listo]");
    if (!b) return;
    if (b.dataset.game) {
      sorteo.elegirJuego(b.dataset.game);
      pintarNombre();
    }
    cerrarJuegos();
  });

  const tecla = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    // Con la lista de juegos abierta, Escape la cierra a ella y no a la espera.
    if (juegosAbiertos()) cerrarJuegos();
    else salir();
  };
  // Con la pantalla completa, Escape la suelta el navegador y la página no se
  // entera de la tecla: salir de ella es salir de la espera. Mientras se
  // sortea no, porque el show ya viene: un segundo Escape cierra. Nada de esto
  // lo hace la propia página mientras la espera está abierta: es la persona.
  const pantalla = (): void => {
    if (!document.fullscreenElement && fase !== "sorteando") salir();
  };
  addEventListener("keydown", tecla);
  document.addEventListener("fullscreenchange", pantalla);
  volver?.addEventListener("click", salir);

  /** Pasa a otra fase: la cuenta y su línea dejan su lugar a lo que sigue, con el mismo alto (los nombres no saltan). */
  const pasar = (a: Fase, html: string): void => {
    fase = a;
    if (sticker) sticker.textContent = t("espStickerYa");
    back.setAttribute("aria-label", t("espStickerYa"));
    // El juego ya no se cambia: el sorteo arranca (o falló, y se reintenta con el que estaba).
    if (a === "sorteando" || a === "fallo") {
      cerrarJuegos(false);
      for (const fila of filasJuego) fila.hidden = true;
    }
    if (!sigue) return;
    if (reloj && !reloj.hidden) {
      const hueco = parseFloat(getComputedStyle(back).rowGap) || 0;
      sigue.style.minHeight = `${reloj.offsetHeight + (debajo?.offsetHeight ?? 0) + hueco}px`;
      reloj.hidden = true;
      if (debajo) debajo.hidden = true;
    }
    sigue.innerHTML = html;
    sigue.hidden = false;
    // Lo que ocupa el lugar de la cuenta (el motivo de un error, con su botón) puede ser más alto que ella.
    ajusta();
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
  // El sello entró tarde (el reintento de "Seguir sin sello", `freeze.ts`): el pie deja de decir que no se puede comprobar.
  const alSello = (): void => {
    const pie = back.querySelector<HTMLElement>(".espera-pie");
    if (pie && app.frozen) pie.textContent = pieDeLaEspera(getLang(), app.frozen.names.length, sinSelloAhora(app.frozen));
  };
  document.addEventListener("tinkazo:sello", alSello);

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
  // Si la abrió el sello, el foco queda en la capa: un Enter de más, justo después de sellar, no la cierra.
  if (sorteo.alSellar) back.focus({ preventScroll: true });
  else volver?.focus({ preventScroll: true });
  return true;
}

/** Si la espera en grande está abierta. */
export const esperaAbierta = (): boolean => abierta !== null;

/** Nació el número (lo avisa la cuenta regresiva de `freeze.ts`): con la espera abierta, desemboca en el show. */
export function nacioElNumero(): void {
  abierta?.nacio();
}
