import { $ } from "../dom";
import { T, getLang, onLangChange, t } from "../i18n";
import { ANCHOR_LEAD_SECONDS, LEAD_SECONDS, SIN_SELLO_LEAD_SECONDS, WHEEL_MAX, app, currentPace, paceSeconds, params, type Game } from "../state";
import { QUICKNET, bytesToHex, roundTime, targetRound } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { prepararFirma } from "../protocol/firma";
import { esCostoAlto } from "../stellar/chequeo-red";
import { contractUrl, hayModoOficial, modeNameKey, network } from "../stellar/config";
import { anotar } from "../stellar/registro-red";
import { pideProtegerLaCuenta, protegerLaCuenta } from "./proteger-flujo";
import { type AnchorStep, clienteListo, cuentaPatrocinada, escribirError, hideTxStatus, margenParaAprobar, pagaElPortero, precargarParaElSorteo, resolverSelloEnLaRed, sealOnChain, selloSinGrabar, showTxStatus, stepLabel } from "./anchor";
import { precargarQr } from "./qr";
import { juegoPorDefecto, juegoSiguiente, rangoParaLeer, rangoVisible, recomendar } from "./recomendar";
import { entornoDeAhora, grandeAlSellar } from "./vista-grande";
import { pedirPantallaCompleta, soltarPantallaCompleta } from "./pantalla-completa";
import type { OpcionDeJuego } from "./espera";
import { apruebaAMano, billeteraEnOtraRed, canAnchor, claveDeSellar, currentSession, frenarPorOtraRed } from "./wallet-ui";
import { cerrarLista, olvidarBorrador, parseNames, setList } from "./participants";
import { contar as contarPersonas, cuentaParaMostrar, renumerarSufijos, seCuentaPorPersona } from "../participaciones";
import { modesVisible } from "../modos/bandera";
import { preloadGame } from "../games/engine";
import { claveNombre } from "./gamecard";
import { JUEGOS } from "../games/pixi/kit/catalogo";
import { actualizarPaso, barraActiva, verError } from "./siguiente";
import { ponerPremio, recordarPremio } from "./premios";
import { ganadoresPedidos, ponerGanadores } from "./ganadores";
import { isTurnOrder } from "../modos/turnos";
import { ajustarPremioDeTurnos, ordenNoCabe } from "./turnos";
import { ENSAYO_ESPERA_S, STAND_ESPERA_S, enEnsayo, enStand, sinGrabar } from "../ensayo-modo";
import { sinCuentaElegido } from "./sin-cuenta";
import { logoParaSellar } from "../logo-guardado";
import { contar, errorContable, origenActual } from "../contar";
import { type OpcionesDeSellado, chequearAntesDeSellar, hayAccionDeRed, limpiarRed, marcarSellado, mostrarCostoAlto, mostrarSinPatrocinio, mostrarSinSaldo, patrocinioDelError, verLaRedTrasFallar, verSinSello } from "./red";
import { type Reintento, reintentarSello } from "./sin-sello";
import { claveDelSello, ponerTextoDelSello, sinSelloAhora } from "./sin-sello-textos";
import { pintarVer3D } from "./ver3d";
import { confirmarPrimerSelloOficial, marcarSellandoAhora } from "./modo-ui";
import { frenarSinElPaso } from "./aviso-no-cargo";
import { cobroPorUso } from "../stellar/cobro-oficial";

/**
 * Los botones del selector, en el orden en que se muestran. Hasta el 29 de
 * septiembre de 2026 esta lista tenía solo los ocho primeros, y los botones
 * del trompo, las balsas, la piñata y Oruro no hacían nada: solo se llegaba a
 * ellos con `?demo=`, que es lo que usan los auditores.
 *
 * Desde el 21 de octubre de 2026 eran diez: entró El Trueque y salieron el
 * Aguayo y la Constelación, que se fundieron en él (la tómbola había salido el
 * 20). Desde el 26 quedan ocho en el selector: De pie y El Trueque salieron, y
 * sus botones siguen en esta lista y en `index.html`, ocultos (`hidden`), para que
 * `?demo=` y los auditores los encuentren. Van en el orden de la auditoría de
 * juegos, de las salas chicas a las grandes; con la lista sellada los reordena la
 * recomendación (`recomendar.ts`). Los que salen siguen abriendo con `?demo=`.
 */
const BOTONES_DEL_SELECTOR: ReadonlyArray<[string, Game]> = [
  ["g-race", "race"],
  ["g-sapo", "sapo"],
  ["g-trompo", "trompo"],
  ["g-chovena", "chovena"],
  ["g-pinata", "pinata"],
  ["g-wheel", "wheel"],
  ["g-quien", "quien"],
  ["g-trueque", "trueque"],
  ["g-teleferico", "teleferico"],
  ["g-oruro", "oruro"],
];

/**
 * Los diez y, al final, los del kit que ya se encendieron (`selector: true` en
 * `kit/catalogo.ts`). Los que nacieron apagados tienen su botón oculto
 * (`ui/botones-kit.ts`) y no entran acá: nadie los puede elegir.
 */
export const GAME_BUTTONS: ReadonlyArray<[string, Game]> = [
  ...BOTONES_DEL_SELECTOR,
  ...JUEGOS.filter((j) => j.selector && !BOTONES_DEL_SELECTOR.some(([, g]) => g === j.id)).map((j): [string, Game] => [`g-${j.id}`, j.id]),
];

/** Quien organiza eligió un juego en el selector: desde ahí, el juego no cambia solo según la cantidad. */
let juegoAMano = false;

/**
 * Con "Siguiente premio", el juego que se acaba de jugar: al sellar la lista que
 * queda, se sugiere otro que encaje, sin pedirle nada a quien organiza.
 */
let juegoAnterior: Game | null = null;

/** Lo llama "Siguiente premio": el próximo sello sugiere otro juego (`juegoSiguiente`). */
export function rotarJuego(): void {
  juegoAnterior = app.game;
  juegoAMano = false;
}

/**
 * Después del resultado, un toque en el selector vuelve a mostrar ese mismo resultado con el juego tocado
 * (`draw.ts`, `verDeNuevo`). Se registra desde `draw.ts`: este archivo no lo importa.
 */
let alElegirConResultado: ((g: Game) => void) | null = null;
export function alElegirDespuesDelResultado(f: (g: Game) => void): void {
  alElegirConResultado = f;
}

/** Un toque en el selector: el juego que se eligió, y que ya no se cambia solo. */
export function elegirJuego(g: Game): void {
  // Ya hay resultado: el juego no cambia lo que salió, solo cómo se ve. Se vuelve a ver con el juego tocado,
  // salvo mientras corre el show (el selector está apagado y dice por qué: `marcarShow`).
  if (app.drawn) {
    if (!enShow) alElegirConResultado?.(g);
    return;
  }
  juegoAMano = true;
  setGame(g);
}

/** Pone el juego en el selector y en el rótulo de junto al botón, sin mirar si ya hay resultado. */
function marcarJuego(g: Game): void {
  app.game = g;
  for (const [id, key] of GAME_BUTTONS) $(id).classList.toggle("on", g === key);
  pintarJuego();
}

export function setGame(g: Game): void {
  if (app.drawn) return;
  marcarJuego(g);
  // Si ya está congelada, la cuenta regresiva corre: se baja el juego nuevo.
  if (app.frozen) preloadGame(g, app.frozen.names.length);
}

/**
 * "Ver de nuevo con otro juego": el resultado ya está, y el juego elegido cambia solo cómo se vuelve a ver. No
 * toca `juegoAMano`: el próximo sorteo sigue sugiriendo el juego que encaje.
 */
export function juegoParaVerDeNuevo(g: Game): void {
  marcarJuego(g);
  if (app.frozen) preloadGame(g, app.frozen.names.length);
}

/** El show está corriendo: el selector no se toca (es un show) y dice por qué. */
let enShow = false;

/**
 * Se llama al arrancar el show y al terminar. Mientras corre, el selector se apaga (`inert`: ni el ratón ni el
 * teclado) y la nota de arriba lo explica; al terminar se enciende, y si ya hay resultado dice cómo verlo de nuevo.
 */
export function marcarShow(en: boolean): void {
  enShow = en;
  document.body.toggleAttribute("data-show", en);
  document.getElementById("gamepick")?.toggleAttribute("inert", en);
  pintarNotaDelJuego();
}

/**
 * La nota de arriba del selector, solo cuando el selector no es el de siempre: mientras corre el show ("no se
 * cambia") y con el resultado puesto ("tocá un juego y lo ves de nuevo"). Antes del sorteo no dice nada: elegir es
 * lo normal.
 */
export function pintarNotaDelJuego(): void {
  const el = document.getElementById("juego-nota");
  if (!el) return;
  const clave = enShow ? "juegoEnShow" : app.drawn ? "juegoVerDeNuevo" : "";
  const texto = clave ? t(clave) : "";
  if (el.textContent !== texto) el.textContent = texto;
  el.hidden = !texto;
}

/**
 * Lleva al selector y deja el foco en el primer juego que no es el de ahora, para verlo de nuevo con otro: "Probar
 * otro juego" y "Ver de nuevo con otro juego".
 */
