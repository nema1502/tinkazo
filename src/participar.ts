/**
 * Entrada de la pantalla previa de campañas.
 * Decide si muestra la vista de ejemplo o si consulta la campaña indicada en el enlace.
 */

import "./pagina";
import "./version-nueva";
import "./campana/campana.css";
import { configDelPortero } from "./stellar/patrocinio-config";
import { enNavegadorDeApp } from "./navegador";
import { getLang, initialLang, onLangChange, setLang, texto } from "./idioma";
import { leerEnlaceDeCampana } from "./campana/enlace";
import { campanaDeEjemplo } from "./campana/ejemplo";
import { campanasActivo } from "./campana/bandera";
import { cargarCampana } from "./campana/carga";
import {
  montarPrevia,
  pintarEstadoDeCarga,
  type EstadoDeCarga,
  type VistaDePrevia,
} from "./campana/previa";
import type { Campana } from "./campana/modelo";

const raiz = document.querySelector<HTMLElement>(".cmp");
const estado = document.querySelector<HTMLElement>("#cmp-estado");
const mensaje = document.querySelector<HTMLElement>("#cmp-mensaje");
const ejemplo = new URLSearchParams(location.search).get("demo") === "campana";
const idioma = initialLang();
setLang(idioma);

let vista: VistaDePrevia | null = null;
let ultimoEstado: { tipo: EstadoDeCarga | "cargando"; reintentar: () => void } | null = null;
let claveAviso: string | null = null;

/** Lee el almacenamiento de la pestaña sin impedir que la página abra si el navegador lo bloquea. */
export function leerSesionDeCampana(): Storage | undefined {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
}

function estadoDeEjemplo(campana: Campana): Campana {
  const estadoSolicitado = new URLSearchParams(location.search).get("estado");
  if (!estadoSolicitado || !["borrador", "cerrada", "sorteada"].includes(estadoSolicitado)) {
    return campana;
  }
  return { ...campana, estado: estadoSolicitado as Campana["estado"] };
}

function pintarUltimoEstado(): void {
  if (!estado || !ultimoEstado) return;
  estado.hidden = false;
  if (ultimoEstado.tipo !== "cargando") {
    pintarEstadoDeCarga(estado, texto, ultimoEstado.tipo, ultimoEstado.reintentar);
    return;
  }
  estado.replaceChildren();
  const cargando = document.createElement("p");
  cargando.textContent = texto("cpCargando");
  estado.append(cargando);
}

function mostrarCarga(tipo: EstadoDeCarga | "cargando", reintentar: () => void): void {
  ultimoEstado = { tipo, reintentar };
  pintarUltimoEstado();
}

function pintarAviso(): void {
  if (mensaje) mensaje.textContent = claveAviso ? texto(claveAviso) : "";
}

function mostrarAviso(clave: string): void {
  claveAviso = clave;
  pintarAviso();
}

function montarVista(campana: Campana, esEjemplo: boolean): void {
  if (!raiz) return;
  ultimoEstado = null;
  vista?.desmontar();
  vista = montarPrevia(raiz, {
    tx: texto,
    idioma: getLang,
    campana,
    ejemplo: esEjemplo,
    enApp: enNavegadorDeApp(navigator.userAgent),
    anotarme: () => mostrarAviso(esEjemplo ? "cpEjemploAnotar" : "cpPronto"),
    sesion: leerSesionDeCampana(),
    enlace: () => location.href,
  });
}

async function cargar(): Promise<void> {
  if (!raiz || !estado) return;
  const enlace = leerEnlaceDeCampana(location.search, location.hash);
  if (!campanasActivo() && !ejemplo) {
    mostrarCarga("cerrada", () => undefined);
    return;
  }
  if (ejemplo) {
    const muestra = estadoDeEjemplo(campanaDeEjemplo(Date.now()));
    document.querySelector<HTMLElement>("#cmp-ejemplo")?.removeAttribute("hidden");
    montarVista(muestra, true);
    return;
  }
  if (!enlace) {
    mostrarCarga("no-esta", () => undefined);
    return;
  }
  const portero = configDelPortero().url;
  if (!portero) {
    mostrarCarga("sin-red", () => void cargar());
    return;
  }
  mostrarCarga("cargando", () => void cargar());
  const resultado = await cargarCampana(fetch, portero, enlace.evento);
  if (!resultado.ok) {
    const reintentar = resultado.estado === "sin-red" ? () => void cargar() : () => undefined;
    mostrarCarga(resultado.estado, reintentar);
    return;
  }
  montarVista(resultado.campana, false);
}

onLangChange(() => {
  const habiaAviso = Boolean(mensaje?.textContent);
  vista?.pintar();
  pintarUltimoEstado();
  if (!habiaAviso) claveAviso = null;
  pintarAviso();
});

void cargar();
