import { describe, expect, it } from "vitest";
import { T } from "../i18n";
import type { OrdenDePago } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { USDC_MAINNET } from "../stellar/pagos";
import { type LecturaDeCotizacion, type MarcasDeOrden, type PasoDeVerificacion, type PrecioDeCarga, SIN_MARCAS } from "../stellar/rampa-pollar";
import type { Texto } from "./cuenta-lista-estado";
import { type CargaEnLaVentana, type LoQueSeSabe, type PantallaDeCompra, type PermisoDeCompra, cajaDeActivar, cajaDelPaquete, correoDeAyuda, cuentaCorta, pantallaDeCompra } from "./compra-qr-estado";

/**
 * La máquina de pantallas de la compra con QR, sin DOM: una fila por cada paso de cada recorrido de la compra y por
 * cada falla, y las reglas que valen para todas las filas, en español y en inglés.
 */

/* ------------------------------------------------------------------ las órdenes de carga, como las da el proveedor */

const CREADA = "2026-11-16T15:00:00.000Z";
const CREADA_MS = Date.parse(CREADA);
const VENCE_QR = "2026-11-16T15:15:00.000Z";
const AHORA = CREADA_MS + 60_000;
const IMAGEN_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const CIRCLE = USDC_MAINNET.issuer;
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" };
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: CIRCLE, chain: "STELLAR" };
const USDT_POLYGON = { kind: "asset", code: "USDT0", identifier: "0x00000000000000000000000000000000000000aa", chain: "POLYGON" };
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: "0x00000000000000000000000000000000000000bb", chain: "POLYGON" };
const FONDOS_EN_PASO = { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", asset: "USDT0", amount: "8450000" };

type Obj = Record<string, unknown>;
const paso = (kind: string, status = "pending"): Obj => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (t: Obj): Obj => ({
  status: "PENDING",
  amountInPlanned: "0",
  amountOutPlanned: "0",
  amountInActual: null,
  amountOutActual: null,
  onchainTxHash: null,
  signingMode: null,
  fundsLocation: null,
  failure: null,
  steps: [],
  etaSeconds: null,
  startedAt: null,
  ...t,
});
const pagoQr = (instrucciones: Obj = {}, accion: Obj = {}): Obj => ({
  kind: "FIAT_PAYMENT",
  actionId: "act-pago",
  legIndex: 0,
  expiresAt: VENCE_QR,
  instructions: {
    kind: "qr",
    payload: "00020101021226370016",
    amount: "104.00",
    currency: "BOB",
    scannable: { kind: "opaque", payload: null, payloadLabel: null, image: { mediaType: "image/png", encoding: "base64", data: IMAGEN_PNG, inlineSafe: false } },
    link: null,
    ...instrucciones,
  },
  ...accion,
});
const NADA = { kind: "NONE", actionId: "act-nada", legIndex: 0 };
const aprobacion = (legIndex: number, cosignRequestId = "cos-1"): Obj => ({ kind: "COSIGN_APPROVAL", actionId: "act-aprobar", legIndex, cosignRequestId, summary: "Approve" });

interface Tramos {
  onramp?: Obj;
  canje?: Obj;
  envio?: Obj;
}
/** Una carga de Bs 104: Stereum entrega USDT0 en Polygon, la cuenta de paso lo cambia a USDC y el puente lo deja en Stellar. */
function orden(o: Obj = {}, t: Tramos = {}): Obj {
  return {
    id: "ord_9f8e7d6c5b4a3210",
    direction: "ONRAMP",
    state: "awaiting_payment",
    createdAt: CREADA,
    updatedAt: CREADA,
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: "104", amountOutPlanned: "8.5", status: "AWAITING_ACTION", etaSeconds: 300, startedAt: CREADA, ...t.onramp }),
      tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: "8.5", amountOutPlanned: "8.48", signingMode: "COSIGNED", steps: [paso("approve"), paso("swap")], etaSeconds: 60, ...t.canje }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "8.48", amountOutPlanned: "8.45", signingMode: "COSIGNED", steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")], etaSeconds: 600, ...t.envio }),
    ],
    pendingAction: pagoQr(),
    failure: null,
    nextPollAfter: "2026-11-16T15:00:10.000Z",
    ...o,
  };
}
const ONRAMP_LISTO = { status: "COMPLETED", amountInActual: "104", amountOutActual: "8.5" };
const CANJE_LISTO = { status: "COMPLETED", amountOutActual: "8.48", steps: [paso("approve", "done"), paso("swap", "done")] };
const conStereum = () => orden({ state: "processing", pendingAction: NADA }, { onramp: { status: "ACTIVE", amountInActual: "104", startedAt: CREADA } });
const enLaCuentaDePaso = () =>
  orden({ state: "processing", pendingAction: aprobacion(1) }, { onramp: ONRAMP_LISTO, canje: { status: "AWAITING_ACTION", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA, steps: [paso("approve", "awaiting_approval"), paso("swap")] } });
const esperaElCanje = () =>
  orden({ state: "processing", pendingAction: aprobacion(1, "cos-2") }, { onramp: ONRAMP_LISTO, canje: { status: "AWAITING_ACTION", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA, steps: [paso("approve", "done"), paso("swap", "awaiting_approval")] } });
const cambiando = () =>
  orden({ state: "processing", pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: { status: "ACTIVE", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA, steps: [paso("approve", "confirming"), paso("swap")] } });
const enviando = () =>
  orden({ state: "processing", pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "ACTIVE", fundsLocation: { ...FONDOS_EN_PASO, asset: "USDC" }, startedAt: CREADA, steps: [paso("approve", "confirming"), paso("burn"), paso("attestation"), paso("mint")] } });
const viajando = () =>
  orden({ state: "settling_onchain", pendingAction: NADA }, { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "ACTIVE", startedAt: CREADA, steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "confirming"), paso("mint")] } });
const llego = () =>
  orden(
    { state: "completed", pendingAction: null, nextPollAfter: null },
    { onramp: ONRAMP_LISTO, canje: CANJE_LISTO, envio: { status: "COMPLETED", amountOutActual: "8.45", steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "done"), paso("mint", "done")] } },
  );
const falla = (f: Obj = {}): Obj => ({ legIndex: 1, code: "SWAP_FAILED", retryable: false, resolutionOwner: "POLLAR", resolutionAction: "pollar_follows_up", detail: null, ...f });
const frenadaEnElCanje = (failure: Obj) => orden({ state: "processing", pendingAction: NADA, failure, nextPollAfter: null }, { onramp: ONRAMP_LISTO, canje: { status: "HELD", fundsLocation: FONDOS_EN_PASO, failure } });

const marcas = (m: Partial<MarcasDeOrden> = {}): MarcasDeOrden => ({ ...SIN_MARCAS, ...m });
const carga = (o: Obj, m: Partial<MarcasDeOrden> = {}, vista: CargaEnLaVentana["vista"] = {}): CargaEnLaVentana => ({ orden: o, marcas: marcas(m), vista });

/* ------------------------------------------------------------------ lo que se sabe */

const ALTA: ProductoALaVenta = { id: "alta", usdc: "4", sorteos: 3, dias: 90 };
const P10: ProductoALaVenta = { id: "p10", usdc: "10", sorteos: 10, dias: 365 };
const PERMISO: PermisoDeCompra = { producto: "alta", desde: AHORA - 60_000, recargo: "4.25", total: "8.25", primera: true, cargada: false };
const CARGADA: PermisoDeCompra = { ...PERMISO, cargada: true };
const PERMISO_P10: PermisoDeCompra = { producto: "p10", desde: AHORA - 60_000, recargo: "0.5", total: "10.5", primera: false, cargada: false };
const verif = (tipo: PasoDeVerificacion["tipo"], estado: PasoDeVerificacion["estado"] = "por-hacer", numero: number | null = 1, total: number | null = 4): LecturaDeCotizacion => ({
  estado: "falta",
  falta: [{ que: "verificacion", paso: { tipo, estado, numero, total, opcion: "opt-1", corredor: "cor-1" } }],
});
const PRECIO: PrecioDeCarga = { quoteId: "q-104", vence: "2026-11-16T15:10:00.000Z", pagas: 104, recibis: 8.5, tasa: 104 / 8.5, minutos: 9, aprobaciones: 4, campos: [] };
const conPrecio = (p: Partial<PrecioDeCarga> = {}): LecturaDeCotizacion => ({ estado: "precio", precio: { ...PRECIO, ...p } });
const ORDEN_DEL_PAQUETE: OrdenDePago = {
  id: "ABCD2345",
  producto: "alta",
  usdc: "4",
  sorteos: 3,
  destino: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  nota: "tk:o:ABCD2345",
  memoId: "1",
  enlace: "web+stellar:pay?destination=GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  vence: Date.UTC(2026, 10, 19, 15, 0),
};

const base = (o: Partial<LoQueSeSabe> = {}): LoQueSeSabe => ({
  idioma: "es",
  ahora: AHORA,
  aparato: "compu",
  medio: "qr",
  cambio: true,
  producto: ALTA,
  permiso: PERMISO,
  saldo: "0.0000000",
  cotizacion: null,
  carga: null,
  aprobacionesTotales: 4,
  ...o,
});

/* ------------------------------------------------------------------ cómo se lee una pantalla */

const render = (l: "es" | "en", x: Texto | null): string => (x ? Object.entries(x.vars ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), String(T[l][x.clave] ?? "")) : "");
const palabras = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const claves = (p: PantallaDeCompra): string[] => [p.titulo, p.linea, ...p.datos, p.principal, p.enlace, ...p.plegado, p.etapa].filter((x): x is Texto => !!x).map((x) => x.clave);
const aLaVista = (l: "es" | "en", p: PantallaDeCompra): string => [p.etapa, p.titulo, p.linea, ...p.datos, p.principal, p.enlace].map((x) => render(l, x)).join(" | ");

