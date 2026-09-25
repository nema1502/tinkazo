import { $ } from "../dom";
import { T, getLang, t } from "../i18n";
import { ANCHOR_LEAD_SECONDS, LEAD_SECONDS, WHEEL_MAX, app, type Game } from "../state";
import { bytesToHex, roundTime, targetRound } from "../protocol/drand";
import { listHash } from "../protocol/canonical";
import { contractUrl, network } from "../stellar/config";
import { anchorErrorText, hideTxStatus, sealOnChain, showTxStatus, stepLabel } from "./anchor";
import { canAnchor, currentSession } from "./wallet-ui";
import { parseNames } from "./participants";

/** Los botones del selector, en el orden en que se muestran. */
const GAME_BUTTONS: ReadonlyArray<[string, Game]> = [
  ["g-race", "race"],
  ["g-stellar", "stellar"],
  ["g-ledger", "ledger"],
  ["g-pasanaku", "pasanaku"],
  ["g-teleferico", "teleferico"],
  ["g-tombola", "tombola"],
  ["g-rockets", "rockets"],
  ["g-wheel", "wheel"],
];

export function setGame(g: Game): void {
  if (app.drawn) return;
  app.game = g;
  for (const [id, key] of GAME_BUTTONS) $(id).classList.toggle("on", g === key);
}

/**
 * Segundos que faltan para poder sortear.
 *
 * Para un sorteo anclado se esperan unos segundos de más. El contrato compara
 * la hora de la ronda contra la **hora de cierre del ledger**, que va detrás
 * del reloj del navegador porque un ledger cierra cada cinco segundos. Sin ese
 * margen hay una ventana en la que acá ya es hora, para la cadena todavía no,
 * y la transacción se cae delante de toda la sala.
 */
const CHAIN_MARGIN_SECONDS = 8;

export function secondsToRound(): number {
  if (!app.frozen) return 0;
  const margin = app.frozen.raffleId !== undefined ? CHAIN_MARGIN_SECONDS : 0;
  return Math.max(0, roundTime(app.frozen.round) + margin - Math.floor(Date.now() / 1000));
}

let countdownTimer: number | undefined;

/**
 * El botón de sortear muestra la cuenta regresiva y se habilita cuando la
 * ronda existe. Y arriba, el panel que pone la espera en escena.
 *
 * Esos segundos son el corazón del producto: la lista ya está cerrada y el
 * número que la va a decidir **todavía no existe**. Es el único momento en que
 * esto es distinto de cualquier ruleta, y vivía como una etiqueta chica en un
 * botón gris, en silencio. Ahora se ve el número de la ronda que falta nacer y
 * los segundos que le quedan.
 */
function startCountdown(): void {
  const btn = $<HTMLButtonElement>("btn-draw");
  const box = document.getElementById("wait-box");
  const num = document.getElementById("wait-round");
  const left = document.getElementById("wait-left");
  const line = box?.querySelector(".wait-line");
  if (num && app.frozen) num.textContent = `#${app.frozen.round}`;
  const tick = (): void => {
    const s = secondsToRound();
    if (s > 0) {
      btn.disabled = true;
      const reloj = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      btn.textContent = T[getLang()].drawIn(reloj);
      if (box) box.style.display = "block";
      if (left) left.textContent = reloj;
      if (line) line.textContent = t("waitLine");
    } else {
      btn.disabled = !!app.drawn;
      btn.textContent = t("draw");
      // El panel no desaparece de golpe: dice que la ronda ya nació, que es la
      // otra mitad de la idea.
      if (left) left.textContent = t("waitNow");
      if (line) line.textContent = "";
      if (countdownTimer !== undefined) clearInterval(countdownTimer);
      countdownTimer = undefined;
    }
  };
  tick();
  countdownTimer = window.setInterval(tick, 250);
}

/** El botón cambia de nombre según haya wallet conectada o no. */
export function refreshFreezeLabel(): void {
  if (app.frozen) return;
  $("btn-freeze").textContent = canAnchor() ? t("sealOnStellar") : t("freeze");
}

/**
 * Sella la lista.
 *
 * Con wallet conectada el sello va al contrato en Stellar, que deja constancia
 * pública con fecha. Sin wallet, el sello se calcula en el navegador: el
 * sorteo sigue siendo verificable, pero nadie atestigua que la lista se cerró
 * antes de que existiera la semilla.
 */
