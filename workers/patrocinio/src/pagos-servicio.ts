/**
 * El portero de los pagos clásicos: lo que pasa cuando llega el pago de un premio o un retiro con su costo y hay que pagar su
 * comisión de la red. No sabe de Cloudflare: recibe sus dependencias (las tablas, los cupos, la red, Horizon, la llave y el
 * reloj), así que se prueba entero con una red de mentira.
 *
 * Es aparte de `servicio.ts` a propósito: el sello y el sorteo siguen su camino de siempre y un pago clásico no pasa por él.
 * Los pagos tienen su propia tabla, su propio presupuesto y sus propios topes (`pagos-uso.ts`).
 *
 * El orden de un pedido, de lo más barato a lo más caro:
 *   1. ¿esa forma está prendida, y el portero puede pagar? (la variable, el modo, la llave y las tablas)
 *   2. la forma exacta del sobre (`pagos-lista.ts`), sin tocar nada
 *   3. ¿ya está guardado este hash? Se contesta por su estado. Si sigue en el aire, se vuelve a mandar el mismo sobre
 *   4. si es nuevo: la pausa, la ventana, las firmas contra la cuenta y los topes que no piden red
 *   5. en el premio, lo que dice la red del sorteo: que sea de quien paga, que ya se haya sorteado y que lo haya sellado el portero
 *   6. la mirada previa en Horizon, que falla cerrada
 *   7. el plazo: si ya pasó mucho tiempo, no se reserva nada
 *   8. reservar el puesto, el lugar de la cuenta y el presupuesto de una vez (síncrono), envolver, firmar y mandar
 *
 * Cada pedido que sale de acá sin pagar lleva `pudoSalir`: verdadero solo si el portero tiene ese hash reservado o enviado en
 * el momento de contestar, es decir, si ese sobre todavía puede entrar a un ledger. El sitio decide con eso si puede armar otro.
 *
 * Un pago que se perdió antes de llegar a la red traba a su cuenta hasta que la alarma lo da por no entrado. Eso pasa recién
 * cuando venció hace diez minutos y los dos RPC y Horizon dicen que no lo ven: devolver algo que ya entró dejaría un premio
 * pagado con su puesto libre, y se pagaría dos veces. Ante la duda queda en el aire.
 */
import { type FeeBumpTransaction, type Transaction, TransactionBuilder } from "@stellar/stellar-sdk/base";
import { type Config, DIA_MS, TECHO_ALTAS_PREMIO_DIA } from "./config";
import { usdcTexto } from "./cobros";
import type { Cupos } from "./cupos";
import type { Autoridad } from "./lista-blanca";
import { type MemoriaDeHorizon, type PedirHorizon, crearMemoria, estaEnHorizon, mirarParaPagar } from "./pagos-horizon";
import { type FormaDePago, type PagoLeido, PUESTO_MAXIMO, firmasDelPago, leerPago, ventanaDelPago } from "./pagos-lista";
import {
  AJUSTE_ALTAS_PREMIO_DIA,
  AJUSTES_DE_PAUSA,
  FALLARIA_POR_CUENTA_HORA,
  type FilaDePago,
  type FrenoDePago,
  type LimitesDePagos,
  type PedidoDePago,
  type UsoDePagos,
  limitesDePagos,
  topeEnCaliente,
} from "./pagos-uso";
import { type Consulta, ErrorDeRed, type Red } from "./red";
import type { Registrar } from "./registrador";
import { ESPERA_RECONCILIAR_MS, type Firmante, MARGEN_VENCIMIENTO_S, type Modo, type Respuesta, autoridadDe } from "./servicio";
import { type SorteoEnRed, leerNumeroDeSorteo, leerSorteo } from "./sorteadora";

/**
 * Cuánto puede pasar desde que llega el pedido hasta que se reserva algo, en ms. Mandar puede tardar hasta 16 s más (dos RPC de
 * 8 s), y el sitio espera 55 s en total: 36 más 16 dan 52. Pasado este plazo se contesta sin haber reservado nada.
 */
export const PLAZO_PARA_RESERVAR_MS = 36_000;

/**
 * Cuánto se espera, en ms, a los RPC cuando la red rechaza por su secuencia un pago recién reservado, antes de devolverlo: se
 * les pregunta a todos a la vez si ya entró. Es poco a propósito: con el plazo de reservar y el envío (36 más 16) quedan
 * 3 s hasta los 55 que espera el sitio. Si el sitio corta antes, lo toma como duda y reenvía el mismo sobre, que es lo seguro.
 */
export const ESPERA_CONFIRMAR_MS = 2_500;

const HORA_MS = 3_600_000;
const LIMPIAR_DESDE = 5000;

type Cuerpo = Record<string, unknown>;
const resp = (estado: number, cuerpo: Cuerpo): Respuesta => ({ estado, cuerpo });

/** Los primeros caracteres de un hash: alcanza para seguir un pago en la bitácora sin ponerlo entero. */
const corto = (hash: string): string => hash.slice(0, 8);

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** El nombre del error y nada más: su mensaje podría llevar algo del pedido. */
const nombreDe = (e: unknown): string => (e instanceof Error ? e.name : "desconocido");

/**
 * El hash de la transacción interna de un sobre (el de adentro, si viene envuelto), o null si no se entiende. Sirve para saber
 * si un pedido que salió mal todavía puede entrar a un ledger, aunque no haya pasado la forma.
 */
