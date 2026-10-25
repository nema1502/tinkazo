import { canonicalList, listHash } from "./canonical";
import { hashDeTx, type Proof } from "./proof";
import { bytesToHex, hexToBytes, randomnessOf, roundTime } from "./quicknet";
import { MAX_WINNERS, select } from "./select";
import type { LecturaDelHistorial, SelloDelHistorial } from "../stellar/historial";
import { contratoOficial, type ContratoOficial, type Red } from "../stellar/oficiales";

/**
 * La verificación de un comprobante (docs/protocolo.md §7), en un solo lugar.
 *
 * La usan verificar.html y evento.html, y la van a usar la CLI, el SDK y el
 * widget: si una dice verde y otra rojo para el mismo enlace, alguna está mal.
 * No toca la página ni la red: lo que necesita de afuera (la cadena, el faro y la
 * cuenta de la firma) se lo pasan, y así las pruebas le pueden mentir.
 *
 * Lo que exige para el verde, además de que la cuenta cierre:
 * - que el contrato sea uno de los oficiales de esa red y que su instancia
 *   corra el `.wasm` oficial (`oficiales.ts`): un contrato ajeno devuelve lo que
 *   quiera quien lo escribió;
 * - que la lista del enlace sea canónica y su huella y su cantidad sean las del
 *   sello (una cantidad menor deja a los últimos sin chance de ganar);
 * - que la ronda sea la sellada, y que se haya publicado al menos 30 segundos
 *   después del sello (§3), con la hora del sello de la cadena, no la del enlace;
 * - que la firma sea la de esa ronda y la misma del registro, y que la semilla y
 *   los ganadores registrados sean los que salen de ella.
 *
 * El estado del contrato vence (7 días en testnet, 120 en mainnet) y mantenerlo
 * cuesta renta; la transacción que selló la lista sigue en el historial de
 * Stellar mientras la fuente que lo guarda la conserve (el Horizon público de
 * mainnet, unos 413 días; el de testnet se borra el 16 de diciembre de 2026). Si el
 * comprobante trae su hash (`stx`) y el estado no tiene el sello (la instancia
 * ausente, la entrada archivada), el sello se lee del historial
 * (`stellar/historial.ts`) y pasa por las mismas comprobaciones: lista exacta,
 * cantidad, ronda, 30 segundos de margen con la hora de cierre del ledger y
 * cantidad de ganadores. Con el estado a mano manda el estado, y el historial solo
 * lo cruza: si dice otra cosa, es rojo; si no se pudo leer, no cambia nada.
 *
 * Qué es cada resultado cuando el estado no tiene el sello y hay `stx`:
 * - el historial lo respalda y todo cuadra: verde (`fuente: "historial"`);
 * - la transacción se leyó y no es un sello oficial, o no cuadra con el
 *   comprobante: rojo, y solo por eso (una contradicción);
 * - no se pudo leer (sin red, límite de pedidos, una respuesta rara, una fuente que ya
 *   no guarda algo tan antiguo, o que no la conoce): `sin-red`, no confirmado. Nunca
 *   `falta` ni `mal`: con un 404 no se distingue "nunca existió" de "esa fuente ya no
 *   lo guarda", y no se afirma una ausencia que no se puede probar.
 *
 * Lo que este camino no prueba (docs/protocolo.md §7.1): el número del sorteo (la
 * transacción no lo trae; el mismo sello pasa con cualquier número), que la misma
 * lista no se haya sellado otras veces (eso solo se ve en el estado vivo), ni nada
 * que Horizon pudiera inventar de la hora o el ledger (una sola fuente).
 */

/** La ronda tiene que publicarse al menos esto después del sello (§3; `MIN_LEAD_SECS` del contrato). */
export const MIN_LEAD_SECS = 30;

/**
 * Un número a partir de `siguiente + esto` nunca existió. Más cerca puede ser un
 * sello recién entrado que el nodo del RPC todavía no ve: eso queda en "no está".
 */
export const MARGEN_DE_NUMEROS = 100n;

