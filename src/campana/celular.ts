/**
 * La página del celular de una campaña, pintada desde un estado, con todo lo de afuera
 * (la sala, Google, el reloj y el almacenamiento) detrás de DepsDelCelular.
 * Así la conexión posterior no toca las pantallas y la demostración anda sin red.
 */

import type { Lang } from "../idioma";
import {
  pintarAdentro,
  pintarGano,
  pintarHola,
  pintarOtra,
  pintarSalio,
  pintarTermino,
} from "./adentro";
import { festejar } from "./festejo";
import { fechaTexto, horaTexto } from "./formato";
import type { Campana } from "./modelo";
import {
  borrarMemoria,
  guardarMemoria,
  leerMemoria,
  type MemoriaDeCampana,
} from "./memoria";
import { pintarAviso } from "./piezas";
import {
  COLORES,
  motivoDeEntrada,
  pintarEstadoDeCarga,
  pintarLaCampana,
  sustituir,
  type EstadoDeEntrada,
} from "./previa";

export type Fase = "lista" | "abierta" | "cerrada" | "sellada" | "sorteada";
export type MotivoDeSalida = "repetida" | "evento" | "pidio" | "otro";
export interface EstadoPublico {
  fase: Fase;
  total: number;
  cierraMs: number;
  pase: "vale" | "vencido" | "sin";
  /** Si la sala le avisa por correo a quien gana. Una sala que no lo dice cuenta como que no. */
  correo?: boolean;
}
export interface EstadoPropio {
  fase: Fase;
  total: number;
  cierraMs: number;
  anotada: boolean;
  quitada?: MotivoDeSalida;
  gano?: boolean;
  avisado?: boolean;
}
export type MotivoDeAlta =
  | "llena"
  | "mucha"
  | "creando"
  | "wifi"
  | "espera"
  | "cuentas"
  | "proveedor"
  | "cerro"
  | "pase"
  | "sesion"
  | "solo-google"
  | "red"
  | "quitada"
  | "otro";
export type ResultadoDelAlta = { ok: true; ya: boolean } | { ok: false; motivo: MotivoDeAlta };
export type FallaDeEntrada = "ventana" | "cerrada" | "google" | "cuentas";
export interface SesionDelCelular {
  cuenta: string;
  nombre: string | null;
}

export interface DepsDelCelular {
  tx: (clave: string) => string;
  idioma: () => Lang;
  campana: Campana;
  enApp: boolean;
  ahora: () => number;
  /** Lo público de la sala: fase, cuántas van, hora de cierre y si el pase del enlace vale. */
  publico: () => Promise<EstadoPublico | "red" | "terminada">;
  /** La sesión que ya hay en el navegador, sin abrir ninguna ventana. */
  sesion: () => Promise<SesionDelCelular | null>;
  /** Entrar con Google desde el toque. Rechaza con un Error cuyo message es una FallaDeEntrada. */
  entrar: () => Promise<SesionDelCelular>;
  /** Anotarse. Mientras reintenta solo, avisa con mucha o creando. */
  anotar: (
    nombre: string | null,
    alReintentar: (motivo: "mucha" | "creando") => void,
  ) => Promise<ResultadoDelAlta>;  /** Lo que la sala sabe de este celular. */
  yo: () => Promise<EstadoPropio | "red" | "terminada">;
  /** Las cuentas elegidas y el enlace al comprobante, o null si todavía no hay resultado. */
  resultado: () => Promise<{ ganadoras: string[]; comprobante: string | null } | null | "red">;
  /** Lleva a recibir el premio. */
  recibir: () => void;
  /** Cierra la sesión de Google. */
  salir: () => Promise<void>;
  /**
   * El paso «Dejá tu cuenta lista» en la red principal, con la sesión ya abierta: activar y proteger la cuenta antes de
   * anotarse, con el paso que existe para quien organiza (`campana/cuenta.ts`). Devuelva `true` si se siguió con la
   * cuenta lista, y `false` cuando la persona no siguió: en ese caso se cierra la sesión y se vuelve a la pantalla
   * previa. Solo lo arma la página de verdad, en la red principal: en la demo y en la red de prueba no está.
   */
  cuentaLista?: () => Promise<boolean>;
  /**
   * La comprobación propia del sello (`campana/comprobar.ts`): el celular lee en la red la transacción del sello y
   * comprueba él mismo que su cuenta está en la lista, sin creerle al servidor. `"esta"` y `"no-esta"` son lo que la red
   * atestigua; `null` es que no se pudo comprobar, y la pantalla no dice nada.
   */
  comprobar?: (o: { comprobante: string; cuenta: string; contrato: string | null }) => Promise<"esta" | "no-esta" | null>;
  /** El costo de retirar, ya escrito para mostrar, o null si no hay costo. */
  costoDelRetiro: () => string | null;
  enlace: () => string;
  cada: (f: () => void, ms: number) => () => void;
  visible: () => boolean;
  alVolver: (f: () => void) => () => void;
  vibrar: (patron: number[]) => void;
  movimientoReducido: () => boolean;
  memoria: Storage | null;
  /** La sala de esta campaña, para la memoria del celular. */
  sala: string;
}

