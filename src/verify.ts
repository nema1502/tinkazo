// Lo mismo que las páginas de lectura: los estilos, los textos, el tema de
// `?theme=`, la cuenta en la cabecera, el menú, el idioma y el contador. Esta
// página lo hacía a mano y se había quedado sin el tema: con `?theme=light`
// salía oscura igual (evaluador visual, 21 de octubre de 2026).
import "./pagina";
import { $, esc } from "./dom";
import { getLang, onLangChange, texto as t, textos } from "./idioma";
import { SAMPLE, avatar } from "./state";
import { canonicalList, listHash } from "./protocol/canonical";
import { QUICKNET, bytesToHex, fetchRound, roundTime, roundUrl } from "./protocol/quicknet";
import { prepararFirma, verifyRoundAsync } from "./protocol/firma";
import { decodeProof, type Proof } from "./protocol/proof";
import { anclaDe, premioDe, revisarComprobante, type Revision } from "./protocol/verificacion";
import { network, shortAddress, txUrl } from "./stellar/config";
import { crearLectorDeHistorial, type SelloDelHistorial } from "./stellar/historial";
import { leerRegistro } from "./stellar/registro";
import type { ChainHistory, ChainRaffle } from "./stellar/seals";
import { codigoDelSello, detalleDelHistorial, detalleTecnico, porQueNoCuadra, porQueSinHistorial } from "./verificacion-textos";
import { buscar, vecesExacto } from "./buscar";
import { fechaLarga } from "./ui/agrupar";
// Estático, no con import(): así las claves de compartir entran en los textos de esta página.
import { abrirSorteo } from "./ui/compartir";
import { contarApertura, contarVeredicto, quitarMarca, refDe, viaDe } from "./contar";
import { type PropsDe, type Ref, contratoOficial } from "../workers/enlaces/src/conteo";

/**
 * Página de verificación.
 *
 * Solo lectura y sin wallet. Toma el comprobante del fragmento de la URL,
 * rehace el sorteo desde cero y compara. Si el sorteo está anclado, lee el
 * registro del contrato y comprueba que coincida con lo recomputado. Lo que se
 * compara y en qué orden vive en `protocol/verificacion.ts`, el mismo que usa la
 * página de evento: acá solo se cuenta.
 *
 * Todo pasa en el navegador de quien abre el enlace. Los nombres no viajan a
 * ningún servidor: el fragmento de una URL no se envía.
 */

type State = "ok" | "bad" | "pending" | "working";

interface Check {
  key: string;
  state: State;
  detail?: string;
}

const checks: Check[] = [];

// Por dónde llegó (el QR, el enlace corto o el largo), para el contador del
// embudo (src/contar.ts). La marca se saca de la dirección enseguida: si alguien
// copia el enlace de la barra, no viaja con él.
const via = viaDe(location.search);
quitarMarca();
/** La referencia pública del sorteo, si está anclado: sin ella no se cuenta nada. */
let ref: Ref | undefined;

/**
 * Cómo terminó la verificación, para el contador: verde, amarillo, rojo, o que
 * no se pudo terminar. Lo decide la verificación estricta (`src/protocol/verificacion.ts`):
 * su verde ya exige un contrato oficial; un verde de otro contrato, si llegara, se
 * cuenta como rojo (§4.5 de la arquitectura de métricas), y el Worker no cuenta
 * sorteos de otros contratos. Se cuenta lo primero que se le muestra a la persona.
 */
function contarFin(verdict: PropsDe<"proof_verdict">["verdict"]): void {
  if (ref) contarVeredicto(verdict === "green" && !contratoOficial(ref) ? "red" : verdict, ref);
}

function paint(): void {
  $("checks").innerHTML = checks
    .map(
      (c) =>
        `<li class="check ${c.state}"><b>${esc(t(c.key))}</b>${
          c.detail ? `<span class="mono">${esc(c.detail)}</span>` : ""
        }</li>`,
    )
    .join("");
}

/** `detail` puede ser una función: así se vuelve a escribir en el idioma nuevo. */
type Detalle = string | (() => string);
const detalles = new Map<string, Detalle>();

function set(key: string, state: State, detail?: Detalle): void {
  if (detail !== undefined) detalles.set(key, detail);
  const d = detalles.get(key);
  const texto = typeof d === "function" ? d() : d;
  const found = checks.find((c) => c.key === key);
  if (found) {
    found.state = state;
    if (texto !== undefined) found.detail = texto;
  } else {
    checks.push({ key, state, ...(texto !== undefined ? { detail: texto } : {}) });
  }
  paint();
}

/** Vuelve a escribir los detalles que dependen del idioma. */
function repintarDetalles(): void {
  for (const c of checks) {
    const d = detalles.get(c.key);
    if (typeof d === "function") c.detail = d();
  }
  paint();
}

