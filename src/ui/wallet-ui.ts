import { $, esc } from "../dom";
import { onLangChange, t } from "../i18n";
import { anchoringAvailable, accountUrl, network, shortAddress } from "../stellar/config";
import { refreshFreezeLabel } from "./freeze";

/**
 * Identidad del organizador en la cabecera.
 *
 * Conectar una wallet es el login de Tinkazo: no hay usuario ni contraseña
 * porque lo único que hace falta es poder firmar el sello. Los participantes
 * nunca pasan por acá.
 *
 * Hay dos caminos: Freighter, la wallet del navegador, o una cuenta de prueba
 * que el propio navegador crea y fondea en testnet para quien quiera probar el
 * anclaje sin instalar nada.
 *
 * El SDK de Stellar pesa medio megabyte y solo hace falta si alguien conecta,
 * así que la capa `src/stellar/wallet` se carga con `import()` recién cuando
 * el usuario abre el selector. Quien solo quiere sortear en modo libre no
 * descarga nada de eso.
 */

type WalletModule = typeof import("../stellar/wallet");

/** Resumen de la sesión, para no tener que importar la capa solo para pintar. */
interface Session {
  kind: "external" | "guest";
  label: string;
  address: string;
}

let session: Session | null = null;
/** La wallet está en otra red que la configurada: no se puede sellar. */
let wrongNetwork = false;
let mod: WalletModule | null = null;

const loadWallets = async (): Promise<WalletModule> => (mod ??= await import("../stellar/wallet"));

export const currentSession = (): Session | null => session;

/** Se puede sellar en la cadena: hay contrato, hay sesión y la red coincide. */
export const canAnchor = (): boolean => anchoringAvailable && session !== null && !wrongNetwork;

export function initWalletUI(): void {
  render();
  onLangChange(render);
  void restorePollar();
}

/** Al volver del redirect de Google, la sesión se retoma sola. */
async function restorePollar(): Promise<void> {
  try {
    const { pollarConfigured, pollarWallet } = await import("../stellar/wallet-pollar");
    if (!pollarConfigured()) return;
    const address = await pollarWallet.restore();
    if (!address) return;
    const { setActiveWallet } = await loadWallets();
    setActiveWallet(pollarWallet);
    session = { kind: "external", label: pollarWallet.label, address };
    render();
    refreshFreezeLabel();
  } catch {
    /* sin sesion previa, la cabecera queda como estaba */
  }
}

function render(): void {
  const box = $("wallet-box");
  box.innerHTML = "";
  // Sin contrato en esta red, el anclaje no se ofrece y la cabecera calla.
  if (!anchoringAvailable) return;

  if (!session) {
    box.appendChild(button(t("connectWallet"), "solid", () => void openPicker()));
    return;
  }

  const net = document.createElement("span");
  net.className = wrongNetwork ? "netbadge bad" : "netbadge";
  net.textContent = network.name;
  box.appendChild(net);

  const link = document.createElement("a");
  link.className = "hello mono";
  link.href = accountUrl(session.address);
  link.target = "_blank";
  link.rel = "noopener";
  link.title = `${session.label} · ${session.address}`;
  link.textContent = shortAddress(session.address);
  box.appendChild(link);

  box.appendChild(button(t("disconnect"), "", () => void disconnect()));

  if (wrongNetwork) notice(t("wrongNetwork").replace("{red}", network.name), true);
}