/** El sello de un sorteo, tal como lo guarda el contrato (`Raffle`). */
export interface Sello {
  id: string;
  organizer: string;
  /** Huella de la lista, en hex y en minúsculas. */
  listHash: string;
  count: number;
  numWinners: number;
  round: number;
  /** Hora del ledger en que se selló (Unix, segundos). */
  sealedAt: number;
  /** Ledger en que se selló, si el contrato lo trae (`sealed_ledger`). */
  sealedLedger?: number;
  meta: string;
  drawn: boolean;
}

/** El resultado registrado (`Draw`). */
export interface Resultado {
  raffleId: string;
  round: number;
  /** Firma comprimida de la ronda, en hex. */
  signature: string;
  randomness: string;
  winners: number[];
  drawnAt: number;
}

/** Lo que se leyó de la cadena para un sorteo. */
export interface Registro {
  /** sha256 del `.wasm` que corre la instancia, o `null` si la instancia no está en la cadena. */
  wasm: string | null;
  /** El próximo número que va a dar el contrato, si se pudo leer: lo que está de ahí para arriba nunca existió. */
  siguiente: number | null;
  sello: Sello | null;
  resultado: Resultado | null;
}

/** Qué dice el comprobante de su ancla en Stellar. */
export type Ancla =
  | { tipo: "libre" }
  | { tipo: "deforme" }
  | { tipo: "ajeno"; red: string; contrato: string }
  | { tipo: "oficial"; contrato: ContratoOficial; id: string };

/**
 * - `verde`: anclado en un contrato oficial y todo coincide con su registro, o con
 *   el historial de la transacción del sello si el estado ya no lo tiene (`fuente`).
 * - `pendiente`: sellado en un contrato oficial, con todo en orden, y el resultado
 *   todavía no se grabó. Lo puede grabar cualquiera y da lo mismo.
 * - `libre`: sin anclar. La cuenta cierra, pero nadie atestigua la lista.
 * - `falta`: dice estar en un contrato oficial y la cadena no lo tiene (testnet
 *   borrada, una entrada archivada) y no hay a quién preguntar más: el comprobante
 *   no trae el hash del sello, o quien revisa no lee el historial. Sin testigo.
 * - `sin-red`: no se pudo leer la cadena, el faro o, cuando el estado ya no tiene el
 *   sello y el comprobante trae su hash, el historial de transacciones. No se afirma nada.
 * - `mal`: algo no coincide, o el registro no es de Tinkazo.
 */
export type Veredicto = "verde" | "pendiente" | "libre" | "falta" | "sin-red" | "mal";

/**
 * De dónde salió el sello contra el que se comprobó: del estado del contrato (lo
 * de siempre) o del historial de transacciones, porque el estado ya no lo tiene.
 */
export type Fuente = "estado" | "historial";

/** Por qué no es verde, de lo más grave a lo menos (el primero es el que se cuenta). */
export const MOTIVOS = [
  "contrato-ajeno",
  "codigo-ajeno",
  "contrato-retirado",
  // El enlace cita una transacción que no es un sello (falló, o llama a otra cosa).
  "sello-invalido",
  // El estado del contrato y el historial de Stellar no cuentan lo mismo del sello.
  "historial-distinto",
  "ancla-deforme",
  "numero-inexistente",
  "lista-deforme",
  "lista-cambiada",
  "cantidad",
  "ronda",
  "ronda-temprana",
  "firma",
  "firma-registro",
  "semilla",
  "ganadores",
  "registro-incoherente",
] as const;
export type Motivo = (typeof MOTIVOS)[number];

/**
 * Lo que falta para poder decir algo, cuando no hay nada mal. `sin-historial`: el estado
 * no tiene el sello, el comprobante trae su hash y se intentó leer el historial sin
 * conseguirlo (el motivo está en `Revision.historial`).
 */
export type Falta = "sin-contrato" | "sin-sello" | "sin-resultado" | "sin-cadena" | "sin-ronda" | "sin-historial";

