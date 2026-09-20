import { $, esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { LCOLORS, WHEEL_MAX, app, avatar, type Beacon } from "../state";
import { bytesToHex, decompressG1, fetchRound, hexToBytes, randomnessOf, roundUrl, verifyRound } from "../protocol/drand";
import { select } from "../protocol/select";
import { txUrl } from "../stellar/config";
import { anchorErrorText, drawOnChain, readDraw, showTxStatus, stepLabel } from "./anchor";
import { stadiumRace } from "../games/race";
import { wheelSpin } from "../games/wheel";
import { secondsToRound } from "./freeze";

/** Obtiene la ronda objetivo, verifica su firma y selecciona (protocolo §2, §5). */
async function resolveBeacon(round: number): Promise<Beacon> {
  const { signature } = await fetchRound(round);
  if (!verifyRound(round, signature)) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

export async function draw(): Promise<void> {
  if (!app.frozen || app.drawn || secondsToRound() > 0) return;
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.textContent = t("fetching");

  let beacon: Beacon;
  try {
    beacon = await resolveBeacon(app.frozen.round);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t("draw");
    alert(t(e instanceof Error && e.message === "bad-signature" ? "badSig" : "drandDown"));
    return;
  }

  const { names, listHash, raffleId } = app.frozen;
  const nWinners = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10), names.length);
  let winners: number[];
  let drawTx: string | undefined;

  if (raffleId !== undefined) {
    // Anclado: el contrato verifica la firma y decide. Lo que muestra la
    // pantalla es lo que quedó registrado, no un cálculo nuestro.
    try {
      const res = await drawOnChain(raffleId, decompressG1(beacon.signature), (step, detail) => {
        btn.textContent = stepLabel(step);
        showTxStatus("draw-status", step, detail);
      });
      winners = res.winners;
      drawTx = res.txHash;
    } catch (e) {
      // Si alguien más ya lo finalizó, el resultado igual es público.
      const already = await readDraw(raffleId);
      if (already) {
        winners = already.winners;
        showTxStatus("draw-status", "confirmed");
      } else {
        btn.disabled = false;
        btn.textContent = t("draw");
        const status = $("draw-status");
        status.style.display = "block";
        status.className = "txstatus";
        status.textContent = await anchorErrorText(e);
        return;
      }
    }
  } else {
    winners = select(hexToBytes(beacon.randomness), hexToBytes(listHash), names.length, nWinners);
  }

  btn.textContent = t("draw");
  app.drawn = { beacon, winners, ...(drawTx ? { drawTx } : {}) };
  $("sec-draw").style.display = "block";
  $("seed-label").textContent = `${t("seed")} ${beacon.round}`;
  const first = winners[0] ?? 0;
  const finish = () => reveal(names, winners, beacon, listHash);
  if (app.game === "wheel" && names.length <= WHEEL_MAX) {
    $("sec-draw").scrollIntoView({ behavior: "smooth", block: "start" });
    wheelSpin(names, first, finish);
  } else {
    stadiumRace(names, first, beacon, finish, app.game === "stellar" ? "stellar" : "andes");
  }
}

export function reveal(names: string[], winners: number[], beacon: Beacon, listHash: string): void {
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
  const proof = $("proof");
  proof.textContent =
    `Draw · quicknet round=${beacon.round} · signature verified ✓ · randomness=${beacon.randomness.slice(0, 24)}… · list_hash=${listHash.slice(0, 24)}… · count=${names.length} · winners=[${winners.join(",")}]`;
  const drawTx = app.drawn?.drawTx;
  if (drawTx) {
    proof.append(" · ");
    const a = document.createElement("a");
    a.href = txUrl(drawTx);
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = t("onChain") + " ↗";
    proof.appendChild(a);
  }
  const url = roundUrl(beacon.round);
  const dl = $<HTMLAnchorElement>("drand-link");
  dl.href = url;
  dl.textContent = t("drandLink");
  $<HTMLImageElement>("qr-img").src =
    `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(url)}`;
  $("qr-box").style.display = "block";
  setNotifyLinks(names, winners, url);
  confetti();
}

/**
 * Avisar al ganador sin servidor ni base de datos: los botones abren WhatsApp
 * o el cliente de correo del organizador con el mensaje ya escrito, incluido el
 * enlace para que el ganador verifique por su cuenta. Tinkazo no manda nada ni
 * guarda ningún contacto.
 */
function setNotifyLinks(names: string[], winners: number[], url: string): void {
  const prize = app.frozen?.prize ?? "";
  const who = winners.map((i) => names[i] ?? "").join(", ");
  const body = T[getLang()].tellBody(who, prize, names.length, url);
  $<HTMLAnchorElement>("btn-whatsapp").href = `https://wa.me/?text=${encodeURIComponent(body)}`;
  $<HTMLAnchorElement>("btn-email").href =
    `mailto:?subject=${encodeURIComponent(t("tellSubject"))}&body=${encodeURIComponent(body)}`;
}

/** Rehace la verificación de la firma y la selección desde cero (protocolo §7). */
export function reverify(): void {
  if (!app.frozen || !app.drawn) return;
  const { names, listHash } = app.frozen;
  const { beacon, winners } = app.drawn;
  const sigOk = verifyRound(beacon.round, beacon.signature);
  const seedOk = bytesToHex(randomnessOf(beacon.signature)) === beacon.randomness;
  const again = select(hexToBytes(beacon.randomness), hexToBytes(listHash), names.length, winners.length);
  const ok = sigOk && seedOk && JSON.stringify(again) === JSON.stringify(winners);
  const out = $("reverify-out");
  out.style.display = "block";
  out.textContent = ok ? t("reverifyOk") : "✗";
}

export async function copySummary(btn: HTMLButtonElement): Promise<void> {
  if (!app.frozen || !app.drawn) return;
  const { names, listHash } = app.frozen;
  const { beacon, winners } = app.drawn;
  const text = T[getLang()].summary(
    winners.map((i) => names[i] ?? "").join(", "),
    names.length,
    listHash,
    beacon.round,
    roundUrl(beacon.round),
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
