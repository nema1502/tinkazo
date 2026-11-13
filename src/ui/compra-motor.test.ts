import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorDeCompra, EstadoDeAlta, OrdenDePago, PagoDeOrden, PermisoDelServidor } from "../stellar/alta-api";
import type { ProductoALaVenta } from "../stellar/alta-oferta";
import type { ResultadoDelPagoConSaldo } from "../stellar/pago-con-saldo";
import { USDC_MAINNET } from "../stellar/pagos";
import type { PrecioDeCarga, RutaDeBolivia } from "../stellar/rampa-pollar";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import type { AvisoDeLaCompra } from "../stellar/wallet-pollar";
import { type BilleteraDeLaCompra, CompraDeVerdad, type OpcionesDelMotor, type PorteroDeLaCompra } from "./compra-motor";
import { type LoQueSeSabe, pantallaDeCompra } from "./compra-qr-estado";
import type { AvisoDelMotor } from "./compra-qr";

/**
 * El motor de verdad de Tu compra (`compra-motor.ts`) con la billetera y el portero de mentira: sin red, sin Pollar y
 * sin el servidor. Lo primero es la compra que tiene que salir bien de punta a punta (pedir el permiso, cotizar, ver el
 * QR, pagar, que llegue y pagar el paquete con lo que llegó). Después, lo que nunca puede pasar: dos envíos por el mismo
 * pago, un pago que quizás salió repetido, una aprobación o un pago sin su toque.
 */

/* ------------------------------------------------------------------ la carga, como la da el proveedor */

const CIRCLE = USDC_MAINNET.issuer;
const CUENTA = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const COBROS = "GDMIGGM2J7GL24JL3UB5DLSTMMWFP5XTE3SDTTDZSPUFH7VMKFINKAO6";
const AHORA = Date.parse("2026-11-13T12:00:00.000Z");
const ISO = (ms: number) => new Date(ms).toISOString();
const BOB_QR = { kind: "fiat", currency: "BOB", rail: "QR", country: "BO" };
const USDC_STELLAR = { kind: "asset", code: "USDC", identifier: CIRCLE, chain: "STELLAR" };
const USDT_POLYGON = { kind: "asset", code: "USDT0", identifier: "0x00000000000000000000000000000000000000aa", chain: "POLYGON" };
const USDC_POLYGON = { kind: "asset", code: "USDC", identifier: "0x00000000000000000000000000000000000000bb", chain: "POLYGON" };
const EN_PASO = { chain: "POLYGON", address: "0x00000000000000000000000000000000000000cc", asset: "USDT0", amount: "0" };
const IMAGEN = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

type Obj = Record<string, unknown>;
const paso = (kind: string, status = "pending"): Obj => ({ kind, status, signs: kind === "approve" || kind === "swap" || kind === "burn", hash: null });
const tramo = (x: Obj): Obj => ({ status: "PENDING", amountInPlanned: "0", amountOutPlanned: "0", amountInActual: null, amountOutActual: null, onchainTxHash: null, signingMode: null, fundsLocation: null, failure: null, steps: [], etaSeconds: null, startedAt: null, ...x });

/**
 * La orden de carga en cada etapa: 0 espera el pago del QR, 1 Stereum vio el pago, 2 espera la confirmación del permiso
 * del cambio, 3 la del cambio, 4 la del permiso del envío, 5 la del envío, 6 viaja y 7 llegó. `fallida`: nació fallada.
 */
function ordenEn(id: string, etapa: number | "fallida", bs = 134, llega = "10.6"): Obj {
  const n = etapa === "fallida" ? -1 : etapa;
  const qr = { kind: "FIAT_PAYMENT", actionId: "act-pago", legIndex: 0, expiresAt: ISO(AHORA + 15 * 60_000), instructions: { kind: "qr", amount: `${bs}.00`, currency: "BOB", scannable: { kind: "opaque", image: { mediaType: "image/png", encoding: "base64", data: IMAGEN } }, link: null } };
  const stereum = n <= 0 ? { status: "AWAITING_ACTION", startedAt: ISO(AHORA) } : n === 1 ? { status: "ACTIVE", amountInActual: String(bs), startedAt: ISO(AHORA) } : { status: "COMPLETED", amountInActual: String(bs), amountOutActual: "10.66" };
  const cambio =
    n <= 1
      ? { steps: [paso("approve"), paso("swap")] }
      : n === 2
        ? { status: "AWAITING_ACTION", fundsLocation: EN_PASO, startedAt: ISO(AHORA), steps: [paso("approve", "awaiting_approval"), paso("swap")] }
        : n === 3
          ? { status: "AWAITING_ACTION", fundsLocation: EN_PASO, startedAt: ISO(AHORA), steps: [paso("approve", "done"), paso("swap", "awaiting_approval")] }
          : { status: "COMPLETED", amountOutActual: "10.63", steps: [paso("approve", "done"), paso("swap", "done")] };
  const envio =
    n <= 3
      ? { steps: [paso("approve"), paso("burn"), paso("attestation"), paso("mint")] }
      : n === 4
        ? { status: "AWAITING_ACTION", fundsLocation: { ...EN_PASO, asset: "USDC" }, startedAt: ISO(AHORA), steps: [paso("approve", "awaiting_approval"), paso("burn"), paso("attestation"), paso("mint")] }
        : n === 5
          ? { status: "AWAITING_ACTION", fundsLocation: { ...EN_PASO, asset: "USDC" }, startedAt: ISO(AHORA), steps: [paso("approve", "done"), paso("burn", "awaiting_approval"), paso("attestation"), paso("mint")] }
          : n === 6
            ? { status: "ACTIVE", startedAt: ISO(AHORA), steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "confirming"), paso("mint")] }
            : { status: "COMPLETED", amountOutActual: llega, steps: [paso("approve", "done"), paso("burn", "done"), paso("attestation", "done"), paso("mint", "done")] };
  const aprobar = (legIndex: number, k: number): Obj => ({ kind: "COSIGN_APPROVAL", actionId: `act-${k}`, legIndex, cosignRequestId: `cos-${k}`, summary: "Approve" });
  const accion = n <= 0 ? qr : n >= 2 && n <= 5 ? aprobar(n <= 3 ? 1 : 2, n - 1) : n === 7 ? null : { kind: "NONE", actionId: "act-nada", legIndex: 0 };
  const estado = etapa === "fallida" ? "failed" : n <= 0 ? "awaiting_payment" : n === 7 ? "completed" : n === 6 ? "settling_onchain" : "processing";
  return {
    id,
    direction: "ONRAMP",
    state: estado,
    createdAt: ISO(AHORA),
    legs: [
      tramo({ index: 0, kind: "PROVIDER_ONRAMP", from: BOB_QR, to: USDT_POLYGON, amountInPlanned: String(bs), amountOutPlanned: "10.66", etaSeconds: 300, ...stereum }),
      tramo({ index: 1, kind: "SWAP", from: USDT_POLYGON, to: USDC_POLYGON, amountInPlanned: "10.66", amountOutPlanned: "10.63", signingMode: "COSIGNED", etaSeconds: 60, ...cambio }),
      tramo({ index: 2, kind: "BRIDGE", from: USDC_POLYGON, to: USDC_STELLAR, amountInPlanned: "10.63", amountOutPlanned: llega, signingMode: "COSIGNED", etaSeconds: 600, ...envio }),
    ],
    pendingAction: etapa === "fallida" ? null : accion,
    failure: null,
    nextPollAfter: etapa === "fallida" || n === 7 ? null : ISO(AHORA + 10_000),
  };
}

