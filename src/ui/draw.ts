import { $, esc } from "../dom";
import { T, getLang, onLangChange, t } from "../i18n";
import { CUENTA_SECONDS, LCOLORS, WHEEL_MAX, app, conCuenta, params, playableGame, avatar, forceMotion, setCardSeconds, setShowGate, setYaContaron, skipMotion, skippedForReducedMotion, type Beacon, type Game } from "../state";
import { beep, note } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundUrl } from "../protocol/quicknet";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { network, txUrl } from "../stellar/config";
import { PROOF_VERSION, type Proof, proofUrl } from "../protocol/proof";
import { drawOnChain, escribirError, limpiarDetalle, readDraw, showTxStatus, stepLabel } from "./anchor";
import { loreFor } from "../games/lore";
import { currentSession } from "./wallet-ui";
import { pintarQr } from "./qr";
import { usePixi } from "../games/engine";
import { secondsToRound, unfreeze } from "./freeze";
import { setList } from "./participants";
import { CARD_SECONDS, showGameCard } from "./gamecard";
import { actualizarPaso, verError } from "./siguiente";
import { marcarSalio, olvidarSalieron, ponerPremio } from "./premios";
import { startMusic, stopMusic } from "../music";
import { seguirEnPantallaCompleta } from "../games/overlay";

/** Obtiene la ronda objetivo, verifica su firma y selecciona (protocolo §2, §5). */
async function resolveBeacon(
  round: number,
  onAttempt: (attempt: number, total: number) => void,
): Promise<Beacon> {
  const { signature } = await fetchRound(round, { onAttempt });
  // En un worker, que la cuenta regresiva levantó: la cortina no se traba.
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

export async function draw(): Promise<void> {
  if (!app.frozen || app.drawn || secondsToRound() > 0) return;
  // Tiene que correr dentro del clic: los navegadores no dejan hablar a una
  // página que nunca recibió uno, y esa habilitación después queda pegada.
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.classList.remove("lista");
  btn.textContent = t("fetching");
  // La pantalla completa, en el mismo clic: con cuenta, grabar el sorteo tarda
  // unos segundos y para cuando salía la tarjeta el navegador ya no la
  // concedía. El estadio quedaba dentro de la página.
  pedirPantallaCompleta();
  // Desde la espera en grande, el resultado también sale en grande: se baja ya,
  // para abrirlo en el mismo instante en que se va el estadio.
  if (enGrande()) void import("./pantalla").then((m) => (pantallaLista = m)).catch(() => undefined);
  // Desde la espera en grande, ella misma hace de cortina hasta que el show la
  // tapa (espera.ts), y si algo falla se queda, con la pantalla completa.
  const cortina = skipMotion() || enGrande() ? null : abrirCortina(app.frozen.prize, app.frozen.raffleId !== undefined);
  const sinShow = (): void => {
    cortina?.cerrar();
    if (document.fullscreenElement && !enGrande()) void document.exitFullscreen().catch(() => undefined);
  };

  try {
    // Esto pasa con la sala mirando la pantalla grande. Si un relay no responde
    // hay hasta doce intentos en veintitres segundos, y quedarse mudo todo ese
    // rato es peor que el fallo. Un `alert()` del sistema, peor todavia: rompe el
    // modo estadio y no hay forma de estilarlo.
    const status = $("draw-status");
    status.style.display = "block";
    status.className = "txstatus";
    status.textContent = t("fetching");
    // El detalle de un error de antes ya no es de lo que se ve.
    limpiarDetalle("draw-status");

    let beacon: Beacon;
    try {
      beacon = await resolveBeacon(app.frozen.round, (attempt, total) => {
        if (attempt > 1) status.textContent = T[getLang()].drandTry(attempt, total);
      });
      status.style.display = "none";
    } catch (e) {
      sinShow();
      btn.disabled = false;
      // Sigue siendo lo único que hay que hacer: el pulso vuelve, y el mensaje se ve aunque se haya apretado la barra.
      btn.classList.add("lista");
      btn.textContent = t("drawRetry");
      status.className = "txstatus bad";
      status.textContent = t(e instanceof Error && e.message === "bad-signature" ? "badSig" : "drandDown");
      verError(status);
      return;
    }

    const { names, listHash, raffleId } = app.frozen;
    const nWinners = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10), names.length);
    let winners: number[] = [];
    let drawTx: string | undefined;

    if (raffleId !== undefined) {
      // Anclado: el contrato verifica la firma y decide. Lo que muestra la
      // pantalla es lo que quedó registrado, no un cálculo nuestro.
      //
      // Se reintenta solo, y no es capricho (`sorteo-seguro.ts`). El contrato
      // compara la hora de la ronda contra la **hora de cierre del ledger**, que
      // va unos segundos atrás del reloj del navegador: hay una ventana en la que
      // acá ya es hora y para la cadena todavía no. Y con el wifi de un evento, un
      // corte. Pedirle a alguien que vuelva a apretar el botón, con la sala
      // mirando, es inaceptable. Reintentar el sorteo es seguro: el contrato
      // acepta uno solo por sello.
      // La curva, para pasar la firma al formato del contrato. La cuenta
      // regresiva ya la bajó (ver `freeze`).
      const [{ decompressG1 }, { sortearConReintentos, SORTEO_REINTENTABLE, avisoDelReintento }, { errorKey }] = await Promise.all([
        import("../protocol/drand"),
        import("./sorteo-seguro"),
        import("../stellar/errores"),
      ]);
      const fin = await sortearConReintentos<{ winners: number[]; randomness: string; txHash?: string }>({
        intentar: () =>
          drawOnChain(raffleId, decompressG1(beacon.signature), (step, detail) => {
            btn.textContent = stepLabel(step);
            showTxStatus("draw-status", step, detail);
          }),
        yaEsta: () => readDraw(raffleId),
        reintentable: (e) => SORTEO_REINTENTABLE.has(errorKey(e)),
        alReintentar: (proximo, total, e) => {
          // Dice lo que pasó: la red no contestó, estaba ocupada, la cadena todavía no ve la ronda u otra cosa.
          const aviso = avisoDelReintento(errorKey(e));
          showTxStatus("draw-status", "retrying");
          const status = $("draw-status");
          status.textContent =
            aviso === "drawTry" ? T[getLang()].drawTry(proximo, total) : t(aviso).replace("{i}", String(proximo)).replace("{n}", String(total));
        },
      });
      if (!fin.ok) {
        sinShow();
        // El mensaje de la pantalla es para la sala; el detalle queda plegado
        // debajo, en este navegador y en la consola, por si se repite.
        console.warn("[tinkazo] el sorteo no se pudo grabar", fin.error);
        btn.disabled = false;
        btn.classList.add("lista");
        btn.textContent = t("drawRetry");
        const status = $("draw-status");
        status.style.display = "block";
        status.className = "txstatus bad";
        await escribirError(status, fin.error, "sorteo");
        verError(status);
        return;
      }
      winners = fin.valor.winners;
      if (fin.valor.txHash) drawTx = fin.valor.txHash;
      // Ya estaba registrado (un intento cortado que sí entró, u otra persona): sin enlace a la transacción.
      if (fin.yaEstaba) showTxStatus("draw-status", "confirmed");
    } else {
      winners = select(hexToBytes(beacon.randomness), hexToBytes(listHash), names.length, nWinners);
    }

    // Apagado y diciendo por qué: un "Lanzar el sorteo" gris parecía roto. Con
    // data-i, el cambio de idioma lo traduce en vez de volver a "Lanzar".
    btn.dataset.i = "drawnDone";
    btn.textContent = t("drawnDone");
    // Y la caja de la espera deja de decir "Ya nació. Dale.": ya se sorteó.
    ponerHecho(document.getElementById("wait-left"));
    app.drawn = { beacon, winners, ...(drawTx ? { drawTx } : {}) };
    $("sec-draw").style.display = "block";
    $("seed-label").textContent = `${t("seed")} ${beacon.round}`;
    // Arrancó desde la espera en grande (ella todavía hace de cortina): el show
    // termina en el resultado en grande, sin soltar la pantalla completa.
    granFinal = enGrande() ? { pantalla: !!document.fullscreenElement } : null;
    seguirEnPantallaCompleta(granFinal?.pantalla === true);
    const finish = (): void => reveal(names, winners, beacon, listHash);
    playGame(names, winners, beacon, finish);
    // La tarjeta ya está arriba: la cortina se va sin dejar ver la página.
    cortina?.cerrar();
  } catch (e) {
    // Lo inesperado, en cualquier paso: sin esto la cortina quedaba tapando la
    // pantalla y el botón apagado, con la sala mirando. Se dice lo que fue (un
    // corte de red ya no sale como "la red rechazó la transacción"), con el
    // detalle plegado debajo.
    sinShow();
    console.warn("[tinkazo] el sorteo se cortó", e);
    btn.disabled = false;
    btn.classList.add("lista");
    btn.textContent = t("drawRetry");
    const status = $("draw-status");
    status.style.display = "block";
    status.className = "txstatus bad";
    status.textContent = t("errAnchor.unknown");
    await escribirError(status, e, "sorteo");
    verError(status);
  }
}

