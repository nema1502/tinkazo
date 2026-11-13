// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));

import { setLang, t } from "../i18n";
import type { ErrorDeAlta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { Oferta, ProductoALaVenta } from "../stellar/alta-oferta";
import { type CompraDePaquetes, type EstadoDelPaquete, type FaseDelPaquete, abrirSumarSorteos, paqueteInicial, vistaDelPaquete } from "./pago-paquete";
import { CADA_MS, DURANTE_MS } from "./pago-sondeo";

/**
 * «Sumar sorteos» con la cuenta ya lista: la ventana de los paquetes. Lo que se vende sale del servidor y los datos para
 * pagar, de la orden; cada estado con su texto y una sola principal, en el pie. En jsdom, con un servidor de mentira.
 */

const DESTINO = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const AHORA = Date.UTC(2026, 10, 16, 15, 0);
const P10: ProductoALaVenta = { id: "p10", usdc: "9", sorteos: 10, dias: 365 };
const P50: ProductoALaVenta = { id: "p50", usdc: "25", sorteos: 50, dias: 365 };
const orden = (id = "ABCD2345", producto = "p10", usdc = "9", vence = AHORA + 72 * 3_600_000): OrdenDePago => ({
  id,
  producto,
  usdc,
  sorteos: 10,
  destino: DESTINO,
  nota: `tk:o:${id}`,
  memoId: memoIdDe(id) as string,
  enlace: `web+stellar:pay?destination=${DESTINO}&amount=${usdc}&memo=tk%3Ao%3A${id}`,
  vence,
});
const ok = <T>(datos: T): ResultadoDeAlta<T> => ({ ok: true, datos });
const err = (clave: string, motivo: string, estado: number): ErrorDeAlta => ({ ok: false, clave, vars: {}, motivo, estado });
const NO_LLEGO = ok<PagoDeOrden>({ pagada: false, recibido: "0", total: "9", minimo: "8.55" });
const LLEGO = ok<PagoDeOrden>({ pagada: true, sorteos: { quedan: 13, proximoVence: null }, sigue: "lista" });

function servidorFalso(paquetes: ProductoALaVenta[] = [P10]) {
  const s = { pagos: [] as ResultadoDeAlta<PagoDeOrden>[], ordenes: [] as ResultadoDeAlta<OrdenDePago>[] };
  const compra = {
    oferta: vi.fn(async (): Promise<Oferta> => ({ alta: null, paquetes })),
    orden: vi.fn(async (p: string): Promise<ResultadoDeAlta<OrdenDePago>> => (s.ordenes.length > 1 ? (s.ordenes.shift() as ResultadoDeAlta<OrdenDePago>) : (s.ordenes[0] ?? ok(orden("ABCD2345", p))))),
    pago: vi.fn(async (): Promise<ResultadoDeAlta<PagoDeOrden>> => (s.pagos.length > 1 ? (s.pagos.shift() as ResultadoDeAlta<PagoDeOrden>) : (s.pagos[0] ?? NO_LLEGO))),
    refrescarCupo: vi.fn(),
  } satisfies CompraDePaquetes;
  return { s, compra };
}

const card = (): HTMLElement | null => document.querySelector('[data-pago="paquete"]');
const principal = (): HTMLButtonElement => card()?.querySelector(".dlg-main") as HTMLButtonElement;
const texto = (): string => card()?.textContent ?? "";
const alerta = (): string => card()?.querySelector('[role="alert"]')?.textContent ?? "";
const panel = (): HTMLElement | null => card()?.querySelector('[data-pago="panel"]') ?? null;
const boton = (accion: string): HTMLButtonElement | undefined => [...(card()?.querySelectorAll<HTMLButtonElement>(".dlg-cuerpo button") ?? [])].find((b) => b.dataset.accion === accion);
const pasa = (ms = 20): Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => undefined);
const tocar = async (b: HTMLElement | undefined | null): Promise<void> => {
  expect(b, "el botón está a la vista").toBeTruthy();
  (b as HTMLElement).click();
  await pasa();
};
const cerrar = async (): Promise<void> => {
  (card()?.querySelector('[data-dlg="x"]') as HTMLButtonElement | null)?.click();
  await pasa();
};

/**
 * Abre la ventana y deja pasar lo que hace al abrir. Devuelve la promesa de la ventana dentro de un objeto: una función
 * `async` que la devolviera suelta esperaría a que la ventana se cierre.
 */
