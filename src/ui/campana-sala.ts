import "../campana/campana-sala.css";
import { campanasActivo } from "../campana/bandera";
import { esLineaDePersona } from "../campana/forma-persona";
import {
  accionesDelPuente,
  alCambiarElPuente,
  avisosPendientes,
  botonDelPaso,
  lineaDelPaso,
  pasoDelPuente,
  ponerPaso,
  ponerRechazo,
  registrarAcciones,
} from "../campana/puente";
import { anotarDuenaDelBorrador, borradorEsDeOtra, borrarBorrador, leerBorrador } from "../campana/borrador";
import { DOLAR, dolaresEnTexto, esDeCentavosJustos, totalDePremios } from "../campana/comision";
import { fechaTexto, horaTexto, textoDelPremio } from "../campana/formato";
import { type Campana, type LecturaDeCampana, leerCampana } from "../campana/modelo";
import { reglaQueFalla } from "../campana/reglas-de-activar";
import { ESPERA_TOKEN_MS } from "../campana/sesion";
import { TEXTOS_SALA_CAMPANA } from "../campana/textos-sala";
import { descifrarEquipo, revisarEquipo } from "../equipos/datos";
import type { DatosDeEquipo } from "../equipos/modelo";
import { enEnsayo, enStand, conDemo } from "../ensayo-modo";
import { getLang, onLangChange, t } from "../i18n";
import type { Lang } from "../idioma";
import {
  type CampanaDeCuenta,
  type EstadoDeCampanaDeCuenta,
  type EstadoDeSala,
  type FallaAlCrear,
  type FallaDeSala,
  type FaseDeSala,
  MOTIVOS,
  type MemoriaDeOrg,
  type MotivoDeActivar,
  type MotivoDeRecuperar,
  type MotivoDeSalida,
  type PaseDeSala,
  type QuitaPendiente,
  type RedDeCampana,
  type ResultadoDeActivar,
  type ResultadoDeMisCampanas,
  type ResultadoDeRecuperar,
  type SalaDeCampana,
  activarCampana,
  borrarOrg,
  borrarSalaVacia,
  crearCampanaEnSala,
  estadoConToken,
  guardarOrg,
  guardarIntentoDeArchivo,
  guardarTokenDeEvento,
  intentoDeArchivo,
  leerCampanaDeSala,
  leerOrg,
  leerOrganizadora,
  olvidarIntentoDeArchivo,
  pedirPase,
  ponerFase,
  quitarConMotivo,
  salaPuedeActivar,
  seVeDesde,
  tokenDeEvento,
} from "../sala/campana-org";
import { generarClave } from "../sala/cifra";
import { type Escucha, type EquipoDeSala, escucharSala } from "../sala/cliente";
import { network } from "../stellar/config";
import { activeWallet } from "../stellar/wallet-lite";
import { type PantallaGrande, crearPantallaGrande, rellenar } from "./campana-grande";
import { type AccionDeComision, type ControlDeComision, type DepsDeComision, crearControlDeComision } from "./campana-comision";
import { cambiarDeCuentaReal, depsDeComisionReales, entrarConGoogleReal } from "./campana-comision-real";
import { type DepsDeDeposito, type EstadoDelDeposito, depsDeDepositoReales, estadoDelDeposito } from "./campana-deposito";
import { depsDeTusReales } from "./campana-tus-real";
import { crearFilaViva } from "./fila-viva";
import type { ContextoDelPaso, FilaParaReponer } from "./campana-pasar";
import { alApartarReal, alCerrarReal, alOlvidarReal, alReabrirReal, listaPasadaReal, listaTrabadaReal, reponerEtiquetasReal } from "./campana-pasar-real";
import { claveDeSellar, entraConGoogle as entraConGoogleDeLaPagina, openPicker } from "./wallet-ui";
import { pintarQr } from "./qr";

/**
 * El panel de una campaña de empresa, solo con `?campana` (y la bandera `VITE_CAMPANAS`), arriba del cuadro del sorteo.
 * Quien organiza elige el archivo firmado que le mandó Tinkazo, abre la inscripción, muestra el QR en grande, mira cómo
 * crece la lista, saca a quien no corresponde con un motivo y cierra. Todo lo de afuera (la sala, el reloj, el
 * almacén, las pestañas) entra por `DepsDelPanelDeCampana`, para probarlo sin red ni reloj.
 *
 * Pasar la lista al cuadro del sorteo es de otra pieza: acá solo se avisa con `alCerrar`.
 */

/** Una persona de la lista, tal como la ve quien organiza. `nombre` es `null` si vino vacío o no se pudo leer. */
export interface FilaDeCampana {
  n: number;
  cuenta: string;
  nombre: string | null;
  /** El filtro la marcó: no se muestra su nombre hasta tocar Mostrar. */
  revisar: boolean;
}
type Fila = FilaDeCampana;

/** Las pestañas del mismo navegador se avisan quién tiene la sala: dos escuchas con el mismo token se pisan. */
export interface CanalDeCampana {
  enviar: (sala: string) => void;
  alRecibir: (f: (sala: string) => void) => void;
  cerrar: () => void;
}

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ResultadoDeValidar = { ok: true } | { ok: false; campo: string; motivo: string };

/**
 * Lo de afuera de Tus campañas: pedir la lista de la cuenta, usar una campaña en esta compu y lo que recuerda esta compu de un
 * sorteo ya hecho en otra. Sin esto el panel no mira nada de lo de Tus campañas y es el de siempre.
 */
export interface DepsDeTus {
  /** Si el panel se abrió con la intención de organizar (la dirección del panel): solo así se pide la lista sin que se toque nada. */
  alAbrir: () => boolean;
  /**
   * Si la sala de afuera tiene Tus campañas: `true` o `false` cuando contestó, `null` si no hubo respuesta. Se pregunta una vez por
   * pestaña antes de ofrecer nada. Una sala que todavía no la tiene no muestra las líneas, los enlaces ni los botones de Tus
   * campañas. Sin esta función (las pruebas de siempre) se da por hecho que la tiene.
   */
  disponible?: () => Promise<boolean | null>;
  /** Las campañas de la cuenta de esa sesión. Una sala que todavía no tiene la ruta vuelve como sin la función. */
  listar: (sesion: string) => Promise<ResultadoDeMisCampanas>;
  /** Usa una campaña de la cuenta en esta compu. */
  recuperar: (sesion: string, evento: string) => Promise<ResultadoDeRecuperar>;
  /** Con el sorteo ya hecho en otra compu, arma lo que esta recuerda con el resultado público. false si no se pudo. */
  armarSorteo: (s: SalaDeCampana, cuenta: string) => Promise<boolean>;
  /** El enlace que abre un correo a la casilla de ayuda con ese asunto. */
  ayuda: (asunto: string) => string;
}

export interface DepsDelPanelDeCampana {
  tx: (clave: string) => string;
  idioma: () => Lang;
  red: () => RedDeCampana;
  enStand: () => boolean;
  /** El ensayo tampoco graba nada: no abre campañas. */
  enEnsayo: () => boolean;
  conDemo: () => boolean;
  ahora: () => number;
  leerArchivo: (f: File) => Promise<string>;
  /** Lo que la sala de la campaña va a exigir del texto, para decirlo antes de crear nada. */
  validar: (texto: string, ahora: number) => Promise<ResultadoDeValidar>;
  /** La cuenta con que se entró, si se entró: una campaña puede pedir que selle una cuenta en particular. */
  cuenta: () => string | null;
  crear: (
    archivo: { texto: string; firma: string },
    de: { evento: string; red: RedDeCampana; anterior: string | null; intento: string },
  ) => Promise<{ ok: true; sala: SalaDeCampana } | { ok: false; motivo: FallaAlCrear }>;
  pase: (s: SalaDeCampana) => Promise<PaseDeSala | FallaDeSala>;
  fase: (s: SalaDeCampana, fase: "abierta" | "cerrada", cierraMs: number | null) => Promise<true | FallaDeSala>;
  quitar: (s: SalaDeCampana, n: number, motivo: MotivoDeSalida) => Promise<true | FallaDeSala>;
  estado: (s: SalaDeCampana) => Promise<EstadoDeSala | FallaDeSala>;
  campanaDeSala: (s: SalaDeCampana) => Promise<Campana | FallaDeSala>;
  /** Cierra y borra una sala que no llegó a abrirse, para que el archivo sirva otra vez. */
  borrarVacia: (s: SalaDeCampana) => Promise<boolean>;
  escuchar: (s: SalaDeCampana, e: Escucha) => { parar: () => void; consultar: () => Promise<void> };
  descifrar: (clave: string, d: string) => Promise<DatosDeEquipo | null>;
  /** Con `fijo`, el QR mide siempre lo mismo en pantalla y se vuelve a dibujar nítido cuando cambia la densidad (qr.ts). */
  qr: (img: HTMLImageElement, texto: string, ancho: number, fijo?: boolean) => Promise<boolean>;
  almacen: Almacen | null;
  /** Corre `f` dentro de `ms` y devuelve cómo cancelarlo. En las pruebas, un reloj de mentira. */
  esperar: (f: () => void, ms: number) => () => void;
  pantallaCompleta: (el: HTMLElement) => Promise<void>;
  /** El tamaño de la ventana, para dibujar el QR grande del tamaño en que se ve. */
  ventana: () => { ancho: number; alto: number };
  origen: () => string;
  /** El canal entre pestañas, o `null` si el navegador no tiene. */
  canal: () => CanalDeCampana | null;
  /**
   * Pasa la lista cerrada al cuadro del sorteo. Cada llamada REEMPLAZA a la anterior: si después de cerrar llega una alta
   * tardía o se quita a alguien, se vuelve a llamar con la lista nueva. Por defecto no hace nada.
   */
  alCerrar: (s: SalaDeCampana, filas: readonly FilaDeCampana[], ctx?: ContextoDelPaso) => void | Promise<void>;
  /** Si la lista no se puede cambiar: ya está sellándose, o su sorteo todavía no terminó de avisarse a la sala. */
  listaBloqueada?: () => boolean;
  /** Quien organiza reabrió la inscripción: lo que se había pasado al cuadro ya no vale. */
  alReabrir?: () => void;
  /** Se dejó la campaña: el cuadro vuelve a ser el de siempre. */
  alOlvidar?: () => void;
  /** Entró otra cuenta y la campaña se apartó de la vista: el cuadro deja de tener su lista. No se borra nada de lo guardado. */
  alApartar?: (s: SalaDeCampana) => void;
  /**
   * La cuenta que nombra el texto firmado de la campaña de esa sala (`null` si no nombra a nadie). Con eso se completa la
   * memoria de antes de guardar la cuenta. Sin esto, esa memoria queda sin completar.
   */
  organizadoraDeSala?: (s: SalaDeCampana) => Promise<string | null | FallaDeSala>;
  /** Se retomó la sala en esa fase después de una recarga: lo que pasó con el sello y el resultado se retoma. */
  alRetomar?: (fase: FaseDeSala, s: SalaDeCampana) => void;
  /** Si la lista que había en el cuadro ya es la que se pasó de esta campaña (se recargó la pestaña después de pasarla). */
  listaPasada?: (s: SalaDeCampana) => boolean;
  /**
   * Al retomar una campaña ya pasada, con todas las filas recibidas: repone los nombres que la pestaña perdió (solo en una lista
   * de personas). Se llama una sola vez por retomada. Sin esto, no se repone nada.
   */
  reponerEtiquetas?: (s: SalaDeCampana, filas: readonly FilaParaReponer[]) => void;
  /** El nombre del botón de sellar de la herramienta, tal como se lo ve ahora. */
  botonDeSellar?: () => string;
  /** Suelta el sello de la pantalla para armar de nuevo la lista (la sala no lo aceptó). */
  soltarElSello?: () => Promise<void> | void;
  /** Abre la ventana para entrar con otra cuenta. */
  cambiarDeCuenta?: () => void;
  /**
   * Entra con Google como el botón principal de la portada (`entrar` de `wallet-ui.ts`), sin ofrecer el correo: la campaña solo
   * acepta Google. Lo usa la campaña por activar sin sesión y los avisos que piden entrar con Google. Sin esto se abre la
   * ventana de siempre (`cambiarDeCuenta`).
   */
  entrar?: () => void;
  /** Si entrar va directo a Google (hay llave del proveedor y no es el navegador de una app): el botón lleva la G. Sin esto, no. */
  entraConGoogle?: () => boolean;
  /**
   * Lo que cobra Tinkazo antes de abrir la inscripción (`campana-comision.ts`). Sin esto, o con `comision()` en `null`, el
   * panel es el de siempre: no mira nada y no cambia ninguna pantalla.
   */
  comision?: DepsDeComision;
  /**
   * Le pide a la sala que firme el borrador de una campaña (`POST /v1/activar`) con la sesión de quien organiza. Sin esto, o sin
   * `sesion`, un borrador no se puede activar y el panel lo dice.
   */
  activar?: (pedido: { texto: string; sesion: string }) => Promise<ResultadoDeActivar>;
  /**
   * Si la sala puede activar ahora (ella y el portero, prendidos y con sus llaves). Se pregunta al tomar un borrador, antes de
   * ofrecer el pago: con un no, no se cobra. Sin esto se da por sí.
   */
  salaLista?: () => Promise<boolean>;
  /** El token de la sesión de Google de quien organiza, o `null` si no hay sesión. Se pide en cada activación y no se guarda. */
  sesion?: () => Promise<string | null>;
  /** Lleva a otra página: volver a armar la campaña. */
  ir?: (direccion: string) => void;
  /** Tus campañas desde cualquier navegador y Usar en esta compu. Sin esto, el panel no cambia en nada. */
  tus?: DepsDeTus;
  /**
   * Cuántos dólares digitales puede usar la cuenta que paga el premio (`campana-deposito.ts`). Con esto, en la vista previa de
   * una campaña de la red principal el panel suma una línea que dice si el premio está o cuánto falta. Sin esto no mira nada.
   */
  deposito?: DepsDeDeposito;
}

const NOMBRE_DEL_CANAL = "tinkazo-campana-org";

export function depsReales(): DepsDelPanelDeCampana {
  return {
    tx: (clave) => TEXTOS_SALA_CAMPANA[getLang()][clave] ?? t(clave),
    idioma: getLang,
    red: () => network.name,
    enStand,
    enEnsayo,
    conDemo,
    ahora: () => Date.now(),
    leerArchivo: (f) => f.text(),
    validar: async (texto, ahora) => {
      // Lo trae al elegir un archivo y no antes: arrastra el lector de la sala, que el resto del sitio no usa.
      const { validarCampanaParaFirmar } = await import("../sala/validar-campana");
      return validarCampanaParaFirmar(texto, ahora);
    },
    cuenta: () => activeWallet()?.address ?? null,
    crear: (archivo, de) => crearCampanaEnSala(archivo, de),
    pase: (s) => pedirPase(s),
    fase: (s, fase, cierraMs) => ponerFase(s, fase, cierraMs),
    quitar: (s, n, motivo) => quitarConMotivo(s, n, motivo),
    estado: (s) => estadoConToken(s),
    campanaDeSala: (s) => leerCampanaDeSala(s),
    borrarVacia: (s) => borrarSalaVacia(s),
    escuchar: (s, e) => escucharSala(s, e),
    descifrar: descifrarEquipo,
    qr: (img, texto, ancho, fijo) => pintarQr(img, texto, ancho, fijo),
    almacen: almacenDelNavegador(),
    esperar: (f, ms) => {
      const id = setTimeout(f, ms);
      return () => clearTimeout(id);
    },
    pantallaCompleta: (el) =>
      Promise.resolve(el.requestFullscreen?.({ navigationUI: "hide" }))
        .then(() => undefined)
        .catch(() => undefined),
    ventana: () => ({ ancho: innerWidth, alto: innerHeight }),
    origen: () => location.origin,
    canal: canalDelNavegador,
    alCerrar: alCerrarReal,
    listaBloqueada: listaTrabadaReal,
    alReabrir: alReabrirReal,
    alOlvidar: alOlvidarReal,
    alApartar: alApartarReal,
    organizadoraDeSala: (s) => leerOrganizadora(s),
    listaPasada: listaPasadaReal,
    reponerEtiquetas: reponerEtiquetasReal,
    botonDeSellar: () => t(claveDeSellar()),
    // El sello que la sala no aceptó se suelta también con el show ya hecho (`soltarParaSellarDeNuevo`), sin cortar un juego en marcha.
    soltarElSello: () => import("./campana-resultado-real").then((m) => m.soltarParaSellarDeNuevo()),
    alRetomar: () => void import("./campana-resultado-real").then((m) => m.alRetomarReal()).catch(() => undefined),
    cambiarDeCuenta: () => void cambiarDeCuentaReal(openPicker),
    entrar: () => void entrarConGoogleReal(),
    entraConGoogle: () => entraConGoogleDeLaPagina(),
    comision: depsDeComisionReales(),
    activar: (pedido) => activarCampana(pedido),
    salaLista: () => salaPuedeActivar(),
    // El token se pide cuando hace falta y de la misma billetera que usa el alta del celular: nada lo guarda ni lo escribe.
    sesion: async () => {
      try {
        const m = await import("../stellar/wallet-pollar");
        return await m.pollarWallet.tokenDeSesion(ESPERA_TOKEN_MS);
      } catch {
        return null;
      }
    },
    ir: (direccion) => location.assign(direccion),
    tus: depsDeTusReales(),
    // El saldo se lee en la red principal: en la de prueba no hay premio de verdad que mirar.
    ...(network.name === "mainnet" ? { deposito: depsDeDepositoReales() } : {}),
  };
}

/** `localStorage` y no `sessionStorage`: el token de la sala no se pide de nuevo, y perderlo al cerrar la pestaña traba la campaña. */
function almacenDelNavegador(): Almacen | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function canalDelNavegador(): CanalDeCampana | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    const c = new BroadcastChannel(NOMBRE_DEL_CANAL);
    return {
      enviar: (sala) => c.postMessage({ sala }),
      alRecibir: (f) =>
        c.addEventListener("message", (e: MessageEvent) => {
          const sala = (e.data as { sala?: unknown } | null)?.sala;
          if (typeof sala === "string") f(sala);
        }),
      cerrar: () => c.close(),
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ lo que no depende del panel */

type Vista =
  | "elegir"
  | "previa"
  | "abierta"
  | "confirmar"
  | "olvidar"
  | "cerrada"
  | "sellada"
  | "sorteada"
  | "cargando"
  | "sin-red"
  | "otra-pestana"
  | "tomada"
  | "tus"
  | "seguir";

/**
 * Cómo va la activación de un borrador: todavía no se pidió, se está pidiendo, la sala dijo que no, ya se firmó, o se firmó
 * pero falta para abrir y la sala se crea más cerca de la hora (`temprano`).
 */
type Activacion =
  | { tipo: "esperando" }
  | { tipo: "activando" }
  | { tipo: "error"; motivo: MotivoDeActivar; campo?: string }
  | { tipo: "hecha" }
  | { tipo: "temprano"; abreMs: number; sorteoMs: number };

/**
 * Cuánto antes de abrir se crea la sala de un borrador activado. La sala vive 24 horas desde que se crea y del abrir al sorteo
 * hay como mucho 12: creada 6 horas antes, llega al sorteo con margen. Activada antes, la campaña queda firmada y la sala espera.
 */
export const ANTICIPO_DE_LA_SALA_MS = 6 * 3_600_000;

/** Lo que vive la sala desde que se crea, y lo que tiene que quedarle después del sorteo para avisar y pagar los premios. */
const VIDA_DE_LA_SALA_MS = 24 * 3_600_000;
export const MARGEN_TRAS_EL_SORTEO_MS = 6 * 3_600_000;

/**
 * Si una campaña activada antes de tiempo se puede abrir ya: el sorteo tiene que caer dentro de la vida de la sala creada
 * ahora, con el mismo margen que le deja la espera de siempre. Con el sorteo más lejos, abrir ya la dejaría sin lista.
 */
export const cabeAbrirYa = (sorteoMs: number, ahora: number): boolean => desdeCuandoSePuedePreparar(sorteoMs) <= ahora;

/**
 * El instante desde el que una campaña activada se puede preparar (crear su sala): el mismo en que cabeAbrirYa pasa a verdadero.
 * Tus campañas lo usa para el botón y para el texto, así nunca dicen horas distintas.
 */
export const desdeCuandoSePuedePreparar = (sorteoMs: number): number => sorteoMs + MARGEN_TRAS_EL_SORTEO_MS - VIDA_DE_LA_SALA_MS;

/** Cuántas campañas muestra Tus campañas: el panel ocupa la pantalla sola, y tres filas entran a la vista en el celular. */
const MAX_FILAS_DE_TUS = 3;
/** Tras dos preguntas seguidas sin respuesta sobre Tus campañas, cuánto se espera antes de volver a preguntar. */
const ESPERA_DE_TUS_SIN_RESPUESTA_MS = 5 * 60_000;
const RANGO_DE_TUS: Record<EstadoDeCampanaDeCuenta, number> = { viva: 0, activada: 1, terminada: 2 };

/** Primero la que tiene su sala abierta, después las activadas por la hora de abrir, y al final las terminadas, la más nueva primero. */
function ordenDeTus(filas: readonly CampanaDeCuenta[]): CampanaDeCuenta[] {
  return [...filas].sort(
    (a, b) => RANGO_DE_TUS[a.estado] - RANGO_DE_TUS[b.estado] || (a.estado === "terminada" ? b.sorteoMs - a.sorteoMs : a.abreMs - b.abreMs),
  );
}

/** Lo que dice una fila de Tus campañas que no salió como se esperaba, y si todavía lleva un botón (usar de nuevo, o probar de nuevo). */
interface FallaDeFila {
  evento: string;
  texto: () => string;
  boton: "usar" | "reintentar" | null;
}

/**
 * Cuándo una campaña activada antes de tiempo pasa a poder abrirse ya (`cabeAbrirYa`): faltan menos de lo que vive la sala
 * creada ahora para el sorteo, con su margen. Es el instante en que el botón Abrir pasa de apagado a Abrir la inscripción ahora.
 */
const cuandoSePuedeAbrirYa = (sorteoMs: number): number => desdeCuandoSePuedePreparar(sorteoMs);

/** Las veces que la sala vuelve a probar sola activar una campaña que se pidió abrir ya, y lo menos que espera entre una y otra. */
const REINTENTOS_AUTOMATICOS = 3;
const ESPERA_MINIMA_DEL_REINTENTO_MS = 30_000;
/**
 * Los fallos de la activación que pueden pasar solos: la red o la sala sin contestar. Los que piden algo a la persona (entrar de
 * nuevo, cargar dólares, armar la campaña otra vez) o que son de la sala misma (apagada, sin cupo) no se vuelven a probar solos:
 * cada intento es un pedido a la sala, que lleva su cuenta de rechazos.
 */
const SE_REINTENTA_SOLO: ReadonlySet<MotivoDeActivar> = new Set<MotivoDeActivar>(["red", "acceso", "sin-respuesta"]);

/** El aviso de una campaña que cierra a más de una semana: no se activa todavía, y su borrador se guarda. */
const MUY_LEJOS = "cpoAcMuyLejos";

/** Lo que dice y hace la pantalla de un borrador pagado: un título, una línea y un botón. */
interface PasoDeActivar {
  titulo: string;
  linea: string;
  principal: { texto: string; accion: "activar" | "cargar" | "entrar" | "armar" | "preguntar" | "abrir-ya"; apagado: boolean };
}

const TEXTO_DE_FALLA_AL_CREAR: Record<FallaAlCrear, string> = {
  forma: "cpoNoEsCampana",
  firma: "cpoSinFirma",
  "ya-existe": "cpoYaExiste",
  vencida: "cpoVencida",
  "cupo-campanas": "cpoMuchas",
  origen: "cpoSinConexion",
  // No es una falta de conexión: repetir el pedido no lo arregla. Al abrir la inscripción lo dicen el título y la línea.
  "personas-apagadas": "cpoPersonasNoL",
  red: "cpoSinConexion",
};
const TEXTO_DEL_MOTIVO: Record<MotivoDeSalida, string> = {
  repetida: "cpoRepetida",
  evento: "cpoNoEstaEnElEvento",
  pidio: "cpoPidio",
  otro: "cpoOtro",
};
/** El texto de cada motivo: con una persona anotada (sin cuenta) quien sale repetida es una persona y no una cuenta. */
const textoDelMotivo = (m: MotivoDeSalida, persona: boolean): string => (persona && m === "repetida" ? "cpoRepetidaPersona" : TEXTO_DEL_MOTIVO[m]);

const QUINCE_MIN = 15 * 60_000;
/** Lo más lejos que la sala acepta un cierre: doce horas desde ahora. */
const DOCE_HORAS = 12 * 3_600_000;
/** Lo que se queda por debajo de ese máximo: cubre lo que la hora de esta compu puede ir adelantada sin que se note. */
const MARGEN_DE_LAS_DOCE_HORAS = 4 * 60_000;
/** Quien vuelve a la pestaña no hace mirar el premio más de una vez cada 5 segundos. */
const ENTRE_MIRADAS_DEL_DEPOSITO_MS = 5_000;
/** Cuánto se sigue afirmando una lectura del premio: pasado un minuto ya no se dice y la línea cuenta que no se pudo ver. */
const VIDA_DE_LA_LECTURA_DEL_DEPOSITO_MS = 60_000;
/** Con el panel a la vista, la relectura arranca a los 50 segundos de la última lectura: el texto de antes sigue hasta que llega la nueva. */
const RELECTURA_DEL_DEPOSITO_MS = 50_000;
/** Un instante más que la vida de la lectura, para que el reloj nunca despierte antes de que esté vieja. */
const RELOJ_DEL_DEPOSITO_MS = VIDA_DE_LA_LECTURA_DEL_DEPOSITO_MS + 250;
/** Si la primera lectura falla, se prueba una sola vez más a los 5 segundos. */
const REINTENTO_DEL_DEPOSITO_MS = 5_000;
/**
 * Si una lectura del premio todavía vale, según la hora del sistema. Una edad negativa (el reloj se atrasó) cuenta como vencida:
 * nunca se afirma una lectura que parece del futuro.
 */
const vigenteElDeposito = (edadMs: number): boolean => edadMs >= 0 && edadMs < VIDA_DE_LA_LECTURA_DEL_DEPOSITO_MS;
const DESHACER_MS = 5_000;
/** Si una quita no llegó a la sala, se vuelve a mandar sola: quitar dos veces es lo mismo que una. */
const REINTENTO_QUITA_MS = 3_000;
/** Si el pase no llega, se prueba otra vez a los 10 s y el QR de antes sigue. */
const REINTENTO_PASE_MS = 10_000;
/** Cuánto se espera, tras un cambio de tamaño o de zoom, para dibujar de nuevo el QR: un solo dibujo por cambio. */
const REDIBUJO_DEL_QR_MS = 200;
/** Si falla la lectura del archivo para completar de quién es la sala: cuántas veces se vuelve a probar y cada cuánto. */
const MAX_INTENTOS_DE_LA_DUENA = 5;
const ESPERA_DE_LA_DUENA_MS = 4_000;
/** Nunca se pide un pase nuevo antes de 5 s ni se espera más de lo que dura una ventana de la sala. */
const PISO_PASE_MS = 5_000;
const VENTANA_DEL_PASE_MS = 120_000;
/** Cuánto puede ir adelantada esta compu y seguir contando como en hora: la sala repite el mismo pase hasta que su reloj cruza. */
const HOLGURA_DEL_RELOJ_MS = 30_000;
/** Un pase vale entre 14 y 16 minutos: pasados 12 sin uno nuevo, el QR se saca antes de que la sala lo rechace. */
const VIGENCIA_DEL_PASE_MS = 12 * 60_000;
/** Un doble toque en Cerrar no puede confirmar solo: el segundo toque cae sobre el botón de confirmar. */
const GUARDA_DE_CONFIRMAR_MS = 600;
const VUELTAS_AL_CERRAR = 4;
const ESPERA_AL_LEER_MS = 1_000;
/** Un archivo firmado pesa menos de 90.000 bytes: lo que pasa de eso no es una campaña y no se lee entero. */
const MAX_ARCHIVO = 200_000;

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** El archivo que manda Tinkazo: `{ texto, firma }`, los dos de texto. */
function archivoFirmado(crudo: string): { texto: string; firma: string } | null {
  try {
    const x: unknown = JSON.parse(crudo);
    if (!esObjeto(x) || typeof x.texto !== "string" || typeof x.firma !== "string") return null;
    return { texto: x.texto, firma: x.firma };
  } catch {
    return null;
  }
}

/** Lee el texto de la campaña con el lector del sitio, y dice la red que trae el archivo (de su campo, no del texto suelto). */
function leerDelTexto(texto: string): { lectura: LecturaDeCampana; red: string | null; organizadora: string | null } {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { lectura: { ok: false, campo: "texto", motivo: "inválido" }, red: null, organizadora: null };
  }
  const objeto = esObjeto(datos) ? datos : {};
  return {
    lectura: leerCampana(datos),
    red: typeof objeto.red === "string" ? objeto.red : null,
    organizadora: typeof objeto.organizadora === "string" ? objeto.organizadora : null,
  };
}

