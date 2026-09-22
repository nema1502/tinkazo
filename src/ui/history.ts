import { $, esc } from "../dom";
import { getLang, t } from "../i18n";
import { network, txUrl } from "../stellar/config";
import type { ChainRaffle } from "../stellar/seals";

/**
 * El historial de sorteos.
 *
 * Tinkazo no tiene servidor ni base de datos, así que no hay dónde guardar el
 * historial de nadie. Sale de dos lados, y se dice de cuál sale cada fila:
 *
 * - **El navegador se acuerda.** Cada sorteo que se hace acá queda anotado en
 *   este equipo, con los nombres y el comprobante. Si se borran los datos del
 *   sitio, se pierde la lista; el sorteo no, que sigue en la cadena.
 * - **La cadena, para lo demás.** Los sorteos anclados que esta cuenta hizo en
 *   otro equipo se traen del contrato (`sealsOnChain`). De esos se sabe la
 *   fecha, el premio, cuántas personas había y qué puesto de la lista ganó,
 *   pero no los nombres: la lista nunca sube a la cadena, solo su huella.
 *
 * Cuando un sorteo está en los dos lados gana el del equipo, que tiene los
 * nombres. Se guarda por red y por cuenta: quien entra con otra cuenta ve lo
 * suyo.
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
  /**
   * El puesto de quien ganó en la lista, desde cero, cuando se sabe que se
   * sorteó pero no se tienen los nombres: lo trajo la cadena.
   */
  winnerIdx?: number[];
  /** Este equipo no lo conocía: lo trajo la cadena. */
  fromChain?: boolean;
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

/**
 * Junta lo que recuerda este equipo con lo que trajo la cadena.
 *
 * Un sorteo es el mismo si coinciden el identificador y la huella de la lista.
 * El identificador solo no alcanza: si el contrato se vuelve a desplegar los
 * ids arrancan otra vez desde 1, y el #3 de antes no es el #3 de ahora.
 */
export function mergeWithChain(local: Entry[], raffles: ChainRaffle[]): Entry[] {
  const out = [...local];
  const known = new Map<string, number>();
  local.forEach((e, i) => {
    if (e.id) known.set(`${e.id}:${e.listHash}`, i);
  });
  for (const r of raffles) {
    const at = known.get(`${r.id}:${r.listHash}`);
    if (at !== undefined) {
      // Este equipo ya lo tiene, con los nombres. Lo único que la cadena puede
      // agregar es que se sorteó en otro lado, por ejemplo desde la página de
      // verificación, con este equipo apagado.
      const e = out[at] as Entry;
      if (!e.winners?.length && r.winners?.length) out[at] = { ...e, winnerIdx: r.winners };
      continue;
    }
    out.push({
      id: r.id,
      organizer: r.organizer,
      listHash: r.listHash,
      count: r.count,
      numWinners: r.numWinners,
      round: r.round,
      sealedAt: r.sealedAt,
      prize: r.prize,
      fromChain: true,
      ...(r.winners?.length ? { winnerIdx: r.winners } : {}),
    });
  }
  return out.sort((a, b) => b.sealedAt - a.sealedAt);
}

/** Lo último que se trajo de la cadena. Dura lo que dura la página. */
let chain: { who: string; raffles: ChainRaffle[] } | null = null;
/** La cuenta por la que se está preguntando, para no preguntar dos veces. */
let asking: string | null = null;
/** La cuenta cuyo historial está en pantalla. */
let shown: string | null = null;

/** Los sorteos de una cuenta, del más nuevo al más viejo, de los dos lados. */
export function historyOf(organizer: string): Entry[] {
  const local = readAll().filter((e) => e.organizer === organizer);
  return mergeWithChain(local, chain?.who === organizer ? chain.raffles : []);
}

/** Borra el historial de esta cuenta. Los sorteos anclados siguen en la cadena. */
export function forget(organizer: string): void {
  writeAll(readAll().filter((e) => e.organizer !== organizer));
}

/**
 * Pregunta a la cadena una vez por cuenta y por página. Si falla, la próxima
 * vez que se dibuje el historial se vuelve a intentar.
 */