const RUTA: RutaDeBolivia = { fiat: { currency: "BOB", rail: "QR", country: "BO" }, asset: { code: "USDC", identifier: CIRCLE, chain: "STELLAR" }, emisor: CIRCLE };
/** El cambio de la cotización de mentira: 12,6 bolivianos por dólar, todo incluido. */
const precioPor = (bs: number): PrecioDeCarga => ({ quoteId: `q-${bs}`, vence: ISO(AHORA + 10 * 60_000), pagas: bs, recibis: Math.floor((bs / 12.6) * 100) / 100, tasa: 12.6, minutos: 16, aprobaciones: 4, campos: [] });

/* ------------------------------------------------------------------ el portero y la billetera de mentira */

const P10: ProductoALaVenta = { id: "p10", usdc: "10", sorteos: 10, dias: 365 };
const ALTA: ProductoALaVenta = { id: "alta", usdc: "4", sorteos: 3, dias: 90 };
const PERMISO_P10: PermisoDelServidor = { producto: "p10", desde: AHORA - 1_000, recargo: "0.5", total: "10.5", primera: false, cargada: false };
const ID_DEL_PAQUETE = "ABCD2345";
const ORDEN_DEL_PAQUETE: OrdenDePago = {
  id: ID_DEL_PAQUETE,
  producto: "p10",
  usdc: "10.5",
  sorteos: 10,
  destino: COBROS,
  nota: `tk:o:${ID_DEL_PAQUETE}`,
  memoId: "1",
  enlace: "web+stellar:pay?destination=x",
  vence: AHORA + 3 * 24 * 3_600_000,
  precio: "10",
  recargo: "0.5",
};
const ESTADO: EstadoDeAlta = {
  acceso: "pago",
  cuenta: CUENTA,
  abierta: true,
  pedido: null,
  sorteos: { quedan: 0, proximoVence: null },
  orden: null,
  fondeo: "inmediato",
  compraQr: { puede: true, motivo: null, abierta: null, terminar: false, minimoBs: 0, recargoPendiente: null },
};

interface Mundo {
  /** La orden de carga de la persona y en qué etapa está. */
  carga: { id: string; etapa: number | "fallida" } | null;
  /** Lo que tiene la cuenta, en dólares (texto del servidor). */
  saldo: string;
  permiso: PermisoDelServidor | null;
  /** Lo que el servidor recibió de la orden del paquete, y si la dio por pagada. */
  recibido: string;
  pagada: boolean;
  marca: number | null;
  llamadas: string[];
  pagos: Array<{ destino: string; monto: string; nota: string }>;
  registro: string[];
}

function mundoNuevo(): Mundo {
  return { carga: null, saldo: "0.2500000", permiso: null, recibido: "0", pagada: false, marca: null, llamadas: [], pagos: [], registro: [] };
}

const ok = <T>(datos: T) => ({ ok: true as const, datos });
const no = (estado: number, motivo: string, extra: Partial<Pick<ErrorDeCompra, "permiso" | "orden" | "reintentarEn" | "clave">> = {}): ErrorDeCompra => ({ ok: false, clave: "altaErrServicio", vars: {}, motivo, estado, ...extra });

function portero(m: Mundo, cambios: Partial<PorteroDeLaCompra> = {}): PorteroDeLaCompra {
  return {
    async estado() {
      m.llamadas.push("estado");
      return ok(ESTADO);
    },
    async empezar(producto) {
      m.llamadas.push(`empezar:${producto}`);
      m.permiso ??= { ...PERMISO_P10, producto };
      return ok(m.permiso);
    },
    async cargar(producto, reemplazar) {
      m.llamadas.push(`cargar:${producto}${reemplazar ? ":reemplazar" : ""}`);
      if (!m.permiso) return no(404, "sin-permiso");
      m.permiso = { ...m.permiso, cargada: true };
      return ok(m.permiso);
    },
    async anular(producto) {
      m.llamadas.push(`anular:${producto}`);
      return ok({ anulada: true as const, repetido: false });
    },
    async orden(producto) {
      m.llamadas.push(`orden:${producto}`);
      return ok(ORDEN_DEL_PAQUETE);
    },
    async pago(id) {
      m.llamadas.push(`pago:${id}`);
      const r: PagoDeOrden = m.pagada ? { pagada: true, sorteos: { quedan: 10, proximoVence: null }, sigue: "lista" } : { pagada: false, recibido: m.recibido, total: "10.5", minimo: "9.975" };
      return ok(r);
    },
    ...cambios,
  };
}

