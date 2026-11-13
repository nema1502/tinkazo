import "./compra-qr.css";
import { getLang, t } from "../i18n";
import { compraQrActiva } from "../stellar/alta-config";
import { montoVisible } from "../stellar/alta-oferta";
import { demoDeRampa } from "../stellar/cuenta-config";
import { type Marca, type MarcasDeOrden, anotarMarca, etapasDeCarga, leerOrden, quitarMarca } from "../stellar/rampa-pollar";
import {
  type AccionDeCompra,
  type BotonDeCompra,
  type IdDePantalla,
  type LoQueSeSabe,
  type PantallaDeCompra,
  correoDeAyuda,
  pantallaDeCompra,
} from "./compra-qr-estado";
import type { Texto } from "./cuenta-lista-estado";
import { type Dialogo, abrirDialogo, copiar, lineaDeEstado } from "./dialogo";
import { type Acompanamiento, type PantallaDeCompra as PantallaDeLaLlama, acompanar, enPantalla } from "./llama-guia";
import { avanceDeEtapa } from "./llama-guia-estado";
import { pintarQr } from "./qr";

/**
 * La ventana Tu compra: pinta la pantalla que da la máquina de la compra con QR (`compra-qr-estado.ts`) y corre cada
 * toque por un motor. El motor sabe y hace: hoy la demo (`compra-demo.ts`, con órdenes inventadas y sin red), y desde
 * el paso que conecta el kit, la billetera y el servidor. La ventana no decide nada de la compra.
 *
 * Cada pantalla: el título arriba, la llama que acompaña con la línea en su globo (la línea no se repite), los datos
 * como rótulo y valor (el monto en bolivianos grande y Tu dinero siempre a la vista desde que hay un QR), lo demás
 * plegado en Más detalles, y en el pie una sola acción principal y como mucho un enlace de texto.
 *
 * Lo que cuida la ventana misma (lo fija `compra-qr.test.ts`):
 * - Nada se abre solo y nada sigue solo: cada acción sale de un toque. Lo único que corre sin un toque es mirar, que
 *   solo lee, en las pantallas que esperan algo de afuera (la espera, la otra pestaña, el banco, el dinero en camino).
 * - Un toque cuenta si lo hizo la persona y si la principal no cambió hace menos de medio segundo: un doble toque
 *   nervioso no aprueba dos pasos. Mientras el motor trabaja, la principal queda ocupada.
 * - El QR va siempre como imagen sobre una caja blanca, nunca como marcado metido en la página.
 * - Las marcas de este navegador (se mostró el QR, se guardó, dijo que pagó) las pone la ventana: Todavía no pagué
 *   borra la de haber pagado y vuelve al mismo QR.
 * - La pestaña de la verificación se abre en blanco dentro del toque y recién después recibe su dirección. Si el
 *   navegador no la deja abrir, la principal pasa a ser el enlace.
 */

/* ================================================================== lo que la ventana le pide al motor */

export interface CampoDeDatos {
  clave: string;
  /** El rótulo en el idioma de la página, tal como lo da el servidor. */
  rotulo: string;
  tipo: "text" | "email" | "tel" | "select";
  opciones?: readonly { valor: string; rotulo: string }[];
  valor?: string;
  obligatorio?: boolean;
}

/** Lo que una pantalla muestra además de sus textos: el formulario de los datos, o una lista de solo lectura. */
export interface DetalleDePantalla {
  campos?: readonly CampoDeDatos[];
  lista?: readonly { rotulo: string; valor: string }[];
}

export interface AvisoDelMotor {
  /** Muestra lo que se sabe mientras el motor sigue trabajando (por ejemplo, Aprobando…). */
  avisar(s: LoQueSeSabe, estado?: string): void;
  /** Lo que la persona escribió en el formulario, por la clave de cada campo. */
  entrada?: Record<string, string>;
}

/** Quien sabe y hace. La ventana nunca lo llama sin un toque, salvo `mirar`, que solo lee. */
export interface MotorDeCompra {
  /** Lo que se sabe al abrir la ventana. */
  inicio(): LoQueSeSabe;
  /** Vuelve a leer lo que cambió afuera (el saldo, la cotización, la orden, el pago). No firma, no paga, no crea nada. */
  mirar(s: LoQueSeSabe): Promise<LoQueSeSabe>;
  /** Corre la acción de un toque y devuelve lo que se sabe después. */
  hacer(accion: AccionDeCompra, s: LoQueSeSabe, o: AvisoDelMotor): Promise<LoQueSeSabe>;
  /** La dirección de la verificación de identidad, para la pestaña que se abrió en blanco dentro del toque. Sin esto, no se abre ninguna pestaña. */
  verificacion?(s: LoQueSeSabe): Promise<string | null>;
  /** Los campos del formulario, los datos para confirmar o lo que recibe el proveedor, según la pantalla. */
  detalle?(s: LoQueSeSabe, p: PantallaDeCompra): DetalleDePantalla | null;
  /** Cada cuánto vuelve a mirar una pantalla que espera algo de afuera. */
  ritmoMs?: number;
  /** Se cerró la ventana: dejar de mirar. */
  cerrar?(): void;
}

