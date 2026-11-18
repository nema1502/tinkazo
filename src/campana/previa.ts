
/** Pantalla previa de una campaña y estados de carga, sin depender de una red. */

import type { Lang } from "../idioma";
import { fechaTexto, horaTexto, premiosTexto } from "./formato";
import { leerCampana, type Campana, type EstadoDeCampana } from "./modelo";

/** Dependencias de la pantalla previa. */
export interface DepsDePrevia {
  tx: (clave: string) => string;
  idioma: () => Lang;
  campana: Campana;
  ejemplo: boolean;
  enApp: boolean;
  anotarme: () => void;
  ahora?: () => number;
  enlace?: () => string;
  sesion?: Storage;
}

/** Estados que puede mostrar el cargador antes de tener una campaña. */
export type EstadoDeCarga = "cerrada" | "no-esta" | "sin-red" | "mal";

/** Controles de una pantalla montada. */
export interface VistaDePrevia {
  pintar: () => void;
  desmontar: () => void;
}

const COLORES: Record<NonNullable<Campana["empresa"]["color"]>, string> = {
  rojo: "var(--cmp-rojo)",
  naranja: "var(--cmp-naranja)",
  amarillo: "var(--cmp-amarillo)",
  verde: "var(--cmp-verde)",
  azul: "var(--cmp-azul)",
  morado: "var(--cmp-morado)",
};
const MAXIMO_TEMPORIZADOR = 2_147_483_647;

function sustituir(texto: string, valores: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (_, clave: string) => valores[clave] ?? "");
}

function fecha(campana: Campana, ms: number, idioma: Lang, conAnio = false): string {
  return fechaTexto(ms, campana.zona, idioma, conAnio);
}

function estadoPorHora(campana: Campana, ahora: number): EstadoDeCampana {
  if (ahora < campana.abreMs || campana.estado === "borrador") return "borrador";
  if (ahora < campana.cierraMs && campana.estado === "abierta") return "abierta";
  if (campana.estado === "sorteada" || campana.estado === "terminada") return campana.estado;
  return "cerrada";
}

function limpiar(raiz: HTMLElement): void {
  raiz.replaceChildren();
}

function boton(raiz: HTMLElement, texto: string, clase: string, alHacer: () => void): HTMLButtonElement {
  const elemento = document.createElement("button");
  elemento.type = "button";
  elemento.className = clase;
  elemento.textContent = texto;
  elemento.addEventListener("click", alHacer);
  raiz.append(elemento);
  return elemento;
}

function mostrarRespaldoDeCopia(deps: DepsDePrevia, raiz: HTMLElement, enlace: string): void {
  let campo = raiz.querySelector<HTMLInputElement>("input[data-cmp-copiar]");
  if (!campo) {
    campo = document.createElement("input");
    campo.type = "text";
    campo.readOnly = true;
    campo.dataset.cmpCopiar = "";
    campo.setAttribute("aria-label", deps.tx("cpCopiar"));
    raiz.append(campo);
  }
  campo.value = enlace;
  campo.focus();
  campo.select();
}

function copiarEnlace(deps: DepsDePrevia, aviso: HTMLElement, raiz: HTMLElement): void {
  const enlace = deps.enlace?.() ?? window.location.href;
  const respaldo = (): void => mostrarRespaldoDeCopia(deps, raiz, enlace);
  const portapapeles = navigator.clipboard;
  if (!portapapeles) {
    respaldo();
    return;
  }
  void portapapeles.writeText(enlace).then(() => {
    aviso.textContent = deps.tx("cpCopiado");
    window.setTimeout(() => {
      aviso.textContent = deps.tx("cpEnApp");
    }, 3000);
  }).catch(respaldo);
}