function button(label: string, extra: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `mini ${extra}`.trim();
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

interface Option {
  label: string;
  hint: string;
  pick: "freighter" | "guest" | "google" | null;
  href?: string;
}

/** Ofrece las formas de entrar que tienen sentido en esta red y en este navegador. */
async function openPicker(): Promise<void> {
  const w = await loadWallets();
  const options: Option[] = [];

  if (await w.freighterInstalled()) {
    options.push({ label: "Freighter", hint: t("freighterHint"), pick: "freighter" });
  } else {
    options.push({
      label: "Freighter",
      hint: t("freighterInstall"),
      pick: null,
      href: "https://www.freighter.app/",
    });
  }
  const { pollarConfigured } = await import("../stellar/wallet-pollar");
  if (pollarConfigured()) {
    options.push({ label: t("googleWallet"), hint: t("googleHint"), pick: "google" });
  }
  if (w.guestAvailable()) {
    options.push({ label: t("guestWallet"), hint: t("guestHint"), pick: "guest" });
  }

  showModal(options);
}

function showModal(options: Option[]): void {
  const back = document.createElement("div");
  back.className = "modal-back";
  const card = document.createElement("div");
  card.className = "modal-card";
  card.innerHTML = `<p class="kicker">${esc(t("connectTitle"))}</p><h3>${esc(t("connectLead"))}</h3>`;

  for (const o of options) {
    const row = document.createElement(o.href ? "a" : "button");
    row.className = "wallet-row";
    row.innerHTML = `<b>${esc(o.label)}</b><span>${esc(o.hint)}</span>`;
    if (o.href && row instanceof HTMLAnchorElement) {
      row.href = o.href;
      row.target = "_blank";
      row.rel = "noopener";
    } else if (o.pick) {
      const pick = o.pick;
      row.addEventListener("click", () => void connect(pick, back, row));
    }
    card.appendChild(row);
  }

  const close = document.createElement("button");
  close.className = "mini";
  close.textContent = t("cancel");
  close.addEventListener("click", () => shut());
  card.appendChild(close);

  back.appendChild(card);
  back.addEventListener("click", (e) => {
    if (e.target === back) shut();
  });

  // Un diálogo de verdad: se anuncia como tal, atrapa el foco, cierra con
  // Escape y devuelve el foco a donde estaba. Sin esto, con teclado se puede
  // tabular "por detrás" del modal y con lector de pantalla no existe.
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", t("connectTitle"));
  card.tabIndex = -1;

  const returnTo = document.activeElement;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      shut();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = [...card.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  function shut(): void {
    document.removeEventListener("keydown", onKey, true);
    back.remove();
    if (returnTo instanceof HTMLElement) returnTo.focus();
  }

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  (card.querySelector<HTMLElement>("a[href], button") ?? card).focus();
}

async function connect(
  pick: "freighter" | "guest" | "google",
  back: HTMLElement,
  row: HTMLElement,
): Promise<void> {
  const original = row.innerHTML;
  row.innerHTML = `<b>${esc(t("connecting"))}</b>`;
  try {
    const w = await loadWallets();
    const wallet =
      pick === "guest"
        ? w.guestWallet
        : pick === "google"
          ? (await import("../stellar/wallet-pollar")).pollarWallet
          : w.freighterWallet;
    const address = await wallet.connect();
    w.setActiveWallet(wallet);
    const { resetClient } = await import("../stellar/contract");
    resetClient();
    const passphrase = await wallet.networkPassphrase();
    // Si la wallet no sabe decir su red, no bloqueamos: la transacción fallaría
    // igual, y con un error más claro que una suposición nuestra.
    wrongNetwork = passphrase !== null && passphrase !== network.networkPassphrase;
    session = { kind: wallet.kind, label: wallet.label, address };
    back.remove();
    render();
    refreshFreezeLabel();
    if (wallet.kind === "guest") notice(t("guestReady"), false);
  } catch (e) {
    row.innerHTML = original;
    notice(await walletErrorText(e), true);
  }
}

async function disconnect(): Promise<void> {
  const w = await loadWallets();
  const wallet = w.activeWallet();
  if (wallet) await wallet.disconnect();
  w.setActiveWallet(null);
  const { resetClient } = await import("../stellar/contract");
  resetClient();
  session = null;
  wrongNetwork = false;
  render();
  refreshFreezeLabel();
}

async function walletErrorText(e: unknown): Promise<string> {
  const { WALLET_ERRORS } = await loadWallets();
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === WALLET_ERRORS.notInstalled) return t("freighterInstall");
  if (msg === WALLET_ERRORS.rejected) return t("walletRejected");
  if (msg === WALLET_ERRORS.friendbot) return t("friendbotFailed");
  if (msg === WALLET_ERRORS.guestTestnetOnly) return t("guestTestnetOnly");
  return t("walletUnknown");
}

/** Aviso breve sobre el pie de página. Se va solo. */
function notice(text: string, bad: boolean): void {
  document.querySelector(".wallet-notice")?.remove();
  const el = document.createElement("div");
  el.className = `wallet-notice${bad ? " bad" : ""}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), bad ? 7000 : 4500);
}
