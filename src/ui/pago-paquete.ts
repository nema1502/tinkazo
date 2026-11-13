import { getLang, t } from "../i18n";
import { ESPERA_MS, type ErrorDeAlta, type OrdenDePago, type PagoDeOrden, type ResultadoDeAlta, fechaDeAlta } from "../stellar/alta-api";
import { type Oferta, type ProductoALaVenta, claveDelProducto, varsDelProducto } from "../stellar/alta-oferta";
import type { MotivoDelPago } from "../stellar/pago-con-saldo";
import { TOPE_TOKEN_MS } from "../stellar/pollar-config";
import { type SaldoDeDolares, alcanza, faltaPara } from "../stellar/saldo-dolares";
import type { Texto } from "./cuenta-lista-estado";
import { abrirDialogo, botonPrincipal, lineaDeEstado } from "./dialogo";
import { recordarMedio } from "./medio-de-pago";
import { armarPanelDePago } from "./pago-panel";
import { type FaseDelSaldo, type PagoConSaldo, type SaldoCorto, lineaDelSaldo, mediosConSaldo, textoDelCorto, trasPagar, vistaDelSaldo } from "./pago-saldo";
import { type Sondeo, vigilarPago } from "./pago-sondeo";
import { MEDIOS_DE_PAGO, type MedioDePago, NO_SE_VENDE, type PanelDePago, faltaDe, lineaDelPago, panelDe, textoDelErrorDeLaOrden, textoDelErrorDelPago, vencidaSinPagar } from "./pago-vista";

/**
 * «Sumar sorteos»: la ventana para comprar un paquete de sorteos oficiales con la cuenta ya lista (la abren la ventana
 * «Se te acabaron los sorteos oficiales» y la línea del cupo cuando quedan pocos). Comprar un paquete no es activar la
 * cuenta: por eso no vive en «Dejá tu cuenta lista».
 *
 * - Lo que se vende sale del servidor (`oferta`), y la cuenta, el monto y la nota, de la orden que devolvió (`orden`):
 *   acá no se escribe ningún precio ni ningún dato del pago.
 * - Con un paquete a la venta, directo a los datos para pagar; con varios, primero cuál (el primero es la principal).
 * - «Ya pagué» mira solo cada 10 segundos durante 5 minutos (`pago-sondeo.ts`). Llegó: los sorteos que quedan, como los
 *   dice el servidor. Llegó de menos: cuánto, y que se completa con la misma nota. Venció: otra nota. Tarda, sin
 *   conexión, la venta en pausa: cada uno con su texto y su única acción principal, en el pie.
 * - Poco texto: una sola línea a la vista en cada estado, los datos con su rótulo, y lo demás plegado en Más detalles.
 * - Con `saldo` (pagar con los dólares digitales de la cuenta, `pago-saldo.ts`): si alcanza para el paquete, antes de la
 *   orden se pregunta cómo pagar, con el saldo de principal; si hay algo y no alcanza, el panel lo dice. Sin `saldo`,
 *   como siempre.
 *
 * `vistaDelPaquete` decide qué se ve, sin DOM (se prueba en una tabla); `abrirSumarSorteos` lo pinta y corre las acciones.
 */

/** Lo que la ventana le pide al servidor de las altas (`cuenta-lista-acceso.ts`, con la compra en el build). Nada lanza. */
export interface CompraDePaquetes {
  oferta(): Promise<Oferta>;
  orden(producto: string): Promise<ResultadoDeAlta<OrdenDePago>>;
  pago(id: string): Promise<ResultadoDeAlta<PagoDeOrden>>;
  /** Vuelve a preguntar el cupo de la cuenta, para la línea de abajo, después de que llega el pago. */
  refrescarCupo(): void;
  /** Pagar con el saldo de la cuenta: solo con `VITE_PAGO_CON_SALDO` y la billetera del proveedor. */
  saldo?: PagoConSaldo;
  /**
   * Antes de pagar con el saldo, preguntarle al servidor cómo está la orden: solo con la compra con QR en el build
   * (`compraQrActiva`), donde lo que llegó con el QR puede sumarse a la orden. Sin ella, como siempre.
   */
  preguntarAntesDePagar?: boolean;
}

/** `medio`: cómo pagar, solo cuando el saldo alcanza (antes de pedir la orden). */
export type FaseDelPaquete = "leyendo" | "elegir" | "medio" | "pidiendo" | "pagando" | "listo" | "sin-venta";

