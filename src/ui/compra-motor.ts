import type { RequirementForm, RequirementFormAnswers } from "@pollar/core";
import { TEXTOS_COMPRA } from "../compra-textos";
import type { CompraQrDelEstado, EstadoDeAlta, OrdenAbierta, OrdenDePago, PagoDeOrden, PermisoDelServidor, ResultadoDeAlta, ResultadoDeCompra } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { type CotizacionHecha, cotizacionParaElObjetivo, objetivoDeLaCarga } from "../stellar/compra-monto";
import type { ResultadoDelPagoConSaldo } from "../stellar/pago-con-saldo";
import { type LecturaDeCotizacion, type PasoDeVerificacion, type PrecioDeCarga, type RutaDeBolivia, SIN_MARCAS, leerMarcas, leerOrden, pasoDeOrden } from "../stellar/rampa-pollar";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import type { pollarWallet } from "../stellar/wallet-pollar";
import { type AccionDeCompra, type CargaEnLaVentana, type LoQueSeSabe, type MedioDeCompra, type PantallaDeCompra, type PermisoDeCompra, pantallaDeCompra } from "./compra-qr-estado";
import type { AvisoDelMotor, CampoDeDatos, DetalleDePantalla, MotorDeCompra } from "./compra-qr";

/**
 * El motor de verdad de la ventana Tu compra (`compra-qr.ts`): las mismas acciones que atiende la demo, resueltas con la
 * carga de Pollar (la billetera, `carga*`), el portero (`/v1/compra/*` y `/v1/alta/*`) y el saldo leído en la red. La
 * máquina de pantallas (`compra-qr-estado.ts`) no cambia: el motor le da lo que se sabe y ella dice qué se ve.
 *
 * Lo que cuida, y lo fija `compra-motor.test.ts`:
 * - `mirar` solo lee: el saldo, la carga abierta (y la última cerrada que no terminó bien), el estado de la compra, la
 *   cotización, la orden de carga, la orden del paquete y su pago. Lo único que escribe es el permiso de empezar, que el
 *   servidor da una vez por compra y devuelve igual si se pide de nuevo: la ventana se abrió con un toque.
 * - Ninguna aprobación, ningún pago y ninguna orden de carga salen sin el toque que los pide.
 * - Un solo pago del paquete con el saldo a la vez (`pagarElPaquete`): con un pago que quizás salió (la marca de la
 *   orden) no se arma otro, antes de pagar se le pregunta al servidor cómo está la orden, y se paga exactamente lo que
 *   dice la pantalla con eso. Si el servidor dice otra cosa que lo que se mostró, no se paga: la pantalla se pinta de
 *   nuevo y pide otro toque. Un envío con resultado incierto nunca se repite.
 * - Después de anular, la compra sigue en curso con su recargo (el servidor suelta solo la reserva): el permiso queda
 *   cargado y el recargo pendiente se dice.
 * - Nada de la cuenta de la persona va al registro.
 */

/* ================================================================== lo que usa */

/** Lo que el motor usa de la billetera de Google o de correo. `pollarWallet` lo cumple. */
export type BilleteraDeLaCompra = Pick<
  typeof pollarWallet,
  | "cargaAbiertas"
  | "cargaCerradas"
  | "cargaRuta"
  | "cargaCotizar"
  | "cargaAbrirVerificacion"
  | "cargaMirarVerificacion"
  | "cargaLeerFormulario"
  | "cargaGuardarFormulario"
  | "cargaLeerSegip"
  | "cargaConfirmarSegip"
  | "cargaLeerAlta"
  | "cargaDarDeAlta"
  | "cargaPreparar"
  | "cargaCrearOrdenDeCompra"
  | "cargaLeerOrden"
  | "cargaYaPague"
  | "cargaRevisarPaso"
  | "cargaAprobar"
  | "cargaReintentar"
  | "pagarOrden"
>;

/** Lo que el motor le pide al portero, con la sesión ya puesta (`alta-api.ts`). */
export interface PorteroDeLaCompra {
  estado(): Promise<ResultadoDeAlta<EstadoDeAlta>>;
  empezar(producto: string): Promise<ResultadoDeCompra<PermisoDelServidor>>;
  cargar(producto: string, reemplazar?: boolean): Promise<ResultadoDeCompra<PermisoDelServidor>>;
  anular(producto: string): Promise<ResultadoDeCompra<{ anulada: true; repetido: boolean }>>;
  orden(producto: string): Promise<ResultadoDeAlta<OrdenDePago>>;
  pago(id: string): Promise<ResultadoDeAlta<PagoDeOrden>>;
}

type Almacen = Pick<Storage, "getItem" | "setItem">;

export interface OpcionesDelMotor {
  billetera: BilleteraDeLaCompra;
  portero: PorteroDeLaCompra;
  /** El saldo de dólares digitales de la cuenta de la sesión, leído en la red. */
  saldo(): Promise<SaldoDeDolares>;
  /** La cuenta de la sesión, para decir que el dinero está en tu cuenta solo cuando es la suya. */
  cuenta(): string | null;
  /** El paquete que se compra. */
  producto: ProductoALaVenta;
  /** Los demás que se venden: si el servidor dice que hay otra compra en curso, la ventana sigue esa. */
  otros?: readonly ProductoALaVenta[];
  /** El permiso que ya se conoce (`compraQr.abierta` del estado). */
  permiso?: PermisoDeCompra | null;
  medio?: MedioDeCompra;
  cambio?: boolean;
  aparato?: LoQueSeSabe["aparato"];
  idioma?: () => "es" | "en";
  reloj?: () => number;
  /** Dónde viven las marcas de las órdenes de carga y las cargas cerradas que ya se mostraron. */
  almacen?: Almacen | null;
  /** La marca del pago con el saldo de una orden (`leerMarcaDelPago` de la billetera), en segundos Unix. */
  marcaDelPago(nota: string): number | null;
  /** Recordar el medio que eligió la persona con un toque (`medio-de-pago.ts`). */
  recordarMedio?(m: MedioDeCompra): void;
  /** El registro de la compra (`VITE_RAMPA_REGISTRO`). Nunca recibe una cuenta. */
  registrar?(evento: string, datos?: Record<string, string | number | boolean | null>): void;
  /** Esperar, en las pruebas a mano. */
  esperar?(ms: number): Promise<void>;
  /** El candado entre pestañas del pago del paquete (Web Locks por defecto). */
  candado?<T>(f: () => Promise<T>): Promise<T>;
  ritmoMs?: number;
}

/* ================================================================== constantes */

const DIA_MS = 24 * 3_600_000;
/** Cuánto atrás se busca la última carga cerrada que no terminó bien: una devolución puede tardar. */
export const CERRADAS_DESDE_MS = 7 * DIA_MS;
/** Las cargas cerradas que ya se mostraron en este navegador (por id), para no mostrarlas otra vez. */
export const CLAVE_DE_CERRADAS_VISTAS = "tinkazo.carga.cerradas-vistas";
const CERRADAS_QUE_SE_RECUERDAN = 20;
/** Después de un pago que salió, cuántas veces y cada cuánto se le pregunta al servidor si lo vio. */
export const VECES_QUE_SE_MIRA_EL_PAGO = 6;
export const CADA_CUANTO_SE_MIRA_MS = 5_000;
/** Lo más que se espera para volver a avisar la carga cuando el servidor dice que otro aviso está en curso. */
export const ESPERA_DEL_AVISO_MAX_MS = 3 * 60_000 + 5_000;
export const CANDADO_DEL_PAQUETE = "tinkazo-pagar-paquete";
/**
 * Los pagos del paquete con el saldo que salieron (la billetera dio su número) y el servidor todavía no dio por pagados,
 * por la nota de su orden. Sin la cuenta ni el monto. Un pago que salió nunca se da por perdido: al volver, aunque su
 * marca haya vencido, se ve como enviado y no se ofrece pagar de nuevo hasta que el servidor lo reconozca.
 */
export const CLAVE_DE_PAGOS_QUE_SALIERON = "tinkazo.compra.pagos-que-salieron";
const PAGOS_QUE_SE_RECUERDAN = 20;
/** Cuántas lecturas seguidas hace una sola mirada de la espera (el saldo, el permiso, la cotización, la orden). */
const LECTURAS_POR_ESPERA = 4;

/** Lo que la orden del paquete contesta cuando el paquete no se vende ahora, también a una cuenta fuera del piloto. */
const ORDEN_QUE_NO_SE_VENDE: ReadonlySet<string> = new Set(["pago-apagado", "producto", "venta-pausada", "altas-pausadas", "fuera-del-piloto"]);