export function irAlSelectorParaOtro(): void {
  const nota = document.getElementById("juego-nota");
  // Con la nota puesta ("tocá un juego…"), se lleva ella a la vista y el selector queda debajo, entero; si no, como "Cambiar de juego".
  if (nota && !nota.hidden) {
    const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    nota.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
  } else cambiarJuego();
  const otro = GAME_BUTTONS.map(([id]) => document.getElementById(id) as HTMLButtonElement | null).find((b) => b && !b.hidden && !b.classList.contains("on"));
  otro?.focus({ preventScroll: true });
}

/**
 * El juego elegido, con su nombre, junto al botón de sortear: se ve sin bajar
 * hasta el selector. Lee el nombre del botón del selector, que es el que
 * traduce `data-i`; los juegos que ya no tienen botón (los que siguen
 * abriendo con `?demo=`) salen con el nombre de su tarjeta.
 */
export function pintarJuego(): void {
  const el = document.getElementById("juego-actual");
  if (!el) return;
  const nombre = document.querySelector(`#g-${app.game} span`)?.textContent || t(claveNombre(app.game));
  if (el.textContent !== nombre) el.textContent = nombre;
  pintarNotaElegida();
  pintarNotaDelJuego();
  pintarVer3D();
}

/**
 * La nota de por qué el juego elegido encaja o no con esta cantidad de gente,
 * en una línea legible bajo el selector. Las notas de cada botón se quedan para
 * el lector de pantalla: a 11 px dentro de una tarjeta de 132 no las leía nadie
 * (letra grande, 24 de octubre de 2026).
 */
function pintarNotaElegida(): void {
  const el = document.getElementById("rec-sel-nota");
  if (!el) return;
  const nota = document.querySelector(`#g-${app.game} .rec-nota`)?.textContent ?? "";
  if (el.textContent !== nota) el.textContent = nota;
}
// Al cambiar de idioma los botones del selector ya están traducidos: se lee de ahí.
onLangChange(pintarJuego);

/** Una frase del diccionario. Las que llevan números son funciones: se les pasan los argumentos. */
function frase(clave: string, args: readonly number[] = []): string {
  const v = T[getLang()][clave];
  if (typeof v === "function") return (v as (...a: number[]) => string)(...args);
  return typeof v === "string" ? v : clave;
}

/**
 * El selector recomienda según la cantidad de personas de la lista (auditoría
 * de juegos, sección 8.1). Los que encajan van primero, con su etiqueta y una
 * nota corta de por qué. Los que no encajan se atenúan, pero siguen tocables y
 * dicen por qué. Los que no tienen rango claro quedan como estaban. Reordena
 * los botones: no oculta ninguno, y el que estaba elegido sigue elegido.
 * El selector solo se ve con la lista sellada (`sec-frozen`), así que se pinta
 * al sellar y de nuevo al cambiar de idioma o de ritmo.
 */
/** Cuántos premios se sortean: el campo de "Cuántos ganan", que con la lista sellada ya no cambia. */
const premiosElegidos = (): number => ganadoresPedidos();

export function pintarRecomendacion(names: readonly string[]): void {
  const n = names.length;
  const botones = new Map<Game, HTMLElement>();
  for (const [id, g] of GAME_BUTTONS) {
    const el = document.getElementById(id);
    if (el) botones.set(g, el);
  }
  const gp = $("gamepick");
  // Un orden de turnos no tiene premios: las notas de capacidad dicen turnos. Se decide como en el resto de
  // la pantalla, por la lista sellada y su nombre; antes de sellar vale el nombre del campo.
  const premio = app.frozen?.prize ?? (document.getElementById("prize") as HTMLInputElement | null)?.value ?? "";
  const turnos = isTurnOrder(n, premiosElegidos(), premio);
  recomendar(n, premiosElegidos(), turnos).games.forEach((r, i) => {
    const el = botones.get(r.game);
    if (!el) return;
    // Cada botón va a su lugar en el orden de la recomendación; se mueve solo el que está fuera de sitio.
    if (gp.children[i] !== el) gp.insertBefore(el, gp.children[i] ?? null);
    el.classList.toggle("atenuado", r.fits === false);
    el.querySelectorAll(":scope > .rec-tag, :scope > .rec-nota, :scope > .rec-rango").forEach((x) => x.remove());
    if (r.fits === true) {
      const etiqueta = document.createElement("em");
      etiqueta.className = "rec-tag";
      // Una estrella a la vista; la palabra, para el lector de pantalla.
      etiqueta.textContent = "★";
      etiqueta.setAttribute("aria-label", t("recBadge"));
      etiqueta.title = t("recBadge");
      el.appendChild(etiqueta);
    }
    // El rango de personas, a la vista: miniatura, nombre y rango (regla de letra, 26 de octubre de 2026).
    const rango = rangoVisible(r.game);
    if (rango) {
      const em = document.createElement("em");
      em.className = "rec-rango";
      em.textContent = rango;
      em.setAttribute("aria-label", rangoParaLeer(rango, t("recRangoAria"), t("recRangoUnion")));
      el.appendChild(em);
    }
    if (r.note) {
      const nota = document.createElement("small");
      nota.className = "rec-nota sr-only";
      nota.textContent = frase(r.note, r.args);
      el.appendChild(nota);
    }
  });
  pintarCabecera(names);
  pintarNotaElegida();
}

/**
 * La línea de arriba del selector: "Para 8 personas. Duración: Normal, 41 s".
 * La duración es la del show con el ritmo elegido, que hoy es la misma para
 * cualquier cantidad (la de la sección 8.2 no se muestra todavía: ver el informe).
 *
 * Con varias participaciones dice las dos cuentas ("Para 4 personas, 7 participaciones"), con la misma regla que el
 * resto de la pantalla: en un orden de turnos repartido las líneas son turnos. Sin reparto, como siempre. La
 * recomendación de juegos sigue contando líneas, como antes.
 */
export function pintarCabecera(names: readonly string[]): void {
  const el = document.getElementById("rec-head");
  if (!el) return;
  const p = currentPace();
  const nombre = t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
  const n = names.length;
  const { personas } = contarPersonas(names, seCuentaPorPersona(names, modesVisible()));
  const premio = app.frozen?.prize ?? (document.getElementById("prize") as HTMLInputElement | null)?.value ?? "";
  const turnos = isTurnOrder(n, premiosElegidos(), premio);
  const cabeza = personas === n ? frase("recHead", [n]) : turnos ? frase("recHeadTurnos", [personas, n]) : frase("recHeadPart", [personas, n]);
  el.textContent = `${cabeza}. ${t("paceLabel")}: ${nombre}, ${paceSeconds(p)} s`;
  el.style.display = "";
}

/**
 * Rehace la recomendación con la lista sellada: al cambiar de idioma o de
 * ritmo, que son los textos y la duración que se ven. Sin lista sellada no hay
 * selector visible, y no hace nada.
 */
export function refrescarRecomendacion(): void {
  if (app.frozen) pintarRecomendacion(app.frozen.names);
}
onLangChange(refrescarRecomendacion);

/**
 * "Cambiar de juego": lleva al selector, que está debajo, y deja el foco en el
 * juego elegido para seguir con las flechas y el Tab.
 */
export function cambiarJuego(): void {
  const grilla = $("gamepick");
  const reducido = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  grilla.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "center" });
  document.getElementById(`g-${app.game}`)?.focus({ preventScroll: true });
}

/**
 * Segundos que faltan para poder sortear.
 *
 * Para un sorteo anclado se esperan unos segundos de más. El contrato compara
 * la hora de la ronda contra la **hora de cierre del ledger**, que va detrás
 * del reloj del navegador porque un ledger cierra cada cinco segundos. Sin ese
 * margen hay una ventana en la que acá ya es hora, para la cadena todavía no,
 * y la transacción se cae delante de toda la sala.
 */
const CHAIN_MARGIN_SECONDS = 8;

export function secondsToRound(): number {
  if (!app.frozen) return 0;
  // El modo stand no espera ningún número: la ronda arranca a los 3 s de empezar, sin tocar la red.
  if (enStand()) return Math.max(0, app.frozen.ts + STAND_ESPERA_S - Math.floor(Date.now() / 1000));
  const margin = app.frozen.raffleId !== undefined ? CHAIN_MARGIN_SECONDS : 0;
  return Math.max(0, roundTime(app.frozen.round) + margin - Math.floor(Date.now() / 1000));
}

let countdownTimer: number | undefined;
/** La ronda de stand ya arrancó sola: una sola vez por cuenta regresiva. */
let arrancoSola = false;

/**
 * Se apretó "Sellar la lista" con la pantalla en grande pedida (`vista-grande.ts`): cuando el sello esté, la
 * espera en grande se abre sola. Vive solo mientras se sella: si no se selló, no queda pedido, y retomar un
 * sorteo desde Mis sorteos no abre nada por su cuenta.
 */
let grandePendiente = false;

/** La espera en grande, ya bajada: la cuenta regresiva le avisa cuando nace el número. */
let espera: typeof import("./espera") | null = null;

