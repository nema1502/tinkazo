/**
 * La página para armar una campaña: seis pasos con botones, la vista en vivo del celular de la gente y la descarga. Todo sale
 * del formulario (`estado.ts`) y de sus acciones: este archivo solo dibuja y reparte lo que pasa. Nada se firma ni se guarda
 * en un servidor: lo cargado vive en este navegador, y la activación es de Tinkazo.
 */

import type { Lang } from "../../idioma";
import { network } from "../../stellar/config";
import type { ValidacionDeCampana } from "../../sala/validar-campana";
import { fechaTexto, horaTexto, premiosTexto } from "../formato";
import type { ColorDeCampana, TipoDePaso } from "../modelo";
import { sustituir } from "../sustituir";
import { PANTALLAS, VISTA_LISTA, VISTA_PREVIA, type MensajeDeVista, type PantallaDeVista } from "../vista-protocolo";
import {
  armarCampana,
  cambioUnaActivada,
  campanaParaLaVista,
  faltaDeTamano,
  faltas,
  faltasDelPaso,
  formularioDesdeTexto,
  lecturaDelPedido,
  pasoDelFallo,
  sigueIgualQueElFirmado,
  type Falta,
} from "./armar";
import { basesAutomaticas, basesFinales, type DatosDeLasBases } from "./bases";
import { UNIDADES_POR_DOLAR } from "./constantes";
import { costoDeLaCampana, type ComisionDeLaCampana } from "./costo";
import {
  CLAVE_DE_GUARDADO,
  COLORES_EN_ORDEN,
  MAXIMO_DEL_LUGAR,
  MAXIMO_DEL_NOMBRE,
  MAXIMO_DEL_PEDIDO,
  MONTOS,
  OTRO_MONTO,
  formularioDeDemostracion,
  formularioInicial,
  leerGuardado,
  reducir,
  type Accion,
  type FormularioDeCampana,
  type NumeroDePaso,
} from "./estado";
import { hoyEn, instantesDe, nombreCortoDeZona, sumarDias } from "./horas";
import { blobDeLogo, type LogoAchicado } from "./logo";
import { TIPOS_EN_ORDEN, TOPE_DE_PEDIDOS } from "./redes";

/** Lo que la página necesita de afuera: todo se inyecta para probarla sin navegador de verdad. */
export interface DepsDelCreador {
  /** El texto de una clave en el idioma de la página. */
  tx: (clave: string) => string;
  /** El texto de una clave en un idioma (las bases salen en los dos). */
  dic: (idioma: Lang, clave: string) => string;
  idioma: () => Lang;
  ahora: () => number;
  zona: string;
  /** Donde se guarda lo cargado, o null si el navegador no deja. */
  almacen: Storage | null;
  demo: boolean;
  sufijo: () => string;
  achicar: (archivo: Blob, o: { blanco: boolean }) => Promise<LogoAchicado | null>;
  leerArchivo: (archivo: Blob) => Promise<string>;
  validar: (texto: string, ahora: number) => Promise<ValidacionDeCampana>;
  descargar: (nombre: string, texto: string) => void;
  /** Compartir un archivo con la hoja del sistema, si el navegador sabe hacerlo. */
  compartir: { puede: (archivo: File) => boolean; enviar: (archivo: File) => Promise<boolean> } | null;
  costo: (idioma: Lang) => string | null;
  /** El origen con que se habla con la vista. */
  origen: string;
  /** El tema forzado por la dirección de la página, para que la vista lo repita. */
  tema: string | null;
  /** Lo que cobra Tinkazo por activar la campaña. Hoy no se cobra: sin esto, el resumen no tiene renglón de comisión. */
  comision?: ComisionDeLaCampana | null;
  /** Agenda un envío al próximo cuadro: varios cambios en el mismo cuadro salen en un solo mensaje. */
  cuadro: (f: () => void) => void;
  /** Espera antes de guardar: devuelve cómo cancelar. */
  esperar: (f: () => void, ms: number) => () => void;
  /** Mide la caja del marco y avisa la escala cada vez que cambia. Devuelve cómo dejar de medir. */
  escala: (caja: HTMLElement, alCambiar: (escala: number) => void) => () => void;
}

export interface Creador {
  /** Dibuja todo de nuevo (por ejemplo al cambiar el idioma). */
  pintar: () => void;
  /** El formulario de ahora, para las pruebas. */
  formulario: () => FormularioDeCampana;
  desmontar: () => void;
}

/** El celular de la vista mide 390 por 844 y se escala para caber en la caja del marco. */
export const ANCHO_DEL_CELULAR = 390;
export const ALTO_DEL_CELULAR = 844;
export const ESCALA_MAXIMA = 1.25;

/** La escala con que el celular de 390 por 844 cabe en una caja. */
export function escalaDelCelular(ancho: number, alto: number): number {
  if (!(ancho > 0) || !(alto > 0)) return 1;
  return Math.min(ancho / ANCHO_DEL_CELULAR, alto / ALTO_DEL_CELULAR, ESCALA_MAXIMA);
}

/** Qué pestaña de la vista acompaña a cada paso, y si el plegado de reglas se muestra abierto. */
export function pestanaDelPaso(paso: NumeroDePaso): { pantalla: PantallaDeVista; reglasAbiertas: boolean } {
  if (paso === 4) return { pantalla: "hola", reglasAbiertas: false };
  return { pantalla: "previa", reglasAbiertas: paso === 5 };
}

export type IdDeAccionFinal = "descargar" | "compartir" | "correo" | "activar";
export interface AccionFinal {
  id: IdDeAccionFinal;
  principal: boolean;
}

/**
 * Los botones del último paso, en orden, con uno solo principal. Antes de bajar la campaña el principal es bajarla, y después
 * es mandarla. Activar es una acción más con la misma campaña armada: hoy no se ofrece, y el día que se ofrezca es el principal.
 */
export function accionesDelFinal(c: { compartir: boolean; activar: boolean; descargada: boolean }): AccionFinal[] {
  const alternativa: AccionFinal = c.compartir ? { id: "compartir", principal: false } : { id: "correo", principal: false };
  if (c.activar) return [{ id: "activar", principal: true }, { id: "descargar", principal: false }];
  if (c.descargada && c.compartir) {
    return [{ id: "compartir", principal: true }, { id: "descargar", principal: false }, { id: "correo", principal: false }];
  }
  return [{ id: "descargar", principal: true }, alternativa];
}