export interface VistaDelCelular {
  pintar: () => void;
  desmontar: () => void;
}

type Pantalla =
  | "inicial"
  | "previa"
  | "hola"
  | "adentro"
  | "gano"
  | "otra"
  | "salio"
  | "termino"
  | "lista"
  | "cerrada"
  | "sorteada"
  | "sin-red"
  | "pase"
  | "llena";

interface EstadoInterno {
  pantalla: Pantalla;
  publico: EstadoPublico | null;
  propio: EstadoPropio | null;
  sesion: SesionDelCelular | null;
  memoria: MemoriaDeCampana | null;
  errorAlta: MotivoDeAlta | null;
  ya: boolean;
  anotando: boolean;
  tardando: boolean;
  comprobante: string | null;
  avisado: boolean;
  motivoSalida: MotivoDeSalida;
  festejoGrandeHecho: boolean;
  /** Lo que la comprobación propia del sello dijo de la cuenta de este celular, y con qué comprobante. */
  sello: "esta" | "no-esta" | null;
  selloDe: string | null;
  corriendoElSello: boolean;
  /** Mientras el paso de la cuenta lista espera a la persona, la entrada no se vuelve a abrir. */
  esperandoLaCuenta: boolean;
}

/** El festejo chico dura menos de un segundo: repintar antes lo borraría. */
const ESPERA_DEL_REFRESCO_MS = 1000;