/** Lo que sigue fuera de la ventana: la ventana se cierra y avisa a quien la abrió. Sortear es Armar mi primer sorteo. */
export type AccionDeAfuera = "usar-cupon" | "mandar" | "entrar" | "proteger" | "sortear";

type Almacen = Pick<Storage, "getItem" | "setItem">;

export interface OpcionesDeCompra {
  motor: MotorDeCompra;
  afuera?(accion: AccionDeAfuera, s: LoQueSeSabe): void;
  alCerrar?(s: LoQueSeSabe): void;
  /** Si se puede abrir: la compra con QR en el build, o la demo. En las pruebas, a mano. */
  permitida?: boolean;
  /** Si el toque lo hizo la persona. Por defecto, `isTrusted`. */
  confiar?(e: Event): boolean;
  /** La hora, en milisegundos. */
  reloj?(): number;
  /** Dónde guardar las marcas de las órdenes: el navegador por defecto, `null` para tenerlas solo en memoria (la demo). */
  almacen?: Almacen | null;
}

export interface VentanaDeCompra {
  card: HTMLElement;
  cerrar(): void;
  /** Lo que se sabe ahora. */
  lo(): LoQueSeSabe;
}

/* ================================================================== constantes */

/**
 * Las pantallas que esperan algo de afuera: la ventana vuelve a mirar sola, sin hacer nada. También el paso que no
 * conocemos y el QR vencido con la compra abierta: si el pago llega, se ve sin cerrar la ventana.
 */
const MIRAN_SOLAS: ReadonlySet<IdDePantalla> = new Set(["espera", "carnet-espera", "espera-pago", "camino", "pagando", "desconocido", "qr-vencido-abierta"]);
/** Lo que sigue fuera de la ventana. */
const DE_AFUERA: ReadonlySet<AccionDeCompra> = new Set(["usar-cupon", "mandar", "entrar", "proteger", "sortear"]);
/** Un toque a menos de esto de que cambió la principal no cuenta. */
const GUARDA_MS = 500;
const RITMO_MS = 10_000;
/** La primera pausa de la espera que volvió igual: se duplica en cada intento, hasta el ritmo del motor. */
const PAUSA_DE_ESPERA_MS = 500;
/** Las miradas seguidas que fallan, o que dejan la espera igual, antes de ofrecer Probar de nuevo. */
const TOPE_DE_INTENTOS = 5;
/** Lo que mide el QR del banco, en px de CSS. */
const LADO_QR = 216;
/** Lo que mide el QR del enlace de pago, plegado. */
const LADO_QR_APP = 168;

/** Cada pantalla de la ventana en la tabla de la llama que acompaña (los ids del diseño). */
const LLAMA: Record<IdDePantalla, PantallaDeLaLlama> = {
  espera: "CQ-ESPERA",
  verificar: "CQ-VERIF",
  carnet: "CQ-ID",
  "carnet-espera": "CQ-ID-ESPERA",
  "carnet-bloqueada": "CQ-ID-BLOQUEADA",
  "carnet-vencida": "CQ-ID-VENCIDA",
  datos: "CQ-DATOS",
  segip: "CQ-SEGIP",
  alta: "CQ-ALTA",
  preparar: "CQ-PREP",
  precio: "CQ-PRECIO",
  "precio-vencido": "CQ-PRECIO-VENCIDO",
  qr: "CQ-QR",
  "qr-falta": "CQ-QR-FALTA",
  "ya-pagaste": "CQ-YAPAGASTE",
  "espera-pago": "CQ-ESPERA-PAGO",
  camino: "CQ-CAMINO",
  antes: "CQ-ANTES",
  aprobar: "CQ-APROBAR",
  "aprobar-no-salio": "CQ-APROBAR-NOSALIO",
  llego: "CQ-LLEGO",
  saldo: "CQ-SALDO",
  pagando: "CQ-PAGANDO",
  listo: "CQ-LISTO",
  app: "CQ-APP",
  "sin-qr": "CQ-SINQR",
  revision: "CQ-REVISION",
  "segip-no": "CQ-SEGIP-NO",
  rechazo: "CQ-RECHAZO",
  "qr-vencido-cerrada": "CQ-QR-VENCIDO-CERRADA",
  "qr-vencido-abierta": "CQ-QR-VENCIDO-ABIERTA",
  frenada: "CQ-FRENADA",
  menos: "CQ-MENOS",
  "no-vende": "CQ-NOVENDE",
  // Las fallas del pago del paquete: la llama se preocupa donde estaba. Si no se sabe todavía, espera.
  "pago-no-salio": "CQ-FALLO",
  "pago-sin-patrocinio": "CQ-FALLO",
  "pago-raro": "CQ-FALLO",
  "pago-no-se-sabe": "CQ-PAGANDO",
  "pago-sin-ver": "CQ-PAGANDO",
  // La pregunta por la orden de otra app, antes del QR: la misma de Ya pagaste.
  "otra-orden": "CQ-YAPAGASTE",
  raro: "CQ-RARO",
  desconocido: "CQ-DESCONOCIDO",
  fallo: "CQ-FALLO",
  // Proteger la cuenta no tiene lugar propio en el camino: la llama se queda donde estaba y anima.
  proteger: "CQ-ESPERA",
  "sin-red": "SIN-CONEXION",
  sesion: "SIN-CONEXION",
};
/** Las pantallas donde la llama avanza con las etapas del dinero. */
const POR_ETAPA: ReadonlySet<IdDePantalla> = new Set(["camino", "antes", "aprobar", "aprobar-no-salio"]);

