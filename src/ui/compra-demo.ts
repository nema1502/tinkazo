import { getLang, t } from "../i18n";
import type { OrdenDePago } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import { type EntornoDeCuenta, demoDeRampa, entornoDeCuenta } from "../stellar/cuenta-config";
import { USDC_MAINNET } from "../stellar/pagos";
import { type LecturaDeCotizacion, type MarcasDeOrden, type PasoDeVerificacion, type PrecioDeCarga, type QueSeAprueba, SIN_MARCAS, type VistaDeOrden } from "../stellar/rampa-pollar";
import { type AccionDeCompra, type LoQueSeSabe, type PantallaDeCompra, type PermisoDeCompra, pantallaDeCompra } from "./compra-qr-estado";
import { type AccionDeAfuera, type AvisoDelMotor, type DetalleDePantalla, type MotorDeCompra, type VentanaDeCompra, abrirCompra, aparatoDeEsteNavegador } from "./compra-qr";
import { type CompraDePaquetes, abrirSumarSorteos } from "./pago-paquete";
import { qrDataUrl } from "./qr";

/**
 * La demo de la compra con QR: la ventana Tu compra de verdad, con órdenes inventadas y sin red. Solo en la máquina de
 * quien prueba y con `VITE_RAMPA_DEMO=1` (`demoDeRampa`). Se abre con `?compra-demo` en la dirección: pone una lista
 * de compras de mentira y nada se abre hasta tocar una.
 *
 * No llama a nadie, no paga nada y no deja nada guardado: las marcas de las órdenes viven en memoria y el medio que se
 * elige no se recuerda (así una demo no cambia lo que después ve una compra de verdad en esta misma máquina).
 *
 * Cada compra de mentira avanza como avanzaría una de verdad: con el toque de la persona, o sola cuando lo que se
 * espera es de afuera (el banco, el dinero en camino). Los montos son de ejemplo, con la oferta de lanzamiento: el
 * primer paquete de 4 dólares con el recargo del QR de la primera vez, y 10 sorteos por 10 con el de las siguientes.
 */

export const ESCENARIOS = ["feliz", "ya-pague-por-error", "sin-qr", "revision", "qr-vencido", "frenada", "fallo", "saldo", "app"] as const;
export type Escenario = (typeof ESCENARIOS)[number];

interface Bil {
  es: string;
  en: string;
}
const tx = (b: Bil): string => (getLang() === "en" ? b.en : b.es);

const NOMBRES: Record<Escenario, Bil> = {
  feliz: { es: "Primera compra en Bolivia, de punta a punta", en: "First purchase in Bolivia, end to end" },
  "ya-pague-por-error": { es: "Dijo que pagó antes de pagar", en: "Said they paid before paying" },
  "sin-qr": { es: "Hoy no hay pago con QR", en: "No QR payment today" },
  revision: { es: "La verificación quedó en revisión", en: "The check is under review" },
  "qr-vencido": { es: "El QR venció con la compra abierta", en: "The QR expired with the purchase open" },
  frenada: { es: "Frenada de nuestro lado", en: "On hold on our side" },
  fallo: { es: "No vemos el pago", en: "We can't see the payment" },
  saldo: { es: "El saldo alcanza", en: "The balance covers it" },
  app: { es: "Paga desde otra app", en: "Pays from another app" },
};
const TEXTOS = {
  titulo: { es: "Demo de la compra", en: "Purchase demo" },
  linea: { es: "Datos inventados y sin red. Nada se paga ni se guarda.", en: "Made-up data, no network. Nothing is paid or saved." },
  afuera: { es: "En el sitio, esto sigue fuera de la ventana:", en: "On the site, this continues outside the window:" },
  sumar: { es: "Sumar sorteos, con dólares digitales", en: "Add draws, with digital dollars" },
} satisfies Record<string, Bil>;
/** El botón que llevó afuera, para decirlo en la nota. */
const BOTON_DE_AFUERA: Record<AccionDeAfuera, string> = { "usar-cupon": "cupoOfUsarCupon", mandar: "compraMandar", entrar: "clEntrarDeNuevo", proteger: "clProtegerTitulo", sortear: "compraArmarSorteo" };

