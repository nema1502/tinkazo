import { roundTime } from "../protocol/quicknet";
import { type IntentoDeSello, type Resolucion, esSelloIncierto } from "../stellar/envio";
import { esDeRed, textoDelError } from "../stellar/errores";

/**
 * Sellar sin dejar nunca dos sellos de la misma lista.
 *
 * Es el lazo de `freeze.ts`, sin la pantalla, para poder probarlo. Las reglas:
 *
 * 1. Si quedó un intento que no se sabe si entró (de recién, o de antes de
 *    recargar la página), primero se averigua. Si entró, ese es el sello: no se
 *    manda otro. Si no se puede averiguar, no se manda nada.
 * 2. Si el envío se corta y no se sabe si entró (`SelloIncierto`), se averigua
 *    antes de hacer cualquier otra cosa. Entró: listo. No entró ni puede entrar:
 *    se prueba con otra ronda. No se sabe: se guarda y se le dice a la persona.
 * 3. Si la red no contestó antes de mandar nada (al armar o simular), se vuelve a
 *    probar dos veces, con una espera que crece: no hay nada en el aire.
 * 4. Si el sello falló sin dejar nada por la ronda (`selloSinGrabar`), se prueba
 *    con otra ronda, hasta tres intentos en total, como siempre.
 */

export interface SelloHecho {
  raffleId: bigint;
  txHash?: string;
  round: number;
  /** El momento del sello (segundos) que se anota: el del intento que entró. */
  ts: number;
  /** Si el sello que quedó es el de un intento anterior (con su premio y sus ganadores). */
  retomado?: IntentoDeSello;
}

export interface PasosDelSello {
  /** Sella con esa ronda (`sealOnChain`). */
  sellar: (round: number) => Promise<{ raffleId: bigint; txHash: string }>;
  /** Averigua si un intento entró (`resolverSelloEnLaRed`). */
  resolver: (intento: IntentoDeSello) => Promise<Resolucion>;
  /** Una ronda nueva, con el margen de siempre, contada desde ahora. */
  rondaNueva: () => { round: number; ts: number };
  /** Falló sin dejar nada en la cadena, de una forma que se arregla con otra ronda (`selloSinGrabar`). */
  sinGrabar: (e: unknown) => boolean;
  /** Guarda (o borra, con `null`) el intento del que no se sabe si entró. */
  guardarPendiente: (intento: IntentoDeSello | null) => void;
  dormir?: (ms: number) => Promise<void>;
  /** Para la línea de estado: se está averiguando, o se va a volver a probar. */
  avisar?: (que: "verificando" | "reintentando") => void;
}

/** No se pudo averiguar si un sello entró. Queda guardado: el próximo intento empieza por ahí. */
export class SelloSinConfirmar extends Error {
  readonly intento: IntentoDeSello;
  constructor(intento: IntentoDeSello, causa: unknown) {
    super("sin-confirmar", { cause: causa });
    this.name = "SelloSinConfirmar";
    this.intento = intento;
  }
}

/** Cuántas veces se prueba con otra ronda, además de la primera. */
const OTRAS_RONDAS = 2;
/** Cuántas veces se reintenta un corte antes de mandar nada. */
const OTRAS_POR_RED = 2;

/**
 * Un corte de red que se puede reintentar sin miedo: pasó antes de mandar nada.
 * La espera de la cuenta de Pollar que se quedó sin red ya esperó 90 segundos: no
 * se vuelve a esperar.
 */