/**
 * Tres veredictos, no dos.
 *
 * `ok` solo cuando algo externo atestigua la lista: el contrato guarda su
 * huella, así que cambiar un nombre se detecta. En modo libre el comprobante
 * trae la lista y la firma juntas, de modo que recomputar siempre cierra: lo
 * honesto es decir que la cuenta está bien pero que nadie atestigua que esa
 * fuera la lista original. Eso es `partial`, y es justo lo que compra anclar.
 */
function verdict(state: "ok" | "partial" | "bad" | "working", titleKey: string, detail: string): void {
  const box = $("verdict");
  box.className = `verdict ${state}`;
  $("verdict-kicker").textContent = t(
    state === "ok"
      ? "vVerdictOkKicker"
      : state === "partial"
        ? "vVerdictPartialKicker"
        : state === "bad"
          ? "vVerdictBadKicker"
          : "vWorkingKicker",
  );
  $("verdict-title").textContent = t(titleKey);
  $("verdict-detail").textContent = detail;
}

function fail(messageKey: string, detail = ""): void {
  verdict("bad", messageKey, detail);
}

/** Lo técnico de un veredicto rojo, plegado debajo de la explicación. */
function pintarTecnico(lineas: string[]): void {
  const caja = $("verdict-tech");
  caja.style.display = lineas.length ? "" : "none";
  $("verdict-tech-body").textContent = lineas.join("\n");
}

/**
 * Lo de afuera que necesita la revisión: el faro, la firma, la cadena y el
 * historial de transacciones. Este último es lo que deja comprobar un sorteo cuando
 * el contrato ya no lo guarda (vence): se pide solo si el comprobante trae el hash
 * de la transacción del sello, y el SDK de Stellar se baja recién entonces.
 */
const DEPENDENCIAS = {
  verificarFirma: verifyRoundAsync,
  traerFirma: async (round: number): Promise<string> => (await fetchRound(round, { attempts: 6, delayMs: 1500 })).signature,
  leerRegistro,
  leerHistorial: crearLectorDeHistorial(),
};

/** El enlace tal como se verificó: compartir manda este, aunque después cambie el fragmento. */
let enlaceVerificado = "";
/** Lo que se está mostrando, para volver a contarlo en otro idioma o cuando llegan los otros sellos. */
let actual: { proof: Proof; r: Revision } | null = null;

async function main(): Promise<void> {
  let proof: Proof | null = null;
  // Los textos, el tema, la cabecera y el idioma ya los puso `pagina.ts`. Las
  // comprobaciones no viven en `data-i`: se repintan al cambiar de idioma.
  onLangChange(() => {
    repintarDetalles();
    if (actual) contar(actual.proof, actual.r);
    pintarSellos();
  });
  // Si el fragmento cambia con la página abierta (un sitio que abrió esta pestaña
  // se lo puede cambiar sin recargarla), lo que se ve ya no es lo que dice el
  // enlace, y "Compartir" mandaba el nuevo con el ganador del viejo: se vuelve a
  // verificar desde cero.
  window.addEventListener("hashchange", () => location.reload());
  enlaceVerificado = location.origin + location.pathname + location.hash;

  try {
    proof = await decodeProof(location.hash);
  } catch {
    fail("vNoProof", t("vNoProofDetail"));
    return;
  }
  // Un comprobante anclado: se abrió. Uno sin anclar (la demo, el modo libre) no es un sorteo y no se cuenta.
  ref = refDe(proof);
  if (ref) contarApertura(via, ref);
  // El worker que verifica la firma se levanta ya: baja la curva mientras se
  // lee la cadena, y el cálculo no traba la página.
  prepararFirma();

  verdict("working", "vWorking", "");
  renderList(proof);

  // El orden de la lista de comprobaciones es el orden en que aparecen.
  const anclado = anclaDe(proof).tipo !== "libre";
  set("vCheckList", "working");
  if (anclado) {
    set("vCheckOfficial", "working");
    set("vCheckChain", "working");
  }
  set("vCheckRound", "working");

  const revision = await revisarComprobante(proof, DEPENDENCIAS, { k: 1 });
  actual = { proof, r: revision };
  pintarComprobaciones(proof, revision);
  contar(proof, revision);
}

