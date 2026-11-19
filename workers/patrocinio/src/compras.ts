/**
 * La compra de un paquete pagando con QR, en el portero de mainnet: el permiso de empezar, el de terminar, la reserva de
 * créditos de cada compra en curso, el recargo por pagar con QR y la lista del piloto. Lo que se decide con la sesión
 * (quién es la persona, su cuenta, los créditos de Pollar) está en `rutas-altas.ts`; acá vive lo que se guarda.
 *
 * - **Una compra por persona a la vez.** `compras_qr` tiene una fila por compra: el producto, la reserva, el recargo que
 *   se fijó al darla y si el sitio ya avisó la carga (`cargada`).
 * - **La reserva** de una compra sin cargar dura una hora desde que se dio (o se renovó), y no frena los canjes de
 *   cupones: solo otras compras. Cargada, cuenta mientras no pasaron 7 días desde que se dio (o se renovó) o desde que
 *   se cargó, y frena todo lo nuevo, también los canjes: protege a quien tiene su dinero en camino.
 * - **Los topes del día**: `COMPRAS_QR_DIA` compras dadas por día entre todos y `COMPRAS_POR_PERSONA_DIA` por persona,
 *   contando cada cambio de producto. Renovar la misma compra no cuenta.
 * - **El recargo** se ata a la persona desde que el sitio avisa la carga (`POST /v1/compra/cargar`): desde ahí toda orden
 *   suya lo lleva (`compras_qr_ordenes`), hasta que una de esas órdenes quede pagada. No vence con la reserva.
 * - **Lo pagado se deduce de las tablas**, no de una marca: una compra queda pagada cuando una orden atada a ella tiene
 *   `pagada`, por el camino que sea (Horizon, a mano o un suelto asignado). Una compra sin cargar deja de contar cuando
 *   cualquier orden de esa persona queda pagada después de darla: compró por otro medio.
 * - **La lista del piloto** son cuentas G…: las de `COMPRAS_QR_PILOTO` y las que se suman por administración. Con
 *   `COMPRAS_QR_PILOTO = "todos"`, cualquier cuenta: el freno es el tope de personas nuevas del día.
 * - **Anular** (`anular`, solo administración) cierra una compra que no se pagó y cuyas órdenes no recibieron nada:
 *   suelta el recargo y la reserva, y cierra las órdenes sin pagar que lo llevaban. Es la salida de una carga que nunca
 *   tuvo QR. Cuando anula la persona (`soltarReserva`) se suelta solo la reserva: el recargo sigue.
 *
 * Todo lo que escribe es síncrono (el objeto atiende de a uno mientras no haya un `await`) y lo llama quien ya abrió la
 * transacción. Sin cuentas ni personas en la bitácora.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { usdcTexto } from "./cobros";
import { type Config, DIA_MS, type IdProducto, type Producto } from "./config";
import type { Sql } from "./cupos";

/** Cuánto reserva créditos una compra cargada desde que se da, se renueva o se carga. Pasado esto, se libera sola. */
export const PERMISO_RESERVA_MS = 7 * DIA_MS;
/**
 * Cuánto reserva créditos una compra que todavía no se cargó, desde que se da o se renueva: una hora. Así quien pide
 * permisos y nunca carga no deja créditos apartados por días. Pasada la hora, avisar la carga pide renovarla.
 */
export const RESERVA_SIN_CARGAR_MS = 60 * 60_000;
/** Las compras que una persona puede empezar por día (UTC), contando cada cambio de producto. Renovar no cuenta. */
export const COMPRAS_POR_PERSONA_DIA = 3;
/** Las veces que una persona puede anular su compra cargada en 7 días. Pasado esto, la suelta solo administración. */
export const ANULACIONES_POR_SEMANA = 2;
/**
 * Los avisos de carga que dan el sí por compra en 7 días. Cada sí deja que el sitio cree otra orden de carga (otro QR del
 * banco) y la reserva cuenta una sola carga: pasado esto, el aviso da `409 tope-de-avisos`.
 */
export const AVISOS_POR_COMPRA = 3;
/** Lo más que la vigilancia de firmas explica por la compra con QR en un día: personas con una compra cargada. */
export const TECHO_PERSONAS_FIRMAS = 20;
/**
 * Lo que puede gastar la primera compra con QR de una persona, en créditos de Pollar: la verificación, la línea, la
 * cuenta de paso, los tramos, las aprobaciones y el pago con el saldo. Las siguientes, sin la verificación ni la línea.
 */
