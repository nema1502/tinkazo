import { $, esc } from "../dom";
import { campanaDeLaLista, esSorteoDeCampana } from "../campana/en-curso";
import { T, getLang, onLangChange, t } from "../i18n";
import { CUENTA_SECONDS, LCOLORS, WHEEL_MAX, app, conCuenta, currentPace, params, playableGame, avatar, forceMotion, setCardSeconds, setShowGate, setYaContaron, skipMotion, skippedForReducedMotion, type Beacon, type Game } from "../state";
import { enEnsayo, enPractica, enStand, faroDeStand, sinGrabar } from "../ensayo-modo";
import { beep, note, sonidoDelJuego } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundTime, roundUrl } from "../protocol/quicknet";
import { resultadoDelSello } from "../sorteo-local";
import { LECTURA_DE_LA_TARJETA_S, arranqueDelShow, juegoTrasLaLlegada, msHasta } from "../arranque-del-show";
import { anclaDeLaRondaUnaVez, anclaVirtual, horaDeLaRonda, salaALaParPorElAncla, type Ancla } from "../reloj-de-la-ronda";
import { cerrarElShow, estadoDelShow, pedirHorario, ponerseAlDiaAlVolver, type Avisos, type Horario } from "../games/en-hora";
import { cambioConQr, hayEspectadores, publicado } from "./espectadores-de-la-sala";
import { puertaDeLaGrabacion, salaALaPar, type Apertura } from "./puerta-de-la-grabacion";
import { type FinDeLaGrabacion, grabarElSorteo } from "./grabar-sorteo";
import { marcarEnMarcha, soltarLaMarcha, sorteoEnMarcha } from "./sorteo-en-marcha";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { network, txUrl } from "../stellar/config";
import { PROOF_VERSION, type Proof, proofUrl, amigoUrl } from "../protocol/proof";
import { pideProtegerLaCuenta, protegerLaCuenta } from "./proteger-flujo";
import { cuentaPatrocinada, escribirError, existenciaDelSorteo, limpiarDetalle, showTxStatus } from "./anchor";
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
import * as premiosModulo from "./premios";
import { premioDeLugarEn, premiosDeLosLugares } from "./lugares-de-meta";
import { ganadoresPedidos, ponerGanadores } from "./ganadores";
import { turnMessage, turnNotice, amigoMessage } from "../modos/mensajes";
import { isTurnOrder, modoDelComprobante, ordenSinComprobante, setResultadoDeTurnos, turnOrderDisplayNames } from "../modos/turnos";
import { amigoSinComprobante, isSecretSanta, reparto } from "../modos/amigo";
import { contar as contarPersonas, cuentaParaMostrar, nombreDePersona, seCuentaPorPersona, sinLasPersonasQueSalieron } from "../participaciones";
import { modesVisible, withMode } from "../modos/bandera";
import { alCopiarOrden } from "./lista-de-turnos";
import { alTocarAusente, htmlDeGanadores } from "./resultado-ganadores";
import { withRepeatCounts } from "./repeated-names";
import { acortar, alAcortar, cortoGuardado, ponerLogoDeRuta, rutaDe } from "../enlace-corto";
import { logoPorHuella } from "../logo-guardado";
import { pintarLogoEnElResultado, quitarLogoDelResultado } from "./logo-sorteo";
import { startMusic, stopMusic } from "../music";
import { seguirEnPantallaCompleta } from "../games/overlay";
import { pedirPantallaCompleta, soltarPantallaCompleta } from "./pantalla-completa";
import { contar, contarPractica, errorContable, refDe } from "../contar";
import { acreditarEnSegundoPlano } from "../stellar/monedas-eventos";
import { ponerTextoDelSello } from "./sin-sello-textos";
import { accionDePagarConMiCuenta, sePuedeSortearPagando, tomarLaEleccion } from "./sortear-propio";
import { esListaDeEquipos, etiquetaConCuenta, etiquetaDe, hayEtiquetas, nombresDeLosEquipos, paraMostrar } from "../equipos/etiquetas";

/**
 * Si la lista que se selló es de equipos. Lo dicen la lista sellada y no el cuadro, que después del sorteo ya pudo
 * cambiar: así las frases de abajo del resultado, el mensaje y la foto cuentan siempre lo mismo. `undefined` si todavía
 * no hay lista sellada, y entonces las frases miran el cuadro.
 */
const selladaEsDeEquipos = (): boolean | undefined => (app.frozen ? esListaDeEquipos(app.frozen.names) : undefined);
import { ponerNombresEnteros } from "../games/nombres-enteros";
import { pagosActivos } from "../stellar/pagos-bandera";
import { cobroPorUso } from "../stellar/cobro-oficial";
import { PLAZO_DEL_RELAY_MS, conPlazo } from "../pedido-con-plazo";

