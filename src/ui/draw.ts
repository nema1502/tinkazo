import { $, esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { LCOLORS, WHEEL_MAX, app, avatar, type Beacon } from "../state";
import { bytesToHex, decompressG1, fetchRound, hexToBytes, randomnessOf, roundUrl, verifyRound } from "../protocol/drand";
import { select } from "../protocol/select";
import { network, txUrl } from "../stellar/config";
import { PROOF_VERSION, type Proof, proofUrl } from "../protocol/proof";
import { anchorErrorText, drawOnChain, readDraw, showTxStatus, stepLabel } from "./anchor";
import { primeNarrator } from "../narrator";
import { stadiumRace } from "../games/race";
import { stellarConstellation } from "../games/constellation";
import { ledgerClose } from "../games/ledger";
import { pasanaku } from "../games/pasanaku";
import { loreFor } from "../games/lore";
import { qrDataUrl } from "./qr";
import { wheelSpin } from "../games/wheel";
import { secondsToRound } from "./freeze";

/** Obtiene la ronda objetivo, verifica su firma y selecciona (protocolo §2, §5). */
async function resolveBeacon(
  round: number,
  onAttempt: (attempt: number, total: number) => void,
): Promise<Beacon> {
  const { signature } = await fetchRound(round, { onAttempt });
  if (!verifyRound(round, signature)) throw new Error("bad-signature");
  return { round, randomness: bytesToHex(randomnessOf(signature)), signature };
}

export async function draw(): Promise<void> {
  if (!app.frozen || app.drawn || secondsToRound() > 0) return;
  // Tiene que correr dentro del clic: los navegadores no dejan hablar a una
  // página que nunca recibió uno, y esa habilitación después queda pegada.
  primeNarrator();
  const btn = $<HTMLButtonElement>("btn-draw");
  btn.disabled = true;
  btn.textContent = t("fetching");

  // Esto pasa con la sala mirando la pantalla grande. Si un relay no responde
  // hay hasta doce intentos en veintitres segundos, y quedarse mudo todo ese
  // rato es peor que el fallo. Un `alert()` del sistema, peor todavia: rompe el
  // modo estadio y no hay forma de estilarlo.
  const status = $("draw-status");
  status.style.display = "block";
  status.className = "txstatus";
  status.textContent = t("fetching");

  let beacon: Beacon;
  try {
    beacon = await resolveBeacon(app.frozen.round, (attempt, total) => {
      if (attempt > 1) status.textContent = T[getLang()].drandTry(attempt, total);
    });
    status.style.display = "none";
  } catch (e) {
    btn.disabled = false;
    btn.textContent = t("drawRetry");
    status.className = "txstatus bad";
    status.textContent = t(e instanceof Error && e.message === "bad-signature" ? "badSig" : "drandDown");
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
  playGame(names, first, beacon, finish);
}

/**
 * Le pasa el resultado al juego elegido.
 *
 * Ninguno de estos decide nada: reciben el ganador ya calculado y solo lo
 * cuentan. Si un juego no puede con la cantidad de participantes, se cambia
 * por uno que sí, y eso no altera quién ganó.
 */
function playGame(names: string[], first: number, beacon: Beacon, finish: () => void): void {
  if (app.game === "wheel" && names.length <= WHEEL_MAX) {
    wheelSpin(names, first, beacon, finish);
    return;
  }
  if (app.game === "stellar") {
    stellarConstellation(names, first, beacon, finish);
    return;
  }
  if (app.game === "ledger") {
    ledgerClose(names, first, beacon, finish);
    return;
  }
  if (app.game === "pasanaku") {
    pasanaku(names, first, beacon, finish);
    return;
  }
  stadiumRace(names, first, beacon, finish, app.game === "rockets" ? "stellar" : "andes");
}

/**
 * La tarjeta de "¿por qué se llama así?".
 *
 * Va después del ganador y nunca antes: durante el sorteo nadie lee nada, y
 * cuando ya salió el nombre sí. Es voluntaria, tiene dos frases y siempre
 * lleva el enlace a la fuente, porque esto lo va a leer gente que sabe del
 * tema y un dato inventado nos deja sin credibilidad justo donde importa.
 */
function renderLore(beacon: Beacon): void {
  const box = $("lore-box");
  const lo = loreFor(app.game, beacon);
  if (!lo) {
    box.style.display = "none";
    return;
  }
  box.innerHTML =
    `<span class="lore-tab" style="background:var(--${lo.hue})"></span>` +
    `<p class="kicker">${esc(t("loreTitle"))}</p>` +
    `<h3 class="lore-q">${esc(t(lo.q))}</h3>` +
    `<p class="lore-a">${esc(t(lo.a))}</p>` +
    `<a class="mono lore-src" href="${esc(lo.href)}" target="_blank" rel="noopener">${esc(lo.src)} ↗</a>`;
  box.style.display = "block";
}

export function reveal(names: string[], winners: number[], beacon: Beacon, listHash: string): void {
  $("winner-box").style.display = "block";
  renderLore(beacon);
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
  confetti();
  // El comprobante se arma aparte: comprimir la lista es asíncrono y no vale
  // la pena hacer esperar al confeti por eso.
  void buildProof(names, winners, url);
}

let proofLink = "";

/**
 * Dibuja el QR del comprobante en el navegador.
 *
 * Nunca sale a internet a buscarlo: el enlace lleva los nombres en el
 * fragmento, y mandárselo a otro servidor para que dibuje un cuadradito
 * anulaba toda la disciplina de privacidad del producto. Además, así funciona
 * con el wifi del evento caído.
 */
async function paintQr(link: string): Promise<void> {
  const box = $("qr-box");
  const img = $<HTMLImageElement>("qr-img");
  try {
    const url = await qrDataUrl(link);
    if (!url) {
      // Una lista enorme no entra en un QR. El enlace se sigue pudiendo
      // copiar y compartir, así que se esconde el recuadro y ya.
      box.style.display = "none";
      return;
    }
    img.src = url;
    box.style.display = "block";
  } catch {
    box.style.display = "none";
  }
}

/**
 * Arma el comprobante y apunta el QR y los avisos a la página de verificación,
 * que es donde el participante puede rehacer el sorteo por su cuenta.
 */
async function buildProof(names: string[], winners: number[], roundLink: string): Promise<void> {
  const f = app.frozen;
  const d = app.drawn;
  if (!f || !d) return;
  const proof: Proof = {
    v: PROOF_VERSION,
    names,
    round: d.beacon.round,
    sealedAt: f.ts,
    ...(f.prize ? { prize: f.prize } : {}),
    ...(f.raffleId !== undefined
      ? { net: network.name, contract: network.contractId ?? "", id: String(f.raffleId) }
      : { signature: d.beacon.signature }),
  };
  let link: string;
  try {
    link = await proofUrl(proof);
  } catch {
    // Sin comprobante, el QR al menos lleva a la ronda del faro.
    link = roundLink;
  }
  proofLink = link;
  await paintQr(link);
  setNotifyLinks(names, winners, link);
}

/** Copia el enlace del comprobante: es lo que se pega en el grupo del evento. */
export async function shareProof(btn: HTMLButtonElement): Promise<void> {
  if (!proofLink) return;
  try {
    await navigator.clipboard.writeText(proofLink);
    const orig = btn.textContent;
    btn.textContent = t("proofCopied");
    setTimeout(() => (btn.textContent = orig), 1800);
  } catch {
    window.open(proofLink, "_blank", "noopener");
  }
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
