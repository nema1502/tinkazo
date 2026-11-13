/**
 * Las rutas de las altas del portero de mainnet: con la sesión de Pollar, qué acceso tiene la persona
 * (`POST /v1/alta/estado`) y el canje de un cupón (`POST /v1/alta/cupon`).
 *
 *   POST /v1/alta/estado   {}         200 {acceso, cuenta, abierta, pedido, sorteos:{quedan, proximoVence}, orden, fondeo}
 *   POST /v1/alta/cupon    {cupon}    200 {ok, repetido, sorteosSumados, sorteos, sigue}
 *        400 forma   404 cupon-no-existe   410 cupon-vencido {vence} | cupon-anulado   409 cupon-usado | lote-usado
 *   POST /v1/alta/abrir    {}         200 {estado:"pedido"|"abierta"|"no-hace-falta"}   (fase 2, fondeo diferido)
 *        403 sin-acceso   409 sin-billetera   503 sin-creditos   429 espera {reintentarEn} (una vez por minuto)
 *   POST /v1/alta/orden    {producto} 200 {orden:{id, producto, usdc, sorteos, destino, nota, memoId, enlace, vence}}
 *        503 pago-apagado | venta-pausada | altas-pausadas | fuera-del-piloto   400 producto   409 ya-tiene-acceso
 *   POST /v1/alta/pago     {orden}    200 {pagada:true, sorteos, sigue} | {pagada:false, recibido, total, minimo}
 *        400 forma   404 orden   410 orden-cerrada (cerrada para devolver o reemplazada; contesta después de leer)   502 red
 *   GET  /v1/alta/precios             200 {red, pago, alta:{usdc, sorteos, dias}, paquetes}, abierta y con caché de 5 minutos
 *   GET  /v1/carga/cupo               200 {abierta}, abierta como /v1/patrocinio/cupo: si el sitio ofrece la carga con QR
 *   POST /v1/compra/cargar {producto, reemplazar?} 200 {permiso}: el aviso de carga, antes de crear la orden de carga
 *        409 orden-abierta {orden} (una orden viva sin el recargo: se reemplaza solo con reemplazar:true)
 *        409 cargando {permiso, reintentarEn} (otro aviso dio el sí hace menos de 3 minutos)
 *        409 tope-de-avisos {permiso} (ya dio el sí 3 veces en 7 días para esta compra); el resto, en cargar
 *   POST /v1/compra/anular {producto} 200 {anulada:true, repetido}: la persona suelta la reserva de su compra cargada
 *        (no el recargo), hasta 30 minutos desde el último aviso de carga y como mucho dos veces en 7 días
 *        404 sin-compra   409 plazo-vencido | compra-en-curso {permiso} | orden-con-pago | tope-de-anulaciones
 *        502 red   400 producto
 *        Comunes: 401 sesion   403 otra-app   502 pollar   503 apagado   429 intentos {reintentarEn}
 *
 * El orden es siempre el mismo: primero todo lo que espera (la sesión con Pollar, la huella del código, la billetera,
 * la red) y después se escribe todo de una vez, sin ningún `await` en el medio: el objeto atiende de a uno mientras no
 * haya un `await`, así que dos pedidos a la vez no se pisan. La persona es el `userId` que dio Pollar, nunca lo que
 * diga el navegador.
 *
 * El piso de créditos: un canje nuevo (y, cuando exista, una orden nueva) pasa solo si los créditos de Pollar, menos lo
 * que suma, no quedan por debajo de lo ya prometido (`piso`). Si no, `503 altas-pausadas` sin gastar el cupón. Lo ya
 * canjeado nunca se frena: el canje repetido, el estado y el sello no miran el piso.
 *
 * Solo en mainnet con `ALTAS=1`: en testnet las rutas no existen (`atenderAlta` devuelve null) y con `ALTAS=0` dan
 * `503 apagado`. La bitácora nunca lleva el token, el id de la persona, el código ni la cuenta.
 */
import { type Altas, huella, normalizar, SECRETO_MINIMO } from "./altas";
import { AJUSTE_VENTA_PAUSADA, type Cobros, type FilaOrden, type LectorDeCobros, enlaceDePago, estaCerrada, memoIdDe, normalizarOrden, notaDe, puedeHonrarse, usdcTexto } from "./cobros";
import { AVISOS_POR_COMPRA, COMPRAS_POR_PERSONA_DIA, type ComprasQr, FIRMAS_POR_COMPRA, type FilaCompra } from "./compras";
import { type Config, type Producto, grupoDeIp } from "./config";
import { type Cupos, type FilaAlta, type Quedan } from "./cupos";
import { cors, json, origenPermitido } from "./http";
import { type Creditos, type MemoriaCreditos, type Pollar, type Sesion, formaDeToken } from "./pollar";
import { type PorIp, cupoPorHora } from "./por-ip";
import type { Red } from "./red";
import type { Respuesta } from "./servicio";
import { FIRMAS_SIN_EXPLICAR_MAX, contarFirmas, patrocinioEsperado } from "./vigilancia";

/** Códigos fallidos por persona y por hora. Pasado esto, 429 hasta que pase la hora. */
export const FALLIDOS_POR_USUARIO_HORA = 5;
/**
 * Códigos fallidos por dirección y por hora (en un evento casi todos salen por la misma). Los suma solo un código que no
 * vale en `/v1/alta/cupon`, y frena solo el canje: `/v1/alta/estado` no adivina nada y nunca se traba por dirección.
 */
export const FALLIDOS_POR_IP_HORA = 200;
/**
 * Tokens con forma de token que Pollar rechazó (inventados, vencidos o de la app de Prueba), por dirección y por hora.
 * Pasado esto, a un token nuevo de esa dirección ya no se le pregunta a Pollar. Nunca frena a una sesión que Pollar ya
 * dio por buena (`Pollar.conocida`). Lo que no tiene forma de token, o falta, no cuenta: ni llega a Pollar.
 */
export const TOKENS_NUEVOS_POR_IP_HORA = 200;
/**
 * Pedidos a `/v1/alta/*` por dirección y por hora, en la puerta del Worker (en memoria de cada nodo). Es para todo un
 * stand junto, que sale por la misma wifi: el freno de lo que se adivina son los topes de intentos, no este.
 */
export const ALTAS_POR_IP_HORA = 3000;
/** Lo que el piso guarda siempre, en créditos de Pollar, encima de lo prometido. */
export const PISO_BASE = 300;
/** El ajuste con el que se pausan las altas a mano (`"1"`). */
export const AJUSTE_PAUSA = "altas_pausadas";
/** El ajuste donde vive el último saldo de créditos leído, para que sobreviva a un reinicio del objeto. */
export const AJUSTE_CREDITOS = "creditos_ultimo";
/** Cada cuánto se le puede pedir a Pollar que abra la cuenta de una misma persona (`/v1/alta/abrir`). */
export const ESPERA_ABRIR_MS = 60_000;
/** La ventana de la vigilancia de firmas: las últimas 24 horas. */
const VENTANA_FIRMAS_MS = 86_400_000;

/** Por qué se pausó algo nuevo: el piso, Pollar sin responder (sin un saldo reciente) o a mano. */
export type MotivoPausa = "piso" | "creditos" | "a-mano";

/** El último saldo leído, guardado en los ajustes del objeto (`creditos_ultimo`). Lo que no se entiende no es un saldo. */
export function memoriaEnAjustes(cupos: Pick<Cupos, "ajuste" | "fijarAjuste">): MemoriaCreditos {
  return {
    leer() {
      try {
        const o = JSON.parse(cupos.ajuste(AJUSTE_CREDITOS) ?? "null") as { valor?: unknown; ms?: unknown } | null;
        return o && typeof o.valor === "number" && Number.isFinite(o.valor) && typeof o.ms === "number" && Number.isFinite(o.ms) ? { valor: o.valor, ms: o.ms } : null;
      } catch {
        return null;
      }
    },
    guardar(valor, ms) {
      cupos.fijarAjuste(AJUSTE_CREDITOS, JSON.stringify({ valor, ms }), ms);
    },
  };
}

/** Lo más que se acepta de cuerpo: `{"cupon":"…"}` pesa menos de 100 bytes. */
const MAX_CUERPO = 2 * 1024;
const HORA_MS = 3_600_000;

type Registrar = (evento: string, datos?: Record<string, string | number>) => void;
const r = (estado: number, cuerpo: Record<string, unknown>): Respuesta => ({ estado, cuerpo });

/** Fallidos por clave en una ventana de una hora desde el primero, en memoria del objeto. */
export class Intentos {
  private readonly cuentas = new Map<string, { n: number; vence: number }>();
  constructor(
    private readonly tope: number,
    private readonly reloj: () => number,
  ) {}

  /** Hasta cuándo está trabada la clave (ms), o null si puede seguir. */
  trabado(clave: string): number | null {
    const f = this.cuentas.get(clave);
    return f && f.vence > this.reloj() && f.n >= this.tope ? f.vence : null;
  }

  fallo(clave: string): void {
    const ahora = this.reloj();
    const f = this.cuentas.get(clave);
    if (f && f.vence > ahora) {
      f.n += 1;
      return;
    }
    if (this.cuentas.size > 5000) for (const [k, v] of this.cuentas) if (v.vence <= ahora) this.cuentas.delete(k);
    this.cuentas.set(clave, { n: 1, vence: ahora + HORA_MS });
  }
}

/** Lo que llega del Worker al objeto: el token (de la cabecera), la dirección y el cuerpo ya leído. */
export interface PedidoAlta {
  token: string | null;
  ip: string;
  cuerpo: unknown;
}

