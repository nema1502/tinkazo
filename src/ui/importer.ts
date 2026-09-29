import { esc } from "../dom";
import { T, getLang, t } from "../i18n";
import { avatar } from "../state";
import {
  type Built,
  type Preset,
  type RowFilter,
  type Table,
  buildList,
  cleanName,
  detectSource,
  emailColumn,
  filterChoices,
  filterRows,
  maskEmail,
  nameKey,
  presentColumn,
  presets,
  rowPasses,
  statusColumn,
} from "./csv";

/**
 * La ventana de importar una lista.
 *
 * Un export de Luma trae a todos los inscritos, y el sorteo casi siempre es
 * entre los que fueron. En el primero de verdad que se probó, de 67 inscritos
 * vinieron 35: sin mirar, la mitad de las chances iban a gente que no estaba
 * en la sala. Esta ventana muestra el archivo entero, propone quiénes entran,
 * dice quién queda afuera y por qué, y deja marcar o desmarcar a mano (alguien
 * que vino y no le hicieron check-in).
 *
 * Todo pasa en el navegador: el archivo no se sube a ningún lado, y de él solo
 * salen nombres. Los correos se usan nada más para distinguir a dos personas
 * con el mismo nombre, enmascarados.
 */

/** Lo que la ventana recuerda entre una apertura y la siguiente. */
export interface ImportState {
  table: Table;
  fileName: string;
  nameCol: number;
  picked: boolean[];
  /** El atajo elegido, o "other" con `filter`, o "hand" si se tocó a mano. */
  mode: Preset["id"] | "other";
  filter: RowFilter | null;
  hand: number;
  fixCase: boolean;
  numberDupes: boolean;
}

export interface ImportResult {
  names: string[];
  picked: number;
  total: number;
  mode: ImportState["mode"];
  hand: number;
  source: "luma" | null;
}

/** El estado inicial de un archivo recién leído: entran los que fueron, si se sabe. */
export function initialState(table: Table, fileName: string): ImportState {
  const ps = presets(table);
  const first = ps[0] as Preset;
  return {
    table,
    fileName,
    nameCol: table.suggested,
    picked: table.rows.map((r) => (first.filter ? rowPasses(r, first.filter) : true)),
    mode: first.id,
    filter: first.filter,
    hand: 0,
    fixCase: true,
    numberDupes: false,
  };
}

/** Más filas que esto y no se dibujan las caras: cada una es un lienzo. */
const MAX_FACES = 400;

/** Los estados de inscripción de Luma, con su traducción. */
const STATUS_KEY: Record<string, string> = {
  approved: "impStApproved",
  pending_approval: "impStPending",
  invited: "impStInvited",
  declined: "impStDeclined",
  waitlist: "impStWaitlist",
};