/** Lo que el servidor dice que no se puede hoy: sin QR, con el otro camino a un toque. */
const SIN_QR_HOY: ReadonlySet<string> = new Set(["tope-del-dia", "sin-lugar", "compras-cerradas", "fuera-del-piloto", "fondeo-diferido", "ya-tiene-acceso", "producto", "apagado"]);

/* ================================================================== piezas */

const conCandadoDelNavegador = <T>(f: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator !== "undefined" ? (navigator as { locks?: LockManager }).locks : undefined;
  if (!locks || typeof locks.request !== "function") return f();
  return locks.request(CANDADO_DEL_PAQUETE, f) as Promise<T>;
};

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function almacenDelNavegador(): Almacen | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Un permiso del servidor en la máquina (la misma forma). */
const permisoDe = (p: PermisoDelServidor): PermisoDeCompra => ({ producto: p.producto, desde: p.desde, recargo: p.recargo, total: p.total, primera: p.primera, cargada: p.cargada });

/** La sesión cerrada se dice con su pantalla; todo lo demás que no sea un sí es de la red o del servicio. */
const esDeSesion = (e: { ok: false; clave: string; motivo: string }): boolean => e.clave === "clErrSesion" || e.motivo === "sesion" || e.motivo === "sin-token";

class SinRed extends Error {
  constructor() {
    super("sin-red");
  }
}

/** El paso de verificación que espera la cotización, si es el primero de lo que falta. */
function pasoDe(s: LoQueSeSabe): PasoDeVerificacion | null {
  const c = s.cotizacion;
  const f = c?.estado === "falta" ? c.falta[0] : undefined;
  return f?.que === "verificacion" ? f.paso : null;
}

/* ================================================================== el motor */

export class CompraDeVerdad implements MotorDeCompra {
  readonly ritmoMs: number;
  private readonly o: OpcionesDelMotor;
  private producto: ProductoALaVenta;
  private readonly reloj: () => number;
  private readonly esperar: (ms: number) => Promise<void>;
  /** Ya se leyó lo de al abrir: la carga abierta, la cerrada, el estado y el saldo. */
  private abierto = false;
  private ruta: RutaDeBolivia | null = null;
  private minimoBs = 0;
  /** El recargo que va en toda orden de la persona mientras su compra cargada siga sin pagar. */
  private recargoPendiente: string | null = null;
  /** Lo que se leyó para el paso de verificación de ahora (el formulario y el SEGIP). */
  private formulario: { opcion: string; form: RequirementForm } | null = null;
  private segip: { opcion: string; prefill: { givenNames: string; surname1: string; surname2?: string; birthdate: string; documentNumber: string; complementNumber?: string } } | null = null;
  /** El paso de aprobar que ya se revisó (su pedido), para no revisarlo dos veces. */
  private revisadoPara: string | null = null;
  /** La próxima verificación empieza otra (Empezar de nuevo). */
  private verificacionDeNuevo = false;
  /** Lo que llevaba el último Ver el QR (los datos que pide la cotización), para No pagué la orden de otra app. */
  private entradaDelQr: Readonly<Record<string, string>> = {};
  /** Un pago del paquete con el saldo en curso en esta ventana. */
  private pagando = false;
  /** Las notas de los pagos que salieron en esta ventana, por si el navegador no deja guardarlas. */
  private readonly salidos = new Set<string>();
  private cerrada = false;

  constructor(o: OpcionesDelMotor) {
    this.o = o;
    this.producto = o.producto;
    this.reloj = o.reloj ?? (() => Date.now());
    this.esperar = o.esperar ?? pausa;
    this.ritmoMs = o.ritmoMs ?? 10_000;
  }

  private get almacen(): Almacen | null {
    return this.o.almacen === undefined ? almacenDelNavegador() : this.o.almacen;
  }

  private registrar(evento: string, datos?: Record<string, string | number | boolean | null>): void {
    try {
      this.o.registrar?.(evento, datos);
    } catch {
      /* el registro nunca corta la compra */
    }
  }

  private vista(extra: Partial<NonNullable<CargaEnLaVentana["vista"]>> = {}): NonNullable<CargaEnLaVentana["vista"]> {
    const cuenta = (() => {
      try {
        return this.o.cuenta();
      } catch {
        return null;
      }
    })();
    return { ...(cuenta ? { cuenta } : {}), ...extra };
  }

  private cargaDe(orden: unknown, extra: Partial<NonNullable<CargaEnLaVentana["vista"]>> = {}): CargaEnLaVentana {
    const o = leerOrden(orden);
    const id = o?.id ?? (typeof orden === "object" && orden !== null && typeof (orden as { id?: unknown }).id === "string" ? (orden as { id: string }).id : "");
    return { orden, marcas: id ? leerMarcas(id, this.almacen) : SIN_MARCAS, vista: this.vista(extra) };
  }

  /* ------------------------------------------------------------------ al abrir */

  inicio(): LoQueSeSabe {
    const o = this.o;
    return {
      idioma: o.idioma?.() ?? "es",
      ahora: this.reloj(),
      aparato: o.aparato ?? "compu",
      medio: o.medio ?? "qr",
      cambio: o.cambio ?? true,
      producto: this.producto,
      permiso: o.permiso ?? null,
      saldo: null,
      cotizacion: null,
      carga: null,
    };
  }

  cerrar(): void {
    this.cerrada = true;
  }

  /** Lo que se lee una vez al abrir (y otra vez con Probar de nuevo): lo que puede esconder una compra en curso va primero. */
  private async abrir(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const b = this.o.billetera;
    let r = s;
    // 1. La carga abierta, antes que nada: que nada la esconda.
    const abiertas = await b.cargaAbiertas();
    if (abiertas.estado === "abierta") {
      const orden = abiertas.orden ?? (await this.leerOrdenDe(abiertas.id));
      r = { ...r, carga: this.cargaDe(orden) };
    } else if (abiertas.estado === "ninguna") {
      // 2. Sin una abierta, la última cerrada que no terminó bien y que todavía no se mostró: su final, con el número.
      const cerradas = await b.cargaCerradas(this.reloj() - CERRADAS_DESDE_MS);
      if (cerradas.estado === "cerrada" && !this.cerradasVistas().includes(cerradas.id)) r = { ...r, carga: this.cargaDe(cerradas.orden) };
    } else if (abiertas.estado === "sin-cuenta") return { ...r, sesionVencida: true };
    else if (abiertas.estado === "sin-creditos") r = { ...r, cotizacion: { estado: "sin-creditos" } };
    else if (abiertas.estado === "proteger-cuenta") r = { ...r, cotizacion: { estado: "falta", falta: [{ que: "proteger-cuenta" }] } };
    // Lo que no se sabe no dice que no hay ninguna: no se sigue sin saberlo.
    else if (abiertas.estado !== "apagada") throw new SinRed();
    // 3. El estado de la compra: lo mínimo en bolivianos, el recargo pendiente y la compra en curso.
    const e = await this.o.portero.estado();
    if (!e.ok && esDeSesion(e)) return { ...r, sesionVencida: true };
    if (e.ok && e.datos.compraQr) r = this.conCompraQr(r, e.datos.compraQr);
    // La orden del paquete que trae el estado, si este navegador mandó un pago con el saldo para ella: ese pago se mira
    // al volver aunque la compra no esté cargada (Pagar con mi saldo) o la orden no se pueda leer entera.
    const conPago = e.ok ? this.ordenConPago(e.datos.orden) : null;
    // 4. El saldo.
    r = await this.conSaldo(r);
    // 5. Con la compra ya cargada o con un pago marcado, la orden del paquete y su pago: un pago con el saldo que quizás
    // salió se ve al volver.
    if (r.permiso?.cargada || conPago) r = await this.conElPaquete(r, conPago);
    this.abierto = true;
    this.registrar("abrir", { carga: r.carga ? "si" : "no", cargada: !!r.permiso?.cargada, producto: this.producto.id });
    return r;
  }

  private conCompraQr(s: LoQueSeSabe, c: CompraQrDelEstado): LoQueSeSabe {
    this.minimoBs = c.minimoBs;
    this.recargoPendiente = c.recargoPendiente;
    let r: LoQueSeSabe = { ...s, minimoBs: c.minimoBs, recargoPendiente: c.recargoPendiente };
    if (c.abierta) {
      // Una compra en curso de otro paquete: la ventana sigue esa, si se vende.
      const otro = c.abierta.producto !== this.producto.id ? (this.o.otros ?? []).find((p) => p.id === c.abierta?.producto) : null;
      if (otro) {
        this.producto = otro;
        r = { ...r, producto: otro };
      }
      if (c.abierta.producto === this.producto.id) r = { ...r, permiso: permisoDe(c.abierta) };
    }
    return r;
  }

