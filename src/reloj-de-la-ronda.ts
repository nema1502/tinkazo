import { QUICKNET, readRound, roundEndpoint, roundTime, type Relay } from "./protocol/quicknet";
import { desfaseDe, rondaDe } from "./ui/espectador-reloj";

/**
 * El reloj de la ronda: cuándo nace un número, visto desde este aparato.
 *
 * La sala y el celular de quien mira siguen la misma línea de tiempo, la del nacimiento del número (`arranque-del-show.ts`).
 * El reloj de cada aparato puede estar corrido segundos, así que no sirve para ponerlos a la par. Lo que sirve es el
 * propio número: el servicio de Cloudflare retiene el pedido de la ronda que todavía no nació y contesta apenas nace
 * (medido el 16 de noviembre de 2026: contesta entre 0,07 y 0,09 s después de su hora, las cuatro veces). Así:
 *
 * - **El ancla** (`anclaDeLaRonda`): cada aparato pide la ronda un segundo y medio antes de que nazca y anota cuándo le
 *   llega, en su reloj monótono. Esa llegada nunca es antes de que nazca el número: el número no existe antes. Es la
 *   hora cero de la línea de tiempo de ese aparato. Si el pedido esperó de verdad (tardó más que la ida y vuelta medida
 *   justo antes, más un margen), la llegada es a lo sumo la ida y vuelta después de que el número llegó al servicio.
 *   Eso no alcanza para la sala: un número que llega tarde al servicio también deja el pedido retenido. La sala se da
 *   por a la par (`salaALaParPorElAncla`) solo si además su llegada cae cerca de la hora de la ronda según su medida del
 *   reloj (`anclaVirtual`). El celular no: si llega tarde, va más atrás, que es seguro.
 * - **La medida del reloj** (`medirElReloj`): lo mismo con la ronda siguiente a la de ahora, para corregir un reloj
 *   corrido con unas centésimas. Sirve para mandar el pedido del ancla a tiempo y para la cuenta regresiva. Deja además
 *   un piso: desde esa llegada, la hora de la ronda es por lo menos la de esa ronda, y con eso un celular que abre tarde
 *   sabe, sin pasarse nunca, cuánto hace que nació el número de su sorteo (`anclaVirtual`).
 *
 * Nada de esto decide el sorteo: el número se comprueba con su firma y los ganadores salen de `src/protocol`, como
 * siempre. Esto dice solo cuándo.
 */

/** El servicio que retiene el pedido de la ronda que todavía no nació, por la ruta v1. */
export const RELAY_QUE_RETIENE: Relay = "https://drand.cloudflare.com";
/** Cuánto más que la ida y vuelta tiene que tardar un pedido para darlo por retenido. */
export const RETENIDO_SI_TARDA_MAS_MS = 300;
/** La ida y vuelta más larga con la que la sala se da por a la par: su número le llegó a lo sumo esto después de nacer. */
export const IDA_Y_VUELTA_MAX_MS = 600;
/**
 * Lo más antes de su ancla virtual que puede caer la llegada del número de la sala. El número no existe antes de nacer:
 * una llegada mucho antes quiere decir que la medida del reloj no es de fiar (la compu durmió entre la medida y el
 * sorteo), y la sala no se da por a la par.
 */
export const ANTES_DE_SU_HORA_MAX_MS = 300;
/** Cuánto antes de que nazca el número sale el pedido que espera su nacimiento. Cabe en el período de 3 s con 1,5 s de reloj corrido. */
export const PEDIR_ANTES_MS = 1_500;
/** Cuánto antes del pedido que espera se mide la ida y vuelta. */
const MEDIR_ANTES_MS = 500;
/** Lo que se espera cada pedido. Uno retenido dura hasta un período. */
const PLAZO_MS = 6_000;
/** Si el servicio contesta que la ronda está demasiado lejos (404), se vuelve a pedir a este paso. */
const OTRA_VEZ_MS = 300;
/** Lo que se suma a la hora de la ronda al medir el reloj: lo que tarda el servicio en enterarse y en volver. */
const AVISO_Y_VUELTA_S = 0.1;

