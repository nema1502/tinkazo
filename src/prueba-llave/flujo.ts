import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { canonicalList, listHash } from "../protocol/canonical";
import { randomnessOf } from "../protocol/quicknet";
import { roundTime } from "../protocol/quicknet-hora";
import { select } from "../protocol/select";
import { enviarYConfirmar, type Desenlace, type RespuestaConsulta, type RespuestaEnvio } from "../stellar/envio";
import { leerCobro, retornoDe, type Cobro, type RespuestaCruda } from "./cobro";
import { armarComprobante, enlaceDeComprobante } from "./comprobante";
import { ErrorDeEntrada } from "./error-de-entrada";
import { estadoInicial, type Estado } from "./estados";
import { datosDeLaLista, GANADORES } from "./lista";
import { medidasVacias, type FallaMedida, type Medidas } from "./medidas";
import { motivoDeLaLlave } from "./motivo-llave";
import { revisarNacimiento } from "./nacimiento";
import { ErrorDeGrifo, type Pagador } from "./pagador";
import {
  borrarCreacionPendiente,
  borrarSelloPendiente,
  guardarCreacionPendiente,
  guardarSelloPendiente,
  leerCreacionPendiente,
  leerSelloPendiente,
  type Almacen,
  type SelloPendiente,
} from "./pendiente";
import type { CreacionDeLlave, LlaveGuardada, PuenteKit } from "./puente-tipos";
import { elegirRonda, MINIMO_ANTES_DEL_DESBLOQUEO_S, MINIMO_DESPUES_DEL_DESBLOQUEO_S, quedaTiempo, vencimientoDeLaFirma } from "./ronda";
import { codigoDeContrato, type ResultadoDeSimulacion } from "./rpc";
import {
  armarConOperacion,
  armarCreacion,
  armarLectura,
  armarSorteo,
  conEntradasFirmadas,
  entradasPorFirmar,
  hashDeTransaccion,
  maxTimeDe,
  mismaAutorizacion,
  operacionDeSello,
} from "./transacciones";

/**
 * El recorrido de la prueba: crear la llave, sellar una lista, esperar la ronda y sortear. Todo entra inyectado (el
 * puente del kit, el RPC, el reloj, la ronda y el pagador), así se prueba sin navegador ni red.
 *
 * Reglas que cuida:
 * - Nunca dos sellos. Solo se manda el sobre final, que vive 30 s, y solo se rearma cuando se sabe que el anterior no
 *   entró ni puede entrar (venció, la red lo rechazó o falló adentro). El sobre de la simulación de grabar no se manda nunca.
 * - Un desbloqueo lento no deja el sobre vencido: el sobre final se arma DESPUÉS del desbloqueo.
 * - El sorteo no pide la firma de nadie: si la página se recarga, se retoma con otro pagador.
 */

/** Lo que el flujo necesita del RPC: lo cumple `RpcDePrueba` y lo imita una prueba. */
export interface RpcDelFlujo {
  secuencia(cuenta: string): Promise<string | null>;
  simular(txXdr: string): Promise<ResultadoDeSimulacion>;
  ensamblar(txXdr: string, simulacion: unknown): string;
  enviar(txB64: string): Promise<RespuestaEnvio>;
  consultar(hash: string, decodificar?: (c: RespuestaCruda) => unknown): Promise<RespuestaConsulta>;
  consultarCruda(hash: string): Promise<RespuestaCruda>;
}

export interface EntornoDelFlujo {
  puente: PuenteKit;
  rpc: RpcDelFlujo;
  crearPagador: () => Promise<Pagador>;
  /** La hora en segundos. */
  ahoraS: () => number;
  ahoraMs: () => number;
  dormir: (ms: number) => Promise<void>;
  /** La firma de una ronda de drand, comprimida y en hexadecimal. */
  traerRonda: (ronda: number) => Promise<string>;
  /** De la firma comprimida a la de 96 bytes que acepta el contrato. */
  aFirma96: (firma48Hex: string) => Promise<Uint8Array>;
  hayFoco: () => boolean;
  almacen: Almacen | null;
  /** El origen de la página, para armar el enlace del comprobante. */
  origen: string;
  /** Solo para pruebas: reemplazan la revisión y el armado de la creación, que necesitan el XDR de un kit de verdad. */
  revisarNacimiento?: typeof revisarNacimiento;
  armarCreacion?: typeof armarCreacion;
  /** Solo para pruebas: con `false`, después del sello no se espera ni se hace el sorteo solo. */
  esperarSorteo?: boolean;
}

