import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { canonicalList, listHash } from "../protocol/canonical";
import { randomnessOf } from "../protocol/quicknet";
import { roundTime } from "../protocol/quicknet-hora";
import { select } from "../protocol/select";
import { enviarYConfirmar, type Desenlace, type RespuestaConsulta, type RespuestaEnvio } from "../stellar/envio";
import { leerCobro, retornoDe, type Cobro, type RespuestaCruda } from "./cobro";
import { armarComprobante, enlaceDeComprobante } from "./comprobante";
import { armarCuentaQuePideNota, destinoDeLaPagina, destinoDelEnlace, llaveDeDestinoNueva, type Destino, type LlaveDeDestino, type OpcionesDePremio } from "./destino";
import { ErrorDeEntrada } from "./error-de-entrada";
import { estadoInicial, type Estado } from "./estados";
import { notaDelEnvio, transferenciaDelEvento, type NotaDelEnvio } from "./evento";
import { datosDeLaLista, GANADORES } from "./lista";
import { medidasVacias, type FallaMedida, type Medidas, type PasoDeEnvio } from "./medidas";
import { motivoDeLaLlave } from "./motivo-llave";
import { revisarNacimiento } from "./nacimiento";
import { ErrorDeGrifo, type Pagador } from "./pagador";
import { MONTO_DEL_PREMIO, TOPE_DE_RECURSOS_STROOPS } from "./premio";
import {
  anotarRegistroDePremio,
  avanzarRegistro,
  borrarCreacionPendiente,
  borrarEnvioPendiente,
  borrarPremioPendiente,
  borrarSelloPendiente,
  guardarCreacionPendiente,
  guardarEnvioPendiente,
  guardarPremioPendiente,
  guardarSelloPendiente,
  leerCreacionPendiente,
  leerEnvioPendiente,
  leerPremioPendiente,
  leerRegistroDePremio,
  leerSelloPendiente,
  type Almacen,
  type EnvioPendiente,
  type PremioPendiente,
  type RegistroDePremio,
  type SelloPendiente,
} from "./pendiente";
import type { CreacionDeLlave, LlaveGuardada, PuenteKit } from "./puente-tipos";
import { RED_DE_PRUEBA } from "./red";
import { elegirRonda, MINIMO_ANTES_DEL_DESBLOQUEO_S, MINIMO_DESPUES_DEL_DESBLOQUEO_S, quedaTiempo, vencimientoDeLaFirma } from "./ronda";
import { codigoDeContrato, type ResultadoDeSimulacion, type SaldoLeido } from "./rpc";
import {
  armarConOperacion,
  armarCreacion,
  armarLectura,
  armarSorteo,
  conEntradasFirmadas,
  credencialDe,
  entradasPorFirmar,
  hashDeTransaccion,
  maxTimeDe,
  mismaAutorizacion,
  mismaOperacion,
  operacionDeSello,
  operacionDeTransferencia,
  raizDeLaEntrada,
  recursoDeclarado,
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
  /** Las monedas de una cuenta de contrato. */
  saldoDeContrato(contrato: string): Promise<SaldoLeido>;
  /** Las monedas de una cuenta G, o `null` si todavía no existe. */
  saldoDeCuenta(cuenta: string): Promise<bigint | null>;
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
  /** Presente solo en el modo premio de la página: sin él, todo es como siempre. */
  premio?: OpcionesDePremio;
  /** Si una cuenta pide nota para recibir. Solo se usa con un destino del enlace que es una G sin nota. */
  pideNota?: (cuenta: string) => Promise<boolean | null>;
  /** Solo para pruebas: la llave de la cuenta de destino que arma la página. */
  llaveDeDestino?: () => LlaveDeDestino;
}

