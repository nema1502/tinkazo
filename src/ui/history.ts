import { $, esc } from "../dom";
import { getLang, t } from "../i18n";
import type { SorteoDelEvento } from "../protocol/evento";
import { network, txUrl } from "../stellar/config";
import type { ChainRaffle } from "../stellar/seals";
import { agrupar, enOrdenDeSalida, fechaLarga, tieneComprobante } from "./agrupar";
import { compartirEvento, compartirSorteo } from "./compartir";
import {
  type EventoGuardado,
  type SorteoGuardado,
  aSorteoDelEvento,
  borrarEvento,
  crearEvento,
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
/** De cada enlace de comprobante que está en un evento con nombre, su evento: la tarjeta del sorteo lo dice. */
let eventoDelEnlace = new Map<string, EventoGuardado>();
/**
 * Los sorteos que se pueden sumar a un evento: con comprobante y ganadores, y
 * en ningún evento todavía. Del más nuevo al más viejo, con su lugar en la lista.
 */
let candidatos: Array<{ e: Entry; i: number }> = [];
/** El grupo del día que "Ponerle nombre a los sorteos de hoy" vuelve evento, si hay uno. */
let grupoNombrable: Entry[] | null = null;
/**
 * El evento que se está armando: el que se acaba de crear o al que se le acaba
 * de sumar un sorteo. Ofrece los sorteos para sumar sin plegarlos. Dura lo que
 * dura la página.
 */
let activo: string | null = null;
/** El formulario de "Nuevo evento" está a la vista: se pliega detrás del botón. */
let formAbierto = false;
/**
 * La acción principal de Mis sorteos, la única con el color de la casa
 * (docs/ux.md, regla 1): "retomar:<i>", "compartir:<i>", "grupo:<n>" o
 * "evento:<id>", o "" si no hay. Hasta el 22 de octubre de 2026 eran
 * principales "Compartir el evento", cada "Compartir" y "Ponerle nombre a los
 * sorteos de hoy", tres a la vez con un solo sorteo, y no se sabía cuál tocar
 * (evaluación de la subida 2, hallazgo 8).
 */
let principal = "";
/** Cuántos sorteos ofrece un evento para sumar, los más nuevos. Los demás se suman desde su tarjeta. */
const CANDIDATOS_MAX = 8;

const avisar = (texto: string): void => {
  avisoPendiente = texto;
};

/** Se puede sumar a un evento o compartir: tiene el enlace del comprobante y sus ganadores. */
const compartible = (e: Entry): e is Entry & { proof: string; winners: string[] } =>
  !!(e.proof && tieneComprobante(e) && e.winners?.length);

/**
 * La principal es lo que sigue con el sorteo más nuevo que tiene algo para
 * hacer: retomarlo si quedó a medias; si no, compartirlo, y si es parte de un
 * evento (del día o con nombre) de dos o más sorteos, compartir el evento
 * entero, que manda lo mismo y más. Lo demás queda secundario, sin sacar nada.
 */
function elegirPrincipal(list: Entry[], grupos: Entry[][]): string {
  for (const [i, e] of list.entries()) {
    const hecho = !!(e.winners?.length || e.winnerIdx?.length || e.drawTx);
    if (!hecho && e.names?.length) return `retomar:${i}`;
    if (!compartible(e)) continue;
    const suEvento = eventoDelEnlace.get(e.proof);
    if (suEvento) return suEvento.sorteos.length > 1 ? `evento:${suEvento.id}` : `compartir:${i}`;
    const gi = eventoDe.get(e);
    return gi !== undefined && (grupos[gi]?.length ?? 0) > 1 ? `grupo:${gi}` : `compartir:${i}`;
  }
  return "";
}

/**
 * La clase y la marca de un botón según sea la principal: con el formulario de
 * "Nuevo evento" abierto, la principal es "Crear evento" y esta espera de secundaria.
 */
const comoPrincipal = (clave: string): string =>
  clave && clave === principal ? `class="${formAbierto ? "ghost" : "primary"} mini" data-principal` : `class="ghost mini"`;

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

/* ------------------------------------------------- el sorteo que quedó sin sortear */

/**
 * Cuánto hace que se selló, como mucho, para ofrecer retomarlo desde "Nuevo
 * sorteo": es el que la sala está esperando. Los de antes siguen en Mis sorteos.
 */
const PENDIENTE_S = 15 * 60;

/** El sorteo que se ofrece retomar, si hay uno. */
let pendiente: (Entry & { names: string[] }) | null = null;
let enlazadoPendiente = false;

/**
 * Un sorteo sellado en este equipo hace un rato y sin sortear, con su lista:
 * se recargó la página durante la espera, o se cerró la pestaña. La lista
 * sellada ya no estaba en la pantalla y "Nuevo sorteo" volvía vacío, sin decir
 * nada; el sorteo seguía en Mis sorteos, pero había que saber ir a buscarlo
 * con la sala esperando. Y quien no lo encontraba sellaba otra lista: dos
 * sellos para lo mismo es justo el patrón que la página de seguridad marca como
 * el ataque abierto (buscador de detalles, D06).
 *
 * Es un aviso arriba de la lista, con "Retomarlo" como acción secundaria: en el
 * paso 1 la principal sigue siendo sellar. Nunca se retoma solo. Ni en la demo,
 * ni con un sello en pantalla.
 */
function pintarPendiente(list: Entry[]): void {
  const caja = document.getElementById("pendiente");
  if (!caja) return;
  const ahora = Date.now() / 1000;
  const e =
    hayUnSello() || document.body.dataset.demo === "1"
      ? undefined
      : list.find((x) => x.names?.length && !x.winners?.length && !x.winnerIdx?.length && !x.drawTx && ahora - x.sealedAt < PENDIENTE_S);
  pendiente = e ? (e as Entry & { names: string[] }) : null;
  if (!e) {
    caja.style.display = "none";
    caja.textContent = "";
    return;
  }
  const que = `${e.prize || t("histDraw")} · ${e.count} ${t("histPeople")}`;
  caja.innerHTML =
    `<span>${esc(t("pendienteT").replace("{que}", que))}</span>` +
    `<button class="mini" type="button" data-retomar-pendiente>${esc(t("pendienteBtn"))}</button>`;
  caja.style.display = "";
  if (enlazadoPendiente) return;
  enlazadoPendiente = true;
  caja.addEventListener("click", (ev) => {
    const fila = pendiente;
    if (!fila || !(ev.target as HTMLElement).closest("[data-retomar-pendiente]")) return;
    void retomar(fila);
  });
}

/**
 * Hay una lista sellada en la pantalla (la muestra `showFrozen` y la suelta
 * `unfreeze`). Se mira la página y no el estado: este módulo se prueba sin ella.
 */
const hayUnSello = (): boolean => document.getElementById("sec-frozen")?.style.display === "block";

/** Retoma un sorteo sellado (`resumeFrozen`) y saca el aviso: ya no hay nada pendiente fuera de la pantalla. */
async function retomar(fila: Entry & { names: string[] }): Promise<void> {
  const { resumeFrozen } = await import("./freeze");
  resumeFrozen(fila);
  if (!hayUnSello()) return;
  pendiente = null;
  const caja = document.getElementById("pendiente");
  if (caja) {
    caja.style.display = "none";
    caja.textContent = "";
  }
  // Si la ronda ya nació, la cuenta regresiva ya dejó el foco en "Lanzar el sorteo"; si no, en la espera.
  if (document.activeElement === document.body) document.getElementById("btn-espera")?.focus({ preventScroll: true });
}

function enlazarRearmado(): void {
  if (enlazado) return;
  enlazado = true;
  $("hist-list").addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const r = el.closest<HTMLElement>("[data-retomar]");
    if (r) {
      const fila = pintadas[Number(r.dataset.retomar)];
      if (fila?.names?.length) void retomar(fila as Entry & { names: string[] });
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

/**
 * Un grupo por fecha pasa a ser un evento con nombre: sus sorteos salen de la
 * lista suelta. Nace con la fecha de nombre, y el campo queda con el foco y la
 * fecha marcada: lo que se escribe la reemplaza, y Enter lo guarda. Hasta el
 * 21 de octubre de 2026 el foco se perdía, Enter no hacía nada y lo escrito se
 * iba al recargar (buscador de detalles, D14).
 */
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
  const campo = document.getElementById(`evn-n-${id}`) as HTMLInputElement | null;
  campo?.focus();
  campo?.select();
}

/**
 * Guarda el nombre que dice el campo de un evento. Con `repintar`, además
 * avisa y vuelve a dibujar la sección (Enter o "Guardar el nombre"); sin él
 * (al salir del campo), solo guarda: repintar ahí rehacía los botones justo
 * cuando se estaba tocando "Compartir el evento", y el toque se perdía.
 */
function guardarNombre(campo: HTMLInputElement, id: string, repintar: boolean): void {
  const nombre = campo.value.trim();
  if (!shown) return;
  if (!nombre) {
    if (!repintar) return;
    avisar(t("evnNombreVacio"));
    paint(shown);
    return;
  }
  const lista = leerEventos(network.name);
  if (lista.find((x) => x.id === id)?.nombre === nombre && !repintar) return;
  guardarEventos(network.name, renombrarEvento(lista, id, nombre));
  if (!repintar) return;
  avisar(t("evnRenombrado").replace("{nombre}", nombre));
  paint(shown);
  // Lo que sigue es mandarlo: el foco a "Compartir el evento", sin volver a abrir el teclado del celular.
  const sigue = document.querySelector<HTMLButtonElement>(`[data-evento-compartir="${CSS.escape(id)}"]`);
  if (sigue && !sigue.disabled) sigue.focus({ preventScroll: true });
}

/** La clave "id|posición" de un sorteo dentro de un evento, como la ponen los botones. */
function sorteoDeClave(clave: string): { ev: EventoGuardado; s: SorteoGuardado } | null {
  const [id, k] = clave.split("|");
  const ev = leerEventos(network.name).find((x) => x.id === id);
  const s = ev?.sorteos[Number(k)];
  return ev && s ? { ev, s } : null;
}

/** "Ponerle nombre a los sorteos de hoy", o "… del 20 de octubre de 2026" si el grupo empezó otro día. */
function rotuloNombrar(g: Entry[]): string {
  const desde = g[0]?.sealedAt ?? 0;
  const d = new Date(desde * 1000);
  const hoy = new Date();
  const esHoy = d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth() && d.getDate() === hoy.getDate();
  return esHoy ? t("evnNombrarHoy") : t("evnNombrarDel").replace("{f}", fechaLarga(desde, getLang()));
}

/**
 * La sección "Mis eventos": cada evento con su lista y, plegado detrás de
 * "Nuevo evento", el formulario para armar uno.
 *
 * Hasta el 21 de octubre de 2026 la sección abría con el campo vacío y "Crear
 * evento" como botón principal, y el evento recién creado quedaba vacío, con
 * "Compartir el evento" apagado sin decir por qué: la pista para sumarle
 * sorteos estaba plegada, y el selector, en cada sorteo, más abajo. Ahora, sin
 * eventos, lo primero es "Ponerle nombre a los sorteos de hoy", que es el
 * camino de cuatro toques; un evento vacío ofrece adentro los sorteos sueltos,
 * cada uno con su "Sumar"; y el botón apagado dice qué le falta (evaluación
 * crítica de experiencia, hallazgo 2).
 */
function pintarEventos(list: Entry[], sueltos: Entry[], grupos: Entry[][]): void {
  const caja = $("hist-eventos");
  candidatos = sueltos.filter(compartible).map((e) => ({ e, i: list.indexOf(e) }));
  // El grupo del sorteo más nuevo que se puede sumar: "Ponerle nombre" lo vuelve un evento entero.
  const ultimo = candidatos[0]?.e;
  grupoNombrable = ultimo ? (grupos.find((g) => g.includes(ultimo)) ?? null) : null;
  if (!guardados.length && !list.some(tieneComprobante)) {
    caja.style.display = "none";
    caja.innerHTML = "";
    return;
  }
  const aviso = avisoPendiente;
  avisoPendiente = "";
  const nuevo =
    `<button class="ghost mini" type="button" data-evn-nuevo aria-expanded="${formAbierto}" aria-controls="evn-nuevo-f">` +
    `${esc(t("evnNuevo"))}</button>`;
  // Sin eventos: primero el camino corto, y "Nuevo evento" al lado. Los dos
  // secundarios: la principal es la de la lista (`principal`), y con el
  // formulario abierto, "Crear evento".
  const arriba =
    !guardados.length && grupoNombrable
      ? `<div class="hc-acciones evn-arriba"><button class="ghost mini" type="button" data-nombrar-ultimo>${esc(rotuloNombrar(grupoNombrable))}</button>${nuevo}</div>`
      : (guardados.length ? "" : `<p class="note">${esc(t("evnVacio"))}</p>`) + `<div class="hc-acciones evn-arriba">${nuevo}</div>`;
  caja.style.display = "block";
  caja.innerHTML =
    `<section class="evn" aria-labelledby="evn-t">` +
    `<div class="ev-cabeza"><h3 id="evn-t">${esc(t("evnT"))}</h3></div>` +
    `<p class="note">${esc(t("evnLead"))}</p>` +
    arriba +
    `<form class="evn-nuevo" id="evn-nuevo-f" data-nuevo${formAbierto ? "" : " hidden"}>` +
    `<label class="kicker" for="evn-nuevo-in">${esc(t("evnNombre"))}</label>` +
    `<div class="evn-fila"><input id="evn-nuevo-in" type="text" maxlength="80" autocomplete="off" required>` +
    `<button class="primary mini" type="submit">${esc(t("evnCrear"))}</button></div>` +
    `</form>` +
    (aviso ? `<p class="evn-aviso" role="status">${esc(aviso)}</p>` : "") +
    // El más nuevo primero, como los sorteos: el que se acaba de crear queda debajo del aviso.
    [...guardados].reverse().map((ev) => tarjetaDeEvento(ev, list)).join("") +
    `</section>`;
  enlazarEventos();
}

/** Un evento: su nombre (que se puede cambiar), cuántos sorteos tiene, los que se le pueden sumar y su lista de comprobantes. */
function tarjetaDeEvento(ev: EventoGuardado, list: Entry[]): string {
  const n = ev.sorteos.length;
  const id = esc(ev.id);
  // En el orden en que salieron, como el mensaje y la foto; `k` sigue siendo su lugar en el evento guardado.
  const filas = enOrdenDeSalida(
    ev.sorteos.map((s, k) => {
      const e = list.find((x) => x.proof === s.enlace);
      return { s, k, id: e?.id, sealedAt: e?.sealedAt, round: e?.round };
    }),
  )
    .map(({ s, k }) => filaDeEvento(ev, s, k, list))
    .join("");
  return (
    `<article class="evn-card" id="evn-c-${id}" tabindex="-1">` +
    // Un formulario, como "Crear evento": Enter guarda el nombre.
    `<form class="evn-nombre" data-renombrar="${id}">` +
    `<label class="kicker" for="evn-n-${id}">${esc(t("evnNombre"))}</label>` +
    `<div class="evn-fila"><input id="evn-n-${id}" type="text" maxlength="80" autocomplete="off" value="${esc(ev.nombre)}">` +
    `<button class="ghost mini" type="submit">${esc(t("evnGuardar"))}</button></div>` +
    `</form>` +
    `<p class="hc-meta">${esc(n === 1 ? t("evUnSorteo") : t("evNSorteos").replace("{n}", String(n)))}</p>` +
    `<div class="hc-acciones">` +
    // Apagado, dice por qué a la vista: un botón gris sin explicación parece roto.
    `<button ${comoPrincipal(`evento:${ev.id}`)} type="button" data-evento-compartir="${id}"${n ? "" : ` disabled aria-describedby="evn-pq-${id}"`}>${esc(t("histGrupoCompartir"))}</button>` +
    `<button class="ghost mini" type="button" data-evento-borrar="${id}">${esc(t("evnBorrar"))}</button>` +
    `</div>` +
    (n ? "" : `<p class="note evn-porque" id="evn-pq-${id}">${esc(t("evnPorQue"))}</p>`) +
    sumarle(ev) +
    (n ? `<details class="evn-detalle"><summary>${esc(t("evnVerLista"))}</summary><ol class="evn-sorteos">${filas}</ol></details>` : "") +
    `</article>`
  );
}

/**
 * Los sorteos sueltos que se le pueden sumar al evento, cada uno con su
 * "Sumar". A la vista en un evento vacío y en el que se está armando; en los
 * demás, plegados.
 */
function sumarle(ev: EventoGuardado): string {
  const n = ev.sorteos.length;
  if (!candidatos.length) return n ? "" : `<p class="note">${esc(t("evnSinSorteos"))}</p>`;
  const muestra = candidatos.slice(0, CANDIDATOS_MAX);
  const abierto = n === 0 || ev.id === activo;
  return (
    `<details class="evn-sumar"${abierto ? " open" : ""}><summary>${esc(t("evnSumarT").replace("{n}", String(candidatos.length)))}</summary>` +
    `<ol class="evn-sorteos">${muestra.map(({ e, i }) => filaParaSumar(ev, e, i)).join("")}</ol>` +
    (candidatos.length > muestra.length ? `<p class="note">${esc(t("evnSumarMas"))}</p>` : "") +
    `</details>`
  );
}

/** Un sorteo suelto que se puede sumar al evento: el premio, la fecha, quién ganó y "Sumar". */
function filaParaSumar(ev: EventoGuardado, e: Entry, i: number): string {
  const titulo = e.prize || t("histDraw");
  const ganadores = e.winners ?? [];
  const quien = `${e.id ? `#${esc(e.id)} · ` : ""}${esc(t(ganadores.length > 1 ? "histWonMany" : "histWon"))} <b>${esc(ganadores.join(", "))}</b>`;
  const nombre = t("evnSumarA").replace("{s}", titulo).replace("{e}", ev.nombre);
  return (
    `<li class="evn-sorteo"><div><b>${esc(titulo)}</b> <span class="hc-fecha">${esc(fmtDate(e.sealedAt))}</span></div>` +
    `<p class="hc-meta">${quien}</p>` +
    `<div class="hc-acciones"><button class="ghost mini" type="button" data-evento-sumar="${esc(`${ev.id}|${i}`)}" aria-label="${esc(nombre)}">${esc(t("evnSumarBtn"))}</button></div></li>`
  );
}

/**
 * Después de sumar o de crear, el foco sigue en el evento: al próximo "Sumar",
 * o a "Compartir el evento" si ya no queda qué sumar, o a la tarjeta.
 */
function enfocarEnEvento(id: string): void {
  const card = document.getElementById(`evn-c-${id}`);
  if (!card) return;
  const sigue =
    card.querySelector<HTMLElement>("[data-evento-sumar]") ??
    card.querySelector<HTMLElement>("[data-evento-compartir]:not([disabled])") ??
    card;
  sigue.focus();
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
    const renombra = f.closest<HTMLFormElement>("form[data-renombrar]");
    if (renombra) {
      e.preventDefault();
      const campo = renombra.querySelector<HTMLInputElement>("input");
      if (campo) guardarNombre(campo, renombra.dataset.renombrar ?? "", true);
      return;
    }
    if (!f.matches("form[data-nuevo]") || !shown) return;
    e.preventDefault();
    const nombre = (f.querySelector("input") as HTMLInputElement).value.trim();
    if (!nombre) {
      avisar(t("evnNombreVacio"));
      paint(shown);
      document.getElementById("evn-nuevo-in")?.focus();
      return;
    }
    const id = nuevoId();
    guardarEventos(network.name, crearEvento(leerEventos(network.name), shown, nombre, id));
    // Lo que sigue es sumarle sorteos: el evento los ofrece adentro, y el formulario se pliega.
    formAbierto = false;
    activo = id;
    avisar(t(candidatos.length ? "evnCreadoSumar" : "evnCreado").replace("{nombre}", nombre));
    paint(shown);
    enfocarEnEvento(id);
  });
  caja.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const suma = el.closest<HTMLButtonElement>("[data-evento-sumar]");
    if (suma) {
      const [id = "", k = ""] = (suma.dataset.eventoSumar ?? "").split("|");
      const fila = pintadas[Number(k)];
      const lista = leerEventos(network.name);
      const ev = lista.find((x) => x.id === id);
      if (!ev || !fila || !compartible(fila) || !shown) return;
      guardarEventos(network.name, sumarAEvento(lista, id, { enlace: fila.proof, ganadores: fila.winners }));
      activo = id;
      avisar(t("evnSumado").replace("{nombre}", ev.nombre));
      paint(shown);
      enfocarEnEvento(id);
      return;
    }
    // "Nuevo evento" despliega el formulario, con el foco en el nombre; otro toque lo vuelve a plegar.
    const nuevo = el.closest<HTMLButtonElement>("[data-evn-nuevo]");
    if (nuevo) {
      formAbierto = !formAbierto;
      const form = document.getElementById("evn-nuevo-f");
      if (form) form.hidden = !formAbierto;
      for (const b of caja.querySelectorAll("[data-evn-nuevo]")) b.setAttribute("aria-expanded", String(formAbierto));
      // Dos botones del color de la casa no dicen cuál es el siguiente: con el formulario abierto, "Crear evento".
      for (const b of document.querySelectorAll<HTMLElement>("#sec-history [data-principal]")) {
        b.classList.toggle("primary", !formAbierto);
        b.classList.toggle("ghost", formAbierto);
      }
      if (formAbierto) document.getElementById("evn-nuevo-in")?.focus();
      return;
    }
    if (el.closest("[data-nombrar-ultimo]")) {
      if (grupoNombrable && shown) nombrarGrupo(shown, grupoNombrable);
      return;
    }
    const compartir = el.closest<HTMLButtonElement>("[data-evento-compartir]");
    if (compartir) {
      const ev = leerEventos(network.name).find((x) => x.id === compartir.dataset.eventoCompartir);
      if (ev) void sorteosDelEvento(ev).then((sorteos) => compartirEvento(ev.nombre, sorteos));
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
  // Al salir del campo con un nombre nuevo, se guarda sin repintar: lo escrito no se pierde aunque no se toque "Guardar".
  caja.addEventListener("change", (e) => {
    const campo = e.target;
    const f = campo instanceof HTMLInputElement ? campo.closest<HTMLFormElement>("form[data-renombrar]") : null;
    if (f && campo instanceof HTMLInputElement) guardarNombre(campo, f.dataset.renombrar ?? "", false);
  });
}

/* ------------------------------------------------------- los enlaces cortos */

// Mis sorteos no ofrece borrar un enlace corto (21 de octubre de 2026): borrarlo
// cortaba la verificación de todos los que ya lo tenían (el grupo de WhatsApp, el
// QR de la foto, el del proyector), podía parecer que se quería esconder un
// resultado y se tocaba sin querer. Si alguien necesita que se borre, lo pide a
// hola@tinkazo.app y lo borra Tinkazo (workers/enlaces/README.md).

function paint(organizer: string | null): void {
  shown = organizer;
  const box = $("sec-history");
  pintarPendiente(organizer ? historyOf(organizer) : []);
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

  // Un sorteo que está en un evento con nombre sigue en la lista, con el nombre
  // de su evento: hasta el 21 de octubre de 2026 se mudaba adentro del evento
  // plegado y, al sumar el último, la lista quedaba vacía y parecía que se
  // habían borrado (evaluación crítica de experiencia, hallazgo 2).
  eventoDelEnlace = new Map<string, EventoGuardado>();
  for (const ev of guardados) for (const s of ev.sorteos) if (!eventoDelEnlace.has(s.enlace)) eventoDelEnlace.set(s.enlace, ev);
  const sueltos = list.filter((e) => !(e.proof && eventoDelEnlace.has(e.proof)));
  // Los sueltos que tienen comprobante se agrupan por fecha en eventos: una
  // cabecera con "Compartir el evento" y, debajo, sus sorteos en el orden de la lista.
  const grupos = agrupar(sueltos);
  eventoDe = new Map<Entry, number>();
  grupos.forEach((g, gi) => g.forEach((e) => eventoDe.set(e, gi)));
  eventosPintados = grupos;
  principal = elegirPrincipal(list, grupos);
  pintarEventos(list, sueltos, grupos);
  const pintados = new Set<number>();
  let html = "";
  list.forEach((e, i) => {
    const gi = eventoDe.get(e);
    if (gi === undefined) {
      html += tarjetaDeSorteo(e, i);
      return;
    }
    if (pintados.has(gi)) return;
    pintados.add(gi);
    const g = grupos[gi] ?? [];
    const enOrden = g.map((x) => ({ x, i: list.indexOf(x) })).sort((a, b) => a.i - b.i);
    html += `<div class="hist-grupo">${cabeceraDeEvento(g, gi)}${enOrden.map(({ x, i: j }) => tarjetaDeSorteo(x, j)).join("")}</div>`;
  });
  $("hist-list").innerHTML = html;
  box.style.display = "block";
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
  if (!hecho && e.names?.length) acciones.push(`<button ${comoPrincipal(`retomar:${i}`)} data-retomar="${i}">${esc(t("histResume"))}</button>`);
  // El comprobante se puede compartir otra vez, con el QR y el mensaje: sale del enlace y de los ganadores.
  const compartible = !!(e.proof && tieneComprobante(e) && e.winners?.length);
  if (compartible) acciones.push(`<button ${comoPrincipal(`compartir:${i}`)} type="button" data-compartir="${i}">${esc(t("cmpBtn"))}</button>`);
  // Sin comprobante pero con id: la lista no está acá, pero el sorteo sí
  // está en la cadena. Con la lista a mano se rearma.
  if (e.proof) acciones.push(`<a class="ghost mini" href="${esc(e.proof)}" target="_blank" rel="noopener">${esc(t("histSeeProof"))}</a>`);
  else if (hecho && e.id) acciones.push(`<button class="ghost mini" data-rearmar="${i}">${esc(t("histRebuild"))}</button>`);
  if (enCadena) acciones.push(`<a class="hc-link" href="${esc(txUrl(enCadena))}" target="_blank" rel="noopener">${esc(t("histOnChain"))} ↗</a>`);
  if (!hecho && !e.names?.length) acciones.push(`<span class="note">${esc(t("histOtherDevice"))}</span>`);
  // Ya en un evento con nombre: lo dice, en vez de ofrecer sumarlo a otro.
  const suEvento = e.proof ? eventoDelEnlace.get(e.proof) : undefined;
  if (compartible && guardados.length && !suEvento) {
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
    (suEvento ? `<p class="hc-en">${esc(t("evnEn").replace("{e}", suEvento.nombre))}</p>` : "") +
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
    `<button ${comoPrincipal(`grupo:${gi}`)} type="button" data-evento="${gi}">${esc(t("histGrupoCompartir"))}</button>` +
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
