import { TEXTOS_COMPRA } from "../compra-textos";
import type { OrdenDePago } from "../stellar/alta-api";
import { type ProductoALaVenta, montoVisible, varsDelProducto } from "../stellar/alta-oferta";
import { stroopsDe } from "../stellar/pagos";
import {
  type DondeEstaTuDinero,
  type LecturaDeCotizacion,
  type LoQueFalta,
  type MarcasDeOrden,
  type PalabraDeEtapa,
  type PasoDeVerificacion,
  type PrecioDeCarga,
  type QueSeAprueba,
  type QrParaPagar,
  type VistaDeOrden,
  dondeEstaTuDinero,
  etapasDeCarga,
  leerOrden,
  numeroDeCarga,
  pasoDeOrden,
  tiempoQueFalta,
} from "../stellar/rampa-pollar";
import type { Texto } from "./cuenta-lista-estado";
import { cuentaCorta } from "./pago-vista";

/**
 * La compra con el QR del banco, sin DOM: de lo que se sabe (el paquete, el permiso del servidor, el saldo, la
 * cotización, la orden de carga con las marcas de este navegador, la verificación, el medio, y la orden y el pago del
 * paquete) a la pantalla que toca, con su título, su línea, sus datos, su única acción principal, como mucho un enlace y
 * lo plegado en Más detalles. La ventana Tu compra la pinta y corre las acciones. Acá no se llama a nadie.
 *
 * Lo que cuida, y lo fija `compra-qr-estado.test.ts`:
 * - Una sola principal y como mucho un enlace por pantalla.
 * - Tu dinero en toda pantalla desde que hubo un QR, y nunca la cuenta de paso a la vista.
 * - Nunca Terminar mi compra ni Pagar con mi saldo sin un saldo leído que alcance.
 * - Nunca un enlace al otro camino con una carga abierta: nadie paga por los dos.
 * - Nunca sigue sola: aprobar, pagar y pedir un QR nuevo salen de un toque. Las pantallas del QR y de las aprobaciones
 *   salen de `pasoDeOrden` (`rampa-pollar.ts`): con marcas o con la orden de más de 2 minutos se pregunta antes de
 *   mostrar el QR, en el celular primero se guarda el QR, y Todavía no pagué solo con la orden esperando el pago y el QR
 *   vigente.
 *
 * Los montos que ve la persona salen del servidor (el total de la compra, que ya trae el recargo del QR, y el paquete) y
 * de la cotización. La máquina solo resta y compara.
 */

/* ================================================================== lo que entra */

/** Cómo se paga: con el QR del banco en bolivianos, o desde otra app. */
export type MedioDeCompra = "qr" | "app";

/**
 * La compra con QR que dio el servidor (`POST /v1/compra/empezar`, y `compraQr.abierta` de `/v1/alta/estado`). El total
 * ya trae el recargo del QR: el sitio no suma nada.
 */
export interface PermisoDeCompra {
  producto: string;
  /** Cuándo se dio o se renovó, en milisegundos. */
  desde: number;
  /** El recargo del QR, en el texto del servidor (`"4.25"`). */
  recargo: string;
  /** El precio del paquete más el recargo; `null` si el paquete dejó de venderse. */
  total: string | null;
  /** El recargo es el de la primera vez (con la verificación). */
  primera: boolean;
  /** El sitio ya avisó la carga: desde ahí toda orden lleva el recargo. */
  cargada: boolean;
}

/** Dónde está el pago del paquete con el saldo, la misma máquina que paga con el saldo en toda la compra. */
export type PagoDelPaquete =
  | { fase: "pagando" }
  /** Se cortó al mandar: no se sabe si salió, y nunca se manda de nuevo. */
  | { fase: "no-se-sabe" }
  /** Salió y el servidor no lo vio en 5 minutos. */
  | { fase: "sin-ver" }
  /** El servidor lo reconoció: los sorteos que quedan y el saldo de después, si se leyó. */
  | { fase: "listo"; quedan: number | null; saldo: string | null }
  /** La red o la persona lo cancelaron. */
  | { fase: "no-salio" }
  | { fase: "sin-patrocinio" }
  /** Lo armado no coincidía con la orden (la regla o la cuenta de destino). */
  | { fase: "raro" }
  | { fase: "sin-saldo" }
  /** El paquete dejó de venderse (`pago-apagado` o `producto`). */
  | { fase: "no-vende" }
  | { fase: "sin-cuenta" };

export interface CargaEnLaVentana {
  /** La orden de carga tal cual la dio el proveedor. */
  orden: unknown;
  marcas: MarcasDeOrden;
  vista?: VistaDeOrden;
}

export interface VerificacionEnLaVentana {
  /** Tocó Empezar en esta ventana. */
  empezo?: boolean;
  /** Abrió la página de la verificación en otra pestaña. */
  abrio?: boolean;
  /** El navegador no dejó abrir la otra pestaña. */
  bloqueada?: boolean;
  /** La comprobación con el SEGIP volvió sin confirmar. */
  segipNo?: boolean;
}

export interface AprobacionEnLaVentana {
  /** Lo que dijo la regla del paso que espera (`revisarPaso`): qué se aprueba y cuánto, o el motivo para no aprobarlo. */
  revisado?: { que: QueSeAprueba; dolares: number | null } | { motivo: string } | null;
  /** La última aprobación no salió. */
  fallo?: boolean;
  /** Se está aprobando ahora. */
  enCurso?: boolean;
}

export interface LoQueSeSabe {
  idioma: "es" | "en";
  ahora: number;
  /** En el celular, primero se guarda el QR. En el iPhone, solo si se confirma que la imagen va a Fotos. */
  aparato: "compu" | "celular" | "iphone";
  medio: MedioDeCompra;
  /** Se ofrece el enlace para cambiar de camino (`medio-de-pago.ts`). */
  cambio: boolean;
  /** El paquete que se compra, con el precio de `/v1/alta/precios`. */
  producto: ProductoALaVenta;
  permiso: PermisoDeCompra | null;
  /** El servidor no dio el permiso hoy (`tope-del-dia` o `sin-lugar`). */
  sinLugar?: boolean;
  /**
   * El servidor no deja pedir otro QR para esta compra (`409 tope-de-avisos`): ya dio el sí varias veces y lo destraba
   * quien opera. Probar de nuevo no sale bien: la ayuda va a mano.
   */
  topeDeQr?: boolean;
  /** El saldo de la cuenta con siete decimales, o `null` si todavía no se leyó. */
  saldo: string | null;
  /** Se está cotizando o leyendo, sin nada nuevo que mostrar. */
  leyendo?: boolean;
  /** Lo que dijo la cotización, con el monto ya elegido (`compra-monto.ts`). */
  cotizacion: LecturaDeCotizacion | null;
  /** Tres cotizaciones y ninguna llegó a lo que hace falta. */
  noAlcanza?: boolean;
  /** El precio que se mostraba venció y este es el nuevo. */
  precioVencio?: boolean;
  /** Lo mínimo para pagar con QR, en bolivianos (`compraQr.minimoBs`). */
  minimoBs?: number;
  /** Cuántas aprobaciones dijo la cotización, para el título Aprobá el paso 2 de 3. */
  aprobacionesTotales?: number | null;
  verificacion?: VerificacionEnLaVentana;
  /** La página de la verificación puede salir en inglés: en español se avisa. */
  diditEnIngles?: boolean;
  carga: CargaEnLaVentana | null;
  aprobacion?: AprobacionEnLaVentana;
  /** Volvió de Todavía no pagué: el mismo QR, con el aviso de no pagarlo dos veces. */
  todaviaNo?: boolean;
  pago?: PagoDelPaquete | null;
  /**
   * Hay un pago con el saldo de la orden del paquete que quizás salió y el servidor todavía no reconoció: la marca del
   * pago de este navegador (`leerMarcaDelPago`, también vencida) o lo que diga el servidor. Al volver, aunque `pago`
   * empiece vacío, la pantalla es la de ese pago y nunca pide pagar de nuevo ni lo que falta.
   */
  pagoEnviado?: boolean;
  /** Lo que el servidor da por pagado de la orden del paquete (`/v1/alta/pago`): el total, el mínimo y lo que ya recibió. */
  cobro?: { total: string; minimo: string; recibido?: string } | null;
  /** La orden del paquete, para pagar desde otra app. */
  ordenDelPaquete?: OrdenDePago | null;
  /**
   * Una orden de pagar desde otra app, viva y sin nada recibido, que el aviso de carga no reemplaza sin preguntar
   * (`409 orden-abierta`): la persona pudo pagarla y el pago todavía no llegó. Hasta que diga si la pagó, no hay QR.
   */
  otraOrden?: { id: string; producto: string } | null;
  /**
   * El recargo del QR que va en toda orden de la persona mientras su compra cargada siga sin pagar
   * (`compraQr.recargoPendiente` del estado), también después de anularla: el servidor suelta la reserva y no el recargo.
   */
  recargoPendiente?: string | null;
  sinRed?: boolean;
  sesionVencida?: boolean;
}

