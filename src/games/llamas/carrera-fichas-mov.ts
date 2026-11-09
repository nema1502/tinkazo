/**
 * El movimiento de las fichas de nombre de la carrera, puro (sin Pixi): una ficha va con su llama, con el mismo tope de paso, y nunca salta.
 *
 * `carrera-fichas.ts` decide cada cuadro dónde cae cada ficha para no pisar a otra (un renglón más arriba, más abajo, un nombre más corto, o
 * callarla) y esa decisión cambia de golpe: una ficha saltaba un renglón entero entre dos cuadros, o aparecía y desaparecía. Acá se separa lo que
 * es de la llama de lo que es de la decisión (`DIRECCION.md`, M9):
 *
 * - la **ancla** es el lugar que sigue a la llama (la misma posición con que se dibuja), sin más cuenta;
 * - la **diferencia** entre donde la decisión pone la ficha y su ancla se desliza: arranca y frena de a poco, nunca se corre más de lo que sobra del
 *   tope de paso de la llama (el tope es de 0,03 cuerpos por cuadro: 1,8 cuerpos por segundo respecto del frente del grupo) y, con la
 *   aceleración que tiene, un renglón tarda más de 0,3 s;
 * - la que se calla se apaga en 0,3 s o más, y la que aparece entra en 0,15 s.
 *
 * El deslizamiento se integra sobre una **grilla fija de pasos virtuales atada a la hora del show** (el paso `k = floor(t * 60)`): cada llamada avanza los
 * pasos enteros que van desde el último calculado hasta el de `t`, sin importar cuántos cuadros reales hubo ni cuándo cayeron. Así el estado en una hora
 * dada es el mismo en cualquier corrida (la ficha se muestra en el último paso calculado, a lo más una sesentava de segundo atrás de la llama). Un salto
 * del reloj (más de un cuarto de segundo, o ir hacia atrás) corta el deslizamiento y la ficha queda donde manda la decisión, como corresponde a un corte.
 *
 * Qué es función de la hora del paso y qué no (la decisión de renglón sale de la colocación de la pantalla, que se corre una vez por cuadro con la cámara
 * de ese cuadro y no se puede repetir para un paso que el reloj se saltó):
 *
 * - **exacto en cada paso**: lo que sobra del tope de la llama (`ObjetivoFicha.llamaEn` se evalúa en la hora de cada paso, no del cuadro), el paso mismo y la
 *   cuenta del deslizamiento, que no tienen más que el estado anterior y el objetivo;
 * - **mezclado**: la posición del objetivo (donde la decisión pone la ficha respecto de su ancla) de los pasos que un cuadro lento se salta se reparte entre
 *   el objetivo del cuadro anterior y el de este: una deriva continua (la cámara que empuja a la ficha contra el borde) cae donde caería a 60 cuadros por segundo;
 * - **lo único que depende de la cadencia**: cuándo cambia una decisión que salta (otro renglón, callarse). La ve el primer cuadro que cae en el paso y a
 *   cuadros espaciados se atribuye a pasos que ya pasaron: la diferencia es de un cuadro como mucho (una sesentava de segundo a 60 por segundo), que con el tope
 *   de la ficha son menos de 0,03 cuerpos en la posición. La prueba de cadencias lo mide con cambios entre pasos.
 */

export const FICHA = {
  /**
   * Lo más que se corre una ficha respecto del frente del grupo, en cuerpos por segundo: el tope por cuadro (0,03) a 60 cuadros por segundo es 1,8. Con cuadros más
   * seguidos que los pasos de la grilla (a 64 por segundo) algunos cuadros cargan un paso entero en menos tiempo: 1,65 deja ese 8 % de margen.
   */
  velocidadMax: 1.65,
  /** Lo mínimo que se desliza aunque la llama vaya al tope (en un pique con causa a la vista la llama ya pasa del tope sola): casi quieta, y llega cuando la llama afloja. */
  velocidadMin: 0.05,
  /** La aceleración del deslizamiento, en cuerpos por segundo cada segundo. */
  aceleracion: 2.5,
  /** Cuánto tarda en apagarse una ficha que se calla y en encenderse una que aparece, en segundos. */
  apaga: 0.3,
  enciende: 0.15,
  /** Más tiempo que esto entre dos cuadros es un corte del reloj. */
  corte: 0.25,
} as const;

export const PASOS_POR_SEGUNDO = 60;
/** El paso de la grilla de la hora `t` (0 a 1 es el paso 0 a 59/60...): siempre el mismo para la misma hora, en cualquier corrida. */
export const pasoDe = (t: number): number => Math.floor(t * PASOS_POR_SEGUNDO + 1e-9);

export interface EstadoFicha {
  /** El último paso de la grilla que se calculó. */
  k: number;
  /** El deslizamiento: lo que la ficha está corrida de su ancla, en píxeles. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  /** La transparencia de 0 (apagada) a 1. */
  alfa: number;
  /** El objetivo que se vio en el cuadro anterior: de ahí al de este cuadro se mezclan los pasos que el reloj se saltó. */
  objetivo: { ox: number; oy: number; visible: boolean };
}

