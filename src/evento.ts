import "./pagina";
import { $, esc } from "./dom";
import { getLang, onLangChange, texto as t, textos } from "./idioma";
import { SAMPLE } from "./state";
import { canonicalList, listHash } from "./protocol/canonical";
import { prepararFirma, verifyRoundAsync } from "./protocol/firma";
import { comprobanteDe, type Evento, decodeEvento, type SorteoDelEvento, verificarUrlDe } from "./protocol/evento";
import { esSinSello } from "./protocol/proof";
import { bytesToHex, fetchRound } from "./protocol/quicknet";
import { anclaDe, claveDeNumero, clavesDelSorteo, premioDe, type Registro, revisarComprobante, type Revision } from "./protocol/verificacion";
import { crearLectorDeHistorial } from "./stellar/historial";
import type { ContratoOficial } from "./stellar/oficiales";
import { leerRegistros } from "./stellar/registro";
import type { ChainRaffle } from "./stellar/seals";
import { codigoDelSello, detalleDelHistorial, detalleTecnico, porQueSinHistorial } from "./verificacion-textos";
import { fechaLarga } from "./ui/agrupar";
import { contarAperturaDeEvento, quitarMarca, refDe, viaDe } from "./contar";

/**
 * La página de un evento: varios sorteos del mismo día, en un solo enlace.
 *
 * Todo pasa en el navegador de quien abre el enlace. La lista de cada sorteo
 * viaja en el fragmento, así que no sale a ningún servidor. Cada sorteo se
 * revisa igual que en `verificar.html` (`protocol/verificacion.ts`): se rehace
 * la firma de la ronda pública, el ganador y la huella de la lista, y si dice
 * estar anclado se compara con el registro de un contrato de Tinkazo. Hasta el
 * 22 de octubre de 2026 esta página no leía la cadena: con red, contrato y
 * número le alcanzaba para pintar "Anclado en Stellar" y el verde, y un ancla
 * inventada pasaba.
 *
 * Lo que la cadena no atestigua se muestra como lo que es. El nombre del evento
 * lo escribe quien arma el enlace: va aparte, sin el color del veredicto (antes
 * era el titular verde de la página). Un sorteo repetido en el enlace cuenta
 * una vez. Y los otros sellos de la misma lista que no están en el enlace se
 * avisan, como en verificar: es la defensa contra sellar varias veces y mostrar
 * solo el resultado que conviene.
 */

type Estado = "ok" | "bad" | "sin-red";
/** Lo que dice la cadena de un sorteo. `libre`: no está anclado. */
type EstadoCadena = "ok" | "mal" | "ajeno" | "falta" | "pendiente" | "sin-red" | "libre";

interface Fila {
  lista: Estado;
  firma: Estado;
  ganador: Estado;
  cadena: EstadoCadena;
  /** Rojo: algo no coincide, el ancla no es de Tinkazo o el sorteo ya estaba más arriba en el enlace. */
  mal: boolean;
  r: Revision;
  /** Los ganadores rehechos, por nombre, si no son los que dice el enlace. */
  otrosNombres: string[] | null;
  /** Ya estaba más arriba en el enlace. */
  repetido: boolean;
  /** Otros sellos de la misma lista que no están en el enlace (aviso fuerte). */
  otraVez: ChainRaffle[];
  /** Otra cuenta, la misma cantidad de gente, casi a la misma hora, fuera del enlace (aviso débil). */
  cercanos: ChainRaffle[];
}

let evento: Evento | null = null;
/** La clave del texto que explica por qué no hay evento que mostrar. */
let claveError: string | null = null;
/** Los sorteos que se muestran, en el orden del enlace. */
let entran: SorteoDelEvento[] = [];
let verificar: string[] = [];
let filas: Fila[] = [];
let revisando = true;

// Por dónde llegó (el QR de la foto, el enlace corto o el largo), para el
// contador del embudo (src/contar.ts); la marca sale de la dirección enseguida.
const via = viaDe(location.search);
quitarMarca();