/** Decide la pantalla, coordina las consultas y conserva solo el recuerdo permitido de la sala. */
export function montarCelular(raiz: HTMLElement, deps: DepsDelCelular): VistaDelCelular {
  const acento = deps.campana.empresa.color;
  raiz.style.setProperty("--cmp-acento", acento ? COLORES[acento] : "var(--magenta)");
  const estado: EstadoInterno = {
    pantalla: "inicial",
    publico: null,
    propio: null,
    sesion: null,
    memoria: null,
    errorAlta: null,
    ya: false,
    anotando: false,
    tardando: false,
    comprobante: null,
    avisado: false,
    motivoSalida: "otro",
    festejoGrandeHecho: false,
    sello: null,
    selloDe: null,
    corriendoElSello: false,
    esperandoLaCuenta: false,
  };
  let desmontado = false;
  let consultando = false;
  let cancelarIntervalo: (() => void) | null = null;
  let temporizadorAlta: number | null = null;
  let temporizadorRefresco: number | null = null;
  let limpiarPintura: (() => void) | null = null;
  /** La entrada con Google vive acá y no en la pantalla: pintar de nuevo no puede perder el botón ni el error. */
  const entrada: EstadoDeEntrada = { desde: null, falla: null };
  const depsDeLaPrevia: DepsDelCelular = {
    ...deps,
    entrar: () => {
      entrada.desde = deps.ahora();
      entrada.falla = null;
      return deps.entrar().then(
        (sesion) => {
          entrada.desde = null;
          return sesion;
        },
        (error: unknown) => {
          entrada.desde = null;
          entrada.falla = motivoDeEntrada(error);
          // La pantalla que tocó la persona pudo cambiarse mientras tanto: la nueva muestra el error.
          if (!desmontado && estado.pantalla === "previa") pintar();
          throw error;
        },
      );
    },
  };

  const secciones = (): HTMLElement[] => ["#cmp-estado", "#cmp-saber", "#cmp-hola", "#cmp-adentro"]
    .map((selector) => raiz.querySelector<HTMLElement>(selector))
    .filter((elemento): elemento is HTMLElement => elemento !== null);

  const ocultar = (): void => {
    for (const seccion of secciones()) seccion.hidden = true;
  };

  const avisoPublico = (texto: string, comprobante: string | null = null, conHoraDelSorteo = false): void => {
    const seccion = raiz.querySelector<HTMLElement>("#cmp-estado");
    if (!seccion) return;
    const accion = comprobante ? { texto: deps.tx("cpComoSeEligio"), enlace: comprobante } : null;
    // Un aviso a pantalla completa dice de quién es el sorteo, y cuándo es si ayuda a quien espera.
    const rotulos = [sustituir(deps.tx("cpTitulo"), { empresa: deps.campana.empresa.nombre })];
    if (conHoraDelSorteo) {
      const hora = horaTexto(deps.campana.sorteoMs, deps.campana.zona, deps.idioma());
      rotulos.push(sustituir(deps.tx("cpSorteoA"), { hora }));
    }
    pintarAviso(seccion, texto, accion, false, rotulos);
  };

  const intervaloDe = (pantalla: Pantalla): number | null => {
    if (pantalla === "previa" || pantalla === "hola" || pantalla === "adentro") return 15_000;
    if (pantalla === "gano" || pantalla === "otra") return 60_000;
    return null;
  };

  const pintar = (): void => {
    if (desmontado) return;
    limpiarPintura?.();
    limpiarPintura = null;
    ocultar();
    if (estado.pantalla === "previa" && estado.publico) {
      limpiarPintura = pintarLaCampana(raiz, depsDeLaPrevia, estado.publico, (sesion) => {
        estado.sesion = sesion;
        estado.errorAlta = null;
        void seguirTrasEntrar();
      }, entrada);
      return;
    }
    if (estado.pantalla === "hola") {
      pintarHola(raiz, deps, {
        nombre: estado.sesion?.nombre ?? null,
        error: estado.errorAlta,
      }, {
        alAnotar: () => void anotarse(),
        alSalir: () => void salir(),
        anotando: estado.anotando,
        tardando: estado.tardando,
      });
      return;
    }
    if (estado.pantalla === "adentro") {
      const propio = estado.propio;
      const publico = estado.publico;
      if (propio) {
        pintarAdentro(raiz, deps, {
          ya: estado.ya,
          total: propio.total,
          fase: propio.fase,
          cierraMs: propio.cierraMs,
        });
      } else if (publico) {
        pintarAdentro(raiz, deps, {
          ya: estado.ya,
          total: publico.total,
          fase: publico.fase,
          cierraMs: publico.cierraMs,
        });
      }
      return;
    }
    if (estado.pantalla === "gano") {
      pintarGano(raiz, deps, { avisado: estado.avisado, comprobante: estado.comprobante, comprobado: selloComprobado() });
      if (!estado.festejoGrandeHecho) {
        estado.festejoGrandeHecho = true;
        const seccion = raiz.querySelector<HTMLElement>("#cmp-estado");
        if (seccion) {
          festejar(seccion, {
            grande: true,
            reducido: deps.movimientoReducido(),
            vibrar: deps.vibrar,
          });
        }
      }
      return;
    }
    if (estado.pantalla === "otra") {
      pintarOtra(raiz, deps, { comprobante: estado.comprobante, comprobado: selloComprobado() });
      return;
    }
    if (estado.pantalla === "salio") {
      pintarSalio(raiz, deps, estado.motivoSalida);
      return;
    }
    if (estado.pantalla === "termino") {
      pintarTermino(raiz, deps, estado.memoria);
      return;
    }
    if (estado.pantalla === "sin-red") {
      const seccion = raiz.querySelector<HTMLElement>("#cmp-estado");
      if (seccion) pintarEstadoDeCarga(seccion, deps.tx, "sin-red", () => void iniciar());
      return;
    }
    if (estado.pantalla === "pase") {
      const seccion = raiz.querySelector<HTMLElement>("#cmp-estado");
      if (seccion) pintarEstadoDeCarga(seccion, deps.tx, "pase-vencido", () => undefined);
      return;
    }
    if (estado.pantalla === "llena") {
      avisoPublico(deps.tx("cpErrLlena"), null, true);
      return;
    }
    if (estado.pantalla === "lista") {
      avisoPublico(sustituir(deps.tx("cpAbre"), {
        fecha: fechaTexto(deps.campana.abreMs, deps.campana.zona, deps.idioma()),
        hora: horaTexto(deps.campana.abreMs, deps.campana.zona, deps.idioma()),
      }));
      return;
    }
    if (estado.pantalla === "cerrada") {
      avisoPublico(deps.tx("cpCerro"), null, true);
      return;
    }
    if (estado.pantalla === "sorteada") avisoPublico(deps.tx("cpSorteado"), estado.comprobante);
  };

  function ir(pantalla: Pantalla): void {
    if (desmontado) return;
    estado.pantalla = pantalla;
    cancelarIntervalo?.();
    cancelarIntervalo = null;
    const ms = intervaloDe(pantalla);
    if (ms !== null) {
      cancelarIntervalo = deps.cada(() => {
        if (deps.visible()) void preguntar();
      }, ms);
    }
    pintar();
  }

  function guardar(cambios: Partial<MemoriaDeCampana> = {}): void {
    const cuenta = estado.sesion?.cuenta ?? estado.memoria?.cuenta;
    if (!cuenta) return;
    const anterior = estado.memoria;
    const memoria: MemoriaDeCampana = {
      cuenta,
      fase: cambios.fase ?? estado.propio?.fase ?? anterior?.fase ?? "abierta",
      resultado: cambios.resultado === undefined
        ? anterior?.resultado ?? null
        : cambios.resultado,
      comprobante: cambios.comprobante === undefined
        ? anterior?.comprobante ?? null
        : cambios.comprobante,
      // El nombre con que la pantalla la saludó y el número de la lista, tal como se vieron al guardarlo.
      nombre: cambios.nombre ?? anterior?.nombre ?? null,
      total: cambios.total ?? anterior?.total ?? null,
      guardado: deps.ahora(),
    };
    estado.memoria = memoria;
    guardarMemoria(deps.memoria, deps.sala, memoria);
  }

  async function pedirResultado(): Promise<{ ganadoras: string[]; comprobante: string | null } | null | "red"> {
    try {
      return await deps.resultado();
    } catch {
      return "red";
    }
  }

  async function mostrarSorteoPublico(): Promise<void> {
    const resultado = await pedirResultado();
    if (resultado && resultado !== "red") estado.comprobante = resultado.comprobante;
    ir("sorteada");
  }

  async function mostrarFasePublica(fase: Fase): Promise<void> {
    if (fase === "lista") ir("lista");
    else if (fase === "abierta") ir("previa");
    else if (fase === "cerrada" || fase === "sellada") ir("cerrada");
    else await mostrarSorteoPublico();
  }

  async function aplicarPropio(propio: EstadoPropio): Promise<void> {
    if (desmontado) return;
    const avisadoAntes = estado.avisado;
    estado.propio = propio;
    estado.publico = {
      fase: propio.fase,
      total: propio.total,
      cierraMs: propio.cierraMs,
      pase: estado.publico?.pase ?? "sin",
    };
    if (propio.quitada) {
      estado.motivoSalida = propio.quitada;
      guardar({ fase: propio.fase });
      ir("salio");
      return;
    }
    if (propio.fase === "sorteada") {
      const resultado = await pedirResultado();
      if (desmontado || resultado === "red" || resultado === null) return;
      estado.comprobante = resultado.comprobante;
      estado.avisado = propio.avisado === true;
      const cuenta = estado.sesion?.cuenta ?? estado.memoria?.cuenta;
      const gano = propio.gano === true || (cuenta !== undefined && resultado.ganadoras.includes(cuenta));
      guardar({
        fase: "sorteada",
        resultado: gano ? "gano" : "otra",
        comprobante: resultado.comprobante,
      });
      if (gano) {
        ir("gano");
        void comprobarElSello();
        if (estado.avisado && !avisadoAntes) deps.vibrar([60, 40, 60]);
      } else {
        ir("otra");
        void comprobarElSello();
      }
      return;
    }
    guardar({ fase: propio.fase, total: propio.total });
    if (estado.pantalla === "adentro") pintar();
    else ir("adentro");
    if (estado.pantalla === "gano" && propio.avisado && !avisadoAntes) {
      estado.avisado = true;
      deps.vibrar([60, 40, 60]);
      pintar();
    }
  }

  async function pedirPropio(): Promise<EstadoPropio | "red" | "terminada"> {
    try {
      return await deps.yo();
    } catch {
      return "red";
    }
  }

  async function consultarPropio(): Promise<void> {
    const propio = await pedirPropio();
    if (desmontado || propio === "red") return;
    if (propio === "terminada") {
      ir("termino");
      return;
    }
    await aplicarPropio(propio);
  }

  function mostrarMemoria(memoria: MemoriaDeCampana): void {
    estado.memoria = memoria;
    estado.comprobante = memoria.comprobante;
    estado.ya = true;
    estado.propio = {
      fase: memoria.fase,
      // El número que el celular guardó se ve enseguida, y la primer consulta lo pone al dia.
      total: memoria.total ?? estado.publico?.total ?? 0,
      cierraMs: estado.publico?.cierraMs ?? deps.campana.cierraMs,
      anotada: true,
    };
    if (memoria.resultado === "gano") {
      estado.festejoGrandeHecho = true;
      ir("gano");
      void comprobarElSello();
    } else if (memoria.resultado === "otra") {
      ir("otra");
      void comprobarElSello();
    } else {
      ir("adentro");
    }
  }

  async function iniciar(): Promise<void> {
    if (desmontado) return;
    const memoria = leerMemoria(deps.memoria, deps.sala, deps.ahora());
    estado.memoria = memoria;
    let publico: EstadoPublico | "red" | "terminada";
    try {
      publico = await deps.publico();
    } catch {
      publico = "red";
    }
    if (desmontado) return;
    if (publico === "red") {
      ir("sin-red");
      return;
    }
    if (publico === "terminada") {
      ir("termino");
      return;
    }
    estado.publico = publico;
    if (publico.pase === "vencido" && !memoria) {
      ir("pase");
      return;
    }
    let sesion: SesionDelCelular | null = null;
    try {
      sesion = await deps.sesion();
    } catch {
      sesion = null;
    }
    if (desmontado) return;
    estado.sesion = sesion;
    if (memoria) {
      if (sesion && sesion.cuenta !== memoria.cuenta) {
        borrarMemoria(deps.memoria, deps.sala);
        estado.memoria = null;
        ir("hola");
        return;
      }
      mostrarMemoria(memoria);
      await consultarPropio();
      return;
    }
    if (sesion) {
      if (publico.fase === "lista" || publico.fase === "cerrada") {
        await mostrarFasePublica(publico.fase);
        return;
      }
      const propio = await pedirPropio();
      if (desmontado) return;
      if (propio === "terminada") {
        ir("termino");
        return;
      }
      // Quien salió de la lista y vuelve sin recuerdo ve por qué salió, no otra vez el botón de anotarse.
      if (propio !== "red" && (propio.anotada || propio.quitada !== undefined)) {
        await aplicarPropio(propio);
        return;
      }
      if (publico.fase === "abierta") {
        void seguirTrasEntrar();
      } else await mostrarFasePublica(publico.fase);
      return;
    }
    await mostrarFasePublica(publico.fase);
  }

  async function preguntar(): Promise<void> {
    if (desmontado || consultando || !deps.visible()) return;
    if (estado.pantalla !== "previa" && estado.pantalla !== "hola" && estado.pantalla !== "adentro"
      && estado.pantalla !== "gano" && estado.pantalla !== "otra") return;
    consultando = true;
    try {
      if (estado.pantalla === "previa" || estado.pantalla === "hola") {
        let publico: EstadoPublico | "red" | "terminada";
        try {
          publico = await deps.publico();
        } catch {
          publico = "red";
        }
        if (desmontado || publico === "red") return;
        if (publico === "terminada") {
          ir("termino");
          return;
        }
        estado.publico = publico;
        if (publico.fase === "abierta") pintar();
        else await mostrarFasePublica(publico.fase);
      } else {
        await consultarPropio();
      }
    } finally {
      consultando = false;
    }
  }

  async function anotarse(): Promise<void> {
    if (estado.anotando || !estado.sesion) return;
    estado.anotando = true;
    estado.tardando = false;
    estado.errorAlta = null;
    pintar();
    temporizadorAlta = window.setTimeout(() => {
      if (estado.anotando && estado.pantalla === "hola") {
        estado.tardando = true;
        pintar();
      }
    }, 3000);
    let resultado: ResultadoDelAlta;
    try {
      resultado = await deps.anotar(estado.sesion.nombre, (motivo) => {
        if (estado.anotando && estado.pantalla === "hola") {
          estado.errorAlta = motivo;
          pintar();
        }
      });
    } catch {
      resultado = { ok: false, motivo: "red" };
    }
    if (temporizadorAlta !== null) window.clearTimeout(temporizadorAlta);
    temporizadorAlta = null;
    if (desmontado) return;
    estado.anotando = false;
    estado.tardando = false;
    if (resultado.ok) {
      estado.errorAlta = null;
      estado.ya = resultado.ya;
      // La persona que se acaba de anotar ya cuenta: la confirmación no repite el número de antes.
      estado.propio = {
        fase: "abierta",
        total: (estado.publico?.total ?? 0) + (resultado.ya ? 0 : 1),
        cierraMs: estado.publico?.cierraMs ?? deps.campana.cierraMs,
        anotada: true,
      };
      guardar({
        fase: "abierta",
        resultado: null,
        comprobante: null,
        nombre: estado.sesion?.nombre ?? null,
        total: (estado.publico?.total ?? 0) + (resultado.ya ? 0 : 1),
      });
      ir("adentro");
      if (!resultado.ya) {
        const seccion = raiz.querySelector<HTMLElement>("#cmp-adentro");
        if (seccion) {
          festejar(seccion, {
            grande: false,
            reducido: deps.movimientoReducido(),
            vibrar: deps.vibrar,
          });
        }
      }
      // El número de la sala se trae sin esperar al turno siguiente, apenas termina el festejo chico.
      temporizadorRefresco = window.setTimeout(() => {
        temporizadorRefresco = null;
        void preguntar();
      }, ESPERA_DEL_REFRESCO_MS);
      return;
    }
    if (resultado.motivo === "quitada") {
      const propio = await pedirPropio();
      estado.motivoSalida = propio !== "red" && propio !== "terminada" && propio.quitada
        ? propio.quitada
        : "otro";
      ir("salio");
      return;
    }
    // Tres rechazos no se arreglan tocando otra vez Acepto: cada uno lleva a su pantalla, sin el botón de anotarse.
    if (resultado.motivo === "pase") {
      ir("pase");
      return;
    }
    if (resultado.motivo === "cerro") {
      ir("cerrada");
      return;
    }
    if (resultado.motivo === "llena") {
      ir("llena");
      return;
    }
    estado.errorAlta = resultado.motivo;
    pintar();
  }

  async function salir(): Promise<void> {
    try {
      await deps.salir();
    } catch {
      /* Aunque el proveedor falle, esta página olvida la sesión y el recuerdo local. */
    }
    if (desmontado) return;
    borrarMemoria(deps.memoria, deps.sala);
    estado.sesion = null;
    estado.memoria = null;
    estado.propio = null;
    estado.errorAlta = null;
    estado.festejoGrandeHecho = false;
    estado.sello = null;
    estado.selloDe = null;
    estado.corriendoElSello = false;
    estado.esperandoLaCuenta = false;
    entrada.desde = null;
    entrada.falla = null;
    ir("previa");
  }

  /** La entrada con Google siguió (la pantalla previa pone la sesión): la cuenta tiene que quedar lista antes del saludo. */
  async function seguirTrasEntrar(): Promise<void> {
    if (!estado.sesion || estado.esperandoLaCuenta) return;
    estado.esperandoLaCuenta = true;
    let lista = true;
    try {
      if (deps.cuentaLista) lista = await deps.cuentaLista();
    } catch {
      // Lo que no se pudo mirar no frena: el alta ya sabe decir cuándo la cuenta no termina de estar lista.
      lista = true;
    } finally {
      estado.esperandoLaCuenta = false;
    }
    if (desmontado) return;
    if (!lista) {
      // La persona no siguió (Volver o cerrar la sesión en el paso): la pantalla queda como al entrar, sin sesión.
      await salir();
      return;
    }
    // Volver al saludo, sea desde la entrada por toque (pantalla previa) o desde la sesión ya retomada (página nueva).
    if (estado.pantalla === "previa" || estado.pantalla === "inicial") ir("hola");
  }

  /** La comprobación propia del sello, una sola vez por comprobante, en las pantallas del resultado. */
  async function comprobarElSello(): Promise<void> {
    if (desmontado || estado.corriendoElSello) return;
    const dep = deps.comprobar;
    const cuenta = estado.sesion?.cuenta ?? estado.memoria?.cuenta;
    const comprobante = estado.comprobante;
    if (!dep || !comprobante || !cuenta) return;
    if (estado.pantalla !== "gano" && estado.pantalla !== "otra") return;
    if (estado.selloDe === comprobante) return;
    estado.corriendoElSello = true;
    let r: "esta" | "no-esta" | null = null;
    try {
      r = await dep({ comprobante, cuenta, contrato: deps.campana.contrato });
    } catch {
      r = null;
    }
    estado.corriendoElSello = false;
    if (desmontado) return;
    if (estado.pantalla !== "gano" && estado.pantalla !== "otra") return;
    // El comprobante pudo cambiar mientras la comprobación andaba: lo que se dice tiene que ser de este.
    if (estado.comprobante !== comprobante) return;
    estado.sello = r;
    estado.selloDe = comprobante;
    pintar();
  }

  /** Qué se le dice a la persona de la comprobación en esta pantalla: nada si el comprobante cambió o no comprobó. */
  function selloComprobado(): "esta" | "no-esta" | null {
    return estado.comprobante !== null && estado.comprobante === estado.selloDe ? estado.sello : null;
  }

  const cancelarVuelta = deps.alVolver(() => {
    if (deps.visible()) void preguntar();
  });
  void iniciar();
  return {
    pintar,
    desmontar: () => {
      desmontado = true;
      limpiarPintura?.();
      cancelarIntervalo?.();
      cancelarVuelta();
      if (temporizadorAlta !== null) window.clearTimeout(temporizadorAlta);
      if (temporizadorRefresco !== null) window.clearTimeout(temporizadorRefresco);
    },
  };
}