/** Cada comprobación, con lo que se vio. */
function pintarComprobaciones(proof: Proof, r: Revision): void {
  const tiene = (...m: Revision["motivos"]): boolean => m.some((x) => r.motivos.includes(x));
  const sello = r.registro?.sello ?? null;
  const resultado = r.registro?.resultado ?? null;
  // El sello de la transacción, si es el testigo porque el contrato ya no guarda el sorteo.
  const delHistorial = r.fuente === "historial" && r.historial?.ok ? r.historial.sello : null;

  // ---------------------------------------------------- 1. la lista y su huella
  // Con registro en la cadena se compara contra el testigo, que es lo que
  // detecta un nombre cambiado. Sin registro, lo único comprobable es que el
  // comprobante no viene deformado, y el veredicto lo dice sin adornos.
  // Anclado y sin el sello leído (ni del contrato ni de su transacción), la lista
  // no se pudo comparar con nada: queda pendiente.
  set(
    "vCheckList",
    tiene("lista-deforme", "lista-cambiada", "cantidad") ? "bad" : r.ancla.tipo !== "libre" && !sello && !delHistorial ? "pending" : "ok",
    `${r.nombres.length} · ${r.huella.slice(0, 16)}…`,
  );
  $("v-hash").textContent = `list_hash = ${r.huella}`;

  // --------------------------------------- 2. de quién es el registro, y qué dice
  if (r.ancla.tipo !== "libre") {
    const contrato = typeof proof.contract === "string" ? shortAddress(proof.contract) : "—";
    if (r.ancla.tipo === "deforme") set("vCheckOfficial", "bad", () => t("vAnchorBrokenShort"));
    else if (r.ancla.tipo === "ajeno" || tiene("codigo-ajeno", "contrato-ajeno")) {
      set("vCheckOfficial", "bad", () => `${contrato} · ${t("vNotOfficialShort")}`);
    } else if (r.registro?.wasm) set("vCheckOfficial", "ok", `${contrato} · ${r.registro.wasm.slice(0, 12)}…`);
    // Sin el contrato en la cadena no se lee su código: queda la dirección, que es de la lista oficial.
    else if (delHistorial) set("vCheckOfficial", "ok", () => `${contrato} · ${t("vOfficialAddress")}`);
    else set("vCheckOfficial", "pending", () => `${contrato} · ${t(r.falta === "sin-cadena" ? "vChainUnreachable" : "vChainMissing")}`);

    if (r.ancla.tipo !== "oficial" || tiene("codigo-ajeno")) set("vCheckChain", "bad", () => t("vNotOfficialShort"));
    else if (r.falta === "sin-cadena") {
      // No es que el sorteo no esté anclado: es que no llegamos a leerlo.
      // Confundir las dos cosas acusaría al organizador por culpa del wifi.
      set("vCheckChain", "pending", () => t("vChainUnreachable"));
    } else if (tiene("numero-inexistente")) set("vCheckChain", "bad", () => t("vChainNever"));
    else if (r.falta === "sin-historial") {
      // El contrato ya no guarda el sorteo y el historial no pudo confirmarlo: no es "no está", es "no se pudo".
      set("vCheckChain", "pending", () => t("vChainNotConfirmed"));
    } else if (r.falta === "sin-contrato" || r.falta === "sin-sello" || r.falta === "sin-resultado") {
      // Una red de pruebas borrada, un registro archivado: el contrato contestó, y no lo tiene.
      set("vCheckChain", "bad", () => t("vChainMissing"));
    } else if (tiene("registro-incoherente")) set("vCheckChain", "bad", () => t("vRecordOdd"));
    // El contrato ya no guarda el sorteo y lo respalda su transacción. El número del sorteo no viaja
    // en ella, así que no se afirma: se dice de dónde sale el sello y con qué código se lo reconoce.
    else if (delHistorial) set("vCheckChain", r.motivos.length ? "bad" : "ok", () => `${t("vChainFromHistory")} · ${codigoDelSello(delHistorial)}`);
    else if (sello && !resultado) set("vCheckChain", "pending", () => t("vNotDrawnYet"));
    else set("vCheckChain", r.motivos.length ? "bad" : "ok", `#${proof.id} · ${proof.net}`);

    // La ronda tiene que haber nacido después del sello, con la hora de la cadena.
    const alSellar = sello ? { round: sello.round, en: sello.sealedAt } : delHistorial ? { round: delHistorial.round, en: delHistorial.closedAt } : null;
    if (alSellar) {
      set(
        "vCheckSealedFirst",
        tiene("ronda-temprana") ? "bad" : "ok",
        () => t("vSealedFirstDetail").replace("{s}", String(roundTime(alSellar.round) - alSellar.en)),
      );
    }
  }

  // ------------------------------------------------- 3. la ronda y su firma
  if (r.firma === null) set("vCheckRound", "bad", () => t(r.falta === "sin-ronda" ? "vRoundUnreachable" : "vBadSignature"));
  else {
    const rondaBien = r.firmaOk && !tiene("ronda", "firma-registro");
    set("vCheckRound", rondaBien ? "ok" : "bad", `${proof.round} · ${r.firma.slice(0, 16)}…`);
  }

  // ------------------------------------------------------------ 4. la semilla
  // La semilla se deriva de la firma. Si la firma no era válida, esto no
  // comprueba nada: un visto bueno acá sería inflar la cuenta.
  if (r.semilla !== null) set("vCheckSeed", tiene("semilla", "firma-registro") ? "bad" : "ok", r.semilla.slice(0, 24) + "…");
  else if (r.firma !== null) set("vCheckSeed", "bad");

  // --------------------------------------------- 5. el ganador, recomputado
  if (r.semilla !== null) {
    const bien = r.ganadores.length > 0 && !tiene("ganadores", "lista-deforme", "lista-cambiada", "cantidad");
    set("vCheckWinner", bien ? "ok" : "bad", r.ganadores.map((i) => r.nombres[i]).join(", "));
  }

  // Sin registro externo, la cuenta cierra pero la lista no está atestiguada.
  if (!r.motivos.length && (r.veredicto === "libre" || r.veredicto === "falta")) set("vCheckWitness", "pending", () => t("vNoWitnessShort"));
}

