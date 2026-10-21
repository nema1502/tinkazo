import { $, esc } from "../dom";
import { getLang, t } from "../i18n";
import type { SorteoDelEvento } from "../protocol/evento";
import { network, txUrl } from "../stellar/config";
import type { ChainRaffle } from "../stellar/seals";
import { agrupar, fechaLarga, tieneComprobante } from "./agrupar";
import { compartirEvento, compartirSorteo, partesDelEvento } from "./compartir";
import {
  type EventoGuardado,
  type SorteoGuardado,
  aSorteoDelEvento,
  borrarEvento,
  crearEvento,
  enlacesEnEventos,
  eventosDe,
  guardarEventos,
  leerEventos,
  nuevoId,
  quitarDeEvento,
  renombrarEvento,
  sorteosDelEvento,
  sumarAEvento,
} from "./eventos";

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
 *
 * Encima va "Mis eventos" (`eventos.ts`): eventos con nombre que arma quien
 * organiza, con sorteos de esta lista. Un sorteo que está en un evento se ve
 * dentro de él; los demás se agrupan por fecha, como antes.
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
  /**
   * La lista sellada, solo en este equipo. Con ella un sorteo sellado y sin
   * sortear se retoma después de recargar, en vez de sellar otra lista: dos
   * sellos para el mismo evento es justo el patrón que la página de seguridad
   * marca como el ataque abierto. Nunca sale del navegador.
   */
  names?: string[];
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

/**
 * Borra el historial de esta cuenta. Los sorteos anclados siguen en la cadena.
 * Sus eventos con nombre se van también: sus sorteos están en esta lista.
 */
export function forget(organizer: string): void {
  writeAll(readAll().filter((e) => e.organizer !== organizer));
  guardarEventos(
    network.name,
    leerEventos(network.name).filter((e) => e.organizer !== organizer),
  );
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
let enlazadoEventos = false;
/** Los eventos con nombre de la cuenta en pantalla: las tarjetas los ofrecen para sumar sorteos. */
let guardados: EventoGuardado[] = [];
/** Un aviso corto para la sección de eventos, que se muestra en la próxima pintada. */
let avisoPendiente = "";

const avisar = (texto: string): void => {
  avisoPendiente = texto;
};

/** El título de un evento sin nombre: "Sorteos del 20 de octubre de 2026". */
const tituloDeGrupo = (g: Entry[]): string => t("histGrupoT").replace("{f}", fechaLarga(g[0]?.sealedAt ?? 0, getLang()));

/** El comprobante y los ganadores de cada sorteo de un grupo: lo que pide el enlace de evento. */
async function sorteosDeEntradas(g: Entry[]): Promise<SorteoDelEvento[]> {
  const out: SorteoDelEvento[] = [];
  for (const e of g) {
    if (!tieneComprobante(e) || !e.winners?.length || !e.proof) continue;
    const s = await aSorteoDelEvento(e.proof, e.winners);
    if (s) out.push(s);
  }
  return out;
}

function enlazarRearmado(): void {
  if (enlazado) return;
  enlazado = true;
  $("hist-list").addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const r = el.closest<HTMLElement>("[data-retomar]");
    if (r) {
      const fila = pintadas[Number(r.dataset.retomar)];
      if (fila?.names?.length) void import("./freeze").then((m) => m.resumeFrozen(fila as Entry & { names: string[] }));
      return;
    }
    const comparte = el.closest<HTMLButtonElement>("[data-evento]");
    if (comparte) {
      const g = eventosPintados[Number(comparte.dataset.evento)];
      if (g) void sorteosDeEntradas(g).then((sorteos) => compartirEvento(tituloDeGrupo(g), sorteos));
      return;
    }
    const nombra = el.closest<HTMLButtonElement>("[data-nombrar]");
    if (nombra) {
      const g = eventosPintados[Number(nombra.dataset.nombrar)];
      if (g && shown) nombrarGrupo(shown, g);
      return;
    }
    const compartir = el.closest<HTMLButtonElement>("[data-compartir]");
    if (compartir) {
      const fila = pintadas[Number(compartir.dataset.compartir)];
      if (fila?.proof && fila.winners?.length) void compartirSorteo(fila.proof, fila.winners);
      return;
    }
    const b = el.closest<HTMLElement>("[data-rearmar]");
    if (!b) return;
    const fila = pintadas[Number(b.dataset.rearmar)];
    if (fila) void import("./rebuild").then((m) => m.abrirRearmado(fila));
  });
  // "Sumar a un evento": el selector de cada sorteo.
  $("hist-list").addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    if (!sel.matches("select[data-sumar]") || !shown) return;
    const fila = pintadas[Number(sel.dataset.sumar)];
    const id = sel.value;
    if (!fila?.proof || !fila.winners?.length || !id) return;
    const lista = leerEventos(network.name);
    const ev = lista.find((x) => x.id === id);
    guardarEventos(network.name, sumarAEvento(lista, id, { enlace: fila.proof, ganadores: fila.winners }));
    avisar(t("evnSumado").replace("{nombre}", ev?.nombre ?? ""));
    paint(shown);
  });
}