export type AccionAlta = "estado" | "cupon" | "abrir";
/** Las rutas del pago (`/v1/alta/orden` y `/v1/alta/pago`): van aparte para que lo de los cupones no cambie. */
export type AccionPago = "orden" | "pago";

/** Lo que el canje no deja pasar porque alguien probó un código: cuenta como fallido. */
const FALLIDOS = new Set(["cupon-no-existe", "cupon-vencido", "cupon-anulado", "cupon-usado", "lote-usado"]);
const ESTADO_DEL_ERROR: Record<string, number> = {
  "cupon-no-existe": 404,
  "cupon-vencido": 410,
  "cupon-anulado": 410,
  "cupon-usado": 409,
  "lote-usado": 409,
  "cuenta-de-otro": 409,
  "altas-pausadas": 503,
};

export interface DependenciasAltas {
  cfg: Config;
  cupos: Cupos;
  altas: Altas;
  /** Null si falta la llave de Pollar o la app: entonces las rutas dan `503 apagado`. */
  pollar: Pollar | null;
  /** `CUPON_SECRETO`. Sin él (o con menos de 32 caracteres) no hay huella y las rutas dan `503 apagado`. */
  cuponSecreto: string | null;
  /** Para saber si la cuenta ya existe en la red (se activó). */
  red: Pick<Red, "leerCuenta">;
  reloj?: () => number;
  registrar?: Registrar;
  /** Las órdenes y los pagos. Sin esto (o sin `CUENTA_COBROS`), `/orden` y `/pago` dan `503 pago-apagado`. */
  cobros?: Cobros | null;
  /** Quien lee los pagos en Horizon. */
  lector?: LectorDeCobros | null;
  /** La compra con QR: los permisos, la reserva y la lista del piloto. Sin esto, `/v1/compra/*` da `503 compras-cerradas`. */
  compras?: ComprasQr | null;
}

/** Las rutas de la compra con QR (`/v1/compra/empezar`, `/v1/compra/cargar` y `/v1/compra/anular`). */
export type AccionCompra = "empezar" | "cargar" | "anular";

/**
 * Cuánto tiene la persona para anular su compra desde que avisó la carga: lo que tarda en fallar la orden de carga
 * después del aviso, con margen. Pasado esto, la anula solo administración.
 */
export const ANULAR_COMPRA_MS = 30 * 60_000;
/**
 * Entre dos avisos de carga de la misma compra: a menos de esto del último que dio el sí, otro aviso da `409 cargando`.
 * Así dos equipos de la misma persona (o dos pestañas sin un candado en común) no crean dos órdenes de carga con dos QR.
 */
export const AVISO_ESPERA_MS = 3 * 60_000;
/** Los productos que puede nombrar `/v1/compra/anular`, se vendan hoy o no. */
const PRODUCTOS_DE_COMPRA: ReadonlySet<string> = new Set(["alta", "p10", "p50"]);

/** Por qué no se da (o no sigue) una compra con QR. */
export type MotivoCompra = "compras-cerradas" | "fondeo-diferido" | "fuera-del-piloto" | "tope-del-dia" | "sin-lugar" | "ya-tiene-acceso" | "compra-en-curso" | "producto";

const ESTADO_DE_COMPRA: Record<MotivoCompra, number> = {
  "compras-cerradas": 503,
  "fondeo-diferido": 503,
  "fuera-del-piloto": 503,
  "tope-del-dia": 503,
  "sin-lugar": 503,
  "ya-tiene-acceso": 409,
  "compra-en-curso": 409,
  producto: 400,
};

/** Qué haría el permiso de empezar, sin escribir nada: devolver el abierto, renovar uno cargado o dar uno nuevo. */
type EvaluacionCompra =
  | { ok: true; accion: "devolver"; compra: FilaCompra }
  | { ok: true; accion: "renovar"; compra: FilaCompra; reserva: number }
  | { ok: true; accion: "dar"; reserva: number; recargo: number; primera: boolean; nueva: boolean; cerrar: FilaCompra | null }
  | { ok: false; motivo: MotivoCompra; compra?: FilaCompra };

export class PuertaAltas {
  private readonly reloj: () => number;
  private readonly registrar: Registrar;
  private readonly porUsuario: Intentos;
  /** Códigos fallidos por dirección: frenan solo el canje. */
  private readonly codigosPorIp: Intentos;
  /** Tokens nuevos que Pollar rechazó, por dirección: deciden solo si se le pregunta a Pollar por otro token nuevo. */
  private readonly tokensPorIp: Intentos;
  /** Cuándo se le pidió a Pollar abrir la cuenta de cada alta, para hacerlo como mucho una vez por minuto. */
  private readonly aperturas = new Map<string, number>();

  constructor(private readonly d: DependenciasAltas) {
    this.reloj = d.reloj ?? (() => Date.now());
    this.registrar = d.registrar ?? (() => {});
    this.porUsuario = new Intentos(FALLIDOS_POR_USUARIO_HORA, this.reloj);
    this.codigosPorIp = new Intentos(FALLIDOS_POR_IP_HORA, this.reloj);
    this.tokensPorIp = new Intentos(TOKENS_NUEVOS_POR_IP_HORA, this.reloj);
  }

  /** null si se puede atender; si no, el 503 que corresponde. */
  private apagado(): Respuesta | null {
    const { cfg, pollar, cuponSecreto } = this.d;
    if (cfg.red !== "mainnet" || !cfg.altas) return r(503, { motivo: "apagado" });
    if (!pollar || !cfg.pollarAppId || !cfg.pollarFondeo || !cuponSecreto || cuponSecreto.length < SECRETO_MINIMO) return r(503, { motivo: "apagado", detalle: "config" });
    return null;
  }

  /**
   * La sesión de la persona, preguntada a Pollar.
   *
   * - Sin token, o con algo que no tiene forma de token: `401 sesion` sin preguntar ni contar nada. No le cuesta nada a
   *   nadie y no adivina nada, así que no puede trabar una dirección.
   * - Una sesión que Pollar ya dio por buena (`conocida`) nunca se traba por dirección: en un evento todos salen por la misma.
   * - Un token nuevo que Pollar rechaza suma en `tokensPorIp`; pasado su tope, a otro token nuevo de esa dirección ya no
   *   se le pregunta (`429 intentos`) hasta que pase la hora.
   */
  private async sesion(token: string | null, ip: string): Promise<{ ok: true; s: Extract<Sesion, { ok: true }> } | { ok: false; r: Respuesta }> {
    if (!formaDeToken(token, this.reloj())) return { ok: false, r: r(401, { motivo: "sesion" }) };
    const pollar = this.d.pollar as Pollar;
    const grupo = grupoDeIp(ip);
    const conocida = await pollar.conocida(token);
    if (!conocida) {
      const trabada = this.tokensPorIp.trabado(grupo);
      if (trabada !== null) return { ok: false, r: r(429, { motivo: "intentos", reintentarEn: trabada }) };
    }
    const s = await pollar.verificar(token);
    if (s.ok && !s.usuario.startsWith("cuenta:")) return { ok: true, s };
    if (s.ok || s.motivo === "pollar") return { ok: false, r: r(502, { motivo: "pollar" }) };
    if (!conocida) this.tokensPorIp.fallo(grupo);
    return { ok: false, r: s.motivo === "otra-app" ? r(403, { motivo: "otra-app" }) : r(401, { motivo: "sesion" }) };
  }

  /**
   * La cuenta de Stellar de la persona: la que ya tiene atada su alta, la que trae el verify o, si no, la de su fila en
   * `users`. `ok: false` si Pollar no contesta o no se puede saber sin dudas (no se ata nada a ciegas).
   */
  private async cuentaDe(s: Extract<Sesion, { ok: true }>, alta: FilaAlta | null): Promise<{ ok: true; cuenta: string | null } | { ok: false }> {
    if (alta?.cuenta) return { ok: true, cuenta: alta.cuenta };
    if (s.cuenta) return { ok: true, cuenta: s.cuenta };
    return (this.d.pollar as Pollar).billeteraDe(s.usuario);
  }

  /**
   * El alta ya tiene su cuenta atada y Pollar dice, en esta sesión, que la billetera de la persona es otra: el acceso no
   * le sirve a esta cuenta (el sitio sella, activa y pregunta el cupo con la de la sesión). `409 cuenta-de-otro`, sin
   * escribir nada; se revisa a mano. Sin la billetera en el verify, vale la atada, como siempre. La usan `/estado` y
   * `/cupon`: un canje que contestara por la atada le diría al sitio que active una cuenta que no está en el libro.
   */
  private cuentaDeOtro(s: Extract<Sesion, { ok: true }>): Respuesta | null {
    const atada = this.d.cupos.altaDe(s.usuario)?.cuenta ?? null;
    if (!atada || !s.cuenta || s.cuenta === atada) return null;
    this.registrar("error-alta", { motivo: "cuenta-de-otro" });
    return r(409, { motivo: "cuenta-de-otro" });
  }

  /** Si la cuenta ya existe en la red. Si la red no contesta, se toma como que no: lo peor es pedir una activación de más. */
  private async abierta(cuenta: string | null, alta: FilaAlta | null): Promise<boolean> {
    if (!cuenta) return false;
    if (alta?.estado === "abierta") return true;
    try {
      return (await this.d.red.leerCuenta(cuenta)) !== null;
    } catch {
      return false;
    }
  }

