// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));

import { setLang, t } from "../i18n";
import type { CanjeDeCupon, ErrorDeAlta, EstadoDeAlta, OrdenAbierta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { Oferta } from "../stellar/alta-oferta";
import type { EstadoOficial } from "../stellar/wallet-pollar";
import { type AccesoDelPaso, type CuentaDelPaso, GUARDA_DE_TOQUE_MS, abrirCuentaLista, aceptarClicsDePrueba } from "./cuenta-lista";
import { CADA_MS, DURANTE_MS } from "./pago-sondeo";

/**
 * «Dejá tu cuenta lista» con la compra del primer paquete, en pantalla (jsdom, con un servidor y una cuenta de mentira:
 * sin red). Cada estado del pago con su texto y su única principal: el paquete, los datos para pagar, «Ya pagué» que mira
 * solo cada 10 segundos durante 5 minutos, llegó, llegó de menos, venció, tarda, sin conexión y la venta en pausa. Nunca
 * se activa solo: «Activar mi cuenta» aparece con el acceso que da el servidor y espera el toque de la persona.
 */

type Est = EstadoOficial;
const NUEVA: Est = { activacion: "falta", proteccion: "falta", correoConfirmado: false, tieneLlaves: false, unicoNavegador: true, correoDeLaCuenta: null };
const ID = "ABCD2345";
const DESTINO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const AHORA = Date.UTC(2026, 10, 16, 15, 0);
const orden = (id = ID, vence = AHORA + 72 * 3_600_000): OrdenDePago => ({
  id,
  producto: "alta",
  usdc: "3",
  sorteos: 3,
  destino: DESTINO,
  nota: `tk:o:${id}`,
  memoId: memoIdDe(id) as string,
  enlace: `web+stellar:pay?destination=${DESTINO}&amount=3&memo=tk%3Ao%3A${id}`,
  vence,
});
const A_LA_VENTA: Oferta = { alta: { id: "alta", usdc: "3", sorteos: 3, dias: 90 }, paquetes: [] };

const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const err = (clave: string, motivo: string, estado: number): ErrorDeAlta => ({ ok: false, clave, vars: {}, motivo, estado });
const NO_LLEGO = ok<PagoDeOrden>({ pagada: false, recibido: "0", total: "3", minimo: "2.85" });
const LLEGO = ok<PagoDeOrden>({ pagada: true, sorteos: { quedan: 3, proximoVence: null }, sigue: "activar" });

function servidorFalso(o: { compra?: boolean; oferta?: Oferta; abierta?: OrdenAbierta | null } = {}) {
  const s = { acceso: "ninguno" as EstadoDeAlta["acceso"], abierta: o.abierta ?? null, pagos: [] as ResultadoDeAlta<PagoDeOrden>[], ordenes: [] as ResultadoDeAlta<OrdenDePago>[] };
  const estadoDe = (): EstadoDeAlta => ({ acceso: s.acceso, cuenta: "GAAA", abierta: false, pedido: null, sorteos: { quedan: s.acceso === "ninguno" ? 0 : 3, proximoVence: null }, orden: s.acceso === "ninguno" ? s.abierta : null, fondeo: "inmediato" });
  const estado = vi.fn(async (): Promise<ResultadoDeAlta<EstadoDeAlta>> => ok(estadoDe()));
  const pago = vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => {
    const r = s.pagos.length > 1 ? (s.pagos.shift() as ResultadoDeAlta<PagoDeOrden>) : (s.pagos[0] ?? NO_LLEGO);
    // Como el servidor: una orden pagada da el acceso, y el estado ya lo cuenta.
    if (r.ok && r.datos.pagada) s.acceso = "pago";
    return r;
  });
  const pedirOrden = vi.fn(async (_producto: string): Promise<ResultadoDeAlta<OrdenDePago>> => (s.ordenes.length > 1 ? (s.ordenes.shift() as ResultadoDeAlta<OrdenDePago>) : (s.ordenes[0] ?? ok(orden()))));
  const oferta = vi.fn(async (): Promise<Oferta> => o.oferta ?? A_LA_VENTA);
  const base = {
    estado,
    canjear: vi.fn(async (): Promise<ResultadoDeAlta<CanjeDeCupon>> => err("altaErrServicio", "sin-red", 0)),
    cuponGuardado: vi.fn(() => null),
    guardarCupon: vi.fn(),
    olvidarCupon: vi.fn(),
    refrescarCupo: vi.fn(),
    cuenta: vi.fn(() => "GAAA"),
  };
  const acceso: AccesoDelPaso = o.compra === false ? base : { ...base, oferta, orden: pedirOrden, pago };
  return { s, acceso, estado, pago, pedirOrden, oferta };
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

async function abrir(srv: ReturnType<typeof servidorFalso>, extra: Partial<Parameters<typeof abrirCuentaLista>[2]> = {}) {
  const cf = cuentaFalsa();
  const salidas = { cerrarSesion: vi.fn(async () => undefined), pasarAPrueba: vi.fn(), puedePasarAPrueba: vi.fn(() => true), entrarDeNuevo: vi.fn() };
  void abrirCuentaLista(cf.cuenta, salidas, { para: "entrada", correo: "ana@gmail.com", celular: true, inicial: cf.estado.est, acceso: srv.acceso, ...extra });
  await pasa();
  return { cf };
}

/** Hasta los datos para pagar: el paquete y nada más. */
async function hastaPagar(srv: ReturnType<typeof servidorFalso>) {
  const r = await abrir(srv);
  await tocar(principal());
  return r;
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

describe("comprar el primer paquete", () => {
  it("con el QR para esta cuenta, Estoy en Bolivia va en el panel, antes de los datos: recuerda el medio y lleva al QR", async () => {
    const srv = servidorFalso();
    const alQr = vi.fn();
    try {
      await abrir(srv, { alQr });
      await tocar(principal());
      const cambio = panel()?.querySelector<HTMLElement>('[data-pago="cambio"]');
      expect(cambio?.textContent).toBe(t("compraEstoy"));
      expect(panel()?.firstElementChild).toBe(cambio);
      await tocar(cambio);
      expect(localStorage.getItem("tinkazo:medio-de-pago")).toBe("qr");
      expect(alQr).toHaveBeenCalledTimes(1);
    } finally {
      localStorage.removeItem("tinkazo:medio-de-pago");
    }
  });

  it("sin el QR para esta cuenta, el panel no ofrece cambiar", async () => {
    const srv = servidorFalso();
    await abrir(srv);
    await tocar(principal());
    expect(panel()?.querySelector('[data-pago="cambio"]')).toBeNull();
  });

  it("sin cupón y con el paquete a la venta, el paquete es la principal con el precio del servidor, y lleva directo a los datos para pagar", async () => {
    const srv = servidorFalso();
    const { cf } = await abrir(srv);
    expect(principal().textContent).toBe("3 sorteos oficiales por 3 dólares");
    expect(boton("tengo-cupon")).toBeTruthy();
    await tocar(principal());
    // Un solo medio: ninguna pregunta antes.
    expect(visibles().some((b) => b.dataset.accion === "pago-medio")).toBe(false);
    expect(srv.pedirOrden).toHaveBeenCalledTimes(1);
    expect(srv.pedirOrden).toHaveBeenCalledWith("alta");
    expect(panel()?.querySelector('[data-dato="destino"]')?.textContent).toBe(`${DESTINO.slice(0, 4)}…${DESTINO.slice(-4)}`);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe(`tk:o:${ID}`);
    expect(panel()?.querySelector('[data-dato="monto"]')?.textContent).toBe("3 USDC");
    // Poco texto: a la vista, el título del paquete, una sola línea (cómo pagar) y los datos; lo demás, plegado.
    const cuerpo = raiz()?.querySelector(".cl-actual .cl-paso-cuerpo");
    expect(raiz()?.querySelector(".cl-actual .cl-paso-titulo")?.textContent).toContain(t("pagoTitulo"));
    expect([...(cuerpo?.querySelectorAll(":scope > p, :scope > .cl-error") ?? [])].map((p) => p.textContent)).toEqual([t("compraAppLinea")]);
    const mas = panel()?.querySelector<HTMLDetailsElement>('details[data-pago="detalles"]');
    expect(mas?.open).toBe(false);
    expect(mas?.textContent).toContain(t("pagoParaCuenta").replace("{correo}", "a•••@gmail.com"));
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(principal().disabled).toBe(false);
    // Una sola principal, y nada de activar.
    expect(raiz()?.querySelectorAll(".cl-principal").length).toBe(1);
    expect(visibles().some((b) => b.dataset.accion === "activar")).toBe(false);
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    expect(srv.pago).not.toHaveBeenCalled();
  });

  it("«Ya pagué» mira enseguida y después sola cada 10 segundos; apenas llega, «Recibimos tu pago.» y «Activar mi cuenta», que no se toca sola", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [NO_LLEGO, NO_LLEGO, LLEGO];
    const { cf } = await hastaPagar(srv);
    await tocar(principal());
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("pagoBuscando"));
    expect(principal().disabled).toBe(true);
    expect(textoDe()).toContain(t("pagoNoLlego"));
    await pasa(CADA_MS);
    expect(srv.pago).toHaveBeenCalledTimes(2);
    await pasa(CADA_MS);
    expect(srv.pago).toHaveBeenCalledTimes(3);
    expect(principal().dataset.accion).toBe("activar");
    expect(principal().textContent).toBe(t("clActivarBoton"));
    expect(textoDe()).toContain(t("pagoListo"));
    expect(textoDe()).toContain(t("altaActivarPago"));
    expect(panel()).toBeNull();
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
    // Llegó: no se pregunta más.
    await pasa(DURANTE_MS);
    expect(srv.pago).toHaveBeenCalledTimes(3);
  });

  it("llegó de menos: cuánto llegó de cuánto, que se completa con la misma nota, y se sigue mirando", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [ok({ pagada: false, recibido: "1.5", total: "3", minimo: "2.85" })];
    await hastaPagar(srv);
    await tocar(principal());
    expect(textoDe()).toContain("Llegaron 1,50 de 3 USDC. Mandá lo que falta con la misma nota.");
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe(`tk:o:${ID}`);
    await pasa(CADA_MS);
    expect(srv.pago).toHaveBeenCalledTimes(2);
  });

  it("a los 5 minutos: que algunas apps tardan, y «No llegó», que recién ahí dice lo de la red; «Ya pagué» vuelve a mirar", async () => {
    const srv = servidorFalso();
    await hastaPagar(srv);
    await tocar(principal());
    await pasa(DURANTE_MS);
    const vecesAntes = srv.pago.mock.calls.length;
    expect(vecesAntes).toBe(31);
    expect(textoDe()).toContain(t("pagoTarda"));
    expect(textoDe()).not.toContain(t("pagoRedEquivocada"));
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(principal().disabled).toBe(false);
    await tocar(boton("no-llego"));
    expect(textoDe()).toContain(t("pagoRedEquivocada"));
    expect(boton("no-llego")).toBeUndefined();
    await pasa(10 * 60_000);
    expect(srv.pago).toHaveBeenCalledTimes(vecesAntes);
    await tocar(principal());
    expect(srv.pago).toHaveBeenCalledTimes(vecesAntes + 1);
  });

  it("sin conexión: el motivo y «Probar de nuevo», que vuelve a mirar", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [err("altaErrServicio", "sin-red", 0), NO_LLEGO];
    await hastaPagar(srv);
    await tocar(principal());
    expect(alerta()).toContain(t("pagoErrRed"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    await pasa(CADA_MS * 3);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    await tocar(principal());
    expect(srv.pago).toHaveBeenCalledTimes(2);
    expect(alerta()).toBe("");
  });

  it("la venta en pausa al pedir la orden: el motivo, y nada que ofrezca comprar", async () => {
    const srv = servidorFalso();
    srv.s.ordenes = [err("pagoPausado", "venta-pausada", 503)];
    await abrir(srv);
    await tocar(principal());
    // La pausa de hoy es a mano: una frase corta que no promete cuándo vuelve.
    expect(alerta()).toContain(t("pagoNoALaVenta"));
    expect(principal().dataset.accion).toBe("tengo-cupon");
    expect(visibles().some((b) => b.dataset.accion === "comprar")).toBe(false);
    expect(panel()).toBeNull();
  });

  it("la orden venció sin pagar: nada para pagar con la nota vieja, y «Pedir una nota nueva» pide otra", async () => {
    const srv = servidorFalso();
    srv.s.ordenes = [ok(orden(ID, AHORA + 60_000)), ok(orden("WXYZ2345"))];
    await hastaPagar(srv);
    expect(panel()).not.toBeNull();
    // Al vencer, sin que nadie toque nada, la nota vencida deja de mostrarse para pagar.
    await pasa(2 * 60_000);
    expect(panel()).toBeNull();
    expect(principal().dataset.accion).toBe("otra-nota");
    expect(textoDe()).toContain(t("pagoVencida").split("{fecha}")[0] as string);
    // «Ya pagué» queda de texto, por si ya pagó: mira una vez y, sin nada pagado, vuelve a ofrecer otra nota.
    await tocar(boton("ya-pague"));
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(principal().dataset.accion).toBe("otra-nota");
    await pasa(CADA_MS * 3);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    await tocar(principal());
    expect(srv.pedirOrden).toHaveBeenCalledTimes(2);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:WXYZ2345");
  });

  it("«Volver» desde el pago vuelve a la caja de la compra y deja de mirar", async () => {
    const srv = servidorFalso();
    await hastaPagar(srv);
    await tocar(principal());
    await tocar(boton("volver-pago"));
    expect(principal().textContent).toBe("3 sorteos oficiales por 3 dólares");
    const veces = srv.pago.mock.calls.length;
    await pasa(DURANTE_MS);
    expect(srv.pago).toHaveBeenCalledTimes(veces);
  });

  it("cerrar el paso corta la mirada: ni una pregunta más", async () => {
    const srv = servidorFalso();
    await hastaPagar(srv);
    await tocar(principal());
    const veces = srv.pago.mock.calls.length;
    visibles()
      .find((x) => x.textContent === t("acctSignOut"))
      ?.click();
    await pasa(DURANTE_MS);
    expect(srv.pago).toHaveBeenCalledTimes(veces);
  });

  it("al volver con una orden abierta sin pagar, retoma los datos de esa orden y lo que ya llegó", async () => {
    const srv = servidorFalso({ abierta: { id: ID, producto: "alta", usdc: "3", nota: `tk:o:${ID}`, vence: AHORA + 3_600_000, recibido: "1.5" } });
    srv.s.pagos = [ok({ pagada: false, recibido: "1.5", total: "3", minimo: "2.85" })];
    await abrir(srv);
    expect(srv.pago).toHaveBeenCalledTimes(1);
    expect(srv.pedirOrden).toHaveBeenCalledTimes(1);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe(`tk:o:${ID}`);
    expect(textoDe()).toContain("Llegaron 1,50 de 3 USDC");
    expect(principal().textContent).toBe(t("pagoYaPague"));
    // Nadie mira solo hasta que la persona toque «Ya pagué».
    await pasa(DURANTE_MS);
    expect(srv.pago).toHaveBeenCalledTimes(1);
  });

  it("sin nada a la venta, ningún botón ni texto ofrece comprar", async () => {
    const srv = servidorFalso({ oferta: { alta: null, paquetes: [] } });
    await abrir(srv);
    expect(principal().dataset.accion).toBe("tengo-cupon");
    expect(visibles().some((b) => b.dataset.accion === "comprar")).toBe(false);
    expect(textoDe()).not.toMatch(/paquete|dólares/);
  });

  it("sin la compra en el build (el acceso no trae oferta, orden ni pago), el paso de siempre", async () => {
    const srv = servidorFalso({ compra: false });
    await abrir(srv);
    expect(principal().dataset.accion).toBe("tengo-cupon");
    expect(srv.oferta).not.toHaveBeenCalled();
    expect(srv.pedirOrden).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
  });
});