/** El nombre de un juego, el que se lee en su botón del selector (que traduce `data-i`). */
const nombreDeJuego = (g: Game): string => document.querySelector(`#g-${g} span`)?.textContent || t(claveNombre(g));

/**
 * Los juegos que se pueden elegir desde la espera en grande: los del selector, en el orden en que los recomienda
 * esta cantidad de gente, sin los que no aplican (la ruleta con más de doscientos) ni los que ya no están en el selector.
 */
function juegosParaElegir(): OpcionDeJuego[] {
  const f = app.frozen;
  if (!f) return [];
  return recomendar(f.names.length)
    .games.filter((r) => {
      const b = document.getElementById(`g-${r.game}`) as HTMLButtonElement | null;
      return !!b && !b.hidden && !b.disabled;
    })
    .map((r) => ({
      game: r.game,
      nombre: nombreDeJuego(r.game),
      rango: rangoVisible(r.game) ?? "",
      recomendado: r.fits === true,
      elegido: r.game === app.game,
      // Con esta cantidad de gente no encaja (el trompo con 18, La Entrada con 18): la tarjeta se ve apagada.
      encaja: r.fits !== false,
    }));
}

/**
 * La espera en grande (`espera.ts`), que se baja recién cuando hace falta.
 *
 * Se abre de dos maneras. Al sellar (`alSellar`): el propio sello la abre cuando está listo, con la pantalla
 * completa ya pedida en el clic de "Sellar la lista" (`freeze`), que es el gesto que el navegador exige: pedirla acá,
 * después de esperar al sello, ya no la concedería (26 de octubre de 2026). Y a mano, con "Mostrar la espera en
 * grande" (pedido del 17 de octubre de 2026: el "¡Contemos juntos!" y el "¡Nació!" de la primera versión no le
 * gustaron y salieron; esto es otra cosa): ese toque es el gesto, y vuelve a valer lo que la persona había soltado.
 *
 * Desde el 21 de octubre de 2026 desemboca en el show: si sigue abierta cuando nace el número, el sorteo arranca
 * solo. El show hereda la pantalla completa: bajar la espera puede tardar más de lo que dura el permiso.
 */
function abrirEspera(alSellar = false): void {
  const pedida = !alSellar && pedirPantallaCompleta({ aMano: true }) === "pedida";
  void import("./espera").then((m) => {
    espera = m;
    const abrio = m.mostrarEspera(secondsToRound, {
      sortear: () => $<HTMLButtonElement>("btn-draw").click(),
      // Sin la cadena no hay nada que aprobar; con Freighter, cada operación se aprueba en su ventana.
      aMano: () => app.frozen?.raffleId !== undefined && apruebaAMano(),
      graba: app.frozen?.raffleId !== undefined,
      juegos: juegosParaElegir,
      elegirJuego: (g) => elegirJuego(g as Game),
      premios: premiosElegidos,
      alSellar,
    });
    // Llegó tarde (el número ya nació): la pantalla completa que se pidió para ella se suelta.
    if (!abrio && (pedida || alSellar)) soltarPantallaCompleta();
  });
}

/**
 * Abre la conexión con drand poco antes de que nazca la ronda.
 *
 * Conectarse con el relay (DNS, TCP y TLS) son tres o cuatro idas y vueltas:
 * en un celular con 4G, medio segundo o más justo cuando la sala mira la
 * pantalla esperando. El navegador la deja lista. Cierra una conexión ociosa a
 * los pocos segundos, así que no se pide al sellar sino cinco segundos antes,
 * y otra vez cuando la ronda ya nació y el botón se habilita.
 */
function preconectarDrand(): void {
  if (enStand()) return;
  const href = QUICKNET.relays[0];
  document.head.querySelector(`link[rel="preconnect"][href="${href}"]`)?.remove();
  const link = document.createElement("link");
  link.rel = "preconnect";
  link.href = href;
  // `fetch` pide la ronda sin credenciales: la conexión tiene que ser la anónima.
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
}

/**
 * El botón de sortear muestra la cuenta regresiva y se habilita cuando la
 * ronda existe. Y arriba, el panel que pone la espera en escena.
 *
 * Esos segundos son el corazón del producto: la lista ya está cerrada y el
 * número que la va a decidir **todavía no existe**. Es el único momento en que
 * esto es distinto de cualquier ruleta, y vivía como una etiqueta chica en un
 * botón gris, en silencio. Ahora se ve el número de la ronda que falta nacer y
 * los segundos que le quedan.
 */
function startCountdown(): void {
  arrancoSola = false;
  const btn = $<HTMLButtonElement>("btn-draw");
  const box = document.getElementById("wait-box");
  const num = document.getElementById("wait-round");
  const left = document.getElementById("wait-left");
  // El "Ya se sorteó" del sorteo anterior (draw.ts) no sigue: ahora escribe la cuenta.
  if (left) delete left.dataset.i;
  const line = box?.querySelector(".wait-line");
  const grande = document.getElementById("btn-espera");
  if (grande) {
    grande.onclick = () => abrirEspera();
    grande.style.display = "";
  }
  // Se apretó "Sellar la lista" con la pantalla en grande pedida: la espera se abre sola, con "Volver" a mano
  // (`vista-grande.ts`). La pantalla completa ya se pidió en ese clic; esto es solo la vista.
  if (app.frozen && grandePendiente) {
    grandePendiente = false;
    abrirEspera(true);
  }
  if (num && app.frozen) num.textContent = `#${app.frozen.round}`;
  // La conexión está ociosa hasta que nazca la ronda: se baja el motor, y se
  // levanta el worker que va a verificar la firma (la portada no lo carga).
  // Anclado, también la curva en la página: el contrato pide la firma
  // descomprimida.
  if (app.frozen) preloadGame(app.game, app.frozen.names.length);
  // El modo stand no pide ni verifica ningún número: nada que preparar ni conexión que abrir.
  if (!enStand()) prepararFirma();
  if (app.frozen?.raffleId !== undefined) void import("../protocol/drand").catch(() => undefined);
  let preconectado = false;
  const tick = (): void => {
    const s = secondsToRound();
    if (s > 0) {
      if (s <= 5 && !preconectado) {
        preconectado = true;
        preconectarDrand();
      }
      btn.disabled = true;
      btn.classList.remove("lista");
      const reloj = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      // El modo stand no espera ningún número: «Arranca en 3».
      btn.textContent = enStand() ? t("standArranca").replace("{s}", String(s)) : T[getLang()].drawIn(reloj);
      // Sin `block` en línea: el CSS decide cómo se ve la caja de la espera.
      if (box) box.style.display = "";
      if (left) left.textContent = reloj;
      // Sin sello no dice "nadie puede elegirlo" como si hubiera algo sellado: dice que no se puede comprobar.
      if (line) line.textContent = t(claveDelSello("lineaDeLaEspera", sinSelloAhora(app.frozen)));
    } else {
      btn.disabled = !!app.drawn;
      btn.textContent = t("draw");
      // Se enciende con un pulso suave (que se apaga con `prefers-reduced-motion`)
      // hasta que alguien lo apriete: es lo único que hay que hacer ahora.
      btn.classList.toggle("lista", !app.drawn);
      // El panel no desaparece de golpe: dice que la ronda ya nació, que es la
      // otra mitad de la idea.
      if (left) left.textContent = t("waitNow");
      if (line) line.textContent = "";
      if (grande) grande.style.display = "none";
      if (countdownTimer !== undefined) clearInterval(countdownTimer);
      countdownTimer = undefined;
      if (!app.drawn) preconectarDrand();
      // Ya nació: el botón, con el foco y, si quedó fuera de la pantalla, a la
      // vista (revisión del 16 de octubre de 2026: quedaba una pantalla más
      // abajo, y dos en el celular). Con la barra de "lo que sigue" no hace
      // falta mover la pantalla: quien estaba mirando los juegos sigue ahí, y
      // la barra ya le muestra el botón encendido.
      // Con la espera en grande abierta, en cambio, el sorteo arranca desde
      // ahí y el show ocupa la pantalla sin pasar por la página (espera.ts).
      if (!app.drawn && enStand()) {
        // Una ronda de stand arranca sola: quien atiende no tiene que estar sobre el botón.
        if (!arrancoSola) {
          arrancoSola = true;
          btn.click();
        }
      } else if (!app.drawn && espera?.esperaAbierta()) espera.nacioElNumero();
      else if (!app.drawn) {
        const r = btn.getBoundingClientRect();
        if (!barraActiva() && (r.top < 0 || r.bottom > innerHeight)) btn.scrollIntoView({ behavior: "smooth", block: "center" });
        btn.focus({ preventScroll: true });
      }
    }
  };
  tick();
  countdownTimer = window.setInterval(tick, 250);
}

/**
 * El botón se llama "Sellar la lista", con cuenta y sin ella, como el paso 2
 * ("Sellar"). Hasta el 21 de octubre de 2026 decía "Sellar en Stellar" con
 * cuenta: dos nombres para lo mismo (evaluación crítica de experiencia,
 * hallazgo 9). Con data-i, el cambio de idioma lo traduce.
 */
