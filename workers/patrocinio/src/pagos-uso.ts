/**
 * Lo que el portero guarda de los pagos clásicos que paga: el pago de un premio y el retiro con su costo. Son dos tablas en
 * el mismo SQLite del objeto:
 *
 * - `pagos_portero`: una fila por transacción, con la forma, la cuenta que paga, su estado y lo que se estima y lo que cobró
 *   la red de comisión. Es lo que decide si un pago se puede reservar (los topes) y lo que cierra la alarma. Se purga.
 * - `retiros_cobrados`: el hash de cada retiro que se pagó, con la cuenta y el costo exacto que exigía. No se purga. Es lo que
 *   `cobros.ts` usa para reconocer, por la transacción, el pago del costo que llega a la cuenta de cobros, sin mirar su nota.
 *
 * Los pagos van en tablas propias y no en `uso` a propósito: `Cupos.reservar` trata todo lo que no es un sello como un sorteo
 * y `gastoDeLaVentana` suma toda la tabla `uso`. Un presupuesto aparte hace que un abuso de pagos no deje sin sellos al
 * evento y al revés.
 *
 * Las tablas no se crean en el constructor de `Cupos`: un `CREATE` que lanzara ahí tumbaría el objeto entero y con él todos
 * los sellos. Cada una se crea acá con su propio try/catch (como `Cupos.sumarColumnas` hace con las columnas). Si algo falla,
 * `disponible()` da false, `faltan()` lo nombra y quien llama deja apagado lo suyo. El constructor nunca lanza.
 *
 * Es código síncrono a propósito, como `cupos.ts`: un objeto de Cloudflare atiende de a uno mientras no haya un `await`, así
 * que mirar los topes y reservar es una sola jugada. Treinta pedidos a la vez del mismo puesto no pasan de uno. El reloj
 * entra como argumento (`ahora`, en ms) y los topes que se mueven en caliente también (`LimitesDePagos`).
 *
 * Nunca guarda la dirección de quien recibe un premio: solo una huella que no sirve para pagar ni protege nada (las cuentas
 * son públicas), pero deja las direcciones fuera del exporte.
 */
import { hash } from "@stellar/stellar-sdk/base";
import { type Config, DIA_MS, TECHO_PAGOS_RECHAZADOS_DIA, TECHO_TOPE_PAGOS_STROOPS } from "./config";
import { type Estado, PURGA_USO_MS, type Sql } from "./cupos";
import { type FormaDePago, PUESTO_MAXIMO } from "./pagos-lista";
import type { Registrar } from "./registrador";

// Los topes que viven en el código: cambiarlos pide un commit y un despliegue, como `DEVOLUCIONES_POR_DIA` del sello.

/** Retiros que acepta una cuenta en 24 horas. Quien gana retira una o dos veces. */
export const RETIROS_POR_CUENTA_DIA = 10;
/** Retiros de una cuenta que la red rechazó al aplicarlos en 24 horas: cada uno cuesta una comisión y no trae el costo. */
export const RETIROS_RECHAZADOS_POR_CUENTA_DIA = 2;
/** Premios que paga una cuenta en 24 horas: cada uno es una firma de 20 créditos que cuenta como explicada. */
export const PREMIOS_POR_ORGANIZADOR_DIA = 60;
/** Lo más que se paga por un sorteo. El tope de verdad es el menor entre esto y la cantidad de ganadores. */
export const PREMIOS_POR_SORTEO = 50;
/** Premios de una cuenta que la red rechazó al aplicarlos en 24 horas. Frena solo a esa cuenta. */
export const PREMIOS_RECHAZADOS_POR_ORGANIZADOR_DIA = 5;
/** Premios hacia un mismo destino que la red rechazó al aplicarlos en 24 horas: protege a quien organiza de un ganador malicioso. */
export const PREMIOS_RECHAZADOS_POR_DESTINO_DIA = 2;
/** Intentos de una cuenta que la red no tomó (devueltos) en 24 horas, sumando las dos formas. */
export const DEVUELTOS_POR_CUENTA_DIA = 10;
/** Lo que Horizon dice que fallaría, por cuenta y por hora. Lo cuenta el servicio en memoria, antes de ir a Horizon. */
export const FALLARIA_POR_CUENTA_HORA = 20;
/** Cuánto espera quien se topa con demasiados pagos de su forma en el aire a la vez, en ms. */
export const REINTENTAR_OCUPADO_MS = 5_000;
/**
 * Los pagos de una forma que pueden estar en el aire a la vez, entre todas las cuentas. Es aparte del tope de los fallos del día
 * y más alto: un pago en el aire que nunca entra no cuesta comisión, y si compartiera ese tope, veinte cuentas con un retiro en el
 * aire cada una (y su secuencia gastada por fuera) trabarían los retiros de todos sin gastar nada. El gasto de verdad lo siguen
 * frenando el presupuesto, que cuenta lo del aire por lo que ofrece, y el tope de los fallos.
 */
export const EN_EL_AIRE_POR_FORMA = 60;
/**
 * Cuánto después de su vencimiento (en segundos) un pago en el aire deja de ocupar lugar en `EN_EL_AIRE_POR_FORMA`: pasado su
 * `maxTime` la red ya no lo aplica, así que no puede cobrar nada. Sigue en el aire para su puesto y su cuenta hasta que la alarma
 * lo confirme. El margen cubre un reloj de la red atrasado.
 */
export const MARGEN_OCUPADO_S = 60;
/**
 * Los pagos de una cuenta que quedaron en el aire y nunca entraron (vencieron y la alarma los devolvió), por hora. Es lo que hace
 * quien manda un pago válido y después gasta su secuencia por fuera: no le cuesta nada y ocupa un lugar en el aire. Cuentan los que
 * la red tomó y también los que quedaron en duda (TRY_AGAIN_LATER con otra transacción de la cuenta en la cola, por ejemplo), que
 * ocupan el mismo lugar. Frena solo a esa cuenta.
 */
