import { chooseLang, getLang, onLangChange, t } from "../i18n";
import { altaLibre } from "../stellar/alta-config";
import { type CanjeDeCupon, type ErrorDeAlta, ESPERA_MS, type EstadoDeAlta, type ResultadoDeAlta } from "../stellar/alta-api";
import { network } from "../stellar/config";
import { mostrar, normalizar } from "../stellar/cupon-codigo";
import { esDeRed } from "../stellar/errores";
import { TOPE_TOKEN_MS } from "../stellar/pollar-config";
import type { EstadoOficial, ResultadoDeActivar } from "../stellar/wallet-pollar";
import { ocultarCorreo } from "./cuenta-estado";
import {
  OTRO_CODIGO_S,
  SPAM_S,
  type Accion,
  type AccesoEnLaVista,
  type Boton,
  type Corre,
  type EntradaVista,
  type Falla,
  type ModoDelAcceso,
  type Para,
  type Secundario,
  type Texto,
  type Vista,
  activarPermitido,
  vistaDe,
} from "./cuenta-lista-estado";
import { soltarPantallaCompleta } from "./pantalla-completa";
import { SIN_RESPUESTA, cancelo, codigoMalo, conTope, mailOk, noPermitido } from "./proteger-cuenta";

/**
 * «Dejá tu cuenta lista»: el paso a pantalla completa y obligatorio del modo Oficial.
 *
 * Con una cuenta de Google o de correo en la red principal, la cuenta no queda lista al entrar: falta activarla (Pollar
 * deja un pedido de crearla que solo se aprueba desde este navegador) y protegerla (una forma de recuperarla, sin la
 * cual no firma nada más). Este paso tapa toda la página, también la cabecera, hasta que las dos partes estén listas.
 * Lo abre `cuenta-lista-flujo.ts`: al entrar, al retomar la sesión, antes de sellar y antes de sortear.
 *
 * Obligatorio no es trampa: «Pasar a Prueba» y «Cerrar sesión» están siempre a la vista en el pie, también mientras algo
 * corre. No hay «Ahora no», ni X, ni Escape ni clic afuera que deje seguir en Oficial con la cuenta a medias. Si se abrió
 * para usar un cupón con la cuenta ya activada y protegida, no hay nada a medias: «Volver» (y Escape) vuelven a la página.
 *
 * Es el único lugar que llama a la activación (`activarCuenta`, una prueba lo fija): cada voto cuesta, y sale solo del
 * toque de la persona en «Activar mi cuenta». Lo automático solo lee. Qué se ve en cada estado lo decide `vistaDe`
 * (`cuenta-lista-estado.ts`), sin DOM; esto lo pinta y corre las acciones.
 *
 * Lo de proteger reusa lo aprendido en «Protegé tu cuenta» (`proteger-cuenta.ts`): cerrar el cuadro del desbloqueo no
 * es una falla, el navegador que no lo deja abrir tiene su aviso, y una espera sin respuesta tiene tope y deja reintentar.
 */

/** Lo que el paso le pide a la cuenta. Es `pollarWallet`; en la muestra y en las pruebas, un reemplazo. */
export interface CuentaDelPaso {
  estadoOficial(fresco?: boolean): Promise<EstadoOficial>;
  activarCuenta(): Promise<ResultadoDeActivar>;
  alCambiarLaCuenta(cb: () => void): () => void;
  sesionViva(): boolean;
  confirmarAparatoConDesbloqueo(): Promise<boolean>;
  mandarCodigoParaEsteAparato(): Promise<void>;
  confirmarCodigoParaEsteAparato(code: string): Promise<boolean>;
  protegerConPasskey(): Promise<boolean>;
  mandarCodigoDeProteccion(mail: string): Promise<void>;
  confirmarCodigoDeProteccion(code: string): Promise<boolean>;
}

/** Las dos salidas, y volver a entrar cuando la sesión se cerró. */
export interface SalidasDelPaso {
  cerrarSesion(): Promise<void>;
  pasarAPrueba(): void;
  puedePasarAPrueba(): boolean;
  entrarDeNuevo(): void | Promise<void>;
}

export interface OpcionesDelPaso {
  para: Para;
  /** El correo de la sesión, entero: se muestra tapado. */
  correo?: string | undefined;
  /** Entró con su correo y no con Google. */
  viaCorreo?: boolean | undefined;
  /** La línea de quién entró («Entraste con Google como Ana.»). Como función, se arma en cada pintada: sigue al idioma. */
  aviso?: string | (() => string | undefined) | undefined;
  /** A dónde vuelve el foco al cerrar. */
  volverA?: HTMLElement | null | undefined;
  /** Lo que hace el botón del final, dentro de su toque (pedir la pantalla completa, sellar). */
  alSeguir?: (() => void) | undefined;
  /** Al abrirse de verdad (no si ya estaba abierto). */
  alAbrir?: (() => void) | undefined;
  /** Lo que ya se sabe de la cuenta, para pintar sin esperar la red. */
  inicial?: Partial<EstadoOficial> | null | undefined;
  /** Si es un celular. Sin decirlo, `(pointer: coarse)`. */
  celular?: boolean | undefined;
  puedeUsarDesbloqueo?: (() => Promise<boolean>) | undefined;
  /** La confirmación del primer sello en Oficial: si falta y cómo marcarla vista. */
  primerOficial?: { pendiente(): boolean; marcar(): void } | undefined;
  /** La dirección de la sesión: si cambia (`tinkazo:sesion`), el paso se cierra. */
  direccion?: string | null | undefined;
  /**
   * El acceso al modo Oficial con el cobro por uso (`cuenta-lista-acceso.ts`): el servidor al que se le pregunta, o cómo
   * se porta sin él. Sin decirlo, en la red principal es `cerrado` (salvo el build del plan B1, `VITE_ALTA_LIBRE=1`) y
   * fuera de ella `libre`: ante la duda, no se ofrece activar.
   */
  acceso?: AccesoDelPaso | "libre" | "cerrado" | undefined;
  /** Abrir directo en el campo del cupón («Usar un cupón» de la ventana «Se te acabaron»). Con un cupón guardado, ese. */
  cupon?: "escribir" | undefined;
}

/**
 * Lo que el paso le pide al servidor de las altas y al cupón de la pestaña. Es `accesoDelServidor` de
 * `cuenta-lista-acceso.ts`; en la muestra y en las pruebas, un reemplazo. Nada de esto lanza: los errores vuelven con su
 * clave de texto.
 */
export interface AccesoDelPaso {
  /** Qué acceso tiene la persona (`POST /v1/alta/estado`, con el token de la sesión verificada). */
  estado(): Promise<ResultadoDeAlta<EstadoDeAlta>>;
  /** Canjea un cupón ya normalizado (`POST /v1/alta/cupon`). */
  canjear(codigo: string): Promise<ResultadoDeAlta<CanjeDeCupon>>;
  /** El cupón guardado en la pestaña (el del enlace, o uno escrito), normalizado, o `null`. */
  cuponGuardado(): string | null;
  guardarCupon(codigo: string): void;
  olvidarCupon(): void;
  /** Vuelve a preguntar el cupo de la cuenta, para la línea de abajo: después de canjear y de activar. */
  refrescarCupo(): void;
  /** La cuenta de la sesión (su dirección pública), o `null`. El canje en camino es de esa cuenta y de ninguna otra. */
  cuenta(): string | null;
}

/** Lo que sigue al canje, en orden. */
type PasoDelCanje = "pedido" | "activar" | "estado";

/** Los motivos del canje que dicen que ese cupón no sirve: se olvida, y se deja el campo para corregirlo. */
const CUPON_QUE_NO_SIRVE: ReadonlySet<string> = new Set(["forma", "cupon-no-existe", "cupon-vencido", "cupon-anulado", "cupon-usado", "lote-usado"]);

/** Cada cuánto, y cuántas veces, se mira si ya está el pedido de crear la cuenta después del canje. */
export const PEDIDO_CADA_MS = 2_000;
export const PEDIDO_VECES = 20;

/**
 * El canje en curso, fuera del paso: un doble toque, o cerrar y volver a abrir el paso mientras el servidor contesta,
 * no canjean el mismo cupón dos veces. Al salir bien, aunque el paso ya se haya cerrado, se olvida el cupón si el que
 * está guardado en la pestaña es el que se canjeó, y se refresca el cupo si la sesión sigue siendo la de la cuenta que
 * canjeó: en un stand, con una sola pestaña, la respuesta puede llegar cuando ya entró otra persona y guardó su cupón.
 * Es de una cuenta: si se cierra la sesión y entra otra con el mismo cupón, esa canjea con su propia sesión y nunca sigue
 * con lo que el servidor le contestó a la anterior. Sin saber la cuenta, no se comparte.
 */
let canjeEnVuelo: { cuenta: string; codigo: string; promesa: Promise<ResultadoDeAlta<CanjeDeCupon>> } | null = null;

function cuentaDelAcceso(a: AccesoDelPaso): string | null {
  try {
    return a.cuenta();
  } catch {
    return null;
  }
}

function cuponDelAcceso(a: AccesoDelPaso): string | null {
  try {
    return a.cuponGuardado();
  } catch {
    return null;
  }
}