  /** El alta que le da acceso: la suya o, si administración admitió su cuenta a mano, esa. */
  private altaQueVale(usuario: string, cuenta: string | null): FilaAlta | null {
    const suya = this.d.cupos.altaDe(usuario);
    if (suya) return suya;
    return cuenta ? this.d.cupos.altaDe(`cuenta:${cuenta}`) : null;
  }

  private sorteos(usuario: string, cuenta: string | null, ahora: number): { quedan: number; proximoVence: Quedan["proximoVence"] } {
    const q = this.d.cupos.quedan(cuenta && this.d.cupos.estaEnElLibro(cuenta) ? { cuenta } : { usuario }, ahora);
    return { quedan: q.quedan, proximoVence: q.proximoVence };
  }

  /**
   * El piso de créditos ahora: `CREDITOS_POR_SORTEO` por cada sorteo prometido sin usar ni vencer, más
   * `CREDITOS_POR_ALTA` por cada alta sin activar, más `PISO_BASE`. Síncrono: se puede llamar adentro de una transacción.
   */
  piso(ahora: number): number {
    const p = this.d.cupos.prometido(ahora);
    return this.d.cfg.creditosPorSorteo * p.sorteos + this.d.cfg.creditosPorAlta * p.altas + PISO_BASE;
  }

  /**
   * Los créditos reservados por las compras con QR en curso (`ComprasQr.reservas`): lo que su carga puede gastar y lo
   * que su paquete promete. Van encima del piso para todo lo nuevo, así un canje o una orden no se comen lo que necesita
   * alguien con su dinero en camino.
   */
  reservasCompras(ahora: number): number {
    return this.d.compras?.reservas(ahora) ?? 0;
  }

  /**
   * Si algo nuevo que promete `costo` créditos tiene que esperar: pausado a mano, sin un saldo reciente de Pollar o con
   * el saldo, menos el costo, por debajo del piso más las reservas de las compras con QR cargadas (las de quien tiene su
   * dinero en camino; una compra sin cargar no frena un canje del evento) más `extra`. Lo nuevo de la venta (una orden)
   * pasa en `extra` la reserva del evento (`RESERVA_CARGA_CREDITOS`); el canje de un cupón no, porque esa reserva es para
   * él. null si puede seguir. Síncrono, para llamarlo en la misma jugada que escribe (así dos canjes a la vez no se
   * apoyan en el mismo margen).
   */
  pausa(creditos: Creditos, costo: number, ahora: number, extra = 0): MotivoPausa | null {
    if (this.d.cupos.ajuste(AJUSTE_PAUSA) === "1") return "a-mano";
    if (!creditos.ok) return "creditos";
    return creditos.disponibles - costo < this.piso(ahora) + (this.d.compras?.reservas(ahora, true) ?? 0) + extra ? "piso" : null;
  }

  /**
   * Si una orden nueva queda fuera del piloto. Mientras haya una lista puesta, la cuenta tiene que estar en ella: la
   * lista está puesta con cuentas en `COMPRAS_QR_PILOTO` y también, con la variable vacía, con al menos una cuenta sumada
   * por administración. Con la variable mal escrita, o `todos` sin confirmar, no entra nadie. Con `todos` confirmado, o
   * sin ninguna lista (la variable vacía y nadie sumado a mano), la orden no mira el piloto. Síncrono.
   */
  private fueraDelPiloto(cuenta: string | null): boolean {
    const { cfg, compras } = this.d;
    if (cfg.pilotoEnVariable === "ninguna") return !cfg.comprasQrTodos && !!compras && compras.hayPilotoAMano() && !compras.enPiloto(cuenta);
    if (cfg.pilotoEnVariable === "mal" || !compras) return true;
    return !compras.enPiloto(cuenta);
  }

  /**
   * Para `/v1/patrocinio/estado`: el saldo de créditos, el piso y la diferencia. Sin saldo reciente, null. Con la compra
   * con QR prendida (o con alguna en curso), también lo reservado por esas compras (`reservasCompras`), que va encima
   * del piso: la vigilancia avisa si los créditos no lo cubren.
   */
  async resumen(): Promise<Record<string, unknown>> {
    if (this.d.cfg.red !== "mainnet" || !this.d.cfg.altas) return {};
    const creditos = this.d.pollar ? await this.d.pollar.creditos() : ({ ok: false } as const);
    const ahora = this.reloj();
    const piso = this.piso(ahora);
    const reservas = this.reservasCompras(ahora);
    const falta = this.faltaAltas();
    const pendientes = this.d.compras?.pendientes() ?? 0;
    return {
      creditos: creditos.ok ? creditos.disponibles : null,
      creditosLeidos: creditos.ok ? creditos.leido : null,
      piso,
      margen: creditos.ok ? creditos.disponibles - piso : null,
      altasPausadas: this.d.cupos.ajuste(AJUSTE_PAUSA) === "1",
      ...(this.d.cfg.comprasQr || reservas > 0 ? { reservasCompras: reservas } : {}),
      // Lo que de verdad queda para los canjes: el margen menos lo reservado por las compras en curso.
      ...(this.d.cfg.comprasQr || reservas > 0 ? { margenLibre: creditos.ok ? creditos.disponibles - piso - reservas : null } : {}),
      ...(falta.length ? { faltaAltas: falta } : {}),
      // Las compras cargadas sin pagar: cada una lleva su recargo en las órdenes de esa persona hasta que se pague o se anule.
      ...(this.d.cfg.comprasQr || pendientes > 0 ? { recargosPendientes: pendientes } : {}),
    };
  }

  /**
   * Lo que se prendió de las altas y no se puede usar, por su nombre fijo y sin valores: las variables mal escritas
   * (`Config.faltaAltas`) y los secretos que faltan. Vacío si todo está en orden. La vigilancia lo avisa.
   */
  private faltaAltas(): string[] {
    const { cfg, pollar, cuponSecreto } = this.d;
    return [
      ...cfg.faltaAltas,
      ...(pollar ? [] : ["pollar-llave"]),
      ...(cuponSecreto && cuponSecreto.length >= SECRETO_MINIMO ? [] : ["cupon-secreto"]),
      ...(this.sinColumnas() ? ["columnas-nuevas"] : []),
    ];
  }

  /**
   * Si al arrancar no se pudo sumar una columna nueva (`Cupos.columnasQueFaltan`): la venta queda cerrada (ni compra con
   * QR, ni orden nueva, ni carga) y el estado lo dice con `columnas-nuevas`. Lo del evento sigue como siempre.
   */
  private sinColumnas(): boolean {
    return this.d.cupos.columnasQueFaltan().length > 0;
  }

  /**
   * `GET /v1/carga/cupo`: si la carga con QR está abierta. Solo con `CARGAS=1`, la configuración de las altas completa,
   * las altas sin pausar y una lectura de créditos de Pollar que valga (la misma del piso: de menos de 60 segundos, o la
   * última de 10 minutos con Pollar caído) por encima del piso, las reservas de las compras con QR en curso y
   * `RESERVA_CARGA_CREDITOS`. Ante cualquier duda, no.
   */
  async cargaAbierta(): Promise<boolean> {
    const { cfg, cupos, pollar } = this.d;
    if (!cfg.cargas || this.apagado() || !pollar || this.sinColumnas()) return false;
    if (cupos.ajuste(AJUSTE_PAUSA) === "1") return false;
    const creditos = await pollar.creditos();
    if (!creditos.ok || !Number.isFinite(creditos.disponibles)) return false;
    const ahora = this.reloj();
    return creditos.disponibles > this.piso(ahora) + this.reservasCompras(ahora) + cfg.reservaCargaCreditos;
  }

  private sigue(cuenta: string | null, abierta: boolean): "crear-billetera" | "abrir" | "activar" | "lista" {
    if (!cuenta) return "crear-billetera";
    if (abierta) return "lista";
    return this.d.cfg.pollarFondeo === "diferido" ? "abrir" : "activar";
  }

  async atender(accion: AccionAlta, p: PedidoAlta): Promise<Respuesta> {
    return accion === "cupon" ? this.cupon(p) : accion === "abrir" ? this.abrir(p) : this.estado(p);
  }

  /**
   * Para `/v1/patrocinio/estado`: la vigilancia de firmas de las últimas 24 horas. `firmasSinExplicar` son las firmas que
   * cobró Pollar (`cosign.signature` en los movimientos de los créditos) menos las que explican nuestros números
   * (`Cupos.firmasExplicadas`, y de la compra con QR, `ComprasQr.firmas`), nunca menos de cero; null si Pollar no
   * contestó (nunca cero por no saber). `completo: false` si vino la página llena de movimientos: lo cobrado es lo menos.
   * `patrocinioPollar` dice si el patrocinio de la app está todo apagado salvo `PATROCINIO_PERMITIDO`, como se espera, y
   * qué está prendido sin permiso. Pasado el tope, o con algo prendido sin permiso, queda en la bitácora (solo cifras).
   * Va aparte de `resumen`, que es lo del piso.
   */
  async vigilancia(): Promise<Record<string, unknown>> {
    const { cfg, cupos, pollar } = this.d;
    if (cfg.red !== "mainnet" || !cfg.altas) return {};
    const desde = this.reloj() - VENTANA_FIRMAS_MS;
    const [mov, pat] = pollar ? await Promise.all([pollar.movimientos(desde), pollar.patrocinio()]) : ([{ ok: false }, { ok: false }] as const);
    const e = cupos.firmasExplicadas(desde, { sorteos: !cfg.sorteoServidor });
    // La compra con QR: hasta 9 firmas por compra con movimiento en el día y una por cada pago con el saldo propio.
    const q = this.d.compras?.firmas(desde) ?? { compras: 0, pagosConSaldo: 0 };
    const explicadas = e.sellos + e.sorteos + e.activaciones + FIRMAS_POR_COMPRA * q.compras + q.pagosConSaldo;
    const cobradas = mov.ok ? contarFirmas(mov.movimientos, desde) : null;
    const sinExplicar = cobradas ? Math.max(0, cobradas.firmas - explicadas) : null;
    const patrocinio = pat.ok ? patrocinioEsperado(pat.banderas, cfg.patrocinioPermitido) : null;
    if (sinExplicar !== null && sinExplicar > FIRMAS_SIN_EXPLICAR_MAX) this.registrar("error-firmas", { sinExplicar, completo: cobradas?.completo ? 1 : 0 });
    if (patrocinio && !patrocinio.esperado) this.registrar("error-patrocinio", { prendidos: patrocinio.prendidos.length });
    return {
      firmasSinExplicar: sinExplicar,
      firmas: { cobradas: cobradas?.firmas ?? null, explicadas, ...e, ...q, completo: cobradas?.completo ?? null, desde },
      patrocinioPollar: patrocinio,
    };
  }