export function openImporter(s: ImportState, onApply: (r: ImportResult) => void): void {
  const L = T[getLang()];
  const tb = s.table;
  const source = detectSource(tb);
  const pcol = presentColumn(tb);
  const scol = statusColumn(tb);
  const ecol = emailColumn(tb);
  const ps = presets(tb);
  let search = "";
  let built: Built = buildList(tb, s.nameCol, s.picked, s);

  const back = document.createElement("div");
  back.className = "modal-back imp-back";
  const card = document.createElement("div");
  card.className = "modal-card importer";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "imp-title");

  card.innerHTML = `
    <div class="imp-head">
      <div class="imp-title">
        <span class="kicker">${esc(source === "luma" ? t("impLuma") : t("impFile"))}</span>
        <h3 id="imp-title">${esc(s.fileName)}</h3>
        <p class="note">${esc(L.impShape(tb.rows.length, tb.columns.length))}</p>
      </div>
      <button class="imp-x" type="button" aria-label="${esc(t("impClose"))}">×</button>
    </div>
    <div class="imp-body">
      <aside class="imp-side">
        <label class="imp-field"><span class="kicker">${esc(t("impNameCol"))}</span><select class="imp-col"></select></label>
        <fieldset class="imp-who">
          <legend class="kicker">${esc(t("impWho"))}</legend>
          <div class="imp-opts"></div>
          <details class="imp-more"><summary>${esc(t("impOther"))}</summary><select class="imp-filter"></select></details>
        </fieldset>
        <div class="imp-out" aria-live="polite"></div>
        <div class="imp-fix"></div>
        <p class="note imp-priv">${esc(t("impPriv"))}</p>
      </aside>
      <section class="imp-list">
        <div class="imp-tools">
          <input class="imp-search" type="search" placeholder="${esc(t("impSearch"))}" aria-label="${esc(t("impSearch"))}" />
          <button type="button" class="mini imp-on">${esc(t("impAllOn"))}</button>
          <button type="button" class="mini imp-off">${esc(t("impAllOff"))}</button>
          <span class="imp-count mono" aria-live="polite"></span>
        </div>
        <ul class="imp-rows"></ul>
      </section>
    </div>
    <div class="imp-foot">
      <span class="note imp-need"></span>
      <button type="button" class="ghost imp-cancel">${esc(t("cancel"))}</button>
      <button type="button" class="primary imp-use"></button>
    </div>`;

  const q = <E extends Element>(sel: string): E => card.querySelector(sel) as E;
  const colSel = q<HTMLSelectElement>(".imp-col");
  const opts = q<HTMLDivElement>(".imp-opts");
  const more = q<HTMLDetailsElement>(".imp-more");
  const filterSel = q<HTMLSelectElement>(".imp-filter");
  const out = q<HTMLDivElement>(".imp-out");
  const fix = q<HTMLDivElement>(".imp-fix");
  const list = q<HTMLUListElement>(".imp-rows");
  const count = q<HTMLSpanElement>(".imp-count");
  const use = q<HTMLButtonElement>(".imp-use");
  const need = q<HTMLSpanElement>(".imp-need");

  colSel.innerHTML = tb.columns.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join("");
  colSel.value = String(s.nameCol);

  /* ------------------------------------------------ quiénes entran */
  const presetLabel = (p: Preset): [string, string] =>
    p.id === "came" ? [t("impCame"), t("impCameSub")]
      : p.id === "approved" ? [t("impApproved"), t("impApprovedSub")]
        : [t("impAll"), t("impAllSub")];
  opts.innerHTML = ps
    .map((p) => {
      const [a, b] = presetLabel(p);
      return `<label class="imp-opt"><input type="radio" name="imp-who" value="${p.id}" />` +
        `<span><b>${esc(a)}</b><small>${esc(b)}</small></span><em class="mono">${p.count}</em></label>`;
    })
    .join("");

  let choices: RowFilter[] = [];
  const fillChoices = (): void => {
    choices = filterChoices(tb, s.nameCol);
    const lbl = (f: RowFilter): string => {
      const col = tb.columns[f.column] ?? "";
      const n = filterRows(tb, f).rows.length;
      return f.value === null ? L.csvHas(col, n) : L.csvIs(col, f.value, n);
    };
    filterSel.innerHTML = `<option value="-1">—</option>` +
      choices.map((f, i) => `<option value="${i}">${esc(lbl(f))}</option>`).join("");
    const at = s.mode === "other" && s.filter
      ? choices.findIndex((f) => f.column === s.filter?.column && f.value === s.filter?.value) : -1;
    filterSel.value = String(at);
    more.style.display = choices.length ? "" : "none";
  };

  const syncMode = (): void => {
    for (const r of opts.querySelectorAll<HTMLInputElement>("input")) r.checked = r.value === s.mode;
    if (s.mode === "other") more.open = true;
  };

  const applyFilter = (mode: ImportState["mode"], f: RowFilter | null): void => {
    s.mode = mode;
    s.filter = f;
    s.hand = 0;
    s.picked = tb.rows.map((r) => (f ? rowPasses(r, f) : true));
    render();
  };

  /* ------------------------------------------------ cada fila */
  const came = (i: number): boolean | null => (pcol >= 0 ? (tb.rows[i]?.[pcol] ?? "").trim() !== "" : null);
  const hhmm = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(getLang(), { hour: "2-digit", minute: "2-digit" });
  };
  const statusOf = (i: number): string => (scol >= 0 ? (tb.rows[i]?.[scol] ?? "").trim() : "");
  const dupeRows = (): Set<number> => new Set(built.dupes.flat());

  const renderRows = (): void => {
    const faces = tb.rows.length <= MAX_FACES;
    const rep = dupeRows();
    const needle = nameKey(search);
    const html: string[] = [];
    // Con un filtro, primero los que lo pasan y después el resto, cada grupo
    // con su título. El orden sale del filtro y no de las casillas: marcar a
    // mano no mueve la fila de lugar.
    const f = s.filter;
    const pass = tb.rows.map((r) => (f ? rowPasses(r, f) : true));
    const order = [...tb.rows.keys()].sort((a, b) => Number(pass[b]) - Number(pass[a]) || a - b);
    const nIn = pass.filter(Boolean).length;
    const [hIn, hOut] = s.mode === "came" ? [L.impGrpCame(nIn), L.impGrpNoCame(tb.rows.length - nIn)]
      : s.mode === "approved" ? [L.impGrpApproved(nIn), L.impGrpRest(tb.rows.length - nIn)]
        : [L.impGrpIn(nIn), L.impGrpOut(tb.rows.length - nIn)];
    let group = -1;
    order.forEach((i) => {
      const r = tb.rows[i] as string[];
      if (f && !needle && Number(!pass[i]) !== group) {
        group = Number(!pass[i]);
        html.push(`<li class="imp-group kicker">${esc(group === 0 ? hIn : hOut)}</li>`);
      }
      const raw = cleanName(r[s.nameCol] ?? "");
      const shown = built.final[i] || raw;
      if (needle && !nameKey(`${raw} ${shown}`).includes(needle)) return;
      const on = !!s.picked[i];
      const badges: string[] = [];
      const c = came(i);
      if (c === true) badges.push(`<span class="imp-badge came">${esc(L.impCameAt(hhmm(tb.rows[i]?.[pcol] ?? "")))}</span>`);
      if (c === false) badges.push(`<span class="imp-badge nope">${esc(t("impNoShow"))}</span>`);
      const st = statusOf(i);
      if (st && st !== "approved") badges.push(`<span class="imp-badge st">${esc(STATUS_KEY[st] ? t(STATUS_KEY[st] as string) : st)}</span>`);
      if (on && rep.has(i)) badges.push(`<span class="imp-badge rep">${esc(t("impRepeated"))}</span>`);
      const was = on && built.final[i] && built.final[i] !== raw && !rep.has(i)
        ? `<small class="imp-was">${esc(L.impWas(raw))}</small>` : "";
      const mail = rep.has(i) && ecol >= 0 ? `<small class="imp-was mono">${esc(maskEmail(r[ecol] ?? ""))}</small>` : "";
      const face = faces && shown.length >= 2 ? `<img src="${avatar(shown, 36)}" alt="" />` : `<i class="imp-noface"></i>`;
      html.push(
        `<li class="${on ? "on" : "off"}"><label><input type="checkbox" data-row="${i}"${on ? " checked" : ""} />` +
        `${face}<span class="imp-name"><span class="n">${esc(shown || "—")}</span>${was}${mail}</span>` +
        `<span class="imp-badges">${badges.join("")}</span></label></li>`,
      );
    });
    // Sin coincidencias, los títulos de grupo solos no dicen nada.
    if (!html.some((h) => !h.includes("imp-group"))) html.length = 0;
    list.innerHTML = html.length ? html.join("") : `<li class="imp-empty note">${esc(t("impEmpty"))}</li>`;
  };

  /* ------------------------------------------------ quién queda afuera */
  const renderOut = (): void => {
    const groups = new Map<string, number>();
    tb.rows.forEach((_, i) => {
      if (s.picked[i]) return;
      const c = came(i);
      const st = statusOf(i);
      let k: string;
      if (c === true) k = "hand";
      else if (st && st !== "approved") k = `st:${st}`;
      else if (c === false) k = "noshow";
      else k = "other";
      groups.set(k, (groups.get(k) ?? 0) + 1);
    });
    const excluded = tb.rows.length - s.picked.filter(Boolean).length;
    if (!excluded) {
      out.innerHTML = `<p class="note">${esc(t("impNoneOut"))}</p>`;
      return;
    }
    const line = (k: string, n: number): string => {
      if (k === "hand") return L.impOutHand(n);
      if (k === "noshow") return L.impOutNoShow(n);
      if (k === "other") return L.impOutOther(n);
      const st = k.slice(3);
      if (st === "pending_approval") return L.impOutPending(n);
      if (st === "invited") return L.impOutInvited(n);
      if (st === "declined") return L.impOutDeclined(n);
      if (st === "waitlist") return L.impOutWaitlist(n);
      return L.impOutStatus(n, st);
    };
    const order = ["noshow", "st:pending_approval", "st:invited", "st:waitlist", "st:declined", "hand", "other"];
    const keys = [...groups.keys()].sort((a, b) => (order.indexOf(a) + 99 * +!order.includes(a)) - (order.indexOf(b) + 99 * +!order.includes(b)));
    out.innerHTML =
      `<p class="imp-out-h">${esc(L.impOut(excluded))}</p><ul>` +
      keys.map((k) => `<li>${esc(line(k, groups.get(k) ?? 0))}</li>`).join("") + `</ul>`;
  };

  /* ------------------------------------------------ arreglos */
  const renderFix = (): void => {
    const parts: string[] = [];
    // Cuántos cambiaría el arreglo de mayúsculas, aunque esté apagado.
    const withCase = buildList(tb, s.nameCol, s.picked, { fixCase: true, numberDupes: s.numberDupes });
    if (withCase.cased > 0) {
      const ex = tb.rows.findIndex((r, i) => s.picked[i] && withCase.final[i] && withCase.final[i] !== cleanName(r[s.nameCol] ?? ""));
      const before = ex >= 0 ? cleanName(tb.rows[ex]?.[s.nameCol] ?? "") : "";
      const after = ex >= 0 ? (withCase.final[ex] ?? "").replace(/ \(\d+\)$/, "") : "";
      parts.push(
        `<label class="imp-check"><input type="checkbox" class="imp-case"${s.fixCase ? " checked" : ""} />` +
        `<span><b>${esc(L.impFixCase(withCase.cased))}</b>${ex >= 0 ? `<small>${esc(L.impFixCaseEx(before, after))}</small>` : ""}</span></label>`,
      );
    }
    if (built.dupes.length) {
      parts.push(
        `<div class="imp-dupes"><b>${esc(L.impDupes(built.dupes.length))}</b>` +
        `<label class="imp-check"><input type="radio" name="imp-dup" value="one"${s.numberDupes ? "" : " checked"} /><span>${esc(t("impDupesOne"))}</span></label>` +
        `<label class="imp-check"><input type="radio" name="imp-dup" value="num"${s.numberDupes ? " checked" : ""} /><span>${esc(t("impDupesNum"))}</span></label></div>`,
      );
    }
    fix.innerHTML = parts.join("");
    fix.style.display = parts.length ? "" : "none";
  };

  const renderFoot = (): void => {
    const n = built.names.length;
    const marked = s.picked.filter(Boolean).length;
    count.textContent = L.impCount(marked, tb.rows.length) + (s.hand ? ` · ${L.impHand(s.hand)}` : "");
    use.textContent = L.impUse(n);
    use.disabled = n < 2;
    need.textContent = n < 2 ? t("impNeed") : "";
  };

  function render(): void {
    built = buildList(tb, s.nameCol, s.picked, s);
    syncMode();
    renderRows();
    renderOut();
    renderFix();
    renderFoot();
  }

  /* ------------------------------------------------ eventos */
  colSel.addEventListener("change", () => {
    s.nameCol = Number(colSel.value);
    if (s.filter?.column === s.nameCol) applyFilter("all", null);
    fillChoices();
    render();
  });
  opts.addEventListener("change", (e) => {
    const v = (e.target as HTMLInputElement).value as Preset["id"];
    const p = ps.find((x) => x.id === v);
    if (p) applyFilter(p.id, p.filter);
  });
  filterSel.addEventListener("change", () => {
    const f = choices[Number(filterSel.value)];
    if (f) applyFilter("other", f);
  });
  list.addEventListener("change", (e) => {
    const box = e.target as HTMLInputElement;
    const i = Number(box.dataset.row);
    if (!Number.isInteger(i)) return;
    s.picked[i] = box.checked;
    s.hand++;
    // Solo cambia esta fila y los números: redibujar la lista entera movería
    // el scroll de quien está marcando de a uno.
    built = buildList(tb, s.nameCol, s.picked, s);
    box.closest("li")?.classList.toggle("on", box.checked);
    box.closest("li")?.classList.toggle("off", !box.checked);
    renderOut();
    renderFix();
    renderFoot();
  });
  fix.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.classList.contains("imp-case")) s.fixCase = el.checked;
    if (el.name === "imp-dup") s.numberDupes = el.value === "num";
    render();
  });
  const search_ = q<HTMLInputElement>(".imp-search");
  search_.addEventListener("input", () => {
    search = search_.value;
    renderRows();
  });
  const setVisible = (on: boolean): void => {
    const needle = nameKey(search);
    tb.rows.forEach((r, i) => {
      if (needle && !nameKey(cleanName(r[s.nameCol] ?? "")).includes(needle)) return;
      if (s.picked[i] !== on) s.hand++;
      s.picked[i] = on;
    });
    render();
  };
  q<HTMLButtonElement>(".imp-on").addEventListener("click", () => setVisible(true));
  q<HTMLButtonElement>(".imp-off").addEventListener("click", () => setVisible(false));

  const before = document.activeElement as HTMLElement | null;
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("imp-open");
    back.remove();
    before?.focus?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
    // El foco no se escapa de la ventana con Tab.
    if (e.key === "Tab") {
      const f = [...card.querySelectorAll<HTMLElement>("button:not(:disabled), select, input, summary")].filter((x) => x.offsetParent !== null);
      const first = f[0];
      const last = f[f.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  q<HTMLButtonElement>(".imp-x").addEventListener("click", close);
  q<HTMLButtonElement>(".imp-cancel").addEventListener("click", close);
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });
  use.addEventListener("click", () => {
    if (built.names.length < 2) return;
    onApply({
      names: built.names,
      picked: built.names.length,
      total: tb.rows.length,
      mode: s.mode,
      hand: s.hand,
      source,
    });
    close();
  });

  fillChoices();
  render();
  back.appendChild(card);
  document.addEventListener("keydown", onKey, true);
  document.body.classList.add("imp-open");
  document.body.appendChild(back);
  (q<HTMLInputElement>(".imp-opts input:checked") ?? use).focus();
}
