/**
 * Los cupones del portero de mainnet: cómo se lee un código, su huella, los lotes y el canje.
 *
 * Un cupón son 12 caracteres del alfabeto de Crockford (60 bits). En el servidor queda solo su
 * huella, HMAC-SHA256 del código normalizado con `CUPON_SECRETO`: ni el código en claro ni el
 * secreto se guardan ni se anotan. Rotar el secreto anula todos los cupones vivos.
 *
 * Canjear es una sola jugada síncrona, adentro de una transacción: comprobar y gastar sin un
 * `await` en el medio. La huella se calcula antes (es asíncrona) y la sesión de Pollar se
 * verifica antes; acá ya no se espera a nadie. El reloj entra como argumento (`ahora`, en ms).
 *
 * `normalizar` vive en `cupon-codigo.ts`, que no depende de nada: la pueden importar el sitio
 * y la herramienta, y las tres pasan el mismo vector (`cupon-vectores.json`).
 */
import { StrKey } from "@stellar/stellar-sdk/base";
import { DIA_MS } from "./config";
import { MAX_SORTEOS_POR_CUPON, normalizar } from "./cupon-codigo";
import { type Cupos, type Sql, entre, texto } from "./cupos";

export { ALFABETO, LARGO_CUPON, MAX_SORTEOS_POR_CUPON, mostrar, normalizar } from "./cupon-codigo";

/** Lo más corto que se acepta de `CUPON_SECRETO`: 32 bytes al azar. */
export const SECRETO_MINIMO = 32;
const HUELLA = /^[0-9a-f]{64}$/;