let contado = false;

/**
 * El texto que se sella cuando no se escribe premio: no es un premio. Entre
 * comillas a propósito: así entra en los textos de esta página (`vite.config.ts`
 * junta las claves que el código nombra entre comillas). Como `textos("es").defaultMeta`
 * no entraba, y un sorteo sin premio salía "Se lleva: Sorteo de comunidad".
 */
const META_POR_DEFECTO = "defaultMeta";

/** La hora de un instante (segundos), en el idioma de la página. */
const hora = (s: number): string =>
  new Date(s * 1000).toLocaleTimeString(getLang() === "es" ? "es-BO" : "en-US", { hour: "2-digit", minute: "2-digit" });

/**
 * El rótulo de arriba de las comprobaciones: la red y cómo se reconoce el sorteo. Con el sello que
 * sale del historial, el número del enlace no se comprueba (la transacción no lo trae y el mismo sello
 * pasa con cualquier número): el sorteo se reconoce por el código del sello, junto con la fecha en que
 * cerró, y el número va aparte, en lo técnico, como el que figura en el comprobante.
 */
function pintarIdentidad(proof: Proof, delHistorial: SelloDelHistorial | null): void {
  if (!delHistorial) return;
  $("v-net").textContent = `${String(proof.net ?? "")} · ${t("vSelloCodigo").replace("{c}", codigoDelSello(delHistorial))}`;
}