function hashDeInterna(xdrBase64: string, passphrase: string): string | null {
  try {
    const t = TransactionBuilder.fromXDR(xdrBase64, passphrase);
    const interna = "innerTransaction" in t ? t.innerTransaction : t;
    return hex(interna.hash());
  } catch {
    return null;
  }
}

/** Si alguna de las tres formas está prendida en la configuración: lo que hace aparecer los bloques de `/cupo` y `/estado`. */
export function pagosPrendidos(cfg: Pick<Config, "pagosPremio" | "retiros" | "altasPremio">): boolean {
  return cfg.pagosPremio || cfg.retiros || cfg.altasPremio;
}

/** Lo que hace falta de afuera. Todo entra como argumento: la red, Horizon y el reloj son de mentira en las pruebas. */
export interface DependenciasDePagos {
  cfg: Config;
  uso: UsoDePagos;
  cupos: Cupos;
  /** El RPC de siempre, con su lista en orden. */
  red: Red;
  /** Un RPC por cada dirección de la lista, para preguntarle a cada uno por separado antes de dar un pago por no entrado. */
  redesSueltas: ReadonlyArray<Pick<Red, "consultar">>;
  /** Horizon, fijo en el código (`haciaHorizon`). */
  pedirHorizon: PedirHorizon;
  /** La llave del Worker que firma el envoltorio. Sin ella no se paga. */
  firmante: Firmante | null;
  /** La cuenta que paga las comisiones (G…). Sin ella no se paga. */
  cuentaPatrocinadora: string | null;
  /** El modo del portero de los sellos: `apagar` y `pollar` cortan también los pagos. */
  modo: () => Modo;
  reloj?: () => number;
  /** Se llama cuando queda algo en el aire, para que el objeto programe su alarma. */
  alQuedarEnElAire?: () => void;
  /** La bitácora: solo nombres fijos, cifras y el comienzo de un hash. Nunca una cuenta, un destino, una nota ni un sorteo. */
  registrar?: Registrar;
}

/** Lo que se sabe de un pedido mientras se atiende. */
interface Contexto {
  forma: FormaDePago;
  xdr: string;
  pago: PagoLeido;
  /** Cuándo llegó el pedido, en ms: para el plazo. */
  t0: number;
  /** Una respuesta de error, con `pudoSalir` según lo que tenga el portero de ese hash en este momento. */
  no: (estado: number, cuerpo: Cuerpo) => Respuesta;
}

export class PorteroDePagos {
  private readonly reloj: () => number;
  private readonly alQuedarEnElAire: () => void;
  private readonly registrar: Registrar;
  /** La lectura de la cuenta de cobros, que se guarda un minuto: todos los retiros la miran. */
  private readonly memoria: MemoriaDeHorizon;
  /** Cuándo dijo Horizon, por cuenta, que un pago fallaría: el tope por hora se mira antes de ir a Horizon. Vive en la memoria del objeto. */
  private readonly fallarias = new Map<string, number[]>();

  constructor(private readonly d: DependenciasDePagos) {
    this.reloj = d.reloj ?? (() => Date.now());
    this.alQuedarEnElAire = d.alQuedarEnElAire ?? (() => {});
    this.registrar = d.registrar ?? (() => {});
    this.memoria = crearMemoria(d.cfg.cuentaCobros, this.reloj);
  }

  // ---------- si se puede pagar ----------

  /** Si esta forma está pausada por administración (`pagos/pausar`). */
  private pausada(forma: FormaDePago | "alta-premio"): boolean {
    return this.d.cupos.ajuste(AJUSTES_DE_PAUSA[forma]) === "1";
  }

  /**
   * Por qué el portero no atendería esta forma, o null si la atiende: `variable` (apagada en la configuración), `modo` (el portero
   * está apagado o devuelto a Pollar) o `config` (falta la llave, la cuenta que paga, las tablas, el contrato o, en el retiro, la
   * cuenta de cobros y el costo). No mira la pausa: la pausa frena lo nuevo y deja pasar el reenvío de lo ya reservado.
   */
  private porQueNo(forma: FormaDePago): "variable" | "modo" | "config" | null {
    const cfg = this.d.cfg;
    if (!(forma === "premio" ? cfg.pagosPremio : cfg.retiros)) {
      return "variable";
    }
    if (this.d.modo() !== "portero") {
      return "modo";
    }
    const sinLlave = this.d.firmante === null || this.d.cuentaPatrocinadora === null || !this.d.uso.disponible();
    const sinLaForma = forma === "premio" ? cfg.contractId === null : cfg.cuentaCobros === null || cfg.costoRetiro === null;
    return sinLlave || sinLaForma ? "config" : null;
  }

  /** Si el portero atendería esta forma ahora, con la pausa. Es lo que le dice `/cupo` al sitio. */
  private atiende(forma: FormaDePago): boolean {
    return this.porQueNo(forma) === null && !this.pausada(forma);
  }

  private limites(): LimitesDePagos {
    return limitesDePagos(this.d.cfg, (clave) => this.d.cupos.ajuste(clave));
  }

