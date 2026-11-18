/** Entrada de participar.html: carga la campaña y deja las pantallas en manos del estado del celular. */

import "./pagina";
import "./version-nueva";
import "./campana/campana.css";
import { cargaOpcional } from "./carga-opcional";
import { enNavegadorDeApp } from "./navegador";
import { getLang, initialLang, onLangChange, setLang, texto } from "./idioma";
import { leerEnlaceDeCampana } from "./campana/enlace";
import { campanaDeEjemplo } from "./campana/ejemplo";
import { campanasActivo } from "./campana/bandera";
import { montarCelular, type DepsDelCelular, type VistaDelCelular } from "./campana/celular";
import { cargarConUnReintento, depsConectadas, destinoDeRecibir, type BaseDelCelular } from "./campana/conectar";
import { depsDeDemostracion } from "./campana/demostracion";
import { leerMemoria } from "./campana/memoria";
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
const idioma = initialLang();
setLang(idioma);

let vista: VistaDelCelular | null = null;
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
  const accion = recuerdo.resultado === "gano"
    ? { clave: "cpRecibir", alHacer: recibir }
    : recuerdo.comprobante
      ? { clave: "cpComoSeEligio", enlace: recuerdo.comprobante }
      : null;
  repintarAviso = () => {
    if (!estado) return;
    pintarAviso(estado, texto("cpTermino"), accion && { texto: texto(accion.clave), ...accion });
  };
  pintarUltimoAviso();
  return true;
}

function montarVista(campana: Campana, esEjemplo: boolean, enlace: { sala: string; clave: string; pase: string | null } | null): void {
  if (!raiz) return;
  repintarAviso = null;
  vista?.desmontar();
  const ejemploVisible = document.querySelector<HTMLElement>("#cmp-ejemplo");
  if (ejemploVisible) ejemploVisible.hidden = !esEjemplo;
  if (esEjemplo || !enlace) {
    vista = montarCelular(raiz, depsDeDemostracion(base, campana, parametros.get("estado")));
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
    }),
    memoria,
    red: network.name,
    enLinea: () => navigator.onLine !== false,
    hayMarcaDelProveedor,
    ir: (direccion) => location.assign(direccion),
    enlace: () => location.href,
    ...(typeof navigator.locks?.request === "function"
      ? { bloquear: <T>(nombre: string, trabajo: () => Promise<T>): Promise<T> => navigator.locks.request(nombre, trabajo) }
      : {}),
  });
  vista = montarCelular(raiz, deps);
}

/** El almacenamiento de esta pestaña, o null si el navegador lo bloquea. */
function leerAlmacenDePestana(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

async function cargar(): Promise<void> {
  if (!raiz || !estado) return;
  // Primero la bandera y la demostración: con las campañas apagadas, nada de lo de la sala ni de Google corre.
  if (!campanasActivo() && !ejemplo) {
    mostrarCarga("cerrada", () => undefined);
    return;
  }
  if (ejemplo) {
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

void cargar();