/* ================================================================== los datos de ejemplo */

const MIN = 60_000;
/** Lo que tarda cada cosa en la demo: lo justo para que se vea que pasa. */
const PAUSA_MS = 900;
const RITMO_MS = 1_200;
/** Después de Ya pagué, lo que tarda el banco en avisar. */
const BANCO_MS = 1_500;

const ALTA: ProductoALaVenta = { id: "alta", usdc: "4", sorteos: 3, dias: 90 };
const P10: ProductoALaVenta = { id: "p10", usdc: "10", sorteos: 10, dias: 365 };

interface Montos {
  /** Los bolivianos del QR. */
  bs: number;
  /** Lo que entrega Stereum, lo que deja el cambio y lo que llega a la cuenta, en dólares. */
  stereum: number;
  cambio: number;
  llega: number;
}
/** La primera compra: 4 dólares más el recargo de la primera vez (4), con un margen para el cambio. */
const PRIMERA: Montos = { bs: 99, stereum: 8.31, cambio: 8.28, llega: 8.25 };
/** Diez sorteos con el recargo de las siguientes (0,50), con 0,25 de saldo que ya tenía. */
const SIGUIENTE: Montos = { bs: 127, stereum: 10.65, cambio: 10.62, llega: 10.58 };

const permiso = (p: ProductoALaVenta, desde: number, cargada = false): PermisoDeCompra =>
  p.id === "alta"
    ? { producto: "alta", desde, recargo: "4", total: "8", primera: true, cargada }
    : { producto: p.id, desde, recargo: "0.5", total: "10.5", primera: false, cargada };

const iso = (ms: number): string => new Date(ms).toISOString();
const dinero = (n: number): string => n.toFixed(7);

function precio(m: Montos, ahora: number): PrecioDeCarga {
  return { quoteId: `q-demo-${m.bs}`, vence: iso(ahora + 10 * MIN), pagas: m.bs, recibis: m.llega, tasa: m.bs / m.llega, minutos: 16, aprobaciones: 4, campos: [] };
}

function verificacion(tipo: PasoDeVerificacion["tipo"], numero: number, estado: PasoDeVerificacion["estado"] = "por-hacer"): LecturaDeCotizacion {
  return { estado: "falta", falta: [{ que: "verificacion", paso: { tipo, estado, numero, total: 4, opcion: `opt-${numero}`, corredor: "cor-demo" } }] };
}

/** La imagen del QR: uno de verdad que dice que es de la demo (un banco no lo cobra), o un punto si no se puede dibujar. */
const PUNTO = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let imagenDelQr: Promise<{ mediaType: string; encoding: "base64"; data: string }> | null = null;
function imagenDeMentira(): Promise<{ mediaType: string; encoding: "base64"; data: string }> {
  imagenDelQr ??= qrDataUrl("Tinkazo demo. Este QR no se paga.")
    .catch(() => null)
    .then((url) => {
      const m = url ? /^data:([^;,]+);base64,(.+)$/.exec(url) : null;
      return m ? { mediaType: m[1] as string, encoding: "base64" as const, data: m[2] as string } : { mediaType: "image/png", encoding: "base64" as const, data: PUNTO };
    });
  return imagenDelQr;
}

/* ------------------------------------------------------------------ las órdenes de carga, como las da el proveedor */

const CIRCLE = USDC_MAINNET.issuer;
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" };
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: CIRCLE, chain: "STELLAR" };
const USDT_POLYGON = { kind: "asset", code: "USDT0", identifier: "0x0000000000000000000000000000000000000d01", chain: "POLYGON" };
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: "0x0000000000000000000000000000000000000d02", chain: "POLYGON" };
const FONDOS_EN_PASO = { chain: "POLYGON", address: "0x0000000000000000000000000000000000000d03", asset: "USDT0", amount: "0" };

