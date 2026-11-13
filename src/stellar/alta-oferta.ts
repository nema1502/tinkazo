import { TEXTOS_ALTA } from "../alta-textos";
import { TEXTOS_ALTA_PAGO } from "../alta-textos-pago";
import { type OpcionesDeAlta, type PreciosDeAlta, type RecargoQr, type ResultadoDeAlta, precios } from "./alta-api";
import { altaPagoActivo } from "./alta-config";

/**
 * Qué paquetes de sorteos oficiales se pueden comprar ahora, y cómo se dice su precio. Todo sale de
 * `GET /v1/alta/precios`: el sitio no tiene ningún precio escrito a mano.
 *
 * Cerrado ante la duda: un producto se ofrece solo si la compra está prendida en el build (`VITE_ALTA_PAGO`), el
 * servidor contestó, es el de la red principal, dice que el pago está prendido y ese producto no viene pausado. Si no,
 * ese producto no se ofrece: nunca un botón de comprar que termina en un error.
 *
 * Sin DOM ni diccionario del sitio: los textos salen de `alta-textos.ts` y `alta-textos-pago.ts`, que son solo datos.
 */

/** Un producto que se puede comprar ahora, con los números del servidor tal cual. */
export interface ProductoALaVenta {
  /** `alta` es el primer paquete (trae la cuenta activada); los demás suman sorteos. */
  id: string;
  /** El monto, en el texto del servidor (con punto). */
  usdc: string;
  sorteos: number;
  dias: number;
}

/** Lo que se ofrece: el primer paquete, si se vende, y los paquetes para sumar sorteos. */
export interface Oferta {
  alta: ProductoALaVenta | null;
  paquetes: ProductoALaVenta[];
}

/** Nada a la venta. */
export const SIN_OFERTA: Readonly<Oferta> = Object.freeze({ alta: null, paquetes: Object.freeze([]) as unknown as ProductoALaVenta[] });

/** Cuánto se recuerda lo leído: lo mismo que lo guarda el servidor (`Cache-Control: max-age=300`). */
export const CACHE_OFERTA_MS = 300_000;

const sinOferta = (): Oferta => ({ alta: null, paquetes: [] });

/** Lo que se ofrece según lo que contestó el servidor. Sin DOM y sin red. */
export function ofertaDe(r: ResultadoDeAlta<PreciosDeAlta>): Oferta {
  if (!r.ok || r.datos.red !== "mainnet" || r.datos.pago !== true) return sinOferta();
  const a = r.datos.alta;
  return {
    alta: a && !a.pausado ? { id: "alta", usdc: a.usdc, sorteos: a.sorteos, dias: a.dias } : null,
    paquetes: r.datos.paquetes.filter((p) => !p.pausado && p.id !== "alta").map((p) => ({ id: p.id, usdc: p.usdc, sorteos: p.sorteos, dias: p.dias })),
  };
}

/**
 * El recargo por pagar con el QR del banco que anuncia el servidor, para decirlo junto a los precios. Solo con la compra
 * con QR en el build (`qr`, de `compraQrActiva()`), lo que se ofrece leído de la red principal y el pago prendido. Lo
 * que paga una persona no sale de acá: sale del total de su compra, que el servidor da con el recargo ya sumado.
 */
export function recargoQrDe(r: ResultadoDeAlta<PreciosDeAlta>, qr: boolean): RecargoQr | null {
  if (!qr || !r.ok || r.datos.red !== "mainnet" || r.datos.pago !== true || !r.datos.recargoQr) return null;
  return { ...r.datos.recargoQr };
}

export interface OpcionesDeOferta extends OpcionesDeAlta {
  /** La compra prendida en el build. Sin decirlo, `altaPagoActivo()`. */
  pago?: boolean;
}

let recordada: { oferta: Oferta; ms: number } | null = null;
let enCamino: Promise<Oferta> | null = null;

/** Olvida lo leído (las pruebas, y después de un error de compra que dice que algo dejó de venderse). */
export function olvidarOferta(): void {
  recordada = null;
  enCamino = null;
}

/**
 * Lo que se ofrece ahora. Con la compra apagada en el build no le pregunta nada a nadie. Lo que salió bien se recuerda
 * 5 minutos; un error no (la próxima vez se pregunta de nuevo). Dos lecturas a la vez son un solo pedido. Nunca lanza.
 */
export async function leerOferta(o: OpcionesDeOferta = {}): Promise<Oferta> {
  if (!(o.pago ?? altaPagoActivo())) return sinOferta();
  const ahora = (o.ahora ?? Date.now)();
  if (recordada && ahora - recordada.ms < CACHE_OFERTA_MS && ahora >= recordada.ms) return copia(recordada.oferta);
  if (!enCamino) {
    const yo: Promise<Oferta> = precios(o)
      .then((r) => {
        const oferta = ofertaDe(r);
        if (r.ok && enCamino === yo) recordada = { oferta, ms: (o.ahora ?? Date.now)() };
        return oferta;
      })
      .catch(() => sinOferta())
      .finally(() => {
        if (enCamino === yo) enCamino = null;
      });
    enCamino = yo;
  }
  return copia(await enCamino);
}

const copia = (x: Oferta): Oferta => ({ alta: x.alta ? { ...x.alta } : null, paquetes: x.paquetes.map((p) => ({ ...p })) });

/* ------------------------------------------------------------ cómo se dice */

type Idioma = "es" | "en";
const idiomaDe = (x: string): Idioma => (x === "en" ? "en" : "es");

/**
 * El monto como se lee: el número del servidor, con coma en español y punto en inglés, y con dos decimales si tiene
 * centavos. Nunca se redondea: con más de dos decimales, van todos.
 */
export function montoVisible(usdc: string, idioma: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(usdc.trim());
  if (!m) return usdc;
  const entero = String(Number(m[1]));
  const decimales = (m[2] ?? "").replace(/0+$/, "");
  if (!decimales) return entero;
  return `${entero}${idiomaDe(idioma) === "en" ? "." : ","}${decimales.padEnd(2, "0")}`;
}

const poner = (texto: string, vars: Record<string, string>): string => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), texto);

/** Lo que va en `{sorteos}` y en `{precio}` de los textos que ofrecen un producto, ya en el idioma y en singular si toca. */
export function varsDelProducto(p: ProductoALaVenta, idioma: string): { sorteos: string; precio: string } {
  const t = TEXTOS_ALTA_PAGO[idiomaDe(idioma)];
  const monto = montoVisible(p.usdc, idioma);
  return {
    sorteos: p.sorteos === 1 ? (t.pagoSorteo1 as string) : poner(t.pagoSorteosN as string, { n: String(p.sorteos) }),
    precio: monto === "1" ? (t.pagoUnDolar as string) : poner(t.pagoDolares as string, { usdc: monto }),
  };
}

/** La clave del texto que ofrece un producto: el primer paquete, o sumar sorteos. */
export const claveDelProducto = (p: ProductoALaVenta): string => (p.id === "alta" ? "altaPrimerPaquete" : "cupoOfSumarPaquete");

/** El texto que ofrece un producto, entero: «3 sorteos oficiales por 2 dólares», «Organizá 10 sorteos oficiales por 9 dólares». */
export function textoDelProducto(p: ProductoALaVenta, idioma: string): string {
  return poner(TEXTOS_ALTA[idiomaDe(idioma)][claveDelProducto(p)] as string, varsDelProducto(p, idioma));
}
