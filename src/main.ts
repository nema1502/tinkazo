import "./styles.css";
import { $ } from "./dom";
import { chooseLang, initialLang, onLangChange, setLang, t } from "./i18n";
import { SAMPLE, app, currentPace, paceSeconds, params, setPace, type Game, type Pace } from "./state";
import { soundLabel, toggleSound, unlockAudioOnGesture } from "./sound";
import { bindParticipants, loadSample, renderNames } from "./ui/participants";
import { GAME_BUTTONS, copyRules, freeze, refreshFreezeLabel, secondsToRound, setGame } from "./ui/freeze";
import { copySummary, draw, replayAnimation, reverify, shareProof } from "./ui/draw";
import { skipGame } from "./games/overlay";
import { usePixi } from "./games/engine";
import { initWalletUI } from "./ui/wallet-ui";
import { musicOn, toggleMusic } from "./music";

// `?theme=light|dark` fuerza el tema (capturas).
const themeParam = params.get("theme");
if (themeParam === "light" || themeParam === "dark") document.documentElement.dataset.theme = themeParam;

// Textos que no viven en atributos data-i.
onLangChange(() => {
  $<HTMLTextAreaElement>("ta").placeholder = t("placeholder");
  $("src-label").textContent = t("src");
  const dl = $<HTMLAnchorElement>("drand-link");
  if (dl.href) dl.textContent = t("drandLink");
  if (app.frozen) $("frozen-ts").textContent = t("frozenAt") + " " + app.frozen.at;
  soundLabel();
});

// Controles
$("l-es").addEventListener("click", () => chooseLang("es"));
$("l-en").addEventListener("click", () => chooseLang("en"));
$("btn-sample").addEventListener("click", loadSample);
$("btn-freeze").addEventListener("click", () => void freeze());
// El ritmo del show. Se guarda, porque quien organiza suele querer siempre el
// mismo, y no cambia el resultado: el ganador ya estaba decidido.
const paceSel = $<HTMLSelectElement>("pace");
paceSel.value = currentPace();
/**
 * Las etiquetas llevan la duración: "Normal · 30 s".
 *
 * El selector dejó de ser un multiplicador y pasó a ser un objetivo de
 * segundos, y eso sólo sirve si se ve. El número sale de `PACES`, así que no
 * puede quedar desactualizado.
 */
function paceLabels(): void {
  for (const o of paceSel.options) {
    const p = o.value as Pace;
    const base = t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
    o.textContent = `${base} · ${paceSeconds(p)} s`;
  }
}
onLangChange(paceLabels);
paceSel.addEventListener("change", () => setPace(paceSel.value as Pace));

$("btn-hist-csv").addEventListener("click", () => {
  void import("./ui/history").then(async (h) => {
    const { currentSession } = await import("./ui/wallet-ui");
    const a = currentSession()?.address;
    if (a) h.downloadCsv(a);
  });
});
$("btn-hist-clear").addEventListener("click", () => {
  if (!confirm(t("histConfirm"))) return;
  void import("./ui/history").then(async (h) => {
    const { currentSession } = await import("./ui/wallet-ui");
    const a = currentSession()?.address;
    if (!a) return;
    h.forget(a);
    h.renderHistory(a);
  });
});

for (const [id, game] of GAME_BUTTONS) $(id).addEventListener("click", () => setGame(game));
$("btn-draw").addEventListener("click", () => void draw());
// La lista a la vista de la sala, antes de sellar: el blindaje contra inflarla.
$("btn-sala").addEventListener("click", () => void import("./ui/sala").then((m) => m.mostrarLista()));
$("btn-reverify").addEventListener("click", reverify);
$("btn-replay").addEventListener("click", replayAnimation);
$<HTMLButtonElement>("btn-copy").addEventListener("click", (e) => void copySummary(e.currentTarget as HTMLButtonElement));
$<HTMLButtonElement>("btn-rules").addEventListener("click", (e) => void copyRules(e.currentTarget as HTMLButtonElement));
$<HTMLButtonElement>("btn-proof").addEventListener("click", (e) => void shareProof(e.currentTarget as HTMLButtonElement));
$("st-sound").addEventListener("click", toggleSound);
$("btn-sound").addEventListener("click", toggleSound);
/** El modo con música: andina con beat, que sigue la tensión del relator. */
const musicLabel = (): void => {
  $("btn-music").textContent = t(musicOn() ? "musicYes" : "musicNo");
};
$("btn-music").addEventListener("click", () => {
  toggleMusic();
  musicLabel();
});
musicLabel();
onLangChange(musicLabel);
$("st-skip").addEventListener("click", skipGame);
bindParticipants();
initVistas();
initWalletUI();
refreshFreezeLabel();