/** El veredicto, el resultado y lo que se puede hacer. Se vuelve a llamar al cambiar de idioma. */
function contar(proof: Proof, r: Revision): void {
  const primeraVez = !contado;
  contado = true;
  const sello = r.registro?.sello ?? null;
  // El sello de la transacción, si es el testigo porque el contrato ya no guarda el sorteo.
  const delHistorial = r.fuente === "historial" && r.historial?.ok ? r.historial.sello : null;
  pintarTecnico([]);
  pintarIdentidad(proof, delHistorial);
  // La lista se llama "sellada" solo si la cadena atestiguó que lo es.
  const atestiguado = r.veredicto === "verde" || r.veredicto === "pendiente";
  const cabeza = $("v-list-h");
  cabeza.dataset.i = atestiguado ? "vList" : "vListLink";
  cabeza.textContent = t(cabeza.dataset.i);
  // Los pasos se muestran siempre que haya semilla: son los que dejan rehacer la
  // cuenta a mano y ver dónde se rompe. La tarjeta de ganador, en cambio, solo si cuadra.
  if (r.semilla !== null && primeraVez) renderSteps(r.ronda, r.huella, r.semilla, r.nombres.length, r.ganadores);

  if (r.veredicto === "mal") {
    // Nunca un ganador sobre un veredicto rojo: esa tarjeta se saca de pantalla
    // y se comparte, y sería indistinguible de la de un sorteo de verdad.
    const { titulo, detalle } = porQueNoCuadra(r);
    fail(titulo, t(detalle));
    if (primeraVez) contarFin("red");
    pintarTecnico(detalleTecnico(r, proof));
    return;
  }

  if (r.veredicto === "falta") {
    // Dice estar en la cadena y la cadena no lo tiene, y no hay a quién preguntar más (el
    // comprobante no trae el hash del sello): la cuenta cierra, pero nadie atestigua la lista.
    // Sin tarjeta de ganador, que se comparte sola. Con el hash del sello y el historial
    // que no contesta no se llega acá: eso es "no pude comprobarlo" (`sin-red`).
    verdict("partial", "vVerdictMissing", t("vVerdictMissingDetail"));
    if (primeraVez) contarFin("yellow");
    return;
  }

  if (r.veredicto === "sin-red") {
    if (r.falta === "sin-ronda") {
      // Sin la ronda no hay ganador que mostrar. Si todavía no salió, se dice a
      // qué hora sale; si salió y no llega, es la conexión. Ninguna de las dos
      // cosas es culpa del organizador: nada de "Algo no cuadra".
      const sale = roundTime(r.ronda);
      if (Number.isFinite(sale) && sale > Math.floor(Date.now() / 1000)) {
        verdict("partial", "vVerdictWaiting", t("vVerdictWaitingDetail").replace("{h}", hora(sale)));
        if (primeraVez) contarFin("yellow");
      } else {
        verdict("working", "vCannotFinish", t("vRoundUnreachable"));
        if (primeraVez) contarFin("error");
      }
      return;
    }
    // El contrato ya no guarda el sorteo y el historial de transacciones no pudo confirmarlo (sin
    // red, una respuesta rara, una fuente que ya no guarda algo tan antiguo o que no conoce la
    // transacción). Se dice por qué, en simple, y que eso no prueba que el sorteo no exista.
    if (r.falta === "sin-historial") {
      verdict("working", "vVerdictUnknown", t(porQueSinHistorial(r)));
      return;
    }
    // Dice estar anclado y no se pudo leer la cadena. No se le imputa nada al
    // organizador, pero tampoco se muestra un ganador que nadie atestiguó: con la
    // red cortada (el wifi del evento), un comprobante inventado salía con su
    // tarjeta, su premio y el botón de compartir (escépticos, 22 de octubre de 2026).
    verdict("working", "vVerdictUnknown", t("vVerdictUnknownDetail"));
    if (primeraVez) contarFin("error");
    return;
  }

  if (r.firma === null || r.semilla === null) {
    fail("vCannotFinish", t("vRoundUnreachable"));
    if (primeraVez) contarFin("error");
    return;
  }

  // Lo que se muestra del sorteo sale del sello cuando se leyó: el premio y la
  // fecha del enlace se pueden cambiar a mano (QA del 16 de octubre de 2026: un
  // comprobante verde decía "Se lleva: un auto 0 km"). El número del sorteo y la
  // red van en la foto solo si la cadena los atestiguó; con el sello del historial, el
  // número no viaja en la transacción y no se afirma (la red sí: es la de su hash).
  const porDefecto = (["es", "en"] as const).map((l) => textos(l)[META_POR_DEFECTO]).filter((x): x is string => typeof x === "string");
  const premio = premioDe(r, proof.prize, porDefecto);
  const fecha = sello?.sealedAt ?? delHistorial?.closedAt ?? (r.veredicto === "libre" ? proof.sealedAt : undefined);
  if (primeraVez) {
    renderResult(proof, r, premio, {
      fromChain: r.veredicto === "verde",
      ...(fecha ? { fecha } : {}),
      ...(atestiguado && proof.id && proof.net && !delHistorial ? { numero: proof.id, red: proof.net } : {}),
      ...(delHistorial && proof.net ? { red: proof.net } : {}),
    });
    // Los otros sellos se traen al final y sin bloquear. Si muestran la misma
    // lista sellada más de una vez, el verde baja a amarillo (`pintarSellos`).
    // Con el sello del historial no se traen: se leen del estado del contrato, que ya no
    // tiene este sorteo, y "hay uno solo" sin haber podido mirar sería peor que callar.
    if (atestiguado && !delHistorial) void cargarSellos(proof);
    if (r.veredicto === "pendiente") offerToFinish(proof, r);
  }

  if (r.veredicto === "verde") {
    if (sellosRepetidos) verdict("partial", "vVerdictSealedAgain", t("vVerdictSealedAgainDetail"));
    else if (delHistorial) {
      // El contrato ya no guarda el sorteo: lo respalda la transacción del sello, en el historial
      // público. Lo técnico (cuál, en qué ledger) va plegado debajo.
      verdict(
        "ok",
        "vVerdictOkChain",
        t(proof.net === "testnet" ? "vVerdictOkHistoryDetailTest" : "vVerdictOkHistoryDetail")
          .replace("{f}", fechaLarga(delHistorial.closedAt, getLang()))
          .replace("{c}", codigoDelSello(delHistorial)),
      );
      pintarTecnico(detalleDelHistorial(r, proof));
    }
    // En testnet se dice: Stellar la borra entera el 16 de diciembre de 2026.
    else verdict("ok", "vVerdictOkChain", t(proof.net === "testnet" ? "vVerdictOkChainDetailTest" : "vVerdictOkChainDetail"));
    if (primeraVez) contarFin(sellosRepetidos ? "yellow" : "green");
  } else if (r.veredicto === "pendiente") {
    verdict("partial", "vVerdictPending", t("vVerdictPendingDetail"));
    if (primeraVez) contarFin("yellow");
  } else {
    // Sin registro externo, la cuenta cierra pero la lista no está atestiguada.
    verdict("partial", "vVerdictPartial", t("vVerdictPartialDetail"));
    if (primeraVez) contarFin("yellow");
  }
}

/** Cuántos sellos se listan como mucho. Los que repiten la lista entran siempre. */
const SEALS_SHOWN = 100;

/** Los otros sellos que se leyeron, para volver a pintarlos en otro idioma. */
let sellos: { proof: Proof; found: ChainHistory } | null = null;
/** La misma lista, sellada más de una vez (por la misma cuenta o por otra): el verde baja a amarillo. */
let sellosRepetidos = false;