describe("la compra con la wifi lenta de un stand", () => {
  // Cada pedido al servidor espera el token de la sesión y después la respuesta: con un token de 7 segundos y un pedido
  // de 4, contesta a los 11. Las lecturas del servidor esperan a los dos topes de adentro (`TOPE_LECTURA_SERVIDOR_MS`).
  const LENTO_MS = 11_000;
  const tarda = <T>(r: () => Promise<T>): Promise<T> => new Promise((listo) => setTimeout(() => listo(r()), LENTO_MS));

  it("la orden que contesta a los 11 segundos llega: los datos para pagar, sin Probar de nuevo", async () => {
    const srv = servidorFalso();
    srv.pedirOrden.mockImplementation(() => tarda(async () => ok(orden())));
    await abrir(srv);
    await tocar(principal());
    await pasa(LENTO_MS);
    expect(alerta()).toBe("");
    expect(srv.pedirOrden).toHaveBeenCalledTimes(1);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe(`tk:o:${ID}`);
    expect(principal().textContent).toBe(t("pagoYaPague"));
  });

  it("Ya pagué con el pago y el acceso que contestan a los 11 segundos: Activar mi cuenta, sin Probar de nuevo", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [LLEGO];
    const estadoRapido = srv.estado.getMockImplementation() as () => Promise<ResultadoDeAlta<EstadoDeAlta>>;
    const pagoRapido = srv.pago.getMockImplementation() as () => Promise<ResultadoDeAlta<PagoDeOrden>>;
    const { cf } = await hastaPagar(srv);
    srv.estado.mockImplementation(() => tarda(estadoRapido));
    srv.pago.mockImplementation(() => tarda(pagoRapido));
    await tocar(principal());
    await pasa(LENTO_MS);
    await pasa(LENTO_MS);
    expect(alerta()).toBe("");
    expect(principal().dataset.accion).toBe("activar");
    expect(textoDe()).toContain(t("pagoListo"));
    expect(cf.cuenta.activarCuenta).not.toHaveBeenCalled();
  });

  it("al volver con una orden abierta, el pago y la orden que contestan a los 11 segundos retoman los datos y lo que ya llegó", async () => {
    const srv = servidorFalso({ abierta: { id: ID, producto: "alta", usdc: "3", nota: `tk:o:${ID}`, vence: AHORA + 3_600_000, recibido: "1.5" } });
    srv.pago.mockImplementation(() => tarda(async () => ok<PagoDeOrden>({ pagada: false, recibido: "1.5", total: "3", minimo: "2.85" })));
    srv.pedirOrden.mockImplementation(() => tarda(async () => ok(orden())));
    await abrir(srv);
    await pasa(LENTO_MS);
    await pasa(LENTO_MS);
    expect(alerta()).toBe("");
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe(`tk:o:${ID}`);
    expect(textoDe()).toContain("Llegaron 1,50 de 3 USDC");
  });

  it("al volver con la orden ya pagada, el acceso que contesta a los 11 segundos dice Recibimos tu pago", async () => {
    const srv = servidorFalso({ abierta: { id: ID, producto: "alta", usdc: "3", nota: `tk:o:${ID}`, vence: AHORA + 3_600_000, recibido: "3" } });
    srv.s.pagos = [LLEGO];
    const estadoRapido = srv.estado.getMockImplementation() as () => Promise<ResultadoDeAlta<EstadoDeAlta>>;
    let lecturas = 0;
    // La primera lectura del acceso es la de siempre, y la de después del pago tarda.
    srv.estado.mockImplementation(() => (++lecturas === 1 ? estadoRapido() : tarda(estadoRapido)));
    await abrir(srv);
    await pasa(LENTO_MS);
    expect(srv.estado).toHaveBeenCalledTimes(2);
    expect(alerta()).toBe("");
    expect(textoDe()).toContain(t("pagoListo"));
  });
});