/** El texto que se sella cuando no se escribe premio (entre comillas: así entra en los textos de la página). */
const META_POR_DEFECTO = "defaultMeta";

/** Diez minutos de rondas de quicknet, como en `seals.ts`. */
const RONDAS_CERCANAS = 200;

/**
 * Lo que lee el historial de Stellar, para todo el evento: el mismo hash no se pide dos veces y,
 * si Horizon no contesta, no se espera de nuevo por cada sorteo.
 */
const leerHistorial = crearLectorDeHistorial();

// Cómo se reconoce un sorteo dentro del enlace: `clavesDelSorteo` (protocol/verificacion.ts). Un mismo sello
// citado de dos formas (el hash de afuera de un fee-bump y el de adentro; el estado vivo y la transacción; con
// números inventados distintos cuando lo respalda el historial) comparte alguna clave y cuenta una sola vez.

/**
 * Los registros de todos los sorteos anclados, de a una consulta por contrato.
 * Si la cadena no contesta, la promesa de ese contrato falla y cada sorteo suyo
 * queda "sin conexión", no "no cuadra".
 */
function lectorDeRegistros(sorteos: SorteoDelEvento[]): (c: ContratoOficial, id: string) => Promise<Registro> {
  const porContrato = new Map<string, { contrato: ContratoOficial; ids: string[] }>();
  for (const s of sorteos) {
    const a = anclaDe(s);
    if (a.tipo !== "oficial") continue;
    const clave = `${a.contrato.red}:${a.contrato.contractId}`;
    const g = porContrato.get(clave) ?? { contrato: a.contrato, ids: [] };
    g.ids.push(a.id);
    porContrato.set(clave, g);
  }
  const lecturas = new Map<string, Promise<Map<string, Registro>>>();
  for (const [clave, g] of porContrato) {
    const p = leerRegistros(g.contrato, g.ids);
    // Sin un `catch` acá, una lectura fallida que nadie esperó todavía avisaría como error suelto.
    p.catch(() => {});
    lecturas.set(clave, p);
  }
  return async (c, id) => {
    const p = lecturas.get(`${c.red}:${c.contractId}`);
    const r = p ? (await p).get(id) : undefined;
    if (!r) throw new Error("registro-sin-respuesta");
    return r;
  };
}

/** Rehace un sorteo y lo compara con la cadena, si está anclado. */
async function revisar(s: SorteoDelEvento, leer: (c: ContratoOficial, id: string) => Promise<Registro>): Promise<Fila> {
  const ganadoresDelEnlace = Array.isArray(s.ganadores) ? s.ganadores : [];
  const r = await revisarComprobante(
    comprobanteDe(s),
    {
      verificarFirma: verifyRoundAsync,
      traerFirma: async (round) => (await fetchRound(round, { attempts: 3, delayMs: 1500 })).signature,
      leerRegistro: leer,
      leerHistorial,
    },
    { k: ganadoresDelEnlace.length },
  );
  const tiene = (...m: Revision["motivos"]): boolean => m.some((x) => r.motivos.includes(x));
  const lista: Estado = tiene("lista-deforme", "lista-cambiada", "cantidad") ? "bad" : "ok";
  const firma: Estado =
    r.firma === null && r.falta === "sin-ronda" ? "sin-red" : r.firmaOk && !tiene("ronda", "ronda-temprana", "firma-registro") ? "ok" : "bad";
  // La semilla sale de la firma: sin firma válida, la selección no prueba nada.
  // Y el ganador que dice el enlace tiene que ser el que sale, con el nombre exacto.
  const rehechos = r.ganadores.map((i) => r.nombres[i] ?? "");
  const mismosNombres = rehechos.length > 0 && JSON.stringify(rehechos) === JSON.stringify(ganadoresDelEnlace);
  const ganador: Estado = firma !== "ok" ? firma : !tiene("semilla", "ganadores") && mismosNombres ? "ok" : "bad";
  const cadena: EstadoCadena =
    r.ancla.tipo === "libre"
      ? "libre"
      : r.ancla.tipo !== "oficial" || tiene("codigo-ajeno", "contrato-retirado")
        ? "ajeno"
        : r.falta === "sin-cadena"
          ? "sin-red"
          : r.motivos.length
            ? "mal"
            : r.veredicto === "falta"
              ? "falta"
              : r.veredicto === "pendiente"
                ? "pendiente"
                : r.veredicto === "verde"
                  ? "ok"
                  : "sin-red";
  const otrosNombres = firma === "ok" && !mismosNombres && !tiene("ganadores") ? rehechos : null;
  return {
    lista,
    firma,
    ganador,
    cadena,
    mal: r.veredicto === "mal" || ganador === "bad",
    r,
    otrosNombres,
    repetido: false,
    otraVez: [],
    cercanos: [],
  };
}