  /** Lo que el evaluador necesita saber de nuestra configuración. */
  private reglas(forma: FormaDePago) {
    const cfg = this.d.cfg;
    const delPortero = [this.d.cuentaPatrocinadora, cfg.cuentaSorteadora, cfg.cuentaCobros];
    return {
      passphrase: cfg.passphrase,
      forma,
      cuentaCobros: cfg.cuentaCobros,
      costoRetiro: cfg.costoRetiro?.monto ?? null,
      cuentasDelPortero: delPortero.filter((c): c is string => c !== null),
    };
  }

  // ---------- si el sobre todavía puede entrar ----------

  /**
   * Si el portero tiene este sobre reservado o enviado ahora: el hash conocido o, si no, el que sale del sobre. Nunca lanza:
   * ante la duda, que no puede salir.
   */
  pudoSalir(xdrBase64: string, hashConocido: string | null = null): boolean {
    try {
      if (!this.d.uso.disponible()) {
        return false;
      }
      const hash = hashConocido ?? hashDeInterna(xdrBase64, this.d.cfg.passphrase);
      if (hash === null) {
        return false;
      }
      const f = this.d.uso.buscar(hash);
      return f !== null && (f.estado === "reservado" || f.estado === "enviado");
    } catch {
      return false;
    }
  }

  // ---------- el pedido ----------

  /** `POST /v1/patrocinio/pago`: paga la comisión de un premio o de un retiro. Los errores que salen de acá llevan `pudoSalir`. */
  async procesar(forma: FormaDePago, xdrBase64: string): Promise<Respuesta> {
    const t0 = this.reloj();
    let hash: string | null = null;
    const no = (estado: number, cuerpo: Cuerpo): Respuesta => resp(estado, { ...cuerpo, pudoSalir: this.pudoSalir(xdrBase64, hash) });

    const porQue = this.porQueNo(forma);
    if (porQue !== null) {
      return no(503, { motivo: "apagado", forma, detalle: porQue });
    }
    const lectura = leerPago(xdrBase64, this.reglas(forma));
    if (!lectura.ok) {
      hash = lectura.hash;
      return no(400, { motivo: "no-permitida", razon: lectura.razon, detalle: lectura.detalle });
    }
    const pago = lectura.pago;
    hash = pago.hash;
    const c: Contexto = { forma, xdr: xdrBase64, pago, t0, no };

    // Ya guardado: se contesta por su estado, sin mirar su ventana. Cerrado, tal cual. En el aire, se vuelve a mandar el mismo.
    const previa = this.d.uso.buscar(pago.hash);
    if (previa && (previa.estado === "ok" || previa.estado === "fallo")) {
      return this.duplicado(previa, previa.estado);
    }
    if (previa && (previa.estado === "reservado" || previa.estado === "enviado")) {
      return this.reenviar(c, previa);
    }
    // Uno que se dio por devuelto pudo haber entrado igual (el RPC que lo tomó se cortó y otro dijo que no): antes de tratarlo
    // como nuevo se le pregunta a la red. Si entró, se cierra con lo que diga y no se manda de nuevo: un premio que entró con su
    // puesto libre se pagaría dos veces.
    if (previa && previa.estado === "devuelto") {
      const cierre = await this.cerrarSiEntro(previa);
      if (cierre !== null) {
        return this.duplicado(previa, cierre);
      }
    }
    return this.pagarNuevo(c);
  }

  /** La respuesta de un pago que ya estaba guardado. */
  private duplicado(f: FilaDePago, estado: "ok" | "fallo" | "en-camino"): Respuesta {
    return resp(200, { hash: f.hash, forma: f.forma, vence: f.vence, status: "DUPLICATE", estado });
  }

  /**
   * Un pago que ya está en el aire y llega otra vez (el sitio reintenta). Primero se mira si la red ya lo cerró. Si no, y no
   * venció, se vuelve a mandar el mismo sobre: tiene el mismo hash y la red aplica una sola transacción por secuencia. Un
   * reenvío de algo ya reservado no lo frenan la pausa, los topes ni el plazo: ya se aprobó. Las firmas sí se vuelven a mirar,
   * porque el hash no las incluye.
   */
  private async reenviar(c: Contexto, previa: FilaDePago): Promise<Respuesta> {
    const cierre = await this.cerrarSiEntro(previa);
    if (cierre !== null) {
      return this.duplicado(previa, cierre);
    }
    if (Math.floor(this.reloj() / 1000) > previa.vence) {
      return this.duplicado(previa, "en-camino");
    }
    const sinFirmas = await this.revisarFirmas(c);
    if (sinFirmas) {
      return sinFirmas;
    }
    return this.mandar(c, this.armarEnvoltorio(c.xdr), false);
  }

