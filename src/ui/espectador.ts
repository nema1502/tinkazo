import { esc } from "../dom";
import { getLang, setLang, t, T, type Lang } from "../i18n";
import { app, avatar, conCuenta, forzarRitmo, paceSeconds, type Beacon } from "../state";
import { setSoloMirar } from "../solo-mirar";
import { beep, note } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { listHash } from "../protocol/canonical";
import { cintas } from "./espera";
import { etiquetaConCuenta, ponerEtiquetas } from "../equipos/etiquetas";
import { nombreDePersona, seCuentaPorPersona } from "../participaciones";
import { hayModoOficial } from "../stellar/config";
import { modesVisible } from "../modos/bandera";
import { isTurnOrder } from "../modos/turnos";
import { PLAZO_DEL_RELAY_MS, conPlazo } from "../pedido-con-plazo";
import { desfaseDelReloj } from "./espectador-reloj";
import { NoCoincide, esperarElGrabado, mirarUnaVez, type Leer, type SorteoDelEnlace } from "./espectador-cadena";
import {
  RELECTURAS,
  anclaDelCelular,
  conTarjeta,
  esperaTrasLoGrabadoMs,
  horaDeBuscarElNumero,
  horaDeLaTarjeta,
  horaDeLoQueSalioSinShow,
  horaDeMirarLaCadena,
  horaDelFinal,
  juegoDelCelular,
  reglaDelShow,
  segundosDelJuego,
} from "./espectador-regla";
import { contratoDelEnlace, datosDelEnlace, refDelEnlace, type DatosEspectador } from "./espectador-enlace";
import type { ShowALaPar, ShowDelEspectador } from "./draw";
import { ANCLA_ANTES_S, anclaDeLaRondaUnaVez, anclaVirtual, horaDeLaRonda, medirElReloj, type Ancla } from "../reloj-de-la-ronda";
import { soltarElFinal } from "../games/en-hora";
import { releerCorto } from "../enlace-corto";

export { datosDelEnlace, enlaceEspectador, type DatosEspectador } from "./espectador-enlace";

/**
 * La vista de espectador: el mismo sorteo, en el celular de cada uno, sin servidor nuevo.
 *
 * Durante la espera de un sorteo real, la espera en grande muestra un QR (`espera.ts`, `espectador-enlace.ts`) con un
 * enlace a esta misma página. Quien lo escanea ve la misma espera: la cuenta que ve la sala, el premio y los nombres
 * pasando. El reloj compartido es la ronda: la cuenta sale de su hora, medida con una ronda que nace
 * (`reloj-de-la-ronda.ts`).
 *
 * Cuando nace el número, el celular lo trae él mismo de los servicios públicos de la ronda (el mismo camino que
 * `resolveBeacon` en `draw.ts`), lo verifica y calcula los ganadores con el protocolo (`select`). El ganador no existe
 * hasta que nace la ronda: la vista no lo puede revelar antes, porque no lo tiene.
 *
 * **A la par de la sala** (el enlace con `h: 1`, desde el 16 de noviembre de 2026). El celular abre su tarjeta y juega a
 * la hora que le da la llegada de su propio número, 1,2 s después que la sala (`espectador-regla.ts`). Retiene el final
 * de su juego (`games/en-hora.ts`) hasta ver el sorteo grabado en Stellar con los mismos ganadores
 * (`espectador-cadena.ts`): la sala, con celulares mirando, graba mientras juega solo si va a la par, y si no, después
 * de mostrar quién gana. Mientras retiene, la pantalla dice que espera a la de la sala. Si la sala cambió el juego con el
 * QR a la vista, el celular lo vuelve a leer antes de su tarjeta (`releerCorto`). Quien entra con el show empezado se pone
 * al día. Sin show (menos movimiento, sin el motor nuevo), Lo que salió espera lo grabado y el final del juego.
 *
 * **El camino de antes** (un enlace sin `h`, de una sala con el sitio de antes): espera lo grabado, y después lo que
 * dice la regla, y arranca el show desde el principio.
 *
 * Es solo para mirar: no hay sellar ni sortear, no toca la cadena más que para leer y no graba nada. No cuenta nada del
 * sorteo: la página suma una visita anónima, como cualquiera que entra al sitio (`analytics.ts`, sin la dirección
 * después de la ruta). El modo stand, la demo y el ensayo no muestran el QR (`sinGrabar`, en `espera.ts`).
 */