function accionPrincipal(
  raiz: HTMLElement,
  deps: DepsDePrevia,
  hayPasos: boolean,
  irAPasos: () => void,
): HTMLElement {
  const accion = document.createElement("div");
  accion.className = "cmp-accion";
  raiz.append(accion);
  if (deps.enApp) {
    const aviso = document.createElement("p");
    aviso.className = "cmp-en-app";
    aviso.setAttribute("role", "status");
    aviso.setAttribute("aria-live", "polite");
    aviso.textContent = deps.tx("cpEnApp");
    accion.append(aviso);
    boton(accion, deps.tx("cpCopiar"), "primary", () => copiarEnlace(deps, aviso, accion));
    return accion;
  }
  boton(accion, deps.tx(hayPasos ? "cpSeguir" : "cpAnotarme"), "primary", () => {
    if (hayPasos) irAPasos();
    else deps.anotarme();
  });
  return accion;
}

function mostrarSaber(raiz: HTMLElement, deps: DepsDePrevia, irAPasos: () => void): void {
  const campana = deps.campana;
  const idioma = deps.idioma();
  limpiar(raiz);
  raiz.hidden = false;
  if (campana.empresa.logo) {
    const logo = document.createElement("img");
    logo.className = "cmp-logo";
    logo.alt = campana.empresa.nombre;
    logo.src = `data:${campana.empresa.logo.tipo};base64,${campana.empresa.logo.datos}`;
    raiz.append(logo);
  }
  const titulo = document.createElement("h1");
  titulo.textContent = sustituir(deps.tx("cpTitulo"), {
    empresa: campana.empresa.nombre,
    lugar: campana.lugar[idioma],
  });
  raiz.append(titulo);
  const organiza = document.createElement("p");
  organiza.className = "cmp-organiza";
  organiza.textContent = sustituir(deps.tx("cpOrganiza"), { empresa: campana.empresa.nombre });
  raiz.append(organiza);
  const premio = document.createElement("p");
  premio.className = "cmp-premio";
  premio.textContent = premiosTexto(campana.premios, idioma);
  raiz.append(premio);
  const lista = document.createElement("ul");
  for (const clave of ["cpGratis", "cpRevisamos", "cpPublica"] as const) {
    const item = document.createElement("li");
    item.textContent = sustituir(deps.tx(clave), { empresa: campana.empresa.nombre });
    lista.append(item);
  }
  const cierre = document.createElement("li");
  cierre.textContent = sustituir(deps.tx("cpCierre"), {
    fecha: fecha(campana, campana.cierraMs, idioma),
    hora: horaTexto(campana.cierraMs, campana.zona, idioma),
  });
  lista.append(cierre);
  raiz.append(lista);
  accionPrincipal(raiz, deps, campana.pasos.length > 0, irAPasos);
  const mas = document.createElement("details");
  const resumenMas = document.createElement("summary");
  resumenMas.textContent = deps.tx("cpMas");
  mas.append(resumenMas);
  const listaMas = document.createElement("ul");
  for (const clave of ["cpCuenta", "cpSiGanas", "cpPlazo"] as const) {
    const item = document.createElement("li");
    item.textContent = sustituir(deps.tx(clave), {
      empresa: campana.empresa.nombre,
      fecha: fecha(campana, campana.recibirHastaMs, idioma, clave === "cpPlazo"),
    });
    listaMas.append(item);
  }
  mas.append(listaMas);
  raiz.append(mas);
  const detalles = document.createElement("details");
  const resumen = document.createElement("summary");
  resumen.textContent = deps.tx("cpVerBases");
  detalles.append(resumen);
  const bases = document.createElement("p");
  bases.textContent = campana.bases[idioma];
  detalles.append(bases);
  const eleccion = document.createElement("p");
  eleccion.textContent = deps.tx("cpComoSeEligeDetalle");
  detalles.append(eleccion);
  const guardamos = document.createElement("p");
  guardamos.textContent = deps.tx("cpQueGuardamos");
  detalles.append(guardamos);
  raiz.append(detalles);
}