function billetera(m: Mundo, cambios: Partial<BilleteraDeLaCompra> = {}): BilleteraDeLaCompra {
  const b = {
    async cargaAbiertas() {
      m.llamadas.push("cargaAbiertas");
      const c = m.carga;
      return c && c.etapa !== "fallida" && c.etapa < 7 ? { estado: "abierta" as const, id: c.id, orden: ordenEn(c.id, c.etapa) } : { estado: "ninguna" as const };
    },
    async cargaCerradas() {
      m.llamadas.push("cargaCerradas");
      return { estado: "ninguna" as const };
    },
    async cargaRuta() {
      m.llamadas.push("cargaRuta");
      return { estado: "ruta" as const, ruta: RUTA };
    },
    async cargaCotizar(_ruta: RutaDeBolivia, bs: number) {
      m.llamadas.push(`cargaCotizar:${bs}`);
      return { estado: "precio" as const, precio: precioPor(bs) };
    },
    async cargaCrearOrdenDeCompra(_precio: PrecioDeCarga, _datos: Readonly<Record<string, string>>, aviso: AvisoDeLaCompra) {
      m.llamadas.push("cargaCrearOrdenDeCompra");
      if ((await aviso.avisar()) !== true) return { estado: "sin-aviso" as const };
      m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 0 };
      return { estado: "creada" as const, id: m.carga.id, orden: ordenEn(m.carga.id, 0), falloAlCrear: false };
    },
    async cargaLeerOrden(id: string) {
      m.llamadas.push("cargaLeerOrden");
      return m.carga && m.carga.id === id ? { estado: "orden" as const, orden: ordenEn(id, m.carga.etapa) } : { estado: "no-existe" as const };
    },
    async cargaYaPague(id: string) {
      m.llamadas.push("cargaYaPague");
      return m.carga && m.carga.id === id ? { estado: "orden" as const, orden: ordenEn(id, m.carga.etapa) } : { estado: "no-existe" as const };
    },
    async cargaRevisarPaso(_orden: string, pedido: string) {
      m.llamadas.push(`cargaRevisarPaso:${pedido}`);
      const que = (["permiso-cambio", "cambio", "permiso-envio", "envio"] as const)[Number(pedido.slice(4)) - 1] ?? "envio";
      return { estado: "revisado" as const, que, dolares: 10.66 };
    },
    async cargaAprobar(_orden: string, pedido: string) {
      m.llamadas.push(`cargaAprobar:${pedido}`);
      if (m.carga && typeof m.carga.etapa === "number") m.carga = { ...m.carga, etapa: m.carga.etapa + 1 };
      return { estado: "aprobado" as const, que: "cambio" as const, dolares: 10.66 };
    },
    async cargaReintentar() {
      m.llamadas.push("cargaReintentar");
      return { estado: "no-existe" as const };
    },
    async pagarOrden(p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> {
      m.llamadas.push("pagarOrden");
      m.pagos.push(p);
      m.pagada = true;
      return { estado: "salio", hash: "ab".repeat(32) };
    },
    cargaAbrirVerificacion: vi.fn(async () => ({ estado: "abrir" as const, url: "https://verificacion.example/abc" })),
    cargaMirarVerificacion: vi.fn(async () => ({ estado: "leida" as const, verificacion: "aprobada" as const })),
    cargaLeerFormulario: vi.fn(async () => ({ estado: "desconocido" as const })),
    cargaGuardarFormulario: vi.fn(async () => ({ estado: "guardado" as const })),
    cargaLeerSegip: vi.fn(async () => ({ estado: "aprobada" as const })),
    cargaConfirmarSegip: vi.fn(async () => ({ estado: "aprobada" as const })),
    cargaLeerAlta: vi.fn(async () => ({ estado: "registrada" as const })),
    cargaDarDeAlta: vi.fn(async () => ({ estado: "registrada" as const })),
    cargaPreparar: vi.fn(async () => ({ estado: "listo" as const })),
  };
  return { ...b, ...cambios } as unknown as BilleteraDeLaCompra;
}

function motor(m: Mundo, o: { portero?: Partial<PorteroDeLaCompra>; billetera?: Partial<BilleteraDeLaCompra>; opciones?: Partial<OpcionesDelMotor> } = {}): CompraDeVerdad {
  return new CompraDeVerdad({
    billetera: billetera(m, o.billetera),
    portero: portero(m, o.portero),
    async saldo(): Promise<SaldoDeDolares> {
      m.llamadas.push("saldo");
      return { tipo: "saldo", saldo: m.saldo };
    },
    cuenta: () => CUENTA,
    producto: P10,
    otros: [ALTA, P10],
    reloj: () => AHORA,
    almacen: null,
    marcaDelPago: () => m.marca,
    esperar: async () => undefined,
    candado: (f) => f(),
    registrar: (evento, datos) => m.registro.push(`${evento} ${JSON.stringify(datos ?? {})}`),
    ...o.opciones,
  });
}

const aviso = (entrada?: Record<string, string>): AvisoDelMotor => ({ avisar: () => undefined, ...(entrada ? { entrada } : {}) });

/** Un almacén del navegador en memoria, para lo que el motor recuerda entre ventanas. */
function enMemoria(): Pick<Storage, "getItem" | "setItem"> {
  const d = new Map<string, string>();
  return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => void d.set(k, String(v)) };
}
const id = (s: LoQueSeSabe) => pantallaDeCompra({ ...s, ahora: AHORA }).id;
const SOLAS = new Set(["espera", "carnet-espera", "espera-pago", "camino", "pagando", "desconocido", "qr-vencido-abierta"]);

