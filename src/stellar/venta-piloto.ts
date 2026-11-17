/**
 * La puerta de la venta de sorteos oficiales en el sitio: las tres banderas de la venta se leen solo acá.
 *
 * - `VITE_ALTA_PAGO=1`: la compra de sorteos.
 * - `VITE_PAGO_CON_SALDO=1`: pagar un paquete con los dólares digitales de la propia cuenta.
 * - `VITE_COMPRA_QR=1`: comprar un paquete pagando el QR del banco en bolivianos.
 *
 * Son del build y valen para todos los que abren ese build. Por eso, aunque estén prendidas, la venta está **en piloto**:
 * se ve solo en un navegador que tenga la marca del piloto. Sin la marca, el sitio queda exactamente como con las tres
 * apagadas: ni un pedido nuevo al servidor, ni un texto, ni un botón, ni una sección en `precios.html` o `terminos.html`.
 *
 * - **La marca.** Se pone abriendo el sitio con `?piloto=compra` en la dirección y se saca con `?piloto=no`. Queda
 *   guardada en este navegador (`localStorage`) con la hora en que se puso, y vence sola a las seis horas
 *   (`VIDA_DE_LA_MARCA_MS`): un aparato que se usó para probar la compra no queda con la venta a la vista al día
 *   siguiente, cuando quizás atiende a otros. Se lee cada vez que se pregunta, nunca al cargar el módulo: así vale
 *   también en la primera carga. Una vez guardada, `?piloto=` sale de la dirección, así no pasa a quien la copie. Si
 *   el navegador no deja guardar, vale la dirección de esa carga, y la dirección queda como está.
 * - **`VITE_VENTA_ABIERTA=1`** saca el piloto: la venta a la vista para todos los que abren el build. Nace apagada.
 * - **Quién compra de verdad** lo decide el servidor, con su propia lista del piloto. Acá no hay ninguna cuenta.
 * - **Sumar sorteos.** Con la marca y sin la venta abierta para todos, el botón aparece con cualquier cantidad de
 *   sorteos oficiales (`sumarConCualquierCupo`). Si no, solo con pocos (`POCOS_SORTEOS`, `cupo-oficial.ts`).
 *
 * Con un entorno en la mano (`banderasDeVenta(env)`), las banderas son las de ese entorno tal cual: es lo que usan el
 * control del build (`alta-build.ts`) y las pruebas. El sitio pregunta sin entorno y pasa por la marca: que nadie lea
 * las tres en otro lado ni les pase el entorno crudo lo fija `src/venta-piloto-lecturas.test.ts`.
 *
 * Sin imports a propósito: lo leen también `alta-textos-con-cobro.ts` y `alta-build.ts`, que lee `vite.config.ts`.
 */

type Entorno = Record<string, unknown>;

/** Dónde guarda la marca este navegador. */
export const CLAVE_DEL_PILOTO = "tinkazo.venta.piloto";
/** El parámetro de la dirección que pone (`compra`) o saca (`no`) la marca. */
export const PARAMETRO_DEL_PILOTO = "piloto";
/** Cuánto vale la marca desde que se puso: seis horas. Después vence sola, y `?piloto=compra` la pone de nuevo. */
export const VIDA_DE_LA_MARCA_MS = 6 * 60 * 60 * 1000;

/** Las tres banderas de la venta, por su nombre en el build. */
export const NOMBRES_DE_LA_VENTA = ["VITE_ALTA_PAGO", "VITE_PAGO_CON_SALDO", "VITE_COMPRA_QR"] as const;

export interface BanderasDeVenta {
  /** La compra de sorteos (`VITE_ALTA_PAGO`). */
  pago: boolean;
  /** Pagar con el saldo de la cuenta (`VITE_PAGO_CON_SALDO`). */
  saldo: boolean;
  /** La compra con el QR del banco (`VITE_COMPRA_QR`). */
  qr: boolean;
}

/** La venta escondida: lo mismo que las tres apagadas. */
export const VENTA_APAGADA: Readonly<BanderasDeVenta> = Object.freeze({ pago: false, saldo: false, qr: false });

/** Lo que el sitio necesita de la pestaña: la dirección, el almacén, el historial y la hora. Se pasa a mano en las pruebas. */
export interface PestanaDelPiloto {
  location?: { search?: string; pathname?: string; hash?: string } | null;
  localStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  history?: { state?: unknown; replaceState(data: unknown, unused: string, url?: string | null): void } | null;
  /** La hora, en milisegundos. Sin decirla, `Date.now`. */
  ahora?: () => number;
}

const uno = (x: unknown): boolean => x === "1";

/**
 * El entorno del build tal cual. Va escrito `import.meta.env`, entero: así lo reemplaza Vite al armar el sitio. Fuera de
 * Vite (el control del build en `vite.config.ts`) no hay: vacío.
 */
export function entornoDelBuild(): Entorno {
  return (import.meta.env ?? {}) as Entorno;
}

/**
 * Saca `?piloto=` de la dirección sin recargar la página, con lo demás de la dirección tal cual. Nunca lanza: sin
 * historial, la dirección queda como está.
 */