/**
 * Trae todos los sellos del mismo organizador que siguen en la cadena.
 *
 * Es la defensa contra el único ataque conocido que sigue abierto: sellar la
 * misma lista varias veces y publicar solo el resultado que conviene. La
 * defensa siempre existió ·los sellos son públicos· pero dependía de saber
 * buscarlos en un explorador, y eso no es una defensa. Acá están al lado del
 * veredicto, y la señal fuerte se marca sola: otro sello con la misma huella
 * de lista que este.
 *
 * No afirma nada que no pueda comprobar. Si el RPC no contesta, la sección no
 * aparece: decir "hay uno solo" sin haber podido mirar sería peor que callar.
 * Solo se llama con un contrato oficial (`contar`): de uno ajeno no se lee nada.
 */
async function cargarSellos(proof: Proof): Promise<void> {
  try {
    const { sealsOf } = await import("./stellar/seals");
    const found = await sealsOf(proof);
    if (!found || found.raffles.length === 0) return;
    sellos = { proof, found };
    pintarSellos();
  } catch {
    /* sin RPC no se muestra nada: callar es más honesto que suponer */
  }
}

/** Pinta los otros sellos. Se vuelve a llamar al cambiar de idioma: antes el aviso volvía al texto por defecto. */
function pintarSellos(): void {
  if (!sellos) return;
  const { proof, found } = sellos;
  const box = $("sec-seals");
  const mine = String(proof.id ?? "");
  const self = found.raffles.find((r) => r.id === mine);
  // La lista de ejemplo la sella cualquiera que prueba el sitio con su
  // cuenta: que se repita no dice nada, y alarmar por eso sería mentir.
  const ejemplo = bytesToHex(listHash(canonicalList(SAMPLE.join("\n"))));
  if (self && self.listHash === ejemplo) {
    $("v-seals-since").textContent = t("vSealsAll");
    $("v-seals-list").innerHTML = "";
    $("v-seals-why").textContent = t("vSealsEjemplo");
    box.style.display = "block";
    return;
  }
  // Dos señales, de distinta fuerza. La misma huella es la misma lista con
  // el mismo orden: no tiene otra lectura. La misma cantidad de gente es más
  // débil, porque puede ser otro sorteo del mismo evento, pero es también lo
  // que queda si alguien reordena los nombres para cambiar la huella: el
  // protocolo no ordena la lista (protocolo.md §1), así que eso alcanza.
  const again = (id: string, listHash: string): boolean => !!self && id !== mine && listHash === self.listHash;
  const sameCount = (id: string, listHash: string, count: number): boolean =>
    !!self && id !== mine && listHash !== self.listHash && count === self.count;
  const flagged = (r: { id: string; listHash: string; count: number }): boolean =>
    again(r.id, r.listHash) || sameCount(r.id, r.listHash, r.count);
  const shown = found.raffles.filter((r, i) => i < SEALS_SHOWN || r.id === mine || flagged(r));
  const repeats = found.raffles.filter((r) => again(r.id, r.listHash)).length;
  const alike = found.raffles.filter((r) => sameCount(r.id, r.listHash, r.count)).length;

  $("v-seals-since").textContent =
    found.truncated || shown.length < found.raffles.length ? t("vSealsMany") : t("vSealsAll");
  // La misma lista, sellada por otra cuenta: va primero y en rojo. Después, otra
  // cuenta con la misma cantidad de gente casi a la misma hora: la misma jugada
  // con la lista reordenada.
  const fuera = found.elsewhere ?? [];
  const cerca = found.cercanos ?? [];
  const ajena = (r: ChainRaffle, clave: string, fuerte: boolean): string =>
    `<p class="entity" style="font-weight:800${fuerte ? ";color:var(--magenta-ink)" : ""}">⚠ #${esc(r.id)} · ${esc(t(clave))} · ` +
    `${esc(r.organizer.slice(0, 4))}…${esc(r.organizer.slice(-4))} · ${esc(t("vSealsRound"))} ${r.round}</p>`;
  const fueraHtml = fuera.map((r) => ajena(r, "vSealsElsewhere", true)).join("") + cerca.map((r) => ajena(r, "vSealsNear", false)).join("");
  $("v-seals-list").innerHTML = fueraHtml + shown
    .map((r) => {
      const yo = r.id === mine;
      const rep = again(r.id, r.listHash);
      const like = sameCount(r.id, r.listHash, r.count);
      const when = r.sealedAt
        ? new Date(r.sealedAt * 1000).toLocaleString(getLang() === "es" ? "es-BO" : "en-US")
        : "";
      const mark = rep ? ` · ⚠ ${esc(t("vSealsAgain"))}` : like ? ` · ${esc(t("vSealsSameCount"))}` : "";
      return (
        `<p class="entity"${yo || rep ? ' style="font-weight:800"' : ""}>` +
        `#${esc(r.id)}${yo ? ` · ${esc(t("vSealsThis"))}` : ""}${mark} · ` +
        `${r.count} ${esc(t("vSealsPeople"))} · ${esc(t("vSealsRound"))} ${r.round} · ` +
        `${esc(when)} · ${esc(r.listHash.slice(0, 16))}…</p>`
      );
    })
    .join("");
  // Con un solo sello no hay nada que sospechar, y conviene decirlo. Y si la
  // lista se repite, eso va primero.
  $("v-seals-why").textContent = fuera.length
    ? t("vSealsElsewhereWhy")
    : repeats
    ? t("vSealsAgainWhy")
    : cerca.length
      ? t("vSealsNearWhy")
      : alike
        ? t("vSealsSameCountWhy")
        : found.raffles.length > 1
          ? t("vSealsWhy")
          : t("vSealsOnly");
  box.style.display = "block";
  // La misma lista sellada otra vez es la forma directa de quedarse con el
  // resultado que conviene: el verde no puede quedar como si nada.
  if ((fuera.length || repeats) && !sellosRepetidos) {
    sellosRepetidos = true;
    if (actual) contar(actual.proof, actual.r);
  }
}