/**
 * Pide la pantalla completa mientras el clic todavía cuenta como gesto. Sin
 * gesto no la pide: el navegador la negaría. Pasa cuando el sorteo arranca solo
 * desde la espera en grande, que ya la pidió con su toque y se la deja al show.
 */
function pedirPantallaCompleta(): void {
  const raiz = document.documentElement;
  const gesto = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;
  if (skipMotion() || !gesto || document.fullscreenElement || !raiz.requestFullscreen) return;
  void raiz.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
}

/** La espera en grande está abierta: el sorteo arrancó desde ahí (espera.ts). */
const enGrande = (): boolean => document.querySelector(".espera") !== null;

/**
 * El sorteo arrancó desde la espera en grande, y termina en el resultado en
 * grande (buscador de detalles, D04). Hasta el 21 de octubre de 2026 el show
 * soltaba la pantalla completa al terminar y la sala veía la página de quien
 * organiza, con la cabecera y la cuenta; para volver a ponerlo en grande había
 * que tocar "Mostrar en grande" y se notaba el salto. Quien abrió la espera en
 * grande ya eligió la pantalla grande: sigue ahí hasta que la cierra.
 *
 * `pantalla`: había pantalla completa cuando arrancó. Si al terminar ya no está,
 * quien organiza salió de ella con Escape durante el show, y el resultado va a
 * la página, como siempre. Sin la espera en grande no cambia nada.
 */