  /**
   * `POST /v1/alta/abrir` (fase 2, con `POLLAR_FONDEO=diferido`): le pide a Pollar que abra la cuenta de Stellar de quien
   * ya tiene acceso (`wallets/fund`), que queda como un pedido que la persona aprueba en su sesión. La cuenta es la que
   * dice Pollar para esta persona, nunca la del navegador. Sin acceso no se llama a nadie (`403 sin-acceso`); sin
   * billetera todavía, `409 sin-billetera`; con la cuenta ya en la red, `abierta`; con fondeo inmediato, Pollar la abre al
   * entrar y no hace falta. A Pollar se le pide como mucho una vez por minuto por alta (`429 espera`). No mira el piso:
   * es de quien ya canjeó o pagó, y eso nunca se frena.
   */
  async abrir(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cuenta = c.cuenta;
    if (!this.altaQueVale(usuario, cuenta)) return r(403, { motivo: "sin-acceso" });
    if (!cuenta) return r(409, { motivo: "sin-billetera" });
    const abierta = await this.abierta(cuenta, suya ?? this.d.cupos.altaDe(`cuenta:${cuenta}`));

    // Desde acá hasta llamar a Pollar, sin await: atar, mirar la espera y anotarla es una sola jugada.
    const ahora = this.reloj();
    const alta = this.altaQueVale(usuario, cuenta);
    if (!alta) return r(403, { motivo: "sin-acceso" });
    const atado = this.d.cupos.transaccion(() => {
      const a = alta.usuario === usuario && (alta.cuenta === null || !this.d.cupos.estaEnElLibro(cuenta)) ? this.d.cupos.atar(usuario, cuenta, ahora) : "ok";
      if (a === "ok" && abierta) this.d.cupos.marcarAbierta(alta.usuario, ahora);
      return a;
    });
    if (atado === "cuenta-de-otro") {
      this.registrar("error-alta", { motivo: "cuenta-de-otro" });
      return r(409, { motivo: "cuenta-de-otro" });
    }
    if (abierta) return r(200, { estado: "abierta" });
    if (this.d.cfg.pollarFondeo !== "diferido") return r(200, { estado: "no-hace-falta" });
    const antes = this.aperturas.get(alta.usuario);
    if (antes !== undefined && ahora - antes < ESPERA_ABRIR_MS) return r(429, { motivo: "espera", reintentarEn: antes + ESPERA_ABRIR_MS });
    if (this.aperturas.size > 5000) for (const [k, v] of this.aperturas) if (ahora - v >= ESPERA_ABRIR_MS) this.aperturas.delete(k);
    this.aperturas.set(alta.usuario, ahora);

    const res = await (this.d.pollar as Pollar).abrir(cuenta);
    this.registrar("alta-abrir", { resultado: res.ok ? res.estado : res.motivo });
    if (!res.ok) return res.motivo === "sin-creditos" ? r(503, { motivo: "sin-creditos" }) : res.motivo === "sin-billetera" ? r(409, { motivo: "sin-billetera" }) : r(502, { motivo: "pollar" });
    // Pollar dice que ya está abierta: el próximo `/estado` la marca al verla en la red.
    if (res.estado === "abierta") return r(200, { estado: "abierta" });
    this.d.cupos.marcarPedida(alta.usuario, res.pedido, this.reloj());
    return r(200, { estado: "pedido" });
  }

  /**
   * `POST /v1/alta/estado`: qué acceso tiene la persona y cuántos sorteos oficiales le quedan. Si tiene alta y la cuenta
   * todavía no estaba atada, la ata y la mete en el libro. Si ya estaba atada y Pollar dice otra en esta sesión,
   * `409 cuenta-de-otro`, sin escribir nada.
   */
  async estado(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const otra = this.cuentaDeOtro(ses.s);
    if (otra) return otra;
    await this.leerPagosDe(usuario);
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cuenta = c.cuenta;
    const abierta = await this.abierta(cuenta, suya ?? (cuenta ? this.d.cupos.altaDe(`cuenta:${cuenta}`) : null));
    // La compra con QR: los créditos se leen solo si la persona podría empezar una (prendida y en el piloto).
    const conCompra = this.d.compras && (this.d.cfg.comprasQr || this.d.compras.tuvo(usuario));
    const creditos = conCompra && this.compraCerrada() === null && this.d.compras?.enPiloto(cuenta) && this.d.pollar ? await this.d.pollar.creditos() : ({ ok: false } as const);

    // Desde acá, sin await: leer y escribir es una sola jugada.
    const ahora = this.reloj();
    const alta = this.altaQueVale(usuario, cuenta);
    if (alta && cuenta) {
      const atado = this.d.cupos.transaccion(() => {
        const a = alta.usuario === usuario && (alta.cuenta === null || !this.d.cupos.estaEnElLibro(cuenta)) ? this.d.cupos.atar(usuario, cuenta, ahora) : "ok";
        if (a === "ok" && abierta) this.d.cupos.marcarAbierta(alta.usuario, ahora);
        return a;
      });
      if (atado === "cuenta-de-otro") {
        this.registrar("error-alta", { motivo: "cuenta-de-otro" });
        return r(409, { motivo: "cuenta-de-otro" });
      }
    }
    const final = alta ? this.d.cupos.altaDe(alta.usuario) : null;
    return r(200, {
      acceso: final ? final.motivo : "ninguno",
      cuenta,
      abierta,
      pedido: final?.pedido ?? null,
      sorteos: this.sorteos(usuario, cuenta, ahora),
      orden: this.ordenAbierta(usuario, ahora),
      fondeo: this.d.cfg.pollarFondeo,
      ...(conCompra ? { compraQr: this.compraQrDe(usuario, cuenta, creditos, ahora) } : {}),
    });
  }

  // ---------- la compra con QR ----------

  /** Si la compra con QR no se puede abrir por algo que no cambia hoy: apagada, a medio configurar o con fondeo diferido. */
  private compraCerrada(): "compras-cerradas" | "fondeo-diferido" | null {
    const { cfg, compras, cobros, lector } = this.d;
    if (!compras || !cobros || !lector || this.sinColumnas()) return "compras-cerradas";
    return compraCerradaDe(cfg);
  }

  /**
   * Lo que haría el permiso de empezar para esta persona y este producto, sin escribir nada. Síncrono: se llama en la
   * misma jugada que escribe, así dos pedidos a la vez no reservan dos veces. En este orden: la compra con QR abierta, el
   * producto, el acceso (el primer paquete es para quien no lo tiene), el piloto, la compra en curso (la misma se
   * devuelve; una cargada que dejó de reservar se renueva; otra cargada frena; otra sin cargar se cierra), el tope de
   * personas nuevas del día y, al final, los créditos: tienen que superar el piso, las reservas abiertas,
   * `RESERVA_CARGA_CREDITOS` y la reserva de esta compra.
   */
  private evaluarCompra(usuario: string, cuenta: string | null, producto: Producto | undefined, creditos: Creditos, ahora: number): EvaluacionCompra {
    const cerrada = this.compraCerrada();
    if (cerrada) return { ok: false, motivo: cerrada };
    const { cfg, cupos } = this.d;
    const compras = this.d.compras as ComprasQr;
    const recargo = cfg.recargoQr as NonNullable<Config["recargoQr"]>;
    if (!producto) return { ok: false, motivo: "producto" };
    if (producto.id === "alta" && this.altaQueVale(usuario, cuenta)) return { ok: false, motivo: "ya-tiene-acceso" };
    if (!compras.enPiloto(cuenta)) return { ok: false, motivo: "fuera-del-piloto" };
    const activa = compras.activa(usuario, ahora);
    const reservaDe = (primera: boolean) => compras.reservaDe({ producto, primera, altaNueva: cupos.altaDe(usuario) === null, creditosPorSorteo: cfg.creditosPorSorteo, creditosPorAlta: cfg.creditosPorAlta });
    // Una compra sin cargar de otro producto se cierra al dar la nueva: su reserva no cuenta contra la nueva.
    const seLibera = activa && activa.producto !== producto.id && activa.cargada === null && compras.reservando(activa, ahora) ? activa.reserva : 0;
    const hayLugar = (reserva: number) =>
      cupos.ajuste(AJUSTE_PAUSA) !== "1" &&
      cupos.ajuste(AJUSTE_VENTA_PAUSADA) !== "1" &&
      creditos.ok &&
      Number.isFinite(creditos.disponibles) &&
      creditos.disponibles > this.piso(ahora) + this.reservasCompras(ahora) - seLibera + cfg.reservaCargaCreditos + reserva;
    if (activa && activa.producto === producto.id) {
      // Mientras reserva (7 días desde el permiso o desde la carga) se devuelve la misma: renovarla la contaría dos veces.
      if (compras.reservando(activa, ahora)) return { ok: true, accion: "devolver", compra: activa };
      const reserva = reservaDe(activa.primera);
      return hayLugar(reserva) ? { ok: true, accion: "renovar", compra: activa, reserva } : { ok: false, motivo: "sin-lugar" };
    }
    if (activa && activa.cargada !== null) return { ok: false, motivo: "compra-en-curso", compra: activa };
    const nueva = !compras.tuvo(usuario);
    // Cada compra que se da cuenta, también un cambio de producto: el tope de todos y el de la persona.
    if (compras.empezadasHoy(ahora) >= cfg.comprasQrDia || compras.empezadasHoyPor(usuario, ahora) >= COMPRAS_POR_PERSONA_DIA) return { ok: false, motivo: "tope-del-dia" };
    const primera = !compras.pagoLaPrimera(usuario);
    const reserva = reservaDe(primera);
    if (!hayLugar(reserva)) return { ok: false, motivo: "sin-lugar" };
    return { ok: true, accion: "dar", reserva, recargo: primera ? recargo.primera : recargo.siguientes, primera, nueva, cerrar: activa };
  }

