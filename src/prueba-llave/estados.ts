import type { Lang } from "../idioma";
import { ANFITRIONES_PERMITIDOS } from "./en-el-build";
import type { NotaDelEnvio } from "./evento";
import { enGrupos, MONTO_DEL_PREMIO, montoVisible } from "./premio";
import { texto, type ClaveDePrueba } from "./textos";

/** Todas las pantallas de la prueba. */
export type Estado =
  | "cargando"
  | "inicio"
  | "ya-hay-llave"
  | "sin-llaves"
  | "en-app"
  | "sin-bloqueo"
  | "mira-crear"
  | "armando"
  | "cuenta-lista"
  | "mira-sellar"
  | "sellando"
  | "esperando"
  | "listo"
  | "entrando"
  | "buscando"
  | "no-aparece"
  | "sin-cuenta"
  | "vencida"
  | "no-se-comprobo"
  | "sin-fondos"
  | "cuenta-sin-armar"
  | "lento"
  | "no-se-armo"
  | "no-se-sello"
  | "sorteo-trabado"
  | "falla"
  | "no-es-aca"
  | "premio-inicio"
  | "recibiendo"
  | "premio-listo"
  | "mira-mandar"
  | "enviando"
  | "enviado"
  | "pide-nota"
  | "no-recibe"
  | "no-se-envio"
  | "no-llego-premio"
  | "sin-monedas"
  | "saldo-sin-leer"
  | "enlace-mal";

export const ESTADOS: readonly Estado[] = [
  "cargando",
  "inicio",
  "ya-hay-llave",
  "sin-llaves",
  "en-app",
  "sin-bloqueo",
  "mira-crear",
  "armando",
  "cuenta-lista",
  "mira-sellar",
  "sellando",
  "esperando",
  "listo",
  "entrando",
  "buscando",
  "no-aparece",
  "sin-cuenta",
  "vencida",
  "no-se-comprobo",
  "sin-fondos",
  "cuenta-sin-armar",
  "lento",
  "no-se-armo",
  "no-se-sello",
  "sorteo-trabado",
  "falla",
  "no-es-aca",
  "premio-inicio",
  "recibiendo",
  "premio-listo",
  "mira-mandar",
  "enviando",
  "enviado",
  "pide-nota",
  "no-recibe",
  "no-se-envio",
  "no-llego-premio",
  "sin-monedas",
  "saldo-sin-leer",
  "enlace-mal",
];

export type Aparato = "cel" | "compu";

export interface Boton {
  texto: string;
  /** Lo que hace, para `data-accion`: lo lee `pagina.ts`. */
  accion: string;
}

export interface Pantalla {
  titulo: string;
  /** Puede traer `<strong>`: es texto nuestro, nunca de afuera. */
  linea: string;
  principal?: Boton;
  secundario?: Boton;
  /** Cuánto se espera en esta pantalla como mucho, en milisegundos, antes de pasar a otra. */
  topeMs?: number;
}

export interface DatosDeLaPantalla {
  /** El nombre de quien ganó, para la pantalla final. */
  ganador?: string;
  /** La persona no usó la llave: la línea de la pantalla dice eso en lugar de lo de siempre. */
  cancelada?: boolean;
  aparato: Aparato;
  /** Las monedas de la pantalla, en la unidad mínima y como texto. Sin valor, las del premio. */
  monto?: string;
  /** Los últimos cuatro caracteres de la cuenta de destino. */
  fin?: string;
  /** La dirección entera del destino, cuando viene del enlace. */
  direccion?: string;
  /** El número de la nota. */
  nota?: string;
  /** Las monedas acaban de llegar (y no solo se leyó el saldo). */
  recibido?: boolean;
  /** El destino salió del enlace y no lo armó la página. */
  destinoDelEnlace?: boolean;
  /** Cómo quedó la nota que se pidió. */
  notaEnvio?: NotaDelEnvio;
  /** El registro de este aparato dice que las monedas ya se mandaron. */
  yaEnviadas?: boolean;
}

/** Los 60 s del desbloqueo más 5. */
export const TOPE_DEL_DESBLOQUEO_MS = 65_000;
/** Lo que se espera mientras se busca la cuenta en la red, después del desbloqueo. */
export const TOPE_DE_BUSCAR_MS = 30_000;
export const TOPE_DE_CARGAR_MS = 15_000;
export const TOPE_DE_UNA_TRANSACCION_MS = 90_000;