export const RESERVA_QR_PRIMERA = 380;
export const RESERVA_QR_SIGUIENTE = 150;
/** Las firmas de una compra con QR: la activación, la línea, la cuenta de paso, hasta cuatro aprobaciones, el pago y mandar. */
export const FIRMAS_POR_COMPRA = 9;
/** Lo más que suma la lista del piloto por administración: con la clave filtrada no se abre a cualquiera. */
export const TECHO_PILOTO = 50;

export interface FilaCompra {
  id: number;
  usuario: string;
  producto: IdProducto;
  creada: number;
  /** Desde cuándo reserva: cuando se dio o se renovó. */
  desde: number;
  /** En créditos de Pollar. */
  reserva: number;
  /** En diezmillonésimas de USDC, fijado al darla. */
  recargo: number;
  /** Si el recargo es el de la primera vez (con la verificación). */
  primera: boolean;
  /** Si fue la primera compra con QR de esa persona: cuenta para el tope de personas nuevas del día. */
  nueva: boolean;
  /** Cuándo avisó el sitio la carga por primera vez, o null si todavía no: desde ahí el recargo va atado. */
  cargada: number | null;
  /**
   * El último aviso de carga que dio el sí, o null (todavía no avisó, o la cargó la versión anterior, que no lo guardaba:
   * entonces vale `cargada`).
   */
  avisada: number | null;
  cerrada: number | null;
  motivo: string | null;
}

function fila(f: Record<string, unknown>): FilaCompra {
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    id: Number(f.id),
    usuario: String(f.usuario),
    producto: String(f.producto) as IdProducto,
    creada: Number(f.creada),
    desde: Number(f.desde),
    reserva: Number(f.reserva),
    recargo: Number(f.recargo),
    primera: Number(f.primera) === 1,
    nueva: Number(f.nueva) === 1,
    cargada: n(f.cargada),
    avisada: n(f.avisada),
    cerrada: n(f.cerrada),
    motivo: f.motivo === null || f.motivo === undefined ? null : String(f.motivo),
  };
}

/**
 * Una compra que sigue: sin cerrar, sin una orden atada que esté pagada y, si no se cargó, sin una orden de esa persona
 * pagada después de darla (compró por otro medio). Una orden pagada en el mismo instante en que se dio no la cierra: ante
 * la duda la reserva sigue, que es lo prudente. Va con el alias `c`.
 */
const SIGUE = `c.cerrada IS NULL
  AND NOT EXISTS (SELECT 1 FROM compras_qr_ordenes l JOIN ordenes o ON o.id = l.orden WHERE l.compra = c.id AND o.pagada IS NOT NULL)
  AND (c.cargada IS NOT NULL OR NOT EXISTS (SELECT 1 FROM ordenes o2 WHERE o2.usuario = c.usuario AND o2.pagada IS NOT NULL AND o2.pagada > c.desde))`;

/**
 * Si una compra reserva, con el alias `c` y tres enlaces (el límite de la hora y dos veces el de los 7 días): tiene su
 * reserva (la persona no la soltó) y, sin cargar, no pasó una hora desde que se dio o se renovó; cargada, no pasaron 7
 * días desde que se dio o se renovó, o desde que se cargó.
 */
const RESERVA = `c.reserva > 0 AND ((c.cargada IS NULL AND c.desde > ?) OR (c.cargada IS NOT NULL AND (c.desde > ? OR c.cargada > ?)))`;