  /**
   * Lo que `/v1/alta/estado` dice de la compra con QR: si podría empezar una ahora (`puede`, la lectura en vivo del
   * permiso de empezar, sin reservar nada, para el producto de su compra en curso o el que le toca: el primer paquete sin
   * acceso, el de diez con acceso), por qué no (`motivo`), la compra en curso (`abierta`), si alguna vez tuvo una
   * (`terminar`, el permiso de terminar, que no vence) y lo mínimo en bolivianos de una carga (`minimoBs`).
   */
  private compraQrDe(usuario: string, cuenta: string | null, creditos: Creditos, ahora: number): Record<string, unknown> {
    const compras = this.d.compras as ComprasQr;
    const activa = compras.activa(usuario, ahora);
    const precios = this.d.cfg.precios ?? [];
    const id = activa?.producto ?? (this.altaQueVale(usuario, cuenta) ? precios.find((p) => p.id !== "alta")?.id : "alta");
    const e = this.evaluarCompra(usuario, cuenta, precios.find((p) => p.id === id), creditos, ahora);
    const pendiente = compras.pendiente(usuario);
    return {
      puede: e.ok,
      motivo: e.ok ? null : e.motivo === "producto" ? "compras-cerradas" : e.motivo,
      abierta: activa ? compras.vista(activa) : null,
      terminar: compras.tuvo(usuario),
      minimoBs: this.d.cfg.cargaMinimoBs,
      // El recargo que va en toda orden suya mientras tenga una compra cargada sin pagar, o null.
      recargoPendiente: pendiente ? usdcTexto(pendiente.recargo) : null,
    };
  }

  async atenderCompra(accion: AccionCompra, p: PedidoAlta): Promise<Respuesta> {
    return accion === "cargar" ? this.cargar(p) : accion === "anular" ? this.anular(p) : this.empezar(p);
  }

  /**
   * `POST /v1/compra/empezar` `{producto}`: el permiso de empezar una compra con QR (ver `evaluarCompra`). Lo da, lo anota
   * con su hora y reserva sus créditos; si la persona ya tiene uno abierto de ese producto, devuelve el mismo sin
   * reservar de nuevo. `200 {permiso:{producto, desde, recargo, total, primera, cargada}}`. Lo que no: `503` con
   * `compras-cerradas`, `fondeo-diferido`, `fuera-del-piloto`, `tope-del-dia` o `sin-lugar`, `409 ya-tiene-acceso`,
   * `409 compra-en-curso {permiso}` (otra compra ya cargada) y `400 producto`.
   */
  async empezar(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    // Cerrada, se contesta sin preguntarle la sesión a Pollar.
    const cerrada = this.compraCerrada();
    if (cerrada) return r(503, { motivo: cerrada });
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const otra = this.cuentaDeOtro(ses.s);
    if (otra) return otra;
    const pedido = p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { producto?: unknown }).producto : undefined;
    const producto = typeof pedido === "string" ? this.d.cfg.precios?.find((x) => x.id === pedido) : undefined;
    if (!producto) return r(400, { motivo: "producto" });
    const c = await this.cuentaDe(ses.s, this.d.cupos.altaDe(usuario));
    if (!c.ok) return r(502, { motivo: "pollar" });
    const creditos = await (this.d.pollar as Pollar).creditos();

