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
export const CARD_SECONDS = 3.5;

/** El nombre de cada juego, el mismo del selector. */
export const NOMBRE: Record<Game, string> = {
  race: "jgRaceN", luz: "jgLuzN", trompo: "jgTroN", pinata: "jgPinN", oruro: "jgOruN",
  tombola: "jgTomN", wheel: "jgWheelN", teleferico: "jgTelN", pasanaku: "jgPasN", stellar: "jgStellarN",
  sapo: "jgSapoN", quien: "jgQuienN", ledger: "jgLedgerN", rockets: "jgRocketsN", totora: "jgTotN",
};

/** La regla de cada uno, en una línea corta: qué mirar y quién gana. */
export const REGLA: Record<Game, string> = {
  race: "gcRace", luz: "gcLuz", trompo: "gcTrompo", pinata: "gcPinata", oruro: "gcOruro",
  tombola: "gcTombola", wheel: "gcWheel", teleferico: "gcTeleferico", pasanaku: "gcPasanaku", stellar: "gcStellar",
  sapo: "gcSapo", quien: "gcQuien", ledger: "gcLedger", rockets: "gcRockets", totora: "gcTotora",
};

/**
 * Los que cuentan cada premio en pantalla, con su regla en plural. Los demás
 * cuentan el primero y muestran a todos en el cartel final, y la tarjeta lo
 * dice: con tres premios, "gana el último que sigue bailando" era mentira para
 * el segundo y el tercero.
 */
export const VARIOS: Partial<Record<Game, string>> = { sapo: "gcSapoMany", quien: "gcQuienMany", teleferico: "gcTelefericoMany" };

/** Los que tienen captura en public/juegos, para el fondo. */
const CAPTURA = new Set<Game>(["race", "luz", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien"]);

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
function caja(game: Game, people: number, prizes: number): string {
  const L = T[getLang()];
  const lanes = (game === "race" || game === "rockets" || game === "totora") && people > 8;
  const varios = prizes > 1 ? VARIOS[game] : undefined;
  const extras = [
    lanes ? L.cLanes(8, people) : game === "sapo" && people > 12 ? t("gcSapoQual") : "",
    prizes > 1 && !varios ? L.gcPrizesNote(prizes) : "",
  ].filter(Boolean);
  return (
    `<p class="gc-kicker">${esc(t("gcKicker"))}</p>` +
    `<h2 class="gc-nombre" id="gc-nombre"><span>${esc(t(NOMBRE[game]))}</span></h2>` +
    `<p class="gc-regla" id="gc-regla">${esc(t(varios ?? REGLA[game]))}</p>` +
    extras.map((x) => `<p class="gc-extra">${esc(x)}</p>`).join("") +
    `<p class="gc-chips"><span>${esc(L.gcPeople(people))}</span><span>${esc(L.gcPrizes(prizes))}</span></p>` +
    `<p class="gc-honesta" id="gc-honesta">${esc(t("gcHonest"))}</p>`
  );
}

/**
 * Muestra la tarjeta. Queda arriba hasta que aparece el estadio, para que entre
 * la tarjeta y el primer cuadro no se vea la página.
 */
export function showGameCard(game: Game, people: number, prizes: number): GameCard {
  const el = document.createElement("div");
  el.className = "game-card";
  // Un diálogo de verdad para el lector de pantalla: se anuncia porque el foco
  // entra, con su título y su regla.
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "gc-nombre");
  el.setAttribute("aria-describedby", "gc-regla gc-honesta");
  el.style.setProperty("--gc-ms", `${CARD_SECONDS * 1000}ms`);
  const fondo = (g: Game): void => {
    if (CAPTURA.has(g)) el.style.setProperty("--gc-img", `url("/juegos/${g}.webp")`);
    else el.style.removeProperty("--gc-img");
  };
  fondo(game);
  el.innerHTML =
    `<div class="gc-fondo" aria-hidden="true"></div>` +
    `<div class="gc-caja">${caja(game, people, prizes)}</div>` +
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
  const terminar = (): void => {
    if (listo) return;
    listo = true;
    clearTimeout(reloj);
    resolver();
  };
  const reloj = setTimeout(terminar, CARD_SECONDS * 1000);

  let ido = false;
  const hide = (): void => {
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
  };

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
  const tope = setTimeout(hide, (CARD_SECONDS + 10) * 1000);

  // Saltarla: el botón, un toque en la tarjeta o Enter, espacio o Escape. La
  // tecla no sigue de largo: ni hace scroll ni aprieta otra cosa.
  const tecla = (e: KeyboardEvent): void => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Escape") return;
    e.preventDefault();
    terminar();
  };
  addEventListener("keydown", tecla, true);
  el.addEventListener("click", terminar);

  const update = (g: Game): void => {
    const c = el.querySelector(".gc-caja");
    if (c) c.innerHTML = caja(g, people, prizes);
    fondo(g);
  };
  return { ready, hide, update };
}
