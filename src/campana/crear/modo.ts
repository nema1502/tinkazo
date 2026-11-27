/**
 * Qué campaña arma la página: de cuentas (la de siempre), de personas con el premio en mano o de personas con el premio en
 * dólares. No hay ningún control a la vista: deciden los interruptores del sitio, lo que pide la dirección de la página y, por
 * encima de todo, el archivo que se abrió. Todo es puro.
 */

import type { FormularioDeCampana } from "./estado";

/**
 * Los tres modos. En cuentas, cada persona que se anota recibe su cuenta y el premio le llega ahí. En personas con el premio en
 * mano, la gente se anota con Google, el premio va escrito y se entrega en el evento. En personas con dólares, la gente se anota
 * con Google y quien organiza le manda el premio a cada persona que gana.
 */
export type ModoDelArmado = "cuentas" | "personas-en-mano" | "personas-dolares";

/** Lo que piden los interruptores del sitio y la dirección de la página. */
export interface PedidoDeModo {
  /** El modo de una campaña nueva, sin archivo abierto. */
  nueva: ModoDelArmado;
  /**
   * Qué pasa con un archivo de personas que trae montos y ningún premio escrito: con `true` se arma como personas con dólares, y
   * con `false` pide el premio escrito, como siempre.
   */
  archivoConDolares: boolean;
}

/**
 * Lo más que pueden ganar en una campaña de personas con dólares. Cada premio es un envío desde la cuenta de quien organiza, y el
 * servicio que los lleva acepta 10 envíos por cuenta y por día: el pago del servicio de la campaña es uno, y queda uno de margen
 * para un intento que falle.
 */
export const GANAN_MAXIMO_CON_ENVIO = 8;

/**
 * El pedido según los dos interruptores y el parámetro `identidad` de la dirección. Sin anotarse sin billetera, siempre cuentas.
 * Con él y sin las campañas con Google, cuentas, o premio en mano si la dirección pide `persona`. Con los dos, personas con
 * dólares, salvo que la dirección pida `persona` (premio en mano) o `cuenta` (cuentas). Solo esos dos valores exactos cuentan.
 */
export function pedidoDeModo(o: { sinBilletera: boolean; conGoogle: boolean; identidad: string | null }): PedidoDeModo {
  if (!o.sinBilletera) return { nueva: "cuentas", archivoConDolares: false };
  if (!o.conGoogle) return { nueva: o.identidad === "persona" ? "personas-en-mano" : "cuentas", archivoConDolares: false };
  const nueva: ModoDelArmado = o.identidad === "persona" ? "personas-en-mano" : o.identidad === "cuenta" ? "cuentas" : "personas-dolares";
  return { nueva, archivoConDolares: true };
}

/**
 * El modo de lo que se está armando. Un archivo abierto manda sobre todo: sin la identidad de personas es de cuentas, con su
 * premio escrito es en mano, y con montos es de personas con dólares si el pedido lo deja y, si no, pide el premio escrito. Sin
 * archivo abierto vale lo pedido, salvo en la demostración, cuya campaña es siempre de cuentas.
 */
export function modoDelFormulario(f: Pick<FormularioDeCampana, "conservado">, pedido: PedidoDeModo, demo: boolean): ModoDelArmado {
  const abierto = f.conservado;
  if (!abierto) return demo ? "cuentas" : pedido.nueva;
  if (abierto.identidad !== "persona") return "cuentas";
  if (abierto.premioEnMano !== undefined) return "personas-en-mano";
  return pedido.archivoConDolares ? "personas-dolares" : "personas-en-mano";
}
