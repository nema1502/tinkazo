/**
 * Página de prueba para mirar el panel de la campaña con datos de mentira. No se publica ni se une a nada: vive solo en una
 * rama descartable.
 *
 * Monta el panel de verdad (`crearPanelDeCampana`, la misma hoja de estilos y la misma base de la herramienta) con una sala, un
 * reloj y un saldo inventados, y lo lleva hasta la vista previa de una campaña de ejemplo con el archivo ya elegido. El estado
 * sale de `?estado=`:
 *   previa-alcanza      el saldo cubre el premio de 40 dólares digitales
 *   previa-falta        el saldo es corto
 *   previa-leyendo      la lectura del saldo no contesta nunca
 *   previa-sin-lectura  la lectura falla siempre
 *   previa-sin-linea    sin la dependencia del depósito, como el panel de la rama principal
 * La red de la campaña es la principal: la dirección lleva `?red=oficial` y la página la agrega sola si falta.
 *
 * No habla con ninguna red ni con ninguna cuenta de verdad. La cuenta es una de prueba del propio repositorio.
 */
import "./styles.css";
import { fijarElTema } from "./tema-forzado";
import { campanaDeEjemplo } from "./campana/ejemplo";
import { TEXTOS_SALA_CAMPANA } from "./campana/textos-sala";
import { descifrarEquipo } from "./equipos/datos";
import { getLang, initialLang, onLangChange, setLang, t } from "./i18n";
import type { SaldoDeDolares } from "./stellar/saldo-dolares";
import { type DepsDelPanelDeCampana, crearPanelDeCampana } from "./ui/campana-sala";

const parametros = new URLSearchParams(location.search);

// La red principal sale de la dirección: sin ella, la campaña de ejemplo sería de la red de prueba y el panel no leería el saldo.
const sinRed = !parametros.has("red");
if (sinRed) {
  const direccion = new URL(location.href);
  direccion.searchParams.set("red", "oficial");
  location.replace(direccion.toString());
}

fijarElTema(parametros.get("theme"));
setLang(initialLang());

const ESTADOS = ["previa-alcanza", "previa-falta", "previa-leyendo", "previa-sin-lectura", "previa-sin-linea"] as const;
type Estado = (typeof ESTADOS)[number];
const pedido = parametros.get("estado");
const estado: Estado = ESTADOS.find((e) => e === pedido) ?? "previa-alcanza";

/** Una cuenta de prueba con forma válida: la misma que usan las pruebas del repositorio (`cuentaDePrueba(5)`). */
const CUENTA = "GACQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKG7N";

/** La lectura del saldo de cada estado. El premio de la campaña de ejemplo es de 40 dólares digitales. */
function lecturaDelSaldo(): DepsDelPanelDeCampana["deposito"] {
  if (estado === "previa-sin-linea") return undefined;
  if (estado === "previa-leyendo") return { leer: () => new Promise<SaldoDeDolares>(() => undefined) };
  if (estado === "previa-sin-lectura") return { leer: () => Promise.reject(new Error("sin conexión")) };
  const saldo = estado === "previa-alcanza" ? "125.0000000" : "25.0000000";
  return { leer: async () => ({ tipo: "saldo", saldo }) };
}

