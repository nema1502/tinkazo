// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLang, t } from "../i18n";
import type { CanjeDeCupon, ErrorDeAlta, EstadoDeAlta, OrdenAbierta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import type { Oferta } from "../stellar/alta-oferta";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";

/**
 * Al volver al sitio con una orden de pago abierta (la persona pidió su primer paquete y cerró la pantalla): con la
 * compra en el build, el paso pregunta una vez por el pago antes de pintar, en vez de tirar la orden. Sin la compra en
 * el build, como siempre: la orden se deja de lado y no se le pregunta nada a nadie. En jsdom, con un servidor y una
 * cuenta de mentira: sin red.
 */

type Est = EstadoOficial;
const NUEVA: Est = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const ORDEN: OrdenAbierta = { id: "ABCD2345", producto: "alta", usdc: "3", nota: "tk:o:ABCD2345", vence: Date.UTC(2026, 10, 14), recibido: "0" };

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const SIN_RED: ErrorDeAlta = { ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 };

/** El servidor de las altas, de mentira: el acceso, la orden abierta y lo que contesta el pago. */
function servidorFalso(o: { compra: boolean; orden?: OrdenAbierta | null; acceso?: EstadoDeAlta["acceso"]; pago?: () => Promise<ResultadoDeAlta<PagoDeOrden>> }) {
  const s = { acceso: o.acceso ?? ("ninguno" as EstadoDeAlta["acceso"]), orden: o.orden === undefined ? ORDEN : o.orden, pagada: false };
  const estadoDe = (): EstadoDeAlta => ({ acceso: s.acceso, cuenta: "GAAA", abierta: false, pedido: null, sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: null }, orden: s.acceso === "ninguno" ? s.orden : null, fondeo: "inmediato" });
  const pago = vi.fn(async (id: string): Promise<ResultadoDeAlta<PagoDeOrden>> => {
    if (o.pago) return o.pago();
    if (id !== s.orden?.id) return { ok: false, clave: "pagoErrOrden", vars: {}, motivo: "orden", estado: 404 };
    if (s.pagada) {
      // Como el servidor: la orden pagada da el acceso, y el estado ya lo cuenta.
      s.acceso = "pago";
      return ok({ pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" });
    }
    return ok({ pagada: false, recibido: "1.5", total: "3", minimo: "2.85" });
  });
  const base = {
    estado: vi.fn(async (): Promise<ResultadoDeAlta<EstadoDeAlta>> => ok(estadoDe())),
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => SIN_RED),
    cuponGuardado: vi.fn(() => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => "GAAA"),
  };
  const orden = vi.fn(async (): Promise<ResultadoDeAlta<OrdenDePago>> => SIN_RED);
  const oferta = vi.fn(async (): Promise<Oferta> => ({ alta: null, paquetes: [] }));
  const acceso: AccesoDelPaso = o.compra ? { ...base, pago, orden, oferta } : base;
  return { s, acceso, pago, orden, oferta, estado: base.estado };
}

function cuentaFalsa() {
  const estado = { est: { ...NUEVA } as Est };
  const cuenta = {
    estadoOficial: vi.fn(async () => ({ ...estado.est })),
    activarCuenta: vi.fn(async () => {
      estado.est = { ...estado.est, activacion: "lista" };
      return "activada" as const;
    }),
    alCambiarLaCuenta: () => () => undefined,
    sesionViva: () => true,
    confirmarAparatoConDesbloqueo: vi.fn(async () => true),
    mandarCodigoParaEsteAparato: vi.fn(async () => undefined),
    confirmarCodigoParaEsteAparato: vi.fn(async () => true),
    protegerConPasskey: vi.fn(async () => true),
    mandarCodigoDeProteccion: vi.fn(async () => undefined),
    confirmarCodigoDeProteccion: vi.fn(async () => true),
  } satisfies CuentaDelPaso;
  return { cuenta, estado };
}

const raiz = (): HTMLElement | null => document.querySelector(".cuenta-lista");
const principal = (): HTMLButtonElement => raiz()?.querySelector(".cl-principal") as HTMLButtonElement;
const visibles = (): HTMLButtonElement[] => [...(raiz()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].filter((b) => !b.closest("[hidden]"));
const textoDe = (): string => raiz()?.textContent ?? "";
const pasa = (ms = GUARDA_DE_TOQUE_MS + 50): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);

async function abrir(srv: ReturnType<typeof servidorFalso>) {
  const cf = cuentaFalsa();
  const salidas = { cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() };
  void abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso });
  await pasa();
  return { cf };
}

