/**
 * El lector de la cadena: de los eventos del contrato a los números.
 *
 * Esta parte no toca la red (salvo las funciones de `traer*`, que reciben su
 * `fetch`): decodifica eventos y transacciones, los junta en un registro por
 * sorteo y suma. Con los mismos eventos da siempre lo mismo.
 *
 * Qué se cuenta y cómo (todo sale de transacciones que están en la cadena):
 * - Sorteo sellado: un evento `sealed` del contrato (la llamada a `seal` salió bien).
 * - Sorteo registrado: un evento `drawn` (la llamada a `draw` salió bien: el contrato
 *   verificó la firma BLS de drand y guardó los ganadores). Es la "comprobación en
 *   cadena" de cada sorteo. Las aperturas de la página de comprobación no pasan por
 *   la cadena: no están acá.
 * - Lugares en listas: la suma de `count` de los sellos. No son personas únicas.
 * - Organizador: la cuenta que firmó el `seal`.
 * - Cierre sin sortear: sellado sin evento `drawn` y con más de una hora de
 *   sellado al momento del corte.
 *
 * Los días, semanas (lunes a domingo) y meses son UTC, con la hora en que cerró
 * el ledger de la transacción.
 */

import { Address, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";

export const HORA = 3600;

/* ----------------------------------------------------------------- fechas */

const pad = (n) => String(n).padStart(2, "0");

/** `AAAA-MM-DD` (UTC) de un instante en segundos Unix. */
export function dia(seg) {
  const d = new Date(seg * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `AAAA-MM` (UTC). */
export const mes = (seg) => dia(seg).slice(0, 7);

/** El lunes (UTC) de la semana del instante, como `AAAA-MM-DD`: la semana se nombra por su lunes. */
export function semana(seg) {
  const d = new Date(seg * 1000);
  const delLunes = (d.getUTCDay() + 6) % 7;
  return dia(Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - delLunes) / 1000));
}

/* ------------------------------------------------------------ decodificar */

/** El id de un evento (`023897352653787137-0000`) y sus partes: ledger, orden de la transacción y operación. */
export function partesDelId(idEvento) {
  const toid = BigInt(String(idEvento).split("-")[0]);
  return {
    toid,
    ledger: Number(toid >> 32n),
    orden: Number((toid >> 12n) & 0xfffffn),
    operacion: Number(toid & 0xfffn),
    /** El `paging_token` de la transacción en Horizon: el mismo número sin los 12 bits de la operación. */
    toidTransaccion: (toid >> 12n) << 12n,
  };
}

const aHex = (b) => Buffer.from(b).toString("hex");

/**
 * Un registro de la API de eventos de StellarExpert → un evento del contrato.
 * Se decodifica el XDR (`topicsXdr`, `bodyXdr`) y no los campos ya masticados:
 * lo que se cuenta es lo que dice la cadena. Devuelve `null` si no es `sealed` ni `drawn`.
 */
export function decodificarEvento(reg) {
  const temas = (reg.topicsXdr ?? []).map((x) => scValToNative(xdr.ScVal.fromXDR(x, "base64")));
  const cuerpo = scValToNative(xdr.ScVal.fromXDR(reg.bodyXdr, "base64"));
  const tipo = temas[0];
  const base = { eventoId: reg.id, ts: reg.ts, contrato: reg.contract, ...partesDelId(reg.id) };
  const n = (x) => Number(x);
  if (tipo === "sealed") {
    if (temas.length !== 3 || !cuerpo) return null;
    return {
      ...base,
      tipo: "sealed",
      id: n(temas[1]),
      organizador: String(temas[2]),
      count: n(cuerpo.count),
      numWinners: n(cuerpo.num_winners),
      round: n(cuerpo.round),
      listHash: aHex(cuerpo.list_hash),
    };
  }
  if (tipo === "drawn") {
    if (temas.length !== 2 || !cuerpo) return null;
    return {
      ...base,
      tipo: "drawn",
      id: n(temas[1]),
      round: n(cuerpo.round),
      randomness: aHex(cuerpo.randomness),
      ganadores: (cuerpo.winners ?? []).map(n),
    };
  }
  return null;
}

/** El `seal` que lleva el sobre de una transacción, o `null` si no es una llamada a `seal`. Nunca lanza. */
export function decodificarLlamada(envelopeXdr, passphrase) {
  try {
    const tx = TransactionBuilder.fromXDR(envelopeXdr, passphrase);
    const interior = "innerTransaction" in tx ? tx.innerTransaction : tx;
    const op = interior.operations[0];
    if (interior.operations.length !== 1 || !op || op.type !== "invokeHostFunction") return null;
    if (op.func.type !== "hostFunctionTypeInvokeContract") return null;
    const ll = op.func.invokeContract;
    const funcion = ll.functionName.toString();
    const salida = {
      contrato: Address.fromScAddress(ll.contractAddress).toString(),
      funcion,
      hash: aHex(tx.hash()),
      hashInterior: aHex(interior.hash()),
    };
    if (funcion === "seal") {
      const [organizador, listHash, count, numWinners, round, meta] = ll.args.map((a) => scValToNative(a));
      return {
        ...salida,
        organizador: String(organizador),
        listHash: aHex(listHash),
        count: Number(count),
        numWinners: Number(numWinners),
        round: Number(round),
        meta: typeof meta === "string" ? meta : Buffer.from(meta ?? []).toString("utf8"),
      };
    }
    if (funcion === "draw") return { ...salida, id: Number(scValToNative(ll.args[0])) };
    return salida;
  } catch {
    return null;
  }
}

/** Lo que se guarda de una transacción de Horizon: lo mínimo para contar y para volver a comprobarla. */
export function resumirTransaccion(rec, passphrase) {
  const llamada = decodificarLlamada(rec.envelope_xdr, passphrase);
  const cerrado = Math.floor(Date.parse(rec.created_at) / 1000);
  return {
    hash: rec.hash,
    ledger: rec.ledger,
    cerroEn: cerrado,
    exitosa: rec.successful === true,
    comisionStroops: Number(rec.fee_charged),
    cuentaFuente: rec.source_account,
    cuentaQuePaga: rec.fee_account,
    llamada,
  };
}

/* --------------------------------------------------------------- la unión */

/**
 * Junta eventos y transacciones en un registro por sorteo.
 * `txs` es un objeto `{ [eventoId]: resumen }`. Un `drawn` o un `sealed` sin su
 * transacción se cuenta con la hora que dio el índice (`ts`) y se anota en `sinTransaccion`.
 *
 * Devuelve `{ sorteos, problemas }`. `problemas` nombra lo que no cuadra (un id repetido,
 * un `drawn` sin `sealed`, un evento que no coincide con su transacción).
 */
export function unir(eventos, txs = {}) {
  const problemas = [];
  const porClave = new Map();
  const clave = (e) => `${e.contrato}#${e.id}`;
  const ordenados = [...eventos].sort((a, b) => (a.toid < b.toid ? -1 : a.toid > b.toid ? 1 : 0));
  for (const e of ordenados) {
    const tx = txs[e.eventoId];
    const cuando = tx?.cerroEn ?? e.ts;
    if (e.tipo === "sealed") {
      if (porClave.has(clave(e))) {
        problemas.push(`sellado repetido: ${clave(e)}`);
        continue;
      }
      const ll = tx?.llamada;
      if (tx) {
        if (!tx.exitosa || ll?.funcion !== "seal" || ll.contrato !== e.contrato || ll.listHash !== e.listHash || ll.count !== e.count || ll.organizador !== e.organizador) {
          problemas.push(`el sello ${clave(e)} no coincide con su transacción ${tx.hash}`);
        }
      }
      porClave.set(clave(e), {
        contrato: e.contrato,
        id: e.id,
        organizador: e.organizador,
        count: e.count,
        numWinners: e.numWinners,
        round: e.round,
        listHash: e.listHash,
        meta: ll?.meta ?? "",
        selladoEn: cuando,
        selloTx: tx?.hash ?? null,
        selloComision: tx?.comisionStroops ?? 0,
        selloPatrocinado: tx ? tx.cuentaQuePaga !== tx.cuentaFuente : false,
        sorteadoEn: null,
        ganadores: 0,
        sorteoTx: null,
        sorteoComision: 0,
        sorteoPatrocinado: false,
      });
    }
  }
  for (const e of ordenados) {
    if (e.tipo !== "drawn") continue;
    const s = porClave.get(clave(e));
    if (!s) {
      problemas.push(`registro sin sello: ${clave(e)}`);
      continue;
    }
    if (s.sorteadoEn !== null) {
      problemas.push(`registro repetido: ${clave(e)}`);
      continue;
    }
    const tx = txs[e.eventoId];
    if (tx && (!tx.exitosa || tx.llamada?.funcion !== "draw" || tx.llamada.contrato !== e.contrato || tx.llamada.id !== e.id)) {
      problemas.push(`el registro ${clave(e)} no coincide con su transacción ${tx.hash}`);
    }
    s.sorteadoEn = tx?.cerroEn ?? e.ts;
    s.ganadores = e.ganadores.length;
    s.sorteoTx = tx?.hash ?? null;
    s.sorteoComision = tx?.comisionStroops ?? 0;
    s.sorteoPatrocinado = tx ? tx.cuentaQuePaga !== tx.cuentaFuente : false;
  }
  return { sorteos: [...porClave.values()], problemas };
}

/* ---------------------------------------------------------------- sumar */

/** La marca corta del `meta` (`#fila`, `#premios=N`): una convención de presentación, no del protocolo. */
export function marcaDe(meta) {
  const texto = String(meta ?? "");
  return { fila: /(^|\s)#fila(\s|$)/.test(texto), premios: /(^|\s)#premios=\d+(\s|$)/.test(texto) };
}

const mediana = (xs) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
};
const percentil = (xs, p) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.ceil((p / 100) * o.length) - 1)];
};