/** Un grupo por fecha pasa a ser un evento con nombre: sus sorteos salen de la lista suelta. */
function nombrarGrupo(organizer: string, g: Entry[]): void {
  const sorteos: SorteoGuardado[] = g
    .filter((e) => tieneComprobante(e) && e.winners?.length && e.proof)
    .map((e) => ({ enlace: e.proof as string, ganadores: e.winners ?? [] }));
  if (!sorteos.length) return;
  const nombre = tituloDeGrupo(g);
  const id = nuevoId();
  let lista = crearEvento(leerEventos(network.name), organizer, nombre, id);
  for (const s of sorteos) lista = sumarAEvento(lista, id, s);
  guardarEventos(network.name, lista);
  avisar(t("evnCreado").replace("{nombre}", nombre));
  paint(organizer);
}

/** La clave "id|posición" de un sorteo dentro de un evento, como la ponen los botones. */
function sorteoDeClave(clave: string): { ev: EventoGuardado; s: SorteoGuardado } | null {
  const [id, k] = clave.split("|");
  const ev = leerEventos(network.name).find((x) => x.id === id);
  const s = ev?.sorteos[Number(k)];
  return ev && s ? { ev, s } : null;
}

/** La sección "Mis eventos": el formulario para armar uno, y cada evento con su lista. */
function pintarEventos(list: Entry[]): void {
  const caja = $("hist-eventos");
  if (!guardados.length && !list.some(tieneComprobante)) {
    caja.style.display = "none";
    caja.innerHTML = "";
    return;
  }
  const aviso = avisoPendiente;
  avisoPendiente = "";
  caja.style.display = "block";
  caja.innerHTML =
    `<section class="evn" aria-labelledby="evn-t">` +
    `<div class="ev-cabeza"><h3 id="evn-t">${esc(t("evnT"))}</h3></div>` +
    `<p class="note">${esc(t("evnLead"))}</p>` +
    `<form class="evn-nuevo" data-nuevo>` +
    `<label class="kicker" for="evn-nuevo-in">${esc(t("evnNombre"))}</label>` +
    `<div class="evn-fila"><input id="evn-nuevo-in" type="text" maxlength="80" autocomplete="off" required>` +
    `<button class="primary mini" type="submit">${esc(t("evnCrear"))}</button></div>` +
    `</form>` +
    (aviso ? `<p class="evn-aviso" role="status">${esc(aviso)}</p>` : "") +
    (guardados.length
      ? guardados.map((ev) => tarjetaDeEvento(ev, list)).join("")
      : `<p class="note">${esc(t("evnVacio"))}</p>`) +
    `</section>`;
  enlazarEventos();
}

