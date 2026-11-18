/**
 * El alta de quien ganó: lo que el portero guarda cuando quien organiza un sorteo nombra la cuenta que salió en un puesto, para
 * que esa cuenta, que quizás nunca entró al modo Oficial, pueda activarse y recibir su premio sin cupón.
 *
 * Es una tabla propia, `altas_premio`, con una fila por contrato, sorteo y puesto: la cuenta que entró, quien la nombró y cuándo.
 * Sin purga, como el libro. Es lo que impide dar dos altas por el mismo puesto y lo que cuenta los topes. Además de esa fila,
 * `admitir` escribe en la misma transacción el alta de la cuenta (tabla `altas`, usuario `cuenta:<G>`, motivo `premio`, sin
 * sorteos) y la mete en el libro (`Cupos.admitir`). Con 0 sorteos no puede sellar ni pagar premios: solo activar y recibir.
 *
 * La tabla no se crea en el constructor de `Cupos`: un `CREATE` que lanzara ahí tumbaría el objeto entero y con él todos los
 * sellos. Se crea acá, con su propio try/catch. Si falla, `disponible()` da false, `faltan()` lo nombra y la ruta queda apagada. El
 * constructor nunca lanza.
 *
 * Es código síncrono a propósito, como `cupos.ts`: un objeto de Cloudflare atiende de a uno mientras no haya un `await`, así
 * que mirar lo hecho, los topes y escribir es una sola jugada. El reloj entra como argumento (`ahora`, en ms).
 *
 * Lo que este archivo no sabe: si quien se nombra es de verdad quien ganó. El contrato guarda la huella de la lista y los
 * índices ganadores, no las cuentas. Lo nombra quien organiza, con su sesión, y lo peor que logra es un alta por cada puesto
 * de sus propios sorteos sellados por el portero, acotado por los topes de abajo.
 *
 * Cada fila guarda también el sello del portero que respalda ese sorteo (`Cupos.selloDelPortero`). El contrato acepta dos
 * sorteos con el mismo organizador, la misma lista y la misma ronda, y el portero reconoce su sello por esos tres datos: sin
 * esto, quien organiza sellaría una vez con el portero y después, por fuera y con su propio XLM, otros sorteos iguales de 300
 * ganadores, cada uno con su tope de 50. Con el sello en la fila, todos los sorteos que se apoyan en el mismo sello comparten
 * ese tope.
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { DIA_MS } from "./config";
import type { Cupos, Sql } from "./cupos";

/**
 * Lo más que se da de alta por un sorteo. El tope de verdad es el menor entre esto y la cantidad de ganadores. Vale también por
 * sello del portero: los sorteos que se apoyan en el mismo sello suman juntos.
 */
export const ALTAS_PREMIO_POR_SORTEO = 50;
/** Altas de quien ganó que da una misma cuenta de quien organiza en 24 horas. */
export const ALTAS_PREMIO_POR_ORGANIZADOR_DIA = 30;
/** Los ganadores que puede tener un sorteo, como los acepta el contrato. */
const GANADORES_MAXIMOS = 300;

/** Lo que se crea, cada cosa con su nombre: así `faltan()` dice cuál no se pudo. Primero la tabla y después sus índices. */
const CREACIONES: ReadonlyArray<readonly [nombre: string, consulta: string]> = [
  [
    "altas_premio",
    [
      "CREATE TABLE IF NOT EXISTS altas_premio (contrato TEXT NOT NULL, sorteo TEXT NOT NULL, puesto INTEGER NOT NULL,",
      "cuenta TEXT NOT NULL, organizador TEXT NOT NULL, sello TEXT NOT NULL, ms INTEGER NOT NULL,",
      "PRIMARY KEY (contrato, sorteo, puesto))",
    ].join(" "),
  ],
  ["altas_premio_organizador", "CREATE INDEX IF NOT EXISTS altas_premio_organizador ON altas_premio (organizador, ms)"],
  ["altas_premio_ms", "CREATE INDEX IF NOT EXISTS altas_premio_ms ON altas_premio (ms)"],
  ["altas_premio_sello", "CREATE INDEX IF NOT EXISTS altas_premio_sello ON altas_premio (contrato, sello)"],
];

/** Lo que hace falta para dar de alta a quien ganó. Todo ya comprobado por quien llama: acá solo se escribe. */
export interface PedidoDeAltaPorPremio {
  /** El contrato oficial de ese momento: con uno nuevo los números de sorteo vuelven a empezar. */
  contrato: string;
  /** El número del sorteo, en decimal. */
  sorteo: string;
  /** El puesto, desde 0. */
  puesto: number;
  /** La cuenta G de quien ganó: la que entra al libro. */
  cuenta: string;
  /** La cuenta G de quien organiza y la nombra. */
  organizador: string;
  /** Cuántos ganadores tiene el sorteo, según la red. */
  ganadores: number;
  /** El hash del sello que pagó el portero para ese sorteo, el de `Cupos.selloDelPortero`. */
  sello: string;
}