export interface Ancla {
  /** El reloj monótono (`performance.now`, ms) cuando llegó el número. Nunca antes de que nazca. */
  llegada: number;
  /** El pedido esperó el nacimiento: la llegada es a lo sumo `idaYVuelta` después de que nació. */
  retenido: boolean;
  /** La ida y vuelta medida justo antes, en ms, o null si no se pudo medir. */
  idaYVuelta: number | null;
  /** La firma que llegó, sin verificar (la verifica quien la usa), o null. */
  firma: string | null;
}

export interface Relojes {
  fetchFn?: typeof fetch;
  /** El reloj monótono, en ms. */
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  /** La hora de la ronda según este aparato, en segundos (el reloj de pared con el desfase medido). */
  horaDeLaRonda?: () => number;
  signal?: AbortSignal;
}

interface Pedido {
  estado: number;
  firma: string | null;
  ronda: number | null;
  enviado: number;
  llegada: number;
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const relojMonotono = (): number => performance.now();
/** En las pruebas nadie sale a la red sin pedirlo: sin un `fetch` propio, no hay ancla ni medida (quien llama sigue como siempre). */
const enPruebas = (): boolean => import.meta.env?.MODE === "test";

/** Un pedido al servicio que retiene, con su hora de salida y de llegada. null si no contestó. */
async function pedir(url: string, ronda: number | "latest", r: Required<Pick<Relojes, "fetchFn" | "ahora">> & Pick<Relojes, "signal">): Promise<Pedido | null> {
  const ctl = new AbortController();
  const corta = (): void => ctl.abort();
  r.signal?.addEventListener("abort", corta, { once: true });
  const plazo = setTimeout(corta, PLAZO_MS);
  try {
    const enviado = r.ahora();
    // Suelto, nunca como método de `r`: el `fetch` del navegador falla si `this` es otro objeto (Illegal invocation).
    const pedirAlServicio = r.fetchFn;
    const res = await pedirAlServicio(url, { cache: "no-store", signal: ctl.signal });
    const llegada = r.ahora();
    if (!res.ok) return { estado: res.status, firma: null, ronda: null, enviado, llegada };
    const cuerpo: unknown = await res.json();
    const n = ronda === "latest" ? rondaDe(cuerpo) : ronda;
    return { estado: res.status, firma: n !== null ? readRound(cuerpo, n) : null, ronda: n, enviado, llegada };
  } catch {
    return null;
  } finally {
    clearTimeout(plazo);
    r.signal?.removeEventListener("abort", corta);
  }
}

const urlDe = (ronda: number): string => roundEndpoint(RELAY_QUE_RETIENE, ronda, "v1");
const urlUltima = (): string => `${RELAY_QUE_RETIENE}/${QUICKNET.chainHash}/public/latest`;

/** La ida y vuelta hasta el servicio, con dos rondas ya nacidas (la segunda va por la conexión ya abierta). */
async function idaYVuelta(round: number, r: Required<Pick<Relojes, "fetchFn" | "ahora">> & Pick<Relojes, "signal">): Promise<number | null> {
  let mejor: number | null = null;
  for (const vieja of [round - 3, round - 2]) {
    const p = await pedir(urlDe(vieja), vieja, r);
    if (p?.estado === 200 && p.firma) mejor = Math.min(mejor ?? Infinity, p.llegada - p.enviado);
  }
  return mejor;
}

/**
 * Espera el nacimiento de la ronda `round` con un pedido que el servicio retiene, y devuelve cuándo llegó. Manda el
 * pedido `PEDIR_ANTES_MS` antes de la hora de la ronda (en `horaDeLaRonda`). Si el servicio contesta 404 (el reloj iba
 * adelantado y faltaban dos rondas), lo vuelve a pedir hasta que lo retiene. null si no contestó: quien llama trae el
 * número como siempre (`fetchRound`) y usa como ancla la llegada de ese, que tampoco es antes de que nazca.
 */
export async function anclaDeLaRonda(round: number, op: Relojes = {}): Promise<Ancla | null> {
  if (!op.fetchFn && enPruebas()) return null;
  const r = { fetchFn: op.fetchFn ?? fetch, ahora: op.ahora ?? relojMonotono, ...(op.signal ? { signal: op.signal } : {}) };
  const dormir = op.dormir ?? dormirDeVerdad;
  const hora = op.horaDeLaRonda ?? horaDeLaRondaAhora;
  const nace = roundTime(round);
  // La ida y vuelta se mide medio segundo antes, para que el pedido que espera salga a su hora.
  const antes = (nace - (PEDIR_ANTES_MS + MEDIR_ANTES_MS) / 1000 - hora()) * 1000;
  if (antes > 0) await dormir(antes);
  if (op.signal?.aborted) return null;
  const ref = await idaYVuelta(round, r);
  const falta = (nace - PEDIR_ANTES_MS / 1000 - hora()) * 1000;
  if (falta > 0) await dormir(falta);
  for (let intento = 0; intento < 30; intento++) {
    if (op.signal?.aborted) return null;
    const p = await pedir(urlDe(round), round, r);
    if (!p) return null;
    if (p.estado === 200 && p.firma) {
      return { llegada: p.llegada, retenido: ref !== null && p.llegada - p.enviado > ref + RETENIDO_SI_TARDA_MAS_MS, idaYVuelta: ref, firma: p.firma };
    }
    // Todavía faltan dos rondas: el reloj de este aparato iba adelantado. Se vuelve a pedir, como mucho hasta un poco
    // después de la hora de la ronda.
    if (p.estado === 404 && hora() < nace + 2) {
      await dormir(OTRA_VEZ_MS);
      continue;
    }
    return null;
  }
  return null;
}

/** Las anclas ya pedidas, por ronda: el primero que la pide la lanza y los demás reciben la misma. */
const pedidas = new Map<number, Promise<Ancla | null>>();

/**
 * El ancla de la ronda, pedida una sola vez. La cuenta regresiva la pide unos segundos antes de que nazca el número
 * (`ANCLA_ANTES_S`), y el sorteo, que en Rápido sale recién medio segundo antes, recibe la misma: si el pedido saliera
 * con el sorteo, ya no alcanzaría a esperar el nacimiento.
 */
export function anclaDeLaRondaUnaVez(round: number, op: Relojes = {}): Promise<Ancla | null> {
  let p = pedidas.get(round);
  if (!p) {
    p = anclaDeLaRonda(round, op).catch(() => null);
    pedidas.set(round, p);
    // Las de rondas viejas no sirven: se guardan las últimas.
    if (pedidas.size > 8) pedidas.delete(pedidas.keys().next().value as number);
  }
  return p;
}

/** Cuántos segundos antes de que nazca el número se pide el ancla: la ida y vuelta se mide desde 2 s antes. */
export const ANCLA_ANTES_S = 2.5;

/**
 * Si la sala puede darse por a la par por su ancla: su pedido esperó el nacimiento, la ida y vuelta fue corta y la
 * llegada cae cerca de la hora de la ronda según la medida de su reloj (`virtual`, el `anclaVirtual` de la ronda: la
 * hora de la ronda en su reloj monótono, con lo que tardó el servicio en enterarse de una ronda que nació a horario).
 *
 * Retenido solo dice que el pedido esperó: si el número llegó tarde al servicio (un atraso de las rondas, o del
 * servicio), el pedido también espera y la llegada cae segundos después de la hora de la ronda. El celular, en cambio,
 * toma la llegada más temprana que tiene, que puede ser su propia ancla virtual a horario, y jugaría delante de la sala.
 * Por eso la llegada de la sala tiene que caer a lo sumo `IDA_Y_VUELTA_MAX_MS` después de su ancla virtual (y no mucho
 * antes: eso no puede ser y quiere decir que la medida no es de fiar). Sin la medida comprobada, no hay con qué
 * compararla y la sala no se da por a la par. Con eso su número le llegó a lo sumo unas centésimas más
 * `IDA_Y_VUELTA_MAX_MS` después de nacer, y su juego, que arranca a una hora fija desde esa llegada, va por lo menos el
 * atraso del celular menos eso delante de cualquier celular.
 */
export function salaALaParPorElAncla(a: Ancla | null, virtual: number | null): boolean {
  if (!a || !a.retenido || a.idaYVuelta === null || a.idaYVuelta > IDA_Y_VUELTA_MAX_MS || virtual === null) return false;
  const tras = a.llegada - virtual;
  return tras <= IDA_Y_VUELTA_MAX_MS && tras >= -ANTES_DE_SU_HORA_MAX_MS;
}

/* ------------------------------------------------------------------ la medida del reloj */

/** Lo que se sabe de la hora de la ronda en este aparato. */
interface Medida {
  /** Lo que hay que sumarle al reloj de pared (segundos) para tener la hora de la ronda. */
  desfase: number;
  /** Medido con un pedido retenido: unas centésimas de error. Si no, la medida gruesa de `latest`, o nada. */
  comprobado: boolean;
  /** Desde esta llegada (reloj monótono, ms), la hora de la ronda es por lo menos `hora` (segundos). */
  piso: { llegada: number; hora: number } | null;
}

let medida: Medida = { desfase: 0, comprobado: false, piso: null };

/** Lo que hay que sumarle al reloj de pared, en segundos, para tener la hora de la ronda. Cero hasta medir. */
export const desfaseDeLaRonda = (): number => medida.desfase;
/** Si la hora de la ronda se midió con un pedido retenido. */
export const relojComprobado = (): boolean => medida.comprobado;
/** La hora de la ronda según este aparato, en segundos. */
export function horaDeLaRonda(pared: () => number = () => Date.now() / 1000): number {
  return pared() + medida.desfase;
}
const horaDeLaRondaAhora = (): number => horaDeLaRonda();

/**
 * Un ancla para la ronda `round` sacada del piso de la medida: un momento del reloj monótono en que la hora de la ronda
 * ya era, por lo menos, la de su nacimiento. Sirve para quien llega después de que nació (un celular que escanea tarde):
 * nunca lo pone delante. null sin medida comprobada.
 */
export function anclaVirtual(round: number): number | null {
  const p = medida.piso;
  if (!p) return null;
  return p.llegada - (p.hora - roundTime(round)) * 1000;
}

/** Para las pruebas: el reloj sin medir, y sin anclas pedidas. */
export function olvidarElReloj(): void {
  medida = { desfase: 0, comprobado: false, piso: null };
  pedidas.clear();
}

/**
 * Mide la hora de la ronda: pide la ronda de ahora (`latest`) y enseguida la siguiente, que el servicio retiene hasta
 * que nace. Si `latest` llegó viejo (lo guarda dos segundos) y la siguiente ya había nacido, prueba con la que sigue.
 * Sin un pedido retenido queda la medida gruesa de `latest` (con tres segundos de margen), sin comprobar.
 */
export async function medirElReloj(op: Relojes & { pared?: () => number } = {}): Promise<{ comprobado: boolean }> {
  if (!op.fetchFn && enPruebas()) return { comprobado: medida.comprobado };
  const r = { fetchFn: op.fetchFn ?? fetch, ahora: op.ahora ?? relojMonotono, ...(op.signal ? { signal: op.signal } : {}) };
  const pared = op.pared ?? (() => Date.now() / 1000);
  const ultima = await pedir(urlUltima(), "latest", r);
  if (!ultima || ultima.estado !== 200 || ultima.ronda === null) return { comprobado: medida.comprobado };
  const L = ultima.ronda;
  const ref = ultima.llegada - ultima.enviado;
  for (const siguiente of [L + 1, L + 2]) {
    const p = await pedir(urlDe(siguiente), siguiente, r);
    const enPared = pared();
    if (!p || p.estado !== 200 || !p.firma) break;
    if (p.llegada - p.enviado > ref + RETENIDO_SI_TARDA_MAS_MS) {
      const hora = roundTime(siguiente);
      medida = { desfase: hora + AVISO_Y_VUELTA_S - enPared, comprobado: true, piso: { llegada: p.llegada, hora } };
      return { comprobado: true };
    }
  }
  // Sin pedido retenido: la medida gruesa, que no corrige un reloj sano.
  if (!medida.comprobado) {
    const llegada = pared();
    const d = desfaseDe(L, llegada - ref / 1000, llegada);
    medida = { desfase: d, comprobado: false, piso: medida.piso };
  }
  return { comprobado: medida.comprobado };
}