    // Desde acá, sin await: mirar todo, reservar y anotar es una sola jugada.
    const ahora = this.reloj();
    const compras = this.d.compras as ComprasQr;
    const res = this.d.cupos.transaccion((): { ok: true; compra: FilaCompra; evento: string | null } | { ok: false; motivo: MotivoCompra; compra?: FilaCompra } => {
      const e = this.evaluarCompra(usuario, c.cuenta, producto, creditos, ahora);
      if (!e.ok) return e;
      if (e.accion === "devolver") return { ok: true, compra: e.compra, evento: null };
      if (e.accion === "renovar") {
        compras.renovar(e.compra.id, e.reserva, ahora);
        return { ok: true, compra: compras.porId(e.compra.id) as FilaCompra, evento: "compra-renovada" };
      }
      if (e.cerrar) compras.cerrar(e.cerrar.id, "cambio", ahora);
      return { ok: true, compra: compras.dar({ usuario, producto: producto.id, reserva: e.reserva, recargo: e.recargo, primera: e.primera, nueva: e.nueva }, ahora), evento: "compra-permiso" };
    });
    if (!res.ok) {
      if (res.motivo === "sin-lugar" || res.motivo === "tope-del-dia") this.registrar("compra-pausa", { motivo: res.motivo });
      return r(ESTADO_DE_COMPRA[res.motivo], res.compra ? { motivo: res.motivo, permiso: compras.vista(res.compra) } : { motivo: res.motivo });
    }
    if (res.evento) this.registrar(res.evento, { producto: producto.id, primera: res.compra.primera ? 1 : 0, nueva: res.compra.nueva ? 1 : 0 });
    return r(200, { permiso: compras.vista(res.compra) });
  }

  /**
   * `POST /v1/compra/cargar` `{producto, reemplazar?}`: el sitio avisa que va a crear la orden de carga. Si no contesta
   * 200, el sitio no la crea. Desde este aviso el recargo queda atado a la persona hasta que se pague: toda orden suya lo
   * lleva, y sus órdenes sin pagar que no lo llevan se reemplazan (un pago que llegue con su nota va a los sueltos, salvo
   * uno que ya estaba en camino: ver `Cobros.atribuir`). Antes se leen los pagos nuevos. Si una de esas órdenes sigue
   * viva (sin vencer), no se reemplaza sin preguntar: la persona pudo haberla pagado desde otra app y el pago todavía no
   * llegó. Sin `reemplazar: true` en el cuerpo, `409 orden-abierta {orden}` (la más nueva, como la muestra `/estado`), y
   * no se carga. Pide la compra con QR abierta, la persona en el piloto y su permiso abierto de ese producto, que todavía
   * reserve (7 días desde el permiso o desde el primer aviso). Avisar otra vez es lo mismo, pasados `AVISO_ESPERA_MS`
   * desde el último aviso que dio el sí: antes, `409 cargando {permiso, reintentarEn}` (otro equipo o pestaña ya está
   * creando la orden de carga). Como mucho `AVISOS_POR_COMPRA` avisos que dan el sí por compra en 7 días: después,
   * `409 tope-de-avisos {permiso}` (la persona puede pagar su orden con el recargo por otro medio, o la anula quien
   * opera). `200 {permiso}`. Lo que no: `404 sin-permiso`, `409 permiso-vencido {permiso}`
   * (con `/v1/compra/empezar` se renueva), `409 compra-en-curso {permiso}`, `409 cargando {permiso, reintentarEn}`,
   * `409 ya-tiene-acceso`, `409 orden-con-pago` (una orden suya ya recibió algo), `409 orden-abierta {orden}`, `503` con
   * `compras-cerradas`, `fondeo-diferido` o `fuera-del-piloto`, `502 red` (Horizon no contestó y tiene órdenes sin pagar)
   * y `400 producto`.
   */
  async cargar(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    // Cerrada, se contesta sin preguntarle la sesión a Pollar.
    const cerrada = this.compraCerrada();
    if (cerrada) return r(503, { motivo: cerrada });
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const otra = this.cuentaDeOtro(ses.s);
    if (otra) return otra;
    const pedido = p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { producto?: unknown }).producto : undefined;
    const producto = typeof pedido === "string" ? this.d.cfg.precios?.find((x) => x.id === pedido) : undefined;
    if (!producto) return r(400, { motivo: "producto" });
    // Solo un `true` de verdad: la persona dijo que no pagó su orden de antes.
    const conReemplazo = p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { reemplazar?: unknown }).reemplazar === true : false;
    const c = await this.cuentaDe(ses.s, this.d.cupos.altaDe(usuario));
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cobros = this.d.cobros as Cobros;
    // Un pago que todavía no se leyó no tiene que quedar en una orden que se reemplaza: sin Horizon, no se carga.
    if (cobros.ordenesSinPagar(usuario).length && !(await (this.d.lector as LectorDeCobros).leer()).ok) return r(502, { motivo: "red" });

    // Desde acá, sin await: mirar, reemplazar y marcar la carga es una sola jugada.
    const ahora = this.reloj();
    const compras = this.d.compras as ComprasQr;
    if (!compras.enPiloto(c.cuenta)) return r(503, { motivo: "fuera-del-piloto" });
    if (producto.id === "alta" && this.altaQueVale(usuario, c.cuenta)) return r(409, { motivo: "ya-tiene-acceso" });
    const res = this.d.cupos.transaccion((): { estado: number; cuerpo: Record<string, unknown>; nueva?: boolean } => {
      const a = compras.activa(usuario, ahora);
      if (!a) return { estado: 404, cuerpo: { motivo: "sin-permiso" } };
      if (a.producto !== producto.id) return { estado: 409, cuerpo: { motivo: "compra-en-curso", permiso: compras.vista(a) } };
      if (!compras.reservando(a, ahora)) return { estado: 409, cuerpo: { motivo: "permiso-vencido", permiso: compras.vista(a) } };
      // Un aviso por vez: un 409 no corre la ventana, solo un sí.
      const ultimo = compras.ultimoAviso(a);
      if (ultimo !== null && ahora - ultimo < AVISO_ESPERA_MS) return { estado: 409, cuerpo: { motivo: "cargando", permiso: compras.vista(a), reintentarEn: ultimo + AVISO_ESPERA_MS } };
      // Cada sí deja crear otra orden de carga y la reserva cuenta una sola: como mucho AVISOS_POR_COMPRA en 7 días.
      if (compras.avisosDe(a.id, ahora) >= AVISOS_POR_COMPRA) return { estado: 409, cuerpo: { motivo: "tope-de-avisos", permiso: compras.vista(a) } };
      const viejas = cobros.ordenesSinPagar(usuario).filter((o) => cobros.recargoDe(o.id)?.compra !== a.id);
      if (viejas.some((o) => cobros.recibido(o.id) > 0)) return { estado: 409, cuerpo: { motivo: "orden-con-pago" } };
      // La más nueva que sigue viva: se pregunta antes de reemplazarla (`viejas` va de la más vieja a la más nueva).
      const viva = viejas.filter((o) => o.vence > ahora).at(-1);
      if (viva && !conReemplazo) return { estado: 409, cuerpo: { motivo: "orden-abierta", orden: this.resumenDeOrden(viva) } };
      for (const o of viejas) cobros.reemplazar(o.id, `compra:${a.id}`, ahora);
      const nueva = a.cargada === null;
      compras.marcarCargada(a.id, ahora);
      return { estado: 200, cuerpo: { permiso: compras.vista(compras.porId(a.id) as FilaCompra) }, nueva };
    });
    if (res.nueva) this.registrar("compra-cargada", { producto: producto.id });
    return r(res.estado, res.cuerpo);
  }

  /**
   * `POST /v1/compra/anular` `{producto}`: la persona suelta la RESERVA de su compra cargada, NO el recargo. El sitio lo
   * pide cuando la orden de carga falló después del aviso y no hubo QR (o el aviso terminó sin respuesta y la relectura
   * no encontró ninguna carga): así sus créditos dejan de estar apartados. La compra sigue abierta con su recargo
   * (`ComprasQr.soltarReserva`): toda orden suya lo lleva, del producto que sea, hasta que una se pague o la anule
   * administración (`cupones.mjs compra anular`), y reintentar es `empezar` (renueva esta misma compra) y `cargar`.
   * Después de anular, `/v1/alta/estado` trae `compraQr.abierta` con `cargada: true`, `compraQr.recargoPendiente` con el
   * recargo y `compraQr.puede` en true (ver `compras-anular-forma.test.ts`). Solo hasta `ANULAR_COMPRA_MS` desde el
   * último aviso que dio el sí, con ninguna orden suya con algo recibido y como mucho `ANULACIONES_POR_SEMANA` veces en
   * 7 días; pasado eso, la anula administración. Si tiene órdenes con el recargo sin pagar, primero se leen los pagos
   * nuevos. No mira la compra con QR prendida, el piloto ni el piso. `200 {anulada:true, repetido:false}`; pedirlo otra
   * vez, `repetido:true`. Lo que no: `404 sin-compra` (no tiene una compra cargada sin pagar), `409 plazo-vencido`,
   * `409 compra-en-curso {permiso}` (su compra es de otro producto), `409 orden-con-pago`, `409 tope-de-anulaciones`,
   * `502 red` (Horizon no contestó y tiene órdenes sin pagar) y `400 producto`.
   */
  async anular(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const otra = this.cuentaDeOtro(ses.s);
    if (otra) return otra;
    const compras = this.d.compras;
    if (!compras) return r(503, { motivo: "compras-cerradas" });
    const producto = p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { producto?: unknown }).producto : undefined;
    if (typeof producto !== "string" || !PRODUCTOS_DE_COMPRA.has(producto)) return r(400, { motivo: "producto" });
    // Un pago que todavía no se leyó no tiene que quedar en una orden que se cierra: sin Horizon, no se anula.
    const sinPagar = () => {
      const c = compras.pendiente(usuario);
      return c !== null && compras.ordenesSinPagarDe(c.id).length > 0;
    };
    const leido = sinPagar();
    if (leido && !(this.d.lector && (await this.d.lector.leer()).ok)) return r(502, { motivo: "red" });

    // Desde acá, sin await: mirar y anular es una sola jugada.
    const ahora = this.reloj();
    const res = this.d.cupos.transaccion((): { estado: number; cuerpo: Record<string, unknown>; soltada?: boolean } => {
      const c = compras.pendiente(usuario);
      if (!c) {
        const u = compras.ultima(usuario);
        return u && u.producto === producto && u.motivo === "anulada" ? { estado: 200, cuerpo: { anulada: true, repetido: true } } : { estado: 404, cuerpo: { motivo: "sin-compra" } };
      }
      if (c.producto !== producto) return { estado: 409, cuerpo: { motivo: "compra-en-curso", permiso: compras.vista(c) } };
      // Ya soltada: lo mismo, sin mirar el plazo ni contar otra anulación.
      if (c.reserva <= 0) return { estado: 200, cuerpo: { anulada: true, repetido: true } };
      if (ahora - (compras.ultimoAviso(c) as number) > ANULAR_COMPRA_MS) return { estado: 409, cuerpo: { motivo: "plazo-vencido" } };
      if (!leido && sinPagar()) return { estado: 502, cuerpo: { motivo: "red" } };
      // Se suelta la reserva y no el recargo: el recargo lo suelta solo administración.
      const a = compras.soltarReserva(c.id, usuario, ahora);
      if (!a.ok) return a.motivo === "compra" || a.motivo === "compra-pagada" ? { estado: 404, cuerpo: { motivo: "sin-compra" } } : { estado: 409, cuerpo: { motivo: a.motivo } };
      return { estado: 200, cuerpo: { anulada: true, repetido: a.repetido }, soltada: !a.repetido };
    });
    if (res.soltada) this.registrar("compra-soltada", { producto });
    return r(res.estado, res.cuerpo);
  }

  /**
   * `POST /v1/alta/cupon`: canjea un cupón para la persona de la sesión. El mismo cupón otra vez es lo mismo (sin gastar
   * otro uso). Un código que no vale le suma un fallido a la persona y a la dirección; pasado el tope de cualquiera de
   * los dos, el canje da `429 intentos` (la dirección frena solo el canje, nunca `/estado`). Con el alta atada a otra
   * cuenta que la de esta sesión, `409 cuenta-de-otro` sin canjear ni escribir nada.
   */
  async cupon(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const otra = this.cuentaDeOtro(ses.s);
    if (otra) return otra;
    const trabado = this.porUsuario.trabado(usuario) ?? this.codigosPorIp.trabado(grupoDeIp(p.ip));
    if (trabado !== null) return r(429, { motivo: "intentos", reintentarEn: trabado });
    const codigo = normalizar(p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { cupon?: unknown }).cupon : undefined);
    if (!codigo) {
      this.fallido(usuario, p.ip);
      return r(400, { motivo: "forma" });
    }
    const h = await huella(codigo, this.d.cuponSecreto as string);
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    if (!c.ok) return r(502, { motivo: "pollar" });
    const cuenta = c.cuenta;
    const abierta = await this.abierta(cuenta, suya);
    // El saldo se lee antes (con su memoria de 60 s); si el canje resulta repetido, ni se mira.
    const creditos = await (this.d.pollar as Pollar).creditos();

    // Desde acá, sin await: el canje comprueba, mira el piso y gasta en una transacción.
    const ahora = this.reloj();
    const pausa: { motivo: MotivoPausa | null } = { motivo: null };
    const freno = (x: { sorteos: number; altaNueva: boolean }) => {
      pausa.motivo = this.pausa(creditos, this.d.cfg.creditosPorSorteo * x.sorteos + (x.altaNueva ? this.d.cfg.creditosPorAlta : 0), ahora);
      return pausa.motivo ? ("altas-pausadas" as const) : null;
    };
    const res = this.d.altas.canjear({ huella: h, usuario, cuenta, freno }, ahora);
    if (pausa.motivo) this.registrar("alta-pausa", { motivo: pausa.motivo });
    if (!res.ok) {
      if (FALLIDOS.has(res.motivo)) this.fallido(usuario, p.ip);
      if (res.motivo === "cuenta-de-otro") this.registrar("error-alta", { motivo: "cuenta-de-otro" });
      return r(ESTADO_DEL_ERROR[res.motivo] ?? 400, res.motivo === "cupon-vencido" ? { motivo: res.motivo, vence: res.vence } : { motivo: res.motivo });
    }
    if (abierta) this.d.cupos.marcarAbierta(usuario, ahora);
    if (!res.repetido) this.registrar("alta-canje", { lote: res.lote, sorteos: res.sorteosSumados, altaNueva: res.altaNueva ? 1 : 0 });
    return r(200, { ok: true, repetido: res.repetido, sorteosSumados: res.sorteosSumados, sorteos: this.sorteos(usuario, cuenta, ahora), sigue: this.sigue(cuenta, abierta) });
  }

  private fallido(usuario: string, ip: string): void {
    this.porUsuario.fallo(usuario);
    this.codigosPorIp.fallo(grupoDeIp(ip));
  }

  // ---------- el pago de quien llega de afuera ----------

  async atenderPago(accion: AccionPago, p: PedidoAlta): Promise<Respuesta> {
    return accion === "orden" ? this.orden(p) : this.pago(p);
  }

  /**
   * La orden abierta de la persona, como la muestra `/estado` para que el sitio pregunte por ella al volver, con lo que ya
   * llegó (`recibido`): una pagada a medias se sigue mostrando aunque haya vencido.
   */
  private ordenAbierta(usuario: string, ahora: number): Record<string, unknown> | null {
    const o = this.d.cobros?.ordenAbierta(usuario, ahora) ?? null;
    return o ? this.resumenDeOrden(o) : null;
  }

  /**
   * Una orden como la muestra `/v1/alta/estado` en `orden` (y `409 orden-abierta` del aviso de carga): el id, el producto,
   * el total, la nota, cuándo vence, lo que ya llegó y, si lleva el recargo del QR, el precio y el recargo.
   */
  private resumenDeOrden(o: FilaOrden): Record<string, unknown> {
    const recibido = this.d.cobros?.recibido(o.id) ?? 0;
    return { id: o.id, producto: o.producto, usdc: usdcTexto(o.monto), nota: notaDe(o.id), vence: o.vence, recibido: usdcTexto(recibido), ...this.recargoDeVista(o) };
  }

  /** Lo que se suma a la vista de una orden con el recargo del QR: el precio del paquete y el recargo (`usdc` es el total). */
  private recargoDeVista(o: FilaOrden): Record<string, string> {
    const l = this.d.cobros?.recargoDe(o.id) ?? null;
    return l ? { precio: usdcTexto(o.monto - l.recargo), recargo: usdcTexto(l.recargo) } : {};
  }

  /**
   * Si la persona tiene una orden sin pagar (de los últimos 30 días, vencida o no), lee antes los pagos nuevos: pudo
   * pagar y cerrar la pantalla sin tocar «Ya pagué». Como mucho una lectura cada 5 segundos para todo el objeto; si
   * Horizon no contesta, se sigue con lo que ya se sabía. A quien no tiene órdenes no se le lee nada.
   */
  private async leerPagosDe(usuario: string): Promise<void> {
    const { cobros, lector } = this.d;
    if (!cobros || !lector || !cobros.tieneOrdenSinPagar(usuario, this.reloj())) return;
    await lector.leer();
  }

  private vistaDeOrden(o: FilaOrden, destino: string): Record<string, unknown> {
    const usdc = usdcTexto(o.monto);
    const nota = notaDe(o.id);
    return { id: o.id, producto: o.producto, usdc, sorteos: o.sorteos, destino, nota, memoId: memoIdDe(o.id), enlace: enlaceDePago({ destino, usdc, nota }), vence: o.vence, ...this.recargoDeVista(o) };
  }

  /**
   * `POST /v1/alta/orden` `{producto}`: la orden abierta de la persona para ese producto o una nueva, con a qué cuenta
   * pagar, cuánto, la nota y el enlace de pago. Quien ya tiene acceso no compra el primer paquete (le toca uno de 10 o de
   * 50). Una orden nueva no nace con el pago apagado, con la venta pausada ni bajo el piso de créditos más la reserva del
   * evento (`RESERVA_CARGA_CREDITOS`: la respetan todos los caminos de la venta). Con una lista del piloto puesta (en
   * `COMPRAS_QR_PILOTO` o, con la variable vacía, sumada por administración), una orden nueva pide además la cuenta en
   * la lista: si no, `503 fuera-del-piloto` (una que ya existe se sigue devolviendo).
   *
   * Con una compra con QR cargada y sin pagar, la orden lleva su recargo, del producto que sea, y `precio` y `recargo`
   * además de `usdc` (el total): el medio no lo dice el sitio, sale del aviso de carga. Para el producto de esa compra
   * vale el permiso de terminar: la orden sale aunque la venta esté pausada y sin mirar el piso, porque su reserva ya
   * cubrió esa promesa. El pago apagado o el producto fuera de venta la frenan igual. Con una compra cargada sin pagar
   * la lista del piloto no se mira: es el permiso de terminar. `409 compra-en-curso` si para llevar el recargo hay que
   * reemplazar una orden que ya recibió algo.
   */
  async orden(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const { cfg, cobros } = this.d;
    if (!cfg.altasPago || !cobros || !cfg.cuentaCobros || this.sinColumnas()) return r(503, { motivo: "pago-apagado" });
    const destino = cfg.cuentaCobros;
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const pedido = p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { producto?: unknown }).producto : undefined;
    const producto = typeof pedido === "string" ? cfg.precios?.find((x) => x.id === pedido) : undefined;
    if (!producto) return r(400, { motivo: "producto" });
    // Un pago que todavía no se leyó no tiene que terminar en una orden nueva.
    await this.leerPagosDe(usuario);
    const c = await this.cuentaDe(ses.s, this.d.cupos.altaDe(usuario));
    if (!c.ok) return r(502, { motivo: "pollar" });
    const creditos = await (this.d.pollar as Pollar).creditos();

    // Desde acá, sin await: mirar el acceso, el piso y crear la orden es una sola jugada.
    const ahora = this.reloj();
    if (producto.id === "alta" && this.altaQueVale(usuario, c.cuenta)) return r(409, { motivo: "ya-tiene-acceso" });
    const pausa: { motivo: MotivoPausa | null } = { motivo: null };
    const pendiente = this.d.compras?.pendiente(usuario) ?? null;
    // Quien tiene una compra cargada sin pagar ya entró por la lista: lo suyo no la mira.
    const fuera = pendiente === null && this.fueraDelPiloto(c.cuenta);
    const res = cobros.crearOrden(
      {
        usuario,
        producto,
        freno: (x) => {
          if (fuera) return "fuera-del-piloto";
          pausa.motivo = this.pausa(creditos, cfg.creditosPorSorteo * x.sorteos + (x.altaNueva ? cfg.creditosPorAlta : 0), ahora, cfg.reservaCargaCreditos);
          return pausa.motivo ? "altas-pausadas" : null;
        },
        recargo: pendiente ? { compra: pendiente.id, recargo: pendiente.recargo } : null,
        // El permiso de terminar vale mientras la compra reserva: pasado eso, la orden pasa por la pausa y el piso.
        sinFrenos: pendiente !== null && pendiente.producto === producto.id && (this.d.compras as ComprasQr).reservando(pendiente, ahora),
      },
      ahora,
    );
    if (pausa.motivo) this.registrar("alta-pausa", { motivo: pausa.motivo, donde: "orden" });
    if (!res.ok) return r(res.motivo === "compra-en-curso" ? 409 : 503, { motivo: res.motivo });
    if (res.nueva) this.registrar("alta-orden", { producto: producto.id });
    return r(200, { orden: this.vistaDeOrden(res.orden, destino) });
  }

  /**
   * `POST /v1/alta/pago` `{orden}`: lee los pagos nuevos en Horizon (como mucho una vez cada 5 segundos para todo el
   * objeto) y dice si la orden de la persona ya está pagada. Si lo está y el servidor sabe la cuenta de la persona, la
   * ata y la mete en el libro. Con el pago apagado sigue andando para las órdenes que ya existen. Una orden cerrada da
   * `410 orden-cerrada` recién después de leer: a una reemplazada la puede dejar pagada un pago que ya estaba en camino.
   * Si Horizon no contesta y la reemplazada todavía puede quedar pagada, `502 red` (no se sabe todavía).
   */
  async pago(p: PedidoAlta): Promise<Respuesta> {
    const no = this.apagado();
    if (no) return no;
    const { cfg, cobros, lector } = this.d;
    if (!cobros || !lector || !cfg.cuentaCobros) return r(503, { motivo: "pago-apagado" });
    const ses = await this.sesion(p.token, p.ip);
    if (!ses.ok) return ses.r;
    const { usuario } = ses.s;
    const id = normalizarOrden(p.cuerpo && typeof p.cuerpo === "object" ? (p.cuerpo as { orden?: unknown }).orden : undefined);
    if (!id) return r(400, { motivo: "forma" });
    const antes = cobros.orden(id);
    // Una orden de otra persona es lo mismo que una que no existe: no se dice de quién es.
    if (!antes || antes.usuario !== usuario) return r(404, { motivo: "orden" });
    // Se lee siempre (como mucho una vez cada 5 segundos), también con la orden cerrada: así un pago repetido queda
    // anotado en los sueltos enseguida, y uno que ya estaba en camino deja pagada la orden reemplazada.
    const lectura = await lector.leer();
    const o = cobros.orden(id) as FilaOrden;
    // Cerrada (para devolver lo que llegó, o reemplazada): ya no se completa y lo que llegue va a los sueltos. Puede pedir
    // otra orden. Sin poder leer, una reemplazada que todavía puede quedar pagada no se da por cerrada.
    if (estaCerrada(o)) return !lectura.ok && puedeHonrarse(o) ? r(502, { motivo: "red" }) : r(410, { motivo: "orden-cerrada" });
    if (o.pagada === null) {
      if (!lectura.ok) return r(502, { motivo: "red" });
      return r(200, { pagada: false, recibido: usdcTexto(cobros.recibido(id)), total: usdcTexto(o.monto), minimo: usdcTexto(cobros.minimoDeOrden(o)) });
    }
    // Pagada: si se sabe la cuenta, se ata. Si Pollar no contesta ahora, se ata en el próximo `/estado`.
    const suya = this.d.cupos.altaDe(usuario);
    const c = await this.cuentaDe(ses.s, suya);
    const cuenta = c.ok ? c.cuenta : null;
    const abierta = await this.abierta(cuenta, suya);
    const ahora = this.reloj();
    if (cuenta && this.d.cupos.altaDe(usuario)) {
      const atado = this.d.cupos.transaccion(() => {
        const a = this.d.cupos.atar(usuario, cuenta, ahora);
        if (a === "ok" && abierta) this.d.cupos.marcarAbierta(usuario, ahora);
        return a;
      });
      if (atado === "cuenta-de-otro") {
        this.registrar("error-alta", { motivo: "cuenta-de-otro" });
        return r(409, { motivo: "cuenta-de-otro" });
      }
    }
    return r(200, { pagada: true, sorteos: this.sorteos(usuario, cuenta, ahora), sigue: this.sigue(cuenta, abierta) });
  }
}