/**
 * Los otros sellos de cada lista del evento, como en verificar (`renderSeals`).
 * Se recorre una vez cada contrato. Si el RPC no contesta no se marca nada:
 * decir "no hay otros" sin haber podido mirar sería peor que callar.
 */
async function buscarOtrosSellos(): Promise<void> {
  const ejemplo = bytesToHex(listHash(canonicalList(SAMPLE.join("\n"))));
  const enElEnlace = new Set(filas.flatMap((f, i) => clavesDelSorteo(entran[i] as SorteoDelEvento, f.r)));
  const porContrato = new Map<string, { contrato: ContratoOficial; filas: Fila[] }>();
  for (const f of filas) {
    const a = f.r.ancla;
    if (a.tipo !== "oficial" || !f.r.registro?.sello || (f.cadena !== "ok" && f.cadena !== "pendiente")) continue;
    const g = porContrato.get(`${a.contrato.red}:${a.contrato.contractId}`) ?? { contrato: a.contrato, filas: [] };
    g.filas.push(f);
    porContrato.set(`${a.contrato.red}:${a.contrato.contractId}`, g);
  }
  if (!porContrato.size) return;
  const { escanearContrato } = await import("./stellar/seals");
  for (const { contrato, filas: deEste } of porContrato.values()) {
    let todos: ChainRaffle[];
    try {
      const e = await escanearContrato(contrato.contractId, contrato.rpcUrl);
      if (!e) continue;
      todos = e.todos;
    } catch {
      continue;
    }
    const fuera = (x: ChainRaffle): boolean => !enElEnlace.has(claveDeNumero(contrato, x.id));
    for (const f of deEste) {
      const sello = f.r.registro?.sello;
      if (!sello || sello.listHash === ejemplo) continue;
      f.otraVez = todos.filter((x) => x.listHash === sello.listHash && x.id !== sello.id && fuera(x));
      f.cercanos = todos.filter(
        (x) =>
          x.organizer !== sello.organizer &&
          x.listHash !== sello.listHash &&
          x.count === sello.count &&
          Math.abs(x.round - sello.round) <= RONDAS_CERCANAS &&
          fuera(x),
      );
    }
  }
}

/** Una línea de "Lo que se comprobó" dentro de un sorteo. */
function fila(etiqueta: string, e: Estado | undefined, detalle: string, mono = false): string {
  const clase = e === "ok" ? "ok" : e === "bad" ? "bad" : e === "sin-red" ? "pending" : "working";
  return `<li class="check ${clase}"><b>${esc(etiqueta)}</b><span${mono ? ' class="mono"' : ""}>${esc(detalle)}</span></li>`;
}

/**
 * La fila de la cadena: su estado en la lista de comprobaciones y lo que dice. `sinHistorial`: el contrato ya
 * no guarda el sorteo y el historial no pudo confirmarlo; no es falta de conexión sin más, y el porqué va en la nota.
 */