interface Esperado {
  id: PantallaDeCompra["id"];
  titulo?: string;
  linea?: string | null;
  principal?: [string, string];
  enlace?: string | null;
  donde?: string | null;
  datos?: string[];
  plegado?: string[];
  etapa?: string | null;
  numero?: boolean;
  leer?: PantallaDeCompra["leer"];
}

interface Fila {
  nombre: string;
  s: LoQueSeSabe;
  espera: Esperado;
}

const FILAS: Fila[] = [
  /* --------------------------------------------- primera compra, sin saldo y sin verificar, en Bolivia */
  { nombre: "primera compra: Seguir con el pago abre la ventana mientras cotiza", s: base({ leyendo: true }), espera: { id: "espera", titulo: "compraPreparandoTitulo", linea: "compraPreparandoLinea", principal: ["esperar", "compraUnMomento"], enlace: null } },
  { nombre: "primera compra: sin el permiso de empezar todavía, lo pide", s: base({ permiso: null }), espera: { id: "espera", leer: "permiso" } },
  { nombre: "primera compra: sin el saldo leído, lo lee", s: base({ saldo: null }), espera: { id: "espera", leer: "saldo" } },
  {
    nombre: "primera compra: la cotización pide verificación: Verificá tu identidad",
    s: base({ cotizacion: verif("KYC") }),
    espera: { id: "verificar", titulo: "compraVerifTitulo", linea: "compraVerifLinea", principal: ["empezar-verificacion", "cargaVerifEmpezar"], enlace: "compraNoEstoy", datos: ["compraDatoPaqueteDe", "compraDatoRecargoPrimera", "compraDatoCambia"], plegado: ["compraVerifPasos", "compraVerifDatos", "cargaVerifGratis"], etapa: "compraEtapaIdentidad" },
  },
  {
    nombre: "verificar sin el recargo de la primera vez: el paquete y el pago con QR, sin la línea de la primera vez",
    s: base({ producto: P10, permiso: PERMISO_P10, cotizacion: verif("KYC") }),
    espera: { id: "verificar", datos: ["compraDatoPaqueteDe", "compraDatoRecargo", "compraDatoCambia"], plegado: ["compraVerifPasos", "compraVerifDatos"] },
  },
  {
    nombre: "primera compra: tocó Empezar: Tu carnet y tu cara",
    s: base({ cotizacion: verif("KYC"), verificacion: { empezo: true } }),
    espera: { id: "carnet", titulo: "compraIdTitulo", linea: "compraIdLinea", principal: ["abrir-verificacion", "cargaIdAbrir"], enlace: null, plegado: ["compraIdLuz"], etapa: "compraEtapaN" },
  },
  { nombre: "primera compra: la página de la verificación en inglés se avisa en español", s: base({ cotizacion: verif("KYC"), verificacion: { empezo: true }, diditEnIngles: true }), espera: { id: "carnet", plegado: ["compraIdLuz", "compraIdIngles"] } },
  {
    nombre: "primera compra: abrió la otra pestaña: espera, con el enlace por si la cerró",
    s: base({ cotizacion: verif("KYC", "en-curso"), verificacion: { empezo: true, abrio: true } }),
    espera: { id: "carnet-espera", linea: "compraIdEsperando", principal: ["ya-termine", "cargaIdYaTermine"], enlace: "cargaIdAbrir" },
  },
  { nombre: "primera compra: el navegador no abrió la pestaña: la principal es el enlace", s: base({ cotizacion: verif("KYC"), verificacion: { empezo: true, bloqueada: true } }), espera: { id: "carnet-bloqueada", linea: "cargaIdBloqueada", principal: ["abrir-verificacion", "cargaIdAbrir"] } },
  { nombre: "primera compra: la verificación venció", s: base({ cotizacion: verif("KYC", "vencido") }), espera: { id: "carnet-vencida", linea: "compraIdVencida", principal: ["verificacion-otra-vez", "cargaIdOtraVez"] } },
  { nombre: "primera compra: al volver a una verificación empezada, sin la pantalla de entrada", s: base({ cotizacion: verif("KYC", "en-curso") }), espera: { id: "carnet" } },
  { nombre: "primera compra: unos datos tuyos", s: base({ cotizacion: verif("FORM", "por-hacer", 2) }), espera: { id: "datos", titulo: "cargaFormTitulo", linea: "compraFormLinea", principal: ["guardar-datos", "cargaFormGuardar"], etapa: "compraEtapaN" } },
  { nombre: "primera compra: confirmá tus datos con el SEGIP", s: base({ cotizacion: verif("REGISTRY_CHECK", "por-hacer", 3) }), espera: { id: "segip", titulo: "cargaSegipTitulo", linea: "cargaSegipTexto", principal: ["confirmar-segip", "cargaSegipOk"], enlace: "compraEscribinos" } },
  { nombre: "primera compra: tu alta con Stereum", s: base({ cotizacion: verif("PROVIDER_REGISTRATION", "por-hacer", 4) }), espera: { id: "alta", titulo: "compraAltaTitulo", linea: "compraAltaLinea", principal: ["darme-de-alta", "cargaAltaOk"], plegado: ["compraAltaAcepto"] } },
  { nombre: "primera compra: sin el número del paso, el rótulo dice solo la etapa", s: base({ cotizacion: verif("FORM", "por-hacer", null, null) }), espera: { id: "datos", etapa: "compraEtapaIdentidad" } },
  {
    nombre: "primera compra: falta la línea: Preparamos tu cuenta",
    s: base({ cotizacion: { estado: "falta", falta: [{ que: "linea", emisor: CIRCLE }] } }),
    espera: { id: "preparar", titulo: "compraPrepTitulo", linea: "compraPrepLinea", principal: ["preparar", "compraPrepBoton"], plegado: ["compraPrepMas"], enlace: null },
  },
  { nombre: "primera compra: falta la cuenta de paso: la misma pantalla", s: base({ cotizacion: { estado: "falta", falta: [{ que: "cuenta-de-paso", red: "POLYGON" }] } }), espera: { id: "preparar" } },
  {
    nombre: "primera compra: hay precio: Pagás Bs 104, la primera vez con el rótulo Tu pago",
    s: base({ cotizacion: conPrecio() }),
    espera: {
      id: "precio",
      titulo: "compraPrecioTitulo",
      linea: "compraPrecioLinea",
      principal: ["ver-qr", "compraVerQr"],
      enlace: "compraOtraApp",
      datos: ["compraDatoPaqueteDe", "compraDatoRecargoPrimera", "compraDatoTotal", "compraDatoTasa", "compraDatoTarda", "compraDatoVale"],
      plegado: ["compraComoSePagaPrimera", "compraSobraPorQue", "compraDatoQueda"],
      etapa: "compraEtapaPago",
    },
  },
  { nombre: "primera compra: con un solo paso por aprobar", s: base({ cotizacion: conPrecio({ aprobaciones: 1 }) }), espera: { id: "precio", linea: "compraPrecioLinea1" } },
  { nombre: "primera compra: sin saber cuántos pasos, no se inventa el número", s: base({ cotizacion: conPrecio({ aprobaciones: null }) }), espera: { id: "precio", linea: "compraPrecioLineaSinN" } },
  { nombre: "primera compra: con el mínimo que rige, se dice plegado", s: base({ cotizacion: conPrecio({ pagas: 150 }), minimoBs: 150 }), espera: { id: "precio", plegado: ["compraComoSePagaPrimera", "compraSobraPorQue", "compraDatoQueda", "compraMinimo"] } },
  { nombre: "primera compra: el precio venció y este es el nuevo", s: base({ cotizacion: conPrecio(), precioVencio: true }), espera: { id: "precio-vencido", linea: "compraPrecioVencio", principal: ["ver-qr", "compraVerQr"] } },
  {
    nombre: "primera compra: en la compu: el QR, el monto y el vencimiento, sin Tu dinero que compita con el monto",
    s: base({ permiso: CARGADA, carga: carga(orden()) }),
    espera: { id: "qr", titulo: "compraQrTitulo", linea: "compraQrLinea", principal: ["ya-pague", "cargaYaPague"], enlace: null, donde: "compraDondeBanco", datos: ["compraDatoMonto", "compraDatoVence"] },
  },
  { nombre: "primera compra: en el celular, primero Guardar el QR", s: base({ permiso: CARGADA, aparato: "celular", carga: carga(orden()) }), espera: { id: "qr", linea: "compraQrLineaCel", principal: ["guardar-qr", "cargaGuardarQr"], enlace: null } },
  {
    nombre: "primera compra: en el celular, con el QR guardado: Ya pagué, y abrir en el banco si la orden trae el enlace",
    s: base({ permiso: CARGADA, aparato: "celular", carga: carga(orden({ pendingAction: pagoQr({ link: "https://banco.example/pagar" }) }), { guardoQr: AHORA - 10_000 }, { qrALaVista: true }) }),
    espera: { id: "qr", linea: "compraQrGuardadoLinea", principal: ["ya-pague", "cargaYaPague"], enlace: "cargaAbrirBanco" },
  },
  {
    nombre: "primera compra: en el celular, después de Abrir en la app de mi banco: Ya pagué, sin pedir que guarde la imagen",
    s: base({ permiso: CARGADA, aparato: "celular", carga: carga(orden({ pendingAction: pagoQr({ link: "https://banco.example/pagar" }) }), {}, { qrALaVista: true, abrioBanco: true }) }),
    espera: { id: "qr", linea: "compraTodaviaNoLinea", principal: ["ya-pague", "cargaYaPague"], enlace: "cargaAbrirBanco" },
  },
  { nombre: "primera compra: en el iPhone, la línea de mantener apretado", s: base({ permiso: CARGADA, aparato: "iphone", carga: carga(orden()) }), espera: { id: "qr", linea: "compraQrLineaIos", principal: ["ya-pague", "cargaYaPague"] } },
  { nombre: "primera compra: la orden no trae la imagen del QR", s: base({ permiso: CARGADA, carga: carga(orden({ pendingAction: pagoQr({ scannable: null }) })) }), espera: { id: "qr-falta", linea: "compraQrFalta", principal: ["mirar", "saldoVolverAMirar"], donde: "compraDondeBanco" } },
  {
    nombre: "primera compra: después de Ya pagué: Esperando tu pago, con Todavía no pagué",
    s: base({ permiso: CARGADA, carga: carga(orden(), { mostroQr: AHORA - 30_000, dijoPago: AHORA - 5_000 }) }),
    espera: { id: "espera-pago", titulo: "compraEsperandoTitulo", linea: "compraEsperandoLinea", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraTodaviaNo", donde: "compraDondeSaliendo", plegado: ["compraPodesCerrar"], numero: false },
  },
  { nombre: "primera compra: Stereum registró el pago: en camino", s: base({ permiso: CARGADA, carga: carga(conStereum(), { dijoPago: AHORA - 60_000 }) }), espera: { id: "camino", titulo: "cargaEnCaminoTitulo", donde: "compraDondeStereum", principal: ["esperar", "saldoVolverAMirar"] } },
  {
    nombre: "primera compra: la primera confirmación: antes, cuántas vienen",
    s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), { dijoPago: AHORA - 60_000 }) }),
    espera: { id: "antes", titulo: "compraAntesTitulo", linea: "compraAntesLinea", principal: ["ver-primer-paso", "cargaVerPrimerPaso"], donde: "compraDondePaso" },
  },
  {
    nombre: "primera compra: confirmación 1 de 4, con lo que se confirma en la línea y el detalle plegado",
    s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), { dijoPago: AHORA - 60_000 }, { vioAntesDeAprobar: true }), aprobacion: { revisado: { que: "permiso-cambio", dolares: 8.5 } } }),
    espera: { id: "aprobar", titulo: "compraAprobarTitulo", linea: "compraConfirmaPermisoCambio", principal: ["aprobar", "cargaAprobarBtn"], donde: "compraDondePaso", plegado: ["cargaAprobarPermiso", "compraAprobarTarde"], enlace: null },
  },
  { nombre: "primera compra: sin saber el total de pasos, el título no inventa el número", s: base({ permiso: CARGADA, aprobacionesTotales: null, carga: carga(esperaElCanje(), {}, { vioAntesDeAprobar: true }) }), espera: { id: "aprobar", titulo: "compraAprobarTituloSinN", linea: "compraConfirmaCambio", plegado: ["cargaAprobarCambio", "compraAprobarTarde"] } },
  { nombre: "primera compra: sin lo que dijo la regla, lo que se aprueba va sin el monto", s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }) }), espera: { id: "aprobar", plegado: ["cargaAprobarPermisoSinN", "compraAprobarTarde"] } },
  { nombre: "primera compra: aprobando: la principal ocupada", s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }), aprobacion: { enCurso: true } }), espera: { id: "aprobar", principal: ["aprobar", "cargaAprobando"] } },
  { nombre: "primera compra: entre confirmaciones, en camino", s: base({ permiso: CARGADA, carga: carga(viajando()) }), espera: { id: "camino", donde: "compraDondeViaje" } },
  { nombre: "primera compra: el cambio trabaja en la cuenta de paso: en camino, sin decir que espera una confirmación", s: base({ permiso: CARGADA, carga: carga(cambiando()) }), espera: { id: "camino", donde: "compraDondeCambiando", principal: ["esperar", "saldoVolverAMirar"] } },
  { nombre: "primera compra: el envío sale de la cuenta de paso: en camino a tu cuenta", s: base({ permiso: CARGADA, carga: carga(enviando()) }), espera: { id: "camino", donde: "compraDondeViaje" } },
  {
    nombre: "primera compra: llegó y el saldo alcanza: Terminar mi compra",
    s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } }),
    espera: { id: "llego", titulo: "compraLlegoTitulo", linea: "compraLlegoLinea", principal: ["pagar-paquete", "compraTerminar"], datos: ["compraDatoSeUsan", "compraDatoPaquete", "compraDatoDonde"], donde: "compraDondeCuenta", plegado: ["compraLlegoMas"] },
  },
  { nombre: "primera compra: llegó pero el saldo no se leyó: primero se lee", s: base({ permiso: CARGADA, saldo: null, carga: carga(llego()) }), espera: { id: "espera", leer: "saldo", donde: "compraDondeCuenta" } },
  { nombre: "primera compra: Terminar mi compra: pagando", s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), pago: { fase: "pagando" } }), espera: { id: "pagando", titulo: "compraPagandoTitulo", principal: ["esperar", "compraPagando"], donde: "compraDondeTinkazo" } },
  {
    nombre: "primera compra: el servidor vio el pago: Ya podés organizar tus sorteos, y Armar mi primer sorteo",
    s: base({ permiso: CARGADA, saldo: "0.2000000", carga: carga(llego()), pago: { fase: "listo", quedan: 3, saldo: "0.2000000" } }),
    espera: { id: "listo", titulo: "compraListoTitulo", linea: "pagoListoQuedan", principal: ["sortear", "compraArmarSorteo"], datos: ["compraDatoSaldo"] },
  },

  /* --------------------------------------------- segunda compra, ya verificada y sin saldo */
  {
    nombre: "segunda compra: el de diez: precio directo, sin rótulo de etapa y con el saldo que había",
    s: base({ producto: P10, permiso: PERMISO_P10, saldo: "0.2000000", cotizacion: conPrecio({ pagas: 130, recibis: 10.6 }) }),
    espera: { id: "precio", etapa: null, datos: ["compraDatoPaqueteDe", "compraDatoRecargo", "compraDatoTotal", "compraDatoTasa", "compraDatoSaldo", "compraDatoTarda", "compraDatoVale"], plegado: ["compraComoSePaga", "compraSobraPorQue", "compraDatoQueda"] },
  },
  { nombre: "segunda compra: el de diez: al final, Listo", s: base({ producto: P10, permiso: { ...PERMISO_P10, cargada: true }, saldo: "0.3000000", carga: carga(llego()), pago: { fase: "listo", quedan: 10, saldo: "0" } }), espera: { id: "listo", principal: ["cerrar", "cargaListo"], datos: [] } },

  /* --------------------------------------------- el saldo alcanza */
  {
    nombre: "el saldo alcanza: el saldo alcanza: un botón, sin cotizar ni pedir el permiso",
    s: base({ producto: P10, permiso: null, saldo: "12.0000000" }),
    espera: { id: "saldo", titulo: "compraSaldoTitulo", linea: "compraSaldoLinea", principal: ["pagar-paquete", "compraPagarSaldo"], enlace: null, datos: ["compraDatoPaquete"], plegado: ["compraSaldoMas"] },
  },
  { nombre: "el saldo alcanza: el saldo alcanza también fuera de Bolivia", s: base({ producto: P10, permiso: null, medio: "app", saldo: "10.0000000" }), espera: { id: "saldo" } },
  { nombre: "el saldo alcanza: pagando con el saldo, la pantalla de pagar", s: base({ producto: P10, permiso: null, saldo: "12.0000000", pago: { fase: "pagando" } }), espera: { id: "pagando" } },

  /* --------------------------------------------- vuelve con la carga en camino */
  { nombre: "vuelve: vuelve con el QR ya mostrado: pregunta, nunca el QR de entrada", s: base({ permiso: CARGADA, carga: carga(orden(), { mostroQr: AHORA - 600_000 }) }), espera: { id: "ya-pagaste", titulo: "cargaYaPagasteTitulo", linea: "cargaYaPagasteTexto", principal: ["si-pague", "cargaSiPague"], enlace: "cargaMostrarQr", donde: "compraDondeBanco" } },
  { nombre: "vuelve: vuelve desde otro aparato con la orden de hace rato: pregunta", s: base({ permiso: CARGADA, ahora: CREADA_MS + 5 * 60_000, carga: carga(orden()) }), espera: { id: "ya-pagaste" } },
  { nombre: "vuelve: vuelve con una aprobación por delante", s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }) }), espera: { id: "aprobar" } },
  { nombre: "vuelve: vuelve sin la carga y con el saldo que alcanza: Terminar mi compra", s: base({ permiso: CARGADA, saldo: "8.4500000" }), espera: { id: "llego" } },
  {
    nombre: "vuelve: con un pago con el saldo mandado y sin reconocer, nunca pide pagar lo que falta",
    s: base({ permiso: CARGADA, saldo: "0.2000000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375", recibido: "0" }, pagoEnviado: true }),
    espera: { id: "pago-no-se-sabe", principal: ["mirar-pago", "saldoVolverAMirar"], donde: "compraDondeTinkazo" },
  },
  { nombre: "vuelve: sin la carga y con un pago con el saldo sin reconocer, tampoco", s: base({ permiso: CARGADA, saldo: "0.2000000", pagoEnviado: true }), espera: { id: "pago-no-se-sabe" } },

  /* --------------------------------------------- paga desde otra aplicación */
  {
    nombre: "otra app: fuera de Bolivia: Pagá desde tu app, con Estoy en Bolivia",
    s: base({ medio: "app", ordenDelPaquete: ORDEN_DEL_PAQUETE }),
    espera: { id: "app", titulo: "compraAppTitulo", linea: "compraAppLinea", principal: ["ya-pague-app", "pagoYaPague"], enlace: "compraEstoy", datos: ["compraDatoMoneda"], plegado: ["compraNotaMemo", "compraSinDolares"] },
  },
  {
    nombre: "otra app: con el recargo de una compra con QR en curso, el plegado dice por qué va y que nunca se cobra dos veces",
    s: base({ medio: "app", ordenDelPaquete: { ...ORDEN_DEL_PAQUETE, usdc: "8.25", precio: "4", recargo: "4.25" } }),
    espera: { id: "app", datos: ["compraDatoMoneda", "compraDatoIncluyeRecargo"], plegado: ["compraRecargoPendiente", "compraNotaMemo", "compraSinDolares"] },
  },
  { nombre: "otra app: sin el QR para esta cuenta, sin enlace de cambio", s: base({ medio: "app", cambio: false, ordenDelPaquete: ORDEN_DEL_PAQUETE }), espera: { id: "app", enlace: null } },
  { nombre: "otra app: sin la orden del paquete todavía, la espera", s: base({ medio: "app" }), espera: { id: "espera" } },
  { nombre: "otra app: con una carga abierta, el QR manda aunque la elección guardada diga otra app", s: base({ medio: "app", permiso: CARGADA, carga: carga(orden()), ordenDelPaquete: ORDEN_DEL_PAQUETE }), espera: { id: "qr", enlace: null } },

  /* --------------------------------------------- tocó Ya pagué sin haber pagado */
  { nombre: "Ya pagué sin pagar: Todavía no pagué vuelve al mismo QR, con el aviso de no pagarlo dos veces", s: base({ permiso: CARGADA, todaviaNo: true, carga: carga(orden(), { mostroQr: AHORA - 30_000 }, { qrALaVista: true }) }), espera: { id: "qr", linea: "compraTodaviaNoLinea" } },
  { nombre: "Ya pagué sin pagar: con el QR vencido, Esperando tu pago ya no ofrece Todavía no pagué", s: base({ permiso: CARGADA, ahora: Date.parse(VENCE_QR) + 1, carga: carga(orden(), { dijoPago: Date.parse(VENCE_QR) - 1_000 }) }), espera: { id: "espera-pago", enlace: null } },
  { nombre: "Ya pagué sin pagar: con la orden ya en manos de Stereum, tampoco", s: base({ permiso: CARGADA, carga: carga(conStereum(), { dijoPago: AHORA - 1_000 }) }), espera: { id: "camino", enlace: null } },

  /* --------------------------------------------- las fallas */
  { nombre: "falla: no hay lugar para el QR hoy", s: base({ permiso: null, sinLugar: true }), espera: { id: "sin-qr", titulo: "compraSinQrTitulo", linea: "compraSinQrLinea", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraOtraApp", donde: "compraDondeNada" } },
  {
    nombre: "falla: pidió varios QR para esta compra: lo destraba Tinkazo, con Escribir a Tinkazo como principal",
    s: base({ permiso: CARGADA, cotizacion: conPrecio(), topeDeQr: true }),
    espera: { id: "sin-qr", titulo: "compraTopeDeQrTitulo", linea: "compraTopeDeQr", principal: ["escribir", "compraEscribinos"], enlace: "saldoVolverAMirar", donde: "compraDondeNada" },
  },
  {
    nombre: "falla: hay una orden de pagar desde otra app sin pagar: pregunta antes del QR, nunca la reemplaza sola",
    s: base({ cotizacion: conPrecio(), otraOrden: { id: "WXYZ6789", producto: "alta" } }),
    espera: { id: "otra-orden", titulo: "compraOtraOrdenTitulo", linea: "compraOtraOrdenLinea", principal: ["no-pague-otra", "compraOtraOrdenNo"], enlace: "compraOtraOrdenSi", donde: null, numero: false },
  },
  { nombre: "falla: sin ruta de Bolivia", s: base({ cotizacion: { estado: "no-se-puede" } }), espera: { id: "sin-qr" } },
  { nombre: "falla: sin créditos de Tinkazo antes de crear la orden", s: base({ cotizacion: { estado: "sin-creditos" } }), espera: { id: "sin-qr" } },
  { nombre: "falla: el monto fuera de lo que acepta el proveedor", s: base({ cotizacion: { estado: "cambiar-monto" } }), espera: { id: "sin-qr" } },
  { nombre: "falla: tres cotizaciones y ninguna llegó", s: base({ cotizacion: conPrecio(), noAlcanza: true }), espera: { id: "sin-qr" } },
  { nombre: "falla: la verificación quedó en revisión", s: base({ cotizacion: { estado: "en-revision" } }), espera: { id: "revision", titulo: "compraRevisionTitulo", linea: "compraRevisionLinea", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraOtraApp", donde: "compraDondeNada" } },
  { nombre: "falla: los datos no coinciden con el SEGIP", s: base({ cotizacion: { estado: "en-revision" }, verificacion: { segipNo: true } }), espera: { id: "segip-no", titulo: "compraSegipNoTitulo", linea: "compraSegipNo", principal: ["mirar", "saldoVolverAMirar"], enlace: null, donde: "compraDondeNada" } },
  { nombre: "falla: el SEGIP no confirmó, con el paso todavía pedido", s: base({ cotizacion: verif("REGISTRY_CHECK", "por-hacer", 3), verificacion: { segipNo: true } }), espera: { id: "segip-no" } },
  {
    nombre: "falla: la verificación fue rechazada",
    s: base({ cotizacion: { estado: "rechazada" } }),
    espera: { id: "rechazo", titulo: "compraRechazoTitulo", linea: "compraRechazoLinea", principal: ["usar-cupon", "cupoOfUsarCupon"], enlace: "compraOtraApp", plegado: ["compraRechazoMas"], donde: "compraDondeNada" },
  },
  {
    nombre: "falla: el QR venció y la orden se cerró",
    s: base({ permiso: CARGADA, ahora: Date.parse(VENCE_QR) + 1, carga: carga(orden({ state: "failed", nextPollAfter: null }), { mostroQr: AHORA }, { qrALaVista: true }) }),
    espera: { id: "qr-vencido-cerrada", titulo: "compraQrVencioTitulo", linea: "compraQrVencioCerrada", principal: ["pedir-qr-nuevo", "cargaQrNuevo"], enlace: "compraPagueIgual", donde: "compraDondeBanco" },
  },
  {
    nombre: "falla: el QR venció y la orden sigue abierta, sin QR nuevo",
    s: base({ permiso: CARGADA, ahora: Date.parse(VENCE_QR) + 1, carga: carga(orden(), { mostroQr: AHORA }) }),
    espera: { id: "qr-vencido-abierta", linea: "compraQrVencioAbierta", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraEscribinos", plegado: ["compraQrVencioAbiertaMas"], numero: true },
  },
  { nombre: "falla: pagó y el dinero tarda", s: base({ permiso: CARGADA, ahora: AHORA + 3 * 60_000, carga: carga(orden(), { dijoPago: AHORA }) }), espera: { id: "espera-pago", linea: "compraPagoTarda", numero: true, donde: "compraDondeSaliendo" } },
  {
    nombre: "falla: pagó, el QR venció y el banco no avisa: el número y Escribir a Tinkazo",
    s: base({ permiso: CARGADA, ahora: Date.parse(VENCE_QR) + 1, carga: carga(orden(), { dijoPago: Date.parse(VENCE_QR) - 5 * 60_000 }) }),
    espera: { id: "espera-pago", linea: "compraPagoTarda", enlace: "compraEscribinos", numero: true },
  },
  {
    nombre: "falla: el dinero tarda más de lo normal en camino: el número y Escribir a Tinkazo a la vista",
    s: base({ permiso: CARGADA, ahora: CREADA_MS + 31 * 60_000, carga: carga(conStereum(), { dijoPago: AHORA }) }),
    espera: { id: "camino", linea: "compraTardaMas", enlace: "compraEscribinos", numero: true },
  },
  {
    nombre: "falla: la carga quedó frenada y se arregla desde acá",
    s: base({ permiso: CARGADA, carga: carga(frenadaEnElCanje(falla({ resolutionOwner: "END_USER", retryable: true, resolutionAction: "retry" }))) }),
    espera: { id: "frenada", titulo: "compraFrenadaTitulo", linea: "compraFrenadaVos", principal: ["reintentar-carga", "clProbarDeNuevo"], enlace: "compraEscribinos", plegado: [], numero: true, donde: "compraDondeGuardado" },
  },
  { nombre: "falla: la carga quedó frenada y la revisa Pollar", s: base({ permiso: CARGADA, carga: carga(frenadaEnElCanje(falla())) }), espera: { id: "frenada", linea: "compraFrenadaPollar", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraEscribinos", donde: "compraDondeGuardado" } },
  { nombre: "falla: la carga quedó frenada por algo de Tinkazo", s: base({ permiso: CARGADA, carga: carga(frenadaEnElCanje(falla({ resolutionOwner: "INTEGRATOR", resolutionAction: "fund_gas_wallet" }))) }), espera: { id: "frenada", linea: "compraFrenadaTinkazo", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraEscribinos" } },
  { nombre: "falla: un 402 con la carga abierta es de Tinkazo", s: base({ permiso: CARGADA, carga: carga(conStereum(), { dijoPago: AHORA }, { sinCreditos: true }) }), espera: { id: "frenada", linea: "compraFrenadaTinkazo" } },
  {
    nombre: "falla: llegó menos del 95 %",
    s: base({ permiso: CARGADA, saldo: "7.5000000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } }),
    espera: { id: "menos", titulo: "compraMenosTitulo", linea: "compraMenosLinea", principal: ["cargar-falta", "compraCargarFalta"], enlace: "compraOtraApp", donde: "compraDondeCuenta" },
  },
  { nombre: "falla: llegó entre el 95 % y el total, se paga con el saldo", s: base({ permiso: CARGADA, saldo: "7.9000000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } }), espera: { id: "llego" } },
  { nombre: "falla: llegó menos que el total y no se sabe el mínimo: primero se lee", s: base({ permiso: CARGADA, saldo: "7.9000000", carga: carga(llego()) }), espera: { id: "espera", leer: "cobro" } },
  {
    nombre: "falla: el pago con el saldo vio que no alcanza: lo dice y vuelve a leer el saldo, sin otro Terminar mi compra igual",
    s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" }, pago: { fase: "sin-saldo" } }),
    espera: { id: "espera", linea: "compraPagoNoAlcanzo", principal: ["esperar", "compraUnMomento"], leer: "saldo", donde: "compraDondeCuenta" },
  },
  {
    nombre: "falla: el paquete dejó de venderse con el dinero ya en el saldo",
    s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), pago: { fase: "no-vende" } }),
    espera: { id: "no-vende", titulo: "compraNoVendeTitulo", linea: "compraNoVendeLinea", principal: ["mirar", "saldoVolverAMirar"], enlace: "compraMandar", donde: "compraDondeCuenta" },
  },
  { nombre: "falla: el paquete dejó de venderse antes de cargar", s: base({ permiso: { ...PERMISO, total: null } }), espera: { id: "no-vende", titulo: "compraNoVendeTitulo", linea: "compraNoVendeSinCarga", enlace: null, donde: "compraDondeNada" } },
  { nombre: "falla: llegó y el permiso todavía no se leyó: primero se lee, nunca Este paquete no se vende", s: base({ permiso: null, saldo: "8.4500000", carga: carga(llego()) }), espera: { id: "espera", leer: "permiso", donde: "compraDondeCuenta" } },
  { nombre: "falla: llegó y el permiso dice que el paquete ya no se vende", s: base({ permiso: { ...CARGADA, total: null }, saldo: "8.4500000", carga: carga(llego()) }), espera: { id: "no-vende", donde: "compraDondeCuenta" } },
  { nombre: "falla: se cortó la conexión con un QR a la vista", s: base({ permiso: CARGADA, carga: carga(orden()), sinRed: true }), espera: { id: "sin-red", titulo: "compraQrTitulo", linea: "compraSinRed", principal: ["reintentar", "clProbarDeNuevo"], enlace: null, donde: "compraDondeBanco" } },
  { nombre: "falla: se cortó la conexión antes de cualquier QR", s: base({ cotizacion: conPrecio(), sinRed: true }), espera: { id: "sin-red", titulo: "compraPrecioTitulo", linea: "clErrRed", principal: ["reintentar", "clProbarDeNuevo"] } },
  { nombre: "falla: la cotización no pudo leerse por la conexión", s: base({ cotizacion: { estado: "sin-red" } }), espera: { id: "sin-red", linea: "clErrRed" } },
  { nombre: "falla: pagar con el saldo no salió", s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), pago: { fase: "no-salio" } }), espera: { id: "pago-no-salio", titulo: "compraLlegoTitulo", linea: "compraPagoNoSalio", principal: ["pagar-paquete", "clProbarDeNuevo"], donde: "compraDondeCuenta" } },
  { nombre: "falla: pagar con el saldo no salió, sin QR de por medio", s: base({ producto: P10, permiso: null, saldo: "12.0000000", pago: { fase: "no-salio" } }), espera: { id: "pago-no-salio", titulo: "compraSaldoTitulo" } },
  { nombre: "falla: el proveedor no cubre la comisión del pago", s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), pago: { fase: "sin-patrocinio" } }), espera: { id: "pago-sin-patrocinio", linea: "compraPagoSinPatrocinio", principal: ["mirar", "saldoVolverAMirar"], plegado: ["compraAyuda"], numero: true } },
  { nombre: "falla: el pago armado no coincide con la orden", s: base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()), pago: { fase: "raro" } }), espera: { id: "pago-raro", titulo: "compraPagoRaroTitulo", linea: "compraPagoRaro", principal: ["escribir", "compraEscribinos"], numero: true } },
  { nombre: "falla: no se sabe si el pago salió, nunca se manda de nuevo", s: base({ permiso: CARGADA, saldo: "0.2000000", carga: carga(llego()), pago: { fase: "no-se-sabe" } }), espera: { id: "pago-no-se-sabe", titulo: "compraPagandoTitulo", linea: "compraPagoNoSeSabe", principal: ["mirar-pago", "saldoVolverAMirar"], donde: "compraDondeTinkazo", enlace: "compraEscribinos", numero: true } },
  { nombre: "falla: el pago salió y el servidor no lo ve en 5 minutos", s: base({ permiso: CARGADA, saldo: "0.2000000", carga: carga(llego()), pago: { fase: "sin-ver" } }), espera: { id: "pago-sin-ver", linea: "compraPagoSinVer", principal: ["mirar-pago", "saldoVolverAMirar"], enlace: "compraEscribinos", numero: true } },
  {
    nombre: "falla: la regla no reconoce un paso",
    s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }), aprobacion: { revisado: { motivo: "fuera de la lista" } } }),
    espera: { id: "raro", titulo: "compraRaroTitulo", linea: "compraRaroLinea", principal: ["escribir", "compraEscribinos"], donde: "compraDondePaso", numero: true, enlace: null },
  },
  { nombre: "falla: una aprobación no salió", s: base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }), aprobacion: { fallo: true } }), espera: { id: "aprobar-no-salio", linea: "compraAprobarNoSalio", principal: ["aprobar", "clProbarDeNuevo"] } },
  {
    nombre: "falla: un paso que no conocemos",
    s: base({ permiso: CARGADA, carga: carga(orden({ state: "processing", pendingAction: { kind: "BANK_TRANSFER", actionId: "x", legIndex: 0 } })) }),
    espera: { id: "desconocido", titulo: "compraDesconocidoTitulo", linea: "compraDesconocidoLinea", principal: ["escribir", "compraEscribinos"], numero: true },
  },
  {
    nombre: "falla: una orden que no se puede leer: el número igual, y Volver a mirar",
    s: base({ permiso: CARGADA, carga: carga(orden({}, { canje: { steps: [paso("approve", "otro-estado"), paso("swap")] } })) }),
    espera: { id: "desconocido", principal: ["escribir", "compraEscribinos"], enlace: "saldoVolverAMirar", numero: true },
  },
  { nombre: "falla: no se pudo hacer, antes de que pudiera pagar", s: base({ permiso: CARGADA, carga: carga(orden({ state: "failed", nextPollAfter: null }), {}, { falloAlCrear: true }) }), espera: { id: "fallo", linea: "compraFalloSinPago", principal: ["empezar-de-nuevo", "compraOtraVez"], donde: "compraDondeNada", enlace: null } },
  { nombre: "falla: no se pudo hacer y se lo devolvieron", s: base({ permiso: CARGADA, carga: carga(orden({ state: "refunded", nextPollAfter: null }), { dijoPago: AHORA }) }), espera: { id: "fallo", linea: "cargaDevueltaSinMonto", principal: ["empezar-de-nuevo", "compraOtraVez"], donde: "compraDondeDevuelto" } },
  {
    nombre: "falla: no se pudo hacer y no vemos el pago",
    s: base({ permiso: CARGADA, carga: carga(orden({ state: "failed", nextPollAfter: null }), { mostroQr: AHORA, dijoPago: AHORA }) }),
    espera: { id: "fallo", linea: "compraFalloSinVerPago", principal: ["escribir", "compraEscribinos"], enlace: "compraNoPague", donde: "compraDondeBanco", numero: true },
  },
  {
    nombre: "falla: la orden se cerró después de ver el pago, con el dinero en una cuenta tuya: nunca No vemos tu pago ni otro QR",
    s: base({ permiso: CARGADA, carga: carga(orden({ state: "failed", pendingAction: null, nextPollAfter: null }, { onramp: ONRAMP_LISTO, canje: { status: "FAILED", fundsLocation: FONDOS_EN_PASO, startedAt: CREADA } }), { dijoPago: AHORA }) }),
    espera: { id: "fallo", linea: "compraFalloConPago", principal: ["escribir", "compraEscribinos"], enlace: null, donde: "compraDondeGuardado", numero: true },
  },
  {
    nombre: "falla: Stereum vio el pago y la orden se cerró: el dinero lo revisa la empresa que lo mueve",
    s: base({ permiso: CARGADA, carga: carga(orden({ state: "failed", pendingAction: null, nextPollAfter: null }, { onramp: { status: "FAILED", amountInActual: "104" } })) }),
    espera: { id: "fallo", linea: "compraFalloConPago", principal: ["escribir", "compraEscribinos"], enlace: null, donde: "compraDondeRevision", numero: true },
  },
  {
    nombre: "falla: con el QR vencido y la orden cerrada, si el pago se vio, no se ofrece otro QR",
    s: base({ permiso: CARGADA, ahora: Date.parse(VENCE_QR) + 1, carga: carga(orden({ state: "failed", nextPollAfter: null }, { onramp: { status: "FAILED", amountInActual: "104" } }), { mostroQr: AHORA }, { qrALaVista: true }) }),
    espera: { id: "fallo", linea: "compraFalloConPago", enlace: null, numero: true },
  },
  { nombre: "falla: la cuenta pide protegerse antes de cotizar", s: base({ cotizacion: { estado: "falta", falta: [{ que: "proteger-cuenta" }] } }), espera: { id: "proteger", principal: ["proteger", "clSeguir"], linea: null, datos: [] } },
  { nombre: "falla: la cuenta pide protegerse con la carga en camino", s: base({ permiso: CARGADA, aparato: "celular", carga: carga(frenadaEnElCanje(falla({ resolutionAction: "set_up_recovery", resolutionOwner: "END_USER" }))) }), espera: { id: "proteger", linea: null, donde: "compraDondeGuardado" } },
  { nombre: "falla: la sesión venció", s: base({ permiso: CARGADA, carga: carga(viajando()), sesionVencida: true }), espera: { id: "sesion", titulo: "compraSesionTitulo", linea: "compraSesionLinea", principal: ["entrar", "clEntrarDeNuevo"], donde: "compraDondeViaje" } },
];

