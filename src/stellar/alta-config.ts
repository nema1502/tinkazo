import { network } from "./config";
import { banderasDeVenta, entornoDelBuild } from "./venta-piloto";

/**
 * Las banderas del cobro por uso del modo Oficial (cupones y paquetes de sorteos para las cuentas de Google o de
 * correo), en un solo lugar. Todas nacen apagadas: prenderlas es una decisión de quien dirige el proyecto.
 *
 * - `VITE_ALTA=1`: el acceso por cupón (o por pago) está a la vista. Exige `VITE_PATROCINIO_URL_MAINNET`: sin la
 *   dirección del portero de la red principal no hay a quién preguntar el acceso, y la bandera no vale (el build
 *   tampoco sale, ver `alta-build.ts`).
 * - `VITE_ALTA_LIBRE=1`: la salida de emergencia. Deja activar una cuenta sin acceso confirmado por el servidor, y nada
 *   más: sellar y sortear siguen pidiendo el acceso. Existe para un solo caso (el plan B1 del diseño), sola: junto con
 *   `VITE_ALTA` no vale.
 * - `VITE_ALTA_PAGO=1`: la compra de sorteos. Solo cuenta con `VITE_ALTA`.
 * - `VITE_SORTEO_SERVIDOR=1`: el sorteo lo manda el servidor. Solo cuenta con `VITE_ALTA`.
 * - `VITE_PAGO_CON_SALDO=1`: pagar un paquete con los dólares digitales de la propia cuenta (`pago-con-saldo.ts`). Solo
 *   cuenta con la compra (`VITE_ALTA_PAGO`), que a su vez pide `VITE_ALTA`. Va aparte de `BanderasDeAlta`
 *   (`pagoConSaldoActivo`).
 * - `VITE_COMPRA_QR=1`: comprar un paquete pagando el QR del banco en bolivianos (campo `qr`, `compraQrActiva`). Solo
 *   cuenta con la compra y con el pago con el saldo, porque la compra con QR termina pagando el paquete con lo que llegó
 *   a la cuenta. Prendida en el build no le muestra nada nuevo a quien el servidor no le ofrece el QR.
 * - `VITE_VENTA_ABIERTA=1`: la venta a la vista para todos. Sin ella, las tres de la venta (`VITE_ALTA_PAGO`,
 *   `VITE_PAGO_CON_SALDO` y `VITE_COMPRA_QR`) están en piloto: valen solo en un navegador con la marca del piloto
 *   (`?piloto=compra`), y sin la marca el sitio es el de las tres apagadas. Esas tres se leen solo en
 *   `venta-piloto.ts`, la puerta del piloto.
 *
 * Fuera de la red principal (Prueba) están apagadas siempre, tengan lo que tengan las variables: ahí no hay cobro y
 * el sitio se comporta como siempre. Ante una bandera a medio poner (pago o sorteo por el servidor sin el acceso, o el
 * acceso sin portero) vale la menos abierta.
 *
 * Es un archivo mínimo a propósito, sin nada de la pantalla ni de la billetera: la red y el entorno entran como
 * argumentos, así se prueba solo. Sin entorno, el de este sitio en esta pestaña, con la venta pasada por la marca del
 * piloto. Con un entorno en la mano, lo que dice ese entorno (las pruebas).
 */

export interface BanderasDeAlta {
  alta: boolean;
  libre: boolean;
  pago: boolean;
  sorteoServidor: boolean;
  /** La compra con el QR del banco. */
  qr: boolean;
}

/** Todo apagado: lo que vale fuera de la red principal y con el build de hoy. */
export const BANDERAS_APAGADAS: Readonly<BanderasDeAlta> = Object.freeze({ alta: false, libre: false, pago: false, sorteoServidor: false, qr: false });

const uno = (x: unknown): boolean => x === "1";

/** Hay dirección del portero de la red principal en el entorno (lo mismo que `patrocinio-config.ts` toma por puesta). */
const hayPortero = (x: unknown): boolean => typeof x === "string" && x.trim().replace(/\/+$/, "") !== "";

/** Las banderas de esta red. Sin entorno, las de este sitio en esta pestaña; cada argumento se puede pasar a mano (las pruebas). */
export function banderasDeAlta(env?: Record<string, unknown>, red: string = network.name): BanderasDeAlta {
  if (red !== "mainnet") return { ...BANDERAS_APAGADAS };
  const e = env ?? entornoDelBuild();
  const venta = banderasDeVenta(env);
  const alta = uno(e.VITE_ALTA) && hayPortero(e.VITE_PATROCINIO_URL_MAINNET);
  return {
    alta,
    // Con el acceso por cupón pedido (aunque falte el portero), el plan B1 no vale: juntas activarían sin acceso. El build
    // tampoco sale así (`alta-build.ts`); esto es por si igual llegara.
    libre: uno(e.VITE_ALTA_LIBRE) && !uno(e.VITE_ALTA),
    pago: alta && venta.pago,
    sorteoServidor: alta && uno(e.VITE_SORTEO_SERVIDOR),
    // Lo cargado con el QR paga el paquete con el saldo: sin la compra y sin ese pago, el dinero no tendría salida.
    qr: alta && venta.pago && venta.saldo && venta.qr,
  };
}

/** El acceso por cupón o por pago está a la vista en este build y esta red. */
export const altaActiva = (): boolean => banderasDeAlta().alta;
/** Se puede activar una cuenta sin el acceso confirmado: solo el plan B1. */
export const altaLibre = (): boolean => banderasDeAlta().libre;
/** La compra de sorteos está a la vista. */
export const altaPagoActivo = (): boolean => banderasDeAlta().pago;
/** El sorteo lo manda el servidor. */
export const sorteoPorServidor = (): boolean => banderasDeAlta().sorteoServidor;

/**
 * Pagar con el saldo de la cuenta está a la vista en este build y esta red: la compra prendida y `VITE_PAGO_CON_SALDO=1`.
 * Fuera de la red principal, o sin la compra, no vale nunca.
 */
export function pagoConSaldoActivo(env?: Record<string, unknown>, red: string = network.name): boolean {
  return banderasDeAlta(env, red).pago && banderasDeVenta(env).saldo;
}

/**
 * La compra con el QR del banco está a la vista en este build y esta red: la compra, el pago con el saldo y
 * `VITE_COMPRA_QR=1`. Fuera de la red principal no vale nunca.
 */
export function compraQrActiva(env?: Record<string, unknown>, red: string = network.name): boolean {
  return banderasDeAlta(env, red).qr;
}