export interface EstadoDelPaquete {
  idioma: "es" | "en";
  fase: FaseDelPaquete;
  /** Los paquetes que el servidor vende ahora. */
  paquetes: ProductoALaVenta[];
  /** El que se eligió, o `null`. */
  elegido: ProductoALaVenta | null;
  orden: OrdenDePago | null;
  falta: { recibido: string; total: string } | null;
  buscando: boolean;
  noVisto: boolean;
  tarda: boolean;
  noLlego: boolean;
  vencida: boolean;
  error: Texto | null;
  /** Qué arregla el error: volver a probar, o nada desde acá (se cierra). */
  arreglo: "probar" | "ninguno";
  /** Los sorteos oficiales que quedan después del pago, como los dijo el servidor. */
  quedan: number | null;
  /** El correo de la sesión, ya tapado, o vacío. */
  correo: string;
  /** Los medios para el paquete elegido (con el saldo primero, solo si alcanza). */
  medios: readonly MedioDePago[];
  /** El medio con que se está pagando: `app` (los datos para pagar) o `saldo`. */
  medio: string;
  /** El saldo leído de la cuenta, con siete decimales, o `null`. */
  saldo: string | null;
  /** Hay saldo y no alcanza: lo que hay y lo que falta, para el renglón del panel. */
  corto: SaldoCorto | null;
  /** Dónde está el pago con el saldo (`pago-saldo.ts`). */
  saldoFase: FaseDelSaldo;
  /** No se sabe si el pago con el saldo salió: no se ofrece pagar de nuevo. */
  incierto: boolean;
  /** Por qué no salió el último pago con el saldo. */
  motivo: MotivoDelPago | null;
  /** Se ofrece Estoy en Bolivia en el panel (`OpcionesDeSumar.alQr`). */
  cambio: boolean;
}

export type AccionDelPaquete = "elegir" | "pedir" | "ya-pague" | "no-llego" | "otra-nota" | "cerrar" | "medio-saldo" | "medio-app" | "saldo-pagar" | "saldo-otro-medio";

export interface BotonDelPaquete extends Texto {
  accion: AccionDelPaquete;
  apagado: boolean;
  /** Corre esto mismo («Buscando tu pago…»): apagada, con la ruedita. */
  ocupado?: boolean;
  /** El paquete del botón, en «elegir». */
  producto?: string;
  forma?: "boton" | "texto";
}

export interface VistaDelPaquete {
  textos: Texto[];
  /** Los datos para pagar, de la orden tal cual: solo pagando. */
  panel: PanelDePago | null;
  /** Lo que se sabe del pago (llegó de menos, tarda, no llegó), con `role="status"`. */
  nota: Texto | null;
  error: Texto | null;
  secundarios: BotonDelPaquete[];
  cierre: Texto[];
  /** La única acción principal, en el pie. */
  principal: BotonDelPaquete;
  /** La línea de estado del pie. */
  estado: Texto | null;
}

const boton = (accion: AccionDelPaquete, clave: string, o: Partial<BotonDelPaquete> = {}): BotonDelPaquete => ({ accion, clave, apagado: false, ...o });
const ocupado = (accion: AccionDelPaquete, clave: string): BotonDelPaquete => ({ accion, clave, apagado: true, ocupado: true });
const ofrecer = (p: ProductoALaVenta, idioma: "es" | "en", accion: AccionDelPaquete, forma?: "boton"): BotonDelPaquete => ({
  ...boton(accion, claveDelProducto(p), { producto: p.id, ...(forma ? { forma } : {}) }),
  vars: varsDelProducto(p, idioma),
});

const VACIA = { panel: null, nota: null, error: null, secundarios: [], cierre: [], estado: null } satisfies Partial<VistaDelPaquete>;