type Obj = Record<string, unknown>;
const paso = (kind: string, status = "pending"): Obj => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (x: Obj): Obj => ({
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
  ...x,
});
const NADA = { kind: "NONE", actionId: "act-nada", legIndex: 0 };
const aprobacion = (legIndex: number, n: number): Obj => ({ kind: "COSIGN_APPROVAL", actionId: `act-aprobar-${n}`, legIndex, cosignRequestId: `cos-demo-${n}`, summary: "Approve" });

interface CargaDeMentira {
  id: string;
  montos: Montos;
  creada: number;
  vence: number;
  imagen: { mediaType: string; encoding: "base64"; data: string };
  /** Cuándo vio Stereum el pago. */
  pagada: number;
}

/** Lo que se aprueba en cada etapa que espera una aprobación, como lo diría la regla. */
const REVISADO: Record<number, { que: QueSeAprueba; dolares: (m: Montos) => number | null }> = {
  2: { que: "permiso-cambio", dolares: (m) => m.stereum },
  4: { que: "cambio", dolares: () => null },
  6: { que: "permiso-envio", dolares: (m) => m.cambio },
  8: { que: "envio", dolares: () => null },
};

/**
 * La orden de carga en cada etapa: 0 espera el pago del QR, 1 Stereum vio el pago, 2 a 8 el cambio y el envío (las
 * pares esperan una aprobación, las impares trabajan solas), 9 el dinero viaja a la cuenta y 10 llegó. `fallida`: la
 * orden se cerró sin ver el pago.
 */
function ordenDe(c: CargaDeMentira, etapa: number | "fallida"): Obj {
  const m = c.montos;
  const pagoQr = {
    kind: "FIAT_PAYMENT",
    actionId: "act-pago",
    legIndex: 0,
    expiresAt: iso(c.vence),
    instructions: { kind: "qr", amount: `${m.bs}.00`, currency: "BOB", scannable: { kind: "opaque", image: c.imagen }, link: null },
  };
  const stereumListo = { status: "COMPLETED", amountInActual: String(m.bs), amountOutActual: String(m.stereum) };
  const n = etapa === "fallida" ? -1 : etapa;
  const onramp =
    n <= 0 ? { status: "AWAITING_ACTION", startedAt: iso(c.creada) } : n === 1 ? { status: "ACTIVE", amountInActual: String(m.bs), startedAt: iso(c.pagada) } : stereumListo;
  const pasosDelCambio =
    n <= 1 ? [paso("approve"), paso("swap")] : n === 2 ? [paso("approve", "awaiting_approval"), paso("swap")] : n === 3 ? [paso("approve", "confirming"), paso("swap")] : n === 4 ? [paso("approve", "done"), paso("swap", "awaiting_approval")] : n === 5 ? [paso("approve", "done"), paso("swap", "confirming")] : [paso("approve", "done"), paso("swap", "done")];
  const cambio =
    n <= 1 ? {} : n <= 5 ? { status: n % 2 === 0 ? "AWAITING_ACTION" : "ACTIVE", fundsLocation: FONDOS_EN_PASO, startedAt: iso(c.pagada + 3 * MIN), steps: pasosDelCambio } : { status: "COMPLETED", amountOutActual: String(m.cambio), steps: pasosDelCambio };
  const pasosDelEnvio =
    n <= 5
      ? [paso("approve"), paso("burn"), paso("attestation"), paso("mint")]
      : n === 6
        ? [paso("approve", "awaiting_approval"), paso("burn"), paso("attestation"), paso("mint")]
        : n === 7
          ? [paso("approve", "confirming"), paso("burn"), paso("attestation"), paso("mint")]
          : n === 8
            ? [paso("approve", "done"), paso("burn", "awaiting_approval"), paso("attestation"), paso("mint")]
            : n === 9
              ? [paso("approve", "done"), paso("burn", "done"), paso("attestation", "confirming"), paso("mint")]
              : [paso("approve", "done"), paso("burn", "done"), paso("attestation", "done"), paso("mint", "done")];
  const envio =
    n <= 5
      ? {}
      : n <= 8
        ? { status: n % 2 === 0 ? "AWAITING_ACTION" : "ACTIVE", fundsLocation: { ...FONDOS_EN_PASO, asset: "USDC" }, startedAt: iso(c.pagada + 6 * MIN), steps: pasosDelEnvio }
        : n === 9
          ? { status: "ACTIVE", startedAt: iso(c.pagada + 8 * MIN), steps: pasosDelEnvio }
          : { status: "COMPLETED", amountOutActual: String(m.llega), steps: pasosDelEnvio };
  const estado = etapa === "fallida" ? "failed" : n <= 0 ? "awaiting_payment" : n === 10 ? "completed" : n === 9 ? "settling_onchain" : "processing";
  const accion = etapa === "fallida" || n <= 0 ? pagoQr : n === 10 ? null : n % 2 === 0 && n >= 2 && n <= 8 ? aprobacion(n <= 4 ? 1 : 2, n / 2) : NADA;
  return {
    id: c.id,
    direction: "ONRAMP",
    state: estado,
    createdAt: iso(c.creada),
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: String(m.bs), amountOutPlanned: String(m.stereum), etaSeconds: 300, ...onramp }),
      tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: String(m.stereum), amountOutPlanned: String(m.cambio), signingMode: "COSIGNED", etaSeconds: 60, steps: pasosDelCambio, ...cambio }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: String(m.cambio), amountOutPlanned: String(m.llega), signingMode: "COSIGNED", etaSeconds: 600, steps: pasosDelEnvio, ...envio }),
    ],
    pendingAction: accion,
    failure: null,
    nextPollAfter: etapa === "fallida" || n === 10 ? null : iso(c.creada + 10_000),
  };
}

