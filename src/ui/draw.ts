import { $, esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { LCOLORS, WHEEL_MAX, app, avatar } from "../state";
import { type Beacon, getLatestBeacon, roundUrl, selectV1 } from "../protocol/legacy-v1";
import { stadiumRace } from "../games/race";
import { wheelSpin } from "../games/wheel";

export async function draw(): Promise<void> {
  if (!app.frozen || app.drawn) return;
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  let beacon: Beacon;
  try {
    beacon = await getLatestBeacon();
  } catch {
    btn.disabled = false;
    alert(t("drandDown"));
    return;
  }
  const { names, digest } = app.frozen;
  const nWinners = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10), names.length);
  const winners = await selectV1(beacon.randomness, digest, names.length, nWinners);
  app.drawn = { beacon, winners };
  $("sec-draw").style.display = "block";
  $("seed-label").textContent = `${t("seed")} ${beacon.round}`;
  const first = winners[0] ?? 0;
  const finish = () => reveal(names, winners, beacon, digest);
  if (app.game === "wheel" && names.length <= WHEEL_MAX) {
    $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
    wheelSpin(names, first, finish);
  } else {
    stadiumRace(names, first, beacon, finish);
  }
}

export function reveal(names: string[], winners: number[], beacon: Beacon, digest: string): void {
  $("winner-box").style.display = "block";
  const prize = app.frozen?.prize ?? "";
  $("winner-cards").innerHTML = winners
    .map((i, k) => {
      const name = names[i] ?? "";
      const tag = prize
        ? `<p class="winner-prize">${esc(t("winsPrize"))} ${esc(prize)}${winners.length > 1 ? ` · #${k + 1}` : ""}</p>`
        : winners.length > 1
          ? `<p class="winner-prize">#${k + 1}</p>`
          : "";
      return `<div class="winner-card" style="transform: rotate(${k % 2 ? 1.5 : -1.5}deg)">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name">${esc(name)}</p>
          ${tag}
        </div>
      </div>`;
    })
    .join(" ");
  $("proof").textContent =
    `Draw · drand round=${beacon.round} · randomness=${beacon.randomness.slice(0, 24)}… · entry_count=${names.length} · winners=[${winners.join(",")}] · digest=${digest.slice(0, 24)}…`;
  const url = roundUrl(beacon.round);
  const dl = $<HTMLAnchorElement>("drand-link");
  dl.href = url;
  dl.textContent = t("drandLink");
  $<HTMLImageElement>("qr-img").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}`;
  $("qr-box").style.display = "block";
  confetti();
}

export async function reverify(): Promise<void> {
  if (!app.frozen || !app.drawn) return;
  const { names, digest } = app.frozen;
  const { beacon, winners } = app.drawn;
  const again = await selectV1(beacon.randomness, digest, names.length, winners.length);
  const ok = JSON.stringify(again) === JSON.stringify(winners);
  const out = $("reverify-out");
  out.style.display = "block";
  out.textContent = ok ? t("reverifyOk") : "✗";
}

export async function copySummary(btn: HTMLButtonElement): Promise<void> {
  if (!app.frozen || !app.drawn) return;
  const { names, digest } = app.frozen;
  const { beacon, winners } = app.drawn;
  const url = roundUrl(beacon.round);
  const text = T[getLang()].summary(
    winners.map((i) => names[i] ?? "").join(", "),
    names.length,
    digest.slice(0, 24) + "…",
    beacon.round,
    url,
  );
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = t("copied");
    setTimeout(() => (btn.textContent = orig), 1600);
  } catch {
    /* portapapeles bloqueado: nada que hacer */
  }
}

export function confetti(): void {
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = LCOLORS.map((c) => `var(${c})`);
  for (let i = 0; i < 90; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length] ?? "";
    p.style.animationDuration = 1.6 + Math.random() * 1.8 + "s";
    p.style.animationDelay = Math.random() * 0.6 + "s";
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}