export interface Revision {
  veredicto: Veredicto;
  /** Lo que no coincide, de lo más grave a lo menos. Vacío si nada está mal. */
  motivos: Motivo[];
  /** Lo primero que no se pudo comprobar (la cadena, el faro, el registro), haya o no algo mal. */
  falta: Falta | null;
  ancla: Ancla;
  /** La lista canónica del enlace. */
  nombres: string[];
  /** Su huella, en hex. */
  huella: string;
  /** La ronda contra la que se comprobó la firma: la del sello si se leyó, si no la del enlace. */
  ronda: number;
  firma: string | null;
  firmaOk: boolean;
  semilla: string | null;
  /** Cuántos ganadores: los del sello si se leyó; si no, los que se pidieron. */
  k: number;
  /** Los ganadores recomputados, como índices de `nombres`. Vacío si no se pudieron calcular. */
  ganadores: number[];
  registro: Registro | null;
  /**
   * De dónde salió el sello: `estado` (el contrato, lo de siempre) o `historial`
   * (el estado ya no lo tiene y lo respalda la transacción del sello). Con
   * `historial` el número del sorteo no se comprueba: la transacción no lo trae y el
   * mismo sello pasa con cualquier número. Quien lo muestre identifica el sorteo por
   * la fecha de cierre y el código de la transacción, y el número va aparte, como
   * "el que figura en el comprobante".
   */
  fuente: Fuente;
  /**
   * Lo que se leyó del historial de la transacción del sello, si se consultó. Con
   * `falta: "sin-historial"` trae por qué no se pudo (`null` si ni siquiera contestó a tiempo).
   */
  historial: LecturaDelHistorial | null;
}

export interface Dependencias {
  /** ¿La firma (hex, 48 bytes) es la de esa ronda de quicknet? Nunca lanza. */
  verificarFirma(round: number, firmaHex: string): Promise<boolean>;
  /** La firma de una ronda, de un relay del faro. Lanza si no llega. */
  traerFirma(round: number): Promise<string>;
  /** El registro del sorteo en un contrato oficial. Lanza si no se pudo leer la cadena. */
  leerRegistro(contrato: ContratoOficial, id: string): Promise<Registro>;
  /**
   * El sello de una transacción, leído del historial público de la red
   * (`stellar/historial.ts`). Opcional: sin esto no hay verde por historial y todo
   * queda como antes. Se espera que no lance; si lanza, cuenta como historial caído.
   */
  leerHistorial?(red: Red, hash: string): Promise<LecturaDelHistorial>;
}

/**
 * Cuánto se espera al historial, una vez leído el estado, cuando el estado ya tiene el
 * sello: ahí solo sirve para cruzar los datos, y un Horizon lento no puede demorar un
 * veredicto que el estado ya puede dar (el historial se pide a la vez que el estado, así
 * que normalmente ya llegó). Sin el estado, el historial es el único testigo y se espera
 * lo que haga falta (los tiempos de `historial.ts`).
 */
export const ESPERA_DEL_HISTORIAL_CON_ESTADO_MS = 4_000;

const U64_MAX = 2n ** 64n - 1n;

/** El ancla del comprobante: ninguna, una rota, una ajena o una de Tinkazo. */
export function anclaDe(p: Pick<Proof, "net" | "contract" | "id">): Ancla {
  const { net, contract, id } = p as { net?: unknown; contract?: unknown; id?: unknown };
  if (net === undefined && contract === undefined && id === undefined) return { tipo: "libre" };
  if (typeof net !== "string" || typeof contract !== "string" || typeof id !== "string") return { tipo: "deforme" };
  // El número es un u64 sin ceros adelante: "07" o "7.0" no son el sorteo 7.
  if (!/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > U64_MAX) return { tipo: "deforme" };
  const oficial = contratoOficial(net, contract);
  return oficial ? { tipo: "oficial", contrato: oficial, id } : { tipo: "ajeno", red: net, contrato: contract };
}