export function refreshFreezeLabel(): void {
  // La línea del modo va debajo del botón de sellar, en los dos modos, solo cuando existe el modo Oficial. Dice lo
  // mismo que hace `sellar()`: el Ensayo y la demo no graban nada, así que no la llevan; y con la billetera en la otra
  // red, en vez de prometer el registro dice que así no se puede sellar (el botón frena con el aviso de cómo seguir).
  const lineaModo = document.getElementById("sellar-modo");
  if (lineaModo) {
    // Quien siguió sin cuenta (plan B del ingreso) tampoco la ve: no hay nada que se registre, y su propia línea lo dice.
    const verLinea = hayModoOficial && !sinGrabar() && !sinCuentaElegido();
    lineaModo.textContent = !verLinea
      ? ""
      : billeteraEnOtraRed()
        ? t("sealModeOtraRed").replace("{modo}", t(modeNameKey(network.name)))
        : t(network.name === "mainnet" ? "sealModeOfficial" : "sealModeTest");
    lineaModo.style.display = verLinea ? "" : "none";
  }
  if (app.frozen) return;
  // Si la red no deja sellar, el botón lleva la acción del caso (`red.ts`): no se pisa.
  if (hayAccionDeRed()) return;
  const btn = $("btn-freeze");
  btn.dataset.i = enStand() ? "standEmpezar" : claveDeSellar();
  btn.textContent = t(btn.dataset.i);
}

/** Cuándo se soltó el último sorteo para armar el siguiente (`unfreeze`), y cuánto no responde "Sellar" después. */
let soltadoEn = -Infinity;
export const GUARDA_DESPUES_DE_SOLTAR_MS = 700;
/** Hay un `freeze()` en curso: otro toque de "Sellar la lista" no hace nada hasta que termine (ver `freeze`). */
let sellandoYa = false;

/**
 * Sella la lista.
 *
 * Con wallet conectada el sello va al contrato en Stellar, que deja constancia
 * pública con fecha. Sin wallet, el sello se calcula en el navegador: el
 * sorteo sigue siendo verificable, pero nadie atestigua que la lista se cerró
 * antes de que existiera la semilla.
 */
export async function freeze(opciones: OpcionesDeSellado = {}): Promise<void> {
  // Un toque mientras otro sigue en curso no hace nada. Con el modo Oficial, antes de apagar el botón se le pregunta la
  // red a la billetera, y un doble toque en ese momento sellaba dos veces la misma lista (y el segundo, al terminar,
  // soltaba el bloqueo del cambio de modo mientras el primero seguía sellando).
  if (sellandoYa) return;
  sellandoYa = true;
  try {
    // El clic de "Sellar la lista" es el gesto que el navegador exige para la pantalla completa: se pide acá,
    // sincrónica y antes de cualquier `await` (la firma con Pollar o con Freighter abre después, y para entonces
    // el gesto ya no vale). Si la niega o no la ofrece (el iPhone), la vista grande se abre igual cuando el sello
    // esté. En el ensayo no (4 de noviembre de 2026): ahí se prueba, y la página hace falta para elegir y cambiar de
    // juego mientras llega el número; "Mostrar la espera en grande" queda a mano. Sin gesto (la red volvió sola, la demo), solo la vista.
    if (puedeSellar() && !enStand() && !enEnsayo() && grandeAlSellar(entornoDeAhora())) {
      pedirPantallaCompleta();
      grandePendiente = true;
    }
    await sellar(opciones);
  } finally {
    // Si no se selló (un error, la red, un clic de más), no queda nada pedido para la próxima lista.
    grandePendiente = false;
    // Terminó de sellar, bien o mal: el cambio de modo ya no lo espera (`modo-ui.ts`). Si quedó sellado, lo bloquea el sorteo.
    marcarSellandoAhora(false);
    sellandoYa = false;
  }
}

/** Hay con qué sellar ahora: dos personas distintas o más, y no se acaba de soltar el sorteo anterior. */
function puedeSellar(): boolean {
  // Recién se soltó el sorteo anterior con "Siguiente premio": un doble toque
  // nervioso caía en "Sellar la lista" y sellaba el próximo premio sin premio,
  // para siempre (diseño del onboarding, 22 de octubre de 2026).
  const names = parseNames();
  // Dos personas distintas: una lista repartida puede tener muchas líneas de una sola. Sin la bandera de los
  // modos ni `?modo=`, la lista es la de siempre: cada línea, una persona.
  const personas = contarPersonas(names, modesVisible()).personas;
  // En el modo «Orden de turnos», si la lista pasa de lo que admite la red no se sella: un orden incompleto no es un orden.
  return personas >= 2 && !ordenNoCabe(names.length) && performance.now() - soltadoEn >= GUARDA_DESPUES_DE_SOLTAR_MS;
}

/**
 * Con los modos a la vista, a quien quedó con números que no cierran (se borró a mano una línea de su reparto) se lo
 * vuelve a numerar justo antes de sellar: lo sellado y la cuenta del panel dicen lo mismo. Se hace al sellar y no al
 * escribir, para que el cursor no se mueva mientras la persona escribe.
 */
function renumerarLaLista(): void {
  if (!modesVisible()) return;
  const ta = document.getElementById("ta") as HTMLTextAreaElement | null;
  if (!ta) return;
  const nuevo = renumerarSufijos(ta.value);
  if (nuevo !== ta.value) setList(nuevo, false);
}

/**
 * La compuerta del sello en modo Oficial. Mientras se revisa la cuenta (hasta 4 segundos), el botón queda apagado y dice
 * «Revisando tu cuenta…». Si el paso se abre, suelta la pantalla completa que pidió el toque; su botón del final la
 * vuelve a pedir dentro de su propio toque, con la misma condición que «Sellar la lista».
 */
async function cuentaListaParaSellar(btn: HTMLButtonElement): Promise<boolean> {
  let cuentaListaParaGrabar: typeof import("./cuenta-lista-flujo").cuentaListaParaGrabar;
  try {
    ({ cuentaListaParaGrabar } = await import("./cuenta-lista-flujo"));
  } catch {
    // No bajó: con una cuenta de Google o de correo no se sella en Oficial, pero el botón no queda callado.
    return !(await frenarSinElPaso());
  }
  return cuentaListaParaGrabar("sello", {
    volverA: btn,
    alRevisar: (revisando) => {
      btn.disabled = revisando;
      if (revisando) btn.textContent = t("clRevisando");
      else {
        btn.dataset.i = claveDeSellar();
        btn.textContent = t(btn.dataset.i);
      }
    },
    alAbrir: () => {
      if (grandePendiente) soltarPantallaCompleta();
      grandePendiente = false;
    },
    alSeguir: () => {
      if (puedeSellar() && !enStand() && !enEnsayo() && grandeAlSellar(entornoDeAhora())) {
        pedirPantallaCompleta();
        grandePendiente = true;
      }
    },
  });
}

/**
 * Con el cobro por uso del modo Oficial (`cobro-oficial.ts`), la compuerta del acceso (`sin-sorteos.ts`): el portero
 * tiene que decir que la cuenta tiene acceso al modo Oficial y sorteos oficiales que alcancen para estos ganadores. Si
 * no, el paso de la cuenta o la ventana de «Se te acabaron», y no se pide ninguna firma. Mientras pregunta, el botón dice
 * «Revisando tu cuenta…», como la compuerta del paso. Si el módulo no baja, no se sella (y lo dice).
 */
async function accesoOficialParaSellar(btn: HTMLButtonElement, ganadores: number, cupon = false): Promise<boolean> {
  let accesoParaSellar: typeof import("./sin-sorteos").accesoParaSellar;
  try {
    ({ accesoParaSellar } = await import("./sin-sorteos"));
  } catch {
    return !(await frenarSinElPaso());
  }
  return accesoParaSellar(ganadores, {
    volverA: btn,
    ...(cupon ? { cupon: true } : {}),
    alRevisar: (revisando) => {
      btn.disabled = revisando;
      if (revisando) btn.textContent = t("clRevisando");
      else {
        btn.dataset.i = claveDeSellar();
        btn.textContent = t(btn.dataset.i);
      }
    },
  });
}

/**
 * Hay un sello de esta lista que se cortó y todavía no se sabe si entró. Averiguarlo no pide ninguna firma, y si entró
 * pudo gastar el último sorteo oficial: la compuerta del acceso no lo frena. Si hay que sellar de nuevo, el candado de
 * antes de la firma (`envio-sdk.ts`) vuelve a mirar el acceso.
 */
async function hayUnSelloPendiente(names: string[]): Promise<boolean> {
  const s = currentSession();
  if (!s) return false;
  try {
    const seguro = await import("./sello-seguro");
    return seguro.leerPendiente(s.address, bytesToHex(listHash(names)), network.name, network.contractId ?? "") !== null;
  } catch {
    return false;
  }
}