/** Lo que se espera a saber si el reloj del teléfono está corrido antes de dejar que la cuenta llegue a cero. */
const ESPERA_DEL_RELOJ_MS = 4_000;

/** Para las pruebas: el reloj, la cadena, el enlace y el número sin red, el azar de sus pausas y a dónde se va al salir. */
export interface OpcionesDeLaVista {
  desfase?: () => Promise<number>;
  leer?: Leer;
  azar?: () => number;
  irA?: (url: string) => void;
  /** La medida del reloj (`medirElReloj`): en las pruebas, sin red. */
  medir?: () => Promise<unknown>;
  /** El ancla del número (`anclaDeLaRonda`): en las pruebas, sin red. */
  ancla?: (round: number) => Promise<Ancla | null>;
  /** Volver a leer el enlace corto (`releerCorto`): en las pruebas, sin red. */
  releer?: typeof releerCorto;
  /** La referencia al enlace corto, si no es la del fragmento. */
  ref?: { id: string; clave: string; n: number } | null;
}

const PUNTOS = `<span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span>`;

/** Obtiene la ronda, verifica su firma y arma el beacon: el mismo camino de la sala (`resolveBeacon` en `draw.ts`). */
async function traerBeacon(round: number, onAttempt: (attempt: number, total: number) => void): Promise<Beacon> {
  const { signature } = await fetchRound(round, { onAttempt, fetchFn: conPlazo(fetch, PLAZO_DEL_RELAY_MS) });
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

/**
 * Los ganadores como los lee la sala en su resultado: la persona sin el número de su participación, y el equipo con el
 * comienzo de su cuenta al lado (`etiquetaConCuenta`). El nombre del equipo viaja en el enlace y no está sellado: la
 * cuenta sí, y es la que gana.
 */
function nombresDeGanadores(datos: DatosEspectador, winners: readonly number[]): string[] {
  // Con los modos a la vista en este sitio (la bandera de la versión), la misma lectura que la pantalla de la sala.
  const porPersona = seCuentaPorPersona(datos.n, modesVisible());
  return winners.map((i) => {
    const n = etiquetaConCuenta(datos.n[i] ?? "");
    return porPersona ? nombreDePersona(n) : n;
  });
}

/** Lo que un enlace releído puede cambiar: el juego, la duración y los nombres de los equipos. Lo demás tiene que ser igual. */
function mismoSorteo(a: DatosEspectador, b: DatosEspectador): boolean {
  return a.r === b.r && a.w === b.w && (a.z ?? "") === (b.z ?? "") && a.net === b.net && a.k === b.k && a.i === b.i && a.n.length === b.n.length && a.n.every((x, i) => x === b.n[i]);
}

/**
 * Abre la vista de espectador. Si la ronda ya nació (alguien que llega tarde, o que recarga), el show sale enseguida.
 * Devuelve si la abrió: un enlace que no nombra un sorteo de un contrato oficial dice que llegó roto.
 */
export function abrirEspectador(datos: DatosEspectador, lang: Lang = getLang(), op: OpcionesDeLaVista = {}): boolean {
  if (document.querySelector(".espectador")) return false;
  const contrato = contratoDelEnlace(datos);
  if (!contrato) {
    avisarEnlaceRoto(lang);
    return false;
  }
  setLang(lang);
  const aLaPar = datos.h === 1;
  // Un orden de turnos no tiene premio ni quien gane: el celular lo dice como la sala (`espera.ts`), con lo que está sellado.
  const orden = isTurnOrder(datos.n.length, datos.w, datos.z ?? "");
  // El show sale con el mismo ritmo y el mismo juego que el de la sala, sin cambiar el ritmo guardado de este navegador.
  forzarRitmo(datos.p);
  app.game = datos.g;
  // El show se mira entero: sin el Saltar del estadio ni el de la tarjeta. Saltarlo mostraba quién gana unos 40 s antes
  // que la sala (`solo-mirar.ts`).
  setSoloMirar(true);
  document.getElementById("st-skip")?.setAttribute("hidden", "");
  // Los equipos con cupón se ven por su nombre, como en la sala: la lista sellada son cuentas.
  if (datos.e) ponerEtiquetas(new Map(datos.e));
  const sorteo: SorteoDelEnlace = {
    contrato,
    id: datos.i,
    listHash: bytesToHex(listHash(datos.n)),
    count: datos.n.length,
    numWinners: datos.w,
    round: datos.r,
    ...(datos.z ? { premio: datos.z } : {}),
  };
  // Cuándo termina la cuenta y si el juego espera lo grabado: la regla de la sala (`espectador-regla.ts`).
  const regla = reglaDelShow(true);
  const objetivo = horaDeBuscarElNumero(datos.r, true);

  const capa = document.createElement("div");
  capa.className = "espera espectador";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", t("espVistaEspectador"));
  capa.tabIndex = -1;
  capa.innerHTML =
    `<div class="espera-top"><span class="sticker">${esc(t("espVistaEspectador"))}</span>` +
    // En Prueba la sala ve en qué modo está el sorteo, y el celular también.
    (hayModoOficial && datos.net === "testnet" ? `<span class="espera-prueba">${esc(t("netTest"))}</span>` : "") +
    `</div>` +
    `<p class="espera-lectura">${esc(t("espLectura"))}</p>` +
    (datos.z ? `<p class="espera-premio">${orden ? esc(t("cortinaSeOrden")) : `${esc(t("cortinaSe"))} <b>${esc(datos.z)}</b>`}</p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    // Lo que pasa cuando nace el número: la línea de lo que se espera, el error con su reintento o el resultado.
    `<div class="espera-sigue" hidden></div>` +
    `<div class="espera-nombres">${cintas(datos.n)}</div>` +
    `<p class="espera-nadie">${esc(t("espNadie"))}</p>` +
    `<p class="espera-id mono">${esc(t("waitIdPagina").replace("{n}", datos.i))}</p>`;
  document.body.appendChild(capa);
  capa.focus({ preventScroll: true });

  const sticker = capa.querySelector<HTMLElement>(".sticker");
  const reloj = capa.querySelector<HTMLElement>(".espera-reloj");
  const debajo = capa.querySelector<HTMLElement>(".espera-t");
  const sigue = capa.querySelector<HTMLElement>(".espera-sigue");
  type Fase = "cuenta" | "numero" | "grabando" | "show" | "fin" | "fallo";
  let fase: Fase = "cuenta";
  let timer = 0;
  let ultimoTic = -1;
  let intento = 0;
  const pendientes: number[] = [];

  /** Lo que se ve en el lugar de la cuenta. */
  const pasar = (html: string): void => {
    if (reloj) reloj.hidden = true;
    if (debajo) debajo.hidden = true;
    if (!sigue) return;
    sigue.innerHTML = html;
    sigue.hidden = false;
  };
  const linea = (texto: string): void => pasar(`<p class="cortina-t" role="status">${esc(texto)}</p>${PUNTOS}`);

  // La capa va encima de la página, pero el estadio va debajo de ella (la espera de la sala se cierra cuando el show la
  // tapa, `espera.ts`). Mientras el estadio está arriba, la capa se corre; al terminar, vuelve con lo que salió.
  const estadio = document.getElementById("stadium");
  const correr = (): void => {
    capa.classList.toggle("detras", estadio?.style.display === "block");
  };
  const obs = estadio ? new MutationObserver(correr) : null;
  if (estadio) obs?.observe(estadio, { attributes: true, attributeFilter: ["style"] });

  /**
   * La línea que tapa el estadio mientras el celular retiene su final o se pone al día: un cuadro quieto no se estudia,
   * y los segundos que se saltan no se ven. Encima de todo, con el fondo de la página.
   */
  let telon: HTMLElement | null = null;
  const tapar = (texto: string): void => {
    if (!telon) {
      telon = document.createElement("div");
      telon.className = "cortina espectador-telon";
      document.body.appendChild(telon);
    }
    telon.innerHTML = `<p class="cortina-t" role="status">${esc(texto)}</p>${PUNTOS}`;
  };
  const destapar = (): void => {
    telon?.remove();
    telon = null;
  };

  /** Sale de la vista a la herramienta limpia: sin la lista ni el resultado de este sorteo en la memoria de la página. */
  const salir = (): void => {
    window.clearInterval(timer);
    for (const p of pendientes) window.clearTimeout(p);
    destapar();
    obs?.disconnect();
    removeEventListener("keydown", tecla);
    (op.irA ?? ((url: string) => location.assign(url)))(location.pathname);
  };
  const tecla = (e: KeyboardEvent): void => {
    // Mientras corre el show, Escape no cierra la vista (ni salta el juego: el show se mira entero).
    if (e.key === "Escape" && fase !== "show" && fase !== "numero" && fase !== "grabando") salir();
  };
  addEventListener("keydown", tecla);

  /** Lo que salió, con un modo de volver a verlo. */
  const terminar = (): void => {
    fase = "fin";
    destapar();
    correr();
    // La sala ya coronó: verlo de nuevo se puede saltar, como siempre.
    setSoloMirar(false);
    document.getElementById("st-skip")?.removeAttribute("hidden");
    const d = app.drawn;
    if (!d) return;
    if (sticker) sticker.textContent = t("drawnDone");
    capa.setAttribute("aria-label", t("pantallaT"));
    for (const el of capa.querySelectorAll<HTMLElement>(".espera-nombres, .espera-lectura")) el.hidden = true;
    const nombres = nombresDeGanadores(datos, d.winners);
    pasar(
      `<p class="espectador-fin-t">${esc(t("pantallaT"))}</p>` +
        `<ol class="espectador-ganadores${nombres.length > 1 ? " varios" : ""}">` +
        nombres.map((n) => `<li><img src="${avatar(n, 56)}" alt="" />${esc(n)}</li>`).join("") +
        `</ol>` +
        // Un orden no tiene otro premio: no se pregunta por uno.
        (orden ? "" : `<p class="espectador-sigue">${esc(t("espFinSiguiente"))}</p>`) +
        `<div class="espectador-acc">` +
        `<button class="ghost" type="button" data-otra-vez>${esc(t("espVerDeNuevo"))}</button>` +
        `<a class="espectador-propio" href="/">${esc(t("espHacerElTuyo"))}</a>` +
        `</div>`,
    );
    const otraVez = sigue?.querySelector<HTMLButtonElement>("[data-otra-vez]");
    otraVez?.addEventListener("click", () => {
      void import("./draw").then((m) => m.verDeNuevo());
    });
    otraVez?.focus({ preventScroll: true });
  };

  /**
   * El show del celular terminó: Lo que salió, pero no antes de la hora de la regla (`horaDelFinal`). Con menos
   * movimiento el juego termina en el acto, y una sala lenta tarda más que el celular: mientras tanto, se mira la sala.
   * Siempre hay un margen, así que la línea se ve unos segundos también al final de un show normal. (El camino de antes.)
   */
  const terminarA = (hora: number): void => {
    const falta = hora - Date.now();
    if (falta <= 0) {
      terminar();
      return;
    }
    correr();
    linea(t(orden ? "espMiraLaSalaOrden" : "espMiraLaSala"));
    pendientes.push(window.setTimeout(terminar, falta));
  };

  /** No se pudo mostrar: el motivo y, si sirve, volver a probar. */
  const fallar = (clave: string, reintentable: boolean): void => {
    fase = "fallo";
    window.clearInterval(timer);
    destapar();
    // Un enlace que no es el sorteo grabado no deja a la vista lo que trae (otro premio, otros nombres).
    if (clave === "espNoCoincide") {
      for (const el of capa.querySelectorAll<HTMLElement>(".espera-premio, .espera-nombres, .espera-lectura")) el.hidden = true;
    }
    pasar(
      `<p class="espera-motivo" role="alert">${esc(t(clave))}</p>` +
        (reintentable ? `<button class="primary espera-accion" type="button">${esc(t("espProbar"))}</button>` : ""),
    );
    const b = sigue?.querySelector<HTMLButtonElement>(".espera-accion");
    b?.addEventListener("click", () => void (aLaPar ? alaPar() : nacio()));
    b?.focus({ preventScroll: true });
  };

  /** Los ganadores, calculados acá con el protocolo, quedan en la página como en la sala. */
  const fijarResultado = (beacon: Beacon): number[] => {
    const hash = bytesToHex(listHash(datos.n));
    const winners = select(hexToBytes(beacon.randomness), hexToBytes(hash), datos.n.length, datos.w);
    app.frozen = { names: datos.n, listHash: hash, ts: roundTime(datos.r), at: "-", prize: datos.z ?? "", round: datos.r };
    app.drawn = { beacon, winners };
    return winners;
  };

  /**
   * El camino de antes (un enlace sin `h`). Nació la ronda: trae el número él mismo, calcula los ganadores con el protocolo
   * y, con un sorteo sellado, espera a que quede grabado, como la sala. Nada de sellar, grabar ni contar.
   */
  const nacio = async (): Promise<void> => {
    const este = ++intento;
    fase = "numero";
    linea(t("cortinaNumero"));
    let show: ShowDelEspectador | null = null;
    try {
      const beacon = await traerBeacon(datos.r, (attempt, total) => {
        if (attempt > 1 && este === intento && fase === "numero") linea(T[getLang()].drandTry(attempt, total));
      });
      const winners = fijarResultado(beacon);
      const { showDelEspectador } = await import("./draw");
      let llego: () => void = () => undefined;
      const espera = regla.esperaLoGrabado ? sorteo : null;
      const grabado = espera ? new Promise<void>((r) => (llego = r)) : null;
      show = showDelEspectador(grabado);
      if (!show) throw new Error("sin-show");
      if (espera) {
        fase = "grabando";
        linea(t("cortinaGraba"));
        // La cadena, recién cuando acepta el sorteo grabado (en el reloj del teléfono, con su desfase).
        const mirarDesde = (horaDeMirarLaCadena(datos.r) - desfase) * 1000;
        // Termina cuando lo ve grabado o, pasado el tope de la regla, sin verlo: en los dos casos se juega.
        const visto = await esperarElGrabado(espera, { randomness: beacon.randomness, winners }, {
          ...(op.leer ? { leer: op.leer } : {}),
          ...(op.azar ? { azar: op.azar } : {}),
          noAntesDe: mirarDesde,
          alTardar: () => {
            if (este === intento && fase === "grabando") linea(t("espTarda"));
          },
        });
        // Visto grabado, todavía un momento. Si la sala lo lanzó tarde, además lo que ella tarda en leer su tarjeta
        // después de lanzar y una parte del show: la del celular ya está leída (`esperaTrasLoGrabadoMs`).
        if (visto === "grabado") await new Promise((r) => window.setTimeout(r, esperaTrasLoGrabadoMs(Date.now() - mirarDesde, paceSeconds(datos.p))));
        llego();
      }
      if (este !== intento) return;
      fase = "show";
      const lanzado = Date.now();
      const segundos = paceSeconds(datos.p);
      show.jugar(() => terminarA(horaDelFinal(lanzado, segundos, Date.now())));
    } catch (e) {
      show?.cancelar();
      if (este !== intento) return;
      if (e instanceof NoCoincide) fallar("espNoCoincide", false);
      else fallar(e instanceof Error && e.message === "bad-signature" ? "badSig" : orden ? "espSinNumeroOrden" : "espSinNumero", true);
    }
  };

  /* ------------------------------------------------------------------------------------------------ a la par */

  /** El ancla del número, pedida una sola vez (la cuenta la pide antes de la tarjeta, que en Rápido sale después del número). */
  const pedirAncla = (): Promise<Ancla | null> => (op.ancla ? op.ancla(datos.r) : anclaDeLaRondaUnaVez(datos.r));
  /** La hora de la ronda según este teléfono (segundos): el de la sala la mide igual (`reloj-de-la-ronda.ts`). */
  const hora = (): number => (aLaPar ? horaDeLaRonda() : Date.now() / 1000 + desfase);
  /** Si la duración de este sorteo lleva el 3, 2, 1 (la que diga el enlace, también si la sala la cambió). */
  const cuenta = (): boolean => conCuenta(datos.p);
  /** El show de este intento, para que una relectura tardía cambie su tarjeta. */
  let showActual: ShowALaPar | null = null;

  /**
   * Vuelve a leer el enlace corto (si puede cambiar): la sala pudo cambiar el juego o la duración con el QR a la vista.
   * Si es el mismo sorteo (la misma ronda, la misma lista, los mismos premios, el mismo número), toma el juego, la duración
   * y los nombres de los equipos nuevos. Si cambió otra cosa, lo ignora: nunca pasa a otro sorteo. Nunca vuelve a un
   * contenido más viejo que el que tiene. Antes de jugar: después, ya no cambia nada.
   */
  const ref = op.ref !== undefined ? op.ref : refDelEnlace(location.hash);
  let contador = ref?.n ?? 0;
  let jugando = false;
  const releer = async (): Promise<void> => {
    if (!ref || jugando) return;
    const r = await (op.releer ?? releerCorto)(ref.id, ref.clave).catch(() => null);
    if (!r || r.n < contador || jugando) return;
    const nuevos = datosDelEnlace(r.ruta.slice(1));
    if (!nuevos || nuevos.h !== 1 || !mismoSorteo(datos, nuevos)) return;
    contador = r.n;
    if (nuevos.g === datos.g && nuevos.p === datos.p) return;
    datos.g = nuevos.g;
    datos.p = nuevos.p;
    if (nuevos.e) {
      datos.e = nuevos.e;
      ponerEtiquetas(new Map(nuevos.e));
    }
    forzarRitmo(datos.p);
    app.game = datos.g;
    showActual?.actualizar();
  };

  /**
   * A la par de la sala. Abre la tarjeta a su hora, trae el número con el pedido que espera su nacimiento (el ancla) y
   * juega a la hora que le da esa llegada, con el final retenido hasta ver lo grabado. Quien llega con el show empezado
   * se pone al día; quien llega con todo terminado y lo grabado a la vista, ve Lo que salió.
   */
  const alaPar = async (): Promise<void> => {
    const este = ++intento;
    fase = "numero";
    linea(t("cortinaNumero"));
    let darHora: (h: { terminaEn: number } | undefined) => void = () => undefined;
    const resultado = new Promise<{ terminaEn: number } | undefined>((r) => (darHora = r));
    let show: ShowALaPar | null = null;
    try {
      const { showALaPar } = await import("./draw");
      const tarde = hora() >= roundTime(datos.r);
      // Con el número ya nacido no hay tarjeta: se decide cuando se sepa cuánto falta para el juego.
      if (!tarde) show = showALaPar({ personas: datos.n.length, premios: datos.w, orden, resultado });
      showActual = show;
      // El número: con el pedido que espera su nacimiento. Si no, como siempre, apenas nace.
      const ancla = await pedirAncla().catch(() => null);
      if (este !== intento) return;
      let beacon: Beacon | null = null;
      if (ancla?.firma && (await verifyRoundAsync(datos.r, ancla.firma).catch(() => false))) {
        beacon = { round: datos.r, randomness: bytesToHex(randomnessOf(ancla.firma)), signature: ancla.firma };
      }
      let trajo: number | null = null;
      if (!beacon) {
        const falta = (roundTime(datos.r) + 0.2 - hora()) * 1000;
        if (falta > 0) await new Promise((r) => pendientes.push(window.setTimeout(r, falta)));
        beacon = await traerBeacon(datos.r, (attempt, total) => {
          if (attempt > 1 && este === intento && fase === "numero") linea(T[getLang()].drandTry(attempt, total));
        });
        trajo = performance.now();
      }
      if (este !== intento) return;
      const winners = fijarResultado(beacon);
      // La hora cero de este celular: la llegada más temprana que tiene. Ninguna es antes de que nazca el número.
      const llegada = anclaDelCelular(ancla?.firma ? ancla.llegada : null, trajo, anclaVirtual(datos.r)) ?? performance.now();
      const inicio = juegoDelCelular(llegada, cuenta());
      const calculado = { randomness: beacon.randomness, winners };
      let grabadoEn: number | null = null;
      // Quien llega con el número ya nacido: con lugar para la cuenta, la tarjeta; si no, se pone al día sin ella.
      if (!show) {
        show = showALaPar({ personas: datos.n.length, premios: datos.w, orden, resultado, conTarjeta: conTarjeta(inicio - performance.now(), cuenta()) });
        showActual = show;
      }
      darHora({ terminaEn: inicio });
      fase = "show";
      jugando = true;
      const segundos = segundosDelJuego(paceSeconds(datos.p), cuenta());
      let terminoSinShow = false;
      const loQueSalio = (): void => {
        if (este !== intento) return;
        const h = horaDeLoQueSalioSinShow(inicio, segundos, grabadoEn);
        if (h === null) return;
        const falta = h - performance.now();
        if (falta <= 0) terminar();
        else pendientes.push(window.setTimeout(() => este === intento && terminar(), falta));
      };
      /**
       * Retenido en el momento decisivo, si la sala ya tarda en guardar y si la cadena no le contesta a este celular
       * (cambia la línea de la espera).
       */
      let retenido = false;
      let salaTarda = false;
      let sinConfirmar = false;
      const lineaDeEspera = (): string => t(sinConfirmar ? "espSinConfirmar" : salaTarda ? "espTarda" : "espEsperaLaSala");
      show.jugar(
        {
          horario: { inicio, retener: true, alcanzar: true },
          avisos: {
            alRetener: () => {
              retenido = true;
              if (este === intento && fase === "show") tapar(lineaDeEspera());
            },
            alSoltar: () => {
              retenido = false;
              destapar();
            },
            alPonerseAlDia: (en) => {
              if (este !== intento) return;
              if (en) tapar(t("espPonerAlDia"));
              else destapar();
            },
          },
        },
        (conShow) => {
          if (este !== intento) return;
          if (conShow) {
            terminar();
            return;
          }
          // Sin show, o el estadio se cerró antes del cartel (un cuadro que falló, con el final retenido o no): se mira la
          // sala, y Lo que salió cuando ya lo vio grabado y pasó el final del juego.
          terminoSinShow = true;
          destapar();
          correr();
          linea(t(orden ? "espMiraLaSalaOrden" : "espMiraLaSala"));
          loQueSalio();
        },
      );
      // La cadena, desde que acepta el sorteo grabado (en el reloj de la ronda): verlo grabado con los mismos ganadores
      // suelta el final, y nada más. Si no contesta, sigue mirando: soltarlo sin verlo podía mostrar quién gana con una
      // sala que todavía no lanzó. Hasta el 16 de noviembre de 2026 se soltaba igual a los dos minutos.
      const visto = await esperarElGrabado(sorteo, calculado, {
        ...(op.leer ? { leer: op.leer } : {}),
        ...(op.azar ? { azar: op.azar } : {}),
        ahora: () => hora() * 1000,
        noAntesDe: horaDeMirarLaCadena(datos.r) * 1000,
        alTardar: () => {
          // La sala no guardó el sorteo en mucho rato: si el celular ya espera en su momento decisivo, lo dice. Si todavía
          // juega, no tapa nada: lo va a decir cuando llegue ahí.
          salaTarda = true;
          if (este === intento && fase === "show" && retenido) tapar(lineaDeEspera());
        },
        alNoContestar: () => {
          // La cadena no le contesta a este celular: no puede saber si la sala ya lo mostró. Lo dice y sigue mirando.
          sinConfirmar = true;
          if (este === intento && fase === "show" && retenido) tapar(lineaDeEspera());
        },
      });
      if (este !== intento || visto !== "grabado") return;
      grabadoEn = performance.now();
      soltarElFinal();
      if (terminoSinShow) loQueSalio();
    } catch (e) {
      if (este !== intento) return;
      // Lo que calculó no es lo grabado (o no llegó el número): el show se cierra sin soltar su final, así que nunca
      // mostró quién gana, y lo que diga el estadio al cerrarse ya no es de este intento.
      intento++;
      show?.cancelar();
      jugando = false;
      if (e instanceof NoCoincide) fallar("espNoCoincide", false);
      else fallar(e instanceof Error && e.message === "bad-signature" ? "badSig" : orden ? "espSinNumeroOrden" : "espSinNumero", true);
    }
  };

  // El reloj del teléfono contra el de la ronda. Hasta saberlo (como mucho unos segundos), la cuenta corre con el del
  // teléfono pero no llega a cero: un reloj adelantado iría a buscar un número que todavía no existe.
  let desfase = 0;
  let relojListo = false;
  const listoElReloj = (): void => {
    relojListo = true;
    tick();
  };
  const plazoDelReloj = window.setTimeout(listoElReloj, ESPERA_DEL_RELOJ_MS);
  if (aLaPar) {
    // Con una ronda que nace (`reloj-de-la-ronda.ts`): unas centésimas, y un piso para quien llega tarde.
    void (op.medir ?? (() => medirElReloj()))()
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(plazoDelReloj);
        if (!relojListo) listoElReloj();
      });
  } else {
    void (op.desfase ?? (() => desfaseDelReloj()))()
      .then((d) => {
        if (Number.isFinite(d)) desfase = d;
      })
      .catch(() => undefined)
      .finally(() => {
        window.clearTimeout(plazoDelReloj);
        if (!relojListo) listoElReloj();
      });
  }

  // Un enlace que no es de este sorteo se dice enseguida, sin hacer esperar la cuenta. De paso baja lo que hace falta
  // para leer la cadena, y cuando nazca el número ya está.
  void mirarUnaVez(sorteo, op.leer).catch((e: unknown) => {
    if (e instanceof NoCoincide && fase === "cuenta") fallar("espNoCoincide", false);
  });

  // Las relecturas del enlace que puede cambiar, antes de la tarjeta, cada una con su desfase al azar.
  if (aLaPar && ref) {
    const azar = op.azar ?? Math.random;
    for (const r of RELECTURAS) {
      const en = (roundTime(datos.r) - r.antesS + azar() * r.azarS - hora()) * 1000;
      if (en > 0) pendientes.push(window.setTimeout(() => void releer(), en));
    }
  }

  const tick = (): void => {
    if (fase !== "cuenta") return;
    const ahora = hora();
    const s = Math.max(0, objetivo - Math.floor(ahora));
    if (reloj) reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    // Los mismos tonos de la espera de la sala: la cuenta se oye igual.
    if (s <= 5 && s > 0 && s !== ultimoTic) {
      ultimoTic = s;
      beep(note(12 - s * 2), 0.18, "triangle", 0.05);
    }
    if (!relojListo) return;
    // El pedido del ancla sale unos segundos antes del número, antes de la tarjeta (`reloj-de-la-ronda.ts`).
    if (aLaPar && roundTime(datos.r) - ahora <= ANCLA_ANTES_S) void pedirAncla();
    if (aLaPar) {
      // A la par: la tarjeta sale a su hora, un poco después que la de la sala.
      if (ahora >= horaDeLaTarjeta(datos.r, cuenta())) {
        window.clearInterval(timer);
        void alaPar();
      }
    } else if (s === 0) {
      window.clearInterval(timer);
      void nacio();
    }
  };
  tick();
  timer = window.setInterval(tick, 250);
  return true;
}

/**
 * El enlace del espectador llegó roto (un chat que lo cortó, un carácter de más): en vez de caer callado en la
 * herramienta de quien organiza, lo dice y ofrece seguir a la página, sin el fragmento roto en la dirección.
 */
export function avisarEnlaceRoto(lang: Lang = getLang()): void {
  if (document.querySelector(".espectador")) return;
  setLang(lang);
  const capa = document.createElement("div");
  capa.className = "espera espectador espectador-roto";
  capa.setAttribute("role", "dialog");
  capa.setAttribute("aria-modal", "true");
  capa.setAttribute("aria-label", t("espVistaEspectador"));
  capa.tabIndex = -1;
  capa.innerHTML =
    `<div class="espera-top"><span class="sticker">${esc(t("espVistaEspectador"))}</span></div>` +
    `<p class="espera-motivo" role="alert">${esc(t("espEnlaceRoto"))}</p>` +
    `<button class="primary espera-accion" type="button">${esc(t("espIrALaPagina"))}</button>`;
  document.body.appendChild(capa);
  const seguir = (): void => {
    removeEventListener("keydown", tecla);
    history.replaceState(null, "", location.pathname + location.search);
    capa.remove();
  };
  const tecla = (e: KeyboardEvent): void => {
    if (e.key === "Escape") seguir();
  };
  addEventListener("keydown", tecla);
  const b = capa.querySelector<HTMLButtonElement>(".espera-accion");
  b?.addEventListener("click", seguir);
  b?.focus({ preventScroll: true });
}