let granFinal: { pantalla: boolean } | null = null;
/** `pantalla.ts`, ya bajado: el resultado en grande se abre en el mismo instante en que se va el estadio, sin dejar ver la página. */
let pantallaLista: typeof import("./pantalla") | null = null;

/** "Ya se sorteó", también al cambiar de idioma (`data-i`). La cuenta regresiva del próximo sello lo saca. */
function ponerHecho(el: HTMLElement | null): void {
  if (!el) return;
  el.dataset.i = "drawnDone";
  el.textContent = t("drawnDone");
}

/**
 * Lo que ve la sala mientras llega el número y, con cuenta, se graba el
 * sorteo: el premio y una línea, sin comisiones ni pasos técnicos. Antes la
 * sala leía "Comisión de la red: hasta 0,55 XLM" durante nueve segundos
 * (revisión del experto en sorteos, 16 de octubre de 2026). Aparece si la
 * espera dura más que un instante, para no parpadear cuando el juego sale
 * enseguida.
 */
function abrirCortina(premio: string, graba: boolean): { cerrar: () => void } {
  let el: HTMLElement | null = null;
  const reloj = setTimeout(() => {
    el = document.createElement("div");
    el.className = "cortina";
    el.setAttribute("role", "status");
    el.innerHTML =
      (premio ? `<p class="kicker">${esc(t("cortinaSe"))}</p><h2>${esc(premio)}</h2>` : `<h2>${esc(t("cortinaSin"))}</h2>`) +
      `<p class="cortina-t">${esc(t(graba ? "cortinaGraba" : "cortinaNumero"))}</p>` +
      `<span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span>`;
    document.body.appendChild(el);
  }, 350);
  return {
    cerrar: () => {
      clearTimeout(reloj);
      el?.remove();
    },
  };
}

/**
 * Le pasa el resultado al juego elegido.
 *
 * Ninguno de estos decide nada: reciben el ganador ya calculado y solo lo
 * cuentan. Si un juego no puede con la cantidad de participantes, se cambia
 * por uno que sí, y eso no altera quién ganó.
 */
function playGame(names: string[], winners: number[], beacon: Beacon, finish: () => void): void {
  const pixi = usePixi();
  const game = pixi ? playableGame(app.game, names.length, names, winners) : classicPlayable(app.game, names.length);
  // Antes del juego, la tarjeta de "cómo se juega", grande para la sala. Sus
  // segundos salen del mismo total que eligió quien sortea.
  // "¡Cuenten conmigo!" al final de la tarjeta (state.ts): un tono por número, más alto en el 1.
  // Los dos en la pentatónica, mi y do: el 990 Hz de antes era un si, fuera de la escala de los juegos.
  const cuenta = conCuenta() ? CUENTA_SECONDS : 0;
  const card = skipMotion()
    ? null
    : showGameCard(game, names.length, winners.length, cuenta, (n) => beep(note(n > 1 ? 12 : 15), 0.16, "triangle", 0.07), app.frozen?.prize ?? "");
  setCardSeconds(card ? CARD_SECONDS : 0);
  // Si la sala ya contó con la tarjeta, el juego no vuelve a contar.
  setYaContaron(card !== null && cuenta > 0);
  // La pantalla completa se pide con la tarjeta, mientras el clic de "Sortear"
  // todavía cuenta como gesto: el navegador la niega pasados unos cinco
  // segundos, y el estadio aparece recién cuando la tarjeta termina.
  const raiz = document.documentElement;
  const gesto = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;
  if (card && gesto && !document.fullscreenElement && raiz.requestFullscreen) {
    void raiz.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
  }
  let cerrado = false;
  const fin = (): void => {
    if (cerrado) return;
    cerrado = true;
    card?.hide();
    setCardSeconds(0);
    setShowGate(null);
    // Si el juego no llegó a montarse, la música de la tarjeta queda sonando.
    stopMusic();
    finish();
  };
  // El de respaldo arranca recién cuando termina la tarjeta: muestra el
  // estadio apenas monta y su reloj corre desde ahí. Mientras tanto baja el
  // juego y suena la música, como en el motor nuevo. Si el motor nuevo no
  // arrancó, la tarjeta pasa a decir lo que de verdad se juega.
  const respaldo = (): void => {
    setShowGate(null);
    const real = classicPlayable(app.game, names.length);
    if (card && real !== game) card.update(real);
    const carga = classicModule(real);
    carga.catch(() => undefined);
    if (card) {
      startMusic(parseInt(beacon.randomness.slice(8, 16), 16));
      void card.ready.then(() => classicGame(carga, names, winners, beacon, fin));
    } else classicGame(carga, names, winners, beacon, fin);
  };
  // El motor nuevo, PixiJS con el director de cámara (docs/motores.md), se
  // arma mientras la tarjeta está arriba y espera en la compuerta. Si el
  // equipo no tiene WebGL, si se pide `?motor=clasico`, si el motor no arranca
  // o si el wifi no alcanza a bajarlo, el juego sale con el de siempre.
  if (pixi) {
    setShowGate(card?.ready ?? null);
    void import("../games/pixi")
      .then(
        async (m) => {
          if (!(await m.playPixi(game, names, winners, beacon, fin))) respaldo();
        },
        respaldo,
      )
      // Un error con el juego a medio armar: sin show, pero con ganador.
      .catch(() => fin());
    return;
  }
  respaldo();
}

