/**
 * Los cupos y el gasto: todo lo que el portero guarda, en el SQLite de su objeto.
 *
 * Guarda cuenta (G…), mes, contador, los hashes que se pagaron con su resultado y
 * el gasto. Nada más: ni nombres, ni listas, ni direcciones IP. Las clases del objeto
 * solo llaman a estas funciones; ningún SQL queda afuera, para poder migrar el día
 * que haga falta (ver README.md).
 *
 * Es código síncrono a propósito: un objeto de Cloudflare atiende de a uno mientras
 * no haya un `await` en el medio, así que comprobar el cupo y reservarlo es una sola
 * jugada. Treinta pedidos a la vez de una cuenta no pasan del tope.
 *
 * El reloj entra como argumento (`ahora`, en ms): las pruebas lo corren a mano.
 */
import { DIA_MS, RESERVA_SORTEO_MS, inicioDelMesQueViene, mesUtc } from "./config";

export interface Cursor {
  toArray(): Array<Record<string, unknown>>;
}
/** Lo que usa de `ctx.storage.sql` de un Durable Object (y de un SQLite de prueba). */
export interface Sql {
  exec(consulta: string, ...enlaces: unknown[]): Cursor;
}

export type Estado = "reservado" | "enviado" | "ok" | "fallo" | "devuelto";
export type Metodo = "seal" | "draw";

export interface FilaUso {
  hash: string;
  cuenta: string;
  metodo: Metodo;
  mes: string;
  creado: number;
  estado: Estado;
  estimado: number;
  real: number | null;
  /** Hasta cuándo vale la transacción (`maxTime`), en segundos de la red. */
  vence: number;
}

export interface Limites {
  /** Sellos por mes de esta cuenta. */
  maxSellos: number;
  /** Sorteos por mes de esta cuenta. */
  maxSorteos: number;
  /** Lo más que se gasta en 24 h móviles, en stroops. */
  topeGeneral: number;
  /** Lo que se guarda, fijo, para el sorteo de cada sello (stroops). Nunca sale de lo que declara el cliente. */
  reservaSorteo: number;
}

export type Reservado =
  | { ok: true; quedan: number; quedanSorteos: number; yaContado: boolean }
  | { ok: false; motivo: "cupo-cuenta"; que: "sellos" | "sorteos"; liberaEn: number; max: number }
  | { ok: false; motivo: "fondo" };

export interface Cupo {
  mes: string;
  sellos: number;
  sorteos: number;
  maxSellos: number;
  maxSorteos: number;
  quedan: number;
  quedanSorteos: number;
  /** Cuándo se libera el cupo del mes (ms). */
  liberaEn: number;
}

/** Cuánto se guarda lo ya cerrado. Alcanza para conciliar con la red y aclarar un reclamo. */
export const PURGA_USO_MS = 35 * DIA_MS;

const ESTADOS_QUE_GASTAN = "('reservado','enviado','ok','fallo')";

export class Cupos {
  constructor(private readonly sql: Sql) {
    for (const q of [
      "CREATE TABLE IF NOT EXISTS uso (hash TEXT PRIMARY KEY, cuenta TEXT NOT NULL, metodo TEXT NOT NULL, mes TEXT NOT NULL, creado INTEGER NOT NULL, estado TEXT NOT NULL, estimado INTEGER NOT NULL, real INTEGER, vence INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS uso_cuenta ON uso (cuenta, creado)",
      "CREATE INDEX IF NOT EXISTS uso_creado ON uso (creado)",
      "CREATE TABLE IF NOT EXISTS cuentas (cuenta TEXT NOT NULL, mes TEXT NOT NULL, sellos INTEGER NOT NULL DEFAULT 0, sorteos INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (cuenta, mes))",
      "CREATE TABLE IF NOT EXISTS reserva (hash TEXT PRIMARY KEY, cuenta TEXT NOT NULL, creado INTEGER NOT NULL, stroops INTEGER NOT NULL, usada TEXT)",
      "CREATE INDEX IF NOT EXISTS reserva_creado ON reserva (creado)",
      "CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL, cambiado INTEGER NOT NULL)",
      "CREATE TABLE IF NOT EXISTS cuenta_app (cuenta TEXT PRIMARY KEY, visto INTEGER NOT NULL)",
      "CREATE INDEX IF NOT EXISTS cuenta_app_visto ON cuenta_app (visto)",
    ]) {
      this.sql.exec(q);
    }
  }