/** Los topes que se mueven en caliente: los resuelve quien llama (la variable o el ajuste) y siempre con su techo. */
export interface LimitesDeAltaPremio {
  /** Las altas de quien ganó que se aceptan en 24 horas, entre todas las cuentas. */
  altasPremioDia: number;
}

/**
 * Cómo terminó un alta de quien ganó. `repetido` es el mismo puesto con la misma cuenta otra vez: no escribe nada. Los topes por
 * organizador y por día traen la hora en que se libera el lugar más viejo (`liberaEn`, en ms). El del sorteo no: no tiene ventana.
 * `altas-pausadas` es lo que pidió el freno de quien llama (el piso de créditos o la pausa a mano), sin escribir nada.
 */
export type AdmitidoPorPremio =
  | { ok: true; estado: "admitida"; repetido: boolean }
  | { ok: true; estado: "ya-tiene-acceso" }
  | { ok: false; motivo: "puesto-usado" }
  | { ok: false; motivo: "cupo"; que: "sorteo" }
  | { ok: false; motivo: "cupo"; que: "organizador" | "dia"; liberaEn: number }
  | { ok: false; motivo: "altas-pausadas" };

/** El alta ya hecha para un puesto: la cuenta que entró y quien la nombró. */
export interface AltaDeUnPuesto {
  cuenta: string;
  organizador: string;
}

/** Un texto con algo adentro. */
function conTexto(x: unknown): x is string {
  return typeof x === "string" && x.length > 0;
}

/**
 * Lo que se exige de quien llama antes de mirar nada. Un pedido mal armado es un error del código y no de la persona: lanza, y
 * quien llama contesta un error sin escribir. Hace falta porque toda comparación con un `NaN` da falso: un tope o una cantidad de
 * ganadores que no fuera un número dejaría pasar todo en silencio.
 */
function revisarPedido(p: PedidoDeAltaPorPremio, lim: LimitesDeAltaPremio): void {
  const entero = (x: unknown, min: number): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= min;
  if (!entero(lim.altasPremioDia, 0)) {
    throw new Error("alta-premio-topes");
  }
  if (!conTexto(p.contrato) || !conTexto(p.sorteo) || !StrKey.isValidEd25519PublicKey(p.cuenta) || !StrKey.isValidEd25519PublicKey(p.organizador)) {
    throw new Error("alta-premio-forma");
  }
  if (!conTexto(p.sello)) {
    throw new Error("alta-premio-forma");
  }
  if (!entero(p.ganadores, 1) || p.ganadores > GANADORES_MAXIMOS || !entero(p.puesto, 0) || p.puesto >= p.ganadores) {
    throw new Error("alta-premio-forma");
  }
}

export class AltasPorPremio {
  /** Lo que no se pudo crear al arrancar, por nombre. */
  private readonly sinCrear: string[] = [];

  /** `sql` y `cupos` son los mismos del objeto: la fila de `altas_premio`, el alta y el libro se escriben en una transacción. */
  constructor(
    private readonly sql: Sql,
    private readonly cupos: Cupos,
  ) {
    for (const [nombre, consulta] of CREACIONES) {
      try {
        this.sql.exec(consulta);
      } catch {
        this.sinCrear.push(nombre);
      }
    }
  }

  /** Si la tabla y sus índices están: sin eso no se da de alta a nadie. */
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

  /** El alta ya hecha para ese puesto de ese sorteo del contrato, o null si está libre. */
  buscar(contrato: string, sorteo: string, puesto: number): AltaDeUnPuesto | null {
    const consulta = "SELECT cuenta, organizador FROM altas_premio WHERE contrato = ? AND sorteo = ? AND puesto = ?";
    const f = this.filas(consulta, contrato, sorteo, puesto)[0];
    return f ? { cuenta: String(f.cuenta), organizador: String(f.organizador) } : null;
  }

  /** Cuántas altas de quien ganó se dieron en las últimas 24 horas, entre todas las cuentas. */
  hoy(ahora: number): number {
    return Number(this.filas("SELECT COUNT(*) AS n FROM altas_premio WHERE ms > ?", ahora - DIA_MS)[0]?.n ?? 0);
  }

  /** Cuántas filas cumplen una condición y la hora de la más vieja, para decir cuándo se libera el tope. */
  private contar(donde: string, ...enlaces: unknown[]): { n: number; masVieja: number | null } {
    const f = this.filas(`SELECT COUNT(*) AS n, MIN(ms) AS vieja FROM altas_premio WHERE ${donde}`, ...enlaces)[0];
    const vieja = f?.vieja;
    return { n: Number(f?.n ?? 0), masVieja: vieja === null || vieja === undefined ? null : Number(vieja) };
  }