const CLAVE_DE_PASO = ["ccPaso1", "ccPaso2", "ccPaso3", "ccPaso4", "ccPaso5", "ccPaso6"] as const;
const CLAVE_DE_COLOR: Record<ColorDeCampana, string> = {
  rojo: "ccColorRojo",
  naranja: "ccColorNaranja",
  amarillo: "ccColorAmarillo",
  verde: "ccColorVerde",
  azul: "ccColorAzul",
  morado: "ccColorMorado",
};
const CLAVE_DE_RED: Record<TipoDePaso, string> = {
  instagram: "ccRedInstagram",
  tiktok: "ccRedTiktok",
  x: "ccRedX",
  youtube: "ccRedYoutube",
  facebook: "ccRedFacebook",
  whatsapp: "ccRedWhatsapp",
  enlace: "ccRedEnlace",
  texto: "ccRedTexto",
};
const CLAVE_DE_PESTANA: Record<PantallaDeVista, string> = {
  previa: "ccTabEscanear",
  hola: "ccTabPedidos",
  adentro: "ccTabAnotada",
  ganaste: "ccTabGano",
};
const CORREO_DE_CONTACTO = "hola@tinkazo.app";
const MS_DE_ESPERA_PARA_GUARDAR = 300;
const FONDO_CLARO = "#ffffff";
const FONDO_OSCURO = "#1b1530";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, clase = "", texto = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto) e.textContent = texto;
  return e;
}

/** El formulario guardado en este navegador, o null: todo con try, porque el almacenamiento puede no estar. */
function leerDelAlmacen(almacen: Storage | null): FormularioDeCampana | null {
  try {
    return leerGuardado(almacen?.getItem(CLAVE_DE_GUARDADO) ?? null);
  } catch {
    return null;
  }
}

