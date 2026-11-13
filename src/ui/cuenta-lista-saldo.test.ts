// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));

import { setLang, t } from "../i18n";
import type { CanjeDeCupon, ErrorDeAlta, EstadoDeAlta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { Oferta } from "../stellar/alta-oferta";
import type { ResultadoDelPagoConSaldo } from "../stellar/pago-con-saldo";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

/**
 * «Dejá tu cuenta lista» con el primer paquete pagado con el saldo de la cuenta (jsdom, con un servidor y una billetera
 * de mentira: sin red y sin plata). Se ofrece solo si el saldo alcanza; antes de pagar, la confirmación propia; después,
 * el acceso lo da el servidor, y «Activar mi cuenta» espera el toque de la persona.
 */

const NUEVA: EstadoOficial = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const DESTINO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const AHORA = Date.UTC(2026, 10, 16, 15, 0);
const orden = (): OrdenDePago => ({
  id: "ABCD2345",
  producto: "alta",
  usdc: "3",
  sorteos: 3,
  destino: DESTINO,
  nota: "tk:o:ABCD2345",
  memoId: memoIdDe("ABCD2345") as string,
  enlace: `web+stellar:pay?destination=${DESTINO}&amount=3&memo=tk%3Ao%3AABCD2345`,
  vence: AHORA + 72 * 3_600_000,
});
const A_LA_VENTA: Oferta = { alta: { id: "alta", usdc: "3", sorteos: 3, dias: 90 }, paquetes: [] };
const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const err = (clave: string, motivo: string, estado: number): ErrorDeAlta => ({ ok: false, clave, vars: {}, motivo, estado });
const NO_LLEGO = ok<PagoDeOrden>({ pagada: false, recibido: "0", total: "3", minimo: "2.85" });
const LLEGO = ok<PagoDeOrden>({ pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" });

function servidor(o: { saldo?: SaldoDeDolares; pagar?: ResultadoDelPagoConSaldo; conSaldo?: boolean; preguntar?: boolean } = {}) {
  const s = { acceso: "ninguno" as EstadoDeAlta["acceso"], pagos: [] as ResultadoDeAlta<PagoDeOrden>[] };
  const estado = vi.fn(async (): Promise<ResultadoDeAlta<EstadoDeAlta>> => ok({ acceso: s.acceso, cuenta: "GAAA", abierta: false, pedido: null, sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: null }, orden: null, fondeo: "inmediato" }));
  const pago = vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => {
    const r = s.pagos.length > 1 ? (s.pagos.shift() as ResultadoDeAlta<PagoDeOrden>) : (s.pagos[0] ?? NO_LLEGO);
    if (r.ok && r.datos.pagada) s.acceso = "pago";
    return r;
  });
  const pedirOrden = vi.fn(async (_p: string): Promise<ResultadoDeAlta<OrdenDePago>> => ok(orden()));
  const leer = vi.fn(async (): Promise<SaldoDeDolares> => o.saldo ?? { tipo: "saldo", saldo: "12.5000000" });
  const pagar = vi.fn(async (_o: OrdenDePago): Promise<ResultadoDelPagoConSaldo> => o.pagar ?? { estado: "salio", hash: "ab".repeat(32) });
  const acceso: AccesoDelPaso = {
    estado,
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => err("altaErrServicio", "sin-red", 0)),
    cuponGuardado: vi.fn(() => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => "GAAA"),
    oferta: vi.fn(async () => A_LA_VENTA),
    orden: pedirOrden,
    pago,
    ...(o.conSaldo === false ? {} : { saldo: { leer, pagar } }),
    // Con la compra con QR en el build, antes de pagar con el saldo se pregunta por la orden. Sin ella, como siempre.
    ...(o.preguntar === false ? {} : { preguntarAntesDePagar: true }),
  };
  return { s, acceso, pedirOrden, pago, leer, pagar };
}

function cuentaFalsa() {
  const cuenta = {
    estadoOficial: vi.fn(async () => ({ ...NUEVA })),
    activarCuenta: vi.fn(async () => "activada" as const),
    alCambiarLaCuenta: () => () => undefined,
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  } satisfies CuentaDelPaso;
  return cuenta;
}

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const boton = (accion: string): HTMLButtonElement | undefined => visibles().find((b) => b.dataset.accion === accion && !b.classList.contains("cl-principal"));
const textoDe = (): string => raiz()?.textContent ?? "";
const alerta = (): string => raiz()?.querySelector('[role="alert"]')?.textContent ?? "";
const panel = (): HTMLElement | null => raiz()?.querySelector('[data-pago="panel"]') ?? null;
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const tocar = async (b: HTMLElement | undefined | null): Promise<void> => {
  expect(b, "el botón está a la vista").toBeTruthy();
  (b as HTMLElement).click();
  await pasa();
};

