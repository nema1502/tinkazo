import { getLang, t } from "../i18n";
import { ESPERA_MS, type ErrorDeAlta, type OrdenDePago, type PagoDeOrden, type ResultadoDeAlta, fechaDeAlta } from "../stellar/alta-api";
import {
  type Oferta,
  type ProductoALaVenta,
  cantidadInicial,
  cantidadesDe,
  claveDelProducto,
  moverCantidad,
  precioVisible,
  totalDe,
  varsDelProducto,
  varsDelTotal,
} from "../stellar/alta-oferta";
import type { MotivoDelPago } from "../stellar/pago-con-saldo";
import { TOPE_TOKEN_MS } from "../stellar/pollar-config";
import { type SaldoDeDolares, alcanza, faltaPara } from "../stellar/saldo-dolares";
import type { Texto } from "./cuenta-lista-estado";
import { abrirDialogo, botonPrincipal, lineaDeEstado } from "./dialogo";
import { recordarMedio } from "./medio-de-pago";
import { type PanelArmado, panelDeLaOrden } from "./pago-panel";
import { type FaseDelSaldo, type PagoConSaldo, type SaldoCorto, lineaDelSaldo, mediosConSaldo, textoDelCorto, trasPagar, vistaDelSaldo } from "./pago-saldo";
import { DURANTE_SOLO_MS, PRIMEROS_MS, type Sondeo, pestanaDelNavegador, ritmoSolo, vigilarPago } from "./pago-sondeo";
import {
  COMO_PAGAR,
  MEDIOS_DE_PAGO,
  type MedioDePago,
  NO_SE_VENDE,
  type PanelDePago,
  faltaDe,
  lineaDelPago,
  notaDelPago,
  panelDe,
  textoDelErrorDeLaOrden,
  textoDelErrorDelPago,
  vencidaSinPagar,
} from "./pago-vista";

/**
 * «Sumar sorteos»: la ventana para comprar un paquete de sorteos oficiales con la cuenta ya lista (la abren la ventana
 * «Se te acabaron los sorteos oficiales» y la línea del cupo cuando quedan pocos). Comprar un paquete no es activar la
 * cuenta: por eso no vive en «Dejá tu cuenta lista».
 *
 * - Lo que se vende sale del servidor (`oferta`), y la cuenta, el monto y la nota, de la orden que devolvió (`orden`):
 *   acá no se escribe ningún precio ni ningún dato del pago.
 * - Con un paquete a la venta, directo a los datos para pagar; con varios, primero cuál (el primero es la principal).
 * - Con el producto por unidad (`unidad` en lo que se vende), primero cuántos: el contador de menos y más, con el mínimo,
 *   el máximo y el paso del servidor, la línea del precio por sorteo y «Seguir con {total}», que no cobra: pide la
 *   orden de esa cantidad y pasa a los datos para pagar. Sin el producto por unidad, los paquetes de siempre.
 * - La orden por unidad se mira sola desde que se muestra, sin tocar nada (`pago-sondeo.ts`, `ritmoSolo`): cada 10
 *   segundos los primeros 2 minutos y después cada 30, frenada con la pestaña oculta, hasta 30 minutos. «Ya pagué» no es
 *   la principal: aparece como texto chico a los 2 minutos sin el pago. Pasados los 30, que se puede cerrar porque llega
 *   igual. Al llegar, el título lo dice y la línea, cuántos sorteos oficiales quedan.
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
  /** `cantidad` solo con el producto por unidad: cuántos sorteos se eligieron con el contador. */
  orden(producto: string, cantidad?: number): Promise<ResultadoDeAlta<OrdenDePago>>;
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
  /** Lo que marca el contador del producto por unidad, o `null` (los paquetes fijos, o antes de leer lo que se vende). */
  cantidad: number | null;
  /**
   * La orden del producto por unidad se mira sola desde que se muestra (`pago-sondeo.ts`, `ritmoSolo`), sin «Ya pagué»
   * de principal. Los paquetes fijos, como siempre: miran desde «Ya pagué».
   */
  solo: boolean;
  /** Mirando solo, pasaron 2 minutos sin el pago: «Ya pagué» aparece como texto chico, para mirar ya. */
  yaPague: boolean;
  /**
   * Los sorteos que ya dio la orden por unidad pagada a medias, como los dijo el servidor (`sorteosDados`), o 0. Con
   * eso, lo que llegó de menos dice cuántos ya se sumaron, y no solo que falta.
   */
  dados: number;
}