/** Lo que de verdad juega el motor de respaldo: el resto lo cuenta como la carrera. */
function classicPlayable(game: Game, n: number): Game {
  if (game === "wheel") return n <= WHEEL_MAX ? "wheel" : "tombola";
  if (game === "stellar" || game === "ledger" || game === "pasanaku" || game === "teleferico" || game === "tombola" || game === "rockets") return game;
  return "race";
}

type Clasico = (names: string[], winners: number[], beacon: Beacon, finish: () => void) => void;

/**
 * El motor de siempre, de respaldo. Se baja recién si hace falta: son unos
 * 90 KB que antes viajaban en la página inicial de todo el mundo y solo se
 * usan sin WebGL o con `?motor=clasico`. Se pide apenas se sabe que hace
 * falta, así baja mientras la sala lee la tarjeta.
 */
function classicModule(game: Game): Promise<Clasico> {
  switch (game) {
    case "wheel":
      return import("../games/wheel").then((m) => m.wheelSpin);
    case "stellar":
      return import("../games/constellation").then((m) => m.stellarConstellation);
    case "ledger":
      return import("../games/ledger").then((m) => m.ledgerClose);
    case "pasanaku":
      return import("../games/pasanaku").then((m) => m.pasanaku);
    case "teleferico":
      return import("../games/cablecar").then((m) => m.cableCar);
    case "tombola":
      return import("../games/tombola").then((m) => m.tombola);
    default:
      return import("../games/race").then((m) => (n: string[], w: number[], b: Beacon, f: () => void) => m.stadiumRace(n, w, b, f, game === "rockets" ? "stellar" : "andes"));
  }
}

function classicGame(carga: Promise<Clasico>, names: string[], winners: number[], beacon: Beacon, finish: () => void): void {
  // Si ni el motor de respaldo se alcanza a bajar, el resultado sale igual,
  // sin show: el sorteo ya está decidido y la sala tiene que verlo.
  void carga.then((jugar) => jugar(names, winners, beacon, finish)).catch(() => finish());
}

/**
 * La tarjeta de "¿por qué se llama así?".
 *
 * Va después del ganador y nunca antes: durante el sorteo nadie lee nada, y
 * cuando ya salió el nombre sí. Es voluntaria, tiene dos frases y siempre
 * lleva el enlace a la fuente, porque esto lo va a leer gente que sabe del
 * tema y un dato inventado nos deja sin credibilidad justo donde importa.
 */
function renderLore(beacon: Beacon): void {
  const box = $("lore-box");
  const lo = loreFor(app.game, beacon);
  if (!lo) {
    box.style.display = "none";
    return;
  }
  box.innerHTML =
    `<span class="lore-tab" style="background:var(--${lo.hue})"></span>` +
    `<p class="kicker">${esc(t("loreTitle"))}</p>` +
    `<h3 class="lore-q">${esc(t(lo.q))}</h3>` +
    `<p class="lore-a">${esc(t(lo.a))}</p>` +
    `<a class="mono lore-src" href="${esc(lo.href)}" target="_blank" rel="noopener">${esc(lo.src)} ↗</a>`;
  box.style.display = "block";
}