  /** Un pago nuevo, o uno que la red no había tomado: todo lo que se mira antes de reservar, y después reservar y mandar. */
  private async pagarNuevo(c: Contexto): Promise<Respuesta> {
    const { forma, pago, no } = c;
    const d = this.d;
    if (this.pausada(forma)) {
      return no(503, { motivo: "apagado", forma, detalle: "pausado" });
    }
    const ventana = ventanaDelPago(pago, Math.floor(this.reloj() / 1000), d.cfg.ventanaMaxS);
    if (!ventana.ok) {
      return no(400, { motivo: "no-permitida", razon: ventana.razon, detalle: ventana.detalle });
    }
    const sinFirmas = await this.revisarFirmas(c);
    if (sinFirmas) {
      return sinFirmas;
    }
    if (forma === "premio" && !d.cupos.estaEnElLibro(pago.cuenta)) {
      return no(403, { motivo: "cuenta-ajena" });
    }

    // Lo que no pide la red: lo que Horizon ya dijo que fallaría, y los topes de las tablas con los ganadores que pueda tener el
    // sorteo (el máximo). Un pago de esa cuenta que sigue en el aire se le pregunta a la red: si ya entró, deja pasar.
    const tope = this.frenoDeFallaria(pago.cuenta);
    if (tope) {
      return no(429, tope);
    }
    const provisional = await this.frenoAhora(this.pedido(c, null, PUESTO_MAXIMO + 1));
    if (provisional) {
      return this.respuestaDelFreno(provisional, c);
    }

    // El premio: lo que dice la red del sorteo, y con los ganadores de verdad, los topes de nuevo.
    let ganadores = PUESTO_MAXIMO + 1;
    if (forma === "premio") {
      const sorteo = await this.comprobarPremio(c);
      if (!sorteo.ok) {
        return sorteo.respuesta;
      }
      ganadores = sorteo.ganadores;
      const freno = await this.frenoAhora(this.pedido(c, null, ganadores));
      if (freno) {
        return this.respuestaDelFreno(freno, c);
      }
    }

    // La mirada previa en Horizon: cuentas, líneas, saldos y lugar. Si no contesta bien, no se paga.
    const mirada = await mirarParaPagar(d.pedirHorizon, { forma, origen: pago.cuenta, salidas: pago.salidas, nota: pago.nota }, this.memoria);
    if (!mirada.ok) {
      if (mirada.motivo === "red") {
        return no(502, { motivo: "red", detalle: "horizon" });
      }
      this.anotarFallaria(pago.cuenta);
      return no(400, { motivo: "fallaria", detalle: mirada.detalle });
    }
    if (this.reloj() - c.t0 > PLAZO_PARA_RESERVAR_MS) {
      return no(502, { motivo: "red", detalle: "plazo" });
    }

    // Desde acá hasta reservar no hay ningún await: mirar de nuevo y reservar es una sola jugada. El envoltorio se arma antes
    // (es síncrono) para saber el hash de afuera y guardarlo con el pago.
    const envoltorio = this.armarEnvoltorio(c.xdr);
    const ahora = this.reloj();
    const res = d.uso.reservar(this.pedido(c, hex(envoltorio.hash()), ganadores), ahora, this.limites());
    if (!res.ok) {
      return this.respuestaDelFreno(res, c);
    }
    const nacio = !res.yaContado;
    if (nacio) {
      // La alarma se pide ya, antes de limpiar, firmar y mandar: si algo se cae en el medio, la fila no queda sin nadie que la mire.
      this.alQuedarEnElAire();
      this.purgarSinCaerse(ahora);
      this.registrar("pago-reservado", { forma, hash: corto(pago.hash), estimado: this.oferta(pago) });
    } else {
      // Mientras esperábamos a la red, otro pedido del mismo hash lo reservó y hasta pudo cerrarlo.
      const actual = d.uso.buscar(pago.hash);
      if (actual && (actual.estado === "ok" || actual.estado === "fallo")) {
        return this.duplicado(actual, actual.estado);
      }
    }
    return this.mandar(c, envoltorio, nacio);
  }

  // ---------- lo que se mira del pedido ----------

  /** La oferta del envoltorio de comisión: la de inclusión por cada operación y una más, la del propio envoltorio. */
  private oferta(pago: PagoLeido): number {
    return this.d.cfg.inclusionBump * (pago.salidas.length + 1);
  }

  /** Lo que se reserva de este pago. `ganadores` solo se usa en el premio, donde tiene que ser lo que dice el sorteo. */
  private pedido(c: Contexto, envuelta: string | null, ganadores: number): PedidoDePago {
    const { forma, pago } = c;
    const premio = pago.premio;
    return {
      hash: pago.hash,
      envuelta,
      forma,
      cuenta: pago.cuenta,
      delLibro: this.d.cupos.estaEnElLibro(pago.cuenta),
      estimado: this.oferta(pago),
      vence: pago.venceS,
      premio:
        premio === null
          ? null
          : { contrato: this.d.cfg.contractId as string, sorteo: premio.sorteo, puesto: premio.puesto, destino: premio.destino, ganadores },
      costo: forma === "retiro" ? (this.d.cfg.costoRetiro?.monto ?? null) : null,
    };
  }

  /** Las firmas del sobre contra los firmantes y el umbral de la cuenta, leídos de la red. Una respuesta si no valen, o null. */
  private async revisarFirmas(c: Contexto): Promise<Respuesta | null> {
    let autoridad: Autoridad | null;
    try {
      autoridad = autoridadDe(await this.d.red.leerCuenta(c.pago.cuenta));
    } catch (e) {
      if (e instanceof ErrorDeRed) {
        return c.no(502, { motivo: "red", detalle: e.message });
      }
      throw e;
    }
    const v = await firmasDelPago(c.xdr, c.pago, autoridad, this.d.cfg.passphrase);
    return v.ok ? null : c.no(400, { motivo: "no-permitida", razon: v.razon, detalle: v.detalle });
  }

