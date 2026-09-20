import { $, esc } from "../dom";
import { getLang, onLangChange, setLang, t } from "../i18n";
import { accountUrl, network } from "../stellar/config";
import { PACES, currentPace, setPace, type Pace } from "../state";
import { isMuted, toggleSound } from "../sound";

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

let open = false;

/** Cierra el panel si está abierto. */
export function closeAccount(): void {
  document.querySelector(".acct-back")?.remove();
  open = false;
}

export function openAccount(view: AccountView): void {
  if (open) {
    closeAccount();
    return;
  }
  open = true;

  const back = document.createElement("div");
  back.className = "modal-back acct-back";
  const card = document.createElement("div");
  card.className = "modal-card acct-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", t("acctTitle"));
  card.tabIndex = -1;

  /* ---------------------------------------------------------------- quién */
  const who = document.createElement("div");
  who.className = "acct-who";
  if (view.avatar) {
    const img = document.createElement("img");
    img.src = view.avatar;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    who.appendChild(img);
  }
  const whoText = document.createElement("div");
  whoText.innerHTML =
    `<b>${esc(view.name || t("acctNoName"))}</b>` +
    `<span class="mono">${esc(view.address.slice(0, 6))}…${esc(view.address.slice(-4))}</span>`;
  who.appendChild(whoText);
  card.appendChild(who);

  /* ----------------------------------------------------------------- red */
  const net = document.createElement("p");
  net.className = "acct-net";
  const bal = view.balance < 0 ? t("acctUnknown") : `${view.balance.toFixed(2)} XLM`;
  net.textContent = `${network.name === "testnet" ? t("netTest") : network.name} · ${bal}`;
  card.appendChild(net);

  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(mini(t("fundCopy"), () => void navigator.clipboard.writeText(view.address)));
  if (network.name === "testnet" && view.balance >= 0 && view.balance < 20) {
    row.appendChild(mini(t("fundGet"), () => { closeAccount(); view.onFund(); }, "solid"));
  }
  const explorer = document.createElement("a");
  explorer.className = "mini";
  explorer.href = accountUrl(view.address);
  explorer.target = "_blank";
  explorer.rel = "noopener";
  explorer.textContent = t("fundExplorer");
  row.appendChild(explorer);
  card.appendChild(row);

  /* -------------------------------------------------------- preferencias */
  const prefs = document.createElement("div");
  prefs.className = "acct-prefs";
  prefs.appendChild(label(t("acctPrefs")));

  const sound = mini(soundText(), () => {
    toggleSound();
    sound.textContent = soundText();
  });
  prefs.appendChild(sound);

  const pace = document.createElement("select");
  pace.className = "mono";
  for (const p of Object.keys(PACES) as Pace[]) {
    const o = document.createElement("option");
    o.value = p;
    o.textContent = t(p === "rapido" ? "paceFast" : p === "normal" ? "paceNormal" : "paceEpic");
    pace.appendChild(o);
  }
  pace.value = currentPace();
  pace.addEventListener("change", () => {
    setPace(pace.value as Pace);
    // El selector de la página muestra lo mismo: se mantienen sincronizados.
    const other = document.getElementById("pace") as HTMLSelectElement | null;
    if (other) other.value = pace.value;
  });
  prefs.appendChild(pace);

  const lang = mini(getLang() === "es" ? "English" : "Español", () => {
    setLang(getLang() === "es" ? "en" : "es");
    closeAccount();
  });
  prefs.appendChild(lang);
  card.appendChild(prefs);

  /* ----------------------------------------------------------- historial */
  const hist = document.createElement("div");
  hist.className = "acct-hist";
  card.appendChild(hist);
  void import("./history").then((h) => {
    const list = h.historyOf(view.address);
    hist.appendChild(label(t("histTitle")));
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "note";
      empty.textContent = t("acctNoRaffles");
      hist.appendChild(empty);
      return;
    }
    const ul = document.createElement("div");
    ul.innerHTML = list
      .slice(0, 6)
      .map((e) => {
        const w = e.winners?.length ? e.winners.join(", ") : t("histPending");
        const link = e.proof ? ` <a href="${esc(e.proof)}" target="_blank" rel="noopener">${esc(t("histProof"))} ↗</a>` : "";
        return `<p class="entity"><b>${esc(w)}</b> · ${e.count} ${esc(t("histPeople"))}${link}</p>`;
      })
      .join("");
    hist.appendChild(ul);
    const more = document.createElement("div");
    more.className = "row";
    more.appendChild(mini(t("histCsv"), () => h.downloadCsv(view.address)));
    more.appendChild(
      mini(t("acctSeeAll"), () => {
        closeAccount();
        document.getElementById("sec-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
    hist.appendChild(more);
  });

  /* --------------------------------------------------------------- salir */
  const out = document.createElement("div");
  out.className = "row";
  out.appendChild(mini(t("disconnect"), () => { closeAccount(); view.onDisconnect(); }));
  out.appendChild(mini(t("cancel"), () => closeAccount()));
  card.appendChild(out);

  back.appendChild(card);
  back.addEventListener("click", (e) => {
    if (e.target === back) closeAccount();
  });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    document.removeEventListener("keydown", onKey, true);
    closeAccount();
  };
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(back);
  card.focus();
  onLangChange(() => closeAccount());
}

function soundText(): string {
  const es = getLang() === "es";
  return isMuted() ? (es ? "Sonido: no" : "Sound: off") : es ? "Sonido: sí" : "Sound: on";
}

function mini(text: string, onClick: () => void, extra = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = `mini ${extra}`.trim();
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function label(text: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "kicker";
  p.textContent = text;
  return p;
}

void $;