function filaCadena(c: EstadoCadena, delHistorial = false, sinHistorial = false): string {
  const estado: Estado | undefined = c === "ok" ? "ok" : c === "mal" || c === "ajeno" || c === "falta" ? "bad" : "sin-red";
  const texto =
    c === "ok"
      ? t(delHistorial ? "evCadenaHistorial" : "evCadenaOk")
      : c === "ajeno"
        ? t("evCadenaAjena")
        : c === "mal"
          ? t("evCadenaMal")
          : c === "falta"
            ? t("evCadenaFalta")
            : c === "pendiente"
              ? t("evCadenaPendiente")
              : t(sinHistorial ? "evCadenaSinHistorial" : "evSinRedCorto");
  return fila(t("evChkCadena"), estado, texto);
}

/** Cada nombre aislado: uno con caracteres que invierten la escritura no da vuelta a los demás. */
const nombresAislados = (nombres: readonly string[]): string => nombres.map((n) => `<bdi>${esc(n)}</bdi>`).join(", ");

function tarjeta(s: SorteoDelEvento, i: number): string {
  const f = filas[i];
  const sello = f?.r.registro?.sello ?? null;
  // El sello de la transacción, si es el testigo porque el contrato ya no guarda el sorteo.
  const delHistorial = f?.r.fuente === "historial" && f.r.historial?.ok ? f.r.historial.sello : null;
  // El premio y la fecha, del sello si se leyó: los del enlace se pueden cambiar a mano.
  const porDefecto = (["es", "en"] as const).map((l) => textos(l)[META_POR_DEFECTO]).filter((x): x is string => typeof x === "string");
  const premioCadena = f ? premioDe(f.r, s.prize, porDefecto) : (s.prize ?? "");
  const premio = premioCadena.trim() ? premioCadena : t("evSinPremio");
  // La fecha del enlace solo en uno sin anclar (lo dice su nota) o mientras se revisa: en uno
  // que dice estar anclado y la cadena no lo atestiguó, sería una fecha que nadie respalda.
  const fecha = sello?.sealedAt ?? delHistorial?.closedAt ?? (!f || f.cadena === "libre" ? s.sealedAt : undefined);
  // El número del sorteo, solo si la cadena lo atestiguó: es el que la sala anotó durante la espera.
  const numero = sello && f && (f.cadena === "ok" || f.cadena === "pendiente") ? ` · #${sello.id}` : "";
  // Con el sello del historial el número no se comprueba: el sorteo se reconoce por la fecha en que cerró
  // y por el código de la transacción del sello. El número del enlace va aparte, en lo técnico.
  const codigo = delHistorial && f && f.cadena === "ok" ? ` · ${t("evSelloCodigo").replace("{c}", codigoDelSello(delHistorial))}` : "";
  const cuando = (fecha ? t("evSellado").replace("{f}", fechaLarga(fecha, getLang())) : "") + numero + codigo;
  const estado = (e: Estado | undefined): string => (e === "ok" ? t("evOk") : e === "bad" ? t("evMalo") : e === "sin-red" ? t("evSinRedCorto") : "");
  const filasHtml = [
    fila(t("evChkLista"), f?.lista, f ? (f.lista === "ok" ? `${f.r.huella.slice(0, 16)}…` : t("evListaMal")) : "", true),
    fila(t("evChkFirma"), f?.firma, estado(f?.firma)),
    fila(t("evChkGanador"), f?.ganador, estado(f?.ganador)),
    ...(f && f.cadena !== "libre" ? [filaCadena(f.cadena, !!delHistorial, f.r.falta === "sin-historial")] : []),
  ];
  const nota = !f
    ? ""
    : f.cadena === "libre"
      ? t("evSinAnclar")
      : f.cadena === "ok"
        ? t(delHistorial ? "evAncladoHistorial" : "evAnclado")
        : f.r.falta === "sin-historial"
          ? t(porQueSinHistorial(f.r))
          : "";
  // Los avisos: el repetido y la misma lista sellada otra vez, en rojo; lo parecido, en gris.
  const avisos = f
    ? [
        ...(f.repetido ? [`<p class="note" style="font-weight:800;color:var(--magenta-ink)">⚠ ${esc(t("evRepetido"))}</p>`] : []),
        ...f.otraVez.map(
          (x) => `<p class="note" style="font-weight:800;color:var(--magenta-ink)">⚠ ${esc(t("evSelloOtraVez").replace("{id}", x.id))}</p>`,
        ),
        ...f.cercanos.map((x) => `<p class="note">${esc(t("evSelloCercano").replace("{id}", x.id))}</p>`),
      ].join("")
    : "";
  // Lo técnico, plegado y en el idioma de ahora: de quién y dónde, y lo que falló.
  const lineas = f ? detalleTecnico(f.r, comprobanteDe(s)) : [];
  if (f?.otrosNombres) {
    lineas.push(t("evTechNombres").replace("{a}", s.ganadores.join(", ") || "—").replace("{b}", f.otrosNombres.join(", ") || "—"));
  }
  if (sello && f?.r.ancla.tipo === "oficial") {
    lineas.unshift(`${f.r.ancla.contrato.red} · ${f.r.ancla.contrato.contractId} · #${sello.id} · ${sello.organizer}`);
  }
  // Lo técnico del verde que salió del historial: la transacción, el ledger y lo que ese camino no revisa.
  if (f?.r.veredicto === "verde") lineas.push(...detalleDelHistorial(f.r, comprobanteDe(s)));
  const tecnico = lineas.length
    ? `<details class="tecnico"><summary>${esc(t("tecnicoT"))}</summary><p class="entity">${lineas.map(esc).join("<br>")}</p></details>`
    : "";
  return (
    `<section class="block ev-sorteo">` +
    `<div class="head"><h2>${esc(premio)}</h2><span class="kicker">${esc(cuando)}</span></div>` +
    `<div class="body">` +
    `<p class="ev-gana"><span class="kicker">${esc(t(s.ganadores.length > 1 ? "evGanaron" : "evGano"))}</span> <b>${nombresAislados(s.ganadores)}</b></p>` +
    `<p class="note">${esc(t("evPersonas").replace("{n}", String(s.names.length)))}</p>` +
    // Un sorteo que se hizo sin sello (el comprobante lo marca) lo dice con la frase, además de su estado de siempre.
    (esSinSello(s) ? `<p class="note sin-sello">${esc(t("redSinSelloEtiqueta"))}</p>` : "") +
    avisos +
    `<ul class="checks">${filasHtml.join("")}</ul>` +
    tecnico +
    (nota ? `<p class="note">${esc(nota)}</p>` : "") +
    `<div class="row"><a class="ghost" href="${esc(verificar[i] ?? "/verificar.html")}" target="_blank" rel="noopener">${esc(t("evVerificar"))} ↗</a></div>` +
    `</div></section>`
  );
}