  private async conSaldo(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const x = await this.o.saldo();
    if (x.tipo === "saldo") return { ...s, saldo: x.saldo };
    // Sin la línea o sin la cuenta en la red, no hay nada: preparar la cuenta lo dice la cotización.
    if (x.tipo === "sin-linea" || x.tipo === "sin-cuenta") return { ...s, saldo: "0.0000000" };
    throw new SinRed();
  }

  /** La orden abierta del estado, si es de este paquete y este navegador mandó un pago con el saldo para ella. */
  private ordenConPago(o: OrdenAbierta | null): OrdenAbierta | null {
    return o && o.producto === this.producto.id && (this.marca(o.nota) !== null || this.salio(o.nota)) ? o : null;
  }

  /**
   * La orden del paquete y lo que el servidor dice de su pago. Con una marca de pago, ese pago se ve como enviado.
   * `delEstado`: la orden del estado con un pago marcado. Si la orden no se puede pedir, ese pago se ve como enviado
   * igual. Sin esa marca y sin la carga a la vista, sin la orden no se sabe qué falta pagar: no se sigue a un precio.
   */
  private async conElPaquete(s: LoQueSeSabe, delEstado: OrdenAbierta | null = null): Promise<LoQueSeSabe> {
    const ord = await this.o.portero.orden(this.producto.id);
    if (!ord.ok) {
      if (esDeSesion(ord)) return { ...s, sesionVencida: true };
      this.registrar("orden-del-paquete", { motivo: ord.motivo });
      if (delEstado) return { ...s, pagoEnviado: true, ...(this.salio(delEstado.nota) ? { pago: { fase: "sin-ver" as const } } : {}) };
      // Con la carga a la vista, la pantalla sale de ella: Terminar mi compra vuelve a pedir la orden.
      if (s.carga) return s;
      if (ORDEN_QUE_NO_SE_VENDE.has(ord.motivo)) return { ...s, pago: { fase: "no-vende" } };
      if (ord.motivo === "compra-en-curso") return { ...s, pago: { fase: "raro" } };
      throw new SinRed();
    }
    let r: LoQueSeSabe = { ...s, ordenDelPaquete: ord.datos };
    // La marca de esta orden o, si el servidor dio otra, la de la orden del estado: un pago que quizás salió no se olvida.
    const otra = delEstado && delEstado.id !== ord.datos.id ? delEstado : null;
    const marca = this.marca(ord.datos.nota) ?? (otra ? this.marca(otra.nota) : null);
    const salio = this.salio(ord.datos.nota) || (otra ? this.salio(otra.nota) : false);
    const c = await this.o.portero.pago(ord.datos.id);
    if (!c.ok) {
      if (esDeSesion(c)) return { ...r, sesionVencida: true };
      // Sin saber cómo está, una marca dice que quizás salió: nunca pagar de nuevo.
      if (salio) return { ...r, pagoEnviado: true, pago: { fase: "sin-ver" } };
      if (marca !== null) return { ...r, pagoEnviado: true };
      // Sin saber qué recibió, sin la carga a la vista no se sigue a un precio.
      if (!s.carga) throw new SinRed();
      return r;
    }
    if (c.datos.pagada) {
      this.olvidarQueSalio(ord.datos.nota);
      return { ...r, pago: { fase: "listo", quedan: c.datos.sorteos.quedan, saldo: r.saldo }, pagoEnviado: false };
    }
    r = { ...r, cobro: { total: c.datos.total, minimo: c.datos.minimo, recibido: c.datos.recibido } };
    // Salió y el servidor no lo ve: se sigue sin ver, con el número, aunque la marca haya vencido.
    if (salio) return { ...r, pagoEnviado: true, pago: { fase: "sin-ver" } };
    return { ...r, pagoEnviado: this.sigueEnVuelo(marca) };
  }