  private filas(consulta: string, ...enlaces: unknown[]): Array<Record<string, unknown>> {
    return this.sql.exec(consulta, ...enlaces).toArray();
  }

  private numero(consulta: string, ...enlaces: unknown[]): number {
    return Number(this.filas(consulta, ...enlaces)[0]?.n ?? 0);
  }

  // ---------- lo que se pagó ----------

  buscar(hash: string): FilaUso | undefined {
    return this.filas("SELECT * FROM uso WHERE hash = ?", hash)[0] as unknown as FilaUso | undefined;
  }

  /** Lo gastado en las últimas 24 h, en stroops: lo real si se sabe, lo estimado si no. Lo devuelto no cuenta. */
  gastoDeLaVentana(ahora: number): number {
    return this.numero(`SELECT COALESCE(SUM(COALESCE(real, estimado)), 0) AS n FROM uso WHERE creado > ? AND estado IN ${ESTADOS_QUE_GASTAN}`, ahora - DIA_MS);
  }

  /** Lo guardado para los sorteos de los sellos que todavía no sortearon. */
  reservadoParaSorteos(ahora: number): number {
    return this.numero("SELECT COALESCE(SUM(stroops), 0) AS n FROM reserva WHERE usada IS NULL AND creado > ?", ahora - RESERVA_SORTEO_MS);
  }

  /** El cupo de una cuenta en el mes de `ahora`. */
  consultar(cuenta: string, ahora: number, lim: Pick<Limites, "maxSellos" | "maxSorteos">): Cupo {
    const mes = mesUtc(ahora);
    const f = this.filas("SELECT sellos, sorteos FROM cuentas WHERE cuenta = ? AND mes = ?", cuenta, mes)[0];
    const sellos = Number(f?.sellos ?? 0);
    const sorteos = Number(f?.sorteos ?? 0);
    return {
      mes,
      sellos,
      sorteos,
      maxSellos: lim.maxSellos,
      maxSorteos: lim.maxSorteos,
      quedan: Math.max(0, lim.maxSellos - sellos),
      quedanSorteos: Math.max(0, lim.maxSorteos - sorteos),
      liberaEn: inicioDelMesQueViene(ahora),
    };
  }