/* ------------------------------------------------------------------ cada fila */

describe("cada pantalla de los recorridos y de las fallas", () => {
  it.each(FILAS.map((f) => [f.nombre, f] as const))("%s", (_, f) => {
    const p = pantallaDeCompra(f.s);
    const e = f.espera;
    expect(p.id).toBe(e.id);
    if (e.titulo !== undefined) expect(p.titulo.clave).toBe(e.titulo);
    if (e.linea !== undefined) expect(p.linea?.clave ?? null).toBe(e.linea);
    if (e.principal) expect([p.principal.accion, p.principal.clave]).toEqual(e.principal);
    if (e.enlace !== undefined) expect(p.enlace?.clave ?? null).toBe(e.enlace);
    if (e.donde !== undefined) expect(p.donde).toBe(e.donde);
    if (e.datos) expect(p.datos.map((d) => d.clave)).toEqual(e.datos);
    if (e.plegado) expect(p.plegado.map((d) => d.clave)).toEqual(e.plegado);
    if (e.etapa !== undefined) expect(p.etapa?.clave ?? null).toBe(e.etapa);
    if (e.numero !== undefined) expect(p.numero !== null, "número de compra").toBe(e.numero);
    if (e.leer !== undefined) expect(p.leer).toBe(e.leer);
  });
});