interface Claves {
  titulo: ClaveDePrueba;
  linea: ClaveDePrueba;
  principal?: [ClaveDePrueba, string];
  secundario?: [ClaveDePrueba, string];
  topeMs?: number;
}

/** Las pantallas que no cambian con el aparato. Las de mirar el aparato se arman aparte. */
const CLAVES: Partial<Record<Estado, Claves>> = {
  cargando: { titulo: "cargandoTitulo", linea: "cargandoLinea", topeMs: TOPE_DE_CARGAR_MS },
  "ya-hay-llave": { titulo: "yaHayLlaveTitulo", linea: "yaHayLlaveLinea", principal: ["yaHayLlavePrincipal", "usar"], secundario: ["yaHayLlaveSecundario", "crear-otra"] },
  "sin-llaves": { titulo: "sinLlavesTitulo", linea: "sinLlavesLinea", principal: ["sinLlavesPrincipal", "copiar"] },
  "en-app": { titulo: "enAppTitulo", linea: "enAppLinea", principal: ["enAppPrincipal", "probar-aca"], secundario: ["enAppSecundario", "copiar"] },
  "sin-bloqueo": { titulo: "sinBloqueoTitulo", linea: "sinBloqueoLinea", principal: ["sinBloqueoPrincipal", "ya-lo-puse"], secundario: ["sinBloqueoSecundario", "probar-igual"] },
  armando: { titulo: "armandoTitulo", linea: "armandoLinea", topeMs: TOPE_DE_UNA_TRANSACCION_MS },
  "cuenta-lista": { titulo: "cuentaListaTitulo", linea: "cuentaListaLinea", principal: ["cuentaListaPrincipal", "sellar"] },
  sellando: { titulo: "sellandoTitulo", linea: "sellandoLinea", topeMs: TOPE_DE_UNA_TRANSACCION_MS },
  esperando: { titulo: "esperandoTitulo", linea: "esperandoLinea", secundario: ["esperandoSecundario", "comprobante"] },
  listo: { titulo: "listoTitulo", linea: "listoLinea", principal: ["listoPrincipal", "comprobar"], secundario: ["listoSecundario", "otro"] },
  buscando: { titulo: "buscandoTitulo", linea: "buscandoLinea", topeMs: TOPE_DE_BUSCAR_MS },
  "no-aparece": { titulo: "noApareceTitulo", linea: "noApareceLinea", principal: ["noAparecePrincipal", "reintentar-entrar"], secundario: ["noApareceSecundario", "crear-otra"] },
  "sin-cuenta": { titulo: "sinCuentaTitulo", linea: "sinCuentaLinea", principal: ["sinCuentaPrincipal", "reintentar-entrar"], secundario: ["sinCuentaSecundario", "crear-otra"] },
  vencida: { titulo: "vencidaTitulo", linea: "vencidaLinea", principal: ["vencidaPrincipal", "crear-otra"] },
  "no-se-comprobo": { titulo: "noSeComproboTitulo", linea: "noSeComproboLinea", principal: ["noSeComproboPrincipal", "crear-otra"] },
  "sin-fondos": { titulo: "sinFondosTitulo", linea: "sinFondosLinea", principal: ["sinFondosPrincipal", "reintentar"] },
  "cuenta-sin-armar": { titulo: "cuentaSinArmarTitulo", linea: "cuentaSinArmarLinea", principal: ["cuentaSinArmarPrincipal", "rehacer-cuenta"] },
  lento: { titulo: "lentoTitulo", linea: "lentoLinea", principal: ["lentoPrincipal", "mirar"] },
  "no-se-armo": { titulo: "noSeArmoTitulo", linea: "noSeArmoLinea", principal: ["noSeArmoPrincipal", "rehacer-cuenta"] },
  "no-se-sello": { titulo: "noSeSelloTitulo", linea: "noSeSelloLinea", principal: ["noSeSelloPrincipal", "sellar"] },
  "sorteo-trabado": { titulo: "sorteoTrabadoTitulo", linea: "sorteoTrabadoLinea", principal: ["sorteoTrabadoPrincipal", "sortear"], secundario: ["sorteoTrabadoSecundario", "comprobante"] },
  falla: { titulo: "fallaTitulo", linea: "fallaLinea", principal: ["fallaPrincipal", "empezar"] },
  "no-es-aca": { titulo: "noEsAcaTitulo", linea: "noEsAcaLinea", principal: ["noEsAcaPrincipal", "ir"] },
  recibiendo: { titulo: "recibiendoTitulo", linea: "recibiendoLinea", topeMs: TOPE_DE_UNA_TRANSACCION_MS },
  enviando: { titulo: "enviandoTitulo", linea: "enviandoLinea", topeMs: TOPE_DE_UNA_TRANSACCION_MS },
  "pide-nota": { titulo: "pideNotaTitulo", linea: "pideNotaLinea", principal: ["pideNotaPrincipal", "sin-destino"] },
  "no-recibe": { titulo: "noRecibeTitulo", linea: "noRecibeLinea", principal: ["noRecibePrincipal", "sin-destino"] },
  "no-se-envio": { titulo: "noSeEnvioTitulo", linea: "noSeEnvioLinea", principal: ["noSeEnvioPrincipal", "reintentar"] },
  "no-llego-premio": { titulo: "noLlegoPremioTitulo", linea: "noLlegoPremioLinea", principal: ["noLlegoPremioPrincipal", "reintentar"] },
  "saldo-sin-leer": { titulo: "saldoSinLeerTitulo", linea: "saldoSinLeerLinea", principal: ["saldoSinLeerPrincipal", "reintentar"] },
  "enlace-mal": { titulo: "enlaceMalTitulo", linea: "enlaceMalLinea", principal: ["enlaceMalPrincipal", "sin-destino"] },
};

