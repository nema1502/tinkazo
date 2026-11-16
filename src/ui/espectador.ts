import { esc } from "../dom";
import { getLang, setLang, t, T, type Lang } from "../i18n";
import { app, avatar, forzarRitmo, type Beacon } from "../state";
import { beep, note } from "../sound";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf, roundTime } from "../protocol/quicknet";
import { verifyRoundAsync } from "../protocol/firma";
import { select } from "../protocol/select";
import { listHash } from "../protocol/canonical";
import { cintas } from "./espera";
import { paraMostrar, ponerEtiquetas } from "../equipos/etiquetas";
import { nombreDePersona, seCuentaPorPersona } from "../participaciones";
import { hayModoOficial } from "../stellar/config";
import { modesVisible } from "../modos/bandera";
import { PLAZO_DEL_RELAY_MS, conPlazo } from "../pedido-con-plazo";
import { desfaseDelReloj } from "./espectador-reloj";
import { NoCoincide, esperarElGrabado, mirarUnaVez, type Leer, type SorteoDelEnlace } from "./espectador-cadena";
import { horaDeBuscarElNumero, reglaDelShow } from "./espectador-regla";
import { contratoDelEnlace, type DatosEspectador } from "./espectador-enlace";
import type { ShowDelEspectador } from "./draw";

export { datosDelEnlace, enlaceEspectador, type DatosEspectador } from "./espectador-enlace";

/**
 * La vista de espectador: el mismo sorteo, en el celular de cada uno, sin servidor nuevo.
 *
 * Durante la espera de un sorteo real, la espera en grande muestra un QR (`espera.ts`, `espectador-enlace.ts`) con un
 * enlace a esta misma página. Quien lo escanea ve la misma espera: la cuenta que ve la sala, el premio y los nombres
 * pasando. El reloj compartido es la ronda: la cuenta sale de su hora y no de un servidor, y el reloj del teléfono se
 * compara antes con el de la ronda (`espectador-reloj.ts`). Cuándo termina la cuenta y cuándo arranca el juego respecto
 * de la ronda lo dice una sola regla, la de la sala (`espectador-regla.ts`).
 *
 * Cuando nace el número, el celular lo trae él mismo de los servicios públicos de la ronda (el mismo camino que
 * `resolveBeacon` en `draw.ts`), lo verifica y calcula los ganadores con el protocolo (`select`). El ganador no existe
 * hasta que nace la ronda: la vista no lo puede revelar antes, porque no lo tiene. Con un sorteo sellado, además,
 * espera a que quede grabado en Stellar y comprueba que es este (`espectador-cadena.ts`): la sala arranca el juego en
 * ese momento, y el celular no se le adelanta. Si no lo ve grabado en el tope de la regla, juega igual. Después corre
 * el mismo show (`showDelEspectador` en `draw.ts`).
 *
 * Es solo para mirar: no hay sellar ni sortear, no toca la cadena más que para leer y no graba nada. No cuenta nada del
 * sorteo: la página suma una visita anónima, como cualquiera que entra al sitio (`analytics.ts`, sin la dirección
 * después de la ruta). El modo stand, la demo y el ensayo no muestran el QR (`sinGrabar`, en `espera.ts`).
 */

/** Lo que se espera a saber si el reloj del teléfono está corrido antes de dejar que la cuenta llegue a cero. */
const ESPERA_DEL_RELOJ_MS = 4_000;

/** Para las pruebas: el desfase del reloj y la lectura de la cadena sin red, y a dónde se va al salir. */
export interface OpcionesDeLaVista {
  desfase?: () => Promise<number>;
  leer?: Leer;
  irA?: (url: string) => void;
}

const PUNTOS = `<span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span>`;