/** Lo que haría la ventana mientras la pantalla espera algo de afuera: mirar, hasta que cambie o tope. */
async function mirarHastaQueCambie(mo: CompraDeVerdad, s: LoQueSeSabe, tope = 8): Promise<LoQueSeSabe> {
  let x = s;
  for (let i = 0; i < tope && SOLAS.has(id(x)); i++) x = await mo.mirar(x);
  return x;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ una compra entera */

describe("una compra de punta a punta: diez sorteos con el QR del banco", () => {
  it("pide el permiso, cotiza, muestra el QR, confirma, llega y paga el paquete una sola vez con lo que llegó", async () => {
    const m = mundoNuevo();
    const mo = motor(m);
    let s = mo.inicio();
    expect(id(s)).toBe("espera");
    // Al abrir: la carga abierta primero, la cerrada, el estado, el saldo, el permiso y la cotización.
    s = await mirarHastaQueCambie(mo, s);
    expect(id(s)).toBe("precio");
    expect(m.llamadas.slice(0, 5)).toEqual(["cargaAbiertas", "cargaCerradas", "estado", "saldo", "empezar:p10"]);
    expect(s.permiso).toMatchObject({ producto: "p10", total: "10.5", cargada: false });
    // Falta 10,25 (10,50 menos el saldo de 0,25), más el margen: la cotización llega a eso y no menos.
    const c = s.cotizacion;
    expect(c?.estado).toBe("precio");
    const precio = c?.estado === "precio" ? c.precio : null;
    expect(precio && Math.round(precio.recibis * 100)).toBeGreaterThanOrEqual(1025 + 31);
    expect(m.llamadas.filter((x) => x.startsWith("cargaCotizar")).length).toBeLessThanOrEqual(3);
    // Nada se creó ni se pagó solo.
    expect(m.llamadas).not.toContain("cargaCrearOrdenDeCompra");
    expect(m.llamadas.some((x) => x.startsWith("cargar"))).toBe(false);

    // Ver el QR: el aviso y la orden de carga.
    s = await mo.hacer("ver-qr", s, aviso());
    expect(id(s)).toBe("qr");
    expect(m.llamadas.filter((x) => x.startsWith("cargar"))).toEqual(["cargar:p10"]);
    expect(s.permiso?.cargada).toBe(true);
    expect(pantallaDeCompra({ ...s, ahora: AHORA }).qr?.bs).toBe(`${precio?.pagas}.00`);

    // Ya pagué: la ventana anota la marca, el motor pregunta. El banco tarda: espera el pago.
    s = { ...s, carga: s.carga ? { ...s.carga, marcas: { ...s.carga.marcas, dijoPago: AHORA } } : null };
    s = await mo.hacer("ya-pague", s, aviso());
    expect(id(s)).toBe("espera-pago");
    // Stereum vio el pago: en camino, hasta la primera confirmación.
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 1 };
    s = await mirarHastaQueCambie(mo, s);
    expect(id(s)).toBe("camino");
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 2 };
    s = await mo.mirar(s);
    expect(id(s)).toBe("antes");
    s = await mo.hacer("ver-primer-paso", { ...s, carga: s.carga ? { ...s.carga, vista: { ...s.carga.vista, vioAntesDeAprobar: true } } : null }, aviso());
    // Cada confirmación sale de su toque, con lo que la regla dijo antes de mostrarla.
    for (const pedido of ["cos-1", "cos-2", "cos-3", "cos-4"]) {
      expect(id(s), pedido).toBe("aprobar");
      expect(s.aprobacion?.revisado).toMatchObject({ dolares: 10.66 });
      const antes = m.llamadas.filter((x) => x.startsWith("cargaAprobar")).length;
      s = await mo.hacer("aprobar", s, aviso());
      expect(m.llamadas.filter((x) => x.startsWith("cargaAprobar")).length, pedido).toBe(antes + 1);
      expect(m.llamadas).toContain(`cargaRevisarPaso:${pedido}`);
    }
    expect(m.llamadas.filter((x) => x.startsWith("cargaAprobar"))).toEqual(["cargaAprobar:cos-1", "cargaAprobar:cos-2", "cargaAprobar:cos-3", "cargaAprobar:cos-4"]);
    // Viaja y llega: el saldo de ahora.
    s = await mirarHastaQueCambie(mo, s);
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 7 };
    m.saldo = "10.8500000";
    s = await mirarHastaQueCambie(mo, { ...s, carga: s.carga ? { ...s.carga, orden: ordenEn("ord_9f8e7d6c5b4a3210", 6) } : null });
    expect(id(s)).toBe("llego");
    const p = pantallaDeCompra({ ...s, ahora: AHORA });
    expect(p.pagar).toBe("10.5");
    expect(m.llamadas).not.toContain("pagarOrden");

    // Terminar mi compra: la orden del paquete, su pago, y un solo envío por el total con el recargo.
    s = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(s)).toBe("listo");
    expect(m.pagos).toEqual([{ destino: COBROS, monto: "10.5", nota: `tk:o:${ID_DEL_PAQUETE}` }]);
    expect(s.pago).toMatchObject({ fase: "listo", quedan: 10 });
    // Antes de pagar se preguntó cómo está la orden.
    const i = m.llamadas.indexOf("pagarOrden");
    expect(m.llamadas.slice(0, i)).toContain(`pago:${ID_DEL_PAQUETE}`);
    // Nada de la cuenta de la persona en el registro.
    for (const r of m.registro) expect(r).not.toMatch(/G[A-Z2-7]{55}/);
  });

  it("el saldo que alcanza paga el paquete sin QR y sin recargo, con un toque", async () => {
    const m = mundoNuevo();
    m.saldo = "12.0000000";
    const mo = motor(m, { portero: { orden: async () => ok({ ...ORDEN_DEL_PAQUETE, usdc: "10", precio: undefined, recargo: undefined } as OrdenDePago), pago: async () => ok(m.pagada ? { pagada: true, sorteos: { quedan: 10, proximoVence: null }, sigue: "lista" as const } : { pagada: false, recibido: "0", total: "10", minimo: "9.5" }) } });
    let s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("saldo");
    expect(m.llamadas.some((x) => x.startsWith("cargaCotizar"))).toBe(false);
    s = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(s)).toBe("listo");
    expect(m.pagos).toEqual([{ destino: COBROS, monto: "10", nota: `tk:o:${ID_DEL_PAQUETE}` }]);
  });

  it("si al terminar el servidor dice que la cuenta quedó fuera del piloto, ese paquete no se vende: ni Sin conexión ni otro pago", async () => {
    const m = mundoNuevo();
    m.saldo = "12.0000000";
    let alTerminar = false;
    const sinRecargo = { ...ORDEN_DEL_PAQUETE, usdc: "10", precio: undefined, recargo: undefined } as OrdenDePago;
    const mo = motor(m, {
      portero: {
        orden: async () => (alTerminar ? no(503, "fuera-del-piloto") : ok(sinRecargo)),
        pago: async () => ok({ pagada: false, recibido: "0", total: "10", minimo: "9.5" }),
      },
    });
    let s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("saldo");
    alTerminar = true;
    s = await mo.hacer("pagar-paquete", s, aviso());
    expect(s.pago).toMatchObject({ fase: "no-vende" });
    expect(s.sinRed).toBeFalsy();
    expect(m.pagos).toEqual([]);
  });

  it("al volver con la carga abierta la sigue donde quedó, sin pedir otro permiso ni otra orden", async () => {
    const m = mundoNuevo();
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 3 };
    m.permiso = { ...PERMISO_P10, cargada: true };
    const mo = motor(m, { portero: { estado: async () => ok({ ...ESTADO, compraQr: { ...(ESTADO.compraQr as NonNullable<EstadoDeAlta["compraQr"]>), abierta: { ...PERMISO_P10, cargada: true }, terminar: true } }) } });
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("aprobar");
    expect(s.aprobacion?.revisado).toBeTruthy();
    expect(m.llamadas.some((x) => x.startsWith("empezar"))).toBe(false);
    expect(m.llamadas).not.toContain("cargaCrearOrdenDeCompra");
    expect(m.llamadas).not.toContain("cargaAprobar:cos-2");
  });
});

