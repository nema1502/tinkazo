import type { Lang } from "../idioma";
import { ANFITRIONES_PERMITIDOS } from "./en-el-build";
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
  | "no-aparece"
  | "sin-fondos"
  | "cuenta-sin-armar"
  | "lento"
  | "no-se-armo"
  | "no-se-sello"
  | "sorteo-trabado"
  | "falla"
  | "no-es-aca";

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
  "no-aparece",
  "sin-fondos",
  "cuenta-sin-armar",
  "lento",
  "no-se-armo",
  "no-se-sello",
  "sorteo-trabado",
  "falla",
  "no-es-aca",
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
}

/** Los 60 s del desbloqueo más 5. */
export const TOPE_DEL_DESBLOQUEO_MS = 65_000;
/** El desbloqueo más 20 s que se le dan al índice. */
export const TOPE_DE_ENTRAR_MS = 85_000;
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
  "no-aparece": { titulo: "noApareceTitulo", linea: "noApareceLinea", principal: ["noAparecePrincipal", "reintentar-entrar"], secundario: ["noApareceSecundario", "crear-otra"] },
  "sin-fondos": { titulo: "sinFondosTitulo", linea: "sinFondosLinea", principal: ["sinFondosPrincipal", "reintentar"] },
  "cuenta-sin-armar": { titulo: "cuentaSinArmarTitulo", linea: "cuentaSinArmarLinea", principal: ["cuentaSinArmarPrincipal", "rehacer-cuenta"] },
  lento: { titulo: "lentoTitulo", linea: "lentoLinea", principal: ["lentoPrincipal", "mirar"] },
  "no-se-armo": { titulo: "noSeArmoTitulo", linea: "noSeArmoLinea", principal: ["noSeArmoPrincipal", "rehacer-cuenta"] },
  "no-se-sello": { titulo: "noSeSelloTitulo", linea: "noSeSelloLinea", principal: ["noSeSelloPrincipal", "sellar"] },
  "sorteo-trabado": { titulo: "sorteoTrabadoTitulo", linea: "sorteoTrabadoLinea", principal: ["sorteoTrabadoPrincipal", "sortear"], secundario: ["sorteoTrabadoSecundario", "comprobante"] },
  falla: { titulo: "fallaTitulo", linea: "fallaLinea", principal: ["fallaPrincipal", "empezar"] },
  "no-es-aca": { titulo: "noEsAcaTitulo", linea: "noEsAcaLinea", principal: ["noEsAcaPrincipal", "ir"] },
};

/** Las pantallas de esperar el desbloqueo: el título y el tope son los mismos, la línea cambia. */
const MIRA: Partial<Record<Estado, { linea: ClaveDePrueba; topeMs: number }>> = {
  "mira-crear": { linea: "miraCrearLinea", topeMs: TOPE_DEL_DESBLOQUEO_MS },
  "mira-sellar": { linea: "miraSellarLinea", topeMs: TOPE_DEL_DESBLOQUEO_MS },
  entrando: { linea: "entrandoLinea", topeMs: TOPE_DE_ENTRAR_MS },
};

/** Las pantallas donde, si la persona no usó la llave, la línea lo dice. */
const ADMITEN_CANCELADA: ReadonlySet<Estado> = new Set<Estado>(["inicio", "ya-hay-llave", "cuenta-lista", "no-aparece"]);

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
}

/** Con qué pantalla abre la página. */
export function estadoInicial(o: EntornoInicial): Estado {
  if (!ANFITRIONES_PERMITIDOS(o.host)) return "no-es-aca";
  if (o.selloPendiente) return "esperando";
  if (!o.hayPasskeys) return "sin-llaves";
  if (o.enApp) return "en-app";
  if (o.punteroGrueso && o.conBloqueo === false) return "sin-bloqueo";
  if (o.hayLlaveLocal) return "ya-hay-llave";
  return "inicio";
}
