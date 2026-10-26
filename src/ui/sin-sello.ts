import { roundTime } from "../protocol/quicknet";
import type { IntentoDeSello, Resolucion } from "../stellar/envio";
import { type SelloHecho, SelloSinConfirmar, sellarSinDuplicar } from "./sello-seguro";

/**
 * "Seguir sin sello", y volver a intentar el sello después.
 *
 * Cuando sellar no se puede (la red no contesta, cuesta más de lo que se paga) y quien
 * organiza decide seguir, el sorteo corre en modo libre: la lista se cierra igual
 * (se calcula su huella en el navegador), pero nadie atestigua en la cadena que se
 * cerró antes de que existiera el número. Ese sorteo **no se puede comprobar**.
 *
 * La ronda es una sola, a 90 segundos (`SIN_SELLO_LEAD_SECONDS`), y deja unos 50 para
 * seguir intentando: hasta 40 segundos antes de la ronda el contrato todavía acepta el
 * sello (lo pide 30 antes y 10 de margen para que entre). Si entra, con la **misma
 * lista y la misma ronda**, el sorteo queda anclado como cualquier otro: el mismo
 * ganador, ahora comprobable. Si no entra, queda sin sello para siempre, y el
 * resultado, lo compartido, Mis sorteos y el evento lo dicen.
 *
 * Lo que nunca se hace: sellar otra ronda. Eso es otro sorteo con otro ganador posible
 * (el único ataque abierto contra Tinkazo es elegir entre varios sellos de la misma
 * lista): sin `rondaNueva`, `sellarSinDuplicar` no cambia de ronda, y los errores que
 * se arreglan con otra ronda terminan el intento.
 */

/** Hasta cuántos segundos antes de la ronda se sigue intentando. */
export const MARGEN_DEL_REINTENTO_S = 40;
/** Cada cuánto se vuelve a intentar solo. */
export const CADA_REINTENTO_MS = 15_000;

export type FinDelReintento =
  /** Entró, con la misma lista y la misma ronda. */
  | { estado: "entro"; hecho: SelloHecho }
  /** Se acabó el tiempo (o la ronda quedó cerca): sin sello para siempre. */
  | { estado: "vencio" }
  /** Se mandó y no se pudo saber si entró. Queda guardado para averiguarlo. */
  | { estado: "incierto"; intento: IntentoDeSello }
  /** Se canceló (nuevo sorteo, otra cuenta). */
  | { estado: "cancelado" };

export interface ParametrosDelReintento {
  /** La ronda del sorteo: una sola, nunca otra. */
  round: number;
  /** El momento del sorteo (segundos) que se anota si el sello entra. */
  ts: number;
  sellar: (round: number) => Promise<{ raffleId: bigint; txHash: string }>;
  resolver: (intento: IntentoDeSello) => Promise<Resolucion>;
  /** Falló sin dejar nada en la cadena, de una forma que se arregla con otra ronda: acá no hay otra. */
  sinGrabar: (e: unknown) => boolean;
  guardarPendiente: (intento: IntentoDeSello | null) => void;
  /** Cada intento que empieza (1, 2, 3…): la pantalla lo cuenta. */
  alIntento?: (n: number) => void;
  /** Cada intento que no entró, con su error: va al registro. */
  alFallar?: (n: number, e: unknown) => void;
  cadaMs?: number;
  /** Hasta cuándo, en segundos Unix. Por defecto, 40 s antes de la ronda. */
  hastaS?: number;
  /** Reloj en milisegundos. */
  ahora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  avisar?: (que: "verificando" | "reintentando") => void;
}

const dormirDeVerdad = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface Reintento {
  fin: Promise<FinDelReintento>;
  /** "Volver a intentar el sello": sin esperar a los 15 s. */
  reintentarYa(): void;
  cancelar(): void;
  /** Hay un intento en curso (el botón de volver a intentar se apaga). */
  enCurso(): boolean;
}

/** Cuándo vence el reintento de una ronda, en segundos Unix. */
export const hastaDelReintento = (round: number): number => roundTime(round) - MARGEN_DEL_REINTENTO_S;

export function reintentarSello(p: ParametrosDelReintento): Reintento {
  const ahora = p.ahora ?? Date.now;
  const dormir = p.dormir ?? dormirDeVerdad;
  const cadaMs = p.cadaMs ?? CADA_REINTENTO_MS;
  const hastaS = p.hastaS ?? hastaDelReintento(p.round);
  let cancelado = false;
  let ocupado = false;
  let despertar: (() => void) | null = null;

  const fin = (async (): Promise<FinDelReintento> => {
    for (let n = 1; ; n++) {
      if (cancelado) return { estado: "cancelado" };
      if (ahora() / 1000 >= hastaS) return { estado: "vencio" };
      p.alIntento?.(n);
      ocupado = true;
      try {
        const hecho = await sellarSinDuplicar(
          { round: p.round, ts: p.ts },
          {
            sellar: p.sellar,
            resolver: p.resolver,
            sinGrabar: p.sinGrabar,
            guardarPendiente: p.guardarPendiente,
            dormir,
            ...(p.avisar ? { avisar: p.avisar } : {}),
            // Sin `rondaNueva`: la ronda es esta.
          },
          null,
        );
        return { estado: "entro", hecho };
      } catch (e) {
        if (e instanceof SelloSinConfirmar) return { estado: "incierto", intento: e.intento };
        p.alFallar?.(n, e);
        // La ronda quedó cerca (o el sello entró y falló): con otra ronda sería otro sorteo. Se terminó.
        if (p.sinGrabar(e)) return { estado: "vencio" };
        // La red no contestó, o no alcanzó la comisión: se vuelve a intentar con la misma ronda.
      } finally {
        ocupado = false;
      }
      if (cancelado) return { estado: "cancelado" };
      const falta = Math.max(0, hastaS * 1000 - ahora());
      if (falta <= 0) return { estado: "vencio" };
      await Promise.race([dormir(Math.min(cadaMs, falta)), new Promise<void>((r) => (despertar = r))]);
      despertar = null;
    }
  })();

  return {
    fin,
    reintentarYa: () => {
      if (!ocupado) despertar?.();
    },
    cancelar: () => {
      cancelado = true;
      despertar?.();
    },
    enCurso: () => ocupado,
  };
}
