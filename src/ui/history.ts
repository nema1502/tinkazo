import { $, esc } from "../dom";
import { getLang, t } from "../i18n";
import { network, txUrl } from "../stellar/config";

/**
 * El historial de sorteos.
 *
 * Tinkazo no tiene servidor ni base de datos, así que no hay dónde guardar el
 * historial de nadie. Y la cadena, que sí es permanente, no se puede consultar
 * hacia atrás sin límite: el RPC de Soroban solo indexa los eventos de las
 * últimas horas.
 *
 * La solución honesta es decir de dónde sale cada cosa:
 *
 * - **El navegador se acuerda.** Cada sorteo que se hace acá queda anotado en
 *   este equipo. Si se borran los datos del sitio, se pierde la lista; el
 *   sorteo no, que sigue en la cadena.
 * - **El comprobante es el que vale.** Cada fila lleva su enlace, y ese enlace
 *   funciona para siempre y desde cualquier lado, porque lleva todo lo que
 *   hace falta para recomputar el sorteo.
 *
 * Se guarda por red y por cuenta: quien entra con otra cuenta ve lo suyo.
 */

export interface Entry {
  /** Identificador en el contrato, si el sorteo se ancló. */
  id?: string;
  /** La cuenta que selló. */
  organizer: string;
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  /** Momento del sello, en segundos. */
  sealedAt: number;
  prize: string;
  /** Los nombres que ganaron, cuando ya se sorteó. */
  winners?: string[];
  /** El enlace del comprobante. Es lo único que hace falta para rehacerlo. */
  proof?: string;
  sealTx?: string;
  drawTx?: string;
}

/** Cuántos se guardan. Más que esto y el almacenamiento del navegador molesta. */
const MAX = 200;

const key = (): string => `tinkazo.history.${network.name}`;

function readAll(): Entry[] {
  try {
    const raw = localStorage.getItem(key());
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? (list as Entry[]) : [];
  } catch {
    // Sin almacenamiento, o con datos rotos: el historial simplemente no está.
    return [];
  }
}

function writeAll(list: Entry[]): void {
  try {
    localStorage.setItem(key(), JSON.stringify(list.slice(-MAX)));
  } catch {
    /* que no se pueda guardar no rompe el sorteo */
  }
}

/**
 * Anota un sorteo. Se llama al sellar y otra vez al sortear, así que la
 * segunda vez completa la fila en vez de duplicarla.
 */
export function remember(entry: Entry): void {
  const list = readAll();
  const same = (e: Entry): boolean =>
    e.organizer === entry.organizer && e.listHash === entry.listHash && e.round === entry.round;
  const at = list.findIndex(same);
  if (at >= 0) list[at] = { ...list[at], ...entry } as Entry;
  else list.push(entry);
  writeAll(list);
}

/** Los sorteos de una cuenta, del más nuevo al más viejo. */
export function historyOf(organizer: string): Entry[] {
  return readAll()
    .filter((e) => e.organizer === organizer)
    .sort((a, b) => b.sealedAt - a.sealedAt);
}

/** Borra el historial de esta cuenta. Los sorteos anclados siguen en la cadena. */
export function forget(organizer: string): void {
  writeAll(readAll().filter((e) => e.organizer !== organizer));
}

/* ----------------------------------------------------------------- pantalla */

const fmtDate = (secs: number): string =>
  secs ? new Date(secs * 1000).toLocaleString(getLang() === "es" ? "es-BO" : "en-US") : "";

/** Dibuja el historial de la cuenta conectada. Si no hay nada, esconde el bloque. */
export function renderHistory(organizer: string | null): void {
  const box = $("sec-history");
  if (!organizer) {
    box.style.display = "none";
    return;
  }
  const list = historyOf(organizer);
  if (list.length === 0) {
    box.style.display = "none";
    return;
  }

  $("hist-count").textContent = t("histCount").replace("{n}", String(list.length));
  $("hist-list").innerHTML = list
    .map((e) => {
      const who = e.winners?.length ? e.winners.join(", ") : t("histPending");
      const id = e.id ? `#${esc(e.id)}` : t("histLocal");
      const chain = e.drawTx
        ? ` · <a href="${esc(txUrl(e.drawTx))}" target="_blank" rel="noopener">${esc(t("histChain"))} ↗</a>`
        : e.sealTx
          ? ` · <a href="${esc(txUrl(e.sealTx))}" target="_blank" rel="noopener">${esc(t("histSeal"))} ↗</a>`
          : "";
      const proof = e.proof
        ? ` · <a href="${esc(e.proof)}" target="_blank" rel="noopener">${esc(t("histProof"))} ↗</a>`
        : "";
      return (
        `<p class="entity"><b>${esc(who)}</b> · ${esc(id)} · ${e.count} ${esc(t("histPeople"))}` +
        `${e.prize ? ` · ${esc(e.prize)}` : ""} · ${esc(fmtDate(e.sealedAt))}${chain}${proof}</p>`
      );
    })
    .join("");
  box.style.display = "block";
}

/**
 * El historial como CSV, para bajarlo.
 *
 * Con comillas dobles en todos los campos y las comillas internas duplicadas,
 * que es lo que manda el RFC 4180. Un nombre con una coma adentro rompe un CSV
 * hecho a la ligera, y acá los nombres son de personas de verdad.
 */
export function toCsv(organizer: string): string {
  const head = [
    "id", "fecha", "cuenta", "list_hash", "participantes", "ganadores",
    "ronda", "premio", "tx_sello", "tx_sorteo", "comprobante",
  ];
  const q = (v: string | number | undefined): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = historyOf(organizer).map((e) =>
    [
      q(e.id ?? ""),
      q(new Date(e.sealedAt * 1000).toISOString()),
      q(e.organizer),
      q(e.listHash),
      q(e.count),
      q(e.winners?.join(" | ") ?? ""),
      q(e.round),
      q(e.prize),
      q(e.sealTx ?? ""),
      q(e.drawTx ?? ""),
      q(e.proof ?? ""),
    ].join(","),
  );
  return [head.map(q).join(","), ...rows].join("\n");
}

/** Baja el historial como archivo. */
export function downloadCsv(organizer: string): void {
  const blob = new Blob([toCsv(organizer)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tinkazo-${network.name}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