  /**
   * Reserva de una vez el cupo de la cuenta y el presupuesto general. Síncrono.
   *
   * - Un `seal` cuenta un sello y guarda también un monto FIJO para su sorteo
   *   (`lim.reservaSorteo`, el costo medido de un `draw`): se acepta solo si queda para
   *   el sello y para ese monto, así lo sellado siempre se puede sortear. Lo guardado
   *   no depende de lo que declare nadie: 8 sellos retienen 8 montos fijos, no más.
   * - Un `draw` no se frena por el cupo de sellos. Si la cuenta tiene un sello con lo
   *   guardado, usa la reserva hasta `2 × reservaSorteo`: lo que su estimado pase de eso
   *   se comprueba contra el presupuesto como un pedido nuevo (si no hay, `fondo`). Sin
   *   sello guardado compite por el presupuesto por todo su estimado.
   * - Un hash que ya estaba devuelto se reserva de nuevo (la red lo había rechazado).
   *   Los otros estados los resuelve quien llama antes de reservar.
   */
  reservar(p: { hash: string; cuenta: string; metodo: Metodo; estimado: number; vence: number }, ahora: number, lim: Limites): Reservado {
    const cupo = this.consultar(p.cuenta, ahora, lim);
    // Otro pedido del mismo hash llegó antes (hubo un await entre mirar y reservar): ya está contado, no se cuenta dos veces.
    const previa = this.buscar(p.hash);
    if (previa && previa.estado !== "devuelto") return { ok: true, quedan: cupo.quedan, quedanSorteos: cupo.quedanSorteos, yaContado: true };
    const tope = p.metodo === "seal" ? cupo.maxSellos : cupo.maxSorteos;
    const usados = p.metodo === "seal" ? cupo.sellos : cupo.sorteos;
    if (usados >= tope) return { ok: false, motivo: "cupo-cuenta", que: p.metodo === "seal" ? "sellos" : "sorteos", liberaEn: cupo.liberaEn, max: tope };

    const gasto = this.gastoDeLaVentana(ahora) + this.reservadoParaSorteos(ahora);
    let guardada: string | null = null;
    if (p.metodo === "draw") {
      const r = this.filas("SELECT hash FROM reserva WHERE cuenta = ? AND usada IS NULL AND creado > ? ORDER BY creado LIMIT 1", p.cuenta, ahora - RESERVA_SORTEO_MS)[0];
      guardada = r ? String(r.hash) : null;
    }
    const falta = p.metodo === "seal" ? p.estimado + lim.reservaSorteo : guardada ? Math.max(0, p.estimado - 2 * lim.reservaSorteo) : p.estimado;
    // Un sorteo que cabe en lo guardado (falta = 0) no vuelve a pedirle al presupuesto: lo sellado siempre se puede sortear.
    if (falta > 0 && gasto + falta > lim.topeGeneral) return { ok: false, motivo: "fondo" };

    this.sql.exec(
      "INSERT INTO uso (hash, cuenta, metodo, mes, creado, estado, estimado, real, vence) VALUES (?, ?, ?, ?, ?, 'reservado', ?, NULL, ?) ON CONFLICT(hash) DO UPDATE SET cuenta = excluded.cuenta, metodo = excluded.metodo, mes = excluded.mes, creado = excluded.creado, estado = 'reservado', estimado = excluded.estimado, real = NULL, vence = excluded.vence",
      p.hash,
      p.cuenta,
      p.metodo,
      cupo.mes,
      ahora,
      p.estimado,
      p.vence,
    );
    this.sql.exec("INSERT OR IGNORE INTO cuentas (cuenta, mes, sellos, sorteos) VALUES (?, ?, 0, 0)", p.cuenta, cupo.mes);
    this.sql.exec(`UPDATE cuentas SET ${p.metodo === "seal" ? "sellos = sellos + 1" : "sorteos = sorteos + 1"} WHERE cuenta = ? AND mes = ?`, p.cuenta, cupo.mes);
    if (p.metodo === "seal") this.sql.exec("INSERT OR REPLACE INTO reserva (hash, cuenta, creado, stroops, usada) VALUES (?, ?, ?, ?, NULL)", p.hash, p.cuenta, ahora, lim.reservaSorteo);
    else if (guardada) this.sql.exec("UPDATE reserva SET usada = ? WHERE hash = ?", p.hash, guardada);
    const despues = this.consultar(p.cuenta, ahora, lim);
    return { ok: true, quedan: despues.quedan, quedanSorteos: despues.quedanSorteos, yaContado: false };
  }

  marcarEnviado(hash: string): void {
    this.sql.exec("UPDATE uso SET estado = 'enviado' WHERE hash = ? AND estado = 'reservado'", hash);
  }

  /**
   * La transacción entró a un ledger: se pagó, salió bien o no. Cuenta igual (la red cobró).
   * Si un sello falló, su sorteo no va a existir: se suelta lo guardado para él. Si salió
   * bien, lo guardado para su sorteo NO cambia: se queda en el monto fijo hasta que el sorteo
   * cierre (el costo del sello es otro costo que el del sorteo).
   *
   * Una fila devuelta no se resucita: se anota lo que cobró la red, pero sigue devuelta y no
   * vuelve a contar el cupo, el gasto ni lo guardado para el sorteo. Para volver a contar tiene
   * que pasar por `reservar`, que es quien comprueba el cupo y el presupuesto.
   */
  cerrar(hash: string, estado: "ok" | "fallo", real: number | null): void {
    const f = this.buscar(hash);
    if (!f) return;
    if (f.estado === "devuelto") {
      this.sql.exec("UPDATE uso SET real = ? WHERE hash = ? AND estado = 'devuelto'", real, hash);
      return;
    }
    this.sql.exec("UPDATE uso SET estado = ?, real = ? WHERE hash = ?", estado, real, hash);
    if (f.metodo === "seal" && estado === "fallo") this.sql.exec("DELETE FROM reserva WHERE hash = ? AND usada IS NULL", hash);
  }

