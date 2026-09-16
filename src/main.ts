import "./styles.css";
import { $ } from "./dom";
import { onLangChange, setLang, t } from "./i18n";
import { SAMPLE, app, params } from "./state";
import { soundLabel, toggleSound } from "./sound";
import { bindParticipants, loadSample, renderNames } from "./ui/participants";
import { freeze, setGame } from "./ui/freeze";
import { copySummary, draw, reverify } from "./ui/draw";
import { skipRace, stadiumRace } from "./games/race";

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
$("g-wheel").addEventListener("click", () => setGame("wheel"));
$("btn-draw").addEventListener("click", () => void draw());
$("btn-reverify").addEventListener("click", () => void reverify());
$<HTMLButtonElement>("btn-copy").addEventListener("click", (e) => void copySummary(e.currentTarget as HTMLButtonElement));
$("st-sound").addEventListener("click", toggleSound);
$("st-skip").addEventListener("click", skipRace);
bindParticipants();

/* Modo demo y pose para capturas: `?demo=race|wheel`, `?pose=1`, `?instant=1`. */
async function autoDemo(mode: string): Promise<void> {
  loadSample();
  await freeze();
  setGame(mode === "wheel" ? "wheel" : "race");
  await draw();
}

function poseScene(): void {
  // Escena estática del estadio para capturas: sin red, sin animación.
  const fakeBeacon = { round: 999999, randomness: "deadbeefcafe0123456789abcdef" };
  app.frozen = { names: SAMPLE, digest: "posemode", ts: 0, at: "-", prize: "" };
  app.drawn = { beacon: fakeBeacon, winners: [3] };
  stadiumRace(SAMPLE, 3, fakeBeacon, () => {});
}

renderNames();
if (params.get("lang") === "en") setLang("en");
const demoMode = params.get("demo");
if (demoMode) setTimeout(() => void autoDemo(demoMode), 300);
if (params.get("pose") === "1") setTimeout(poseScene, 300);
