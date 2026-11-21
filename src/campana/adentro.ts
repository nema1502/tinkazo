/** Pantallas de quien ya entró: solo pintan los datos recibidos y avisan las acciones de la persona. */

import { horaTexto, premiosTexto } from "./formato";
import type { MemoriaDeCampana } from "./memoria";
import type { PasoDeCampana, TipoDePaso } from "./modelo";
import { caja, conDestacado, llama, marcaDeTilde, rotulosChicos } from "./piezas";
import { pintarReglas, sustituir } from "./previa";
import type { DepsDelCelular, Fase, MotivoDeAlta, MotivoDeSalida } from "./celular";

const CLAVES_DE_PASO: Record<TipoDePaso, string> = {
  instagram: "cpPasoInstagram",
  tiktok: "cpPasoTiktok",
  x: "cpPasoX",
  youtube: "cpPasoYoutube",
  facebook: "cpPasoFacebook",
  whatsapp: "cpPasoWhatsapp",
  enlace: "cpPasoEnlace",
  texto: "cpPasoEnlace",
};

const CLAVES_DE_ALTA: Record<Exclude<MotivoDeAlta, "quitada">, string> = {
  llena: "cpErrLlena",
  mucha: "cpErrMucha",
  creando: "cpErrCreando",
  wifi: "cpErrWifi",
  espera: "cpErrEspera",
  cuentas: "cpErrCuentas",
  proveedor: "cpErrGoogle",
  cerro: "cpCerro",
  pase: "cpErrPase",
  sesion: "cpErrSesion",
  "solo-google": "cpErrSoloGoogle",
  red: "cpErrRed",
  otro: "cpErrOtro",
};

const CLAVES_DE_SALIDA: Record<MotivoDeSalida, string> = {
  repetida: "cpMotivoRepetida",
  evento: "cpMotivoEvento",
  pidio: "cpMotivoPidio",
  otro: "cpMotivoOtro",
};

export interface AccionesDeHola {
  alAnotar: () => void;
  alSalir: () => void;
  anotando?: boolean;
  tardando?: boolean;
}

const ACCIONES_QUIETAS: AccionesDeHola = {
  alAnotar: () => undefined,
  alSalir: () => undefined,
};

function seccion(raiz: HTMLElement, selector: string, clase: string): HTMLElement | null {
  const encontrada = raiz.matches(selector) ? raiz : raiz.querySelector<HTMLElement>(selector);
  if (!encontrada) return null;
  encontrada.replaceChildren();
  encontrada.hidden = false;
  encontrada.className = clase;
  return encontrada;
}

function parrafo(raiz: HTMLElement, texto: string, clase = ""): HTMLParagraphElement {
  const p = document.createElement("p");
  if (clase) p.className = clase;
  p.textContent = texto;
  raiz.append(p);
  return p;
}