/* ------------------------------------------------------------------ el aviso de carga */

describe("el aviso de carga arregla solo lo que se puede arreglar sin preguntar", () => {
  async function hastaElPrecio(m: Mundo, o: Parameters<typeof motor>[1] = {}) {
    const mo = motor(m, o);
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("precio");
    return { mo, s };
  }

  it("el permiso vencido se renueva con empezar y se avisa otra vez", async () => {
    const m = mundoNuevo();
    let primera = true;
    const { mo, s } = await hastaElPrecio(m, {
      portero: {
        async cargar(producto) {
          m.llamadas.push(`cargar:${producto}`);
          if (primera) {
            primera = false;
            return no(409, "permiso-vencido", { permiso: m.permiso ?? PERMISO_P10 });
          }
          m.permiso = { ...(m.permiso as PermisoDelServidor), cargada: true };
          return ok(m.permiso);
        },
      },
    });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(id(r)).toBe("qr");
    expect(m.llamadas.filter((x) => x.startsWith("cargar") || x.startsWith("empezar"))).toEqual(["empezar:p10", "cargar:p10", "empezar:p10", "cargar:p10"]);
  });

  /** Una orden de pagar desde otra app, viva y sin nada recibido: el aviso la devuelve hasta que la persona dice que no la pagó. */
  const VIVA = { id: "WXYZ6789", producto: "p10", usdc: "10", nota: "tk:o:WXYZ6789", vence: AHORA + 60 * 60_000, recibido: "0" };
  const cargarConOrdenViva = (m: Mundo) => async (producto: string, reemplazar?: boolean) => {
    m.llamadas.push(`cargar:${producto}${reemplazar ? ":reemplazar" : ""}`);
    if (!reemplazar) return no(409, "orden-abierta", { orden: VIVA });
    m.permiso = { ...(m.permiso as PermisoDelServidor), cargada: true };
    return ok(m.permiso);
  };

  it("con una orden de pagar desde otra app sin pagar, pregunta antes de reemplazarla: sin el toque de No pagué, nada se reemplaza", async () => {
    const m = mundoNuevo();
    const datos: Array<Readonly<Record<string, string>>> = [];
    const { mo, s } = await hastaElPrecio(m, {
      portero: { cargar: cargarConOrdenViva(m) },
      billetera: {
        async cargaCrearOrdenDeCompra(_precio, d, a) {
          m.llamadas.push("cargaCrearOrdenDeCompra");
          datos.push(d);
          if ((await a.avisar()) !== true) return { estado: "sin-aviso" };
          m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 0 };
          return { estado: "creada", id: m.carga.id, orden: ordenEn(m.carga.id, 0), falloAlCrear: false };
        },
      },
    });
    let r = await mo.hacer("ver-qr", s, aviso({ correo: "ana@example.org" }));
    expect(id(r)).toBe("otra-orden");
    expect(m.llamadas.filter((x) => x.startsWith("cargar"))).toEqual(["cargar:p10"]);
    expect(m.carga).toBeNull();
    // Mirar no cambia nada: la pregunta sigue hasta el toque.
    r = await mo.mirar(r);
    expect(id(r)).toBe("otra-orden");
    expect(m.llamadas).not.toContain("cargar:p10:reemplazar");
    // No pagué: recién ahí se reemplaza, con lo mismo que llevaba Ver el QR.
    r = await mo.hacer("no-pague-otra", r, aviso());
    expect(id(r)).toBe("qr");
    expect(m.llamadas.filter((x) => x.startsWith("cargar"))).toEqual(["cargar:p10", "cargar:p10:reemplazar"]);
    expect(datos).toEqual([{ correo: "ana@example.org" }, { correo: "ana@example.org" }]);
  });

  it("Ya pagué desde otra app lleva a esa orden para mirar su pago, sin crear el QR ni reemplazar nada", async () => {
    const m = mundoNuevo();
    const { mo, s } = await hastaElPrecio(m, { portero: { cargar: cargarConOrdenViva(m) } });
    let r = await mo.hacer("ver-qr", s, aviso());
    expect(id(r)).toBe("otra-orden");
    r = await mo.hacer("pague-otra", r, aviso());
    r = await mirarHastaQueCambie(mo, r);
    expect(id(r)).toBe("app");
    expect(r.ordenDelPaquete?.id).toBe(ID_DEL_PAQUETE);
    expect(m.llamadas).not.toContain("cargar:p10:reemplazar");
    expect(m.carga).toBeNull();
  });

  it("si la orden de antes recibió algo no se reemplaza ni se crea el QR: ayuda con el número", async () => {
    const m = mundoNuevo();
    const viva = { id: "WXYZ6789", producto: "p10", usdc: "10", nota: "tk:o:WXYZ6789", vence: AHORA + 1_000, recibido: "0" };
    const { mo, s } = await hastaElPrecio(m, {
      portero: {
        cargar: async (producto, reemplazar) => {
          m.llamadas.push(`cargar:${producto}${reemplazar ? ":reemplazar" : ""}`);
          return no(409, "orden-abierta", { orden: viva });
        },
        pago: async (x) => {
          m.llamadas.push(`pago:${x}`);
          return ok({ pagada: false, recibido: "3", total: "10", minimo: "9.5" } as PagoDeOrden);
        },
      },
    });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(m.llamadas).not.toContain("cargar:p10:reemplazar");
    expect(m.carga).toBeNull();
    expect(id(r)).toBe("pago-raro");
    expect(m.pagos).toEqual([]);
  });

  it("el tope del día o la compra cerrada: Ahora no hay pago con QR, sin crear nada", async () => {
    const m = mundoNuevo();
    const { mo, s } = await hastaElPrecio(m, { portero: { cargar: async () => no(503, "tope-del-dia") } });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(id(r)).toBe("sin-qr");
    expect(m.carga).toBeNull();
  });

  it("pidió varios QR para esta compra (el tope de avisos): la ayuda a mano, nunca Sin conexión", async () => {
    const m = mundoNuevo();
    const cargar = async (producto: string) => {
      m.llamadas.push(`cargar:${producto}`);
      return no(409, "tope-de-avisos", { permiso: { ...PERMISO_P10, cargada: true } });
    };
    const { mo, s } = await hastaElPrecio(m, { portero: { cargar } });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(r.sinRed).toBeFalsy();
    const p = pantallaDeCompra({ ...r, ahora: AHORA });
    expect(p.id).toBe("sin-qr");
    expect(p.linea?.clave).toBe("compraTopeDeQr");
    expect(p.principal.accion).toBe("escribir");
    expect(p.enlace?.accion).toBe("mirar");
    expect(m.carga).toBeNull();
    // Volver a mirar no avisa otra vez solo: lee y vuelve al precio, que pide su toque.
    const otra = await mo.hacer("mirar", r, aviso());
    expect(m.llamadas.filter((x) => x.startsWith("cargar"))).toEqual(["cargar:p10"]);
    expect(id(otra)).toBe("precio");
  });

  it("las rutas del servidor apagadas: Ahora no hay pago con QR, nunca Sin conexión", async () => {
    const m = mundoNuevo();
    const { mo, s } = await hastaElPrecio(m, { portero: { cargar: async () => no(503, "apagado") } });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(r.sinRed).toBeFalsy();
    expect(id(r)).toBe("sin-qr");
  });

  it("otro aviso en curso: espera hasta cuando dice el servidor y avisa una vez más", async () => {
    const m = mundoNuevo();
    const esperas: number[] = [];
    let veces = 0;
    const { mo, s } = await hastaElPrecio(m, {
      opciones: { esperar: async (ms) => void esperas.push(ms) },
      portero: {
        async cargar(producto) {
          m.llamadas.push(`cargar:${producto}`);
          if (veces++ === 0) return no(409, "cargando", { permiso: m.permiso ?? PERMISO_P10, reintentarEn: AHORA + 60_000 });
          m.permiso = { ...(m.permiso as PermisoDelServidor), cargada: true };
          return ok(m.permiso);
        },
      },
    });
    const r = await mo.hacer("ver-qr", s, aviso());
    expect(id(r)).toBe("qr");
    expect(esperas).toEqual([61_000]);
  });
});

