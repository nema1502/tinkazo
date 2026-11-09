import { $, esc } from "../dom";
import { T, getLang, onLangChange, t } from "../i18n";
import { CUENTA_SECONDS, LCOLORS, WHEEL_MAX, app, conCuenta, params, playableGame, avatar, forceMotion, setCardSeconds, setShowGate, setYaContaron, skipMotion, skippedForReducedMotion, type Beacon, type Game } from "../state";
import { enEnsayo, enPractica, enStand, faroDeStand, sinGrabar } from "../ensayo-modo";
import { beep, note, sonidoDelJuego } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundUrl } from "../protocol/quicknet";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { network, txUrl } from "../stellar/config";
import { PROOF_VERSION, type Proof, proofUrl } from "../protocol/proof";
import { pideProtegerLaCuenta, protegerLaCuenta } from "./proteger-flujo";
import { cuentaPatrocinada, drawOnChain, escribirError, existenciaDelSorteo, limpiarDetalle, readDraw, showTxStatus, stepLabel } from "./anchor";
import type { AccionError } from "./error-accion";
import { loreFor } from "../games/lore";
import { pintarLeyenda } from "./leyenda";
import { currentSession } from "./wallet-ui";
import { pintarQrDelComprobante } from "./qr";
import { usePixi } from "../games/engine";
import { alElegirDespuesDelResultado, irAlSelectorParaOtro, juegoParaVerDeNuevo, marcarShow, pintarNotaDelJuego, rotarJuego, secondsToRound, unfreeze } from "./freeze";
import { listaVinoDeLuma, setList } from "./participants";
import { CARD_SECONDS, type GameCard, showGameCard } from "./gamecard";
import { actualizarPaso, verError } from "./siguiente";
import { marcarSalio, olvidarSalieron, ponerPremio } from "./premios";
import { ganadoresPedidos, ponerGanadores } from "./ganadores";
import { alTocarAusente, htmlDeGanadores } from "./resultado-ganadores";
import { acortar, alAcortar, cortoGuardado, ponerLogoDeRuta, rutaDe } from "../enlace-corto";
import { logoPorHuella } from "../logo-guardado";
import { pintarLogoEnElResultado, quitarLogoDelResultado } from "./logo-sorteo";
import { startMusic, stopMusic } from "../music";
import { seguirEnPantallaCompleta } from "../games/overlay";
import { pedirPantallaCompleta, soltarPantallaCompleta } from "./pantalla-completa";
import { contar, contarPractica, errorContable, refDe } from "../contar";
import { acreditarEnSegundoPlano } from "../stellar/monedas-eventos";
import { ponerTextoDelSello } from "./sin-sello-textos";
import { accionDePagarConMiCuenta, elegirPagarConMiCuenta, sePuedeSortearPagando, tomarLaEleccion } from "./sortear-propio";
import { etiquetaConCuenta, etiquetaDe, hayEtiquetas, nombresDeLosEquipos, paraMostrar } from "../equipos/etiquetas";
import { ponerNombresEnteros } from "../games/nombres-enteros";
import { pagosActivos } from "../stellar/pagos-bandera";