/** Qué se ve en la ventana para lo que se sabe ahora. Una sola principal siempre. */
export function vistaDelPaquete(e: EstadoDelPaquete): VistaDelPaquete {
  const cerrar = boton("cerrar", "acctClose");
  const error = e.error;
  if (e.fase === "leyendo" || e.fase === "pidiendo") return { ...VACIA, textos: [], principal: ocupado(e.fase === "leyendo" ? "elegir" : "pedir", "pagoPreparando"), estado: { clave: "pagoPreparando" } };
  if (e.fase === "listo") {
    const n = e.quedan;
    const linea: Texto = n === null ? { clave: "pagoListo" } : n === 1 ? { clave: "pagoListoQueda1" } : { clave: "pagoListoQuedan", vars: { n: String(n) } };
    return { ...VACIA, textos: [linea], principal: cerrar };
  }
  if (e.fase === "sin-venta") return { ...VACIA, textos: error ? [] : [{ clave: "pagoNoALaVenta" }], error, principal: cerrar };
  if (e.fase === "elegir") {
    // Pedir la orden no salió (sin red): el motivo, y la principal la vuelve a pedir.
    if (error && e.elegido) return { ...VACIA, textos: [], error, principal: e.arreglo === "probar" ? boton("pedir", "clProbarDeNuevo") : cerrar };
    const [primero, ...otros] = e.paquetes;
    if (!primero) return { ...VACIA, textos: [{ clave: "pagoNoALaVenta" }], principal: cerrar };
    return { ...VACIA, textos: [], error, secundarios: otros.map((p) => ofrecer(p, e.idioma, "elegir", "boton")), principal: ofrecer(primero, e.idioma, "elegir") };
  }
  // Cómo pagar: el saldo alcanza. Lo que hay es la única línea, el saldo la principal y la otra app al lado.
  if (e.fase === "medio" && e.saldo) {
    const [primero, ...otros] = e.medios;
    const medio = (m: MedioDePago, forma?: "boton"): BotonDelPaquete => boton(m.id === "saldo" ? "medio-saldo" : "medio-app", m.clave, forma ? { forma } : {});
    if (primero) return { ...VACIA, textos: error ? [] : [lineaDelSaldo(e.saldo, e.idioma)], error, secundarios: otros.map((m) => medio(m, "boton")), principal: medio(primero) };
  }
  // Pagando.
  const o = e.orden;
  if (!o) return { ...VACIA, textos: [], error, principal: cerrar };
  const buscando = ocupado("ya-pague", "pagoBuscando");
  const estado: Texto | null = e.buscando ? { clave: "pagoBuscando" } : null;
  // Con el saldo: la confirmación propia, el pago y después lo que diga el servidor (`pago-saldo.ts`).
  if (e.medio === "saldo" && e.saldo) {
    const mirando = e.saldoFase === "mirando" || e.incierto;
    const s = vistaDelSaldo({ idioma: e.idioma, saldo: e.saldo, fase: e.saldoFase, incierto: e.incierto, motivo: e.motivo, buscando: e.buscando, tarda: e.tarda, errorDelSondeo: mirando ? error : null }, o);
    const a = (b: { accion: string; clave: string; vars?: Record<string, string>; apagado: boolean; ocupado?: boolean }, forma?: "texto"): BotonDelPaquete => ({ ...b, accion: b.accion as AccionDelPaquete, ...(forma ? { forma } : {}) });
    return { ...VACIA, textos: s.textos, error: s.error, secundarios: s.secundarios.map((b) => a(b, "texto")), principal: a(s.principal), estado: e.buscando ? { clave: "pagoBuscando" } : null };
  }
  const conArreglo = (b: BotonDelPaquete): BotonDelPaquete => (error && e.arreglo === "ninguno" ? cerrar : b);
  if (vencidaSinPagar(e)) {
    return {
      ...VACIA,
      textos: error ? [] : [{ clave: "pagoVencida", vars: { fecha: fechaDeAlta(o.vence, e.idioma) } }],
      error,
      secundarios: e.buscando ? [] : [boton("ya-pague", "pagoYaPague", { forma: "texto" })],
      principal: e.buscando ? buscando : conArreglo(boton("otra-nota", "pagoOtraNota")),
      estado,
    };
  }
  const secundarios: BotonDelPaquete[] = e.tarda && !e.noLlego && !e.buscando ? [boton("no-llego", "pagoNoLlegoBoton", { forma: "texto" })] : [];
  const linea = lineaDelPago(e, !!error);
  return {
    textos: linea.textos,
    panel: panelDe(o, e.correo, e.idioma, e.corto ? textoDelCorto(e.corto, e.idioma) : null, e.cambio),
    nota: linea.nota,
    error,
    secundarios,
    cierre: [],
    principal: e.buscando ? buscando : conArreglo(boton("ya-pague", error ? "clProbarDeNuevo" : "pagoYaPague")),
    estado,
  };
}