/** Obtiene la ronda, verifica su firma y arma el beacon: el mismo camino de la sala (`resolveBeacon` en `draw.ts`). */
async function traerBeacon(round: number, onAttempt: (attempt: number, total: number) => void): Promise<Beacon> {
  const { signature } = await fetchRound(round, { onAttempt, fetchFn: conPlazo(fetch, PLAZO_DEL_RELAY_MS) });
  if (!(await verifyRoundAsync(round, signature))) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

/** Los ganadores como los lee la sala: el nombre del equipo, y la persona sin el número de su participación. */
function nombresDeGanadores(datos: DatosEspectador, winners: readonly number[]): string[] {
  const vistos = paraMostrar(datos.n);
  // Con los modos a la vista en este sitio (la bandera de la versión), la misma lectura que la pantalla de la sala.
  const porPersona = seCuentaPorPersona(datos.n, modesVisible());
  return winners.map((i) => {
    const n = vistos[i] ?? "";
    return porPersona ? nombreDePersona(n) : n;
  });
}

/**
 * Abre la vista de espectador. Si la ronda ya nació (alguien que llega tarde, o que recarga), el show sale enseguida.
 * Devuelve si la abrió.
 */
export function abrirEspectador(datos: DatosEspectador, lang: Lang = getLang(), op: OpcionesDeLaVista = {}): boolean {
  if (document.querySelector(".espectador")) return false;
  setLang(lang);
  // El show sale con el mismo ritmo y el mismo juego que el de la sala, sin cambiar el ritmo guardado de este navegador.
  forzarRitmo(datos.p);
  app.game = datos.g;
  // Los equipos con cupón se ven por su nombre, como en la sala: la lista sellada son cuentas.
  if (datos.e) ponerEtiquetas(new Map(datos.e));
  const contrato = contratoDelEnlace(datos);
  const sorteo: SorteoDelEnlace | null =
    contrato && datos.i
      ? { contrato, id: datos.i, listHash: bytesToHex(listHash(datos.n)), count: datos.n.length, numWinners: datos.w, round: datos.r }
      : null;
  // Cuándo termina la cuenta y si el juego espera lo grabado: la regla de la sala (`espectador-regla.ts`).
  const regla = reglaDelShow(!!sorteo);
  const objetivo = horaDeBuscarElNumero(datos.r, !!sorteo);

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
    (datos.z ? `<p class="espera-premio">${esc(t("cortinaSe"))} <b>${esc(datos.z)}</b></p>` : "") +
    `<div class="espera-reloj mono">0:00</div>` +
    `<p class="espera-t">${esc(t("espFaltan"))}</p>` +
    // Lo que pasa cuando nace el número: la línea de lo que se espera, el error con su reintento o el resultado.
    `<div class="espera-sigue" hidden></div>` +
    `<div class="espera-nombres">${cintas(datos.n)}</div>` +
    `<p class="espera-nadie">${esc(t("espNadie"))}</p>` +
    (datos.i ? `<p class="espera-id mono">${esc(t("waitIdPagina").replace("{n}", datos.i))}</p>` : "");
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

  /** Sale de la vista a la herramienta limpia: sin la lista ni el resultado de este sorteo en la memoria de la página. */
  const salir = (): void => {
    window.clearInterval(timer);
    obs?.disconnect();
    removeEventListener("keydown", tecla);
    (op.irA ?? ((url: string) => location.assign(url)))(location.pathname);
  };
  const tecla = (e: KeyboardEvent): void => {
    // Mientras corre el show, Escape es del juego (saltar), no de la vista.
    if (e.key === "Escape" && fase !== "show" && fase !== "numero" && fase !== "grabando") salir();
  };
  addEventListener("keydown", tecla);

  /** Lo que salió, con un modo de volver a verlo. */
  const terminar = (): void => {
    fase = "fin";
    correr();
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
        `<p class="espectador-sigue">${esc(t("espFinSiguiente"))}</p>` +
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

  /** No se pudo mostrar: el motivo y, si sirve, volver a probar. */
  const fallar = (clave: string, reintentable: boolean): void => {
    fase = "fallo";
    window.clearInterval(timer);
    pasar(
      `<p class="espera-motivo" role="alert">${esc(t(clave))}</p>` +
        (reintentable ? `<button class="primary espera-accion" type="button">${esc(t("espProbar"))}</button>` : ""),
    );
    const b = sigue?.querySelector<HTMLButtonElement>(".espera-accion");
    b?.addEventListener("click", () => void nacio());
    b?.focus({ preventScroll: true });
  };

  /**
   * Nació la ronda: trae el número él mismo, calcula los ganadores con el protocolo y, con un sorteo sellado, espera a
   * que quede grabado, como la sala. Nada de sellar, grabar ni contar: el espectador solo mira.
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
      const hash = bytesToHex(listHash(datos.n));
      const winners = select(hexToBytes(beacon.randomness), hexToBytes(hash), datos.n.length, datos.w);
      app.frozen = { names: datos.n, listHash: hash, ts: roundTime(datos.r), at: "-", prize: datos.z ?? "", round: datos.r };
      app.drawn = { beacon, winners };
      const { showDelEspectador } = await import("./draw");
      let llego: () => void = () => undefined;
      const espera = sorteo && regla.esperaLoGrabado ? sorteo : null;
      const grabado = espera ? new Promise<void>((r) => (llego = r)) : null;
      show = showDelEspectador(grabado);
      if (!show) throw new Error("sin-show");
      if (espera) {
        fase = "grabando";
        linea(t("cortinaGraba"));
        // Termina cuando lo ve grabado o, pasado el tope de la regla, sin verlo: en los dos casos se juega.
        await esperarElGrabado(espera, { randomness: beacon.randomness, winners }, {
          ...(op.leer ? { leer: op.leer } : {}),
          alTardar: () => {
            if (este === intento && fase === "grabando") linea(t("espTarda"));
          },
        });
        llego();
      }
      if (este !== intento) return;
      fase = "show";
      show.jugar(terminar);
    } catch (e) {
      show?.cancelar();
      if (este !== intento) return;
      if (e instanceof NoCoincide) fallar("espNoCoincide", false);
      else fallar(e instanceof Error && e.message === "bad-signature" ? "badSig" : "espSinNumero", true);
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
  void (op.desfase ?? (() => desfaseDelReloj()))()
    .then((d) => {
      if (Number.isFinite(d)) desfase = d;
    })
    .catch(() => undefined)
    .finally(() => {
      window.clearTimeout(plazoDelReloj);
      if (!relojListo) listoElReloj();
    });

  // Un enlace que no es de este sorteo se dice enseguida, sin hacer esperar la cuenta. De paso baja lo que hace falta
  // para leer la cadena, y cuando nazca el número ya está.
  if (sorteo) {
    void mirarUnaVez(sorteo, op.leer).catch((e: unknown) => {
      if (e instanceof NoCoincide && fase === "cuenta") fallar("espNoCoincide", false);
    });
  }

  const tick = (): void => {
    if (fase !== "cuenta") return;
    const s = Math.max(0, objetivo - Math.floor(Date.now() / 1000 + desfase));
    if (reloj) reloj.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    // Los mismos tonos de la espera de la sala: la cuenta se oye igual.
    if (s <= 5 && s > 0 && s !== ultimoTic) {
      ultimoTic = s;
      beep(note(12 - s * 2), 0.18, "triangle", 0.05);
    }
    if (s === 0 && relojListo) {
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
