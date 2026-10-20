import "./pagina";
import { $, esc } from "./dom";
import { getLang, onLangChange, texto as t } from "./idioma";
import { canonicalList, listHash } from "./protocol/canonical";
import { prepararFirma, verifyRoundAsync } from "./protocol/firma";
import { type Evento, decodeEvento, type SorteoDelEvento, verificarUrlDe } from "./protocol/evento";
import { bytesToHex, fetchRound, hexToBytes, randomnessOf } from "./protocol/quicknet";
import { select } from "./protocol/select";
import { isAnchored } from "./protocol/proof";
import { fechaLarga } from "./ui/agrupar";

/**
 * La página de un evento: varios sorteos del mismo día, en un solo enlace.
 *
 * Todo pasa en el navegador de quien abre el enlace. La lista de cada sorteo
 * viaja en el fragmento, así que no sale a ningún servidor. Lo que se puede
 * rehacer sin la cadena se rehace acá: la firma de la ronda pública, el ganador
 * y la huella de la lista. Lo que solo atestigua la cadena se comprueba en el
 * enlace de cada sorteo, que abre `verificar.html`.
 */

type Estado = "ok" | "bad" | "sin-red";

interface Revision {
  lista: Estado;
  firma: Estado;
  ganador: Estado;
  huella: string;
}

let evento: Evento | null = null;
/** La clave del texto que explica por qué no hay evento que mostrar. */
let claveError: string | null = null;
/** Los sorteos que se muestran, en el orden del enlace. */
let entran: SorteoDelEvento[] = [];
let verificar: string[] = [];
let anclado: boolean[] = [];
let revisiones: Revision[] = [];
let revisando = true;

/** Rehace lo que se puede sin la cadena para un sorteo. */
async function revisar(s: SorteoDelEvento): Promise<Revision> {
  const nombres = canonicalList(s.names.join("\n"));
  const lista: Estado = nombres.length === s.names.length ? "ok" : "bad";
  const hash = bytesToHex(listHash(nombres));
  let firma: Estado;
  let sigHex = s.signature ?? "";
  try {
    if (!sigHex) sigHex = (await fetchRound(s.round, { attempts: 3, delayMs: 1500 })).signature;
    firma = (await verifyRoundAsync(s.round, sigHex)) ? "ok" : "bad";
  } catch {
    firma = "sin-red";
  }
  // La semilla sale de la firma: sin firma válida, la selección no prueba nada.
  let ganador: Estado = firma === "ok" ? "bad" : firma;
  if (firma === "ok") {
    try {
      const semilla = bytesToHex(randomnessOf(sigHex));
      const idx = select(hexToBytes(semilla), hexToBytes(hash), nombres.length, s.ganadores.length);
      ganador = JSON.stringify(idx.map((i) => nombres[i])) === JSON.stringify(s.ganadores) ? "ok" : "bad";
    } catch {
      ganador = "bad";
    }
  }
  return { lista, firma, ganador, huella: hash };
}

/** Una línea de "Lo que se comprobó" dentro de un sorteo. */
function fila(etiqueta: string, e: Estado | undefined, detalle: string, mono = false): string {
  const clase = e === "ok" ? "ok" : e === "bad" ? "bad" : e === "sin-red" ? "pending" : "working";
  return `<li class="check ${clase}"><b>${esc(etiqueta)}</b><span${mono ? ' class="mono"' : ""}>${esc(detalle)}</span></li>`;
}

