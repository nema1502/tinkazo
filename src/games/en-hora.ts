/**
 * El show a una hora fija: el reloj del juego cuando la sala o el celular de quien mira lo lanzan con horario.
 *
 * Sin horario (la demo, el ensayo, un sorteo lanzado con el botón, ver de nuevo) el estadio corre como siempre: un paso
 * por cuadro, de 0,05 s como mucho, y una pantalla que dibuja menos de 20 cuadros por segundo estira el juego.
 *
 * Con horario (`pedirHorario`, lo toma el estadio al arrancar como toma la compuerta de la tarjeta) el juego sigue una
 * hora del reloj monótono, la que puso el ancla del número (`reloj-de-la-ronda.ts`, `arranque-del-show.ts`):
 *
 * - **Cuenta desde la hora fijada**, no desde el primer cuadro: si el primer cuadro llega unas décimas tarde, el juego
 *   se las salta y sigue a horario. La sala que arranca más de 1,5 s tarde arranca desde cero y queda marcada
 *   (`reanclado`): ya no va a la par.
 * - **Va con el reloj de verdad**: cada cuadro se reparte en pasos de 0,05 s como mucho (`PASO_S`), así el juego que
 *   pasa por cada paso es el de siempre, y en una pantalla lenta el juego no se atrasa. Lo caro se paga una vez por
 *   cuadro: el 3D se dibuja solo en el último paso (`pasoIntermedio`), y un cuadro no da más de 12 pasos (40 al
 *   ponerse al día, con un tope de tiempo). Lo que no alcanza queda como atraso.
 * - **La sala se pausa al esconderse** (la pestaña escondida no dibuja): vuelve donde estaba y queda marcada
 *   (`seEscondio`). Mientras está escondida queda marcada como `oculto`: ningún cuadro corre, así que su atraso es el de
 *   antes de esconderse y no dice nada. El celular, con `alcanzar`, se pone al día: los pasos que faltan, con los
 *   efectos callados para que no suenen de golpe los de los segundos que se saltan (la música sigue). La sala que ya
 *   grabó a la par (`ponerseAlDiaAlVolver`) tampoco se pausa: lo grabado soltó el final de los celulares, que siguen a
 *   horario, y la sala no puede quedar atrás de ellos. Al volver se pone al día igual que el celular.
 * - **El celular retiene el final** (`retener`): el juego no pasa de su momento decisivo (lo dice cada juego, el estadio
 *   lo pregunta) hasta `soltarElFinal()`. Mientras retiene se sigue dibujando (la cámara respira con el reloj de
 *   verdad) y el horario se corre: al soltar, el juego sigue desde ahí, sin saltar.
 *
 * El estadio cuenta lo que pasó (`estado`): la sala lo mira para saber si va a la par antes de grabar el sorteo.
 * `cuadro` recibe el paso del juego, que devuelve `false` si el juego terminó adentro de él (cerró el estadio).
 */

/** El paso más largo que recibe un juego, en segundos de reloj: el de siempre. */
export const PASO_S = 0.05;
/** Los pasos que da un cuadro como mucho: medio segundo. */
const PASOS_POR_CUADRO = 12;
/** Al ponerse al día (más de medio segundo atrás), hasta cuarenta pasos por cuadro, sin pasar este tiempo de cálculo. */
const PASOS_AL_PONERSE = 40;
const TOPE_AL_PONERSE_MS = 28;
/** Con más que esto de atraso, el cuadro se pone al día. */
const PONERSE_DESDE_S = 0.5;
/** Los efectos se callan mientras falte más que esto: los del último tramo suenan. */
const CALLAR_SI_FALTAN_S = 0.3;
/** La sala que arranca más tarde que esto arranca desde cero. */
export const TARDE_PARA_ARRANCAR_S = 1.5;

export interface Horario {
  /** El reloj monótono (`performance.now`, ms) en que el juego tiene que estar en su segundo 0. */
  inicio: number;
  /** El celular: el juego no pasa de su momento decisivo hasta `soltarElFinal()`. */
  retener?: boolean;
  /** El celular: si queda atrás (entró tarde, se le apagó la pantalla), se pone al día. Sin esto, se pausa. */
  alcanzar?: boolean;
}