/** Un evento: su nombre (que se puede cambiar), cuántos sorteos tiene, y su lista de comprobantes. */
function tarjetaDeEvento(ev: EventoGuardado, list: Entry[]): string {
  const n = ev.sorteos.length;
  const id = esc(ev.id);
  const filas = ev.sorteos.map((s, k) => filaDeEvento(ev, s, k, list)).join("");
  return (
    `<article class="evn-card">` +
    `<label class="kicker" for="evn-n-${id}">${esc(t("evnNombre"))}</label>` +
    `<div class="evn-fila"><input id="evn-n-${id}" type="text" maxlength="80" value="${esc(ev.nombre)}">` +
    `<button class="ghost mini" type="button" data-evento-guardar="${id}">${esc(t("evnGuardar"))}</button></div>` +
    `<p class="hc-meta">${esc(n === 1 ? t("evUnSorteo") : t("evNSorteos").replace("{n}", String(n)))}</p>` +
    `<div class="hc-acciones">` +
    `<button class="primary mini" type="button" data-evento-compartir="${id}"${n ? "" : " disabled"}>${esc(t("histGrupoCompartir"))}</button>` +
    `<button class="ghost mini" type="button" data-evento-borrar="${id}">${esc(t("evnBorrar"))}</button>` +
    `</div>` +
    `<details class="evn-detalle"><summary>${esc(t("evnVerLista"))}</summary>` +
    (n ? `<ol class="evn-sorteos">${filas}</ol>` : `<p class="note">${esc(t("evnSinSorteos"))}</p>`) +
    `</details>` +
    `</article>`
  );
}

/** Un sorteo dentro del evento: el premio y la fecha (si están en la lista), quién ganó y sus botones. */
function filaDeEvento(ev: EventoGuardado, s: SorteoGuardado, k: number, list: Entry[]): string {
  const e = list.find((x) => x.proof === s.enlace);
  const titulo = e?.prize || t("histDraw");
  const fecha = e ? fmtDate(e.sealedAt) : "";
  const quien = `${t(s.ganadores.length > 1 ? "histWonMany" : "histWon")} <b>${esc(s.ganadores.join(", "))}</b>`;
  const clave = esc(`${ev.id}|${k}`);
  return (
    `<li class="evn-sorteo"><div><b>${esc(titulo)}</b>${fecha ? ` <span class="hc-fecha">${esc(fecha)}</span>` : ""}</div>` +
    `<p class="hc-meta">${quien}</p>` +
    `<div class="hc-acciones">` +
    `<a class="ghost mini" href="${esc(s.enlace)}" target="_blank" rel="noopener">${esc(t("histSeeProof"))}</a>` +
    `<button class="ghost mini" type="button" data-compartir-enlace="${clave}">${esc(t("cmpBtn"))}</button>` +
    `<button class="ghost mini" type="button" data-evento-quitar="${clave}">${esc(t("evnQuitar"))}</button>` +
    `</div></li>`
  );
}

/** Los clics y envíos de la sección de eventos. Se enlazan una sola vez: la sección se vuelve a dibujar entera. */
function enlazarEventos(): void {
  if (enlazadoEventos) return;
  enlazadoEventos = true;
  const caja = $("hist-eventos");
  caja.addEventListener("submit", (e) => {
    const f = e.target as HTMLFormElement;
    if (!f.matches("form[data-nuevo]") || !shown) return;
    e.preventDefault();
    const nombre = (f.querySelector("input") as HTMLInputElement).value.trim();
    if (!nombre) {
      avisar(t("evnNombreVacio"));
      paint(shown);
      return;
    }
    guardarEventos(network.name, crearEvento(leerEventos(network.name), shown, nombre, nuevoId()));
    avisar(t("evnCreado").replace("{nombre}", nombre));
    paint(shown);
  });
  caja.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const compartir = el.closest<HTMLButtonElement>("[data-evento-compartir]");
    if (compartir) {
      const ev = leerEventos(network.name).find((x) => x.id === compartir.dataset.eventoCompartir);
      if (ev) void sorteosDelEvento(ev).then((sorteos) => compartirEvento(ev.nombre, sorteos));
      return;
    }
    const guardar = el.closest<HTMLButtonElement>("[data-evento-guardar]");
    if (guardar) {
      const nombre = guardar.closest(".evn-card")?.querySelector<HTMLInputElement>("input")?.value.trim() ?? "";
      if (!nombre) avisar(t("evnNombreVacio"));
      else guardarEventos(network.name, renombrarEvento(leerEventos(network.name), guardar.dataset.eventoGuardar ?? "", nombre));
      paint(shown);
      return;
    }
    const borrar = el.closest<HTMLButtonElement>("[data-evento-borrar]");
    if (borrar) {
      if (!confirm(t("evnBorrarConf"))) return;
      guardarEventos(network.name, borrarEvento(leerEventos(network.name), borrar.dataset.eventoBorrar ?? ""));
      paint(shown);
      return;
    }
    const quitar = el.closest<HTMLButtonElement>("[data-evento-quitar]");
    if (quitar) {
      const r = sorteoDeClave(quitar.dataset.eventoQuitar ?? "");
      if (r) {
        guardarEventos(network.name, quitarDeEvento(leerEventos(network.name), r.ev.id, r.s.enlace));
        avisar(t("evnQuitado").replace("{nombre}", r.ev.nombre));
      }
      paint(shown);
      return;
    }
    const compartirEnlace = el.closest<HTMLButtonElement>("[data-compartir-enlace]");
    if (compartirEnlace) {
      const r = sorteoDeClave(compartirEnlace.dataset.compartirEnlace ?? "");
      if (r) void compartirSorteo(r.s.enlace, r.s.ganadores);
    }
  });
}

