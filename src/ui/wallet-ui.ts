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
  /** Nombre y foto, cuando la cuenta los trae. Con Google, sí. */
  name?: string;
  avatar?: string;
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
    const prof = pollarWallet.profile();
    session = {
      kind: "external",
      label: pollarWallet.label,
      address,
      ...(prof ? { name: prof.name, avatar: prof.avatar } : {}),
    };
    render();
    refreshFreezeLabel();
    // Al retomar la sesión, el perfil puede llegar un instante después que la
    // dirección. Sin este reintento la cabecera se quedaba con la dirección y
    // el nombre no volvía a aparecer hasta el próximo ingreso.
    if (!prof) {
      setTimeout(() => {
        const late = pollarWallet.profile();
        if (!late || !session) return;
        session = { ...session, name: late.name, avatar: late.avatar };
        render();
      }, 2000);
    }
  } catch {
    /* sin sesion previa, la cabecera queda como estaba */
  }
}

function render(): void {
  const box = $("wallet-box");
  box.innerHTML = "";
  applyGate();
  void import("./history").then((h) => h.renderHistory(session?.address ?? null));
  // Sin contrato en esta red, el anclaje no se ofrece y la cabecera calla.
  if (!anchoringAvailable) return;

  if (!session) {
    box.appendChild(button(t("connectWallet"), "solid", () => void openPicker()));
    return;
  }

  const net = document.createElement("span");
  // Naranja en testnet y turquesa en mainnet: el color dice en qué red estás
  // antes de que alcances a leer la palabra.
  net.className = wrongNetwork ? "netbadge bad" : network.name === "mainnet" ? "netbadge main" : "netbadge";
  net.textContent = network.name === "testnet" ? t("netTest") : network.name;
  net.title = t(network.name === "testnet" ? "netTestHint" : "netMainHint");
  box.appendChild(net);

  const link = document.createElement("a");
  link.className = session.name ? "hello" : "hello mono";
  link.href = accountUrl(session.address);
  link.target = "_blank";
  link.rel = "noopener";
  link.title = `${session.label} · ${session.address}`;
  // Si la cuenta trae nombre, se muestra el nombre: una dirección de 56
  // caracteres no le dice nada a nadie, y menos en una pantalla grande.
  if (session.avatar) {
    const img = document.createElement("img");
    img.className = "hello-face";
    img.src = session.avatar;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    link.appendChild(img);
  }
  link.appendChild(document.createTextNode(session.name || shortAddress(session.address)));
  box.appendChild(link);

  box.appendChild(button(t("disconnect"), "", () => void disconnect()));

  if (wrongNetwork) notice(t("wrongNetwork").replace("{red}", network.name), true);
  void refreshFunds();
}

/* -------------------------------------------------------------------- puerta */

/**
 * Sin cuenta conectada no se sortea.
 *
 * Es una decisión de producto, no una limitación técnica: el sorteo funciona
 * igual sin cuenta, y de hecho el código para hacerlo sigue ahí. Pero un
 * sorteo sin cuenta no queda registrado en ningún lado, así que nadie más que
 * el organizador puede confirmar después que esa era la lista original. Pedir
 * la cuenta de entrada hace que todos los sorteos nazcan verificables.
 *
 * Lo de abajo no se esconde: queda a la vista y apagado, para que se entienda
 * qué se va a poder hacer y por qué todavía no.
 *
 * Los participantes siguen sin necesitar nada. La cuenta es del organizador.
 */
function applyGate(): void {
  const gate = $("gate");
  const body = gate.parentElement;
  // Si en esta red no hay contrato, no hay nada que conectar: no se traba a
  // nadie con una puerta que no tiene llave.
  const locked = anchoringAvailable && session === null;
  body?.classList.toggle("locked", locked);
  if (!locked) {
    gate.style.display = "none";
    return;
  }
  gate.innerHTML = "";
  const h = document.createElement("h3");
  h.textContent = t("gateTitle");
  gate.appendChild(h);
  const p = document.createElement("p");
  p.textContent = t("gateBody");
  gate.appendChild(p);
  const row = document.createElement("div");
  row.className = "row";
  const b = button(t("gateAction"), "solid", () => void openPicker());
  row.appendChild(b);
  gate.appendChild(row);
  const foot = document.createElement("p");
  foot.className = "note";
  foot.textContent = t("gateFoot");
  gate.appendChild(foot);
  gate.style.display = "block";
}

/* -------------------------------------------------------------------- grifo */

/**
 * El paso del grifo, dentro del mismo diálogo de conectar.
 *
 * Una cuenta recién creada no tiene con qué pagar la comisión, y ese es el
 * primer muro. Aparece acá, con la persona todavía mirando el diálogo, en vez
 * de como un aviso más abajo en la página que nadie lee.
 */
function showFundStep(back: HTMLElement, address: string): void {
  const card = back.querySelector<HTMLElement>(".modal-card");
  if (!card) {
    back.remove();
    void refreshFunds();
    return;
  }
  card.innerHTML = "";
  const box = document.createElement("div");
  box.className = "fund";
  box.style.boxShadow = "none";
  box.style.border = "0";
  box.style.margin = "0";
  box.style.padding = "0";
  card.appendChild(box);
  renderFundBox(box, address);

  const close = document.createElement("button");
  close.className = "mini";
  close.style.marginTop = "14px";
  close.textContent = t("fundLater");
  close.addEventListener("click", () => {
    back.remove();
    // Queda en la página por si quiere volver, pero ya lo vio.
    void refreshFunds();
  });
  card.appendChild(close);
  (card.querySelector<HTMLElement>("button") ?? card).focus();
}