/* ------------------------------------------------------------------ las reglas de todas las filas */

const TODAS: [string, LoQueSeSabe][] = FILAS.flatMap((f) => [
  [`${f.nombre} (es)`, f.s] as [string, LoQueSeSabe],
  [`${f.nombre} (en)`, { ...f.s, idioma: "en" }] as [string, LoQueSeSabe],
  [`${f.nombre} (sin enlace de cambio)`, { ...f.s, cambio: false }] as [string, LoQueSeSabe],
]);
const CAMBIO = new Set(["otra-app", "estoy-en-bolivia"]);
const FINALES = new Set(["completed", "failed", "refunded"]);
const abierta = (s: LoQueSeSabe): boolean => !!s.carga && !FINALES.has(String((s.carga.orden as Obj).state));

describe("las reglas de toda pantalla", () => {
  it("cada texto existe en los dos idiomas, el título tiene 6 palabras o menos y la línea 14 o menos", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      for (const k of claves(p)) for (const l of ["es", "en"] as const) expect(typeof T[l][k] === "string" && (T[l][k] as string).trim() !== "", `${nombre}: ${l} ${k}`).toBe(true);
      expect(palabras(render(s.idioma, p.titulo)), `${nombre}: ${render(s.idioma, p.titulo)}`).toBeLessThanOrEqual(6);
      if (p.linea) expect(palabras(render(s.idioma, p.linea)), `${nombre}: ${render(s.idioma, p.linea)}`).toBeLessThanOrEqual(14);
      expect(aLaVista(s.idioma, p), nombre).not.toMatch(/\{\w+\}/);
    }
  });

  it("una sola principal, y el enlace nunca repite la principal", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      expect(p.principal.clave, nombre).toBeTruthy();
      if (p.enlace) expect(p.enlace.clave, nombre).not.toBe(p.principal.clave);
    }
  });

  it("Tu dinero en toda pantalla desde que hubo un QR, hasta que la compra quedó lista, salvo junto al QR mismo", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (!s.carga || p.id === "listo") continue;
      expect(p.donde, nombre).not.toBeNull();
      // Junto al QR, antes de pagar, competía con el monto y sembraba la duda: se ve recién desde Ya pagué.
      if (p.id === "qr") expect(p.datos.map((d) => d.clave), nombre).not.toContain("compraDatoDonde");
      else expect(p.datos.map((d) => d.clave), nombre).toContain("compraDatoDonde");
    }
  });

  it("dónde está el dinero no pide confirmar en una pantalla donde no hay nada que confirmar", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.donde === "compraDondePaso") expect(["antes", "aprobar", "aprobar-no-salio", "raro", "sesion", "sin-red"], nombre).toContain(p.id);
    }
  });

  it("la cuenta de paso nunca a la vista: solo plegada", () => {
    for (const [nombre, s] of TODAS) expect(aLaVista(s.idioma, pantallaDeCompra(s)), nombre).not.toMatch(/cuenta de paso|pass-through/i);
  });

  it("nunca Terminar mi compra ni Pagar con mi saldo sin un saldo leído", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.principal.accion === "pagar-paquete") expect(s.saldo, nombre).not.toBeNull();
    }
    expect(pantallaDeCompra(base({ permiso: CARGADA, saldo: null, carga: carga(llego()) })).principal.accion).not.toBe("pagar-paquete");
    expect(pantallaDeCompra(base({ producto: P10, permiso: null, saldo: null })).principal.accion).not.toBe("pagar-paquete");
  });

  it("Terminar mi compra y Pagar con mi saldo dicen cuánto se paga, y nunca más que el saldo leído", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.principal.accion !== "pagar-paquete") {
        expect(p.pagar, nombre).toBeNull();
        continue;
      }
      expect(p.pagar, nombre).not.toBeNull();
      expect(Number(p.pagar), nombre).toBeGreaterThan(0);
      expect(Number(p.pagar), nombre).toBeLessThanOrEqual(Number(s.saldo));
    }
  });

  it("nunca un enlace al otro camino con una carga abierta, ni cuando no se ofrece el cambio", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (abierta(s) || !s.cambio) expect(CAMBIO.has(p.enlace?.accion ?? ""), nombre).toBe(false);
    }
  });

  it("nunca sigue sola: en camino la principal está ocupada y Si cerrás dice qué falta, también el toque final", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.id !== "camino") continue;
      expect(p.principal.ocupado, nombre).toBe(true);
      expect(p.datos.map((d) => d.clave).some((k) => k.startsWith("compraDatoSiCerras")), nombre).toBe(true);
    }
    const sinAprobaciones = pantallaDeCompra(base({ permiso: CARGADA, carga: carga(viajando()) }));
    expect(sinAprobaciones.datos.map((d) => d.clave)).toContain("compraDatoSiCerrasPagar");
    const conCuatro = pantallaDeCompra(base({ permiso: CARGADA, carga: carga(conStereum(), { dijoPago: AHORA }) }));
    expect(conCuatro.datos.find((d) => d.clave.startsWith("compraDatoSiCerras"))).toEqual({ clave: "compraDatoSiCerras", vars: { n: "4" } });
  });

  it("antes de mostrar el QR, con marcas o con la orden de más de 2 minutos, se pregunta", () => {
    for (const m of [{ mostroQr: AHORA }, { guardoQr: AHORA }]) expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(orden(), m) })).id).toBe("ya-pagaste");
    expect(pantallaDeCompra(base({ permiso: CARGADA, ahora: CREADA_MS + 2 * 60_000, carga: carga(orden()) })).id).toBe("ya-pagaste");
    expect(pantallaDeCompra(base({ permiso: CARGADA, ahora: CREADA_MS + 2 * 60_000 - 1, carga: carga(orden()) })).id).toBe("qr");
  });

  it("Todavía no pagué solo con la orden esperando el pago y el QR vigente", () => {
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.enlace?.accion !== "todavia-no") continue;
      const o = s.carga?.orden as Obj;
      expect(["created", "awaiting_payment"], nombre).toContain(o.state);
      expect(Date.parse(String((o.pendingAction as Obj).expiresAt)), nombre).toBeGreaterThan(s.ahora);
    }
  });

  it("antes de la primera aprobación, la pantalla que dice cuántos pasos vienen", () => {
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso()) })).id).toBe("antes");
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }) })).id).toBe("aprobar");
    // Con un paso ya aprobado, no vuelve a avisar.
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(esperaElCanje()) })).id).toBe("aprobar");
  });

  it("el número de compra solo cuando hace falta pedir ayuda", () => {
    const conNumero = new Set(["espera-pago", "qr-vencido-abierta", "camino", "frenada", "pago-raro", "pago-no-se-sabe", "pago-sin-ver", "pago-sin-patrocinio", "raro", "desconocido", "fallo", "sesion", "sin-red"]);
    for (const [nombre, s] of TODAS) {
      const p = pantallaDeCompra(s);
      if (p.numero !== null) expect(conNumero.has(p.id), nombre).toBe(true);
      // Con una compra en curso, todo Escribir a Tinkazo lleva el número. Antes (la verificación, o el tope de QR antes de
      // una carga), todavía no hay número.
      if ((p.principal.accion === "escribir" || p.enlace?.accion === "escribir") && (s.carga || s.pago)) expect(p.numero, nombre).not.toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ los montos que se ven */

describe("los montos que ve la persona", () => {
  const render0 = (p: PantallaDeCompra, k: string, l: "es" | "en" = "es") => render(l, [...p.datos, ...p.plegado].find((d) => d.clave.startsWith(k)) ?? null);

  it("el título del precio dice los bolivianos de la cotización, con Bs adelante", () => {
    expect(render("es", pantallaDeCompra(base({ cotizacion: conPrecio() })).titulo)).toBe("Pagás Bs 104");
    expect(render("en", pantallaDeCompra(base({ idioma: "en", cotizacion: conPrecio() })).titulo)).toBe("You pay Bs 104");
  });

  it("lo que queda en el saldo es el saldo más lo que llega menos el total de la compra, al centavo para abajo", () => {
    // 0,20 de saldo + 8,50 que llegan − 8,25 del total con el recargo = 0,45.
    const p = pantallaDeCompra(base({ saldo: "0.2000000", cotizacion: conPrecio() }));
    expect(render0(p, "compraDatoQueda")).toBe("Queda en tu saldo: unos 0,45 dólares");
    expect(render0(p, "compraDatoSaldo")).toBe("Tu saldo: 0,20 dólares");
    expect(render0(pantallaDeCompra(base({ idioma: "en", saldo: "0.2000000", cotizacion: conPrecio() })), "compraDatoQueda", "en")).toBe("Stays in your balance: about US$0.45");
  });

  it("el precio separa el paquete del pago con QR, los dos del servidor, y lo explica plegado", () => {
    const p = pantallaDeCompra(base({ cotizacion: conPrecio({ tasa: 12.5 }) }));
    // El botón prometía 3 sorteos por 4 dólares: a la vista, ese mismo precio y aparte lo que suma pagar con QR.
    expect(render0(p, "compraDatoPaqueteDe")).toBe("3 sorteos oficiales: 4 dólares");
    expect(render0(p, "compraDatoRecargoPrimera")).toBe("Pago con QR, la primera vez: 4,25 dólares");
    expect(render("es", p.plegado[0] ?? null)).toBe("La primera vez, el pago con QR incluye verificar tu identidad.");
    // Cuánto sale cada dólar va a la vista, con el total.
    expect(render0(p, "compraDatoTasa")).toBe("Cada dólar: unos Bs 12,50");
    expect(render0(p, "compraDatoTotal")).toBe("Total: 8,25 dólares");
    expect(render0(pantallaDeCompra(base({ idioma: "en", cotizacion: conPrecio() })), "compraDatoPaqueteDe", "en")).toBe("3 Live draws: US$4");
    // Las siguientes: el recargo de las siguientes, sin la verificación.
    const p10 = pantallaDeCompra(base({ producto: P10, permiso: PERMISO_P10, cotizacion: conPrecio({ pagas: 130, recibis: 10.6 }) }));
    expect(render0(p10, "compraDatoPaqueteDe")).toBe("10 sorteos oficiales: 10 dólares");
    expect(render0(p10, "compraDatoRecargo")).toBe("Pago con QR: 0,50 dólares");
    expect(render("es", p10.plegado[0] ?? null)).toBe("El pago con QR cubre lo que cuesta pasar tus bolivianos a dólares.");
    // Con el recargo de 4 dólares justos.
    const cuatro = pantallaDeCompra(base({ permiso: { ...PERMISO, recargo: "4", total: "8" }, cotizacion: conPrecio() }));
    expect(render0(cuatro, "compraDatoRecargoPrimera")).toBe("Pago con QR, la primera vez: 4 dólares");
    expect(render0(cuatro, "compraDatoPaqueteDe")).toBe("3 sorteos oficiales: 4 dólares");
  });

  it("lo que tarda se ve antes de pagar, y la hora va en 24 horas, sin a. m.", () => {
    const p = pantallaDeCompra(base({ cotizacion: conPrecio() }));
    expect(render0(p, "compraDatoTarda")).toBe("Tarda en llegar: unos 9 minutos");
    expect(pantallaDeCompra(base({ cotizacion: conPrecio({ minutos: 1 }) })).datos.map((d) => d.clave)).toContain("compraDatoTardaPoco");
    expect(pantallaDeCompra(base({ cotizacion: conPrecio({ minutos: null }) })).datos.map((d) => d.clave)).not.toContain("compraDatoTarda");
    expect(render0(p, "compraDatoVale")).toMatch(/^Precio válido hasta: \d{2}:\d{2}$/);
    expect(render0(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(orden()) })), "compraDatoVence")).toMatch(/^Vence: \d{2}:\d{2}$/);
  });

  it("Se usa lo que cargaste: el total de la compra si el saldo alcanza, y el saldo si llegó entre el mínimo y el total", () => {
    expect(render0(pantallaDeCompra(base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()) })), "compraDatoSeUsan")).toBe("Se usa lo que cargaste: 8,25 dólares");
    expect(render0(pantallaDeCompra(base({ permiso: CARGADA, saldo: "7.9000000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } })), "compraDatoSeUsan")).toBe("Se usa lo que cargaste: 7,90 dólares");
  });

  it("lo que se paga con el saldo viaja en la pantalla: el total si alcanza, el saldo entero si llegó entre el mínimo y el total", () => {
    expect(pantallaDeCompra(base({ permiso: CARGADA, saldo: "8.4500000", carga: carga(llego()) })).pagar).toBe("8.25");
    expect(pantallaDeCompra(base({ permiso: CARGADA, saldo: "7.9000000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } })).pagar).toBe("7.9");
    expect(pantallaDeCompra(base({ producto: P10, permiso: null, saldo: "12.0000000" })).pagar).toBe("10");
  });

  it("lo que falta se dice al centavo para arriba, y con un dólar justo en singular", () => {
    const p = pantallaDeCompra(base({ permiso: CARGADA, saldo: "7.5012345", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } }));
    expect(render("es", p.linea)).toBe("Te faltan 0,75 dólares para este paquete.");
    const uno = pantallaDeCompra(base({ permiso: CARGADA, saldo: "7.2500000", carga: carga(llego()), cobro: { total: "8.25", minimo: "7.8375" } }));
    expect(uno.linea).toEqual({ clave: "compraMenosLinea1" });
  });

  it("lo que el servidor ya recibió de la orden se descuenta: lo que falta y lo que se usa", () => {
    const cobro = { total: "8.25", minimo: "7.8375", recibido: "4" };
    const falta = pantallaDeCompra(base({ permiso: CARGADA, saldo: "1.0000000", carga: carga(llego()), cobro }));
    expect(falta.id).toBe("menos");
    expect(render("es", falta.linea)).toBe("Te faltan 3,25 dólares para este paquete.");
    const alcanza = pantallaDeCompra(base({ permiso: CARGADA, saldo: "4.2500000", carga: carga(llego()), cobro }));
    expect(alcanza.id).toBe("llego");
    expect(render0(alcanza, "compraDatoSeUsan")).toBe("Se usa lo que cargaste: 4,25 dólares");
  });

  it("Pagar con mi saldo dice el precio del paquete, sin recargo: pagar con el saldo no usa el QR", () => {
    expect(render("es", pantallaDeCompra(base({ producto: P10, permiso: null, saldo: "12.0000000" })).principal)).toBe("Pagar 10 dólares con mi saldo");
    expect(render("en", pantallaDeCompra(base({ idioma: "en", producto: P10, permiso: null, saldo: "12.0000000" })).principal)).toBe("Pay US$10 from my balance");
  });

  it("con la compra ya cargada, lo que llegó paga el total de la compra, no el precio sin recargo", () => {
    expect(pantallaDeCompra(base({ permiso: CARGADA, saldo: "5.0000000" })).id).not.toBe("saldo");
  });

  it("el QR dice los bolivianos de la orden, no los de la cotización", () => {
    const p = pantallaDeCompra(base({ permiso: CARGADA, carga: carga(orden({ pendingAction: pagoQr({ amount: "104.50" }) })) }));
    expect(render("es", p.datos[0] ?? null)).toBe("Monto: Bs 104,50");
    expect(p.qr?.bs).toBe("104.50");
  });

  it("el rótulo de la etapa dice el paso de la verificación", () => {
    expect(render("es", pantallaDeCompra(base({ cotizacion: verif("FORM", "por-hacer", 2, 4) })).etapa)).toBe("Tu identidad: 2 de 4");
    expect(render("en", pantallaDeCompra(base({ idioma: "en", cotizacion: verif("FORM", "por-hacer", 2, 4) })).etapa)).toBe("Your identity: 2 of 4");
  });

  it("cada confirmación dice cuál de cuántas, y su línea dice qué se confirma", () => {
    const una = pantallaDeCompra(base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso(), {}, { vioAntesDeAprobar: true }) }));
    const dos = pantallaDeCompra(base({ permiso: CARGADA, carga: carga(esperaElCanje()) }));
    expect(render("es", una.titulo)).toBe("Confirmación 1 de 4");
    expect(render("es", dos.titulo)).toBe("Confirmación 2 de 4");
    expect(render("es", una.linea)).toBe("Permiso para cambiar tus dólares por los que acepta tu cuenta de Tinkazo.");
    expect(render("es", dos.linea)).toBe("Tus dólares se cambian por los que acepta tu cuenta de Tinkazo.");
  });

  it("antes de confirmar, el título dice cuántas faltan", () => {
    expect(render("es", pantallaDeCompra(base({ permiso: CARGADA, carga: carga(enLaCuentaDePaso()) })).titulo)).toBe("Faltan 4 confirmaciones");
    expect(render("en", pantallaDeCompra(base({ idioma: "en", permiso: CARGADA, carga: carga(enLaCuentaDePaso()) })).titulo)).toBe("4 confirmations left");
  });

  it("Pagá desde tu app trae los datos de la orden tal cual y la cuenta corta", () => {
    const p = pantallaDeCompra(base({ medio: "app", ordenDelPaquete: ORDEN_DEL_PAQUETE }));
    expect(p.app).toEqual({ monto: "4", nota: "tk:o:ABCD2345", cuenta: ORDEN_DEL_PAQUETE.destino, cuentaCorta: "GBRP…OX2H", enlace: ORDEN_DEL_PAQUETE.enlace, vence: ORDEN_DEL_PAQUETE.vence });
    expect(cuentaCorta(ORDEN_DEL_PAQUETE.destino)).toBe("GBRP…OX2H");
  });

  it("la orden con el recargo de una compra con QR en curso lo dice a la vista, con el número del servidor", () => {
    const conRecargo = { ...ORDEN_DEL_PAQUETE, producto: "p10", usdc: "10.5", precio: "10", recargo: "0.5" };
    const p = pantallaDeCompra(base({ producto: P10, permiso: null, medio: "app", ordenDelPaquete: conRecargo }));
    expect(p.id).toBe("app");
    expect(p.app?.monto).toBe("10.5");
    expect(p.datos.map((d) => d.clave)).toEqual(["compraDatoMoneda", "compraDatoIncluyeRecargo"]);
    expect(render("es", p.datos[1] ?? null)).toBe("Incluye el pago con QR: 0,50 dólares");
    const en = pantallaDeCompra(base({ idioma: "en", producto: P10, permiso: null, medio: "app", ordenDelPaquete: conRecargo }));
    expect(render("en", en.datos[1] ?? null)).toBe("Includes the QR payment: US$0.50");
    const uno = pantallaDeCompra(base({ producto: P10, permiso: null, medio: "app", ordenDelPaquete: { ...conRecargo, usdc: "11", precio: "10", recargo: "1" } }));
    expect(uno.datos[1]?.clave).toBe("compraDatoIncluyeRecargo1");
    // Sin recargo, el dato no está.
    expect(pantallaDeCompra(base({ medio: "app", ordenDelPaquete: ORDEN_DEL_PAQUETE })).datos.map((d) => d.clave)).toEqual(["compraDatoMoneda"]);
  });

  it("después de anular, la compra sigue con su recargo: el final de la carga fallida lo dice plegado, sin pedir pagar", () => {
    const fallida = orden({ state: "failed", pendingAction: null, nextPollAfter: null });
    const p = pantallaDeCompra(base({ permiso: CARGADA, recargoPendiente: "4.25", carga: carga(fallida, {}, { falloAlCrear: true }) }));
    expect(p.id).toBe("fallo");
    expect(p.principal.accion).toBe("empezar-de-nuevo");
    expect(p.plegado.map((x) => x.clave)).toEqual(["compraRecargoPendiente"]);
    // Sin recargo pendiente, nada plegado.
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(fallida, {}, { falloAlCrear: true }) })).plegado).toEqual([]);
  });

  it("Escribir a Tinkazo lleva el número de compra en el asunto", () => {
    expect(correoDeAyuda("5B4A3210", "es")).toBe("mailto:hola@tinkazo.app?subject=Compra%205B4A3210");
    expect(correoDeAyuda("5B4A3210", "en")).toBe("mailto:hola@tinkazo.app?subject=Purchase%205B4A3210");
    expect(correoDeAyuda(null, "es")).toBe("mailto:hola@tinkazo.app");
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(frenadaEnElCanje(falla())) })).numero).toBe("5B4A3210");
    // Una orden que no se puede leer igual tiene su número: sale del id tal cual vino.
    expect(pantallaDeCompra(base({ permiso: CARGADA, carga: carga(orden({ legs: [{ kind: "OTRO" }] })) })).numero).toBe("5B4A3210");
  });
});

