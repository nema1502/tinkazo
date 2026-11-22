// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./qr", () => ({ pintarQr: vi.fn(async () => true) }));

import { setLang, t } from "../i18n";
import type { ErrorDeAlta, OrdenDePago, PagoDeOrden, ResultadoDeAlta } from "../stellar/alta-api";
import { memoIdDe } from "../stellar/alta-api";
import type { Oferta, ProductoALaVenta } from "../stellar/alta-oferta";
import {
  type CompraDePaquetes,
  type EstadoDelPaquete,
  type FaseDelPaquete,
  type VistaDelPaquete,
  abrirSumarSorteos,
  paqueteInicial,
  vistaDelPaquete,
} from "./pago-paquete";
import { CADA_MS, DURANTE_MS, DURANTE_SOLO_MS, PRIMEROS_MS } from "./pago-sondeo";

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

  it("los sorteos dados solo cambian la nota de lo que llegó de menos, y solo si cuadran con la orden", () => {
    const falta = { recibido: "4.5", total: "10" };
    const base: EstadoDelPaquete = { ...paqueteInicial("es", ""), fase: "pagando", orden: orden("ABCD2345", "sorteo", "10"), falta };
    const nota = (x: Partial<EstadoDelPaquete>): VistaDelPaquete["nota"] => vistaDelPaquete({ ...base, ...x }).nota;
    // Con decimales, lo que falta como un precio. Mirando solo o no, lo mismo.
    const dados = { clave: "pagoFaltaDados", vars: { dados: "4", n: "10", falta: "5,50 dólares" } };
    expect(nota({ dados: 4, solo: true })).toEqual(dados);
    expect(nota({ dados: 4 })).toEqual(dados);
    // Sin sorteos dados, o tantos como los de la orden (eso ya es pagada), la nota de siempre.
    for (const d of [0, 10, 12]) expect(nota({ dados: d, solo: true })?.clave, String(d)).toBe("pagoFalta");
    // Sin nada llegado, o después de «No llegó», tampoco cambia.
    expect(nota({ dados: 4, solo: true, falta: null })?.clave).not.toBe("pagoFaltaDados");
    expect(nota({ dados: 4, noLlego: true })?.clave).toBe("pagoRedEquivocada");
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

  it("tras «No llegó», los casos de otra moneda y de la nota llegan a Más detalles del panel, que sigue siendo uno y sigue abierto", async () => {
    const srv = servidorFalso();
    await abrir(srv);
    await tocar(principal());
    const antes = panel() as HTMLElement;
    expect(antes).not.toBeNull();
    // Mientras nada cambia, a cada mirada y al pasar los 5 minutos, el panel es el mismo elemento y los dos casos no están.
    await pasa(CADA_MS * 3);
    expect(panel()).toBe(antes);
    await pasa(DURANTE_MS);
    expect(panel()).toBe(antes);
    expect(antes.textContent).not.toContain(t("pagoOtraMoneda"));
    expect(antes.textContent).not.toContain(t("pagoOtraNotaEnviada"));
    // Quien abrió Más detalles lo ve abierto después de tocar No llegó.
    (antes.querySelector("details") as HTMLDetailsElement).open = true;
    await tocar(boton("no-llego"));
    const despues = panel() as HTMLElement;
    expect(card()?.querySelectorAll('[data-pago="panel"]').length).toBe(1);
    expect(despues.textContent).toContain(t("pagoOtraMoneda"));
    expect(despues.textContent).toContain(t("pagoOtraNotaEnviada"));
    expect((despues.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(despues.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:ABCD2345");
    // Al tocar Ya pagué de nuevo, los casos se van y el panel se arma otra vez: sigue habiendo uno solo.
    await tocar(principal());
    expect(card()?.querySelectorAll('[data-pago="panel"]').length).toBe(1);
    expect(panel()?.textContent).not.toContain(t("pagoOtraMoneda"));
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

/** El producto por unidad como lo deja `ofertaDe`: 1 dólar por sorteo, de 5 a 50 de a 5, que valen un año. */
const SORTEO: ProductoALaVenta = { id: "sorteo", usdc: "1", sorteos: 1, dias: 365, unidad: { minimo: 5, maximo: 50, paso: 5 } };
const cantidad = (): string => card()?.querySelector('[data-dato="cantidad"]')?.textContent ?? "";
const lado = (accion: "menos" | "mas"): HTMLButtonElement | null =>
  card()?.querySelector<HTMLButtonElement>(`.pago-contador button[data-accion="${accion}"]`) ?? null;
const lineas = (): (string | null)[] => [...(card()?.querySelectorAll(".dlg-cuerpo > p, .dlg-cuerpo > .cl-error") ?? [])].map((p) => p.textContent);

describe("el contador del producto por unidad", () => {
  it("abre en cuántos: la línea del precio, el contador en 10 y Seguir con el total, sin pedir ninguna orden", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    expect(card()?.querySelector(".dlg-h")?.textContent).toBe(t("cupoOfSumar"));
    expect(lineas()).toEqual(["Cada sorteo que organizás, 1 dólar en USDC. Valen un año."]);
    expect(cantidad()).toBe("10");
    expect(principal().textContent).toBe("Seguir con 10 dólares");
    expect(card()?.querySelectorAll(".dlg-main").length).toBe(1);
    expect(panel()).toBeNull();
    expect(srv.compra.orden).not.toHaveBeenCalled();
    expect(srv.compra.pago).not.toHaveBeenCalled();
  });

  it("más suma de a 5 y el total del botón cambia con la cantidad", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    await tocar(lado("mas"));
    expect(cantidad()).toBe("15");
    expect(principal().textContent).toBe("Seguir con 15 dólares");
    await tocar(lado("menos"));
    await tocar(lado("menos"));
    expect(cantidad()).toBe("5");
    expect(principal().textContent).toBe("Seguir con 5 dólares");
  });

  it("no baja de 5: en el mínimo, menos queda apagado y la cantidad no se mueve", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    await tocar(lado("menos"));
    expect(cantidad()).toBe("5");
    expect(lado("menos")?.disabled).toBe(true);
    expect(lado("mas")?.disabled).toBe(false);
    lado("menos")?.click();
    await pasa();
    expect(cantidad()).toBe("5");
  });

  it("no pasa de 50: en el máximo, más queda apagado y la cantidad no se mueve", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    for (let i = 0; i < 8; i++) await tocar(lado("mas"));
    expect(cantidad()).toBe("50");
    expect(principal().textContent).toBe("Seguir con 50 dólares");
    expect(lado("mas")?.disabled).toBe(true);
    lado("mas")?.click();
    await pasa();
    expect(cantidad()).toBe("50");
  });

  it("el mínimo, el máximo y el paso son los del servidor", async () => {
    const srv = servidorFalso([{ ...SORTEO, unidad: { minimo: 20, maximo: 40, paso: 10 } }]);
    await abrir(srv);
    expect(cantidad()).toBe("20");
    expect(lado("menos")?.disabled).toBe(true);
    await tocar(lado("mas"));
    expect(cantidad()).toBe("30");
    await tocar(lado("mas"));
    expect(cantidad()).toBe("40");
    expect(lado("mas")?.disabled).toBe(true);
  });

  it("Seguir no cobra: pide la orden de esa cantidad y pasa a los datos para pagar, de la orden", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    await tocar(lado("mas"));
    await tocar(principal());
    expect(srv.compra.orden).toHaveBeenCalledTimes(1);
    expect(srv.compra.orden).toHaveBeenCalledWith("sorteo", 15);
    expect(panel()?.querySelector('[data-dato="nota"]')?.textContent).toBe("tk:o:ABCD2345");
    expect(card()?.querySelector(".pago-contador")).toBeNull();
  });

  it("sin conexión al pedir la orden: el motivo, y Probar de nuevo la pide otra vez con la misma cantidad", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.ordenes = [err("altaErrServicio", "sin-red", 0), ok(orden("ABCD2345", "sorteo"))];
    await abrir(srv);
    await tocar(lado("mas"));
    await tocar(principal());
    expect(alerta()).toBe(t("altaErrServicio"));
    expect(principal().textContent).toBe(t("clProbarDeNuevo"));
    await tocar(principal());
    expect(srv.compra.orden).toHaveBeenLastCalledWith("sorteo", 15);
    expect(panel()).not.toBeNull();
  });

  it("el foco queda en el contador al tocarlo, y en el borde pasa al otro lado", async () => {
    const srv = servidorFalso([{ ...SORTEO, unidad: { minimo: 5, maximo: 15, paso: 5 } }]);
    await abrir(srv);
    lado("mas")?.focus();
    await tocar(lado("mas"));
    expect(cantidad()).toBe("15");
    expect(document.activeElement).toBe(lado("menos"));
    await tocar(lado("menos"));
    expect(document.activeElement).toBe(lado("menos"));
  });

  it("cada botón dice qué hace, y la cantidad se anuncia cuando cambia", async () => {
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    expect(lado("menos")?.getAttribute("aria-label")).toBe(t("pagoMenos"));
    expect(lado("mas")?.getAttribute("aria-label")).toBe(t("pagoMas"));
    expect(card()?.querySelector(".pago-contador")?.getAttribute("aria-label")).toBe(t("pagoCuantos"));
    expect(card()?.querySelector('[data-dato="cantidad"]')?.getAttribute("aria-live")).toBe("polite");
  });

  it("en inglés, sus textos en inglés", async () => {
    setLang("en");
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    expect(lineas()).toEqual(["Each draw you run, US$1 in USDC. Valid for a year."]);
    expect(principal().textContent).toBe("Continue with US$10");
  });

  it("con otros días que un año, la línea dice los días del servidor", async () => {
    const srv = servidorFalso([{ ...SORTEO, dias: 180 }]);
    await abrir(srv);
    expect(lineas()).toEqual(["Cada sorteo que organizás, 1 dólar en USDC. Valen 180 días."]);
  });

  it("con el medio deducido en el QR, el producto por unidad sigue por el contador y sin Estoy en Bolivia", async () => {
    const srv = servidorFalso([SORTEO]);
    const alQr = vi.fn();
    void abrirSumarSorteos(srv.compra, { correo: "a•••@gmail.com", alQr, medio: "qr", almacenDelMedio: null });
    await pasa();
    expect(cantidad()).toBe("10");
    await tocar(principal());
    expect(alQr).not.toHaveBeenCalled();
    expect(srv.compra.orden).toHaveBeenCalledWith("sorteo", 10);
    expect(panel()?.querySelector('[data-pago="cambio"]')).toBeNull();
  });

  it("un paquete fijo nombrado por quien abre la ventana sigue yendo directo a pagarlo", async () => {
    const srv = servidorFalso([SORTEO, P10]);
    await abrir(srv, "p10");
    expect(srv.compra.orden).toHaveBeenCalledWith("p10");
    expect(panel()).not.toBeNull();
  });
});

describe("mirar el pago solo, por unidad", () => {
  /** Abre la ventana, deja el contador en 10 y toca Seguir: la orden se muestra y se empieza a mirar. */
  async function aPagar(srv: ReturnType<typeof servidorFalso>): Promise<{ resultado: Promise<boolean> }> {
    const abierta = await abrir(srv);
    await tocar(principal());
    return abierta;
  }

  it("al mostrar la orden ya se mira, sin tocar nada: Buscando tu pago abajo y ningún Ya pagué", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("pagoBuscando"));
    expect(principal().disabled).toBe(true);
    expect(boton("mirar-ya")).toBeUndefined();
    expect(boton("ya-pague")).toBeUndefined();
    // Todavía no pudo pagar: no se dice que no se ve el pago, se dice cómo pagar.
    expect(lineas()).toEqual([t("compraAppLinea")]);
    expect(texto()).not.toContain(t("pagoNoLlego"));
  });

  it("llega sin tocar nada: Recibimos tu pago de título, cuántos quedan y Cerrar, y el cupo se refresca", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.pagos = [NO_LLEGO, NO_LLEGO, LLEGO];
    const { resultado } = await aPagar(srv);
    await pasa(CADA_MS);
    await pasa(CADA_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(3);
    expect(card()?.querySelector(".dlg-h")?.textContent).toBe(t("pagoListoTitulo"));
    expect(lineas()).toEqual(["Te quedan 13 sorteos oficiales."]);
    expect(panel()).toBeNull();
    expect(principal().textContent).toBe(t("acctClose"));
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(1);
    await pasa(DURANTE_SOLO_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(3);
    await tocar(principal());
    await expect(resultado).resolves.toBe(true);
  });

  it("Ya pagué aparece como texto chico recién a los 2 minutos sin el pago, y pregunta ya", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    await pasa(PRIMEROS_MS - 100);
    expect(boton("mirar-ya")).toBeUndefined();
    await pasa(100);
    const ya = boton("mirar-ya");
    expect(ya?.textContent).toBe(t("pagoYaPague"));
    expect(ya?.className).toBe("cl-texto");
    expect(principal().textContent).toBe(t("pagoBuscando"));
    const antes = srv.compra.pago.mock.calls.length;
    await tocar(ya);
    expect(srv.compra.pago).toHaveBeenCalledTimes(antes + 1);
  });

  it("después de los 2 minutos pregunta cada 30 segundos", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    await pasa(PRIMEROS_MS);
    const antes = srv.compra.pago.mock.calls.length;
    await pasa(29_000);
    expect(srv.compra.pago).toHaveBeenCalledTimes(antes);
    await pasa(1_000);
    expect(srv.compra.pago).toHaveBeenCalledTimes(antes + 1);
  });

  it("a los 30 minutos, que se puede cerrar y llega igual, Cerrar de principal, y Ya pagué vuelve a mirar", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    await pasa(DURANTE_SOLO_MS);
    expect(texto()).toContain(t("pagoTardaSolo"));
    expect(principal().textContent).toBe(t("acctClose"));
    expect(boton("no-llego")?.textContent).toBe(t("pagoNoLlegoBoton"));
    const antes = srv.compra.pago.mock.calls.length;
    await pasa(10 * 60_000);
    expect(srv.compra.pago).toHaveBeenCalledTimes(antes);
    await tocar(boton("ya-pague"));
    expect(srv.compra.pago).toHaveBeenCalledTimes(antes + 1);
    expect(principal().textContent).toBe(t("pagoBuscando"));
  });

  it("con la pestaña oculta no pregunta, y al volver a ella pregunta enseguida", async () => {
    let vista: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vista });
    try {
      const srv = servidorFalso([SORTEO]);
      await aPagar(srv);
      expect(srv.compra.pago).toHaveBeenCalledTimes(1);
      vista = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await pasa(5 * 60_000);
      expect(srv.compra.pago).toHaveBeenCalledTimes(1);
      vista = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await pasa();
      expect(srv.compra.pago).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("volver con el foco también pregunta enseguida", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    await pasa(5_000);
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("focus"));
    await pasa();
    expect(srv.compra.pago).toHaveBeenCalledTimes(2);
  });

  it("una falla pasajera se dice y se sigue mirando, y la respuesta buena la borra", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.pagos = [err("altaErrServicio", "sin-red", 0), NO_LLEGO];
    await aPagar(srv);
    expect(alerta()).toBe(t("pagoErrRed"));
    expect(principal().textContent).toBe(t("pagoBuscando"));
    await pasa(CADA_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(2);
    expect(alerta()).toBe("");
  });

  it("una falla que no se arregla mirando corta, como siempre", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.pagos = [err("pagoErrOrden", "orden", 404)];
    await aPagar(srv);
    expect(alerta()).toBe(t("pagoErrOrden"));
    expect(principal().textContent).toBe(t("acctClose"));
    await pasa(CADA_MS * 3);
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
  });

  it("cerrar la ventana corta la mirada y suelta la pestaña", async () => {
    const srv = servidorFalso([SORTEO]);
    await aPagar(srv);
    await cerrar();
    await pasa(CADA_MS * 3);
    window.dispatchEvent(new Event("focus"));
    await pasa();
    expect(srv.compra.pago).toHaveBeenCalledTimes(1);
  });

  it("llegó de menos y ya dio sorteos: cuántos se sumaron y cuánto falta, y el cupo se refresca una sola vez", async () => {
    const srv = servidorFalso([SORTEO]);
    const medias = ok<PagoDeOrden>({ pagada: false, recibido: "9", total: "10", minimo: "9.5", sorteosDados: 9 });
    srv.s.ordenes = [ok(orden("ABCD2345", "sorteo", "10"))];
    srv.s.pagos = [medias, medias, LLEGO];
    await aPagar(srv);
    expect(lineas()).toEqual(["Sumaste 9 de 10 sorteos. Mandá 1 dólar más con la misma nota."]);
    expect(card()?.querySelector(".pago-nota")?.getAttribute("role")).toBe("status");
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(1);
    expect(principal().textContent).toBe(t("pagoBuscando"));
    await pasa(CADA_MS);
    expect(srv.compra.pago).toHaveBeenCalledTimes(2);
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(1);
    await pasa(CADA_MS);
    expect(card()?.querySelector(".dlg-h")?.textContent).toBe(t("pagoListoTitulo"));
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(2);
  });

  it("si llega más y suben los sorteos dados, la línea y el cupo se ponen al día", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.ordenes = [ok(orden("ABCD2345", "sorteo", "10"))];
    srv.s.pagos = [
      ok<PagoDeOrden>({ pagada: false, recibido: "5", total: "10", minimo: "9.5", sorteosDados: 5 }),
      ok<PagoDeOrden>({ pagada: false, recibido: "8", total: "10", minimo: "9.5", sorteosDados: 8 }),
    ];
    await aPagar(srv);
    expect(lineas()).toEqual(["Sumaste 5 de 10 sorteos. Mandá 5 dólares más con la misma nota."]);
    await pasa(CADA_MS);
    expect(lineas()).toEqual(["Sumaste 8 de 10 sorteos. Mandá 2 dólares más con la misma nota."]);
    expect(srv.compra.refrescarCupo).toHaveBeenCalledTimes(2);
  });

  it("sin sorteos dados en la respuesta, lo de siempre: lo que llegó y lo que falta, sin refrescar el cupo", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.ordenes = [ok(orden("ABCD2345", "sorteo", "10"))];
    srv.s.pagos = [ok<PagoDeOrden>({ pagada: false, recibido: "9", total: "10", minimo: "9.5" })];
    await aPagar(srv);
    expect(lineas()).toEqual(["Llegaron 9 de 10 USDC. Mandá lo que falta con la misma nota."]);
    expect(srv.compra.refrescarCupo).not.toHaveBeenCalled();
  });

  it("con sorteos dados en 0, lo de siempre y sin refrescar el cupo", async () => {
    const srv = servidorFalso([SORTEO]);
    srv.s.ordenes = [ok(orden("ABCD2345", "sorteo", "10"))];
    srv.s.pagos = [ok<PagoDeOrden>({ pagada: false, recibido: "0.4", total: "10", minimo: "9.5", sorteosDados: 0 })];
    await aPagar(srv);
    expect(lineas()).toEqual(["Llegaron 0,40 de 10 USDC. Mandá lo que falta con la misma nota."]);
    expect(srv.compra.refrescarCupo).not.toHaveBeenCalled();
  });

  it("los sorteos dados en inglés, con el monto que falta", async () => {
    setLang("en");
    const srv = servidorFalso([SORTEO]);
    srv.s.ordenes = [ok({ ...orden("ABCD2345", "sorteo", "5"), sorteos: 5 })];
    srv.s.pagos = [ok<PagoDeOrden>({ pagada: false, recibido: "4", total: "5", minimo: "4.75", sorteosDados: 4 })];
    await aPagar(srv);
    expect(lineas()).toEqual(["You've added 4 of 5 Live draws. Send US$1 more with the same memo."]);
  });

  it("un paquete fijo no se mira solo: sigue esperando a Ya pagué", async () => {
    const srv = servidorFalso([P10]);
    await abrir(srv);
    await pasa(CADA_MS * 3);
    expect(srv.compra.pago).not.toHaveBeenCalled();
    expect(principal().textContent).toBe(t("pagoYaPague"));
  });

  it("en inglés, sus textos en inglés", async () => {
    setLang("en");
    const srv = servidorFalso([SORTEO]);
    srv.s.pagos = [NO_LLEGO, LLEGO];
    await aPagar(srv);
    await pasa(CADA_MS);
    expect(card()?.querySelector(".dlg-h")?.textContent).toBe("We got your payment");
    expect(lineas()).toEqual(["You have 13 Live draws left."]);
  });
});

describe("los blancos de toque del contador", () => {
  it("menos y más miden 48 por 48 como mínimo, y los dos llevan esa regla", async () => {
    const css = readFileSync("src/styles.css", "utf8");
    const regla = css.slice(css.indexOf("  .pago-contador-boton {"), css.indexOf("  .pago-contador-boton:disabled"));
    expect(regla).toMatch(/min-width: 48px;/);
    expect(regla).toMatch(/min-height: 48px;/);
    const srv = servidorFalso([SORTEO]);
    await abrir(srv);
    for (const b of [lado("menos"), lado("mas")]) {
      expect(b?.className).toBe("pago-contador-boton");
      expect(b?.type).toBe("button");
    }
  });
});
