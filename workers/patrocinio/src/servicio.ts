/**
 * El portero: lo que pasa cuando llega una transacción. No sabe de Cloudflare:
 * recibe sus dependencias (los cupos, la red, la llave, el reloj) y por eso se
 * prueba entero sin red, con una red de mentira.
 *
 * El orden, de lo más barato a lo más caro (ver README.md):
 *   1. ¿está prendido? (y cuál rige)
 *   2. lista blanca y firma (`lista-blanca.ts`), sin tocar nada
 *   3. ¿ya se pagó este hash? Mismo resultado, una sola cuenta (el navegador reintenta)
 *   4. ¿la cuenta la abrió nuestra app? (en mainnet con altas: ¿está en el libro?)
 *   5. simular, para no pagar lo que va a fallar
 *   6. reservar cupo y presupuesto (y en mainnet con altas, los sorteos oficiales del sello), de una vez (síncrono)
 *   7. envolver en un fee-bump, firmar con la llave acotada y mandar
 */
import { StrKey, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk/base";
import {
  AJUSTE_BIENVENIDA_CERRADA,
  AJUSTE_CORREO_CERRADO,
  AJUSTE_CORREO_DIA,
  AJUSTE_RESERVA_REGALO,
  AJUSTES_BIENVENIDA_TOPE,
  type Config,
  DIA_MS,
  TECHO_BIENVENIDA_TOPE,
  TECHO_CORREO_DIA,
  TECHO_RESERVA_REGALO,
  sorteosDelMes,
  topesDeCuenta,
} from "./config";
import { type Cupo, type Cupos, type FilaUso, type Limites } from "./cupos";
import { type Autoridad, esCuenta, evaluar } from "./lista-blanca";
import type { Planes } from "./plan";
import { type Consulta, type CuentaEnRed, ErrorDeRed, type Red } from "./red";
import { selloQueEntroTarde } from "./sello-tarde";
import { CODIGO_RONDA_NO_LISTA, CODIGO_YA_SORTEADO, REINTENTAR_RONDA_MS, type Sorteadora, VENTANA_SORTEO_S, leerFirma, leerNumeroDeSorteo, leerSorteo } from "./sorteadora";

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
export const MARGEN_VENCIMIENTO_S = 600;

/**
 * Cuántas veces en 24 horas móviles se le devuelve a una cuenta lo que gastó un sello que entró tarde (`sello-tarde.ts`).
 * Una cuenta de verdad lo ve una vez en una noche mala: el 13 de noviembre de 2026 fue una. Más que esto se parece a
 * alguien que manda sellos con la ronda justa para hacernos pagar comisiones sin gastar nada, y deja de devolverse.
 */
export const DEVOLUCIONES_POR_DIA = 3;
/**
 * Cuántas devoluciones de sellos que entraron tarde hace el portero en 24 horas móviles, sumando todas las cuentas. El
 * tope de arriba es por cuenta: con muchas cuentas del libro, alguien podría provocar sellos tardíos sin perder nada y
 * que la red nos cobre la comisión de cada uno. Pasado este número no se devuelve solo: queda para devolverlo a mano
 * (`tope-general` en `devoluciones_pendientes`), así quien de verdad lo perdió no lo pierde.
 *
 * De dónde sale: la noche del 13 de noviembre de 2026 hubo un sello tardío en toda la red principal. Veinte cubren una
 * noche mala con un evento entero (varias mesas sellando a la vez con la red lenta) y acotan lo que se regala: el sello
 * fallido de esa noche cobró 5.478 stroops, así que veinte son unos 110.000 stroops por día, menos del 0,1 % del tope
 * general de 15 XLM (`TOPE_GENERAL_STROOPS`).
 */
export const DEVOLUCIONES_POR_DIA_EN_TOTAL = 20;
/** Los dos topes de arriba, como los piden `Cupos.devolverSelloTardio` y `Cupos.topeDeDevoluciones`. */
const TOPES_DE_DEVOLUCION = { tope: DEVOLUCIONES_POR_DIA, topeGeneral: DEVOLUCIONES_POR_DIA_EN_TOTAL } as const;
/**
 * Cuántas veces se prueba un sello fallido cuando el RPC no trajo lo necesario para comprobar por qué falló (`sin-datos`
 * en `sello-tarde.ts`: sin el sobre, sin el resultado o sin la hora), y cuánto se espera entre una y otra. Con eso se
 * cubre un RPC que contestó a medias unos minutos. Pasados los intentos, el sello queda para devolverlo a mano.
 */
export const INTENTOS_DE_PRUEBA = 6;
export const ESPERA_ENTRE_PRUEBAS_MS = 60_000;
/**
 * Cuánto espera `/cupo` a que la red diga qué fue de los sellos de la cuenta que siguen en el aire. El sitio espera
 * `/cupo` 6 s (`TOPE_CUPO_MS`, `src/stellar/patrocinador.ts`): con la red lenta se contesta con lo que se sabe y la
 * alarma lo resuelve después.
 */
export const TOPE_ASENTAR_MS = 2_500;
/** Hasta cuántos sellos en el aire de una cuenta, y de cuánto tiempo atrás, se averiguan antes de contestar. */
const ASENTAR_MAX = 3;
const ASENTAR_DESDE_MS = 15 * 60_000;
/**
 * Cada cuánto, como mucho, `/cupo` le vuelve a preguntar a la red por el mismo sello en el aire. Un ledger se cierra cada
 * unos 5 s: preguntar más seguido no trae nada nuevo. `/cupo` es abierto y la cuenta es un dato público, así que sin este
 * freno cada pedido sobre una cuenta con un sello en el aire era una consulta al RPC. Con él, lo más que se pregunta es
 * una vez cada 5 s por cada sello que de verdad está en el aire, se pida `/cupo` las veces que se pida.
 */
export const ASENTAR_CADA_MS = 5_000;

const r = (estado: number, cuerpo: Record<string, unknown>): Respuesta => ({ estado, cuerpo });

export class Portero {
  /** Los pedidos de sorteo en curso, por sorteo y firma: los iguales que llegan casi juntos comparten el trabajo y la respuesta. */
  private readonly vuelos = new Map<string, Promise<Respuesta>>();
  /** Cuándo se le preguntó a la red por última vez por cada sello en el aire (`asentarSellosDe`). Vive en la memoria del objeto. */
  private readonly preguntadoEn = new Map<string, number>();
  /** La averiguación en curso de cada cuenta: los `/cupo` que llegan mientras tanto esperan esa misma y no abren otra. */
  private readonly asentando = new Map<string, Promise<number>>();

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
    /** La cuenta sorteadora, para el sorteo del servidor (`/v1/sorteo`). Sin ella, esa ruta da `503 apagado`. */
    private readonly sorteadora: Sorteadora | null = null,
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
    return {
      maxSellos,
      maxSorteos: verificada ? base.sorteos : sorteosDelMes(this.cfg.red, maxSellos),
      topeGeneral: n("tope_general_stroops", this.cfg.topeGeneral),
      reservaSorteo: this.cfg.reservaSorteo,
      // En mainnet con las altas, cada sello gasta sorteos oficiales de la cuenta. En testnet, nunca.
      porSorteos: this.cfg.red === "mainnet" && this.cfg.altas,
    };
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
    const maxSellos = Math.max(lim.maxSellos, plan.sellos);
    // En mainnet los sorteos del mes no pasan de los sellos, tampoco con el plan.
    return { ...lim, maxSellos, maxSorteos: this.cfg.red === "mainnet" ? maxSellos : Math.max(lim.maxSorteos, plan.sorteos) };
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
    // En mainnet la lista de billeteras de la app es obligatoria: vacía, nadie pasa el control. Con las altas la puerta
    // mira solo el libro de cuentas, así que la lista no hace falta.
    if (this.cfg.red === "mainnet" && !this.cfg.altas && this.cfg.patrocinadoresApp.size === 0) falta.push("billeteras-de-la-app");
    return falta;
  }

  /**
   * `GET /v1/patrocinio/cupo?cuenta=G…`: lo que queda, quién rige y si de verdad se puede pagar.
   * `prendido` significa "el portero paga": es false si se apagó (`motivo:"apagado"`), si falta la llave, la cuenta o el
   * contrato (`motivo:"config"`) y si se devolvió a Pollar (`motivo:"pollar"`, con `rige:"pollar"`). El cliente decide
   * primero por `rige` y recién después por `prendido`.
   *
   * En mainnet con las altas suma `oficial:{acceso, sorteos:{quedan, proximoVence}|null}`, y `sellos.quedan` pasa a ser lo
   * menor entre el mes y los sorteos oficiales: el sitio no pide una firma que el portero va a rechazar.
   *
   * Antes de contar se le pregunta a la red por los sellos de la cuenta que siguen en el aire (`asentarSellosDe`): si uno
   * entró tarde y el contrato lo rechazó, su sorteo vuelve ahora y no recién con la alarma. Es lo que pregunta el sitio
   * antes de la firma del reintento, segundos después de ver la falla.
   */
  async cupoDe(cuenta: string): Promise<Respuesta> {
    if (!esCuenta(cuenta)) return r(400, { motivo: "cuenta" });
    await this.asentarSellosDe(cuenta);
    const modo = this.modo();
    const lim = await this.limitesDe(cuenta);
    const ahora = this.reloj();
    const c: Cupo = this.cupos.consultar(cuenta, ahora, lim);
    const configCompleta = this.faltaDeConfig().length === 0;
    const prendido = modo === "portero" && configCompleta;
    const oficial = this.oficialDe(cuenta, ahora);
    return r(200, {
      prendido,
      ...(prendido ? {} : { motivo: modo === "apagado" ? "apagado" : modo === "pollar" ? "pollar" : "config" }),
      rige: modo === "pollar" ? "pollar" : "portero",
      red: this.cfg.red,
      mes: c.mes,
      // En mainnet con las altas, los sellos que quedan son lo menor entre el mes y los sorteos oficiales (sin acceso, 0).
      sellos: { usados: c.sellos, max: c.maxSellos, quedan: oficial ? Math.min(c.quedan, oficial.sorteos?.quedan ?? 0) : c.quedan },
      sorteos: { usados: c.sorteos, max: c.maxSorteos, quedan: c.quedanSorteos },
      liberaEn: c.liberaEn,
      ...(oficial ? { oficial } : {}),
      // Si el portero devolvería ahora el sorteo de un sello de esta cuenta que entró tarde (`devolverSiEntroTarde`): sí
      // mientras ni la cuenta ni el portero llegaron a su tope de devoluciones del día. Se mira después de asentar, con lo
      // que se acaba de cerrar contado. El sitio promete la devolución solo con `true`. Un portero de antes no lo manda.
      devuelve: this.cupos.topeDeDevoluciones(cuenta, ahora, TOPES_DE_DEVOLUCION) === null,
    });
  }

  /**
   * Lo oficial de una cuenta, solo en mainnet con las altas (si no, null y `/cupo` sigue como siempre): si está en el
   * libro (`acceso`) y, si está, cuántos sorteos oficiales le quedan y el próximo vencimiento con cuántos vencen.
   */
  private oficialDe(cuenta: string, ahora: number): { acceso: boolean; sorteos: { quedan: number; proximoVence: { fecha: number; cuantos: number } | null } | null } | null {
    if (this.cfg.red !== "mainnet" || !this.cfg.altas) return null;
    if (!this.cupos.estaEnElLibro(cuenta)) return { acceso: false, sorteos: null };
    const q = this.cupos.quedan({ cuenta }, ahora);
    return { acceso: true, sorteos: { quedan: q.quedan, proximoVence: q.proximoVence } };
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
      let selloHash: string | null = null;
      let sorteoDelDraw: bigint | null = null;
      try {
        if (!(await this.laAbrioNuestraApp(tx.cuenta, ahora, leer))) return r(403, { motivo: "cuenta-ajena" });
        // En mainnet con las altas, un `draw` se paga solo si su sello lo pagó el portero (con o sin el sorteo del servidor):
        // así nadie sella con Freighter y nos pasa el sorteo. Se mira antes de simular, con una lectura de `get_raffle` que
        // no cuesta nada; si la red no deja leer, 502 red y no se paga.
        if (this.cfg.soloSellosDelPortero && tx.metodo === "draw") {
          const id = tx.sorteo === null ? null : leerNumeroDeSorteo(tx.sorteo);
          sorteoDelDraw = id;
          const s = id === null ? null : await leerSorteo(this.red, { passphrase: this.cfg.passphrase, contractId: this.cfg.contractId, origen: tx.cuenta }, id);
          selloHash = s ? this.cupos.selloDelPortero(s.organizador, s.huellaLista, s.ronda) : null;
          if (!selloHash) return r(403, { motivo: "no-es-nuestro" });
        }
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
      const pedido = { hash: tx.hash, cuenta: tx.cuenta, metodo: tx.metodo, estimado, vence: tx.venceS, ganadores: tx.ganadores, sello: tx.sello, selloHash };
      let res = this.cupos.reservar(pedido, ahora, lim);
      // Un sello sin sorteos (o sin cupo del mes) puede ser el reintento de uno que entró tarde y que la alarma todavía no
      // cerró: se le pregunta a la red por los de la cuenta y, si alguno vuelve, se reserva otra vez. Es una jugada nueva,
      // síncrona como la primera.
      // Pregunta aunque `/cupo` acabe de preguntar (`forzar`): es el reintento de la persona, que firmó con la falla a la vista.
      if (!res.ok && tx.metodo === "seal" && (res.motivo === "sin-sorteos" || res.motivo === "cupo-cuenta") && (await this.asentarSellosDe(tx.cuenta, true)) > 0) {
        res = this.cupos.reservar(pedido, ahora, lim);
      }
      if (!res.ok) {
        if (res.motivo === "sin-sorteos") return r(402, { motivo: "sin-sorteos", vencieron: res.vencieron });
        if (res.motivo === "cupo-cuenta") return r(429, { motivo: "cupo-cuenta", que: res.que, liberaEn: res.liberaEn, max: res.max });
        return r(503, { motivo: "fondo" });
      }
      esElPrimero = !res.yaContado;
      quedan = { quedan: res.quedan, quedanSorteos: res.quedanSorteos };
      this.cupos.purgar(ahora);
      if (selloHash !== null && sorteoDelDraw !== null) {
        this.atarAlSello(selloHash, sorteoDelDraw, tx.hash, ahora);
      }
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
          this.cerrarConLaRed(tx.hash, c);
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

  // ---------- el sorteo por el servidor ----------

  /**
   * `POST /v1/sorteo`: manda el `draw` de un sorteo desde la cuenta sorteadora, con la firma de la ronda que ya calculó
   * el navegador (96 bytes en hexadecimal). La persona no firma nada. Solo en mainnet con `SORTEO_SERVIDOR=1`.
   *
   *   1. lee el sorteo con `get_raffle` (solo lectura) y exige que el organizador esté en el libro y que su sello lo haya
   *      pagado el portero (una fila de `sellos_portero` con el mismo organizador, huella y ronda): si no, 403;
   *   2. ya sorteado, `{ya:true}`; ya pedido y en camino, el mismo hash;
   *   3. simula el `draw`: ahí el contrato comprueba la firma, así que una que no pasa da 400 sin reservar ni pagar nada;
   *   4. la admisión: si la sorteadora está con otro sorteo, `503 ocupado`, sin reservar, firmar ni mandar nada. Si no, la
   *      toma (`Sorteadora.tomar`): la secuencia, la firma, la reserva contra el organizador (su tope de sorteos del mes y
   *      lo guardado para su sello), el fee-bump de siempre y el envío. Con la secuencia vieja, relee la cuenta y reintenta
   *      una vez;
   *   5. tomado el envío, la respuesta sale con el hash y la sorteadora sigue ocupada hasta que este entre (la red guarda
   *      una sola transacción pendiente por cuenta) o hasta que pase el plazo, y entonces relee la secuencia. Lo mismo
   *      después de un corte al mandar, porque no se sabe si llegó.
   *
   * Los pedidos iguales (mismo sorteo y firma) comparten un solo trabajo (`vuelos`).
   *
   * La red ocupada (TRY_AGAIN_LATER, o txInsufficientFee: una secuencia que ya tiene otra pendiente, o la comisión por
   * debajo de lo que pide la red en ese momento) es `502 {motivo:"red", detalle:"ocupada"}`, que el sitio reintenta con
   * espera. Solo la falta de saldo es `503 fondo`.
   */
  async sortear(sorteo: string, firmaHex: string): Promise<Respuesta> {
    const modo = this.modo();
    const s = this.sorteadora;
    if (!this.cfg.sorteoServidor || !s || modo !== "portero" || !this.cfg.contractId || !this.firmante || !this.cuentaPatrocinadora) {
      return r(503, { motivo: "apagado", ...(modo === "pollar" ? { rige: "pollar" } : {}) });
    }
    const id = leerNumeroDeSorteo(sorteo);
    const firma = leerFirma(firmaHex);
    if (id === null || !firma) return r(400, { motivo: "cuerpo" });
    // Un solo trabajo por pedido igual (dos pestañas, una recarga, un reintento). Desde mirar hasta anotar no hay ningún
    // await: dos pedidos a la vez no abren dos trabajos. Con otra firma es otro trabajo: una firma que no pasa no tumba a la
    // buena.
    const clave = `${id}:${firmaHex.toLowerCase()}`;
    const enCurso = this.vuelos.get(clave);
    if (enCurso) return enCurso;
    const vuelo = this.sortearUnaVez(s, id, firma);
    this.vuelos.set(clave, vuelo);
    const deEste = id.toString();
    const soltar = (): void => {
      if (this.vuelos.get(clave) === vuelo) this.vuelos.delete(clave);
    };
    // Si mandó el sorteo, el trabajo sigue mientras la sorteadora espera que entre: un pedido igual en ese rato recibe el
    // mismo envío. Cualquier otra respuesta, o una falla, lo cierra al responder, y el siguiente pedido igual mira el libro.
    vuelo.then(
      (res) => {
        if (res.estado === 200 && res.cuerpo.status === "PENDING" && s.ocupada()?.sorteo === deEste) void s.libre().then(soltar);
        else soltar();
      },
      soltar,
    );
    return vuelo;
  }

  /** El trabajo de un pedido de sorteo, ya con el cuerpo leído. Lo comparten los pedidos iguales (`vuelos`). */
  private async sortearUnaVez(s: Sorteadora, id: bigint, firma: Uint8Array): Promise<Respuesta> {
    let selloHash: string;
    let organizador: string;
    let sim;
    try {
      const enRed = await s.leer(id);
      if (!enRed || !this.cupos.estaEnElLibro(enRed.organizador)) return r(403, { motivo: "no-es-nuestro" });
      organizador = enRed.organizador;
      const sello = this.cupos.selloDelPortero(enRed.organizador, enRed.huellaLista, enRed.ronda);
      if (!sello) return r(403, { motivo: "no-es-nuestro" });
      selloHash = sello;
      if (enRed.sorteado) return r(200, { ya: true });
      const previo = this.yaPedido(selloHash);
      if (previo) return previo;
      sim = await s.simular(id, firma);
    } catch (e) {
      if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
      throw e;
    }
    if (!sim.ok) {
      if (sim.codigoContrato === CODIGO_YA_SORTEADO) return r(200, { ya: true });
      // La hora del ledger todavía no llegó a la de la ronda: no es una firma mala, se reintenta en unos segundos.
      if (sim.codigoContrato === CODIGO_RONDA_NO_LISTA) return r(409, { motivo: "ronda-no-lista", reintentarEn: this.reloj() + REINTENTAR_RONDA_MS });
      return r(400, { motivo: "fallaria", detalle: sim.motivo === "restaurar" ? "restaurar" : sim.detalle });
    }
    if (!sim.datos) return r(502, { motivo: "red", detalle: "simulacion" });
    if (sim.minResourceFee > this.topeTx()) return r(400, { motivo: "fee-alta", detalle: "simulacion" });
    const datos = sim.datos;
    const estimado = this.techoDeRecursos(sim.minResourceFee) + 2 * this.cfg.inclusionBump;
    // Los topes del organizador se piden antes de tomar la sorteadora: ahí puede haber una espera corta (el plan del equipo).
    const lim = await this.limitesDe(organizador);

    // La admisión, sin await hasta tomar la sorteadora: si está con otro sorteo, mandándolo o esperando que entre, ocupado en
    // el acto, sin reservar, firmar ni mandar nada. Como el repetido ya se miró, ningún `draw` de este sello iba en camino.
    const trabajo = s.tomar(id.toString(), this.reloj(), async (retener) => {
      for (let intento = 0; intento < 2; intento++) {
        const ahora = this.reloj();
        let actual: bigint | null;
        try {
          actual = await s.secuencia();
        } catch (e) {
          if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
          throw e;
        }
        if (actual === null) return r(503, { motivo: "fondo", detalle: "sorteadora" });
        const venceS = Math.floor(ahora / 1000) + Math.min(VENTANA_SORTEO_S, this.cfg.ventanaMaxS);
        const firmada = await s.firmar(s.armar(id, firma, actual, datos, venceS));
        // Otro pedido del mismo sorteo pudo pasar por la cola mientras simulábamos: desde acá hasta reservar, sin await.
        const previo = this.yaPedido(selloHash);
        if (previo) return previo;
        const res = this.cupos.reservar({ hash: firmada.hash, cuenta: organizador, metodo: "draw", estimado, vence: venceS, selloHash }, ahora, lim);
        if (!res.ok) {
          if (res.motivo === "cupo-cuenta") return r(429, { motivo: "cupo-cuenta", que: res.que, liberaEn: res.liberaEn, max: res.max });
          return r(503, { motivo: "fondo" });
        }
        this.cupos.purgar(ahora);
        this.atarAlSello(selloHash, id, firmada.hash, ahora);
        this.alQuedarEnElAire();
        this.registrar("sorteo-servidor", { hash: corto(firmada.hash), estimado, intento: intento + 1 });

        let envuelta: string;
        try {
          envuelta = await this.envolver(firmada.xdr);
        } catch (e) {
          this.cupos.devolver(firmada.hash);
          this.registrar("error-interno", { donde: "envolver-sorteo", hash: corto(firmada.hash), error: String(e).slice(0, 120) });
          return r(500, { motivo: "interno" });
        }
        let envio;
        try {
          envio = await this.red.enviar(envuelta);
        } catch (e) {
          // No se sabe si llegó: queda reservada para la alarma y la secuencia se vuelve a leer. Si llegó, la red tiene una
          // pendiente de la sorteadora: hasta que aparezca, o hasta el plazo, la sorteadora sigue ocupada como después de un
          // envío tomado, y el sorteo siguiente recibe ocupado en vez de mandar con la misma secuencia.
          s.olvidar();
          this.alQuedarEnElAire();
          this.registrar("error-envio", { hash: corto(firmada.hash), error: e instanceof ErrorDeRed ? e.message.slice(0, 80) : "desconocido" });
          retener(s.esperarQueEntre(firmada.hash));
          if (e instanceof ErrorDeRed) return r(502, { motivo: "red", detalle: e.message });
          throw e;
        }
        if (envio.status === "PENDING" || envio.status === "DUPLICATE") {
          s.usada(actual);
          this.cupos.marcarEnviado(firmada.hash);
          this.registrar("enviado", { hash: corto(firmada.hash), red: envio.status });
          // La respuesta sale ya y la sorteadora sigue ocupada hasta que este entre. Lo cierra la alarma, como siempre.
          const hash = firmada.hash;
          retener(
            s.esperarQueEntre(hash).then((estado) => {
              if (estado === "NOT_FOUND") this.registrar("sorteo-sin-confirmar", { hash: corto(hash) });
            }),
          );
          return r(200, { hash, status: envio.status });
        }
        // La red no la tomó: no se pagó nada, el sorteo del mes y lo guardado vuelven.
        this.cupos.devolver(firmada.hash);
        s.olvidar();
        this.registrar("rechazada-por-la-red", { hash: corto(firmada.hash), codigo: envio.codigo ?? envio.status });
        if (envio.codigo && /txBadSeq/.test(envio.codigo)) {
          if (intento === 0) continue;
          return r(502, { motivo: "red", detalle: "secuencia" });
        }
        // La red ocupada no es falta de plata: el sitio la reintenta. Solo un saldo que no alcanza es fondo.
        if (envio.status === "TRY_AGAIN_LATER" || (envio.codigo && /InsufficientFee/.test(envio.codigo))) return r(502, { motivo: "red", detalle: "ocupada" });
        if (envio.codigo && /InsufficientBalance/.test(envio.codigo)) return r(503, { motivo: "fondo", codigo: envio.codigo });
        return r(400, { motivo: "rechazada", codigo: envio.codigo ?? "desconocido" });
      }
      return r(502, { motivo: "red", detalle: "secuencia" });
    });
    if (trabajo) return trabajo;
    const o = s.ocupada();
    this.registrar("sorteo-ocupado", { desdeMs: o ? Math.max(0, this.reloj() - o.desde) : 0 });
    return r(503, { motivo: "ocupado" });
  }

  /**
   * Ata el sello a este sorteo si es el primer `draw` que el portero paga con él (`Cupos.atarSorteo`): así un sello pagado
   * respalda los premios y las altas de quien ganó de un solo sorteo, y no de cada sorteo igual sellado por fuera. Nunca hace
   * fallar al sorteo: si no se pudo, se anota, y ese sorteo queda sin premios ni altas por el portero (el lado seguro).
   */
  private atarAlSello(selloHash: string, sorteo: bigint, draw: string, ahora: number): void {
    const contrato = this.cfg.contractId;
    if (contrato === null) {
      return;
    }
    if (!this.cupos.atarSorteo({ sello: selloHash, contrato, sorteo: String(sorteo), draw }, ahora)) {
      this.registrar("error-interno", { donde: "atar-sorteo", hash: corto(draw) });
    }
  }

  /**
   * Si el `draw` de este sello ya va en camino: el mismo hash, sin mandar otro. Uno que ya cerró (bien o mal) no decide
   * nada: si entró, `get_raffle` o la simulación lo dicen (`{ya:true}`); así un sorteo de otro sello que se quedó con lo
   * guardado para este, antes de prender la regla, no lo frena.
   */
  private yaPedido(selloHash: string): Respuesta | null {
    const d = this.cupos.sorteoDelSello(selloHash);
    return d && (d.estado === "reservado" || d.estado === "enviado") ? r(200, { hash: d.hash, status: "DUPLICATE" }) : null;
  }

  /**
   * ¿La abrió nuestra app? Una cuenta de prueba, una ya vista, o una cuya reserva paga la billetera de fondos de Pollar.
   * En mainnet con las altas prendidas, en cambio, **solo el libro**: una cuenta que el servidor admitió por un cupón, un
   * pago o a mano. Ni una cuenta ya vista ni la reserva del fondo de Pollar alcanzan, y no se recuerda nada.
   */
  private async laAbrioNuestraApp(cuenta: string, ahora: number, leer: (g: string) => Promise<CuentaEnRed | null>): Promise<boolean> {
    if (this.cfg.red === "mainnet" && this.cfg.altas) return this.cupos.estaEnElLibro(cuenta);
    // Mainnet sin altas y sin la lista de billeteras de la app no deja pasar a nadie, tampoco a las que ya estaban
    // anotadas: apagar las altas es un corte.
    if (this.cfg.red === "mainnet" && this.cfg.patrocinadoresApp.size === 0) return false;
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
          this.cerrarConLaRed(f.hash, c);
        } else if (Math.floor(ahora / 1000) > f.vence + MARGEN_VENCIMIENTO_S) {
          this.cupos.devolver(f.hash);
          this.registrar("devuelto", { hash: corto(f.hash), motivo: "vencida-sin-aparecer" });
        }
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) throw e;
        // Sin red: se vuelve a intentar en la próxima vuelta.
      }
    }
    // Los sellos fallidos que no se pudieron probar: se vuelve a preguntar, a lo sumo `INTENTOS_DE_PRUEBA` veces.
    for (const hash of this.cupos.porProbar(ahora - ESPERA_ENTRE_PRUEBAS_MS)) {
      try {
        const c = await this.red.consultar(hash);
        if (c.status === "FAILED") this.devolverSiEntroTarde(hash, c);
        else this.anotarSinProbar(hash);
      } catch (e) {
        if (!(e instanceof ErrorDeRed)) throw e;
        // Sin red también es un intento: no se pregunta para siempre.
        this.anotarSinProbar(hash);
      }
    }
    this.cupos.purgar(ahora);
    const quedan = this.cupos.enElAire();
    const porProbar = this.cupos.cuantosPorProbar();
    this.registrar("alarma", { enElAire: quedan, ...(porProbar ? { porProbar } : {}) });
    return quedan > 0 || porProbar > 0;
  }

  /** Un intento más de probar un sello fallido (`Cupos.anotarSinProbar`). Si fue el último, queda en el registro. */
  private anotarSinProbar(hash: string): void {
    const f = this.cupos.buscar(hash);
    if (!f) return this.cupos.soltarPendiente(hash);
    const n = this.cupos.anotarSinProbar(hash, f.cuenta, this.reloj(), INTENTOS_DE_PRUEBA);
    if (n.agotado) this.registrar("sello-sin-probar", { hash: corto(hash), intentos: n.intentos });
  }

  /**
   * Cierra lo que la red dice que entró (bien o mal) y, si es un sello que el contrato rechazó por la ronda muy cerca,
   * le devuelve a la cuenta lo que gastó (`devolverSiEntroTarde`). Síncrono: lo llaman la alarma, el reenvío del mismo
   * hash y `/cupo`, cada uno con lo que acaba de contestar la red. Devuelve si hubo devolución.
   */
  private cerrarConLaRed(hash: string, c: Consulta): boolean {
    const estado = c.status === "SUCCESS" ? "ok" : "fallo";
    this.cupos.cerrar(hash, estado, c.feeCharged ?? null);
    this.registrar("resultado", { hash: corto(hash), estado, real: c.feeCharged ?? 0 });
    return estado === "fallo" && this.devolverSiEntroTarde(hash, c);
  }

  /**
   * Un sello que entró a un ledger y falló: si lo que guardó la red prueba que el contrato lo rechazó por la ronda muy
   * cerca (`sello-tarde.ts`), la cuenta vuelve a como estaba antes del intento (`Cupos.devolverSelloTardio`), una sola
   * vez y dentro de los dos topes del día (el de la cuenta y el de todo el portero). Nunca por lo que diga la página: la
   * consulta es del portero a su RPC. Queda en el registro (`sorteo-devuelto`, `devolucion-negada` o `sello-fallido` con
   * su motivo) y en `devueltos24h` del estado. Lo que niega un tope queda para devolverlo a mano.
   */
  private devolverSiEntroTarde(hash: string, c: Consulta): boolean {
    const f = this.cupos.buscar(hash);
    if (!f || f.metodo !== "seal" || f.estado !== "fallo" || !this.cfg.contractId) return false;
    const t = selloQueEntroTarde(hash, c, { passphrase: this.cfg.passphrase, contractId: this.cfg.contractId });
    if (!t.ok) {
      this.registrar("sello-fallido", { hash: corto(hash), motivo: t.motivo });
      // Sin los datos para probarlo no se da por perdido: la alarma vuelve a preguntar. Lo demás es definitivo.
      if (t.motivo === "sin-datos") this.anotarSinProbar(hash);
      else this.cupos.soltarPendiente(hash);
      return false;
    }
    const d = this.cupos.devolverSelloTardio(hash, this.reloj(), { ronda: t.ronda, faltaban: t.faltaban, ...TOPES_DE_DEVOLUCION });
    if (d.que === "devuelto") {
      this.registrar("sorteo-devuelto", { hash: corto(hash), motivo: "ronda-cerca", faltaban: t.faltaban, sorteos: d.sorteos });
      // Su derecho había vencido (o estaba por vencer): volvió en uno nuevo, para que se pueda usar de verdad.
      if (d.aNuevo) this.registrar("vencido-al-devolver", { hash: corto(hash), sorteos: d.aNuevo });
    } else if (d.que === "tope" || d.que === "tope-general") {
      this.registrar("devolucion-negada", { hash: corto(hash), motivo: d.que });
      // Queda para devolverlo a mano: en el exporte y en `porDevolver24h` del estado.
      this.cupos.anotarPorDevolver(hash, f.cuenta, this.reloj(), d.que);
    }
    return d.que === "devuelto";
  }

  /**
   * Los sellos de esta cuenta que siguen en el aire (a lo sumo 3, de los últimos 15 minutos): se le pregunta a la red por
   * cada uno y se cierra lo que ya entró, con su devolución si entró tarde. Devuelve cuántos sellos se devolvieron. Sin
   * sellos en el aire no le pregunta nada a nadie.
   *
   * Con freno, porque `/cupo` es abierto: por el mismo sello se pregunta a lo sumo una vez cada `ASENTAR_CADA_MS`, y los
   * pedidos de una cuenta que llegan mientras hay una averiguación en curso esperan esa misma. `forzar` (el sello nuevo
   * que llegó sin sorteos) pregunta igual: es el reintento de la persona, y viene firmado por su cuenta.
   */
  private asentarSellosDe(cuenta: string, forzar = false): Promise<number> {
    if (!forzar) {
      const enCurso = this.asentando.get(cuenta);
      if (enCurso) return enCurso;
    }
    const ahora = this.reloj();
    const enElAire = this.cupos
      .sellosEnElAire(cuenta, ahora - ASENTAR_DESDE_MS, ASENTAR_MAX)
      .filter((f) => forzar || ahora - (this.preguntadoEn.get(f.hash) ?? Number.NEGATIVE_INFINITY) >= ASENTAR_CADA_MS);
    if (!enElAire.length) return Promise.resolve(0);
    // Lo que ya no puede estar en el aire (más viejo que lo que se mira) se olvida: la memoria no crece sin fin.
    for (const [hash, en] of this.preguntadoEn) if (ahora - en > ASENTAR_DESDE_MS) this.preguntadoEn.delete(hash);
    for (const f of enElAire) this.preguntadoEn.set(f.hash, ahora);
    const p = this.averiguarConTope(enElAire);
    if (!forzar) {
      this.asentando.set(cuenta, p);
      const soltar = () => {
        if (this.asentando.get(cuenta) === p) this.asentando.delete(cuenta);
      };
      p.then(soltar, soltar);
    }
    return p;
  }

  /**
   * Le pregunta a la red por estos sellos, uno por uno, y cierra lo que ya entró. Espera a lo sumo `TOPE_ASENTAR_MS`:
   * pasado eso corta la consulta en curso (no queda colgada en segundo plano), no pregunta por los que faltan y se sigue
   * con lo que se sabe. Lo demás lo cierra la alarma. Una red que no contesta no cambia nada. Nunca falla.
   */
  private async averiguarConTope(filas: FilaUso[]): Promise<number> {
    const corte = new AbortController();
    let devueltos = 0;
    const averiguar = async (): Promise<void> => {
      for (const f of filas) {
        if (corte.signal.aborted) return;
        try {
          const c = await this.red.consultar(f.hash, corte.signal);
          if ((c.status === "SUCCESS" || c.status === "FAILED") && this.cerrarConLaRed(f.hash, c)) devueltos++;
        } catch (e) {
          // Sin red se sigue con lo que se sabe. Un error nuestro tampoco tumba la consulta del cupo: queda anotado.
          if (!(e instanceof ErrorDeRed)) this.registrar("error-interno", { donde: "asentar", hash: corto(f.hash), error: String(e).slice(0, 120) });
        }
      }
    };
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const tope = new Promise<void>((listo) => {
      reloj = setTimeout(() => {
        corte.abort();
        listo();
      }, TOPE_ASENTAR_MS);
    });
    try {
      await Promise.race([averiguar(), tope]);
    } finally {
      clearTimeout(reloj);
    }
    return devueltos;
  }

  // ---------- administración ----------

  poner(modo: Modo): void {
    this.cupos.fijarAjuste("modo", modo, this.reloj());
  }

  ajustar(clave: string, valor: number): boolean {
    // El regalo de bienvenida: su interruptor (0 abierto, 1 cerrado) y sus frenos (0 saca el de caliente), sin desplegar.
    if (clave === AJUSTE_BIENVENIDA_CERRADA && valor !== 0 && valor !== 1) return false;
    const deBienvenida = clave === AJUSTE_BIENVENIDA_CERRADA || (Object.values(AJUSTES_BIENVENIDA_TOPE) as string[]).includes(clave);
    if (deBienvenida && !(Number.isInteger(valor) && valor >= 0 && valor <= TECHO_BIENVENIDA_TOPE)) return false;
    // El margen del regalo, en créditos: de 1 a su techo manda; 0 lo saca y vuelve a valer el de la variable.
    const esReserva = clave === AJUSTE_RESERVA_REGALO;
    if (esReserva && !(Number.isInteger(valor) && valor >= 0 && valor <= TECHO_RESERVA_REGALO)) return false;
    // El correo de bienvenida: su freno (0 lo deja salir, 1 lo apaga) y su tope por día (0 vuelve al de por defecto), sin desplegar.
    const deCorreo = clave === AJUSTE_CORREO_CERRADO || clave === AJUSTE_CORREO_DIA;
    const techoCorreo = clave === AJUSTE_CORREO_CERRADO ? 1 : TECHO_CORREO_DIA;
    if (deCorreo && !(Number.isInteger(valor) && valor >= 0 && valor <= techoCorreo)) return false;
    if (!deBienvenida && !esReserva && !deCorreo && !["max_sellos_mes", "tope_general_stroops", "tope_tx_stroops"].includes(clave)) return false;
    if (!Number.isFinite(valor) || valor < 0) return false;
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
export function autoridadDe(c: CuentaEnRed | null): Autoridad | null {
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