export interface ObjetivoFicha {
  /** Dónde pone la decisión a la ficha respecto de su ancla, en píxeles. */
  ox: number;
  oy: number;
  /** Si la decisión la muestra. */
  visible: boolean;
  /** Cuánto se mueve el ancla de la llama respecto del frente del grupo, en cuerpos por segundo (en los pasos de la grilla, no en los cuadros): de ahí sale lo que sobra del tope. */
  llama: number;
  /**
   * Lo mismo, en la hora (de la grilla) que se pide: si viene, cada paso que avanza la ficha usa el de su propia hora y no el del cuadro, así que un cuadro lento
   * que se salta pasos no los toma con la velocidad de la llama de otro instante.
   */
  llamaEn?: ((hora: number) => number) | undefined;
}

/** El estado de una ficha que aparece donde la decisión la pone, sin deslizar. */
export function estadoNuevo(t: number, o: ObjetivoFicha): EstadoFicha {
  return { k: pasoDe(t), ox: o.ox, oy: o.oy, vx: 0, vy: 0, alfa: o.visible ? 1 : 0, objetivo: { ox: o.ox, oy: o.oy, visible: o.visible } };
}

const SUBPASOS = 2;

/**
 * Avanza la ficha hasta el paso de la hora `t`. `cuerpo` es cuántos píxeles mide un cuerpo. La velocidad con que se desliza es lo que le sobra del tope de la
 * llama: `velocidadMax` menos lo que se mueve su ancla respecto del frente (`o.llamaEn` en la hora de cada paso, o `o.llama`), y no menos de `velocidadMin`.
 */
export function pasoFicha(e: EstadoFicha, t: number, o: ObjetivoFicha, cuerpo: number): EstadoFicha {
  const k = pasoDe(t);
  const dk = k - e.k;
  if (dk === 0) return e;
  if (dk < 0 || dk > FICHA.corte * PASOS_POR_SEGUNDO) return estadoNuevo(t, o);
  const a = FICHA.aceleracion * cuerpo;
  let { ox, oy, vx, vy, alfa } = e;
  const h = 1 / (PASOS_POR_SEGUNDO * SUBPASOS);
  const ant = e.objetivo;
  for (let paso = 0; paso < dk; paso++) {
    // El objetivo de este paso: el del cuadro de ahora en el último, y en los que el reloj se saltó, mezclado con el del cuadro anterior (una deriva continua cae donde
    // caería a 60 cuadros por segundo). Una decisión que salta pudo caer en cualquiera de los pasos que se saltó: se pone a la mitad, el error más chico que se puede.
    const f = (paso + 1) / dk;
    const tx = f === 1 ? o.ox : ant.ox + (o.ox - ant.ox) * f, ty = f === 1 ? o.oy : ant.oy + (o.oy - ant.oy) * f;
    const visible = f > 0.5 ? o.visible : ant.visible;
    const llama = o.llamaEn ? o.llamaEn((e.k + paso + 1) / PASOS_POR_SEGUNDO) : o.llama;
    const vmax = Math.max(FICHA.velocidadMin, FICHA.velocidadMax - llama) * cuerpo;
    // Una ficha apagada que tiene que volver no se desliza desde donde estaba: aparece donde la decisión la pone.
    if (alfa <= 0) {
      ox = tx;
      oy = ty;
      vx = vy = 0;
    } else {
      for (let i = 0; i < SUBPASOS; i++) {
        const dx = tx - ox, dy = ty - oy;
        const dist = Math.hypot(dx, dy);
        // Ya llegó: a menos de dos milésimas de cuerpo y casi quieta.
        if (dist < 0.002 * cuerpo && Math.hypot(vx, vy) < 0.01 * cuerpo) {
          ox = tx;
          oy = ty;
          vx = vy = 0;
          break;
        }
        // La velocidad que frena justo al llegar, sin pasar del tope.
        const vd = Math.min(vmax, Math.sqrt(1.6 * a * dist));
        const wx = dist > 0 ? (dx / dist) * vd : 0, wy = dist > 0 ? (dy / dist) * vd : 0;
        let ax = wx - vx, ay = wy - vy;
        const da = Math.hypot(ax, ay), tope = a * h;
        if (da > tope) {
          ax = (ax / da) * tope;
          ay = (ay / da) * tope;
        }
        vx += ax;
        vy += ay;
        // Si la llama arranca mientras la ficha se desliza, lo que sobra del tope baja de golpe: la ficha no puede seguir a la velocidad de antes.
        const rapido = Math.hypot(vx, vy);
        if (rapido > vmax) {
          vx *= vmax / rapido;
          vy *= vmax / rapido;
        }
        ox += vx * h;
        oy += vy * h;
      }
    }
    alfa = visible ? Math.min(1, alfa + 1 / (PASOS_POR_SEGUNDO * FICHA.enciende)) : Math.max(0, alfa - 1 / (PASOS_POR_SEGUNDO * FICHA.apaga));
  }
  return { k, ox, oy, vx, vy, alfa, objetivo: { ox: o.ox, oy: o.oy, visible: o.visible } };
}