/* ------------------------------------------------------------------ las cajas de Dejá tu cuenta lista */

describe("las cajas de Dejá tu cuenta lista en modo compra", () => {
  it("primera compra: tocó el primer paquete: con el permiso, la caja pasa a Activar tu cuenta para comprar con QR", () => {
    const c = cajaDeActivar({ medio: "qr", cambio: true, permiso: PERMISO });
    expect(c.id).toBe("activar-para-comprar");
    expect(c.linea).toEqual({ clave: "compraCuentaLinea" });
    expect([c.principal?.accion, c.principal?.clave]).toEqual(["activar", "clActivarBoton"]);
    expect(c.enlace?.clave).toBe("compraNoEstoy");
    expect(c.plegado).toEqual([{ clave: "compraCuentaMas" }]);
    // Antes de que nada cueste, lo que suma pagar con QR, con el número del servidor.
    expect(c.datos).toEqual([{ clave: "compraDatoRecargoPrimera", vars: { n: "4,25" } }]);
    expect(cajaDeActivar({ medio: "qr", cambio: true, permiso: { ...PERMISO, recargo: "4", total: "8" } }).datos).toEqual([{ clave: "compraDatoRecargoPrimera", vars: { n: "4" } }]);
    expect(cajaDeActivar({ medio: "qr", cambio: true, permiso: null }).datos).toEqual([]);
  });

  it("primera compra: sin lugar hoy: Ahora no hay pago con QR, con el enlace a otra app", () => {
    const c = cajaDeActivar({ medio: "qr", cambio: true, permiso: null, sinLugar: true });
    expect(c.id).toBe("sin-qr");
    expect(c.enlace?.clave).toBe("compraOtraApp");
    expect(cajaDeActivar({ medio: "qr", cambio: false, permiso: null, sinLugar: true }).enlace).toBeNull();
  });

  it("primera compra: con el medio de otra app, el panel de pagar desde otra app; sin permiso todavía, la caja de hoy", () => {
    expect(cajaDeActivar({ medio: "app", cambio: true, permiso: PERMISO }).id).toBe("app");
    expect(cajaDeActivar({ medio: "qr", cambio: true, permiso: null }).id).toBe("oferta");
    expect(cajaDeActivar({ medio: "qr", cambio: false, permiso: PERMISO }).enlace).toBeNull();
  });

  const caja = (o: Partial<Parameters<typeof cajaDelPaquete>[0]> = {}) => cajaDelPaquete({ carga: null, saldo: "0", total: "8.25", empezada: false, ahora: AHORA, ...o });

  it("primera compra: la primera vez: Tu primer paquete, con Seguir con el pago", () => {
    const c = caja();
    expect(c.titulo).toEqual({ clave: "compraCajaTitulo" });
    expect(c.linea).toEqual({ clave: "compraTeEspera" });
    expect([c.principal?.accion, c.principal?.clave]).toEqual(["seguir-compra", "compraSeguirPago"]);
  });

  it("vuelve: qué dice la caja, en este orden", () => {
    expect(caja({ verificacion: "rechazada" }).linea?.clave).toBe("compraRechazoAviso");
    expect(caja({ verificacion: "en-revision" }).linea?.clave).toBe("compraRevisionAviso");
    expect(caja({ carga: carga(enLaCuentaDePaso()) }).linea?.clave).toBe("compraEsperaAprobar");
    expect(caja({ carga: carga(esperaElCanje()) }).linea?.clave).toBe("compraEsperaAprobar");
    expect(caja({ carga: carga(conStereum(), { dijoPago: AHORA }) }).linea?.clave).toBe("compraSigueLinea");
    expect(caja({ carga: carga(viajando()) }).linea?.clave).toBe("compraSigueLinea");
    expect(caja({ carga: carga(orden(), { mostroQr: AHORA }) }).linea?.clave).toBe("compraTeEspera");
    expect(caja({ carga: carga(llego()), saldo: "8.4500000" }).linea?.clave).toBe("compraLlegoAviso");
    expect(caja({ saldo: "8.4500000" }).linea?.clave).toBe("compraLlegoAviso");
    expect(caja({ saldo: "1.0000000", empezada: true }).linea?.clave).toBe("compraTeEspera");
    expect(caja({ empezada: true }).principal?.clave).toBe("compraSeguirBoton");
    expect(caja({ carga: carga(viajando()) }).principal?.clave).toBe("compraSeguirBoton");
  });
});