async function askChain(organizer: string): Promise<void> {
  const contractId = network.contractId;
  if (!contractId || chain?.who === organizer || asking === organizer) return;
  asking = organizer;
  const { sealsOnChain } = await import("../stellar/seals");
  const got = await sealsOnChain(organizer, contractId, network.rpcUrl);
  if (asking === organizer) asking = null;
  if (!got) return;
  chain = { who: organizer, raffles: got.raffles };
  // Si mientras tanto se cambió de cuenta, esta respuesta ya no es de nadie
  // en pantalla y no se dibuja.
  if (shown === organizer) paint(organizer);
}

/* ----------------------------------------------------------------- pantalla */

const fmtDate = (secs: number): string =>
  secs ? new Date(secs * 1000).toLocaleString(getLang() === "es" ? "es-BO" : "en-US") : "";

/** Quién ganó, dicho con lo que se tenga: los nombres o el puesto en la lista. */
export function winnerLabel(e: Entry): string {
  if (e.winners?.length) return e.winners.join(", ");
  if (e.winnerIdx?.length) return t("histWinnerAt").replace("{n}", e.winnerIdx.map((i) => i + 1).join(", "));
  return t("histPending");
}

/** Dibuja el historial de la cuenta conectada y pide a la cadena lo que falte. */
export function renderHistory(organizer: string | null): void {
  paint(organizer);
  if (organizer) void askChain(organizer);
}

/** Lo último que se dibujó, para que el botón de rearmar sepa de qué fila habla. */
let pintadas: Entry[] = [];
let enlazado = false;

function enlazarRearmado(): void {
  if (enlazado) return;
  enlazado = true;
  $("hist-list").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-rearmar]");
    if (!b) return;
    const fila = pintadas[Number(b.dataset.rearmar)];
    if (fila) void import("./rebuild").then((m) => m.abrirRearmado(fila));
  });
}

function paint(organizer: string | null): void {
  shown = organizer;
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

  const fromChain = list.filter((e) => e.fromChain).length;
  const here = list.length - fromChain;
  $("hist-count").textContent = (
    !fromChain ? t("histCount") : here ? t("histCountBoth") : t("histCountChain")
  )
    .replace("{n}", String(here))
    .replace("{c}", String(fromChain));
  pintadas = list;
  enlazarRearmado();
  $("hist-list").innerHTML = list
    .map((e, i) => {
      const id = e.id ? `#${esc(e.id)}` : t("histLocal");
      const origin = e.fromChain ? ` · ${esc(t("histFromChain"))}` : "";
      const chainLink = e.drawTx
        ? ` · <a href="${esc(txUrl(e.drawTx))}" target="_blank" rel="noopener">${esc(t("histChain"))} ↗</a>`
        : e.sealTx
          ? ` · <a href="${esc(txUrl(e.sealTx))}" target="_blank" rel="noopener">${esc(t("histSeal"))} ↗</a>`
          : "";
      // Sin comprobante pero con id: la lista no está acá, pero el sorteo sí
      // está en la cadena. Con la lista a mano se rearma.
      const proof = e.proof
        ? ` · <a href="${esc(e.proof)}" target="_blank" rel="noopener">${esc(t("histProof"))} ↗</a>`
        : e.id
          ? ` · <button class="mini" data-rearmar="${i}">${esc(t("histRebuild"))}</button>`
          : "";
      return (
        `<p class="entity"><b>${esc(winnerLabel(e))}</b> · ${esc(id)} · ${e.count} ${esc(t("histPeople"))}` +
        `${e.prize ? ` · ${esc(e.prize)}` : ""} · ${esc(fmtDate(e.sealedAt))}${origin}${chainLink}${proof}</p>`
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
    "ronda", "premio", "tx_sello", "tx_sorteo", "comprobante", "origen",
  ];
  const q = (v: string | number | undefined): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = historyOf(organizer).map((e) =>
    [
      q(e.id ?? ""),
      q(new Date(e.sealedAt * 1000).toISOString()),
      q(e.organizer),
      q(e.listHash),
      q(e.count),
      // Sin nombres, el puesto en la lista, contado desde uno como lo cuenta
      // una persona.
      q(e.winners?.join(" | ") ?? e.winnerIdx?.map((i) => `#${i + 1}`).join(" | ") ?? ""),
      q(e.round),
      q(e.prize),
      q(e.sealTx ?? ""),
      q(e.drawTx ?? ""),
      q(e.proof ?? ""),
      q(e.fromChain ? "cadena" : "equipo"),
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