/**
 * El panel del grifo.
 *
 * Una cuenta recién creada no tiene con qué pagar la comisión, y ese es el
 * primer muro que se encuentra cualquiera que entra con Google. Antes el error
 * aparecía recién al intentar sellar, y decía "tu cuenta no tiene XLM" sin
 * decir qué hacer al respecto.
 *
 * En testnet hay un grifo público que regala XLM de mentira, así que el panel
 * lo ofrece con un botón. En mainnet no hay grifo: ahí solo se muestra la
 * dirección para copiarla y mandarle fondos desde donde sea.
 */
async function refreshFunds(): Promise<void> {
  const box = $("fund-box");
  if (!session) {
    box.style.display = "none";
    return;
  }
  const { xlmBalance } = await loadWallets();
  const bal = await xlmBalance(session.address);
  // -1 es "no pude preguntar". Sin respuesta no se afirma nada.
  if (bal < 0 || bal >= 1) {
    box.style.display = "none";
    return;
  }
  renderFundBox(box, session.address);
}

function renderFundBox(box: HTMLElement, address: string): void {
  const testnet = network.name === "testnet";
  box.innerHTML = "";

  const tag = document.createElement("span");
  tag.className = "fund-tag";
  tag.textContent = testnet ? t("fundTag") : network.name;
  box.appendChild(tag);

  const h = document.createElement("h3");
  h.textContent = t("fundTitle");
  box.appendChild(h);

  const p = document.createElement("p");
  p.textContent = t(testnet ? "fundBody" : "fundBodyMain");
  box.appendChild(p);

  const row = document.createElement("div");
  row.className = "fund-addr";
  const code = document.createElement("code");
  code.textContent = address;
  row.appendChild(code);

  const copy = button(t("fundCopy"), "", () => {
    void navigator.clipboard.writeText(address).then(
      () => { copy.textContent = t("copied"); },
      () => { code.focus(); },
    );
  });
  row.appendChild(copy);
  box.appendChild(row);

  const actions = document.createElement("div");
  actions.className = "row";
  if (testnet) {
    const get = button(t("fundGet"), "solid", () => {
      get.disabled = true;
      get.textContent = t("fundWorking");
      void (async () => {
        try {
          const { fundWithFriendbot } = await loadWallets();
          await fundWithFriendbot(address);
          // El grifo tarda un par de segundos en que el saldo se vea.
          setTimeout(() => void refreshFunds(), 2500);
          get.textContent = t("fundDone");
        } catch {
          get.disabled = false;
          get.textContent = t("fundFailed");
        }
      })();
    });
    actions.appendChild(get);
  }

  const lab = document.createElement("a");
  lab.className = "ghost";
  lab.target = "_blank";
  lab.rel = "noopener";
  lab.href = testnet
    ? "https://lab.stellar.org/account/fund"
    : accountUrl(address);
  lab.textContent = t(testnet ? "fundLab" : "fundExplorer");
  actions.appendChild(lab);
  box.appendChild(actions);

  if (testnet) {
    const foot = document.createElement("p");
    foot.className = "note";
    foot.textContent = t("fundFoot");
    box.appendChild(foot);
  }
  box.style.display = "block";
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

  // Google primero, y de lejos: es el camino que funciona sin instalar nada y
  // el que va a tomar casi todo el mundo. Ofrecer arriba una extensión que la
  // persona no tiene instalada es mandarla a una tienda antes de dejarla
  // probar el producto.
  const { pollarConfigured } = await import("../stellar/wallet-pollar");
  if (pollarConfigured()) {
    options.push({ label: t("googleWallet"), hint: t("googleHint"), pick: "google" });
  }
  if (w.guestAvailable()) {
    options.push({ label: t("guestWallet"), hint: t("guestHint"), pick: "guest" });
  }
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

  // Quién custodia la llave, dicho en chiquito y al pie. Va acá y no en la
  // explicación de arriba: a quien entra con Google le importa entrar, y quien
  // quiera saber quién guarda la llave lo encuentra sin buscar.
  const by = document.createElement("p");
  by.className = "modal-by";
  by.textContent = t("byPollar");
  card.appendChild(by);

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
    const prof = pick === "google" ? (wallet as { profile?: () => { name: string; avatar: string } | null }).profile?.() : null;
    session = {
      kind: wallet.kind,
      label: wallet.label,
      address,
      ...(prof ? { name: prof.name, avatar: prof.avatar } : {}),
    };
    render();
    refreshFreezeLabel();
    if (wallet.kind === "guest") notice(t("guestReady"), false);
    // El diálogo no se cierra hasta saber si la cuenta puede pagar. Cerrarlo y
    // dejar el aviso más abajo en la página hacía que nadie lo viera: la
    // persona seguía con su lista y se enteraba recién al intentar sellar.
    //
    // La cuenta de prueba se fondea sola al crearse, así que ahí no se
    // pregunta: Horizon tarda unos segundos en reflejarlo y el diálogo
    // mostraría el grifo para una cuenta que ya tiene fondos.
    if (wallet.kind !== "guest") {
      let bal = await w.xlmBalance(address);
      // Una cuenta recién creada puede tardar en aparecer. Se reintenta una vez
      // antes de decirle a alguien que no tiene nada.
      if (bal === 0) {
        await new Promise((r) => setTimeout(r, 2500));
        bal = await w.xlmBalance(address);
      }
      if (bal >= 0 && bal < 1) {
        showFundStep(back, address);
        return;
      }
    }
    back.remove();
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