function mostrarPasos(raizPrincipal: HTMLElement, deps: DepsDePrevia, volver: () => void): void {
  const raiz = raizPrincipal.querySelector<HTMLElement>("#cmp-pasos");
  const saber = raizPrincipal.querySelector<HTMLElement>("#cmp-saber");
  if (!raiz || !saber) return;
  saber.hidden = true;
  raiz.hidden = false;
  limpiar(raiz);
  const idioma = deps.idioma();
  const titulo = document.createElement("h2");
  titulo.textContent = sustituir(deps.tx("cpPasosT"), { empresa: deps.campana.empresa.nombre });
  raiz.append(titulo);
  for (const [indice, paso] of deps.campana.pasos.entries()) {
    const tarjeta = document.createElement("article");
    tarjeta.className = "cmp-paso";
    const texto = document.createElement("p");
    texto.textContent = sustituir(paso.texto[idioma], { empresa: deps.campana.empresa.nombre });
    tarjeta.append(texto);
    if (paso.url) {
      const abrir = document.createElement("a");
      abrir.className = "ghost";
      abrir.href = paso.url;
      abrir.target = "_blank";
      abrir.rel = "noopener noreferrer";
      abrir.textContent = deps.tx("cpAbrir");
      tarjeta.append(abrir);
    }
    const etiqueta = document.createElement("label");
    const listo = document.createElement("input");
    listo.type = "checkbox";
    listo.checked = leerPaso(deps, indice);
    listo.addEventListener("change", () => guardarPaso(deps, indice, listo.checked));
    etiqueta.append(listo, document.createTextNode(deps.tx("cpListo")));
    tarjeta.append(etiqueta);
    raiz.append(tarjeta);
  }
  const nota = document.createElement("p");
  nota.textContent = sustituir(deps.tx("cpPasosNota"), { empresa: deps.campana.empresa.nombre });
  raiz.append(nota);
  const accion = accionPrincipal(raiz, deps, false, () => undefined);
  boton(accion, deps.tx("cpVolver"), "ghost", volver);
}

function leerPaso(deps: DepsDePrevia, indice: number): boolean {
  try {
    return deps.sesion?.getItem(`tinkazo.campana.${deps.campana.evento}.${indice}`) === "1";
  } catch {
    return false;
  }
}

function guardarPaso(deps: DepsDePrevia, indice: number, marcado: boolean): void {
  try {
    if (marcado) deps.sesion?.setItem(`tinkazo.campana.${deps.campana.evento}.${indice}`, "1");
    else deps.sesion?.removeItem(`tinkazo.campana.${deps.campana.evento}.${indice}`);
  } catch {
    /* Si falla el almacenamiento, la lectura de la pantalla continúa. */
  }
}