export function reveal(names: string[], winners: number[], beacon: Beacon, listHash: string): void {
  $("winner-box").style.display = "block";
  // Con el movimiento reducido el juego se salteó: se avisa, para que no parezca roto.
  $("motion-note").style.display = skippedForReducedMotion() ? "block" : "none";
  renderLore(beacon);
  const prize = app.frozen?.prize ?? "";
  // Este premio ya salió: en el próximo sorteo queda marcado entre las opciones.
  marcarSalio(prize);
  // "No está" solo si queda con quién volver a sortear: dos personas, como
  // en "Otro premio".
  const reemplazo = names.length - winners.length >= 2;
  $("winner-cards").innerHTML = winners
    .map((i, k) => {
      const name = names[i] ?? "";
      const tag = prize
        ? `<p class="winner-prize"><span data-i="winsPrize">${esc(t("winsPrize"))}</span> ${esc(prize)}${winners.length > 1 ? ` · #${k + 1}` : ""}</p>`
        : winners.length > 1
          ? `<p class="winner-prize">#${k + 1}</p>`
          : "";
      return `<div class="winner-card" style="transform: rotate(${k % 2 ? 1.5 : -1.5}deg)">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name" id="wn-${k}">${esc(name)}</p>
          ${tag}
          ${reemplazo ? `<div class="ausente" data-k="${k}">${botonAusente(k)}</div>` : ""}
        </div>
      </div>`;
    })
    .join(" ");
  const proof = $("proof");
  proof.textContent =
    `Draw · quicknet round=${beacon.round} · ${t("proofOk")} ✓ · randomness=${beacon.randomness.slice(0, 24)}… · list_hash=${listHash.slice(0, 24)}… · count=${names.length} · winners=[${winners.join(",")}]`;
  const drawTx = app.drawn?.drawTx;
  if (drawTx) {
    proof.append(" · ");
    const a = document.createElement("a");
    a.href = txUrl(drawTx);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = t("onChain") + " ↗";
    proof.appendChild(a);
  }
  const url = roundUrl(beacon.round);
  const dl = $<HTMLAnchorElement>("drand-link");
  dl.href = url;
  dl.textContent = t("drandLink");
  const principal = showAgain();
  confetti();
  programarImagen();
  // El juego pidió bajar a "El sorteo" cuando el resultado todavía estaba
  // escondido: quedaba el selector de juegos arriba y el panel fuera de la
  // pantalla. Con el resultado ya puesto, se encuadra la sección entera.
  requestAnimationFrame(() => $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" }));
  // El comprobante se arma aparte: comprimir la lista es asíncrono y no vale
  // la pena hacer esperar al confeti por eso.
  const enlace = buildProof(names, winners, url);
  // Desde la espera en grande, el resultado sale en grande, con el QR en cuanto
  // esté el comprobante; al cerrarlo, la página sigue con "Siguiente premio".
  const final = granFinal;
  granFinal = null;
  seguirEnPantallaCompleta(false);
  if (final && (!final.pantalla || document.fullscreenElement)) resultadoEnGrande(enlace, principal);
  else enfocarDespues(principal);
}

/** Abre el resultado en grande en el mismo instante, si `pantalla.ts` ya bajó (siempre, salvo un wifi muy lento). */
function resultadoEnGrande(enlace: Promise<string>, volverA: HTMLButtonElement): void {
  const abrir = (m: typeof import("./pantalla")): void => void m.mostrarResultado(enlace, volverA);
  if (pantallaLista) abrir(pantallaLista);
  else void import("./pantalla").then(abrir, () => enfocarDespues(volverA));
}

/**
 * "Ver la animación igual": repite el juego una vez con el movimiento forzado.
 *
 * Solo recibe lo que ya está decidido (`app.drawn`) y su cierre no hace nada
 * más que soltar el forzado: no vuelve a revelar, ni toca el historial ni el
 * comprobante.
 */
/**
 * Una repetición a la vez. Saltar la tarjeta con Enter o espacio también
 * apretaba "Ver la animación igual", que seguía con el foco, y montaba un
 * segundo juego encima del primero (revisión del 4 de octubre de 2026).
 */
let replaying = false;
export function replayAnimation(): void {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || replaying) return;
  replaying = true;
  const btn = document.getElementById("btn-replay") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  forceMotion(true);
  playGame(frozen.names, drawn.winners, drawn.beacon, () => {
    replaying = false;
    if (btn) btn.disabled = false;
    forceMotion(false);
  });
}

/** Quiénes quedan en la lista sellada si se sacan los que ya salieron. */
function sinGanadores(): string[] {
  const { frozen, drawn } = app;
  if (!frozen || !drawn) return [];
  const salieron = new Set(drawn.winners);
  return frozen.names.filter((_, i) => !salieron.has(i));
}

/**
 * Lo que sigue después del ganador, pegado al ganador: cuántos quedan sin
 * premio y qué se hace ahora. Hay una sola acción principal. Si queda con quién
 * sortear, "Siguiente premio" (con cuántas personas quedan); si no, "Compartir
 * el comprobante". Lo demás, secundario. Hasta el 19 de octubre de 2026 esto
 * estaba debajo de la verificación, el QR y la historia, a más de una pantalla
 * de distancia, y "Sortear entre los que quedan" no decía "siguiente".
 *
 * Con menos de dos no hay otro sorteo con esta lista: ese botón se va y la
 * razón queda escrita, no escondida en un title que el proyector no muestra.
 */
function showAgain(): HTMLButtonElement {
  const L = T[getLang()];
  const quedan = sinGanadores().length;
  const alcanza = quedan >= 2;
  const sin = $<HTMLButtonElement>("btn-again-sin");
  const comprobante = $<HTMLButtonElement>("btn-proof");
  sin.style.display = alcanza ? "" : "none";
  sin.textContent = L.againSin(quedan);
  comprobante.className = alcanza ? "ghost" : "primary";
  $("btn-again-nueva").className = "ghost";
  // La principal va primero, también en el orden del teclado y del lector. Solo
  // si no lo está: sacarla y volverla a poner le quita el foco, y esto también
  // corre al cambiar de idioma.
  const principal = alcanza ? sin : comprobante;
  const acciones = $("again-acciones");
  if (acciones.firstElementChild !== principal) acciones.prepend(principal);
  const titulo = $("again-t");
  titulo.dataset.i = alcanza ? "againTitle" : "againTitleFin";
  titulo.textContent = t(titulo.dataset.i);
  $("again-left").textContent = alcanza ? L.againLeft(quedan) : L.againFew(quedan);
  $("again-row").style.display = "block";
  actualizarPaso();
  return principal;
}

/**
 * Después del ganador, la acción principal con el foco, como "Lanzar el
 * sorteo" cuando nace la ronda: se sigue con Enter, sin ir a buscar el botón
 * con el mouse. Al cerrar el estadio el foco quedaba en el cuerpo de la página
 * (buscador de detalles, D11).
 *
 * Con cuidado, porque un Enter de más ya hizo daño: el 4 de octubre de 2026
 * uno apretó "Ver la animación igual", y "No está" deja el foco en "Cancelar"
 * para que dos Enter no saquen al ganador. Por eso va un momento después del
 * resultado, y solo si el foco no está en ningún lado: no se lo quita a nadie.
 * Nunca al repintar por un cambio de idioma (eso llama a `showAgain` solo).
 * "Siguiente premio" no borra el sorteo, que sigue en Mis sorteos y en su
 * comprobante. Si el botón quedó fuera de la pantalla y la barra de "lo que
 * sigue" lo ofrece, el foco va al de la barra: es el que se ve.
 */
