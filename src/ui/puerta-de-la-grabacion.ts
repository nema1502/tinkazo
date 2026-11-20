import type { EstadoDelShow } from "../games/en-hora";

/**
 * Cuándo graba la sala el sorteo, si hay celulares mirando.
 *
 * El celular de quien mira juega a la par de la sala y retiene su juego en el momento decisivo (`games/en-hora.ts`)
 * hasta ver el sorteo grabado en la cadena. Para que eso alcance, lo grabado tiene que querer decir algo preciso: o la
 * sala va a la par (su juego arrancó a la hora del ancla y sigue a horario, así que va delante de todo celular), o la
 * sala ya mostró quién gana. Por eso la sala elige cuándo grabar:
 *
 * - **Sin celulares** (nunca se vio un QR de este sello): como siempre, apenas la cadena lo acepta.
 * - **A la par**: también apenas la cadena lo acepta, y la par se mira justo en ese momento (con la pestaña a la
 *   vista). Desde ahí la sala ya no se pausa si se esconde: al volver se pone al día (`ponerseAlDiaAlVolver`).
 * - **Si no**: después de mostrar quién gana (el cartel del juego, o el resultado sin show).
 *
 * Así una sala que lanzó tarde (el botón tocado después, un Reintentar, una compuerta del modo Oficial que tardó, la
 * pestaña dormida, la billetera propia que graba al final) no suelta el final de los celulares antes que el suyo. Otro sí
 * puede: `draw` no pide permiso y cualquiera puede grabar el sorteo apenas la cadena lo acepta (`docs/amenazas.md`).
 */

/** El atraso del juego de la sala que todavía cuenta como a la par, en segundos: lo deja el último cuadro. */
export const ATRASO_TOLERADO_S = 0.15;

/** Lo que la sala sabe de sí misma al momento de grabar. */
export interface ParaGrabar {
  /** Se vio un QR de espectadores de este sello. */
  conEspectadores: boolean;
  /** Después de mostrar el QR cambió el juego o la duración: algún celular puede tener el de antes. */
  cambioConQr: boolean;
  /** Su número llegó con el pedido retenido y una ida y vuelta corta (`salaALaParPorElAncla`). */
  anclaALaPar: boolean;
  /** El juego y el ritmo que juega son los del enlace del QR. */
  mismoJuego: boolean;
  /** Cómo va su juego con horario, o null si no hay (el motor de respaldo, sin show, sin horario). */
  show: EstadoDelShow | null;
}

/** Si la sala va a la par: lo grabado puede salir mientras juega. */
export function salaALaPar(e: ParaGrabar): boolean {
  const s = e.show;
  // Escondida justo ahora no cuenta: su atraso es el de antes de esconderse y, al volver, se pausa (`en-hora.ts`).
  return e.anclaALaPar && !e.cambioConQr && e.mismoJuego && !!s && s.arranco && !s.reanclado && !s.seEscondio && !s.oculto && s.atraso <= ATRASO_TOLERADO_S;
}

export type Apertura = "sin-espectadores" | "a-la-par" | "tras-la-corona";

/**
 * La puerta: se abre cuando la sala puede grabar. `grabable` es la hora de la ronda (segundos) desde la que la cadena
 * acepta el sorteo, `ahora` el reloj de la ronda en ms, `aLaPar` se pregunta justo a esa hora y `coronada` se cumple
 * cuando la sala muestra quién gana.
 */
export async function puertaDeLaGrabacion(o: {
  conEspectadores: boolean;
  grabable: number;
  ahora: () => number;
  aLaPar: () => boolean;
  coronada: Promise<unknown>;
  dormir?: (ms: number) => Promise<void>;
}): Promise<Apertura> {
  if (!o.conEspectadores) return "sin-espectadores";
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const corona = o.coronada.then((): Apertura => "tras-la-corona");
  const aTiempo = (async (): Promise<Apertura | null> => {
    const falta = o.grabable * 1000 - o.ahora();
    if (falta > 0) await dormir(falta);
    return o.aLaPar() ? "a-la-par" : null;
  })();
  const primero = await Promise.race([corona, aTiempo]);
  return primero ?? (await corona);
}
