/** Pantallas de quien ya entró: solo pintan los datos recibidos y avisan las acciones de la persona. */

import { horaTexto, premiosTexto } from "./formato";
import type { ComprobacionDelSello } from "./comprobar";
import type { MemoriaDeCampana } from "./memoria";
import type { PasoDeCampana, TipoDePaso } from "./modelo";
import { caja, conDestacado, llama, marcaDeTilde, rotulosChicos } from "./piezas";
import { pintarReglas, sustituir } from "./previa";
import type { DepsDelCelular, Fase, MotivoDeAlta, MotivoDeSalida } from "./celular";
import type { VarianteDeGanaste } from "./premio";

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
  // El texto del límite lo trae `limite.ts` (con los segundos); sin él, la línea de siempre.
  limite: "cpErrGoogle",
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
  /** Anotarse aunque la cuenta ya se haya usado en otro navegador. Solo con el aviso a la vista y el botón principal cambiado. */
  alAnotarIgual?: () => void;
  alSalir: () => void;
  anotando?: boolean;
  tardando?: boolean;
}

const ACCIONES_QUIETAS: AccionesDeHola = {
  alAnotar: () => undefined,
  alSalir: () => undefined,
};

export function seccion(raiz: HTMLElement, selector: string, clase: string): HTMLElement | null {
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

export function titulo(raiz: HTMLElement, texto: string, nivel: "h1" | "h2" = "h1"): void {
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
export function textoDeErrorDeAlta(deps: DepsDelCelular, motivo: MotivoDeAlta, textoDelLimite?: string): string {
  // El límite del servicio de cuentas dice cuánto hay que esperar.
  if (motivo === "limite" && textoDelLimite) return textoDelLimite;
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
  datos: {
    nombre: string | null;
    error: MotivoDeAlta | null;
    /** Con el límite del servicio de cuentas, la línea con los segundos que faltan (ya escrita, de `limite.ts`). */
    textoDelLimite?: string;
    /**
     * La cuenta ya se usó en otro navegador y desde acá no hay forma de entrar: se avisa arriba, antes de anotarse.
     * `principal`: el botón principal ya pasó a ser Usar otra cuenta (no pasa mientras alguien toca la pantalla).
     */
    otroLado?: { principal: boolean } | null;
  },
  acciones: AccionesDeHola = ACCIONES_QUIETAS,
): void {
  const raiz = seccion(raizPrincipal, "#cmp-hola", "cmp-hola cmp-dos");
  if (!raiz) return;
  const nombre = datos.nombre;
  const izq = caja("cmp-izq cmp-hero");
  if (datos.otroLado) {
    // El aviso entra arriba del saludo. Se anuncia solo (role status) y no cambia ningún botón de lugar.
    const bloque = caja("cmp-otro-lado");
    bloque.setAttribute("role", "status");
    parrafo(bloque, deps.tx("cpOtroLadoT"), "cmp-otro-lado-t");
    parrafo(bloque, deps.tx("cpOtroLado"));
    izq.append(bloque);
  }
  titulo(izq, nombre ? sustituir(deps.tx("cpHola"), { nombre }) : deps.tx("cpHolaSolo"));
  parrafo(izq, deps.tx(nombre ? "cpRevisamosNombre" : "cpRevisamosSinNombre"), "cmp-apoyo");
  // Cambiar de cuenta es un enlace chico arriba, lejos del pulgar y del botón: un toque corrido no cierra la sesión.
  // Con una cuenta que no sirve para este sorteo, cambiarla es lo único que ayuda: pasa a ser el botón principal.
  const cuentaNoSirve = datos.error === "solo-google" || datos.error === "sesion";
  const cambiarEsLoPrincipal = cuentaNoSirve || datos.otroLado?.principal === true;
  if (!cambiarEsLoPrincipal) {
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
  if (datos.error) parrafo(accion, textoDeErrorDeAlta(deps, datos.error, datos.textoDelLimite), "cmp-error");
  if (cambiarEsLoPrincipal) {
    boton(accion, deps.tx("cpOtraCuenta"), "primary", acciones.alSalir);
    // Con una cuenta usada en otro navegador, anotarse igual sigue a mano, del alto de un botón pero sin ser la principal.
    if (!cuentaNoSirve) boton(accion, deps.tx("cpAnotarmeIgual"), "cmp-anotarme-igual", acciones.alAnotarIgual ?? acciones.alAnotar);
    return;
  }
  const acepto = boton(
    accion,
    deps.tx(acciones.anotando ? "cpAnotando" : "cpAcepto"),
    "primary",
    acciones.alAnotar,
  );
  acepto.disabled = acciones.anotando === true;
  // Anotando con la ruedita: el botón apagado no se confunde con uno que no responde.
  if (acciones.anotando) acepto.setAttribute("aria-busy", "true");
  if (acciones.tardando) parrafo(accion, deps.tx("cpTerminandoDeEntrar"), "cmp-apoyo");
}

/** Sin una respuesta buena de la sala en tanto tiempo, la señal deja de decir Al día y pasa a buscar la conexión. */
export const SIN_RESPUESTA_MS = 75_000;
/** Cada cuánto la señal mira si ya pasó ese tiempo. No consulta nada: solo compara horas. */
export const REVISION_DE_LA_SENAL_MS = 5_000;
/** Lo que dura el latido de la señal cada vez que la sala contesta. */
const LATIDO_MS = 1_200;

type EstadoDeLaSenal = "al-dia" | "buscando";

/** Escribe lo que dice la señal. El texto va en su propio elemento y la señal entera queda fuera de los lectores de pantalla. */
function ponerLaSenal(senal: HTMLElement, deps: DepsDelCelular, estado: EstadoDeLaSenal): void {
  senal.dataset.estado = estado;
  const texto = senal.querySelector<HTMLElement>(".cmp-al-dia-texto");
  if (texto) texto.textContent = deps.tx(estado === "al-dia" ? "cpAlDia" : "cpBuscandoConexion");
}

/**
 * La sala contestó bien: la señal vuelve a Al día y el punto late una vez. Con movimiento reducido no late (la hoja de
 * estilos tampoco lo anima). No repinta nada y no toca el resto de la pantalla.
 */
export function latirAlDia(raizPrincipal: HTMLElement, deps: DepsDelCelular): void {
  const senal = raizPrincipal.querySelector<HTMLElement>("#cmp-adentro .cmp-al-dia");
  if (!senal) return;
  ponerLaSenal(senal, deps, "al-dia");
  if (deps.movimientoReducido()) return;
  senal.classList.remove("cmp-late");
  // Leer el alto fuerza al navegador a empezar la animación de nuevo aunque la clase ya estuviera puesta.
  void senal.offsetWidth;
  senal.classList.add("cmp-late");
  window.setTimeout(() => senal.classList.remove("cmp-late"), LATIDO_MS);
}

/**
 * El número de personas cambió y lo demás no: se escribe el número nuevo en el mismo lugar, sin repintar la pantalla, y
 * sube una vez como en la pantalla de antes de anotarse. Devuelve si había contador a la vista.
 */
export function actualizarElContador(raizPrincipal: HTMLElement, deps: DepsDelCelular, total: number): boolean {
  const contador = raizPrincipal.querySelector<HTMLElement>("#cmp-adentro .cmp-contador");
  if (!contador) return false;
  conDestacado(contador, deps.tx(total === 1 ? "cpEnLaLista1" : "cpEnLaListaN"), "n", String(total), "cmp-numero");
  if (!deps.movimientoReducido()) {
    contador.classList.remove("sube");
    void contador.offsetWidth;
    contador.classList.add("sube");
    window.setTimeout(() => contador.classList.remove("sube"), 400);
  }
  return true;
}

/**
 * La espera dentro de la lista. Solo la línea de fase se anuncia cuando cambia.
 *
 * Devuelve cómo apagar lo que dejó andando: el reloj de la señal de conexión.
 * `respuestaDesde` dice desde cuándo la sala contesta bien (la última respuesta buena o la vuelta a la pestaña, lo que
 * sea más nuevo): sin ella la señal siempre dice Al día. `salta` hace saltar la línea de fase una vez, porque cambió con
 * la pantalla abierta. `libre` usa la línea de quien no tiene nada que hacer con su cuenta, y `otroLado` la de una cuenta
 * que ya se usó en otro navegador.
 */
export function pintarAdentro(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: {
    ya: boolean;
    total: number;
    fase: Fase;
    cierraMs: number;
    libre?: boolean;
    /** La cuenta ya se usó en otro navegador: la línea de apoyo lo dice y avisa que quizás haya que recibir el premio allá. */
    otroLado?: boolean;
    /**
     * La tarjeta Confirmar mi correo está a la vista y dice su propia línea: la espera no pone la de apoyo, y las reglas
     * del sorteo van en el pie, debajo de la tarjeta, para que la línea quede pegada a su botón.
     */
    conTarjeta?: boolean;
    salta?: boolean;
    respuestaDesde?: () => number;
  },
): () => void {
  const raiz = seccion(raizPrincipal, "#cmp-adentro", "cmp-adentro cmp-dos");
  if (!raiz) return () => undefined;
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
  // La línea de fase cambió con la pantalla abierta: salta una vez, como la tilde, para que se note sin anunciar de más.
  if (datos.salta && !deps.movimientoReducido()) fase.classList.add("cmp-salta");
  const sorteo = parrafo(horas, "", "cmp-celda");
  conDestacado(sorteo, deps.tx("cpSorteoA"), "hora", horaTexto(deps.campana.sorteoMs, deps.campana.zona, idioma), "cmp-hora");
  der.append(horas);
  // La señal de que la página sigue al día con la sala. No se anuncia: la que se anuncia es la línea de fase.
  const senal = document.createElement("p");
  senal.className = "cmp-al-dia";
  senal.setAttribute("aria-hidden", "true");
  const punto = document.createElement("span");
  punto.className = "cmp-punto";
  const textoDeLaSenal = document.createElement("span");
  textoDeLaSenal.className = "cmp-al-dia-texto";
  senal.append(punto, textoDeLaSenal);
  der.append(senal);
  const sinRespuesta = (): boolean => datos.respuestaDesde !== undefined && deps.ahora() - datos.respuestaDesde() > SIN_RESPUESTA_MS;
  ponerLaSenal(senal, deps, sinRespuesta() ? "buscando" : "al-dia");
  if (!datos.conTarjeta) parrafo(der, deps.tx(datos.otroLado ? "cpOtroLadoAdentro" : datos.libre ? "cpDejaAbiertaLibre" : "cpDejaAbierta"), "cmp-apoyo");
  raiz.append(izq, der);
  const pie = datos.conTarjeta ? raizPrincipal.querySelector<HTMLElement>("#cmp-pie") : null;
  if (pie) {
    pie.replaceChildren();
    pie.hidden = false;
  }
  pintarReglas(pie ?? raiz, deps);
  // Con la pestaña escondida nadie la ve y la página no consulta: no se cambia nada hasta que vuelva.
  return deps.cada(() => {
    if (deps.visible() && sinRespuesta() && senal.dataset.estado !== "buscando") ponerLaSenal(senal, deps, "buscando");
  }, REVISION_DE_LA_SENAL_MS);
}

/**
 * El resultado favorable y el camino para recibir el primer premio. La línea de siempre pide dejar la cuenta lista; con la
 * variante de `premio.ts` (cuando la cuenta de este navegador es de las que cambian algo) dice lo que de verdad corresponde, y
 * con una cuenta que se usó en otro navegador la principal pasa a llevar el enlace allá y Recibir queda de texto.
 */
export function pintarGano(
  raizPrincipal: HTMLElement,
  deps: DepsDelCelular,
  datos: { avisado: boolean; comprobante: string | null; variante?: VarianteDeGanaste | null; comprobado?: ComprobacionDelSello },
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
  // El enlace para ver cómo se eligió va al pie del bloque, y el cartel del stand arriba del bloque.
  if (datos.comprobante) enlaceComprobante(izq, deps, datos.comprobante);
  if (datos.avisado) {
    const der = caja("cmp-der");
    parrafo(der, deps.tx("cpTeEsperan"), "cmp-cartel");
    raiz.append(der);
  }
  raiz.append(izq);
  ponerElSello(raizPrincipal, deps, datos.comprobado ?? null);
  const accion = caja("cmp-accion");
  raiz.append(accion);
  parrafo(accion, datos.variante?.linea ?? deps.tx("cpParaRecibir"), "cmp-apoyo");
  const llevar = datos.variante?.llevar;
  if (!llevar) {
    boton(accion, deps.tx("cpRecibir"), "primary", deps.recibir);
    return;
  }
  boton(accion, llevar.texto, "primary", () => llevar.alHacer(accion));
  boton(accion, deps.tx("cpRecibir"), "cmp-de-texto", deps.recibir);
}

/** Las líneas de un aviso grande, con el botón de abajo cuando hay un comprobante para ver. */
function pintarResultado(
  raizPrincipal: HTMLElement,
  clase: string,
  lineas: { titulo: string; rotulos?: string[]; apoyo: string[]; problema?: boolean },
  accion: { texto: string; enlace: string } | null,
): void {
  const raiz = seccion(raizPrincipal, "#cmp-estado", `${clase} cmp-solo`);
  if (!raiz) return;
  const hero = caja(lineas.problema ? "cmp-izq cmp-hero cmp-alerta" : "cmp-izq cmp-hero");
  if (lineas.rotulos) hero.append(rotulosChicos(lineas.rotulos));
  hero.append(llama());
  titulo(hero, lineas.titulo);
  for (const linea of lineas.apoyo) parrafo(hero, linea, "cmp-apoyo");
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
  datos: { comprobante: string | null; comprobado?: ComprobacionDelSello },
): void {
  pintarResultado(
    raizPrincipal,
    "cmp-estado cmp-otra",
    { titulo: deps.tx("cpOtraPersona"), apoyo: [deps.tx("cpGracias")] },
    datos.comprobante ? { texto: deps.tx("cpComoSeEligio"), enlace: datos.comprobante } : null,
  );
  ponerElSello(raizPrincipal, deps, datos.comprobado ?? null);
}

/**
 * La línea de la comprobación propia del sello, puesta en el bloque del resultado que ya está a la vista. No repinta nada:
 * el festejo, el título y el botón siguen como estaban. Con `null` no hace nada.
 */
export function ponerElSello(raizPrincipal: HTMLElement, deps: DepsDelCelular, dicho: ComprobacionDelSello): void {
  // Solo se dice lo que se comprobó a favor: no hay línea para nada más.
  if (dicho !== "esta") return;
  const bloque = raizPrincipal.querySelector<HTMLElement>("#cmp-estado .cmp-izq");
  if (!bloque) return;
  let linea = bloque.querySelector<HTMLElement>(":scope > .cmp-sello");
  if (!linea) {
    linea = document.createElement("p");
    linea.className = "cmp-apoyo cmp-sello";
    linea.setAttribute("role", "status");
    // En Ganaste va antes del enlace para ver cómo se eligió, que cierra el bloque.
    const enlace = bloque.querySelector(":scope > a");
    if (enlace) enlace.before(linea);
    else bloque.append(linea);
  }
  linea.textContent = deps.tx("cpMiSelloEsta");
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
