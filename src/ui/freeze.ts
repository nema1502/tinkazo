import { $ } from "../dom";
import { getLang, t } from "../i18n";
import { WHEEL_MAX, app, type Game } from "../state";
import { sha256Hex } from "../protocol/legacy-v1";
import { parseNames } from "./participants";

export function setGame(g: Game): void {
  if (app.drawn) return;
  app.game = g;
  $("g-race").classList.toggle("on", g === "race");
  $("g-wheel").classList.toggle("on", g === "wheel");
}

/** Sella la lista en el navegador (modo libre). */
export async function freeze(): Promise<void> {
  const names = parseNames();
  if (names.length < 2) return;
  const digest = await sha256Hex(names.join("\n"));
  const ts = Math.floor(Date.now() / 1000);
  app.frozen = {
    names,
    digest,
    ts,
    at: new Date().toLocaleString(getLang() === "es" ? "es-BO" : "en-US"),
    prize: $<HTMLInputElement>("prize").value.trim(),
  };
  $<HTMLTextAreaElement>("ta").disabled = true;
  $<HTMLInputElement>("prize").disabled = true;
  $<HTMLButtonElement>("btn-freeze").disabled = true;
  $("sec-frozen").style.display = "block";
  $("k-n").textContent = String(names.length);
  $("k-digest").textContent = digest.slice(0, 16) + "…";
  $("frozen-ts").textContent = t("frozenAt") + " " + app.frozen.at;
  $("entities").textContent =
    `Raffle · status="frozen" · freeze_ts=${ts}  —  Entry ×${names.length} · entered_ts ≤ ${ts}  —  digest ${digest}`;
  if (names.length > WHEEL_MAX) {
    $<HTMLButtonElement>("g-wheel").disabled = true;
    $("wheel-cap").style.display = "block";
    setGame("race");
  }
  $("sec-frozen").scrollIntoView({ behavior: "smooth", block: "start" });
}