/** La orden del paquete para pagar desde otra app: una cuenta de ejemplo, la nota y el enlace de pago. */
function ordenDelPaquete(p: ProductoALaVenta, ahora: number): OrdenDePago {
  const destino = "GDEMOTINKAZOCUENTADEEJEMPLOQUENORECIBEPAGOS";
  return {
    id: "DEMO4K7Q",
    producto: p.id,
    usdc: p.usdc,
    sorteos: p.sorteos,
    destino,
    nota: "tk:o:DEMO4K7Q",
    memoId: "1",
    enlace: `web+stellar:pay?destination=${destino}&amount=${p.usdc}&memo=tk%3Ao%3ADEMO4K7Q`,
    vence: ahora + 3 * 24 * 60 * MIN,
  };
}

/* ================================================================== el motor de la demo */

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** El aparato: el de este navegador, o el que pide la dirección (`?aparato=celular`). */
function aparato(): LoQueSeSabe["aparato"] {
  try {
    const pedido = new URLSearchParams(location.search).get("aparato");
    if (pedido === "celular" || pedido === "compu") return pedido;
  } catch {
    /* sin dirección */
  }
  return aparatoDeEsteNavegador();
}

class CompraDeMentira implements MotorDeCompra {
  readonly ritmoMs = RITMO_MS;
  /** Por dónde va la verificación: 0 el carnet, 1 los datos, 2 el SEGIP, 3 el alta, 4 preparar la cuenta, 5 el precio. */
  private pasoDeVerificacion = 0;
  private etapa = 0;
  private carga: CargaDeMentira | null = null;
  private nueva = 0;
  /** Si el próximo Ya pagué es de verdad. En Dijo que pagó antes de pagar, el primero no lo es. */
  private pagaDeVerdad: boolean;
  private readonly producto: ProductoALaVenta;
  private readonly montos: Montos;

  constructor(
    private readonly escenario: Escenario,
    private readonly reloj: () => number,
  ) {
    this.pagaDeVerdad = escenario !== "ya-pague-por-error";
    const primera = escenario === "feliz" || escenario === "sin-qr" || escenario === "revision" || escenario === "app";
    this.producto = primera ? ALTA : P10;
    this.montos = primera ? PRIMERA : SIGUIENTE;
    void imagenDeMentira();
  }

