/**
 * Las campañas de personas con premios en dólares: la gente se anota con su cuenta de Google sin recibir ninguna cuenta de
 * Tinkazo y, después del sorteo, quien organiza le manda su premio a cada persona que gana, a la dirección que esa persona le
 * pasa. Acá va lo que el panel de quien organiza necesita saber de ese modo, sin pantalla ni red: cuándo una campaña lo es,
 * cuánto suma el envío de los premios, cuándo el resultado habla de plata, qué línea lleva y cuánto es el premio de cada puesto.
 *
 * Una campaña de cuentas y una de premio en mano no son de este modo: para ellas todo lo de este archivo dice que no, o cero.
 */
import type { Campana } from "./modelo";
import type { PasoDelPuente } from "./puente";

/**
 * Lo más que lleva una campaña de personas con dólares. Cada premio sale de la cuenta de quien organiza con un envío, y el
 * servicio de comisiones acepta diez envíos por cuenta y por día: el pago del servicio es uno y queda uno de margen para un
 * intento que falle. La sala exige el mismo tope al activar, así que el panel lo dice antes de cobrar.
 */
export const PREMIOS_CON_ENVIO_MAXIMOS = 8;

/** El paso del resultado, con sus filas. */
export type PasoDeResultado = Extract<PasoDelPuente, { paso: "resultado" }>;

/** Lo que hace falta de una campaña para saber de qué modo es. */
type ModoDeCampana = Pick<Campana, "identidad" | "premioEnMano">;

/** ¿La campaña es de personas y su premio es en dólares? Con el premio en mano, o sin leer (`null`), no. */
export function esDePersonasConDolares(campana: ModoDeCampana | null): boolean {
  return campana !== null && campana.identidad === "persona" && campana.premioEnMano === undefined;
}

/**
 * Lo que suma mandar los premios: el costo de un envío por cada premio. Lo pone quien organiza, para que el premio llegue
 * entero. En una campaña de cuentas o de premio en mano es cero, y sin costo configurado también.
 */
export function enviosDe(campana: (ModoDeCampana & Pick<Campana, "premios">) | null, costo: bigint): bigint {
  if (campana === null || !esDePersonasConDolares(campana) || costo <= 0n) return 0n;
  return costo * BigInt(campana.premios.length);
}

/**
 * ¿El resultado a la vista es el de una campaña de personas con dólares? El paso tiene que ser el resultado de una lista de
 * personas (`enMano`, que sale de la forma de las ganadoras) y la campaña tiene que estar leída: sin saber qué premio es, el
 * panel no habla de plata.
 */
export function esResultadoEnDolares(paso: PasoDelPuente, campana: ModoDeCampana | null): paso is PasoDeResultado {
  return paso.paso === "resultado" && paso.enMano === true && esDePersonasConDolares(campana);
}

/**
 * La línea del resultado en dólares: con el código de todas a la vista, que se mire el código y se mande el premio. Mientras
 * falte alguno, que se espere: el código es lo que dice a quién se le manda plata.
 */
export function lineaDelResultadoEnDolares(paso: PasoDeResultado): "cpoMandaConCodigo" | "cpoMandaSinCodigo" {
  return paso.filas.length > 0 && paso.filas.every((f) => f.codigo !== undefined) ? "cpoMandaConCodigo" : "cpoMandaSinCodigo";
}

/**
 * El premio de un puesto, en stroops. El puesto se cuenta desde cero, como las filas del resultado. `null` si la campaña no
 * tiene ese puesto o su premio no es positivo: ahí no hay nada que decir ni que mandar.
 */
export function montoDelPuesto(campana: Pick<Campana, "premios"> | null, puesto: number): bigint | null {
  if (campana === null || !Number.isInteger(puesto) || puesto < 0) return null;
  const monto = campana.premios[puesto];
  return monto !== undefined && monto > 0n ? monto : null;
}
