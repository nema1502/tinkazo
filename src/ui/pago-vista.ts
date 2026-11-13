import { type ErrorDeAlta, type OrdenDePago, fechaDeAlta } from "../stellar/alta-api";
import { montoVisible } from "../stellar/alta-oferta";
import type { Texto } from "./cuenta-lista-estado";

/**
 * Lo que se ve para pagar un paquete de sorteos oficiales, sin DOM: lo comparten «Dejá tu cuenta lista» (el primer
 * paquete, `cuenta-lista-estado.ts`) y la ventana de sumar sorteos (`pago-paquete.ts`). Solo claves del diccionario.
 *
 * - Solo medios automáticos: el pago lo reconoce el servidor solo, sin que nadie lo confirme a mano. Los medios salen de
 *   una lista (`MEDIOS_DE_PAGO`), y hoy la lista tiene uno: la transferencia con la nota de la orden. Con uno solo no se
 *   pregunta cómo pagar; con más, la pregunta va antes de pedir la orden, sin rehacer la pantalla.
 * - La cuenta, el monto, la nota, el enlace y el vencimiento salen de la orden, tal cual: ninguno se arma acá.
 * - Poco texto: a la vista, una sola línea (cómo pagar, o lo que pasó con el pago, o el error) y los datos con su
 *   rótulo. Lo demás (para qué cuenta es, qué apps sirven, por qué la nota, hasta cuándo vale y qué pasa si sobra) va
 *   plegado en Más detalles, dentro del panel.
 */

/** Un medio de pago automático: su nombre interno y el texto de su botón. */
export interface MedioDePago {
  id: string;
  clave: string;
}

/**
 * Los medios que se ofrecen siempre, en orden: el primero es la principal cuando hay que elegir. Hoy, la transferencia.
 * Pagar con el saldo de la cuenta (`pago-saldo.ts`, `MEDIO_SALDO`) se suma adelante solo cuando el saldo alcanza.
 */
export const MEDIOS_DE_PAGO: readonly MedioDePago[] = Object.freeze([Object.freeze({ id: "app", clave: "pagoMedioApp" })]);

/**
 * Lo que se muestra para pagar, todo de la orden: a qué cuenta (`destino`), cuánto (`usdc` para copiar, `monto` para
 * leer), con qué nota, el enlace de pago y hasta cuándo vale. `correo`: para qué cuenta es, tapado como en el resto.
 * `detalles`: lo que va plegado en Más detalles.
 */
export interface PanelDePago {
  correo: string;
  destino: string;
  /** La cuenta a la vista: los primeros 4 y los últimos 4 caracteres. Copiar copia `destino`, entera. */
  cuentaCorta: string;
  usdc: string;
  monto: string;
  nota: string;
  enlace: string;
  vence: number;
  detalles: Texto[];
  /** Con saldo en la cuenta que no alcanza (`pago-saldo.ts`): lo que hay y lo que falta, como un renglón de datos. */
  saldo?: Texto;
  /**
   * El enlace para pasar al QR del banco (Estoy en Bolivia), antes de los datos. Solo cuando quien muestra el panel lo
   * ofrece: la compra con QR en el build y disponible para esta cuenta.
   */
  cambio?: Texto;
}

/** Los primeros 4 y los últimos 4 caracteres: nadie tipea la cuenta, se copia entera. */
export const cuentaCorta = (cuenta: string): string => (cuenta.length > 10 ? `${cuenta.slice(0, 4)}…${cuenta.slice(-4)}` : cuenta);

/** Cómo va el pago de una orden ya pedida: lo que dijo el servidor y lo que hizo la persona. */
export interface PagandoEnLaVista {
  idioma: "es" | "en";
  orden: OrdenDePago | null;
  /** Lo que llegó y lo que hace falta, si llegó algo y no alcanza (lo dice el servidor). */
  falta: { recibido: string; total: string } | null;
  /** Se está mirando si llegó, después de «Ya pagué». */
  buscando: boolean;
  /** Ya se miró y no llegó nada. */
  noVisto: boolean;
  /** Pasaron los 5 minutos mirando. */
  tarda: boolean;
  /** Tocó «No llegó». */
  noLlego: boolean;
  /** La orden venció. */
  vencida: boolean;
}

/**
 * Lo plegado en Más detalles: para qué cuenta es, hasta cuándo vale la nota, que en otra app la nota puede llamarse
 * memo, y qué hacer sin dólares digitales. El QR del enlace y Abrir en mi app de pagos van ahí también (`pago-panel.ts`).
 */