/**
 * Las dos vistas de "/": la portada para quien llega, y la herramienta para
 * quien entra a sortear.
 *
 * Viven en la misma dirección a propósito: Google vuelve a "/" después del
 * login. "/" es siempre la portada, también con la cuenta abierta; la
 * herramienta se abre cuando se pide: "Sortear", "Mis sorteos", el botón
 * grande, o volver de elegir una cuenta (que deja una marca en la sesión del
 * navegador y sobrevive al redirect de Google). Tiene dos pestañas: el sorteo
 * nuevo y los sorteos de esa cuenta, que se traen de la cadena en cualquier
 * equipo. `#sortear`, `#mis-sorteos` y `#portada` eligen a mano.
 */
function initVistas(): void {
  type Tab = "nuevo" | "historial";
  const body = document.body;
  const deApp = ["demo", "pose", "instant"].some((k) => params.has(k));
  const marcar = (): void => {
    const hist = body.dataset.tab === "historial";
    $("tab-nuevo").setAttribute("aria-selected", String(!hist));
    $("tab-hist").setAttribute("aria-selected", String(hist));
    // En el menú, la página actual: Sortear o Mis sorteos, según la pestaña.
    const app = body.dataset.vista === "app";
    for (const [href, on] of [["/#sortear", app && !hist], ["/#mis-sorteos", app && hist]] as const) {
      const a = document.querySelector(`.topnav a[href="${href}"]`);
      if (on) a?.setAttribute("aria-current", "page");
      else a?.removeAttribute("aria-current");
    }
  };
  const setVista = (v: "portada" | "app", tab?: Tab): void => {
    const antes = body.dataset.vista;
    body.dataset.vista = v;
    if (tab) body.dataset.tab = tab;
    marcar();
    if (antes && antes !== v) scrollTo(0, 0);
  };
  const porHash = (): boolean => {
    const h = location.hash;
    if (h === "#sortear" || h === "#ta") setVista("app", "nuevo");
    else if (h === "#mis-sorteos") setVista("app", "historial");
    else if (h === "#portada") setVista("portada");
    else return false;
    return true;
  };
  body.dataset.tab = "nuevo";
  body.dataset.sesion = "no";
  if (params.has("demo")) body.dataset.demo = "1";
  setVista(deApp ? "app" : "portada");
  porHash();
  addEventListener("hashchange", () => void porHash());
  $("tab-nuevo").addEventListener("click", () => {
    history.replaceState(null, "", "#sortear");
    setVista("app", "nuevo");
  });
  $("tab-hist").addEventListener("click", () => {
    history.replaceState(null, "", "#mis-sorteos");
    setVista("app", "historial");
  });
  $("hist-entrar").addEventListener("click", () => {
    void import("./ui/wallet-ui").then((w) => void w.openPicker());
  });
  // El botón grande: a la herramienta y, si no hay cuenta, directo a elegir una.
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a.cta[href="#sortear"]')) {
    a.addEventListener("click", () => {
      void import("./ui/wallet-ui").then((w) => {
        if (!w.currentSession()) void w.openPicker();
      });
    });
  }
  document.addEventListener("tinkazo:sesion", (e) => {
    const a = (e as CustomEvent<string | null>).detail;
    body.dataset.sesion = a ? "si" : "no";
    // Con la cuenta abierta, el botón grande de la portada lleva directo a sortear.
    for (const el of document.querySelectorAll<HTMLElement>('a.cta[href="#sortear"]')) {
      el.dataset.i = a ? "ctaGo" : "ctaHero";
      el.textContent = t(a ? "ctaGo" : "ctaHero");
    }
    if (location.hash === "#portada") return;
    let pidio = false;
    try {
      pidio = sessionStorage.getItem("tinkazo.abrir") === "app";
      if (a && pidio) sessionStorage.removeItem("tinkazo.abrir");
    } catch {
      /* sin almacenamiento, la portada */
    }
    if (a && pidio) setVista("app");
    else if (!a && !deApp && !/^#(sortear|mis-sorteos|ta)$/.test(location.hash)) setVista("portada");
  });
}

/* Modo demo y pose para capturas: `?demo=<juego>`, `?pose=1`, `?instant=1`. */
// Los del selector, y los tres que salieron el 30 de septiembre de 2026 (el
// Cierre de Libro, la carrera de cohetes y las balsas de totora), que siguen
// abriendo con `?demo=` y `?pose=` mientras se decide si se borran.
const GAMES: readonly Game[] = ["race", "chovena", "trompo", "pinata", "oruro", "tombola", "wheel", "teleferico", "pasanaku", "stellar", "sapo", "quien", "luz", "ledger", "rockets", "totora"];

