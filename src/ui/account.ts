import { avatar } from "../avatar";
import { esc } from "../dom";
import { type Lang, chooseLang, getLang, onLangChange, t } from "../i18n";
import { accountUrl, network } from "../stellar/config";
import { PACES, currentPace, paceSeconds, setPace, type Pace } from "../state";
import { isMuted, toggleSound } from "../sound";
import { LAST_DRAWS, drawRow, fmtBalance, initialOf, kindText, moneyLine, shortAddr } from "./account-model";
import type { Entry } from "./history";

/**
 * El panel de la cuenta.
 *
 * Antes la cabecera era una dirección cortada, una insignia de red y un botón
 * de salir, y todo lo demás estaba desparramado por la página: la duración del
 * show al lado del botón de sortear, el sonido en otro lado, el historial
 * abajo de todo. Quien entraba con su cuenta no tenía dónde mirar "lo mío".
 *
 * Acá está todo junto: quién sos, en qué red, cuánto tenés, tus sorteos y las
 * preferencias. Se abre tocando tu nombre.
 *
 * Es una ventana de tres partes (19 de octubre de 2026): el encabezado y el pie
 * no se mueven y el cuerpo se recorre. Con diez sorteos en el historial la
 * tarjeta medía 679 px, y en una laptop de 632 la cortaba por arriba y por
 * abajo, con "Salir" y "Cancelar" pegados al borde. Ahora la tarjeta nunca es
 * más alta que la pantalla, y la ✕ y "Cerrar sesión" están siempre a la vista.
 *
 * No guarda nada nuevo. Lee lo que ya existe: la sesión, el saldo que se
 * consulta al conectar y el historial del navegador.
 */

export interface AccountView {
  address: string;
  name?: string;
  avatar?: string;
  label: string;
  /** XLM disponibles. `-1` si no se pudo preguntar. */
  balance: number;
  onDisconnect: () => void;
  onFund: () => void;
}

type HistoryMod = typeof import("./history");

interface Open {
  view: AccountView;
  back: HTMLElement;
  card: HTMLElement;
  /** Quién la abrió: el foco vuelve ahí al cerrar. */
  returnTo: HTMLElement | null;
  onKey: (e: KeyboardEvent) => void;
  /** El historial de esta cuenta, cuando el módulo ya cargó. */
  hist: { mod: HistoryMod; list: Entry[] } | null;
  /** Para devolver "Copiado ✓" a "Copiar" aunque se vuelva a pintar. */
  copiedTimer: number;
}

let current: Open | null = null;

/** Un solo oyente para toda la vida de la página: `onLangChange` no se desuscribe. */
onLangChange(() => {
  if (current) paint(current);
});

const CLOSE =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const SIGN_OUT =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M16 8l4 4-4 4"/><path d="M20 12H9"/></svg>';

const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Cierra el panel si está abierto. `restoreFocus: false` cuando lo que sigue ya se lleva el foco. */
export function closeAccount(restoreFocus = true): void {
  const s = current;
  if (!s) return;
  current = null;
  clearTimeout(s.copiedTimer);
  document.removeEventListener("keydown", s.onKey, true);
  s.back.remove();
  if (!restoreFocus) return;
  // La cabecera se repinta con la sesión y con el idioma: si el botón que abrió
  // el panel ya no está, el foco vuelve al que lo reemplazó. Y en Safari y
  // Firefox de Mac un botón no recibe el foco al tocarlo: el foco estaba en la
  // página, no en el botón, y también vuelve al botón de la cabecera.
  const opener = s.returnTo && s.returnTo !== document.body && s.returnTo.isConnected ? s.returnTo : null;
  (opener ?? document.querySelector<HTMLElement>("#wallet-box .hello"))?.focus({ preventScroll: true });
}

