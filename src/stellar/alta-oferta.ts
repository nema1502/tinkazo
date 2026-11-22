import { TEXTOS_ALTA } from "../alta-textos";
import { TEXTOS_ALTA_PAGO } from "../alta-textos-pago";
import { type OpcionesDeAlta, type PreciosDeAlta, type RecargoQr, type ResultadoDeAlta, precios } from "./alta-api";
import { altaPagoActivo, banderasDeAlta } from "./alta-config";
import { configDelPortero } from "./patrocinio-config";

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
  /**
   * Solo el producto por unidad: `usdc` es el precio de un sorteo (`sorteos` es 1) y la cantidad se elige con el
   * contador, de `minimo` a `maximo` de a `paso`, como lo dice el servidor. Sin esto, un paquete fijo.
   */
  unidad?: { minimo: number; maximo: number; paso: number };
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

/**
 * Lo que se ofrece según lo que contestó el servidor. Sin DOM y sin red. El producto por unidad, si se vende, va primero
 * entre los paquetes (así quien pregunta si hay algo a la venta lo ve igual) y la ventana lo ofrece con el contador.
 */
export function ofertaDe(r: ResultadoDeAlta<PreciosDeAlta>): Oferta {
  if (!r.ok || r.datos.red !== "mainnet" || r.datos.pago !== true) return sinOferta();
  const a = r.datos.alta;
  const u = r.datos.unidad;
  const unidad: ProductoALaVenta[] =
    u && !u.pausado ? [{ id: u.id, usdc: u.usdc, sorteos: 1, dias: u.dias, unidad: { minimo: u.minimo, maximo: u.maximo, paso: u.paso } }] : [];
  const fijos = r.datos.paquetes
    .filter((p) => !p.pausado && p.id !== "alta" && p.id !== u?.id)
    .map((p) => ({ id: p.id, usdc: p.usdc, sorteos: p.sorteos, dias: p.dias }));
  return {
    alta: a && !a.pausado ? { id: "alta", usdc: a.usdc, sorteos: a.sorteos, dias: a.dias } : null,
    paquetes: [...unidad, ...fijos],
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

const copia = (x: Oferta): Oferta => ({
  alta: x.alta ? { ...x.alta } : null,
  paquetes: x.paquetes.map((p) => (p.unidad ? { ...p, unidad: { ...p.unidad } } : { ...p })),
});

/* ------------------------------------------------------------ el regalo de quien entra */

export interface OpcionesDelRegalo extends OpcionesDeAlta {
  /** El acceso por el servidor en el build de la red principal. Sin decirlo, el de este sitio. */
  alta?: boolean;
}

let regaloRecordado: { n: number; ms: number } | null = null;

/** Olvida lo leído del regalo (las pruebas). */
export function olvidarRegalo(): void {
  regaloRecordado = null;
}

/**
 * Cuántos sorteos de regalo da hoy el servidor a quien entra a Oficial (`bienvenida` de `GET /v1/alta/precios`), para lo
 * que dice la hoja de cambio de modo. Se pregunta al portero de la red principal aunque la página esté en Prueba: es una
 * ruta abierta, sin sesión. Sin el acceso por el servidor en el build, sin respuesta, de otra red o sin el campo (el
 * servicio de antes), 0. Lo que salió bien se recuerda 5 minutos. Nunca lanza.
 */
export async function regaloAbierto(o: OpcionesDelRegalo = {}): Promise<number> {
  if (!(o.alta ?? banderasDeAlta(undefined, "mainnet").alta)) return 0;
  const ahora = (o.ahora ?? Date.now)();
  if (regaloRecordado && ahora - regaloRecordado.ms < CACHE_OFERTA_MS && ahora >= regaloRecordado.ms) return regaloRecordado.n;
  const url = o.url !== undefined ? o.url : configDelPortero({ red: "mainnet" }).url;
  const r = await precios({ ...o, url }).catch(() => null);
  if (!r?.ok) return 0;
  const n = r.datos.red === "mainnet" ? (r.datos.bienvenida ?? 0) : 0;
  regaloRecordado = { n, ms: ahora };
  return n;
}

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

/**
 * La clave del texto que ofrece un producto: el primer paquete, o sumar sorteos. El producto por unidad no tiene una
 * cantidad que nombrar hasta que se elige: se ofrece como Sumar sorteos.
 */
export const claveDelProducto = (p: ProductoALaVenta): string => {
  if (p.unidad) return "cupoOfSumar";
  return p.id === "alta" ? "altaPrimerPaquete" : "cupoOfSumarPaquete";
};

/* ------------------------------------------------------------ el contador */

/** La cantidad con que abre el contador si el servidor la permite (el diseño: menos, 10, más). */
export const CANTIDAD_INICIAL = 10;

/** Las cantidades que se pueden pedir: desde el mínimo, de a `paso`, sin pasar el máximo. */
export function cantidadesDe(u: NonNullable<ProductoALaVenta["unidad"]>): number[] {
  const out: number[] = [];
  for (let n = u.minimo; n <= u.maximo; n += u.paso) out.push(n);
  return out;
}

/** Con qué cantidad abre el contador: 10 si se puede pedir, y si no, el mínimo. */
export function cantidadInicial(u: NonNullable<ProductoALaVenta["unidad"]>): number {
  return cantidadesDe(u).includes(CANTIDAD_INICIAL) ? CANTIDAD_INICIAL : u.minimo;
}

/**
 * Un toque del contador: la cantidad de al lado (`-1` menos, `1` más), o la misma si ya está en el borde. Una cantidad
 * que no es de las que se pueden pedir vuelve a la inicial.
 */
export function moverCantidad(u: NonNullable<ProductoALaVenta["unidad"]>, n: number, hacia: -1 | 1): number {
  const lista = cantidadesDe(u);
  const i = lista.indexOf(n);
  if (i < 0) return cantidadInicial(u);
  return lista[Math.min(lista.length - 1, Math.max(0, i + hacia))] ?? n;
}

const ESCALA = 10_000_000n;

/**
 * El precio de un sorteo por la cantidad, en el texto del servidor (con punto y sin ceros de más), sin redondear: en
 * séptimos de centavo, como cuenta el servidor. Es solo para leerlo en el botón: el monto que se paga sale de la orden.
 */
export function totalDe(usdc: string, n: number): string {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(usdc.trim());
  if (!m || !Number.isInteger(n) || n < 0) return usdc;
  const total = (BigInt(m[1] as string) * ESCALA + BigInt((m[2] ?? "").padEnd(7, "0"))) * BigInt(n);
  const entero = (total / ESCALA).toString();
  const decimales = (total % ESCALA).toString().padStart(7, "0").replace(/0+$/, "");
  return decimales ? `${entero}.${decimales}` : entero;
}

/** Un monto con punto dicho como un precio, como `{precio}` de los productos: «1 dólar», «4,50 dólares», «US$1». */
export const precioVisible = (usdc: string, idioma: string): string => varsDelProducto({ id: "", usdc, sorteos: 1, dias: 1 }, idioma).precio;

/** Lo que va en `{total}` del botón que sigue a pagar: el total de esa cantidad, dicho como un precio. */
export function varsDelTotal(p: ProductoALaVenta, n: number, idioma: string): { total: string } {
  return { total: varsDelProducto({ ...p, usdc: totalDe(p.usdc, n) }, idioma).precio };
}

/** El texto que ofrece un producto, entero: «3 sorteos oficiales por 2 dólares», «Organizá 10 sorteos oficiales por 9 dólares». */
export function textoDelProducto(p: ProductoALaVenta, idioma: string): string {
  return poner(TEXTOS_ALTA[idiomaDe(idioma)][claveDelProducto(p)] as string, varsDelProducto(p, idioma));
}
