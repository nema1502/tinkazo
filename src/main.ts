import "./styles.css";
import { $ } from "./dom";
import { onLangChange, setLang, t } from "./i18n";
import { SAMPLE, app, params } from "./state";
import { soundLabel, toggleSound } from "./sound";
import { bindParticipants, loadSample, renderNames } from "./ui/participants";
import { freeze, refreshFreezeLabel, secondsToRound, setGame } from "./ui/freeze";
import { copySummary, draw, reverify } from "./ui/draw";
import { skipRace, stadiumRace } from "./games/race";
import { initWalletUI } from "./ui/wallet-ui";

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
$("g-race").addEventListener("click", () => setGame("race"));
$("g-stellar").addEventListener("click", () => setGame("stellar"));
$("g-wheel").addEventListener("click", () => setGame("wheel"));
$("btn-draw").addEventListener("click", () => void draw());
$("btn-reverify").addEventListener("click", reverify);
$<HTMLButtonElement>("btn-copy").addEventListener("click", (e) => void copySummary(e.currentTarget as HTMLButtonElement));
$("st-sound").addEventListener("click", toggleSound);
$("st-skip").addEventListener("click", skipRace);
bindParticipants();
initWalletUI();
refreshFreezeLabel();

/* Modo demo y pose para capturas: `?demo=race|wheel`, `?pose=1`, `?instant=1`. */
async function autoDemo(mode: string): Promise<void> {
  loadSample();
  await freeze();
  setGame(mode === "wheel" ? "wheel" : mode === "stellar" ? "stellar" : "race");
  // La ronda objetivo todavía no existe: esperar la cuenta regresiva.
  while (secondsToRound() > 0) await new Promise((r) => setTimeout(r, 250));
  await draw();
}

function poseScene(): void {
  // Escena estática del estadio para capturas: sin red, sin animación.
  const fakeBeacon = { round: 32254977, randomness: "6e049991d7e23bdc566d3adfff08cd81798c644bc54dd5daa18eb0a8938b2829", signature: "a77a689daae687c7b16e6f9388d4ebbb7b368d09d7a6c33ad1dfd75d32e4114cfbdcf3e2cc54f4fee659abf2ac7ef9ac" };
  app.frozen = { names: SAMPLE, listHash: "32e2099c7a8dde7b6892523dc7d3e34ac06a972fd67f142186c58dced51a21ef", ts: 0, at: "-", prize: "", round: 32254977 };
  app.drawn = { beacon: fakeBeacon, winners: [3] };
  // `?pose=stellar` congela la escena espacial; cualquier otro valor, la andina.
  stadiumRace(SAMPLE, 3, fakeBeacon, () => {}, params.get("pose") === "stellar" ? "stellar" : "andes");
}

renderNames();
// Siempre se aplica el diccionario al cargar, también en español: si no, el
// texto que se ve sale del markup y los dos archivos se separan sin que se note.
setLang(params.get("lang") === "en" ? "en" : "es");
const demoMode = params.get("demo");
if (demoMode) setTimeout(() => void autoDemo(demoMode), 300);
if (params.get("pose")) setTimeout(poseScene, 300);