export function openAccount(view: AccountView): void {
  if (current) {
    closeAccount();
    return;
  }

  const back = document.createElement("div");
  back.className = "modal-back acct-back";
  const card = document.createElement("div");
  card.className = "modal-card acct-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "acct-title");
  card.tabIndex = -1;
  back.appendChild(card);

  const s: Open = {
    view,
    back,
    card,
    returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    onKey: (e) => onKey(s, e),
    hist: null,
    copiedTimer: 0,
  };
  current = s;

  // Tocar el fondo cierra; tocar adentro, no.
  back.addEventListener("click", (e) => {
    if (e.target === back) closeAccount();
  });
  card.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    if (el && card.contains(el)) act(s, el);
  });
  card.addEventListener("change", (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && el.dataset.k === "pace") {
      setPace(el.value as Pace);
      // El selector de la página muestra lo mismo: se mantienen sincronizados.
      const other = document.getElementById("pace") as HTMLSelectElement | null;
      if (other) other.value = el.value;
    }
  });
  // Google a veces rechaza la foto: sin ella, la letra o el dibujo de la casa.
  // `error` no sube por el árbol, pero sí se ve en la captura.
  card.addEventListener(
    "error",
    (e) => {
      const face = e.target instanceof HTMLImageElement ? e.target.closest(".acct-face") : null;
      if (face) face.outerHTML = faceHtml({ ...view, avatar: "" });
    },
    true,
  );

  document.addEventListener("keydown", s.onKey, true);
  paint(s);
  document.body.appendChild(back);
  card.focus({ preventScroll: true });

  // El historial se lee con el módulo ya cargado (el de la cabecera lo pidió al
  // conectar): casi siempre llega antes del primer cuadro.
  void import("./history").then((mod) => {
    if (current !== s) return;
    s.hist = { mod, list: mod.historyOf(view.address) };
    paint(s);
  });
}

/* ---------------------------------------------------------------- teclado */

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function onKey(s: Open, e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault();
    closeAccount();
    return;
  }
  if (e.key !== "Tab") return;
  // La trampa de foco: Tab no se escapa a la página de atrás, ni siquiera si el
  // foco se perdió (se repintó el panel, o se cerró un selector).
  const items = [...s.card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    e.preventDefault();
    s.card.focus({ preventScroll: true });
    return;
  }
  const on = document.activeElement;
  if (!(on instanceof Node) || !s.card.contains(on)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && (on === first || on === s.card)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && on === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ---------------------------------------------------------------- acciones */

function act(s: Open, el: HTMLElement): void {
  switch (el.dataset.k) {
    case "x":
      closeAccount();
      break;
    case "copy":
      void copy(s, el);
      break;
    case "sound": {
      toggleSound();
      const on = !isMuted();
      el.classList.toggle("on", on);
      el.setAttribute("aria-checked", String(on));
      el.textContent = t(on ? "acctSoundOn" : "acctSoundOff");
      break;
    }
    case "lang":
      // Con `chooseLang` y no `setLang`: así se recuerda para la próxima visita,
      // igual que con ES y EN de la cabecera.
      if (el.dataset.v === "es" || el.dataset.v === "en") chooseLang(el.dataset.v as Lang);
      break;
    case "fund":
      closeAccount();
      s.view.onFund();
      break;
    case "all":
      closeAccount();
      // La pestaña se abre por la dirección (main.ts): el scroll solo no
      // cambiaba de pestaña y el clic no llevaba a ningún lado.
      if (location.hash !== "#mis-sorteos") location.hash = "#mis-sorteos";
      requestAnimationFrame(() =>
        document.getElementById("sec-history")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }),
      );
      break;
    case "csv":
      s.hist?.mod.downloadCsv(s.view.address);
      break;
    case "out":
      closeAccount(false);
      s.view.onDisconnect();
      break;
  }
}

