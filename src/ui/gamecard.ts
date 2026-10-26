import { hayPeloton } from "../duraciones";
import { T, getLang, t } from "../i18n";
import type { Game } from "../state";

/**
 * La tarjeta de "cómo se juega", antes de que arranque el juego.
 *
 * Grande, para que la lea la sala entera en el proyector: el nombre del juego,
 * la regla en una línea corta y una línea de honestidad, que el ganador ya
 * salió del número público y el juego solo lo cuenta. La pidió Nicolás el 4 de
 * octubre de 2026, y va con la regla de los juegos: los primeros segundos son
 * para llamar la atención de una sala que, entre el clic y "todos mirando",
 * está hablando (docs/juegos.md).
 *
 * Sale en los sorteos de verdad y en las demos. La escena fija de `?pose=`,
 * la de los auditores y las capturas, no pasa por acá, y con `?instant=1` o
 * con movimiento reducido no hay show. No suena por su cuenta: la música del
 * juego arranca con ella.
 */
/** Lo que dura la lectura; sale del total elegido. La cuenta va después y se suma. */
export const CARD_SECONDS = 3.5;

/** El nombre de cada juego, el mismo del selector. */
export const NOMBRE: Record<Game, string> = {
  race: "jgRaceN", luz: "jgLuzN", trompo: "jgTroN", pinata: "jgPinN", oruro: "jgOruN",
  tombola: "jgTomN", wheel: "jgWheelN", teleferico: "jgTelN", pasanaku: "jgPasN", stellar: "jgStellarN",
  sapo: "jgSapoN", quien: "jgQuienN", ledger: "jgLedgerN", rockets: "jgRocketsN", totora: "jgTotN",
  chovena: "jgChoN", trueque: "jgTruequeN",
};

/** La regla de cada uno, en una línea corta: qué mirar y quién gana. */
export const REGLA: Record<Game, string> = {
  race: "gcRace", luz: "gcLuz", trompo: "gcTrompo", pinata: "gcPinata", oruro: "gcOruro",
  tombola: "gcTombola", wheel: "gcWheel", teleferico: "gcTeleferico", pasanaku: "gcPasanaku", stellar: "gcStellar",
  sapo: "gcSapo", quien: "gcQuien", ledger: "gcLedger", rockets: "gcRockets", totora: "gcTotora",
  chovena: "gcChovena", trueque: "gcTrueque",
};

/**
 * Los que cuentan cada premio en pantalla, con su regla en plural. Los demás
 * cuentan el primero y muestran a todos en el cartel final, y la tarjeta lo
 * dice: con tres premios, "gana el último que sigue bailando" era mentira para
 * el segundo y el tercero.
 */
export const VARIOS: Partial<Record<Game, string>> = { sapo: "gcSapoMany", quien: "gcQuienMany", teleferico: "gcTelefericoMany", chovena: "gcChovenaMany", trueque: "gcTruequeMany" };