/** El archivo firmado de mentira: la firma no se verifica en el navegador. */
function archivoDeEjemplo(ahora: number): string {
  const c = campanaDeEjemplo(ahora);
  const campana = {
    ...c,
    evento: "evento-uno",
    red: "mainnet",
    premios: c.premios.map((p) => p.toString()),
    abre_ms: c.abreMs,
    cierra_ms: c.cierraMs,
    sorteo_ms: c.sorteoMs,
    recibir_hasta_ms: c.recibirHastaMs,
  };
  return JSON.stringify({ texto: JSON.stringify(campana), firma: "F".repeat(86) });
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

function depsDeMentira(): DepsDelPanelDeCampana {
  const deposito = lecturaDelSaldo();
  const contenido = archivoDeEjemplo(Date.now());
  return {
    tx: (clave) => TEXTOS_SALA_CAMPANA[getLang()][clave] ?? t(clave),
    idioma: getLang,
    red: () => "mainnet",
    enStand: () => false,
    enEnsayo: () => false,
    conDemo: () => false,
    ahora: () => Date.now(),
    leerArchivo: async () => contenido,
    validar: async (texto, ahora) => {
      const { validarCampanaParaFirmar } = await import("./sala/validar-campana");
      return validarCampanaParaFirmar(texto, ahora);
    },
    cuenta: () => CUENTA,
    crear: async () => ({ ok: false, motivo: "red" }),
    pase: async () => ({ p: "PASE00000001", hasta: Date.now() + 120_000 }),
    fase: async () => true,
    quitar: async () => true,
    estado: async () => ({ fase: "lista", total: 0, cierraMs: Date.now() + 3 * 3_600_000 }),
    campanaDeSala: async () => "rechazo",
    borrarVacia: async () => true,
    escuchar: () => ({ parar: () => undefined, consultar: async () => undefined }),
    descifrar: descifrarEquipo,
    qr: async () => true,
    almacen: almacenFalso(),
    esperar: (f, ms) => {
      const id = setTimeout(f, ms);
      return () => clearTimeout(id);
    },
    pantallaCompleta: async () => undefined,
    ventana: () => ({ ancho: innerWidth, alto: innerHeight }),
    origen: () => location.origin,
    canal: () => null,
    alCerrar: () => undefined,
    ...(deposito ? { deposito } : {}),
  };
}

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function montar(): Promise<void> {
  const deps = depsDeMentira();
  const origenes = document.getElementById("origenes");
  if (!origenes) return;
  const panel = crearPanelDeCampana(deps);
  origenes.before(panel.raiz);
  onLangChange(() => panel.pintar());
  document.documentElement.dataset.estado = estado;
  await pausa(300);
  // Elige el archivo como lo haría el selector del navegador.
  const entrada = panel.raiz.querySelector<HTMLInputElement>("#cpo-archivo");
  if (!entrada) return;
  Object.defineProperty(entrada, "files", { value: [new File(["x"], "campana.json")], configurable: true });
  entrada.dispatchEvent(new Event("change"));
  if (parametros.get("medir") === "1") {
    await pausa(1500);
    medir(panel.raiz);
  }
}

/** Solo con ?medir=1: escribe al pie de la página los números de la línea del premio, para entender una captura. */
function medir(raiz: HTMLElement): void {
  const linea = raiz.querySelector<HTMLElement>("#cpo-deposito");
  const boton = raiz.querySelector<HTMLElement>("button.primary");
  const premio = raiz.querySelector<HTMLElement>("#cpo-premio");
  const cuadro = (e: Element | null): string => {
    if (!e) return "no existe";
    const r = e.getBoundingClientRect();
    const c = getComputedStyle(e);
    return `arriba ${r.top.toFixed(1)} alto ${r.height.toFixed(1)} (scroll ${e.scrollHeight}, cliente ${e.clientHeight}) overflow ${c.overflow} alto-css ${c.height} max ${c.maxHeight} min ${c.minHeight} margen-abajo ${c.marginBottom} display ${c.display} fuente ${c.fontSize}/${c.lineHeight}`;
  };
  const padre = linea?.parentElement ?? null;
  const quien = (x: number, y: number): string => {
    const e = document.elementFromPoint(x, y);
    if (!e) return "nada";
    const c = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return `${e.tagName.toLowerCase()}#${e.id}.${e.className} arriba ${r.top.toFixed(0)} alto ${r.height.toFixed(0)} pos ${c.position} fondo ${c.backgroundColor} z ${c.zIndex}`;
  };
  const abajo = linea ? linea.getBoundingClientRect().bottom : 0;
  const acciones = raiz.querySelector<HTMLElement>("#cpo-acciones");
  const salida = document.createElement("pre");
  salida.style.cssText = "position:fixed;left:0;right:0;top:0;margin:0;padding:6px;font:10px/1.2 monospace;white-space:pre-wrap;background:#fff;color:#000;z-index:99";
  salida.textContent = [
    `ancho ${innerWidth}`,
    `premio: ${cuadro(premio)}`,
    `linea: ${cuadro(linea)}`,
    `boton: ${cuadro(boton)}`,
    `panel: ${cuadro(padre)}`,
    `quien en el ultimo renglon (x 40): ${quien(40, abajo - 9)}`,
    `quien en el ultimo renglon (x 200): ${quien(200, abajo - 9)}`,
    `quien en el medio (x 40): ${quien(40, abajo - 30)}`,
    `acciones: ${cuadro(acciones)} pos ${acciones ? getComputedStyle(acciones).position : ""}`,
    `padre-display ${padre ? getComputedStyle(padre).display : ""} rows ${padre ? getComputedStyle(padre).gridTemplateRows : ""}`,
  ].join(String.fromCharCode(10));
  document.body.append(salida);
}

if (!sinRed) void montar();