const periodoVacio = () => ({
  sorteosSellados: 0,
  sorteosRegistrados: 0,
  organizadoresDistintos: 0,
  organizadoresNuevos: 0,
  lugaresEnListas: 0,
  ganadores: 0,
  cierresSinSortear: 0,
  transacciones: 0,
  comisionStroops: 0,
  marcas: { fila: 0, premios: 0, sinMarca: 0 },
});

/** Suma una lista de sorteos por día, semana y mes. `patrocinadas` cuenta las transacciones cuya comisión pagó otra cuenta. */
function sumar(sorteos, ahora) {
  const claves = { dia, semana, mes };
  const series = { dia: {}, semana: {}, mes: {} };
  const organizadores = {}; // d -> { dias:Set, semanas:Set, primero, primerRegistro, sellos }
  const listas = new Map();
  const totales = periodoVacio();
  const periodo = (nivel, seg) => (series[nivel][claves[nivel](seg)] ??= { ...periodoVacio(), _org: new Set(), _marcas: { fila: 0, premios: 0, sinMarca: 0 } });

  const orgsVistas = new Set();
  const porSello = [...sorteos].sort((a, b) => a.selladoEn - b.selladoEn || (a.contrato + a.id < b.contrato + b.id ? -1 : 1));
  let patrocinadas = 0;
  for (const s of porSello) {
    const nuevo = !orgsVistas.has(s.organizador);
    orgsVistas.add(s.organizador);
    const marca = marcaDe(s.meta);
    const sinSortear = s.sorteadoEn === null && ahora - s.selladoEn > HORA;
    const org = (organizadores[s.organizador] ??= { dias: new Set(), semanas: new Set(), primerSello: s.selladoEn, primerRegistro: null });
    org.dias.add(dia(s.selladoEn));
    org.semanas.add(semana(s.selladoEn));
    if (s.sorteadoEn !== null && (org.primerRegistro === null || s.sorteadoEn < org.primerRegistro)) org.primerRegistro = s.sorteadoEn;

    for (const nivel of ["dia", "semana", "mes"]) {
      const p = periodo(nivel, s.selladoEn);
      p.sorteosSellados++;
      p.lugaresEnListas += s.count;
      p._org.add(s.organizador);
      if (nuevo) p.organizadoresNuevos++;
      if (sinSortear) p.cierresSinSortear++;
      if (marca.fila) p._marcas.fila++;
      if (marca.premios) p._marcas.premios++;
      if (!marca.fila && !marca.premios) p._marcas.sinMarca++;
      p.transacciones++;
      p.comisionStroops += s.selloComision;
      if (s.sorteadoEn !== null) {
        // El registro cuenta en el día en que se registró, no en el que se selló.
        const q = periodo(nivel, s.sorteadoEn);
        q.sorteosRegistrados++;
        q.ganadores += s.ganadores;
        q.transacciones++;
        q.comisionStroops += s.sorteoComision;
      }
    }
    totales.sorteosSellados++;
    totales.lugaresEnListas += s.count;
    totales.transacciones++;
    totales.comisionStroops += s.selloComision;
    if (nuevo) totales.organizadoresNuevos++;
    if (sinSortear) totales.cierresSinSortear++;
    if (marca.fila) totales.marcas.fila++;
    if (marca.premios) totales.marcas.premios++;
    if (!marca.fila && !marca.premios) totales.marcas.sinMarca++;
    if (s.sorteadoEn !== null) {
      totales.sorteosRegistrados++;
      totales.ganadores += s.ganadores;
      totales.transacciones++;
      totales.comisionStroops += s.sorteoComision;
    }
    if (s.selloPatrocinado) patrocinadas++;
    if (s.sorteadoEn !== null && s.sorteoPatrocinado) patrocinadas++;

    const l = listas.get(s.listHash) ?? { sellos: 0, organizadores: new Set() };
    l.sellos++;
    l.organizadores.add(s.organizador);
    listas.set(s.listHash, l);
  }

  // Quién vuelve: dentro de cada período para semana y mes, y en toda la historia para el total.
  const diasPorOrg = {};
  const semanasPorOrg = {};
  for (const s of porSello) {
    for (const [nivel, f] of [["semana", semana], ["mes", mes]]) {
      const k = `${nivel}|${f(s.selladoEn)}|${s.organizador}`;
      (diasPorOrg[k] ??= new Set()).add(dia(s.selladoEn));
      (semanasPorOrg[k] ??= new Set()).add(semana(s.selladoEn));
    }
  }
  for (const nivel of ["semana", "mes"]) {
    for (const [nombre, p] of Object.entries(series[nivel])) {
      p.organizadoresQueVuelvenDias = 0;
      p.organizadoresQueVuelvenSemanas = 0;
      for (const d of p._org) {
        const k = `${nivel}|${nombre}|${d}`;
        if ((diasPorOrg[k]?.size ?? 0) >= 2) p.organizadoresQueVuelvenDias++;
        if ((semanasPorOrg[k]?.size ?? 0) >= 2) p.organizadoresQueVuelvenSemanas++;
      }
    }
  }

  const lista = Object.values(organizadores);
  totales.organizadoresDistintos = lista.length;
  totales.organizadoresQueVuelvenDias = lista.filter((o) => o.dias.size >= 2).length;
  totales.organizadoresQueVuelvenSemanas = lista.filter((o) => o.semanas.size >= 2).length;

  // Tiempo del primer sello al primer sorteo registrado de cada cuenta.
  const esperas = lista.filter((o) => o.primerRegistro !== null).map((o) => Math.max(0, o.primerRegistro - o.primerSello));
  const primerSorteo = {
    cuentasConSorteo: esperas.length,
    cuentasSinSorteoTodavia: lista.length - esperas.length,
    medianaSegundos: mediana(esperas),
    p90Segundos: percentil(esperas, 90),
    maximoSegundos: esperas.length ? Math.max(...esperas) : null,
  };

  // La misma lista sellada más de una vez.
  const repetidas = [...listas.values()].filter((l) => l.sellos >= 2);
  const listasRepetidas = {
    listasDistintas: listas.size,
    listasSelladasMasDeUnaVez: repetidas.length,
    sellosEnListasRepetidas: repetidas.reduce((a, l) => a + l.sellos, 0),
    sellosSobrantes: repetidas.reduce((a, l) => a + l.sellos - 1, 0),
    vecesMaxima: repetidas.length ? Math.max(...repetidas.map((l) => l.sellos)) : 0,
    selladasPorMasDeUnaCuenta: repetidas.filter((l) => l.organizadores.size >= 2).length,
  };

  // Cerrar las series: orden por fecha, sin los auxiliares.
  const cerrar = (nivel) => {
    const salida = {};
    for (const k of Object.keys(series[nivel]).sort()) {
      const { _org, _marcas, ...p } = series[nivel][k];
      p.organizadoresDistintos = _org.size;
      p.marcas = _marcas;
      salida[k] = p;
    }
    return salida;
  };
  return {
    totales: { ...totales, patrocinadas, primerSorteo, listasRepetidas },
    porDia: cerrar("dia"),
    porSemana: cerrar("semana"),
    porMes: cerrar("mes"),
  };
}