async function abrir(srv: ReturnType<typeof servidor>) {
  const cuenta = cuentaFalsa();
  const salidas = { cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() };
  void abrirCuentaLista(cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: NUEVA, acceso: srv.acceso });
  await pasa();
  return cuenta;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  setLang("es");
  aceptarClicsDePrueba(true);
  document.body.innerHTML = `<main id="pagina"></main>`;
});
afterEach(async () => {
  if (raiz()) {
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await vi.advanceTimersByTimeAsync(10);
  }
  aceptarClicsDePrueba(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("el primer paquete con el saldo de la cuenta", () => {
  it("si alcanza, al tocar el paquete se pregunta cómo pagar, sin pedir todavía la orden", async () => {
    const srv = servidor();
    await abrir(srv);
    expect(principal().textContent).toBe("3 sorteos oficiales por 3 dólares");
    await tocar(principal());
    expect(srv.leer).toHaveBeenCalledTimes(1);
    expect(textoDe()).toContain("Tenés 12,50 dólares digitales en tu cuenta.");
    expect(principal().textContent).toBe(t("pagoMedioSaldo"));
    expect(boton("pago-medio")?.textContent).toBe(t("pagoMedioApp"));
    expect(srv.pedirOrden).not.toHaveBeenCalled();
  });

  it("Pagar con mi saldo pide la orden y muestra la confirmación propia, con una sola principal y sin los datos de la otra app", async () => {
    const srv = servidor();
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(srv.pedirOrden).toHaveBeenCalledWith("alta");
    expect(textoDe()).toContain("Vas a pagar 3 dólares a Tinkazo por 3 sorteos oficiales.");
    expect(principal().textContent).toBe("Pagar 3 dólares");
    expect(boton("saldo-otro-medio")).toBeTruthy();
    expect(panel()).toBeNull();
    expect(srv.pagar).not.toHaveBeenCalled();
  });

  it("pagar paga esa orden una vez, y el acceso sale del servidor: después, Activar espera el toque", async () => {
    const srv = servidor();
    // La primera pregunta es la de antes de pagar.
    srv.s.pagos = [NO_LLEGO, NO_LLEGO, LLEGO];
    const cuenta = await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).toHaveBeenCalledTimes(1);
    expect(srv.pagar.mock.calls[0]?.[0]).toEqual(orden());
    expect(srv.pago).toHaveBeenCalled();
    // Mandado no es pagado: hasta que el servidor lo vea, no hay Activar.
    expect(principal().dataset.accion).not.toBe("activar");
    await pasa(10_000);
    expect(principal().dataset.accion).toBe("activar");
    expect(cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(srv.pagar).toHaveBeenCalledTimes(1);
  });

  it("si no se sabe si salió, no se ofrece pagar de nuevo: se busca el pago de la orden", async () => {
    const srv = servidor({ pagar: { estado: "incierto", vence: Math.floor(AHORA / 1000) + 240 } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(textoDe()).toContain(t("pagoSaldoIncierto"));
    expect(srv.pago).toHaveBeenCalled();
    await pasa(5 * 60_000 + 50);
    expect(principal().textContent).toBe(t("pagoSaldoBuscar"));
    expect(textoDe()).not.toContain("Pagar 3 dólares");
    expect(boton("saldo-otro-medio")).toBeUndefined();
    expect(srv.pagar).toHaveBeenCalledTimes(1);
  });

  it("la persona no lo aprobó: su texto, y se puede pagar de nuevo o pasar al otro medio", async () => {
    const srv = servidor({ pagar: { estado: "no-salio", motivo: "cancelado" } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(alerta()).toBe(t("pagoSaldoCancelado"));
    expect(principal().textContent).toBe("Pagar 3 dólares");
    await tocar(boton("saldo-otro-medio"));
    expect(panel()).toBeTruthy();
    expect(srv.pedirOrden).toHaveBeenCalledTimes(1);
  });

  it("con la compra con QR apagada, pagar con el saldo no pregunta antes por la orden: como siempre", async () => {
    const srv = servidor({ preguntar: false, pagar: { estado: "no-salio", motivo: "cancelado" } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).toHaveBeenCalledTimes(1);
    expect(srv.pago).not.toHaveBeenCalled();
    expect(alerta()).toBe(t("pagoSaldoCancelado"));
  });

  it("antes de pagar se pregunta por la orden: ya pagada, no se manda nada y el acceso sale del servidor", async () => {
    const srv = servidor();
    srv.s.pagos = [LLEGO];
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    await pasa(1_000);
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(principal().dataset.accion).toBe("activar");
  });

  it("antes de pagar se pregunta por la orden: con algo recibido no se paga con el saldo, lo que falta va por la otra app", async () => {
    const srv = servidor();
    srv.s.pagos = [ok<PagoDeOrden>({ pagada: false, recibido: "1", total: "3", minimo: "2.85" })];
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(panel()).toBeTruthy();
  });

  it("antes de pagar se pregunta por la orden: sin respuesta no se manda nada y se puede probar de nuevo", async () => {
    const srv = servidor();
    srv.pago.mockImplementation(async () => err("altaErrServicio", "sin-red", 0));
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(alerta()).toBe(t("pagoSaldoNoSalio"));
    expect(principal().textContent).toBe("Pagar 3 dólares");
  });

  it("si el saldo no alcanza, directo a los datos de siempre, con lo que hay y lo que falta", async () => {
    const srv = servidor({ saldo: { tipo: "saldo", saldo: "1.0000000" } });
    await abrir(srv);
    await tocar(principal());
    expect(panel()?.querySelector('[data-pago="saldo"]')?.textContent).toContain("Tenés 1 dólar digital, faltan 2");
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(textoDe()).not.toContain(t("pagoMedioSaldo"));
  });

  it("sin el saldo en el paso (la bandera apagada o la billetera propia), todo como siempre y sin leer nada", async () => {
    const srv = servidor({ conSaldo: false });
    await abrir(srv);
    await tocar(principal());
    expect(srv.leer).not.toHaveBeenCalled();
    expect(srv.pedirOrden).toHaveBeenCalledTimes(1);
    expect(panel()?.querySelector('[data-pago="saldo"]')).toBeNull();
  });
});
