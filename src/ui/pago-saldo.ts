import type { OrdenDePago } from "../stellar/alta-api";
import { montoVisible, varsDelProducto } from "../stellar/alta-oferta";
import type { MotivoDelPago, ResultadoDelPagoConSaldo } from "../stellar/pago-con-saldo";
import { type SaldoDeDolares, alcanza, faltaPara } from "../stellar/saldo-dolares";
import type { Texto } from "./cuenta-lista-estado";
import { MEDIOS_DE_PAGO, type MedioDePago } from "./pago-vista";

/**
 * Pagar un paquete con los dólares digitales de la propia cuenta, sin DOM: lo comparten «Dejá tu cuenta lista» (el
 * primer paquete) y la ventana de sumar sorteos (`pago-paquete.ts`). Solo claves del diccionario.
 *
 * - Existe solo si la pantalla recibió `PagoConSaldo` (la bandera `VITE_PAGO_CON_SALDO` y la billetera del proveedor:
 *   `cuenta-lista-acceso.ts`). Sin eso, nada de esto se ve.
 * - Se ofrece solo si el saldo alcanza para el precio que dio el servidor. Si hay algo y no alcanza, el panel de siempre
 *   dice cuánto hay y cuánto falta (`corto`), y el otro medio queda como está.
 * - Antes de pagar, una confirmación propia con el monto y para qué, con una sola principal. Lo que se paga sale entero
 *   de la orden del servidor.
 * - Pagar no da el acceso: después de mandar, lo confirma el mismo sondeo de Ya pagué contra el servidor.
 */

/** Lo que la pantalla de la compra recibe para pagar con el saldo. Ninguna de las dos lanza. */
export interface PagoConSaldo {
  /** Cuántos dólares digitales tiene la cuenta, leído en la red. */
  leer(): Promise<SaldoDeDolares>;
  /** Paga esa orden con el saldo (`pagarOrden` de la billetera), con su cuenta, su monto y su nota, tal cual. */
  pagar(o: OrdenDePago): Promise<ResultadoDelPagoConSaldo>;
}

/** El medio: pagar con el saldo de la cuenta. Va primero cuando se ofrece. */
export const MEDIO_SALDO: MedioDePago = Object.freeze({ id: "saldo", clave: "pagoMedioSaldo" });

/** Lo que hay y lo que falta, con siete decimales, cuando hay saldo y no alcanza. */
export interface SaldoCorto {
  tiene: string;
  falta: string;
}

/** Los medios para un precio, según lo que se leyó del saldo: con el saldo primero si alcanza, y si no, lo de siempre. */
export function mediosConSaldo(s: SaldoDeDolares | null, precio: string): { medios: readonly MedioDePago[]; saldo: string | null; corto: SaldoCorto | null } {
  if (!s || s.tipo !== "saldo") return { medios: MEDIOS_DE_PAGO, saldo: null, corto: null };
  if (alcanza(s.saldo, precio)) return { medios: [MEDIO_SALDO, ...MEDIOS_DE_PAGO], saldo: s.saldo, corto: null };
  if (alcanza(s.saldo, "0.0000001")) return { medios: MEDIOS_DE_PAGO, saldo: s.saldo, corto: { tiene: s.saldo, falta: faltaPara(s.saldo, precio) } };
  return { medios: MEDIOS_DE_PAGO, saldo: null, corto: null };
}

/** La línea de cuando se elige cómo pagar: lo que hay en la cuenta. */
export function lineaDelSaldo(saldo: string, idioma: "es" | "en"): Texto {
  const m = montoVisible(saldo, idioma);
  return m === "1" ? { clave: "pagoSaldoTenesUno" } : { clave: "pagoSaldoTenes", vars: { saldo: m } };
}

/** Lo que va en el renglón de datos del panel: lo que hay y lo que falta. */
export function textoDelCorto(c: SaldoCorto, idioma: "es" | "en"): Texto {
  const tiene = montoVisible(c.tiene, idioma);
  const falta = montoVisible(c.falta, idioma);
  return tiene === "1" ? { clave: "pagoSaldoCortoUno", vars: { falta } } : { clave: "pagoSaldoCorto", vars: { tiene, falta } };
}

/**
 * Dónde está el pago con el saldo, ya con la orden en mano:
 * - `confirmar`: la confirmación propia (y, si algo no salió, el motivo);
 * - `pagando`: se arma, se revisa, se firma y se manda;
 * - `mirando`: ya se mandó (o no se sabe si salió), y el acceso lo dice el servidor.
 */
export type FaseDelSaldo = "confirmar" | "pagando" | "mirando";

/** Lo que la vista necesita saber del pago con el saldo. */
export interface SaldoEnLaVista {
  idioma: "es" | "en";
  /** El saldo leído, con siete decimales. */
  saldo: string;
  fase: FaseDelSaldo;
  /** No se sabe si salió: no se ofrece pagar de nuevo esta orden. */
  incierto: boolean;
  /** Por qué no salió lo último, o `null`. */
  motivo: MotivoDelPago | null;
  /** Mirando: se está preguntando ahora, pasaron los 5 minutos, o no se pudo preguntar. */
  buscando: boolean;
  tarda: boolean;
  errorDelSondeo: Texto | null;
}

export type AccionDelSaldo = "saldo-pagar" | "saldo-otro-medio" | "ya-pague";

export interface BotonDelSaldo extends Texto {
  accion: AccionDelSaldo;
  apagado: boolean;
  ocupado?: boolean;
}