export interface DatosDeEstado {
  ganador?: string;
  /** La persona no usó la llave. */
  cancelada?: boolean;
  /** El código de la última falla, para el plegado. */
  codigo?: string;
}

export interface OpcionesDeInicio {
  host: string;
  hayPasskeys: boolean;
  enApp: boolean;
  conBloqueo: boolean | null;
  punteroGrueso: boolean;
}

type Escucha = (estado: Estado, datos: DatosDeEstado) => void;

/** Cuántas veces se intenta conectar una cuenta recién creada, y cada cuánto: la red tarda en mostrar el nacimiento. */
const INTENTOS_DE_CONEXION = 5;
const ESPERA_DE_CONEXION_MS = 3_000;

/** Lo que se espera el sorteo después de que la ronda nace, en segundos. */
const TOPE_DEL_SORTEO_S = 120;

const valorDeBase64 = (b64: string): unknown => scValToNative(xdr.ScVal.fromXDR(b64, "base64"));

/** La pantalla que corresponde a cada motivo por el que no se pudo entrar. */
function pantallaDeEntrada(motivo: string): Estado {
  switch (motivo) {
    case "sin-cuenta":
      return "sin-cuenta";
    case "vencida":
      return "vencida";
    case "sin-nacimiento":
    case "ambigua":
    case "firmantes":
    case "rechazada":
      return "no-se-comprobo";
    default:
      return "no-aparece";
  }
}

export class Flujo {
  estado: Estado = "cargando";
  datos: DatosDeEstado = {};
  medidas: Medidas;
  enlace = "";
  /** El motivo de la última falla, en una palabra, para el plegado y la ventana. */
  error = "";
  /** Si la página tenía el foco la última vez que se pidió el desbloqueo. */
  conFoco = true;

  private readonly e: EntornoDelFlujo;
  private escuchas: Escucha[] = [];
  private pagadorP: Promise<Pagador> | null = null;
  private conexion: { credentialId: string; contractId: string } | null = null;
  private credencialPendiente: string | null = null;
  private sello: SelloPendiente | null = null;
  private desbloqueos = 0;
  private sorteando = false;
  private generacion = 0;

  constructor(entorno: EntornoDelFlujo) {
    this.e = entorno;
    this.medidas = medidasVacias(new Date(entorno.ahoraMs()));
  }

  onEstado(fn: Escucha): void {
    this.escuchas.push(fn);
  }

  /** Cambia de pantalla. Cada cambio nuevo deja sin efecto lo que quedó esperando de uno anterior. */
  private ir(estado: Estado, datos: DatosDeEstado = {}): void {
    this.estado = estado;
    this.datos = datos;
    for (const fn of this.escuchas) fn(estado, datos);
  }

  private falla(paso: string, motivo: string, detalle?: string): void {
    const f: FallaMedida = { paso, motivo, conFoco: this.conFoco, ...(detalle ? { detalle } : {}) };
    this.medidas.fallas.push(f);
    this.error = detalle ? `${motivo}:${detalle}` : motivo;
  }

  /** La pantalla con que abre la página, mirando el aparato y lo que quedó guardado. */
  async iniciar(o: OpcionesDeInicio): Promise<void> {
    const pendiente = leerSelloPendiente(this.e.almacen);
    let llaves: LlaveGuardada[] = [];
    try {
      llaves = await this.e.puente.llavesGuardadas();
    } catch {
      llaves = [];
    }
    const creacion = leerCreacionPendiente(this.e.almacen);
    let estado = estadoInicial({
      host: o.host,
      hayPasskeys: o.hayPasskeys,
      enApp: o.enApp,
      conBloqueo: o.conBloqueo,
      punteroGrueso: o.punteroGrueso,
      hayLlaveLocal: llaves.some((l) => l.estado === "deployed"),
      selloPendiente: pendiente !== null,
    });
    if (estado === "esperando" && pendiente) {
      this.sello = pendiente;
      await this.retomarSello();
      return;
    }
    if ((estado === "inicio" || estado === "ya-hay-llave") && (creacion || llaves.some((l) => l.estado !== "deployed"))) {
      this.credencialPendiente = creacion?.credentialId ?? llaves.find((l) => l.estado !== "deployed")?.credentialId ?? null;
      if (this.credencialPendiente) estado = "cuenta-sin-armar";
    }
    this.ir(estado);
  }

