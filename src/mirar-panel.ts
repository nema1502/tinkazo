/**
 * Página de prueba para mirar el panel de la campaña con datos de mentira. No se publica ni se une a nada: vive solo en una
 * rama descartable.
 *
 * Monta el panel de verdad (`crearPanelDeCampana`, la misma hoja de estilos y la misma base de la herramienta) con una sala, un
 * reloj y una cuenta inventados. El momento sale de `?estado=`:
 *   previa-archivo       el archivo de la campaña ya elegido, sin sala todavía
 *   dejar-cerrada-con    la lista cerrada, con la pregunta de dejar la campaña abierta y su línea de los avisos
 *   dejar-sellada-con    la lista sellada, con la pregunta abierta y su línea
 *   dejar-sorteada-con   el sorteo hecho y una ganadora sin avisar, con la pregunta abierta y su línea
 *   dejar-sellada-sin    la lista sellada y la sala ya borrada, con la pregunta abierta: sin línea
 *   dejar-sorteada-sin   el sorteo hecho y todas avisadas, con la pregunta abierta: sin línea
 *   dejar-abierta-sin    la inscripción abierta, con la pregunta abierta: sin línea
 *   dejar-previa-sin     la sala creada y sin abrir, con la pregunta abierta: sin línea
 * Las campañas con sala se retoman como después de recargar la pestaña: se guarda lo que la herramienta recuerda de la sala y
 * el panel la lee. La pregunta se abre tocando el mismo botón que toca quien organiza (Elegir otro archivo). La red de la
 * campaña es la principal: la dirección lleva `?red=oficial` y la página la agrega sola si falta.
 *
 * No habla con ninguna red ni con ninguna cuenta de verdad. La cuenta es una de prueba del propio repositorio.
 */
import "./styles.css";
import { fijarElTema } from "./tema-forzado";
import { campanaDeEjemplo } from "./campana/ejemplo";
import { leerCampana } from "./campana/modelo";
import { type PasoDelPuente, ponerPaso } from "./campana/puente";
import { TEXTOS_SALA_CAMPANA } from "./campana/textos-sala";
import { descifrarEquipo } from "./equipos/datos";
import { getLang, initialLang, onLangChange, setLang, t } from "./i18n";
import { type FaseDeSala, type SalaDeCampana, guardarOrg } from "./sala/campana-org";
import { generarClave } from "./sala/cifra";
import { type DepsDelPanelDeCampana, crearPanelDeCampana } from "./ui/campana-sala";

const parametros = new URLSearchParams(location.search);

// La red principal sale de la dirección: sin ella, la campaña de ejemplo sería de la red de prueba.
const sinRed = !parametros.has("red");
if (sinRed) {
  const direccion = new URL(location.href);
  direccion.searchParams.set("red", "oficial");
  location.replace(direccion.toString());
}

fijarElTema(parametros.get("theme"));
setLang(initialLang());

/** Una ganadora con el resultado todavía sin avisar, y la misma ya avisada. */
const SIN_AVISAR: PasoDelPuente = {
  paso: "resultado",
  filas: [{ cuenta: "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N", nombre: "Ana", avisada: false, alta: "esperando" }],
  otraBilletera: false,
};
const AVISADA: PasoDelPuente = {
  paso: "resultado",
  filas: [{ cuenta: "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N", nombre: "Ana", avisada: true, alta: "esperando" }],
  otraBilletera: false,
};

interface Momento {
  /** La fase de la sala guardada. Sin ella, se elige el archivo y se queda en la vista previa. */
  fase: FaseDeSala | null;
  /** El paso del puente con la pregunta todavía cerrada. */
  paso?: PasoDelPuente;
  /** Si hay pregunta: qué cambia del puente con la pregunta ya abierta. */
  despues?: PasoDelPuente;
  /** Toca Elegir otro archivo para abrir la pregunta. */
  preguntar: boolean;
}

const MOMENTOS = {
  "previa-archivo": { fase: null, preguntar: false },
  "dejar-cerrada-con": { fase: "cerrada", paso: { paso: "nada" }, preguntar: true },
  "dejar-sellada-con": { fase: "sellada", paso: { paso: "no-avisamos" }, preguntar: true },
  "dejar-sorteada-con": { fase: "sorteada", paso: SIN_AVISAR, preguntar: true },
  "dejar-sellada-sin": { fase: "sellada", paso: { paso: "no-avisamos" }, despues: { paso: "sala-borrada" }, preguntar: true },
  "dejar-sorteada-sin": { fase: "sorteada", paso: SIN_AVISAR, despues: AVISADA, preguntar: true },
  "dejar-abierta-sin": { fase: "abierta", paso: { paso: "no-avisamos" }, preguntar: true },
  "dejar-previa-sin": { fase: "lista", preguntar: true },
} satisfies Record<string, Momento>;
type Estado = keyof typeof MOMENTOS;
const pedido = parametros.get("estado");
const estado: Estado = (Object.keys(MOMENTOS) as Estado[]).find((e) => e === pedido) ?? "dejar-sellada-con";
const momento: Momento = MOMENTOS[estado];

/** Una cuenta de prueba con forma válida: la misma que usan las pruebas del repositorio (`cuentaDePrueba(5)`). */
const CUENTA = "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N";