export const EN_EL_AIRE_SIN_ENTRAR_POR_CUENTA_HORA = 2;
/** Cuántos pagos en el aire mira la alarma en cada vuelta, como mucho. */
export const PENDIENTES_POR_VUELTA = 50;

const HORA_MS = 3_600_000;

// Los ajustes en caliente, en la tabla `ajustes` de `cupos.ts`. Los escribe administración sin desplegar. Cada tope tiene techo.

/** El presupuesto de las comisiones de los pagos, en stroops. Techo: `TECHO_TOPE_PAGOS_STROOPS`. */
export const AJUSTE_TOPE_PAGOS = "tope_pagos_stroops";
/** Los pagos por forma que la red rechazó al aplicarlos en 24 horas. Techo: `TECHO_PAGOS_RECHAZADOS_DIA`. */
export const AJUSTE_RECHAZOS_DIA = "pagos_rechazos_dia";
/** Las altas de quien ganó que se aceptan en 24 horas. Techo: `TECHO_ALTAS_PREMIO_DIA`. */
export const AJUSTE_ALTAS_PREMIO_DIA = "altas_premio_dia";
/** Con `"1"`, esa forma queda pausada sin desplegar: no corta sellos, sorteos ni el reenvío de lo que ya está reservado. */
export const AJUSTES_DE_PAUSA = {
  premio: "pagos_premio_pausado",
  retiro: "retiros_pausado",
  "alta-premio": "altas_premio_pausado",
} as const;

/** Los estados que gastan presupuesto: lo devuelto (que la red no tomó) no cuenta. */
const GASTAN = "('reservado','enviado','ok','fallo')";
/** Los estados en que un pago sigue en el aire. */
const EN_EL_AIRE = "('reservado','enviado')";
/** Los estados que ocupan el puesto de un premio: el que está en el aire y el que entró bien. */
const OCUPAN_PUESTO = "('reservado','enviado','ok')";
/** Los premios de un sorteo que cuentan para su tope, y el que ocupa un puesto: el contrato, el número y el puesto. */
const DEL_SORTEO = `forma = 'premio' AND contrato = ? AND sorteo = ? AND estado IN ${OCUPAN_PUESTO}`;
/** Un hash de transacción en hexadecimal minúscula. */
const HASH = /^[0-9a-f]{64}$/;

const COLUMNAS_PAGOS = [
  "hash TEXT PRIMARY KEY",
  "envuelta TEXT",
  "forma TEXT NOT NULL",
  "cuenta TEXT NOT NULL",
  "del_libro INTEGER NOT NULL",
  "contrato TEXT",
  "sorteo TEXT",
  "puesto INTEGER",
  "destino_huella TEXT",
  "creado INTEGER NOT NULL",
  "estado TEXT NOT NULL",
  "estimado INTEGER NOT NULL",
  "real INTEGER",
  "vence INTEGER NOT NULL",
  // Desde cuándo quedó en el aire, en ms: cuando la red lo tomó (PENDING o DUPLICATE) o cuando su respuesta fue una duda que no
  // se devuelve. null si todavía no: lo que separa un pago que estuvo en el aire y no entró de uno que la red rechazó al recibirlo.
  "tomado INTEGER",
];

const COLUMNAS_RETIROS = ["hash TEXT PRIMARY KEY", "envuelta TEXT", "cuenta TEXT NOT NULL", "costo INTEGER NOT NULL", "ms INTEGER NOT NULL"];

/** Lo que se crea, cada cosa con su nombre: así `faltan()` dice cuál no se pudo. Primero las tablas y después sus índices. */
const CREACIONES: ReadonlyArray<readonly [nombre: string, consulta: string]> = [
  ["pagos_portero", `CREATE TABLE IF NOT EXISTS pagos_portero (${COLUMNAS_PAGOS.join(", ")})`],
  ["retiros_cobrados", `CREATE TABLE IF NOT EXISTS retiros_cobrados (${COLUMNAS_RETIROS.join(", ")})`],
  ["pagos_portero_cuenta", "CREATE INDEX IF NOT EXISTS pagos_portero_cuenta ON pagos_portero (cuenta, creado)"],
  ["pagos_portero_creado", "CREATE INDEX IF NOT EXISTS pagos_portero_creado ON pagos_portero (creado)"],
  ["pagos_portero_estado", "CREATE INDEX IF NOT EXISTS pagos_portero_estado ON pagos_portero (estado)"],
  [
    "pagos_portero_destino",
    "CREATE INDEX IF NOT EXISTS pagos_portero_destino ON pagos_portero (destino_huella, creado) WHERE destino_huella IS NOT NULL",
  ],
  [
    "pagos_portero_puesto",
    [
      "CREATE UNIQUE INDEX IF NOT EXISTS pagos_portero_puesto ON pagos_portero (contrato, sorteo, puesto)",
      "WHERE forma = 'premio' AND estado IN ('reservado','enviado','ok')",
    ].join(" "),
  ],
  ["retiros_cobrados_envuelta", "CREATE INDEX IF NOT EXISTS retiros_cobrados_envuelta ON retiros_cobrados (envuelta)"],
];