export type AccionDelPaquete =
  | "elegir"
  | "pedir"
  | "ya-pague"
  | "no-llego"
  | "otra-nota"
  | "cerrar"
  | "medio-saldo"
  | "medio-app"
  | "saldo-pagar"
  | "saldo-otro-medio"
  | "menos"
  | "mas"
  | "seguir"
  | "mirar-ya";

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
  /** El contador del producto por unidad: la cantidad y qué lado ya llegó al borde. Solo eligiendo cuántos. */
  contador: ContadorDelPaquete | null;
  /** El título de la ventana cuando no es «Sumar sorteos»: llegó el pago que se miraba solo. */
  titulo: Texto | null;
}

/** El contador: cuántos sorteos marca y si menos o más ya no mueven (están en el mínimo o en el máximo del servidor). */
export interface ContadorDelPaquete {
  cantidad: number;
  menosApagado: boolean;
  masApagado: boolean;
}

const boton = (accion: AccionDelPaquete, clave: string, o: Partial<BotonDelPaquete> = {}): BotonDelPaquete => ({ accion, clave, apagado: false, ...o });
const ocupado = (accion: AccionDelPaquete, clave: string): BotonDelPaquete => ({ accion, clave, apagado: true, ocupado: true });
const ofrecer = (p: ProductoALaVenta, idioma: "es" | "en", accion: AccionDelPaquete, forma?: "boton"): BotonDelPaquete => ({
  ...boton(accion, claveDelProducto(p), { producto: p.id, ...(forma ? { forma } : {}) }),
  vars: varsDelProducto(p, idioma),
});

const VACIA = {
  panel: null,
  nota: null,
  error: null,
  secundarios: [],
  cierre: [],
  estado: null,
  contador: null,
  titulo: null,
} satisfies Partial<VistaDelPaquete>;

/**
 * La línea de arriba de los datos mirando solo: el error, lo que llegó, que tarda (y que se puede cerrar) o la red
 * equivocada tras «No llegó». Que todavía no se ve el pago no se dice: se mira solo desde que aparece la orden, antes de
 * que la persona haya podido pagar. Si no, cómo se paga.
 */
function lineaSola(e: EstadoDelPaquete, hayError: boolean): { textos: Texto[]; nota: Texto | null } {
  if (hayError) return { textos: [], nota: null };
  const nota = conDados(e, notaDelPago({ ...e, noVisto: false }));
  if (nota?.clave === "pagoTarda") return { textos: [], nota: { clave: "pagoTardaSolo" } };
  return nota ? { textos: [], nota } : { textos: [COMO_PAGAR], nota: null };
}

/**
 * Llegó de menos a una orden por unidad que ya dio sorteos: cuántos se sumaron de los de la orden y cuánto falta para
 * el resto, en lugar de solo lo que llegó (que haría creer que el pago no sirvió). Sin sorteos dados, o si no cuadra
 * con la orden, la nota de siempre.
 */
function conDados(e: EstadoDelPaquete, nota: Texto | null): Texto | null {
  const o = e.orden;
  if (nota?.clave !== "pagoFalta" || !e.falta || !o || e.dados <= 0 || e.dados >= o.sorteos) return nota;
  const falta = faltaPara(e.falta.recibido, e.falta.total);
  if (!/[1-9]/.test(falta)) return nota;
  return { clave: "pagoFaltaDados", vars: { dados: String(e.dados), n: String(o.sorteos), falta: precioVisible(falta, e.idioma) } };
}