/**
 * Los números de un conjunto de sorteos, con y sin las cuentas internas.
 *
 * `internas` es el conjunto de direcciones a descontar. `ahora` es el momento del
 * corte (segundos Unix): lo único que no sale de los eventos, y por eso se guarda con
 * ellos. Sin cuentas ni nombres en la salida.
 */
export function calcular(sorteos, { internas = new Set(), ejemplos = new Set(), ahora }) {
  if (!Number.isFinite(ahora)) throw new Error("falta el momento del corte (ahora)");
  const propias = sorteos.filter((s) => internas.has(s.organizador));
  const externas = sorteos.filter((s) => !internas.has(s.organizador));
  const deEjemplo = externas.filter((s) => ejemplos.has(s.listHash));
  return {
    todas: sumar(sorteos, ahora),
    sinInternas: sumar(externas, ahora),
    // Lo que queda sin las cuentas internas y sin los sellos de la lista de ejemplo del sitio, que es lo que sellan
    // las pruebas y los auditores, con una cuenta nueva cada vez. Es una cota de arriba del uso real, no su medida.
    sinInternasNiEjemplo: sumar(externas.filter((s) => !ejemplos.has(s.listHash)), ahora),
    internas: {
      cuentasQueAparecen: new Set(propias.map((s) => s.organizador)).size,
      sorteosSellados: propias.length,
      sorteosRegistrados: propias.filter((s) => s.sorteadoEn !== null).length,
      lugaresEnListas: propias.reduce((a, s) => a + s.count, 0),
    },
    ejemplo: {
      sorteosSellados: deEjemplo.length,
      sorteosRegistrados: deEjemplo.filter((s) => s.sorteadoEn !== null).length,
      organizadoresDistintos: new Set(deEjemplo.map((s) => s.organizador)).size,
      lugaresEnListas: deEjemplo.reduce((a, s) => a + s.count, 0),
    },
  };
}