/* ================================================================== lo que sale */

export type IdDePantalla =
  | "espera"
  | "verificar"
  | "carnet"
  | "carnet-espera"
  | "carnet-bloqueada"
  | "carnet-vencida"
  | "datos"
  | "segip"
  | "alta"
  | "preparar"
  | "precio"
  | "precio-vencido"
  | "qr"
  | "qr-falta"
  | "ya-pagaste"
  | "espera-pago"
  | "camino"
  | "antes"
  | "aprobar"
  | "aprobar-no-salio"
  | "llego"
  | "saldo"
  | "pagando"
  | "listo"
  | "app"
  | "sin-qr"
  | "revision"
  | "segip-no"
  | "rechazo"
  | "qr-vencido-cerrada"
  | "qr-vencido-abierta"
  | "frenada"
  | "menos"
  | "no-vende"
  | "pago-no-salio"
  | "pago-sin-patrocinio"
  | "pago-raro"
  | "pago-no-se-sabe"
  | "pago-sin-ver"
  | "otra-orden"
  | "raro"
  | "desconocido"
  | "fallo"
  | "proteger"
  | "sin-red"
  | "sesion";

export type AccionDeCompra =
  /** Ocupada: la ventana está leyendo o pagando. */
  | "esperar"
  | "mirar"
  | "reintentar"
  | "entrar"
  | "empezar-verificacion"
  | "abrir-verificacion"
  | "ya-termine"
  | "verificacion-otra-vez"
  | "guardar-datos"
  | "confirmar-segip"
  | "darme-de-alta"
  | "proteger"
  | "preparar"
  | "ver-qr"
  | "guardar-qr"
  | "ya-pague"
  | "si-pague"
  | "mostrar-qr"
  | "todavia-no"
  | "abrir-banco"
  | "pedir-qr-nuevo"
  | "pague-igual"
  | "ver-primer-paso"
  | "aprobar"
  | "reintentar-carga"
  /** Terminar mi compra o Pagar con mi saldo: la misma máquina del saldo. */
  | "pagar-paquete"
  /** Pregunta si el pago del paquete llegó, sin mandarlo de nuevo. */
  | "mirar-pago"
  | "cargar-falta"
  | "usar-cupon"
  /** Pagar desde otra app, o No estoy en Bolivia: se recuerda la elección. */
  | "otra-app"
  /** Estoy en Bolivia: se recuerda la elección. */
  | "estoy-en-bolivia"
  | "mandar"
  | "escribir"
  | "empezar-de-nuevo"
  | "ya-pague-app"
  /** No pagué la orden de otra app: recién ahí el aviso de carga la reemplaza y sale el QR. */
  | "no-pague-otra"
  /** Ya la pagué desde otra app: esa orden, para mirar su pago. */
  | "pague-otra"
  | "activar"
  | "seguir-compra"
  /** Armar mi primer sorteo: la compra quedó lista y la ventana lleva a sortear. */
  | "sortear"
  | "cerrar";

export interface BotonDeCompra extends Texto {
  accion: AccionDeCompra;
  /** Corre esto mismo: apagada, con la ruedita. */
  ocupado?: boolean;
  /** Un enlace de texto (el de abrir la verificación se abre en otra pestaña). */
  forma?: "boton" | "enlace";
}

/** Lo que hace falta para pagar desde otra app, de la orden del paquete tal cual. La cuenta va corta a la vista. */
export interface PagoDesdeOtraApp {
  monto: string;
  nota: string;
  cuenta: string;
  cuentaCorta: string;
  enlace: string;
  vence: number;
}

export interface PantallaDeCompra {
  id: IdDePantalla;
  /** El rótulo chico de la etapa, solo en las pantallas de la verificación y en el primer precio. */
  etapa: Texto | null;
  titulo: Texto;
  linea: Texto | null;
  datos: Texto[];
  principal: BotonDeCompra;
  enlace: BotonDeCompra | null;
  plegado: Texto[];
  /** La clave de dónde está el dinero (`compraDonde…`), que va en el dato Tu dinero; `null` si la pantalla no lo dice. */
  donde: string | null;
  /** El número de compra, cuando hace falta pedir ayuda. */
  numero: string | null;
  /** El QR para pagar, solo en qr. */
  qr: QrParaPagar | null;
  /** Las cuatro etapas con su palabra, solo en camino. */
  etapas: { clave: string; palabra: PalabraDeEtapa }[] | null;
  /** Los datos para pagar desde otra app, solo en app. */
  app: PagoDesdeOtraApp | null;
  /** Lo que la ventana tiene que leer para seguir (solo en espera). */
  leer: "saldo" | "permiso" | "cobro" | null;
  /**
   * Lo que se paga con el saldo al tocar la principal (Terminar mi compra, Pagar con mi saldo o Probar de nuevo), en el
   * texto de un monto del servidor (`8.25`). El motor paga este monto y no el de la orden: con el saldo entre el mínimo y
   * el total, es el saldo entero. Nunca más que el saldo leído. `null` si la principal no paga.
   */
  pagar: string | null;
}

/* ================================================================== piezas */

const t = (clave: string, vars?: Record<string, string>): Texto => (vars ? { clave, vars } : { clave });
const boton = (accion: AccionDeCompra, clave: string, o: Partial<BotonDeCompra> = {}): BotonDeCompra => ({ accion, clave, ...o });
const enlace = (accion: AccionDeCompra, clave: string): BotonDeCompra => boton(accion, clave, { forma: "enlace" });
const OTRA_APP = (): BotonDeCompra => enlace("otra-app", "compraOtraApp");
const VOLVER_A_MIRAR = (): BotonDeCompra => boton("mirar", "saldoVolverAMirar");
const ESCRIBIR = (): BotonDeCompra => boton("escribir", "compraEscribinos");
/** Escribir a Tinkazo como enlace: en las esperas con el dinero en el medio, pedir ayuda siempre está a mano. */
const AYUDA = (): BotonDeCompra => enlace("escribir", "compraEscribinos");
/** Tu dinero y, si lo hay, el número de compra para pedir ayuda. */
const conNumero = (dinero: Texto, numero: string | null): Texto[] => (numero ? [dinero, t("compraDatoNumero", { orden: numero })] : [dinero]);

const VACIA = { etapa: null, linea: null, datos: [], enlace: null, plegado: [], donde: null, numero: null, qr: null, etapas: null, app: null, leer: null, pagar: null } satisfies Partial<PantallaDeCompra>;

function pantalla(id: IdDePantalla, titulo: Texto, principal: BotonDeCompra, resto: Partial<PantallaDeCompra> = {}): PantallaDeCompra {
  return { ...VACIA, id, titulo, principal, ...resto };
}

const texto = (l: "es" | "en", clave: string): string => (TEXTOS_COMPRA[l][clave] as string | undefined) ?? clave;

/** El dato Tu dinero, con la frase de `compraDonde…` en el idioma de la ventana. */
const tuDinero = (l: "es" | "en", donde: string): Texto => t("compraDatoDonde", { donde: texto(l, donde) });

