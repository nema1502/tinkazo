/**
 * Comprobar una transacción contra los archivos públicos de historial de Stellar.
 *
 * Cada cierto tiempo (cada 64 ledgers, unos 5 minutos) los validadores de la red
 * publican un "punto de control" en un archivo de historial: tres categorías de
 * archivos comprimidos, `ledger` (las cabeceras de los 64 ledgers), `transactions`
 * (el conjunto de transacciones de cada ledger) y `results` (sus resultados). Varias
 * organizaciones distintas de la SDF los sirven por HTTP, sin cuenta ni clave.
 *
 * Lo que se comprueba, con una fuente:
 * 1. Cada cabecera lleva el hash declarado, que es el SHA-256 de su XDR, y apunta al
 *    hash de la anterior (`previousLedgerHash`): las 64 cabeceras forman una cadena.
 * 2. El hash de la transacción (SHA-256 de red ‖ tipo de sobre ‖ transacción) es el
 *    de un sobre que está dentro del conjunto de transacciones del ledger, y el
 *    SHA-256 de ese conjunto es el `txSetHash` que la cabecera del ledger lleva.
 * 3. El SHA-256 de los resultados es el `txSetResultHash` de la misma cabecera, y el
 *    resultado de la transacción es un éxito. En un fee bump el sello es la
 *    transacción interior: su hash no está en los resultados, el del sobre de afuera
 *    sí, y adentro viene el resultado de la interior.
 * 4. La hora de cierre sale de la cabecera, no de Horizon. Horizon solo se usa para
 *    saber en qué ledger buscar (y se puede evitar con `ledger`): si miente, la
 *    transacción no aparece en ese ledger y no hay verde.
 *
 * Con varias fuentes: el verde exige que al menos dos organizaciones distintas
 * devuelvan el mismo hash de cabecera para el ledger. Es una confirmación social
 * (para engañar hace falta que se pongan de acuerdo todas las que se consultan), no
 * criptográfica: lo criptográfico serían las firmas SCP del archivo `scp` contra un
 * quórum que uno elija creer, y eso este programa no lo comprueba.
 *
 * Protocolo 30 (votación en testnet el 3-nov-2026 y en mainnet el 23-nov-2026): la
 * cabecera del ledger cambia. Las cabeceras se leen con el XDR del SDK (17.3.0 o
 * posterior) y se exige que al volver a codificarlas den los mismos bytes, así que
 * una cabecera que el SDK no lee entera falla en voz alta y no con un hash falso.
 * PENDIENTE: probar con una cabecera posterior al 3-nov-2026 (la de las pruebas es
 * anterior: ledgerVersion 29).
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { Networks, xdr } from "@stellar/stellar-sdk";

export const FRASES_DE_RED = { testnet: Networks.TESTNET, mainnet: Networks.PUBLIC };
const CATEGORIAS = ["ledger", "transactions", "results"];
const LEDGERS_POR_PUNTO = 64;
// ENVELOPE_TYPE_TX y ENVELOPE_TYPE_TX_FEE_BUMP del XDR de Stellar.
const TIPO_TX = 2;
const TIPO_FEE_BUMP = 5;
const MAX_GZ = 256 * 1024 * 1024;
const MAX_XDR = 1024 * 1024 * 1024;

/** `estado`: "sin-respuesta" (red, HTTP, descarga cortada: no dice nada) o "invalida" (llegó algo y no cuadra: contradice). */
export class ErrorDeArchivo extends Error {
  constructor(estado, mensaje, extra = {}) {
    super(mensaje);
    this.estado = estado;
    Object.assign(this, extra);
  }
}

/* ------------------------------------------------------------------------ utilidades */