export interface VistaDelSaldo {
  /** La única línea a la vista (la confirmación o lo que pasó), si no hay error. */
  textos: Texto[];
  error: Texto | null;
  principal: BotonDelSaldo;
  /** Pasar al otro medio, como botón de texto, cuando no es la principal. */
  secundarios: BotonDelSaldo[];
}

/** El texto de cada motivo, con lo que hay y lo que falta cuando es el saldo. */
export function textoDelMotivo(m: MotivoDelPago, s: { saldo: string; monto: string; idioma: "es" | "en" }): Texto {
  switch (m) {
    case "sin-saldo":
      // Si lo leído todavía alcanzaba, no se dice que falta cero: se dice que no se pudo.
      if (alcanza(s.saldo, s.monto)) return { clave: "pagoSaldoNoSalio" };
      return { clave: "pagoSaldoNoAlcanza", vars: { tiene: montoVisible(s.saldo, s.idioma), falta: montoVisible(faltaPara(s.saldo, s.monto), s.idioma) } };
    case "cancelado":
      return { clave: "pagoSaldoCancelado" };
    case "sin-linea":
      return { clave: "pagoSaldoSinLinea" };
    case "regla":
      return { clave: "pagoSaldoRaro" };
    case "sin-patrocinio":
      return { clave: "pagoSaldoSinPatrocinio" };
    case "destino":
      return { clave: "pagoSaldoDestino" };
    default:
      return { clave: "pagoSaldoNoSalio" };
  }
}

/** Los motivos con que este medio no sirve ahora: la principal pasa al otro medio. Con los demás, se puede probar de nuevo. */
const PASAR_AL_OTRO: ReadonlySet<MotivoDelPago> = new Set<MotivoDelPago>(["sin-saldo", "sin-linea", "regla", "sin-patrocinio", "destino", "sin-cuenta"]);

/** Lo que va en `{precio}` y en `{sorteos}`, de la orden tal cual. */
const varsDeLaOrden = (o: OrdenDePago, idioma: "es" | "en"): { precio: string; sorteos: string } => varsDelProducto({ id: o.producto, usdc: o.usdc, sorteos: o.sorteos, dias: 0 }, idioma);

/** Qué se ve del pago con el saldo, con la orden en mano. Una sola principal siempre, y una sola línea a la vista. */
export function vistaDelSaldo(s: SaldoEnLaVista, o: OrdenDePago): VistaDelSaldo {
  const vars = varsDeLaOrden(o, s.idioma);
  const otro: BotonDelSaldo = { accion: "saldo-otro-medio", clave: "pagoSaldoOtroMedio", apagado: false };
  // Si no se sabe si salió, lo único que se puede hacer es buscar el pago: nunca pagar de nuevo ni pasar al otro medio.
  const fase: FaseDelSaldo = s.incierto && s.fase !== "pagando" ? "mirando" : s.fase;
  if (fase === "pagando") return { textos: [{ clave: "pagoSaldoConfirmar", vars }], error: null, principal: { accion: "saldo-pagar", clave: "pagoSaldoPagando", apagado: true, ocupado: true }, secundarios: [] };
  if (fase === "mirando") {
    const buscar: BotonDelSaldo = s.buscando ? { accion: "ya-pague", clave: "pagoBuscando", apagado: true, ocupado: true } : { accion: "ya-pague", clave: s.errorDelSondeo ? "clProbarDeNuevo" : "pagoSaldoBuscar", apagado: false };
    if (s.errorDelSondeo) return { textos: [], error: s.errorDelSondeo, principal: buscar, secundarios: [] };
    const linea: Texto = s.tarda ? { clave: "pagoTarda" } : { clave: s.incierto ? "pagoSaldoIncierto" : "pagoSaldoSalio" };
    return { textos: [linea], error: null, principal: buscar, secundarios: [] };
  }
  // Confirmar: el monto y para qué, o el motivo de lo que no salió.
  if (s.motivo) {
    const error = textoDelMotivo(s.motivo, { saldo: s.saldo, monto: o.usdc, idioma: s.idioma });
    if (PASAR_AL_OTRO.has(s.motivo)) return { textos: [], error, principal: otro, secundarios: [] };
    return { textos: [], error, principal: { accion: "saldo-pagar", clave: "pagoSaldoPagar", vars, apagado: false }, secundarios: [{ ...otro }] };
  }
  // La orden pide más de lo que hay: se dice, y queda el otro medio.
  if (!alcanza(s.saldo, o.usdc)) return { textos: [], error: textoDelMotivo("sin-saldo", { saldo: s.saldo, monto: o.usdc, idioma: s.idioma }), principal: otro, secundarios: [] };
  return { textos: [{ clave: "pagoSaldoConfirmar", vars }], error: null, principal: { accion: "saldo-pagar", clave: "pagoSaldoPagar", vars, apagado: false }, secundarios: [{ ...otro }] };
}

/** Lo que cambia en el pago con el saldo con lo que devolvió la billetera. Pagar nunca da el acceso: después se mira. */
export function trasPagar(r: ResultadoDelPagoConSaldo): { fase: FaseDelSaldo; incierto: boolean; motivo: MotivoDelPago | null; mirar: boolean } {
  if (r.estado === "salio") return { fase: "mirando", incierto: false, motivo: null, mirar: true };
  if (r.estado === "incierto") return { fase: "mirando", incierto: true, motivo: null, mirar: true };
  return { fase: "confirmar", incierto: false, motivo: r.motivo, mirar: false };
}
