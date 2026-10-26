import { $ } from "../dom";
import { T, getLang, onLangChange, t } from "../i18n";
import { ANCHOR_LEAD_SECONDS, LEAD_SECONDS, SIN_SELLO_LEAD_SECONDS, WHEEL_MAX, app, currentPace, paceSeconds, params, type Game } from "../state";
import { QUICKNET, bytesToHex, roundTime, targetRound } from "../protocol/quicknet";
import { listHash } from "../protocol/canonical";
import { prepararFirma } from "../protocol/firma";
import { esCostoAlto } from "../stellar/chequeo-red";
import { contractUrl, network } from "../stellar/config";
import { anotar } from "../stellar/registro-red";
import { type AnchorStep, clienteListo, escribirError, hideTxStatus, margenParaAprobar, precargarParaElSorteo, resolverSelloEnLaRed, sealOnChain, selloSinGrabar, showTxStatus, stepLabel } from "./anchor";
import { precargarQr } from "./qr";
import { juegoPorDefecto, juegoSiguiente, rangoVisible, recomendar } from "./recomendar";
import { esperaSola, leerGuardado } from "./vista-grande";
import { apruebaAMano, canAnchor, currentSession } from "./wallet-ui";
import { cerrarLista, olvidarBorrador, parseNames, setList } from "./participants";
import { preloadGame } from "../games/engine";
import { claveNombre } from "./gamecard";
import { JUEGOS } from "../games/pixi/kit/catalogo";
import { actualizarPaso, barraActiva, verError } from "./siguiente";
import { ponerPremio, recordarPremio } from "./premios";
import { ENSAYO_ESPERA_S, enEnsayo, sinGrabar } from "../ensayo-modo";
import { contar, errorContable } from "../contar";
import { type OpcionesDeSellado, chequearAntesDeSellar, hayAccionDeRed, limpiarRed, marcarSellado, mostrarCostoAlto, mostrarSinSaldo, verLaRedTrasFallar, verSinSello } from "./red";
import { type Reintento, reintentarSello } from "./sin-sello";
import { claveDelSello, ponerTextoDelSello, sinSelloAhora } from "./sin-sello-textos";

/**
 * Los botones del selector, en el orden en que se muestran. Hasta el 29 de
 * septiembre de 2026 esta lista tenía solo los ocho primeros, y los botones
 * del trompo, las balsas, la piñata y Oruro no hacían nada: solo se llegaba a
 * ellos con `?demo=`, que es lo que usan los auditores.
 *
 * Desde el 21 de octubre de 2026 son diez: entró El Trueque y salieron el
 * Aguayo y la Constelación, que se fundieron en él (la tómbola había salido el
 * 20). Van en el orden de la auditoría de juegos, de las salas chicas a las
 * grandes; con la lista sellada los reordena la recomendación (`recomendar.ts`).
 * Los que salen siguen abriendo con `?demo=`.
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

/** Un toque en el selector: el juego que se eligió, y que ya no se cambia solo. */
export function elegirJuego(g: Game): void {
  juegoAMano = true;
  setGame(g);
}