  /**
   * Da de alta a quien ganó, todo o nada y sin esperar a nadie. Se vuelve a mirar todo adentro de la transacción, porque entre la
   * lectura de la red y acá otro pedido pudo llegar primero:
   *
   * - El mismo puesto con la misma cuenta es `repetido` y no escribe nada. Con otra cuenta, `puesto-usado`.
   * - Una cuenta que ya está en el libro, o que ya es la cuenta de un alta, es `ya-tiene-acceso`: no hace falta darle nada.
   * - Los topes: por sorteo (el menor entre los ganadores y 50), por sello del portero (50 entre todos los sorteos que se apoyan
   *   en ese sello), por organizador en 24 horas y entre todos en 24 horas.
   * - `freno` (el piso de créditos y la pausa a mano) puede parar el alta antes de escribir: no queda nada.
   * - Si pasa: la fila de `altas_premio`, el alta de la cuenta (`cuenta:<G>`, motivo `premio`, `autorizada`, sin sorteos) y la
   *   cuenta en el libro con el motivo `premio`.
   */
  admitir(p: PedidoDeAltaPorPremio, ahora: number, lim: LimitesDeAltaPremio, freno: () => "altas-pausadas" | null): AdmitidoPorPremio {
    if (!this.disponible()) {
      throw new Error("alta-premio-sin-tablas");
    }
    revisarPedido(p, lim);
    return this.cupos.transaccion((): AdmitidoPorPremio => {
      const previa = this.buscar(p.contrato, p.sorteo, p.puesto);
      if (previa) {
        return previa.cuenta === p.cuenta ? { ok: true, estado: "admitida", repetido: true } : { ok: false, motivo: "puesto-usado" };
      }
      if (this.cupos.estaEnElLibro(p.cuenta) || this.cupos.altaDeCuenta(p.cuenta) !== null || this.cupos.altaDe(`cuenta:${p.cuenta}`) !== null) {
        return { ok: true, estado: "ya-tiene-acceso" };
      }
      const delSorteo = this.contar("contrato = ? AND sorteo = ?", p.contrato, p.sorteo);
      if (delSorteo.n >= Math.min(p.ganadores, ALTAS_PREMIO_POR_SORTEO)) {
        return { ok: false, motivo: "cupo", que: "sorteo" };
      }
      // Otro sorteo con el mismo organizador, la misma lista y la misma ronda, sellado por fuera, se apoya en el mismo sello: suman juntos.
      const delSello = this.contar("contrato = ? AND sello = ?", p.contrato, p.sello);
      if (delSello.n >= ALTAS_PREMIO_POR_SORTEO) {
        return { ok: false, motivo: "cupo", que: "sorteo" };
      }
      const desde = ahora - DIA_MS;
      const delOrganizador = this.contar("organizador = ? AND ms > ?", p.organizador, desde);
      if (delOrganizador.n >= ALTAS_PREMIO_POR_ORGANIZADOR_DIA) {
        return { ok: false, motivo: "cupo", que: "organizador", liberaEn: (delOrganizador.masVieja ?? ahora) + DIA_MS };
      }
      const delDia = this.contar("ms > ?", desde);
      if (delDia.n >= lim.altasPremioDia) {
        return { ok: false, motivo: "cupo", que: "dia", liberaEn: (delDia.masVieja ?? ahora) + DIA_MS };
      }
      if (freno() !== null) {
        return { ok: false, motivo: "altas-pausadas" };
      }
      this.sql.exec(
        "INSERT INTO altas_premio (contrato, sorteo, puesto, cuenta, organizador, sello, ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
        p.contrato,
        p.sorteo,
        p.puesto,
        p.cuenta,
        p.organizador,
        p.sello,
        ahora,
      );
      this.sql.exec(
        "INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'premio', ?, ?, NULL, 'autorizada', ?, ?)",
        `cuenta:${p.cuenta}`,
        `premio:${p.contrato}:${p.sorteo}:${p.puesto}`,
        p.cuenta,
        ahora,
        ahora,
      );
      this.cupos.admitir(p.cuenta, "premio", ahora);
      return { ok: true, estado: "admitida", repetido: false };
    });
  }

  /** La tabla entera, para el exporte. Son las cuentas del libro, como `altas`: sin nombres ni correos. */
  exportar(): { altas_premio: Array<Record<string, unknown>> } {
    return { altas_premio: this.filas("SELECT * FROM altas_premio ORDER BY ms, contrato, sorteo, puesto") };
  }
}