function enfocarDespues(boton: HTMLButtonElement): void {
  window.setTimeout(() => {
    const a = document.activeElement as HTMLElement | null;
    const enNingunLado = !a || a === document.body || (a instanceof HTMLButtonElement && a.disabled) || a.offsetParent === null;
    if (!enNingunLado || !app.drawn || boton.offsetParent === null) return;
    const barra = document.getElementById("siguiente");
    const deLaBarra = barra?.classList.contains("on") ? document.getElementById("sig-btn") : null;
    (deLaBarra ?? boton).focus({ preventScroll: true });
  }, 1000);
}
onLangChange(() => {
  if (app.drawn && $("again-row").style.display !== "none") showAgain();
});

/**
 * "Otro sorteo": deja la herramienta lista para el siguiente, sin recargar la
 * página. Con la misma lista sin los que ya ganaron, o con una lista nueva; en
 * los dos casos el juego se vuelve a elegir al sellar. Hasta el 16 de octubre
 * de 2026 no había cómo: después del primero, sellar y sortear quedaban
 * apagados y la pestaña "Nuevo sorteo" solo cambiaba de vista.
 */
export function newDraw(modo: "sinGanadores" | "otraLista" | "ausente", k = -1): void {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || replaying) return;
  const conLista = modo !== "otraLista";
  const quedan = conLista ? sinGanadores() : [];
  if (conLista && quedan.length < 2) return;
  const salieron = drawn.winners.map((i) => frozen.names[i] ?? "").filter(Boolean);
  const ausente = modo === "ausente" ? (frozen.names[drawn.winners[k] ?? -1] ?? "") : "";
  if (modo === "ausente" && !ausente) return;
  const premio = frozen.prize;
  // La lista sellada se guarda: "Usar otra lista" vacía el cuadro, y un clic
  // equivocado frente a la sala no puede costar la lista de Luma filtrada.
  anterior = frozen.names;
  app.drawn = null;
  unfreeze(quedan.join("\n"));
  // Con otra lista empieza otra sentada: los premios ya no figuran como "ya salió".
  if (modo === "otraLista") olvidarSalieron();
  // "Premios" no puede quedar en más que los que quedan: con 2 personas y 3
  // premios, el próximo sorteo los premiaba a todos sin avisar.
  const nw = $<HTMLSelectElement>("nw");
  if (modo === "ausente") {
    // El reemplazo es uno solo y se lleva lo mismo que se iba a llevar quien
    // no estaba. Los otros ganadores, si los hubo, se quedan con lo suyo y no
    // entran a este sorteo.
    nw.value = "1";
    ponerPremio(premio);
  } else if (quedan.length) nw.value = String(Math.max(1, Math.min(parseInt(nw.value, 10) || 1, quedan.length - 1)));
  // Arriba del cuadro, qué cambió: quién salió de la lista, o cómo volver.
  const L = T[getLang()];
  const nota = $("again-note");
  nota.textContent =
    modo === "sinGanadores" ? L.againQuitados(salieron, quedan.length) : modo === "ausente" ? L.ausenteNota(ausente, quedan.length, salieron.length > 1) : "";
  nota.style.display = conLista ? "block" : "none";
  $("btn-recuperar").style.display = modo === "otraLista" ? "" : "none";
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = false;
  btn.dataset.i = "draw";
  btn.textContent = t("draw");
  // Sin restos del anterior: con el movimiento reducido el próximo resultado
  // sale sin juego, y no puede asomar el ganador viejo mientras tanto.
  for (const id of ["draw-status", "reverify-out", "again-row", "winner-box", "lore-box", "qr-box", "sec-draw"]) {
    $(id).style.display = "none";
  }
  limpiarDetalle("draw-status");
  $("winner-cards").innerHTML = "";
  $("sec-participants").scrollIntoView({ behavior: "smooth", block: "start" });
  // Con la lista lista, lo que sigue es nombrar el premio nuevo: si no, el
  // cartel no dice qué se lleva y en Mis sorteos todos se llaman igual. Con la
  // lista vacía, lo que sigue es cargarla.
  // Con "No está" ya están la lista, el premio y la cantidad: lo que sigue es
  // sellar.
  if (modo === "sinGanadores") $<HTMLInputElement>("prize").focus({ preventScroll: true });
  else if (modo === "ausente") $<HTMLButtonElement>("btn-freeze").focus({ preventScroll: true });
  else $<HTMLTextAreaElement>("ta").focus({ preventScroll: true });
  actualizarPaso();
}

/** El botón "No está" de una tarjeta; describe a quién se refiere con el nombre de la tarjeta. */
const botonAusente = (k: number): string =>
  `<button class="ausente-btn" type="button" data-ausente aria-describedby="wn-${k}" data-i="ausenteBtn">${esc(t("ausenteBtn"))}</button>`;