/**
 * Si la compra con QR está cerrada por las variables, sin mirar nada guardado: apagada (`COMPRAS_QR`), sin el pago, sin la
 * carga, sin la cuenta de cobros o con el recargo mal escrito (`compras-cerradas`), o con fondeo diferido. null si las
 * variables la dejan abrir. La usan la puerta del Worker (para contestar sin entrar al objeto) y el objeto.
 */
export function compraCerradaDe(cfg: Config): "compras-cerradas" | "fondeo-diferido" | null {
  if (!cfg.comprasQr || !cfg.altasPago || !cfg.cargas || !cfg.recargoQr || !cfg.cuentaCobros) return "compras-cerradas";
  // La lista del piloto mal escrita (o `todos` sin confirmar) cierra la compra entera, no solo la variable.
  if (cfg.faltaAltas.includes("compras-qr-piloto")) return "compras-cerradas";
  if (cfg.pollarFondeo !== "inmediato") return "fondeo-diferido";
  return null;
}

/**
 * Lo que dice `GET /v1/alta/precios`: los productos que se venden, si el pago está prendido y, con la compra con QR
 * prendida y su recargo bien escrito, lo que suma pagar con QR (`recargoQr`, la primera vez y las siguientes). Sin
 * precios, nada. Sin la compra con QR, `recargoQr: null`: no se anuncia lo que no se vende.
 */
