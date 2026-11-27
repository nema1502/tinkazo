/**
 * La página del celular de una campaña, pintada desde un estado, con todo lo de afuera
 * (la sala, Google, el reloj y el almacenamiento) detrás de DepsDelCelular.
 * Así la conexión posterior no toca las pantallas y la demostración anda sin red.
 */

import type { Lang } from "../idioma";
import type { LecturaDelCelular, OrigenDelAviso } from "../stellar/wallet-pollar";
import type { CuentaParaGanar } from "./premio";
import {
  actualizarElContador,
  latirAlDia,
  pintarAdentro,
  pintarGano,
  pintarHola,
  pintarOtra,
  pintarSalio,
  pintarTermino,
} from "./adentro";
import type { TarjetaMontada } from "./confirmar";
import type { Regresiva, Sorteo } from "./empieza";
import { festejar } from "./festejo";
import { fechaTexto, horaTexto } from "./formato";
import { GUARDA_DE_TOQUE_MS, QUIETUD_PARA_CAMBIAR_MS } from "./guarda";
import type { Campana } from "./modelo";
import {
  borrarMemoria,
  guardarMemoria,
  leerMemoria,
  type MemoriaDeCampana,
} from "./memoria";
import { pintarAviso } from "./piezas";
import {
  actualizarElContadorDeLaPrevia,
  COLORES,
  motivoDeEntrada,
  pintarEstadoDeCarga,
  pintarLaCampana,
  segundosDeLimite,
  sustituir,
  type EstadoDeEntrada,
} from "./previa";

export type Fase = "lista" | "abierta" | "cerrada" | "sellada" | "sorteada";
export type MotivoDeSalida = "repetida" | "evento" | "pidio" | "otro";
/**
 * Lo que la sala suma desde que sella la lista. Una sala que no lo manda deja la página como siempre: todo lo de la cuenta
 * regresiva se prende solo si llega la ronda. `horaSala` es la hora de la sala según su cabecera `Date`.
 */
export interface DatosDeLaRonda {
  ronda?: number;
  sorteo?: string;
  horaSala?: number;
}
export interface EstadoPublico extends DatosDeLaRonda {
  fase: Fase;
  total: number;
  cierraMs: number;
  pase: "vale" | "vencido" | "sin";
  /** Si la sala le avisa por correo a quien gana. Una sala que no lo dice cuenta como que no. */
  correo?: boolean;
}
export interface EstadoPropio extends DatosDeLaRonda {
  fase: Fase;
  total: number;
  cierraMs: number;
  anotada: boolean;
  quitada?: MotivoDeSalida;
  gano?: boolean;
  avisado?: boolean;
  /** Solo en una campaña de personas y solo a quien ganó: cuatro cifras que se le muestran a quien organiza para recibir el premio. */
  codigo?: string;
}
export type MotivoDeAlta =
  | "llena"
  | "mucha"
  | "creando"
  | "wifi"
  | "espera"
  | "cuentas"
  | "proveedor"
  /** El servicio de cuentas frenó el ingreso por límite: se dice con la verdad y con cuántos segundos esperar. */
  | "limite"
  | "cerro"
  | "pase"
  | "sesion"
  | "solo-google"
  | "red"
  | "quitada"
  /** Solo en una campaña de personas: la sala todavía no la tiene prendida. Repetir no lo arregla. */
  | "apagada"
  | "otro";
export type ResultadoDelAlta = { ok: true; ya: boolean } | { ok: false; motivo: MotivoDeAlta; segundos?: number };
export type FallaDeEntrada = "ventana" | "cerrada" | "google" | "cuentas" | "limite";
export interface SesionDelCelular {
  cuenta: string;
  nombre: string | null;
}

/**
 * El botón de entrar con Google de una campaña de personas. Se monta en el contenedor que se le da y, cada vez que la persona
 * entra, avisa con su sesión (sin cuenta, solo el nombre). Si Google no baja o no entrega nada, avisa con la falla. Devuelve
 * cómo sacar el botón.
 */
export interface BotonDeGoogle {
  montar: (
    contenedor: HTMLElement,
    alEntrar: (sesion: SesionDelCelular) => void,
    alFallar: (falla: FallaDeEntrada) => void,
    /** La línea que se ve en el lugar del botón mientras Google no lo termina de armar. */
    textoDeEspera?: string,
  ) => () => void;
}

/**
 * Lo que la tarjeta Confirmar mi correo hace con la sesión de esta cuenta. El código se manda siempre al correo de la
 * sesión (no se pasa ningún correo), y solo se confirma el correo y se usa el desbloqueo de este navegador.
 */