/** Obtiene la ronda objetivo, verifica su firma y selecciona (protocolo §2, §5). */
async function resolveBeacon(
  round: number,
  onAttempt: (attempt: number, total: number) => void,
): Promise<Beacon> {
  // El modo stand nunca toca la red para elegir, con o sin internet: no hay dos caminos ni detección de red que falle en vivo.
  if (enStand()) return faroDeStand(round);
  // Con plazo por pedido: un relay colgado cuenta como uno que falló, y se pasa al siguiente (`pedido-con-plazo.ts`).
  const { signature } = await fetchRound(round, { onAttempt, fetchFn: conPlazo(fetch, PLAZO_DEL_RELAY_MS) });
  // En un worker, que la cuenta regresiva levantó: la cortina no se traba.
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

/** La acción corresponde al sello que falló; nunca se hereda al siguiente sorteo. */
let recuperacion: { sello: NonNullable<typeof app.frozen>; accion: AccionError } | null = null;

/** Ya se abrió "Protegé tu cuenta" en este intento de sortear: si vuelve a pedirla, se dice y no se repite. */
let protegiendoElSorteo = false;

/** Un sorteo está pasando por las compuertas del modo Oficial (el paso de la cuenta, el acceso). */
let enLasCompuertas = false;

/**
 * `adelantado`: lo lanza la espera en grande en los últimos segundos antes de que nazca el número (`freeze.ts`), para
 * que la tarjeta de cómo se juega se lea mientras tanto. El número se pide recién cuando nace.
 */
export async function draw(opciones: { adelantado?: boolean } = {}): Promise<void> {
  if (recuperacion?.sello === app.frozen) {
    recuperacion.accion.ejecutar();
    return;
  }
  recuperacion = null;
  // El sorteo ya se jugó y falta grabarlo (falló, o la billetera no lo aprobó): el botón vuelve a probar, sin otro show.
  if (porGrabar && porGrabar.sello === app.frozen && app.drawn) {
    await grabarAparte({ ...porGrabar, pagarConMiCuenta: tomarLaEleccion() });
    return;
  }
  if (!app.frozen || app.drawn || sorteoEnMarcha(app.frozen)) return;
  // Adelantado, como mucho la lectura de la tarjeta antes de que nazca el número (con un segundo de holgura por el
  // reloj de la cuenta regresiva). Si no, recién cuando nació.
  if (opciones.adelantado ? msHasta(roundTime(app.frozen.round), horaDeLaRonda() * 1000) > (LECTURA_DE_LA_TARJETA_S + 1) * 1000 : secondsToRound() > 0) return;
  // Uno a la vez: con el sorteo lanzado antes de que nazca el número, un toque cuando nace no puede lanzar otro show.
  // La marca la mira también la cuenta regresiva (`freeze.ts`), que no toca el botón mientras tanto. Si una compuerta
  // corta, la marca se va con el intento y el botón vuelve a encenderse (`sorteo-en-marcha.ts`). Es por sello y se
  // suelta cuando arranca el show: la grabación, que sigue aparte, no frena el sorteo del premio siguiente.
  const sello = app.frozen;
  marcarEnMarcha(sello);
  try {
    await sortear(opciones.adelantado === true);
  } finally {
    soltarLaMarcha(sello);
  }
}

/**
 * `adelantado`: lanzado por la espera en grande antes de que nazca el número. Entonces la sala sigue la línea de tiempo
 * común (`arranque-del-show.ts`): trae el número con un pedido que espera su nacimiento (`reloj-de-la-ronda.ts`) y su
 * juego arranca a una hora fija desde esa llegada, la misma regla que sigue el celular de quien mira, un poco después.
 */
async function sortear(adelantado = false): Promise<void> {
  if (!app.frozen) return;
  // En modo Oficial, si la memoria dice que a la cuenta le falta activarse, el paso «Dejá tu cuenta lista» antes de
  // sortear. Solo la memoria y sin red: el sorteo se lanza solo desde la espera. Fuera del modo Oficial no se baja nada.
  if (app.frozen.raffleId !== undefined && network.name === "mainnet") {
    // Un toque mientras otro sigue en las compuertas no hace nada: el botón se apaga recién después de ellas, y con el
    // portero lento (hasta 6 s) un segundo toque pedía otra firma del mismo sorteo.
    if (enLasCompuertas) return;
    enLasCompuertas = true;
    try {
      let flujo: typeof import("./cuenta-lista-flujo") | null = null;
      try {
        flujo = await import("./cuenta-lista-flujo");
      } catch {
        // No bajó: el sorteo sigue sin la compuerta. Ya está sellado, así que la cuenta estaba lista al sellar; si igual
        // le faltara algo, el sorteo falla antes de firmar y lo dice. Frenarlo acá lo dejaba muerto hasta recargar.
        flujo = null;
      }
      if (flujo && flujo.faltaEnLaMemoria() && !(await flujo.cuentaListaParaGrabar("sorteo", { volverA: document.getElementById("btn-draw"), alSeguir: pedirPantallaDelSorteo }))) {
        // Salió del paso sin dejar la cuenta lista: no se sortea, y se dice por qué, con el botón para volver a probar.
        // Hasta el 16 de noviembre de 2026 no se decía nada, y lanzado desde la espera en grande la dejaba sin salida.
        if (app.frozen && !app.drawn) cortoLaCompuerta("drawCuentaSinLista");
        return;
      }
      if (!app.frozen || app.drawn) return;
      // Con el cobro por uso del modo Oficial, ninguna firma del sorteo sin el acceso de la cuenta (`sin-sorteos.ts`).
      if (cobroPorUso() && !(await accesoOficialParaSortear())) return;
      if (!app.frozen || app.drawn) return;
    } finally {
      enLasCompuertas = false;
    }
  }
  // "Sortear pagando con mi cuenta", si se eligió: vale para este intento y no se hereda al siguiente.
  const pagarConMiCuenta = tomarLaEleccion();
  // Tiene que correr dentro del clic: los navegadores no dejan hablar a una
  // página que nunca recibió uno, y esa habilitación después queda pegada.
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.classList.remove("lista");
  btn.textContent = t("fetching");
  const sello = app.frozen;
  const { names, listHash, raffleId } = sello;
  // Los ganadores que se sellaron: el campo se puede tocar después de sellar, el sello no.
  const nWinners = sello.numWinners ?? Math.min(ganadoresPedidos(), names.length);
  // Un Amigo secreto: salen todos y el orden es el reparto. El juego mostraría el orden, y el orden es a quién le
  // regala cada uno: se sale directo al resultado, sin juego con nombres (issue #99, S4).
  const amigo = isSecretSanta(names.length, nWinners, sello.prize);
  // Desde la espera en grande, el resultado también sale en grande: se baja ya,
  // para abrirlo en el mismo instante en que se va el estadio. En un Amigo secreto no: la pantalla grande
  // mostraría el orden entero, y el orden es el reparto (issue #99, S4 y S5).
  if (enGrande() && !amigo) void import("./pantalla").then((m) => (pantallaLista = m)).catch(() => undefined);
  // Una sola lectura del sello y del contador: la cortina y la tarjeta no pueden discrepar sobre qué se sortea.
  const orden = isTurnOrder(names.length, nWinners, sello.prize);
  // La pantalla completa, en el mismo clic: con cuenta, grabar el sorteo tarda
  // unos segundos y para cuando salía la tarjeta el navegador ya no la
  // concedía. El estadio quedaba dentro de la página. Si no se está en grande
  // todavía, es el momento (26 de octubre de 2026: lo mismo que al sellar).
  // En un Amigo secreto no se pide: no hay show que ver en grande (issue #99, S4).
  if (!amigo) pedirPantallaDelSorteo();
  // La tarjeta de cómo se juega sale ya, antes del número: no dice quién gana. Lanzado desde la espera en grande, sale
  // en los últimos segundos de la espera y termina de leerse cuando nace el número. La cuenta de la sala espera a que
  // haya resultado, y el juego arranca sin esperar a que el sorteo quede grabado: se graba aparte (`grabarAparte`).
  // Hasta el 15 de noviembre de 2026 la sala esperaba el margen de la cadena y la grabación, unos quince segundos.
  let hayResultado: (hora?: { terminaEn: number }) => void = () => undefined;
  const resultadoListo = new Promise<{ terminaEn: number } | undefined>((r) => (hayResultado = r));
  const juego = juegoDe(names.length, nWinners);
  // Los lugares de a uno (issue #102, ver `deAUno` más abajo): el show es del primer lugar, así que la tarjeta habla de un
  // premio. Con varios prometía que el cartel del final mostraba a los demás, y ese cartel muestra uno solo.
  const deCampana = esSorteoDeCampana(raffleId) || campanaDeLaLista(listHash) !== null;
  const deAUnoPorElSello = nWinners > 1 && !orden && !enEnsayo() && !enStand() && !deCampana;
  const card = abrirTarjeta(juego, names.length, deAUnoPorElSello ? 1 : nWinners, orden, resultadoListo, undefined, deAUnoPorElSello ? 1 : undefined);
  const tarjeta: Previa | null = card ? { card, game: juego } : null;
  // Sin tarjeta, la cortina mientras llega el número. Desde la espera en grande, ella misma hace de cortina hasta que
  // el show la tapa (espera.ts), y si algo falla se queda, con la pantalla completa. En un Amigo secreto, ninguna de
  // las dos: no hay juego que anunciar, y la sala no tiene que leer nada que hable del orden.
  const cortina = amigo || card || skipMotion() || enGrande() ? null : abrirCortina(sello.prize, orden);
  const sinShow = (): void => {
    tarjeta?.card.hide();
    cortina?.cerrar();
    if (!enGrande()) soltarPantallaCompleta();
  };
  /** Para el contador: un sorteo sin anclar no se cuenta, y uno anclado lo cuenta su grabación, al saber cómo terminó. */
  let contado = raffleId === undefined;
  /** La grabación, cuando ya arrancó: un error del show no la corta, y el sorteo termina cuando ella termina. */
  let grabando: Promise<void> | null = null;
  /** La llegada del número con el pedido retenido, si se lanzó desde la espera (`reloj-de-la-ronda.ts`). */
  let ancla: Ancla | null = null;
  /** La sala mostró quién gana (el cartel del juego, o el resultado): la grabación que lo esperaba ya puede salir. */
  let coronar: () => void = () => undefined;
  const coronada = new Promise<void>((r) => (coronar = r));
  /** El resultado, desde que quedó fijado: si después falla el show, se muestra igual y se graba. */
  let fijado: { beacon: Beacon; winners: number[]; graba: PorGrabar | null } | null = null;

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

    // Lanzado por la espera en grande: el número llega con un pedido que espera su nacimiento, y esa llegada es la hora
    // cero del juego (el ancla). Si el servicio que retiene no contesta, o la firma no da, como siempre.
    const conAncla = adelantado && !enStand();
    // La cuenta regresiva ya la pidió unos segundos antes (`freeze.ts`): esta es la misma, también en Rápido.
    ancla = conAncla ? await anclaDeLaRondaUnaVez(sello.round) : null;
    let beacon: Beacon | null = null;
    let llegada = 0;
    if (ancla?.firma && (await verifyRoundAsync(sello.round, ancla.firma).catch(() => false))) {
      beacon = { round: sello.round, randomness: bytesToHex(randomnessOf(ancla.firma)), signature: ancla.firma };
      llegada = ancla.llegada;
      status.style.display = "none";
    } else ancla = null;
    try {
      if (!beacon) {
        // Lanzado antes de que nazca el número: se lo pide recién cuando nace. Pedirlo antes es esperar los dos segundos
        // que hay entre un intento y el siguiente.
        const falta = enStand() ? 0 : msHasta(roundTime(sello.round), horaDeLaRonda() * 1000);
        if (falta > 0) await new Promise((r) => setTimeout(r, falta));
        beacon = await resolveBeacon(sello.round, (attempt, total) => {
          if (attempt > 1) status.textContent = T[getLang()].drandTry(attempt, total);
        });
        llegada = performance.now();
        status.style.display = "none";
      }
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

    // Se soltó el sello mientras llegaba el número (se empezó otro sorteo): este no sigue.
    if (app.frozen !== sello || app.drawn) {
      sinShow();
      return;
    }
    // El resultado, calculado acá con lo sellado y el número ya comprobado: el mismo camino con sello y sin sello
    // (`sorteo-local.ts`). Con sello, el contrato hace la misma cuenta y no puede dar otro: al grabarlo se comparan.
    const winners = resultadoDelSello({ listHash, count: names.length, numWinners: nWinners }, beacon);
    // Hay resultado: la tarjeta sigue con la cuenta de la sala, y después el juego. Lanzado por la espera, a la hora fija
    // que da la llegada del número; el estadio arranca a esa misma hora (`en-hora.ts`).
    const terminaEn = conAncla ? llegada + juegoTrasLaLlegada(conCuenta()) * 1000 : null;
    hayResultado(terminaEn !== null ? { terminaEn } : undefined);

    // Apagado y diciendo por qué: un "Lanzar el sorteo" gris parecía roto. Con
    // data-i, el cambio de idioma lo traduce en vez de volver a "Lanzar".
    btn.dataset.i = "drawnDone";
    btn.textContent = t("drawnDone");
    // Y la caja de la espera deja de decir "Ya nació. Dale.": ya se sorteó.
    ponerHecho(document.getElementById("wait-left"));
    // Issue #102: con más de un lugar sellado (y sin ser un orden de turnos), la sala ve un lugar
    // por show y «Siguiente premio» muestra el que sigue del mismo resultado, con su show y sin
    // sellar de nuevo. El ensayo y el stand terminan a su manera: ahí el resultado sale completo,
    // como siempre, igual que un resultado retomado de Mis sorteos o la vista de espectador.
    // El sorteo de una campaña tampoco (`deCampana`, arriba): su panel esconde «Siguiente premio» y avisa a los celulares
    // con los lugares todos al revelar, así que la sala ve sus premios en un solo show. Es la misma pregunta que hace `reveal`.
    const deAUno = winners.length > 1 && deAUnoPorElSello;
    app.drawn = { beacon, winners, ...(deAUno ? { revelados: 1 } : {}) };
    // Con sello, el sorteo se graba aparte y el show no lo espera. Con la billetera propia, recién después del show:
    // su ventana para aprobar no puede tapar el juego. Con las demás cuentas, ya: la grabación espera sola el margen
    // de la cadena mientras se juega.
    const graba: PorGrabar | null = raffleId !== undefined ? { sello, beacon, winners, pagarConMiCuenta } : null;
    fijado = { beacon, winners, graba };
    // Mis sorteos lo sabe ya, antes del show: con sus ganadores y por guardar. Si la pestaña se cierra o se recarga
    // durante el show, la fila ofrece Guardarlo ahora. Hasta el 16 de noviembre de 2026 se anotaba recién con el
    // resultado a la vista, y con la billetera propia cerrar durante el show dejaba el sorteo sin grabar y sin marca.
    if (graba) anotarEnMisSorteos(graba, { porGrabar: true }, false);
    const despuesDelShow = graba !== null && currentSession()?.aMano === true;
    if (graba) contado = true;
    // Con celulares mirando, la sala graba mientras juega solo si va a la par; si no, después de mostrar quién gana
    // (`puerta-de-la-grabacion.ts`). Sin celulares, como siempre.
    const pedido = { juego: app.game, ritmo: currentPace() };
    const anclaDelSorteo = ancla;
    // `?auditar=espectador`: lo que la sala miró para decidir, a la vista del recorrido de los espectadores.
    const auditar = (params.get("auditar") ?? "").split(",").includes("espectador");
    const puerta = graba && !despuesDelShow ? puertaDeLaGrabacion({
      conEspectadores: hayEspectadores(sello),
      grabable: arranqueDelShow(sello.round).grabable,
      ahora: () => horaDeLaRonda() * 1000,
      aLaPar: () => {
        const e = {
          conEspectadores: true,
          cambioConQr: cambioConQr(sello),
          anclaALaPar: salaALaParPorElAncla(anclaDelSorteo, anclaVirtual(sello.round)),
          mismoJuego: mismoJuegoQueElQr(sello, pedido.juego, pedido.ritmo),
          show: estadoDelShow(),
        };
        const par = salaALaPar(e);
        // Grabada a la par, lo grabado suelta el final de los celulares: si la sala se esconde, al volver se pone al día.
        if (par) ponerseAlDiaAlVolver();
        if (auditar) {
          const v = anclaVirtual(sello.round);
          const trasSuHora = anclaDelSorteo && v !== null ? Math.round(anclaDelSorteo.llegada - v) : null;
          document.documentElement.dataset.paraGrabar = JSON.stringify({ ...e, ancla: anclaDelSorteo && { retenido: anclaDelSorteo.retenido, idaYVuelta: anclaDelSorteo.idaYVuelta, trasSuHora }, aLaPar: par });
        }
        return par;
      },
      coronada,
    }) : null;
    if (auditar && puerta) void puerta.then((a) => (document.documentElement.dataset.puerta = a));
    if (graba && !despuesDelShow) grabando = grabarAparte(graba, puerta);
    $("sec-draw").style.display = "block";
    $("seed-label").textContent = `${t("seed")} ${beacon.round}`;
    // Arrancó desde la espera en grande (ella todavía hace de cortina): el show
    // termina en el resultado en grande, sin soltar la pantalla completa.
    // En un Amigo secreto, nunca en grande: la pantalla grande mostraría el reparto.
    granFinal = !amigo && enGrande() ? { pantalla: !!document.fullscreenElement } : null;
    seguirEnPantallaCompleta(granFinal?.pantalla === true);
    const finish = (): void => {
      reveal(names, winners, beacon, listHash);
      coronar();
      if (graba && despuesDelShow) void grabarAparte(graba);
    };
    // La marca del cartel final se pone antes de jugar: los juegos coronan con `cWin` durante la
    // animación, y si la marca recién llega en `reveal` leen la del sorteo anterior.
    setResultadoDeTurnos(isTurnOrder(names.length, winners.length, sello.prize));
    // En un Amigo secreto no hay juego: mostraría el orden, y el orden es el reparto. Se sale directo al
    // resultado, que es la lista de personas con el enlace de cada una, nunca el reparto (issue #99, S4 y S5).
    if (amigo) finish();
    else {
      // El show, de a un lugar si la sala los ve de a uno (issue #102): el primero ahora, los demás
      // con «Siguiente premio». Lo grabado y el comprobante siempre llevan los lugares todos.
      const visibles = app.drawn.revelados ?? winners.length;
      playGame(names, winners.slice(0, visibles), beacon, finish, orden, tarjeta, terminaEn !== null ? { conHora: { horario: { inicio: terminaEn }, avisos: { alCoronar: coronar } } } : {});
    }
    // La tarjeta ya está arriba: la cortina se va sin dejar ver la página.
    cortina?.cerrar();
    // El show arrancó y el resultado está fijado: este sello ya no está en marcha. Hasta el 16 de noviembre de 2026 la
    // marca seguía hasta que terminaba la grabación (con la red lenta, más de un minuto), y el sorteo del premio
    // siguiente no arrancaba ni decía por qué. La grabación tiene su propia guarda, por sello (`grabarAparte`).
    soltarLaMarcha(sello);
    await grabando;
  } catch (e) {
    // Lo inesperado, en cualquier paso: sin esto la cortina quedaba tapando la
    // pantalla y el botón apagado, con la sala mirando. Se dice lo que fue (un
    // corte de red ya no sale como "la red rechazó la transacción"), con el
    // detalle plegado debajo.
    sinShow();
    console.warn("[tinkazo] el sorteo se cortó", e);
    // El resultado ya estaba fijado: lo que falló fue el show, no el sorteo. Se ve sin show, como cuando el juego no se
    // alcanza a bajar, y se graba: la grabación dice cómo terminó y su botón la vuelve a probar. Con la billetera propia
    // la grabación se iba a pedir al terminar el show, así que se pide ahora. Hasta el 16 de noviembre de 2026 ese
    // sorteo quedaba sin grabar, sin resultado a la vista y con un botón que no hacía nada.
    if (fijado && app.frozen === sello && app.drawn?.beacon === fijado.beacon) {
      try {
        reveal(names, fijado.winners, fijado.beacon, listHash);
      } catch (r) {
        console.warn("[tinkazo] el resultado no se pudo mostrar", r);
      }
      // El resultado ya está a la vista: si la grabación esperaba eso, ya puede salir.
      coronar();
      if (fijado.graba && !grabando) grabando = grabarAparte(fijado.graba);
      await grabando;
      return;
    }
    // Sin resultado a la vista (se soltó el sello): una grabación que esperaba la corona no espera más.
    coronar();
    if (grabando) {
      await grabando;
      return;
    }
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

/** Un sorteo con sello que la sala ya vio y que se graba aparte (`grabarAparte`). */
interface PorGrabar {
  sello: NonNullable<typeof app.frozen>;
  beacon: Beacon;
  winners: number[];
  pagarConMiCuenta: boolean;
}

/** El sorteo de la pantalla cuya grabación no terminó bien: el botón de sortear la vuelve a probar (`draw`). */
let porGrabar: PorGrabar | null = null;

/**
 * Los sellos cuya grabación esta página está esperando: otro toque no la vuelve a esperar ni dice dos veces cómo terminó.
 * Que la grabación misma vaya de a una por sorteo, también entre el show y Guardarlo ahora de Mis sorteos, lo cuida
 * `grabarElSorteo` (`grabacion-en-curso.ts`).
 */
const grabandoAhora = new Set<object>();

/** Salir de la página mientras la grabación espera su puerta o se manda: el navegador pregunta. */
function avisarAntesDeSalir(ev: BeforeUnloadEvent): void {
  ev.preventDefault();
  // Los navegadores que no miran `preventDefault` en este evento miran esto.
  ev.returnValue = "";
}

/** El juego y la duración que juega la sala son los del enlace del último QR de este sello. */
function mismoJuegoQueElQr(sello: NonNullable<typeof app.frozen>, juego: Game, ritmo: string): boolean {
  const p = publicado(sello);
  return !!p && p.juego === juego && p.ritmo === ritmo;
}

/** La línea del resultado que dice si el sorteo ya quedó guardado. Sin ella, la de siempre, debajo del botón. */
const cajaDeLaGrabacion = (): HTMLElement => document.getElementById("grab-estado") ?? $("draw-status");

/** El sorteo que se graba sigue siendo el de la pantalla (no se pasó al siguiente premio). */
const sigueEnPantalla = (g: PorGrabar): boolean => app.frozen === g.sello && app.drawn?.beacon === g.beacon;

/**
 * Graba aparte un sorteo que la sala ya vio (`grabar-sorteo.ts`): cuando la cadena lo acepta, con los reintentos de
 * siempre. Mientras tanto el resultado dice que se está guardando, y al terminar lo dice y completa el comprobante con
 * el enlace del sorteo grabado. Si la pantalla ya pasó a otro sorteo, sigue igual y lo anota en Mis sorteos. Si no se
 * puede, el ganador no cambia: lo dice, con el botón para volver a probar, y Mis sorteos lo puede terminar más tarde.
 * No lanza nunca: el show ya está en marcha.
 */
async function grabarAparte(g: PorGrabar, puerta: Promise<Apertura> | null = null): Promise<void> {
  const raffleId = g.sello.raffleId;
  if (raffleId === undefined) return;
  // Ya se está grabando este sorteo: otro toque no manda otra grabación. Las de otros sellos siguen cada una por su lado.
  if (grabandoAhora.has(g.sello)) return;
  grabandoAhora.add(g.sello);
  // Con celulares mirando, la grabación espera su puerta (`puerta-de-la-grabacion.ts`). Mientras tanto, y hasta que
  // quede guardado, salir de la página pregunta: cerrar justo después de quién gana lo dejaría sin grabar.
  const conCelulares = puerta !== null && hayEspectadores(g.sello);
  if (conCelulares) window.addEventListener("beforeunload", avisarAntesDeSalir);
  // Hasta que quede guardado, el botón de sortear de este sello la vuelve a probar (con el botón apagado mientras va).
  porGrabar = g;
  const caja = cajaDeLaGrabacion();
  const escribir = (texto: string): void => {
    if (!sigueEnPantalla(g)) return;
    limpiarDetalle(caja.id);
    caja.style.display = "block";
    caja.className = "txstatus";
    caja.dataset.grabacion = "guardando";
    caja.textContent = texto;
  };
  escribir(t("grabGuardando"));
  const btn = document.getElementById("btn-draw");
  if (btn instanceof HTMLButtonElement && sigueEnPantalla(g)) btn.disabled = true;
  let fin: FinDeLaGrabacion;
  try {
    const [{ errorKey }, { avisoDelReintento }] = await Promise.all([import("../stellar/errores"), import("./sorteo-seguro")]);
    if (puerta) await puerta;
    fin = await grabarElSorteo({
      raffleId,
      round: g.sello.round,
      signature: g.beacon.signature,
      esperados: g.winners,
      pagarConMiCuenta: g.pagarConMiCuenta,
      // Con la billetera propia, se ve lo que hay que aprobar: es lo único que tiene que hacer la persona.
      alPaso: (step, detail) => {
        if (step === "signing" && currentSession()?.aMano === true && sigueEnPantalla(g)) showTxStatus(caja.id, step, detail);
      },
      // Dice lo que pasó: la red no contestó, estaba ocupada, todavía no se puede grabar u otra cosa.
      alReintentar: (proximo, total, e) => {
        const aviso = avisoDelReintento(errorKey(e));
        escribir(aviso === "drawTry" ? T[getLang()].drawTry(proximo, total) : t(aviso).replace("{i}", String(proximo)).replace("{n}", String(total)));
      },
    });
  } catch (e) {
    fin = { estado: "fallo", error: e };
  } finally {
    // Terminó este intento: lo que sigue (proteger la cuenta y volver a grabar, o el botón) puede mandar otro.
    grabandoAhora.delete(g.sello);
    if (conCelulares) window.removeEventListener("beforeunload", avisarAntesDeSalir);
  }
  if (fin.estado !== "fallo" && porGrabar === g) porGrabar = null;
  try {
    if (fin.estado === "guardado") alGuardar(g, fin.txHash);
    else if (fin.estado === "no-coincide") alNoCoincidir(g, fin.esperados, fin.grabados);
    else await alNoGuardar(g, fin.error);
  } catch (e) {
    console.warn("[tinkazo] no se pudo decir cómo terminó la grabación", e);
  }
}

/** Quedó grabado: el resultado lo dice, y el comprobante y Mis sorteos se completan con el enlace del sorteo grabado. */
function alGuardar(g: PorGrabar, txHash: string | undefined): void {
  contar("draw_confirmed", { network: network.name });
  // El primer sorteo de la cuenta suma monedas (detrás de VITE_MONEDAS; el demo y el ensayo no cuentan: no graban).
  const cuenta = sinGrabar() ? undefined : currentSession()?.address;
  if (cuenta) acreditarEnSegundoPlano(cuenta, "primer_sorteo");
  if (!sigueEnPantalla(g) || !app.drawn) {
    // La pantalla ya pasó a otro sorteo: solo Mis sorteos se entera.
    anotarEnMisSorteos(g, { porGrabar: false, ...(txHash ? { drawTx: txHash } : {}) });
    return;
  }
  // Todavía en el show: Mis sorteos ya lo sabe guardado, por si la pestaña se cierra antes del resultado.
  if ($("winner-box").style.display !== "block") anotarEnMisSorteos(g, { porGrabar: false, ...(txHash ? { drawTx: txHash } : {}) }, false);
  app.drawn.guardado = true;
  if (txHash) app.drawn.drawTx = txHash;
  const caja = cajaDeLaGrabacion();
  limpiarDetalle(caja.id);
  caja.style.display = "block";
  caja.className = "txstatus ok";
  caja.dataset.grabacion = "guardado";
  caja.textContent = t("grabGuardado");
  if (txHash) enlaceDelSorteo(caja, txHash, " ", true);
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.classList.remove("lista");
  btn.dataset.i = "drawnDone";
  btn.textContent = t("drawnDone");
  // Con el resultado ya a la vista, el comprobante y Mis sorteos se rehacen con el sorteo grabado.
  if ($("winner-box").style.display === "block") {
    if (txHash) enlaceDelSorteo($("proof"), txHash, ", ");
    // Si el enlace corto ya se había armado (se compartió o se mostró en grande), se arma también el del comprobante
    // nuevo: el QR y los avisos pasan a él cuando llega (`alAcortar`).
    const habiaCorto = !!cortoLink;
    void buildProof(g.sello.names, g.winners, roundUrl(g.beacon.round)).then((enlace) => {
      if (!enlace || !sigueEnPantalla(g)) return;
      if (habiaCorto && puedeAcortar()) void acortar(enlace);
      // La pantalla grande, si está abierta, pasa su QR al comprobante con el sorteo grabado (`pantalla.ts`).
      document.dispatchEvent(new CustomEvent("tinkazo:comprobante", { detail: enlace }));
    });
  }
}

/**
 * El contrato grabó otros ganadores que los que vio la sala. No puede pasar (la misma cuenta, con lo mismo), y si
 * pasa es un error grave del programa: se dice en grande y en la consola, nunca en silencio. Queda anotado en Mis
 * sorteos, que no lo ofrece guardar otra vez ni compartir. Si la pantalla ya pasó a otro sorteo, el aviso no se
 * escribe en el nuevo. Si sigue en pantalla, ese resultado no se comparte ni se muestra su QR hasta revisarlo. Hasta
 * el 16 de noviembre de 2026 el aviso caía en el sorteo que estuviera a la vista y compartir seguía andando.
 */
function alNoCoincidir(g: PorGrabar, esperados: number[], grabados: number[]): void {
  console.error("[tinkazo] error grave: el sorteo grabado no coincide con el resultado de la pantalla", { esperados, grabados });
  contar("draw_failed", { network: network.name, error: errorContable("unknown") });
  anotarEnMisSorteos(g, { porGrabar: false, noCoincide: true });
  if (!sigueEnPantalla(g) || !app.drawn) return;
  app.drawn.noCoincide = true;
  apagarCompartir();
  const caja = cajaDeLaGrabacion();
  limpiarDetalle(caja.id);
  caja.style.display = "block";
  caja.className = "txstatus bad";
  caja.dataset.grabacion = "no-coincide";
  caja.setAttribute("role", "alert");
  caja.textContent = t("grabNoCoincide");
  verError(caja);
}

/** El resultado de la pantalla está en duda: lo grabado no coincide (`alNoCoincidir`). No se comparte hasta revisarlo. */
const enDuda = (): boolean => app.drawn?.noCoincide === true;

/**
 * Apaga lo que comparte un resultado en duda: el QR, los avisos por WhatsApp y por correo, compartir, copiar el mensaje
 * y mostrarlo en grande. La pantalla grande, si está abierta, saca su QR sola (`pantalla.ts`). `newDraw` los devuelve.
 */
function apagarCompartir(): void {
  const qr = document.getElementById("qr-box");
  if (qr) qr.style.display = "none";
  for (const id of ["btn-whatsapp", "btn-email"]) {
    const a = document.getElementById(id);
    a?.removeAttribute("href");
    a?.setAttribute("aria-disabled", "true");
  }
  for (const id of ["btn-proof", "btn-copy", "btn-grande"]) {
    const b = document.getElementById(id);
    if (b instanceof HTMLButtonElement) b.disabled = true;
  }
}

/** No se pudo grabar: el ganador no cambia. Se dice por qué, con el botón para volver a probar. */
async function alNoGuardar(g: PorGrabar, error: unknown): Promise<void> {
  const { errorKey } = await import("../stellar/errores");
  const caja = cajaDeLaGrabacion();
  // Pollar 0.12 (mainnet): la cuenta pide una forma de recuperarla antes de firmar. Se abre "Protegé tu cuenta" y, si
  // la protege, se graba de nuevo, una sola vez por intento (el contrato acepta un solo sorteo por sello).
  if (!protegiendoElSorteo && (await pideProtegerLaCuenta(error))) {
    protegiendoElSorteo = true;
    try {
      if (await protegerLaCuenta($("btn-draw"), caja.id)) {
        await grabarAparte(g);
        return;
      }
    } finally {
      protegiendoElSorteo = false;
    }
  }
  // Un solo fallo contado: el del final, no el que abrió la ventana de proteger la cuenta.
  contar("draw_failed", { network: network.name, error: errorContable(errorKey(error, { patrocinada: await cuentaPatrocinada() }), error) });
  console.warn("[tinkazo] el sorteo no se pudo grabar", error);
  if (!sigueEnPantalla(g)) {
    anotarEnMisSorteos(g, { porGrabar: true });
    return;
  }
  const clave = errorKey(error);
  const recupera = clave === "notFound" || clave === "alreadyDrawn" ? clave : null;
  caja.style.display = "block";
  caja.className = "txstatus bad";
  // Si lo que sigue no es guardar (ver el sorteo que ya estaba grabado, o volver a preparar la lista), la pantalla grande
  // lo dice sin botón (`pantalla.ts`): se sigue desde la página. Hasta el 16 de noviembre de 2026 decía "error" y su
  // Guardar el sorteo ejecutaba la recuperación, que se llevaba el proyector al comprobante o soltaba el sello con el
  // ganador todavía en grande.
  caja.dataset.grabacion = recupera ? "recuperar" : "error";
  await escribirError(caja, error, "sorteo");
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = false;
  btn.classList.add("lista");
  btn.dataset.i = "grabReintentar";
  btn.textContent = t("grabReintentar");
  if (recupera) {
    await ofrecerRecuperacion(caja, recupera, g.beacon);
    return;
  }
  // La puerta del premio (`VITE_RAMPA=premios`): la cuenta ya puede guardar dinero y no firma. Volver a probar da lo mismo
  // para siempre, así que Guardar el sorteo no se ofrece. La salida es el comprobante, donde cualquiera con una billetera
  // termina el sorteo. Con `premioSinSaber` sí: la próxima lectura puede responder.
  if (clave === "premioGuardado" && (await ofrecerElComprobante(caja, g))) return;
  // El servicio que cubre la comisión no pudo: si la cuenta tiene con qué pagar la suya, esa es la segunda salida.
  const segunda = (await sePuedeSortearPagando(error)) ? accionDePagarConMiCuenta() : undefined;
  verError(caja, { texto: t("grabReintentar"), ejecutar: () => void draw() }, segunda);
  if (segunda) ponerSegundaAccion(caja, segunda);
}

/**
 * Completa la fila de Mis sorteos de un sorteo jugado, con sus ganadores y su número: alcanza para que Mis sorteos lo
 * termine de guardar (`falteGrabar`). La demo, el ensayo y lo que nació sin cuenta no se anotan. `pintar`: vuelve a
 * dibujar Mis sorteos, que pregunta a la cadena; con el show recién arrancando no hace falta.
 */
function anotarEnMisSorteos(g: PorGrabar, cambios: { porGrabar: boolean; drawTx?: string; noCoincide?: boolean }, pintar = true): void {
  const quien = sinGrabar() ? undefined : currentSession()?.address;
  if (!quien || g.sello.sinCuenta) return;
  const { sello } = g;
  void import("./history")
    .then((h) => {
      h.remember({
        organizer: quien,
        listHash: sello.listHash,
        count: sello.names.length,
        numWinners: g.winners.length,
        round: sello.round,
        sealedAt: sello.ts,
        prize: sello.prize,
        // En un Amigo secreto, el orden no se anota: `winners` es el orden, y el orden es el reparto (issue #99, S5).
        ...(isSecretSanta(sello.names.length, g.winners.length, sello.prize) ? {} : { winners: g.winners.map((i) => sello.names[i] ?? "") }),
        ...(sello.logo ? { logo: sello.logo } : {}),
        ...(sello.raffleId !== undefined ? { id: String(sello.raffleId) } : {}),
        ...(sello.raffleId !== undefined && network.contractId ? { contract: network.contractId } : {}),
        ...cambios,
      });
      if (pintar) h.renderHistory(quien);
    })
    // Mis sorteos no está en la página (otra vista) o no bajó: lo anotado queda para la próxima vez que se pinte.
    .catch((e: unknown) => console.warn("[tinkazo] Mis sorteos no se pudo anotar", e));
}

/**
 * La línea del lugar en pantalla («Lugar 2 de 5»), con el premio de ese lugar si existiera.
 * reveal la pinta con cada lugar mostrado, y el cambio de idioma la repinta (`onLangChange`).
 */
function pintarLugarActual(): void {
  const lugar = document.getElementById("lugar-actual");
  if (!lugar) return;
  const d = app.drawn;
  if (!d || d.revelados === undefined || d.winners.length < 2) {
    lugar.style.display = "none";
    lugar.textContent = "";
    return;
  }
  const cual = Math.min(d.revelados, d.winners.length);
  const premio = premioDelLugar(cual);
  lugar.textContent = T[getLang()].lugarDe(cual, d.winners.length) + (premio ? `: ${premio}` : "");
  lugar.style.display = "block";
}

/**
 * El enlace al sorteo grabado, al final de una línea, si todavía no lo tiene. Cuando la línea termina en punto, el
 * enlace empieza con mayúscula (`trasUnPunto`).
 */
function enlaceDelSorteo(linea: HTMLElement, txHash: string, antes: string, trasUnPunto = false): void {
  if (linea.querySelector("a[data-sorteo-grabado]")) return;
  linea.append(antes);
  const a = document.createElement("a");
  a.href = txUrl(txHash);
  a.target = "_blank";
  a.rel = "noopener";
  a.dataset.sorteoGrabado = "1";
  const texto = t("onChain");
  a.textContent = (trasUnPunto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto) + " ↗";
  linea.appendChild(a);
}

/**
 * La compuerta del sorteo con el cobro por uso: el portero tiene que decir que la cuenta tiene acceso al modo Oficial.
 * Sin acceso, el paso de la cuenta; si no contesta, no se firma y se dice, con el botón para volver a probar. Sortear lo
 * que ya está sellado no gasta sorteos oficiales. Si el módulo no baja, tampoco se firma.
 */
async function accesoOficialParaSortear(): Promise<boolean> {
  const btn = document.getElementById("btn-draw");
  const status = document.getElementById("draw-status");
  let clave = "errAnchor.porteroFondoSorteo";
  try {
    const { accesoParaSortear } = await import("./sin-sorteos");
    const r = await accesoParaSortear({
      volverA: btn,
      alRevisar: (revisando) => {
        // Como la compuerta del sello: mientras se revisa, el botón no se aprieta.
        if (btn instanceof HTMLButtonElement) btn.disabled = revisando;
        if (!status) return;
        status.style.display = revisando ? "block" : "none";
        status.className = "txstatus";
        if (revisando) status.textContent = t("clRevisando");
      },
    });
    if (r.sigue) return true;
    clave = r.clave;
  } catch {
    /* no bajó: cerrado, con el mensaje de volver a probar */
  }
  cortoLaCompuerta(clave);
  return false;
}

/**
 * Una compuerta del modo Oficial no dejó seguir (la cuenta sin activar, el acceso): el sorteo no arrancó. El motivo
 * junto al botón, que vuelve a probar, y la espera en grande lo muestra en grande con su Reintentar (`verError`).
 * Lanzado por adelantado, antes de que nazca el número, la cuenta regresiva vuelve a mandar el botón y lo enciende
 * cuando nace (`sorteo-en-marcha.ts`).
 */
function cortoLaCompuerta(clave: string): void {
  const btn = document.getElementById("btn-draw");
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = false;
    btn.classList.add("lista");
    btn.textContent = t("drawRetry");
  }
  const status = document.getElementById("draw-status");
  if (!status) return;
  status.style.display = "block";
  status.className = "txstatus bad";
  status.textContent = t(clave);
  verError(status);
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

/**
 * El enlace del comprobante de un sorteo sellado. Consulta exactamente este número, contrato y red; no depende de que el
 * historial local lo contenga, y conserva el hash del sello si existe.
 */
async function enlaceDelComprobante(sello: NonNullable<typeof app.frozen>, beacon: Beacon): Promise<string> {
  return proofUrl({
    v: PROOF_VERSION, names: sello.names, round: sello.round, sealedAt: sello.ts,
    prize: sello.prize, net: network.name, contract: network.contractId ?? "",
    id: String(sello.raffleId), signature: beacon.signature,
    ...(sello.sealTx ? { stx: sello.sealTx } : {}),
  });
}

/**
 * La puerta del premio frenó la grabación: la acción es abrir el comprobante en otra pestaña, y no se vuelve a probar.
 * El aviso de la caja ya dijo que cualquiera con Varial lo termina ahí y que la comisión sale de su XLM. `false` si el
 * sello no tiene número (no hay comprobante que abrir) y hay que seguir con lo de siempre.
 */
async function ofrecerElComprobante(status: HTMLElement, g: PorGrabar): Promise<boolean> {
  const { sello, beacon } = g;
  if (sello.raffleId === undefined) return false;
  const enlace = await enlaceDelComprobante(sello, beacon);
  if (app.frozen !== sello) return true;
  const accion: AccionError = { texto: t("histSeeProof"), ejecutar: () => void window.open(enlace, "_blank", "noopener") };
  recuperacion = { sello, accion };
  const btn = $("btn-draw");
  btn.dataset.i = "histSeeProof";
  btn.textContent = accion.texto;
  verError(status, accion);
  return true;
}

/** Recupera el paso, no la operación: preparar no sella y consultar no vuelve a sortear. */
async function ofrecerRecuperacion(status: HTMLElement, causa: "notFound" | "alreadyDrawn", beacon: Beacon): Promise<void> {
  const sello = app.frozen;
  if (!sello || sello.raffleId === undefined) return;
  const ausencia = causa === "notFound" && await existenciaDelSorteo(sello.raffleId) === "ausente";
  const enlace = ausencia ? "" : await enlaceDelComprobante(sello, beacon);
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
function abrirCortina(premio: string, orden: boolean): { cerrar: () => void } {
  let el: HTMLElement | null = null;
  const reloj = setTimeout(() => {
    el = document.createElement("div");
    el.className = "cortina";
    el.setAttribute("role", "status");
    el.innerHTML =
      (premio
        ? orden
          ? `<h2>${esc(t("cortinaSeOrden"))}</h2>`
          : `<p class="kicker">${esc(t("cortinaSe"))}</p><h2>${esc(premio)}</h2>`
        : `<h2>${esc(t("cortinaSin"))}</h2>`) +
      `<p class="cortina-t">${esc(t("cortinaNumero"))}</p>` +
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

/** El sello de esta pantalla es un Amigo secreto: salen todos y el nombre empieza con Amigo secreto o Secret Santa. A diferencia de `esDeAmigo`, también vale antes de que el resultado esté fijado (`sortear`). */
const selloDeAmigo = (): boolean => {
  const f = app.frozen;
  if (!f) return false;
  const n = f.numWinners ?? Math.min(ganadoresPedidos(), f.names.length);
  return isSecretSanta(f.names.length, n, f.prize);
};

/**
 * La tarjeta de "cómo se juega", grande para la sala. Sus segundos salen del
 * mismo total que eligió quien sortea. Sin show (instantáneo o movimiento
 * reducido), ninguna. "¡Cuenten conmigo!" al final de la tarjeta (state.ts): un
 * tono por número, más alto en el 1. Los dos en la pentatónica, mi y do: el
 * 990 Hz de antes era un si, fuera de la escala de los juegos.
 * En un Amigo secreto, ninguna: no hay juego que jugar, y el juego mostraría el orden (issue #99, S4).
 */
function abrirTarjeta(
  game: Game,
  people: number,
  prizes: number,
  orden: boolean,
  espera?: Promise<unknown>,
  textoDeEspera?: string,
  lugar?: number,
): GameCard | null {
  if (skipMotion() || selloDeAmigo()) return null;
  const cuenta = conCuenta() ? CUENTA_SECONDS : 0;
  // El show de un lugar (los lugares de a uno) dice el premio de ese lugar, no el texto de todos. Sin lugares sellados
  // (`premioDeLugarEn` da null) o sin `lugar`, el premio sellado entero, como siempre.
  const sellado = app.frozen?.prize ?? "";
  const premio = lugar === undefined ? sellado : premioDeLugarEn(sellado, lugar) ?? sellado;
  const sonar = (n: number): void => beep(note(n > 1 ? 12 : 15), 0.16, "triangle", 0.07);
  return showGameCard(game, people, prizes, cuenta, sonar, premio, espera, orden, textoDeEspera, enStand());
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
/**
 * `extra.conHora`: el horario del estadio (`en-hora.ts`), para la sala lanzada desde la espera y el celular de quien mira.
 * `extra.espectador`: el show del celular. Cuenta siempre la tarjeta en la duración, como la sala, aunque no la muestre
 * (el que entra tarde): si no, el juego duraría otra cosa y no quedaría a la par. Y sin el motor nuevo no hay show: el de
 * respaldo no sigue horario ni retiene el final, y podría coronar antes que la sala.
 * `extra.lugar`: el show es de ese lugar solo («Siguiente premio» de a uno), y la tarjeta dice el premio de ese lugar.
 */
function playGame(
  names: string[],
  winners: number[],
  beacon: Beacon,
  finish: () => void,
  orden: boolean,
  previa: Previa | null = null,
  extra: { conHora?: { horario: Horario; avisos: Avisos } | null; espectador?: boolean; lugar?: number } = {},
): void {
  const conHora = extra.conHora ?? null;
  // Los equipos con cupón se ven por el nombre de su equipo; la lista sellada y el comprobante siguen con las cuentas.
  names = paraMostrar(names);
  // Y su nombre va entero en el show: «¡Vamos, Las Wawas!», nunca «Las W.». Sin equipos la lista queda vacía.
  ponerNombresEnteros(hayEtiquetas() ? nombresDeLosEquipos() : []);
  const pixi = usePixi();
  const game = juegoDe(names.length, winners.length, names, winners);
  // El juego que cuenta este resultado: la foto para compartir lleva su fondo (y el último, si se ve de nuevo con otro).
  if (app.drawn) app.drawn.juego = game;
  // Los archivos de sonido del juego bajan mientras la sala lee la tarjeta de "cómo se juega".
  sonidoDelJuego(game);
  const cuenta = conCuenta() ? CUENTA_SECONDS : 0;
  if (previa && previa.game !== game) previa.card.update(game);
  const card = previa
    ? previa.card
    : extra.espectador
      ? null
      : abrirTarjeta(game, names.length, winners.length, orden, undefined, undefined, extra.lugar);
  setCardSeconds(card || extra.espectador ? CARD_SECONDS : 0);
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
    // El motor de respaldo no sigue horario: esa pantalla no va a la par.
    pedirHorario(null);
    // En el celular de quien mira, sin el motor nuevo no hay show: el resultado sale cuando la sala ya lo mostró.
    if (extra.espectador) {
      fin();
      return;
    }
    const real = classicPlayable(app.game, names.length);
    if (app.drawn) app.drawn.juego = real;
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
    // El horario del estadio: la sala lanzada desde la espera y el celular de quien mira (`en-hora.ts`). Sin él, como siempre.
    pedirHorario(conHora?.horario ?? null, conHora?.avisos);
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

/** El resultado en pantalla es un Amigo secreto: salen todos y el nombre empieza con Amigo secreto o Secret Santa. */
const esDeAmigo = (): boolean =>
  !!app.frozen && !!app.drawn && isSecretSanta(app.frozen.names.length, app.drawn.winners.length, app.frozen.prize);

/**
 * El resultado de un Amigo secreto (issue #99, S5): la lista de personas, cada una con su botón Copiar enlace. El
 * enlace abre la página personal (`confirmar.html`), que dice solo a quién le regala, el nombre del sorteo y el
 * número del sello. La pantalla nunca muestra quién le regala a quién: ni el orden, ni el reparto.
 *
 * Los enlaces se arman en segundo plano (comprimir el fragmento es asíncrono); el botón espera el suyo al tocarlo.
 * Los nombres de la lista son los que se ven, sin el sufijo de una línea sellada (`turnOrderDisplayNames`); lo que
 * viaja en el enlace es el nombre sellado, tal cual está en el sello.
 */
let enlacesAmigo: Map<number, Promise<string>> | null = null;
let amigoEnlazado = false;

function pintarAmigo(names: string[], winners: number[]): void {
  const f = app.frozen;
  const round = app.drawn?.beacon.round ?? 0;
  const orden = turnOrderDisplayNames(names, winners);
  enlacesAmigo = new Map(
    reparto(names, winners).map((a, k) => [k, amigoUrl({ round, from: a.from, to: a.to, ...(f?.prize ? { prize: f.prize } : {}) })]),
  );
  $("winner-cards").innerHTML =
    `<h3 class="winner-lista-t" id="winner-lista-t" data-i="amigoResultadoT">${esc(t("amigoResultadoT"))}</h3>` +
    `<p class="note" data-i="amigoResultadoNota">${esc(t("amigoResultadoNota"))}</p>` +
    `<ol class="winner-lista amigo-lista" aria-labelledby="winner-lista-t">${orden
      .map(
        (nombre, k) =>
          `<li class="winner-fila amigo-fila" value="${k + 1}"><span class="winner-name">${esc(nombre)}</span>` +
          `<button class="ghost mini" type="button" data-amigo-enlace="${k}" data-i="amigoCopiar">${esc(t("amigoCopiar"))}</button></li>`,
      )
      .join("")}</ol>`;
  // El comprobante completo, ofrecido aparte (S7): lleva el reparto entero, y se comparte después del intercambio.
  const caja = $("winner-box");
  let aviso = document.getElementById("amigo-aviso");
  if (!aviso) {
    aviso = document.createElement("aside");
    aviso.id = "amigo-aviso";
    aviso.className = "note amigo-aviso";
    aviso.innerHTML = `<span data-i="amigoAvisoComprobante"></span> <button class="ghost mini" type="button" data-amigo-comprobante data-i="amigoVerComprobante"></button>`;
    $("winner-cards").after(aviso);
    aviso.querySelector("button")?.addEventListener("click", () => {
      if (proofLink && !enDuda()) location.assign(proofLink);
    });
  }
  aviso.querySelector<HTMLElement>("span")!.textContent = t("amigoAvisoComprobante");
  aviso.querySelector("button")!.textContent = t("amigoVerComprobante");
  aviso.style.display = "block";
  if (!amigoEnlazado) {
    amigoEnlazado = true;
    $("winner-cards").addEventListener("click", (e) => void alTocarEnlaceAmigo(e));
  }
}

/** Un toque en «Copiar enlace»: deja el enlace personal de esa persona en el portapapeles. */
async function alTocarEnlaceAmigo(e: Event): Promise<void> {
  const b = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>("button[data-amigo-enlace]");
  if (!b) return;
  const enlace = await enlacesAmigo?.get(Number(b.dataset.amigoEnlace))?.catch(() => "");
  if (!enlace) return;
  try {
    await navigator.clipboard.writeText(enlace);
    b.textContent = t("copied");
    setTimeout(() => (b.textContent = t("amigoCopiar")), 1600);
  } catch {
    // Sin permiso para el portapapeles, el enlace queda a la vista en un cuadro, ya elegido, para copiarlo a mano.
    const caja = document.createElement("textarea");
    caja.className = "turnos-texto";
    caja.readOnly = true;
    caja.value = enlace;
    caja.setAttribute("aria-label", t("amigoResultadoT"));
    b.after(caja);
    caja.select();
  }
}

export function reveal(names: string[], winners: number[], beacon: Beacon, listHash: string): void {
  // Un Amigo secreto: el orden es el reparto, así que ninguna pantalla lo muestra. Lo que se ve es la lista de
  // personas, cada una con su enlace personal, que dice solo a quién le regala (issue #99, S5).
  const amigo = isSecretSanta(names.length, winners.length, app.frozen?.prize ?? "");
  $("winner-box").style.display = "block";
  // El logo de la comunidad, en el renglón de "Lo que salió" (src/ui/logo-sorteo.ts). Sin logo, queda como siempre.
  pintarLogoEnElResultado();
  // La demo llegó al ganador: es lo único que se cuenta de ella (src/contar.ts). El ensayo avisa con `tinkazo:ensayo-fin`.
  if (params.has("demo")) contarPractica("demo");
  // Con el movimiento reducido el juego se salteó: se avisa, para que no parezca roto. En un Amigo secreto no hay
  // repetición que ofrecer: la nota con "Ver la animación igual" no sale.
  $("motion-note").style.display = !amigo && skippedForReducedMotion() ? "block" : "none";
  renderLore(beacon);
  // La leyenda del juego, si trae una: plegada y después del resultado, nunca durante el show.
  pintarLeyenda($("leyenda-box"), app.game, getLang(), { titulo: t("leyendaTitulo"), fuente: t("leyendaFuente") });
  const prize = app.frozen?.prize ?? "";
  // El cartel final de los juegos dice «¡El orden quedó listo!» cuando el resultado es un orden de
  // turnos (`cWin` de `i18n.ts` lee esta marca).
  setResultadoDeTurnos(isTurnOrder(names.length, winners.length, prize));
  // Con el resultado puesto, el selector dice que sirve para verlo de nuevo con otro juego.
  pintarNotaDelJuego();
  // Este premio ya salió: en el próximo sorteo queda marcado entre las opciones.
  marcarSalio(prize);
  // "No está" solo si queda con quién volver a sortear: dos personas, como
  // en "Otro premio". Quien salió se va entero, con todas sus participaciones.
  // Sin la bandera de los modos ni `?modo=`, se saca por línea, como siempre: «Grupo (1/2)» puede ser un nombre.
  const porPersona = modesVisible();
  // En el sorteo de una empresa no hay No está: el premio llega a la cuenta aunque la persona ya no esté en el stand. Una lista
  // de campaña que quedó sin sello (sin número de sorteo) tampoco lo ofrece.
  const deCampana = esSorteoDeCampana(app.frozen?.raffleId) || campanaDeLaLista(app.frozen?.listHash ?? "") !== null;
  const reemplazo = !deCampana && contarPersonas(sinLasPersonasQueSalieron(names, winners, porPersona), porPersona).personas >= 2;
  // Hasta seis, una tarjeta cada uno; con más, el primero en tarjeta y los demás en una lista (`resultado-ganadores.ts`).
  // Los equipos con cupón se ven por el nombre de su equipo, con la cuenta al lado (`equipos/etiquetas.ts`).
  // A las tarjetas va la lectura por persona, la de la cuenta (`seCuentaPorPersona`): no es la misma variable
  // que decide a quién se saca, que sigue siendo `porPersona`.
  // En un Amigo secreto, la lista de personas con su enlace de cada una: ni el reparto ni el orden, tampoco acá.
  // Issue #102: con la progresión de lugares, las tarjetas muestran hasta donde la sala vio. El
  // comprobante, el mensaje, la grabación y Mis sorteos llevan siempre los lugares todos: quedaron
  // fijos al nacer el número y cualquiera los puede calcular desde ese momento (lo dice la línea
  // de más abajo). Los índices de las tarjetas (`data-k`, para «No está») son los del resultado,
  // que es un prefijo del orden sellado. Se calcula antes de elegir qué se pinta porque también
  // decide, más abajo, qué tarjeta se encuadra.
  const enPantalla = app.drawn?.revelados === undefined ? winners.length : Math.max(1, Math.min(app.drawn.revelados, winners.length));
  if (amigo) pintarAmigo(names, winners);
  else {
    $("winner-cards").innerHTML = htmlDeGanadores({ names: names.map(etiquetaConCuenta), winners: winners.slice(0, enPantalla), prize, reemplazo, avatar, porPersona: seCuentaPorPersona(names, modesVisible()), stand: enStand() });
    // El lugar que la sala acaba de ver («Lugar 2 de 5») y, con un premio por lugar (#101), el de ese
    // lugar (`premioDelLugar`). Sin lugares la línea no dice premio. Con un solo lugar no se muestra.
    pintarLugarActual();
    // La verdad a la sala: nadie elige nada después del número. Con un solo lugar no hace falta decirla.
    const fijos = document.getElementById("lugares-fijos");
    if (fijos) {
      fijos.style.display = winners.length > 1 ? "block" : "none";
      fijos.textContent = t("lugaresFijos");
    }
    const avisoAmigo = document.getElementById("amigo-aviso");
    if (avisoAmigo) avisoAmigo.style.display = "none";
  }
  // En un Amigo secreto no hay pantalla grande ni repetición con otro juego: las dos mostrarían el orden, y el orden es el reparto.
  for (const id of ["btn-grande", "btn-otro-juego"]) {
    const b = document.getElementById(id);
    if (b) b.style.display = amigo ? "none" : "";
  }
  const proof = $("proof");
  // En un Amigo secreto la línea técnica no nombra a los ganadores: `winners=[…]` es el orden, y el orden es el reparto.
  proof.textContent =
    `Draw: quicknet round=${beacon.round}, ${t("proofOk")} ✓, randomness=${beacon.randomness.slice(0, 24)}…, list_hash=${listHash.slice(0, 24)}…, count=${names.length}${amigo ? "" : `, winners=[${winners.join(",")}]`}`;
  // El enlace del sorteo grabado. Si todavía se está grabando, lo agrega la grabación al terminar (`alGuardar`).
  const drawTx = app.drawn?.drawTx;
  if (drawTx) enlaceDelSorteo(proof, drawTx, ", ");
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
  if (pagosActivos() && !amigo) void import("./pagos-resultado").then((m) => m.mostrarPagosDelResultado()).catch(() => undefined);
  // El juego pidió bajar a "El sorteo" cuando el resultado todavía estaba
  // escondido: quedaba el selector de juegos arriba y el panel fuera de la
  // pantalla. Con el resultado ya puesto, se encuadra la sección entera.
  // Con los lugares de a uno, desde el segundo se encuadra la tarjeta de quien acaba de ganar: las tarjetas van de la #1
  // hacia abajo, y en 1366 x 768 la última quedaba fuera de la pantalla. En un Amigo secreto no hay tarjetas de lugar.
  const recien = !amigo && enPantalla > 1 && app.drawn?.revelados !== undefined
    ? ($("winner-cards").querySelector(`#wn-${enPantalla - 1}`)?.closest<HTMLElement>(".winner-card, .winner-fila") ?? null)
    : null;
  requestAnimationFrame(() => (recien ?? $("sec-draw")).scrollIntoView({ behavior: "smooth", block: recien ? "center" : "start" }));
  // El comprobante se arma aparte: comprimir la lista es asíncrono y no vale
  // la pena hacer esperar al confeti por eso.
  const enlace = buildProof(names, winners, url);
  // El sorteo de una empresa (detrás de VITE_CAMPANAS): la sala de la campaña se entera y lo comprueba en la red.
  if (deCampana) void import("./campana-resultado-real").then((m) => m.alRevelarReal(enlace)).catch(() => undefined);
  // Desde la espera en grande, el resultado sale en grande, con el QR en cuanto
  // esté el comprobante; al cerrarlo, la página sigue con "Siguiente premio".
  const final = granFinal;
  granFinal = null;
  seguirEnPantallaCompleta(false);
  // En el ensayo el resultado se queda en la página, con su final: en grande
  // mostraría un QR de un sorteo que no existe. Se suelta la pantalla completa.
  // Fuera del ensayo, en grande aunque se haya perdido la pantalla completa durante el show (Windows la suelta al
  // cambiar de proyector): es una capa de la página, y con varios ganadores el cartel del juego no los muestra a todos.
  // En un Amigo secreto, nunca en grande: el resultado en grande muestra el orden, y el orden es el reparto (S5).
  if (final && enPractica()) {
    soltarPantallaCompleta();
    enfocarDespues(principal);
  } else if (final) resultadoEnGrande(enlace, principal);
  else enfocarDespues(principal);
}

/** Abre el resultado en grande en el mismo instante, si `pantalla.ts` ya bajó (siempre, salvo un wifi muy lento). */
function resultadoEnGrande(enlace: Promise<string>, volverA: HTMLButtonElement): void {
  // En un Amigo secreto, nunca: el resultado en grande muestra el orden, y el orden es el reparto (issue #99, S5).
  if (esDeAmigo()) return;
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
  // En un Amigo secreto no hay repetición: el juego muestra el orden, y el orden es el reparto (issue #99, S4).
  const { frozen, drawn } = app;
  if (!frozen || !drawn || replaying || esDeAmigo()) return;
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
  }, isTurnOrder(frozen.names.length, drawn.winners.length, frozen.prize));
}

/** El show del celular a la par de la sala (`espectador.ts`): la tarjeta sale antes del número, como en la sala. */
export interface ShowALaPar {
  /** Si la sala cambió el juego a último momento (`app.game` ya es el nuevo), la tarjeta pasa a anunciarlo. */
  actualizar: () => void;
  /**
   * El juego, con lo que decidió la ronda y el horario del estadio. `alTerminar` recibe si el show mostró quién gana (el
   * cartel del juego). Sin movimiento, sin el motor nuevo o si el juego no bajó, no lo mostró. Tampoco si el estadio se
   * cerró antes del cartel: un cuadro que falla o un juego a medio armar lo cierran (`cuadro-seguro.ts`), también con el
   * final retenido, y eso no quiere decir que la sala ya lo mostró.
   */
  jugar: (conHora: { horario: Horario; avisos: Avisos }, alTerminar: (conShow: boolean) => void) => void;
  /** No hay show (no coincide con lo grabado, no llegó el número): la tarjeta se va. */
  cancelar: () => void;
}

/**
 * El show del celular de quien mira, a la par de la sala (`espectador.ts`). La tarjeta sale ya, con la línea de que llega
 * el número, y termina a la hora que dé el número que llegó (`resultado`, como la de la sala, un poco después). Después
 * el mismo juego que la sala, con el horario del estadio: retiene su final hasta que se suelte y, si quedó atrás, se pone
 * al día. Sin sortear, grabar, tocar el historial ni el comprobante, y sin contar nada. `conTarjeta`: false para quien
 * entra con el show ya empezado, que se pone al día sin tarjeta.
 */
export function showALaPar(o: { personas: number; premios: number; orden: boolean; resultado: Promise<{ terminaEn: number } | undefined>; conTarjeta?: boolean }): ShowALaPar {
  setResultadoDeTurnos(o.orden);
  const juego = juegoDe(o.personas, o.premios);
  const card = o.conTarjeta === false ? null : abrirTarjeta(juego, o.personas, o.premios, o.orden, o.resultado, "cortinaNumero");
  let tarjeta: Previa | null = card ? { card, game: juego } : null;
  let jugado = false;
  return {
    actualizar: () => {
      if (!tarjeta || jugado) return;
      const nuevo = juegoDe(o.personas, o.premios);
      if (nuevo !== tarjeta.game) {
        tarjeta.card.update(nuevo);
        tarjeta = { card: tarjeta.card, game: nuevo };
      }
    },
    jugar: (conHora, alTerminar) => {
      const { frozen, drawn } = app;
      if (jugado || !frozen || !drawn) return;
      jugado = true;
      // Con show solo si se vio el cartel: el estadio avisa que terminó en cualquier cierre (`cuadro-seguro.ts`).
      playGame(frozen.names, drawn.winners, drawn.beacon, () => alTerminar(estadoDelShow()?.coronado === true), o.orden, tarjeta, { conHora, espectador: true });
    },
    cancelar: () => {
      tarjeta?.card.hide();
      // Si ya jugaba, el estadio se cierra sin soltar su final: no mostró quién gana.
      if (jugado) cerrarElShow();
    },
  };
}

/** Lo que la vista de espectador hace con su show: lanzarlo cuando la sala también lo lanza, o sacar la tarjeta. */
export interface ShowDelEspectador {
  /** El juego, con lo que ya decidió la ronda. Una sola vez: para repetirlo está `verDeNuevo`. */
  jugar: (alTerminar: () => void) => void;
  /** El sorteo no se puede mostrar (no coincide con lo grabado): la tarjeta se va. */
  cancelar: () => void;
}

/**
 * El show de la vista de espectador (`espectador.ts`): el mismo de la sala, con lo que ya decidió la ronda
 * (`app.frozen` y `app.drawn`, que arma la vista). Es lo que hace `draw` después de traer el número, sin sortear,
 * grabar, tocar el historial ni el comprobante, y sin contar nada.
 *
 * Con un sorteo grabado en Stellar (`grabado`), la tarjeta del juego sale ya, y la cuenta y el juego esperan a que el
 * sorteo quede grabado, con la línea de que se está guardando. La sala ya no lo espera: juega con el número y graba
 * después. Esperarlo, con la espera de la regla, deja al celular detrás de la sala (`espectador-regla.ts`). Si la
 * tarjeta se va sola antes (quien organiza tardó en lanzarlo), el juego sale con una tarjeta nueva. Sin cadena (el modo
 * libre) la sala no espera nada, y la tarjeta sale al jugar.
 */
export function showDelEspectador(grabado: Promise<void> | null): ShowDelEspectador | null {
  const { frozen, drawn } = app;
  if (!frozen || !drawn) return null;
  const personas = frozen.names.length;
  const premios = drawn.winners.length;
  // El cartel final dice «¡El orden quedó listo!» cuando es un orden de turnos, como en la sala, y la tarjeta también.
  const orden = isTurnOrder(personas, premios, frozen.prize);
  // En un Amigo secreto no hay juego ni tarjeta: mostrarían el orden, y el orden es el reparto (issue #99, S4 y S5).
  const amigo = isSecretSanta(personas, premios, frozen.prize);
  setResultadoDeTurnos(orden);
  let tarjeta: Previa | null = null;
  let seFue = false;
  if (grabado) {
    const juego = juegoDe(personas, premios);
    // Lo que espera es lo grabado, no el número, que ya llegó: la línea de arriba lo dice.
    const card = abrirTarjeta(juego, personas, premios, orden, grabado, "cortinaGraba");
    if (card) {
      tarjeta = { card, game: juego };
      let llego = false;
      void grabado.then(
        () => (llego = true),
        () => undefined,
      );
      void card.ready.then(() => {
        if (!llego) seFue = true;
      });
    }
  }
  let jugado = false;
  return {
    jugar: (alTerminar) => {
      if (jugado) return;
      jugado = true;
      // En un Amigo secreto, sin juego: el juego muestra el orden, y el orden es el reparto (issue #99, S4).
      if (amigo) {
        alTerminar();
        return;
      }
      playGame(frozen.names, drawn.winners, drawn.beacon, alTerminar, orden, seFue ? null : tarjeta);
    },
    cancelar: () => tarjeta?.card.hide(),
  };
}

/** Un toque en "Probar otro juego" o en "Ver de nuevo con otro juego": al selector, con el foco en otro juego. */
export function elegirOtroJuegoParaVer(): void {
  if (!app.drawn || replaying || esDeAmigo()) return;
  irAlSelectorParaOtro();
}

// Después del resultado, un toque en el selector lo vuelve a mostrar con ese juego (freeze.ts, `elegirJuego`).
alElegirDespuesDelResultado((g) => verDeNuevo(g));

/** El sorteo que se ve es un orden de turnos: ganan tantas personas como hay en la lista y el nombre empieza con «Turnos». */
const esDeTurnos = (): boolean => !!app.frozen && !!app.drawn && isTurnOrder(app.frozen.names.length, app.drawn.winners.length, app.frozen.prize);

/**
 * Quiénes quedan en la lista sellada si se sacan, enteras, a las personas que ya salieron: con todas sus
 * participaciones. Así "No está" y "Siguiente premio" no dejan a medias a quien ya salió, y el reemplazo nunca
 * puede ser otra participación de quien no está: sus líneas ya no están.
 */
function sinGanadores(): string[] {
  const { frozen, drawn } = app;
  if (!frozen || !drawn) return [];
  // Sin la bandera de los modos ni `?modo=`, se saca por línea, como siempre.
  return sinLasPersonasQueSalieron(frozen.names, drawn.winners, modesVisible());
}

/**
 * Issue #102: «Siguiente premio» de a un lugar.
 *
 * Un sello con varios ganadores fija todos los lugares de una vez (protocolo §5: el orden de
 * los elegidos es el orden de los premios) y muestra de a uno: el primer show del primer lugar y
 * «Siguiente premio» con los que siguen del mismo resultado, con su show y sin volver a sellar.
 * La progresión vive en `app.drawn.revelados` (state.ts) y la decide `sortear`: solo con más de
 * un lugar, sin orden de turnos, y fuera del ensayo y del stand.
 *
 * Para después (issue #102): sellar también suplentes junto con los ganadores, para reemplazar a
 * quien no está («No está») sin volver a sellar. No se implementa acá: el reemplazo de hoy pide
 * su sello (`newDraw("ausente")`).
 */

/**
 * Cuántos lugares sellados todavía no vio la sala. Cero cuando la progresión no está en marcha:
 * la vista de espectador, un resultado retomado de Mis sorteos, un solo lugar o un orden de
 * turnos muestran todo de una vez, como siempre.
 */
export function lugaresSinMostrar(winners: readonly unknown[], revelados: number | undefined): number {
  if (revelados === undefined) return 0;
  return Math.max(0, winners.length - revelados);
}

/** El lugar que sigue, si hay: su índice en `winners` (base 0) y su número para la sala (base 1). */
export interface LugarQueSigue {
  indice: number;
  lugar: number;
  total: number;
}

/**
 * El lugar que sigue del mismo resultado, o `null` cuando ya se mostraron todos — «Siguiente
 * premio» vuelve a lo de siempre: sellar entre quienes quedan. Con un solo lugar sellado no hay
 * progresión, y sin `revelados` tampoco (no está en marcha): los dos vuelven a lo de antes.
 */
export function lugarQueSigue(winners: readonly unknown[], revelados: number | undefined): LugarQueSigue | null {
  if (revelados === undefined || winners.length < 2) return null;
  return revelados < winners.length ? { indice: revelados, lugar: revelados + 1, total: winners.length } : null;
}

/**
 * El premio del lugar `lugar` (base 1), cuando existe (issue #101: un premio por lugar).
 *
 * Lo lee del texto sellado con los rótulos de cada lugar (`premioDeLugarEn`) y va junto al contador de lugares. Sin
 * lugares (un solo premio, un sorteo de antes) o con ese lugar sin premio escrito devuelve "" y la línea no dice
 * premio, como antes.
 */
export function premioDelLugar(lugar: number): string {
  return premioDeLugarEn(app.frozen?.prize ?? "", lugar) ?? "";
}

/**
 * El premio que se pone para sortear de nuevo los lugares de quien no está. Sin lugares, el sellado entero, como
 * siempre. Con un premio por lugar, el de su lugar, o los de sus lugares armados de nuevo desde el 1.er premio si salió
 * más de una vez (`armarMeta`). Con el módulo reemplazado de las pruebas, que no trae `armarMeta`, queda el sellado.
 */
function premioDelReemplazo(premio: string, lugares: readonly number[]): string {
  const suyos = premiosDeLosLugares(premio, lugares);
  if (suyos === null) return premio;
  if (suyos.length <= 1) return suyos[0] ?? "";
  try {
    return premiosModulo.armarMeta?.(suyos, getLang()) ?? premio;
  } catch {
    return premio;
  }
}

/**
 * "Siguiente premio" (btn-again-sin, en main.ts).
 *
 * Con lugares sellados que la sala todavía no vio, muestra el que sigue del mismo resultado, de
 * a uno y con su show, sin abrir la lista y sin sello nuevo (issue #102). Cuando se terminan los
 * lugares sellados, vuelve a lo de hoy: sellar entre quienes quedan (`newDraw`).
 */
export function siguientePremio(): void {
  const { frozen, drawn } = app;
  if (!frozen || !drawn || replaying) return;
  const sigue = lugarQueSigue(drawn.winners, drawn.revelados);
  if (!sigue) {
    newDraw("sinGanadores");
    return;
  }
  if (enDuda()) return;
  const revelados = sigue.indice + 1;
  // Un show a la vez: la misma guarda de «Ver de nuevo» (`replaying`) frena un segundo toque.
  replaying = true;
  playGame(frozen.names, [drawn.winners[sigue.indice] as number], drawn.beacon, () => {
    replaying = false;
    // La pantalla pasó a otra cosa (otro sello, «No está») mientras el show iba: no se pinta encima.
    if (app.frozen !== frozen || app.drawn !== drawn) return;
    drawn.revelados = revelados;
    reveal(frozen.names, drawn.winners, drawn.beacon, frozen.listHash);
  }, false, null, { lugar: sigue.lugar });
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
  // Issue #102: mientras queden lugares sellados que la sala no vio, la fila habla del lugar que
  // sigue del mismo resultado y no de las personas del próximo sello: todavía no se sella nada.
  // Cuando se terminan los lugares, `siguientePremio` vuelve a `newDraw` y esto entra al camino
  // de siempre.
  const pendiente = app.drawn ? lugarQueSigue(app.drawn.winners, app.drawn.revelados) : null;
  // Los textos hablan de personas: quien salió se va entero, con todas sus participaciones.
  const lineas = sinGanadores();
  const quedan = contarPersonas(lineas, modesVisible()).personas;
  const alcanza = quedan >= 2;
  // El número de los textos, con la cuenta del cuadro que va a quedar al tocar «Siguiente premio».
  const mostrar = cuentaParaMostrar(lineas, modesVisible()).personas;
  const sin = $<HTMLButtonElement>("btn-again-sin");
  const comprobante = $<HTMLButtonElement>("btn-proof");
  // En un Amigo secreto no hay «siguiente premio» (todos salen) ni diálogo de compartir: la foto y el mensaje
  // llevarían el reparto entero. El comprobante se ofrece aparte, con su aviso (`pintarAmigo`).
  const amigo = esDeAmigo();
  sin.style.display = amigo ? "none" : alcanza || pendiente ? "" : "none";
  // Con lugares por mostrar el botón no promete el cuadro de personas: sin contador, que todavía no se sella.
  sin.textContent = amigo || !pendiente ? L.againSin(mostrar) : L.againLugarBoton;
  comprobante.className = alcanza || pendiente || amigo ? "ghost" : "primary";
  $("btn-again-nueva").className = "ghost";
  // La principal va primero, también en el orden del teclado y del lector. Solo
  // si no lo está: sacarla y volverla a poner le quita el foco, y esto también
  // corre al cambiar de idioma.
  const principal = alcanza || pendiente ? sin : comprobante;
  const acciones = $("again-acciones");
  if (acciones.firstElementChild !== principal) acciones.prepend(principal);
  const titulo = $("again-t");
  titulo.dataset.i = alcanza || pendiente ? "againTitle" : "againTitleFin";
  titulo.textContent = t(titulo.dataset.i);
  // En un orden de turnos no queda nadie por sortear, y no se habla de ganar ni de premios.
  $("again-left").textContent = amigo
    ? t("amigoAgainLeft")
    : pendiente
      ? L.againLugar(pendiente.lugar, pendiente.total)
      : alcanza
        ? L.againLeft(mostrar, selladaEsDeEquipos())
        : esDeTurnos()
          ? t("turnsAgainFew")
          : L.againFew(mostrar, selladaEsDeEquipos());
  // Qué sigue, para la sala y para quien organiza: una línea, sin botón (los botones son los de arriba y el pliegue).
  // En un Amigo secreto no se muestra en grande ni se comparte la foto: el resultado ya está a la vista, sin reparto.
  const sigue = $("again-sigue");
  if (amigo) {
    sigue.hidden = true;
  } else {
    sigue.hidden = false;
    sigue.dataset.i = listaVinoDeLuma() ? "againSigueLuma" : "againSigue";
    sigue.textContent = t(sigue.dataset.i);
  }
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
  // La línea del lugar («Lugar 2 de 5») se repinta con el idioma, como la fila del siguiente premio.
  pintarLugarActual();
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
  // Para seguir hace falta dos personas distintas: una lista repartida puede dejar muchas líneas de una sola.
  const personas = contarPersonas(quedan, modesVisible()).personas;
  if (conLista && personas < 2) return;
  // El número de la nota, con la cuenta que va a decir el cuadro con esas líneas.
  const mostrar = cuentaParaMostrar(quedan, modesVisible()).personas;
  // Quiénes salieron, por persona y sin repetidos: con varias participaciones, una misma persona puede salir más
  // de una vez. Sin la bandera de los modos ni `?modo=`, quien salió es la línea que salió: los nombres tal cual.
  const porPersona = modesVisible();
  const elNombre = (n: string): string => (porPersona ? nombreDePersona(n) : n);
  const salieron = [...new Set(drawn.winners.map((i) => frozen.names[i] ?? "").filter(Boolean).map(elNombre))];
  const ausente = modo === "ausente" ? elNombre(frozen.names[drawn.winners[k] ?? -1] ?? "") : "";
  if (modo === "ausente" && !ausente) return;
  // Cuántos premios se llevaba quien no está: con varias participaciones pudo salir más de una vez, y se va
  // con todas sus líneas, así que todos sus premios se sortean de nuevo. Sin los modos es siempre uno.
  const premiosDelAusente = modo === "ausente" ? drawn.winners.filter((i) => elNombre(frozen.names[i] ?? "") === ausente).length : 0;
  // Los lugares de quien no está, contando desde el 1 en el orden que dio el sorteo: con un premio por lugar, se
  // vuelven a sortear los de esos lugares y no los de todos.
  const lugaresDelAusente = modo === "ausente"
    ? drawn.winners.flatMap((i, p) => (elNombre(frozen.names[i] ?? "") === ausente ? [p + 1] : []))
    : [];
  const premio = frozen.prize;
  // La lista sellada se guarda: "Usar otra lista" vacía el cuadro, y un clic
  // equivocado frente a la sala no puede costar la lista de Luma filtrada. Sin
  // quienes ya ganaron: recuperarla no puede devolverle la chance a nadie.
  anterior = conLista ? quedan : sinGanadores();
  app.drawn = null;
  // Con "Siguiente premio", el próximo sello sugiere otro juego: seguir sorteando es seguir jugando.
  if (modo === "sinGanadores") rotarJuego();
  unfreeze(quedan.join("\n"));
  // Con otra lista empieza otra sentada: los premios ya no figuran como "ya salió".
  if (modo === "otraLista") olvidarSalieron();
  // "Premios" no puede quedar en más que los que quedan: con 2 personas y 3
  // premios, el próximo sorteo los premiaba a todos sin avisar.
  if (modo === "ausente") {
    // Se reponen los premios de quien no estaba: uno, o todos los suyos si salió más de una vez. Los
    // reemplazos se llevan lo mismo: con un premio por lugar, el de los lugares de quien no está. Los
    // otros ganadores se quedan con lo suyo y no entran a este sorteo.
    const reemplazos = Math.max(1, Math.min(premiosDelAusente, quedan.length));
    ponerGanadores(reemplazos);
    ponerPremio(premioDelReemplazo(premio, lugaresDelAusente.slice(0, reemplazos)));
  } else if (quedan.length) {
    ponerGanadores(Math.min(ganadoresPedidos(), Math.max(1, quedan.length - 1)));
    // `ponerGanadores` no avisa con un evento: los campos por lugar siguen la cantidad nueva, o un campo de más
    // quedaba a la vista y su premio se sellaba con menos ganadores. (Las pruebas que reemplazan `premios.ts` no lo traen.)
    try {
      premiosModulo.actualizarLugares?.();
    } catch {
      /* el módulo reemplazado no lo trae: no hay campos por lugar */
    }
  }
  // Arriba del cuadro, qué cambió: quién salió de la lista, o cómo volver.
  const L = T[getLang()];
  const nota = $("again-note");
  // Con equipos, en la lista van las cuentas: la nota dice el nombre del equipo, nunca las 56 letras de la cuenta.
  nota.textContent =
    modo === "sinGanadores"
      ? L.againQuitados(salieron.map(etiquetaDe), mostrar, selladaEsDeEquipos())
      : modo === "ausente"
        ? L.ausenteNota(etiquetaDe(ausente), mostrar, salieron.length > 1, premiosDelAusente, selladaEsDeEquipos())
        : "";
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
  // El aviso del comprobante del Amigo secreto y sus enlaces: se arman de nuevo con el próximo resultado.
  document.getElementById("amigo-aviso")?.remove();
  enlacesAmigo = null;
  // El pliegue del resultado («Otra lista, copiar el mensaje y más») vuelve a salir cerrado con el próximo ganador.
  const masResultado = document.getElementById("mas-resultado");
  if (masResultado instanceof HTMLDetailsElement) masResultado.open = false;
  limpiarDetalle("draw-status");
  // La línea de la grabación del anterior se va con él: si todavía se está grabando, termina y lo anota en Mis sorteos.
  const grab = document.getElementById("grab-estado");
  if (grab) {
    limpiarDetalle("grab-estado");
    grab.style.display = "none";
    grab.textContent = "";
    delete grab.dataset.grabacion;
  }
  $("winner-cards").innerHTML = "";
  // El panel de ganadores y pagos del sorteo anterior (pagos-resultado.ts) no se queda para el siguiente.
  const pagosBox = document.getElementById("pagos-box");
  if (pagosBox) {
    pagosBox.replaceChildren();
    pagosBox.style.display = "none";
  }
  quitarLogoDelResultado();
  // Lo que apagó un resultado en duda (`apagarCompartir`) vuelve para el próximo.
  for (const id of ["btn-proof", "btn-copy", "btn-grande"]) {
    const b = document.getElementById(id);
    if (b instanceof HTMLButtonElement) b.disabled = false;
  }
  for (const id of ["btn-whatsapp", "btn-email"]) document.getElementById(id)?.removeAttribute("aria-disabled");
  $("sec-participants").scrollIntoView({ behavior: "smooth", block: "start" });
  // El foco va a la acción principal del paso que sigue, como en cada paso (docs/ux.md): con la lista lista
  // (sin los que ya ganaron, o con "No está"), sellar; con otra lista, cargarla. Hasta el 26 de octubre de 2026,
  // con un mouse caía en el premio, para nombrar el próximo, pero el premio quedó dentro del pliegue "Premio y
  // subir CSV", que está cerrado: `focus()` sobre algo escondido no hace nada, y el foco se
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
  // En un orden de turnos no hay «No está» sino «Copiar el orden» (resultado-ganadores.ts).
  if (alCopiarOrden(e)) return;
  alTocarAusente(e, (k) => newDraw("ausente", k));
}

/** La lista del sorteo anterior, para "Recuperar la lista anterior". */
let anterior: string[] = [];

/** Vuelve a poner en el cuadro la lista del sorteo anterior, sin quienes ya ganaron (`newDraw`). */
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
  if (enDuda()) return;
  if (f && d) setNotifyLinks(f.names, d.winners, cortoLink);
  void paintQr(cortoLink);
});

/** El resultado en grande para el proyector, con el QR del comprobante (pantalla.ts). */
export function mostrarGrande(): void {
  // Una ronda de ejemplo no tiene comprobante que mostrar, y uno en duda no se muestra hasta revisarlo. En un Amigo
  // secreto tampoco hay pantalla grande: mostraría el orden, y el orden es el reparto (issue #99, S5).
  if (enStand() || enDuda() || esDeAmigo()) return;
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
    const listo = await pintarQrDelComprobante(img, link);
    // Lo grabado no coincide con lo que se ve: el QR no sale (`alNoCoincidir`).
    if (enDuda()) {
      box.style.display = "none";
      return;
    }
    if (!listo) {
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
  // Un orden de turnos o un Amigo secreto sin sello no tienen comprobante: la verificación de un sorteo sin sello no
  // lleva la cantidad de ganadores y mostraría un solo ganador, o la lista entera como si fuera un sorteo común.
  const sinComprobante =
    ordenSinComprobante(names.length, winners.length, f.prize, sinSello) || amigoSinComprobante(names.length, winners.length, f.prize, sinSello);
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
    // Sin los modos a la vista el enlace queda como siempre, también el de un orden de turnos (`modoDelComprobante`).
    link = withMode(await proofUrl(proof), modoDelComprobante(names, winners.length, f.prize, modesVisible()));
  } catch {
    // Sin comprobante, el QR al menos lleva a la ronda del faro.
    link = roundLink;
  }
  proofLink = sinComprobante ? "" : link;
  // El logo de la comunidad va solo en el enlace corto: se registra una vez, y quienes acortan no cambian.
  ponerLogoDeRuta(rutaDe(link), logoPorHuella(f.logo));
  // El resultado dice si ese sorteo no se puede comprobar porque se siguió sin sello.
  const nota = document.getElementById("sin-sello-nota");
  if (nota) {
    nota.style.display = sinSello ? "block" : "none";
    // Un orden de turnos o un Amigo secreto sin sello lo dicen con su propia línea: no tienen comprobante.
    nota.dataset.i = sinComprobante ? (isSecretSanta(names.length, winners.length, f.prize) ? "amigoSinComprobante" : "turnsSinComprobante") : "redSinSelloEtiqueta";
    nota.textContent = t(nota.dataset.i);
  }
  // El botón de abrir el comprobante del Amigo secreto: sin comprobante, el aviso queda, sin botón.
  const botonComprobante = document.querySelector<HTMLButtonElement>("#amigo-aviso [data-amigo-comprobante]");
  if (botonComprobante) botonComprobante.hidden = sinComprobante;
  // Y el QR no invita a comprobar lo que no se puede comprobar: dice que no hay sello y qué se ve al escanearlo.
  ponerTextoDelSello(document.querySelector<HTMLElement>("#qr-box .kicker"), "qrDelResultado", sinSello);
  // Un comprobante nuevo empieza con su enlace largo; si ya se había compartido, con su corto.
  cortoLink = sinComprobante ? "" : (cortoGuardado(link)?.corto ?? "");
  // Y ahora se completa la fila del historial con el ganador y el comprobante.
  // La demo y el ensayo no son sorteos: no se anotan en Mis sorteos aunque haya
  // cuenta, igual que en el sello (freeze.ts).
  const f2 = app.frozen;
  const who = sinGrabar() ? undefined : currentSession()?.address;
  // Lo que nació sin cuenta no se anota, aunque la persona haya entrado con una mientras esperaba la ronda.
  if (f2 && who && !f2.sinCuenta) {
    void import("./history").then((h) => {
      h.remember({
        organizer: who,
        listHash: f2.listHash,
        count: names.length,
        numWinners: winners.length,
        round: d.beacon.round,
        sealedAt: f2.ts,
        prize: f2.prize,
        // En un Amigo secreto, el orden no se anota en Mis sorteos: `winners` es el orden, y el orden es el reparto
        // (issue #99, S5). El sorteo queda anotado igual, con su comprobante.
        ...(isSecretSanta(names.length, winners.length, f2.prize) ? {} : { winners: winners.map((i) => names[i] ?? "") }),
        ...(f2.logo ? { logo: f2.logo } : {}),
        // Un orden de turnos sin sello se anota con la ronda: Mis sorteos no le ofrece enlace de verificación.
        proof: sinComprobante ? roundLink : link,
        ...(f2.raffleId !== undefined ? { id: String(f2.raffleId) } : {}),
        // El número solo no dice de qué contrato es (cada uno arranca en 1).
        ...(f2.raffleId !== undefined && network.contractId ? { contract: network.contractId } : {}),
        ...(d.drawTx ? { drawTx: d.drawTx } : {}),
        // Con sello, si todavía no quedó grabado: Mis sorteos lo puede terminar si se cierra la pestaña antes.
        ...(f2.raffleId !== undefined ? { porGrabar: !d.guardado && !d.noCoincide } : {}),
        // Lo grabado no coincide con lo que se vio: Mis sorteos lo dice y no lo ofrece compartir.
        ...(d.noCoincide ? { noCoincide: true } : {}),
        // Sin sello (la red no dejó sellar): Mis sorteos lo dice.
        ...(sinSello ? { sinSello: true } : {}),
      });
      h.renderHistory(who);
    });
  }
  // Los avisos primero: el QR carga su librería aparte y tarda, y hacer
  // esperar a los botones de "avisarle por WhatsApp" por un cuadradito los
  // dejaba sin armar justo cuando el ganador aparece en pantalla.
  // Un resultado en duda (lo grabado no coincide) no se comparte ni muestra su QR hasta revisarlo.
  if (d.noCoincide) {
    apagarCompartir();
    return "";
  }
  setNotifyLinks(names, winners, sinComprobante ? "" : cortoLink || link);
  // Sin comprobante no hay qué escanear: el QR se esconde, y la pantalla grande tampoco lo muestra (`proofLink` vacío).
  if (sinComprobante) $("qr-box").style.display = "none";
  else void paintQr(cortoLink || link);
  return sinComprobante ? "" : link;
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
  // Quien salió, por persona cuando la lista se lee por persona: la marca (k/m) es interna, la sala lee el nombre.
  const porPersona = seCuentaPorPersona(names, modesVisible());
  const mostrar = (linea: string): string => (porPersona ? nombreDePersona(linea) : linea);
  const lista = winners.map((i) => mostrar(etiquetaDe(names[i] ?? "")));
  // Sin sello: que lo diga también lo que se pega en el grupo, y que no prometa lo que no se puede comprobar.
  const sinSello = !!app.frozen.sinSello && app.frozen.raffleId === undefined;
  const enlace = cortoLink || proofLink || roundUrl(beacon.round);
  // Un orden de turnos dice el orden, y que nadie lo eligió, y no quién ganó (src/modos/mensajes.ts).
  if (isTurnOrder(names.length, winners.length, prize)) return turnMessage(getLang(), { orden: lista, enlace, ...(sinSello ? { sinSello: true } : {}) });
  // Un Amigo secreto no dice el orden ni lleva el enlace del comprobante: el orden es el reparto (issue #99, S5).
  if (isSecretSanta(names.length, winners.length, prize)) return amigoMessage(getLang(), { prize: prize || undefined });
  // Quien salió más de una vez va una sola vez, con su cuenta: no «Ana y Ana». Singular o plural según los nombres ya juntos.
  const juntos = porPersona ? withRepeatCounts(getLang(), lista) : lista;
  const quienes = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(juntos);
  // Con varias participaciones por persona, el mensaje dice las dos cuentas y no solo las líneas de la lista.
  return T[getLang()].summary(quienes, names.length, prize, enlace, juntos.length > 1, sinSello, personasDeLaLista(names), esListaDeEquipos(names));
}

/**
 * Cuántas personas hay en la lista sellada, para lo que se comparte: la misma regla que la espera, las bases y la
 * verificación (`seCuentaPorPersona`). Sufijos que no cierran se cuentan por línea, como los cuenta la verificación.
 */
function personasDeLaLista(names: readonly string[]): number {
  return contarPersonas(names, seCuentaPorPersona(names, modesVisible())).personas;
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
  // Una ronda de ejemplo no tiene comprobante que compartir: su número no es público. Uno en duda, hasta revisarlo, tampoco.
  // En un Amigo secreto tampoco: la foto y el mensaje llevan el reparto entero (issue #99, S5).
  if (enStand() || enDuda() || esDeAmigo()) return;
  const f = app.frozen;
  const d = app.drawn;
  if (!f || !d) return;
  // Un orden de turnos sin sello no tiene comprobante: se comparte sin enlace (`buildProof`).
  const sinEnlace = ordenSinComprobante(f.names.length, d.winners.length, f.prize, !!f.sinSello && f.raffleId === undefined);
  const enlace = sinEnlace ? "" : proofLink || roundUrl(d.beacon.round);
  const mostrar = (linea: string): string => (seCuentaPorPersona(f.names, modesVisible()) ? nombreDePersona(linea) : linea);
  const datos = {
    enlace,
    ganadores: d.winners.map((i) => mostrar(etiquetaDe(f.names[i] ?? ""))),
    total: f.names.length,
    // Con varias participaciones por persona, el mensaje y la foto dicen las dos cuentas, con la misma regla
    // que la espera, las bases y la verificación (`seCuentaPorPersona`).
    personas: personasDeLaLista(f.names),
    // Con una lista de equipos, el mensaje y la foto cuentan equipos y no personas (lo dice la lista sellada).
    ...(esListaDeEquipos(f.names) ? { equipos: true } : {}),
    premio: f.prize,
    fecha: f.ts,
    ...(f.raffleId !== undefined ? { numero: String(f.raffleId), red: network.name } : {}),
    ref: refDelSorteo(),
    ...(f.sinSello && f.raffleId === undefined ? { sinSello: true } : {}),
    // El logo con el que se selló, no el de ahora (src/logo.ts).
    ...(logoPorHuella(f.logo) ? { logo: logoPorHuella(f.logo) as NonNullable<ReturnType<typeof logoPorHuella>> } : {}),
    // El juego que contó el resultado (el último, si se vio de nuevo con otro): la segunda foto lleva su fondo.
    ...(d.juego ? { juego: d.juego } : {}),
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
  // "Ana, Beto y Carla", no "Ana, Beto, Carla"; y en plural si son varios. Cuando la lista se lee por persona, el nombre
  // de la persona, sin la marca de la línea.
  const porPersona = seCuentaPorPersona(names, modesVisible());
  const mostrar = (linea: string): string => (porPersona ? nombreDePersona(linea) : linea);
  const lista = winners.map((i) => mostrar(etiquetaDe(names[i] ?? "")));
  // Al ganador de un sorteo sin sello tampoco se le dice que nadie lo eligió a dedo ni que lo revise: no se puede comprobar.
  const sinSello = !!app.frozen?.sinSello && app.frozen.raffleId === undefined;
  // Un orden de turnos: los botones de abajo mandan el orden entero, y cada renglón de la lista tiene su «Avisarle» con
  // «Te tocó el turno 3 de 12». Nadie «ganó» nada: las frases de ganar no se usan (src/modos/mensajes.ts).
  const turnos = isTurnOrder(names.length, winners.length, prize);
  // Un Amigo secreto: el aviso no nombra a nadie (el orden es el reparto) ni lleva el enlace del comprobante, que lo
  // muestra entero. Cada persona recibe su enlace de quien organiza (issue #99, S5).
  if (isSecretSanta(names.length, winners.length, prize)) {
    const aviso = amigoMessage(getLang(), { prize: prize || undefined });
    $<HTMLAnchorElement>("btn-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(aviso)}`;
    $<HTMLAnchorElement>("btn-email").href =
      `mailto:?subject=${encodeURIComponent(prize || t("amigoPrize"))}&body=${encodeURIComponent(aviso)}`;
    return;
  }
  // En un sorteo común, quien salió más de una vez va una sola vez, con su cuenta; en un orden de turnos no se junta a nadie.
  // Singular o plural según los nombres ya juntos: a quien se lleva todo se le habla de vos.
  const juntos = porPersona && !turnos ? withRepeatCounts(getLang(), lista) : lista;
  const who = new Intl.ListFormat(getLang() === "es" ? "es" : "en", { type: "conjunction" }).format(juntos);
  const body = turnos
    ? turnMessage(getLang(), { orden: lista, enlace: url, ...(sinSello ? { sinSello: true } : {}) })
    : T[getLang()].tellBody(who, prize, names.length, url, juntos.length > 1, sinSello, personasDeLaLista(names), esListaDeEquipos(names));
  $<HTMLAnchorElement>("btn-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(body)}`;
  $<HTMLAnchorElement>("btn-email").href =
    `mailto:?subject=${encodeURIComponent(t(turnos ? "turnsResultTitle" : "tellSubject"))}&body=${encodeURIComponent(body)}`;
  if (!turnos) return;
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[data-turno]")) {
    const aviso = turnNotice(getLang(), { turn: Number(a.dataset.turno) + 1, of: names.length, enlace: url, ...(sinSello ? { sinSello: true } : {}) });
    a.href = `https://wa.me/?text=${encodeURIComponent(aviso)}`;
    a.hidden = false;
  }
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
  if (enDuda()) return;
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