export function preciosPublicos(cfg: Config): Record<string, unknown> {
  const alta = cfg.precios?.find((p) => p.id === "alta");
  return {
    red: cfg.red,
    pago: cfg.altasPago,
    alta: alta ? { usdc: alta.usdc, sorteos: alta.sorteos, dias: alta.dias } : null,
    paquetes: (cfg.precios ?? []).filter((p) => p.id !== "alta").map((p) => ({ id: p.id, usdc: p.usdc, sorteos: p.sorteos, dias: p.dias })),
    recargoQr: cfg.comprasQr && cfg.recargoQr ? { primera: cfg.recargoQr.primeraUsdc, siguientes: cfg.recargoQr.siguientesUsdc } : null,
  };
}

/**
 * La puerta del Worker para `GET /v1/carga/cupo`: solo en mainnet (en testnet, o en otra ruta, devuelve null y la ruta no
 * existe). Como `/v1/patrocinio/cupo`: abierta a cualquier origen, de solo lectura, sin sesión y con un contador por
 * dirección y por hora (`cupoPorHora`, en memoria de cada nodo). Contesta solo `{abierta}`, sin cifras: lo que no sea un
 * sí del objeto (un error, otra cosa) es cerrada.
 */
export async function atenderCarga(request: Request, cfg: Config, porIp: PorIp, consultar: () => Promise<boolean>): Promise<Response | null> {
  if (cfg.red !== "mainnet") return null;
  if (new URL(request.url).pathname !== "/v1/carga/cupo") return null;
  const cabeceras = cors(request.headers.get("Origin"), true);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras });
  if (request.method !== "GET") return json({ motivo: "metodo" }, 405, cabeceras);
  // Con la carga apagada se contesta acá: sin entrar al objeto que paga los sellos y sin gastar el contador.
  if (!cfg.cargas) return json({ abierta: false }, 200, cabeceras);
  if (!porIp.toca(request.headers.get("CF-Connecting-IP") ?? "0.0.0.0", cupoPorHora(cfg.red))) return json({ motivo: "cupo-ip" }, 429, cabeceras);
  let abierta = false;
  try {
    abierta = (await consultar()) === true;
  } catch {
    abierta = false;
  }
  return json({ abierta }, 200, cabeceras);
}

/**
 * La puerta del Worker para `/v1/alta/*`: solo en mainnet (en testnet devuelve null y la ruta sigue sin existir, como
 * siempre). Controla el método, el origen, el tamaño y el cuerpo, saca el token de `Authorization: Bearer` y le pasa
 * el pedido al objeto con `llamar` (o con `llamarPago`, las rutas del pago; sin él, no existen). Nunca pone el token en
 * una dirección ni en la bitácora. `GET /v1/alta/precios` la contesta la puerta sola: es abierta y no toca el objeto.
 */
export async function atenderAlta(
  request: Request,
  cfg: Config,
  llamar: (accion: AccionAlta, p: PedidoAlta) => Promise<Respuesta>,
  porIp: PorIp,
  llamarPago?: (accion: AccionPago, p: PedidoAlta) => Promise<Respuesta>,
  llamarCompra?: (accion: AccionCompra, p: PedidoAlta) => Promise<Respuesta>,
): Promise<Response | null> {
  if (cfg.red !== "mainnet") return null;
  const url = new URL(request.url);
  const origen = request.headers.get("Origin");
  const cabeceras = cors(origen, false, true);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cabeceras });
  const compra = /^\/v1\/compra\/(empezar|cargar|anular)$/.exec(url.pathname)?.[1] as AccionCompra | undefined;
  const m = compra ? null : /^\/v1\/alta\/(estado|cupon|abrir|orden|pago|precios)$/.exec(url.pathname);
  if (compra ? !llamarCompra : !m?.[1] || ((m[1] === "orden" || m[1] === "pago") && !llamarPago)) return json({ motivo: "no-existe" }, 404, cabeceras);
  if (m?.[1] === "precios") {
    const abiertas = cors(origen, true);
    if (request.method !== "GET") return json({ motivo: "metodo" }, 405, abiertas);
    if (!cfg.altas) return json({ motivo: "apagado" }, 503, abiertas);
    if (!porIp.toca(request.headers.get("CF-Connecting-IP") ?? "0.0.0.0", ALTAS_POR_IP_HORA)) return json({ motivo: "cupo-ip" }, 429, abiertas);
    return json(preciosPublicos(cfg), 200, { ...abiertas, "Cache-Control": "public, max-age=300" });
  }
  if (request.method !== "POST") return json({ motivo: "metodo" }, 405, cabeceras);
  if (!cfg.altas) return json({ motivo: "apagado" }, 503, cabeceras);
  // Con la venta cerrada, empezar y cargar contestan acá: sin entrar al objeto, sin preguntar la sesión y sin gastar el
  // contador por dirección que comparte el stand. Anular pasa siempre: es la salida de lo que ya empezó.
  const cerrada = compra && compra !== "anular" ? compraCerradaDe(cfg) : null;
  if (cerrada) return json({ motivo: cerrada }, 503, cabeceras);
  // Un navegador manda su origen; un programa puede mentirlo: la defensa de verdad es la sesión de Pollar y los topes.
  if (!origenPermitido(origen)) return json({ motivo: "origen" }, 403, cabeceras);
  const ip = request.headers.get("CF-Connecting-IP") ?? "0.0.0.0";
  if (!porIp.toca(ip, ALTAS_POR_IP_HORA)) return json({ motivo: "cupo-ip" }, 429, cabeceras);
  if (Number(request.headers.get("Content-Length") ?? "0") > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const texto = await request.text();
  if (texto.length > MAX_CUERPO) return json({ motivo: "cuerpo" }, 400, cabeceras);
  let cuerpo: unknown = {};
  if (texto.trim()) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      return json({ motivo: "cuerpo" }, 400, cabeceras);
    }
  }
  if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return json({ motivo: "cuerpo" }, 400, cabeceras);
  const token = /^Bearer (\S{1,8192})$/.exec(request.headers.get("Authorization") ?? "")?.[1] ?? null;
  try {
    const accion = m?.[1];
    const res =
      compra && llamarCompra
        ? await llamarCompra(compra, { token, ip, cuerpo })
        : (accion === "orden" || accion === "pago") && llamarPago
          ? await llamarPago(accion, { token, ip, cuerpo })
          : await llamar(accion as AccionAlta, { token, ip, cuerpo });
    return json(res.cuerpo, res.estado, cabeceras);
  } catch {
    // Sin el error en la bitácora: podría llevar algo del pedido. El objeto anota lo suyo.
    return json({ motivo: "interno" }, 500, cabeceras);
  }
}