/** Un pago guardado, con los nombres del código. */
export interface FilaDePago {
  /** El hash de la transacción interna, la que firma la persona, en hexadecimal. */
  hash: string;
  /** El hash del fee-bump con que el portero la envolvió, o null si todavía no se armó. */
  envuelta: string | null;
  forma: FormaDePago;
  /** La cuenta G que paga. */
  cuenta: string;
  /** Si la cuenta estaba en el libro al reservar: solo esas firmas se explican en la vigilancia. */
  delLibro: boolean;
  /** Premio: el contrato oficial de ese momento, y el número y el puesto del sorteo. Null en el retiro. */
  contrato: string | null;
  sorteo: string | null;
  puesto: number | null;
  /** Premio: la huella del destino, no su dirección. */
  destinoHuella: string | null;
  creado: number;
  estado: Estado;
  /** Lo que ofrece el envoltorio de comisión, en stroops. */
  estimado: number;
  /** Lo que cobró la red, en stroops, cuando se sabe. */
  real: number | null;
  /** Hasta cuándo vale la transacción (`maxTime`), en segundos de la red. */
  vence: number;
  /** Desde cuándo quedó en el aire (la tomó la red o quedó en duda), en ms, o null si no (o se volvió a reservar después de devuelta). */
  tomado: number | null;
}

/** Lo que hace falta para reservar un pago. */
export interface PedidoDePago {
  /** El hash de la transacción interna. */
  hash: string;
  /** El hash del fee-bump, que ya se arma antes de reservar para saber el de afuera. */
  envuelta: string | null;
  forma: FormaDePago;
  cuenta: string;
  /** Si la cuenta está en el libro ahora. */
  delLibro: boolean;
  /** Lo que ofrece el envoltorio de comisión, en stroops: es lo que se reserva del presupuesto. */
  estimado: number;
  vence: number;
  /** El premio: de qué sorteo y puesto, a quién y cuántos ganadores tiene el sorteo. Obligatorio en el premio. */
  premio: { contrato: string; sorteo: string; puesto: number; destino: string; ganadores: number } | null;
  /** El retiro: el costo exacto que exige la segunda operación, en diezmillonésimas de USDC. Obligatorio en el retiro. */
  costo: number | null;
}

/** Los topes que se mueven en caliente: los resuelve quien llama (la variable o el ajuste) y siempre con su techo. */
export interface LimitesDePagos {
  /** El presupuesto de las comisiones de los pagos en 24 horas, en stroops. */
  topePagos: number;
  /** Los pagos por forma que la red rechazó al aplicarlos en 24 horas, entre todas las cuentas. Lo del aire tiene su propio tope. */
  rechazosPorDia: number;
}

/** Por qué un pago no se puede reservar. Cada uno lleva lo que el sitio necesita para explicarlo. */
export type FrenoDePago =
  | { motivo: "puesto-usado"; hash: string; estado: Estado }
  | { motivo: "cupo-sorteo"; max: number }
  | { motivo: "otro-en-curso"; hash: string; vence: number }
  | { motivo: "cupo-cuenta"; que: "intentos" | "rechazos" | "retiros" | "premios"; liberaEn: number; max: number }
  | { motivo: "destino-frenado"; liberaEn: number }
  | { motivo: "fondo"; detalle: "presupuesto" }
  | { motivo: "fondo"; detalle: "rechazos"; liberaEn: number }
  | { motivo: "fondo"; detalle: "ocupado"; reintentarEn: number };

export type ReservadoDePago = { ok: true; yaContado: boolean } | ({ ok: false } & FrenoDePago);

/** Lo que cuenta una forma en el día, para `/estado`. Sin cuentas ni sorteos. */
export interface ResumenDeUnaForma {
  enElAire: number;
  ok24h: number;
  fallo24h: number;
}

export interface ResumenDePagos {
  /** Lo gastado en las últimas 24 horas, en stroops: lo real si se sabe, lo estimado si no. */
  gasto24h: number;
  enElAire: number;
  premio: ResumenDeUnaForma;
  retiro: ResumenDeUnaForma;
}

/**
 * El valor de un tope que se mueve en caliente: el ajuste si está bien escrito (solo dígitos, de 1 hasta el techo) y, si no, el
 * de la configuración. Un número más grande que el techo es un error de tipeo (un cero de más) y no un tope: se ignora, así
 * un tope nunca crece sin aviso. Un cero tampoco: para frenar una forma está la pausa.
 */
export function topeEnCaliente(ajuste: string | undefined, deLaConfig: number, techo: number): number {
  if (ajuste === undefined || !/^\d{1,12}$/.test(ajuste)) {
    return deLaConfig;
  }
  const n = Number(ajuste);
  return n >= 1 && n <= techo ? n : deLaConfig;
}

/** Los topes de los pagos que valen ahora: los de la configuración, o los que administración cambió en caliente. */
export function limitesDePagos(cfg: Pick<Config, "topePagos" | "pagosRechazadosDia">, ajuste: (clave: string) => string | undefined): LimitesDePagos {
  return {
    topePagos: topeEnCaliente(ajuste(AJUSTE_TOPE_PAGOS), cfg.topePagos, TECHO_TOPE_PAGOS_STROOPS),
    rechazosPorDia: topeEnCaliente(ajuste(AJUSTE_RECHAZOS_DIA), cfg.pagosRechazadosDia, TECHO_PAGOS_RECHAZADOS_DIA),
  };
}

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * La huella de un destino: los primeros 32 caracteres hexadecimales del SHA-256 de `tinkazo:destino:<G>`. No protege nada
 * (las cuentas son públicas y el pago está en la cadena): solo deja la dirección fuera del exporte en claro.
 */
export function huellaDeDestino(destino: string): string {
  return hex(hash(`tinkazo:destino:${destino}`)).slice(0, 32);
}

/** Un entero seguro, de `min` para arriba. */
function entero(x: unknown, min: number): boolean {
  return typeof x === "number" && Number.isSafeInteger(x) && x >= min;
}

/** Un texto con algo adentro. */
function conTexto(x: unknown): boolean {
  return typeof x === "string" && x.length > 0;
}