/** La campaña de ejemplo como la guarda el archivo firmado: claves con guion bajo. */
function campanaDelArchivo(ahora: number): Record<string, unknown> {
  const c = campanaDeEjemplo(ahora);
  return {
    ...c,
    evento: "evento-uno",
    red: "mainnet",
    premios: c.premios.map((p) => p.toString()),
    abre_ms: c.abreMs,
    cierra_ms: c.cierraMs,
    sorteo_ms: c.sorteoMs,
    recibir_hasta_ms: c.recibirHastaMs,
  };
}

/** El archivo firmado de mentira: la firma no se verifica en el navegador. */
function archivoDeEjemplo(ahora: number): string {
  return JSON.stringify({ texto: JSON.stringify(campanaDelArchivo(ahora)), firma: "F".repeat(86) });
}

const almacenFalso = (): Storage => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

/** La sala de mentira que la herramienta recordaría de esta campaña. */
function salaDeMentira(ahora: number): SalaDeCampana {
  return { id: "AbCd1234", token: "T".repeat(22), clave: generarClave(), vence: ahora + 86_400_000, servicio: "https://s.tinkazo.app", evento: "evento-uno", red: "mainnet" };
}

function depsDeMentira(): DepsDelPanelDeCampana {
  const ahora = Date.now();
  const contenido = archivoDeEjemplo(ahora);
  const almacen = almacenFalso();
  // Con una fase, la sala queda guardada como después de recargar: el panel la retoma al armarse.
  if (momento.fase) guardarOrg(almacen, { sala: salaDeMentira(ahora), cuenta: CUENTA, fase: momento.fase }, ahora);
  const fase = momento.fase ?? "lista";
  return {
    tx: (clave) => TEXTOS_SALA_CAMPANA[getLang()][clave] ?? t(clave),
    idioma: getLang,
    red: () => "mainnet",
    enStand: () => false,
    enEnsayo: () => false,
    conDemo: () => false,
    ahora: () => Date.now(),
    leerArchivo: async () => contenido,
    validar: async (texto, desde) => {
      const { validarCampanaParaFirmar } = await import("./sala/validar-campana");
      return validarCampanaParaFirmar(texto, desde);
    },
    cuenta: () => CUENTA,
    crear: async () => ({ ok: false, motivo: "red" }),
    pase: async () => ({ p: "PASE00000001", hasta: Date.now() + 120_000 }),
    fase: async () => true,
    quitar: async () => true,
    estado: async () => ({ fase, total: 0, cierraMs: Date.now() + 3 * 3_600_000 }),
    campanaDeSala: async () => {
      const lectura = leerCampana(JSON.parse(JSON.stringify(campanaDelArchivo(ahora))));
      return lectura.ok ? lectura.campana : "rechazo";
    },
    borrarVacia: async () => true,
    escuchar: () => ({ parar: () => undefined, consultar: async () => undefined }),
    descifrar: descifrarEquipo,
    qr: async () => true,
    almacen,
    esperar: (f, ms) => {
      const id = setTimeout(f, ms);
      return () => clearTimeout(id);
    },
    pantallaCompleta: async () => undefined,
    ventana: () => ({ ancho: innerWidth, alto: innerHeight }),
    origen: () => location.origin,
    canal: () => null,
    alCerrar: () => undefined,
  };
}

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Espera a que el panel llegue a una vista, hasta cinco segundos. */
async function esperarVista(raiz: HTMLElement, vista: string): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (raiz.dataset.vista === vista) return true;
    await pausa(100);
  }
  return false;
}

/** El botón que dice eso, entre los visibles del panel. */
function botonDe(raiz: HTMLElement, clave: string): HTMLButtonElement | null {
  const rotulo = TEXTOS_SALA_CAMPANA[getLang()][clave];
  return [...raiz.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === rotulo && !b.hidden) ?? null;
}

async function montar(): Promise<void> {
  const deps = depsDeMentira();
  const origenes = document.getElementById("origenes");
  if (!origenes) return;
  const panel = crearPanelDeCampana(deps);
  origenes.before(panel.raiz);
  onLangChange(() => panel.pintar());
  document.documentElement.dataset.estado = estado;
  await pausa(300);
  if (momento.fase === null) {
    // Elige el archivo como lo haría el selector del navegador.
    const entrada = panel.raiz.querySelector<HTMLInputElement>("#cpo-archivo");
    if (!entrada) return;
    Object.defineProperty(entrada, "files", { value: [new File(["x"], "campana.json")], configurable: true });
    entrada.dispatchEvent(new Event("change"));
    return;
  }
  const vistaFinal = momento.fase === "lista" ? "previa" : momento.fase;
  if (!(await esperarVista(panel.raiz, vistaFinal))) return;
  await pausa(300);
  if (momento.paso) ponerPaso(momento.paso);
  await pausa(200);
  if (!momento.preguntar) return;
  botonDe(panel.raiz, "cpoOtroArchivo")?.click();
  if (!(await esperarVista(panel.raiz, "olvidar"))) return;
  await pausa(200);
  // Con la pregunta ya abierta, el puente cambia: es donde la línea tiene que irse.
  if (momento.despues) ponerPaso(momento.despues);
  await pausa(300);
  document.documentElement.dataset.listo = "si";
}

if (!sinRed) void montar();