/** Las pantallas de esperar el desbloqueo: el título y el tope son los mismos, la línea cambia. */
const MIRA: Partial<Record<Estado, { linea: ClaveDePrueba; topeMs: number }>> = {
  "mira-crear": { linea: "miraCrearLinea", topeMs: TOPE_DEL_DESBLOQUEO_MS },
  "mira-sellar": { linea: "miraSellarLinea", topeMs: TOPE_DEL_DESBLOQUEO_MS },
  entrando: { linea: "entrandoLinea", topeMs: TOPE_DEL_DESBLOQUEO_MS },
};

/** Las pantallas donde, si la persona no usó la llave, la línea lo dice. */
const ADMITEN_CANCELADA: ReadonlySet<Estado> = new Set<Estado>(["inicio", "ya-hay-llave", "cuenta-lista", "no-aparece", "premio-inicio", "premio-listo"]);

/** Un texto de afuera para ir dentro de una línea que se pinta como HTML. */
export function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const MONTO_DE_TEXTO = /^\d+$/;

/**
 * Pone los datos en los huecos de un texto. Con `escapar`, cada dato pasa por `escaparHtml` antes de entrar: es para las
 * líneas, que se pintan como HTML. Los títulos se pintan como texto y no lo necesitan.
 */
function conDatos(t: string, datos: DatosDeLaPantalla, lang: Lang, escapar: boolean): string {
  const v = (x: string): string => (escapar ? escaparHtml(x) : x);
  const monto = montoVisible(datos.monto !== undefined && MONTO_DE_TEXTO.test(datos.monto) ? BigInt(datos.monto) : MONTO_DEL_PREMIO, lang);
  return t
    .replaceAll("{monto}", () => v(monto))
    .replaceAll("{fin}", () => v(datos.fin ?? ""))
    .replaceAll("{direccion}", () => v(enGrupos(datos.direccion ?? "")))
    .replaceAll("{nota}", () => v(datos.nota ?? ""));
}

const LINEA_DEL_ENVIADO: Record<NotaDelEnvio, ClaveDePrueba> = {
  confirmada: "enviadoLineaNota",
  "no-pedida": "enviadoLineaSinNota",
  "sin-dato": "enviadoLineaNotaSinDato",
  distinta: "enviadoLineaNotaDistinta",
};