  /** Vuelve a esperar el sorteo de un sello que quedó guardado. */
  private async retomarSello(): Promise<void> {
    const s = this.sello;
    if (!s) return;
    this.enlace = await this.enlaceSinFirma(s);
    this.ir("esperando");
    this.seguirConElSorteo();
  }

  /** Para quien recarga la página con un sello hecho. */
  async retomar(): Promise<void> {
    const s = leerSelloPendiente(this.e.almacen);
    if (!s) return;
    this.sello = s;
    await this.retomarSello();
  }

  /** La pestaña volvió a estar visible: si la ronda ya pasó, el sorteo sale enseguida. */
  alVolver(): void {
    if (this.estado !== "esperando" && this.estado !== "sorteo-trabado") return;
    const s = this.sello;
    if (!s || this.e.ahoraS() < roundTime(s.ronda)) return;
    void this.sortear();
  }

  /** Se acabó el tiempo de una pantalla de espera: si todavía es la misma, pasa a la que corresponde. */
  alTope(estado: Estado): void {
    if (this.estado !== estado) return;
    this.generacion++;
    switch (estado) {
      case "cargando":
        this.falla("cargar", "tiempo");
        this.ir("falla", { codigo: this.error });
        break;
      case "mira-crear":
        this.falla("crear", "cancelada");
        this.ir("inicio", { cancelada: true });
        break;
      case "mira-sellar":
        this.falla("sellar", "cancelada");
        this.ir("cuenta-lista", { cancelada: true });
        break;
      case "entrando":
      case "buscando":
        this.falla("entrar", "tiempo");
        this.ir("no-aparece", { codigo: this.error });
        break;
      case "armando":
      case "sellando":
        this.falla(estado === "armando" ? "crear" : "sellar", "tiempo");
        this.ir("lento", { codigo: this.error });
        break;
      default:
        break;
    }
  }

  private vigente(g: number): boolean {
    return g === this.generacion;
  }

  /** Un solo pagador por carga de la página. Si falla, la próxima vez se vuelve a intentar. */
  private obtenerPagador(): Promise<Pagador> {
    if (!this.pagadorP) {
      const inicio = this.e.ahoraMs();
      const p = this.e.crearPagador().then((pagador) => {
        this.medidas.pagador = { segundosGrifo: Math.round((this.e.ahoraMs() - inicio) / 1000), intentos: pagador.intentosDeGrifo };
        return pagador;
      });
      p.catch(() => {
        if (this.pagadorP === p) this.pagadorP = null;
      });
      this.pagadorP = p;
    }
    return this.pagadorP;
  }

  /** Una falla del grifo: se anotan los códigos de cada intento. */
  private falloDeGrifo(paso: string, e: unknown): void {
    if (e instanceof ErrorDeGrifo) {
      this.medidas.pagador = { segundosGrifo: 0, intentos: e.intentos };
      this.falla(paso, e.limitado ? "grifo-limitado" : "grifo-caido", e.intentos.map((i) => i.http ?? "corte").join(","));
    } else {
      this.falla(paso, "grifo", e instanceof Error ? e.message : "desconocido");
    }
  }

  private confirmar(firmada: string, hash: string, decodificar?: (c: RespuestaCruda) => unknown): Promise<Desenlace> {
    return enviarYConfirmar({
      enviar: () => this.e.rpc.enviar(firmada),
      consultar: () => this.e.rpc.consultar(hash, decodificar),
      venceEn: maxTimeDe(firmada),
      topeTotalMs: 90_000,
      ahora: this.e.ahoraMs,
      dormir: this.e.dormir,
    });
  }

  /* ------------------------------------------------------------------ crear */