function titulo(raiz: HTMLElement, texto: string, nivel: "h1" | "h2" = "h1"): void {
  const elemento = document.createElement(nivel);
  elemento.textContent = texto;
  raiz.append(elemento);
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

function enlaceComprobante(raiz: HTMLElement, deps: DepsDelCelular, url: string): void {
  const enlace = document.createElement("a");
  enlace.className = "cmp-suave";
  enlace.href = url;
  enlace.textContent = deps.tx("cpComoSeEligio");
  raiz.append(enlace);
}

/** Traduce el motivo con claves completas para que el armado del sitio las incluya. */
export function textoDeErrorDeAlta(deps: DepsDelCelular, motivo: MotivoDeAlta): string {
  return deps.tx(motivo === "quitada" ? "cpErrOtro" : CLAVES_DE_ALTA[motivo]);
}

/** La cuenta de la red que se ve en la dirección, para que la fila diga adónde lleva. */
export function cuentaDeRed(url: string, tipo: TipoDePaso): string | null {
  if (tipo !== "instagram" && tipo !== "tiktok" && tipo !== "x") return null;
  try {
    const primerTramo = new URL(url).pathname.split("/").filter(Boolean)[0];
    if (!primerTramo) return null;
    const cuenta = tipo === "tiktok" && primerTramo.startsWith("@") ? primerTramo.slice(1) : primerTramo;
    return /^[A-Za-z0-9._]{1,30}$/u.test(cuenta) ? cuenta : null;
  } catch {
    return null;
  }
}

function leerPaso(deps: DepsDelCelular, indice: number): boolean {
  try {
    return sessionStorage.getItem(`tinkazo.campana.${deps.campana.evento}.${indice}`) === "1";
  } catch {
    return false;
  }
}

function guardarPaso(deps: DepsDelCelular, indice: number): void {
  try {
    sessionStorage.setItem(`tinkazo.campana.${deps.campana.evento}.${indice}`, "1");
  } catch {
    /* El pedido se puede abrir aunque el navegador bloquee el almacenamiento. */
  }
}

/** Lo que dice la segunda columna de una fila: Abrir mientras no se tocó y Listo después. */
function marcarFila(listo: HTMLElement, deps: DepsDelCelular, hecho: boolean): void {
  listo.textContent = hecho ? `✓ ${deps.tx("cpListo")}` : deps.tx("cpAbrir");
  listo.classList.toggle("cmp-hecho", hecho);
}

function pintarPaso(raiz: HTMLElement, deps: DepsDelCelular, paso: PasoDeCampana, indice: number): void {
  if (paso.tipo === "texto") {
    const fila = document.createElement("div");
    fila.className = "cmp-paso cmp-paso-texto";
    parrafo(fila, paso.texto[deps.idioma()]);
    raiz.append(fila);
    return;
  }
  const fila = document.createElement(paso.url ? "a" : "div");
  fila.className = "cmp-paso";
  const listo = document.createElement("span");
  listo.className = "cmp-listo";
  if (fila instanceof HTMLAnchorElement) {
    fila.href = paso.url ?? "";
    fila.target = "_blank";
    fila.rel = "noopener noreferrer";
    fila.addEventListener("click", () => {
      guardarPaso(deps, indice);
      marcarFila(listo, deps, true);
    });
    marcarFila(listo, deps, leerPaso(deps, indice));
  } else {
    // Una fila sin dirección no se toca: no dice Abrir ni Listo.
    listo.hidden = true;
  }
  const texto = document.createElement("span");
  texto.className = "cmp-paso-red";
  texto.textContent = deps.tx(CLAVES_DE_PASO[paso.tipo]);
  fila.append(texto);
  const cuenta = paso.url ? cuentaDeRed(paso.url, paso.tipo) : null;
  if (cuenta) parrafo(fila, sustituir(deps.tx("cpCuentaDeRed"), { cuenta }), "cmp-paso-cuenta");
  fila.append(listo);
  raiz.append(fila);
}

/** Cuántos pedidos se ven de entrada: el resto se pliega, para que Hola siga siendo un título, una línea y un botón. */
export const PEDIDOS_A_LA_VISTA = 3;

/** La confirmación de identidad y los pedidos de la empresa antes de anotarse. */
export function pintarHola(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: { nombre: string | null; error: MotivoDeAlta | null },
  acciones: AccionesDeHola = ACCIONES_QUIETAS,
): void {
  const raiz = seccion(raizPrincipal, "#cmp-hola", "cmp-hola cmp-dos");
  if (!raiz) return;
  const nombre = datos.nombre;
  const izq = caja("cmp-izq cmp-hero");
  titulo(izq, nombre ? sustituir(deps.tx("cpHola"), { nombre }) : deps.tx("cpHolaSolo"));
  parrafo(izq, deps.tx(nombre ? "cpRevisamosNombre" : "cpRevisamosSinNombre"), "cmp-apoyo");
  // Cambiar de cuenta es un enlace chico arriba, lejos del pulgar y del botón: un toque corrido no cierra la sesión.
  // Con una cuenta que no sirve para este sorteo, cambiarla es lo único que ayuda: pasa a ser el botón principal.
  const cuentaNoSirve = datos.error === "solo-google" || datos.error === "sesion";
  if (!cuentaNoSirve) {
    const otraCuenta = nombre ? sustituir(deps.tx("cpNoSoy"), { nombre }) : deps.tx("cpOtraCuenta");
    const salir = boton(izq, otraCuenta, "cmp-otra-cuenta", acciones.alSalir);
    salir.disabled = acciones.anotando === true;
  }
  raiz.append(izq);
  // Una campaña sin pedidos no deja un título vacío: el saludo ocupa el alto.
  if (deps.campana.pasos.length > 0) {
    const der = caja("cmp-der");
    titulo(der, sustituir(deps.tx("cpPasosT"), { empresa: deps.campana.empresa.nombre }), "h2");
    const pasos = caja("cmp-pasos");
    const aparte = deps.campana.pasos.length > PEDIDOS_A_LA_VISTA;
    deps.campana.pasos.slice(0, PEDIDOS_A_LA_VISTA).forEach((paso, indice) => pintarPaso(pasos, deps, paso, indice));
    der.append(pasos);
    if (aparte) {
      // Los pedidos que sobran quedan plegados, con el índice de siempre: lo que ya se tocó sigue marcado.
      const mas = document.createElement("details");
      mas.className = "cmp-mas-pedidos";
      const resumen = document.createElement("summary");
      resumen.className = "cmp-suave";
      resumen.textContent = sustituir(deps.tx("cpMasPedidos"), { n: String(deps.campana.pasos.length - PEDIDOS_A_LA_VISTA) });
      mas.append(resumen);
      const resto = caja("cmp-pasos");
      deps.campana.pasos.forEach((paso, indice) => {
        if (indice >= PEDIDOS_A_LA_VISTA) pintarPaso(resto, deps, paso, indice);
      });
      mas.append(resto);
      der.append(mas);
    }
    raiz.append(der);
  }
  pintarReglas(raiz, deps);
  const accion = caja("cmp-accion");
  raiz.append(accion);
  if (datos.error) parrafo(accion, textoDeErrorDeAlta(deps, datos.error), "cmp-error");
  if (cuentaNoSirve) {
    boton(accion, deps.tx("cpOtraCuenta"), "primary", acciones.alSalir);
    return;
  }
  const acepto = boton(
    accion,
    deps.tx(acciones.anotando ? "cpAnotando" : "cpAcepto"),
    "primary",
    acciones.alAnotar,
  );
  acepto.disabled = acciones.anotando === true;
  if (acciones.tardando) parrafo(accion, deps.tx("cpTerminandoDeEntrar"), "cmp-apoyo");
}

/** La espera dentro de la lista. Solo la línea de fase se anuncia cuando cambia. */
export function pintarAdentro(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: { ya: boolean; total: number; fase: Fase; cierraMs: number },
): void {
  const raiz = seccion(raizPrincipal, "#cmp-adentro", "cmp-adentro cmp-dos");
  if (!raiz) return;
  const idioma = deps.idioma();
  const izq = caja("cmp-izq cmp-hero");
  // Es la pantalla que queda abierta una hora: arriba dice de quién es el sorteo y qué se sortea.
  izq.append(rotulosChicos([
    sustituir(deps.tx("cpTitulo"), { empresa: deps.campana.empresa.nombre }),
    premiosTexto(deps.campana.premios, idioma),
  ]));
  izq.append(marcaDeTilde());
  titulo(izq, deps.tx(datos.ya ? "cpYaEstabas" : "cpAdentro"));
  const contador = parrafo(izq, "", "cmp-contador");
  conDestacado(contador, deps.tx(datos.total === 1 ? "cpEnLaLista1" : "cpEnLaListaN"), "n", String(datos.total), "cmp-numero");
  const der = caja("cmp-der");
  const horas = caja("cmp-horas");
  const claveFase = datos.fase === "abierta" ? "cpCierraA" : datos.fase === "cerrada" ? "cpYaCerro" : "cpSellada";
  const fase = parrafo(horas, "", "cmp-celda");
  conDestacado(fase, deps.tx(claveFase), "hora", horaTexto(datos.cierraMs, deps.campana.zona, idioma), "cmp-hora");
  fase.id = "cmp-fase";
  fase.setAttribute("aria-live", "polite");
  const sorteo = parrafo(horas, "", "cmp-celda");
  conDestacado(sorteo, deps.tx("cpSorteoA"), "hora", horaTexto(deps.campana.sorteoMs, deps.campana.zona, idioma), "cmp-hora");
  der.append(horas);
  parrafo(der, deps.tx("cpDejaAbierta"), "cmp-apoyo");
  raiz.append(izq, der);
  pintarReglas(raiz, deps);
}

/** El resultado favorable y el camino para recibir el primer premio. */
export function pintarGano(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: { avisado: boolean; comprobante: string | null; comprobado?: "esta" | "no-esta" | null },
): void {
  const raiz = seccion(raizPrincipal, "#cmp-estado", "cmp-estado cmp-gano cmp-dos");
  if (!raiz) return;
  const izq = caja("cmp-izq cmp-hero");
  izq.append(marcaDeTilde());
  titulo(izq, deps.tx("cpGanaste"));
  const premio = premiosTexto(deps.campana.premios.slice(0, 1), deps.idioma());
  parrafo(izq, sustituir(deps.tx("cpPremioDe"), {
    premio,
    empresa: deps.campana.empresa.nombre,
  }), "cmp-premio-resultado");
  // La comprobación que el celular hizo por su cuenta, de la que sale la lista sellada de la red.
  if (datos.comprobado) parrafo(izq, deps.tx(datos.comprobado === "esta" ? "cpMiSelloEsta" : "cpMiSelloNo"), "cmp-apoyo");
  // El enlace para ver cómo se eligió va al pie del bloque, y el cartel del stand arriba del bloque.
  if (datos.comprobante) enlaceComprobante(izq, deps, datos.comprobante);
  if (datos.avisado) {
    const der = caja("cmp-der");
    parrafo(der, deps.tx("cpTeEsperan"), "cmp-cartel");
    raiz.append(der);
  }
  raiz.append(izq);
  const accion = caja("cmp-accion");
  raiz.append(accion);
  parrafo(accion, deps.tx("cpParaRecibir"), "cmp-apoyo");
  boton(accion, deps.tx("cpRecibir"), "primary", deps.recibir);
}

/** Las líneas de un aviso grande, con el botón de abajo cuando hay un comprobante para ver. */
function pintarResultado(
  raizPrincipal: HTMLElement,
  clase: string,
  lineas: { titulo: string; rotulos?: string[]; apoyo: string[]; nota?: string; problema?: boolean },
  accion: { texto: string; enlace: string } | null,
): void {
  const raiz = seccion(raizPrincipal, "#cmp-estado", `${clase} cmp-solo`);
  if (!raiz) return;
  const hero = caja(lineas.problema ? "cmp-izq cmp-hero cmp-alerta" : "cmp-izq cmp-hero");
  if (lineas.rotulos) hero.append(rotulosChicos(lineas.rotulos));
  hero.append(llama());
  titulo(hero, lineas.titulo);
  for (const linea of lineas.apoyo) parrafo(hero, linea, "cmp-apoyo");
  if (lineas.nota) parrafo(hero, lineas.nota, "cmp-apoyo");
  raiz.append(hero);
  if (!accion) return;
  const barra = caja("cmp-accion");
  const enlace = document.createElement("a");
  enlace.className = "primary";
  enlace.href = accion.enlace;
  enlace.textContent = accion.texto;
  barra.append(enlace);
  raiz.append(barra);
}

/** El resultado cuando la cuenta de este celular no fue elegida. */
export function pintarOtra(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: { comprobante: string | null; comprobado?: "esta" | "no-esta" | null },
): void {
  pintarResultado(
    raizPrincipal,
    "cmp-estado cmp-otra",
    {
      titulo: deps.tx("cpOtraPersona"),
      apoyo: [deps.tx("cpGracias")],
      nota: datos.comprobado ? deps.tx(datos.comprobado === "esta" ? "cpMiSelloEsta" : "cpMiSelloNo") : undefined,
    },
    datos.comprobante ? { texto: deps.tx("cpComoSeEligio"), enlace: datos.comprobante } : null,
  );
}

/** La salida de la lista siempre explica el motivo que informó la sala. */
export function pintarSalio(raizPrincipal: HTMLElement, deps: DepsDelCelular, motivo: MotivoDeSalida): void {
  pintarResultado(raizPrincipal, "cmp-estado cmp-salio", {
    titulo: deps.tx("cpSaliste"),
    apoyo: [
      sustituir(deps.tx("cpTeSacaron"), { motivo: deps.tx(CLAVES_DE_SALIDA[motivo]) }),
      deps.tx("cpSiFueError"),
    ],
    problema: true,
  }, null);
}

/**
 * El cierre conserva lo que este celular llegó a saber del resultado. Quien ganó sigue viendo que ganó y puede
 * recibir su premio: la campaña terminó, pero el premio se recibe aunque ya no esté en el stand.
 */
export function pintarTermino(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  memoria: MemoriaDeCampana | null,
): void {
  if (memoria?.resultado === "gano") {
    pintarGano(raizPrincipal, deps, { avisado: false, comprobante: memoria.comprobante });
    return;
  }
  const apoyo = memoria?.resultado === "otra"
    ? [deps.tx("cpOtraPersona"), deps.tx("cpGracias")]
    : [deps.tx("cpPreguntaEnStand")];
  const comprobante = memoria?.resultado && memoria.comprobante ? memoria.comprobante : null;
  pintarResultado(
    raizPrincipal,
    "cmp-estado cmp-termino",
    {
      titulo: deps.tx("cpTermino"),
      rotulos: [sustituir(deps.tx("cpTitulo"), { empresa: deps.campana.empresa.nombre })],
      apoyo,
    },
    comprobante ? { texto: deps.tx("cpComoSeEligio"), enlace: comprobante } : null,
  );
}
