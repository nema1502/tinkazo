import { CENTAVO, DOLAR, totalACargar } from "./comision";
import type { LecturaDeComision } from "./comision-red";

/**
 * En qué estado está el cobro de una campaña, visto desde el panel de quien organiza. Es una función pura: recibe lo que se
 * pudo ver (la red, la marca de un pago en el aire, la cuenta y el saldo, si el servicio atiende) y dice qué se le muestra.
 * Un estado, un título, una línea y un botón: el dibujo vive en `src/ui/campana-sala.ts`.
 */

/** Si el servicio de comisiones atiende esta forma de pago ahora: sí, no, sin respuesta, o todavía sin preguntar. */
export type PorteroDeComision = "atiende" | "no" | "sin-respuesta" | null;

export type EstadoDeComision =
  /** Todavía no se miró nada. */
  | { tipo: "mirando" }
  /** Ya llegó: se sigue como hoy. */
  | { tipo: "pagada" }
  /** No se pudo ver la red: no se ofrece pagar ni abrir. */
  | { tipo: "sin-mirar" }
  /** Hay un pago en el aire que quizás salió: no se ofrece pagar de nuevo. */
  | { tipo: "duda" }
  | { tipo: "pagando" }
  /** La cuenta no tiene todavía los premios más lo que se cobra. `cargar` es el total y `falta` lo que le falta. */
  | { tipo: "falta-cargar"; cargar: bigint; saldo: bigint; falta: bigint; sale: bigint; monto: bigint }
  /** Todo listo: `sale` es lo que de verdad sale de la cuenta con este pago. */
  | { tipo: "lista"; sale: bigint }
  /** Se paga desde otra billetera: `monto` es lo que se pide. Con `entrar`, el camino principal es entrar con Google. */
  | { tipo: "otra-billetera"; monto: bigint; entrar: boolean }
  /** La campaña pide sellar con otra cuenta que la de esta sesión. */
  | { tipo: "otra-cuenta" }
  /** El servicio no atiende ahora y no se arregla solo: queda el pago desde otra billetera. */
  | { tipo: "ahora-no"; monto: bigint };

export interface EntradaDeComision {
  /** Lo que dijo la red, o `null` si todavía no se miró. */
  red: LecturaDeComision | null;
  /** El pago ya salió desde esta compu y se vio entrar (guardado). */
  pagadaAca: boolean;
  /** Se está mandando un pago ahora. */
  pagando: boolean;
  /** Hay un pago en el aire que puede entrar todavía. */
  marcaViva: boolean;
  /** Con qué se entra: una cuenta de Google que vota por contenido, u otra cosa (o nada). */
  billetera: "google" | "otra";
  /** La campaña pide una cuenta organizadora y la sesión es otra. */
  cuentaEquivocada: boolean;
  /** Si hay una forma de cambiar de cuenta o entrar. */
  puedeEntrar: boolean;
  saldo: bigint | "sin-red" | null;
  /** Los premios sumados (redondeados al centavo). */
  premios: bigint;
  comision: bigint;
  /** Lo que tiene que llegar a la cuenta de Tinkazo para dar por pagado: la comisión menos el costo del retiro. */
  umbral: bigint;
  costo: bigint;
  portero: PorteroDeComision;
  /** Cuántos intentos seguidos no salieron: con dos, ya no se invita a pagar con la cuenta. */
  rechazos: number;
}

/** Cuántos intentos seguidos que no salen se aguantan antes de dejar solo el pago desde otra billetera. */
export const RECHAZOS_QUE_SE_AGUANTAN = 2;

/**
 * Lo que sale de la cuenta con un pago nuevo. Sin nada llegado, la comisión entera. Con una parte ya llegada, lo que falta
 * más el costo del retiro, y solo si lo que falta es de 1 dólar o más (el retiro no arma un pago de menos): si no, `null`.
 */
export function loQueSale(e: Pick<EntradaDeComision, "comision" | "umbral" | "costo">, llegado: bigint): bigint | null {
  if (llegado <= 0n) return e.comision;
  const resto = e.umbral - llegado;
  return resto >= DOLAR ? resto + e.costo : null;
}

/** El orden importa: lo que ya pasó le gana a lo que se puede hacer. */
export function estadoDeComision(e: EntradaDeComision): EstadoDeComision {
  if (e.red?.tipo === "pagada" || e.pagadaAca) return { tipo: "pagada" };
  if (e.pagando) return { tipo: "pagando" };
  if (e.marcaViva) return { tipo: "duda" };
  if (e.red === null) return { tipo: "mirando" };
  if (e.red.tipo === "sin-consulta") return { tipo: "sin-mirar" };
  const llegado = e.red.suma;
  // Lo que se le pide a otra billetera: la comisión entera menos lo que ya llegó.
  const monto = e.comision > llegado ? e.comision - llegado : e.comision;
  if (e.cuentaEquivocada) return { tipo: "otra-cuenta" };
  if (e.billetera === "otra") return { tipo: "otra-billetera", monto, entrar: e.puedeEntrar };
  const sale = loQueSale(e, llegado);
  // Un resto de menos de 1 dólar no se puede pagar con la cuenta: queda el pago desde otra billetera.
  if (sale === null) return { tipo: "otra-billetera", monto, entrar: false };
  if (e.portero === null) return { tipo: "mirando" };
  if (e.portero === "sin-respuesta") return { tipo: "sin-mirar" };
  if (e.portero === "no" || e.rechazos >= RECHAZOS_QUE_SE_AGUANTAN) return { tipo: "ahora-no", monto };
  if (e.saldo === null) return { tipo: "mirando" };
  if (e.saldo === "sin-red") return { tipo: "sin-mirar" };
  const cargar = totalACargar([e.premios], sale);
  // Lo que falta se dice al centavo y hacia arriba: un saldo con fracción de centavo diría Cargá 0 más, y cargar lo que dice
  // tiene que alcanzar siempre.
  const falta = ((cargar - e.saldo + CENTAVO - 1n) / CENTAVO) * CENTAVO;
  if (e.saldo < cargar) return { tipo: "falta-cargar", cargar, saldo: e.saldo, falta, sale, monto };
  return { tipo: "lista", sale };
}