function sacarDeLaDireccion(pestana: PestanaDelPiloto): void {
  try {
    const loc = pestana.location;
    const historial = pestana.history;
    if (!loc || !historial) return;
    const consulta = new URLSearchParams(loc.search ?? "");
    if (!consulta.has(PARAMETRO_DEL_PILOTO)) return;
    consulta.delete(PARAMETRO_DEL_PILOTO);
    const resto = consulta.toString();
    historial.replaceState(historial.state ?? null, "", `${loc.pathname ?? ""}${resto ? `?${resto}` : ""}${loc.hash ?? ""}`);
  } catch {
    /* sin historial: la dirección queda como está */
  }
}

/**
 * La marca del piloto en esta pestaña. Lee la dirección: `?piloto=compra` la guarda con la hora y vale, `?piloto=no` la
 * borra y no vale, y las dos salen de la dirección. Sin ninguna de las dos, vale lo guardado si tiene menos de seis
 * horas; vencida, se borra. Nunca lanza: sin almacén, o con uno que falla, vale solo la dirección, que queda como está.
 */
export function marcaDelPiloto(pestana: PestanaDelPiloto = globalThis as unknown as PestanaDelPiloto): boolean {
  let ahora = Date.now();
  try {
    if (pestana.ahora) ahora = pestana.ahora();
  } catch {
    /* sin hora propia: la del reloj */
  }
  let pide: string | null = null;
  try {
    pide = new URLSearchParams(pestana.location?.search ?? "").get(PARAMETRO_DEL_PILOTO);
  } catch {
    pide = null;
  }
  let almacen: PestanaDelPiloto["localStorage"] = null;
  try {
    almacen = pestana.localStorage ?? null;
  } catch {
    almacen = null;
  }
  if (pide === "compra") {
    let guardada = false;
    try {
      almacen?.setItem(CLAVE_DEL_PILOTO, String(ahora));
      guardada = almacen?.getItem(CLAVE_DEL_PILOTO) === String(ahora);
    } catch {
      /* sin almacén: vale para esta carga */
    }
    // Guardada, la dirección ya no hace falta: así no pasa a quien la copie. Sin guardar, es lo único que la hace valer.
    if (guardada) sacarDeLaDireccion(pestana);
    return true;
  }
  if (pide === "no") {
    try {
      almacen?.removeItem(CLAVE_DEL_PILOTO);
    } catch {
      /* sin almacén: no hay nada que borrar */
    }
    sacarDeLaDireccion(pestana);
    return false;
  }
  let guardado: string | null = null;
  try {
    guardado = almacen?.getItem(CLAVE_DEL_PILOTO) ?? null;
  } catch {
    return false;
  }
  if (guardado === null) return false;
  // Solo la hora en que se puso, del pasado y de hace menos de seis horas. Lo demás (vencida, otra cosa) se borra.
  const desde = /^\d{1,15}$/.test(guardado) ? Number(guardado) : Number.NaN;
  const vale = Number.isFinite(desde) && desde <= ahora && ahora - desde < VIDA_DE_LA_MARCA_MS;
  if (!vale) {
    try {
      almacen?.removeItem(CLAVE_DEL_PILOTO);
    } catch {
      /* sin almacén: no hay nada que borrar */
    }
  }
  return vale;
}

/** La venta está abierta para todos los que abren este build (`VITE_VENTA_ABIERTA=1`): sin piloto. */
export function ventaAbiertaATodos(env: Entorno = entornoDelBuild()): boolean {
  return uno(env.VITE_VENTA_ABIERTA);
}

/** La venta está a la vista en esta pestaña: abierta para todos, o con la marca del piloto. */
export function ventaALaVista(env: Entorno = entornoDelBuild(), pestana?: PestanaDelPiloto): boolean {
  return ventaAbiertaATodos(env) || marcaDelPiloto(pestana);
}

/**
 * Las tres banderas de la venta. Sin `env`, las de este sitio en esta pestaña: las del build con la venta a la vista, y
 * si no, las tres apagadas. Con `env`, lo que dice ese entorno tal cual (el control del build y las pruebas).
 */
export function banderasDeVenta(env?: Entorno): BanderasDeVenta {
  const e = env ?? entornoDelBuild();
  if (env === undefined && !ventaALaVista(e)) return { ...VENTA_APAGADA };
  return { pago: uno(e.VITE_ALTA_PAGO), saldo: uno(e.VITE_PAGO_CON_SALDO), qr: uno(e.VITE_COMPRA_QR) };
}

/**
 * Con el piloto en esta pestaña (la marca, sin la venta abierta para todos), Sumar sorteos se ofrece con cualquier
 * cantidad de sorteos oficiales: quienes prueban la compra no tienen que gastar sorteos para llegar al botón.
 */
export function sumarConCualquierCupo(env: Entorno = entornoDelBuild(), pestana?: PestanaDelPiloto): boolean {
  return !ventaAbiertaATodos(env) && marcaDelPiloto(pestana);
}
