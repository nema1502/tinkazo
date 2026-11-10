/**
 * El portero: lo que pasa cuando llega una transacción. No sabe de Cloudflare:
 * recibe sus dependencias (los cupos, la red, la llave, el reloj) y por eso se
 * prueba entero sin red, con una red de mentira.
 *
 * El orden, de lo más barato a lo más caro (ver README.md):
 *   1. ¿está prendido? (y cuál rige)
 *   2. lista blanca y firma (`lista-blanca.ts`), sin tocar nada
 *   3. ¿ya se pagó este hash? Mismo resultado, una sola cuenta (el navegador reintenta)
 *   4. ¿la cuenta la abrió nuestra app?
 *   5. simular, para no pagar lo que va a fallar
 *   6. reservar cupo y presupuesto, de una vez (síncrono)
 *   7. envolver en un fee-bump, firmar con la llave acotada y mandar
 */
import { StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk/base";
import { type Config, DIA_MS, topesDeCuenta } from "./config";
import { type Cupo, type Cupos, type Limites } from "./cupos";
import { type Autoridad, esCuenta, evaluar } from "./lista-blanca";
import type { Planes } from "./plan";
import { type CuentaEnRed, ErrorDeRed, type Red } from "./red";

export type Modo = "portero" | "pollar" | "apagado";

export interface Firmante {
  /** La clave pública (G…) de la llave que firma. No es la cuenta patrocinadora: es una de sus llaves, de peso 1. */
  clavePublica: string;
  firmar(mensaje: Uint8Array): Promise<Uint8Array>;
}

export interface Respuesta {
  estado: number;
  cuerpo: Record<string, unknown>;
}

/** Los primeros caracteres de un hash: alcanza para seguir un pedido en la bitácora sin ponerlo entero. */
const corto = (hash: string) => hash.slice(0, 8);

/** Lo más que se puede subir el tope general por la ruta de ajustes: 100 XLM. Más hay que desplegar. */
export const TECHO_TOPE_GENERAL_STROOPS = 100 * 10_000_000;

/** Cuánto espera la alarma antes de preguntarle a la red por lo que quedó en el aire. */
export const ESPERA_RECONCILIAR_MS = 15_000;
/**
 * Pasado `vence` más este margen sin aparecer en la red, la transacción no entró nunca. Son 10 minutos y no 1:
 * un RPC atrasado (el segundo de la lista) puede contestar NOT_FOUND por algo que ya entró, y devolver el cupo
 * de algo que se pagó dejaría un pago sin contar.
 */
const MARGEN_VENCIMIENTO_S = 600;

const r = (estado: number, cuerpo: Record<string, unknown>): Respuesta => ({ estado, cuerpo });

export class Portero {
  constructor(
    private readonly cfg: Config,
    private readonly cupos: Cupos,
    private readonly red: Red,
    private readonly firmante: Firmante | null,
    /** La cuenta patrocinadora (G…), la que paga y tiene las dos llaves. */
    private readonly cuentaPatrocinadora: string | null,
    private readonly reloj: () => number = () => Date.now(),
    /** Se llama cuando queda algo en el aire, para que el objeto programe su alarma. */
    private readonly alQuedarEnElAire: () => void = () => {},
    /**
     * La bitácora de los hechos clave (`wrangler tail`, Workers Logs). Solo nombres fijos, cifras y el comienzo del hash:
     * nunca una dirección IP, un nombre, una cuenta ni una llave. Los eventos que empiezan con `error-` salen como error.
     */
    private readonly registrar: (evento: string, datos?: Record<string, string | number>) => void = () => {},
    /** Quien averigua si una cuenta tiene el plan del equipo (que le sube el cupo). Sin él, todas tienen el cupo de siempre. */
    private readonly planes: Planes | null = null,
  ) {}

  // ---------- estado ----------

  modo(): Modo {
    if (this.cfg.apagadoPorVariable) return "apagado";
    const m = this.cupos.ajuste("modo");
    return m === "apagado" || m === "pollar" ? m : "portero";
  }

  /** Los topes vigentes: lo de las variables, y encima lo que se ajustó por la ruta de administración. */
  private limites(cuenta: string): Limites {
    const base = topesDeCuenta(this.cfg, cuenta);
    const n = (clave: string, def: number) => {
      const v = this.cupos.ajuste(clave);
      return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : def;
    };
    const verificada = this.cfg.verificadas.has(cuenta);
    const maxSellos = verificada ? base.sellos : n("max_sellos_mes", base.sellos);
    return { maxSellos, maxSorteos: verificada ? base.sorteos : maxSellos * 2, topeGeneral: n("tope_general_stroops", this.cfg.topeGeneral), reservaSorteo: this.cfg.reservaSorteo };
  }

  /**
   * Los topes de la cuenta ahora: los de siempre y, si tiene el plan del equipo activo, el cupo del plan si es más alto
   * (el plan sube, nunca baja). Espera a lo sumo lo que tarda la consulta del plan (1,5 s) y **nunca falla por ella**:
   * si no hay respuesta, vale el cupo de siempre. Se llama antes de reservar, nunca en medio: reservar sigue siendo síncrono.
   */
  private async limitesDe(cuenta: string): Promise<Limites> {
    const lim = this.limites(cuenta);
    const plan = this.planes ? await this.planes.cupoDe(cuenta).catch(() => null) : null;
    if (!plan) return lim;
    return { ...lim, maxSellos: Math.max(lim.maxSellos, plan.sellos), maxSorteos: Math.max(lim.maxSorteos, plan.sorteos) };
  }

  /** Lo más que se acepta que declare una transacción de recursos, dada la simulación: 1,5 veces más un margen fijo. */
  private techoDeRecursos(minResourceFee: number): number {
    return Math.ceil(1.5 * minResourceFee) + this.cfg.margenRecursos;
  }

  private topeTx(): number {
    const v = this.cupos.ajuste("tope_tx_stroops");
    return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : this.cfg.topeTx;
  }

  /** Lo que le falta a la configuración para poder pagar algo: vacío si está completa. Nombres fijos, sin valores. */
  faltaDeConfig(): string[] {
    const falta: string[] = [];
    if (!this.cfg.contractId) falta.push("contrato");
    if (!this.firmante) falta.push("llave");
    if (!this.cuentaPatrocinadora) falta.push("cuenta");
    // En mainnet la lista de billeteras de la app es obligatoria: vacía, nadie pasa el control.
    if (this.cfg.red === "mainnet" && this.cfg.patrocinadoresApp.size === 0) falta.push("billeteras-de-la-app");
    return falta;
  }

  /**
   * `GET /v1/patrocinio/cupo?cuenta=G…`: lo que queda, quién rige y si de verdad se puede pagar.
   * `prendido` significa "el portero paga": es false si se apagó (`motivo:"apagado"`), si falta la llave, la cuenta o el
   * contrato (`motivo:"config"`) y si se devolvió a Pollar (`motivo:"pollar"`, con `rige:"pollar"`). El cliente decide
   * primero por `rige` y recién después por `prendido`.
   */
  async cupoDe(cuenta: string): Promise<Respuesta> {
    if (!esCuenta(cuenta)) return r(400, { motivo: "cuenta" });
    const modo = this.modo();
    const lim = await this.limitesDe(cuenta);
    const ahora = this.reloj();
    const c: Cupo = this.cupos.consultar(cuenta, ahora, lim);
    const configCompleta = this.faltaDeConfig().length === 0;
    const prendido = modo === "portero" && configCompleta;
    return r(200, {
      prendido,
      ...(prendido ? {} : { motivo: modo === "apagado" ? "apagado" : modo === "pollar" ? "pollar" : "config" }),
      rige: modo === "pollar" ? "pollar" : "portero",
      red: this.cfg.red,
      mes: c.mes,
      sellos: { usados: c.sellos, max: c.maxSellos, quedan: c.quedan },
      sorteos: { usados: c.sorteos, max: c.maxSorteos, quedan: c.quedanSorteos },
      liberaEn: c.liberaEn,
    });
  }

  // ---------- el pedido ----------

  async procesar(xdrBase64: string): Promise<Respuesta> {
    const modo = this.modo();
    if (modo !== "portero" || !this.cfg.contractId) return r(503, { motivo: "apagado", rige: modo === "pollar" ? "pollar" : "ninguno" });
    if (!this.firmante || !this.cuentaPatrocinadora) return r(503, { motivo: "apagado", detalle: "sin-llave" });

    const ahora = this.reloj();
    const topeTx = this.topeTx();
    // La cuenta se lee de la cadena a lo sumo una vez por pedido: sirve para los firmantes y para saber quién la abrió.
    let lectura: Promise<CuentaEnRed | null> | undefined;
    const leer = (g: string) => (lectura ??= this.red.leerCuenta(g));
    let v;
    try {
      v = await evaluar(xdrBase64, {
        passphrase: this.cfg.passphrase,
        contractId: this.cfg.contractId,
        ahoraS: Math.floor(ahora / 1000),
        topeTx,
        ventanaMaxS: this.cfg.ventanaMaxS,
        inclusionMax: this.cfg.inclusionBump,
        autoridad: async (g) => autoridadDe(await leer(g)),
      });
    } catch (e) {
      if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
      throw e;
    }
    if (!v.ok) return r(400, { motivo: "no-permitida", razon: v.motivo, detalle: v.detalle });
    const tx = v.tx;

    // Los topes de esta cuenta (con su plan, si lo tiene), antes de mirar nada del hash: acá puede haber una espera corta.
    const lim = await this.limitesDe(tx.cuenta);
    // Ya pagada o en camino: el mismo resultado, sin volver a contar.
    const previa = this.cupos.buscar(tx.hash);
    if (previa && (previa.estado === "ok" || previa.estado === "fallo")) {
      const c = this.cupos.consultar(tx.cuenta, ahora, lim);
      return r(200, { hash: tx.hash, status: "DUPLICATE", estado: previa.estado, quedan: c.quedan, quedanSorteos: c.quedanSorteos });
    }
    let esElPrimero = false;
    let quedan: { quedan: number; quedanSorteos: number } | null = null;

    if (!previa || previa.estado === "devuelto") {
      let recursosSimulados = 0;
      try {
        if (!(await this.laAbrioNuestraApp(tx.cuenta, ahora, leer))) return r(403, { motivo: "cuenta-ajena" });
        const sim = await this.red.simular(xdrBase64);
        if (!sim.ok) return sim.motivo === "restaurar" ? r(400, { motivo: "no-permitida", razon: "restaurar", detalle: sim.detalle }) : r(400, { motivo: "fallaria", detalle: sim.detalle });
        if (sim.minResourceFee > topeTx) return r(400, { motivo: "no-permitida", razon: "fee-alta", detalle: "simulacion" });
        // Los recursos que declara la transacción se comparan con los que simuló la red: la red cobra lo declarado.
        if (tx.resourceFee > this.techoDeRecursos(sim.minResourceFee)) return r(400, { motivo: "fee-alta", detalle: "recursos" });
        recursosSimulados = sim.minResourceFee;
      } catch (e) {
        if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
        throw e;
      }
      // Desde acá hasta reservar no hay ningún await: comprobar y reservar es una sola jugada.
      // El estimado sale de la simulación y de nuestra configuración, nunca de lo que declara el cliente.
      const estimado = this.techoDeRecursos(recursosSimulados) + 2 * this.cfg.inclusionBump;
      const res = this.cupos.reservar({ hash: tx.hash, cuenta: tx.cuenta, metodo: tx.metodo, estimado, vence: tx.venceS }, ahora, lim);
      if (!res.ok) {
        if (res.motivo === "cupo-cuenta") return r(429, { motivo: "cupo-cuenta", que: res.que, liberaEn: res.liberaEn, max: res.max });
        return r(503, { motivo: "fondo" });
      }
      esElPrimero = !res.yaContado;
      quedan = { quedan: res.quedan, quedanSorteos: res.quedanSorteos };
      this.cupos.purgar(ahora);
      // La alarma se pide ya, antes de importar la llave, envolver y mandar: si el objeto muere en el medio,
      // la fila `reservado` no queda sin nadie que la mire (la alarma le pregunta a la red y, si no entró, la devuelve).
      if (esElPrimero) {
        this.alQuedarEnElAire();
        this.registrar("reservado", { metodo: tx.metodo, hash: corto(tx.hash), estimado });
      }
    }

    // Mientras esperábamos a la red otro pedido del mismo hash pudo reservarlo y hasta cerrarlo: `previa` ya es vieja.
    if (!esElPrimero) {
      const actual = this.cupos.buscar(tx.hash);
      if (actual && (actual.estado === "ok" || actual.estado === "fallo")) {
        const q = this.cupos.consultar(tx.cuenta, ahora, lim);
        return r(200, { hash: tx.hash, status: "DUPLICATE", estado: actual.estado, quedan: q.quedan, quedanSorteos: q.quedanSorteos });
      }
    }

    // Ya estaba en camino (el navegador reintenta): antes de reenviarla se mira si la red ya la cerró.
    if (previa && !esElPrimero && (previa.estado === "reservado" || previa.estado === "enviado")) {
      try {
        const c = await this.red.consultar(tx.hash);
        if (c.status === "SUCCESS" || c.status === "FAILED") {
          this.registrar("resultado", { hash: corto(tx.hash), estado: c.status === "SUCCESS" ? "ok" : "fallo", real: c.feeCharged ?? 0 });
          this.cupos.cerrar(tx.hash, c.status === "SUCCESS" ? "ok" : "fallo", c.feeCharged ?? null);
          const q = this.cupos.consultar(tx.cuenta, ahora, lim);
          return r(200, { hash: tx.hash, status: "DUPLICATE", estado: c.status === "SUCCESS" ? "ok" : "fallo", quedan: q.quedan, quedanSorteos: q.quedanSorteos });
        }
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) throw e;
      }
    }

    // Envolver y mandar. Reenviar la misma es seguro: el mismo fee-bump tiene el mismo hash.
    let envuelta: string;
    try {
      envuelta = await this.envolver(xdrBase64);
    } catch (e) {
      if (esElPrimero) this.cupos.devolver(tx.hash);
      this.registrar("error-interno", { donde: "envolver", hash: corto(tx.hash), error: String(e).slice(0, 120) });
      return r(500, { motivo: "interno" });
    }
    let envio;
    try {
      envio = await this.red.enviar(envuelta);
    } catch (e) {
      // No se sabe si llegó. Queda reservada: la alarma le pregunta a la red por su hash.
      this.alQuedarEnElAire();
      this.registrar("error-envio", { hash: corto(tx.hash), error: e instanceof ErrorDeRed ? e.message.slice(0, 80) : "desconocido" });
      if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
      throw e;
    }
    if (envio.status === "PENDING" || envio.status === "DUPLICATE") {
      this.cupos.marcarEnviado(tx.hash);
      this.registrar("enviado", { hash: corto(tx.hash), red: envio.status });
      this.alQuedarEnElAire();
      const c = quedan ?? this.cupos.consultar(tx.cuenta, ahora, lim);
      return r(200, { hash: tx.hash, status: envio.status, quedan: c.quedan, quedanSorteos: c.quedanSorteos });
    }
    // Un reenvío de algo que la red ya había tomado: que ahora diga otra cosa (TRY_AGAIN_LATER, secuencia vieja) casi siempre
    // quiere decir que ya entró. No se devuelve ni se rechaza: la alarma confirma qué fue.
    if (previa?.estado === "enviado") {
      this.alQuedarEnElAire();
      const c = this.cupos.consultar(tx.cuenta, ahora, lim);
      return r(200, { hash: tx.hash, status: "DUPLICATE", quedan: c.quedan, quedanSorteos: c.quedanSorteos });
    }
    // La red no la tomó: no entró a ningún ledger, no se pagó nada, el cupo vuelve.
    if (esElPrimero) this.cupos.devolver(tx.hash);
    this.registrar("rechazada-por-la-red", { hash: corto(tx.hash), codigo: envio.codigo ?? envio.status });
    if (envio.status === "TRY_AGAIN_LATER") return r(502, { motivo: "red", detalle: "TRY_AGAIN_LATER" });
    if (envio.codigo && /InsufficientBalance|InsufficientFee/.test(envio.codigo)) return r(503, { motivo: "fondo", codigo: envio.codigo });
    return r(400, { motivo: "rechazada", codigo: envio.codigo ?? "desconocido" });
  }

  /** ¿La abrió nuestra app? Una cuenta de prueba, una ya vista, o una cuya reserva paga la billetera de fondos de Pollar. */
  private async laAbrioNuestraApp(cuenta: string, ahora: number, leer: (g: string) => Promise<CuentaEnRed | null>): Promise<boolean> {
    if (this.cfg.prueba.has(cuenta) || this.cupos.cuentaConocida(cuenta)) return true;
    const c = await leer(cuenta);
    if (!c?.patrocinador || !this.cfg.patrocinadoresApp.has(c.patrocinador)) return false;
    this.cupos.recordarCuenta(cuenta, ahora);
    return true;
  }

  /** El fee-bump de la transacción, firmado con la llave del Worker. La cuenta que paga es la patrocinadora. */
  private async envolver(xdrBase64: string): Promise<string> {
    const interna = TransactionBuilder.fromXDR(xdrBase64, this.cfg.passphrase) as Transaction;
    // La oferta de inclusión es la nuestra: la lista blanca ya exigió que la interna no declare más.
    const bump = TransactionBuilder.buildFeeBumpTransaction(this.cuentaPatrocinadora as string, String(this.cfg.inclusionBump), interna, this.cfg.passphrase);
    const firma = await (this.firmante as Firmante).firmar(bump.hash());
    bump.addSignature((this.firmante as Firmante).clavePublica, btoa(String.fromCharCode(...firma)));
    return bump.toXDR();
  }

  // ---------- lo que quedó en el aire ----------

  /**
   * Le pregunta a la red qué fue de lo que mandamos y todavía no sabemos. Entró: se
   * pagó, salga bien o mal (cuenta, y se anota lo que cobró la red). No entró y ya
   * venció: no se pagó nada, el cupo vuelve. Devuelve si todavía queda algo en el aire.
   */
  async reconciliar(): Promise<boolean> {
    const ahora = this.reloj();
    for (const f of this.cupos.pendientes(ahora - ESPERA_RECONCILIAR_MS)) {
      try {
        const c = await this.red.consultar(f.hash);
        if (c.status === "SUCCESS" || c.status === "FAILED") {
          this.cupos.cerrar(f.hash, c.status === "SUCCESS" ? "ok" : "fallo", c.feeCharged ?? null);
          this.registrar("resultado", { hash: corto(f.hash), estado: c.status === "SUCCESS" ? "ok" : "fallo", real: c.feeCharged ?? 0 });
        } else if (Math.floor(ahora / 1000) > f.vence + MARGEN_VENCIMIENTO_S) {
          this.cupos.devolver(f.hash);
          this.registrar("devuelto", { hash: corto(f.hash), motivo: "vencida-sin-aparecer" });
        }
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) throw e;
        // Sin red: se vuelve a intentar en la próxima vuelta.
      }
    }
    this.cupos.purgar(ahora);
    const quedan = this.cupos.enElAire();
    this.registrar("alarma", { enElAire: quedan });
    return quedan > 0;
  }

  // ---------- administración ----------

  poner(modo: Modo): void {
    this.cupos.fijarAjuste("modo", modo, this.reloj());
  }

  ajustar(clave: string, valor: number): boolean {
    if (!["max_sellos_mes", "tope_general_stroops", "tope_tx_stroops"].includes(clave) || !Number.isFinite(valor) || valor < 0) return false;
    // Un techo duro en el código: con la clave de administración filtrada no se sube el tope general a lo que sea.
    if (clave === "tope_general_stroops" && valor > TECHO_TOPE_GENERAL_STROOPS) return false;
    if (clave === "tope_tx_stroops" && valor > this.cfg.topeTx) return false;
    this.cupos.fijarAjuste(clave, String(Math.floor(valor)), this.reloj());
    return true;
  }

  /**
   * `GET /v1/patrocinio/estado`: el saldo de la patrocinadora, leído de la red, y `alerta:true` si está por debajo de
   * `SALDO_ALERTA_STROOPS` o si no se pudo leer. El paso diario de la CI lo llama y falla si hay alerta.
   */
  async estado(): Promise<Respuesta> {
    const ahora = this.reloj();
    let saldo: bigint | null = null;
    if (this.cuentaPatrocinadora) {
      try {
        const c = await this.red.leerCuenta(this.cuentaPatrocinadora);
        saldo = c ? c.balance : null;
      } catch {
        saldo = null;
      }
    }
    const alerta = saldo === null || saldo < BigInt(this.cfg.saldoAlerta);
    if (alerta) this.registrar("error-saldo", { saldo: saldo === null ? "no-leido" : String(saldo), alerta: this.cfg.saldoAlerta });
    return r(200, {
      modo: this.modo(),
      red: this.cfg.red,
      patrocinadora: this.cuentaPatrocinadora,
      llave: this.firmante?.clavePublica ?? null,
      balanceStroops: saldo === null ? null : String(saldo),
      saldoAlertaStroops: this.cfg.saldoAlerta,
      alerta,
      ...(alerta ? { motivoAlerta: saldo === null ? "saldo-no-leido" : "saldo-bajo" } : {}),
      topeGeneralStroops: this.limites("").topeGeneral,
      ...this.cupos.resumen(ahora),
      ventanaMs: DIA_MS,
    });
  }
}

/** Los firmantes y el umbral medio de una cuenta leída de la cadena, o null si no se leyó (entonces vale solo su llave, con peso 1). */
function autoridadDe(c: CuentaEnRed | null): Autoridad | null {
  if (!c?.firmantes) return null;
  return { firmantes: c.firmantes, umbral: c.umbralMedio ?? 1 };
}

/** La clave pública (G…) de una llave secreta (S…), con WebCrypto y sin el SDK. */
export async function firmanteDe(secreta: string): Promise<Firmante> {
  const semilla = StrKey.decodeEd25519SecretSeed(secreta);
  // PKCS#8 de una clave Ed25519: este prefijo fijo y la semilla.
  const pkcs8 = new Uint8Array(48);
  pkcs8.set([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);
  pkcs8.set(semilla, 16);
  const clave = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
  const jwk = (await crypto.subtle.exportKey("jwk", clave)) as JsonWebKey;
  if (!jwk.x) throw new Error("llave-sin-publica");
  const b64 = jwk.x.replace(/-/g, "+").replace(/_/g, "/");
  const publica = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return {
    clavePublica: StrKey.encodeEd25519PublicKey(publica as never),
    firmar: async (mensaje) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, clave, mensaje as BufferSource)),
  };
}