/** El estado al abrir la ventana. */
export function paqueteInicial(idioma: "es" | "en", correo: string): EstadoDelPaquete {
  return {
    idioma,
    fase: "leyendo",
    paquetes: [],
    elegido: null,
    orden: null,
    falta: null,
    buscando: false,
    noVisto: false,
    tarda: false,
    noLlego: false,
    vencida: false,
    error: null,
    arreglo: "probar",
    quedan: null,
    correo,
    medios: MEDIOS_DE_PAGO,
    medio: "app",
    saldo: null,
    corto: null,
    saldoFase: "confirmar",
    incierto: false,
    motivo: null,
    cambio: false,
  };
}

/* ------------------------------------------------------------------ la ventana */

/** Cuánto se espera lo que se vende (sin sesión) y el saldo antes de tomarlo como sin conexión. */
const TOPE_MS = 10_000;
/**
 * La orden y su pago van con la sesión: esperan el token (`TOPE_TOKEN_MS`) y después el pedido (`ESPERA_MS`), y el tope
 * va un segundo detrás de los dos, como en Dejá tu cuenta lista. Con 10 segundos, la wifi lenta de un stand daba error
 * de más.
 */
const TOPE_SERVIDOR_MS = TOPE_TOKEN_MS + ESPERA_MS + 1_000;
const SIN_SERVICIO: ErrorDeAlta = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };

function conTope<T>(p: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<never>((_, no) => {
    reloj = setTimeout(() => no(new Error("tope")), ms);
  });
  return Promise.race([p, tope]).finally(() => clearTimeout(reloj));
}