export interface DatosDeEstado {
  ganador?: string;
  /** La persona no usó la llave. */
  cancelada?: boolean;
  /** El código de la última falla, para el plegado. */
  codigo?: string;
  /** Las monedas de la pantalla, en la unidad mínima y como texto. */
  monto?: string;
  fin?: string;
  direccion?: string;
  nota?: string;
  recibido?: boolean;
  destinoDelEnlace?: boolean;
  notaEnvio?: NotaDelEnvio;
  yaEnviadas?: boolean;
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

/** Lo que se sabe de un envío cuando se cierra en la misma carga en que se armó. Al retomarlo tras recargar, casi nada. */
interface ExtraDelEnvio {
  inicioMs: number;
  desbloqueos: number | null;
  raiz: "exacta" | "normalizada" | null;
  saldoOrigenAntes: bigint | null;
  saldoDestinoAntes: bigint | null;
}

const SIN_EXTRA: Omit<ExtraDelEnvio, "inicioMs"> = { desbloqueos: null, raiz: null, saldoOrigenAntes: null, saldoDestinoAntes: null };

const textoDeError = (e: unknown): string => (e instanceof Error ? e.message : "desconocido");

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
  /** Cómo va el premio de cada billetera, en memoria. El almacén del aparato lleva el mismo registro. */
  private readonly registros = new Map<string, RegistroDePremio>();
  /** El destino que la página armó en esta carga: se reusa si hay que reintentar. */
  private destinoListo: Destino | null = null;
  /** Lo último que mostró la pantalla con las monedas, para volver a ella si se cancela el desbloqueo. */
  private ultimoPremio: DatosDeEstado | null = null;

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
    const modoPremio = this.e.premio !== undefined;
    let estado = estadoInicial({
      host: o.host,
      hayPasskeys: o.hayPasskeys,
      enApp: o.enApp,
      conBloqueo: o.conBloqueo,
      punteroGrueso: o.punteroGrueso,
      hayLlaveLocal: llaves.some((l) => l.estado === "deployed"),
      selloPendiente: pendiente !== null,
      modoPremio,
      pendienteDeDinero: modoPremio && (leerEnvioPendiente(this.e.almacen) !== null || leerPremioPendiente(this.e.almacen) !== null),
    });
    if (estado === "esperando" && pendiente) {
      this.sello = pendiente;
      await this.retomarSello();
      return;
    }
    if ((estado === "inicio" || estado === "premio-inicio" || estado === "ya-hay-llave") && (creacion || llaves.some((l) => l.estado !== "deployed"))) {
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
        this.alComienzo({ cancelada: true });
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
      case "mira-mandar":
        this.falla("mandar", "cancelada");
        this.ir("premio-listo", { ...(this.ultimoPremio ?? {}), cancelada: true });
        break;
      case "recibiendo":
      case "enviando":
        this.falla(estado === "recibiendo" ? "recibir" : "mandar", "tiempo");
        this.ir("lento", { codigo: this.error });
        break;
      default:
        break;
    }
  }

  private vigente(g: number): boolean {
    return g === this.generacion;
  }

  /**
   * Volver al principio. Sin el modo premio, a la pantalla de siempre. Con él, al inicio del premio o, si `porConexion` y hay
   * una cuenta conectada, a lo que corresponde a esa cuenta.
   */
  private alComienzo(datos: DatosDeEstado = {}, porConexion = false): void {
    if (!this.e.premio) {
      this.ir(porConexion && this.conexion ? "cuenta-lista" : "inicio", datos);
      return;
    }
    if (porConexion && this.conexion) {
      void this.trasLaConexion(++this.generacion, { recienCreada: false });
      return;
    }
    this.ir("premio-inicio", datos);
  }

  private registro(contractId: string): RegistroDePremio | null {
    return this.registros.get(contractId) ?? leerRegistroDePremio(contractId, this.e.almacen);
  }

  private anotar(r: RegistroDePremio): void {
    const nuevo = avanzarRegistro(this.registro(r.contractId), r);
    this.registros.set(r.contractId, nuevo);
    anotarRegistroDePremio(nuevo, this.e.almacen);
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
      if (motivo === "cancelada" || motivo === "sin-foco") this.alComienzo({ cancelada: true });
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
      this.alComienzo();
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
    await this.trasLaConexion(g, { recienCreada: true });
  }

  /** Se tocó Mirar de nuevo en la pantalla de que esto tarda: se pregunta otra vez por la creación. */
  async mirar(): Promise<void> {
    if (this.e.premio) {
      const g = ++this.generacion;
      const envio = leerEnvioPendiente(this.e.almacen);
      if (envio) {
        await this.mirarEnvio(g, envio);
        return;
      }
      const pago = leerPremioPendiente(this.e.almacen);
      if (pago) {
        await this.mirarPremio(g, pago);
        return;
      }
    }
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
    this.alComienzo({}, this.e.premio !== undefined);
  }

  /* ------------------------------------------------------------------ entrar */

  /** Ya hay una llave en este aparato: se usa sin otro desbloqueo. */
  async usarLlave(): Promise<void> {
    const g = ++this.generacion;
    try {
      const sesion = await this.e.puente.volver();
      if (sesion) {
        this.conexion = sesion;
        if (this.vigente(g)) await this.trasLaConexion(g, { recienCreada: false });
        return;
      }
      const k = (await this.e.puente.llavesGuardadas()).find((l) => l.estado === "deployed");
      if (!k) {
        this.alComienzo();
        return;
      }
      this.conexion = await this.e.puente.conectar(k.credentialId, k.contractId);
      if (this.vigente(g)) await this.trasLaConexion(g, { recienCreada: false });
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
      await this.trasLaConexion(g, { recienCreada: false });
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
        this.alComienzo({ cancelada: true });
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
    this.alComienzo({}, true);
  }

  /* ------------------------------------------------------------------ sellar */

  /** Sellar la lista de ejemplo: la llave aprueba la entrada de `seal` y la cuenta descartable paga. */
  async sellar(): Promise<void> {
    const g = ++this.generacion;
    const conexion = this.conexion;
    if (!conexion) {
      this.alComienzo();
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
        const antes = this.e.puente.desbloqueosHechos();
        try {
          for (const entrada of entradas) firmadas.push(await this.e.puente.firmarEntrada(entrada, vence));
          this.desbloqueos += this.e.puente.desbloqueosHechos() - antes;
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
        if (this.e.premio) {
          const c = this.conexion;
          if (!c) await this.crear();
          else if (this.registro(c.contractId)?.estado === "por-pagar") await this.recibir();
          else await this.trasLaConexion(++this.generacion, { recienCreada: false });
        } else if (this.sello) {
          this.ir("esperando");
          await this.sortear();
        } else if (this.conexion) await this.sellar();
        else await this.crear();
        break;
      case "no-se-envio":
        await this.mandar();
        break;
      case "no-llego-premio":
        await this.recibir();
        break;
      case "saldo-sin-leer":
        await this.trasLaConexion(++this.generacion, { recienCreada: false });
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
        this.alComienzo({}, true);
    }
  }

  /** Empezar de nuevo desde la pantalla de falla. */
  empezar(): void {
    this.generacion++;
    this.sello = null;
    this.error = "";
    this.alComienzo({}, true);
  }

  /* ------------------------------------------------------------------ las monedas de prueba */

  /** Lo que sigue después de tener una cuenta conectada. Sin el modo premio, la pantalla de siempre. */
  private async trasLaConexion(g: number, o: { recienCreada: boolean }): Promise<void> {
    const c = this.conexion;
    if (!this.e.premio) {
      this.ir("cuenta-lista");
      return;
    }
    if (!c) {
      this.alComienzo();
      return;
    }
    if (o.recienCreada) {
      // El premio se paga por este registro, anotado una sola vez al crear la billetera en este aparato. Nunca por un saldo en cero.
      this.anotar({ contractId: c.contractId, estado: "por-pagar", hashPremio: null, hashEnvio: null });
      await this.recibir();
      return;
    }
    const envio = leerEnvioPendiente(this.e.almacen);
    if (envio && envio.contractId === c.contractId) {
      await this.mirarEnvio(g, envio);
      return;
    }
    const pago = leerPremioPendiente(this.e.almacen);
    if (pago && pago.contractId === c.contractId) {
      await this.mirarPremio(g, pago);
      return;
    }
    let saldo: SaldoLeido;
    try {
      saldo = await this.e.rpc.saldoDeContrato(c.contractId);
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("saldo", "lectura", textoDeError(e));
      this.ir("saldo-sin-leer", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    const registro = this.registro(c.contractId);
    if (registro?.estado === "por-pagar") {
      // Se creó la billetera acá y el pago no llegó a mandarse: Probar de nuevo lo paga, una sola vez.
      this.falla("recibir", "sin-pagar");
      this.ir("no-llego-premio", { codigo: this.error });
      return;
    }
    if (saldo.stroops > 0n) {
      if (saldo.archivada) this.falla("saldo", "archivada", String(saldo.vence));
      this.mostrarPremio({ monto: saldo.stroops, recibido: false });
      return;
    }
    this.ir("sin-monedas", { yaEnviadas: registro?.estado === "enviado" });
  }

  /** La pantalla con las monedas. No lee nada ni pide nada: solo muestra. */
  private mostrarPremio(o: { monto: bigint; recibido: boolean }): void {
    const pedido = this.e.premio?.destino ?? null;
    const datos: DatosDeEstado = { monto: o.monto.toString(), recibido: o.recibido };
    if (pedido) {
      datos.destinoDelEnlace = true;
      datos.direccion = pedido.direccion;
      const d = this.conexion ? destinoDelEnlace(pedido, this.conexion.contractId) : null;
      const nota = d && !("motivo" in d) ? d.nota : pedido.nota;
      if (nota !== null) datos.nota = nota.toString();
    } else {
      // El destino lo arma la página: el pagador se pide de fondo para que Mandar no espere al grifo.
      void this.obtenerPagador().catch(() => undefined);
    }
    this.ultimoPremio = datos;
    this.ir("premio-listo", datos);
  }

  /** Recibir el premio: la cuenta descartable le paga a la billetera, sin pedir la llave. */
  async recibir(): Promise<void> {
    const g = ++this.generacion;
    const c = this.conexion;
    if (!this.e.premio || !c) {
      this.alComienzo();
      return;
    }
    const previo = leerPremioPendiente(this.e.almacen);
    if (previo && previo.contractId === c.contractId) {
      await this.mirarPremio(g, previo);
      return;
    }
    if (this.registro(c.contractId)?.estado !== "por-pagar") {
      await this.trasLaConexion(g, { recienCreada: false });
      return;
    }
    const inicio = this.e.ahoraMs();
    this.ir("recibiendo");
    let pagador: Pagador;
    try {
      pagador = await this.obtenerPagador();
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falloDeGrifo("recibir", e);
      this.ir("sin-fondos", { codigo: this.error });
      return;
    }
    let vueltas = 0;
    let mandado = false;
    try {
      for (;;) {
        if (!this.vigente(g)) return;
        const secuencia = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia === null) throw new Error("pagador-sin-cuenta");
        const operacion = operacionDeTransferencia({ desde: pagador.publica, hacia: c.contractId, monto: MONTO_DEL_PREMIO });
        const armada = armarConOperacion({ origen: pagador.publica, secuencia, operacion });
        const sim = await this.e.rpc.simular(armada);
        if (!sim.ok) {
          this.falla("recibir", sim.restaurar ? "vencida" : "simulacion", sim.error ?? "sin-detalle");
          this.ir(sim.restaurar ? "vencida" : "no-llego-premio", { codigo: this.error });
          return;
        }
        // Una entrada que no es exactamente esta transferencia, con la firma del sobre, autorizaría otra cosa: no se manda.
        if (!sim.authB64.every((a) => credencialDe(a).tipo === "origen" && raizDeLaEntrada(a, operacion) === "exacta")) {
          this.falla("recibir", "entrada-ajena");
          this.ir("no-llego-premio", { codigo: this.error });
          return;
        }
        const ensamblada = this.e.rpc.ensamblar(armada, sim.simulacion);
        if (!mismaOperacion(ensamblada, operacion) || recursoDeclarado(ensamblada) > TOPE_DE_RECURSOS_STROOPS) {
          this.falla("recibir", "otra-transferencia");
          this.ir("no-llego-premio", { codigo: this.error });
          return;
        }
        const firmada = pagador.firmar(ensamblada);
        const hash = hashDeTransaccion(firmada);
        const pendiente: PremioPendiente = { contractId: c.contractId, hash, vence: maxTimeDe(firmada), monto: MONTO_DEL_PREMIO.toString(), desdeMs: this.e.ahoraMs() };
        guardarPremioPendiente(pendiente, this.e.almacen);
        mandado = true;
        const r = await this.confirmar(firmada, hash);
        if (!this.vigente(g)) return;
        if (r.estado === "entro") {
          await this.cerrarPremio(g, pendiente, inicio);
          return;
        }
        if (r.estado === "sin-respuesta") {
          this.falla("recibir", "sin-respuesta");
          this.ir("lento", { codigo: this.error });
          return;
        }
        // Entró y falló, la red la rechazó o venció: no entró ni va a entrar.
        borrarPremioPendiente(this.e.almacen);
        mandado = false;
        if (r.estado === "vencida" && vueltas++ < 1) continue;
        this.falla("recibir", r.estado, r.estado === "rechazada" ? r.codigo : undefined);
        this.ir("no-llego-premio", { codigo: this.error });
        return;
      }
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("recibir", "error", textoDeError(e));
      // Si ya se mandó, no se sabe: queda el pendiente guardado y Mirar de nuevo lo resuelve.
      this.ir(mandado ? "lento" : "no-llego-premio", { codigo: this.error });
    }
  }

  /** El pago entró: se anota, se mide y se muestra. Ninguna lectura de medidas puede llevar a una falla. */
  private async cerrarPremio(g: number, p: PremioPendiente, inicioMs: number): Promise<void> {
    borrarPremioPendiente(this.e.almacen);
    this.anotar({ contractId: p.contractId, estado: "pagado", hashPremio: p.hash, hashEnvio: null });
    let cobro: Cobro | null = null;
    try {
      cobro = leerCobro(await this.e.rpc.consultarCruda(p.hash));
    } catch (e) {
      this.falla("recibir", "lectura-cobro", textoDeError(e));
    }
    let saldoDespues: string | null = null;
    let vidaDelSaldo: number | null = null;
    try {
      const s = await this.e.rpc.saldoDeContrato(p.contractId);
      saldoDespues = s.stroops.toString();
      vidaDelSaldo = s.vence;
    } catch (e) {
      this.falla("recibir", "lectura-saldo", textoDeError(e));
    }
    this.medidas.premio = { hash: p.hash, ledger: cobro?.ledger ?? 0, segundos: Math.round((this.e.ahoraMs() - inicioMs) / 1000), monto: p.monto, saldoDespues, vidaDelSaldo, cobro };
    if (!this.vigente(g)) return;
    this.mostrarPremio({ monto: BigInt(p.monto), recibido: true });
  }

  /** Mirar de nuevo un pago mandado: si entró se cierra, si falló se dice, y si venció se vuelve a lo que haya en la cuenta. */
  private async mirarPremio(g: number, p: PremioPendiente): Promise<void> {
    let cruda: RespuestaCruda;
    try {
      cruda = await this.e.rpc.consultarCruda(p.hash);
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("mirar", "sin-respuesta", textoDeError(e));
      this.ir("lento", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    if (cruda.status === "SUCCESS") {
      await this.cerrarPremio(g, p, p.desdeMs);
      return;
    }
    if (cruda.status === "FAILED") {
      borrarPremioPendiente(this.e.almacen);
      this.falla("mirar", "fallo");
      this.ir("no-llego-premio", { codigo: this.error });
      return;
    }
    const cierre = Number(cruda.latestLedgerCloseTime);
    if (Number.isFinite(cierre) && cierre > p.vence) {
      // La red ya pasó la vida de la transacción sin verla: no entró ni va a entrar. El registro sigue diciendo por pagar.
      borrarPremioPendiente(this.e.almacen);
      this.falla("mirar", "vencida");
      if (this.conexion) await this.trasLaConexion(g, { recienCreada: false });
      else this.alComienzo();
      return;
    }
    this.falla("mirar", "sin-respuesta");
    this.ir("lento", { codigo: this.error });
  }

  /** La cuenta de prueba que pide nota y recibe las monedas cuando el enlace no trae un destino. */
  private async destinoDePrueba(g: number, pagador: Pagador): Promise<Destino | null> {
    const inicio = this.e.ahoraMs();
    const llave = (this.e.llaveDeDestino ?? llaveDeDestinoNueva)();
    try {
      const secuencia = await this.e.rpc.secuencia(pagador.publica);
      if (secuencia === null) throw new Error("pagador-sin-cuenta");
      const firmada = llave.firmar(pagador.firmar(armarCuentaQuePideNota({ origen: pagador.publica, secuencia, destino: llave.publica })));
      const hash = hashDeTransaccion(firmada);
      const r = await this.confirmar(firmada, hash);
      if (!this.vigente(g)) return null;
      if (r.estado !== "entro") {
        // Una cuenta que quedó sin saber si entró no se reusa: la próxima vez se arma otra. Todavía no se mandó ninguna moneda.
        this.falla("mandar", "destino", r.estado);
        this.ir("no-se-envio", { codigo: this.error });
        return null;
      }
      const destino = destinoDeLaPagina(llave.publica);
      this.destinoListo = destino;
      let cobro: Cobro | null = null;
      try {
        cobro = leerCobro(await this.e.rpc.consultarCruda(hash));
      } catch (e) {
        this.falla("mandar", "lectura-cobro-destino", textoDeError(e));
      }
      this.medidas.destinoDePrueba = { publica: llave.publica, hash, segundos: Math.round((this.e.ahoraMs() - inicio) / 1000), cobro };
      return destino;
    } catch (e) {
      if (!this.vigente(g)) return null;
      this.falla("mandar", "destino", textoDeError(e));
      this.ir("no-se-envio", { codigo: this.error });
      return null;
    }
  }

  /** Mandar todas las monedas de la billetera: la llave aprueba con un desbloqueo y la cuenta descartable paga. */
  async mandar(): Promise<void> {
    const g = ++this.generacion;
    const c = this.conexion;
    const premio = this.e.premio;
    if (!premio || !c) {
      this.alComienzo();
      return;
    }
    this.ir("enviando");
    const previo = leerEnvioPendiente(this.e.almacen);
    if (previo && previo.contractId === c.contractId) {
      await this.mirarEnvio(g, previo);
      return;
    }
    const inicio = this.e.ahoraMs();
    let saldo: bigint;
    try {
      saldo = (await this.e.rpc.saldoDeContrato(c.contractId)).stroops;
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("mandar", "saldo", textoDeError(e));
      this.ir("no-se-envio", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    // Mandar nunca paga un premio: con el saldo en cero no hay nada que mandar.
    if (saldo <= 0n) {
      this.ir("sin-monedas", { yaEnviadas: this.registro(c.contractId)?.estado === "enviado" });
      return;
    }
    let pagador: Pagador;
    try {
      pagador = await this.obtenerPagador();
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falloDeGrifo("mandar", e);
      this.ir("sin-fondos", { codigo: this.error });
      return;
    }

    // El destino: el del enlace, que se muestra entero antes del desbloqueo, o el que arma la página.
    const pedido = premio.destino;
    let destino: Destino;
    if (pedido) {
      const d = destinoDelEnlace(pedido, c.contractId);
      if ("motivo" in d) {
        this.falla("mandar", d.motivo);
        this.ir("no-recibe", { codigo: this.error });
        return;
      }
      if (d.tipo === "G") {
        // Una G sin nota se mira en el historial: si pide nota, no se manda. Una M ya lleva su número y una C no pide nota.
        const pide = this.e.pideNota ? await this.e.pideNota(d.base) : null;
        if (!this.vigente(g)) return;
        if (pide === true) {
          this.falla("mandar", "pide-nota");
          this.ir("pide-nota", { codigo: this.error });
          return;
        }
        if (pide === null) {
          this.falla("mandar", "sin-historial");
          this.ir("no-se-envio", { codigo: this.error });
          return;
        }
      }
      destino = d;
    } else {
      const hecho = this.destinoListo ?? (await this.destinoDePrueba(g, pagador));
      if (!hecho) return;
      destino = hecho;
    }
    if (!this.vigente(g)) return;

    let saldoDestinoAntes: bigint | null = null;
    try {
      saldoDestinoAntes = destino.tipo === "C" ? (await this.e.rpc.saldoDeContrato(destino.base)).stroops : await this.e.rpc.saldoDeCuenta(destino.base);
    } catch {
      saldoDestinoAntes = null;
    }

    let vueltas = 0;
    let mandado = false;
    try {
      for (;;) {
        if (!this.vigente(g)) return;
        // 1. Se simula en modo de grabar: da la entrada que hay que firmar. Este sobre nunca se manda.
        const secuencia = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia === null) throw new Error("pagador-sin-cuenta");
        const operacion = operacionDeTransferencia({ desde: c.contractId, hacia: destino.hacia, monto: saldo });
        const sim = await this.e.rpc.simular(armarConOperacion({ origen: pagador.publica, secuencia, operacion }));
        if (!sim.ok) {
          this.falla("mandar", sim.restaurar ? "vencida" : "simulacion", sim.error ?? "sin-detalle");
          this.ir(sim.restaurar ? "vencida" : pedido ? "no-recibe" : "no-se-envio", { codigo: this.error });
          return;
        }
        // Lo que se firma es lo que se ve: una sola entrada, de esta cuenta, y exactamente esta transferencia.
        let entrada: string | undefined;
        try {
          entrada = entradasPorFirmar(sim.authB64, c.contractId)[0];
        } catch {
          entrada = undefined;
        }
        const raiz = entrada === undefined || sim.authB64.length !== 1 ? "otra" : raizDeLaEntrada(entrada, operacion);
        if (entrada === undefined || raiz === "otra") {
          this.falla("mandar", "otra-transferencia");
          this.ir("no-se-envio", { codigo: this.error });
          return;
        }

        // 2. La llave aprueba, con un desbloqueo.
        this.ir("mira-mandar", { monto: saldo.toString(), ...(pedido ? { destinoDelEnlace: true, direccion: pedido.direccion } : {}) });
        this.conFoco = this.e.hayFoco();
        const antes = this.e.puente.desbloqueosHechos();
        let firmada: string;
        try {
          firmada = await this.e.puente.firmarEntrada(entrada, vencimientoDeLaFirma(sim.latestLedger));
        } catch (e) {
          if (!this.vigente(g)) return;
          const motivo = motivoDeLaLlave(e, this.conFoco);
          this.falla("mandar", motivo, motivo === "otro" ? textoDeError(e) : undefined);
          if (motivo === "cancelada" || motivo === "sin-foco") this.ir("premio-listo", { ...(this.ultimoPremio ?? { monto: saldo.toString(), recibido: false }), cancelada: true });
          else this.ir("no-se-envio", { codigo: this.error });
          return;
        }
        const desbloqueos = this.e.puente.desbloqueosHechos() - antes;
        if (!this.vigente(g)) return;
        this.ir("enviando");

        // 3. El sobre final se arma ahora, con su vida de 30 s, y se simula exigiendo la firma.
        const secuencia2 = await this.e.rpc.secuencia(pagador.publica);
        if (secuencia2 === null) throw new Error("pagador-sin-cuenta");
        const final = armarConOperacion({ origen: pagador.publica, secuencia: secuencia2, operacion: conEntradasFirmadas(operacion, [firmada]) });
        const sim2 = await this.e.rpc.simular(final);
        if (!sim2.ok) {
          this.falla("mandar", sim2.restaurar ? "vencida" : "simulacion-con-firma", sim2.error ?? "sin-detalle");
          this.ir(sim2.restaurar ? "vencida" : "no-se-envio", { codigo: this.error });
          return;
        }
        const ensamblada = this.e.rpc.ensamblar(final, sim2.simulacion);
        if (!mismaAutorizacion(ensamblada, [firmada]) || !mismaOperacion(ensamblada, operacion) || recursoDeclarado(ensamblada) > TOPE_DE_RECURSOS_STROOPS) {
          this.falla("mandar", "autorizacion-cambiada");
          this.ir("no-se-envio", { codigo: this.error });
          return;
        }
        const sobre = pagador.firmar(ensamblada);
        const hash = hashDeTransaccion(sobre);
        const envio: EnvioPendiente = {
          contractId: c.contractId,
          hash,
          vence: maxTimeDe(sobre),
          hacia: destino.hacia,
          base: destino.base,
          tipo: destino.tipo,
          origen: destino.origen,
          nota: destino.nota === null ? null : destino.nota.toString(),
          monto: saldo.toString(),
          desdeMs: this.e.ahoraMs(),
        };
        guardarEnvioPendiente(envio, this.e.almacen);
        mandado = true;
        const r = await this.confirmar(sobre, hash);
        if (!this.vigente(g)) return;
        if (r.estado === "entro") {
          await this.cerrarEnvio(g, envio, { inicioMs: inicio, desbloqueos, raiz, saldoOrigenAntes: saldo, saldoDestinoAntes });
          return;
        }
        if (r.estado === "sin-respuesta") {
          this.falla("mandar", "sin-respuesta");
          this.ir("lento", { codigo: this.error });
          return;
        }
        borrarEnvioPendiente(this.e.almacen);
        mandado = false;
        if (r.estado === "vencida" && vueltas++ < 1) continue;
        this.falla("mandar", r.estado, r.estado === "rechazada" ? r.codigo : undefined);
        this.ir("no-se-envio", { codigo: this.error });
        return;
      }
    } catch (e) {
      if (!this.vigente(g)) return;
      this.falla("mandar", "error", textoDeError(e));
      // Después de mandar nunca se vuelve a una falla: no se sabe, y Mirar de nuevo lo resuelve con el hash guardado.
      this.ir(mandado ? "lento" : "no-se-envio", { codigo: this.error });
    }
  }

  /**
   * El envío entró: se anota y se mide. Cada lectura va en su propio try y, si falla, se anota y se sigue: nada de lo que
   * pase después de que entró lleva a una pantalla de falla ni arma otra transferencia.
   */
  private async cerrarEnvio(g: number, e: EnvioPendiente, extra: ExtraDelEnvio): Promise<void> {
    borrarEnvioPendiente(this.e.almacen);
    this.anotar({ contractId: e.contractId, estado: "enviado", hashPremio: null, hashEnvio: e.hash });
    let cruda: RespuestaCruda | null = null;
    let cobro: Cobro | null = null;
    try {
      cruda = await this.e.rpc.consultarCruda(e.hash);
      cobro = leerCobro(cruda);
    } catch (err) {
      this.falla("mandar", "lectura-cobro", textoDeError(err));
    }
    const vista = cruda ? transferenciaDelEvento(cruda, RED_DE_PRUEBA.activo) : null;
    const notaPedida = e.nota === null ? null : BigInt(e.nota);
    const notaEnvio = notaDelEnvio(notaPedida, vista);
    let saldoOrigenDespues: string | null = null;
    try {
      saldoOrigenDespues = (await this.e.rpc.saldoDeContrato(e.contractId)).stroops.toString();
    } catch (err) {
      this.falla("mandar", "lectura-saldo", textoDeError(err));
    }
    let saldoDestinoDespues: string | null = null;
    try {
      const s = e.tipo === "C" ? (await this.e.rpc.saldoDeContrato(e.base)).stroops : await this.e.rpc.saldoDeCuenta(e.base);
      saldoDestinoDespues = s === null ? null : s.toString();
    } catch (err) {
      this.falla("mandar", "lectura-saldo-destino", textoDeError(err));
    }
    const fin = e.base.slice(-4);
    const paso: PasoDeEnvio = {
      hash: e.hash,
      ledger: cobro?.ledger ?? 0,
      segundos: Math.round((this.e.ahoraMs() - extra.inicioMs) / 1000),
      desbloqueos: extra.desbloqueos,
      raiz: extra.raiz,
      monto: e.monto,
      destino: { tipo: e.tipo, direccion: e.base, fin, origen: e.origen },
      notaPedida: e.nota,
      notaVista: vista?.nota?.toString() ?? null,
      notaEnvio,
      saldoOrigenAntes: extra.saldoOrigenAntes === null ? null : extra.saldoOrigenAntes.toString(),
      saldoOrigenDespues,
      saldoDestinoAntes: extra.saldoDestinoAntes === null ? null : extra.saldoDestinoAntes.toString(),
      saldoDestinoDespues,
      cobro,
    };
    this.medidas.envios.push(paso);
    if (notaEnvio !== "confirmada" && notaEnvio !== "no-pedida") this.falla("mandar", "nota", `${notaEnvio}:${paso.notaVista ?? "sin-dato"}`);
    if (!this.vigente(g)) return;
    this.ir("enviado", { monto: e.monto, fin, notaEnvio, ...(e.nota !== null ? { nota: e.nota } : {}) });
  }

  /** Mirar de nuevo un envío mandado: si entró se cierra, si falló se dice, y si venció las monedas siguen donde estaban. */
  private async mirarEnvio(g: number, e: EnvioPendiente): Promise<void> {
    let cruda: RespuestaCruda;
    try {
      cruda = await this.e.rpc.consultarCruda(e.hash);
    } catch (err) {
      if (!this.vigente(g)) return;
      this.falla("mirar", "sin-respuesta", textoDeError(err));
      this.ir("lento", { codigo: this.error });
      return;
    }
    if (!this.vigente(g)) return;
    if (cruda.status === "SUCCESS") {
      await this.cerrarEnvio(g, e, { inicioMs: e.desdeMs, ...SIN_EXTRA });
      return;
    }
    if (cruda.status === "FAILED") {
      borrarEnvioPendiente(this.e.almacen);
      this.falla("mirar", "fallo");
      this.ir("no-se-envio", { codigo: this.error });
      return;
    }
    const cierre = Number(cruda.latestLedgerCloseTime);
    if (Number.isFinite(cierre) && cierre > e.vence) {
      borrarEnvioPendiente(this.e.almacen);
      this.falla("mirar", "vencida");
      if (this.conexion) await this.trasLaConexion(g, { recienCreada: false });
      else this.alComienzo();
      return;
    }
    this.falla("mirar", "sin-respuesta");
    this.ir("lento", { codigo: this.error });
  }
}