const DONDE: Record<string, string> = {
  dondeBanco: "compraDondeBanco",
  dondeSaliendo: "compraDondeSaliendo",
  dondeStereum: "compraDondeStereum",
  dondePaso: "compraDondePaso",
  dondeViaje: "compraDondeViaje",
  dondeCuenta: "compraDondeCuenta",
  dondeRevision: "compraDondeRevision",
};
/**
 * Una carga que se cerró: si falló antes de dibujar el QR, no se movió nada; devuelta, en el banco; y si no se ve el
 * pago, la frase prudente (nunca que no pagó).
 */
const CIERRE: Record<string, string> = { cargaFalloSinPago: "compraDondeNada", cargaFalloSinVerPago: "compraDondeBanco", cargaDevueltaSinMonto: "compraDondeDevuelto" };

const claveDeDonde = (d: DondeEstaTuDinero): string => ("donde" in d ? (DONDE[d.donde] ?? "compraDondeRevision") : (CIERRE[d.cierre] ?? "compraDondeRevision"));

const FINALES = new Set(["completed", "failed", "refunded"]);
/** La carga sigue abierta: no se ofrece el otro camino. Una orden que no se lee cuenta como abierta. */
function cargaAbierta(c: CargaEnLaVentana | null): boolean {
  if (!c) return false;
  const o = leerOrden(c.orden);
  return !o || !FINALES.has(o.estado);
}

/* ------------------------------------------------------------------ los montos */

const MONTO = /^\d{1,15}(?:\.\d{1,7})?$/;
/** Un monto del servidor o del saldo en stroops (siete decimales), o `null` si no tiene forma de monto. */
const stroops = (m: string | null | undefined): bigint | null => (typeof m === "string" && MONTO.test(m.trim()) ? stroopsDe(m.trim()) : null);
const stroopsDeNumero = (n: number): bigint | null => (Number.isFinite(n) && n >= 0 ? stroopsDe(n.toFixed(7)) : null);
const CENTAVO = 100_000n;

/** Stroops como se leen, al centavo: para abajo lo que la persona tiene, para arriba lo que le falta. */
function alCentavo(s: bigint, idioma: "es" | "en", arriba = false): string {
  const c = arriba ? (s + CENTAVO - 1n) / CENTAVO : s / CENTAVO;
  return montoVisible(`${c / 100n}.${String(c % 100n).padStart(2, "0")}`, idioma);
}