function tarjeta(s: SorteoDelEvento, i: number): string {
  const r = revisiones[i];
  const premio = s.prize?.trim() ? s.prize : t("evSinPremio");
  const cuando = s.sealedAt ? t("evSellado").replace("{f}", fechaLarga(s.sealedAt, getLang())) : "";
  const estado = (e: Estado | undefined): string => (e === "ok" ? t("evOk") : e === "bad" ? t("evMalo") : e === "sin-red" ? t("evSinRedCorto") : "");
  const filas = [
    fila(t("evChkLista"), r?.lista, r ? (r.lista === "ok" ? `${r.huella.slice(0, 16)}…` : t("evListaMal")) : "", true),
    fila(t("evChkFirma"), r?.firma, estado(r?.firma)),
    fila(t("evChkGanador"), r?.ganador, estado(r?.ganador)),
  ];
  return (
    `<section class="block ev-sorteo">` +
    `<div class="head"><h2>${esc(premio)}</h2><span class="kicker">${esc(cuando)}</span></div>` +
    `<div class="body">` +
    `<p class="ev-gana"><span class="kicker">${esc(t(s.ganadores.length > 1 ? "evGanaron" : "evGano"))}</span> <b>${esc(s.ganadores.join(", "))}</b></p>` +
    `<p class="note">${esc(t("evPersonas").replace("{n}", String(s.names.length)))}</p>` +
    `<ul class="checks">${filas.join("")}</ul>` +
    `<p class="note">${esc(anclado[i] ? t("evAnclado") : t("evSinAnclar"))}</p>` +
    `<div class="row"><a class="ghost" href="${esc(verificar[i] ?? "/verificar.html")}" target="_blank" rel="noopener">${esc(t("evVerificar"))} ↗</a></div>` +
    `</div></section>`
  );
}

/** El veredicto de arriba: el color, el rótulo chico, el título y lo que sigue. */
function veredicto(estado: "ok" | "partial" | "bad" | "working", kicker: string, titulo: string, detalle: string): void {
  $("ev-veredicto").className = `verdict ${estado}`;
  $("ev-kicker").textContent = t(kicker);
  $("ev-veredicto-t").textContent = t(titulo);
  $("ev-detalle").textContent = detalle;
}

function pintarVeredicto(): void {
  if (claveError) return veredicto("bad", "evKickerError", "evTituloError", t(claveError));
  if (revisando) {
    const hechos = revisiones.length;
    return veredicto("working", "evKickerRevisando", "evTituloRevisando", t("evProgreso").replace("{i}", String(hechos)).replace("{n}", String(entran.length)));
  }
  const malos = revisiones.some((r) => r.lista === "bad" || r.firma === "bad" || r.ganador === "bad");
  const sinRed = revisiones.some((r) => r.firma === "sin-red" || r.ganador === "sin-red");
  if (malos) return veredicto("bad", "evKickerMal", "evTituloMal", t("evDetalleMal"));
  if (sinRed) return veredicto("partial", "evKickerSinRed", "evTituloSinRed", t("evDetalleSinRed"));
  if (anclado.some((a) => !a)) return veredicto("partial", "evKickerParcial", "evTituloParcial", t("evDetalleParcial"));
  veredicto("ok", "evKickerOk", "evTituloOk", t("evDetalleOk"));
}

/** La lista de sorteos, con su estado. Antes de revisar, cada uno dice que se está mirando. */
function pintarLista(): void {
  const caja = $("ev-lista-box");
  if (!evento) {
    caja.style.display = "none";
    return;
  }
  $("ev-titulo").textContent = evento.titulo;
  document.title = `${evento.titulo} · Tinkazo`;
  $("ev-count").textContent = entran.length === 1 ? t("evUnSorteo") : t("evNSorteos").replace("{n}", String(entran.length));
  $("ev-lista").innerHTML = entran.length ? entran.map((s, i) => tarjeta(s, i)).join("") : `<p class="note">${esc(t("evVacio"))}</p>`;
}

function pintar(): void {
  pintarLista();
  pintarVeredicto();
}

async function main(): Promise<void> {
  let ev: Evento;
  try {
    ev = await decodeEvento(location.hash);
  } catch (e) {
    claveError = e instanceof Error && e.message === "evento-version" ? "evVersion" : "evNoEvento";
    revisando = false;
    pintar();
    return;
  }
  evento = ev;
  entran = ev.sorteos;
  if (entran.length === 0) {
    claveError = "evVacio";
    revisando = false;
    pintar();
    return;
  }
  // La firma de la ronda se verifica en un worker: se levanta ya, mientras se
  // arman los enlaces de cada sorteo.
  prepararFirma();
  verificar = await Promise.all(entran.map((s) => verificarUrlDe(s)));
  anclado = entran.map((s) => isAnchored(s));
  pintar();
  for (const s of entran) {
    revisiones.push(await revisar(s));
    pintar();
  }
  revisando = false;
  pintar();
}

onLangChange(pintar);
void main();
