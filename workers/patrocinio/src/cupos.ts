/**
 * Los cupos y el gasto: todo lo que el portero guarda, en el SQLite de su objeto.
 *
 * Guarda cuenta (G…), mes, contador, los hashes que se pagaron con su resultado y
 * el gasto; en mainnet con altas, también el libro de cuentas y sus tablas (huellas de
 * cupones, el identificador de Pollar, derechos y pagos). Nada más: ni nombres, ni
 * correos, ni listas, ni direcciones IP, ni códigos en claro. Las clases del objeto
 * solo llaman a estas funciones; ningún SQL queda afuera de este archivo y de
 * `altas.ts` (los cupones), para poder migrar el día que haga falta (ver README.md).
 *
 * Es código síncrono a propósito: un objeto de Cloudflare atiende de a uno mientras
 * no haya un `await` en el medio, así que comprobar el cupo y reservarlo es una sola
 * jugada. Treinta pedidos a la vez de una cuenta no pasan del tope.
 *
 * El reloj entra como argumento (`ahora`, en ms): las pruebas lo corren a mano.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { DIA_MS, RESERVA_SORTEO_MS, inicioDelMesQueViene, mesUtc } from "./config";

/** Un texto no vacío de hasta `max` caracteres. */
export const texto = (s: unknown, max: number): s is string => typeof s === "string" && s.length > 0 && s.length <= max;
/** Un entero entre `min` y `max`. */
export const entre = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;

export interface Cursor {
  toArray(): Array<Record<string, unknown>>;
}
/** Lo que usa de `ctx.storage.sql` de un Durable Object (y de un SQLite de prueba). */
export interface Sql {
  exec(consulta: string, ...enlaces: unknown[]): Cursor;
  /** Todo o nada: `ctx.storage.transactionSync` en el objeto. Si `fn` lanza, no queda nada escrito. */
  transaccion<T>(fn: () => T): T;
}

/** Por qué una cuenta entró al libro: un cupón, un pago o un alta a mano. */
export type MotivoAlta = "cupon" | "pago" | "admin";
const MOTIVOS_ALTA: readonly MotivoAlta[] = ["cupon", "pago", "admin"];

/**
 * Las tablas de las altas (ver el modelo de datos del diseño de cupones). Viven en el mismo SQLite que los cupos para
 * que el libro, los sorteos que le quedan a una cuenta, el cupo del mes y el presupuesto se decidan en la misma jugada.
 * En testnet quedan vacías: nada las escribe.
 */