/**
 * Lo que se exige de quien llama antes de mirar los topes. Un pedido mal armado es un error del código y no de la persona:
 * lanza, y quien llama contesta un error sin pagar nada. Hace falta porque toda comparación con un `NaN` da falso: un
 * presupuesto, un tope o una cantidad de ganadores que no fuera un número dejaría pasar todo en silencio.
 *
 * - Los topes: enteros desde 0. Un tope en 0 frena todo, que es el lado seguro.
 * - El pedido: un hash de verdad (es lo que reconoce el costo), la oferta y el vencimiento enteros y positivos.
 * - El premio: sin costo, con su contrato y su sorteo, entre 1 y 300 ganadores y un puesto que existe en ese sorteo. El
 *   servicio contesta `puesto` antes de llegar acá: esto es la segunda red.
 * - El retiro: sin premio y con un costo entero y positivo.
 */
function revisarPedido(p: PedidoDePago, lim: LimitesDePagos): void {
  if (!entero(lim.topePagos, 0) || !entero(lim.rechazosPorDia, 0)) {
    throw new Error("pago-topes");
  }
  const sobre = HASH.test(p.hash) && (p.envuelta === null || HASH.test(p.envuelta)) && conTexto(p.cuenta);
  if (!sobre || !entero(p.estimado, 1) || !entero(p.vence, 1)) {
    throw new Error("pago-forma");
  }
  if (p.forma === "premio") {
    const r = p.premio;
    if (r === null || p.costo !== null || !conTexto(r.contrato) || !conTexto(r.sorteo) || !conTexto(r.destino)) {
      throw new Error("pago-forma");
    }
    if (!entero(r.ganadores, 1) || r.ganadores > PUESTO_MAXIMO + 1 || !entero(r.puesto, 0) || r.puesto >= r.ganadores) {
      throw new Error("pago-forma");
    }
    return;
  }
  if (p.forma !== "retiro" || p.premio !== null || !entero(p.costo, 1)) {
    throw new Error("pago-forma");
  }
}

function filaDePago(f: Record<string, unknown>): FilaDePago {
  const nulo = (x: unknown) => x === null || x === undefined;
  return {
    hash: String(f.hash),
    envuelta: nulo(f.envuelta) ? null : String(f.envuelta),
    forma: String(f.forma) as FormaDePago,
    cuenta: String(f.cuenta),
    delLibro: Number(f.del_libro) === 1,
    contrato: nulo(f.contrato) ? null : String(f.contrato),
    sorteo: nulo(f.sorteo) ? null : String(f.sorteo),
    puesto: nulo(f.puesto) ? null : Number(f.puesto),
    destinoHuella: nulo(f.destino_huella) ? null : String(f.destino_huella),
    creado: Number(f.creado),
    estado: String(f.estado) as Estado,
    estimado: Number(f.estimado),
    real: nulo(f.real) ? null : Number(f.real),
    vence: Number(f.vence),
    tomado: nulo(f.tomado) ? null : Number(f.tomado),
  };
}

/** Dónde quedó una vuelta de la alarma: la fila que miró última, por su orden (`creado` y después `hash`). */
export interface PuntoDeLaRonda {
  creado: number;
  hash: string;
}

/** Las filas que van después de un punto de la ronda, o todas si no hay punto: con `enlacesDe`. */
const DESPUES_DE = "(? IS NULL OR creado > ? OR (creado = ? AND hash > ?))";

/** Los enlaces de `DESPUES_DE`, en su orden. */
function enlacesDe(p: PuntoDeLaRonda | null): unknown[] {
  return p === null ? [null, 0, 0, ""] : [1, p.creado, p.creado, p.hash];
}

/** Cuántas filas cumplen una condición y cuál es la hora de la más vieja (para decir cuándo se libera el tope). */
interface Conteo {
  n: number;
  masVieja: number | null;
}

export class UsoDePagos {
  /** Lo que no se pudo crear al arrancar, por nombre. */
  private readonly sinCrear: string[] = [];
  private avisoDeCostoDado = false;

  /**
   * `sql` es el mismo SQLite de `cupos`. `registrar` es la bitácora: solo se usa si leer el costo de un retiro falla o si un
   * premio que se dio por devuelto entró con su puesto ya ocupado por otro pago (`cerrar`).
   */
  constructor(
    private readonly sql: Sql,
    private readonly registrar: Registrar = () => {},
  ) {
    for (const [nombre, consulta] of CREACIONES) {
      try {
        this.sql.exec(consulta);
      } catch {
        this.sinCrear.push(nombre);
      }
    }
    this.sumarTomado();
  }

  /**
   * Una tabla `pagos_portero` creada antes de la columna `tomado` la suma acá, con su propio try/catch. Si no se puede, los
   * pagos quedan apagados (`disponible()` da false y `faltan()` la nombra): sin ella el tope por hora de lo que no entró no se mira.
   */
  private sumarTomado(): void {
    if (this.sinCrear.includes("pagos_portero")) {
      return;
    }
    try {
      const columnas = this.filas("PRAGMA table_info(pagos_portero)").map((f) => String(f.name));
      if (!columnas.includes("tomado")) {
        this.sql.exec("ALTER TABLE pagos_portero ADD COLUMN tomado INTEGER");
      }
    } catch {
      this.sinCrear.push("pagos_portero.tomado");
    }
  }

  /** Si las dos tablas y sus índices están: sin eso no se paga ningún pago. */
  disponible(): boolean {
    return this.sinCrear.length === 0;
  }

  /** Lo que no se pudo crear al arrancar, por nombre. Vacío si está todo. */
  faltan(): string[] {
    return [...this.sinCrear];
  }

  private filas(consulta: string, ...enlaces: unknown[]): Array<Record<string, unknown>> {
    return this.sql.exec(consulta, ...enlaces).toArray();
  }

  private numero(consulta: string, ...enlaces: unknown[]): number {
    return Number(this.filas(consulta, ...enlaces)[0]?.n ?? 0);
  }