/** Copia la dirección entera. Sin permiso del navegador, la deja a la vista y elegida. */
async function copy(s: Open, btn: HTMLElement): Promise<void> {
  const text = s.view.address;
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Sin contexto seguro o sin permiso: la vía vieja.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
      s.card.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    } catch {
      ok = false;
    }
  }
  if (current !== s) return;
  if (!ok) {
    // Que se pueda copiar a mano: la dirección entera, elegida.
    const addr = s.card.querySelector<HTMLElement>(".acct-short");
    if (addr) {
      addr.textContent = text;
      addr.classList.add("full");
      const r = document.createRange();
      r.selectNodeContents(addr);
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    }
    return;
  }
  // El panel pudo repintarse mientras el navegador contestaba (llegó el
  // historial, cambió el idioma): se marca el botón que está, no el que se tocó.
  const now = s.card.querySelector<HTMLElement>('[data-k="copy"]') ?? btn;
  now.focus({ preventScroll: true });
  mark(s, now);
  clearTimeout(s.copiedTimer);
  s.copiedTimer = window.setTimeout(() => {
    const b = s.card.querySelector<HTMLElement>('[data-k="copy"]');
    if (b) unmark(b);
  }, 2200);
}

function mark(s: Open, btn: HTMLElement): void {
  (btn.firstElementChild ?? btn).textContent = t("acctCopied");
  btn.classList.add("done");
  const live = s.card.querySelector(".acct-live");
  if (live) live.textContent = t("acctCopied");
}

function unmark(btn: HTMLElement): void {
  (btn.firstElementChild ?? btn).textContent = t("acctCopy");
  btn.classList.remove("done");
}

/* ------------------------------------------------------------------ pintar */

/** La cara: la foto de la cuenta, y sin foto la letra del nombre o el dibujo de la casa. */
function faceHtml(v: AccountView): string {
  const name = v.name?.trim() ?? "";
  if (v.avatar) return `<span class="acct-face"><img src="${esc(v.avatar)}" alt="" referrerpolicy="no-referrer"></span>`;
  if (name) return `<span class="acct-face initial" aria-hidden="true">${esc(initialOf(name))}</span>`;
  return `<span class="acct-face"><img src="${esc(avatar(v.address, 88))}" alt=""></span>`;
}

function paceName(p: Pace): string {
  return t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
}

/**
 * Arma todo el contenido de la tarjeta. Se llama al abrir, cuando llega el
 * historial y cuando cambia el idioma: conserva dónde estaba el scroll y qué
 * botón tenía el foco, así que cambiar de idioma no hace perder el lugar.
 */