/** El primer instante del día UTC de `ahora`: desde ahí cuentan los topes del día. */
const inicioDelDia = (ahora: number) => {
  const d = new Date(ahora);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

/** Lo que el sitio ve de una compra: el producto, desde cuándo, el recargo, el total que va a pagar y si ya cargó. */
export interface VistaCompra {
  producto: IdProducto;
  desde: number;
  recargo: string;
  /** El precio de hoy del producto más el recargo, o null si el producto dejó de venderse. */
  total: string | null;
  primera: boolean;
  cargada: boolean;
}

/** Por qué no se anula una compra: no existe, una orden suya ya quedó pagada, o una orden suya recibió algo. */
export type NoSeAnula = "compra" | "compra-pagada" | "orden-con-pago";
export type Anulada = { ok: true; repetido: boolean; compra: FilaCompra; reemplazadas: number } | { ok: false; motivo: NoSeAnula };

export class ComprasQr {
  /** Sin la columna `avisada` (no se pudo sumar al arrancar, y entonces la venta está cerrada): la vigilancia cuenta sin ella. */
  private sinAvisada = false;

  constructor(
    private readonly sql: Sql,
    private readonly cfg: Pick<Config, "comprasQrPiloto" | "comprasQrTodos" | "precios">,
  ) {}

  /** Al arrancar no se pudo sumar `compras_qr.avisada` (`Cupos.faltaColumna`): desde acá, nada la lee. */
  sinHoraDeAviso(): void {
    this.sinAvisada = true;
  }

  private filas(consulta: string, ...enlaces: unknown[]): Array<Record<string, unknown>> {
    return this.sql.exec(consulta, ...enlaces).toArray();
  }

  private numero(consulta: string, ...enlaces: unknown[]): number {
    return Number(this.filas(consulta, ...enlaces)[0]?.n ?? 0);
  }

  vista(c: FilaCompra): VistaCompra {
    const p = this.cfg.precios?.find((x) => x.id === c.producto);
    return { producto: c.producto, desde: c.desde, recargo: usdcTexto(c.recargo), total: p ? usdcTexto(p.monto + c.recargo) : null, primera: c.primera, cargada: c.cargada !== null };
  }

  /** La compra en curso de una persona: la que sigue y todavía reserva, o la que ya cargó (aunque no reserve). */
  activa(usuario: string, ahora: number): FilaCompra | null {
    const f = this.filas(`SELECT * FROM compras_qr c WHERE c.usuario = ? AND ${SIGUE} AND (c.cargada IS NOT NULL OR c.desde > ?) ORDER BY c.id DESC LIMIT 1`, usuario, ahora - PERMISO_RESERVA_MS)[0];
    return f ? fila(f) : null;
  }

  /** La compra cargada y sin pagar de una persona: su recargo va en toda orden que pida, hasta que se pague. */
  pendiente(usuario: string): FilaCompra | null {
    const f = this.filas(`SELECT * FROM compras_qr c WHERE c.usuario = ? AND ${SIGUE} AND c.cargada IS NOT NULL ORDER BY c.id DESC LIMIT 1`, usuario)[0];
    return f ? fila(f) : null;
  }

  /** La última compra de una persona, abierta o cerrada. */
  ultima(usuario: string): FilaCompra | null {
    const f = this.filas("SELECT * FROM compras_qr WHERE usuario = ? ORDER BY id DESC LIMIT 1", usuario)[0];
    return f ? fila(f) : null;
  }

  /** Si esta persona tuvo alguna vez una compra con QR: es el permiso de terminar, que no vence. */
  tuvo(usuario: string): boolean {
    return this.filas("SELECT 1 AS n FROM compras_qr WHERE usuario = ? LIMIT 1", usuario).length > 0;
  }

  /** Si esta persona ya pagó una orden con el recargo de la primera vez: desde ahí, el recargo es el de las siguientes. */
  pagoLaPrimera(usuario: string): boolean {
    return (
      this.filas(
        "SELECT 1 AS n FROM compras_qr c JOIN compras_qr_ordenes l ON l.compra = c.id JOIN ordenes o ON o.id = l.orden WHERE c.usuario = ? AND c.primera = 1 AND o.pagada IS NOT NULL LIMIT 1",
        usuario,
      ).length > 0
    );
  }

  /**
   * Si una compra todavía reserva: tiene su reserva y, sin cargar, no pasó una hora desde que se dio o se renovó;
   * cargada, no pasaron 7 días desde que se dio o se renovó, o desde que se cargó. La misma regla que `reservas`, para
   * una compra ya leída (no mira si sigue: eso lo dice quien la buscó).
   */
  reservando(c: Pick<FilaCompra, "desde" | "cargada" | "reserva">, ahora: number): boolean {
    if (c.reserva <= 0) return false;
    if (c.cargada === null) return c.desde > ahora - RESERVA_SIN_CARGAR_MS;
    const limite = ahora - PERMISO_RESERVA_MS;
    return c.desde > limite || c.cargada > limite;
  }

  /**
   * Los créditos reservados por las compras que siguen y todavía reservan (ver `reservando`). Con `soloCargadas`, solo
   * las que ya avisaron la carga: las de quien tiene su dinero en camino. Esas son las únicas que frenan un canje.
   */
  reservas(ahora: number, soloCargadas = false): number {
    const largo = ahora - PERMISO_RESERVA_MS;
    return this.numero(`SELECT COALESCE(SUM(c.reserva), 0) AS n FROM compras_qr c WHERE ${SIGUE} AND ${RESERVA}${soloCargadas ? " AND c.cargada IS NOT NULL" : ""}`, ahora - RESERVA_SIN_CARGAR_MS, largo, largo);
  }

  /** Cuántas personas empezaron hoy (UTC) su primera compra con QR. */
  nuevasHoy(ahora: number): number {
    return this.numero("SELECT COUNT(*) AS n FROM compras_qr WHERE nueva = 1 AND creada >= ?", inicioDelDia(ahora));
  }

  /** Cuántas compras se dieron hoy (UTC), de cualquier persona: cada cambio de producto es una compra más. */
  empezadasHoy(ahora: number): number {
    return this.numero("SELECT COUNT(*) AS n FROM compras_qr WHERE creada >= ?", inicioDelDia(ahora));
  }

  /** Cuántas compras se le dieron hoy (UTC) a esta persona. */
  empezadasHoyPor(usuario: string, ahora: number): number {
    return this.numero("SELECT COUNT(*) AS n FROM compras_qr WHERE usuario = ? AND creada >= ?", usuario, inicioDelDia(ahora));
  }

  /** Cuántas compras cargadas siguen sin pagar: cada una lleva su recargo en las órdenes de esa persona. */
  pendientes(): number {
    return this.numero(`SELECT COUNT(*) AS n FROM compras_qr c WHERE c.cargada IS NOT NULL AND ${SIGUE}`);
  }

  /** Cuántas veces anuló esta persona su compra en los últimos 7 días. */
  anulacionesDe(usuario: string, ahora: number): number {
    return this.numero("SELECT COUNT(*) AS n FROM compras_anulaciones WHERE usuario = ? AND ms > ?", usuario, ahora - PERMISO_RESERVA_MS);
  }

  /**
   * Lo que reserva una compra: lo que puede gastar la carga (la primera vez de la persona o las siguientes) más lo que
   * promete el paquete, como el piso (los sorteos y, si la persona todavía no tiene alta, la activación).
   */
  reservaDe(p: { producto: Producto; primera: boolean; altaNueva: boolean; creditosPorSorteo: number; creditosPorAlta: number }): number {
    return (p.primera ? RESERVA_QR_PRIMERA : RESERVA_QR_SIGUIENTE) + p.creditosPorSorteo * p.producto.sorteos + (p.altaNueva ? p.creditosPorAlta : 0);
  }

  // ---------- lo que escribe (quien llama ya está adentro de una transacción) ----------

  dar(p: { usuario: string; producto: IdProducto; reserva: number; recargo: number; primera: boolean; nueva: boolean }, ahora: number): FilaCompra {
    this.sql.exec(
      "INSERT INTO compras_qr (usuario, producto, creada, desde, reserva, recargo, primera, nueva, cargada, cerrada, motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)",
      p.usuario,
      p.producto,
      ahora,
      ahora,
      p.reserva,
      p.recargo,
      p.primera ? 1 : 0,
      p.nueva ? 1 : 0,
    );
    return fila(this.filas("SELECT * FROM compras_qr WHERE usuario = ? ORDER BY id DESC LIMIT 1", p.usuario)[0] as Record<string, unknown>);
  }

  /** Una compra cargada que dejó de reservar vuelve a reservar desde ahora, con su mismo recargo. */
  renovar(id: number, reserva: number, ahora: number): void {
    this.sql.exec("UPDATE compras_qr SET desde = ?, reserva = ? WHERE id = ? AND cerrada IS NULL", ahora, reserva, id);
  }

  /** Se cierra sin pagar: la persona pidió otro producto antes de cargar. Solo una compra sin cargar. */
  cerrar(id: number, motivo: "cambio", ahora: number): void {
    this.sql.exec("UPDATE compras_qr SET cerrada = ?, motivo = ? WHERE id = ? AND cerrada IS NULL AND cargada IS NULL", ahora, motivo, id);
  }

  /**
   * Anota un aviso de carga que dio el sí: el primero queda en `cargada` (desde ahí el recargo va atado, y de ahí cuentan
   * la reserva y el plazo para anular) y cada uno, el primero también, en `avisada`.
   */
  marcarCargada(id: number, ahora: number): void {
    this.sql.exec("UPDATE compras_qr SET cargada = COALESCE(cargada, ?), avisada = ? WHERE id = ? AND cerrada IS NULL", ahora, ahora, id);
    this.sql.exec("INSERT INTO compras_avisos (compra, ms) VALUES (?, ?)", id, ahora);
  }

  /** Cuántos avisos de carga dieron el sí para esta compra en los últimos 7 días (ver `AVISOS_POR_COMPRA`). */
  avisosDe(id: number, ahora: number): number {
    return this.numero("SELECT COUNT(*) AS n FROM compras_avisos WHERE compra = ? AND ms > ?", id, ahora - PERMISO_RESERVA_MS);
  }

  /** Cuándo fue el último aviso de carga que dio el sí: `avisada` o, en una compra cargada por la versión anterior, `cargada`. */
  ultimoAviso(c: Pick<FilaCompra, "cargada" | "avisada">): number | null {
    return c.avisada ?? c.cargada;
  }

  porId(id: number): FilaCompra | null {
    const f = this.filas("SELECT * FROM compras_qr WHERE id = ?", id)[0];
    return f ? fila(f) : null;
  }

  /** Las órdenes sin pagar ni cerrar que llevan el recargo de una compra, vencidas o no, de la más vieja a la más nueva. */
  ordenesSinPagarDe(id: number): string[] {
    return this.filas("SELECT o.id AS id FROM compras_qr_ordenes l JOIN ordenes o ON o.id = l.orden WHERE l.compra = ? AND o.pagada IS NULL AND o.metodo IS NULL ORDER BY o.creada, o.id", id).map((f) =>
      String(f.id),
    );
  }

  /**
   * Anula una compra que no se pagó: queda cerrada con el motivo `anulada`, deja de reservar y su recargo deja de ir en
   * las órdenes de esa persona. Sus órdenes sin pagar (las que llevan el recargo) quedan `reemplazadas`, con la hora: no
   * se completan y un pago que llegue con su nota va a los sueltos como `cerrada`, salvo uno que ya estaba en camino
   * (entró a la red hasta 2 minutos después y llega al 95 %), que se honra. Vale con la compra cargada o sin cargar.
   *
   * No se anula si una orden atada ya quedó pagada (`compra-pagada`: la compra terminó), ni si una orden atada recibió
   * algo (`orden-con-pago`): un pago atado, o un pago suelto de una de sus órdenes que todavía no se resolvió. Lo que
   * llegó a una orden cerrada para devolver (`devuelta`) no frena: esa plata ya la está devolviendo administración.
   * Anular otra vez, o una compra ya cerrada por otro motivo, no cambia nada (`repetido`).
   *
   * Quien llama ya está adentro de una transacción y, si la compra tiene órdenes sin pagar, ya leyó los pagos nuevos.
   * `ref` dice por qué, y queda en las órdenes que se cierran.
   */
  anular(id: number, ahora: number, ref: string): Anulada {
    const c = this.porId(id);
    if (!c) return { ok: false, motivo: "compra" };
    if (c.cerrada !== null) return { ok: true, repetido: true, compra: c, reemplazadas: 0 };
    const freno = this.frenoDeAnular(id);
    if (freno) return { ok: false, motivo: freno };
    const sinPagar = this.ordenesSinPagarDe(id);
    for (const o of sinPagar)
      this.sql.exec("UPDATE ordenes SET metodo = 'reemplazada', ref = ?, reemplazada = ? WHERE id = ? AND pagada IS NULL AND metodo IS NULL", `reemplazada:anulada:${id}:${ref}`.slice(0, 120), ahora, o);
    this.sql.exec("UPDATE compras_qr SET cerrada = ?, motivo = 'anulada' WHERE id = ? AND cerrada IS NULL", ahora, id);
    return { ok: true, repetido: false, compra: this.porId(id) as FilaCompra, reemplazadas: sinPagar.length };
  }

  /**
   * Lo que frena anular una compra: una orden atada ya quedó pagada (`compra-pagada`), o una orden atada recibió algo
   * (`orden-con-pago`): un pago atado, o un suelto de una de sus órdenes sin resolver. Lo que llegó a una orden cerrada
   * para devolver no frena. null si nada frena.
   */
  private frenoDeAnular(id: number): "compra-pagada" | "orden-con-pago" | null {
    if (this.filas("SELECT 1 AS n FROM compras_qr_ordenes l JOIN ordenes o ON o.id = l.orden WHERE l.compra = ? AND o.pagada IS NOT NULL LIMIT 1", id).length) return "compra-pagada";
    const conPago = this.filas(
      `SELECT 1 AS n FROM compras_qr_ordenes l JOIN ordenes o ON o.id = l.orden WHERE l.compra = ?
        AND ((o.metodo IS NOT 'devuelta' AND EXISTS (SELECT 1 FROM pagos p WHERE p.orden = l.orden))
          OR EXISTS (SELECT 1 FROM pagos_sueltos s WHERE s.orden = l.orden AND s.estado = 'suelto'))
        LIMIT 1`,
      id,
    );
    return conPago.length ? "orden-con-pago" : null;
  }

  /**
   * La persona anula su compra cargada: se suelta la reserva (deja de apartar créditos) y NO el recargo. La compra sigue
   * abierta y su recargo va en toda orden de esa persona hasta que una se pague o administración la anule (`anular`):
   * así una carga terminada y después anulada no sale gratis. Reintentar es renovar esta misma compra con su recargo.
   * Ya soltada (sin reserva), es lo mismo (`repetido`) y no cuenta. Frena lo mismo que `anular` y, pasadas
   * `ANULACIONES_POR_SEMANA` anulaciones de la persona en 7 días, `tope-de-anulaciones`. Quien llama ya está adentro de
   * una transacción.
   */
  soltarReserva(id: number, usuario: string, ahora: number): { ok: true; repetido: boolean } | { ok: false; motivo: "compra" | "compra-pagada" | "orden-con-pago" | "tope-de-anulaciones" } {
    const c = this.porId(id);
    if (!c || c.usuario !== usuario || c.cerrada !== null) return { ok: false, motivo: "compra" };
    if (c.reserva <= 0) return { ok: true, repetido: true };
    const freno = this.frenoDeAnular(id);
    if (freno) return { ok: false, motivo: freno };
    if (this.anulacionesDe(usuario, ahora) >= ANULACIONES_POR_SEMANA) return { ok: false, motivo: "tope-de-anulaciones" };
    this.sql.exec("UPDATE compras_qr SET reserva = 0 WHERE id = ? AND cerrada IS NULL", id);
    this.sql.exec("INSERT INTO compras_anulaciones (compra, usuario, ms) VALUES (?, ?, ?)", id, usuario, ahora);
    return { ok: true, repetido: false };
  }

  /**
   * Suelta de una vez todas las compras sin cargar: quedan cerradas con el motivo `soltada` y su reserva vuelve enseguida.
   * Las cargadas no se tocan (tienen su dinero en camino). Dice cuántas cerró y cuántos créditos dejaron de reservar.
   * Quien llama ya está adentro de una transacción.
   */
  soltarSinCargar(ahora: number): { soltadas: number; reserva: number } {
    const largo = ahora - PERMISO_RESERVA_MS;
    const reserva = this.numero(`SELECT COALESCE(SUM(c.reserva), 0) AS n FROM compras_qr c WHERE c.cargada IS NULL AND ${SIGUE} AND ${RESERVA}`, ahora - RESERVA_SIN_CARGAR_MS, largo, largo);
    const soltadas = this.numero("SELECT COUNT(*) AS n FROM compras_qr WHERE cerrada IS NULL AND cargada IS NULL");
    this.sql.exec("UPDATE compras_qr SET cerrada = ?, motivo = 'soltada' WHERE cerrada IS NULL AND cargada IS NULL", ahora);
    return { soltadas, reserva };
  }

  // ---------- la lista del piloto ----------

  /**
   * Si la cuenta está en el piloto: con `COMPRAS_QR_PILOTO = "todos"` cualquiera, si no por la variable o por
   * administración. Sin cuenta, nunca: la compra termina en un pago desde la cuenta de la persona.
   */
  enPiloto(cuenta: string | null): boolean {
    if (!cuenta) return false;
    if (this.cfg.comprasQrTodos) return true;
    return this.cfg.comprasQrPiloto.has(cuenta) || this.filas("SELECT 1 AS n FROM compras_piloto WHERE cuenta = ?", cuenta).length > 0;
  }

  /** Si hay al menos una cuenta sumada por administración: con la variable vacía, eso también es una lista puesta. */
  hayPilotoAMano(): boolean {
    return this.filas("SELECT 1 AS n FROM compras_piloto LIMIT 1").length > 0;
  }

  /** Las cuentas sumadas por administración, de la más vieja a la más nueva. */
  piloto(): Array<{ cuenta: string; desde: number }> {
    return this.filas("SELECT cuenta, creada FROM compras_piloto ORDER BY creada, cuenta").map((f) => ({ cuenta: String(f.cuenta), desde: Number(f.creada) }));
  }

  /** Suma una cuenta a la lista. `techo` si ya hay `TECHO_PILOTO` y esta no estaba. */
  sumarPiloto(cuenta: string, ahora: number): { ok: true; cambio: boolean } | { ok: false; motivo: "cuenta" | "techo" } {
    if (!StrKey.isValidEd25519PublicKey(cuenta)) return { ok: false, motivo: "cuenta" };
    if (this.filas("SELECT 1 AS n FROM compras_piloto WHERE cuenta = ?", cuenta).length) return { ok: true, cambio: false };
    if (this.numero("SELECT COUNT(*) AS n FROM compras_piloto") >= TECHO_PILOTO) return { ok: false, motivo: "techo" };
    this.sql.exec("INSERT INTO compras_piloto (cuenta, creada) VALUES (?, ?)", cuenta, ahora);
    return { ok: true, cambio: true };
  }

  /**
   * Saca una cuenta de la lista: desde ahí no empieza ni carga una compra nueva. Lo que ya está en camino sigue con el
   * permiso de terminar, que la lista no toca. Una cuenta que viene de la variable se saca cambiando la variable.
   */
  sacarPiloto(cuenta: string): { cambio: boolean } {
    const estaba = this.filas("SELECT 1 AS n FROM compras_piloto WHERE cuenta = ?", cuenta).length > 0;
    if (estaba) this.sql.exec("DELETE FROM compras_piloto WHERE cuenta = ?", cuenta);
    return { cambio: estaba };
  }

  // ---------- la vigilancia de firmas ----------

  /**
   * Para la vigilancia de firmas desde `desde` (ms): cuántas compras tuvieron movimiento en la ventana (se dieron o
   * renovaron, se cargaron, o una orden atada se creó o se pagó) más las cargadas sin pagar de la última semana, que
   * pueden pedir aprobaciones cualquier día; y cuántos pagos con el saldo de la propia cuenta de la persona llegaron
   * fuera de una compra con QR. Sin cuentas: solo cifras.
   */
  firmas(desde: number): { compras: number; pagosConSaldo: number } {
    // Solo las cargadas gastan firmas, una vez por persona en la ventana y con techo: las cerradas por cambio o las
    // nunca cargadas no explican nada, así un permiso pedido mil veces no tapa firmas que se gastan por fuera.
    const personas = this.numero(
      `SELECT COUNT(DISTINCT c.usuario) AS n FROM compras_qr c WHERE c.cargada IS NOT NULL AND (c.cargada > ? OR ${this.sinAvisada ? "c.cargada" : "c.avisada"} > ?
        OR EXISTS (SELECT 1 FROM compras_qr_ordenes l JOIN ordenes o ON o.id = l.orden WHERE l.compra = c.id AND (o.creada > ? OR o.pagada > ?))
        OR (c.cargada > ? AND ${SIGUE}))`,
      desde,
      desde,
      desde,
      desde,
      desde - PERMISO_RESERVA_MS + DIA_MS,
    );
    const compras = Math.min(personas, TECHO_PERSONAS_FIRMAS);
    const pagosConSaldo = this.numero(
      "SELECT COUNT(*) AS n FROM pagos p JOIN ordenes o ON o.id = p.orden JOIN altas a ON a.usuario = o.usuario AND a.cuenta = p.de WHERE p.ms > ? AND NOT EXISTS (SELECT 1 FROM compras_qr_ordenes l WHERE l.orden = o.id)",
      desde,
    );
    return { compras, pagosConSaldo };
  }
}