/** Los que tienen captura en public/juegos, para el fondo. */
const CAPTURA = new Set<Game>(["race", "chovena", "luz", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien", "trueque"]);

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export interface GameCard {
  /** Se cumple cuando pasó el tiempo de la tarjeta, o antes si alguien la saltó. */
  ready: Promise<void>;
  /** La saca, con un fundido corto. Se puede llamar varias veces. */
  hide: () => void;
  /** Cambia el juego que anuncia, sin reiniciar su tiempo: si el motor nuevo no arrancó, se juega otro. */
  update: (game: Game) => void;
}

/** El contenido de la tarjeta para un juego. */
function caja(game: Game, people: number, prizes: number, premio = ""): string {
  const L = T[getLang()];
  const lanes = (game === "race" || game === "rockets" || game === "totora") && people > 8;
  const varios = prizes > 1 ? VARIOS[game] : undefined;
  const extras = [
    // Con 9 a 30, la carrera es el pelotón: salen todas y quedan ocho en la final.
    lanes ? (game === "race" && hayPeloton(people) ? L.pelStart(people, 8) : L.cLanes(8, people)) : game === "sapo" && people > 12 ? t("gcSapoQual") : "",
    prizes > 1 && !varios ? L.gcPrizesNote(prizes) : "",
  ].filter(Boolean);
  return (
    `<p class="gc-kicker">${esc(t("gcKicker"))}</p>` +
    `<h2 class="gc-nombre" id="gc-nombre"><span>${esc(t(NOMBRE[game]))}</span></h2>` +
    `<p class="gc-regla" id="gc-regla">${esc(t(varios ?? REGLA[game]))}</p>` +
    extras.map((x) => `<p class="gc-extra">${esc(x)}</p>`).join("") +
    // Qué se sortea, con el nombre que le puso quien organiza: la tarjeta decía
    // "1 premio" sin decir cuál (revisión del experto en sorteos).
    (premio ? `<p class="gc-premio"><span>${esc(t("cortinaSe"))}</span> ${esc(premio)}</p>` : "") +
    `<p class="gc-chips"><span>${esc(L.gcPeople(people))}</span><span>${esc(L.gcPrizes(prizes))}</span></p>` +
    `<p class="gc-honesta" id="gc-honesta">${esc(t("gcHonest"))}</p>`
  );
}

/**
 * Muestra la tarjeta. Queda arriba hasta que aparece el estadio, para que entre
 * la tarjeta y el primer cuadro no se vea la página.
 */
/**
 * `cuenta` son los segundos de "¡Cuenten conmigo!" (cero, sin cuenta) y `sonar`
 * suena en cada número: los decide quien llama, así la tarjeta no depende del
 * estado ni del sonido y se puede probar sola.
 *
 * `espera`: la tarjeta sale antes de que el sorteo quede grabado, mientras se
 * graba (con cuenta, unos siete segundos). Hasta el 21 de octubre de 2026 la
 * sala miraba primero la cortina de "Grabando el sorteo…" y recién después la
 * tarjeta, una cosa detrás de la otra: unos quince segundos de "Lanzar el
 * sorteo" al juego, en cada premio (evaluación crítica de experiencia,
 * hallazgo 3). Ahora la tarjeta se lee mientras tanto, con esa línea arriba;
 * la cuenta de la sala y el juego esperan a que la promesa se cumpla, y la
 * barra se detiene mientras. La tarjeta no dice quién ganó: el ganador se
 * sigue mostrando después de grabarlo. Si grabar falla, quien llama la cierra.
 */
export function showGameCard(
  game: Game,
  people: number,
  prizes: number,
  cuenta = 0,
  sonar?: (n: number) => void,
  premio = "",
  espera?: Promise<unknown>,
): GameCard {
  const el = document.createElement("div");
  el.className = "game-card";
  // Un diálogo de verdad para el lector de pantalla: se anuncia porque el foco
  // entra, con su título y su regla.
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "gc-nombre");
  el.setAttribute("aria-describedby", "gc-regla gc-honesta");
  const total = CARD_SECONDS + cuenta;
  el.style.setProperty("--gc-ms", `${total * 1000}ms`);
  const fondo = (g: Game): void => {
    if (CAPTURA.has(g)) el.style.setProperty("--gc-img", `url("/juegos/${g}.webp")`);
    else el.style.removeProperty("--gc-img");
  };
  fondo(game);
  el.innerHTML =
    `<div class="gc-fondo" aria-hidden="true"></div>` +
    (espera
      ? `<p class="gc-graba" role="status"><span>${esc(t("cortinaGraba"))}</span><span class="cortina-puntos" aria-hidden="true"><i></i><i></i><i></i></span></p>`
      : "") +
    `<div class="gc-caja">${caja(game, people, prizes, premio)}</div>` +
    `<button class="gc-saltar" type="button">${esc(t("skip"))}</button>` +
    `<div class="gc-barra" aria-hidden="true"><i></i></div>`;
  document.body.appendChild(el);
  // El foco a la tarjeta: con el foco en un botón de atrás, Enter o espacio
  // para saltarla también lo apretaban.
  el.querySelector<HTMLButtonElement>(".gc-saltar")?.focus({ preventScroll: true });
  // Sin la barra de la página asomando al costado, como en el estadio.
  const overflowAntes = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let resolver: () => void = () => {};
  const ready = new Promise<void>((r) => (resolver = r));
  let listo = false;
  const pasos: number[] = [];
  let reloj = 0;
  const terminar = (): void => {
    if (listo) return;
    listo = true;
    clearTimeout(reloj);
    for (const p of pasos) clearTimeout(p);
    resolver();
  };

  // "¡Cuenten conmigo!": la regla se apaga y la sala cuenta 3, 2, 1 en voz alta.
  // `desde` es cuándo sale el primer número, en milisegundos desde ahora.
  const numero = ((): HTMLElement | null => {
    if (cuenta <= 0) return null;
    const nodo = document.createElement("div");
    nodo.className = "gc-cuenta";
    nodo.setAttribute("aria-live", "assertive");
    nodo.innerHTML = `<p class="gc-cuenta-t">${esc(t("gcCuenta"))}</p><p class="gc-cuenta-n"></p>`;
    el.appendChild(nodo);
    return nodo.querySelector<HTMLElement>(".gc-cuenta-n");
  })();
  const contar = (desde: number): void => {
    for (let i = 0; i < cuenta; i++) {
      pasos.push(window.setTimeout(() => {
        if (listo || !numero) return;
        el.classList.add("gc-contando");
        numero.textContent = String(cuenta - i);
        numero.classList.remove("gc-pum");
        void numero.offsetWidth; // para que la animación vuelva a empezar
        numero.classList.add("gc-pum");
        sonar?.(cuenta - i);
      }, desde + i * 1000));
    }
  };

  // Sin espera, todo cuenta desde ya: la lectura y después la cuenta. Con
  // espera, la cuenta arranca cuando pasaron la lectura y la espera; saltarla
  // mientras se graba va directo al juego apenas queda grabado.
  let saltada = false;
  let grabado = !espera;
  let tope = 0;
  const saltar = (): void => {
    if (grabado) terminar();
    else saltada = true;
  };
  if (!espera) {
    reloj = window.setTimeout(terminar, total * 1000);
    contar(CARD_SECONDS * 1000);
  } else {
    let leida = false;
    const seguir = (): void => {
      if (listo || !leida || !grabado) return;
      if (saltada) {
        terminar();
        return;
      }
      reloj = window.setTimeout(terminar, cuenta * 1000);
      contar(0);
      clearTimeout(tope);
      tope = window.setTimeout(hide, (cuenta + 10) * 1000);
    };
    pasos.push(window.setTimeout(() => {
      leida = true;
      // La barra se detiene donde termina la lectura hasta que quede grabado.
      if (!grabado) el.classList.add("gc-esperando");
      seguir();
    }, CARD_SECONDS * 1000));
    void espera.then(
      () => {
        grabado = true;
        el.querySelector(".gc-graba")?.remove();
        el.classList.remove("gc-esperando");
        // Saltada mientras se grababa: ya no hace falta esperar la lectura.
        if (saltada) leida = true;
        seguir();
      },
      () => undefined,
    );
  }

  let ido = false;
  function hide(): void {
    if (ido) return;
    ido = true;
    terminar();
    obs.disconnect();
    clearTimeout(tope);
    removeEventListener("keydown", tecla, true);
    // Fuera del árbol de accesibilidad durante el fundido: si no, el diálogo
    // le tapa al lector las primeras frases del juego.
    el.inert = true;
    // Si el estadio ya está arriba, la barra la maneja él.
    if (stadium?.style.display !== "block") document.body.style.overflow = overflowAntes;
    el.classList.add("gc-fuera");
    setTimeout(() => el.remove(), 220);
  }

  // Se va sola cuando aparece el estadio, y como mucho diez segundos después
  // del tiempo de la tarjeta, por si el juego no llegara a mostrarse.
  const stadium = document.getElementById("stadium");
  const obs = new MutationObserver(() => {
    if (listo && stadium?.style.display === "block") hide();
  });
  if (stadium) obs.observe(stadium, { attributes: true, attributeFilter: ["style"] });
  void ready.then(() => {
    if (stadium?.style.display === "block") hide();
  });
  // Con espera, el tope corre recién con la cuenta (`seguir`); mientras tanto,
  // uno largo, más que lo que se insiste en grabar, por si nadie la cerrara.
  tope = window.setTimeout(hide, (espera ? total + 120 : total + 10) * 1000);

  // Saltarla: el botón, un toque en la tarjeta o Enter, espacio o Escape. La
  // tecla no sigue de largo: ni hace scroll ni aprieta otra cosa, ni cierra la
  // espera en grande que queda debajo mientras se graba.
  const tecla = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    saltar();
  };
  addEventListener("keydown", tecla, true);
  el.addEventListener("click", saltar);

  const update = (g: Game): void => {
    const c = el.querySelector(".gc-caja");
    if (c) c.innerHTML = caja(g, people, prizes, premio);
    fondo(g);
  };
  return { ready, hide, update };
}