function canjearUnaVez(a: AccesoDelPaso, codigo: string): Promise<ResultadoDeAlta<CanjeDeCupon>> {
  const cuenta = cuentaDelAcceso(a);
  if (cuenta && canjeEnVuelo && canjeEnVuelo.cuenta === cuenta && canjeEnVuelo.codigo === codigo) return canjeEnVuelo.promesa;
  const sinServicio: ErrorDeAlta = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };
  const promesa: Promise<ResultadoDeAlta<CanjeDeCupon>> = Promise.resolve()
    .then(() => a.canjear(codigo))
    .catch((): ResultadoDeAlta<CanjeDeCupon> => sinServicio)
    .then((r) => {
      if (r.ok) {
        // Un cupón ya canjeado no queda guardado; el de otra persona que entró después en la misma pestaña, sí.
        if (cuponDelAcceso(a) === codigo) a.olvidarCupon();
        if (cuentaDelAcceso(a) === cuenta) a.refrescarCupo();
      }
      return r;
    })
    .finally(() => {
      if (canjeEnVuelo?.promesa === promesa) canjeEnVuelo = null;
    });
  if (cuenta) canjeEnVuelo = { cuenta, codigo, promesa };
  return promesa;
}

/** Lo escrito en el campo del cupón, como se muestra: mayúsculas, la O como 0 y la I o la L como 1, y los guiones solos. */
export function formatoDelCupon(crudo: string): string {
  const enlace = /cupon=([^&\s]+)/i.exec(crudo);
  const base = enlace?.[1] ?? crudo;
  const limpio = base
    .toUpperCase()
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9ABCDEFGHJKMNPQRSTVWXYZ]/g, "")
    .slice(0, 12);
  return (limpio.match(/.{1,4}/g) ?? []).join("-");
}

/** Qué arregla un error del servidor: entrar de nuevo, nada desde acá (se revisa a mano), o probar de nuevo. */
function arregloDe(e: ErrorDeAlta): AccesoEnLaVista["arreglo"] {
  if (e.clave === "clErrSesion") return "entrar";
  if (e.clave === "altaErrCuentaDeOtro") return "ninguno";
  return "probar";
}

/** La marca de `sessionStorage` de un código mandado (sin el correo). Es la de `MARCAS_DE_LA_CUENTA.codigo`. */
export const MARCA_CODIGO = "tinkazo.cl.codigo";

/** Cuánto se espera para decir que algo tarda, entre lecturas, y los topes de cada espera. */
const LENTO_MS = 8_000;
const CADA_LECTURA_MS = 4_000;
const SONDEO_SIN_PEDIDO_MS = 20_000;
const ESPERA_ACTIVACION_MS = 60_000;
/** Una lectura de Pollar (`estadoOficial`): la que se repite al esperar el pedido de crear la cuenta y la activación. */
const TOPE_LECTURA_MS = 10_000;
/**
 * Una lectura del servidor de las altas (`acceso.estado()`): espera el token de la sesión (`TOPE_TOKEN_MS`) y después el
 * pedido (`ESPERA_MS`). Su tope va un segundo detrás de los dos, así siempre deciden primero los de adentro: con la wifi
 * lenta de un stand, un token de 7 segundos y un pedido de 4 terminan bien y no dejan «Probar de nuevo».
 */
export const TOPE_LECTURA_SERVIDOR_MS = TOPE_TOKEN_MS + ESPERA_MS + 1_000;
/** Lo más que espera «Cerrar sesión» antes de cerrar el paso igual. */
export const TOPE_CERRAR_MS = 12_000;
/** Un toque en la principal no cuenta si cambió de acción hace menos que esto (o si el paso recién se abrió). */
export const GUARDA_DE_TOQUE_MS = 500;

/** Las pruebas dicen que sus clics simulados valen: el navegador marca los de verdad con `isTrusted`. */
let confiarEnClicsDePrueba = false;
export function aceptarClicsDePrueba(si: boolean): void {
  confiarEnClicsDePrueba = si;
}

const LLAMA =
  '<svg viewBox="-1 -3 24 28" aria-hidden="true"><rect x="2" y="11" width="16" height="7"/><rect x="15" y="3" width="4" height="10"/><rect x="14" y="0" width="8" height="4"/><rect x="20" y="-2" width="2" height="3"/><rect x="3" y="18" width="2.5" height="6"/><rect x="8" y="18" width="2.5" height="6"/><rect x="12.5" y="18" width="2.5" height="6"/><rect x="16" y="18" width="2.5" height="6"/><rect x="0" y="9" width="3" height="4"/></svg>';
const TILDE = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const FOCO = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** La pantalla en la que el pie va pegado al contenido y no al borde (la misma condición que en `src/styles.css`). */
const ANCHA = "(min-width: 760px) and (min-height: 481px)";

const PRIORIDAD: Record<Para, number> = { entrada: 0, "entrada-con-lista": 1, sorteo: 2, sello: 3 };

const vacio = (): EstadoOficial => ({ activacion: "no-se-sabe", proteccion: "no-se-sabe", correoConfirmado: false, tieneLlaves: false, unicoNavegador: false, correoDeLaCuenta: null });

function texto(x: Texto): string {
  let s = t(x.clave);
  for (const [k, v] of Object.entries(x.vars ?? {})) s = s.replaceAll(`{${k}}`, v);
  return s;
}

function leerMarca(): boolean {
  try {
    return sessionStorage.getItem(MARCA_CODIGO) !== null;
  } catch {
    return false;
  }
}
function marcarCodigo(si: boolean): void {
  try {
    if (si) sessionStorage.setItem(MARCA_CODIGO, "1");
    else sessionStorage.removeItem(MARCA_CODIGO);
  } catch {
    /* sin almacenamiento, la recarga no se nota */
  }
}