  inicio(): LoQueSeSabe {
    const ahora = this.reloj();
    const p = this.producto;
    const base: LoQueSeSabe = {
      idioma: getLang() === "en" ? "en" : "es",
      ahora,
      aparato: aparato(),
      medio: "qr",
      cambio: true,
      producto: p,
      permiso: permiso(p, ahora - MIN),
      saldo: null,
      cotizacion: null,
      carga: null,
      aprobacionesTotales: 4,
    };
    const saldoDeAntes = dinero(this.producto === ALTA ? 0 : 0.25);
    switch (this.escenario) {
      case "feliz":
      case "ya-pague-por-error":
        return base;
      case "sin-qr":
        return { ...base, permiso: null, sinLugar: true, saldo: saldoDeAntes };
      case "revision":
        return { ...base, saldo: saldoDeAntes, cotizacion: { estado: "en-revision" } };
      case "qr-vencido":
        return this.conCarga({ ...base, saldo: saldoDeAntes }, 0, { creada: ahora - 20 * MIN, vence: ahora - 5 * MIN, marcas: { mostroQr: ahora - 19 * MIN } });
      case "frenada":
        return this.conCarga({ ...base, saldo: saldoDeAntes }, 1, { creada: ahora - 25 * MIN, vence: ahora - 10 * MIN, pagada: ahora - 12 * MIN, marcas: { mostroQr: ahora - 24 * MIN, dijoPago: ahora - 12 * MIN }, vista: { sinCreditos: true } });
      case "fallo":
        return this.conCarga({ ...base, saldo: saldoDeAntes }, "fallida", { creada: ahora - 40 * MIN, vence: ahora - 25 * MIN, marcas: { mostroQr: ahora - 39 * MIN, dijoPago: ahora - 30 * MIN } });
      case "saldo":
        return { ...base, permiso: null, saldo: dinero(12.4) };
      case "app":
        return { ...base, medio: "app", permiso: null, saldo: saldoDeAntes, ordenDelPaquete: ordenDelPaquete(p, ahora) };
    }
  }

  /** Una compra con su orden de carga ya creada, en la etapa que se pide. */
  private conCarga(
    s: LoQueSeSabe,
    etapa: number | "fallida",
    o: { creada: number; vence: number; pagada?: number; marcas?: Partial<MarcasDeOrden>; vista?: VistaDeOrden },
  ): LoQueSeSabe {
    this.carga = { id: `ord_demo_${(++this.nueva).toString(36)}${o.creada.toString(36)}`, montos: this.montos, creada: o.creada, vence: o.vence, imagen: { mediaType: "image/png", encoding: "base64", data: PUNTO }, pagada: o.pagada ?? o.creada };
    this.etapa = etapa === "fallida" ? 0 : etapa;
    return {
      ...s,
      permiso: s.permiso ? { ...s.permiso, cargada: true } : s.permiso,
      carga: { orden: ordenDe(this.carga, etapa), marcas: { ...SIN_MARCAS, ...(o.marcas ?? {}) }, vista: { ...(o.vista ?? {}) } },
    };
  }

  /** La orden en la etapa de ahora, con las marcas y lo que la ventana ya sabe. */
  private enEtapa(s: LoQueSeSabe, etapa: number, extra: Partial<LoQueSeSabe> = {}): LoQueSeSabe {
    if (!this.carga || !s.carga) return s;
    this.etapa = etapa;
    const revisado = REVISADO[etapa];
    return {
      ...s,
      carga: { ...s.carga, orden: ordenDe(this.carga, etapa), vista: { ...(s.carga.vista ?? {}), sinCreditos: false } },
      aprobacion: revisado ? { revisado: { que: revisado.que, dolares: revisado.dolares(this.montos) } } : {},
      ...extra,
    };
  }