/* ------------------------------------------------------------------ anular: la compra sigue con su recargo */

describe("después de anular, la compra sigue en curso con su recargo", () => {
  it("la orden que nace fallada anula, el permiso queda cargado, el recargo se dice y Empezar de nuevo vuelve al precio", async () => {
    const m = mundoNuevo();
    const mo = motor(m, {
      billetera: {
        async cargaCrearOrdenDeCompra(_precio, _datos, a) {
          m.llamadas.push("cargaCrearOrdenDeCompra");
          await a.avisar();
          await a.anular();
          return { estado: "creada", id: "ord_fallida_00001111", orden: ordenEn("ord_fallida_00001111", "fallida"), falloAlCrear: true };
        },
      },
    });
    let s = await mirarHastaQueCambie(mo, mo.inicio());
    s = await mo.hacer("ver-qr", s, aviso());
    expect(m.llamadas).toContain("anular:p10");
    expect(s.permiso?.cargada).toBe(true);
    expect(s.recargoPendiente).toBe("0.5");
    const p = pantallaDeCompra({ ...s, ahora: AHORA });
    expect(p.id).toBe("fallo");
    expect(p.principal.accion).toBe("empezar-de-nuevo");
    expect(p.plegado.map((x) => x.clave)).toEqual(["compraRecargoPendiente"]);
    s = await mo.hacer("empezar-de-nuevo", s, aviso());
    expect(id(s)).toBe("precio");
    expect(s.permiso?.cargada).toBe(true);
    expect(m.pagos).toEqual([]);
  });
});

/* ------------------------------------------------------------------ el pago del paquete: nunca dos */