function corteAntesDeMandar(e: unknown): boolean {
  return esDeRed(e) && !/account-check-network/.test(textoDelError(e));
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function sellarSinDuplicar(
  inicial: { round: number; ts: number },
  p: PasosDelSello,
  pendiente?: IntentoDeSello | null,
): Promise<SelloHecho> {
  const dormir = p.dormir ?? dormirDeVerdad;
  if (pendiente) {
    p.avisar?.("verificando");
    const r = await p.resolver(pendiente);
    if (r.estado === "entro") {
      p.guardarPendiente(null);
      return { raffleId: BigInt(r.raffleId), ...(r.hash ? { txHash: r.hash } : {}), round: pendiente.round, ts: pendiente.desde, retomado: pendiente };
    }
    if (r.estado === "no-se-sabe") throw new SelloSinConfirmar(pendiente, r.error);
    p.guardarPendiente(null);
  }

  let { round, ts } = inicial;
  let otrasRondas = 0;
  let otrasPorRed = 0;
  for (;;) {
    try {
      const res = await p.sellar(round);
      return { raffleId: res.raffleId, txHash: res.txHash, round, ts };
    } catch (e) {
      if (esSelloIncierto(e)) {
        p.guardarPendiente(e.intento);
        p.avisar?.("verificando");
        const r = await p.resolver(e.intento);
        if (r.estado === "entro") {
          p.guardarPendiente(null);
          return { raffleId: BigInt(r.raffleId), ...(r.hash ? { txHash: r.hash } : {}), round: e.intento.round, ts };
        }
        if (r.estado === "no-se-sabe") throw new SelloSinConfirmar(e.intento, e.cause ?? r.error);
        // No entró ni va a entrar: es como una ronda que quedó cerca.
        p.guardarPendiente(null);
        if (otrasRondas >= OTRAS_RONDAS) throw e.cause instanceof Error ? e.cause : e;
        otrasRondas++;
        ({ round, ts } = p.rondaNueva());
        continue;
      }
      if (corteAntesDeMandar(e) && otrasPorRed < OTRAS_POR_RED) {
        otrasPorRed++;
        p.avisar?.("reintentando");
        await dormir(1500 * otrasPorRed);
        // No se mandó nada: la ronda se vuelve a elegir desde ahora, con el margen entero.
        // Conservarla mientras "todavía alcanzara" competía por décimas de segundo con el
        // chequeo de `sellar` (anchor.ts, el mismo umbral de 40 s): medido el 21 de octubre
        // de 2026 en la testnet con la red cortada 4 s, caía en "la ronda quedó cerca" y
        // gastaba uno de los dos cambios de ronda.
        ({ round, ts } = p.rondaNueva());
        continue;
      }
      if (p.sinGrabar(e) && otrasRondas < OTRAS_RONDAS) {
        otrasRondas++;
        ({ round, ts } = p.rondaNueva());
        continue;
      }
      throw e;
    }
  }
}

/* ------------------------------------------- el intento que quedó en el aire */

/** Dónde se guarda el intento del que no se sabe si entró, por si la página se recarga. */
export const CLAVE_PENDIENTE = "tinkazo.sello.pendiente";

/** Lo que se guarda: el intento, la red y el contrato (en otra red no vale) y el premio tal como se escribió. */
interface Guardado {
  intento: IntentoDeSello;
  red: string;
  contrato: string;
  premio: string;
}

/** El mismo, en memoria: sin almacenamiento (una ventana privada) dura lo que la pestaña. */
let enMemoria: Guardado | null = null;

/**
 * Cuánto vale un intento pendiente: seis horas después de su ronda. Para
 * entonces, si había entrado, figura en Mis sorteos como un sorteo sin sortear
 * (Mis sorteos también lee el contrato), y buscarlo entre todos los sellos de
 * esas horas sería lento: si no se pudiera, la lista quedaría trabada para
 * siempre. Pasado ese tiempo se puede volver a sellar la misma lista.
 */
export const VIDA_DEL_PENDIENTE_S = 6 * 3600;

/**
 * Lee el intento pendiente de esta cuenta y esta lista, en esta red y con este
 * contrato. Con algo que no se entiende, o vencido, no hay pendiente.
 */
export function leerPendiente(
  organizer: string,
  listHash: string,
  red: string,
  contrato: string,
  ahoraS = Date.now() / 1000,
): { intento: IntentoDeSello; premio: string } | null {
  let g: Partial<Guardado> | null = enMemoria;
  if (!g) {
    try {
      const raw = localStorage.getItem(CLAVE_PENDIENTE);
      g = raw ? (JSON.parse(raw) as Partial<Guardado>) : null;
    } catch {
      g = null;
    }
  }
  const i = g?.intento;
  if (!g || !i || typeof i.round !== "number" || typeof i.organizer !== "string" || typeof i.listHash !== "string") return null;
  if (i.organizer !== organizer || i.listHash !== listHash || g.red !== red || g.contrato !== contrato) return null;
  if (roundTime(i.round) < ahoraS - VIDA_DEL_PENDIENTE_S) return null;
  return { intento: i, premio: typeof g.premio === "string" ? g.premio : "" };
}

/** Guarda el intento pendiente (uno solo: el último), o lo borra con `null`. */
export function guardarPendiente(intento: IntentoDeSello | null, red: string, contrato: string, premio: string): void {
  enMemoria = intento ? { intento, red, contrato, premio } : null;
  try {
    if (!enMemoria) localStorage.removeItem(CLAVE_PENDIENTE);
    else localStorage.setItem(CLAVE_PENDIENTE, JSON.stringify(enMemoria));
  } catch {
    /* sin almacenamiento: queda en memoria mientras dure la pestaña */
  }
}