  async mirar(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    const p = pantallaDeCompra(s);
    switch (p.id) {
      case "espera":
        await pausa(PAUSA_MS);
        return this.despuesDeLaEspera(s);
      case "espera-pago": {
        const dijo = s.carga?.marcas.dijoPago ?? null;
        const ahora = this.reloj();
        if (!this.pagaDeVerdad || dijo === null || ahora - dijo < BANCO_MS || !this.carga) return s;
        this.carga.pagada = ahora;
        return this.enEtapa(s, 1);
      }
      case "camino":
        return this.etapa === 9 ? this.llego(s) : this.enEtapa(s, this.etapa + 1);
      case "pagando":
        return this.pagado(s);
      case "frenada":
        // Tinkazo cargó lo que faltaba: la compra sigue donde estaba.
        return this.enEtapa(s, 2);
      default:
        return s;
    }
  }

  private despuesDeLaEspera(s: LoQueSeSabe): LoQueSeSabe {
    if (s.saldo === null) {
      const saldo = dinero(this.producto === ALTA ? 0 : 0.25);
      return { ...s, saldo, leyendo: false, cotizacion: this.producto === ALTA ? verificacion("KYC", 1) : { estado: "precio", precio: precio(this.montos, s.ahora) } };
    }
    const siguiente: Record<number, LecturaDeCotizacion> = {
      1: verificacion("FORM", 2),
      2: verificacion("REGISTRY_CHECK", 3),
      3: verificacion("PROVIDER_REGISTRATION", 4),
      4: { estado: "falta", falta: [{ que: "linea", emisor: CIRCLE }, { que: "cuenta-de-paso", red: "POLYGON" }] },
      5: { estado: "precio", precio: precio(this.montos, s.ahora) },
    };
    return { ...s, leyendo: false, verificacion: {}, cotizacion: siguiente[this.pasoDeVerificacion] ?? s.cotizacion };
  }

  private llego(s: LoQueSeSabe): LoQueSeSabe {
    const saldo = Number(s.saldo ?? "0") + this.montos.llega;
    return this.enEtapa(s, 10, { saldo: dinero(saldo) });
  }

  private pagado(s: LoQueSeSabe): LoQueSeSabe {
    const total = s.permiso?.cargada && s.permiso.total ? Number(s.permiso.total) : Number(this.producto.usdc);
    const queda = s.saldo === null ? null : Number(s.saldo) - total;
    return { ...s, pago: { fase: "listo", quedan: this.producto.sorteos, saldo: queda === null || queda < 0.005 ? null : dinero(queda) }, saldo: queda === null ? s.saldo : dinero(Math.max(0, queda)) };
  }

  private async qrNuevo(s: LoQueSeSabe): Promise<LoQueSeSabe> {
    await pausa(PAUSA_MS);
    const ahora = s.ahora;
    const nueva = this.conCarga(s, 0, { creada: ahora, vence: ahora + 15 * MIN });
    if (this.carga) this.carga.imagen = await imagenDeMentira();
    return { ...nueva, carga: nueva.carga ? { ...nueva.carga, orden: this.carga ? ordenDe(this.carga, 0) : nueva.carga.orden } : null, precioVencio: false, todaviaNo: false, aprobacion: {} };
  }