const PALABRA: Record<string, string> = {
  listo: "cargaEtapaListo",
  ahora: "cargaEtapaAhora",
  despues: "cargaEtapaDespues",
  frenada: "cargaEtapaFrenada",
  "no-salio": "cargaEtapaNoSalio",
};

/* ================================================================== piezas */

const idioma = (): "es" | "en" => (getLang() === "en" ? "en" : "es");

/** Un texto de la máquina, en el idioma de la página. */
const render = (x: Texto): string => Object.entries(x.vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t(x.clave));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, clase?: string, texto?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/** El celular parado o la tableta: primero se guarda el QR. El iPhone queda como celular hasta confirmar dónde va la imagen. */
export function aparatoDeEsteNavegador(w: { matchMedia?: (q: string) => MediaQueryList } = typeof window === "undefined" ? {} : window): "compu" | "celular" {
  try {
    if (typeof w.matchMedia !== "function") return "compu";
    return w.matchMedia("(pointer: coarse)").matches && !w.matchMedia("(min-width: 900px)").matches ? "celular" : "compu";
  } catch {
    return "compu";
  }
}

const extensionDe = (dataUrl: string): string => {
  const tipo = /^data:image\/([a-z+]+)/.exec(dataUrl)?.[1] ?? "png";
  return tipo === "svg+xml" ? "svg" : tipo === "jpeg" ? "jpg" : tipo;
};

const fechaDe = (ms: number): string => {
  try {
    // En es-BO, en 24 horas: con el reloj de 12 salía «07:38 a. m.» y, al final de una frase, con un punto de más.
    const en = idioma() === "en";
    return new Intl.DateTimeFormat(en ? "en-US" : "es-BO", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(en ? {} : { hourCycle: "h23" as const }) }).format(ms);
  } catch {
    return "";
  }
};

/* ================================================================== la ventana */

interface Ventana {
  d: Dialogo;
  m: MotorDeCompra;
  o: OpcionesDeCompra;
  s: LoQueSeSabe;
  p: PantallaDeCompra | null;
  abierta: boolean;
  /** Sube con cada cambio de lo que se sabe: una mirada que vuelve tarde no pisa lo que hizo un toque. */
  version: number;
  ocupada: boolean;
  mirando: boolean;
  /** Las miradas seguidas que fallaron o dejaron la espera igual. Un toque las pone en cero. */
  intentos: number;
  temporizador: ReturnType<typeof setTimeout> | null;
  /** Cuándo cambió la principal, para la guarda de medio segundo. */
  principalDesde: number;
  /** Lo más lejos que llegó la llama en el tramo En camino: con el dinero viajando, nunca vuelve atrás. */
  avanceMax: number;
  /** El festejo del final ya se montó: llega sin caminar, así siempre se ve. */
  festejo: boolean;
  firmaPrincipal: string;
  firmaCuerpo: string;
  firmaPie: string;
  /** Lo que dice la línea de estado del pie (un aviso del motor, lo que falta del formulario). */
  mensaje: string | null;
  /** Más detalles quedó abierto en esta pantalla. */
  masAbierto: boolean;
  urlVerificacion: string | null;
  estado: HTMLParagraphElement;
  anuncio: HTMLElement;
  principal: HTMLElement | null;
  confiar: (e: Event) => boolean;
  reloj: () => number;
  almacen: Almacen | null | undefined;
}

/**
 * Abre Tu compra. Sin la compra con QR en el build ni la demo, no abre nada y devuelve `null`. La ventana arranca con lo
 * que da el motor y, si la pantalla espera algo de afuera, lo lee.
 */