  /** Cuenta las filas de `pagos_portero` que cumplen `donde` (un texto fijo, nunca un dato del pedido). */
  private contar(donde: string, ...enlaces: unknown[]): Conteo {
    const f = this.filas(`SELECT COUNT(*) AS n, MIN(creado) AS vieja FROM pagos_portero WHERE ${donde}`, ...enlaces)[0];
    const vieja = f?.vieja;
    return { n: Number(f?.n ?? 0), masVieja: vieja === null || vieja === undefined ? null : Number(vieja) };
  }

  // ---------- lo que se pagó ----------

  /** El pago con ese hash (el de la transacción interna), en el estado que esté. */
  buscar(hashInterno: string): FilaDePago | null {
    const f = this.filas("SELECT * FROM pagos_portero WHERE hash = ?", hashInterno)[0];
    return f ? filaDePago(f) : null;
  }

  /**
   * El pago que ocupa ese puesto de ese sorteo del contrato, o null si está libre. Ocupan el puesto los que están en el aire
   * y los que entraron bien. Uno que entró y falló, o que la red no tomó, no lo ocupa: se puede pagar otra vez. El contrato va
   * porque con uno nuevo los números de sorteo vuelven a empezar en 1.
   */
  puestoUsado(contrato: string, sorteo: string, puesto: number): { hash: string; estado: Estado } | null {
    const f = this.filas(`SELECT hash, estado FROM pagos_portero WHERE ${DEL_SORTEO} AND puesto = ? LIMIT 1`, contrato, sorteo, puesto)[0];
    return f ? { hash: String(f.hash), estado: String(f.estado) as Estado } : null;
  }

  /** El pago de esta cuenta que sigue en el aire, o null. La red guarda una sola transacción pendiente por cuenta de origen. */
  enElAireDe(cuenta: string): FilaDePago | null {
    const f = this.filas(`SELECT * FROM pagos_portero WHERE cuenta = ? AND estado IN ${EN_EL_AIRE} ORDER BY creado LIMIT 1`, cuenta)[0];
    return f ? filaDePago(f) : null;
  }

  /** Lo gastado en las últimas 24 horas, en stroops: lo real si se sabe, lo estimado si no. Lo devuelto no cuenta. */
  gastoDeLaVentana(ahora: number): number {
    const suma = "SELECT COALESCE(SUM(COALESCE(real, estimado)), 0) AS n FROM pagos_portero";
    return this.numero(`${suma} WHERE creado > ? AND estado IN ${GASTAN}`, ahora - DIA_MS);
  }

  /**
   * Lo que frena a un pago nuevo, o null si pasa. No escribe nada: es lo que mira el servicio antes de ir a Horizon y lo que
   * `reservar` vuelve a mirar sin un `await` en el medio. Un pago que ya está contado (reservado, enviado o cerrado) no lo
   * frena nada: ya se aprobó.
   */
  frenoPara(p: PedidoDePago, ahora: number, lim: LimitesDePagos): FrenoDePago | null {
    const previa = this.buscar(p.hash);
    if (previa && previa.estado !== "devuelto") {
      return null;
    }
    return this.frenar(p, ahora, lim);
  }

  /**
   * Los topes, en este orden: el puesto y el sorteo, uno en el aire, los de la cuenta, los generales y el presupuesto. Sin
   * las tablas enteras (una tabla o un índice que no se pudo crear, también el único del puesto) no se reserva nada.
   */
  private frenar(p: PedidoDePago, ahora: number, lim: LimitesDePagos): FrenoDePago | null {
    if (!this.disponible()) {
      throw new Error("pagos-sin-tablas");
    }
    revisarPedido(p, lim);
    const desde = ahora - DIA_MS;
    const dia = (c: Conteo): number => (c.masVieja ?? ahora) + DIA_MS;

    if (p.premio !== null) {
      const premio = p.premio;
      const ocupado = this.puestoUsado(premio.contrato, premio.sorteo, premio.puesto);
      if (ocupado) {
        return { motivo: "puesto-usado", hash: ocupado.hash, estado: ocupado.estado };
      }
      const max = Math.min(premio.ganadores, PREMIOS_POR_SORTEO);
      const delSorteo = this.contar(DEL_SORTEO, premio.contrato, premio.sorteo);
      if (delSorteo.n >= max) {
        return { motivo: "cupo-sorteo", max };
      }
    }

    const delAire = `cuenta = ? AND estado IN ${EN_EL_AIRE} AND hash <> ?`;
    const otro = this.filas(`SELECT hash, vence FROM pagos_portero WHERE ${delAire} LIMIT 1`, p.cuenta, p.hash)[0];
    if (otro) {
      return { motivo: "otro-en-curso", hash: String(otro.hash), vence: Number(otro.vence) };
    }

    const devueltos = this.contar("cuenta = ? AND estado = 'devuelto' AND creado > ?", p.cuenta, desde);
    if (devueltos.n >= DEVUELTOS_POR_CUENTA_DIA) {
      return { motivo: "cupo-cuenta", que: "intentos", liberaEn: dia(devueltos), max: DEVUELTOS_POR_CUENTA_DIA };
    }
    // Los que quedaron en el aire y nunca entraron, en la última hora: el pago válido con la secuencia gastada por fuera.
    const sinEntrar = this.contar("cuenta = ? AND estado = 'devuelto' AND tomado IS NOT NULL AND creado > ?", p.cuenta, ahora - HORA_MS);
    if (sinEntrar.n >= EN_EL_AIRE_SIN_ENTRAR_POR_CUENTA_HORA) {
      const liberaEn = (sinEntrar.masVieja ?? ahora) + HORA_MS;
      return { motivo: "cupo-cuenta", que: "intentos", liberaEn, max: EN_EL_AIRE_SIN_ENTRAR_POR_CUENTA_HORA };
    }
    const esRetiro = p.forma === "retiro";
    const rechazadosMax = esRetiro ? RETIROS_RECHAZADOS_POR_CUENTA_DIA : PREMIOS_RECHAZADOS_POR_ORGANIZADOR_DIA;
    const rechazados = this.contar("cuenta = ? AND forma = ? AND estado = 'fallo' AND creado > ?", p.cuenta, p.forma, desde);
    if (rechazados.n >= rechazadosMax) {
      return { motivo: "cupo-cuenta", que: "rechazos", liberaEn: dia(rechazados), max: rechazadosMax };
    }
    const delDia = this.contar(`cuenta = ? AND forma = ? AND estado IN ${GASTAN} AND creado > ?`, p.cuenta, p.forma, desde);
    const delDiaMax = esRetiro ? RETIROS_POR_CUENTA_DIA : PREMIOS_POR_ORGANIZADOR_DIA;
    if (delDia.n >= delDiaMax) {
      return { motivo: "cupo-cuenta", que: esRetiro ? "retiros" : "premios", liberaEn: dia(delDia), max: delDiaMax };
    }
    if (p.premio !== null) {
      const alDestino = this.contar(
        "forma = 'premio' AND destino_huella = ? AND estado = 'fallo' AND creado > ?",
        huellaDeDestino(p.premio.destino),
        desde,
      );
      if (alDestino.n >= PREMIOS_RECHAZADOS_POR_DESTINO_DIA) {
        return { motivo: "destino-frenado", liberaEn: dia(alDestino) };
      }
    }

    // La última red, entre todas las cuentas y por forma: lo que falló y pagó comisión no pasa de su tope del día.
    const fallados = this.contar("forma = ? AND estado = 'fallo' AND creado > ?", p.forma, desde);
    if (fallados.n >= lim.rechazosPorDia) {
      return { motivo: "fondo", detalle: "rechazos", liberaEn: dia(fallados) };
    }
    // Lo que está en el aire tiene su propio tope, aparte y más alto. Lo que ya venció no cuenta: la red ya no lo aplica.
    const vigente = Math.floor(ahora / 1000) - MARGEN_OCUPADO_S;
    const enElAire = this.contar(`forma = ? AND estado IN ${EN_EL_AIRE} AND vence >= ?`, p.forma, vigente);
    if (enElAire.n >= EN_EL_AIRE_POR_FORMA) {
      return { motivo: "fondo", detalle: "ocupado", reintentarEn: REINTENTAR_OCUPADO_MS };
    }

    if (this.gastoDeLaVentana(ahora) + p.estimado > lim.topePagos) {
      return { motivo: "fondo", detalle: "presupuesto" };
    }
    return null;
  }