const iguales = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * En qué no coinciden el sello que guarda el contrato y el de la transacción que lo
 * hizo, con los nombres de los campos del contrato. Vacío si dicen lo mismo. Si el
 * estado no trae el ledger (un contrato que no lo guarda), ese dato no se cruza.
 */
export function camposDistintos(s: Sello, h: SelloDelHistorial, contractId: string): string[] {
  const dist: Array<[string, boolean]> = [
    ["contract", h.contractId !== contractId],
    ["organizer", h.organizer !== s.organizer],
    ["list_hash", h.listHash !== s.listHash],
    ["count", h.count !== s.count],
    ["num_winners", h.numWinners !== s.numWinners],
    ["round", h.round !== s.round],
    ["sealed_at", h.closedAt !== s.sealedAt],
    ["sealed_ledger", s.sealedLedger !== undefined && h.ledger !== s.sealedLedger],
    ["meta", h.meta !== s.meta],
  ];
  return dist.filter(([, distinto]) => distinto).map(([campo]) => campo);
}

/** Una lectura del historial que nunca lanza: si la dependencia lanza, cuenta como historial caído. */
async function pedirHistorial(leer: NonNullable<Dependencias["leerHistorial"]>, red: Red, hash: string): Promise<LecturaDelHistorial> {
  try {
    return await leer(red, hash);
  } catch {
    return { ok: false, error: "red-caida" };
  }
}

/** La clave de un sorteo por su número en un contrato oficial. */
export const claveDeNumero = (c: Pick<ContratoOficial, "red" | "contractId">, id: string): string => `${c.red}:${c.contractId}:${id}`;

/**
 * Con qué se reconoce un sorteo dentro de un enlace (el evento, para que uno repetido
 * cuente una vez y para no avisar como "otro sello" al que ya está). Dos sorteos con
 * alguna clave en común son el mismo.
 *
 * Un mismo sello se puede citar de varias formas, y cada una tiene que dar una clave en común:
 * - por el hash de la transacción interior, cuando se leyó del historial (el hash de afuera de
 *   un fee-bump y el de adentro dan el mismo) y también cuando el historial solo cruzó al estado;
 * - por su número en el contrato, solo si el número está atestiguado (el estado tiene el sello):
 *   por el historial no, porque el mismo sello pasa con cualquier número;
 * - por lo que dice el sello (contrato, quién, huella, ronda y hora de cierre), que es lo mismo
 *   venga del estado o de la transacción: así uno visto por el estado y sin hash en el enlace se
 *   reconoce como el mismo que otro visto por el historial.
 *
 * Sin anclar o con un ancla ajena no hay sello que reconocer: queda la ronda y la huella, o lo que dice el enlace.
 */
export function clavesDelSorteo(p: Pick<Proof, "round" | "net" | "contract" | "id">, r: Revision): string[] {
  const a = r.ancla;
  if (a.tipo === "libre") return [`libre:${String(p.round)}:${r.huella}`];
  if (a.tipo !== "oficial") return [`otro:${String(p.net)}:${String(p.contract)}:${String(p.id)}`];
  const { red, contractId } = a.contrato;
  const claves: string[] = [];
  const h = r.historial?.ok ? r.historial.sello : null;
  if (h) claves.push(`sello:${red}:${h.hashInterior}`);
  const delEstado = r.registro?.sello ?? null;
  if (r.fuente !== "historial") claves.push(claveDeNumero(a.contrato, a.id));
  const visto = delEstado
    ? { organizer: delEstado.organizer, listHash: delEstado.listHash, round: delEstado.round, cierre: delEstado.sealedAt }
    : r.fuente === "historial" && h
      ? { organizer: h.organizer, listHash: h.listHash, round: h.round, cierre: h.closedAt }
      : null;
  if (visto) claves.push(`contenido:${red}:${contractId}:${visto.organizer}:${visto.listHash}:${visto.round}:${visto.cierre}`);
  return claves;
}

