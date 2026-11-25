/** Entrada de participar.html: carga la campaña y deja las pantallas en manos del estado del celular. */

import "./pagina";
import "./version-nueva";
import "./campana/campana.css";
import { cargaOpcional } from "./carga-opcional";
import { enNavegadorDeApp } from "./navegador";
import { getLang, initialLang, onLangChange, setLang, texto } from "./idioma";
import { leerEnlaceDeCampana } from "./campana/enlace";
import { campanasActivo } from "./campana/bandera";
import { montarCelular, type DepsDelCelular, type VistaDelCelular } from "./campana/celular";
import { cargarConUnReintento, depsConectadas, type BaseDelCelular } from "./campana/conectar";
import { leerMemoria, SIN_CUENTA } from "./campana/memoria";
import { clienteDeGoogleDelSitio } from "./campana/persona-bandera";
import { destinoDeRecibir } from "./campana/recibir";
import { pintarAviso } from "./campana/piezas";
import { pintarEstadoDeCarga, type EstadoDeCarga } from "./campana/previa";
import { sesionDeGoogle } from "./campana/sesion";
import type { Campana } from "./campana/modelo";
import { servicioDeSala } from "./sala/cliente";
import { network } from "./stellar/config";
import { hasPollarKey, leerMarcaPollar } from "./stellar/pollar-config";

const raiz = document.querySelector<HTMLElement>(".cmp");
const estado = document.querySelector<HTMLElement>("#cmp-estado");
const parametros = new URLSearchParams(location.search);
const ejemplo = parametros.get("demo") === "campana";
/**
 * El modo vista: participar.html como celular de muestra dentro del marco de la página para armar campañas. Solo dentro de un
 * marco y con el parámetro: afuera de un marco la página sigue como siempre. Su código se baja recién acá, así quien escanea
 * el QR de un evento no baja nada de esto.
 */
const enVistaPrevia = parametros.get("vista") === "previa" && window.parent !== window;
const idioma = initialLang();
setLang(idioma);

let vista: VistaDelCelular | null = null;
/** Cuántas veces se montó la vista: la demostración se baja con import() y no debe pisar a una vista montada después. */
let montajes = 0;
/** Cómo se pinta el aviso que está a la vista: se vuelve a llamar al cambiar el idioma. */
let repintarAviso: (() => void) | null = null;