function poner(x: Texto): string {
  let s = t(x.clave);
  for (const [k, v] of Object.entries(x.vars ?? {})) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** Solo una ventana a la vez: un doble toque no abre dos. */
let abierta: Promise<boolean> | null = null;

export interface OpcionesDeSumar {
  /** El correo de la sesión, ya tapado («a•••@gmail.com»), o vacío. */
  correo?: string;
  /** El paquete que nombraba el botón que la abrió: si se sigue vendiendo, directo a pagarlo. */
  producto?: string | null;
  /**
   * Llevar al QR del banco con el paquete elegido: con esto, el panel ofrece Estoy en Bolivia, que recuerda la elección,
   * cierra la ventana y lo llama. Lo pasa quien abre la ventana solo con la compra con QR en el build y disponible para
   * esta cuenta (`medio-de-pago.ts`).
   */
  alQr?: (producto: string) => void;
  /**
   * El medio que deduce el sitio para esta cuenta (`medio-de-pago.ts`). Con `qr` y `alQr`, elegir el paquete lleva
   * directo a Tu compra, sin pedir una orden para pagar desde otra app y sin recordar nada: la deducción no se guarda.
   */
  medio?: "qr" | "app";
  /** Dónde se recuerda la elección: el navegador por defecto, `null` para no recordarla (la demo). */
  almacenDelMedio?: Pick<Storage, "getItem" | "setItem"> | null;
}

/**
 * Abre «Sumar sorteos» y espera. `true` si llegó el pago (los sorteos ya están en la cuenta); `false` si se cerró sin
 * pagar. Nunca lanza.
 */
export function abrirSumarSorteos(c: CompraDePaquetes, o: OpcionesDeSumar = {}): Promise<boolean> {
  if (abierta) return abierta;
  let resolver!: (v: boolean) => void;
  const promesa = new Promise<boolean>((r) => (resolver = r));
  abierta = promesa;
  const e = paqueteInicial(getLang(), o.correo ?? "");
  e.cambio = !!o.alQr;
  let cerrada = false;
  let sondeo: Sondeo | null = null;
  let pedidos = 0;
  let reloj: ReturnType<typeof setTimeout> | null = null;
  let panelArmado: { clave: string; el: HTMLElement } | null = null;

  const dlg = abrirDialogo({
    titulo: t("cupoOfSumar"),
    onCerrar: () => {
      cerrada = true;
      sondeo?.parar();
      sondeo = null;
      if (reloj) clearTimeout(reloj);
      abierta = null;
      resolver(e.fase === "listo");
    },
  });
  dlg.card.classList.add("pago-paquete");
  dlg.card.dataset.pago = "paquete";
  const estado = lineaDeEstado();
  const principal = botonPrincipal("");
  dlg.pie.append(estado, principal);

  const panelDe_ = (p: PanelDePago): HTMLElement => {
    const clave = `${p.nota}|${p.destino}|${p.usdc}|${p.enlace}|${p.vence}|${p.correo}|${p.cambio ? "qr" : ""}|${getLang()}`;
    if (panelArmado?.clave !== clave) panelArmado = { clave, el: armarPanelDePago(p, { alCambiar: () => alQr() }) };
    return panelArmado.el;
  };

  /** Estoy en Bolivia: queda recordado, la ventana se cierra y quien la abrió lleva al QR con el paquete elegido. */
  function alQr(): void {
    const producto = e.elegido?.id;
    if (cerrada || !o.alQr || !producto) return;
    if (o.almacenDelMedio === undefined) recordarMedio("qr");
    else recordarMedio("qr", o.almacenDelMedio);
    dlg.cerrar();
    o.alQr(producto);
  }

  function pintar(): void {
    if (cerrada) return;
    e.idioma = getLang();
    e.vencida = e.orden !== null && Date.now() >= e.orden.vence;
    const v = vistaDelPaquete(e);
    const antes = document.activeElement;
    const enfocado = antes instanceof HTMLElement && dlg.card.contains(antes) ? antes : null;
    const hijos: HTMLElement[] = [];
    const parrafo = (x: Texto, clase = "pago-texto"): HTMLParagraphElement => {
      const p = document.createElement("p");
      p.className = clase;
      p.textContent = poner(x);
      return p;
    };
    // Arriba, la única línea: cómo pagar, lo que pasó con el pago o el error. Debajo, los datos para pagar.
    for (const x of v.textos) hijos.push(parrafo(x));
    if (v.nota) {
      const n = parrafo(v.nota, "pago-texto pago-nota");
      n.setAttribute("role", "status");
      hijos.push(n);
    }
    if (v.error) {
      const err = document.createElement("div");
      err.className = "cl-error";
      err.setAttribute("role", "alert");
      err.append(parrafo(v.error, "cl-error-texto"));
      hijos.push(err);
    }
    if (v.panel) hijos.push(panelDe_(v.panel));
    for (const s of v.secundarios) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = s.forma === "texto" ? "cl-texto" : "cl-secundario";
      b.dataset.accion = s.accion;
      if (s.producto) b.dataset.producto = s.producto;
      b.textContent = poner(s);
      b.disabled = s.apagado;
      b.addEventListener("click", () => void hacer(s.accion, s.producto));
      hijos.push(b);
    }
    for (const x of v.cierre) hijos.push(parrafo(x, "pago-texto pago-cierre"));
    dlg.cuerpo.replaceChildren(...hijos);
    dlg.cuerpo.classList.add("pago-cuerpo");

    const p = v.principal;
    principal.dataset.accion = p.accion;
    if (p.producto) principal.dataset.producto = p.producto;
    else delete principal.dataset.producto;
    principal.textContent = poner(p);
    principal.disabled = p.apagado;
    if (p.ocupado) principal.setAttribute("aria-busy", "true");
    else principal.removeAttribute("aria-busy");
    estado.textContent = v.estado ? poner(v.estado) : "";
    // Lo mismo que dice la principal apagada se oye, no se ve dos veces.
    estado.classList.toggle("sr-only", !!v.estado && p.apagado && v.estado.clave === p.clave);
    // El foco no se pierde con el repintado: el mismo «Copiar» si sigue ahí, o la principal.
    if (enfocado && document.activeElement !== enfocado) (enfocado.isConnected ? enfocado : principal.disabled ? dlg.card : principal).focus({ preventScroll: true });
  }

  function volverAEmpezar(): void {
    sondeo?.parar();
    sondeo = null;
    e.buscando = false;
    e.orden = null;
    e.falta = null;
    e.noVisto = false;
    e.tarda = false;
    e.noLlego = false;
    e.error = null;
    e.arreglo = "probar";
    e.medio = "app";
    e.saldoFase = "confirmar";
    e.incierto = false;
    e.motivo = null;
  }

  /**
   * El paquete elegido. Con el saldo en la ventana, primero se mira en la red si alcanza para su precio: si alcanza, se
   * pregunta cómo pagar; si no (o no se pudo mirar), directo a los datos para pagar, como siempre.
   */
  async function elegirPaquete(p: ProductoALaVenta): Promise<void> {
    // El QR deducido: a Tu compra con el paquete, sin una orden de otra app que después habría que reemplazar.
    if (o.medio === "qr" && o.alQr) {
      if (cerrada) return;
      dlg.cerrar();
      o.alQr(p.id);
      return;
    }
    if (!c.saldo) return pedir(p, "app");
    const n = ++pedidos;
    volverAEmpezar();
    e.elegido = p;
    e.fase = "pidiendo";
    pintar();
    let s: SaldoDeDolares | null;
    try {
      s = await conTope(c.saldo.leer(), TOPE_MS);
    } catch {
      s = null;
    }
    if (cerrada || n !== pedidos) return;
    const m = mediosConSaldo(s, p.usdc);
    e.medios = m.medios;
    e.saldo = m.saldo;
    e.corto = m.corto;
    if (m.medios.length > 1) {
      e.fase = "medio";
      return pintar();
    }
    return pedir(p, "app");
  }

  /** Pagar con el saldo, desde la confirmación propia. Después, el acceso lo dice el servidor (`mirar`). */
  async function pagarConSaldo(): Promise<void> {
    const ord = e.orden;
    const saldo = c.saldo;
    if (!saldo || !ord || e.medio !== "saldo" || e.saldoFase !== "confirmar" || e.incierto) return;
    e.saldoFase = "pagando";
    e.motivo = null;
    e.error = null;
    pintar();
    // Con la compra con QR en el build, antes de pagar, cómo está la orden en el servidor: se paga solo sin pagar y sin
    // nada recibido. Pagada, se mira. Con algo recibido (pagaron una parte desde otra app), lo que falta va por la otra
    // app. Sin respuesta, no se manda nada. Sin la compra con QR, como siempre.
    if (c.preguntarAntesDePagar) {
      let antes: ResultadoDeAlta<PagoDeOrden>;
      try {
        antes = await conTope(c.pago(ord.id), TOPE_SERVIDOR_MS);
      } catch {
        antes = SIN_SERVICIO;
      }
      if (cerrada || e.orden !== ord) return;
      if (!antes.ok) {
        e.saldoFase = "confirmar";
        e.motivo = "red";
        return pintar();
      }
      if (antes.datos.pagada) {
        e.saldoFase = "mirando";
        return mirar();
      }
      if (/[1-9]/.test(antes.datos.recibido)) {
        e.saldoFase = "confirmar";
        e.medio = "app";
        return mirar();
      }
    }
    let r: Awaited<ReturnType<PagoConSaldo["pagar"]>>;
    try {
      r = await saldo.pagar(ord);
    } catch {
      // No debería lanzar. Si lanza, no se sabe si salió: no se ofrece de nuevo y se mira.
      r = { estado: "incierto", vence: Math.floor(Date.now() / 1000) };
    }
    if (cerrada || e.orden !== ord) return;
    const t = trasPagar(r);
    e.saldoFase = t.fase;
    e.incierto = t.incierto;
    e.motivo = t.motivo;
    if (t.mirar) return mirar();
    // La red dijo que no alcanza: el saldo cambió desde que se leyó. Se lee de nuevo para decir cuánto hay.
    if (t.motivo === "sin-saldo") {
      try {
        const s = await conTope(saldo.leer(), TOPE_MS);
        if (s.tipo === "saldo") e.saldo = s.saldo;
      } catch {
        /* queda lo leído antes */
      }
      if (cerrada || e.orden !== ord) return;
    }
    pintar();
  }

  async function leer(): Promise<void> {
    let oferta: Oferta;
    try {
      oferta = await conTope(c.oferta(), TOPE_MS);
    } catch {
      oferta = { alta: null, paquetes: [] };
    }
    if (cerrada) return;
    e.paquetes = oferta.paquetes;
    const nombrado = o.producto ? (e.paquetes.find((p) => p.id === o.producto) ?? null) : null;
    const unico = e.paquetes.length === 1 ? (e.paquetes[0] ?? null) : null;
    if (e.paquetes.length === 0) {
      e.fase = "sin-venta";
      return pintar();
    }
    if (nombrado || unico) return elegirPaquete((nombrado ?? unico) as ProductoALaVenta);
    e.fase = "elegir";
    pintar();
  }

  async function pedir(p: ProductoALaVenta, medio: string): Promise<void> {
    const n = ++pedidos;
    volverAEmpezar();
    e.elegido = p;
    e.medio = medio;
    e.fase = "pidiendo";
    pintar();
    let r: ResultadoDeAlta<OrdenDePago>;
    try {
      r = await conTope(c.orden(p.id), TOPE_SERVIDOR_MS);
    } catch {
      r = SIN_SERVICIO;
    }
    if (cerrada || n !== pedidos) return;
    if (r.ok) {
      e.orden = r.datos;
      e.fase = "pagando";
      if (reloj) clearTimeout(reloj);
      reloj = null;
      const resta = r.datos.vence - Date.now();
      if (resta > 0 && resta < 7 * 24 * 3_600_000) reloj = setTimeout(pintar, resta + 50);
      return pintar();
    }
    e.error = textoDelErrorDeLaOrden(r);
    e.arreglo = r.clave === "clErrSesion" || r.clave === "altaErrCuentaDeOtro" ? "ninguno" : "probar";
    if (NO_SE_VENDE.has(r.motivo)) {
      // Ese paquete dejó de venderse: no se ofrece más, y se dice por qué.
      e.paquetes = e.paquetes.filter((x) => x.id !== p.id);
      e.elegido = null;
      e.fase = e.paquetes.length > 0 ? "elegir" : "sin-venta";
    } else e.fase = "elegir";
    pintar();
  }

  function mirar(): void {
    const ord = e.orden;
    if (!ord || e.buscando) return;
    sondeo?.parar();
    e.buscando = true;
    e.tarda = false;
    e.noLlego = false;
    e.error = null;
    e.arreglo = "probar";
    pintar();
    const yo: Sondeo = vigilarPago({
      preguntar: () => conTope(c.pago(ord.id), TOPE_SERVIDOR_MS),
      alResultado: (r) => {
        if (cerrada || sondeo !== yo || e.orden !== ord) return "parar";
        if (!r.ok) {
          e.buscando = false;
          e.error = textoDelErrorDelPago(r);
          e.arreglo = r.clave === "clErrSesion" || r.clave === "altaErrCuentaDeOtro" || r.clave === "pagoErrOrden" ? "ninguno" : "probar";
          pintar();
          return "parar";
        }
        if (r.datos.pagada) {
          e.buscando = false;
          e.fase = "listo";
          e.quedan = r.datos.sorteos.quedan;
          e.orden = null;
          if (reloj) clearTimeout(reloj);
          reloj = null;
          try {
            c.refrescarCupo();
          } catch {
            /* la línea del cupo se entera la próxima vez */
          }
          pintar();
          return "parar";
        }
        e.falta = faltaDe(r.datos.recibido, r.datos.total);
        e.noVisto = e.falta === null;
        if (e.falta === null && Date.now() >= ord.vence) {
          e.buscando = false;
          pintar();
          return "parar";
        }
        pintar();
        return "seguir";
      },
      alTardar: () => {
        if (cerrada || sondeo !== yo) return;
        e.buscando = false;
        e.tarda = true;
        pintar();
      },
    });
    sondeo = yo;
  }

  async function hacer(a: AccionDelPaquete, producto?: string): Promise<void> {
    if (cerrada) return;
    switch (a) {
      case "elegir": {
        const p = e.paquetes.find((x) => x.id === producto);
        if (p) return elegirPaquete(p);
        return;
      }
      case "pedir":
      case "otra-nota":
        if (e.elegido) return pedir(e.elegido, e.medio);
        return;
      case "medio-saldo":
        if (e.elegido && e.saldo) return pedir(e.elegido, "saldo");
        return;
      case "medio-app":
        if (e.elegido) return pedir(e.elegido, "app");
        return;
      case "saldo-pagar":
        return pagarConSaldo();
      case "saldo-otro-medio": {
        // La misma orden, con los datos para pagar desde otra app. Si el saldo no alcanzaba, el panel lo dice.
        if (e.saldoFase === "pagando" || e.incierto) return;
        e.medio = "app";
        e.motivo = null;
        e.error = null;
        if (e.saldo && e.orden && !alcanza(e.saldo, e.orden.usdc)) e.corto = { tiene: e.saldo, falta: faltaPara(e.saldo, e.orden.usdc) };
        return pintar();
      }
      case "ya-pague":
        return mirar();
      case "no-llego":
        e.noLlego = true;
        return pintar();
      case "cerrar":
        dlg.cerrar();
        return;
    }
  }

  principal.addEventListener("click", () => {
    if (principal.disabled) return;
    void hacer(principal.dataset.accion as AccionDelPaquete, principal.dataset.producto);
  });

  pintar();
  void leer();
  return promesa;
}