  async hacer(accion: AccionDeCompra, s: LoQueSeSabe, o: AvisoDelMotor): Promise<LoQueSeSabe> {
    switch (accion) {
      case "mirar":
        // Con el QR vencido, la ventana mira sola y nada cambia. Al tocar Volver a mirar, la orden vieja se cierra sin
        // pago: recién ahí se puede pedir otro QR.
        if (pantallaDeCompra(s).id === "qr-vencido-abierta") return this.carga && s.carga ? { ...s, carga: { ...s.carga, orden: ordenDe(this.carga, "fallida") } } : s;
        return this.mirar(s);
      case "empezar-verificacion":
        return { ...s, verificacion: { ...s.verificacion, empezo: true } };
      case "abrir-verificacion":
        return { ...s, cotizacion: verificacion("KYC", 1, "en-curso") };
      case "ya-termine":
        this.pasoDeVerificacion = 1;
        return { ...s, leyendo: true };
      case "verificacion-otra-vez":
        return { ...s, cotizacion: verificacion("KYC", 1), verificacion: { empezo: true } };
      case "guardar-datos":
      case "confirmar-segip":
      case "darme-de-alta":
      case "preparar":
        await pausa(accion === "preparar" ? 2 * PAUSA_MS : PAUSA_MS);
        this.pasoDeVerificacion = { "guardar-datos": 2, "confirmar-segip": 3, "darme-de-alta": 4, preparar: 5 }[accion];
        return { ...s, leyendo: true };
      case "ver-qr":
        return this.qrNuevo(s);
      case "pedir-qr-nuevo":
        this.pagaDeVerdad = true;
        return this.qrNuevo(s);
      case "todavia-no":
        // Después de Todavía no pagué, el próximo Ya pagué es de verdad.
        this.pagaDeVerdad = true;
        return s;
      case "ver-primer-paso":
        return this.enEtapa(s, this.etapa);
      case "aprobar": {
        o.avisar({ ...s, aprobacion: { ...(s.aprobacion ?? {}), enCurso: true } });
        await pausa(PAUSA_MS);
        return this.enEtapa(s, this.etapa + 1);
      }
      case "pagar-paquete":
        return { ...s, pago: { fase: "pagando" } };
      case "mirar-pago":
        return this.pagado(s);
      case "otra-app":
        return { ...s, medio: "app", ordenDelPaquete: ordenDelPaquete(this.producto, s.ahora) };
      case "estoy-en-bolivia":
        return { ...s, medio: "qr", ordenDelPaquete: null };
      case "ya-pague-app":
        o.avisar(s, "pagoBuscando");
        await pausa(2 * PAUSA_MS);
        return { ...s, pago: { fase: "listo", quedan: this.producto.sorteos, saldo: null } };
      case "reintentar":
        return { ...s, sinRed: false };
      default:
        return s;
    }
  }

  detalle(_s: LoQueSeSabe, p: PantallaDeCompra): DetalleDePantalla | null {
    const es = getLang() !== "en";
    const NOMBRE = es ? "Nombre" : "Name";
    const CARNET = es ? "Carnet" : "ID card";
    const NACIMIENTO = es ? "Fecha de nacimiento" : "Date of birth";
    const CELULAR = es ? "Celular" : "Mobile";
    switch (p.id) {
      case "datos":
        return {
          campos: [
            { clave: "documento", rotulo: es ? "Número de carnet" : "ID card number", tipo: "text", valor: "4567890", obligatorio: true },
            {
              clave: "expedido",
              rotulo: es ? "Expedido en" : "Issued in",
              tipo: "select",
              opciones: [
                { valor: "LP", rotulo: "La Paz" },
                { valor: "CB", rotulo: "Cochabamba" },
                { valor: "SC", rotulo: "Santa Cruz" },
                { valor: "TJ", rotulo: "Tarija" },
              ],
              valor: "SC",
              obligatorio: true,
            },
            { clave: "nacimiento", rotulo: NACIMIENTO, tipo: "text", valor: "14/03/1994", obligatorio: true },
            { clave: "celular", rotulo: CELULAR, tipo: "tel", valor: "70012345", obligatorio: true },
          ],
        };
      case "segip":
        return {
          lista: [
            { rotulo: NOMBRE, valor: "ANA" },
            { rotulo: es ? "Apellidos" : "Surnames", valor: "PAZ ROCA" },
            { rotulo: CARNET, valor: "4567890 SC" },
            { rotulo: NACIMIENTO, valor: "14/03/1994" },
          ],
          campos: [
            {
              clave: "apellidos",
              rotulo: t("cargaSegipApellidos"),
              tipo: "select",
              opciones: [
                { valor: "dos", rotulo: es ? "Paterno PAZ, materno ROCA" : "Father's PAZ, mother's ROCA" },
                { valor: "uno", rotulo: es ? "Uno solo: PAZ ROCA" : "Just one: PAZ ROCA" },
              ],
              valor: "dos",
              obligatorio: true,
            },
            { clave: "complemento", rotulo: t("cargaSegipComplemento"), tipo: "text", valor: "" },
          ],
        };
      case "alta":
        return {
          lista: [
            { rotulo: NOMBRE, valor: "Ana Paz Roca" },
            { rotulo: CARNET, valor: "4567890 SC" },
            { rotulo: NACIMIENTO, valor: "14/03/1994" },
            { rotulo: CELULAR, valor: "70012345" },
          ],
        };
      default:
        return null;
    }
  }
}

