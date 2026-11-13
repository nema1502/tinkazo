import { roundTime, targetRound } from "../protocol/quicknet";
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
 *    con otra ronda, hasta tres intentos en total, como siempre. Cada ronda nueva
 *    nace un poco más lejos que la anterior (`MAS_LEJOS_POR_INTENTO_S`): si la red
 *    tardó una vez, lo más probable es que vuelva a tardar lo mismo.
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
  /**
   * Una ronda nueva, con el margen de siempre más `masLejosS` segundos, contada desde
   * ahora. Sin ella (el sello que se vuelve a intentar después de "Seguir sin sello")
   * la ronda es una sola: lo que se arregla con otra ronda no se arregla, y sale el
   * error. Sellar otra ronda sería otro sorteo, nunca "anclar" el que ya se sorteó.
   */
  rondaNueva?: (masLejosS?: number) => { round: number; ts: number };
  /** Falló sin dejar nada en la cadena, de una forma que se arregla con otra ronda (`selloSinGrabar`). */
  sinGrabar: (e: unknown) => boolean;
  /** Guarda (o borra, con `null`) el intento del que no se sabe si entró. */
  guardarPendiente: (intento: IntentoDeSello | null) => void;
  dormir?: (ms: number) => Promise<void>;
  /**
   * Para la línea de estado: se está averiguando, se va a volver a probar tras un corte,
   * o se va a probar con una ronda más lejana porque la de antes no quedó grabada.
   */
  avisar?: (que: "verificando" | "reintentando" | "otra-ronda") => void;
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
 * Cuánto más lejos nace cada ronda nueva cuando la anterior no quedó grabada: 20 s la
 * segunda vez y 40 s la tercera, sobre el margen de siempre (45 s con cuenta).
 *
 * Con el mismo margen, una red lenta falla las tres veces igual. Se midió el 8 de
 * noviembre de 2026 contra la testnet, con el portero en local: del clic al ledger
 * pasaban de 17 a 21 s, y la ronda a 45 s llegaba al ledger con 25 a 28 s de margen,
 * menos de los 30 que exige el contrato (`RoundTooSoon`). Con 20 s más alcanza y
 * sobra. Más lejos es siempre seguro para el sorteo: solo se espera un poco más.
 */
export const MAS_LEJOS_POR_INTENTO_S = 20;

/**
 * El margen del primer intento cuando la comisión la paga el portero del patrocinio
 * (`workers/patrocinio`): 65 s en vez de los 45 de siempre (`ANCHOR_LEAD_SECONDS`).
 *
 * Ese camino hace unas cinco llamadas a la red antes de que el sello llegue a un ledger:
 * dos del sitio (armar y simular) y tres del portero (revisar, envolver y mandar). Se
 * midió el 8 de noviembre de 2026: en mainnet cada llamada al RPC tarda de 1,6 a 2,1 s, y
 * con 45 s la ronda llegaba al ledger con 25 a 28 s, menos de los 30 que exige el contrato
 * (`RoundTooSoon`). El primer sello fallaba y gastaba un sello del cupo y la comisión del
 * patrocinador. Con 20 s más entra a la primera. Sin portero (Freighter, o una cuenta que
 * paga su comisión) el margen sigue como siempre.
 */
export const MARGEN_CON_PORTERO_S = 65;

/**
 * Con cuántos segundos nace la ronda del primer intento: el margen del camino (el de
 * siempre, o `MARGEN_CON_PORTERO_S` si paga el portero, nunca menos de lo que pida la
 * URL) más lo que se deja para aprobar a mano (`margenParaAprobar`, solo Freighter).
 */
export function margenDelPrimerIntento(lead: number, o: { conPortero: boolean; paraAprobar: number }): number {
  return (o.conPortero ? Math.max(lead, MARGEN_CON_PORTERO_S) : lead) + o.paraAprobar;
}

/**
 * La ronda de cada intento, contada desde ahora: el margen del camino más `masLejosS`
 * (`MAS_LEJOS_POR_INTENTO_S` por cada ronda que no quedó grabada). Es la que pasa a
 * `PasosDelSello.rondaNueva`, y la pantalla muestra la cuenta y la hora de la que salga.
 */
export function rondasDesde(margenS: number, ahoraS: () => number = () => Math.floor(Date.now() / 1000)): (masLejosS?: number) => { round: number; ts: number } {
  return (masLejosS = 0) => {
    const ahora = ahoraS();
    return { round: targetRound(ahora, margenS + masLejosS), ts: ahora };
  };
}

/**
 * Cuánto queda a la vista el aviso de que se prueba con otra ronda (`txOtraRonda`) antes de
 * seguir: sin esta espera, "Armando el sello…" lo pisaba enseguida y casi no se leía. Se
 * espera antes de elegir la ronda nueva, así no le quita margen.
 */
export const AVISO_OTRA_RONDA_MS = 1500;

/**
 * Un corte de red que se puede reintentar sin miedo: pasó antes de mandar nada.
 * La espera de la cuenta de Pollar que se quedó sin red ya esperó 90 segundos: no
 * se vuelve a esperar.
 */
function corteAntesDeMandar(e: unknown): boolean {
  return esDeRed(e) && !/account-check-network/.test(textoDelError(e));
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Averigua si un intento pendiente entró, sin mandar ningún sello. Es para quien no va a sellar de nuevo pero tiene que
 * saber si la lista ya quedó sellada: "Seguir sin sello" (`freeze.ts`) no puede mandar otro sello de una lista que ya
 * tiene uno, porque el contrato no lo impide y quedarían dos.
 *
 * - Entró: lo dice y NO lo borra. Quien sigue lo retoma con `sellarSinDuplicar(..., pendiente)`, que lo borra al terminar.
 * - No entró ni puede entrar: lo borra.
 * - No se pudo averiguar: queda guardado, y el próximo intento empieza por ahí.
 */
export async function averiguarPendiente(pendiente: IntentoDeSello, p: Pick<PasosDelSello, "resolver" | "guardarPendiente" | "avisar">): Promise<Resolucion> {
  p.avisar?.("verificando");
  const r = await p.resolver(pendiente);
  if (r.estado === "no-entro") p.guardarPendiente(null);
  return r;
}

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
        if (otrasRondas >= OTRAS_RONDAS || !p.rondaNueva) throw e.cause instanceof Error ? e.cause : e;
        otrasRondas++;
        p.avisar?.("otra-ronda");
        await dormir(AVISO_OTRA_RONDA_MS);
        ({ round, ts } = p.rondaNueva(MAS_LEJOS_POR_INTENTO_S * otrasRondas));
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
        // gastaba uno de los dos cambios de ronda. Lo que ya se había alejado por rondas que
        // no quedaron grabadas se conserva (sin ninguna, es el margen de siempre): un corte no
        // borra que la red venía lenta.
        if (p.rondaNueva) ({ round, ts } = p.rondaNueva(MAS_LEJOS_POR_INTENTO_S * otrasRondas));
        continue;
      }
      if (p.rondaNueva && p.sinGrabar(e) && otrasRondas < OTRAS_RONDAS) {
        otrasRondas++;
        p.avisar?.("otra-ronda");
        await dormir(AVISO_OTRA_RONDA_MS);
        ({ round, ts } = p.rondaNueva(MAS_LEJOS_POR_INTENTO_S * otrasRondas));
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