/** La huella de un código ya normalizado: HMAC-SHA256 con el secreto, en hexadecimal. Sin secreto (o corto) no hay huella. */
export async function huella(codigo: string, secreto: string): Promise<string> {
  if (normalizar(codigo) !== codigo) throw new Error("cupon-forma");
  if (typeof secreto !== "string" || secreto.length < SECRETO_MINIMO) throw new Error("cupon-secreto");
  const enc = new TextEncoder();
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, enc.encode(codigo)));
  return Array.from(firma, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Techo en el código: cuántos usos de cupones nuevos se crean por día (UTC), aunque se filtre la clave de cupones. */
export const TECHO_CUPONES_DIA = 500;
/**
 * Techo en el código: cuántos sorteos oficiales prometen los cupones nuevos de un día (UTC), contando usos por sorteos,
 * aunque se filtre la clave de cupones. Sin esto, 500 cupones de un uso y 50 sorteos, cada uno en su lote, prometían
 * 25.000 sorteos en un día. Va en su propio ajuste (`cupones_sorteos_dia:`), aparte de los sorteos dados a mano.
 */
export const TECHO_SORTEOS_CUPONES_DIA = 500;
/** Cuántos códigos entran en un pedido. */
export const MAX_CODIGOS_POR_PEDIDO = 500;
/** El nombre de un lote: minúsculas, números y guiones, hasta 64 (`space-apps-14nov`). */
export const FORMA_LOTE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOTE = FORMA_LOTE;

export interface LoteNuevo {
  lote: string;
  /** Las huellas de los códigos (ver `huella`), nunca los códigos. */
  huellas: string[];
  /** Los sorteos oficiales que trae cada canje. */
  sorteos: number;
  /** Cuántos días valen esos sorteos desde el canje. */
  dias: number;
  /** Hasta cuándo se canjea, en ms (inclusive). */
  vence: number;
  /** Cuántas personas pueden usar cada código. */
  usos: number;
}

export type Creados = { ok: true; creados: number; repetidos: number } | { ok: false; motivo: "cuerpo" | "techo" };

/** Cómo terminó un alta a mano. */
export type AltaAMano = { ok: true; repetido: boolean; altaNueva: boolean } | { ok: false; motivo: "ref-usado" | "techo-altas" | "techo-sorteos" };

/** Cómo terminó dar sorteos a mano a una cuenta del libro. */
export type DadoAMano = { ok: true; repetido: boolean } | { ok: false; motivo: "fuera-del-libro" | "ref-usado" | "techo-sorteos" };

/** El día UTC de un instante, `AAAA-MM-DD`: la clave de los techos diarios. */
const diaUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Lo que puede frenar un canje que por lo demás vale (el piso de créditos, la pausa a mano). No gasta el cupón. */
export type MotivoFreno = "altas-pausadas";

export type Canje =
  | { ok: true; repetido: boolean; sorteosSumados: number; lote: string; altaNueva: boolean }
  | { ok: false; motivo: "cupon-no-existe" | "cupon-anulado" | "cupon-usado" | "lote-usado" | "cuenta-de-otro" | MotivoFreno }
  | { ok: false; motivo: "cupon-vencido"; vence: number };

/**
 * Por qué no se dio el regalo de bienvenida aunque la cuenta quedó activada: un freno puesto a mano, el piso, el margen del
 * regalo por encima del piso o Pollar sin saldo.
 */
export type CausaRegalo = "cerrado" | "dia" | "hora" | "conexion" | "piso" | "margen" | "creditos";

/** Cómo terminó la bienvenida: `dado` (se sumaron los sorteos), `lleno` (activada, sin regalo) o `ya` (ya los había recibido). */
export type Bienvenida =
  | { ok: true; regalo: "dado" | "lleno" | "ya"; sorteosSumados: number; altaNueva: boolean; causa: CausaRegalo | null }
  | { ok: false; motivo: "cuenta-de-otro" | "altas-pausadas" | "bienvenida-llena" };

/**
 * La referencia del regalo de una persona: la del derecho (única, así el regalo es uno por persona) y la del alta que nace por
 * este camino. Nunca se anota: lleva el id de la persona.
 */
export const refDeBienvenida = (usuario: string): string => `gratis:${usuario}`;

export interface EstadoLote {
  lote: string;
  creados: number;
  /** Canjes hechos (personas). */
  canjeados: number;
  /** Cuentas que ya tienen atados los sorteos de un cupón del lote. */
  cuentas: number;
  sorteosUsados: number;
  /** El vencimiento más tardío del lote, en ms. */
  vence: number;
  /** Si está anulado entero. */
  anulado: boolean;
  anulados: number;
}

export class Altas {
  /** `sql` es el mismo SQLite de `cupos`, que ya creó las tablas. */
  constructor(
    private readonly sql: Sql,
    private readonly cupos: Cupos,
  ) {}

  private filas(consulta: string, ...enlaces: unknown[]): Array<Record<string, unknown>> {
    return this.sql.exec(consulta, ...enlaces).toArray();
  }

  /**
   * Crea los cupones de un lote, de una vez. Una huella que ya existe no se toca y cuenta como repetida. Si los usos
   * nuevos del día pasan `TECHO_CUPONES_DIA`, o los sorteos que prometen (usos por sorteos) pasan
   * `TECHO_SORTEOS_CUPONES_DIA`, no se crea ninguno (`techo`). Lo mal escrito da `cuerpo` sin escribir nada.
   */
  crearCupones(p: LoteNuevo, ahora: number): Creados {
    if (!p || typeof p.lote !== "string" || !LOTE.test(p.lote) || !Array.isArray(p.huellas)) return { ok: false, motivo: "cuerpo" };
    if (p.huellas.length < 1 || p.huellas.length > MAX_CODIGOS_POR_PEDIDO || !p.huellas.every((h) => typeof h === "string" && HUELLA.test(h))) return { ok: false, motivo: "cuerpo" };
    if (!entre(p.sorteos, 1, MAX_SORTEOS_POR_CUPON) || !entre(p.dias, 1, 365) || !entre(p.usos, 1, TECHO_CUPONES_DIA)) return { ok: false, motivo: "cuerpo" };
    if (!entre(p.vence, ahora + 1, ahora + 3650 * DIA_MS)) return { ok: false, motivo: "cuerpo" };
    const pedidas = [...new Set(p.huellas)];
    return this.cupos.transaccion((): Creados => {
      const nuevas = pedidas.filter((h) => this.filas("SELECT 1 AS n FROM cupones WHERE huella = ?", h).length === 0);
      const dia = diaUtc(ahora);
      const clave = `cupones_dia:${dia}`;
      const claveSorteos = `cupones_sorteos_dia:${dia}`;
      const hoy = Number(this.cupos.ajuste(clave) ?? 0);
      const sorteosHoy = Number(this.cupos.ajuste(claveSorteos) ?? 0);
      const carga = nuevas.length * p.usos;
      const sorteosNuevos = carga * p.sorteos;
      if (hoy + carga > TECHO_CUPONES_DIA || sorteosHoy + sorteosNuevos > TECHO_SORTEOS_CUPONES_DIA) return { ok: false, motivo: "techo" };
      for (const h of nuevas) {
        this.sql.exec("INSERT INTO cupones (huella, lote, creado, vence, usos_max, usos, sorteos, dias, anulado) VALUES (?, ?, ?, ?, ?, 0, ?, ?, 0)", h, p.lote, ahora, p.vence, p.usos, p.sorteos, p.dias);
      }
      if (carga > 0) {
        this.cupos.fijarAjuste(clave, String(hoy + carga), ahora);
        this.cupos.fijarAjuste(claveSorteos, String(sorteosHoy + sorteosNuevos), ahora);
      }
      return { ok: true, creados: nuevas.length, repetidos: p.huellas.length - nuevas.length };
    });
  }

  /**
   * Canjea un cupón para una persona (`usuario`, el id que dio Pollar al verificar la sesión, nunca lo que diga el
   * navegador), con su cuenta si ya se sabe. Todo en una transacción y sin esperar a nadie:
   *
   * - La misma persona con el mismo cupón otra vez: lo mismo (`repetido`), sin gastar otro uso.
   * - Si no: que exista, que no esté anulado ni vencido, que le queden usos y que la persona no tenga otro del mismo lote.
   * - `freno` (el piso de créditos, la pausa) puede pararlo antes de escribir: el cupón no se gasta.
   * - Si pasa: un uso más, el canje, el alta si la persona no tenía (el cupón cubre la activación), sus sorteos con
   *   `ref` `cupon:<huella>:<usuario>` y, con la cuenta, la cuenta atada y en el libro.
   */
  canjear(p: { huella: string; usuario: string; cuenta: string | null; freno?: (c: { sorteos: number; altaNueva: boolean }) => MotivoFreno | null }, ahora: number): Canje {
    if (typeof p.huella !== "string" || !HUELLA.test(p.huella)) throw new Error("canje-huella");
    if (!texto(p.usuario, 200) || p.usuario.startsWith("cuenta:")) throw new Error("canje-usuario");
    if (p.cuenta !== null && !StrKey.isValidEd25519PublicKey(p.cuenta)) throw new Error("canje-cuenta");
    const { huella: h, usuario, cuenta } = p;
    return this.cupos.transaccion((): Canje => {
      const previo = this.filas("SELECT lote FROM canjes WHERE huella = ? AND usuario = ?", h, usuario)[0];
      if (previo) {
        if (cuenta && this.cupos.atar(usuario, cuenta, ahora) === "cuenta-de-otro") return { ok: false, motivo: "cuenta-de-otro" };
        return { ok: true, repetido: true, sorteosSumados: 0, lote: String(previo.lote), altaNueva: false };
      }
      const c = this.filas("SELECT lote, vence, usos_max, usos, sorteos, dias, anulado FROM cupones WHERE huella = ?", h)[0];
      if (!c) return { ok: false, motivo: "cupon-no-existe" };
      if (Number(c.anulado)) return { ok: false, motivo: "cupon-anulado" };
      if (ahora > Number(c.vence)) return { ok: false, motivo: "cupon-vencido", vence: Number(c.vence) };
      if (Number(c.usos) >= Number(c.usos_max)) return { ok: false, motivo: "cupon-usado" };
      const lote = String(c.lote);
      if (this.filas("SELECT 1 AS n FROM canjes WHERE lote = ? AND usuario = ?", lote, usuario).length) return { ok: false, motivo: "lote-usado" };
      if (cuenta && this.cupos.cuentaDeOtro(usuario, cuenta)) return { ok: false, motivo: "cuenta-de-otro" };
      const sorteos = Number(c.sorteos);
      const altaNueva = this.filas("SELECT 1 AS n FROM altas WHERE usuario = ?", usuario).length === 0;
      const frenado = p.freno?.({ sorteos, altaNueva }) ?? null;
      if (frenado) return { ok: false, motivo: frenado };

      this.sql.exec("UPDATE cupones SET usos = usos + 1 WHERE huella = ?", h);
      this.sql.exec("INSERT INTO canjes (huella, usuario, lote, creado) VALUES (?, ?, ?, ?)", h, usuario, lote, ahora);
      if (altaNueva) this.sql.exec("INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'cupon', ?, NULL, NULL, 'autorizada', ?, ?)", usuario, `cupon:${h}`, ahora, ahora);
      this.cupos.otorgar({ usuario, cuenta: null, origen: "cupon", ref: `cupon:${h}:${usuario}`, sorteos, dias: Number(c.dias) }, ahora);
      // Ya se comprobó que no choca: si igual no ata, se deshace todo.
      if (cuenta && this.cupos.atar(usuario, cuenta, ahora) !== "ok") throw new Error("canje-atar");
      return { ok: true, repetido: false, sorteosSumados: sorteos, lote, altaNueva };
    });
  }

  /**
   * La bienvenida de una persona que entró con su cuenta (`usuario`, el id que dio Pollar), con su cuenta si ya se sabe. Activar
   * y regalar van separados, todo en una transacción y sin esperar a nadie:
   *
   * - Si ya recibió el regalo (existe el derecho `gratis:<usuario>`): `ya`, sin sumar nada; ata la cuenta si hace falta.
   * - Con la pausa a mano, nada nuevo: `altas-pausadas`.
   * - Activar: si no tiene alta (ni la suya ni la de su cuenta, `cuenta:G…`, la de un premio o un alta a mano), nace una con
   *   el motivo de las altas a mano (`admin`, que el código de antes ya conoce) y la referencia `gratis:<usuario>`, que dice
   *   que nació por acá. `activar` puede frenarla (el piso de créditos): `bienvenida-llena` sin escribir nada.
   * - Regalar: `regalar` dice si el regalo no entra ahora (un freno o el piso, que ya cuenta el alta recién creada). Si entra,
   *   los sorteos van al alta que vale (la nueva, la suya de antes o la de su cuenta) con la referencia `gratis:<usuario>`;
   *   si no, `lleno` y la cuenta queda activada igual. No mira si tuvo sorteos de otro origen: es uno por persona.
   * - La cuenta se ata al alta de la persona y entra al libro. Una cuenta que es de otra persona: `cuenta-de-otro`.
   */
  darBienvenida(
    p: {
      usuario: string;
      cuenta: string | null;
      sorteos: number;
      dias: number;
      pausada: boolean;
      activar: () => boolean;
      regalar: () => CausaRegalo | null;
    },
    ahora: number,
  ): Bienvenida {
    if (!texto(p.usuario, 200) || p.usuario.startsWith("cuenta:")) throw new Error("bienvenida-usuario");
    if (p.cuenta !== null && !StrKey.isValidEd25519PublicKey(p.cuenta)) throw new Error("bienvenida-cuenta");
    if (!entre(p.sorteos, 1, 1000) || !entre(p.dias, 1, 3650)) throw new Error("bienvenida-forma");
    const { usuario, cuenta } = p;
    const ref = refDeBienvenida(usuario);
    return this.cupos.transaccion((): Bienvenida => {
      if (cuenta && this.cupos.cuentaDeOtro(usuario, cuenta)) return { ok: false, motivo: "cuenta-de-otro" };
      const suya = this.cupos.altaDe(usuario);
      // Sin alta propia, la de su cuenta: la que le dio quien organizó un sorteo que ganó, o un alta a mano.
      const deSuCuenta = !suya && cuenta ? this.cupos.altaDe(`cuenta:${cuenta}`) : null;
      if (this.recibioBienvenida(usuario)) {
        if (suya && cuenta && this.cupos.atar(usuario, cuenta, ahora) !== "ok") return { ok: false, motivo: "cuenta-de-otro" };
        return { ok: true, regalo: "ya", sorteosSumados: 0, altaNueva: false, causa: null };
      }
      if (p.pausada) return { ok: false, motivo: "altas-pausadas" };
      const altaNueva = !suya && !deSuCuenta;
      if (altaNueva) {
        if (!p.activar()) return { ok: false, motivo: "bienvenida-llena" };
        this.sql.exec(
          "INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) " +
            "VALUES (?, 'admin', ?, NULL, NULL, 'autorizada', ?, ?)",
          usuario,
          ref,
          ahora,
          ahora,
        );
      }
      const causa = p.regalar();
      if (causa === null) {
        // A la de su cuenta, con esa cuenta (como el alta a mano); a la suya, sin cuenta: la pone `atar`, enseguida.
        const dueno = deSuCuenta ? { usuario: deSuCuenta.usuario, cuenta: deSuCuenta.cuenta ?? cuenta } : { usuario, cuenta: null };
        this.cupos.otorgar({ ...dueno, origen: "gratis", ref, sorteos: p.sorteos, dias: p.dias }, ahora);
      }
      // Ya se comprobó que no choca: si igual no ata, se deshace todo.
      if (!deSuCuenta && cuenta && this.cupos.atar(usuario, cuenta, ahora) !== "ok") throw new Error("bienvenida-atar");
      if (causa !== null) return { ok: true, regalo: "lleno", sorteosSumados: 0, altaNueva, causa };
      return { ok: true, regalo: "dado", sorteosSumados: p.sorteos, altaNueva, causa: null };
    });
  }

  /** Si la persona ya recibió el regalo de bienvenida. Solo lee. */
  recibioBienvenida(usuario: string): boolean {
    return this.filas("SELECT 1 AS n FROM derechos WHERE ref = ?", refDeBienvenida(usuario)).length > 0;
  }

  /** Cuántos regalos de bienvenida se dieron después de `desde` (ms): lo que miran los frenos por día y por hora. */
  regalosDesde(desde: number): number {
    return Number(this.filas("SELECT COUNT(*) AS n FROM derechos WHERE origen = 'gratis' AND ref LIKE 'gratis:%' AND creado > ?", desde)[0]?.n ?? 0);
  }

  /** Cómo va un lote, para el informe. null si no existe. Sin códigos, personas ni cuentas: solo cifras. */
  estadoDelLote(lote: string): EstadoLote | null {
    const f = this.filas("SELECT COUNT(*) AS creados, COALESCE(MAX(vence), 0) AS vence, COALESCE(SUM(anulado), 0) AS anulados FROM cupones WHERE lote = ?", lote)[0];
    const creados = Number(f?.creados ?? 0);
    if (!creados) return null;
    const canjeados = Number(this.filas("SELECT COUNT(*) AS n FROM canjes WHERE lote = ?", lote)[0]?.n ?? 0);
    const d = this.filas(
      "SELECT COUNT(DISTINCT d.cuenta) AS cuentas, COALESCE(SUM(d.usados), 0) AS usados FROM canjes k JOIN derechos d ON d.ref = 'cupon:' || k.huella || ':' || k.usuario WHERE k.lote = ?",
      lote,
    )[0];
    const anulados = Number(f?.anulados ?? 0);
    return { lote, creados, canjeados, cuentas: Number(d?.cuentas ?? 0), sorteosUsados: Number(d?.usados ?? 0), vence: Number(f?.vence ?? 0), anulado: anulados === creados, anulados };
  }

  /**
   * Un alta a mano: mete en el libro una cuenta que ya existe y le da sus sorteos oficiales con `ref` `admin:<ref>`. Todo
   * en una transacción y sin esperar a nadie.
   *
   * - El mismo `ref` para la misma cuenta: lo mismo (`repetido`), sin sumar. Para otra cuenta: `ref-usado`, sin escribir.
   * - Si la cuenta todavía no estaba en el libro es un alta nueva y cuenta para `techoAltas` del día; los sorteos cuentan
   *   para `techoSorteos`. Pasado un techo, nada se escribe.
   * - Si la cuenta ya es de un alta (de una persona con cupón, o de otra alta a mano), los sorteos van a esa alta. Si
   *   no, nace un alta `cuenta:<G>` con motivo `admin`, `abierta` si la cuenta ya existe en la red.
   */
  admitirAMano(p: { cuenta: string; sorteos: number; dias: number; ref: string; abierta: boolean; techoAltas: number; techoSorteos: number }, ahora: number): AltaAMano {
    if (!StrKey.isValidEd25519PublicKey(p.cuenta)) throw new Error("alta-cuenta");
    if (!entre(p.sorteos, 1, 1000) || !entre(p.dias, 1, 3650) || !texto(p.ref, 64)) throw new Error("alta-forma");
    const ref = `admin:${p.ref}`;
    return this.cupos.transaccion((): AltaAMano => {
      const previo = this.filas("SELECT cuenta FROM derechos WHERE ref = ?", ref)[0];
      if (previo) {
        if (previo.cuenta !== p.cuenta) return { ok: false, motivo: "ref-usado" };
        this.cupos.admitir(p.cuenta, "admin", ahora);
        return { ok: true, repetido: true, altaNueva: false };
      }
      const altaNueva = !this.cupos.estaEnElLibro(p.cuenta);
      const dia = diaUtc(ahora);
      const altasHoy = Number(this.cupos.ajuste(`altas_dia:${dia}`) ?? 0);
      const sorteosHoy = Number(this.cupos.ajuste(`derechos_dia:${dia}`) ?? 0);
      if (altaNueva && altasHoy + 1 > p.techoAltas) return { ok: false, motivo: "techo-altas" };
      if (sorteosHoy + p.sorteos > p.techoSorteos) return { ok: false, motivo: "techo-sorteos" };

      const duena = this.cupos.altaDeCuenta(p.cuenta);
      const usuario = duena?.usuario ?? `cuenta:${p.cuenta}`;
      if (!duena) {
        this.sql.exec(
          "INSERT INTO altas (usuario, motivo, ref, cuenta, pedido, estado, creada, actualizada) VALUES (?, 'admin', ?, ?, NULL, ?, ?, ?) ON CONFLICT(usuario) DO NOTHING",
          usuario,
          ref,
          p.cuenta,
          p.abierta ? "abierta" : "autorizada",
          ahora,
          ahora,
        );
      } else if (p.abierta) this.cupos.marcarAbierta(duena.usuario, ahora);
      this.cupos.admitir(p.cuenta, "admin", ahora);
      this.cupos.otorgar({ usuario, cuenta: p.cuenta, origen: "admin", ref, sorteos: p.sorteos, dias: p.dias }, ahora);
      if (altaNueva) this.cupos.fijarAjuste(`altas_dia:${dia}`, String(altasHoy + 1), ahora);
      this.cupos.fijarAjuste(`derechos_dia:${dia}`, String(sorteosHoy + p.sorteos), ahora);
      return { ok: true, repetido: false, altaNueva };
    });
  }

  /**
   * Sorteos dados a mano a una cuenta que ya está en el libro (una venta por QR a quien ya tiene acceso), con `ref`
   * `admin:<ref>`. Todo en una transacción y sin esperar a nadie.
   *
   * - Fuera del libro, `fuera-del-libro`: unos sorteos sin acceso no sirven (para eso está el alta a mano).
   * - El mismo `ref` para la misma cuenta: `repetido`, sin sumar. Para otra cuenta: `ref-usado`.
   * - Cuenta para el techo de sorteos dados a mano del día, el mismo del alta a mano.
   */
  darAMano(p: { cuenta: string; sorteos: number; dias: number; ref: string; techoSorteos: number }, ahora: number): DadoAMano {
    if (!StrKey.isValidEd25519PublicKey(p.cuenta)) throw new Error("dar-cuenta");
    if (!entre(p.sorteos, 1, 1000) || !entre(p.dias, 1, 3650) || !texto(p.ref, 64)) throw new Error("dar-forma");
    const ref = `admin:${p.ref}`;
    return this.cupos.transaccion((): DadoAMano => {
      const previo = this.filas("SELECT cuenta FROM derechos WHERE ref = ?", ref)[0];
      if (previo) return previo.cuenta === p.cuenta ? { ok: true, repetido: true } : { ok: false, motivo: "ref-usado" };
      if (!this.cupos.estaEnElLibro(p.cuenta)) return { ok: false, motivo: "fuera-del-libro" };
      const dia = diaUtc(ahora);
      const sorteosHoy = Number(this.cupos.ajuste(`derechos_dia:${dia}`) ?? 0);
      if (sorteosHoy + p.sorteos > p.techoSorteos) return { ok: false, motivo: "techo-sorteos" };
      const usuario = this.cupos.altaDeCuenta(p.cuenta)?.usuario ?? `cuenta:${p.cuenta}`;
      this.cupos.otorgar({ usuario, cuenta: p.cuenta, origen: "admin", ref, sorteos: p.sorteos, dias: p.dias }, ahora);
      this.cupos.fijarAjuste(`derechos_dia:${dia}`, String(sorteosHoy + p.sorteos), ahora);
      return { ok: true, repetido: false };
    });
  }

  /** Las cifras del día para `/estado`: altas de las últimas 24 horas, cupones canjeados hoy y usos de cupones creados hoy (UTC). */
  resumen(ahora: number): { altas24h: number; cuponesHoy: number; cuponesCreadosHoy: number } {
    const dia = diaUtc(ahora);
    const inicio = Date.parse(`${dia}T00:00:00.000Z`);
    return {
      altas24h: Number(this.filas("SELECT COUNT(*) AS n FROM altas WHERE creada > ?", ahora - DIA_MS)[0]?.n ?? 0),
      cuponesHoy: Number(this.filas("SELECT COUNT(*) AS n FROM canjes WHERE creado >= ?", inicio)[0]?.n ?? 0),
      cuponesCreadosHoy: Number(this.cupos.ajuste(`cupones_dia:${dia}`) ?? 0),
    };
  }

  /** Anula un lote entero o un cupón (por su huella). Lo ya canjeado no se toca: sus sorteos siguen. */
  anular(p: { lote: string } | { huella: string }): { anulados: number } {
    const [columna, valor] = "lote" in p ? ["lote", p.lote] : ["huella", p.huella];
    if (typeof valor !== "string" || !(columna === "lote" ? LOTE : HUELLA).test(valor)) throw new Error("anular-forma");
    return this.cupos.transaccion(() => {
      const anulados = Number(this.filas(`SELECT COUNT(*) AS n FROM cupones WHERE ${columna} = ? AND anulado = 0`, valor)[0]?.n ?? 0);
      this.sql.exec(`UPDATE cupones SET anulado = 1 WHERE ${columna} = ? AND anulado = 0`, valor);
      return { anulados };
    });
  }
}