/** Stroops como el texto de un monto del servidor («4», «0.5»): para `varsDelProducto`, que los dice como precio. */
function usdcDe(st: bigint): string {
  const entero = st / 10_000_000n;
  const decimales = (st % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
  return decimales ? `${entero}.${decimales}` : String(entero);
}

const alcanza = (saldo: string | null, monto: string | null): boolean => {
  const a = stroops(saldo);
  const b = stroops(monto);
  return a !== null && b !== null && a >= b;
};

/** El dato de un monto en dólares, con su variante de un dólar justo. */
const datoEnDolares = (clave: string, monto: string): Texto => (monto === "1" ? t(`${clave}1`) : t(clave, { n: monto }));

const horaDe = (ms: number, idioma: "es" | "en"): string => {
  try {
    return new Intl.DateTimeFormat(idioma === "en" ? "en-US" : "es-BO", { hour: "2-digit", minute: "2-digit", ...(idioma === "en" ? {} : { hourCycle: "h23" as const }) }).format(ms);
  } catch {
    return "";
  }
};

/** El precio del paquete, como se dice: «9 dólares», «US$9». */
const precioVisible = (s: LoQueSeSabe, usdc: string): string => varsDelProducto({ ...s.producto, usdc }, s.idioma).precio;

export { cuentaCorta };

/** El id de una orden tal cual vino, aunque el resto no se pueda leer. */
function idDeLaOrden(orden: unknown): string | null {
  const id = typeof orden === "object" && orden !== null ? (orden as { id?: unknown }).id : null;
  return typeof id === "string" && id.trim() !== "" ? id.trim() : null;
}

/**
 * El número de compra: el de la orden de carga, o sin ella el de la orden del paquete. Sale del id de la orden: también
 * cuando el resto no se puede leer, que es justo cuando hace falta pedir ayuda.
 */
function numeroDeLaCompra(s: LoQueSeSabe): string | null {
  const id = s.carga ? idDeLaOrden(s.carga.orden) : null;
  if (id) return numeroDeCarga(id);
  return s.ordenDelPaquete ? s.ordenDelPaquete.id.slice(-8).toUpperCase() : null;
}

/** El enlace de Escribir a Tinkazo, con el número de compra en el asunto si lo hay. */
export function correoDeAyuda(numero: string | null, idioma: "es" | "en"): string {
  const base = "mailto:hola@tinkazo.app";
  return numero ? `${base}?subject=${encodeURIComponent(texto(idioma, "compraAsunto").replace("{numero}", numero))}` : base;
}

/* ================================================================== la pantalla */

/** La pantalla que toca para lo que se sabe ahora. Nunca hace nada: dice qué se ve y qué hace cada toque. */
export function pantallaDeCompra(s: LoQueSeSabe): PantallaDeCompra {
  const p = conReglas(pantallaBase(s), s);
  if (s.sesionVencida) return { ...p, id: "sesion", titulo: t("compraSesionTitulo"), linea: t("compraSesionLinea"), principal: boton("entrar", "clEntrarDeNuevo"), enlace: null, plegado: [], qr: null, app: null };
  if (s.sinRed) {
    const datos = p.donde && !p.datos.some((d) => d.clave === "compraDatoDonde") ? [...p.datos, tuDinero(s.idioma, p.donde)] : p.datos;
    return { ...p, id: "sin-red", linea: t(s.carga ? "compraSinRed" : "clErrRed"), datos, principal: boton("reintentar", "clProbarDeNuevo"), enlace: null, plegado: [], qr: null, app: null };
  }
  return p;
}

/** Lo que vale para toda pantalla: el otro camino solo si se ofrece y nunca con una carga abierta. */
function conReglas(p: PantallaDeCompra, s: LoQueSeSabe): PantallaDeCompra {
  const deCambio = p.enlace && (p.enlace.accion === "otra-app" || p.enlace.accion === "estoy-en-bolivia");
  return deCambio && (!s.cambio || cargaAbierta(s.carga)) ? { ...p, enlace: null } : p;
}

function pantallaBase(s: LoQueSeSabe): PantallaDeCompra {
  if (s.pago) return pantallaDelPago(s, s.pago);
  // Un pago con el saldo que quizás salió y nadie reconoció: no se sabe todavía, y no se repite.
  if (s.pagoEnviado) return pantallaDelPago(s, { fase: "no-se-sabe" });
  if (s.carga) return pantallaDeLaCarga(s, s.carga);
  if (s.saldo === null) return espera(s, "saldo");
  // Una compra ya cargada cuya carga terminó: lo que llegó paga el total de la compra, que trae el recargo.
  if (s.permiso?.cargada && s.permiso.total !== null && alcanza(s.saldo, s.permiso.total)) return pantallaDeLlegada(s);
  // El saldo alcanza: un botón, sin cotizar ni pedir permiso. Antes de cargar, pagar con el saldo no lleva recargo.
  if (!s.permiso?.cargada && alcanza(s.saldo, s.producto.usdc)) return pantallaDeSaldo(s, s.producto.usdc);
  if (s.medio === "app") return pantallaDeApp(s);
  return pantallaAntesDelQr(s);
}

/* ------------------------------------------------------------------ mientras se lee */

function espera(s: LoQueSeSabe, leer: PantallaDeCompra["leer"], donde: string | null = null): PantallaDeCompra {
  return pantalla("espera", t("compraPreparandoTitulo"), boton("esperar", "compraUnMomento", { ocupado: true }), {
    linea: donde ? null : t("compraPreparandoLinea"),
    datos: donde ? [tuDinero(s.idioma, donde)] : [],
    donde,
    leer,
  });
}

/* ------------------------------------------------------------------ pagar con el saldo y desde otra app */

function pantallaDeSaldo(s: LoQueSeSabe, precio: string): PantallaDeCompra {
  const saldo = stroops(s.saldo) ?? 0n;
  return pantalla("saldo", t("compraSaldoTitulo"), boton("pagar-paquete", "compraPagarSaldo", { vars: { precio: precioVisible(s, precio) } }), {
    linea: t("compraSaldoLinea", { saldo: alCentavo(saldo, s.idioma) }),
    datos: [t("compraDatoPaquete", { sorteos: varsDelProducto(s.producto, s.idioma).sorteos })],
    plegado: [t("compraSaldoMas")],
    pagar: precio,
  });
}

function pantallaDeApp(s: LoQueSeSabe): PantallaDeCompra {
  const o = s.ordenDelPaquete;
  if (!o) return espera(s, null);
  // Con el recargo de una compra con QR en curso, el total de la orden lo trae: se dice cuánto, con el número del servidor.
  const recargo = stroops(o.recargo);
  const datos = recargo !== null && recargo > 0n ? [t("compraDatoMoneda"), datoEnDolares("compraDatoIncluyeRecargo", alCentavo(recargo, s.idioma))] : [t("compraDatoMoneda")];
  return pantalla("app", t("compraAppTitulo"), boton("ya-pague-app", "pagoYaPague"), {
    linea: t("compraAppLinea"),
    datos,
    enlace: enlace("estoy-en-bolivia", "compraEstoy"),
    plegado: recargo !== null && recargo > 0n ? [t("compraRecargoPendiente"), t("compraNotaMemo"), t("compraSinDolares")] : [t("compraNotaMemo"), t("compraSinDolares")],
    app: { monto: o.usdc, nota: o.nota, cuenta: o.destino, cuentaCorta: cuentaCorta(o.destino), enlace: o.enlace, vence: o.vence },
  });
}

/* ------------------------------------------------------------------ el camino del QR, antes de la carga */

const NADA = "compraDondeNada";

function sinQr(s: LoQueSeSabe): PantallaDeCompra {
  return pantalla("sin-qr", t("compraSinQrTitulo"), VOLVER_A_MIRAR(), { linea: t("compraSinQrLinea"), datos: [tuDinero(s.idioma, NADA)], donde: NADA, enlace: OTRA_APP() });
}

function noVende(s: LoQueSeSabe, conCarga: boolean): PantallaDeCompra {
  if (!conCarga) return pantalla("no-vende", t("compraNoVendeTitulo"), VOLVER_A_MIRAR(), { linea: t("compraNoVendeSinCarga"), datos: [tuDinero(s.idioma, NADA)], donde: NADA });
  const cuenta = "compraDondeCuenta";
  return pantalla("no-vende", t("compraNoVendeTitulo"), VOLVER_A_MIRAR(), {
    linea: t("compraNoVendeLinea"),
    datos: [tuDinero(s.idioma, cuenta)],
    donde: cuenta,
    enlace: enlace("mandar", "compraMandar"),
  });
}

function pantallaAntesDelQr(s: LoQueSeSabe): PantallaDeCompra {
  // Una orden de pagar desde otra app sin pagar: se pregunta antes del QR, y nunca se reemplaza sola.
  if (s.otraOrden) return pantalla("otra-orden", t("compraOtraOrdenTitulo"), boton("no-pague-otra", "compraOtraOrdenNo"), { linea: t("compraOtraOrdenLinea"), enlace: enlace("pague-otra", "compraOtraOrdenSi") });
  // Pidió varios QR para esta compra: lo destraba Tinkazo. Escribir a Tinkazo es la principal, con su propio título (no
  // es que el pago con QR se cayó para todos), y nunca Sin conexión. Volver a mirar queda como enlace.
  if (s.topeDeQr) return pantalla("sin-qr", t("compraTopeDeQrTitulo"), ESCRIBIR(), { linea: t("compraTopeDeQr"), datos: [tuDinero(s.idioma, NADA)], donde: NADA, enlace: enlace("mirar", "saldoVolverAMirar") });
  if (s.sinLugar || s.noAlcanza) return sinQr(s);
  if (!s.permiso) return espera(s, "permiso");
  if (s.permiso.total === null) return noVende(s, false);
  const c = s.cotizacion;
  if (s.leyendo || !c) return espera(s, null);
  switch (c.estado) {
    case "precio":
      return pantallaDelPrecio(s, c.precio, s.permiso.total);
    case "falta":
      return pantallaDeLoQueFalta(s, c.falta);
    case "en-revision":
      return s.verificacion?.segipNo
        ? pantalla("segip-no", t("compraSegipNoTitulo"), VOLVER_A_MIRAR(), { linea: t("compraSegipNo"), datos: [tuDinero(s.idioma, NADA)], donde: NADA })
        : pantalla("revision", t("compraRevisionTitulo"), VOLVER_A_MIRAR(), { linea: t("compraRevisionLinea"), datos: [tuDinero(s.idioma, NADA)], donde: NADA, enlace: OTRA_APP() });
    case "rechazada":
      return pantalla("rechazo", t("compraRechazoTitulo"), boton("usar-cupon", "cupoOfUsarCupon"), {
        linea: t("compraRechazoLinea"),
        datos: [tuDinero(s.idioma, NADA)],
        donde: NADA,
        enlace: OTRA_APP(),
        plegado: [t("compraRechazoMas")],
      });
    case "sin-red":
      return pantalla("sin-red", t("compraPreparandoTitulo"), boton("reintentar", "clProbarDeNuevo"), { linea: t("clErrRed"), datos: [tuDinero(s.idioma, NADA)], donde: NADA });
    default:
      // Sin ruta, sin créditos de Tinkazo antes de crear la orden, o el monto fuera de lo que acepta el proveedor.
      return sinQr(s);
  }
}

function pantallaDeLoQueFalta(s: LoQueSeSabe, falta: readonly LoQueFalta[]): PantallaDeCompra {
  const f = falta[0];
  if (!f) return sinQr(s);
  if (f.que === "verificacion") return pantallaDeVerificacion(s, f.paso);
  if (f.que === "proteger-cuenta") return proteger(s, null);
  return pantalla("preparar", t("compraPrepTitulo"), boton("preparar", "compraPrepBoton"), { linea: t("compraPrepLinea"), plegado: [t("compraPrepMas")] });
}

/**
 * La cuenta pide protegerse: la principal abre el paso de la cuenta en modo compra, que dice lo suyo, y vuelve a la
 * ventana. Acá no va una línea propia.
 */
function proteger(s: LoQueSeSabe, donde: string | null): PantallaDeCompra {
  return pantalla("proteger", t("clProtegerTitulo"), boton("proteger", "clSeguir"), {
    datos: donde ? [tuDinero(s.idioma, donde)] : [],
    donde,
  });
}

function etapaDeIdentidad(s: LoQueSeSabe, paso: PasoDeVerificacion): Texto {
  if (paso.numero === null || paso.total === null) return t("compraEtapaIdentidad");
  return t("compraEtapaN", { etapa: texto(s.idioma, "compraEtapaIdentidad"), n: String(paso.numero), total: String(paso.total) });
}

function pantallaDeVerificacion(s: LoQueSeSabe, paso: PasoDeVerificacion): PantallaDeCompra {
  const v = s.verificacion ?? {};
  const etapa = etapaDeIdentidad(s, paso);
  switch (paso.tipo) {
    case "KYC": {
      const id = t("compraIdTitulo");
      if (paso.estado === "vencido") return pantalla("carnet-vencida", id, boton("verificacion-otra-vez", "cargaIdOtraVez"), { etapa, linea: t("compraIdVencida") });
      if (!v.empezo && paso.estado === "por-hacer") {
        return pantalla("verificar", t("compraVerifTitulo"), boton("empezar-verificacion", "cargaVerifEmpezar"), {
          etapa: t("compraEtapaIdentidad"),
          linea: t("compraVerifLinea"),
          // Antes de pedir el carnet, qué se compra y lo que suma el QR: la entrada lleva directo acá, sin otra ventana.
          datos: [...datosDelPaquete(s), t("compraDatoCambia")],
          enlace: enlace("otra-app", "compraNoEstoy"),
          // Verificarse va dentro del pago con QR de la primera vez: se dice solo cuando es ese recargo.
          plegado: s.permiso?.primera ? [t("compraVerifPasos"), t("compraVerifDatos"), t("cargaVerifGratis")] : [t("compraVerifPasos"), t("compraVerifDatos")],
        });
      }
      if (v.bloqueada) return pantalla("carnet-bloqueada", id, enlace("abrir-verificacion", "cargaIdAbrir"), { etapa, linea: t("cargaIdBloqueada") });
      if (v.abrio) return pantalla("carnet-espera", id, boton("ya-termine", "cargaIdYaTermine"), { etapa, linea: t("compraIdEsperando"), enlace: enlace("abrir-verificacion", "cargaIdAbrir") });
      return pantalla("carnet", id, boton("abrir-verificacion", "cargaIdAbrir"), {
        etapa,
        linea: t("compraIdLinea"),
        plegado: s.diditEnIngles && s.idioma === "es" ? [t("compraIdLuz"), t("compraIdIngles")] : [t("compraIdLuz")],
      });
    }
    case "FORM":
      return pantalla("datos", t("cargaFormTitulo"), boton("guardar-datos", "cargaFormGuardar"), { etapa, linea: t("compraFormLinea") });
    case "REGISTRY_CHECK":
      if (v.segipNo) return pantalla("segip-no", t("compraSegipNoTitulo"), VOLVER_A_MIRAR(), { linea: t("compraSegipNo"), datos: [tuDinero(s.idioma, NADA)], donde: NADA });
      // Si lo que se leyó del carnet está mal, la persona no lo puede corregir acá: la salida es escribirnos.
      return pantalla("segip", t("cargaSegipTitulo"), boton("confirmar-segip", "cargaSegipOk"), { etapa, linea: t("cargaSegipTexto"), enlace: enlace("escribir", "compraEscribinos") });
    case "PROVIDER_REGISTRATION":
      return pantalla("alta", t("compraAltaTitulo"), boton("darme-de-alta", "cargaAltaOk"), { etapa, linea: t("compraAltaLinea"), plegado: [t("compraAltaAcepto")] });
  }
}

/**
 * Lo que suma pagar con QR, como dato: la primera vez (con la verificación) o las siguientes, con el número del
 * servidor. `null` si el recargo no tiene forma de monto.
 */
function datoDelRecargo(permiso: PermisoDeCompra, idioma: "es" | "en"): Texto | null {
  const r = stroops(permiso.recargo);
  return r === null ? null : datoEnDolares(permiso.primera ? "compraDatoRecargoPrimera" : "compraDatoRecargo", alCentavo(r, idioma));
}

/**
 * El paquete con su precio y lo que suma pagar con el QR, los dos del servidor: el total del permiso menos su recargo, y
 * el recargo. Si no cierran, el precio del paquete que se vende. Va en Verificá tu identidad y en el precio.
 */
function datosDelPaquete(s: LoQueSeSabe): Texto[] {
  const totalS = stroops(s.permiso?.total);
  const recargoS = s.permiso ? stroops(s.permiso.recargo) : null;
  const paquete = totalS !== null && recargoS !== null && totalS >= recargoS ? usdcDe(totalS - recargoS) : s.producto.usdc;
  const datos: Texto[] = [t("compraDatoPaqueteDe", { sorteos: varsDelProducto(s.producto, s.idioma).sorteos, precio: precioVisible(s, paquete) })];
  const recargo = s.permiso ? datoDelRecargo(s.permiso, s.idioma) : null;
  if (recargo) datos.push(recargo);
  return datos;
}

/**
 * El precio del QR. El botón del paquete prometía su precio (3 sorteos por 4 dólares): a la vista va ese mismo precio y,
 * aparte, lo que suma pagar con el QR, los dos del servidor (el total del permiso menos su recargo, y el recargo), con el
 * total y cuánto sale cada dólar, así los bolivianos del título se entienden. Lo que tarda va a la vista, antes de pagar.
 * Lo que queda en el saldo, plegado.
 */
function pantallaDelPrecio(s: LoQueSeSabe, precio: PrecioDeCarga, total: string): PantallaDeCompra {
  const L = s.idioma;
  const n = precio.aprobaciones;
  const linea = s.precioVencio ? t("compraPrecioVencio") : n === null || n < 1 ? t("compraPrecioLineaSinN") : n === 1 ? t("compraPrecioLinea1") : t("compraPrecioLinea", { n: String(n) });
  const saldo = stroops(s.saldo) ?? 0n;
  const totalS = stroops(total);
  const queda = saldo + (stroopsDeNumero(precio.recibis) ?? 0n) - (totalS ?? 0n);
  const datos: Texto[] = datosDelPaquete(s);
  // El total y cuánto sale cada dólar, a la vista: así se entienden los bolivianos del título.
  if (totalS !== null) datos.push(datoEnDolares("compraDatoTotal", alCentavo(totalS, L)));
  datos.push(t("compraDatoTasa", { tasa: montoVisible(precio.tasa.toFixed(2), L) }));
  if (saldo >= CENTAVO) datos.push(datoEnDolares("compraDatoSaldo", alCentavo(saldo, L)));
  if (precio.minutos !== null) datos.push(precio.minutos > 1 ? t("compraDatoTarda", { m: String(precio.minutos) }) : t("compraDatoTardaPoco"));
  const vence = precio.vence === null ? Number.NaN : Date.parse(precio.vence);
  if (Number.isFinite(vence)) datos.push(t("compraDatoVale", { hora: horaDe(vence, L) }));
  const plegado: Texto[] = [t(s.permiso?.primera ? "compraComoSePagaPrimera" : "compraComoSePaga"), t("compraSobraPorQue")];
  if (queda >= CENTAVO) plegado.push(datoEnDolares("compraDatoQueda", alCentavo(queda, L)));
  if (s.minimoBs && s.minimoBs > 0 && precio.pagas <= s.minimoBs) plegado.push(t("compraMinimo", { min: String(s.minimoBs) }));
  return pantalla(s.precioVencio ? "precio-vencido" : "precio", t("compraPrecioTitulo", { bs: montoVisible(String(precio.pagas), L) }), boton("ver-qr", "compraVerQr"), {
    etapa: s.permiso?.primera ? t("compraEtapaPago") : null,
    linea,
    datos,
    enlace: OTRA_APP(),
    plegado,
  });
}

/* ------------------------------------------------------------------ con una orden de carga */

function pantallaDeLaCarga(s: LoQueSeSabe, c: CargaEnLaVentana): PantallaDeCompra {
  const L = s.idioma;
  const vista = c.vista ?? {};
  const p = pasoDeOrden(c.orden, c.marcas, s.ahora, vista);
  const donde = dondeEnPantalla(claveDeDonde(dondeEstaTuDinero(c.orden, c.marcas, s.ahora, vista)), p, c.orden);
  const dinero = tuDinero(L, donde);
  const numero = numeroDeLaCompra(s);
  switch (p.pantalla) {
    case "pagar": {
      // Junto al QR van el monto y el vencimiento. Tu dinero (todavía en tu banco) competía con el monto y sembraba la
      // duda: aparece recién desde Ya pagué.
      const datos = [t("compraDatoMonto", { bs: montoVisible(p.qr.bs, L) })];
      if (p.qr.vence !== null) datos.push(t("compraDatoVence", { hora: horaDe(p.qr.vence, L) }));
      const guardado = s.aparato !== "compu" && c.marcas.guardoQr !== null;
      // Abrir en la app de mi banco lleva el QR al banco sin bajar la imagen: la línea pide pagarlo una vez y Ya pagué.
      const abrioBanco = s.aparato !== "compu" && vista.abrioBanco === true;
      const linea = s.todaviaNo || abrioBanco ? "compraTodaviaNoLinea" : guardado ? "compraQrGuardadoLinea" : s.aparato === "compu" ? "compraQrLinea" : s.aparato === "iphone" ? "compraQrLineaIos" : "compraQrLineaCel";
      // En el celular, primero se guarda el QR (o se abre en el banco): Ya pagué aparece recién después.
      const principal = s.aparato === "celular" && c.marcas.guardoQr === null && !abrioBanco ? boton("guardar-qr", "cargaGuardarQr") : boton("ya-pague", "cargaYaPague");
      return pantalla("qr", t("compraQrTitulo"), principal, {
        linea: t(linea),
        datos,
        donde,
        qr: p.qr,
        enlace: s.aparato !== "compu" && p.qr.enlace ? enlace("abrir-banco", "cargaAbrirBanco") : null,
      });
    }
    case "qr-falta":
      return pantalla("qr-falta", t("compraQrTitulo"), VOLVER_A_MIRAR(), { linea: t("compraQrFalta"), datos: [dinero], donde });
    case "ya-pagaste": {
      const qr = montoDelQr(c.orden);
      return pantalla("ya-pagaste", t("cargaYaPagasteTitulo"), boton("si-pague", "cargaSiPague"), {
        linea: t("cargaYaPagasteTexto"),
        datos: qr ? [t("compraDatoMonto", { bs: montoVisible(qr, L) }), dinero] : [dinero],
        donde,
        enlace: enlace("mostrar-qr", "cargaMostrarQr"),
      });
    }
    case "esperando-pago": {
      // Con el QR vigente, Todavía no pagué. Si no, y el banco tarda, pedir ayuda con el número.
      const todaviaNo = esperaElPagoConQrVigente(c.orden, s.ahora);
      return pantalla("espera-pago", t("compraEsperandoTitulo"), VOLVER_A_MIRAR(), {
        linea: t(p.tarda ? "compraPagoTarda" : "compraEsperandoLinea"),
        datos: p.tarda ? conNumero(dinero, numero) : [dinero],
        donde,
        numero: p.tarda ? numero : null,
        enlace: todaviaNo ? enlace("todavia-no", "compraTodaviaNo") : p.tarda ? AYUDA() : null,
        plegado: [t("compraPodesCerrar")],
      });
    }
    case "qr-vencido-abierta":
      return pantalla("qr-vencido-abierta", t("compraQrVencioTitulo"), VOLVER_A_MIRAR(), {
        linea: t("compraQrVencioAbierta"),
        datos: conNumero(dinero, numero),
        donde,
        numero,
        enlace: AYUDA(),
        plegado: [t("compraQrVencioAbiertaMas")],
      });
    case "qr-vencido-cerrada":
      return pantalla("qr-vencido-cerrada", t("compraQrVencioTitulo"), boton("pedir-qr-nuevo", "cargaQrNuevo"), {
        linea: t("compraQrVencioCerrada"),
        datos: [dinero],
        donde,
        enlace: enlace("pague-igual", "compraPagueIgual"),
      });
    case "en-camino":
      return pantallaEnCamino(s, c, p.faltan, donde, numero);
    case "antes-de-aprobar":
      return pantalla("antes", p.pasos === 1 ? t("compraAntesTitulo1") : t("compraAntesTitulo", { n: String(p.pasos) }), boton("ver-primer-paso", "cargaVerPrimerPaso"), {
        linea: p.pasos === 1 ? t("compraAntesLinea1") : t("compraAntesLinea", { n: String(p.pasos) }),
        datos: [dinero],
        donde,
      });
    case "aprobar":
      return pantallaDeAprobar(s, p.paso.que, p.despues, donde, numero);
    case "llego":
      return pantallaDeLlegada(s);
    case "frenada": {
      const linea = p.quien === "vos" ? "compraFrenadaVos" : p.quien === "pollar" ? "compraFrenadaPollar" : "compraFrenadaTinkazo";
      // Con el dinero en el medio, escribirnos está a la vista, no plegado.
      return pantalla("frenada", t("compraFrenadaTitulo"), p.quien === "vos" ? boton("reintentar-carga", "clProbarDeNuevo") : VOLVER_A_MIRAR(), {
        linea: t(linea),
        datos: numero ? [dinero, t("compraDatoNumero", { orden: numero })] : [dinero],
        donde,
        numero,
        enlace: enlace("escribir", "compraEscribinos"),
      });
    }
    case "proteger-cuenta":
      return proteger(s, donde);
    case "no-se-pudo":
      return pantallaDeFallo(s, donde, numero, etapasDeCarga(c.orden)?.[0] === "listo");
    case "desconocido":
      // Además de escribirnos, Volver a mirar: si la orden sigue y se completa, la persona lo ve sin cerrar la ventana.
      return pantalla("desconocido", t("compraDesconocidoTitulo"), ESCRIBIR(), {
        linea: t("compraDesconocidoLinea"),
        datos: conNumero(dinero, numero),
        donde,
        numero,
        enlace: enlace("mirar", "saldoVolverAMirar"),
      });
  }
}

/**
 * Dónde está el dinero, dicho para la pantalla. En la cuenta de paso, «esperando que confirmes» vale solo donde hay algo
 * que confirmar: con el cambio trabajando dice que se pasa a dólares, con el envío en curso que va camino a tu cuenta, y
 * frenado o mientras se protege la cuenta, que está a salvo.
 */
function dondeEnPantalla(donde: string, p: ReturnType<typeof pasoDeOrden>, orden: unknown): string {
  if (donde !== "compraDondePaso" || p.pantalla === "antes-de-aprobar" || p.pantalla === "aprobar") return donde;
  if (p.pantalla === "en-camino") return etapasDeCarga(orden)?.[1] === "listo" ? "compraDondeViaje" : "compraDondeCambiando";
  return "compraDondeGuardado";
}

/** Los bolivianos del QR de la orden, tal como los dice la orden, o `null`. */
function montoDelQr(orden: unknown): string | null {
  const o = leerOrden(orden);
  const i = o?.accion?.kind === "FIAT_PAYMENT" ? (o.accion.instructions as Record<string, unknown> | undefined) : undefined;
  return i && typeof i.amount === "string" && /^\d+(\.\d+)?$/.test(i.amount.trim()) ? i.amount.trim() : null;
}

/** La orden sigue esperando el pago por QR y el QR no venció: recién ahí se ofrece Todavía no pagué. */
function esperaElPagoConQrVigente(orden: unknown, ahora: number): boolean {
  const o = leerOrden(orden);
  if (!o || (o.estado !== "created" && o.estado !== "awaiting_payment") || o.accion?.kind !== "FIAT_PAYMENT") return false;
  const vence = typeof o.accion.expiresAt === "string" ? Date.parse(o.accion.expiresAt) : Number.NaN;
  return Number.isFinite(vence) && vence > ahora;
}

function pantallaEnCamino(s: LoQueSeSabe, c: CargaEnLaVentana, faltan: number, donde: string, numero: string | null): PantallaDeCompra {
  const tiempo = tiempoQueFalta(c.orden, s.ahora);
  const tarda = !!tiempo && "tardaMas" in tiempo;
  const linea = !tiempo ? null : "tardaMas" in tiempo ? t("compraTardaMas") : tiempo.minutos > 1 ? t("cargaFaltan", { m: String(tiempo.minutos) }) : t("compraFaltaPoco");
  // Nunca sigue sola: si no quedan aprobaciones, igual falta el toque de terminar.
  const siCerras = faltan > 1 ? t("compraDatoSiCerras", { n: String(faltan) }) : faltan === 1 ? t("compraDatoSiCerras1") : t("compraDatoSiCerrasPagar");
  const [pago, cambio, llegada] = etapasDeCarga(c.orden) ?? ["despues", "despues", "despues"];
  // Si tarda más de lo normal, el número y Escribir a Tinkazo a la vista: la persona no se queda sin salida.
  return pantalla("camino", t("cargaEnCaminoTitulo"), boton("esperar", "saldoVolverAMirar", { ocupado: true }), {
    linea,
    datos: tarda ? [...conNumero(tuDinero(s.idioma, donde), numero), siCerras] : [tuDinero(s.idioma, donde), siCerras],
    numero: tarda ? numero : null,
    enlace: tarda ? AYUDA() : null,
    donde,
    etapas: [
      { clave: "cargaEtapa1", palabra: pago },
      { clave: "compraEtapa2", palabra: cambio },
      { clave: "cargaEtapa3", palabra: llegada },
      { clave: "compraEtapa4", palabra: "despues" },
    ],
  });
}

/** La línea de cada confirmación: qué se confirma, en palabras de todos los días. Las cuatro se ven distintas. */
const LINEA_DE_CONFIRMAR: Record<QueSeAprueba, string> = {
  "permiso-cambio": "compraConfirmaPermisoCambio",
  cambio: "compraConfirmaCambio",
  "permiso-envio": "compraConfirmaPermisoEnvio",
  envio: "compraConfirmaEnvio",
};

const QUE_SE_APRUEBA: Record<QueSeAprueba, [string, string | null]> = {
  "permiso-cambio": ["cargaAprobarPermiso", "cargaAprobarPermisoSinN"],
  cambio: ["cargaAprobarCambio", null],
  "permiso-envio": ["cargaAprobarPermisoEnvio", "cargaAprobarPermisoEnvioSinN"],
  envio: ["cargaAprobarEnvio", null],
};

function queSeApruebaEnTexto(s: LoQueSeSabe, que: QueSeAprueba): Texto {
  const r = s.aprobacion?.revisado;
  const dolares = r && "que" in r && r.que === que ? r.dolares : null;
  const [conN, sinN] = QUE_SE_APRUEBA[que];
  if (!sinN) return t(conN);
  const n = dolares === null ? null : stroopsDeNumero(dolares);
  return n === null ? t(sinN) : t(conN, { n: alCentavo(n, s.idioma, true) });
}

function pantallaDeAprobar(s: LoQueSeSabe, que: QueSeAprueba, despues: number, donde: string, numero: string | null): PantallaDeCompra {
  const dinero = tuDinero(s.idioma, donde);
  const r = s.aprobacion?.revisado;
  if (r && "motivo" in r) {
    return pantalla("raro", t("compraRaroTitulo"), ESCRIBIR(), { linea: t("compraRaroLinea"), datos: numero ? [dinero, t("compraDatoNumero", { orden: numero })] : [dinero], donde, numero });
  }
  const total = s.aprobacionesTotales ?? null;
  const n = total === null ? null : total - despues;
  const titulo = total !== null && n !== null && n >= 1 && n <= total ? t("compraAprobarTitulo", { n: String(n), total: String(total) }) : t("compraAprobarTituloSinN");
  const plegado = [queSeApruebaEnTexto(s, que), t("compraAprobarTarde")];
  const aprobar = s.aprobacion?.enCurso ? boton("aprobar", "cargaAprobando", { ocupado: true }) : s.aprobacion?.fallo ? boton("aprobar", "clProbarDeNuevo") : boton("aprobar", "cargaAprobarBtn");
  return pantalla(s.aprobacion?.fallo ? "aprobar-no-salio" : "aprobar", titulo, aprobar, {
    linea: t(s.aprobacion?.fallo ? "compraAprobarNoSalio" : LINEA_DE_CONFIRMAR[que]),
    datos: [dinero],
    donde,
    plegado,
  });
}

/* ------------------------------------------------------------------ llegó: terminar, o llegó de menos */

/**
 * La carga terminó: si el saldo leído llega a lo que queda por pagar (el total de la compra menos lo que el servidor ya
 * recibió de la orden), Terminar mi compra por eso; si con lo recibido llega al mínimo que el servidor da por pagado,
 * por el saldo; si no, falta. Sin el saldo, o sin el mínimo cuando el saldo no llega, primero se lee: nunca se ofrece
 * terminar sin saber que alcanza.
 */
function pantallaDeLlegada(s: LoQueSeSabe): PantallaDeCompra {
  const cuenta = "compraDondeCuenta";
  if (s.saldo === null) return espera(s, "saldo", cuenta);
  // Sin el permiso ni el cobro leídos, no se sabe el total: primero se lee. Que no se vende lo dice un permiso sin total.
  if (!s.permiso && !s.cobro) return espera(s, "permiso", cuenta);
  const total = stroops(s.cobro?.total ?? s.permiso?.total ?? null);
  if (total === null) return noVende(s, true);
  // Lo que el servidor ya recibió de esta orden no se vuelve a pedir.
  const recibido = stroops(s.cobro?.recibido) ?? 0n;
  const queda = total > recibido ? total - recibido : 0n;
  // Ya recibió todo: falta que el servidor lo diga.
  if (queda === 0n) return espera(s, "cobro", cuenta);
  const saldo = stroops(s.saldo) ?? 0n;
  if (saldo >= queda) return llego(s, queda);
  if (!s.cobro) return espera(s, "cobro", cuenta);
  const minimo = stroops(s.cobro.minimo);
  if (minimo !== null && saldo + recibido >= minimo) return llego(s, saldo);
  const visible = alCentavo(queda - saldo, s.idioma, true);
  return pantalla("menos", t("compraMenosTitulo"), boton("cargar-falta", "compraCargarFalta"), {
    linea: visible === "1" ? t("compraMenosLinea1") : t("compraMenosLinea", { falta: visible }),
    datos: [tuDinero(s.idioma, cuenta)],
    donde: cuenta,
    enlace: OTRA_APP(),
  });
}

function llego(s: LoQueSeSabe, seUsan: bigint): PantallaDeCompra {
  const cuenta = "compraDondeCuenta";
  return pantalla("llego", t("compraLlegoTitulo"), boton("pagar-paquete", "compraTerminar"), {
    linea: t("compraLlegoLinea"),
    datos: [datoEnDolares("compraDatoSeUsan", alCentavo(seUsan, s.idioma)), t("compraDatoPaquete", { sorteos: varsDelProducto(s.producto, s.idioma).sorteos }), tuDinero(s.idioma, cuenta)],
    donde: cuenta,
    plegado: [t("compraLlegoMas")],
    // Lo que se usa es lo que se paga: con el saldo entre el mínimo y el total, el saldo entero, no el monto de la orden.
    pagar: usdcDe(seUsan),
  });
}

/* ------------------------------------------------------------------ el pago del paquete */

function pantallaDelPago(s: LoQueSeSabe, pago: PagoDelPaquete): PantallaDeCompra {
  const L = s.idioma;
  const tinkazo = "compraDondeTinkazo";
  const cuenta = "compraDondeCuenta";
  const conQr = !!s.carga || !!s.permiso?.cargada;
  const titulo = t(conQr ? "compraLlegoTitulo" : "compraSaldoTitulo");
  const numero = numeroDeLaCompra(s);
  switch (pago.fase) {
    case "pagando":
      return pantalla("pagando", t("compraPagandoTitulo"), boton("esperar", "compraPagando", { ocupado: true }), { linea: t("compraPagandoLinea"), datos: [tuDinero(L, tinkazo)], donde: tinkazo });
    // No se sabe si salió, o salió y no se ve: el número y Escribir a Tinkazo, por si no se mueve.
    case "no-se-sabe":
      return pantalla("pago-no-se-sabe", t("compraPagandoTitulo"), boton("mirar-pago", "saldoVolverAMirar"), { linea: t("compraPagoNoSeSabe"), datos: conNumero(tuDinero(L, tinkazo), numero), donde: tinkazo, numero, enlace: AYUDA() });
    case "sin-ver":
      return pantalla("pago-sin-ver", t("compraPagandoTitulo"), boton("mirar-pago", "saldoVolverAMirar"), { linea: t("compraPagoSinVer"), datos: conNumero(tuDinero(L, tinkazo), numero), donde: tinkazo, numero, enlace: AYUDA() });
    case "listo": {
      const quedan = pago.quedan === null ? t("pagoListo") : pago.quedan === 1 ? t("pagoListoQueda1") : t("pagoListoQuedan", { n: String(pago.quedan) });
      const saldo = stroops(pago.saldo) ?? 0n;
      // El primer paquete termina llevando a armar el primer sorteo. El de diez, con Listo: ya sabe sortear.
      return pantalla("listo", t("compraListoTitulo"), s.producto.id === "alta" ? boton("sortear", "compraArmarSorteo") : boton("cerrar", "cargaListo"), {
        linea: quedan,
        datos: saldo >= CENTAVO ? [datoEnDolares("compraDatoSaldo", alCentavo(saldo, L))] : [],
      });
    }
    case "no-salio": {
      // Probar de nuevo paga lo mismo que la pantalla de antes del pago.
      const pagar = pantallaBase({ ...s, pago: null, pagoEnviado: false }).pagar;
      return pantalla("pago-no-salio", titulo, boton("pagar-paquete", "clProbarDeNuevo"), { linea: t("compraPagoNoSalio"), datos: [tuDinero(L, cuenta)], donde: cuenta, pagar });
    }
    case "sin-patrocinio":
      // La ayuda plegada pide el número de compra: va a la vista.
      return pantalla("pago-sin-patrocinio", titulo, VOLVER_A_MIRAR(), { linea: t("compraPagoSinPatrocinio"), datos: conNumero(tuDinero(L, cuenta), numero), donde: cuenta, numero, plegado: [t("compraAyuda")] });
    case "raro":
      return pantalla("pago-raro", t("compraPagoRaroTitulo"), ESCRIBIR(), {
        linea: t("compraPagoRaro"),
        datos: numero ? [tuDinero(L, cuenta), t("compraDatoNumero", { orden: numero })] : [tuDinero(L, cuenta)],
        donde: cuenta,
        numero,
      });
    case "sin-saldo":
      // El saldo leído ya no vale: se dice que no alcanzó y se vuelve a leer. Nunca otro Terminar mi compra con el mismo
      // saldo. Al leerlo, el motor deja `pago` vacío y la pantalla sale del saldo nuevo.
      return { ...espera(s, "saldo", cuenta), linea: t("compraPagoNoAlcanzo") };
    case "no-vende":
      return noVende(s, conQr);
    case "sin-cuenta":
      return proteger(s, conQr ? cuenta : null);
  }
}

/* ------------------------------------------------------------------ las fallas finales de la carga */

function pantallaDeFallo(s: LoQueSeSabe, donde: string, numero: string | null, pagoVisto: boolean): PantallaDeCompra {
  const dinero = tuDinero(s.idioma, donde);
  // La compra sigue en curso con su recargo (anularla suelta la reserva y no el recargo): se dice que no se cobra dos veces.
  const plegado = s.recargoPendiente ? [t("compraRecargoPendiente")] : [];
  if (donde === "compraDondeNada") return pantalla("fallo", t("compraFalloTitulo"), boton("empezar-de-nuevo", "compraOtraVez"), { linea: t("compraFalloSinPago"), datos: [dinero], donde, plegado });
  if (donde === "compraDondeDevuelto") return pantalla("fallo", t("compraFalloTitulo"), boton("empezar-de-nuevo", "compraOtraVez"), { linea: t("cargaDevueltaSinMonto"), datos: [dinero], donde, plegado });
  const datos = numero ? [dinero, t("compraDatoNumero", { orden: numero })] : [dinero];
  // El pago se vio y la compra se frenó después: ayuda con el número, y nunca que no lo vemos ni otro QR.
  if (pagoVisto) return pantalla("fallo", t("compraFalloTitulo"), ESCRIBIR(), { linea: t("compraFalloConPago"), datos, donde, numero });
  // No se ve el pago: ayuda, y un QR nuevo solo si la persona dice que no pagó (la regla de la carga).
  return pantalla("fallo", t("compraFalloTitulo"), ESCRIBIR(), {
    linea: t("compraFalloSinVerPago"),
    datos,
    donde,
    numero,
    enlace: enlace("pedir-qr-nuevo", "compraNoPague"),
  });
}

/* ================================================================== las cajas de Dejá tu cuenta lista */

export interface CajaDeCompra {
  /** oferta es la caja de hoy; app, el panel de pagar desde otra app. */
  id: "oferta" | "activar-para-comprar" | "sin-qr" | "app" | "paquete";
  titulo: Texto | null;
  linea: Texto | null;
  principal: BotonDeCompra | null;
  enlace: BotonDeCompra | null;
  plegado: Texto[];
  /** Datos con su rótulo, a la vista: en activar para comprar, lo que suma pagar con QR. */
  datos: Texto[];
}

/**
 * La caja 1 (Activar tu cuenta) en modo compra, después de tocar el primer paquete: con el permiso de empezar, activar-para-comprar;
 * sin lugar hoy, Ahora no hay pago con QR; con el medio de otra app, el panel de hoy. Sin nada de eso, la caja de hoy.
 */
export function cajaDeActivar(e: { medio: MedioDeCompra; cambio: boolean; permiso: PermisoDeCompra | null; sinLugar?: boolean; idioma?: "es" | "en" }): CajaDeCompra {
  const nada = { titulo: null, linea: null, principal: null, enlace: null, plegado: [], datos: [] };
  if (e.medio === "app") return { ...nada, id: "app" };
  if (e.sinLugar) return { ...nada, id: "sin-qr", titulo: t("compraSinQrTitulo"), linea: t("compraSinQrLinea"), principal: VOLVER_A_MIRAR(), enlace: e.cambio ? OTRA_APP() : null };
  if (e.permiso) {
    return {
      id: "activar-para-comprar",
      titulo: null,
      linea: t("compraCuentaLinea"),
      principal: boton("activar", "clActivarBoton"),
      enlace: e.cambio ? enlace("otra-app", "compraNoEstoy") : null,
      plegado: [t("compraCuentaMas")],
      // Antes del primer toque que cuesta algo, lo que suma pagar con QR, con el número del servidor.
      datos: [datoDelRecargo(e.permiso, e.idioma ?? "es")].filter((x): x is Texto => x !== null),
    };
  }
  return { ...nada, id: "oferta" };
}

/**
 * La caja 3, Tu primer paquete: se ve con el permiso de terminar y sin acceso. Dice dónde quedó la compra, en este orden:
 * la verificación rechazada o en revisión, una carga que espera una aprobación, una carga en camino, la carga terminada
 * con el saldo que alcanza, y si no, que la compra espera donde quedó. La principal abre la ventana en la pantalla que
 * toca; la primera vez, antes de empezar nada, dice Seguir con el pago.
 */
export function cajaDelPaquete(e: {
  carga: CargaEnLaVentana | null;
  saldo: string | null;
  /** El total de la compra con QR (el permiso del servidor). */
  total: string | null;
  verificacion?: "rechazada" | "en-revision" | null;
  /** La compra ya empezó alguna vez (verificación, precio o carga). */
  empezada: boolean;
  ahora: number;
}): CajaDeCompra {
  const caja = (linea: string): CajaDeCompra => ({
    id: "paquete",
    titulo: t("compraCajaTitulo"),
    linea: t(linea),
    principal: boton("seguir-compra", !e.carga && !e.empezada ? "compraSeguirPago" : "compraSeguirBoton"),
    enlace: null,
    plegado: [],
    datos: [],
  });
  if (e.verificacion === "rechazada") return caja("compraRechazoAviso");
  if (e.verificacion === "en-revision") return caja("compraRevisionAviso");
  if (e.carga && cargaAbierta(e.carga)) {
    const p = pasoDeOrden(e.carga.orden, e.carga.marcas, e.ahora, e.carga.vista ?? {});
    if (p.pantalla === "aprobar" || p.pantalla === "antes-de-aprobar") return caja("compraEsperaAprobar");
    if (p.pantalla === "pagar" || p.pantalla === "ya-pagaste" || p.pantalla === "qr-falta") return caja("compraTeEspera");
    return caja("compraSigueLinea");
  }
  if (e.total !== null && alcanza(e.saldo, e.total)) return caja("compraLlegoAviso");
  return caja("compraTeEspera");
}