/** El no del portero fue que no le quedan sorteos oficiales: la ventana de «Se te acabaron». `false` si no era eso. */
async function siSeAcabaronLosSorteos(e: unknown, btn: HTMLButtonElement): Promise<boolean> {
  const x = e as { name?: unknown; motivo?: unknown } | null;
  if (!x || typeof x !== "object" || x.name !== "ErrorPortero" || x.motivo !== "sin-sorteos") return false;
  try {
    const m = await import("./sin-sorteos");
    if (!m.esSinSorteos(e)) return false;
    // Ya no se está sellando: «Pasar a Prueba» de la ventana tiene que poder cambiar de modo.
    marcarSellandoAhora(false);
    await m.alQuedarseSinSorteos({ volverA: btn });
    return true;
  } catch {
    return false;
  }
}

async function sellar(opciones: OpcionesDeSellado): Promise<void> {
  renumerarLaLista();
  const names = parseNames();
  if (!puedeSellar()) return;

  const btn = $<HTMLButtonElement>("btn-freeze");
  // Con el modo Oficial a la vista, una cuenta con la billetera en la otra red no cae callada al modo libre: se frena
  // con el aviso de cómo seguir, como dice la línea de debajo del botón. Sin modo Oficial, como siempre, se sigue sin
  // grabar. La pantalla completa que pidió el toque se suelta: no hay espera que mostrar.
  if (hayModoOficial && !sinGrabar() && (await frenarPorOtraRed())) {
    if (grandePendiente) soltarPantallaCompleta();
    return;
  }
  // La demo (`?demo=`) y el ensayo son el show con una lista de ejemplo, nunca
  // un sorteo: aunque haya una cuenta abierta no se graba nada ni se espera la
  // cadena (`ensayo-modo.ts`).
  const conCuenta = canAnchor() && !sinGrabar();
  // "Seguir sin sello": la red no dejaba sellar y quien organiza decidió seguir. Es el modo
  // libre, con la ronda a 90 s para seguir intentando sellar esa misma ronda (`sin-sello.ts`).
  const sinSello = conCuenta && !!opciones.sinSello;
  const anchoring = conCuenta && !sinSello;
  // Con el cobro por uso, antes que nada el acceso al modo Oficial y los sorteos que alcancen: sin eso no se firma nada,
  // y el paso de la cuenta, que se abre para conseguirlo, va antes que su compuerta de siempre.
  if (anchoring && network.name === "mainnet" && cobroPorUso() && !(await hayUnSelloPendiente(names)) && !(await accesoOficialParaSellar(btn, Math.min(ganadoresPedidos(), names.length), opciones.conCupon === true))) {
    if (grandePendiente) soltarPantallaCompleta();
    return;
  }
  // En modo Oficial con una cuenta de Google o de correo, la cuenta tiene que estar activada y protegida antes de sellar:
  // si falta algo, el paso «Dejá tu cuenta lista» a pantalla completa (`cuenta-lista-flujo.ts`). Va antes de la
  // confirmación del primer sello y de cerrar la lista, así sus salidas funcionan. Fuera del modo Oficial no se baja nada.
  if (anchoring && network.name === "mainnet" && !(await cuentaListaParaSellar(btn))) {
    if (grandePendiente) soltarPantallaCompleta();
    return;
  }
  const hash = bytesToHex(listHash(names));
  let ts = Math.floor(Date.now() / 1000);
  // Anclando, el margen no baja de 45 s (65 si la comisión la paga el portero, más abajo) aunque la URL pida menos: por debajo
  // de 30 el contrato rechaza el sello. En el ensayo, 15 s: lo bastante para
  // elegir el juego, y la línea que guía dice que de verdad es cerca de un minuto.
  const lead = anchoring
    ? Math.max(ANCHOR_LEAD_SECONDS, LEAD_SECONDS)
    : sinSello
      ? SIN_SELLO_LEAD_SECONDS
      : enStand()
        ? STAND_ESPERA_S
        : enEnsayo() && !params.has("lead")
          ? ENSAYO_ESPERA_S
          : LEAD_SECONDS;
  let round = targetRound(ts, lead);
  // En el modo «Orden de turnos» el nombre tiene que empezar con «Turnos»; fuera del modo es el cuadro, recortado.
  let prize = ajustarPremioDeTurnos();
  let numWinners = Math.min(ganadoresPedidos(), names.length);

  let raffleId: bigint | undefined;
  let sealTx: string | undefined;

  // La primera vez que se sella en Oficial en este navegador, una confirmación corta antes de tocar la red. Si la
  // cierra o pasa a Prueba, la pantalla completa que pidió el toque de "Sellar la lista" se suelta: no hay espera.
  if (anchoring && !(await confirmarPrimerSelloOficial())) {
    if (grandePendiente) soltarPantallaCompleta();
    return;
  }

  if (anchoring) {
    const session = currentSession();
    if (!session) return;
    // Lo que se sella ya se tomó del cuadro: mientras se graba, no se toca.
    cerrarLista(true);
    btn.disabled = true;
    const onStep = (step: AnchorStep, detail?: string): void => {
      btn.textContent = stepLabel(step);
      showTxStatus("seal-status", step, detail);
      // Recién protegida la cuenta: se dice que se sigue, hasta que el sello queda grabado.
      const estado = document.getElementById("seal-status");
      if (opciones.protegida && step !== "confirmed" && estado) estado.textContent = `${t("protSigue")} ${estado.textContent ?? ""}`.trim();
    };
    // Enseguida, antes de cualquier espera: el botón quedaba apagado y diciendo
    // "Sellar en Stellar" mientras se armaba el cliente del contrato, de medio
    // segundo a catorce (`clienteListo` en anchor.ts). Y se va el error de antes.
    onStep("starting");
    // El botón es nuestro mientras se sella: la caja de la red no lo toca (`red.ts`). Y el modo no se cambia hasta
    // que termine (`modo-ui.ts`): la recarga cortaría el envío.
    marcarSellado(true);
    marcarSellandoAhora(true);
    try {
      // La red, antes de armar nada: si no deja sellar, se dice acá y la acción del caso
      // reemplaza a este botón. Si anda lenta, se avisa y se sigue. Un chequeo que se rompe no frena.
      if (!opciones.saltarChequeo && !(await chequearAntesDeSellar())) {
        btn.disabled = false;
        cerrarLista(false);
        hideTxStatus("seal-status");
        marcarSellado(false);
        return;
      }
      // El contador del embudo (src/contar.ts): un intento de sellar, y después cómo terminó. La verdad
      // del sello es la cadena. Un toque que la red frenó antes de mandar nada no es un intento.
      // El reintento de después de proteger la cuenta es el mismo intento de la persona: no suma otro envío.
      if (!opciones.protegida) contar("seal_sent", { network: network.name });
      // Nunca dos sellos de la misma lista (`sello-seguro.ts`, D-17 en docs/architecture.md):
      // - Si la red tarda, la ronda elegida al hacer clic llega a la cadena con menos de los
      //   30 s que exige el contrato y el sello falla (3 de 11 sellos con el RPC público de
      //   testnet, QA del 16 de octubre de 2026): no quedó nada y se reintenta con otra ronda.
      // - Si no se sabe si entró (un corte, una respuesta que no llegó), primero se averigua.
      //   Si no se puede, queda guardado, y el próximo intento empieza por ahí.
      // - Con Freighter hay que aprobar a mano: la ronda va con 45 s más de margen.
      // - Si la comisión la paga el portero del patrocinio, la primera ronda nace a 65 s y no a 45:
      //   ese camino hace más llamadas a la red (`MARGEN_CON_PORTERO_S` en sello-seguro.ts).
      const [seguro, extra, conPortero] = await Promise.all([import("./sello-seguro"), margenParaAprobar(), pagaElPortero({ pagarConMiCuenta: !!opciones.pagarConMiCuenta })]);
      const contrato = network.contractId ?? "";
      const previo = seguro.leerPendiente(session.address, hash, network.name, contrato);
      // Sin un intento pendiente lo próximo es armar la transacción: la ronda se elige
      // con el cliente del contrato listo (suele estarlo: se arma al abrir la sesión),
      // para que bajarlo no se coma el margen. Con un intento pendiente, primero se
      // averigua si entró, como siempre, y eso no necesita el cliente.
      if (!previo) await clienteListo();
      // Si la ronda de antes no quedó grabada, `sello-seguro.ts` pide la próxima más lejos. La cuenta
      // regresiva y la hora del sorteo salen de la ronda que quede (`app.frozen.round`), no de este número.
      const rondaNueva = seguro.rondasDesde(seguro.margenDelPrimerIntento(lead, { conPortero, paraAprobar: extra }));
      ({ round, ts } = rondaNueva());
      const sello = await seguro.sellarSinDuplicar(
        { round, ts },
        {
          sellar: (r) =>
            sealOnChain(
              {
                organizer: session.address,
                listHash: listHash(names),
                count: names.length,
                numWinners,
                round: r,
                meta: prize || t("defaultMeta"),
              },
              onStep,
              { pagarConMiCuenta: !!opciones.pagarConMiCuenta },
            ),
          resolver: (intento) => resolverSelloEnLaRed(intento, onStep),
          rondaNueva,
          sinGrabar: (e) => {
            if (selloSinGrabar(e)) console.warn("[tinkazo] el sello no entró; se reintenta con otra ronda", e);
            return selloSinGrabar(e);
          },
          guardarPendiente: (intento) => seguro.guardarPendiente(intento, network.name, contrato, prize),
          avisar: (que) => onStep(que === "verificando" ? "verifying" : que === "otra-ronda" ? "laterRound" : "retrying"),
        },
        previo?.intento ?? null,
      );
      raffleId = sello.raffleId;
      sealTx = sello.txHash;
      round = sello.round;
      ts = sello.ts;
      if (sello.retomado && previo) {
        // El que entró es el de antes: queda sellado con su premio y su cantidad de ganadores.
        prize = previo.premio;
        numWinners = sello.retomado.numWinners;
        ponerPremio(prize);
        ponerGanadores(numWinners);
      }
      // Si se supo por la red (se cortó y se averiguó), la línea todavía decía "Revisando…".
      showTxStatus("seal-status", "confirmed", sealTx);
      contar("seal_confirmed", { network: network.name, from: origenActual() });
    } catch (e) {
      // La pantalla dice algo que se entiende; el detalle técnico queda plegado
      // debajo y en este navegador (`detalle-error.ts`), y en la consola.
      console.warn("[tinkazo] el sello no se pudo grabar", e);
      // Pollar 0.12 (mainnet): la cuenta no firma hasta tener una forma de recuperarla. Se abre "Protegé tu cuenta" y,
      // si la protege, se vuelve solo al sello con la misma lista. Una sola vez por intento: si vuelve a fallar, se dice.
      // Mientras la ventana está abierta la lista sigue cerrada (no se puede tocar lo que se va a sellar) y el intento
      // todavía no se cuenta como fallado: se cuenta cómo termina el reintento, o que la persona no la protegió.
      if (!protegiendoLaCuenta && (await pideProtegerLaCuenta(e))) {
        hideTxStatus("seal-status");
        // El sello no salió: el cambio de modo ya no lo espera, así «Pasar a Prueba» del paso funciona.
        marcarSellandoAhora(false);
        protegiendoLaCuenta = true;
        try {
          // Si la lista cambió mientras tanto (no debería: sigue cerrada), no se sella otra distinta sin que la persona lo pida.
          if ((await protegerLaCuenta(btn, "seal-status")) && bytesToHex(listHash(parseNames())) === hash) {
            await sellar({ ...opciones, saltarChequeo: true, protegida: true });
            return;
          }
        } finally {
          protegiendoLaCuenta = false;
        }
      }
      btn.disabled = false;
      cerrarLista(false);
      btn.dataset.i = claveDeSellar();
      btn.textContent = t(btn.dataset.i);
      marcarSellado(false);
      // Para el contador, la clave del motivo (la misma del mensaje), nunca el detalle. Se cuenta
      // antes de cualquier camino de la red: un sello que empezó y no entró es un fallo siempre.
      void import("../stellar/errores")
        .then(async ({ errorKey }) => contar("seal_failed", { network: network.name, error: errorContable(errorKey(e, { patrocinada: await cuentaPatrocinada() }), e) }))
        .catch(() => undefined);
      // Dos cosas que la red explica mejor que el error de siempre, con su acción:
      // el sello de verdad cuesta más de lo que el patrocinador paga, o el patrocinador no tiene con qué.
      if (esCostoAlto(e)) {
        hideTxStatus("seal-status");
        await mostrarCostoAlto(e.costoXlm, e.restaurar);
        return;
      }
      // Con el cobro por uso, el portero (o el candado de antes de la firma) dijo que no quedan sorteos oficiales.
      if (await siSeAcabaronLosSorteos(e, btn)) {
        hideTxStatus("seal-status");
        return;
      }
      // El portero del patrocinio dijo que no (se acabó el cupo, no pagó o no contestó): su pantalla, con su acción.
      const sinPatrocinio = patrocinioDelError(e);
      if (sinPatrocinio) {
        hideTxStatus("seal-status");
        await mostrarSinPatrocinio(sinPatrocinio);
        return;
      }
      if (await esSinSaldoDelPatrocinador(e)) {
        hideTxStatus("seal-status");
        await mostrarSinSaldo();
        return;
      }
      // Un corte del RPC con la red "bien" de hace un momento: se mira de nuevo, y si está caída se dice con su acción.
      if (await esCorteDelRpc(e)) {
        if (await verLaRedTrasFallar()) {
          hideTxStatus("seal-status");
          return;
        }
      }
      const status = $("seal-status");
      status.style.display = "block";
      // Naranja, como el error del sorteo: violeta es "todavía va" (styles.css).
      status.className = "txstatus bad";
      await escribirError(status, e, "sello", numWinners);
      // Si se apretó la barra, el botón de verdad (y este mensaje) están fuera de la pantalla.
      verError(status);
      return;
    }
  } else {
    hideTxStatus("seal-status");
  }

  // Lo que se usa al final del show se baja ahora, con internet seguro: si
  // el wifi se cae durante el juego, el QR y "Mostrar en grande" igual andan
  // (QA, 16 de octubre de 2026).
  void precargarQr();
  void import("./pantalla").catch(() => undefined);
  void import("./compartir").catch(() => undefined);
  // Y lo que cuenta un error del sorteo, si el wifi se cae antes de sortear.
  if (raffleId !== undefined) precargarParaElSorteo();

  // El logo de la comunidad que había al sellar: solo su huella. No es parte del sorteo (logo.ts).
  const logo = logoParaSellar();
  app.frozen = {
    names,
    listHash: hash,
    ts,
    at: new Date().toLocaleString(getLang() === "es" ? "es-BO" : "en-US"),
    prize,
    round,
    ...(raffleId !== undefined ? { raffleId } : {}),
    ...(sealTx ? { sealTx } : {}),
    ...(sinSello ? { sinSello: true } : {}),
    ...(sinCuentaElegido() ? { sinCuenta: true } : {}),
    ...(logo ? { logo } : {}),
  };
  // Ya está sellada (o se sigue sin sello): el botón y la caja de la red dejan de ser de este paso.
  marcarSellado(false);
  limpiarRed();

  // Los últimos premios que se usaron se ofrecen primero la próxima vez. La demo y el ensayo no cuentan.
  if (!sinGrabar()) {
    recordarPremio(prize);
    // El primer sello de este equipo: la oferta de primera vez y los números del tutorial dejan de verse siempre.
    document.dispatchEvent(new CustomEvent("tinkazo:sellado"));
  }

  // Se anota en el historial de este equipo apenas se sella, no al sortear:
  // si el sorteo queda pendiente, igual hay que poder encontrarlo.
  // La demo y el ensayo no son sorteos: no se anotan en Mis sorteos, aunque haya cuenta.
  const who = sinGrabar() ? undefined : currentSession()?.address;
  if (who) {
    void import("./history").then((h) => {
      h.remember({
        organizer: who,
        listHash: hash,
        count: names.length,
        numWinners,
        round,
        sealedAt: ts,
        prize,
        names,
        ...(raffleId !== undefined ? { id: String(raffleId) } : {}),
        // El número solo no dice de qué contrato es (cada uno arranca en 1).
        ...(raffleId !== undefined && network.contractId ? { contract: network.contractId } : {}),
        ...(sealTx ? { sealTx } : {}),
        // Sin sello: Mis sorteos lo dice, y no figura como comprobable.
        ...(sinSello ? { sinSello: true } : {}),
        ...(logo ? { logo } : {}),
      });
      h.renderHistory(who);
    });
  }
  showFrozen(names, hash, raffleId);
  // Sin sello pero con cuenta: mientras corre la cuenta regresiva se sigue intentando la misma ronda.
  const quien = currentSession()?.address;
  if (sinSello && quien) {
    anotar({ red: network.name, paso: "sin-sello", accion: "seguir-sin-sello", final: `la ronda nace en ${Math.max(0, roundTime(round) - Math.floor(Date.now() / 1000))} s` });
    seguirIntentandoElSello({ names, hash, round, ts, prize, numWinners, organizer: quien });
  }
}