/** El veredicto de arriba: el color, el rótulo chico, el titular y lo que sigue. */
function veredicto(estado: "ok" | "partial" | "bad" | "working", kicker: string, titulo: string, detalle: string, aviso = ""): void {
  $("ev-veredicto").className = `verdict ${estado}`;
  $("ev-kicker").textContent = t(kicker);
  $("ev-veredicto-t").textContent = t(titulo);
  $("ev-detalle").textContent = detalle;
  const caja = $("ev-aviso");
  caja.textContent = aviso;
  caja.style.display = aviso ? "" : "none";
}

function pintarVeredicto(): void {
  // El titular de la página es el veredicto, siempre. El nombre del evento va en
  // la lista, aparte (`pintarLista`): con el título como titular, un enlace con
  // "✅ Todo cuadra" de título se leía verde aunque la caja dijera que no.
  if (claveError) return veredicto("bad", "evKickerError", "evTituloError", t(claveError));
  if (revisando) {
    const hechos = filas.length;
    return veredicto("working", "evKickerRevisando", "evTituloRevisando", t("evProgreso").replace("{i}", String(hechos)).replace("{n}", String(entran.length)));
  }
  // Varias cuentas en un mismo evento no es un error, pero se dice: el nombre
  // del evento no lo atestigua nadie.
  const cuentas = new Set(filas.map((f) => f.r.registro?.sello?.organizer).filter((x): x is string => !!x));
  const aviso = cuentas.size > 1 ? t("evVariasCuentas").replace("{n}", String(cuentas.size)) : "";
  // El verde exige que cada sorteo esté anclado en un contrato de Tinkazo y
  // coincida con su registro. Lo que no se pudo leer o no está en la cadena es
  // amarillo; lo que no coincide, o dice estar anclado donde no es, rojo.
  if (filas.some((f) => f.mal)) return veredicto("bad", "evKickerMal", "evTituloMal", t("evDetalleMal"), aviso);
  if (filas.some((f) => f.firma === "sin-red" || f.ganador === "sin-red" || f.cadena === "sin-red")) {
    return veredicto("partial", "evKickerSinRed", "evTituloSinRed", t("evDetalleSinRed"), aviso);
  }
  if (filas.some((f) => f.cadena === "libre")) return veredicto("partial", "evKickerParcial", "evTituloParcial", t("evDetalleParcial"), aviso);
  if (filas.some((f) => f.cadena !== "ok")) return veredicto("partial", "evKickerParcial", "evTituloFalta", t("evDetalleFalta"), aviso);
  // La misma lista sellada otra vez, y ese sello no está acá: es la forma de
  // quedarse con el resultado que conviene. El verde no puede quedar como si nada.
  if (filas.some((f) => f.otraVez.length)) return veredicto("partial", "evKickerParcial", "evTituloSellos", t("evDetalleSellos"), aviso);
  const testnet = filas.some((f) => f.r.ancla.tipo === "oficial" && f.r.ancla.contrato.red === "testnet");
  veredicto("ok", "evKickerOk", "evTituloOk", t(testnet ? "evDetalleOkTest" : "evDetalleOk"), aviso);
}