  /**
   * La red la rechazó sin que entrara a ningún ledger: no se pagó nada, el cupo vuelve.
   * Lo guardado para su sorteo se suelta (un sello) o se devuelve al sello que lo tenía (un sorteo).
   */
  devolver(hash: string): void {
    const f = this.buscar(hash);
    if (!f || f.estado === "devuelto") return;
    this.sql.exec("UPDATE uso SET estado = 'devuelto' WHERE hash = ?", hash);
    this.sql.exec(`UPDATE cuentas SET ${f.metodo === "seal" ? "sellos = MAX(0, sellos - 1)" : "sorteos = MAX(0, sorteos - 1)"} WHERE cuenta = ? AND mes = ?`, f.cuenta, f.mes);
    if (f.metodo === "seal") this.sql.exec("DELETE FROM reserva WHERE hash = ?", hash);
    else this.sql.exec("UPDATE reserva SET usada = NULL WHERE usada = ?", hash);
  }

  /** Lo que sigue en el aire desde antes de `antes` (ms): para preguntarle a la red qué fue de cada una. */
  pendientes(antes: number): FilaUso[] {
    return this.filas("SELECT * FROM uso WHERE estado IN ('reservado','enviado') AND creado < ? ORDER BY creado LIMIT 50", antes) as unknown as FilaUso[];
  }

  /** Cuántas hay en el aire, para saber si queda trabajo para la alarma. */
  enElAire(): number {
    return this.numero("SELECT COUNT(*) AS n FROM uso WHERE estado IN ('reservado','enviado')");
  }

  // ---------- cuentas abiertas por nuestra app ----------

  cuentaConocida(cuenta: string): boolean {
    return this.filas("SELECT 1 AS n FROM cuenta_app WHERE cuenta = ?", cuenta).length > 0;
  }

  recordarCuenta(cuenta: string, ahora: number): void {
    this.sql.exec("INSERT OR REPLACE INTO cuenta_app (cuenta, visto) VALUES (?, ?)", cuenta, ahora);
  }

  // ---------- ajustes ----------

  ajuste(clave: string): string | undefined {
    const f = this.filas("SELECT valor FROM ajustes WHERE clave = ?", clave)[0];
    return f ? String(f.valor) : undefined;
  }

  fijarAjuste(clave: string, valor: string, ahora: number): void {
    this.sql.exec("INSERT OR REPLACE INTO ajustes (clave, valor, cambiado) VALUES (?, ?, ?)", clave, valor, ahora);
  }

  // ---------- limpieza y exportación ----------

  /** Borra lo viejo. Se llama al escribir, no hace falta una alarma aparte. */
  purgar(ahora: number): void {
    this.sql.exec("DELETE FROM uso WHERE creado < ? AND estado NOT IN ('reservado','enviado')", ahora - PURGA_USO_MS);
    this.sql.exec("DELETE FROM reserva WHERE creado < ?", ahora - PURGA_USO_MS);
    this.sql.exec("DELETE FROM cuentas WHERE mes < ?", mesUtc(ahora - 400 * DIA_MS));
    this.sql.exec("DELETE FROM cuenta_app WHERE visto < ?", ahora - 400 * DIA_MS);
  }

  /** Todo lo que hay, para el exporte semanal (con la clave de administración). */
  exportar(): Record<string, Array<Record<string, unknown>>> {
    return {
      uso: this.filas("SELECT * FROM uso ORDER BY creado"),
      cuentas: this.filas("SELECT * FROM cuentas ORDER BY mes, cuenta"),
      reserva: this.filas("SELECT * FROM reserva ORDER BY creado"),
      ajustes: this.filas("SELECT * FROM ajustes ORDER BY clave"),
      cuenta_app: this.filas("SELECT * FROM cuenta_app ORDER BY cuenta"),
    };
  }

  /** Las sumas del día móvil, sin ninguna cuenta. */
  resumen(ahora: number): { gasto24h: number; sellos24h: number; sorteos24h: number; reservadoParaSorteos: number; enElAire: number } {
    const n = (m: Metodo) => this.numero(`SELECT COUNT(*) AS n FROM uso WHERE creado > ? AND metodo = ? AND estado IN ${ESTADOS_QUE_GASTAN}`, ahora - DIA_MS, m);
    return { gasto24h: this.gastoDeLaVentana(ahora), sellos24h: n("seal"), sorteos24h: n("draw"), reservadoParaSorteos: this.reservadoParaSorteos(ahora), enElAire: this.enElAire() };
  }
}