const TABLAS_ALTAS = [
  "CREATE TABLE IF NOT EXISTS cupones (huella TEXT PRIMARY KEY, lote TEXT NOT NULL, creado INTEGER NOT NULL, vence INTEGER NOT NULL, usos_max INTEGER NOT NULL DEFAULT 1, usos INTEGER NOT NULL DEFAULT 0, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, anulado INTEGER NOT NULL DEFAULT 0)",
  "CREATE INDEX IF NOT EXISTS cupones_lote ON cupones (lote)",
  "CREATE TABLE IF NOT EXISTS canjes (huella TEXT NOT NULL, usuario TEXT NOT NULL, lote TEXT NOT NULL, creado INTEGER NOT NULL, PRIMARY KEY (huella, usuario))",
  "CREATE UNIQUE INDEX IF NOT EXISTS canjes_lote_usuario ON canjes (lote, usuario)",
  "CREATE TABLE IF NOT EXISTS altas (usuario TEXT PRIMARY KEY, motivo TEXT NOT NULL, ref TEXT NOT NULL, cuenta TEXT, pedido TEXT, estado TEXT NOT NULL, creada INTEGER NOT NULL, actualizada INTEGER NOT NULL)",
  "CREATE UNIQUE INDEX IF NOT EXISTS altas_cuenta ON altas (cuenta) WHERE cuenta IS NOT NULL",
  "CREATE TABLE IF NOT EXISTS derechos (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, cuenta TEXT, origen TEXT NOT NULL, ref TEXT NOT NULL UNIQUE, sorteos INTEGER NOT NULL, usados INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL, vence INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS derechos_cuenta ON derechos (cuenta, vence)",
  "CREATE INDEX IF NOT EXISTS derechos_usuario ON derechos (usuario)",
  // Un sello de más de 50 ganadores gasta dos sorteos y los puede tomar de dos derechos: una fila por derecho.
  "CREATE TABLE IF NOT EXISTS consumos (hash TEXT NOT NULL, derecho INTEGER NOT NULL, cuantos INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (hash, derecho))",
  "CREATE TABLE IF NOT EXISTS sellos_portero (hash TEXT PRIMARY KEY, organizador TEXT NOT NULL, huella_lista TEXT NOT NULL, ronda INTEGER NOT NULL, ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sellos_portero_clave ON sellos_portero (organizador, huella_lista, ronda)",
  "CREATE TABLE IF NOT EXISTS ordenes (id TEXT PRIMARY KEY, usuario TEXT NOT NULL, producto TEXT NOT NULL, monto INTEGER NOT NULL, sorteos INTEGER NOT NULL, dias INTEGER NOT NULL, creada INTEGER NOT NULL, vence INTEGER NOT NULL, pagada INTEGER, metodo TEXT, ref TEXT)",
  "CREATE INDEX IF NOT EXISTS ordenes_usuario ON ordenes (usuario, producto, pagada)",
  "CREATE TABLE IF NOT EXISTS pagos (operacion TEXT PRIMARY KEY, paging_token TEXT NOT NULL, tx TEXT NOT NULL, orden TEXT NOT NULL, de TEXT NOT NULL, monto INTEGER NOT NULL, ms INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS pagos_orden ON pagos (orden)",
  "CREATE TABLE IF NOT EXISTS pagos_sueltos (operacion TEXT PRIMARY KEY, tx TEXT NOT NULL, de TEXT NOT NULL, activo TEXT NOT NULL, monto INTEGER NOT NULL, nota TEXT, motivo TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'suelto', orden TEXT, ref TEXT, ms INTEGER NOT NULL)",
];

/** Las columnas que el libro le suma a `cuenta_app`. Se agregan una sola vez: si ya están, no se tocan. */
const COLUMNAS_LIBRO: ReadonlyArray<[string, string]> = [
  ["motivo", "ALTER TABLE cuenta_app ADD COLUMN motivo TEXT"],
  ["permanente", "ALTER TABLE cuenta_app ADD COLUMN permanente INTEGER NOT NULL DEFAULT 0"],
];

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
  /**
   * Si cada sello gasta sorteos oficiales de los derechos de la cuenta (mainnet con altas). Sin esto, como siempre:
   * los derechos ni se miran.
   */
  porSorteos?: boolean;
}

export type Reservado =
  | { ok: true; quedan: number; quedanSorteos: number; yaContado: boolean }
  | { ok: false; motivo: "cupo-cuenta"; que: "sellos" | "sorteos"; liberaEn: number; max: number }
  | { ok: false; motivo: "fondo" }
  /** No le quedan sorteos oficiales que alcancen. `vencieron`: los que se le vencieron sin usar. */
  | { ok: false; motivo: "sin-sorteos"; vencieron: number };

/** De dónde salen unos sorteos oficiales. */
export type OrigenDerecho = "cupon" | "alta" | "paquete" | "admin";
const ORIGENES: readonly OrigenDerecho[] = ["cupon", "alta", "paquete", "admin"];

/** Lo que le queda a una cuenta (o a una persona) de sorteos oficiales sin vencer. */
export interface Quedan {
  quedan: number;
  /** El próximo vencimiento con sorteos sin usar, y cuántos vencen ese momento. */
  proximoVence: { fecha: number; cuantos: number } | null;
  /** Los que se vencieron sin usar. */
  vencieron: number;
}

/** Hasta cuántos ganadores un sello gasta un sorteo oficial; de ahí al tope del contrato (300), dos. */
export const GANADORES_POR_SORTEO = 50;

/** Cuántos sorteos oficiales gasta un sello con estos ganadores. Lo que no se pueda leer cuenta como lo más caro. */
export function sorteosDeUnSello(ganadores: number | null | undefined): number {
  return typeof ganadores === "number" && Number.isInteger(ganadores) && ganadores >= 1 && ganadores <= GANADORES_POR_SORTEO ? 1 : 2;
}

