// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));

import { setLang, t } from "../i18n";
import type { OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { Oferta, ProductoALaVenta } from "../stellar/alta-oferta";
import type { MotivoDelPago, ResultadoDelPagoConSaldo } from "../stellar/pago-con-saldo";
import type { SaldoDeDolares } from "../stellar/saldo-dolares";
import { type CompraDePaquetes, type EstadoDelPaquete, abrirSumarSorteos, paqueteInicial, vistaDelPaquete } from "./pago-paquete";
import type { FaseDelSaldo } from "./pago-saldo";

/**
 * Sumar sorteos pagando con el saldo de la cuenta: solo si la ventana lo recibe (la bandera y la billetera del
 * proveedor) y el saldo alcanza. Antes de pagar, la confirmación propia con el monto y para qué. Después, el acceso lo
 * dice el servidor. Con un servidor y una billetera de mentira: nada sale a la red ni mueve plata.
 */

const DESTINO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const AHORA = Date.UTC(2026, 10, 16, 15, 0);
const P10: ProductoALaVenta = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
const orden = (usdc = "9"): OrdenDePago => ({
  id: "ABCD2345",
  producto: "p10",
  usdc,
  sorteos: 10,
  destino: DESTINO,
  nota: "tk:o:ABCD2345",
  memoId: memoIdDe("ABCD2345") as string,
  enlace: `web+stellar:pay?destination=${DESTINO}&amount=${usdc}&memo=tk%3Ao%3AABCD2345`,
  vence: AHORA + 72 * 3_600_000,
});
const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const NO_LLEGO = ok<PagoDeOrden>({ pagada: false, recibido: "0", total: "9", minimo: "8.55" });
const LLEGO = ok<PagoDeOrden>({ pagada: true, sorteos: { quedan: 13, proximoVence: null }, sigue: "lista" });

function servidor(o: { saldo?: SaldoDeDolares | SaldoDeDolares[]; pagar?: ResultadoDelPagoConSaldo; orden?: OrdenDePago; conSaldo?: boolean; preguntar?: boolean } = {}) {
  const s = { pagos: [] as ResultadoDeAlta<PagoDeOrden>[], lecturas: Array.isArray(o.saldo) ? [...o.saldo] : [o.saldo ?? { tipo: "saldo", saldo: "12.5000000" }] };
  const leer = vi.fn(async (): Promise<SaldoDeDolares> => (s.lecturas.length > 1 ? (s.lecturas.shift() as SaldoDeDolares) : (s.lecturas[0] as SaldoDeDolares)));
  const pagar = vi.fn(async (_o: OrdenDePago): Promise<ResultadoDelPagoConSaldo> => o.pagar ?? { estado: "salio", hash: "ab".repeat(32) });
  const compra: CompraDePaquetes = {
    oferta: vi.fn(async (): Promise<Oferta> => ({ alta: null, paquetes: [P10] })),
    orden: vi.fn(async (): Promise<ResultadoDeAlta<OrdenDePago>> => ok(o.orden ?? orden())),
    pago: vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => (s.pagos.length > 1 ? (s.pagos.shift() as ResultadoDeAlta<PagoDeOrden>) : (s.pagos[0] ?? NO_LLEGO))),
    refrescarCupo: vi.fn(),
    ...(o.conSaldo === false ? {} : { saldo: { leer, pagar } }),
    // Con la compra con QR en el build, antes de pagar con el saldo se pregunta por la orden. Sin ella, como siempre.
    ...(o.preguntar === false ? {} : { preguntarAntesDePagar: true }),
  };
  return { s, compra, leer, pagar };
}