function paint(s: Open): void {
  const { view, card } = s;
  const body = card.querySelector<HTMLElement>(".acct-body");
  const scroll = body?.scrollTop ?? 0;
  const active = document.activeElement;
  const focusKey = active instanceof HTMLElement && card.contains(active) ? active.closest<HTMLElement>("[data-k]") : null;
  const keep = focusKey ? `[data-k="${focusKey.dataset.k}"]${focusKey.dataset.v ? `[data-v="${focusKey.dataset.v}"]` : ""}` : "";

  const name = view.name?.trim() ?? "";
  const title = name || kindText(view.label);

  const mainnet = network.name === "mainnet";
  const money = moneyLine(view.label, view.balance, network.name);
  const balance =
    money.balance === null
      ? ""
      : `<span class="acct-badge">${esc(money.balance === "unknown" ? t("acctUnknown") : fmtBalance(money.balance))}</span>`;
  const fund = money.fund ? `<button type="button" class="mini solid" data-k="fund">${esc(t("fundGet"))}</button>` : "";

  const es = getLang() === "es";
  const muted = isMuted();
  const pace = (Object.keys(PACES) as Pace[])
    .map((p) => `<option value="${p}"${p === currentPace() ? " selected" : ""}>${esc(paceName(p))} · ${paceSeconds(p)} s</option>`)
    .join("");

  card.innerHTML =
    `<div class="acct-head">${faceHtml(view)}` +
    `<div class="acct-id"><h2 id="acct-title" class="sr-only">${esc(t("acctTitle"))}</h2>` +
    `<p class="acct-name" title="${esc(title)}">${esc(title)}</p>` +
    `<p class="acct-addr"><span class="acct-short mono" title="${esc(view.address)}">${esc(shortAddr(view.address))}</span>` +
    `<button type="button" class="acct-copy" data-k="copy" aria-label="${esc(t("acctCopyAria"))}"><span>${esc(t("acctCopy"))}</span></button>` +
    `<span class="acct-live sr-only" role="status" aria-live="polite"></span></p></div>` +
    `<button type="button" class="acct-x" data-k="x" aria-label="${esc(t("acctClose"))}">${CLOSE}</button></div>` +
    `<div class="acct-body">` +
    // La red, el saldo y el explorador.
    `<section class="acct-sec"><div class="acct-badges">` +
    `<span class="acct-badge net${mainnet ? " main" : ""}">${esc(t(mainnet ? "acctNetMain" : "acctNetTest"))}</span>${balance}</div>` +
    (fund ? `<div class="acct-badges">${fund}</div>` : "") +
    `<a class="acct-link" data-k="explorer" href="${esc(accountUrl(view.address))}" target="_blank" rel="noopener">${esc(t("fundExplorer"))}</a></section>` +
    // Las preferencias, en una fila con sus etiquetas.
    `<section class="acct-sec" aria-labelledby="acct-prefs-h"><h3 class="kicker" id="acct-prefs-h">${esc(t("acctPrefs"))}</h3>` +
    `<div class="acct-prefs">` +
    `<div class="acct-pref"><span class="kicker" id="acct-snd-l">${esc(t("acctSound"))}</span>` +
    `<button type="button" role="switch" class="mini acct-snd${muted ? "" : " on"}" data-k="sound" aria-checked="${!muted}" aria-labelledby="acct-snd-l">${esc(t(muted ? "acctSoundOff" : "acctSoundOn"))}</button></div>` +
    `<div class="acct-pref pace"><label class="kicker" for="acct-pace">${esc(t("acctPace"))}</label>` +
    `<select id="acct-pace" class="mono" data-k="pace">${pace}</select></div>` +
    `<div class="acct-pref"><span class="kicker" id="acct-lang-l">${esc(t("acctLang"))}</span>` +
    `<div class="langs acct-langs" role="group" aria-labelledby="acct-lang-l">` +
    `<button type="button" data-k="lang" data-v="es" lang="es" aria-pressed="${es}" class="${es ? "on" : ""}">ES</button>` +
    `<button type="button" data-k="lang" data-v="en" lang="en" aria-pressed="${!es}" class="${es ? "" : "on"}">EN</button></div></div>` +
    `</div></section>` +
    // Tus sorteos: los últimos y dos salidas.
    (s.hist ? drawsHtml(s.hist.list) : "") +
    `</div>` +
    `<div class="acct-foot"><button type="button" class="acct-out" data-k="out">${SIGN_OUT}<span>${esc(t("acctSignOut"))}</span></button></div>`;

  const newBody = card.querySelector<HTMLElement>(".acct-body");
  if (newBody) newBody.scrollTop = scroll;
  if (keep) card.querySelector<HTMLElement>(keep)?.focus({ preventScroll: true });
}

function drawsHtml(list: Entry[]): string {
  const head = `<section class="acct-sec" aria-labelledby="acct-draws-h"><h3 class="kicker" id="acct-draws-h">${esc(t("histTitle"))}</h3>`;
  if (list.length === 0) return `${head}<p class="acct-empty">${esc(t("acctEmpty"))}</p></section>`;
  const rows = list
    .slice(0, LAST_DRAWS)
    .map(drawRow)
    .map((r) => {
      const proof = r.proof
        ? `<a class="acct-proof" href="${esc(r.proof)}" target="_blank" rel="noopener" aria-label="${esc(t("acctProofOf").replace("{sorteo}", r.title))}">${esc(t("histProof"))} ↗</a>`
        : "";
      return (
        `<li class="acct-row"><div class="acct-rt"><b class="acct-rtitle" title="${esc(r.title)}">${esc(r.title)}</b>` +
        `<span class="acct-rmeta">${esc(r.meta)}</span></div>${proof}</li>`
      );
    })
    .join("");
  return (
    `${head}<ul class="acct-rows">${rows}</ul>` +
    `<div class="acct-more"><button type="button" class="mini" data-k="all">${esc(t("acctSeeAllN").replace("{n}", String(list.length)))}</button>` +
    `<button type="button" class="mini" data-k="csv">${esc(t("histCsv"))}</button></div></section>`
  );
}