export function abrirCompra(o: OpcionesDeCompra): VentanaDeCompra | null {
  const permitida = o.permitida ?? (compraQrActiva() || demoDeRampa());
  if (!permitida) return null;
  const v = {} as Ventana;
  Object.assign(v, {
    m: o.motor,
    o,
    s: o.motor.inicio(),
    p: null,
    abierta: true,
    version: 0,
    ocupada: false,
    mirando: false,
    intentos: 0,
    temporizador: null,
    principalDesde: 0,
    avanceMax: 0,
    festejo: false,
    firmaPrincipal: "",
    firmaCuerpo: "",
    firmaPie: "",
    mensaje: null,
    masAbierto: false,
    urlVerificacion: null,
    estado: lineaDeEstado(),
    anuncio: el("p", "sr-only"),
    principal: null,
    confiar: o.confiar ?? ((e: Event) => e.isTrusted),
    reloj: o.reloj ?? (() => Date.now()),
    almacen: o.almacen,
  } satisfies Partial<Ventana>);
  v.anuncio.setAttribute("aria-live", "polite");
  v.d = abrirDialogo({
    titulo: t("compraVentana"),
    onCerrar: () => {
      v.abierta = false;
      cancelarMirada(v);
      acompanar(v.d.cuerpo, null);
      v.m.cerrar?.();
      v.o.alCerrar?.(v.s);
    },
  });
  v.d.card.classList.add("cq-card");
  v.d.card.append(v.anuncio);
  pintar(v);
  return { card: v.d.card, cerrar: () => v.d.cerrar(), lo: () => v.s };
}

function cancelarMirada(v: Ventana): void {
  if (v.temporizador) clearTimeout(v.temporizador);
  v.temporizador = null;
}

/* ------------------------------------------------------------------ pintar */

function pintar(v: Ventana): void {
  if (!v.abierta) return;
  v.s = { ...v.s, ahora: v.reloj(), idioma: idioma() };
  const p = pantallaDeCompra(v.s);
  if (p.id === "qr") vioElQr(v);
  const cambio = v.p?.id !== p.id;
  v.p = p;
  v.d.card.dataset.pantalla = p.id;
  if (cambio) {
    v.masAbierto = false;
    v.mensaje = null;
    v.anuncio.textContent = render(p.titulo);
  }
  const habiaFocoEnLaPrincipal = !!v.principal && document.activeElement === v.principal;
  const detalle = v.m.detalle?.(v.s, p) ?? null;
  const firmaCuerpo = JSON.stringify([p.id, p.titulo, p.linea, p.datos, p.plegado, p.numero, p.qr, p.etapas, p.app, detalle, idioma()]);
  if (firmaCuerpo !== v.firmaCuerpo) {
    v.firmaCuerpo = firmaCuerpo;
    pintarCuerpo(v, p, detalle);
  }
  pintarPie(v, p);
  const foco = document.activeElement;
  if (habiaFocoEnLaPrincipal && v.principal) v.principal.focus({ preventScroll: true });
  else if (!foco || foco === document.body || !foco.isConnected) {
    const titulo = v.d.cuerpo.querySelector<HTMLElement>(".cq-titulo");
    (cambio && titulo ? titulo : v.d.card).focus({ preventScroll: true });
  }
  programarMirada(v, p);
}

/** Se dibujó el QR de esta orden: queda anotado en este navegador y, en esta ventana, el QR sigue a la vista. */
function vioElQr(v: Ventana): void {
  const c = v.s.carga;
  const o = c ? leerOrden(c.orden) : null;
  if (!c || !o) return;
  const marcas = c.marcas.mostroQr === null ? anotarMarca(o.id, "mostroQr", v.reloj(), c.marcas, almacenDe(v)) : c.marcas;
  v.s = { ...v.s, carga: { ...c, marcas, vista: { ...(c.vista ?? {}), qrALaVista: true } } };
}

