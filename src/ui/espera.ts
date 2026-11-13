import { esc } from "../dom";
import type { AccionError, EventoError } from "./error-accion";
import { getLang, t } from "../i18n";
import { app, avatar, type Game } from "../state";
import { beep, note } from "../sound";
import { RANGOS, SELECTOR, cabenLosPremios, rangoParaLeer } from "./recomendar";
import { entradaDe } from "../games/pixi/kit/catalogo";
import { QUEDA_MS, elegirAlAzar, enRueda, posiblesDe, type JuegoAzar } from "./azar";
import { enEnsayo } from "../ensayo-modo";
import { pieDeLaEspera, sinSelloAhora } from "./sin-sello-textos";
import { rechazarGrande } from "./vista-grande";
import { soltarPantallaCompleta } from "./pantalla-completa";
import { paraMostrar } from "../equipos/etiquetas";
import { hayModoOficial, network } from "../stellar/config";

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
 *   avisarle a la página: la espera se queda arriba como capa (también la
 *   suelta Windows al cambiar de proyector), y un segundo Escape la cierra. Al
 *   salir, la persona dijo que no, y no se le vuelve a forzar en esta sesión.
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
  /** `false`: con esta cantidad de gente el juego no encaja, y su tarjeta se ve apagada. Sin dato, se ve como las demás. */
  encaja?: boolean;
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
  /** Cuántos premios se sortean: Sorprendeme no cae en un juego que no los cuenta todos (la carrera, el sapo). */
  premios: () => number;
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

/**
 * Los nombres en una, dos o tres cintas, según cuántos sean. Con equipos con cupón la lista sellada son cuentas: en la
 * cinta va el nombre de cada equipo, como en el show (`paraMostrar`), no la cuenta de 56 letras.
 */