  /**
   * Reserva de una vez el puesto, el lugar de la cuenta y el presupuesto, o dice qué lo frena. Síncrono y todo o nada.
   *
   * - Un hash que ya estaba contado (reservado, enviado o cerrado) no se cuenta de nuevo: `yaContado`.
   * - Un hash que estaba devuelto (la red no lo tomó) se reserva de nuevo, si pasa los topes.
   * - En el retiro, la fila de `retiros_cobrados` se escribe en la misma transacción: si el pago entra, el costo se reconoce
   *   aunque el objeto se caiga un instante después.
   * - Un pedido mal armado (un premio sin sorteo o con un puesto que no existe, un retiro sin costo, un número que no es un
   *   número) o las tablas incompletas son un error de quien llama y lanzan sin escribir nada (`revisarPedido`).
   */
  reservar(p: PedidoDePago, ahora: number, lim: LimitesDePagos): ReservadoDePago {
    const previa = this.buscar(p.hash);
    if (previa && previa.estado !== "devuelto") {
      return { ok: true, yaContado: true };
    }
    const freno = this.frenar(p, ahora, lim);
    if (freno) {
      return { ok: false, ...freno };
    }
    const premio = p.premio;
    const costo = p.costo;
    this.sql.transaccion(() => {
      this.sql.exec(
        [
          "INSERT INTO pagos_portero (hash, envuelta, forma, cuenta, del_libro, contrato, sorteo, puesto, destino_huella,",
          "creado, estado, estimado, real, vence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reservado', ?, NULL, ?)",
          "ON CONFLICT(hash) DO UPDATE SET envuelta = excluded.envuelta, forma = excluded.forma, cuenta = excluded.cuenta,",
          "del_libro = excluded.del_libro, contrato = excluded.contrato, sorteo = excluded.sorteo, puesto = excluded.puesto,",
          "destino_huella = excluded.destino_huella, creado = excluded.creado, estado = 'reservado', estimado = excluded.estimado,",
          "real = NULL, vence = excluded.vence, tomado = NULL",
        ].join(" "),
        p.hash,
        p.envuelta,
        p.forma,
        p.cuenta,
        p.delLibro ? 1 : 0,
        premio ? premio.contrato : null,
        premio ? premio.sorteo : null,
        premio ? premio.puesto : null,
        premio ? huellaDeDestino(premio.destino) : null,
        ahora,
        p.estimado,
        p.vence,
      );
      if (costo !== null && p.forma === "retiro") {
        this.sql.exec(
          "INSERT OR REPLACE INTO retiros_cobrados (hash, envuelta, cuenta, costo, ms) VALUES (?, ?, ?, ?, ?)",
          p.hash,
          p.envuelta,
          p.cuenta,
          costo,
          ahora,
        );
      }
    });
    return { ok: true, yaContado: false };
  }

  /** El portero mandó el pago a la red y esta lo tomó, a la hora `ahora` (ms). La primera vez que la tomó es la que queda. */
  marcarEnviado(hashInterno: string, ahora: number): void {
    const consulta = "UPDATE pagos_portero SET estado = 'enviado', tomado = COALESCE(tomado, ?) WHERE hash = ? AND estado = 'reservado'";
    this.sql.exec(consulta, ahora, hashInterno);
  }