/**
 * Pone en el botón de compartir cuántos enlaces va a tener el evento, cuando
 * son varios: "Compartir el evento (3 partes)". Se calcula después de dibujar,
 * porque armar los enlaces es asincrónico.
 */
async function etiquetarPartes(): Promise<void> {
  const grupos = eventosPintados;
  const evs = guardados;
  const poner = (boton: Element | null, n: number): void => {
    if (boton && n > 1) boton.textContent = t("evnCompartirPartes").replace("{n}", String(n));
  };
  for (const [gi, g] of grupos.entries()) {
    poner(document.querySelector(`[data-evento="${gi}"]`), await partesDelEvento(tituloDeGrupo(g), await sorteosDeEntradas(g)));
  }
  for (const ev of evs) {
    const boton = document.querySelector(`[data-evento-compartir="${ev.id}"]`);
    poner(boton, await partesDelEvento(ev.nombre, await sorteosDelEvento(ev)));
  }
}

function paint(organizer: string | null): void {
  shown = organizer;
  const box = $("sec-history");
  if (!organizer) {
    box.style.display = "none";
    return;
  }
  const list = historyOf(organizer);
  guardados = eventosDe(leerEventos(network.name), organizer);
  if (list.length === 0 && guardados.length === 0) {
    box.style.display = "none";
    return;
  }

  // Los sorteos de la cuenta, vengan de este equipo o de la cadena. Quien ya
  // tiene sorteos no necesita la bienvenida de la primera vez (onboarding.ts).
  if (list.length) document.dispatchEvent(new CustomEvent("tinkazo:con-sorteos"));
  $("hist-count").textContent = t("histCount").replace("{n}", String(list.length));
  pintadas = list;
  enlazarRearmado();
  pintarEventos(list);

  // Lo que está en un evento con nombre se ve dentro de él, no suelto.
  const enEvento = enlacesEnEventos(leerEventos(network.name), organizer);
  const sueltos = list.filter((e) => !(e.proof && enEvento.has(e.proof)));
  // Cada sorteo, una tarjeta. Los que tienen comprobante se agrupan por fecha en
  // eventos: una cabecera con "Compartir el evento" y, debajo, sus sorteos en el
  // orden de la lista.
  const grupos = agrupar(sueltos);
  eventoDe = new Map<Entry, number>();
  grupos.forEach((g, gi) => g.forEach((e) => eventoDe.set(e, gi)));
  eventosPintados = grupos;
  const pintados = new Set<number>();
  let html = "";
  for (const e of sueltos) {
    const i = list.indexOf(e);
    const gi = eventoDe.get(e);
    if (gi === undefined) {
      html += tarjetaDeSorteo(e, i);
      continue;
    }
    if (pintados.has(gi)) continue;
    pintados.add(gi);
    const g = grupos[gi] ?? [];
    html += cabeceraDeEvento(g, gi);
    const enOrden = g.map((x) => ({ x, i: list.indexOf(x) })).sort((a, b) => a.i - b.i);
    html += enOrden.map(({ x, i: j }) => tarjetaDeSorteo(x, j)).join("");
  }
  $("hist-list").innerHTML = html;
  box.style.display = "block";
  void etiquetarPartes();
}