/** Monta la pantalla previa dentro de la raíz recibida y conserva la pantalla activa. */
export function montarPrevia(raiz: HTMLElement, deps: DepsDePrevia): VistaDePrevia {
  const estado = raiz.querySelector<HTMLElement>("#cmp-estado");
  const saber = raiz.querySelector<HTMLElement>("#cmp-saber");
  const pasos = raiz.querySelector<HTMLElement>("#cmp-pasos");
  if (!estado || !saber || !pasos) return { pintar: () => undefined, desmontar: () => undefined };
  const mensaje = raiz.querySelector<HTMLElement>("#cmp-mensaje");
  const ejemplo = raiz.querySelector<HTMLElement>("#cmp-ejemplo");
  if (ejemplo) ejemplo.hidden = !deps.ejemplo;
  const acento = deps.campana.empresa.color;
  raiz.style.setProperty("--cmp-acento", acento ? COLORES[acento] : "var(--magenta)");
  let pantalla: "saber" | "pasos" = "saber";
  let estadoVisible = estadoPorHora(deps.campana, deps.ahora?.() ?? Date.now());
  let temporizador: number | null = null;

  const limpiarTemporizador = (): void => {
    if (temporizador !== null) window.clearTimeout(temporizador);
    temporizador = null;
  };
  const limpiarAviso = (): void => {
    if (mensaje) mensaje.textContent = "";
  };
  const pintar = (): void => {
    limpiarTemporizador();
    const ahora = deps.ahora?.() ?? Date.now();
    const actual = estadoPorHora(deps.campana, ahora);
    estadoVisible = actual;
    limpiar(estado);
    estado.hidden = false;
    saber.hidden = true;
    pasos.hidden = true;
    if (actual === "borrador") {
      const texto = document.createElement("p");
      texto.textContent = sustituir(deps.tx("cpAbre"), {
        fecha: fecha(deps.campana, deps.campana.abreMs, deps.idioma()),
        hora: horaTexto(deps.campana.abreMs, deps.campana.zona, deps.idioma()),
      });
      estado.append(texto);
    } else if (actual === "cerrada" || actual === "sellada") {
      const texto = document.createElement("p");
      texto.textContent = deps.tx("cpCerro");
      estado.append(texto);
    } else if (actual === "sorteada" || actual === "terminada") {
      const texto = document.createElement("p");
      texto.textContent = deps.tx("cpSorteado");
      estado.append(texto);
      if (deps.campana.comprobante) {
        const enlace = document.createElement("a");
        enlace.className = "primary";
        enlace.href = deps.campana.comprobante;
        enlace.textContent = deps.tx("cpComoSeEligio");
        estado.append(enlace);
      }
    } else {
      estado.hidden = true;
      limpiarAviso();
      if (pantalla === "pasos") mostrarPasos(raiz, depsConAccion, irASaber);
      else mostrarSaber(saber, depsConAccion, irAPasos);
    }
    const objetivo = actual === "borrador" && ahora < deps.campana.abreMs
      ? deps.campana.abreMs
      : actual === "abierta"
        ? deps.campana.cierraMs
        : null;
    if (objetivo !== null) {
      const espera = Math.min(Math.max(objetivo - ahora, 0), MAXIMO_TEMPORIZADOR);
      temporizador = window.setTimeout(() => {
        temporizador = null;
        pintar();
      }, espera);
    }
  };
  const comprobarHora = (): boolean => {
    const actual = estadoPorHora(deps.campana, deps.ahora?.() ?? Date.now());
    if (actual === "abierta" && actual === estadoVisible) return true;
    pintar();
    return false;
  };
  const irAPasos = (): void => {
    if (!comprobarHora()) return;
    pantalla = "pasos";
    limpiarAviso();
    mostrarPasos(raiz, depsConAccion, irASaber);
  };
  const irASaber = (): void => {
    pantalla = "saber";
    pasos.hidden = true;
    saber.hidden = false;
    limpiarAviso();
    mostrarSaber(saber, depsConAccion, irAPasos);
  };
  const depsConAccion: DepsDePrevia = {
    ...deps,
    get enApp() {
      return deps.enApp;
    },
    anotarme: () => {
      if (comprobarHora()) deps.anotarme();
    },
  };
  pintar();
  return { pintar, desmontar: limpiarTemporizador };
}

/** Pinta un estado de carga antes de que exista una campaña. */
export function pintarEstadoDeCarga(
  raiz: HTMLElement,
  tx: (clave: string) => string,
  estado: EstadoDeCarga,
  reintentar: () => void,
): void {
  limpiar(raiz);
  const texto = document.createElement("p");
  const clave = estado === "no-esta"
    ? "cpNoEsta"
    : estado === "mal"
      ? "cpMal"
      : estado === "sin-red"
        ? "cpSinRed"
        : "cpNoAbierta";
  texto.textContent = tx(clave);
  raiz.append(texto);
  if (estado === "sin-red") boton(raiz, tx("cpProbarDeNuevo"), "ghost", reintentar);
}

/** Valida la respuesta del servicio y distingue los errores que puede mostrar la página. */
export function validarRespuestaDeCampana(valor: unknown): Campana | null {
  const lectura = leerCampana(valor);
  return lectura.ok ? lectura.campana : null;
}