  /**
   * La red contestó algo que no prueba que el pago quedó afuera (TRY_AGAIN_LATER, por ejemplo) y la fila sigue `reservado`, en el
   * aire. Se anota desde cuándo, como `marcarEnviado`, sin cambiar su estado: si vence sin entrar, cuenta para el tope por hora de
   * lo que quedó en el aire y no entró (`EN_EL_AIRE_SIN_ENTRAR_POR_CUENTA_HORA`). Si no, quien pone otra transacción de su cuenta
   * en la cola justo antes de la nuestra lo esquivaría.
   */
  marcarEnDuda(hashInterno: string, ahora: number): void {
    const consulta = "UPDATE pagos_portero SET tomado = COALESCE(tomado, ?) WHERE hash = ? AND estado = 'reservado'";
    this.sql.exec(consulta, ahora, hashInterno);
  }

  /**
   * La transacción entró a un ledger: salió bien o falló, y la red cobró igual. Lo que dice la red de una transacción que
   * entró es lo que pasó, y manda:
   *
   * - Un pago en el aire pasa a `ok` o `fallo`.
   * - Un pago que se dio por devuelto y entró igual también: si fuera un premio y quedara devuelto, su puesto quedaría libre
   *   con la plata ya pagada, y se podría pagar dos veces. Si ese puesto ya lo ocupa otro pago, entraron los dos: queda
   *   devuelto con lo que cobró la red y se anota `pago-doble` en la bitácora, sin lanzar.
   * - Un pago ya cerrado no cambia de estado: una transacción que entró no cambia de resultado, y un premio pagado que pasara
   *   a `fallo` liberaría su puesto. Solo se anota lo cobrado si todavía no se sabía.
   */
  cerrar(hashInterno: string, estado: "ok" | "fallo", real: number | null): void {
    const f = this.buscar(hashInterno);
    if (!f) {
      return;
    }
    if (f.estado === "ok" || f.estado === "fallo") {
      this.sql.exec("UPDATE pagos_portero SET real = COALESCE(real, ?) WHERE hash = ?", real, hashInterno);
      return;
    }
    if (f.estado === "devuelto") {
      const { contrato, sorteo, puesto } = f;
      const conPuesto = estado === "ok" && contrato !== null && sorteo !== null && puesto !== null;
      const otro = conPuesto ? this.puestoUsado(contrato, sorteo, puesto) : null;
      if (otro && otro.hash !== hashInterno) {
        // Otro pago de ese puesto está en el aire o entró: no se pisa a ninguno de los dos (el índice único no lo dejaría).
        this.sql.exec("UPDATE pagos_portero SET real = ? WHERE hash = ? AND estado = 'devuelto'", real, hashInterno);
        this.registrar("error-interno", { donde: "pago-doble", forma: f.forma });
        return;
      }
      this.sql.exec("UPDATE pagos_portero SET estado = ?, real = ? WHERE hash = ? AND estado = 'devuelto'", estado, real, hashInterno);
      return;
    }
    this.sql.exec(`UPDATE pagos_portero SET estado = ?, real = ? WHERE hash = ? AND estado IN ${EN_EL_AIRE}`, estado, real, hashInterno);
  }

  /**
   * La red no lo tomó y no entró a ningún ledger: no se cobró nada, el puesto y el lugar de la cuenta quedan libres y deja de
   * gastar presupuesto. Solo se devuelve lo que sigue en el aire: un pago que ya se cerró nunca vuelve atrás. La fila de
   * `retiros_cobrados` se conserva: si el pago entró igual, el costo se reconoce.
   */
  devolver(hashInterno: string): void {
    this.sql.exec("UPDATE pagos_portero SET estado = 'devuelto' WHERE hash = ? AND estado IN ('reservado','enviado')", hashInterno);
  }

  /**
   * Devuelve un pago que la red rechazó al primer envío, solo si sigue `reservado`, y dice si lo devolvió. Uno `enviado` no se
   * toca nunca desde el envío: la red ya lo tomó (quizás por otro pedido del mismo sobre) y puede entrar, así que su puesto
   * sigue ocupado hasta que la alarma lo confirme con los dos RPC y Horizon (`devolver`).
   */
  devolverSiReservado(hashInterno: string): boolean {
    const f = this.buscar(hashInterno);
    if (f === null || f.estado !== "reservado") {
      return false;
    }
    this.sql.exec("UPDATE pagos_portero SET estado = 'devuelto' WHERE hash = ? AND estado = 'reservado'", hashInterno);
    return true;
  }

  /**
   * Las devueltas que todavía podrían aparecer en un ledger: las que no pasaron `vence + margenS` (en segundos de la red), las
   * más viejas primero, a lo sumo `max`. La alarma le pregunta a la red por ellas: si una entró igual, se cierra con lo que dice
   * la red y, si es un premio, vuelve a ocupar su puesto.
   */
  devueltosRecientes(ahoraS: number, margenS: number, max: number, despuesDe: PuntoDeLaRonda | null = null): FilaDePago[] {
    const donde = `estado = 'devuelto' AND vence + ? >= ? AND ${DESPUES_DE}`;
    const consulta = `SELECT * FROM pagos_portero WHERE ${donde} ORDER BY creado, hash LIMIT ?`;
    return this.filas(consulta, margenS, ahoraS, ...enlacesDe(despuesDe), max).map(filaDePago);
  }