/**
 * Un sorteo puede quedar sellado sin sortear si al organizador se le cortó la
 * luz a mitad del evento. `draw` no pide permiso a nadie, así que cualquiera
 * que abra el comprobante puede cerrarlo, y el resultado es el mismo: lo fija
 * la ronda del faro, no quien apriete el botón.
 */
function offerToFinish(proof: Proof, r: Revision): void {
  // Solo si el sorteo es del contrato con el que habla este sitio: el botón
  // sortea en `network.contractId`, y con otro contrato (uno anterior, otra red)
  // cerraría otro sorteo con el mismo número.
  if (r.ancla.tipo !== "oficial") return;
  if (r.ancla.contrato.red !== network.name || r.ancla.contrato.contractId !== network.contractId) return;
  if (roundTime(r.ronda) > Math.floor(Date.now() / 1000)) return;

  const box = $("finish-box");
  const btn = $<HTMLButtonElement>("btn-finish");
  const note = $("finish-note");
  box.style.display = "flex";

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const [{ guestAvailable, guestWallet, freighterInstalled, freighterWallet, setActiveWallet }, anchor, drand] =
        await Promise.all([
          import("./stellar/wallet"),
          import("./ui/anchor"),
          import("./protocol/drand"),
        ]);
      // Con quién pagar el fee: la wallet del navegador si está, y si no, una
      // cuenta de prueba que el navegador arma en el momento.
      const wallet = (await freighterInstalled())
        ? freighterWallet
        : guestAvailable()
          ? guestWallet
          : null;
      if (!wallet) {
        note.textContent = t("vFinishNoWallet");
        btn.disabled = false;
        return;
      }
      note.textContent = t("connecting");
      await wallet.connect();
      setActiveWallet(wallet);

      note.textContent = t("fetching");
      const { signature } = await drand.fetchRound(r.ronda, { attempts: 8, delayMs: 1500 });
      await anchor.drawOnChain(BigInt(proof.id as string), drand.decompressG1(signature), (step) => {
        note.textContent = anchor.stepLabel(step);
      });
      note.textContent = t("vFinishDone");
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      btn.disabled = false;
      const { anchorErrorText } = await import("./ui/anchor");
      note.textContent = await anchorErrorText(e);
    }
  });
}

function renderList(proof: Proof): void {
  const names = Array.isArray(proof.names) ? proof.names.map(String) : [];
  $("v-count").textContent = `${names.length} ${t("kEntries")}`;
  $("v-names").innerHTML = names
    .map((n, i) => `<i data-p="${i + 1}"><img src="${avatar(n, 44)}" alt="" loading="lazy" />${esc(n)}</i>`)
    .join("");
  // Cada uno se busca: "estás en el puesto 37 de 120". El que está dos veces
  // o el que falta se descubre solo, que es la defensa contra inflar la lista.
  const input = $<HTMLInputElement>("v-buscar");
  const buscarAhora = (): void => {
    const q = input.value;
    const out = $("v-buscar-out");
    document.querySelectorAll("#v-names i.match").forEach((el) => el.classList.remove("match"));
    if (!q.trim()) {
      out.textContent = "";
      return;
    }
    const puestos = buscar(names, q);
    for (const p of puestos) document.querySelector(`#v-names i[data-p="${p}"]`)?.classList.add("match");
    if (!puestos.length) {
      out.textContent = t("buscateNada");
      return;
    }
    let texto =
      puestos.length === 1
        ? t("buscateUno").replace("{p}", String(puestos[0])).replace("{n}", String(names.length))
        : t("buscateVarios").replace("{k}", String(puestos.length)).replace("{p}", puestos.slice(0, 12).join(", "));
    const exacto = vecesExacto(names, q);
    if (exacto > 1) texto += t("buscateDos").replace("{k}", String(exacto));
    out.textContent = texto;
  };
  input.addEventListener("input", buscarAhora);
  // Lo que dice el enlace, tal cual: si no es de Tinkazo, lo dice el veredicto.
  $("v-net").textContent = anclaDe(proof).tipo !== "libre" ? `${String(proof.net ?? "")} · #${String(proof.id ?? "")}` : t("noAnchor");
}

