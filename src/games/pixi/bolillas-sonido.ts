import type { Datos } from "./bolillas-plan";
import type { Categoria, Timbre } from "./kit/sonido";

/**
 * Bolillas: el sonido de los choques, puro.
 *
 * La escena pregunta, en cada cuadro, qué toca sonar a esta hora del plan. Cada turno de la cadena (S23) tiene
 * **dos golpes**: el toque blando de la mano de quien tira sobre **su** canica (un cristal suave, de evento) a la hora
 * `tMano`, y el clic fuerte de mi canica contra la del enemigo (clímax, con su brillo y su eco) a la hora `t`, más el
 * golpe seco del polvo cuando la golpeada cae en la tierra. Después, los tonos chicos que suben mientras la canica que
 * gana titila en la tiza. Todo es cosmético: nada de esto decide nada del sorteo, y la escena lo pasa por la voz del
 * kit (`k.sonido`), que nace muda cuando el estadio está en silencio (`isMuted`).
 *
 * Puro: sin audio y sin DOM, se prueba en Node (`bolillas-arte.test.ts`). Cada
 * evento lleva su clave única (la escena la suena una sola vez con
 * `sonido.una`) y sale con los grados y volúmenes de la casa
 * (`problemasDeTono` garantiza que la voz no los rechace).
 */

/** Cuánto vive un evento: la escena lo suena una sola vez, la primera vez que lo ve. */
export const VENTANA = 0.4;

/** Un sonido que la escena pasa a la voz del estadio. */
export interface EventoSonoro {
  clave: string;
  grado: number;
  cat: Categoria;
  timbre?: Timbre;
  vol?: number;
  dur?: number;
  /** Cuánto esperarlo, en milisegundos reales: el eco del cristal llega apenas después. */
  retrasoMs?: number;
}

/** El clic de cristal del impacto: agudo, corto, y se oye de verdad en un teléfono (clímax: la casa le da 0,08 a 0,12). */
const CLINK = { grado: 18, cat: "climax" as const, timbre: "square" as const, vol: 0.12, dur: 0.06 };
/**
 * El toque de la mano sobre mi canica (S23): el primer golpe de la cadena, más blando, de evento, no de clímax, para
 * que el turno se oiga como lo que es: primero la mano, después el choque de verdad.
 */
const TOQUE = { grado: 15, cat: "evento" as const, timbre: "triangle" as const, vol: 0.06, dur: 0.05 };
/** El brillo de la chispa: el vidrio que se raspa, apenas después del clic, aún más agudo y más corto. */
const BRILLO = { grado: 20, cat: "climax" as const, timbre: "sawtooth" as const, vol: 0.12, dur: 0.045, retrasoMs: 22 };
/** El eco del clic, apenas más bajo y después: suena a sala, no a tick de reloj. */
const ECO = { grado: 13, cat: "evento" as const, timbre: "square" as const, vol: 0.05, dur: 0.05, retrasoMs: 55 };

/** El golpe seco de la canica cayendo en la tierra: bajo, blando, de fondo. */
const CAE = { grado: 2, cat: "fondo" as const, timbre: "sine" as const, vol: 0.03, dur: 0.09 };

/** El golpe grave del choque: lo que hace sentir el impacto en el cuerpo, no solo en el oído. */
const GOLPE = { grado: 2, cat: "climax" as const, timbre: "sine" as const, vol: 0.12, dur: 0.14 };

/** El ritmo del titileo: un tono chico cada tanto, subiendo hasta que la canica se queda quieta. */
const TITILA_PASO = 0.3;
const TITILA_ARRANQUE = 0.15;

/** Cuánto rueda la canica que gana hasta su titileo: lo que fija `trayectoriaDe` en el plan. */
const RODADO = 2;

/**
 * Lo que toca sonar en el segundo `t`, a partir de la lista del plan y del
 * interruptor del estadio (con el mudo puesto, no suena nada). Determinista:
 * la misma hora del mismo plan pide siempre los mismos sonidos.
 */
export function eventosDe(d: Datos, t: number, suena: boolean): EventoSonoro[] {
  if (!suena) return [];
  const out: EventoSonoro[] = [];
  d.tiros.forEach((tiro, i) => {
    // La cadena tiene dos golpes (S23): el blando de la mano, antes, y el fuerte del vidrio contra vidrio.
    if (t >= tiro.tMano && t < tiro.tMano + VENTANA) out.push({ clave: `mano:${i}`, ...TOQUE });
    if (t >= tiro.t && t < tiro.t + VENTANA) {
      out.push({ clave: `choque:${i}`, ...CLINK });
      // El peso del choque: un golpe grave debajo del clic, para que se sienta el impacto.
      out.push({ clave: `golpe:${i}`, ...GOLPE });
      out.push({ clave: `brillo:${i}`, ...BRILLO });
      out.push({ clave: `eco:${i}`, ...ECO });
    }
    // La caída, cuando la canica golpeada termina su vuelo en la tierra.
    const cae = tiro.t + tiro.salida.vuelo;
    if (t >= cae && t < cae + VENTANA) out.push({ clave: `cae:${i}`, ...CAE });
  });
  for (let j = 0; ; j++) {
    const tt = d.casi.t + TITILA_ARRANQUE + j * TITILA_PASO;
    if (tt >= Math.min(d.duracion, d.casi.t + RODADO)) break;
    if (t >= tt && t < tt + TITILA_PASO) out.push({ clave: `titila:${j}`, grado: 8 + j, cat: "evento", timbre: "triangle", vol: 0.045, dur: 0.04 });
  }
  return out;
}