  /** Crear la llave: pide el desbloqueo y arma la cuenta. */
  async crear(): Promise<void> {
    const g = ++this.generacion;
    this.ir("mira-crear");
    // El pagador se arma mientras la persona se desbloquea. Si falla, se ve recién cuando termina el desbloqueo.
    const pagadorP = this.obtenerPagador();
    pagadorP.catch(() => undefined);
    this.conFoco = this.e.hayFoco();
    let c: CreacionDeLlave;
    try {
      c = await this.e.puente.crearLlave();
    } catch (e) {
      if (!this.vigente(g)) return;
      const motivo = motivoDeLaLlave(e, this.conFoco);
      this.falla("crear", motivo);
      if (motivo === "cancelada" || motivo === "sin-foco") this.ir("inicio", { cancelada: true });
      else this.ir("falla", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    this.credencialPendiente = c.credentialId;
    guardarCreacionPendiente({ credentialId: c.credentialId, hashCreacion: "" }, this.e.almacen);
    await this.armarYMandarCreacion(g, c, pagadorP);
  }

  /** La llave ya existe y la cuenta todavía no: se vuelve a armar sin pedir otro desbloqueo. */
  async rehacerCuenta(): Promise<void> {
    const g = ++this.generacion;
    const id = this.credencialPendiente ?? leerCreacionPendiente(this.e.almacen)?.credentialId ?? null;
    if (!id) {
      this.ir("inicio");
      return;
    }
    this.ir("armando");
    // Si ya había una creación mandada, primero se mira si entró.
    const previa = leerCreacionPendiente(this.e.almacen);
    if (previa?.hashCreacion) {
      try {
        const cruda = await this.e.rpc.consultarCruda(previa.hashCreacion);
        if (cruda.status === "SUCCESS") {
          const llaves = await this.e.puente.llavesGuardadas();
          const k = llaves.find((l) => l.credentialId === id);
          if (k) {
            await this.cerrarCreacion(g, id, k.contractId, previa.hashCreacion, cruda, this.e.ahoraMs());
            return;
          }
        }
      } catch {
        /* si no se puede mirar, se rehace */
      }
    }
    try {
      const r = await this.e.puente.rehacerCreacion(id);
      await this.armarYMandarCreacion(g, { credentialId: id, ...r }, this.obtenerPagador());
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("crear", "rehacer", e instanceof Error ? e.message : "desconocido");
      this.ir("no-se-armo", { codigo: this.error });
    }
  }

  private async armarYMandarCreacion(g: number, c: CreacionDeLlave, pagadorP: Promise<Pagador>): Promise<void> {
    const inicio = this.e.ahoraMs();
    this.ir("armando");
    const nac = (this.e.revisarNacimiento ?? revisarNacimiento)(c.funcB64, c.authB64);
    if (!nac.ok) {
      this.falla("crear", "nacimiento", nac.motivo);
      this.ir("no-se-armo", { codigo: this.error });
      return;
    }
    let pagador: Pagador;
    try {
      pagador = await pagadorP;
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falloDeGrifo("crear", e);
      this.ir("cuenta-sin-armar", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    try {
      const secuencia = await this.e.rpc.secuencia(pagador.publica);
      if (secuencia === null) throw new Error("pagador-sin-cuenta");
      const armada = (this.e.armarCreacion ?? armarCreacion)({ origen: pagador.publica, secuencia, funcB64: c.funcB64, authB64: c.authB64 });
      const sim = await this.e.rpc.simular(armada);
      if (!sim.ok) {
        this.falla("crear", "simulacion", sim.error ?? "sin-detalle");
        this.ir("no-se-armo", { codigo: this.error });
        return;
      }
      const firmada = pagador.firmar(this.e.rpc.ensamblar(armada, sim.simulacion));
      const hash = hashDeTransaccion(firmada);
      guardarCreacionPendiente({ credentialId: c.credentialId, hashCreacion: hash }, this.e.almacen);
      const r = await this.confirmar(firmada, hash);
      if (!this.vigente(g)) return;
      if (r.estado === "entro") {
        const cruda = await this.e.rpc.consultarCruda(hash);
        await this.cerrarCreacion(g, c.credentialId, c.contractId, hash, cruda, inicio);
        return;
      }
      if (r.estado === "sin-respuesta") {
        this.falla("crear", "sin-respuesta");
        this.ir("lento", { codigo: this.error });
        return;
      }
      this.falla("crear", r.estado, r.estado === "rechazada" ? r.codigo : undefined);
      this.ir("no-se-armo", { codigo: this.error });
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("crear", "error", e instanceof Error ? e.message : "desconocido");
      this.ir("no-se-armo", { codigo: this.error });
    }
  }

  /** La creación entró: se anota en el aparato, se conecta la cuenta y se mide. */
  private async cerrarCreacion(g: number, credentialId: string, contractId: string, hash: string, cruda: RespuestaCruda, inicioMs: number): Promise<void> {
    const cobro = leerCobro(cruda);
    await this.e.puente.anotarCreacion(credentialId, hash, cobro.ledger);
    let ultimo: unknown = null;
    for (let i = 0; i < INTENTOS_DE_CONEXION; i++) {
      try {
        this.conexion = await this.e.puente.conectar(credentialId, contractId);
        ultimo = null;
        break;
      } catch (e) {
        ultimo = e;
        await this.e.dormir(ESPERA_DE_CONEXION_MS);
      }
    }
    if (!this.vigente(g)) return;
    if (!this.conexion) {
      this.falla("crear", "conectar", ultimo instanceof Error ? ultimo.message : "desconocido");
      this.ir("cuenta-sin-armar", { codigo: this.error });
      return;
    }
    borrarCreacionPendiente(this.e.almacen);
    this.medidas.cuenta = { contractId, hash, ledger: cobro.ledger, segundos: Math.round((this.e.ahoraMs() - inicioMs) / 1000), cobro };
    this.ir("cuenta-lista");
  }

  /** Se tocó Mirar de nuevo en la pantalla de que esto tarda: se pregunta otra vez por la creación. */
  async mirar(): Promise<void> {
    const previa = leerCreacionPendiente(this.e.almacen);
    if (previa?.hashCreacion) {
      await this.rehacerCuenta();
      return;
    }
    if (this.sello) {
      this.ir("esperando");
      this.seguirConElSorteo();
      return;
    }
    this.ir("inicio");
  }

  /* ------------------------------------------------------------------ entrar */

  /** Ya hay una llave en este aparato: se usa sin otro desbloqueo. */
  async usarLlave(): Promise<void> {
    const g = ++this.generacion;
    try {
      const sesion = await this.e.puente.volver();
      if (sesion) {
        this.conexion = sesion;
        if (this.vigente(g)) this.ir("cuenta-lista");
        return;
      }
      const k = (await this.e.puente.llavesGuardadas()).find((l) => l.estado === "deployed");
      if (!k) {
        this.ir("inicio");
        return;
      }
      this.conexion = await this.e.puente.conectar(k.credentialId, k.contractId);
      if (this.vigente(g)) this.ir("cuenta-lista");
    } catch (e) {
      if (e instanceof ErrorDeEntrada) {
        this.irPorErrorDeEntrada("usar", e);
        return;
      }
      this.falla("usar", "error", e instanceof Error ? e.message : "desconocido");
      this.ir("no-aparece", { codigo: this.error });
    }
  }

  /** Una cuenta que no se pudo encontrar, o que se encontró y no se pudo dar por buena: cada motivo tiene su pantalla. */
  private irPorErrorDeEntrada(paso: string, e: ErrorDeEntrada, segundosBuscando = 0): void {
    this.falla(paso, e.motivo, e.detalle);
    this.medidas.entrada = { fuente: "ninguna", ledgerDeNacimiento: null, segundosBuscando, desbloqueos: null, motivo: e.motivo };
    this.ir(pantallaDeEntrada(e.motivo), { codigo: this.error });
  }

  /** Entrar con una llave que no está en este aparato: un desbloqueo, la búsqueda de la cuenta en la red y la cuenta lista. */
  async entrar(): Promise<void> {
    const g = ++this.generacion;
    this.ir("entrando");
    this.conFoco = this.e.hayFoco();
    const busqueda: { desdeMs: number | null } = { desdeMs: null };
    try {
      const c = await this.e.puente.entrarConLlave({
        alTerminarElDesbloqueo: () => {
          if (!this.vigente(g)) return;
          busqueda.desdeMs = this.e.ahoraMs();
          this.ir("buscando");
        },
      });
      if (!this.vigente(g)) return;
      this.conexion = { credentialId: c.credentialId, contractId: c.contractId };
      if (c.entrada) this.medidas.entrada = { ...c.entrada, motivo: null };
      this.ir("cuenta-lista");
    } catch (e) {
      if (!this.vigente(g)) return;
      const segundos = busqueda.desdeMs === null ? 0 : Math.round((this.e.ahoraMs() - busqueda.desdeMs) / 100) / 10;
      if (e instanceof ErrorDeEntrada) {
        this.irPorErrorDeEntrada("entrar", e, segundos);
        return;
      }
      const motivo = motivoDeLaLlave(e, this.conFoco);
      if (motivo === "cancelada" || motivo === "sin-foco") {
        this.falla("entrar", motivo);
        this.ir("inicio", { cancelada: true });
        return;
      }
      // Cualquier otra falla del kit al entrar es que no se pudo leer la red ahora: no hay conexión y se puede probar de nuevo.
      this.falla("entrar", "red", e instanceof Error ? e.message : "desconocido");
      this.medidas.entrada = { fuente: "ninguna", ledgerDeNacimiento: null, segundosBuscando: segundos, desbloqueos: null, motivo: "red" };
      this.ir("no-aparece", { codigo: this.error });
    }
  }

  /** La dirección de la cuenta con la que se entró, para el recorrido automático. */
  get contractId(): string {
    return this.conexion?.contractId ?? "";
  }

  /** Otro sorteo con la misma llave. */
  nuevoSorteo(): void {
    this.sello = null;
    this.enlace = "";
    this.ir(this.conexion ? "cuenta-lista" : "inicio");
  }

  /* ------------------------------------------------------------------ sellar */

  /** Sellar la lista de ejemplo: la llave aprueba la entrada de `seal` y la cuenta descartable paga. */
  async sellar(): Promise<void> {
    const g = ++this.generacion;
    const conexion = this.conexion;
    if (!conexion) {
      this.ir("inicio");
      return;
    }
    const inicio = this.e.ahoraMs();
    this.desbloqueos = 0;
    this.ir("sellando");
    let pagador: Pagador;
    try {
      pagador = await this.obtenerPagador();
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falloDeGrifo("sellar", e);
      this.ir("sin-fondos", { codigo: this.error });
      return;
    }
    const lista = datosDeLaLista();
    let vueltas = 0;
    const otraVez = (): boolean => vueltas++ < 1;
    try {
      for (;;) {
        if (!this.vigente(g)) return;
        const ronda = elegirRonda(this.e.ahoraS());
        const operacion = operacionDeSello({ organizador: conexion.contractId, huella: lista.huella, cantidad: lista.cantidad, ganadores: GANADORES, ronda });

        // 1. Se simula en modo de grabar: da la entrada que hay que firmar. Este sobre nunca se manda.
        const secuencia = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia === null) throw new Error("pagador-sin-cuenta");
        const grabar = armarConOperacion({ origen: pagador.publica, secuencia, operacion });
        const sim = await this.e.rpc.simular(grabar);
        if (!sim.ok) {
          if (codigoDeContrato(sim.error) === 5 && otraVez()) continue;
          this.falla("sellar", "simulacion", sim.error ?? "sin-detalle");
          this.ir("no-se-sello", { codigo: this.error });
          return;
        }
        const entradas = entradasPorFirmar(sim.authB64, conexion.contractId);
        if (!quedaTiempo(ronda, this.e.ahoraS(), MINIMO_ANTES_DEL_DESBLOQUEO_S)) {
          if (otraVez()) continue;
          this.falla("sellar", "sin-tiempo");
          this.ir("no-se-sello", { codigo: this.error });
          return;
        }

        // 2. La llave aprueba. Un desbloqueo por entrada: con la cuenta sola es uno.
        this.ir("mira-sellar");
        this.conFoco = this.e.hayFoco();
        const vence = vencimientoDeLaFirma(sim.latestLedger);
        const firmadas: string[] = [];
        try {
          for (const entrada of entradas) firmadas.push(await this.e.puente.firmarEntrada(entrada, vence));
          this.desbloqueos++;
        } catch (e) {
          if (!this.vigente(g)) return;
          const motivo = motivoDeLaLlave(e, this.conFoco);
          this.falla("sellar", motivo, motivo === "otro" && e instanceof Error ? e.message : undefined);
          if (motivo === "cancelada" || motivo === "sin-foco") this.ir("cuenta-lista", { cancelada: true });
          else this.ir("no-se-sello", { codigo: this.error });
          return;
        }
        if (!this.vigente(g)) return;
        this.ir("sellando");
        if (!quedaTiempo(ronda, this.e.ahoraS(), MINIMO_DESPUES_DEL_DESBLOQUEO_S)) {
          if (otraVez()) continue;
          this.falla("sellar", "sin-tiempo-tras-el-desbloqueo");
          this.ir("no-se-sello", { codigo: this.error });
          return;
        }

        // 3. El sobre final se arma ahora, con su vida de 30 s y la secuencia leída de nuevo. Se simula exigiendo la firma.
        const secuencia2 = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia2 === null) throw new Error("pagador-sin-cuenta");
        const final = armarConOperacion({ origen: pagador.publica, secuencia: secuencia2, operacion: conEntradasFirmadas(operacion, firmadas) });
        const sim2 = await this.e.rpc.simular(final);
        if (!sim2.ok) {
          if (codigoDeContrato(sim2.error) === 5 && otraVez()) continue;
          this.falla("sellar", "simulacion-con-firma", sim2.error ?? "sin-detalle");
          this.ir("no-se-sello", { codigo: this.error });
          return;
        }
        const ensamblada = this.e.rpc.ensamblar(final, sim2.simulacion);
        if (!mismaAutorizacion(ensamblada, firmadas)) {
          this.falla("sellar", "autorizacion-cambiada");
          this.ir("no-se-sello", { codigo: this.error });
          return;
        }
        const firmada = pagador.firmar(ensamblada);
        const hash = hashDeTransaccion(firmada);
        const r = await this.confirmar(firmada, hash, retornoDe);
        if (!this.vigente(g)) return;
        if (r.estado === "entro") {
          const cruda = await this.e.rpc.consultarCruda(hash);
          const id = String(r.valor ?? retornoDe(cruda) ?? "");
          if (!/^\d+$/.test(id)) {
            this.falla("sellar", "sin-numero");
            this.ir("no-se-sello", { codigo: this.error });
            return;
          }
          await this.cerrarSello({ id, ronda, hash, cruda, inicio, conexion });
          return;
        }
        if (r.estado === "sin-respuesta") {
          this.falla("sellar", "sin-respuesta");
          this.ir("lento", { codigo: this.error });
          return;
        }
        // Entró y falló, la red lo rechazó o venció: no entró ni va a entrar, y se puede rearmar una vez.
        if (r.estado === "vencida" && otraVez()) continue;
        this.falla("sellar", r.estado, r.estado === "rechazada" ? r.codigo : undefined);
        this.ir("no-se-sello", { codigo: this.error });
        return;
      }
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("sellar", "error", e instanceof Error ? e.message : "desconocido");
      this.ir("no-se-sello", { codigo: this.error });
    }
  }

  private async cerrarSello(o: { id: string; ronda: number; hash: string; cruda: RespuestaCruda; inicio: number; conexion: { credentialId: string; contractId: string } }): Promise<void> {
    const cobro = leerCobro(o.cruda);
    const lista = datosDeLaLista();
    this.sello = { id: o.id, ronda: o.ronda, nombres: lista.nombres, hashSello: o.hash, selladoEn: this.e.ahoraS(), credentialId: o.conexion.credentialId };
    guardarSelloPendiente(this.sello, this.e.almacen);
    this.medidas.sello = { id: o.id, ronda: o.ronda, hash: o.hash, segundos: Math.round((this.e.ahoraMs() - o.inicio) / 1000), desbloqueos: this.desbloqueos, cobro };
    this.enlace = await this.enlaceSinFirma(this.sello);
    this.ir("esperando");
    this.seguirConElSorteo();
  }

  private enlaceSinFirma(s: SelloPendiente): Promise<string> {
    return enlaceDeComprobante(armarComprobante({ nombres: s.nombres, ronda: s.ronda, id: BigInt(s.id), hashSello: s.hashSello, selladoEn: s.selladoEn }), this.e.origen);
  }

  /* ------------------------------------------------------------------ sortear */

  private seguirConElSorteo(): void {
    if (this.e.esperarSorteo !== false) void this.esperarYSortear();
  }

  private async esperarYSortear(): Promise<void> {
    const s = this.sello;
    if (!s) return;
    const g = this.generacion;
    while (this.e.ahoraS() < roundTime(s.ronda)) {
      await this.e.dormir(1_000);
      if (!this.vigente(g) || this.estado !== "esperando") return;
    }
    await this.sortear();
  }

  /** Sortear: el contrato verifica la firma de la ronda. No pide la autorización de nadie. */
  async sortear(): Promise<void> {
    const s = this.sello;
    if (!s || this.sorteando) return;
    this.sorteando = true;
    const limite = roundTime(s.ronda) + TOPE_DEL_SORTEO_S;
    const trabado = (motivo: string, detalle?: string): void => {
      this.falla("sortear", motivo, detalle);
      this.ir("sorteo-trabado", { codigo: this.error });
    };
    try {
      let firma48: string;
      try {
        firma48 = await this.e.traerRonda(s.ronda);
      } catch (e) {
        trabado("ronda", e instanceof Error ? e.message : "desconocido");
        return;
      }
      const firma96 = await this.e.aFirma96(firma48);
      let pagador: Pagador;
      try {
        pagador = await this.obtenerPagador();
      } catch (e) {
        this.falloDeGrifo("sortear", e);
        this.ir("sin-fondos", { codigo: this.error });
        return;
      }
      for (;;) {
        const secuencia = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia === null) throw new Error("pagador-sin-cuenta");
        const tx = armarSorteo({ origen: pagador.publica, secuencia, id: BigInt(s.id), firma96 });
        const sim = await this.e.rpc.simular(tx);
        if (!sim.ok) {
          const c = codigoDeContrato(sim.error);
          if (c === 2) {
            await this.leerSorteoHecho(s, firma48);
            return;
          }
          if (c === 7 && this.e.ahoraS() < limite) {
            await this.e.dormir(3_000);
            continue;
          }
          trabado("simulacion", sim.error ?? "sin-detalle");
          return;
        }
        const firmada = pagador.firmar(this.e.rpc.ensamblar(tx, sim.simulacion));
        const hash = hashDeTransaccion(firmada);
        const r = await this.confirmar(firmada, hash, retornoDe);
        if (r.estado === "entro") {
          const cruda = await this.e.rpc.consultarCruda(hash);
          await this.cerrarSorteo({ s, firma48, hash, cruda, registro: r.valor ?? retornoDe(cruda) });
          return;
        }
        if (this.e.ahoraS() >= limite) {
          trabado(r.estado, r.estado === "rechazada" ? r.codigo : undefined);
          return;
        }
        // Una transacción que no entró ni puede entrar se rearma. Una que no se sabe se vuelve a mirar con la misma.
        await this.e.dormir(2_000);
      }
    } catch (e) {
      trabado("error", e instanceof Error ? e.message : "desconocido");
    } finally {
      this.sorteando = false;
    }
  }

  /** `draw` contestó que ya salió: se lee el registro con `get_draw` y se sigue como si lo hubiera hecho esta página. */
  private async leerSorteoHecho(s: SelloPendiente, firma48: string): Promise<void> {
    const pagador = await this.obtenerPagador();
    const secuencia = await this.e.rpc.secuencia(pagador.publica);
    if (secuencia === null) throw new Error("pagador-sin-cuenta");
    const sim = await this.e.rpc.simular(armarLectura({ origen: pagador.publica, secuencia, id: BigInt(s.id) }));
    if (!sim.ok || !sim.retornoB64) throw new Error("sin-registro");
    await this.cerrarSorteo({ s, firma48, hash: "", cruda: null, registro: valorDeBase64(sim.retornoB64) });
  }

  private async cerrarSorteo(o: { s: SelloPendiente; firma48: string; hash: string; cruda: RespuestaCruda | null; registro: unknown }): Promise<void> {
    const reg = (typeof o.registro === "object" && o.registro !== null ? o.registro : {}) as { winners?: unknown };
    const indices = Array.isArray(reg.winners) ? reg.winners.map((w) => Number(w)) : [];
    if (indices.length === 0) throw new Error("sin-ganadores");
    const nombres = o.s.nombres;
    const local = select(randomnessOf(o.firma48), listHash(canonicalList(nombres.join("\n"))), nombres.length, GANADORES);
    const ganadores = indices.map((i) => nombres[i] ?? "");
    const coincide = indices.length === local.length && indices.every((v, i) => v === local[i]);
    const cobro: Cobro | null = o.cruda ? leerCobro(o.cruda) : null;
    if (cobro) {
      this.medidas.sorteo = { ganadores, coincide, hash: o.hash, segundosDesdeLaRonda: this.e.ahoraS() - roundTime(o.s.ronda), cobro };
    }
    this.enlace = await enlaceDeComprobante(
      armarComprobante({ nombres, ronda: o.s.ronda, id: BigInt(o.s.id), firma48Hex: o.firma48, hashSello: o.s.hashSello, ...(o.hash ? { hashSorteo: o.hash } : {}), selladoEn: o.s.selladoEn }),
      this.e.origen,
    );
    borrarSelloPendiente(this.e.almacen);
    this.ir("listo", { ganador: ganadores[0] ?? "" });
  }

  /* ------------------------------------------------------------------ reintentos */

  /** El botón de volver a probar de cada pantalla de falla: qué se repite depende de dónde se cayó. */
  async reintentar(): Promise<void> {
    switch (this.estado) {
      case "sin-fondos":
        if (this.sello) {
          this.ir("esperando");
          await this.sortear();
        } else if (this.conexion) await this.sellar();
        else await this.crear();
        break;
      case "no-se-sello":
        await this.sellar();
        break;
      case "sorteo-trabado":
        this.ir("esperando");
        await this.sortear();
        break;
      case "no-aparece":
      case "sin-cuenta":
        await this.entrar();
        break;
      case "no-se-armo":
      case "cuenta-sin-armar":
        await this.rehacerCuenta();
        break;
      default:
        this.ir(this.conexion ? "cuenta-lista" : "inicio");
    }
  }

  /** Empezar de nuevo desde la pantalla de falla. */
  empezar(): void {
    this.generacion++;
    this.sello = null;
    this.error = "";
    this.ir(this.conexion ? "cuenta-lista" : "inicio");
  }
}
