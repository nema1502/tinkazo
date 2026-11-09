/**
 * El modo de un evento, para la página del evento y para lo que se comparte de él. Un evento sale del enlace: cada
 * sorteo trae el `net` de su comprobante, y un sorteo de Prueba se borra el 16 de diciembre, así que quien lo mira
 * (o lo recibe en un grupo) tiene que saber que lo es. La verificación de un sorteo suelto ya lo dice con la
 * marca naranja (`verify.ts`); acá se hace lo mismo con el evento. Todo depende del modo Oficial: sin él, todo es de
 * Prueba y no hay nada que distinguir.
 */

/** Si algún sorteo del evento es de Prueba, según el comprobante que trae el enlace. */
export const eventoEsDePrueba = (sorteos: readonly { net?: string | undefined }[]): boolean => sorteos.some((s) => s.net === "testnet");

export type EstadoDelVeredicto = "ok" | "partial" | "bad" | "working";

/**
 * El rótulo y el detalle del veredicto del evento con el modo de sus sorteos. Si es de Prueba, el rótulo empieza con
 * el nombre del modo (y la página le pone la marca naranja de siempre) y, salvo en verde (cuyo detalle ya lo dice) y
 * mientras se revisa, el detalle suma que esos sorteos se borran: en amarillo o en rojo la frase de Prueba no
 * aparecía en ningún lado, justo cuando más hace falta. Si no es de Prueba, queda como vino.
 */
export function veredictoConModo(
  o: { estado: EstadoDelVeredicto; kicker: string; detalle: string; prueba: boolean },
  t: (clave: string) => string,
): { kicker: string; detalle: string; marca: boolean } {
  if (!o.prueba) return { kicker: o.kicker, detalle: o.detalle, marca: false };
  const dice = o.estado === "partial" || o.estado === "bad";
  return {
    kicker: `${t("netTest")}, ${o.kicker}`,
    detalle: dice ? `${o.detalle} ${t("netTestHint")}` : o.detalle,
    marca: true,
  };
}