async function autoDemo(mode: string): Promise<void> {
  loadSample();
  // `?nw=N` elige cuántos premios, para poder auditar el caso de varios
  // ganadores: hubo un sorteo de dos en el que el juego anunciaba uno solo.
  const nw = Number(params.get("nw"));
  const sel = document.getElementById("nw");
  if (nw >= 1 && nw <= 32 && sel instanceof HTMLSelectElement) sel.value = String(nw);
  await freeze();
  setGame((GAMES.find((g) => g === mode) ?? "race") as Game);
  // La ronda objetivo todavía no existe: esperar la cuenta regresiva.
  while (secondsToRound() > 0) await new Promise((r) => setTimeout(r, 250));
  await draw();
}

/**
 * Escena del estadio para capturas, sin red.
 *
 * `?pose=<juego>` levanta **ese** juego. Antes cualquier valor que no fuera
 * "stellar" caía en la carrera andina, así que las comprobaciones de tema claro,
 * tema oscuro y celular del auditor estaban mirando la carrera para los seis
 * juegos: nadie había visto nunca la ruleta ni el pasanaku en tema claro.
 */
async function poseScene(): Promise<void> {
  const fakeBeacon = { round: 32254977, randomness: "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829", signature: "a77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac" };
  // `?semilla=<64 hex>` cambia la semilla de la escena fija: con una sola, el
  // director de emoción escribía siempre la misma historia y no había forma de
  // mirar los otros arcos. Sigue sin tocar la red ni sortear nada.
  const semilla = params.get("semilla") ?? "";
  if (/^[0-9a-f]{64}$/.test(semilla)) fakeBeacon.randomness = semilla;
  // `?n=<cantidad>` arma una lista de ese largo con los nombres de ejemplo
  // numerados, para medir cada juego con dos personas y con doscientas sin
  // tocar la red. Es solo para la escena fija: no sella ni sortea nada.
  const cantidad = Math.max(0, Math.min(2000, Math.floor(Number(params.get("n")) || 0)));
  const L = cantidad
    ? Array.from({ length: cantidad }, (_, i) => {
      const vuelta = Math.floor(i / SAMPLE.length);
      return `${SAMPLE[i % SAMPLE.length]}${vuelta ? ` ${vuelta + 1}` : ""}`;
    })
    : SAMPLE;
  // `?nw=N` también acá: la escena fija con varios premios, sin red, para
  // auditar cómo anuncia cada juego a cada ganador. Los ganadores son siempre
  // los mismos y quedan repartidos por la lista.
  const premios = Math.max(1, Math.min(L.length, Math.floor(Number(params.get("nw")) || 1)));
  // El primero, el de siempre: con un premio la escena no cambia.
  const W3: number[] = [Math.min(3, L.length - 1)];
  for (let i = 1; W3.length < premios && i < L.length * 7; i++) {
    const w = (3 + i * 7) % L.length;
    if (!W3.includes(w)) W3.push(w);
  }
  for (let w = 0; W3.length < premios; w++) if (!W3.includes(w)) W3.push(w);
  app.frozen = { names: L, listHash: "32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef", ts: 0, at: "-", prize: "", round: 32254977 };
  app.drawn = { beacon: fakeBeacon, winners: W3 };
  const cual = params.get("pose") ?? "1";
  const nada = (): void => {};
  // La escena fija en el motor nuevo, salvo con `?motor=clasico` o sin WebGL.
  if (usePixi()) {
    const juego = (cual === "1" ? "race" : cual) as Game;
    const px = await import("./games/pixi");
    if (await px.playPixi(juego, L, W3, fakeBeacon, nada)) return;
  }
  if (cual === "wheel") {
    (await import("./games/wheel")).wheelSpin(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "ledger") {
    (await import("./games/ledger")).ledgerClose(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "pasanaku") {
    (await import("./games/pasanaku")).pasanaku(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "teleferico") {
    (await import("./games/cablecar")).cableCar(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "tombola") {
    (await import("./games/tombola")).tombola(L, W3, fakeBeacon, nada);
    return;
  }
  if (cual === "stellar") {
    (await import("./games/constellation")).stellarConstellation(L, W3, fakeBeacon, nada);
    return;
  }
  // "rockets" es la carrera con la piel espacial; cualquier otro valor, la andina.
  (await import("./games/race")).stadiumRace(L, W3, fakeBeacon, nada, cual === "rockets" ? "stellar" : "andes");
}

renderNames();
unlockAudioOnGesture();
// Cada juego muestra en su botón lo que hace. Los nombres solos no le dicen
// nada a quien llega por primera vez.
void import("./ui/thumbs").then((m) => m.initThumbs(GAMES));
// Siempre se aplica el diccionario al cargar, también en español: si no, el
// texto que se ve sale del markup y los dos archivos se separan sin que se note.
setLang(initialLang());
const demoMode = params.get("demo");
if (demoMode) setTimeout(() => void autoDemo(demoMode), 300);
if (params.get("pose")) setTimeout(() => void poseScene(), 300);