function pintarCuerpo(v: Ventana, p: PantallaDeCompra, detalle: DetalleDePantalla | null): void {
  const c = v.d.cuerpo;
  c.replaceChildren();
  const titulo = el("h3", "cq-titulo", render(p.titulo));
  titulo.tabIndex = -1;
  c.append(titulo);

  if (p.qr) {
    const caja = el("div", "cq-qr-caja");
    const img = el("img", "cq-qr");
    img.src = p.qr.imagen;
    img.alt = render({ clave: "compraQrAlt", vars: { bs: montoVisible(p.qr.bs, idioma()) } });
    img.width = LADO_QR;
    img.height = LADO_QR;
    caja.append(img);
    c.append(caja);
  }

  if (p.etapas) {
    const ol = el("ol", "cq-etapas");
    for (const e of p.etapas) {
      const li = el("li", "cq-etapa");
      li.dataset.palabra = e.palabra;
      li.append(el("span", "cq-etapa-nombre", t(e.clave)), el("span", "cq-etapa-palabra", t(PALABRA[e.palabra] ?? "cargaEtapaDespues")));
      ol.append(li);
    }
    c.append(ol);
  }

  if (detalle?.lista?.length) {
    const dl = el("dl", "cq-lista");
    for (const x of detalle.lista) {
      const fila = el("div", "cq-dato");
      fila.append(el("dt", undefined, x.rotulo), el("dd", undefined, x.valor));
      dl.append(fila);
    }
    c.append(dl);
  }
  if (detalle?.campos?.length) c.append(formulario(detalle.campos));

  if (p.datos.length || p.app) {
    const dl = el("dl", "cq-datos");
    for (const x of p.datos) dl.append(filaDeDato(x, p));
    if (p.app) {
      dl.append(
        // El monto con su moneda, a la vista: sin ella, se puede mandar otra y perderla. Copiar copia solo el número.
        filaParaCopiar("monto", t("pagoMonto"), `${montoVisible(p.app.monto, idioma())} USDC`, p.app.monto),
        filaParaCopiar("nota", t("compraNotaRotulo"), p.app.nota, p.app.nota),
        filaParaCopiar("cuenta", t("pagoCuenta"), p.app.cuentaCorta, p.app.cuenta),
      );
    }
    c.append(dl);
  }

  const plegado = p.plegado.map(render);
  if (plegado.length || p.app) {
    const mas = el("details", "cq-mas");
    mas.open = v.masAbierto;
    mas.addEventListener("toggle", () => {
      v.masAbierto = mas.open;
    });
    mas.append(el("summary", undefined, t("saldoMasDetalles")));
    for (const x of plegado) mas.append(el("p", undefined, x));
    if (p.app) {
      if (Number.isFinite(p.app.vence)) mas.append(el("p", undefined, render({ clave: "pagoVence", vars: { fecha: fechaDe(p.app.vence) } })));
      const caja = el("div", "cq-qr-app");
      const img = el("img", "cq-qr-enlace");
      img.alt = t("pagoQrAlt");
      img.width = LADO_QR_APP;
      img.height = LADO_QR_APP;
      caja.append(img);
      const abrir = el("a", "cq-enlace", t("pagoAbrirApp"));
      abrir.href = p.app.enlace;
      mas.append(caja, abrir);
      void pintarQr(img, p.app.enlace, LADO_QR_APP).then(
        (ok) => ok || caja.remove(),
        () => caja.remove(),
      );
    }
    c.append(mas);
  }

  // El final: la llama llega festejando sin caminar desde donde estaba, así el festejo siempre se ve.
  if (p.id === "listo" && !v.festejo) {
    v.festejo = true;
    acompanar(c, null);
  }
  acompanar(c, llamaDe(v, p));
}

function filaDeDato(x: Texto, p: PantallaDeCompra): HTMLElement {
  const texto = render(x);
  const i = texto.indexOf(": ");
  const fila = el("div", "cq-dato");
  fila.dataset.clave = x.clave;
  if (x.clave === "compraDatoMonto") fila.classList.add("cq-dato-monto");
  if (x.clave === "compraDatoDonde") fila.classList.add("cq-dato-dinero");
  const dd = el("dd", undefined, i >= 0 ? texto.slice(i + 2) : texto);
  fila.append(el("dt", undefined, i >= 0 ? texto.slice(0, i) : ""), dd);
  if (x.clave === "compraDatoNumero" && p.numero) dd.append(botonDeCopiar(p.numero, texto.slice(0, Math.max(0, i))));
  return fila;
}

function filaParaCopiar(cual: string, rotulo: string, aLaVista: string, copia: string): HTMLElement {
  const fila = el("div", "cq-dato cq-dato-copiar");
  fila.dataset.app = cual;
  const dd = el("dd");
  dd.append(el("code", undefined, aLaVista), botonDeCopiar(copia, rotulo));
  fila.append(el("dt", undefined, rotulo), dd);
  return fila;
}

function botonDeCopiar(texto: string, rotulo: string): HTMLButtonElement {
  const b = el("button", "cq-copiar", t("acctCopy"));
  b.type = "button";
  if (rotulo) b.setAttribute("aria-label", `${t("acctCopy")}: ${rotulo}`);
  b.addEventListener("click", () => void copiar(b, texto, t("acctCopy")));
  return b;
}

let campos = 0;
function formulario(lista: readonly CampoDeDatos[]): HTMLFormElement {
  const f = el("form", "cq-form");
  f.noValidate = true;
  f.addEventListener("submit", (e) => e.preventDefault());
  for (const c of lista) {
    const id = `cq-campo-${++campos}`;
    const fila = el("div", "cq-campo");
    const label = el("label", undefined, c.rotulo);
    label.htmlFor = id;
    let control: HTMLInputElement | HTMLSelectElement;
    if (c.tipo === "select") {
      const s = el("select");
      for (const op of c.opciones ?? []) {
        const o = el("option", undefined, op.rotulo);
        o.value = op.valor;
        s.append(o);
      }
      control = s;
    } else {
      const i = el("input");
      i.type = c.tipo;
      if (c.tipo === "tel") i.inputMode = "tel";
      i.autocomplete = "off";
      control = i;
    }
    control.id = id;
    control.name = c.clave;
    if (c.valor !== undefined) control.value = c.valor;
    if (c.obligatorio) control.dataset.obligatorio = "1";
    control.addEventListener("input", () => control.removeAttribute("aria-invalid"));
    fila.append(label, control);
    f.append(fila);
  }
  return f;
}