/**
 * Pagando el producto por unidad, que se mira solo: los datos de la orden y, abajo, «Buscando tu pago…». «Ya pagué» no
 * es la principal: aparece como texto chico a los 2 minutos sin el pago, y pregunta ya. Pasados los 30 minutos, que se
 * puede cerrar (llega igual), «Cerrar» de principal, y «Ya pagué» y «No llegó» chicos. Un error que no se arregla
 * mirando, el de siempre.
 */
function vistaMirandoSola(e: EstadoDelPaquete, o: OrdenDePago, error: Texto | null, cerrar: BotonDelPaquete): VistaDelPaquete {
  const linea = lineaSola(e, !!error);
  const texto = (accion: AccionDelPaquete, clave: string): BotonDelPaquete => boton(accion, clave, { forma: "texto" });
  const tras30 = e.tarda && !error ? [texto("ya-pague", "pagoYaPague"), ...(e.noLlego ? [] : [texto("no-llego", "pagoNoLlegoBoton")])] : [];
  const secundarios = e.buscando ? (e.yaPague ? [texto("mirar-ya", "pagoYaPague")] : []) : tras30;
  // Sin mirar: un error (lo arregla probar de nuevo, o nada desde acá), pasados los 30 minutos, o antes de empezar.
  let sinMirar: BotonDelPaquete;
  if (error) sinMirar = e.arreglo === "ninguno" ? cerrar : boton("ya-pague", "clProbarDeNuevo");
  else sinMirar = e.tarda ? cerrar : boton("ya-pague", "pagoYaPague");
  return {
    ...VACIA,
    textos: linea.textos,
    panel: panelDe(o, e.correo, e.idioma, e.corto ? textoDelCorto(e.corto, e.idioma) : null, false, e.noLlego),
    nota: linea.nota,
    error,
    secundarios,
    principal: e.buscando ? ocupado("ya-pague", "pagoBuscando") : sinMirar,
    estado: e.buscando ? { clave: "pagoBuscando" } : null,
  };
}

/** La cantidad que vale para el contador: la que marca si se puede pedir, y si no, la inicial. */
function cantidadDe(e: Pick<EstadoDelPaquete, "cantidad">, u: NonNullable<ProductoALaVenta["unidad"]>): number {
  return e.cantidad !== null && cantidadesDe(u).includes(e.cantidad) ? e.cantidad : cantidadInicial(u);
}

/**
 * Elegir cuántos: un título, la línea del precio por sorteo (que vale un año, o los días que diga el servidor), el
 * contador y «Seguir con {total}», que pide la orden de esa cantidad. Con un error a la vista, el motivo en lugar de la
 * línea.
 */
function vistaDeCuantos(e: EstadoDelPaquete, p: ProductoALaVenta, u: NonNullable<ProductoALaVenta["unidad"]>, error: Texto | null): VistaDelPaquete {
  const n = cantidadDe(e, u);
  const lista = cantidadesDe(u);
  const { precio } = varsDelProducto(p, e.idioma);
  const linea: Texto = p.dias === 365 ? { clave: "pagoUnidad", vars: { precio } } : { clave: "pagoUnidadDias", vars: { precio, n: String(p.dias) } };
  return {
    ...VACIA,
    textos: error ? [] : [linea],
    error,
    contador: { cantidad: n, menosApagado: n <= (lista[0] ?? n), masApagado: n >= (lista[lista.length - 1] ?? n) },
    principal: { ...boton("seguir", "pagoSeguirTotal", { producto: p.id }), vars: varsDelTotal(p, n, e.idioma) },
  };
}