/** Obtiene la ronda objetivo, verifica su firma y selecciona (protocolo §2, §5). */
async function resolveBeacon(
  round: number,
  onAttempt: (attempt: number, total: number) => void,
): Promise<Beacon> {
  // El modo stand nunca toca la red para elegir, con o sin internet: no hay dos caminos ni detección de red que falle en vivo.
  if (enStand()) return faroDeStand(round);
  const { signature } = await fetchRound(round, { onAttempt });
  // En un worker, que la cuenta regresiva levantó: la cortina no se traba.
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

/** La acción corresponde al sello que falló; nunca se hereda al siguiente sorteo. */
let recuperacion: { sello: NonNullable<typeof app.frozen>; accion: AccionError } | null = null;

/** Ya se abrió "Protegé tu cuenta" en este intento de sortear: si vuelve a pedirla, se dice y no se repite. */
let protegiendoElSorteo = false;

export async function draw(): Promise<void> {
  if (recuperacion?.sello === app.frozen) {
    recuperacion.accion.ejecutar();
    return;
  }
  recuperacion = null;
  if (!app.frozen || app.drawn || secondsToRound() > 0) return;
  // "Sortear pagando con mi cuenta", si se eligió: vale para este intento y no se hereda al siguiente.
  const pagarConMiCuenta = tomarLaEleccion();
  // Tiene que correr dentro del clic: los navegadores no dejan hablar a una
  // página que nunca recibió uno, y esa habilitación después queda pegada.
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.classList.remove("lista");
  btn.textContent = t("fetching");
  // La pantalla completa, en el mismo clic: con cuenta, grabar el sorteo tarda
  // unos segundos y para cuando salía la tarjeta el navegador ya no la
  // concedía. El estadio quedaba dentro de la página. Si no se está en grande
  // todavía, es el momento (26 de octubre de 2026: lo mismo que al sellar).
  pedirPantallaDelSorteo();
  // Desde la espera en grande, el resultado también sale en grande: se baja ya,
  // para abrirlo en el mismo instante en que se va el estadio.
  if (enGrande()) void import("./pantalla").then((m) => (pantallaLista = m)).catch(() => undefined);
  // Desde la espera en grande, ella misma hace de cortina hasta que el show la
  // tapa (espera.ts), y si algo falla se queda, con la pantalla completa.
  const cortina = skipMotion() || enGrande() ? null : abrirCortina(app.frozen.prize, app.frozen.raffleId !== undefined);
  const sinShow = (): void => {
    cortina?.cerrar();
    if (!enGrande()) soltarPantallaCompleta();
  };
  /** Con cuenta, la tarjeta del juego sale mientras se graba (ver abajo); si algo falla, se va con la cortina. */
  let tarjeta: Previa | null = null;
  /** Para el contador: un sorteo sin anclar no se cuenta, y uno anclado se cuenta una vez, al saber cómo terminó. */
  let contado = app.frozen.raffleId === undefined;

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
    const nWinners = Math.min(ganadoresPedidos(), names.length);
    let winners: number[] = [];
    let drawTx: string | undefined;

    if (raffleId !== undefined) {
      // La tarjeta de "cómo se juega" sale ya, mientras se graba: antes la sala
      // miraba la cortina siete u ocho segundos y recién después la tarjeta
      // (evaluación crítica de experiencia, hallazgo 3). No dice quién ganó, y
      // la cuenta de la sala y el juego esperan a que quede grabado.
      let grabado: () => void = () => undefined;
      const espera = new Promise<void>((r) => (grabado = r));
      const juego = juegoDe(names.length, nWinners);
      const card = abrirTarjeta(juego, names.length, nWinners, espera);
      if (card) {
        tarjeta = { card, game: juego };
        cortina?.cerrar();
      }
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
      const [{ decompressG1 }, { sortearConReintentos, sorteoReintentable, avisoDelReintento }, { errorKey }] = await Promise.all([
        import("../protocol/drand"),
        import("./sorteo-seguro"),
        import("../stellar/errores"),
      ]);
      const fin = await sortearConReintentos<{ winners: number[]; randomness: string; txHash?: string }>({
        intentar: () =>
          drawOnChain(
            raffleId,
            decompressG1(beacon.signature),
            (step, detail) => {
              btn.textContent = stepLabel(step, "sorteo");
              showTxStatus("draw-status", step, detail);
            },
            { pagarConMiCuenta },
          ),
        yaEsta: () => readDraw(raffleId),
        reintentable: sorteoReintentable,
        alReintentar: (proximo, total, e) => {
          // Dice lo que pasó: la red no contestó, estaba ocupada, la cadena todavía no ve la ronda u otra cosa.
          const aviso = avisoDelReintento(errorKey(e));
          showTxStatus("draw-status", "retrying");
          const status = $("draw-status");
          status.textContent =
            aviso === "drawTry" ? T[getLang()].drawTry(proximo, total) : t(aviso).replace("{i}", String(proximo)).replace("{n}", String(total));
        },
      });
      contado = true;
      // Pollar 0.12 (mainnet): la cuenta pide una forma de recuperarla antes de firmar. Se abre "Protegé tu cuenta" y, si
      // la protege, se sortea de nuevo, una sola vez por intento (el contrato acepta un solo sorteo por sello, así que
      // repetirlo es seguro). Si no la protege, se cuenta y se dice como cualquier otro fallo, con el botón para volver.
      if (!fin.ok && !protegiendoElSorteo && (await pideProtegerLaCuenta(fin.error))) {
        tarjeta?.card.hide();
        sinShow();
        protegiendoElSorteo = true;
        try {
          if (await protegerLaCuenta(btn, "draw-status")) {
            // Lo elegido para este intento sigue valiendo para el que se repite.
            if (pagarConMiCuenta) elegirPagarConMiCuenta();
            await draw();
            return;
          }
        } finally {
          protegiendoElSorteo = false;
        }
      }
      if (!fin.ok) {
        contar("draw_failed", { network: network.name, error: errorContable(errorKey(fin.error, { patrocinada: await cuentaPatrocinada() }), fin.error) });
        tarjeta?.card.hide();
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
        const clave = errorKey(fin.error);
        if (clave === "notFound" || clave === "alreadyDrawn") {
          await ofrecerRecuperacion(status, clave, beacon);
        } else {
          // El servicio que cubre la comisión no pudo y la lista ya está sellada: si la cuenta tiene con qué pagar la
          // suya, esa es la segunda salida (la primera sigue siendo reintentar).
          const segunda = (await sePuedeSortearPagando(fin.error)) ? accionDePagarConMiCuenta() : undefined;
          verError(status, undefined, segunda);
          if (segunda) ponerSegundaAccion(status, segunda);
        }
        return;
      }
      winners = fin.valor.winners;
      if (fin.valor.txHash) drawTx = fin.valor.txHash;
      // Ya estaba registrado (un intento cortado que sí entró, u otra persona): sin enlace a la transacción.
      if (fin.yaEstaba) showTxStatus("draw-status", "confirmed");
      // Quedó grabado: la tarjeta sigue con la cuenta de la sala, y después el juego.
      grabado();
      contar("draw_confirmed", { network: network.name });
      // El primer sorteo de la cuenta suma monedas (detrás de VITE_MONEDAS; el demo y el ensayo no cuentan: no graban).
      const cuenta = sinGrabar() ? undefined : currentSession()?.address;
      if (cuenta) acreditarEnSegundoPlano(cuenta, "primer_sorteo");
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
    playGame(names, winners, beacon, finish, tarjeta);
    // La tarjeta ya está arriba: la cortina se va sin dejar ver la página.
    cortina?.cerrar();
  } catch (e) {
    // Lo inesperado, en cualquier paso: sin esto la cortina quedaba tapando la
    // pantalla y el botón apagado, con la sala mirando. Se dice lo que fue (un
    // corte de red ya no sale como "la red rechazó la transacción"), con el
    // detalle plegado debajo.
    tarjeta?.card.hide();
    sinShow();
    console.warn("[tinkazo] el sorteo se cortó", e);
    if (!contado) {
      void import("../stellar/errores")
        .then(async ({ errorKey }) => contar("draw_failed", { network: network.name, error: errorContable(errorKey(e, { patrocinada: await cuentaPatrocinada() }), e) }))
        .catch(() => undefined);
    }
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
 * "Sortear pagando con mi cuenta", debajo del motivo. Vive dentro del mensaje: cuando el mensaje se reescribe o se
 * esconde, se va con él. Elige pagar con la propia cuenta y sortea de nuevo, que es seguro: el contrato acepta un solo
 * sorteo por sello y el ganador no depende de quién paga.
 */
function ponerSegundaAccion(status: HTMLElement, segunda: AccionError): void {
  const b = document.createElement("button");
  b.type = "button";
  b.id = "draw-propio";
  b.className = "ghost mini";
  b.dataset.i = "sortearPropio";
  b.textContent = segunda.texto;
  b.style.display = "block";
  b.style.marginTop = "10px";
  b.addEventListener("click", () => {
    segunda.ejecutar();
    void draw();
  });
  status.append(b);
}

/** Recupera el paso, no la operación: preparar no sella y consultar no vuelve a sortear. */
async function ofrecerRecuperacion(status: HTMLElement, causa: "notFound" | "alreadyDrawn", beacon: Beacon): Promise<void> {
  const sello = app.frozen;
  if (!sello || sello.raffleId === undefined) return;
  const ausencia = causa === "notFound" && await existenciaDelSorteo(sello.raffleId) === "ausente";
  // El comprobante consulta exactamente este número, contrato y red; no depende
  // de que el historial local lo contenga, y conserva el hash del sello si existe.
  const enlace = ausencia ? "" : await proofUrl({
    v: PROOF_VERSION, names: sello.names, round: sello.round, sealedAt: sello.ts,
    prize: sello.prize, net: network.name, contract: network.contractId ?? "",
    id: String(sello.raffleId), signature: beacon.signature,
    ...(sello.sealTx ? { stx: sello.sealTx } : {}),
  });
  if (app.frozen !== sello) return;
  const clave = ausencia ? "drawPreparar" : "drawConsultar";
  const accion: AccionError = {
    texto: t(clave),
    ejecutar: () => {
      if (app.frozen !== sello) return;
      if (!ausencia) { location.assign(enlace); return; }
      const cantidad = ganadoresPedidos();
      recuperacion = null;
      // Usa el camino existente: cancela esperas/reintentos, abre los campos y
      // activa la guarda contra doble toque. No toca la sesión ni la red.
      unfreeze(sello.names.join("\n"));
      ponerPremio(sello.prize);
      ponerGanadores(cantidad);
      status.style.display = "none";
      $<HTMLButtonElement>("btn-draw").dataset.i = "draw";
      $("sec-participants").scrollIntoView({ block: "start" });
      $("btn-freeze").focus({ preventScroll: true });
      actualizarPaso();
    },
  };
  recuperacion = { sello, accion };
  const btn = $("btn-draw");
  btn.dataset.i = clave;
  btn.textContent = accion.texto;
  status.textContent = t(ausencia ? "drawAusente" : causa === "notFound" ? "drawSinConfirmar" : "errAnchor.alreadyDrawn");
  verError(status, accion);
}

/**
 * Pide la pantalla completa mientras el clic todavía cuenta como gesto. Sin
 * gesto no la pide: el navegador la negaría. Pasa cuando el sorteo arranca solo
 * desde la espera en grande, que ya la tiene (la pidió el clic de "Sellar la
 * lista") y se la deja al show. Si la persona la soltó con Escape o con "Volver
 * a la página", no se la fuerza otra vez en esta sesión (`vista-grande.ts`).
 * Con el movimiento reducido no hay show, y no hay nada que poner en grande.
 */
function pedirPantallaDelSorteo(): void {
  if (skipMotion()) return;
  pedirPantallaCompleta();
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

/** La tarjeta del juego que ya salió mientras se grababa el sorteo, con el juego que anuncia. */
interface Previa {
  card: GameCard;
  game: Game;
}

/** El juego que de verdad se juega para esta cantidad: el del motor nuevo, o el del de respaldo. */
function juegoDe(people: number, prizes: number, names?: string[], winners?: number[]): Game {
  return usePixi()
    ? playableGame(app.game, people, names, winners ?? Array.from({ length: prizes }, () => 0))
    : classicPlayable(app.game, people);
}

/**
 * La tarjeta de "cómo se juega", grande para la sala. Sus segundos salen del
 * mismo total que eligió quien sortea. Sin show (instantáneo o movimiento
 * reducido), ninguna. "¡Cuenten conmigo!" al final de la tarjeta (state.ts): un
 * tono por número, más alto en el 1. Los dos en la pentatónica, mi y do: el
 * 990 Hz de antes era un si, fuera de la escala de los juegos.
 */
function abrirTarjeta(game: Game, people: number, prizes: number, espera?: Promise<void>): GameCard | null {
  if (skipMotion()) return null;
  const cuenta = conCuenta() ? CUENTA_SECONDS : 0;
  return showGameCard(game, people, prizes, cuenta, (n) => beep(note(n > 1 ? 12 : 15), 0.16, "triangle", 0.07), app.frozen?.prize ?? "", espera);
}

/**
 * Le pasa el resultado al juego elegido.
 *
 * Ninguno de estos decide nada: reciben el ganador ya calculado y solo lo
 * cuentan. Si un juego no puede con la cantidad de participantes, se cambia
 * por uno que sí, y eso no altera quién ganó.
 *
 * `previa`: la tarjeta que ya está arriba, porque salió mientras se grababa el
 * sorteo (`draw`). Si con los ganadores de verdad el juego cambia, la tarjeta
 * pasa a anunciar el que se juega.
 */
function playGame(names: string[], winners: number[], beacon: Beacon, finish: () => void, previa: Previa | null = null): void {
  // Los equipos con cupón se ven por el nombre de su equipo; la lista sellada y el comprobante siguen con las cuentas.
  names = paraMostrar(names);
  // Y su nombre va entero en el show: «¡Vamos, Las Wawas!», nunca «Las W.». Sin equipos la lista queda vacía.
  ponerNombresEnteros(hayEtiquetas() ? nombresDeLosEquipos() : []);
  const pixi = usePixi();
  const game = juegoDe(names.length, winners.length, names, winners);
  // Los archivos de sonido del juego bajan mientras la sala lee la tarjeta de "cómo se juega".
  sonidoDelJuego(game);
  const cuenta = conCuenta() ? CUENTA_SECONDS : 0;
  if (previa && previa.game !== game) previa.card.update(game);
  const card = previa ? previa.card : abrirTarjeta(game, names.length, winners.length);
  setCardSeconds(card ? CARD_SECONDS : 0);
  // Si la sala ya contó con la tarjeta, el juego no vuelve a contar.
  setYaContaron(card !== null && cuenta > 0);
  // La pantalla completa se pide con la tarjeta, mientras el clic de "Sortear"
  // todavía cuenta como gesto: el navegador la niega pasados unos cinco
  // segundos, y el estadio aparece recién cuando la tarjeta termina.
  if (card) pedirPantallaCompleta();
  let cerrado = false;
  // Mientras corre, el selector de juegos se apaga y dice por qué (freeze.ts, `marcarShow`).
  marcarShow(true);
  const fin = (): void => {
    if (cerrado) return;
    cerrado = true;
    marcarShow(false);
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
  // El logo de la comunidad, en el renglón de "Lo que salió" (src/ui/logo-sorteo.ts). Sin logo, queda como siempre.
  pintarLogoEnElResultado();
  // La demo llegó al ganador: es lo único que se cuenta de ella (src/contar.ts). El ensayo avisa con `tinkazo:ensayo-fin`.
  if (params.has("demo")) contarPractica("demo");
  // Con el movimiento reducido el juego se salteó: se avisa, para que no parezca roto.
  $("motion-note").style.display = skippedForReducedMotion() ? "block" : "none";
  renderLore(beacon);
  // La leyenda del juego, si trae una: plegada y después del resultado, nunca durante el show.
  pintarLeyenda($("leyenda-box"), app.game, getLang(), { titulo: t("leyendaTitulo"), fuente: t("leyendaFuente") });
  const prize = app.frozen?.prize ?? "";
  // Con el resultado puesto, el selector dice que sirve para verlo de nuevo con otro juego.
  pintarNotaDelJuego();
  // Este premio ya salió: en el próximo sorteo queda marcado entre las opciones.
  marcarSalio(prize);
  // "No está" solo si queda con quién volver a sortear: dos personas, como
  // en "Otro premio".
  const reemplazo = names.length - winners.length >= 2;
  // Hasta seis, una tarjeta cada uno; con más, el primero en tarjeta y los demás en una lista (`resultado-ganadores.ts`).
  // Los equipos con cupón se ven por el nombre de su equipo, con la cuenta al lado (`equipos/etiquetas.ts`).
  $("winner-cards").innerHTML = htmlDeGanadores({ names: names.map(etiquetaConCuenta), winners, prize, reemplazo, avatar });
  const proof = $("proof");
  proof.textContent =
    `Draw: quicknet round=${beacon.round}, ${t("proofOk")} ✓, randomness=${beacon.randomness.slice(0, 24)}…, list_hash=${listHash.slice(0, 24)}…, count=${names.length}, winners=[${winners.join(",")}]`;
  const drawTx = app.drawn?.drawTx;
  if (drawTx) {
    proof.append(", ");
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
  // En el ensayo, lo que sigue es su final (ensayo.ts): "Probar otro juego", y después "Sortear con mi lista".
  // "Siguiente premio" y compartir no van: no se sorteó nada.
  const siguiente = showAgain();
  const principal = enStand()
    ? ((document.getElementById("stand-otra") as HTMLButtonElement | null) ?? siguiente)
    : enEnsayo()
      ? ((document.getElementById("ens-otro") as HTMLButtonElement | null) ?? siguiente)
      : siguiente;
  // El final del ensayo: su línea se va, y el contador cuenta que llegó al ganador (main.ts, `contarPractica`).
  if (enEnsayo()) document.dispatchEvent(new CustomEvent("tinkazo:ensayo-fin"));
  confetti();
  // Premios pagados (detrás de la bandera): el panel de ganadores con el estado de cada pago y "Pagar premio".
  if (pagosActivos()) void import("./pagos-resultado").then((m) => m.mostrarPagosDelResultado()).catch(() => undefined);
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
  // En el ensayo el resultado se queda en la página, con su final: en grande
  // mostraría un QR de un sorteo que no existe. Se suelta la pantalla completa.
  if (final && enPractica()) {
    soltarPantallaCompleta();
    enfocarDespues(principal);
  } else if (final && (!final.pantalla || document.fullscreenElement)) resultadoEnGrande(enlace, principal);
  else enfocarDespues(principal);
}

/** Abre el resultado en grande en el mismo instante, si `pantalla.ts` ya bajó (siempre, salvo un wifi muy lento). */
function resultadoEnGrande(enlace: Promise<string>, volverA: HTMLButtonElement): void {
  // Con el enlace corto, como "Mostrar en grande": es lo mismo, mostrarlo en grande, y el
  // QR del corto se lee desde el fondo de la sala (21 de octubre de 2026). Hasta
  // ese día iba con el largo. Nunca en la demo; si el corto no llega, va el largo (pantalla.ts).
  const abrir = (m: typeof import("./pantalla")): void => void m.mostrarResultado(enlace, { corto: !sinGrabar(), volverA });
  contarCompartido("qr_big");
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
  verDeNuevo();
}

/**
 * "Ver de nuevo con otro juego" (y "Probar otro juego" en el ensayo): el mismo resultado, mismo ganador y misma
 * ronda, contado por otro juego. Solo recibe lo que ya está decidido (`app.drawn`): no sortea, no graba, no toca
 * el historial, el comprobante ni la cadena, y no revela nada otra vez. Sin `juego`, con el de ahora (es la
 * repetición de "Ver la animación igual"). Un show a la vez (`replaying`); al terminar, el foco vuelve a quien lo pidió.
 */
export function verDeNuevo(juego?: Game): void {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || replaying) return;
  replaying = true;
  const activo = document.activeElement;
  const volverA = activo instanceof HTMLElement && activo !== document.body ? activo : null;
  if (juego) {
    juegoParaVerDeNuevo(juego);
    // Lo que va con el juego (su historia y su leyenda) pasa a ser el del juego que se ve.
    renderLore(drawn.beacon);
    pintarLeyenda($("leyenda-box"), app.game, getLang(), { titulo: t("leyendaTitulo"), fuente: t("leyendaFuente") });
  }
  const btn = document.getElementById("btn-replay") as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  forceMotion(true);
  playGame(frozen.names, drawn.winners, drawn.beacon, () => {
    replaying = false;
    if (btn) btn.disabled = false;
    forceMotion(false);
    if (volverA && volverA.isConnected && volverA.offsetParent !== null) volverA.focus({ preventScroll: true });
  });
}

/** Un toque en "Probar otro juego" o en "Ver de nuevo con otro juego": al selector, con el foco en otro juego. */
export function elegirOtroJuegoParaVer(): void {
  if (!app.drawn || replaying) return;
  irAlSelectorParaOtro();
}

// Después del resultado, un toque en el selector lo vuelve a mostrar con ese juego (freeze.ts, `elegirJuego`).
alElegirDespuesDelResultado((g) => verDeNuevo(g));

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
  // Qué sigue, para la sala y para quien organiza: una línea, sin botón (los botones son los de arriba y el pliegue).
  const sigue = $("again-sigue");
  sigue.dataset.i = listaVinoDeLuma() ? "againSigueLuma" : "againSigue";
  sigue.textContent = t(sigue.dataset.i);
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
  // Con "Siguiente premio", el próximo sello sugiere otro juego: seguir sorteando es seguir jugando.
  if (modo === "sinGanadores") rotarJuego();
  unfreeze(quedan.join("\n"));
  // Con otra lista empieza otra sentada: los premios ya no figuran como "ya salió".
  if (modo === "otraLista") olvidarSalieron();
  // "Premios" no puede quedar en más que los que quedan: con 2 personas y 3
  // premios, el próximo sorteo los premiaba a todos sin avisar.
  if (modo === "ausente") {
    // El reemplazo es uno solo y se lleva lo mismo que se iba a llevar quien
    // no estaba. Los otros ganadores, si los hubo, se quedan con lo suyo y no
    // entran a este sorteo.
    ponerGanadores(1);
    ponerPremio(premio);
  } else if (quedan.length) ponerGanadores(Math.min(ganadoresPedidos(), Math.max(1, quedan.length - 1)));
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
  for (const id of ["draw-status", "reverify-out", "again-row", "winner-box", "lore-box", "leyenda-box", "qr-box", "sec-draw"]) {
    $(id).style.display = "none";
  }
  // El pliegue del resultado («Otra lista, copiar el mensaje y más») vuelve a salir cerrado con el próximo ganador.
  const masResultado = document.getElementById("mas-resultado");
  if (masResultado instanceof HTMLDetailsElement) masResultado.open = false;
  limpiarDetalle("draw-status");
  $("winner-cards").innerHTML = "";
  // El panel de ganadores y pagos del sorteo anterior (pagos-resultado.ts) no se queda para el siguiente.
  const pagosBox = document.getElementById("pagos-box");
  if (pagosBox) {
    pagosBox.replaceChildren();
    pagosBox.style.display = "none";
  }
  quitarLogoDelResultado();
  $("sec-participants").scrollIntoView({ behavior: "smooth", block: "start" });
  // El foco va a la acción principal del paso que sigue, como en cada paso (docs/ux.md): con la lista lista
  // (sin los que ya ganaron, o con "No está"), sellar; con otra lista, cargarla. Hasta el 26 de octubre de 2026,
  // con un mouse caía en el premio, para nombrar el próximo, pero el premio quedó dentro del pliegue "Premio,
  // cuántos ganan y subir CSV", que está cerrado: `focus()` sobre algo escondido no hace nada, y el foco se
  // perdía junto con el botón "Siguiente premio" que acababa de desaparecer. El premio se escribe igual, un Tab
  // más arriba, y el resumen de arriba del botón dice qué se va a sellar ("sin premio" o el que quedó).
  if (modo === "otraLista") $<HTMLTextAreaElement>("ta").focus({ preventScroll: true });
  else $<HTMLButtonElement>("btn-freeze").focus({ preventScroll: true });
  actualizarPaso();
}

/**
 * "No está": quien ganó ya se fue, cosa que pasa en casi todo evento. Su
 * premio vuelve a sortearse entre los que quedan, con un sello nuevo: el
 * sorteo de recién queda como está, en Mis sorteos y en su comprobante, y el
 * reemplazo tiene el suyo. Pide confirmación en la misma tarjeta, porque un
 * clic de más frente a la sala no puede borrar al ganador de la pantalla.
 */
export function alTocarGanadores(e: Event): void {
  alTocarAusente(e, (k) => newDraw("ausente", k));
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
/** El enlace corto del comprobante, cuando lo hay: lo usan el QR, los avisos y el mensaje. */
let cortoLink = "";

/**
 * El enlace corto se arma al compartir o al mostrar en grande (con el botón, o
 * al final del show que arrancó desde la espera en grande), nunca solo: no se
 * guarda nada en ningún lado mientras quien organiza no comparte ni lo muestra.
 * Y nunca en la demo, que no graba nada.
 */
const puedeAcortar = (): boolean => !sinGrabar() && !!proofLink;

/** Al apoyar el dedo o el mouse en compartir o en grande: para el clic, el corto ya suele estar. */
export function adelantarCorto(): void {
  if (puedeAcortar()) void acortar(proofLink);
}

/** Cuando sale el corto de este comprobante, el QR del resultado y los avisos pasan a usarlo. */
alAcortar((ruta, c) => {
  if (!proofLink || rutaDe(proofLink) !== ruta || cortoLink === c.corto) return;
  cortoLink = c.corto;
  const f = app.frozen;
  const d = app.drawn;
  if (f && d) setNotifyLinks(f.names, d.winners, cortoLink);
  void paintQr(cortoLink);
});

/** El resultado en grande para el proyector, con el QR del comprobante (pantalla.ts). */
export function mostrarGrande(): void {
  // Una ronda de ejemplo no tiene comprobante que mostrar.
  if (enStand()) return;
  contarCompartido("qr_big");
  void import("./pantalla").then((m) => m.mostrarResultado(proofLink, { corto: puedeAcortar() }));
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
    if (!(await pintarQrDelComprobante(img, link))) {
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
  // Se siguió sin sello y el sello no llegó a entrar: el comprobante lo lleva marcado, para que el
  // mensaje, la foto, el enlace del evento y la página de verificación lo digan (protocolo §8).
  const sinSello = !!f.sinSello && f.raffleId === undefined;
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
      ? {
          net: network.name,
          contract: network.contractId ?? "",
          id: String(f.raffleId),
          // Las transacciones del sello y del sorteo: el estado del contrato vence y mantenerlo
          // cuesta renta, el historial de Stellar no. Con el hash del sello, este comprobante
          // se puede verificar aunque el contrato ya no tenga el sorteo (`stellar/historial.ts`).
          // Si no se sabe alguno (un sello que se retomó, un sorteo que ya estaba grabado), no va.
          ...(f.sealTx ? { stx: f.sealTx } : {}),
          ...(d.drawTx ? { dtx: d.drawTx } : {}),
        }
      : {}),
    ...(sinSello ? { sinSello: true } : {}),
  };
  let link: string;
  try {
    link = await proofUrl(proof);
  } catch {
    // Sin comprobante, el QR al menos lleva a la ronda del faro.
    link = roundLink;
  }
  proofLink = link;
  // El logo de la comunidad va solo en el enlace corto: se registra una vez, y quienes acortan no cambian.
  ponerLogoDeRuta(rutaDe(link), logoPorHuella(f.logo));
  // El resultado dice si ese sorteo no se puede comprobar porque se siguió sin sello.
  const nota = document.getElementById("sin-sello-nota");
  if (nota) nota.style.display = sinSello ? "block" : "none";
  // Y el QR no invita a comprobar lo que no se puede comprobar: dice que no hay sello y qué se ve al escanearlo.
  ponerTextoDelSello(document.querySelector<HTMLElement>("#qr-box .kicker"), "qrDelResultado", sinSello);
  // Un comprobante nuevo empieza con su enlace largo; si ya se había compartido, con su corto.
  cortoLink = cortoGuardado(link)?.corto ?? "";
  // Y ahora se completa la fila del historial con el ganador y el comprobante.
  // La demo y el ensayo no son sorteos: no se anotan en Mis sorteos aunque haya
  // cuenta, igual que en el sello (freeze.ts).
  const f2 = app.frozen;
  const who = sinGrabar() ? undefined : currentSession()?.address;
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
        ...(f2.logo ? { logo: f2.logo } : {}),
        proof: link,
        ...(f2.raffleId !== undefined ? { id: String(f2.raffleId) } : {}),
        // El número solo no dice de qué contrato es (cada uno arranca en 1).
        ...(f2.raffleId !== undefined && network.contractId ? { contract: network.contractId } : {}),
        ...(d.drawTx ? { drawTx: d.drawTx } : {}),
        // Sin sello (la red no dejó sellar): Mis sorteos lo dice.
        ...(sinSello ? { sinSello: true } : {}),
      });
      h.renderHistory(who);
    });
  }
  // Los avisos primero: el QR carga su librería aparte y tarda, y hacer
  // esperar a los botones de "avisarle por WhatsApp" por un cuadradito los
  // dejaba sin armar justo cuando el ganador aparece en pantalla.
  setNotifyLinks(names, winners, cortoLink || link);
  void paintQr(cortoLink || link);
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
  const lista = winners.map((i) => etiquetaDe(names[i] ?? ""));
  const quienes = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(lista);
  // Sin sello: que lo diga también lo que se pega en el grupo, y que no prometa lo que no se puede comprobar.
  const sinSello = !!app.frozen.sinSello && app.frozen.raffleId === undefined;
  return T[getLang()].summary(quienes, names.length, prize, cortoLink || proofLink || roundUrl(beacon.round), lista.length > 1, sinSello);
}