/* ------------------------------------------------- seguir sin sello, y sellar después */

/** Lo que identifica el sorteo que se sigue sin sello: el mismo que si entra el sello tarde. */
interface SorteoSinSello {
  names: string[];
  hash: string;
  round: number;
  ts: number;
  prize: string;
  numWinners: number;
  organizer: string;
}

let reintentoActual: Reintento | null = null;

/** Si la lista que está sellada ahora es la de este sorteo (no se empezó otro). */
const sigueSiendo = (c: SorteoSinSello): boolean => app.frozen?.round === c.round && app.frozen.listHash === c.hash;

/**
 * "Seguir sin sello": hasta 40 segundos antes de la ronda se vuelve a intentar sellar la
 * MISMA lista con la MISMA ronda, cada 15 segundos o cuando se toca "Volver a intentar el
 * sello". Si entra, el sorteo queda anclado y el ganador es el mismo; si no, queda sin
 * sello. Nunca se sella otra ronda: sería otro sorteo (ver `sin-sello.ts`).
 */
function seguirIntentandoElSello(c: SorteoSinSello): void {
  reintentoActual?.cancelar();
  const contrato = network.contractId ?? "";
  const reintento = reintentarSello({
    round: c.round,
    ts: c.ts,
    sellar: (r) =>
      sealOnChain(
        { organizer: c.organizer, listHash: listHash(c.names), count: c.names.length, numWinners: c.numWinners, round: r, meta: c.prize || t("defaultMeta") },
        () => undefined,
      ),
    resolver: (intento) => resolverSelloEnLaRed(intento),
    sinGrabar: selloSinGrabar,
    guardarPendiente: (intento) => void import("./sello-seguro").then((seguro) => seguro.guardarPendiente(intento, network.name, contrato, c.prize)),
    alIntento: (n) => {
      if (!sigueSiendo(c)) return;
      verSinSello("intentando");
      anotar({ red: network.name, paso: "reintento", accion: "volver-a-sellar", final: `intento ${n}` });
    },
    alFallar: (n, e) => {
      if (!sigueSiendo(c)) return;
      verSinSello("esperando", () => reintento.reintentarYa());
      void import("../stellar/errores").then((m) => anotar({ red: network.name, paso: "reintento", final: `intento ${n}: ${esCostoAlto(e) ? "costo-alto" : m.errorKey(e)}` }));
    },
  });
  reintentoActual = reintento;
  verSinSello("esperando", () => reintento.reintentarYa());
  void reintento.fin.then((fin) => {
    if (reintentoActual === reintento) reintentoActual = null;
    if (fin.estado === "cancelado" || !sigueSiendo(c)) return;
    if (fin.estado === "entro") {
      alEntrarElSello(fin.hecho, c);
      return;
    }
    anotar({ red: network.name, paso: "sello-tarde", accion: "volver-a-sellar", final: fin.estado === "vencio" ? "no entró a tiempo" : "no se pudo saber" });
    verSinSello("vencio");
  });
}