export interface Avisos {
  /** El primer cuadro: cuántos segundos tarde llegó respecto de la hora fijada (negativo, antes). */
  alArrancar?(tarde: number): void;
  /** Llegó al momento decisivo y lo retiene. */
  alRetener?(): void;
  /** Se soltó el final. */
  alSoltar?(): void;
  /** Se ve el cartel de quien gana. */
  alCoronar?(): void;
  /** Empieza o termina de ponerse al día. */
  alPonerseAlDia?(en: boolean): void;
}

export interface EstadoDelShow {
  arranco: boolean;
  /** Segundos tarde del primer cuadro respecto de la hora fijada. */
  tardeAlArrancar: number;
  /** Arrancó desde cero, no a la hora fijada. */
  reanclado: boolean;
  /** Segundos de juego que faltan para estar a horario. */
  atraso: number;
  /** Se escondió la pestaña y el juego se pausó. */
  seEscondio: boolean;
  /** La pestaña está escondida ahora: no corre ningún cuadro y el atraso es el de antes de esconderse. */
  oculto: boolean;
  /** Está o estuvo retenido en el momento decisivo. */
  retenido: boolean;
  /** Segundos que estuvo retenido. */
  retenidoS: number;
  /** Se vio el cartel de quien gana. */
  coronado: boolean;
}

let pedido: { horario: Horario; avisos: Avisos } | null = null;
let soltado = false;
let intermedio = false;
let actual: EstadoDelShow | null = null;
let avisosActuales: Avisos = {};
let alVolverSePoneAlDia = false;

/** Pide el horario del próximo show (o ninguno, con null). El estadio lo toma una sola vez al arrancar. */
export function pedirHorario(h: Horario | null, avisos: Avisos = {}): void {
  pedido = h ? { horario: h, avisos } : null;
  soltado = false;
  actual = null;
  avisosActuales = avisos;
  alVolverSePoneAlDia = false;
}

/** Lo toma el estadio: después ya no está. */
export function tomarHorario(): { horario: Horario; avisos: Avisos } | null {
  const p = pedido;
  pedido = null;
  return p;
}

let cierre: (() => void) | null = null;
/** El estadio que corre con horario se anota para que lo puedan cerrar (`cerrarElShow`). */
export function anotarCierre(fn: (() => void) | null): void {
  cierre = fn;
}
/**
 * Cierra el show con horario sin soltar su final: el celular que vio que lo grabado no es lo que calculó. Como el final
 * nunca se soltó, no mostró quién gana.
 */
export function cerrarElShow(): void {
  const c = cierre;
  cierre = null;
  c?.();
}

/** Suelta el final retenido (el celular vio lo grabado, o la sala dijo que arrancó a la par). */
export function soltarElFinal(): void {
  if (soltado) return;
  soltado = true;
  avisosActuales.alSoltar?.();
}

export const finalSoltado = (): boolean => soltado;

/**
 * La sala grabó a la par (`puerta-de-la-grabacion.ts`): lo grabado suelta el final de los celulares, que siguen a
 * horario. Desde ahora, si la pestaña de la sala se esconde, al volver se pone al día como el celular, en vez de pausarse.
 * Vale hasta el próximo show (`pedirHorario`).
 */
export function ponerseAlDiaAlVolver(): void {
  alVolverSePoneAlDia = true;
}

/** El estado del show con horario que corre (o el último), o null si no hubo. */
export const estadoDelShow = (): EstadoDelShow | null => actual;

/** Si el paso que corre ahora no es el último del cuadro: el 3D no se dibuja en él (`tres/enchufe.ts`). */
export const pasoIntermedio = (): boolean => intermedio;

/** El estadio avisa que se ve el cartel de quien gana. */
export function avisarCorona(): void {
  if (!actual || actual.coronado) return;
  actual.coronado = true;
  avisosActuales.alCoronar?.();
}

export interface OpcionesDelReloj {
  /** El factor del ritmo (`paceFactor`): el juego recibe `paso / ritmo`. */
  ritmo: number;
  avisos?: Avisos;
  /** Calla o devuelve los efectos de sonido. */
  callar?: (callado: boolean) => void;
  /** El reloj monótono, para el tope de cálculo al ponerse al día. */
  ahora?: () => number;
}

/**
 * El reloj de un show con horario. `cuadro(now, paso, decisivo)` lo llama el estadio en cada cuadro, con la hora del
 * cuadro (ms del reloj monótono), el paso del juego (`dt` en segundos de juego y la hora del show en segundos de reloj,
 * para la cámara) y si el juego ya llegó a su momento decisivo.
 */