/** Copia el mensaje y avisa en el botón. Devuelve false si el navegador no deja copiar. */
async function copiarMensaje(btn: HTMLButtonElement, texto: string, aviso: "copied", ms: number): Promise<boolean> {
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
 * "Compartir el resultado": el diálogo de compartir (compartir.ts), con la foto
 * de quién ganó y el QR, y el mensaje. Intenta el enlace corto, salvo en la demo.
 */
export function shareProof(): void {
  // Una ronda de ejemplo no tiene comprobante que compartir: su número no es público.
  if (enStand()) return;
  const f = app.frozen;
  const d = app.drawn;
  if (!f || !d) return;
  const enlace = proofLink || roundUrl(d.beacon.round);
  const datos = {
    enlace,
    ganadores: d.winners.map((i) => etiquetaDe(f.names[i] ?? "")),
    total: f.names.length,
    premio: f.prize,
    fecha: f.ts,
    ...(f.raffleId !== undefined ? { numero: String(f.raffleId), red: network.name } : {}),
    ref: refDelSorteo(),
    ...(f.sinSello && f.raffleId === undefined ? { sinSello: true } : {}),
    // El logo con el que se selló, no el de ahora (src/logo.ts).
    ...(logoPorHuella(f.logo) ? { logo: logoPorHuella(f.logo) as NonNullable<ReturnType<typeof logoPorHuella>> } : {}),
  };
  void import("./compartir").then((m) => m.abrirSorteo(datos, getLang(), { corto: puedeAcortar() }));
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
  const lista = winners.map((i) => etiquetaDe(names[i] ?? ""));
  const who = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(lista);
  // Al ganador de un sorteo sin sello tampoco se le dice que nadie lo eligió a dedo ni que lo revise: no se puede comprobar.
  const sinSello = !!app.frozen?.sinSello && app.frozen.raffleId === undefined;
  const body = T[getLang()].tellBody(who, prize, names.length, url, lista.length > 1, sinSello);
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
  if (texto && (await copiarMensaje(btn, texto, "copied", 1600))) contarCompartido("copy");
}

/** La referencia pública del sorteo de la pantalla, si se ancló: va al contador al compartir. */
function refDelSorteo(): ReturnType<typeof refDe> {
  const id = app.frozen?.raffleId;
  return id === undefined ? undefined : refDe({ net: network.name, contract: network.contractId ?? "", id });
}

/**
 * El contador del embudo (src/contar.ts): se compartió el resultado de la
 * pantalla, por dónde, y de qué sorteo. Lo de la ventana de compartir lo
 * cuenta `compartir.ts`.
 */
export function contarCompartido(canal: "copy" | "qr_big" | "whatsapp" | "email"): void {
  // Sin un resultado no hay nada que compartir (los botones viven en la tarjeta del resultado).
  if (!app.frozen || !app.drawn) return;
  contar("share", { channel: canal }, refDelSorteo());
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
