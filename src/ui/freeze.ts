import { $ } from "../dom";
import { T, getLang, t } from "../i18n";
import { LEAD_SECONDS, WHEEL_MAX, app, type Game } from "../state";
import { bytesToHex, roundTime, targetRound } from "../protocol/drand";
import { listHash } from "../protocol/canonical";
import { parseNames } from "./participants";

export function setGame(g: Game): void {
  if (app.drawn) return;
  app.game = g;
  $("g-race").classList.toggle("on", g === "race");
  $("g-stellar").classList.toggle("on", g === "stellar");
  $("g-wheel").classList.toggle("on", g === "wheel");
}

/** Segundos que faltan para que nazca la ronda objetivo (0 si ya existe). */
export function secondsToRound(): number {
  if (!app.frozen) return 0;
  return Math.max(0, roundTime(app.frozen.round) - Math.floor(Date.now() / 1000));
}

let countdownTimer: number | undefined;

/** El botón de sortear muestra la cuenta regresiva y se habilita cuando la ronda existe. */
function startCountdown(): void {
  const btn = $<HTMLButtonElement>("btn-draw");
  const tick = (): void => {
    const s = secondsToRound();
    if (s > 0) {
      btn.disabled = true;
      btn.textContent = T[getLang()].drawIn(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
    } else {
      btn.disabled = !!app.drawn;
      btn.textContent = t("draw");
      if (countdownTimer !== undefined) clearInterval(countdownTimer);
      countdownTimer = undefined;
    }
  };
  tick();
  countdownTimer = window.setInterval(tick, 250);
}

/** Sella la lista en el navegador (modo libre) contra una ronda futura de quicknet. */
export async function freeze(): Promise<void> {
  const names = parseNames();
  if (names.length < 2) return;
  const hash = bytesToHex(listHash(names));
  const ts = Math.floor(Date.now() / 1000);
  const round = targetRound(ts, LEAD_SECONDS);
  app.frozen = {
    names,
    listHash: hash,
    ts,
    at: new Date().toLocaleString(getLang() === "es" ? "es-BO" : "en-US"),
    prize: $<HTMLInputElement>("prize").value.trim(),
    round,
  };
  $<HTMLTextAreaElement>("ta").disabled = true;
  $<HTMLInputElement>("prize").disabled = true;
  $<HTMLButtonElement>("btn-freeze").disabled = true;
  $("sec-frozen").style.display = "block";
  $("k-n").textContent = String(names.length);
  $("k-digest").textContent = hash.slice(0, 16) + "…";
  $("k-status").textContent = "sealed";
  $("frozen-ts").textContent = t("frozenAt") + " " + app.frozen.at;
  $("entities").textContent =
    `Seal · list_hash=${hash} · count=${names.length} · sealed_at=${ts} · target_round=${round} · round_time=${roundTime(round)}`;
  if (names.length > WHEEL_MAX) {
    $<HTMLButtonElement>("g-wheel").disabled = true;
    $("wheel-cap").style.display = "block";
    setGame("race");
  }
  startCountdown();
  $("sec-frozen").scrollIntoView({ behavior: "smooth", block: "start" });
}