export interface AccionesDeLaCuenta {
  /** Si este celular ofrece el desbloqueo (huella, cara o clave). */
  puedeDesbloqueo: () => Promise<boolean>;
  /** Manda el código de un solo uso al correo de la sesión. */
  mandarCodigo: () => Promise<void>;
  /** Confirma el correo con el código. Dice cómo quedó la cuenta con lo que contestó el servicio. */
  confirmarCodigo: (codigo: string) => Promise<LecturaDelCelular>;
  /** Protege la cuenta con el desbloqueo de este celular. Dice si quedó protegida. */
  usarDesbloqueo: () => Promise<boolean>;
  /** Avisa cuando la cuenta pudo cambiar (otra pestaña, la vuelta a esta), diciendo de dónde viene. Devuelve cómo dejar de avisar. */
  alCambiar: (aviso: (origen?: OrigenDelAviso) => void) => () => void;
  /** Cuántos segundos faltan para que el servicio de cuentas acepte pedidos de nuevo, si lo dijo, o null. */
  segundosDeLimite?: () => number | null;
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
  /**
   * Solo en una campaña de personas (anotarse sin billetera): la entrada es el botón de Google del sitio. Al entrar sigue la
   * pantalla Hola de siempre, con el nombre, los pedidos de quien organiza y No soy yo, y la persona se anota con un toque en
   * Acepto. No hay cuenta que leer ni confirmar. Sin esto (todas las demás campañas) la página es la de siempre.
   */
  persona?: { google: BotonDeGoogle };
  /** El nombre de quien entró cuando el perfil llegó después de la sesión, o null. Sin esto el saludo queda como estaba. */
  nombreTardio?: () => Promise<string | null>;
  /**
   * Cómo está la cuenta de este navegador, en una lectura liviana. Sin esto no se lee nada y la página queda como estaba.
   * `confirmar` arma lo que necesita la tarjeta Confirmar mi correo para la cuenta que se le pide: sin esto no hay tarjeta.
   */
  cuenta?: {
    /** Lee cómo está la cuenta de esta página: con otra sesión en el navegador (un celular compartido) no lee ni atribuye nada. */
    leer: (cuenta: string) => Promise<LecturaDelCelular>;
    confirmar?: (cuenta: string) => Promise<AccionesDeLaCuenta>;
    /**
     * Si la sesión de este navegador es de esa cuenta. Quien recarga ya anotada no retoma la sesión del proveedor: se compara al
     * ir a recibir, que es cuando hace falta. Sin esto no se compara y Recibir sigue de largo.
     */
    laSesionEs?: (cuenta: string) => Promise<"si" | "otra" | "no-se-sabe">;
  };
  /** Anotarse. Mientras reintenta solo, avisa con mucha o creando. */
  anotar: (
    nombre: string | null,
    alReintentar: (motivo: "mucha" | "creando") => void,
  ) => Promise<ResultadoDelAlta>;
  /** Lo que la sala sabe de este celular. */
  yo: (conMarcaDeCorreo?: boolean) => Promise<EstadoPropio | "red" | "terminada">;
  /**
   * Solo en una campaña de personas: si este navegador guarda la llave del celular para esta campaña, sin crearla. Con la llave,
   * quien ya se anotó se reconoce aunque no recuerde nada y no tenga sesión.
   */
  llaveGuardada?: () => boolean;
  /**
   * Si la sala acepta la marca de correo confirmado. Con esto en true, la consulta propia lleva `conMarcaDeCorreo` una vez por
   * carga, cuando la lectura de la cuenta dice que el correo de la sesión está confirmado, y enseguida después de confirmar. Sin
   * esto (apagado) la página no manda nada nuevo ni hace ninguna consulta de más.
   */
  marcaDeCorreo?: boolean;
  /**
   * Si la ventana rápida del resultado está encendida (`ventana-rapida.ts`). Con la ventana, la lista sellada y la ronda a la
   * vista, la página mira el resultado cada pocos segundos. Sin esto (apagado) sigue con la consulta propia de siempre.
   */
  ventanaRapida?: boolean;
  /** Un número al azar entre 0 y 1: reparte el primer pedido de cada tramo del resultado entre los celulares. Sin esto, `Math.random`. */
  azar?: () => number;
  /** Las cuentas elegidas y el enlace al comprobante, o null si todavía no hay resultado. */
  resultado: () => Promise<{ ganadoras: string[]; comprobante: string | null } | null | "red">;
  /** Lleva a recibir el premio. */
  recibir: () => void;
  /** El enlace entero de Recibir mi premio, para llevarlo a otro navegador. Sin esto no se ofrece mandarlo. */
  enlaceDelPremio?: () => string;
  /** Abre el menú de compartir del navegador con un enlace. Donde no hay menú, null o ausente: queda copiar. */
  compartir?: ((enlace: string) => Promise<void>) | null;
  /**
   * Suelta la sesión del proveedor sin cerrarla: ya anotada, la espera no la necesita. Se vuelve a armar sola cuando algo la
   * pide (la lectura de la cuenta, la tarjeta de confirmar el correo, el token). Sin esto no se suelta nada.
   */
  soltarSesion?: () => void;
  /** Cierra la sesión de Google. */
  salir: () => Promise<void>;
  /** El costo de retirar, ya escrito para mostrar, o null si no hay costo. */
  costoDelRetiro: () => string | null;
  enlace: () => string;
  /**
   * Repite `f` cada `ms`. Quien conecta la página le suma un azar de 20 % al intervalo para que 150 celulares no pidan en el
   * mismo segundo, y estira el de 15 segundos a 30. Con `azar` solo suma el azar (las consultas del resultado traen su propio
   * ritmo) y con `exacta` no hace ninguna de las dos cosas (el reloj de la cuenta regresiva late cada segundo).
   */
  cada: (f: () => void, ms: number, modo?: "azar" | "exacta") => () => void;
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
  | "llena"
  /** Solo en una campaña de personas: la sala todavía no tiene el modo prendido y repetir el pedido no lo arregla. */
  | "apagada";

interface EstadoInterno {
  pantalla: Pantalla;
  publico: EstadoPublico | null;
  propio: EstadoPropio | null;
  sesion: SesionDelCelular | null;
  memoria: MemoriaDeCampana | null;
  errorAlta: MotivoDeAlta | null;
  /** Hasta cuándo dura el límite del servicio de cuentas que frenó la alta, en el reloj de la página. */
  limiteHasta: number | null;
  ya: boolean;
  anotando: boolean;
  tardando: boolean;
  comprobante: string | null;
  avisado: boolean;
  motivoSalida: MotivoDeSalida;
  /** El último código de entrega que dio la sala: se conserva si una consulta siguiente no lo trae. */
  codigo: string | null;
  festejoGrandeHecho: boolean;
}

/** El festejo chico dura menos de un segundo: repintar antes lo borraría. */
const ESPERA_DEL_REFRESCO_MS = 1000;

/**
 * Cuando todavía no se sabe cómo está la cuenta (se está creando, o no hubo respuesta), se vuelve a leer a los 5, 10, 20 y
 * 40 segundos y después cada 60, como mucho 12 veces y solo con la pestaña a la vista. Nunca en bucle: cada lectura cuenta
 * en el cupo del servicio de cuentas, y 150 celulares comparten la misma conexión.
 */
export const ESPERAS_DE_LA_LECTURA_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000, ...Array.from({ length: 8 }, () => 60_000)];
/** Si el servicio de cuentas frenó el pedido por límite, la próxima lectura espera al menos esto. */
export const ESPERA_TRAS_LIMITE_MS = 30_000;
/**
 * Solo en una campaña de personas: cuántas veces seguidas puede quedar sin respuesta la consulta propia de quien se reconoce
 * por la llave de su celular antes de pintar la pantalla pública. Las repeticiones van con el ritmo de las consultas de siempre,
 * nunca más seguido, y agotadas queda Probar de nuevo: con 150 celulares en la misma conexión, una consulta perdida es esperable.
 */
export const INTENTOS_POR_LA_LLAVE = 4;

/**
 * Qué línea de apoyo lleva la espera: la de siempre (seguir en este navegador), la de quien no tiene nada que hacer con su
 * cuenta o la de una cuenta que ya se usó en otro navegador.
 */
type LineaDeAdentro = "deja-abierta" | "libre" | "otro-lado" | "con-tarjeta";

/** Entre dos lecturas pedidas por un aviso de cambio pasa al menos esto: el canal y la vuelta a la pestaña suelen avisar juntos. */
const ENTRE_RELECTURAS_MS = 3_000;
/**
 * Lo más que Recibir espera a la comparación de la sesión con la cuenta. La comparación corta sola a los 2,5 segundos y espera
 * hasta 12 una renovación del token en vuelo (`sesion-confirmar.ts`): esto solo destraba el botón si algo colgara antes.
 */
export const TOPE_DE_RECIBIR_MS = 15_000;

/** La cuenta que ya se avisó (o aceptó) en esta pestaña, por sala: solo la dirección pública. Así el aviso no se repite. */
const claveDeAvisada = (sala: string): string => `tinkazo.cmp.otrolado.${sala}`;

function leerAvisada(sala: string): string | null {
  try {
    return sessionStorage.getItem(claveDeAvisada(sala));
  } catch {
    return null;
  }
}

function guardarAvisada(sala: string, cuenta: string): void {
  try {
    sessionStorage.setItem(claveDeAvisada(sala), cuenta);
  } catch {
    /* sin almacenamiento el aviso puede repetirse: no cambia nada más */
  }
}