/** Qué se ve en la ventana para lo que se sabe ahora. Una sola principal siempre. */
export function vistaDelPaquete(e: EstadoDelPaquete): VistaDelPaquete {
  const cerrar = boton("cerrar", "acctClose");
  const error = e.error;
  if (e.fase === "leyendo" || e.fase === "pidiendo") return { ...VACIA, textos: [], principal: ocupado(e.fase === "leyendo" ? "elegir" : "pedir", "pagoPreparando"), estado: { clave: "pagoPreparando" } };
  if (e.fase === "listo") {
    const n = e.quedan;
    // Llegó lo que se miraba solo: el título lo dice, y la línea, cuántos sorteos oficiales quedan.
    if (e.solo) {
      const quedan: Texto[] = n === null ? [] : [n === 1 ? { clave: "cupoOfQueda1" } : { clave: "cupoOfQuedan", vars: { n: String(n) } }];
      return { ...VACIA, titulo: { clave: "pagoListoTitulo" }, textos: quedan, principal: cerrar };
    }
    const linea: Texto = n === null ? { clave: "pagoListo" } : n === 1 ? { clave: "pagoListoQueda1" } : { clave: "pagoListoQuedan", vars: { n: String(n) } };
    return { ...VACIA, textos: [linea], principal: cerrar };
  }
  if (e.fase === "sin-venta") return { ...VACIA, textos: error ? [] : [{ clave: "pagoNoALaVenta" }], error, principal: cerrar };
  if (e.fase === "elegir") {
    // Pedir la orden no salió (sin red): el motivo, y la principal la vuelve a pedir.
    if (error && e.elegido) return { ...VACIA, textos: [], error, principal: e.arreglo === "probar" ? boton("pedir", "clProbarDeNuevo") : cerrar };
    const [primero, ...otros] = e.paquetes;
    if (!primero) return { ...VACIA, textos: [{ clave: "pagoNoALaVenta" }], principal: cerrar };
    // El producto por unidad va primero y es lo único que se ofrece: cuántos, con el contador.
    if (primero.unidad) return vistaDeCuantos(e, primero, primero.unidad, error);
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
  // El producto por unidad se mira solo desde que se muestra la orden.
  if (e.solo) return vistaMirandoSola(e, o, error, cerrar);
  const secundarios: BotonDelPaquete[] = e.tarda && !e.noLlego && !e.buscando ? [boton("no-llego", "pagoNoLlegoBoton", { forma: "texto" })] : [];
  const linea = lineaDelPago(e, !!error);
  return {
    textos: linea.textos,
    // Estoy en Bolivia lleva a la compra con QR, que es de paquetes fijos: con el producto por unidad no se ofrece.
    panel: panelDe(o, e.correo, e.idioma, e.corto ? textoDelCorto(e.corto, e.idioma) : null, e.cambio && !e.elegido?.unidad, e.noLlego),
    nota: conDados(e, linea.nota),
    error,
    secundarios,
    cierre: [],
    principal: e.buscando ? buscando : conArreglo(boton("ya-pague", error ? "clProbarDeNuevo" : "pagoYaPague")),
    estado,
    contador: null,
    titulo: null,
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
    cantidad: null,
    solo: false,
    yaPague: false,
    dados: 0,
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
  /** Mirando solo: a los 2 minutos sin el pago, «Ya pagué» como texto chico. */
  let relojYaPague: ReturnType<typeof setTimeout> | null = null;
  let panelArmado: PanelArmado | null = null;
  const pararYaPague = (): void => {
    if (relojYaPague) clearTimeout(relojYaPague);
    relojYaPague = null;
  };

  const dlg = abrirDialogo({
    titulo: t("cupoOfSumar"),
    onCerrar: () => {
      cerrada = true;
      sondeo?.parar();
      sondeo = null;
      if (reloj) clearTimeout(reloj);
      pararYaPague();
      abierta = null;
      resolver(e.fase === "listo");
    },
  });
  dlg.card.classList.add("pago-paquete");
  dlg.card.dataset.pago = "paquete";
  const titulo = dlg.card.querySelector<HTMLElement>(".dlg-h");
  const estado = lineaDeEstado();
  const principal = botonPrincipal("");
  dlg.pie.append(estado, principal);

  const panelDe_ = (p: PanelDePago): HTMLElement => {
    panelArmado = panelDeLaOrden(panelArmado, p, getLang(), { alCambiar: () => alQr() });
    return panelArmado.el;
  };

  /** Estoy en Bolivia: queda recordado, la ventana se cierra y quien la abrió lleva al QR con el paquete elegido. */
  function alQr(): void {
    const producto = e.elegido?.id;
    if (cerrada || !o.alQr || !producto || e.elegido?.unidad) return;
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
    // El título es «Sumar sorteos», salvo cuando llegó el pago que se miraba solo.
    if (titulo) titulo.textContent = v.titulo ? poner(v.titulo) : t("cupoOfSumar");
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
    if (v.contador) hijos.push(contadorDe(v.contador));
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
    // El foco no se pierde con el repintado: el mismo «Copiar» si sigue ahí, o la principal. En el contador, el mismo
    // lado si todavía mueve, y si llegó al borde, el otro: se puede seguir tocando sin buscar dónde quedó el foco.
    const lado = enfocado && !enfocado.isConnected ? botonDelContador(enfocado.dataset.accion) : null;
    if (lado) lado.focus({ preventScroll: true });
    else if (enfocado && document.activeElement !== enfocado) {
      (enfocado.isConnected ? enfocado : principal.disabled ? dlg.card : principal).focus({ preventScroll: true });
    }
  }

  /** El botón del contador que toma el foco tras repintar: el mismo lado, o el otro si ese ya no mueve. */
  function botonDelContador(accion: string | undefined): HTMLButtonElement | null {
    if (accion !== "menos" && accion !== "mas") return null;
    const de = (a: string): HTMLButtonElement | null => dlg.cuerpo.querySelector<HTMLButtonElement>(`.pago-contador button[data-accion="${a}"]`);
    const mismo = de(accion);
    if (mismo && !mismo.disabled) return mismo;
    const otro = de(accion === "menos" ? "mas" : "menos");
    return otro && !otro.disabled ? otro : null;
  }

  /**
   * El contador: menos, la cantidad y más, en una fila. Se toca, nunca se escribe. Cada botón dice en voz alta qué hace
   * y la cantidad se anuncia cuando cambia. En el borde, ese lado queda apagado.
   */
  function contadorDe(c: ContadorDelPaquete): HTMLElement {
    const fila = document.createElement("div");
    fila.className = "pago-contador";
    fila.setAttribute("role", "group");
    fila.setAttribute("aria-label", t("pagoCuantos"));
    const lado = (accion: "menos" | "mas", signo: string, clave: string, apagado: boolean): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pago-contador-boton";
      b.dataset.accion = accion;
      b.textContent = signo;
      b.setAttribute("aria-label", t(clave));
      b.disabled = apagado;
      b.addEventListener("click", () => void hacer(accion));
      return b;
    };
    const n = document.createElement("output");
    n.className = "pago-contador-n";
    n.dataset.dato = "cantidad";
    n.setAttribute("aria-live", "polite");
    n.textContent = String(c.cantidad);
    fila.append(lado("menos", "−", "pagoMenos", c.menosApagado), n, lado("mas", "+", "pagoMas", c.masApagado));
    return fila;
  }

  function volverAEmpezar(): void {
    sondeo?.parar();
    sondeo = null;
    pararYaPague();
    e.solo = false;
    e.yaPague = false;
    e.dados = 0;
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
    // El QR deducido: a Tu compra con el paquete, sin una orden de otra app que después habría que reemplazar. La compra
    // con QR es de paquetes fijos: el producto por unidad sigue por los datos para pagar.
    if (o.medio === "qr" && o.alQr && !p.unidad) {
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
    // Por unidad, lo que se paga es el total de la cantidad elegida, no el precio de uno.
    const m = mediosConSaldo(s, p.unidad ? totalDe(p.usdc, cantidadDe(e, p.unidad)) : p.usdc);
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
    // Un paquete fijo nombrado por quien abrió la ventana, directo a pagarlo, como siempre.
    if (nombrado && !nombrado.unidad) return elegirPaquete(nombrado);
    // El producto por unidad: primero cuántos, con el contador en la cantidad inicial.
    const primero = e.paquetes[0];
    if (primero?.unidad) {
      e.cantidad = cantidadDe(e, primero.unidad);
      e.fase = "elegir";
      return pintar();
    }
    if (unico) return elegirPaquete(unico);
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
      // Por unidad, la orden lleva la cantidad del contador y el servidor arma el monto. Un paquete fijo, como siempre.
      r = await conTope(p.unidad ? c.orden(p.id, cantidadDe(e, p.unidad)) : c.orden(p.id), TOPE_SERVIDOR_MS);
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
      // El producto por unidad, pagado desde otra app: se mira solo desde ya, y «Ya pagué» aparece a los 2 minutos.
      if (p.unidad && medio === "app") {
        e.solo = true;
        relojYaPague = setTimeout(() => {
          relojYaPague = null;
          if (cerrada || e.fase !== "pagando") return;
          e.yaPague = true;
          pintar();
        }, PRIMEROS_MS);
        return mirar();
      }
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
    // Mirando solo: el ritmo de la venta por unidad, hasta 30 minutos, frenado con la pestaña oculta.
    const pestana = e.solo ? pestanaDelNavegador() : undefined;
    const ritmo = e.solo ? { ritmo: ritmoSolo, duranteMs: DURANTE_SOLO_MS, ...(pestana ? { pestana } : {}) } : {};
    const yo: Sondeo = vigilarPago({
      preguntar: () => conTope(c.pago(ord.id), TOPE_SERVIDOR_MS),
      ...ritmo,
      alResultado: (r) => {
        if (cerrada || sondeo !== yo || e.orden !== ord) return "parar";
        if (!r.ok) {
          const arreglo = r.clave === "clErrSesion" || r.clave === "altaErrCuentaDeOtro" || r.clave === "pagoErrOrden" ? "ninguno" : "probar";
          // Mirando solo, una falla pasajera (sin conexión, el servidor que no contesta) se dice y se sigue mirando.
          if (e.solo && arreglo === "probar") {
            e.error = textoDelErrorDelPago(r);
            e.arreglo = arreglo;
            pintar();
            return "seguir";
          }
          e.buscando = false;
          e.error = textoDelErrorDelPago(r);
          e.arreglo = arreglo;
          pintar();
          return "parar";
        }
        // Una respuesta buena borra la falla pasajera de antes.
        if (e.solo) e.error = null;
        if (r.datos.pagada) {
          pararYaPague();
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
        // Por unidad, lo que llegó de menos ya dio sorteos: se dice cuántos y la línea del cupo se pone al día. Se
        // refresca solo cuando suben, no en cada pregunta.
        const dados = r.datos.sorteosDados ?? 0;
        if (dados > e.dados) {
          e.dados = dados;
          try {
            c.refrescarCupo();
          } catch {
            /* la línea del cupo se entera la próxima vez */
          }
        }
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
      case "menos":
      case "mas": {
        // El contador: solo eligiendo cuántos. La cantidad no pasa del mínimo ni del máximo del servidor.
        const u = e.fase === "elegir" ? e.paquetes[0]?.unidad : undefined;
        if (!u) return;
        e.cantidad = moverCantidad(u, cantidadDe(e, u), a === "menos" ? -1 : 1);
        return pintar();
      }
      case "seguir": {
        // «Seguir con {total}» no cobra: pide la orden de esa cantidad y muestra los datos para pagar.
        const p = e.paquetes.find((x) => x.id === producto && x.unidad);
        if (p && e.fase === "elegir") return elegirPaquete(p);
        return;
      }
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
      case "mirar-ya":
        // El «Ya pagué» chico mientras se mira solo: una pregunta ya. Si ya no se estaba mirando, se mira de nuevo.
        if (sondeo && e.buscando) return sondeo.mirarYa();
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