/* --------------------------------------------------------- red: traer datos */

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** JSON por GET con reintentos para lo pasajero (429, 5xx, cortes). Devuelve `null` en 404. */
export async function pedirJson(url, { fetch: f = fetch, intentos = 8, esperaMs = 800, init } = {}) {
  let ultimo;
  let pausa = 0;
  for (let i = 0; i < intentos; i++) {
    // Los servidores públicos limitan los pedidos: si piden esperar (Retry-After), se espera eso, hasta 30 s.
    if (i) await dormir(Math.min(30_000, Math.max(pausa, esperaMs * 2 ** (i - 1))));
    pausa = 0;
    try {
      const res = await f(url, { signal: AbortSignal.timeout(30_000), ...init });
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500 || res.status === 408) {
        pausa = Number(res.headers?.get?.("retry-after") ?? 0) * 1000 || 0;
        ultimo = new Error(`${url}: HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      ultimo = e;
      if (/HTTP 4\d\d/.test(String(e?.message)) && !/HTTP 408|HTTP 429/.test(String(e?.message))) throw e;
    }
  }
  throw ultimo ?? new Error(`${url}: sin respuesta`);
}

/**
 * Todos los eventos del contrato desde el cursor (excluido), por la API de eventos de StellarExpert,
 * en orden. Es el índice: dice dónde mirar. Lo que se cuenta se comprueba contra Horizon y el contrato.
 */
export async function traerEventos(base, contrato, { desde = null, fetch: f = fetch, limite = 200, alPagina = () => {} } = {}) {
  const todos = [];
  let cursor = desde;
  for (;;) {
    const url = `${base}/contract/${contrato}/events?order=asc&limit=${limite}${cursor ? `&cursor=${cursor}` : ""}`;
    const j = await pedirJson(url, { fetch: f });
    const regs = j?._embedded?.records ?? [];
    for (const r of regs) todos.push(r);
    alPagina(todos.length);
    if (regs.length < limite) break;
    cursor = regs[regs.length - 1].paging_token ?? regs[regs.length - 1].id;
  }
  return todos;
}

/** La transacción de un evento en Horizon: se pide por su `paging_token`, que sale del id del evento. */
export async function traerTransaccion(horizon, idEvento, { fetch: f = fetch } = {}) {
  const { toidTransaccion } = partesDelId(idEvento);
  const j = await pedirJson(`${horizon}/transactions?order=asc&limit=1&cursor=${toidTransaccion - 1n}`, { fetch: f });
  const rec = j?._embedded?.records?.[0];
  if (!rec || BigInt(rec.paging_token) !== toidTransaccion) return null;
  return rec;
}

/** El `next_id` del contrato, leído de su instancia en el RPC (el mismo número que devuelve `next_id()`). */
export async function leerNextId(rpc, contrato, { fetch: f = fetch } = {}) {
  const clave = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contrato).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
    }),
  ).toXdr("base64");
  const j = await pedirJson(rpc, {
    fetch: f,
    init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLedgerEntries", params: { keys: [clave] } }) },
  });
  const ent = j?.result?.entries?.[0];
  if (!ent) return null;
  const datos = xdr.LedgerEntryData.fromXdr(ent.xdr, "base64");
  const mapa = datos.contractData.val.instance.storage ?? [];
  for (const par of mapa) {
    const k = scValToNative(par.key);
    if (Array.isArray(k) && k[0] === "NextId") return Number(scValToNative(par.val));
  }
  return 1;
}

/** Los eventos `sealed` y `drawn` que el RPC todavía guarda (unos 7 días): una segunda fuente para los recientes. */
export async function traerEventosRpc(rpc, contrato, { fetch: f = fetch } = {}) {
  const post = (method, params) =>
    pedirJson(rpc, { fetch: f, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) } });
  const salud = (await post("getHealth", {}))?.result;
  if (!salud?.oldestLedger) return { desdeLedger: null, eventos: [] };
  const eventos = [];
  let cursor = null;
  for (;;) {
    const params = cursor
      ? { pagination: { cursor, limit: 1000 }, filters: [{ type: "contract", contractIds: [contrato] }] }
      : { startLedger: salud.oldestLedger + 1, pagination: { limit: 1000 }, filters: [{ type: "contract", contractIds: [contrato] }] };
    const r = (await post("getEvents", params))?.result;
    const evs = r?.events ?? [];
    for (const e of evs) {
      if (e.inSuccessfulContractCall === false) continue;
      const tema = scValToNative(xdr.ScVal.fromXDR(e.topic[0], "base64"));
      if (tema !== "sealed" && tema !== "drawn") continue;
      eventos.push({ tipo: tema, id: Number(scValToNative(xdr.ScVal.fromXDR(e.topic[1], "base64"))), ledger: e.ledger, txHash: e.txHash });
    }
    // El RPC mira un tramo de ledgers por pedido y puede contestar vacío con un cursor: se sigue hasta alcanzar el último ledger.
    if (!r?.cursor) break;
    const ledgerDelCursor = Number(BigInt(String(r.cursor).split("-")[0]) >> 32n);
    if (evs.length < 1000 && ledgerDelCursor >= r.latestLedger) break;
    cursor = r.cursor;
  }
  return { desdeLedger: salud.oldestLedger + 1, eventos };
}

/* ------------------------------------------------------------- comprobar */

/**
 * Las comprobaciones de que la lista de eventos está completa y es honesta:
 * - los sellos de cada contrato son 1..N sin huecos ni repetidos;
 * - N coincide con `next_id - 1` del contrato (si se pudo leer);
 * - cada evento tiene su transacción en Horizon y coincide con ella.
 * Devuelve `{ ok, lineas }`: `lineas` es lo que se imprime.
 */
export function comprobar({ contratos, eventos, nextIds = {}, problemas = [], sinTransaccion = 0 }) {
  const lineas = [];
  let ok = true;
  const marca = (bien, texto) => {
    lineas.push(`${bien ? "ok " : "MAL"} ${texto}`);
    if (!bien) ok = false;
  };
  for (const c of contratos) {
    const sellos = eventos.filter((e) => e.contrato === c.contractId && e.tipo === "sealed");
    const ids = new Set(sellos.map((e) => e.id));
    const maximo = sellos.length ? Math.max(...sellos.map((e) => e.id)) : 0;
    marca(ids.size === sellos.length && maximo === sellos.length, `${c.contractId.slice(0, 8)}: ${sellos.length} sellos, ids 1..${maximo} sin huecos ni repetidos`);
    const siguiente = nextIds[c.contractId];
    if (siguiente === undefined || siguiente === null) lineas.push(`-- ${c.contractId.slice(0, 8)}: next_id no legible (instancia vencida o red caída)`);
    else marca(siguiente - 1 === sellos.length, `${c.contractId.slice(0, 8)}: next_id ${siguiente} = ${sellos.length} sellos + 1`);
  }
  marca(sinTransaccion === 0, `${eventos.length - sinTransaccion} de ${eventos.length} eventos con su transacción de Horizon`);
  marca(problemas.length === 0, problemas.length ? `${problemas.length} problemas, el primero: ${problemas[0]}` : "los eventos y las transacciones coinciden");
  return { ok, lineas };
}

/* ------------------------------------------------- la actividad de una cuenta o un contrato */

/**
 * Lo que hizo una cuenta o lo que pasó en un contrato, con ledger y hora, para quien necesite
 * listar "las cuentas que firmaron" algo (por ejemplo las inscripciones firmadas de la página de
 * sorteos activos). No decide qué es una inscripción: devuelve las piezas y quien consume filtra.
 *
 * - `{ contrato }`: los eventos del contrato por la API de eventos de StellarExpert (todo el
 *   historial, no solo los 7 días del RPC). Cada fila: `{ ledger, cerroEn, eventoId, tema, temas, cuerpo, firmante }`.
 *   `firmante` es la cuenta que inició la transacción. `desde` es un cursor (`eventoId`) para seguir donde se dejó.
 * - `{ cuenta }`: las transacciones de la cuenta en Horizon. Cada fila: `{ ledger, cerroEn, hash, exitosa, cuentaFuente }`.
 *
 * Es de solo lectura y no necesita llaves. Con `horizon` o `expert` se puede apuntar a otra fuente.
 */
export async function actividadDe({ contrato, cuenta, desde = null, limite = 200 }, { fetch: f = fetch, expert = "https://api.stellar.expert/explorer/testnet", horizon = "https://horizon-testnet.stellar.org", maxFilas = Infinity } = {}) {
  if (!!contrato === !!cuenta) throw new Error("hay que dar una cuenta o un contrato, uno solo");
  const filas = [];
  if (contrato) {
    for (const r of await traerEventos(expert, contrato, { desde, fetch: f, limite })) {
      const temas = (r.topicsXdr ?? []).map((x) => scValToNative(xdr.ScVal.fromXDR(x, "base64")));
      let cuerpo = null;
      try {
        cuerpo = scValToNative(xdr.ScVal.fromXDR(r.bodyXdr, "base64"));
      } catch {
        /* un cuerpo que no se decodifica se devuelve vacío */
      }
      filas.push({ ledger: partesDelId(r.id).ledger, cerroEn: r.ts, eventoId: r.id, tema: String(temas[0] ?? ""), temas, cuerpo, firmante: r.initiator ?? null });
      if (filas.length >= maxFilas) break;
    }
    return filas;
  }
  let cursor = desde;
  for (;;) {
    const j = await pedirJson(`${horizon}/accounts/${cuenta}/transactions?order=asc&limit=${limite}${cursor ? `&cursor=${cursor}` : ""}`, { fetch: f });
    const regs = j?._embedded?.records ?? [];
    for (const r of regs) {
      filas.push({ ledger: r.ledger, cerroEn: Math.floor(Date.parse(r.created_at) / 1000), hash: r.hash, exitosa: r.successful === true, cuentaFuente: r.source_account, cursor: r.paging_token });
    }
    if (regs.length < limite || filas.length >= maxFilas) break;
    cursor = regs[regs.length - 1].paging_token;
  }
  return filas;
}