function renderResult(
  proof: Proof,
  r: Revision,
  premio: string,
  extra: { fromChain: boolean; fecha?: number; numero?: string; red?: string },
): void {
  const names = r.nombres;
  const winners = r.ganadores;
  const signature = r.firma ?? "";
  const randomness = r.semilla ?? "";
  $("sec-result").style.display = "block";
  $("v-round").textContent = `${t("seed")} ${r.ronda}`;
  $("v-winners").innerHTML = winners
    .map((i) => {
      const name = names[i] ?? "";
      return `<div class="winner-card">
        <img src="${avatar(name, 128)}" alt="" />
        <div>
          <p class="winner-name">${esc(name)}</p>
          ${premio ? `<p class="winner-prize">${esc(t("winsPrize"))} ${esc(premio)}</p>` : ""}
        </div>
      </div>`;
    })
    .join(" ");
  $("v-proof").textContent =
    `round=${r.ronda} · signature=${signature.slice(0, 20)}… · randomness=${randomness.slice(0, 20)}… · winners=[${winners.join(",")}]${extra.fromChain ? " · on-chain ✓" : ""}`;
  $<HTMLAnchorElement>("v-drand").href = roundUrl(r.ronda);
  // Compartir otra vez: el enlace de esta página es el comprobante, tal como llegó
  // (sin la consulta: el idioma o el tema de quien lo mira no viajan); el mensaje y
  // la foto salen de lo que la página acaba de rehacer. Si llegó por un enlace
  // corto, ese mismo se vuelve a compartir.
  const compartir = $<HTMLButtonElement>("btn-compartir");
  compartir.style.display = "";
  compartir.onclick = () =>
    abrirSorteo({
      enlace: enlaceVerificado,
      ganadores: winners.map((i) => names[i] ?? ""),
      total: names.length,
      premio,
      ...(extra.fecha ? { fecha: extra.fecha } : {}),
      ...(extra.numero ? { numero: extra.numero } : {}),
      ...(extra.red ? { red: extra.red } : {}),
      // Para el contador, la referencia del sorteo solo si la cadena lo atestiguó (la verificación estricta).
      ...(extra.numero && extra.red ? { ref: refDe(proof) } : {}),
    });
  // El contrato, solo si es uno de Tinkazo: el enlace a uno ajeno sería darle crédito.
  if (r.ancla.tipo === "oficial") {
    const a = $<HTMLAnchorElement>("v-contract");
    a.style.display = "inline-block";
    a.href = `https://stellar.expert/explorer/${r.ancla.contrato.red === "mainnet" ? "public" : "testnet"}/contract/${r.ancla.contrato.contractId}`;
  }
  // La transacción del sello, en el explorador de la red del comprobante: solo si el historial
  // la leyó y es un sello de este sorteo (el enlace a una transacción que nadie comprobó no se da).
  const tx = $<HTMLAnchorElement>("v-tx");
  if (r.ancla.tipo === "oficial" && r.historial?.ok) {
    tx.style.display = "inline-block";
    tx.href = txUrl(r.historial.sello.hash, r.ancla.contrato.red);
  } else {
    tx.style.display = "none";
  }
}

/**
 * Los pasos con los valores concretos, para rehacerlo con otras herramientas.
 *
 * Los comentarios van en el idioma de quien abre el enlace. Los comandos no se
 * traducen: son comandos.
 */
function renderSteps(
  round: number,
  hash: string,
  randomness: string,
  count: number,
  winners: number[],
): void {
  $("v-steps").textContent = [
    `# 1. ${t("vStep1")}`,
    `printf '%s' "$(cat lista.txt)" | sha256sum`,
    `  → ${hash}`,
    ``,
    `# 2. ${t("vStep2")}`,
    `curl ${QUICKNET.relays[0]}/v2/chains/${QUICKNET.chainHash}/rounds/${round}`,
    `  ${t("vStepPublished")} ${new Date(roundTime(round) * 1000).toISOString()}`,
    ``,
    `# 3. ${t("vStep3")}`,
    `randomness = sha256(${t("vStepSig")})`,
    `  → ${randomness}`,
    ``,
    `# 4. ${t("vStep4")}`,
    `idx = be64(sha256(randomness ‖ list_hash ‖ be32(${t("vStepCounter")}))[0..8]) mod ${count}`,
    `  → [${winners.join(", ")}]`,
  ].join("\n");
}

void main();