/** El resultado de `p`, o `undefined` si no llega en `ms` (el que espera no se queda colgado de una red lenta). */
async function conLimite<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const vence = new Promise<undefined>((r) => {
    reloj = setTimeout(() => r(undefined), ms);
  });
  try {
    return await Promise.race([p, vence]);
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Revisa un comprobante de punta a punta. `k` es cuántos ganadores rehacer si
 * no está anclado (en un sorteo anclado manda el sello). `esperaDelHistorialMs`
 * es cuánto se espera al historial cuando el estado ya tiene el sello
 * (`ESPERA_DEL_HISTORIAL_CON_ESTADO_MS`). Nunca lanza.
 */
export async function revisarComprobante(
  p: Proof,
  deps: Dependencias,
  opciones: { k?: number; esperaDelHistorialMs?: number } = {},
): Promise<Revision> {
  const motivos = new Set<Motivo>();
  // `as`: que el análisis de tipos no lo dé por `null` para siempre; también lo cambian `faltar` y el cruce con el historial.
  let falta = null as Falta | null;
  const faltar = (f: Falta): void => {
    falta ??= f;
  };

  // ------------------------------------------------------------- 1. la lista
  // Tiene que llegar ya canónica. Si canonicalizarla la cambia, lo que se ve en
  // la página (y lo que se busca: "¿estás en la lista?") no es lo que se selló:
  // "Ana, Juan Pérez" se sella como "Ana", y Juan nunca estuvo.
  const crudos: unknown[] = Array.isArray(p.names) ? p.names : [];
  const textos = crudos.every((n): n is string => typeof n === "string");
  const nombres = textos ? canonicalList((crudos as string[]).join("\n")) : [];
  const exacta = textos && nombres.length === crudos.length && nombres.every((n, i) => n === crudos[i]);
  if (!exacta || nombres.length < 2) motivos.add("lista-deforme");
  const huella = bytesToHex(listHash(nombres));

  /** Lo que se le exige a un sello, lo traiga el estado del contrato o el historial de su transacción (§7, pasos 1 y 2). */
  const revisarSello = (s: { listHash: string; count: number; numWinners: number; round: number; sealedAt: number }): void => {
    if (s.listHash !== huella) motivos.add("lista-cambiada");
    if (s.count !== nombres.length) motivos.add("cantidad");
    if (s.round !== p.round) motivos.add("ronda");
    if (roundTime(s.round) < s.sealedAt + MIN_LEAD_SECS) motivos.add("ronda-temprana");
    if (!(s.numWinners >= 1 && s.numWinners <= Math.min(s.count, MAX_WINNERS))) motivos.add("registro-incoherente");
  };

  // --------------------------------------------------- 2. el ancla y el registro
  const ancla = anclaDe(p);
  const stx = hashDeTx(p.stx);
  let registro: Registro | null = null;
  // El historial se pide a la vez que el estado, no después: en serie se sumarían sus esperas.
  // Solo si hay con qué (un contrato oficial, el hash del sello y quien lo lea) y hasta acá nada
  // está mal. Si el estado deja algo mal, la lectura se descarta y el resultado es el de antes.
  let pedidoAlHistorial: { contrato: ContratoOficial; lectura: Promise<LecturaDelHistorial> } | null = null;
  if (ancla.tipo === "deforme") motivos.add("ancla-deforme");
  else if (ancla.tipo === "ajeno") motivos.add("contrato-ajeno");
  else if (ancla.tipo === "oficial") {
    const { contrato } = ancla;
    const tope = contrato.ultimoId;
    // Un contrato que el sitio ya no usa sigue abierto (no tiene dueño): lo que se
    // selló en él después de reemplazarlo no es un sorteo de Tinkazo.
    if (tope !== undefined && BigInt(ancla.id) > BigInt(tope)) motivos.add("contrato-retirado");
    else {
      // Un contrato anterior sin su último ledger no se acepta por historial (cualquiera puede sellar ahí hoy).
      if (stx && deps.leerHistorial && motivos.size === 0 && (contrato.vigente || Number.isSafeInteger(contrato.ultimoLedger))) {
        pedidoAlHistorial = { contrato, lectura: pedirHistorial(deps.leerHistorial, contrato.red, stx) };
      }
      try {
        registro = await deps.leerRegistro(contrato, ancla.id);
      } catch {
        faltar("sin-cadena");
      }
    }
  }
  const sello = registro?.sello ?? null;
  const resultado = registro?.resultado ?? null;
  if (registro && ancla.tipo === "oficial") {
    if (registro.wasm === null) faltar("sin-contrato");
    else if (registro.wasm !== ancla.contrato.wasmSha256) motivos.add("codigo-ajeno");
    if (registro.wasm !== null && !sello) {
      // Un número que el contrato todavía no dio no es un sorteo archivado: nunca existió.
      if (registro.siguiente !== null && BigInt(ancla.id) >= BigInt(registro.siguiente) + MARGEN_DE_NUMEROS) {
        motivos.add("numero-inexistente");
      } else faltar("sin-sello");
    }
    if (sello) {
      if (sello.id !== ancla.id) motivos.add("registro-incoherente");
      revisarSello(sello);
    }
    if (resultado) {
      // Sin el sello no hay contra qué comparar el resultado: el sello vence unos
      // ledgers antes que el resultado (se escribe antes), así que puede faltar
      // por archivado. Eso es "no está", no un registro que miente.
      if (resultado.raffleId !== ancla.id || (sello && (!sello.drawn || resultado.round !== sello.round))) {
        motivos.add("registro-incoherente");
      }
    } else if (sello?.drawn) faltar("sin-resultado");
  }

  // ------------------------------------------- 2b. el historial de transacciones
  // El estado vence; la transacción del sello, mientras la fuente la guarde, no. Con su hash
  // (`stx`) y un contrato oficial, el historial es el testigo cuando el estado no tiene el
  // sello, y un cruce cuando sí lo tiene. Solo si hasta acá no hay nada mal: un rojo no
  // necesita más pruebas.
  let fuente: Fuente = "estado";
  let historial: LecturaDelHistorial | null = null;
  let selloH: SelloDelHistorial | null = null;
  if (pedidoAlHistorial && registro && motivos.size === 0) {
    const { contrato, lectura } = pedidoAlHistorial;
    // Con el estado a mano el historial no puede demorar el veredicto; sin él, es el único testigo.
    historial = sello ? ((await conLimite(lectura, opciones.esperaDelHistorialMs ?? ESPERA_DEL_HISTORIAL_CON_ESTADO_MS)) ?? null) : await lectura;
    if (historial?.ok) {
      const h = historial.sello;
      if (sello) {
        if (camposDistintos(sello, h, contrato.contractId).length) motivos.add("historial-distinto");
      } else if (h.contractId !== contrato.contractId) {
        // Un sello de otro contrato oficial no es el de este comprobante.
        motivos.add("historial-distinto");
      } else {
        // El testigo es el historial: lo que el estado no tiene lo dice la transacción.
        fuente = "historial";
        selloH = h;
        revisarSello({ ...h, sealedAt: h.closedAt });
        if (falta === "sin-contrato" || falta === "sin-sello") falta = null;
      }
    } else if (historial) {
      // Solo una transacción que se leyó y no es un sello de este comprobante es una contradicción.
      if (historial.error === "fallida" || historial.error === "no-es-un-sello") motivos.add("sello-invalido");
      else if (historial.error === "contrato-ajeno") {
        // Sin tope (un contrato anterior sin `ultimoLedger`) no se acepta, pero tampoco se acusa.
        if (!historial.sinTope) motivos.add(historial.retirado ? "contrato-retirado" : "contrato-ajeno");
      } else if (!sello && (falta === "sin-contrato" || falta === "sin-sello")) {
        // Sin red, un límite de pedidos, una respuesta rara, una fuente que ya no guarda algo tan
        // antiguo (410) o que no conoce la transacción (404, que no distingue "nunca existió" de
        // "ya no la guardo"): no dicen nada del sorteo. Ni "no está" ni "está mal": no confirmado.
        falta = "sin-historial";
      }
    }
  }

  // ------------------------------------------------- 3. la ronda y su firma
  // La ronda que manda es la del sello (§7, paso 2); sin sello, la del enlace.
  const ronda = sello ? sello.round : selloH ? selloH.round : p.round;
  const rondaValida = Number.isSafeInteger(ronda) && ronda >= 1;
  if (!Number.isSafeInteger(p.round) || p.round < 1) motivos.add("ronda");
  let firma: string | null = null;
  if (typeof p.signature === "string") firma = p.signature.toLowerCase();
  else if (p.signature !== undefined) motivos.add("firma");
  else if (resultado) firma = resultado.signature;
  else if (rondaValida) {
    try {
      firma = (await deps.traerFirma(ronda)).toLowerCase();
    } catch {
      faltar("sin-ronda");
    }
  }
  let firmaOk = false;
  if (firma !== null) {
    firmaOk = rondaValida && /^[0-9a-f]{96}$/.test(firma) && (await deps.verificarFirma(ronda, firma));
    if (!firmaOk) motivos.add("firma");
    // La firma de una ronda es una sola: si el registro tiene otra, el registro no es de esa ronda.
    if (resultado && resultado.signature !== firma) motivos.add("firma-registro");
  }

  // ------------------------------------------------------------ 4. la semilla
  const semilla = firmaOk && firma ? bytesToHex(randomnessOf(firma)) : null;
  if (resultado && semilla !== null && resultado.randomness !== semilla) motivos.add("semilla");

  // ---------------------------------------------------------- 5. los ganadores
  // Cuántos: los del sello (del estado o, si ya no está, de su transacción); si el sello
  // se archivó y queda el resultado, los del resultado.
  const k = sello ? sello.numWinners : selloH ? selloH.numWinners : resultado ? resultado.winners.length : (opciones.k ?? 1);
  let ganadores: number[] = [];
  if (semilla !== null && nombres.length >= 2) {
    if (Number.isInteger(k) && k >= 1 && k <= Math.min(nombres.length, MAX_WINNERS)) {
      ganadores = select(hexToBytes(semilla), hexToBytes(huella), nombres.length, k);
      if (resultado && !iguales(resultado.winners, ganadores)) motivos.add("ganadores");
    } else {
      motivos.add("ganadores");
    }
  }

  // ------------------------------------------------------------ 6. el veredicto
  const lista = MOTIVOS.filter((m) => motivos.has(m));
  const veredicto: Veredicto = lista.length
    ? "mal"
    : falta === "sin-cadena" || falta === "sin-ronda" || falta === "sin-historial"
      ? "sin-red"
      : ancla.tipo === "libre"
        ? "libre"
        : falta
          ? "falta"
          : // Con el sello en el historial no hay un resultado grabado que esperar: el estado ya no está,
            // y el ganador sale de la firma de la ronda, que acá se comprobó.
            !resultado && fuente !== "historial"
            ? "pendiente"
            : "verde";
  return {
    veredicto,
    motivos: lista,
    falta,
    ancla,
    nombres,
    huella,
    ronda,
    firma,
    firmaOk,
    semilla,
    k,
    ganadores,
    registro,
    fuente,
    historial,
  };
}

/**
 * El premio que se muestra: el grabado en el sello si se leyó (del estado o, si ya
 * no está, de su transacción), si no el del enlace. El del enlace se puede cambiar
 * a mano. El texto por defecto del sello no es un premio. `porDefecto` son esos
 * textos, en los idiomas del sitio.
 */
export function premioDe(
  r: Pick<Revision, "registro"> & Partial<Pick<Revision, "fuente" | "historial">>,
  delEnlace: string | undefined,
  porDefecto: readonly string[],
): string {
  const meta = r.registro?.sello?.meta ?? (r.fuente === "historial" && r.historial?.ok ? r.historial.sello.meta : undefined);
  if (meta === undefined) return delEnlace ?? "";
  return porDefecto.includes(meta) ? "" : meta;
}