export function montarCreador(raiz: HTMLElement, deps: DepsDelCreador): Creador {
  const { tx } = deps;
  const fmt = (clave: string, valores: Record<string, string> = {}): string => sustituir(tx(clave), valores);
  const manana = (): string => sumarDias(hoyEn(deps.ahora(), deps.zona), 1);
  let f: FormularioDeCampana = deps.demo
    ? formularioDeDemostracion(manana(), deps.zona)
    : leerDelAlmacen(deps.almacen) ?? formularioInicial(deps.zona, deps.sufijo());
  let pestanaManual: PantallaDeVista | null = null;
  let festejar = false;
  let faltaVisible: Falta | null = null;
  let aviso = "";
  let descargada: string | null = null;
  let idiomaDeBases: Lang = deps.idioma();
  let confirmandoBorrar = false;
  let verOtroDia = false;
  let vistaAbierta = false;
  let preparandoLogo = false;
  let logoFallo = false;
  let logoOriginal: Blob | null = null;
  let revisados = new Set<number>();
  let envioAgendado = false;
  let cancelarGuardado: (() => void) | null = null;
  let pendienteDeGuardar = false;
  let desmontado = false;

  /* --- lo que se calcula del formulario --- */

  const datosDeLasBases = (g: FormularioDeCampana): DatosDeLasBases => ({
    marca: g.nombre.trim() || tx("ccMuestraMarca"),
    ganan: g.ganan,
    monto: g.monto ?? 40,
    sorteoMs: instantesDe(g)?.sorteoMs ?? deps.ahora() + 4 * 3_600_000,
    zona: g.zona,
    conRedes: g.pasos.length > 0,
    costo: { es: deps.costo("es"), en: deps.costo("en") },
  });
  const automaticasDe = (g: FormularioDeCampana): { es: string; en: string } => basesAutomaticas(datosDeLasBases(g), deps.dic);
  const faltasDe = (): Falta[] => faltas(f, deps.ahora(), automaticasDe(f));
  const premios = (): bigint[] => Array.from({ length: f.ganan }, () => BigInt(f.monto ?? 40) * UNIDADES_POR_DOLAR);

  /* --- guardar lo cargado --- */

  function guardarYa(): void {
    cancelarGuardado?.();
    cancelarGuardado = null;
    if (!pendienteDeGuardar || deps.demo) return;
    pendienteDeGuardar = false;
    try {
      deps.almacen?.setItem(CLAVE_DE_GUARDADO, JSON.stringify(f));
    } catch {
      /* sin almacenamiento la página sigue: solo no recuerda */
    }
  }

  function guardarPronto(): void {
    if (deps.demo) return;
    pendienteDeGuardar = true;
    cancelarGuardado?.();
    cancelarGuardado = deps.esperar(guardarYa, MS_DE_ESPERA_PARA_GUARDAR);
  }

  const alOcultar = (): void => {
    if (document.visibilityState === "hidden") guardarYa();
  };
  window.addEventListener("pagehide", guardarYa);
  document.addEventListener("visibilitychange", alOcultar);

  /* --- la vista en vivo --- */

  const iframe = el("iframe");
  iframe.id = "ccp-vista";
  iframe.title = tx("ccVistaTitulo");
  // Solo se repiten los dos temas que existen: lo demás de la dirección de esta página no pasa a la del marco.
  const temaDeLaVista = deps.tema === "light" || deps.tema === "dark" ? deps.tema : null;
  iframe.src = `/participar.html?vista=previa&lang=${deps.idioma()}${temaDeLaVista ? `&theme=${temaDeLaVista}` : ""}`;

  const pestanaActual = (): PantallaDeVista => pestanaManual ?? pestanaDelPaso(f.paso).pantalla;

  function construirMensaje(): MensajeDeVista {
    const bases = basesFinales(f.bases, automaticasDe(f)).bases;
    const { campana, muestras } = campanaParaLaVista(f, {
      ahora: deps.ahora(),
      muestraMarca: tx("ccMuestraMarca"),
      muestraLugar: { es: deps.dic("es", "ccMuestraLugar"), en: deps.dic("en", "ccMuestraLugar") },
      bases,
    });
    const reglasAbiertas = pestanaManual === null && pestanaDelPaso(f.paso).reglasAbiertas;
    const mensaje: MensajeDeVista = {
      t: VISTA_PREVIA,
      campana,
      pantalla: pestanaActual(),
      idioma: deps.idioma(),
      muestras,
      festejar,
      reglasAbiertas,
    };
    festejar = false;
    return mensaje;
  }

  function enviarAVista(): void {
    if (desmontado) return;
    try {
      iframe.contentWindow?.postMessage(construirMensaje(), deps.origen);
    } catch {
      /* un marco que ya salió de la página no tiene a quién escribirle */
    }
  }

  function agendarEnvio(): void {
    if (envioAgendado) return;
    envioAgendado = true;
    deps.cuadro(() => {
      envioAgendado = false;
      enviarAVista();
    });
  }

  const alRecibir = (e: MessageEvent): void => {
    const datos: unknown = e.data;
    const dicho = typeof datos === "object" && datos !== null ? (datos as { t?: unknown }).t : null;
    if (e.source !== iframe.contentWindow || e.origin !== deps.origen || dicho !== VISTA_LISTA) return;
    enviarAVista();
  };
  window.addEventListener("message", alRecibir);

  /* --- las piezas fijas --- */

  raiz.replaceChildren();
  const columna = el("div", "ccp-col");
  const arriba = el("nav", "ccp-arriba");
  const seccion = el("section", "ccp-paso");
  const barra = el("div", "ccp-accion");
  columna.append(arriba, seccion, barra);
  const vista = el("aside", "ccp-vista");
  const barraDeVista = el("div", "ccp-vista-barra");
  const volver = el("button", "ccp-volver", "");
  volver.type = "button";
  const pestanas = el("div", "ccp-pestanas");
  const caja = el("div", "ccp-caja");
  const marco = el("div", "ccp-marco");
  marco.append(iframe);
  caja.append(marco);
  barraDeVista.append(volver, pestanas);
  vista.append(barraDeVista, caja);
  const entradaDeArchivo = el("input");
  entradaDeArchivo.type = "file";
  entradaDeArchivo.accept = ".json,.txt,application/json,text/plain";
  entradaDeArchivo.hidden = true;
  entradaDeArchivo.id = "ccp-abrir-archivo";
  raiz.append(columna, vista, entradaDeArchivo);
  const dejarDeMedir = deps.escala(caja, (escala) => caja.style.setProperty("--ccp-escala", String(escala)));

  /* --- ayudas de dibujo --- */

  function boton(texto: string, clase: string, alTocar: () => void, id = ""): HTMLButtonElement {
    const b = el("button", clase, texto);
    b.type = "button";
    if (id) b.id = id;
    b.addEventListener("click", alTocar);
    return b;
  }

  function contador(valor: number, alBajar: () => void, alSubir: () => void, ids: { menos: string; mas: string; numero: string }): HTMLElement {
    const fila = el("div", "ccp-contador");
    const menos = boton("−", "ccp-paso-contador", alBajar, ids.menos);
    menos.setAttribute("aria-label", tx("ccMenos"));
    const numero = el("output", "ccp-numero", String(valor));
    numero.id = ids.numero;
    const mas = boton("+", "ccp-paso-contador", alSubir, ids.mas);
    mas.setAttribute("aria-label", tx("ccMasUno"));
    fila.append(menos, numero, mas);
    return fila;
  }

  function campo(rotulo: string, id: string, control: HTMLElement): HTMLElement {
    const bloque = el("div", "ccp-campo");
    const etiqueta = el("label", "ccp-rotulo", rotulo);
    etiqueta.htmlFor = id;
    bloque.append(etiqueta, control);
    return bloque;
  }

  function entrada(id: string, valor: string, maximo: number, alEscribir: (v: string) => void, tipo = "text"): HTMLInputElement {
    const i = el("input", "ccp-entrada");
    i.id = id;
    i.type = tipo;
    i.value = valor;
    if (maximo > 0) i.maxLength = maximo;
    i.addEventListener("input", () => alEscribir(i.value));
    return i;
  }

  /** Dibuja de nuevo conservando el control con el foco y el lugar del cursor. */
  function conservarFoco(dibujar: () => void): void {
    const activo = document.activeElement;
    const id = activo instanceof HTMLElement ? activo.id : "";
    const campoDeTexto = activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement ? activo : null;
    const [desde, hasta] = [campoDeTexto?.selectionStart ?? null, campoDeTexto?.selectionEnd ?? null];
    dibujar();
    if (!id) return;
    const nuevo = document.getElementById(id);
    if (!(nuevo instanceof HTMLElement)) return;
    nuevo.focus();
    if (nuevo instanceof HTMLInputElement && desde !== null && hasta !== null && nuevo.type === "text") nuevo.setSelectionRange(desde, hasta);
  }

  /** El botón que abre la vista a pantalla completa en el celular. En la laptop la vista ya está al lado y no se muestra. */
  function botonVerVista(): HTMLButtonElement {
    return boton(tx("ccVerComoQueda"), "ccp-secundario ccp-ver-vista", () => {
      vistaAbierta = true;
      pintarVista();
      // La columna del botón se oculta: el foco pasa a la vista para que el teclado y el lector de pantalla no se pierdan.
      volver.focus();
    }, "ccp-ver-vista");
  }

  /** Lleva un aviso a la vista sin tapar lo de arriba: la barra de abajo se descuenta con scroll-padding en la hoja. */
  function llevarALaVista(aviso: HTMLElement): void {
    if (typeof aviso.scrollIntoView === "function") aviso.scrollIntoView({ block: "nearest" });
  }

  /** El campo de hora con el error que se muestra, o null: ese error se dice debajo de las horas y no en la barra. */
  function horaConError(): string | null {
    const donde = faltaVisible?.paso === 3 ? faltaVisible.donde : undefined;
    return donde === "ccp-abre" || donde === "ccp-cierra" || donde === "ccp-sorteo" ? donde : null;
  }

  /** Suma un pedido de esa red, lo lleva a la vista y deja el cursor en su campo para pegar el enlace. */
  function agregarRed(tipo: TipoDePaso): void {
    cambiar({ t: "sumar-paso", tipo });
    const nuevo = document.getElementById(`ccp-pedido-${f.pasos.length - 1}`);
    if (!(nuevo instanceof HTMLElement)) return;
    nuevo.focus({ preventScroll: true });
    llevarALaVista(nuevo.closest("li") ?? nuevo);
  }

  /* --- arriba: en qué paso está --- */

  function pintarArriba(): void {
    arriba.replaceChildren();
    arriba.setAttribute("aria-label", fmt("ccPasoDe", { n: String(f.paso) }));
    const pasos = el("ol", "ccp-circulos");
    for (const n of [1, 2, 3, 4, 5, 6] as const) {
      const li = el("li", "ccp-circulo-item");
      const visitado = n <= f.visitado;
      const b = boton(String(n), "ccp-circulo", () => ir(n), `ccp-ir-${n}`);
      b.disabled = !visitado;
      b.setAttribute("aria-label", `${n}. ${tx(CLAVE_DE_PASO[n - 1] ?? "ccPaso1")}`);
      if (n === f.paso) b.setAttribute("aria-current", "step");
      b.classList.toggle("ccp-actual", n === f.paso);
      li.append(b);
      pasos.append(li);
    }
    const dicho = el("span", "ccp-paso-de", fmt("ccPasoDe", { n: String(f.paso) }));
    const mas = el("details", "ccp-mas");
    const resumen = el("summary", "ccp-mas-boton");
    resumen.setAttribute("aria-label", tx("navMas"));
    resumen.title = tx("navMas");
    resumen.textContent = "⋯";
    mas.append(resumen);
    const lista = el("div", "ccp-mas-lista");
    lista.append(
      boton(tx("ccAbrir"), "ccp-enlace", () => entradaDeArchivo.click(), "ccp-abrir"),
      boton(tx("ccBajarLoQueLlevo"), "ccp-enlace", bajarLoQueLlevo, "ccp-bajar-borrador"),
    );
    const terminos = el("a", "ccp-enlace", tx("navTerminos"));
    terminos.href = "/terminos.html";
    terminos.id = "ccp-terminos";
    if (confirmandoBorrar) {
      const pregunta = el("div", "ccp-confirmar");
      pregunta.append(
        el("p", "ccp-linea", tx("ccEmpezarSeguro")),
        boton(tx("ccSiBorrar"), "ccp-enlace", empezarDeNuevo, "ccp-si-borrar"),
        boton(tx("ccCancelar"), "ccp-enlace", () => {
          confirmandoBorrar = false;
          pintarArriba();
        }),
      );
      lista.append(pregunta);
      mas.open = true;
    } else {
      lista.append(
        boton(tx("ccEmpezar"), "ccp-enlace", () => {
          confirmandoBorrar = true;
          pintarArriba();
        }, "ccp-empezar"),
      );
    }
    lista.append(terminos);
    mas.append(lista);
    arriba.append(dicho, pasos, mas);
  }

  /* --- los pasos --- */

  function paso1(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    b.append(
      campo(tx("ccNombre"), "ccp-nombre", entrada("ccp-nombre", f.nombre, MAXIMO_DEL_NOMBRE, (v) => cambiar({ t: "nombre", valor: v }, false))),
    );
    (b.querySelector("#ccp-nombre") as HTMLInputElement).autocomplete = "organization";
    const logo = el("div", "ccp-logo");
    const archivo = el("input");
    archivo.type = "file";
    archivo.accept = "image/*";
    archivo.hidden = true;
    archivo.id = "ccp-logo-archivo";
    archivo.addEventListener("change", () => {
      const elegido = archivo.files?.[0];
      if (elegido) void subirLogo(elegido);
      archivo.value = "";
    });
    logo.append(archivo);
    if (f.logo) {
      const claro = el("div", "ccp-logo-fondo ccp-logo-claro");
      const oscuro = el("div", "ccp-logo-fondo ccp-logo-oscuro");
      claro.style.background = FONDO_CLARO;
      oscuro.style.background = FONDO_OSCURO;
      for (const fondo of [claro, oscuro]) {
        const imagen = el("img", "ccp-logo-miniatura");
        imagen.alt = fondo === claro ? f.nombre : "";
        imagen.src = ["data:", f.logo.tipo, ";base64,", f.logo.datos].join("");
        fondo.append(imagen);
      }
      const blanco = boton(tx("ccLogoBlanco"), "ccp-secundario", () => void ponerFondoBlanco(), "ccp-logo-blanco");
      blanco.setAttribute("aria-pressed", String(f.blanco));
      blanco.disabled = f.blanco && logoOriginal === null;
      logo.append(
        claro,
        oscuro,
        boton(tx("ccLogoOtro"), "ccp-secundario", () => archivo.click(), "ccp-logo-otro"),
        blanco,
        boton(tx("ccQuitar"), "ccp-enlace", () => {
          logoOriginal = null;
          cambiar({ t: "logo", valor: null, blanco: false });
        }, "ccp-logo-quitar"),
      );
    } else {
      logo.append(boton(tx("ccLogo"), "ccp-secundario ccp-logo-subir", () => archivo.click(), "ccp-logo-subir"));
    }
    const estadoDelLogo = el("p", "ccp-linea ccp-logo-estado", preparandoLogo ? tx("ccLogoPreparando") : logoFallo ? tx("ccLogoNo") : "");
    estadoDelLogo.setAttribute("role", "status");
    logo.append(estadoDelLogo);
    b.append(logo);
    const colores = el("div", "ccp-colores");
    colores.setAttribute("role", "group");
    colores.setAttribute("aria-label", tx("ccColor"));
    for (const c of COLORES_EN_ORDEN) {
      const boton1 = boton("", "ccp-color", () => cambiar({ t: "color", valor: c }), `ccp-color-${c}`);
      boton1.style.background = `var(--cmp-${c})`;
      boton1.setAttribute("aria-label", tx(CLAVE_DE_COLOR[c]));
      boton1.setAttribute("aria-pressed", String(f.color === c));
      colores.append(boton1);
    }
    b.append(colores);
    if (f.nombre === "" && f.logo === null && f.monto === null && f.pasos.length === 0 && f.origen === null) {
      b.append(boton(tx("ccYaTenes"), "ccp-enlace ccp-ya-tengo", () => entradaDeArchivo.click(), "ccp-ya-tengo"));
    }
    return b;
  }

  function paso2(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    b.append(el("p", "ccp-rotulo", tx("ccCadaUno")));
    const montos = el("div", "ccp-montos");
    for (const m of MONTOS) {
      const boton1 = boton(String(m), "ccp-monto", () => cambiar({ t: "monto", valor: m }), `ccp-monto-${m}`);
      boton1.setAttribute("aria-pressed", String(!f.otroMonto && f.monto === m));
      montos.append(boton1);
    }
    const otro = boton(tx("ccOtroMonto"), "ccp-monto", () => cambiar({ t: "otro-monto" }), "ccp-otro");
    otro.setAttribute("aria-pressed", String(f.otroMonto));
    montos.append(otro);
    b.append(montos);
    if (f.otroMonto) {
      const filaOtro = el("div", "ccp-otro-fila");
      filaOtro.append(
        contador(
          f.monto ?? OTRO_MONTO.inicial,
          () => cambiar({ t: "otro-menos" }),
          () => cambiar({ t: "otro-mas" }),
          { menos: "ccp-otro-menos", mas: "ccp-otro-mas", numero: "ccp-otro-numero" },
        ),
        el("span", "ccp-unidad", tx("ccDolares")),
      );
      b.append(filaOtro);
    }
    const cuantos = el("div", "ccp-campo");
    cuantos.append(
      el("p", "ccp-rotulo", tx("ccCuantos")),
      contador(
        f.ganan,
        () => cambiar({ t: "ganan-menos" }),
        () => cambiar({ t: "ganan-mas" }),
        { menos: "ccp-ganan-menos", mas: "ccp-ganan-mas", numero: "ccp-ganan-numero" },
      ),
    );
    b.append(cuantos);
    const resumen = el("p", f.monto === null ? "ccp-premio ccp-muestra" : "ccp-premio", premiosTexto(premios(), deps.idioma()));
    resumen.id = "ccp-premio";
    resumen.setAttribute("aria-live", "polite");
    b.append(resumen);
    if (f.monto !== null) {
      const costo = costoDeLaCampana({ premios: { monto: f.monto, ganan: f.ganan }, comision: null });
      b.append(
        el("p", "ccp-total", fmt("ccTotal", { total: String(costo.premios), n: String(f.ganan), monto: String(f.monto) })),
      );
    }
    return b;
  }

  function paso3(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    const hoy = hoyEn(deps.ahora(), deps.zona);
    const otroDia = verOtroDia || (f.fecha !== "" && f.fecha !== hoy && f.fecha !== manana());
    const dias = el("div", "ccp-dias");
    dias.setAttribute("role", "group");
    dias.setAttribute("aria-label", tx("ccDia"));
    const opciones: Array<[string, string, string, boolean]> = [
      ["ccp-hoy", tx("ccHoy"), hoy, f.fecha === hoy && !otroDia],
      ["ccp-manana", tx("ccManana"), manana(), f.fecha === manana() && !otroDia],
    ];
    for (const [id, texto, valor, activo] of opciones) {
      const boton1 = boton(texto, "ccp-monto ccp-dia", () => {
        verOtroDia = false;
        cambiar({ t: "fecha", valor, ahora: deps.ahora() });
      }, id);
      boton1.setAttribute("aria-pressed", String(activo));
      dias.append(boton1);
    }
    const otro = boton(tx("ccOtroDia"), "ccp-monto ccp-dia", () => {
      verOtroDia = true;
      pintarPaso();
    }, "ccp-otro-dia");
    otro.setAttribute("aria-pressed", String(otroDia));
    dias.append(otro);
    b.append(dias);
    if (otroDia) {
      const dia = entrada("ccp-dia", f.fecha, 0, () => undefined, "date");
      dia.min = hoy;
      dia.addEventListener("change", () => cambiar({ t: "fecha", valor: dia.value, ahora: deps.ahora() }));
      b.append(campo(tx("ccDia"), "ccp-dia", dia));
    }
    const t = instantesDe(f);
    const malaHora = horaConError();
    const horas = el("div", "ccp-horas");
    const hora = (cual: "abre" | "cierra" | "sorteo", clave: string, masUno: boolean): HTMLElement => {
      const i = entrada(`ccp-${cual}`, f[cual], 0, () => undefined, "time");
      i.step = "300";
      if (malaHora === `ccp-${cual}`) i.setAttribute("aria-invalid", "true");
      i.addEventListener("change", () => cambiar({ t: "hora", cual, valor: i.value }));
      const bloque = campo(tx(clave), `ccp-${cual}`, i);
      if (masUno && malaHora !== `ccp-${cual}`) bloque.append(el("span", "ccp-mas-un-dia", tx("ccMasUnDia")));
      return bloque;
    };
    horas.append(
      hora("abre", "ccAbre", false),
      hora("cierra", "ccCierra", t?.cierraMasUno === true),
      hora("sorteo", "ccSorteo", t?.sorteoMasUno === true),
    );
    b.append(horas);
    if (malaHora !== null && faltaVisible) {
      const error = el("p", "ccp-error ccp-error-hora", fmt(faltaVisible.clave, faltaVisible.valores ?? {}));
      error.setAttribute("role", "alert");
      b.append(error);
    }
    b.append(el("p", "ccp-linea ccp-zona", fmt("ccZona", { zona: nombreCortoDeZona(f.zona) })));
    b.append(campo(tx("ccLugar"), "ccp-lugar", entrada("ccp-lugar", f.lugar, MAXIMO_DEL_LUGAR, (v) => cambiar({ t: "lugar", valor: v }, false))));
    return b;
  }

  /** Lo que dice debajo de una fila de pedido: por qué no sirve, o el enlace que quedó para poder abrirlo. */
  function pintarAvisoDeFila(indice: number, destino: HTMLElement): void {
    destino.replaceChildren();
    const p = f.pasos[indice];
    const entradaDeFila = document.getElementById(`ccp-pedido-${indice}`);
    entradaDeFila?.removeAttribute("aria-invalid");
    if (!p || p.tipo === "texto" || p.url.trim() === "") return;
    const lectura = lecturaDelPedido(f, p.tipo, p.url);
    if (lectura.ok) {
      const enlace = el("a", "ccp-probar", `${tx("ccProbarEnlace")} ${lectura.url.replace(/^https:\/\//u, "")}`);
      enlace.href = lectura.url;
      enlace.target = "_blank";
      enlace.rel = "noopener noreferrer";
      destino.append(enlace);
      return;
    }
    if (!revisados.has(indice)) return;
    const clave = lectura.motivo === "otra-red" ? "ccEnlaceOtraRed" : lectura.motivo === "corto" ? "ccEnlaceCorto" : "ccEnlaceMal";
    const error = el("p", "ccp-error", fmt(clave, { red: tx(CLAVE_DE_RED[p.tipo]) }));
    destino.append(error);
    entradaDeFila?.setAttribute("aria-invalid", "true");
    llevarALaVista(error);
  }

  function fila(indice: number): HTMLElement {
    const p = f.pasos[indice];
    const li = el("li", "ccp-fila");
    if (!p) return li;
    const id = `ccp-pedido-${indice}`;
    const cabeza = el("div", "ccp-fila-cabeza");
    const quitar = boton(tx("ccQuitar"), "ccp-enlace", () => {
      revisados = new Set();
      cambiar({ t: "quitar-paso", indice });
    }, `ccp-quitar-${indice}`);
    cabeza.append(el("span", "ccp-fila-nombre", tx(CLAVE_DE_RED[p.tipo])), quitar);
    li.append(cabeza);
    if (p.tipo === "texto") {
      const idioma = deps.idioma();
      const otro: Lang = idioma === "es" ? "en" : "es";
      const escribir = (cual: Lang) => (v: string): void => cambiar({ t: "paso-texto", indice, idioma: cual, valor: v }, false);
      const principal = entrada(id, p.texto[idioma], MAXIMO_DEL_PEDIDO, escribir(idioma));
      principal.placeholder = tx("ccEscribiPedido");
      li.append(principal);
      const plegado = el("details", "ccp-plegado");
      plegado.append(el("summary", "ccp-plegado-titulo", tx(otro === "es" ? "ccEnEspanol" : "ccEnIngles")));
      plegado.append(entrada(`${id}-${otro}`, p.texto[otro], MAXIMO_DEL_PEDIDO, escribir(otro)));
      li.append(plegado);
      return li;
    }
    const campoDeEnlace = entrada(id, p.url, 0, () => undefined);
    campoDeEnlace.inputMode = "url";
    campoDeEnlace.autocapitalize = "none";
    campoDeEnlace.autocomplete = "off";
    campoDeEnlace.spellcheck = false;
    campoDeEnlace.placeholder = tx("ccPegaEnlace");
    campoDeEnlace.setAttribute("aria-label", `${tx(CLAVE_DE_RED[p.tipo])}. ${tx("ccPegaEnlace")}`);
    const avisoDeFila = el("div", "ccp-fila-aviso");
    avisoDeFila.id = `ccp-aviso-${indice}`;
    campoDeEnlace.addEventListener("input", () => {
      cambiar({ t: "paso-url", indice, valor: campoDeEnlace.value }, false);
      pintarAvisoDeFila(indice, avisoDeFila);
    });
    campoDeEnlace.addEventListener("blur", () => {
      revisados.add(indice);
      pintarAvisoDeFila(indice, avisoDeFila);
    });
    li.append(campoDeEnlace, avisoDeFila);
    pintarAvisoDeFila(indice, avisoDeFila);
    return li;
  }

  function paso4(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    b.append(el("p", "ccp-linea", tx("ccRedesLinea")));
    const agregar = el("div", "ccp-montos ccp-agregar");
    const lleno = f.pasos.length >= TOPE_DE_PEDIDOS;
    for (const tipo of TIPOS_EN_ORDEN) {
      const sumar = boton(tx(CLAVE_DE_RED[tipo]), "ccp-monto ccp-red", () => agregarRed(tipo), `ccp-sumar-${tipo}`);
      sumar.disabled = lleno;
      sumar.setAttribute("aria-pressed", String(f.pasos.some((p) => p.tipo === tipo)));
      agregar.append(sumar);
    }
    b.append(agregar);
    if (lleno) b.append(el("p", "ccp-linea", tx("ccTope")));
    const lista = el("ol", "ccp-filas");
    f.pasos.forEach((_, i) => lista.append(fila(i)));
    b.append(lista);
    return b;
  }

  function paso5(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    b.append(el("p", "ccp-linea", tx("ccBasesLinea")));
    const automaticas = automaticasDe(f);
    const { bases, desfasadas } = basesFinales(f.bases, automaticas);
    if (desfasadas) {
      const avisoDeBases = el("div", "ccp-desfasadas");
      avisoDeBases.append(
        el("p", "ccp-error", tx("ccBasesCambiaron")),
        boton(tx("ccRehacer"), "ccp-secundario", () => cambiar({ t: "rehacer-bases" }), "ccp-rehacer"),
        boton(tx("ccDejarlas"), "ccp-secundario", () => cambiar({ t: "dejar-bases", automaticas }), "ccp-dejarlas"),
      );
      b.append(avisoDeBases);
    }
    const idiomas = el("div", "ccp-montos ccp-pestanas-bases");
    for (const l of ["es", "en"] as const) {
      const pestana = boton(tx(l === "es" ? "ccEnEspanol" : "ccEnIngles"), "ccp-monto ccp-dia", () => {
        idiomaDeBases = l;
        pintarPaso();
      }, `ccp-bases-${l}`);
      pestana.setAttribute("aria-pressed", String(idiomaDeBases === l));
      idiomas.append(pestana);
    }
    const area = el("textarea", "ccp-bases");
    area.id = "ccp-bases";
    area.maxLength = 6000;
    area.rows = 10;
    area.value = bases[idiomaDeBases];
    area.addEventListener("input", () => cambiar({ t: "bases", idioma: idiomaDeBases, valor: area.value, automaticas: automaticasDe(f) }, false));
    b.append(idiomas, area);
    return b;
  }

  /** Lo que se mira en el último paso: cuatro renglones. */
  function paso6(): HTMLElement {
    const b = el("div", "ccp-cuerpo");
    const idioma = deps.idioma();
    const t = instantesDe(f);
    const nombre = el("div", "ccp-resumen ccp-resumen-marca");
    if (f.logo) {
      const logo = el("img", "ccp-logo-chico");
      logo.alt = "";
      logo.src = ["data:", f.logo.tipo, ";base64,", f.logo.datos].join("");
      nombre.append(logo);
    }
    nombre.append(el("strong", "", f.nombre.trim()));
    const premio = el("div", "ccp-resumen");
    premio.append(el("strong", "", premiosTexto(premios(), idioma)));
    if (f.monto !== null) {
      const costo = costoDeLaCampana({ premios: { monto: f.monto, ganan: f.ganan }, comision: deps.comision ?? null });
      premio.append(el("span", "ccp-total", fmt("ccTotal", { total: String(costo.premios), n: String(f.ganan), monto: String(f.monto) })));
      if (costo.comision !== null) {
        const renglon = (clave: string, valor: number): HTMLElement => el("span", "ccp-total", `${tx(clave)}: ${valor} ${tx("ccDolares")}`);
        premio.append(renglon("ccCostoComision", costo.comision), renglon("ccCostoTotal", costo.total));
      }
    }
    const cuando = el("div", "ccp-resumen");
    if (t) {
      const valores = {
        fecha: fechaTexto(t.abreMs, f.zona, idioma),
        abre: horaTexto(t.abreMs, f.zona, idioma),
        cierra: horaTexto(t.cierraMs, f.zona, idioma),
        sorteo: horaTexto(t.sorteoMs, f.zona, idioma),
      };
      cuando.append(el("span", "", fmt("ccResumenCuando", valores)));
    }
    const pedidos = f.pasos.length;
    const clavePedidos = pedidos === 0 ? "ccResumenPedidos0" : pedidos === 1 ? "ccResumenPedidos1" : "ccResumenPedidosN";
    const lugar = el("div", "ccp-resumen", fmt(clavePedidos, { lugar: f.lugar.trim(), n: String(pedidos) }));
    b.append(nombre, premio, cuando, lugar, botonVerVista());
    return b;
  }

  /* --- el armado y la descarga --- */

  /** El archivo armado con lo cargado, o null si todavía falta algo. */
  function armadoDeAhora(): { archivo: Record<string, unknown>; texto: string } | null {
    if (faltasDe().length > 0) return null;
    const { bases } = basesFinales(f.bases, automaticasDe(f));
    const archivo = armarCampana(f, { bases });
    return { archivo, texto: JSON.stringify(archivo) };
  }

  /** Lo que se baja: la campaña activada tal como estaba si no cambió nada, y si no la nueva, legible. */
  function contenidoDelArchivo(archivo: Record<string, unknown>): string {
    if (f.origen?.firma && sigueIgualQueElFirmado(f, archivo)) return JSON.stringify({ texto: f.origen.texto, firma: f.origen.firma });
    return JSON.stringify(archivo, null, 2);
  }

  function puedeCompartir(): boolean {
    try {
      return deps.compartir?.puede(new File(["x"], "campana.txt", { type: "text/plain" })) === true;
    } catch {
      return false;
    }
  }

  function enfocarTitulo(): void {
    document.getElementById("ccp-titulo")?.focus({ preventScroll: true });
  }

  /** Muestra una falta: lleva al paso, dice qué es y deja el foco en el control. */
  function mostrar(falta: Falta): void {
    if (falta.paso !== f.paso) cambiar({ t: "ir", paso: falta.paso });
    faltaVisible = falta;
    if (falta.paso === 4) revisados = new Set(f.pasos.map((_, i) => i));
    pintarPaso();
    pintarAccion();
    const destino = document.getElementById(falta.donde ?? "") ?? document.getElementById("ccp-hoy");
    destino?.setAttribute("aria-invalid", "true");
    destino?.focus();
    const errorDeHora = document.querySelector<HTMLElement>(".ccp-error-hora");
    if (errorDeHora) llevarALaVista(errorDeHora);
  }

  async function descargarCampana(): Promise<void> {
    const primera = faltasDe()[0];
    if (primera) return mostrar(primera);
    const hecho = armadoDeAhora();
    if (!hecho) return;
    const validacion = await deps.validar(hecho.texto, deps.ahora());
    if (desmontado) return;
    if (!validacion.ok) {
      const paso = pasoDelFallo(validacion.campo, f.logo !== null);
      const mal: Falta = paso === 6 ? { paso, clave: "ccNoSalio" } : { paso, clave: "ccRevisaPaso", valores: { n: String(paso) } };
      return mostrar(mal);
    }
    const grande = await faltaDeTamano(hecho.texto, hecho.archivo);
    if (grande) return mostrar(grande);
    const nombre = `${String(hecho.archivo.evento)}.json`;
    deps.descargar(nombre, contenidoDelArchivo(hecho.archivo));
    descargada = nombre;
    faltaVisible = null;
    pintarAccion();
  }

  async function compartirCampana(): Promise<void> {
    const hecho = armadoDeAhora();
    if (!hecho || !deps.compartir) return;
    // Android no comparte un .json: se comparte el mismo contenido como texto plano.
    const archivo = new File([contenidoDelArchivo(hecho.archivo)], `${String(hecho.archivo.evento)}.txt`, { type: "text/plain" });
    try {
      await deps.compartir.enviar(archivo);
    } catch {
      /* quien cierra la hoja de compartir no es un error */
    }
  }

  function enlaceDeCorreo(): string {
    const evento = armadoDeAhora()?.archivo.evento;
    const asunto = fmt("ccCorreoAsunto", { evento: typeof evento === "string" ? evento : "" });
    return `mailto:${CORREO_DE_CONTACTO}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(tx("ccCorreoCuerpo"))}`;
  }

  /* --- el logo --- */

  async function subirLogo(archivo: Blob): Promise<void> {
    preparandoLogo = true;
    logoFallo = false;
    pintarPaso();
    const logo = await deps.achicar(archivo, { blanco: f.blanco });
    if (desmontado) return;
    preparandoLogo = false;
    if (logo) {
      logoOriginal = archivo;
      cambiar({ t: "logo", valor: logo, blanco: f.blanco });
      return;
    }
    logoFallo = true;
    pintarPaso();
  }

  /** Vuelve a dibujar el logo con o sin fondo blanco. Sin el original (se recargó la página) solo se puede poner. */
  async function ponerFondoBlanco(): Promise<void> {
    const nuevo = !f.blanco;
    const fuente = logoOriginal ?? (nuevo && f.logo ? blobDeLogo(f.logo) : null);
    if (!fuente) {
      // Un logo guardado que ya no se puede leer no deja el botón mudo: se dice que no se pudo.
      if (nuevo && f.logo) {
        logoFallo = true;
        pintarPaso();
      }
      return;
    }
    preparandoLogo = true;
    pintarPaso();
    const logo = await deps.achicar(fuente, { blanco: nuevo });
    if (desmontado) return;
    preparandoLogo = false;
    if (logo) {
      cambiar({ t: "logo", valor: logo, blanco: nuevo });
      return;
    }
    logoFallo = true;
    pintarPaso();
  }

  /* --- abrir, bajar lo que llevo y empezar de nuevo --- */

  async function abrirArchivo(archivo: Blob): Promise<void> {
    let texto = "";
    try {
      texto = await deps.leerArchivo(archivo);
    } catch {
      texto = "";
    }
    if (desmontado) return;
    const opciones = { zonaDelNavegador: deps.zona, red: network.name, sufijo: deps.sufijo(), automaticas: automaticasDe };
    const hecho = formularioDesdeTexto(texto, opciones);
    // Un borrador a medio armar que se bajó con Bajar lo que llevo no es una campaña completa: se abre en su paso.
    const abierto = hecho.ok ? hecho.formulario : leerGuardado(texto);
    if (!abierto) {
      aviso = tx("ccNoEsCampana");
      pintarAccion();
      return;
    }
    logoOriginal = null;
    revisados = new Set();
    confirmandoBorrar = false;
    cambiar({ t: "abrir", estado: abierto });
  }

  function bajarLoQueLlevo(): void {
    deps.descargar(`campana-${f.sufijo}.txt`, JSON.stringify(f, null, 2));
  }

  function empezarDeNuevo(): void {
    try {
      deps.almacen?.removeItem(CLAVE_DE_GUARDADO);
    } catch {
      /* sin almacenamiento no hay nada que borrar */
    }
    logoOriginal = null;
    revisados = new Set();
    confirmandoBorrar = false;
    const nuevo = deps.demo ? formularioDeDemostracion(manana(), deps.zona) : formularioInicial(deps.zona, deps.sufijo());
    cambiar({ t: "abrir", estado: nuevo });
    // Lo recién borrado no se vuelve a guardar hasta que haya algo nuevo que guardar.
    cancelarGuardado?.();
    cancelarGuardado = null;
    pendienteDeGuardar = false;
  }

  /* --- la barra de abajo --- */

  function pintarAccion(): void {
    barra.replaceChildren();
    const lineas = el("div", "ccp-lineas");
    lineas.setAttribute("role", "status");
    lineas.setAttribute("aria-live", "polite");
    const dicho: Array<{ texto: string; error: boolean }> = [];
    if (faltaVisible && horaConError() === null) {
      const valores = { ...(faltaVisible.valores ?? {}) };
      if (valores.red) valores.red = tx(CLAVE_DE_RED[valores.red as TipoDePaso]);
      dicho.push({ texto: fmt(faltaVisible.clave, valores), error: true });
    }
    if (aviso) dicho.push({ texto: aviso, error: false });
    if (f.paso === 6) {
      const armado = armadoDeAhora();
      const t = instantesDe(f);
      if (armado && cambioUnaActivada(f, armado.archivo)) dicho.push({ texto: tx("ccCambiaste"), error: false });
      // Una sola línea en el último paso: qué falta para que esté activa, y después de bajarla qué hacer con ella.
      // Si hay un error a la vista, el error es la línea: no se le suma otra.
      const hayError = dicho.some((d) => d.error);
      if (!hayError && descargada) dicho.push({ texto: tx("ccDescargada"), error: false });
      else if (!hayError && t) dicho.push({ texto: fmt("ccListoLinea", { abre: horaTexto(t.abreMs, f.zona, deps.idioma()) }), error: false });
    }
    for (const linea of dicho) lineas.append(el("p", linea.error ? "ccp-error" : "ccp-linea", linea.texto));
    barra.append(lineas);
    // Los botones van apilados: el principal arriba y a lo ancho, y debajo Ver cómo queda o su alternativa.
    const fila = el("div", "ccp-botones");
    if (f.paso < 6) {
      fila.append(boton(tx("ccSeguir"), "primary", seguirPaso, "ccp-seguir"), botonVerVista());
      barra.append(fila);
      return;
    }
    let correo: HTMLAnchorElement | null = null;
    const acciones = accionesDelFinal({ compartir: puedeCompartir(), activar: false, descargada: descargada !== null });
    for (const accion of acciones) {
      const clase = accion.principal ? "primary" : "ccp-secundario";
      if (accion.id === "descargar") fila.append(boton(tx("ccDescargar"), clase, () => void descargarCampana(), "ccp-descargar"));
      if (accion.id === "compartir") fila.append(boton(tx("ccCompartir"), clase, () => void compartirCampana(), "ccp-compartir"));
      if (accion.id === "correo") {
        correo = el("a", "ccp-enlace ccp-correo", tx("ccEscribinos"));
        correo.id = "ccp-correo";
        correo.href = enlaceDeCorreo();
      }
    }
    barra.append(fila);
    if (correo) barra.append(correo);
  }

  function seguirPaso(): void {
    const falta = faltasDelPaso(f, f.paso, deps.ahora(), automaticasDe(f))[0];
    if (falta) {
      mostrar(falta);
      return;
    }
    cambiar({ t: "seguir" });
    enfocarTitulo();
  }

  /* --- la vista --- */

  function pintarPestanas(): void {
    // Las pestañas se dibujan de nuevo al tocarlas: el foco vuelve a la que tenía.
    conservarFoco(() => {
      pestanas.replaceChildren();
      for (const pantalla of PANTALLAS) {
        const b = boton(tx(CLAVE_DE_PESTANA[pantalla]), "ccp-pestana", () => {
          pestanaManual = pantalla;
          festejar = pantalla === "ganaste";
          pintarPestanas();
          agendarEnvio();
        }, `ccp-tab-${pantalla}`);
        b.setAttribute("aria-pressed", String(pestanaActual() === pantalla));
        pestanas.append(b);
      }
      volver.textContent = tx("ccCerrarVista");
    });
  }

  /** La vista a pantalla completa es un diálogo: la columna de los pasos queda inerte mientras está abierta. */
  function pintarVista(): void {
    vista.classList.toggle("ccp-vista-abierta", vistaAbierta);
    columna.classList.toggle("ccp-oculta", vistaAbierta);
    columna.toggleAttribute("inert", vistaAbierta);
    if (vistaAbierta) {
      vista.setAttribute("role", "dialog");
      vista.setAttribute("aria-modal", "true");
      vista.setAttribute("aria-label", tx("ccVistaTitulo"));
      return;
    }
    vista.removeAttribute("role");
    vista.removeAttribute("aria-modal");
    vista.removeAttribute("aria-label");
  }

  /** Cierra la vista y le devuelve el foco al botón que la abrió. */
  function cerrarVista(): void {
    vistaAbierta = false;
    pintarVista();
    document.getElementById("ccp-ver-vista")?.focus();
  }

  volver.addEventListener("click", cerrarVista);

  /** Con la vista abierta, Escape la cierra y Tab no sale de ella hacia lo que quedó detrás. */
  const alTocarTecla = (e: KeyboardEvent): void => {
    if (!vistaAbierta) return;
    if (e.key === "Escape") {
      e.preventDefault();
      cerrarVista();
      return;
    }
    if (e.key !== "Tab") return;
    const botones = [...vista.querySelectorAll<HTMLButtonElement>("button")];
    const primero = botones[0];
    const ultimo = botones[botones.length - 1];
    if (!primero || !ultimo) return;
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || !vista.contains(activo))) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && (activo === ultimo || !vista.contains(activo))) {
      e.preventDefault();
      primero.focus();
    }
  };
  document.addEventListener("keydown", alTocarTecla);

  /* --- el dibujo de todo --- */

  function pintarPaso(): void {
    conservarFoco(() => {
      seccion.replaceChildren();
      const titulo = el("h1", "ccp-titulo", tx(CLAVE_DE_PASO[f.paso - 1] ?? "ccPaso1"));
      titulo.id = "ccp-titulo";
      titulo.tabIndex = -1;
      const cuerpo = [paso1, paso2, paso3, paso4, paso5, paso6][f.paso - 1]?.() ?? el("div");
      seccion.append(titulo, cuerpo);
      const montos = seccion.querySelector<HTMLElement>(".ccp-montos:not(.ccp-agregar):not(.ccp-pestanas-bases)");
      if (montos) {
        montos.id = "ccp-monto";
        montos.tabIndex = -1;
      }
    });
  }

  function pintarTodo(): void {
    pintarArriba();
    pintarPaso();
    pintarAccion();
    pintarPestanas();
    pintarVista();
  }

  /** Aplica una acción: guarda, avisa a la vista y dibuja. Al escribir no se dibuja el paso para no perder el teclado. */
  function cambiar(a: Accion, repintar = true): void {
    const antes = f;
    f = reducir(f, a);
    if (a.t !== "seguir" && a.t !== "ir") descargada = null;
    if (f.paso !== antes.paso || a.t === "abrir") pestanaManual = null;
    faltaVisible = null;
    aviso = a.t === "fecha" && f.abre !== antes.abre ? fmt("ccHoraAjustada", { hora: f.abre }) : "";
    if (a.t !== "ir") guardarPronto();
    agendarEnvio();
    if (repintar) pintarTodo();
    else pintarAccion();
  }

  function ir(paso: NumeroDePaso): void {
    cambiar({ t: "ir", paso });
    enfocarTitulo();
  }

  entradaDeArchivo.addEventListener("change", () => {
    const elegido = entradaDeArchivo.files?.[0];
    if (elegido) void abrirArchivo(elegido);
    entradaDeArchivo.value = "";
  });

  // La vista avisa cuando está lista y recién ahí se le manda el estado: antes de eso no hay quién escuche.
  pintarTodo();

  return {
    pintar: () => {
      iframe.title = tx("ccVistaTitulo");
      pintarTodo();
      agendarEnvio();
    },
    formulario: () => f,
    desmontar: () => {
      guardarYa();
      desmontado = true;
      window.removeEventListener("pagehide", guardarYa);
      document.removeEventListener("visibilitychange", alOcultar);
      document.removeEventListener("keydown", alTocarTecla);
      window.removeEventListener("message", alRecibir);
      dejarDeMedir();
      raiz.replaceChildren();
    },
  };
}