/**
 * La ventana de hoy de Sumar sorteos, pagando con dólares digitales, con la orden de mentira: el panel con la moneda, el
 * monto, la nota, la cuenta corta y Estoy en Bolivia. Ya pagué la da por pagada.
 */
function sumarDeMentira(reloj: () => number): CompraDePaquetes {
  return {
    oferta: async () => ({ alta: null, paquetes: [P10] }),
    orden: async () => ({ ok: true, datos: ordenDelPaquete(P10, reloj()) }),
    pago: async () => ({ ok: true, datos: { pagada: true, sorteos: { quedan: P10.sorteos, proximoVence: null }, sigue: "lista" } }),
    refrescarCupo: () => undefined,
  };
}

/* ================================================================== la lista de compras de mentira */

let abierta: VentanaDeCompra | null = null;

export interface OpcionesDeLaDemo {
  /** El entorno del build (en las pruebas, a mano). */
  entorno?: EntornoDeCuenta;
  confiar?(e: Event): boolean;
  reloj?(): number;
}

/**
 * Pone la lista de compras de mentira, solo en la máquina de quien prueba y con `VITE_RAMPA_DEMO=1`. Devuelve si la puso
 * (o ya estaba). Nada se abre hasta que se toca una compra.
 */
export function montarDemoDeCompra(o: OpcionesDeLaDemo = {}): boolean {
  if (!demoDeRampa(o.entorno ?? entornoDeCuenta())) return false;
  if (document.querySelector(".cq-demo")) return true;
  const panel = document.createElement("aside");
  panel.className = "cq-demo";
  panel.setAttribute("aria-label", tx(TEXTOS.titulo));
  const titulo = document.createElement("h2");
  titulo.textContent = tx(TEXTOS.titulo);
  const linea = document.createElement("p");
  linea.textContent = tx(TEXTOS.linea);
  const lista = document.createElement("ul");
  const nota = document.createElement("p");
  nota.className = "cq-demo-nota";
  nota.setAttribute("role", "status");
  for (const e of ESCENARIOS) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.escenario = e;
    b.textContent = tx(NOMBRES[e]);
    b.addEventListener("click", () => {
      nota.textContent = "";
      abierta?.cerrar();
      const reloj = o.reloj ?? (() => Date.now());
      abierta = abrirCompra({
        motor: new CompraDeMentira(e, reloj),
        permitida: true,
        // Las marcas de las órdenes de mentira viven en memoria: no ocupan el lugar de las de una compra de verdad.
        almacen: null,
        reloj,
        ...(o.confiar ? { confiar: o.confiar } : {}),
        afuera: (accion) => {
          nota.textContent = `${tx(TEXTOS.afuera)} ${t(BOTON_DE_AFUERA[accion])}.`;
        },
        alCerrar: () => {
          abierta = null;
        },
      });
    });
    li.append(b);
    lista.append(li);
  }
  // Sumar sorteos, la ventana de hoy pagando con dólares digitales: Estoy en Bolivia no recuerda nada en la demo.
  const li = document.createElement("li");
  const sumar = document.createElement("button");
  sumar.type = "button";
  sumar.dataset.ventana = "sumar";
  sumar.textContent = tx(TEXTOS.sumar);
  sumar.addEventListener("click", () => {
    nota.textContent = "";
    abierta?.cerrar();
    abierta = null;
    void abrirSumarSorteos(sumarDeMentira(o.reloj ?? (() => Date.now())), {
      correo: "a•••@example.org",
      almacenDelMedio: null,
      alQr: () => {
        nota.textContent = `${tx(TEXTOS.afuera)} ${t("compraEstoy")}.`;
      },
    });
  });
  li.append(sumar);
  lista.append(li);
  panel.append(titulo, linea, lista, nota);
  document.body.append(panel);
  return true;
}