/** Lo que muestra la prueba en cada estado, en una lengua. */
export function pantallaDe(estado: Estado, datos: DatosDeLaPantalla, lang: Lang): Pantalla {
  const cel = datos.aparato === "cel";
  const mira = MIRA[estado];
  if (mira) {
    return { titulo: texto(lang, cel ? "miraTituloCel" : "miraTituloCompu"), linea: texto(lang, mira.linea), topeMs: mira.topeMs };
  }
  if (estado === "inicio") {
    const p: Pantalla = {
      titulo: texto(lang, "inicioTitulo"),
      linea: datos.cancelada ? texto(lang, "canceladaLinea") : texto(lang, cel ? "inicioLineaCel" : "inicioLineaCompu"),
      principal: { texto: texto(lang, "inicioPrincipal"), accion: "crear" },
      secundario: { texto: texto(lang, "inicioSecundario"), accion: "ya-tengo" },
    };
    return p;
  }
  if (estado === "premio-inicio") {
    const linea = datos.cancelada ? texto(lang, "canceladaLinea") : conDatos(texto(lang, cel ? "premioInicioLineaCel" : "premioInicioLineaCompu"), datos, lang, true);
    return {
      titulo: texto(lang, "premioInicioTitulo"),
      linea,
      principal: { texto: texto(lang, "premioInicioPrincipal"), accion: "crear" },
      secundario: { texto: texto(lang, "premioInicioSecundario"), accion: "ya-tengo" },
    };
  }
  if (estado === "premio-listo") {
    const clave: ClaveDePrueba = datos.destinoDelEnlace ? (datos.nota ? "premioListoLineaEnlaceNota" : "premioListoLineaEnlace") : "premioListoLinea";
    return {
      titulo: conDatos(texto(lang, datos.recibido ? "premioListoTituloRecibido" : "premioListoTituloSaldo"), datos, lang, false),
      linea: datos.cancelada ? texto(lang, "canceladaLinea") : conDatos(texto(lang, clave), datos, lang, true),
      principal: { texto: texto(lang, "premioListoPrincipal"), accion: "mandar" },
    };
  }
  if (estado === "mira-mandar") {
    return {
      titulo: texto(lang, cel ? "miraTituloCel" : "miraTituloCompu"),
      linea: conDatos(texto(lang, datos.destinoDelEnlace ? "miraMandarLineaEnlace" : "miraMandarLinea"), datos, lang, true),
      topeMs: TOPE_DEL_DESBLOQUEO_MS,
    };
  }
  if (estado === "enviado") {
    return {
      titulo: texto(lang, "enviadoTitulo"),
      linea: conDatos(texto(lang, LINEA_DEL_ENVIADO[datos.notaEnvio ?? "no-pedida"]), datos, lang, true),
      principal: { texto: texto(lang, "enviadoPrincipal"), accion: "costos" },
      secundario: { texto: texto(lang, "enviadoSecundario"), accion: "crear-otra" },
    };
  }
  if (estado === "sin-monedas") {
    return {
      titulo: texto(lang, "sinMonedasTitulo"),
      linea: texto(lang, datos.yaEnviadas ? "sinMonedasLineaEnviadas" : "sinMonedasLinea"),
      principal: { texto: texto(lang, "sinMonedasPrincipal"), accion: "crear-otra" },
    };
  }
  const c = CLAVES[estado];
  if (!c) throw new Error(`estado sin pantalla: ${estado}`);
  const nombre = datos.ganador ?? "";
  const p: Pantalla = {
    titulo: texto(lang, c.titulo).replace("{nombre}", nombre),
    linea: datos.cancelada && ADMITEN_CANCELADA.has(estado) ? texto(lang, "canceladaLinea") : texto(lang, c.linea),
  };
  if (c.principal) p.principal = { texto: texto(lang, c.principal[0]), accion: c.principal[1] };
  if (c.secundario) p.secundario = { texto: texto(lang, c.secundario[0]), accion: c.secundario[1] };
  if (c.topeMs !== undefined) p.topeMs = c.topeMs;
  return p;
}

export interface EntornoInicial {
  host: string;
  hayPasskeys: boolean;
  enApp: boolean;
  /** Si el aparato tiene un bloqueo de pantalla que sirva, o `null` si no se pudo saber. */
  conBloqueo: boolean | null;
  punteroGrueso: boolean;
  hayLlaveLocal: boolean;
  selloPendiente: boolean;
  /** La página está en el modo premio. */
  modoPremio?: boolean;
  /** Hay un pago o un envío de monedas mandado y sin confirmar. */
  pendienteDeDinero?: boolean;
}

/** Con qué pantalla abre la página. */
export function estadoInicial(o: EntornoInicial): Estado {
  if (!ANFITRIONES_PERMITIDOS(o.host)) return "no-es-aca";
  if (o.modoPremio && o.pendienteDeDinero) return "lento";
  if (o.selloPendiente && !o.modoPremio) return "esperando";
  if (!o.hayPasskeys) return "sin-llaves";
  if (o.enApp) return "en-app";
  if (o.punteroGrueso && o.conBloqueo === false) return "sin-bloqueo";
  if (o.hayLlaveLocal) return "ya-hay-llave";
  return o.modoPremio ? "premio-inicio" : "inicio";
}