  /**
   * Lo que frena a un pago nuevo según las tablas. Si lo que frena es otro pago de la misma cuenta que sigue en el aire, se le
   * pregunta a la red por ese: si ya entró se cierra y se vuelve a mirar. Si la red no contesta, queda frenado (el lado seguro).
   */
  private async frenoAhora(p: PedidoDePago): Promise<FrenoDePago | null> {
    let freno: FrenoDePago | null = null;
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      freno = this.d.uso.frenoPara(p, this.reloj(), this.limites());
      if (freno === null || freno.motivo !== "otro-en-curso") {
        return freno;
      }
      const enElAire = this.d.uso.buscar(freno.hash);
      if (enElAire === null || (await this.cerrarSiEntro(enElAire)) === null) {
        return freno;
      }
    }
    return freno;
  }

  /** Lo que un freno de las tablas contesta, con lo que el sitio necesita para explicarlo. */
  private respuestaDelFreno(f: FrenoDePago, c: Contexto): Respuesta {
    switch (f.motivo) {
      case "puesto-usado":
        return c.no(409, { motivo: "puesto-usado", hash: f.hash, estado: f.estado === "ok" ? "ok" : "en-camino" });
      case "cupo-sorteo":
        return c.no(409, { motivo: "cupo-sorteo", max: f.max });
      case "otro-en-curso":
        return c.no(409, { motivo: "otro-en-curso", hash: f.hash, vence: f.vence });
      case "cupo-cuenta":
        return c.no(429, { motivo: "cupo-cuenta", que: f.que, liberaEn: f.liberaEn, max: f.max });
      case "destino-frenado":
        return c.no(403, { motivo: "destino-frenado", liberaEn: f.liberaEn });
      case "fondo":
        if (f.detalle === "presupuesto") {
          return c.no(503, { motivo: "fondo", detalle: "presupuesto" });
        }
        if (f.detalle === "rechazos") {
          return c.no(503, { motivo: "fondo", detalle: "rechazos", liberaEn: f.liberaEn });
        }
        // Una hora de la red y no una duración: como `liberaEn`, el sitio espera hasta ese instante.
        return c.no(503, { motivo: "fondo", detalle: "ocupado", reintentarEn: this.reloj() + f.reintentarEn });
    }
  }

  /**
   * El premio: el sorteo se lee de la red y tiene que ser de quien paga, estar sorteado, tener ese puesto y haber sido sellado por
   * el portero. Sin esto, una cuenta del libro con su propio XLM sella por fuera un sorteo de 300 ganadores y se manda 300 pagos
   * sin costo. Si la red no deja leer, no se paga.
   */
  private async comprobarPremio(c: Contexto): Promise<{ ok: true; ganadores: number } | { ok: false; respuesta: Respuesta }> {
    const { pago, no } = c;
    const premio = pago.premio;
    const contrato = this.d.cfg.contractId;
    const id = premio === null ? null : leerNumeroDeSorteo(premio.sorteo);
    if (premio === null || contrato === null || id === null) {
      return { ok: false, respuesta: no(500, { motivo: "interno" }) };
    }
    let s: SorteoEnRed | null;
    try {
      s = await leerSorteo(this.d.red, { passphrase: this.d.cfg.passphrase, contractId: contrato, origen: pago.cuenta }, id);
    } catch (e) {
      if (e instanceof ErrorDeRed) {
        return { ok: false, respuesta: no(502, { motivo: "red", detalle: e.message }) };
      }
      throw e;
    }
    if (s === null) {
      return { ok: false, respuesta: no(403, { motivo: "sorteo-ajeno", detalle: "no-existe" }) };
    }
    if (s.organizador !== pago.cuenta) {
      return { ok: false, respuesta: no(403, { motivo: "sorteo-ajeno", detalle: "otro-organizador" }) };
    }
    if (!s.sorteado) {
      return { ok: false, respuesta: no(409, { motivo: "sin-sortear" }) };
    }
    if (premio.puesto >= s.ganadores) {
      return { ok: false, respuesta: no(400, { motivo: "no-permitida", razon: "puesto", detalle: "no-existe" }) };
    }
    if (this.d.cupos.selloDelPortero(s.organizador, s.huellaLista, s.ronda) === null) {
      return { ok: false, respuesta: no(403, { motivo: "no-es-nuestro" }) };
    }
    return { ok: true, ganadores: s.ganadores };
  }

  // ---------- lo que Horizon dijo que fallaría ----------

  /** El tope de lo que Horizon dijo que fallaría, por cuenta y por hora, si ya se llegó. Se mira antes de ir a Horizon. */
  private frenoDeFallaria(cuenta: string): Cuerpo | null {
    const ahora = this.reloj();
    const recientes = (this.fallarias.get(cuenta) ?? []).filter((ms) => ahora - ms < HORA_MS);
    if (recientes.length === 0) {
      this.fallarias.delete(cuenta);
      return null;
    }
    this.fallarias.set(cuenta, recientes);
    if (recientes.length < FALLARIA_POR_CUENTA_HORA) {
      return null;
    }
    return { motivo: "cupo-cuenta", que: "fallaria", liberaEn: (recientes[0] as number) + HORA_MS, max: FALLARIA_POR_CUENTA_HORA };
  }

  private anotarFallaria(cuenta: string): void {
    const ahora = this.reloj();
    if (this.fallarias.size > LIMPIAR_DESDE) {
      for (const [k, lista] of this.fallarias) {
        if (lista.every((ms) => ahora - ms >= HORA_MS)) {
          this.fallarias.delete(k);
        }
      }
    }
    const recientes = (this.fallarias.get(cuenta) ?? []).filter((ms) => ahora - ms < HORA_MS);
    recientes.push(ahora);
    this.fallarias.set(cuenta, recientes);
  }

  // ---------- envolver y mandar ----------

  /** El fee-bump de la cuenta que paga, sin firmar: con él se sabe el hash de afuera antes de reservar. */
  private armarEnvoltorio(xdrBase64: string): FeeBumpTransaction {
    const passphrase = this.d.cfg.passphrase;
    const interna = TransactionBuilder.fromXDR(xdrBase64, passphrase) as Transaction;
    // La oferta de inclusión es la nuestra: el evaluador ya exigió que la interna no declare más de 1000 por operación.
    return TransactionBuilder.buildFeeBumpTransaction(this.d.cuentaPatrocinadora as string, String(this.d.cfg.inclusionBump), interna, passphrase);
  }

  /** Firma el envoltorio con la llave del Worker, que pesa 1: alcanza para pagar una comisión y para nada más. */
  private async firmarEnvoltorio(envoltorio: FeeBumpTransaction): Promise<void> {
    const f = this.d.firmante as Firmante;
    const firma = await f.firmar(envoltorio.hash());
    envoltorio.addSignature(f.clavePublica, btoa(String.fromCharCode(...firma)));
  }

  /**
   * Firma y manda el envoltorio. `nacio` dice si la fila de este pago se reservó en este mismo pedido: solo en ese caso se
   * puede devolver, porque nada más la reservó este pedido y nada la mandó antes. Si ya estaba en el aire, una respuesta de la
   * red que no sea tomarla casi siempre quiere decir que ya entró (la secuencia ya se usó): no se devuelve nunca desde acá, la
   * alarma lo confirma con los dos RPC y Horizon.
   */
  private async mandar(c: Contexto, envoltorio: FeeBumpTransaction, nacio: boolean): Promise<Respuesta> {
    const { forma, pago, no } = c;
    const d = this.d;
    const hash = pago.hash;
    let envuelta: string;
    try {
      await this.firmarEnvoltorio(envoltorio);
      envuelta = envoltorio.toXDR();
    } catch (e) {
      if (nacio) {
        d.uso.devolver(hash);
      }
      this.registrar("error-interno", { donde: "envolver-pago", forma, hash: corto(hash), error: nombreDe(e) });
      return no(500, { motivo: "interno" });
    }
    let envio;
    try {
      envio = await d.red.enviar(envuelta);
    } catch (e) {
      // No se sabe si llegó: queda reservado y la alarma le pregunta a la red por su hash.
      this.alQuedarEnElAire();
      this.registrar("error-envio", { forma, hash: corto(hash), error: e instanceof ErrorDeRed ? e.message.slice(0, 80) : "desconocido" });
      if (e instanceof ErrorDeRed) {
        return no(502, { motivo: "red", detalle: e.message });
      }
      throw e;
    }
    if (envio.status === "PENDING" || envio.status === "DUPLICATE") {
      d.uso.marcarEnviado(hash);
      this.alQuedarEnElAire();
      this.registrar("pago-enviado", { forma, hash: corto(hash), red: envio.status });
      return resp(200, { hash, forma, vence: pago.venceS, status: envio.status, estado: "en-camino" });
    }
    if (!nacio) {
      this.alQuedarEnElAire();
      return resp(200, { hash, forma, vence: pago.venceS, status: "DUPLICATE", estado: "en-camino" });
    }
    // Una secuencia ya usada puede ser la de este mismo pago: el primer RPC lo tomó, se cortó antes de contestar, entró en el
    // ledger siguiente y el segundo RPC dice txBadSeq. Antes de devolverlo se le pregunta a cada RPC: si alguno lo tiene, se
    // cierra con lo que diga. Devolverlo diría que no salió, y el sitio armaría otro pago del mismo premio.
    const fila = envio.codigo && /txBadSeq/.test(envio.codigo) ? d.uso.buscar(hash) : null;
    const entro = fila ? await this.entroRecien(fila) : null;
    if (entro !== null) {
      return resp(200, { hash, forma, vence: pago.venceS, status: "DUPLICATE", estado: entro });
    }
    // La red no lo tomó: no entró a ningún ledger y no se cobró nada. El puesto y el lugar de la cuenta vuelven.
    d.uso.devolver(hash);
    this.registrar("pago-devuelto", { forma, hash: corto(hash), motivo: envio.codigo ?? envio.status });
    if (envio.status === "TRY_AGAIN_LATER") {
      return no(502, { motivo: "red", detalle: "TRY_AGAIN_LATER" });
    }
    if (envio.codigo && /InsufficientBalance|InsufficientFee/.test(envio.codigo)) {
      return no(503, { motivo: "fondo", detalle: "saldo", codigo: envio.codigo });
    }
    return no(400, { motivo: "rechazada", codigo: envio.codigo ?? "desconocido" });
  }

  // ---------- lo que quedó en el aire ----------

  /** Cierra un pago con lo que dice la red de una transacción que entró: salió bien o falló, y la red cobró igual. */
  private cerrarConLaRed(f: FilaDePago, c: Consulta): "ok" | "fallo" {
    const estado = c.status === "SUCCESS" ? "ok" : "fallo";
    this.d.uso.cerrar(f.hash, estado, c.feeCharged ?? null);
    this.registrar("pago-resultado", { forma: f.forma, hash: corto(f.hash), estado, real: c.feeCharged ?? 0 });
    return estado;
  }

  /**
   * Si un pago que la red acaba de rechazar por su secuencia ya entró: se le pregunta a cada RPC a la vez, con
   * `ESPERA_CONFIRMAR_MS` como mucho, y si alguno lo tiene se cierra con lo que diga. null si ninguno lo tiene o no contestó a
   * tiempo: entonces se devuelve, como dice la red. Se pregunta a cada uno por separado porque el que tomó el pago puede ser el
   * que se cortó, y el cliente de la lista se queda con la primera respuesta que recibe.
   */
  private async entroRecien(f: FilaDePago): Promise<"ok" | "fallo" | null> {
    const preguntar = async (red: Pick<Red, "consultar">): Promise<Consulta | null> => {
      try {
        const c = await red.consultar(f.hash, AbortSignal.timeout(ESPERA_CONFIRMAR_MS));
        return c.status === "NOT_FOUND" ? null : c;
      } catch (e) {
        if (e instanceof ErrorDeRed) {
          return null;
        }
        throw e;
      }
    };
    const respuestas = await Promise.all(this.d.redesSueltas.map(preguntar));
    const encontrada = respuestas.find((c): c is Consulta => c !== null);
    return encontrada ? this.cerrarConLaRed(f, encontrada) : null;
  }

  /** Borra lo viejo de las tablas. Si no se puede, se anota y se sigue: limpiar nunca es razón para no mandar ni para no cerrar. */
  private purgarSinCaerse(ahora: number): void {
    try {
      this.d.uso.purgar(ahora);
    } catch (e) {
      this.registrar("error-interno", { donde: "purgar-pagos", error: nombreDe(e) });
    }
  }

  /** Le pregunta a la red por un pago y, si ya entró, lo cierra. null si no aparece o si la red no contesta. */
  private async cerrarSiEntro(f: FilaDePago): Promise<"ok" | "fallo" | null> {
    try {
      const c = await this.d.red.consultar(f.hash);
      return c.status === "NOT_FOUND" ? null : this.cerrarConLaRed(f, c);
    } catch (e) {
      if (e instanceof ErrorDeRed) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Un pago que venció hace más de diez minutos y la red todavía no dice que entró: antes de devolverlo se le pregunta a cada
   * RPC por separado (un RPC atrasado contesta `NOT_FOUND` por algo que ya entró, y el cliente se queda con la primera respuesta
   * que recibe) y a Horizon. Si alguno lo tiene, se cierra con lo que diga. Solo se devuelve si todos dicen que no está. Si
   * alguno no contesta, queda en el aire hasta la vuelta siguiente: en un premio, devolver algo que entró libera el puesto de algo
   * pagado y se paga dos veces.
   */
  private async confirmarQueNoEntro(f: FilaDePago): Promise<void> {
    const redes = this.d.redesSueltas;
    if (redes.length === 0) {
      return;
    }
    let sinContestar = false;
    for (const red of redes) {
      try {
        const c = await red.consultar(f.hash);
        if (c.status !== "NOT_FOUND") {
          this.cerrarConLaRed(f, c);
          return;
        }
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) {
          throw e;
        }
        sinContestar = true;
      }
    }
    const enHorizon = await estaEnHorizon(this.d.pedirHorizon, f.hash);
    if (enHorizon === null) {
      sinContestar = true;
    } else if (enHorizon.esta) {
      const estado = enHorizon.ok ? "ok" : "fallo";
      this.d.uso.cerrar(f.hash, estado, enHorizon.cobrado);
      this.registrar("pago-resultado", { forma: f.forma, hash: corto(f.hash), estado, real: enHorizon.cobrado ?? 0 });
      return;
    }
    if (sinContestar) {
      return;
    }
    this.d.uso.devolver(f.hash);
    this.registrar("pago-devuelto", { forma: f.forma, hash: corto(f.hash), motivo: "vencida-sin-aparecer" });
  }

  /**
   * Le pregunta a la red qué fue de lo que mandamos y todavía no sabemos. Entró: se cierra con lo que cobró la red, salga bien o
   * mal. No entró y ya pasó el margen: se confirma con los dos RPC y Horizon antes de devolverlo. Devuelve si queda algo en el aire.
   */
  async reconciliar(): Promise<boolean> {
    const ahora = this.reloj();
    const pendientes = this.d.uso.pendientes(ahora - ESPERA_RECONCILIAR_MS);
    for (const f of pendientes) {
      try {
        const c = await this.d.red.consultar(f.hash);
        if (c.status === "SUCCESS" || c.status === "FAILED") {
          this.cerrarConLaRed(f, c);
        } else if (Math.floor(ahora / 1000) > f.vence + MARGEN_VENCIMIENTO_S) {
          await this.confirmarQueNoEntro(f);
        }
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) {
          throw e;
        }
        // Sin red: se vuelve a intentar en la próxima vuelta.
      }
    }
    this.purgarSinCaerse(ahora);
    const quedan = this.d.uso.enElAire();
    // Sin nada que mirar ni nada en el aire, la vuelta no deja rastro: con los pagos apagados la bitácora es la de siempre.
    if (pendientes.length > 0 || quedan > 0) {
      this.registrar("alarma-pagos", { enElAire: quedan });
    }
    return quedan > 0;
  }

  // ---------- lo que se ve de afuera ----------

  /**
   * El bloque `pagos` de `/v1/patrocinio/cupo`, o null si ninguna forma está prendida en la configuración (entonces `/cupo` es
   * el de siempre). Dice qué formas atendería el portero ahora (la variable, la pausa, el modo, la configuración y las tablas),
   * el costo del retiro que exige y el pago de esta cuenta que sigue en el aire, si lo hay. El sitio lo mira antes de pedir una
   * firma, que le cuesta créditos a Tinkazo.
   */
  cupoDe(cuenta: string): Cuerpo | null {
    const cfg = this.d.cfg;
    if (!pagosPrendidos(cfg)) {
      return null;
    }
    const enCurso = this.d.uso.disponible() ? this.d.uso.enElAireDe(cuenta) : null;
    return {
      premio: this.atiende("premio"),
      retiro: this.atiende("retiro"),
      // El alta de quien ganó la conoce la puerta de las altas: el objeto (`index.ts`) pone acá si se atendería ahora.
      altaPremio: false,
      costoRetiro: cfg.retiros && cfg.costoRetiro ? { usdc: cfg.costoRetiro.usdc, monto: cfg.costoRetiro.monto } : null,
      enCurso: enCurso ? { hash: enCurso.hash, forma: enCurso.forma, vence: enCurso.vence } : null,
    };
  }

  /**
   * El bloque `pagos` de `/v1/patrocinio/estado`, o null si no hay nada que mostrar: ninguna forma prendida, ningún pago en las
   * últimas 24 horas y ninguna pausa puesta. Solo cifras, sin cuentas ni sorteos. `costos` da cuántos costos de retiro cobró la
   * cuenta de cobros y cuánto suman, en diezmillonésimas de USDC.
   */
  resumenDeEstado(ahora: number, costos: (desde: number) => { cuantos: number; monto: number }): Cuerpo | null {
    const cfg = this.d.cfg;
    if (!this.d.uso.disponible()) {
      return null;
    }
    const pausas = { premio: this.pausada("premio"), retiro: this.pausada("retiro"), altaPremio: this.pausada("alta-premio") };
    const r = this.d.uso.resumen(ahora);
    const hubo = r.gasto24h > 0 || r.enElAire > 0;
    if (!pagosPrendidos(cfg) && !hubo && !pausas.premio && !pausas.retiro && !pausas.altaPremio) {
      return null;
    }
    const lim = this.limites();
    const cobrado = costos(ahora - DIA_MS);
    const costo = cfg.costoRetiro ? { usdc: cfg.costoRetiro.usdc, monto: cfg.costoRetiro.monto } : null;
    return {
      premio: { prendido: cfg.pagosPremio, pausado: pausas.premio, ...r.premio },
      retiro: { prendido: cfg.retiros, pausado: pausas.retiro, ...r.retiro, costo },
      // El alta de quien ganó la conoce la puerta de las altas: el objeto (`index.ts`) pone acá si está prendida y cuántas se dieron.
      altaPremio: { prendido: false, pausado: pausas.altaPremio, hoy: 0 },
      gasto24h: r.gasto24h,
      topeStroops: lim.topePagos,
      rechazosPorDia: lim.rechazosPorDia,
      altasPremioDia: topeEnCaliente(this.d.cupos.ajuste(AJUSTE_ALTAS_PREMIO_DIA), cfg.altasPremioDia, TECHO_ALTAS_PREMIO_DIA),
      costosRetiro24h: cobrado.cuantos,
      cobradoRetiros24h: usdcTexto(cobrado.monto),
    };
  }
}