export function setGame(g: Game): void {
  if (app.drawn) return;
  app.game = g;
  for (const [id, key] of GAME_BUTTONS) $(id).classList.toggle("on", g === key);
  pintarJuego();
  // Si ya está congelada, la cuenta regresiva corre: se baja el juego nuevo.
  if (app.frozen) preloadGame(g, app.frozen.names.length);
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
/** Cuántos premios se sortean: el selector de "Cuántos ganan", que con la lista sellada ya no cambia. */
const premiosElegidos = (): number => Math.max(1, parseInt($<HTMLSelectElement>("nw").value, 10) || 1);

export function pintarRecomendacion(n: number): void {
  const botones = new Map<Game, HTMLElement>();
  for (const [id, g] of GAME_BUTTONS) {
    const el = document.getElementById(id);
    if (el) botones.set(g, el);
  }
  const gp = $("gamepick");
  recomendar(n, premiosElegidos()).games.forEach((r, i) => {
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
    // El rango de personas, a la vista: miniatura, nombre y rango (barrido de letra, 26 de octubre de 2026).
    const rango = rangoVisible(r.game);
    if (rango) {
      const em = document.createElement("em");
      em.className = "rec-rango";
      em.textContent = rango;
      em.setAttribute("aria-label", t("recRangoAria").replace("{r}", rango.replace("–", " a ")));
      el.appendChild(em);
    }
    if (r.note) {
      const nota = document.createElement("small");
      nota.className = "rec-nota sr-only";
      nota.textContent = frase(r.note, r.args);
      el.appendChild(nota);
    }
  });
  pintarCabecera(n);
  pintarNotaElegida();
}

/**
 * La línea de arriba del selector: "Para 8 personas · Duración: Normal · 41 s".
 * La duración es la del show con el ritmo elegido, que hoy es la misma para
 * cualquier cantidad (la de la sección 8.2 no se muestra todavía: ver el informe).
 */
function pintarCabecera(n: number): void {
  const el = document.getElementById("rec-head");
  if (!el) return;
  const p = currentPace();
  const nombre = t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
  el.textContent = `${frase("recHead", [n])} · ${t("paceLabel")}: ${nombre} · ${paceSeconds(p)} s`;
  el.style.display = "";
}

/**
 * Rehace la recomendación con la lista sellada: al cambiar de idioma o de
 * ritmo, que son los textos y la duración que se ven. Sin lista sellada no hay
 * selector visible, y no hace nada.
 */
export function refrescarRecomendacion(): void {
  if (app.frozen) pintarRecomendacion(app.frozen.names.length);
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
  const margin = app.frozen.raffleId !== undefined ? CHAIN_MARGIN_SECONDS : 0;
  return Math.max(0, roundTime(app.frozen.round) + margin - Math.floor(Date.now() / 1000));
}

let countdownTimer: number | undefined;

/** De qué lista sellada la espera ya se abrió sola: una vez por lista, y si la persona vuelve, no se la vuelve a poner. */
let esperaAutoDe = "";

/** La espera en grande, ya bajada: la cuenta regresiva le avisa cuando nace el número. */
let espera: typeof import("./espera") | null = null;

/**
 * La espera en grande (`espera.ts`), que se baja recién cuando hace falta. Es
 * una opción de la caja de la espera: no se abre sola (Nicolás, 17 de octubre
 * de 2026: el "¡Contemos juntos!" y el "¡Nació!" no le gustaron, y salieron).
 *
 * Desde el 21 de octubre de 2026 desemboca en el show: si sigue abierta cuando
 * nace el número, el sorteo arranca solo. La pantalla completa se pide acá,
 * con el toque, que es el gesto que el navegador exige: bajar la espera puede
 * tardar más de lo que dura ese permiso. El show la hereda.
 */
function abrirEspera(): void {
  const raiz = document.documentElement;
  const pantalla = !document.fullscreenElement && typeof raiz.requestFullscreen === "function";
  if (pantalla) void raiz.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  void import("./espera").then((m) => {
    espera = m;
    const abrio = m.mostrarEspera(secondsToRound, {
      sortear: () => $<HTMLButtonElement>("btn-draw").click(),
      // Sin la cadena no hay nada que aprobar; con Freighter, cada operación se aprueba en su ventana.
      aMano: () => app.frozen?.raffleId !== undefined && apruebaAMano(),
      graba: app.frozen?.raffleId !== undefined,
      pantalla,
    });
    // Llegó tarde (el número ya nació): la pantalla completa que se pidió para ella se suelta.
    if (!abrio && pantalla && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
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
  const btn = $<HTMLButtonElement>("btn-draw");
  const box = document.getElementById("wait-box");
  const num = document.getElementById("wait-round");
  const left = document.getElementById("wait-left");
  // El "Ya se sorteó" del sorteo anterior (draw.ts) no sigue: ahora escribe la cuenta.
  if (left) delete left.dataset.i;
  const line = box?.querySelector(".wait-line");
  const grande = document.getElementById("btn-espera");
  if (grande) {
    grande.onclick = abrirEspera;
    grande.style.display = "";
  }
  // En una laptop o un proyector la espera pasa sola a la vista grande, con "Volver" a mano (src/ui/vista-grande.ts).
  if (app.frozen) {
    const clave = `${app.frozen.round}|${app.frozen.raffleId ?? ""}`;
    if (esperaAutoDe !== clave && esperaSola({ ancho: innerWidth, tactil: matchMedia("(pointer: coarse)").matches, busqueda: location.search, guardado: leerGuardado() })) {
      esperaAutoDe = clave;
      abrirEspera();
    }
  }
  if (num && app.frozen) num.textContent = `#${app.frozen.round}`;
  // La conexión está ociosa hasta que nazca la ronda: se baja el motor, y se
  // levanta el worker que va a verificar la firma (la portada no lo carga).
  // Anclado, también la curva en la página: el contrato pide la firma
  // descomprimida.
  if (app.frozen) preloadGame(app.game, app.frozen.names.length);
  prepararFirma();
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
      btn.textContent = T[getLang()].drawIn(reloj);
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
      if (!app.drawn && espera?.esperaAbierta()) espera.nacioElNumero();
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
  if (app.frozen) return;
  // Si la red no deja sellar, el botón lleva la acción del caso (`red.ts`): no se pisa.
  if (hayAccionDeRed()) return;
  const btn = $("btn-freeze");
  btn.dataset.i = "freeze";
  btn.textContent = t(btn.dataset.i);
}

/** Cuándo se soltó el último sorteo para armar el siguiente (`unfreeze`), y cuánto no responde "Sellar" después. */
let soltadoEn = -Infinity;
export const GUARDA_DESPUES_DE_SOLTAR_MS = 700;

/**
 * Sella la lista.
 *
 * Con wallet conectada el sello va al contrato en Stellar, que deja constancia
 * pública con fecha. Sin wallet, el sello se calcula en el navegador: el
 * sorteo sigue siendo verificable, pero nadie atestigua que la lista se cerró
 * antes de que existiera la semilla.
 */
export async function freeze(opciones: OpcionesDeSellado = {}): Promise<void> {
  const names = parseNames();
  if (names.length < 2) return;
  // Recién se soltó el sorteo anterior con "Siguiente premio": un doble toque
  // nervioso caía en "Sellar la lista" y sellaba el próximo premio sin premio,
  // para siempre (diseño del onboarding, 22 de octubre de 2026).
  if (performance.now() - soltadoEn < GUARDA_DESPUES_DE_SOLTAR_MS) return;

  const btn = $<HTMLButtonElement>("btn-freeze");
  // La demo (`?demo=`) y el ensayo son el show con una lista de ejemplo, nunca
  // un sorteo: aunque haya una cuenta abierta no se graba nada ni se espera la
  // cadena (`ensayo-modo.ts`).
  const conCuenta = canAnchor() && !sinGrabar();
  // "Seguir sin sello": la red no dejaba sellar y quien organiza decidió seguir. Es el modo
  // libre, con la ronda a 90 s para seguir intentando sellar esa misma ronda (`sin-sello.ts`).
  const sinSello = conCuenta && !!opciones.sinSello;
  const anchoring = conCuenta && !sinSello;
  const hash = bytesToHex(listHash(names));
  let ts = Math.floor(Date.now() / 1000);
  // Anclando, el margen no baja de 45 s aunque la URL pida menos: por debajo
  // de 30 el contrato rechaza el sello. En el ensayo, 15 s: lo bastante para
  // elegir el juego, y la línea que guía dice que de verdad son unos 45.
  const lead = anchoring
    ? Math.max(ANCHOR_LEAD_SECONDS, LEAD_SECONDS)
    : sinSello
      ? SIN_SELLO_LEAD_SECONDS
      : enEnsayo() && !params.has("lead")
        ? ENSAYO_ESPERA_S
        : LEAD_SECONDS;
  let round = targetRound(ts, lead);
  let prize = $<HTMLInputElement>("prize").value.trim();
  let numWinners = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10) || 1, names.length);

  let raffleId: bigint | undefined;
  let sealTx: string | undefined;

  if (anchoring) {
    const session = currentSession();
    if (!session) return;
    // Lo que se sella ya se tomó del cuadro: mientras se graba, no se toca.
    cerrarLista(true);
    btn.disabled = true;
    const onStep = (step: AnchorStep, detail?: string): void => {
      btn.textContent = stepLabel(step);
      showTxStatus("seal-status", step, detail);
    };
    // Enseguida, antes de cualquier espera: el botón quedaba apagado y diciendo
    // "Sellar en Stellar" mientras se armaba el cliente del contrato, de medio
    // segundo a catorce (`clienteListo` en anchor.ts). Y se va el error de antes.
    onStep("starting");
    // El botón es nuestro mientras se sella: la caja de la red no lo toca (`red.ts`).
    marcarSellado(true);
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
      contar("seal_sent", { network: network.name });
      // Nunca dos sellos de la misma lista (`sello-seguro.ts`, D-17 en docs/architecture.md):
      // - Si la red tarda, la ronda elegida al hacer clic llega a la cadena con menos de los
      //   30 s que exige el contrato y el sello falla (3 de 11 sellos con el RPC público de
      //   testnet, QA del 16 de octubre de 2026): no quedó nada y se reintenta con otra ronda.
      // - Si no se sabe si entró (un corte, una respuesta que no llegó), primero se averigua.
      //   Si no se puede, queda guardado, y el próximo intento empieza por ahí.
      // - Con Freighter hay que aprobar a mano: la ronda va con 45 s más de margen.
      const [seguro, extra] = await Promise.all([import("./sello-seguro"), margenParaAprobar()]);
      const contrato = network.contractId ?? "";
      const previo = seguro.leerPendiente(session.address, hash, network.name, contrato);
      // Sin un intento pendiente lo próximo es armar la transacción: la ronda se elige
      // con el cliente del contrato listo (suele estarlo: se arma al abrir la sesión),
      // para que bajarlo no se coma el margen. Con un intento pendiente, primero se
      // averigua si entró, como siempre, y eso no necesita el cliente.
      if (!previo) await clienteListo();
      const anclado = lead + extra;
      const rondaNueva = (): { round: number; ts: number } => {
        const ahora = Math.floor(Date.now() / 1000);
        return { round: targetRound(ahora, anclado), ts: ahora };
      };
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
          avisar: (que) => onStep(que === "verificando" ? "verifying" : "retrying"),
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
        $<HTMLSelectElement>("nw").value = String(numWinners);
      }
      // Si se supo por la red (se cortó y se averiguó), la línea todavía decía "Revisando…".
      showTxStatus("seal-status", "confirmed", sealTx);
      contar("seal_confirmed", { network: network.name });
    } catch (e) {
      // La pantalla dice algo que se entiende; el detalle técnico queda plegado
      // debajo y en este navegador (`detalle-error.ts`), y en la consola.
      console.warn("[tinkazo] el sello no se pudo grabar", e);
      btn.disabled = false;
      cerrarLista(false);
      btn.dataset.i = "freeze";
      btn.textContent = t("freeze");
      marcarSellado(false);
      // Para el contador, la clave del motivo (la misma del mensaje), nunca el detalle. Se cuenta
      // antes de cualquier camino de la red: un sello que empezó y no entró es un fallo siempre.
      void import("../stellar/errores")
        .then(({ errorKey }) => contar("seal_failed", { network: network.name, error: errorContable(errorKey(e)) }))
        .catch(() => undefined);
      // Dos cosas que la red explica mejor que el error de siempre, con su acción:
      // el sello de verdad cuesta más de lo que el patrocinador paga, o el patrocinador no tiene con qué.
      if (esCostoAlto(e)) {
        hideTxStatus("seal-status");
        await mostrarCostoAlto(e.costoXlm, e.restaurar);
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
      await escribirError(status, e, "sello");
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
}): void {
  if (bytesToHex(listHash(e.names)) !== e.listHash || app.drawn) return;
  const ta = $<HTMLTextAreaElement>("ta");
  ta.value = e.names.join("\n");
  ta.dispatchEvent(new Event("input"));
  ponerPremio(e.prize);
  $<HTMLSelectElement>("nw").value = String(Math.max(1, Math.min(32, e.numWinners)));
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
  ponerTextoDelSello(document.querySelector<HTMLElement>("#wait-box .wait-line"), "lineaDeLaEspera", sin);
}

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
  btn.dataset.i = raffleId !== undefined ? "sealed" : f.sinSello ? "redSinSelloBoton" : "frozenOk";
  btn.textContent = t(btn.dataset.i);
  $("freeze-hint").style.display = "none";
  $("free-rule").style.display = "none";
  $("sec-frozen").style.display = "block";
  textosDelSello();
  $("k-n").textContent = String(names.length);
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
  pintarRecomendacion(names.length);
  // Si nadie eligió otro, queda elegido uno que se recomienda para esta
  // cantidad (D02). La demo juega el que pide su enlace.
  if (!juegoAMano && !params.has("demo")) {
    // Después de un premio, otro juego; la primera vez, el de siempre (D02).
    const g = juegoAnterior ? juegoSiguiente(names.length, juegoAnterior, premiosElegidos()) : juegoPorDefecto(names.length, premiosElegidos());
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
  const text = T[lang].rules({
    prize: f.prize,
    count: f.names.length,
    winners: Math.min(parseInt($<HTMLSelectElement>("nw").value, 10) || 1, f.names.length),
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
    `Seal · list_hash=${f.listHash} · count=${f.names.length} · sealed_at=${f.ts} · target_round=${f.round} · round_time=${roundTime(f.round)}`;
  if (f.raffleId === undefined) {
    const tag = document.createElement("span");
    tag.className = "kicker";
    tag.style.marginLeft = "8px";
    // Sin sello porque la red no dejó: lo dice con todas las letras (no es solo "sin registrar").
    tag.textContent = t(f.sinSello ? "redSinSelloEtiqueta" : "noAnchor");
    el.appendChild(tag);
    return;
  }
  el.append(` · raffle_id=${f.raffleId} · `);
  const a = document.createElement("a");
  a.href = contractUrl();
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = `${network.name} ↗`;
  el.appendChild(a);
}