const card = (): HTMLElement | null => document.querySelector('[data-pago="paquete"]');
const principal = (): HTMLButtonElement => card()?.querySelector(".dlg-main") as HTMLButtonElement;
const cuerpo = (): string => card()?.querySelector(".dlg-cuerpo")?.textContent ?? "";
const alerta = (): string => card()?.querySelector('[role="alert"]')?.textContent ?? "";
const panel = (): HTMLElement | null => card()?.querySelector('[data-pago="panel"]') ?? null;
const boton = (accion: string): HTMLButtonElement | undefined => [...(card()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.dataset.accion === accion && !b.classList.contains("dlg-main"));
const pasa = (ms = 20): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const tocar = async (b: HTMLElement | undefined | null): Promise<void> => {
  expect(b, "el botón está a la vista").toBeTruthy();
  (b as HTMLElement).click();
  await pasa();
};
async function abrir(srv: ReturnType<typeof servidor>): Promise<void> {
  void abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com" });
  await pasa();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  setLang("es");
  document.body.innerHTML = "";
});
afterEach(async () => {
  (card()?.querySelector('[data-dlg="x"]') as HTMLButtonElement | null)?.click();
  await pasa();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("cuándo se ofrece pagar con el saldo", () => {
  it("si el saldo alcanza, antes de la orden se pregunta cómo pagar: el saldo de principal y la otra app al lado", async () => {
    const srv = servidor();
    await abrir(srv);
    expect(cuerpo()).toContain("Tenés 12,50 dólares digitales en tu cuenta.");
    expect(principal().textContent).toBe(t("pagoMedioSaldo"));
    expect(boton("medio-app")?.textContent).toBe(t("pagoMedioApp"));
    expect(srv.compra.orden).not.toHaveBeenCalled();
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });

  for (const [que, saldo] of [
    ["la cuenta no existe", { tipo: "sin-cuenta" }],
    ["no tiene la línea", { tipo: "sin-linea" }],
    ["no se pudo leer", { tipo: "sin-red" }],
    ["el saldo es cero", { tipo: "saldo", saldo: "0.0000000" }],
  ] as Array<[string, SaldoDeDolares]>) {
    it(`si ${que}, todo como siempre: directo a los datos para pagar, sin nada del saldo`, async () => {
      const srv = servidor({ saldo });
      await abrir(srv);
      expect(panel()).toBeTruthy();
      expect(panel()?.querySelector('[data-pago="saldo"]')).toBeNull();
      expect(principal().textContent).toBe(t("pagoYaPague"));
      expect(cuerpo()).not.toContain(t("pagoMedioSaldo"));
    });
  }

  it("si hay saldo y no alcanza, el panel de siempre dice cuánto hay y cuánto falta, y el otro medio queda igual", async () => {
    const srv = servidor({ saldo: { tipo: "saldo", saldo: "5.0000000" } });
    await abrir(srv);
    const fila = panel()?.querySelector('[data-pago="saldo"]');
    expect(fila?.textContent).toContain(t("pagoSaldoEt"));
    expect(fila?.textContent).toContain("Tenés 5 dólares digitales, faltan 4");
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(panel()?.querySelector('[data-dato="monto"]')?.textContent).toBe("9 USDC");
    // Va después de los datos para transferir: no se lee como lo que hay que mandar.
    const filas = [...(panel()?.children ?? [])];
    expect(filas.indexOf(fila as Element)).toBeGreaterThan(filas.findIndex((x) => x.querySelector('[data-dato="nota"]')));
  });

  it("sin el saldo en la ventana (la bandera apagada o la billetera propia), ni se lee", async () => {
    const srv = servidor({ conSaldo: false });
    await abrir(srv);
    expect(srv.leer).not.toHaveBeenCalled();
    expect(panel()).toBeTruthy();
  });

  it("Desde una app de pagos pide la orden y muestra los datos de siempre", async () => {
    const srv = servidor();
    await abrir(srv);
    await tocar(boton("medio-app"));
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
    expect(panel()).toBeTruthy();
    expect(srv.pagar).not.toHaveBeenCalled();
  });
});

describe("pagar con el saldo", () => {
  it("primero la confirmación propia, con el monto y para qué, y una sola principal", async () => {
    const srv = servidor();
    await abrir(srv);
    await tocar(principal());
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
    expect(cuerpo()).toContain("Vas a pagar 9 dólares a Tinkazo por 10 sorteos oficiales.");
    expect(principal().textContent).toBe("Pagar 9 dólares");
    expect(boton("saldo-otro-medio")?.textContent).toBe(t("pagoSaldoOtroMedio"));
    expect(panel()).toBeNull();
    expect(srv.pagar).not.toHaveBeenCalled();
  });

  it("pagar paga esa orden tal cual, una vez, y el acceso lo dice el servidor después", async () => {
    const srv = servidor();
    // La primera pregunta es la de antes de pagar.
    srv.s.pagos = [NO_LLEGO, NO_LLEGO, LLEGO];
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).toHaveBeenCalledTimes(1);
    expect(srv.pagar.mock.calls[0]?.[0]).toEqual(orden());
    // Todavía no llegó: se mira, sin dar nada por hecho.
    expect(srv.compra.pago).toHaveBeenCalled();
    expect(cuerpo()).not.toContain(t("pagoListo"));
    await pasa(10_000);
    expect(cuerpo()).toContain("Recibimos tu pago. Te quedan 13 sorteos oficiales.");
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(1);
    expect(srv.pagar).toHaveBeenCalledTimes(1);
  });

  it("si no se sabe si salió, no se ofrece pagar de nuevo: se busca el pago de la orden", async () => {
    const srv = servidor({ pagar: { estado: "incierto", vence: Math.floor(AHORA / 1000) + 240 } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(cuerpo()).toContain(t("pagoSaldoIncierto"));
    expect(srv.compra.pago).toHaveBeenCalled();
    await pasa(5 * 60_000 + 50);
    // A los 5 minutos: se puede buscar de nuevo, nunca pagar de nuevo.
    expect(principal().textContent).toBe(t("pagoSaldoBuscar"));
    expect(card()?.textContent).not.toContain("Pagar 9 dólares");
    await tocar(principal());
    expect(srv.pagar).toHaveBeenCalledTimes(1);
  });

  const fallas: Array<[MotivoDelPago, string, string]> = [
    ["cancelado", "pagoSaldoCancelado", "Pagar 9 dólares"],
    ["red", "pagoSaldoNoSalio", "Pagar 9 dólares"],
    ["rechazado", "pagoSaldoNoSalio", "Pagar 9 dólares"],
    ["sin-linea", "pagoSaldoSinLinea", "Pagar desde una app de pagos"],
    ["regla", "pagoSaldoRaro", "Pagar desde una app de pagos"],
    ["sin-patrocinio", "pagoSaldoSinPatrocinio", "Pagar desde una app de pagos"],
    ["destino", "pagoSaldoDestino", "Pagar desde una app de pagos"],
  ];
  for (const [motivo, clave, siguiente] of fallas) {
    it(`no salió (${motivo}): su texto, y la principal es ${siguiente}`, async () => {
      const srv = servidor({ pagar: { estado: "no-salio", motivo } });
      await abrir(srv);
      await tocar(principal());
      await tocar(principal());
      expect(alerta()).toBe(t(clave));
      expect(principal().textContent).toBe(siguiente);
      // Solo la pregunta de antes de pagar: lo que no salió no se busca.
      expect(srv.compra.pago).toHaveBeenCalledTimes(1);
    });
  }

  it("con la compra con QR apagada, pagar con el saldo no pregunta antes por la orden: como siempre", async () => {
    const srv = servidor({ preguntar: false, pagar: { estado: "no-salio", motivo: "rechazado" } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).toHaveBeenCalledTimes(1);
    expect(srv.compra.pago).not.toHaveBeenCalled();
    expect(alerta()).toBe(t("pagoSaldoNoSalio"));
  });

  it("antes de pagar se pregunta por la orden: ya pagada, no se manda nada y se ve el acceso", async () => {
    const srv = servidor();
    srv.s.pagos = [LLEGO];
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    await pasa(1_000);
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(cuerpo()).toContain("Recibimos tu pago. Te quedan 13 sorteos oficiales.");
  });

  it("antes de pagar se pregunta por la orden: con algo recibido no se paga con el saldo, lo que falta va por la otra app", async () => {
    const srv = servidor();
    srv.s.pagos = [ok<PagoDeOrden>({ pagada: false, recibido: "4", total: "9", minimo: "8.55" })];
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(panel()).toBeTruthy();
  });

  it("antes de pagar se pregunta por la orden: sin respuesta no se manda nada y se puede probar de nuevo", async () => {
    const srv = servidor();
    srv.compra.pago = vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => ({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 }));
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(srv.pagar).not.toHaveBeenCalled();
    expect(alerta()).toBe(t("pagoSaldoNoSalio"));
    expect(principal().textContent).toBe("Pagar 9 dólares");
  });

  it("no alcanza el saldo (cambió desde que se leyó): se lee de nuevo y se dice cuánto hay y cuánto falta", async () => {
    const srv = servidor({ saldo: [{ tipo: "saldo", saldo: "12.5000000" }, { tipo: "saldo", saldo: "2.0000000" }], pagar: { estado: "no-salio", motivo: "sin-saldo" } });
    await abrir(srv);
    await tocar(principal());
    await tocar(principal());
    expect(alerta()).toBe("Tu saldo no alcanza. Tenés 2 y faltan 7.");
    expect(principal().textContent).toBe(t("pagoSaldoOtroMedio"));
    // El otro medio: la misma orden, con los datos para pagar y el renglón de lo que falta.
    await tocar(principal());
    expect(panel()?.querySelector('[data-pago="saldo"]')?.textContent).toContain("Tenés 2 dólares digitales, faltan 7");
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
  });

  it("si la orden pide más que el saldo, no se paga: se dice y queda el otro medio", async () => {
    const srv = servidor({ saldo: { tipo: "saldo", saldo: "9.5000000" }, orden: orden("10") });
    await abrir(srv);
    await tocar(principal());
    expect(alerta()).toContain("Tu saldo no alcanza.");
    expect(principal().textContent).toBe(t("pagoSaldoOtroMedio"));
    expect(srv.pagar).not.toHaveBeenCalled();
  });
});

describe("la tabla del pago con el saldo", () => {
  it("una sola principal y una sola línea en cada estado, y nunca pagar de nuevo si no se sabe si salió", () => {
    const fases: FaseDelSaldo[] = ["confirmar", "pagando", "mirando"];
    const motivos: Array<MotivoDelPago | null> = [null, "sin-saldo", "sin-linea", "cancelado", "regla", "sin-patrocinio", "destino", "rechazado", "red", "sin-cuenta"];
    let filas = 0;
    for (const saldoFase of fases)
      for (const motivo of motivos)
        for (const incierto of [false, true])
          for (const buscando of [false, true])
            for (const tarda of [false, true])
              for (const error of [null, { clave: "pagoErrRed" }])
                for (const saldo of ["12.5000000", "9.0000000", "3.0000000"])
                  for (const idioma of ["es", "en"] as const) {
                    const e: EstadoDelPaquete = { ...paqueteInicial(idioma, "a•••@gmail.com"), fase: "pagando", paquetes: [P10], elegido: P10, orden: orden(), medio: "saldo", saldo, saldoFase, motivo, incierto, buscando, tarda, error };
                    const v = vistaDelPaquete(e);
                    filas++;
                    const quien = JSON.stringify({ saldoFase, motivo, incierto, buscando, tarda, error, saldo });
                    expect(v.principal, quien).toBeTruthy();
                    expect(v.secundarios.some((s) => s.accion === v.principal.accion), quien).toBe(false);
                    expect([...v.textos, ...(v.error ? [v.error] : [])].length, quien).toBeLessThanOrEqual(1);
                    expect(v.panel, quien).toBeNull();
                    if (incierto || saldoFase !== "confirmar") expect([v.principal, ...v.secundarios].some((b) => b.accion === "saldo-pagar" && !b.apagado), quien).toBe(false);
                  }
    expect(filas).toBeGreaterThan(2000);
  });
});
