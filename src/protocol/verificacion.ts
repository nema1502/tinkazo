import { canonicalList, listHash } from "./canonical";
import type { Proof } from "./proof";
import { bytesToHex, hexToBytes, randomnessOf, roundTime } from "./quicknet";
import { MAX_WINNERS, select } from "./select";
import { contratoOficial, type ContratoOficial } from "../stellar/oficiales";

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
 * - `verde`: anclado en un contrato oficial y todo coincide con su registro.
 * - `pendiente`: sellado en un contrato oficial, con todo en orden, y el resultado
 *   todavía no se grabó. Lo puede grabar cualquiera y da lo mismo.
 * - `libre`: sin anclar. La cuenta cierra, pero nadie atestigua la lista.
 * - `falta`: dice estar en un contrato oficial y la cadena no lo tiene (testnet
 *   borrada, una entrada archivada). Sin testigo.
 * - `sin-red`: no se pudo leer la cadena o el faro. No se afirma nada.
 * - `mal`: algo no coincide, o el registro no es de Tinkazo.
 */
export type Veredicto = "verde" | "pendiente" | "libre" | "falta" | "sin-red" | "mal";

/** Por qué no es verde, de lo más grave a lo menos (el primero es el que se cuenta). */
export const MOTIVOS = [
  "contrato-ajeno",
  "codigo-ajeno",
  "contrato-retirado",
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

/** Lo que falta para poder decir algo, cuando no hay nada mal. */
export type Falta = "sin-contrato" | "sin-sello" | "sin-resultado" | "sin-cadena" | "sin-ronda";

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
}

export interface Dependencias {
  /** ¿La firma (hex, 48 bytes) es la de esa ronda de quicknet? Nunca lanza. */
  verificarFirma(round: number, firmaHex: string): Promise<boolean>;
  /** La firma de una ronda, de un relay del faro. Lanza si no llega. */
  traerFirma(round: number): Promise<string>;
  /** El registro del sorteo en un contrato oficial. Lanza si no se pudo leer la cadena. */
  leerRegistro(contrato: ContratoOficial, id: string): Promise<Registro>;
}

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
 * Revisa un comprobante de punta a punta. `k` es cuántos ganadores rehacer si
 * no está anclado (en un sorteo anclado manda el sello). Nunca lanza.
 */
export async function revisarComprobante(p: Proof, deps: Dependencias, opciones: { k?: number } = {}): Promise<Revision> {
  const motivos = new Set<Motivo>();
  let falta: Falta | null = null;
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

  // --------------------------------------------------- 2. el ancla y el registro
  const ancla = anclaDe(p);
  let registro: Registro | null = null;
  if (ancla.tipo === "deforme") motivos.add("ancla-deforme");
  else if (ancla.tipo === "ajeno") motivos.add("contrato-ajeno");
  else if (ancla.tipo === "oficial") {
    const tope = ancla.contrato.ultimoId;
    // Un contrato que el sitio ya no usa sigue abierto (no tiene dueño): lo que se
    // selló en él después de reemplazarlo no es un sorteo de Tinkazo.
    if (tope !== undefined && BigInt(ancla.id) > BigInt(tope)) motivos.add("contrato-retirado");
    else {
      try {
        registro = await deps.leerRegistro(ancla.contrato, ancla.id);
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
      if (sello.listHash !== huella) motivos.add("lista-cambiada");
      if (sello.count !== nombres.length) motivos.add("cantidad");
      if (sello.round !== p.round) motivos.add("ronda");
      if (roundTime(sello.round) < sello.sealedAt + MIN_LEAD_SECS) motivos.add("ronda-temprana");
      if (!(sello.numWinners >= 1 && sello.numWinners <= Math.min(sello.count, MAX_WINNERS))) motivos.add("registro-incoherente");
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

  // ------------------------------------------------- 3. la ronda y su firma
  // La ronda que manda es la del sello (§7, paso 2); sin sello, la del enlace.
  const ronda = sello ? sello.round : p.round;
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
  // Cuántos: los del sello; si el sello se archivó y queda el resultado, los del resultado.
  const k = sello ? sello.numWinners : resultado ? resultado.winners.length : (opciones.k ?? 1);
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
    : falta === "sin-cadena" || falta === "sin-ronda"
      ? "sin-red"
      : ancla.tipo === "libre"
        ? "libre"
        : falta
          ? "falta"
          : !resultado
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
  };
}

/**
 * El premio que se muestra: el grabado en el sello si se leyó, si no el del
 * enlace. El del enlace se puede cambiar a mano. El texto por defecto del sello
 * no es un premio. `porDefecto` son esos textos, en los idiomas del sitio.
 */
export function premioDe(r: Pick<Revision, "registro">, delEnlace: string | undefined, porDefecto: readonly string[]): string {
  const meta = r.registro?.sello?.meta;
  if (meta === undefined) return delEnlace ?? "";
  return porDefecto.includes(meta) ? "" : meta;
}