// ---------- fuera de la clase, para probarlo sin el objeto de Cloudflare ----------

/** Una parte de lo que hace la alarma: los sellos o los pagos. */
export interface ParteDeAlarma {
  /** Cómo se anota si lanza: `alarma-sellos` o `alarma-pagos`. */
  donde: "alarma-sellos" | "alarma-pagos";
  /** Devuelve si queda algo en el aire. */
  correr: () => Promise<boolean>;
}

/**
 * Una vuelta de la alarma: corre cada parte en su propio try/catch, así una que lance no deja sin cerrar lo de la otra. Anota
 * `error-interno` con la parte que lanzó. Devuelve si hay que volver a pedir la alarma: si alguna parte tiene algo en el aire
 * o si alguna lanzó (lo que quedó en el aire sigue en el aire).
 */
export async function vueltaDeAlarma(partes: readonly ParteDeAlarma[], registrar: Registrar): Promise<boolean> {
  let otraVuelta = false;
  for (const parte of partes) {
    try {
      if (await parte.correr()) {
        otraVuelta = true;
      }
    } catch (e) {
      registrar("error-interno", { donde: parte.donde, error: nombreDe(e) });
      otraVuelta = true;
    }
  }
  return otraVuelta;
}

/**
 * Arma el portero de los pagos adentro de un try/catch: si algo lanza, devuelve null y lo anota. Sin servicio, la ruta contesta
 * `503 apagado` y los sellos siguen como siempre. Las dependencias entran como una función para que lo que lance al armarlas
 * también se atrape.
 */
export function armarPorteroDePagos(dependencias: () => DependenciasDePagos, registrar: Registrar): PorteroDePagos | null {
  try {
    return new PorteroDePagos(dependencias());
  } catch {
    registrar("error-config", { faltaAltas: "pagos" });
    return null;
  }
}