/** El almacenamiento de esta pestaña, o null si el navegador lo bloquea. */
function leerAlmacenDePestana(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

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
    limiteHasta: null,
    ya: false,
    anotando: false,
    tardando: false,
    comprobante: null,
    avisado: false,
    motivoSalida: "otro",
    codigo: null,
    festejoGrandeHecho: false,
  };
  let desmontado = false;
  let consultando = false;
  /**
   * Cambia cada vez que la pantalla pasa a ser otra y cuando la página olvida a la persona. Cada pedido a la sala anota la de su
   * salida: si al volver ya es otra (la persona se anotó, tocó No soy yo o la pantalla cambió), la respuesta es vieja y se descarta.
   */
  let generacion = 0;
  /** Se llama al salir un pedido a la sala. Lo que devuelve dice, al llegar la respuesta, si todavía vale para esta pantalla. */
  const alSalir = (): (() => boolean) => {
    const salio = generacion;
    return () => !desmontado && salio === generacion;
  };
  /** Solo personas: cuántas veces seguidas quedó sin respuesta la consulta propia por la llave de este celular. */
  let sinRespuesta = 0;
  /** Solo personas: la sala terminó con Ganaste a la vista. La pantalla sigue siendo esa, con el código que la página ya tenía. */
  let ganabaAlTerminar = false;
  /** La línea del límite del servicio de cuentas, bajada solo si hizo falta. */
  let limite: typeof import("./limite") | null = null;
  let cancelarIntervalo: (() => void) | null = null;
  let temporizadorAlta: number | null = null;
  let temporizadorRefresco: number | null = null;
  let limpiarPintura: (() => void) | null = null;
  /** Lo último que se pintó en la espera: con eso se sabe si una respuesta nueva cambia algo o solo confirma lo mismo. */
  let pintadoAdentro: { fase: Fase; total: number; cierraMs: number; ya: boolean; clave: string } | null = null;
  /** La línea de fase cambió con la pantalla abierta: la próxima vez que se pinte la espera, salta una vez. */
  let saltarLaFase = false;
  /** Cuándo la sala contestó bien por última vez, y cuándo esta pestaña volvió a verse. La señal de conexión usa el más nuevo. */
  let ultimaRespuesta = deps.ahora();
  let ultimaVuelta = ultimaRespuesta;
  const respuestaDesde = (): number => Math.max(ultimaRespuesta, ultimaVuelta);
  /** La sala contestó bien: la señal late y no se repinta nada. */
  const huboRespuesta = (): void => {
    ultimaRespuesta = deps.ahora();
    latirAlDia(raiz, deps);
  };
  /** La entrada con Google vive acá y no en la pantalla: pintar de nuevo no puede perder el botón ni el error. */
  const entrada: EstadoDeEntrada = { desde: null, falla: null };
  const depsDeLaPrevia: DepsDelCelular = {
    ...deps,
    entrar: () => {
      entrada.desde = deps.ahora();
      entrada.falla = null;
      entrada.libreHasta = null;
      return deps.entrar().then(
        (sesion) => {
          entrada.desde = null;
          return sesion;
        },
        (error: unknown) => {
          entrada.desde = null;
          entrada.falla = motivoDeEntrada(error);
          entrada.libreHasta = entrada.falla === "limite" ? deps.ahora() + segundosDeLimite(error) * 1000 : null;
          // La pantalla que tocó la persona pudo cambiarse mientras tanto: la nueva muestra el error.
          if (!desmontado && estado.pantalla === "previa") pintar();
          throw error;
        },
      );
    },
  };

  /* ------------------------------------------------ cómo está la cuenta (una lectura liviana, nunca en bucle) */

  /** Lo que se sabe de la cuenta de esta sesión. `vuelta` cambia al cerrar sesión: una lectura que vuelve tarde no cuenta. */
  const lectura: {
    cuenta: string | null;
    datos: LecturaDelCelular | null;
    leyendo: boolean;
    reintentos: number;
    reloj: number | null;
    /** El reloj sonó con la pestaña escondida: se lee al volver, una vez. */
    escondida: boolean;
    vuelta: number;
  } = { cuenta: null, datos: null, leyendo: false, reintentos: 0, reloj: null, escondida: false, vuelta: 0 };
  /**
   * La cuenta de esta página: la de la sesión o, sin sesión (quien ya estaba anotada y recarga no retoma la del proveedor),
   * la que recuerda este navegador.
   */
  const cuentaDeLaPagina = (): string | null => estado.sesion?.cuenta ?? estado.memoria?.cuenta ?? null;
  /** Lo que dice la lectura de la cuenta de esta página, o null si no hay lectura o es de otra cuenta. */
  const lecturaVigente = (): LecturaDelCelular | null =>
    lectura.cuenta !== null && lectura.cuenta === cuentaDeLaPagina() ? lectura.datos : null;
  const seSabeLaCuenta = (): boolean => {
    const dicho = lectura.datos?.estado;
    return dicho !== undefined && dicho !== "naciendo" && dicho !== "no-se-sabe";
  };
  /* ------------------------------------------------ Ganaste según la cuenta (se baja solo si la cuenta lo pide) */

  let premio: typeof import("./premio") | null = null;
  let cargandoElPremio = false;

  /** Lo que Ganaste sabe de la cuenta de este navegador, o null si no se sabe. */
  const cuentaParaGanar = (): CuentaParaGanar | null => {
    const dicho = lecturaVigente();
    return dicho ? { estado: dicho.estado, protegida: dicho.protegida } : null;
  };

  /**
   * Baja lo que Ganaste necesita para decir lo que corresponde, apenas se sabe que la cuenta lo pide: así, al llegar el
   * resultado, ya está. Con la cuenta sin protección o sin saberse, la línea de siempre alcanza y no se baja nada.
   */
  function prepararElPremio(): void {
    const dicho = lecturaVigente();
    const quiere = dicho !== null && dicho.estado !== "naciendo" && dicho.estado !== "no-se-sabe" && !(dicho.estado === "falta" && !dicho.protegida);
    // Solo quien ya está adentro puede llegar a Ganaste: antes no se baja nada.
    const adentro = estado.pantalla === "adentro" || estado.pantalla === "gano";
    if (premio !== null || cargandoElPremio || !quiere || !adentro) return;
    cargandoElPremio = true;
    import("./premio").then((modulo) => {
      premio = modulo;
      cargandoElPremio = false;
      if (!desmontado && estado.pantalla === "gano") pintar();
    }, () => {
      // Sin red para bajarlo queda la línea de siempre, que es verdad en cualquier caso.
      cargandoElPremio = false;
    });
  }

  /* ------------------------------------------------ la tarjeta Confirmar mi correo (se baja solo si hace falta) */

  let tarjeta: TarjetaMontada | null = null;
  let cargandoLaTarjeta = false;
  /** Con la tarjeta a la vista la espera no pone su línea de apoyo. */
  let conTarjeta = false;
  /** La tarjeta se fue en esta carga porque el servicio no está para eso: no se vuelve a armar. */
  let tarjetaApagada = false;
  let ultimaRelectura = Number.NEGATIVE_INFINITY;

  const soltarElRelojDeLaLectura = (): void => {
    if (lectura.reloj !== null) window.clearTimeout(lectura.reloj);
    lectura.reloj = null;
    lectura.escondida = false;
  };

  /**
   * La línea de la espera según lo que se sabe de la cuenta. Sin lectura, la de siempre (que pide seguir en este navegador).
   * Con la tarjeta Confirmar mi correo a la vista, la línea es la de la tarjeta y la espera no pone la suya.
   */
  const lineaDeAdentro = (): LineaDeAdentro => {
    if (conTarjeta) return "con-tarjeta";
    const dicho = lecturaVigente()?.estado;
    if (dicho === "sin-forma") return "otro-lado";
    if (dicho === "lista" || dicho === "otro-con-correo" || dicho === "otro-con-desbloqueo") return "libre";
    return "deja-abierta";
  };

  /** La lectura cambió lo que se dice: Hola pone su aviso si hace falta, y la espera se repinta solo si su línea es otra. */
  function alCambiarLaLectura(): void {
    if (desmontado) return;
    const vigente = lecturaVigente();
    if (vigente) tarjeta?.alLeer(vigente);
    ajustarLaTarjeta();
    prepararElPremio();
    if (estado.pantalla === "hola") {
      ajustarElAviso();
      pintar();
    } else if (estado.pantalla === "adentro" && pintadoAdentro !== null && pintadoAdentro.clave !== claveDeAdentro()) {
      pintar();
    } else if (estado.pantalla === "gano") {
      // Quien ganó y la cuenta recién se leyó: Ganaste dice lo que corresponde.
      pintar();
    }
    // Agotadas las lecturas, o sabida la cuenta, ya no hace falta el proveedor aunque la pantalla no haya cambiado.
    ajustarElProveedor();
  }

  /** La tarjeta se arma solo con la cuenta en falta (este navegador es de ella y el correo no se confirmó) y con cómo mandar el código. */
  const quiereLaTarjeta = (): boolean => {
    const dicho = lecturaVigente();
    return estado.pantalla === "adentro" && !tarjetaApagada && !!deps.cuenta?.confirmar && dicho?.estado === "falta" && dicho.puedeMandar;
  };

  /** Saca la tarjeta. `olvidar`: se cerró la sesión y el código mandado ya no cuenta. */
  function soltarLaTarjeta(olvidar: boolean): void {
    tarjeta?.destruir(olvidar);
    tarjeta = null;
    conTarjeta = false;
    raiz.classList.remove("cmp-con-tarjeta", "cmp-tarjeta-enlace");
  }

  /**
   * Pide leer la cuenta de nuevo. Una ráfaga de avisos (el canal y la vuelta a la pestaña juntos) cuenta como uno. Volver a la
   * pestaña o volver la conexión con la tarjeta quieta no lee: casi nunca cambia la cuenta, y leer es volver a armar la sesión
   * del proveedor en 150 celulares que vuelven juntos. Lo que avisa otra pestaña o el kit sí lee, y con un código o un
   * desbloqueo en juego, también.
   */
  function releer(origen?: OrigenDelAviso): void {
    const ahora = deps.ahora();
    if (desmontado || lectura.cuenta === null || lectura.leyendo || ahora - ultimaRelectura < ENTRE_RELECTURAS_MS) return;
    if (origen === "vista" && tarjeta?.enCurso() !== true) return;
    ultimaRelectura = ahora;
    void leerLaCuenta();
  }

  function releerEn(ms: number): void {
    if (desmontado || lectura.cuenta === null) return;
    soltarElRelojDeLaLectura();
    lectura.reloj = window.setTimeout(() => {
      lectura.reloj = null;
      if (deps.visible()) void leerLaCuenta();
      else lectura.escondida = true;
    }, ms);
  }

  async function montarLaTarjeta(): Promise<void> {
    const confirmar = deps.cuenta?.confirmar;
    const cuenta = cuentaDeLaPagina();
    const seccion = raiz.querySelector<HTMLElement>("#cmp-cuenta");
    if (!confirmar || !cuenta || !seccion) return;
    cargandoLaTarjeta = true;
    let modulo: typeof import("./confirmar");
    let acciones: AccionesDeLaCuenta;
    try {
      [modulo, acciones] = await Promise.all([import("./confirmar"), confirmar(cuenta)]);
    } catch {
      // Sin red para bajarla la espera sigue como estaba: no hay nada que decir ni que repetir.
      cargandoLaTarjeta = false;
      return;
    }
    cargandoLaTarjeta = false;
    const dicho = lecturaVigente();
    if (desmontado || cuentaDeLaPagina() !== cuenta || !quiereLaTarjeta() || !dicho) return;
    tarjeta = modulo.montarTarjeta(seccion, raiz, dicho, {
      txPagina: deps.tx,
      idioma: deps.idioma,
      ahora: deps.ahora,
      cada: deps.cada,
      visible: deps.visible,
      enLinea: () => typeof navigator === "undefined" || navigator.onLine !== false,
      marca: leerAlmacenDePestana(),
      acciones,
      alIrse: (motivo) => {
        soltarLaTarjeta(false);
        if (motivo === "naciendo" && lectura.datos) lectura.datos = { ...lectura.datos, estado: "naciendo" };
        if (motivo === "no-hace-falta") tarjetaApagada = true;
        if (!desmontado) pintar();
      },
      alConfirmar: (nueva) => {
        if (lectura.cuenta !== cuenta) return;
        lectura.datos = nueva;
        recordarLaCuenta();
        // Recién confirmado: la marca sale enseguida, sin esperar a la consulta siguiente.
        if (marcaPendiente && nueva.correoDeLaSesionConfirmado) void consultarPropio();
      },
      releerEn,
      releer,
      // Con la lista sellada, empezar a confirmar (o terminar) cambia quién manda: la cuenta regresiva o la tarjeta.
      alCambiarElCurso: () => {
        if (desmontado || tarjeta === null) return;
        // Una confirmación en curso arma de nuevo el cliente del proveedor (cada acción de la tarjeta lo hace) y lo necesita
        // hasta terminar: al terminar se vuelve a soltar.
        if (tarjeta.enCurso()) proveedorSuelto = false;
        else ajustarElProveedor();
        if (pintadoAdentro !== null && pintadoAdentro.clave !== claveDeAdentro()) pintar();
      },
    });
    conTarjeta = true;
    // La espera se repinta sin su línea de apoyo: la dice la tarjeta.
    pintar();
  }

  /** La tarjeta aparece en la espera cuando hace falta y se va en cuanto la pantalla es otra. */
  function ajustarLaTarjeta(): void {
    if (desmontado) return;
    if (estado.pantalla !== "adentro") {
      soltarLaTarjeta(false);
      return;
    }
    if (tarjeta || cargandoLaTarjeta || !quiereLaTarjeta()) return;
    void montarLaTarjeta();
  }

  /* ------------------------------------------------ la cuenta regresiva y el resultado a tiempo (se baja si la sala dice la ronda) */

  /** La cuenta, su pantalla y el ritmo de las consultas, bajados cuando la lista está sellada y la sala dice la ronda. */
  let sorteo: Sorteo | null = null;
  let cargandoElSorteo = false;
  let relojDeTramo: number | null = null;
  /** La última respuesta con la ronda mientras se baja lo anterior, y cuándo llegó. */
  let conRonda: { datos: DatosDeLaRonda; recibida: number } | null = null;

  /** Con la lista sellada y la ronda a la vista, la cuenta regresiva es la pantalla; con un código en juego baja a un rótulo. */
  const regresiva = (): Regresiva => sorteo?.modo() ?? "no";

  /** Lo que identifica lo que muestra la espera: si cambia hay que repintarla, y si no, no. */
  const claveDeAdentro = (): string => {
    const modo = regresiva();
    // Con la cuenta regresiva, lo único de la cuenta que cambia lo que se ve es el aviso de otro navegador.
    return modo === "no" ? `espera:${lineaDeAdentro()}` : `regresiva:${modo}:${lineaDeAdentro() === "otro-lado" ? "otro-lado" : "-"}`;
  };

  /**
   * La tarjeta y la cuenta regresiva se reparten la espera. Con la lista sellada y sin un código en juego manda la cuenta y la
   * tarjeta pasa a un enlace de texto debajo. En cualquier otro caso, la tarjeta es lo principal y la espera se achica.
   */
  function marcarElModo(): void {
    const enlace = tarjeta !== null && regresiva() === "grande";
    raiz.classList.toggle("cmp-con-tarjeta", tarjeta !== null && !enlace);
    raiz.classList.toggle("cmp-tarjeta-enlace", enlace);
  }

  /**
   * La sala dijo la ronda: se anota (con la hora de la sala, para saber cuánto adelanta o atrasa este reloj) y se baja lo que
   * hace falta. Una sala que no la dice no cambia nada.
   */
  function anotarLaRonda(datos: DatosDeLaRonda & { fase: Fase }): void {
    if (datos.ronda === undefined || datos.fase !== "sellada") return;
    const recibida = deps.ahora();
    if (sorteo !== null) {
      sorteo.anotar(datos, recibida);
      return;
    }
    conRonda = { datos, recibida };
    if (cargandoElSorteo) return;
    cargandoElSorteo = true;
    import("./empieza").then((modulo) => {
      cargandoElSorteo = false;
      if (desmontado) return;
      sorteo = modulo.crearSorteo(deps, {
        enLaEspera: () => estado.pantalla === "adentro" && (estado.propio ?? estado.publico)?.fase === "sellada",
        hayCodigo: () => tarjeta?.enCurso() === true,
      });
      if (conRonda) sorteo.anotar(conRonda.datos, conRonda.recibida);
      pintar();
      programar();
    }, () => {
      // Sin red para bajarlo queda la espera de siempre, que es verdad en cualquier caso.
      cargandoElSorteo = false;
    });
  }

  /**
   * Cuándo consulta la página. Lo de siempre (la consulta propia cada 24 a 36 segundos, y cada 60 con el resultado), salvo con
   * la lista sellada y la hora de la sala conocida: ahí, desde que el show puede haber terminado, mira el resultado cada pocos
   * segundos. Se vuelve a decidir en cada cambio de pantalla y en cada cambio de tramo.
   */
  function programar(): void {
    cancelarIntervalo?.();
    cancelarIntervalo = null;
    if (relojDeTramo !== null) window.clearTimeout(relojDeTramo);
    relojDeTramo = null;
    if (desmontado) return;
    const consulta = sorteo?.consulta() ?? null;
    const rapido = consulta !== null && consulta.cadaMs !== null;
    const ms = rapido ? consulta.cadaMs : intervaloDe(estado.pantalla);
    if (ms !== null) {
      const alPasar = (): void => {
        if (deps.visible()) void (rapido ? preguntarResultado() : preguntar());
      };
      // En la ventana del resultado el primer pedido se reparte al azar (lo hace `sorteo.repartir`, que se baja con la cuenta
      // regresiva): todos los celulares cambian de tramo en el mismo instante.
      cancelarIntervalo = rapido && sorteo !== null ? sorteo.repartir(alPasar, ms) : deps.cada(alPasar, ms);
    }
    if (consulta?.cambiaEn != null) {
      relojDeTramo = window.setTimeout(() => {
        relojDeTramo = null;
        programar();
      }, consulta.cambiaEn + 1);
    }
  }

  /** En la ventana del resultado: se pregunta solo por el resultado, que la sala da apenas la pantalla grande coronó. */
  async function preguntarResultado(): Promise<void> {
    if (desmontado || consultando || !deps.visible() || estado.pantalla !== "adentro") return;
    consultando = true;
    try {
      const vale = alSalir();
      const resultado = await pedirResultado();
      if (!vale() || resultado === "red") return;
      huboRespuesta();
      // En una campaña de personas la lista de elegidas no dice si esta persona ganó (son líneas, no cuentas): solo lo sabe la
      // sala por la llave de este celular. Se le pregunta a ella, y no se concluye nada de la lista.
      if (resultado !== null) await (deps.persona ? consultarPropio() : aplicarResultado(resultado, null));
    } finally {
      consultando = false;
    }
  }

  /* ------------------------------------------------ el proveedor de cuentas: después de anotarse, ni un pedido más */

  let proveedorSuelto = false;

  /**
   * Con la persona ya anotada, la espera no necesita la sesión del proveedor (la consulta propia va a la sala con la cuenta y
   * la llave del celular): se suelta el cliente y dejan de correr sus relojes y de salir pedidos. No se suelta mientras la
   * tarjeta de confirmar el correo esté EN USO (un código mandado, uno escrito, un desbloqueo en curso o el Listo), ni mientras
   * una lectura de la cuenta esté en curso o por repetirse. La tarjeta a la vista pero quieta no lo retiene: casi toda cuenta
   * nueva la tiene así toda la espera, y cada acción de la tarjeta vuelve a armar la sesión sola. Lo vuelve a armar quien lo
   * pida (la lectura al llegar a Ganaste, la tarjeta al tocarla, el token).
   */
  function ajustarElProveedor(): void {
    if (desmontado || proveedorSuelto || !deps.soltarSesion) return;
    const anotada = estado.pantalla === "adentro" || estado.pantalla === "gano" || estado.pantalla === "otra";
    if (!anotada || tarjeta?.enCurso() === true) return;
    if (lectura.leyendo || lectura.reloj !== null || lectura.escondida) return;
    proveedorSuelto = true;
    deps.soltarSesion();
  }

  /**
   * Lo que se sabe de la cuenta se recuerda en esta pestaña (`recordada.ts`, que se baja recién entonces): al recargar no hace
   * falta preguntarle de nuevo al proveedor. Sin saber la cuenta, o sin cuenta (cerrar sesión), se olvida lo recordado.
   */
  function recordarLaCuenta(): void {
    const almacen = leerAlmacenDePestana();
    if (!almacen) return;
    const cuenta = lectura.cuenta;
    const datos = seSabeLaCuenta() ? lectura.datos : null;
    import("./recordada").then((m) => m.recordarLaCuenta(almacen, deps.sala, cuenta, datos), () => undefined);
  }

  async function leerLaCuenta(): Promise<void> {
    const cuenta = lectura.cuenta;
    if (desmontado || !deps.cuenta || cuenta === null || lectura.leyendo) return;
    // Leer es hablar con el proveedor: si se había soltado, esta lectura lo vuelve a armar y después se suelta de nuevo.
    proveedorSuelto = false;
    const vuelta = lectura.vuelta;
    soltarElRelojDeLaLectura();
    lectura.leyendo = true;
    let leida: LecturaDelCelular | null;
    try {
      leida = await deps.cuenta.leer(cuenta);
    } catch {
      leida = null;
    }
    if (desmontado || vuelta !== lectura.vuelta) return;
    lectura.leyendo = false;
    lectura.datos = leida;
    recordarLaCuenta();
    if (!seSabeLaCuenta() && lectura.reintentos < ESPERAS_DE_LA_LECTURA_MS.length) {
      const espera = Math.max(ESPERAS_DE_LA_LECTURA_MS[lectura.reintentos] ?? 0, leida?.limite ? ESPERA_TRAS_LIMITE_MS : 0);
      lectura.reintentos += 1;
      lectura.reloj = window.setTimeout(() => {
        lectura.reloj = null;
        if (deps.visible()) void leerLaCuenta();
        else lectura.escondida = true;
      }, espera);
    }
    alCambiarLaLectura();
  }

  /** Una lectura por sesión: se arranca apenas se sabe quién es, sin esperarla para pintar ni para anotarse. */
  function arrancarLaLectura(cuenta: string): void {
    if (!deps.cuenta || lectura.cuenta === cuenta) return;
    reiniciarLaLectura();
    lectura.cuenta = cuenta;
    void leerLaCuenta();
  }

  /**
   * Quien ya estaba anotada y recarga no retoma la sesión del proveedor: se queda con lo que esta pestaña recordaba de su
   * cuenta (si lo recordaba) y no lee nada. Se lee cuando haga falta: al llegar a Ganaste, o con la tarjeta.
   */
  async function usarLaLecturaRecordada(cuenta: string): Promise<void> {
    if (!deps.cuenta || lectura.cuenta === cuenta) return;
    reiniciarLaLectura();
    lectura.cuenta = cuenta;
    const almacen = leerAlmacenDePestana();
    const m = almacen ? await import("./recordada").catch(() => null) : null;
    if (desmontado || lectura.cuenta !== cuenta) return;
    lectura.datos = m && almacen ? m.cuentaRecordada(almacen, deps.sala, cuenta) : null;
  }

  function reiniciarLaLectura(): void {
    soltarElRelojDeLaLectura();
    lectura.cuenta = null;
    lectura.datos = null;
    lectura.leyendo = false;
    lectura.reintentos = 0;
    lectura.vuelta += 1;
  }

  /* ------------------------------------------------ el aviso de la cuenta usada en otro navegador (en Hola) */

  /** Cuándo el botón principal de Hola pasó a ser Usar otra cuenta: un toque justo después no cuenta. */
  const aviso: { principal: boolean; desde: number; reloj: number | null } = { principal: false, desde: 0, reloj: null };
  /** Cuándo fue el último toque en la página: el botón no cambia de acción bajo un dedo que está tocando. */
  let ultimoToque: number | null = null;
  const alTocar = (): void => {
    ultimoToque = deps.ahora();
  };
  raiz.addEventListener("pointerdown", alTocar, true);

  /** La cuenta se usó en otro navegador y desde acá no hay forma de entrar: se avisa antes de anotarse, una sola vez. */
  const hayAvisoDeOtroLado = (): boolean =>
    !estado.anotando && estado.sesion !== null && lecturaVigente()?.estado === "sin-forma" && leerAvisada(deps.sala) !== estado.sesion.cuenta;

  const soltarElRelojDelAviso = (): void => {
    if (aviso.reloj !== null) window.clearTimeout(aviso.reloj);
    aviso.reloj = null;
  };

  /**
   * Decide si el botón principal ya puede cambiar a Usar otra cuenta: solo si nadie tocó la pantalla en los últimos 1,5
   * segundos. Si hubo un toque reciente, vuelve a mirar cuando se cumpla la quietud. No pinta: quien llama pinta.
   */
  function ajustarElAviso(): void {
    if (!hayAvisoDeOtroLado()) {
      aviso.principal = false;
      soltarElRelojDelAviso();
      return;
    }
    if (aviso.principal || aviso.reloj !== null) return;
    const falta = ultimoToque === null ? 0 : ultimoToque + QUIETUD_PARA_CAMBIAR_MS - deps.ahora();
    if (falta <= 0) {
      aviso.principal = true;
      aviso.desde = deps.ahora();
      return;
    }
    aviso.reloj = window.setTimeout(() => {
      aviso.reloj = null;
      if (desmontado) return;
      ajustarElAviso();
      if (aviso.principal && estado.pantalla === "hola") pintar();
    }, falta);
  }

  /** Un toque en un botón que acaba de cambiar no cuenta. */
  const toqueValido = (): boolean => !aviso.principal || deps.ahora() - aviso.desde >= GUARDA_DE_TOQUE_MS;

  /** Con el aviso a la vista, tanto cambiar de cuenta como anotarse igual dejan dicho que ya se avisó. */
  const recordarElAviso = (): void => {
    if (hayAvisoDeOtroLado() && estado.sesion) guardarAvisada(deps.sala, estado.sesion.cuenta);
  };

  const secciones = (): HTMLElement[] => ["#cmp-estado", "#cmp-saber", "#cmp-hola", "#cmp-adentro", "#cmp-pie"]
    .map((selector) => raiz.querySelector<HTMLElement>(selector))
    .filter((elemento): elemento is HTMLElement => elemento !== null);

  const ocultar = (): void => {
    for (const seccion of secciones()) seccion.hidden = true;
  };

  const avisoPublico = (texto: string, comprobante: string | null = null, conHoraDelSorteo = false): void => {
    const seccion = raiz.querySelector<HTMLElement>("#cmp-estado");
    if (!seccion) return;
    // Solo personas: la consulta propia por la llave de este celular quedó sin respuesta, y el botón vuelve a consultar.
    const accion = sinRespuesta > 0 && (estado.pantalla === "cerrada" || estado.pantalla === "sorteada")
      ? { texto: deps.tx("cpProbarDeNuevo"), alHacer: () => void preguntar() }
      : comprobante ? { texto: deps.tx("cpComoSeEligio"), enlace: comprobante } : null;
    // Un aviso a pantalla completa dice de quién es el sorteo, y cuándo es si ayuda a quien espera.
    const rotulos = [sustituir(deps.tx("cpTitulo"), { empresa: deps.campana.empresa.nombre })];
    if (conHoraDelSorteo) {
      const hora = horaTexto(deps.campana.sorteoMs, deps.campana.zona, deps.idioma());
      rotulos.push(sustituir(deps.tx("cpSorteoA"), { hora }));
    }
    pintarAviso(seccion, texto, accion, false, rotulos);
  };

  /** Solo en una campaña de personas: No soy yo sale de la sesión y olvida lo que este celular recordaba de la persona. */
  const olvidar = deps.persona ? () => void salir() : undefined;

  const intervaloDe = (pantalla: Pantalla): number | null => {
    if (pantalla === "previa" || pantalla === "hola" || pantalla === "adentro") return 15_000;
    // Ganaste, en una campaña de personas, sigue pidiendo el código mientras no llega: quien recargó no queda sin él.
    if (pantalla === "gano") return deps.persona && estado.codigo === null ? 15_000 : 60_000;
    if (pantalla === "otra") return 60_000;
    // Solo personas: antes de la primera pantalla, la consulta propia por la llave que quedó sin respuesta se repite a este ritmo.
    return pantalla === "inicial" && sinRespuesta > 0 ? 15_000 : null;
  };

  const pintar = (): void => {
    // Mientras se repite la consulta por la llave todavía no hay pantalla propia: queda a la vista la espera de la carga.
    if (desmontado || (estado.pantalla === "inicial" && sinRespuesta > 0)) return;
    pintarLaPantalla();
    // Después de cada pintura: la tarjeta repinta sus textos (cambió el idioma) o aparece o se va según la pantalla.
    tarjeta?.pintar();
    marcarElModo();
    ajustarLaTarjeta();
    ajustarElProveedor();
    sorteo?.pantalla();
  };

  const pintarLaPantalla = (): void => {
    limpiarPintura?.();
    limpiarPintura = null;
    ocultar();
    if (estado.pantalla === "previa" && estado.publico) {
      limpiarPintura = pintarLaCampana(raiz, depsDeLaPrevia, estado.publico, (sesion) => {
        estado.sesion = sesion;
        estado.errorAlta = null;
        arrancarLaLectura(sesion.cuenta);
        ir("hola");
      }, entrada);
      return;
    }
    if (estado.pantalla === "hola") {
      // El límite del servicio de cuentas se dice mientras dura, con lo que falta: pasado, el botón vuelve a probar.
      const limiteS = estado.errorAlta === "limite" && estado.limiteHasta !== null
        ? Math.ceil((estado.limiteHasta - deps.ahora()) / 1000)
        : 0;
      pintarHola(raiz, deps, {
        nombre: estado.sesion?.nombre ?? null,
        error: estado.errorAlta === "limite" && limiteS <= 0 ? null : estado.errorAlta,
        ...(limite && limiteS > 0 ? { textoDelLimite: limite.textoDeLimite(deps.idioma(), limiteS) } : {}),
        otroLado: hayAvisoDeOtroLado() ? { principal: aviso.principal } : null,
      }, {
        alAnotar: () => {
          if (toqueValido()) void anotarse();
        },
        alAnotarIgual: () => {
          if (!toqueValido()) return;
          recordarElAviso();
          void anotarse();
        },
        alSalir: () => {
          if (!toqueValido()) return;
          recordarElAviso();
          void salir();
        },
        anotando: estado.anotando,
        tardando: estado.tardando,
      });
      return;
    }
    if (estado.pantalla === "adentro") {
      const datos = estado.propio ?? estado.publico;
      if (datos) {
        const linea = lineaDeAdentro();
        const modo = regresiva();
        const pintado = { ya: estado.ya, total: datos.total, fase: datos.fase, cierraMs: datos.cierraMs, clave: claveDeAdentro() };
        if (modo !== "no" && sorteo !== null) {
          // La lista está sellada y la sala dijo la ronda: El sorteo está por empezar, con la cuenta regresiva.
          limpiarPintura = sorteo.pintar(raiz, tarjeta !== null, linea === "otro-lado");
        } else {
          limpiarPintura = pintarAdentro(raiz, deps, {
            ...pintado,
            libre: linea === "libre",
            otroLado: linea === "otro-lado",
            conTarjeta: linea === "con-tarjeta",
            salta: saltarLaFase,
            respuestaDesde,
            // Solo con la lista abierta: después del cierre la sala no deja volver a entrar y el código no se recuperaría.
            alOlvidar: datos.fase === "abierta" ? olvidar : undefined,
          });
        }
        pintadoAdentro = pintado;
      }
      saltarLaFase = false;
      return;
    }
    if (estado.pantalla === "gano") {
      pintarGano(raiz, depsDeRecibir, {
        avisado: estado.avisado,
        comprobante: estado.comprobante,
        variante: premio?.varianteDeGanaste(deps, cuentaParaGanar()) ?? null,
        codigo: estado.codigo,
      });
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
      pintarOtra(raiz, deps, { comprobante: estado.comprobante });
      return;
    }
    if (estado.pantalla === "salio") {
      pintarSalio(raiz, deps, estado.motivoSalida);
      return;
    }
    if (estado.pantalla === "termino") {
      pintarTermino(raiz, depsDeRecibir, estado.memoria, ganabaAlTerminar ? { codigo: estado.codigo, comprobante: estado.comprobante } : null);
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
    if (estado.pantalla === "llena" || estado.pantalla === "apagada") {
      avisoPublico(deps.tx(estado.pantalla === "llena" ? "cpErrLlena" : "cpPersonaNoAbre"), null, true);
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
    if (estado.pantalla === "sorteada") {
      avisoPublico(deps.tx("cpSorteado"), estado.comprobante);
      // Quien se anotó y abre el enlace en otro navegador después del sorteo no recupera su código: se le dice con quién hablar.
      if (deps.persona) {
        const apoyo = document.createElement("p");
        apoyo.className = "cmp-apoyo";
        apoyo.textContent = deps.tx("cpPreguntaEnStand");
        raiz.querySelector("#cmp-estado .cmp-hero")?.append(apoyo);
      }
    }
  };

  /**
   * El perfil de Google puede llegar después de la sesión. Si Hola se pintó sin nombre, se lo pide a la sesión y, si llega
   * para la misma cuenta, repinta el saludo. Anotando y el error son del estado y no se tocan.
   */
  function buscarElNombre(sesion: SesionDelCelular): void {
    if (sesion.nombre !== null || !deps.nombreTardio) return;
    void deps.nombreTardio().then((nombre) => {
      const actual = estado.sesion;
      if (desmontado || nombre === null || actual === null || actual.cuenta !== sesion.cuenta || actual.nombre !== null) return;
      estado.sesion = { ...actual, nombre };
      if (estado.pantalla === "hola") pintar();
    }, () => undefined);
  }

  function ir(pantalla: Pantalla): void {
    if (desmontado) return;
    const llega = estado.pantalla !== pantalla;
    if (llega) generacion += 1;
    estado.pantalla = pantalla;
    if (pantalla === "hola" && estado.sesion) buscarElNombre(estado.sesion);
    if (pantalla === "hola") ajustarElAviso();
    // Quien gana y todavía no se sabe cómo está su cuenta: se lee una vez más al llegar a Ganaste, ahora que le importa. No en
    // cada consulta del minuto que la deja en Ganaste: cada lectura vuelve a armar la sesión del proveedor.
    if (pantalla === "gano" && llega && lectura.cuenta !== null && !seSabeLaCuenta() && !lectura.leyendo) void leerLaCuenta();
    if (pantalla === "gano" || pantalla === "adentro") prepararElPremio();
    programar();
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
    const vale = alSalir();
    const resultado = await pedirResultado();
    if (!vale()) return;
    if (resultado && resultado !== "red") estado.comprobante = resultado.comprobante;
    ir("sorteada");
  }

  async function mostrarFasePublica(fase: Fase): Promise<void> {
    if (fase === "lista") ir("lista");
    else if (fase === "abierta") ir("previa");
    else if (fase === "cerrada" || fase === "sellada") ir("cerrada");
    else await mostrarSorteoPublico();
  }

  /**
   * Solo personas: después del cierre, si este celular guarda su llave, antes de pintar lo público se le pregunta a la sala por lo
   * propio. Así se reconoce a quien se anotó aunque el recuerdo venciera, el enlace se abriera en otro lugar de este celular o la
   * respuesta de su alta se perdiera. El pase es para anotarse, y quien ya está anotada no lo necesita.
   */
  const conLlave = (fase: Fase): boolean => !!deps.persona && !!deps.llaveGuardada?.() && fase !== "lista" && fase !== "abierta";

  /**
   * La pantalla de quien no tiene recuerdo ni sesión. Con la llave, primero lo propio. Si esa consulta queda sin respuesta no
   * se pinta una pantalla final: se repite en el turno siguiente de las consultas, con tope. Agotados los intentos queda la
   * pantalla pública de siempre con Probar de nuevo.
   */
  async function mostrarFase(fase: Fase): Promise<void> {
    if (conLlave(fase)) {
      const vale = alSalir();
      const propio = await pedirPropio();
      if (!vale()) return;
      if (propio === "terminada") {
        ir("termino");
        return;
      }
      if (propio === "red") {
        sinRespuesta += 1;
        if (sinRespuesta < INTENTOS_POR_LA_LLAVE) {
          programar();
          return;
        }
      } else {
        sinRespuesta = 0;
        if (propio.anotada || propio.quitada !== undefined) {
          if (!estado.sesion) estado.ya = true;
          await aplicarPropio(propio);
          return;
        }
      }
    }
    await mostrarFasePublica(fase);
  }

  /**
   * Hay resultado: quien ganó lo ve, y quien no, también. Lo usan los dos caminos, la consulta propia (que trae si ganó y si le
   * avisaron) y la ventana del resultado (que solo trae las cuentas elegidas): gana si la sala lo dice o si su cuenta está entre
   * las elegidas.
   */
  async function aplicarResultado(
    resultado: { ganadoras: string[]; comprobante: string | null },
    propio: EstadoPropio | null,
  ): Promise<void> {
    if (desmontado) return;
    const avisadoAntes = estado.avisado;
    estado.comprobante = resultado.comprobante;
    if (propio) estado.avisado = propio.avisado === true;
    // En una campaña de personas solo la sala sabe si esta persona ganó, y solo si la llave de este celular sigue siendo la de su
    // fila (anotada desde otro celular, la fila pasó a la llave del otro). Sin esa certeza nunca se dice que no ganó: quien ya
    // vio Ganaste lo conserva, y quien no, ve que el sorteo ya se hizo y no se recuerda ningún resultado.
    if (deps.persona && !propio?.gano && !(propio?.anotada && propio.gano === false)) {
      if (estado.memoria?.resultado === "gano") return;
      ir("sorteada");
      return;
    }
    const cuenta = estado.sesion?.cuenta ?? estado.memoria?.cuenta;
    const gano = propio?.gano === true || (cuenta !== undefined && resultado.ganadoras.includes(cuenta));
    guardar({
      fase: "sorteada",
      resultado: gano ? "gano" : "otra",
      comprobante: resultado.comprobante,
    });
    if (gano) {
      ir("gano");
      if (estado.avisado && !avisadoAntes) deps.vibrar([60, 40, 60]);
    } else {
      ir("otra");
    }
  }

  async function aplicarPropio(propio: EstadoPropio): Promise<void> {
    if (desmontado) return;
    const avisadoAntes = estado.avisado;
    estado.propio = propio;
    estado.codigo = propio.codigo ?? estado.codigo;
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
      const vale = alSalir();
      const resultado = await pedirResultado();
      const sinLista = resultado === "red" || resultado === null;
      // En una campaña de personas la lista de elegidas no decide nada: ya dijo la sala si esta persona ganó. Sin ella la pantalla sale igual.
      if (!vale() || (sinLista && !deps.persona)) return;
      await aplicarResultado(sinLista ? { ganadoras: [], comprobante: estado.comprobante } : resultado, propio);
      return;
    }
    anotarLaRonda(propio);
    guardar({ fase: propio.fase });
    if (estado.pantalla === "adentro") {
      const antes = pintadoAdentro;
      if (antes && antes.fase === propio.fase && antes.cierraMs === propio.cierraMs && antes.ya === estado.ya && antes.clave === claveDeAdentro()) {
        // Lo mismo de antes, o solo otro número de personas: la pantalla no se repinta y el número cambia en su lugar.
        if (antes.total !== propio.total) {
          if (regresiva() !== "no" || actualizarElContador(raiz, deps, propio.total)) antes.total = propio.total;
          else pintar();
        }
      } else {
        saltarLaFase = antes !== null && antes.fase !== propio.fase;
        pintar();
      }
    } else ir("adentro");
    if (estado.pantalla === "gano" && propio.avisado && !avisadoAntes) {
      estado.avisado = true;
      deps.vibrar([60, 40, 60]);
      pintar();
    }
  }

  /** La marca de correo confirmado todavía no llegó a la sala en esta carga. */
  let marcaPendiente = deps.marcaDeCorreo === true;

  async function pedirPropio(): Promise<EstadoPropio | "red" | "terminada"> {
    // La marca va solo si el correo de la sesión está confirmado, una sola vez: sin respuesta, se vuelve a intentar.
    const conMarca = marcaPendiente && lecturaVigente()?.correoDeLaSesionConfirmado === true;
    try {
      const propio = await (conMarca ? deps.yo(true) : deps.yo());
      if (conMarca && propio !== "red") marcaPendiente = false;
      return propio;
    } catch {
      return "red";
    }
  }

  async function consultarPropio(): Promise<void> {
    const vale = alSalir();
    const propio = await pedirPropio();
    if (!vale() || propio === "red") return;
    huboRespuesta();
    if (propio === "terminada") {
      // En una campaña de personas, quien miraba Ganaste no lo pierde, ni su código, porque la sala ya no exista.
      ganabaAlTerminar = !!deps.persona && estado.pantalla === "gano";
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
      total: estado.publico?.total ?? 0,
      cierraMs: estado.publico?.cierraMs ?? deps.campana.cierraMs,
      anotada: true,
    };
    if (memoria.resultado === "gano") {
      estado.festejoGrandeHecho = true;
      ir("gano");
    } else if (memoria.resultado === "otra") {
      ir("otra");
    } else {
      ir("adentro");
    }
  }

  async function iniciar(): Promise<void> {
    if (desmontado) return;
    const memoria = leerMemoria(deps.memoria, deps.sala, deps.ahora());
    estado.memoria = memoria;
    const vale = alSalir();
    let publico: EstadoPublico | "red" | "terminada";
    try {
      publico = await deps.publico();
    } catch {
      publico = "red";
    }
    if (!vale()) return;
    if (publico === "red") {
      ir("sin-red");
      return;
    }
    if (publico === "terminada") {
      ir("termino");
      return;
    }
    estado.publico = publico;
    if (publico.pase === "vencido" && !memoria && !conLlave(publico.fase)) {
      ir("pase");
      return;
    }
    let sesion: SesionDelCelular | null = null;
    // Quien ya está anotada y recarga no retoma la sesión del proveedor: la espera no la necesita (la consulta propia va a la
    // sala con la cuenta que recuerda este navegador y la llave del celular), y retomarla son varios pedidos por recarga. Se
    // retoma cuando haga falta: al tocar Entrar, al confirmar el correo o al ir a recibir el premio.
    if (!memoria) {
      try {
        sesion = await deps.sesion();
      } catch {
        sesion = null;
      }
    }
    if (!vale()) return;
    estado.sesion = sesion;
    // La lectura de la cuenta sale en paralelo: ni Hola ni la alta la esperan.
    if (sesion) arrancarLaLectura(sesion.cuenta);
    else if (memoria) await usarLaLecturaRecordada(memoria.cuenta);
    if (memoria) {
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
      if (!vale()) return;
      if (propio === "terminada") {
        ir("termino");
        return;
      }
      // Quien salió de la lista y vuelve sin recuerdo ve por qué salió, no otra vez el botón de anotarse.
      if (propio !== "red" && (propio.anotada || propio.quitada !== undefined)) {
        await aplicarPropio(propio);
        return;
      }
      if (publico.fase === "abierta") ir("hola");
      else await mostrarFasePublica(publico.fase);
      return;
    }
    // Con la llave de este celular (personas) quien ya estaba anotada se reconoce sin sesión.
    await mostrarFase(publico.fase);
  }

  async function preguntar(): Promise<void> {
    if (desmontado || consultando || !deps.visible()) return;
    // Solo personas: la consulta propia por la llave quedó sin respuesta, antes de la primera pantalla o ya con la pantalla pública
    // y su Probar de nuevo. Se empieza otra vez: lo público y, con la llave, lo propio.
    const porLaLlave = sinRespuesta > 0 && (estado.pantalla === "inicial" || estado.pantalla === "cerrada" || estado.pantalla === "sorteada");
    if (!porLaLlave && estado.pantalla !== "previa" && estado.pantalla !== "hola" && estado.pantalla !== "adentro"
      && estado.pantalla !== "gano" && estado.pantalla !== "otra") return;
    // En la ventana del resultado, al volver a la pestaña se pregunta por el resultado y no por la consulta propia.
    if (!porLaLlave && sorteo?.consulta()?.cadaMs != null) {
      await preguntarResultado();
      return;
    }
    consultando = true;
    try {
      if (porLaLlave) await iniciar();
      else if (estado.pantalla === "previa" || estado.pantalla === "hola") {
        const vale = alSalir();
        let publico: EstadoPublico | "red" | "terminada";
        try {
          publico = await deps.publico();
        } catch {
          publico = "red";
        }
        if (!vale() || publico === "red") return;
        ultimaRespuesta = deps.ahora();
        if (publico === "terminada") {
          ir("termino");
          return;
        }
        const anterior = estado.publico;
        estado.publico = publico;
        // El botón de Google no se vuelve a armar mientras alguien lo mira: con la previa a la vista solo cambia el número.
        const enSuLugar = deps.persona && estado.pantalla === "previa" && anterior !== null
          && anterior.cierraMs === publico.cierraMs && actualizarElContadorDeLaPrevia(raiz, deps, publico.total);
        if (publico.fase === "abierta") {
          if (!enSuLugar) pintar();
        } else await mostrarFase(publico.fase);
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
      sinRespuesta = 0;
      estado.ya = resultado.ya;
      // La persona que se acaba de anotar ya cuenta: la confirmación no repite el número de antes.
      estado.propio = {
        fase: "abierta",
        total: (estado.publico?.total ?? 0) + (resultado.ya ? 0 : 1),
        cierraMs: estado.publico?.cierraMs ?? deps.campana.cierraMs,
        anotada: true,
      };
      guardar({ fase: "abierta", resultado: null, comprobante: null });
      // La sala acaba de contestar el alta: la señal arranca en Al día.
      ultimaRespuesta = deps.ahora();
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
    // En una campaña de personas, repetir el pedido a una sala sin el modo prendido (apagada) no lo arregla: pantalla final, sin Acepto.
    if (resultado.motivo === "llena" || resultado.motivo === "apagada") {
      ir(resultado.motivo);
      return;
    }
    estado.errorAlta = resultado.motivo;
    estado.limiteHasta = resultado.motivo === "limite" ? deps.ahora() + (resultado.segundos ?? 30) * 1000 : null;
    // Lo que dice el límite se baja recién ahora. Sin red para bajarlo, queda la línea de siempre.
    if (resultado.motivo === "limite" && !limite) limite = await import("./limite").catch(() => null);
    if (desmontado) return;
    pintar();
  }

  /** La página olvida a quien recordaba: la memoria de la sala, la sesión de la pantalla y todo lo que se sabía de su cuenta. */
  function olvidarALaPersona(): void {
    // Lo que la sala conteste a un pedido que salió con la persona anterior ya no cuenta.
    generacion += 1;
    sinRespuesta = 0;
    borrarMemoria(deps.memoria, deps.sala);
    estado.sesion = null;
    estado.memoria = null;
    estado.propio = null;
    estado.codigo = null;
    estado.errorAlta = null;
    estado.festejoGrandeHecho = false;
    entrada.desde = null;
    entrada.falla = null;
    soltarLaTarjeta(true);
    tarjetaApagada = false;
    proveedorSuelto = false;
    reiniciarLaLectura();
    recordarLaCuenta();
    aviso.principal = false;
    soltarElRelojDelAviso();
  }

  async function salir(): Promise<void> {
    try {
      await deps.salir();
    } catch {
      /* Aunque el proveedor falle, esta página olvida la sesión y el recuerdo local. */
    }
    if (desmontado) return;
    olvidarALaPersona();
    ir("previa");
  }

  /** Un toque en Recibir ya está comparando la sesión con la cuenta: otro toque no lanza otra comparación. */
  let comparandoLaSesion = false;

  /**
   * Recibir el premio. Quien llegó con la sesión de esta página ya es de su cuenta. Quien recargó ya anotada vive de lo que
   * recordaba este navegador, sin haber retomado la sesión del proveedor: en un celular compartido la sesión de ahora puede ser
   * la de otra persona, y esa no recibe el premio de esta cuenta. Se compara acá, que es cuando hace falta (son pedidos al
   * servicio de cuentas): si es de otra, la página olvida lo que recordaba y abre para quien entró ahora; si no se sabe, sigue
   * de largo, que el sitio lo resuelve con la cuenta que tenga. El botón queda ocupado desde el toque. La comparación tiene su
   * tope y no sigue con una renovación del token a medias (`sesion-confirmar.ts`); este tope solo destraba Recibir si algo
   * colgara antes, como bajar lo que hace falta.
   */
  async function recibirElPremio(toque?: Event): Promise<void> {
    if (comparandoLaSesion) return;
    const cuenta = estado.memoria?.cuenta;
    if (estado.sesion === null && cuenta !== undefined && deps.cuenta?.laSesionEs) {
      comparandoLaSesion = true;
      const boton = toque?.currentTarget instanceof HTMLButtonElement ? toque.currentTarget : null;
      boton?.setAttribute("aria-busy", "true");
      if (boton) boton.disabled = true;
      let reloj = 0;
      let otra = false;
      try {
        // La comparación se baja con lo de Ganaste: solo la necesita quien recargó y toca Recibir.
        otra = await Promise.race([
          import("./premio").then((m) => m.laSesionEsDeOtra(deps, cuenta), () => false),
          new Promise<false>((resolver) => {
            reloj = window.setTimeout(() => resolver(false), TOPE_DE_RECIBIR_MS);
          }),
        ]);
      } finally {
        window.clearTimeout(reloj);
        comparandoLaSesion = false;
        boton?.removeAttribute("aria-busy");
        if (boton) boton.disabled = false;
      }
      if (desmontado) return;
      if (otra) {
        olvidarALaPersona();
        pintadoAdentro = null;
        ir("previa");
        await iniciar();
        return;
      }
    }
    deps.recibir();
  }
  /** Lo que ve Ganaste (y el cierre con premio): lo de siempre, con Recibir que primero compara la sesión con la cuenta. */
  const depsDeRecibir: DepsDelCelular = { ...deps, recibir: (toque?: Event) => void recibirElPremio(toque) };

  const cancelarVuelta = deps.alVolver(() => {
    if (!deps.visible()) return;
    // Volver a la pestaña empieza la cuenta de nuevo: el tiempo escondida no cuenta como falta de conexión.
    ultimaVuelta = deps.ahora();
    tarjeta?.alVolver();
    void preguntar();
    // Un reintento que sonó con la pestaña escondida se hace ahora, una vez.
    if (lectura.escondida) {
      lectura.escondida = false;
      void leerLaCuenta();
    }
  });
  void iniciar();
  return {
    pintar,
    desmontar: () => {
      desmontado = true;
      limpiarPintura?.();
      cancelarIntervalo?.();
      cancelarVuelta();
      if (relojDeTramo !== null) window.clearTimeout(relojDeTramo);
      sorteo?.soltar();
      soltarElRelojDeLaLectura();
      soltarElRelojDelAviso();
      soltarLaTarjeta(false);
      raiz.removeEventListener("pointerdown", alTocar, true);
      if (temporizadorAlta !== null) window.clearTimeout(temporizadorAlta);
      if (temporizadorRefresco !== null) window.clearTimeout(temporizadorRefresco);
    },
  };
}