export function detallesDelPago(o: OrdenDePago, correo: string, idioma: "es" | "en"): Texto[] {
  return [...(correo ? [{ clave: "pagoParaCuenta", vars: { correo } }] : []), { clave: "pagoVence", vars: { fecha: fechaDeAlta(o.vence, idioma) } }, { clave: "compraNotaMemo" }, { clave: "compraSinDolares" }];
}

/**
 * Los datos para pagar, de la orden tal cual. `saldo`: el renglón del saldo que no alcanza, si lo hay. `cambio`: se
 * ofrece Estoy en Bolivia.
 */
export function panelDe(o: OrdenDePago, correo: string, idioma: "es" | "en", saldo?: Texto | null, cambio = false): PanelDePago {
  return {
    correo,
    destino: o.destino,
    cuentaCorta: cuentaCorta(o.destino),
    usdc: o.usdc,
    monto: montoVisible(o.usdc, idioma),
    nota: o.nota,
    enlace: o.enlace,
    vence: o.vence,
    detalles: detallesDelPago(o, correo, idioma),
    ...(saldo ? { saldo } : {}),
    ...(cambio ? { cambio: { clave: "compraEstoy" } } : {}),
  };
}

/** La única línea de ayuda arriba de los datos: mandar exactamente ese monto, con esa nota. La moneda va como dato. */
export const COMO_PAGAR: Texto = Object.freeze({ clave: "compraAppLinea" });

/** Lo que se sabe del pago, de lo más útil a lo menos: la red equivocada solo después de «No llegó». */
export function notaDelPago(p: Pick<PagandoEnLaVista, "idioma" | "falta" | "tarda" | "noVisto" | "noLlego">): Texto | null {
  if (p.noLlego) return { clave: "pagoRedEquivocada" };
  if (p.falta) return { clave: "pagoFalta", vars: { recibido: montoVisible(p.falta.recibido, p.idioma), total: montoVisible(p.falta.total, p.idioma) } };
  if (p.tarda) return { clave: "pagoTarda" };
  if (p.noVisto) return { clave: "pagoNoLlego" };
  return null;
}

/**
 * La línea que se ve arriba de los datos para pagar: el error si lo hay, si no lo que pasó con el pago, y si no, cómo
 * se paga. Nunca dos a la vez: se dice lo que la persona necesita para el paso siguiente.
 */
export function lineaDelPago(p: Pick<PagandoEnLaVista, "idioma" | "falta" | "tarda" | "noVisto" | "noLlego">, hayError: boolean): { textos: Texto[]; nota: Texto | null } {
  if (hayError) return { textos: [], nota: null };
  const nota = notaDelPago(p);
  return nota ? { textos: [], nota } : { textos: [COMO_PAGAR], nota: null };
}

/** La orden venció sin nada pagado: no se muestra para pagar (una nota vencida no se usa). */
export const vencidaSinPagar = (p: Pick<PagandoEnLaVista, "vencida" | "falta">): boolean => p.vencida && !p.falta;

/** Llegó algo y no alcanza: lo que llegó y lo que hace falta, como lo dice el servidor. Sin nada llegado, `null`. */
export const faltaDe = (recibido: string | undefined, total: string): { recibido: string; total: string } | null => (recibido !== undefined && Number(recibido) > 0 ? { recibido, total } : null);

/**
 * Los motivos de la orden que dicen que ese paquete no se vende ahora (el pago apagado, la venta pausada, el piso de
 * créditos, un producto que el servidor no vende, una cuenta fuera de la lista del piloto del servidor). En las
 * pantallas de la compra se dicen con una sola frase corta,
 * `pagoNoALaVenta`: la pausa de hoy es a mano, y no se promete cuándo vuelve.
 */
export const NO_SE_VENDE: ReadonlySet<string> = new Set(["pago-apagado", "venta-pausada", "altas-pausadas", "producto", "fuera-del-piloto"]);

/** El texto de un error al pedir la orden, en las pantallas de la compra. */
export function textoDelErrorDeLaOrden(e: Pick<ErrorDeAlta, "clave" | "vars" | "motivo">): Texto {
  return NO_SE_VENDE.has(e.motivo) ? { clave: "pagoNoALaVenta" } : { clave: e.clave, vars: e.vars };
}

/**
 * Lo que se dice cuando no se pudo mirar el pago. La sesión, la cuenta de otro y la orden que no aparece tienen lo
 * suyo; lo demás (sin red, el servidor que no contesta) es que ahora no se pudo buscar.
 */
export function textoDelErrorDelPago(e: Pick<ErrorDeAlta, "clave" | "vars">): Texto {
  if (e.clave === "clErrSesion" || e.clave === "altaErrCuentaDeOtro" || e.clave === "pagoErrOrden") return { clave: e.clave, vars: e.vars };
  return { clave: "pagoErrRed" };
}