const preguntaAusente = (): string =>
  `<p class="ausente-q" data-i="ausenteQ">${esc(t("ausenteQ"))}</p>` +
  `<button class="ausente-btn si" type="button" data-ausente-si data-i="ausenteSi">${esc(t("ausenteSi"))}</button>` +
  `<button class="ausente-btn" type="button" data-ausente-no data-i="ausenteNo">${esc(t("ausenteNo"))}</button>`;

/**
 * "No está": quien ganó ya se fue, cosa que pasa en casi todo evento. Su
 * premio vuelve a sortearse entre los que quedan, con un sello nuevo: el
 * sorteo de recién queda como está, en Mis sorteos y en su comprobante, y el
 * reemplazo tiene el suyo. Pide confirmación en la misma tarjeta, porque un
 * clic de más frente a la sala no puede borrar al ganador de la pantalla.
 */
export function alTocarGanadores(e: Event): void {
  const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
  const caja = b?.closest<HTMLElement>(".ausente");
  if (!b || !caja) return;
  const k = Number(caja.dataset.k);
  if (b.dataset.ausenteSi !== undefined) {
    newDraw("ausente", k);
    return;
  }
  const preguntar = b.dataset.ausente !== undefined;
  caja.innerHTML = preguntar ? preguntaAusente() : botonAusente(k);
  // El foco va a "Cancelar": con él en "Sí", dos Enter seguidos borraban al ganador.
  caja.querySelector<HTMLButtonElement>(preguntar ? "[data-ausente-no]" : "[data-ausente]")?.focus({ preventScroll: true });
}

/** La imagen para redes (imagen.ts): en el celular, el menú de compartir; en la computadora, la descarga. */
export function imagenRedes(btn: HTMLButtonElement): void {
  void import("./imagen").then((m) => m.compartirImagen(btn));
}

/**
 * La imagen se arma de antemano, cuando termina el festejo: compartir desde el
 * celular tiene que salir del mismo toque. En la demo no hay botón.
 */
function programarImagen(): void {
  if (document.body.dataset.demo === "1") return;
  const armar = (): void => {
    void import("./imagen").then((m) => m.prepararImagen()).catch(() => undefined);
  };
  setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(armar, { timeout: 2000 }) : armar()), 1200);
}

/** Al apoyar el dedo en el botón: si todavía no estaba, se empieza a armar antes del toque. */
export function adelantarImagen(): void {
  void import("./imagen").then((m) => m.prepararImagen()).catch(() => undefined);
}

/** La lista del sorteo anterior, para "Recuperar la lista anterior". */
let anterior: string[] = [];

/** Vuelve a poner en el cuadro la lista del sorteo anterior, entera. */
export function recuperarLista(): void {
  if (!anterior.length || app.frozen) return;
  setList(anterior.join("\n"));
  $("btn-recuperar").style.display = "none";
  $("btn-freeze").focus({ preventScroll: true });
}

let proofLink = "";

/** El resultado en grande para el proyector, con el QR del comprobante (pantalla.ts). */
export function mostrarGrande(): void {
  void import("./pantalla").then((m) => m.mostrarResultado(proofLink));
}

/**
 * Dibuja el QR del comprobante en el navegador.
 *
 * Nunca sale a internet a buscarlo: el enlace lleva los nombres en el
 * fragmento, y mandárselo a otro servidor para que dibuje un cuadradito
 * anulaba toda la disciplina de privacidad del producto. Además, así funciona
 * con el wifi del evento caído.
 */