function conTopeSimple<T>(p: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => {
    reloj = setTimeout(() => no(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(reloj));
}

const mensaje = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** El error de la activación, en palabras del paso. La activación solo lanza nuestros códigos. */
function fallaDeActivar(e: unknown, sesionViva: boolean): Falla {
  if (!sesionViva) return "sesion";
  const m = mensaje(e);
  if (m === "pollar-activacion-tope") return "tope";
  if (m === "pollar-activacion-rara") return "rara";
  if (m === "SDK_CREDITS_INSUFFICIENT") return "servicio";
  if (m === "SDK_NETWORK_TIMEOUT" || (typeof navigator !== "undefined" && navigator.onLine === false)) return "red";
  return "fallo";
}

/** El error de un código que no se aceptó. */
function fallaDelCodigo(e: unknown): Falla {
  if (e === SIN_RESPUESTA) return "prot-tarda";
  const m = mensaje(e);
  if (/EXPIRED/i.test(m)) return "codigo-vencido";
  if (/SDK_COSIGN_REQUEST_NOT_FOUND|no code was sent/i.test(m)) return "codigo-viejo";
  if (codigoMalo(e)) return "codigo-malo";
  if (esDeRed(e)) return "prot-red";
  return "correo-fallo";
}

let abierto: { promesa: Promise<boolean>; subir: (o: OpcionesDelPaso) => void } | null = null;
let repintar: (() => void) | null = null;
let idiomaEscuchado = false;

/** Hay un paso abierto. */
export const cuentaListaAbierta = (): boolean => abierto !== null;

/**
 * Abre el paso y espera. Devuelve `true` si la persona tocó el botón del final con la cuenta lista, y `false` si salió
 * («Volver», cerrar sesión, pasar a Prueba o la sesión cambió). Nunca lanza. Si ya hay uno abierto, devuelve el mismo y
 * sube el motivo (`sello` gana a todo, `sorteo` a las entradas).
 */
export function abrirCuentaLista(cuenta: CuentaDelPaso, salidas: SalidasDelPaso, opciones: OpcionesDelPaso): Promise<boolean> {
  if (abierto) {
    abierto.subir(opciones);
    return abierto.promesa;
  }
  let resolver!: (v: boolean) => void;
  const promesa = new Promise<boolean>((r) => (resolver = r));
  let op: OpcionesDelPaso = { ...opciones };
  const subir = (o: OpcionesDelPaso): void => {
    // «Usar un cupón» con el paso ya abierto: el campo, salvo que ya haya un cupón guardado.
    if (o.cupon === "escribir" && !acc.pideCupon && acc.canjeado === null) {
      acc.pideCupon = true;
      if (!cuponEnMano()) acc.escribiendo = true;
    }
    if (PRIORIDAD[o.para] < PRIORIDAD[op.para]) return pintar();
    op = { ...op, para: o.para, volverA: o.volverA ?? op.volverA, alSeguir: o.alSeguir ?? op.alSeguir };
    pintar();
  };
  abierto = { promesa, subir };
  if (!idiomaEscuchado) {
    idiomaEscuchado = true;
    onLangChange(() => repintar?.());
  }

  const celular = op.celular ?? (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
  const correoSesion = (op.correo ?? "").trim();
  const st = {
    est: { ...vacio(), ...(op.inicial ?? {}) } as EstadoOficial,
    corre: "revisando" as Corre,
    lento: false,
    falla: null as Falla | null,
    aviso: null as string | null,
    hayDesbloqueo: false,
    desbloqueoFallo: false,
    eligioCorreo: false,
    /** El código mandado: a dónde, para mostrarlo; a qué correo, para mandar otro; y cuándo. */
    codigo: null as { a: string; destino: string | null; desde: number } | null,
    codigoRecargado: false,
    sinPedidoVeces: 0,
  };

  // El acceso al modo Oficial (W3): sin decir de dónde sale, en la red principal no se activa (salvo el plan B1).
  const fuente: AccesoDelPaso | "libre" | "cerrado" = op.acceso ?? (network.name === "mainnet" && !altaLibre() ? "cerrado" : "libre");
  const acceso: AccesoDelPaso | null = typeof fuente === "object" ? fuente : null;
  const modo: ModoDelAcceso = acceso ? "servidor" : (fuente as "libre" | "cerrado");
  const acc = {
    estado: (acceso ? "revisando" : "con") as AccesoEnLaVista["estado"],
    por: null as AccesoEnLaVista["por"],
    fondeo: "inmediato" as EstadoDeAlta["fondeo"],
    pideCupon: op.cupon === "escribir",
    escribiendo: false,
    error: null as Texto | null,
    arreglo: "probar" as AccesoEnLaVista["arreglo"],
    canjeado: null as number | null,
    cadena: false,
    /** Lo que sigue al canje y no salió: «Probar de nuevo» sigue desde ahí. */
    fallo: null as PasoDelCanje | null,
    /**
     * El último cupón que el servidor dijo que no sirve (no existe, venció, ya no vale, ya se usó): con ese mismo en el
     * campo la principal queda apagada, porque otro toque solo sumaba un intento fallido. Cambiarlo la prende.
     */
    codigoMalo: null as string | null,
  };
  let lecturasDeAcceso = 0;
  /** El cupón guardado en la pestaña, como se muestra, o `null`. */
  const cuponEnMano = (): string | null => {
    try {
      const c = acceso?.cuponGuardado() ?? null;
      return c ? mostrar(c) : null;
    } catch {
      return null;
    }
  };
  // Abierto para usar un cupón: el campo, salvo que ya haya uno guardado (entonces, ese).
  if (acc.pideCupon && !cuponEnMano()) acc.escribiendo = true;
  // Lo que ya se sabe alcanza para pintar: si falta activar, la parte 1 dice «Revisando…» hasta leer el pedido.
  let cerrado = false;
  let abiertoEn = Date.now();
  let accionPrincipal = "";
  let cambioEn = abiertoEn;
  let lecturas = 0;
  /** Lecturas que todavía no volvieron, y si llegó un aviso mientras tanto. */
  let enVuelo = 0;
  let releerAlTerminar = false;
  const relojes = new Set<ReturnType<typeof setTimeout>>();
  const despues = (f: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const r = setTimeout(() => {
      relojes.delete(r);
      if (!cerrado) f();
    }, ms);
    relojes.add(r);
    return r;
  };
  let relojLento: ReturnType<typeof setTimeout> | null = null;
  let tic: ReturnType<typeof setInterval> | null = null;
  let sondeoHasta = 0;
  let sondeo: ReturnType<typeof setTimeout> | null = null;
  /** El sondeo sin pedido ya terminó sin encontrarlo: no vuelve a empezar solo, sino con «Probar de nuevo». */
  let sondeoAgotado = false;
  let esperaHasta = 0;

  /* ------------------------------------------------ el armado */

  const raiz = document.createElement("div");
  raiz.className = "cuenta-lista";
  raiz.setAttribute("role", "dialog");
  raiz.setAttribute("aria-modal", "true");
  raiz.setAttribute("aria-labelledby", "cl-titulo");
  raiz.setAttribute("aria-describedby", "cl-bajada");
  raiz.innerHTML =
    `<div class="cl-barra"><span class="cl-marca">${LLAMA}<span class="cl-nombre">TINKAZO</span></span>` +
    `<span class="netbadge main cl-modo"></span>` +
    `<span class="cl-idiomas"><button type="button" class="cl-idioma" data-lang="es" lang="es">ES</button><button type="button" class="cl-idioma" data-lang="en" lang="en">EN</button></span></div>` +
    `<div class="cl-cuerpo"><div class="cl-contenido"><div class="cl-cabeza"><p class="cl-quien"></p><h2 id="cl-titulo" class="cl-titulo" tabindex="-1"></h2><p id="cl-bajada" class="cl-bajada"></p></div>` +
    `<div class="cl-pasos"></div><div class="cl-notas"></div></div></div>` +
    `<div class="cl-pie"><div class="cl-pie-dentro"><div class="cl-salidas"><button type="button" class="cl-texto cl-salida" data-salida="pasar-a-prueba"></button><button type="button" class="cl-texto cl-salida" data-salida="cerrar-sesion"></button></div>` +
    `<div class="cl-accion"><p class="cl-primer"></p><p class="cl-estado" role="status" aria-live="polite"></p><button type="button" class="cl-principal"></button><button type="button" class="cl-texto cl-volver"></button></div></div></div>`;
  const $ = <T extends HTMLElement>(sel: string): T => raiz.querySelector(sel) as T;
  const quien = $<HTMLParagraphElement>(".cl-quien");
  const titulo = $<HTMLHeadingElement>(".cl-titulo");
  const bajada = $<HTMLParagraphElement>(".cl-bajada");
  const pasos = $<HTMLDivElement>(".cl-pasos");
  const notas = $<HTMLDivElement>(".cl-notas");
  const contenido = $<HTMLDivElement>(".cl-contenido");
  const pie = $<HTMLDivElement>(".cl-pie-dentro");
  const salidasFila = $<HTMLDivElement>(".cl-salidas");
  const aPrueba = $<HTMLButtonElement>('[data-salida="pasar-a-prueba"]');
  const cerrarSes = $<HTMLButtonElement>('[data-salida="cerrar-sesion"]');
  const primer = $<HTMLParagraphElement>(".cl-primer");
  const estado = $<HTMLParagraphElement>(".cl-estado");
  const principal = $<HTMLButtonElement>(".cl-principal");
  const volver = $<HTMLButtonElement>(".cl-volver");
  const accionDelPie = $<HTMLDivElement>(".cl-accion");

  // Los campos viven fuera del repintado: así no pierden lo escrito ni el foco.
  const campoCorreo = document.createElement("input");
  campoCorreo.type = "email";
  campoCorreo.id = "cl-correo";
  campoCorreo.inputMode = "email";
  campoCorreo.autocomplete = "email";
  campoCorreo.spellcheck = false;
  // El código que llega por correo en este paso es de 9 letras mayúsculas y números mezclados, no de seis cifras: teclado de
  // texto, mayúsculas solas y sin corrector. Si se pega con espacios de más, el tope deja lugar (`limpio` los saca).
  const campoCodigo = document.createElement("input");
  campoCodigo.type = "text";
  campoCodigo.id = "cl-codigo";
  campoCodigo.inputMode = "text";
  campoCodigo.setAttribute("inputmode", "text");
  campoCodigo.setAttribute("autocapitalize", "characters");
  campoCodigo.setAttribute("autocorrect", "off");
  campoCodigo.setAttribute("spellcheck", "false");
  campoCodigo.autocomplete = "one-time-code";
  campoCodigo.maxLength = 24;
  campoCodigo.className = "cl-codigo";
  campoCodigo.placeholder = "•••••••••";
  const limpio = (): string => campoCodigo.value.replace(/\s+/g, "");
  // El cupón: letras y números en mayúsculas, sin autocompletar ni corrector, y los guiones se ponen solos.
  const campoCupon = document.createElement("input");
  campoCupon.type = "text";
  campoCupon.id = "cl-cupon";
  campoCupon.inputMode = "text";
  campoCupon.setAttribute("inputmode", "text");
  campoCupon.setAttribute("autocapitalize", "characters");
  campoCupon.autocomplete = "off";
  campoCupon.spellcheck = false;
  campoCupon.setAttribute("autocorrect", "off");
  // Lo pegado se recorta al tope antes de llegar al campo: con 14, un enlace entero o un código con un espacio de más
  // perdían el cupón. `formatoDelCupon` ya deja solo los 12 caracteres, con sus guiones.
  campoCupon.maxLength = 200;
  campoCupon.className = "cl-cupon";
  campoCupon.placeholder = "••••-••••-••••";
  campoCupon.setAttribute("aria-describedby", "cl-cupon-ayuda");

  /** Lo escrito tiene forma de cupón y no es el que el servidor acaba de decir que no sirve. */
  const cuponDelCampoSirve = (): boolean => {
    const c = normalizar(campoCupon.value);
    return c !== null && c !== acc.codigoMalo;
  };

  /* ------------------------------------------------ la vista */

  let vistaActual: Vista | null = null;
  let codigoAMano = false;

  const entrada = (): EntradaVista => ({
    ...st.est,
    corre: st.corre,
    lento: st.lento,
    falla: st.falla,
    aviso: st.aviso,
    para: op.para,
    celular,
    hayDesbloqueo: st.hayDesbloqueo,
    desbloqueoFallo: st.desbloqueoFallo,
    eligioCorreo: st.eligioCorreo,
    correoSesion: ocultarCorreo(correoSesion),
    correoCuenta: ocultarCorreo(st.est.correoDeLaCuenta ?? ""),
    entroConCorreo: !!op.viaCorreo,
    codigo: st.codigo ? { a: st.codigo.a, segundos: Math.floor((Date.now() - st.codigo.desde) / 1000) } : null,
    codigoRecargado: st.codigoRecargado,
    campoOk: st.codigo ? limpio().length >= 4 : mailOk(campoCorreo.value),
    sinPedidoVeces: st.sinPedidoVeces,
    puedePasarAPrueba: salidas.puedePasarAPrueba(),
    primerOficialPendiente: op.primerOficial?.pendiente() ?? false,
    acceso: {
      modo,
      estado: acc.estado,
      por: acc.por,
      pideCupon: acc.pideCupon,
      cuponEnMano: cuponEnMano(),
      escribiendo: acc.escribiendo,
      campoOk: cuponDelCampoSirve(),
      error: acc.error,
      arreglo: acc.arreglo,
      canjeado: acc.canjeado,
      cadena: acc.cadena,
      fallaTrasCanje: acc.fallo !== null,
    },
  });

  function boton(b: Secundario | Boton, clase: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = clase;
    el.dataset.accion = b.accion;
    el.textContent = texto(b);
    el.disabled = b.apagado;
    return el;
  }

  function parrafo(x: Texto, clase = "cl-texto-caja"): HTMLParagraphElement {
    const p = document.createElement("p");
    p.className = clase;
    if (x.clave === "protCodeLead" || x.clave === "altaCuponListo") {
      // En negrita lo que importa: a dónde fue el código, o el cupón que se va a usar.
      const hueco = x.clave === "protCodeLead" ? "mail" : "codigo";
      const [antes, despues] = t(x.clave).split(`{${hueco}}`);
      const b = document.createElement("b");
      b.textContent = x.vars?.[hueco] ?? "";
      if (hueco === "codigo") b.className = "cl-cupon-listo";
      p.append(antes ?? "", b, despues ?? "");
    } else p.textContent = texto(x);
    return p;
  }

  function pintar(): void {
    if (cerrado) return;
    const antes = document.activeElement;
    const enfocado = antes instanceof HTMLElement && raiz.contains(antes) ? antes : null;
    const enfocadoAccion = enfocado ? (enfocado.dataset.accion ?? enfocado.dataset.salida ?? null) : null;
    const v = vistaDe(entrada());
    vistaActual = v;

    raiz.classList.toggle("cl-final", v.final);
    $<HTMLSpanElement>(".cl-modo").textContent = t("netMain");
    for (const b of raiz.querySelectorAll<HTMLButtonElement>(".cl-idioma")) b.setAttribute("aria-pressed", String(b.dataset.lang === getLang()));
    const quienEntro = typeof op.aviso === "function" ? op.aviso() : op.aviso;
    quien.textContent = quienEntro ?? "";
    quien.hidden = !quienEntro;
    titulo.textContent = t(v.titulo);
    bajada.textContent = t(v.bajada);

    pasos.replaceChildren(
      ...v.cajas.map((c) => {
        const s = document.createElement("section");
        // El estado va en `data-estado`, no como clase: `.espera` y `.lista` ya son de otras piezas del sitio.
        s.className = c.abierta ? "cl-paso cl-actual" : "cl-paso";
        s.dataset.parte = c.parte;
        s.dataset.estado = c.estado;
        if (c.ocupada) s.setAttribute("aria-busy", "true");
        const cab = document.createElement("div");
        cab.className = "cl-paso-cab";
        const circulo = document.createElement("span");
        circulo.className = "cl-circulo";
        circulo.setAttribute("aria-hidden", "true");
        if (c.estado === "lista") circulo.innerHTML = TILDE;
        else circulo.textContent = c.estado === "no-salio" ? "!" : String(c.numero);
        const h = document.createElement("h3");
        h.className = "cl-paso-titulo";
        const sr = document.createElement("span");
        sr.className = "sr-only";
        sr.textContent = `${t("clPasoSr").replace("{n}", String(c.numero))} `;
        h.append(sr, t(c.titulo));
        const palabra = document.createElement("span");
        palabra.className = "cl-palabra";
        // Sin palabra mientras algo corre: lo dice el botón, y el aro que gira en el círculo.
        palabra.textContent = c.palabra ? t(c.palabra) : "";
        palabra.hidden = !c.palabra;
        cab.append(circulo, h, palabra);
        s.append(cab);
        if (!c.abierta) return s;
        const cuerpo = document.createElement("div");
        cuerpo.className = "cl-paso-cuerpo";
        for (const x of c.textos) cuerpo.append(parrafo(x));
        if (c.nota) {
          const n = parrafo(c.nota, "cl-nota-caja");
          n.setAttribute("role", "status");
          cuerpo.append(n);
        }
        const armarError = (): HTMLDivElement | null => {
          if (!c.error) return null;
          const err = document.createElement("div");
          err.className = "cl-error";
          err.setAttribute("role", "alert");
          for (const x of c.error) err.append(parrafo(x, "cl-error-texto"));
          return err;
        };
        // El error del cupón va debajo del campo, junto a lo que hay que corregir; los demás, antes.
        const errorAntes = c.campo === "cupon" ? null : armarError();
        if (errorAntes) cuerpo.append(errorAntes);
        if (c.campo) {
          const form = document.createElement("form");
          form.className = "cl-form";
          form.noValidate = true;
          const etiqueta = document.createElement("label");
          const campo = c.campo === "codigo" ? campoCodigo : c.campo === "cupon" ? campoCupon : campoCorreo;
          etiqueta.htmlFor = campo.id;
          etiqueta.className = "cl-etiqueta";
          etiqueta.textContent = t(c.campo === "codigo" ? "protCodeLabel" : c.campo === "cupon" ? "altaCuponLabel" : "protMailLabel");
          if (c.campo === "correo") campoCorreo.placeholder = t("protMailLabel");
          campo.disabled = c.ocupada;
          form.append(etiqueta, campo);
          if (c.campo === "cupon") {
            const ayuda = document.createElement("p");
            ayuda.id = "cl-cupon-ayuda";
            ayuda.className = "cl-texto-caja cl-ayuda";
            ayuda.textContent = t("altaCuponAyuda");
            form.append(ayuda);
            const err = armarError();
            if (err) form.append(err);
            campoCupon.setAttribute("aria-invalid", String(!!c.error));
          }
          form.addEventListener("submit", (ev) => {
            ev.preventDefault();
            if (!confiable(ev)) return;
            // Lo escrito cambia qué está prendido: se mira de nuevo, no la vista de la última pintada.
            const ahora = vistaDe(entrada());
            const p = ahora.principal;
            if (p && !p.apagado && (p.accion === "confirmar-codigo" || p.accion === "mandar-a-mano" || p.accion === "usar-cupon")) void hacer(p.accion);
            else {
              const sec = ahora.cajas.flatMap((x) => x.secundarios).find((x) => x.accion === "mandar-a-mano" && !x.apagado);
              if (sec) void hacer("mandar-a-mano");
            }
          });
          cuerpo.append(form);
        }
        for (const sec of c.secundarios) {
          if (sec.raya) {
            const r = document.createElement("p");
            r.className = "cl-raya";
            r.textContent = t(sec.raya);
            cuerpo.append(r);
          }
          const b = boton(sec, sec.forma === "texto" ? "cl-texto" : "cl-secundario");
          b.addEventListener("click", (ev) => {
            if (!confiable(ev)) return;
            void hacer(sec.accion);
          });
          cuerpo.append(b);
          if (sec.ayuda) cuerpo.append(parrafo(sec.ayuda, "cl-texto-caja cl-ayuda"));
        }
        for (const x of c.cierre ?? []) cuerpo.append(parrafo(x, "cl-texto-caja cl-ayuda cl-cierre"));
        s.append(cuerpo);
        return s;
      }),
    );

    notas.replaceChildren(
      ...v.notas.map((k) => {
        const p = document.createElement("p");
        p.className = "cl-nota";
        p.textContent = t(k);
        return p;
      }),
    );
    notas.hidden = v.notas.length === 0;

    // El pie: la línea de estado, la principal, y las salidas. Si la línea dice lo mismo que la principal apagada
    // («Activando tu cuenta…»), se la oye pero no se la ve: una vez a la vista alcanza, y es el botón.
    estado.textContent = v.estado ? texto(v.estado) : "";
    estado.classList.toggle("sr-only", !!v.estado && !!v.principal && v.principal.apagado && v.estado.clave === v.principal.clave);
    primer.textContent = v.primerOficial ? t("firstOfficialBody") : "";
    primer.hidden = !v.primerOficial;
    const p = v.principal;
    principal.hidden = !p;
    if (p) {
      const firma = `${p.accion}|${p.clave}`;
      if (firma.split("|")[0] !== accionPrincipal.split("|")[0]) cambioEn = Date.now();
      accionPrincipal = firma;
      principal.dataset.accion = p.accion;
      principal.textContent = texto(p);
      principal.disabled = p.apagado;
      marcarOcupada(p);
    } else accionPrincipal = "";
    volver.hidden = !v.volver;
    volver.textContent = t("clVolver");
    if (v.volver) volver.dataset.accion = "volver";

    salidasFila.hidden = !v.salidas;
    aPrueba.textContent = t("modeSwitchToTest");
    cerrarSes.textContent = t("acctSignOut");
    aPrueba.hidden = !v.salidas?.prueba;
    aPrueba.disabled = !!v.salidas?.prueba?.apagado;
    cerrarSes.disabled = !!v.salidas?.cerrar.apagado;
    ubicarPiezas();

    // Se abrió con la principal apagada (revisando) y el foco en el título: cuando se prende, el foco pasa a ella.
    if (document.activeElement === titulo && !principal.disabled && !principal.hidden) principal.focus({ preventScroll: true });
    // El foco vuelve a donde estaba, si sigue ahí.
    if (enfocado && (!document.activeElement || !raiz.contains(document.activeElement))) {
      const de =
        enfocado === campoCodigo || enfocado === campoCorreo || enfocado === campoCupon
          ? enfocado.isConnected && !(enfocado as HTMLInputElement).disabled
            ? enfocado
            : null
          : enfocadoAccion
            ? raiz.querySelector<HTMLElement>(`[data-accion="${enfocadoAccion}"]:not([disabled]), [data-salida="${enfocadoAccion}"]:not([disabled])`)
            : null;
      (de ?? (principal.disabled || principal.hidden ? titulo : principal)).focus({ preventScroll: true });
    }
    const corriendo = st.codigo && Date.now() - st.codigo.desde < (OTRO_CODIGO_S + 1) * 1000;
    if (corriendo && !tic) tic = setInterval(alTic, 1000);
    if (!corriendo && tic) {
      clearInterval(tic);
      tic = null;
    }
  }
  repintar = pintar;

  /** Cada segundo con un código mandado: la cuenta de «Otro código en…», y a los 20 y 30 segundos, la vista entera. */
  function alTic(): void {
    if (cerrado || !st.codigo) return;
    const s = Math.floor((Date.now() - st.codigo.desde) / 1000);
    if (s === SPAM_S || s >= OTRO_CODIGO_S) return pintar();
    const b = raiz.querySelector<HTMLButtonElement>('[data-accion="otro-codigo"]');
    if (b && b.disabled) b.textContent = t("clOtroCodigoEn").replace("{s}", String(OTRO_CODIGO_S - s));
  }

  /**
   * Dónde va cada pieza según la pantalla. Con poca altura (celular acostado, laptop a 200 %), las salidas bajan al
   * final del cuerpo y en el pie queda la principal. Desde una tablet (`ANCHA`), las notas de las salidas pasan al pie:
   * debajo de las salidas, o a su izquierda con dos columnas. Así los pasos terminan en su botón, sin texto en el medio.
   */
  function ubicarPiezas(): void {
    const mira = (q: string): boolean => typeof matchMedia === "function" && matchMedia(q).matches;
    const bajo = mira("(max-height: 480px)");
    const donde = bajo ? contenido : pie;
    if (salidasFila.parentElement !== donde) {
      if (bajo) contenido.append(salidasFila);
      else pie.insertBefore(salidasFila, accionDelPie);
    }
    const ancha = mira(ANCHA);
    if (ancha && notas.parentElement !== pie) pie.prepend(notas);
    if (!ancha && notas.parentElement !== contenido) pasos.after(notas);
  }

  /** El campo recibe el foco y se lleva a la vista: en un celular chico la caja puede quedar abajo. */
  function enfocarCampo(campo: HTMLInputElement): void {
    campo.focus({ preventScroll: true });
    // En el celular, al medio: el campo no queda pegado al pie y se ve lo que dice arriba a dónde fue el código. Con el
    // pie pegado al contenido (`ANCHA`), solo lo justo: el título no se va de la vista.
    const ancha = typeof matchMedia === "function" && matchMedia(ANCHA).matches;
    campo.scrollIntoView?.({ block: ancha ? "nearest" : "center" });
    // Con un error debajo del campo (el del cupón), que se lea entero: los que dicen qué hacer son largos y, en un
    // celular chico, quedaban bajo el pie. Lo justo para verlo, sin sacar el campo de la vista.
    const error = campo.form?.querySelector(".cl-error");
    if (error) error.scrollIntoView?.({ block: "nearest" });
  }

  /* ------------------------------------------------ leer cómo está la cuenta */

  function aplicar(e: EstadoOficial): void {
    const antes = st.est;
    st.est = e;
    // Lo que sigue al canje lleva su propia cuenta de lo que corre: una lectura de fondo solo trae el estado.
    if (acc.cadena) return pintar();
    if (st.corre === "revisando") st.corre = null;
    if (!cuentaSesionViva()) st.falla = "sesion";
    else if (st.falla && ["red", "tarda", "fallo", "rara", "servicio", "prot-red"].includes(st.falla)) st.falla = null;
    else if (st.falla === "sin-pedido" && e.activacion !== "preparando") st.falla = null;
    if (antes.activacion !== "lista" && e.activacion === "lista") {
      if (st.corre === "activando" || st.corre === "esperando") {
        st.corre = null;
        // La activación que se esperaba entró: el servidor lo tiene que saber, y el cupo, también.
        if (acceso) void releerElAccesoTrasActivar();
      }
      st.aviso = e.proteccion === "lista" ? null : "clActivada";
    }
    if (antes.proteccion !== "lista" && e.proteccion === "lista") {
      marcarCodigo(false);
      st.codigo = null;
      st.codigoRecargado = false;
      if (antes.proteccion === "aparato-nuevo") st.aviso = e.activacion === "lista" ? `clAparatoListo${celular ? "Cel" : "Compu"}` : "clConfirmadoActivar";
      else st.aviso = "clProtegida";
    }
    if (e.proteccion !== "lista" && leerMarca() && !st.codigo) st.codigoRecargado = true;
    // Sin pedido todavía: se mira cada 4 segundos durante 20, y si no aparece, se dice.
    if (e.activacion === "preparando" && e.proteccion !== "aparato-nuevo" && e.proteccion !== "sin-forma") sondear();
    pintar();
  }

  function cuentaSesionViva(): boolean {
    try {
      return cuenta.sesionViva();
    } catch {
      return false;
    }
  }

  async function leer(fresco = true): Promise<void> {
    const n = ++lecturas;
    let e: EstadoOficial | null = null;
    enVuelo++;
    try {
      e = await conTopeSimple(cuenta.estadoOficial(fresco), TOPE_LECTURA_MS);
    } catch {
      e = null;
    } finally {
      enVuelo--;
    }
    // Un aviso que llegó mientras se leía se atiende una vez, al terminar: nunca dos lecturas por un mismo aviso.
    if (enVuelo === 0 && releerAlTerminar) {
      releerAlTerminar = false;
      alAviso();
    }
    if (cerrado || n !== lecturas) return;
    if (!e && acc.cadena) return;
    if (!e) {
      if (st.corre === "revisando") st.corre = null;
      st.falla = cuentaSesionViva() ? "red" : "sesion";
      pintar();
      return;
    }
    aplicar(e);
  }

  function sondear(): void {
    if (sondeo || sondeoAgotado) return;
    const ahora = Date.now();
    if (sondeoHasta === 0) sondeoHasta = ahora + SONDEO_SIN_PEDIDO_MS;
    if (ahora >= sondeoHasta) {
      sondeoHasta = 0;
      sondeoAgotado = true;
      st.sinPedidoVeces += 1;
      st.falla = st.sinPedidoVeces >= 2 ? "sin-pedido-fin" : "sin-pedido";
      return;
    }
    sondeo = despues(() => {
      sondeo = null;
      void leer(true);
    }, CADA_LECTURA_MS);
  }

  /**
   * Avisos de la cuenta (otra pestaña, volver a la pestaña, el kit): se vuelve a leer, de a uno. Con una lectura en
   * vuelo, el aviso solo queda anotado y se lee una vez cuando termina.
   */
  let releer: ReturnType<typeof setTimeout> | null = null;
  function alAviso(): void {
    // Lo que sigue al canje ya mira la cuenta a su ritmo: un aviso no suma lecturas.
    if (releer || cerrado || acc.cadena) return;
    if (enVuelo > 0) {
      releerAlTerminar = true;
      return;
    }
    releer = despues(() => {
      releer = null;
      void leer(true);
    }, 300);
  }

  /* ------------------------------------------------ las acciones */

  /** El reloj de «está tardando»: a los 8 segundos de empezar lo que corre, `lento`. Lo reinicia `correr`. */
  function armarLento(): void {
    st.lento = false;
    if (relojLento) clearTimeout(relojLento);
    relojLento = despues(() => ((st.lento = true), pintar()), LENTO_MS);
  }

  function pararLento(): void {
    st.lento = false;
    if (relojLento) clearTimeout(relojLento);
    relojLento = null;
  }

  function correr(c: Corre): void {
    st.corre = c;
    if (c && c !== "mandando" && c !== "cerrando") armarLento();
    else pararLento();
  }

  /**
   * El voto que activa la cuenta: el único lugar de la página que lo pide (una prueba lo fija). Lo llaman solo «Activar
   * mi cuenta», «Activar con mi cupón» y «Probar de nuevo» después de un canje, siempre desde un toque de la persona.
   */
  function votarLaActivacion(): Promise<ResultadoDeActivar> {
    return cuenta.activarCuenta();
  }

  async function activar(): Promise<void> {
    // Falla cerrado: sin el acceso confirmado (o sin el build del plan B1), no hay voto, aunque el botón llegara a estar.
    if (!activarPermitido(entrada())) return;
    st.falla = null;
    st.aviso = null;
    correr("activando");
    pintar();
    try {
      const r = await votarLaActivacion();
      if (cerrado) return;
      if (r === "activada") {
        correr(null);
        st.est = { ...st.est, activacion: "lista" };
        st.aviso = st.est.proteccion === "lista" ? null : "clActivada";
        pintar();
        void leer(false);
        if (acceso) void releerElAccesoTrasActivar();
        return;
      }
      if (r === "no-hay") {
        correr(null);
        st.est = { ...st.est, activacion: "preparando" };
        sondeoHasta = 0;
        sondeoAgotado = false;
        sondear();
        pintar();
        return;
      }
      // Pendiente: el voto salió y la cuenta todavía no aparece. Se mira cada 4 segundos, sin votar otra vez.
      correr("esperando");
      esperaHasta = Date.now() + ESPERA_ACTIVACION_MS;
      pintar();
      esperarActivacion();
    } catch (e) {
      if (cerrado) return;
      correr(null);
      st.falla = fallaDeActivar(e, cuentaSesionViva());
      pintar();
    }
  }

  function esperarActivacion(): void {
    despues(async () => {
      if (st.corre !== "esperando") return;
      await leer(true);
      if (st.corre !== "esperando") return;
      if (Date.now() >= esperaHasta) {
        correr(null);
        st.falla = "tarda";
        pintar();
        return;
      }
      esperarActivacion();
    }, CADA_LECTURA_MS);
  }

  /* ------------------------------------------------ el acceso y el cupón (el cobro por uso) */

  /** Lo que dijo el servidor del acceso. */
  function aplicarAcceso(r: ResultadoDeAlta<EstadoDeAlta>): void {
    if (r.ok) {
      acc.estado = r.datos.acceso === "ninguno" ? "ninguno" : "con";
      acc.por = r.datos.acceso === "ninguno" ? null : r.datos.acceso;
      acc.fondeo = r.datos.fondeo;
      acc.error = null;
      acc.arreglo = "probar";
      return;
    }
    acc.estado = "error";
    acc.error = { clave: r.clave, vars: r.vars };
    acc.arreglo = arregloDe(r);
  }

  /** Qué acceso tiene la persona: al abrir y con «Probar de nuevo». Sin token no se pregunta (lo dice `acceso.estado`). */
  async function leerAcceso(): Promise<void> {
    if (!acceso || acc.cadena) return;
    const n = ++lecturasDeAcceso;
    acc.estado = "revisando";
    acc.error = null;
    // Esta lectura puede durar hasta 17 segundos: con nada más corriendo, el reloj de «está tardando» es suyo.
    if (st.corre === null) armarLento();
    pintar();
    let r: ResultadoDeAlta<EstadoDeAlta>;
    try {
      r = await conTopeSimple(acceso.estado(), TOPE_LECTURA_SERVIDOR_MS);
    } catch {
      r = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };
    }
    if (cerrado || n !== lecturasDeAcceso) return;
    aplicarAcceso(r);
    if (st.corre === null) pararLento();
    pintar();
    // Se abrió para escribir el cupón y nadie tocó nada todavía: el foco va al campo.
    if (acc.escribiendo && campoCupon.isConnected && !campoCupon.disabled && document.activeElement === titulo) enfocarCampo(campoCupon);
  }

  /**
   * Después de activar, se le vuelve a preguntar al servidor: así cuenta esa activación una sola vez en sus créditos.
   * Y el cupo de la línea de abajo se pregunta de nuevo. De fondo: si no contesta, no cambia nada de lo que se ve.
   */
  async function releerElAccesoTrasActivar(): Promise<void> {
    if (!acceso) return;
    try {
      const r = await conTopeSimple(acceso.estado(), TOPE_LECTURA_SERVIDOR_MS);
      if (r.ok && !cerrado && !acc.cadena) {
        aplicarAcceso(r);
        pintar();
      }
    } catch {
      /* de fondo: lo que no contestó no cambia lo que se ve */
    }
    acceso.refrescarCupo();
  }

  /** Una pausa que se corta si el paso se cierra (la promesa queda sin resolver: nadie la espera). */
  const pausa = (ms: number): Promise<void> => new Promise((r) => void despues(r, ms));

  /** Después del canje, con la cuenta que se abre en el momento: el pedido de crearla, cada 2 segundos y hasta 20 veces. */
  async function esperarPedido(): Promise<"hay" | "lista" | "no"> {
    for (let i = 0; i < PEDIDO_VECES; i++) {
      if (i > 0) await pausa(PEDIDO_CADA_MS);
      let e: EstadoOficial | null = null;
      try {
        // Sin pedirle a Pollar que relea la billetera: el kit ya la mira solo, y acá alcanza con los pedidos pendientes.
        e = await conTopeSimple(cuenta.estadoOficial(false), TOPE_LECTURA_MS);
      } catch {
        e = null;
      }
      if (cerrado) return "no";
      if (e) {
        st.est = e;
        if (e.activacion === "lista") return "lista";
        if (e.activacion === "falta") return "hay";
      }
    }
    return "no";
  }

  /** El voto salió y la cuenta todavía no aparece: se mira cada 4 segundos, hasta un minuto, sin votar otra vez. */
  async function esperarQueSeActive(): Promise<boolean> {
    const hasta = Date.now() + ESPERA_ACTIVACION_MS;
    while (Date.now() < hasta) {
      await pausa(CADA_LECTURA_MS);
      try {
        const e = await conTopeSimple(cuenta.estadoOficial(true), TOPE_LECTURA_MS);
        if (cerrado) return false;
        st.est = e;
        if (e.activacion === "lista") return true;
      } catch {
        /* se mira otra vez */
      }
    }
    return false;
  }

  /**
   * «Activar con mi cupón»: canjea en el servidor y sigue con lo que diga el canje. Un doble toque, o cerrar y volver a
   * abrir mientras el servidor contesta, no canjean dos veces (`canjearUnaVez`). Un cupón escrito se guarda en la pestaña
   * antes de mandarlo, así no se pierde si se cierra el paso; se olvida cuando se canjea, o si no sirve.
   */
  async function usarCupon(): Promise<void> {
    if (!acceso || st.corre === "canjeando" || acc.cadena || acc.fallo) return;
    const codigo = acc.escribiendo ? normalizar(campoCupon.value) : acceso.cuponGuardado();
    if (!codigo) {
      acc.escribiendo = true;
      acc.error = { clave: "altaErrForma" };
      acc.arreglo = "probar";
      pintar();
      enfocarCampo(campoCupon);
      return;
    }
    if (acc.escribiendo) acceso.guardarCupon(codigo);
    acc.error = null;
    st.falla = null;
    st.aviso = null;
    correr("canjeando");
    pintar();
    const r = await canjearUnaVez(acceso, codigo);
    if (cerrado) return;
    correr(null);
    if (!r.ok) {
      acc.error = { clave: r.clave, vars: r.vars };
      acc.arreglo = arregloDe(r);
      if (CUPON_QUE_NO_SIRVE.has(r.motivo)) {
        // Ese cupón no sirve: se olvida, y queda escrito en el campo para corregirlo (la principal, apagada hasta que cambie).
        acceso.olvidarCupon();
        acc.escribiendo = true;
        acc.codigoMalo = codigo;
        campoCupon.value = mostrar(codigo);
      }
      pintar();
      if (acc.escribiendo) {
        enfocarCampo(campoCupon);
        campoCupon.select();
      }
      return;
    }
    // El mismo cupón otra vez, y ya gastado: el servidor no suma nada y no quedan sorteos. Seguir llevaba a «Listo» y la
    // compuerta volvía a «Se te acabaron» sin decir por qué: se dice que ese cupón ya se usó, como un cupón que no sirve.
    if (r.datos.repetido && r.datos.sorteosSumados === 0 && r.datos.sorteos.quedan === 0) {
      acc.error = { clave: "altaErrUsado" };
      acc.arreglo = "probar";
      acceso.olvidarCupon();
      acc.escribiendo = true;
      acc.codigoMalo = codigo;
      campoCupon.value = mostrar(codigo);
      pintar();
      enfocarCampo(campoCupon);
      campoCupon.select();
      return;
    }
    // El servidor ya lo tiene: desde acá, nada vuelve a canjear.
    acc.codigoMalo = null;
    acc.estado = "con";
    acc.por = "cupon";
    acc.pideCupon = false;
    acc.canjeado = r.datos.sorteosSumados > 0 ? r.datos.sorteosSumados : r.datos.sorteos.quedan;
    acc.escribiendo = false;
    campoCupon.value = "";
    const sigue = r.datos.sigue;
    // Crear la billetera y abrir la cuenta desde el servidor todavía no están: el cupón quedó, y se sigue al volver.
    const desde: PasoDelCanje | null = sigue === "lista" ? "estado" : sigue === "activar" && acc.fondeo === "inmediato" ? "pedido" : null;
    if (!desde) {
      acc.fallo = "estado";
      pintar();
      return;
    }
    await seguirCadena(desde);
  }

  /**
   * Justo antes del voto que activa: el acceso de esta sesión, preguntado otra vez. «si» con el acceso confirmado para la
   * cuenta de la sesión. «no» cuando el servidor dice que no hay acceso o que es de otra cuenta: queda dicho en la caja y
   * la cadena termina. Sin respuesta, o sin la cuenta, lanza `sin-acceso`, y «Probar de nuevo» pregunta otra vez antes
   * de votar.
   */
  async function accesoParaVotar(): Promise<"si" | "no"> {
    if (!acceso) throw new Error("sin-acceso");
    let e: ResultadoDeAlta<EstadoDeAlta>;
    try {
      e = await conTopeSimple(acceso.estado(), TOPE_LECTURA_SERVIDOR_MS);
    } catch {
      throw new Error("sin-acceso");
    }
    if (cerrado) return "no";
    const mia = cuentaDelAcceso(acceso);
    if (e.ok && e.datos.acceso !== "ninguno" && e.datos.cuenta !== null && (mia === null || e.datos.cuenta === mia)) return "si";
    if (!e.ok && e.clave === "clErrSesion") {
      st.falla = "sesion";
      throw new Error("sin-acceso");
    }
    if ((e.ok && e.datos.acceso === "ninguno") || (!e.ok && e.clave === "altaErrCuentaDeOtro")) {
      aplicarAcceso(e);
      acc.canjeado = null;
      acc.cadena = false;
      correr(null);
      pintar();
      return "no";
    }
    if (e.ok && e.datos.cuenta !== null && mia !== null && e.datos.cuenta !== mia) {
      aplicarAcceso({ ok: false, clave: "altaErrCuentaDeOtro", vars: {}, motivo: "cuenta-de-otro", estado: 0 });
      acc.cadena = false;
      correr(null);
      pintar();
      return "no";
    }
    throw new Error("sin-acceso");
  }

  /** Lo que sigue al canje, desde `desde`. Si algo no sale, `altaCuponGuardado` y «Probar de nuevo» sigue desde ahí. */
  async function seguirCadena(desde: PasoDelCanje): Promise<void> {
    if (!acceso || acc.cadena) return;
    acc.cadena = true;
    acc.fallo = null;
    st.falla = null;
    st.aviso = null;
    let paso: PasoDelCanje = desde;
    let activo = false;
    try {
      if (paso === "pedido") {
        correr("activando");
        pintar();
        const p = await esperarPedido();
        if (cerrado) return;
        if (p === "no") throw new Error("sin-pedido");
        paso = p === "lista" ? "estado" : "activar";
      }
      if (paso === "activar") {
        correr("activando");
        pintar();
        // Falla cerrado: el voto le cuesta créditos a Tinkazo. Antes de pedirlo, el servidor confirma con la sesión de
        // ahora que esta misma cuenta tiene acceso. Si el acceso quedó en otra cuenta, o el servidor no lo ve, no se vota.
        if ((await accesoParaVotar()) === "no") return;
        if (cerrado) return;
        let r: ResultadoDeActivar | "esperada" = await votarLaActivacion();
        if (cerrado) return;
        if (r === "pendiente") r = (await esperarQueSeActive()) ? "esperada" : "pendiente";
        if (cerrado) return;
        if (r !== "activada" && r !== "esperada") throw new Error(r === "no-hay" ? "sin-pedido" : "tarda");
        st.est = { ...st.est, activacion: "lista" };
        activo = true;
        paso = "estado";
      }
      correr("revisando");
      pintar();
      const e = await conTopeSimple(acceso.estado(), TOPE_LECTURA_SERVIDOR_MS);
      if (cerrado) return;
      if (!e.ok) {
        if (e.clave === "clErrSesion") st.falla = "sesion";
        // El acceso quedó en otra cuenta: probar de nuevo no lo arregla, se dice con su texto (escribirnos o Prueba).
        if (e.clave === "altaErrCuentaDeOtro") {
          aplicarAcceso(e);
          acc.cadena = false;
          correr(null);
          pintar();
          return;
        }
        throw new Error("estado");
      }
      aplicarAcceso(e);
      acceso.refrescarCupo();
      acc.cadena = false;
      correr(null);
      st.aviso = activo && st.est.proteccion !== "lista" ? "clActivada" : null;
      pintar();
      void leer(false);
    } catch (x) {
      if (cerrado) return;
      acc.cadena = false;
      correr(null);
      const m = mensaje(x);
      if (paso === "activar" && !["sin-pedido", "tarda", "sin-acceso"].includes(m)) {
        // La activación falló con lo suyo: sin sesión, o sin arreglo desde acá, se dice como siempre.
        const f = fallaDeActivar(x, cuentaSesionViva());
        if (f === "sesion" || f === "tope") {
          st.falla = f;
          pintar();
          return;
        }
      }
      if (st.falla === "sesion" || !cuentaSesionViva()) {
        st.falla = "sesion";
        pintar();
        return;
      }
      acc.fallo = paso;
      pintar();
    }
  }

  /** Lo que devolvió una protección o una confirmación de este navegador. */
  function protegida(lista: boolean): void {
    if (cerrado) return;
    correr(null);
    if (!lista) {
      st.falla = "prot-no-quedo";
      pintar();
      return;
    }
    const antes = st.est;
    aplicar({ ...st.est, proteccion: "lista" });
    if (antes.proteccion === "aparato-nuevo" && antes.activacion !== "lista") void leer(true);
    else void leer(false);
  }

  const aparato = (): boolean => st.est.proteccion === "aparato-nuevo";

  async function desbloquear(): Promise<void> {
    st.falla = null;
    st.aviso = null;
    correr("desbloqueo");
    pintar();
    const llamada = aparato() ? cuenta.confirmarAparatoConDesbloqueo() : cuenta.protegerConPasskey();
    try {
      protegida(await conTope(llamada, (tarde) => tarde && protegida(true)));
    } catch (e) {
      if (cerrado) return;
      correr(null);
      if (e === SIN_RESPUESTA) st.falla = "prot-tarda";
      else if (noPermitido(e)) {
        // El navegador no lo dejó abrir (o se cerró el cuadro: para el navegador es lo mismo): una nota, y el correo primero.
        st.falla = "desbloqueo-bloqueado";
        st.desbloqueoFallo = true;
      } else if (cancelo(e)) st.falla = null;
      else if (esDeRed(e)) st.falla = "prot-red";
      else {
        st.falla = "desbloqueo";
        st.desbloqueoFallo = true;
      }
      pintar();
    }
  }

  async function mandar(destino: string | null, mostrar: string, otraVez = false): Promise<void> {
    st.falla = null;
    st.aviso = null;
    correr("mandando");
    pintar();
    try {
      if (aparato()) await cuenta.mandarCodigoParaEsteAparato();
      else await cuenta.mandarCodigoDeProteccion(destino ?? "");
      if (cerrado) return;
      correr(null);
      st.codigo = { a: mostrar, destino, desde: Date.now() };
      st.codigoRecargado = false;
      if (otraVez) st.aviso = "protReenviado";
      marcarCodigo(true);
      campoCodigo.value = "";
      pintar();
      enfocarCampo(campoCodigo);
    } catch (e) {
      if (cerrado) return;
      correr(null);
      st.falla = esDeRed(e) ? "prot-red" : "correo-fallo";
      pintar();
    }
  }

  async function confirmarCodigo(): Promise<void> {
    const c = limpio();
    if (c.length < 4) return;
    st.falla = null;
    st.aviso = null;
    correr("confirmando");
    pintar();
    const llamada = aparato() ? cuenta.confirmarCodigoParaEsteAparato(c) : cuenta.confirmarCodigoDeProteccion(c);
    try {
      protegida(await conTope(llamada, (tarde) => tarde && protegida(true)));
    } catch (e) {
      if (cerrado) return;
      correr(null);
      st.falla = fallaDelCodigo(e);
      pintar();
      if (st.falla === "codigo-malo") campoCodigo.select();
    }
  }

  async function salir(y: "nada" | "entrar"): Promise<void> {
    correr("cerrando");
    pintar();
    let vencio = false;
    try {
      // Con tope: una red colgada (un portal del wifi) no deja a nadie encerrado en el paso. Si vence, el paso se cierra
      // igual y el cierre de sesión sigue de fondo.
      await conTopeSimple(Promise.resolve().then(() => salidas.cerrarSesion()), TOPE_CERRAR_MS);
    } catch (e) {
      vencio = mensaje(e) === "tope";
    }
    cerrar(false, true);
    // Con el cierre todavía en curso no se vuelve a entrar: al terminar borraría la sesión nueva.
    if (y === "entrar" && !vencio) await Promise.resolve(salidas.entrarDeNuevo()).catch(() => undefined);
  }

  async function hacer(a: Accion): Promise<void> {
    if (cerrado) return;
    switch (a) {
      case "activar":
        return activar();
      case "leer":
        st.falla = st.falla === "sin-pedido" ? null : st.falla;
        correr("revisando");
        sondeoHasta = 0;
        sondeoAgotado = false;
        pintar();
        return leer(true);
      case "desbloqueo":
        return desbloquear();
      case "mandar-codigo":
        return mandar(aparato() ? null : correoSesion, aparato() ? ocultarCorreo(st.est.correoDeLaCuenta ?? "") || ocultarCorreo(correoSesion) : ocultarCorreo(correoSesion));
      case "mandar-a-mano": {
        const dir = campoCorreo.value.trim();
        if (!mailOk(dir)) {
          st.falla = "correo-malo";
          return pintar();
        }
        codigoAMano = true;
        // Escrito a mano, se muestra entero: la persona ve a quién le dio el poder de recuperar su cuenta.
        return mandar(dir, dir);
      }
      case "otro-codigo":
        return mandar(st.codigo?.destino ?? (codigoAMano ? campoCorreo.value.trim() : correoSesion), st.codigo?.a ?? ocultarCorreo(correoSesion), true);
      case "otro-correo":
        st.eligioCorreo = true;
        st.codigo = null;
        st.falla = null;
        st.codigoRecargado = false;
        pintar();
        enfocarCampo(campoCorreo);
        return;
      case "confirmar-codigo":
        return confirmarCodigo();
      case "pasar-a-prueba":
        if (salidas.puedePasarAPrueba()) salidas.pasarAPrueba();
        return;
      case "salir-y-entrar":
      case "entrar-de-nuevo":
        return salir("entrar");
      case "seguir":
      case "sortear":
        cerrar(true);
        op.alSeguir?.();
        return;
      case "sellar":
        op.primerOficial?.marcar();
        cerrar(true);
        op.alSeguir?.();
        return;
      case "volver":
        cerrar(false);
        return;
      case "tengo-cupon":
      case "otro-cupon":
        acc.escribiendo = true;
        acc.error = null;
        if (a === "otro-cupon") campoCupon.value = "";
        pintar();
        enfocarCampo(campoCupon);
        return;
      case "volver-cupon":
        acc.escribiendo = false;
        acc.error = null;
        pintar();
        return;
      case "usar-cupon":
        return usarCupon();
      case "leer-acceso":
        return leerAcceso();
      case "seguir-cupon":
        if (acc.fallo) return seguirCadena(acc.fallo);
        return;
    }
  }

  /** Un toque de verdad: no uno simulado, ni el Enter del código de entrada que cae al abrirse, ni uno de más. */
  function confiable(ev: Event): boolean {
    return ev.isTrusted || confiarEnClicsDePrueba;
  }

  principal.addEventListener("click", (ev) => {
    if (!confiable(ev) || principal.disabled) return;
    if (Date.now() - cambioEn < GUARDA_DE_TOQUE_MS || Date.now() - abiertoEn < GUARDA_DE_TOQUE_MS) return;
    const a = principal.dataset.accion as Accion | undefined;
    if (a) void hacer(a);
  });
  volver.addEventListener("click", (ev) => {
    if (confiable(ev)) cerrar(false);
  });
  aPrueba.addEventListener("click", (ev) => {
    if (confiable(ev)) void hacer("pasar-a-prueba");
  });
  cerrarSes.addEventListener("click", (ev) => {
    if (confiable(ev)) void salir("nada");
  });
  for (const b of raiz.querySelectorAll<HTMLButtonElement>(".cl-idioma")) {
    b.addEventListener("click", () => {
      const l = b.dataset.lang;
      if (l === "es" || l === "en") chooseLang(l);
      pintar();
    });
  }
  campoCorreo.addEventListener("input", () => {
    if (st.falla === "correo-malo") st.falla = null;
    actualizarPrincipalDelCampo();
  });
  campoCodigo.addEventListener("input", () => {
    if (st.falla === "codigo-malo") st.falla = null;
    actualizarPrincipalDelCampo();
  });
  campoCupon.addEventListener("input", () => {
    // Los guiones se ponen solos, y el cursor queda después de lo mismo que se había escrito.
    const crudo = campoCupon.value;
    const cursor = campoCupon.selectionStart ?? crudo.length;
    const antes = formatoDelCupon(crudo.slice(0, cursor)).replace(/-/g, "").length;
    const nuevo = formatoDelCupon(crudo);
    if (nuevo !== crudo) {
      campoCupon.value = nuevo;
      const pos = antes === 0 ? 0 : antes + Math.floor((antes - 1) / 4);
      try {
        campoCupon.setSelectionRange(Math.min(pos, nuevo.length), Math.min(pos, nuevo.length));
      } catch {
        /* sin selección (un campo que no está a la vista) */
      }
    }
    if (acc.error) {
      acc.error = null;
      acc.arreglo = "probar";
      campoCupon.setAttribute("aria-invalid", "false");
    }
    actualizarPrincipalDelCampo();
  });
  /**
   * Apagada porque corre lo suyo («Activando tu cuenta…») se ve entera y con la ruedita; apagada porque falta algo
   * («Confirmar» sin el código), con el rosa claro y el borde punteado. Así no se confunde esperar con escribir.
   */
  function marcarOcupada(p: Boton): void {
    if (p.ocupado) principal.setAttribute("aria-busy", "true");
    else principal.removeAttribute("aria-busy");
  }
  /** Lo escrito prende o apaga la principal sin repintar todo (el foco queda en el campo). */
  function actualizarPrincipalDelCampo(): void {
    const v = vistaDe(entrada());
    const p = v.principal;
    // Lo escrito cambió la acción (un error del cupón sin arreglo que se borra al corregir): se pinta todo.
    if ((p?.accion ?? "") !== (principal.hidden ? "" : (principal.dataset.accion ?? ""))) return pintar();
    if (p && principal.dataset.accion === p.accion) {
      principal.disabled = p.apagado;
      marcarOcupada(p);
    }
    for (const sec of v.cajas.flatMap((c) => c.secundarios)) {
      const b = raiz.querySelector<HTMLButtonElement>(`[data-accion="${sec.accion}"]:not(.cl-principal)`);
      if (b) b.disabled = sec.apagado;
    }
    const err = raiz.querySelector(".cl-error");
    if (err && !st.falla) err.remove();
  }

  // El teclado de un celular chico tapa medio paso: mientras se escribe, lo que sobra se esconde.
  const alEnfocar = (ev: FocusEvent): void => {
    const vv = (window as { visualViewport?: { height: number } }).visualViewport;
    const ese = ev.target;
    if ((ese === campoCodigo || ese === campoCorreo || ese === campoCupon) && vv && vv.height < 500) {
      raiz.classList.add("cl-tecleando");
      setTimeout(() => (ese as HTMLElement).scrollIntoView?.({ block: "center" }), 50);
    }
  };
  const alDesenfocar = (): void => raiz.classList.remove("cl-tecleando");
  raiz.addEventListener("focusin", alEnfocar);
  raiz.addEventListener("focusout", alDesenfocar);

  /* ------------------------------------------------ teclado, foco y cierre */

  const alTeclear = (ev: KeyboardEvent): void => {
    if (cerrado) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      if (vistaActual?.final || vistaActual?.volver) {
        // Al final, Escape es «Volver» (o «Seguir», si se abrió al entrar). Nunca sella ni sortea. Antes del final, solo
        // cuando el paso se abrió para usar un cupón con la cuenta ya lista: ahí también es «Volver».
        cerrar(op.para === "entrada");
        return;
      }
      (aPrueba.hidden || aPrueba.disabled ? cerrarSes : aPrueba).focus({ preventScroll: true });
      return;
    }
    if (ev.key !== "Tab") return;
    const items = [...raiz.querySelectorAll<HTMLElement>(FOCO)].filter((el) => !el.closest("[hidden]"));
    const primero = items[0];
    const ultimo = items[items.length - 1];
    if (!primero || !ultimo) return;
    const en = document.activeElement;
    if (!(en instanceof Node) || !raiz.contains(en)) {
      ev.preventDefault();
      (ev.shiftKey ? ultimo : primero).focus();
    } else if (ev.shiftKey && en === primero) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && en === ultimo) {
      ev.preventDefault();
      primero.focus();
    }
  };

  const alCambiarSesion = (ev: Event): void => {
    const d = (ev as CustomEvent<string | null>).detail ?? null;
    if (op.direccion !== undefined && d !== op.direccion) cerrar(false, true);
  };
  const alRedimensionar = (): void => ubicarPiezas();

  const inertes: HTMLElement[] = [];
  let soltarAvisos: () => void = () => undefined;

  function devolverFoco(vez = 0): void {
    const destino = op.volverA;
    if (destino instanceof HTMLElement && destino.isConnected && !(destino as HTMLButtonElement).disabled) return destino.focus({ preventScroll: true });
    if (vez < 15 && destino instanceof HTMLElement && destino.isConnected) {
      setTimeout(() => devolverFoco(vez + 1), 100);
      return;
    }
    const sellar = document.getElementById("btn-freeze") as HTMLButtonElement | null;
    if (sellar && !sellar.disabled && sellar.offsetParent !== null) return sellar.focus({ preventScroll: true });
    document.getElementById("btn-pegar")?.focus({ preventScroll: true });
  }

  function cerrar(valor: boolean, sinFoco = false): void {
    if (cerrado) return;
    cerrado = true;
    for (const r of relojes) clearTimeout(r);
    relojes.clear();
    if (tic) clearInterval(tic);
    soltarAvisos();
    document.removeEventListener("keydown", alTeclear, true);
    document.removeEventListener("tinkazo:sesion", alCambiarSesion);
    window.removeEventListener("resize", alRedimensionar);
    raiz.remove();
    for (const el of inertes) {
      el.inert = false;
      el.removeAttribute("inert");
    }
    document.documentElement.classList.remove("con-cuenta-lista");
    abierto = null;
    repintar = null;
    resolver(valor);
    if (!sinFoco) devolverFoco();
  }

  /* ------------------------------------------------ abrir */

  // Lo de atrás no existe mientras el paso está abierto.
  document.querySelectorAll(".wallet-notice").forEach((n) => n.remove());
  for (const el of [...document.body.children]) {
    if (el instanceof HTMLElement && el !== raiz && !el.inert && !el.hasAttribute("inert")) {
      el.inert = true;
      el.setAttribute("inert", "");
      inertes.push(el);
    }
  }
  document.documentElement.classList.add("con-cuenta-lista");
  document.body.append(raiz);
  try {
    soltarPantallaCompleta();
  } catch {
    /* sin pantalla completa, nada que soltar */
  }
  op.alAbrir?.();
  document.addEventListener("keydown", alTeclear, true);
  document.addEventListener("tinkazo:sesion", alCambiarSesion);
  window.addEventListener("resize", alRedimensionar);
  try {
    soltarAvisos = cuenta.alCambiarLaCuenta(alAviso);
  } catch {
    soltarAvisos = () => undefined;
  }
  if (typeof window !== "undefined") {
    const alVolverLaRed = (): void => alAviso();
    window.addEventListener("online", alVolverLaRed);
    const antes = soltarAvisos;
    soltarAvisos = () => {
      antes();
      window.removeEventListener("online", alVolverLaRed);
    };
  }
  st.codigoRecargado = st.est.proteccion !== "lista" && leerMarca();
  abiertoEn = Date.now();
  cambioEn = abiertoEn;
  pintar();
  (principal.disabled || principal.hidden ? titulo : principal).focus({ preventScroll: true });
  void (op.puedeUsarDesbloqueo?.() ?? Promise.resolve(false)).then(
    (si) => {
      st.hayDesbloqueo = si;
      pintar();
    },
    () => undefined,
  );
  // El paso se abre revisando la cuenta (`st.corre`), y esa espera también cuenta para decir que tarda.
  armarLento();
  void leer(true);
  void leerAcceso();
  return promesa;
}