const sha256 = (...partes) => {
  const h = crypto.createHash("sha256");
  for (const p of partes) h.update(p);
  return h.digest();
};
/** Los `Hash` del XDR guardan los bytes en `.value`. */
const bytesDe = (v) => (v instanceof Uint8Array ? v : v?.value instanceof Uint8Array ? v.value : v);
export const hex = (v) => Buffer.from(bytesDe(v)).toString("hex");
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** `2026-10-25 13:15:17 UTC` */
export const fechaUtc = (segundos) => `${new Date(segundos * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;

const SEGUNDO_NIVEL = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);
/**
 * A qué organización cuenta una dirección: su dominio registrable (los dos últimos
 * nombres del servidor, tres si el último es de un país y el anterior es `co`,
 * `com`...). Dos réplicas de la misma organización (`stellar-history1.x.com` y
 * `stellar-history2.x.com`) son una sola. Es una regla simple, no un registro de
 * quién opera qué: la independencia de verdad la decide quien elige las fuentes.
 */
export function organizacionDe(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes(":") || /^[\d.]+$/.test(host)) return host;
  const p = host.split(".");
  if (p.length <= 2) return host;
  const ult = p[p.length - 1];
  const pen = p[p.length - 2];
  return p.slice(ult.length === 2 && SEGUNDO_NIVEL.has(pen) ? -3 : -2).join(".");
}

/* ------------------------------------------------------------- punto de control y rutas */

/** El primer punto de control que contiene `ledger`: los ledgers 64k..64k+63 se publican en el 64k+63. */
export function puntoDeControl(ledger) {
  if (!Number.isSafeInteger(ledger) || ledger < 1) throw new RangeError(`ledger inválido: ${ledger}`);
  return ledger - (ledger % LEDGERS_POR_PUNTO) + (LEDGERS_POR_PUNTO - 1);
}

/** `<base>/ledger/00/52/1f/ledger-00521fff.xdr.gz` */
export function rutaDeArchivo(base, categoria, punto) {
  const h = punto.toString(16).padStart(8, "0");
  return `${base.replace(/\/+$/, "")}/${categoria}/${h.slice(0, 2)}/${h.slice(2, 4)}/${h.slice(4, 6)}/${categoria}-${h}.xdr.gz`;
}

/* ------------------------------------------------------------------------- descargas */

async function leerAcotado(res, max) {
  const declarado = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(declarado) && declarado > max) {
    void res.body?.cancel?.().catch?.(() => undefined);
    throw new ErrorDeArchivo("sin-respuesta", `pesa más de ${max} bytes`, { definitivo: true });
  }
  const lector = res.body?.getReader?.();
  if (!lector) {
    const b = Buffer.from(await res.arrayBuffer());
    if (b.length > max) throw new ErrorDeArchivo("sin-respuesta", `pesa más de ${max} bytes`, { definitivo: true });
    return b;
  }
  const trozos = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      void lector.cancel().catch(() => undefined);
      throw new ErrorDeArchivo("sin-respuesta", `pesa más de ${max} bytes`, { definitivo: true });
    }
    trozos.push(value);
  }
  return Buffer.concat(trozos, total);
}

/**
 * Una sesión de descargas: el mismo archivo no se baja dos veces (dos transacciones
 * del mismo punto de control, o una fuente que se repite). `fetch` se puede cambiar
 * para las pruebas.
 */
export function crearSesion({ fetch: f = globalThis.fetch, tiempoMs = 60_000, intentos = 2, esperaMs = 500, maxBytes = MAX_GZ } = {}) {
  const hechas = new Map();
  async function bajarUna(url) {
    let ultimo = new ErrorDeArchivo("sin-respuesta", "sin respuesta");
    for (let i = 0; i < intentos; i++) {
      if (i) await dormir(esperaMs * i);
      try {
        const res = await f(url, { signal: AbortSignal.timeout(tiempoMs) });
        if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 410) {
          void res.body?.cancel?.().catch?.(() => undefined);
          throw new ErrorDeArchivo("sin-respuesta", `HTTP ${res.status}`, { definitivo: true, http: res.status });
        }
        if (!res.ok) {
          void res.body?.cancel?.().catch?.(() => undefined);
          ultimo = new ErrorDeArchivo("sin-respuesta", `HTTP ${res.status}`, { http: res.status });
          continue;
        }
        return await leerAcotado(res, maxBytes);
      } catch (e) {
        if (e instanceof ErrorDeArchivo && e.definitivo) throw e;
        ultimo =
          e instanceof ErrorDeArchivo
            ? e
            : new ErrorDeArchivo("sin-respuesta", e?.name === "TimeoutError" || e?.name === "AbortError" ? "tiempo agotado" : String(e?.cause?.code ?? e?.message ?? e));
      }
    }
    throw ultimo;
  }
  return {
    bajar(url) {
      let p = hechas.get(url);
      if (!p) {
        p = bajarUna(url);
        hechas.set(url, p);
      }
      return p;
    },
  };
}

/**
 * Descomprime un `.xdr.gz`. Si ya llegó descomprimido (un servidor que lo marca como contenido
 * comprimido y `fetch` lo abre), sirve igual, siempre que empiece como un registro (bit alto del
 * largo encendido). Lo demás, una página de error con código 200 por ejemplo, no es un archivo de
 * historial: es una fuente que no contestó, no una que contradice.
 */
export function descomprimir(buf) {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      return zlib.gunzipSync(buf, { maxOutputLength: MAX_XDR });
    } catch (e) {
      throw new ErrorDeArchivo("sin-respuesta", `no se pudo descomprimir (¿descarga cortada?): ${e.message}`);
    }
  }
  if (buf.length >= 4 && (buf[0] & 0x80) !== 0) return buf;
  throw new ErrorDeArchivo("sin-respuesta", "no es un archivo de historial (¿una página de error?)");
}

/** Los registros de un archivo XDR de historial: 4 bytes con el largo (el bit alto es la marca de "último fragmento") y el XDR. */
export function leerRegistros(buf) {
  const out = [];
  let o = 0;
  while (o < buf.length) {
    if (o + 4 > buf.length) throw new ErrorDeArchivo("invalida", "el archivo termina a mitad de un registro");
    const largo = buf.readUInt32BE(o) & 0x7fffffff;
    o += 4;
    if (o + largo > buf.length) throw new ErrorDeArchivo("invalida", "el archivo termina a mitad de un registro");
    out.push(buf.subarray(o, o + largo));
    o += largo;
  }
  return out;
}

/** Decodifica un registro y exige que al volver a codificarlo dé los mismos bytes: así el SDK no descartó nada que no conozca. */
function decodificar(tipo, registro, que) {
  let valor;
  try {
    valor = tipo.fromXDR(registro);
  } catch (e) {
    throw new ErrorDeArchivo(
      "invalida",
      `no se pudo leer ${que} con este SDK de Stellar (¿un protocolo más nuevo? actualizá @stellar/stellar-sdk): ${e.message}`,
    );
  }
  if (!Buffer.from(valor.toXDR()).equals(registro)) {
    throw new ErrorDeArchivo("invalida", `${que} no se vuelve a codificar igual: este SDK de Stellar no la lee entera (¿un protocolo más nuevo?)`);
  }
  return valor;
}

/* ---------------------------------------------------------------------- cabeceras */

/**
 * Una cabecera del archivo `ledger` (hash ‖ cabecera ‖ ext). Devuelve lo que se necesita en hex y números;
 * `hashCalculado` es el SHA-256 de la cabecera, para compararlo con el `hash` que el archivo declara.
 */
export function leerCabecera(registro) {
  const e = decodificar(xdr.LedgerHeaderHistoryEntry, registro, "la cabecera del ledger");
  const h = e.header;
  return {
    ledger: h.ledgerSeq,
    version: h.ledgerVersion,
    hash: hex(e.hash),
    hashCalculado: hex(sha256(h.toXDR())),
    previo: hex(h.previousLedgerHash),
    txSetHash: hex(h.scpValue.txSetHash),
    txSetResultHash: hex(h.txSetResultHash),
    cierre: Number(h.scpValue.closeTime),
  };
}

/** Las cabeceras forman una cadena: hash = SHA-256(cabecera), ledgers seguidos, cada una apunta a la anterior y la hora de cierre no retrocede. */
export function verificarEncadenado(cabeceras) {
  const problemas = [];
  for (let i = 0; i < cabeceras.length; i++) {
    const c = cabeceras[i];
    if (c.hash !== c.hashCalculado) problemas.push(`el hash declarado del ledger ${c.ledger} no es el SHA-256 de su cabecera`);
    if (i === 0) continue;
    const p = cabeceras[i - 1];
    if (c.ledger !== p.ledger + 1) problemas.push(`entre el ledger ${p.ledger} y el ${c.ledger} faltan ledgers`);
    if (c.previo !== p.hash) problemas.push(`la cabecera del ledger ${c.ledger} no apunta al hash de la del ${p.ledger}`);
    // Desde el Protocolo 30 dos ledgers seguidos pueden cerrar en el mismo segundo: la hora puede repetirse, no retroceder.
    if (c.cierre < p.cierre) problemas.push(`la hora de cierre del ledger ${c.ledger} retrocede respecto de la del ${p.ledger}`);
  }
  return { ok: problemas.length === 0, problemas };
}

/* ----------------------------------------------------- sobres, conjuntos y resultados */

export const idDeRed = (frase) => sha256(Buffer.from(frase, "utf8"));

/**
 * Los hashes de un sobre: `externo` es el de la transacción que la red aplica (SHA-256 de
 * id de red ‖ tipo de sobre ‖ transacción) y `interno` es el de la transacción de adentro si
 * es un fee bump (null si no). El sello de un fee bump es la transacción interior.
 */
export function hashesDelSobre(sobre, idRed) {
  switch (sobre.type) {
    case "envelopeTypeTx":
      return { externo: hex(sha256(idRed, u32(TIPO_TX), sobre.v1.tx.toXDR())), interno: null };
    case "envelopeTypeTxFeeBump": {
      const fb = sobre.feeBump.tx;
      return {
        externo: hex(sha256(idRed, u32(TIPO_FEE_BUMP), fb.toXDR())),
        interno: hex(sha256(idRed, u32(TIPO_TX), fb.innerTx.v1.tx.toXDR())),
      };
    }
    // Una transacción V0 se firma como una V1: el XDR de la V0 con la clave pública de la cuenta precedida del tipo de clave (0 = ed25519).
    case "envelopeTypeTxV0":
      return { externo: hex(sha256(idRed, u32(TIPO_TX), u32(0), sobre.v0.tx.toXDR())), interno: null };
    default:
      throw new ErrorDeArchivo("invalida", `tipo de sobre desconocido: ${sobre.type}`);
  }
}

/** Todos los sobres del conjunto de un ledger, en el orden del archivo. */
export function sobresDelConjunto(entrada) {
  const out = [];
  if (entrada.ext.type === "generalizedTxSet") {
    const g = entrada.ext.generalizedTxSet;
    if (g.type !== "v1TxSet") throw new ErrorDeArchivo("invalida", `versión del conjunto de transacciones desconocida: ${g.type}`);
    for (const fase of g.v1TxSet.phases) {
      if (fase.type === "v0Components") {
        for (const c of fase.v0Components) {
          if (c.type !== "txsetCompTxsMaybeDiscountedFee") throw new ErrorDeArchivo("invalida", `componente del conjunto desconocido: ${c.type}`);
          for (const s of c.txsMaybeDiscountedFee.txs) out.push(s);
        }
      } else if (fase.type === "parallelTxsComponent") {
        for (const etapa of fase.parallelTxsComponent.executionStages) for (const grupo of etapa) for (const s of grupo) out.push(s);
      } else {
        throw new ErrorDeArchivo("invalida", `fase del conjunto desconocida: ${fase.type} (¿un protocolo más nuevo? actualizá @stellar/stellar-sdk)`);
      }
    }
  } else if (entrada.ext.type === "v0") {
    for (const s of entrada.txSet.txs) out.push(s);
  } else {
    throw new ErrorDeArchivo("invalida", `tipo de conjunto de transacciones desconocido: ${entrada.ext.type}`);
  }
  return out;
}

/** El hash del conjunto, como lo calcula la red: el SHA-256 del conjunto generalizado, o el del hash anterior y los sobres seguidos. */
export function hashDelConjunto(entrada) {
  if (entrada.ext.type === "generalizedTxSet") return hex(sha256(entrada.ext.generalizedTxSet.toXDR()));
  const ts = entrada.txSet;
  return hex(sha256(bytesDe(ts.previousLedgerHash), ...ts.txs.map((t) => t.toXDR())));
}

/** ¿El resultado de la transacción es un éxito? En un fee bump hace falta además que la interior haya salido bien. */
export function evaluarResultado(par, encontrada) {
  const r = par.result.result;
  if (r.type === "txSuccess") {
    return encontrada.interno ? { ok: false, detalle: "el sobre es un fee bump pero el resultado no lo es" } : { ok: true, detalle: r.type };
  }
  if (r.type === "txFeeBumpInnerSuccess") {
    const ip = r.innerResultPair;
    if (!encontrada.interno || !ip) return { ok: false, detalle: "el resultado es de un fee bump y el sobre no" };
    if (hex(ip.transactionHash) !== encontrada.interno) return { ok: false, detalle: "el resultado interior es de otra transacción" };
    const ri = ip.result.result.type;
    return { ok: ri === "txSuccess", detalle: `${r.type} / ${ri}` };
  }
  return { ok: false, detalle: r.type === "txFeeBumpInnerFailed" ? `${r.type} / ${r.innerResultPair?.result?.result?.type ?? "?"}` : r.type };
}

/* ------------------------------------------------------------------ una fuente */

/**
 * Comprueba la transacción `hash` (hex en minúsculas) en el ledger `ledger` contra una fuente
 * (`{ url, nombre? }`). Nunca lanza: devuelve el resultado con su `estado`.
 */
export async function comprobarEnFuente({ fuente, hash, ledger, frase, sesion }) {
  const t0 = performance.now();
  const base = fuente.url.replace(/\/+$/, "");
  const r = {
    url: base,
    nombre: fuente.nombre ?? base,
    organizacion: organizacionDe(base),
    estado: "ok",
    motivo: "",
    comprobaciones: [],
    ledger,
    punto: 0,
    cierre: 0,
    version: 0,
    hashCabecera: "",
    hashPunto: "",
    hashExterno: "",
    interna: false,
    bytes: 0,
    segundos: 0,
  };
  const comprobar = (nombre, ok, detalle = "") => {
    r.comprobaciones.push({ nombre, ok, detalle });
    if (!ok) throw new ErrorDeArchivo("invalida", `no se cumple: ${nombre}${detalle ? ` (${detalle})` : ""}`);
  };
  try {
    const cp = puntoDeControl(ledger);
    r.punto = cp;
    const archivos = await Promise.all(
      CATEGORIAS.map((c) =>
        sesion.bajar(rutaDeArchivo(base, c, cp)).catch((e) => {
          throw new ErrorDeArchivo(e?.estado ?? "sin-respuesta", `${c}: ${e?.message ?? e}`);
        }),
      ),
    );
    r.bytes = archivos.reduce((n, b) => n + b.length, 0);
    const [regLedger, regTx, regRes] = archivos.map((b) => leerRegistros(descomprimir(b)));

    // 1. Las cabeceras.
    const cabeceras = regLedger.map(leerCabecera);
    const cadena = verificarEncadenado(cabeceras);
    comprobar(`las ${cabeceras.length} cabeceras encadenan (hash = SHA-256 de la cabecera, cada una apunta a la anterior)`, cadena.ok, cadena.problemas[0]);
    const ultima = cabeceras[cabeceras.length - 1];
    const termina = !!ultima && ultima.ledger === cp;
    comprobar("el archivo termina en el punto de control", termina, termina ? "" : `termina en ${ultima?.ledger}, se esperaba ${cp}`);
    const H = cabeceras.find((c) => c.ledger === ledger);
    comprobar("la cabecera del ledger de la transacción está en el archivo", !!H, `ledger ${ledger}`);
    r.cierre = H.cierre;
    r.version = H.version;
    r.hashCabecera = H.hash;
    r.hashPunto = ultima.hash;

    // 2. El conjunto de transacciones y la transacción dentro.
    const regConjunto = regTx.find((x) => x.length >= 4 && x.readUInt32BE(0) === ledger);
    comprobar("el conjunto de transacciones del ledger está en el archivo", !!regConjunto);
    const entrada = decodificar(xdr.TransactionHistoryEntry, regConjunto, "el conjunto de transacciones");
    comprobar(
      "el SHA-256 del conjunto es el txSetHash de la cabecera",
      hashDelConjunto(entrada) === H.txSetHash,
      entrada.ext.type === "generalizedTxSet" ? "conjunto generalizado" : "conjunto clásico",
    );
    if (entrada.ext.type === "generalizedTxSet") {
      comprobar("el conjunto apunta al ledger anterior", hex(entrada.ext.generalizedTxSet.v1TxSet.previousLedgerHash) === H.previo);
    }
    const idRed = idDeRed(frase);
    let encontrada = null;
    let omitidos = 0;
    for (const sobre of sobresDelConjunto(entrada)) {
      let hs;
      try {
        hs = hashesDelSobre(sobre, idRed);
      } catch {
        omitidos++; // un tipo de sobre que no sabemos hashear no puede ser el que buscamos, pero se avisa
        continue;
      }
      if (hs.externo === hash || hs.interno === hash) {
        encontrada = hs;
        break;
      }
    }
    comprobar(
      "un sobre del conjunto tiene el hash de la transacción (SHA-256 de red ‖ tipo ‖ transacción)",
      !!encontrada,
      omitidos ? `${omitidos} sobres de un tipo desconocido no se pudieron mirar` : "",
    );
    r.hashExterno = encontrada.externo;
    r.interna = encontrada.interno === hash;

    // 3. Los resultados.
    const regResultados = regRes.find((x) => x.length >= 4 && x.readUInt32BE(0) === ledger);
    comprobar("los resultados del ledger están en el archivo", !!regResultados);
    const res = decodificar(xdr.TransactionHistoryResultEntry, regResultados, "los resultados del ledger");
    comprobar("el SHA-256 de los resultados es el txSetResultHash de la cabecera", hex(sha256(res.txResultSet.toXDR())) === H.txSetResultHash);
    const par = res.txResultSet.results.find((p) => hex(p.transactionHash) === encontrada.externo);
    comprobar("el resultado de la transacción está entre los resultados", !!par);
    const exito = evaluarResultado(par, encontrada);
    comprobar("la transacción salió bien", exito.ok, exito.detalle);
  } catch (e) {
    r.estado = e instanceof ErrorDeArchivo ? e.estado : "invalida";
    r.motivo = e instanceof ErrorDeArchivo ? e.message : `error inesperado: ${e?.message ?? e}`;
  }
  r.segundos = (performance.now() - t0) / 1000;
  return r;
}

/* ----------------------------------------------------------------------- el veredicto */

/**
 * Qué se concluye de lo que dijo cada fuente. Verde solo con dos o más organizaciones
 * distintas que devuelven el mismo hash de cabecera; con una sola, "una-sola-fuente";
 * si alguna fuente contradice (el archivo llegó y no cuadra) o dos discrepan, no se certifica.
 * `codigo`: 0 verde, 2 una sola fuente, 1 el resto.
 */
export function decidir(resultados) {
  const ok = resultados.filter((r) => r.estado === "ok");
  const invalidas = resultados.filter((r) => r.estado === "invalida");
  if (ok.length === 0) {
    return { veredicto: "falla", codigo: 1, organizaciones: [], motivo: invalidas.length ? "ninguna fuente confirma la transacción" : "ninguna fuente respondió" };
  }
  if (new Set(ok.map((r) => r.hashCabecera)).size > 1 || new Set(ok.map((r) => r.hashPunto)).size > 1) {
    return { veredicto: "discrepan", codigo: 1, organizaciones: [...new Set(ok.map((r) => r.organizacion))], motivo: "las fuentes devuelven cabeceras distintas para el mismo ledger" };
  }
  if (invalidas.length) {
    return {
      veredicto: "discrepan",
      codigo: 1,
      organizaciones: [...new Set(ok.map((r) => r.organizacion))],
      motivo: `${invalidas.map((r) => r.nombre).join(", ")} contradice${invalidas.length > 1 ? "n" : ""} a las que confirman`,
    };
  }
  const organizaciones = [...new Set(ok.map((r) => r.organizacion))];
  return organizaciones.length >= 2
    ? { veredicto: "verde", codigo: 0, organizaciones, motivo: "" }
    : { veredicto: "una-sola-fuente", codigo: 2, organizaciones, motivo: "falta una segunda organización independiente que devuelva la misma cabecera" };
}

/* ------------------------------------------------------------------------ las fuentes */

/** Las fuentes de siempre de una red: `{ fuentes, reserva }`, de `fuentes-historial.json` (una dirección por organización). */
export function fuentesPorDefecto(red, archivo = new URL("./fuentes-historial.json", import.meta.url)) {
  const j = JSON.parse(readFileSync(archivo, "utf8"));
  const r = j.redes?.[red];
  if (!r) throw new Error(`no hay fuentes para la red ${red}`);
  return { fuentes: r.fuentes ?? [], reserva: r.reserva ?? [], actualizado: j.actualizado };
}

/* -------------------------------------------------------------------- Horizon (solo ubica) */

/** En qué ledger dice Horizon que está la transacción. Es una pista para saber qué punto de control bajar: el archivo es el que prueba. */
export async function ubicarEnHorizon({ horizon, hash, fetch: f = globalThis.fetch, tiempoMs = 20_000 }) {
  let res;
  try {
    res = await f(`${horizon.replace(/\/+$/, "")}/transactions/${hash}`, { signal: AbortSignal.timeout(tiempoMs) });
  } catch (e) {
    throw new Error(`no se pudo hablar con Horizon (${horizon}): ${e?.cause?.code ?? e?.message ?? e}. Si sabés el ledger, pasalo con --ledger.`);
  }
  if (res.status === 404) throw new Error(`Horizon no conoce la transacción ${hash} (¿otra red?, ¿muy antigua para su ventana?, ¿todavía no entró?). Si sabés el ledger, pasalo con --ledger.`);
  if (!res.ok) throw new Error(`Horizon contestó HTTP ${res.status}. Si sabés el ledger, pasalo con --ledger.`);
  let j;
  try {
    j = await res.json();
  } catch {
    throw new Error("Horizon contestó algo que no es JSON");
  }
  const cierre = typeof j.created_at === "string" ? Math.floor(Date.parse(j.created_at) / 1000) : NaN;
  if (!Number.isSafeInteger(j.ledger) || j.ledger < 1) throw new Error("Horizon contestó sin el ledger de la transacción");
  return { ledger: j.ledger, cierre: Number.isSafeInteger(cierre) ? cierre : null, exitosa: j.successful === true };
}

/* ---------------------------------------------------------- la transacción, de punta a punta */

/**
 * Comprueba una transacción: ubica el ledger (Horizon, o `ledger` si se lo pasa), consulta las
 * fuentes en paralelo y, si menos de dos responden bien, las de reserva. Devuelve todo lo que
 * hay que mostrar y el veredicto.
 */
export async function verificarTransaccion({ red, hash, fuentes, reserva = [], ledger = null, horizon = null, sesion = crearSesion(), fetch: f = globalThis.fetch }) {
  const frase = FRASES_DE_RED[red];
  if (!frase) throw new Error(`red desconocida: ${red} (testnet o mainnet)`);
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error("el hash de la transacción son 64 caracteres hexadecimales");
  hash = hash.toLowerCase();
  const ubicacion = { origen: "ledger dado", ledger, cierreHorizon: null };
  if (ledger === null) {
    const h = await ubicarEnHorizon({ horizon, hash, fetch: f });
    ubicacion.origen = "Horizon";
    ubicacion.ledger = h.ledger;
    ubicacion.cierreHorizon = h.cierre;
  }
  const consultar = (lista) => Promise.all(lista.map((fuente) => comprobarEnFuente({ fuente, hash, ledger: ubicacion.ledger, frase, sesion })));
  const resultados = await consultar(fuentes);
  const delReserva = [];
  if (resultados.filter((r) => r.estado === "ok").length < 2 && reserva.length) {
    for (const r of await consultar(reserva)) delReserva.push(r);
  }
  const todas = [...resultados, ...delReserva];
  return { red, hash, ledger: ubicacion.ledger, ubicacion, resultados: todas, reserva: delReserva.map((r) => r.url), decision: decidir(todas) };
}

/* ------------------------------------------------------------------- el comprobante */

const SOLO_HEX64 = /^[0-9a-fA-F]{64}$/;

/** Lee `{ red, stx, dtx }` de un comprobante: el enlace de verificación (con su `#z…`/`#r…`), solo el fragmento o el JSON guardado. */
export function leerComprobante(entrada) {
  const texto = String(entrada).trim();
  let obj;
  if (texto.startsWith("{")) {
    obj = JSON.parse(texto);
  } else {
    if (/\/c\/[^/#?]+/.test(texto)) {
      throw new Error("ese es un enlace corto: abrilo en el navegador y guardá el comprobante, o copiá el enlace completo que termina en #z…");
    }
    const i = texto.indexOf("#");
    const fr = i >= 0 ? texto.slice(i + 1) : texto;
    if (/^https?:\/\//i.test(fr) || fr.length < 2) throw new Error("el enlace no trae un comprobante (le falta la parte que empieza con #)");
    const cuerpo = Buffer.from(fr.slice(1), "base64url");
    let json;
    if (fr[0] === "z") json = zlib.inflateRawSync(cuerpo, { maxOutputLength: 16 * 1024 * 1024 });
    else if (fr[0] === "r") json = cuerpo;
    else throw new Error("el comprobante tiene un formato que no conozco (debería empezar con z o r)");
    obj = JSON.parse(json.toString("utf8"));
  }
  const red = obj.net === "mainnet" || obj.net === "public" || obj.net === "pubnet" ? "mainnet" : obj.net === "testnet" ? "testnet" : null;
  const hashDe = (v) => (typeof v === "string" && SOLO_HEX64.test(v) ? v.toLowerCase() : null);
  return { red, stx: hashDe(obj.stx), dtx: hashDe(obj.dtx) };
}