async function paintQr(link: string): Promise<void> {
  const box = $("qr-box");
  const img = $<HTMLImageElement>("qr-img");
  try {
    if (!(await pintarQr(img, link))) {
      // Una lista enorme no entra en un QR. El enlace se sigue pudiendo
      // copiar y compartir, así que se esconde el recuadro y ya.
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
  } catch {
    box.style.display = "none";
  }
}

/**
 * Arma el comprobante y apunta el QR y los avisos a la página de verificación,
 * que es donde el participante puede rehacer el sorteo por su cuenta. Devuelve
 * el enlace, para el QR del resultado en grande.
 */
async function buildProof(names: string[], winners: number[], roundLink: string): Promise<string> {
  const f = app.frozen;
  const d = app.drawn;
  if (!f || !d) return "";
  const proof: Proof = {
    v: PROOF_VERSION,
    names,
    round: d.beacon.round,
    sealedAt: f.ts,
    ...(f.prize ? { prize: f.prize } : {}),
    // La firma va siempre, esté anclado o no. Antes solo la llevaba el
    // comprobante de modo libre, que es el "peor": el anclado dependía de que
    // el RPC contestara y de que la entrada no estuviera archivada, así que un
    // comprobante de hoy abierto dentro de unos años no probaba nada. Con la
    // firma adentro, la matemática se puede rehacer siempre; el veredicto
    // verde sigue exigiendo que la cadena atestigüe la lista.
    signature: d.beacon.signature,
    ...(f.raffleId !== undefined
      ? { net: network.name, contract: network.contractId ?? "", id: String(f.raffleId) }
      : {}),
  };
  let link: string;
  try {
    link = await proofUrl(proof);
  } catch {
    // Sin comprobante, el QR al menos lleva a la ronda del faro.
    link = roundLink;
  }
  proofLink = link;
  // Y ahora se completa la fila del historial con el ganador y el comprobante.
  // Una demo no es un sorteo: no se anota en Mis sorteos aunque haya cuenta,
  // igual que en el sello (freeze.ts). Anotarla además borraba la bienvenida.
  const f2 = app.frozen;
  const who = params.has("demo") ? undefined : currentSession()?.address;
  if (f2 && who) {
    void import("./history").then((h) => {
      h.remember({
        organizer: who,
        listHash: f2.listHash,
        count: names.length,
        numWinners: winners.length,
        round: d.beacon.round,
        sealedAt: f2.ts,
        prize: f2.prize,
        winners: winners.map((i) => names[i] ?? ""),
        proof: link,
        ...(f2.raffleId !== undefined ? { id: String(f2.raffleId) } : {}),
        ...(d.drawTx ? { drawTx: d.drawTx } : {}),
      });
      h.renderHistory(who);
    });
  }
  // Los avisos primero: el QR carga su librería aparte y tarda, y hacer
  // esperar a los botones de "avisarle por WhatsApp" por un cuadradito los
  // dejaba sin armar justo cuando el ganador aparece en pantalla.
  setNotifyLinks(names, winners, link);
  void paintQr(link);
  return link;
}

/**
 * Lo que se pega en el grupo: quién ganó, entre cuántos, el premio y el enlace
 * para verificarlo. Era un bloque técnico, sin el premio ni el comprobante
 * (revisión del 16 de octubre de 2026). Lo técnico sigue en "Detalles técnicos"
 * y en el comprobante.
 */
function mensajeDelSorteo(): string {
  if (!app.frozen || !app.drawn) return "";
  const { names, prize } = app.frozen;
  const { beacon, winners } = app.drawn;
  const lista = winners.map((i) => names[i] ?? "");
  const quienes = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(lista);
  return T[getLang()].summary(quienes, names.length, prize, proofLink || roundUrl(beacon.round), lista.length > 1);
}

/** Copia el mensaje y avisa en el botón. Devuelve false si el navegador no deja copiar. */
async function copiarMensaje(btn: HTMLButtonElement, texto: string, aviso: "copied" | "proofCopied", ms: number): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    return false;
  }
  const orig = btn.textContent;
  btn.textContent = t(aviso);
  setTimeout(() => (btn.textContent = orig), ms);
  return true;
}

/**
 * "Compartir el resultado": en el celular, el menú de compartir del sistema con
 * el mensaje; en la computadora, copia el mensaje para pegarlo en el grupo.
 */
export async function shareProof(btn: HTMLButtonElement): Promise<void> {
  const texto = mensajeDelSorteo();
  if (!texto) return;
  if (matchMedia("(pointer: coarse)").matches && typeof navigator.share === "function") {
    try {
      await navigator.share({ text: texto });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Si el navegador no deja compartir, se copia como en la computadora.
    }
  }
  if (!(await copiarMensaje(btn, texto, "proofCopied", 1800)) && proofLink) {
    window.open(proofLink, "_blank", "noopener");
  }
}

/**
 * Avisar al ganador sin servidor ni base de datos: los botones abren WhatsApp
 * o el cliente de correo del organizador con el mensaje ya escrito, incluido el
 * enlace para que el ganador verifique por su cuenta. Tinkazo no manda nada ni
 * guarda ningún contacto.
 */
function setNotifyLinks(names: string[], winners: number[], url: string): void {
  const prize = app.frozen?.prize ?? "";
  // "Ana, Beto y Carla", no "Ana, Beto, Carla"; y en plural si son varios.
  const lista = winners.map((i) => names[i] ?? "");
  const who = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(lista);
  const body = T[getLang()].tellBody(who, prize, names.length, url, lista.length > 1);
  $<HTMLAnchorElement>("btn-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(body)}`;
  $<HTMLAnchorElement>("btn-email").href =
    `mailto:?subject=${encodeURIComponent(t("tellSubject"))}&body=${encodeURIComponent(body)}`;
}

/** Rehace la verificación de la firma y la selección desde cero (protocolo §7). */
export async function reverify(): Promise<void> {
  if (!app.frozen || !app.drawn) return;
  const { names, listHash } = app.frozen;
  const { beacon, winners } = app.drawn;
  const sigOk = await verifyRoundAsync(beacon.round, beacon.signature);
  const seedOk = bytesToHex(randomnessOf(beacon.signature)) === beacon.randomness;
  const again = select(hexToBytes(beacon.randomness), hexToBytes(listHash), names.length, winners.length);
  const ok = sigOk && seedOk && JSON.stringify(again) === JSON.stringify(winners);
  const out = $("reverify-out");
  out.style.display = "block";
  out.textContent = ok ? t(winners.length > 1 ? "reverifyOkMany" : "reverifyOk") : "✗";
}

/** "Copiar el mensaje": el mismo texto que "Compartir el resultado", siempre al portapapeles. */
export async function copySummary(btn: HTMLButtonElement): Promise<void> {
  const texto = mensajeDelSorteo();
  if (texto) await copiarMensaje(btn, texto, "copied", 1600);
}

export function confetti(): void {
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = LCOLORS.map((c) => `var(${c})`);
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length] ?? "";
    p.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    p.style.animationDelay = Math.random() * 0.6 + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}
