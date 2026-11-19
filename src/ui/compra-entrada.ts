import { getLang } from "../i18n";
import type { CompraQrDelEstado, EstadoDeAlta, ResultadoDeAlta } from "../stellar/alta-api";
import { compraQrActiva } from "../stellar/alta-config";
import type { Oferta, ProductoALaVenta } from "../stellar/alta-oferta";
import { registroDeRampa } from "../stellar/cuenta-config";
import { type SaldoDeDolares, leerSaldoDeDolares } from "../stellar/saldo-dolares";
import { type BilleteraDeLaCompra, CompraDeVerdad, type PorteroDeLaCompra } from "./compra-motor";
import { type AccionDeAfuera, type VentanaDeCompra, abrirCompra, aparatoDeEsteNavegador } from "./compra-qr";
import type { LoQueSeSabe } from "./compra-qr-estado";
import { type Medio, medioDeEstaCuenta, recordarMedio } from "./medio-de-pago";

/**
 * Cómo se llega a Tu compra desde el sitio: la deducción del medio con lo que dice el servidor de esta cuenta, y la
 * ventana con el motor de verdad (`compra-motor.ts`). Con la compra con QR apagada en el build (`VITE_COMPRA_QR`), nada
 * de esto pide nada: `entradaDeLaCompra` vuelve `null` sin llamar a nadie y el sitio queda como hoy.
 */

/** Cuánto se espera el estado de la cuenta antes de seguir como hoy, sin el QR. */
export const TOPE_DEL_ESTADO_MS = 8_000;

export interface EntradaDeLaCompra {
  /** El medio deducido para esta cuenta en este navegador. */
  medio: Medio;
  /** Lo que dijo el servidor de la compra con QR de esta cuenta. */
  compraQr: CompraQrDelEstado;
}

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => {
    reloj = setTimeout(() => no(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(reloj));
}

/**
 * Si a esta cuenta se le ofrece el QR, y por cuál camino empieza. `null` (como hoy, sin el QR): la compra con QR apagada
 * en el build (sin pedir nada), el estado que no llega o que no la trae, o un servidor que dice que esta cuenta no compra
 * con QR (`medio-de-pago.ts`).
 */
export async function entradaDeLaCompra(p: { estado(): Promise<ResultadoDeAlta<EstadoDeAlta>>; enElBuild?: boolean; almacen?: Pick<Storage, "getItem" | "setItem"> | null; zona?: string | null; topeMs?: number }): Promise<EntradaDeLaCompra | null> {
  const enElBuild = p.enElBuild ?? compraQrActiva();
  if (!enElBuild) return null;
  let e: ResultadoDeAlta<EstadoDeAlta>;
  try {
    e = await conTope(p.estado(), p.topeMs ?? TOPE_DEL_ESTADO_MS);
  } catch {
    return null;
  }
  if (!e.ok || !e.datos.compraQr) return null;
  const compraQr = e.datos.compraQr;
  const d = medioDeEstaCuenta(compraQr, { enElBuild, ...(p.almacen !== undefined ? { almacen: p.almacen } : {}), ...(p.zona !== undefined ? { zona: p.zona } : {}) });
  // Con una compra con QR ya cargada, el dinero puede estar en camino: se sigue por el QR aunque se haya elegido otra app.
  if (compraQr.abierta?.cargada) return { medio: "qr", compraQr };
  return d.cambio ? { medio: d.medio, compraQr } : null;
}

export interface ParaTuCompra {
  producto: ProductoALaVenta;
  oferta: Oferta;
  compraQr: CompraQrDelEstado;
  billetera: BilleteraDeLaCompra & { readonly label?: string };
  portero: PorteroDeLaCompra;
  /** La cuenta de la sesión. */
  cuenta(): string | null;
  /** La marca de un pago con el saldo (`leerMarcaDelPago`). */
  marcaDelPago(nota: string): number | null;
  afuera?(accion: AccionDeAfuera, s: LoQueSeSabe): void;
  alCerrar?(s: LoQueSeSabe): void;
}

/** Abre Tu compra con el motor de verdad para ese paquete. `null` si la compra con QR no está en el build. */
export function abrirTuCompra(p: ParaTuCompra): VentanaDeCompra | null {
  const otros = [...(p.oferta.alta ? [p.oferta.alta] : []), ...p.oferta.paquetes];
  const abierta = p.compraQr.abierta;
  const motor = new CompraDeVerdad({
    billetera: p.billetera,
    portero: p.portero,
    saldo: async (): Promise<SaldoDeDolares> => {
      const g = p.cuenta();
      return g ? leerSaldoDeDolares(g) : { tipo: "sin-red" };
    },
    cuenta: p.cuenta,
    producto: p.producto,
    otros,
    permiso: abierta && abierta.producto === p.producto.id ? abierta : null,
    medio: "qr",
    cambio: true,
    aparato: aparatoDeEsteNavegador(),
    idioma: () => (getLang() === "en" ? "en" : "es"),
    marcaDelPago: p.marcaDelPago,
    recordarMedio: (m) => recordarMedio(m),
    ...(registroDeRampa() ? { registrar: (evento: string, datos?: Record<string, unknown>) => console.info("[tinkazo] compra", evento, datos ?? {}) } : {}),
  });
  return abrirCompra({
    motor,
    ...(p.afuera ? { afuera: p.afuera } : {}),
    ...(p.alCerrar ? { alCerrar: p.alCerrar } : {}),
  });
}