describe("el pago del paquete con el saldo: una sola máquina, nunca dos envíos", () => {
  /** La compra ya llegó: la carga terminada, el saldo que alcanza y el permiso cargado. */
  async function llego(m: Mundo, o: Parameters<typeof motor>[1] = {}) {
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 7 };
    m.permiso = { ...PERMISO_P10, cargada: true };
    m.saldo = "10.8500000";
    const mo = motor(m, { ...o, portero: { estado: async () => ok({ ...ESTADO, compraQr: { ...(ESTADO.compraQr as NonNullable<EstadoDeAlta["compraQr"]>), abierta: { ...PERMISO_P10, cargada: true }, terminar: true } }), ...o.portero } });
    const s = await mirarHastaQueCambie(mo, { ...mo.inicio(), carga: null });
    return { mo, s };
  }

  it("al volver, con el saldo que alcanza, Terminar mi compra por el total, y antes la orden y su pago ya leídos", async () => {
    const m = mundoNuevo();
    const { s } = await llego(m);
    expect(id(s)).toBe("llego");
    expect(s.ordenDelPaquete?.id).toBe(ID_DEL_PAQUETE);
    expect(s.cobro).toEqual({ total: "10.5", minimo: "9.975", recibido: "0" });
    expect(m.pagos).toEqual([]);
  });

  it("con la marca de un pago que quizás salió, al volver no se sabe todavía y nunca se ofrece pagar", async () => {
    const m = mundoNuevo();
    m.marca = Math.floor(AHORA / 1000) + 300;
    const { mo, s } = await llego(m);
    expect(id(s)).toBe("pago-no-se-sabe");
    expect(pantallaDeCompra({ ...s, ahora: AHORA }).pagar).toBeNull();
    const r = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(r)).toBe("pago-no-se-sabe");
    expect(m.pagos).toEqual([]);
  });

  it("una marca vencida con el servidor sin ver nada: ese pago ya no puede entrar, y la pantalla vuelve a ofrecer terminar", async () => {
    const m = mundoNuevo();
    m.marca = Math.floor(AHORA / 1000) - 5;
    const { s } = await llego(m);
    expect(id(s)).toBe("llego");
  });

  it("incierto no se repite: después del envío que no se sabe, ningún toque arma otro", async () => {
    const m = mundoNuevo();
    const pagarOrden = vi.fn(async (p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> => {
      m.pagos.push(p);
      m.marca = Math.floor(AHORA / 1000) + 600;
      return { estado: "incierto", vence: m.marca };
    });
    const { mo, s } = await llego(m, { billetera: { pagarOrden } });
    let r = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(r)).toBe("pago-no-se-sabe");
    expect(r.pagoEnviado).toBe(true);
    r = await mo.hacer("pagar-paquete", r, aviso());
    r = await mo.hacer("mirar-pago", r, aviso());
    expect(id(r)).toBe("pago-no-se-sabe");
    expect(pagarOrden).toHaveBeenCalledTimes(1);
  });

  it("dos toques a la vez: un solo envío", async () => {
    const m = mundoNuevo();
    let soltar!: () => void;
    const sigue = new Promise<void>((r) => (soltar = r));
    const pagarOrden = vi.fn(async (p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> => {
      await sigue;
      m.pagos.push(p);
      m.pagada = true;
      return { estado: "salio", hash: "cd".repeat(32) };
    });
    const { mo, s } = await llego(m, { billetera: { pagarOrden } });
    const a = mo.hacer("pagar-paquete", s, aviso());
    const b = mo.hacer("pagar-paquete", s, aviso());
    await new Promise((r) => setTimeout(r, 0));
    soltar();
    await Promise.all([a, b]);
    expect(pagarOrden).toHaveBeenCalledTimes(1);
  });

  it("si el servidor ya recibió algo que la pantalla no sabía, no se paga: la pantalla se pinta de nuevo con lo que queda", async () => {
    const m = mundoNuevo();
    const { mo, s } = await llego(m);
    m.recibido = "5";
    const r = await mo.hacer("pagar-paquete", s, aviso());
    expect(m.pagos).toEqual([]);
    expect(r.cobro?.recibido).toBe("5");
    expect(pantallaDeCompra({ ...r, ahora: AHORA }).pagar).toBe("5.5");
    const r2 = await mo.hacer("pagar-paquete", r, aviso());
    expect(id(r2)).toBe("listo");
    expect(m.pagos.map((x) => x.monto)).toEqual(["5.5"]);
  });

  it("la orden ya pagada: listo, sin mandar nada", async () => {
    const m = mundoNuevo();
    const { mo, s } = await llego(m);
    m.pagada = true;
    const r = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(r)).toBe("listo");
    expect(m.pagos).toEqual([]);
  });

  it("salió y el servidor no lo ve: salió y no se ve, sin repetir; cuando lo ve, listo", async () => {
    const m = mundoNuevo();
    const pagarOrden = vi.fn(async (p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> => {
      m.pagos.push(p);
      m.marca = Math.floor(AHORA / 1000) + 600;
      return { estado: "salio", hash: "ef".repeat(32) };
    });
    const { mo, s } = await llego(m, { billetera: { pagarOrden } });
    let r = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(r)).toBe("pago-sin-ver");
    m.pagada = true;
    r = await mo.hacer("mirar-pago", r, aviso());
    expect(id(r)).toBe("listo");
    expect(pagarOrden).toHaveBeenCalledTimes(1);
  });

  it("salió y el servidor no lo vio: aunque venza su marca, sigue sin verse, con el número, y nunca otro pago", async () => {
    const m = mundoNuevo();
    const pagarOrden = vi.fn(async (p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> => {
      m.pagos.push(p);
      // La marca ya venció y el saldo bajó: el pago salió.
      m.marca = Math.floor(AHORA / 1000) - 1;
      m.saldo = "0.3500000";
      return { estado: "salio", hash: "ef".repeat(32) };
    });
    const { mo, s } = await llego(m, { billetera: { pagarOrden } });
    let r = await mo.hacer("pagar-paquete", s, aviso());
    expect(id(r)).toBe("pago-sin-ver");
    r = await mo.hacer("mirar-pago", r, aviso());
    expect(id(r)).toBe("pago-sin-ver");
    expect(pantallaDeCompra({ ...r, ahora: AHORA }).numero).not.toBeNull();
    expect(m.registro.some((x) => x.startsWith("pago-no-entro"))).toBe(false);
    r = await mo.hacer("pagar-paquete", r, aviso());
    expect(pagarOrden).toHaveBeenCalledTimes(1);
  });

  it("y al volver (otra ventana, la marca vencida, el servidor sin verlo): sigue sin verse, nunca el precio ni otro pago", async () => {
    const m = mundoNuevo();
    const almacen = enMemoria();
    const pagarOrden = vi.fn(async (p: { destino: string; monto: string; nota: string }): Promise<ResultadoDelPagoConSaldo> => {
      m.pagos.push(p);
      m.marca = Math.floor(AHORA / 1000) - 1;
      m.saldo = "0.3500000";
      return { estado: "salio", hash: "ef".repeat(32) };
    });
    const { mo, s } = await llego(m, { billetera: { pagarOrden }, opciones: { almacen } });
    expect(id(await mo.hacer("pagar-paquete", s, aviso()))).toBe("pago-sin-ver");
    // Otra ventana: la carga terminada ya no está entre las abiertas.
    const { mo: otra, s: vuelta } = await llego(m, { billetera: { pagarOrden }, opciones: { almacen } });
    expect(id(vuelta)).toBe("pago-sin-ver");
    expect(pantallaDeCompra({ ...vuelta, ahora: AHORA }).pagar).toBeNull();
    expect(id(await otra.hacer("pagar-paquete", vuelta, aviso()))).toBe("pago-sin-ver");
    expect(pagarOrden).toHaveBeenCalledTimes(1);
    // Cuando el servidor lo ve, listo, y la marca de que salió se olvida.
    m.pagada = true;
    expect(id(await otra.hacer("mirar-pago", vuelta, aviso()))).toBe("listo");
    m.pagada = false;
    const { s: despues } = await llego(m, { billetera: { pagarOrden }, opciones: { almacen } });
    expect(id(despues)).not.toBe("pago-sin-ver");
  });

  it("el saldo no alcanzó: dice que no alcanzó y lo vuelve a leer, sin otro envío con el mismo saldo", async () => {
    const m = mundoNuevo();
    const pagarOrden = vi.fn(async (): Promise<ResultadoDelPagoConSaldo> => ({ estado: "no-salio", motivo: "sin-saldo" }));
    const { mo, s } = await llego(m, { billetera: { pagarOrden } });
    let r = await mo.hacer("pagar-paquete", s, aviso());
    const p = pantallaDeCompra({ ...r, ahora: AHORA });
    expect(p.id).toBe("espera");
    expect(p.leer).toBe("saldo");
    m.saldo = "3.0000000";
    r = await mo.mirar(r);
    expect(r.pago).toBeNull();
    expect(r.saldo).toBe("3.0000000");
    expect(pagarOrden).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ al volver después de pagar con el saldo */

describe("al volver después de un pago con el saldo que quizás salió, nunca se pide pagar de nuevo", () => {
  /** La orden del paquete como la cuenta `/v1/alta/estado`: sin pagar, con su nota. */
  const ORDEN_DEL_ESTADO = { id: ID_DEL_PAQUETE, producto: "p10", usdc: "10.5", nota: `tk:o:${ID_DEL_PAQUETE}`, vence: AHORA + 3 * 24 * 3_600_000, recibido: "0" };
  const estadoCon = (abierta: PermisoDelServidor | null, orden: EstadoDeAlta["orden"] = ORDEN_DEL_ESTADO): EstadoDeAlta => ({
    ...ESTADO,
    orden,
    compraQr: { ...(ESTADO.compraQr as NonNullable<EstadoDeAlta["compraQr"]>), abierta, terminar: abierta !== null },
  });
  const sinLaOrden = (m: Mundo) => async (producto: string) => {
    m.llamadas.push(`orden:${producto}`);
    return no(502, "pollar");
  };

  it("la compra cargada, la carga ya terminada y la orden del paquete sin leer (Pollar no contestó): no se sabe todavía, nunca el precio", async () => {
    const m = mundoNuevo();
    m.permiso = { ...PERMISO_P10, cargada: true };
    m.saldo = "0.3500000";
    m.marca = Math.floor(AHORA / 1000) + 200;
    const mo = motor(m, { portero: { estado: async () => ok(estadoCon({ ...PERMISO_P10, cargada: true })), orden: sinLaOrden(m) } });
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("pago-no-se-sabe");
    expect(pantallaDeCompra({ ...s, ahora: AHORA }).pagar).toBeNull();
    expect(m.llamadas.some((x) => x.startsWith("cargaCotizar"))).toBe(false);
    expect(m.pagos).toEqual([]);
  });

  it("pagó con Pagar con mi saldo, sin compra cargada, y vuelve antes de que el servidor lo vea: no se sabe todavía, nunca el precio", async () => {
    const m = mundoNuevo();
    m.saldo = "0.3500000";
    m.marca = Math.floor(AHORA / 1000) + 200;
    const sinRecargo = { ...ORDEN_DEL_PAQUETE, usdc: "10", precio: undefined, recargo: undefined } as OrdenDePago;
    const mo = motor(m, {
      portero: {
        estado: async () => ok(estadoCon(null, { ...ORDEN_DEL_ESTADO, usdc: "10" })),
        orden: async (p) => {
          m.llamadas.push(`orden:${p}`);
          return ok(sinRecargo);
        },
        pago: async (x) => {
          m.llamadas.push(`pago:${x}`);
          return ok({ pagada: false, recibido: "0", total: "10", minimo: "9.5" } as PagoDeOrden);
        },
      },
    });
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("pago-no-se-sabe");
    expect(m.llamadas.some((x) => x.startsWith("empezar") || x.startsWith("cargaCotizar"))).toBe(false);
    expect(m.pagos).toEqual([]);
  });

  it("y pagó sin compra cargada pero Pollar no contesta la orden: tampoco el precio", async () => {
    const m = mundoNuevo();
    m.saldo = "0.3500000";
    m.marca = Math.floor(AHORA / 1000) + 200;
    const mo = motor(m, { portero: { estado: async () => ok(estadoCon(null, { ...ORDEN_DEL_ESTADO, usdc: "10" })), orden: sinLaOrden(m) } });
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(id(s)).toBe("pago-no-se-sabe");
    expect(m.llamadas.some((x) => x.startsWith("empezar") || x.startsWith("cargaCotizar"))).toBe(false);
  });

  it("la compra cargada, sin carga y sin poder leer la orden del paquete: no sigue sin saberlo, y la próxima mirada lee todo otra vez", async () => {
    const m = mundoNuevo();
    m.permiso = { ...PERMISO_P10, cargada: true };
    m.saldo = "0.3500000";
    let falla = true;
    const mo = motor(m, {
      portero: {
        estado: async () => ok(estadoCon({ ...PERMISO_P10, cargada: true }, null)),
        orden: async (p) => {
          m.llamadas.push(`orden:${p}`);
          return falla ? no(502, "pollar") : ok(ORDEN_DEL_PAQUETE);
        },
      },
    });
    await expect(mo.mirar(mo.inicio())).rejects.toThrow();
    expect(m.llamadas.some((x) => x.startsWith("cargaCotizar"))).toBe(false);
    // La ventana se queda con lo que tenía: la mirada siguiente abre de nuevo, la carga abierta primero.
    falla = false;
    const s = await mirarHastaQueCambie(mo, mo.inicio());
    expect(m.llamadas.filter((x) => x === "cargaAbiertas")).toHaveLength(2);
    expect(id(s)).toBe("precio");
    expect(s.cobro).toEqual({ total: "10.5", minimo: "9.975", recibido: "0" });
  });
});

/* ------------------------------------------------------------------ mirar solo lee */

describe("mirar solo lee", () => {
  it("en ninguna pantalla mirar crea, aprueba, avisa ni paga", async () => {
    const m = mundoNuevo();
    m.carga = { id: "ord_9f8e7d6c5b4a3210", etapa: 2 };
    m.permiso = { ...PERMISO_P10, cargada: true };
    const mo = motor(m);
    let s = mo.inicio();
    for (let i = 0; i < 6; i++) s = await mo.mirar(s);
    for (const prohibida of ["cargaCrearOrdenDeCompra", "pagarOrden", "anular:p10"]) expect(m.llamadas, prohibida).not.toContain(prohibida);
    expect(m.llamadas.some((x) => x.startsWith("cargaAprobar") || x.startsWith("cargar"))).toBe(false);
  });

  it("sin red al abrir, lanza: la ventana lo cuenta como un intento y ofrece Probar de nuevo", async () => {
    const m = mundoNuevo();
    const mo = motor(m, { billetera: { cargaAbiertas: async () => ({ estado: "no-se-sabe" as const }) } });
    await expect(mo.mirar(mo.inicio())).rejects.toThrow();
    const r = await mo.hacer("reintentar", { ...mo.inicio(), sinRed: true }, aviso());
    expect(r.sinRed).toBe(true);
  });

  it("la sesión vencida al abrir: la pantalla de entrar de nuevo", async () => {
    const m = mundoNuevo();
    const mo = motor(m, { portero: { estado: async () => no(401, "sesion", { clave: "clErrSesion" }) } });
    const s = await mo.mirar(mo.inicio());
    expect(id(s)).toBe("sesion");
  });
});