  /**
   * Los premios devueltos de ese puesto que todavía podrían aparecer en un ledger (no pasaron `vence + margenS`), salvo el de
   * `hashInterno`, a lo sumo `max`. Antes de reservar otro pago del mismo puesto se le pregunta a la red por ellos: si uno entró
   * igual, ocupa su puesto y el nuevo no se paga. Sin esto, entre la devolución y la vuelta de la alarma el puesto queda libre.
   */
  devueltosDelPuesto(
    premio: { contrato: string; sorteo: string; puesto: number },
    hashInterno: string,
    ahoraS: number,
    margenS: number,
    max: number,
  ): FilaDePago[] {
    const donde = "forma = 'premio' AND contrato = ? AND sorteo = ? AND puesto = ? AND estado = 'devuelto' AND hash <> ? AND vence + ? >= ?";
    const consulta = `SELECT * FROM pagos_portero WHERE ${donde} ORDER BY creado DESC, hash LIMIT ?`;
    return this.filas(consulta, premio.contrato, premio.sorteo, premio.puesto, hashInterno, margenS, ahoraS, max).map(filaDePago);
  }

  /**
   * Lo que sigue en el aire desde antes de `antes` (ms), en orden de creación, a lo sumo `max`: para preguntarle a la red qué fue
   * de cada uno. Con `despuesDe`, desde el que sigue a ese: así la alarma rota y ninguna fila queda sin mirar aunque haya más que
   * las que entran en una vuelta.
   */
  pendientes(antes: number, despuesDe: PuntoDeLaRonda | null = null, max = PENDIENTES_POR_VUELTA): FilaDePago[] {
    const consulta = `SELECT * FROM pagos_portero WHERE estado IN ${EN_EL_AIRE} AND creado < ? AND ${DESPUES_DE} ORDER BY creado, hash LIMIT ?`;
    return this.filas(consulta, antes, ...enlacesDe(despuesDe), max).map(filaDePago);
  }

  /** Cuántos hay en el aire, para saber si queda trabajo para la alarma. */
  enElAire(): number {
    return this.numero(`SELECT COUNT(*) AS n FROM pagos_portero WHERE estado IN ${EN_EL_AIRE}`);
  }

  // ---------- la vigilancia ----------

  /**
   * Las firmas de cuentas de Google que explican estos pagos desde `desde` (ms): solo las filas de cuentas que estaban en el
   * libro (las que cobran una firma de 20 créditos), en cualquier estado, también el devuelto: la persona firmó aunque la
   * red no lo haya tomado. Un retiro de una billetera propia no cuesta créditos y no tapa nada. Solo cifras.
   */
  firmas(desde: number): { premios: number; retiros: number } {
    const donde = "WHERE del_libro = 1 AND forma = ? AND creado > ?";
    const porForma = (forma: FormaDePago) => this.numero(`SELECT COUNT(*) AS n FROM pagos_portero ${donde}`, forma, desde);
    return { premios: porForma("premio"), retiros: porForma("retiro") };
  }

  /** Las sumas del día móvil, sin ninguna cuenta ni sorteo. */
  resumen(ahora: number): ResumenDePagos {
    const desde = ahora - DIA_MS;
    const deUna = (forma: FormaDePago): ResumenDeUnaForma => ({
      enElAire: this.numero(`SELECT COUNT(*) AS n FROM pagos_portero WHERE forma = ? AND estado IN ${EN_EL_AIRE}`, forma),
      ok24h: this.numero("SELECT COUNT(*) AS n FROM pagos_portero WHERE forma = ? AND estado = 'ok' AND creado > ?", forma, desde),
      fallo24h: this.numero("SELECT COUNT(*) AS n FROM pagos_portero WHERE forma = ? AND estado = 'fallo' AND creado > ?", forma, desde),
    });
    return { gasto24h: this.gastoDeLaVentana(ahora), enElAire: this.enElAire(), premio: deUna("premio"), retiro: deUna("retiro") };
  }

  // ---------- el costo de un retiro, para cobros.ts ----------

  /**
   * Si este pago a la cuenta de cobros es el costo de un retiro que pagó el portero: la misma transacción (por el hash de
   * adentro o por el del fee-bump), la misma cuenta y el costo exacto. Nunca lanza: lo llama la lectura de los cobros, que no
   * se puede caer por una tabla rota. Con la tabla rota da false y lo anota una sola vez.
   */
  costoDeRetiro(hashes: readonly string[], de: string, monto: number): boolean {
    const validos = [...new Set(hashes.filter((h) => HASH.test(h)))];
    if (validos.length === 0 || !this.disponible()) {
      return false;
    }
    try {
      const marcas = validos.map(() => "?").join(", ");
      const f = this.filas(
        `SELECT 1 AS n FROM retiros_cobrados WHERE (hash IN (${marcas}) OR envuelta IN (${marcas})) AND cuenta = ? AND costo = ? LIMIT 1`,
        ...validos,
        ...validos,
        de,
        monto,
      );
      return f.length > 0;
    } catch (e) {
      if (!this.avisoDeCostoDado) {
        this.avisoDeCostoDado = true;
        this.registrar("error-interno", { donde: "costo-retiro", error: e instanceof Error ? e.name : "desconocido" });
      }
      return false;
    }
  }

  // ---------- limpieza y exportación ----------

  /**
   * Borra lo cerrado que pasó de `PURGA_USO_MS`, salvo los premios que entraron bien (el comprobante los busca por su nota).
   * Lo que sigue en el aire no se toca. `retiros_cobrados` no se purga nunca: es lo que reconoce el costo de cada retiro.
   */
  purgar(ahora: number): void {
    this.sql.exec(
      `DELETE FROM pagos_portero WHERE creado < ? AND estado NOT IN ${EN_EL_AIRE} AND NOT (forma = 'premio' AND estado = 'ok')`,
      ahora - PURGA_USO_MS,
    );
  }

  /** Las dos tablas tal como están, para el exporte semanal. Con la huella del destino y nunca su dirección. */
  exportar(): { pagos_portero: Array<Record<string, unknown>>; retiros_cobrados: Array<Record<string, unknown>> } {
    return {
      pagos_portero: this.filas("SELECT * FROM pagos_portero ORDER BY creado, hash"),
      retiros_cobrados: this.filas("SELECT * FROM retiros_cobrados ORDER BY ms, hash"),
    };
  }
}