/** El sello entró a tiempo, con la misma lista y la misma ronda: el sorteo pasa a ser comprobable. */
function alEntrarElSello(hecho: { raffleId: bigint; txHash?: string }, c: SorteoSinSello): void {
  const f = app.frozen;
  if (!f) return;
  f.raffleId = hecho.raffleId;
  if (hecho.txHash) f.sealTx = hecho.txHash;
  delete f.sinSello;
  anotar({ red: network.name, paso: "sello-tarde", accion: "volver-a-sellar", final: "entró" });
  $("k-status").textContent = `Stellar #${hecho.raffleId}`;
  const wid = document.getElementById("wait-id");
  if (wid) {
    wid.textContent = t("waitIdPagina").replace("{n}", String(hecho.raffleId));
    wid.style.display = "block";
  }
  const btn = $<HTMLButtonElement>("btn-freeze");
  btn.dataset.i = "sealed";
  btn.textContent = t("sealed");
  renderSealSummary();
  // Ya es comprobable: el título, la línea de la espera y la espera en grande dejan de decir "sin sello".
  textosDelSello();
  document.dispatchEvent(new CustomEvent("tinkazo:sello"));
  precargarParaElSorteo();
  // Anclado, el contrato pide la firma descomprimida: la curva se baja ahora, con la espera en marcha.
  void import("../protocol/drand").catch(() => undefined);
  void import("./history").then((h) => {
    h.remember({
      organizer: c.organizer,
      listHash: c.hash,
      count: c.names.length,
      numWinners: c.numWinners,
      round: c.round,
      sealedAt: c.ts,
      prize: c.prize,
      names: c.names,
      id: String(hecho.raffleId),
      ...(network.contractId ? { contract: network.contractId } : {}),
      ...(hecho.txHash ? { sealTx: hecho.txHash } : {}),
      sinSello: false,
    });
    h.renderHistory(c.organizer);
  });
  verSinSello("entro");
}

/** El error dice que el RPC no contestó (y no que no hay internet: eso lo cuenta el aviso de siempre). */
async function esCorteDelRpc(e: unknown): Promise<boolean> {
  try {
    const { errorKey } = await import("../stellar/errores");
    return errorKey(e) === "rpcDown";
  } catch {
    return false;
  }
}

/** Ya se abrió "Protegé tu cuenta" en este intento de sellar: si el sello vuelve a pedirla, se dice y no se repite. */
let protegiendoLaCuenta = false;

/** El sello no entró porque el patrocinador no tiene con qué pagar (mainnet, sin grifo): se explica con su acción. */
async function esSinSaldoDelPatrocinador(e: unknown): Promise<boolean> {
  if (network.name !== "mainnet") return false;
  try {
    const [{ esSinSaldo }, { activeWallet }, { submitsItself }] = await Promise.all([import("../stellar/errores"), import("../stellar/wallet-lite"), import("../stellar/wallet-pollar")]);
    return submitsItself(activeWallet()) && esSinSaldo(e);
  } catch {
    return false;
  }
}

/**
 * Retoma un sorteo sellado y sin sortear desde "Mis sorteos": repone la lista,
 * el premio y la cantidad de ganadores, y deja el selector de juego listo.
 *
 * Solo si la lista guardada sigue dando la misma huella. Si alguien la tocó en
 * el almacenamiento del navegador, no se retoma: la cadena manda.
 */
export function resumeFrozen(e: {
  names: string[];
  listHash: string;
  sealedAt: number;
  prize: string;
  round: number;
  numWinners: number;
  id?: string;
  sealTx?: string;
  /** Se había seguido sin sello (la red no dejó sellar): retomarlo no lo vuelve comprobable. */
  sinSello?: boolean;
  /** El logo con el que se selló: la huella (`logo.ts`). */
  logo?: string;
}): void {
  if (bytesToHex(listHash(e.names)) !== e.listHash || app.drawn) return;
  const ta = $<HTMLTextAreaElement>("ta");
  ta.value = e.names.join("\n");
  ta.dispatchEvent(new Event("input"));
  ponerPremio(e.prize);
  ponerGanadores(e.numWinners);
  const raffleId = e.id !== undefined ? BigInt(e.id) : undefined;
  app.frozen = {
    names: e.names,
    listHash: e.listHash,
    ts: e.sealedAt,
    at: new Date(e.sealedAt * 1000).toLocaleString(getLang() === "es" ? "es-BO" : "en-US"),
    prize: e.prize,
    round: e.round,
    ...(raffleId !== undefined ? { raffleId } : {}),
    ...(e.sealTx ? { sealTx: e.sealTx } : {}),
    ...(e.sinSello && raffleId === undefined ? { sinSello: true } : {}),
    ...(e.logo ? { logo: e.logo } : {}),
  };
  history.replaceState(null, "", "#sortear");
  dispatchEvent(new HashChangeEvent("hashchange"));
  showFrozen(e.names, e.listHash, raffleId);
}

/**
 * Suelta el sello de la pantalla para armar otro sorteo (lo llama `newDraw`).
 * `lista` es lo que queda en el cuadro: la anterior sin los ganadores, o
 * nada. El premio se borra, porque el próximo casi siempre es otro. El sorteo
 * anterior no se toca: sigue en la cadena, en Mis sorteos y en su comprobante.
 */
export function unfreeze(lista: string): void {
  soltadoEn = performance.now();
  reintentoActual?.cancelar();
  reintentoActual = null;
  limpiarRed();
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  countdownTimer = undefined;
  app.frozen = null;
  cerrarLista(false);
  ponerPremio("");
  $("sec-frozen").style.display = "none";
  $("wait-box").style.display = "none";
  $("btn-draw").classList.remove("lista");
  $("rules-text").style.display = "none";
  $<HTMLButtonElement>("g-wheel").disabled = false;
  $("wheel-cap").style.display = "none";
  hideTxStatus("seal-status");
  refreshFreezeLabel();
  // El resumen del CSV ya no aplica a la lista nueva: se esconde.
  setList(lista);
  actualizarPaso();
}

/**
 * El título de la sección y la línea bajo la cuenta. Sin sello (la red no dejó sellar) no
 * dicen "sellada" ni que nadie puede cambiar nada: la lista está cerrada, nada más
 * (`sin-sello-textos.ts`). Si el sello entra tarde, vuelven a los de siempre.
 */
function textosDelSello(): void {
  const sin = sinSelloAhora(app.frozen);
  ponerTextoDelSello(document.querySelector<HTMLElement>("#sec-frozen .head h2 [data-i]"), "titulo", sin);
  // Una ronda de stand no se sella: el título no dice «sellada».
  const titulo = document.querySelector<HTMLElement>("#sec-frozen .head h2 [data-i]");
  if (enStand() && titulo) {
    titulo.dataset.i = "standListaT";
    titulo.textContent = t("standListaT");
  }
  ponerTextoDelSello(document.querySelector<HTMLElement>("#wait-box .wait-line"), "lineaDeLaEspera", sin);
}

/**
 * La cuenta de la lista sellada: cuántas participaciones y, si no son una por persona, de cuántas personas.
 * La etiqueta de siempre la pinta el cambio de idioma por `data-i`; la de las dos cuentas se pinta acá, con el
 * `data-i` quitado para que no la pise, y el `onLangChange` de abajo la vuelve a escribir.
 */