beforeEach(() => {
  vi.useFakeTimers();
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

describe("sin la compra en el build, como siempre", () => {
  it("la orden abierta que trae el estado se deja de lado: no se pregunta por ningún pago y el paso es el de hoy", async () => {
    const con = servidorFalso({ compra: false });
    await abrir(con);
    const conOrden = { principal: principal().textContent, texto: textoDe() };
    expect(con.estado).toHaveBeenCalledTimes(1);
    expect(conOrden.principal).toBe(t("altaTengoCupon"));
    await pasa(60_000);
    expect(con.estado).toHaveBeenCalledTimes(1);
    // Lo mismo que sin ninguna orden.
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await vi.advanceTimersByTimeAsync(10);
    const sin = servidorFalso({ compra: false, orden: null });
    await abrir(sin);
    expect({ principal: principal().textContent, texto: textoDe() }).toEqual(conOrden);
  });
});

describe("con la compra en el build, la orden se retoma", () => {
  it("antes de pintar, una sola pregunta por el pago de esa orden; sin pagar, sigue la caja del acceso y nadie insiste", async () => {
    let soltar!: (r: ResultadoDeAlta<PagoDeOrden>) => void;
    const srv = servidorFalso({ compra: true, pago: () => new Promise((r) => (soltar = r)) });
    await abrir(srv);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(srv.pago).toHaveBeenCalledWith("ABCD2345");
    // Mientras el pago no contesta, el paso sigue revisando: no pinta la caja todavía.
    expect(principal().textContent).toBe(t("clRevisando"));
    expect(principal().disabled).toBe(true);
    soltar(ok({ pagada: false, recibido: "1.5", total: "3", minimo: "2.85" }));
    await pasa();
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
    // Una sola vez: no se queda preguntando. La orden entera se pide una vez, la misma (el servidor devuelve la abierta),
    // para volver a mostrar a dónde pagar; acá no contesta, y la caja queda como estaba.
    await pasa(10 * 60_000);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(srv.orden).toHaveBeenCalledTimes(1);
    expect(srv.orden).toHaveBeenCalledWith("alta");
  });

  it("si ya está pagada, el servidor da el acceso: «Recibimos tu pago.» y «Activar mi cuenta», que no se toca sola", async () => {
    const srv = servidorFalso({ compra: true });
    srv.s.pagada = true;
    const { cf } = await abrir(srv);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    // El acceso no lo da el sitio: lo vuelve a decir el estado del servidor.
    expect(srv.estado).toHaveBeenCalledTimes(2);
    expect(principal().dataset.accion).toBe("activar");
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(textoDe()).toContain(t("altaActivarPago"));
    expect(textoDe()).toContain(t("pagoListo"));
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });

  it("pagada según el pago pero sin acceso según el estado: manda el estado, y no hay «Activar»", async () => {
    const srv = servidorFalso({ compra: true, pago: async () => ok({ pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" }) });
    await abrir(srv);
    expect(srv.estado).toHaveBeenCalledTimes(2);
    expect(principal().textContent).toBe(t("altaTengoCupon"));
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
  });

  it("si el pago no contesta o se rompe, vale el acceso ya leído: la orden no traba nada", async () => {
    const fallas: (() => Promise<ResultadoDeAlta<PagoDeOrden>>)[] = [async () => ({ ok: false, clave: "pagoErrRed", vars: {}, motivo: "red", estado: 502 }), async () => Promise.reject(new Error("x"))];
    for (const pago of fallas) {
      document.body.innerHTML = `<main id="pagina"></main>`;
      const srv = servidorFalso({ compra: true, pago });
      await abrir(srv);
      expect(srv.pago).toHaveBeenCalledTimes(1);
      expect(principal().textContent).toBe(t("altaTengoCupon"));
      expect(raiz()?.querySelector('[role="alert"]')?.textContent ?? "").not.toContain(t("pagoErrRed"));
      visibles()
        .find((x) => x.textContent === t("acctSignOut"))
        ?.click();
      await vi.advanceTimersByTimeAsync(10);
    }
  });

  it("sin orden abierta, o con el acceso ya dado, no se pregunta por ningún pago", async () => {
    const sin = servidorFalso({ compra: true, orden: null });
    await abrir(sin);
    expect(sin.pago).not.toHaveBeenCalled();
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await vi.advanceTimersByTimeAsync(10);
    const con = servidorFalso({ compra: true, acceso: "cupon" });
    con.s.orden = ORDEN;
    await abrir(con);
    expect(con.pago).not.toHaveBeenCalled();
  });

  it("«Probar de nuevo» después de un error del acceso también retoma la orden", async () => {
    const srv = servidorFalso({ compra: true });
    srv.estado.mockResolvedValueOnce({ ok: false, clave: "altaErrServicio", vars: {}, motivo: "sin-red", estado: 0 });
    await abrir(srv);
    expect(srv.pago).not.toHaveBeenCalled();
    expect(principal().dataset.accion).toBe("leer-acceso");
    principal().click();
    await pasa();
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("altaTengoCupon"));
  });
});