/* ------------------------------------------------------------------ los montos antes de pagar */

describe("los montos que se ven antes de pagar", () => {
  it("Verificá tu identidad dice el paquete, su precio y lo que suma el QR la primera vez, los dos del servidor", () => {
    const p = pantallaDeCompra(base({ cotizacion: verif("KYC") }));
    expect(p.datos.map((d) => render("es", d))).toEqual(["3 sorteos oficiales: 4 dólares", "Pago con QR, la primera vez: 4,25 dólares", "Casa de cambio: Stereum"]);
    const en = pantallaDeCompra(base({ idioma: "en", cotizacion: verif("KYC") }));
    expect(en.datos.slice(0, 2).map((d) => render("en", d))).toEqual(["3 Live draws: US$4", "QR payment, first time: US$4.25"]);
    // Y lo plegado ya no dice que verificar no cuesta nada: va dentro del pago con QR de la primera vez.
    expect(p.plegado.map((d) => render("es", d)).join(" ")).not.toMatch(/no te cuesta nada/);
  });

  it("el precio dice el total de la compra y cuánto sale cada dólar, a la vista", () => {
    const p = pantallaDeCompra(base({ cotizacion: conPrecio() }));
    const datos = p.datos.map((d) => render("es", d));
    expect(datos).toContain("Total: 8,25 dólares");
    expect(datos).toContain("Cada dólar: unos Bs 12,24");
    expect(p.plegado.map((d) => d.clave)).not.toContain("compraTasa");
    expect(pantallaDeCompra(base({ cotizacion: conPrecio(), permiso: { ...PERMISO, recargo: "0", total: "1" } })).datos.map((d) => render("es", d))).toContain("Total: 1 dólar");
  });
});