/** Los eventos de la última lista pintada: "Compartir el evento" busca el suyo por su número. */
let eventosPintados: Entry[][] = [];
/** De cada sorteo pintado, el número de su evento. */
let eventoDe = new Map<Entry, number>();

/** Una tarjeta: el estado, el premio, cuántos y quién ganó, y una acción principal. */
function tarjetaDeSorteo(e: Entry, i: number): string {
  const hecho = !!(e.winners?.length || e.winnerIdx?.length || e.drawTx);
  const titulo = e.prize || (e.id ? `${t("histDraw")} #${e.id}` : t("histDraw"));
  const id = e.id ? `#${esc(e.id)}` : t("histLocal");
  const origen = e.fromChain ? ` · ${esc(t("histFromChain"))}` : "";
  const enCadena = e.drawTx ?? e.sealTx;
  const acciones: string[] = [];
  if (!hecho && e.names?.length) acciones.push(`<button class="primary mini" data-retomar="${i}">${esc(t("histResume"))}</button>`);
  // El comprobante se puede compartir otra vez, con el QR y el mensaje: sale del enlace y de los ganadores.
  const compartible = !!(e.proof && tieneComprobante(e) && e.winners?.length);
  if (compartible) acciones.push(`<button class="primary mini" type="button" data-compartir="${i}">${esc(t("cmpBtn"))}</button>`);
  // Sin comprobante pero con id: la lista no está acá, pero el sorteo sí
  // está en la cadena. Con la lista a mano se rearma.
  if (e.proof) acciones.push(`<a class="ghost mini" href="${esc(e.proof)}" target="_blank" rel="noopener">${esc(t("histSeeProof"))}</a>`);
  else if (hecho && e.id) acciones.push(`<button class="ghost mini" data-rearmar="${i}">${esc(t("histRebuild"))}</button>`);
  if (enCadena) acciones.push(`<a class="hc-link" href="${esc(txUrl(enCadena))}" target="_blank" rel="noopener">${esc(t("histOnChain"))} ↗</a>`);
  if (!hecho && !e.names?.length) acciones.push(`<span class="note">${esc(t("histOtherDevice"))}</span>`);
  if (compartible && guardados.length) {
    const opciones = guardados.map((ev) => `<option value="${esc(ev.id)}">${esc(ev.nombre)}</option>`).join("");
    acciones.push(
      `<select class="hc-sumar" data-sumar="${i}" aria-label="${esc(t("evnSumar"))}">` +
        `<option value="">${esc(t("evnSumar"))}</option>${opciones}</select>`,
    );
  }
  return (
    `<article class="hist-card${hecho ? " hecho" : ""}">` +
    `<div class="hc-top"><span class="hc-estado">${esc(t(hecho ? "histStateDone" : "histStatePending"))}</span>` +
    `<span class="hc-fecha">${esc(fmtDate(e.sealedAt))}</span></div>` +
    `<h3>${esc(titulo)}</h3>` +
    `<p class="hc-meta">${esc(id)} · ${e.count} ${esc(t("histPeople"))}${hecho ? ` · ${esc(t((e.winners?.length ?? 0) > 1 ? "histWonMany" : "histWon"))} <b>${esc(winnerLabel(e))}</b>` : ""}${origen}</p>` +
    `<div class="hc-acciones">${acciones.join("")}</div>` +
    `</article>`
  );
}

/**
 * La cabecera de un evento sin nombre: "Sorteos del 20 de octubre de 2026", cuántos son,
 * el botón para compartirlo y el de ponerle nombre (que lo vuelve un evento con nombre).
 */
function cabeceraDeEvento(g: Entry[], gi: number): string {
  const n = g.length;
  return (
    `<div class="hist-evento">` +
    `<div><h3>${esc(tituloDeGrupo(g))}</h3>` +
    `<p class="note">${esc(n === 1 ? t("evUnSorteo") : t("evNSorteos").replace("{n}", String(n)))}</p></div>` +
    `<div class="hc-acciones">` +
    `<button class="primary mini" type="button" data-evento="${gi}">${esc(t("histGrupoCompartir"))}</button>` +
    `<button class="ghost mini" type="button" data-nombrar="${gi}">${esc(t("evnNombrar"))}</button>` +
    `</div></div>`
  );
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