/** Lee el almacenamiento local sin impedir que la página abra si el navegador lo bloquea. */
export function leerMemoriaDeCampana(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

const base: BaseDelCelular = {
  tx: texto,
  idioma: getLang,
  enApp: enNavegadorDeApp(navigator.userAgent),
  ahora: () => Date.now(),
  cada: (f, ms) => {
    const temporizador = window.setInterval(f, ms);
    return () => window.clearInterval(temporizador);
  },
  visible: () => document.visibilityState === "visible",
  alVolver: (f) => {
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  },
  vibrar: (patron) => {
    try {
      navigator.vibrate?.(patron);
    } catch {
      /* La vibración es opcional y no puede frenar la pantalla. */
    }
  },
  movimientoReducido: () => typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

function pintarUltimoAviso(): void {
  if (!estado || !repintarAviso) return;
  estado.hidden = false;
  repintarAviso();
}

function mostrarCarga(tipo: EstadoDeCarga | "cargando", reintentar: () => void): void {
  repintarAviso = () => {
    if (!estado) return;
    if (tipo !== "cargando") {
      pintarEstadoDeCarga(estado, texto, tipo, reintentar);
      return;
    }
    pintarAviso(estado, texto("cpCargando"));
  };
  pintarUltimoAviso();
}

/**
 * La sala ya no está (se borra a las 24 horas) pero este celular recuerda la campaña: quien ganó ve de nuevo Recibir mi
 * premio y quien no, el comprobante. Sin esto, la ganadora que vuelve al otro día vería que el QR no es del stand.
 */
function mostrarSalaTerminada(sala: string, recibir: () => void): boolean {
  const recuerdo = leerMemoria(leerMemoriaDeCampana(), sala, Date.now());
  if (!recuerdo) return false;
  // Quien se anotó en una campaña de personas no tiene cuenta con que recibir: si ganó, el premio se entrega con quien organiza.
  const entregaConQuienOrganiza = recuerdo.cuenta === SIN_CUENTA && recuerdo.resultado === "gano";
  const accion = recuerdo.resultado === "gano"
    ? entregaConQuienOrganiza ? null : { clave: "cpRecibir", alHacer: recibir }
    : recuerdo.comprobante
      ? { clave: "cpComoSeEligio", enlace: recuerdo.comprobante }
      : null;
  repintarAviso = () => {
    if (!estado) return;
    pintarAviso(estado, texto(entregaConQuienOrganiza ? "cpEntregaT" : "cpTermino"), accion && { texto: texto(accion.clave), ...accion });
  };
  pintarUltimoAviso();
  return true;
}

function montarVista(campana: Campana, esEjemplo: boolean, enlace: { sala: string; clave: string; pase: string | null } | null): void {
  if (!raiz) return;
  repintarAviso = null;
  vista?.desmontar();
  const montaje = ++montajes;
  const ejemploVisible = document.querySelector<HTMLElement>("#cmp-ejemplo");
  if (ejemploVisible) ejemploVisible.hidden = !esEjemplo;
  if (esEjemplo || !enlace) {
    // La demostración se baja recién acá: quien escanea el QR de un evento de verdad no baja nada de esto.
    void import("./campana/demostracion").then(({ depsDeDemostracion }) => {
      if (montaje === montajes) vista = montarCelular(raiz, depsDeDemostracion(base, campana, parametros.get("estado")));
    });
    return;
  }
  // Una campaña de personas se anota sin billetera: lo suyo se baja solo para ella, y las demás no cambian en nada.
  if (campana.identidad === "persona") {
    void montarDePersona(campana, enlace, montaje);
    return;
  }
  // Recién acá, con la campaña cargada, se arma lo que habla con la sala y con Google.
  const deApp = enNavegadorDeApp(navigator.userAgent);
  const hayGoogle = hasPollarKey(network.name);
  // El módulo de Google baja ahora, en paralelo con la primera consulta: así la ventana sale del toque sin esperas.
  if (hayGoogle && !deApp) void cargaOpcional(import("./stellar/wallet-pollar").then((m) => m.precargarSdk()));
  const memoria = leerMemoriaDeCampana();
  /** Si este navegador guardó una entrada con el proveedor de cuentas: sin ella no hay sesión que retomar ni módulo que bajar. */
  const hayMarcaDelProveedor = (): boolean => {
    try {
      return memoria !== null && leerMarcaPollar(memoria, network.name) !== null;
    } catch {
      return false;
    }
  };
  const deps: DepsDelCelular = depsConectadas({
    base: { ...base, enApp: hayGoogle && deApp },
    campana,
    servicio: servicioDeSala(),
    sala: enlace.sala,
    clave: enlace.clave,
    pase: enlace.pase,
    google: sesionDeGoogle({
      local: memoria,
      pestana: leerAlmacenDePestana(),
      ahora: () => Date.now(),
      hayMarca: hayMarcaDelProveedor,
      // Si la pestaña se recarga o se va antes de que Google abra su ventana, la marca de la ventana se suelta.
      alIrse: (soltar) => {
        window.addEventListener("pagehide", soltar);
        return () => window.removeEventListener("pagehide", soltar);
      },
    }),
    memoria,
    red: network.name,
    enLinea: () => navigator.onLine !== false,
    ir: (direccion) => location.assign(direccion),
    enlace: () => location.href,
    origen: () => location.origin,
    ...(typeof navigator.share === "function" ? { compartir: (enlace: string) => navigator.share({ url: enlace }) } : {}),
    ...(typeof navigator.locks?.request === "function"
      ? { bloquear: <T>(nombre: string, trabajo: () => Promise<T>): Promise<T> => navigator.locks.request(nombre, trabajo) }
      : {}),
  });
  vista = montarCelular(raiz, deps);
}

/**
 * Monta el celular de una campaña de personas: la persona entra con el botón de Google del sitio y la sala la anota sin
 * billetera. Hace falta que el sitio se haya construido con esa entrada (`persona-bandera.ts`): si no, la página lo dice y no
 * abre nada. Lo de Google se baja solo acá, y el guion de Google recién cuando la pantalla necesita el botón.
 */
async function montarDePersona(
  campana: Campana,
  enlace: { sala: string; clave: string; pase: string | null },
  montaje: number,
): Promise<void> {
  const clienteId = clienteDeGoogleDelSitio();
  if (clienteId === null) {
    mostrarCarga("persona-apagada", () => undefined);
    return;
  }
  let piezas: [typeof import("./campana/conectar-persona"), typeof import("./campana/google")];
  try {
    piezas = await Promise.all([import("./campana/conectar-persona"), import("./campana/google")]);
  } catch {
    mostrarCarga("sin-red", () => void cargar());
    return;
  }
  if (!raiz || montaje !== montajes) return;
  const [{ depsDePersona }, { botonDeGoogle }] = piezas;
  const deps = depsDePersona({
    base,
    campana,
    servicio: servicioDeSala(),
    sala: enlace.sala,
    clave: enlace.clave,
    pase: enlace.pase,
    google: botonDeGoogle({ clienteId, idioma: getLang, oscuro: temaOscuro }),
    memoria: leerMemoriaDeCampana(),
    red: network.name,
    enLinea: () => navigator.onLine !== false,
    enlace: () => location.href,
    ...(typeof navigator.locks?.request === "function"
      ? { bloquear: <T>(nombre: string, trabajo: () => Promise<T>): Promise<T> => navigator.locks.request(nombre, trabajo) }
      : {}),
  });
  vista = montarCelular(raiz, deps);
}

/** Si la página está en tema oscuro: el de la dirección, o el del sistema si la dirección no fuerza ninguno. */
function temaOscuro(): boolean {
  const forzado = document.documentElement.dataset.theme;
  if (forzado === "dark") return true;
  if (forzado === "light") return false;
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** El almacenamiento de esta pestaña, o null si el navegador lo bloquea. */
function leerAlmacenDePestana(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** El modo vista: baja la vista, la deja escuchando y muestra Cargando hasta que llegue la primera campaña. */
async function entrarEnVistaPrevia(contenedor: HTMLElement): Promise<void> {
  mostrarCarga("cargando", () => undefined);
  const { montarVistaPrevia, avisarListaAlPadre } = await import("./campana/vista-previa");
  const origen = location.origin;
  montarVistaPrevia({
    raiz: contenedor,
    base,
    escuchar: (f) => {
      window.addEventListener("message", f);
      return () => window.removeEventListener("message", f);
    },
    origen,
    padre: window.parent,
    avisarLista: () => avisarListaAlPadre(window.parent, origen),
    cambiarIdioma: setLang,
    alCambiarIdioma: onLangChange,
    red: network.name,
    // Con la primera vista montada el aviso de carga no se vuelve a pintar al cambiar el idioma.
    alMontar: () => {
      repintarAviso = null;
    },
  });
}

async function cargar(): Promise<void> {
  if (!raiz || !estado) return;
  if (enVistaPrevia) {
    await entrarEnVistaPrevia(raiz);
    return;
  }
  // Primero la bandera y la demostración: con las campañas apagadas, nada de lo de la sala ni de Google corre.
  if (!campanasActivo() && !ejemplo) {
    mostrarCarga("cerrada", () => undefined);
    return;
  }
  if (ejemplo) {
    const { campanaDeEjemplo } = await import("./campana/ejemplo");
    montarVista(campanaDeEjemplo(Date.now()), true, null);
    return;
  }
  const enlace = leerEnlaceDeCampana(location.search, location.hash);
  if (!enlace?.sala || !enlace.clave) {
    mostrarCarga("no-esta", () => undefined);
    return;
  }
  const { sala, clave, pase } = enlace;
  mostrarCarga("cargando", () => void cargar());
  const resultado = await cargarConUnReintento(fetch, servicioDeSala(), sala, enlace.evento);
  if (!resultado.ok) {
    if (resultado.estado === "no-esta"
      && mostrarSalaTerminada(sala, () => location.assign(destinoDeRecibir(network.name)))) return;
    const reintentar = resultado.estado === "sin-red" ? () => void cargar() : () => undefined;
    mostrarCarga(resultado.estado, reintentar);
    return;
  }
  if (resultado.campana.red !== network.name) {
    mostrarCarga("mal", () => undefined);
    return;
  }
  montarVista(resultado.campana, false, { sala, clave, pase });
}

onLangChange(() => {
  vista?.pintar();
  pintarUltimoAviso();
});

// Si algo inesperado corta la carga, la pantalla no se queda esperando para siempre: lo dice y deja probar de nuevo.
const cargarConRed = (): void => void cargar().catch(() => mostrarCarga("sin-red", cargarConRed));
cargarConRed();