export function relojDelShow(horario: Horario, o: OpcionesDelReloj) {
  const avisos = o.avisos ?? {};
  const ahora = o.ahora ?? (() => performance.now());
  const estado: EstadoDelShow = { arranco: false, tardeAlArrancar: 0, reanclado: false, atraso: 0, seEscondio: false, oculto: false, retenido: false, retenidoS: 0, coronado: false };
  actual = estado;
  avisosActuales = avisos;
  /** El segundo 0 del juego, corrido por las pausas y lo retenido. */
  let inicio = horario.inicio;
  /** El segundo 0 sin correr: la cámara respira con esa hora. */
  let inicio0 = horario.inicio;
  /** Segundos de reloj de juego ya corridos. */
  let hecho = 0;
  let ocultoDesde = -1;
  let poniendose = false;
  let callado = false;
  const callar = (c: boolean): void => {
    if (c === callado) return;
    callado = c;
    o.callar?.(c);
  };

  return {
    estado,
    /** La pestaña se escondió (la sala se pausa al volver). */
    esconder(now: number): void {
      estado.oculto = true;
      if (ocultoDesde < 0) ocultoDesde = now;
    },
    /** La pestaña volvió: la sala corre su horario lo que estuvo escondida; el celular, y la sala que grabó a la par, se ponen al día. */
    mostrar(now: number): void {
      estado.oculto = false;
      if (ocultoDesde < 0) return;
      const pausa = now - ocultoDesde;
      ocultoDesde = -1;
      if (!estado.arranco || horario.alcanzar || alVolverSePoneAlDia || pausa <= 0) return;
      inicio += pausa;
      estado.seEscondio = true;
    },
    /** El segundo 0 del juego en el reloj monótono (el de la cámara: sin correr por las pausas ni lo retenido). */
    inicioDelJuego: (): number => inicio0,
    cuadro(now: number, paso: (dt: number, t: number) => boolean | void, decisivo: () => boolean): void {
      if (!estado.arranco) {
        estado.arranco = true;
        estado.tardeAlArrancar = (now - inicio) / 1000;
        if (!horario.alcanzar && estado.tardeAlArrancar > TARDE_PARA_ARRANCAR_S) {
          inicio = now;
          inicio0 = now;
          estado.reanclado = true;
        }
        avisos.alArrancar?.(estado.tardeAlArrancar);
      }
      const t = (now - inicio0) / 1000;
      let falta = (now - inicio) / 1000 - hecho;
      const ponerse = falta > PONERSE_DESDE_S;
      if (ponerse !== poniendose) {
        poniendose = ponerse;
        avisos.alPonerseAlDia?.(ponerse);
      }
      const max = ponerse ? PASOS_AL_PONERSE : PASOS_POR_CUADRO;
      const c0 = ahora();
      let n = 0;
      let reteniendo = false;
      while (falta > 1e-6 && n < max) {
        if (horario.retener && !soltado && decisivo()) {
          reteniendo = true;
          break;
        }
        if (ponerse && n > 0 && ahora() - c0 > TOPE_AL_PONERSE_MS) break;
        const p = Math.min(PASO_S, falta);
        callar(falta - p > CALLAR_SI_FALTAN_S);
        intermedio = falta - p > 1e-6 && n + 1 < max;
        const sigue = paso(p / o.ritmo, t);
        hecho += p;
        falta -= p;
        n++;
        // El juego terminó adentro de este paso (cerró el estadio): no hay más pasos.
        if (sigue === false) {
          falta = 0;
          break;
        }
      }
      intermedio = false;
      callar(false);
      // Sin pasos (antes de la hora, o retenido) el juego igual se dibuja: la cámara sigue respirando.
      if (n === 0) paso(0, t);
      if (!reteniendo && horario.retener && !soltado && falta > 1e-6 && decisivo()) reteniendo = true;
      if (reteniendo) {
        // Retenido: lo que faltaba no es atraso, es tiempo quieto. El horario se corre para seguir desde acá.
        inicio += falta * 1000;
        estado.retenidoS += falta;
        falta = 0;
        if (!estado.retenido) {
          estado.retenido = true;
          avisos.alRetener?.();
        }
      }
      estado.atraso = Math.max(0, falta);
    },
  };
}
