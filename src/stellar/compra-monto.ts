/**
 * Cuánto cargar con el QR para pagar una compra, en centavos enteros y sin red. El sitio hace solo dos cuentas: cuánto
 * falta y cuánto pedirle al proveedor. Nunca muestra bolivianos calculados por él: los da la cotización, y para pagar,
 * la orden de carga.
 *
 * - El precio es el total que dio el servidor para esta compra (`permiso.total`, que ya trae el recargo del QR). El sitio
 *   no escribe ni suma ningún precio.
 * - `falta = precio − saldo`. Con 0 o menos no se carga: se paga con el saldo.
 * - `margen = máx(0,20, 3 % de lo que falta)`, al centavo para arriba: entre la cotización y la llegada se puede perder
 *   como mucho un 2 % (el canje no aprueba menos del 99 % y el envío no aprueba más del 1 % de comisión), y el resto cubre
 *   un movimiento del cambio. Lo que sobra queda en el saldo de la persona.
 * - Se cotiza por lo que se paga, en bolivianos enteros, tres veces como mucho: una de lectura con 12 bolivianos por
 *   dólar, de ahí la tasa real, el monto que llega justo al objetivo y, si no llegó, uno más. Nunca un monto que no llegue.
 * - El mínimo del proveedor, si lo hay, manda sobre el monto.
 */

/** Centavos, para no sumar con decimales. */
export type Centavos = number;

/** El piso del margen: 20 centavos. */
export const MARGEN_MINIMO: Centavos = 20;
/** El margen, en centésimos de lo que falta: el 3 %. */
export const MARGEN_POR_CIENTO = 3;
/** Los bolivianos por dólar de la primera cotización, solo para leer la tasa: nunca se muestra. */
export const TASA_DE_LECTURA = 12;
/** Cuántas cotizaciones como mucho. */
export const COTIZACIONES = 3;

const MONTO = /^(\d{1,15})(?:\.(\d{1,7}))?$/;

function centavos(m: string | null | undefined, arriba: boolean): Centavos | null {
  const x = typeof m === "string" ? MONTO.exec(m.trim()) : null;
  if (!x) return null;
  const decimales = (x[2] ?? "").padEnd(7, "0");
  const c = Number(x[1]) * 100 + Number(decimales.slice(0, 2));
  const resto = Number(decimales.slice(2)) > 0;
  return arriba && resto ? c + 1 : c;
}

/** Lo que hay que pagar, en centavos: un resto de menos de un centavo cuenta como un centavo más. `null` si no es un monto. */
export const centavosParaPagar = (m: string | null | undefined): Centavos | null => centavos(m, true);
/** Lo que se tiene (el saldo), en centavos: un resto de menos de un centavo no cuenta. `null` si no es un monto. */
export const centavosQueHay = (m: string | null | undefined): Centavos | null => centavos(m, false);

/** Dólares de una cotización (un número) en centavos, para abajo: lo que llega se cuenta de menos, nunca de más. */
export function centavosQueLlegan(dolares: number): Centavos | null {
  if (!Number.isFinite(dolares) || dolares < 0) return null;
  return Math.floor(Math.round(dolares * 1e7) / 1e5);
}

/** El margen para lo que falta. */
export function margenDe(falta: Centavos): Centavos {
  if (falta <= 0) return 0;
  return Math.max(MARGEN_MINIMO, Math.ceil((falta * MARGEN_POR_CIENTO) / 100));
}

export interface Objetivo {
  /** Lo que falta para el precio con el saldo que hay. 0: alcanza y no se carga. */
  falta: Centavos;
  margen: Centavos;
  /** Lo que tiene que llegar con la carga. */
  objetivo: Centavos;
}

/** Cuánto tiene que llegar para pagar `precio` (el total del servidor) con `saldo` en la cuenta. `null` si el precio no es un monto. */
export function objetivoDeLaCarga(precio: string, saldo: string | null): Objetivo | null {
  const p = centavosParaPagar(precio);
  if (p === null || p <= 0) return null;
  const s = centavosQueHay(saldo) ?? 0;
  const falta = Math.max(0, p - s);
  const margen = margenDe(falta);
  return { falta, margen, objetivo: falta + margen };
}

/** Lo que dijo una cotización ya hecha: los bolivianos que paga y los dólares que le llegan. */
export interface CotizacionHecha {
  pagas: number;
  recibis: number;
}

export type SiguienteCotizacion =
  /** Cotizar por estos bolivianos enteros. */
  | { estado: "cotizar"; bs: number }
  /** Esta cotización (por su lugar en la lista) llega al objetivo: con ella se sigue. */
  | { estado: "alcanza"; indice: number }
  /** Tres cotizaciones y ninguna llegó: no se ofrece el QR. */
  | { estado: "no-alcanza" };

/**
 * Lo que toca después de las cotizaciones ya hechas para que llegue `objetivo`: el próximo monto en bolivianos enteros,
 * o cuál ya alcanza. La primera es de lectura (`objetivo × 12`); de su tasa real sale el monto que llega justo; si ese no
 * llega, uno más (o el que pide la tasa nueva, si es mayor). Nunca más de tres, y nunca una que no llegue. `minimoBs`:
 * lo mínimo que acepta el proveedor, que manda sobre el monto (0 si no se sabe).
 */
export function cotizacionParaElObjetivo(objetivo: Centavos, hechas: readonly CotizacionHecha[], minimoBs = 0): SiguienteCotizacion {
  const minimo = Number.isSafeInteger(minimoBs) && minimoBs > 0 ? minimoBs : 0;
  const conMinimo = (bs: number): number => Math.max(bs, minimo);
  if (!Number.isSafeInteger(objetivo) || objetivo <= 0) return { estado: "no-alcanza" };
  const n = hechas.length;
  if (n === 0) return { estado: "cotizar", bs: conMinimo(Math.ceil((objetivo * TASA_DE_LECTURA) / 100)) };
  const llega = (c: CotizacionHecha): boolean => {
    const r = centavosQueLlegan(c.recibis);
    return r !== null && r >= objetivo;
  };
  // La más barata de las que llegan, por si la última no llegó.
  const laMasBarata = (): SiguienteCotizacion => {
    let mejor = -1;
    hechas.forEach((c, i) => {
      if (llega(c) && (mejor < 0 || c.pagas < (hechas[mejor] as CotizacionHecha).pagas)) mejor = i;
    });
    return mejor >= 0 ? { estado: "alcanza", indice: mejor } : { estado: "no-alcanza" };
  };
  const ultima = hechas[n - 1] as CotizacionHecha;
  const recibis = centavosQueLlegan(ultima.recibis);
  if (recibis === null || recibis <= 0 || !Number.isFinite(ultima.pagas) || ultima.pagas <= 0) return n >= COTIZACIONES ? laMasBarata() : { estado: "no-alcanza" };
  // El monto que llega justo al objetivo con la tasa de la última.
  const justo = conMinimo(Math.ceil((objetivo * ultima.pagas) / recibis));
  if (n === 1) {
    if (recibis >= objetivo && ultima.pagas <= justo) return { estado: "alcanza", indice: 0 };
    return { estado: "cotizar", bs: justo };
  }
  if (recibis >= objetivo) return { estado: "alcanza", indice: n - 1 };
  if (n >= COTIZACIONES) return laMasBarata();
  return { estado: "cotizar", bs: Math.max(ultima.pagas + 1, justo) };
}

/** Lo que queda en el saldo después de pagar: el saldo más lo que llega menos el precio. Puede ser negativo. */
export function queda(precio: Centavos, saldo: Centavos, llega: Centavos): Centavos {
  return saldo + llega - precio;
}