/** Lo que la persona escribió, o `null` si falta algo obligatorio (queda marcado y lo dice la línea de estado). */
function leerFormulario(v: Ventana): Record<string, string> | null {
  const f = v.d.cuerpo.querySelector<HTMLFormElement>(".cq-form");
  if (!f) return {};
  const entrada: Record<string, string> = {};
  let falta: HTMLElement | null = null;
  for (const c of f.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")) {
    const valor = c.value.trim();
    entrada[c.name] = valor;
    if (c.dataset.obligatorio && !valor) {
      c.setAttribute("aria-invalid", "true");
      falta ??= c;
    }
  }
  if (!falta) return entrada;
  v.mensaje = t("cargaFormFalta");
  v.estado.textContent = v.mensaje;
  falta.focus();
  return null;
}

/* ------------------------------------------------------------------ la llama */

function etapasHechas(v: Ventana, p: PantallaDeCompra): number {
  const palabras = p.etapas ? p.etapas.map((e) => e.palabra) : v.s.carga ? (etapasDeCarga(v.s.carga.orden) ?? []) : [];
  return palabras.filter((x) => x === "listo").length;
}

/** La confirmación que se muestra (Confirmación 2 de 4): su número y el total, o `null`. */
function confirmacionDe(p: PantallaDeCompra): { n: number; total: number } | null {
  if (p.titulo.clave !== "compraAprobarTitulo") return null;
  const n = Number(p.titulo.vars?.n);
  const total = Number(p.titulo.vars?.total);
  return Number.isFinite(n) && Number.isFinite(total) && total >= 1 ? { n, total } : null;
}

/**
 * Cuánto avanzó la llama en el tramo En camino. Lo da la etapa del dinero y, en las confirmaciones, también cuántas se
 * hicieron: entre la tercera y la cuarta la etapa no cambia, y la llama igual da un paso. Nunca vuelve atrás y no llega
 * a la bandera hasta que la compra termina.
 */
function avanceEnCamino(v: Ventana, p: PantallaDeCompra): number {
  const c = confirmacionDe(p);
  const porConfirmacion = c ? (0.75 * c.n) / (c.total + 1) : 0;
  v.avanceMax = Math.max(v.avanceMax, avanceDeEtapa(etapasHechas(v, p), 4), porConfirmacion);
  return v.avanceMax;
}

function llamaDe(v: Ventana, p: PantallaDeCompra): Acompanamiento {
  const recorrido = v.s.permiso?.primera ? "compra" : "compraSiguiente";
  const linea = p.linea ? render(p.linea) : "";
  if (p.id === "proteger") return { ...enPantalla(recorrido, LLAMA[p.id]), pose: "anima", linea };
  const avance = POR_ETAPA.has(p.id) ? avanceEnCamino(v, p) : null;
  // Con el dinero en camino, las cuatro etapas ya dicen el avance: la llama acompaña sin su camino, para que no haya dos.
  if (p.id === "camino") return { pose: enPantalla(recorrido, LLAMA[p.id]).pose, linea };
  return { ...enPantalla(recorrido, LLAMA[p.id], avance === null ? undefined : { avance }), linea };
}

/* ------------------------------------------------------------------ el pie */

function pintarPie(v: Ventana, p: PantallaDeCompra): void {
  const firmaPrincipal = `${p.id}|${p.principal.accion}|${p.principal.clave}`;
  if (firmaPrincipal !== v.firmaPrincipal) {
    v.firmaPrincipal = firmaPrincipal;
    v.principalDesde = v.reloj();
  }
  const firmaPie = JSON.stringify([firmaPrincipal, p.principal, p.enlace, v.ocupada, v.mensaje, v.urlVerificacion, p.qr?.imagen ?? null, p.numero, idioma()]);
  if (firmaPie === v.firmaPie) return;
  v.firmaPie = firmaPie;
  v.estado.textContent = v.mensaje ?? "";
  v.principal = accion(v, p, p.principal, "dlg-main");
  const piezas: HTMLElement[] = [v.estado, v.principal];
  if (p.enlace) piezas.push(accion(v, p, p.enlace, "cq-enlace"));
  v.d.pie.replaceChildren(...piezas);
}