export function cintas(lista: readonly string[]): string {
  const names = paraMostrar(lista);
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
 * La fila "Juego: Carrera de llamas, Cambiar de juego". Va dos veces y el CSS muestra una: en la barra de arriba
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
function panelDeJuegosHtml(juegos: OpcionDeJuego[], personas: number): string {
  if (juegos.length < 2) return "";
  return (
    `<div class="espera-juegos" role="group" aria-label="${esc(t("espJuegosT"))}" hidden>` +
    `<p class="espera-juegos-t">${esc(t("espJuegosT"))}</p>` +
    // Qué quiere decir la estrella de las tarjetas: sin esta línea, quien no conoce Tinkazo no sabe por qué hay juegos con estrella.
    (juegos.some((j) => j.recomendado)
      ? `<p class="espera-juegos-sub"><i aria-hidden="true">★</i> ${esc(t("espRecomendadas").replace("{n}", String(personas)))}</p>`
      : "") +
    `<div class="espera-juegos-lista"></div>` +
    // El sorteo de verdad ya está sellado: este botón solo elige con qué juego contarlo. Sin dado ni dibujo: nada con cara de casino.
    // Los dos botones quedan siempre a la vista, abajo, aunque la lista de juegos se recorra por dentro.
    `<div class="espera-juegos-acc">` +
    `<button class="ghost" type="button" data-azar>${esc(t("espAzar"))}</button>` +
    `<button class="ghost" type="button" data-juegos-listo>${esc(t("espJuegosListo"))}</button>` +
    `</div>` +
    `</div>`
  );
}

/** La pareja de capturas de un juego, la misma del selector (`botones-kit.ts`): una por tema, oscura y clara. */
const capturasDe = (game: string): string[] => [`/juegos/selector/${game}.webp`, `/juegos/selector/${game}-light.webp`];

/**
 * ¿Hay captura del juego? Se sabe por el catálogo y no por el markup del selector, que cambia de forma (botones, tarjetas)
 * y dejaría el panel sin imágenes sin avisar. Los juegos del selector la tienen todos: los de siempre traen las suyas con
 * la página y los del kit no se encienden sin ella (`captura` en `kit/catalogo.ts`). Los que salieron del selector, no.
 */
export function tieneCaptura(game: string): boolean {
  if (!SELECTOR.includes(game as Game)) return false;
  return entradaDe(game)?.captura ?? true;
}

/** El tramo de personas con su unidad: "2–200" se lee "2 a 200 personas". Sin la unidad parece un marcador. */
export const rangoConUnidad = (rango: string): string => rangoParaLeer(rango, t("espRangoPersonas"), t("recRangoUnion"));

/** Las opciones de la lista de juegos: la captura del juego en su tema cuando hay (elige la lista el juego, y su
 * tarjeta se ve como la del selector de la página), y el juego sin captura queda como el botón de texto de siempre.
 * El elegido va marcado, la estrella avisa qué encaja con esta cantidad de gente y el que no encaja se ve apagado. */
export function opcionesHtml(juegos: OpcionDeJuego[]): string {
  return juegos
    .map((j) => {
      const imgs = tieneCaptura(j.game)
        ? capturasDe(j.game)
            .map(
              (src, k) =>
                `<img class="sel-img ${k ? "sel-cla" : "sel-osc"}" src="${src}" width="320" height="180" alt="" loading="lazy" decoding="async" />`,
            )
            .join("")
        : "";
      return (
        `<button type="button" class="espera-juego-op${imgs ? " con-captura" : ""}${j.encaja === false ? " no-encaja" : ""}" data-game="${esc(j.game)}" aria-pressed="${j.elegido}">` +
        imgs +
        `<span class="espera-juego-nombre">${j.recomendado ? `<i aria-hidden="true">★</i> ` : ""}${esc(j.nombre)}</span>` +
        (j.recomendado ? `<span class="sr-only">, ${esc(t("recBadge"))}</span>` : "") +
        (j.rango ? `<small>${esc(rangoConUnidad(j.rango))}</small>` : "") +
        `</button>`
      );
    })
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
    // En Prueba, la sala entera ve en qué modo está el sorteo; en Oficial, nada.
    (hayModoOficial && network.name === "testnet" ? `<span class="espera-prueba">${esc(t("netTest"))}</span>` : "") +
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
    panelDeJuegosHtml(juegos, f.names.length);
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
    pararAzar();
    pararPase();
    removeEventListener("resize", ajusta);
    removeEventListener("resize", medirBarra);
    removeEventListener("keydown", tecla);
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
  /**
   * El alto de la barra de Sorprendeme y Listo, que va pegada abajo. Lo que se lleva a la vista (la tarjeta donde cae la
   * ruleta, el foco con Tab) no puede quedar debajo de ella: `scroll-padding-bottom` del panel lo toma de acá.
   */
  const medirBarra = (): void => {
    const barra = panel?.querySelector<HTMLElement>(".espera-juegos-acc");
    if (panel && barra && !panel.hidden) panel.style.setProperty("--barra", `${barra.offsetHeight + 8}px`);
  };
  // Con otro tamaño de pantalla (un proyector que se conecta, un zoom) la barra puede pasar a dos renglones.
  addEventListener("resize", medirBarra);
  /** Los juegos que cuentan tantos premios como se sortean, la misma regla del selector (`cabenLosPremios`), con su tramo de gente. */
  const catalogoDeAzar = (): JuegoAzar[] => {
    const premios = sorteo.premios();
    return sorteo
      .juegos()
      .filter((j) => cabenLosPremios(j.game as Game, premios))
      .map((j) => ({ game: j.game, rango: RANGOS[j.game as Game] ?? {} }));
  };
  const personasAhora = (): number => app.frozen?.names.length ?? 0;
  const abrirJuegos = (): void => {
    const lista = panel?.querySelector<HTMLElement>(".espera-juegos-lista");
    if (!panel || !lista) return;
    lista.innerHTML = opcionesHtml(sorteo.juegos());
    panel.hidden = false;
    // Sorprendeme solo se ofrece si hay a dónde ir. Con más de doscientas personas no cabe ningún juego, y con uno solo la
    // luz se quedaría quieta en la misma tarjeta: en los dos casos el botón no haría nada.
    const sorprender = panel.querySelector<HTMLElement>("[data-azar]");
    if (sorprender) sorprender.hidden = posiblesDe(catalogoDeAzar(), personasAhora()).length < 2;
    medirBarra();
    // El pase de inactividad vuelve a armarse cada vez que el panel abre.
    armarPase();
    for (const b of botonesJuego) b.setAttribute("aria-expanded", "true");
    const elegida = lista.querySelector<HTMLElement>('[aria-pressed="true"]');
    (elegida ?? lista.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    // Al volver a abrirlo, el juego elegido tiene que verse. Si la lista se recorre por dentro (un celular, un zoom) y el elegido
    // queda abajo, se lo lleva a la vista lo justo: `scroll-padding-bottom` evita que quede debajo de la barra.
    if (elegida && panel.scrollHeight > panel.clientHeight + 1) elegida.scrollIntoView?.({ block: "nearest" });
  };
  const cerrarJuegos = (devolverFoco = true): void => {
    if (!panel || panel.hidden) return;
    pararAzar();
    pararPase();
    panel.hidden = true;
    for (const b of botonesJuego) b.setAttribute("aria-expanded", "false");
    if (devolverFoco) botonJuego()?.focus({ preventScroll: true });
  };

  /* ------------------------------------------------------------- el azar */
  /** El temporizador de la ruleta, y si está corriendo: un toque más no la arranca de nuevo, y cerrarla la para. */
  let tAzar = 0;
  let azarCorriendo = false;
  /** Deja el panel como estaba antes de girar: sin la marca de giro ni la de llegada, y con el botón disponible. */
  const pararAzar = (): void => {
    if (tAzar) window.clearTimeout(tAzar);
    tAzar = 0;
    azarCorriendo = false;
    panel?.classList.remove("girando");
    for (const tarjeta of panel?.querySelectorAll<HTMLElement>(".espera-juego-op") ?? []) {
      delete tarjeta.dataset.enJuego;
      tarjeta.classList.remove("azar-quedo");
    }
    panel?.querySelector("[data-azar]")?.removeAttribute("aria-disabled");
  };
  /** La semilla del toque: nada de `Math.random` (el navegador trae criptografía de verdad, y es un número entero). */
  const semillaAzar = (): number => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] ?? 0;
  };
  /** El toque en Sorprendeme: elige con `azar.ts` y recorre las tarjetas. Al quedar, elige como si la hubieran tocado. */
  const alAzar = (): void => {
    if (azarCorriendo || !panel) return;
    // La ruleta manda: si el pase estaba corriendo, se corta y no se rearma hasta que ella termina.
    pararPase();
    // Las tarjetas se ordenan por su lugar en la grilla: la luz da la vuelta (arriba de izquierda a derecha, abajo de
    // derecha a izquierda) y no salta de una punta a la otra. Solo cambia el camino: el elegido sale parejo igual.
    const lista = panel.querySelector<HTMLElement>(".espera-juegos-lista");
    const tarjetas = lista ? [...lista.querySelectorAll<HTMLElement>("[data-game]")] : [];
    const tarjetaDe = (game: string | undefined): HTMLElement | null => tarjetas.find((tarjeta) => tarjeta.dataset.game === game) ?? null;
    const caja = lista?.getBoundingClientRect();
    const centro = caja ? { x: caja.left + caja.width / 2, y: caja.top + caja.height / 2 } : { x: 0, y: 0 };
    const catalogo = enRueda(catalogoDeAzar(), (j) => {
      const r = tarjetaDe(j.game)?.getBoundingClientRect();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : centro;
    }, centro);
    const posibles = posiblesDe(catalogo, personasAhora());
    if (posibles.length < 2) return;
    // El juego que ya estaba elegido no sale: caer en el mismo es como si no hubiera pasado nada.
    const azar = elegirAlAzar(catalogo, personasAhora(), semillaAzar(), sorteo.juegos().find((j) => j.elegido)?.game);
    if (!azar.elegido) return;
    const elegido = azar.elegido;
    const tarjetaElegida = tarjetaDe(elegido.game);
    const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Una lista que se recorre por dentro no muestra todas las tarjetas. Con lugar para dos filas y media o más (un celular
    // parado) la ruleta corre y la lista sigue a la luz, y la barra de abajo no la tapa (`scroll-padding-bottom`). Con menos
    // (un celular acostado, un zoom de 200 %) la luz pasaría por tarjetas que no se ven y la lista temblaría a cada paso: ahí
    // no hay ruleta, solo la marca de dónde quedó. La media fila de más es el título y la leyenda, que ocupan el alto de
    // arriba hasta que la lista se recorre.
    const seRecorre = panel.scrollHeight > panel.clientHeight + 1;
    const lugarParaTarjetas = panel.clientHeight - (panel.querySelector<HTMLElement>(".espera-juegos-acc")?.offsetHeight ?? 0);
    const pocoLugar = seRecorre && lugarParaTarjetas < 2.5 * (tarjetas[0]?.offsetHeight ?? 0);
    const sinRuleta = sinMovimiento || !tarjetas.length || pocoLugar;
    azarCorriendo = true;
    panel.querySelector("[data-azar]")?.setAttribute("aria-disabled", "true");

    /**
     * Cae en el elegido. Se elige ya, para que si el número nace ahora el show cuente el juego que la sala está viendo, y
     * la tarjeta se queda marcada un rato (`QUEDA_MS`) antes de cerrar el panel: la sala lo lee desde el fondo.
     */
    const llegar = (): void => {
      sorteo.elegirJuego(elegido.game);
      pintarNombre();
      if (!tarjetaElegida) {
        cerrarJuegos();
        return;
      }
      for (const tarjeta of tarjetas) tarjeta.setAttribute("aria-pressed", String(tarjeta === tarjetaElegida));
      tarjetaElegida.classList.add("azar-quedo");
      // Si la lista se recorre, la lleva al medio de lo que se ve: con `scroll-padding-bottom` no queda debajo de la barra.
      if (seRecorre) tarjetaElegida.scrollIntoView?.({ block: "center", behavior: sinMovimiento ? "auto" : "smooth" });
      tAzar = window.setTimeout(() => cerrarJuegos(), QUEDA_MS);
    };
    if (sinRuleta) {
      llegar();
      return;
    }

    // Mientras gira, brilla una sola tarjeta: la que estaba elegida de partida se apaga. Las que no pueden salir se ven
    // apagadas, y el botón avisa que ya está en marcha.
    for (const tarjeta of tarjetas) {
      tarjeta.setAttribute("aria-pressed", "false");
      if (posibles.some((j) => j.game === tarjeta.dataset.game)) tarjeta.dataset.enJuego = "1";
    }
    panel.classList.add("girando");
    let marcada: HTMLElement | null = null;
    const paso = (i: number): void => {
      const pasoDe = azar.recorrido[i];
      if (!pasoDe) {
        llegar();
        return;
      }
      if (marcada) marcada.setAttribute("aria-pressed", "false");
      marcada = tarjetaDe(catalogo[pasoDe.indice]?.game);
      // El resaltado es el mismo estilo de la tarjeta elegida (el CSS de `aria-pressed`). Si la lista se recorre, la lleva a
      // la vista lo justo, sin quedar debajo de la barra.
      marcada?.setAttribute("aria-pressed", "true");
      if (seRecorre) marcada?.scrollIntoView?.({ block: "nearest" });
      // En el último paso la luz cae y se queda: de ahí en adelante manda la marca de llegada.
      if (i + 1 >= azar.recorrido.length) {
        llegar();
        return;
      }
      tAzar = window.setTimeout(() => paso(i + 1), pasoDe.pausa);
    };
    paso(0);
  };
  for (const b of botonesJuego) b.addEventListener("click", () => (juegosAbiertos() ? cerrarJuegos() : abrirJuegos()));
  panel?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-game], [data-juegos-listo], [data-azar]");
    if (!b) return;
    if (b.dataset.azar !== undefined) {
      alAzar();
      return;
    }
    if (b.dataset.game) {
      // Mientras la ruleta corre, un toque en una tarjeta no corta el recorrido.
      if (azarCorriendo) return;
      sorteo.elegirJuego(b.dataset.game);
      pintarNombre();
    }
    cerrarJuegos();
  });

  /* ------------------------------------------------------------- el pase */
  /**
   * El pase de tarjetas cuando nadie toca el panel (~6 s de inactividad): la
   * tarjeta marcada se va "hacia atrás" y la siguiente aparece adelante, en
   * bucle suave de ~1,5 s por paso. El primer toque o movimiento lo corta y el
   * panel vuelve al estado normal. Es decoración de atención: no toca
   * `aria-pressed` (esa es la elección de verdad) ni decide nada del sorteo, y
   * con la ruleta de Al azar corriendo no arranca — la de ella manda.
   */
  const PASE_TRAS = 6000;
  const PASE_PASO = 1500;
  let tPase = 0;
  let tPasePaso = 0;
  let paseIndice = 0;
  const tarjetasPase = (): HTMLElement[] => (panel ? [...panel.querySelectorAll<HTMLElement>("[data-game]")] : []);
  /** Corta el pase: sin temporizadores colgados ni marcas puestas. */
  const pararPase = (): void => {
    if (tPase) window.clearTimeout(tPase);
    if (tPasePaso) window.clearTimeout(tPasePaso);
    tPase = 0;
    tPasePaso = 0;
    panel?.classList.remove("pase");
    for (const t of tarjetasPase()) t.classList.remove("pase-viva", "pase-atras");
  };
  /** La tarjeta `i` adelante y la anterior yéndose hacia atrás: el bucle da la vuelta sola. */
  const marcarPase = (i: number): void => {
    const tarjetas = tarjetasPase();
    for (const t of tarjetas) t.classList.remove("pase-viva", "pase-atras");
    const viva = tarjetas[i % Math.max(1, tarjetas.length)];
    viva?.classList.add("pase-viva");
    tarjetas[(i + tarjetas.length - 1) % Math.max(1, tarjetas.length)]?.classList.add("pase-atras");
  };
  const pasoPase = (i: number): void => {
    paseIndice = i;
    marcarPase(i);
    tPasePaso = window.setTimeout(() => pasoPase(i + 1), PASE_PASO);
  };
  const entrarEnPase = (): void => {
    if (!panel || panel.hidden || azarCorriendo || tarjetasPase().length < 2) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    panel.classList.add("pase");
    pasoPase(paseIndice % Math.max(1, tarjetasPase().length));
  };
  /** Rearma la espera del pase: solo con el panel abierto y sin ruleta corriendo. */
  const armarPase = (): void => {
    if (tPase) window.clearTimeout(tPase);
    tPase = 0;
    if (azarCorriendo || !panel || panel.hidden) return;
    tPase = window.setTimeout(entrarEnPase, PASE_TRAS);
  };
  // Un toque o movimiento dentro del panel corta el pase y rearma la espera.
  const alToqueEnPanel = (): void => {
    pararPase();
    armarPase();
  };
  for (const tipo of ["pointermove", "pointerdown", "keydown", "wheel", "click", "focusin"] as const)
    panel?.addEventListener(tipo, alToqueEnPanel, { passive: true });

  const tecla = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    // Con la lista de juegos abierta, Escape la cierra a ella y no a la espera.
    if (juegosAbiertos()) cerrarJuegos();
    else salir();
  };
  // Con la pantalla completa, Escape la suelta el navegador y la página no se
  // entera de la tecla. Hasta el 13 de noviembre de 2026 salir de ella cerraba la
  // espera y la marcaba como rechazada, y el sorteo ya no arrancaba solo. Pero la
  // pantalla completa también la suelta Windows al cambiar de proyector, sin que
  // nadie lo pida: ahora la espera se queda arriba como capa. La cierran un
  // segundo Escape y "Volver a la página".
  addEventListener("keydown", tecla);
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
  const accion = (a: Fase, texto: string, boton: string, hacer = sortear, segunda?: AccionError): void => {
    pasar(a, `<p class="espera-motivo" role="${a === "fallo" ? "alert" : "status"}">${esc(texto)}</p><button class="primary espera-accion" type="button">${esc(boton)}</button>${segunda ? `<button class="ghost mini espera-accion-2" type="button">${esc(segunda.texto)}</button>` : ""}`);
    const b = sigue?.querySelector<HTMLButtonElement>(".espera-accion");
    // La segunda salida deja anotado el cambio y sigue por el mismo camino que la principal.
    if (segunda) {
      sigue?.querySelector<HTMLButtonElement>(".espera-accion-2")?.addEventListener("click", () => {
        segunda.ejecutar();
        hacer();
      });
    }
    b?.addEventListener("click", hacer);
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
    const evento = e as EventoError;
    accion("fallo", String(evento.detail ?? ""), evento.accion?.texto ?? t("drawRetry"), evento.accion?.ejecutar ?? sortear, evento.segunda);
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
      // Con Freighter la persona aprueba el sorteo en su ventana. Con Pollar (o la cuenta de prueba) no hay otra
      // aprobación: el clic en "Sellar la lista" ya cubre el sorteo de esa lista y se lanza solo cuando nace la ronda.
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