const nombreDeRed = (red: string | null): string => (red === "mainnet" ? "cpoModoMain" : "cpoModoTest");

/* ------------------------------------------------------------ el panel */

export function crearPanelDeCampana(deps: DepsDelPanelDeCampana): { raiz: HTMLElement; pintar: () => void; detener: () => void } {
  const tx = (clave: string): string => deps.tx(clave);
  const fmt = (clave: string, valores: Record<string, string | number>): string => rellenar(tx(clave), valores);

  const raiz = document.createElement("section");
  raiz.id = "cpo-panel";
  raiz.className = "cpo-panel";
  raiz.innerHTML =
    '<div id="cpo-cab" class="cpo-cab">' +
    '<h2 id="cpo-h"></h2>' +
    '<p id="cpo-linea" class="cpo-linea"></p>' +
    '<p id="cpo-aviso" class="cpo-aviso" role="status"></p>' +
    '<p id="cpo-conexion" class="cpo-conexion" role="status" aria-live="polite" hidden></p>' +
    "</div>" +
    '<div id="cpo-tus-buscar" class="cpo-tus-buscar" hidden></div>' +
    '<div id="cpo-previa" class="cpo-previa" hidden>' +
    '<img id="cpo-logo" class="cpo-logo" alt="" hidden><p id="cpo-premio" class="cpo-premio"></p></div>' +
    '<div id="cpo-qr" class="cpo-qr" hidden><img id="cpo-qr-img" alt=""></div>' +
    '<p id="cpo-numero" class="cpo-numero" hidden><span id="cpo-n"></span> <span id="cpo-n-etiqueta" class="cpo-n-etiqueta"></span></p>' +
    '<div id="cpo-acciones" class="cpo-acciones"><div id="cpo-fila" class="cpo-viva"></div></div>' +
    '<ul id="cpo-ganadoras" class="cpo-ul cpo-ganadoras" hidden></ul>' +
    '<div id="cpo-lista" class="cpo-lista" hidden>' +
    '<p id="cpo-antes" class="cpo-nota" hidden></p><p id="cpo-nota" class="cpo-nota" hidden></p><ul id="cpo-ul" class="cpo-ul"></ul><p id="cpo-pie" class="cpo-pie"></p></div>' +
    '<input type="file" id="cpo-archivo" accept=".json,application/json" hidden>';
  const q = <T extends HTMLElement>(id: string): T => raiz.querySelector<T>(`#${id}`) as T;
  const tituloEl = q("cpo-h");
  /** La marca de servicio pagado: se arma recién cuando hace falta, así con el cobro apagado el DOM es el de siempre. */
  let marcaEl: HTMLElement | null = null;
  /** De quién es la campaña por activar, arriba del título, con la sesión puesta: el título ya es lo que falta. */
  let deEl: HTMLElement | null = null;
  const cabEl = q("cpo-cab");
  const lineaEl = q("cpo-linea");
  const avisoEl = q("cpo-aviso");
  const buscarEl = q("cpo-tus-buscar");
  const conexionEl = q("cpo-conexion");
  const previaEl = q("cpo-previa");
  const logoEl = q<HTMLImageElement>("cpo-logo");
  const premioEl = q("cpo-premio");
  const qrBloque = q("cpo-qr");
  const qrImg = q<HTMLImageElement>("cpo-qr-img");
  const numeroBloque = q("cpo-numero");
  const numeroEl = q("cpo-n");
  const etiquetaEl = q("cpo-n-etiqueta");
  const accionesEl = q("cpo-acciones");
  /**
   * La fila viva: lo que el panel espera, en el lugar del botón apagado. Es el único aviso que se anuncia por lo que cambia:
   * solo se reescribe cuando cambia lo que dice, así el lector de pantalla lo oye una vez.
   */
  const filaEl = q("cpo-fila");
  const filaViva = crearFilaViva(filaEl, { hace: (n) => fmt("cpoFvHace", { n }) });
  const ganadorasEl = q<HTMLUListElement>("cpo-ganadoras");
  const listaBloque = q("cpo-lista");
  const notaEl = q("cpo-nota");
  const antesEl = q("cpo-antes");
  const ulEl = q<HTMLUListElement>("cpo-ul");
  const pieEl = q("cpo-pie");
  const archivoEl = q<HTMLInputElement>("cpo-archivo");

  /* --- estado --- */
  let vista: Vista = "elegir";
  let vistaAntes: Vista = "elegir";
  let archivo: { texto: string; firma: string } | null = null;
  /** El token que esta compu inventa para crear la sala de este archivo: igual en cada reintento, para no perder la sala. */
  let intento: string | null = null;
  let campana: Campana | null = null;
  /** La cuenta que el archivo pide para sellar, si pide una. Al retomar una sala no se conoce y queda en `null`. */
  let pide: string | null = null;
  let sala: SalaDeCampana | null = null;
  /**
   * El borrador de una campaña sin firma: sale de crear-campana.html o de un archivo sin firma. No tiene sala hasta que se paga
   * la comisión y la sala lo firma (`activar`): antes de cobrar no se crea nada. Son los datos sin cuenta, que se suma al activar.
   */
  let borrador: Record<string, unknown> | null = null;
  let activacion: Activacion = { tipo: "esperando" };
  /** Si la sala puede activar el borrador: se pregunta antes de ofrecer el pago, y con un no, no se cobra. */
  let salaDeActivar: "preguntando" | "lista" | "no" = "lista";
  /** Para la espera hasta la hora de crear la sala de un borrador activado antes de tiempo. */
  let pararTemprano: (() => void) | null = null;
  /** Quien organiza pidió abrir ya una campaña activada antes de tiempo. Vale hasta que se abre o cambia el borrador. */
  let abrirYa = false;
  /** La campaña que se pidió abrir ya: de ahí sale la hora de volver a probar si la sala falla. Sin pedido, `null`. */
  let temprana: { abreMs: number; sorteoMs: number } | null = null;
  /** Cuántas veces se programó volver a probar sola la activación pedida con abrir ya. */
  let reintentosAutomaticos = 0;
  /**
   * Lo que se sabe de si la campaña de personas que está a la vista se puede abrir: se está preguntando, o no se puede (el
   * modo no está prendido). Vale solo para la campaña con que se preguntó: con otra, o con una de cuentas, es `null` y el
   * panel es el de siempre.
   */
  let personas: { de: Campana; estado: "mirando" | "no" } | null = null;
  /** La fase en que la sala dijo que está: lo que se guarda para retomar. */
  let faseSala: FaseDeSala = "lista";
  /**
   * Quién organiza la sala a la vista: su cuenta, `null` si la campaña no nombra a nadie, y `undefined` si es una memoria de
   * antes de guardar la cuenta que todavía no se completó (hace falta una sesión).
   */
  let duena: string | null | undefined = null;
  /** Una campaña quedó fuera de la vista porque entró otra cuenta: al volver la dueña se retoma. Nada se borra. */
  let apartada = false;
  let completando = false;
  /** Cuántas veces se volvió a probar completar de quién es la sala tras una lectura que falló, y cómo cancelar la espera. */
  let intentosDeLaDuena = 0;
  let reintentoDeLaDuena: (() => void) | null = null;
  let cierraMs = 0;
  let mensaje = "";
  let trabajando = false;
  /** En qué va la activación y la apertura de la inscripción: lo que dice la fila viva. */
  let etapa: "activando" | "sala" | "abriendo" | null = null;
  /**
   * La sala ya firmó el borrador y falta crear la sala y abrir la inscripción. La pantalla sigue siendo la de la activación
   * (mismo título, mismo panel solo, sin la barra de pasos) hasta que la inscripción abre: el archivo y el borrador cambian a mitad
   * de camino, pero lo que se ve no salta.
   */
  let activandoLaSala = false;
  /** Se está leyendo la lista completa de la sala, antes de pasarla al sorteo: la fila lo dice mientras tarda. */
  let leyendoLaLista = false;
  /** El cobro estaba esperándose cuando se pintó la última vez: si ahora está pagado, el tilde de la marca salta una vez. */
  let esperabaElCobro = false;
  let marcaVista = false;
  let pase: string | null = null;
  let paseDesde = 0;
  let paseCaido = false;
  /** La sala dijo que no a este panel (token que no vale): no se arregla reintentando, se deja de pedir y se dice. */
  let paseRechazado = false;
  let paseEnCurso = false;
  /** Cuánto adelanta (o atrasa) la hora de la sala respecto de esta compu, estimado con cada pase. */
  let desfase = 0;
  /** Si ya llegó algún pase que permita corregir el reloj: sin eso, `desfase` en cero es solo que no se sabe. */
  let relojEstimado = false;
  const filas = new Map<number, Fila>();
  /** Las filas que llegaron o están por descifrarse: cuenta lo que pidió la sala aunque la fila todavía no esté lista. */
  const llegados = new Set<number>();
  /**
   * Las que la sala ya confirmó como quitadas: una consulta que salió antes de la quita puede traerlas de vuelta, y la sala
   * ya no las tiene. Los números no se reusan. Se vacía con la lista, que siempre va junto con un cambio de sala o de lectura.
   */
  const quitadas = new Set<number>();
  const enCurso = new Set<Promise<void>>();
  const mostradas = new Set<number>();
  const preguntando = new Set<number>();
  const pendientes = new Map<number, { motivo: MotivoDeSalida; parar: () => void }>();
  /** Las que ya se mandaron y la sala todavía no confirmó: siguen escondidas y se reintentan solas. */
  const enviando = new Map<number, MotivoDeSalida>();
  const reintentos = new Map<number, () => void>();
  const vuelo = new Map<number, Promise<boolean>>();
  /** El orden en que está dibujada la lista: mientras el dedo o el puntero están encima, no se reordena. */
  let pintadas: number[] = [];
  let firmaDeLista = "";
  let firmaDeAcciones = "";
  let punteroDentro = false;
  let marca = 0;
  /**
   * Lo que se leyó del premio en la cuenta que lo paga. `bueno` es la última lectura que contestó (alcanza o falta) y a qué hora
   * se empezó a leer: una relectura que falla no la pisa, y a partir del minuto ya no se afirma. `de` es la hora en que empezó la
   * última lectura terminada, y de ahí sale el reloj. Sin `deps.deposito` no se mira nada.
   */
  let deposito: {
    clave: string;
    bueno: { estado: Exclude<EstadoDelDeposito, { tipo: "sin-lectura" }>; de: number } | null;
    de: number;
    enVuelo: boolean;
    /** Mientras la primera lectura de esta clave y su único reintento no terminan, la línea espera vacía, con su alto. */
    inicial: boolean;
    /** Cuándo empezó la primera lectura: pasado un minuto sin respuesta, la línea ya dice que no se pudo ver. */
    inicio: number;
    /** Si ya se lanzó la relectura que sigue a esta lectura: el reloj pasa entonces al vencimiento. */
    releyendo: boolean;
  } | null = null;
  let ultimaMiradaDelDeposito = 0;
  let depositoDetenido = false;
  /** La clave cuya primera lectura ya tuvo su único reintento. */
  let claveReintentada = "";
  let pararRelojDelDeposito: (() => void) | null = null;
  let pararReintentoDelDeposito: (() => void) | null = null;
  /** La línea del premio: sin `deps.deposito` no existe y el panel es el de siempre. Con él, mientras corresponde, está a la vista con su alto. */
  let depositoEl: HTMLElement | null = null;
  let escucha: { parar: () => void; consultar: () => Promise<void> } | null = null;
  let pararPase: (() => void) | null = null;
  let pararCierre: (() => void) | null = null;
  let pararVencimiento: (() => void) | null = null;
  let reintentar: (() => void) | null = null;
  /**
   * El id de la sala guardada que se está retomando mientras `sala` todavía no la tiene: la que se borró o la de la pantalla sin
   * conexión. Sin sesión, Dejar saca esa y ninguna otra.
   */
  let idEnVista: string | null = null;
  let retomada = false;
  /** Si ya se pasó la lista cerrada al sorteo: desde entonces cada cambio la vuelve a pasar. */
  let pasada = false;
  let sinLeer = false;
  /** Mientras se cierra y se lee la lista desde esta pantalla: no es "retomada", no hace falta tocar Pasar la lista. */
  let cerrandoAhora = false;
  let entroAConfirmar = 0;
  /** La pregunta de dejar la campaña salió de Armar otra campaña: al confirmar, además se abre el selector de archivo. */
  let armandoOtra = false;
  let ultimoEnlace = "";
  let pararDespertar: (() => void) | null = null;
  let dejarElPuente: (() => void) | null = null;
  let dejarLaSesion: (() => void) | null = null;
  /* Tus campañas: las filas a la vista, de qué cuenta son, y lo que pasa con cada pedido. */
  let tus: CampanaDeCuenta[] = [];
  let tusDeCuenta: string | null = null;
  let tusPidiendo = false;
  /** Las cuentas para las que esta pestaña ya pidió la lista sin que nadie lo tocara: se pide una vez por pestaña y por cuenta. */
  const tusPedidasPara = new Set<string>();
  let tusFalla: FallaDeFila | null = null;
  /**
   * Si la sala de afuera tiene Tus campañas. Se le pregunta una vez por pestaña, con un pedido que no gasta nada, y recién con un
   * sí se ofrece algo. Con una sala que no contestó se vuelve a preguntar la próxima vez, y mientras tanto no se ofrece nada.
   * Tras dos sin respuesta seguidas (la sala de hoy, sin la ruta, se ve así) se deja de preguntar por `ESPERA_DE_TUS_SIN_RESPUESTA_MS`:
   * la barra de la cuenta avisa la sesión en cada dibujo, y cada aviso no puede ser otro pedido que falla.
   */
  let tusServidor: "sin-saber" | "preguntando" | "si" | "no" = deps.tus?.disponible ? "sin-saber" : "si";
  /** Cuántas preguntas seguidas volvieron sin respuesta, y hasta cuándo no se vuelve a preguntar. */
  let tusSinRespuesta = 0;
  let tusNoPreguntarHasta = 0;
  /** El evento que se está tomando: mientras tanto ningún otro botón de la lista actúa. */
  let tusTrabajando: string | null = null;
  /** A qué evento se le pregunta si se usa acá, y desde qué pantalla se volvió si se cancela. */
  let seguirDe: { evento: string; desde: "tus" | "previa" | "tomada" } | null = null;
  /** Al crear la sala, el servidor dijo que el evento ya tiene una: se ofrece usarla en lugar de mandar a pedir otro archivo. */
  let ofreceUsar: string | null = null;
  /** La campaña se tomó desde otra compu: quienes se anotaron antes salen con su número hasta que escanean el QR nuevo. */
  let recuperada = false;
  let tusEl: HTMLUListElement | null = null;
  let firmaDeTus = "";
  let firmaDeBuscar = "";

  const canal = deps.canal();
  const grande: PantallaGrande = crearPantallaGrande({
    tx,
    idioma: deps.idioma,
    datos: () =>
      sala && campana
        ? {
            campana,
            enlace: enlaceDelQr(),
            qrVigente: qrVigente(),
            rechazado: paseRechazado,
            total: visibles().length,
            cierraMs,
            cerrada: vista === "cerrada",
          }
        : null,
    qr: deps.qr,
    ahora: () => ahoraSala(),
    esperar: deps.esperar,
    pantallaCompleta: deps.pantallaCompleta,
    ventana: deps.ventana,
  });

  /**
   * El cobro de Tinkazo antes de abrir la inscripción. Solo existe con sus dependencias: el panel de las pruebas de siempre
   * no las trae y no cambia en nada. Con la comisión apagada, tampoco.
   */
  const cm: ControlDeComision | null = deps.comision
    ? crearControlDeComision(deps.comision, {
        campana: () => campana,
        pide: () => pide,
        cuenta: () => deps.cuenta(),
        enPrevia: () => vista === "previa",
        // Un borrador no tiene sala todavía: se crea recién cuando la sala lo firma, después de cobrar.
        crearSala: async () => {
          if (borrador !== null && archivo === null) return null;
          const falla = await crearLaSala();
          if (falla !== null && ofreceUsar !== null) irASeguir(ofreceUsar, "previa");
          return falla;
        },
        alCambiar: () => {
          pintar();
          quizasActivar();
        },
        conBorrador: () => borrador !== null && archivo === null,
        aviso: (texto) => aviso(texto),
        tx,
        idioma: () => deps.idioma(),
        ahora: () => deps.ahora(),
        esperar: (f, ms) => deps.esperar(f, ms),
        visible: () => typeof document === "undefined" || document.visibilityState !== "hidden",
        alMirar: () => filaViva.mirada(),
        almacen: deps.almacen,
        puedeEntrar: () => deps.cambiarDeCuenta !== undefined,
      })
    : null;

  /* --- el reloj de la sala --- */

  const ahoraSala = (): number => deps.ahora() + desfase;

  /**
   * La sala contesta con su hora dentro de [hasta - 2 min, hasta). Si la de esta compu cae afuera, va atrasada o adelantada:
   * se corre al medio de la ventana, así ni el pase ni el cierre se piden a destiempo ni cada 5 segundos todo el día.
   * Una compu apenas adelantada pide el pase unos segundos antes de que la sala cruce y recibe el mismo `hasta`: eso no es
   * un desfase de un minuto, y corregirlo así haría saltar la cuenta regresiva hacia atrás y hacia adelante.
   */
  function estimarDesfase(hasta: number): void {
    const ahora = deps.ahora();
    const dentro = ahora >= hasta - VENTANA_DEL_PASE_MS && ahora < hasta + HOLGURA_DEL_RELOJ_MS;
    desfase = dentro ? 0 : hasta - VENTANA_DEL_PASE_MS / 2 - ahora;
    relojEstimado = true;
  }

  const pasoLaHora = (): boolean => ahoraSala() >= cierraMs;

  /* --- las filas --- */

  /** Las que cuentan: sin las que se están quitando. La más nueva arriba, porque la sala numera en orden de llegada. */
  function visibles(): Fila[] {
    return [...filas.values()].filter((f) => !pendientes.has(f.n) && !enviando.has(f.n)).sort((a, b) => b.n - a.n);
  }

  /** Con el foco adentro se mira el elemento enfocado y no un aviso de salida: un botón que se saca del DOM no avisa que se fue. */
  const congelada = (): boolean => preguntando.size > 0 || punteroDentro || ulEl.contains(document.activeElement);

  /** Lo que se guarda para retomar: la sala, lo que ya se hizo y las quitas que todavía no confirmó la sala. */
  function recordar(): void {
    if (!sala || vista === "otra-pestana" || vista === "tomada") return;
    const sinConfirmar: QuitaPendiente[] = [
      ...[...pendientes].map(([n, p]) => ({ n, motivo: p.motivo })),
      ...[...enviando].map(([n, motivo]) => ({ n, motivo })),
    ];
    const memoria: MemoriaDeOrg = { sala, fase: faseSala, mostradas: [...mostradas], pendientes: sinConfirmar };
    if (duena !== undefined) memoria.cuenta = duena;
    if (recuperada) memoria.recuperada = true;
    guardarOrg(deps.almacen, memoria, deps.ahora());
  }

  /** Quienes se están quitando (en Deshacer o mandadas sin confirmar): la lista de la sala todavía los tiene. */
  const quitasEnCurso = (): number[] => [...pendientes.keys(), ...enviando.keys()];

  /** Pasa la lista de la sala al cuadro del sorteo. Cada llamada reemplaza a la anterior: el paso las serializa. */
  function correrPaso(): void {
    if (!sala || !campana) return;
    const ctx: ContextoDelPaso = { campana, mostradas, quitasEnCurso };
    void Promise.resolve(deps.alCerrar(sala, visibles(), ctx)).catch(() => undefined);
  }

  /** Mientras la lista se sella o espera su aviso a la sala, nadie la cambia: ni quitar ni volver a abrir. */
  const listaTrabada = (): boolean => deps.listaBloqueada?.() ?? false;

  function alCambiarLasFilas(): void {
    pintar();
    grande.pintar();
    reponerLasEtiquetas();
    if (sala && vista === "cerrada" && pasada) correrPaso();
  }

  /**
   * Al retomar una campaña ya pasada, cuántas filas tiene la sala: cuando el panel las tiene todas se las da a la herramienta,
   * una sola vez, para que reponga los nombres que la pestaña haya perdido. Sin quitas a medias: con una, la lista de la sala
   * todavía no es la que se va a sellar.
   */
  let totalParaReponer: number | null = null;

  function reponerLasEtiquetas(): void {
    if (totalParaReponer === null || !sala || vista !== "cerrada" || !pasada) return;
    const todas = visibles();
    if (todas.length !== totalParaReponer || quitasEnCurso().length > 0) return;
    totalParaReponer = null;
    deps.reponerEtiquetas?.(sala, todas);
  }

  /** Deja la lista en blanco, con lo que se estaba por quitar: se vuelve a leer de la sala. */
  function vaciarFilas(): void {
    totalParaReponer = null;
    filas.clear();
    llegados.clear();
    pendientes.clear();
    enviando.clear();
    quitadas.clear();
    vuelo.clear();
    preguntando.clear();
    pintadas = [];
    firmaDeLista = "";
  }

  /** Una alta: se descifra con la clave que nunca salió de esta compu. Nada se quita solo: lo decide quien organiza. */
  async function recibir(x: EquipoDeSala, m: number): Promise<void> {
    const s = sala;
    if (!s) return;
    const datos = await deps.descifrar(s.clave, x.d);
    if (m !== marca) return;
    const rev = datos ? revisarEquipo(datos) : null;
    const nombre = rev && rev.equipo.nombre.trim() !== "" ? rev.equipo.nombre : null;
    const revisar = (rev?.revisar ?? false) && !mostradas.has(x.n);
    filas.set(x.n, { n: x.n, cuenta: x.cuenta, nombre, revisar });
    alCambiarLasFilas();
  }

  function alEquipo(x: EquipoDeSala, m: number): void {
    if (!sala || m !== marca || quitadas.has(x.n)) return;
    // Se anota antes de descifrar: así quien se pone al día sabe cuántas llegaron aunque falte descifrar.
    llegados.add(x.n);
    const trabajo = recibir(x, m);
    enCurso.add(trabajo);
    void trabajo.finally(() => enCurso.delete(trabajo));
  }

  /** Espera a que terminen los descifrados que ya empezaron (y los que empiecen mientras tanto). */
  async function esperarDescifrados(): Promise<void> {
    while (enCurso.size > 0) await Promise.allSettled([...enCurso]);
  }

  /** Alguien la quitó desde otra pestaña (o la sala confirmó la nuestra): ya no tiene que verse. */
  function seQuito(n: number): void {
    pendientes.get(n)?.parar();
    pendientes.delete(n);
    reintentos.get(n)?.();
    reintentos.delete(n);
    preguntando.delete(n);
    enviando.delete(n);
    llegados.delete(n);
    quitadas.add(n);
    if (filas.delete(n)) {
      recordar();
      alCambiarLasFilas();
    }
  }

  /** El sondeo trae de a 200 y una campaña admite 300: se vuelve a pedir mientras falten filas y sigan llegando. */
  async function ponerseAlDia(total: number): Promise<void> {
    const m = marca;
    for (let vuelta = 0; vuelta < 3 && llegados.size < total; vuelta++) {
      const antes = llegados.size;
      await escucha?.consultar();
      if (m !== marca || llegados.size === antes) return;
    }
  }

  /* --- escuchar la sala y las pestañas --- */

  function oirLaSala(s: SalaDeCampana): void {
    escucha?.parar();
    const m = marca;
    escucha = deps.escuchar(s, {
      alNombre: () => undefined,
      alEquipo: (x) => alEquipo(x, m),
      alEquipoQuitado: (n) => {
        if (m === marca) seQuito(n);
      },
      alCerrada: () => {
        if (m === marca) void sospechaDeBorrada(s);
      },
      alTomada: () => {
        if (m === marca) tomada();
      },
    });
    // La que escucha es la última en avisar: cualquier otra pestaña con esta sala deja de escucharla.
    canal?.enviar(s.id);
  }

  function dejarDeEscuchar(): void {
    escucha?.parar();
    escucha = null;
    pararPase?.();
    pararPase = null;
    pararCierre?.();
    pararCierre = null;
    pararVencimiento?.();
    pararVencimiento = null;
    paseEnCurso = false;
    for (const p of pendientes.values()) p.parar();
    for (const parar of reintentos.values()) parar();
    reintentos.clear();
  }

  canal?.alRecibir((id) => {
    // Solo cede quien está escuchando esa sala: una pestaña que apenas eligió su archivo no tiene nada que ceder.
    if (!sala || sala.id !== id || escucha === null || vista === "otra-pestana") return;
    dejarDeEscuchar();
    marca++;
    grande.cerrar();
    vaciarFilas();
    vistaAntes = vista;
    vista = "otra-pestana";
    mensaje = "";
    pintar();
  });

  /** Esta pestaña pasa a ser la que escucha: la otra se entera por el canal y cede. */
  function usarAca(): void {
    const g = leerOrg(deps.almacen, deps.ahora(), deps.red(), deps.cuenta());
    if (g) void retomar(g);
    else olvidar();
  }

  /* --- otra compu tomó la campaña --- */

  /**
   * La sala ya no acepta el token de esta compu: la misma cuenta abrió la campaña en otra. Se deja de escuchar, se cierra la
   * pantalla grande y el QR sale de la vista. No se borra nada: Dejar esta campaña es lo único que olvida lo guardado, y no le
   * toca la sala a nadie. Se detecta por una respuesta concreta (403 `token`, el cierre 4001 o 4401 del socket, `tuya` en falso),
   * nunca por la falta de respuesta.
   */
  function tomada(): void {
    if (!sala || vista === "tomada" || vista === "otra-pestana") return;
    dejarDeEscuchar();
    marca++;
    grande.cerrar();
    vaciarFilas();
    ulEl.replaceChildren();
    pase = null;
    paseCaido = false;
    paseRechazado = false;
    paseEnCurso = false;
    ultimoEnlace = "";
    trabajando = false;
    reintentar = null;
    mensaje = "";
    vista = "tomada";
    // Si todavía no se sabía si la sala tiene Tus campañas, se vuelve a preguntar: del resultado depende el botón de esta pantalla.
    void asegurarTus();
    pintar();
  }

  /* --- de quién es la sala --- */

  /*
   * Sin ninguna cuenta conectada, lo que la sala acepta con el token guardado (cerrar, quitar, sumar 15 minutos, reabrir, la
   * pantalla grande, el QR y pasar la lista) anda como siempre y no pide entrar: el evento no puede depender de un ingreso nuevo
   * con Google en un wifi donde 150 personas entran a la vez, y mientras la sesión se retoma tras recargar nada abre el ingreso.
   * Con otra cuenta conectada la campaña se aparta (`apartar`). Sellar, guardar el resultado y avisar piden la cuenta dueña.
   */

  const esCuenta = (x: unknown): x is string => typeof x === "string" && /^G[A-Z2-7]{55}$/u.test(x);

  /**
   * Una memoria de antes no guardó de quién es la sala: con una sesión se completa con la cuenta que nombra el texto firmado.
   * Si es la cuenta conectada, sigue. Si es otra, la campaña se aparta de la vista sin borrar nada. Si no se pudo leer, queda
   * para la próxima sesión.
   */
  async function completarLaDuena(): Promise<void> {
    const s = sala;
    const preguntar = deps.organizadoraDeSala;
    if (!s || duena !== undefined || !preguntar || completando || deps.cuenta() === null) return;
    completando = true;
    const m = marca;
    const org = await preguntar(s).catch(() => "red" as const);
    completando = false;
    if (m !== marca || sala !== s) return;
    if (org !== null && !esCuenta(org)) {
      // No se pudo leer el archivo de la campaña: se vuelve a probar en unos segundos, unas pocas veces. Sin esto, la memoria queda
      // sin saber de quién es hasta recargar, y el aviso del sello y el del resultado no salen.
      if (intentosDeLaDuena < MAX_INTENTOS_DE_LA_DUENA) {
        intentosDeLaDuena++;
        reintentoDeLaDuena?.();
        reintentoDeLaDuena = deps.esperar(() => void completarLaDuena(), ESPERA_DE_LA_DUENA_MS);
      }
      return;
    }
    intentosDeLaDuena = 0;
    if (org !== null) {
      // Se anota de quién es aunque sea de otra cuenta: la próxima vez ni se pregunta.
      const g = leerOrg(deps.almacen, deps.ahora(), s.red, null);
      if (g && g.cuenta === undefined) guardarOrg(deps.almacen, { ...g, cuenta: org }, deps.ahora());
      if (!seVeDesde(org, deps.cuenta())) return apartar();
    }
    duena = org;
    recordar();
    deps.alRetomar?.(faseSala, s);
    pintar();
  }

  /**
   * Entró otra cuenta: la campaña sale de la vista y el panel queda como en un navegador sin campañas. No borra nada (ni la sala,
   * ni su token, ni lo que recuerda del sorteo): al volver la cuenta dueña se retoma.
   */
  function apartar(): void {
    const s = sala;
    dejarDeEscuchar();
    marca++;
    pararDespertar?.();
    grande.cerrar();
    vaciarFilas();
    mostradas.clear();
    sala = null;
    idEnVista = null;
    campana = null;
    pide = null;
    duena = null;
    recuperada = false;
    archivo = null;
    intento = null;
    pase = null;
    paseCaido = false;
    paseRechazado = false;
    paseEnCurso = false;
    desfase = 0;
    relojEstimado = false;
    ultimoEnlace = "";
    faseSala = "lista";
    retomada = false;
    pasada = false;
    sinLeer = false;
    reintentar = null;
    trabajando = false;
    pintadas = [];
    firmaDeLista = "";
    ulEl.replaceChildren();
    cm?.reiniciar();
    if (s) deps.alApartar?.(s);
    ponerPaso({ paso: "nada" });
    ponerRechazo(null);
    apartada = true;
    vista = "elegir";
    mensaje = "";
    pintar();
  }

  /** Lo mismo con una campaña por activar: queda guardada, solo que otra cuenta no la ve. */
  function apartarElBorrador(): void {
    pararTemprano?.();
    pararTemprano = null;
    abrirYa = false;
    temprana = null;
    borrador = null;
    archivo = null;
    intento = null;
    campana = null;
    pide = null;
    activacion = { tipo: "esperando" };
    cm?.reiniciar();
    apartada = true;
    mensaje = "";
    vista = "elegir";
    pintar();
  }

  /* --- Tus campañas: la lista de la cuenta y usar una en otra compu --- */

  /** Tus campañas solo existe en el modo oficial y con la sala de afuera conectada: en Prueba y en el stand no hay nada que pedir. */
  const tusDelModo = (): boolean => deps.tus !== undefined && deps.red() === "mainnet" && !deps.enStand() && !deps.enEnsayo();
  /** Y solo si la sala de afuera tiene la función: ni líneas, ni enlaces, ni botones que prometen lo que todavía no existe. */
  const tusPosible = (): boolean => tusDelModo() && tusServidor === "si";

  /** La pregunta en curso: quien llega mientras se espera la respuesta espera la misma. */
  let tusPregunta: Promise<void> | null = null;

  /** Le pregunta a la sala una vez por pestaña si tiene Tus campañas, y vuelve a dibujar con la respuesta. */
  function asegurarTus(): Promise<void> {
    const d = deps.tus;
    if (!d || !tusDelModo() || tusServidor === "si" || tusServidor === "no") return Promise.resolve();
    if (tusPregunta) return tusPregunta;
    if (deps.ahora() < tusNoPreguntarHasta) return Promise.resolve();
    tusServidor = "preguntando";
    tusPregunta = (async (): Promise<void> => {
      const hay = await Promise.resolve(d.disponible?.() ?? true).catch((): null => null);
      tusServidor = hay === true ? "si" : hay === false ? "no" : "sin-saber";
      tusSinRespuesta = hay === null ? tusSinRespuesta + 1 : 0;
      if (tusSinRespuesta >= 2) tusNoPreguntarHasta = deps.ahora() + ESPERA_DE_TUS_SIN_RESPUESTA_MS;
      tusPregunta = null;
      pintar();
    })();
    return tusPregunta;
  }
  /** Usar una campaña en esta compu pide la cuenta conectada y poder pedir su sesión. */
  const puedeUsarAqui = (): boolean => tusPosible() && deps.cuenta() !== null && deps.sesion !== undefined;

  /** Lo que dice y ofrece una fila de Tus campañas desde este momento. Una sola hora decide el botón y el texto de una activada. */
  function describirTus(f: CampanaDeCuenta): { linea: string; usable: boolean; ayuda: boolean } {
    const idioma = deps.idioma();
    const ahora = deps.ahora();
    if (tusFalla !== null && tusFalla.evento === f.evento) return { linea: tusFalla.texto(), usable: tusFalla.boton !== null, ayuda: false };
    const terminada = {
      linea: fmt("cpoTusTerminadaL", { fecha: fechaTexto(Math.min(f.sorteoMs, ahora), f.zona, idioma) }),
      usable: false,
      ayuda: false,
    };
    if (f.estado === "terminada") return terminada;
    if (f.estado === "activada") {
      if (f.cierraMs <= ahora) return terminada;
      const desde = desdeCuandoSePuedePreparar(f.sorteoMs);
      if (ahora < desde) {
        const linea = fmt("cpoTusDespuesL", { fecha: fechaTexto(desde, f.zona, idioma), hora: horaTexto(desde, f.zona, idioma) });
        return { linea, usable: false, ayuda: false };
      }
      const linea = fmt("cpoTusAbreL", { fecha: fechaTexto(f.abreMs, f.zona, idioma), hora: horaTexto(f.abreMs, f.zona, idioma) });
      return { linea, usable: true, ayuda: false };
    }
    switch (f.fase) {
      case "abierta": {
        const n = f.total ?? 0;
        return { linea: n === 1 ? tx("cpoTusAbierta1") : fmt("cpoTusAbiertaN", { n }), usable: true, ayuda: false };
      }
      case "cerrada":
        return { linea: tx("cpoTusCerradaL"), usable: true, ayuda: false };
      case "sellada":
        return { linea: tx("cpoTusSelladaL"), usable: false, ayuda: true };
      case "sorteada":
        return { linea: tx("cpoTusSorteadaL"), usable: true, ayuda: false };
      default:
        return { linea: tx("cpoTusListaL"), usable: true, ayuda: false };
    }
  }

  /** La campaña de la primera fila que se puede usar: lleva el botón principal. Las demás, el secundario. */
  const primarioDeTus = (): string | null => tus.find((f) => describirTus(f).usable)?.evento ?? null;

  /** ¿Sirve todavía para organizar? Una activada con el cierre pasado ya no. */
  const vigenteEnTus = (f: CampanaDeCuenta): boolean => f.estado === "viva" || (f.estado === "activada" && f.cierraMs > deps.ahora());

  /**
   * Pide la lista de campañas de la cuenta, con la intención de organizar: al abrir la dirección del panel (una vez por pestaña y
   * por cuenta) o al tocar Ver tus campañas. Con la lista vacía, solo con campañas terminadas o con cualquier falla (también una
   * sala que todavía no tiene la ruta) el panel queda como siempre: sin una pantalla de error. Lo que pide quien toca el enlace,
   * en cambio, se contesta con una línea.
   */
  async function pedirTus(explicita: boolean): Promise<void> {
    const d = deps.tus;
    if (!d || !tusDelModo() || tusPidiendo) return;
    // Antes de pedir nada se sabe si la sala tiene la función: sin ella no se pregunta ni se dice nada.
    if (tusServidor !== "si") {
      await asegurarTus();
      if (!tusPosible() || tusPidiendo) return;
    }
    const cuenta = deps.cuenta();
    if (cuenta === null) {
      // Sin sesión la vista pide entrar con Google, y al llegar la sesión se pide la lista.
      if (explicita && vista === "elegir") {
        tus = [];
        tusDeCuenta = null;
        mensaje = "";
        vista = "tus";
        pintar();
      }
      return;
    }
    if (!explicita && tusPedidasPara.has(cuenta)) return;
    tusPidiendo = true;
    pintar();
    const sesion = await Promise.resolve(deps.sesion?.() ?? null).catch(() => null);
    if (sesion === null || sesion === "") {
      tusPidiendo = false;
      if (explicita) mensaje = tx("cpoTusSesionL");
      return pintar();
    }
    tusPedidasPara.add(cuenta);
    const r = await d.listar(sesion).catch((): ResultadoDeMisCampanas => ({ ok: false, motivo: "sin-funcion" }));
    tusPidiendo = false;
    // Mientras se esperaba la persona pudo seguir con otra cosa o entrar con otra cuenta: no se le cambia la pantalla.
    const libre = (vista === "elegir" || vista === "tus") && sala === null && borrador === null && archivo === null;
    if (!libre || deps.cuenta() !== cuenta) return pintar();
    const nada = (clave: string): void => {
      tus = [];
      tusDeCuenta = null;
      if (vista === "tus") vista = "elegir";
      if (explicita) mensaje = tx(clave);
      pintar();
    };
    // Una lista vacía y una falla no se dicen igual: quien toca Ver tus campañas con su campaña en otra compu no puede leer que no hay.
    if (!r.ok) return nada(r.motivo === "sesion" ? "cpoTusSesionL" : r.motivo === "limite" ? "cpoSinConexion" : "cpoTusFalloL");
    const ordenadas = ordenDeTus(r.campanas);
    if (!ordenadas.some(vigenteEnTus)) return nada("cpoTusNada");
    tus = ordenadas.slice(0, MAX_FILAS_DE_TUS);
    tusDeCuenta = cuenta;
    tusFalla = null;
    mensaje = "";
    vista = "tus";
    pintar();
  }

  /** Al abrir el panel: si no hay otra cosa a la vista y se llegó por la dirección de quien organiza, se pide la lista. */
  function pedirTusAlAbrir(): void {
    if (vista === "elegir" && sala === null && borrador === null && archivo === null && deps.tus?.alAbrir()) void pedirTus(false);
  }

  /** Vuelve a la vista de siempre, la de elegir el archivo. */
  function hacerOtro(): void {
    tus = [];
    tusDeCuenta = null;
    tusFalla = null;
    seguirDe = null;
    mensaje = "";
    vista = "elegir";
    pintar();
  }

  /** Pregunta antes de usar la campaña, porque la otra compu deja de manejarla. */
  function irASeguir(evento: string, desde: "tus" | "previa" | "tomada"): void {
    ofreceUsar = null;
    seguirDe = { evento, desde };
    mensaje = "";
    vista = "seguir";
    pintar();
  }

  function cancelarSeguir(): void {
    const desde = seguirDe?.desde ?? "tus";
    seguirDe = null;
    mensaje = "";
    vista = desde;
    pintar();
  }

  /** Se tocó Usar en esta compu en una fila. Con la inscripción abierta o la lista cerrada pide confirmar antes, como Cerrar la lista. */
  function tocarUsar(evento: string): void {
    const f = tus.find((x) => x.evento === evento);
    if (!f || tusTrabajando !== null) return;
    const enMarcha = f.estado === "viva" && (f.fase === "abierta" || f.fase === "cerrada");
    // Quien ya confirmó y vuelve a probar tras una falla no se vuelve a preguntar.
    if (enMarcha && tusFalla?.evento !== evento) irASeguir(evento, "tus");
    else void usarAqui(evento, "tus");
  }

  /** Lo que se dice de cada motivo por el que una campaña no se pudo usar acá, y si la fila sigue con un botón. */
  function fallaAlUsar(motivo: MotivoDeRecuperar): { clave: string; boton: "usar" | "reintentar" | null } {
    switch (motivo) {
      case "terminada":
        return { clave: "cpoVencida", boton: null };
      case "no-existe":
        return { clave: "cpoSeBorro", boton: null };
      case "sellada":
        return { clave: "cpoTusSelladaL", boton: null };
      case "limite":
        return { clave: "cpoAcLimiteL", boton: "usar" };
      case "sesion":
        return { clave: "cpoTusSesionL", boton: "usar" };
      default:
        return { clave: "cpoSeguirNoL", boton: "reintentar" };
    }
  }

  /** La campaña no se pudo usar acá: la falla se dice en la misma tarjeta, en la fila o en la línea, y el título sigue. */
  function terminarFallo(evento: string, desde: "tus" | "previa" | "tomada", motivo: MotivoDeRecuperar, texto?: string): void {
    tusTrabajando = null;
    seguirDe = null;
    // La sala dice que tiene la función apagada (el 503 apagada): no se vuelve a ofrecer, ni se deja un botón que prueba de nuevo
    // para siempre. En la pantalla de tomada queda Dejar esta campaña, que sí sale del apuro. Un 404 sin motivo llega como `red` y
    // deja probar de nuevo.
    const sinFuncion = motivo === "sin-funcion";
    if (sinFuncion) tusServidor = "no";
    const { clave, boton: boton1 } = sinFuncion && desde !== "tus" ? { clave: "cpoSeguirAunNoL", boton: null } : fallaAlUsar(motivo);
    const dicho = texto === undefined ? (): string => tx(clave) : (): string => texto;
    if (desde === "tus") {
      vista = "tus";
      if (motivo === "sellada") {
        // La fila pasa a decir lo que es: sellada en otra compu, con su ayuda.
        tus = tus.map((f): CampanaDeCuenta => (f.evento === evento ? { ...f, estado: "viva", fase: "sellada" } : f));
        tusFalla = null;
      } else {
        tusFalla = { evento, texto: dicho, boton: texto === undefined ? boton1 : "reintentar" };
      }
    } else {
      vista = desde;
      mensaje = motivo === "sellada" ? tx("cpoTusSelladaL") : dicho();
    }
    pintar();
  }

  /**
   * Usa la campaña en esta compu. Con la sala abierta, la sala da un token nuevo y deja sin efecto el de la otra compu: el sitio
   * arma la memoria con una clave de nombres nueva y retoma como siempre. Con la campaña activada y sin sala, toma el archivo
   * firmado sin vista previa (ya está pagada), crea la sala y llega a Abrir la inscripción. La falla se dice en la misma tarjeta.
   */
  async function usarAqui(evento: string, desde: "tus" | "previa" | "tomada"): Promise<void> {
    const d = deps.tus;
    if (!d || tusTrabajando !== null) return;
    tusTrabajando = evento;
    ofreceUsar = null;
    if (desde === "tus") tusFalla = null;
    mensaje = "";
    pintar();
    const cuenta = deps.cuenta();
    const sesion = cuenta === null ? null : await Promise.resolve(deps.sesion?.() ?? null).catch(() => null);
    if (cuenta === null || sesion === null || sesion === "") return terminarFallo(evento, desde, "sesion");
    const r = await d.recuperar(sesion, evento).catch((): ResultadoDeRecuperar => ({ ok: false, motivo: "red" }));
    if (!r.ok) return terminarFallo(evento, desde, r.motivo);
    if (r.estado === "viva") {
      // La memoria se guarda antes de cualquier otra cosa: el token nuevo ya vale y el de la otra compu dejó de valer.
      const s: SalaDeCampana = { ...r.sala, clave: generarClave(), evento, red: deps.red() };
      const g: MemoriaDeOrg = { sala: s, fase: r.fase, cuenta, recuperada: true };
      guardarOrg(deps.almacen, g, deps.ahora());
      guardarTokenDeEvento(deps.almacen, { evento, token: s.token, cuenta });
      if (r.fase === "sorteada") await d.armarSorteo(s, cuenta).catch(() => false);
      tus = [];
      tusDeCuenta = null;
      tusFalla = null;
      seguirDe = null;
      tusTrabajando = null;
      archivo = null;
      intento = null;
      // Entró otra cuenta mientras se esperaba: la campaña queda guardada para la suya y esta no la ve.
      if (!seVeDesde(cuenta, deps.cuenta())) {
        vista = "elegir";
        return pintar();
      }
      if (cm?.activo()) quitarElBorradorDe(evento);
      // La memoria ya está guardada: si algo falla al leer la sala, la pantalla ofrece probar de nuevo y no pierde la campaña.
      return retomar(g).catch(() => ponerSinRed(g));
    }
    if (r.anterior !== null) guardarTokenDeEvento(deps.almacen, { evento, token: r.anterior, cuenta });
    vista = "cargando";
    pintar();
    const dicho = await tomarArchivo(r.archivo).catch(() => tx("cpoSeguirNoL"));
    if (dicho !== null) return terminarFallo(evento, desde, "red", dicho);
    // Sin vista previa: la campaña ya está pagada. Mientras se crea la sala no se muestra nada de lo que cobra.
    vista = "cargando";
    pintar();
    const falla = await crearLaSala().catch(() => tx("cpoSeguirNoL"));
    if (falla !== null || !sala || !campana) {
      soltarElArchivo();
      return terminarFallo(evento, desde, "red", falla ?? tx("cpoSeguirNoL"));
    }
    tus = [];
    tusDeCuenta = null;
    tusFalla = null;
    seguirDe = null;
    tusTrabajando = null;
    irA("lista", campana.cierraMs);
  }

  /** Deja el archivo que se había tomado: la vista de elegir sin nada a medias. */
  function soltarElArchivo(): void {
    archivo = null;
    intento = null;
    campana = null;
    pide = null;
    cm?.reiniciar();
  }

  /** La lista de Tus campañas, dibujada una sola vez por cada cambio de lo que se ve. */
  function pintarTus(): void {
    const ver = vista === "tus" && tus.length > 0;
    if (!ver) {
      // Escondida y vacía: ningún botón de una fila se queda en la página mientras la persona está en otra pantalla.
      if (tusEl) {
        tusEl.hidden = true;
        if (firmaDeTus !== "") tusEl.replaceChildren();
        firmaDeTus = "";
      }
      return;
    }
    const filasDeTus = tus.map((f) => ({ f, d: describirTus(f) }));
    const primero = primarioDeTus();
    const firma = JSON.stringify([
      deps.idioma(),
      tusTrabajando,
      primero,
      filasDeTus.map((x) => [x.f.evento, x.f.empresa, x.d.linea, x.d.usable, x.d.ayuda, tusFalla?.evento === x.f.evento ? tusFalla.boton : ""]),
    ]);
    if (!tusEl) {
      const ul = document.createElement("ul");
      ul.id = "cpo-tus";
      ul.className = "cpo-ul cpo-tus";
      q("cpo-cab").after(ul);
      ul.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-evento]");
        if (b && !b.disabled) tocarUsar(b.dataset.evento ?? "");
      });
      tusEl = ul;
    }
    tusEl.hidden = false;
    // Con más de una que se puede usar, el botón de la barra dice el nombre de la empresa y su fila lleva la marca del costado.
    tusEl.classList.toggle("cpo-tus-varias", filasDeTus.filter((x) => x.d.usable).length > 1);
    if (firma === firmaDeTus) return;
    firmaDeTus = firma;
    tusEl.replaceChildren(
      ...filasDeTus.map(({ f, d }) => {
        const li = document.createElement("li");
        // La fila de la que habla el botón principal de la barra de abajo se distingue de las demás.
        li.className = f.evento === primero ? "cpo-tus-fila cpo-tus-primera" : "cpo-tus-fila";
        li.dataset.evento = f.evento;
        const nombre = document.createElement("h3");
        nombre.className = "cpo-tus-nombre";
        nombre.textContent = f.empresa;
        const linea = document.createElement("p");
        linea.className = "cpo-linea";
        linea.textContent = d.linea;
        const acciones = document.createElement("div");
        acciones.className = "cpo-tus-acc";
        // La primera que se puede usar lleva su botón principal en la barra de abajo, siempre a la vista; las demás, el suyo acá.
        if (d.usable && f.evento !== primero) {
          const reintento = tusFalla?.evento === f.evento && tusFalla.boton === "reintentar";
          const b = boton(tx(reintento ? "cpoReintentar" : "cpoUsarAqui"), "ghost", () => tocarUsar(f.evento), tusTrabajando !== null);
          b.dataset.evento = f.evento;
          acciones.append(b);
        }
        if (d.ayuda) {
          const a = document.createElement("a");
          a.className = "enlace";
          a.href = deps.tus?.ayuda(fmt("cpoTusAyudaAsunto", { empresa: f.empresa })) ?? "#";
          a.textContent = tx("cpoTusAyuda");
          acciones.append(a);
        }
        li.append(nombre, linea, acciones);
        return li;
      }),
      // Con otra acción principal en la barra, Hacer otro sorteo es el enlace del final de la lista.
      ...(primero !== null ? [enlaceDeOtro()] : []),
    );
  }

  /** El enlace Hacer otro sorteo al pie de la lista de Tus campañas. */
  function enlaceDeOtro(): HTMLElement {
    const li = document.createElement("li");
    li.className = "cpo-tus-otro";
    li.append(boton(tx("cpoTusOtro"), "enlace", () => hacerOtro()));
    return li;
  }

  /** Ver tus campañas, en la vista de siempre: un renglón de la página y no de la barra de abajo, que ya lleva dos acciones. */
  function pintarTusBuscar(): void {
    const ver = vista === "elegir" && tusPosible();
    const firma = JSON.stringify([ver, deps.idioma(), tusPidiendo]);
    if (firma === firmaDeBuscar) return;
    firmaDeBuscar = firma;
    buscarEl.hidden = !ver;
    buscarEl.replaceChildren(...(ver ? [boton(tx("cpoTusBuscar"), "enlace", () => void pedirTus(true), tusPidiendo)] : []));
  }

  /* --- el pase del QR --- */

  const qrVigente = (): boolean => pase !== null && ahoraSala() - paseDesde <= VIGENCIA_DEL_PASE_MS;

  /** El enlace del celular: el evento, la sala, el pase y el modo antes del #, y la clave después. Nunca el token. */
  function enlaceDelQr(): string | null {
    if (!sala || !pase || !qrVigente()) return null;
    const p = new URLSearchParams({ c: sala.evento, s: sala.id, p: pase, red: sala.red === "mainnet" ? "oficial" : "prueba" });
    return `${deps.origen()}/participar.html?${p.toString()}#${sala.clave}`;
  }

  /** El QR se dibuja en `pintarBloques`, cuando su recuadro está a la vista: ahí se puede medir el lugar que tiene. */
  function pintarQrs(): void {
    pintar();
    grande.pintar();
  }

  /**
   * El QR del panel mide lo mismo en pantalla pero se dibuja para la densidad de ahora: con otro zoom, otra ventana o
   * otro proyector hay que dibujarlo de nuevo, no esperar al próximo pase (que llega cada dos minutos).
   */
  let pararRedibujoDelQr: (() => void) | null = null;
  let vigilaResolucion: MediaQueryList | null = null;
  const redibujarElQr = (): void => {
    pararRedibujoDelQr?.();
    pararRedibujoDelQr = deps.esperar(() => {
      pararRedibujoDelQr = null;
      // Con el recuadro escondido no hay dónde medir: se dibuja de nuevo cuando vuelva a verse (`pintarBloques`).
      if (qrBloque.hidden) {
        ultimoEnlace = "";
        return;
      }
      const enlace = enlaceDelQr();
      if (!enlace || qrImg.hidden) return;
      ultimoEnlace = enlace;
      void deps.qr(qrImg, enlace, 300, true);
    }, REDIBUJO_DEL_QR_MS);
  };
  const alCambiarLaResolucion = (): void => {
    redibujarElQr();
    vigilarLaResolucion();
  };
  /** El navegador avisa una sola vez cuando la densidad deja de ser la de ahora: se vuelve a pedir el aviso con la nueva. */
  function vigilarLaResolucion(): void {
    vigilaResolucion?.removeEventListener("change", alCambiarLaResolucion);
    vigilaResolucion = typeof matchMedia === "function" ? matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
    vigilaResolucion?.addEventListener("change", alCambiarLaResolucion, { once: true });
  }
  addEventListener("resize", redibujarElQr);
  vigilarLaResolucion();
  const dejarElQr = (): void => {
    removeEventListener("resize", redibujarElQr);
    vigilaResolucion?.removeEventListener("change", alCambiarLaResolucion);
    vigilaResolucion = null;
    pararRedibujoDelQr?.();
    pararRedibujoDelQr = null;
  };

  const conPase = (): boolean => vista === "abierta" || vista === "confirmar";

  function pedirElPase(): void {
    pararPase?.();
    pararPase = null;
    const s = sala;
    if (!s || !conPase() || paseEnCurso) return;
    const m = marca;
    paseEnCurso = true;
    void deps.pase(s).then((r) => {
      if (m !== marca) return;
      paseEnCurso = false;
      if (!conPase()) return;
      if (r === "no-existe") return void sospechaDeBorrada(s);
      if (r === "token") return tomada();
      if (r === "rechazo") {
        paseRechazado = true;
        pintar();
        grande.pintar();
        return;
      }
      if (typeof r === "string") {
        paseCaido = true;
        pararPase = deps.esperar(pedirElPase, REINTENTO_PASE_MS);
        pintar();
        grande.pintar();
        return;
      }
      paseCaido = false;
      paseRechazado = false;
      estimarDesfase(r.hasta);
      pase = r.p;
      paseDesde = ahoraSala();
      const espera = Math.min(VENTANA_DEL_PASE_MS, Math.max(PISO_PASE_MS, r.hasta - ahoraSala()));
      pararPase = deps.esperar(pedirElPase, espera);
      pararVencimiento?.();
      // Si no llega otro pase, a los 12 minutos el QR se saca solo: la sala lo rechaza a los 14 a 16.
      pararVencimiento = deps.esperar(() => {
        pararVencimiento = null;
        pintar();
        grande.pintar();
      }, VIGENCIA_DEL_PASE_MS + 1_000);
      pintarQrs();
    });
  }

  /** Vuelve a pedir el pase si nadie lo está esperando ni lo tiene programado: pasa al volver de confirmar o de un fallo. */
  function asegurarPase(): void {
    if (!pararPase && !paseEnCurso) pedirElPase();
  }

  /** La hora de cierre cambia la principal sin que nadie toque nada. */
  function programarCierre(): void {
    pararCierre?.();
    pararCierre = null;
    const falta = cierraMs - ahoraSala();
    if (falta <= 0) return;
    pararCierre = deps.esperar(() => {
      pararCierre = null;
      pintar();
    }, falta);
  }

  /* --- cuando la compu vuelve de dormir o de un corte --- */

  /** Los temporizadores se frenan con la compu dormida: al volver, se pide todo de nuevo sin esperar a que venzan. */
  function despertar(): void {
    if (vista === "sin-red") return void reintentar?.();
    // En la vista previa todavía no hay sala: el cobro vuelve a mirarse antes de salir por falta de sala.
    if (vista === "previa" && cm?.activo()) {
      const t = cm.estado().tipo;
      if (t === "sin-mirar" || t === "duda" || t === "falta-cargar" || t === "mirando") void cm.mirar();
      // Con la compu dormida la espera no corre: si ya es la hora de crear la sala, se sigue.
      if (activacion.tipo === "temprano") {
        volverDeTemprano();
        pintar();
      }
    }
    if (!sala) return;
    if (vista === "abierta" || vista === "confirmar") {
      pedirElPase();
      programarCierre();
    }
    if (vista === "abierta" || vista === "confirmar" || vista === "cerrada") {
      pintar();
      grande.pintar();
      void escucha?.consultar();
    }
  }

  const alVolverLaPestana = (): void => {
    if (document.visibilityState === "visible") despertar();
  };

  function armarDespertar(): void {
    if (pararDespertar) return;
    document.addEventListener("visibilitychange", alVolverLaPestana);
    addEventListener("online", despertar);
    addEventListener("pageshow", despertar);
    pararDespertar = () => {
      document.removeEventListener("visibilitychange", alVolverLaPestana);
      removeEventListener("online", despertar);
      removeEventListener("pageshow", despertar);
      pararDespertar = null;
    };
  }

  /* --- O1 y O2: elegir el archivo y ver la vista previa --- */

  function aviso(texto: string): void {
    // Con la pregunta de usar la campaña en esta compu a la vista, un aviso de otra cosa la contradice.
    if (vista === "seguir") return;
    mensaje = texto;
    pintar();
  }

  /* --- el borrador: una campaña sin firma que se activa sola al pagar --- */

  /** ¿Es el JSON de una campaña sin firma (con su evento) y no un archivo firmado? */
  function esBorrador(crudo: string): boolean {
    try {
      const x: unknown = JSON.parse(crudo);
      return esObjeto(x) && typeof x.evento === "string" && x.texto === undefined && x.firma === undefined;
    } catch {
      return false;
    }
  }

  /** Deja el borrador: ya no se espera nada de él y no vuelve a aparecer al abrir la página. */
  function soltarElBorrador(): void {
    pararTemprano?.();
    pararTemprano = null;
    abrirYa = false;
    temprana = null;
    if (borrador === null) return;
    borrador = null;
    activacion = { tipo: "esperando" };
    borrarBorrador(deps.almacen);
  }

  /** ¿La pantalla es la de un borrador por activar? Lo es con el borrador sin archivo y mientras la sala firmada se crea y se abre. */
  function esDeBorrador(): boolean {
    return archivo === null ? borrador !== null : activandoLaSala;
  }

  /**
   * Toma un borrador como la campaña de esta pantalla y empieza a mirar el cobro. `null` si quedó, y si no, qué se le dice a
   * quien organiza. Lo que la sala va a exigir se comprueba acá, antes de cobrar: un borrador que no sirve no llega a pagarse.
   * La cuenta de quien organiza no viaja en el borrador: se pone al activar, con la sesión de ese momento.
   */
  async function usarBorrador(crudo: string): Promise<string | null> {
    let datos: unknown;
    try {
      datos = JSON.parse(crudo);
    } catch {
      return tx("cpoNoEsCampana");
    }
    if (!esObjeto(datos)) return tx("cpoNoEsCampana");
    const limpio: Record<string, unknown> = { ...datos };
    delete limpio.organizadora;
    const texto = JSON.stringify(limpio);
    const { lectura, red } = leerDelTexto(texto);
    if (!lectura.ok) {
      if (lectura.motivo === "otra-red") return fmt("cpoOtroModo", { modo: tx(nombreDeRed(red)) });
      return fmt("cpoRevisaCampo", { campo: lectura.campo });
    }
    const c = lectura.campana;
    const revisa = (campo: string): string => fmt("cpoRevisaCampo", { campo });
    if (!c.premios.every((p) => p === c.premios[0])) return tx("cpoPremiosIguales");
    if (c.premios.length > 10 || !c.premios.every((p) => esDeCentavosJustos(p) && p >= DOLAR && p <= 10_000n * DOLAR)) return revisa("premios");
    // La red ya la comprobó el lector contra la del sitio, y el cobro solo existe en la red principal.
    if (c.estado !== "abierta") return revisa("estado");
    if (c.entrada !== "google") return revisa("entrada");
    if (c.anotadas !== 0) return revisa("anotadas");
    if (c.contrato !== null || c.promo !== null || c.comprobante !== null) return revisa("contrato");
    // Las mismas reglas con que la sala firma, antes de cobrar: una campaña que la sala no activa no llega a pagarse.
    const regla = reglaQueFalla({ premios: c.premios, cierraMs: c.cierraMs, sorteoMs: c.sorteoMs, nombre: c.empresa.nombre }, deps.ahora());
    if (regla === "cierra_ms") return tx(MUY_LEJOS);
    if (regla === "sorteo_ms") return tx("cpoAcSorteoLejos");
    if (regla === "empresa.nombre") return tx("cpoAcNombre");
    if (regla === "premios") return revisa("premios");
    const v = await deps.validar(texto, deps.ahora());
    if (!v.ok) return v.motivo === "vencida" ? tx("cpoVencida") : revisa(v.campo);
    if (c.cierraMs <= deps.ahora()) return tx("cpoVencida");
    archivo = null;
    intento = null;
    campana = c;
    pide = null;
    sala = null;
    borrador = limpio;
    activacion = { tipo: "esperando" };
    abrirYa = false;
    temprana = null;
    salaDeActivar = deps.salaLista ? "preguntando" : "lista";
    cm?.reiniciar();
    mensaje = "";
    vista = "previa";
    // Con una sesión, el borrador queda anotado a esa cuenta: otra cuenta en esta compu no lo ve ni se le ofrece.
    const quien = deps.cuenta();
    if (quien !== null) anotarDuenaDelBorrador(deps.almacen, quien);
    armarDespertar();
    pintar();
    void cm?.mirar();
    if (salaDeActivar === "preguntando") void preguntarALaSala();
    return null;
  }

  /**
   * Antes de ofrecer el pago de un borrador, la sala dice si puede activarlo ahora. Con un no (apagada, sin sus llaves, sin el
   * portero o sin respuesta) la pantalla lo dice y no ofrece pagar: nadie paga por una campaña que no se puede activar.
   */
  async function preguntarALaSala(): Promise<void> {
    const b = borrador;
    if (b === null || !deps.salaLista) return;
    salaDeActivar = "preguntando";
    pintar();
    const lista = await deps.salaLista().catch(() => false);
    if (borrador !== b) return;
    salaDeActivar = lista ? "lista" : "no";
    pintar();
  }

  /**
   * Con el borrador ya pagado, le pide a la sala que lo firme y sigue el camino de siempre: crear la sala y abrir la inscripción.
   * Mientras corre, nunca se ofrece pagar de nuevo. Si la sala dice que no, queda dicho en una línea y se puede probar otra vez.
   */
  async function activar(): Promise<void> {
    const b = borrador;
    if (b === null || archivo !== null || activacion.tipo === "activando" || trabajando) return;
    const fallo = (motivo: MotivoDeActivar, campo?: string): void => {
      activacion = campo === undefined ? { tipo: "error", motivo } : { tipo: "error", motivo, campo };
      pintar();
      volverAProbarSola(motivo);
    };
    const cuenta = deps.cuenta();
    activacion = { tipo: "activando" };
    etapa = "activando";
    mensaje = "";
    pintar();
    if (cuenta === null || !deps.activar || !deps.sesion) return fallo(cuenta === null ? "sesion" : "apagada");
    const token = await deps.sesion();
    if (borrador !== b) return;
    if (token === null || token === "") return fallo("sesion");
    const r = await deps.activar({ texto: JSON.stringify({ ...b, organizadora: cuenta }), sesion: token });
    if (borrador !== b) return;
    if (!r.ok) return fallo(r.motivo, r.campo);
    // Lo que la sala firmó se lee con el mismo lector de siempre: si no se entiende, no se sigue.
    const { lectura } = leerDelTexto(r.archivo.texto);
    if (!lectura.ok) return fallo("forma", lectura.campo);
    // La sala vive 24 horas desde que se crea: con la apertura lejos, queda activada (el acceso y el pago ya están vistos) y
    // la sala se crea más cerca de la hora. Volver a activar ese día es gratis: la firma de un mismo texto es la misma.
    const desde = lectura.campana.abreMs - ANTICIPO_DE_LA_SALA_MS;
    // Quien organiza puede pedir abrirla ya: vale mientras el sorteo entre en la vida de la sala creada ahora.
    const yaPedido = abrirYa && cabeAbrirYa(lectura.campana.sorteoMs, deps.ahora());
    if (desde > deps.ahora() && !yaPedido) {
      abrirYa = false;
      temprana = null;
      activacion = { tipo: "temprano", abreMs: lectura.campana.abreMs, sorteoMs: lectura.campana.sorteoMs };
      pararTemprano?.();
      const pararLaHora = deps.esperar(() => {
        pararTemprano = null;
        volverDeTemprano();
      }, desde - deps.ahora());
      // El botón Abrir pasa a Abrir la inscripción ahora al cruzar esa hora aunque nada más cambie: se repinta justo ahí.
      const faltaParaAbrirYa = cuandoSePuedeAbrirYa(lectura.campana.sorteoMs) - deps.ahora();
      const pararElAviso = faltaParaAbrirYa > 0 ? deps.esperar(() => pintar(), faltaParaAbrirYa) : (): void => undefined;
      pararTemprano = () => {
        pararLaHora();
        pararElAviso();
      };
      pintar();
      return;
    }
    abrirYa = false;
    temprana = null;
    reintentosAutomaticos = 0;
    pararTemprano?.();
    pararTemprano = null;
    activandoLaSala = true;
    archivo = r.archivo;
    intento = null;
    campana = lectura.campana;
    pide = r.organizadora;
    activacion = { tipo: "hecha" };
    pintar();
    try {
      await abrirInscripcion();
    } finally {
      // Con la inscripción abierta ya no hay nada que mirar. Si falló, el panel pasa al de una campaña con su archivo y lo dice.
      activandoLaSala = false;
      pintar();
    }
  }

  /** Llegó la hora de crear la sala de un borrador activado antes de tiempo: se vuelve a activar y sigue el camino de siempre. */
  function volverDeTemprano(): void {
    if (borrador === null || activacion.tipo !== "temprano" || activacion.abreMs - ANTICIPO_DE_LA_SALA_MS > deps.ahora()) return;
    activacion = { tipo: "esperando" };
    pintar();
    quizasActivar();
  }

  /**
   * Si la sala falló después de pedir abrir ya y el fallo puede pasar solo (la red, la sala sin contestar), vuelve a probar a la
   * hora de abrir la inscripción, o a los 30 segundos si esa hora ya pasó: nadie tiene que acordarse de tocar Probar de nuevo.
   * Son pocos intentos, y lo que pide algo a la persona (entrar, cargar) no se reintenta: ahí manda el botón.
   */
  function volverAProbarSola(motivo: MotivoDeActivar): void {
    if (temprana === null || !SE_REINTENTA_SOLO.has(motivo) || reintentosAutomaticos >= REINTENTOS_AUTOMATICOS) return;
    reintentosAutomaticos += 1;
    const espera = Math.max(temprana.abreMs - ANTICIPO_DE_LA_SALA_MS - deps.ahora(), ESPERA_MINIMA_DEL_REINTENTO_MS);
    pararTemprano?.();
    const b = borrador;
    pararTemprano = deps.esperar(() => {
      pararTemprano = null;
      // Si mientras tanto se probó a mano, se dejó la campaña o ya se abrió, no hay nada que repetir.
      if (borrador === null || borrador !== b || archivo !== null || activacion.tipo !== "error") return;
      activacion = { tipo: "esperando" };
      pintar();
      quizasActivar();
    }, espera);
  }

  /**
   * Quien organiza toca abrir ya una campaña activada antes de tiempo. Se vuelve a activar (gratis: la firma de un mismo texto
   * es la misma) y sigue el camino de siempre: crear la sala y abrir la inscripción. Si la sala falla, el pedido se recuerda y
   * probar de nuevo abre igual.
   */
  function abrirAntesDeTiempo(): void {
    if (borrador === null || activacion.tipo !== "temprano" || !cabeAbrirYa(activacion.sorteoMs, deps.ahora())) return;
    pararTemprano?.();
    pararTemprano = null;
    abrirYa = true;
    temprana = { abreMs: activacion.abreMs, sorteoMs: activacion.sorteoMs };
    reintentosAutomaticos = 0;
    activacion = { tipo: "esperando" };
    pintar();
    quizasActivar();
  }

  /** Cuando el cobro queda pagado y la campaña es un borrador, se activa sola: nadie de Tinkazo firma ni admite nada a mano. */
  function quizasActivar(): void {
    if (borrador !== null && archivo === null && vista === "previa" && activacion.tipo === "esperando" && cm?.estado().tipo === "pagada") {
      void activar();
    }
  }

  /** Un borrador de crear-campana.html en la vista previa, sin pagar y sin nadie adentro: lo que se ve antes de entrar con Google. */
  function porActivarSinSesion(): boolean {
    return borrador !== null && archivo === null && vista === "previa" && campana !== null && deps.cuenta() === null && pasoDeActivar() === null;
  }

  /** La pantalla de un borrador ya pagado, o `null` si no corresponde (no es un borrador, no se pagó, o ya tiene su archivo). */
  function pasoDeActivar(): PasoDeActivar | null {
    if (!esDeBorrador() || vista !== "previa" || !cm?.activo()) return null;
    const con = (t: string, l: string, texto: string, accion: PasoDeActivar["principal"]["accion"]): PasoDeActivar => ({
      titulo: tx(t),
      linea: tx(l),
      principal: { texto: tx(texto), accion, apagado: false },
    });
    // Sin pagar todavía, el pago se ofrece solo si la sala dijo que puede activar. Mientras pregunta, un botón apagado.
    if (cm.estado().tipo !== "pagada" && salaDeActivar !== "lista") {
      if (salaDeActivar === "preguntando") return { titulo: tx("cpoCargando"), linea: "", principal: { texto: tx("cpoCargando"), accion: "preguntar", apagado: true } };
      return con("cpoAcApagadaT", "cpoAcAntesL", "cpoReintentar", "preguntar");
    }
    if (cm.estado().tipo !== "pagada") return null;
    const a = activacion;
    if (a.tipo === "temprano") {
      const desde = a.abreMs - ANTICIPO_DE_LA_SALA_MS;
      const zona = campana?.zona ?? "UTC";
      const idioma = deps.idioma();
      // Mientras el sorteo entre en la vida de la sala, la inscripción se puede abrir ya con un toque, sin esperar la hora.
      const ya = cabeAbrirYa(a.sorteoMs, deps.ahora());
      return {
        titulo: tx("cpoAcTempranoT"),
        linea:
          fmt(ya ? "cpoAcTempranoYaL" : "cpoAcTempranoL", { fecha: fechaTexto(desde, zona, idioma), hora: horaTexto(desde, zona, idioma) }) +
          (tusPosible() ? " " + tx("cpoOtraCompuL") : ""),
        principal: ya ? { texto: tx("cpoAbrirYa"), accion: "abrir-ya", apagado: false } : { texto: tx("cpoAbrir"), accion: "activar", apagado: true },
      };
    }
    if (a.tipo !== "error") {
      return { ...con("cpoAcActivandoT", "cpoAcActivandoL", "cpoAcActivando", "activar"), principal: { texto: tx("cpoAcActivando"), accion: "activar", apagado: true } };
    }
    switch (a.motivo) {
      case "no-pagada":
        return con("cpoAcNoPagadaT", "cpoAcNoPagadaL", "cpoCmMirar", "activar");
      case "sin-fondos":
        return con("cpoAcFondosT", "cpoAcFondosL", "cpoCmCargar", "cargar");
      case "sesion":
      case "organizadora":
        return con("cpoAcSesionT", "cpoAcSesionL", "cpoCmEntrar", "entrar");
      case "no-google":
        return con("cpoAcGoogleT", "cpoAcGoogleL", "cpoCmEntrar", "entrar");
      case "forma":
      case "red-principal": {
        const p = con("cpoAcFormaT", a.motivo === "red-principal" ? "cpoAcRedPrincipalL" : "cpoAcFormaL", "cpoAcArmar", "armar");
        return a.campo !== undefined ? { ...p, linea: fmt("cpoRevisaCampo", { campo: a.campo }) } : p;
      }
      case "limite":
        return con("cpoAcLimiteT", "cpoAcLimiteL", "cpoReintentar", "activar");
      case "apagada":
      case "sin-llave":
      case "sin-pollar":
        return con("cpoAcApagadaT", "cpoAcApagadaL", "cpoReintentar", "activar");
      case "sin-respuesta":
        return con("cpoSinConexionT", "cpoAcRedL", "cpoReintentar", "activar");
      case "red":
      case "acceso":
        return con("cpoAcRedT", "cpoAcRedL", "cpoReintentar", "activar");
    }
  }

  /** Entrar con Google, sin ofrecer el correo; sin esa dependencia, la ventana de siempre. */
  function entrarConGoogle(): void {
    (deps.entrar ?? deps.cambiarDeCuenta)?.();
  }

  function hacerDelPasoDeActivar(accion: PasoDeActivar["principal"]["accion"]): void {
    if (accion === "activar") void activar();
    else if (accion === "abrir-ya") abrirAntesDeTiempo();
    else if (accion === "preguntar") void preguntarALaSala();
    else if (accion === "cargar") cm?.cargar(() => void activar());
    else if (accion === "entrar") entrarConGoogle();
    else {
      // Armarla de nuevo: el borrador que no sirvió no se guarda, y lo armado queda en esa página para corregirlo.
      soltarElBorrador();
      deps.ir?.("/crear-campana.html");
    }
  }

  /** El borrador de una campaña que ya tiene su sala cumplió: no se vuelve a ofrecer. Uno de otra campaña se queda. */
  function quitarElBorradorDe(evento: string): void {
    const crudo = leerBorrador(deps.almacen, deps.cuenta());
    if (crudo === null) return;
    try {
      const x: unknown = JSON.parse(crudo);
      if (esObjeto(x) && x.evento !== evento) return;
    } catch {
      /* un borrador que no se lee no sirve: se saca */
    }
    borrarBorrador(deps.almacen);
  }

  /** Al abrir la página con un borrador guardado (el que dejó crear-campana.html), se retoma donde quedó. */
  async function retomarBorrador(): Promise<void> {
    if (!cm?.activo() || deps.enStand() || deps.enEnsayo()) return;
    const crudo = leerBorrador(deps.almacen, deps.cuenta());
    if (crudo === null) return;
    const dicho = await usarBorrador(crudo);
    if (dicho === null) return;
    // Una campaña que todavía está lejos sirve: se guarda para cuando falte una semana. Las demás se sacan.
    if (dicho !== tx(MUY_LEJOS)) borrarBorrador(deps.almacen);
    aviso(dicho);
  }

  async function alElegir(f: File): Promise<void> {
    if (deps.enStand()) return aviso(tx("cpoSalStand"));
    if (deps.enEnsayo()) return aviso(tx("cpoSalEnsayo"));
    if (f.size > MAX_ARCHIVO) return aviso(tx("cpoNoEsCampana"));
    const crudo = await deps.leerArchivo(f).catch(() => "");
    const leido = archivoFirmado(crudo);
    if (!leido) {
      // Con el cobro prendido, una campaña sin firma es un borrador: se activa sola cuando se paga.
      if (cm?.activo() && esBorrador(crudo)) {
        const dicho = await usarBorrador(crudo);
        return dicho === null ? undefined : aviso(dicho);
      }
      return aviso(tx("cpoNoEsCampana"));
    }
    const dicho = await tomarArchivo(leido);
    if (dicho !== null) aviso(dicho);
  }

  /**
   * Toma el archivo firmado como la campaña de esta pantalla y pasa a la vista previa. null si quedó, y si no, qué se le dice a
   * quien organiza. Lo comparten elegir un archivo y Usar en esta compu con la campaña activada (esa sigue sin vista previa).
   */
  async function tomarArchivo(leido: { texto: string; firma: string }): Promise<string | null> {
    const { lectura, red, organizadora } = leerDelTexto(leido.texto);
    if (!lectura.ok) {
      if (lectura.motivo === "otra-red") return fmt("cpoOtroModo", { modo: tx(nombreDeRed(red)) });
      return fmt("cpoRevisaCampo", { campo: lectura.campo });
    }
    const c = lectura.campana;
    if (!c.premios.every((p) => p === c.premios[0])) return tx("cpoPremiosIguales");
    // Con el cobro prendido, el total de los premios se suma al centavo: un premio con fracción de centavo no se muestra igual
    // que como se suma, así que no se acepta.
    if (cm?.activo() && !c.premios.every(esDeCentavosJustos)) return fmt("cpoRevisaCampo", { campo: "premios" });
    // Lo mismo que va a exigir la sala, dicho acá y no al crearla: así no se gasta un cupo en un archivo que no sirve.
    const v = await deps.validar(leido.texto, deps.ahora());
    if (!v.ok) return v.motivo === "vencida" ? tx("cpoVencida") : fmt("cpoRevisaCampo", { campo: v.campo });
    if (c.cierraMs <= deps.ahora()) return tx("cpoVencida");
    soltarElBorrador();
    archivo = leido;
    intento = null;
    campana = c;
    pide = organizadora;
    cm?.reiniciar();
    // Si la campaña pide sellar con una cuenta en particular y esta no es, se dice ahora y no al sellar. Con el cobro prendido
    // lo dice el título de la pantalla, y no se repite.
    mensaje = pide !== null && deps.cuenta() !== pide && !cm?.activo() ? fmt("cpoEntraCon", { fin: pide.slice(-4) }) : "";
    vista = "previa";
    // Sin sala todavía, al volver la compu de dormir o la red se vuelve a mirar el cobro.
    if (cm?.activo()) armarDespertar();
    pintar();
    void cm?.mirar();
    return null;
  }

  /** Cierra el trabajo de un botón: apaga `trabajando`, deja el aviso y pinta. */
  function terminar(texto = ""): void {
    trabajando = false;
    etapa = null;
    mensaje = texto;
    pintar();
  }

  /**
   * Crea la sala del archivo si todavía no existe, en fase lista y sin abrir nada. `null` si quedó creada (o ya estaba), y si
   * no, el texto de por qué no. La sala ya creada (un intento anterior, o retomar en lista) no se vuelve a crear: su token es
   * este. Con el cobro prendido se crea ANTES de pagar: así un archivo sin firma, un evento ya tomado o el cupo del día lleno
   * se ven antes de cobrar nada.
   */
  async function crearLaSala(): Promise<string | null> {
    if (sala) return null;
    if (!archivo || !campana) return tx("cpoNoEsCampana");
    const { evento, red } = campana;
    // Lo que se recuerda de un evento es de la cuenta que lo creó: otra cuenta en esta compu no lo usa ni lo pisa.
    const quien = deps.cuenta() ?? undefined;
    const anterior = tokenDeEvento(deps.almacen, evento, quien ?? null);
    // El intento se guarda antes de pedir: si la respuesta se pierde y la pestaña se recarga, el mismo archivo lo repite.
    intento ??= intentoDeArchivo(deps.almacen, evento, archivo.firma, quien ?? null) ?? generarClave();
    guardarIntentoDeArchivo(deps.almacen, { evento, firma: archivo.firma, intento, ...(quien === undefined ? {} : { cuenta: quien }) });
    const r = await deps.crear(archivo, { evento, red, anterior, intento });
    if (!r.ok) {
      // Con la cuenta conectada, el evento que ya tiene sala no manda a pedir otro archivo: se ofrece usar la campaña acá. Si
      // mientras se creaba se dejó la campaña, no se ofrece nada.
      if (r.motivo === "ya-existe" && puedeUsarAqui() && campana?.evento === evento) ofreceUsar = evento;
      // La sala no tiene prendidas las campañas de personas: queda dicho en la pantalla, en lugar del botón de abrir.
      if (r.motivo === "personas-apagadas" && campana) personas = { de: campana, estado: "no" };
      return tx(TEXTO_DE_FALLA_AL_CREAR[r.motivo]);
    }
    // Si mientras se creaba se dejó la campaña, esta sala ya no es de esta pantalla: no se toma ni se sigue.
    if (!archivo || !campana) return tx("cpoNoEsCampana");
    sala = r.sala;
    // La sala es de quien nombra el texto firmado, o de quien tenga el token si no nombra a nadie.
    duena = pide;
    marca++;
    faseSala = "lista";
    // El token de la sala se guarda aparte: sin él, el mismo archivo no vuelve a abrir una sala que ya se cerró.
    guardarTokenDeEvento(deps.almacen, { evento: r.sala.evento, token: r.sala.token, ...(quien === undefined ? {} : { cuenta: quien }) });
    olvidarIntentoDeArchivo(deps.almacen, evento, quien);
    // Con la sala creada, la memoria de esta compu ya retoma la campaña: el borrador cumplió y no vuelve a aparecer.
    soltarElBorrador();
    recordar();
    return null;
  }

  /**
   * Si en la vista previa de una campaña de personas no corresponde ofrecer Abrir la inscripción: `mirando` es que todavía se
   * está preguntando y `no` es que el modo no está prendido. `null` es lo de siempre: una campaña de cuentas, otra vista, o
   * un paso del cobro o de la activación por delante, que hablan ellos.
   */
  function personasEn(): "mirando" | "no" | null {
    const p = personas;
    if (vista !== "previa" || campana === null || campana.identidad !== "persona" || p === null || p.de !== campana) return null;
    if (pasoDeActivar() !== null || (cm?.activo() && cm.descripcion().principal)) return null;
    return p.estado;
  }

  /** Vuelve a mirar si la campaña de personas se puede abrir. Lo que se sabía se olvida: si nadie dice que no, se ofrece abrir. */
  function mirarPersonas(): void {
    personas = null;
  }

  async function abrirInscripcion(): Promise<void> {
    // Mientras el cobro no esté pagado no se abre nada, aunque alguien llame esto directo: no solo se esconde el botón.
    if (trabajando || !campana || cm?.bloqueaElAbrir()) return;
    // Tampoco con el modo de personas sin prender, o mientras todavía se pregunta.
    if (personasEn() !== null) return;
    // La línea del premio se lee de nuevo justo ahora y no afirma nada hasta que vuelve: abrir no la espera.
    mirarElDeposito("ahora");
    trabajando = true;
    mensaje = "";
    // Las etapas se ven en orden, sin cambiar el de las llamadas: crear la sala, si falta, y después abrir la inscripción.
    etapa = sala ? "abriendo" : "sala";
    pintar();
    if (!sala && !archivo) return terminar();
    const falla = await crearLaSala();
    if (falla !== null && ofreceUsar !== null) {
      trabajando = false;
      etapa = null;
      return irASeguir(ofreceUsar, "previa");
    }
    // Que el modo no está prendido lo dicen el título y la línea: el aviso no lo repite.
    if (falla !== null) return terminar(personasEn() === "no" ? "" : falla);
    // Si se dejó la campaña mientras se creaba la sala, no hay nada que abrir.
    if (!campana) return terminar();
    const s = sala;
    if (!s) return terminar();
    etapa = "abriendo";
    pintar();
    const m = marca;
    const r = await aplicarFase(s, "abierta", null, "lista");
    if (m !== marca) return void (trabajando = false);
    trabajando = false;
    if (!r.ok) return pintar();
    irA("abierta", campana.cierraMs);
  }

  /* --- las fases --- */

  /**
   * Pide una fase y la confirma con la sala. Si la respuesta se perdió (el cambio pudo haber llegado), pregunta qué fase
   * tiene y obedece: si ya está en la pedida, se toma como hecha. Si no, adopta la que dice la sala.
   */
  async function aplicarFase(
    s: SalaDeCampana,
    fase: "abierta" | "cerrada",
    cierra: number | null,
    desde: FaseDeSala,
  ): Promise<{ ok: true; cierraMs: number | null } | { ok: false }> {
    const m = marca;
    const f = await deps.fase(s, fase, cierra);
    if (m !== marca) return { ok: false };
    if (f === true) return { ok: true, cierraMs: cierra };
    if (f === "token") {
      tomada();
      return { ok: false };
    }
    const e = await deps.estado(s);
    if (m !== marca) return { ok: false };
    if (e === "token") {
      tomada();
      return { ok: false };
    }
    if (e === "no-existe") {
      olvidar("cpoSeBorro");
      return { ok: false };
    }
    if (typeof e === "object") {
      const hecha = e.fase === fase && (cierra === null || desde === "cerrada" || e.cierraMs === cierra);
      if (hecha) return { ok: true, cierraMs: e.cierraMs };
      irA(e.fase, e.cierraMs);
    }
    mensaje = tx(f === "forma" ? "cpoHoraNoVale" : "cpoSinConexion");
    pintar();
    grande.pintar();
    return { ok: false };
  }

  /** Pone la pantalla en la fase que tiene la sala, con lo que cada una necesita andando. */
  function irA(fase: FaseDeSala, cierra: number | null): void {
    faseSala = fase;
    if (cierra !== null) cierraMs = cierra;
    mensaje = "";
    if (fase === "lista") {
      vista = "previa";
      // Una sala retomada en lista también pide el cobro antes de abrirse.
      void cm?.mirar();
    } else if (fase === "abierta") {
      vista = "abierta";
      if (sala && !escucha) oirLaSala(sala);
      armarDespertar();
      asegurarPase();
      programarCierre();
    } else if (fase === "cerrada") {
      vista = "cerrada";
      // Si la sala ya estaba cerrada (otra pestaña, una recarga) la lista todavía no se pasó: hay que tocar Pasar la lista.
      retomada = !cerrandoAhora && !pasada;
      pararPase?.();
      pararPase = null;
      pararCierre?.();
      pararCierre = null;
    } else {
      vista = fase;
      pararPase?.();
      pararPase = null;
      pararCierre?.();
      pararCierre = null;
      grande.cerrar();
    }
    recordar();
    pintarQrs();
  }

  function volverAAbierta(): void {
    vista = "abierta";
    asegurarPase();
    programarCierre();
    pintar();
  }

  /** Quitar dos veces es lo mismo que una: si la respuesta se perdió, se manda otra vez y la sala dice que ya no estaba. */
  function mandarQuitar(n: number): Promise<boolean> {
    const previo = vuelo.get(n);
    if (previo) return previo;
    const p = enviar(n);
    vuelo.set(n, p);
    void p.finally(() => vuelo.delete(n));
    return p;
  }

  async function enviar(n: number): Promise<boolean> {
    const s = sala;
    const motivo = pendientes.get(n)?.motivo ?? enviando.get(n);
    if (!s || !motivo) return false;
    pendientes.get(n)?.parar();
    pendientes.delete(n);
    enviando.set(n, motivo);
    recordar();
    const m = marca;
    const r = await deps.quitar(s, n, motivo);
    if (m !== marca) return false;
    if (r === true) {
      enviando.delete(n);
      filas.delete(n);
      llegados.delete(n);
      quitadas.add(n);
      recordar();
      alCambiarLasFilas();
      return true;
    }
    if (r === "no-existe") {
      void sospechaDeBorrada(s);
      return false;
    }
    if (r === "token") {
      tomada();
      return false;
    }
    if (r === "rechazo") {
      // La sala dijo que no (ya no se puede quitar): la persona vuelve a la lista.
      enviando.delete(n);
      mensaje = tx("cpoSinConexion");
      recordar();
      alCambiarLasFilas();
      return false;
    }
    // Sin respuesta: la sala pudo haberla sacado. Sigue escondida y se reintenta sola, sin dejar a nadie de más en la lista.
    mensaje = tx("cpoSinConexion");
    reintentos.set(
      n,
      deps.esperar(() => {
        reintentos.delete(n);
        void mandarQuitar(n);
      }, REINTENTO_QUITA_MS),
    );
    pintar();
    return false;
  }

  function elegirMotivo(n: number, motivo: MotivoDeSalida): void {
    preguntando.delete(n);
    // La sala recién se entera a los 5 s: hasta entonces Deshacer no deja rastro.
    const parar = deps.esperar(() => void mandarQuitar(n), DESHACER_MS);
    pendientes.set(n, { motivo, parar });
    recordar();
    alCambiarLasFilas();
  }

  function deshacer(n: number): void {
    pendientes.get(n)?.parar();
    pendientes.delete(n);
    recordar();
    alCambiarLasFilas();
  }

  function mostrar(n: number): void {
    mostradas.add(n);
    const f = filas.get(n);
    if (f) filas.set(n, { ...f, revisar: false });
    recordar();
    alCambiarLasFilas();
  }

  async function masQuince(): Promise<void> {
    const s = sala;
    if (!s || trabajando) return;
    // Desde la hora de ahora si el cierre ya pasó: la sala pide un cierre entre 1 minuto y 12 horas desde ahora.
    const nuevo = Math.max(cierraMs, ahoraSala()) + QUINCE_MIN;
    trabajando = true;
    mensaje = "";
    pintar();
    const r = await aplicarFase(s, "abierta", nuevo, "abierta");
    trabajando = false;
    if (!r.ok) return pintar();
    cierraMs = r.cierraMs ?? nuevo;
    programarCierre();
    recordar();
    pintar();
    grande.pintar();
  }

  function pedirCerrar(): void {
    mensaje = "";
    if (visibles().length < 2) return aviso(tx("cpoPocos"));
    vista = "confirmar";
    entroAConfirmar = deps.ahora();
    pintar();
  }

  async function cerrarLista(): Promise<void> {
    const s = sala;
    if (!s || trabajando) return;
    if (deps.ahora() - entroAConfirmar < GUARDA_DE_CONFIRMAR_MS) return;
    trabajando = true;
    mensaje = "";
    pintar();
    const m = marca;
    // Lo que quien organiza ya decidió sacar sale antes de cerrar: así la lista que se confirmó es la que queda.
    for (const n of [...pendientes.keys()]) void mandarQuitar(n);
    await Promise.all([...vuelo.values()]);
    if (m !== marca) return void (trabajando = false);
    if (enviando.size > 0) {
      trabajando = false;
      mensaje = tx("cpoSinConexion");
      return volverAAbierta();
    }
    const r = await aplicarFase(s, "cerrada", null, "abierta");
    trabajando = false;
    if (m !== marca) return;
    if (!r.ok) {
      if (vista === "confirmar") volverAAbierta();
      return;
    }
    pasada = false;
    cerrandoAhora = true;
    irA("cerrada", r.cierraMs);
    await leerListaCompleta(s);
    cerrandoAhora = false;
  }

  /**
   * Con la lista cerrada, se lee entera antes de pasarla: hay altas que viajan por el socket o se están descifrando en el
   * instante del cierre. Se compara con el total de la sala y recién entonces se pasa. Si no coincide, se prueba de nuevo.
   */
  async function leerListaCompleta(s: SalaDeCampana): Promise<void> {
    leyendoLaLista = true;
    sinLeer = false;
    pintar();
    try {
      await leerLaLista(s);
    } finally {
      leyendoLaLista = false;
      pintar();
    }
  }

  async function leerLaLista(s: SalaDeCampana): Promise<void> {
    const m = marca;
    sinLeer = false;
    for (let vuelta = 0; vuelta < VUELTAS_AL_CERRAR; vuelta++) {
      await escucha?.consultar();
      await esperarDescifrados();
      const e = await deps.estado(s);
      if (m !== marca) return;
      if (e === "no-existe") return void sospechaDeBorrada(s);
      if (e === "token") return tomada();
      if (typeof e === "object" && e.total === visibles().length) {
        mensaje = "";
        pasada = true;
        retomada = false;
        pintar();
        grande.pintar();
        correrPaso();
        return;
      }
      mensaje = tx("cpoCargando");
      pintar();
      await new Promise<void>((seguir) => void deps.esperar(seguir, ESPERA_AL_LEER_MS));
      if (m !== marca) return;
    }
    mensaje = "";
    sinLeer = true;
    pintar();
  }

  async function reabrir(): Promise<void> {
    const s = sala;
    if (!s || trabajando || listaTrabada()) return;
    trabajando = true;
    mensaje = "";
    pintar();
    const m = marca;
    // Con la lista cerrada no se pide ningún pase, y al retomar o recargar el reloj de la sala todavía no se conoce: se lo
    // estima ahora, con el pase que la sala da a quien tiene el token, antes de calcular la hora.
    const p = await deps.pase(s);
    if (m !== marca) return void (trabajando = false);
    if (typeof p === "object") estimarDesfase(p.hasta);
    else if (p === "no-existe" || p === "token") {
      trabajando = false;
      pintar();
      return p === "token" ? tomada() : void sospechaDeBorrada(s);
    } else if (!relojEstimado) {
      // El pase falló por la conexión y el reloj de la sala sigue sin conocerse: con el de esta compu la sala podría
      // rechazar la hora y la pantalla diría que no vale, cuando la causa fue la conexión. No se manda nada.
      trabajando = false;
      mensaje = tx("cpoSinConexion");
      return pintar();
    }
    // Siempre con una hora nueva: el máximo entre el cierre que tenía y ahora, más quince minutos, con el reloj estimado de
    // la sala. Sin hora la sala conserva la anterior y, con los relojes desfasados, puede rechazarla por vencida. Nunca
    // más de lo que la sala acepta (doce horas desde ahora). Con el pase, ese máximo se mide desde lo más atrás que puede
    // estar la sala (el comienzo de la ventana que cierra en `hasta`) y no desde esta compu, que puede ir adelantada.
    const ahora = ahoraSala();
    const enLaSala = typeof p === "object" ? Math.min(ahora, p.hasta - VENTANA_DEL_PASE_MS) : ahora;
    const nuevo = Math.min(Math.max(cierraMs, ahora) + QUINCE_MIN, enLaSala + DOCE_HORAS - MARGEN_DE_LAS_DOCE_HORAS);
    const r = await aplicarFase(s, "abierta", nuevo, "cerrada");
    trabajando = false;
    if (!r.ok) return pintar();
    pasada = false;
    totalParaReponer = null;
    sinLeer = false;
    retomada = false;
    // Lo que se pasó al cuadro ya no es la lista de la campaña: se vacía, así no queda una lista sellable con el margen de la sala.
    deps.alReabrir?.();
    ponerPaso({ paso: "nada" });
    irA("abierta", r.cierraMs ?? nuevo);
  }

  /* --- retomar y olvidar --- */

  async function retomar(g: MemoriaDeOrg): Promise<void> {
    dejarDeEscuchar();
    vaciarFilas();
    marca++;
    cm?.reiniciar();
    const m = marca;
    vista = "cargando";
    mensaje = "";
    armarDespertar();
    pintar();
    const [c, e] = await Promise.all([deps.campanaDeSala(g.sala), deps.estado(g.sala)]);
    if (m !== marca) return;
    // Mientras se leía la sala pudo entrar otra cuenta: la de otra cuenta no se retoma ni se borra.
    if (!seVeDesde(g.cuenta, deps.cuenta())) return apartar();
    recuperada = g.recuperada === true;
    idEnVista = g.sala.id;
    if (e === "no-existe") return olvidar("cpoSeBorro");
    // La sala no reconoce el token guardado: otra compu tomó la campaña. Se dice, y lo guardado no se toca.
    if (e === "token" || (typeof e === "object" && e.tuya === false)) {
      idEnVista = null;
      sala = g.sala;
      duena = g.cuenta;
      campana = typeof c === "string" ? null : c;
      return tomada();
    }
    if (typeof c === "string" || typeof e === "string") return ponerSinRed(g);
    idEnVista = null;
    sala = g.sala;
    duena = g.cuenta;
    campana = c;
    pide = null;
    cierraMs = e.cierraMs;
    mostradas.clear();
    for (const n of g.mostradas ?? []) mostradas.add(n);
    pasada = false;
    sinLeer = false;
    faseSala = e.fase;
    // Las quitas que quedaron a medias (se recargó en los 5 segundos de Deshacer) salen antes de pintar la lista. Con la lista
    // sellada, o con su sorteo sin resolver, no salen: la sala ya no deja quitar y una quita no puede cambiar lo sellado.
    const aMandar = listaTrabada() ? [] : (g.pendientes ?? []);
    for (const p of aMandar) enviando.set(p.n, p.motivo);
    await Promise.all(aMandar.map((p) => mandarQuitar(p.n)));
    if (m !== marca) return;
    if (e.fase !== "lista" && e.fase !== "sellada" && e.fase !== "sorteada") {
      oirLaSala(g.sala);
      void ponerseAlDia(e.total);
    }
    // Si se recargó después de pasar la lista, no hace falta tocar nada: se vuelve a leer la lista de la sala (las quitas de
    // arriba ya salieron) y se pone en el cuadro de nuevo, que es lo que comprueba la sala al sellar.
    const sigueEnElCuadro = e.fase === "cerrada" && (deps.listaPasada?.(g.sala) ?? false);
    if (sigueEnElCuadro) pasada = true;
    // Con la sala cerrada y la lista en el cuadro, los nombres se reponen cuando el panel tenga todas las filas.
    if (sigueEnElCuadro) totalParaReponer = e.total;
    irA(e.fase, e.cierraMs);
    if (sigueEnElCuadro) {
      reponerLasEtiquetas();
      correrPaso();
    }
    if (e.fase !== "lista") deps.alRetomar?.(e.fase, g.sala);
    // Una memoria de antes no dice de quién es la sala: con una sesión se completa con la campaña firmada.
    if (g.cuenta === undefined) void completarLaDuena();
  }

  /** No se pudo preguntarle a la sala: la memoria se conserva y se prueba de nuevo, a mano o al volver la red. */
  function ponerSinRed(g: MemoriaDeOrg): void {
    dejarDeEscuchar();
    idEnVista = g.sala.id;
    vista = "sin-red";
    mensaje = "";
    reintentar = () => void retomar(g);
    pintar();
  }

  /** Un 404 aislado o un cierre del socket no alcanzan: solo si la sala de verdad no existe se borra lo que recuerda la compu. */
  async function sospechaDeBorrada(s: SalaDeCampana): Promise<void> {
    const m = marca;
    const e = await deps.estado(s);
    if (m !== marca || sala !== s) return;
    if (e === "no-existe") return olvidar("cpoSeBorro");
    if (e === "token") return tomada();
    if (typeof e === "string") {
      const g = leerOrg(deps.almacen, deps.ahora(), s.red, deps.cuenta());
      return ponerSinRed(g ?? { sala: s, fase: faseSala });
    }
    // La sala sigue ahí: el aviso de cierre era falso o pasajero, y esa escucha ya se cortó sola. Se escucha de nuevo.
    if (conPase() || vista === "cerrada") oirLaSala(s);
  }

  function olvidar(clave?: string): void {
    const red = sala?.red ?? deps.red();
    // La sala que estaba a la vista: sin sesión, es la única que se deja de recordar (las demás son de otras cuentas). Si se estaba
    // retomando, `sala` todavía no la tiene y el id es el de la que se retomaba.
    const id = sala?.id ?? idEnVista ?? undefined;
    idEnVista = null;
    dejarDeEscuchar();
    marca++;
    pararDespertar?.();
    grande.cerrar();
    vaciarFilas();
    mostradas.clear();
    sala = null;
    duena = null;
    recuperada = false;
    apartada = false;
    campana = null;
    pide = null;
    cm?.reiniciar();
    activandoLaSala = false;
    soltarElBorrador();
    archivo = null;
    intento = null;
    pase = null;
    paseCaido = false;
    paseRechazado = false;
    paseEnCurso = false;
    desfase = 0;
    relojEstimado = false;
    ultimoEnlace = "";
    faseSala = "lista";
    retomada = false;
    pasada = false;
    sinLeer = false;
    reintentar = null;
    trabajando = false;
    pintadas = [];
    firmaDeLista = "";
    borrarOrg(deps.almacen, red, deps.cuenta(), id);
    deps.alOlvidar?.();
    ponerPaso({ paso: "nada" });
    ponerRechazo(null);
    vista = "elegir";
    armandoOtra = false;
    mensaje = clave ? tx(clave) : "";
    pintar();
  }

  /** Dejar la campaña: pide una confirmación de una línea. Con la sala todavía vacía, además la borra para liberar el archivo. */
  function pedirOlvidar(deArmarOtra = false): void {
    // Solo Armar otra campaña abre el selector al confirmar: cualquier otra pregunta lo apaga, aunque una anterior haya quedado
    // abandonada sin cancelar ni confirmar (por ejemplo, si otra pestaña tomó la campaña mientras se preguntaba).
    armandoOtra = deArmarOtra;
    vistaAntes = vista;
    vista = "olvidar";
    mensaje = "";
    pintar();
  }

  /**
   * Armar otra campaña desde la lista cerrada: con la lista cerrada o con avisos pendientes a los celulares, un toque de más
   * dejaría a todas las personas sin su resultado, así que antes pregunta. Al confirmar se abre el selector de la siguiente.
   */
  function armarOtra(): void {
    pedirOlvidar(true);
  }

  function cancelarOlvidar(): void {
    armandoOtra = false;
    vista = vistaAntes;
    // Con la pregunta abierta el pase no se renueva: si venció ahí no quedó nada programado y hay que retomarlo.
    if (conPase()) {
      asegurarPase();
      programarCierre();
    }
    pintar();
  }

  async function confirmarOlvidar(): Promise<void> {
    const s = sala;
    if (s && vistaAntes === "previa") {
      if (trabajando) return;
      trabajando = true;
      pintar();
      const hecho = await deps.borrarVacia(s);
      trabajando = false;
      if (s !== sala) return;
      if (!hecho) return aviso(tx("cpoSinConexion"));
    }
    const abrirElSelector = armandoOtra;
    olvidar();
    if (abrirElSelector) elegir();
  }

  /* --- el dibujo --- */

  type Estilo = "primary" | "ghost" | "enlace";

  function boton(texto: string, estilo: Estilo, alTocar: (b: HTMLButtonElement) => void, apagado = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = estilo;
    b.textContent = texto;
    b.disabled = apagado;
    b.addEventListener("click", () => alTocar(b));
    return b;
  }

  /**
   * Lo que el panel espera ahora y la fila viva dice, o `null` si no espera nada. Reemplaza al botón apagado que decía lo mismo
   * (y a la línea de estado): una espera nunca suma un renglón. `cobro`: lo que se espera es el cobro del servicio.
   */
  function enLaFila(): { texto: string; cobro?: true } | null {
    const dice = (clave: string): { texto: string } => ({ texto: tx(clave) });
    if (vista === "previa") {
      const deActivar = pasoDeActivar();
      if (deActivar) {
        // Un borrador: o la sala todavía dice si puede activarlo, o ya pagado se activa, se crea la sala y se abre la inscripción.
        // Con la apertura lejos (temprano) el botón apagado es una espera de fecha y no de trabajo: no lleva fila.
        if (!deActivar.principal.apagado || activacion.tipo === "temprano") return null;
        if (cm?.estado().tipo !== "pagada") return dice("cpoFvPreguntando");
        return dice(CLAVE_DE_LA_ETAPA[etapa ?? "activando"]);
      }
      const d = cm?.activo() ? cm.descripcion() : null;
      if (d?.principal) {
        const tipo = cm?.estado().tipo;
        // La primera lectura al abrir no es una espera del pago: con la página ya pagada el tilde queda quieto.
        if (tipo === "mirando") return dice("cpoFvMirando");
        if (tipo === "pagando") return { ...dice(cm?.etapaDelPago() === "mandado" ? "cpoFvRed" : "cpoFvArmando"), cobro: true };
        // En la duda el botón Volver a mirar sigue ahí: la fila dice que el panel mira solo, sin esperar a que se toque.
        if (tipo === "duda") return { ...dice("cpoFvDuda"), cobro: true };
      } else if (trabajando) {
        return dice(etapa === "sala" ? "cpoFvSala" : "cpoFvAbriendo");
      } else if (personasEn() === "mirando") {
        return dice("cpoFvPreguntando");
      }
    }
    // Cerrar la lista: se mandan las quitas pendientes y se cambia la fase.
    if (vista === "confirmar" && trabajando) return dice("cpoFvCerrando");
    if (vista === "cerrada" || vista === "sellada" || vista === "sorteada") {
      // Lo que la herramienta hace por detrás (pasar la lista, avisar a los celulares, guardar el resultado) no queda mudo.
      const paso = pasoDelPuente().paso;
      if (paso === "leyendo") return dice("cpoLeyendo");
      if (paso === "avisando") return dice("cpoAvisando");
      if (paso === "comprobando") return dice("cpoComprobando");
      if (paso === "mandando") return dice("cpoFvGuardando");
      if (vista === "cerrada" && leyendoLaLista) return dice("cpoLeyendo");
    }
    return null;
  }

  const CLAVE_DE_LA_ETAPA = { activando: "cpoFvActivando", sala: "cpoFvSala", abriendo: "cpoFvAbriendo" } as const;

  function pintarFila(): void {
    const dice = enLaFila();
    if (dice === null) return filaViva.limpiar();
    if (dice.cobro) esperabaElCobro = true;
    filaViva.revisando(dice.texto);
  }

  function pintarAcciones(): void {
    const hora = pasoLaHora();
    const n = visibles().length;
    const paso = pasoDelPuente();
    const enFila = enLaFila();
    const firma = [
      vista,
      vistaAntes,
      trabajando,
      hora,
      retomada,
      sinLeer,
      !!sala,
      deps.idioma(),
      vista === "confirmar" ? n : 0,
      JSON.stringify(paso),
      listaTrabada(),
      vista === "previa" ? (cm?.firma() ?? "") : "",
      vista === "previa" && borrador !== null ? `${archivo === null ? "b" : "f"}${JSON.stringify(activacion)}${salaDeActivar}` : "",
      activandoLaSala,
      porActivarSinSesion(),
      vista === "elegir" && borradorGuardado(),
      // El botón Abrir de una campaña activada antes de tiempo cambia solo al cruzar la hora en que ya cabe abrirla.
      vista === "previa" && activacion.tipo === "temprano" ? cabeAbrirYa(activacion.sorteoMs, deps.ahora()) : "",
      leyendoLaLista,
      enFila?.texto ?? "",
      personasEn() ?? "",
      // En la vista de siempre el aviso de lo que pasó al pedir Tus campañas va arriba del botón, a la vista.
      vista === "elegir" ? mensaje : "",
      vista === "tus" || vista === "seguir"
        ? [deps.cuenta() === null, primarioDeTus(), tusTrabajando, tusFalla?.evento, tusFalla?.boton, tus.filter((f) => describirTus(f).usable).length]
        : "",
      vista === "tomada" ? puedeUsarAqui() : "",
    ].join("|");
    if (firma === firmaDeAcciones) return;
    firmaDeAcciones = firma;
    const botones: HTMLElement[] = [];
    const principal = (texto: string, alTocar: (b: HTMLButtonElement) => void, apagado = false, conG = false): HTMLElement => {
      const b = boton(texto, "primary", alTocar, apagado);
      // El botón que entra directo a Google lleva la G, como los de la portada.
      if (conG && deps.entraConGoogle?.() === true) {
        const g = document.createElement("span");
        g.className = "g-ico";
        g.setAttribute("aria-hidden", "true");
        b.prepend(g);
        b.classList.add("con-g");
      }
      return b;
    };
    const otroArchivo = (): HTMLElement => boton(tx("cpoOtroArchivo"), "enlace", () => pedirOlvidar());
    // El botón principal que lleva el paso de la herramienta (reintentar la lectura, cambiar de cuenta, avisar a los celulares).
    const delPaso = vista === "cerrada" || vista === "sellada" || vista === "sorteada" ? botonDelPaso(paso) : null;
    const principalDelPaso = (): HTMLElement | null =>
      delPaso ? principal(tx(delPaso.clave), () => accionesDelPuente()[delPaso.accion]?.()) : null;
    if (vista === "elegir") {
      botones.push(principal(tx("cpoElegir"), () => elegir()));
      // Un enlace y no un botón: el paso sigue con una sola acción principal.
      const armar = document.createElement("a");
      armar.className = "enlace";
      armar.href = "/crear-campana.html";
      armar.textContent = tx("cpoArmala");
      botones.push(armar);
      // Un borrador guardado que el panel no tomó (todavía lejos, o en el stand): también se puede dejar desde acá.
      if (borradorGuardado()) botones.push(boton(tx("cpoDejar"), "enlace", () => dejarLaCampana()));
    } else if (vista === "previa") {
      // Con el cobro prendido y sin pagar, el botón es el del estado del cobro en lugar de Abrir la inscripción.
      const d = cm?.activo() ? cm.descripcion() : null;
      const deActivar = pasoDeActivar();
      const hacer = (accion: AccionDeComision): void => {
        if (accion === "cargar") cm?.cargar();
        else if (accion === "pagar") void cm?.pagar();
        else if (accion === "mirar") void cm?.mirar();
        // Con el correo abierto, la campaña pide Google: ahí no se ofrece el selector con el correo. Con otra billetera, sí.
        else if (cm?.estado().tipo === "solo-google") entrarConGoogle();
        else deps.cambiarDeCuenta?.();
      };
      if (deActivar) {
        // Un borrador pagado: un solo botón, el de lo que pasa ahora. Nunca se ofrece pagar de nuevo.
        const { texto, accion, apagado } = deActivar.principal;
        if (!(apagado && enFila !== null)) botones.push(principal(texto, () => hacerDelPasoDeActivar(accion), apagado, accion === "entrar"));
      } else if (d?.principal && d.principal.accion === "entrar" && porActivarSinSesion()) {
        // La campaña por activar, sin sesión: un solo botón, el mismo ingreso que el botón principal de la portada.
        botones.push(principal(d.principal.texto, () => entrarConGoogle(), false, true));
      } else if (d?.principal) {
        const { texto, accion, apagado } = d.principal;
        // Un botón apagado que solo repetía lo que se espera cede su lugar a la fila viva.
        // Solo lleva la G cuando va a Google: el de otra cuenta o el de otra billetera abre la ventana con todas las formas.
        if (!(apagado && enFila !== null)) {
          botones.push(principal(texto, () => hacer(accion), apagado, accion === "entrar" && cm?.estado().tipo === "solo-google"));
        }
        if (d.secundario) {
          const { texto: textoDelOtro, accion: accionDelOtro } = d.secundario;
          botones.push(boton(textoDelOtro, "ghost", () => hacer(accionDelOtro)));
        }
      } else if (personasEn() === "no") {
        // El modo de personas no está prendido: abrir no se ofrece. Cuando Tinkazo lo prenda, se prueba de nuevo.
        botones.push(
          principal(tx("cpoReintentar"), () => {
            mirarPersonas();
            pintar();
          }),
        );
      } else if (personasEn() !== "mirando") {
        // Mientras se pregunta si el modo de personas está prendido, la fila viva dice qué se espera y el botón todavía no está.
        if (!(trabajando && enFila !== null)) botones.push(principal(tx(trabajando ? "cpoAbriendo" : "cpoAbrir"), () => void abrirInscripcion(), trabajando));
      }
      // Mientras se paga o se duda de un pago no se deja la campaña: el pago ya salió con esta pantalla.
      const tipoDelCobro = cm?.estado().tipo;
      // Tampoco mientras se crea la sala o se abre la inscripción: la campaña ya se pagó y soltarla a mitad de camino la perdería.
      if (tipoDelCobro !== "pagando" && tipoDelCobro !== "duda" && activacion.tipo !== "activando" && !activandoLaSala && !trabajando) {
        // El borrador que dejó crear-campana.html no vino de un archivo: dejarlo se dice así, con o sin sesión.
        const deCrear = borrador !== null && archivo === null;
        botones.push(boton(tx(deCrear ? "cpoDejar" : "cpoOtroArchivo"), "enlace", () => (sala ? pedirOlvidar() : deCrear ? dejarLaCampana() : volverAElegir())));
      }
    } else if (vista === "abierta") {
      const abrirGrande = (b: HTMLButtonElement): void => grande.abrir(b);
      const cerrar = (): void => pedirCerrar();
      if (hora) {
        botones.push(principal(tx("cpoCerrar"), cerrar, trabajando));
        botones.push(boton(tx("cpoGrande"), "ghost", abrirGrande));
      } else {
        botones.push(principal(tx("cpoGrande"), abrirGrande));
        botones.push(boton(tx("cpoCerrar"), "ghost", cerrar, trabajando));
      }
      botones.push(boton(tx("cpoMas15"), "ghost", () => void masQuince(), trabajando));
      botones.push(otroArchivo());
    } else if (vista === "confirmar") {
      // Mientras cierra, la fila viva dice qué pasa y no quedan dos botones apagados.
      if (!(trabajando && enFila !== null)) {
        botones.push(principal(fmt("cpoCerrarCon", { n }), () => void cerrarLista(), trabajando));
        botones.push(boton(tx("cpoSeguirAbierta"), "ghost", () => volverAAbierta(), trabajando));
      }
    } else if (vista === "olvidar") {
      botones.push(principal(tx("cpoOlvidarSi"), () => void confirmarOlvidar(), trabajando));
      botones.push(boton(tx("cpoCancelar"), "ghost", () => cancelarOlvidar()));
    } else if (vista === "cerrada") {
      const delBoton = principalDelPaso();
      if (delBoton) botones.push(delBoton);
      else if (sinLeer) botones.push(principal(tx("cpoReintentar"), () => void (sala && leerListaCompleta(sala))));
      else if (retomada && !leyendoLaLista) botones.push(principal(tx("cpoPasar"), () => void (sala && leerListaCompleta(sala))));
      botones.push(boton(tx("cpoGrande"), "ghost", (b) => grande.abrir(b)));
      if (!listaTrabada()) botones.push(boton(tx("cpoReabrir"), "enlace", () => void reabrir(), trabajando));
      // Armar otra campaña en el mismo lugar. La lista cerrada todavía tiene que llegar al sorteo: antes de olvidarla pregunta.
      botones.push(boton(tx("cpoOtroArchivo"), "enlace", () => armarOtra()));
    } else if (vista === "sellada" || vista === "sorteada") {
      const delBoton = principalDelPaso();
      if (delBoton) botones.push(delBoton);
      else if (vista === "sorteada" && paso.paso === "resultado") {
        // Avisar a quien ganó y todavía no sabe es la acción principal, arriba de la lista: con varias ganadoras, el botón dentro de
        // su fila quedaba más abajo de la pantalla del celular.
        const g = paso.filas.find((f) => !f.avisada);
        if (g) botones.push(principal(fmt("cpoAvisarA", { nombre: g.nombre }), () => accionesDelPuente().avisarA?.(g.cuenta)));
      }
      // Los celulares todavía leen el resultado: la sala no se borra, solo se deja de recordar en esta compu.
      // Con un aviso pendiente a los celulares no se deja de un toque: la pregunta de siempre. Con la lista sellada siempre se
      // pregunta, y con el sorteo hecho también, salvo con el resultado ya avisado a todas o con la sala borrada.
      botones.push(boton(tx("cpoOtroArchivo"), "enlace", () => (avisosPendientes(pasoDelPuente(), vista === "sorteada") ? pedirOlvidar() : olvidar())));
    } else if (vista === "sin-red") {
      botones.push(principal(tx("cpoReintentar"), () => reintentar?.()));
      botones.push(otroArchivo());
    } else if (vista === "otra-pestana") {
      botones.push(principal(tx("cpoUsarAca"), () => usarAca()));
    } else if (vista === "tus") {
      // Las filas llevan sus botones. Sin sesión, entrar con Google. Sin nada que usar, Hacer otro sorteo pasa a ser el principal.
      const sinSesion = deps.cuenta() === null;
      const primero = primarioDeTus();
      if (sinSesion) botones.push(principal(tx("cpoCmEntrar"), () => entrarConGoogle(), false, true));
      else if (primero !== null) {
        // La primera campaña que se puede usar lleva el principal acá abajo: en la pantalla chica la lista queda por encima de la
        // barra, y un botón dentro de la fila podía quedar escondido. Con más de una que se puede usar, el botón dice cuál.
        const f = tus.find((x) => x.evento === primero);
        const reintento = tusFalla?.evento === primero && tusFalla.boton === "reintentar";
        const varias = tus.filter((x) => describirTus(x).usable).length > 1;
        const texto = reintento ? tx("cpoReintentar") : varias && f ? fmt("cpoUsarAquiDe", { empresa: f.empresa }) : tx("cpoUsarAqui");
        botones.push(principal(texto, () => tocarUsar(primero), tusTrabajando !== null));
      }
      // Sin nada que usar, Hacer otro sorteo es la principal. Con otra principal en la barra, es el enlace del final de la lista.
      if (!sinSesion && primero === null) botones.push(principal(tx("cpoTusOtro"), () => hacerOtro()));
      else if (sinSesion) botones.push(boton(tx("cpoTusOtro"), "enlace", () => hacerOtro()));
    } else if (vista === "seguir") {
      botones.push(principal(tx("cpoSeguirSi"), () => void (seguirDe && usarAqui(seguirDe.evento, seguirDe.desde)), tusTrabajando !== null));
      botones.push(boton(tx("cpoCancelar"), "ghost", () => cancelarSeguir(), tusTrabajando !== null));
    } else if (vista === "tomada") {
      if (puedeUsarAqui()) {
        // Con la cuenta conectada la campaña se puede volver a tomar acá. Dejarla sigue a mano, y no le toca la sala a nadie.
        botones.push(principal(tx("cpoUsarAqui"), () => usarDesdeTomada()));
        botones.push(boton(tx("cpoDejar"), "enlace", () => olvidar()));
      } else {
        // Olvida lo guardado en esta compu y no le toca la sala: la campaña sigue en la otra.
        botones.push(principal(tx("cpoDejar"), () => olvidar()));
      }
    }
    // La fila viva es parte de este bloque y no se vuelve a armar: lo que ya dijo no se repite.
    for (const hijo of [...accionesEl.children]) if (hijo !== filaEl) hijo.remove();
    accionesEl.append(...botones);
    // En la vista de siempre, la barra de abajo es lo único que se ve en una pantalla chica: lo que pasó al tocar Ver tus campañas va
    // arriba del botón. En las demás vistas el aviso vuelve a su lugar, debajo de la línea.
    if (vista === "elegir") accionesEl.prepend(avisoEl);
    else if (avisoEl.parentElement !== cabEl) cabEl.insertBefore(avisoEl, conexionEl);
  }

  /** Desde la pantalla de que la campaña sigue en otra compu: volver a tomarla acá. Con la inscripción abierta o la lista cerrada, se pregunta. */
  function usarDesdeTomada(): void {
    const s = sala;
    if (!s) return;
    if (faseSala === "abierta" || faseSala === "cerrada") irASeguir(s.evento, "tomada");
    else void usarAqui(s.evento, "tomada");
  }

  function elegir(): void {
    archivoEl.value = "";
    archivoEl.click();
  }

  /** Si este navegador guarda una campaña por activar (la que dejó crear-campana.html), la haya tomado el panel o no. */
  function borradorGuardado(): boolean {
    return leerBorrador(deps.almacen, deps.cuenta()) !== null;
  }

  /**
   * Deja la campaña por activar: se borra el borrador y se vuelve a la portada de siempre. Quien la armó nunca tuvo un archivo
   * firmado, así que la vista de elegirlo no le dice nada.
   */
  function dejarLaCampana(): void {
    volverAElegir();
    borrarBorrador(deps.almacen);
    deps.ir?.("/");
  }

  function volverAElegir(): void {
    activandoLaSala = false;
    soltarElBorrador();
    archivo = null;
    intento = null;
    campana = null;
    pide = null;
    cm?.reiniciar();
    mensaje = "";
    vista = "elegir";
    pintar();
  }

  const TITULOS: Partial<Record<Vista, string>> = {
    elegir: "cpoTitulo",
    confirmar: "cpoCerrarT",
    olvidar: "cpoOlvidarT",
    cerrada: "cpoCerradaT",
    sellada: "cpoSellada",
    sorteada: "cpoSorteada",
    cargando: "cpoCargando",
    "sin-red": "cpoSinConexionT",
    "otra-pestana": "cpoOtraPestana",
    tomada: "cpoTomadaT",
    tus: "cpoTusT",
    seguir: "cpoSeguirT",
  };

  function pintarTextos(): void {
    const idioma = deps.idioma();
    const zona = campana?.zona ?? "UTC";
    let titulo = tx(TITULOS[vista] ?? "cpoTitulo");
    let linea = "";
    if (vista === "elegir") linea = tx("cpoElegirLinea");
    if (vista === "confirmar") linea = tx("cpoCerrarLinea");
    // Con la lista cerrada y sin ningún paso en curso, la línea dice la consecuencia. Si un paso habla, habla él (la fila viva o su línea).
    if (vista === "cerrada" && pasoDelPuente().paso === "nada") linea = tx("cpoCerrarLinea");
    if (vista === "cerrada" && sinLeer) linea = tx("cpoNoLeyo");
    if (vista === "tomada") linea = tx("cpoTomadaL");
    if (vista === "tus") linea = tx("cpoTusL");
    if (vista === "seguir") linea = tx("cpoSeguirL");
    // La pregunta de dejar la campaña dice, en una sola línea condicional, qué pasa con los celulares que todavía esperan un aviso.
    // Sale con la misma regla que decide si se pregunta por los avisos (la de siempre, avisosPendientes), desde la lista cerrada,
    // sellada o sorteada, y no sale con la sala ya borrada: no queda nadie a quien avisar. Las demás preguntas no la llevan.
    if (vista === "olvidar" && (vistaAntes === "cerrada" || vistaAntes === "sellada" || vistaAntes === "sorteada")) {
      const paso = pasoDelPuente();
      if (paso.paso !== "sala-borrada" && avisosPendientes(paso, vistaAntes === "sorteada")) linea = tx("cpoOlvidarAviso");
    }
    const delPaso = vista === "cerrada" || vista === "sellada" || vista === "sorteada" ? lineaDelPaso(pasoDelPuente()) : null;
    // Lo que la fila viva ya dice no se repite en la línea: la fila ocupa su lugar.
    if (delPaso) linea = enLaFila()?.texto === tx(delPaso.clave) ? "" : fmt(delPaso.clave, { ...delPaso.vars, boton: deps.botonDeSellar?.() ?? t("freeze") });
    if (campana && vista === "previa") {
      const hora = horaTexto(campana.cierraMs, zona, idioma);
      const pedidos = campana.pasos.length;
      titulo = fmt("cpTitulo", { empresa: campana.empresa.nombre });
      const clave = pedidos === 0 ? "cpoCierraPedidos0" : pedidos === 1 ? "cpoCierraPedidos1" : "cpoCierraPedidosN";
      linea = fmt(clave, { hora, n: pedidos });
      // Sin pagar lo que cobra Tinkazo, la pantalla dice qué falta: un título, una línea y un botón.
      const d = cm?.activo() ? cm.descripcion() : null;
      if (d?.titulo != null) titulo = d.titulo;
      if (d?.linea != null) linea = d.linea;
      // La campaña por activar, sin sesión: el título la nombra, y la línea del cobro dice lo que sigue y lo que cuesta.
      if (porActivarSinSesion()) titulo = fmt("cpoBorradorT", { empresa: campana.empresa.nombre });
      // Con el borrador ya pagado, la pantalla dice cómo va la activación.
      const deActivar = pasoDeActivar();
      if (deActivar) {
        titulo = deActivar.titulo;
        linea = deActivar.linea;
      }
      // Una campaña de personas con el modo sin prender: se dice eso, en lugar de la hora de cierre y del botón de abrir.
      if (personasEn() === "no") {
        titulo = tx("cpoPersonasNoT");
        linea = tx("cpoPersonasNoL");
      }
    }
    if (campana && vista === "abierta") {
      titulo = pasoLaHora() ? tx("cpoHoraDeCerrar") : fmt("cpoAbiertaHasta", { hora: horaTexto(cierraMs, zona, idioma) });
    }
    tituloEl.textContent = titulo;
    lineaEl.textContent = linea;
    const deQuien = campana !== null && vista === "previa" && esDeBorrador() && !porActivarSinSesion();
    if (deQuien && !deEl) {
      deEl = document.createElement("p");
      deEl.id = "cpo-de";
      deEl.className = "cpo-de";
      tituloEl.before(deEl);
    }
    if (deEl) {
      deEl.hidden = !deQuien;
      deEl.textContent = campana ? fmt("cpoDeLaCampana", { empresa: campana.empresa.nombre }) : "";
    }
    // Con el cobro prendido y pagado, el panel lo dice: sin la marca se vería igual al que nunca cobró.
    // Si la sala todavía no ve el pago de un borrador, la marca de pagado se contradice con el título: no se muestra.
    const sinVerElPago = borrador !== null && archivo === null && activacion.tipo === "error" && activacion.motivo === "no-pagada";
    const pagadaConCobro = raiz.dataset.comision === "pagada" && !sinVerElPago;
    if (pagadaConCobro && !marcaEl) {
      marcaEl = document.createElement("p");
      marcaEl.id = "cpo-marca";
      marcaEl.className = "cpo-marca cpo-marca-viva";
      // Es un aviso: cuando el texto aparece, el lector de pantalla lo dice una vez.
      marcaEl.setAttribute("role", "status");
      tituloEl.after(marcaEl);
    }
    if (marcaEl) {
      const texto = pagadaConCobro ? tx("cpoCmPagada") : "";
      // El tilde salta una sola vez, cuando el pago se confirma mientras se lo esperaba. Con la página ya pagada queda quieto.
      if (pagadaConCobro && !marcaVista && esperabaElCobro) marcaEl.classList.add("recien");
      if (!pagadaConCobro) marcaEl.classList.remove("recien");
      marcaEl.hidden = !pagadaConCobro;
      if (marcaEl.textContent !== texto) marcaEl.textContent = texto;
    }
    marcaVista = pagadaConCobro;
    if (pagadaConCobro) esperabaElCobro = false;
    // Mientras la fila dice que lee la lista, el Un momento del aviso no se suma.
    avisoEl.textContent = leyendoLaLista && mensaje === tx("cpoCargando") ? "" : mensaje;
  }

  /** Cada ganadora con su botón de Avisar a y lo que dijo el servicio del acceso. Solo con el resultado en la sala. */
  function pintarGanadoras(): void {
    const paso = pasoDelPuente();
    const ver = vista === "sorteada" && paso.paso === "resultado";
    ganadorasEl.hidden = !ver;
    if (!ver || paso.paso !== "resultado") return ganadorasEl.replaceChildren();
    // Quien ganó y todavía no sabe: avisarle es lo que sigue, y es el botón principal del panel, que va arriba de la lista
    // (pintarAcciones): su fila no lo repite. Las demás quedan con su botón de apoyo.
    const primeraPorAvisar = paso.filas.findIndex((g) => !g.avisada);
    const enMano = paso.enMano === true;
    const filasDeGanadoras = paso.filas.map((g, i) => {
      const li = document.createElement("li");
      li.className = "cpo-fila";
      const nombre = document.createElement("span");
      nombre.className = "cpo-nombre";
      nombre.textContent = g.nombre;
      li.append(nombre);
      if (g.avisada) {
        const dicho = document.createElement("p");
        dicho.className = "cpo-salio";
        // En mano el panel no sabe si el celular se enteró: solo que quien organiza lo marcó.
        dicho.textContent = tx(enMano ? "cpoMarcadaAvisada" : "cpoAvisada");
        li.append(dicho);
      } else {
        if (i !== primeraPorAvisar) li.append(boton(fmt("cpoAvisarA", { nombre: g.nombre }), "ghost", () => accionesDelPuente().avisarA?.(g.cuenta)));
      }
      if (enMano) {
        // Sin servicio del acceso no hay nada que preparar ni que recibir: de la fila sale solo el código, si se tiene.
        if (g.codigo !== undefined) {
          const codigo = document.createElement("span");
          codigo.className = "cpo-marca";
          codigo.textContent = fmt("cpoCodigoDeEntrega", { codigo: g.codigo });
          li.append(codigo);
        }
        return li;
      }
      if (g.alta !== "esperando" && g.alta.estado === "puede") {
        const marca = document.createElement("span");
        marca.className = "cpo-marca";
        marca.textContent = tx("cpoPuedeRecibir");
        li.append(marca);
      } else if (g.alta !== "esperando" && g.alta.estado === "fallo") {
        const marca = document.createElement("span");
        marca.className = "cpo-marca";
        marca.textContent = tx("cpoNoSePudo");
        li.append(marca);
        if (g.alta.final !== true) li.append(boton(tx("cpoReintentar"), "enlace", () => accionesDelPuente().reintentarAlta?.(g.cuenta)));
      }
      return li;
    });
    // Los códigos se pidieron todas las veces y no se pudieron leer: el enlace para pedirlos de nuevo, al final. Mientras se
    // están pidiendo, o sin quien los pida, no aparece: el panel no ofrece algo que no puede hacer.
    const verCodigos = accionesDelPuente().verCodigos;
    if (enMano && paso.sinCodigos === true && verCodigos && paso.filas.some((g) => g.codigo === undefined)) {
      const li = document.createElement("li");
      li.className = "cpo-fila";
      li.append(boton(tx("cpoVerCodigos"), "enlace", () => verCodigos()));
      filasDeGanadoras.push(li);
    }
    // El último aviso no se pudo marcar: se dice arriba de la lista, junto al botón que sigue ahí para probar de nuevo.
    if (enMano && paso.sinAviso === true) {
      const li = document.createElement("li");
      li.className = "cpo-fila";
      const dicho = document.createElement("p");
      dicho.className = "cpo-salio";
      dicho.setAttribute("role", "alert");
      dicho.textContent = tx("cpoNoSeMarco");
      li.append(dicho);
      filasDeGanadoras.unshift(li);
    }
    ganadorasEl.replaceChildren(...filasDeGanadoras);
  }

  /**
   * Lo que la línea del premio necesita para existir ahora: la cuenta que entró, el total de premios y la clave que junta esos dos
   * con el estado del cobro. Es `null` cuando no hay línea: sin la dependencia, fuera de la vista previa, en otra red, con el cobro
   * sin pagar, sin cuenta entrada o con una campaña que pide sellar con otra cuenta (la línea nunca habla de una cuenta que no es la
   * de quien mira). Puede lanzar si el premio está mal formado: quien la llama la protege.
   */
  function datosDelDeposito(): { cuenta: string; total: bigint; clave: string } | null {
    if (!deps.deposito || vista !== "previa" || campana === null || campana.premioEnMano !== undefined || campana.red !== "mainnet" || cm?.bloqueaElAbrir()) return null;
    const cuenta = deps.cuenta();
    if (cuenta === null || (pide !== null && pide !== cuenta)) return null;
    const total = totalDePremios(campana.premios);
    return { cuenta, total, clave: [cuenta, total.toString(), cm?.estado().tipo ?? ""].join("|") };
  }

  /** Suelta lo leído y todo lo que esperaba: sin línea no queda ni resultado guardado ni reloj. */
  function descartarElDeposito(): void {
    deposito = null;
    claveReintentada = "";
    pararRelojDelDeposito?.();
    pararRelojDelDeposito = null;
    pararReintentoDelDeposito?.();
    pararReintentoDelDeposito = null;
  }

  /**
   * Mira en la red si el premio está en la cuenta. Lee una vez por cuenta, total y estado del cobro (al pagarse el servicio el
   * saldo baja, y se vuelve a mirar), y después una vez cada 50 segundos mientras el panel está a la vista: el texto de antes sigue
   * hasta que llega la lectura nueva, y una lectura de más de un minuto no se afirma. Con la pestaña escondida no lee. `volvio` es
   * la vuelta a la pestaña: quien cargó dólares en otra ventana lo ve al volver, sin pedir más de una vez cada 5 segundos. `ahora`
   * es justo antes de abrir la inscripción: lee siempre, sin esperarla. `reloj` es la relectura de los 50 segundos y `reintento`
   * el único segundo intento de una primera lectura fallida. Nunca frena nada ni lanza: es solo la línea.
   *
   * Con el cobro prendido y todavía sin pagar no se mira ni se dice nada: lo que hay que cargar es el premio más lo que se cobra,
   * y eso ya lo dice el control del cobro con su propia lectura del saldo. Una línea que dijera que el premio está en la cuenta
   * mientras el cobro pide cargar más se contradiría en la misma pantalla. Pagado el servicio, el saldo ya no lleva esa parte
   * y la línea compara contra el premio solo.
   */
  function mirarElDeposito(modo: "normal" | "volvio" | "ahora" | "reloj" | "reintento" = "normal"): void {
    try {
      const lector = deps.deposito;
      // Un panel ya detenido no lanza lecturas de más.
      if (!lector || depositoDetenido) return;
      const datos = datosDelDeposito();
      if (datos === null) {
        if (deposito !== null) descartarElDeposito();
        return;
      }
      if (document.visibilityState === "hidden") return;
      const { cuenta, total, clave } = datos;
      const hora = deps.ahora();
      const antes = deposito?.clave === clave ? deposito : null;
      const vieja = antes !== null && !vigenteElDeposito(hora - antes.de);
      if (antes !== null && !vieja) {
        // Ya leída y todavía fresca: solo la vuelta a la pestaña (cada 5 s como mucho), la relectura del reloj o el toque de abrir vuelven a leer.
        if (modo === "normal") return;
        if (modo === "volvio" && hora - ultimaMiradaDelDeposito < ENTRE_MIRADAS_DEL_DEPOSITO_MS) return;
      }
      // Con una lectura en el aire, un repintado cualquiera no pide otra.
      if (antes?.enVuelo && modo === "normal") return;
      ultimaMiradaDelDeposito = hora;
      // El texto bueno de antes se queda en la línea mientras la lectura nueva viene en camino: su edad dice hasta cuándo se afirma.
      // Solo el reloj de la relectura sigue el de la lectura de antes, salvo que esta esté vieja o sea el toque de abrir.
      const conserva = antes !== null && !vieja && modo !== "ahora";
      const esta = {
        clave,
        bueno: antes !== null ? antes.bueno : null,
        de: antes !== null && conserva ? antes.de : hora,
        enVuelo: true,
        inicial: antes !== null ? antes.inicial : true,
        inicio: antes !== null ? antes.inicio : hora,
        releyendo: conserva,
      };
      deposito = esta;
      // Una lectura nueva deja sin efecto el reintento que esperaba: la que sigue ya hace de segundo intento.
      pararReintentoDelDeposito?.();
      pararReintentoDelDeposito = null;
      const primera = antes === null;
      programarElRelojDelDeposito();
      void Promise.resolve()
        .then(() => lector.leer(cuenta))
        .then((lectura) => estadoDelDeposito(lectura, total))
        .catch((): EstadoDelDeposito => ({ tipo: "sin-lectura" }))
        .then((estado) => {
          if (deposito !== esta || depositoDetenido) return;
          esta.de = hora;
          esta.enVuelo = false;
          esta.releyendo = false;
          if (estado.tipo === "sin-lectura") {
            // Una lectura que falla no pisa la buena de antes. La primera tiene un único reintento: hasta que termine, la línea espera vacía.
            if (primera && claveReintentada !== clave) {
              claveReintentada = clave;
              pararReintentoDelDeposito?.();
              pararReintentoDelDeposito = deps.esperar(() => {
                pararReintentoDelDeposito = null;
                if (deposito === esta && !depositoDetenido) mirarElDeposito("reintento");
              }, REINTENTO_DEL_DEPOSITO_MS);
            } else {
              esta.inicial = false;
            }
          } else {
            esta.bueno = { estado, de: hora };
            esta.inicial = false;
          }
          programarElRelojDelDeposito();
          pintar();
        })
        .catch(() => undefined);
    } catch {
      // Un premio mal formado o cualquier otra falla de la línea: no hay línea y el panel se dibuja como siempre.
      try {
        descartarElDeposito();
      } catch {
        deposito = null;
      }
    }
  }

  /**
   * Un solo reloj para la línea. A los 50 segundos de la última lectura pide la relectura (con la pestaña a la vista) y, en el
   * momento en que lo que dice la línea se vence (la lectura buena cumple su minuto, o la primera lectura que no contestó), despierta
   * al panel para que el texto cambie. Cada lectura nueva lo reprograma y descartar la línea lo apaga. Nunca espera más de lo que
   * dura una lectura: si la hora del sistema se atrasó, vuelve a mirar en lugar de quedarse esperando.
   */
  function programarElRelojDelDeposito(): void {
    pararRelojDelDeposito?.();
    pararRelojDelDeposito = null;
    const d = deposito;
    if (d === null || depositoDetenido) return;
    const ahora = deps.ahora();
    const edadDeLaUltima = ahora - d.de;
    const aLeer = d.releyendo ? null : edadDeLaUltima < 0 ? 0 : Math.max(0, RELECTURA_DEL_DEPOSITO_MS - edadDeLaUltima);
    const origen = d.bueno !== null && vigenteElDeposito(ahora - d.bueno.de) ? d.bueno.de : d.inicial && vigenteElDeposito(ahora - d.inicio) ? d.inicio : null;
    const aVencer = origen === null ? null : Math.max(0, origen + RELOJ_DEL_DEPOSITO_MS - ahora);
    const esperas = [aLeer, aVencer].filter((x): x is number => x !== null);
    if (esperas.length === 0) return;
    pararRelojDelDeposito = deps.esperar(
      () => {
        pararRelojDelDeposito = null;
        if (depositoDetenido || deposito !== d) return;
        const edad = deps.ahora() - d.de;
        if (!d.releyendo && (edad < 0 || edad >= RELECTURA_DEL_DEPOSITO_MS)) {
          d.releyendo = true;
          mirarElDeposito("reloj");
        } else {
          pintar();
        }
        // Si no salió una lectura (la pestaña escondida, por ejemplo), queda lo que falta: el vencimiento.
        if (deposito === d && pararRelojDelDeposito === null) programarElRelojDelDeposito();
      },
      Math.min(Math.min(...esperas), RELOJ_DEL_DEPOSITO_MS),
    );
  }

  /**
   * La línea del premio en la vista previa: mientras corresponde está siempre a la vista, con su alto, tenga texto o no. Dice si el
   * premio está o cuánto falta con una lectura buena de menos de un minuto (una relectura que falla no la pisa antes de tiempo). Con
   * la primera lectura (o su único reintento) en camino queda vacía. Con la lectura fallida o vencida dice que no se pudo ver. Solo se
   * esconde cuando deja de corresponder: sin cuenta, con otra cuenta, otra red, el cobro sin pagar o fuera de la vista previa. El
   * texto solo se reescribe cuando cambia lo que dice.
   */
  function pintarDeposito(): void {
    try {
      if (!deps.deposito) return;
      const datos = datosDelDeposito();
      if (datos === null && deposito !== null) descartarElDeposito();
      const corresponde = datos !== null;
      let texto = "";
      if (datos !== null) {
        const d = deposito !== null && deposito.clave === datos.clave ? deposito : null;
        const ahora = deps.ahora();
        const bueno = d?.bueno ?? null;
        if (bueno !== null && vigenteElDeposito(ahora - bueno.de)) {
          texto =
            bueno.estado.tipo === "falta"
              ? fmt("cpoDepFalta", { falta: dolaresEnTexto(bueno.estado.falta, deps.idioma()) })
              : tx("cpoDepAlcanza");
        } else if (d !== null && d.inicial && vigenteElDeposito(ahora - d.inicio)) {
          texto = "";
        } else if (d !== null || document.visibilityState === "visible") {
          texto = tx("cpoDepSinLectura");
        }
      }
      if (depositoEl === null) {
        if (!corresponde) return;
        depositoEl = document.createElement("p");
        depositoEl.id = "cpo-deposito";
        depositoEl.className = "cpo-linea cpo-deposito";
        depositoEl.setAttribute("role", "status");
        premioEl.after(depositoEl);
      }
      if (depositoEl.hidden === corresponde) depositoEl.hidden = !corresponde;
      if (depositoEl.textContent !== texto) depositoEl.textContent = texto;
    } catch {
      try {
        descartarElDeposito();
        if (depositoEl !== null) {
          depositoEl.textContent = "";
          depositoEl.hidden = true;
        }
      } catch {
        // Sin línea y nada más.
      }
    }
  }

  /** Al volver a esta pestaña se mira de nuevo el premio: quien cargó dólares en otra ventana lo ve sin recargar. */
  const alVolverAVer = (): void => {
    if (document.visibilityState !== "visible") return;
    mirarElDeposito("volvio");
    // Se repinta en el mismo instante: un texto que ya cumplió su minuto pasa a no se pudo ver sin esperar a la lectura nueva.
    pintarDeposito();
  };
  document.addEventListener("visibilitychange", alVolverAVer);

  function pintarBloques(): void {
    const enAbierta = vista === "abierta";
    const verLista = vista === "abierta" || vista === "cerrada";
    previaEl.hidden = vista !== "previa" || !campana;
    mirarElDeposito();
    pintarDeposito();
    if (campana && vista === "previa") {
      // Con el cobro prendido todos los montos del panel llevan dos decimales: el premio también (120,00 y no 120).
      premioEl.textContent = textoDelPremio(campana, deps.idioma(), cm?.activo() === true);
      const logo = campana.empresa.logo;
      logoEl.hidden = logo === null;
      if (logo) logoEl.src = `data:${logo.tipo};base64,${logo.datos}`;
      logoEl.alt = campana.empresa.nombre;
    }
    qrBloque.hidden = !enAbierta;
    const enlace = enlaceDelQr();
    qrImg.hidden = enlace === null;
    qrImg.alt = tx("cpoQrAlt");
    // Solo con el recuadro a la vista: dibujado escondido no se puede medir, y el QR saldría de otro tamaño al mostrarse.
    if (enlace !== null && !qrBloque.hidden && enlace !== ultimoEnlace) {
      ultimoEnlace = enlace;
      void deps.qr(qrImg, enlace, 300, true);
    }
    // Solo se dice algo cuando el pase dejó de renovarse: con el sondeo andando solo no hay nada que hacer.
    conexionEl.hidden = !(enAbierta && (paseCaido || paseRechazado || (pase !== null && !qrVigente())));
    // Con el QR a la vista se avisa que puede vencer. Sin QR no hay nada que pueda vencer: se dice que se reconecta.
    // Si la sala no acepta este panel no hay nada que esperar: se dice eso, y el botón de otro archivo ya lo resuelve.
    conexionEl.textContent = tx(paseRechazado ? "cpoPaseRechazado" : enlace === null ? "cpoSinConexionQr" : "cpoQrSinConexion");
    numeroBloque.hidden = !verLista;
    if (verLista) {
      const total = visibles().length;
      numeroEl.textContent = String(total);
      etiquetaEl.textContent = tx(total === 1 ? "cpoEnLaLista1" : "cpoEnLaListaN");
    }
    listaBloque.hidden = !verLista;
    pieEl.hidden = vista !== "cerrada" || !sala || !campana;
    if (sala && campana && vista === "cerrada") {
      const fecha = fechaTexto(sala.vence, campana.zona, deps.idioma());
      // La consecuencia dicha en simple: la lista queda a la vista, sin palabras que asusten.
      pieEl.textContent = fmt("cpoSeBorra", { fecha, hora: horaTexto(sala.vence, campana.zona, deps.idioma()) });
    }
    pintarPlegado();
  }

  /* --- el plegado de pagar desde otra billetera --- */

  /** Se arma recién la primera vez que hace falta: con el cobro apagado, el DOM del panel es el de siempre. */
  let plegadoEl: HTMLDetailsElement | null = null;
  let firmaDelPlegado = "";
  let ultimoPlegado: "abierto" | "cerrado" | null = null;

  function copiable(etiqueta: string, valor: string, conBoton: boolean): HTMLElement {
    const fila = document.createElement("div");
    fila.className = "cpo-cm-fila";
    const et = document.createElement("span");
    et.className = "cpo-cm-et";
    et.textContent = etiqueta;
    const dato = document.createElement("span");
    dato.className = "cpo-cm-dato";
    dato.textContent = valor;
    fila.append(et, dato);
    if (conBoton) {
      const b = boton(t("acctCopy"), "ghost", (el) => {
        try {
          void navigator.clipboard?.writeText(valor);
          el.textContent = t("acctCopied");
        } catch {
          /* sin portapapeles: el dato está a la vista para copiarlo a mano */
        }
      });
      fila.append(b);
    }
    return fila;
  }

  function pintarPlegado(): void {
    const d = vista === "previa" && cm?.activo() ? cm.descripcion() : null;
    const datos = d?.plegado ? cm?.datosDelPlegado() : null;
    if (!d?.plegado || !datos) {
      if (plegadoEl) plegadoEl.hidden = true;
      ultimoPlegado = null;
      return;
    }
    const el = plegadoEl ?? document.createElement("details");
    if (!plegadoEl) {
      plegadoEl = el;
      el.id = "cpo-comision";
      el.className = "cpo-comision";
      // Debajo de los botones: lo que se toca queda pegado a la línea y lo de copiar va después.
      accionesEl.after(el);
    }
    el.hidden = false;
    const firma = [datos.cuenta, datos.monto, datos.nota, deps.idioma()].join("|");
    if (firma !== firmaDelPlegado) {
      firmaDelPlegado = firma;
      const resumen = document.createElement("summary");
      resumen.textContent = tx("cpoCmPlegado");
      const img = document.createElement("img");
      img.alt = tx("cpoCmQrAlt");
      img.width = 200;
      img.height = 200;
      el.replaceChildren(
        resumen,
        copiable(tx("cpoCmCuenta"), datos.cuenta, true),
        copiable(tx("cpoCmMonto"), dolaresEnTexto(datos.monto, deps.idioma()), false),
        copiable(tx("cpoCmNota"), datos.nota, true),
        img,
      );
      void deps.qr(img, datos.enlace, 200);
    }
    // Se abre sola cuando es el único camino, y después queda como la dejó quien organiza.
    if (d.plegado !== ultimoPlegado) {
      el.open = d.plegado === "abierto";
      ultimoPlegado = d.plegado;
    }
  }

  /** Cada fila se arma con lo que importa: su número manda, nunca su lugar en la lista. */
  function fila(f: Fila): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "cpo-fila";
    li.dataset.n = String(f.n);
    const persona = fmt("cpoPersona", { n: f.n });
    const nombre = f.revisar ? tx("cpoParaRevisar") : f.nombre ?? persona;
    const motivoEnVuelo = pendientes.get(f.n)?.motivo ?? enviando.get(f.n);
    if (motivoEnVuelo) {
      const dicho = (f.revisar ? persona : f.nombre ?? persona);
      const motivo = tx(textoDelMotivo(motivoEnVuelo, esLineaDePersona(f.cuenta))).toLocaleLowerCase(deps.idioma());
      const p = document.createElement("p");
      p.className = "cpo-salio";
      p.textContent = fmt("cpoSalio", { nombre: dicho, motivo });
      li.append(p);
      if (pendientes.has(f.n)) li.append(botonDeFila("cpoDeshacer", "deshacer", f.n, "ghost"));
      return li;
    }
    const span = document.createElement("span");
    span.className = "cpo-nombre";
    span.textContent = nombre;
    li.append(span);
    if (!listaTrabada()) {
      const quitar = botonDeFila("cpoQuitar", "quitar", f.n, "mini");
      quitar.setAttribute("aria-label", `${tx("cpoQuitar")}: ${f.revisar ? persona : f.nombre ?? persona}`);
      li.append(quitar);
    }
    if (f.revisar) li.append(botonDeFila("cpoMostrar", "mostrar", f.n, "mini"));
    if (preguntando.has(f.n)) {
      const motivos = document.createElement("div");
      motivos.className = "cpo-motivos";
      const p = document.createElement("p");
      p.textContent = tx("cpoPorQue");
      motivos.append(p);
      for (const m of MOTIVOS) {
        const b = botonDeFila(textoDelMotivo(m, esLineaDePersona(f.cuenta)), "motivo", f.n, "ghost");
        b.dataset.motivo = m;
        motivos.append(b);
      }
      motivos.append(botonDeFila("cpoCancelar", "cancelar", f.n, "enlace"));
      li.append(motivos);
    }
    return li;
  }

  function botonDeFila(clave: string, accion: string, n: number, estilo: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = estilo;
    b.textContent = tx(clave);
    b.dataset.accion = accion;
    b.dataset.n = String(n);
    return b;
  }

  /**
   * La lista se rearma solo si cambió lo que se ve. Con el puntero encima, el foco adentro o una pregunta abierta, no se
   * reordena ni se inserta arriba: las altas nuevas esperan y se pintan al soltar. Si no, la fila que se está por tocar
   * baja justo cuando se toca Quitar y sale otra persona.
   */
  function pintarLista(): void {
    if (listaBloque.hidden) return;
    // Lo que hay que revisar va arriba, donde el aviso lo señala; el resto, de la alta más nueva a la más vieja.
    const aRevisar = (n: number): number => Number(filas.get(n)?.revisar === true);
    const todas = [...filas.keys()].sort((a, b) => aRevisar(b) - aRevisar(a) || b - a);
    const ns = congelada() ? pintadas.filter((n) => filas.has(n)) : todas;
    const dibujar = ns.map((n) => filas.get(n)).filter((f): f is Fila => f !== undefined);
    const firma = JSON.stringify([
      deps.idioma(),
      listaTrabada(),
      dibujar.map((f) => [f.n, f.nombre, f.revisar, preguntando.has(f.n), pendientes.get(f.n)?.motivo, enviando.get(f.n)]),
    ]);
    notaEl.hidden = !visibles().some((f) => f.revisar);
    notaEl.textContent = tx("cpoParaRevisarNota");
    // Una campaña tomada desde otra compu no sabe los nombres de quienes se anotaron antes: salen con su número. La línea lo dice
    // debajo del QR, arriba de la lista, y no arriba del botón: ahí empujaría la acción principal fuera de la pantalla.
    const sinNombre = recuperada && visibles().some((f) => f.nombre === null);
    antesEl.hidden = !sinNombre;
    antesEl.textContent = sinNombre ? tx(vista === "abierta" ? "cpoAntesConNumero" : "cpoAntesCerrada") : "";
    if (firma === firmaDeLista) return;
    firmaDeLista = firma;
    pintadas = ns;
    ulEl.replaceChildren(...dibujar.map(fila));
  }

  function pintar(): void {
    raiz.dataset.vista = vista;
    // La campaña por activar (campana-sala.css): en su vista previa lo único en pantalla es el panel.
    raiz.toggleAttribute("data-borrador", esDeBorrador());
    // Solo con el cobro prendido: apagado, el panel no lleva este atributo.
    if (vista === "previa" && cm?.activo()) raiz.dataset.comision = cm.estado().tipo;
    else if (raiz.dataset.comision !== undefined) delete raiz.dataset.comision;
    pintarTextos();
    pintarBloques();
    pintarAcciones();
    pintarFila();
    pintarLista();
    pintarGanadoras();
    pintarTus();
    pintarTusBuscar();
  }

  /* --- lo que se toca --- */

  archivoEl.addEventListener("change", () => {
    const f = archivoEl.files?.[0];
    if (f) void alElegir(f);
  });

  ulEl.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-accion]");
    if (!b) return;
    const n = Number(b.dataset.n);
    const accion = b.dataset.accion;
    if (accion === "quitar") {
      // Una pregunta a la vez: abrir otra cierra la anterior.
      preguntando.clear();
      preguntando.add(n);
    } else if (accion === "cancelar") {
      preguntando.delete(n);
    } else if (accion === "motivo") {
      const motivo = MOTIVOS.find((m) => m === b.dataset.motivo);
      if (motivo) return elegirMotivo(n, motivo);
    } else if (accion === "deshacer") {
      return deshacer(n);
    } else if (accion === "mostrar") {
      return mostrar(n);
    }
    firmaDeLista = "";
    pintar();
    // La pregunta del motivo se abre dentro de la caja de la lista: se la trae a la vista entera.
    if (accion === "quitar") ulEl.querySelector(`li[data-n="${n}"]`)?.scrollIntoView?.({ block: "nearest" });
  });
  ulEl.addEventListener("pointerenter", () => {
    punteroDentro = true;
  });
  ulEl.addEventListener("pointerleave", () => {
    punteroDentro = false;
    if (!congelada()) pintar();
  });
  ulEl.addEventListener("focusout", () => {
    // El foco se va después de este evento: se mira en cuanto se asienta.
    queueMicrotask(() => {
      if (!congelada()) pintar();
    });
  });

  /* --- arranque: retomar lo que recuerda la compu --- */

  // El paso de la herramienta (pasar la lista, avisar a los celulares) se dibuja en este panel, y cambiar de cuenta lo repite.
  dejarElPuente = alCambiarElPuente(() => {
    // La sala quedó sellada o con el resultado: el panel pasa a esa fase, que es lo que se recuerda para retomar.
    const dicho = pasoDelPuente().paso;
    // El aviso del sello o del resultado dijo que el token no vale: otra compu tomó la campaña.
    if (sala && dicho === "tomada") return tomada();
    // Con la pregunta de dejar la campaña abierta la fase sigue su camino: se mira la vista de la que se vino, la pregunta
    // se queda en pantalla y, al cancelar, se vuelve a la fase nueva y no a la vieja.
    const preguntando = vista === "olvidar";
    const efectiva = preguntando ? vistaAntes : vista;
    const nueva: FaseDeSala | null =
      sala && efectiva === "cerrada" && dicho === "avisada" ? "sellada" : sala && (efectiva === "cerrada" || efectiva === "sellada") && dicho === "resultado" ? "sorteada" : null;
    if (nueva) {
      irA(nueva, null);
      if (preguntando) {
        vistaAntes = vista;
        vista = "olvidar";
      }
    }
    pintar();
    grande.pintar();
  });
  // Con otra cuenta conectada se vuelve a correr el paso aunque la lista ya esté en el cuadro: si no es la que nombra la
  // campaña el cuadro se vacía y se dice con cuál entrar, en lugar de dejar Sellar a la vista; si es, se vuelve a pasar.
  const alCambiarLaSesion = (): void => {
    const conectada = deps.cuenta();
    // La lista de Tus campañas es de una cuenta: con otra, o sin sesión, no se queda a la vista.
    if ((vista === "tus" || (vista === "seguir" && seguirDe?.desde === "tus")) && tusDeCuenta !== null && tusDeCuenta !== conectada) {
      tus = [];
      tusDeCuenta = null;
      tusFalla = null;
      seguirDe = null;
      tusTrabajando = null;
      mensaje = "";
      vista = "elegir";
    }
    // Otra cuenta no ve ni mueve la campaña de esta: sale de la vista sin borrar nada.
    if (sala && !seVeDesde(duena, conectada)) return apartar();
    if (borrador !== null && archivo === null) {
      if (borradorEsDeOtra(deps.almacen, conectada)) return apartarElBorrador();
      if (conectada !== null) anotarDuenaDelBorrador(deps.almacen, conectada);
    }
    // Al volver la cuenta dueña (o sin sesión) se retoma lo que se había apartado, o lo que esta cuenta no veía antes.
    if (!sala && borrador === null && archivo === null && vista === "elegir") {
      const g = leerOrg(deps.almacen, deps.ahora(), deps.red(), conectada);
      if (g) {
        apartada = false;
        return void retomar(g);
      }
      if (apartada && cm?.activo() && leerBorrador(deps.almacen, conectada) !== null) {
        apartada = false;
        return void retomarBorrador();
      }
    }
    // Con la sesión, Tus campañas se pide sola si se llegó por la dirección del panel y no hay otra cosa a la vista.
    if (!sala && vista === "elegir" && conectada !== null) pedirTusAlAbrir();
    if (vista === "tus" && conectada !== null && tus.length === 0) void pedirTus(true);
    if (sala && duena === undefined) void completarLaDuena();
    if (vista === "cerrada" && pasada) correrPaso();
    // Con otra cuenta cambia con qué se paga y cuánto hay cargado: el cobro se vuelve a mirar.
    if (vista === "previa") {
      // Un borrador que no se pudo activar por la sesión se vuelve a intentar con la cuenta nueva.
      if (borrador !== null && archivo === null && activacion.tipo === "error") activacion = { tipo: "esperando" };
      void cm?.mirar();
    }
    // Entrar o salir cambia lo que se ve: Tus campañas, el cobro y el paso del sorteo (sellar pide la cuenta dueña).
    pintar();
  };
  document.addEventListener("tinkazo:sesion", alCambiarLaSesion);
  dejarLaSesion = () => document.removeEventListener("tinkazo:sesion", alCambiarLaSesion);

  registrarAcciones({
    reintentarPaso: () => correrPaso(),
    soltarYPasar: () => void Promise.resolve(deps.soltarElSello?.()).then(() => correrPaso()),
    cambiarDeCuenta: () => deps.cambiarDeCuenta?.(),
  });

  const guardada = leerOrg(deps.almacen, deps.ahora(), deps.red(), deps.cuenta());
  const otra: RedDeCampana = deps.red() === "mainnet" ? "testnet" : "mainnet";
  if (guardada) {
    void retomar(guardada);
    if (cm?.activo()) quitarElBorradorDe(guardada.sala.evento);
  } else if (leerOrg(deps.almacen, deps.ahora(), otra, deps.cuenta())) {
    // Su sala sigue en su modo y no estorba: acá se puede abrir otra campaña.
    mensaje = fmt("cpoOtroModoAbierta", { modo: tx(nombreDeRed(otra)) });
  }
  pintar();
  // Se le pregunta a la sala si tiene Tus campañas antes de que haga falta: así el estado de una campaña ya pagada, el enlace Ver tus
  // campañas y el botón de la pantalla de tomada salen solo cuando la función existe.
  void asegurarTus();
  // Un borrador que dejó crear-campana.html se retoma solo si no hay una sala para retomar: la sala guardada manda.
  if (!guardada) {
    const retomado = retomarBorrador();
    // Con la sesión y sin nada a la vista, la dirección del panel pide Tus campañas una vez.
    if (deps.tus && deps.cuenta() !== null) void retomado.then(() => pedirTusAlAbrir());
    else void retomado;
  }

  function detener(): void {
    document.removeEventListener("visibilitychange", alVolverAVer);
    depositoDetenido = true;
    pararRelojDelDeposito?.();
    pararRelojDelDeposito = null;
    pararReintentoDelDeposito?.();
    pararReintentoDelDeposito = null;
    reintentoDeLaDuena?.();
    reintentoDeLaDuena = null;
    dejarDeEscuchar();
    cm?.detener();
    marca++;
    pararDespertar?.();
    pararTemprano?.();
    pararTemprano = null;
    dejarElPuente?.();
    dejarLaSesion?.();
    dejarElQr();
    filaViva.detener();
    grande.cerrar();
    canal?.cerrar();
  }

  return { raiz, pintar, detener };
}

/** Lo monta arriba del cuadro del sorteo. Sin la bandera de campañas, o con la demostración, no hace nada. */
export function montarPanelDeCampana(deps: DepsDelPanelDeCampana = depsReales(), activo: boolean = campanasActivo()): void {
  if (!activo || deps.conDemo()) return;
  const origenes = document.getElementById("origenes");
  if (!origenes || document.getElementById("cpo-panel")) return;
  const panel = crearPanelDeCampana(deps);
  origenes.before(panel.raiz);
  onLangChange(() => panel.pintar());
}