/** La lista de sorteos, con su estado. Antes de revisar, cada uno dice que se está mirando. */
function pintarLista(): void {
  const caja = $("ev-lista-box");
  if (!evento) {
    caja.style.display = "none";
    return;
  }
  // El nombre lo escribió quien armó el enlace: se muestra como eso, no como un titular.
  const nombre = evento.titulo.trim();
  $("ev-titulo").textContent = nombre;
  $("ev-nombre-box").style.display = nombre ? "" : "none";
  document.title = nombre ? `${nombre} · Tinkazo` : "Tinkazo";
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
  // Si el fragmento cambia con la página abierta, lo que se ve ya no es lo del enlace.
  window.addEventListener("hashchange", () => location.reload());
  // La firma de la ronda se verifica en un worker: se levanta ya, mientras se
  // leen los registros y se arman los enlaces de cada sorteo.
  prepararFirma();
  const leer = lectorDeRegistros(entran);
  verificar = await Promise.all(entran.map((s) => verificarUrlDe(s)));
  // Un evento con al menos un sorteo anclado: se abrió. Va sin referencia (son
  // varios sorteos); la del primero solo evita contarlo dos veces en la pestaña.
  const primero = entran.map((s) => refDe(s)).find((r) => r !== undefined);
  if (primero) contarAperturaDeEvento(via, `${primero.net}:${primero.contract}:${primero.id}`);
  pintar();
  const vistos = new Set<string>();
  for (const s of entran) {
    const f = await revisar(s, leer);
    // El mismo sorteo dos veces no son dos sorteos: "3 premios" con uno solo repetido. Se reconoce por
    // cualquiera de sus claves, así que citarlo de otra forma (otro hash del mismo fee-bump, otro número) no lo disimula.
    const claves = clavesDelSorteo(s, f.r);
    if (claves.some((c) => vistos.has(c))) {
      f.repetido = true;
      f.mal = true;
    }
    for (const c of claves) vistos.add(c);
    filas.push(f);
    pintar();
  }
  await buscarOtrosSellos();
  revisando = false;
  pintar();
}

onLangChange(pintar);
void main();
