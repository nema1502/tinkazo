/** Pantallas públicas de una campaña y estados de carga, sin consultar la sala por su cuenta. */

import { horaTexto, premiosTexto } from "./formato";
import { leerCampana, type Campana } from "./modelo";
import { caja, conDestacado, pintarAviso } from "./piezas";
import { sustituir } from "./sustituir";
import type {
  DepsDelCelular,
  EstadoPublico,
  FallaDeEntrada,
  SesionDelCelular,
} from "./celular";

/** Colores de la empresa compartidos por todas las pantallas. */
export const COLORES: Record<NonNullable<Campana["empresa"]["color"]>, string> = {
  rojo: "var(--cmp-rojo)",
  naranja: "var(--cmp-naranja)",
  amarillo: "var(--cmp-amarillo)",
  verde: "var(--cmp-verde)",
  azul: "var(--cmp-azul)",
  morado: "var(--cmp-morado)",
};

/** Estados que puede mostrar el cargador antes de entrar a una campaña. */
export type EstadoDeCarga = "cerrada" | "no-esta" | "sin-red" | "mal" | "pase-vencido";

const CLAVES_DE_CARGA: Record<EstadoDeCarga, string> = {
  cerrada: "cpNoAbierta",
  "no-esta": "cpNoEsta",
  "sin-red": "cpSinRed",
  mal: "cpMal",
  "pase-vencido": "cpPaseVencido",
};

/** Desde este largo el premio se escribe más chico para que quepa en la pantalla sin cortarse. */
const TEXTO_LARGO_DEL_PREMIO = 26;

const CLAVES_DE_ENTRADA: Record<FallaDeEntrada, string> = {
  ventana: "cpErrVentana",
  cerrada: "cpErrCerrada",
  google: "cpErrGoogle",
  cuentas: "cpErrCuentas",
};

export { sustituir };

function limpiar(raiz: HTMLElement): void {
  raiz.replaceChildren();
}