/** La principal o el enlace: un botón, o un enlace de verdad cuando lo que hace es ir a otro lado. */
function accion(v: Ventana, p: PantallaDeCompra, b: BotonDeCompra, clase: string): HTMLElement {
  const texto = render(b);
  let e: HTMLElement;
  const enlace = (href: string, nueva = false, bajar?: string): HTMLAnchorElement => {
    const a = el("a", clase, texto);
    a.href = href;
    if (nueva) {
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    }
    if (bajar) a.download = bajar;
    return a;
  };
  if (b.accion === "escribir") e = enlace(correoDeAyuda(p.numero, idioma()));
  else if (b.accion === "guardar-qr" && p.qr) e = enlace(p.qr.imagen, false, `tinkazo-qr-bs-${p.qr.bs.replace(/[^\d]/g, "")}.${extensionDe(p.qr.imagen)}`);
  else if (b.accion === "abrir-banco" && p.qr?.enlace) e = enlace(p.qr.enlace, true);
  else if (b.accion === "abrir-verificacion" && v.urlVerificacion && (b.forma === "enlace" || p.id === "carnet-espera")) e = enlace(v.urlVerificacion, true);
  else {
    const boton = el("button", clase, texto);
    boton.type = "button";
    const ocupada = (b.ocupado ?? false) || (v.ocupada && clase === "dlg-main");
    if (ocupada) {
      boton.disabled = true;
      boton.setAttribute("aria-busy", "true");
    } else if (v.ocupada) boton.disabled = true;
    e = boton;
  }
  e.dataset.accion = b.accion;
  e.addEventListener("click", (ev) => alTocar(v, b, ev, e));
  return e;
}

/* ------------------------------------------------------------------ los toques */

function alTocar(v: Ventana, b: BotonDeCompra, ev: Event, e: HTMLElement): void {
  const ancla = e.tagName === "A";
  const valido = v.abierta && v.confiar(ev) && v.reloj() - v.principalDesde >= GUARDA_MS && !v.ocupada && !(e as HTMLButtonElement).disabled;
  if (!valido) {
    if (ancla) ev.preventDefault();
    return;
  }
  const accion = b.accion;
  if (accion === "cerrar") {
    v.d.cerrar();
    return;
  }
  // Escribir a Tinkazo lo hace el enlace.
  if (accion === "escribir") return;
  if (DE_AFUERA.has(accion) && v.o.afuera) {
    const s = v.s;
    v.d.cerrar();
    v.o.afuera(accion as AccionDeAfuera, s);
    return;
  }
  // Sin nadie afuera que lleve a sortear, Armar mi primer sorteo cierra la ventana.
  if (accion === "sortear") {
    v.d.cerrar();
    return;
  }
  let s = v.s;
  let entrada: Record<string, string> | undefined;
  switch (accion) {
    // Ya lo había pagado (con el QR vencido y la compra cerrada) también dice que pagó: la pantalla pasa a la de pedir
    // ayuda con el número, nunca a pagar de nuevo.
    case "ya-pague":
    case "si-pague":
    case "pague-igual":
      s = conMarca(v, s, "dijoPago");
      break;
    case "todavia-no":
      s = conVista(sinMarca(v, s, "dijoPago"), { qrALaVista: true });
      s = { ...s, todaviaNo: true };
      break;
    case "mostrar-qr":
      s = conVista(s, { qrALaVista: true });
      break;
    case "guardar-qr":
      s = conMarca(v, s, "guardoQr");
      break;
    // El enlace abre la app del banco. Después, Ya pagué queda a mano, sin pedir que baje la imagen.
    case "abrir-banco":
      s = conVista(s, { abrioBanco: true });
      break;
    case "ver-primer-paso":
      s = conVista(s, { vioAntesDeAprobar: true });
      break;
    case "abrir-verificacion":
      s = abrirVerificacion(v, s, ancla);
      break;
    case "reintentar":
      s = { ...s, sinRed: false };
      break;
    // Ver el QR lleva los datos que pide la cotización, si los pide (el motor los pinta como formulario en el precio).
    case "ver-qr":
    case "guardar-datos":
    case "confirmar-segip": {
      const leida = leerFormulario(v);
      if (!leida) return;
      entrada = leida;
      break;
    }
  }
  // Un enlace hace lo suyo (bajar el QR, abrir la pestaña) después de este evento, y solo si sigue en la página: la
  // ventana cambia un instante después, con el temporizador.
  if (ancla) setTimeout(() => void correr(v, accion, s, entrada), 0);
  else void correr(v, accion, s, entrada);
}

const almacenDe = (v: Ventana): Almacen | null | undefined => v.almacen;

function conMarca(v: Ventana, s: LoQueSeSabe, marca: Marca): LoQueSeSabe {
  const o = s.carga ? leerOrden(s.carga.orden) : null;
  if (!s.carga || !o) return s;
  const marcas: MarcasDeOrden = anotarMarca(o.id, marca, v.reloj(), s.carga.marcas, almacenDe(v));
  return { ...s, carga: { ...s.carga, marcas } };
}

function sinMarca(v: Ventana, s: LoQueSeSabe, marca: Marca): LoQueSeSabe {
  const o = s.carga ? leerOrden(s.carga.orden) : null;
  if (!s.carga || !o) return s;
  return { ...s, carga: { ...s.carga, marcas: quitarMarca(o.id, marca, s.carga.marcas, almacenDe(v)) } };
}