export function pintarCuentaSellada(names: readonly string[]): void {
  // La misma regla que la verificación (`seCuentaPorPersona`): un reparto entero siempre, y con los modos a la
  // vista también el reparto con nombres a secas. Sin los modos, cada línea es una persona, como siempre.
  const { personas, participaciones } = contarPersonas(names, seCuentaPorPersona(names, modesVisible()));
  $("k-n").textContent = String(participaciones);
  const etiqueta = $("k-entries");
  if (personas === participaciones) {
    etiqueta.dataset.i = "kEntries";
    etiqueta.textContent = t("kEntries");
    return;
  }
  delete etiqueta.dataset.i;
  etiqueta.textContent = T[getLang()].kEntriesDe(personas);
}

onLangChange(() => {
  if (app.frozen) pintarCuentaSellada(app.frozen.names);
});

/** Lo que se ve con la lista ya sellada: los datos del sello, la espera y el selector de juego. */
function showFrozen(names: string[], hash: string, raffleId: bigint | undefined): void {
  const f = app.frozen;
  if (!f) return;
  const btn = $<HTMLButtonElement>("btn-freeze");
  // El cuadro, el premio, "Cuántos ganan" y los orígenes: lo que se ve es lo que se selló.
  cerrarLista(true);
  // Lo que se estaba armando ya quedó sellado (o se retomó un sello): no hay borrador que recuperar.
  olvidarBorrador();
  btn.disabled = true;
  // Sin sello (la red no dejó): no dice "sellada", que es lo que se espera de la cadena.
  btn.dataset.i = raffleId !== undefined ? "sealed" : f.sinSello ? "redSinSelloBoton" : enStand() ? "standEnMarcha" : "frozenOk";
  btn.textContent = t(btn.dataset.i);
  $("freeze-hint").style.display = "none";
  $("free-rule").style.display = "none";
  $("sec-frozen").style.display = "block";
  textosDelSello();
  pintarCuentaSellada(names);
  $("k-digest").textContent = hash.slice(0, 16) + "…";
  $("k-status").textContent = raffleId !== undefined ? `Stellar #${raffleId}` : "local";
  // El número del sorteo bien grande durante la espera: queda en las fotos de
  // la sala antes de que exista el número que decide. Si después aparece otro
  // sello, todos tienen el número del bueno.
  const wid = document.getElementById("wait-id");
  if (wid) {
    // En la página, solo el número: "anotalo o sacale una foto" es para la sala, en la espera en grande.
    wid.textContent = raffleId !== undefined ? t("waitIdPagina").replace("{n}", String(raffleId)) : "";
    wid.style.display = raffleId !== undefined ? "block" : "none";
  }
  $("frozen-ts").textContent = t("frozenAt") + " " + f.at;
  renderSealSummary();
  // Antes de la ruleta: si el juego cambia por la cantidad, el selector ya está ordenado.
  pintarRecomendacion(names);
  // Si nadie eligió otro, queda elegido uno que se recomienda para esta
  // cantidad (D02). La demo juega el que pide su enlace.
  if (!juegoAMano && !params.has("demo")) {
    // Después de un premio, otro juego; la primera vez, el de siempre (D02).
    // Un orden de turnos queda con la ruleta si la lista entra (`juegoPorDefecto`); con más de lo que admite, el de siempre.
    const turnos = isTurnOrder(names.length, Math.min(premiosElegidos(), names.length), f.prize);
    const g = juegoAnterior ? juegoSiguiente(names.length, juegoAnterior, premiosElegidos()) : juegoPorDefecto(names.length, premiosElegidos(), turnos);
    juegoAnterior = null;
    if (g !== app.game) setGame(g);
  }

  if (names.length > WHEEL_MAX) {
    // La ruleta es el único juego con tope. Los demás aguantan doscientos. El
    // reemplazo automático es el primer juego del selector que encaja para esa
    // cantidad (sección 8.1). La tómbola ya no está en el selector, así que no
    // puede ser el reemplazo: queda solo para más de doscientos, donde ningún
    // juego encaja y no tiene botón. (Iba a la carrera el 16 de octubre, que
    // pone ocho en pista.)
    $<HTMLButtonElement>("g-wheel").disabled = true;
    $("wheel-cap").style.display = "block";
    if (app.game === "wheel") setGame(recomendar(names.length, premiosElegidos()).games.find((r) => r.fits === true)?.game ?? "tombola");
  }
  pintarJuego();
  startCountdown();
  actualizarPaso();
  $("sec-frozen").scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Copia las bases del sorteo: quién participa, qué se gana, cómo se elige y
 * cómo se verifica, con la huella y la ronda ya fijadas.
 *
 * Casi todas las normas de sorteos del mundo piden lo mismo: reglas claras
 * antes de sortear (docs/legal.md). Tinkazo ya sabe casi todo, y la parte de
 * "cómo se elige" es el protocolo. Se ofrecen apenas se sella, que es cuando
 * dicen algo que todavía nadie puede acomodar: la ronda no existe.
 */
export async function copyRules(btn: HTMLButtonElement): Promise<void> {
  const f = app.frozen;
  if (!f) return;
  const lang = getLang();
  const when = (s: number): string =>
    new Date(s * 1000).toLocaleString(lang === "es" ? "es-BO" : "en-US", { dateStyle: "long", timeStyle: "long" });
  const winners = Math.min(ganadoresPedidos(), f.names.length);
  // Con varias participaciones por persona, las bases dicen las dos cuentas, con la misma regla que la
  // verificación y la espera (`seCuentaPorPersona`).
  const { personas, participaciones } = contarPersonas(f.names, seCuentaPorPersona(f.names, modesVisible()));
  // Un orden de turnos tiene sus bases, sin ganadores ni premio.
  const bases = isTurnOrder(f.names.length, winners, f.prize) ? T[lang].turnsRules : T[lang].rules;
  const text = bases({
    prize: f.prize,
    count: personas,
    entries: participaciones,
    winners,
    listHash: f.listHash,
    sealedAt: when(f.ts),
    round: f.round,
    roundAt: when(roundTime(f.round)),
    ...(f.raffleId !== undefined ? { raffleId: String(f.raffleId) } : {}),
    network: network.name,
    // Cómo se verifica, explicado sin jerga; seguridad cuenta qué impide y qué no.
    verifyUrl: `${location.origin}/como-funciona.html`,
  });
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t("copied");
    setTimeout(() => { btn.textContent = t("copyRules"); }, 1600);
  } catch {
    // Sin permiso para el portapapeles, el texto queda a la vista para copiarlo a mano.
    const pre = $("rules-text");
    pre.textContent = text;
    pre.style.display = "block";
  }
}

/** Resumen técnico del sello, con enlace al contrato si quedó anclado. */
function renderSealSummary(): void {
  const f = app.frozen;
  if (!f) return;
  const el = $("entities");
  el.textContent =
    `Seal: list_hash=${f.listHash}, count=${f.names.length}, sealed_at=${f.ts}, target_round=${f.round}, round_time=${roundTime(f.round)}`;
  if (f.raffleId === undefined) {
    const tag = document.createElement("span");
    tag.className = "kicker";
    tag.style.marginLeft = "8px";
    // Sin sello porque la red no dejó: lo dice con todas las letras (no es solo "sin registrar").
    tag.textContent = t(f.sinSello ? "redSinSelloEtiqueta" : "noAnchor");
    el.appendChild(tag);
    return;
  }
  el.append(`, raffle_id=${f.raffleId}, `);
  const a = document.createElement("a");
  a.href = contractUrl();
  a.target = "_blank";
  a.rel = "noopener";
  // Con el modo Oficial a la vista dice el modo; sin él, como siempre, el nombre de la red.
  a.textContent = hayModoOficial ? `${t(modeNameKey(network.name))} ↗` : `${network.name} ↗`;
  el.appendChild(a);
}

/**
 * Las bases antes de sellar: lo que ya se sabe (premio, cuántos ganan, cuántas
 * personas) y cómo se elige, sin huella, fechas ni número, que todavía no
 * existen. Para avisar del sorteo antes de empezar el evento.
 */
export async function copyRulesPre(btn: HTMLButtonElement): Promise<void> {
  const lang = getLang();
  const names = parseNames();
  // Para copiar hacen falta dos personas, contadas como siempre; lo que dicen las bases, con la cuenta del cuadro.
  if (contarPersonas(names, modesVisible()).personas < 2) return;
  const { personas: count, participaciones: entries } = cuentaParaMostrar(names, modesVisible());
  const prize = $<HTMLInputElement>("prize").value.trim().replace(/\s+/g, " ");
  const winners = Math.min(ganadoresPedidos(), names.length);
  // Un orden de turnos tiene sus bases, sin ganadores ni premio. Se decide por las líneas de la lista
  // (lo que se sella: cada línea, un turno), no por las personas.
  const basesPre = isTurnOrder(names.length, winners, prize) ? T[lang].turnsRulesPre : T[lang].rulesPre;
  const text = basesPre({
    prize,
    count,
    entries,
    winners,
    verifyUrl: `${location.origin}/como-funciona.html`,
  });
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = t("copied");
    setTimeout(() => { btn.textContent = t("copyRules"); }, 1600);
  } catch {
    const pre = $("rules-pre-text");
    pre.textContent = text;
    pre.style.display = "block";
  }
}