async function abrir(srv: ReturnType<typeof servidorFalso>, producto?: string): Promise<{ resultado: Promise<boolean> }> {
  const resultado = abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", ...(producto ? { producto } : {}) });
  await pasa();
  return { resultado };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AHORA);
  setLang("es");
  document.body.innerHTML = "";
});
afterEach(async () => {
  if (card()) await cerrar();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("la tabla de la ventana", () => {
  it("una sola principal en cada estado, y ningún precio que no venga del servidor", () => {
    const fases: FaseDelPaquete[] = ["leyendo", "elegir", "pidiendo", "pagando", "listo", "sin-venta"];
    let filas = 0;
    for (const fase of fases)
      for (const paquetes of [[], [P10], [P10, P50]])
        for (const conOrden of [false, true])
          for (const buscando of [false, true])
            for (const tarda of [false, true])
              for (const vencida of [false, true])
                for (const falta of [null, { recibido: "4.5", total: "9" }])
                  for (const error of [null, { clave: "pagoErrRed" }])
                    for (const arreglo of ["probar", "ninguno"] as const) {
                      const e: EstadoDelPaquete = { ...paqueteInicial("es", "a•••@gmail.com"), fase, paquetes, elegido: paquetes[0] ?? null, orden: conOrden ? orden() : null, buscando, tarda, vencida, falta, error, arreglo, quedan: fase === "listo" ? 13 : null };
                      const v = vistaDelPaquete(e);
                      filas++;
                      expect(v.principal, JSON.stringify(e)).toBeTruthy();
                      // Una principal: lo secundario nunca repite su acción.
                      expect(v.secundarios.some((s) => s.accion === v.principal.accion && s.producto === v.principal.producto)).toBe(false);
                      // Lo que ofrece un paquete lleva los números del paquete del servidor, y nada más.
                      for (const b of [v.principal, ...v.secundarios]) {
                        if (b.clave !== "cupoOfSumarPaquete") continue;
                        const p = paquetes.find((x) => x.id === b.producto);
                        expect(p, JSON.stringify(b)).toBeTruthy();
                        expect(b.vars?.precio).toContain((p as ProductoALaVenta).usdc);
                      }
                      // Los datos para pagar salen de la orden tal cual, y solo pagando.
                      if (v.panel) {
                        expect(fase).toBe("pagando");
                        expect(v.panel.destino).toBe(DESTINO);
                        expect(v.panel.nota).toBe("tk:o:ABCD2345");
                        expect(v.panel.usdc).toBe("9");
                      }
                      // Una nota vencida sin nada pagado no se muestra para pagar.
                      if (fase === "pagando" && conOrden && vencida && !falta) expect(v.panel).toBeNull();
                    }
    expect(filas).toBeGreaterThan(2000);
  });
});

describe("sumar sorteos", () => {
  it("con un paquete a la venta va directo a los datos para pagar, todos de la orden", async () => {
    const srv = servidorFalso();
    await abrir(srv);
    expect(srv.compra.orden).toHaveBeenCalledWith("p10");
    expect(panel()?.querySelector('[data-dato="destino"]')?.textContent).toBe(`${DESTINO.slice(0, 4)}…${DESTINO.slice(-4)}`);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:ABCD2345");
    expect(panel()?.querySelector('[data-dato="monto"]')?.textContent).toBe("9 USDC");
    expect(principal().textContent).toBe(t("pagoYaPague"));
    expect(card()?.querySelectorAll(".dlg-main").length).toBe(1);
    expect(srv.compra.pago).not.toHaveBeenCalled();
    // Poco texto: a la vista, una sola línea (cómo pagar) y los datos; lo demás, plegado en Más detalles.
    expect([...(card()?.querySelectorAll(".dlg-cuerpo > p, .dlg-cuerpo > .cl-error") ?? [])].map((p) => p.textContent)).toEqual([t("compraAppLinea")]);
    const mas = panel()?.querySelector<HTMLDetailsElement>('details[data-pago="detalles"]');
    expect(mas?.open).toBe(false);
    expect(mas?.querySelector("summary")?.textContent).toBe(t("pagoMasDetalles"));
    expect(mas?.textContent).toContain(t("pagoParaCuenta").replace("{correo}", "a•••@gmail.com"));
    for (const k of ["compraNotaMemo", "compraSinDolares"]) expect(mas?.textContent, k).toContain(t(k));
  });

  it("con varios, primero cuál: el primero de principal con su precio, los otros al lado", async () => {
    const srv = servidorFalso([P10, P50]);
    await abrir(srv);
    expect(srv.compra.orden).not.toHaveBeenCalled();
    expect(principal().textContent).toBe("Organizá 10 sorteos oficiales por 9 dólares");
    expect(boton("elegir")?.textContent).toBe("Organizá 50 sorteos oficiales por 25 dólares");
    await tocar(boton("elegir"));
    expect(srv.compra.orden).toHaveBeenCalledWith("p50");
    expect(panel()).not.toBeNull();
  });

  it("«Ya pagué» mira enseguida y cada 10 segundos; apenas llega, los sorteos que quedan y el cupo se refresca", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [NO_LLEGO, NO_LLEGO, LLEGO];
    const { resultado } = await abrir(srv);
    await tocar(principal());
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("pagoBuscando"));
    expect(principal().disabled).toBe(true);
    expect(texto()).toContain(t("pagoNoLlego"));
    await pasa(CADA_MS);
    await pasa(CADA_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(3);
    expect(texto()).toContain("Recibimos tu pago. Te quedan 13 sorteos oficiales.");
    expect(panel()).toBeNull();
    expect(principal().textContent).toBe(t("acctClose"));
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(1);
    await pasa(DURANTE_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(3);
    await tocar(principal());
    expect(card()).toBeNull();
    await expect(resultado).resolves.toBe(true);
  });

  it("llegó de menos: cuánto de cuánto, que se completa con la misma nota, y se sigue mirando", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [ok({ pagada: false, recibido: "4.5", total: "9", minimo: "8.55" })];
    await abrir(srv);
    await tocar(principal());
    expect(texto()).toContain("Llegaron 4,50 de 9 USDC. Mandá lo que falta con la misma nota.");
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:ABCD2345");
    await pasa(CADA_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(2);
  });

  it("a los 5 minutos, que tarda y «No llegó», que recién ahí dice lo de la red", async () => {
    const srv = servidorFalso();
    await abrir(srv);
    await tocar(principal());
    await pasa(DURANTE_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(31);
    expect(texto()).toContain(t("pagoTarda"));
    expect(texto()).not.toContain(t("pagoRedEquivocada"));
    expect(principal().textContent).toBe(t("pagoYaPague"));
    await tocar(boton("no-llego"));
    expect(texto()).toContain(t("pagoRedEquivocada"));
    expect(boton("no-llego")).toBeUndefined();
  });

  it("sin conexión: el motivo y «Probar de nuevo», que vuelve a mirar", async () => {
    const srv = servidorFalso();
    srv.s.pagos = [err("altaErrServicio", "sin-red", 0), NO_LLEGO];
    await abrir(srv);
    await tocar(principal());
    expect(alerta()).toContain(t("pagoErrRed"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    await pasa(CADA_MS * 3);
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
    await tocar(principal());
    expect(srv.compra.pago).toHaveBeenCalledTimes(2);
    expect(alerta()).toBe("");
  });

  it("la venta en pausa al pedir la orden: el motivo, nada que ofrezca comprar, y «Cerrar»", async () => {
    const srv = servidorFalso();
    srv.s.ordenes = [err("pagoPausado", "venta-pausada", 503)];
    const { resultado } = await abrir(srv);
    // La pausa de hoy es a mano: una frase corta que no promete cuándo vuelve.
    expect(alerta()).toContain(t("pagoNoALaVenta"));
    expect(card()?.querySelectorAll(".dlg-cuerpo > p, .dlg-cuerpo > .cl-error").length).toBe(1);
    expect(principal().textContent).toBe(t("acctClose"));
    expect(panel()).toBeNull();
    expect(texto()).not.toMatch(/dólares/);
    await tocar(principal());
    await expect(resultado).resolves.toBe(false);
  });

  it("una cuenta fuera de la lista del piloto del servidor: lo mismo que la venta en pausa, sin Probar de nuevo", async () => {
    const srv = servidorFalso();
    srv.s.ordenes = [err("altaErrServicio", "fuera-del-piloto", 503)];
    const { resultado } = await abrir(srv);
    expect(alerta()).toContain(t("pagoNoALaVenta"));
    expect(principal().textContent).toBe(t("acctClose"));
    expect(panel()).toBeNull();
    await tocar(principal());
    await expect(resultado).resolves.toBe(false);
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
  });

  it("sin nada a la venta: que no está a la venta, y ningún botón de comprar", async () => {
    const srv = servidorFalso([]);
    await abrir(srv);
    expect(srv.compra.orden).not.toHaveBeenCalled();
    expect(texto()).toContain(t("pagoNoALaVenta"));
    expect(principal().textContent).toBe(t("acctClose"));
    expect(boton("elegir")).toBeUndefined();
  });

  it("la nota vence: deja de mostrarse para pagar, y «Pedir una nota nueva» pide otra", async () => {
    const srv = servidorFalso();
    srv.s.ordenes = [ok(orden("ABCD2345", "p10", "9", AHORA + 60_000)), ok(orden("WXYZ2345"))];
    await abrir(srv);
    expect(panel()).not.toBeNull();
    await pasa(2 * 60_000);
    expect(panel()).toBeNull();
    expect(principal().dataset.accion).toBe("otra-nota");
    await tocar(principal());
    expect(srv.compra.orden).toHaveBeenCalledTimes(2);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:WXYZ2345");
  });

  it("cerrar la ventana corta la mirada, y un doble toque no abre dos", async () => {
    const srv = servidorFalso();
    const a = abrirSumarSorteos(srv.compra);
    const b = abrirSumarSorteos(srv.compra);
    expect(a).toBe(b);
    await pasa();
    expect(document.querySelectorAll('[data-pago="paquete"]').length).toBe(1);
    await tocar(principal());
    const veces = srv.compra.pago.mock.calls.length;
    await cerrar();
    await pasa(DURANTE_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(veces);
    await expect(a).resolves.toBe(false);
  });

  it("en inglés, sus textos en inglés", async () => {
    setLang("en");
    const srv = servidorFalso([P10, P50]);
    await abrir(srv);
    expect(principal().textContent).toBe("Run 10 Live draws for US$9");
    setLang("es");
  });

  it("con la wifi lenta del servidor, la orden que llega a los 11 segundos se muestra: espera lo mismo que el resto de la compra", async () => {
    const srv = servidorFalso();
    srv.compra.orden.mockImplementation(() => new Promise((r) => setTimeout(() => r(ok(orden())), 11_000)));
    await abrir(srv);
    await pasa(11_100);
    expect(alerta()).toBe("");
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:ABCD2345");
    // Ya pagué pregunta el pago con el mismo tope.
    srv.compra.pago.mockImplementation(() => new Promise((r) => setTimeout(() => r(LLEGO), 11_000)));
    await tocar(principal());
    await pasa(11_100);
    expect(alerta()).toBe("");
    expect(texto()).toContain("Te quedan 13 sorteos oficiales");
  });

  it("con el QR para esta cuenta, Estoy en Bolivia va en el panel: recuerda el medio, cierra y lleva al QR con el paquete", async () => {
    const srv = servidorFalso();
    const alQr = vi.fn();
    const guardado = new Map<string, string>();
    const almacen = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
    const resultado = abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", alQr, almacenDelMedio: almacen });
    await pasa();
    const cambio = panel()?.querySelector<HTMLElement>('[data-pago="cambio"]');
    expect(cambio?.textContent).toBe(t("compraEstoy"));
    // Antes de los datos.
    expect(panel()?.firstElementChild).toBe(cambio);
    await tocar(cambio);
    expect(guardado.get("tinkazo:medio-de-pago")).toBe("qr");
    expect(card()).toBeNull();
    expect(alQr).toHaveBeenCalledWith("p10");
    await expect(resultado).resolves.toBe(false);
  });

  it("con el medio deducido en el QR, elegir el paquete lleva a Tu compra sin pedir una orden ni recordar nada", async () => {
    const srv = servidorFalso([P10, P50]);
    const alQr = vi.fn();
    const guardado = new Map<string, string>();
    const almacen = { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) };
    const resultado = abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", alQr, medio: "qr", almacenDelMedio: almacen });
    await pasa();
    await tocar(boton("elegir") ?? [...(card()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.dataset.producto === "p50"));
    expect(alQr).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    expect(srv.compra.orden).not.toHaveBeenCalled();
    // La deducción no se guarda sola: solo lo que la persona elige con el enlace.
    expect(guardado.size).toBe(0);
    await expect(resultado).resolves.toBe(false);
  });

  it("con el medio deducido en el QR y el paquete nombrado, va directo a Tu compra con ese paquete", async () => {
    const srv = servidorFalso([P10, P50]);
    const alQr = vi.fn();
    const resultado = abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", alQr, medio: "qr", producto: "p50", almacenDelMedio: null });
    await pasa();
    expect(alQr).toHaveBeenCalledWith("p50");
    expect(srv.compra.orden).not.toHaveBeenCalled();
    await expect(resultado).resolves.toBe(false);
  });

  it("el medio en el QR sin a quién llevar no cambia nada: el panel de siempre", async () => {
    const srv = servidorFalso();
    const resultado = abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", medio: "qr" });
    await pasa();
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
    expect(panel()).toBeTruthy();
    void resultado;
  });

  it("sin el QR para esta cuenta, el panel no ofrece cambiar", async () => {
    const srv = servidorFalso();
    await abrir(srv);
    expect(panel()?.querySelector('[data-pago="cambio"]')).toBeNull();
  });
});