function conVista(s: LoQueSeSabe, vista: NonNullable<NonNullable<LoQueSeSabe["carga"]>["vista"]>): LoQueSeSabe {
  return s.carga ? { ...s, carga: { ...s.carga, vista: { ...(s.carga.vista ?? {}), ...vista } } } : s;
}

/**
 * Abrir la verificación, dentro del toque: la pestaña se abre en blanco ya (después el navegador no la deja abrir) y
 * recibe la dirección cuando el motor la tiene. Si el navegador no la abre, la pantalla ofrece el enlace.
 */
function abrirVerificacion(v: Ventana, s: LoQueSeSabe, conEnlace: boolean): LoQueSeSabe {
  const verif = s.verificacion ?? {};
  if (!v.m.verificacion || conEnlace) return { ...s, verificacion: { ...verif, abrio: true, bloqueada: false } };
  let pestana: Window | null = null;
  try {
    pestana = window.open("", "_blank");
  } catch {
    pestana = null;
  }
  if (pestana) {
    try {
      pestana.opener = null;
    } catch {
      /* algunos navegadores no lo dejan cambiar */
    }
  }
  void v.m.verificacion(s).then(
    (url) => {
      v.urlVerificacion = url;
      if (pestana) {
        if (url) pestana.location.href = url;
        else pestana.close();
      }
      if (v.abierta && !v.ocupada) pintar(v);
    },
    () => pestana?.close(),
  );
  return pestana ? { ...s, verificacion: { ...verif, abrio: true, bloqueada: false } } : { ...s, verificacion: { ...verif, abrio: false, bloqueada: true } };
}

async function correr(v: Ventana, accion: AccionDeCompra, s: LoQueSeSabe, entrada?: Record<string, string>): Promise<void> {
  cancelarMirada(v);
  v.version++;
  const mia = v.version;
  v.s = s;
  v.intentos = 0;
  v.ocupada = true;
  v.mensaje = null;
  pintar(v);
  let r: LoQueSeSabe;
  try {
    r = await v.m.hacer(accion, s, {
      avisar: (x, estado) => {
        if (!v.abierta || v.version !== mia) return;
        v.s = x;
        v.mensaje = estado ? t(estado) : null;
        pintar(v);
      },
      ...(entrada ? { entrada } : {}),
    });
  } catch {
    r = { ...v.s, sinRed: true };
  }
  if (!v.abierta || v.version !== mia) return;
  v.ocupada = false;
  v.version++;
  v.s = r;
  v.mensaje = null;
  pintar(v);
}

/* ------------------------------------------------------------------ mirar sola */

function programarMirada(v: Ventana, p: PantallaDeCompra): void {
  cancelarMirada(v);
  if (!v.abierta || v.ocupada || v.mirando || !MIRAN_SOLAS.has(p.id)) return;
  // La espera lee enseguida lo que le falta y, si vuelve igual, con una pausa que crece. Las demás, al ritmo del motor.
  const ritmo = v.m.ritmoMs ?? RITMO_MS;
  const ms = p.id === "espera" && !v.s.sinRed ? (v.intentos === 0 ? 0 : Math.min(ritmo, PAUSA_DE_ESPERA_MS * 2 ** (v.intentos - 1))) : ritmo;
  v.temporizador = setTimeout(() => void mirarSola(v), ms);
}

async function mirarSola(v: Ventana): Promise<void> {
  v.temporizador = null;
  if (!v.abierta || v.ocupada || v.mirando) return;
  v.mirando = true;
  const mia = v.version;
  const antes = v.p?.id ?? null;
  let r: LoQueSeSabe | null = null;
  try {
    r = await v.m.mirar(v.s);
  } catch {
    r = null;
  }
  v.mirando = false;
  // Mientras el motor trabaja, el final del toque pinta y vuelve a programar. Si un toque cambió lo que se sabe, lo que
  // volvió no vale: se vuelve a mirar al ritmo de siempre.
  if (!v.abierta || v.ocupada) return;
  if (v.version !== mia) {
    if (v.p) programarMirada(v, v.p);
    return;
  }
  // Una mirada que falló, o una espera que volvió igual, es un intento más. Al tope, sin conexión y Probar de nuevo:
  // nunca lecturas sin pausa ni una ruedita que no termina.
  const sigueEsperando = antes === "espera" && r !== null && pantallaDeCompra({ ...r, ahora: v.reloj(), idioma: idioma() }).id === "espera";
  v.intentos = r === null || sigueEsperando ? v.intentos + 1 : 0;
  if (v.intentos >= TOPE_DE_INTENTOS) {
    v.intentos = 0;
    r = { ...(r ?? v.s), sinRed: true };
  }
  if (r) {
    v.version++;
    v.s = r;
  }
  pintar(v);
}
