import "./styles.css";
import { $ } from "./dom";
import { onLangChange, setLang, t } from "./i18n";
import { SAMPLE, app, currentPace, paceSeconds, params, setPace, type Game, type Pace } from "./state";
import { soundLabel, toggleSound } from "./sound";
import { bindParticipants, loadSample, renderNames } from "./ui/participants";
import { freeze, refreshFreezeLabel, secondsToRound, setGame } from "./ui/freeze";
import { copySummary, draw, reverify, shareProof } from "./ui/draw";
import { stadiumRace } from "./games/race";
import { skipGame } from "./games/overlay";
import { initWalletUI } from "./ui/wallet-ui";
import { hasVoice, voiceName } from "./narrator";

/**
 * Avisa si la máquina tiene voz para el narrador, y cuál.
 *
 * El momento de enterarse no es con la sala mirando. Las voces del sistema
 * tardan en aparecer, así que se reintenta una vez.
 */
function showVoiceNote(): void {
  const paint = (): void => {
    const el = document.getElementById("voice-note");
    if (!el) return;
    const on = hasVoice();
    el.textContent = on ? `${t("voiceOn")} ${voiceName() ?? ""}` : t("voiceOff");
    el.style.display = "block";
  };
  paint();
  // `getVoices()` suele venir vacío en la primera llamada.
  setTimeout(paint, 1200);
  onLangChange(paint);
}

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
$("l-es").addEventListener("click", () => setLang("es"));
$("l-en").addEventListener("click", () => setLang("en"));
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

$("g-race").addEventListener("click", () => setGame("race"));
$("g-stellar").addEventListener("click", () => setGame("stellar"));
$("g-ledger").addEventListener("click", () => setGame("ledger"));
$("g-pasanaku").addEventListener("click", () => setGame("pasanaku"));
$("g-teleferico").addEventListener("click", () => setGame("teleferico"));
$("g-tombola").addEventListener("click", () => setGame("tombola"));
$("g-rockets").addEventListener("click", () => setGame("rockets"));
$("g-wheel").addEventListener("click", () => setGame("wheel"));
$("btn-draw").addEventListener("click", () => void draw());
$("btn-reverify").addEventListener("click", reverify);
$<HTMLButtonElement>("btn-copy").addEventListener("click", (e) => void copySummary(e.currentTarget as HTMLButtonElement));
$<HTMLButtonElement>("btn-proof").addEventListener("click", (e) => void shareProof(e.currentTarget as HTMLButtonElement));
$("st-sound").addEventListener("click", toggleSound);
$("btn-sound").addEventListener("click", toggleSound);
$("st-skip").addEventListener("click", skipGame);
bindParticipants();
initWalletUI();
refreshFreezeLabel();

/* Modo demo y pose para capturas: `?demo=<juego>`, `?pose=1`, `?instant=1`. */
const GAMES: readonly Game[] = ["race", "stellar", "ledger", "pasanaku", "teleferico", "tombola", "rockets", "wheel"];

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
  const W3 = [Math.min(3, L.length - 1)];
  app.frozen = { names: L, listHash: "32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef", ts: 0, at: "-", prize: "", round: 32254977 };
  app.drawn = { beacon: fakeBeacon, winners: W3 };
  const cual = params.get("pose") ?? "1";
  const nada = (): void => {};
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
  stadiumRace(L, W3, fakeBeacon, nada, cual === "rockets" ? "stellar" : "andes");
}

renderNames();
showVoiceNote();
// Cada juego muestra en su botón lo que hace. Los nombres solos no le dicen
// nada a quien llega por primera vez.
void import("./ui/thumbs").then((m) => m.initThumbs(GAMES));
// Siempre se aplica el diccionario al cargar, también en español: si no, el
// texto que se ve sale del markup y los dos archivos se separan sin que se note.
setLang(params.get("lang") === "en" ? "en" : "es");
const demoMode = params.get("demo");
if (demoMode) setTimeout(() => void autoDemo(demoMode), 300);
if (params.get("pose")) setTimeout(() => void poseScene(), 300);