function seccion(raiz: HTMLElement, selector: string): HTMLElement | null {
  if (raiz.matches(selector)) return raiz;
  return raiz.querySelector<HTMLElement>(selector);
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

function parrafo(raiz: HTMLElement, texto: string, clase = ""): HTMLParagraphElement {
  const p = document.createElement("p");
  if (clase) p.className = clase;
  p.textContent = texto;
  raiz.append(p);
  return p;
}

function mostrarRespaldoDeCopia(deps: DepsDelCelular, raiz: HTMLElement, enlace: string): void {
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

function copiarEnlace(
  deps: DepsDelCelular,
  aviso: HTMLElement,
  raiz: HTMLElement,
  programar: (f: () => void, ms: number) => number,
): void {
  const enlace = deps.enlace();
  const respaldo = (): void => mostrarRespaldoDeCopia(deps, raiz, enlace);
  const portapapeles = navigator.clipboard;
  if (!portapapeles) {
    respaldo();
    return;
  }
  void portapapeles.writeText(enlace).then(() => {
    aviso.textContent = deps.tx("cpCopiado");
    programar(() => {
      aviso.textContent = deps.tx("cpEnApp");
    }, 3000);
  }).catch(respaldo);
}

/**
 * Las reglas se repiten donde hay una decisión, pero quedan plegadas para no tapar la acción. La línea del correo va solo
 * cuando la sala dice que de verdad avisa por correo (`correo`): una promesa que no se cumple no se escribe.
 */
export function pintarReglas(raiz: HTMLElement, deps: DepsDelCelular, correo = false): void {
  const idioma = deps.idioma();
  const detalles = document.createElement("details");
  detalles.className = "cmp-reglas";
  const resumen = document.createElement("summary");
  resumen.className = "cmp-suave";
  resumen.textContent = deps.tx("cpReglas");
  detalles.append(resumen);
  parrafo(detalles, sustituir(deps.tx("cpOrganiza"), { empresa: deps.campana.empresa.nombre }));
  parrafo(detalles, sustituir(deps.tx("cpSiGanas"), { empresa: deps.campana.empresa.nombre }));
  if (correo) parrafo(detalles, deps.tx("cpAvisoCorreo"));
  const costo = deps.costoDelRetiro();
  if (costo !== null) parrafo(detalles, sustituir(deps.tx("cpRetiro"), { costo }));
  parrafo(detalles, deps.tx("cpSoloAca"));
  // La aclaración de los pedidos vive acá: afuera repetía lo que ya dicen las reglas y alargaba la pantalla.
  if (deps.campana.pasos.length > 0) parrafo(detalles, deps.tx("cpPasosNota"));
  parrafo(detalles, deps.tx("cpRevisamosMas"));
  parrafo(detalles, deps.tx("cpComoSeEligeDetalle"));
  parrafo(detalles, deps.tx("cpQueGuardamos"));
  parrafo(detalles, deps.campana.bases[idioma], "cmp-bases");
  raiz.append(detalles);
}

/** Lo que se sabe de la entrada con Google, guardado afuera de la pantalla: repintar no lo puede perder. */
export interface EstadoDeEntrada {
  /** Cuándo se tocó Entrar, mientras la ventana de Google sigue abierta. Si no hay una entrada en curso, null. */
  desde: number | null;
  /** Cómo terminó la última entrada, si falló. */
  falla: FallaDeEntrada | null;
}

/** Cuánto tarda en aparecer el aviso de volver a la pestaña después de tocar Entrar. */
const AVISO_TARDIO_MS = 6000;

export function motivoDeEntrada(error: unknown): FallaDeEntrada {
  const motivo = error instanceof Error ? error.message : "";
  return motivo === "ventana" || motivo === "cerrada" || motivo === "google" || motivo === "cuentas"
    ? motivo
    : "google";
}

/** Pinta la campaña abierta. La entrada con Google empieza únicamente con el toque del botón. */
export function pintarLaCampana(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  publico: EstadoPublico,
  alEntrar: (sesion: SesionDelCelular) => void,
  entrada: EstadoDeEntrada = { desde: null, falla: null },
): () => void {
  const raiz = seccion(raizPrincipal, "#cmp-saber");
  if (!raiz) return () => undefined;
  const temporizadores = new Set<number>();
  const programar = (f: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      temporizadores.delete(id);
      f();
    }, ms);
    temporizadores.add(id);
    return id;
  };
  const cancelar = (id: number | null): void => {
    if (id === null) return;
    window.clearTimeout(id);
    temporizadores.delete(id);
  };
  const limpiarTemporizadores = (): void => {
    for (const id of temporizadores) window.clearTimeout(id);
    temporizadores.clear();
  };
  const anterior = Number(raiz.querySelector<HTMLElement>(".cmp-contador")?.dataset.total ?? -1);
  limpiar(raiz);
  raiz.hidden = false;
  raiz.className = "cmp-saber cmp-dos";
  const campana = deps.campana;
  const idioma = deps.idioma();
  const izq = caja("cmp-izq");
  if (campana.empresa.logo) {
    const logo = document.createElement("img");
    logo.className = "cmp-logo";
    logo.alt = campana.empresa.nombre;
    logo.src = `data:${campana.empresa.logo.tipo};base64,${campana.empresa.logo.datos}`;
    izq.append(logo);
  }
  const titulo = document.createElement("h1");
  titulo.textContent = sustituir(deps.tx("cpTitulo"), {
    empresa: campana.empresa.nombre,
    lugar: campana.lugar[idioma],
  });
  izq.append(titulo);
  const premio = caja("cmp-premio cmp-hero");
  parrafo(premio, deps.tx("cpPremioEtiqueta"), "cmp-premio-etiqueta");
  const textoDelPremio = premiosTexto(campana.premios, idioma);
  const largo = textoDelPremio.length > TEXTO_LARGO_DEL_PREMIO;
  parrafo(premio, textoDelPremio, largo ? "cmp-premio-texto cmp-largo" : "cmp-premio-texto");
  // Que participar es gratis va en el bloque del premio, como rótulo: una caja sola parecería un botón.
  parrafo(premio, deps.tx("cpGratisCorto"), "cmp-premio-etiqueta");
  izq.append(premio);
  const der = caja("cmp-der");
  const datos = caja("cmp-datos");
  const claveContador = publico.total === 0
    ? "cpContador0"
    : publico.total === 1
      ? "cpContador1"
      : "cpContadorN";
  const contador = parrafo(datos, "", "cmp-contador");
  conDestacado(contador, deps.tx(claveContador), "n", String(publico.total), "cmp-cifra");
  contador.dataset.total = String(publico.total);
  if (anterior >= 0 && publico.total > anterior && !deps.movimientoReducido()) {
    contador.classList.add("sube");
    programar(() => contador.classList.remove("sube"), 400);
  }
  parrafo(datos, sustituir(deps.tx("cpGratisCierra"), {
    hora: horaTexto(publico.cierraMs, campana.zona, idioma),
  }), "cmp-cierre");
  der.append(datos);
  raiz.append(izq, der);
  pintarReglas(raiz, deps, publico.correo === true);
  const accion = caja("cmp-accion");
  raiz.append(accion);
  if (deps.enApp) {
    const aviso = parrafo(accion, deps.tx("cpEnApp"), "cmp-en-app");
    aviso.setAttribute("role", "status");
    aviso.setAttribute("aria-live", "polite");
    boton(accion, deps.tx("cpCopiar"), "primary", () => copiarEnlace(deps, aviso, accion, programar));
    return limpiarTemporizadores;
  }
  parrafo(accion, deps.tx("cpEntrarNota"), "cmp-apoyo");
  const error = parrafo(accion, "", "cmp-error");
  error.hidden = true;
  // La línea de espera va antes del botón: así el botón no se corre cuando aparece.
  const espera = parrafo(accion, deps.tx("cpVolveALaPestana"), "cmp-vuelve");
  espera.hidden = true;
  const entrar = boton(accion, deps.tx("cpEntrar"), "primary", () => undefined);
  let avisoTardio: number | null = null;
  entrar.addEventListener("click", () => {
    if (entrar.disabled) return;
    entrar.disabled = true;
    entrar.textContent = deps.tx("cpEntrando");
    error.hidden = true;
    avisoTardio = programar(() => {
      espera.hidden = false;
    }, AVISO_TARDIO_MS);
    void Promise.resolve().then(deps.entrar).then((sesion) => {
      cancelar(avisoTardio);
      alEntrar(sesion);
    }).catch((falla: unknown) => {
      cancelar(avisoTardio);
      espera.hidden = true;
      entrar.disabled = false;
      entrar.textContent = deps.tx("cpEntrar");
      error.textContent = deps.tx(CLAVES_DE_ENTRADA[motivoDeEntrada(falla)]);
      error.hidden = false;
    });
  });
  // Si la pantalla se pintó de nuevo con Google abierto (volver a la pestaña, el reloj o el idioma), el botón y el aviso
  // siguen como estaban, y un error que ya llegó no se pierde.
  if (entrada.desde !== null) {
    entrar.disabled = true;
    entrar.textContent = deps.tx("cpEntrando");
    const falta = AVISO_TARDIO_MS - (deps.ahora() - entrada.desde);
    if (falta <= 0) espera.hidden = false;
    else avisoTardio = programar(() => {
      espera.hidden = false;
    }, falta);
  } else if (entrada.falla !== null) {
    error.textContent = deps.tx(CLAVES_DE_ENTRADA[entrada.falla]);
    error.hidden = false;
  }
  return limpiarTemporizadores;
}

/** Pinta un estado de carga antes de que exista una sesión o una respuesta de la sala. */
export function pintarEstadoDeCarga(
  raiz: HTMLElement,
  tx: (clave: string) => string,
  estado: EstadoDeCarga,
  reintentar: () => void,
): void {
  const accion = estado === "sin-red" ? { texto: tx("cpProbarDeNuevo"), alHacer: reintentar } : null;
  const problema = estado !== "cerrada";
  pintarAviso(raiz, tx(CLAVES_DE_CARGA[estado]), accion, problema);
}

/** Valida la respuesta del servicio y distingue los errores que puede mostrar la página. */
export function validarRespuestaDeCampana(valor: unknown): Campana | null {
  const lectura = leerCampana(valor);
  return lectura.ok ? lectura.campana : null;
}