  /** Las notas de los pagos que salieron, de este navegador. */
  private pagosQueSalieron(): string[] {
    const a = this.almacen;
    if (!a) return [];
    try {
      const v: unknown = JSON.parse(a.getItem(CLAVE_DE_PAGOS_QUE_SALIERON) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  private salio(nota: string): boolean {
    return this.salidos.has(nota) || this.pagosQueSalieron().includes(nota);
  }

  private anotarQueSalio(nota: string): void {
    this.salidos.add(nota);
    const a = this.almacen;
    if (!a) return;
    try {
      a.setItem(CLAVE_DE_PAGOS_QUE_SALIERON, JSON.stringify([nota, ...this.pagosQueSalieron().filter((x) => x !== nota)].slice(0, PAGOS_QUE_SE_RECUERDAN)));
    } catch {
      /* sin lugar: vale lo que vive esta ventana, y la marca de la billetera mientras no venza */
    }
  }

  /** El servidor reconoció el pago: ya no hace falta recordarlo. */
  private olvidarQueSalio(nota: string): void {
    this.salidos.delete(nota);
    const a = this.almacen;
    const antes = this.pagosQueSalieron();
    if (!a || !antes.includes(nota)) return;
    try {
      a.setItem(CLAVE_DE_PAGOS_QUE_SALIERON, JSON.stringify(antes.filter((x) => x !== nota)));
    } catch {
      /* queda anotado: el servidor lo da por pagado igual */
    }
  }

  private marca(nota: string): number | null {
    try {
      return this.o.marcaDelPago(nota);
    } catch {
      return null;
    }
  }

  /**
   * Con el servidor diciendo que la orden no está pagada, un pago marcado sigue en vuelo mientras su marca no venza. Pasado
   * su vencimiento (el del pago más el margen) ya no puede entrar: el servidor leyó la red y no lo vio, así que no entró.
   */
  private sigueEnVuelo(marca: number | null): boolean {
    return marca !== null && marca * 1000 > this.reloj();
  }

  private cerradasVistas(): string[] {
    const a = this.almacen;
    if (!a) return [];
    try {
      const v: unknown = JSON.parse(a.getItem(CLAVE_DE_CERRADAS_VISTAS) ?? "[]");
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }

  /** La carga cerrada que se mostró y se dejó atrás (Empezar de nuevo, otro QR) no vuelve a aparecer. */
  private dejarAtras(s: LoQueSeSabe): void {
    const o = s.carga ? leerOrden(s.carga.orden) : null;
    const a = this.almacen;
    if (!o || !a || (o.estado !== "failed" && o.estado !== "refunded")) return;
    try {
      const vistas = [o.id, ...this.cerradasVistas().filter((x) => x !== o.id)].slice(0, CERRADAS_QUE_SE_RECUERDAN);
      a.setItem(CLAVE_DE_CERRADAS_VISTAS, JSON.stringify(vistas));
    } catch {
      /* sin lugar: puede volver a aparecer, con su número */
    }
  }

  private async leerOrdenDe(id: string): Promise<unknown> {
    const r = await this.o.billetera.cargaLeerOrden(id);
    if (r.estado === "orden") return r.orden;
    if (r.estado === "sin-red") throw new SinRed();
    return { id };
  }

  /* ------------------------------------------------------------------ mirar: solo lee */

  async mirar(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    if (this.cerrada) return s;
    try {
      return await this.mirarYa(s);
    } catch (e) {
      if (e instanceof SinRed) throw e;
      throw new SinRed();
    }
  }

  /**
   * Si una mirada que abre lanza, la próxima vuelve a abrir: la ventana se queda con lo que tenía antes y lo leído al
   * abrir (la carga, el permiso, el pago marcado) no llegó a ella.
   */
  private async mirarYa(entrada: LoQueSeSabe): Promise<LoQueSeSabe> {
    const abriendo = !this.abierto;
    try {
      return await this.mirarDespuesDeAbrir(abriendo ? await this.abrir(entrada) : entrada, abriendo);
    } catch (e) {
      if (abriendo) this.abierto = false;
      throw e;
    }
  }

  private async mirarDespuesDeAbrir(abierta: LoQueSeSabe, abriendo: boolean): Promise<LoQueSeSabe> {
    let s = abierta;
    if (s.sesionVencida) return s;
    let p = pantallaDeCompra({ ...s, ahora: this.reloj() });
    // La espera lee lo que le falta, una cosa tras otra, hasta que hay algo que mostrar: el saldo, el permiso, la
    // cotización. Así la ventana no cuenta como intentos fallidos las lecturas que avanzan.
    for (let i = 0; p.id === "espera" && i < LECTURAS_POR_ESPERA; i++) {
      s = await this.despuesDeLaEspera(s, p);
      if (s.sesionVencida || s.sinRed) return s;
      p = pantallaDeCompra({ ...s, ahora: this.reloj() });
    }
    switch (p.id) {
      case "espera":
        return s;
      case "carnet-espera":
        return this.comoVaLaVerificacion(s);
      case "espera-pago":
      case "camino":
      case "qr-falta":
      case "qr-vencido-abierta":
      case "frenada":
      case "desconocido":
      case "antes":
      case "aprobar":
      case "aprobar-no-salio":
      case "ya-pagaste":
      case "qr":
        return this.conLaOrden(s);
      case "pago-no-se-sabe":
      case "pago-sin-ver":
      case "pago-sin-patrocinio":
        // Recién abierta, la orden del paquete y su pago ya se leyeron.
        return abriendo ? s : this.mirarElPago(s);
      case "app":
        return s;
      default:
        return s;
    }
  }

  /** La espera: lo que le falta a la pantalla, en el orden en que lo pide. */
  private async despuesDeLaEspera(s: LoQueSeSabe, p: PantallaDeCompra): Promise<LoQueSeSabe> {
    if (p.leer === "saldo") return this.conSaldo({ ...s, pago: s.pago?.fase === "sin-saldo" ? null : s.pago });
    if (p.leer === "permiso") return this.conPermiso(s);
    if (p.leer === "cobro") return this.conElPaquete(s);
    // Pagar desde otra app sin la orden del paquete: se pide (el servidor devuelve la misma mientras siga abierta).
    if (s.medio === "app" && !s.ordenDelPaquete) {
      const ord = await this.o.portero.orden(this.producto.id);
      if (ord.ok) return { ...s, ordenDelPaquete: ord.datos };
      if (esDeSesion(ord)) return { ...s, sesionVencida: true };
      if (ord.motivo === "sin-red" || ord.estado === 0) throw new SinRed();
      return { ...s, medio: "qr" };
    }
    return this.cotizar(s);
  }

  /** El permiso de empezar: el servidor lo da una vez por compra y devuelve el mismo si se pide de nuevo. */
  private async conPermiso(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const r = await this.o.portero.empezar(this.producto.id);
    if (r.ok) {
      this.registrar("permiso", { producto: r.datos.producto, cargada: r.datos.cargada });
      return { ...s, permiso: permisoDe(r.datos), sinLugar: false };
    }
    if (esDeSesion(r)) return { ...s, sesionVencida: true };
    if (r.motivo === "compra-en-curso" && r.permiso) {
      const otro = (this.o.otros ?? []).find((x) => x.id === r.permiso?.producto);
      if (otro) {
        this.producto = otro;
        return this.conPermiso({ ...s, producto: otro });
      }
    }
    this.registrar("sin-permiso", { motivo: r.motivo });
    if (SIN_QR_HOY.has(r.motivo) || r.motivo === "compra-en-curso") return { ...s, sinLugar: true };
    throw new SinRed();
  }

  /**
   * La cotización para lo que falta pagar (el total del servidor, menos lo que ya recibió la orden, menos el saldo), con el
   * margen de `compra-monto.ts` y tres cotizaciones como mucho. Lo que falta antes de un precio (la verificación, preparar
   * la cuenta) se lee entero para mostrarlo.
   */
  private async cotizar(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const permiso = s.permiso;
    if (!permiso || permiso.total === null) return { ...s, leyendo: false };
    const b = this.o.billetera;
    if (!this.ruta) {
      const r = await b.cargaRuta();
      if (r.estado === "ruta") this.ruta = r.ruta;
      else return { ...s, leyendo: false, cotizacion: this.lecturaDeFalla(r.estado === "sin-ruta" ? "no-se-pudo" : r.estado) };
    }
    const ruta = this.ruta;
    const recibido = s.cobro?.recibido ?? "0";
    const total = restar(s.cobro?.total ?? permiso.total, recibido);
    const objetivo = total === null ? null : objetivoDeLaCarga(total, s.saldo);
    if (!objetivo || objetivo.objetivo <= 0) return { ...s, leyendo: false, cotizacion: { estado: "no-se-puede" } };
    const hechas: CotizacionHecha[] = [];
    const precios: PrecioDeCarga[] = [];
    for (;;) {
      const sig = cotizacionParaElObjetivo(objetivo.objetivo, hechas, this.minimoBs);
      if (sig.estado === "no-alcanza") return { ...s, leyendo: false, noAlcanza: true, cotizacion: null };
      if (sig.estado === "alcanza") {
        const precio = precios[sig.indice] as PrecioDeCarga;
        this.registrar("precio", { bs: precio.pagas, cotizaciones: hechas.length });
        return { ...s, leyendo: false, noAlcanza: false, cotizacion: { estado: "precio", precio }, aprobacionesTotales: precio.aprobaciones };
      }
      const r = await b.cargaCotizar(ruta, sig.bs);
      if (r.estado !== "precio") {
        if (r.estado === "sin-cuenta") return { ...s, leyendo: false, sesionVencida: true };
        const lectura: LecturaDeCotizacion =
          r.estado === "falta" || r.estado === "en-revision" || r.estado === "rechazada" || r.estado === "cambiar-monto" || r.estado === "no-se-puede" || r.estado === "sin-creditos" || r.estado === "sin-red"
            ? (r as LecturaDeCotizacion)
            : this.lecturaDeFalla(r.estado);
        if (lectura.estado === "sin-red") throw new SinRed();
        return this.conLoQueFalta({ ...s, leyendo: false, cotizacion: lectura });
      }
      hechas.push({ pagas: r.precio.pagas, recibis: r.precio.recibis });
      precios.push(r.precio);
    }
  }

  /** Una falla de la carga como lectura de la cotización: la red, los créditos de Tinkazo, la cuenta, o no se puede. */
  private lecturaDeFalla(estado: string): LecturaDeCotizacion {
    if (estado === "sin-red") return { estado: "sin-red" };
    if (estado === "sin-creditos") return { estado: "sin-creditos" };
    if (estado === "proteger-cuenta") return { estado: "falta", falta: [{ que: "proteger-cuenta" }] };
    return { estado: "no-se-puede" };
  }

  /** Lo que muestra el paso de verificación de ahora: el formulario o los datos del SEGIP, leídos antes de mostrarlo. */
  private async conLoQueFalta(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const paso = pasoDe(s);
    if (!paso) return s;
    const b = this.o.billetera;
    if (paso.tipo === "FORM" && this.formulario?.opcion !== paso.opcion) {
      const f = await b.cargaLeerFormulario(paso);
      if (f.estado !== "formulario" || !formularioQueSeMuestra(f.formulario)) return { ...s, cotizacion: { estado: "no-se-puede" } };
      this.formulario = { opcion: paso.opcion, form: f.formulario };
    }
    if (paso.tipo === "REGISTRY_CHECK") {
      const r = await b.cargaLeerSegip(paso);
      if (r.estado === "aprobada" || r.estado === "falta-identidad") return { ...s, leyendo: true, cotizacion: null };
      if (r.estado === "en-revision") return { ...s, cotizacion: { estado: "en-revision" } };
      const prefill = r.estado === "datos" && r.segip.prefill.applies ? r.segip.prefill : null;
      if (!prefill) return { ...s, cotizacion: { estado: "no-se-puede" } };
      this.segip = { opcion: paso.opcion, prefill };
    }
    return s;
  }

  /** Volvió de la otra página de la verificación: cómo quedó. Aprobada o procesando, se cotiza de nuevo. */
  private async comoVaLaVerificacion(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const paso = pasoDe(s);
    if (!paso) return s;
    const r = await this.o.billetera.cargaMirarVerificacion(paso);
    if (r.estado === "sin-red") throw new SinRed();
    if (r.estado !== "leida") return s;
    switch (r.verificacion) {
      case "aprobada":
      case "procesando":
        return { ...s, leyendo: true, cotizacion: null, verificacion: {} };
      case "en-revision":
        return { ...s, cotizacion: { estado: "en-revision" } };
      case "rechazada":
        return { ...s, cotizacion: { estado: "rechazada" } };
      case "vencida":
        return { ...s, cotizacion: conPaso(s.cotizacion, { estado: "vencido" }) };
      default:
        return s;
    }
  }

  /** La orden de carga como está ahora y, si espera una aprobación, lo que la regla dice de ella. */
  private async conLaOrden(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const c = s.carga;
    const o = c ? leerOrden(c.orden) : null;
    if (!c || !o) return s;
    const r = await this.o.billetera.cargaLeerOrden(o.id);
    if (r.estado === "sin-red") throw new SinRed();
    if (r.estado === "sin-creditos") return { ...s, carga: { ...c, vista: { ...(c.vista ?? {}), sinCreditos: true } } };
    if (r.estado !== "orden") return s;
    const antes = o.estado;
    const nueva: LoQueSeSabe = { ...s, carga: { ...c, orden: r.orden, vista: { ...(c.vista ?? {}), sinCreditos: false } } };
    const despues = leerOrden(r.orden)?.estado;
    if (despues !== antes) this.registrar("carga", { estado: despues ?? "desconocido" });
    // Llegó: el saldo de ahora, para terminar con lo que hay.
    if (despues === "completed" && antes !== "completed") return this.conRevision(await this.conSaldo(nueva));
    return this.conRevision(nueva);
  }

  /** Si la orden espera una aprobación, lo que la regla dice de ese paso, antes de mostrar Confirmar. */
  private async conRevision(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const c = s.carga;
    if (!c) return s;
    const p = pasoDeOrden(c.orden, c.marcas, this.reloj(), c.vista ?? {});
    if (p.pantalla !== "aprobar") return s;
    if (this.revisadoPara === p.paso.pedido && s.aprobacion?.revisado) return s;
    const id = leerOrden(c.orden)?.id ?? "";
    const r = await this.o.billetera.cargaRevisarPaso(id, p.paso.pedido);
    if (r.estado === "sin-red") throw new SinRed();
    if (r.estado === "cambio") return { ...s, carga: { ...c, orden: r.orden } };
    if (r.estado === "revisado") {
      this.revisadoPara = p.paso.pedido;
      return { ...s, aprobacion: { revisado: { que: r.que, dolares: r.dolares } } };
    }
    if (r.estado === "raro") {
      this.revisadoPara = p.paso.pedido;
      this.registrar("paso-raro", { motivo: r.motivo });
      return { ...s, aprobacion: { revisado: { motivo: r.motivo } } };
    }
    if (r.estado === "sin-creditos") return { ...s, carga: { ...c, vista: { ...(c.vista ?? {}), sinCreditos: true } } };
    return s;
  }

  /* ------------------------------------------------------------------ hacer: cada toque */

  async hacer(accion: AccionDeCompra, s: LoQueSeSabe, o: AvisoDelMotor): Promise<LoQueSeSabe> {
    try {
      return await this.hacerYa(accion, s, o);
    } catch {
      return { ...s, sinRed: true };
    }
  }

  private async hacerYa(accion: AccionDeCompra, s: LoQueSeSabe, o: AvisoDelMotor): Promise<LoQueSeSabe> {
    const b = this.o.billetera;
    switch (accion) {
      case "mirar":
        return this.volverAMirar(s);
      case "reintentar":
        // Probar de nuevo lee todo otra vez, como al abrir.
        this.abierto = false;
        return this.mirarYa({ ...s, sinRed: false, cotizacion: s.cotizacion?.estado === "sin-red" ? null : s.cotizacion });
      case "empezar-verificacion":
        return { ...s, verificacion: { ...(s.verificacion ?? {}), empezo: true } };
      case "abrir-verificacion":
        return s;
      case "ya-termine":
        return this.comoVaLaVerificacion(s);
      case "verificacion-otra-vez":
        this.verificacionDeNuevo = true;
        return { ...s, verificacion: { empezo: true }, cotizacion: conPaso(s.cotizacion, { estado: "por-hacer" }) };
      case "guardar-datos":
        return this.guardarDatos(s, o.entrada ?? {});
      case "confirmar-segip":
        return this.confirmarSegip(s, o.entrada ?? {});
      case "darme-de-alta":
        return this.darDeAlta(s);
      case "preparar":
        return this.preparar(s);
      case "ver-qr":
        return this.verElQr(s, o);
      case "ya-pague":
      case "si-pague":
      case "pague-igual": {
        const id = s.carga ? leerOrden(s.carga.orden)?.id : null;
        if (!id || !s.carga) return s;
        const r = await b.cargaYaPague(id);
        this.registrar("ya-pague");
        return r.estado === "orden" ? this.conRevision({ ...s, carga: { ...s.carga, orden: r.orden } }) : s;
      }
      case "pedir-qr-nuevo":
        this.dejarAtras(s);
        return this.cotizar({ ...s, carga: null, cotizacion: null, precioVencio: true, todaviaNo: false, aprobacion: {} });
      case "empezar-de-nuevo":
        this.dejarAtras(s);
        return this.cotizar({ ...s, carga: null, cotizacion: null, precioVencio: false, todaviaNo: false, aprobacion: {} });
      case "ver-primer-paso":
        return this.conRevision(s);
      case "aprobar":
        return this.aprobar(s, o);
      case "reintentar-carga": {
        const id = s.carga ? leerOrden(s.carga.orden)?.id : null;
        if (!id || !s.carga) return s;
        const r = await b.cargaReintentar(id);
        if (r.estado === "orden" || r.estado === "cambio") return this.conRevision({ ...s, carga: { ...s.carga, orden: r.orden } });
        if (r.estado === "sin-red") return { ...s, sinRed: true };
        return s;
      }
      case "cargar-falta":
        // Llegó de menos: se carga lo que falta con otro QR, sobre lo que el servidor ya recibió.
        this.dejarAtras(s);
        return this.cotizar({ ...s, carga: null, cotizacion: null, aprobacion: {} });
      case "pagar-paquete":
        return this.pagarElPaquete(s, o);
      case "mirar-pago":
        return this.mirarElPago(s);
      case "otra-app":
        this.o.recordarMedio?.("app");
        return this.despuesDeLaEspera({ ...s, medio: "app", ordenDelPaquete: null }, pantallaDeCompra({ ...s, medio: "app", ordenDelPaquete: null }));
      case "estoy-en-bolivia":
        this.o.recordarMedio?.("qr");
        return { ...s, medio: "qr", ordenDelPaquete: null };
      case "ya-pague-app":
        return this.yaPagueDesdeOtraApp(s, o);
      case "no-pague-otra":
        // No pagó la orden de otra app: recién ahora el aviso la reemplaza, con lo mismo que llevaba Ver el QR.
        return this.verElQr({ ...s, otraOrden: null }, o, true);
      case "pague-otra":
        return this.yaPagueLaOtra(s);
      default:
        return s;
    }
  }

  /** Volver a mirar: lo que la pantalla de ahora espera de afuera, otra vez. */
  private async volverAMirar(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const p = pantallaDeCompra({ ...s, ahora: this.reloj() });
    switch (p.id) {
      case "sin-qr":
        return this.mirarYa({ ...s, sinLugar: false, noAlcanza: false, topeDeQr: false, permiso: s.sinLugar ? null : s.permiso, cotizacion: null, leyendo: true });
      case "revision":
      case "segip-no":
        return this.mirarYa({ ...s, cotizacion: null, leyendo: true, verificacion: {} });
      case "no-vende":
        return this.mirarYa({ ...s, permiso: s.permiso?.total === null ? null : s.permiso, pago: null });
      default:
        return this.mirarYa(s);
    }
  }

  /* ------------------------------------------------------------------ la verificación */

  async verificacion(s: LoQueSeSabe): Promise<string | null> {
    const paso = pasoDe(s);
    if (!paso || paso.tipo !== "KYC") return null;
    const deNuevo = this.verificacionDeNuevo;
    this.verificacionDeNuevo = false;
    const r = await this.o.billetera.cargaAbrirVerificacion(paso, deNuevo ? { deNuevo: true } : {});
    this.registrar("verificacion", { estado: r.estado });
    return r.estado === "abrir" ? r.url : null;
  }

  private async guardarDatos(s: LoQueSeSabe, entrada: Record<string, string>): Promise<LoQueSeSabe> {
    const paso = pasoDe(s);
    const f = this.formulario;
    if (!paso || paso.tipo !== "FORM" || !f || f.opcion !== paso.opcion) return s;
    const respuestas = respuestasDe(f.form, entrada);
    const r = await this.o.billetera.cargaGuardarFormulario(paso, respuestas);
    if (r.estado === "guardado") {
      this.formulario = null;
      return this.cotizar({ ...s, cotizacion: null });
    }
    if (r.estado === "sin-red") return { ...s, sinRed: true };
    return s;
  }

  private async confirmarSegip(s: LoQueSeSabe, entrada: Record<string, string>): Promise<LoQueSeSabe> {
    const paso = pasoDe(s);
    const g = this.segip;
    if (!paso || paso.tipo !== "REGISTRY_CHECK" || !g || g.opcion !== paso.opcion) return s;
    const dos = (entrada.apellidos ?? "dos") !== "uno";
    const juntos = [g.prefill.surname1, g.prefill.surname2 ?? ""].join(" ").trim();
    const complemento = (entrada.complemento ?? "").trim();
    const r = await this.o.billetera.cargaConfirmarSegip(paso, {
      surname1: dos ? g.prefill.surname1 : juntos,
      ...(dos && g.prefill.surname2 ? { surname2: g.prefill.surname2 } : {}),
      ...(complemento ? { complementNumber: complemento } : {}),
    });
    switch (r.estado) {
      case "aprobada":
        this.segip = null;
        return this.cotizar({ ...s, cotizacion: null });
      case "en-revision":
        return { ...s, cotizacion: { estado: "en-revision" } };
      case "rechazada":
      case "no-coincide":
        return { ...s, verificacion: { ...(s.verificacion ?? {}), segipNo: true } };
      case "sin-red":
        return { ...s, sinRed: true };
      default:
        return this.cotizar({ ...s, cotizacion: null });
    }
  }

  private async darDeAlta(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const paso = pasoDe(s);
    if (!paso || paso.tipo !== "PROVIDER_REGISTRATION") return s;
    const r = await this.o.billetera.cargaDarDeAlta(paso);
    if (r.estado === "sin-red") return { ...s, sinRed: true };
    if (r.estado === "registrada" || r.estado === "pendiente") return this.cotizar({ ...s, cotizacion: null });
    this.registrar("alta", { estado: r.estado });
    return { ...s, cotizacion: { estado: "no-se-puede" } };
  }

  private async preparar(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const c = s.cotizacion;
    if (c?.estado !== "falta") return s;
    const r = await this.o.billetera.cargaPreparar(c.falta);
    this.registrar("preparar", { estado: r.estado, ...(r.estado === "linea" ? { linea: r.resultado } : {}) });
    switch (r.estado) {
      case "listo":
      case "cuenta-de-paso-espera":
        return this.cotizar({ ...s, cotizacion: null });
      case "linea":
        if (r.resultado === "hecho" || r.resultado === "en-curso" || r.resultado === "cuenta-creandose") return this.cotizar({ ...s, cotizacion: null });
        if (r.resultado === "proteger") return { ...s, cotizacion: { estado: "falta", falta: [{ que: "proteger-cuenta" }] } };
        if (r.resultado === "ahora-no" || r.resultado === "no-patrocina") return { ...s, cotizacion: { estado: "sin-creditos" } };
        return { ...s, sinRed: true };
      case "sin-red":
        return { ...s, sinRed: true };
      case "proteger-cuenta":
        return { ...s, cotizacion: { estado: "falta", falta: [{ que: "proteger-cuenta" }] } };
      case "sin-creditos":
        return { ...s, cotizacion: { estado: "sin-creditos" } };
      default:
        return { ...s, cotizacion: { estado: "no-se-puede" } };
    }
  }

  /* ------------------------------------------------------------------ el QR */

  /**
   * Ver el QR: el aviso de carga al servidor y la orden de carga, en el método de la compra (`cargaCrearOrdenDeCompra`).
   * El aviso renueva el permiso vencido una vez y espera otro aviso en curso una vez. Una orden viva sin el recargo (la
   * de pagar desde otra app) nunca se reemplaza sola: se pregunta, y `reemplazar` es el toque de No pagué.
   */
  private async verElQr(s: LoQueSeSabe, aviso: AvisoDelMotor, reemplazar = false): Promise<LoQueSeSabe> {
    const c = s.cotizacion;
    if (c?.estado !== "precio") return s;
    const entrada = reemplazar ? this.entradaDelQr : (aviso.entrada ?? {});
    this.entradaDelQr = entrada;
    // Lo que dijo el aviso, y si se anuló: los llenan las dos funciones de abajo mientras corre la creación.
    let no = null as { motivo: string; orden?: OrdenAbierta } | null;
    let permiso = s.permiso as PermisoDeCompra | null;
    let anulada = false as boolean;
    const avisar = async (): Promise<boolean | "sin-red"> => {
      const r = await this.avisarLaCarga(reemplazar);
      if (r.ok) {
        permiso = permisoDe(r.datos);
        return true;
      }
      no = { motivo: r.motivo, ...(r.orden ? { orden: r.orden } : {}) };
      if (r.permiso) permiso = permisoDe(r.permiso);
      return r.motivo === "sin-red" || r.estado === 0 ? "sin-red" : false;
    };
    const anular = async (): Promise<void> => {
      const r = await this.o.portero.anular(this.producto.id);
      anulada = r.ok;
      this.registrar("anular", { ok: r.ok, motivo: r.ok ? null : r.motivo });
    };
    const r = await this.o.billetera.cargaCrearOrdenDeCompra(c.precio, entrada, { avisar, anular });
    this.registrar("crear-orden", { estado: r.estado, anulada });
    // La compra quedó cargada (o renovada): el recargo ya va atado aunque se haya anulado.
    let base: LoQueSeSabe = { ...s, permiso, precioVencio: false, todaviaNo: false, aprobacion: {}, otraOrden: null };
    if (anulada && permiso) base = { ...base, recargoPendiente: permiso.recargo };
    switch (r.estado) {
      case "creada":
        return { ...base, carga: this.cargaDe(r.orden, r.falloAlCrear ? { falloAlCrear: true } : {}) };
      case "ya-hay":
        return this.conRevision({ ...base, carga: this.cargaDe(await this.leerOrdenDe(r.id)) });
      case "precio-vencido":
        return this.cotizar({ ...base, cotizacion: null, precioVencio: true });
      case "faltan-datos":
      case "cuenta-de-paso":
        return this.cotizar({ ...base, cotizacion: null });
      case "sin-aviso":
        return this.sinElSiDelAviso(base, no);
      case "no-se-sabe":
        // Puede haber un QR vivo: Probar de nuevo lee todo otra vez, la carga abierta primero.
        this.abierto = false;
        return { ...base, sinRed: true };
      case "sin-creditos":
        return { ...base, cotizacion: { estado: "sin-creditos" } };
      case "proteger-cuenta":
        return { ...base, cotizacion: { estado: "falta", falta: [{ que: "proteger-cuenta" }] } };
      case "sin-cuenta":
        return { ...base, sesionVencida: true };
      case "sin-red":
        this.abierto = false;
        return { ...base, sinRed: true };
      default:
        return { ...base, cotizacion: { estado: "no-se-puede" } };
    }
  }

  /**
   * El aviso de carga, con lo que se puede arreglar sin preguntar: el permiso vencido y otro aviso en curso. `reemplazar`:
   * la persona dijo que no pagó su orden de otra app (el único `true` que acepta el servidor).
   */
  private async avisarLaCarga(reemplazar: boolean): Promise<ResultadoDeCompra<PermisoDelServidor>> {
    const portero = this.o.portero;
    const producto = this.producto.id;
    const cargar = () => (reemplazar ? portero.cargar(producto, true) : portero.cargar(producto));
    let r = await cargar();
    if (!r.ok && r.motivo === "permiso-vencido") {
      const e = await portero.empezar(producto);
      if (!e.ok) return e;
      r = await cargar();
    }
    if (!r.ok && r.motivo === "cargando") {
      const espera = Math.min(ESPERA_DEL_AVISO_MAX_MS, Math.max(0, (r.reintentarEn ?? this.reloj() + ESPERA_DEL_AVISO_MAX_MS) - this.reloj()) + 1_000);
      this.registrar("aviso-espera", { ms: espera });
      await this.esperar(espera);
      r = await cargar();
    }
    if (!r.ok && r.motivo === "orden-abierta" && r.orden) {
      // Una orden de pagar desde otra app, viva y sin el recargo. No se reemplaza sin preguntar: la persona pudo pagarla
      // desde otra app y el pago todavía no llegó (pasados 2 minutos del reemplazo, el servidor ya no lo honra solo). Lo
      // que el servidor sabe de ella decide entre la pregunta y la ayuda.
      const c = await portero.pago(r.orden.id);
      if (c.ok && c.datos.pagada) return { ...r, motivo: "orden-pagada" };
      if (c.ok && !c.datos.pagada && /[1-9]/.test(c.datos.recibido)) return { ...r, motivo: "orden-con-pago" };
    }
    return r;
  }

  /** Sin el sí del aviso, la pantalla dice por qué: sin QR hoy, la sesión, la red o una orden suya con pago. */
  private sinElSiDelAviso(s: LoQueSeSabe, no: { motivo: string; orden?: OrdenAbierta } | null): LoQueSeSabe {
    const motivo = no?.motivo ?? "sin-red";
    this.registrar("sin-aviso", { motivo });
    if (motivo === "sesion" || motivo === "sin-token") return { ...s, sesionVencida: true };
    // Una orden de pagar desde otra app, viva y sin nada recibido: antes del QR, la persona dice si la pagó.
    if (motivo === "orden-abierta" && no?.orden && no.orden.vence > this.reloj()) return { ...s, otraOrden: { id: no.orden.id, producto: no.orden.producto } };
    if (SIN_QR_HOY.has(motivo) || motivo === "compra-en-curso" || motivo === "sin-permiso") return { ...s, sinLugar: true, cotizacion: null };
    // Ya dio el sí varias veces para esta compra: lo destraba quien opera. La ayuda, nunca un Probar de nuevo que no sale.
    if (motivo === "tope-de-avisos") return { ...s, topeDeQr: true };
    // La orden de antes ya está pagada, o recibió algo: ayuda con el número, nunca otro pago.
    if (motivo === "orden-pagada" || motivo === "orden-con-pago" || motivo === "orden-abierta") return { ...s, pago: { fase: "raro" } };
    return { ...s, sinRed: true };
  }

  /* ------------------------------------------------------------------ aprobar */

  private async aprobar(s: LoQueSeSabe, aviso: AvisoDelMotor): Promise<LoQueSeSabe> {
    const c = s.carga;
    if (!c) return s;
    const p = pasoDeOrden(c.orden, c.marcas, this.reloj(), c.vista ?? {});
    const id = leerOrden(c.orden)?.id;
    if (p.pantalla !== "aprobar" || !id) return this.conRevision(s);
    aviso.avisar({ ...s, aprobacion: { ...(s.aprobacion ?? {}), enCurso: true } });
    const r = await this.o.billetera.cargaAprobar(id, p.paso.pedido);
    this.registrar("aprobar", { estado: r.estado, que: p.paso.que });
    switch (r.estado) {
      case "aprobado":
      case "enviado": {
        const o = await this.o.billetera.cargaLeerOrden(id);
        const orden = o.estado === "orden" ? o.orden : c.orden;
        return this.conRevision({ ...s, carga: { ...c, orden }, aprobacion: {} });
      }
      case "cambio":
        return this.conRevision({ ...s, carga: { ...c, orden: r.orden }, aprobacion: {} });
      case "raro":
        return { ...s, aprobacion: { revisado: { motivo: r.motivo } } };
      case "tope":
        return { ...s, aprobacion: { revisado: { motivo: "tope" } } };
      case "sin-creditos":
        return { ...s, aprobacion: {}, carga: { ...c, vista: { ...(c.vista ?? {}), sinCreditos: true } } };
      case "sin-red":
        return { ...s, aprobacion: { ...(s.aprobacion ?? {}), enCurso: false }, sinRed: true };
      default:
        return { ...s, aprobacion: { ...(s.aprobacion ?? {}), enCurso: false, fallo: true } };
    }
  }

  /* ------------------------------------------------------------------ pagar el paquete con el saldo */

  /**
   * La única máquina que paga el paquete con el saldo. Un pago a la vez en esta ventana y, con el candado del paquete, en
   * este navegador. En orden:
   * 1. El monto es el de la pantalla (`pagar`): lo que queda del total, o el saldo entero entre el mínimo y el total.
   * 2. La orden del paquete del servidor (la misma mientras siga abierta).
   * 3. Con la marca de un pago de esa orden que quizás salió, no se arma otro: no se sabe todavía.
   * 4. Lo que el servidor dice de esa orden ahora. Pagada: listo. Si con eso la pantalla pagaría otro monto, no se paga.
   * 5. Se manda una vez (`pagarOrden`). Incierto no se repite nunca. Salió: se le pregunta al servidor si lo vio.
   */
  private async pagarElPaquete(s: LoQueSeSabe, aviso: AvisoDelMotor): Promise<LoQueSeSabe> {
    const monto = pantallaDeCompra({ ...s, ahora: this.reloj() }).pagar;
    if (!monto || this.pagando) return s;
    this.pagando = true;
    try {
      aviso.avisar({ ...s, pago: { fase: "pagando" } });
      const candado = this.o.candado ?? conCandadoDelNavegador;
      return await candado(() => this.pagarDentro(s, monto));
    } finally {
      this.pagando = false;
    }
  }

  private async pagarDentro(s: LoQueSeSabe, monto: string): Promise<LoQueSeSabe> {
    const portero = this.o.portero;
    const ord = await portero.orden(this.producto.id);
    if (!ord.ok) {
      this.registrar("orden-del-paquete", { motivo: ord.motivo });
      if (esDeSesion(ord)) return { ...s, sesionVencida: true };
      if (ORDEN_QUE_NO_SE_VENDE.has(ord.motivo)) return { ...s, pago: { fase: "no-vende" } };
      if (ord.motivo === "compra-en-curso") return { ...s, pago: { fase: "raro" } };
      return { ...s, pago: { fase: "no-salio" } };
    }
    const orden = ord.datos;
    let r: LoQueSeSabe = { ...s, ordenDelPaquete: orden };
    if (this.salio(orden.nota)) return { ...r, pago: { fase: "sin-ver" }, pagoEnviado: true };
    if (this.sigueEnVuelo(this.marca(orden.nota))) return { ...r, pago: { fase: "no-se-sabe" }, pagoEnviado: true };
    const c = await portero.pago(orden.id);
    if (!c.ok) {
      if (esDeSesion(c)) return { ...r, sesionVencida: true };
      // Sin saber cómo está la orden, no se paga: no se movió nada.
      return { ...r, pago: { fase: "no-salio" } };
    }
    if (c.datos.pagada) return this.listo(r, c.datos.sorteos.quedan);
    r = { ...r, cobro: { total: c.datos.total, minimo: c.datos.minimo, recibido: c.datos.recibido }, pago: null, pagoEnviado: false };
    const ahora = pantallaDeCompra({ ...r, ahora: this.reloj() });
    if (ahora.pagar !== monto) {
      this.registrar("pago-cambio");
      return r;
    }
    this.registrar("pagar", { monto });
    let pago: ResultadoDelPagoConSaldo;
    try {
      pago = await this.o.billetera.pagarOrden({ destino: orden.destino, monto, nota: orden.nota });
    } catch {
      // Si la billetera lanzara, no se sabe si salió.
      pago = { estado: "incierto", vence: Math.floor(this.reloj() / 1000) };
    }
    this.registrar("pago", { estado: pago.estado, ...(pago.estado === "no-salio" ? { motivo: pago.motivo } : {}) });
    switch (pago.estado) {
      case "salio":
        this.anotarQueSalio(orden.nota);
        return this.esperarQueLoVea(r, orden);
      case "incierto":
        return { ...r, pago: { fase: "no-se-sabe" }, pagoEnviado: true };
      case "no-salio":
        switch (pago.motivo) {
          case "sin-saldo":
            return { ...r, pago: { fase: "sin-saldo" } };
          case "sin-patrocinio":
            return { ...r, pago: { fase: "sin-patrocinio" } };
          case "regla":
          case "destino":
          case "sin-linea":
            return { ...r, pago: { fase: "raro" } };
          case "sin-cuenta":
            return { ...r, pago: { fase: "sin-cuenta" } };
          default:
            return { ...r, pago: { fase: "no-salio" } };
        }
    }
  }

  /** El pago salió: se le pregunta al servidor hasta que lo vea, unas veces. Si no lo ve, salió y no se ve: no se repite. */
  private async esperarQueLoVea(s: LoQueSeSabe, orden: OrdenDePago): Promise<LoQueSeSabe> {
    for (let i = 0; i < VECES_QUE_SE_MIRA_EL_PAGO; i++) {
      const c = await this.o.portero.pago(orden.id);
      if (c.ok && c.datos.pagada) {
        this.olvidarQueSalio(orden.nota);
        return this.listo(s, c.datos.sorteos.quedan);
      }
      if (c.ok && !c.datos.pagada) s = { ...s, cobro: { total: c.datos.total, minimo: c.datos.minimo, recibido: c.datos.recibido } };
      if (this.cerrada) break;
      await this.esperar(CADA_CUANTO_SE_MIRA_MS);
    }
    return { ...s, pago: { fase: "sin-ver" }, pagoEnviado: true };
  }

  private async listo(s: LoQueSeSabe, quedan: number): Promise<LoQueSeSabe> {
    let saldo: string | null = null;
    try {
      const x = await this.o.saldo();
      saldo = x.tipo === "saldo" ? x.saldo : null;
    } catch {
      saldo = null;
    }
    this.registrar("listo", { quedan });
    return { ...s, pago: { fase: "listo", quedan, saldo }, pagoEnviado: false, saldo: saldo ?? s.saldo };
  }

  /** Volver a mirar un pago que no se sabe o que no se vio: solo pregunta. Con la marca vencida y nada recibido, no entró. */
  private async mirarElPago(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    let orden = s.ordenDelPaquete ?? null;
    if (!orden) {
      const o = await this.o.portero.orden(this.producto.id);
      if (!o.ok) throw new SinRed();
      orden = o.datos;
    }
    const c = await this.o.portero.pago(orden.id);
    if (!c.ok) {
      if (esDeSesion(c)) return { ...s, sesionVencida: true };
      throw new SinRed();
    }
    const r: LoQueSeSabe = { ...s, ordenDelPaquete: orden };
    if (c.datos.pagada) {
      this.olvidarQueSalio(orden.nota);
      return this.listo(r, c.datos.sorteos.quedan);
    }
    const cobro = { total: c.datos.total, minimo: c.datos.minimo, recibido: c.datos.recibido };
    // Salió (la billetera dio su número) y el servidor no lo ve: nunca que no entró. Sigue sin verse, con el número y la
    // ayuda, aunque la marca haya vencido.
    if (s.pago?.fase === "sin-ver" || this.salio(orden.nota)) return { ...r, cobro, pagoEnviado: true, pago: { fase: "sin-ver" } };
    if (this.sigueEnVuelo(this.marca(orden.nota))) return { ...r, cobro, pagoEnviado: true, pago: { fase: "no-se-sabe" } };
    // No se sabía si salió, ya no puede entrar y el servidor no lo vio: no entró. La pantalla sale de lo que hay ahora.
    this.registrar("pago-no-entro");
    return this.conSaldo({ ...r, cobro, pagoEnviado: false, pago: null });
  }

  /* ------------------------------------------------------------------ pagar desde otra app */

  /** Ya pagó la orden de otra app: esa orden, para mirar su pago. Si es de otro paquete que se vende, la ventana sigue ese. */
  private async yaPagueLaOtra(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const otra = s.otraOrden;
    const sigue = otra && otra.producto !== this.producto.id ? (this.o.otros ?? []).find((p) => p.id === otra.producto) : undefined;
    if (sigue) this.producto = sigue;
    const x: LoQueSeSabe = { ...s, otraOrden: null, medio: "app", ordenDelPaquete: null, ...(sigue ? { producto: sigue } : {}) };
    return this.despuesDeLaEspera(x, pantallaDeCompra({ ...x, ahora: this.reloj() }));
  }

  private async yaPagueDesdeOtraApp(s: LoQueSeSabe, aviso: AvisoDelMotor): Promise<LoQueSeSabe> {
    const orden = s.ordenDelPaquete;
    if (!orden) return s;
    aviso.avisar(s, "pagoBuscando");
    for (let i = 0; i < VECES_QUE_SE_MIRA_EL_PAGO; i++) {
      const c = await this.o.portero.pago(orden.id);
      if (c.ok && c.datos.pagada) return this.listo(s, c.datos.sorteos.quedan);
      if (!c.ok && esDeSesion(c)) return { ...s, sesionVencida: true };
      if (this.cerrada) break;
      await this.esperar(CADA_CUANTO_SE_MIRA_MS);
    }
    return s;
  }

  /* ------------------------------------------------------------------ lo que se muestra además */

  detalle(s: LoQueSeSabe, p: PantallaDeCompra): DetalleDePantalla | null {
    const idioma = s.idioma;
    if (p.id === "datos" && this.formulario) return { campos: camposDe(this.formulario.form, idioma) };
    if (p.id === "segip" && this.segip) return detalleDelSegip(this.segip.prefill, idioma);
    if ((p.id === "precio" || p.id === "precio-vencido") && s.cotizacion?.estado === "precio" && s.cotizacion.precio.campos.length) {
      return {
        campos: s.cotizacion.precio.campos.map((c) => ({ clave: c.key, rotulo: c.label, tipo: c.type === "select" ? "select" : c.type === "email" ? "email" : c.type === "tel" ? "tel" : "text", ...(c.optional ? {} : { obligatorio: true }) })),
      };
    }
    return null;
  }
}

/* ================================================================== piezas puras */

/** `a - b` con los montos del servidor, o `null` si alguno no es un monto. Nunca negativo. */
function restar(a: string | null, b: string): string | null {
  const re = /^\d{1,15}(?:\.\d{1,7})?$/;
  if (a === null || !re.test(a) || !re.test(b)) return null;
  const st = (m: string): bigint => {
    const [e = "0", d = ""] = m.split(".");
    return BigInt(e) * 10_000_000n + BigInt(d.padEnd(7, "0"));
  };
  const n = st(a) - st(b);
  const x = n < 0n ? 0n : n;
  return `${x / 10_000_000n}.${(x % 10_000_000n).toString().padStart(7, "0")}`;
}

/** La cotización con el estado del paso de verificación cambiado. */
function conPaso(c: LecturaDeCotizacion | null, cambio: Partial<PasoDeVerificacion>): LecturaDeCotizacion | null {
  if (c?.estado !== "falta") return c;
  const [f, ...resto] = c.falta;
  if (f?.que !== "verificacion") return c;
  return { estado: "falta", falta: [{ que: "verificacion", paso: { ...f.paso, ...cambio } }, ...resto] };
}

type CampoDelFormulario = RequirementForm["fields"][number];
const TIPOS_QUE_SE_MUESTRAN: ReadonlySet<string> = new Set(["text", "textarea", "number", "date", "select", "email", "phone"]);

/** El formulario se puede mostrar con los campos de la ventana: sin selecciones múltiples ni casillas. */
export function formularioQueSeMuestra(f: RequirementForm): boolean {
  return Array.isArray(f.fields) && f.fields.every((c) => TIPOS_QUE_SE_MUESTRAN.has(c.type));
}

/** Los campos del formulario del kit como los pinta la ventana, en el idioma de la página y con lo ya contestado. */
export function camposDe(f: RequirementForm, idioma: "es" | "en"): CampoDeDatos[] {
  return f.fields.map((c: CampoDelFormulario) => {
    const previo = f.answers?.[c.key];
    const valor = typeof previo === "string" || typeof previo === "number" ? String(previo) : undefined;
    const tipo: CampoDeDatos["tipo"] = c.type === "select" ? "select" : c.type === "email" ? "email" : c.type === "phone" ? "tel" : "text";
    return {
      clave: c.key,
      rotulo: c.label[idioma] || c.label.es || c.label.en,
      tipo,
      ...(c.type === "select" ? { opciones: (c.options ?? []).map((op) => ({ valor: op.value, rotulo: op.label[idioma] || op.label.es || op.label.en })) } : {}),
      ...(valor !== undefined ? { valor } : {}),
      ...(c.required ? { obligatorio: true } : {}),
    };
  });
}

/** Lo que escribió la persona, como lo espera el kit: los números como número, lo demás como texto, sin lo vacío. */
export function respuestasDe(f: RequirementForm, entrada: Record<string, string>): RequirementFormAnswers {
  const r: RequirementFormAnswers = {};
  for (const c of f.fields as CampoDelFormulario[]) {
    const v = (entrada[c.key] ?? "").trim();
    if (!v) continue;
    r[c.key] = c.type === "number" && Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return r;
}

/** Un texto de la compra en ese idioma, con sus datos puestos. */
const decir = (idioma: "es" | "en", clave: string, vars: Record<string, string> = {}): string =>
  Object.entries(vars).reduce((x, [k, v]) => x.replaceAll(`{${k}}`, v), (TEXTOS_COMPRA[idioma][clave] as string | undefined) ?? clave);

/** Los datos que se comparan con el SEGIP (a la vista) y cómo se separan los apellidos y el complemento (para elegir). */
export function detalleDelSegip(p: { givenNames: string; surname1: string; surname2?: string; birthdate: string; documentNumber: string; complementNumber?: string }, idioma: "es" | "en"): DetalleDePantalla {
  const juntos = [p.surname1, p.surname2 ?? ""].join(" ").trim();
  const carnet = [p.documentNumber, p.complementNumber ?? ""].join(" ").trim();
  // Con dos apellidos se elige cómo se separan. Con uno solo no hay nada que elegir.
  const opciones = p.surname2
    ? [
        { valor: "dos", rotulo: decir(idioma, "compraSegipDos", { p: p.surname1, m: p.surname2 }) },
        { valor: "uno", rotulo: decir(idioma, "compraSegipUno", { a: juntos }) },
      ]
    : [{ valor: "dos", rotulo: decir(idioma, "compraSegipUno", { a: juntos }) }];
  return {
    lista: [
      { rotulo: decir(idioma, "compraSegipNombre"), valor: p.givenNames },
      { rotulo: decir(idioma, "compraSegipApellidos"), valor: juntos },
      { rotulo: decir(idioma, "compraSegipCarnet"), valor: carnet },
      { rotulo: decir(idioma, "compraSegipNacimiento"), valor: p.birthdate },
    ],
    campos: [
      { clave: "apellidos", rotulo: decir(idioma, "cargaSegipApellidos"), tipo: "select", opciones, valor: "dos", obligatorio: true },
      { clave: "complemento", rotulo: decir(idioma, "cargaSegipComplemento"), tipo: "text", valor: p.complementNumber ?? "" },
    ],
  };
}