/** Cómo terminó atar una cuenta a una persona. */
export type Atado = "ok" | "sin-alta" | "cuenta-de-otro";

/** Un alta: quién, por qué, su cuenta si ya se sabe, el pedido de apertura (fase 2) y en qué está. */
export interface FilaAlta {
  usuario: string;
  motivo: MotivoAlta;
  cuenta: string | null;
  pedido: string | null;
  estado: "autorizada" | "pedida" | "abierta";
}

function filaAlta(f: Record<string, unknown>): FilaAlta {
  const estado = String(f.estado);
  return {
    usuario: String(f.usuario),
    motivo: String(f.motivo) as MotivoAlta,
    cuenta: f.cuenta === null || f.cuenta === undefined ? null : String(f.cuenta),
    pedido: f.pedido === null || f.pedido === undefined ? null : String(f.pedido),
    estado: estado === "pedida" || estado === "abierta" ? estado : "autorizada",
  };
}

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
      ...TABLAS_ALTAS,
    ]) {
      this.sql.exec(q);
    }
    this.sumarColumnasDelLibro();
  }

  /** Los `ALTER` del libro, solo si `cuenta_app` no tiene la columna: correr esto dos veces no rompe nada. */
  private sumarColumnasDelLibro(): void {
    let hay: Set<string> | null;
    try {
      hay = new Set(this.filas("PRAGMA table_info(cuenta_app)").map((f) => String(f.name)));
    } catch {
      hay = null;
    }
    for (const [columna, alter] of COLUMNAS_LIBRO) {
      if (hay?.has(columna)) continue;
      try {
        this.sql.exec(alter);
      } catch (e) {
        // Sin poder leer las columnas, una que ya estaba da este error y se sigue; cualquier otro, no.
        if (hay !== null || !/duplicate column/i.test(String(e))) throw e;
      }
    }
  }

  /** Todo o nada (ver `Sql.transaccion`). Lo que vale plata se escribe adentro. */
  transaccion<T>(fn: () => T): T {
    return this.sql.transaccion(fn);
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
   * - Con `lim.porSorteos`, un `seal` gasta además uno o dos sorteos oficiales de la cuenta (dos con más de
   *   `GANADORES_POR_SORTEO` ganadores), de los derechos sin vencer que vencen primero. Si no alcanzan, `sin-sorteos`
   *   sin escribir nada. Un `draw` nunca gasta sorteos oficiales.
   * - Con `lim.porSorteos` y `p.sello`, el `seal` queda además en `sellos_portero` con el organizador (la cuenta: la lista
   *   blanca exige que sean la misma), la huella de la lista y la ronda, en la misma transacción.
   * - Un `draw` con `p.selloHash` (el hash del sello del portero que sortea) usa lo guardado para ESE sello y no el primero
   *   de la cuenta, y queda anotado en la fila de `reserva` del sello (`usada`) aunque lo guardado ya haya vencido: así se
   *   sabe qué `draw` se pagó para cada sello (`sorteoDelSello`). Sin `selloHash`, como siempre.
   */
  reservar(
    p: {
      hash: string;
      cuenta: string;
      metodo: Metodo;
      estimado: number;
      vence: number;
      ganadores?: number | null;
      sello?: { huellaLista: string; ronda: number } | null;
      selloHash?: string | null;
    },
    ahora: number,
    lim: Limites,
  ): Reservado {
    const cupo = this.consultar(p.cuenta, ahora, lim);
    // Otro pedido del mismo hash llegó antes (hubo un await entre mirar y reservar): ya está contado, no se cuenta dos veces.
    const previa = this.buscar(p.hash);
    if (previa && previa.estado !== "devuelto") return { ok: true, quedan: cupo.quedan, quedanSorteos: cupo.quedanSorteos, yaContado: true };
    // Los sorteos oficiales van antes que el cupo del mes: sin sorteos no se gasta nada más.
    let tomar: Array<{ id: number; cuantos: number }> = [];
    if (p.metodo === "seal" && lim.porSorteos) {
      const elegidos = this.elegirDerechos(p.cuenta, sorteosDeUnSello(p.ganadores), ahora);
      if (!elegidos) return { ok: false, motivo: "sin-sorteos", vencieron: this.quedan({ cuenta: p.cuenta }, ahora).vencieron };
      tomar = elegidos;
    }
    const tope = p.metodo === "seal" ? cupo.maxSellos : cupo.maxSorteos;
    const usados = p.metodo === "seal" ? cupo.sellos : cupo.sorteos;
    if (usados >= tope) return { ok: false, motivo: "cupo-cuenta", que: p.metodo === "seal" ? "sellos" : "sorteos", liberaEn: cupo.liberaEn, max: tope };

    const gasto = this.gastoDeLaVentana(ahora) + this.reservadoParaSorteos(ahora);
    let guardada: string | null = null;
    if (p.metodo === "draw") {
      const r = p.selloHash
        ? this.filas("SELECT hash FROM reserva WHERE hash = ? AND usada IS NULL AND creado > ?", p.selloHash, ahora - RESERVA_SORTEO_MS)[0]
        : this.filas("SELECT hash FROM reserva WHERE cuenta = ? AND usada IS NULL AND creado > ? ORDER BY creado LIMIT 1", p.cuenta, ahora - RESERVA_SORTEO_MS)[0];
      guardada = r ? String(r.hash) : null;
    }
    const falta = p.metodo === "seal" ? p.estimado + lim.reservaSorteo : guardada ? Math.max(0, p.estimado - 2 * lim.reservaSorteo) : p.estimado;
    // Un sorteo que cabe en lo guardado (falta = 0) no vuelve a pedirle al presupuesto: lo sellado siempre se puede sortear.
    if (falta > 0 && gasto + falta > lim.topeGeneral) return { ok: false, motivo: "fondo" };

    this.sql.transaccion(() => {
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
      if (p.metodo === "draw" && p.selloHash) this.sql.exec("UPDATE reserva SET usada = ? WHERE hash = ?", p.hash, p.selloHash);
      if (p.metodo === "seal" && lim.porSorteos && p.sello) {
        this.sql.exec("INSERT OR REPLACE INTO sellos_portero (hash, organizador, huella_lista, ronda, ms) VALUES (?, ?, ?, ?, ?)", p.hash, p.cuenta, p.sello.huellaLista, p.sello.ronda, ahora);
      }
      for (const t of tomar) {
        this.sql.exec("UPDATE derechos SET usados = usados + ? WHERE id = ?", t.cuantos, t.id);
        this.sql.exec("INSERT INTO consumos (hash, derecho, cuantos) VALUES (?, ?, ?) ON CONFLICT(hash, derecho) DO UPDATE SET cuantos = consumos.cuantos + excluded.cuantos", p.hash, t.id, t.cuantos);
      }
    });
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
    if (f.metodo === "seal" && estado === "fallo") {
      this.sql.exec("DELETE FROM reserva WHERE hash = ? AND usada IS NULL", hash);
      // Un sello que falló no creó ningún sorteo: no queda como sello del portero.
      this.sql.exec("DELETE FROM sellos_portero WHERE hash = ?", hash);
    }
  }

  /**
   * La red la rechazó sin que entrara a ningún ledger: no se pagó nada, el cupo vuelve.
   * Lo guardado para su sorteo se suelta (un sello) o se devuelve al sello que lo tenía (un sorteo). Los sorteos
   * oficiales que gastó un sello vuelven a sus derechos.
   */
  devolver(hash: string): void {
    const f = this.buscar(hash);
    if (!f || f.estado === "devuelto") return;
    this.sql.transaccion(() => {
      this.sql.exec("UPDATE uso SET estado = 'devuelto' WHERE hash = ?", hash);
      this.sql.exec(`UPDATE cuentas SET ${f.metodo === "seal" ? "sellos = MAX(0, sellos - 1)" : "sorteos = MAX(0, sorteos - 1)"} WHERE cuenta = ? AND mes = ?`, f.cuenta, f.mes);
      if (f.metodo === "seal") {
        this.sql.exec("DELETE FROM reserva WHERE hash = ?", hash);
        for (const c of this.filas("SELECT derecho, cuantos FROM consumos WHERE hash = ?", hash)) {
          this.sql.exec("UPDATE derechos SET usados = MAX(0, usados - ?) WHERE id = ?", Number(c.cuantos), Number(c.derecho));
        }
        this.sql.exec("DELETE FROM consumos WHERE hash = ?", hash);
        this.sql.exec("DELETE FROM sellos_portero WHERE hash = ?", hash);
      } else this.sql.exec("UPDATE reserva SET usada = NULL WHERE usada = ?", hash);
    });
  }

  /** Lo que sigue en el aire desde antes de `antes` (ms): para preguntarle a la red qué fue de cada una. */
  pendientes(antes: number): FilaUso[] {
    return this.filas("SELECT * FROM uso WHERE estado IN ('reservado','enviado') AND creado < ? ORDER BY creado LIMIT 50", antes) as unknown as FilaUso[];
  }

  /** Cuántas hay en el aire, para saber si queda trabajo para la alarma. */
  enElAire(): number {
    return this.numero("SELECT COUNT(*) AS n FROM uso WHERE estado IN ('reservado','enviado')");
  }

  // ---------- los sellos que pagó el portero ----------

  /**
   * El hash del sello del portero que creó el sorteo de este organizador, con esta huella de la lista y esta ronda (lo
   * que devuelve `get_raffle`). null si el portero no pagó ese sello.
   */
  selloDelPortero(organizador: string, huellaLista: string, ronda: number): string | null {
    const f = this.filas("SELECT hash FROM sellos_portero WHERE organizador = ? AND huella_lista = ? AND ronda = ? ORDER BY ms DESC LIMIT 1", organizador, huellaLista.toLowerCase(), ronda)[0];
    return f ? String(f.hash) : null;
  }

  /**
   * El `draw` que se pagó para un sello del portero y en qué quedó, si se sabe: sirve para no mandar dos veces el mismo
   * sorteo. Lo devuelto no cuenta (la red no lo tomó). null si no hay ninguno.
   */
  sorteoDelSello(selloHash: string): { hash: string; estado: Estado } | null {
    const f = this.filas("SELECT u.hash AS hash, u.estado AS estado FROM reserva r JOIN uso u ON u.hash = r.usada WHERE r.hash = ? AND u.metodo = 'draw'", selloHash)[0];
    if (!f || f.estado === "devuelto") return null;
    return { hash: String(f.hash), estado: String(f.estado) as Estado };
  }

  // ---------- cuentas abiertas por nuestra app, y el libro ----------

  cuentaConocida(cuenta: string): boolean {
    return this.filas("SELECT 1 AS n FROM cuenta_app WHERE cuenta = ?", cuenta).length > 0;
  }

  /** Solo cambia cuándo se la vio: si la cuenta está en el libro, sigue en el libro. */
  recordarCuenta(cuenta: string, ahora: number): void {
    this.sql.exec("INSERT INTO cuenta_app (cuenta, visto) VALUES (?, ?) ON CONFLICT(cuenta) DO UPDATE SET visto = excluded.visto", cuenta, ahora);
  }

  /**
   * Mete la cuenta en el libro (`permanente = 1`): la escribe el servidor cuando confirma un cupón, un pago o un alta a
   * mano, nunca el navegador. Lo del libro no se purga. Si ya estaba, se queda con el primer motivo.
   */
  admitir(cuenta: string, motivo: MotivoAlta, ahora: number): void {
    if (!MOTIVOS_ALTA.includes(motivo)) throw new Error("motivo-de-alta");
    this.sql.exec(
      "INSERT INTO cuenta_app (cuenta, visto, motivo, permanente) VALUES (?, ?, ?, 1) ON CONFLICT(cuenta) DO UPDATE SET visto = excluded.visto, motivo = COALESCE(cuenta_app.motivo, excluded.motivo), permanente = 1",
      cuenta,
      ahora,
      motivo,
    );
  }

  /** ¿Está en el libro? Solo lo que se admitió: una cuenta vista antes no alcanza. */
  estaEnElLibro(cuenta: string): boolean {
    return this.filas("SELECT 1 AS n FROM cuenta_app WHERE cuenta = ? AND permanente = 1", cuenta).length > 0;
  }

  // ---------- los derechos: los sorteos oficiales de cada persona ----------

  /**
   * Le da sorteos oficiales a una persona (`usuario`, el id de Pollar, o `cuenta:G…` si la admitió administración),
   * con su cuenta si ya se sabe. Vencen `dias` días después de `ahora`. El `ref` dice de dónde salen (`cupon:<huella>:<usuario>`,
   * `orden:<id>`, `admin:<ref>`) y es único: el mismo `ref` otra vez no suma nada (`repetido`), aunque lo demás cambie.
   */
  otorgar(d: { usuario: string; cuenta: string | null; origen: OrigenDerecho; ref: string; sorteos: number; dias: number }, ahora: number): { repetido: boolean } {
    if (!texto(d.usuario, 200) || !texto(d.ref, 400)) throw new Error("derecho-forma");
    if (d.cuenta !== null && !StrKey.isValidEd25519PublicKey(d.cuenta)) throw new Error("derecho-cuenta");
    if (!ORIGENES.includes(d.origen)) throw new Error("derecho-origen");
    if (!entre(d.sorteos, 1, 1000) || !entre(d.dias, 1, 3650)) throw new Error("derecho-cantidad");
    if (this.filas("SELECT 1 AS n FROM derechos WHERE ref = ?", d.ref).length) return { repetido: true };
    this.sql.exec(
      "INSERT INTO derechos (usuario, cuenta, origen, ref, sorteos, usados, creado, vence) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
      d.usuario,
      d.cuenta,
      d.origen,
      d.ref,
      d.sorteos,
      ahora,
      ahora + d.dias * DIA_MS,
    );
    return { repetido: false };
  }

  /**
   * Los sorteos oficiales sin usar y sin vencer, de una cuenta (lo que mira el sello) o de una persona (lo que mira la
   * pantalla antes de saber su cuenta), con el próximo vencimiento y cuántos vencen ese momento.
   */
  quedan(clave: { cuenta: string } | { usuario: string }, ahora: number): Quedan {
    const [columna, valor] = "cuenta" in clave ? ["cuenta", clave.cuenta] : ["usuario", clave.usuario];
    const donde = `${columna} = ? AND usados < sorteos`;
    const quedan = this.numero(`SELECT COALESCE(SUM(sorteos - usados), 0) AS n FROM derechos WHERE ${donde} AND vence > ?`, valor, ahora);
    const prox = this.filas(`SELECT vence, SUM(sorteos - usados) AS n FROM derechos WHERE ${donde} AND vence > ? GROUP BY vence ORDER BY vence LIMIT 1`, valor, ahora)[0];
    const vencieron = this.numero(`SELECT COALESCE(SUM(sorteos - usados), 0) AS n FROM derechos WHERE ${donde} AND vence <= ?`, valor, ahora);
    return { quedan, proximoVence: prox ? { fecha: Number(prox.vence), cuantos: Number(prox.n) } : null, vencieron };
  }

  /** De qué derechos salen `cuantos` sorteos de una cuenta: los sin vencer que vencen primero. null si no alcanzan. */
  private elegirDerechos(cuenta: string, cuantos: number, ahora: number): Array<{ id: number; cuantos: number }> | null {
    const elegidos: Array<{ id: number; cuantos: number }> = [];
    let falta = cuantos;
    for (const f of this.filas("SELECT id, sorteos - usados AS libres FROM derechos WHERE cuenta = ? AND vence > ? AND usados < sorteos ORDER BY vence, id", cuenta, ahora)) {
      const toma = Math.min(falta, Number(f.libres));
      elegidos.push({ id: Number(f.id), cuantos: toma });
      falta -= toma;
      if (falta === 0) return elegidos;
    }
    return null;
  }

  /**
   * Si atar esta cuenta a esta persona choca con lo que ya está escrito: la persona ya tiene otra cuenta, o la cuenta es de
   * otra persona. Una cuenta que administración admitió a mano (`cuenta:G…`) no choca: es la misma cuenta.
   */
  cuentaDeOtro(usuario: string, cuenta: string): boolean {
    const suya = this.filas("SELECT cuenta FROM altas WHERE usuario = ?", usuario)[0];
    if (suya && suya.cuenta !== null && suya.cuenta !== cuenta) return true;
    return this.filas("SELECT 1 AS n FROM altas WHERE cuenta = ? AND usuario <> ? AND usuario <> ?", cuenta, usuario, `cuenta:${cuenta}`).length > 0;
  }

  /**
   * Ata la cuenta de una persona con alta: el alta la guarda (si nadie más la tiene), sus derechos sin cuenta pasan a
   * contar para esa cuenta y la cuenta entra al libro con el motivo del alta. Todo o nada. Sin alta no ata nada; si la
   * cuenta choca (`cuentaDeOtro`), tampoco.
   */
  atarCuenta(usuario: string, cuenta: string, ahora: number): Atado {
    return this.transaccion(() => this.atar(usuario, cuenta, ahora));
  }

  /**
   * Lo mismo que `atarCuenta`, sin abrir una transacción: para quien ya está adentro de una (el canje). Así no se anida
   * una `transactionSync` adentro de otra.
   */
  atar(usuario: string, cuenta: string, ahora: number): Atado {
    if (!texto(usuario, 200) || !StrKey.isValidEd25519PublicKey(cuenta)) throw new Error("atar-forma");
    const alta = this.filas("SELECT motivo, cuenta FROM altas WHERE usuario = ?", usuario)[0];
    if (!alta) return "sin-alta";
    if (this.cuentaDeOtro(usuario, cuenta)) return "cuenta-de-otro";
    // Pasado `cuentaDeOtro`, otra alta con esta cuenta solo puede ser la que administración admitió a mano: esa se queda con ella.
    const laTieneAdministracion = this.filas("SELECT 1 AS n FROM altas WHERE cuenta = ? AND usuario <> ?", cuenta, usuario).length > 0;
    if (alta.cuenta === null && !laTieneAdministracion) this.sql.exec("UPDATE altas SET cuenta = ?, actualizada = ? WHERE usuario = ?", cuenta, ahora, usuario);
    this.sql.exec("UPDATE derechos SET cuenta = ? WHERE usuario = ? AND cuenta IS NULL", cuenta, usuario);
    this.admitir(cuenta, String(alta.motivo) as MotivoAlta, ahora);
    return "ok";
  }

  /** El alta de una persona (o de `cuenta:G…`, si la admitió administración), o null. */
  altaDe(usuario: string): FilaAlta | null {
    const f = this.filas("SELECT usuario, motivo, cuenta, pedido, estado FROM altas WHERE usuario = ?", usuario)[0];
    return f ? filaAlta(f) : null;
  }

  /** El alta que tiene esta cuenta atada, sea de quien sea, o null. */
  altaDeCuenta(cuenta: string): FilaAlta | null {
    const f = this.filas("SELECT usuario, motivo, cuenta, pedido, estado FROM altas WHERE cuenta = ?", cuenta)[0];
    return f ? filaAlta(f) : null;
  }

  /**
   * Lo que ya se prometió y todavía le puede costar créditos de Pollar a Tinkazo: los sorteos oficiales sin usar de
   * derechos sin vencer, y las altas que todavía no se activaron. Es la base del piso de créditos.
   */
  prometido(ahora: number): { sorteos: number; altas: number } {
    return {
      sorteos: this.numero("SELECT COALESCE(SUM(sorteos - usados), 0) AS n FROM derechos WHERE vence > ? AND usados < sorteos", ahora),
      altas: this.numero("SELECT COUNT(*) AS n FROM altas WHERE estado IN ('autorizada','pedida')"),
    };
  }

  /** La cuenta del alta ya existe en la red: deja de contar como activación pendiente. */
  marcarAbierta(usuario: string, ahora: number): void {
    this.sql.exec("UPDATE altas SET estado = 'abierta', actualizada = ? WHERE usuario = ? AND estado <> 'abierta'", ahora, usuario);
  }

  /**
   * Fase 2: Pollar dejó un pedido para abrir la cuenta del alta (`wallets/fund`, su `requestId`). Sigue contando como
   * activación pendiente hasta que la cuenta exista. Una ya abierta no cambia.
   */
  marcarPedida(usuario: string, pedido: string, ahora: number): void {
    if (!texto(pedido, 200)) throw new Error("pedido-forma");
    this.sql.exec("UPDATE altas SET pedido = ?, estado = 'pedida', actualizada = ? WHERE usuario = ? AND estado <> 'abierta'", pedido, ahora, usuario);
  }

  /**
   * Las firmas de cuentas de Google que explican nuestros números desde `desde` (ms), para la vigilancia de firmas: los
   * sellos (y, si `sorteos`, los sorteos) que llegaron al portero desde cuentas del libro, en cualquier estado (la
   * persona firmó aunque la red los haya rechazado), y las activaciones (altas que pasaron a abiertas después de nacer;
   * una que nació con la cuenta ya abierta no tuvo activación). Con el sorteo del servidor, el `draw` lo firma la
   * sorteadora y no cuenta como firma de Pollar. Sin cuentas: solo cifras.
   */
  firmasExplicadas(desde: number, o: { sorteos: boolean }): { sellos: number; sorteos: number; activaciones: number } {
    const delLibro = (m: Metodo) => this.numero("SELECT COUNT(*) AS n FROM uso u JOIN cuenta_app c ON c.cuenta = u.cuenta AND c.permanente = 1 WHERE u.metodo = ? AND u.creado > ?", m, desde);
    return {
      sellos: delLibro("seal"),
      sorteos: o.sorteos ? delLibro("draw") : 0,
      activaciones: this.numero("SELECT COUNT(*) AS n FROM altas WHERE estado = 'abierta' AND actualizada > ? AND actualizada > creada", desde),
    };
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
    // Lo del libro no se purga: es el registro de a quién se le dio acceso.
    this.sql.exec("DELETE FROM cuenta_app WHERE visto < ? AND permanente = 0", ahora - 400 * DIA_MS);
  }

  /**
   * Todo lo que hay, para el exporte semanal (con la clave de administración). Con `conAltas` (el portero de mainnet),
   * también las tablas de las altas: huellas de cupones, canjes, altas, derechos, consumos, sellos, órdenes y pagos.
   */
  exportar(conAltas = false): Record<string, Array<Record<string, unknown>>> {
    return {
      uso: this.filas("SELECT * FROM uso ORDER BY creado"),
      cuentas: this.filas("SELECT * FROM cuentas ORDER BY mes, cuenta"),
      reserva: this.filas("SELECT * FROM reserva ORDER BY creado"),
      ajustes: this.filas("SELECT * FROM ajustes ORDER BY clave"),
      cuenta_app: this.filas("SELECT * FROM cuenta_app ORDER BY cuenta"),
      ...(conAltas
        ? {
            cupones: this.filas("SELECT * FROM cupones ORDER BY creado, huella"),
            canjes: this.filas("SELECT * FROM canjes ORDER BY creado"),
            altas: this.filas("SELECT * FROM altas ORDER BY creada"),
            derechos: this.filas("SELECT * FROM derechos ORDER BY id"),
            consumos: this.filas("SELECT * FROM consumos ORDER BY hash, derecho"),
            sellos_portero: this.filas("SELECT * FROM sellos_portero ORDER BY ms"),
            ordenes: this.filas("SELECT * FROM ordenes ORDER BY creada"),
            pagos: this.filas("SELECT * FROM pagos ORDER BY ms"),
            pagos_sueltos: this.filas("SELECT * FROM pagos_sueltos ORDER BY ms"),
          }
        : {}),
    };
  }

  /** Las sumas del día móvil, sin ninguna cuenta. */
  resumen(ahora: number): { gasto24h: number; sellos24h: number; sorteos24h: number; reservadoParaSorteos: number; enElAire: number } {
    const n = (m: Metodo) => this.numero(`SELECT COUNT(*) AS n FROM uso WHERE creado > ? AND metodo = ? AND estado IN ${ESTADOS_QUE_GASTAN}`, ahora - DIA_MS, m);
    return { gasto24h: this.gastoDeLaVentana(ahora), sellos24h: n("seal"), sorteos24h: n("draw"), reservadoParaSorteos: this.reservadoParaSorteos(ahora), enElAire: this.enElAire() };
  }
}