export async function freeze(): Promise<void> {
  const names = parseNames();
  if (names.length < 2) return;

  const btn = $<HTMLButtonElement>("btn-freeze");
  const anchoring = canAnchor();
  const hash = bytesToHex(listHash(names));
  const ts = Math.floor(Date.now() / 1000);
  // Anclando, el margen no baja de 45 s aunque la URL pida menos: por debajo
  // de 30 el contrato rechaza el sello.
  const lead = anchoring ? Math.max(ANCHOR_LEAD_SECONDS, LEAD_SECONDS) : LEAD_SECONDS;
  const round = targetRound(ts, lead);
  const prize = $<HTMLInputElement>("prize").value.trim();
  const numWinners = Math.min(parseInt($<HTMLSelectElement>("nw").value, 10) || 1, names.length);

  let raffleId: bigint | undefined;
  let sealTx: string | undefined;

  if (anchoring) {
    const session = currentSession();
    if (!session) return;
    btn.disabled = true;
    try {
      const res = await sealOnChain(
        {
          organizer: session.address,
          listHash: listHash(names),
          count: names.length,
          numWinners,
          round,
          meta: prize || t("defaultMeta"),
        },
        (step, detail) => {
          btn.textContent = stepLabel(step);
          showTxStatus("seal-status", step, detail);
        },
      );
      raffleId = res.raffleId;
      sealTx = res.txHash;
    } catch (e) {
      btn.disabled = false;
      btn.textContent = t("sealOnStellar");
      const status = $("seal-status");
      status.style.display = "block";
      status.className = "txstatus";
      status.textContent = await anchorErrorText(e);
      return;
    }
  } else {
    hideTxStatus("seal-status");
  }

  app.frozen = {
    names,
    listHash: hash,
    ts,
    at: new Date().toLocaleString(getLang() === "es" ? "es-BO" : "en-US"),
    prize,
    round,
    ...(raffleId !== undefined ? { raffleId } : {}),
    ...(sealTx ? { sealTx } : {}),
  };

  // Se anota en el historial de este equipo apenas se sella, no al sortear:
  // si el sorteo queda pendiente, igual hay que poder encontrarlo.
  const who = currentSession()?.address;
  if (who) {
    void import("./history").then((h) => {
      h.remember({
        organizer: who,
        listHash: hash,
        count: names.length,
        numWinners,
        round,
        sealedAt: ts,
        prize,
        ...(raffleId !== undefined ? { id: String(raffleId) } : {}),
        ...(sealTx ? { sealTx } : {}),
      });
      h.renderHistory(who);
    });
  }

  $<HTMLTextAreaElement>("ta").disabled = true;
  $<HTMLInputElement>("prize").disabled = true;
  $<HTMLSelectElement>("nw").disabled = true;
  btn.disabled = true;
  btn.textContent = raffleId !== undefined ? t("sealed") : t("frozenOk");
  $("freeze-hint").style.display = "none";
  $("sec-frozen").style.display = "block";
  $("k-n").textContent = String(names.length);
  $("k-digest").textContent = hash.slice(0, 16) + "…";
  $("k-status").textContent = raffleId !== undefined ? `Stellar #${raffleId}` : "local";
  $("frozen-ts").textContent = t("frozenAt") + " " + app.frozen.at;
  renderSealSummary();

  if (names.length > WHEEL_MAX) {
    // La ruleta es el único juego con tope. Los demás aguantan doscientos, y
    // Cierre de Libro justamente se ve mejor cuantos más haya, así que el
    // reemplazo automático va para ahí y no para la carrera.
    $<HTMLButtonElement>("g-wheel").disabled = true;
    $("wheel-cap").style.display = "block";
    if (app.game === "wheel") setGame("ledger");
  }
  startCountdown();
  $("sec-frozen").scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Resumen técnico del sello, con enlace al contrato si quedó anclado. */
function renderSealSummary(): void {
  const f = app.frozen;
  if (!f) return;
  const el = $("entities");
  el.textContent =
    `Seal · list_hash=${f.listHash} · count=${f.names.length} · sealed_at=${f.ts} · target_round=${f.round} · round_time=${roundTime(f.round)}`;
  if (f.raffleId === undefined) {
    const tag = document.createElement("span");
    tag.className = "kicker";
    tag.style.marginLeft = "8px";
    tag.textContent = t("noAnchor");
    el.appendChild(tag);
    return;
  }
  el.append(` · raffle_id=${f.raffleId} · `);
  const a = document.createElement("a");
  a.href = contractUrl();
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = `${network.name} ↗`;
  el.appendChild(a);
}
